/**
 * Settings Routes
 *
 * REST API endpoints for user settings management.
 *
 * Routes:
 * - GET    /profile         - Fetch decrypted profile + notification prefs
 * - PATCH  /profile         - Update first/last name (encrypted)
 * - PATCH  /notifications   - Update notification preferences
 * - GET    /export-data     - Export all user data as JSON
 * - DELETE /delete-data     - Delete all health data (keeps account)
 * - DELETE /delete-account  - Delete account and all data
 *
 * All routes require authentication.
 *
 * @module routes/settingsRoutes
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sensitiveLimiter } from '../middleware/rateLimiter.js';
import { blockDemoProfileUpdate } from '../middleware/demoProtection.js';
import { requirePlanFeature } from '../middleware/planGating.js';
import { validate, schemas } from '../middleware/validation.js';
import * as settingsController from '../controllers/settingsController.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/v1/settings/profile - Fetch decrypted profile
router.get(
  '/profile',
  sensitiveLimiter,
  asyncHandler(settingsController.getProfile)
);

// PATCH /api/v1/settings/profile - Update first/last name
router.patch(
  '/profile',
  sensitiveLimiter,
  blockDemoProfileUpdate,
  validate(schemas.settings.updateProfile),
  asyncHandler(settingsController.updateProfile)
);

// GET /api/v1/settings/notifications - Fetch notification preferences
router.get(
  '/notifications',
  sensitiveLimiter,
  asyncHandler(settingsController.getNotifications)
);

// PATCH /api/v1/settings/notifications - Update notification preferences
router.patch(
  '/notifications',
  sensitiveLimiter,
  blockDemoProfileUpdate,
  validate(schemas.settings.updateNotifications),
  asyncHandler(settingsController.updateNotifications)
);

// GET /api/v1/settings/health-profile - Fetch self-reported health profile
router.get(
  '/health-profile',
  sensitiveLimiter,
  asyncHandler(settingsController.getHealthProfile)
);

// PATCH /api/v1/settings/health-profile - Partial update of health profile
// Gated behind the healthProfile plan feature (FREE can't write; PRO/TEAM can).
// GET remains ungated so a downgraded user can still see (and export) what
// they've already saved.
router.patch(
  '/health-profile',
  sensitiveLimiter,
  blockDemoProfileUpdate,
  requirePlanFeature('healthProfile'),
  validate(schemas.settings.updateHealthProfile),
  asyncHandler(settingsController.updateHealthProfile)
);

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
  validate(schemas.settings.deleteData),
  asyncHandler(settingsController.deleteAllData)
);

// DELETE /api/v1/settings/delete-account - Delete account
router.delete(
  '/delete-account',
  sensitiveLimiter,
  asyncHandler(settingsController.deleteAccount)
);

export default router;
