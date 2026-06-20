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
import { Database, Search, BarChart3, Shield, DollarSign, CheckCircle, XCircle, Eye, GitCompare as Compare, Network, Target, Filter } from 'lucide-react';
import type { InsurancePlan } from '../../types';
import {
  insuranceKB,
  type NormalizedInsurancePlan,
  type PlanSearchCriteria,
  type PlanSearchResult,
  type PlanComparison,
} from '../../utils/insurance/insuranceKnowledgeBase';
import {
  insuranceApi,
  type BenefitSearchResult,
  type PlanComparisonResult,
} from '../../services/api/insurance';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface InsuranceKnowledgePanelProps {
  plans: InsurancePlan[];
  isOpen: boolean;
  onClose: () => void;
}

// ============================================
// Reusable UI Components
// ============================================

/** Metric card for displaying key statistics */
interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  colorScheme: 'blue' | 'green' | 'purple' | 'orange';
}

const COLOR_SCHEMES = {
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', label: 'text-blue-600', value: 'text-blue-700' },
  green: { bg: 'bg-green-50', border: 'border-green-200', icon: 'text-green-600', label: 'text-green-600', value: 'text-green-700' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600', label: 'text-purple-600', value: 'text-purple-700' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'text-orange-600', label: 'text-orange-600', value: 'text-orange-700' },
} as const;

function MetricCard({ icon: Icon, label, value, colorScheme }: MetricCardProps) {
  const colors = COLOR_SCHEMES[colorScheme];
  return (
    <div className={`${colors.bg} border ${colors.border} rounded-lg p-4`}>
      <div className="flex items-center">
        <Icon className={`w-8 h-8 ${colors.icon} mr-3`} />
        <div>
          <p className={`text-sm ${colors.label}`}>{label}</p>
          <p className={`text-2xl font-bold ${colors.value}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

/** Progress bar for scores */
interface ScoreBarProps {
  score: number;
  maxScore?: number;
  showLabel?: boolean;
  className?: string;
}

function ScoreBar({ score, maxScore = 10, showLabel = true, className = '' }: ScoreBarProps) {
  const percentage = (score / maxScore) * 100;
  return (
    <div className={`flex items-center ${className}`}>
      <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
        <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${percentage}%` }} />
      </div>
      {showLabel && <span className="font-medium">{score}/{maxScore}</span>}
    </div>
  );
}

/** Tag/badge list for displaying multiple items */
interface TagListProps {
  items: string[];
  colorScheme: 'blue' | 'green' | 'orange' | 'yellow' | 'purple';
}

const TAG_COLORS = {
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  orange: 'bg-orange-100 text-orange-700',
  yellow: 'bg-yellow-100 text-yellow-800',
  purple: 'bg-purple-100 text-purple-800',
} as const;

function TagList({ items, colorScheme }: TagListProps) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, index) => (
        <span key={index} className={`px-2 py-1 ${TAG_COLORS[colorScheme]} text-xs rounded`}>
          {item}
        </span>
      ))}
    </div>
  );
}

