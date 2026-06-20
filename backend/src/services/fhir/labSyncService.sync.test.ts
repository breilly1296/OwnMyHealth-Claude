/**
 * syncLabResults dedup/idempotency tests (FHIR same-day-dedupe / edit-clobber fix
 * + no-history regression guard).
 *
 * Drives the real sync loop with mocked module boundaries (FHIR client, DB,
 * crypto, audit) so we can assert WHICH observations reach the insert path.
 *
 * Key behaviors:
 *  - an already-imported observation (by FHIR Observation.id, stored in
 *    sourceFile) is skipped on re-sync — so a user's later edit isn't clobbered;
 *  - a brand-new observation is imported via upsertBiomarkerReading (NOT a bare
 *    create — pins that FHIR import accrues a time series, per PR #143);
 *  - an amended/corrected observation reusing the same id IS reprocessed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LOINC_SYSTEM } from './types.js';

const mocks = vi.hoisted(() => ({
  observations: [] as unknown[],
  existingBiomarkers: [] as Array<Record<string, unknown>>,
  upsert: vi.fn(async () => ({ id: 'b-new' })),
  logCreate: vi.fn(),
  logAccess: vi.fn(),
  notifyNewResults: vi.fn(),
  notifyOutOfRange: vi.fn(),
  tx: {
    labConnection: { findUnique: vi.fn(), update: vi.fn() },
    biomarker: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('../database.js', () => ({
  getPrismaClient: () => ({}),
  withRLSContext: (_userId: string, fn: (tx: unknown) => unknown) => fn(mocks.tx),
  withRLSTransaction: (_userId: string, fn: (tx: unknown) => unknown) => fn(mocks.tx),
}));
vi.mock('../encryption.js', () => ({
  getEncryptionService: () => ({ encrypt: (v: string) => v, decrypt: (v: string) => v }),
}));
vi.mock('../userEncryption.js', () => ({ getUserEncryptionSalt: vi.fn(async () => 'salt') }));
vi.mock('../auditLog.js', () => ({
  getAuditLogService: () => ({ logCreate: mocks.logCreate, logAccess: mocks.logAccess }),
}));
vi.mock('../biomarkerSeries.js', () => ({ upsertBiomarkerReading: mocks.upsert }));
vi.mock('../notificationService.js', () => ({
  notifyNewResults: mocks.notifyNewResults,
  notifyOutOfRange: mocks.notifyOutOfRange,
}));
vi.mock('../../config/index.js', () => ({
  config: {
    quest: {
      clientId: 'cid',
      clientSecret: '',
      redirectUri: 'http://r',
      fhirBaseUrl: 'http://fhir',
      authHosts: [],
    },
  },
}));
vi.mock('./smartAuth.js', () => ({
  discoverEndpoints: vi.fn(),
  refreshAccessToken: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  stashChallenge: vi.fn(),
  consumeChallenge: vi.fn(),
  generatePKCE: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  revokeToken: vi.fn(),
}));
vi.mock('./fhirClient.js', () => ({
  FHIRClient: class {
    async getLabResults() {
      return mocks.observations;
    }
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { syncLabResults } from './labSyncService.js';

function chol(id: string, status: string, value: number) {
  return {
    resourceType: 'Observation',
    id,
    status,
    code: { coding: [{ system: LOINC_SYSTEM, code: '2093-3', display: 'Cholesterol' }] },
    valueQuantity: { value, unit: 'mg/dL' },
    effectiveDateTime: '2026-03-10T00:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.observations = [];
  mocks.existingBiomarkers = [];
  mocks.tx.labConnection.findUnique.mockImplementation(async () => ({
    id: 'c1',
    isActive: true,
    provider: 'quest',
    accessTokenEncrypted: 'a',
    refreshTokenEncrypted: 'r',
    tokenExpiresAt: new Date(Date.now() + 3_600_000), // future → no refresh path
    fhirPatientId: 'pat1',
    lastSyncAt: new Date('2026-03-10T00:00:00Z'),
  }));
  mocks.tx.labConnection.update.mockResolvedValue(undefined);
  mocks.tx.biomarker.findMany.mockImplementation(async () => mocks.existingBiomarkers);
});

describe('syncLabResults — FHIR Observation.id idempotency', () => {
  it('skips an already-imported observation on re-sync (does not clobber a later edit)', async () => {
    // The user edited the imported reading to 175; the original obs is re-fetched.
    mocks.existingBiomarkers = [
      {
        id: 'b1',
        name: 'Total Cholesterol',
        measurementDate: new Date('2026-03-10'),
        valueEncrypted: '175', // edited value (decrypt is identity in this mock)
        sourceFile: 'fhir:quest:obs-1',
      },
    ];
    mocks.observations = [chol('obs-1', 'final', 190)]; // original FHIR value

    const result = await syncLabResults('u1', 'quest');

    expect(mocks.upsert).not.toHaveBeenCalled(); // edit preserved, no overwrite
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('imports a brand-new observation via upsertBiomarkerReading (history-accruing, not a bare create)', async () => {
    mocks.existingBiomarkers = [];
    mocks.observations = [chol('obs-2', 'final', 200)];

    const result = await syncLabResults('u1', 'quest');

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.tx.biomarker.create).not.toHaveBeenCalled(); // PR #143: never a disconnected row
    expect(result.imported).toBe(1);
    // The insert carries the stable FHIR identity for future idempotency.
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ sourceFile: 'fhir:quest:obs-2', sourceType: 'API_IMPORT' })
    );
  });

  it('reprocesses an amended observation that reuses the same id with a new value', async () => {
    mocks.existingBiomarkers = [
      {
        id: 'b1',
        name: 'Total Cholesterol',
        measurementDate: new Date('2026-03-10'),
        valueEncrypted: '190',
        sourceFile: 'fhir:quest:obs-1',
      },
    ];
    mocks.observations = [chol('obs-1', 'amended', 210)]; // lab corrected the value

    const result = await syncLabResults('u1', 'quest');

    expect(mocks.upsert).toHaveBeenCalledTimes(1); // amendment honored, not skipped
    expect(result.imported).toBe(1);
  });

  it('an unchanged amendment (same value) still no-ops via the value check', async () => {
    mocks.existingBiomarkers = [
      {
        id: 'b1',
        name: 'Total Cholesterol',
        measurementDate: new Date('2026-03-10'),
        valueEncrypted: '190',
        sourceFile: 'fhir:quest:obs-1',
      },
    ];
    mocks.observations = [chol('obs-1', 'amended', 190)]; // amended status but value identical

    const result = await syncLabResults('u1', 'quest');

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe('syncLabResults — engagement notifications (FHIR parity with PDF upload)', () => {
  // A Cholesterol obs carrying a reference range; mapObservation reads it, so a
  // value above the high is imported AND flagged out-of-range.
  const cholWithRange = (id: string, value: number, low: number, high: number) => ({
    ...chol(id, 'final', value),
    referenceRange: [{ low: { value: low }, high: { value: high } }],
  });

  it('emails new-results + out-of-range when an out-of-range reading is imported', async () => {
    mocks.existingBiomarkers = [];
    mocks.observations = [cholWithRange('obs-hi', 240, 0, 200)]; // 240 > 200 → high

    const result = await syncLabResults('u1', 'quest');

    expect(result.imported).toBe(1);
    expect(mocks.notifyNewResults).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ biomarkerCount: 1, outOfRangeCount: 1, labName: 'QUEST FHIR' })
    );
    expect(mocks.notifyOutOfRange).toHaveBeenCalledWith('u1', {
      biomarkers: [{ name: 'Total Cholesterol', status: 'high' }],
    });
  });

  it('fires new-results but NOT out-of-range for an in-range import', async () => {
    mocks.existingBiomarkers = [];
    mocks.observations = [cholWithRange('obs-ok', 150, 0, 200)]; // within range

    const result = await syncLabResults('u1', 'quest');

    expect(result.imported).toBe(1);
    expect(mocks.notifyNewResults).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ biomarkerCount: 1, outOfRangeCount: 0 })
    );
    expect(mocks.notifyOutOfRange).not.toHaveBeenCalled();
  });

  it('sends no emails when nothing is imported', async () => {
    mocks.existingBiomarkers = [];
    mocks.observations = [];

    const result = await syncLabResults('u1', 'quest');

    expect(result.imported).toBe(0);
    expect(mocks.notifyNewResults).not.toHaveBeenCalled();
    expect(mocks.notifyOutOfRange).not.toHaveBeenCalled();
  });
});
