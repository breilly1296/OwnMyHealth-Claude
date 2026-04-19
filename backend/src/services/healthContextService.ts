/**
 * Health Context Service
 *
 * Assembles a compact, PHI-scrubbed summary of a user's health data for
 * the AI Health Guide chat system prompt. Runs inside a single RLS
 * transaction so we only hit the DB once per chat call, and applies the
 * minimum-necessary principle: values + trends + counts only, never
 * identifiers (name, DOB, phone, address, memberId, groupId, provider
 * names).
 *
 * Target token budget: ~3000 tokens for the serialized context. When a
 * user has many data points we summarize counts and only render detail
 * for the most clinically relevant items.
 */

import { withRLSContext } from './database.js';
import { getEncryptionService } from './encryption.js';
import { getUserEncryptionSalt } from './userEncryption.js';
import { stripPHIFromText } from '../utils/phiRedaction.js';
import { sanitizeForPrompt } from '../middleware/validation.js';
import { logger } from '../utils/logger.js';
import {
  getDecryptedHealthProfile,
  isEmptyProfile,
  type UserHealthProfile,
} from './healthProfileService.js';

interface BiomarkerContextEntry {
  name: string;
  category: string;
  value: number;
  unit: string;
  normalRange: { min: number; max: number };
  isOutOfRange: boolean;
  measurementDate: string;
  trend: 'up' | 'down' | 'stable' | 'unknown';
}

interface InsuranceContextEntry {
  planName: string;
  planType: string;
  deductibleIndividual: number | null;
  deductibleMetIndividual: number | null;
  oopMaxIndividual: number | null;
  oopMetIndividual: number | null;
  premiumMonthly: number | null;
  copayPrimaryCare: number | null;
  copaySpecialist: number | null;
  copayEmergency: number | null;
  coinsuranceRate: number | null;
  benefitsCount: number;
}

interface ExpenseContext {
  projectionsAnnualTotal: number;
  projectionsCount: number;
  actualsTotalPatientPaid: number;
  actualsCount: number;
  projectedServiceTypes: string[];
}

interface GoalContextEntry {
  name: string;
  category: string;
  direction: string;
  targetValue: number;
  currentValue: number | null;
  unit: string;
  progress: number;
  status: string;
  daysRemaining: number;
}

interface NeedContextEntry {
  name: string;
  needType: string;
  urgency: string;
  status: string;
  relatedBiomarkerCount: number;
}

export interface HealthContext {
  biomarkers: {
    total: number;
    inRange: number;
    outOfRange: number;
    detail: BiomarkerContextEntry[]; // up to 10 most relevant
    categoriesSummary: Array<{ category: string; total: number; outOfRange: number }>;
  };
  insurance: {
    totalPlans: number;
    primary: InsuranceContextEntry | null;
    additionalCount: number;
  };
  expenses: ExpenseContext;
  goals: {
    total: number;
    active: number;
    completed: number;
    detail: GoalContextEntry[]; // up to 5 active
  };
  needs: {
    total: number;
    pending: number;
    byUrgency: Record<string, number>;
    detail: NeedContextEntry[]; // up to 5 highest urgency
  };
  profile: {
    memberSince: string;
    biomarkerCount: number;
    planCount: number;
  };
  /**
   * User-reported health profile (conditions, medications, demographics,
   * lifestyle). Always present — empty object shape when the user hasn't
   * set one, so callers don't need to null-check.
   */
  healthProfile: UserHealthProfile;
}

const BIOMARKER_DETAIL_LIMIT = 10;
const GOAL_DETAIL_LIMIT = 5;
const NEED_DETAIL_LIMIT = 5;
const PROJECTION_SERVICE_TYPE_LIMIT = 8;

// Ordinal ranking for urgency so we can surface the most pressing first.
const URGENCY_RANK: Record<string, number> = {
  IMMEDIATE: 0,
  URGENT: 1,
  FOLLOW_UP: 2,
  ROUTINE: 3,
};

