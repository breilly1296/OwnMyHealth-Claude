/**
 * Email Scheduler
 *
 * Runs on a single in-process setInterval (same pattern as session/audit
 * cleanup). Every tick:
 *   1. If it's Monday 08:00-08:59 UTC, send weekly summaries.
 *   2. Once per UTC day, run the goal-reminder sweep — each goal honored at
 *      its own reminderFrequency cadence (DAILY/WEEKLY/BIWEEKLY/MONTHLY).
 *   3. Once per UTC day, check for users whose plan expires in ~7 days and
 *      notify them. The once-per-day guard (lastPlanExpiryRunKey) is REQUIRED:
 *      the tick is hourly, and the expiry window is 1 day wide, so without the
 *      guard a user would land in the window for ~24 consecutive ticks and get
 *      ~24 duplicate emails.
 *
 * Dispatch is fire-and-forget per user so one SendGrid failure doesn't
 * stop the batch. Everything routes through notificationService which
 * respects user preferences.
 */

import { withRLSContext, getPrismaClient } from '../services/database.js';
import {
  notifyGoalReminder,
  notifyWeeklySummary,
  notifyPlanExpiring,
} from '../services/notificationService.js';
import { logger } from '../utils/logger.js';
import { getPlanConfig, normalizePlan } from '../config/plans.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const PLAN_EXPIRY_WINDOW_DAYS = 7;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Shared guard so the weekly batch only fires once per Monday, even if the
 * scheduler is restarted inside the 08:00-08:59 window. Module-scoped so
 * it resets naturally on process restart — worst case, restart-during-window
 * sends one extra email per user. Acceptable.
 */
let lastWeeklyRunKey: string | null = null;

/**
 * Shared guard so the plan-expiring sweep fires at most once per UTC day.
 * Without it the hourly tick would re-send to every in-window user ~24×.
 * Module-scoped, resets on restart (worst case: one extra sweep that day).
 */
let lastPlanExpiryRunKey: string | null = null;

/**
 * Shared guard so the goal-reminder sweep fires at most once per UTC day.
 * Each goal is then honored at its own reminderFrequency cadence inside the
 * sweep (via lastReminderSent). Module-scoped; resets on restart.
 */
let lastGoalReminderRunKey: string | null = null;

/** UTC calendar-day key (YYYY-M-D). Used to dedupe once-per-day sweeps. */
function utcDayKey(now: Date): string {
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
}

/** Batch helper: process items N at a time to avoid overwhelming SendGrid. */
async function runBatched<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    await Promise.allSettled(slice.map(handler));
  }
}

// ============================================
// Weekly summary
// ============================================

async function sendWeeklySummaries(): Promise<void> {
  const prisma = getPrismaClient();
  void prisma;

  // Fetch active users. Preference filtering happens inside notificationService
  // so this query can be cheap and index-friendly.
  const users = await withRLSContext(
    null,
    async (tx) =>
      tx.user.findMany({
        where: { isActive: true },
        select: { id: true },
      }),
    { isAdmin: true }
  );

  logger.info(`[EmailScheduler] Weekly summary batch: ${users.length} candidates`);

  let sent = 0;
  await runBatched(users, 20, async ({ id: userId }) => {
    // Per-user aggregates inside the caller's RLS context so counts match
    // exactly what that user sees in the dashboard.
    const data = await withRLSContext(userId, async (tx) => {
      const [totalBiomarkers, outOfRangeBiomarkers, activeGoals, upcomingDeadlines] =
        await Promise.all([
          tx.biomarker.count({ where: { userId } }),
          tx.biomarker.count({ where: { userId, isOutOfRange: true } }),
          tx.healthGoal.count({ where: { userId, status: 'ACTIVE' } }),
          tx.healthGoal.count({
            where: {
              userId,
              status: 'ACTIVE',
              targetDate: {
                gte: new Date(),
                lte: new Date(Date.now() + 7 * 24 * ONE_HOUR_MS),
              },
            },
          }),
        ]);

      const inRangePct =
        totalBiomarkers === 0
          ? 0
          : ((totalBiomarkers - outOfRangeBiomarkers) / totalBiomarkers) * 100;

      return { totalBiomarkers, inRangePct, activeGoals, upcomingDeadlines };
    });

    // Skip accounts with literally nothing tracked — an empty summary is
    // noise, not engagement.
    if (data.totalBiomarkers === 0 && data.activeGoals === 0) return;

    await notifyWeeklySummary(userId, {
      inRangePct: data.inRangePct,
      biomarkerCount: data.totalBiomarkers,
      activeGoals: data.activeGoals,
      upcomingDeadlines: data.upcomingDeadlines,
    });
    sent += 1;
  });

  logger.info(`[EmailScheduler] Weekly summary batch sent=${sent}/${users.length}`);
}

// ============================================
// Goal reminders
// ============================================

/**
 * Per-goal reminder cadence in days, keyed by ReminderFrequency. Goals with no
 * cadence set fall back to WEEKLY — the behaviour before cadence was honored.
 */
const REMINDER_INTERVAL_DAYS: Record<string, number> = {
  DAILY: 1,
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
};
const DEFAULT_REMINDER_INTERVAL_DAYS = 7;

