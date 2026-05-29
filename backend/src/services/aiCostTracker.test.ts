/**
 * Tests for the AI spend circuit breaker in aiCostTracker.
 *
 * Token counts are derived from the configured budgets so the test stays
 * correct even if AI_DAILY_BUDGET_USD / AI_USER_DAILY_BUDGET_USD are overridden
 * in the environment.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config/index.js';
import { trackAIUsage, isAISpendExceeded, __resetAISpendForTests } from './aiCostTracker.js';

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
});
