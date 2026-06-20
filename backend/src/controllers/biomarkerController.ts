/**
 * Biomarker Controller
 *
 * Handles CRUD operations for biomarkers with PHI encryption.
 * All biomarker values and notes are encrypted at rest.
 * All PHI access is logged for HIPAA compliance.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import type { BiomarkerCreateInput, BiomarkerUpdateInput } from '../middleware/validation.js';
import { getPrismaClient, withRLSTransaction } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import {
  upsertBiomarkerReading,
  type BiomarkerReadingInput,
  type BiomarkerWithHistory,
} from '../services/biomarkerSeries.js';
import { parsePagination, parseStringParam, createPaginationMeta } from '../utils/queryHelpers.js';
import { toNumber } from '../utils/numberConversion.js';
import { logger } from '../utils/logger.js';
import type { Biomarker as PrismaBiomarker, DataSourceType } from '../../generated/prisma/index.js';

const RESOURCE_TYPE = 'Biomarker';

/**
 * DECRYPT SAFETY (M-7): wrap an inline decrypt so a single corrupt or
 * key-mismatched field returns null and logs at warn instead of throwing and
 * rejecting the whole list/response. Mirrors the null-on-failure behavior of
 * encryption.decryptFields, but usable in the per-row/per-field hot paths here
 * where the decrypted value is immediately parsed/coerced. Returns null on any
 * failure so the rest of the row (and the rest of the list) still renders.
 */
function tryDecrypt(
  encryption: ReturnType<typeof getEncryptionService>,
  value: string | null | undefined,
  userSalt: string,
  field: string
): string | null {
  if (!value) return null;
  try {
    return encryption.decrypt(value, userSalt);
  } catch (err) {
    logger.warn(`Failed to decrypt biomarker field: ${field}`, {
      data: { error: err instanceof Error ? err.message : 'Unknown' },
    });
    return null;
  }
}

const VALID_SOURCE_TYPES: readonly DataSourceType[] = [
  'MANUAL',
  'LAB_UPLOAD',
  'EHR_IMPORT',
  'DEVICE_SYNC',
  'API_IMPORT',
];

