/**
 * DNAAnalysisPanel Component
 *
 * A comprehensive genetic analysis dashboard that processes and displays insights
 * from DNA data uploaded from services like 23andMe or AncestryDNA.
 *
 * Features three main tabs:
 * 1. Overview - Summary stats (high/moderate/low/protective risk counts), category
 *    breakdown, priority factors, and protective variants
 * 2. Traits - Searchable, filterable list of analyzed genetic traits with expandable
 *    cards showing personalized effects, lifestyle factors, and recommendations
 * 3. Actions - Prioritized health recommendations based on genetic profile with
 *    insurance coverage status for each action
 *
 * Analyzes variants using the SNP database utility which maps rsIDs to known
 * health associations across categories: disease_risk, drug_response, carrier_status,
 * traits, metabolism, and wellness.
 *
 * Integrates with insurance plans to show coverage status for recommended services.
 *
 * @module components/dna/DNAAnalysisPanel
 */

import React, { useState, useEffect } from 'react';
import {
  Dna,
  AlertCircle,
  CheckCircle,
  Info,
  Search,
  Shield,
  Pill,
  Heart,
  Zap,
  Leaf,
  ChevronRight,
  Activity,
  FileText
} from 'lucide-react';
import type { DNAVariant, DNAFileInfo, InsurancePlan } from '../../types';
import {
  analyzeVariants,
  getGeneticRiskSummary,
  type GeneticTrait,
  type GeneticRiskLevel,
  type GeneticCategory,
  type HealthRecommendation
} from '../../utils/dna/snpDatabase';

interface DNAAnalysisPanelProps {
  variants: DNAVariant[];
  fileInfo: DNAFileInfo;
  insurancePlans?: InsurancePlan[];
}

const CATEGORY_CONFIG: Record<GeneticCategory, { icon: React.ReactNode; color: string; bg: string }> = {
  'disease_risk': { icon: <AlertCircle className="w-4 h-4" />, color: 'text-red-600', bg: 'bg-red-50' },
  'drug_response': { icon: <Pill className="w-4 h-4" />, color: 'text-purple-600', bg: 'bg-purple-50' },
  'carrier_status': { icon: <Dna className="w-4 h-4" />, color: 'text-amber-600', bg: 'bg-amber-50' },
  'traits': { icon: <Info className="w-4 h-4" />, color: 'text-blue-600', bg: 'bg-blue-50' },
  'metabolism': { icon: <Zap className="w-4 h-4" />, color: 'text-green-600', bg: 'bg-green-50' },
  'wellness': { icon: <Heart className="w-4 h-4" />, color: 'text-pink-600', bg: 'bg-pink-50' }
};

