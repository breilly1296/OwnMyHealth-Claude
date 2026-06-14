/**
 * One-time backfill of legacy plaintext goal values into their encrypted twins.
 *
 * Companion to the M4 encryption change (services/healthGoalsController +
 * migration 20260613). That change makes NEW writes store ciphertext and null
 * the plaintext twin, but rows written BEFORE it still hold plaintext in
 * health_goals.target_value / current_value / start_value and
 * goal_progress_history.value. This re-encrypts each such value into its
 * `*Encrypted` column and nulls the plaintext — the step that needs per-user
 * keys (via the userEncryption service), which pure SQL migrations can't do.
 *
 * Two halves so the decision logic is unit-testable without a DB or crypto:
 *   - planGoalValueBackfill(goals): pure — decides which columns/rows to backfill.
 *   - applyGoalValueBackfill(tx, encrypt, plan): executes the plan in a tx.
 *
 * Idempotent: a value is backfilled ONLY when its plaintext column is set AND
 * the encrypted twin is null, so a second run finds nothing. No value is ever
 * logged (PHI).
 */

import type { Prisma } from '../../generated/prisma/index.js';

/** Minimal goal shape this module needs: the value column pairs + history. */
export interface BackfillableGoal {
  id: string;
  targetValue: unknown;
  targetValueEncrypted: string | null;
  currentValue: unknown;
  currentValueEncrypted: string | null;
  startValue: unknown;
  startValueEncrypted: string | null;
  progressHistory: { id: string; value: unknown; valueEncrypted: string | null }[];
}

export interface GoalBackfillOps {
  goalId: string;
  /** Only the columns that need backfill, with the plaintext number to encrypt. */
  goalColumns: { target?: number; current?: number; start?: number };
  historyRows: { id: string; value: number }[];
}

export interface BackfillPlan {
  goals: GoalBackfillOps[];
  goalColumnsToBackfill: number;
  historyRowsToBackfill: number;
}

/**
 * A value needs backfill iff the plaintext is present AND the encrypted twin is
 * absent. Returns the plaintext as a number, or null when no backfill is needed.
 */
function backfillValue(plaintext: unknown, encrypted: string | null): number | null {
  if (encrypted) return null; // already encrypted — leave it
  if (plaintext === null || plaintext === undefined) return null; // nothing to encrypt
  return Number(plaintext);
}

/** Decide what to backfill for one user's goals. Pure — no I/O, no crypto. */
export function planGoalValueBackfill(goals: BackfillableGoal[]): BackfillPlan {
  const ops: GoalBackfillOps[] = [];
  let goalColumnsToBackfill = 0;
  let historyRowsToBackfill = 0;

  for (const g of goals) {
    const goalColumns: GoalBackfillOps['goalColumns'] = {};
    const t = backfillValue(g.targetValue, g.targetValueEncrypted);
    const c = backfillValue(g.currentValue, g.currentValueEncrypted);
    const s = backfillValue(g.startValue, g.startValueEncrypted);
    if (t !== null) { goalColumns.target = t; goalColumnsToBackfill++; }
    if (c !== null) { goalColumns.current = c; goalColumnsToBackfill++; }
    if (s !== null) { goalColumns.start = s; goalColumnsToBackfill++; }

    const historyRows: { id: string; value: number }[] = [];
    for (const h of g.progressHistory) {
      const v = backfillValue(h.value, h.valueEncrypted);
      if (v !== null) { historyRows.push({ id: h.id, value: v }); historyRowsToBackfill++; }
    }

    if (Object.keys(goalColumns).length > 0 || historyRows.length > 0) {
      ops.push({ goalId: g.id, goalColumns, historyRows });
    }
  }

  return { goals: ops, goalColumnsToBackfill, historyRowsToBackfill };
}

/** Encrypts a plaintext string with the caller's already-salted context. */
export type EncryptFn = (plaintext: string) => string;

export interface BackfillStats {
  goalsUpdated: number;
  historyRowsUpdated: number;
}

/**
 * Execute a backfill plan inside an RLS transaction. For each needing column,
 * write the encrypted value and null the plaintext twin (the same end state the
 * controller now produces for new writes).
 */
export async function applyGoalValueBackfill(
  tx: Prisma.TransactionClient,
  encrypt: EncryptFn,
  plan: BackfillPlan
): Promise<BackfillStats> {
  const stats: BackfillStats = { goalsUpdated: 0, historyRowsUpdated: 0 };

  for (const op of plan.goals) {
    const data: Record<string, unknown> = {};
    if (op.goalColumns.target !== undefined) {
      data.targetValueEncrypted = encrypt(String(op.goalColumns.target));
      data.targetValue = null;
    }
    if (op.goalColumns.current !== undefined) {
      data.currentValueEncrypted = encrypt(String(op.goalColumns.current));
      data.currentValue = null;
    }
    if (op.goalColumns.start !== undefined) {
      data.startValueEncrypted = encrypt(String(op.goalColumns.start));
      data.startValue = null;
    }
    if (Object.keys(data).length > 0) {
      await tx.healthGoal.update({ where: { id: op.goalId }, data });
      stats.goalsUpdated++;
    }

    for (const h of op.historyRows) {
      await tx.goalProgressHistory.update({
        where: { id: h.id },
        data: { valueEncrypted: encrypt(String(h.value)), value: null },
      });
      stats.historyRowsUpdated++;
    }
  }

  return stats;
}
