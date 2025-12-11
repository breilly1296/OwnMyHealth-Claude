/**
 * Marketplace Controller
 *
 * Handles CMS Marketplace API integration for:
 * - Coverage Lookup: Get detailed plan information
 * - Provider Search: Find in-network healthcare providers
 *
 * All routes require authentication.
 *
 * @module controllers/marketplaceController
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { BadRequestError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import {
  cmsMarketplaceService,
  CMSMarketplaceError,
  type CMSPlanDetails,
  type CMSBenefit,
  type CMSProviderSearchResult,
  type CMSProvider,
  type CMSPlanSearchResult,
  type CMSPlanSearchParams,
} from '../services/cmsMarketplaceService.js';
import { logger } from '../utils/logger.js';

/**
 * Check if CMS API is configured
 */
function requireCMSConfig(): void {
  if (!config.cms.enabled) {
    throw new BadRequestError(
      'Healthcare.gov Marketplace API is not configured. Contact your administrator.'
    );
  }
}

// ============================================
// Plan Search Endpoints
// ============================================

/**
 * POST /api/v1/marketplace/plans/search
 * Search for health insurance plans based on location and household info
 */
export async function searchPlans(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  requireCMSConfig();

  const { zipcode, age, income, householdSize, gender, usesTobacco, year } = req.body;

  // Validate required fields
  if (!zipcode || typeof zipcode !== 'string') {
    throw new BadRequestError('Zipcode is required');
  }

  if (!/^\d{5}$/.test(zipcode)) {
    throw new BadRequestError('Invalid zipcode format. Must be 5 digits.');
  }

  if (!age || typeof age !== 'number' || age < 0 || age > 120) {
    throw new BadRequestError('Valid age is required (0-120)');
  }

  if (!income || typeof income !== 'number' || income < 0) {
    throw new BadRequestError('Valid income is required (must be 0 or greater)');
  }

  if (!householdSize || typeof householdSize !== 'number' || householdSize < 1 || householdSize > 10) {
    throw new BadRequestError('Valid household size is required (1-10)');
  }

  logger.info(`User ${req.user!.id} searching plans for zipcode ${zipcode}`, {
    prefix: 'Marketplace',
    data: { age, income, householdSize },
  });

  try {
    const searchParams: CMSPlanSearchParams = {
      zipcode,
      age,
      income,
      householdSize,
      gender: gender as 'Male' | 'Female' | undefined,
      usesTobacco: usesTobacco as boolean | undefined,
      year: year as number | undefined,
    };

    const result = await cmsMarketplaceService.searchPlans(searchParams);

    const response: ApiResponse<CMSPlanSearchResult> = {
      success: true,
      data: result,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof CMSMarketplaceError) {
      if (error.statusCode === 404) {
        throw new BadRequestError(`No plans found for zipcode ${zipcode}. This may be an invalid zipcode or an area without marketplace coverage.`);
      }
      throw new BadRequestError(`CMS API error: ${error.message}`);
    }
    throw error;
  }
}

// ============================================
// Coverage Lookup Endpoints
// ============================================

/**
 * GET /api/v1/marketplace/plans/:planId
 * Get detailed information about a marketplace plan
 */