// Response type for biomarkers (with decrypted values)
interface BiomarkerResponse {
  id: string;
  userId: string;
  category: string;
  name: string;
  unit: string;
  value: number;
  notes?: string;
  normalRange: {
    min: number;
    max: number;
    source?: string;
  };
  date: string;
  sourceType: string;
  sourceFile?: string;
  extractionConfidence?: number;
  labName?: string;
  isOutOfRange: boolean;
  isAcknowledged: boolean;
  history: { date: string; value: number }[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Converts a Prisma Biomarker to response format with decrypted values
 */
/**
 * How many of the most-recent history points to embed per biomarker in the
 * LIST / category view. The TrendSparkline only renders a recent window; the
 * full series is served by the dedicated date-bounded history endpoint. Bounding
 * this caps the per-request AES-decrypt + payload at ~N points per biomarker
 * instead of every historical reading (read-amplification for long-tenured users).
 */
const BIOMARKER_LIST_HISTORY_WINDOW = 30;

async function toResponse(
  biomarker: PrismaBiomarker & { history?: { measurementDate: Date; valueEncrypted: string }[] },
  userSalt: string
): Promise<BiomarkerResponse> {
  const encryptionService = getEncryptionService();

  // Decrypt value and notes. tryDecrypt returns null (and logs at warn) on a
  // corrupt/key-mismatched field so one bad row can't throw the whole list.
  const decryptedValue = tryDecrypt(encryptionService, biomarker.valueEncrypted, userSalt, 'valueEncrypted');
  const decryptedNotes = biomarker.notesEncrypted
    ? tryDecrypt(encryptionService, biomarker.notesEncrypted, userSalt, 'notesEncrypted') ?? undefined
    : undefined;

  // Decrypt history values (failed decrypts surface as NaN rather than throwing)
  const history = biomarker.history
    ? await Promise.all(
        biomarker.history.map(async (h) => ({
          date: h.measurementDate.toISOString().split('T')[0],
          value: parseFloat(tryDecrypt(encryptionService, h.valueEncrypted, userSalt, 'history.valueEncrypted') ?? ''),
        }))
      )
    : [];

  return {
    id: biomarker.id,
    userId: biomarker.userId,
    category: biomarker.category,
    name: biomarker.name,
    unit: biomarker.unit,
    value: parseFloat(decryptedValue ?? ''),
    notes: decryptedNotes,
    normalRange: {
      min: toNumber(biomarker.normalRangeMin),
      max: toNumber(biomarker.normalRangeMax),
      source: biomarker.normalRangeSource ?? undefined,
    },
    date: biomarker.measurementDate.toISOString().split('T')[0],
    sourceType: biomarker.sourceType,
    sourceFile: biomarker.sourceFile ?? undefined,
    extractionConfidence: biomarker.extractionConfidence
      ? toNumber(biomarker.extractionConfidence)
      : undefined,
    labName: biomarker.labName ?? undefined,
    isOutOfRange: biomarker.isOutOfRange,
    isAcknowledged: biomarker.isAcknowledged,
    history,
    createdAt: biomarker.createdAt,
    updatedAt: biomarker.updatedAt,
  };
}

// Get all biomarkers for authenticated user
export async function getBiomarkers(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const startTime = Date.now();
  const userId = req.user!.id;
  const { category, page, limit } = req.query;

  const prisma = getPrismaClient();

  const saltStart = Date.now();
  const userSalt = await getUserEncryptionSalt(userId);
  const saltTime = Date.now() - saltStart;

  // Parse pagination using query helper
  const pagination = parsePagination(page, limit, { defaultLimit: 50 });
  const categoryFilter = parseStringParam(category);

  // Build where clause
  const where: { userId: string; category?: string } = { userId };
  if (categoryFilter) {
    where.category = categoryFilter;
  }

  // Get total count and paginated biomarkers with history via RLS transaction
  const countStart = Date.now();
  const { total, biomarkers } = await withRLSTransaction(userId, async (tx) => {
    const total = await tx.biomarker.count({ where });
    const biomarkers = await tx.biomarker.findMany({
      where,
      // Window each series to the most recent N points — embedding EVERY
      // historical reading per biomarker and AES-decrypting each one is the
      // dominant cost of this list endpoint for long-tenured users, and the
      // category-view TrendSparkline only needs a recent window. Full series are
      // served by the dedicated date-bounded history endpoint. Fetch newest-first
      // + take, then re-sort ascending below so trend math (history[0] = oldest)
      // stays order-independent.
      include: { history: { orderBy: { measurementDate: 'desc' }, take: BIOMARKER_LIST_HISTORY_WINDOW } },
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { measurementDate: 'desc' },
    });
    // Re-sort each windowed history ascending (we fetched newest-first to grab
    // the most recent N). toResponse + the frontend expect oldest-first.
    for (const b of biomarkers) {
      if (b.history) b.history.reverse();
    }
    return { total, biomarkers };
  });
  const queryTime = Date.now() - countStart;

  // Decrypt all biomarkers with higher concurrency for better performance
  const decryptStart = Date.now();
  const decryptedBiomarkers = await Promise.all(
    biomarkers.map((b) => toResponse(b, userSalt))
  );
  const decryptTime = Date.now() - decryptStart;

  // Audit log: READ access to biomarker list
  const auditStart = Date.now();
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'LIST',
    count: biomarkers.length,
    category: categoryFilter || 'all',
  });
  const auditTime = Date.now() - auditStart;

  const totalTime = Date.now() - startTime;
  logger.info('getBiomarkers timing', {
    data: {
      userId,
      count: biomarkers.length,
      total,
      saltTime,
      queryTime,
      decryptTime,
      auditTime,
      totalTime,
      avgDecryptPerRecord: biomarkers.length > 0 ? Math.round(decryptTime / biomarkers.length) : 0,
    },
  });

