/**
 * Marketplace Routes
 *
 * API routes for Healthcare.gov marketplace plan search and comparison.
 *
 * All routes require authentication.
 *
 * @module routes/marketplaceRoutes
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  getMarketplaceStatus,
  getCounties,
  searchMarketplacePlans,
  getMarketplacePlan,
  compareMarketplacePlans,
} from '../controllers/marketplaceController.js';

const router = Router();

/**
 * @route GET /api/v1/marketplace/status
 * @desc Check if Healthcare.gov API is configured
 * @access Private
 */
router.get('/status', asyncHandler(getMarketplaceStatus));

/**
 * @route GET /api/v1/marketplace/counties/:zipcode
 * @desc Get counties for a zipcode (needed for plan search)
 * @access Private
 * @param {string} zipcode - 5-digit US zipcode
 */
router.get('/counties/:zipcode', asyncHandler(getCounties));

/**
 * @route POST /api/v1/marketplace/plans/search
 * @desc Search for marketplace plans
 * @access Private
 * @body {
 *   zipcode: string,
 *   household: {
 *     income: number,
 *     people: [{ age: number, uses_tobacco?: boolean }]
 *   },
 *   filter?: {
 *     plan_types?: string[],
 *     metal_levels?: string[],
 *     premium_range?: { min?: number, max?: number }
 *   }
 * }
 */
router.post('/plans/search', asyncHandler(searchMarketplacePlans));

/**
 * @route GET /api/v1/marketplace/plans/:planId
 * @desc Get detailed plan information
 * @access Private
 * @param {string} planId - Healthcare.gov plan ID
 * @query {number} year - Optional plan year
 */
router.get('/plans/:planId', asyncHandler(getMarketplacePlan));

/**
 * @route POST /api/v1/marketplace/plans/compare
 * @desc Compare multiple marketplace plans
 * @access Private
 * @body {
 *   planIds: string[],  // 2-4 plan IDs
 *   year?: number
 * }
 */
router.post('/plans/compare', asyncHandler(compareMarketplacePlans));

export default router;
