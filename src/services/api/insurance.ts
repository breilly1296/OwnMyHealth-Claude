/**
 * Insurance API
 */

import { apiFetch } from './client';

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
  // Copay amounts
  copayPrimaryCare?: number;
  copaySpecialist?: number;
  copayUrgentCare?: number;
  copayEmergency?: number;
  coinsuranceRate?: number;
  // Source tracking
  extractedFromSbc?: boolean;
  sbcExtractionConfidence?: number;
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
  deductibleIndividual: number;
  deductibleFamily?: number;
  oopMaxIndividual: number;
  oopMaxFamily?: number;
  premiumMonthly?: number;
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

  async uploadSBC(file: File): Promise<InsurancePlanData> {
    const { uploadFile } = await import('../uploadUtils');
    return uploadFile<InsurancePlanData>('/insurance/upload-sbc', file, {
      timeoutMs: 60000,
      timeoutMessage: 'SBC file upload timed out. Please try again with a smaller file.',
    });
  },
};
