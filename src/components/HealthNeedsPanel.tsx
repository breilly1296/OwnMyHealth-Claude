import React, { useState } from 'react';
import { 
  Heart, 
  AlertTriangle, 
  DollarSign, 
  Calendar, 
  Shield, 
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Clock,
  User,
  Activity,
  CheckCircle,
  XCircle,
  Info,
  Target,
  Stethoscope
} from 'lucide-react';
import type { HealthNeedsAnalysis, DetectedCondition, RecommendedService, InsurancePlan } from '../types';

interface HealthNeedsPanelProps {
  analysis: HealthNeedsAnalysis;
  insurancePlans: InsurancePlan[];
}

const URGENCY_COLORS = {
  immediate: 'text-red-700 bg-red-50 border-red-200',
  urgent: 'text-orange-700 bg-orange-50 border-orange-200',
  'follow-up': 'text-yellow-700 bg-yellow-50 border-yellow-200',
  routine: 'text-blue-700 bg-blue-50 border-blue-200'
};

const URGENCY_ICONS = {
  immediate: <AlertTriangle className="w-4 h-4 text-red-600" />,
  urgent: <Clock className="w-4 h-4 text-orange-600" />,
  'follow-up': <Calendar className="w-4 h-4 text-yellow-600" />,
  routine: <CheckCircle className="w-4 h-4 text-blue-600" />
};

const SEVERITY_COLORS = {
  severe: 'text-red-700 bg-red-100',
  moderate: 'text-orange-700 bg-orange-100',
  mild: 'text-yellow-700 bg-yellow-100'
};

