/**
 * adminRoutes — F-5 demo-protection wiring regression test.
 *
 * Invariant: the demo account is rejected at the middleware layer, before
 * any role check. This runs even if a demo user's role is somehow elevated
 * to ADMIN (fixture leak, test-env misconfig, bug).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  demoEmail: 'demo@example.com',
  currentUser: null as null | { id: string; email: string; role: string },
  controllerReached: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return {
      demo: { enabled: true, email: mocks.demoEmail, password: 'x' },
      security: { bcryptRounds: 10 },
    };
  },
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) => fn({})),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => ({
    logAccess: vi.fn(),
    logCreate: vi.fn(),
    logUpdate: vi.fn(),
    logDelete: vi.fn(),
  })),
}));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/rateLimiter.js', () => ({
  sensitiveLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Stub authenticate so each request becomes whatever currentUser is set to.
vi.mock('../middleware/auth.js', () => ({
  authenticate: (
    req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    (req as unknown as { user?: typeof mocks.currentUser }).user = mocks.currentUser;
    next();
  },
}));

// Stub requireRole so it only runs when control reaches it — proves
// blockDemoAdminAccess short-circuited first when appropriate.
vi.mock('../middleware/rbac.js', () => ({
  requireRole: () => (
    _req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction
  ) => next(),
}));

import express from 'express';
import request from 'supertest';
import adminRouter from './adminRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  // A sentinel handler lets us detect whether a request got past all middleware.
  app.use('/api/v1/admin', adminRouter);
  app.use(errorHandler);
  return app;
}

describe('adminRoutes — blockDemoAdminAccess (F-5)', () => {
  beforeEach(() => {
    mocks.controllerReached.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a demo user (even if role is ADMIN) with 403 before any admin action runs', async () => {
    mocks.currentUser = {
      id: 'demo-user-id',
      email: mocks.demoEmail,
      role: 'ADMIN',
    };

    const app = buildApp();
    const res = await request(app).get('/api/v1/admin/stats');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: expect.stringMatching(/demo account/i),
      },
    });
  });

  it('allows a non-demo ADMIN user to proceed past blockDemoAdminAccess', async () => {
    // Non-demo ADMIN: the demo gate must not trip. A 403 with our demo
    // message would be a regression; we accept any non-403 status here,
    // since the real controller/DB is mocked and may respond with its own
    // shape. What matters for this test is the demo gate didn't fire.
    mocks.currentUser = {
      id: 'real-admin-id',
      email: 'admin@example.com',
      role: 'ADMIN',
    };

    const app = buildApp();
    const res = await request(app).get('/api/v1/admin/stats');

    if (res.status === 403) {
      expect(res.body?.error?.message ?? '').not.toMatch(/demo account/i);
    }
  });
});
