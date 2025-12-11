/**
 * CMS Marketplace API Service
 *
 * Integration with Healthcare.gov Marketplace API for:
 * - Plan Search: Search for health insurance plans by location and household
 * - Coverage Lookup: Fetch detailed plan information by plan ID
 *
 * API Documentation: https://developer.cms.gov/marketplace-api/
 *
 * @module services/cmsMarketplaceService
 */

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// ============================================
// Types
// ============================================

// Plan Search Types
export interface CMSPlanSearchParams {
  zipcode: string;
  age: number;
  income: number;
  householdSize: number;
  gender?: 'Male' | 'Female';
  usesTobacco?: boolean;
  year?: number;
}

export interface CMSCountyInfo {
  fips: string;
  name: string;
  state: string;
  zipcode: string;
}

export interface CMSPlanSearchResult {
  plans: CMSSearchedPlan[];
  total: number;
  facetGroups?: CMSFacetGroup[];
  ranges?: {
    premiums?: { min: number; max: number };
    deductibles?: { min: number; max: number };
  };
}

export interface CMSSearchedPlan {
  id: string;
  name: string;
  issuer: {
    id: string;
    name: string;
  };
  metalLevel: 'catastrophic' | 'bronze' | 'silver' | 'gold' | 'platinum';
  type: string;
  premium: number;
  premiumWithCredit: number;
  deductible: number;
  moopAmount: number;
  ehbPremium?: number;
  pediatricDentalCoverage?: boolean;
  hsaEligible?: boolean;
  benefits?: CMSBenefitSummary[];
  qualityRating?: {
    globalRating?: number;
    globalRatingStr?: string;
  };
  brochureUrl?: string;
  formularyUrl?: string;
  networkUrl?: string;
}

export interface CMSBenefitSummary {
  name: string;
  covered: boolean;
  costSharingDisplay?: string;
}

export interface CMSFacetGroup {
  name: string;
  facets: { value: string; count: number }[];
}

export interface CMSPlanDetails {
  id: string;
  name: string;
  issuer: {
    id: string;
    name: string;
  };
  metalLevel: 'catastrophic' | 'bronze' | 'silver' | 'gold' | 'platinum';
  type: string;
  premium: number;
  deductibles: {
    individual: number;
    family: number;
  };
  outOfPocketMax: {
    individual: number;
    family: number;
  };
  benefits: CMSBenefit[];
  network: {
    url?: string;
    tier?: string;
  };
  formularyUrl?: string;
  brochureUrl?: string;
}

export interface CMSBenefit {
  name: string;
  covered: boolean;
  costSharing?: {
    copay?: number;
    coinsurance?: number;
    deductibleApplies?: boolean;
  };
  explanation?: string;
}

export interface CMSProvider {
  npi: string;
  name: {
    first?: string;
    middle?: string;
    last?: string;
    full: string;
  };
  specialty?: string[];
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  phone?: string;
  acceptingNewPatients?: boolean;
  gender?: string;
  languages?: string[];
  facilityType?: string;
  distance?: number;
}

export interface CMSProviderSearchParams {
  planId?: string;
  zipcode: string;
  radius?: number; // miles
  specialty?: string;
  type?: 'individual' | 'facility';
  page?: number;
  limit?: number;
}

export interface CMSProviderSearchResult {
  providers: CMSProvider[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CMSApiError {
  code: string;
  message: string;
  details?: unknown;
}

// ============================================
// HTTP Client
// ============================================

interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

/**
 * Make authenticated request to CMS Marketplace API
 * Authentication is via 'apikey' query parameter (not Authorization header)
 */
async function cmsRequest<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  if (!config.cms.enabled) {
    throw new Error('CMS Marketplace API is not configured. Set CMS_API_KEY environment variable.');
  }

  const url = new URL(`${config.cms.baseUrl}${endpoint}`);

  // Add API key as query parameter (CMS API requires this format)
  url.searchParams.append('apikey', config.cms.apiKey);

  // Add additional query parameters
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers,
    signal: AbortSignal.timeout(config.cms.timeout),
  };

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  logger.debug(`CMS API Request: ${fetchOptions.method} ${url.pathname}`, {
    prefix: 'CMS',
  });

  const response = await fetch(url.toString(), fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    let errorData: CMSApiError;

    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = {
        code: `HTTP_${response.status}`,
        message: errorText || response.statusText,
      };
    }

    logger.error(`CMS API Error: ${response.status}`, {
      prefix: 'CMS',
      data: { endpoint, status: response.status, error: errorData },
    });

    throw new CMSMarketplaceError(
      errorData.message || `CMS API request failed with status ${response.status}`,
      response.status,
      errorData.code
    );
  }

  const data = await response.json();
  return data as T;
}

