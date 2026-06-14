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
 *
 * MULTI-INSTANCE: this runs on every Cloud Run replica. See the "Multi-instance
 * coordination" section below — a per-sub-batch advisory lock (only one instance
 * runs each tick) plus per-recipient sent-markers (atomic claim before each
 * send) make every send idempotent across instances, so a user can't be mailed
 * once per replica. Both are Postgres-only; the in-memory day-key guards are now
 * just a per-process pre-filter, not the correctness boundary.
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
// Multi-instance coordination
// ============================================
//
// Cloud Run runs up to --max-instances replicas, each with its own copy of this
// scheduler's setInterval. The in-memory day-key guards below are module-scoped
// (per process), so they don't coordinate replicas — without the two mechanisms
// here, every replica runs each tick and a user gets one duplicate engagement
// email per instance. Both mechanisms are Postgres-only (no Redis):
//   1. A per-sub-batch ADVISORY LOCK so only ONE instance runs each sub-batch
//      per tick (withTickLock). Cuts the work to 1x and serializes.
//   2. Per-recipient sent-markers claimed atomically right before each send
//      (users.last_weekly_summary_sent / last_plan_expiring_sent and
//      health_goals.last_reminder_sent) so even if the lock is lost mid-batch
//      (crash, DB blip, fail-open) a given recipient is mailed at most once
//      per period.

// Fixed 64-bit advisory-lock keys, one per sub-batch. The 9100xx range is
// reserved for this scheduler so a future advisory-lock user can't collide.
const LOCK_KEY_WEEKLY = 910001;
const LOCK_KEY_GOAL_REMINDER = 910002;
const LOCK_KEY_PLAN_EXPIRY = 910003;

/**
 * Run `fn` only if this instance wins the Postgres advisory lock `key`, so a
 * per-tick sub-batch runs on exactly ONE instance. Uses the non-blocking
 * pg_try_advisory_xact_lock (a replica that loses the race returns immediately
 * and skips, rather than queueing) inside a transaction whose sole job is to
 * hold the lock for the wall-clock duration of `fn`; it auto-releases on commit
 * / rollback / connection loss, so a crashed holder never leaks it. Advisory
 * locks are a server-global facility, NOT rows, so they are not subject to RLS
 * and the NOBYPASSRLS app role can take them with no policy. The sub-batch's own
 * per-user reads/sends inside `fn` keep using their own withRLSContext
 * transactions on other pooled connections.
 *
 * FAILS OPEN: if acquiring the lock errors (e.g. DB unreachable) we log and
 * still run `fn` unlocked — silently skipping a send window is worse than a rare
 * unlocked run, and the per-recipient markers still cap duplicates. Returns
 * whether `fn` ran (true = ran under the lock or fail-open; false = skipped
 * because another instance held it).
 */
