/**
 * settingsController.updateProfile — regression coverage.
 *
 * The display-name save path was flagged as a no-op stub in KNOWN_ISSUES.md
 * (frontend would spinner-then-discard). On verification, the path was
 * actually wired end-to-end already:
 *
 *   AccountSettingsPage → settingsApi.updateProfile (PATCH /settings/profile)
 *     → settingsRoutes (authenticate + blockDemoProfileUpdate + validate +
 *        asyncHandler) → settingsController.updateProfile → encrypt(name)
 *        → tx.user.update under withRLSContext(userId) → audit log.
 *
 * No coverage existed for the controller though, so this file pins the
 * contract: encryption fires, the update is RLS-scoped, the audit log lands,
 * and the response carries decrypted plaintext. Plus the validation gate
 * rejects malformed input before any DB writes happen. Plus the demo block.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'real@example.com',
    role: 'PATIENT',
  },
  tx: {
    user: {
      update: vi.fn(),
    },
  },
  auditService: {
    logUpdate: vi.fn(),
    logAccess: vi.fn(),
    logCreate: vi.fn(),
    logDelete: vi.fn(),
  },
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
}));

vi.mock('../config/index.js', () => ({
  // settingsController → storageService transitively reads config.gcp.bucketName,
  // so the mock must carry that field even though this test doesn't use storage.
  config: {
    demo: { enabled: false, email: '', password: '' },
    security: { bcryptRounds: 10 },
    gcp: { bucketName: 'test-bucket', projectId: '', credentials: '' },
  },
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) => fn(mocks.tx)),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mocks.tx)
  ),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mocks.auditService),
}));

vi.mock('../services/encryption.js', () => ({
  getEncryptionService: vi.fn(() => ({
    encrypt: mocks.encrypt,
    decrypt: mocks.decrypt,
  })),
}));

vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'test-salt'),
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
    (req as unknown as { user?: typeof mocks.currentUser }).user = mocks.currentUser;
    next();
  },
}));

vi.mock('../middleware/planGating.js', () => ({
  requirePlanFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePlanLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import request from 'supertest';
import settingsRouter from '../routes/settingsRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/settings', settingsRouter);
  app.use(errorHandler);
  return app;
}

describe('PATCH /settings/profile — display name update', () => {
  beforeEach(() => {
    mocks.currentUser = {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'real@example.com',
      role: 'PATIENT',
    };
    mocks.tx.user.update.mockReset();
    mocks.auditService.logUpdate.mockReset();
    mocks.encrypt.mockClear();
    mocks.decrypt.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('encrypts firstName/lastName, writes via tx.user.update, and audit-logs', async () => {
    mocks.tx.user.update.mockResolvedValue({
      email: 'real@example.com',
      createdAt: new Date('2026-01-01'),
      firstNameEncrypted: 'enc:Jane',
      lastNameEncrypted: 'enc:Doe',
      notificationPreferences: {},
    });

    const res = await request(buildApp())
      .patch('/api/v1/settings/profile')
      .send({ firstName: 'Jane', lastName: 'Doe' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        email: 'real@example.com',
        // Response carries decrypted plaintext.
        firstName: 'Jane',
        lastName: 'Doe',
      },
    });

    // Encryption fired for both name fields before the DB write.
    expect(mocks.encrypt).toHaveBeenCalledWith('Jane', 'test-salt');
    expect(mocks.encrypt).toHaveBeenCalledWith('Doe', 'test-salt');

    // The update payload uses the *Encrypted columns; plaintext never lands in DB.
    const updateArg = mocks.tx.user.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: mocks.currentUser.id });
    expect(updateArg.data).toEqual({
      firstNameEncrypted: 'enc:Jane',
      lastNameEncrypted: 'enc:Doe',
    });

    // Audit log records the update with field-level metadata.
    expect(mocks.auditService.logUpdate).toHaveBeenCalledWith(
      'User',
      mocks.currentUser.id,
      null,
      null,
      expect.objectContaining({ userId: mocks.currentUser.id }),
      expect.objectContaining({ fieldsUpdated: ['firstName', 'lastName'] })
    );
  });

  it('handles a partial update (firstName only)', async () => {
    mocks.tx.user.update.mockResolvedValue({
      email: 'real@example.com',
      createdAt: new Date('2026-01-01'),
      firstNameEncrypted: 'enc:Jane',
      lastNameEncrypted: null,
      notificationPreferences: {},
    });

    const res = await request(buildApp())
      .patch('/api/v1/settings/profile')
      .send({ firstName: 'Jane' });

    expect(res.status).toBe(200);

    const updateArg = mocks.tx.user.update.mock.calls[0][0];
    // Only the firstName column is in the update payload — partial update.
    expect(updateArg.data).toEqual({ firstNameEncrypted: 'enc:Jane' });
    expect(mocks.auditService.logUpdate).toHaveBeenCalledWith(
      'User',
      mocks.currentUser.id,
      null,
      null,
      expect.any(Object),
      expect.objectContaining({ fieldsUpdated: ['firstName'] })
    );
  });

  it('rejects an empty body via the Zod refinement (at least one field required)', async () => {
    const res = await request(buildApp())
      .patch('/api/v1/settings/profile')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    // No DB write or audit log when validation rejects.
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
    expect(mocks.auditService.logUpdate).not.toHaveBeenCalled();
  });

  it('rejects a firstName longer than 100 chars', async () => {
    const tooLong = 'a'.repeat(101);

    const res = await request(buildApp())
      .patch('/api/v1/settings/profile')
      .send({ firstName: tooLong });

    expect(res.status).toBe(422);
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
  });

  it('the controller targets req.user.id only — no caller-supplied userId path', async () => {
    // Even if a malicious client sends `userId` in the body, the controller
    // ignores it and writes to the authenticated user's row (line 1063
    // hardcodes `where: { id: userId }` from req.user.id). This test pins
    // that invariant: setting `userId` in the body must not change which
    // row gets written.
    mocks.tx.user.update.mockResolvedValue({
      email: 'real@example.com',
      createdAt: new Date('2026-01-01'),
      firstNameEncrypted: 'enc:Jane',
      lastNameEncrypted: null,
      notificationPreferences: {},
    });

    const attackerUserId = '99999999-9999-9999-9999-999999999999';
    await request(buildApp())
      .patch('/api/v1/settings/profile')
      .send({ firstName: 'Jane', userId: attackerUserId });

    const updateArg = mocks.tx.user.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe(mocks.currentUser.id);
    expect(updateArg.where.id).not.toBe(attackerUserId);
  });
});

describe('PATCH /settings/profile — demo block', () => {
  beforeEach(() => {
    // Demo email matches req.user.email exactly — blockDemoProfileUpdate
    // throws ForbiddenError before the controller runs.
    mocks.currentUser = {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'demo@example.com',
      role: 'PATIENT',
    };
    mocks.tx.user.update.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('blocks the demo account from editing display name', async () => {
    // Override the static config mock so demo.email matches the user's email.
    const { config } = await import('../config/index.js');
    Object.defineProperty(config, 'demo', {
      value: { enabled: true, email: 'demo@example.com', password: 'x' },
      configurable: true,
    });

    const res = await request(buildApp())
      .patch('/api/v1/settings/profile')
      .send({ firstName: 'Tampered' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      error: { message: expect.stringMatching(/demo account/i) },
    });
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
  });
});
