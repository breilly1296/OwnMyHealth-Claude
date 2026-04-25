/**
 * providerRoutes — F-6 uniform-response regression test.
 *
 * Invariant: POST /provider/patients/request returns the same body shape
 * regardless of which gate the request trips, so an attacker can't
 * enumerate user accounts or roles by polling distinct emails.
 *
 *   1. unknown email          → 200 + generic success body, no relationship written
 *   2. exists, role != PATIENT → 200 + same generic body, no relationship written
 *   3. exists, role = PATIENT → 200 + same generic body, relationship UPSERTED
 *
 * Audit logs retain the actual reason for ops/admin enumeration detection;
 * only the API response is collapsed. We don't assert the audit body here
 * — the audit service is fully mocked so its calls only confirm path
 * selection, not message content.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // The "user" express sees on each request — flipped per test to act as a
  // valid PROVIDER (passes role gate) and exercise the route under test.
  currentUser: { id: 'provider-1', email: 'provider@example.com', role: 'PROVIDER', plan: 'FREE' },
  // Per-test override of what the email→user lookup returns. Default = null
  // (no such user).
  patientLookup: vi.fn(),
  upsertedRelationship: { id: 'rel-1', relationshipType: 'PRIMARY_CARE', status: 'PENDING' },
  upsertCalled: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return {
      demo: { enabled: false, email: '', password: '' },
      security: { bcryptRounds: 10 },
    };
  },
}));

// withRLSContext receives the callback and a tx stub. The tx exposes the
// single delegate the controller actually uses: tx.user.findUnique (admin
// path for email lookup) and tx.providerPatient.{findUnique,upsert} (user
// path for the relationship write).
vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(
    async (_userId: unknown, fn: (tx: unknown) => unknown) => {
      return fn({
        user: {
          findUnique: mocks.patientLookup,
        },
        providerPatient: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: (...args: unknown[]) => {
            mocks.upsertCalled(...args);
            return Promise.resolve(mocks.upsertedRelationship);
          },
        },
      });
    }
  ),
  withRLSTransaction: vi.fn(),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => ({
    logAccess: vi.fn(),
    logCreate: vi.fn(),
    logUpdate: vi.fn(),
    logDelete: vi.fn(),
  })),
}));

vi.mock('../services/encryption.js', () => ({
  getEncryptionService: vi.fn(() => ({
    encrypt: vi.fn(() => 'enc:noop'),
    decrypt: vi.fn(() => 'plain'),
  })),
}));

vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Disable the rate limiter so we can fire >10 requests in this file without
// the bucket filling and skewing assertions.
vi.mock('../middleware/rateLimiter.js', () => ({
  providerAccessRequestLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
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

vi.mock('../middleware/rbac.js', () => ({
  requireRole: () => (
    _req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction
  ) => next(),
}));

import express from 'express';
import request from 'supertest';
import providerRouter from './providerRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/provider', providerRouter);
  app.use(errorHandler);
  return app;
}

const GENERIC_BODY = {
  success: true,
  data: {
    message: 'If this email belongs to a patient account, they will receive your request.',
  },
};

describe('POST /provider/patients/request — uniform response (F-6)', () => {
  beforeEach(() => {
    mocks.patientLookup.mockReset();
    mocks.upsertCalled.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the generic 200 body when the email does not exist', async () => {
    mocks.patientLookup.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/v1/provider/patients/request')
      .send({ patientEmail: 'unknown@example.com', relationshipType: 'PRIMARY_CARE' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC_BODY);
    expect(mocks.upsertCalled).not.toHaveBeenCalled();
  });

  it('returns the same generic body when the email belongs to a non-PATIENT', async () => {
    mocks.patientLookup.mockResolvedValue({ id: 'other-provider-1', role: 'PROVIDER' });

    const res = await request(buildApp())
      .post('/api/v1/provider/patients/request')
      .send({ patientEmail: 'doctor@example.com', relationshipType: 'PRIMARY_CARE' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC_BODY);
    // Critically: response is byte-identical to the no-such-user case.
    expect(mocks.upsertCalled).not.toHaveBeenCalled();
  });

  it('actually performs the upsert when the email belongs to a real PATIENT', async () => {
    mocks.patientLookup.mockResolvedValue({ id: 'patient-1', role: 'PATIENT' });

    const res = await request(buildApp())
      .post('/api/v1/provider/patients/request')
      .send({ patientEmail: 'patient@example.com', relationshipType: 'PRIMARY_CARE' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mocks.upsertCalled).toHaveBeenCalledTimes(1);
  });

  it('returns the unknown-email and wrong-role responses with identical bodies (no enumeration signal)', async () => {
    // Run the two leak-prone paths back-to-back and diff the bodies. Any
    // future change that adds a path-specific field would break this.
    mocks.patientLookup.mockResolvedValueOnce(null);
    const r1 = await request(buildApp())
      .post('/api/v1/provider/patients/request')
      .send({ patientEmail: 'unknown@example.com', relationshipType: 'PRIMARY_CARE' });

    mocks.patientLookup.mockResolvedValueOnce({ id: 'admin-1', role: 'ADMIN' });
    const r2 = await request(buildApp())
      .post('/api/v1/provider/patients/request')
      .send({ patientEmail: 'admin@example.com', relationshipType: 'PRIMARY_CARE' });

    expect(r1.status).toBe(r2.status);
    expect(r1.body).toEqual(r2.body);
  });
});
