/**
 * Centralized, direction-aware biomarker trend classification (DV-3/JC-2).
 *
 * `classifyBiomarkerTrend` is the SINGLE source of truth for whether a
 * biomarker's change is clinically improving / worsening / stable. It replaced
 * a set of contradictory per-surface heuristics:
 *   - "moving toward the range midpoint = improving" — wrong for one-sided
 *     analytes (it called a falling HDL or a falling-into-deficiency value
 *     "improving"), and meaningless for a value already in range;
 *   - a hardcoded "up = bad, down = good" coloring that ignored the analyte;
 *   - a regression-slope variant in the PDF path.
 *
 * Direction comes from src/data/biomarkerDirections.ts (higherIsBetter /
 * lowerIsBetter / targetBand / unknown). Unknown analytes fall back to the
 * safe in-range-band rule, never the midpoint heuristic.
 *
 * `getTrendDisplay` centralizes the color/label so good/bad is driven by the
 * clinical status while the arrow glyph reflects raw direction — so a falling
 * LDL shows a GREEN down-arrow, not an amber one.
 */

import type { Biomarker, BiomarkerDirection, TrendClassification } from '../../types';
import { getBiomarkerDirection } from '../../data/biomarkerDirections';

export interface TrendInfo {
  direction: 'up' | 'down' | 'stable';
  change: number; // magnitude in percent (absolute)
  isImproving: boolean | null;
}

/** Input to the pure classifier. `readings` must be sorted oldest→newest. */
export interface TrendInput {
  readings: { value: number; date?: string }[];
  direction: BiomarkerDirection;
  normalRange: { min: number; max: number };
  targetBand?: { low: number; high: number };
}

export interface TrendDisplay {
  label: 'Improving' | 'Worsening' | 'Stable' | 'Not enough data';
  arrow: 'up' | 'down' | 'flat';
  textClass: string;
  bgClass: string;
}

/** Below this %, a change is noise → "stable". */
const MIN_CHANGE_PERCENT = 5;

const INSUFFICIENT: TrendClassification = { status: 'insufficient', magnitudePct: null, direction: 'flat' };

/**
 * Classify a biomarker's trend. Pure. Higher-is-better: rising = improving.
 * Lower-is-better: rising = worsening. targetBand/unknown: moving into/within the
 * range is good, out of it is bad — NOT "toward the midpoint".
 */
export function classifyBiomarkerTrend(input: TrendInput): TrendClassification {
  const valid = input.readings.filter((r) => Number.isFinite(r.value));
  if (valid.length < 2) return INSUFFICIENT;

  const oldest = valid[0].value;
  const newest = valid[valid.length - 1].value;
  if (oldest === 0) return INSUFFICIENT; // no meaningful % baseline

  const magnitudePct = ((newest - oldest) / oldest) * 100;
  const moved = Math.abs(magnitudePct) >= MIN_CHANGE_PERCENT;

  // Sub-threshold movement is noise regardless of direction.
  if (!moved) return { status: 'stable', magnitudePct, direction: 'flat' };

  const arrow: TrendClassification['direction'] = magnitudePct > 0 ? 'up' : 'down';

  if (input.direction === 'higherIsBetter') {
    return { status: newest > oldest ? 'improving' : 'worsening', magnitudePct, direction: arrow };
  }
  if (input.direction === 'lowerIsBetter') {
    return { status: newest < oldest ? 'improving' : 'worsening', magnitudePct, direction: arrow };
  }

  // targetBand | unknown → in-range-band rule.
  const band = input.targetBand ?? { low: input.normalRange.min, high: input.normalRange.max };
  const bandStatus = classifyBandTrend(oldest, newest, band);
  if (bandStatus === null) return INSUFFICIENT; // degenerate / missing range
  return { status: bandStatus, magnitudePct, direction: arrow };
}

/**
 * In-range-band classification: improving when moving into/closer-to the band,
 * worsening when leaving it or overshooting to the other side. Both-in (incl.
 * movement within the band) is stable — the explicit fix for the old
 * "toward-the-midpoint-while-already-in-range = improving" bug. Returns null for
 * a degenerate/missing band.
 */
