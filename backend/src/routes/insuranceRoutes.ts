/**
 * Insurance Routes
 *
 * REST API endpoints for managing insurance plans and coverage analysis.
 * Input validation with Zod ensures data integrity and prevents injection.
 *
 * Routes:
 * - GET /plans          - List all user's insurance plans
 * - GET /plans/:id      - Get a single insurance plan
 * - POST /plans         - Create a new insurance plan (from SBC upload)
 * - PATCH /plans/:id    - Update an existing plan
 * - DELETE /plans/:id   - Delete a plan
 * - POST /compare       - Compare multiple plans side-by-side
 * - GET /benefits/search - Search for specific benefits across plans
 *
 * All routes require authentication. Data is scoped to the authenticated user.
 *
 * @module routes/insuranceRoutes
 */

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as insuranceController from '../controllers/insuranceController.js';
import { uploadSBC } from '../controllers/uploadController.js';

const router = Router();

// Configure multer for SBC uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

// Additional schemas for insurance-specific operations
const compareSchema = z.object({
  planIds: z.array(z.string().uuid('Invalid plan ID')).min(2, 'At least 2 plans required for comparison').max(5, 'Maximum 5 plans for comparison'),
});

const benefitSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required').max(200),
  planId: z.string().uuid('Invalid plan ID').optional(),
});

// All routes require authentication
router.use(authenticate);

// GET /api/v1/insurance/plans - Get all plans
router.get(
  '/plans',
  asyncHandler(insuranceController.getInsurancePlans)
);

// GET /api/v1/insurance/plans/:id - Get single plan
router.get(
  '/plans/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(insuranceController.getInsurancePlan)
);

// POST /api/v1/insurance/plans - Create plan
router.post(
  '/plans',
  validate(schemas.insurancePlan.create),
  asyncHandler(insuranceController.createInsurancePlan)
);

// PATCH /api/v1/insurance/plans/:id - Update plan
router.patch(
  '/plans/:id',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.insurancePlan.update),
  asyncHandler(insuranceController.updateInsurancePlan)
);

// DELETE /api/v1/insurance/plans/:id - Delete plan
router.delete(
  '/plans/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(insuranceController.deleteInsurancePlan)
);

// POST /api/v1/insurance/compare - Compare plans
router.post(
  '/compare',
  validate(compareSchema),
  asyncHandler(insuranceController.comparePlans)
);

// GET /api/v1/insurance/benefits/search - Search benefits
router.get(
  '/benefits/search',
  validate(benefitSearchSchema, 'query'),
  asyncHandler(insuranceController.searchBenefits)
);

// POST /api/v1/insurance/upload-sbc - Upload and parse SBC PDF
router.post(
  '/upload-sbc',
  upload.single('file'),
  asyncHandler(uploadSBC)
);

export default router;
