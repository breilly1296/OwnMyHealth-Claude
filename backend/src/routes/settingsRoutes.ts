/**
 * Settings Routes
 *
 * REST API endpoints for user settings management.
 *
 * Routes:
 * - GET /export-data     - Export all user data as JSON
 * - DELETE /delete-data  - Delete all health data (keeps account)
 * - DELETE /delete-account - Delete account and all data
 *
 * All routes require authentication.
 *
 * @module routes/settingsRoutes
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sensitiveLimiter } from '../middleware/rateLimiter.js';
import * as settingsController from '../controllers/settingsController.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/v1/settings/export-data - Export all user data
router.get(
  '/export-data',
  sensitiveLimiter,
  asyncHandler(settingsController.exportUserData)
);

// DELETE /api/v1/settings/delete-data - Delete all health data
router.delete(
  '/delete-data',
  sensitiveLimiter,
  asyncHandler(settingsController.deleteAllData)
);

// DELETE /api/v1/settings/delete-account - Delete account
router.delete(
  '/delete-account',
  sensitiveLimiter,
  asyncHandler(settingsController.deleteAccount)
);

export default router;