export default function DNAAnalysisPanel({ variants, fileInfo, insurancePlans = [] }: DNAAnalysisPanelProps) {
  const [geneticTraits, setGeneticTraits] = useState<GeneticTrait[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<GeneticCategory | 'all'>('all');
  const [expandedTrait, setExpandedTrait] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'traits' | 'actions'>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    const analyzeData = async () => {
      setIsLoading(true);
      setAnalysisError(null);
      try {
        const results = await analyzeVariants(variants);
        setGeneticTraits(results);
      } catch {
        setAnalysisError('Failed to analyze genetic variants. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    if (variants.length > 0) {
      analyzeData();
    }
  }, [variants]);

  const filteredTraits = geneticTraits.filter(trait => {
    const matchesSearch = searchTerm === '' ||
      trait.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trait.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || trait.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getInsuranceCoverage = (recommendation: HealthRecommendation) => {
    if (!insurancePlans || insurancePlans.length === 0) {
      return { covered: false, details: 'No insurance plans available' };
    }

    const matchingBenefits = insurancePlans.flatMap(plan =>
      plan.benefits.filter(benefit => {
        const benefitName = benefit.serviceName.toLowerCase();
        const recKeywords = recommendation.keywords.map(k => k.toLowerCase());
        return recKeywords.some(keyword => benefitName.includes(keyword)) ||
               benefitName.includes(recommendation.service.toLowerCase());
      }).map(benefit => ({ planName: plan.planName, benefit }))
    );

    if (matchingBenefits.length === 0) {
      return { covered: false, details: 'Not specifically covered' };
    }

    const bestCoverage = matchingBenefits.reduce((best, current) => {
      const currentCopay = current.benefit.inNetworkCoverage.copay || 0;
      const bestCopay = best.benefit.inNetworkCoverage.copay || 0;
      if (!best.benefit.inNetworkCoverage.covered) return current;
      if (!current.benefit.inNetworkCoverage.covered) return best;
      return currentCopay < bestCopay ? current : best;
    }, matchingBenefits[0]);

    return {
      covered: bestCoverage.benefit.inNetworkCoverage.covered,
      planName: bestCoverage.planName,
      copay: bestCoverage.benefit.inNetworkCoverage.copay
    };
  };

  const summary = getGeneticRiskSummary(geneticTraits);
  const highRiskTraits = geneticTraits.filter(t => t.riskLevel === 'high');
  const moderateRiskTraits = geneticTraits.filter(t => t.riskLevel === 'moderate');
  const protectiveTraits = geneticTraits.filter(t => t.riskLevel === 'protective');

  // Get unique recommendations sorted by priority
  const allRecommendations = geneticTraits.flatMap(t =>
    t.recommendations.map(r => ({ ...r, traitName: t.name, category: t.category }))
  );
  const uniqueRecommendations = Array.from(
    new Map(allRecommendations.map(r => [r.service, r])).values()
  ).sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'traits' as const, label: 'Traits' },
    { id: 'actions' as const, label: 'Actions' },
  ];

  const getRiskStyle = (level: GeneticRiskLevel) => {
    switch (level) {
      case 'high': return { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' };
      case 'moderate': return { dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' };
      case 'low': return { dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' };
      case 'protective': return { dot: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' };
      default: return { dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' };
    }
  };

  // Trait Card Component
  const TraitCard = ({ trait }: { trait: GeneticTrait }) => {
    const isExpanded = expandedTrait === trait.id;
    const style = getRiskStyle(trait.riskLevel);
    const categoryConfig = CATEGORY_CONFIG[trait.category];

    return (
      <div className={`rounded-xl border ${style.border} overflow-hidden transition-all`}>
        <div
          className={`p-4 cursor-pointer ${style.bg} hover:opacity-90 transition-opacity`}
          onClick={() => setExpandedTrait(isExpanded ? null : trait.id)}
        >
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${categoryConfig.bg} ${categoryConfig.color}`}>
              {categoryConfig.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900">{trait.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{trait.rsid} • {trait.genotype}</p>
                </div>
                <span className={`flex-shrink-0 text-xs font-medium px-2 py-1 rounded-full ${style.bg} ${style.text} border ${style.border}`}>
                  {trait.riskLevel}
                </span>
              </div>
              <p className="text-sm text-slate-600 mt-2 line-clamp-2">{trait.description}</p>
            </div>
            <ChevronRight className={`w-5 h-5 text-slate-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </div>
        </div>

        {isExpanded && (
          <div className="p-4 bg-white border-t border-slate-100 space-y-4">
            <div>
              <h4 className="text-sm font-medium text-slate-900 mb-1">What This Means</h4>
              <p className="text-sm text-slate-600">{trait.personalizedEffect}</p>
            </div>

            {trait.lifestyleFactors.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 mb-2">Lifestyle Factors</h4>
                <div className="flex flex-wrap gap-2">
                  {trait.lifestyleFactors.map((factor, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-green-50 text-green-700 rounded-lg">
                      <Leaf className="w-3 h-3" />
                      {factor}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {trait.recommendations.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 mb-2">Recommendations</h4>
                <div className="space-y-2">
                  {trait.recommendations.slice(0, 2).map((rec, i) => {
                    const coverage = getInsuranceCoverage(rec);
                    return (
                      <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-slate-400" />
                          <span className="text-sm text-slate-700">{rec.service}</span>
                        </div>
                        {coverage.covered && (
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            Covered
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {trait.citations.length > 0 && (
              <p className="text-xs text-slate-400">
                Based on {trait.citations.length} scientific {trait.citations.length === 1 ? 'study' : 'studies'}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto animate-fade-in">
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-wellness-500 animate-spin mb-4" />
          <p className="text-slate-600">Analyzing genetic data...</p>
          <p className="text-sm text-slate-400 mt-1">{fileInfo.validVariants.toLocaleString()} variants</p>
        </div>
      </div>
    );
  }

  if (analysisError) {
    return (
      <div className="max-w-6xl mx-auto animate-fade-in">
        <div className="flex flex-col items-center justify-center py-24">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <p className="text-slate-900 font-medium">{analysisError}</p>
          <p className="text-sm text-slate-500 mt-1">Please try uploading your DNA file again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-wellness-100 rounded-xl">
            <Dna className="w-6 h-6 text-wellness-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Genetic Insights</h1>
            <p className="text-slate-500">{fileInfo.source} • {fileInfo.validVariants.toLocaleString()} variants analyzed</p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-red-500 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 opacity-80" />
            <span className="text-sm font-medium opacity-80">High Risk</span>
          </div>
          <div className="text-3xl font-bold">{summary.highRiskCount}</div>
          <p className="text-sm opacity-70 mt-1">factors identified</p>
        </div>

        <div className="bg-amber-500 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-5 h-5 opacity-80" />
            <span className="text-sm font-medium opacity-80">Moderate</span>
          </div>
          <div className="text-3xl font-bold">{summary.moderateRiskCount}</div>
          <p className="text-sm opacity-70 mt-1">factors to monitor</p>
        </div>

        <div className="bg-wellness-500 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5 opacity-80" />
            <span className="text-sm font-medium opacity-80">Low Risk</span>
          </div>
          <div className="text-3xl font-bold">{summary.lowRiskCount}</div>
          <p className="text-sm opacity-70 mt-1">favorable results</p>
        </div>

        <div className="bg-blue-500 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 opacity-80" />
            <span className="text-sm font-medium opacity-80">Protective</span>
          </div>
          <div className="text-3xl font-bold">{summary.protectiveCount}</div>
          <p className="text-sm opacity-70 mt-1">beneficial variants</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-slate-100 rounded-xl p-1 inline-flex mb-6">
        {tabs.map(tab => (
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

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Category Grid */}
          <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">By Category</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {Object.entries(CATEGORY_CONFIG).map(([category, config]) => {
                const count = geneticTraits.filter(t => t.category === category).length;
                return (
                  <button
                    key={category}
                    onClick={() => {
                      setSelectedCategory(category as GeneticCategory);
                      setActiveTab('traits');
                    }}
                    className="p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                  >
                    <div className={`p-2 rounded-lg ${config.bg} ${config.color} w-fit mb-2`}>
                      {config.icon}
                    </div>
                    <p className="text-2xl font-bold text-slate-900">{count}</p>
                    <p className="text-xs text-slate-500 capitalize">{category.replace('_', ' ')}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority Factors */}
          {(highRiskTraits.length > 0 || moderateRiskTraits.length > 0) && (
            <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Priority Factors</h2>
              <div className="space-y-3">
                {[...highRiskTraits, ...moderateRiskTraits].slice(0, 5).map(trait => {
                  const style = getRiskStyle(trait.riskLevel);
                  const categoryConfig = CATEGORY_CONFIG[trait.category];
                  return (
                    <div
                      key={trait.id}
                      onClick={() => {
                        setExpandedTrait(trait.id);
                        setActiveTab('traits');
                      }}
                      className={`flex items-center gap-4 p-4 rounded-xl ${style.bg} border ${style.border} cursor-pointer hover:opacity-90 transition-opacity`}
                    >
                      <div className={`p-2 rounded-lg bg-white/60 ${categoryConfig.color}`}>
                        {categoryConfig.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-slate-900">{trait.name}</h3>
                        <p className="text-sm text-slate-600 truncate">{trait.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${style.dot}`} />
                        <span className={`text-xs font-medium ${style.text}`}>{trait.riskLevel}</span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Protective Factors */}
          {protectiveTraits.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Protective Factors</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {protectiveTraits.slice(0, 4).map(trait => {
                  const categoryConfig = CATEGORY_CONFIG[trait.category];
                  return (
                    <div
                      key={trait.id}
                      className="flex items-center gap-3 p-4 rounded-xl bg-blue-50 border border-blue-100"
                    >
                      <div className={`p-2 rounded-lg bg-white/60 ${categoryConfig.color}`}>
                        {categoryConfig.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-slate-900">{trait.name}</h3>
                        <p className="text-sm text-blue-700 truncate">{trait.description}</p>
                      </div>
                      <Shield className="w-5 h-5 text-blue-500" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-700 mb-1">Important Information</p>
            <p>Genetic data provides insights but is not deterministic. Consult healthcare professionals before making medical decisions.</p>
          </div>
        </div>
      )}

      {/* Traits Tab */}
      {activeTab === 'traits' && (
        <div className="space-y-4">
          {/* Search & Filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search traits..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-wellness-500/20 focus:border-wellness-500"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as typeof selectedCategory)}
              className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-wellness-500/20 focus:border-wellness-500 text-slate-700"
            >
              <option value="all">All Categories</option>
              <option value="disease_risk">Disease Risk</option>
              <option value="drug_response">Drug Response</option>
              <option value="carrier_status">Carrier Status</option>
              <option value="traits">Traits</option>
              <option value="metabolism">Metabolism</option>
              <option value="wellness">Wellness</option>
            </select>
          </div>

          {/* Results Count */}
          <p className="text-sm text-slate-500">
            {filteredTraits.length} {filteredTraits.length === 1 ? 'trait' : 'traits'} found
          </p>

          {/* Trait List */}
          {filteredTraits.length > 0 ? (
            <div className="space-y-3">
              {filteredTraits.map(trait => (
                <TraitCard key={trait.id} trait={trait} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/60">
              <Dna className="w-12 h-12 mx-auto mb-4 text-slate-300" />
              <p className="text-slate-600 font-medium">No traits match your search</p>
              <p className="text-sm text-slate-400 mt-1">Try adjusting your filters</p>
            </div>
          )}
        </div>
      )}

      {/* Actions Tab */}
      {activeTab === 'actions' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/60 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Recommended Actions</h2>
            <p className="text-slate-500 text-sm">Based on your genetic profile, here are personalized health recommendations.</p>
          </div>

          {uniqueRecommendations.length > 0 ? (
            <div className="space-y-3">
              {uniqueRecommendations.map((rec, index) => {
                const coverage = getInsuranceCoverage(rec);
                const priorityStyle = rec.priority === 'high'
                  ? { bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', label: 'High Priority' }
                  : rec.priority === 'medium'
                  ? { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', label: 'Medium Priority' }
                  : { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', label: 'Suggested' };

                return (
                  <div key={index} className={`rounded-xl border ${priorityStyle.border} ${priorityStyle.bg} p-5`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-2 h-2 rounded-full ${priorityStyle.dot}`} />
                          <span className="text-xs font-medium text-slate-500">{priorityStyle.label}</span>
                        </div>
                        <h3 className="font-semibold text-slate-900">{rec.service}</h3>
                        <p className="text-sm text-slate-600 mt-1">{rec.description}</p>

                        <div className="flex items-center gap-4 mt-4">
                          {coverage.covered ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                              <Shield className="w-3 h-3" />
                              Covered{coverage.copay !== undefined && ` • $${coverage.copay} copay`}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                              <Shield className="w-3 h-3" />
                              Check coverage
                            </span>
                          )}
                        </div>
                      </div>

                      <button className="flex-shrink-0 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Add to Plan
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/60">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-400" />
              <p className="text-slate-600 font-medium">No specific actions recommended</p>
              <p className="text-sm text-slate-400 mt-1">Your genetic profile looks good!</p>
            </div>
          )}

          {/* Insurance Note */}
          <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-700 mb-1">Insurance Coverage</p>
            <p>Coverage details are estimates. Verify with your insurance provider before scheduling services.</p>
          </div>
        </div>
      )}
    </div>
  );
}