/**
 * Simple trend classifier on a biomarker's history entries. Returns
 * 'unknown' when there's only one data point.
 */
function classifyTrend(
  currentValue: number,
  history: Array<{ valueEncrypted: string }>,
  encryption: ReturnType<typeof getEncryptionService>,
  userSalt: string
): BiomarkerContextEntry['trend'] {
  if (history.length < 1) return 'unknown';
  try {
    const prior = parseFloat(encryption.decrypt(history[0].valueEncrypted, userSalt));
    if (!Number.isFinite(prior) || prior === 0) return 'unknown';
    const changePercent = ((currentValue - prior) / prior) * 100;
    if (Math.abs(changePercent) < 5) return 'stable';
    return changePercent > 0 ? 'up' : 'down';
  } catch {
    return 'unknown';
  }
}

/**
 * Assemble the user's health context.
 *
 * Two-phase design:
 *   1. Inside withRLSContext: run the Prisma queries in parallel and
 *      return the raw rows (with encrypted fields still encrypted).
 *   2. After the transaction commits: decrypt PHI fields and map the
 *      raw rows into the context shape.
 *
 * PBKDF2-SHA512 key derivation inside encryption.decrypt is CPU-heavy,
 * and doing ~30 decrypts inside the transaction was blowing past
 * Prisma's 5s interactive-transaction timeout on Cloud Run (observed
 * 14s wall-clock). Moving the crypto outside the transaction keeps
 * the DB-scoped window small and deterministic — RLS is still enforced
 * by withRLSContext during the queries.
 */
