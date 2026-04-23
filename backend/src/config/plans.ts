/**
 * Subscription plan configuration.
 *
 * Defines what each tier gets. No payment processing yet — plans are assigned
 * manually via the admin panel or a direct DB update. When Stripe is added,
 * its webhook handler will update the same `users.plan` column.
 *
 * Limits semantics:
 *   -1  → unlimited (see `isUnlimited`)
 *    0  → disabled for numeric limits; false for boolean features
 *    N  → max N in the relevant window (per-day / per-month / total)
 *
 * Placeholder numbers — tune against actual API costs and usage patterns.
 */

export type PlanTier = 'FREE' | 'PRO' | 'TEAM';

export interface PlanLimits {
  aiChatsPerDay: number;
  pdfUploadsPerMonth: number;
  maxBiomarkers: number;           // total stored, not per upload
  insurancePlans: number;          // max active plans
  aiGuidancePerDay: number;
  costAnalysisPerMonth: number;
  healthProfile: boolean;
  providerSharing: boolean;
  dataExport: boolean;
  questFhirIntegration: boolean;
}

export interface PlanConfig {
  tier: PlanTier;
  name: string;
  description: string;
  price: number;                   // monthly price in cents (display only, no billing)
  annualPrice: number;             // annual price in cents
  limits: PlanLimits;
}

export const PLANS: Record<PlanTier, PlanConfig> = {
  FREE: {
    tier: 'FREE',
    name: 'Free',
    description: 'Basic health tracking',
    price: 0,
    annualPrice: 0,
    limits: {
      aiChatsPerDay: 3,
      pdfUploadsPerMonth: 2,
      maxBiomarkers: 50,
      insurancePlans: 1,
      aiGuidancePerDay: 5,
      costAnalysisPerMonth: 1,
      healthProfile: false,
      providerSharing: false,
      dataExport: true,            // HIPAA requires this regardless of plan
      questFhirIntegration: false,
    },
  },
  PRO: {
    tier: 'PRO',
    name: 'Pro',
    description: 'Full health intelligence',
    price: 999,
    annualPrice: 9900,
    limits: {
      aiChatsPerDay: 50,
      pdfUploadsPerMonth: 20,
      maxBiomarkers: -1,
      insurancePlans: 5,
      aiGuidancePerDay: -1,
      costAnalysisPerMonth: -1,
      healthProfile: true,
      providerSharing: true,
      dataExport: true,
      questFhirIntegration: true,
    },
  },
  TEAM: {
    tier: 'TEAM',
    name: 'Team',
    description: 'For families and caregivers',
    price: 1999,
    annualPrice: 19900,
    limits: {
      aiChatsPerDay: -1,
      pdfUploadsPerMonth: -1,
      maxBiomarkers: -1,
      insurancePlans: -1,
      aiGuidancePerDay: -1,
      costAnalysisPerMonth: -1,
      healthProfile: true,
      providerSharing: true,
      dataExport: true,
      questFhirIntegration: true,
    },
  },
};

export const PLAN_TIERS: readonly PlanTier[] = ['FREE', 'PRO', 'TEAM'] as const;

/** Coerce any plan-column value to a known tier, falling back to FREE. */
export function normalizePlan(value: unknown): PlanTier {
  if (typeof value === 'string' && (PLAN_TIERS as readonly string[]).includes(value)) {
    return value as PlanTier;
  }
  return 'FREE';
}

export function getPlanConfig(tier: PlanTier): PlanConfig {
  return PLANS[tier] ?? PLANS.FREE;
}

export function getPlanLimits(tier: PlanTier): PlanLimits {
  return PLANS[tier]?.limits ?? PLANS.FREE.limits;
}

export function isUnlimited(value: number): boolean {
  return value === -1;
}
