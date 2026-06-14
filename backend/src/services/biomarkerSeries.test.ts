/**
 * upsertBiomarkerReading unit tests.
 *
 * The series-merge decision is the heart of the "biomarkers accrue history over
 * time" fix. These tests pin every branch against a mocked transaction:
 *   - no existing series      -> create the anchor row                ('created')
 *   - newer than current      -> archive current, promote the reading ('promoted')
 *   - older than current      -> store as a history point             ('archived')
 *   - same date as current    -> correct the current point in place   ('corrected')
 * plus the case-insensitive (name, unit) series match.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/index.js';
import { createMockPrismaTransaction, type MockPrismaTx } from '../controllers/testHelpers.js';
import {
  upsertBiomarkerReading,
  type BiomarkerReadingInput,
} from './biomarkerSeries.js';

function makeReading(overrides: Partial<BiomarkerReadingInput> = {}): BiomarkerReadingInput {
  return {
    category: 'METABOLIC',
    name: 'Glucose',
    unit: 'mg/dL',
    valueEncrypted: 'enc:99',
    notesEncrypted: null,
    normalRangeMin: 70,
    normalRangeMax: 100,
    normalRangeSource: null,
    measurementDate: new Date('2026-02-01'),
    sourceType: 'MANUAL',
    sourceFile: null,
    extractionConfidence: null,
    labName: null,
    isOutOfRange: false,
    ...overrides,
  };
}

function makeExistingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'series-1',
    userId: 'user-A',
    name: 'Glucose',
    category: 'METABOLIC',
    unit: 'mg/dL',
    valueEncrypted: 'enc:88',
    notesEncrypted: null,
    normalRangeMin: 70,
    normalRangeMax: 100,
    normalRangeSource: null,
    measurementDate: new Date('2026-01-15'),
    sourceType: 'MANUAL',
    sourceFile: null,
    extractionConfidence: null,
    labName: null,
    isOutOfRange: false,
    isAcknowledged: false,
    history: [],
    ...overrides,
  };
}

const tx = () => createMockPrismaTransaction() as unknown as MockPrismaTx & Prisma.TransactionClient;

describe('upsertBiomarkerReading', () => {
  let t: ReturnType<typeof tx>;

  beforeEach(() => {
    vi.clearAllMocks();
    t = tx();
  });

  it('matches the series case-insensitively on (name, unit)', async () => {
    t.biomarker.findFirst.mockResolvedValue(null);
    t.biomarker.create.mockResolvedValue(makeExistingRow({ id: 'new' }));

    await upsertBiomarkerReading(t, 'user-A', makeReading({ name: 'Glucose', unit: 'mg/dL' }));

    expect(t.biomarker.findFirst).toHaveBeenCalledTimes(1);
    const arg = t.biomarker.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      userId: 'user-A',
      name: { equals: 'Glucose', mode: 'insensitive' },
      unit: { equals: 'mg/dL', mode: 'insensitive' },
    });
    // Most-recent anchor wins if legacy duplicate rows exist.
    expect(arg.orderBy).toEqual({ measurementDate: 'desc' });
  });

  it('CREATES a new series row when none exists', async () => {
    t.biomarker.findFirst.mockResolvedValue(null);
    t.biomarker.create.mockResolvedValue(makeExistingRow({ id: 'created-1' }));

    const result = await upsertBiomarkerReading(t, 'user-A', makeReading({ valueEncrypted: 'enc:99' }));

    expect(result.outcome).toBe('created');
    expect(t.biomarker.create).toHaveBeenCalledTimes(1);
    const data = t.biomarker.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'user-A', name: 'Glucose', unit: 'mg/dL', valueEncrypted: 'enc:99' });
    // No archiving when there was no prior point.
    expect(t.biomarkerHistory.create).not.toHaveBeenCalled();
    expect(t.biomarker.update).not.toHaveBeenCalled();
  });

  it('PROMOTES a newer reading: archives the current point, then updates current', async () => {
    const existing = makeExistingRow({ measurementDate: new Date('2026-01-15'), valueEncrypted: 'enc:88' });
    t.biomarker.findFirst.mockResolvedValue(existing);
    t.biomarker.update.mockResolvedValue({ ...existing, valueEncrypted: 'enc:99', measurementDate: new Date('2026-02-01'), history: [] });

    const result = await upsertBiomarkerReading(
      t,
      'user-A',
      makeReading({ measurementDate: new Date('2026-02-01'), valueEncrypted: 'enc:99' })
    );

    expect(result.outcome).toBe('promoted');
    // The prior current value+date is pushed into history.
    expect(t.biomarkerHistory.create).toHaveBeenCalledTimes(1);
    expect(t.biomarkerHistory.create.mock.calls[0][0].data).toMatchObject({
      biomarkerId: 'series-1',
      valueEncrypted: 'enc:88',
      measurementDate: existing.measurementDate,
    });
    // The series row advances to the new value+date.
    expect(t.biomarker.update).toHaveBeenCalledTimes(1);
    expect(t.biomarker.update.mock.calls[0][0].data).toMatchObject({
      valueEncrypted: 'enc:99',
      measurementDate: new Date('2026-02-01'),
    });
    expect(t.biomarker.create).not.toHaveBeenCalled();
  });

  it('ARCHIVES a back-dated reading as a history point, leaving current unchanged', async () => {
    const existing = makeExistingRow({ measurementDate: new Date('2026-02-01'), valueEncrypted: 'enc:88' });
    t.biomarker.findFirst.mockResolvedValue(existing);
    t.biomarker.findUnique.mockResolvedValue({ ...existing, history: [{ measurementDate: new Date('2026-01-01'), valueEncrypted: 'enc:70' }] });

    const result = await upsertBiomarkerReading(
      t,
      'user-A',
      makeReading({ measurementDate: new Date('2026-01-01'), valueEncrypted: 'enc:70' })
    );

    expect(result.outcome).toBe('archived');
    // The older reading goes straight to history (its own value+date).
    expect(t.biomarkerHistory.create).toHaveBeenCalledTimes(1);
    expect(t.biomarkerHistory.create.mock.calls[0][0].data).toMatchObject({
      biomarkerId: 'series-1',
      valueEncrypted: 'enc:70',
      measurementDate: new Date('2026-01-01'),
    });
    // Current is NOT advanced (no biomarker.update); a refresh fetch is used.
    expect(t.biomarker.update).not.toHaveBeenCalled();
    expect(t.biomarker.findUnique).toHaveBeenCalledTimes(1);
  });

  it('CORRECTS in place when the reading shares the current date (no extra history point)', async () => {
    const existing = makeExistingRow({ measurementDate: new Date('2026-02-01'), valueEncrypted: 'enc:88' });
    t.biomarker.findFirst.mockResolvedValue(existing);
    t.biomarker.update.mockResolvedValue({ ...existing, valueEncrypted: 'enc:91', history: [] });

    const result = await upsertBiomarkerReading(
      t,
      'user-A',
      makeReading({ measurementDate: new Date('2026-02-01'), valueEncrypted: 'enc:91' })
    );

    expect(result.outcome).toBe('corrected');
    expect(t.biomarker.update).toHaveBeenCalledTimes(1);
    expect(t.biomarker.update.mock.calls[0][0].data).toMatchObject({ valueEncrypted: 'enc:91' });
    // No duplicate-date history entry created for a same-day correction.
    expect(t.biomarkerHistory.create).not.toHaveBeenCalled();
  });
});
