/**
 * InsuranceUtilizationTracker Component
 *
 * Tracks and displays the value derived from insurance coverage based on biomarker tests
 * and related medical services. Calculates and visualizes cost savings from insurance.
 *
 * Features:
 * - Summary stats grid showing total savings, tests covered, visits covered, procedures covered
 * - Timeframe filtering (30 days, 90 days, year, all time)
 * - Detailed services table with original cost, insurance cost, and savings per service
 * - Value summary showing total savings amount and percentage extracted from insurance
 *
 * Service generation logic:
 * - Analyzes out-of-range biomarkers to generate likely utilized services
 * - Maps biomarker categories to insurance benefit categories (e.g., Blood → Lab Tests)
 * - Adds specialist visits for significantly out-of-range values
 * - Adds follow-up procedures (echocardiograms, stress tests, etc.) when appropriate
 * - Calculates estimated costs based on service type and coverage details
 *
 * @module components/insurance/InsuranceUtilizationTracker
 */

import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  Shield,
  Calendar,
  FileText,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Tag
} from 'lucide-react';
import type { Biomarker, InsurancePlan, InsuranceBenefit } from '../../types';

// Type for benefit with plan name
interface BenefitWithPlan {
  planName: string;
  benefit: InsuranceBenefit;
}

interface InsuranceUtilizationTrackerProps {
  biomarkers: Biomarker[];
  insurancePlans: InsurancePlan[];
}

interface UtilizedService {
  id: string;
  name: string;
  date: string;
  originalCost: number;
  insuranceCost: number;
  savings: number;
  category: 'test' | 'visit' | 'procedure' | 'other';
  biomarker?: string;
  planName: string;
}

