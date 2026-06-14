/**
 * One-time migration: re-encrypt legacy plaintext goal values into their
 * encrypted twins (M6).
 *
 * Companion to the M4 encryption change (migration 20260613). That change makes
 * NEW goal writes store ciphertext + null the plaintext; this re-encrypts rows
 * written BEFORE it — health_goals.target_value / current_value / start_value
 * and goal_progress_history.value — which still hold plaintext PHI. Run it ONCE,
 * AFTER M4 is deployed.
 *
 * Safe by default: DRY RUN unless `--apply`. Operates per-user inside an RLS
 * transaction (one user's rows at a time), encrypting with that user's key. Logs
 * counts only — never PHI values. Idempotent (a value is backfilled only when
 * its plaintext is set and the encrypted twin is null).
 *
 * Usage (from backend/, with backend/.env providing DATABASE_URL + PHI_ENCRYPTION_KEY):
 *   npx tsx scripts/backfill-goal-value-encryption.ts             # dry run, all users
 *   npx tsx scripts/backfill-goal-value-encryption.ts --apply     # perform it
 *   npx tsx scripts/backfill-goal-value-encryption.ts --user <uuid> [--apply]
 * or via npm:  npm run backfill:goal-values -- --apply
 *
 * NOTE: this covers goal VALUE columns (per-user-salt encrypted). audit_logs.metadata
 * is also legacy-plaintext but uses a different encryption context and is a
 * separate follow-up.
 */

import {
  initializeDatabase,
  disconnectDatabase,
  withRLSContext,
  withRLSTransaction,
} from '../src/services/database.js';
import { getEncryptionService } from '../src/services/encryption.js';
import { getUserEncryptionSalt } from '../src/services/userEncryption.js';
import {
  planGoalValueBackfill,
  applyGoalValueBackfill,
  type BackfillableGoal,
} from '../src/services/goalValueBackfill.js';

const APPLY = process.argv.includes('--apply');

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const onlyUser = argValue('--user');

async function listUserIds(): Promise<string[]> {
  if (onlyUser) return [onlyUser];
  const users = await withRLSContext(null, async (tx) =>
    tx.user.findMany({ select: { id: true } })
  );
  return users.map((u) => u.id);
}

async function loadGoals(userId: string): Promise<BackfillableGoal[]> {
  const goals = await withRLSContext(userId, async (tx) =>
    tx.healthGoal.findMany({
      where: { userId },
      select: {
        id: true,
        targetValue: true,
        targetValueEncrypted: true,
        currentValue: true,
        currentValueEncrypted: true,
        startValue: true,
        startValueEncrypted: true,
        progressHistory: { select: { id: true, value: true, valueEncrypted: true } },
      },
    })
  );
  return goals as BackfillableGoal[];
}

async function main(): Promise<void> {
  await initializeDatabase();

  const userIds = await listUserIds();
  console.log(`[backfill-goal-values] ${APPLY ? 'APPLY' : 'DRY RUN'} over ${userIds.length} user(s)`);

  let usersAffected = 0;
  let goalColumns = 0;
  let historyRows = 0;

  for (const userId of userIds) {
    const goals = await loadGoals(userId);
    const plan = planGoalValueBackfill(goals);
    if (plan.goalColumnsToBackfill === 0 && plan.historyRowsToBackfill === 0) continue;

    usersAffected++;
    goalColumns += plan.goalColumnsToBackfill;
    historyRows += plan.historyRowsToBackfill;

    console.log(
      `  user ${userId}: ${plan.goals.length} goal(s), ` +
        `${plan.goalColumnsToBackfill} value column(s) + ${plan.historyRowsToBackfill} history row(s) to encrypt`
    );

    if (APPLY) {
      const salt = await getUserEncryptionSalt(userId);
      const encryption = getEncryptionService();
      // Per-user transaction is small (a user's goals + their history rows), so
      // Prisma's default interactive-transaction timeout is ample.
      const stats = await withRLSTransaction(userId, async (tx) =>
        applyGoalValueBackfill(tx, (p) => encryption.encrypt(p, salt), plan)
      );
      console.log(`      applied: ${stats.goalsUpdated} goal(s), ${stats.historyRowsUpdated} history row(s)`);
    }
  }

  console.log('');
  console.log(
    `[backfill-goal-values] ${APPLY ? 'APPLIED' : 'DRY RUN'} — ${usersAffected} user(s), ` +
      `${goalColumns} goal value column(s) + ${historyRows} history row(s) ` +
      `${APPLY ? 'encrypted' : 'to encrypt'}.`
  );
  if (!APPLY) console.log('[backfill-goal-values] Re-run with --apply to perform the migration.');

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('[backfill-goal-values] FAILED:', err instanceof Error ? err.message : err);
  try {
    await disconnectDatabase();
  } catch {
    /* ignore disconnect errors during failure cleanup */
  }
  process.exit(1);
});
