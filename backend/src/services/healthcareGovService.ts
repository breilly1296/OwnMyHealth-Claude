/**
 * Healthcare.gov Marketplace API Service
 *
 * Integrates with the CMS Marketplace API to search and retrieve
 * ACA health insurance plans from Healthcare.gov.
 *
 * API Documentation: https://developer.cms.gov/marketplace-api/
 *
 * Features:
 * - County/FIPS code lookup by zipcode
 * - Plan search by location, household, and criteria
 * - Plan details retrieval
 * - Rate limiting handling
 *
 * @module services/healthcareGovService
 */

import { logger } from '../utils/logger.js';

// API Configuration
const MARKETPLACE_API_BASE = 'https://marketplace.api.healthcare.gov/api/v1';
const API_KEY = process.env.HEALTHCARE_GOV_API_KEY || '';

// Types for API responses
export interface County {
  fips: string;
  name: string;
  state: string;
  zipcode?: string;
}

export interface HouseholdMember {
  age: number;
  has_mec?: boolean;  // Minimum Essential Coverage
  is_parent?: boolean;
  is_pregnant?: boolean;
  uses_tobacco?: boolean;
}

export interface Household {
  income: number;
  people: HouseholdMember[];
  has_married_couple?: boolean;
  effective_date?: string;  // YYYY-MM-DD
}

export interface PlanSearchParams {
  zipcode: string;
  fips?: string;
  household: Household;
  market?: 'Individual' | 'SmallGroup';
  year?: number;
  aptc_eligible?: boolean;
  csr_eligible?: boolean;
  catastrophic_eligible?: boolean;
  filter?: PlanFilter;
}

export interface PlanFilter {
  plan_types?: ('HMO' | 'PPO' | 'EPO' | 'POS')[];
  metal_levels?: ('Catastrophic' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum')[];
  issuers?: string[];
  premium_range?: {
    min?: number;
    max?: number;
  };
  deductible_range?: {
    min?: number;
    max?: number;
  };
}

export interface MarketplacePlan {
  id: string;
  name: string;
  issuer: {
    id: string;
    name: string;
  };
  metal_level: string;
  plan_type: string;
  premium: number;
  premium_w_credit?: number;
  ehb_premium?: number;
  pediatric_ehb_premium?: number;
  aptc_eligible?: boolean;
  csr?: number;
  deductibles: {
    individual: number;
    family: number;
  };
  moops: {  // Maximum Out of Pocket
    individual: number;
    family: number;
  };
  benefits_url?: string;
  brochure_url?: string;
  formulary_url?: string;
  network_url?: string;
  hsa_eligible?: boolean;
  has_national_network?: boolean;
  quality_rating?: {
    global_rating?: number;
    clinical_quality_management?: number;
    enrollee_experience?: number;
    plan_efficiency?: number;
  };
}

export interface PlanSearchResult {
  plans: MarketplacePlan[];
  total: number;
  facet_groups?: FacetGroup[];
  ranges?: {
    premiums?: { min: number; max: number };
    deductibles?: { min: number; max: number };
  };
}

interface FacetGroup {
  name: string;
  facets: { value: string; count: number }[];
}

interface ApiError {
  error?: string;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
}

/**
 * Make a request to the Healthcare.gov API
 */
async function apiRequest<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    params?: Record<string, string>;
  } = {}
): Promise<T> {
  const { method = 'GET', body, params = {} } = options;

  if (!API_KEY) {
    throw new Error('Healthcare.gov API key not configured. Set HEALTHCARE_GOV_API_KEY environment variable.');
  }

  // Build URL with query params
  const url = new URL(`${MARKETPLACE_API_BASE}${endpoint}`);
  url.searchParams.set('apikey', API_KEY);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // Check rate limiting
    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    if (rateLimitRemaining && parseInt(rateLimitRemaining) < 10) {
      logger.warn('Healthcare.gov API rate limit approaching', { remaining: rateLimitRemaining });
    }

    if (!response.ok) {
      const errorData = await response.json() as ApiError;
      logger.error('Healthcare.gov API error', {
        status: response.status,
        endpoint,
        error: errorData,
      });
      throw new Error(errorData.message || errorData.error || `API error: ${response.status}`);
    }

    return await response.json() as T;
  } catch (error) {
    logger.error('Healthcare.gov API request failed', { endpoint, error });
    throw error;
  }
}

/**
 * Get counties by zipcode
 * Used to get FIPS codes needed for plan search
 */
export async function getCountiesByZipcode(zipcode: string): Promise<County[]> {
  interface CountiesResponse {
    counties: Array<{
      fips: string;
      name: string;
      state: string;
    }>;
  }

  const data = await apiRequest<CountiesResponse>(`/counties/by/zip/${zipcode}`);

  return data.counties.map(c => ({
    fips: c.fips,
    name: c.name,
    state: c.state,
    zipcode,
  }));
}

/**
 * Search for marketplace plans
 */
