import React from 'react';
import { Shield, AlertCircle, CheckCircle, DollarSign, Calendar, Clock, FileText, ExternalLink } from 'lucide-react';
import type { Biomarker, InsurancePlan, CoverageDetails } from '../../types';

// Local type for recommended services
interface RecommendedServiceInfo {
  name: string;
  keywords: string[];
}

/**
 * Props for the BiomarkerInsurancePanel component.
 * @property biomarker - The biomarker to check coverage for
 * @property insurancePlans - Array of user's insurance plans
 * @property onClose - Callback to close the panel
 */
interface BiomarkerInsurancePanelProps {
  biomarker: Biomarker;
  insurancePlans: InsurancePlan[];
  onClose: () => void;
}

/**
 * BiomarkerInsurancePanel - A modal panel showing insurance coverage for recommended services.
 *
 * Based on an abnormal biomarker, this component:
 * 1. Generates recommended services (tests, consultations, programs)
 * 2. Matches those services against the user's insurance plan benefits
 * 3. Displays coverage details including copays, coinsurance, and requirements
 *
 * For each recommended service, shows:
 * - Service description and estimated cost
 * - Priority level and recommended timeframe
 * - Coverage status (Covered/Coverage Uncertain)
 * - Copay and coinsurance details if covered
 * - Prior authorization and referral requirements
 *
 * Also displays a summary of the user's insurance plans with key details
 * like deductibles and out-of-pocket maximums.
 *
 * @param props - The component props
 * @returns A modal dialog with coverage information
 */
