/**
 * extractProjectedOOP cost-math tests.
 *
 * The deterministic projected-out-of-pocket figure (persisted + shown in the UI)
 * had no test coverage and silently dropped out-of-network projections. These
 * pin the deductible burn-down + coinsurance + OOP-max cap, and that OON
 * projections now CONTRIBUTE (the fix) rather than counting as $0.
 */

import { describe, it, expect } from 'vitest';
import {
  extractProjectedOOP,
  type DecryptedProjection,
  type PlanForAnalysis,
} from './expenseController.js';

function plan(overrides: Partial<Record<keyof PlanForAnalysis, unknown>> = {}): PlanForAnalysis {
  return {
    deductibleIndividual: 1000,
    deductibleMetIndividual: 0,
    deductibleFamily: 2000,
    oopMaxIndividual: 5000,
    oopMaxFamily: 10000,
    oopMetIndividual: 0,
    coinsuranceRate: 20,
    planType: 'PPO',
    copayPrimaryCare: 30,
    copaySpecialist: 50,
    copayEmergency: 250,
    ...overrides,
  };
}

function proj(overrides: Partial<DecryptedProjection> = {}): DecryptedProjection {
  return {
    id: 'p',
    serviceType: 'Service',
    estimatedCost: 100,
    frequencyPerYear: 1,
    isInNetwork: true,
    notes: null,
    ...overrides,
  };
}

describe('extractProjectedOOP', () => {
  it('burns down the deductible then applies coinsurance above it', () => {
    // $2000 in-network; deductible 1000 @ 0 met, 20% coinsurance.
    // 1000 to deductible + (1000 * 20%) = 1200.
    const oop = extractProjectedOOP('', [proj({ estimatedCost: 2000 })], plan());
    expect(oop).toBe(1200);
  });

  it('INCLUDES out-of-network projections (regression: they were dropped -> $0)', () => {
    const oonOnly = extractProjectedOOP('', [proj({ estimatedCost: 2000, isInNetwork: false })], plan());
    // Same as the in-network case above — OON now contributes instead of being skipped.
    expect(oonOnly).toBe(1200);
  });

  it('counts BOTH in- and out-of-network projections', () => {
    const oop = extractProjectedOOP(
      '',
      [proj({ estimatedCost: 1000, isInNetwork: true }), proj({ estimatedCost: 1000, isInNetwork: false })],
      plan()
    );
    // in $1000 fills the deductible; OON $1000 is all coinsurance (20%) = 200.
    expect(oop).toBe(1200);
  });

  it('applies pure coinsurance when the deductible is already met', () => {
    const oop = extractProjectedOOP(
      '',
      [proj({ estimatedCost: 1000 })],
      plan({ deductibleMetIndividual: 1000, oopMetIndividual: 1000 })
    );
    // starts at oopMet 1000 + (1000 * 20%) = 1200.
    expect(oop).toBe(1200);
  });

  it('caps the total at the individual OOP max', () => {
    const oop = extractProjectedOOP(
      '',
      [proj({ estimatedCost: 10000 })],
      plan({ deductibleIndividual: 500, coinsuranceRate: 50, oopMaxIndividual: 1000 })
    );
    // 500 deductible + (9500 * 50%) = 5250, capped at 1000.
    expect(oop).toBe(1000);
  });

  it('returns the already-spent OOP when there are no projections', () => {
    const oop = extractProjectedOOP('', [], plan({ oopMetIndividual: 300 }));
    expect(oop).toBe(300);
  });
});
