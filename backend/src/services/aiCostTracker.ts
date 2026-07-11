/**
 * AI Cost Tracker
 *
 * Logs Claude API usage with estimated costs AND enforces a rolling daily spend
 * circuit-breaker (per-UTC-day, global + per-user budgets) so a buggy client
 * loop, a compromised key, or an abusive account can't run up an unbounded
 * Anthropic bill.
 *
 * Storage is pluggable (M11/L33):
 *  - default: an in-memory, per-process accumulator (current behaviour). Under
 *    Cloud Run autoscale the effective ceiling is N×budget — bounded by
 *    --max-instances. Fine for single-instance / dev.
 *  - when REDIS_URL is set: a SHARED Redis store (Cloud Memorystore) so the cap
 *    is consistent across instances, reusing the same ioredis connection the
 *    rate limiters use. The admit (reserve+check) is a single atomic
 *    INCRBYFLOAT-then-compare-and-refund per key, so two replicas can't both
 *    slip under the cap.
 *
 * The middleware (aiSpendGuard) calls admitAISpend() BEFORE a Claude call and
 * registers the returned settle() on response completion; trackAIUsage() records
 * the real cost AFTER the call.
 *
 * @module services/aiCostTracker
 */

import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { getRedisClient, type RedisLike } from '../middleware/rateLimitStore.js';

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

type Scope = 'global' | 'user' | null;

/**
 * Result of the admit gate. When `admitted`, `settle` MUST be called once the
 * in-flight call completes to back the reservation out (the real cost is added
 * separately by trackAIUsage). When refused, `settle` is a no-op (the
 * reservation was already refunded) and `scope` says which budget tripped.
 */
export interface Admission {
  admitted: boolean;
  scope: Scope;
  settle: () => void;
}

/**
 * L-3: conservative per-request reservation. The real cost of a Claude call
 * isn't known until it returns, so without a reservation N concurrent requests
 * could all observe "under budget" and proceed before any records a cost,
 * overshooting by up to (N-1) calls. admit() optimistically charges this fixed
 * estimate for the duration of the in-flight call; settle() backs it out.
 */
const RESERVATION_USD = 0.05;

// Redis per-day keys live ~48h so a key always covers its UTC day plus buffer,
// and stale days self-expire. EXPIRE is (re)set after every increment because
// INCRBYFLOAT on a fresh key carries no TTL.
const SPEND_TTL_SECONDS = 48 * 60 * 60;

const noop = (): void => {};

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Storage backend for the spend accumulator. Both impls use the SAME
 * reserve-first semantics: admit() adds a reservation and refuses iff that
 * pushes the running total past a configured cap (global checked before user);
 * record() adds a real cost with no gate.
 */
interface SpendStore {
  admit(userId: string): Promise<Admission>;
  record(userId: string, costUsd: number): Promise<void>;
  reset(): Promise<void>;
}

// ============================================================
// In-memory store (per-process, per-UTC-day) — default.
// ============================================================
export class InMemorySpendStore implements SpendStore {
  private dayKey = '';
  private global = 0;
  private users = new Map<string, number>();

  private roll(): void {
    const key = utcDayKey();
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.global = 0;
      this.users.clear();
    }
  }

  async admit(userId: string): Promise<Admission> {
    this.roll();
    const gCap = config.ai.dailyBudgetUsd;
    const uCap = config.ai.userDailyBudgetUsd;
    const dayAtReserve = this.dayKey;

    // Reserve first, then check the post-reservation totals.
    this.global += RESERVATION_USD;
    if (uCap > 0) this.users.set(userId, (this.users.get(userId) ?? 0) + RESERVATION_USD);
    const newGlobal = this.global;
    const newUser = this.users.get(userId) ?? 0;

    const refund = (): void => {
      this.roll();
      if (this.dayKey !== dayAtReserve) return; // day rolled → accumulator already cleared
      this.global = Math.max(0, this.global - RESERVATION_USD);
      if (uCap > 0) {
        this.users.set(userId, Math.max(0, (this.users.get(userId) ?? 0) - RESERVATION_USD));
      }
    };

    if (gCap > 0 && newGlobal > gCap) {
      refund();
      return { admitted: false, scope: 'global', settle: noop };
    }
    if (uCap > 0 && newUser > uCap) {
      refund();
      return { admitted: false, scope: 'user', settle: noop };
    }

    let settled = false;
    return {
      admitted: true,
      scope: null,
      settle: () => {
        if (settled) return;
        settled = true;
        refund();
      },
    };
  }

  async record(userId: string, costUsd: number): Promise<void> {
    this.roll();
    this.global += costUsd;
    this.users.set(userId, (this.users.get(userId) ?? 0) + costUsd);
  }

  async reset(): Promise<void> {
    this.dayKey = '';
    this.global = 0;
    this.users.clear();
  }

  /** Test aid: current totals (not part of SpendStore). */
  snapshot(userId: string): { global: number; user: number } {
    return { global: this.global, user: this.users.get(userId) ?? 0 };
  }
}

// ============================================================
// Redis store (shared across instances) — when REDIS_URL is set.
// ============================================================
export class RedisSpendStore implements SpendStore {
  constructor(private readonly client: RedisLike) {}

  private globalKey(): string {
    return `ai:spend:g:${utcDayKey()}`;
  }
  private userKey(userId: string): string {
    return `ai:spend:u:${userId}:${utcDayKey()}`;
  }

  /** Atomic add returning the post-increment total; (re)sets the 48h TTL. */
  private async incr(key: string, deltaUsd: number): Promise<number> {
    const v = await this.client.call('INCRBYFLOAT', key, String(deltaUsd));
    await this.client.call('EXPIRE', key, SPEND_TTL_SECONDS);
    return Number(v);
  }

