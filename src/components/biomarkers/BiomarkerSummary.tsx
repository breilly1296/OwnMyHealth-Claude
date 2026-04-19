/**
 * BiomarkerSummary Component
 *
 * Displays a summary dashboard of biomarker statistics for a specific health category.
 * Shows key metrics in a grid of colored cards including:
 * - Total number of tracked biomarkers
 * - Count of biomarkers within normal range
 * - Count of biomarkers outside normal range
 * - The most recent out-of-range biomarker requiring attention
 *
 * Used at the top of category pages to give users a quick overview
 * of their health status in that area.
 *
 * @module components/biomarkers/BiomarkerSummary
 */

import { CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';
import type { Biomarker } from '../../types';

interface BiomarkerSummaryProps {
  /** All biomarkers to analyze */
  biomarkers: Biomarker[];
  /** The category to filter and summarize */
  category: string;
}

export default function BiomarkerSummary({ biomarkers, category }: BiomarkerSummaryProps) {
  // Defensive null check to prevent "Cannot read properties of undefined" errors
  const safeBiomarkers = biomarkers || [];
  const categoryBiomarkers = safeBiomarkers.filter(b => b.category === category);
  const outOfRange = categoryBiomarkers.filter(b =>
    b.value < b.normalRange.min || b.value > b.normalRange.max
  );
  const inRange = categoryBiomarkers.filter(b =>
    b.value >= b.normalRange.min && b.value <= b.normalRange.max
  );

  const mostRecentOutOfRange = outOfRange.length > 0
    ? outOfRange.reduce((latest, current) =>
        new Date(current.date) > new Date(latest.date) ? current : latest
      )
    : null;

  const percentage = categoryBiomarkers.length > 0
    ? Math.round((inRange.length / categoryBiomarkers.length) * 100)
    : 100;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {/* Total Tracked */}
      <div className="bg-slate-900 dark:bg-slate-800 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-5 h-5 opacity-70" />
          <span className="text-sm font-medium opacity-70">Tracked</span>
        </div>
        <div className="text-3xl font-bold">{categoryBiomarkers.length}</div>
        <p className="text-sm opacity-60 mt-1">biomarkers</p>
      </div>

      {/* In Range */}
      <div className="bg-wellness-500 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="w-5 h-5 opacity-70" />
          <span className="text-sm font-medium opacity-70">In Range</span>
        </div>
        <div className="text-3xl font-bold">{inRange.length}</div>
        <p className="text-sm opacity-60 mt-1">{percentage}% healthy</p>
      </div>

      {/* Out of Range */}
      <div className={`rounded-2xl p-5 text-white ${outOfRange.length > 0 ? 'bg-red-500' : 'bg-slate-400 dark:bg-slate-600'}`}>
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="w-5 h-5 opacity-70" />
          <span className="text-sm font-medium opacity-70">Attention</span>
        </div>
        <div className="text-3xl font-bold">{outOfRange.length}</div>
        <p className="text-sm opacity-60 mt-1">need review</p>
      </div>

      {/* Latest Concern or All Clear */}
      <div className={`rounded-2xl p-5 ${mostRecentOutOfRange ? 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800' : 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800'}`}>
        <div className="flex items-center gap-2 mb-2">
          {mostRecentOutOfRange ? (
            <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          ) : (
            <CheckCircle className="w-4 h-4 text-blue-500 dark:text-blue-400" />
          )}
          <span className={`text-xs font-medium ${mostRecentOutOfRange ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
            {mostRecentOutOfRange ? 'Latest Concern' : 'Status'}
          </span>
        </div>
        {mostRecentOutOfRange ? (
          <div>
            <p className="font-semibold text-slate-900 dark:text-white truncate">{mostRecentOutOfRange.name}</p>
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {mostRecentOutOfRange.value} {mostRecentOutOfRange.unit}
              <span className="text-amber-500 dark:text-amber-500 ml-1">
                ({mostRecentOutOfRange.value < mostRecentOutOfRange.normalRange.min ? 'Low' : 'High'})
              </span>
            </p>
          </div>
        ) : (
          <div>
            <p className="font-semibold text-blue-900 dark:text-blue-300">All Clear</p>
            <p className="text-sm text-blue-600 dark:text-blue-400">Within normal range</p>
          </div>
        )}
      </div>
    </div>
  );
}
