/**
 * importObservations — FHIR lab-sync import semantics.
 *
 * Characterizes the behavior the chunked-transaction refactor must preserve:
 * value + stable-FHIR-id idempotency dedupe (incl. amendments), unmapped-LOINC
 * tracking, per-observation error tolerance (one bad row must not sink the
 * rest), and chunked writes (one transaction per CHUNK, not per observation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  withRLSTransaction: vi.fn(),
  upsertBiomarkerReading: vi.fn(),
  extractLOINCCoding: vi.fn(),
  findLOINCMapping: vi.fn(),
}));

// Run the transaction callback against a dummy tx; reject if it throws (mirrors
// a real tx aborting when a statement inside it fails).
mocks.withRLSTransaction.mockImplementation(
  async (_userId: unknown, fn: (tx: unknown) => unknown) => fn({})
);

vi.mock('../database.js', () => ({
  withRLSTransaction: mocks.withRLSTransaction,
  withRLSContext: vi.fn(),
  getPrismaClient: vi.fn(() => ({})),
}));
vi.mock('../biomarkerSeries.js', () => ({ upsertBiomarkerReading: mocks.upsertBiomarkerReading }));
vi.mock('./loincMapper.js', () => ({
  extractLOINCCoding: mocks.extractLOINCCoding,
  findLOINCMapping: mocks.findLOINCMapping,
}));
vi.mock('../encryption.js', () => ({ getEncryptionService: vi.fn() }));
vi.mock('../userEncryption.js', () => ({ getUserEncryptionSalt: vi.fn() }));
vi.mock('../auditLog.js', () => ({ getAuditLogService: vi.fn() }));
vi.mock('../../config/index.js', () => ({ config: { fhir: {} } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./smartAuth.js', () => ({
  discoverEndpoints: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  refreshAccessToken: vi.fn(),
  stashChallenge: vi.fn(),
  consumeChallenge: vi.fn(),
  generatePKCE: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  revokeToken: vi.fn(),
}));
vi.mock('./fhirClient.js', () => ({ FHIRClient: class {} }));
vi.mock('../notificationService.js', () => ({ notifyNewResults: vi.fn(), notifyOutOfRange: vi.fn() }));

import { importObservations } from './labSyncService.js';

const encryption = {
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
} as unknown as Parameters<typeof importObservations>[4];

type Obs = Parameters<typeof importObservations>[2][number];

function obs(id: string, value: number, status = 'final'): Obs {
  return {
    id,
    status,
    code: { coding: [] },
    valueQuantity: { value, unit: 'mg/dL' },
    effectiveDateTime: '2026-01-01',
    referenceRange: [{ low: { value: 70 }, high: { value: 99 } }],
  } as unknown as Obs;
}

describe('importObservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: every observation maps to a known "Glucose" biomarker.
    mocks.extractLOINCCoding.mockReturnValue({ code: '2345-7', display: 'Glucose' });
    mocks.findLOINCMapping.mockReturnValue({
      biomarkerName: 'Glucose',
      category: 'METABOLIC',
      defaultUnit: 'mg/dL',
    });
    mocks.upsertBiomarkerReading.mockResolvedValue(undefined);
  });

  it('imports a mapped observation', async () => {
    const res = await importObservations('u1', 'quest', [obs('o1', 100)], [], encryption, 'salt');

    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(0);
    expect(res.importedNames).toEqual(['Glucose']);
    expect(mocks.upsertBiomarkerReading).toHaveBeenCalledTimes(1);
    // One chunk → one transaction (not one per observation).
    expect(mocks.withRLSTransaction).toHaveBeenCalledTimes(1);
  });

  it('skips an observation already imported by stable FHIR id (idempotency)', async () => {
    const existing = [
      { name: 'Glucose', measurementDate: new Date('2026-01-01'), valueEncrypted: 'enc:100', sourceFile: 'fhir:quest:o1' },
    ];
    const res = await importObservations('u1', 'quest', [obs('o1', 100)], existing, encryption, 'salt');

    expect(res.imported).toBe(0);
    expect(res.skipped).toBe(1);
    expect(mocks.upsertBiomarkerReading).not.toHaveBeenCalled();
  });

  it('lets an amended result through even when the id was already imported', async () => {
    const existing = [
      { name: 'Glucose', measurementDate: new Date('2026-01-01'), valueEncrypted: 'enc:100', sourceFile: 'fhir:quest:o1' },
    ];
    // Same id, amended, NEW value → not id-skipped, and value differs so not value-skipped.
    const res = await importObservations('u1', 'quest', [obs('o1', 120, 'amended')], existing, encryption, 'salt');

    expect(res.imported).toBe(1);
    expect(mocks.upsertBiomarkerReading).toHaveBeenCalledTimes(1);
  });

  it('skips a duplicate value (same name/date/value as an existing reading)', async () => {
    const existing = [
      { name: 'Glucose', measurementDate: new Date('2026-01-01'), valueEncrypted: 'enc:100', sourceFile: null },
    ];
    const res = await importObservations('u1', 'quest', [obs('o2', 100)], existing, encryption, 'salt');

    expect(res.imported).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it('tolerates one failing observation — the chunk retries per-row so the rest import', async () => {
    // The second reading throws inside the upsert; the chunk tx aborts, then the
    // per-row fallback imports the good one and drops only the bad one.
    mocks.upsertBiomarkerReading.mockImplementation(async (_tx, _uid, data: { valueEncrypted: string }) => {
      if (data.valueEncrypted === 'enc:999') throw new Error('bad row');
    });

    const res = await importObservations('u1', 'quest', [obs('o1', 100), obs('o2', 999)], [], encryption, 'salt');

    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('bad row');
  });

  it('writes in chunks of 50 — one transaction per chunk, not per observation', async () => {
    const many = Array.from({ length: 60 }, (_, i) => obs(`o${i}`, i + 1)); // unique values → unique keys
    const res = await importObservations('u1', 'quest', many, [], encryption, 'salt');

    expect(res.imported).toBe(60);
    expect(mocks.upsertBiomarkerReading).toHaveBeenCalledTimes(60);
    // 60 rows / 50 per chunk = 2 transactions.
    expect(mocks.withRLSTransaction).toHaveBeenCalledTimes(2);
  });
});