function classifyBandTrend(
  oldest: number,
  newest: number,
  band: { low: number; high: number }
): 'improving' | 'worsening' | 'stable' | null {
  if (!(band.high > band.low)) return null;

  const wasIn = oldest >= band.low && oldest <= band.high;
  const isIn = newest >= band.low && newest <= band.high;

  if (wasIn && isIn) return 'stable';
  if (!wasIn && isIn) return 'improving';
  if (wasIn && !isIn) return 'worsening';

  // Both out of range.
  const oldLow = oldest < band.low;
  const newLow = newest < band.low;
  if (oldLow !== newLow) return 'worsening'; // crossed over the band entirely (overshoot)
  const edge = oldLow ? band.low : band.high;
  return Math.abs(newest - edge) < Math.abs(oldest - edge) ? 'improving' : 'worsening';
}

/** Color + label + glyph for a classification. Color = status, arrow = raw direction. */
export function getTrendDisplay(c: TrendClassification): TrendDisplay {
  switch (c.status) {
    case 'improving':
      return {
        label: 'Improving',
        arrow: c.direction,
        textClass: 'text-wellness-600 dark:text-wellness-400',
        bgClass: 'bg-wellness-100 dark:bg-wellness-900/30',
      };
    case 'worsening':
      return {
        label: 'Worsening',
        arrow: c.direction,
        textClass: 'text-red-600 dark:text-red-400',
        bgClass: 'bg-red-100 dark:bg-red-900/30',
      };
    case 'stable':
      return {
        label: 'Stable',
        arrow: 'flat',
        textClass: 'text-slate-500 dark:text-slate-400',
        bgClass: 'bg-slate-100 dark:bg-slate-700',
      };
    default:
      return {
        label: 'Not enough data',
        arrow: 'flat',
        textClass: 'text-slate-400 dark:text-slate-500',
        bgClass: 'bg-slate-100 dark:bg-slate-700',
      };
  }
}

/**
 * Build classifier input from a Biomarker: its history (oldest→newest) plus the
 * current value, with the analyte's resolved direction.
 */
export function biomarkerToTrendInput(biomarker: Biomarker): TrendInput {
  const history = (biomarker.history || []).filter((h) => Number.isFinite(h.value));
  const sorted = [...history].sort((a, b) =>
    a.date && b.date ? new Date(a.date).getTime() - new Date(b.date).getTime() : 0
  );
  const readings = [
    ...sorted.map((h) => ({ value: h.value, date: h.date })),
    { value: biomarker.value, date: biomarker.date },
  ];
  const dir = getBiomarkerDirection(biomarker.name);
  return {
    readings,
    direction: dir.direction,
    normalRange: biomarker.normalRange,
    targetBand: dir.targetBand,
  };
}

/** Classify a Biomarker directly (convenience over classifyBiomarkerTrend). */
export function classifyBiomarker(biomarker: Biomarker): TrendClassification {
  return classifyBiomarkerTrend(biomarkerToTrendInput(biomarker));
}

/**
 * Whether a value falls inside the biomarker's normal range.
 */
export function isInRange(value: number, biomarker: Pick<Biomarker, 'normalRange'>): boolean {
  return value >= biomarker.normalRange.min && value <= biomarker.normalRange.max;
}

/**
 * Legacy shape kept for existing callers — now a thin adapter over the
 * direction-aware classifier, so `isImproving` is clinically correct everywhere
 * `calculateTrend` is consumed.
 */
export function calculateTrend(biomarker: Biomarker): TrendInfo {
  const c = classifyBiomarker(biomarker);
  return {
    direction: c.direction === 'flat' ? 'stable' : c.direction,
    change: c.magnitudePct === null ? 0 : Math.abs(c.magnitudePct),
    isImproving: c.status === 'improving' ? true : c.status === 'worsening' ? false : null,
  };
}

export type RangeStatusChange = 'improved' | 'declined' | 'stable' | 'none';

/**
 * Legacy aggregate adapter (used by useBiomarkerTrends / the dashboard net
 * trend). Now direction-aware via the central classifier rather than a pure
 * range-crossing check.
 */
export function classifyRangeStatusChange(biomarker: Biomarker): RangeStatusChange {
  const c = classifyBiomarker(biomarker);
  switch (c.status) {
    case 'improving':
      return 'improved';
    case 'worsening':
      return 'declined';
    case 'stable':
      return 'stable';
    default:
      return 'none';
  }
}
