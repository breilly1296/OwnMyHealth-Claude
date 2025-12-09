/**
 * API Routes Index
 *
 * Central routing configuration that mounts all API endpoint modules.
 * All routes are prefixed with /api/v1/ (configured in app.ts).
 *
 * Route Modules:
 * - /auth         - Authentication (login, register, logout, tokens)
 * - /biomarkers   - Health biomarker CRUD operations
 * - /insurance    - Insurance plan management
 * - /health       - Health analysis and scoring
 * - /dna          - Genetic data management
 * - /health-needs - Health needs tracking
 * - /health-goals - Health goal setting and progress tracking
 * - /provider     - Provider-specific routes (PROVIDER/ADMIN role)
 * - /patient      - Patient consent management (PATIENT role)
 * - /admin        - Administrative functions (ADMIN role)
 *
 * @module routes/index
 */

import { Router, Request, Response } from 'express';
import authRoutes from './authRoutes.js';
import biomarkerRoutes from './biomarkerRoutes.js';
import insuranceRoutes from './insuranceRoutes.js';
import healthRoutes from './healthRoutes.js';
import dnaRoutes from './dnaRoutes.js';
import healthNeedsRoutes from './healthNeedsRoutes.js';
import healthGoalsRoutes from './healthGoalsRoutes.js';
import providerRoutes from './providerRoutes.js';
import patientRoutes from './patientRoutes.js';
import adminRoutes from './adminRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import marketplaceRoutes from './marketplaceRoutes.js';
import type { ApiResponse } from '../types/index.js';

const router = Router();

// API Health check
router.get('/health', (_req: Request, res: Response) => {
  const response: ApiResponse<{ status: string; timestamp: string }> = {
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    },
  };
  res.json(response);
});

// API Info
router.get('/', (_req: Request, res: Response) => {
  const response: ApiResponse<{ version: string; endpoints: string[] }> = {
    success: true,
    data: {
      version: 'v1',
      endpoints: [
        '/api/v1/auth',
        '/api/v1/biomarkers',
        '/api/v1/insurance',
        '/api/v1/health',
        '/api/v1/dna',
        '/api/v1/health-needs',
        '/api/v1/health-goals',
        '/api/v1/provider',
        '/api/v1/patient',
        '/api/v1/admin',
        '/api/v1/upload',
        '/api/v1/marketplace',
      ],
    },
  };
  res.json(response);
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/biomarkers', biomarkerRoutes);
router.use('/insurance', insuranceRoutes);
router.use('/health', healthRoutes);
router.use('/dna', dnaRoutes);
router.use('/health-needs', healthNeedsRoutes);
router.use('/health-goals', healthGoalsRoutes);

// Role-specific routes
router.use('/provider', providerRoutes);  // Provider-only routes
router.use('/patient', patientRoutes);    // Patient consent management
router.use('/admin', adminRoutes);        // Admin-only routes

// File upload routes
router.use('/upload', uploadRoutes);      // PDF upload and parsing

// Healthcare.gov Marketplace routes
router.use('/marketplace', marketplaceRoutes);  // ACA plan search

export default router;
