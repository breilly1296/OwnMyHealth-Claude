/**
 * Marketplace Routes
 *
 * REST API endpoints for CMS Marketplace (Healthcare.gov) integration.
 * Provides coverage lookup and provider search functionality.
 *
 * Routes:
 * - GET /plans/:planId           - Get detailed plan information
 * - GET /plans/:planId/benefits  - Get plan benefits breakdown
 * - GET /providers               - Search for providers by location
 * - GET /providers/:npi          - Get provider details by NPI
 * - GET /providers/:npi/network-check - Check if provider is in-network
 * - GET /health                  - Check CMS API health status
 *
 * All routes require authentication.
 *
 * @module routes/marketplaceRoutes
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as marketplaceController from '../controllers/marketplaceController.js';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const planIdParamSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
});

const yearQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/, 'Year must be 4 digits').optional(),
});

const npiParamSchema = z.object({
  npi: z.string().regex(/^\d{10}$/, 'NPI must be 10 digits'),
});

const providerSearchSchema = z.object({
  zipcode: z.string().regex(/^\d{5}$/, 'Zipcode must be 5 digits'),
  planId: z.string().optional(),
  specialty: z.string().max(100).optional(),
  type: z.enum(['individual', 'facility']).optional(),
  radius: z.string().regex(/^\d+$/).transform(Number).pipe(
    z.number().min(1).max(100)
  ).optional(),
  page: z.string().regex(/^\d+$/).transform(Number).pipe(
    z.number().min(1)
  ).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(
    z.number().min(1).max(100)
  ).optional(),
});

const networkCheckSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
});

// ============================================
// All routes require authentication
// ============================================

router.use(authenticate);

// ============================================
// Coverage Lookup Routes
// ============================================

// GET /api/v1/marketplace/plans/:planId - Get plan details
router.get(
  '/plans/:planId',
  validate(planIdParamSchema, 'params'),
  validate(yearQuerySchema, 'query'),
  asyncHandler(marketplaceController.getPlanDetails)
);

// GET /api/v1/marketplace/plans/:planId/benefits - Get plan benefits
router.get(
  '/plans/:planId/benefits',
  validate(planIdParamSchema, 'params'),
  validate(yearQuerySchema, 'query'),
  asyncHandler(marketplaceController.getPlanBenefits)
);

// ============================================
// Provider Search Routes
// ============================================

// GET /api/v1/marketplace/providers - Search providers
router.get(
  '/providers',
  validate(providerSearchSchema, 'query'),
  asyncHandler(marketplaceController.searchProviders)
);

// GET /api/v1/marketplace/providers/:npi - Get provider by NPI
router.get(
  '/providers/:npi',
  validate(npiParamSchema, 'params'),
  asyncHandler(marketplaceController.getProviderDetails)
);

// GET /api/v1/marketplace/providers/:npi/network-check - Check network status
router.get(
  '/providers/:npi/network-check',
  validate(npiParamSchema, 'params'),
  validate(networkCheckSchema, 'query'),
  asyncHandler(marketplaceController.checkProviderNetwork)
);

// ============================================
// Health Check Route
// ============================================

// GET /api/v1/marketplace/health - Check CMS API status
router.get(
  '/health',
  asyncHandler(marketplaceController.healthCheck)
);

export default router;
