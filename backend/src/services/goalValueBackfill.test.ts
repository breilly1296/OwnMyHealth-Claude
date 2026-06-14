/**
 * goalValueBackfill unit tests.
 *
 * planGoalValueBackfill decides which legacy plaintext goal values need
 * re-encrypting; applyGoalValueBackfill executes it. These pin the
 * plaintext-present-AND-encrypted-absent rule (idempotency), per-column
 * granularity, history coverage, and the encrypt+null-plaintext write shape.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/index.js';
import { createMockPrismaTransaction, type MockPrismaTx } from '../controllers/testHelpers.js';
import {
  planGoalValueBackfill,
  applyGoalValueBackfill,
  type BackfillableGoal,
} from './goalValueBackfill.js';

function goal(overrides: Partial<BackfillableGoal> = {}): BackfillableGoal {
  return {
    id: 'g1',
    targetValue: null,
    targetValueEncrypted: null,
    currentValue: null,
    currentValueEncrypted: null,
    startValue: null,
    startValueEncrypted: null,
    progressHistory: [],
    ...overrides,
  };
}

describe('planGoalValueBackfill', () => {
  it('backfills a column only when plaintext is set AND the encrypted twin is null', () => {
    const plan = planGoalValueBackfill([
      goal({
        // needs backfill (plaintext present, encrypted null)
        targetValue: 100,
        targetValueEncrypted: null,
        // already encrypted — must be left alone even though plaintext lingers
        currentValue: 150,
        currentValueEncrypted: 'enc:150',
        // nothing to do (both null)
        startValue: null,
        startValueEncrypted: null,
      }),
    ]);

    expect(plan.goalColumnsToBackfill).toBe(1);
    expect(plan.goals).toHaveLength(1);
    expect(plan.goals[0].goalColumns).toEqual({ target: 100 });
  });

  it('covers all three value columns and progress-history rows', () => {
    const plan = planGoalValueBackfill([
      goal({
        targetValue: 100,
        currentValue: 142,
        startValue: 170,
        progressHistory: [
          { id: 'h1', value: 170, valueEncrypted: null }, // needs backfill
          { id: 'h2', value: 160, valueEncrypted: 'enc:160' }, // already encrypted
        ],
      }),
    ]);

    expect(plan.goalColumnsToBackfill).toBe(3);
    expect(plan.historyRowsToBackfill).toBe(1);
    expect(plan.goals[0].goalColumns).toEqual({ target: 100, current: 142, start: 170 });
    expect(plan.goals[0].historyRows).toEqual([{ id: 'h1', value: 170 }]);
  });

  it('is a no-op when everything is already encrypted (idempotent re-run)', () => {
    const plan = planGoalValueBackfill([
      goal({
        targetValue: null,
        targetValueEncrypted: 'enc:100',
        currentValue: null,
        currentValueEncrypted: 'enc:142',
        startValue: null,
        startValueEncrypted: 'enc:170',
        progressHistory: [{ id: 'h1', value: null, valueEncrypted: 'enc:170' }],
      }),
    ]);
    expect(plan.goalColumnsToBackfill).toBe(0);
    expect(plan.historyRowsToBackfill).toBe(0);
    expect(plan.goals).toHaveLength(0);
  });
});

describe('applyGoalValueBackfill', () => {
  it('encrypts each needing value and nulls the plaintext twin', async () => {
    const tx = createMockPrismaTransaction() as unknown as MockPrismaTx & Prisma.TransactionClient;
    tx.healthGoal.update.mockResolvedValue({});
    tx.goalProgressHistory.update.mockResolvedValue({});

    const plan = planGoalValueBackfill([
      goal({
        id: 'g1',
        targetValue: 100,
        currentValue: 142,
        startValue: 170,
        progressHistory: [{ id: 'h1', value: 170, valueEncrypted: null }],
      }),
    ]);

    const stats = await applyGoalValueBackfill(tx, (p) => `enc:${p}`, plan);

    expect(stats).toEqual({ goalsUpdated: 1, historyRowsUpdated: 1 });

    const goalData = tx.healthGoal.update.mock.calls[0][0].data;
    expect(goalData).toMatchObject({
      targetValueEncrypted: 'enc:100',
      targetValue: null,
      currentValueEncrypted: 'enc:142',
      currentValue: null,
      startValueEncrypted: 'enc:170',
      startValue: null,
    });

    const historyData = tx.goalProgressHistory.update.mock.calls[0][0].data;
    expect(historyData).toEqual({ valueEncrypted: 'enc:170', value: null });
  });

  it('does nothing for an empty plan', async () => {
    const tx = createMockPrismaTransaction() as unknown as MockPrismaTx & Prisma.TransactionClient;
    const plan = planGoalValueBackfill([goal()]);
    const stats = await applyGoalValueBackfill(tx, vi.fn(), plan);
    expect(stats).toEqual({ goalsUpdated: 0, historyRowsUpdated: 0 });
    expect(tx.healthGoal.update).not.toHaveBeenCalled();
  });
});
