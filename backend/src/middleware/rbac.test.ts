/**
 * rbac.ts — RLS-wrapping regression tests for provider-patient access.
 *
 * The middleware previously ran raw `prisma.providerPatient.findUnique()` on
 * the shared Prisma client. Queries outside `withRLSContext` don't carry
 * `SET LOCAL app.current_user_id`, so every RLS policy evaluates against
 * NULL — effectively bypassing the DB-level guard. These tests pin both
 * invariants:
 *   1. The lookup goes through `withRLSContext` (admin context).
 *   2. A provider with no relationship to a patient is denied.
 *   3. A provider with an ACTIVE relationship and the right capability flag
 *      is allowed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';

// -- Hoisted mocks -------------------------------------------------------
// The test exercises the real rbac.ts, but stubs out the database layer so
// we can assert on how the middleware calls into it.
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  withRLSContext: vi.fn(),
}));

vi.mock('../services/database.js', () => ({
  // Forward the tx argument to `findUnique` so the middleware's query runs
  // against our mock. The first arg (userId/null) + isAdmin option are
  // captured on the spy so tests can assert the wrapper received the right
  // context.
  withRLSContext: mocks.withRLSContext,
  getPrismaClient: vi.fn(),
}));

// -- Imports AFTER mocks --------------------------------------------------
import { requireResourceAccess, requireOwnership } from './rbac.js';

// Realistic-shape mock row. Fields match Prisma's ProviderPatient model.
interface MockRelationship {
  id: string;
  providerId: string;
  patientId: string;
  status: 'ACTIVE' | 'PENDING' | 'REVOKED' | 'EXPIRED';
  canViewBiomarkers: boolean;
  canViewInsurance: boolean;
  canViewHealthNeeds: boolean;
  canEditData: boolean;
  consentExpiresAt: Date | null;
  consentGrantedAt: Date | null;
  relationshipType: string;
  notesEncrypted: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function buildRelationship(overrides: Partial<MockRelationship> = {}): MockRelationship {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    providerId: '22222222-2222-2222-2222-222222222222',
    patientId: '33333333-3333-3333-3333-333333333333',
    status: 'ACTIVE',
    canViewBiomarkers: true,
    canViewInsurance: false,
    canViewHealthNeeds: true,
    canEditData: false,
    consentExpiresAt: null,
    consentGrantedAt: new Date('2026-01-01'),
    relationshipType: 'PRIMARY_CARE',
    notesEncrypted: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function buildRequest(
  role: 'PATIENT' | 'PROVIDER' | 'ADMIN',
  userId: string,
  targetPatientId?: string
): AuthenticatedRequest {
  return {
    user: { id: userId, email: 'test@example.com', role, plan: 'FREE' },
    params: targetPatientId ? { patientId: targetPatientId } : {},
    query: {},
    body: {},
  } as unknown as AuthenticatedRequest;
}

const PROVIDER_ID = '22222222-2222-2222-2222-222222222222';
const PATIENT_ID = '33333333-3333-3333-3333-333333333333';
const UNRELATED_PATIENT_ID = '44444444-4444-4444-4444-444444444444';

describe('rbac.ts — provider-patient RLS wrapping', () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.withRLSContext.mockReset();
    // Default: forward to the mock Prisma client's `findUnique`. Callbacks
    // receive a tx-shaped object with `providerPatient.findUnique`.
    mocks.withRLSContext.mockImplementation(async (_userId, fn, _options) => {
      const tx = {
        providerPatient: { findUnique: mocks.findUnique },
      };
      return fn(tx);
    });
  });

  describe('requireResourceAccess — provider accessing a patient', () => {
    it('calls withRLSContext with admin scope (not raw prisma)', async () => {
      mocks.findUnique.mockResolvedValue(
        buildRelationship({ canViewBiomarkers: true })
      );

      const req = buildRequest('PROVIDER', PROVIDER_ID, PATIENT_ID);
      const next = vi.fn() as unknown as NextFunction;
      const middleware = requireResourceAccess('biomarker', 'read');
      await middleware(req, {} as Response, next);

      // The wrapper MUST be used (previous bug: raw prisma call bypassed RLS).
      expect(mocks.withRLSContext).toHaveBeenCalledTimes(1);
      // Admin context: first arg null, third arg { isAdmin: true }.
      expect(mocks.withRLSContext).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { isAdmin: true }
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('denies a provider with no relationship to the target patient', async () => {
      // Database returns null — no relationship row.
      mocks.findUnique.mockResolvedValue(null);

      const req = buildRequest('PROVIDER', PROVIDER_ID, UNRELATED_PATIENT_ID);
      const next = vi.fn() as unknown as NextFunction;
      const middleware = requireResourceAccess('biomarker', 'read');
      await middleware(req, {} as Response, next);

      // Must be blocked with a ForbiddenError.
      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/do not have access/i);
    });

    it('denies when the relationship is PENDING (not yet consented)', async () => {
      mocks.findUnique.mockResolvedValue(
        buildRelationship({ status: 'PENDING' })
      );

      const req = buildRequest('PROVIDER', PROVIDER_ID, PATIENT_ID);
      const next = vi.fn() as unknown as NextFunction;
      const middleware = requireResourceAccess('biomarker', 'read');
      await middleware(req, {} as Response, next);

      const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
      expect((err as Error).message).toMatch(/do not have access/i);
    });

    it('denies when consent has expired', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mocks.findUnique.mockResolvedValue(
        buildRelationship({ consentExpiresAt: yesterday })
      );

      const req = buildRequest('PROVIDER', PROVIDER_ID, PATIENT_ID);
      const next = vi.fn() as unknown as NextFunction;
      const middleware = requireResourceAccess('biomarker', 'read');
      await middleware(req, {} as Response, next);

      const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
      expect((err as Error).message).toMatch(/do not have access/i);
    });

    it('denies write when the relationship only has read permission', async () => {
      mocks.findUnique.mockResolvedValue(
        buildRelationship({ canViewBiomarkers: true, canEditData: false })
      );

      const req = buildRequest('PROVIDER', PROVIDER_ID, PATIENT_ID);
      const next = vi.fn() as unknown as NextFunction;
      const middleware = requireResourceAccess('biomarker', 'write');
      await middleware(req, {} as Response, next);

      const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
      expect((err as Error).message).toMatch(/do not have access/i);
    });

    it('skips the DB lookup entirely for patients accessing their own data', async () => {
      const req = buildRequest('PATIENT', PATIENT_ID, PATIENT_ID);
      const next = vi.fn() as unknown as NextFunction;
      const middleware = requireResourceAccess('biomarker', 'read');
      await middleware(req, {} as Response, next);

      expect(mocks.withRLSContext).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('requireOwnership — provider accessing someone else\'s resource', () => {
    it('calls withRLSContext with admin scope for the relationship lookup', async () => {
      mocks.findUnique.mockResolvedValue(buildRelationship({ status: 'ACTIVE' }));

      const req = buildRequest('PROVIDER', PROVIDER_ID);
      const next = vi.fn() as unknown as NextFunction;
      const resourceGetter = vi.fn().mockResolvedValue({ userId: PATIENT_ID });
      const middleware = requireOwnership(resourceGetter);
      await middleware(req, {} as Response, next);

      expect(mocks.withRLSContext).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { isAdmin: true }
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('denies access when there is no relationship for the resource owner', async () => {
      mocks.findUnique.mockResolvedValue(null);

      const req = buildRequest('PROVIDER', PROVIDER_ID);
      const next = vi.fn() as unknown as NextFunction;
      const resourceGetter = vi.fn().mockResolvedValue({ userId: UNRELATED_PATIENT_ID });
      const middleware = requireOwnership(resourceGetter);
      await middleware(req, {} as Response, next);

      const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/do not have access/i);
    });
  });
});