export async function assembleHealthContext(userId: string): Promise<HealthContext> {
  const encryption = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Fetch the health profile in parallel with the main RLS transaction.
  // getDecryptedHealthProfile opens its own withRLSContext internally
  // so we keep them as separate calls rather than racing two transactions
  // on the same Prisma client.
  const healthProfilePromise = getDecryptedHealthProfile(userId);

  // ----- Phase 1: DB queries only, inside the RLS transaction -----
  const raw = await withRLSContext(userId, async (tx) => {
    const [user, biomarkers, insurancePlans, projections, actuals, goals, needs] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: { createdAt: true },
      }),
      tx.biomarker.findMany({
        where: { userId },
        include: {
          history: { orderBy: { measurementDate: 'desc' }, take: 1 },
        },
        orderBy: [{ isOutOfRange: 'desc' }, { measurementDate: 'desc' }],
      }),
      tx.insurancePlan.findMany({
        where: { userId, isActive: true },
        include: { benefits: { select: { id: true } } },
        orderBy: [{ isPrimary: 'desc' }, { effectiveDate: 'desc' }],
      }),
      tx.expenseProjection.findMany({ where: { userId } }),
      tx.expenseActual.findMany({ where: { userId } }),
      tx.healthGoal.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      }),
      tx.healthNeed.findMany({ where: { userId } }),
    ]);

    return { user, biomarkers, insurancePlans, projections, actuals, goals, needs };
  });

  // ----- Phase 2: decrypt + map, outside the transaction -----
  const { user, biomarkers, insurancePlans, projections, actuals, goals, needs } = raw;

  // Biomarkers
  const outOfRangeBiomarkers = biomarkers.filter((b) => b.isOutOfRange);
  const inRangeBiomarkers = biomarkers.filter((b) => !b.isOutOfRange);

  // Out-of-range first (most clinically relevant), then fill with recent in-range.
  const biomarkerDetailSource = [
    ...outOfRangeBiomarkers,
    ...inRangeBiomarkers,
  ].slice(0, BIOMARKER_DETAIL_LIMIT);

  const biomarkerDetail: BiomarkerContextEntry[] = biomarkerDetailSource.map((b) => {
    let value = 0;
    try {
      value = parseFloat(encryption.decrypt(b.valueEncrypted, userSalt));
    } catch {
      logger.warn('Failed to decrypt biomarker for context', { data: { biomarkerId: b.id } });
    }
    return {
      name: b.name,
      category: b.category,
      value: Number.isFinite(value) ? value : 0,
      unit: b.unit,
      normalRange: {
        min: Number(b.normalRangeMin),
        max: Number(b.normalRangeMax),
      },
      isOutOfRange: b.isOutOfRange,
      measurementDate: b.measurementDate.toISOString().split('T')[0],
      trend: classifyTrend(value, b.history, encryption, userSalt),
    };
  });

  const categoriesCount = new Map<string, { total: number; outOfRange: number }>();
  for (const b of biomarkers) {
    const slot = categoriesCount.get(b.category) ?? { total: 0, outOfRange: 0 };
    slot.total += 1;
    if (b.isOutOfRange) slot.outOfRange += 1;
    categoriesCount.set(b.category, slot);
  }

  // Insurance
  const primaryPlan = insurancePlans[0];
  const insuranceEntry: InsuranceContextEntry | null = primaryPlan
    ? {
        planName: primaryPlan.planName,
        planType: primaryPlan.planType,
        deductibleIndividual: primaryPlan.deductibleIndividual
          ? Number(primaryPlan.deductibleIndividual)
          : null,
        deductibleMetIndividual: primaryPlan.deductibleMetIndividual
          ? Number(primaryPlan.deductibleMetIndividual)
          : null,
        oopMaxIndividual: primaryPlan.oopMaxIndividual
          ? Number(primaryPlan.oopMaxIndividual)
          : null,
        oopMetIndividual: primaryPlan.oopMetIndividual
          ? Number(primaryPlan.oopMetIndividual)
          : null,
        premiumMonthly: primaryPlan.premiumMonthly ? Number(primaryPlan.premiumMonthly) : null,
        copayPrimaryCare: primaryPlan.copayPrimaryCare
          ? Number(primaryPlan.copayPrimaryCare)
          : null,
        copaySpecialist: primaryPlan.copaySpecialist
          ? Number(primaryPlan.copaySpecialist)
          : null,
        copayEmergency: primaryPlan.copayEmergency
          ? Number(primaryPlan.copayEmergency)
          : null,
        coinsuranceRate: primaryPlan.coinsuranceRate
          ? Number(primaryPlan.coinsuranceRate)
          : null,
        benefitsCount: primaryPlan.benefits.length,
      }
    : null;

  // Expenses
  let projectionsAnnualTotal = 0;
  const projectedServiceTypesSet = new Set<string>();
  for (const p of projections) {
    try {
      const cost = parseFloat(encryption.decrypt(p.estimatedCostEncrypted, userSalt));
      projectionsAnnualTotal += cost * p.frequencyPerYear;
      const serviceType = encryption.decrypt(p.serviceTypeEncrypted, userSalt);
      projectedServiceTypesSet.add(serviceType);
    } catch {
      // swallow — a stale record shouldn't break the whole context assembly
    }
  }

  let actualsTotalPatientPaid = 0;
  for (const a of actuals) {
    if (!a.patientPaidEncrypted) continue;
    try {
      actualsTotalPatientPaid += parseFloat(encryption.decrypt(a.patientPaidEncrypted, userSalt));
    } catch {
      // swallow
    }
  }

  const expensesContext: ExpenseContext = {
    projectionsAnnualTotal: Math.round(projectionsAnnualTotal),
    projectionsCount: projections.length,
    actualsTotalPatientPaid: Math.round(actualsTotalPatientPaid),
    actualsCount: actuals.length,
    projectedServiceTypes: Array.from(projectedServiceTypesSet).slice(0, PROJECTION_SERVICE_TYPE_LIMIT),
  };

  // Goals
  const activeGoals = goals.filter((g) => g.status === 'ACTIVE');
  const completedGoals = goals.filter((g) => g.status === 'ACHIEVED');
  const goalDetailSource = activeGoals.slice(0, GOAL_DETAIL_LIMIT);
  const goalDetail: GoalContextEntry[] = goalDetailSource.map((g) => {
    const daysRemaining = Math.ceil(
      (g.targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return {
      name: g.name,
      category: g.category,
      direction: g.direction,
      targetValue: Number(g.targetValue),
      currentValue: g.currentValue !== null ? Number(g.currentValue) : null,
      unit: g.unit,
      progress: Number(g.progress),
      status: g.status,
      daysRemaining,
    };
  });

  // Needs
  const byUrgency: Record<string, number> = {
    IMMEDIATE: 0,
    URGENT: 0,
    FOLLOW_UP: 0,
    ROUTINE: 0,
  };
  for (const n of needs) {
    byUrgency[n.urgency] = (byUrgency[n.urgency] ?? 0) + 1;
  }
  const pendingNeeds = needs.filter((n) => n.status !== 'COMPLETED' && n.status !== 'DISMISSED');
  const needDetailSource = [...pendingNeeds]
    .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 99) - (URGENCY_RANK[b.urgency] ?? 99))
    .slice(0, NEED_DETAIL_LIMIT);
  const needDetail: NeedContextEntry[] = needDetailSource.map((n) => ({
    name: n.name,
    needType: n.needType,
    urgency: n.urgency,
    status: n.status,
    relatedBiomarkerCount: n.relatedBiomarkerIds.length,
  }));

  const healthProfile = await healthProfilePromise;

  return {
    biomarkers: {
      total: biomarkers.length,
      inRange: inRangeBiomarkers.length,
      outOfRange: outOfRangeBiomarkers.length,
      detail: biomarkerDetail,
      categoriesSummary: Array.from(categoriesCount.entries()).map(([category, counts]) => ({
        category,
        total: counts.total,
        outOfRange: counts.outOfRange,
      })),
    },
    insurance: {
      totalPlans: insurancePlans.length,
      primary: insuranceEntry,
      additionalCount: Math.max(0, insurancePlans.length - 1),
    },
    expenses: expensesContext,
    goals: {
      total: goals.length,
      active: activeGoals.length,
      completed: completedGoals.length,
      detail: goalDetail,
    },
    needs: {
      total: needs.length,
      pending: pendingNeeds.length,
      byUrgency,
      detail: needDetail,
    },
    profile: {
      memberSince: user?.createdAt.toISOString().split('T')[0] ?? '',
      biomarkerCount: biomarkers.length,
      planCount: insurancePlans.length,
    },
    healthProfile,
  };
}

