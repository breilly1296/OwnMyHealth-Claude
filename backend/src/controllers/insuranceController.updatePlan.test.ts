/**
 * updateInsurancePlan — M13 insurancePlans bypass fix.
 *
 * The create gate counts only ACTIVE plans, so a user could create N plans as
 * isActive:false (each passing the create gate while the active count stays 0),
 * then PATCH each to isActive:true to exceed the insurancePlans cap. The fix
 * re-checks the quota inside the update transaction on a false→true transition
 * and responds 403 PLAN_LIMIT_EXCEEDED. These tests assert the exploit is closed
 * and that ordinary edits / deactivations are NOT falsely gated.
 *
 * resolveEffectivePlan runs FOR REAL against the mocked tx.user.findUnique — only
 * the infra (db/encryption/salt/audit/logger) is stubbed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';

const mocks = vi.hoisted(() => ({
  tx: {
    user: { findUnique: vi.fn() },
    insurancePlan: {
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  logUpdate: vi.fn(async () => undefined),
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: () => ({}),
  withRLSTransaction: (_userId: string, fn: (tx: unknown) => unknown) => fn(mocks.tx),
}));
vi.mock('../services/encryption.js', () => ({
  getEncryptionService: () => ({
    encrypt: (v: string) => `enc(${v})`,
    decrypt: (v: string) => v,
  }),
}));
vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));
vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: () => ({ logUpdate: mocks.logUpdate }),
}));
vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { updateInsurancePlan } from './insuranceController.js';

const USER = 'u1';
const PLAN_ID = 'plan-1';

// Minimal plan row toResponse can render without crashing: effectiveDate MUST be
// a Date; the encrypted PHI columns null (decrypt skipped); optNum/toNumber
// tolerate undefined for every numeric column.
function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    userId: USER,
    planName: 'Plan',
    insurerName: 'Insurer',
    planType: 'PPO',
    planIdNumber: null,
    memberIdEncrypted: null,
    groupIdEncrypted: null,
    effectiveDate: new Date('2026-01-01'),
    terminationDate: null,
    isActive: true,
    isPrimary: false,
    benefits: [],
    ...overrides,
  };
}

function harness(body: Record<string, unknown>) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = { user: { id: USER }, params: { id: PLAN_ID }, body } as unknown as AuthenticatedRequest;
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

describe('updateInsurancePlan — M13 active-plan quota on isActive false→true', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.insurancePlan.update.mockImplementation(async () => planRow());
    mocks.tx.insurancePlan.updateMany.mockResolvedValue({ count: 0 });
  });

  it('403 PLAN_LIMIT_EXCEEDED when a FREE user activates an archived plan while at the cap (exploit closed)', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ plan: 'FREE', planExpiresAt: null });
    mocks.tx.insurancePlan.findFirst.mockResolvedValue(planRow({ isActive: false }));
    mocks.tx.insurancePlan.count.mockResolvedValue(1); // FREE insurancePlans limit = 1
    const { req, res, status, json } = harness({ isActive: true });

    await updateInsurancePlan(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PLAN_LIMIT_EXCEEDED',
          feature: 'insurancePlans',
          limit: 1,
          current: 1,
          upgradeRequired: true,
        }),
      })
    );
    expect(mocks.tx.insurancePlan.update).not.toHaveBeenCalled();
    expect(mocks.logUpdate).not.toHaveBeenCalled();
  });

  it('allows activation when the FREE user is UNDER the active-plan cap', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ plan: 'FREE', planExpiresAt: null });
    mocks.tx.insurancePlan.findFirst.mockResolvedValue(planRow({ isActive: false }));
    mocks.tx.insurancePlan.count.mockResolvedValue(0);
    const { req, res, status } = harness({ isActive: true });

    await updateInsurancePlan(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(mocks.tx.insurancePlan.update).toHaveBeenCalled();
  });

  it('does NOT gate an ordinary edit (no isActive in the body) — no plan/count lookup', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ plan: 'FREE', planExpiresAt: null });
    mocks.tx.insurancePlan.findFirst.mockResolvedValue(planRow({ isActive: true }));
    const { req, res, status } = harness({ planName: 'Renamed' });

    await updateInsurancePlan(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(mocks.tx.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.insurancePlan.count).not.toHaveBeenCalled();
    expect(mocks.tx.insurancePlan.update).toHaveBeenCalled();
  });

  it('does NOT gate a deactivation (isActive true→false)', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ plan: 'FREE', planExpiresAt: null });
    mocks.tx.insurancePlan.findFirst.mockResolvedValue(planRow({ isActive: true }));
    const { req, res, status } = harness({ isActive: false });

    await updateInsurancePlan(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(mocks.tx.insurancePlan.count).not.toHaveBeenCalled();
    expect(mocks.tx.insurancePlan.update).toHaveBeenCalled();
  });

  it('does NOT gate an unlimited (TEAM) tier — count is skipped via the unlimited short-circuit', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ plan: 'TEAM', planExpiresAt: null });
    mocks.tx.insurancePlan.findFirst.mockResolvedValue(planRow({ isActive: false }));
    const { req, res, status } = harness({ isActive: true });

    await updateInsurancePlan(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(mocks.tx.insurancePlan.count).not.toHaveBeenCalled();
    expect(mocks.tx.insurancePlan.update).toHaveBeenCalled();
  });
});
