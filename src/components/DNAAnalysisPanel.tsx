import React, { useState, useEffect } from 'react';
import { 
  Dna, 
  AlertCircle, 
  CheckCircle, 
  Info, 
  Search, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  Shield, 
  Pill, 
  Heart, 
  Brain, 
  Zap, 
  Leaf, 
  DollarSign,
  FileText,
  ExternalLink
} from 'lucide-react';
import type { DNAVariant, DNAFileInfo, InsurancePlan } from '../types';
import { 
  analyzeVariants, 
  type GeneticTrait, 
  type GeneticRiskLevel, 
  type GeneticCategory,
  type HealthRecommendation
} from '../utils/snpDatabase';
import GenomicInsightsDashboard from './GenomicInsightsDashboard';

interface DNAAnalysisPanelProps {
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
  'traits': <Info className="w-4 h-4" />,
  'metabolism': <Zap className="w-4 h-4" />,
  'wellness': <Heart className="w-4 h-4" />
};

export default function DNAAnalysisPanel({ variants, fileInfo, insurancePlans = [] }: DNAAnalysisPanelProps) {
  const [geneticTraits, setGeneticTraits] = useState<GeneticTrait[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<GeneticCategory | 'all'>('all');
  const [selectedRisk, setSelectedRisk] = useState<GeneticRiskLevel | 'all'>('all');
  const [expandedTraits, setExpandedTraits] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'dashboard' | 'traits' | 'health' | 'insurance'>('dashboard');
  const [isLoading, setIsLoading] = useState(true);

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
      trait.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || trait.category === selectedCategory;
    const matchesRisk = selectedRisk === 'all' || trait.riskLevel === selectedRisk;
    
    return matchesSearch && matchesCategory && matchesRisk;
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
                    {trait.rsid} ({trait.genotype})
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
                               recommendation.priority === 'medium' ? <Info className="w-4 h-4" /> :
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

  const renderHealthSummary = () => {
    // Group traits by risk level
    const highRiskTraits = geneticTraits.filter(t => t.riskLevel === 'high');
    const moderateRiskTraits = geneticTraits.filter(t => t.riskLevel === 'moderate');
    const lowRiskTraits = geneticTraits.filter(t => t.riskLevel === 'low');
    const protectiveTraits = geneticTraits.filter(t => t.riskLevel === 'protective');
    
    // Get all unique recommendations
    const allRecommendations = geneticTraits.flatMap(t => t.recommendations);
    const uniqueRecommendations = Array.from(
      new Map(allRecommendations.map(r => [r.service, r])).values()
    ).sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    return (
      <div className="space-y-6">
        {/* Overall Summary */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-blue-900 mb-3">Your Genetic Health Summary</h3>
          <p className="text-blue-800 mb-4">
            Based on your genetic data, we've identified {highRiskTraits.length} high-risk factors, 
            {moderateRiskTraits.length} moderate-risk factors, and {protectiveTraits.length} protective factors 
            that may influence your health.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="text-2xl font-bold text-red-600">{highRiskTraits.length}</div>
              <div className="text-sm text-gray-600">High Risk Factors</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="text-2xl font-bold text-orange-600">{moderateRiskTraits.length}</div>
              <div className="text-sm text-gray-600">Moderate Risk Factors</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="text-2xl font-bold text-green-600">{lowRiskTraits.length}</div>
              <div className="text-sm text-gray-600">Low Risk Factors</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="text-2xl font-bold text-blue-600">{protectiveTraits.length}</div>
              <div className="text-sm text-gray-600">Protective Factors</div>
            </div>
          </div>
        </div>
        
        {/* Priority Recommendations */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Recommended Health Actions</h3>
          <div className="space-y-4">
            {uniqueRecommendations.slice(0, 5).map((recommendation, index) => {
              const coverage = getInsuranceCoverage(recommendation);
              const relatedTraits = geneticTraits.filter(t => 
                t.recommendations.some(r => r.service === recommendation.service)
              );
              
              return (
                <div key={index} className={`border rounded-lg p-4 ${
                  recommendation.priority === 'high' ? 'border-red-200 bg-red-50' :
                  recommendation.priority === 'medium' ? 'border-yellow-200 bg-yellow-50' :
                  'border-blue-200 bg-blue-50'
                }`}>
                  <div className="flex items-start">
                    <div className={`p-2 rounded-full ${
                      recommendation.priority === 'high' ? 'bg-red-100 text-red-700' :
                      recommendation.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {recommendation.priority === 'high' ? <AlertCircle className="w-5 h-5" /> :
                       recommendation.priority === 'medium' ? <Info className="w-5 h-5" /> :
                       <CheckCircle className="w-5 h-5" />}
                    </div>
                    <div className="ml-4 flex-1">
                      <div className="flex justify-between">
                        <h4 className="text-lg font-medium">{recommendation.service}</h4>
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                          recommendation.priority === 'high' ? 'bg-red-100 text-red-800' :
                          recommendation.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {recommendation.priority.toUpperCase()} PRIORITY
                        </div>
                      </div>
                      
                      <p className="text-sm mt-2">{recommendation.description}</p>
                      
                      <div className="mt-3 flex flex-wrap gap-2">
                        {relatedTraits.slice(0, 3).map((trait, tIndex) => (
                          <span key={tIndex} className={`px-2 py-1 text-xs rounded ${CATEGORY_COLORS[trait.category]}`}>
                            {trait.name}
                          </span>
                        ))}
                        {relatedTraits.length > 3 && (
                          <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">
                            +{relatedTraits.length - 3} more
                          </span>
                        )}
                      </div>
                      
                      <div className="mt-4 flex justify-between items-center">
                        <div className="flex items-center">
                          <Shield className={`w-4 h-4 mr-1 ${coverage.covered ? 'text-green-500' : 'text-gray-400'}`} />
                          <span className={`text-sm ${coverage.covered ? 'text-green-700' : 'text-gray-600'}`}>
                            {coverage.covered ? 
                              `Covered by ${coverage.planName}` : 
                              'Not specifically covered'}
                          </span>
                          {coverage.covered && coverage.copay !== undefined && (
                            <span className="text-sm text-gray-600 ml-2">
                              (${coverage.copay} copay)
                            </span>
                          )}
                        </div>
                        
                        <div className="flex space-x-2">
                          <button className="px-3 py-1 bg-white border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 flex items-center">
                            <FileText className="w-3 h-3 mr-1" />
                            Details
                          </button>
                          <button className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 flex items-center">
                            <DollarSign className="w-3 h-3 mr-1" />
                            Check Coverage
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Disclaimer */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
          <p className="font-medium mb-2">Important Health Information</p>
          <p>
            Genetic information should be considered alongside other health factors and is not deterministic. 
            Always consult with healthcare professionals before making medical decisions based on genetic data.
          </p>
        </div>
      </div>
    );
  };

  const renderInsuranceCoverage = () => {
    // Get all unique recommendations
    const allRecommendations = geneticTraits.flatMap(t => t.recommendations);
    const uniqueRecommendations = Array.from(
      new Map(allRecommendations.map(r => [r.service, r])).values()
    );
    
    // Check coverage for each recommendation
    const coverageResults = uniqueRecommendations.map(recommendation => ({
      recommendation,
      coverage: getInsuranceCoverage(recommendation),
      relatedTraits: geneticTraits.filter(t => 
        t.recommendations.some(r => r.service === recommendation.service)
      )
    }));
    
    // Group by coverage status
    const coveredServices = coverageResults.filter(r => r.coverage.covered);
    const uncoveredServices = coverageResults.filter(r => !r.coverage.covered);
    
    return (
      <div className="space-y-6">
        {/* Insurance Summary */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <Shield className="w-6 h-6 text-blue-600 mr-3" />
            <h3 className="text-lg font-medium text-blue-900">Insurance Coverage for Genetic Recommendations</h3>
          </div>
          
          <p className="text-blue-800 mb-4">
            Based on your genetic profile and insurance plans, we've analyzed coverage for recommended services.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="text-2xl font-bold text-blue-600">{uniqueRecommendations.length}</div>
              <div className="text-sm text-gray-600">Total Recommendations</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="text-2xl font-bold text-green-600">{coveredServices.length}</div>
              <div className="text-sm text-gray-600">Covered Services</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="text-2xl font-bold text-red-600">{uncoveredServices.length}</div>
              <div className="text-sm text-gray-600">Uncovered Services</div>
            </div>
          </div>
        </div>
        
        {/* Covered Services */}
        {coveredServices.length > 0 && (
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              Covered Genetic Health Services
            </h3>
            
            <div className="space-y-4">
              {coveredServices.map((item, index) => (
                <div key={index} className="border border-green-200 bg-green-50 rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-gray-900">{item.recommendation.service}</h4>
                      <p className="text-sm text-gray-700 mt-1">{item.recommendation.description}</p>
                      
                      <div className="mt-2">
                        <span className="text-sm text-gray-600">Related to: </span>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {item.relatedTraits.slice(0, 3).map((trait, tIndex) => (
                            <span key={tIndex} className={`px-2 py-1 text-xs rounded ${CATEGORY_COLORS[trait.category]}`}>
                              {trait.name}
                            </span>
                          ))}
                          {item.relatedTraits.length > 3 && (
                            <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">
                              +{item.relatedTraits.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Covered
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {item.coverage.planName}
                      </div>
                      {item.coverage.copay !== undefined && (
                        <div className="text-sm font-medium text-gray-900 mt-1">
                          ${item.coverage.copay} copay
                        </div>
                      )}
                      {item.coverage.coinsurance !== undefined && (
                        <div className="text-sm font-medium text-gray-900 mt-1">
                          {item.coverage.coinsurance}% coinsurance
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="mt-4 flex justify-end space-x-2">
                    <button className="px-3 py-1 bg-white border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 flex items-center">
                      <FileText className="w-3 h-3 mr-1" />
                      View Details
                    </button>
                    <button className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 flex items-center">
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Find Providers
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Uncovered Services */}
        {uncoveredServices.length > 0 && (
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
              Services Not Specifically Covered
            </h3>
            
            <div className="space-y-4">
              {uncoveredServices.map((item, index) => (
                <div key={index} className="border border-gray-200 bg-gray-50 rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-gray-900">{item.recommendation.service}</h4>
                      <p className="text-sm text-gray-700 mt-1">{item.recommendation.description}</p>
                      
                      <div className="mt-2">
                        <span className="text-sm text-gray-600">Related to: </span>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {item.relatedTraits.slice(0, 3).map((trait, tIndex) => (
                            <span key={tIndex} className={`px-2 py-1 text-xs rounded ${CATEGORY_COLORS[trait.category]}`}>
                              {trait.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        <Info className="w-3 h-3 mr-1" />
                        Not Specifically Covered
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        May require out-of-pocket payment
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 flex justify-end space-x-2">
                    <button className="px-3 py-1 bg-white border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 flex items-center">
                      <DollarSign className="w-3 h-3 mr-1" />
                      Cost Estimate
                    </button>
                    <button className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 flex items-center">
                      <Shield className="w-3 h-3 mr-1" />
                      Coverage Options
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Insurance Disclaimer */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
          <p className="font-medium mb-2">Insurance Coverage Information</p>
          <p>
            Coverage information is based on your current insurance plans and is subject to change. 
            Always verify coverage with your insurance provider before scheduling services.
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center mb-6">
        <Dna className="w-6 h-6 text-green-600 mr-3" />
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Genetic Analysis Results</h2>
          <p className="text-sm text-gray-600">
            {fileInfo.source} data with {fileInfo.validVariants.toLocaleString()} valid variants
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            activeTab === 'dashboard' 
              ? 'border-green-500 text-green-600' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setActiveTab('traits')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            activeTab === 'traits' 
              ? 'border-green-500 text-green-600' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Genetic Traits
        </button>
        <button
          onClick={() => setActiveTab('health')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            activeTab === 'health' 
              ? 'border-green-500 text-green-600' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Health Summary
        </button>
        <button
          onClick={() => setActiveTab('insurance')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            activeTab === 'insurance' 
              ? 'border-green-500 text-green-600' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Insurance Coverage
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
          <span className="ml-3 text-gray-600">Analyzing genetic data...</span>
        </div>
      ) : (
        <>
          {activeTab === 'dashboard' && (
            <GenomicInsightsDashboard 
              variants={variants} 
              fileInfo={fileInfo} 
              insurancePlans={insurancePlans} 
            />
          )}
          
          {activeTab === 'traits' && (
            <>
              {/* Filters */}
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search genetic traits..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                  />
                </div>
                <div className="flex space-x-4">
                  <div className="relative">
                    <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value as any)}
                      className="pl-10 pr-8 py-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
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
                </div>
              </div>

              {/* Results */}
              <div className="space-y-4">
                {filteredTraits.length > 0 ? (
                  filteredTraits.map(trait => renderTraitCard(trait))
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <Dna className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>No genetic traits match your search criteria.</p>
                    <p className="text-sm mt-2">Try adjusting your filters or search term.</p>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'health' && renderHealthSummary()}
          
          {activeTab === 'insurance' && renderInsuranceCoverage()}
        </>
      )}
    </div>
  );
}