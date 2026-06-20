/**
 * patientRoutes — PATCH /providers/:id response-shape regression.
 *
 * The permission update must return the documented PatientProviderRelationship
 * shape (relationshipId + nested permissions + a {id,email} provider), mirroring
 * GET /providers — NOT the raw Prisma row, which would leak the notesEncrypted
 * ciphertext + raw consent columns and break the frontend type.
 *
 * Supertest against a minimal app with auth/RBAC stubbed and the DB mocked at
 * the boundary (same pattern as adminRoutes.providerRelationships.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentPatient: { id: '11111111-1111-1111-1111-111111111111', email: 'p@example.com', role: 'PATIENT' },
  tx: {
    providerPatient: { findFirst: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) => fn(mocks.tx)),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => ({ logAccess: vi.fn(), logUpdate: vi.fn() })),
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: (
    req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    (req as unknown as { user?: typeof mocks.currentPatient }).user = mocks.currentPatient;
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
import patientRouter from './patientRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/patient', patientRouter);
  app.use(errorHandler);
  return app;
}

const REL_ID = '22222222-2222-2222-2222-222222222222';
const PROVIDER_ID = '33333333-3333-3333-3333-333333333333';

describe('PATCH /patient/providers/:id response shape', () => {
  beforeEach(() => {
    mocks.tx.providerPatient.findFirst.mockReset();
    mocks.tx.providerPatient.update.mockReset();
    mocks.tx.user.findUnique.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('returns the documented shape and never the raw notesEncrypted/flat columns', async () => {
    const rawRow = {
      id: REL_ID,
      patientId: mocks.currentPatient.id,
      providerId: PROVIDER_ID,
      status: 'ACTIVE',
      relationshipType: 'PRIMARY_CARE',
      canViewBiomarkers: false,
      canViewInsurance: true,
      canViewHealthNeeds: false,
      canEditData: false,
      notesEncrypted: 'enc:secret-relationship-notes',
      consentGrantedAt: new Date('2026-01-01'),
      consentExpiresAt: null,
      createdAt: new Date('2026-01-01'),
    };
    mocks.tx.providerPatient.findFirst.mockResolvedValue(rawRow);
    mocks.tx.providerPatient.update.mockResolvedValue({ ...rawRow, canViewBiomarkers: true });
    mocks.tx.user.findUnique.mockResolvedValue({ id: PROVIDER_ID, email: 'doc@example.com' });

    const res = await request(buildApp())
      .patch(`/api/v1/patient/providers/${REL_ID}`)
      .send({ canViewBiomarkers: true });

    expect(res.status).toBe(200);
    const data = res.body.data;

    // Documented shape (mirrors GET /providers).
    expect(data).toMatchObject({
      relationshipId: REL_ID,
      providerId: PROVIDER_ID,
      provider: { id: PROVIDER_ID, email: 'doc@example.com' },
      permissions: {
        canViewBiomarkers: true,
        canViewInsurance: true,
        canViewHealthNeeds: false,
        canEditData: false,
      },
      relationshipType: 'PRIMARY_CARE',
      status: 'ACTIVE',
    });

    // The raw row's ciphertext + flat/internal columns must NOT be exposed.
    expect(data).not.toHaveProperty('notesEncrypted');
    expect(data).not.toHaveProperty('patientId');
    expect(data).not.toHaveProperty('canViewBiomarkers'); // it's nested under permissions, not flat
  });
});
