/**
 * Tests for the AI spend circuit breaker (aiCostTracker).
 *
 * Covers both storage backends with the same reserve-first semantics:
 *  - InMemorySpendStore (per-process default)
 *  - RedisSpendStore (shared across instances) via a faithful fake ioredis
 *    client — proves cross-instance visibility + atomic reserve/refund without
 *    needing a live Redis.
 * Plus the module wiring (admitAISpend / trackAIUsage on the default store).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config/index.js';
import type { RedisLike } from '../middleware/rateLimitStore.js';
import {
  admitAISpend,
  trackAIUsage,
  trackDocumentAIUsage,
  __resetAISpendForTests,
  InMemorySpendStore,
  RedisSpendStore,
} from './aiCostTracker.js';

const USER_CAP = config.ai.userDailyBudgetUsd;
const GLOBAL_CAP = config.ai.dailyBudgetUsd;
const OCR_RATE = config.ai.documentAiCostPerPageUsd;
const RES = 0.05; // RESERVATION_USD

const flush = () => new Promise((r) => setTimeout(r, 0));

// Sonnet 4.5 output price per token (matches the PRICING table).
const SONNET_OUT_PER_TOKEN = 15.0 / 1_000_000;
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

/**
 * Faithful single-key fake of the Redis commands RedisSpendStore uses.
 * INCRBYFLOAT is atomic + returns the new value as a string (as ioredis does),
 * which is exactly the property the cross-instance gate relies on.
 */
function makeFakeRedis() {
  const store = new Map<string, number>();
  const expireKeys: string[] = [];
  const client = {
    call: vi.fn(async (command: string, ...args: (string | number)[]) => {
      const cmd = command.toUpperCase();
      const key = String(args[0]);
      if (cmd === 'INCRBYFLOAT') {
        const v = (store.get(key) ?? 0) + Number(args[1]);
        store.set(key, v);
        return String(v);
      }
      if (cmd === 'EXPIRE') {
        expireKeys.push(key);
        return 1;
      }
      if (cmd === 'GET') {
        const v = store.get(key);
        return v === undefined ? null : String(v);
      }
      if (cmd === 'DEL') {
        store.delete(key);
        return 1;
      }
      throw new Error(`fake redis: unexpected command ${cmd}`);
    }),
    on: vi.fn(),
  } as unknown as RedisLike;
  return { client, store, expireKeys };
}

describe('InMemorySpendStore (per-process)', () => {
  it('admits a fresh user under budget', async () => {
    const store = new InMemorySpendStore();
    const a = await store.admit('u');
    expect(a.admitted).toBe(true);
    expect(a.scope).toBeNull();
  });

  it.runIf(GLOBAL_CAP > 0)('blocks every user once the global budget is reached (global scope)', async () => {
    const store = new InMemorySpendStore();
    await store.record('whale', GLOBAL_CAP); // global at cap
    const a = await store.admit('newcomer'); // reservation pushes over
    expect(a.admitted).toBe(false);
    expect(a.scope).toBe('global');
  });

  it.runIf(USER_CAP > 0 && GLOBAL_CAP > USER_CAP)(
    'blocks a user at their per-user cap, leaving others unaffected (user scope)',
    async () => {
      const store = new InMemorySpendStore();
      await store.record('u', USER_CAP);
      const blocked = await store.admit('u');
      expect(blocked.admitted).toBe(false);
      expect(blocked.scope).toBe('user');
      const other = await store.admit('u2');
      expect(other.admitted).toBe(true);
    }
  );

  it.runIf(USER_CAP > 0.2)(
    'L-3: an in-flight reservation blocks the next concurrent call until it settles',
    async () => {
      const store = new InMemorySpendStore();
      await store.record('u', USER_CAP - 0.06); // room for exactly one reservation
      const a1 = await store.admit('u');
      expect(a1.admitted).toBe(true);
      const a2 = await store.admit('u'); // second concurrent call before a1 settles
      expect(a2.admitted).toBe(false);
      expect(a2.scope).toBe('user');
      a1.settle();
      const a3 = await store.admit('u');
      expect(a3.admitted).toBe(true);
      a3.settle();
    }
  );

  it.runIf(USER_CAP > 0)('settle() is idempotent — a double-call refunds only once', async () => {
    const store = new InMemorySpendStore();
    await store.record('u', 1);
    const a = await store.admit('u');
    expect(store.snapshot('u').user).toBeCloseTo(1 + RES, 5);
    a.settle();
    a.settle(); // must NOT refund twice
    expect(store.snapshot('u').user).toBeCloseTo(1, 5);
  });

  it('reset clears the accumulator', async () => {
    const store = new InMemorySpendStore();
    await store.record('u', 1);
    await store.reset();
    expect(store.snapshot('u')).toEqual({ global: 0, user: 0 });
  });
});

