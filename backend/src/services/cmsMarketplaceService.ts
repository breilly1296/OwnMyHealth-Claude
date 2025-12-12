/**
 * CMS Healthcare.gov Marketplace API Service
 *
 * Integrates with the CMS Marketplace API to search for health insurance plans,
 * retrieve county/FIPS information, and provide plan details.
 *
 * API Documentation: https://marketplace.api.healthcare.gov/api/v1/
 *
 * @module services/cmsMarketplaceService
 */

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// CMS API Types
export interface CMSCounty {
  fips: string;
  name: string;
  state: string;
  zipcode?: string;
}

export interface CMSHouseholdPerson {
  age: number;
  aptc_eligible?: boolean;
  gender?: 'Male' | 'Female';
  uses_tobacco?: boolean;
}

export interface CMSPlanSearchParams {
  zipcode: string;
  fips: string;
  state: string;
  market?: 'Individual' | 'SmallGroup';
  year?: number;
  aptc_eligible?: boolean;
  csr_eligible?: boolean;
  income?: number;
  household_size?: number;
  age?: number | number[];
  is_tobacco_user?: boolean | boolean[];
  gender?: 'Male' | 'Female';
  people?: CMSHouseholdPerson[];
  filter?: {
    metal_level?: ('Catastrophic' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum')[];
    type?: ('HMO' | 'PPO' | 'EPO' | 'POS')[];
    issuer?: string[];
  };
  offset?: number;
  limit?: number;
  order?: 'asc' | 'desc';
  order_by?: 'premium' | 'deductible' | 'quality_rating';
}

export interface CMSPlan {
  id: string;
  name: string;
  issuer: {
    id: string;
    name: string;
  };
  metal_level: string;
  type: string;
  premium: number;
  premium_w_credit?: number;
  ehb_premium?: number;
  pediatric_ehb_premium?: number;
  aptc_eligible?: boolean;
  hsa_eligible?: boolean;
  deductibles: CMSDeductible[];
  moops: CMSMoop[];
  benefits?: CMSBenefit[];
  quality_rating?: {
    global_rating?: number;
    clinical_quality_management?: number;
    enrollee_experience?: number;
    plan_efficiency?: number;
  };
  brochure_url?: string;
  formulary_url?: string;
  network_url?: string;
  benefits_url?: string;
}

export interface CMSDeductible {
  amount: number;
  type: string;
  family_cost?: string;
  network_tier?: string;
  csr?: string;
  display_string?: string;
}

export interface CMSMoop {
  amount: number;
  type: string;
  family_cost?: string;
  network_tier?: string;
  csr?: string;
  display_string?: string;
}

export interface CMSBenefit {
  name: string;
  covered: boolean;
  cost_sharings?: CMSCostSharing[];
  explanation?: string;
  has_limits?: boolean;
  limit_unit?: string;
  limit_quantity?: number;
}

export interface CMSCostSharing {
  coinsurance_rate?: number;
  coinsurance_options?: string;
  copay_amount?: number;
  copay_options?: string;
  network_tier: string;
  csr?: string;
  display_string?: string;
}

export interface CMSPlanSearchResponse {
  plans: CMSPlan[];
  total: number;
  facet_groups?: CMSFacetGroup[];
  ranges?: {
    premiums?: { min: number; max: number };
    deductibles?: { min: number; max: number };
  };
}

export interface CMSFacetGroup {
  name: string;
  facets: Array<{
    value: string;
    count: number;
  }>;
}

// Transformed types for frontend consumption
export interface TransformedPlan {
  id: string;
  name: string;
  issuer: string;
  issuerId: string;
  metalLevel: string;
  planType: string;
  premium: number;
  premiumWithCredit?: number;
  deductible: number;
  outOfPocketMax: number;
  hsaEligible: boolean;
  qualityRating?: number;
  benefits: TransformedBenefit[];
  urls: {
    brochure?: string;
    formulary?: string;
    network?: string;
    benefits?: string;
  };
}

export interface TransformedBenefit {
  name: string;
  covered: boolean;
  costSharing?: string;
  hasLimits: boolean;
  explanation?: string;
}

export interface MarketplacePlanSearchResult {
  plans: TransformedPlan[];
  total: number;
  page: number;
  limit: number;
  filters: {
    metalLevels: Array<{ value: string; count: number }>;
    planTypes: Array<{ value: string; count: number }>;
    issuers: Array<{ value: string; count: number }>;
  };
  priceRanges: {
    premium: { min: number; max: number };
    deductible: { min: number; max: number };
  };
}

class CMSMarketplaceService {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor() {
    this.baseUrl = config.cms?.baseUrl || 'https://marketplace.api.healthcare.gov/api/v1';
    this.apiKey = config.cms?.apiKey || '';
    this.timeout = config.cms?.timeout || 30000;

