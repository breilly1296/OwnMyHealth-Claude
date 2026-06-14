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

import { describe, expect, it, vi } from 'vitest';

// shared.ts pulls in services/pdfParser.ts → pdf-parse, which has a
// module-load side effect that opens a debug fixture file. That fails in
// any environment without the fixture (CI, sandbox), so stub the module
// before importing shared. Mirrors the same trick used in
// services/pdfTextExtraction.test.ts.
vi.mock('pdf-parse', () => ({ default: vi.fn() }));

import {
  validateUploadFile,
  sanitizeExtractedSbc,
  mapExtractedDataToPlanFields,
  mapExtractedBenefits,
  type ExtractedSBCData,
} from './shared.js';

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
