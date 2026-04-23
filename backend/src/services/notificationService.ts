/**
 * Notification Dispatch Service
 *
 * Thin layer between the rest of the app and SendGrid. Each exported
 * `notify*` helper:
 *   1. Checks the user's preferences (`email.enabled` + the specific
 *      subcategory flag). No preference row, or legacy null = opted in.
 *   2. Loads the user's email address under an admin RLS context — the
 *      caller is typically the user themselves, but background schedulers
 *      have no user context.
 *   3. Builds the HTML via `emailTemplates.ts`.
 *   4. Calls `emailService.send()`.
 *
 * Callers should treat these as fire-and-forget:
 *   notifyNewResults(...).catch(err => logger.error(...));
 * Never await them on a request-handler's critical path — email delivery
 * time should not be in the user's response latency budget.
 */

import { withRLSContext } from './database.js';
import { emailService } from './emailService.js';
import {
  buildNewResultsEmail,
  buildOutOfRangeAlert,
  buildGoalReminderEmail,
  buildWeeklySummaryEmail,
  buildPlanExpiringEmail,
  type NewResultsEmailData,
  type OutOfRangeEmailData,
  type GoalReminderEmailData,
  type WeeklySummaryEmailData,
  type PlanExpiringEmailData,
} from './emailTemplates.js';
import {
  normalizeNotificationPreferences,
  type EmailNotificationPreferences,
} from '../controllers/settingsController.js';
import { logger } from '../utils/logger.js';

type EmailPrefKey = keyof EmailNotificationPreferences;

interface UserForEmail {
  email: string;
  prefs: EmailNotificationPreferences;
}

/**
 * Fetch user's email + normalized email preferences under an admin RLS
 * context. The dispatcher needs this for users who aren't the caller
 * (scheduled batches) and for the caller themselves (post-upload triggers).
 */
async function loadUserForEmail(userId: string): Promise<UserForEmail | null> {
  const user = await withRLSContext(
    null,
    async (tx) => {
      return tx.user.findUnique({
        where: { id: userId },
        select: { email: true, notificationPreferences: true },
      });
    },
    { isAdmin: true }
  );
  if (!user) return null;
  const prefs = normalizeNotificationPreferences(user.notificationPreferences).email;
  return { email: user.email, prefs };
}

/**
 * Preference gate. Returns true when the user has:
 *   - master `enabled` = true, AND
 *   - the specific sub-flag = true.
 *
 * Exported mostly for unit tests — callers should use the `notify*` helpers
 * which already call this.
 */
export async function shouldSendNotification(
  userId: string,
  type: EmailPrefKey
): Promise<boolean> {
  const loaded = await loadUserForEmail(userId);
  if (!loaded) return false;
  if (!loaded.prefs.enabled) return false;
  return loaded.prefs[type] === true;
}

/** Log + swallow. Never throw from a fire-and-forget notification path. */
function logFailure(tag: string, userId: string, err: unknown): void {
  logger.error(`Email notification failed: ${tag}`, {
    prefix: 'Notification',
    data: {
      userId,
      error: err instanceof Error ? err.message : String(err),
    },
  });
}

// ============================================
// Public dispatchers
// ============================================

export async function notifyNewResults(
  userId: string,
  data: NewResultsEmailData
): Promise<void> {
  try {
    const loaded = await loadUserForEmail(userId);
    if (!loaded || !loaded.prefs.enabled || !loaded.prefs.newResults) return;
    const { subject, html, text } = buildNewResultsEmail(data);
    await emailService.send(loaded.email, subject, html, text);
  } catch (err) {
    logFailure('newResults', userId, err);
  }
}

export async function notifyOutOfRange(
  userId: string,
  data: OutOfRangeEmailData
): Promise<void> {
  try {
    if (data.biomarkers.length === 0) return;
    const loaded = await loadUserForEmail(userId);
    if (!loaded || !loaded.prefs.enabled || !loaded.prefs.outOfRangeAlerts) return;
    const { subject, html, text } = buildOutOfRangeAlert(data);
    await emailService.send(loaded.email, subject, html, text);
  } catch (err) {
    logFailure('outOfRange', userId, err);
  }
}

export async function notifyGoalReminder(
  userId: string,
  data: GoalReminderEmailData
): Promise<void> {
  try {
    const loaded = await loadUserForEmail(userId);
    if (!loaded || !loaded.prefs.enabled || !loaded.prefs.goalReminders) return;
    const { subject, html, text } = buildGoalReminderEmail(data);
    await emailService.send(loaded.email, subject, html, text);
  } catch (err) {
    logFailure('goalReminder', userId, err);
  }
}

export async function notifyWeeklySummary(
  userId: string,
  data: WeeklySummaryEmailData
): Promise<void> {
  try {
    const loaded = await loadUserForEmail(userId);
    if (!loaded || !loaded.prefs.enabled || !loaded.prefs.weeklySummary) return;
    const { subject, html, text } = buildWeeklySummaryEmail(data);
    await emailService.send(loaded.email, subject, html, text);
  } catch (err) {
    logFailure('weeklySummary', userId, err);
  }
}

export async function notifyPlanExpiring(
  userId: string,
  data: PlanExpiringEmailData
): Promise<void> {
  try {
    const loaded = await loadUserForEmail(userId);
    if (!loaded || !loaded.prefs.enabled || !loaded.prefs.planExpiring) return;
    const { subject, html, text } = buildPlanExpiringEmail(data);
    await emailService.send(loaded.email, subject, html, text);
  } catch (err) {
    logFailure('planExpiring', userId, err);
  }
}
