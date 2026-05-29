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
import { asyncHandler, BadRequestError } from '../middleware/errorHandler.js';
import { uploadLimiter, aiLimiter } from '../middleware/rateLimiter.js';
import { blockDemoAI } from '../middleware/demoProtection.js';
import { requirePlanLimit } from '../middleware/planGating.js';
import { uploadLabReport, uploadSBC, uploadLabResultOCR } from '../controllers/upload/index.js';

const router = Router();

// Apply upload rate limiting to all upload routes (20 uploads/hour)
router.use(uploadLimiter);

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
      cb(new BadRequestError('Only PDF files are accepted'));
    }
  },
});

// Configure multer for OCR uploads (PDFs and images)
const uploadOCR = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1, // Only allow single file upload
  },
  fileFilter: (_req, file, cb) => {
    // Accept PDF and image files for OCR
    const allowedTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/tiff',
      'image/gif',
      'image/webp',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestError('Only PDF and image files (PNG, JPG, TIFF) are accepted'));
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
  aiLimiter,
  blockDemoAI,
  requirePlanLimit('pdfUploadsPerMonth'),
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
  aiLimiter,
  blockDemoAI,
  requirePlanLimit('pdfUploadsPerMonth'),
  upload.single('file'),
  asyncHandler(uploadSBC)
);

/**
 * POST /api/v1/upload/lab-results-ocr
 * Upload and process a lab result using OCR (Google Document AI)
 *
 * Request: multipart/form-data with 'file' field containing PDF or image (PNG, JPG, TIFF)
 * Response: Created biomarkers and OCR extraction metadata
 *
 * Supported formats:
 * - PDF files
 * - PNG images
 * - JPEG images
 * - TIFF images
 *
 * Extracts bone health biomarkers:
 * - Calcium
 * - Vitamin D
 * - PTH (Parathyroid Hormone)
 * - Phosphorus
 * - Alkaline Phosphatase
 */
router.post(
  '/lab-results-ocr',
  authenticate,
  aiLimiter,
  blockDemoAI,
  requirePlanLimit('pdfUploadsPerMonth'),
  uploadOCR.single('file'),
  asyncHandler(uploadLabResultOCR)
);

export default router;
