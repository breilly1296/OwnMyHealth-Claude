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
 * This file lives under src/ (not scripts/) on purpose: it is compiled by
 * `npm run build` into dist/maintenance/backfillGoalValues.js so it can run in
 * the PRODUCTION image with plain `node` (the prod image has no tsx and does not
 * copy scripts/). It is executed against prod as a Cloud Run job by
 * .github/workflows/maintenance.yml, which mounts the SAME PHI_ENCRYPTION_KEY
 * secret the service uses — so the ciphertext it writes is decryptable by prod.
 * Nothing imports this module, so the top-level main() runs only when the file
 * is invoked directly.
 *
 * Safe by default: DRY RUN unless `--apply`. Operates per-user inside an RLS
 * transaction (one user's rows at a time), encrypting with that user's key. Logs
 * counts only — never PHI values. Idempotent (a value is backfilled only when
 * its plaintext is set and the encrypted twin is null).
 *
 * Usage:
 *   Local (from backend/, with backend/.env): npm run backfill:goal-values -- [--apply] [--user <uuid>]
 *   Prod  (Cloud Run job): node dist/maintenance/backfillGoalValues.js [--apply] [--user <uuid>]
 *
 * NOTE: this covers goal VALUE columns (per-user-salt encrypted). The other
 * legacy-plaintext residue, audit_logs.metadata, could not be re-encrypted in
 * place (the audit table is immutable by RLS) — its plaintext column was instead
 * DROPPED in migration 20260615_drop_legacy_audit_metadata (M6).
 */

import {
  initializeDatabase,
  disconnectDatabase,
  withRLSContext,
  withRLSTransaction,
} from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import {
  planGoalValueBackfill,
  applyGoalValueBackfill,
  type BackfillableGoal,
} from '../services/goalValueBackfill.js';

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