async function sendGoalReminders(): Promise<void> {
  const nowMs = Date.now();

  // Users with at least one active goal. Filter at the DB so we skip users
  // who'd just get an empty reminder.
  const userRows = await withRLSContext(
    null,
    async (tx) =>
      tx.user.findMany({
        where: {
          isActive: true,
          healthGoals: { some: { status: 'ACTIVE' } },
        },
        select: { id: true },
      }),
    { isAdmin: true }
  );

  logger.info(`[EmailScheduler] Goal reminder batch: ${userRows.length} candidates`);

  let sent = 0;
  await runBatched(userRows, 20, async ({ id: userId }) => {
    // Only remind about goals whose cadence has elapsed since the last reminder.
    const dueGoals = await withRLSContext(userId, async (tx) => {
      const goals = await tx.healthGoal.findMany({
        where: { userId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          progress: true,
          reminderFrequency: true,
          lastReminderSent: true,
        },
        orderBy: { targetDate: 'asc' },
      });
      return goals.filter((g) => {
        const intervalDays =
          REMINDER_INTERVAL_DAYS[g.reminderFrequency ?? ''] ?? DEFAULT_REMINDER_INTERVAL_DAYS;
        if (!g.lastReminderSent) return true;
        const elapsed = nowMs - g.lastReminderSent.getTime();
        // 1h grace so a daily sweep that drifts slightly still fires on schedule.
        return elapsed >= intervalDays * 24 * ONE_HOUR_MS - ONE_HOUR_MS;
      });
    });

    if (dueGoals.length === 0) return;

    await notifyGoalReminder(userId, {
      goals: dueGoals.slice(0, 5).map((g) => ({
        name: g.name,
        progressPct: Number(g.progress),
      })),
    });

    // Stamp every due goal so the next reminder respects its cadence. Done
    // after a successful notify so a send error leaves the goal due to retry.
    const sentAt = new Date();
    await withRLSContext(userId, async (tx) => {
      await tx.healthGoal.updateMany({
        where: { userId, id: { in: dueGoals.map((g) => g.id) } },
        data: { lastReminderSent: sentAt },
      });
    });

    sent += 1;
  });

  logger.info(`[EmailScheduler] Goal reminder batch sent=${sent}/${userRows.length}`);
}

// ============================================
// Plan expiring (daily)
// ============================================

async function sendPlanExpiringNotifications(): Promise<void> {
  // Narrow to users whose expiry is between (now + 6d) and (now + 7d). The
  // 1-day-wide window combined with the once-per-UTC-day guard in runTick
  // (lastPlanExpiryRunKey) means each user is swept about once — no sent-at
  // column required. If the scheduler skips a day we'll just miss that user's
  // notification; acceptable for v1.
  const now = new Date();
  const rangeStart = new Date(now.getTime() + (PLAN_EXPIRY_WINDOW_DAYS - 1) * 24 * ONE_HOUR_MS);
  const rangeEnd = new Date(now.getTime() + PLAN_EXPIRY_WINDOW_DAYS * 24 * ONE_HOUR_MS);

  const users = await withRLSContext(
    null,
    async (tx) =>
      tx.user.findMany({
        where: {
          isActive: true,
          planExpiresAt: { gte: rangeStart, lt: rangeEnd },
        },
        select: { id: true, plan: true, planExpiresAt: true },
      }),
    { isAdmin: true }
  );

  if (users.length === 0) return;
  logger.info(`[EmailScheduler] Plan expiring batch: ${users.length} candidates`);

  let sent = 0;
  await runBatched(users, 20, async (u) => {
    if (!u.planExpiresAt) return;
    const tier = normalizePlan(u.plan);
    const daysRemaining = Math.max(
      0,
      Math.round((u.planExpiresAt.getTime() - now.getTime()) / (24 * ONE_HOUR_MS))
    );
    await notifyPlanExpiring(u.id, {
      planName: getPlanConfig(tier).name,
      expiresOn: u.planExpiresAt.toISOString().split('T')[0],
      daysRemaining,
    });
    sent += 1;
  });

  logger.info(`[EmailScheduler] Plan expiring batch sent=${sent}/${users.length}`);
}

// ============================================
// Public start/stop
// ============================================

// Exported for unit testing the once-per-day dedup; the scheduler invokes it
// internally via setInterval.
export async function runTick(): Promise<void> {
  const now = new Date();
  const isMondayMorning = now.getUTCDay() === 1 && now.getUTCHours() === 8;
  const dayKey = utcDayKey(now);

  try {
    if (isMondayMorning && lastWeeklyRunKey !== dayKey) {
      lastWeeklyRunKey = dayKey;
      await sendWeeklySummaries();
    }
    // Goal reminders sweep once per UTC day; each goal is then honored at its
    // own reminderFrequency cadence inside sendGoalReminders (via lastReminderSent).
    if (lastGoalReminderRunKey !== dayKey) {
      lastGoalReminderRunKey = dayKey;
      await sendGoalReminders();
    }
    // Once per UTC day (see lastPlanExpiryRunKey) — the hourly tick would
    // otherwise re-notify each in-window user ~24×.
    if (lastPlanExpiryRunKey !== dayKey) {
      lastPlanExpiryRunKey = dayKey;
      await sendPlanExpiringNotifications();
    }
  } catch (err) {
    logger.error('[EmailScheduler] Tick failed', {
      data: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export function startEmailScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    void runTick();
  }, ONE_HOUR_MS);
  logger.info('[EmailScheduler] Started (hourly tick)');
}

export function stopEmailScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('[EmailScheduler] Stopped');
  }
}
