/**
 * requirePlanLimit enforcement tests.
 *
 * Covers the M12 maxBiomarkers gate now wired onto the upload routes, plus the
 * previously-untested planGating 403 path, the planExpiresAt runtime downgrade,
 * the unlimited short-circuit, and the no-user bypass. The real middleware +
 * checkPlanLimit + getUserUsage run against a mocked withRLSContext (we do NOT
 * stub planGating itself — that would assert nothing).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mocks = vi.hoisted(() => ({
  tx: {
    user: { findUnique: vi.fn() },
    auditLog: { count: vi.fn(async () => 0) },
    userFile: { count: vi.fn(async () => 0) },
    biomarker: { count: vi.fn(async () => 0) },
    insurancePlan: { count: vi.fn(async () => 0) },
    costAnalysis: { count: vi.fn(async () => 0) },
  },
}));

vi.mock('../services/database.js', () => ({
  // Run the callback against the shared mock tx, ignoring the RLS userId — both
  // the plan read and getUserUsage flow through here.
  withRLSContext: (_userId: string, fn: (tx: unknown) => unknown) => fn(mocks.tx),
}));
vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { requirePlanLimit } from './planGating.js';

function harness(userId?: string) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = { user: userId ? { id: userId } : undefined } as unknown as Request;
  const res = { status, json } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, status, json };
}

describe('requirePlanLimit — maxBiomarkers enforcement (M12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.user.findUnique.mockResolvedValue({ plan: 'FREE', planExpiresAt: null });
    for (const k of ['auditLog', 'userFile', 'biomarker', 'insurancePlan', 'costAnalysis'] as const) {
      mocks.tx[k].count.mockResolvedValue(0);
    }
  });

  it('403 PLAN_LIMIT_EXCEEDED when a FREE user is at the maxBiomarkers cap', async () => {
    mocks.tx.biomarker.count.mockResolvedValue(50);
    const { req, res, next, status, json } = harness('u1');

    await requirePlanLimit('maxBiomarkers')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PLAN_LIMIT_EXCEEDED',
          feature: 'maxBiomarkers',
          limit: 50,
          current: 50,
          upgradeRequired: true,
        }),
      })
    );
  });

  it('passes (next, no 403) when under the cap', async () => {
    mocks.tx.biomarker.count.mockResolvedValue(10);
    const { req, res, next, status } = harness('u1');

    await requirePlanLimit('maxBiomarkers')(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
  });

  it('downgrades an EXPIRED paid plan to FREE limits (PRO past-expiry user is capped at 50)', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({
      plan: 'PRO',
      planExpiresAt: new Date(Date.now() - 1000),
    });
    mocks.tx.biomarker.count.mockResolvedValue(50);
    const { req, res, next, status } = harness('u1');

    await requirePlanLimit('maxBiomarkers')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('PRO (unlimited maxBiomarkers) passes regardless of count, without a count query', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ plan: 'PRO', planExpiresAt: null });
    mocks.tx.biomarker.count.mockResolvedValue(9999);
    const { req, res, next } = harness('u1');

    await requirePlanLimit('maxBiomarkers')(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(mocks.tx.biomarker.count).not.toHaveBeenCalled();
  });

  it('with no authenticated user, falls through to next() (auth layer handles it)', async () => {
    const { req, res, next, status } = harness(undefined);

    await requirePlanLimit('maxBiomarkers')(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(mocks.tx.user.findUnique).not.toHaveBeenCalled();
  });
});
