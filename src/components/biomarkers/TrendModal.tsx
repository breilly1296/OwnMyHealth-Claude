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

import React from 'react';
import { X, TrendingUp, TrendingDown, Minus, Calendar, Activity, Target } from 'lucide-react';
import { Biomarker } from '../../types';
import BiomarkerChart from './BiomarkerChart';

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

  // Calculate statistics
  const getStats = () => {
    if (!biomarker.history || biomarker.history.length === 0) {
      return {
        min: biomarker.value,
        max: biomarker.value,
        avg: biomarker.value,
        trend: { direction: 'stable', change: 0 }
      };
    }

    const values = biomarker.history.map(h => h.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    // Calculate trend
    let trend = { direction: 'stable' as 'up' | 'down' | 'stable', change: 0 };
    if (biomarker.history.length >= 2) {
      const recent = biomarker.history[biomarker.history.length - 1].value;
      const previous = biomarker.history[biomarker.history.length - 2].value;
      const change = ((recent - previous) / previous) * 100;

      if (Math.abs(change) >= 2) {
        trend = {
          direction: change > 0 ? 'up' : 'down',
          change: Math.abs(change)
        };
      }
    }

    return { min, max, avg, trend };
  };

  const stats = getStats();
  const isInRange = biomarker.value >= biomarker.normalRange.min && biomarker.value <= biomarker.normalRange.max;
  const isLow = biomarker.value < biomarker.normalRange.min;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-slate-900">{biomarker.name}</h2>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-lg ${
                isInRange
                  ? 'bg-wellness-50 text-wellness-700 border border-wellness-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {isInRange ? 'In Range' : isLow ? 'Below Range' : 'Above Range'}
              </span>
            </div>
            <p className="text-sm text-slate-500">{biomarker.category} - Historical Trend Analysis</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Current Value */}
            <div className="bg-white rounded-xl p-4 border border-slate-200/60">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Current</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${isInRange ? 'text-slate-900' : 'text-red-600'}`}>
                  {biomarker.value}
                </span>
                <span className="text-sm text-slate-400">{biomarker.unit}</span>
              </div>
            </div>

            {/* Trend */}
            <div className="bg-white rounded-xl p-4 border border-slate-200/60">
              <div className="flex items-center gap-2 mb-2">
                {stats.trend.direction === 'up' ? (
                  <TrendingUp className="w-4 h-4 text-amber-500" />
                ) : stats.trend.direction === 'down' ? (
                  <TrendingDown className="w-4 h-4 text-wellness-500" />
                ) : (
                  <Minus className="w-4 h-4 text-slate-400" />
                )}
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Trend</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${
                  stats.trend.direction === 'up' ? 'text-amber-600' :
                  stats.trend.direction === 'down' ? 'text-wellness-600' :
                  'text-slate-600'
                }`}>
                  {stats.trend.change > 0 ? `${stats.trend.change.toFixed(1)}%` : '—'}
                </span>
                <span className="text-sm text-slate-400">
                  {stats.trend.direction === 'up' ? 'increase' :
                   stats.trend.direction === 'down' ? 'decrease' :
                   'stable'}
                </span>
              </div>
            </div>

            {/* Range (Min-Max) */}
            <div className="bg-white rounded-xl p-4 border border-slate-200/60">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Range</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-900">{stats.min.toFixed(1)}</span>
                <span className="text-sm text-slate-400">-</span>
                <span className="text-2xl font-bold text-slate-900">{stats.max.toFixed(1)}</span>
              </div>
            </div>

            {/* Average */}
            <div className="bg-white rounded-xl p-4 border border-slate-200/60">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-green-500" />
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Average</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-900">{stats.avg.toFixed(1)}</span>
                <span className="text-sm text-slate-400">{biomarker.unit}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="p-6">
          <BiomarkerChart biomarker={biomarker} height={350} />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-slate-500">Normal Range:</span>
                <span className="ml-2 font-medium text-slate-900">
                  {biomarker.normalRange.min} - {biomarker.normalRange.max} {biomarker.unit}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Source:</span>
                <span className="ml-2 font-medium text-slate-900">{biomarker.normalRange.source}</span>
              </div>
            </div>
            <div className="text-sm text-slate-500">
              Last updated: {new Date(biomarker.date).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
