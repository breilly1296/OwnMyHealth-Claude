/**
 * TrendsPage Component
 *
 * A page displaying all biomarkers with historical data for trend analysis.
 * Features filtering, sorting, and visual trend indicators with sparklines.
 *
 * Features:
 * - Header with trackable biomarker count
 * - Category filter dropdown
 * - Time range filter (30d, 90d, 1y, All)
 * - Sort options (Most Recent, Most Improved, Needs Attention, A-Z)
 * - Responsive card grid with sparklines
 * - Click to view detailed trend modal
 * - Graceful handling of insufficient data
 *
 * @module components/trends/TrendsPage
 */

import React, { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Filter, ChevronDown, Calendar, AlertCircle } from 'lucide-react';
import type { Biomarker, BiomarkerCategoryType } from '../../types';
import TrendSparkline from './TrendSparkline';
import TrendDetailModal from './TrendDetailModal';

interface TrendsPageProps {
  /** Array of all biomarkers to display */
  biomarkers: Biomarker[];
}

type TimeRange = '30d' | '90d' | '1y' | 'all';
type SortOption = 'recent' | 'improved' | 'attention' | 'az';

interface TrendInfo {
  direction: 'up' | 'down' | 'stable';
  change: number;
  isImproving: boolean | null;
}

// Available categories for filtering
const CATEGORIES: (BiomarkerCategoryType | 'All')[] = [
  'All',
  'Blood',
  'Lipids',
  'Vitamins',
  'Hormones',
  'Vital Signs',
  'Body Composition',
  'Inflammation Markers',
  'Kidney Function',
  'Liver Function',
  'Thyroid',
  'Cardiac',
  'Bone Health',
  'Electrolytes',
];

// Calculate trend for a biomarker
const calculateTrend = (biomarker: Biomarker): TrendInfo => {
  const history = biomarker.history || [];

  if (history.length < 1) {
    return { direction: 'stable', change: 0, isImproving: null };
  }

  const oldest = history[0].value;
  const newest = biomarker.value;

  if (oldest === 0) {
    return { direction: 'stable', change: 0, isImproving: null };
  }

  const change = ((newest - oldest) / oldest) * 100;

  // Determine direction (stable if less than 5% change)
  let direction: 'up' | 'down' | 'stable' = 'stable';
  if (Math.abs(change) >= 5) {
    direction = change > 0 ? 'up' : 'down';
  }

  // Determine if improving (moving toward normal range midpoint)
  const midRange = (biomarker.normalRange.min + biomarker.normalRange.max) / 2;
  const wasCloser = Math.abs(oldest - midRange);
  const isCloser = Math.abs(newest - midRange);
  const isImproving = Math.abs(change) >= 5 ? isCloser < wasCloser : null;

  return {
    direction,
    change: Math.abs(change),
    isImproving,
  };
};

// Filter history by time range
const filterByTimeRange = (biomarker: Biomarker, range: TimeRange): Biomarker => {
  if (range === 'all' || !biomarker.history) {
    return biomarker;
  }

  const now = new Date();
  let cutoffDate: Date;

  switch (range) {
    case '30d':
      cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case '1y':
      cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      return biomarker;
  }

  const filteredHistory = biomarker.history.filter(
    (h) => new Date(h.date) >= cutoffDate
  );

  return {
    ...biomarker,
    history: filteredHistory,
  };
};

