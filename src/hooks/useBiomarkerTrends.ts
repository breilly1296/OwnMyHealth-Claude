/**
 * useBiomarkerTrends - dashboard-level trend aggregates
 *
 * Derives "what changed since last measurement" summaries from the
 * biomarker history array already in state. Used by DashboardContent to
 * show a trend arrow on the in-range stat card and per-category arrows on
 * the category grid.
 */

import { useMemo } from 'react';
import type { Biomarker } from '../types';
import { classifyRangeStatusChange } from '../utils/biomarkers/trendCalculations';

export interface CategoryTrendSummary {
  improving: number;
  declining: number;
  stable: number;
}

export interface BiomarkerTrends {
  improvedCount: number;
  declinedCount: number;
  stableCount: number;
  netDirection: 'improving' | 'declining' | 'stable';
  categoryTrends: Record<string, CategoryTrendSummary>;
}

export function useBiomarkerTrends(biomarkers: Biomarker[]): BiomarkerTrends {
  return useMemo(() => {
    let improvedCount = 0;
    let declinedCount = 0;
    let stableCount = 0;
    const categoryTrends: Record<string, CategoryTrendSummary> = {};

    for (const b of biomarkers) {
      const status = classifyRangeStatusChange(b);
      if (status === 'none') continue;

      if (!categoryTrends[b.category]) {
        categoryTrends[b.category] = { improving: 0, declining: 0, stable: 0 };
      }

      if (status === 'improved') {
        improvedCount++;
        categoryTrends[b.category].improving++;
      } else if (status === 'declined') {
        declinedCount++;
        categoryTrends[b.category].declining++;
      } else {
        stableCount++;
        categoryTrends[b.category].stable++;
      }
    }

    let netDirection: BiomarkerTrends['netDirection'] = 'stable';
    if (improvedCount > declinedCount) netDirection = 'improving';
    else if (declinedCount > improvedCount) netDirection = 'declining';

    return {
      improvedCount,
      declinedCount,
      stableCount,
      netDirection,
      categoryTrends,
    };
  }, [biomarkers]);
}
