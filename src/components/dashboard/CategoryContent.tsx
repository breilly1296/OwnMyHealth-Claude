/**
 * CategoryContent - Biomarker category detail view
 *
 * Displays biomarkers for a specific category with out-of-range items
 * highlighted, graph visualization, and AI guidance integration.
 */

import React, { Suspense, lazy } from 'react';
import { LineChart, Activity, FileUp, Plus, Shield } from 'lucide-react';
import type { Biomarker, BiomarkerCategory, InsurancePlan } from '../../types';
import { BiomarkerSummary } from '../biomarkers';

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

/**
 * Category content view showing biomarkers for a specific category
 *
 * @example
 * <CategoryContent
 *   selectedCategory="Blood"
 *   categories={categories}
 *   biomarkers={allBiomarkers}
 *   filteredBiomarkers={filteredBiomarkers}
 *   insurancePlans={insurancePlans}
 *   selectedBiomarker={selectedBiomarker}
 *   onSelectBiomarker={setSelectedBiomarker}
 *   onTrendClick={handleTrendClick}
 *   onInsuranceClick={handleInsuranceClick}
 *   onOpenAddMeasurement={() => modals.open('addMeasurement')}
 *   onOpenPDFUpload={() => modals.open('pdfUpload')}
 * />
 */
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
  const inRangeBiomarkers = safeFilteredBiomarkers.filter(
    (b) => b.value >= b.normalRange.min && b.value <= b.normalRange.max
  );

  const categoryDescription = categories.find((c) => c.name === selectedCategory)?.description;

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

                return (
                  <div
                    key={biomarker.id}
                    onClick={() => onSelectBiomarker(isSelected ? null : biomarker)}
                    className={`bg-white dark:bg-slate-800 rounded-xl border p-4 cursor-pointer transition-all ${
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
                        >
                          <LineChart className="w-4 h-4" />
                        </button>
                        {insurancePlans.length > 0 && (
                          <button
                            onClick={(e) => onInsuranceClick(biomarker, e)}
                            className="p-2 text-slate-400 dark:text-slate-500 hover:text-wellness-600 dark:hover:text-wellness-400 hover:bg-wellness-50 dark:hover:bg-wellness-900/30 rounded-lg transition-colors"
                          >
                            <Shield className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <div className="mt-4 pt-4 border-t border-red-100 dark:border-red-800">
                        <Suspense fallback={<LazyLoadSpinner />}>
                          <BiomarkerAIGuidance biomarker={biomarker} allBiomarkers={biomarkers} />
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
        {inRangeBiomarkers.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-wellness-500" />
              In Range ({inRangeBiomarkers.length})
            </h2>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
              {inRangeBiomarkers.map((biomarker) => {
                const isSelected = selectedBiomarker?.id === biomarker.id;

                return (
                  <div
                    key={biomarker.id}
                    onClick={() => onSelectBiomarker(isSelected ? null : biomarker)}
                    className={`p-4 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-wellness-50/50 dark:bg-wellness-900/20'
                        : 'hover:bg-slate-50/50 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
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
                        >
                          <LineChart className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="mt-4 pt-4 border-t border-wellness-100 dark:border-wellness-800">
                        <Suspense fallback={<LazyLoadSpinner />}>
                          <BiomarkerAIGuidance biomarker={biomarker} allBiomarkers={biomarkers} />
                        </Suspense>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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
