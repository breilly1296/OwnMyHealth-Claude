/**
 * Plan Routes
 *
 * Subscription-tier introspection endpoints.
 *
 *   GET /api/v1/plan            → authenticated user's tier, limits, usage
 *   GET /api/v1/plan/available  → public catalog of all plans (no auth)
 *
 * No billing here. Plan assignment is manual today (admin PATCH) and will be
 * driven by Stripe webhooks later — both paths update the same `users.plan`
 * column, so this endpoint keeps working unchanged.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPrismaClient, withRLSContext } from '../services/database.js';
import { getUserUsage } from '../services/usageTracker.js';
import {
  PLANS,
  getPlanConfig,
  normalizePlan,
  type PlanTier,
} from '../config/plans.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';

const router = Router();

// ============================================
// GET /api/v1/plan/available  — PUBLIC (pricing page can load without auth)
// ============================================
router.get(
  '/available',
  asyncHandler(async (_req: Request, res: Response) => {
    // Serialize in a stable order so the frontend's card layout is
    // deterministic. Object.values preserves insertion order for string keys,
    // but the explicit list is clearer than relying on that.
    const order: PlanTier[] = ['FREE', 'PRO', 'TEAM'];
    const plans = order.map((tier) => PLANS[tier]);

    const response: ApiResponse<{ plans: typeof plans }> = {
      success: true,
      data: { plans },
    };
    res.json(response);
  })
);

// ============================================
// GET /api/v1/plan  — authenticated user's plan + current usage
// ============================================
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;

    // Read the plan fields from the DB rather than trusting req.user.plan —
    // the JWT may be up to 15 min stale, and an admin plan change should be
    // visible immediately on the settings page.
    const prisma = getPrismaClient();
    void prisma;

    const row = await withRLSContext(userId, async (tx) => {
      return tx.user.findUnique({
        where: { id: userId },
        select: { plan: true, planExpiresAt: true, planUpdatedAt: true },
      });
    });

    // Report the EFFECTIVE (post-expiry) tier so the UI matches what
    // requirePlanLimit actually enforces. The stored plan column is the
    // billing/subscription tier, but a lapsed planExpiresAt downgrades
    // enforcement to FREE at request time (see planGating.ts). If we reported
    // the stored tier's limits here, the settings page would advertise PRO
    // limits while gated routes were already rejecting requests as FREE.
    const storedTier = normalizePlan(row?.plan);
    const expired =
      row?.planExpiresAt != null && row.planExpiresAt.getTime() < Date.now();
    const tier: PlanTier = expired ? 'FREE' : storedTier;
    const config = getPlanConfig(tier);
    const usage = await getUserUsage(userId);

    const data = {
      currentPlan: tier,
      planName: config.name,
      expiresAt: row?.planExpiresAt ?? null,
      updatedAt: row?.planUpdatedAt ?? null,
      usage,
      limits: config.limits,
      upgradeAvailable: tier !== 'TEAM',
    };

    const response: ApiResponse<typeof data> = {
      success: true,
      data,
    };
    res.json(response);
  })
);

export default router;
