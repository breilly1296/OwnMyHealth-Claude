/**
 * upload/shared.ts — F-15 filename-sanitization regression test.
 *
 * Invariant: `validateUploadFile` mutates `file.originalname` so every
 * downstream consumer (DB writes, audit logs, Content-Disposition headers
 * on signed-URL downloads) sees a sanitized string by default. Path
 * separators, control characters, and the Windows-illegal set get
 * replaced with `_`; the result is capped to 255 bytes.
 *
 * Magic-byte / mimetype / size checks live in the same function and are
 * exercised by the integration upload tests; this file pins only the
 * filename-mutation contract.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// shared.ts pulls in services/pdfParser.ts → pdf-parse, which has a
// module-load side effect that opens a debug fixture file. That fails in
// any environment without the fixture (CI, sandbox), so stub the module
// before importing shared. Mirrors the same trick used in
// services/pdfTextExtraction.test.ts.
vi.mock('pdf-parse', () => ({ default: vi.fn() }));

// shared.ts imports deleteFile from storageService for withGcsOrphanCleanup.
// Mock the whole module so no real GCS client is constructed and we can assert
// on the cleanup call.
const storageMocks = vi.hoisted(() => ({ deleteFile: vi.fn(async () => undefined) }));
vi.mock('../../services/storageService.js', () => ({
  deleteFile: storageMocks.deleteFile,
  uploadFile: vi.fn(),
  deleteFiles: vi.fn(),
  getFileStream: vi.fn(),
}));

import {
  validateUploadFile,
  withGcsOrphanCleanup,
  sanitizeExtractedSbc,
  mapExtractedDataToPlanFields,
  mapExtractedBenefits,
  createBiomarkersFromOCRResult,
  type ExtractedSBCData,
  type OCRBiomarker,
} from './shared.js';
import type { Prisma } from '../../../generated/prisma/index.js';

// %PDF magic bytes — the lab-report path requires PDF; using real magic
// bytes lets validateUploadFile's mimetype check pass so we can observe
// the post-validation `file.originalname` mutation.
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

function makeMulterFile(originalname: string): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: PDF_MAGIC.length,
    buffer: PDF_MAGIC,
    destination: '',
    filename: '',
    path: '',
    stream: null as unknown as NodeJS.ReadableStream,
  };
}

describe('validateUploadFile — WebP magic bytes (L30)', () => {
  // RIFF container with a chosen 4-byte form type at bytes 8-11.
  const riffContainer = (formType: string): Buffer =>
    Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]), // "RIFF"
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // chunk size (ignored)
      Buffer.from(formType, 'ascii'),        // form type at bytes 8-11
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]);

  const makeWebpFile = (buffer: Buffer): Express.Multer.File => ({
    ...makeMulterFile('image.webp'),
    mimetype: 'image/webp',
    size: buffer.length,
    buffer,
  });

  it('accepts a real WebP (RIFF + WEBP form type)', () => {
    expect(() => validateUploadFile(makeWebpFile(riffContainer('WEBP')), 'ocr')).not.toThrow();
  });

  it('rejects a non-WebP RIFF container (WAV/AVI renamed to image/webp)', () => {
    expect(() => validateUploadFile(makeWebpFile(riffContainer('WAVE')), 'ocr')).toThrow();
    expect(() => validateUploadFile(makeWebpFile(riffContainer('AVI ')), 'ocr')).toThrow();
  });

  it('rejects a RIFF buffer too short to carry the form type', () => {
    const tiny = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]); // RIFF + 1 byte
    expect(() => validateUploadFile(makeWebpFile(tiny), 'ocr')).toThrow();
  });
});

describe('validateUploadFile — filename sanitization (F-15)', () => {
  it('strips POSIX path separators (defends against ../ traversal)', () => {
    const file = makeMulterFile('../../etc/passwd');

    validateUploadFile(file, 'pdf');

    // path.basename peels off the directory components, then `/` is
    // replaced. The resulting filename has no path-separator at all.
    expect(file.originalname).not.toContain('/');
    expect(file.originalname).not.toContain('..');
    expect(file.originalname).toBe('passwd');
  });

  it('strips Windows backslash separators', () => {
    // path.basename on Linux doesn't treat `\` as a separator, so this
    // case relies on the regex replace step. Confirms sanitizer covers
    // both POSIX and Windows path syntaxes.
    const file = makeMulterFile('C:\\Windows\\System32\\config\\labs.pdf');

    validateUploadFile(file, 'pdf');

    expect(file.originalname).not.toContain('\\');
  });

  it('strips ASCII control characters (C0 + DEL)', () => {
    // \x00 (NUL), \x0a (LF), \x09 (TAB), \x7f (DEL) — all replaced.
    const file = makeMulterFile('lab\x00report\x0aresult\x09\x7f.pdf');

    validateUploadFile(file, 'pdf');

    expect(file.originalname).toBe('lab_report_result__.pdf');
    // Belt-and-suspenders: no control chars survive at all.
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1F\x7F]/.test(file.originalname)).toBe(false);
  });

  it('strips Windows-illegal filesystem chars (" < > | : * ?)', () => {
    const file = makeMulterFile('"weird"<name>|labs:result*.pdf?');

    validateUploadFile(file, 'pdf');

    expect(file.originalname).not.toMatch(/["<>|:*?]/);
  });

  it('truncates to 255 bytes (POSIX filename max)', () => {
    const long = 'a'.repeat(400) + '.pdf';
    const file = makeMulterFile(long);

    validateUploadFile(file, 'pdf');

    expect(file.originalname.length).toBeLessThanOrEqual(255);
  });

  it('preserves clean filenames untouched', () => {
    const file = makeMulterFile('quest-labs-2026-01-15.pdf');

    validateUploadFile(file, 'pdf');

    expect(file.originalname).toBe('quest-labs-2026-01-15.pdf');
  });

  it('is idempotent — running validate twice produces the same string', () => {
    const file = makeMulterFile('../labs.pdf');

    validateUploadFile(file, 'pdf');
    const firstPass = file.originalname;
    validateUploadFile(file, 'pdf');

    expect(file.originalname).toBe(firstPass);
  });
});

describe('sanitizeExtractedSbc (M9/M10 — validate extracted SBC fields before persistence)', () => {
  function baseSbc(overrides: Partial<ExtractedSBCData> = {}): ExtractedSBCData {
    return { benefits: [], extractionConfidence: 0.9, usedClaudeExtraction: true, ...overrides };
  }
  const mapped = (sbc: ExtractedSBCData) => mapExtractedDataToPlanFields(sanitizeExtractedSbc(sbc));

  it('drops negative money fields (deductible -1000 / copay -5 → undefined)', () => {
    const out = sanitizeExtractedSbc(baseSbc({ deductibleIndividual: -1000, copayPrimaryCare: -5 }));
    expect(out.deductibleIndividual).toBeUndefined();
    expect(out.copayPrimaryCare).toBeUndefined();
  });

  it('clamps an over-cap money field so the Decimal(10,2) write cannot overflow/500', () => {
    expect(sanitizeExtractedSbc(baseSbc({ deductibleIndividual: 1e9 })).deductibleIndividual).toBe(999999.99);
  });

  it('clamps coinsurance to 0–100 (250 → 100) and drops negatives (-50 → undefined)', () => {
    expect(sanitizeExtractedSbc(baseSbc({ coinsuranceRate: 250 })).coinsuranceRate).toBe(100);
    expect(sanitizeExtractedSbc(baseSbc({ coinsuranceRate: -50 })).coinsuranceRate).toBeUndefined();
  });

  it('drops Infinity and non-number-typed numerics (a quoted "50" from the model)', () => {
    expect(sanitizeExtractedSbc(baseSbc({ oopMaxIndividual: Infinity })).oopMaxIndividual).toBeUndefined();
    const out = sanitizeExtractedSbc(baseSbc({ coinsuranceRate: '50' as unknown as number }));
    expect(out.coinsuranceRate).toBeUndefined();
  });

  it('caps + HTML-escapes over-length strings, drops empty ones', () => {
    const out = sanitizeExtractedSbc(
      baseSbc({ planName: 'A'.repeat(500), insurerName: '<script>x</script>', planIdNumber: 'B'.repeat(300) })
    );
    expect(out.planName!.length).toBeLessThanOrEqual(300);
    expect(out.insurerName).not.toContain('<');
    expect(out.planIdNumber!.length).toBeLessThanOrEqual(100);
    expect(sanitizeExtractedSbc(baseSbc({ planName: '   ' })).planName).toBeUndefined();
  });

  it('rejects an unknown planType → undefined; keeps a valid one', () => {
    expect(
      sanitizeExtractedSbc(baseSbc({ planType: 'SUPERHMO' as unknown as ExtractedSBCData['planType'] })).planType
    ).toBeUndefined();
    expect(sanitizeExtractedSbc(baseSbc({ planType: 'PPO' })).planType).toBe('PPO');
  });

  it('nulls an unparseable effectiveDate so the call-site falls back to a valid Date', () => {
    expect(sanitizeExtractedSbc(baseSbc({ effectiveDate: 'next year' })).effectiveDate).toBeUndefined();
    expect(sanitizeExtractedSbc(baseSbc({ effectiveDate: '13/45/9999' })).effectiveDate).toBeUndefined();
    expect(sanitizeExtractedSbc(baseSbc({ effectiveDate: '2026-01-15' })).effectiveDate).toBe('2026-01-15');
  });

  it('clamps NESTED coverage fields — proven through the mapper output (the persisted shape)', () => {
    const out = mapped(
      baseSbc({
        inpatientCoverage: { hospitalCoinsurance: -5, skilledNursingDaysLimit: 1e9 },
        rxBenefits: { tier1CoinsurancePercent: 999, tier1Copay: 1e9 },
      } as Partial<ExtractedSBCData>)
    );
    expect(out.inpatientHospitalCoinsurance).toBeNull(); // -5 dropped → ?? null
    expect(out.rxTier1Coinsurance).toBe(100); // 999 clamped to percent ceiling
    expect(out.rxTier1Copay).toBe(999999.99); // 1e9 clamped to money ceiling
    expect(out.skilledNursingDaysLimit).toBe(3650); // int limit clamp
  });

  it('drops a benefit row with an empty service name and clamps a kept row', () => {
    const out = sanitizeExtractedSbc(
      baseSbc({
        benefits: [
          { serviceName: '', serviceCategory: 'X', inNetworkCovered: true, inNetworkDeductibleApplies: true, outNetworkCovered: false, outNetworkDeductibleApplies: true, preAuthRequired: false },
          { serviceName: 'Office Visit', serviceCategory: 'Primary', inNetworkCovered: true, inNetworkCopay: -10, inNetworkCoinsurance: 300, inNetworkDeductibleApplies: true, outNetworkCovered: false, outNetworkDeductibleApplies: true, preAuthRequired: false },
        ],
      })
    );
    expect(out.benefits).toHaveLength(1);
    const m = mapExtractedBenefits(out.benefits);
    expect(m[0].inNetworkCopay).toBeNull(); // -10 dropped
    expect(m[0].inNetworkCoinsurance).toBe(100); // 300 clamped
  });

  it('rounds + clamps integer visit/day limits', () => {
    const out = sanitizeExtractedSbc(
      baseSbc({ therapyCoverage: { physicalTherapyVisitsLimit: 1e6, occupationalTherapyVisitsLimit: 12.7 } } as Partial<ExtractedSBCData>)
    );
    expect(out.therapyCoverage!.physicalTherapyVisitsLimit).toBe(3650);
    expect(out.therapyCoverage!.occupationalTherapyVisitsLimit).toBe(13);
  });

  it('leaves a fully valid plan unchanged (no good-extraction corruption)', () => {
    const clean = baseSbc({
      planName: 'Gold PPO 1500', insurerName: 'Acme Health', planType: 'PPO', planIdNumber: 'GP-1500',
      deductibleIndividual: 1500, oopMaxIndividual: 8000, coinsuranceRate: 20, copayPrimaryCare: 30,
      effectiveDate: '2026-01-01',
    });
    const out = sanitizeExtractedSbc({ ...clean });
    expect(out).toMatchObject({
      planName: 'Gold PPO 1500', insurerName: 'Acme Health', planType: 'PPO', planIdNumber: 'GP-1500',
      deductibleIndividual: 1500, oopMaxIndividual: 8000, coinsuranceRate: 20, copayPrimaryCare: 30,
      effectiveDate: '2026-01-01',
    });
  });

  it('handles the regex-fallback shape (subset of fields, nested undefined) without crashing or fabricating', () => {
    const fallback = baseSbc({
      planName: 'Regex Plan', insurerName: 'X', planType: 'HMO',
      deductibleIndividual: 1000, oopMaxIndividual: 5000, usedClaudeExtraction: false,
    });
    const out = sanitizeExtractedSbc(fallback);
    expect(out.inpatientCoverage).toBeUndefined();
    expect(out.rxBenefits).toBeUndefined();
    expect(out.deductibleIndividual).toBe(1000);
    expect(mapped(fallback).coinsuranceRate).toBeNull();
  });

  it('FIELD-COVERAGE INVARIANT: an all-bad extraction maps to a payload with no out-of-range value', () => {
    const M = 1e9, P = 999, I = 1e9;
    const out = mapped(
      baseSbc({
        deductibleIndividualOutOfNetwork: M, oopMaxIndividualOutOfNetwork: M,
        copayPrimaryCare: M, copaySpecialist: M, copayUrgentCare: M, copayEmergency: M,
        copayTelehealth: M, copayLabWork: M, copayXray: M, copayAdvancedImaging: M,
        coinsuranceRate: P, coinsurancePrimaryCare: P, coinsuranceSpecialist: P,
        coinsuranceUrgentCare: P, coinsuranceEmergency: P, coinsuranceTelehealth: P,
        coinsuranceLabWork: P, coinsuranceXray: P, coinsuranceAdvancedImaging: P,
        inpatientCoverage: { hospitalCopayPerDay: M, hospitalCoinsurance: P, mentalHealthCopay: M, mentalHealthCoinsurance: P, maternityCopay: M, maternityCoinsurance: P, skilledNursingCopay: M, skilledNursingCoinsurance: P, skilledNursingDaysLimit: I },
        outpatientCoverage: { surgeryCopay: M, surgeryCoinsurance: P, mentalHealthIndividualCopay: M, mentalHealthCoinsurance: P, labWorkCopay: M, labWorkCoinsurance: P, xrayCopay: M, xrayCoinsurance: P, advancedImagingCopay: M, advancedImagingCoinsurance: P },
        therapyCoverage: { physicalTherapyCopay: M, physicalTherapyVisitsLimit: I, occupationalTherapyCopay: M, occupationalTherapyVisitsLimit: I, speechTherapyCopay: M, speechTherapyVisitsLimit: I, chiropracticCopay: M, chiropracticVisitsLimit: I, acupunctureCopay: M, acupunctureVisitsLimit: I, cardiacRehabCopay: M, cardiacRehabVisitsLimit: I, pulmonaryRehabCopay: M, pulmonaryRehabVisitsLimit: I },
        rxBenefits: { tier1Copay: M, tier2Copay: M, tier3Copay: M, tier4Copay: M, tier1CoinsurancePercent: P, tier2CoinsurancePercent: P, tier3CoinsurancePercent: P, tier4CoinsurancePercent: P, retailDaysSupply: I, mailOrderDaysSupply: I, deductibleIndividual: M, deductibleFamily: M, oopMaxIndividual: M, oopMaxFamily: M },
        emergencyCoverage: { urgentCareCopay: M, urgentCareCoinsurance: P, emergencyRoomCopay: M, emergencyRoomCoinsurance: P, ambulanceGroundCopay: M, ambulanceGroundCoinsurance: P, ambulanceAirCopay: M, ambulanceAirCoinsurance: P },
        visionCoverage: { examCopay: M, lensesAllowance: M, framesAllowance: M, contactsAllowance: M },
        dentalCoverage: { preventiveCoinsurance: P, basicCoinsurance: P, majorCoinsurance: P, annualMaximum: M, deductible: M, orthodontiaCoinsurance: P, orthodontiaLifetimeMax: M },
        dmeCoverage: { copay: M, coinsurance: P },
        homeHealthCoverage: { visitCopay: M, visitCoinsurance: P, visitLimit: I },
        hospiceCoverage: { inpatientCopay: M, inpatientCoinsurance: P, respiteCopay: M, respiteCoinsurance: P, respiteDayLimit: I },
      } as Partial<ExtractedSBCData>)
    );

    for (const [key, value] of Object.entries(out)) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value), `${key} finite`).toBe(true);
      expect(value, `${key} >= 0`).toBeGreaterThanOrEqual(0);
      expect(value, `${key} <= Decimal(10,2) ceiling`).toBeLessThanOrEqual(999999.99);
      if (/coinsurance/i.test(key)) {
        expect(value, `${key} percent <= 100`).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('withGcsOrphanCleanup (M8/M25 — delete orphaned GCS object on tx rollback)', () => {
  const ctx = { fileId: 'file-abc', userId: 'user-1' };
  const KEY = 'user-1/file-abc.pdf';

  beforeEach(() => {
    storageMocks.deleteFile.mockReset();
    storageMocks.deleteFile.mockResolvedValue(undefined);
  });

  it('returns the transaction result and does NOT delete on success', async () => {
    const result = await withGcsOrphanCleanup(KEY, ctx, async () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
    expect(storageMocks.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes the uploaded object and rethrows the ORIGINAL error when the tx throws', async () => {
    const boom = new Error('tx rolled back');
    await expect(withGcsOrphanCleanup(KEY, ctx, async () => { throw boom; })).rejects.toBe(boom);
    expect(storageMocks.deleteFile).toHaveBeenCalledWith(KEY);
  });

  it('does NOT attempt deletion when storageKey is null (GCS upload was skipped)', async () => {
    const boom = new Error('tx rolled back');
    await expect(withGcsOrphanCleanup(null, ctx, async () => { throw boom; })).rejects.toBe(boom);
    expect(storageMocks.deleteFile).not.toHaveBeenCalled();
  });

  it('still rethrows the original tx error when the cleanup delete itself fails', async () => {
    const boom = new Error('tx rolled back');
    storageMocks.deleteFile.mockRejectedValueOnce(new Error('GCS unavailable'));
    await expect(withGcsOrphanCleanup(KEY, ctx, async () => { throw boom; })).rejects.toBe(boom);
    expect(storageMocks.deleteFile).toHaveBeenCalledWith(KEY);
  });
});

describe('createBiomarkersFromOCRResult — maxBiomarkers truncation (M12)', () => {
  const enc = { encrypt: (v: string) => `enc(${v})` } as unknown as Parameters<typeof createBiomarkersFromOCRResult>[1];

  function makeBiomarkers(n: number): OCRBiomarker[] {
    return Array.from({ length: n }, (_, i) => ({
      name: `B${i}`,
      value: 1,
      unit: 'mg/dL',
      category: 'TEST',
      confidence: 1,
      normalRange: { min: 0, max: 10 },
    }));
  }

  function mockTx(plan: string, biomarkerCount: number) {
    const created: unknown[] = [];
    const tx = {
      user: { findUnique: vi.fn(async () => ({ plan, planExpiresAt: null })) },
      biomarker: {
        count: vi.fn(async () => biomarkerCount),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `id-${created.length}`, ...data };
          created.push(row);
          return row;
        }),
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, created, countSpy: (tx as unknown as { biomarker: { count: ReturnType<typeof vi.fn> } }).biomarker.count };
  }

  const opts = (biomarkers: OCRBiomarker[]) => ({
    userId: 'u1',
    biomarkers,
    reportDate: new Date('2026-01-01'),
    notesPrefix: 'Extracted',
    normalRangeSource: 'Lab',
  });

  it('a FREE user at 48/50 uploading 5 analytes inserts only the remaining 2', async () => {
    const { tx, created } = mockTx('FREE', 48);
    const result = await createBiomarkersFromOCRResult(tx, enc, 'salt', opts(makeBiomarkers(5)));
    expect(result).toHaveLength(2);
    expect(created).toHaveLength(2);
  });

  it('a FREE user already at the cap (50) inserts none', async () => {
    const { tx, created } = mockTx('FREE', 50);
    const result = await createBiomarkersFromOCRResult(tx, enc, 'salt', opts(makeBiomarkers(3)));
    expect(result).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('a FREE user under the cap inserts all when the upload fits', async () => {
    const { tx, created } = mockTx('FREE', 10);
    const result = await createBiomarkersFromOCRResult(tx, enc, 'salt', opts(makeBiomarkers(5)));
    expect(result).toHaveLength(5);
    expect(created).toHaveLength(5);
  });

  it('a PRO (unlimited) user inserts all and never runs the count query', async () => {
    const { tx, created, countSpy } = mockTx('PRO', 9999);
    const result = await createBiomarkersFromOCRResult(tx, enc, 'salt', opts(makeBiomarkers(5)));
    expect(result).toHaveLength(5);
    expect(created).toHaveLength(5);
    expect(countSpy).not.toHaveBeenCalled();
  });
});
