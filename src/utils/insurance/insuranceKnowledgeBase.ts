import type { InsurancePlan, InsuranceBenefit, InsuranceCost, CoverageDetails, NetworkInfo, InsuranceLimitation } from '../../types';
import type { ExtractedInsuranceData, ExtractedBenefit, ExtractedCost, ExtractedCoverage, NetworkInformation, LimitationInformation } from '../documents/documentParser';

// Normalized insurance data structures
export interface NormalizedInsurancePlan {
  id: string;
  planName: string;
  insurerName: string;
  planType: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP' | 'Other';
  effectiveDate: string;
  sourceDocument: string;
  extractionConfidence: number;
  normalizedBenefits: NormalizedBenefit[];
  normalizedCosts: NormalizedCost[];
  networkInfo: NormalizedNetwork;
  limitations: NormalizedLimitation[];
  keyMetrics: PlanMetrics;
  tags: string[];
  lastUpdated: string;
}

export interface NormalizedBenefit {
  id: string;
  serviceCode: string; // Standardized service identifier
  serviceName: string;
  category: BenefitCategory;
  subcategory?: string;
  inNetworkCoverage: NormalizedCoverage;
  outOfNetworkCoverage?: NormalizedCoverage;
  requirements: ServiceRequirement[];
  limitations: ServiceLimitation[];
  relatedServices: string[]; // Related service codes
  cptCodes?: string[]; // Medical procedure codes
  confidence: number;
  rawData: InsuranceBenefit | ExtractedBenefit; // Original extracted data
}

export interface NormalizedCoverage {
  covered: boolean;
  costStructure: CostStructure;
  deductibleApplies: boolean;
  coveragePercentage: number;
  annualLimit?: number;
  visitLimit?: number;
  notes?: string;
}

export interface CostStructure {
  type: 'copay' | 'coinsurance' | 'deductible' | 'flat_rate' | 'not_covered';
  amount?: number; // For copays and flat rates
  percentage?: number; // For coinsurance
  tier?: number; // For tiered structures (e.g., prescription drugs)
}

export interface NormalizedCost {
  id: string;
  costType: 'premium' | 'deductible' | 'out_of_pocket_max' | 'copay' | 'coinsurance';
  category: 'individual' | 'family' | 'in_network' | 'out_of_network';
  amount: number;
  frequency: 'monthly' | 'annual' | 'per_visit' | 'per_service';
  appliesTo: string[];
  tier?: number;
  confidence: number;
}

export interface NormalizedNetwork {
  networkName?: string;
  networkType: 'narrow' | 'standard' | 'broad' | 'national';
  providerCount?: number;
  geographicCoverage: string[];
  specialtyAccess: SpecialtyAccess[];
  pharmacyNetwork?: string;
}

export interface SpecialtyAccess {
  specialty: string;
  availability: 'excellent' | 'good' | 'limited' | 'poor';
  averageWaitTime?: number; // in days
  requiresReferral: boolean;
}

export interface ServiceRequirement {
  type: 'prior_authorization' | 'referral' | 'step_therapy' | 'quantity_limit';
  description: string;
  exceptions?: string[];
}

export interface ServiceLimitation {
  type: 'annual' | 'lifetime' | 'per_visit' | 'per_service' | 'age_based';
  value?: number;
  description: string;
  exceptions?: string[];
}

export interface NormalizedLimitation {
  id: string;
  serviceCode: string;
  limitationType: 'annual' | 'lifetime' | 'per_visit' | 'per_service';
  limitValue?: number;
  description: string;
  exceptions: string[];
}

export interface PlanMetrics {
  overallCostRating: number; // 1-10 scale
  coverageComprehensiveness: number; // 1-10 scale
  networkQuality: number; // 1-10 scale
  userFriendliness: number; // 1-10 scale
  estimatedAnnualCost: {
    lowUsage: number;
    mediumUsage: number;
    highUsage: number;
  };
  topBenefits: string[];
  potentialGaps: string[];
}

// Standardized benefit categories
export type BenefitCategory = 
  | 'primary_care'
  | 'specialist_care'
  | 'emergency_care'
  | 'urgent_care'
  | 'preventive_care'
  | 'diagnostic_imaging'
  | 'laboratory_tests'
  | 'prescription_drugs'
  | 'mental_health'
  | 'maternity'
  | 'surgery'
  | 'hospital_stay'
  | 'rehabilitation'
  | 'durable_medical_equipment'
  | 'home_health'
  | 'skilled_nursing'
  | 'vision'
  | 'dental'
  | 'alternative_medicine';

