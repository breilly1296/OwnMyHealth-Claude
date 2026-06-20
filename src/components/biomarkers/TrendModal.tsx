/**
 * TrendModal Component
 *
 * A modal dialog that displays detailed trend analysis for a specific biomarker.
 * Shows historical data visualization along with statistical analysis including:
 * - Minimum, maximum, and average values over time
 * - Trend direction and percentage change
 * - Full-size interactive chart with normal range overlay
 * - Color-coded indicators based on current status
 *
 * Used when users click on a biomarker's trend icon to see more detail.
 *
 * @module components/biomarkers/TrendModal
 */

import { X, TrendingUp, TrendingDown, Minus, Calendar, Activity, Target } from 'lucide-react';
import { Biomarker } from '../../types';
import BiomarkerChart from './BiomarkerChart';
import { classifyBiomarker, getTrendDisplay, computeBiomarkerStats } from '../../utils/biomarkers/trendCalculations';
import { formatDateOnly } from '../../utils/format';

interface TrendModalProps {
  /** Controls modal visibility */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** The biomarker to analyze */
  biomarker: Biomarker;
}

export default function TrendModal({ isOpen, onClose, biomarker }: TrendModalProps) {
  if (!isOpen) return null;

  const stats = computeBiomarkerStats(biomarker);
  // DV-3/JC-2: direction-aware trend — a rising HDL is improving (green), a
  // rising LDL is worsening (red); color follows clinical status, not the arrow.
  const trend = classifyBiomarker(biomarker);
  const trendDisplay = getTrendDisplay(trend);
  const trendVerb =
    trendDisplay.label === 'Improving'
      ? 'improving'
      : trendDisplay.label === 'Worsening'
        ? 'worsening'
        : trendDisplay.label === 'Not enough data'
          ? '—'
          : 'stable';
  const isInRange = biomarker.value >= biomarker.normalRange.min && biomarker.value <= biomarker.normalRange.max;
  const isLow = biomarker.value < biomarker.normalRange.min;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-2xl w-full md:max-w-4xl max-h-[95vh] md:max-h-[90vh] overflow-hidden shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="px-4 md:px-6 py-4 md:py-5 border-b border-slate-100 dark:border-slate-700 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-1">
              <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white truncate">{biomarker.name}</h2>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-lg ${
                isInRange
                  ? 'bg-wellness-50 dark:bg-wellness-900/30 text-wellness-700 dark:text-wellness-400 border border-wellness-200 dark:border-wellness-800'
                  : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
              }`}>
                {isInRange ? 'In Range' : isLow ? 'Below Range' : 'Above Range'}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{biomarker.category} - Historical Trend Analysis</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="px-4 md:px-6 py-3 md:py-4 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700 overflow-x-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            {/* Current Value */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-3 md:p-4 border border-slate-200/60 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Current</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${isInRange ? 'text-slate-900 dark:text-white' : 'text-red-600 dark:text-red-400'}`}>
                  {biomarker.value}
                </span>
                <span className="text-sm text-slate-400 dark:text-slate-500">{biomarker.unit}</span>
              </div>
            </div>

            {/* Trend */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200/60 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                {trendDisplay.arrow === 'up' ? (
                  <TrendingUp className={`w-4 h-4 ${trendDisplay.textClass}`} />
                ) : trendDisplay.arrow === 'down' ? (
                  <TrendingDown className={`w-4 h-4 ${trendDisplay.textClass}`} />
                ) : (
                  <Minus className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                )}
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Trend</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${trendDisplay.textClass}`}>
                  {trend.magnitudePct !== null && Math.abs(trend.magnitudePct) >= 5
                    ? `${Math.abs(trend.magnitudePct).toFixed(1)}%`
                    : '—'}
                </span>
                <span className="text-sm text-slate-400 dark:text-slate-500">{trendVerb}</span>
              </div>
            </div>

            {/* Range (Min-Max) */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200/60 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-purple-500 dark:text-purple-400" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Range</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.min.toFixed(1)}</span>
                <span className="text-sm text-slate-400 dark:text-slate-500">-</span>
                <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.max.toFixed(1)}</span>
              </div>
            </div>

            {/* Average */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200/60 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-green-500 dark:text-green-400" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Average</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.avg.toFixed(1)}</span>
                <span className="text-sm text-slate-400 dark:text-slate-500">{biomarker.unit}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="p-4 md:p-6 overflow-x-auto">
          <BiomarkerChart biomarker={biomarker} height={250} />
        </div>

        {/* Footer */}
        <div className="px-4 md:px-6 py-3 md:py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-sm">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Normal Range:</span>
                <span className="ml-2 font-medium text-slate-900 dark:text-white">
                  {biomarker.normalRange.min} - {biomarker.normalRange.max} {biomarker.unit}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Source:</span>
                <span className="ml-2 font-medium text-slate-900 dark:text-white">{biomarker.normalRange.source}</span>
              </div>
            </div>
            <div className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              Last updated: {formatDateOnly(biomarker.date, { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
