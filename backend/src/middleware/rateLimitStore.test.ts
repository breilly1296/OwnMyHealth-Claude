/**
 * rateLimitStore fallback test (#37).
 *
 * The safety-critical invariant for this flag-gated feature: when REDIS_URL is
 * unset (the default — dev, test, CI, and prod until Memorystore is
 * provisioned), createRateLimitStore must return undefined so express-rate-limit
 * keeps using its in-process MemoryStore. The Redis-backed path is exercised by
 * the operator after provisioning. testSetup does not set REDIS_URL, so
 * config.redis.url is '' here.
 */

import { describe, it, expect } from 'vitest';
import { createRateLimitStore, __resetRateLimitStoreForTest } from './rateLimitStore.js';

describe('createRateLimitStore (#37)', () => {
  it('returns undefined when REDIS_URL is unset (MemoryStore default preserved)', () => {
    __resetRateLimitStoreForTest();
    expect(createRateLimitStore('standard')).toBeUndefined();
    expect(createRateLimitStore('strict-auth')).toBeUndefined();
    expect(createRateLimitStore('ai')).toBeUndefined();
  });
});
