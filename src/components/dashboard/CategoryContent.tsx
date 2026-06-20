/**
 * CategoryContent - Biomarker category detail view
 *
 * Displays biomarkers for a specific category with out-of-range items
 * highlighted, graph visualization, inline sparkline + range bar on each
 * card, sort/filter controls, date grouping on the in-range list, and
 * opt-in AI guidance.
 */

import React, { Suspense, lazy, useMemo, useState } from 'react';
import {
  LineChart,
  Activity,
  FileUp,
  Plus,
  Shield,
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import type { Biomarker, BiomarkerCategory, InsurancePlan } from '../../types';
import { BiomarkerSummary, BiomarkerRangeBar } from '../biomarkers';
import TrendSparkline from '../trends/TrendSparkline';
import { calculateTrend, type TrendInfo } from '../../utils/biomarkers/trendCalculations';

// Lazy-loaded components
const BiomarkerGraph = lazy(() => import('../biomarkers/BiomarkerGraph'));
const BiomarkerActionPlan = lazy(() => import('../biomarkers/BiomarkerActionPlan'));
const BiomarkerAIGuidance = lazy(() => import('../trends/BiomarkerAIGuidance'));

/** Loading fallback for lazy-loaded components */
function LazyLoadSpinner() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="w-6 h-6 animate-spin text-brand-500 border-2 border-brand-500 border-t-transparent rounded-full" />
    </div>
  );
}

type SortKey = 'recent' | 'az' | 'outlier';

interface CategoryContentProps {
  selectedCategory: string;
  categories: BiomarkerCategory[];
  biomarkers: Biomarker[];
  filteredBiomarkers: Biomarker[];
  insurancePlans: InsurancePlan[];
  selectedBiomarker: Biomarker | null;
  onSelectBiomarker: (biomarker: Biomarker | null) => void;
  onTrendClick: (biomarker: Biomarker, e: React.MouseEvent) => void;
  onInsuranceClick: (biomarker: Biomarker, e: React.MouseEvent) => void;
  onOpenAddMeasurement: () => void;
  onOpenPDFUpload: () => void;
}

// ---------- helpers ----------

function distanceFromMidpoint(b: Biomarker): number {
  const mid = (b.normalRange.min + b.normalRange.max) / 2;
  return Math.abs(b.value - mid);
}

function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // group.date is a biomarker measurement date (date-only); pin UTC so it never
  // renders the prior calendar day in negative-UTC locales.
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function sortBiomarkers(list: Biomarker[], key: SortKey): Biomarker[] {
  const copy = [...list];
  if (key === 'recent') {
    copy.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } else if (key === 'az') {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => distanceFromMidpoint(b) - distanceFromMidpoint(a));
  }
  return copy;
}

