/**
 * InsuranceKnowledgeBase Component
 *
 * A comprehensive insurance knowledge management interface with intelligent search,
 * browsing, comparison, and insights capabilities.
 */

import React from 'react';
import {
  Search, Database, Filter, Shield, DollarSign,
  CheckCircle, XCircle, ChevronRight, FileText,
  TrendingUp, Info, X
} from 'lucide-react';
import type { InsurancePlan } from '../../types';
import { categoryIcons, categoryNames, popularSearches, tabs } from './insuranceKnowledgeBaseConstants';
import {
  useInsuranceKnowledgeBase,
  formatCurrency,
  getCoverageColor,
  getCoverageBarColor
} from './useInsuranceKnowledgeBase';

interface InsuranceKnowledgeBaseProps {
  plans: InsurancePlan[];
}

export default function InsuranceKnowledgeBase({ plans }: InsuranceKnowledgeBaseProps) {
  const {
    activeTab, searchQuery, normalizedPlans, searchResults, selectedCategory,
    selectedPlanIds, showFilters, filters, availableCategories, selectedPlans,
    avgCoverage, avgPremium,
    setActiveTab, setSearchQuery, setFilters, handleSearch, clearSearchResults,
    clearFilters, toggleFilters, getBenefitsByCategory, togglePlanSelection,
    toggleCategory, clearSelectedCategory
  } = useInsuranceKnowledgeBase(plans);

  // Empty state
  if (plans.length === 0) {
    return (
      <div className="animate-fade-in max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Knowledge Base</h1>
          <p className="text-slate-500 mt-1">Search and analyze your insurance coverage</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/60 p-12 text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Database className="w-8 h-8 text-purple-500" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No Insurance Plans Yet</h3>
          <p className="text-slate-500 mb-6 max-w-md mx-auto">
            Upload your insurance documents to build your knowledge base.
          </p>
          <button className="inline-flex items-center px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-indigo-600 rounded-xl hover:from-purple-600 hover:to-indigo-700 shadow-lg shadow-purple-500/25 transition-all duration-200">
            <FileText className="w-4 h-4 mr-2" />
            Upload Insurance Document
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Knowledge Base</h1>
            <p className="text-slate-500 mt-1">Search and analyze your insurance coverage</p>
          </div>
          <div className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg border border-purple-200 text-sm">
            <span className="font-medium">{normalizedPlans.length}</span> Plans
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/60 p-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search for services, benefits, or coverage details..."
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-300 transition-all"
            />
          </div>
          <button
            onClick={toggleFilters}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl border transition-all ${
              showFilters ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
          <button
            onClick={handleSearch}
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-medium hover:from-purple-600 hover:to-indigo-700 shadow-lg shadow-purple-500/25 transition-all"
          >
            Search
          </button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Plan Type</label>
                <select
                  value={filters.preferredPlanTypes?.[0] || ''}
                  onChange={(e) => setFilters(prev => ({
                    ...prev,
                    preferredPlanTypes: e.target.value ? [e.target.value as 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP'] : undefined
                  }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-300"
                >
                  <option value="">All Types</option>
                  <option value="HMO">HMO</option>
                  <option value="PPO">PPO</option>
                  <option value="EPO">EPO</option>
                  <option value="POS">POS</option>
                  <option value="HDHP">HDHP</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Max Monthly Premium</label>
                <input
                  type="number"
                  value={filters.maxPremium || ''}
                  onChange={(e) => setFilters(prev => ({
                    ...prev,
                    maxPremium: e.target.value ? parseInt(e.target.value) : undefined
                  }))}
                  placeholder="Any amount"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Expected Usage</label>
                <select
                  value={filters.expectedUsage || ''}
                  onChange={(e) => setFilters(prev => ({
                    ...prev,
                    expectedUsage: e.target.value as 'low' | 'medium' | 'high' | undefined
                  }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-300"
                >
                  <option value="">Any Usage Level</option>
                  <option value="low">Low Usage</option>
                  <option value="medium">Medium Usage</option>
                  <option value="high">High Usage</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={clearFilters} className="text-sm text-slate-500 hover:text-slate-700">
                Clear Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="bg-slate-100 rounded-xl p-1 inline-flex mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search Results */}
      {searchResults.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Search Results ({searchResults.length})</h2>
            <button onClick={clearSearchResults} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <X className="w-4 h-4" />
              Clear Results
            </button>
          </div>
          <div className="space-y-4">
            {searchResults.map((result) => (
              <div key={result.plan.id} className="bg-white rounded-2xl border border-slate-200/60 p-6 hover:shadow-soft transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-semibold text-slate-900">{result.plan.planName}</h3>
                      <span className="px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-medium rounded-lg border border-purple-200">
                        {result.plan.planType}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">{result.plan.insurerName}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-purple-600">{result.score}</div>
                    <p className="text-xs text-slate-500">Match Score</p>
                  </div>
                </div>
                {result.matchedCriteria.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {result.matchedCriteria.map((criteria, idx) => (
                      <span key={idx} className="px-2.5 py-1 bg-wellness-50 text-wellness-700 text-xs rounded-lg border border-wellness-200">
                        {criteria}
                      </span>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Est. Annual Cost</p>
                    <p className="text-lg font-semibold text-slate-900">{formatCurrency(result.estimatedCosts.annual)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Monthly Premium</p>
                    <p className="text-lg font-semibold text-slate-900">{formatCurrency(result.estimatedCosts.breakdown.premium)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Deductible</p>
                    <p className="text-lg font-semibold text-slate-900">{formatCurrency(result.estimatedCosts.breakdown.deductible)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Search Tab */}
          {activeTab === 'search' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Popular Searches</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {popularSearches.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { setSearchQuery(item.label); handleSearch(); }}
                      className="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200/60 hover:border-purple-200 hover:bg-purple-50/50 transition-all group"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        item.color === 'blue' ? 'bg-blue-50 text-blue-600' :
                        item.color === 'red' ? 'bg-red-50 text-red-600' :
                        item.color === 'purple' ? 'bg-purple-50 text-purple-600' :
                        'bg-wellness-50 text-wellness-600'
                      }`}>
                        <item.icon className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-medium text-slate-700 group-hover:text-purple-700">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Your Plans</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {normalizedPlans.map((plan) => (
                    <div key={plan.id} className="bg-white rounded-2xl border border-slate-200/60 p-5 hover:shadow-soft transition-all">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-semibold text-slate-900">{plan.planName}</h3>
                          <p className="text-sm text-slate-500">{plan.insurerName}</p>
                        </div>
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg">{plan.planType}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="p-3 bg-slate-50 rounded-lg">
                          <p className="text-xs text-slate-500 mb-1">Coverage Score</p>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-slate-900">{plan.keyMetrics.coverageComprehensiveness}</span>
                            <span className="text-xs text-slate-400">/10</span>
                          </div>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-lg">
                          <p className="text-xs text-slate-500 mb-1">Cost Rating</p>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-slate-900">{plan.keyMetrics.overallCostRating}</span>
                            <span className="text-xs text-slate-400">/10</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                        <span className="text-xs text-slate-500">{plan.normalizedBenefits.length} benefits indexed</span>
                        <button className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1">
                          View Details <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Browse Tab */}
          {activeTab === 'browse' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Browse by Category</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {availableCategories.map((category) => {
                    const Icon = categoryIcons[category] || Shield;
                    const benefits = getBenefitsByCategory(category);
                    return (
                      <button
                        key={category}
                        onClick={() => toggleCategory(category)}
                        className={`p-4 rounded-xl border text-left transition-all ${
                          selectedCategory === category
                            ? 'bg-purple-50 border-purple-200'
                            : 'bg-white border-slate-200/60 hover:border-purple-200 hover:bg-purple-50/30'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                          selectedCategory === category ? 'bg-purple-100' : 'bg-slate-100'
                        }`}>
                          <Icon className={`w-5 h-5 ${selectedCategory === category ? 'text-purple-600' : 'text-slate-600'}`} />
                        </div>
                        <h3 className={`font-medium text-sm mb-1 ${selectedCategory === category ? 'text-purple-900' : 'text-slate-900'}`}>
                          {categoryNames[category]}
                        </h3>
                        <p className="text-xs text-slate-500">{benefits.length} services</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedCategory && (
                <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const Icon = categoryIcons[selectedCategory];
                        return (
                          <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                            <Icon className="w-6 h-6 text-purple-600" />
                          </div>
                        );
                      })()}
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">{categoryNames[selectedCategory]}</h2>
                        <p className="text-sm text-slate-500">Coverage across all plans</p>
                      </div>
                    </div>
                    <button onClick={clearSelectedCategory} className="text-slate-400 hover:text-slate-600">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {getBenefitsByCategory(selectedCategory).map(({ planName, benefit }, idx) => (
                      <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-slate-900">{benefit.serviceName}</h4>
                            <span className="text-xs text-slate-400">({planName})</span>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            {benefit.inNetworkCoverage.covered ? (
                              <>
                                <span className="text-wellness-600 flex items-center gap-1">
                                  <CheckCircle className="w-4 h-4" /> Covered
                                </span>
                                {benefit.inNetworkCoverage.costStructure.type === 'copay' && (
                                  <span className="text-slate-600">{benefit.inNetworkCoverage.costStructure.amount ? `$${benefit.inNetworkCoverage.costStructure.amount} copay` : '--'}</span>
                                )}
                                {benefit.inNetworkCoverage.costStructure.type === 'coinsurance' && (
                                  <span className="text-slate-600">{benefit.inNetworkCoverage.costStructure.percentage ? `${benefit.inNetworkCoverage.costStructure.percentage}% coinsurance` : '--'}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-red-600 flex items-center gap-1">
                                <XCircle className="w-4 h-4" /> Not Covered
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${getCoverageColor(benefit.inNetworkCoverage.coveragePercentage)}`}>
                          {benefit.inNetworkCoverage.coveragePercentage}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Compare Tab */}
          {activeTab === 'compare' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-2">Compare Plans</h2>
                <p className="text-sm text-slate-500 mb-6">Select plans to compare their coverage side by side</p>
                <div className="space-y-3 mb-6">
                  {normalizedPlans.map((plan) => (
                    <label
                      key={plan.id}
                      className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                        selectedPlanIds.includes(plan.id) ? 'bg-purple-50 border-purple-200' : 'bg-slate-50 border-slate-200 hover:border-purple-200'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <input
                          type="checkbox"
                          checked={selectedPlanIds.includes(plan.id)}
                          onChange={() => togglePlanSelection(plan.id)}
                          className="w-5 h-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                        />
                        <div>
                          <h4 className="font-medium text-slate-900">{plan.planName}</h4>
                          <p className="text-sm text-slate-500">{plan.insurerName} - {plan.planType}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-slate-900">
                          {formatCurrency(plan.normalizedCosts.find(c => c.costType === 'premium')?.amount || 0)}/mo
                        </p>
                        <p className="text-xs text-slate-500">Premium</p>
                      </div>
                    </label>
                  ))}
                </div>

                {selectedPlans.length >= 2 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-3 px-4 text-sm font-semibold text-slate-900">Feature</th>
                          {selectedPlans.map(plan => (
                            <th key={plan.id} className="text-left py-3 px-4 text-sm font-semibold text-slate-900">{plan.planName}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        <tr>
                          <td className="py-3 px-4 text-sm text-slate-600">Plan Type</td>
                          {selectedPlans.map(plan => (
                            <td key={plan.id} className="py-3 px-4 text-sm font-medium text-slate-900">{plan.planType}</td>
                          ))}
                        </tr>
                        <tr>
                          <td className="py-3 px-4 text-sm text-slate-600">Coverage Score</td>
                          {selectedPlans.map(plan => (
                            <td key={plan.id} className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-slate-200 rounded-full h-2">
                                  <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${plan.keyMetrics.coverageComprehensiveness * 10}%` }} />
                                </div>
                                <span className="text-sm font-medium text-slate-900">{plan.keyMetrics.coverageComprehensiveness}/10</span>
                              </div>
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="py-3 px-4 text-sm text-slate-600">Cost Rating</td>
                          {selectedPlans.map(plan => (
                            <td key={plan.id} className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-slate-200 rounded-full h-2">
                                  <div className="bg-wellness-500 h-2 rounded-full" style={{ width: `${plan.keyMetrics.overallCostRating * 10}%` }} />
                                </div>
                                <span className="text-sm font-medium text-slate-900">{plan.keyMetrics.overallCostRating}/10</span>
                              </div>
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="py-3 px-4 text-sm text-slate-600">Network Quality</td>
                          {selectedPlans.map(plan => (
                            <td key={plan.id} className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-slate-200 rounded-full h-2">
                                  <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${plan.keyMetrics.networkQuality * 10}%` }} />
                                </div>
                                <span className="text-sm font-medium text-slate-900">{plan.keyMetrics.networkQuality}/10</span>
                              </div>
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="py-3 px-4 text-sm text-slate-600">Est. Annual Cost</td>
                          {selectedPlans.map(plan => (
                            <td key={plan.id} className="py-3 px-4 text-sm font-medium text-slate-900">
                              {formatCurrency(plan.keyMetrics.estimatedAnnualCost.mediumUsage)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <Info className="w-8 h-8 mx-auto mb-3 text-slate-400" />
                    <p>Select at least 2 plans to compare</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Insights Tab */}
          {activeTab === 'insights' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                      <Shield className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Total Plans</p>
                      <p className="text-2xl font-bold text-slate-900">{normalizedPlans.length}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-wellness-100 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-wellness-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Avg Coverage</p>
                      <p className="text-2xl font-bold text-slate-900">{avgCoverage}/10</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Avg Premium</p>
                      <p className="text-2xl font-bold text-slate-900">{formatCurrency(avgPremium)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Plan Recommendations</h2>
                <div className="space-y-4">
                  {normalizedPlans.map((plan) => (
                    <div key={plan.id} className="p-4 bg-slate-50 rounded-xl">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-medium text-slate-900">{plan.planName}</h3>
                          <p className="text-sm text-slate-500">{plan.insurerName}</p>
                        </div>
                        <span className="px-3 py-1 bg-wellness-50 text-wellness-700 text-xs font-medium rounded-lg border border-wellness-200">
                          Good Fit
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Best For</p>
                          <div className="flex flex-wrap gap-1">
                            {plan.keyMetrics.topBenefits.slice(0, 2).map((benefit, idx) => (
                              <span key={idx} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">{benefit}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Potential Gaps</p>
                          <div className="flex flex-wrap gap-1">
                            {plan.keyMetrics.potentialGaps.length > 0 ? (
                              plan.keyMetrics.potentialGaps.slice(0, 2).map((gap, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded">{gap}</span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-400">None identified</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1 text-slate-600">
                          <TrendingUp className="w-4 h-4 text-wellness-500" />
                          Coverage: {plan.keyMetrics.coverageComprehensiveness}/10
                        </div>
                        <div className="flex items-center gap-1 text-slate-600">
                          <DollarSign className="w-4 h-4 text-blue-500" />
                          Cost: {plan.keyMetrics.overallCostRating}/10
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Coverage Analysis</h2>
                <div className="space-y-3">
                  {availableCategories.slice(0, 6).map((category) => {
                    const benefits = getBenefitsByCategory(category);
                    const avgCoveragePct = benefits.length > 0
                      ? Math.round(benefits.reduce((sum, b) => sum + b.benefit.inNetworkCoverage.coveragePercentage, 0) / benefits.length)
                      : 0;
                    const Icon = categoryIcons[category];
                    return (
                      <div key={category} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Icon className="w-5 h-5 text-slate-500" />
                          <span className="text-sm font-medium text-slate-700">{categoryNames[category]}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-24 bg-slate-200 rounded-full h-2">
                            <div className={`h-2 rounded-full ${getCoverageBarColor(avgCoveragePct)}`} style={{ width: `${avgCoveragePct}%` }} />
                          </div>
                          <span className="text-sm font-medium text-slate-900 w-12 text-right">{avgCoveragePct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