  const response: ApiResponse<BiomarkerResponse[]> = {
    success: true,
    data: decryptedBiomarkers,
    pagination: createPaginationMeta(total, pagination),
  };

  res.json(response);
}

// Get single biomarker by ID
export async function getBiomarker(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  const biomarker = await withRLSTransaction(userId, async (tx) => {
    return tx.biomarker.findFirst({
      where: { id, userId },
      // Oldest-first so trend math (history[0] = oldest) is order-independent.
      include: { history: { orderBy: { measurementDate: 'asc' } } },
    });
  });

  if (!biomarker) {
    throw new NotFoundError('Biomarker not found');
  }

  // Audit log: READ access to single biomarker
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, id, { req, userId });

  const response: ApiResponse<BiomarkerResponse> = {
    success: true,
    data: await toResponse(biomarker, userSalt),
  };

  res.json(response);
}

// Create new biomarker
export async function createBiomarker(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const input: BiomarkerCreateInput = req.body;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Encrypt PHI fields
  const valueEncrypted = encryptionService.encrypt(String(input.value), userSalt);
  const notesEncrypted = input.notes
    ? encryptionService.encrypt(input.notes, userSalt)
    : null;

  // Determine if out of range
  const isOutOfRange =
    input.value < input.normalRange.min || input.value > input.normalRange.max;

  // Append to the existing series for (name, unit) instead of inserting a
  // disconnected row, so trends accrue over time. See services/biomarkerSeries.
  const { biomarker, outcome } = await withRLSTransaction(userId, async (tx) => {
    return upsertBiomarkerReading(tx, userId, {
      category: input.category,
      name: input.name,
      unit: input.unit,
      valueEncrypted,
      notesEncrypted,
      normalRangeMin: input.normalRange.min,
      normalRangeMax: input.normalRange.max,
      normalRangeSource: input.normalRange.source,
      measurementDate: new Date(input.date),
      sourceType: input.sourceType || 'MANUAL',
      sourceFile: input.sourceFile,
      extractionConfidence: input.extractionConfidence,
      labName: input.labName,
      isOutOfRange,
    });
  });

  // Audit log: CREATE biomarker (a new reading is a PHI write regardless of
  // whether it created a new series or appended to an existing one).
  const auditService = getAuditLogService(prisma);
  await auditService.logCreate(RESOURCE_TYPE, biomarker.id, {
    name: input.name,
    category: input.category,
    value: input.value,
    seriesOutcome: outcome,
  }, { req, userId });

  const response: ApiResponse<BiomarkerResponse> = {
    success: true,
    data: await toResponse(biomarker, userSalt),
  };

  // 201 when a new series was created; 200 when the reading merged into an
  // existing series (no new resource URI minted).
  res.status(outcome === 'created' ? 201 : 200).json(response);
}

