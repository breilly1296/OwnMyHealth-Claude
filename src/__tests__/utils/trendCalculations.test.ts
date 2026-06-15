/**
 * Clinical-correctness tests for the direction-aware trend classifier (DV-3/JC-2).
 *
 * The headline safety cases: a rising HDL is IMPROVING (the old midpoint
 * heuristic called it declining), a rising LDL/glucose is WORSENING, an electrolyte
 * leaving its band is WORSENING, and an in-range value drifting toward the
 * midpoint is STABLE (not "improving"). Insufficient history never invents a trend.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyBiomarkerTrend,
  getTrendDisplay,
  calculateTrend,
  classifyRangeStatusChange,
  type TrendInput,
} from '../../utils/biomarkers/trendCalculations';
import { getBiomarkerDirection } from '../../data/biomarkerDirections';
import type { Biomarker, BiomarkerDirection } from '../../types';
import measurementOptions from '../../data/measurementOptions.json';

function input(
  direction: BiomarkerDirection,
  oldest: number,
  newest: number,
  range: { min: number; max: number } = { min: 0, max: 100 },
  targetBand?: { low: number; high: number }
): TrendInput {
  return {
    readings: [
      { value: oldest, date: '2026-01-01' },
      { value: newest, date: '2026-02-01' },
    ],
    direction,
    normalRange: range,
    targetBand,
  };
}

describe('classifyBiomarkerTrend — one-sided analytes', () => {
  it('HDL (higherIsBetter) rising 65→95 = IMPROVING (the old midpoint bug called this declining)', () => {
    const c = classifyBiomarkerTrend(input('higherIsBetter', 65, 95, { min: 40, max: 90 }));
    expect(c.status).toBe('improving');
    expect(c.direction).toBe('up');
    expect(Math.round(c.magnitudePct!)).toBe(46);
  });

  it('LDL (lowerIsBetter) rising 90→130 = WORSENING (headline safety case)', () => {
    const c = classifyBiomarkerTrend(input('lowerIsBetter', 90, 130, { min: 0, max: 100 }));
    expect(c.status).toBe('worsening');
    expect(c.direction).toBe('up');
  });

  it('LDL (lowerIsBetter) falling 130→70 = IMPROVING with a DOWN arrow', () => {
    const c = classifyBiomarkerTrend(input('lowerIsBetter', 130, 70, { min: 0, max: 100 }));
    expect(c.status).toBe('improving');
    expect(c.direction).toBe('down');
  });

  it('Glucose (lowerIsBetter) rising 85→92 within range = WORSENING, not improving', () => {
    const c = classifyBiomarkerTrend(input('lowerIsBetter', 85, 92, { min: 70, max: 100 }));
    expect(c.status).toBe('worsening');
  });
});

describe('classifyBiomarkerTrend — targetBand / in-range-band', () => {
  it('Sodium 140→150 leaving the band = WORSENING', () => {
    const c = classifyBiomarkerTrend(input('targetBand', 140, 150, { min: 135, max: 145 }));
    expect(c.status).toBe('worsening');
  });

  it('Potassium 3.0→4.0 moving INTO the band = IMPROVING', () => {
    const c = classifyBiomarkerTrend(input('targetBand', 3.0, 4.0, { min: 3.5, max: 5.0 }));
    expect(c.status).toBe('improving');
  });

  it('Calcium 9.4→9.9 within band (toward midpoint) = STABLE, not improving', () => {
    const c = classifyBiomarkerTrend(input('targetBand', 9.4, 9.9, { min: 8.5, max: 10.2 }));
    expect(c.status).toBe('stable');
  });

  it('both-out overshoot 130→150 (crossed the whole band) = WORSENING', () => {
    const c = classifyBiomarkerTrend(input('targetBand', 130, 150, { min: 135, max: 145 }));
    expect(c.status).toBe('worsening');
  });
});

describe('classifyBiomarkerTrend — unknown direction uses the safe in-range-band rule (never midpoint)', () => {
  it('out-of-range → in-range = IMPROVING', () => {
    expect(classifyBiomarkerTrend(input('unknown', 60, 80, { min: 70, max: 100 })).status).toBe('improving');
  });
  it('in-range drifting toward the midpoint = STABLE (the explicit no-midpoint fix)', () => {
    expect(classifyBiomarkerTrend(input('unknown', 75, 90, { min: 70, max: 100 })).status).toBe('stable');
  });
  it('in-range → out-of-range = WORSENING', () => {
    expect(classifyBiomarkerTrend(input('unknown', 90, 110, { min: 70, max: 100 })).status).toBe('worsening');
  });
  it('degenerate range (min === max) = INSUFFICIENT (no false trend)', () => {
    expect(classifyBiomarkerTrend(input('unknown', 50, 60, { min: 50, max: 50 })).status).toBe('insufficient');
  });
});

describe('classifyBiomarkerTrend — guards', () => {
  it('a single reading = INSUFFICIENT (guards #143 first-entry, no invented trend)', () => {
    const c = classifyBiomarkerTrend({ readings: [{ value: 95 }], direction: 'lowerIsBetter', normalRange: { min: 0, max: 100 } });
    expect(c.status).toBe('insufficient');
    expect(c.magnitudePct).toBeNull();
  });
  it('a zero baseline = INSUFFICIENT (no divide-by-zero)', () => {
    expect(classifyBiomarkerTrend(input('lowerIsBetter', 0, 50)).status).toBe('insufficient');
  });
  it('sub-5% movement = STABLE regardless of direction', () => {
    const c = classifyBiomarkerTrend(input('lowerIsBetter', 9.5, 9.52, { min: 8, max: 11 }));
    expect(c.status).toBe('stable');
    expect(c.direction).toBe('flat');
  });
});

describe('getTrendDisplay — color follows status, arrow follows direction', () => {
  it('improving = green; worsening = red', () => {
    expect(getTrendDisplay({ status: 'improving', magnitudePct: 10, direction: 'up' }).textClass).toContain('wellness');
    expect(getTrendDisplay({ status: 'worsening', magnitudePct: 10, direction: 'up' }).textClass).toContain('red');
  });
  it('a falling LDL is an IMPROVING (green) DOWN arrow — glyph decoupled from good/bad', () => {
    const c = classifyBiomarkerTrend(input('lowerIsBetter', 130, 70, { min: 0, max: 100 }));
    const d = getTrendDisplay(c);
    expect(d.label).toBe('Improving');
    expect(d.arrow).toBe('down');
    expect(d.textClass).toContain('wellness');
  });
  it('insufficient = "Not enough data", flat', () => {
    const d = getTrendDisplay({ status: 'insufficient', magnitudePct: null, direction: 'flat' });
    expect(d.label).toBe('Not enough data');
    expect(d.arrow).toBe('flat');
  });
});

describe('calculateTrend / classifyRangeStatusChange adapters are now direction-aware', () => {
  const hdl: Biomarker = {
    id: 'h', name: 'HDL Cholesterol', value: 95, unit: 'mg/dL', date: '2026-02-01', category: 'Lipids',
    normalRange: { min: 40, max: 90, source: 'x' },
    history: [{ date: '2026-01-01', value: 65 }],
  } as Biomarker;

  it('calculateTrend: a rising HDL is isImproving:true (old midpoint heuristic returned false)', () => {
    expect(calculateTrend(hdl).isImproving).toBe(true);
  });
  it('classifyRangeStatusChange: a rising HDL maps to "improved"', () => {
    expect(classifyRangeStatusChange(hdl)).toBe('improved');
  });
});

describe('biomarkerDirections coverage', () => {
  it('resolves the clinical anchors', () => {
    expect(getBiomarkerDirection('HDL Cholesterol').direction).toBe('higherIsBetter');
    expect(getBiomarkerDirection('ldl cholesterol').direction).toBe('lowerIsBetter'); // case-insensitive
    expect(getBiomarkerDirection('Sodium').direction).toBe('targetBand');
    expect(getBiomarkerDirection('Made Up Analyte').direction).toBe('unknown');
  });

  it('every measurementOptions analyte resolves to a valid direction (drift guard)', () => {
    const valid: BiomarkerDirection[] = ['higherIsBetter', 'lowerIsBetter', 'targetBand', 'unknown'];
    const names: string[] = [];
    for (const cat of Object.values(measurementOptions as Record<string, unknown>)) {
      if (Array.isArray(cat)) names.push(...cat.map((e: { name: string }) => e.name));
    }
    expect(names.length).toBeGreaterThan(200);
    for (const name of names) {
      expect(valid).toContain(getBiomarkerDirection(name).direction);
    }
  });
});