export default function TrendsPage({ biomarkers }: TrendsPageProps) {
  // State
  const [selectedCategory, setSelectedCategory] = useState<BiomarkerCategoryType | 'All'>('All');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [selectedBiomarker, setSelectedBiomarker] = useState<Biomarker | null>(null);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);

  // Filter and process biomarkers
  const processedBiomarkers = useMemo(() => {
    let filtered = biomarkers;

    // Filter by category
    if (selectedCategory !== 'All') {
      filtered = filtered.filter((b) => b.category === selectedCategory);
    }

    // Apply time range filter
    filtered = filtered.map((b) => filterByTimeRange(b, timeRange));

    // Calculate trend info for sorting
    const withTrends = filtered.map((b) => ({
      biomarker: b,
      trend: calculateTrend(b),
      hasEnoughData: (b.history?.length || 0) >= 1,
      isOutOfRange: b.value < b.normalRange.min || b.value > b.normalRange.max,
    }));

    // Sort
    switch (sortBy) {
      case 'recent':
        withTrends.sort((a, b) => new Date(b.biomarker.date).getTime() - new Date(a.biomarker.date).getTime());
        break;
      case 'improved':
        withTrends.sort((a, b) => {
          if (a.trend.isImproving === b.trend.isImproving) {
            return b.trend.change - a.trend.change;
          }
          if (a.trend.isImproving && !b.trend.isImproving) return -1;
          if (!a.trend.isImproving && b.trend.isImproving) return 1;
          return 0;
        });
        break;
      case 'attention':
        withTrends.sort((a, b) => {
          // Out of range first
          if (a.isOutOfRange !== b.isOutOfRange) {
            return a.isOutOfRange ? -1 : 1;
          }
          // Then by worsening trend
          if (a.trend.isImproving !== b.trend.isImproving) {
            return a.trend.isImproving === false ? -1 : 1;
          }
          return b.trend.change - a.trend.change;
        });
        break;
      case 'az':
        withTrends.sort((a, b) => a.biomarker.name.localeCompare(b.biomarker.name));
        break;
    }

    return withTrends;
  }, [biomarkers, selectedCategory, timeRange, sortBy]);

  // Count trackable biomarkers (those with history)
  const trackableCount = processedBiomarkers.filter((b) => b.hasEnoughData).length;

  // Get unique categories from biomarkers
  const availableCategories = useMemo(() => {
    const cats = new Set(biomarkers.map((b) => b.category));
    return CATEGORIES.filter((c) => c === 'All' || cats.has(c as BiomarkerCategoryType));
  }, [biomarkers]);

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/25">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">Trends</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {trackableCount} biomarker{trackableCount !== 1 ? 's' : ''} with trend data
            </p>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          {/* Category Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setIsCategoryDropdownOpen(!isCategoryDropdownOpen);
                setIsSortDropdownOpen(false);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors min-w-[140px]"
            >
              <Filter className="w-4 h-4" />
              <span className="flex-1 text-left">{selectedCategory}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isCategoryDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {isCategoryDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsCategoryDropdownOpen(false)} />
                <div className="absolute left-0 top-full mt-1 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-50 max-h-64 overflow-y-auto">
                  {availableCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setSelectedCategory(cat);
                        setIsCategoryDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
                        selectedCategory === cat
                          ? 'text-brand-600 dark:text-brand-400 font-medium bg-brand-50 dark:bg-brand-900/20'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Time Range Buttons */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 rounded-xl p-1">
            {(['30d', '90d', '1y', 'all'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  timeRange === range
                    ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {range === 'all' ? 'All' : range.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Sort Dropdown */}
          <div className="relative md:ml-auto">
            <button
              onClick={() => {
                setIsSortDropdownOpen(!isSortDropdownOpen);
                setIsCategoryDropdownOpen(false);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors min-w-[160px]"
            >
              <span className="flex-1 text-left">
                {sortBy === 'recent' && 'Most Recent'}
                {sortBy === 'improved' && 'Most Improved'}
                {sortBy === 'attention' && 'Needs Attention'}
                {sortBy === 'az' && 'A-Z'}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isSortDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {isSortDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsSortDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-50">
                  {[
                    { value: 'recent', label: 'Most Recent' },
                    { value: 'improved', label: 'Most Improved' },
                    { value: 'attention', label: 'Needs Attention' },
                    { value: 'az', label: 'A-Z' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSortBy(option.value as SortOption);
                        setIsSortDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
                        sortBy === option.value
                          ? 'text-brand-600 dark:text-brand-400 font-medium bg-brand-50 dark:bg-brand-900/20'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Biomarker Cards Grid */}
      {processedBiomarkers.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700">
          <TrendingUp className="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No Biomarkers Found</h3>
          <p className="text-slate-500 dark:text-slate-400">
            {selectedCategory !== 'All'
              ? `No biomarkers in the "${selectedCategory}" category.`
              : 'Add biomarkers to start tracking trends.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {processedBiomarkers.map(({ biomarker, trend, hasEnoughData, isOutOfRange }) => (
            <BiomarkerTrendCard
              key={biomarker.id}
              biomarker={biomarker}
              trend={trend}
              hasEnoughData={hasEnoughData}
              isOutOfRange={isOutOfRange}
              onClick={() => setSelectedBiomarker(biomarker)}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedBiomarker && (
        <TrendDetailModal
          isOpen={!!selectedBiomarker}
          onClose={() => setSelectedBiomarker(null)}
          biomarker={selectedBiomarker}
          allBiomarkers={biomarkers}
        />
      )}
    </div>
  );
}

// Biomarker Trend Card Component
interface BiomarkerTrendCardProps {
  biomarker: Biomarker;
  trend: TrendInfo;
  hasEnoughData: boolean;
  isOutOfRange: boolean;
  onClick: () => void;
}

function BiomarkerTrendCard({ biomarker, trend, hasEnoughData, isOutOfRange, onClick }: BiomarkerTrendCardProps) {
  // Get trend color based on improvement status
  const getTrendColor = () => {
    if (trend.isImproving === null) return 'text-slate-500 dark:text-slate-400';
    return trend.isImproving ? 'text-wellness-600 dark:text-wellness-400' : 'text-red-600 dark:text-red-400';
  };

  const getTrendBgColor = () => {
    if (trend.isImproving === null) return 'bg-slate-100 dark:bg-slate-700';
    return trend.isImproving ? 'bg-wellness-50 dark:bg-wellness-900/30' : 'bg-red-50 dark:bg-red-900/30';
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-slate-800 rounded-2xl border p-4 cursor-pointer transition-all hover:shadow-md ${
        hasEnoughData
          ? isOutOfRange
            ? 'border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700'
            : 'border-slate-200/60 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
          : 'border-slate-200/60 dark:border-slate-700 opacity-60 hover:opacity-80'
      }`}
    >
      {/* Header: Name and Category */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900 dark:text-white truncate">{biomarker.name}</h3>
          <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
            {biomarker.category}
          </span>
        </div>
        {isOutOfRange && hasEnoughData && (
          <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0" />
        )}
      </div>

      {/* Value and Sparkline */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <span
            className={`text-2xl font-bold ${
              isOutOfRange ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'
            }`}
          >
            {biomarker.value}
          </span>
          <span className="ml-1 text-sm text-slate-400 dark:text-slate-500">{biomarker.unit}</span>
        </div>

        {/* Sparkline */}
        {hasEnoughData && biomarker.history && biomarker.history.length >= 1 ? (
          <TrendSparkline
            data={biomarker.history}
            currentValue={biomarker.value}
            currentDate={biomarker.date}
            normalRange={biomarker.normalRange}
            width={100}
            height={40}
            isOutOfRange={isOutOfRange}
          />
        ) : (
          <div className="w-[100px] h-[40px] flex items-center justify-center text-xs text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            No data
          </div>
        )}
      </div>

      {/* Footer: Trend and Date */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
        {/* Trend Indicator */}
        {hasEnoughData ? (
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${getTrendBgColor()}`}>
            {trend.direction === 'up' ? (
              <TrendingUp className={`w-3.5 h-3.5 ${getTrendColor()}`} />
            ) : trend.direction === 'down' ? (
              <TrendingDown className={`w-3.5 h-3.5 ${getTrendColor()}`} />
            ) : (
              <Minus className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
            )}
            <span className={`text-xs font-medium ${getTrendColor()}`}>
              {trend.change >= 5 ? `${trend.change.toFixed(0)}%` : 'Stable'}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500 italic">Not enough data</span>
        )}

        {/* Last Measured */}
        <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
          <Calendar className="w-3 h-3" />
          <span>
            {new Date(biomarker.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
