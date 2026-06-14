/**
 * One-time migration: consolidate pre-existing duplicate biomarker rows into a
 * single time series per (name, unit).
 *
 * Companion to the services/biomarkerSeries.ts fix (which makes NEW readings
 * append to a series). Run this ONCE, AFTER that change is deployed — otherwise
 * freshly-merged data and old disconnected rows coexist.
 *
 * This file lives under src/ (not scripts/) on purpose: it is compiled by
 * `npm run build` into dist/maintenance/consolidateBiomarkerSeries.js so it can
 * run in the PRODUCTION image with plain `node` (the prod image has no tsx and
 * does not copy scripts/). It is executed against prod as a Cloud Run job by
 * .github/workflows/maintenance.yml. Nothing imports this module, so the
 * top-level main() runs only when the file is invoked directly.
 *
 * Safe by default: DRY RUN unless `--apply` is passed. Operates per-user inside
 * an RLS transaction, so it can only ever touch one user's rows at a time. Logs
 * counts and metric names/units only — never PHI values (ciphertext is moved
 * as-is; nothing is decrypted).
 *
 * Usage:
 *   Local (from backend/, with backend/.env): npm run consolidate:biomarkers -- [--apply] [--user <uuid>]
 *   Prod  (Cloud Run job): node dist/maintenance/consolidateBiomarkerSeries.js [--apply] [--user <uuid>]
 */

import {
  initializeDatabase,
  disconnectDatabase,
  withRLSContext,
  withRLSTransaction,
} from '../services/database.js';
import {
  planUserConsolidation,
  applyUserConsolidation,
  type ConsolidatableBiomarker,
} from '../services/biomarkerConsolidation.js';

const APPLY = process.argv.includes('--apply');

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const onlyUser = argValue('--user');

async function listUserIds(): Promise<string[]> {
  if (onlyUser) return [onlyUser];
  // Admin (null) context enumerates all users; per-user work below is scoped.
  const users = await withRLSContext(null, async (tx) =>
    tx.user.findMany({ select: { id: true } })
  );
  return users.map((u) => u.id);
}

async function loadRows(userId: string): Promise<ConsolidatableBiomarker[]> {
  const rows = await withRLSContext(userId, async (tx) =>
    tx.biomarker.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        unit: true,
        measurementDate: true,
        valueEncrypted: true,
        createdAt: true,
        history: { select: { id: true, measurementDate: true, valueEncrypted: true } },
      },
    })
  );
  return rows as ConsolidatableBiomarker[];
}

async function main(): Promise<void> {
  await initializeDatabase();

  const userIds = await listUserIds();
  console.log(`[consolidate] ${APPLY ? 'APPLY' : 'DRY RUN'} over ${userIds.length} user(s)`);

  let usersAffected = 0;
  let seriesMerged = 0;
  let rowsRemoved = 0;

  for (const userId of userIds) {
    const rows = await loadRows(userId);
    const plan = planUserConsolidation(rows);
    if (plan.seriesAffected === 0) continue;

    usersAffected++;
    seriesMerged += plan.seriesAffected;

    console.log(
      `  user ${userId}: ${plan.rowsBefore} rows -> ${plan.rowsAfter} ` +
        `(${plan.seriesAffected} series merged)`
    );
    for (const m of plan.merges) {
      console.log(
        `      "${m.name}" (${m.unit}): ${m.duplicateIds.length + 1} rows -> 1 ` +
          `(+${m.addedHistoryPoints.length} history, ${m.reparentHistoryIds.length} reparented)`
      );
    }

    if (APPLY) {
      const stats = await withRLSTransaction(
        userId,
        async (tx) => applyUserConsolidation(tx, plan),
        { timeout: 60_000, maxWait: 15_000 }
      );
      rowsRemoved += stats.rowsDeleted;
      console.log(
        `      applied: -${stats.rowsDeleted} rows, +${stats.historyPointsAdded} history, ` +
          `${stats.historyReparented} reparented`
      );
    } else {
      rowsRemoved += plan.rowsBefore - plan.rowsAfter;
    }
  }

  console.log('');
  console.log(
    `[consolidate] ${APPLY ? 'APPLIED' : 'DRY RUN'} — ${usersAffected} user(s), ` +
      `${seriesMerged} series merged, ${rowsRemoved} duplicate rows ` +
      `${APPLY ? 'deleted' : 'would be deleted'}.`
  );
  if (!APPLY) console.log('[consolidate] Re-run with --apply to perform the migration.');

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('[consolidate] FAILED:', err instanceof Error ? err.message : err);
  try {
    await disconnectDatabase();
  } catch {
    /* ignore disconnect errors during failure cleanup */
  }
  process.exit(1);
});
