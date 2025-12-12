/**
 * Marketplace Routes
 *
 * API endpoints for CMS Healthcare.gov Marketplace integration.
 * Provides plan search, comparison, and coverage verification.
 *
 * Routes:
 * - GET  /counties/:zipcode           - Get county/FIPS by ZIP code
 * - POST /plans/search                - Search marketplace plans
 * - GET  /plans/:planId               - Get plan details
 * - POST /plans/:planId/premium       - Estimate premium with APTC
 * - GET  /plans/:planId/providers/:id - Check provider network
 * - GET  /plans/:planId/drugs/:rxcui  - Check drug coverage
 * - POST /plans/compare               - Compare multiple plans
 * - GET  /issuers                     - Get available issuers
 * - GET  /metal-levels                - Get available metal levels
 *
 * @module routes/marketplaceRoutes
 */

import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { standardLimiter, sensitiveLimiter } from '../middleware/rateLimiter.js';
import {
  getCountiesByZip,
  searchPlans,
  getPlanDetails,
  estimatePlanPremium,
  checkProviderInNetwork,
  checkDrugCoverage,
  comparePlans,
  getIssuers,
  getMetalLevels,
} from '../controllers/marketplaceController.js';

const router = Router();

// ============================================
// PUBLIC ENDPOINTS (with optional auth for logging)
// ============================================

/**
 * GET /marketplace/counties/:zipcode
 * Get county and FIPS code information for a ZIP code
 *
 * @param zipcode - 5-digit US ZIP code
 * @returns Counties with FIPS codes for the ZIP
 */
router.get(
  '/counties/:zipcode',
  standardLimiter,
  optionalAuth,
  getCountiesByZip
);

/**
 * GET /marketplace/issuers
 * Get available insurance issuers for a state
 *
 * @query state - 2-letter state code (required)
 * @query year - Plan year (optional, defaults to current year)
 * @returns List of issuers in the state
 */
router.get(
  '/issuers',
  standardLimiter,
  optionalAuth,
  getIssuers
);

/**
 * GET /marketplace/metal-levels
 * Get available metal levels for a state
 *
 * @query state - 2-letter state code (required)
 * @query year - Plan year (optional, defaults to current year)
 * @returns Available metal levels (Catastrophic, Bronze, Silver, Gold, Platinum)
 */
router.get(
  '/metal-levels',
  standardLimiter,
  optionalAuth,
  getMetalLevels
);

/**
 * GET /marketplace/plans/:planId
 * Get detailed information about a specific plan
 *
 * @param planId - CMS plan ID
 * @query year - Plan year (optional, defaults to current year)
 * @returns Full plan details including benefits
 */
router.get(
  '/plans/:planId',
  standardLimiter,
  optionalAuth,
  getPlanDetails
);

/**
 * GET /marketplace/plans/:planId/providers/:providerId
 * Check if a provider is in a plan's network
 *
 * @param planId - CMS plan ID
 * @param providerId - NPI or provider ID
 * @returns Network status
 */
router.get(
  '/plans/:planId/providers/:providerId',
  standardLimiter,
  optionalAuth,
  checkProviderInNetwork
);

/**
 * GET /marketplace/plans/:planId/drugs/:rxcui
 * Check if a drug is covered by a plan's formulary
 *
 * @param planId - CMS plan ID
 * @param rxcui - RxNorm Concept Unique Identifier for the drug
 * @returns Coverage status, tier, and restrictions
 */
router.get(
  '/plans/:planId/drugs/:rxcui',
  standardLimiter,
  optionalAuth,
  checkDrugCoverage
);

// ============================================
// AUTHENTICATED ENDPOINTS
// ============================================

/**
 * POST /marketplace/plans/search
 * Search for marketplace health insurance plans
 *
 * @body zipcode - 5-digit ZIP code (required)
 * @body fips - FIPS county code (required)
 * @body state - 2-letter state code (required)
 * @body market - 'Individual' or 'SmallGroup' (default: Individual)
 * @body year - Plan year (default: current year)
 * @body age - Enrollee age(s) (number or array)
 * @body income - Annual household income
 * @body household_size - Number in household
 * @body is_tobacco_user - Tobacco use status (boolean or array)
 * @body metal_levels - Filter by metal level
 * @body plan_types - Filter by plan type (HMO, PPO, etc.)
 * @body issuers - Filter by issuer IDs
 * @body page - Page number (default: 1)
 * @body limit - Results per page (default: 10)
 * @body sort_by - Sort field (premium, deductible, quality_rating)
 * @body sort_order - Sort direction (asc, desc)
 * @returns Paginated plan results with filters
 */
router.post(
  '/plans/search',
  sensitiveLimiter,
  optionalAuth,
  searchPlans
);

/**
 * POST /marketplace/plans/:planId/premium
 * Estimate premium with Advanced Premium Tax Credit (APTC)
 *
 * @param planId - CMS plan ID
 * @body zipcode - 5-digit ZIP code (required)
 * @body fips - FIPS county code (required)
 * @body age - Enrollee age(s) (required)
 * @body income - Annual household income (required)
 * @body household_size - Number in household (required)
 * @body is_tobacco_user - Tobacco use status (optional)
 * @returns Premium estimate with APTC breakdown
 */
router.post(
  '/plans/:planId/premium',
  sensitiveLimiter,
  optionalAuth,
  estimatePlanPremium
);

/**
 * POST /marketplace/plans/compare
 * Compare multiple plans side by side
 *
 * @body plan_ids - Array of 2-4 plan IDs to compare (required)
 * @body year - Plan year (optional, defaults to current year)
 * @returns Plan details with comparison highlights
 */
router.post(
  '/plans/compare',
  standardLimiter,
  optionalAuth,
  comparePlans
);

export default router;
