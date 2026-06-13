/**
 * Rate-limit store factory (audit #37).
 *
 * express-rate-limit defaults to an in-process MemoryStore, so on Cloud Run
 * each instance keeps its own counters — the effective ceiling is N×limit
 * across N instances (login brute-force cap of 5 becomes 5N, the AI cost cap
 * of 10/hr becomes 10N/hr). Today that's bounded by `--max-instances=3`.
 *
 * This module backs the limiters with a SHARED Redis store (Cloud Memorystore)
 * when `REDIS_URL` is set, so counters are consistent across instances and the
 * rate-limit posture is decoupled from the max-instances pin. When `REDIS_URL`
 * is unset (the default, and all current dev/test/CI), `createRateLimitStore`
 * returns `undefined` and express-rate-limit falls back to MemoryStore —
 * behavior is unchanged. Flip it on only after provisioning + monitoring Redis.
 */

import type { Store } from 'express-rate-limit';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// Lazily-created singleton client, shared by every limiter's store. Typed
// loosely (the ioredis import is dynamic) so this module has no hard dependency
// at load time when Redis is disabled.
export interface RedisLike {
  call(command: string, ...args: (string | number)[]): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

let client: RedisLike | null = null;
let initialized = false;

/**
 * The shared ioredis client, or null when Redis is disabled (`REDIS_URL` unset)
 * or could not be constructed. Exported so OTHER cross-instance controls (e.g.
 * the AI spend cap in aiCostTracker) reuse this ONE connection rather than
 * opening a second. Same fail-fast tuning (maxRetriesPerRequest / no offline
 * queue) applies — callers decide their own fail-open vs fail-closed posture on
 * a command error.
 */
export function getRedisClient(): RedisLike | null {
  if (!config.redis.url) return null;
  if (initialized) return client;
  initialized = true;

  try {
    // Require lazily so environments with Redis disabled never load ioredis.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis');
    client = new Redis(config.redis.url, {
      // Fail fast instead of buffering commands forever if Redis is unreachable;
      // surfaces a clear error rather than silently hanging requests.
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    }) as RedisLike;
    client.on('error', (err: unknown) => {
      logger.error('Rate-limit Redis client error', {
        prefix: 'RateLimit',
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    });
    logger.startup('✓ Rate limiters using shared Redis store');
  } catch (err) {
    // If ioredis can't be loaded/constructed, fall back to MemoryStore rather
    // than crash boot — log loudly so the misconfig is visible.
    logger.error('Failed to initialize Redis rate-limit store; using MemoryStore', {
      prefix: 'RateLimit',
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    client = null;
  }
  return client;
}

/**
 * Build a per-limiter store. Each limiter MUST pass a distinct `prefix` so
 * their buckets don't collide in the shared key space. Returns `undefined`
 * when Redis is disabled (→ express-rate-limit's default MemoryStore).
 */
export function createRateLimitStore(prefix: string): Store | undefined {
  const c = getRedisClient();
  if (!c) return undefined;

  // Imported here (not top-level) so the dependency only loads when Redis is on.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RedisStore } = require('rate-limit-redis');
  return new RedisStore({
    sendCommand: (...args: string[]) => c.call(args[0], ...args.slice(1)),
    prefix: `rl:${prefix}:`,
  }) as Store;
}

/** Test-only: reset the memoized client so REDIS_URL changes take effect. */
export function __resetRateLimitStoreForTest(): void {
  client = null;
  initialized = false;
}
