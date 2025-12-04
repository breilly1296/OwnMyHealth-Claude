/**
 * DNA/Genetic Data Routes
 *
 * REST API endpoints for managing genetic data from services like 23andMe or AncestryDNA.
 * Input validation with Zod prevents injection (especially rsid validation) and ensures data integrity.
 *
 * Routes:
 * - GET /             - List all DNA uploads for the user
 * - GET /:id          - Get details of a specific DNA upload
 * - GET /:id/variants - Get genetic variants for an upload
 * - GET /:id/traits   - Get genetic traits analysis
 * - POST /upload      - Upload new DNA data file
 * - DELETE /:id       - Delete a DNA upload
 *
 * All routes require authentication. Data is scoped to the authenticated user.
 * DNA data is parsed and analyzed for health-related genetic variants.
 *
 * @module routes/dnaRoutes
 */

import { Router } from 'express';
import multer from 'multer';
import {
  getDNAUploads,
  getDNAUpload,
  getDNAVariants,
  getGeneticTraits,
  uploadDNA,
  deleteDNAUpload,
} from '../controllers/dnaController.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';

const router = Router();

// Configure multer for DNA file uploads (text files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for DNA files (can be large)
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    // Accept txt, csv, and zip files (common DNA export formats)
    const allowedMimes = [
      'text/plain',
      'text/csv',
      'application/octet-stream', // Sometimes .txt files come as this
      'application/zip',
    ];
    const allowedExtensions = ['.txt', '.csv', '.zip'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .txt, .csv, or .zip DNA files are accepted'));
    }
  },
});

// All DNA routes require authentication
router.use(authenticate);

// Get all DNA uploads
router.get('/', asyncHandler(getDNAUploads));

// Upload DNA file (MUST be before /:id to avoid 'upload' being captured as ID)
router.post(
  '/upload',
  upload.single('file'),
  asyncHandler(uploadDNA)
);

// Get single DNA upload
router.get(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(getDNAUpload)
);

// Get variants for a DNA upload (with rsid validation to prevent injection)
router.get(
  '/:id/variants',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.dna.variantQuery, 'query'),
  asyncHandler(getDNAVariants)
);

// Get genetic traits for a DNA upload
router.get(
  '/:id/traits',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.dna.traitQuery, 'query'),
  asyncHandler(getGeneticTraits)
);

// Delete DNA upload
router.delete(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(deleteDNAUpload)
);

export default router;
