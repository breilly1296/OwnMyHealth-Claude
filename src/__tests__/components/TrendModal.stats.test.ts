/**
 * computeBiomarkerStats — the TrendModal Range/Average helper.
 *
 * Regression: the current reading is stored separately from history and the
 * backend never folds it into the history rows, so computing min/max/avg over
 * history alone dropped the latest (and most extreme) point from the displayed
 * Range and Average. The helper now mirrors BiomarkerChart: include the current
 * value when there is no history OR when it is newer than the last history point.
 */

import { describe, it, expect } from 'vitest';
import { computeBiomarkerStats } from '../../utils/biomarkers/trendCalculations';
import type { Biomarker } from '../../types';

const mk = (overrides: Partial<Biomarker> = {}): Biomarker =>
  ({
    id: 'bm-1',
    name: 'Glucose',
    value: 150,
    unit: 'mg/dL',
    date: '2026-03-01',
    category: 'Blood',
    normalRange: { min: 70, max: 100, source: 'Std' },
    history: [],
    ...overrides,
  } as unknown as Biomarker);

describe('computeBiomarkerStats', () => {
  it('includes the current reading when it is newer than the last history point', () => {
    const b = mk({
      value: 150,
      date: '2026-03-01',
      history: [
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 110 },
      ],
    } as unknown as Partial<Biomarker>);

    const s = computeBiomarkerStats(b);
    expect(s.min).toBe(100);
    expect(s.max).toBe(150); // was 110 before the fix (current reading excluded)
    expect(s.avg).toBeCloseTo((100 + 110 + 150) / 3); // 120
  });

  it('returns the single current value when there is no history', () => {
    const s = computeBiomarkerStats(mk({ value: 95, history: [] }));
    expect(s).toEqual({ min: 95, max: 95, avg: 95 });
  });

  it('does not double-count the current reading when it is not newer than the last history point', () => {
    const b = mk({
      value: 110,
      date: '2026-02-01', // same as the latest history entry → excluded
      history: [
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 110 },
      ],
    } as unknown as Partial<Biomarker>);

    const s = computeBiomarkerStats(b);
    expect(s.min).toBe(100);
    expect(s.max).toBe(110);
    expect(s.avg).toBeCloseTo(105); // (100 + 110) / 2, current not re-added
  });
});
