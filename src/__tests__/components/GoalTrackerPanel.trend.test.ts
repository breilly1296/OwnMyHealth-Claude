/**
 * Goal progress trend ordering.
 *
 * Regression: the API returns progressHistory newest-first (recordedAt DESC),
 * but progressTrend and the progress charts assume oldest-first. Consuming the
 * raw DESC array inverted the trend fill color (an improving goal showed red)
 * and ran the chart time axis backwards. toChronologicalProgress sorts to
 * oldest-first and is fed to both the classifier and the charts.
 */

import { describe, it, expect } from 'vitest';
import { progressTrend, toChronologicalProgress } from '../../utils/goals/progressTrend';

const pe = (recordedAt: string, value: number) => ({
  id: recordedAt,
  value,
  progress: 0,
  note: null,
  recordedAt,
});

// A DECREASE goal that is genuinely improving: the value falls over time.
const apiDesc = [
  pe('2026-03-01T00:00:00Z', 80), // newest
  pe('2026-02-01T00:00:00Z', 90),
  pe('2026-01-01T00:00:00Z', 100), // oldest
];

describe('toChronologicalProgress', () => {
  it('sorts newest-first API data into oldest-first order without mutating the input', () => {
    const chrono = toChronologicalProgress(apiDesc);
    expect(chrono.map((e) => e.recordedAt)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
      '2026-03-01T00:00:00Z',
    ]);
    expect(apiDesc[0].recordedAt).toBe('2026-03-01T00:00:00Z'); // input untouched
  });

  it('handles undefined', () => {
    expect(toChronologicalProgress(undefined)).toEqual([]);
  });
});

describe('progressTrend ordering', () => {
  it('mis-classifies an improving DECREASE goal as negative when fed raw newest-first data (the bug)', () => {
    expect(progressTrend(apiDesc, 'DECREASE')).toBe('negative');
  });

  it('classifies the same goal as positive once sorted oldest-first (the fix)', () => {
    expect(progressTrend(toChronologicalProgress(apiDesc), 'DECREASE')).toBe('positive');
  });
});
