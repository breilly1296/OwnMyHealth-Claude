/**
 * expenseRoutes.ts - Expense Tracking & Cost Optimization Routes
 *
 * Routes for managing expense projections, actuals, and cost analyses.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { blockDemoAI } from '../middleware/demoProtection.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
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
router.get(
  '/projections',
  validate(schemas.expense.projectionsQuery, 'query'),
  asyncHandler(getProjections)
);

// POST /api/expenses/projections
router.post(
  '/projections',
  csrfProtection,
  validate(schemas.expense.createProjection),
  asyncHandler(createProjection)
);

// PUT /api/expenses/projections/:id
router.put(
  '/projections/:id',
  csrfProtection,
  validate(schemas.uuidParam, 'params'),
  validate(schemas.expense.updateProjection),
  asyncHandler(updateProjection)
);

// DELETE /api/expenses/projections/:id
router.delete(
  '/projections/:id',
  csrfProtection,
  validate(schemas.uuidParam, 'params'),
  asyncHandler(deleteProjection)
);

// ============================================
// COST ANALYSIS
// ============================================

// POST /api/expenses/analyze
router.post(
  '/analyze',
  aiLimiter,
  blockDemoAI,
  csrfProtection,
  validate(schemas.expense.analyzeCosts),
  asyncHandler(analyzeCosts)
);

// GET /api/expenses/analyses?planId=xxx
router.get(
  '/analyses',
  validate(schemas.expense.analysesQuery, 'query'),
  asyncHandler(getAnalyses)
);

// ============================================
// CURRENT SPENDING (added to insuranceRoutes in controller)
// ============================================
// PUT /api/insurance/plans/:id/spending is handled by insuranceRoutes

export default router;
