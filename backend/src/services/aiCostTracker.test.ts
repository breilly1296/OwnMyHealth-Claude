/**
 * Tests for the AI spend circuit breaker in aiCostTracker.
 *
 * Token counts are derived from the configured budgets so the test stays
 * correct even if AI_DAILY_BUDGET_USD / AI_USER_DAILY_BUDGET_USD are overridden
 * in the environment.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config/index.js';
import { trackAIUsage, isAISpendExceeded, reserveAISpend, __resetAISpendForTests } from './aiCostTracker.js';

// Sonnet 4.5 output price per token (matches the PRICING table).
const SONNET_OUT_PER_TOKEN = 15.0 / 1_000_000;

/** Output-token count whose Sonnet cost exceeds `usd`. */
function tokensForUsd(usd: number): number {
  return Math.ceil(usd / SONNET_OUT_PER_TOKEN) + 1000;
}

function spend(userId: string, usd: number): void {
  trackAIUsage({
    endpoint: 'test',
    model: 'claude-sonnet-4-5-20250929',
    inputTokens: 0,
    outputTokens: tokensForUsd(usd),
    userId,
  });
}

const USER_CAP = config.ai.userDailyBudgetUsd;
const GLOBAL_CAP = config.ai.dailyBudgetUsd;

describe('AI spend circuit breaker', () => {
  beforeEach(() => __resetAISpendForTests());

  it('allows a fresh user under budget', () => {
    expect(isAISpendExceeded('user-1').exceeded).toBe(false);
  });

  it.runIf(USER_CAP > 0 && GLOBAL_CAP > USER_CAP)(
    'blocks a user once their per-user budget is exceeded (user scope), leaving others unaffected',
    () => {
      spend('user-1', USER_CAP + 1); // over per-user, still under global
      const r = isAISpendExceeded('user-1');
      expect(r.exceeded).toBe(true);
      expect(r.scope).toBe('user');
      expect(isAISpendExceeded('user-2').exceeded).toBe(false);
    }
  );

  it.runIf(GLOBAL_CAP > 0)(
    'blocks every user once the global budget is exceeded (global scope)',
    () => {
      spend('whale', GLOBAL_CAP + 1);
      expect(isAISpendExceeded('whale').scope).toBe('global');
      // a brand-new user is blocked by the global cap too
      expect(isAISpendExceeded('newcomer').scope).toBe('global');
    }
  );

  it.runIf(GLOBAL_CAP > 0)('reset clears the accumulator', () => {
    spend('whale', GLOBAL_CAP + 1);
    __resetAISpendForTests();
    expect(isAISpendExceeded('whale').exceeded).toBe(false);
  });

  // L-3: in-flight reservations so concurrent calls can't all slip under the cap
  // before any of them records an actual cost.
  describe('reserveAISpend (L-3 in-flight reservation)', () => {
    it.runIf(USER_CAP > 0)('counts against the cap while in flight and settle() backs it out', () => {
      const settle = reserveAISpend('u-res', USER_CAP + 1); // one big in-flight reservation
      expect(isAISpendExceeded('u-res').exceeded).toBe(true);
      settle();
      expect(isAISpendExceeded('u-res').exceeded).toBe(false);
    });

    it.runIf(USER_CAP > 0)('concurrent reservations accumulate so the cap trips before any call settles', () => {
      const part = USER_CAP * 0.6;
      const s1 = reserveAISpend('u-conc', part);
      expect(isAISpendExceeded('u-conc').exceeded).toBe(false); // one in flight, still under
      const s2 = reserveAISpend('u-conc', part);               // second concurrent call, before s1 settles
      expect(isAISpendExceeded('u-conc').exceeded).toBe(true);  // overshoot the fix prevents
      s1();
      s2();
      expect(isAISpendExceeded('u-conc').exceeded).toBe(false);
    });

    it.runIf(USER_CAP > 1)('settle() is idempotent — a double-call does not refund twice', () => {
      const settle = reserveAISpend('u-idem', 1);
      settle();
      settle(); // no-op; must not credit another -$1
      // Balance is 0, so spending past the cap must still trip. If the second
      // settle had wrongly refunded, this would stay under and fail.
      spend('u-idem', USER_CAP + 0.5);
      expect(isAISpendExceeded('u-idem').exceeded).toBe(true);
    });
  });
});
