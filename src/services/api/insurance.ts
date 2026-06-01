/**
 * Insurance API
 */

import { apiFetch } from './client';

export interface ServiceLimitData {
  service: string;
  limit: number;
  limitType: 'visits' | 'days' | 'dollars' | 'lifetime';
  period: 'per year' | 'per admission' | 'lifetime' | 'per occurrence';
}

export interface InsurancePlanData {
  id: string;
  planName: string;
  insurerName: string;
  planType: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP' | 'Other';
  planIdNumber?: string;
  effectiveDate: string;
  terminationDate?: string;
  isActive: boolean;
  isPrimary: boolean;
  deductibleIndividual: number;
  deductibleFamily: number;
  oopMaxIndividual: number;
  oopMaxFamily: number;
  premiumMonthly?: number;

  // Tracking fields
  deductibleMetIndividual?: number;
  deductibleMetFamily?: number;
  oopMetIndividual?: number;
  oopMetFamily?: number;

  // Core copays
  copayPrimaryCare?: number;
  copaySpecialist?: number;
  copayUrgentCare?: number;
  copayEmergency?: number;
  copayTelehealth?: number;
  copayLabWork?: number;
  copayXray?: number;
  copayAdvancedImaging?: number;
  coinsuranceRate?: number;

  // Inpatient coverage
  inpatientHospitalCopay?: number;
  inpatientHospitalCoinsurance?: number;
  inpatientMentalHealthCopay?: number;
  inpatientMentalCoinsurance?: number;
  maternityCopay?: number;
  maternityCoinsurance?: number;
  skilledNursingCopay?: number;
  skilledNursingCoinsurance?: number;
  skilledNursingDaysLimit?: number;

  // Outpatient coverage
  outpatientSurgeryCopay?: number;
  outpatientSurgeryCoinsurance?: number;
  outpatientMentalHealthCopay?: number;
  outpatientMentalCoinsurance?: number;

  // Therapy/Rehab coverage
  physicalTherapyCopay?: number;
  physicalTherapyVisitsLimit?: number;
  occupationalTherapyCopay?: number;
  occupationalTherapyVisitsLimit?: number;
  speechTherapyCopay?: number;
  speechTherapyVisitsLimit?: number;
  chiropracticCopay?: number;
  chiropracticVisitsLimit?: number;
  acupunctureCopay?: number;
  acupunctureVisitsLimit?: number;
  cardiacRehabCopay?: number;
  cardiacRehabVisitsLimit?: number;
  pulmonaryRehabCopay?: number;
  pulmonaryRehabVisitsLimit?: number;

  // Prescription (Rx) benefits
  rxTier1Copay?: number;
  rxTier2Copay?: number;
  rxTier3Copay?: number;
  rxTier4Copay?: number;
  rxRetailDaysSupply?: number;
  rxMailOrderDaysSupply?: number;
  rxDeductibleIndividual?: number;
  rxDeductibleFamily?: number;
  rxOopMaxIndividual?: number;
  rxOopMaxFamily?: number;

  // Emergency/Ambulance coverage
  ambulanceGroundCopay?: number;
  ambulanceGroundCoinsurance?: number;
  ambulanceAirCopay?: number;
  ambulanceAirCoinsurance?: number;

  // Vision coverage
  visionExamCopay?: number;
  visionExamFrequency?: string;
  visionLensesAllowance?: number;
  visionFramesAllowance?: number;
  visionContactsAllowance?: number;

  // Dental coverage
  dentalPreventiveCoinsurance?: number;
  dentalBasicCoinsurance?: number;
  dentalMajorCoinsurance?: number;
  dentalAnnualMax?: number;
  dentalDeductible?: number;
  dentalOrthodontiaCoinsurance?: number;
  dentalOrthodontiaLifetimeMax?: number;

  // DME coverage
  dmeCopay?: number;
  dmeCoinsurance?: number;

  // Home Health coverage
  homeHealthVisitCopay?: number;
  homeHealthVisitCoinsurance?: number;
  homeHealthVisitLimit?: number;

  // Hospice coverage
  hospiceInpatientCopay?: number;
  hospiceInpatientCoinsurance?: number;
  hospiceRespiteCopay?: number;
  hospiceRespiteCoinsurance?: number;
  hospiceRespiteDayLimit?: number;

  // JSON lists (parsed from string by backend controller)
  preventiveServicesList?: string[];
  exclusionsList?: string[];
  priorAuthRequirements?: string[];
  servicesWithLimits?: ServiceLimitData[];

  // Source tracking
  extractedFromSbc?: boolean;
  sbcExtractionConfidence?: number;
  usedClaudeExtraction?: boolean;
}

export interface InsuranceBenefitData {
  id: string;
  planId: string;
  serviceName: string;
  serviceCategory: string;
  inNetworkCovered: boolean;
  inNetworkCopay?: number;
  inNetworkCoinsurance?: number;
  outNetworkCovered: boolean;
  outNetworkCopay?: number;
  outNetworkCoinsurance?: number;
  preAuthRequired: boolean;
  limitations?: string;
}

