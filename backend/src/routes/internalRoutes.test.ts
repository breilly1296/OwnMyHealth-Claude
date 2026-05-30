/**
 * internalRoutes tests (audit #38) — the Cloud Scheduler audit-cleanup endpoint.
 * Verifies it is disabled (404) without the token, rejects bad tokens (401),
 * and runs the retention cleanup with the correct token.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  token: '',
  cleanupOldLogs: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  config: {
    scheduler: {
      // Getter so each test can change the configured token freely.
      get auditCleanupToken() {
        return mocks.token;
      },
    },
  },
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => ({ cleanupOldLogs: mocks.cleanupOldLogs })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import internalRoutes from './internalRoutes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/internal', internalRoutes);
  return app;
}

const SECRET = 'a-long-shared-scheduler-secret-token';

describe('POST /api/v1/internal/audit-cleanup (#38)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = '';
    mocks.cleanupOldLogs.mockResolvedValue(0);
  });

  it('returns 404 when AUDIT_CLEANUP_TOKEN is not configured (feature off)', async () => {
    mocks.token = '';
    const res = await request(buildApp()).post('/api/v1/internal/audit-cleanup');
    expect(res.status).toBe(404);
    expect(mocks.cleanupOldLogs).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is missing or wrong', async () => {
    mocks.token = SECRET;
    const app = buildApp();

    const noTok = await request(app).post('/api/v1/internal/audit-cleanup');
    expect(noTok.status).toBe(401);

    const wrong = await request(app)
      .post('/api/v1/internal/audit-cleanup')
      .set('X-Cleanup-Token', 'wrong-token');
    expect(wrong.status).toBe(401);

    expect(mocks.cleanupOldLogs).not.toHaveBeenCalled();
  });

  it('runs the retention cleanup with the correct token', async () => {
    mocks.token = SECRET;
    mocks.cleanupOldLogs.mockResolvedValue(7);

    const res = await request(buildApp())
      .post('/api/v1/internal/audit-cleanup')
      .set('X-Cleanup-Token', SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { deletedCount: 7 } });
    expect(mocks.cleanupOldLogs).toHaveBeenCalledTimes(1);
  });
});
