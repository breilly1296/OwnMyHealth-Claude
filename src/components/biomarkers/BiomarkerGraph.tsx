/**
 * BiomarkerGraph Component
 *
 * Displays a visual representation of a biomarker's historical data with trend analysis.
 * Shows the current value, trend direction (up/down/stable), and a line chart of
 * historical measurements against the normal reference range.
 *
 * Features:
 * - Calculates and displays trend (percentage change from previous measurement)
 * - Color-coded status indicators (in-range vs out-of-range)
 * - Compact mode for smaller displays
 * - Full mode with detailed header and chart
 *
 * @module components/biomarkers/BiomarkerGraph
 */

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Biomarker } from '../../types';
import BiomarkerChart from './BiomarkerChart';

interface BiomarkerGraphProps {
  /** The biomarker data to visualize */
  biomarker: Biomarker;
  /** If true, renders a smaller version without the detailed header */
  compact?: boolean;
}

export default function BiomarkerGraph({ biomarker, compact = false }: BiomarkerGraphProps) {
  if (!biomarker.history || biomarker.history.length === 0) return null;

  // Calculate trend
  const getTrend = () => {
    if (biomarker.history.length < 2) return { direction: 'stable', change: 0 };

    const recent = biomarker.history[biomarker.history.length - 1].value;
    const previous = biomarker.history[biomarker.history.length - 2].value;
    const change = ((recent - previous) / previous) * 100;

    if (Math.abs(change) < 2) return { direction: 'stable', change: 0 };
    return {
      direction: change > 0 ? 'up' : 'down',
      change: Math.abs(change).toFixed(1)
    };
  };

  const trend = getTrend();
  const isInRange = biomarker.value >= biomarker.normalRange.min && biomarker.value <= biomarker.normalRange.max;

  if (compact) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/60 overflow-hidden">
        <BiomarkerChart biomarker={biomarker} height={180} compact showNormalRange={false} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden shadow-soft">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{biomarker.name}</h3>
            <p className="text-sm text-slate-500 mt-0.5">{biomarker.category}</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${isInRange ? 'text-slate-900' : 'text-red-600'}`}>
                {biomarker.value}
              </span>
              <span className="text-sm text-slate-500">{biomarker.unit}</span>
            </div>
            {trend.direction !== 'stable' && (
              <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${
                trend.direction === 'up' ? 'text-amber-600' : 'text-wellness-600'
              }`}>
                {trend.direction === 'up' ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                <span>{trend.change}% from last</span>
              </div>
            )}
            {trend.direction === 'stable' && (
              <div className="flex items-center justify-end gap-1 mt-1 text-xs text-slate-400">
                <Minus className="w-3 h-3" />
                <span>Stable</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chart */}
      <BiomarkerChart biomarker={biomarker} height={280} />

      {/* Footer with stats */}
      <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Normal Range</p>
            <p className="text-sm font-medium text-slate-900">
              {biomarker.normalRange.min} - {biomarker.normalRange.max} {biomarker.unit}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Data Points</p>
            <p className="text-sm font-medium text-slate-900">{biomarker.history.length}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Status</p>
            <p className={`text-sm font-medium ${isInRange ? 'text-wellness-600' : 'text-red-600'}`}>
              {isInRange ? 'Within Range' : biomarker.value < biomarker.normalRange.min ? 'Below Range' : 'Above Range'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
