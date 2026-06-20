/**
 * Shared formatting utilities
 */

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value: number, decimals = 0): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a DATE-ONLY value (a `YYYY-MM-DD` string, e.g. biomarker
 * measurementDate, insurance effectiveDate, expense serviceDate) for display.
 *
 * `new Date('2026-01-01')` parses as UTC midnight, so a plain
 * `toLocaleDateString()` renders it in the LOCAL timezone and shows the
 * previous day for any negative-UTC offset. Pinning `timeZone: 'UTC'` displays
 * the intended calendar day regardless of locale.
 *
 * Use this ONLY for date-only values — NOT for full timestamps (createdAt,
 * etc.), which should render in the viewer's local time via `formatDate`.
 */
export function formatDateOnly(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  return d.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
