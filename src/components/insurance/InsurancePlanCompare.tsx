/**
 * InsuranceKnowledgePanel (InsurancePlanCompare) Component
 *
 * An advanced insurance analysis tool that uses a knowledge base to help users
 * understand, search, and compare their insurance plans intelligently.
 *
 * Features four main tabs:
 * 1. Smart Search - Filter plans by type (HMO, PPO, etc.), max premium, and expected usage
 *    Returns scored results with matched criteria and cost estimates
 * 2. Plan Comparison - Side-by-side comparison matrix with category scores (1-10),
 *    recommendations (excellent/good/fair fit), and best-for/concerns analysis
 * 3. Analytics - Dashboard with plan metrics (count, avg premium, plan types, coverage score)
 *    and visual distribution charts
 * 4. Coverage Analysis - Compare how different plans cover specific services
 *    Shows coverage percentage, cost structure, deductible application, and requirements
 *
 * Integrates with the insuranceKB utility for plan normalization and intelligent indexing.
 *
 * @module components/insurance/InsurancePlanCompare
 */

import React, { useState, useEffect } from 'react';
import { Database, Search, BarChart3, Shield, DollarSign, CheckCircle, XCircle, Eye, GitCompare as Compare, Network, Target } from 'lucide-react';
import type { InsurancePlan } from '../../types';
import {
  insuranceKB,
  type NormalizedInsurancePlan,
  type PlanSearchCriteria,
  type PlanSearchResult,
  type PlanComparison
} from '../../utils/insurance/insuranceKnowledgeBase';

interface InsuranceKnowledgePanelProps {
  plans: InsurancePlan[];
  isOpen: boolean;
  onClose: () => void;
}

