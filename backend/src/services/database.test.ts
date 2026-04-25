/**
 * C-8 unit tests for the RLS database wrapper + startup assertion.
 *
 * Two scopes:
 *
 *   PR A — `withRLSContext` / `withRLSTransaction` issue the correct
 *   parameterized `set_config(...)` calls on the transaction client so the
 *   `app.current_user_id` and `app.is_admin` GUCs reflect the caller's
 *   intent. Live-DB behavioral coverage (tenants isolated, admin sees all)
 *   lives in rls.test.ts; this file pins the SQL contract without a DB.
 *
 *   PR C — `assertNoBypassRLS` is the safety net that prevents a silent
 *   regression if DATABASE_URL ever points back at a superuser. Production
 *   must hard-exit on BYPASSRLS=true; non-prod logs a warning and keeps
 *   booting (dev DBs are commonly the superuser, staging may not have
 *   omh_app provisioned). These tests lock that contract in.
 *
 * Why both `app.current_user_id` and `app.is_admin` are always set: SET LOCAL
 * is transaction-scoped, but the pooled connection can carry a different
 * session-level value between transactions. Writing both explicitly every
 * time prevents a previous request's admin flag from leaking into the next
 * caller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -- Hoisted mocks: shared between the vi.mock factories (which run at
// hoist time) and the test bodies (which run later). The config object
// is hoisted as a mutable reference so individual tests can flip
// `isProduction` without re-hoisting the whole module.
const mocks = vi.hoisted(() => {
  const executeRaw = vi.fn().mockResolvedValue(0);
  const queryRaw = vi.fn().mockResolvedValue([]);
  const tx = { $executeRaw: executeRaw };
  const $transaction = vi.fn(async (fn: (t: unknown) => unknown) => fn(tx));
  const logger = {
    startup: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    executeRaw,
    queryRaw,
    tx,
    $transaction,
    logger,
    config: {
      auditSalt: 'x'.repeat(32),
      isProduction: false,
      isStaging: false,
      isDevelopment: true,
    },
  };
});

vi.mock('../../generated/prisma', () => {
  class PrismaClient {
    $connect = vi.fn().mockResolvedValue(undefined);
    $disconnect = vi.fn().mockResolvedValue(undefined);
    $transaction = mocks.$transaction;
    $queryRaw = mocks.queryRaw;
  }
  return {
    PrismaClient,
    AuditAction: {},
    ActorType: {},
    Prisma: {},
  };
});

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {},
}));

vi.mock('pg', () => ({
  Pool: class {
    end = vi.fn();
  },
}));

vi.mock('../config/index.js', () => ({
  // Getter form so tests can mutate `mocks.config.isProduction` between
  // cases without remounting the module.
  get config() {
    return mocks.config;
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    ...mocks.logger,
    createServiceLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('./encryption.js', () => ({
  getEncryptionService: vi.fn(() => ({})),
  EncryptionService: class {},
}));

vi.mock('./auditLog.js', () => ({
  getAuditLogService: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
  AuditLogService: class {},
}));

process.env.DATABASE_URL = 'postgres://unit-test@localhost/db';

import {
  disconnectDatabase,
  initializeDatabase,
  withRLSContext,
  withRLSTransaction,
} from './database.js';

// Tagged-template $executeRaw is invoked as $executeRaw(stringsArray, ...values).
// We only care about the interpolated values.
function interpolatedValueAt(callIndex: number): unknown {
  return mocks.executeRaw.mock.calls[callIndex][1];
}

describe('withRLSContext / withRLSTransaction — SET LOCAL contract (C-8 PR A)', () => {
  beforeEach(async () => {
    mocks.executeRaw.mockClear();
    mocks.$transaction.mockClear();
    mocks.queryRaw.mockReset();
    mocks.queryRaw.mockResolvedValue([]); // no BYPASSRLS rows → assertion passes
    mocks.config.isProduction = false;
    await initializeDatabase();
  });

  it('admin path (userId=null) clears current_user_id and sets is_admin=true', async () => {
    await withRLSContext(null, async () => 'ok');

    // Exactly two set_config calls — one for each GUC.
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(interpolatedValueAt(0)).toBe(''); // app.current_user_id
    expect(interpolatedValueAt(1)).toBe('true'); // app.is_admin
  });

  it('admin path via options.isAdmin=true forces admin even when a UUID is supplied', async () => {
    const uuid = '00000000-0000-0000-0000-000000000000';

    await withRLSContext(uuid, async () => 'ok', { isAdmin: true });

    expect(interpolatedValueAt(0)).toBe(''); // userId discarded
    expect(interpolatedValueAt(1)).toBe('true');
  });

  it('user path writes the UUID and explicitly writes is_admin=false', async () => {
    const uuid = '11111111-1111-1111-1111-111111111111';

    await withRLSContext(uuid, async () => 'ok');

    expect(interpolatedValueAt(0)).toBe(uuid);
    // Explicit 'false' (not skipped) — prevents a pooled connection from
    // carrying a previous admin transaction's lingering is_admin flag.
    expect(interpolatedValueAt(1)).toBe('false');
  });

  it('rejects malformed user UUIDs before opening a transaction', async () => {
    await expect(
      withRLSContext('not-a-uuid', async () => 'unreached')
    ).rejects.toThrow(/valid UUID/);

    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('withRLSTransaction admin path issues the same SET LOCAL sequence', async () => {
    await withRLSTransaction(null, async () => 'ok');

    expect(interpolatedValueAt(0)).toBe('');
    expect(interpolatedValueAt(1)).toBe('true');
  });

  it('passes the transaction client to the callback (so tx.* writes carry SET LOCAL)', async () => {
    let received: unknown;
    await withRLSContext(null, async (tx) => {
      received = tx;
      return null;
    });
    expect(received).toBe(mocks.tx);
  });
});

describe('assertNoBypassRLS — startup safety net (C-8 PR C)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Reset module-level isInitialized so initializeDatabase re-runs the
    // assertion each test. disconnectDatabase flips `isInitialized = false`
    // without nulling `prisma`, but the next initializeDatabase() reassigns
    // it from the mock class — so a fresh-looking client is fine.
    await disconnectDatabase();
    mocks.queryRaw.mockReset();
    mocks.logger.error.mockClear();
    mocks.logger.warn.mockClear();
    mocks.logger.startup.mockClear();
    mocks.config.isProduction = false;

    // Spy on process.exit and convert it to a throw — otherwise the test
    // process would actually terminate on the production-bypass branch.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('production + BYPASSRLS=true: logs FATAL and calls process.exit(1)', async () => {
    mocks.config.isProduction = true;
    mocks.queryRaw.mockResolvedValueOnce([{ rolbypassrls: true }]);

    await expect(initializeDatabase()).rejects.toThrow('process.exit(1)');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/FATAL.*Production.*BYPASSRLS.*Refusing to start/i)
    );
  });

  it('non-production + BYPASSRLS=true: logs WARNING and continues startup', async () => {
    mocks.config.isProduction = false;
    mocks.queryRaw.mockResolvedValueOnce([{ rolbypassrls: true }]);

    await initializeDatabase();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/WARNING.*BYPASSRLS/i)
    );
  });

  it('BYPASSRLS=false: logs success and continues (even in production)', async () => {
    mocks.config.isProduction = true;
    mocks.queryRaw.mockResolvedValueOnce([{ rolbypassrls: false }]);

    await initializeDatabase();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(mocks.logger.startup).toHaveBeenCalledWith(
      expect.stringContaining('RLS assertion passed')
    );
  });

  it('pg_roles query failure: logs warning, does not exit', async () => {
    mocks.config.isProduction = true;
    mocks.queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    await initializeDatabase();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'RLS assertion check failed to run',
      expect.objectContaining({
        data: expect.objectContaining({ error: 'connection refused' }),
      })
    );
  });
});