// ============================================
// Custom Error Class
// ============================================

export class CMSMarketplaceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'CMSMarketplaceError';
  }
}

// ============================================
// Plan Search Service
// ============================================

/**
 * Get county FIPS code from zipcode
 * Required for plan search API
 *
 * @param zipcode - 5-digit US zipcode
 * @returns County information including FIPS code
 */
export async function getCountyByZipcode(zipcode: string): Promise<CMSCountyInfo> {
  logger.info(`Looking up county for zipcode: ${zipcode}`, { prefix: 'CMS' });

  const data = await cmsRequest<CMSCountyRawResponse[]>(`/counties/by/zip/${zipcode}`);

  if (!data || data.length === 0) {
    throw new CMSMarketplaceError(
      `No county found for zipcode ${zipcode}`,
      404,
      'COUNTY_NOT_FOUND'
    );
  }

  // Return the first county (some zipcodes span multiple counties)
  const county = data[0];
  return {
    fips: county.fips,
    name: county.name,
    state: county.state,
    zipcode: zipcode,
  };
}

/**
 * Search for health insurance plans
 *
 * @param params - Search parameters including location, age, income, household size
 * @returns List of available plans with pricing
 */
export async function searchPlans(params: CMSPlanSearchParams): Promise<CMSPlanSearchResult> {
  const year = params.year || new Date().getFullYear();

  logger.info(`Searching plans for zipcode: ${params.zipcode}`, {
    prefix: 'CMS',
    data: { age: params.age, income: params.income, householdSize: params.householdSize },
  });

  // First, get the county FIPS code from the zipcode
  const county = await getCountyByZipcode(params.zipcode);

  // Build the plan search request body
  const requestBody = {
    household: {
      income: params.income,
      people: [
        {
          age: params.age,
          aptc_eligible: true,
          gender: params.gender || 'Male',
          uses_tobacco: params.usesTobacco || false,
        },
      ],
    },
    market: 'Individual',
    place: {
      countyfips: county.fips,
      state: county.state,
      zipcode: params.zipcode,
    },
    year: year,
  };

  // Add additional household members if householdSize > 1
  // For simplicity, we add them as dependents with estimated ages
  if (params.householdSize > 1) {
    for (let i = 1; i < params.householdSize; i++) {
      // Add spouse/partner as same age, children as 10 years old
      const isSpouse = i === 1;
      requestBody.household.people.push({
        age: isSpouse ? params.age : 10,
        aptc_eligible: true,
        gender: isSpouse ? (params.gender === 'Male' ? 'Female' : 'Male') : 'Male',
        uses_tobacco: false,
      });
    }
  }

  const data = await cmsRequest<CMSPlanSearchRawResponse>('/plans/search', {
    method: 'POST',
    body: requestBody,
  });

  return transformPlanSearchResponse(data);
}

// ============================================
// Coverage Lookup Service
// ============================================

/**
 * Get detailed plan information by plan ID
 *
 * @param planId - The CMS marketplace plan ID (e.g., "12345CA0012345")
 * @param year - Plan year (defaults to current year)
 * @returns Detailed plan information including benefits and cost sharing
 */
export async function getPlanDetails(
  planId: string,
  year?: number
): Promise<CMSPlanDetails> {
  const planYear = year || new Date().getFullYear();

  logger.info(`Fetching plan details: ${planId} for year ${planYear}`, { prefix: 'CMS' });

  // CMS API typically structures plan endpoints as /plans/{year}/{planId}
  const data = await cmsRequest<CMSPlanRawResponse>(`/plans/${planYear}/${planId}`);

  return transformPlanResponse(data);
}

/**
 * Get plan benefits breakdown
 *
 * @param planId - The CMS marketplace plan ID
 * @param year - Plan year (defaults to current year)
 * @returns Array of benefits with coverage details
 */
export async function getPlanBenefits(
  planId: string,
  year?: number
): Promise<CMSBenefit[]> {
  const planYear = year || new Date().getFullYear();

  logger.info(`Fetching plan benefits: ${planId}`, { prefix: 'CMS' });

  const data = await cmsRequest<CMSBenefitsRawResponse>(
    `/plans/${planYear}/${planId}/benefits`
  );

  return transformBenefitsResponse(data);
}

// ============================================
// Provider Search Service
// ============================================

/**
 * Search for healthcare providers
 *
 * @param params - Search parameters including location, specialty, etc.
 * @returns Paginated list of matching providers
 */
