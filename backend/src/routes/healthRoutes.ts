/**
 * Health Analysis Routes
 *
 * REST API endpoints for comprehensive health analysis and scoring.
 *
 * Routes:
 * - GET /analysis  - Get full health analysis based on biomarkers
 * - GET /needs     - Get identified health needs/action items
 * - GET /providers - Get provider recommendations based on health profile
 * - GET /score     - Get calculated health score
 *
 * All routes require authentication. Analysis is based on user's biomarker data.
 *
 * @module routes/healthRoutes
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as healthController from '../controllers/healthController.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/v1/health/analysis - Get full health analysis
router.get(
  '/analysis',
  asyncHandler(healthController.analyzeHealth)
);

// GET /api/v1/health/needs - Get health needs
router.get(
  '/needs',
  asyncHandler(healthController.getHealthNeeds)
);

// GET /api/v1/health/providers - Get provider recommendations
router.get(
  '/providers',
  asyncHandler(healthController.getProviderRecommendations)
);

// GET /api/v1/health/score - Get health score
router.get(
  '/score',
  asyncHandler(healthController.getHealthScore)
);

export default router;
