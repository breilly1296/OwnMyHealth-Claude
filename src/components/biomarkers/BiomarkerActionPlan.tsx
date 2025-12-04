/**
 * BiomarkerActionPlan Component
 *
 * Generates and displays personalized action recommendations for an out-of-range biomarker.
 * Provides actionable steps users can take to improve their health metrics.
 *
 * Features:
 * - Generates context-aware recommendations based on biomarker type and value
 * - Shows estimated costs and insurance coverage information
 * - Prioritizes actions by urgency (high/medium/low)
 * - Categorizes actions: follow-up tests, supplements, doctor visits, lifestyle changes
 * - Expandable sections for detailed information on each action
 *
 * @module components/biomarkers/BiomarkerActionPlan
 */

import React, { useState } from 'react';
import {
  AlertCircle,
  TrendingDown,
  Shield,
  Pill,
  FileText,
  Calendar,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Target,
  ArrowRight
} from 'lucide-react';
import type { Biomarker, InsurancePlan } from '../../types';

interface BiomarkerActionPlanProps {
  /** The biomarker requiring action */
  biomarker: Biomarker;
  /** User's insurance plans for coverage lookup */
  insurancePlans: InsurancePlan[];
  /** Whether the biomarker shows a concerning trend */
  isTrending?: boolean;
}

interface ActionItem {
  id: string;
  type: 'test' | 'supplement' | 'doctor' | 'lifestyle';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  timeframe: string;
  estimatedCost: number;
  insuranceCoverage?: {
    covered: boolean;
    planName?: string;
    details?: string;
    copay?: number;
    coinsurance?: number;
  };
  keywords: string[];
}

/**
 * BiomarkerActionPlan - An expandable card showing recommended actions for abnormal biomarkers.
 *
 * Generates personalized action plans based on the biomarker's status:
 * - Tests to schedule (e.g., A1C for high glucose)
 * - Specialists to consult (e.g., endocrinologist, cardiologist)
 * - Supplements to consider (e.g., vitamin D, omega-3s)
 * - Lifestyle changes (e.g., diet modifications, exercise plans)
 *
 * Each action item shows:
 * - Priority level (high/medium/low) with color coding
 * - Timeframe for action
 * - Estimated cost and insurance coverage details
 * - Action buttons (Schedule Test, Find Providers, etc.)
 *
 * The component only renders if the biomarker is out of range or showing a trend.
 * Severity is calculated based on how far the value deviates from normal.
 *
 * @param props - The component props
 * @returns An expandable action plan card, or null if no action needed
 */