    if (!this.apiKey && config.isProduction) {
      logger.warn('CMS_API_KEY is not configured - Marketplace API calls will fail');
    }
  }

  /**
   * Get county and FIPS code information by ZIP code
   *
   * BUG FIX: The CMS API returns { counties: [...] }, not an array directly.
   * We must access data.counties[0] instead of data[0].
   */
  async getCountyByZipcode(zipcode: string): Promise<CMSCounty | null> {
    try {
      const response = await this.makeRequest<{ counties: CMSCounty[] }>(
        `/counties/by/zip/${zipcode}`
      );

      // BUG FIX: Access data.counties, not data directly
      if (response.counties && response.counties.length > 0) {
        return response.counties[0];
      }

      logger.warn(`No county found for ZIP code: ${zipcode}`);
      return null;
    } catch (error) {
      logger.error('Failed to get county by zipcode', { data: { zipcode, error } });
      throw error;
    }
  }

  /**
   * Get all counties for a ZIP code (some ZIPs span multiple counties)
   */
  async getCountiesByZipcode(zipcode: string): Promise<CMSCounty[]> {
    try {
      const response = await this.makeRequest<{ counties: CMSCounty[] }>(
        `/counties/by/zip/${zipcode}`
      );

      // BUG FIX: Access data.counties, not data directly
      return response.counties || [];
    } catch (error) {
      logger.error('Failed to get counties by zipcode', { data: { zipcode, error } });
      throw error;
    }
  }

  /**
   * Search for marketplace health insurance plans
   * Uses POST with request body as required by CMS API
   */
  async searchPlans(params: CMSPlanSearchParams): Promise<MarketplacePlanSearchResult> {
    try {
      const requestBody = this.buildPlanSearchBody(params);
      const response = await this.makePostRequest<CMSPlanSearchResponse>(
        '/plans/search',
        requestBody
      );

      return this.transformPlanSearchResponse(response, params.offset || 0, params.limit || 10);
    } catch (error) {
      logger.error('Failed to search plans', { data: { params, error } });
      throw error;
    }
  }

  /**
   * Get detailed information about a specific plan
   */
  async getPlanDetails(planId: string, year?: number): Promise<TransformedPlan | null> {
    try {
      const yearParam = year || new Date().getFullYear();
      const response = await this.makeRequest<CMSPlan>(
        `/plans/${planId}?year=${yearParam}`
      );

      if (!response) {
        return null;
      }

      return this.transformPlan(response);
    } catch (error) {
      logger.error('Failed to get plan details', { data: { planId, error } });
      throw error;
    }
  }

  /**
   * Get available metal levels for a location
   */
  async getMetalLevels(state: string, year?: number): Promise<string[]> {
    try {
      const yearParam = year || new Date().getFullYear();
      const response = await this.makeRequest<{ metal_levels: string[] }>(
        `/metal-levels?state=${state}&year=${yearParam}`
      );

      return response.metal_levels || [];
    } catch (error) {
      logger.error('Failed to get metal levels', { data: { state, error } });
      throw error;
    }
  }

  /**
   * Get available issuers for a location
   */
  async getIssuers(state: string, year?: number): Promise<Array<{ id: string; name: string }>> {
    try {
      const yearParam = year || new Date().getFullYear();
      const response = await this.makeRequest<{ issuers: Array<{ id: string; name: string }> }>(
        `/issuers?state=${state}&year=${yearParam}`
      );

      return response.issuers || [];
    } catch (error) {
      logger.error('Failed to get issuers', { data: { state, error } });
      throw error;
    }
  }

