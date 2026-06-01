/**
 * adminRoutes — F-41 + F-42 regression tests for PUT /api/v1/admin/users/:id.
 *
 * Two invariants:
 *
 *   F-41 — when an admin resets a target user's password, every existing
 *   session for that user is wiped in the same transaction. Without this
 *   the compromised credential keeps a valid refresh token on the attacker
 *   side until the next 7-day session expiry.
 *
 *   F-42 — an admin cannot change their own role. Stops accidental
 *   self-demotion locking out the only admin account; legitimate
 *   self-edits to non-role fields still pass.
 *
 * Uses supertest against a minimal Express app with auth/RBAC stubbed and
 * the database service mocked at the boundary so we can observe which
 * delegate methods fire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -- Hoisted mocks -------------------------------------------------------
const mocks = vi.hoisted(() => ({
  currentAdmin: {
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'ADMIN',
  },
  // Single shared tx stub. Each test seeds findUnique/update/deleteMany
  // results before issuing the request.
  tx: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
  },
  bcryptHash: vi.fn(async (pw: string) => `hashed:${pw}`),
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return {
      demo: { enabled: false, email: '', password: '' },
      security: { bcryptRounds: 10 },
    };
  },
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mocks.tx)
  ),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mocks.tx)
  ),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => ({
    logAccess: vi.fn(),
    logCreate: vi.fn(),
    logUpdate: vi.fn(),
    logDelete: vi.fn(),
  })),
}));

vi.mock('bcryptjs', () => ({
  default: { hash: mocks.bcryptHash },
  hash: mocks.bcryptHash,
}));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/rateLimiter.js', () => ({
  sensitiveLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: (
    req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    (req as unknown as { user?: typeof mocks.currentAdmin }).user = mocks.currentAdmin;
    next();
  },
}));

vi.mock('../middleware/demoProtection.js', () => ({
  blockDemoAdminAccess: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

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
  app.use('/api/v1/admin', adminRouter);
  app.use(errorHandler);
  return app;
}

const TARGET_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '11111111-1111-1111-1111-111111111111';

function seedExistingUser(overrides: Record<string, unknown> = {}) {
  mocks.tx.user.findUnique.mockResolvedValue({
    id: TARGET_ID,
    email: 'target@example.com',
    role: 'PATIENT',
    isActive: true,
    emailVerified: true,
    ...overrides,
  });
}

describe('PUT /admin/users/:id — F-41 password reset invalidates sessions', () => {
  beforeEach(() => {
    mocks.currentAdmin = {
      id: ADMIN_ID,
      email: 'admin@example.com',
      role: 'ADMIN',
    };
    mocks.tx.user.findUnique.mockReset();
    mocks.tx.user.update.mockReset();
    mocks.tx.session.deleteMany.mockReset();
    mocks.bcryptHash.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('wipes target user sessions when password is changed', async () => {
    seedExistingUser();
    mocks.tx.user.update.mockResolvedValue({
      id: TARGET_ID,
      email: 'target@example.com',
      role: 'PATIENT',
      isActive: true,
      emailVerified: true,
      updatedAt: new Date(),
    });
    mocks.tx.session.deleteMany.mockResolvedValue({ count: 3 });

    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${TARGET_ID}`)
      .send({ password: 'NewSecurePassword123!' });

    expect(res.status).toBe(200);
    expect(mocks.tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: TARGET_ID },
    });
    // bcrypt was called once with the new password.
    expect(mocks.bcryptHash).toHaveBeenCalledWith('NewSecurePassword123!', 10);
  });

  it('does NOT touch sessions for a benign field change (no password, role change, or deactivation)', async () => {
    seedExistingUser();
    mocks.tx.user.update.mockResolvedValue({
      id: TARGET_ID,
      email: 'target@example.com',
      role: 'PATIENT',
      isActive: true,
      emailVerified: true,
      updatedAt: new Date(),
    });

    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${TARGET_ID}`)
      .send({ emailVerified: true }); // no password, no role change, no deactivation

    expect(res.status).toBe(200);
    expect(mocks.tx.session.deleteMany).not.toHaveBeenCalled();
    expect(mocks.bcryptHash).not.toHaveBeenCalled();
  });

  it('wipes target user sessions on deactivation (isActive -> false) [M-14]', async () => {
    seedExistingUser();
    mocks.tx.user.update.mockResolvedValue({
      id: TARGET_ID,
      email: 'target@example.com',
      role: 'PATIENT',
      isActive: false,
      emailVerified: true,
      updatedAt: new Date(),
    });
    mocks.tx.session.deleteMany.mockResolvedValue({ count: 2 });

    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${TARGET_ID}`)
      .send({ isActive: false });

    // M-14: deactivation must cut existing sessions so a stale refresh token
    // can't keep operating after the account was disabled.
    expect(res.status).toBe(200);
    expect(mocks.tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: TARGET_ID },
    });
    expect(mocks.bcryptHash).not.toHaveBeenCalled();
  });
});

describe('PUT /admin/users/:id — F-42 self-demotion guard', () => {
  beforeEach(() => {
    mocks.currentAdmin = {
      id: ADMIN_ID,
      email: 'admin@example.com',
      role: 'ADMIN',
    };
    mocks.tx.user.findUnique.mockReset();
    mocks.tx.user.update.mockReset();
    mocks.tx.session.deleteMany.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an admin trying to change their own role', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${ADMIN_ID}`)
      .send({ role: 'PATIENT' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      error: { message: expect.stringMatching(/own role/i) },
    });
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
  });

  it('allows an admin to update other (non-role) fields on themselves', async () => {
    seedExistingUser({ id: ADMIN_ID, email: 'admin@example.com', role: 'ADMIN' });
    mocks.tx.user.findUnique.mockResolvedValue({
      id: ADMIN_ID,
      email: 'admin@example.com',
      role: 'ADMIN',
      isActive: true,
      emailVerified: true,
    });
    mocks.tx.user.update.mockResolvedValue({
      id: ADMIN_ID,
      email: 'admin@example.com',
      role: 'ADMIN',
      isActive: true,
      emailVerified: false,
      updatedAt: new Date(),
    });

    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${ADMIN_ID}`)
      .send({ emailVerified: false }); // not the role field

    expect(res.status).toBe(200);
    expect(mocks.tx.user.update).toHaveBeenCalled();
  });

  it('allows an admin to change someone else\'s role (and wipes their sessions) [M-14]', async () => {
    seedExistingUser();
    mocks.tx.user.update.mockResolvedValue({
      id: TARGET_ID,
      email: 'target@example.com',
      role: 'PROVIDER',
      isActive: true,
      emailVerified: true,
      updatedAt: new Date(),
    });
    mocks.tx.session.deleteMany.mockResolvedValue({ count: 1 });

    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${TARGET_ID}`)
      .send({ role: 'PROVIDER' });

    expect(res.status).toBe(200);
    expect(mocks.tx.user.update).toHaveBeenCalled();
    // M-14: a privilege change must cut the target's existing sessions so an
    // already-issued refresh token can't keep operating under the old role.
    expect(mocks.tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: TARGET_ID },
    });
  });
});