export default function InsuranceKnowledgePanel({ plans, isOpen, onClose }: InsuranceKnowledgePanelProps) {
  const [normalizedPlans, setNormalizedPlans] = useState<NormalizedInsurancePlan[]>([]);
  const [searchCriteria, setSearchCriteria] = useState<PlanSearchCriteria>({});
  const [searchResults, setSearchResults] = useState<PlanSearchResult[]>([]);
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);
  const [comparison, setComparison] = useState<PlanComparison | null>(null);
  const [activeTab, setActiveTab] = useState<'search' | 'compare' | 'analyze' | 'coverage'>('search');
  const [selectedService, setSelectedService] = useState<string>('');
  const [serviceCoverage, setServiceCoverage] = useState<ServiceCoverageComparison[]>([]);

  // Initialize knowledge base with plans
  useEffect(() => {
    if (plans.length > 0) {
      const normalized = plans.map(plan => insuranceKB.addPlan(plan));
      setNormalizedPlans(normalized);
    }
  }, [plans]);

  // Handle search
  const handleSearch = () => {
    const results = insuranceKB.searchPlans(searchCriteria);
    setSearchResults(results);
  };

  // Handle plan comparison
  const handleCompare = () => {
    if (selectedPlans.length >= 2) {
      const comparisonResult = insuranceKB.comparePlans(selectedPlans);
      setComparison(comparisonResult);
      setActiveTab('compare');
    }
  };

  // Handle service coverage analysis
  const handleServiceCoverage = () => {
    if (selectedService) {
      const coverage = insuranceKB.getServiceCoverage(selectedService);
      setServiceCoverage(coverage);
    }
  };

  // Get plan by ID
  const getPlanById = (planId: string) => {
    return normalizedPlans.find(p => p.id === planId);
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Get coverage color
  const getCoverageColor = (coveragePercentage: number) => {
    if (coveragePercentage >= 90) return 'text-green-600 bg-green-100';
    if (coveragePercentage >= 70) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Database className="w-6 h-6 text-purple-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Insurance Knowledge Base</h2>
              <p className="text-sm text-gray-600">
                Intelligent analysis of {normalizedPlans.length} normalized insurance plans
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200">
          {[
            { id: 'search', label: 'Smart Search', icon: Search },
            { id: 'compare', label: 'Plan Comparison', icon: Compare },
            { id: 'analyze', label: 'Analytics', icon: BarChart3 },
            { id: 'coverage', label: 'Coverage Analysis', icon: Shield }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-purple-500 text-purple-600 bg-purple-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4 mr-2" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Smart Search Tab */}
          {activeTab === 'search' && (
            <div className="space-y-6">
              {/* Search Criteria */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                  <Filter className="w-5 h-5 mr-2 text-purple-600" />
                  Search Criteria
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Plan Types
                    </label>
                    <select
                      multiple
                      value={searchCriteria.preferredPlanTypes || []}
                      onChange={(e) => setSearchCriteria(prev => ({
                        ...prev,
                        preferredPlanTypes: Array.from(e.target.selectedOptions, option => option.value as PlanSearchCriteria['preferredPlanTypes'][number])
                      }))}
                      className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                    >
                      <option value="HMO">HMO</option>
                      <option value="PPO">PPO</option>
                      <option value="EPO">EPO</option>
                      <option value="POS">POS</option>
                      <option value="HDHP">HDHP</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Max Monthly Premium
                    </label>
                    <input
                      type="number"
                      value={searchCriteria.maxPremium || ''}
                      onChange={(e) => setSearchCriteria(prev => ({
                        ...prev,
                        maxPremium: e.target.value ? parseInt(e.target.value) : undefined
                      }))}
                      className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                      placeholder="Enter amount"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Expected Usage
                    </label>
                    <select
                      value={searchCriteria.expectedUsage || ''}
                      onChange={(e) => setSearchCriteria(prev => ({
                        ...prev,
                        expectedUsage: e.target.value as PlanSearchCriteria['expectedUsage']
                      }))}
                      className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                    >
                      <option value="">Select usage level</option>
                      <option value="low">Low Usage</option>
                      <option value="medium">Medium Usage</option>
                      <option value="high">High Usage</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleSearch}
                    className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
                  >
                    Search Plans
                  </button>
                </div>
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Search Results ({searchResults.length})
                  </h3>
                  
                  <div className="space-y-4">
                    {searchResults.map((result, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <h4 className="font-medium text-gray-900">{result.plan.planName}</h4>
                              <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded">
                                {result.plan.planType}
                              </span>
                              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                                Score: {result.score}
                              </span>
                            </div>
                            
                            <p className="text-sm text-gray-600 mb-2">{result.plan.insurerName}</p>
                            
                            <div className="flex flex-wrap gap-2 mb-3">
                              {result.matchedCriteria.map((criteria, cIndex) => (
                                <span key={cIndex} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                                  {criteria}
                                </span>
                              ))}
                            </div>

                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <span className="text-gray-600">Annual Cost:</span>
                                <span className="ml-2 font-medium">{formatCurrency(result.estimatedCosts.annual)}</span>
                              </div>
                              <div>
                                <span className="text-gray-600">Monthly Premium:</span>
                                <span className="ml-2 font-medium">{formatCurrency(result.estimatedCosts.breakdown.premium)}</span>
                              </div>
                              <div>
                                <span className="text-gray-600">Deductible:</span>
                                <span className="ml-2 font-medium">{formatCurrency(result.estimatedCosts.breakdown.deductible)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={selectedPlans.includes(result.plan.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPlans(prev => [...prev, result.plan.id]);
                                } else {
                                  setSelectedPlans(prev => prev.filter(id => id !== result.plan.id));
                                }
                              }}
                              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                            />
                            <button className="text-purple-600 hover:text-purple-800">
                              <Eye className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedPlans.length >= 2 && (
                    <div className="mt-6 flex justify-center">
                      <button
                        onClick={handleCompare}
                        className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center"
                      >
                        <Compare className="w-4 h-4 mr-2" />
                        Compare Selected Plans ({selectedPlans.length})
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Plan Comparison Tab */}
          {activeTab === 'compare' && comparison && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900 flex items-center">
                <Compare className="w-5 h-5 mr-2 text-blue-600" />
                Plan Comparison
              </h3>

              {/* Comparison Matrix */}
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Category
                        </th>
                        {comparison.comparisonMatrix.planScores.map(plan => (
                          <th key={plan.planId} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            {plan.planName}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {comparison.comparisonMatrix.categories.map(category => (
                        <tr key={category}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {category}
                          </td>
                          {comparison.comparisonMatrix.planScores.map(plan => (
                            <td key={plan.planId} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <div className="flex items-center">
                                <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                                  <div 
                                    className="bg-blue-600 h-2 rounded-full" 
                                    style={{ width: `${(plan.scores[category] / 10) * 100}%` }}
                                  />
                                </div>
                                <span className="font-medium">{plan.scores[category]}/10</span>
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recommendations */}
              <div>
                <h4 className="text-md font-medium text-gray-900 mb-3">Recommendations</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {comparison.recommendations.map(rec => {
                    const plan = getPlanById(rec.planId);
                    return (
                      <div key={rec.planId} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="font-medium text-gray-900">{plan?.planName}</h5>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            rec.recommendation === 'excellent_fit' ? 'bg-green-100 text-green-800' :
                            rec.recommendation === 'good_fit' ? 'bg-blue-100 text-blue-800' :
                            rec.recommendation === 'fair_fit' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {rec.recommendation.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="text-gray-600">Best for:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {rec.bestFor.map((item, index) => (
                                <span key={index} className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                                  {item}
                                </span>
                              ))}
                            </div>
                          </div>
                          
                          {rec.concerns.length > 0 && (
                            <div>
                              <span className="text-gray-600">Potential concerns:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {rec.concerns.map((concern, index) => (
                                  <span key={index} className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded">
                                    {concern}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analyze' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900 flex items-center">
                <BarChart3 className="w-5 h-5 mr-2 text-green-600" />
                Plan Analytics
              </h3>

              {/* Plan Metrics Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <Shield className="w-8 h-8 text-blue-600 mr-3" />
                    <div>
                      <p className="text-sm text-blue-600">Total Plans</p>
                      <p className="text-2xl font-bold text-blue-700">{normalizedPlans.length}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <DollarSign className="w-8 h-8 text-green-600 mr-3" />
                    <div>
                      <p className="text-sm text-green-600">Avg Premium</p>
                      <p className="text-2xl font-bold text-green-700">
                        {formatCurrency(
                          normalizedPlans.reduce((sum, plan) => {
                            const premium = plan.normalizedCosts.find(c => c.costType === 'premium')?.amount || 0;
                            return sum + premium;
                          }, 0) / normalizedPlans.length
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <Network className="w-8 h-8 text-purple-600 mr-3" />
                    <div>
                      <p className="text-sm text-purple-600">Plan Types</p>
                      <p className="text-2xl font-bold text-purple-700">
                        {new Set(normalizedPlans.map(p => p.planType)).size}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <Target className="w-8 h-8 text-orange-600 mr-3" />
                    <div>
                      <p className="text-sm text-orange-600">Avg Coverage</p>
                      <p className="text-2xl font-bold text-orange-700">
                        {Math.round(
                          normalizedPlans.reduce((sum, plan) => 
                            sum + plan.keyMetrics.coverageComprehensiveness, 0
                          ) / normalizedPlans.length
                        )}/10
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Plan Distribution */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h4 className="text-md font-medium text-gray-900 mb-4">Plan Type Distribution</h4>
                <div className="space-y-3">
                  {Object.entries(
                    normalizedPlans.reduce((acc, plan) => {
                      acc[plan.planType] = (acc[plan.planType] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>)
                  ).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">{type}</span>
                      <div className="flex items-center">
                        <div className="w-32 bg-gray-200 rounded-full h-2 mr-3">
                          <div 
                            className="bg-blue-600 h-2 rounded-full" 
                            style={{ width: `${(count / normalizedPlans.length) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-600">{count} plans</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Coverage Analysis Tab */}
          {activeTab === 'coverage' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900 flex items-center">
                <Shield className="w-5 h-5 mr-2 text-indigo-600" />
                Service Coverage Analysis
              </h3>

              {/* Service Selection */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center space-x-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Service to Analyze
                    </label>
                    <select
                      value={selectedService}
                      onChange={(e) => setSelectedService(e.target.value)}
                      className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                    >
                      <option value="">Choose a service</option>
                      <option value="PC001">Primary Care Visit</option>
                      <option value="SP001">Specialist Visit</option>
                      <option value="EM001">Emergency Room</option>
                      <option value="DI002">MRI</option>
                      <option value="DI003">CT Scan</option>
                      <option value="LB001">Lab Tests</option>
                      <option value="RX001">Generic Drugs</option>
                      <option value="RX002">Brand Name Drugs</option>
                    </select>
                  </div>
                  <button
                    onClick={handleServiceCoverage}
                    disabled={!selectedService}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Analyze Coverage
                  </button>
                </div>
              </div>

              {/* Coverage Results */}
              {serviceCoverage.length > 0 && (
                <div>
                  <h4 className="text-md font-medium text-gray-900 mb-4">
                    Coverage Comparison for Selected Service
                  </h4>
                  
                  <div className="space-y-4">
                    {serviceCoverage.map((coverage, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h5 className="font-medium text-gray-900">{coverage.planName}</h5>
                            <div className="flex items-center mt-1">
                              {coverage.coverage.covered ? (
                                <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-500 mr-2" />
                              )}
                              <span className={`text-sm ${coverage.coverage.covered ? 'text-green-600' : 'text-red-600'}`}>
                                {coverage.coverage.covered ? 'Covered' : 'Not Covered'}
                              </span>
                            </div>
                          </div>
                          
                          <span className={`px-3 py-1 rounded-full text-sm font-medium ${getCoverageColor(coverage.coverage.coveragePercentage)}`}>
                            {coverage.coverage.coveragePercentage}% Coverage
                          </span>
                        </div>

                        {coverage.coverage.covered && (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                            <div>
                              <span className="text-gray-600">Cost Structure:</span>
                              <div className="font-medium">
                                {coverage.coverage.costStructure.type === 'copay' && 
                                  `$${coverage.coverage.costStructure.amount} copay`}
                                {coverage.coverage.costStructure.type === 'coinsurance' && 
                                  `${coverage.coverage.costStructure.percentage}% coinsurance`}
                                {coverage.coverage.costStructure.type === 'deductible' && 
                                  'Subject to deductible'}
                                {coverage.coverage.costStructure.type === 'not_covered' && 
                                  'Not covered'}
                              </div>
                            </div>
                            
                            <div>
                              <span className="text-gray-600">Deductible Applies:</span>
                              <span className="ml-2 font-medium">
                                {coverage.coverage.deductibleApplies ? 'Yes' : 'No'}
                              </span>
                            </div>
                            
                            {coverage.coverage.annualLimit && (
                              <div>
                                <span className="text-gray-600">Annual Limit:</span>
                                <span className="ml-2 font-medium">{formatCurrency(coverage.coverage.annualLimit)}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {coverage.requirements.length > 0 && (
                          <div className="mt-3">
                            <span className="text-sm text-gray-600">Requirements:</span>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {coverage.requirements.map((req, reqIndex) => (
                                <span key={reqIndex} className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded">
                                  {req.type.replace('_', ' ').toUpperCase()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Knowledge base contains {normalizedPlans.length} normalized plans with intelligent indexing
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}