/**
 * Config regression tests (C-3).
 *
 * Verifies that `backend/src/config/index.ts` fails fast at module load when
 * JWT secrets are missing, empty, too short, or set to a known-weak
 * placeholder — in EVERY environment, not just NODE_ENV=production.
 *
 * Bug-demonstration value: before the fix, `JWT_ACCESS_SECRET` and
 * `JWT_REFRESH_SECRET` had `||` fallbacks to literal strings, and the
 * "must be changed from default" gate only ran under
 * `if (config.isProduction)`. Staging/dev/preview deploys with NODE_ENV
 * unset silently loaded the public repo strings as signing keys. Every
 * test in this file is expected to FAIL against pre-C-3 code and PASS
 * against post-C-3 code.
 *
 * Implementation note: because `config/index.ts` runs its validation at
 * import time, each test does `vi.resetModules()` + a fresh
 * `await import('./index.js')`. dotenv is mocked so the repo's real
 * `.env` can't bleed required values into the isolated process.env.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

function validEnv() {
  process.env.NODE_ENV = 'development';
  process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.PHI_ENCRYPTION_KEY = '0'.repeat(64);
}

describe('config — JWT secrets (C-3)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Strip any pre-existing JWT vars so each test starts from a clean slate.
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.NODE_ENV;
    delete process.env.DATABASE_URL;
    delete process.env.PHI_ENCRYPTION_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when JWT_ACCESS_SECRET is missing, even in development', async () => {
    validEnv();
    delete process.env.JWT_ACCESS_SECRET;

    await expect(import('./index.js')).rejects.toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws when JWT_ACCESS_SECRET is empty string, even in development', async () => {
    validEnv();
    process.env.JWT_ACCESS_SECRET = '';

    await expect(import('./index.js')).rejects.toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws when JWT_ACCESS_SECRET is whitespace only, even in development', async () => {
    validEnv();
    process.env.JWT_ACCESS_SECRET = '   ';

    await expect(import('./index.js')).rejects.toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws when JWT_REFRESH_SECRET is missing, even in development', async () => {
    validEnv();
    delete process.env.JWT_REFRESH_SECRET;

    await expect(import('./index.js')).rejects.toThrow(/JWT_REFRESH_SECRET/);
  });

  it('throws when JWT_ACCESS_SECRET matches a known-weak placeholder', async () => {
    validEnv();
    process.env.JWT_ACCESS_SECRET = 'access-secret-change-in-production';

    await expect(import('./index.js')).rejects.toThrow(/known-weak placeholder/);
  });

  it('throws when JWT_REFRESH_SECRET matches a known-weak placeholder', async () => {
    validEnv();
    process.env.JWT_REFRESH_SECRET = 'refresh-secret-change-in-production';

    await expect(import('./index.js')).rejects.toThrow(/known-weak placeholder/);
  });

  it('throws when JWT_ACCESS_SECRET is shorter than 32 characters, even in development', async () => {
    validEnv();
    process.env.JWT_ACCESS_SECRET = 'short';

    await expect(import('./index.js')).rejects.toThrow(/at least 32 characters/);
  });

  it('throws when JWT_REFRESH_SECRET is shorter than 32 characters, even in development', async () => {
    validEnv();
    process.env.JWT_REFRESH_SECRET = 'short';

    await expect(import('./index.js')).rejects.toThrow(/at least 32 characters/);
  });

  it('loads successfully when all required secrets are set with valid values', async () => {
    validEnv();

    const mod = await import('./index.js');
    expect(mod.config.jwt.accessSecret).toBe('a'.repeat(40));
    expect(mod.config.jwt.refreshSecret).toBe('b'.repeat(40));
  });

  it('does not expose legacy jwt.secret or jwt.expiresIn fields', async () => {
    validEnv();

    const mod = await import('./index.js');
    expect((mod.config.jwt as Record<string, unknown>).secret).toBeUndefined();
    expect((mod.config.jwt as Record<string, unknown>).expiresIn).toBeUndefined();
  });
});
