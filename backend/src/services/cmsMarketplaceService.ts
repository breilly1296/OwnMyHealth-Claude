/**
 * CMS Marketplace API Service
 *
 * Integration with Healthcare.gov Marketplace API for:
 * - Coverage Lookup: Fetch detailed plan information by plan ID
 * - Provider Search: Find in-network healthcare providers
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
 */
async function cmsRequest<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  if (!config.cms.enabled) {
    throw new Error('CMS Marketplace API is not configured. Set CMS_API_KEY environment variable.');
  }

  const url = new URL(`${config.cms.baseUrl}${endpoint}`);

  // Add query parameters
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.cms.apiKey}`,
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
