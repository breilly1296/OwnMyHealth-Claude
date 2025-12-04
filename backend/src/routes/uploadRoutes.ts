/**
 * Upload Routes
 *
 * Handles file upload endpoints for lab reports and insurance documents.
 * Uses multer for multipart form data handling.
 *
 * Routes:
 * - POST /lab-report - Upload and parse lab report PDF
 * - POST /insurance-sbc - Upload and parse insurance SBC PDF (also available at /api/v1/insurance/upload-sbc)
 *
 * @module routes/uploadRoutes
 */

import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadLabReport, uploadSBC } from '../controllers/uploadController.js';

const router = Router();

// Configure multer for memory storage (files stored in buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1, // Only allow single file upload
  },
  fileFilter: (_req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

/**
 * POST /api/v1/upload/lab-report
 * Upload and parse a lab report PDF
 *
 * Request: multipart/form-data with 'file' field containing PDF
 * Response: Created biomarkers and extraction metadata
 */
router.post(
  '/lab-report',
  authenticate,
  upload.single('file'),
  asyncHandler(uploadLabReport)
);

/**
 * POST /api/v1/upload/insurance-sbc
 * Upload and parse an insurance SBC (Summary of Benefits and Coverage) PDF
 *
 * Request: multipart/form-data with 'file' field containing PDF
 * Response: Created insurance plan and extraction metadata
 */
router.post(
  '/insurance-sbc',
  authenticate,
  upload.single('file'),
  asyncHandler(uploadSBC)
);

export default router;
