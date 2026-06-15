/**
 * validateBiomarkerValue numeric-sanity regression tests (L28-L43 teardown: L31).
 *
 * Before the fix, an analyte name not in ALL_BIOMARKERS returned { valid: true }
 * with NO numeric check, so an OCR/Claude-extracted Infinity / NaN / absurd
 * magnitude would persist unchecked. The fix bounds magnitude (not sign) for
 * EVERY value, recognized or not.
 */

import { describe, it, expect } from 'vitest';
import { validateBiomarkerValue } from './biomarkerExtractor.js';

const UNKNOWN = 'Totally Unknown Analyte XYZ-123';

describe('validateBiomarkerValue — numeric sanity for unknown analytes (L31)', () => {
  it('accepts a plausible value for an unrecognized analyte', () => {
    expect(validateBiomarkerValue(UNKNOWN, 5.2, 'mg/dL').valid).toBe(true);
  });

  it('accepts a legitimately NEGATIVE value (e.g. base excess) — only magnitude is bounded', () => {
    expect(validateBiomarkerValue(UNKNOWN, -8, 'mmol/L').valid).toBe(true);
  });

  it('rejects Infinity / -Infinity for an unrecognized analyte', () => {
    expect(validateBiomarkerValue(UNKNOWN, Infinity, 'mg/dL').valid).toBe(false);
    expect(validateBiomarkerValue(UNKNOWN, -Infinity, 'mg/dL').valid).toBe(false);
  });

  it('rejects NaN for an unrecognized analyte', () => {
    expect(validateBiomarkerValue(UNKNOWN, NaN, 'mg/dL').valid).toBe(false);
  });

  it('rejects an absurd magnitude for an unrecognized analyte', () => {
    expect(validateBiomarkerValue(UNKNOWN, 1e15, 'mg/dL').valid).toBe(false);
  });

  it('still rejects non-finite values for a value passed with an empty name', () => {
    expect(validateBiomarkerValue('', Infinity, '').valid).toBe(false);
  });
});
