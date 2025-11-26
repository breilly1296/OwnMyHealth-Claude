import React, { useState, useEffect } from 'react';
import { 
  Dna, 
  AlertCircle, 
  CheckCircle, 
  Pill, 
  Heart, 
  Brain, 
  Zap, 
  Leaf, 
  Filter, 
  Search, 
  ChevronDown, 
  ChevronUp, 
  Shield, 
  FileText, 
  ExternalLink,
  Sliders,
  BarChart,
  PieChart,
  Tag
} from 'lucide-react';
import type { DNAVariant, DNAFileInfo, InsurancePlan } from '../types';
import { 
  analyzeVariants, 
  getHealthRecommendations,
  getGeneticRiskSummary,
  type GeneticTrait, 
  type GeneticRiskLevel, 
  type GeneticCategory,
  type HealthRecommendation
} from '../utils/snpDatabase';

interface GenomicInsightsDashboardProps {
  variants: DNAVariant[];
  fileInfo: DNAFileInfo;
  insurancePlans?: InsurancePlan[];
}

const RISK_COLORS: Record<GeneticRiskLevel, string> = {
  'high': 'text-red-700 bg-red-50 border-red-200',
  'moderate': 'text-orange-700 bg-orange-50 border-orange-200',
  'low': 'text-green-700 bg-green-50 border-green-200',
  'protective': 'text-blue-700 bg-blue-50 border-blue-200',
  'unknown': 'text-gray-700 bg-gray-50 border-gray-200'
};

const CATEGORY_COLORS: Record<GeneticCategory, string> = {
  'disease_risk': 'text-red-600 bg-red-100',
  'drug_response': 'text-purple-600 bg-purple-100',
  'carrier_status': 'text-orange-600 bg-orange-100',
  'traits': 'text-blue-600 bg-blue-100',
  'metabolism': 'text-green-600 bg-green-100',
  'wellness': 'text-teal-600 bg-teal-100'
};

const CATEGORY_ICONS: Record<GeneticCategory, React.ReactNode> = {
  'disease_risk': <AlertCircle className="w-4 h-4" />,
  'drug_response': <Pill className="w-4 h-4" />,
  'carrier_status': <Dna className="w-4 h-4" />,
  'traits': <Brain className="w-4 h-4" />,
  'metabolism': <Zap className="w-4 h-4" />,
  'wellness': <Heart className="w-4 h-4" />
};