export interface CreateInsurancePlanData {
  planName: string;
  insurerName: string;
  planType: string;
  planIdNumber?: string;
  effectiveDate: string;
  terminationDate?: string;
  // Backend expects 'deductible' and 'outOfPocketMax' (not 'deductibleIndividual'/'oopMaxIndividual')
  deductible: number;
  deductibleFamily?: number;
  outOfPocketMax: number;
  outOfPocketMaxFamily?: number;
  premium?: number;
  // Tracking fields
  deductibleMetIndividual?: number;
  deductibleMetFamily?: number;
  oopMetIndividual?: number;
  oopMetFamily?: number;
  // Copay amounts
  copayPrimaryCare?: number;
  copaySpecialist?: number;
  copayUrgentCare?: number;
  copayEmergency?: number;
  coinsuranceRate?: number;
  isPrimary?: boolean;
}

/** Coverage detail for one network tier, as returned by the backend benefit responses. */
export interface BenefitCoverageDetail {
  covered: boolean;
  copay?: number;
  coinsurance?: number;
  deductibleApplies: boolean;
}

/** Per-service benefit row (nested coverage shape from the insurance controller). */
export interface BenefitResponseData {
  id: string;
  serviceName: string;
  serviceCategory: string;
  inNetworkCoverage: BenefitCoverageDetail;
  outNetworkCoverage: BenefitCoverageDetail;
  limitations?: string;
  preAuthRequired: boolean;
}

/** One hit from GET /insurance/benefits/search. */
export interface BenefitSearchResult {
  planId: string;
  planName: string;
  benefit: BenefitResponseData;
}

/** Response from POST /insurance/compare — real extracted-benefit coverage matrix. */
export interface PlanComparisonResult {
  plans: {
    id: string;
    name: string;
    type: string;
    premium?: number;
    deductibleIndividual: number;
    oopMaxIndividual: number;
  }[];
  benefitComparison: {
    serviceName: string;
    coverage: {
      planId: string;
      planName: string;
      covered: boolean;
      copay?: number;
      coinsurance?: number;
    }[];
  }[];
}

export const insuranceApi = {
  async getPlans(): Promise<InsurancePlanData[]> {
    const response = await apiFetch<InsurancePlanData[]>('/insurance/plans');
    return response.data;
  },

  async getPlanById(id: string): Promise<InsurancePlanData> {
    const response = await apiFetch<InsurancePlanData>(`/insurance/plans/${id}`);
    return response.data;
  },

  async createPlan(data: CreateInsurancePlanData): Promise<InsurancePlanData> {
    const response = await apiFetch<InsurancePlanData>('/insurance/plans', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async updatePlan(id: string, data: Partial<CreateInsurancePlanData>): Promise<InsurancePlanData> {
    const response = await apiFetch<InsurancePlanData>(`/insurance/plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async deletePlan(id: string): Promise<void> {
    await apiFetch(`/insurance/plans/${id}`, { method: 'DELETE' });
  },

  async getBenefits(planId: string): Promise<InsuranceBenefitData[]> {
    const response = await apiFetch<InsuranceBenefitData[]>(`/insurance/plans/${planId}/benefits`);
    return response.data;
  },

  /**
   * Compare 2–5 of the user's own plans by their extracted benefit rows.
   * Backed by POST /insurance/compare (RLS-scoped, audit-logged). Returns a
   * real covered-services matrix the client-side knowledge base can't build,
   * since the per-service InsuranceBenefit rows only live server-side.
   */
  async comparePlans(planIds: string[]): Promise<PlanComparisonResult> {
    const response = await apiFetch<PlanComparisonResult>('/insurance/compare', {
      method: 'POST',
      body: JSON.stringify({ planIds }),
    });
    return response.data;
  },

  /**
   * Free-text search across the user's extracted benefits (serviceName match).
   * Backed by GET /insurance/benefits/search.
   */
  async searchBenefits(query: string, planId?: string): Promise<BenefitSearchResult[]> {
    const params = new URLSearchParams({ query });
    if (planId) params.set('planId', planId);
    const response = await apiFetch<BenefitSearchResult[]>(
      `/insurance/benefits/search?${params.toString()}`
    );
    return response.data;
  },

  async uploadSBC(file: File): Promise<InsurancePlanData> {
    const { uploadFile } = await import('../uploadUtils');
    return uploadFile<InsurancePlanData>('/insurance/upload-sbc', file, {
      timeoutMs: 60000,
      timeoutMessage: 'SBC file upload timed out. Please try again with a smaller file.',
    });
  },

  /**
   * Re-analyze an existing insurance plan by re-processing an uploaded SBC PDF.
   * Uses the latest extraction prompt/logic to update the plan data.
   * Preserves user-entered data (memberId, groupId, tracking fields).
   */
  async reanalyzePlan(planId: string, file: File): Promise<InsurancePlanData> {
    const { uploadFile } = await import('../uploadUtils');
    return uploadFile<InsurancePlanData>(`/insurance/plans/${planId}/reanalyze`, file, {
      timeoutMs: 60000,
      timeoutMessage: 'Plan re-analysis timed out. Please try again with a smaller file.',
      method: 'PUT',
    });
  },
};
