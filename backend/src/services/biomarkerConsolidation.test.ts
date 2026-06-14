/**
 * biomarkerConsolidation unit tests.
 *
 * planUserConsolidation is the decision logic for the one-time fold of
 * pre-existing duplicate biomarker rows into a single series; applyUserConsolidation
 * executes a plan. These pin the grouping, anchor selection, point preservation,
 * idempotency, and the load-bearing reparent-before-delete order.
 */

import { describe, it, expect } from 'vitest';
import type { Prisma } from '../../generated/prisma/index.js';
import { createMockPrismaTransaction, type MockPrismaTx } from '../controllers/testHelpers.js';
import {
  seriesKey,
  planUserConsolidation,
  applyUserConsolidation,
  type ConsolidatableBiomarker,
} from './biomarkerConsolidation.js';

function row(overrides: Partial<ConsolidatableBiomarker> = {}): ConsolidatableBiomarker {
  return {
    id: 'r1',
    name: 'Glucose',
    unit: 'mg/dL',
    measurementDate: new Date('2026-01-01'),
    valueEncrypted: 'enc:90',
    createdAt: new Date('2026-01-01'),
    history: [],
    ...overrides,
  };
}

describe('seriesKey', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(seriesKey('Glucose', 'mg/dL')).toBe(seriesKey('  glucose ', 'MG/DL'));
  });

  it('does not collide across a moved space (NUL-delimited)', () => {
    expect(seriesKey('A B', 'C')).not.toBe(seriesKey('A', 'B C'));
  });
});

describe('planUserConsolidation', () => {
  it('returns no merges when every metric is already a single row', () => {
    const plan = planUserConsolidation([
      row({ id: 'a', name: 'Glucose', unit: 'mg/dL' }),
      row({ id: 'b', name: 'HDL', unit: 'mg/dL' }),
    ]);
    expect(plan.seriesAffected).toBe(0);
    expect(plan.merges).toHaveLength(0);
    expect(plan.rowsAfter).toBe(plan.rowsBefore);
  });

  it('folds duplicates of one metric into the latest-dated anchor', () => {
    const plan = planUserConsolidation([
      row({ id: 'jan', measurementDate: new Date('2026-01-01'), valueEncrypted: 'enc:90' }),
      row({ id: 'mar', measurementDate: new Date('2026-03-01'), valueEncrypted: 'enc:99' }),
      row({ id: 'feb', measurementDate: new Date('2026-02-01'), valueEncrypted: 'enc:95' }),
    ]);

    expect(plan.seriesAffected).toBe(1);
    expect(plan.rowsBefore).toBe(3);
    expect(plan.rowsAfter).toBe(1);

    const m = plan.merges[0];
    expect(m.anchorId).toBe('mar'); // latest date is the anchor
    expect(new Set(m.duplicateIds)).toEqual(new Set(['jan', 'feb']));
    // Both duplicates' own points are preserved as history on the anchor.
    expect(m.addedHistoryPoints).toHaveLength(2);
    expect(m.addedHistoryPoints.map((p) => p.valueEncrypted).sort()).toEqual(['enc:90', 'enc:95']);
  });

  it('groups case/space variants of the same metric together', () => {
    const plan = planUserConsolidation([
      row({ id: 'a', name: 'Glucose', unit: 'mg/dL', measurementDate: new Date('2026-01-01') }),
      row({ id: 'b', name: 'glucose', unit: ' MG/DL ', measurementDate: new Date('2026-02-01') }),
    ]);
    expect(plan.seriesAffected).toBe(1);
    expect(plan.rowsAfter).toBe(1);
  });

  it('keeps different units as separate series (not comparable scales)', () => {
    const plan = planUserConsolidation([
      row({ id: 'a', name: 'Glucose', unit: 'mg/dL' }),
      row({ id: 'b', name: 'Glucose', unit: 'mmol/L' }),
    ]);
    expect(plan.seriesAffected).toBe(0);
  });

  it('re-parents the duplicates existing history rows onto the anchor', () => {
    const plan = planUserConsolidation([
      row({
        id: 'old',
        measurementDate: new Date('2026-01-01'),
        history: [
          { id: 'h1', measurementDate: new Date('2025-12-01'), valueEncrypted: 'enc:80' },
          { id: 'h2', measurementDate: new Date('2025-11-01'), valueEncrypted: 'enc:70' },
        ],
      }),
      row({ id: 'new', measurementDate: new Date('2026-03-01') }),
    ]);
    const m = plan.merges[0];
    expect(m.anchorId).toBe('new');
    expect(new Set(m.reparentHistoryIds)).toEqual(new Set(['h1', 'h2']));
  });

  it('breaks a same-date tie deterministically by createdAt then id', () => {
    const plan = planUserConsolidation([
      row({ id: 'older-created', measurementDate: new Date('2026-01-01'), createdAt: new Date('2026-01-01') }),
      row({ id: 'newer-created', measurementDate: new Date('2026-01-01'), createdAt: new Date('2026-01-05') }),
    ]);
    expect(plan.merges[0].anchorId).toBe('newer-created');
  });
});

describe('applyUserConsolidation', () => {
  it('re-parents history BEFORE deleting, adds points, and reports stats', async () => {
    const tx = createMockPrismaTransaction() as unknown as MockPrismaTx & Prisma.TransactionClient;
    tx.biomarkerHistory.updateMany.mockResolvedValue({ count: 2 });
    tx.biomarkerHistory.create.mockResolvedValue({});
    tx.biomarker.deleteMany.mockResolvedValue({ count: 1 });

    const plan = planUserConsolidation([
      row({
        id: 'old',
        measurementDate: new Date('2026-01-01'),
        valueEncrypted: 'enc:90',
        history: [{ id: 'h1', measurementDate: new Date('2025-12-01'), valueEncrypted: 'enc:80' }],
      }),
      row({ id: 'new', measurementDate: new Date('2026-03-01') }),
    ]);

    const order: string[] = [];
    tx.biomarkerHistory.updateMany.mockImplementation(async () => { order.push('reparent'); return { count: 1 }; });
    tx.biomarker.deleteMany.mockImplementation(async () => { order.push('delete'); return { count: 1 }; });

    const stats = await applyUserConsolidation(tx, plan);

    // Reparent must run before delete (the dup's FK cascade would otherwise drop the history).
    expect(order).toEqual(['reparent', 'delete']);
    // The dup's own current point is added to the anchor.
    expect(tx.biomarkerHistory.create).toHaveBeenCalledWith({
      data: { biomarkerId: 'new', valueEncrypted: 'enc:90', measurementDate: new Date('2026-01-01') },
    });
    expect(stats.rowsDeleted).toBe(1);
    expect(stats.historyPointsAdded).toBe(1);
  });

  it('does nothing when the plan has no merges', async () => {
    const tx = createMockPrismaTransaction() as unknown as MockPrismaTx & Prisma.TransactionClient;
    const plan = planUserConsolidation([row({ id: 'solo' })]);
    const stats = await applyUserConsolidation(tx, plan);
    expect(stats).toEqual({ rowsDeleted: 0, historyPointsAdded: 0, historyReparented: 0 });
    expect(tx.biomarker.deleteMany).not.toHaveBeenCalled();
    expect(tx.biomarkerHistory.create).not.toHaveBeenCalled();
  });
});