export async function searchProviders(
  params: CMSProviderSearchParams
): Promise<CMSProviderSearchResult> {
  logger.info(`Searching providers near ${params.zipcode}`, {
    prefix: 'CMS',
    data: { specialty: params.specialty, planId: params.planId },
  });

  const queryParams: Record<string, string | number | undefined> = {
    zipcode: params.zipcode,
    radius: params.radius || 25,
    page: params.page || 1,
    limit: params.limit || 20,
  };

  if (params.specialty) {
    queryParams.specialty = params.specialty;
  }

  if (params.type) {
    queryParams.type = params.type;
  }

  let endpoint = '/providers';

  // If searching within a specific plan's network
  if (params.planId) {
    const year = new Date().getFullYear();
    endpoint = `/plans/${year}/${params.planId}/providers`;
  }

  const data = await cmsRequest<CMSProviderSearchRawResponse>(endpoint, {
    params: queryParams,
  });

  return transformProviderSearchResponse(data, params.page || 1, params.limit || 20);
}

/**
 * Get provider details by NPI
 *
 * @param npi - National Provider Identifier
 * @returns Provider details
 */
export async function getProviderByNPI(npi: string): Promise<CMSProvider> {
  logger.info(`Fetching provider: NPI ${npi}`, { prefix: 'CMS' });

  const data = await cmsRequest<CMSProviderRawResponse>(`/providers/${npi}`);

  return transformProviderResponse(data);
}

/**
 * Check if a provider is in-network for a specific plan
 *
 * @param planId - The CMS marketplace plan ID
 * @param npi - National Provider Identifier
 * @returns Whether provider is in-network
 */
export async function checkProviderNetwork(
  planId: string,
  npi: string
): Promise<{ inNetwork: boolean; networkTier?: string }> {
  const year = new Date().getFullYear();

  logger.info(`Checking network status: NPI ${npi} for plan ${planId}`, { prefix: 'CMS' });

  try {
    const data = await cmsRequest<CMSNetworkCheckResponse>(
      `/plans/${year}/${planId}/providers/${npi}/network-status`
    );

    return {
      inNetwork: data.in_network,
      networkTier: data.tier,
    };
  } catch (error) {
    // 404 typically means provider not in network
    if (error instanceof CMSMarketplaceError && error.statusCode === 404) {
      return { inNetwork: false };
    }
    throw error;
  }
}

// ============================================
// Response Transformers (CMS API -> Our Types)
// ============================================

// Raw response types from CMS API (snake_case)

// County lookup response
interface CMSCountyRawResponse {
  fips: string;
  name: string;
  state: string;
}

// Plan search response
interface CMSPlanSearchRawResponse {
  plans: CMSPlanSearchRawPlan[];
  total: number;
  facet_groups?: {
    name: string;
    facets: { value: string; count: number }[];
  }[];
  ranges?: {
    premiums?: { min: number; max: number };
    deductibles?: { min: number; max: number };
  };
}

interface CMSPlanSearchRawPlan {
  id: string;
  name: string;
  issuer: {
    id: string;
    name: string;
  };
  metal_level: string;
  type: string;
  premium: number;
  premium_w_credit: number;
  deductible: number;
  moop: number;
  ehb_premium?: number;
  pediatric_dental_coverage?: boolean;
  hsa_eligible?: boolean;
  benefits?: {
    name: string;
    covered: boolean;
    cost_sharing?: string;
  }[];
  quality_rating?: {
    global_rating?: number;
    global_rating_string?: string;
  };
  brochure_url?: string;
  formulary_url?: string;
  network_url?: string;
}

interface CMSPlanRawResponse {
  plan_id: string;
  plan_name: string;
  issuer_id: string;
  issuer_name: string;
  metal_level: string;
  plan_type: string;
  premium: number;
  deductible_individual: number;
  deductible_family: number;
  oop_max_individual: number;
  oop_max_family: number;
  network_url?: string;
  network_tier?: string;
  formulary_url?: string;
  brochure_url?: string;
  benefits?: CMSBenefitRaw[];
}

interface CMSBenefitRaw {
  name: string;
  covered: boolean;
  copay_amount?: number;
  coinsurance_rate?: number;
  deductible_applies?: boolean;
  explanation?: string;
}

interface CMSBenefitsRawResponse {
  benefits: CMSBenefitRaw[];
}

interface CMSProviderRawResponse {
  npi: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  organization_name?: string;
  specialties?: string[];
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  accepting_new_patients?: boolean;
  gender?: string;
  languages?: string[];
  facility_type?: string;
}

interface CMSProviderSearchRawResponse {
  providers: CMSProviderRawResponse[];
  total: number;
}

interface CMSNetworkCheckResponse {
  in_network: boolean;
  tier?: string;
}

