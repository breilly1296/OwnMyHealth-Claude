/**
 * InsuranceHub Component
 *
 * A comprehensive insurance management dashboard that provides users with tools to:
 * - View and manage their insurance plans
 * - Analyze healthcare costs with projections and breakdowns
 * - Find in-network healthcare providers via Healthcare.gov
 * - Learn about insurance terms and discover money-saving strategies
 *
 * Features four main tabs:
 * 1. My Plans - Display uploaded insurance plans with coverage details and accuracy scores
 * 2. Cost Analysis - Show cost projections (premiums, deductibles, copays, coinsurance)
 *    along with a visual breakdown and health profile summary
 * 3. Find Providers - Search for healthcare providers by location, specialty, and check
 *    if they're in-network for your plan (via CMS Marketplace API)
 * 4. Learn & Save - Provide optimization tips with potential savings, an expandable
 *    glossary of insurance terms, and educational modules
 *
 * Stats grid shows: active plans count, covered services, estimated annual cost,
 * and potential savings from optimization tips.
 *
 * @module components/insurance/InsuranceHub
 */

import React, { useState } from 'react';
import {
  Shield,
  Upload,
  CreditCard,
  BookOpen,
  Lightbulb,
  FileText,
  CheckCircle,
  DollarSign,
  TrendingDown,
  Clock,
  ChevronRight,
  Plus,
  Sparkles,
  Info,
  AlertCircle,
  Search,
  ShoppingCart
} from 'lucide-react';
import type { InsurancePlan, PersonalizedInsuranceGuide } from '../../types';
import MarketplaceProviderSearch from './MarketplaceProviderSearch';
import MarketplacePlanSearch from './MarketplacePlanSearch';

interface InsuranceHubProps {
  insurancePlans: InsurancePlan[];
  guide: PersonalizedInsuranceGuide;
  onUploadSBC: () => void;
  onSmartUpload: () => void;
  onViewPlanDetails: () => void;
}

type TabType = 'plans' | 'costs' | 'find-plans' | 'providers' | 'learn';

