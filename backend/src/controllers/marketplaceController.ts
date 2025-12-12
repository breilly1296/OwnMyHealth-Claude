/**
 * Marketplace Controller
 *
 * Handles CMS Healthcare.gov Marketplace API endpoints for searching
 * and comparing health insurance plans.
 *
 * @module controllers/marketplaceController
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import {
  getCMSMarketplaceService,
  type CMSCounty,
  type CMSPlanSearchParams,
  type MarketplacePlanSearchResult,
  type TransformedPlan,
} from '../services/cmsMarketplaceService.js';
import { getPrismaClient } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
import { logger } from '../utils/logger.js';

const RESOURCE_TYPE = 'MarketplacePlan';

/**
 * GET /marketplace/counties/:zipcode
 * Get county/FIPS information by ZIP code
 */
export async function getCountiesByZip(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { zipcode } = req.params;
  const userId = req.user?.id;

  try {
    // Validate ZIP code format
    if (!/^\d{5}$/.test(zipcode)) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'INVALID_ZIPCODE',
          message: 'ZIP code must be exactly 5 digits',
        },
      };
      res.status(400).json(response);
      return;
    }

    const service = getCMSMarketplaceService();
    const counties = await service.getCountiesByZipcode(zipcode);

    if (counties.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `No counties found for ZIP code ${zipcode}`,
        },
      };
      res.status(404).json(response);
      return;
    }

    // Log access if authenticated
    if (userId) {
      const prisma = getPrismaClient();
      const auditService = getAuditLogService(prisma);
      await auditService.logAccess('MarketplaceCounty', zipcode, { req, userId }, {
        countiesFound: counties.length,
      });
    }

    const response: ApiResponse<{ counties: CMSCounty[]; zipcode: string }> = {
      success: true,
      data: {
        counties,
        zipcode,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to get counties by ZIP', { data: { zipcode, error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'Failed to retrieve county information',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}

/**
 * POST /marketplace/plans/search
 * Search for marketplace health insurance plans
 */
export async function searchPlans(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user?.id;

  try {
    const {
      zipcode,
      fips,
      state,
      market = 'Individual',
      year,
      aptc_eligible,
      csr_eligible,
      income,
      household_size,
      age,
      is_tobacco_user,
      metal_levels,
      plan_types,
      issuers,
      page = 1,
      limit = 10,
      sort_by,
      sort_order,
    } = req.body;

    // Validate required fields
    if (!zipcode || !fips || !state) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'zipcode, fips, and state are required',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Validate ZIP code format
    if (!/^\d{5}$/.test(zipcode)) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'INVALID_ZIPCODE',
          message: 'ZIP code must be exactly 5 digits',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Validate state format
    if (!/^[A-Z]{2}$/.test(state)) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: 'State must be a 2-letter code (e.g., CA, NY)',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Build search parameters
    const searchParams: CMSPlanSearchParams = {
      zipcode,
      fips,
      state,
      market,
      year: year || new Date().getFullYear(),
      aptc_eligible,
      csr_eligible,
      income,
      household_size,
      age,
      is_tobacco_user,
      filter: {
        metal_level: metal_levels,
        type: plan_types,
        issuer: issuers,
      },
      offset: (page - 1) * limit,
      limit,
      order: sort_order,
      order_by: sort_by,
    };

    const service = getCMSMarketplaceService();
    const result = await service.searchPlans(searchParams);

    // Log search if authenticated
    if (userId) {
      const prisma = getPrismaClient();
      const auditService = getAuditLogService(prisma);
      await auditService.logAccess(RESOURCE_TYPE, 'search', { req, userId }, {
        zipcode,
        state,
        plansFound: result.total,
        page,
      });
    }

    const response: ApiResponse<MarketplacePlanSearchResult> = {
      success: true,
      data: result,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to search plans', { data: { body: req.body, error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'Failed to search marketplace plans',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}

/**
 * GET /marketplace/plans/:planId
 * Get detailed information about a specific plan
 */
export async function getPlanDetails(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { planId } = req.params;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
  const userId = req.user?.id;

  try {
    const service = getCMSMarketplaceService();
    const plan = await service.getPlanDetails(planId, year);

    if (!plan) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plan ${planId} not found`,
        },
      };
      res.status(404).json(response);
      return;
    }

    // Log access if authenticated
    if (userId) {
      const prisma = getPrismaClient();
      const auditService = getAuditLogService(prisma);
      await auditService.logAccess(RESOURCE_TYPE, planId, { req, userId }, {
        planName: plan.name,
        issuer: plan.issuer,
      });
    }

    const response: ApiResponse<TransformedPlan> = {
      success: true,
      data: plan,
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to get plan details', { data: { planId, error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'Failed to retrieve plan details',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}

/**
 * POST /marketplace/plans/:planId/premium
 * Estimate premium with APTC for a specific plan
 */
export async function estimatePlanPremium(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { planId } = req.params;
  const userId = req.user?.id;

  try {
    const { zipcode, fips, age, income, household_size, is_tobacco_user } = req.body;

    // Validate required fields
    if (!zipcode || !fips || !age || !income || !household_size) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'zipcode, fips, age, income, and household_size are required',
        },
      };
      res.status(400).json(response);
      return;
    }

    const service = getCMSMarketplaceService();
    const estimate = await service.estimatePremium({
      planId,
      zipcode,
      fips,
      age,
      income,
      household_size,
      is_tobacco_user,
    });

    if (!estimate) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'ESTIMATE_FAILED',
          message: 'Unable to calculate premium estimate',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Log access if authenticated
    if (userId) {
      const prisma = getPrismaClient();
      const auditService = getAuditLogService(prisma);
      await auditService.logAccess(RESOURCE_TYPE, planId, { req, userId }, {
        operation: 'premium_estimate',
        premium: estimate.premium,
      });
    }

    const response: ApiResponse<{
      planId: string;
      premium: number;
      aptc: number;
      premiumWithCredit: number;
      monthlySavings: number;
    }> = {
      success: true,
      data: {
        planId,
        premium: estimate.premium,
        aptc: estimate.aptc,
        premiumWithCredit: estimate.premiumWithCredit,
        monthlySavings: estimate.premium - estimate.premiumWithCredit,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to estimate premium', { data: { planId, body: req.body, error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'Failed to estimate premium',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}

/**
 * GET /marketplace/plans/:planId/providers/:providerId
 * Check if a provider is in a plan's network
 */
export async function checkProviderInNetwork(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { planId, providerId } = req.params;

  try {
    const service = getCMSMarketplaceService();
    const inNetwork = await service.checkProviderNetwork(planId, providerId);

    const response: ApiResponse<{
      planId: string;
      providerId: string;
      inNetwork: boolean;
    }> = {
      success: true,
      data: {
        planId,
        providerId,
        inNetwork,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to check provider network', { data: { planId, providerId, error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'Failed to check provider network status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}

/**
 * GET /marketplace/plans/:planId/drugs/:rxcui
 * Check if a drug is covered by a plan
 */
export async function checkDrugCoverage(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { planId, rxcui } = req.params;

  try {
    const service = getCMSMarketplaceService();
    const coverage = await service.checkDrugCoverage(planId, rxcui);

    if (!coverage) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Drug coverage information not found',
        },
      };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse<{
      planId: string;
      rxcui: string;
      covered: boolean;
      tier?: string;
      restrictions: {
        priorAuth: boolean;
        stepTherapy: boolean;
        quantityLimit: boolean;
      };
    }> = {
      success: true,
      data: {
        planId,
        rxcui,
        covered: coverage.covered,
        tier: coverage.tier,
        restrictions: {
          priorAuth: coverage.priorAuth || false,
          stepTherapy: coverage.stepTherapy || false,
          quantityLimit: coverage.quantityLimit || false,
        },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to check drug coverage', { data: { planId, rxcui, error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'Failed to check drug coverage',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}

/**
 * GET /marketplace/issuers
 * Get available insurance issuers for a state
 */
export async function getIssuers(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const state = req.query.state as string;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

  try {
    if (!state || !/^[A-Z]{2}$/.test(state)) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: 'State must be a 2-letter code (e.g., CA, NY)',
        },
      };
      res.status(400).json(response);
      return;
    }

    const service = getCMSMarketplaceService();
    const issuers = await service.getIssuers(state, year);

    const response: ApiResponse<{ issuers: Array<{ id: string; name: string }>; state: string }> = {
      success: true,
      data: {
        issuers,
        state,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to get issuers', { data: { state, error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'Failed to retrieve issuers',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}

/**
 * GET /marketplace/metal-levels
 * Get available metal levels for a state
 */
export async function getMetalLevels(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const state = req.query.state as string;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

  try {
    if (!state || !/^[A-Z]{2}$/.test(state)) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: 'State must be a 2-letter code (e.g., CA, NY)',
        },
      };
      res.status(400).json(response);
      return;
    }

    const service = getCMSMarketplaceService();
    const metalLevels = await service.getMetalLevels(state, year);

    const response: ApiResponse<{ metalLevels: string[]; state: string }> = {
      success: true,
      data: {
        metalLevels,
        state,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to get metal levels', { data: { state, error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'Failed to retrieve metal levels',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}

/**
 * POST /marketplace/plans/compare
 * Compare multiple plans side by side
 */
export async function comparePlans(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user?.id;

  try {
    const { plan_ids, year } = req.body;

    if (!plan_ids || !Array.isArray(plan_ids) || plan_ids.length < 2) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'At least 2 plan IDs are required for comparison',
        },
      };
      res.status(400).json(response);
      return;
    }

    if (plan_ids.length > 4) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'TOO_MANY_PLANS',
          message: 'Maximum 4 plans can be compared at once',
        },
      };
      res.status(400).json(response);
      return;
    }

    const service = getCMSMarketplaceService();
    const planPromises = plan_ids.map((id: string) => service.getPlanDetails(id, year));
    const plans = await Promise.all(planPromises);

    // Filter out nulls (plans not found)
    const validPlans = plans.filter((p): p is TransformedPlan => p !== null);

    if (validPlans.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'None of the specified plans were found',
        },
      };
      res.status(404).json(response);
      return;
    }

    // Log comparison if authenticated
    if (userId) {
      const prisma = getPrismaClient();
      const auditService = getAuditLogService(prisma);
      await auditService.logAccess(RESOURCE_TYPE, 'compare', { req, userId }, {
        planIds: plan_ids,
        plansFound: validPlans.length,
      });
    }

    const response: ApiResponse<{
      plans: TransformedPlan[];
      comparison: {
        lowestPremium: string;
        lowestDeductible: string;
        lowestOutOfPocketMax: string;
        highestQualityRating: string | null;
      };
    }> = {
      success: true,
      data: {
        plans: validPlans,
        comparison: {
          lowestPremium: validPlans.reduce((min, p) =>
            p.premium < (validPlans.find(pl => pl.id === min)?.premium || Infinity) ? p.id : min,
            validPlans[0].id
          ),
          lowestDeductible: validPlans.reduce((min, p) =>
            p.deductible < (validPlans.find(pl => pl.id === min)?.deductible || Infinity) ? p.id : min,
            validPlans[0].id
          ),
          lowestOutOfPocketMax: validPlans.reduce((min, p) =>
            p.outOfPocketMax < (validPlans.find(pl => pl.id === min)?.outOfPocketMax || Infinity) ? p.id : min,
            validPlans[0].id
          ),
          highestQualityRating: validPlans
            .filter(p => p.qualityRating !== undefined)
            .reduce<string | null>((max, p) => {
              if (!max) return p.id;
              const maxRating = validPlans.find(pl => pl.id === max)?.qualityRating || 0;
              return (p.qualityRating || 0) > maxRating ? p.id : max;
            }, null),
        },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to compare plans', { data: { body: req.body, error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'Failed to compare plans',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}


/**
 * GET /cms/test
 * Test CMS API key configuration and connectivity
 * This endpoint does NOT require authentication
 */
export async function testCMSApiKey(
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const service = getCMSMarketplaceService();

    // Test with a known valid ZIP code (Austin, TX)
    const testZipcode = '78701';
    const counties = await service.getCountiesByZipcode(testZipcode);

    if (counties.length > 0) {
      const response: ApiResponse<{
        status: string;
        message: string;
        testZipcode: string;
        countiesFound: number;
      }> = {
        success: true,
        data: {
          status: 'connected',
          message: 'CMS API key is valid and working',
          testZipcode,
          countiesFound: counties.length,
        },
      };
      res.json(response);
    } else {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'CMS_API_NO_DATA',
          message: 'CMS API connected but returned no data for test ZIP code',
        },
      };
      res.status(500).json(response);
    }
  } catch (error) {
    logger.error('CMS API key test failed', { data: { error } });
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CMS_API_ERROR',
        message: 'CMS API key test failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
    res.status(500).json(response);
  }
}
