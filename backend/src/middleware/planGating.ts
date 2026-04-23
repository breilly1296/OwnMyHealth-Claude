/**
 * Plan Gating Middleware
 *
 * Gates routes behind a user's subscription plan. Must run AFTER `authenticate`
 * — without req.user the check can't resolve, so the middleware bails out and
 * lets the auth layer surface the 401.
 *
 * Response shape: 403 with `code: 'PLAN_LIMIT_EXCEEDED'` and `upgradeRequired:
 * true`. The frontend uses this code to swap the generic error toast for an
 * upgrade CTA.
 */

import { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { checkPlanLimit } from '../services/usageTracker.js';
import { normalizePlan, type PlanLimits } from '../config/plans.js';

type PlanLimitErrorBody = ApiResponse & {
  error: {
    code: 'PLAN_LIMIT_EXCEEDED';
    message: string;
    limit: number;
    current: number;
    feature: keyof PlanLimits;
    upgradeRequired: true;
  };
};

/**
 * Gate a route behind a specific plan limit (numeric or boolean).
 *
 * Usage:
 *   router.post('/chat', authenticate, requirePlanLimit('aiChatsPerDay'), handler);
 */
export function requirePlanLimit(limitKey: keyof PlanLimits) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    // No user on request — auth middleware wasn't applied, or a future caller
    // used this in an unauthenticated context. Let the downstream layer decide
    // what to do; we shouldn't 401 here and mask routing bugs.
    if (!userId) {
      next();
      return;
    }

    const plan = normalizePlan(authReq.user?.plan);

    try {
      const check = await checkPlanLimit(userId, plan, limitKey);

      if (!check.allowed) {
        const body: PlanLimitErrorBody = {
          success: false,
          error: {
            code: 'PLAN_LIMIT_EXCEEDED',
            message:
              check.limit > 0
                ? `You've reached your plan limit (${check.current}/${check.limit}). Upgrade to continue.`
                : 'This feature is not available on your current plan. Upgrade to access it.',
            limit: check.limit,
            current: check.current,
            feature: limitKey,
            upgradeRequired: true,
          },
        };
        res.status(403).json(body);
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Convenience alias for boolean feature flags. Same semantics as
 * requirePlanLimit — kept as a distinct name so routes read more clearly when
 * the gated thing is a feature (healthProfile) rather than a rate (aiChatsPerDay).
 */
export function requirePlanFeature(feature: keyof PlanLimits) {
  return requirePlanLimit(feature);
}