export default function GenomicInsightsDashboard({ variants, fileInfo, insurancePlans = [] }: GenomicInsightsDashboardProps) {
  const [geneticTraits, setGeneticTraits] = useState<GeneticTrait[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<GeneticCategory | 'all'>('all');
  const [selectedRisk, setSelectedRisk] = useState<GeneticRiskLevel | 'all'>('all');
  const [confidenceLevel, setConfidenceLevel] = useState<number>(0.5); // 0.5 = medium confidence
  const [expandedTraits, setExpandedTraits] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'risk' | 'name' | 'category'>('risk');

  useEffect(() => {
    const analyzeData = async () => {
      setIsLoading(true);
      try {
        const results = await analyzeVariants(variants);
        setGeneticTraits(results);
      } catch (error) {
        console.error('Error analyzing variants:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (variants.length > 0) {
      analyzeData();
    }
  }, [variants]);

  const toggleTrait = (traitId: string) => {
    const newExpanded = new Set(expandedTraits);
    if (newExpanded.has(traitId)) {
      newExpanded.delete(traitId);
    } else {
      newExpanded.add(traitId);
    }
    setExpandedTraits(newExpanded);
  };

  const filteredTraits = geneticTraits.filter(trait => {
    const matchesSearch = searchTerm === '' || 
      trait.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trait.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trait.gene.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trait.rsid.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || trait.category === selectedCategory;
    const matchesRisk = selectedRisk === 'all' || trait.riskLevel === selectedRisk;
    
    // Filter by confidence (using citations length as a proxy for confidence)
    const traitConfidence = Math.min(trait.citations.length * 0.3, 1);
    const meetsConfidence = traitConfidence >= confidenceLevel;
    
    return matchesSearch && matchesCategory && matchesRisk && meetsConfidence;
  });

  // Sort traits based on selected sort method
  const sortedTraits = [...filteredTraits].sort((a, b) => {
    if (sortBy === 'risk') {
      const riskOrder = { high: 0, moderate: 1, low: 2, protective: 3, unknown: 4 };
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    } else if (sortBy === 'name') {
      return a.name.localeCompare(b.name);
    } else if (sortBy === 'category') {
      return a.category.localeCompare(b.category);
    }
    return 0;
  });

  const getInsuranceCoverage = (recommendation: HealthRecommendation) => {
    if (!insurancePlans || insurancePlans.length === 0) {
      return { covered: false, details: 'No insurance plans available' };
    }

    // Find matching benefits in insurance plans
    const matchingBenefits = insurancePlans.flatMap(plan => 
      plan.benefits.filter(benefit => {
        const benefitName = benefit.serviceName.toLowerCase();
        const recKeywords = recommendation.keywords.map(k => k.toLowerCase());
        
        return recKeywords.some(keyword => benefitName.includes(keyword)) ||
               benefitName.includes(recommendation.service.toLowerCase());
      }).map(benefit => ({
        planName: plan.planName,
        benefit
      }))
    );

    if (matchingBenefits.length === 0) {
      return { covered: false, details: 'Not specifically covered in your plans' };
    }

    // Find best coverage option
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
      copay: bestCoverage.benefit.inNetworkCoverage.copay,
      coinsurance: bestCoverage.benefit.inNetworkCoverage.coinsurance,
      details: bestCoverage.benefit.description
    };
  };

  // Calculate summary statistics
  const summary = getGeneticRiskSummary(geneticTraits);
  const categoryDistribution = geneticTraits.reduce((acc, trait) => {
    acc[trait.category] = (acc[trait.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const renderTraitCard = (trait: GeneticTrait) => {
    const isExpanded = expandedTraits.has(trait.id);
    
    return (
      <div key={trait.id} className={`border rounded-lg overflow-hidden ${RISK_COLORS[trait.riskLevel]}`}>
        <div 
          className="p-4 cursor-pointer hover:bg-opacity-80 transition-colors"
          onClick={() => toggleTrait(trait.id)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className={`p-2 rounded-full ${CATEGORY_COLORS[trait.category]}`}>
                {CATEGORY_ICONS[trait.category]}
              </div>
              <div className="ml-3">
                <h3 className="font-medium text-gray-900">{trait.name}</h3>
                <div className="flex items-center mt-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[trait.category]}`}>
                    {trait.category.replace('_', ' ')}
                  </span>
                  <span className="mx-2">•</span>
                  <span className="text-sm text-gray-600">
                    {trait.gene} ({trait.rsid})
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <span className={`px-2 py-1 rounded-full text-xs font-medium mr-2 ${
                trait.riskLevel === 'high' ? 'bg-red-100 text-red-800' :
                trait.riskLevel === 'moderate' ? 'bg-orange-100 text-orange-800' :
                trait.riskLevel === 'low' ? 'bg-green-100 text-green-800' :
                trait.riskLevel === 'protective' ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {trait.riskLevel.toUpperCase()}
              </span>
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </div>
          <p className="text-sm mt-2 text-gray-700">{trait.description}</p>
        </div>
        
        {isExpanded && (
          <div className="border-t border-gray-200 p-4 bg-white bg-opacity-90">
            <div className="space-y-4">
              {/* What This Means For You */}
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">What This Means For You</h4>
                <p className="text-sm text-gray-700">{trait.personalizedEffect}</p>
              </div>
              
              {/* Scientific Details */}
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Scientific Details</h4>
                <p className="text-sm text-gray-700">{trait.scientificDetails}</p>
                {trait.citations.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-500">Sources:</p>
                    <ul className="text-xs text-gray-500 list-disc pl-5 mt-1">
                      {trait.citations.map((citation, index) => (
                        <li key={index}>{citation}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              
              {/* Recommendations */}
              {trait.recommendations.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Recommendations</h4>
                  <div className="space-y-3">
                    {trait.recommendations.map((recommendation, index) => {
                      const coverage = getInsuranceCoverage(recommendation);
                      
                      return (
                        <div key={index} className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                          <div className="flex items-start">
                            <div className={`p-1.5 rounded-full mt-0.5 ${
                              recommendation.priority === 'high' ? 'bg-red-100 text-red-700' :
                              recommendation.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {recommendation.priority === 'high' ? <AlertCircle className="w-4 h-4" /> :
                               recommendation.priority === 'medium' ? <Zap className="w-4 h-4" /> :
                               <CheckCircle className="w-4 h-4" />}
                            </div>
                            <div className="ml-3 flex-1">
                              <p className="text-sm font-medium text-gray-900">{recommendation.service}</p>
                              <p className="text-sm text-gray-700 mt-1">{recommendation.description}</p>
                              
                              {/* Insurance Coverage */}
                              <div className="mt-2 flex items-center">
                                <Shield className={`w-4 h-4 mr-1 ${coverage.covered ? 'text-green-500' : 'text-gray-400'}`} />
                                <span className={`text-xs font-medium ${coverage.covered ? 'text-green-700' : 'text-gray-600'}`}>
                                  {coverage.covered ? 
                                    `Covered by ${coverage.planName}` : 
                                    'Not specifically covered'}
                                </span>
                                {coverage.covered && coverage.copay !== undefined && (
                                  <span className="text-xs text-gray-600 ml-2">
                                    (${coverage.copay} copay)
                                  </span>
                                )}
                              </div>
                              
                              {/* Action Button */}
                              <div className="mt-3 flex justify-end">
                                <button className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 flex items-center">
                                  <FileText className="w-3 h-3 mr-1" />
                                  Add to Health Plan
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Lifestyle Factors */}
              {trait.lifestyleFactors.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Lifestyle Factors</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {trait.lifestyleFactors.map((factor, index) => (
                      <div key={index} className="flex items-center text-sm">
                        <Leaf className="w-4 h-4 text-green-500 mr-2" />
                        <span className="text-gray-700">{factor}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTraitTable = () => {
    return (
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Trait
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Category
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Gene (SNP)
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Risk Level
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedTraits.map((trait) => (
              <tr key={trait.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{trait.name}</div>
                  <div className="text-sm text-gray-500 truncate max-w-xs">{trait.description}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[trait.category]}`}>
                    {CATEGORY_ICONS[trait.category]}
                    <span className="ml-1">{trait.category.replace('_', ' ')}</span>
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {trait.gene} ({trait.rsid})
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    trait.riskLevel === 'high' ? 'bg-red-100 text-red-800' :
                    trait.riskLevel === 'moderate' ? 'bg-orange-100 text-orange-800' :
                    trait.riskLevel === 'low' ? 'bg-green-100 text-green-800' :
                    trait.riskLevel === 'protective' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {trait.riskLevel.toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <button 
                    onClick={() => toggleTrait(trait.id)}
                    className="text-blue-600 hover:text-blue-900 mr-3"
                  >
                    {expandedTraits.has(trait.id) ? 'Hide Details' : 'View Details'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center mb-6">
        <Dna className="w-6 h-6 text-green-600 mr-3" />
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Genomic Insights Dashboard</h2>
          <p className="text-sm text-gray-600">
            {fileInfo.source} data with {fileInfo.validVariants.toLocaleString()} variants analyzed
          </p>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-red-100 text-red-600 mr-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500">High Risk Factors</p>
              <p className="text-2xl font-bold text-gray-900">{summary.highRiskCount}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-orange-100 text-orange-600 mr-4">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Moderate Risk Factors</p>
              <p className="text-2xl font-bold text-gray-900">{summary.moderateRiskCount}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100 text-green-600 mr-4">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Low Risk Factors</p>
              <p className="text-2xl font-bold text-gray-900">{summary.lowRiskCount}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100 text-blue-600 mr-4">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Protective Factors</p>
              <p className="text-2xl font-bold text-gray-900">{summary.protectiveCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Category Distribution */}
      <div className="mb-6 bg-white p-4 rounded-lg shadow border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
          <PieChart className="w-5 h-5 text-gray-500 mr-2" />
          Insights by Category
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Object.entries(CATEGORY_COLORS).map(([category, colorClass]) => (
            <div 
              key={category}
              className={`p-3 rounded-lg cursor-pointer transition-all ${
                selectedCategory === category ? 'ring-2 ring-blue-500 shadow-md' : 'hover:shadow'
              }`}
              onClick={() => setSelectedCategory(selectedCategory === category ? 'all' : category as GeneticCategory)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-full ${colorClass}`}>
                  {CATEGORY_ICONS[category as GeneticCategory]}
                </div>
                <span className="text-xs font-medium text-gray-500">
                  {categoryDistribution[category as GeneticCategory] || 0}
                </span>
              </div>
              <p className="text-sm font-medium text-gray-900 capitalize">
                {category.replace('_', ' ')}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters and Search */}
      <div className="mb-6 bg-white p-4 rounded-lg shadow border border-gray-200">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by trait name, gene, or rsID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
            />
          </div>
          
          <div className="flex flex-wrap gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <select
                value={selectedRisk}
                onChange={(e) => setSelectedRisk(e.target.value as any)}
                className="pl-10 pr-8 py-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              >
                <option value="all">All Risk Levels</option>
                <option value="high">High Risk</option>
                <option value="moderate">Moderate Risk</option>
                <option value="low">Low Risk</option>
                <option value="protective">Protective</option>
              </select>
            </div>
            
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600">Confidence:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={confidenceLevel}
                onChange={(e) => setConfidenceLevel(parseFloat(e.target.value))}
                className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs text-gray-500">
                {confidenceLevel < 0.3 ? 'Low' : confidenceLevel < 0.7 ? 'Medium' : 'High'}
              </span>
            </div>
            
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="py-2 pl-3 pr-8 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500 text-sm"
              >
                <option value="risk">Risk Level</option>
                <option value="name">Name</option>
                <option value="category">Category</option>
              </select>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('card')}
                className={`p-2 rounded-md ${viewMode === 'card' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
              >
                <Tag className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-2 rounded-md ${viewMode === 'table' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
              >
                <BarChart className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center items-center py-12 bg-white rounded-lg shadow border border-gray-200">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
          <span className="ml-3 text-gray-600">Analyzing genetic data...</span>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">
              Genetic Insights ({sortedTraits.length})
            </h3>
            <div className="text-sm text-gray-500">
              Showing {sortedTraits.length} of {geneticTraits.length} insights
            </div>
          </div>

          {sortedTraits.length > 0 ? (
            <div className={`space-y-4 ${viewMode === 'card' ? '' : 'hidden'}`}>
              {sortedTraits.map(trait => renderTraitCard(trait))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Dna className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No genetic insights match your search criteria.</p>
              <p className="text-sm mt-2">Try adjusting your filters or search term.</p>
            </div>
          )}

          {viewMode === 'table' && renderTraitTable()}
        </div>
      )}

      {/* Disclaimer */}
      <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
        <p className="font-medium mb-2">Important Health Information</p>
        <p>
          Genetic information should be considered alongside other health factors and is not deterministic. 
          Always consult with healthcare professionals before making medical decisions based on genetic data.
          The confidence levels shown are based on available scientific research and may change as new studies emerge.
        </p>
      </div>
    </div>
  );
}