export async function withTickLock(key: number, fn: () => Promise<void>): Promise<boolean> {
  const prisma = getPrismaClient();
  let ran = false;
  try {
    await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${BigInt(key)}) AS locked
        `;
        if (!rows[0]?.locked) {
          logger.info(`[EmailScheduler] sub-batch key=${key} held by another instance; skipping`);
          return;
        }
        ran = true;
        await fn();
      },
      // The outer tx holds the lock for the whole batch, which can exceed
      // Prisma's 5s default interactive-transaction timeout.
      { timeout: 120_000, maxWait: 5_000 }
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (ran) {
      // The lock was held and fn started, then errored (fn failure or tx
      // timeout mid-batch). Do NOT re-run — that would double-send. The
      // per-recipient markers bound any duplicate from a partial send.
      logger.error(`[EmailScheduler] sub-batch key=${key} failed under lock`, { data: { error } });
      return true;
    }
    // Acquisition itself failed before fn ran. Fail open.
    logger.warn(`[EmailScheduler] advisory lock unavailable for key=${key}; running unlocked`, {
      data: { error },
    });
    ran = true;
    await fn();
  }
  return ran;
}

/** Monday 00:00:00 UTC of the current ISO week — the weekly-summary claim cutoff. */
function startOfIsoWeekUTC(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

/** 00:00:00 UTC today — the plan-expiring claim cutoff. */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// ============================================
// Weekly summary
// ============================================

export async function sendWeeklySummaries(): Promise<void> {
  const weekStart = startOfIsoWeekUTC(new Date());

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
    // noise, not engagement (and we don't burn the marker on them).
    if (data.totalBiomarkers === 0 && data.activeGoals === 0) return;

    // Claim this user's weekly send atomically so only one instance mails them
    // this ISO week (idempotent even if the advisory lock was lost). The marker
    // is set BEFORE the send → a send failure means "missed this week", never
    // "double-mailed" — the correct bias for engagement email.
    const claim = await withRLSContext(
      null,
      async (tx) =>
        tx.user.updateMany({
          where: {
            id: userId,
            OR: [{ lastWeeklySummarySent: null }, { lastWeeklySummarySent: { lt: weekStart } }],
          },
          data: { lastWeeklySummarySent: new Date() },
        }),
      { isAdmin: true }
    );
    if (claim.count !== 1) return; // another instance already claimed this user this week

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

export async function sendGoalReminders(): Promise<void> {
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
    const now = new Date();

    // Read the due goals, then CLAIM each via a compare-and-swap on its
    // lastReminderSent (stamp BEFORE the send). The CAS makes the stamp atomic:
    // a concurrent ticker's UPDATE matches 0 rows because the value it read is
    // already advanced, so a goal is reminded once even if the advisory lock was
    // lost. Stamp-before-send biases to "missed once" over "sent twice", which
    // is correct for engagement email. (Replaces the old read→notify→updateMany
    // shape whose TOCTOU window let concurrent ticks both send.)
    const claimedGoals = await withRLSContext(userId, async (tx) => {
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
      const due = goals.filter((g) => {
        const intervalDays =
          REMINDER_INTERVAL_DAYS[g.reminderFrequency ?? ''] ?? DEFAULT_REMINDER_INTERVAL_DAYS;
        if (!g.lastReminderSent) return true;
        const elapsed = nowMs - g.lastReminderSent.getTime();
        // 1h grace so a daily sweep that drifts slightly still fires on schedule.
        return elapsed >= intervalDays * 24 * ONE_HOUR_MS - ONE_HOUR_MS;
      });

      const won: typeof due = [];
      for (const g of due) {
        const res = await tx.healthGoal.updateMany({
          // CAS: only stamp if lastReminderSent is still exactly what we read.
          where: { id: g.id, userId, lastReminderSent: g.lastReminderSent ?? null },
          data: { lastReminderSent: now },
        });
        if (res.count === 1) won.push(g);
      }
      return won;
    });

    if (claimedGoals.length === 0) return;

    await notifyGoalReminder(userId, {
      goals: claimedGoals.slice(0, 5).map((g) => ({
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

export async function sendPlanExpiringNotifications(): Promise<void> {
  // Narrow to users whose expiry is between (now + 6d) and (now + 7d).
  const now = new Date();
  const todayStart = startOfUtcDay(now);
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

    // Claim atomically so each user is notified at most once per UTC day even
    // across instances. Plan-expiring previously had NO per-user marker — it
    // relied solely on the process-local once-per-day guard, which doesn't
    // coordinate replicas — so this closes the multi-instance duplicate gap.
    const claim = await withRLSContext(
      null,
      async (tx) =>
        tx.user.updateMany({
          where: {
            id: u.id,
            OR: [{ lastPlanExpiringSent: null }, { lastPlanExpiringSent: { lt: todayStart } }],
          },
          data: { lastPlanExpiringSent: new Date() },
        }),
      { isAdmin: true }
    );
    if (claim.count !== 1) return; // another instance already claimed this user today

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

  // Each sub-batch is wrapped in withTickLock so only ONE instance runs it per
  // tick (the per-recipient markers inside each batch are the idempotency
  // backstop). The in-memory day-key guards remain a cheap per-process
  // pre-filter to avoid re-attempting within the same process-day; they are no
  // longer the correctness boundary.
  try {
    if (isMondayMorning && lastWeeklyRunKey !== dayKey) {
      lastWeeklyRunKey = dayKey;
      await withTickLock(LOCK_KEY_WEEKLY, sendWeeklySummaries);
    }
    // Goal reminders sweep once per UTC day; each goal is then honored at its
    // own reminderFrequency cadence inside sendGoalReminders (via lastReminderSent).
    if (lastGoalReminderRunKey !== dayKey) {
      lastGoalReminderRunKey = dayKey;
      await withTickLock(LOCK_KEY_GOAL_REMINDER, sendGoalReminders);
    }
    // Once per UTC day (see lastPlanExpiryRunKey) — the hourly tick would
    // otherwise re-notify each in-window user ~24×.
    if (lastPlanExpiryRunKey !== dayKey) {
      lastPlanExpiryRunKey = dayKey;
      await withTickLock(LOCK_KEY_PLAN_EXPIRY, sendPlanExpiringNotifications);
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

/**
 * Test-only: reset the module-scoped per-process day-key guards so each test
 * starts from a clean slate (they persist across runTick calls by design).
 */
export function __resetSchedulerStateForTests(): void {
  lastWeeklyRunKey = null;
  lastPlanExpiryRunKey = null;
  lastGoalReminderRunKey = null;
}
