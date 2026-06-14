/**
 * Onboarding Routes
 *
 *   GET  /api/v1/onboarding/status    — step completion + suggested next step
 *   POST /api/v1/onboarding/complete  — mark the wizard as finished
 *
 * Both require authentication. GET /status is a pure read: it reports
 * completed:true for a user who already has data (so the wizard never ambushes
 * a long-time user) WITHOUT writing — the durable `onboardingCompletedAt` stamp
 * is persisted only by the CSRF-protected POST /complete. (Stamping inside the
 * GET would be a CSRF-exempt, non-idempotent write on a safe method.)
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { completeOnboarding, getOnboardingStatus } from '../services/onboardingService.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';

const router = Router();

router.use(authenticate);

router.get(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user!.id;
    const status = await getOnboardingStatus(userId);
    const response: ApiResponse<typeof status> = { success: true, data: status };
    res.json(response);
  })
);

router.post(
  '/complete',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user!.id;
    const completedAt = await completeOnboarding(userId);
    const response: ApiResponse<{ completed: true; completedAt: string }> = {
      success: true,
      data: { completed: true, completedAt: completedAt.toISOString() },
    };
    res.json(response);
  })
);

export default router;
