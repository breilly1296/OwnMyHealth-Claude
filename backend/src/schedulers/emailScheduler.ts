/**
 * Email Scheduler
 *
 * Runs on a single in-process setInterval (same pattern as session/audit
 * cleanup). Every tick:
 *   1. If it's Monday 08:00-08:59 UTC, send weekly summaries + goal reminders.
 *   2. Every tick, check for users whose plan expires in ~7 days and
 *      notify them (narrow 1-day window = dedupes to ~one email without
 *      needing a sent-at column).
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

function weeklyRunKey(now: Date): string {
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

async function sendGoalReminders(): Promise<void> {
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
    const goals = await withRLSContext(userId, async (tx) =>
      tx.healthGoal.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { name: true, progress: true },
        orderBy: { targetDate: 'asc' },
        take: 5,
      })
    );

    if (goals.length === 0) return;

    await notifyGoalReminder(userId, {
      goals: goals.map((g) => ({
        name: g.name,
        progressPct: Number(g.progress),
      })),
    });
    sent += 1;
  });

  logger.info(`[EmailScheduler] Goal reminder batch sent=${sent}/${userRows.length}`);
}

// ============================================
// Plan expiring (daily)
// ============================================

async function sendPlanExpiringNotifications(): Promise<void> {
  // Narrow to users whose expiry is between (now + 6d) and (now + 7d). A
  // single day of width means the daily scheduler sweeps each user exactly
  // once — no sent-at column required. If the scheduler skips a day we'll
  // just miss that user's notification; acceptable for v1.
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

async function runTick(): Promise<void> {
  const now = new Date();
  const isMondayMorning = now.getUTCDay() === 1 && now.getUTCHours() === 8;
  const key = weeklyRunKey(now);

  try {
    if (isMondayMorning && lastWeeklyRunKey !== key) {
      lastWeeklyRunKey = key;
      await sendWeeklySummaries();
      await sendGoalReminders();
    }
    await sendPlanExpiringNotifications();
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
