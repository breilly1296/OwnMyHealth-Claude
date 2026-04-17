/**
 * Shared trend math for biomarker history comparisons.
 *
 * Used by TrendsPage (per-biomarker sparkline summary) and the dashboard
 * overview (useBiomarkerTrends aggregate). Keep the "improving" definition
 * consistent across surfaces: moving closer to the midpoint of the normal
 * range. A ±5% change is the minimum for direction to be anything other
 * than "stable".
 */

import type { Biomarker, BiomarkerHistory } from '../../types';

export interface TrendInfo {
  direction: 'up' | 'down' | 'stable';
  change: number;            // magnitude in percent
  isImproving: boolean | null;
}

const MIN_CHANGE_PERCENT = 5;

export function calculateTrend(biomarker: Biomarker): TrendInfo {
  const history = biomarker.history || [];

  if (history.length < 1) {
    return { direction: 'stable', change: 0, isImproving: null };
  }

  const oldest = history[0].value;
  const newest = biomarker.value;

  if (oldest === 0) {
    return { direction: 'stable', change: 0, isImproving: null };
  }

  const change = ((newest - oldest) / oldest) * 100;

  let direction: TrendInfo['direction'] = 'stable';
  if (Math.abs(change) >= MIN_CHANGE_PERCENT) {
    direction = change > 0 ? 'up' : 'down';
  }

  const midRange = (biomarker.normalRange.min + biomarker.normalRange.max) / 2;
  const wasDistance = Math.abs(oldest - midRange);
  const isDistance = Math.abs(newest - midRange);
  const isImproving = Math.abs(change) >= MIN_CHANGE_PERCENT ? isDistance < wasDistance : null;

  return {
    direction,
    change: Math.abs(change),
    isImproving,
  };
}

/**
 * Whether a value falls inside the biomarker's normal range.
 */
export function isInRange(value: number, biomarker: Pick<Biomarker, 'normalRange'>): boolean {
  return value >= biomarker.normalRange.min && value <= biomarker.normalRange.max;
}

/**
 * Classify how a biomarker's in/out-of-range status changed since the most
 * recent history entry. Returns 'none' when there is no prior measurement
 * to compare against.
 */
export type RangeStatusChange = 'improved' | 'declined' | 'stable' | 'none';

export function classifyRangeStatusChange(biomarker: Biomarker): RangeStatusChange {
  const history = biomarker.history || [];
  if (history.length === 0) return 'none';

  // "Previous" = the last history entry by date (fall back to array order
  // when dates are missing).
  const prior = getMostRecentHistory(history);
  if (!prior) return 'none';

  const wasInRange = isInRange(prior.value, biomarker);
  const isNowInRange = isInRange(biomarker.value, biomarker);

  if (wasInRange === isNowInRange) return 'stable';
  return isNowInRange ? 'improved' : 'declined';
}

function getMostRecentHistory(history: BiomarkerHistory[]): BiomarkerHistory | undefined {
  if (history.length === 0) return undefined;
  const withTimestamps = history.filter((h) => h.date);
  if (withTimestamps.length === 0) return history[history.length - 1];
  return [...withTimestamps].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )[0];
}