function transformPlanSearchResponse(raw: CMSPlanSearchRawResponse): CMSPlanSearchResult {
  return {
    plans: raw.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      issuer: plan.issuer,
      metalLevel: plan.metal_level.toLowerCase() as CMSSearchedPlan['metalLevel'],
      type: plan.type,
      premium: plan.premium,
      premiumWithCredit: plan.premium_w_credit,
      deductible: plan.deductible,
      moopAmount: plan.moop,
      ehbPremium: plan.ehb_premium,
      pediatricDentalCoverage: plan.pediatric_dental_coverage,
      hsaEligible: plan.hsa_eligible,
      benefits: plan.benefits?.map((b) => ({
        name: b.name,
        covered: b.covered,
        costSharingDisplay: b.cost_sharing,
      })),
      qualityRating: plan.quality_rating
        ? {
            globalRating: plan.quality_rating.global_rating,
            globalRatingStr: plan.quality_rating.global_rating_string,
          }
        : undefined,
      brochureUrl: plan.brochure_url,
      formularyUrl: plan.formulary_url,
      networkUrl: plan.network_url,
    })),
    total: raw.total,
    facetGroups: raw.facet_groups?.map((fg) => ({
      name: fg.name,
      facets: fg.facets,
    })),
    ranges: raw.ranges,
  };
}

function transformPlanResponse(raw: CMSPlanRawResponse): CMSPlanDetails {
  return {
    id: raw.plan_id,
    name: raw.plan_name,
    issuer: {
      id: raw.issuer_id,
      name: raw.issuer_name,
    },
    metalLevel: raw.metal_level.toLowerCase() as CMSPlanDetails['metalLevel'],
    type: raw.plan_type,
    premium: raw.premium,
    deductibles: {
      individual: raw.deductible_individual,
      family: raw.deductible_family,
    },
    outOfPocketMax: {
      individual: raw.oop_max_individual,
      family: raw.oop_max_family,
    },
    benefits: raw.benefits?.map(transformBenefitResponse) || [],
    network: {
      url: raw.network_url,
      tier: raw.network_tier,
    },
    formularyUrl: raw.formulary_url,
    brochureUrl: raw.brochure_url,
  };
}

function transformBenefitResponse(raw: CMSBenefitRaw): CMSBenefit {
  return {
    name: raw.name,
    covered: raw.covered,
    costSharing: raw.copay_amount !== undefined || raw.coinsurance_rate !== undefined
      ? {
          copay: raw.copay_amount,
          coinsurance: raw.coinsurance_rate,
          deductibleApplies: raw.deductible_applies,
        }
      : undefined,
    explanation: raw.explanation,
  };
}

function transformBenefitsResponse(raw: CMSBenefitsRawResponse): CMSBenefit[] {
  return raw.benefits.map(transformBenefitResponse);
}

function transformProviderResponse(raw: CMSProviderRawResponse): CMSProvider {
  const fullName = raw.organization_name ||
    [raw.first_name, raw.middle_name, raw.last_name].filter(Boolean).join(' ');

  return {
    npi: raw.npi,
    name: {
      first: raw.first_name,
      middle: raw.middle_name,
      last: raw.last_name,
      full: fullName,
    },
    specialty: raw.specialties,
    address: {
      street: [raw.address_line_1, raw.address_line_2].filter(Boolean).join(', '),
      city: raw.city,
      state: raw.state,
      zip: raw.zip,
    },
    phone: raw.phone,
    acceptingNewPatients: raw.accepting_new_patients,
    gender: raw.gender,
    languages: raw.languages,
    facilityType: raw.facility_type,
  };
}

function transformProviderSearchResponse(
  raw: CMSProviderSearchRawResponse,
  page: number,
  limit: number
): CMSProviderSearchResult {
  return {
    providers: raw.providers.map(transformProviderResponse),
    total: raw.total,
    page,
    pageSize: limit,
    hasMore: page * limit < raw.total,
  };
}

// ============================================
// Service Health Check
// ============================================

/**
 * Check if CMS Marketplace API is accessible
 */
export async function healthCheck(): Promise<{ healthy: boolean; message: string }> {
  if (!config.cms.enabled) {
    return {
      healthy: false,
      message: 'CMS API not configured (missing CMS_API_KEY)',
    };
  }

  try {
    // Try a simple API call to verify connectivity
    await cmsRequest<unknown>('/health');
    return { healthy: true, message: 'CMS Marketplace API is accessible' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { healthy: false, message: `CMS API health check failed: ${message}` };
  }
}

// ============================================
// Export
// ============================================

export const cmsMarketplaceService = {
  // Plan Search
  getCountyByZipcode,
  searchPlans,

  // Coverage Lookup
  getPlanDetails,
  getPlanBenefits,

  // Provider Search
  searchProviders,
  getProviderByNPI,
  checkProviderNetwork,

  // Health
  healthCheck,
};

export default cmsMarketplaceService;