describe('RedisSpendStore (shared across instances)', () => {
  it.runIf(USER_CAP > 0.2)(
    'a second instance sees spend recorded by the first (shared key space) and is gated by it',
    async () => {
      const fake = makeFakeRedis();
      const instanceA = new RedisSpendStore(fake.client);
      const instanceB = new RedisSpendStore(fake.client);

      await instanceA.record('u', USER_CAP - 0.01); // spend on instance A
      const admit = await instanceB.admit('u'); // instance B's gate sees it
      expect(admit.admitted).toBe(false);
      expect(admit.scope).toBe('user');
    }
  );

  it.runIf(USER_CAP > 0.2)('a blocked admit refunds its reservation (totals unchanged)', async () => {
    const fake = makeFakeRedis();
    const store = new RedisSpendStore(fake.client);
    await store.record('u', USER_CAP - 0.01);
    const before = await store.snapshot('u');
    const admit = await store.admit('u');
    expect(admit.admitted).toBe(false);
    const after = await store.snapshot('u');
    expect(after.user).toBeCloseTo(before.user, 5); // reservation backed out
  });

  it('record writes the real cost to BOTH the global and per-user keys', async () => {
    const fake = makeFakeRedis();
    const store = new RedisSpendStore(fake.client);
    await store.record('u', 1);
    const snap = await store.snapshot('u');
    expect(snap.global).toBeCloseTo(1, 5);
    if (USER_CAP > 0) expect(snap.user).toBeCloseTo(1, 5);
  });

  it('sets a TTL after every increment (so a fresh key cannot leak forever)', async () => {
    const fake = makeFakeRedis();
    const store = new RedisSpendStore(fake.client);
    await store.record('u', 0.1);
    expect(fake.expireKeys.length).toBeGreaterThan(0);
  });

  it('an admitted reservation is backed out by settle()', async () => {
    const fake = makeFakeRedis();
    const store = new RedisSpendStore(fake.client);
    const a = await store.admit('u');
    expect(a.admitted).toBe(true);
    expect((await store.snapshot('u')).global).toBeCloseTo(RES, 5);
    a.settle();
    await flush(); // settle's refund is fire-and-forget
    expect((await store.snapshot('u')).global).toBeCloseTo(0, 5);
  });
});

describe('module wiring (admitAISpend / trackAIUsage on the default store)', () => {
  beforeEach(async () => {
    await __resetAISpendForTests();
  });

  it('admits a fresh user', async () => {
    const a = await admitAISpend('user-1');
    expect(a.admitted).toBe(true);
  });

  it.runIf(GLOBAL_CAP > 0)('trackAIUsage feeds the cap so the gate eventually refuses', async () => {
    spend('whale', GLOBAL_CAP + 1);
    await flush(); // trackAIUsage's store write is fire-and-forget
    const a = await admitAISpend('whale');
    expect(a.admitted).toBe(false);
    expect(a.scope).toBe('global');
  });

  // OF-02 (was H-3): Document AI OCR dollars must trip the SAME breaker Claude
  // spend does — the whole point of the fix is that aiSpendGuard's 503 now
  // bounds OCR cost too.
  it.runIf(GLOBAL_CAP > 0 && OCR_RATE > 0)(
    'trackDocumentAIUsage feeds the same cap so the gate refuses (global scope)',
    async () => {
      const pagesOverGlobal = Math.ceil((GLOBAL_CAP + 1) / OCR_RATE);
      trackDocumentAIUsage({ endpoint: 'test-ocr', pages: pagesOverGlobal, userId: 'ocr-whale' });
      await flush(); // fire-and-forget store write
      const a = await admitAISpend('ocr-whale');
      expect(a.admitted).toBe(false);
      expect(a.scope).toBe('global');
    }
  );

  it.runIf(USER_CAP > 0 && GLOBAL_CAP > USER_CAP && OCR_RATE > 0)(
    'trackDocumentAIUsage trips the per-user cap without blocking other users',
    async () => {
      // Over the user cap but well under the global cap.
      const pagesOverUser = Math.ceil((USER_CAP + 0.1) / OCR_RATE);
      trackDocumentAIUsage({ endpoint: 'test-ocr', pages: pagesOverUser, userId: 'ocr-user' });
      await flush();
      const blocked = await admitAISpend('ocr-user');
      expect(blocked.admitted).toBe(false);
      expect(blocked.scope).toBe('user');
      const other = await admitAISpend('other-user');
      expect(other.admitted).toBe(true);
      other.settle();
    }
  );

  it.runIf(OCR_RATE > 0)('a small OCR job accrues cost but does not block an under-budget user', async () => {
    trackDocumentAIUsage({ endpoint: 'test-ocr', pages: 3, userId: 'small-fry' });
    await flush();
    const a = await admitAISpend('small-fry');
    expect(a.admitted).toBe(true);
    a.settle();
  });
});
