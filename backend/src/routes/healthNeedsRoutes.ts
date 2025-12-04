/**
 * Health Needs Routes
 *
 * REST API endpoints for managing health needs and action items.
 * Health needs are generated from biomarker analysis and can be tracked.
 * Input validation with Zod ensures data integrity and prevents injection.
 *
 * Routes:
 * - GET /           - List all health needs for the user
 * - GET /analyze    - AI-powered analysis to generate new health needs
 * - GET /:id        - Get a specific health need
 * - POST /          - Create a new health need manually
 * - PATCH /:id      - Update a health need
 * - DELETE /:id     - Delete a health need
 *
 * All routes require authentication. Data is scoped to the authenticated user.
 *
 * @module routes/healthNeedsRoutes
 */

import { Router } from 'express';
import {
  getHealthNeeds,
  getHealthNeed,
  createHealthNeed,
  updateHealthNeedStatus,
  deleteHealthNeed,
  analyzeHealthNeeds,
} from '../controllers/healthNeedsController.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';

const router = Router();

// All health needs routes require authentication
router.use(authenticate);

// Get all health needs
router.get(
  '/',
  validate(schemas.healthNeed.listQuery, 'query'),
  asyncHandler(getHealthNeeds)
);

// Analyze health needs (AI-powered)
router.get('/analyze', asyncHandler(analyzeHealthNeeds));

// Get single health need
router.get(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(getHealthNeed)
);

// Create health need
router.post(
  '/',
  validate(schemas.healthNeed.create),
  asyncHandler(createHealthNeed)
);

// Update health need
router.patch(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.healthNeed.update),
  asyncHandler(updateHealthNeedStatus)
);

// Delete health need
router.delete(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(deleteHealthNeed)
);

export default router;
