/**
 * InsuranceLearnTab - Learn & Save tab contents.
 *
 * - Optimization tips with priority badges derived from potentialSavings
 *   (>$500 high, $100-500 medium, <$100 low)
 * - Insurance glossary with search filter (shown when >8 terms)
 * - Educational modules preview
 * - Empty state when no plans exist
 */

import { useMemo, useState } from 'react';
import {
  TrendingDown,
  BookOpen,
  Lightbulb,
  FileText,
  ChevronRight,
  Clock,
  Search,
  Shield,
} from 'lucide-react';
import type { InsurancePlan, PersonalizedInsuranceGuide } from '../../types';
import { formatCurrency } from './InsurancePlanCard';

interface InsuranceLearnTabProps {
  guide: PersonalizedInsuranceGuide;
  plans: InsurancePlan[];
}

type Priority = 'high' | 'medium' | 'low';

function priorityFor(savings: number | undefined): Priority {
  if (!savings || savings < 100) return 'low';
  if (savings > 500) return 'high';
  return 'medium';
}

const PRIORITY_BADGE: Record<Priority, { className: string; label: string }> = {
  high: { className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', label: 'High impact' },
  medium: { className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', label: 'Medium impact' },
  low: { className: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', label: 'Low impact' },
};

const GLOSSARY_FILTER_THRESHOLD = 8;

export default function InsuranceLearnTab({ guide, plans }: InsuranceLearnTabProps) {
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [glossarySearch, setGlossarySearch] = useState('');

  const totalPotentialSavings = useMemo(
    () =>
      (guide.optimizationTips || [])
        .filter((tip) => typeof tip.potentialSavings === 'number')
        .reduce((sum, tip) => sum + (tip.potentialSavings || 0), 0),
    [guide.optimizationTips]
  );

  const filteredGlossary = useMemo(() => {
    const term = glossarySearch.trim().toLowerCase();
    if (!term) return guide.glossary;
    return guide.glossary.filter(
      (g) =>
        g.term.toLowerCase().includes(term) ||
        g.definition.toLowerCase().includes(term)
    );
  }, [guide.glossary, glossarySearch]);

  // Empty state — no plans means the personalization engine has nothing
  // to produce tips/glossary entries from.
  if (plans.length === 0) {
    return (
      <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700">
        <div className="w-20 h-20 bg-gradient-to-br from-amber-100 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Lightbulb className="w-10 h-10 text-amber-500 dark:text-amber-400" />
        </div>
        <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
          Upload a plan to get personalized optimization tips
        </h3>
        <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Once you add an insurance plan, we'll generate savings tips, a glossary, and educational modules tailored to your coverage.
        </p>
      </div>
    );
  }

  const showGlossaryFilter = guide.glossary.length > GLOSSARY_FILTER_THRESHOLD;

  return (
    <div className="space-y-6">
      {/* Ways to Save */}
      {guide.optimizationTips.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-green-500" />
              <h2 className="font-semibold text-slate-900 dark:text-white">Ways to Save</h2>
            </div>
            {totalPotentialSavings > 0 && (
              <span className="text-sm font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-1 rounded-full">
                Save up to {formatCurrency(totalPotentialSavings)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {guide.optimizationTips.slice(0, 6).map((tip) => {
              const priority = priorityFor(tip.potentialSavings);
              const badge = PRIORITY_BADGE[priority];
              return (
                <div
                  key={tip.id}
                  className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-5 hover:border-green-200 dark:hover:border-green-500 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3 gap-2">
                    <h3 className="font-medium text-slate-900 dark:text-white">{tip.title}</h3>
                    <span className={`text-xs px-2 py-1 rounded-lg font-medium flex-shrink-0 ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{tip.description}</p>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
                      <Clock className="w-4 h-4" />
                      {tip.timeToImplement}
                    </div>
                    {tip.potentialSavings ? (
                      <span className="font-semibold text-green-600 dark:text-green-400">
                        Save {formatCurrency(tip.potentialSavings)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">{tip.difficulty}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Glossary */}
      {guide.glossary.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-purple-500" />
              <h2 className="font-semibold text-slate-900 dark:text-white">Insurance Terms</h2>
            </div>
            {showGlossaryFilter && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={glossarySearch}
                  onChange={(e) => setGlossarySearch(e.target.value)}
                  placeholder="Filter terms"
                  className="pl-8 pr-3 py-1.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 w-48"
                />
              </div>
            )}
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {filteredGlossary.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400 text-center">
                No terms match “{glossarySearch}”.
              </div>
            ) : (
              filteredGlossary.map((term) => (
                <div key={term.term} className="p-4">
                  <button
                    onClick={() => setExpandedTerm(expandedTerm === term.term ? null : term.term)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="font-medium text-slate-900 dark:text-white">{term.term}</span>
                    <ChevronRight
                      className={`w-4 h-4 text-slate-400 transition-transform ${
                        expandedTerm === term.term ? 'rotate-90' : ''
                      }`}
                    />
                  </button>
                  {expandedTerm === term.term && (
                    <div className="mt-3 space-y-3">
                      <p className="text-sm text-slate-600 dark:text-slate-300">{term.definition}</p>
                      {term.userSpecificExample && (
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                          <p className="text-sm text-blue-700 dark:text-blue-300">
                            <span className="font-medium">Your example:</span> {term.userSpecificExample}
                          </p>
                        </div>
                      )}
                      {term.tips.length > 0 && (
                        <div className="space-y-1">
                          {term.tips.slice(0, 2).map((tip, ti) => (
                            <div key={ti} className="flex items-start gap-2 text-sm text-slate-500 dark:text-slate-400">
                              <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                              {tip}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Education Modules */}
      {guide.educationModules.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-indigo-500" />
            <h2 className="font-semibold text-slate-900 dark:text-white">Learning Modules</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {guide.educationModules.slice(0, 2).map((module) => (
              <div
                key={module.id}
                className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800/50 p-5"
              >
                <h3 className="font-medium text-slate-900 dark:text-white mb-2">{module.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">{module.description}</p>
                <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <span>{module.terms.length} terms</span>
                  <span>{module.scenarios.length} scenarios</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fallback when plans exist but guide has no content */}
      {guide.optimizationTips.length === 0 &&
        guide.glossary.length === 0 &&
        guide.educationModules.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700">
            <Shield className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Personalized guidance is being generated for your plans.
            </p>
          </div>
        )}
    </div>
  );
}