// Update biomarker
export async function updateBiomarker(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const input: BiomarkerUpdateInput = req.body;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  const { existing, updated } = await withRLSTransaction(userId, async (tx) => {
    // Find existing biomarker
    const existing = await tx.biomarker.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError('Biomarker not found');
    }

    // If value is changing, save current value to history
    if (input.value !== undefined) {
      const currentValue = encryptionService.decrypt(existing.valueEncrypted, userSalt);
      if (String(input.value) !== currentValue) {
        await tx.biomarkerHistory.create({
          data: {
            biomarkerId: id,
            valueEncrypted: existing.valueEncrypted,
            measurementDate: existing.measurementDate,
          },
        });
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (input.value !== undefined) {
      updateData.valueEncrypted = encryptionService.encrypt(String(input.value), userSalt);
    }
    if (input.notes !== undefined) {
      updateData.notesEncrypted = input.notes
        ? encryptionService.encrypt(input.notes, userSalt)
        : null;
    }
    if (input.category !== undefined) updateData.category = input.category;
    if (input.name !== undefined) updateData.name = input.name;
    if (input.unit !== undefined) updateData.unit = input.unit;
    if (input.date !== undefined) updateData.measurementDate = new Date(input.date);
    if (input.normalRange?.min !== undefined) updateData.normalRangeMin = input.normalRange.min;
    if (input.normalRange?.max !== undefined) updateData.normalRangeMax = input.normalRange.max;
    if (input.normalRange?.source !== undefined) updateData.normalRangeSource = input.normalRange.source;
    if (input.labName !== undefined) updateData.labName = input.labName;

    // Recalculate isOutOfRange if value or range changed
    if (input.value !== undefined || input.normalRange?.min !== undefined || input.normalRange?.max !== undefined) {
      const newValue = input.value ?? parseFloat(encryptionService.decrypt(existing.valueEncrypted, userSalt));
      const newMin = input.normalRange?.min ?? toNumber(existing.normalRangeMin);
      const newMax = input.normalRange?.max ?? toNumber(existing.normalRangeMax);
      updateData.isOutOfRange = newValue < newMin || newValue > newMax;
    }

    const updated = await tx.biomarker.update({
      where: { id },
      data: updateData,
      include: { history: true },
    });

    return { existing, updated };
  });

  // Audit log: UPDATE biomarker
  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate(RESOURCE_TYPE, id, {
    name: existing.name,
    category: existing.category,
  }, {
    name: updated.name,
    category: updated.category,
    fieldsUpdated: Object.keys(input),
  }, { req, userId });

  const response: ApiResponse<BiomarkerResponse> = {
    success: true,
    data: await toResponse(updated, userSalt),
  };

  res.json(response);
}

// Delete biomarker
export async function deleteBiomarker(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  const biomarker = await withRLSTransaction(userId, async (tx) => {
    const biomarker = await tx.biomarker.findFirst({
      where: { id, userId },
    });

    if (!biomarker) {
      throw new NotFoundError('Biomarker not found');
    }

    // Delete biomarker (history will cascade delete)
    await tx.biomarker.delete({
      where: { id },
    });

    return biomarker;
  });

  // Audit log: DELETE biomarker (log after deletion, using returned data)
  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE, id, {
    name: biomarker.name,
    category: biomarker.category,
  }, { req, userId });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

// Get biomarker categories for user
export async function getCategories(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();

  const biomarkers = await withRLSTransaction(userId, async (tx) => {
    return tx.biomarker.findMany({
      where: { userId },
      select: { category: true },
      distinct: ['category'],
    });
  });

  const categories = biomarkers.map((b) => b.category);

  // Audit log: READ access to biomarker categories
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'CATEGORIES',
    count: categories.length,
  });

  const response: ApiResponse<string[]> = {
    success: true,
    data: categories,
  };

  res.json(response);
}

