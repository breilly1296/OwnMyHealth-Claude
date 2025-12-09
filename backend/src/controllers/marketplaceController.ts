/**
 * Marketplace Plans Controller
 *
 * API endpoints for searching Healthcare.gov marketplace plans.
 * Allows users to find ACA-compliant health insurance plans
 * based on their location, household, and preferences.
 *
 * @module controllers/marketplaceController
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { BadRequestError } from '../middleware/errorHandler.js';
import {
  getCountiesByZipcode,
  searchPlans,
  getPlanDetails,
  isHealthcareGovConfigured,
  type County,
  type PlanSearchParams,
  type PlanSearchResult,
  type MarketplacePlan,
} from '../services/healthcareGovService.js';
import logger from '../utils/logger.js';

/**
 * GET /api/v1/marketplace/status
 * Check if Healthcare.gov API is configured
 */
export async function getMarketplaceStatus(
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const configured = isHealthcareGovConfigured();

  const response: ApiResponse<{ configured: boolean; message: string }> = {
    success: true,
    data: {
      configured,
      message: configured
        ? 'Healthcare.gov API is configured and ready'
        : 'Healthcare.gov API key not configured. Contact administrator.',
    },
  };

  res.json(response);
}

/**
 * GET /api/v1/marketplace/counties/:zipcode
 * Get counties for a zipcode (needed for plan search)
 */
export async function getCounties(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { zipcode } = req.params;

  if (!zipcode || !/^\d{5}$/.test(zipcode)) {
    throw new BadRequestError('Valid 5-digit zipcode required');
  }

  if (!isHealthcareGovConfigured()) {
    throw new BadRequestError('Healthcare.gov API not configured');
  }

  const counties = await getCountiesByZipcode(zipcode);

  logger.info('Counties lookup', { zipcode, count: counties.length });

  const response: ApiResponse<{ counties: County[] }> = {
    success: true,
    data: { counties },
  };

  res.json(response);
}

/**
 * POST /api/v1/marketplace/plans/search
 * Search for marketplace plans
 *
 * Request body:
 * {
 *   zipcode: string,
 *   fips?: string,
 *   household: {
 *     income: number,
 *     people: [{ age: number, uses_tobacco?: boolean, is_pregnant?: boolean }],
 *     has_married_couple?: boolean
 *   },
 *   filter?: {
 *     plan_types?: ['HMO', 'PPO', 'EPO', 'POS'],
 *     metal_levels?: ['Bronze', 'Silver', 'Gold', 'Platinum'],
 *     premium_range?: { min?: number, max?: number },
 *     deductible_range?: { min?: number, max?: number }
 *   }
 * }
 */
export async function searchMarketplacePlans(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { zipcode, fips, household, filter, year } = req.body;

  // Validate required fields
  if (!zipcode || !/^\d{5}$/.test(zipcode)) {
    throw new BadRequestError('Valid 5-digit zipcode required');
  }

  if (!household || typeof household.income !== 'number' || household.income < 0) {
    throw new BadRequestError('Household income is required');
  }

  if (!household.people || !Array.isArray(household.people) || household.people.length === 0) {
    throw new BadRequestError('At least one household member is required');
  }

  // Validate household members
  for (const person of household.people) {
    if (typeof person.age !== 'number' || person.age < 0 || person.age > 120) {
      throw new BadRequestError('Valid age required for each household member');
    }
  }

  if (!isHealthcareGovConfigured()) {
    throw new BadRequestError('Healthcare.gov API not configured');
  }

  const searchParams: PlanSearchParams = {
    zipcode,
    fips,
    household: {
      income: household.income,
      people: household.people.map((p: { age: number; uses_tobacco?: boolean; is_pregnant?: boolean; is_parent?: boolean }) => ({
        age: p.age,
        uses_tobacco: p.uses_tobacco ?? false,
        is_pregnant: p.is_pregnant ?? false,
        is_parent: p.is_parent ?? false,
      })),
      has_married_couple: household.has_married_couple ?? false,
    },
    year: year || new Date().getFullYear(),
    filter,
  };

  const result = await searchPlans(searchParams);

  logger.info('Marketplace plan search', {
    userId: req.user?.id,
    zipcode,
    plansFound: result.total,
  });

  const response: ApiResponse<PlanSearchResult> = {
    success: true,
    data: result,
  };

  res.json(response);
}

