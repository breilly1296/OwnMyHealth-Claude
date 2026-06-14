/**
 * providerRoutes — M3/L35 regression test for GET /provider/patients/:id/insurance.
 *
 * The whole point of M3 is that the patient's `canViewInsurance` consent flag is
 * now LOAD-BEARING. These prove it: the route returns the patient's decrypted
 * insurance only when consent is ACTIVE, unexpired, and the flag is granted, and
 * 403s (without touching the insurance table) otherwise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: { id: 'provider-1', email: 'provider@example.com', role: 'PROVIDER', plan: 'FREE' },
  findRel: vi.fn(),
  findPatient: vi.fn(),
  findPlans: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return { demo: { enabled: false, email: '', password: '' }, security: { bcryptRounds: 10 } };
  },
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      providerPatient: { findUnique: mocks.findRel },
      user: { findFirst: mocks.findPatient },
      insurancePlan: { findMany: mocks.findPlans },
    })
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
    decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
  })),
}));

vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const URL = `/api/v1/provider/patients/${PATIENT_ID}/insurance`;

function relRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rel-1',
    providerId: 'provider-1',
    patientId: PATIENT_ID,
    canViewBiomarkers: true,
    canViewInsurance: true,
    canViewHealthNeeds: true,
    canEditData: false,
    relationshipType: 'PRIMARY_CARE',
    status: 'ACTIVE',
    consentGrantedAt: new Date('2026-01-01'),
    consentExpiresAt: null,
    notesEncrypted: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function planRow() {
  return {
    id: 'plan-1',
    userId: PATIENT_ID,
    planName: 'Gold PPO',
    insurerName: 'Acme Health',
    planType: 'PPO',
    planIdNumber: null,
    memberIdEncrypted: null,
    groupIdEncrypted: null,
    effectiveDate: new Date('2026-01-01'),
    terminationDate: null,
    premiumMonthly: null,
    deductibleIndividual: 1000,
    deductibleFamily: 2000,
    oopMaxIndividual: 5000,
    oopMaxFamily: 10000,
    extractedFromSbc: false,
    sbcExtractionConfidence: null,
    isActive: true,
    isPrimary: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    benefits: [],
  };
}

describe('GET /provider/patients/:id/insurance — canViewInsurance is load-bearing (M3/L35)', () => {
  beforeEach(() => {
    mocks.findRel.mockReset();
    mocks.findPatient.mockReset().mockResolvedValue({ id: PATIENT_ID });
    mocks.findPlans.mockReset().mockResolvedValue([planRow()]);
  });

  afterEach(() => vi.clearAllMocks());

  it('returns the decrypted insurance when consent is ACTIVE + unexpired + canViewInsurance', async () => {
    mocks.findRel.mockResolvedValue(relRow({ canViewInsurance: true }));

    const res = await request(buildApp()).get(URL);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].planName).toBe('Gold PPO');
  });

  it('403s and never queries insurance when canViewInsurance is false (the toggle now blocks)', async () => {
    mocks.findRel.mockResolvedValue(relRow({ canViewInsurance: false }));

    const res = await request(buildApp()).get(URL);

    expect(res.status).toBe(403);
    // Resolver short-circuits before touching the insurance table.
    expect(mocks.findPlans).not.toHaveBeenCalled();
  });

  it('403s when the relationship is not ACTIVE (REVOKED)', async () => {
    mocks.findRel.mockResolvedValue(relRow({ status: 'REVOKED', canViewInsurance: true }));

    const res = await request(buildApp()).get(URL);

    expect(res.status).toBe(403);
    expect(mocks.findPlans).not.toHaveBeenCalled();
  });

  it('403s when consent has expired even with the flag granted', async () => {
    mocks.findRel.mockResolvedValue(
      relRow({ canViewInsurance: true, consentExpiresAt: new Date('2020-01-01') })
    );

    const res = await request(buildApp()).get(URL);

    expect(res.status).toBe(403);
    expect(mocks.findPlans).not.toHaveBeenCalled();
  });

  it('403s when there is no relationship at all', async () => {
    mocks.findRel.mockResolvedValue(null);

    const res = await request(buildApp()).get(URL);

    expect(res.status).toBe(403);
  });
});
