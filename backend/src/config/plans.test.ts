import { describe, it, expect } from 'vitest';
import { PLAN_TIERS, getPlanLimits, normalizePlan, isUnlimited } from './plans.js';

describe('plan config', () => {
  // M12 / FHIR plan-limit bypass guard: FHIR sync (syncLabResults) inserts
  // biomarkers via upsertBiomarkerReading with NO maxBiomarkers gate. That is
  // safe ONLY because the FHIR feature is gated to tiers with unlimited
  // biomarkers, so no capped tier can reach it. This invariant is the tripwire:
  // if a future tier ever grants questFhirIntegration with a finite maxBiomarkers,
  // the FHIR bypass silently reopens — and this test fails in CI.
  it('every questFhirIntegration tier has unlimited maxBiomarkers (FHIR bypass tripwire)', () => {
    for (const tier of PLAN_TIERS) {
      const limits = getPlanLimits(tier);
      if (limits.questFhirIntegration) {
        expect(
          isUnlimited(limits.maxBiomarkers),
          `${tier} grants questFhirIntegration but caps maxBiomarkers at ${limits.maxBiomarkers} — this reopens the FHIR plan-limit bypass; either make maxBiomarkers unlimited for ${tier} or add a maxBiomarkers gate to the FHIR sync insert path`
        ).toBe(true);
      }
    }
  });

  it('normalizePlan coerces unknown/missing values to FREE', () => {
    expect(normalizePlan('PRO')).toBe('PRO');
    expect(normalizePlan('TEAM')).toBe('TEAM');
    expect(normalizePlan('bogus')).toBe('FREE');
    expect(normalizePlan(undefined)).toBe('FREE');
    expect(normalizePlan(null)).toBe('FREE');
  });

  it('FREE caps biomarkers (50) + active insurance plans (1); PRO/TEAM are unlimited', () => {
    expect(getPlanLimits('FREE').maxBiomarkers).toBe(50);
    expect(getPlanLimits('FREE').insurancePlans).toBe(1);
    expect(isUnlimited(getPlanLimits('PRO').maxBiomarkers)).toBe(true);
    expect(getPlanLimits('PRO').insurancePlans).toBe(5);
    expect(isUnlimited(getPlanLimits('TEAM').insurancePlans)).toBe(true);
  });
});
