/**
 * Lab Sync Service — pulls lab results from a FHIR server and imports
 * them into the user's biomarker list.
 *
 * Flow per sync:
 *  1. Load LabConnection, decrypt tokens
 *  2. Refresh access token if expired
 *  3. Query Observations (category=laboratory) since lastSyncAt
 *  4. Map LOINC code → OwnMyHealth biomarker, fall back to FHIR display
 *     name + category 'Other' for unmapped codes
 *  5. Dedupe against existing biomarkers by (name, measurementDate, value)
 *  6. Encrypt values + create biomarkers
 *  7. Update LabConnection.lastSyncAt + counts
 *
 * All PHI (observation values) is encrypted in flight through the same
 * per-user encryption pipeline as manual entry.
 */

import { withRLSContext, withRLSTransaction } from '../database.js';
import { getEncryptionService } from '../encryption.js';
import { getUserEncryptionSalt } from '../userEncryption.js';
import { getAuditLogService, type AuditMetadata } from '../auditLog.js';
import { notifyNewResults, notifyOutOfRange } from '../notificationService.js';
import { getPrismaClient } from '../database.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import {
  discoverEndpoints,
  exchangeCodeForToken,
  refreshAccessToken,
  stashChallenge,
  consumeChallenge,
  generatePKCE,
  buildAuthorizationUrl,
  revokeToken,
  type SMARTConfig,
  type TokenSet,
} from './smartAuth.js';
import { FHIRClient } from './fhirClient.js';
import { findLOINCMapping, extractLOINCCoding } from './loincMapper.js';
import type { FHIRObservation } from './types.js';
import { upsertBiomarkerReading } from '../biomarkerSeries.js';

export interface SyncResult {
  imported: number;
  skipped: number;
  unmappedCodes: string[];
  errors: string[];
}

const RESOURCE_TYPE = 'LabConnection';

// ============================================
// Provider config
// ============================================

function questSMARTConfig(): SMARTConfig {
  if (!config.quest.clientId) {
    throw new Error('Quest FHIR integration is not configured: QUEST_FHIR_CLIENT_ID missing');
  }
  return {
    clientId: config.quest.clientId,
    clientSecret: config.quest.clientSecret || undefined,
    redirectUri: config.quest.redirectUri,
    fhirBaseUrl: config.quest.fhirBaseUrl,
    allowedAuthHosts: config.quest.authHosts,
    scopes: [
      'launch/patient',
      'patient/Observation.read',
      'patient/DiagnosticReport.read',
      'patient/Patient.read',
      'offline_access',
    ],
  };
}

function smartConfigForProvider(provider: string): SMARTConfig {
  if (provider === 'quest') return questSMARTConfig();
  throw new Error(`Unknown lab provider: ${provider}`);
}

async function resolveEndpoints(smart: SMARTConfig): Promise<SMARTConfig> {
  if (smart.authorizeUrl && smart.tokenUrl) return smart;
  const { authorizeUrl, tokenUrl } = await discoverEndpoints(smart.fhirBaseUrl, smart.allowedAuthHosts);
  return { ...smart, authorizeUrl, tokenUrl };
}

// ============================================
// Connect flow (OAuth initiation)
// ============================================

/**
 * Build an authorize URL the frontend should redirect the user to.
 * Stashes the PKCE verifier keyed by state so the callback can
 * complete the exchange.
 */
export async function buildConnectRedirect(
  userId: string,
  provider: string
): Promise<string> {
  const smart = await resolveEndpoints(smartConfigForProvider(provider));
  const challenge = generatePKCE();
  stashChallenge(challenge.state, challenge.codeVerifier, userId);

  const auditService = getAuditLogService(getPrismaClient());
  await auditService.logAccess(RESOURCE_TYPE, undefined, { userId }, {
    operation: 'CONNECT_INITIATED',
    externalApiCall: true,
    provider,
  });

  return buildAuthorizationUrl(smart, challenge);
}

export interface CallbackResult {
  userId: string;
  provider: string;
  tokenSet: TokenSet;
}

/**
 * Handle the OAuth callback — consume the PKCE verifier, exchange the
 * code for tokens, and return both the tokens and the userId that
 * started the flow. Caller is responsible for persisting the
 * LabConnection.
 */
export async function handleOAuthCallback(
  provider: string,
  code: string,
  state: string
): Promise<CallbackResult> {
  const stashed = consumeChallenge(state);
  if (!stashed) {
    throw new Error('Invalid or expired OAuth state — please retry the connection');
  }
  const smart = await resolveEndpoints(smartConfigForProvider(provider));
  const tokenSet = await exchangeCodeForToken(smart, code, stashed.codeVerifier);
  return { userId: stashed.userId, provider, tokenSet };
}

