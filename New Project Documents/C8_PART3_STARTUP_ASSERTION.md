# C-8 Part 3 — Startup Assertion (companion to runbook)

This is the code change that goes with the C-8 Part 3 runbook. Execute it **after** the runbook's Steps 1-4 succeed, not before.

## What it does

Adds a startup check that refuses to boot the backend in production if it detects that the connected Postgres role has `BYPASSRLS` attribute. Prevents someone from accidentally switching the `DATABASE_URL` back to a superuser role (or deploying against a fresh DB where `omh_app` was never created) and silently losing all RLS enforcement.

## The change

In `backend/src/services/database.ts`, locate the `initializeDatabase` function. After the "Database connected" success log line and before the "Encryption service" block, add a new try/catch:

```typescript
// C-8 Part 3: Refuse to start in production if connected as a superuser/BYPASSRLS role.
// RLS is the DB-layer enforcement for tenant isolation; under a BYPASSRLS role, every
// policy defined in 20260107_add_rls_policies is silently skipped by Postgres.
if (process.env.NODE_ENV === 'production') {
  try {
    const result = await prisma.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;

    if (result.length === 0) {
      throw new Error('Could not determine current database role');
    }

    const { rolsuper, rolbypassrls } = result[0];
    if (rolsuper || rolbypassrls) {
      throw new Error(
        `Database role has BYPASSRLS or SUPERUSER attribute (rolsuper=${rolsuper}, rolbypassrls=${rolbypassrls}). ` +
        `RLS policies would be silently skipped. See C-8 Part 3 runbook for role setup.`
      );
    }

    logger.startup('✓ Database role verified (NOBYPASSRLS, NOSUPERUSER)');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('FATAL: Database role assertion failed', { data: { error: errorMessage } });
    throw new Error(
      `FATAL: Cannot start server - database role does not meet security requirements.\n` +
      `Production requires a NOBYPASSRLS NOSUPERUSER role (see C-8 Part 3 runbook).\n` +
      `Error: ${errorMessage}`
    );
  }
}
```

## Where to put it

```typescript
// ... existing code in initializeDatabase() ...

  // Test database connection - MUST succeed
  try {
    await prisma.$connect();
    logger.startup('✓ Database connected');
  } catch (error) {
    // ... existing catch ...
  }

  // >>> INSERT THE NEW ASSERTION HERE <<<

  // Initialize encryption service - MUST succeed
  try {
    encryptionService = getEncryptionService();
    logger.startup('✓ Encryption service initialized');
  } catch (error) {
    // ... existing catch ...
  }
```

## Why production-only

- In development, you may be running against a local Postgres where you're the superuser. That's fine for dev — you're not storing real PHI there.
- In CI, tests run against throwaway containers that use the default superuser. The assertion would break CI without adding safety.
- `NODE_ENV === 'production'` is the existing gate used elsewhere in the codebase for the same reason.

If you want stricter behavior (e.g., staging must also pass the assertion), change the condition to include staging:
```typescript
if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
```

## Test

Add a test to `backend/src/services/database.test.ts` (create the file if it doesn't exist):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('initializeDatabase — C-8 Part 3 role assertion', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
  });

  it('throws in production if connected role has BYPASSRLS', async () => {
    // Mock prisma.$queryRaw to return a BYPASSRLS role
    // ... full mock setup depends on existing patterns in database.test.ts ...
    // Assert that initializeDatabase() rejects with the expected message.
  });

  it('throws in production if connected role has SUPERUSER', async () => {
    // Similar setup, different query result
  });

  it('succeeds in production if role is NOSUPERUSER NOBYPASSRLS', async () => {
    // Happy path
  });

  it('skips the check in development', async () => {
    process.env.NODE_ENV = 'development';
    // Assert that initializeDatabase() does not query pg_roles
  });
});
```

If there's no existing `database.test.ts` scaffolding, skip the unit test for this PR — the E2E path (deploying to production and watching it refuse to boot under a bad role) is the real test.

## Commit plan

Single commit on a branch `fix/c8p3-startup-role-assertion`. Title: `feat(security): refuse production boot under BYPASSRLS database role (C-8 Part 3)`.

Merge AFTER the runbook cutover is complete and validated for 24 hours.
