/**
 * Health Goals Routes
 *
 * REST API endpoints for managing health goals and tracking progress.
 * Goals support progress tracking, milestones, and reminders.
 * Input validation with Zod ensures data integrity and prevents injection.
 *
 * Routes:
 * - GET /              - List all health goals for the user
 * - GET /summary       - Get goals summary statistics
 * - GET /suggestions   - Get AI-suggested goals based on biomarkers
 * - GET /:id           - Get a specific health goal with progress history
 * - POST /             - Create a new health goal
 * - PUT /:id           - Update a health goal
 * - PATCH /:id/progress - Update progress on a goal
 * - DELETE /:id        - Delete a health goal
 *
 * All routes require authentication. Data is scoped to the authenticated user.
 *
 * @module routes/healthGoalsRoutes
 */

import { Router } from 'express';
import {
  getHealthGoals,
  getHealthGoal,
  createHealthGoal,
  updateHealthGoal,
  updateGoalProgress,
  deleteHealthGoal,
  getGoalsSummary,
  suggestGoals,
} from '../controllers/healthGoalsController.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';

const router = Router();

// All health goals routes require authentication
router.use(authenticate);

// Get goals summary
router.get('/summary', asyncHandler(getGoalsSummary));

// Get goal suggestions based on biomarkers
router.get('/suggestions', asyncHandler(suggestGoals));

// Get all health goals
router.get(
  '/',
  validate(schemas.healthGoal.listQuery, 'query'),
  asyncHandler(getHealthGoals)
);

// Get single health goal
router.get(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(getHealthGoal)
);

// Create health goal
router.post(
  '/',
  validate(schemas.healthGoal.create),
  asyncHandler(createHealthGoal)
);

// Update health goal
router.put(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.healthGoal.update),
  asyncHandler(updateHealthGoal)
);

// Update goal progress
router.patch(
  '/:id/progress',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.healthGoal.updateProgress),
  asyncHandler(updateGoalProgress)
);

// Delete health goal
router.delete(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(deleteHealthGoal)
);

export default router;