/**
 * Persist the LabConnection with encrypted tokens. Used after a
 * successful callback exchange.
 */
export async function persistConnection(
  userId: string,
  provider: string,
  tokenSet: TokenSet
): Promise<void> {
  const encryption = getEncryptionService();
  const salt = await getUserEncryptionSalt(userId);
  const accessEnc = encryption.encrypt(tokenSet.accessToken, salt);
  const refreshEnc = tokenSet.refreshToken ? encryption.encrypt(tokenSet.refreshToken, salt) : null;

  await withRLSContext(userId, async (tx) => {
    await tx.labConnection.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        fhirPatientId: tokenSet.patientId,
        accessTokenEncrypted: accessEnc,
        refreshTokenEncrypted: refreshEnc,
        tokenExpiresAt: tokenSet.expiresAt,
        scopeGranted: tokenSet.scope,
        syncStatus: 'idle',
        isActive: true,
      },
      update: {
        fhirPatientId: tokenSet.patientId,
        accessTokenEncrypted: accessEnc,
        refreshTokenEncrypted: refreshEnc,
        tokenExpiresAt: tokenSet.expiresAt,
        scopeGranted: tokenSet.scope,
        syncStatus: 'idle',
        syncError: null,
        isActive: true,
      },
    });
  });

  const auditService = getAuditLogService(getPrismaClient());
  await auditService.logAccess(RESOURCE_TYPE, undefined, { userId }, {
    operation: 'CONNECT',
    externalApiCall: true,
    provider,
  });
}

// ============================================
// Sync
// ============================================

export async function syncLabResults(
  userId: string,
  provider: string
): Promise<SyncResult> {
  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);
  const errors: string[] = [];
  const unmappedCodes: string[] = [];

  // Fetch connection + mark syncing
  const connection = await withRLSContext(userId, async (tx) => {
    return tx.labConnection.findUnique({
      where: { userId_provider: { userId, provider } },
    });
  });
  if (!connection || !connection.isActive) {
    throw new Error('Lab connection not found or inactive');
  }

  await withRLSContext(userId, async (tx) => {
    await tx.labConnection.update({
      where: { id: connection.id },
      data: { syncStatus: 'syncing', syncError: null },
    });
  });

  try {
    const encryption = getEncryptionService();
    const salt = await getUserEncryptionSalt(userId);
    const accessTokenPlain = encryption.decrypt(connection.accessTokenEncrypted, salt);
    const refreshTokenPlain = connection.refreshTokenEncrypted
      ? encryption.decrypt(connection.refreshTokenEncrypted, salt)
      : null;

    // Refresh if expired
    let effectiveAccessToken = accessTokenPlain;
    const smartBase = smartConfigForProvider(provider);
    if (
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() < Date.now() + 60_000
    ) {
      if (!refreshTokenPlain) {
        throw new Error('Access token expired and no refresh token available');
      }
      const smart = await resolveEndpoints(smartBase);
      const refreshed = await refreshAccessToken(smart, refreshTokenPlain);
      const newAccessEnc = encryption.encrypt(refreshed.accessToken, salt);
      const newRefreshEnc = refreshed.refreshToken
        ? encryption.encrypt(refreshed.refreshToken, salt)
        : connection.refreshTokenEncrypted;
      await withRLSContext(userId, async (tx) => {
        await tx.labConnection.update({
          where: { id: connection.id },
          data: {
            accessTokenEncrypted: newAccessEnc,
            refreshTokenEncrypted: newRefreshEnc,
            tokenExpiresAt: refreshed.expiresAt,
          },
        });
      });
      effectiveAccessToken = refreshed.accessToken;
    }

    if (!connection.fhirPatientId) {
      throw new Error('Connection has no FHIR patient ID');
    }

    const client = new FHIRClient(smartBase.fhirBaseUrl, effectiveAccessToken);
    const dateFrom = connection.lastSyncAt
      ? connection.lastSyncAt.toISOString().split('T')[0]
      : undefined;
    const observations = await client.getLabResults(connection.fhirPatientId, { dateFrom });

    // Pre-fetch existing biomarkers once for in-memory dedupe.
    const existing = await withRLSContext(userId, async (tx) => {
      return tx.biomarker.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          measurementDate: true,
          valueEncrypted: true,
          sourceFile: true,
        },
      });
    });
    const importResult = await importObservations(
      userId,
      provider,
      observations,
      existing,
      encryption,
      salt
    );
    const { imported, skipped, importedNames, importedOutOfRange } = importResult;
    unmappedCodes.push(...importResult.unmappedCodes);
    errors.push(...importResult.errors);

    // M17: FHIR lab imports are PHI WRITES and must be audited as such. The SYNC
    // summary below is action=READ (best-effort); this is the fail-closed CREATE
    // record for the biomarkers actually written this sync. Batched (one row per
    // sync) to mirror bulkCreateBiomarkers rather than N per-record rows.
    if (imported > 0) {
      await auditService.logCreate(
        'Biomarker',
        'BATCH',
        {
          count: imported,
          provider,
          sourceType: 'API_IMPORT',
          source: `fhir:${provider}`,
          names: importedNames.slice(0, 50),
        },
        { userId }
      );

      // Fire-and-forget engagement emails, mirroring the PDF lab-upload path
      // (labUploadController). Each notifier is gated internally on the user's
      // email prefs (newResults / outOfRangeAlerts), so a synced Quest import now
      // emails the same as a PDF upload instead of going silent.
      void notifyNewResults(userId, {
        biomarkerCount: imported,
        outOfRangeCount: importedOutOfRange.length,
        labName: `${provider.toUpperCase()} FHIR`,
      });
      if (importedOutOfRange.length > 0) {
        void notifyOutOfRange(userId, { biomarkers: importedOutOfRange });
      }
    }

    await withRLSContext(userId, async (tx) => {
      await tx.labConnection.update({
        where: { id: connection.id },
        data: {
          syncStatus: 'idle',
          syncError: null,
          lastSyncAt: new Date(),
          lastImportedCount: imported,
        },
      });
    });

    const auditMeta: AuditMetadata = {
      operation: 'SYNC',
      externalApiCall: true,
      provider,
      imported,
      skipped,
      unmappedCount: unmappedCodes.length,
    };
    await auditService.logAccess(RESOURCE_TYPE, undefined, { userId }, auditMeta);

    if (unmappedCodes.length > 0) {
      logger.info('FHIR sync encountered unmapped LOINC codes', {
        prefix: 'LabSync',
        data: { userId, provider, unmappedCodes },
      });
    }

    return { imported, skipped, unmappedCodes, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    await withRLSContext(userId, async (tx) => {
      await tx.labConnection.update({
        where: { id: connection.id },
        data: { syncStatus: 'error', syncError: msg.slice(0, 500) },
      });
    });
    await auditService.logAccess(RESOURCE_TYPE, undefined, { userId }, {
      operation: 'SYNC_FAILED',
      externalApiCall: true,
      provider,
      error: msg.slice(0, 200),
    });
    throw err;
  }
}

