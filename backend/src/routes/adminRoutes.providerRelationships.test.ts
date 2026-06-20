/**
 * adminRoutes — provider-relationship consent + validation regressions.
 *
 *   - REVOKED is terminal: an admin PATCH that tries to move a REVOKED
 *     relationship back to a non-REVOKED status is always rejected (403).
 *     The patient withdrew consent; only they can initiate a new share.
 *   - canEditData was removed from the update schema (.strict()), so sending it
 *     is now a 400 rather than a silently-ignored no-op.
 *   - GET /provider-relationships validates ?status against the enum, returning
 *     400 for a bad value instead of a Prisma 500.
 *
 * Supertest against a minimal Express app with auth/RBAC stubbed and the DB
 * mocked at the boundary (same pattern as adminRoutes.updateUser.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentAdmin: { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' },
  tx: {
    providerPatient: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return { demo: { enabled: false, email: '', password: '' }, security: { bcryptRounds: 10 } };
  },
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) => fn(mocks.tx)),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) => fn(mocks.tx)),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => ({
    logAccess: vi.fn(), logCreate: vi.fn(), logUpdate: vi.fn(), logDelete: vi.fn(),
  })),
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

const REL_ID = '22222222-2222-2222-2222-222222222222';

function makeRel(overrides: Record<string, unknown> = {}) {
  return {
    id: REL_ID,
    providerId: '33333333-3333-3333-3333-333333333333',
    patientId: '44444444-4444-4444-4444-444444444444',
    status: 'ACTIVE',
    canViewBiomarkers: true,
    canViewInsurance: false,
    canViewHealthNeeds: false,
    canEditData: false,
    ...overrides,
  };
}

describe('admin provider-relationships — consent + validation', () => {
  beforeEach(() => {
    mocks.tx.providerPatient.findUnique.mockReset();
    mocks.tx.providerPatient.update.mockReset();
    mocks.tx.providerPatient.findMany.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('rejects reactivating a REVOKED relationship (403) and never updates it', async () => {
    mocks.tx.providerPatient.findUnique.mockResolvedValue(makeRel({ status: 'REVOKED' }));

    const res = await request(buildApp())
      .patch(`/api/v1/admin/provider-relationships/${REL_ID}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(403);
    expect(mocks.tx.providerPatient.update).not.toHaveBeenCalled();
  });

  it('allows a status change on a non-REVOKED relationship (200)', async () => {
    mocks.tx.providerPatient.findUnique.mockResolvedValue(makeRel({ status: 'ACTIVE' }));
    mocks.tx.providerPatient.update.mockResolvedValue(makeRel({ status: 'SUSPENDED' }));

    const res = await request(buildApp())
      .patch(`/api/v1/admin/provider-relationships/${REL_ID}`)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(200);
    expect(mocks.tx.providerPatient.update).toHaveBeenCalledTimes(1);
  });

  it('rejects the removed canEditData key (422, strict schema)', async () => {
    const res = await request(buildApp())
      .patch(`/api/v1/admin/provider-relationships/${REL_ID}`)
      .send({ canEditData: true });

    expect(res.status).toBe(422);
    expect(mocks.tx.providerPatient.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a bad ?status filter on the list endpoint (422, not a 500)', async () => {
    const res = await request(buildApp())
      .get('/api/v1/admin/provider-relationships?status=NOPE');

    expect(res.status).toBe(422);
    expect(mocks.tx.providerPatient.findMany).not.toHaveBeenCalled();
  });

  it('accepts a valid ?status filter (200)', async () => {
    mocks.tx.providerPatient.findMany.mockResolvedValue([]);

    const res = await request(buildApp())
      .get('/api/v1/admin/provider-relationships?status=ACTIVE');

    expect(res.status).toBe(200);
    expect(mocks.tx.providerPatient.findMany).toHaveBeenCalledTimes(1);
  });
});
