/**
 * OF-23 config guard — STORAGE_BACKEND validation at module load.
 * Each case re-imports a fresh config (vi.resetModules) with env staged
 * first; testSetup.ts seeds the universal secrets (JWT, PHI key, audit salt).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENV_KEYS = [
  'NODE_ENV',
  'STORAGE_BACKEND',
  'ANTHROPIC_API_KEY',
  'GCP_PROCESSOR_ID',
  'DEMO_ACCOUNT_ENABLED',
  'SENDGRID_SANDBOX_MODE',
  'GCS_BUCKET_NAME',
  'CORS_ORIGIN',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // config dotenv-loads backend/.env at import; pre-set these so a developer's
  // real .env (Anthropic key, processor id, demo flags) can't trip unrelated
  // prod-tier gates before the guard under test. dotenv never overrides
  // existing values, and '' is falsy for every gate involved.
  process.env.ANTHROPIC_API_KEY = '';
  process.env.GCP_PROCESSOR_ID = '';
  process.env.DEMO_ACCOUNT_ENABLED = '';
  process.env.SENDGRID_SANDBOX_MODE = '';
  process.env.GCS_BUCKET_NAME = 'test-bucket';
  process.env.CORS_ORIGIN = 'https://app.example.test';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('config storage-backend guard (OF-23)', () => {
  it('refuses STORAGE_BACKEND=local in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.STORAGE_BACKEND = 'local';
    await expect(import('./index.js')).rejects.toThrow(
      /STORAGE_BACKEND=local cannot be used/
    );
  });

  it('refuses STORAGE_BACKEND=local in staging', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.STORAGE_BACKEND = 'local';
    await expect(import('./index.js')).rejects.toThrow(
      /STORAGE_BACKEND=local cannot be used/
    );
  });

  it('rejects unknown STORAGE_BACKEND values in any tier', async () => {
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_BACKEND = 's3';
    await expect(import('./index.js')).rejects.toThrow(/Invalid STORAGE_BACKEND/);
  });

  it('defaults to local in development and gcs in production', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.STORAGE_BACKEND;
    const dev = await import('./index.js');
    expect(dev.config.storage.backend).toBe('local');

    vi.resetModules();
    process.env.NODE_ENV = 'production';
    const prod = await import('./index.js');
    expect(prod.config.storage.backend).toBe('gcs');
  });
});
