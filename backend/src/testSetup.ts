/**
 * Vitest global setup — seeds env vars that config/index.ts validates at
 * module load. Runs before any test imports, so config can't throw on
 * missing secrets in CI where there's no .env.
 *
 * Only fills in values that aren't already set, so a real .env (local dev)
 * keeps winning. Local dev still needs real PHI_ENCRYPTION_KEY etc. — this
 * file only guards tests.
 */

const testDefaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/test',
  JWT_ACCESS_SECRET: 'test-access-secret-' + 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'test-refresh-secret-' + 'b'.repeat(32),
  PHI_ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  AUDIT_LOG_SALT: 'test-audit-salt-' + 'c'.repeat(32),
};

for (const [key, value] of Object.entries(testDefaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
