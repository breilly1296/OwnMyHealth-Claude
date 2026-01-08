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

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as settingsController from '../controllers/settingsController.js';

const router = Router();

// Debug logging for settings routes
router.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[SETTINGS ROUTE] ${req.method} ${req.path}`);
  console.log(`[SETTINGS ROUTE] Headers: x-csrf-token=${req.headers['x-csrf-token'] ? 'present' : 'missing'}, authorization=${req.headers['authorization'] ? 'present' : 'missing'}`);
  next();
});

// All routes require authentication
router.use(authenticate);

// GET /api/v1/settings/export-data - Export all user data
router.get(
  '/export-data',
  asyncHandler(settingsController.exportUserData)
);

// DELETE /api/v1/settings/delete-data - Delete all health data
router.delete(
  '/delete-data',
  (req: Request, _res: Response, next: NextFunction) => {
    console.log('[DELETE-DATA] Handler reached after auth');
    console.log('[DELETE-DATA] User ID:', (req as any).user?.id);
    next();
  },
  asyncHandler(settingsController.deleteAllData)
);

// DELETE /api/v1/settings/delete-account - Delete account
router.delete(
  '/delete-account',
  asyncHandler(settingsController.deleteAccount)
);

export default router;