// Bulk create biomarkers (for file upload)
// PERFORMANCE: Uses createMany for O(1) database operations instead of O(n)
// ERROR HANDLING: Reports succeeded and failed items
export async function bulkCreateBiomarkers(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const inputs: BiomarkerCreateInput[] = req.body.biomarkers;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  // Track succeeded and failed items
  const failedItems: { index: number; name: string; error: string }[] = [];
  const validReadings: BiomarkerReadingInput[] = [];

  // Prepare and validate each biomarker
  inputs.forEach((input, index) => {
    try {
      if (!input.name || !input.category || !input.unit) {
        throw new Error('Missing required fields: name, category, or unit');
      }
      if (typeof input.value !== 'number' || isNaN(input.value)) {
        throw new Error(`Invalid value: ${input.value}`);
      }
      // Presence/finiteness check — NOT truthiness. A normal-range bound of 0
      // is common in lab reference ranges (e.g. 0–x); the old `!min || !max`
      // check silently dropped those legitimate rows.
      if (
        input.normalRange?.min === undefined ||
        input.normalRange?.max === undefined ||
        !Number.isFinite(input.normalRange.min) ||
        !Number.isFinite(input.normalRange.max)
      ) {
        throw new Error('Missing normal range min/max');
      }

      const sourceType: DataSourceType = VALID_SOURCE_TYPES.includes(input.sourceType as DataSourceType)
        ? (input.sourceType as DataSourceType)
        : 'MANUAL';

      validReadings.push({
        category: input.category,
        name: input.name,
        unit: input.unit,
        valueEncrypted: encryptionService.encrypt(String(input.value), userSalt),
        notesEncrypted: input.notes ? encryptionService.encrypt(input.notes, userSalt) : null,
        normalRangeMin: input.normalRange.min,
        normalRangeMax: input.normalRange.max,
        normalRangeSource: input.normalRange.source,
        measurementDate: new Date(input.date),
        sourceType,
        sourceFile: input.sourceFile,
        extractionConfidence: input.extractionConfidence,
        labName: input.labName,
        isOutOfRange: input.value < input.normalRange.min || input.value > input.normalRange.max,
      });
    } catch (error) {
      failedItems.push({
        index,
        name: input.name || `Item ${index}`,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // If no valid items, return error with proper error object format.
  // NOTE: `error.details` is reserved by the ApiResponse contract for
  // ValidationError field errors. These per-item failures are app-level
  // exception strings, not field errors, so they go in `meta.failedItems`.
  if (validReadings.length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'All biomarkers failed validation',
      },
      meta: {
        total: inputs.length,
        succeeded: 0,
        failed: failedItems.length,
        failedItems,
      },
    });
    return;
  }

  // Merge each reading into its series within a single RLS transaction. A later
  // reading sees rows written by an earlier one, so multiple points of the same
  // metric in one batch collapse into one growing series regardless of order.
  // This trades the old O(1) createMany for up to ~100 sequential upserts (the
  // batch cap) — acceptable for an infrequent upload and required for correct
  // series accrual (the createMany path produced disconnected single-point rows).
  let affected: Map<string, BiomarkerWithHistory>;
  try {
    affected = await withRLSTransaction(
      userId,
      async (tx) => {
        const byId = new Map<string, BiomarkerWithHistory>();
        for (const reading of validReadings) {
          const { biomarker } = await upsertBiomarkerReading(tx, userId, reading);
          // The last upsert touching a given series returns its final state.
          byId.set(biomarker.id, biomarker);
        }
        // L41: write the bulk CREATE audit INSIDE the tx with `tx` threaded, so it
        // commits atomically with the biomarker writes. Previously this ran AFTER
        // the tx with no tx — a failed (failClosed) audit threw a 500 once the PHI
        // rows were already committed, leaving persisted biomarkers with no audit
        // trail. Now an audit failure rolls the whole batch back.
        await auditService.logCreate(RESOURCE_TYPE, 'BULK', {
          count: validReadings.length,
          seriesAffected: byId.size,
          categories: [...new Set(validReadings.map(r => r.category))],
          names: validReadings.map(r => r.name),
          failedCount: failedItems.length,
        }, { req, userId, tx });
        return byId;
      },
      // Up to ~100 sequential upserts in one tx — extend past Prisma's 5s default.
      { timeout: 30_000, maxWait: 10_000 }
    );
  } catch (dbError) {
    // SECURITY: Log actual error server-side but don't expose to user
    // Raw DB errors can reveal table names, constraints, and schema details
    logger.error('Batch biomarker creation failed', {
      data: {
        userId,
        count: validReadings.length,
        error: dbError instanceof Error ? dbError.message : 'Unknown database error',
      },
    });

    // NOTE: `error.details` is reserved by the ApiResponse contract for
    // ValidationError field errors. The per-item breakdown here is operational
    // (a batch DB failure), not field-validation, so it goes in `meta`.
    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to create biomarkers',
      },
      meta: {
        total: inputs.length,
        succeeded: 0,
        failed: inputs.length,
        failedItems: validReadings.map((r, i) => ({
          index: i,
          name: r.name,
          error: 'Database operation failed',
        })),
      },
    });
    return;
  }

  // One row per affected series (several readings may merge into one series).
  // The bulk CREATE audit was written inside the transaction above (L41).
  const createdBiomarkers = await Promise.all(
    Array.from(affected.values()).map(b => toResponse(b, userSalt))
  );

  // Determine response status - partial success returns 207
  const statusCode = failedItems.length > 0 ? 207 : 201;

  const response: ApiResponse<BiomarkerResponse[]> = {
    success: failedItems.length === 0,
    // `succeeded` counts readings persisted; `data` may have fewer rows because
    // readings of the same metric merge into a single series.
    data: createdBiomarkers,
    meta: {
      total: inputs.length,
      succeeded: validReadings.length,
      seriesAffected: affected.size,
      failed: failedItems.length,
      ...(failedItems.length > 0 && { failedItems }),
    },
  };

  res.status(statusCode).json(response);
}

