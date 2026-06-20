/**
 * Health-goal progress ordering + trend classification.
 *
 * Extracted from GoalTrackerPanel so the pure logic is unit-testable and the
 * component file only exports a component (react-refresh/only-export-components).
 */

import type { HealthGoalData } from '../../services/api/healthGoals';

type GoalDirection = HealthGoalData['direction'];

/** Minimal shape the ordering/trend helpers read from a progress entry. */
interface ProgressPoint {
  recordedAt: string;
  value: number;
}

/**
 * Progress entries sorted OLDEST-first. The API returns them newest-first
 * (recordedAt DESC), but both progressTrend and the progress charts assume
 * chronological (oldest→newest) order — consuming the raw DESC array inverted
 * the trend fill color and ran the chart time axis backwards. Generic so the
 * caller keeps its richer element type.
 */
export function toChronologicalProgress<T extends ProgressPoint>(
  history: T[] | undefined
): T[] {
  return [...(history ?? [])].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
}

/**
 * Trend classifier for the progress chart fill color. Expects `history` in
 * chronological (oldest-first) order — see toChronologicalProgress.
 */
export function progressTrend(
  history: ProgressPoint[] | undefined,
  direction: GoalDirection
): 'positive' | 'stagnant' | 'negative' {
  if (!history || history.length < 2) return 'stagnant';
  const first = history[0].value;
  const last = history[history.length - 1].value;
  if (direction === 'INCREASE') {
    if (last > first) return 'positive';
    if (last < first) return 'negative';
    return 'stagnant';
  }
  if (direction === 'DECREASE') {
    if (last < first) return 'positive';
    if (last > first) return 'negative';
    return 'stagnant';
  }
  // MAINTAIN: stagnant is positive, movement is negative
  return first === last ? 'positive' : 'stagnant';
}