export default function InsuranceUtilizationTracker({ biomarkers, insurancePlans }: InsuranceUtilizationTrackerProps) {
  const [utilizedServices, setUtilizedServices] = useState<UtilizedService[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'all' | '30days' | '90days' | 'year'>('year');
  
  useEffect(() => {
    // Calculate utilized services based on biomarkers and insurance plans
    if (biomarkers.length > 0 && insurancePlans.length > 0) {
      const services = calculateUtilizedServices(biomarkers, insurancePlans);
      setUtilizedServices(services);
    }
  }, [biomarkers, insurancePlans]);

  // Filter services based on selected timeframe
  const filteredServices = utilizedServices.filter(service => {
    if (selectedTimeframe === 'all') return true;
    
    const serviceDate = new Date(service.date);
    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - serviceDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (selectedTimeframe === '30days') return daysDiff <= 30;
    if (selectedTimeframe === '90days') return daysDiff <= 90;
    if (selectedTimeframe === 'year') return daysDiff <= 365;
    
    return true;
  });

  // Calculate total savings
  const totalSavings = filteredServices.reduce((sum, service) => sum + service.savings, 0);
  const totalOriginalCost = filteredServices.reduce((sum, service) => sum + service.originalCost, 0);
  const savingsPercentage = totalOriginalCost > 0 
    ? Math.round((totalSavings / totalOriginalCost) * 100) 
    : 0;
  
  // Calculate category totals
  const testCount = filteredServices.filter(s => s.category === 'test').length;
  const visitCount = filteredServices.filter(s => s.category === 'visit').length;
  const procedureCount = filteredServices.filter(s => s.category === 'procedure').length;
  
  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <Shield className="w-6 h-6 text-blue-600 mr-3" />
          <h2 className="text-xl font-semibold text-gray-900">Insurance Value Tracker</h2>
        </div>
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-gray-500 hover:text-gray-700"
        >
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>
      
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <div className="flex items-center">
            <DollarSign className="w-8 h-8 text-blue-600 mr-3" />
            <div>
              <p className="text-sm text-blue-600">Total Savings</p>
              <p className="text-2xl font-bold text-blue-700">${totalSavings.toLocaleString()}</p>
              <p className="text-xs text-blue-500">{savingsPercentage}% of original costs</p>
            </div>
          </div>
        </div>
        
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <div className="flex items-center">
            <FileText className="w-8 h-8 text-green-600 mr-3" />
            <div>
              <p className="text-sm text-green-600">Tests Covered</p>
              <p className="text-2xl font-bold text-green-700">{testCount}</p>
              <p className="text-xs text-green-500">Lab tests & diagnostics</p>
            </div>
          </div>
        </div>
        
        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
          <div className="flex items-center">
            <Calendar className="w-8 h-8 text-purple-600 mr-3" />
            <div>
              <p className="text-sm text-purple-600">Visits Covered</p>
              <p className="text-2xl font-bold text-purple-700">{visitCount}</p>
              <p className="text-xs text-purple-500">Doctor & specialist visits</p>
            </div>
          </div>
        </div>
        
        <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
          <div className="flex items-center">
            <BarChart3 className="w-8 h-8 text-orange-600 mr-3" />
            <div>
              <p className="text-sm text-orange-600">Procedures Covered</p>
              <p className="text-2xl font-bold text-orange-700">{procedureCount}</p>
              <p className="text-xs text-orange-500">Medical procedures</p>
            </div>
          </div>
        </div>
      </div>
      
      {isExpanded && (
        <>
          {/* Filters */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Covered Services</h3>
            <div className="flex space-x-2">
              <select
                value={selectedTimeframe}
                onChange={(e) => setSelectedTimeframe(e.target.value as typeof selectedTimeframe)}
                className="border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="30days">Last 30 Days</option>
                <option value="90days">Last 90 Days</option>
                <option value="year">Last Year</option>
                <option value="all">All Time</option>
              </select>
            </div>
          </div>
          
          {/* Services List */}
          {filteredServices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Service
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Original Cost
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Your Cost
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Savings
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Plan
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredServices.map((service) => (
                    <tr key={service.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className={`p-1.5 rounded-full ${
                            service.category === 'test' ? 'bg-green-100 text-green-600' :
                            service.category === 'visit' ? 'bg-purple-100 text-purple-600' :
                            service.category === 'procedure' ? 'bg-orange-100 text-orange-600' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {service.category === 'test' ? <FileText className="w-4 h-4" /> :
                             service.category === 'visit' ? <Calendar className="w-4 h-4" /> :
                             service.category === 'procedure' ? <BarChart3 className="w-4 h-4" /> :
                             <Tag className="w-4 h-4" />}
                          </div>
                          <div className="ml-3">
                            <div className="text-sm font-medium text-gray-900">{service.name}</div>
                            {service.biomarker && (
                              <div className="text-xs text-gray-500">Related to: {service.biomarker}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(service.date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${service.originalCost.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${service.insuranceCost.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-green-600">
                          ${service.savings.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {service.planName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <Shield className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-600">No insurance utilization data available for the selected timeframe.</p>
              <p className="text-sm text-gray-500 mt-2">Add biomarkers or select a different timeframe.</p>
            </div>
          )}
          
          {/* Value Summary */}
          {filteredServices.length > 0 && (
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <TrendingUp className="w-5 h-5 text-blue-600 mr-2" />
                <h3 className="text-lg font-medium text-blue-900">Insurance Value Summary</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-blue-700 mb-2">
                    Your insurance has saved you <span className="font-bold">${totalSavings.toLocaleString()}</span> on healthcare costs.
                  </p>
                  <p className="text-sm text-blue-700">
                    Without insurance, you would have paid <span className="font-bold">${totalOriginalCost.toLocaleString()}</span> for these services.
                  </p>
                </div>
                
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-blue-700">Insurance value extracted:</span>
                    <span className="font-medium text-blue-900">{savingsPercentage}%</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2.5">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full" 
                      style={{ width: `${savingsPercentage}%` }}
                    />
                  </div>
                  <p className="text-xs text-blue-600 mt-2">
                    Based on {filteredServices.length} covered services in the selected timeframe
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Helper function to calculate utilized services
function calculateUtilizedServices(biomarkers: Biomarker[], insurancePlans: InsurancePlan[]): UtilizedService[] {
  const services: UtilizedService[] = [];
  
  // Generate services based on out-of-range biomarkers
  biomarkers.forEach(biomarker => {
    const isOutOfRange = biomarker.value < biomarker.normalRange.min || biomarker.value > biomarker.normalRange.max;
    
    if (isOutOfRange) {
      // Find relevant insurance coverage
      const relevantBenefits = findRelevantBenefits(biomarker, insurancePlans);
      
      // Add utilized services based on biomarker type and coverage
      addBiomarkerServices(biomarker, relevantBenefits, services);
    }
  });
  
  // Sort by date (most recent first)
  return services.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// Find relevant insurance benefits for a biomarker
function findRelevantBenefits(biomarker: Biomarker, insurancePlans: InsurancePlan[]) {
  const relevantBenefits: BenefitWithPlan[] = [];
  
  // Map biomarker categories to likely insurance benefit categories
  const categoryMapping: Record<string, string[]> = {
    'Blood': ['Lab Tests', 'Diagnostic Tests'],
    'Lipids': ['Lab Tests', 'Diagnostic Tests', 'Preventive Care'],
    'Hormones': ['Lab Tests', 'Specialist Care', 'Diagnostic Tests'],
    'Vitamins': ['Lab Tests', 'Preventive Care'],
    'Vital Signs': ['Primary Care', 'Preventive Care'],
    'Inflammation Markers': ['Lab Tests', 'Diagnostic Tests'],
    'Kidney Function': ['Lab Tests', 'Diagnostic Tests', 'Specialist Care'],
    'Liver Function': ['Lab Tests', 'Diagnostic Tests', 'Specialist Care'],
    'Body Composition': ['Imaging', 'Diagnostic Tests'],
    'Calcium CT': ['Imaging', 'Diagnostic Tests'],
    'EKG': ['Diagnostic Tests', 'Imaging']
  };
  
  // Map specific biomarkers to likely services
  const biomarkerMapping: Record<string, string[]> = {
    'Glucose (Fasting)': ['diabetes', 'glucose', 'endocrinology'],
    'Total Cholesterol': ['lipid', 'cholesterol', 'cardiology'],
    'LDL Cholesterol': ['lipid', 'cholesterol', 'cardiology'],
    'HDL Cholesterol': ['lipid', 'cholesterol', 'cardiology'],
    'Triglycerides': ['lipid', 'triglycerides', 'cardiology'],
    'Vitamin D': ['vitamin', 'supplement', 'bone'],
    'TSH': ['thyroid', 'endocrinology', 'hormone'],
    'Testosterone (Total)': ['hormone', 'endocrinology'],
    'Blood Pressure (Systolic)': ['hypertension', 'cardiology', 'heart'],
    'CRP': ['inflammation', 'rheumatology'],
    'Hemoglobin A1C': ['diabetes', 'glucose', 'endocrinology']
  };
  
  const relevantCategories = categoryMapping[biomarker.category] || ['Lab Tests'];
  const relevantKeywords = biomarkerMapping[biomarker.name] || [biomarker.name.toLowerCase()];
  
  // Find matching benefits across all plans
  insurancePlans.forEach(plan => {
    plan.benefits.forEach(benefit => {
      // Check if benefit category matches
      const categoryMatch = relevantCategories.some(category => 
        benefit.category.toLowerCase().includes(category.toLowerCase())
      );
      
      // Check if benefit name or description contains relevant keywords
      const keywordMatch = relevantKeywords.some(keyword =>
        benefit.serviceName.toLowerCase().includes(keyword) ||
        (benefit.description && benefit.description.toLowerCase().includes(keyword))
      );
      
      if (categoryMatch || keywordMatch) {
        relevantBenefits.push({
          planName: plan.planName,
          benefit
        });
      }
    });
  });
  
  return relevantBenefits;
}

// Add services based on biomarker and available benefits
function addBiomarkerServices(
  biomarker: Biomarker, 
  relevantBenefits: BenefitWithPlan[],
  services: UtilizedService[]
) {
  // Skip if no relevant benefits found
  if (relevantBenefits.length === 0) return;
  
  // Get date for service (use biomarker date or generate a recent date)
  const serviceDate = biomarker.date;
  
  // Add lab test service
  const labBenefit = relevantBenefits.find(b => 
    b.benefit.category === 'Lab Tests' || 
    b.benefit.category === 'Diagnostic Tests'
  );
  
  if (labBenefit) {
    const originalCost = getEstimatedCost('test', biomarker.name);
    const copay = labBenefit.benefit.inNetworkCoverage.copay || 0;
    const coinsurance = labBenefit.benefit.inNetworkCoverage.coinsurance || 0;
    
    let insuranceCost = copay;
    if (coinsurance > 0) {
      insuranceCost = Math.round(originalCost * (coinsurance / 100));
    }
    
    services.push({
      id: crypto.randomUUID(),
      name: `${biomarker.name} Test`,
      date: serviceDate,
      originalCost,
      insuranceCost,
      savings: originalCost - insuranceCost,
      category: 'test',
      biomarker: biomarker.name,
      planName: labBenefit.planName
    });
  }
  
  // Add specialist visit for certain biomarkers
  if (shouldAddSpecialistVisit(biomarker)) {
    const specialistBenefit = relevantBenefits.find(b => 
      b.benefit.category === 'Specialist Care'
    );
    
    if (specialistBenefit) {
      const specialistType = getSpecialistType(biomarker);
      const originalCost = getEstimatedCost('visit', specialistType);
      const copay = specialistBenefit.benefit.inNetworkCoverage.copay || 0;
      const coinsurance = specialistBenefit.benefit.inNetworkCoverage.coinsurance || 0;
      
      let insuranceCost = copay;
      if (coinsurance > 0) {
        insuranceCost = Math.round(originalCost * (coinsurance / 100));
      }
      
      services.push({
        id: crypto.randomUUID(),
        name: `${specialistType} Consultation`,
        date: adjustDate(serviceDate, 7), // 7 days after lab test
        originalCost,
        insuranceCost,
        savings: originalCost - insuranceCost,
        category: 'visit',
        biomarker: biomarker.name,
        planName: specialistBenefit.planName
      });
    }
  }
  
  // Add follow-up procedure for certain biomarkers
  if (shouldAddProcedure(biomarker)) {
    const procedureBenefit = relevantBenefits.find(b => 
      b.benefit.category === 'Imaging' || 
      b.benefit.category === 'Diagnostic Tests'
    );
    
    if (procedureBenefit) {
      const procedureType = getProcedureType(biomarker);
      const originalCost = getEstimatedCost('procedure', procedureType);
      const copay = procedureBenefit.benefit.inNetworkCoverage.copay || 0;
      const coinsurance = procedureBenefit.benefit.inNetworkCoverage.coinsurance || 0;
      
      let insuranceCost = copay;
      if (coinsurance > 0) {
        insuranceCost = Math.round(originalCost * (coinsurance / 100));
      }
      
      services.push({
        id: crypto.randomUUID(),
        name: procedureType,
        date: adjustDate(serviceDate, 14), // 14 days after lab test
        originalCost,
        insuranceCost,
        savings: originalCost - insuranceCost,
        category: 'procedure',
        biomarker: biomarker.name,
        planName: procedureBenefit.planName
      });
    }
  }
}

// Helper function to determine if specialist visit should be added
function shouldAddSpecialistVisit(biomarker: Biomarker): boolean {
  const isOutOfRange = biomarker.value < biomarker.normalRange.min || biomarker.value > biomarker.normalRange.max;
  if (!isOutOfRange) return false;
  
  // Calculate how far out of range
  const percentDeviation = biomarker.value > biomarker.normalRange.max
    ? (biomarker.value - biomarker.normalRange.max) / biomarker.normalRange.max
    : (biomarker.normalRange.min - biomarker.value) / biomarker.normalRange.min;
  
  // Add specialist visit for significantly out of range values
  if (percentDeviation > 0.2) return true;
  
  // Add specialist for specific biomarkers regardless of deviation
  const alwaysSpecialist = [
    'Glucose (Fasting)',
    'Hemoglobin A1C',
    'Total Cholesterol',
    'LDL Cholesterol',
    'Blood Pressure (Systolic)',
    'Testosterone (Total)',
    'TSH',
    'CRP'
  ];
  
  return alwaysSpecialist.includes(biomarker.name);
}

// Helper function to determine if procedure should be added
function shouldAddProcedure(biomarker: Biomarker): boolean {
  const isOutOfRange = biomarker.value < biomarker.normalRange.min || biomarker.value > biomarker.normalRange.max;
  if (!isOutOfRange) return false;
  
  // Calculate how far out of range
  const percentDeviation = biomarker.value > biomarker.normalRange.max
    ? (biomarker.value - biomarker.normalRange.max) / biomarker.normalRange.max
    : (biomarker.normalRange.min - biomarker.value) / biomarker.normalRange.min;
  
  // Add procedure for severely out of range values
  if (percentDeviation > 0.3) return true;
  
  // Add procedure for specific biomarkers
  const procedureBiomarkers = [
    'Blood Pressure (Systolic)', // Echocardiogram
    'Total Cholesterol',         // Cardiac stress test
    'Glucose (Fasting)',         // Glucose tolerance test
    'Vitamin D',                 // DEXA scan
    'Testosterone (Total)'       // Pelvic ultrasound
  ];
  
  return procedureBiomarkers.includes(biomarker.name);
}

// Get specialist type based on biomarker
function getSpecialistType(biomarker: Biomarker): string {
  switch (biomarker.name) {
    case 'Glucose (Fasting)':
    case 'Hemoglobin A1C':
    case 'TSH':
    case 'Testosterone (Total)':
      return 'Endocrinology';
    case 'Total Cholesterol':
    case 'LDL Cholesterol':
    case 'HDL Cholesterol':
    case 'Blood Pressure (Systolic)':
      return 'Cardiology';
    case 'CRP':
      return 'Rheumatology';
    case 'Vitamin D':
      return 'Primary Care';
    default:
      return 'Specialist';
  }
}

// Get procedure type based on biomarker
function getProcedureType(biomarker: Biomarker): string {
  switch (biomarker.name) {
    case 'Blood Pressure (Systolic)':
      return 'Echocardiogram';
    case 'Total Cholesterol':
    case 'LDL Cholesterol':
      return 'Cardiac Stress Test';
    case 'Glucose (Fasting)':
      return 'Glucose Tolerance Test';
    case 'Vitamin D':
      return 'DEXA Bone Density Scan';
    case 'Testosterone (Total)':
      return 'Pelvic Ultrasound';
    default:
      return 'Advanced Diagnostic Test';
  }
}

// Get estimated cost based on service type
function getEstimatedCost(type: string, name: string): number {
  // Test costs
  if (type === 'test') {
    if (name.includes('Cholesterol') || name.includes('Lipid')) return 120;
    if (name.includes('Glucose')) return 80;
    if (name.includes('Vitamin')) return 100;
    if (name.includes('Hormone') || name.includes('Testosterone')) return 150;
    if (name.includes('CRP') || name.includes('Inflammation')) return 90;
    if (name.includes('Blood Pressure')) return 60;
    return 100; // Default test cost
  }
  
  // Visit costs
  if (type === 'visit') {
    if (name.includes('Cardiology')) return 400;
    if (name.includes('Endocrinology')) return 350;
    if (name.includes('Rheumatology')) return 380;
    if (name.includes('Primary Care')) return 150;
    return 300; // Default visit cost
  }
  
  // Procedure costs
  if (type === 'procedure') {
    if (name.includes('Echocardiogram')) return 500;
    if (name.includes('Stress Test')) return 600;
    if (name.includes('Glucose Tolerance')) return 200;
    if (name.includes('DEXA')) return 250;
    if (name.includes('Ultrasound')) return 300;
    return 400; // Default procedure cost
  }
  
  return 100; // Default cost
}

// Adjust date by adding days
function adjustDate(dateString: string, daysToAdd: number): string {
  const date = new Date(dateString);
  date.setDate(date.getDate() + daysToAdd);
  return date.toISOString().split('T')[0];
}