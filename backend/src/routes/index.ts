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
import healthNeedsRoutes from './healthNeedsRoutes.js';
import healthGoalsRoutes from './healthGoalsRoutes.js';
import providerRoutes from './providerRoutes.js';
import patientRoutes from './patientRoutes.js';
import adminRoutes from './adminRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import settingsRoutes from './settingsRoutes.js';
import fileRoutes from './fileRoutes.js';
import expenseRoutes from './expenseRoutes.js';
import aiRoutes from './aiRoutes.js';
import fhirRoutes from './fhirRoutes.js';
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
        '/api/v1/expenses',
        '/api/v1/health-needs',
        '/api/v1/health-goals',
        '/api/v1/provider',
        '/api/v1/patient',
        '/api/v1/admin',
        '/api/v1/upload',
        '/api/v1/files',
        '/api/v1/settings',
        '/api/v1/ai',
      ],
    },
  };
  res.json(response);
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/biomarkers', biomarkerRoutes);
router.use('/insurance', insuranceRoutes);
router.use('/expenses', expenseRoutes);
router.use('/health-needs', healthNeedsRoutes);
router.use('/health-goals', healthGoalsRoutes);

// Role-specific routes
router.use('/provider', providerRoutes);  // Provider-only routes
router.use('/patient', patientRoutes);    // Patient consent management
router.use('/admin', adminRoutes);        // Admin-only routes

// File upload routes
router.use('/upload', uploadRoutes);      // PDF upload and parsing

// File management routes
router.use('/files', fileRoutes);         // User file management (list, download, delete)

// User settings routes
router.use('/settings', settingsRoutes);  // Data export, account deletion

// AI Health Guide (conversational)
router.use('/ai', aiRoutes);

// FHIR / SMART on FHIR (Quest, Labcorp, etc.)
router.use('/fhir', fhirRoutes);

export default router;
