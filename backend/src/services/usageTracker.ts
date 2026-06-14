/**
 * Usage Tracker
 *
 * Counts the usage-relevant facts per user so plan limits can be enforced at
 * request time. All reads run inside withRLSContext so the policy-enforced
 * view of data is what gets counted — a user can never be blocked or
 * under-counted by data they can't see.
 *
 * Resource-type strings here must stay in sync with the controllers that
 * write the corresponding audit rows (see aiChatController, biomarkerRoutes).
 */

import { withRLSContext } from './database.js';
import type { Prisma } from '../../generated/prisma/index.js';
import {
  getPlanLimits,
  isUnlimited,
  normalizePlan,
  type PlanLimits,
  type PlanTier,
} from '../config/plans.js';

export interface UsageCount {
  aiChatsToday: number;
  pdfUploadsThisMonth: number;
  totalBiomarkers: number;
  activeInsurancePlans: number;
  aiGuidanceToday: number;
  costAnalysesThisMonth: number;
}

export interface PlanLimitCheck {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
}

// Audit resourceType strings — grep in controllers to verify.
const RESOURCE_HEALTH_GUIDE = 'HealthGuide';
const RESOURCE_BIOMARKER_GUIDANCE = 'biomarker_ai_guidance';

function startOfTodayUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfMonthUTC(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Resolve a user's EFFECTIVE plan tier inside an existing RLS transaction — the
 * same way `requirePlanLimit` does (fresh DB plan + a request-time
 * `planExpiresAt` downgrade to FREE), but reusing the caller's `tx` so the plan
 * read is atomic with whatever quota check/write the caller performs in the same
 * transaction. Used by the non-middleware enforcement sites (the OCR biomarker
 * insert site for M12, and the insurance-plan activation gate for M13) so they
 * apply identical effective-plan semantics to the middleware. Mirrors
 * planGating.ts:60-75.
 *
 * Unlike the middleware it does NOT catch→FREE on a DB error: a failed read here
 * aborts the caller's transaction, which is the correct fail-closed outcome (no
 * row is created/activated).
 */
export async function resolveEffectivePlan(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<PlanTier> {
  const userRow = await tx.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
  let effectivePlan = normalizePlan(userRow?.plan);
  if (userRow?.planExpiresAt && userRow.planExpiresAt.getTime() < Date.now()) {
    effectivePlan = 'FREE';
  }
  return effectivePlan;
}

/**
 * Fetch all usage counters for a user. One RLS-wrapped transaction so the
 * numbers are mutually consistent (no interleaved writes between queries).
 */
export async function getUserUsage(userId: string): Promise<UsageCount> {
  const today = startOfTodayUTC();
  const monthStart = startOfMonthUTC();

  return withRLSContext(userId, async (tx) => {
    const [
      aiChatsToday,
      pdfUploadsThisMonth,
      totalBiomarkers,
      activeInsurancePlans,
      aiGuidanceToday,
      costAnalysesThisMonth,
    ] = await Promise.all([
      tx.auditLog.count({
        where: {
          userId,
          resourceType: RESOURCE_HEALTH_GUIDE,
          action: 'READ',
          createdAt: { gte: today },
        },
      }),
      tx.userFile.count({
        where: { userId, createdAt: { gte: monthStart } },
      }),
      tx.biomarker.count({ where: { userId } }),
      tx.insurancePlan.count({
        where: { userId, isActive: true },
      }),
      tx.auditLog.count({
        where: {
          userId,
          resourceType: RESOURCE_BIOMARKER_GUIDANCE,
          action: 'READ',
          createdAt: { gte: today },
        },
      }),
      tx.costAnalysis.count({
        where: { userId, createdAt: { gte: monthStart } },
      }),
    ]);

    return {
      aiChatsToday,
      pdfUploadsThisMonth,
      totalBiomarkers,
      activeInsurancePlans,
      aiGuidanceToday,
      costAnalysesThisMonth,
    };
  });
}

// Mapping: which usage counter backs each numeric plan limit. Keys must match
// PlanLimits numeric fields exactly. Boolean-limit fields (healthProfile,
// providerSharing, etc.) aren't in this map — they're handled in `checkPlanLimit`.
const NUMERIC_LIMIT_TO_USAGE: Record<string, keyof UsageCount> = {
  aiChatsPerDay: 'aiChatsToday',
  pdfUploadsPerMonth: 'pdfUploadsThisMonth',
  maxBiomarkers: 'totalBiomarkers',
  insurancePlans: 'activeInsurancePlans',
  aiGuidancePerDay: 'aiGuidanceToday',
  costAnalysisPerMonth: 'costAnalysesThisMonth',
};

/**
 * Check whether a user is allowed to perform an action under their current
 * plan. Usage is only read when the limit is a finite number — boolean
 * features and unlimited tiers short-circuit without hitting the DB.
 */
export async function checkPlanLimit(
  userId: string,
  plan: PlanTier,
  action: keyof PlanLimits
): Promise<PlanLimitCheck> {
  const limits = getPlanLimits(plan);
  const limitValue = limits[action];

  // Boolean features: allow/deny with no usage math.
  if (typeof limitValue === 'boolean') {
    return {
      allowed: limitValue,
      current: 0,
      limit: limitValue ? 1 : 0,
      remaining: limitValue ? 1 : 0,
    };
  }

  // Unlimited numeric tier — skip the count query.
  if (isUnlimited(limitValue)) {
    return { allowed: true, current: 0, limit: -1, remaining: -1 };
  }

  // KNOWN RACE (TOCTOU) — finite numeric limits are enforced as count-then-allow
  // with no atomic reservation. Two concurrent requests for the same user can
  // both read `current = limit - 1`, both decide `allowed = true`, and then both
  // perform the action, overshooting the limit by the number of concurrent
  // requests. The window is the gap between this read and the caller's write
  // (e.g. the audit row in aiChatController, or the userFile/biomarker insert).
  //
  // This cannot be closed correctly from a read-only helper. The recommended fix
  // is an atomic reservation in the SAME transaction that records the usage:
  //   1. Maintain a per-user/per-window counter row and, inside
  //      withRLSTransaction, do an atomic `UPDATE ... SET n = n + 1 WHERE n <
  //      :limit RETURNING n` (or `SELECT ... FOR UPDATE` on the counter), then
  //      perform the gated write in the same tx, rolling back if the reservation
  //      fails; OR
  //   2. Add a partial unique/exclusion constraint or DB-side trigger that
  //      rejects the (limit+1)-th row per window so the insert itself fails.
  // Either approach makes the check-and-consume a single serialized step.
  // Deliberately NOT implementing a half-locking scheme here (a lock around the
  // count without holding it through the caller's write would not actually close
  // the window and would add contention for no guarantee).
  const usage = await getUserUsage(userId);
  const usageKey = NUMERIC_LIMIT_TO_USAGE[action as string];
  const current = usageKey ? usage[usageKey] : 0;

  return {
    allowed: current < limitValue,
    current,
    limit: limitValue,
    remaining: Math.max(0, limitValue - current),
  };
}
