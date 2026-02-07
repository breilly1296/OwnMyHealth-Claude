/**
 * File Routes
 *
 * REST API endpoints for managing user files (lab reports, documents).
 *
 * Routes:
 * - GET /           - List all files for the user
 * - GET /:id        - Get a single file by ID with signed URL
 * - GET /:id/download - Get a signed download URL for a file
 * - DELETE /:id     - Delete a file
 *
 * All routes require authentication. Data is scoped to the authenticated user.
 *
 * @module routes/fileRoutes
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sensitiveLimiter } from '../middleware/rateLimiter.js';
import * as fileController from '../controllers/fileController.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/v1/files - Get all files for the user
router.get(
  '/',
  asyncHandler(fileController.getFiles)
);

// GET /api/v1/files/:id - Get single file with signed URL
router.get(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(fileController.getFile)
);

// GET /api/v1/files/:id/download - Get signed download URL
router.get(
  '/:id/download',
  sensitiveLimiter,
  validate(schemas.uuidParam, 'params'),
  asyncHandler(fileController.getFileDownloadUrl)
);

// DELETE /api/v1/files/:id - Delete a file
router.delete(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(fileController.deleteFile)
);

export default router;