  async admit(userId: string): Promise<Admission> {
    const gCap = config.ai.dailyBudgetUsd;
    const uCap = config.ai.userDailyBudgetUsd;
    // Capture the day-stamped keys NOW so a day-roll between reserve and settle
    // refunds the same keys the reservation hit.
    const gKey = this.globalKey();
    const uKey = this.userKey(userId);

    // Each INCRBYFLOAT is atomic and returns this caller's distinct
    // post-increment total, so concurrent replicas can't both read "under".
    const newGlobal = await this.incr(gKey, RESERVATION_USD);
    let newUser = 0;
    const reservedUser = uCap > 0;
    if (reservedUser) newUser = await this.incr(uKey, RESERVATION_USD);

    const refund = async (): Promise<void> => {
      await this.incr(gKey, -RESERVATION_USD);
      if (reservedUser) await this.incr(uKey, -RESERVATION_USD);
    };

    if (gCap > 0 && newGlobal > gCap) {
      await refund();
      return { admitted: false, scope: 'global', settle: noop };
    }
    if (uCap > 0 && newUser > uCap) {
      await refund();
      return { admitted: false, scope: 'user', settle: noop };
    }

    let settled = false;
    return {
      admitted: true,
      scope: null,
      settle: () => {
        if (settled) return;
        settled = true;
        void refund().catch((err) => {
          aiCostLogger.error('Failed to settle AI spend reservation', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
    };
  }

  async record(userId: string, costUsd: number): Promise<void> {
    await this.incr(this.globalKey(), costUsd);
    if (config.ai.userDailyBudgetUsd > 0) await this.incr(this.userKey(userId), costUsd);
  }

  async reset(): Promise<void> {
    // Best-effort: drop today's keys. Prod never calls this; tests do.
    await this.client.call('DEL', this.globalKey());
  }

  /** Test aid: current totals (not part of SpendStore). */
  async snapshot(userId: string): Promise<{ global: number; user: number }> {
    const g = await this.client.call('GET', this.globalKey());
    const u = await this.client.call('GET', this.userKey(userId));
    return { global: Number(g ?? 0), user: Number(u ?? 0) };
  }
}

// ============================================================
// Store selection (memoized).
// ============================================================
let memoStore: SpendStore | null = null;

function getStore(): SpendStore {
  if (memoStore) return memoStore;
  if (config.redis.url) {
    const client = getRedisClient();
    if (client) {
      logger.startup('✓ AI spend cap using shared Redis store');
      memoStore = new RedisSpendStore(client);
      return memoStore;
    }
    // REDIS_URL set but the client couldn't be built — fall back loudly rather
    // than crash; the cap reverts to per-instance precision until Redis is back.
    aiCostLogger.error(
      'REDIS_URL set but Redis client unavailable; AI spend cap falling back to per-instance memory'
    );
  }
  memoStore = new InMemorySpendStore();
  return memoStore;
}

// ============================================================
// Public API
// ============================================================

/**
 * Atomically reserve and decide admission for an in-flight AI call. The caller
 * (aiSpendGuard) registers the returned settle() on response completion. May
 * REJECT if the shared store errors — the guard treats that as fail-closed.
 */
export function admitAISpend(userId: string): Promise<Admission> {
  return getStore().admit(userId);
}

/** Test-only: reset the accumulator and re-select the store. */
export async function __resetAISpendForTests(): Promise<void> {
  if (memoStore) await memoStore.reset();
  memoStore = null;
}

/**
 * Log AI API usage with estimated cost AND add it to the rolling daily spend
 * accumulator. Call after every successful Claude API response. Keeps its `void`
 * signature so the (many) call sites need no `await`; the store write is
 * fire-and-forget with its own error handling, so a Redis blip here can never
 * throw into the request path or silently break a caller.
 */
export function trackAIUsage(record: AIUsageInput): void {
  const pricing = PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929'];
  const estimatedCostUsd = (record.inputTokens * pricing.input) + (record.outputTokens * pricing.output);

  void getStore()
    .record(record.userId, estimatedCostUsd)
    .catch((err) => {
      aiCostLogger.error('Failed to record AI spend', {
        userId: record.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  aiCostLogger.info('AI API usage', {
    endpoint: record.endpoint,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedCostUsd: estimatedCostUsd.toFixed(6),
    userId: record.userId,
  });
}

interface DocumentAIUsageInput {
  endpoint: string;
  pages: number;
  userId: string;
}

/**
 * OF-02 (was H-3): log Google Document AI OCR usage AND add its per-page dollar
 * cost to the SAME rolling daily accumulator trackAIUsage feeds. Because the
 * OCR entry points already sit behind aiSpendGuard, accruing the real cost here
 * is what makes the 503 fail-closed breaker actually bound OCR spend — before
 * this, only Claude tokens counted against AI_DAILY_BUDGET_USD. Call after
 * every successful processDocument response (the cost is incurred once Google
 * returns, even if downstream extraction later fails). Same fire-and-forget
 * store-write semantics as trackAIUsage.
 */
export function trackDocumentAIUsage(record: DocumentAIUsageInput): void {
  const costUsd = record.pages * config.ai.documentAiCostPerPageUsd;

  void getStore()
    .record(record.userId, costUsd)
    .catch((err) => {
      aiCostLogger.error('Failed to record Document AI spend', {
        userId: record.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  aiCostLogger.info('Document AI usage', {
    endpoint: record.endpoint,
    pages: record.pages,
    estimatedCostUsd: costUsd.toFixed(6),
    userId: record.userId,
  });
}