// Service code mappings for standardization
const SERVICE_CODE_MAPPINGS: Record<string, { code: string; category: BenefitCategory; subcategory?: string }> = {
  // Primary Care
  'primary care visit': { code: 'PC001', category: 'primary_care', subcategory: 'office_visit' },
  'family doctor': { code: 'PC001', category: 'primary_care', subcategory: 'office_visit' },
  'pcp visit': { code: 'PC001', category: 'primary_care', subcategory: 'office_visit' },
  'annual physical': { code: 'PC002', category: 'primary_care', subcategory: 'wellness_exam' },
  'wellness visit': { code: 'PC002', category: 'primary_care', subcategory: 'wellness_exam' },
  
  // Specialist Care
  'specialist visit': { code: 'SP001', category: 'specialist_care', subcategory: 'consultation' },
  'specialist consultation': { code: 'SP001', category: 'specialist_care', subcategory: 'consultation' },
  'cardiology': { code: 'SP002', category: 'specialist_care', subcategory: 'cardiology' },
  'endocrinology': { code: 'SP003', category: 'specialist_care', subcategory: 'endocrinology' },
  'dermatology': { code: 'SP004', category: 'specialist_care', subcategory: 'dermatology' },
  'orthopedics': { code: 'SP005', category: 'specialist_care', subcategory: 'orthopedics' },
  
  // Emergency Care
  'emergency room': { code: 'EM001', category: 'emergency_care', subcategory: 'er_visit' },
  'er visit': { code: 'EM001', category: 'emergency_care', subcategory: 'er_visit' },
  'emergency care': { code: 'EM001', category: 'emergency_care', subcategory: 'er_visit' },
  'ambulance': { code: 'EM002', category: 'emergency_care', subcategory: 'transport' },
  
  // Urgent Care
  'urgent care': { code: 'UC001', category: 'urgent_care', subcategory: 'clinic_visit' },
  'walk-in clinic': { code: 'UC001', category: 'urgent_care', subcategory: 'clinic_visit' },
  
  // Preventive Care
  'preventive care': { code: 'PR001', category: 'preventive_care', subcategory: 'general' },
  'mammogram': { code: 'PR002', category: 'preventive_care', subcategory: 'cancer_screening' },
  'colonoscopy': { code: 'PR003', category: 'preventive_care', subcategory: 'cancer_screening' },
  'pap smear': { code: 'PR004', category: 'preventive_care', subcategory: 'cancer_screening' },
  'immunizations': { code: 'PR005', category: 'preventive_care', subcategory: 'vaccinations' },
  
  // Diagnostic Imaging
  'x-ray': { code: 'DI001', category: 'diagnostic_imaging', subcategory: 'basic_imaging' },
  'mri': { code: 'DI002', category: 'diagnostic_imaging', subcategory: 'advanced_imaging' },
  'ct scan': { code: 'DI003', category: 'diagnostic_imaging', subcategory: 'advanced_imaging' },
  'ultrasound': { code: 'DI004', category: 'diagnostic_imaging', subcategory: 'basic_imaging' },
  'pet scan': { code: 'DI005', category: 'diagnostic_imaging', subcategory: 'advanced_imaging' },
  
  // Laboratory Tests
  'lab tests': { code: 'LB001', category: 'laboratory_tests', subcategory: 'routine' },
  'blood work': { code: 'LB001', category: 'laboratory_tests', subcategory: 'routine' },
  'blood tests': { code: 'LB001', category: 'laboratory_tests', subcategory: 'routine' },
  'diagnostic tests': { code: 'LB002', category: 'laboratory_tests', subcategory: 'specialized' },
  
  // Prescription Drugs
  'generic drugs': { code: 'RX001', category: 'prescription_drugs', subcategory: 'tier_1' },
  'brand name drugs': { code: 'RX002', category: 'prescription_drugs', subcategory: 'tier_2' },
  'specialty drugs': { code: 'RX003', category: 'prescription_drugs', subcategory: 'tier_3' },
  'prescription drugs': { code: 'RX000', category: 'prescription_drugs', subcategory: 'general' },
  
  // Mental Health
  'mental health': { code: 'MH001', category: 'mental_health', subcategory: 'therapy' },
  'behavioral health': { code: 'MH001', category: 'mental_health', subcategory: 'therapy' },
  'therapy': { code: 'MH001', category: 'mental_health', subcategory: 'therapy' },
  'psychiatry': { code: 'MH002', category: 'mental_health', subcategory: 'psychiatric_care' },
  
  // Surgery
  'surgery': { code: 'SG001', category: 'surgery', subcategory: 'general' },
  'outpatient surgery': { code: 'SG002', category: 'surgery', subcategory: 'outpatient' },
  'inpatient surgery': { code: 'SG003', category: 'surgery', subcategory: 'inpatient' },
  
  // Hospital Stay
  'hospital stay': { code: 'HS001', category: 'hospital_stay', subcategory: 'inpatient' },
  'inpatient care': { code: 'HS001', category: 'hospital_stay', subcategory: 'inpatient' },
  'hospitalization': { code: 'HS001', category: 'hospital_stay', subcategory: 'inpatient' },
  
  // Maternity
  'maternity': { code: 'MT001', category: 'maternity', subcategory: 'general' },
  'pregnancy': { code: 'MT001', category: 'maternity', subcategory: 'general' },
  'prenatal care': { code: 'MT002', category: 'maternity', subcategory: 'prenatal' },
  'delivery': { code: 'MT003', category: 'maternity', subcategory: 'delivery' }
};

