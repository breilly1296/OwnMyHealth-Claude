/**
 * CMS API Test Routes
 *
 * Endpoint for testing CMS Marketplace API key configuration.
 * This route does NOT require authentication - it's used to verify
 * the API key is properly configured on deployment.
 *
 * Routes:
 * - GET /test - Test CMS API key validity and connectivity
 *
 * @module routes/cmsRoutes
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as marketplaceController from '../controllers/marketplaceController.js';

const router = Router();

// ============================================
// No authentication required for test endpoint
// ============================================

// GET /api/v1/cms/test - Test CMS API key configuration
router.get(
  '/test',
  asyncHandler(marketplaceController.testCMSApiKey)
);

export default router;