// ============================================
// Disconnect
// ============================================

export async function disconnectConnection(
  userId: string,
  connectionId: string
): Promise<void> {
  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  const connection = await withRLSContext(userId, async (tx) => {
    return tx.labConnection.findFirst({
      where: { id: connectionId, userId },
    });
  });
  if (!connection) {
    throw new Error('Connection not found');
  }

  // Best-effort token revocation — never blocks disconnect on failure.
  try {
    const encryption = getEncryptionService();
    const salt = await getUserEncryptionSalt(userId);
    const accessToken = encryption.decrypt(connection.accessTokenEncrypted, salt);
    const smart = await resolveEndpoints(smartConfigForProvider(connection.provider));
    await revokeToken(smart, accessToken, 'access_token');
  } catch (err) {
    logger.warn('Token revocation during disconnect failed (continuing)', {
      data: { userId, connectionId, error: err instanceof Error ? err.message : 'unknown' },
    });
  }

  await withRLSContext(userId, async (tx) => {
    await tx.labConnection.delete({ where: { id: connection.id } });
  });

  await auditService.logAccess(RESOURCE_TYPE, undefined, { userId }, {
    operation: 'DISCONNECT',
    externalApiCall: true,
    provider: connection.provider,
  });
}

/**
 * Called from the account-deletion flow so tokens get revoked before
 * the LabConnection cascade-deletes.
 */
export async function revokeAllUserConnections(userId: string): Promise<void> {
  const connections = await withRLSContext(userId, async (tx) => {
    return tx.labConnection.findMany({ where: { userId } });
  });
  for (const c of connections) {
    try {
      await disconnectConnection(userId, c.id);
    } catch (err) {
      logger.warn('Skipped disconnect during account deletion', {
        data: { connectionId: c.id, error: err instanceof Error ? err.message : 'unknown' },
      });
    }
  }
}

// ============================================
// Helpers
// ============================================

/** How many observation upserts to batch into one RLS transaction. Bounds the
 *  per-sync transaction count (was one txn per observation, up to ~2,000) while
 *  staying well under the 30s interactive-transaction window. */
