import React, { useState } from 'react';
import { 
  BookOpen, 
  DollarSign, 
  Users, 
  Shield, 
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Calculator,
  CheckCircle,
  AlertCircle,
  Info,
  Target,
  Clock,
  Star
} from 'lucide-react';
import type { 
  PersonalizedInsuranceGuide,
  InsuranceEducationModule,
  InsuranceScenario,
  AnnualCostProjection,
  InsuranceOptimizationTip
} from '../types';
import { formatCurrency } from '../utils/insuranceEducation';

interface InsuranceEducationPanelProps {
  guide: PersonalizedInsuranceGuide;
}

const DIFFICULTY_COLORS = {
  'Easy': 'text-green-700 bg-green-100',
  'Moderate': 'text-yellow-700 bg-yellow-100',
  'Advanced': 'text-red-700 bg-red-100'
};

const CATEGORY_ICONS = {
  'Cost Savings': <DollarSign className="w-4 h-4" />,
  'Coverage Optimization': <Shield className="w-4 h-4" />,
  'Network Usage': <Users className="w-4 h-4" />,
  'Preventive Care': <CheckCircle className="w-4 h-4" />
};

export default function InsuranceEducationPanel({ guide }: InsuranceEducationPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview']));
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const totalPotentialSavings = guide.optimizationTips
    .filter(tip => tip.potentialSavings)
    .reduce((sum, tip) => sum + (tip.potentialSavings || 0), 0);

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center mb-6">
        <BookOpen className="w-6 h-6 text-blue-600 mr-3" />
        <h2 className="text-xl font-semibold text-gray-900">Your Personalized Insurance Guide</h2>
      </div>

      {/* User Profile Overview */}
      <div className="mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          onClick={() => toggleSection('overview')}
        >
          <div className="flex items-center">
            <Info className="w-5 h-5 text-blue-600 mr-3" />
            <h3 className="text-lg font-medium text-blue-900">Your Health Profile</h3>
          </div>
          {expandedSections.has('overview') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
        
        {expandedSections.has('overview') && (
          <div className="mt-4 p-4 border border-blue-200 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Detected Health Conditions</h4>
                <div className="space-y-2">
                  {guide.userProfile.detectedConditions.map((condition, index) => (
                    <div key={index} className="flex items-center text-sm">
                      <AlertCircle className="w-4 h-4 text-orange-500 mr-2" />
                      <span className="text-gray-700">{condition}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Recommended Services</h4>
                <div className="space-y-2">
                  {guide.userProfile.recommendedServices.slice(0, 4).map((service, index) => (
                    <div key={index} className="flex items-center text-sm">
                      <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                      <span className="text-gray-700">{service}</span>
                    </div>
                  ))}
                  {guide.userProfile.recommendedServices.length > 4 && (
                    <div className="text-sm text-gray-500">
                      +{guide.userProfile.recommendedServices.length - 4} more services
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cost Projections */}
      {guide.costProjections.length > 0 && (
        <div className="mb-6">
          <div 
            className="flex items-center justify-between cursor-pointer p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
            onClick={() => toggleSection('projections')}
          >
            <div className="flex items-center">
              <Calculator className="w-5 h-5 text-green-600 mr-3" />
              <h3 className="text-lg font-medium text-green-900">Your Cost Projections</h3>
            </div>
            {expandedSections.has('projections') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
          
          {expandedSections.has('projections') && (
            <div className="mt-4 space-y-4">
              {guide.costProjections.map((projection, index) => (
                <div key={index} className="border border-green-200 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-medium text-gray-900">{projection.scenario}</h4>
                      <p className="text-sm text-gray-600 mt-1">{projection.description}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-green-700">
                        {formatCurrency(projection.estimatedCosts.total)}
                      </div>
                      <div className="text-sm text-gray-500">Total Annual Cost</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <div className="font-medium text-gray-900">
                        {formatCurrency(projection.estimatedCosts.premiums)}
                      </div>
                      <div className="text-gray-600">Premiums</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <div className="font-medium text-gray-900">
                        {formatCurrency(projection.estimatedCosts.outOfPocket)}
                      </div>
                      <div className="text-gray-600">Out-of-Pocket</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <div className="font-medium text-gray-900">
                        {formatCurrency(projection.estimatedCosts.total - projection.estimatedCosts.premiums)}
                      </div>
                      <div className="text-gray-600">Medical Costs</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Education Modules */}
      <div className="mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
          onClick={() => toggleSection('education')}
        >
          <div className="flex items-center">
            <BookOpen className="w-5 h-5 text-purple-600 mr-3" />
            <h3 className="text-lg font-medium text-purple-900">Insurance Education</h3>
            <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">
              {guide.educationModules.length} modules
            </span>
          </div>
          {expandedSections.has('education') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
        
        {expandedSections.has('education') && (
          <div className="mt-4 space-y-4">
            {guide.educationModules.map((module, index) => (
              <div key={index} className="border border-purple-200 rounded-lg">
                <div 
                  className="p-4 cursor-pointer hover:bg-purple-50 transition-colors"
                  onClick={() => setSelectedModule(selectedModule === module.id ? null : module.id)}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="font-medium text-gray-900">{module.title}</h4>
                      <p className="text-sm text-gray-600 mt-1">{module.description}</p>
                    </div>
                    {selectedModule === module.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </div>
                
                {selectedModule === module.id && (
                  <div className="px-4 pb-4 border-t border-purple-200">
                    {/* Terms */}
                    <div className="mt-4">
                      <h5 className="font-medium text-gray-900 mb-3">Key Terms</h5>
                      <div className="space-y-3">
                        {module.terms.map((term, termIndex) => (
                          <div key={termIndex} className="bg-gray-50 rounded-lg p-4">
                            <h6 className="font-medium text-gray-900 mb-2">{term.term}</h6>
                            <p className="text-sm text-gray-700 mb-2">{term.definition}</p>
                            {term.userSpecificExample && (
                              <div className="bg-blue-50 border border-blue-200 rounded p-3 mt-2">
                                <p className="text-sm text-blue-800">
                                  <strong>Your Example:</strong> {term.userSpecificExample}
                                </p>
                              </div>
                            )}
                            {term.tips.length > 0 && (
                              <div className="mt-3">
                                <h7 className="text-xs font-medium text-gray-600 uppercase tracking-wide">Tips</h7>
                                <ul className="mt-1 space-y-1">
                                  {term.tips.map((tip, tipIndex) => (
                                    <li key={tipIndex} className="text-xs text-gray-600 flex items-start">
                                      <Lightbulb className="w-3 h-3 text-yellow-500 mr-1 mt-0.5 flex-shrink-0" />
                                      {tip}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Scenarios */}
                    {module.scenarios.length > 0 && (
                      <div className="mt-6">
                        <h5 className="font-medium text-gray-900 mb-3">Real-World Scenarios</h5>
                        <div className="space-y-3">
                          {module.scenarios.map((scenario, scenarioIndex) => (
                            <div key={scenarioIndex} className="border border-gray-200 rounded-lg">
                              <div 
                                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                                onClick={() => setSelectedScenario(selectedScenario === scenario.id ? null : scenario.id)}
                              >
                                <div className="flex justify-between items-center">
                                  <h6 className="font-medium text-gray-900">{scenario.title}</h6>
                                  {selectedScenario === scenario.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </div>
                                <p className="text-sm text-gray-600 mt-1">{scenario.description}</p>
                              </div>
                              
                              {selectedScenario === scenario.id && (
                                <div className="px-4 pb-4 border-t border-gray-200">
                                  <div className="mt-4">
                                    <p className="text-sm text-gray-700 mb-4">{scenario.userSituation}</p>
                                    
                                    {/* Cost Breakdown */}
                                    <div className="bg-gray-50 rounded-lg p-4 mb-4">
                                      <h7 className="font-medium text-gray-900 mb-3">Cost Breakdown</h7>
                                      <div className="space-y-2">
                                        {scenario.costBreakdown.map((item, itemIndex) => (
                                          <div key={itemIndex} className="flex justify-between items-center text-sm">
                                            <div>
                                              <span className="font-medium text-gray-900">{item.service}</span>
                                              <div className="text-xs text-gray-600">{item.explanation}</div>
                                            </div>
                                            <div className="text-right">
                                              <div className="font-medium text-gray-900">
                                                {formatCurrency(item.yourCost)}
                                              </div>
                                              <div className="text-xs text-gray-500">
                                                of {formatCurrency(item.originalCost)}
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    {/* Key Learnings */}
                                    <div className="mb-4">
                                      <h7 className="font-medium text-gray-900 mb-2">Key Learnings</h7>
                                      <ul className="space-y-1">
                                        {scenario.keyLearnings.map((learning, learningIndex) => (
                                          <li key={learningIndex} className="text-sm text-gray-700 flex items-start">
                                            <CheckCircle className="w-4 h-4 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                                            {learning}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>

                                    {/* Action Items */}
                                    <div>
                                      <h7 className="font-medium text-gray-900 mb-2">Action Items</h7>
                                      <ul className="space-y-1">
                                        {scenario.actionItems.map((action, actionIndex) => (
                                          <li key={actionIndex} className="text-sm text-gray-700 flex items-start">
                                            <Target className="w-4 h-4 text-blue-500 mr-2 mt-0.5 flex-shrink-0" />
                                            {action}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
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
            ))}
          </div>
        )}
      </div>

      {/* Optimization Tips */}
      {guide.optimizationTips.length > 0 && (
        <div className="mb-6">
          <div 
            className="flex items-center justify-between cursor-pointer p-4 bg-yellow-50 rounded-lg hover:bg-yellow-100 transition-colors"
            onClick={() => toggleSection('optimization')}
          >
            <div className="flex items-center">
              <TrendingDown className="w-5 h-5 text-yellow-600 mr-3" />
              <h3 className="text-lg font-medium text-yellow-900">Money-Saving Tips</h3>
              {totalPotentialSavings > 0 && (
                <span className="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                  Save up to {formatCurrency(totalPotentialSavings)}
                </span>
              )}
            </div>
            {expandedSections.has('optimization') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
          
          {expandedSections.has('optimization') && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {guide.optimizationTips.map((tip, index) => (
                <div key={index} className="border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center">
                      {CATEGORY_ICONS[tip.category]}
                      <h4 className="font-medium text-gray-900 ml-2">{tip.title}</h4>
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${DIFFICULTY_COLORS[tip.difficulty]}`}>
                        {tip.difficulty}
                      </span>
                      {tip.userSpecific && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                          <Star className="w-3 h-3 inline mr-1" />
                          For You
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <p className="text-sm text-gray-700 mb-3">{tip.description}</p>
                  
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center text-gray-600">
                      <Clock className="w-4 h-4 mr-1" />
                      {tip.timeToImplement}
                    </div>
                    {tip.potentialSavings && (
                      <div className="font-medium text-green-600">
                        Save {formatCurrency(tip.potentialSavings)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick Reference Glossary */}
      <div>
        <div 
          className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => toggleSection('glossary')}
        >
          <div className="flex items-center">
            <BookOpen className="w-5 h-5 text-gray-600 mr-3" />
            <h3 className="text-lg font-medium text-gray-900">Insurance Terms Glossary</h3>
            <span className="ml-2 px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded-full">
              {guide.glossary.length} terms
            </span>
          </div>
          {expandedSections.has('glossary') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
        
        {expandedSections.has('glossary') && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {guide.glossary.map((term, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-2">{term.term}</h4>
                <p className="text-sm text-gray-700 mb-2">{term.definition}</p>
                {term.userSpecificExample && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-2 mt-2">
                    <p className="text-xs text-blue-800">
                      <strong>Your Example:</strong> {term.userSpecificExample}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}