/**
 * onboardingService tests — covers the GET-write fix.
 *
 * getOnboardingStatus must be a PURE READ (the old code stamped
 * onboardingCompletedAt as a side effect of the dashboard's GET /status, which
 * rode a CSRF-exempt safe method). completeOnboarding is the only writer and
 * must be idempotent / race-safe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  tx: {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    userFile: { count: vi.fn(), findFirst: vi.fn() },
    insurancePlan: { count: vi.fn() },
    biomarker: { count: vi.fn() },
  },
}));

vi.mock('./database.js', () => ({
  withRLSContext: (_userId: string, fn: (tx: unknown) => unknown) => fn(mocks.tx),
}));

import { getOnboardingStatus, completeOnboarding } from './onboardingService.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a fresh user with no data and no stamp.
  mocks.tx.user.findUnique.mockResolvedValue({
    emailVerified: true,
    healthProfileEncrypted: null,
    onboardingCompletedAt: null,
  });
  mocks.tx.userFile.count.mockResolvedValue(0);
  mocks.tx.insurancePlan.count.mockResolvedValue(0);
  mocks.tx.biomarker.count.mockResolvedValue(0);
  mocks.tx.userFile.findFirst.mockResolvedValue(null);
});

describe('getOnboardingStatus — pure read (no side-effect write)', () => {
  it('a user with data but no stamp returns completed:true, completedAt:null AND writes nothing', async () => {
    mocks.tx.biomarker.count.mockResolvedValue(1);

    const status = await getOnboardingStatus('u1');

    expect(status.completed).toBe(true);
    expect(status.completedAt).toBeNull(); // signals "has data, not yet stamped" to the client
    expect(status.suggestedNextStep).toBeNull();
    // The whole point of the fix: the status read never stamps.
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('a user with no data returns completed:false + suggestedNextStep, still no write', async () => {
    const status = await getOnboardingStatus('u1');

    expect(status.completed).toBe(false);
    expect(status.completedAt).toBeNull();
    expect(status.suggestedNextStep).toBe('upload_lab');
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('an already-stamped user returns completed:true with the existing timestamp, unchanged', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({
      emailVerified: true,
      healthProfileEncrypted: null,
      onboardingCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mocks.tx.biomarker.count.mockResolvedValue(3);

    const status = await getOnboardingStatus('u1');

    expect(status.completed).toBe(true);
    expect(status.completedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(status.suggestedNextStep).toBeNull();
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('completeOnboarding — idempotent / race-safe stamp', () => {
  it('stamps via updateMany guarded on onboardingCompletedAt:null and returns the persisted value', async () => {
    mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.user.findUnique.mockResolvedValue({
      onboardingCompletedAt: new Date('2026-06-14T12:00:00.000Z'),
    });

    const result = await completeOnboarding('u1');

    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1', onboardingCompletedAt: null },
        data: { onboardingCompletedAt: expect.any(Date) },
      })
    );
    expect(result.toISOString()).toBe('2026-06-14T12:00:00.000Z');
  });

  it('a second concurrent call no-ops and returns the FIRST writer\'s timestamp (not a fresh now)', async () => {
    const firstWins = new Date('2026-03-03T03:03:03.000Z');
    // updateMany WHERE null matches zero rows the second time...
    mocks.tx.user.updateMany.mockResolvedValue({ count: 0 });
    // ...and the re-read returns the already-persisted value.
    mocks.tx.user.findUnique.mockResolvedValue({ onboardingCompletedAt: firstWins });

    const result = await completeOnboarding('u1');

    expect(result).toEqual(firstWins);
  });
});
