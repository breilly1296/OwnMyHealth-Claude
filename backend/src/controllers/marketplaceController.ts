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
