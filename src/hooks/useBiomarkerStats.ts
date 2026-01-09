/**
 * useBiomarkerStats - Custom hook for computing biomarker statistics
 *
 * Provides memoized calculations for biomarker counts, category distributions,
 * and filtering. Extracted from Dashboard to improve testability and reuse.
 */

import { useMemo } from 'react';
import type { Biomarker } from '../types';

interface BiomarkerStats {
  /** Total number of biomarkers */
  totalCount: number;
  /** Number of biomarkers within normal range */
  inRangeCount: number;
  /** Number of biomarkers outside normal range */
  outOfRangeCount: number;
  /** Percentage of biomarkers in range (0-100) */
  healthScore: number;
  /** Count of biomarkers per category */
  categoryCounts: Record<string, number>;
  /** Biomarkers that are out of range */
  outOfRangeBiomarkers: Biomarker[];
}

/**
 * Computes statistics from a list of biomarkers
 *
 * @param biomarkers - Array of biomarker data
 * @returns Memoized statistics object
 *
 * @example
 * const stats = useBiomarkerStats(biomarkers);
 * console.log(`${stats.inRangeCount} of ${stats.totalCount} biomarkers in range`);
 */
export function useBiomarkerStats(biomarkers: Biomarker[]): BiomarkerStats {
  return useMemo(() => {
    const safeBiomarkers = biomarkers || [];

    const outOfRangeBiomarkers = safeBiomarkers.filter(
      (b) => b.value < b.normalRange.min || b.value > b.normalRange.max
    );

    const inRangeCount = safeBiomarkers.length - outOfRangeBiomarkers.length;
    const totalCount = safeBiomarkers.length;

    // Calculate category counts
    const categoryCounts: Record<string, number> = {};
    safeBiomarkers.forEach((b) => {
      categoryCounts[b.category] = (categoryCounts[b.category] || 0) + 1;
    });

    // Health score as percentage of biomarkers in range
    const healthScore = totalCount > 0 ? Math.round((inRangeCount / totalCount) * 100) : 100;

    return {
      totalCount,
      inRangeCount,
      outOfRangeCount: outOfRangeBiomarkers.length,
      healthScore,
      categoryCounts,
      outOfRangeBiomarkers,
    };
  }, [biomarkers]);
}

/**
 * Filters biomarkers by category
 *
 * @param biomarkers - Array of all biomarkers
 * @param category - Category name to filter by (or 'Overview' for all)
 * @returns Filtered array of biomarkers
 *
 * @example
 * const bloodBiomarkers = useFilteredBiomarkers(biomarkers, 'Blood');
 */
export function useFilteredBiomarkers(biomarkers: Biomarker[], category: string): Biomarker[] {
  return useMemo(() => {
    const safeBiomarkers = biomarkers || [];

    if (category === 'Overview') {
      return safeBiomarkers;
    }

    return safeBiomarkers.filter((b) => b.category === category);
  }, [biomarkers, category]);
}

/**
 * Gets recent biomarkers sorted by date
 *
 * @param biomarkers - Array of all biomarkers
 * @param limit - Maximum number to return (default: 5)
 * @returns Recent biomarkers sorted by date descending
 */
export function useRecentBiomarkers(biomarkers: Biomarker[], limit = 5): Biomarker[] {
  return useMemo(() => {
    const safeBiomarkers = biomarkers || [];

    return [...safeBiomarkers]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);
  }, [biomarkers, limit]);
}