function groupByDate(list: Biomarker[]): Array<{ date: string; biomarkers: Biomarker[] }> {
  const map = new Map<string, Biomarker[]>();
  for (const b of list) {
    const key = b.date || 'unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(b);
  }
  return Array.from(map.entries())
    .map(([date, biomarkers]) => ({ date, biomarkers }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ---------- trend badge ----------

function TrendBadge({ trend }: { trend: TrendInfo }) {
  if (trend.direction === 'stable') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        <Minus className="w-3 h-3" />
        Stable
      </span>
    );
  }
  const improving = trend.isImproving === true;
  const colorClass = improving
    ? 'text-wellness-600 dark:text-wellness-400'
    : 'text-red-600 dark:text-red-400';
  const Arrow = trend.direction === 'up' ? TrendingUp : TrendingDown;
  const label = improving ? 'improving' : trend.isImproving === false ? 'declining' : 'changed';
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${colorClass}`}>
      <Arrow className="w-3 h-3" />
      {trend.direction === 'up' ? '↑' : '↓'} {trend.change.toFixed(0)}% {label}
    </span>
  );
}

// ---------- main component ----------

export function CategoryContent({
  selectedCategory,
  categories,
  biomarkers,
  filteredBiomarkers,
  insurancePlans,
  selectedBiomarker,
  onSelectBiomarker,
  onTrendClick,
  onInsuranceClick,
  onOpenAddMeasurement,
  onOpenPDFUpload,
}: CategoryContentProps) {
  const safeFilteredBiomarkers = filteredBiomarkers || [];
  const outOfRangeBiomarkers = safeFilteredBiomarkers.filter(
    (b) => b.value < b.normalRange.min || b.value > b.normalRange.max
  );
  const rawInRangeBiomarkers = safeFilteredBiomarkers.filter(
    (b) => b.value >= b.normalRange.min && b.value <= b.normalRange.max
  );

  const categoryDescription = categories.find((c) => c.name === selectedCategory)?.description;

  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [search, setSearch] = useState('');

  const showFilter = safeFilteredBiomarkers.length > 6;

  const inRangeBiomarkers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? rawInRangeBiomarkers.filter((b) => b.name.toLowerCase().includes(term))
      : rawInRangeBiomarkers;
    return sortBiomarkers(filtered, sortBy);
  }, [rawInRangeBiomarkers, search, sortBy]);

  const inRangeGroups = useMemo(() => {
    if (sortBy !== 'recent') {
      return [{ date: '', biomarkers: inRangeBiomarkers }];
    }
    return groupByDate(inRangeBiomarkers);
  }, [inRangeBiomarkers, sortBy]);

  const shouldShowGroupHeaders = sortBy === 'recent' && inRangeGroups.length > 1;

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{selectedCategory}</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">{categoryDescription}</p>
      </div>

      {/* Summary */}
      <BiomarkerSummary biomarkers={biomarkers} category={selectedCategory} />

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 mb-8">
        <button
          onClick={onOpenAddMeasurement}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-brand-600 rounded-xl hover:bg-slate-800 dark:hover:bg-brand-700 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Data
        </button>
        <button
          onClick={onOpenPDFUpload}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          <FileUp className="w-4 h-4 mr-2" />
          Upload Report
        </button>
      </div>

      {/* Selected Biomarker Graph */}
      {selectedBiomarker && (
        <div className="mb-8">
          <Suspense fallback={<LazyLoadSpinner />}>
            <BiomarkerGraph biomarker={selectedBiomarker} />
          </Suspense>
        </div>
      )}

      {/* Biomarker Lists */}
      <div className="space-y-6">
        {/* Out of Range Section */}
        {outOfRangeBiomarkers.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              Needs Attention ({outOfRangeBiomarkers.length})
            </h2>
            <div className="grid gap-3">
              {outOfRangeBiomarkers.map((biomarker) => {
                const isLow = biomarker.value < biomarker.normalRange.min;
                const isSelected = selectedBiomarker?.id === biomarker.id;
                const hasHistory = (biomarker.history?.length ?? 0) >= 1;
                const trend = calculateTrend(biomarker);

                return (
                  <div
                    key={biomarker.id}
                    // A11Y-4: this card toggles biomarker selection (the gateway
                    // to AI guidance). It nests action buttons, so it can't be a
                    // <button>; expose it as a keyboard-operable button instead.
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${biomarker.name}, ${biomarker.value} ${biomarker.unit}`}
                    onClick={() => onSelectBiomarker(isSelected ? null : biomarker)}
                    onKeyDown={(e) => {
                      // Only the card itself toggles — a keystroke on a nested
                      // action button (trend/insurance) must not bubble up and
                      // also toggle selection (those buttons only stopPropagation
                      // on click, not keydown).
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectBiomarker(isSelected ? null : biomarker);
                      }
                    }}
                    className={`bg-white dark:bg-slate-800 rounded-xl border p-4 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                      isSelected
                        ? 'border-red-300 dark:border-red-500 ring-2 ring-red-100 dark:ring-red-900/30'
                        : 'border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-slate-900 dark:text-white">
                            {biomarker.name}
                          </h3>
                          {biomarker.sourceFile && (
                            <span className="text-2xs px-1.5 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded">
                              Auto
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {biomarker.description}
                        </p>
                      </div>

                      {hasHistory && (
                        <div className="flex-shrink-0 hidden sm:block" aria-hidden="true">
                          <TrendSparkline
                            data={biomarker.history!}
                            currentValue={biomarker.value}
                            currentDate={biomarker.date}
                            normalRange={biomarker.normalRange}
                            width={80}
                            height={32}
                            isOutOfRange
                          />
                        </div>
                      )}

                      <div className="text-right flex-shrink-0">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-lg font-bold text-red-600 dark:text-red-400">
                            {biomarker.value}
                          </span>
                          <span className="text-sm text-slate-400 dark:text-slate-500">
                            {biomarker.unit}
                          </span>
                        </div>
                        <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">
                          {isLow ? 'Below' : 'Above'} range ({biomarker.normalRange.min}-
                          {biomarker.normalRange.max})
                        </p>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => onTrendClick(biomarker, e)}
                          className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          aria-label="Open trend chart"
                        >
                          <LineChart className="w-4 h-4" />
                        </button>
                        {insurancePlans.length > 0 && (
                          <button
                            onClick={(e) => onInsuranceClick(biomarker, e)}
                            className="p-2 text-slate-400 dark:text-slate-500 hover:text-wellness-600 dark:hover:text-wellness-400 hover:bg-wellness-50 dark:hover:bg-wellness-900/30 rounded-lg transition-colors"
                            aria-label="View insurance coverage"
                          >
                            <Shield className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Range bar + trend badge */}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <BiomarkerRangeBar
                          value={biomarker.value}
                          min={biomarker.normalRange.min}
                          max={biomarker.normalRange.max}
                        />
                      </div>
                      {hasHistory && (
                        <div className="flex-shrink-0">
                          <TrendBadge trend={trend} />
                        </div>
                      )}
                    </div>

                    {isSelected && (
                      <div className="mt-4 pt-4 border-t border-red-100 dark:border-red-800">
                        <Suspense fallback={<LazyLoadSpinner />}>
                          <BiomarkerAIGuidance
                            biomarker={biomarker}
                            autoFetch={false}
                          />
                          <BiomarkerActionPlan
                            biomarker={biomarker}
                            insurancePlans={insurancePlans}
                          />
                        </Suspense>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* In Range Section */}
        {rawInRangeBiomarkers.length > 0 && (
          <div>
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-wellness-500" />
                In Range ({inRangeBiomarkers.length}
                {inRangeBiomarkers.length !== rawInRangeBiomarkers.length
                  ? ` of ${rawInRangeBiomarkers.length}`
                  : ''}
                )
              </h2>

              <div className="flex items-center gap-2 ml-auto">
                {showFilter && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Filter"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 w-40"
                    />
                  </div>
                )}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  className="px-3 py-1.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="recent">Recent first</option>
                  <option value="az">Name A-Z</option>
                  <option value="outlier">Most out of range</option>
                </select>
              </div>
            </div>

            {inRangeBiomarkers.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                No biomarkers match “{search}”.
              </div>
            ) : (
              <div className="space-y-4">
                {inRangeGroups.map((group) => (
                  <div key={group.date || 'ungrouped'}>
                    {shouldShowGroupHeaders && group.date && (
                      <div className="flex items-center gap-3 mb-2 text-xs text-slate-400 dark:text-slate-500">
                        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                        <span>
                          {formatDateHeader(group.date)} · {group.biomarkers.length} biomarker
                          {group.biomarkers.length !== 1 ? 's' : ''}
                        </span>
                        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                      </div>
                    )}
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                      {group.biomarkers.map((biomarker) => {
                        const isSelected = selectedBiomarker?.id === biomarker.id;
                        const hasHistory = (biomarker.history?.length ?? 0) >= 1;
                        const trend = calculateTrend(biomarker);

                        return (
                          <div
                            key={biomarker.id}
                            // A11Y-4: keyboard-operable selection (see the
                            // out-of-range card above).
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                            aria-label={`${biomarker.name}, ${biomarker.value} ${biomarker.unit}`}
                            onClick={() => onSelectBiomarker(isSelected ? null : biomarker)}
                            onKeyDown={(e) => {
                              // Card-only toggle; ignore keystrokes bubbling from
                              // nested action buttons (see the card above).
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectBiomarker(isSelected ? null : biomarker);
                              }
                            }}
                            className={`p-4 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wellness-400 ${
                              isSelected
                                ? 'bg-wellness-50/50 dark:bg-wellness-900/20'
                                : 'hover:bg-slate-50/50 dark:hover:bg-slate-700/50'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-2 h-2 rounded-full bg-wellness-400 flex-shrink-0" />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-900 dark:text-white">
                                      {biomarker.name}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                                    {biomarker.description}
                                  </p>
                                </div>
                              </div>

                              {hasHistory && (
                                <div className="flex-shrink-0 hidden sm:block" aria-hidden="true">
                                  <TrendSparkline
                                    data={biomarker.history!}
                                    currentValue={biomarker.value}
                                    currentDate={biomarker.date}
                                    normalRange={biomarker.normalRange}
                                    width={80}
                                    height={32}
                                  />
                                </div>
                              )}

                              <div className="flex items-center gap-4 flex-shrink-0">
                                <div className="text-right">
                                  <span className="font-semibold text-slate-900 dark:text-white">
                                    {biomarker.value}
                                  </span>
                                  <span className="text-sm text-slate-400 dark:text-slate-500 ml-1">
                                    {biomarker.unit}
                                  </span>
                                </div>
                                <button
                                  onClick={(e) => onTrendClick(biomarker, e)}
                                  className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                  aria-label="Open trend chart"
                                >
                                  <LineChart className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* Range bar + trend badge */}
                            <div className="mt-3 flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <BiomarkerRangeBar
                                  value={biomarker.value}
                                  min={biomarker.normalRange.min}
                                  max={biomarker.normalRange.max}
                                />
                              </div>
                              {hasHistory && (
                                <div className="flex-shrink-0">
                                  <TrendBadge trend={trend} />
                                </div>
                              )}
                            </div>

                            {isSelected && (
                              <div className="mt-4 pt-4 border-t border-wellness-100 dark:border-wellness-800">
                                <Suspense fallback={<LazyLoadSpinner />}>
                                  <BiomarkerAIGuidance
                                    biomarker={biomarker}
                                    autoFetch={false}
                                  />
                                </Suspense>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {safeFilteredBiomarkers.length === 0 && (
          <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700">
            <Activity className="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              No {selectedCategory} Data
            </h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">
              Add your first measurement to start tracking.
            </p>
            <button
              onClick={onOpenAddMeasurement}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-brand-600 rounded-xl hover:bg-slate-800 dark:hover:bg-brand-700 transition-colors"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Measurement
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default CategoryContent;