export async function getPlanDetails(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  requireCMSConfig();

  const { planId } = req.params;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

  if (!planId) {
    throw new BadRequestError('Plan ID is required');
  }

  logger.info(`User ${req.user!.id} looking up plan ${planId}`, { prefix: 'Marketplace' });

  try {
    const planDetails = await cmsMarketplaceService.getPlanDetails(planId, year);

    const response: ApiResponse<CMSPlanDetails> = {
      success: true,
      data: planDetails,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof CMSMarketplaceError) {
      if (error.statusCode === 404) {
        throw new BadRequestError(`Plan not found: ${planId}`);
      }
      throw new BadRequestError(`CMS API error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * GET /api/v1/marketplace/plans/:planId/benefits
 * Get benefits breakdown for a marketplace plan
 */
export async function getPlanBenefits(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  requireCMSConfig();

  const { planId } = req.params;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

  if (!planId) {
    throw new BadRequestError('Plan ID is required');
  }

  logger.info(`User ${req.user!.id} looking up benefits for plan ${planId}`, { prefix: 'Marketplace' });

  try {
    const benefits = await cmsMarketplaceService.getPlanBenefits(planId, year);

    const response: ApiResponse<CMSBenefit[]> = {
      success: true,
      data: benefits,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof CMSMarketplaceError) {
      if (error.statusCode === 404) {
        throw new BadRequestError(`Plan not found: ${planId}`);
      }
      throw new BadRequestError(`CMS API error: ${error.message}`);
    }
    throw error;
  }
}

// ============================================
// Provider Search Endpoints
// ============================================

/**
 * GET /api/v1/marketplace/providers
 * Search for healthcare providers
 */
export async function searchProviders(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  requireCMSConfig();

  const { zipcode, planId, specialty, type, radius, page, limit } = req.query;

  if (!zipcode || typeof zipcode !== 'string') {
    throw new BadRequestError('Zipcode is required');
  }

  // Validate zipcode format (5 digits)
  if (!/^\d{5}$/.test(zipcode)) {
    throw new BadRequestError('Invalid zipcode format. Must be 5 digits.');
  }

  logger.info(`User ${req.user!.id} searching providers near ${zipcode}`, {
    prefix: 'Marketplace',
    data: { specialty, planId },
  });

  try {
    const result = await cmsMarketplaceService.searchProviders({
      zipcode,
      planId: planId as string | undefined,
      specialty: specialty as string | undefined,
      type: type as 'individual' | 'facility' | undefined,
      radius: radius ? parseInt(radius as string, 10) : undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    const response: ApiResponse<CMSProviderSearchResult> = {
      success: true,
      data: result,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof CMSMarketplaceError) {
      throw new BadRequestError(`CMS API error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * GET /api/v1/marketplace/providers/:npi
 * Get provider details by NPI
 */
export async function getProviderDetails(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  requireCMSConfig();

  const { npi } = req.params;

  if (!npi) {
    throw new BadRequestError('NPI is required');
  }

  // Validate NPI format (10 digits)
  if (!/^\d{10}$/.test(npi)) {
    throw new BadRequestError('Invalid NPI format. Must be 10 digits.');
  }

  logger.info(`User ${req.user!.id} looking up provider NPI ${npi}`, { prefix: 'Marketplace' });

  try {
    const provider = await cmsMarketplaceService.getProviderByNPI(npi);

    const response: ApiResponse<CMSProvider> = {
      success: true,
      data: provider,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof CMSMarketplaceError) {
      if (error.statusCode === 404) {
        throw new BadRequestError(`Provider not found: NPI ${npi}`);
      }
      throw new BadRequestError(`CMS API error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * GET /api/v1/marketplace/providers/:npi/network-check
 * Check if a provider is in-network for a specific plan
 */
export async function checkProviderNetwork(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  requireCMSConfig();

  const { npi } = req.params;
  const { planId } = req.query;

  if (!npi) {
    throw new BadRequestError('NPI is required');
  }

  if (!planId || typeof planId !== 'string') {
    throw new BadRequestError('Plan ID is required');
  }

  // Validate NPI format
  if (!/^\d{10}$/.test(npi)) {
    throw new BadRequestError('Invalid NPI format. Must be 10 digits.');
  }

  logger.info(`User ${req.user!.id} checking network status for NPI ${npi} on plan ${planId}`, {
    prefix: 'Marketplace',
  });

  try {
    const networkStatus = await cmsMarketplaceService.checkProviderNetwork(planId, npi);

    const response: ApiResponse<{ inNetwork: boolean; networkTier?: string }> = {
      success: true,
      data: networkStatus,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof CMSMarketplaceError) {
      throw new BadRequestError(`CMS API error: ${error.message}`);
    }
    throw error;
  }
}

// ============================================
// Health Check Endpoint
// ============================================

/**
 * GET /api/v1/marketplace/health
 * Check CMS API health status
 */
export async function healthCheck(
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const status = await cmsMarketplaceService.healthCheck();

  const response: ApiResponse<{ healthy: boolean; message: string }> = {
    success: true,
    data: status,
  };

  res.json(response);
}

// ============================================
// API Key Test Endpoint (No Auth Required)
// ============================================

interface CMSTestResult {
  configured: boolean;
  apiKeyPresent: boolean;
  apiKeyLength?: number;
  connectionTest: {
    success: boolean;
    statusCode?: number;
    message: string;
    responseTime?: number;
  };
  baseUrl: string;
  timestamp: string;
}

/**
 * GET /api/v1/cms/test
 * Test CMS API key configuration and connectivity
 *
 * This endpoint:
 * 1. Checks if CMS_API_KEY is present in environment
 * 2. Makes a test request to the CMS API to verify the key works
 * 3. Returns detailed status for debugging
 *
 * Does NOT require authentication - used for deployment verification
 */
export async function testCMSApiKey(
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const startTime = Date.now();

  const result: CMSTestResult = {
    configured: config.cms.enabled,
    apiKeyPresent: !!config.cms.apiKey,
    apiKeyLength: config.cms.apiKey ? config.cms.apiKey.length : undefined,
    connectionTest: {
      success: false,
      message: 'Not tested',
    },
    baseUrl: config.cms.baseUrl,
    timestamp: new Date().toISOString(),
  };

  // If API key is not configured, return early
  if (!config.cms.enabled || !config.cms.apiKey) {
    result.connectionTest = {
      success: false,
      message: 'CMS_API_KEY environment variable is not set',
    };

    const response: ApiResponse<CMSTestResult> = {
      success: false,
      data: result,
      error: {
        code: 'CMS_NOT_CONFIGURED',
        message: 'CMS Marketplace API is not configured',
      },
    };

    res.status(503).json(response);
    return;
  }

  // Test the API connection
  try {
    // Make a simple API call to verify the key works
    // Using a lightweight provider search endpoint with the apikey query parameter
    const testUrl = `${config.cms.baseUrl}/counties/by/zip/10001?apikey=${encodeURIComponent(config.cms.apiKey)}`;

    const fetchResponse = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(config.cms.timeout),
    });

    const responseTime = Date.now() - startTime;

    if (fetchResponse.ok) {
      result.connectionTest = {
        success: true,
        statusCode: fetchResponse.status,
        message: 'CMS API key is valid and API is accessible',
        responseTime,
      };

      logger.info('CMS API key test successful', {
        prefix: 'CMS',
        data: { statusCode: fetchResponse.status, responseTime },
      });

      const response: ApiResponse<CMSTestResult> = {
        success: true,
        data: result,
      };

      res.json(response);
    } else {
      const errorText = await fetchResponse.text();

      result.connectionTest = {
        success: false,
        statusCode: fetchResponse.status,
        message: fetchResponse.status === 401 || fetchResponse.status === 403
          ? 'API key is invalid or unauthorized'
          : `API returned error: ${fetchResponse.status} - ${errorText.substring(0, 200)}`,
        responseTime,
      };

      logger.warn('CMS API key test failed', {
        prefix: 'CMS',
        data: { statusCode: fetchResponse.status, error: errorText.substring(0, 200) },
      });

      const response: ApiResponse<CMSTestResult> = {
        success: false,
        data: result,
        error: {
          code: 'CMS_API_ERROR',
          message: result.connectionTest.message,
        },
      };

      res.status(fetchResponse.status === 401 || fetchResponse.status === 403 ? 401 : 502).json(response);
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    result.connectionTest = {
      success: false,
      message: `Connection failed: ${errorMessage}`,
      responseTime,
    };

    logger.error('CMS API connection test failed', {
      prefix: 'CMS',
      data: { error: errorMessage, responseTime },
    });

    const response: ApiResponse<CMSTestResult> = {
      success: false,
      data: result,
      error: {
        code: 'CMS_CONNECTION_ERROR',
        message: `Failed to connect to CMS API: ${errorMessage}`,
      },
    };

    res.status(502).json(response);
  }
}
