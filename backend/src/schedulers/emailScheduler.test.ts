/**
 * emailScheduler tests.
 *
 * Covers the multi-instance duplicate-email fix (#15):
 *   - withTickLock: only the advisory-lock winner runs a sub-batch; fails OPEN
 *     (still runs) if the lock can't be acquired; never re-runs fn on fn error.
 *   - per-recipient claims: weekly summary + plan-expiring send only when the
 *     atomic claim wins (updateMany affected 1 row); goal reminders claim each
 *     goal via compare-and-swap before sending.
 * Plus the original once-per-UTC-day dedup guard (#20).
 *
 * The DB is mocked (no live Postgres), so these assert the dedup LOGIC; the
 * cross-instance mutual exclusion of pg_try_advisory_xact_lock itself is a
 * standard Postgres guarantee, exercised in prod, not unit-tested here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notifyPlanExpiring: vi.fn(),
  notifyWeeklySummary: vi.fn(),
  notifyGoalReminder: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  users: [] as Array<Record<string, unknown>>,
  goals: [] as Array<Record<string, unknown>>,
  tx: {
    user: { findMany: vi.fn(), updateMany: vi.fn() },
    biomarker: { count: vi.fn() },
    healthGoal: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
  prisma: { $transaction: vi.fn() },
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => mocks.prisma),
  // Resolve every withRLSContext callback against the shared mock tx.
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) => fn(mocks.tx)),
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
  logger: { info: vi.fn(), error: mocks.logError, warn: mocks.logWarn, debug: vi.fn() },
}));

import {
  runTick,
  withTickLock,
  sendWeeklySummaries,
  sendGoalReminders,
  sendPlanExpiringNotifications,
  __resetSchedulerStateForTests,
} from './emailScheduler.js';

// Make $transaction simulate a free / held / erroring advisory lock.
function lockFree() {
  mocks.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ $queryRaw: async () => [{ locked: true }] })
  );
}
function lockHeld() {
  mocks.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ $queryRaw: async () => [{ locked: false }] })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetSchedulerStateForTests();
  mocks.users = [];
  mocks.goals = [];
  mocks.tx.user.findMany.mockImplementation(async () => mocks.users);
  mocks.tx.user.updateMany.mockResolvedValue({ count: 1 }); // claim wins by default
  mocks.tx.biomarker.count.mockResolvedValue(0);
  mocks.tx.healthGoal.count.mockResolvedValue(0);
  mocks.tx.healthGoal.findMany.mockImplementation(async () => mocks.goals);
  mocks.tx.healthGoal.updateMany.mockResolvedValue({ count: 1 }); // CAS wins by default
  lockFree();
});

describe('withTickLock — advisory-lock gating', () => {
  it('runs fn and returns true when the lock is free', async () => {
    const fn = vi.fn(async () => {});
    const ran = await withTickLock(910001, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('skips fn and returns false when another instance holds the lock', async () => {
    lockHeld();
    const fn = vi.fn(async () => {});
    const ran = await withTickLock(910001, fn);
    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('FAILS OPEN — runs fn and warns when the lock query errors', async () => {
    mocks.prisma.$transaction.mockRejectedValue(new Error('db unreachable'));
    const fn = vi.fn(async () => {});
    const ran = await withTickLock(910001, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('does NOT re-run fn when fn throws under the lock (no double-send)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const ran = await withTickLock(910001, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1); // ran once, errored, not retried
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe('sendWeeklySummaries — per-recipient claim', () => {
  beforeEach(() => {
    mocks.users = [{ id: 'u1' }];
    mocks.tx.biomarker.count.mockResolvedValue(5); // non-empty → eligible
  });

  it('sends only when the weekly claim wins (updateMany affected 1 row)', async () => {
    mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
    await sendWeeklySummaries();
    expect(mocks.notifyWeeklySummary).toHaveBeenCalledTimes(1);
  });

  it('does NOT send when another instance already claimed this user this week', async () => {
    mocks.tx.user.updateMany.mockResolvedValue({ count: 0 });
    await sendWeeklySummaries();
    expect(mocks.notifyWeeklySummary).not.toHaveBeenCalled();
  });

  it('does not claim or send for an empty account', async () => {
    mocks.tx.biomarker.count.mockResolvedValue(0);
    mocks.tx.healthGoal.count.mockResolvedValue(0);
    await sendWeeklySummaries();
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
    expect(mocks.notifyWeeklySummary).not.toHaveBeenCalled();
  });
});

describe('sendPlanExpiringNotifications — per-recipient claim', () => {
  beforeEach(() => {
    mocks.users = [{ id: 'u1', plan: 'PRO', planExpiresAt: new Date(Date.now() + 6.5 * 24 * 3600 * 1000) }];
  });

  it('sends only when the daily claim wins', async () => {
    mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
    await sendPlanExpiringNotifications();
    expect(mocks.notifyPlanExpiring).toHaveBeenCalledTimes(1);
  });

  it('does NOT send when another instance already claimed this user today', async () => {
    mocks.tx.user.updateMany.mockResolvedValue({ count: 0 });
    await sendPlanExpiringNotifications();
    expect(mocks.notifyPlanExpiring).not.toHaveBeenCalled();
  });
});

describe('sendGoalReminders — compare-and-swap claim', () => {
  beforeEach(() => {
    mocks.users = [{ id: 'u1' }];
    mocks.goals = [
      { id: 'g1', name: 'Steps', progress: 50, reminderFrequency: 'WEEKLY', lastReminderSent: null },
    ];
  });

  it('sends a reminder when the goal CAS wins', async () => {
    mocks.tx.healthGoal.updateMany.mockResolvedValue({ count: 1 });
    await sendGoalReminders();
    expect(mocks.notifyGoalReminder).toHaveBeenCalledTimes(1);
    expect(mocks.notifyGoalReminder).toHaveBeenCalledWith('u1', {
      goals: [{ name: 'Steps', progressPct: 50 }],
    });
  });

  it('does NOT send when a concurrent ticker already claimed the goal (CAS lost)', async () => {
    mocks.tx.healthGoal.updateMany.mockResolvedValue({ count: 0 });
    await sendGoalReminders();
    expect(mocks.notifyGoalReminder).not.toHaveBeenCalled();
  });

  it('does NOT send when no goal cadence has elapsed', async () => {
    mocks.goals = [
      { id: 'g1', name: 'Steps', progress: 50, reminderFrequency: 'WEEKLY', lastReminderSent: new Date() },
    ];
    await sendGoalReminders();
    expect(mocks.tx.healthGoal.updateMany).not.toHaveBeenCalled();
    expect(mocks.notifyGoalReminder).not.toHaveBeenCalled();
  });
});

describe('runTick — lock gating + once-per-UTC-day guard (#20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips every sub-batch when another instance holds the lock', async () => {
    vi.setSystemTime(new Date('2026-06-02T10:00:00.000Z')); // Tuesday
    mocks.users = [{ id: 'u1', plan: 'PRO', planExpiresAt: new Date('2026-06-08T22:00:00.000Z') }];
    lockHeld();

    await runTick();

    expect(mocks.notifyPlanExpiring).not.toHaveBeenCalled();
    expect(mocks.notifyGoalReminder).not.toHaveBeenCalled();
  });

  it('sends plan-expiring at most once per UTC day across many hourly ticks', async () => {
    vi.setSystemTime(new Date('2026-06-02T10:00:00.000Z')); // Tuesday (not Mon 08:00)
    mocks.users = [{ id: 'u1', plan: 'PRO', planExpiresAt: new Date('2026-06-08T22:00:00.000Z') }];

    await runTick();
    await runTick();
    await runTick();

    expect(mocks.notifyPlanExpiring).toHaveBeenCalledTimes(1);
    expect(mocks.notifyWeeklySummary).not.toHaveBeenCalled();

    // Crossing into the next UTC day re-arms the sweep.
    vi.setSystemTime(new Date('2026-06-03T11:00:00.000Z'));
    await runTick();
    await runTick();

    expect(mocks.notifyPlanExpiring).toHaveBeenCalledTimes(2);
  });
});
