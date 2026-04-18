/**
 * TrendDetailModal Component
 *
 * A detailed modal for viewing biomarker trend analysis.
 * Shows full-size chart, statistics, and data history table.
 *
 * Features:
 * - Full-size interactive chart with axes and tooltips
 * - Statistics: Min, Max, Average, Current, % Change
 * - Normal range visualization
 * - Historical data points table
 * - Responsive design with dark mode support
 *
 * @module components/trends/TrendDetailModal
 */

import React, { useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Minus, Activity, Target, Calendar, BarChart2 } from 'lucide-react';
import type { Biomarker } from '../../types';
import { BiomarkerChart } from '../biomarkers';
import BiomarkerAIGuidance from './BiomarkerAIGuidance';

interface TrendDetailModalProps {
  /** Controls modal visibility */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** The biomarker to display trends for */
  biomarker: Biomarker;
}

interface TrendStats {
  min: number;
  max: number;
  avg: number;
  current: number;
  percentChange: number;
  direction: 'up' | 'down' | 'stable';
  isImproving: boolean | null;
}

export default function TrendDetailModal({ isOpen, onClose, biomarker }: TrendDetailModalProps) {
  // Calculate comprehensive statistics
  const stats = useMemo<TrendStats>(() => {
    const history = biomarker.history || [];
    const current = biomarker.value;

    if (history.length === 0) {
      return {
        min: current,
        max: current,
        avg: current,
        current,
        percentChange: 0,
        direction: 'stable',
        isImproving: null,
      };
    }

    const values = history.map((h) => h.value);
    const allValues = [...values, current];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const avg = allValues.reduce((a, b) => a + b, 0) / allValues.length;

    // Calculate percent change from oldest to newest
    const oldest = history[0].value;
    const percentChange = oldest !== 0 ? ((current - oldest) / oldest) * 100 : 0;

    // Determine direction
    let direction: 'up' | 'down' | 'stable' = 'stable';
    if (Math.abs(percentChange) >= 5) {
      direction = percentChange > 0 ? 'up' : 'down';
    }

    // Determine if improving (moving toward normal range midpoint)
    const midRange = (biomarker.normalRange.min + biomarker.normalRange.max) / 2;
    const wasCloser = Math.abs(oldest - midRange);
    const isCloser = Math.abs(current - midRange);
    const isImproving = isCloser < wasCloser;

    return {
      min,
      max,
      avg,
      current,
      percentChange: Math.abs(percentChange),
      direction,
      isImproving: Math.abs(percentChange) >= 5 ? isImproving : null,
    };
  }, [biomarker]);

  // Prepare history data for table
  const historyData = useMemo(() => {
    const history = biomarker.history || [];
    const data = history.map((h) => ({
      date: h.date,
      value: h.value,
      notes: h.notes,
      isInRange: h.value >= biomarker.normalRange.min && h.value <= biomarker.normalRange.max,
    }));

    // Add current value
    data.push({
      date: biomarker.date,
      value: biomarker.value,
      notes: biomarker.notes,
      isInRange: biomarker.value >= biomarker.normalRange.min && biomarker.value <= biomarker.normalRange.max,
    });

    // Sort by date descending (newest first)
    return data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [biomarker]);

  // Early return must come after hooks
  if (!isOpen) return null;

  const isInRange = biomarker.value >= biomarker.normalRange.min && biomarker.value <= biomarker.normalRange.max;
  const isLow = biomarker.value < biomarker.normalRange.min;

  // Get trend indicator color
  const getTrendColor = () => {
    if (stats.isImproving === null) return 'text-slate-500 dark:text-slate-400';
    return stats.isImproving ? 'text-wellness-600 dark:text-wellness-400' : 'text-red-600 dark:text-red-400';
  };

  const getTrendBgColor = () => {
    if (stats.isImproving === null) return 'bg-slate-50 dark:bg-slate-700';
    return stats.isImproving ? 'bg-wellness-50 dark:bg-wellness-900/30' : 'bg-red-50 dark:bg-red-900/30';
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-2xl w-full md:max-w-5xl max-h-[95vh] md:max-h-[90vh] overflow-hidden shadow-2xl animate-fade-in flex flex-col">
        {/* Header */}
        <div className="px-4 md:px-6 py-4 md:py-5 border-b border-slate-100 dark:border-slate-700 flex items-start justify-between flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-1">
              <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white truncate">
                {biomarker.name}
              </h2>
              <span
                className={`px-2.5 py-1 text-xs font-medium rounded-lg ${
                  isInRange
                    ? 'bg-wellness-50 dark:bg-wellness-900/30 text-wellness-700 dark:text-wellness-400 border border-wellness-200 dark:border-wellness-800'
                    : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                }`}
              >
                {isInRange ? 'In Range' : isLow ? 'Below Range' : 'Above Range'}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {biomarker.category} - Detailed Trend Analysis
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Stats Bar */}
          <div className="px-4 md:px-6 py-3 md:py-4 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
              {/* Current Value */}
              <div className="bg-white dark:bg-slate-800 rounded-xl p-3 md:p-4 border border-slate-200/60 dark:border-slate-700">
                <div className="flex items-center gap-2 mb-1.5">
                  <Activity className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Current
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span
                    className={`text-xl md:text-2xl font-bold ${
                      isInRange ? 'text-slate-900 dark:text-white' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {stats.current}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{biomarker.unit}</span>
                </div>
              </div>

              {/* Change */}
              <div className={`rounded-xl p-3 md:p-4 border border-slate-200/60 dark:border-slate-700 ${getTrendBgColor()}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  {stats.direction === 'up' ? (
                    <TrendingUp className={`w-3.5 h-3.5 ${getTrendColor()}`} />
                  ) : stats.direction === 'down' ? (
                    <TrendingDown className={`w-3.5 h-3.5 ${getTrendColor()}`} />
                  ) : (
                    <Minus className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                  )}
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Change
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-xl md:text-2xl font-bold ${getTrendColor()}`}>
                    {stats.percentChange > 0 ? `${stats.percentChange.toFixed(1)}%` : '—'}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {stats.isImproving === true ? 'improving' : stats.isImproving === false ? 'worsening' : 'stable'}
                  </span>
                </div>
              </div>

              {/* Min */}
              <div className="bg-white dark:bg-slate-800 rounded-xl p-3 md:p-4 border border-slate-200/60 dark:border-slate-700">
                <div className="flex items-center gap-2 mb-1.5">
                  <BarChart2 className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Min
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
                    {stats.min.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{biomarker.unit}</span>
                </div>
              </div>

              {/* Max */}
              <div className="bg-white dark:bg-slate-800 rounded-xl p-3 md:p-4 border border-slate-200/60 dark:border-slate-700">
                <div className="flex items-center gap-2 mb-1.5">
                  <Target className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Max
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
                    {stats.max.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{biomarker.unit}</span>
                </div>
              </div>

              {/* Average */}
              <div className="bg-white dark:bg-slate-800 rounded-xl p-3 md:p-4 border border-slate-200/60 dark:border-slate-700 col-span-2 md:col-span-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <Calendar className="w-3.5 h-3.5 text-green-500 dark:text-green-400" />
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Average
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
                    {stats.avg.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{biomarker.unit}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="p-4 md:p-6 border-b border-slate-100 dark:border-slate-700">
            <BiomarkerChart biomarker={biomarker} height={280} />
          </div>

          {/* AI Guidance Section */}
          <div className="px-4 md:px-6 py-4 border-b border-slate-100 dark:border-slate-700">
            <BiomarkerAIGuidance biomarker={biomarker} />
          </div>

          {/* History Table */}
          <div className="p-4 md:p-6">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
              Measurement History
            </h3>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200/60 dark:border-slate-700">
                      <th className="text-left px-4 py-3 font-medium text-slate-500 dark:text-slate-400">
                        Date
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-slate-500 dark:text-slate-400">
                        Value
                      </th>
                      <th className="text-center px-4 py-3 font-medium text-slate-500 dark:text-slate-400">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-slate-500 dark:text-slate-400 hidden md:table-cell">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {historyData.map((entry, idx) => (
                      <tr
                        key={`${entry.date}-${idx}`}
                        className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition-colors"
                      >
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          {new Date(entry.date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                          {idx === 0 && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
                              Latest
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">
                          {entry.value} {biomarker.unit}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                              entry.isInRange
                                ? 'bg-wellness-50 dark:bg-wellness-900/30 text-wellness-700 dark:text-wellness-400'
                                : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                entry.isInRange ? 'bg-wellness-500' : 'bg-red-500'
                              }`}
                            />
                            {entry.isInRange ? 'Normal' : 'Out of Range'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 hidden md:table-cell">
                          {entry.notes || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 md:px-6 py-3 md:py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
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
                <span className="ml-2 font-medium text-slate-900 dark:text-white">
                  {biomarker.normalRange.source}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