// Insurance Knowledge Base Class
export class InsuranceKnowledgeBase {
  private plans: Map<string, NormalizedInsurancePlan> = new Map();
  private serviceIndex: Map<string, string[]> = new Map(); // service code -> plan IDs
  private costIndex: Map<string, string[]> = new Map(); // cost type -> plan IDs
  private networkIndex: Map<string, string[]> = new Map(); // network name -> plan IDs

  // Add a plan to the knowledge base
  addPlan(plan: InsurancePlan): NormalizedInsurancePlan {
    const normalizedPlan = this.normalizePlan(plan);
    this.plans.set(normalizedPlan.id, normalizedPlan);
    this.updateIndexes(normalizedPlan);
    return normalizedPlan;
  }

  // Add plan from extracted data
  addPlanFromExtractedData(extractedData: ExtractedInsuranceData, sourceFile: string): NormalizedInsurancePlan {
    const normalizedPlan = this.normalizeExtractedData(extractedData, sourceFile);
    this.plans.set(normalizedPlan.id, normalizedPlan);
    this.updateIndexes(normalizedPlan);
    return normalizedPlan;
  }

  // Get plan by ID
  getPlan(planId: string): NormalizedInsurancePlan | undefined {
    return this.plans.get(planId);
  }

  // Get all plans
  getAllPlans(): NormalizedInsurancePlan[] {
    return Array.from(this.plans.values());
  }