/**
 * GET /api/v1/marketplace/plans/:planId
 * Get detailed plan information
 */
export async function getMarketplacePlan(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { planId } = req.params;
  const year = req.query.year ? parseInt(req.query.year as string) : undefined;

  if (!planId) {
    throw new BadRequestError('Plan ID required');
  }

  if (!isHealthcareGovConfigured()) {
    throw new BadRequestError('Healthcare.gov API not configured');
  }

  const plan = await getPlanDetails(planId, year);

  if (!plan) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'PLAN_NOT_FOUND',
        message: 'Plan not found or no longer available',
      },
    };
    res.status(404).json(response);
    return;
  }

  logger.info('Marketplace plan details', { planId });

  const response: ApiResponse<{ plan: MarketplacePlan }> = {
    success: true,
    data: { plan },
  };

  res.json(response);
}

/**
 * POST /api/v1/marketplace/plans/compare
 * Compare multiple marketplace plans
 */
export async function compareMarketplacePlans(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { planIds, year } = req.body;

  if (!planIds || !Array.isArray(planIds) || planIds.length < 2) {
    throw new BadRequestError('At least 2 plan IDs required for comparison');
  }

  if (planIds.length > 4) {
    throw new BadRequestError('Maximum 4 plans can be compared at once');
  }

  if (!isHealthcareGovConfigured()) {
    throw new BadRequestError('Healthcare.gov API not configured');
  }

  // Fetch all plan details
  const planPromises = planIds.map((id: string) => getPlanDetails(id, year));
  const plans = await Promise.all(planPromises);

  // Filter out nulls
  const validPlans = plans.filter((p): p is MarketplacePlan => p !== null);

  if (validPlans.length < 2) {
    throw new BadRequestError('Could not find enough valid plans to compare');
  }

  // Calculate comparison metrics
  const comparison = {
    plans: validPlans,
    summary: {
      cheapest_premium: validPlans.reduce((min, p) =>
        p.premium < min.premium ? p : min
      ),
      lowest_deductible: validPlans.reduce((min, p) =>
        p.deductibles.individual < min.deductibles.individual ? p : min
      ),
      lowest_moop: validPlans.reduce((min, p) =>
        p.moops.individual < min.moops.individual ? p : min
      ),
      highest_quality: validPlans
        .filter(p => p.quality_rating?.global_rating)
        .reduce((max, p) =>
          (p.quality_rating?.global_rating ?? 0) > (max.quality_rating?.global_rating ?? 0) ? p : max
        , validPlans[0]),
    },
    metrics: validPlans.map(plan => ({
      plan_id: plan.id,
      plan_name: plan.name,
      annual_premium: plan.premium * 12,
      deductible: plan.deductibles.individual,
      moop: plan.moops.individual,
      // Estimated total annual cost (premium + deductible)
      // This is a simplified estimate
      estimated_low_use: plan.premium * 12,
      estimated_high_use: plan.premium * 12 + plan.deductibles.individual,
      estimated_worst_case: plan.premium * 12 + plan.moops.individual,
    })),
  };

  logger.info('Marketplace plan comparison', {
    userId: req.user?.id,
    planCount: validPlans.length,
  });

  const response: ApiResponse<typeof comparison> = {
    success: true,
    data: comparison,
  };

  res.json(response);
}

export default {
  getMarketplaceStatus,
  getCounties,
  searchMarketplacePlans,
  getMarketplacePlan,
  compareMarketplacePlans,
};