const IMPORT_CHUNK_SIZE = 50;

interface PreparedReading {
  name: string;
  /** Direction for the out-of-range alert email; null when in range. */
  outOfRangeStatus: 'high' | 'low' | null;
  payload: Parameters<typeof upsertBiomarkerReading>[2];
}

/**
 * Prepare + import mapped FHIR observations into the user's biomarker series.
 *
 * Extracted from syncLabResults so the import semantics are unit-testable.
 * Preserves: value + stable-FHIR-id idempotency dedupe (incl. amendments via
 * status amended/corrected), unmapped-LOINC tracking, and per-observation error
 * tolerance — one failing observation must not abort the rest of the sync.
 *
 * Writes go through CHUNKED RLS transactions instead of one-per-observation; if
 * a chunk's transaction fails atomically (any statement aborts the whole tx),
 * its rows are retried individually so a single bad row only loses itself, not
 * the entire chunk — keeping the prior per-row failure isolation.
 */
export async function importObservations(
  userId: string,
  provider: string,
  observations: FHIRObservation[],
  existing: Array<{
    name: string;
    measurementDate: Date;
    valueEncrypted: string;
    sourceFile: string | null;
  }>,
  encryption: ReturnType<typeof getEncryptionService>,
  salt: string
): Promise<{
  imported: number;
  skipped: number;
  importedNames: string[];
  importedOutOfRange: Array<{ name: string; status: 'high' | 'low' }>;
  unmappedCodes: string[];
  errors: string[];
}> {
  const errors: string[] = [];
  const unmappedCodes: string[] = [];
  let skipped = 0;

  // Seed dedupe sets from existing rows. existingSourceFiles holds the STABLE
  // external FHIR id (`fhir:{provider}:{obs.id}`, stored unencrypted in
  // sourceFile) — the idempotency key, so a re-sync of an already-imported
  // observation is a true no-op and can't clobber a user's later edit.
  const existingKeys = new Set<string>();
  const existingSourceFiles = new Set<string>();
  for (const b of existing) {
    if (b.sourceFile) existingSourceFiles.add(b.sourceFile);
    try {
      existingKeys.add(dedupeKey(b.name, b.measurementDate, encryption.decrypt(b.valueEncrypted, salt)));
    } catch {
      // skip undecryptable rows — dedupe errs on the side of importing
    }
  }

  // PREPARE: map + dedupe + encrypt (no DB writes). Skips/unmapped tracked here.
  const prepared: PreparedReading[] = [];
  for (const obs of observations) {
    try {
      const row = mapObservation(obs);
      if (!row) {
        // Can't derive a value — skip (qualitative results etc. not yet supported).
        skipped++;
        continue;
      }

      // An amended/corrected result reuses the same id with a NEW value, so let
      // those through; the value-based check below no-ops one that didn't change.
      const obsIdentity = `fhir:${provider}:${obs.id}`;
      const isAmendment = obs.status === 'amended' || obs.status === 'corrected';
      if (existingSourceFiles.has(obsIdentity) && !isAmendment) {
        skipped++;
        continue;
      }

      if (row.unmapped && !unmappedCodes.includes(row.loincCode)) {
        unmappedCodes.push(row.loincCode);
      }
      const key = dedupeKey(row.name, row.measurementDate, String(row.value));
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      const valueEncrypted = encryption.encrypt(String(row.value), salt);
      const isOutOfRange =
        (row.normalRangeMin !== null && row.value < row.normalRangeMin) ||
        (row.normalRangeMax !== null && row.value > row.normalRangeMax);
      // Direction for the out-of-range alert email: above max = high, else low.
      const outOfRangeStatus: 'high' | 'low' | null = isOutOfRange
        ? (row.normalRangeMax !== null && row.value > row.normalRangeMax ? 'high' : 'low')
        : null;

      // Mark deduped now so an exact duplicate later in THIS batch is also skipped.
      existingKeys.add(key);
      existingSourceFiles.add(obsIdentity);

      prepared.push({
        name: row.name,
        outOfRangeStatus,
        payload: {
          category: row.category,
          name: row.name,
          unit: row.unit,
          valueEncrypted,
          normalRangeMin: row.normalRangeMin ?? 0,
          normalRangeMax: row.normalRangeMax ?? 0,
          normalRangeSource: `${provider.toUpperCase()} FHIR`,
          measurementDate: row.measurementDate,
          sourceType: 'API_IMPORT',
          sourceFile: obsIdentity,
          isOutOfRange,
        },
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message.slice(0, 200) : 'unknown');
      skipped++;
    }
  }

  // IMPORT: chunked transactions, with a per-row fallback so a chunk that fails
  // atomically doesn't drop every reading in it. Merging into the existing
  // series (upsertBiomarkerReading) lets synced labs accrue real history.
  let imported = 0;
  const importedNames: string[] = [];
  const importedOutOfRange: Array<{ name: string; status: 'high' | 'low' }> = [];
  const collectOutOfRange = (item: PreparedReading) => {
    if (item.outOfRangeStatus) {
      importedOutOfRange.push({ name: item.name, status: item.outOfRangeStatus });
    }
  };
  for (let i = 0; i < prepared.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = prepared.slice(i, i + IMPORT_CHUNK_SIZE);
    try {
      await withRLSTransaction(
        userId,
        async (tx) => {
          for (const item of chunk) {
            await upsertBiomarkerReading(tx, userId, item.payload);
          }
        },
        { timeout: 30_000, maxWait: 10_000 }
      );
      imported += chunk.length;
      for (const item of chunk) {
        importedNames.push(item.name);
        collectOutOfRange(item);
      }
    } catch {
      // Chunk tx failed (one bad row aborts the whole tx). Retry each reading in
      // its own tx so only the genuinely-bad row is dropped, not the chunk.
      for (const item of chunk) {
        try {
          await withRLSTransaction(userId, async (tx) => {
            await upsertBiomarkerReading(tx, userId, item.payload);
          });
          imported++;
          importedNames.push(item.name);
          collectOutOfRange(item);
        } catch (err) {
          errors.push(err instanceof Error ? err.message.slice(0, 200) : 'unknown');
          skipped++;
        }
      }
    }
  }

  return { imported, skipped, importedNames, importedOutOfRange, unmappedCodes, errors };
}

interface MappedObservation {
  name: string;
  category: string;
  unit: string;
  value: number;
  normalRangeMin: number | null;
  normalRangeMax: number | null;
  measurementDate: Date;
  loincCode: string;
  unmapped: boolean;
}

function mapObservation(obs: FHIRObservation): MappedObservation | null {
  // Only handle numeric quantity observations for now. Qualitative
  // results (valueString / valueCodeableConcept) are skipped — mapping
  // them cleanly requires per-code logic.
  if (!obs.valueQuantity?.value && obs.valueQuantity?.value !== 0) return null;

  const loinc = extractLOINCCoding(obs.code);
  if (!loinc) return null;

  const mapping = findLOINCMapping(obs.code);
  // FHIR responses are untrusted input. Clamp + strip control chars/newlines
  // on the display name (100) and unit (20) for parity with the manual-entry
  // Zod bounds (sanitizedString(1,100) / sanitizedString(1,20)) before we
  // persist them. Our own mapping table values are already clean; FHIR-derived
  // fallbacks (loinc.display, valueQuantity.unit) are not.
  const name = sanitizeFhirText(mapping?.biomarkerName ?? loinc.display, 100);
  const category = mapping?.category ?? 'Other';
  const unit = sanitizeFhirText(obs.valueQuantity.unit ?? mapping?.defaultUnit ?? '', 20);
  const value = obs.valueQuantity.value;

  const refRange = obs.referenceRange?.[0];
  const normalRangeMin =
    refRange?.low?.value !== undefined ? refRange.low.value : null;
  const normalRangeMax =
    refRange?.high?.value !== undefined ? refRange.high.value : null;

  const dateStr = obs.effectiveDateTime ?? obs.issued;
  const measurementDate = dateStr ? new Date(dateStr) : new Date();

  return {
    name,
    category,
    unit,
    value,
    normalRangeMin,
    normalRangeMax,
    measurementDate,
    loincCode: loinc.code,
    unmapped: !mapping,
  };
}

/**
 * Sanitize a FHIR-supplied free-text field before persisting. Strips control
 * characters and newlines, collapses runs of whitespace, trims, and hard-caps
 * the length. FHIR server responses are untrusted, so display name / unit get
 * the same treatment manual entry does (Zod sanitizedString bounds).
 */
function sanitizeFhirText(input: string, maxLength: number): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '') // strip control chars + newlines/tabs
    .replace(/\s+/g, ' ') // collapse remaining whitespace runs
    .trim()
    .slice(0, maxLength);
}

function dedupeKey(name: string, date: Date, value: string): string {
  // Dates normalize to YYYY-MM-DD so a FHIR datetime and a manually
  // entered date on the same day match.
  const day = new Date(date).toISOString().split('T')[0];
  return `${name.toLowerCase()}|${day}|${value}`;
}
