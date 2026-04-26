/**
 * DashboardContent - Main overview content for the dashboard
 *
 * Displays health score, biomarker summary stats, quick actions,
 * and category overview cards.
 */

import {
  Activity,
  Plus,
  FileUp,
  Heart,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import type { Biomarker, BiomarkerCategory, InsurancePlan } from '../../types';
import { getIcon } from './getIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useBiomarkerTrends, type BiomarkerTrends } from '../../hooks/useBiomarkerTrends';
import RecentActivity from './RecentActivity';

interface BiomarkerStats {
  totalCount: number;
  inRangeCount: number;
  outOfRangeCount: number;
  biomarkersInRangePercent: number;
  categoryCounts: Record<string, number>;
  outOfRangeBiomarkers: Biomarker[];
}

interface DashboardContentProps {
  biomarkers: Biomarker[];
  categories: BiomarkerCategory[];
  stats: BiomarkerStats;
  insurancePlans: InsurancePlan[];
  onCategorySelect: (category: string) => void;
  onOpenAddMeasurement: () => void;
  onOpenPDFUpload: () => void;
  onOpenLabUpload: () => void;
  onOpenClinicalUpload: () => void;
  /** ISO timestamp of the most recent upload, or null. Drives the "it's
   *  been a while" nudge — only shown when the user has uploaded before
   *  (null hides the banner, not show a "first upload" prompt). */
  lastLabUploadAt?: string | null;
}

const STALE_UPLOAD_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

function netTrendLabel(trends: BiomarkerTrends): { text: string; className: string; Icon: typeof TrendingUp } {
  if (trends.netDirection === 'improving') {
    return {
      text: `↑ ${trends.improvedCount} improved`,
      className: 'text-wellness-100',
      Icon: TrendingUp,
    };
  }
  if (trends.netDirection === 'declining') {
    return {
      text: `↓ ${trends.declinedCount} declined`,
      className: 'text-red-100',
      Icon: TrendingDown,
    };
  }
  return {
    text: '→ Stable',
    className: 'text-slate-100',
    Icon: Minus,
  };
}

function statusSummary(stats: BiomarkerStats): string {
  if (stats.totalCount === 0) return 'No biomarkers tracked yet';
  if (stats.outOfRangeCount === 0) {
    return `All ${stats.totalCount} biomarkers in range`;
  }
  const noun = stats.outOfRangeCount === 1 ? 'biomarker needs' : 'biomarkers need';
  return `${stats.outOfRangeCount} ${noun} attention`;
}

function formatToday(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function CategoryTrendIcon({
  summary,
}: {
  summary?: { improving: number; declining: number; stable: number };
}) {
  if (!summary || summary.improving + summary.declining + summary.stable === 0) {
    return <Minus className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" aria-hidden="true" />;
  }
  if (summary.improving > summary.declining) {
    return <TrendingUp className="w-3.5 h-3.5 text-wellness-500 dark:text-wellness-400" aria-hidden="true" />;
  }
  if (summary.declining > summary.improving) {
    return <TrendingDown className="w-3.5 h-3.5 text-red-500 dark:text-red-400" aria-hidden="true" />;
  }
  return <Minus className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" aria-hidden="true" />;
}

/**
 * Main dashboard overview content
 */
export function DashboardContent({
  biomarkers,
  categories,
  stats,
  insurancePlans,
  onCategorySelect,
  onOpenAddMeasurement,
  onOpenPDFUpload,
  onOpenLabUpload,
  lastLabUploadAt,
}: DashboardContentProps) {
  const { user } = useAuth();
  const trends = useBiomarkerTrends(biomarkers);
  const firstName = user?.email?.split('@')[0] || '';
  const greeting = firstName ? `Welcome back, ${firstName}` : 'Dashboard';
  const netTrend = netTrendLabel(trends);
  const NetTrendIcon = netTrend.Icon;

  // Stale-upload nudge: only show if the user has uploaded at least once
  // (null lastLabUploadAt means "never uploaded" — that's a different
  // empty-state message handled below, not a "time to upload again" nudge).
  const showStaleUploadNudge =
    !!lastLabUploadAt &&
    Date.now() - new Date(lastLabUploadAt).getTime() > STALE_UPLOAD_THRESHOLD_MS;

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {showStaleUploadNudge && (
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800">
          <p className="text-sm text-brand-800 dark:text-brand-200">
            It's been a while since your last lab upload. Have new results?
          </p>
          <button
            onClick={onOpenPDFUpload}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-xl hover:bg-brand-700 transition-colors"
          >
            Upload Now
          </button>
        </div>
      )}

      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{greeting}</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          <span>{formatToday()}</span>
          <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
          <span>{statusSummary(stats)}</span>
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Biomarkers in Range */}
        <div className="bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl p-5 text-white shadow-lg shadow-brand-500/20">
          <div className="flex items-center justify-between mb-3">
            <Heart className="w-8 h-8 opacity-80" />
            <span className="text-3xl font-bold">
              {stats.biomarkersInRangePercent >= 0 ? `${stats.biomarkersInRangePercent}%` : '—'}
            </span>
          </div>
          <p className="text-sm opacity-90">Biomarkers in Range</p>
          <p className="text-xs opacity-70 mt-1">
            {stats.biomarkersInRangePercent >= 0
              ? `${stats.inRangeCount} of ${stats.totalCount} within normal range`
              : 'Add data to calculate'}
          </p>
          {stats.totalCount > 0 && (
            <div className={`mt-2 flex items-center gap-1 text-xs ${netTrend.className}`}>
              <NetTrendIcon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{netTrend.text}</span>
            </div>
          )}
        </div>

        {/* Total Biomarkers */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <Activity className="w-8 h-8 text-slate-400 dark:text-slate-500" />
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {stats.totalCount}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Total Biomarkers</p>
        </div>

        {/* In Range — neutral styling at zero so an empty dataset doesn't
            read as "healthy". */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              stats.totalCount > 0
                ? 'bg-wellness-100 dark:bg-wellness-900/30'
                : 'bg-slate-100 dark:bg-slate-700'
            }`}>
              <div className={`w-3 h-3 rounded-full ${
                stats.totalCount > 0 ? 'bg-wellness-500' : 'bg-slate-400 dark:bg-slate-500'
              }`} />
            </div>
            <span className={`text-3xl font-bold ${
              stats.totalCount > 0
                ? 'text-wellness-600 dark:text-wellness-400'
                : 'text-slate-400 dark:text-slate-500'
            }`}>
              {stats.totalCount > 0 ? stats.inRangeCount : '—'}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">In Range</p>
        </div>

        {/* Out of Range — neutral styling at zero (no data ≠ all-good). */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <AlertCircle className={`w-8 h-8 ${
              stats.totalCount > 0 ? 'text-red-400' : 'text-slate-400 dark:text-slate-500'
            }`} />
            <span className={`text-3xl font-bold ${
              stats.totalCount > 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-400 dark:text-slate-500'
            }`}>
              {stats.totalCount > 0 ? stats.outOfRangeCount : '—'}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Needs Attention</p>
        </div>
      </div>

      {/* Recent Activity */}
      <RecentActivity
        biomarkers={biomarkers}
        insurancePlans={insurancePlans}
        onViewAll={() => onCategorySelect('Trends')}
        onOpenAddMeasurement={onOpenAddMeasurement}
      />

      {/* Quick Actions */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-3 gap-2 md:gap-3 max-w-xl">
          <button
            onClick={onOpenAddMeasurement}
            className="bg-white dark:bg-slate-800 rounded-xl md:rounded-2xl border border-slate-200/60 dark:border-slate-700 p-3 md:p-4 hover:border-wellness-300 dark:hover:border-wellness-500 hover:shadow-sm transition-all group text-left min-h-[88px]"
          >
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-wellness-50 dark:bg-wellness-900/30 flex items-center justify-center mb-2 md:mb-3 group-hover:bg-wellness-100 dark:group-hover:bg-wellness-900/50 transition-colors">
              <Plus className="w-4 h-4 text-wellness-600 dark:text-slate-300" />
            </div>
            <p className="text-xs md:text-sm font-medium text-slate-900 dark:text-white">Add Data</p>
            <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5 hidden sm:block">Manual entry</p>
          </button>
          <button
            onClick={onOpenLabUpload}
            className="bg-white dark:bg-slate-800 rounded-xl md:rounded-2xl border border-slate-200/60 dark:border-slate-700 p-3 md:p-4 hover:border-brand-300 dark:hover:border-brand-500 hover:shadow-sm transition-all group text-left min-h-[88px]"
          >
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center mb-2 md:mb-3 group-hover:bg-brand-100 dark:group-hover:bg-brand-900/50 transition-colors">
              <FileUp className="w-4 h-4 text-brand-600 dark:text-slate-300" />
            </div>
            <p className="text-xs md:text-sm font-medium text-slate-900 dark:text-white">Lab OCR</p>
            <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5 hidden sm:block">Auto-extract</p>
          </button>
          <button
            onClick={onOpenPDFUpload}
            className="bg-white dark:bg-slate-800 rounded-xl md:rounded-2xl border border-slate-200/60 dark:border-slate-700 p-3 md:p-4 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all group text-left min-h-[88px]"
          >
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center mb-2 md:mb-3 group-hover:bg-slate-200 dark:group-hover:bg-slate-600 transition-colors">
              <FileUp className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            </div>
            <p className="text-xs md:text-sm font-medium text-slate-900 dark:text-white">Upload PDF</p>
            <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5 hidden sm:block">Local parsing</p>
          </button>
        </div>
      </div>

      {/* Category Cards */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
          Categories
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories
            .filter((cat) => cat.group === 'biomarkers')
            .map((category) => {
              const count = stats.categoryCounts[category.name] || 0;
              const categoryBiomarkers = biomarkers.filter(
                (b) => b.category === category.name
              );
              const outOfRange = categoryBiomarkers.filter(
                (b) => b.value < b.normalRange.min || b.value > b.normalRange.max
              ).length;
              const icon = getIcon(category.icon);
              const inRangeCount = count - outOfRange;
              const inRangePercent = count > 0 ? Math.round((inRangeCount / count) * 100) : 0;
              const trendSummary = trends.categoryTrends[category.name];

              return (
                <button
                  key={category.name}
                  onClick={() => onCategorySelect(category.name)}
                  className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-600 hover:shadow-lg transition-all text-left group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400">
                      {icon}
                    </div>
                    {count > 0 && (
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          outOfRange > 0
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                            : 'bg-wellness-100 dark:bg-wellness-900/30 text-wellness-700 dark:text-wellness-400'
                        }`}
                      >
                        {outOfRange}/{count} out of range
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-semibold text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                      {category.name}
                    </h3>
                    <CategoryTrendIcon summary={trendSummary} />
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {count} biomarker{count !== 1 ? 's' : ''}
                  </p>

                  {/* Progress bar — % in range for this category */}
                  <div className="mt-3 h-[3px] w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${outOfRange > 0 ? 'bg-red-500' : 'bg-wellness-500'} transition-all`}
                      style={{ width: count > 0 ? `${inRangePercent}%` : '0%' }}
                      aria-label={`${inRangePercent}% in range`}
                    />
                  </div>
                </button>
              );
            })}
        </div>
      </div>

      {/* Empty State — action-oriented, leads with the upload path because a
          PDF populates the dashboard instantly. Manual entry is a secondary
          option for users who don't have a lab report handy. */}
      {biomarkers.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 mt-8">
          <Activity className="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            No biomarkers tracked yet
          </h3>
          <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto">
            Upload a lab report to see your health data at a glance.
          </p>
          <div className="flex flex-col-reverse sm:flex-row gap-2 justify-center">
            <button
              onClick={onOpenAddMeasurement}
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add manually
            </button>
            <button
              onClick={onOpenPDFUpload}
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-brand-600 rounded-xl hover:bg-slate-800 dark:hover:bg-brand-700 transition-colors"
            >
              Upload Lab Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardContent;
