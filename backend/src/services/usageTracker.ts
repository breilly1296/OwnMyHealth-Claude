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
import {
  getPlanLimits,
  isUnlimited,
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