  // Search plans by criteria
  searchPlans(criteria: PlanSearchCriteria): PlanSearchResult[] {
    const results: PlanSearchResult[] = [];
    
    for (const plan of this.plans.values()) {
      const score = this.calculatePlanScore(plan, criteria);
      if (score > 0) {
        results.push({
          plan,
          score,
          matchedCriteria: this.getMatchedCriteria(plan, criteria),
          estimatedCosts: this.calculateEstimatedCosts(plan, criteria.expectedUsage)
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // Compare plans
  comparePlans(planIds: string[]): PlanComparison {
    const plans = planIds.map(id => this.plans.get(id)).filter(Boolean) as NormalizedInsurancePlan[];
    
    return {
      plans,
      comparisonMatrix: this.generateComparisonMatrix(plans),
      recommendations: this.generateRecommendations(plans),
      costAnalysis: this.generateCostAnalysis(plans)
    };
  }

  // Get coverage for specific service
  getServiceCoverage(serviceCode: string): ServiceCoverageComparison[] {
    const planIds = this.serviceIndex.get(serviceCode) || [];
    const coverageData: ServiceCoverageComparison[] = [];

    for (const planId of planIds) {
      const plan = this.plans.get(planId);
      if (plan) {
        const benefit = plan.normalizedBenefits.find(b => b.serviceCode === serviceCode);
        if (benefit) {
          coverageData.push({
            planId: plan.id,
            planName: plan.planName,
            coverage: benefit.inNetworkCoverage,
            requirements: benefit.requirements,
            limitations: benefit.limitations
          });
        }
      }
    }

    return coverageData.sort((a, b) => b.coverage.coveragePercentage - a.coverage.coveragePercentage);
  }

  // Normalize a standard InsurancePlan
  private normalizePlan(plan: InsurancePlan): NormalizedInsurancePlan {
    return {
      id: plan.id,
      planName: plan.planName,
      insurerName: plan.insurerName,
      planType: plan.planType,
      effectiveDate: plan.effectiveDate,
      sourceDocument: plan.sourceFile,
      extractionConfidence: plan.extractionConfidence,
      normalizedBenefits: this.normalizeBenefits(plan.benefits),
      normalizedCosts: this.normalizeCosts(plan.costs),
      networkInfo: this.normalizeNetwork(plan.network),
      limitations: this.normalizeLimitations(plan.limitations),
      keyMetrics: this.calculatePlanMetrics(plan),
      tags: this.generateTags(plan),
      lastUpdated: new Date().toISOString()
    };
  }

  // Normalize extracted data
  private normalizeExtractedData(data: ExtractedInsuranceData, sourceFile: string): NormalizedInsurancePlan {
    const planId = crypto.randomUUID();
    
    return {
      id: planId,
      planName: data.planInformation?.planName || 'Extracted Plan',
      insurerName: data.planInformation?.insurerName || 'Unknown Insurer',
      planType: this.mapPlanType(data.planInformation?.planType),
      effectiveDate: data.planInformation?.effectiveDate || new Date().toISOString().split('T')[0],
      sourceDocument: sourceFile,
      extractionConfidence: 0.8,
      normalizedBenefits: this.normalizeExtractedBenefits(data.benefits || []),
      normalizedCosts: this.normalizeExtractedCosts(data.costs || []),
      networkInfo: this.normalizeExtractedNetwork(data.network),
      limitations: this.normalizeExtractedLimitations(data.limitations || []),
      keyMetrics: this.calculateExtractedPlanMetrics(data),
      tags: this.generateExtractedTags(data),
      lastUpdated: new Date().toISOString()
    };
  }

  // Normalize benefits from standard format
  private normalizeBenefits(benefits: InsuranceBenefit[]): NormalizedBenefit[] {
    return benefits.map(benefit => {
      const serviceMapping = this.findServiceMapping(benefit.serviceName);
      
      return {
        id: benefit.id,
        serviceCode: serviceMapping?.code || `CUSTOM_${crypto.randomUUID().substring(0, 8)}`,
        serviceName: benefit.serviceName,
        category: serviceMapping?.category || 'primary_care',
        subcategory: serviceMapping?.subcategory,
        inNetworkCoverage: this.normalizeCoverageDetails(benefit.inNetworkCoverage),
        outOfNetworkCoverage: benefit.outOfNetworkCoverage ? 
          this.normalizeCoverageDetails(benefit.outOfNetworkCoverage) : undefined,
        requirements: this.extractRequirements(benefit),
        limitations: [],
        relatedServices: [],
        confidence: 0.9,
        rawData: benefit
      };
    });
  }

  // Normalize benefits from extracted format
  private normalizeExtractedBenefits(benefits: ExtractedBenefit[]): NormalizedBenefit[] {
    return benefits.map(benefit => {
      const serviceMapping = this.findServiceMapping(benefit.serviceName);
      
      return {
        id: crypto.randomUUID(),
        serviceCode: serviceMapping?.code || `CUSTOM_${crypto.randomUUID().substring(0, 8)}`,
        serviceName: benefit.serviceName,
        category: serviceMapping?.category || this.categorizeBenefit(benefit.category),
        subcategory: serviceMapping?.subcategory,
        inNetworkCoverage: this.normalizeExtractedCoverage(benefit.inNetworkCoverage),
        outOfNetworkCoverage: benefit.outOfNetworkCoverage ? 
          this.normalizeExtractedCoverage(benefit.outOfNetworkCoverage) : undefined,
        requirements: this.extractExtractedRequirements(benefit),
        limitations: [],
        relatedServices: [],
        confidence: benefit.confidence,
        rawData: benefit
      };
    });
  }

  // Find service mapping
  private findServiceMapping(serviceName: string): { code: string; category: BenefitCategory; subcategory?: string } | undefined {
    const lowerName = serviceName.toLowerCase();
    
    // Direct match
    if (SERVICE_CODE_MAPPINGS[lowerName]) {
      return SERVICE_CODE_MAPPINGS[lowerName];
    }

    // Partial match
    for (const [key, mapping] of Object.entries(SERVICE_CODE_MAPPINGS)) {
      if (lowerName.includes(key) || key.includes(lowerName)) {
        return mapping;
      }
    }

    return undefined;
  }

  // Normalize coverage details
  private normalizeCoverageDetails(coverage: CoverageDetails): NormalizedCoverage {
    let costStructure: CostStructure;

    if (!coverage.covered) {
      costStructure = { type: 'not_covered' };
    } else if (coverage.copay !== undefined) {
      costStructure = { type: 'copay', amount: coverage.copay };
    } else if (coverage.coinsurance !== undefined) {
      costStructure = { type: 'coinsurance', percentage: coverage.coinsurance };
    } else if (coverage.deductible !== undefined) {
      costStructure = { type: 'deductible', amount: coverage.deductible };
    } else {
      costStructure = { type: 'flat_rate', amount: 0 };
    }

    return {
      covered: coverage.covered,
      costStructure,
      deductibleApplies: coverage.deductible !== undefined,
      coveragePercentage: coverage.coveragePercentage || (coverage.covered ? 100 : 0),
      notes: coverage.limitations?.join('; ')
    };
  }

  // Normalize extracted coverage
  private normalizeExtractedCoverage(coverage: ExtractedCoverage): NormalizedCoverage {
    let costStructure: CostStructure;

    if (!coverage.covered) {
      costStructure = { type: 'not_covered' };
    } else if (coverage.copay !== undefined) {
      costStructure = { type: 'copay', amount: coverage.copay };
    } else if (coverage.coinsurance !== undefined) {
      costStructure = { type: 'coinsurance', percentage: coverage.coinsurance };
    } else {
      costStructure = { type: 'flat_rate', amount: 0 };
    }

    return {
      covered: coverage.covered,
      costStructure,
      deductibleApplies: coverage.deductibleApplies || false,
      coveragePercentage: coverage.coveragePercentage || (coverage.covered ? 100 : 0),
      notes: coverage.notes
    };
  }

  // Normalize costs
  private normalizeCosts(costs: InsuranceCost[]): NormalizedCost[] {
    return costs.map(cost => ({
      id: cost.id,
      costType: this.mapCostType(cost.type),
      category: this.mapCostCategory(cost.appliesTo),
      amount: cost.amount,
      frequency: this.mapFrequency(cost.frequency),
      appliesTo: [cost.appliesTo],
      confidence: 0.9
    }));
  }

  // Normalize extracted costs
  private normalizeExtractedCosts(costs: ExtractedCost[]): NormalizedCost[] {
    return costs.map(cost => ({
      id: crypto.randomUUID(),
      costType: cost.type,
      category: cost.category,
      amount: cost.amount || 0,
      frequency: this.mapFrequency(cost.frequency),
      appliesTo: [cost.category],
      confidence: cost.confidence
    }));
  }

  // Helper methods for mapping and categorization
  private mapCostType(type: string): 'premium' | 'deductible' | 'out_of_pocket_max' | 'copay' | 'coinsurance' {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('premium')) return 'premium';
    if (lowerType.includes('deductible')) return 'deductible';
    if (lowerType.includes('out-of-pocket') || lowerType.includes('maximum')) return 'out_of_pocket_max';
    if (lowerType.includes('copay')) return 'copay';
    if (lowerType.includes('coinsurance')) return 'coinsurance';
    return 'premium';
  }

  private mapCostCategory(appliesTo: string): 'individual' | 'family' | 'in_network' | 'out_of_network' {
    const lower = appliesTo.toLowerCase();
    if (lower.includes('family')) return 'family';
    if (lower.includes('out-of-network') || lower.includes('out of network')) return 'out_of_network';
    if (lower.includes('in-network') || lower.includes('in network')) return 'in_network';
    return 'individual';
  }

  private mapFrequency(frequency?: string): 'monthly' | 'annual' | 'per_visit' | 'per_service' {
    if (!frequency) return 'annual';
    const lower = frequency.toLowerCase();
    if (lower.includes('monthly')) return 'monthly';
    if (lower.includes('visit')) return 'per_visit';
    if (lower.includes('service')) return 'per_service';
    return 'annual';
  }

  private mapPlanType(planType?: string): 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP' | 'Other' {
    if (!planType) return 'Other';
    const upper = planType.toUpperCase();
    if (upper.includes('HMO')) return 'HMO';
    if (upper.includes('PPO')) return 'PPO';
    if (upper.includes('EPO')) return 'EPO';
    if (upper.includes('POS')) return 'POS';
    if (upper.includes('HDHP') || upper.includes('HIGH DEDUCTIBLE')) return 'HDHP';
    return 'Other';
  }

  private categorizeBenefit(category: string): BenefitCategory {
    const lower = category.toLowerCase();
    if (lower.includes('primary')) return 'primary_care';
    if (lower.includes('specialist')) return 'specialist_care';
    if (lower.includes('emergency')) return 'emergency_care';
    if (lower.includes('urgent')) return 'urgent_care';
    if (lower.includes('preventive')) return 'preventive_care';
    if (lower.includes('imaging')) return 'diagnostic_imaging';
    if (lower.includes('lab')) return 'laboratory_tests';
    if (lower.includes('prescription') || lower.includes('drug')) return 'prescription_drugs';
    if (lower.includes('mental')) return 'mental_health';
    if (lower.includes('maternity')) return 'maternity';
    if (lower.includes('surgery')) return 'surgery';
    if (lower.includes('hospital')) return 'hospital_stay';
    return 'primary_care';
  }

  // Extract requirements from benefit
  private extractRequirements(benefit: InsuranceBenefit): ServiceRequirement[] {
    const requirements: ServiceRequirement[] = [];
    
    if (benefit.priorAuthRequired) {
      requirements.push({
        type: 'prior_authorization',
        description: 'Prior authorization required before service'
      });
    }
    
    if (benefit.referralRequired) {
      requirements.push({
        type: 'referral',
        description: 'Referral from primary care provider required'
      });
    }
    
    return requirements;
  }

  // Extract requirements from extracted benefit
  private extractExtractedRequirements(benefit: ExtractedBenefit): ServiceRequirement[] {
    const requirements: ServiceRequirement[] = [];
    
    if (benefit.priorAuthRequired) {
      requirements.push({
        type: 'prior_authorization',
        description: 'Prior authorization required before service'
      });
    }
    
    if (benefit.referralRequired) {
      requirements.push({
        type: 'referral',
        description: 'Referral from primary care provider required'
      });
    }
    
    return requirements;
  }

  // Placeholder methods for other normalization functions
  private normalizeNetwork(network: NetworkInfo): NormalizedNetwork {
    return {
      networkType: 'standard',
      geographicCoverage: network?.geographicCoverage || ['Unknown'],
      specialtyAccess: []
    };
  }

  private normalizeExtractedNetwork(network: NetworkInformation): NormalizedNetwork {
    return {
      networkName: network?.providerNetworkName,
      networkType: 'standard',
      geographicCoverage: network?.geographicCoverage || ['Unknown'],
      specialtyAccess: []
    };
  }

  private normalizeLimitations(limitations: InsuranceLimitation[]): NormalizedLimitation[] {
    return limitations?.map(limitation => ({
      id: limitation.id,
      serviceCode: 'GENERAL',
      limitationType: this.mapLimitationType(limitation.limitType),
      limitValue: limitation.limitValue,
      description: limitation.description,
      exceptions: limitation.exceptions || []
    })) || [];
  }

  private normalizeExtractedLimitations(limitations: LimitationInformation[]): NormalizedLimitation[] {
    return limitations?.map(limitation => ({
      id: crypto.randomUUID(),
      serviceCode: 'GENERAL',
      limitationType: limitation.type,
      limitValue: limitation.value,
      description: limitation.description,
      exceptions: []
    })) || [];
  }

  private mapLimitationType(limitType: string): 'annual' | 'lifetime' | 'per_visit' | 'per_service' {
    const lower = limitType.toLowerCase().replace(' ', '_');
    if (lower.includes('lifetime')) return 'lifetime';
    if (lower.includes('per_visit') || lower.includes('per visit')) return 'per_visit';
    if (lower.includes('per_service') || lower.includes('per service')) return 'per_service';
    return 'annual';
  }

  private calculatePlanMetrics(_plan: InsurancePlan): PlanMetrics {
    return {
      overallCostRating: 7,
      coverageComprehensiveness: 8,
      networkQuality: 7,
      userFriendliness: 6,
      estimatedAnnualCost: {
        lowUsage: 2000,
        mediumUsage: 4000,
        highUsage: 8000
      },
      topBenefits: ['Primary Care', 'Preventive Care'],
      potentialGaps: ['Dental', 'Vision']
    };
  }

  private calculateExtractedPlanMetrics(data: ExtractedInsuranceData): PlanMetrics {
    return {
      overallCostRating: 7,
      coverageComprehensiveness: 8,
      networkQuality: 7,
      userFriendliness: 6,
      estimatedAnnualCost: {
        lowUsage: 2000,
        mediumUsage: 4000,
        highUsage: 8000
      },
      topBenefits: data.benefits?.slice(0, 3).map(b => b.serviceName) || [],
      potentialGaps: []
    };
  }

  private generateTags(plan: InsurancePlan): string[] {
    const tags = [plan.planType.toLowerCase()];
    if (plan.planName.toLowerCase().includes('high deductible')) tags.push('hdhp');
    if (plan.planName.toLowerCase().includes('bronze')) tags.push('bronze');
    if (plan.planName.toLowerCase().includes('silver')) tags.push('silver');
    if (plan.planName.toLowerCase().includes('gold')) tags.push('gold');
    if (plan.planName.toLowerCase().includes('platinum')) tags.push('platinum');
    return tags;
  }

  private generateExtractedTags(data: ExtractedInsuranceData): string[] {
    const tags: string[] = [];
    if (data.planInformation?.planType) {
      tags.push(data.planInformation.planType.toLowerCase());
    }
    return tags;
  }

  // Update search indexes
  private updateIndexes(plan: NormalizedInsurancePlan): void {
    // Update service index
    plan.normalizedBenefits.forEach(benefit => {
      if (!this.serviceIndex.has(benefit.serviceCode)) {
        this.serviceIndex.set(benefit.serviceCode, []);
      }
      this.serviceIndex.get(benefit.serviceCode)!.push(plan.id);
    });

    // Update cost index
    plan.normalizedCosts.forEach(cost => {
      if (!this.costIndex.has(cost.costType)) {
        this.costIndex.set(cost.costType, []);
      }
      this.costIndex.get(cost.costType)!.push(plan.id);
    });

    // Update network index
    if (plan.networkInfo.networkName) {
      if (!this.networkIndex.has(plan.networkInfo.networkName)) {
        this.networkIndex.set(plan.networkInfo.networkName, []);
      }
      this.networkIndex.get(plan.networkInfo.networkName)!.push(plan.id);
    }
  }

  // Calculate plan score based on criteria
  private calculatePlanScore(plan: NormalizedInsurancePlan, criteria: PlanSearchCriteria): number {
    let score = 0;

    // Plan type preference
    if (criteria.preferredPlanTypes?.includes(plan.planType)) {
      score += 20;
    }

    // Cost preferences
    if (criteria.maxPremium && plan.normalizedCosts.some(c => 
      c.costType === 'premium' && c.amount <= criteria.maxPremium!
    )) {
      score += 15;
    }

    // Service requirements
    if (criteria.requiredServices) {
      const coveredServices = criteria.requiredServices.filter(serviceCode =>
        plan.normalizedBenefits.some(b => b.serviceCode === serviceCode && b.inNetworkCoverage.covered)
      );
      score += (coveredServices.length / criteria.requiredServices.length) * 30;
    }

    // Network preferences
    if (criteria.preferredNetworks?.some(network => 
      plan.networkInfo.networkName?.includes(network)
    )) {
      score += 10;
    }

    return score;
  }

  // Get matched criteria
  private getMatchedCriteria(plan: NormalizedInsurancePlan, criteria: PlanSearchCriteria): string[] {
    const matched: string[] = [];

    if (criteria.preferredPlanTypes?.includes(plan.planType)) {
      matched.push(`Plan Type: ${plan.planType}`);
    }

    if (criteria.requiredServices) {
      criteria.requiredServices.forEach(serviceCode => {
        const benefit = plan.normalizedBenefits.find(b => b.serviceCode === serviceCode);
        if (benefit?.inNetworkCoverage.covered) {
          matched.push(`Service: ${benefit.serviceName}`);
        }
      });
    }

    return matched;
  }

  // Calculate estimated costs
  private calculateEstimatedCosts(plan: NormalizedInsurancePlan, usage?: 'low' | 'medium' | 'high'): EstimatedCosts {
    const usageLevel = usage || 'medium';
    return {
      annual: plan.keyMetrics.estimatedAnnualCost[usageLevel],
      monthly: plan.keyMetrics.estimatedAnnualCost[usageLevel] / 12,
      breakdown: {
        premium: plan.normalizedCosts.find(c => c.costType === 'premium')?.amount || 0,
        deductible: plan.normalizedCosts.find(c => c.costType === 'deductible')?.amount || 0,
        estimatedOutOfPocket: plan.keyMetrics.estimatedAnnualCost[usageLevel] * 0.3
      }
    };
  }

  // Generate comparison matrix
  private generateComparisonMatrix(plans: NormalizedInsurancePlan[]): ComparisonMatrix {
    const categories = ['Cost', 'Coverage', 'Network', 'User Experience'];
    const matrix: ComparisonMatrix = {
      categories,
      planScores: plans.map(plan => ({
        planId: plan.id,
        planName: plan.planName,
        scores: {
          'Cost': plan.keyMetrics.overallCostRating,
          'Coverage': plan.keyMetrics.coverageComprehensiveness,
          'Network': plan.keyMetrics.networkQuality,
          'User Experience': plan.keyMetrics.userFriendliness
        }
      }))
    };

    return matrix;
  }

  // Generate recommendations
  private generateRecommendations(plans: NormalizedInsurancePlan[]): PlanRecommendation[] {
    return plans.map(plan => ({
      planId: plan.id,
      recommendation: 'good_fit',
      reasons: plan.keyMetrics.topBenefits,
      concerns: plan.keyMetrics.potentialGaps,
      bestFor: ['General healthcare needs']
    }));
  }

  // Generate cost analysis
  private generateCostAnalysis(plans: NormalizedInsurancePlan[]): CostAnalysis {
    return {
      lowestPremium: plans.reduce((min, plan) => {
        const premium = plan.normalizedCosts.find(c => c.costType === 'premium')?.amount || Infinity;
        return premium < min.amount ? { planId: plan.id, amount: premium } : min;
      }, { planId: '', amount: Infinity }),
      lowestDeductible: plans.reduce((min, plan) => {
        const deductible = plan.normalizedCosts.find(c => c.costType === 'deductible')?.amount || Infinity;
        return deductible < min.amount ? { planId: plan.id, amount: deductible } : min;
      }, { planId: '', amount: Infinity }),
      bestValue: plans[0] ? { planId: plans[0].id, score: plans[0].keyMetrics.overallCostRating } : { planId: '', score: 0 }
    };
  }
}

// Search and comparison interfaces
export interface PlanSearchCriteria {
  preferredPlanTypes?: ('HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP')[];
  maxPremium?: number;
  maxDeductible?: number;
  requiredServices?: string[]; // Service codes
  preferredNetworks?: string[];
  geographicArea?: string;
  expectedUsage?: 'low' | 'medium' | 'high';
  specialNeeds?: string[];
}

export interface PlanSearchResult {
  plan: NormalizedInsurancePlan;
  score: number;
  matchedCriteria: string[];
  estimatedCosts: EstimatedCosts;
}

export interface EstimatedCosts {
  annual: number;
  monthly: number;
  breakdown: {
    premium: number;
    deductible: number;
    estimatedOutOfPocket: number;
  };
}

export interface ServiceCoverageComparison {
  planId: string;
  planName: string;
  coverage: NormalizedCoverage;
  requirements: ServiceRequirement[];
  limitations: ServiceLimitation[];
}

export interface PlanComparison {
  plans: NormalizedInsurancePlan[];
  comparisonMatrix: ComparisonMatrix;
  recommendations: PlanRecommendation[];
  costAnalysis: CostAnalysis;
}

export interface ComparisonMatrix {
  categories: string[];
  planScores: {
    planId: string;
    planName: string;
    scores: Record<string, number>;
  }[];
}

export interface PlanRecommendation {
  planId: string;
  recommendation: 'excellent_fit' | 'good_fit' | 'fair_fit' | 'poor_fit';
  reasons: string[];
  concerns: string[];
  bestFor: string[];
}

export interface CostAnalysis {
  lowestPremium: { planId: string; amount: number };
  lowestDeductible: { planId: string; amount: number };
  bestValue: { planId: string; score: number };
}

// Create singleton instance
export const insuranceKB = new InsuranceKnowledgeBase();