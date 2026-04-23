/**
 * Plan API
 *
 * Subscription tier introspection. No billing here — plan changes happen
 * server-side (admin or, later, Stripe webhook) and this client just reads.
 */

import { apiFetch } from './client';

export type PlanTier = 'FREE' | 'PRO' | 'TEAM';

export interface PlanLimits {
  aiChatsPerDay: number;
  pdfUploadsPerMonth: number;
  maxBiomarkers: number;
  insurancePlans: number;
  aiGuidancePerDay: number;
  costAnalysisPerMonth: number;
  healthProfile: boolean;
  providerSharing: boolean;
  dataExport: boolean;
  questFhirIntegration: boolean;
}

export interface PlanConfig {
  tier: PlanTier;
  name: string;
  description: string;
  price: number;        // cents/month
  annualPrice: number;  // cents/year
  limits: PlanLimits;
}

export interface PlanUsage {
  aiChatsToday: number;
  pdfUploadsThisMonth: number;
  totalBiomarkers: number;
  activeInsurancePlans: number;
  aiGuidanceToday: number;
  costAnalysesThisMonth: number;
}

export interface CurrentPlanData {
  currentPlan: PlanTier;
  planName: string;
  expiresAt: string | null;
  updatedAt: string | null;
  usage: PlanUsage;
  limits: PlanLimits;
  upgradeAvailable: boolean;
}

/** -1 indicates unlimited for numeric limits. */
export function isUnlimited(value: number): boolean {
  return value === -1;
}

export const planApi = {
  async getCurrentPlan(): Promise<CurrentPlanData> {
    const response = await apiFetch<CurrentPlanData>('/plan');
    return response.data;
  },

  async getAvailablePlans(): Promise<PlanConfig[]> {
    const response = await apiFetch<{ plans: PlanConfig[] }>('/plan/available');
    return response.data.plans;
  },
};
