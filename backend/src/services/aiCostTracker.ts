/**
 * AI Cost Tracker
 *
 * Logs Claude API usage with estimated costs for monitoring and alerting.
 * Uses structured logging so costs can be queried from log aggregation tools.
 *
 * @module services/aiCostTracker
 */

import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const aiCostLogger = logger.createServiceLogger('AICost');

// Token pricing (update when Anthropic changes pricing)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  'claude-sonnet-4-5-20250929': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
};

interface AIUsageInput {
  endpoint: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  userId: string;
}

// ============================================================
// Rolling daily spend accumulator (in-memory, per-UTC-day).
//
// PER-INSTANCE only — under Cloud Run autoscale the effective ceiling is
// N×budget (same limitation as the in-memory rate limiters; bounded by
// --max-instances). Move to a shared store (Memorystore) for multi-instance
// precision. Still a real circuit breaker against runaway Anthropic billing
// vs. no cap at all. Read by the aiSpendGuard middleware before each AI call;
// updated by trackAIUsage after each call completes.
// ============================================================
let spendDayKey = '';
let globalSpentUsd = 0;
const userSpentUsd = new Map<string, number>();

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function rollIfNewDay(): void {
  const key = utcDayKey();
  if (key !== spendDayKey) {
    spendDayKey = key;
    globalSpentUsd = 0;
    userSpentUsd.clear();
  }
}

function recordSpend(userId: string, costUsd: number): void {
  rollIfNewDay();
  globalSpentUsd += costUsd;
  userSpentUsd.set(userId, (userSpentUsd.get(userId) ?? 0) + costUsd);
}

/**
 * Whether the configured daily AI spend budget is already exhausted for this
 * instance (global) or for the given user. Checked BEFORE a Claude call; the
 * current call's cost isn't known until it returns, so a single call may push
 * slightly past the cap, but the next one is refused — which is what bounds a
 * runaway loop. A budget of 0 disables that scope.
 */
export function isAISpendExceeded(userId: string): { exceeded: boolean; scope: 'global' | 'user' | null } {
  rollIfNewDay();
  if (config.ai.dailyBudgetUsd > 0 && globalSpentUsd >= config.ai.dailyBudgetUsd) {
    return { exceeded: true, scope: 'global' };
  }
  if (config.ai.userDailyBudgetUsd > 0 && (userSpentUsd.get(userId) ?? 0) >= config.ai.userDailyBudgetUsd) {
    return { exceeded: true, scope: 'user' };
  }
  return { exceeded: false, scope: null };
}

/**
 * L-3: conservative per-request reservation. Because the real cost of a Claude
 * call isn't known until it returns, isAISpendExceeded() alone lets N concurrent
 * requests all observe "under budget" and proceed before any of them records a
 * cost, overshooting the cap by up to (N-1) calls. reserveAISpend() optimistically
 * charges a fixed estimate to the accumulator for the duration of the in-flight
 * call so concurrent requests see the budget as partially consumed. The returned
 * settle() backs the estimate out again (the real cost is added independently by
 * trackAIUsage). settle() is idempotent and a no-op once the UTC day has rolled
 * over (the accumulator is cleared then), so it can never drive a balance negative
 * or wrongly lock a user out. Sized to a typical single Claude call.
 */
const RESERVATION_USD = 0.05;

export function reserveAISpend(
  userId: string,
  estimatedUsd: number = RESERVATION_USD
): () => void {
  rollIfNewDay();
  const dayAtReserve = spendDayKey;
  recordSpend(userId, estimatedUsd);

  let settled = false;
  return function settle(): void {
    if (settled) return;
    settled = true;
    rollIfNewDay();
    // If the day rolled over since the reservation, the accumulator was reset —
    // there's nothing to back out.
    if (spendDayKey !== dayAtReserve) return;
    globalSpentUsd = Math.max(0, globalSpentUsd - estimatedUsd);
    const current = userSpentUsd.get(userId) ?? 0;
    userSpentUsd.set(userId, Math.max(0, current - estimatedUsd));
  };
}

/** Test-only: reset the in-memory accumulator. */
export function __resetAISpendForTests(): void {
  spendDayKey = '';
  globalSpentUsd = 0;
  userSpentUsd.clear();
}

/**
 * Log AI API usage with estimated cost AND add it to the rolling daily spend
 * accumulator. Call after every successful Claude API response.
 */
export function trackAIUsage(record: AIUsageInput): void {
  const pricing = PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929'];
  const estimatedCostUsd = (record.inputTokens * pricing.input) + (record.outputTokens * pricing.output);

  recordSpend(record.userId, estimatedCostUsd);

  aiCostLogger.info('AI API usage', {
    endpoint: record.endpoint,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedCostUsd: estimatedCostUsd.toFixed(6),
    userId: record.userId,
  });
}
