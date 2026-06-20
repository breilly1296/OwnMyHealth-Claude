/**
 * Shared dollar / percent formatters for the insurance UI.
 *
 * Extracted from InsurancePlanCard so that file only exports a component
 * (react-refresh/only-export-components). Imported by InsurancePlanCard,
 * InsuranceHub, InsuranceLearnTab, and InsuranceStatsGrid. All values render as
 * "--" when missing, per the design guideline.
 */

export function formatCurrency(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || !Number.isFinite(amount)) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCopay(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || !Number.isFinite(amount)) return '--';
  return `$${amount}`;
}

export function formatPercent(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--';
  return `${value}%`;
}