/**
 * Serialize the health context into a compact text block for the system
 * prompt. Applies stripPHIFromText as defense-in-depth even though we
 * never include identifiers by construction.
 */
export function serializeHealthContext(ctx: HealthContext): string {
  const lines: string[] = [];

  lines.push(`=== USER'S HEALTH PROFILE ===`);
  lines.push(`Member since: ${ctx.profile.memberSince || 'unknown'}`);
  lines.push('');

  // Self-reported profile (demographics + conditions + meds + lifestyle).
  // Free-text fields pass through sanitizeForPrompt as an additional
  // prompt-injection guard on top of the Zod validation.
  if (!isEmptyProfile(ctx.healthProfile)) {
    const hp = ctx.healthProfile;
    lines.push(`SELF-REPORTED HEALTH PROFILE:`);
    if (hp.biologicalSex) lines.push(`  Biological sex: ${hp.biologicalSex}`);
    if (hp.ageRange) lines.push(`  Age range: ${hp.ageRange}`);
    if (hp.smokingStatus) lines.push(`  Smoking: ${hp.smokingStatus}`);
    if (hp.exerciseLevel) lines.push(`  Exercise: ${hp.exerciseLevel}`);
    const activeConditions = hp.conditions.filter((c) => c.status !== 'resolved');
    if (activeConditions.length > 0) {
      const entries = activeConditions.map((c) => {
        const name = sanitizeForPrompt(c.name);
        const yr = c.diagnosedYear ? `, dx ${c.diagnosedYear}` : '';
        return `${name} (${c.status}${yr})`;
      });
      lines.push(`  Active conditions: ${entries.join('; ')}`);
    }
    if (hp.medications.length > 0) {
      const meds = hp.medications.map((m) => {
        const name = sanitizeForPrompt(m.name);
        return m.purpose ? `${name} (${sanitizeForPrompt(m.purpose)})` : name;
      });
      lines.push(`  Medications: ${meds.join('; ')}`);
    }
    if (hp.familyHistory.length > 0) {
      lines.push(`  Family history: ${hp.familyHistory.map(sanitizeForPrompt).join(', ')}`);
    }
    if (hp.additionalContext?.trim()) {
      lines.push(`  Additional context: ${sanitizeForPrompt(hp.additionalContext)}`);
    }
    lines.push('');
    lines.push(
      `IMPORTANT: Interpret biomarker results in the context of these conditions, medications, and demographics. Medication effects on lab values should be noted when relevant. Do not diagnose — always recommend consulting a healthcare provider.`
    );
    lines.push('');
  }

  // Biomarkers
  if (ctx.biomarkers.total === 0) {
    lines.push(`BIOMARKERS: none tracked yet.`);
  } else {
    lines.push(
      `BIOMARKERS: ${ctx.biomarkers.total} tracked, ${ctx.biomarkers.inRange} in range, ${ctx.biomarkers.outOfRange} out of range.`
    );
    if (ctx.biomarkers.detail.length > 0) {
      lines.push(`Notable values (out-of-range first, then most recent):`);
      for (const b of ctx.biomarkers.detail) {
        const status = b.isOutOfRange ? 'OUT OF RANGE' : 'in range';
        const trendText = b.trend === 'unknown' ? '' : `, trend ${b.trend}`;
        lines.push(
          `  - ${b.name} [${b.category}]: ${b.value} ${b.unit} (range ${b.normalRange.min}-${b.normalRange.max} ${b.unit}, ${status}${trendText}, measured ${b.measurementDate})`
        );
      }
    }
    if (ctx.biomarkers.total > ctx.biomarkers.detail.length) {
      lines.push(
        `(${ctx.biomarkers.total - ctx.biomarkers.detail.length} additional biomarkers not shown in detail.)`
      );
    }
  }
  lines.push('');

  // Insurance
  if (ctx.insurance.totalPlans === 0) {
    lines.push(`INSURANCE: no plans on file.`);
  } else {
    lines.push(`INSURANCE: ${ctx.insurance.totalPlans} active plan(s).`);
    if (ctx.insurance.primary) {
      const p = ctx.insurance.primary;
      const fmt = (n: number | null) => (n === null ? '--' : `$${n.toLocaleString()}`);
      lines.push(`Primary plan: ${p.planName} (${p.planType})`);
      lines.push(
        `  Deductible: ${fmt(p.deductibleMetIndividual)} met of ${fmt(p.deductibleIndividual)}`
      );
      lines.push(`  OOP max: ${fmt(p.oopMetIndividual)} met of ${fmt(p.oopMaxIndividual)}`);
      lines.push(`  Monthly premium: ${fmt(p.premiumMonthly)}`);
      lines.push(
        `  Copays — primary care: ${fmt(p.copayPrimaryCare)}, specialist: ${fmt(p.copaySpecialist)}, emergency: ${fmt(p.copayEmergency)}`
      );
      lines.push(
        `  Coinsurance: ${p.coinsuranceRate !== null ? `${p.coinsuranceRate}%` : '--'}`
      );
      lines.push(`  Benefits on file: ${p.benefitsCount}`);
    }
    if (ctx.insurance.additionalCount > 0) {
      lines.push(`(${ctx.insurance.additionalCount} additional plan(s) not shown in detail.)`);
    }
  }
  lines.push('');

  // Expenses
  if (ctx.expenses.projectionsCount === 0 && ctx.expenses.actualsCount === 0) {
    lines.push(`EXPENSES: nothing recorded yet.`);
  } else {
    lines.push(
      `EXPENSES: ${ctx.expenses.projectionsCount} projected service(s) totaling ~$${ctx.expenses.projectionsAnnualTotal.toLocaleString()}/year (before insurance); ${ctx.expenses.actualsCount} claim(s) recorded with $${ctx.expenses.actualsTotalPatientPaid.toLocaleString()} patient-paid to date.`
    );
    if (ctx.expenses.projectedServiceTypes.length > 0) {
      lines.push(`Projected service types: ${ctx.expenses.projectedServiceTypes.join(', ')}`);
    }
  }
  lines.push('');

  // Goals
  if (ctx.goals.total === 0) {
    lines.push(`GOALS: none set.`);
  } else {
    lines.push(
      `GOALS: ${ctx.goals.total} total (${ctx.goals.active} active, ${ctx.goals.completed} achieved).`
    );
    for (const g of ctx.goals.detail) {
      const current = g.currentValue !== null ? `${g.currentValue} ${g.unit}` : 'no current value';
      const dueText =
        g.daysRemaining > 0
          ? `${g.daysRemaining} days remaining`
          : g.daysRemaining === 0
          ? 'due today'
          : `overdue by ${Math.abs(g.daysRemaining)} days`;
      lines.push(
        `  - ${g.name} [${g.category}, ${g.direction}]: ${current} → target ${g.targetValue} ${g.unit}, ${Math.round(g.progress)}% progress, ${dueText}`
      );
    }
  }
  lines.push('');

  // Needs
  if (ctx.needs.total === 0) {
    lines.push(`HEALTH NEEDS: none tracked.`);
  } else {
    const urgencyLine = Object.entries(ctx.needs.byUrgency)
      .filter(([, count]) => count > 0)
      .map(([urgency, count]) => `${count} ${urgency}`)
      .join(', ');
    lines.push(
      `HEALTH NEEDS: ${ctx.needs.total} total (${ctx.needs.pending} open)${urgencyLine ? ` — ${urgencyLine}` : ''}.`
    );
    for (const n of ctx.needs.detail) {
      const linked =
        n.relatedBiomarkerCount > 0
          ? `, linked to ${n.relatedBiomarkerCount} biomarker(s)`
          : '';
      lines.push(`  - ${n.name} [${n.needType}, ${n.urgency}, ${n.status}]${linked}`);
    }
  }

  const serialized = lines.join('\n');

  // Defense-in-depth — the context is built from structured fields so it
  // shouldn't contain PHI patterns, but a stray biomarker/plan name could
  // include something unexpected. Cheap belt-and-suspenders.
  return stripPHIFromText(serialized);
}

/**
 * Rough token-count estimator. Claude's tokenizer is ~4 characters per
 * token on average English prose; we use that for budget math without
 * pulling in the anthropic tokenizer (which would require an additional
 * async call and package). Good enough for ±20% accuracy — we keep the
 * total budget conservative.
 */
export function estimateContextTokens(ctx: HealthContext): number {
  return Math.ceil(serializeHealthContext(ctx).length / 4);
}

/**
 * Human-friendly audit category breakdown for logging.
 */
export function summarizeContextCategories(ctx: HealthContext): Record<string, number> {
  return {
    biomarkers: ctx.biomarkers.total,
    plans: ctx.insurance.totalPlans,
    projections: ctx.expenses.projectionsCount,
    actuals: ctx.expenses.actualsCount,
    goals: ctx.goals.total,
    needs: ctx.needs.total,
    profileConditions: ctx.healthProfile.conditions.length,
    profileMedications: ctx.healthProfile.medications.length,
  };
}