export async function searchPlans(params: PlanSearchParams): Promise<PlanSearchResult> {
  // Get FIPS code if not provided
  let fips = params.fips;
  if (!fips) {
    const counties = await getCountiesByZipcode(params.zipcode);
    if (counties.length === 0) {
      throw new Error(`No counties found for zipcode ${params.zipcode}`);
    }
    fips = counties[0].fips;
  }

  // Build request body
  const requestBody = {
    place: {
      countyfips: fips,
      state: fips.substring(0, 2),
      zipcode: params.zipcode,
    },
    market: params.market || 'Individual',
    year: params.year || new Date().getFullYear(),
    household: {
      income: params.household.income,
      has_married_couple: params.household.has_married_couple || false,
      people: params.household.people.map(p => ({
        age: p.age,
        has_mec: p.has_mec ?? false,
        is_parent: p.is_parent ?? false,
        is_pregnant: p.is_pregnant ?? false,
        uses_tobacco: p.uses_tobacco ?? false,
      })),
    },
    aptc_override: params.aptc_eligible,
    csr_override: params.csr_eligible ? 'CSR87' : undefined,
    catastrophic_override: params.catastrophic_eligible,
    filter: params.filter ? {
      plan_types: params.filter.plan_types,
      metal_levels: params.filter.metal_levels,
      issuers: params.filter.issuers,
      premium_range: params.filter.premium_range,
      deductible_range: params.filter.deductible_range,
    } : undefined,
  };

  interface PlanSearchResponse {
    plans: Array<{
      id: string;
      name: string;
      issuer: { id: string; name: string };
      metal_level: string;
      type: string;
      premium: number;
      premium_w_credit?: number;
      ehb_premium?: number;
      pediatric_ehb_premium?: number;
      aptc_eligible?: boolean;
      csr?: number;
      deductibles: Array<{ type: string; amount: number; family_cost: string }>;
      moops: Array<{ type: string; amount: number; family_cost: string }>;
      benefits_url?: string;
      brochure_url?: string;
      formulary_url?: string;
      network_url?: string;
      hsa_eligible?: boolean;
      has_national_network?: boolean;
      quality_rating?: {
        global_rating?: number;
        clinical_quality_management?: number;
        enrollee_experience?: number;
        plan_efficiency?: number;
      };
    }>;
    total: number;
    facet_groups?: FacetGroup[];
    ranges?: {
      premiums?: { min: number; max: number };
      deductibles?: { min: number; max: number };
    };
  }

  const data = await apiRequest<PlanSearchResponse>('/plans/search', {
    method: 'POST',
    body: requestBody,
  });

  // Transform response
  return {
    plans: data.plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      issuer: plan.issuer,
      metal_level: plan.metal_level,
      plan_type: plan.type,
      premium: plan.premium,
      premium_w_credit: plan.premium_w_credit,
      ehb_premium: plan.ehb_premium,
      pediatric_ehb_premium: plan.pediatric_ehb_premium,
      aptc_eligible: plan.aptc_eligible,
      csr: plan.csr,
      deductibles: {
        individual: plan.deductibles.find(d => d.family_cost === 'Individual')?.amount ?? 0,
        family: plan.deductibles.find(d => d.family_cost === 'Family')?.amount ?? 0,
      },
      moops: {
        individual: plan.moops.find(m => m.family_cost === 'Individual')?.amount ?? 0,
        family: plan.moops.find(m => m.family_cost === 'Family')?.amount ?? 0,
      },
      benefits_url: plan.benefits_url,
      brochure_url: plan.brochure_url,
      formulary_url: plan.formulary_url,
      network_url: plan.network_url,
      hsa_eligible: plan.hsa_eligible,
      has_national_network: plan.has_national_network,
      quality_rating: plan.quality_rating,
    })),
    total: data.total,
    facet_groups: data.facet_groups,
    ranges: data.ranges,
  };
}

/**
 * Get detailed plan information
 */
export async function getPlanDetails(planId: string, year?: number): Promise<MarketplacePlan | null> {
  interface PlanDetailsResponse {
    plan: {
      id: string;
      name: string;
      issuer: { id: string; name: string };
      metal_level: string;
      type: string;
      premium: number;
      deductibles: Array<{ type: string; amount: number; family_cost: string }>;
      moops: Array<{ type: string; amount: number; family_cost: string }>;
      benefits_url?: string;
      brochure_url?: string;
      formulary_url?: string;
      network_url?: string;
      hsa_eligible?: boolean;
      has_national_network?: boolean;
      quality_rating?: {
        global_rating?: number;
        clinical_quality_management?: number;
        enrollee_experience?: number;
        plan_efficiency?: number;
      };
    };
  }

  try {
    const planYear = year || new Date().getFullYear();
    const data = await apiRequest<PlanDetailsResponse>(`/plans/${planId}`, {
      params: { year: planYear.toString() },
    });

    const plan = data.plan;
    return {
      id: plan.id,
      name: plan.name,
      issuer: plan.issuer,
      metal_level: plan.metal_level,
      plan_type: plan.type,
      premium: plan.premium,
      deductibles: {
        individual: plan.deductibles.find(d => d.family_cost === 'Individual')?.amount ?? 0,
        family: plan.deductibles.find(d => d.family_cost === 'Family')?.amount ?? 0,
      },
      moops: {
        individual: plan.moops.find(m => m.family_cost === 'Individual')?.amount ?? 0,
        family: plan.moops.find(m => m.family_cost === 'Family')?.amount ?? 0,
      },
      benefits_url: plan.benefits_url,
      brochure_url: plan.brochure_url,
      formulary_url: plan.formulary_url,
      network_url: plan.network_url,
      hsa_eligible: plan.hsa_eligible,
      has_national_network: plan.has_national_network,
      quality_rating: plan.quality_rating,
    };
  } catch (error) {
    logger.error('Failed to get plan details', { planId, error });
    return null;
  }
}

/**
 * Check if Healthcare.gov API is configured
 */
export function isHealthcareGovConfigured(): boolean {
  return !!API_KEY;
}

/**
 * Get available enrollment years
 */
export async function getEnrollmentYears(): Promise<number[]> {
  // The API typically has current year and next year during open enrollment
  const currentYear = new Date().getFullYear();
  return [currentYear, currentYear + 1];
}

export default {
  getCountiesByZipcode,
  searchPlans,
  getPlanDetails,
  isHealthcareGovConfigured,
  getEnrollmentYears,
};
