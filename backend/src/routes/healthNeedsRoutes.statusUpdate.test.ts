/**
 * healthNeedsRoutes PATCH /:id — teardown finding #2 regression tests.
 *
 * The frontend (healthNeedsApi.updateStatus) PATCHes /health-needs/:id with
 * body { status }. A previous client build PATCHed /health-needs/:id/status,
 * which the backend never mounted — every status transition 404'd. These
 * tests pin the contract the client actually uses:
 *   1. PATCH /:id with { status } passes validation and reaches
 *      updateHealthNeedStatus.
 *   2. The legacy /:id/status path is NOT served (404) — if someone mounts
 *      it, the client fix should be revisited rather than forked.
 *   3. Invalid status values are rejected with 422 before the handler runs.
 *
 * Uses supertest against a minimal Express app (same pattern as
 * biomarkerRoutes.guidance.test.ts) with auth/rate-limit stubbed and the
 * REAL validation middleware so schema regressions surface here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Hoisted mocks -------------------------------------------------------
const mocks = vi.hoisted(() => ({
  updateHealthNeedStatus: vi.fn(),
}));

// Controller stub — only the route under test responds; the rest exist so
// the router mounts.
vi.mock('../controllers/healthNeedsController.js', () => ({
  getHealthNeeds: vi.fn(),
  getHealthNeed: vi.fn(),
  createHealthNeed: vi.fn(),
  updateHealthNeedStatus: (
    req: import('express').Request,
    res: import('express').Response
  ) => {
    mocks.updateHealthNeedStatus(req.params, req.body);
    res.json({ success: true, data: { id: req.params.id, ...req.body } });
  },
  deleteHealthNeed: vi.fn(),
  analyzeHealthNeeds: vi.fn(),
  getHealthNeedsSummary: vi.fn(),
}));

// Stub authenticate so every request is an authenticated PATIENT.
vi.mock('../middleware/auth.js', () => ({
  authenticate: (
    req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    (req as { user?: { id: string; role: string; email: string } }).user = {
      id: 'user-A',
      role: 'PATIENT',
      email: 'test@example.com',
    };
    next();
  },
}));

vi.mock('../middleware/rateLimiter.js', () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// -- Imports AFTER mocks -------------------------------------------------
import express from 'express';
import request from 'supertest';
import healthNeedsRouter from './healthNeedsRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/health-needs', healthNeedsRouter);
  app.use(errorHandler);
  return app;
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('PATCH /health-needs/:id (status update contract)', () => {
  beforeEach(() => {
    mocks.updateHealthNeedStatus.mockReset();
  });

  it('reaches the handler with { status } on the path the client uses', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/health-needs/${VALID_UUID}`)
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { id: VALID_UUID, status: 'COMPLETED' },
    });
    expect(mocks.updateHealthNeedStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateHealthNeedStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: VALID_UUID }),
      { status: 'COMPLETED' }
    );
  });

  it('does NOT serve the legacy /:id/status path (the pre-fix client 404)', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/health-needs/${VALID_UUID}/status`)
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(404);
    expect(mocks.updateHealthNeedStatus).not.toHaveBeenCalled();
  });

  it('rejects an invalid status with 422 before the handler runs', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/v1/health-needs/${VALID_UUID}`)
      .send({ status: 'NOT_A_STATUS' });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(mocks.updateHealthNeedStatus).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID id with 422 before the handler runs', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch('/api/v1/health-needs/not-a-uuid')
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(422);
    expect(mocks.updateHealthNeedStatus).not.toHaveBeenCalled();
  });
});