// Response type for summary endpoint
interface BiomarkerSummaryResponse {
  totalBiomarkers: number;
  inRangeCount: number;
  outOfRangeCount: number;
  acknowledgedCount: number;
  byCategory: {
    category: string;
    total: number;
    inRange: number;
    outOfRange: number;
  }[];
  recentlyUpdated: number;
  lastUpdatedAt?: string;
}

// Response type for history endpoint
interface BiomarkerHistoryEntry {
  date: string;
  value: number;
  isOutOfRange: boolean;
}

interface BiomarkerHistoryResponse {
  biomarkerId: string;
  name: string;
  category: string;
  unit: string;
  normalRange: {
    min: number;
    max: number;
  };
  currentValue: number;
  history: BiomarkerHistoryEntry[];
}

/**
 * Get biomarker summary statistics for the user
 * Returns counts by category, in-range vs out-of-range stats
 */
export async function getSummary(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();

  // Get all biomarkers for the user (we don't need decryption for summary stats)
  const biomarkers = await withRLSTransaction(userId, async (tx) => {
    return tx.biomarker.findMany({
      where: { userId },
      select: {
        id: true,
        category: true,
        isOutOfRange: true,
        isAcknowledged: true,
        updatedAt: true,
      },
    });
  });

  // Calculate totals
  const totalBiomarkers = biomarkers.length;
  const outOfRangeCount = biomarkers.filter((b) => b.isOutOfRange).length;
  const inRangeCount = totalBiomarkers - outOfRangeCount;
  const acknowledgedCount = biomarkers.filter((b) => b.isAcknowledged).length;

  // Count by category
  const categoryMap = new Map<string, { total: number; inRange: number; outOfRange: number }>();
  for (const biomarker of biomarkers) {
    const existing = categoryMap.get(biomarker.category) || { total: 0, inRange: 0, outOfRange: 0 };
    existing.total++;
    if (biomarker.isOutOfRange) {
      existing.outOfRange++;
    } else {
      existing.inRange++;
    }
    categoryMap.set(biomarker.category, existing);
  }

  const byCategory = Array.from(categoryMap.entries()).map(([category, stats]) => ({
    category,
    ...stats,
  })).sort((a, b) => b.total - a.total);

  // Count recently updated (within last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentlyUpdated = biomarkers.filter((b) => b.updatedAt >= thirtyDaysAgo).length;

  // Find most recent update
  const lastUpdatedAt = biomarkers.length > 0
    ? biomarkers.reduce((latest, b) => (b.updatedAt > latest ? b.updatedAt : latest), biomarkers[0].updatedAt).toISOString()
    : undefined;

  // Audit log: READ access to summary
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'SUMMARY',
  });

  const summary: BiomarkerSummaryResponse = {
    totalBiomarkers,
    inRangeCount,
    outOfRangeCount,
    acknowledgedCount,
    byCategory,
    recentlyUpdated,
    lastUpdatedAt,
  };

  const response: ApiResponse<BiomarkerSummaryResponse> = {
    success: true,
    data: summary,
  };

  res.json(response);
}