export default function InsuranceKnowledgePanel({ plans, isOpen, onClose }: InsuranceKnowledgePanelProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
  const [normalizedPlans, setNormalizedPlans] = useState<NormalizedInsurancePlan[]>([]);
  const [searchCriteria, setSearchCriteria] = useState<PlanSearchCriteria>({});
  const [searchResults, setSearchResults] = useState<PlanSearchResult[]>([]);
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);
  const [comparison, setComparison] = useState<PlanComparison | null>(null);
  const [activeTab, setActiveTab] = useState<'search' | 'compare' | 'analyze' | 'coverage'>('search');
  // Real backend-powered benefit data — replaces the old hardcoded-service-code KB demo.
  const [benefitComparison, setBenefitComparison] = useState<PlanComparisonResult | null>(null);
  const [benefitQuery, setBenefitQuery] = useState('');
  const [benefitResults, setBenefitResults] = useState<BenefitSearchResult[]>([]);
  const [benefitSearched, setBenefitSearched] = useState(false);
  const [benefitLoading, setBenefitLoading] = useState(false);
  const [benefitError, setBenefitError] = useState<string | null>(null);

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
  const handleCompare = async () => {
    if (selectedPlans.length < 2) return;
    const comparisonResult = insuranceKB.comparePlans(selectedPlans);
    setComparison(comparisonResult);
    setActiveTab('compare');
    // Augment the client-side scored comparison with the real per-service
    // benefit matrix from the user's extracted SBC data (server-only).
    try {
      const matrix = await insuranceApi.comparePlans(selectedPlans);
      setBenefitComparison(matrix);
    } catch {
      setBenefitComparison(null);
    }
  };

  // Real benefit search across the user's extracted benefits (server-side).
  const handleBenefitSearch = async () => {
    const q = benefitQuery.trim();
    if (!q) return;
    setBenefitLoading(true);
    setBenefitError(null);
    try {
      const results = await insuranceApi.searchBenefits(q);
      setBenefitResults(results);
      setBenefitSearched(true);
    } catch {
      setBenefitError('Benefit search failed. Please try again.');
    } finally {
      setBenefitLoading(false);
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

  /** Render an in-network coverage cell as "$30", "20%", or "—". */
  const formatBenefitCost = (copay?: number, coinsurance?: number): string => {
    if (copay !== undefined && copay !== null) return `$${copay} copay`;
    if (coinsurance !== undefined && coinsurance !== null) return `${coinsurance}% coinsurance`;
    return '—';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="insurance-plan-compare-title"
        tabIndex={-1}
        className="bg-white rounded-lg w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Database className="w-6 h-6 text-purple-600 mr-3" />
            <div>
              <h2 id="insurance-plan-compare-title" className="text-xl font-semibold text-gray-900">Insurance Knowledge Base</h2>
              <p className="text-sm text-gray-600">
                Intelligent analysis of {normalizedPlans.length} normalized insurance plans
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-700">
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
                    <label htmlFor="compare-plan-types" className="block text-sm font-medium text-gray-700 mb-2">
                      Plan Types
                    </label>
                    <select
                      id="compare-plan-types"
                      multiple
                      value={searchCriteria.preferredPlanTypes || []}
                      onChange={(e) => setSearchCriteria(prev => ({
                        ...prev,
                        preferredPlanTypes: Array.from(e.target.selectedOptions, option => option.value as NonNullable<PlanSearchCriteria['preferredPlanTypes']>[number])
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
                    <label htmlFor="compare-max-premium" className="block text-sm font-medium text-gray-700 mb-2">
                      Max Monthly Premium
                    </label>
                    <input
                      id="compare-max-premium"
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
                    <label htmlFor="compare-expected-usage" className="block text-sm font-medium text-gray-700 mb-2">
                      Expected Usage
                    </label>
                    <select
                      id="compare-expected-usage"
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
                            
                            <div className="mb-3">
                              <TagList items={result.matchedCriteria} colorScheme="blue" />
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
                              aria-label={`Select ${result.plan.planName} to compare`}
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
                            <button aria-label="View plan details" className="text-purple-600 hover:text-purple-800">
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
                              <ScoreBar score={plan.scores[category]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Real covered-services matrix from extracted SBC benefits (backend) */}
              {benefitComparison && benefitComparison.benefitComparison.length > 0 && (
                <div>
                  <h4 className="text-md font-medium text-gray-900 mb-3">
                    Covered services (from your SBC data)
                  </h4>
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Service
                            </th>
                            {benefitComparison.plans.map((p) => (
                              <th key={p.id} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                {p.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {benefitComparison.benefitComparison.map((row) => (
                            <tr key={row.serviceName}>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {row.serviceName}
                              </td>
                              {benefitComparison.plans.map((p) => {
                                const cell = row.coverage.find((c) => c.planId === p.id);
                                return (
                                  <td key={p.id} className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                    {cell?.covered ? (
                                      <span className="inline-flex items-center">
                                        <CheckCircle className="w-4 h-4 text-green-500 mr-1.5" />
                                        {formatBenefitCost(cell.copay, cell.coinsurance)}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center text-gray-400">
                                        <XCircle className="w-4 h-4 text-gray-300 mr-1.5" />
                                        Not covered
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

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
                            <div className="mt-1">
                              <TagList items={rec.bestFor} colorScheme="green" />
                            </div>
                          </div>

                          {rec.concerns.length > 0 && (
                            <div>
                              <span className="text-gray-600">Potential concerns:</span>
                              <div className="mt-1">
                                <TagList items={rec.concerns} colorScheme="orange" />
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
                <MetricCard icon={Shield} label="Total Plans" value={normalizedPlans.length} colorScheme="blue" />
                <MetricCard
                  icon={DollarSign}
                  label="Avg Premium"
                  value={formatCurrency(
                    (normalizedPlans || []).reduce((sum, plan) => {
                      const premium = plan.normalizedCosts.find(c => c.costType === 'premium')?.amount || 0;
                      return sum + premium;
                    }, 0) / (normalizedPlans.length || 1)
                  )}
                  colorScheme="green"
                />
                <MetricCard
                  icon={Network}
                  label="Plan Types"
                  value={new Set(normalizedPlans.map(p => p.planType)).size}
                  colorScheme="purple"
                />
                <MetricCard
                  icon={Target}
                  label="Avg Coverage"
                  value={`${Math.round(
                    (normalizedPlans || []).reduce((sum, plan) => sum + plan.keyMetrics.coverageComprehensiveness, 0) /
                    (normalizedPlans.length || 1)
                  )}/10`}
                  colorScheme="orange"
                />
              </div>

              {/* Plan Distribution */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h4 className="text-md font-medium text-gray-900 mb-4">Plan Type Distribution</h4>
                <div className="space-y-3">
                  {Object.entries(
                    (normalizedPlans || []).reduce((acc, plan) => {
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
                Benefit &amp; Coverage Search
              </h3>

              {/* Search box — queries the user's real extracted benefits */}
              <div className="bg-gray-50 rounded-lg p-4">
                <label htmlFor="benefit-search" className="block text-sm font-medium text-gray-700 mb-2">
                  Search your plans&apos; covered services
                </label>
                <div className="flex items-center space-x-3">
                  <input
                    id="benefit-search"
                    type="text"
                    value={benefitQuery}
                    onChange={(e) => setBenefitQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleBenefitSearch(); }}
                    placeholder="e.g. MRI, physical therapy, specialist"
                    className="flex-1 border border-gray-300 rounded-md shadow-sm p-2"
                  />
                  <button
                    onClick={handleBenefitSearch}
                    disabled={benefitLoading || !benefitQuery.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                  >
                    <Search className="w-4 h-4 mr-2" />
                    {benefitLoading ? 'Searching…' : 'Search'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Searches the benefits extracted from your uploaded Summary of Benefits (SBC) documents.
                </p>
              </div>

              {benefitError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  {benefitError}
                </div>
              )}

              {benefitSearched && !benefitLoading && !benefitError && benefitResults.length === 0 && (
                <p className="text-sm text-gray-500">No matching benefits found across your plans.</p>
              )}

              {benefitResults.length > 0 && (
                <div>
                  <h4 className="text-md font-medium text-gray-900 mb-4">
                    {benefitResults.length} matching benefit{benefitResults.length === 1 ? '' : 's'}
                  </h4>
                  <div className="space-y-4">
                    {benefitResults.map(({ planId, planName, benefit }) => (
                      <div key={`${planId}-${benefit.id}`} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h5 className="font-medium text-gray-900">{benefit.serviceName}</h5>
                            <p className="text-sm text-gray-500">
                              {planName}{benefit.serviceCategory ? ` · ${benefit.serviceCategory}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center">
                            {benefit.inNetworkCoverage.covered ? (
                              <CheckCircle className="w-4 h-4 text-green-500 mr-1.5" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-500 mr-1.5" />
                            )}
                            <span className={`text-sm ${benefit.inNetworkCoverage.covered ? 'text-green-600' : 'text-red-600'}`}>
                              {benefit.inNetworkCoverage.covered ? 'Covered in-network' : 'Not covered in-network'}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">In-network cost:</span>
                            <span className="ml-2 font-medium">
                              {formatBenefitCost(benefit.inNetworkCoverage.copay, benefit.inNetworkCoverage.coinsurance)}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">Out-of-network:</span>
                            <span className="ml-2 font-medium">
                              {benefit.outNetworkCoverage.covered
                                ? formatBenefitCost(benefit.outNetworkCoverage.copay, benefit.outNetworkCoverage.coinsurance)
                                : 'Not covered'}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">Prior auth:</span>
                            <span className="ml-2 font-medium">{benefit.preAuthRequired ? 'Required' : 'No'}</span>
                          </div>
                        </div>

                        {benefit.limitations && (
                          <p className="mt-2 text-xs text-gray-500">Limitations: {benefit.limitations}</p>
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