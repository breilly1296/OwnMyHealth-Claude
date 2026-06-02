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
import { normalizePlan, type PlanLimits, type PlanTier } from '../config/plans.js';
import { withRLSContext } from '../services/database.js';
import { logger } from '../utils/logger.js';

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

    // Read plan from the DB rather than the JWT payload. The JWT carries a
    // snapshot at issue time and can be up to 15 min stale after an admin
    // plan change — a downgrade from PRO→FREE would leave premium access open
    // for the life of the access token. Fresh DB read closes that gap.
    //
    // Also enforce planExpiresAt here: if the subscription expired, fall
    // back to FREE limits. The email scheduler writes planExpiresAt on
    // upgrades but nothing was consuming it at request time — paid plans
    // never actually expired. A runtime downgrade keeps billing honest and
    // tolerates missed cron runs.
    let effectivePlan: PlanTier;
    try {
      // C-8 — user-scoped lookup must run under RLS context. A bare prisma
      // call would hit a pooled connection without SET LOCAL app.current_user_id,
      // so under the NOBYPASSRLS role it would return no rows (the user sees
      // nothing, not even their own plan) and every gated request would wedge.
      const userRow = await withRLSContext(userId, async (tx) => {
        return tx.user.findUnique({
          where: { id: userId },
          select: { plan: true, planExpiresAt: true },
        });
      });
      effectivePlan = normalizePlan(userRow?.plan);
      if (userRow?.planExpiresAt && userRow.planExpiresAt.getTime() < Date.now()) {
        effectivePlan = 'FREE';
      }
    } catch (err) {
      // DB unreachable — fail CLOSED to FREE rather than trusting the JWT.
      // The JWT plan is a stale, more-permissive snapshot that also lacks the
      // request-time planExpiresAt downgrade, so falling back to it would let a
      // transient DB outage reopen premium access (or already-expired access)
      // for the life of the access token. FREE limits keep the gate honest;
      // legitimate paid users get a degraded-but-safe experience until the DB
      // recovers. Log so the signal shows up in ops dashboards.
      logger.warn('Plan lookup failed; failing closed to FREE limits', {
        data: { userId, error: err instanceof Error ? err.message : 'Unknown' },
      });
      effectivePlan = 'FREE';
    }

    try {
      // KNOWN RACE (TOCTOU) — checkPlanLimit reads the current usage count and
      // returns allowed/denied, but the actual usage row is written later by the
      // route handler (not under a lock that spans this gate and that write).
      // Concurrent requests for the same user can therefore each pass the gate
      // and collectively overshoot a finite limit. Fully closing this requires an
      // atomic reservation in the same transaction as the usage write — see the
      // detailed note in usageTracker.checkPlanLimit. Tracked, not fixed here.
      const check = await checkPlanLimit(userId, effectivePlan, limitKey);

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