  /**
   * Estimate premium with APTC (Advanced Premium Tax Credit)
   */
  async estimatePremium(params: {
    planId: string;
    zipcode: string;
    fips: string;
    age: number | number[];
    income: number;
    household_size: number;
    is_tobacco_user?: boolean | boolean[];
  }): Promise<{ premium: number; aptc: number; premiumWithCredit: number } | null> {
    try {
      const queryParams = new URLSearchParams({
        zipcode: params.zipcode,
        fips: params.fips,
        income: params.income.toString(),
        household_size: params.household_size.toString(),
      });

      // Handle age array
      if (Array.isArray(params.age)) {
        params.age.forEach(a => queryParams.append('age', a.toString()));
      } else {
        queryParams.append('age', params.age.toString());
      }

      // Handle tobacco user array
      if (params.is_tobacco_user !== undefined) {
        if (Array.isArray(params.is_tobacco_user)) {
          params.is_tobacco_user.forEach(t => queryParams.append('is_tobacco_user', t.toString()));
        } else {
          queryParams.append('is_tobacco_user', params.is_tobacco_user.toString());
        }
      }

      const response = await this.makeRequest<{
        premium: number;
        aptc: number;
        premium_w_credit: number;
      }>(`/plans/${params.planId}/premium?${queryParams.toString()}`);

      return {
        premium: response.premium,
        aptc: response.aptc,
        premiumWithCredit: response.premium_w_credit,
      };
    } catch (error) {
      logger.error('Failed to estimate premium', { data: { planId: params.planId, error } });
      throw error;
    }
  }

  /**
   * Check if a provider is in a plan's network
   */
  async checkProviderNetwork(planId: string, providerId: string): Promise<boolean> {
    try {
      const response = await this.makeRequest<{ in_network: boolean }>(
        `/plans/${planId}/providers/${providerId}`
      );

      return response.in_network || false;
    } catch (error) {
      logger.error('Failed to check provider network', { data: { planId, providerId, error } });
      return false;
    }
  }

  /**
   * Check if a drug is covered by a plan
   */
  async checkDrugCoverage(planId: string, rxcui: string): Promise<{
    covered: boolean;
    tier?: string;
    priorAuth?: boolean;
    stepTherapy?: boolean;
    quantityLimit?: boolean;
  } | null> {
    try {
      const response = await this.makeRequest<{
        covered: boolean;
        tier?: string;
        prior_authorization?: boolean;
        step_therapy?: boolean;
        quantity_limit?: boolean;
      }>(`/plans/${planId}/drugs/${rxcui}`);

      return {
        covered: response.covered,
        tier: response.tier,
        priorAuth: response.prior_authorization,
        stepTherapy: response.step_therapy,
        quantityLimit: response.quantity_limit,
      };
    } catch (error) {
      logger.error('Failed to check drug coverage', { data: { planId, rxcui, error } });
      return null;
    }
  }

  // Private helper methods