/**
 * Get historical values for a specific biomarker
 * Returns the current value and historical values over time
 * PERFORMANCE: Added date range filter with default of 90 days to limit data
 *
 * Query params:
 * - startDate: ISO date string (default: 90 days ago)
 * - endDate: ISO date string (default: today)
 * - limit: max entries (default: 100, max: 1000)
 */
export async function getHistory(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const { startDate, endDate, limit = '100' } = req.query;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Parse date range (default: last 90 days)
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 90);

  const dateStart = startDate ? new Date(startDate as string) : defaultStart;
  const dateEnd = endDate ? new Date(endDate as string) : now;
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit as string, 10) || 100));

  // Get the biomarker with filtered history
  const biomarker = await withRLSTransaction(userId, async (tx) => {
    return tx.biomarker.findFirst({
      where: { id, userId },
      include: {
        history: {
          where: {
            measurementDate: {
              gte: dateStart,
              lte: dateEnd,
            },
          },
          orderBy: { measurementDate: 'asc' },
          take: limitNum,
        },
      },
    });
  });

  if (!biomarker) {
    throw new NotFoundError('Biomarker not found');
  }

  const normalRangeMin = toNumber(biomarker.normalRangeMin);
  const normalRangeMax = toNumber(biomarker.normalRangeMax);

  // Decrypt current value (null-on-failure so a single bad row can't 500 the request)
  const currentValue = parseFloat(
    tryDecrypt(encryptionService, biomarker.valueEncrypted, userSalt, 'valueEncrypted') ?? ''
  );

  // Build history entries from historical records
  const historyEntries: BiomarkerHistoryEntry[] = biomarker.history.map((h) => {
    const value = parseFloat(
      tryDecrypt(encryptionService, h.valueEncrypted, userSalt, 'history.valueEncrypted') ?? ''
    );
    return {
      date: h.measurementDate.toISOString().split('T')[0],
      value,
      isOutOfRange: value < normalRangeMin || value > normalRangeMax,
    };
  });

  // Add the current value as the latest entry (if within date range)
  const currentMeasurementDate = biomarker.measurementDate;
  if (currentMeasurementDate >= dateStart && currentMeasurementDate <= dateEnd) {
    historyEntries.push({
      date: currentMeasurementDate.toISOString().split('T')[0],
      value: currentValue,
      isOutOfRange: biomarker.isOutOfRange,
    });
  }

  // Audit log: READ access to biomarker history
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, id, { req, userId }, {
    operation: 'HISTORY',
    count: historyEntries.length,
    dateRangeStart: dateStart.toISOString(),
    dateRangeEnd: dateEnd.toISOString(),
  });

  const historyResponse: BiomarkerHistoryResponse = {
    biomarkerId: biomarker.id,
    name: biomarker.name,
    category: biomarker.category,
    unit: biomarker.unit,
    normalRange: {
      min: normalRangeMin,
      max: normalRangeMax,
    },
    currentValue,
    history: historyEntries,
  };

  const response: ApiResponse<BiomarkerHistoryResponse> = {
    success: true,
    data: historyResponse,
  };

  res.json(response);
}

/**
 * Gets biomarkers with decrypted values for internal use (e.g., health analysis)
 * This is used by healthController for analysis
 * PERFORMANCE: Limits history to last 90 days, max 100 entries per biomarker
 */
export async function getDecryptedBiomarkersForUser(userId: string): Promise<BiomarkerResponse[]> {
  const userSalt = await getUserEncryptionSalt(userId);

  // Calculate date 90 days ago
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const biomarkers = await withRLSTransaction(userId, async (tx) => {
    return tx.biomarker.findMany({
      where: { userId },
      include: {
        history: {
          where: {
            measurementDate: { gte: ninetyDaysAgo },
          },
          orderBy: { measurementDate: 'desc' },
          take: 100,
        },
      },
    });
  });

  return Promise.all(biomarkers.map((b) => toResponse(b, userSalt)));
}