export default function BiomarkerActionPlan({ biomarker, insurancePlans, isTrending = false }: BiomarkerActionPlanProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const isOutOfRange = biomarker.value < biomarker.normalRange.min || biomarker.value > biomarker.normalRange.max;
  const isHigh = biomarker.value > biomarker.normalRange.max;
  const isLow = biomarker.value < biomarker.normalRange.min;
  
  // Skip if biomarker is in normal range and not trending
  if (!isOutOfRange && !isTrending) {
    return null;
  }
  
  // Generate action items based on biomarker
  const actionItems = generateActionItems(biomarker, isHigh, isLow, isTrending, isOutOfRange);
  
  // Check insurance coverage for each action item
  const actionsWithCoverage = actionItems.map(action => ({
    ...action,
    insuranceCoverage: checkInsuranceCoverage(action, insurancePlans)
  }));
  
  // Get severity level for styling
  const getSeverityLevel = () => {
    if (isOutOfRange) {
      const percentDeviation = isHigh 
        ? (biomarker.value - biomarker.normalRange.max) / biomarker.normalRange.max
        : (biomarker.normalRange.min - biomarker.value) / biomarker.normalRange.min;
      
      if (percentDeviation > 0.3) return 'high';
      if (percentDeviation > 0.1) return 'medium';
      return 'low';
    }
    return isTrending ? 'medium' : 'low';
  };
  
  const severity = getSeverityLevel();
  
  // Get appropriate colors based on severity
  const getSeverityColors = () => {
    switch (severity) {
      case 'high':
        return 'border-red-200 bg-red-50';
      case 'medium':
        return 'border-orange-200 bg-orange-50';
      case 'low':
        return 'border-yellow-200 bg-yellow-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };
  
  const colors = getSeverityColors();
  
  return (
    <div className={`border rounded-lg overflow-hidden mb-6 ${colors}`}>
      {/* Header */}
      <div 
        className="p-4 cursor-pointer hover:bg-opacity-80 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            {isOutOfRange ? (
              <AlertCircle className={`w-5 h-5 ${severity === 'high' ? 'text-red-600' : severity === 'medium' ? 'text-orange-600' : 'text-yellow-600'} mr-3`} />
            ) : (
              <TrendingDown className="w-5 h-5 text-orange-600 mr-3" />
            )}
            <div>
              <h3 className="font-medium text-gray-900">
                {isOutOfRange 
                  ? `${biomarker.name} is ${isHigh ? 'High' : 'Low'}`
                  : `${biomarker.name} is Trending ${isTrending ? 'Down' : 'Abnormally'}`}
              </h3>
              <p className="text-sm text-gray-600">
                Current: {biomarker.value} {biomarker.unit} 
                {isOutOfRange 
                  ? ` (Normal: ${biomarker.normalRange.min}-${biomarker.normalRange.max} ${biomarker.unit})`
                  : ' (Showing concerning trend)'}
              </p>
            </div>
          </div>
          <div className="flex items-center">
            <span className={`px-2 py-1 rounded-full text-xs font-medium mr-2 ${
              severity === 'high' ? 'bg-red-100 text-red-800' :
              severity === 'medium' ? 'bg-orange-100 text-orange-800' :
              'bg-yellow-100 text-yellow-800'
            }`}>
              {severity === 'high' ? 'URGENT ACTION' : 
               severity === 'medium' ? 'ACTION NEEDED' : 
               'MONITOR CLOSELY'}
            </span>
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </div>
      </div>
      
      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 p-4 bg-white">
          <div className="space-y-4">
            {/* Action Items */}
            <div>
              <h4 className="text-lg font-medium text-gray-900 mb-3">Recommended Action Plan</h4>
              <div className="space-y-4">
                {actionsWithCoverage.map((action) => (
                  <div key={action.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start">
                      <div className={`p-2 rounded-full mt-0.5 ${
                        action.type === 'test' ? 'bg-blue-100 text-blue-600' :
                        action.type === 'supplement' ? 'bg-green-100 text-green-600' :
                        action.type === 'doctor' ? 'bg-purple-100 text-purple-600' :
                        'bg-yellow-100 text-yellow-600'
                      }`}>
                        {action.type === 'test' ? <FileText className="w-5 h-5" /> :
                         action.type === 'supplement' ? <Pill className="w-5 h-5" /> :
                         action.type === 'doctor' ? <Calendar className="w-5 h-5" /> :
                         <Target className="w-5 h-5" />}
                      </div>
                      <div className="ml-4 flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <h5 className="font-medium text-gray-900">{action.title}</h5>
                            <p className="text-sm text-gray-700 mt-1">{action.description}</p>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              action.priority === 'high' ? 'bg-red-100 text-red-800' :
                              action.priority === 'medium' ? 'bg-orange-100 text-orange-800' :
                              'bg-green-100 text-green-800'
                            }`}>
                              {action.priority.toUpperCase()} PRIORITY
                            </span>
                            <div className="flex items-center mt-2 text-sm text-gray-600">
                              <Clock className="w-4 h-4 mr-1" />
                              {action.timeframe}
                            </div>
                          </div>
                        </div>
                        
                        {/* Insurance Coverage */}
                        <div className="mt-3 p-3 rounded-lg bg-gray-50">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center">
                              <Shield className={`w-4 h-4 mr-2 ${action.insuranceCoverage?.covered ? 'text-green-500' : 'text-gray-400'}`} />
                              <span className={`text-sm font-medium ${action.insuranceCoverage?.covered ? 'text-green-700' : 'text-gray-600'}`}>
                                {action.insuranceCoverage?.covered 
                                  ? `Covered by ${action.insuranceCoverage.planName}` 
                                  : 'Not specifically covered'}
                              </span>
                            </div>
                            <div className="text-sm text-gray-600">
                              <DollarSign className="w-4 h-4 inline mr-1" />
                              Est. cost: ${action.estimatedCost}
                              {action.insuranceCoverage?.covered && action.insuranceCoverage.copay !== undefined && (
                                <span className="ml-2 text-green-600">
                                  (${action.insuranceCoverage.copay} copay)
                                </span>
                              )}
                            </div>
                          </div>
                          {action.insuranceCoverage?.details && (
                            <p className="text-xs text-gray-500 mt-2">{action.insuranceCoverage.details}</p>
                          )}
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="mt-4 flex justify-end space-x-3">
                          {action.type === 'test' && (
                            <button className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center">
                              <Calendar className="w-4 h-4 mr-1.5" />
                              Schedule Test
                            </button>
                          )}
                          {action.type === 'doctor' && (
                            <button className="px-3 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm flex items-center">
                              <ExternalLink className="w-4 h-4 mr-1.5" />
                              Find Providers
                            </button>
                          )}
                          {action.type === 'supplement' && (
                            <button className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm flex items-center">
                              <ArrowRight className="w-4 h-4 mr-1.5" />
                              Learn More
                            </button>
                          )}
                          {action.type === 'lifestyle' && (
                            <button className="px-3 py-1.5 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 text-sm flex items-center">
                              <Target className="w-4 h-4 mr-1.5" />
                              Get Plan
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Additional Information */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
              <p className="font-medium mb-2">Why This Matters</p>
              <p>
                {getBiomarkerImportance(biomarker.name, isHigh, isLow)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function to generate action items based on biomarker
function generateActionItems(biomarker: Biomarker, isHigh: boolean, isLow: boolean, isTrending: boolean, isOutOfRange: boolean): ActionItem[] {
  const actions: ActionItem[] = [];
  
  // Common recommendations based on category and status
  switch (biomarker.name) {
    case 'Glucose (Fasting)':
      if (isHigh) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: 'Hemoglobin A1C Test',
          description: 'Measures your average blood sugar level over the past 3 months to assess diabetes risk',
          priority: biomarker.value > 125 ? 'high' : biomarker.value > 110 ? 'medium' : 'low',
          timeframe: biomarker.value > 125 ? 'Within 1 week' : 'Within 2-4 weeks',
          estimatedCost: 80,
          keywords: ['a1c', 'diabetes', 'glucose', 'blood test', 'lab']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'doctor',
          title: 'Endocrinology Consultation',
          description: 'Specialized evaluation for elevated blood glucose and diabetes risk assessment',
          priority: biomarker.value > 125 ? 'high' : 'medium',
          timeframe: biomarker.value > 125 ? 'Within 2 weeks' : 'Within 1 month',
          estimatedCost: 350,
          keywords: ['endocrinology', 'diabetes', 'specialist', 'consultation']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'lifestyle',
          title: 'Glucose Management Plan',
          description: 'Personalized diet and exercise plan to help regulate blood sugar levels',
          priority: 'medium',
          timeframe: 'Start within 1 week',
          estimatedCost: 150,
          keywords: ['nutrition', 'diet', 'exercise', 'diabetes', 'glucose']
        });
      }
      break;
      
    case 'Total Cholesterol':
    case 'LDL Cholesterol':
      if (isHigh) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: 'Comprehensive Lipid Panel',
          description: 'Detailed analysis of cholesterol fractions and other lipids',
          priority: biomarker.value > biomarker.normalRange.max * 1.3 ? 'high' : 'medium',
          timeframe: 'Within 2-4 weeks',
          estimatedCost: 120,
          keywords: ['lipid', 'cholesterol', 'blood test', 'lab']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'doctor',
          title: 'Cardiology Consultation',
          description: 'Specialized evaluation for cardiovascular risk factors',
          priority: biomarker.value > biomarker.normalRange.max * 1.3 ? 'high' : 'medium',
          timeframe: 'Within 1 month',
          estimatedCost: 400,
          keywords: ['cardiology', 'heart', 'specialist', 'consultation']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'supplement',
          title: 'Plant Sterols & Omega-3s',
          description: 'Natural supplements that may help lower cholesterol levels',
          priority: 'medium',
          timeframe: 'Start after consulting doctor',
          estimatedCost: 40,
          keywords: ['supplement', 'cholesterol', 'omega', 'plant sterol']
        });
      }
      break;
      
    case 'HDL Cholesterol':
      if (isLow) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: 'Advanced Lipid Panel',
          description: 'Detailed analysis of HDL subfractions and other cardiovascular markers',
          priority: 'medium',
          timeframe: 'Within 1 month',
          estimatedCost: 150,
          keywords: ['lipid', 'hdl', 'cholesterol', 'blood test', 'lab']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'lifestyle',
          title: 'HDL Boosting Program',
          description: 'Personalized exercise and diet plan to increase HDL levels',
          priority: 'medium',
          timeframe: 'Start within 1 week',
          estimatedCost: 120,
          keywords: ['exercise', 'diet', 'hdl', 'lifestyle']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'supplement',
          title: 'Omega-3 Fatty Acids',
          description: 'May help increase HDL cholesterol levels',
          priority: 'low',
          timeframe: 'Start after consulting doctor',
          estimatedCost: 30,
          keywords: ['supplement', 'omega', 'fish oil', 'hdl']
        });
      }
      break;
      
    case 'Vitamin D':
      if (isLow) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: 'Vitamin D Retest',
          description: 'Follow-up testing after supplementation begins',
          priority: biomarker.value < biomarker.normalRange.min * 0.5 ? 'high' : 'medium',
          timeframe: 'After 3 months of supplementation',
          estimatedCost: 80,
          keywords: ['vitamin d', 'blood test', 'lab']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'supplement',
          title: 'Vitamin D Supplementation',
          description: `Recommended dose: ${biomarker.value < 20 ? '5,000-10,000' : '2,000-5,000'} IU daily`,
          priority: biomarker.value < 20 ? 'high' : 'medium',
          timeframe: 'Start immediately',
          estimatedCost: 20,
          keywords: ['vitamin d', 'supplement']
        });
        
        if (biomarker.value < 20) {
          actions.push({
            id: crypto.randomUUID(),
            type: 'doctor',
            title: 'Primary Care Follow-up',
            description: 'Evaluation and management of vitamin D deficiency',
            priority: 'medium',
            timeframe: 'Within 1 month',
            estimatedCost: 150,
            keywords: ['primary care', 'vitamin d', 'deficiency', 'general']
          });
        }
      }
      break;
      
    case 'Testosterone (Total)':
      if (isHigh) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'doctor',
          title: 'Endocrinology Consultation',
          description: 'Specialized evaluation for hormone imbalances',
          priority: 'high',
          timeframe: 'Within 2-4 weeks',
          estimatedCost: 350,
          keywords: ['endocrinology', 'hormone', 'testosterone', 'specialist']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: 'Comprehensive Hormone Panel',
          description: 'Detailed analysis of reproductive and metabolic hormones',
          priority: 'high',
          timeframe: 'Within 2 weeks',
          estimatedCost: 250,
          keywords: ['hormone', 'testosterone', 'blood test', 'lab']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: 'Pelvic Ultrasound',
          description: 'Imaging to assess ovarian morphology (for females)',
          priority: 'medium',
          timeframe: 'Within 1 month',
          estimatedCost: 300,
          keywords: ['ultrasound', 'imaging', 'pelvic', 'ovarian']
        });
      }
      break;
      
    case 'Blood Pressure (Systolic)':
      if (isHigh) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'doctor',
          title: 'Cardiology Consultation',
          description: 'Specialized evaluation for high blood pressure',
          priority: biomarker.value > 160 ? 'high' : 'medium',
          timeframe: biomarker.value > 160 ? 'Within 1-2 weeks' : 'Within 1 month',
          estimatedCost: 400,
          keywords: ['cardiology', 'hypertension', 'blood pressure', 'specialist']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: 'Ambulatory Blood Pressure Monitoring',
          description: '24-hour blood pressure monitoring for accurate assessment',
          priority: 'medium',
          timeframe: 'Within 2-4 weeks',
          estimatedCost: 150,
          keywords: ['blood pressure', 'monitoring', 'ambulatory', 'diagnostic']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'lifestyle',
          title: 'DASH Diet Plan',
          description: 'Dietary approach specifically designed to lower blood pressure',
          priority: 'medium',
          timeframe: 'Start immediately',
          estimatedCost: 0,
          keywords: ['diet', 'dash', 'hypertension', 'nutrition']
        });
      }
      break;
      
    case 'CRP':
      if (isHigh) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'doctor',
          title: 'Rheumatology Consultation',
          description: 'Specialized evaluation for inflammatory conditions',
          priority: biomarker.value > 10 ? 'high' : 'medium',
          timeframe: biomarker.value > 10 ? 'Within 1-2 weeks' : 'Within 1 month',
          estimatedCost: 350,
          keywords: ['rheumatology', 'inflammation', 'specialist', 'consultation']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: 'Comprehensive Inflammatory Panel',
          description: 'Detailed testing for inflammatory and autoimmune markers',
          priority: biomarker.value > 10 ? 'high' : 'medium',
          timeframe: 'Within 2 weeks',
          estimatedCost: 300,
          keywords: ['inflammation', 'crp', 'esr', 'blood test', 'lab']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'supplement',
          title: 'Anti-inflammatory Supplements',
          description: 'Omega-3 fatty acids, curcumin, and other natural anti-inflammatories',
          priority: 'medium',
          timeframe: 'Start after consulting doctor',
          estimatedCost: 50,
          keywords: ['supplement', 'inflammation', 'omega', 'curcumin']
        });
      }
      break;
      
    case 'Homocysteine':
      if (isHigh) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: 'MTHFR Genetic Testing',
          description: 'Test for genetic variants affecting homocysteine metabolism',
          priority: 'medium',
          timeframe: 'Within 1 month',
          estimatedCost: 200,
          keywords: ['genetic', 'mthfr', 'homocysteine', 'lab']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'supplement',
          title: 'Methylated B Vitamins',
          description: 'Specialized B vitamin supplements to support homocysteine metabolism',
          priority: 'medium',
          timeframe: 'Start after consulting doctor',
          estimatedCost: 40,
          keywords: ['supplement', 'vitamin b', 'folate', 'methylation']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'doctor',
          title: 'Cardiology Consultation',
          description: 'Evaluation for cardiovascular risk related to elevated homocysteine',
          priority: 'medium',
          timeframe: 'Within 1-2 months',
          estimatedCost: 400,
          keywords: ['cardiology', 'heart', 'specialist', 'consultation']
        });
      }
      break;
      
    default:
      // Generic recommendations for other biomarkers
      if (isOutOfRange) {
        actions.push({
          id: crypto.randomUUID(),
          type: 'test',
          title: `Follow-up ${biomarker.name} Test`,
          description: `Confirm abnormal result and monitor changes`,
          priority: 'medium',
          timeframe: 'Within 1 month',
          estimatedCost: 100,
          keywords: [biomarker.name.toLowerCase(), 'test', 'lab', 'blood test']
        });
        
        actions.push({
          id: crypto.randomUUID(),
          type: 'doctor',
          title: 'Primary Care Consultation',
          description: `Evaluation of abnormal ${biomarker.name} level`,
          priority: 'medium',
          timeframe: 'Within 1 month',
          estimatedCost: 150,
          keywords: ['primary care', 'general', 'doctor', 'consultation']
        });
      }
  }
  
  // Add trending-specific actions
  if (isTrending && actions.length === 0) {
    actions.push({
      id: crypto.randomUUID(),
      type: 'test',
      title: `${biomarker.name} Monitoring`,
      description: 'More frequent testing to track concerning trend',
      priority: 'medium',
      timeframe: 'Every 3 months',
      estimatedCost: 80,
      keywords: [biomarker.name.toLowerCase(), 'test', 'lab', 'monitoring']
    });
    
    actions.push({
      id: crypto.randomUUID(),
      type: 'lifestyle',
      title: 'Preventive Health Plan',
      description: `Lifestyle modifications to address declining ${biomarker.name} trend`,
      priority: 'medium',
      timeframe: 'Start within 2 weeks',
      estimatedCost: 0,
      keywords: ['lifestyle', 'prevention', 'diet', 'exercise']
    });
  }
  
  return actions;
}

// Check insurance coverage for an action item
function checkInsuranceCoverage(action: ActionItem, insurancePlans: InsurancePlan[]) {
  if (!insurancePlans || insurancePlans.length === 0) {
    return { covered: false, details: 'No insurance plans available' };
  }

  // Find matching benefits in insurance plans
  const matchingBenefits = insurancePlans.flatMap(plan => 
    plan.benefits.filter(benefit => {
      const benefitName = benefit.serviceName.toLowerCase();
      const actionKeywords = action.keywords.map(k => k.toLowerCase());
      
      return actionKeywords.some(keyword => benefitName.includes(keyword)) ||
             benefitName.includes(action.title.toLowerCase());
    }).map(benefit => ({
      planName: plan.planName,
      benefit
    }))
  );

  if (matchingBenefits.length === 0) {
    // Special case for supplements which are typically not covered
    if (action.type === 'supplement') {
      return { 
        covered: false, 
        details: 'Supplements are typically not covered by insurance' 
      };
    }
    
    // Special case for lifestyle changes
    if (action.type === 'lifestyle') {
      return { 
        covered: false, 
        details: 'Lifestyle programs may be partially covered depending on specific services' 
      };
    }
    
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
}

// Get importance explanation for biomarker
function getBiomarkerImportance(biomarkerName: string, isHigh: boolean, isLow: boolean): string {
  switch (biomarkerName) {
    case 'Glucose (Fasting)':
      return isHigh 
        ? 'Elevated blood glucose levels can indicate prediabetes or diabetes. Sustained high levels can damage blood vessels, nerves, and organs over time.'
        : 'Low blood glucose levels can cause fatigue, dizziness, and in severe cases, loss of consciousness.';
      
    case 'Total Cholesterol':
    case 'LDL Cholesterol':
      return isHigh
        ? 'High cholesterol increases your risk of heart disease and stroke by contributing to plaque buildup in your arteries.'
        : 'While less common, very low cholesterol may affect hormone production and cell function.';
      
    case 'HDL Cholesterol':
      return isLow
        ? 'Low HDL cholesterol reduces your body\'s ability to remove harmful LDL cholesterol from your arteries, increasing cardiovascular risk.'
        : 'High HDL cholesterol is generally beneficial as it helps remove other forms of cholesterol from your bloodstream.';
      
    case 'Vitamin D':
      return isLow
        ? 'Low vitamin D levels can affect bone health, immune function, mood, and may be associated with increased risk of certain chronic diseases.'
        : 'Extremely high vitamin D levels can cause hypercalcemia, leading to nausea, weakness, and kidney problems.';
      
    case 'Testosterone (Total)':
      return isHigh
        ? 'In women, high testosterone can indicate conditions like PCOS and may cause symptoms like irregular periods, acne, and excess hair growth. In men, it may indicate testicular or adrenal issues.'
        : 'Low testosterone can affect energy levels, muscle mass, bone density, and sexual function.';
      
    case 'Blood Pressure (Systolic)':
      return isHigh
        ? 'High blood pressure puts extra strain on your heart and blood vessels, increasing your risk of heart attack, stroke, and other serious health problems.'
        : 'Low blood pressure can cause dizziness, fainting, and in severe cases, shock.';
      
    case 'CRP':
      return isHigh
        ? 'Elevated CRP indicates inflammation in your body, which may be associated with infection, autoimmune disorders, or increased cardiovascular risk.'
        : 'Low CRP levels generally indicate low levels of inflammation.';
      
    case 'Homocysteine':
      return isHigh
        ? 'Elevated homocysteine is associated with increased risk of cardiovascular disease, stroke, and may affect cognitive function. It can be influenced by genetic factors like MTHFR variants.'
        : 'Low homocysteine levels are generally not a concern.';
      
    default:
      return isHigh
        ? `Elevated ${biomarkerName} levels may indicate underlying health issues that should be evaluated by a healthcare professional.`
        : `Low ${biomarkerName} levels may indicate underlying health issues that should be evaluated by a healthcare professional.`;
  }
}