export default function BiomarkerInsurancePanel({ biomarker, insurancePlans, onClose }: BiomarkerInsurancePanelProps) {
  const isOutOfRange = biomarker.value < biomarker.normalRange.min || biomarker.value > biomarker.normalRange.max;
  const isHigh = biomarker.value > biomarker.normalRange.max;
  const isLow = biomarker.value < biomarker.normalRange.min;
  
  // Determine recommended services based on biomarker category and status
  const recommendedServices = getRecommendedServices(biomarker, isHigh, isLow);
  
  // Find matching insurance benefits
  const matchingBenefits = findMatchingBenefits(recommendedServices, insurancePlans);
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Shield className="w-6 h-6 text-blue-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Insurance Coverage for {biomarker.name}</h2>
              <p className="text-sm text-gray-600">
                Based on your current value: {biomarker.value} {biomarker.unit}
                {isOutOfRange ? (
                  <span className="ml-2 text-red-600 font-medium">
                    ({isHigh ? 'Above' : 'Below'} normal range)
                  </span>
                ) : (
                  <span className="ml-2 text-green-600 font-medium">
                    (Within normal range)
                  </span>
                )}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Recommended Services */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Recommended Services</h3>
            
            {recommendedServices.length > 0 ? (
              <div className="space-y-4">
                {recommendedServices.map((service, index) => {
                  const matchingBenefit = matchingBenefits.find(b => b.service === service.name);
                  
                  return (
                    <div key={index} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-medium text-gray-900">{service.name}</h4>
                          <p className="text-sm text-gray-600 mt-1">{service.description}</p>
                          
                          <div className="flex items-center mt-3">
                            <Clock className="w-4 h-4 text-gray-500 mr-1" />
                            <span className="text-sm text-gray-600">{service.timeframe}</span>
                            
                            <span className="mx-2 text-gray-300">|</span>
                            
                            <DollarSign className="w-4 h-4 text-gray-500 mr-1" />
                            <span className="text-sm text-gray-600">Est. cost: ${service.estimatedCost}</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-col items-end">
                          <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            service.priority === 'high' ? 'bg-red-100 text-red-800' :
                            service.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-blue-100 text-blue-800'
                          }`}>
                            {service.priority.toUpperCase()} PRIORITY
                          </div>
                          
                          {matchingBenefit ? (
                            <div className="mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              COVERED
                            </div>
                          ) : (
                            <div className="mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              COVERAGE UNCERTAIN
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Coverage Details */}
                      {matchingBenefit && (
                        <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg p-3">
                          <div className="flex items-start">
                            <Shield className="w-5 h-5 text-blue-600 mr-2 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-blue-800">
                                Covered by {matchingBenefit.planName}
                              </p>
                              <p className="text-sm text-blue-700 mt-1">
                                {formatCoverageDetails(matchingBenefit.benefit.inNetworkCoverage)}
                              </p>
                              {matchingBenefit.benefit.priorAuthRequired && (
                                <p className="text-xs text-blue-600 mt-1 flex items-center">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  Prior authorization required
                                </p>
                              )}
                              {matchingBenefit.benefit.referralRequired && (
                                <p className="text-xs text-blue-600 mt-1 flex items-center">
                                  <FileText className="w-3 h-3 mr-1" />
                                  Referral required
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Action Buttons */}
                      <div className="mt-4 flex justify-end space-x-3">
                        <button className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm flex items-center">
                          <Calendar className="w-4 h-4 mr-1.5" />
                          Schedule
                        </button>
                        <button className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center">
                          <ExternalLink className="w-4 h-4 mr-1.5" />
                          Find Providers
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
                <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-400" />
                <p className="text-gray-600">No specific recommendations needed for this biomarker.</p>
                <p className="text-sm text-gray-500 mt-2">Continue with regular health monitoring.</p>
              </div>
            )}
          </div>
          
          {/* Insurance Plan Summary */}
          {insurancePlans.length > 0 && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">Your Insurance Plans</h3>
              <div className="space-y-3">
                {insurancePlans.map((plan, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-medium text-gray-900">{plan.planName}</h4>
                        <p className="text-sm text-gray-600">{plan.insurerName}</p>
                      </div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {plan.planType}
                      </span>
                    </div>
                    
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center">
                        <DollarSign className="w-4 h-4 text-gray-500 mr-1" />
                        <span className="text-gray-600">
                          Deductible: ${plan.costs.find(c => c.type === 'Deductible')?.amount.toLocaleString() || 'N/A'}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <Shield className="w-4 h-4 text-gray-500 mr-1" />
                        <span className="text-gray-600">
                          Out-of-pocket max: ${plan.costs.find(c => c.type === 'Out-of-Pocket Maximum')?.amount.toLocaleString() || 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Disclaimer */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
            <p className="font-medium mb-2">Insurance Coverage Information</p>
            <p>
              Coverage information is based on your current insurance plans and is subject to change. 
              This is not a guarantee of coverage. Always verify with your insurance provider before 
              scheduling services.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper function to get recommended services based on biomarker
function getRecommendedServices(biomarker: Biomarker, isHigh: boolean, isLow: boolean) {
  if (!isHigh && !isLow) {
    return []; // No recommendations needed for normal range
  }
  
  const services = [];
  
  // Common recommendations based on category
  switch (biomarker.category) {
    case 'Blood':
      if (biomarker.name === 'Glucose (Fasting)' && isHigh) {
        services.push({
          name: 'Endocrinology Consultation',
          description: 'Specialized evaluation for elevated blood glucose levels',
          priority: 'high',
          estimatedCost: 350,
          timeframe: 'Within 2-4 weeks',
          keywords: ['endocrinology', 'diabetes', 'glucose', 'specialist']
        });
        services.push({
          name: 'Hemoglobin A1C Test',
          description: 'Measures average blood sugar over the past 3 months',
          priority: 'high',
          estimatedCost: 80,
          timeframe: 'Within 1-2 weeks',
          keywords: ['a1c', 'diabetes', 'glucose', 'lab test']
        });
        services.push({
          name: 'Diabetes Education Program',
          description: 'Learn strategies for managing blood sugar levels',
          priority: 'medium',
          estimatedCost: 200,
          timeframe: 'Within 1-2 months',
          keywords: ['diabetes', 'education', 'nutrition', 'counseling']
        });
      } else if (biomarker.name.includes('Hemoglobin') && isLow) {
        services.push({
          name: 'Hematology Consultation',
          description: 'Specialized evaluation for low hemoglobin levels',
          priority: 'medium',
          estimatedCost: 300,
          timeframe: 'Within 2-4 weeks',
          keywords: ['hematology', 'anemia', 'blood', 'specialist']
        });
        services.push({
          name: 'Iron Panel',
          description: 'Comprehensive testing of iron levels and storage',
          priority: 'medium',
          estimatedCost: 120,
          timeframe: 'Within 1-2 weeks',
          keywords: ['iron', 'ferritin', 'blood test', 'lab']
        });
      }
      break;
      
    case 'Lipids':
      if ((biomarker.name === 'Total Cholesterol' || biomarker.name === 'LDL Cholesterol') && isHigh) {
        services.push({
          name: 'Cardiology Consultation',
          description: 'Specialized evaluation for cardiovascular risk factors',
          priority: 'medium',
          estimatedCost: 400,
          timeframe: 'Within 1-2 months',
          keywords: ['cardiology', 'heart', 'cholesterol', 'specialist']
        });
        services.push({
          name: 'Comprehensive Lipid Panel',
          description: 'Detailed analysis of cholesterol and triglyceride levels',
          priority: 'medium',
          estimatedCost: 150,
          timeframe: 'Within 2-4 weeks',
          keywords: ['lipid', 'cholesterol', 'blood test', 'lab']
        });
        services.push({
          name: 'Nutritional Counseling',
          description: 'Dietary guidance for managing cholesterol levels',
          priority: 'medium',
          estimatedCost: 120,
          timeframe: 'Within 1-2 months',
          keywords: ['nutrition', 'diet', 'counseling', 'cholesterol']
        });
      } else if (biomarker.name === 'HDL Cholesterol' && isLow) {
        services.push({
          name: 'Cardiology Consultation',
          description: 'Specialized evaluation for cardiovascular risk factors',
          priority: 'medium',
          estimatedCost: 400,
          timeframe: 'Within 1-2 months',
          keywords: ['cardiology', 'heart', 'cholesterol', 'specialist']
        });
        services.push({
          name: 'Nutritional Counseling',
          description: 'Dietary guidance for improving HDL cholesterol levels',
          priority: 'medium',
          estimatedCost: 120,
          timeframe: 'Within 1-2 months',
          keywords: ['nutrition', 'diet', 'counseling', 'cholesterol']
        });
      }
      break;
      
    case 'Hormones':
      if (biomarker.name.includes('Testosterone') && isHigh) {
        services.push({
          name: 'Endocrinology Consultation',
          description: 'Specialized evaluation for hormone imbalances',
          priority: 'medium',
          estimatedCost: 350,
          timeframe: 'Within 2-4 weeks',
          keywords: ['endocrinology', 'hormone', 'testosterone', 'specialist']
        });
        services.push({
          name: 'Comprehensive Hormone Panel',
          description: 'Detailed analysis of reproductive and metabolic hormones',
          priority: 'medium',
          estimatedCost: 250,
          timeframe: 'Within 1-2 weeks',
          keywords: ['hormone', 'testosterone', 'blood test', 'lab']
        });
        if (biomarker.value > biomarker.normalRange.max * 1.5) {
          services.push({
            name: 'Pelvic Ultrasound',
            description: 'Imaging to assess ovarian morphology (for females)',
            priority: 'medium',
            estimatedCost: 300,
            timeframe: 'Within 1-2 months',
            keywords: ['ultrasound', 'imaging', 'pelvic', 'ovarian']
          });
        }
      } else if (biomarker.name === 'TSH') {
        const priority = Math.abs(biomarker.value - (biomarker.normalRange.min + biomarker.normalRange.max) / 2) > 
                        (biomarker.normalRange.max - biomarker.normalRange.min) ? 'high' : 'medium';
        services.push({
          name: 'Endocrinology Consultation',
          description: 'Specialized evaluation for thyroid function',
          priority,
          estimatedCost: 350,
          timeframe: priority === 'high' ? 'Within 1-2 weeks' : 'Within 1-2 months',
          keywords: ['endocrinology', 'thyroid', 'hormone', 'specialist']
        });
        services.push({
          name: 'Complete Thyroid Panel',
          description: 'Comprehensive testing of thyroid hormones and antibodies',
          priority,
          estimatedCost: 200,
          timeframe: 'Within 1-2 weeks',
          keywords: ['thyroid', 'tsh', 't4', 't3', 'blood test', 'lab']
        });
      }
      break;
      
    case 'Vitamins':
      if (biomarker.name === 'Vitamin D' && isLow) {
        services.push({
          name: 'Primary Care Follow-up',
          description: 'Evaluation and management of vitamin D deficiency',
          priority: 'low',
          estimatedCost: 150,
          timeframe: 'Within 1-2 months',
          keywords: ['primary care', 'vitamin d', 'deficiency', 'general']
        });
        if (biomarker.value < biomarker.normalRange.min * 0.7) {
          services.push({
            name: 'Bone Density Scan (DEXA)',
            description: 'Imaging to assess bone mineral density',
            priority: 'medium',
            estimatedCost: 250,
            timeframe: 'Within 2-3 months',
            keywords: ['dexa', 'bone density', 'osteoporosis', 'imaging']
          });
        }
      }
      break;
      
    case 'Vital Signs':
      if (biomarker.name === 'Blood Pressure (Systolic)' && isHigh) {
        const priority = biomarker.value > 160 ? 'high' : 'medium';
        services.push({
          name: 'Cardiology Consultation',
          description: 'Specialized evaluation for high blood pressure',
          priority,
          estimatedCost: 400,
          timeframe: priority === 'high' ? 'Within 1-2 weeks' : 'Within 1-2 months',
          keywords: ['cardiology', 'hypertension', 'blood pressure', 'specialist']
        });
        services.push({
          name: 'Ambulatory Blood Pressure Monitoring',
          description: '24-hour blood pressure monitoring for accurate assessment',
          priority: 'medium',
          estimatedCost: 150,
          timeframe: 'Within 2-4 weeks',
          keywords: ['blood pressure', 'monitoring', 'ambulatory', 'diagnostic']
        });
        if (biomarker.value > 180) {
          services.push({
            name: 'Echocardiogram',
            description: 'Ultrasound of the heart to assess for damage from high blood pressure',
            priority: 'high',
            estimatedCost: 500,
            timeframe: 'Within 1-2 weeks',
            keywords: ['echocardiogram', 'heart', 'ultrasound', 'imaging']
          });
        }
      }
      break;
      
    case 'Inflammation Markers':
      if (biomarker.name === 'CRP' && isHigh) {
        const priority = biomarker.value > biomarker.normalRange.max * 3 ? 'high' : 'medium';
        services.push({
          name: 'Rheumatology Consultation',
          description: 'Specialized evaluation for inflammatory conditions',
          priority,
          estimatedCost: 350,
          timeframe: priority === 'high' ? 'Within 1-2 weeks' : 'Within 1-2 months',
          keywords: ['rheumatology', 'inflammation', 'autoimmune', 'specialist']
        });
        services.push({
          name: 'Comprehensive Inflammatory Panel',
          description: 'Detailed testing for inflammatory and autoimmune markers',
          priority,
          estimatedCost: 300,
          timeframe: 'Within 1-2 weeks',
          keywords: ['inflammation', 'crp', 'esr', 'blood test', 'lab']
        });
      }
      break;
      
    default:
      // Generic recommendations for other categories
      if (isOutOfRange) {
        services.push({
          name: 'Primary Care Follow-up',
          description: `Evaluation of abnormal ${biomarker.name} level`,
          priority: 'medium',
          estimatedCost: 150,
          timeframe: 'Within 1-2 months',
          keywords: ['primary care', 'general', 'follow-up', 'evaluation']
        });
        services.push({
          name: `${biomarker.category} Panel`,
          description: `Comprehensive testing of ${biomarker.category.toLowerCase()} markers`,
          priority: 'medium',
          estimatedCost: 200,
          timeframe: 'Within 2-4 weeks',
          keywords: [biomarker.category.toLowerCase(), 'panel', 'blood test', 'lab']
        });
      }
  }
  
  return services;
}

// Helper function to find matching insurance benefits
function findMatchingBenefits(services: RecommendedServiceInfo[], insurancePlans: InsurancePlan[]) {
  const matches = [];
  
  for (const service of services) {
    let bestMatch = null;
    let bestMatchScore = 0;
    
    for (const plan of insurancePlans) {
      for (const benefit of plan.benefits) {
        let matchScore = 0;
        
        // Check service name against benefit name
        if (benefit.serviceName.toLowerCase().includes(service.name.toLowerCase()) ||
            service.name.toLowerCase().includes(benefit.serviceName.toLowerCase())) {
          matchScore += 3;
        }
        
        // Check keywords against benefit name and description
        for (const keyword of service.keywords) {
          if (benefit.serviceName.toLowerCase().includes(keyword.toLowerCase())) {
            matchScore += 2;
          }
          if (benefit.description && benefit.description.toLowerCase().includes(keyword.toLowerCase())) {
            matchScore += 1;
          }
        }
        
        // Check category match
        if (benefit.category.toLowerCase().includes(service.keywords[0].toLowerCase())) {
          matchScore += 1;
        }
        
        if (matchScore > bestMatchScore) {
          bestMatchScore = matchScore;
          bestMatch = {
            service: service.name,
            planName: plan.planName,
            benefit
          };
        }
      }
    }
    
    if (bestMatch && bestMatchScore >= 3) {
      matches.push(bestMatch);
    }
  }
  
  return matches;
}

// Helper function to format coverage details
function formatCoverageDetails(coverage: CoverageDetails) {
  if (!coverage.covered) return 'Not covered';
  
  const parts = [];
  
  if (coverage.copay !== undefined) {
    parts.push(`$${coverage.copay} copay`);
  }
  
  if (coverage.coinsurance !== undefined) {
    parts.push(`${coverage.coinsurance}% coinsurance`);
  }
  
  if (coverage.deductible !== undefined) {
    parts.push('Subject to deductible');
  }
  
  if (coverage.coveragePercentage !== undefined) {
    parts.push(`${coverage.coveragePercentage}% covered`);
  }
  
  return parts.length > 0 ? parts.join(', ') : 'Covered';
}