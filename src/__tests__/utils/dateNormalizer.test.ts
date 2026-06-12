/**
 * normalizeDateToISO Tests
 *
 * The backend dateString validator (backend/src/middleware/validation.ts)
 * accepts only YYYY-MM-DD or full ISO datetimes; lab report headers capture
 * US-format dates. One un-normalized date 422s an ENTIRE batch create, so
 * this normalizer is what keeps PDF extractions saveable.
 */

import { describe, it, expect } from 'vitest';
import { normalizeDateToISO } from '../../utils/biomarkers/dateNormalizer';

describe('normalizeDateToISO', () => {
  describe('US slash format (M/D/Y)', () => {
    it('converts MM/DD/YYYY', () => {
      expect(normalizeDateToISO('01/15/2026')).toBe('2026-01-15');
    });

    it('converts single-digit month/day with zero padding', () => {
      expect(normalizeDateToISO('1/5/2026')).toBe('2026-01-05');
    });

    it('converts a 2-digit year as 20xx', () => {
      expect(normalizeDateToISO('01/15/26')).toBe('2026-01-15');
      expect(normalizeDateToISO('12/31/99')).toBe('2099-12-31');
    });
  });

  describe('US dash format (M-D-Y)', () => {
    it('converts MM-DD-YYYY', () => {
      expect(normalizeDateToISO('01-15-2026')).toBe('2026-01-15');
    });

    it('converts M-D-YY with a 2-digit year as 20xx', () => {
      expect(normalizeDateToISO('1-15-26')).toBe('2026-01-15');
    });
  });

  describe('ISO passthrough', () => {
    it('passes through an already-ISO calendar date unchanged', () => {
      expect(normalizeDateToISO('2026-01-15')).toBe('2026-01-15');
    });

    it('passes through a full ISO datetime unchanged (backend accepts it)', () => {
      expect(normalizeDateToISO('2026-01-15T10:30:00Z')).toBe('2026-01-15T10:30:00Z');
    });

    it('rejects an ISO-shaped date with an impossible month/day', () => {
      expect(normalizeDateToISO('2026-13-01')).toBeNull();
      expect(normalizeDateToISO('2026-01-32')).toBeNull();
    });
  });

  describe('invalid input returns null (caller falls back to today)', () => {
    it('rejects garbage strings', () => {
      expect(normalizeDateToISO('not a date')).toBeNull();
      expect(normalizeDateToISO('Jan 15, 2026')).toBeNull();
      expect(normalizeDateToISO('15/01/2026 extra')).toBeNull();
    });

    it('rejects empty/missing input', () => {
      expect(normalizeDateToISO('')).toBeNull();
      expect(normalizeDateToISO(undefined)).toBeNull();
      expect(normalizeDateToISO(null)).toBeNull();
    });

    it('rejects out-of-range month or day (US convention is MM/DD)', () => {
      expect(normalizeDateToISO('13/01/2026')).toBeNull();
      expect(normalizeDateToISO('00/15/2026')).toBeNull();
      expect(normalizeDateToISO('01/32/2026')).toBeNull();
      expect(normalizeDateToISO('01/00/2026')).toBeNull();
    });

    it('rejects 3-digit years', () => {
      expect(normalizeDateToISO('01/15/202')).toBeNull();
    });
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(normalizeDateToISO('  01/15/2026  ')).toBe('2026-01-15');
  });
});
