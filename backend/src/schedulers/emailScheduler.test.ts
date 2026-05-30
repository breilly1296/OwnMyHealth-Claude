/**
 * emailScheduler dedup tests.
 *
 * Guards the once-per-UTC-day guard on the plan-expiring sweep (#20): the tick
 * is hourly and the expiry window is 1 day wide, so without the guard a user
 * lands in the window for ~24 consecutive ticks and gets ~24 duplicate emails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notifyPlanExpiring: vi.fn(),
  notifyWeeklySummary: vi.fn(),
  notifyGoalReminder: vi.fn(),
  users: [] as Array<{ id: string; plan: string; planExpiresAt: Date }>,
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  // Resolve every withRLSContext callback against a tx whose user.findMany
  // returns the staged candidates (range filtering is DB-side, not under test).
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      user: { findMany: vi.fn(async () => mocks.users) },
      biomarker: { count: vi.fn(async () => 0) },
      healthGoal: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    })
  ),
}));

vi.mock('../services/notificationService.js', () => ({
  notifyPlanExpiring: mocks.notifyPlanExpiring,
  notifyWeeklySummary: mocks.notifyWeeklySummary,
  notifyGoalReminder: mocks.notifyGoalReminder,
}));

vi.mock('../config/plans.js', () => ({
  getPlanConfig: vi.fn(() => ({ name: 'Pro' })),
  normalizePlan: vi.fn((p: string) => p),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { runTick } from './emailScheduler.js';

describe('emailScheduler — plan-expiring dedup (#20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends plan-expiring at most once per UTC day across many hourly ticks', async () => {
    // A Tuesday (not Monday 08:00 UTC) so only the plan-expiring path runs.
    vi.setSystemTime(new Date('2026-06-02T10:00:00.000Z'));
    mocks.users = [
      { id: 'u1', plan: 'PRO', planExpiresAt: new Date('2026-06-08T22:00:00.000Z') },
    ];

    // Three hourly ticks within the same UTC day.
    await runTick();
    await runTick();
    await runTick();

    expect(mocks.notifyPlanExpiring).toHaveBeenCalledTimes(1);
    // Non-Monday → the weekly batch must not fire.
    expect(mocks.notifyWeeklySummary).not.toHaveBeenCalled();

    // Crossing into the next UTC day re-arms the sweep.
    vi.setSystemTime(new Date('2026-06-03T11:00:00.000Z'));
    await runTick();
    await runTick();

    expect(mocks.notifyPlanExpiring).toHaveBeenCalledTimes(2);
  });
});
