/**
 * One-time consolidation of pre-existing duplicate biomarker rows into a single
 * time series per (name, unit).
 *
 * Companion to services/biomarkerSeries.ts. That change makes NEW readings
 * append to an existing series; this module fixes data created BEFORE it, where
 * each reading became its own disconnected single-point `Biomarker` row. It
 * folds the older duplicate rows into the latest-dated one (the "anchor"),
 * moving their points into `BiomarkerHistory`, then deletes the now-redundant
 * rows — producing exactly the shape upsertBiomarkerReading maintains going
 * forward (current row = newest point, history = older points).
 *
 * Two halves, kept separate so the decision logic is unit-testable without a DB:
 *   - planUserConsolidation(rows): pure — decides what to merge.
 *   - applyUserConsolidation(tx, plan): executes the plan in an RLS transaction.
 *
 * Idempotent: after a run each series is a single row, so a second run finds no
 * groups of size > 1 and is a no-op. Ciphertext is moved as-is (all rows for one
 * user share that user's salt), so NO decryption happens here and no PHI value
 * is ever read or logged.
 */

import type { Prisma } from '../../generated/prisma/index.js';

/** The minimal biomarker shape this module needs (id + series key + points). */
export interface ConsolidatableBiomarker {
  id: string;
  name: string;
  unit: string;
  measurementDate: Date;
  valueEncrypted: string;
  createdAt: Date;
  history: { id: string; measurementDate: Date; valueEncrypted: string }[];
}

export interface SeriesMergePlan {
  key: string;
  name: string;
  unit: string;
  /** Row kept as the canonical series (the latest measurement). */
  anchorId: string;
  /** Older rows folded in and then deleted. */
  duplicateIds: string[];
  /** Each duplicate's own current point, added to the anchor's history. */
  addedHistoryPoints: { valueEncrypted: string; measurementDate: Date }[];
  /** Existing history rows (by id) re-parented from duplicates onto the anchor. */
  reparentHistoryIds: string[];
}

export interface UserConsolidationPlan {
  merges: SeriesMergePlan[];
  rowsBefore: number;
  rowsAfter: number;
  seriesAffected: number;
}

/**
 * Normalized series identity: case- and whitespace-insensitive (name, unit).
 * Joined with NUL, which Postgres text columns cannot contain — so it can never
 * collide the way a plain space would, e.g. ("A B","C") vs ("A","B C").
 */
export function seriesKey(name: string, unit: string): string {
  return [name.trim().toLowerCase(), unit.trim().toLowerCase()].join(String.fromCharCode(0));
}

/**
 * Decide how to fold one user's biomarker rows into series. Pure — no I/O.
 * Groups by normalized (name, unit); for each group of size > 1, the row with
 * the latest measurement date is the anchor and the rest are folded in.
 */
export function planUserConsolidation(rows: ConsolidatableBiomarker[]): UserConsolidationPlan {
  const groups = new Map<string, ConsolidatableBiomarker[]>();
  for (const r of rows) {
    const k = seriesKey(r.name, r.unit);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }

  const merges: SeriesMergePlan[] = [];
  let duplicates = 0;

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    // Anchor = latest measurement. Deterministic tie-breaks: newer createdAt,
    // then lexically-greater id, so a re-run (or a test) is stable.
    const sorted = [...group].sort((a, b) => {
      const byDate = b.measurementDate.getTime() - a.measurementDate.getTime();
      if (byDate !== 0) return byDate;
      const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
      if (byCreated !== 0) return byCreated;
      return b.id.localeCompare(a.id);
    });

    const anchor = sorted[0];
    const dups = sorted.slice(1);
    duplicates += dups.length;

    merges.push({
      key,
      name: anchor.name,
      unit: anchor.unit,
      anchorId: anchor.id,
      duplicateIds: dups.map((d) => d.id),
      // Preserve every duplicate's own reading as a history point — never drop a
      // measurement, even one sharing the anchor's date.
      addedHistoryPoints: dups.map((d) => ({
        valueEncrypted: d.valueEncrypted,
        measurementDate: d.measurementDate,
      })),
      reparentHistoryIds: dups.flatMap((d) => d.history.map((h) => h.id)),
    });
  }

  return {
    merges,
    rowsBefore: rows.length,
    rowsAfter: rows.length - duplicates,
    seriesAffected: merges.length,
  };
}

export interface ApplyStats {
  rowsDeleted: number;
  historyPointsAdded: number;
  historyReparented: number;
}

/**
 * Execute a user's plan inside an RLS transaction. Order is load-bearing:
 *   1. re-parent each duplicate's existing history rows onto the anchor
 *      (BEFORE deleting the duplicate, whose FK cascade would otherwise drop them),
 *   2. add each duplicate's own current point to the anchor's history,
 *   3. delete the (now history-free) duplicate rows.
 */
export async function applyUserConsolidation(
  tx: Prisma.TransactionClient,
  plan: UserConsolidationPlan
): Promise<ApplyStats> {
  const stats: ApplyStats = { rowsDeleted: 0, historyPointsAdded: 0, historyReparented: 0 };

  for (const m of plan.merges) {
    if (m.reparentHistoryIds.length > 0) {
      const res = await tx.biomarkerHistory.updateMany({
        where: { id: { in: m.reparentHistoryIds } },
        data: { biomarkerId: m.anchorId },
      });
      stats.historyReparented += res.count;
    }

    for (const p of m.addedHistoryPoints) {
      await tx.biomarkerHistory.create({
        data: {
          biomarkerId: m.anchorId,
          valueEncrypted: p.valueEncrypted,
          measurementDate: p.measurementDate,
        },
      });
      stats.historyPointsAdded++;
    }

    const del = await tx.biomarker.deleteMany({ where: { id: { in: m.duplicateIds } } });
    stats.rowsDeleted += del.count;
  }

  return stats;
}
