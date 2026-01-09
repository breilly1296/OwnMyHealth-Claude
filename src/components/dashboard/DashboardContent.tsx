/**
 * DashboardContent - Main overview content for the dashboard
 *
 * Displays health score, biomarker summary stats, quick actions,
 * and category overview cards.
 */

import React from 'react';
import { Activity, Plus, FileUp, Heart, AlertCircle } from 'lucide-react';
import type { Biomarker, BiomarkerCategory, InsurancePlan } from '../../types';
import { getIcon } from './getIcon';

interface BiomarkerStats {
  totalCount: number;
  inRangeCount: number;
  outOfRangeCount: number;
  healthScore: number;
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
}

/**
 * Main dashboard overview content
 *
 * @example
 * <DashboardContent
 *   biomarkers={biomarkers}
 *   categories={categories}
 *   stats={biomarkerStats}
 *   insurancePlans={insurancePlans}
 *   onCategorySelect={setSelectedCategory}
 *   onOpenAddMeasurement={() => modals.open('addMeasurement')}
 *   onOpenPDFUpload={() => modals.open('pdfUpload')}
 *   onOpenLabUpload={() => modals.open('labUpload')}
 *   onOpenClinicalUpload={() => modals.open('clinicalUpload')}
 * />
 */
export function DashboardContent({
  biomarkers,
  categories,
  stats,
  insurancePlans: _insurancePlans,
  onCategorySelect,
  onOpenAddMeasurement,
  onOpenPDFUpload,
  onOpenLabUpload,
}: DashboardContentProps) {
  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Track and manage your health biomarkers
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Health Score */}
        <div className="bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl p-5 text-white shadow-lg shadow-brand-500/20">
          <div className="flex items-center justify-between mb-3">
            <Heart className="w-8 h-8 opacity-80" />
            <span className="text-3xl font-bold">
              {stats.healthScore >= 0 ? `${stats.healthScore}%` : '—'}
            </span>
          </div>
          <p className="text-sm opacity-90">Health Score</p>
          <p className="text-xs opacity-70 mt-1">
            {stats.healthScore >= 0 ? 'Based on biomarkers in range' : 'Add data to calculate'}
          </p>
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

        {/* In Range */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-full bg-wellness-100 dark:bg-wellness-900/30 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-wellness-500" />
            </div>
            <span className="text-3xl font-bold text-wellness-600 dark:text-wellness-400">
              {stats.inRangeCount}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">In Range</p>
        </div>

        {/* Out of Range */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <span className="text-3xl font-bold text-red-600 dark:text-red-400">
              {stats.outOfRangeCount}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Needs Attention</p>
        </div>
      </div>

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

              return (
                <button
                  key={category.name}
                  onClick={() => onCategorySelect(category.name)}
                  className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-600 hover:shadow-lg transition-all text-left group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: `${category.color}20` }}
                    >
                      {React.cloneElement(icon, { style: { color: category.color } })}
                    </div>
                    {outOfRange > 0 && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full">
                        {outOfRange} alert{outOfRange > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                    {category.name}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {count} biomarker{count !== 1 ? 's' : ''}
                  </p>
                </button>
              );
            })}
        </div>
      </div>

      {/* Empty State */}
      {biomarkers.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 mt-8">
          <Activity className="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            No Biomarkers Yet
          </h3>
          <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto">
            Start tracking your health by adding measurements or uploading your lab reports.
          </p>
          <button
            onClick={onOpenAddMeasurement}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-brand-600 rounded-xl hover:bg-slate-800 dark:hover:bg-brand-700 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Your First Measurement
          </button>
        </div>
      )}
    </div>
  );
}

export default DashboardContent;
