import React, { useState, useEffect } from 'react';
import { 
  Target, 
  Plus, 
  Search, 
  Filter, 
  TrendingUp, 
  DollarSign, 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Eye,
  Calendar,
  Shield,
  Activity,
  Zap,
  Heart,
  Brain,
  Users,
  FileText,
  ArrowRight,
  Star,
  Lightbulb
} from 'lucide-react';
import type { 
  Biomarker, 
  InsurancePlan, 
  HealthNeedsAnalysis 
} from '../types';
import { 
  healthGoalEngine, 
  type HealthGoal, 
  type GoalMatchingResult, 
  type OptimalCoveragePlan,
  type HealthGoalCategory 
} from '../utils/healthGoalEngine';

interface HealthGoalMatcherProps {
  biomarkers: Biomarker[];
  insurancePlans: InsurancePlan[];
  healthNeeds: HealthNeedsAnalysis;
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_ICONS = {
  'preventive_screening': Shield,
  'diagnostic_testing': Activity,
  'condition_management': Heart,
  'wellness_optimization': TrendingUp,
  'emergency_preparedness': AlertTriangle,
  'specialist_consultation': Users,
  'medication_management': Zap,
  'lifestyle_intervention': Target
};

const CATEGORY_COLORS = {
  'preventive_screening': 'text-green-600 bg-green-100',
  'diagnostic_testing': 'text-blue-600 bg-blue-100',
  'condition_management': 'text-red-600 bg-red-100',
  'wellness_optimization': 'text-purple-600 bg-purple-100',
  'emergency_preparedness': 'text-orange-600 bg-orange-100',
  'specialist_consultation': 'text-indigo-600 bg-indigo-100',
  'medication_management': 'text-yellow-600 bg-yellow-100',
  'lifestyle_intervention': 'text-pink-600 bg-pink-100'
};

const PRIORITY_COLORS = {
  'urgent': 'text-red-700 bg-red-100 border-red-200',
  'high': 'text-orange-700 bg-orange-100 border-orange-200',
  'medium': 'text-yellow-700 bg-yellow-100 border-yellow-200',
  'low': 'text-green-700 bg-green-100 border-green-200'
};

const ACTION_COLORS = {
  'pursue_immediately': 'text-red-700 bg-red-100',
  'plan_for_future': 'text-blue-700 bg-blue-100',
  'consider_alternatives': 'text-yellow-700 bg-yellow-100',
  'not_recommended': 'text-gray-700 bg-gray-100'
};

export default function HealthGoalMatcher({ 
  biomarkers, 
  insurancePlans, 
  healthNeeds, 
  isOpen, 
  onClose 
}: HealthGoalMatcherProps) {
  const [matchedGoals, setMatchedGoals] = useState<GoalMatchingResult[]>([]);
  const [selectedGoal, setSelectedGoal] = useState<HealthGoal | null>(null);
  const [coveragePlan, setCoveragePlan] = useState<OptimalCoveragePlan | null>(null);
  const [activeTab, setActiveTab] = useState<'discover' | 'plan' | 'track'>('discover');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<HealthGoalCategory | 'all'>('all');
  const [userPreferences, setUserPreferences] = useState({
    maxBudget: 2000,
    preferLowerCost: true,
    preferBetterCoverage: false,
    priorityCategories: [] as HealthGoalCategory[]
  });

  // Initialize goal matching
  useEffect(() => {
    if (biomarkers.length > 0) {
      const results = healthGoalEngine.matchHealthGoals(biomarkers, healthNeeds, {
        priorityCategories: userPreferences.priorityCategories,
        maxBudget: userPreferences.maxBudget
      });
      setMatchedGoals(results);
    }
  }, [biomarkers, healthNeeds, userPreferences]);

  // Handle goal selection and coverage analysis
  const handleGoalSelect = (goal: HealthGoal) => {
    setSelectedGoal(goal);
    if (insurancePlans.length > 0) {
      const optimalPlan = healthGoalEngine.calculateOptimalCoverage(goal, insurancePlans, {
        preferLowerCost: userPreferences.preferLowerCost,
        preferBetterCoverage: userPreferences.preferBetterCoverage
      });
      setCoveragePlan(optimalPlan);
      setActiveTab('plan');
    }
  };

  // Filter goals based on search and category
  const filteredGoals = matchedGoals.filter(result => {
    const matchesSearch = result.goal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         result.goal.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || result.goal.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Get category icon
  const getCategoryIcon = (category: HealthGoalCategory) => {
    const Icon = CATEGORY_ICONS[category] || Target;
    return <Icon className="w-4 h-4" />;
  };

  // Get score color
  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600';
    if (score >= 0.6) return 'text-yellow-600';
    if (score >= 0.4) return 'text-orange-600';
    return 'text-red-600';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Target className="w-6 h-6 text-blue-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Health Goal Matcher</h2>
              <p className="text-sm text-gray-600">
                AI-powered matching of health goals to your insurance coverage
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
            { id: 'discover', label: 'Discover Goals', icon: Search },
            { id: 'plan', label: 'Coverage Plan', icon: Shield },
            { id: 'track', label: 'Track Progress', icon: TrendingUp }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600 bg-blue-50'
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
          {/* Discover Goals Tab */}
          {activeTab === 'discover' && (
            <div className="space-y-6">
              {/* Search and Filters */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search health goals..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value as any)}
                    className="border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">All Categories</option>
                    <option value="preventive_screening">Preventive Screening</option>
                    <option value="diagnostic_testing">Diagnostic Testing</option>
                    <option value="condition_management">Condition Management</option>
                    <option value="wellness_optimization">Wellness Optimization</option>
                    <option value="specialist_consultation">Specialist Consultation</option>
                  </select>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max Budget: {formatCurrency(userPreferences.maxBudget)}
                    </label>
                    <input
                      type="range"
                      min="500"
                      max="10000"
                      step="500"
                      value={userPreferences.maxBudget}
                      onChange={(e) => setUserPreferences(prev => ({
                        ...prev,
                        maxBudget: parseInt(e.target.value)
                      }))}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Matched Goals */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Recommended Health Goals ({filteredGoals.length})
                </h3>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredGoals.map((result, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div className={`p-2 rounded-lg ${CATEGORY_COLORS[result.goal.category]}`}>
                            {getCategoryIcon(result.goal.category)}
                          </div>
                          <div>
                            <h4 className="font-medium text-gray-900">{result.goal.title}</h4>
                            <p className="text-sm text-gray-600">{result.goal.description}</p>
                          </div>
                        </div>
                        
                        <div className="flex flex-col items-end space-y-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${PRIORITY_COLORS[result.goal.priority]}`}>
                            {result.goal.priority.toUpperCase()}
                          </span>
                          <span className={`text-lg font-bold ${getScoreColor(result.matchScore)}`}>
                            {Math.round(result.matchScore * 100)}%
                          </span>
                        </div>
                      </div>

                      {/* Match Reasons */}
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Why this matches you:</h5>
                        <div className="flex flex-wrap gap-2">
                          {result.matchReasons.map((reason, reasonIndex) => (
                            <span key={reasonIndex} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Goal Metrics */}
                      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                        <div className="text-center">
                          <div className="font-medium text-gray-900">{Math.round(result.urgencyScore * 100)}%</div>
                          <div className="text-gray-600">Urgency</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-gray-900">{Math.round(result.feasibilityScore * 100)}%</div>
                          <div className="text-gray-600">Feasibility</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-gray-900">{formatCurrency(result.goal.estimatedCost)}</div>
                          <div className="text-gray-600">Est. Cost</div>
                        </div>
                      </div>

                      {/* Recommended Action */}
                      <div className="mb-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${ACTION_COLORS[result.recommendedAction]}`}>
                          {result.recommendedAction === 'pursue_immediately' && <AlertTriangle className="w-3 h-3 mr-1" />}
                          {result.recommendedAction === 'plan_for_future' && <Calendar className="w-3 h-3 mr-1" />}
                          {result.recommendedAction === 'consider_alternatives' && <Lightbulb className="w-3 h-3 mr-1" />}
                          {result.recommendedAction === 'not_recommended' && <XCircle className="w-3 h-3 mr-1" />}
                          {result.recommendedAction.replace('_', ' ').toUpperCase()}
                        </span>
                      </div>

                      {/* Required Services Preview */}
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Required Services:</h5>
                        <div className="space-y-1">
                          {result.goal.requiredServices.slice(0, 3).map((service, serviceIndex) => (
                            <div key={serviceIndex} className="flex justify-between text-sm">
                              <span className="text-gray-600">{service.serviceName}</span>
                              <span className="font-medium">{formatCurrency(service.estimatedCost)}</span>
                            </div>
                          ))}
                          {result.goal.requiredServices.length > 3 && (
                            <div className="text-sm text-gray-500">
                              +{result.goal.requiredServices.length - 3} more services
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action Button */}
                      <button
                        onClick={() => handleGoalSelect(result.goal)}
                        className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                      >
                        <Shield className="w-4 h-4 mr-2" />
                        Analyze Coverage
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </button>
                    </div>
                  ))}
                </div>

                {filteredGoals.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Target className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>No health goals match your current criteria.</p>
                    <p className="text-sm mt-2">Try adjusting your search filters or budget.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Coverage Plan Tab */}
          {activeTab === 'plan' && selectedGoal && coveragePlan && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-blue-900">{selectedGoal.title}</h3>
                    <p className="text-blue-700">{selectedGoal.description}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-blue-900">
                      {Math.round(coveragePlan.bestPathway.totalCoverage)}%
                    </div>
                    <div className="text-sm text-blue-700">Coverage</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg p-4">
                    <div className="flex items-center">
                      <DollarSign className="w-5 h-5 text-green-600 mr-2" />
                      <div>
                        <div className="font-medium text-gray-900">Your Cost</div>
                        <div className="text-lg font-bold text-green-600">
                          {formatCurrency(coveragePlan.bestPathway.estimatedOutOfPocket)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg p-4">
                    <div className="flex items-center">
                      <Shield className="w-5 h-5 text-blue-600 mr-2" />
                      <div>
                        <div className="font-medium text-gray-900">Insurance Saves</div>
                        <div className="text-lg font-bold text-blue-600">
                          {formatCurrency(coveragePlan.costComparison.savings)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg p-4">
                    <div className="flex items-center">
                      <Clock className="w-5 h-5 text-purple-600 mr-2" />
                      <div>
                        <div className="font-medium text-gray-900">Timeline</div>
                        <div className="text-lg font-bold text-purple-600">
                          {coveragePlan.bestPathway.timeline.totalTimeframe}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Coverage Steps */}
              <div>
                <h4 className="text-lg font-medium text-gray-900 mb-4">Coverage Pathway</h4>
                <div className="space-y-4">
                  {coveragePlan.bestPathway.coverageSteps.map((step, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                            step.covered ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {step.stepNumber}
                          </div>
                          <div>
                            <h5 className="font-medium text-gray-900">{step.serviceName}</h5>
                            <div className="flex items-center mt-1">
                              {step.covered ? (
                                <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-500 mr-2" />
                              )}
                              <span className={`text-sm ${step.covered ? 'text-green-600' : 'text-red-600'}`}>
                                {step.covered ? 'Covered' : 'Not Covered'}
                              </span>
                            </div>
                            {step.requirements.length > 0 && (
                              <div className="mt-2">
                                <div className="text-xs text-gray-500 mb-1">Requirements:</div>
                                <div className="flex flex-wrap gap-1">
                                  {step.requirements.map((req, reqIndex) => (
                                    <span key={reqIndex} className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded">
                                      {req}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <div className="font-medium text-gray-900">
                            {formatCurrency(step.estimatedCost)}
                          </div>
                          <div className="text-sm text-gray-600">
                            {step.costStructure.type === 'copay' && `$${step.costStructure.amount} copay`}
                            {step.costStructure.type === 'coinsurance' && `${step.costStructure.percentage}% coinsurance`}
                            {step.costStructure.type === 'deductible' && 'Subject to deductible'}
                            {step.costStructure.type === 'not_covered' && 'Full cost'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Plan */}
              {coveragePlan.actionPlan.immediateActions.length > 0 && (
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-4">Next Steps</h4>
                  <div className="space-y-3">
                    {coveragePlan.actionPlan.immediateActions.map((action, index) => (
                      <div key={index} className="flex items-start space-x-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                          action.priority === 'high' ? 'bg-red-100 text-red-800' :
                          action.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <h5 className="font-medium text-gray-900">{action.description}</h5>
                          <div className="flex items-center space-x-4 mt-2 text-sm text-gray-600">
                            <span>Due: {new Date(action.dueDate).toLocaleDateString()}</span>
                            <span>Time: {action.estimatedTime}</span>
                            <span className={`px-2 py-1 rounded text-xs ${
                              action.priority === 'high' ? 'bg-red-100 text-red-800' :
                              action.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-green-100 text-green-800'
                            }`}>
                              {action.priority.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Risk Assessment */}
              {coveragePlan.riskAssessment.riskFactors.length > 0 && (
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-4">Risk Assessment</h4>
                  <div className={`p-4 rounded-lg border ${
                    coveragePlan.riskAssessment.overallRisk === 'high' ? 'bg-red-50 border-red-200' :
                    coveragePlan.riskAssessment.overallRisk === 'medium' ? 'bg-yellow-50 border-yellow-200' :
                    'bg-green-50 border-green-200'
                  }`}>
                    <div className="flex items-center mb-3">
                      <AlertTriangle className={`w-5 h-5 mr-2 ${
                        coveragePlan.riskAssessment.overallRisk === 'high' ? 'text-red-600' :
                        coveragePlan.riskAssessment.overallRisk === 'medium' ? 'text-yellow-600' :
                        'text-green-600'
                      }`} />
                      <span className={`font-medium ${
                        coveragePlan.riskAssessment.overallRisk === 'high' ? 'text-red-800' :
                        coveragePlan.riskAssessment.overallRisk === 'medium' ? 'text-yellow-800' :
                        'text-green-800'
                      }`}>
                        {coveragePlan.riskAssessment.overallRisk.toUpperCase()} RISK
                      </span>
                    </div>
                    
                    <div className="space-y-2">
                      {coveragePlan.riskAssessment.riskFactors.map((risk, index) => (
                        <div key={index} className="text-sm">
                          <span className="font-medium">{risk.factor}:</span>
                          <span className="ml-2">{risk.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Track Progress Tab */}
          {activeTab === 'track' && (
            <div className="space-y-6">
              <div className="text-center py-12 text-gray-500">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>Progress tracking will be available once you start pursuing health goals.</p>
                <p className="text-sm mt-2">Select a goal from the Discover tab to get started.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              {matchedGoals.length > 0 && (
                <span>
                  {matchedGoals.length} health goal(s) matched based on your biomarkers and health needs
                </span>
              )}
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