export default function HealthNeedsPanel({ analysis, insurancePlans }: HealthNeedsPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['conditions', 'actions']));
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const getPlanName = (planId: string) => {
    const plan = insurancePlans.find(p => p.id === planId);
    return plan?.planName || 'Unknown Plan';
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center mb-6">
        <Heart className="w-6 h-6 text-pink-600 mr-3" />
        <h2 className="text-xl font-semibold text-gray-900">Personalized Health Needs Analysis</h2>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-red-50 p-4 rounded-lg border border-red-200">
          <div className="flex items-center">
            <AlertTriangle className="w-6 h-6 text-red-600 mr-2" />
            <div>
              <p className="text-sm text-red-600">Detected Conditions</p>
              <p className="text-2xl font-bold text-red-700">{analysis.detectedConditions.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <div className="flex items-center">
            <Stethoscope className="w-6 h-6 text-blue-600 mr-2" />
            <div>
              <p className="text-sm text-blue-600">Recommended Services</p>
              <p className="text-2xl font-bold text-blue-700">{analysis.recommendedServices.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <div className="flex items-center">
            <Shield className="w-6 h-6 text-green-600 mr-2" />
            <div>
              <p className="text-sm text-green-600">Covered Services</p>
              <p className="text-2xl font-bold text-green-700">
                {analysis.insuranceCoverage.filter(ic => ic.planCoverage.some(pc => pc.covered)).length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
          <div className="flex items-center">
            <Target className="w-6 h-6 text-purple-600 mr-2" />
            <div>
              <p className="text-sm text-purple-600">Priority Actions</p>
              <p className="text-2xl font-bold text-purple-700">{analysis.priorityActions.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Detected Health Conditions */}
      <div className="mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => toggleSection('conditions')}
        >
          <div className="flex items-center">
            <AlertTriangle className="w-5 h-5 text-red-600 mr-3" />
            <h3 className="text-lg font-medium">Detected Health Conditions</h3>
            <span className="ml-2 px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
              {analysis.detectedConditions.length}
            </span>
          </div>
          {expandedSections.has('conditions') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
        
        {expandedSections.has('conditions') && (
          <div className="mt-4 space-y-4">
            {analysis.detectedConditions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-400" />
                <p>No specific health conditions detected based on your current biomarkers.</p>
                <p className="text-sm mt-2">Continue regular monitoring and preventive care.</p>
              </div>
            ) : (
              analysis.detectedConditions.map((detectedCondition, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h4 className="font-medium text-gray-900">{detectedCondition.condition.name}</h4>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${SEVERITY_COLORS[detectedCondition.severity]}`}>
                          {detectedCondition.severity.toUpperCase()}
                        </span>
                        <span className="text-sm text-gray-500">
                          {Math.round(detectedCondition.confidence * 100)}% confidence
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">{detectedCondition.condition.description}</p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h5 className="text-sm font-medium text-gray-700 mb-2">Triggering Biomarkers:</h5>
                          <div className="space-y-1">
                            {detectedCondition.triggeringBiomarkers.map((biomarker, bIndex) => (
                              <div key={bIndex} className="flex items-center justify-between text-sm">
                                <span className="text-gray-600">{biomarker.name}</span>
                                <span className={`font-medium ${
                                  biomarker.value < biomarker.normalRange.min || biomarker.value > biomarker.normalRange.max
                                    ? 'text-red-600' : 'text-green-600'
                                }`}>
                                  {biomarker.value} {biomarker.unit}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <h5 className="text-sm font-medium text-gray-700 mb-2">Risk Factors:</h5>
                          <div className="flex flex-wrap gap-1">
                            {detectedCondition.riskFactors.slice(0, 4).map((factor, fIndex) => (
                              <span key={fIndex} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                {factor}
                              </span>
                            ))}
                            {detectedCondition.riskFactors.length > 4 && (
                              <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                +{detectedCondition.riskFactors.length - 4} more
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Priority Actions */}
      <div className="mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => toggleSection('actions')}
        >
          <div className="flex items-center">
            <Target className="w-5 h-5 text-purple-600 mr-3" />
            <h3 className="text-lg font-medium">Priority Actions</h3>
            <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">
              {analysis.priorityActions.length}
            </span>
          </div>
          {expandedSections.has('actions') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
        
        {expandedSections.has('actions') && (
          <div className="mt-4 space-y-3">
            {analysis.priorityActions.map((action, index) => (
              <div key={index} className={`border rounded-lg p-4 ${URGENCY_COLORS[action.urgency]}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1">
                    {URGENCY_ICONS[action.urgency]}
                    <div>
                      <h4 className="font-medium">{action.title}</h4>
                      <p className="text-sm mt-1">{action.description}</p>
                      <div className="flex items-center space-x-4 mt-2 text-xs">
                        <span className="font-medium">Category: {action.category}</span>
                        <span className="font-medium">Timeframe: {action.timeframe}</span>
                        {action.estimatedCost && (
                          <span className="font-medium">Est. Cost: {formatCurrency(action.estimatedCost)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recommended Services */}
      <div className="mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => toggleSection('services')}
        >
          <div className="flex items-center">
            <Stethoscope className="w-5 h-5 text-blue-600 mr-3" />
            <h3 className="text-lg font-medium">Recommended Medical Services</h3>
            <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
              {analysis.recommendedServices.length}
            </span>
          </div>
          {expandedSections.has('services') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
        
        {expandedSections.has('services') && (
          <div className="mt-4 space-y-4">
            {analysis.recommendedServices.map((recommendedService, index) => {
              const coverage = analysis.insuranceCoverage.find(ic => ic.serviceId === recommendedService.service.id);
              const costEstimate = analysis.estimatedCosts.find(ec => ec.serviceId === recommendedService.service.id);
              
              return (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h4 className="font-medium text-gray-900">{recommendedService.service.name}</h4>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${URGENCY_COLORS[recommendedService.urgency]}`}>
                          {recommendedService.urgency.toUpperCase()}
                        </span>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                          {recommendedService.service.category}
                        </span>
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-3">{recommendedService.service.description}</p>
                      <p className="text-sm text-blue-600 mb-3">{recommendedService.reason}</p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <h5 className="text-sm font-medium text-gray-700 mb-1">Frequency & Cost</h5>
                          <p className="text-sm text-gray-600">{recommendedService.frequency}</p>
                          <p className="text-sm font-medium text-gray-900">{formatCurrency(recommendedService.estimatedCost)} per visit</p>
                          {costEstimate && (
                            <p className="text-sm text-gray-600">
                              {formatCurrency(costEstimate.annualEstimate)} annually
                            </p>
                          )}
                        </div>
                        
                        <div>
                          <h5 className="text-sm font-medium text-gray-700 mb-1">Related Conditions</h5>
                          <div className="space-y-1">
                            {recommendedService.relatedConditions.map((condition, cIndex) => (
                              <span key={cIndex} className="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded mr-1">
                                {condition}
                              </span>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <h5 className="text-sm font-medium text-gray-700 mb-1">Insurance Coverage</h5>
                          {coverage && coverage.planCoverage.length > 0 ? (
                            <div className="space-y-1">
                              {coverage.planCoverage.slice(0, 2).map((planCov, pIndex) => (
                                <div key={pIndex} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-600">{getPlanName(planCov.planId)}</span>
                                  <div className="flex items-center space-x-1">
                                    {planCov.covered ? (
                                      <CheckCircle className="w-3 h-3 text-green-500" />
                                    ) : (
                                      <XCircle className="w-3 h-3 text-red-500" />
                                    )}
                                    <span className={planCov.covered ? 'text-green-600' : 'text-red-600'}>
                                      {planCov.covered ? formatCurrency(planCov.estimatedOutOfPocket) : 'Not Covered'}
                                    </span>
                                  </div>
                                </div>
                              ))}
                              {coverage.bestCoverage && (
                                <p className="text-xs text-green-600 font-medium">
                                  Best: {formatCurrency(coverage.bestCoverage.estimatedCost)}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-500">No coverage information available</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cost Analysis */}
      {analysis.estimatedCosts.length > 0 && (
        <div className="mb-6">
          <div 
            className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={() => toggleSection('costs')}
          >
            <div className="flex items-center">
              <DollarSign className="w-5 h-5 text-green-600 mr-3" />
              <h3 className="text-lg font-medium">Cost Analysis</h3>
            </div>
            {expandedSections.has('costs') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
          
          {expandedSections.has('costs') && (
            <div className="mt-4">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Service
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Frequency
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Annual Estimate
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Best Plan Cost
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Potential Savings
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {analysis.estimatedCosts.map((cost, index) => {
                      const bestPlan = cost.planComparison.sort((a, b) => a.estimatedAnnualCost - b.estimatedAnnualCost)[0];
                      const maxSavings = Math.max(...cost.planComparison.map(p => p.savings || 0));
                      
                      return (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {cost.serviceName}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {cost.frequency}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatCurrency(cost.annualEstimate)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {bestPlan ? formatCurrency(bestPlan.estimatedAnnualCost) : 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">
                            {maxSavings > 0 ? formatCurrency(maxSavings) : 'N/A'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preventive Recommendations */}
      <div>
        <div 
          className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => toggleSection('preventive')}
        >
          <div className="flex items-center">
            <Shield className="w-5 h-5 text-green-600 mr-3" />
            <h3 className="text-lg font-medium">Preventive Care Recommendations</h3>
            <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
              {analysis.preventiveRecommendations.length}
            </span>
          </div>
          {expandedSections.has('preventive') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
        
        {expandedSections.has('preventive') && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {analysis.preventiveRecommendations.map((recommendation, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium text-gray-900">{recommendation.title}</h4>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    recommendation.insuranceCoverage === 'Typically Covered' ? 'bg-green-100 text-green-800' :
                    recommendation.insuranceCoverage === 'Partially Covered' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {recommendation.insuranceCoverage}
                  </span>
                </div>
                
                <p className="text-sm text-gray-600 mb-3">{recommendation.description}</p>
                
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Frequency:</span>
                    <span className="font-medium">{recommendation.frequency}</span>
                  </div>
                  {recommendation.ageRecommendation && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Age:</span>
                      <span className="font-medium">{recommendation.ageRecommendation}</span>
                    </div>
                  )}
                  {recommendation.estimatedCost && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Est. Cost:</span>
                      <span className="font-medium">{formatCurrency(recommendation.estimatedCost)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}