  /**
   * Make a GET request to the CMS API
   * API key is passed as query parameter
   */
  private async makeRequest<T>(endpoint: string): Promise<T> {
    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${endpoint}${separator}apikey=${encodeURIComponent(this.apiKey)}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`CMS API error: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`CMS API request timed out after ${this.timeout}ms`);
      }
throw error;
    }
  }

  /**
   * Make a POST request to the CMS API
   * API key is passed as query parameter
   */
  private async makePostRequest<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${endpoint}?apikey=${encodeURIComponent(this.apiKey)}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`CMS API error: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`CMS API request timed out after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Build the request body for plan search POST request
   */
  private buildPlanSearchBody(params: CMSPlanSearchParams): Record<string, unknown> {
    // Build people array for household
    let people: CMSHouseholdPerson[];

    if (params.people && params.people.length > 0) {
      people = params.people;
    } else {
      const ages = Array.isArray(params.age) ? params.age : (params.age ? [params.age] : [30]);
      const tobaccoUsers = Array.isArray(params.is_tobacco_user)
        ? params.is_tobacco_user
        : (params.is_tobacco_user !== undefined ? [params.is_tobacco_user] : [false]);

      people = ages.map((age, index) => ({
        age,
        aptc_eligible: params.aptc_eligible ?? true,
        gender: params.gender || 'Male',
        uses_tobacco: tobaccoUsers[index] ?? tobaccoUsers[0] ?? false,
      }));
    }

    const body: Record<string, unknown> = {
      place: {
        zipcode: params.zipcode,
        state: params.state,
        countyfips: params.fips,
      },
      market: params.market || 'Individual',
      year: params.year || new Date().getFullYear(),
      household: {
        income: params.income || 50000,
        people,
      },
    };

    // Add filters if provided
    if (params.filter) {
      const filter: Record<string, unknown> = {};
      if (params.filter.metal_level) filter.metal_level = params.filter.metal_level;
      if (params.filter.type) filter.type = params.filter.type;
      if (params.filter.issuer) filter.issuer = params.filter.issuer;
      if (Object.keys(filter).length > 0) body.filter = filter;
    }

    if (params.offset !== undefined) body.offset = params.offset;
    if (params.limit !== undefined) body.limit = params.limit;
    if (params.order) body.order = params.order;
    if (params.order_by) body.order_by = params.order_by;

    return body;
  }

  /**
   * Transform CMS API response to frontend-friendly format
   *
   * BUG FIX: The API returns deductibles and moops as arrays.
   * We must access plan.deductibles?.[0]?.amount instead of plan.deductible
   * and plan.moops?.[0]?.amount instead of plan.moop
   */
  private transformPlanSearchResponse(
    response: CMSPlanSearchResponse,
    offset: number,
    limit: number
  ): MarketplacePlanSearchResult {
    const plans = response.plans.map(plan => this.transformPlan(plan));

    // Extract facets for filters
    const metalLevelFacet = response.facet_groups?.find(g => g.name === 'metal_level');
    const planTypeFacet = response.facet_groups?.find(g => g.name === 'type');
    const issuerFacet = response.facet_groups?.find(g => g.name === 'issuer');

    return {
      plans,
      total: response.total,
      page: Math.floor(offset / limit) + 1,
      limit,
      filters: {
        metalLevels: metalLevelFacet?.facets || [],
        planTypes: planTypeFacet?.facets || [],
        issuers: issuerFacet?.facets || [],
      },
      priceRanges: {
        premium: response.ranges?.premiums || { min: 0, max: 0 },
        deductible: response.ranges?.deductibles || { min: 0, max: 0 },
      },
    };
  }

  /**
   * Transform a single CMS plan to frontend format
   *
   * BUG FIX: Access deductibles[0].amount and moops[0].amount
   */
  private transformPlan(plan: CMSPlan): TransformedPlan {
    return {
      id: plan.id,
      name: plan.name,
      issuer: plan.issuer.name,
      issuerId: plan.issuer.id,
      metalLevel: plan.metal_level,
      planType: plan.type,
      premium: plan.premium,
      premiumWithCredit: plan.premium_w_credit,
      // BUG FIX: deductibles is an array, not a single value
      deductible: plan.deductibles?.[0]?.amount || 0,
      // BUG FIX: moops is an array, not a single value
      outOfPocketMax: plan.moops?.[0]?.amount || 0,
      hsaEligible: plan.hsa_eligible || false,
      qualityRating: plan.quality_rating?.global_rating,
      benefits: (plan.benefits || []).map(benefit => this.transformBenefit(benefit)),
      urls: {
        brochure: plan.brochure_url,
        formulary: plan.formulary_url,
        network: plan.network_url,
        benefits: plan.benefits_url,
      },
    };
  }

  private transformBenefit(benefit: CMSBenefit): TransformedBenefit {
    let costSharing: string | undefined;

    if (benefit.cost_sharings && benefit.cost_sharings.length > 0) {
      const inNetwork = benefit.cost_sharings.find(cs => cs.network_tier === 'In-Network');
      if (inNetwork) {
        if (inNetwork.copay_amount) {
          costSharing = `$${inNetwork.copay_amount} copay`;
        } else if (inNetwork.coinsurance_rate) {
          costSharing = `${inNetwork.coinsurance_rate * 100}% coinsurance`;
        } else if (inNetwork.display_string) {
          costSharing = inNetwork.display_string;
        }
      }
    }

    return {
      name: benefit.name,
      covered: benefit.covered,
      costSharing,
      hasLimits: benefit.has_limits || false,
      explanation: benefit.explanation,
    };
  }
}

// Singleton instance
let serviceInstance: CMSMarketplaceService | null = null;

export function getCMSMarketplaceService(): CMSMarketplaceService {
  if (!serviceInstance) {
    serviceInstance = new CMSMarketplaceService();
  }
  return serviceInstance;
}

export default CMSMarketplaceService;
