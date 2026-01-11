/**
 * expenseRoutes.ts - Expense Tracking & Cost Optimization Routes
 *
 * Routes for managing expense projections, actuals, and cost analyses.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import {
  createProjection,
  getProjections,
  updateProjection,
  deleteProjection,
  analyzeCosts,
  getAnalyses,
} from '../controllers/expenseController.js';

const router = Router();

// All expense routes require authentication
router.use(authenticate);

// ============================================
// EXPENSE PROJECTIONS
// ============================================

// GET /api/expenses/projections?planId=xxx
router.get('/projections', getProjections);

// POST /api/expenses/projections
router.post('/projections', csrfProtection, createProjection);

// PUT /api/expenses/projections/:id
router.put('/projections/:id', csrfProtection, updateProjection);

// DELETE /api/expenses/projections/:id
router.delete('/projections/:id', csrfProtection, deleteProjection);

// ============================================
// COST ANALYSIS
// ============================================

// POST /api/expenses/analyze
router.post('/analyze', csrfProtection, analyzeCosts);

// GET /api/expenses/analyses?planId=xxx
router.get('/analyses', getAnalyses);

// ============================================
// CURRENT SPENDING (added to insuranceRoutes in controller)
// ============================================
// PUT /api/insurance/plans/:id/spending is handled by insuranceRoutes

export default router;
