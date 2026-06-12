/**
 * Lab-report date normalization.
 *
 * Lab report headers use US-convention dates ("01/15/2026", "1-15-26") but the
 * backend `dateString` validator (backend/src/middleware/validation.ts) accepts
 * ONLY YYYY-MM-DD or a full ISO-8601 datetime. A single non-ISO date in a
 * batch payload 422s the ENTIRE batch, so every extracted date must be
 * normalized before it is sent.
 *
 * Kept separate from labReportParser so lightweight callers (e.g.
 * useBiomarkerData) can import the normalizer without pulling tesseract.js and
 * pdfjs-dist into their bundle.
 */

// Mirrors the backend dateString shapes (backend/src/middleware/validation.ts)
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;
// US lab convention: M/D/Y or M-D-Y with a 2- or 4-digit year
const US_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/;

function isValidMonthDay(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Normalize a date captured from a lab report to backend-accepted ISO format.
 *
 * - Already-ISO dates (YYYY-MM-DD, after a month/day sanity check) and full
 *   ISO datetimes pass through unchanged.
 * - US-convention M/D/Y and M-D-Y are converted (MM/DD ordering; a 2-digit
 *   year is treated as 20xx).
 * - Anything unparseable returns null — callers fall back to today's date.
 */
export function normalizeDateToISO(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  const isoMatch = trimmed.match(ISO_DATE_ONLY);
  if (isoMatch) {
    return isValidMonthDay(parseInt(isoMatch[2], 10), parseInt(isoMatch[3], 10))
      ? trimmed
      : null;
  }

  if (ISO_DATETIME.test(trimmed)) {
    return trimmed;
  }

  const usMatch = trimmed.match(US_DATE);
  if (!usMatch) return null;

  const month = parseInt(usMatch[1], 10);
  const day = parseInt(usMatch[2], 10);
  const year = usMatch[3].length === 2
    ? 2000 + parseInt(usMatch[3], 10)
    : parseInt(usMatch[3], 10);

  if (!isValidMonthDay(month, day)) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