export default function InsuranceHub({
  insurancePlans,
  guide,
  onUploadSBC,
  onSmartUpload,
  onViewPlanDetails
}: InsuranceHubProps) {
  const [activeTab, setActiveTab] = useState<TabType>('plans');
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const totalPotentialSavings = guide.optimizationTips
    .filter(tip => tip.potentialSavings)
    .reduce((sum, tip) => sum + (tip.potentialSavings || 0), 0);

  const tabs = [
    { id: 'plans' as TabType, label: 'My Plans', icon: Shield },
    { id: 'costs' as TabType, label: 'Cost Analysis', icon: CreditCard },
    { id: 'find-plans' as TabType, label: 'Find Plans', icon: ShoppingCart },
    { id: 'providers' as TabType, label: 'Find Providers', icon: Search },
    { id: 'learn' as TabType, label: 'Learn & Save', icon: Lightbulb },
  ];

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Insurance</h1>
        <p className="text-slate-500 mt-1">Manage plans, track costs, and optimize coverage</p>
      </div>

      {/* Stats Grid */}
      {insurancePlans.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5 opacity-70" />
              <span className="text-sm font-medium opacity-70">Plans</span>
            </div>
            <div className="text-3xl font-bold">{insurancePlans.length}</div>
            <p className="text-sm opacity-60 mt-1">active</p>
          </div>

          <div className="bg-wellness-500 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 opacity-70" />
              <span className="text-sm font-medium opacity-70">Services</span>
            </div>
            <div className="text-3xl font-bold">
              {insurancePlans.reduce((sum, p) => sum + p.benefits.length, 0)}
            </div>
            <p className="text-sm opacity-60 mt-1">covered</p>
          </div>

          <div className="bg-amber-500 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-5 h-5 opacity-70" />
              <span className="text-sm font-medium opacity-70">Est. Cost</span>
            </div>
            <div className="text-3xl font-bold">
              {guide.costProjections.length > 0
                ? formatCurrency(guide.costProjections[0]?.estimatedCosts.total || 0)
                : '$0'}
            </div>
            <p className="text-sm opacity-60 mt-1">annual</p>
          </div>

          <div className="bg-blue-500 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-5 h-5 opacity-70" />
              <span className="text-sm font-medium opacity-70">Savings</span>
            </div>
            <div className="text-3xl font-bold">
              {totalPotentialSavings > 0 ? formatCurrency(totalPotentialSavings) : '$0'}
            </div>
            <p className="text-sm opacity-60 mt-1">potential</p>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="bg-slate-100 rounded-xl p-1 inline-flex mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {/* Plans Tab */}
        {activeTab === 'plans' && (
          <div className="space-y-6">
            {insurancePlans.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/60">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Shield className="w-10 h-10 text-blue-500" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-2">No insurance plans yet</h3>
                <p className="text-slate-500 mb-8 max-w-md mx-auto">
                  Upload your Summary of Benefits and Coverage (SBC) document to get personalized insights.
                </p>
                <div className="flex justify-center gap-3">
                  <button
                    onClick={onSmartUpload}
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-indigo-600 rounded-xl hover:from-purple-600 hover:to-indigo-700 shadow-lg shadow-purple-500/25 transition-all"
                  >
                    <Sparkles className="w-4 h-4" />
                    Smart Upload
                  </button>
                  <button
                    onClick={onUploadSBC}
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                  >
                    <Upload className="w-4 h-4" />
                    Upload SBC
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {insurancePlans.map((plan) => (
                  <div
                    key={plan.id}
                    className="bg-white rounded-2xl border border-slate-200/60 p-6 hover:border-blue-200 transition-all cursor-pointer group"
                    onClick={onViewPlanDetails}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Shield className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900 mb-1">{plan.planName}</h3>
                          <p className="text-sm text-slate-500 mb-3">{plan.insurerName}</p>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-medium px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg">
                              {plan.planType}
                            </span>
                            <span className="text-xs text-slate-400">
                              Effective {new Date(plan.effectiveDate).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors" />
                    </div>

                    <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Benefits</p>
                        <p className="font-semibold text-slate-900">{plan.benefits.length} services</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Cost Categories</p>
                        <p className="font-semibold text-slate-900">{plan.costs.length} types</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Accuracy</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${Math.round(plan.extractionConfidence * 100)}%` }}
                            />
                          </div>
                          <span className="text-sm font-semibold text-slate-900">
                            {Math.round(plan.extractionConfidence * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add another plan */}
                <button
                  onClick={onSmartUpload}
                  className="w-full p-6 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50 transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  <span className="font-medium">Add another plan</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Costs Tab */}
        {activeTab === 'costs' && (
          <div className="space-y-6">
            {guide.costProjections.length === 0 ? (
              <div className="text-center py-16 bg-slate-50 rounded-2xl">
                <CreditCard className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600">No cost projections available</p>
                <p className="text-sm text-slate-400 mt-1">Upload an insurance plan to see estimates</p>
              </div>
            ) : (
              <>
                {/* Cost Projections */}
                {guide.costProjections.map((projection, index) => (
                  <div key={index} className="bg-white rounded-2xl border border-slate-200/60 p-6">
                    <div className="flex items-start justify-between mb-6">
                      <div>
                        <h3 className="font-semibold text-slate-900 mb-1">{projection.scenario}</h3>
                        <p className="text-sm text-slate-500">{projection.description}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-slate-900">
                          {formatCurrency(projection.estimatedCosts.total)}
                        </p>
                        <p className="text-sm text-slate-500">per year</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 mb-1">Premiums</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatCurrency(projection.estimatedCosts.premiums)}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 mb-1">Deductibles</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatCurrency(projection.estimatedCosts.deductibles)}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 mb-1">Copays</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatCurrency(projection.estimatedCosts.copays)}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 mb-1">Coinsurance</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatCurrency(projection.estimatedCosts.coinsurance)}
                        </p>
                      </div>
                    </div>

                    {/* Cost breakdown visualization */}
                    <div className="mt-6">
                      <p className="text-xs text-slate-400 mb-3">Cost breakdown</p>
                      <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex">
                        <div
                          className="bg-blue-500 h-full"
                          style={{ width: `${(projection.estimatedCosts.premiums / projection.estimatedCosts.total) * 100}%` }}
                          title="Premiums"
                        />
                        <div
                          className="bg-amber-500 h-full"
                          style={{ width: `${(projection.estimatedCosts.deductibles / projection.estimatedCosts.total) * 100}%` }}
                          title="Deductibles"
                        />
                        <div
                          className="bg-emerald-500 h-full"
                          style={{ width: `${(projection.estimatedCosts.copays / projection.estimatedCosts.total) * 100}%` }}
                          title="Copays"
                        />
                        <div
                          className="bg-purple-500 h-full"
                          style={{ width: `${(projection.estimatedCosts.coinsurance / projection.estimatedCosts.total) * 100}%` }}
                          title="Coinsurance"
                        />
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-slate-500">Premiums</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-amber-500" />
                          <span className="text-slate-500">Deductibles</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="text-slate-500">Copays</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-purple-500" />
                          <span className="text-slate-500">Coinsurance</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Your Health Profile */}
                <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Info className="w-4 h-4 text-blue-500" />
                    </div>
                    <h3 className="font-semibold text-slate-900">Your Health Profile</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Conditions</p>
                      <div className="space-y-2">
                        {guide.userProfile.detectedConditions.length > 0 ? (
                          guide.userProfile.detectedConditions.map((cond, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <AlertCircle className="w-4 h-4 text-amber-500" />
                              <span className="text-slate-700">{cond}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-slate-500">No conditions detected</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Recommended Services</p>
                      <div className="space-y-2">
                        {guide.userProfile.recommendedServices.slice(0, 4).map((svc, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                            <span className="text-slate-700">{svc}</span>
                          </div>
                        ))}
                        {guide.userProfile.recommendedServices.length > 4 && (
                          <p className="text-xs text-slate-400">
                            +{guide.userProfile.recommendedServices.length - 4} more
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Find Plans Tab */}
        {activeTab === 'find-plans' && (
          <MarketplacePlanSearch />
        )}

        {/* Providers Tab */}
        {activeTab === 'providers' && (
          <MarketplaceProviderSearch insurancePlans={insurancePlans} />
        )}

        {/* Learn Tab */}
        {activeTab === 'learn' && (
          <div className="space-y-6">
            {/* Money-Saving Tips */}
            {guide.optimizationTips.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-5 h-5 text-green-500" />
                    <h2 className="font-semibold text-slate-900">Ways to Save</h2>
                  </div>
                  {totalPotentialSavings > 0 && (
                    <span className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">
                      Save up to {formatCurrency(totalPotentialSavings)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {guide.optimizationTips.slice(0, 4).map((tip, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-slate-200/60 p-5 hover:border-green-200 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-medium text-slate-900">{tip.title}</h3>
                        <span className={`text-xs px-2 py-1 rounded-lg ${
                          tip.difficulty === 'Easy' ? 'bg-green-50 text-green-700' :
                          tip.difficulty === 'Moderate' ? 'bg-amber-50 text-amber-700' :
                          'bg-red-50 text-red-700'
                        }`}>
                          {tip.difficulty}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mb-4">{tip.description}</p>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-1 text-slate-400">
                          <Clock className="w-4 h-4" />
                          {tip.timeToImplement}
                        </div>
                        {tip.potentialSavings && (
                          <span className="font-semibold text-green-600">
                            Save {formatCurrency(tip.potentialSavings)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Glossary */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="w-5 h-5 text-purple-500" />
                <h2 className="font-semibold text-slate-900">Insurance Terms</h2>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200/60 divide-y divide-slate-100">
                {guide.glossary.slice(0, 6).map((term, i) => (
                  <div key={i} className="p-4">
                    <button
                      onClick={() => setExpandedTerm(expandedTerm === term.term ? null : term.term)}
                      className="w-full flex items-center justify-between text-left"
                    >
                      <span className="font-medium text-slate-900">{term.term}</span>
                      <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${
                        expandedTerm === term.term ? 'rotate-90' : ''
                      }`} />
                    </button>
                    {expandedTerm === term.term && (
                      <div className="mt-3 space-y-3">
                        <p className="text-sm text-slate-600">{term.definition}</p>
                        {term.userSpecificExample && (
                          <div className="p-3 bg-blue-50 rounded-xl">
                            <p className="text-sm text-blue-700">
                              <span className="font-medium">Your example:</span> {term.userSpecificExample}
                            </p>
                          </div>
                        )}
                        {term.tips.length > 0 && (
                          <div className="space-y-1">
                            {term.tips.slice(0, 2).map((tip, ti) => (
                              <div key={ti} className="flex items-start gap-2 text-sm text-slate-500">
                                <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                {tip}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Education Modules Preview */}
            {guide.educationModules.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="w-5 h-5 text-indigo-500" />
                  <h2 className="font-semibold text-slate-900">Learning Modules</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {guide.educationModules.slice(0, 2).map((module, i) => (
                    <div key={i} className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100 p-5">
                      <h3 className="font-medium text-slate-900 mb-2">{module.title}</h3>
                      <p className="text-sm text-slate-600 mb-4">{module.description}</p>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>{module.terms.length} terms</span>
                        <span>{module.scenarios.length} scenarios</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
