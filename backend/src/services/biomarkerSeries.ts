/**
 * Biomarker series merge logic.
 *
 * A biomarker is a *time series* of one metric (e.g. Glucose in mg/dL) for one
 * user. The data model represents the series as a single `Biomarker` row whose
 * own value/date is the LATEST measurement, plus a `BiomarkerHistory[]` of the
 * older points. (`name`/`unit`/`category` are plaintext columns; only the value
 * and notes are encrypted.)
 *
 * Historically the create / bulk-create / FHIR-sync paths each inserted a brand
 * new `Biomarker` row for every reading, so logging Glucose twice produced two
 * disconnected single-point rows and the trend/sparkline UI never had more than
 * one point to draw — the product's core "track it over time" promise silently
 * did nothing. `upsertBiomarkerReading` fixes that at the source: every write
 * path routes new readings through here so they append to the matching series.
 *
 * Invariant preserved: the `Biomarker` row always holds the newest point;
 * `BiomarkerHistory` holds strictly older points.
 */

import type {
  Prisma,
  Biomarker as PrismaBiomarker,
  DataSourceType,
} from '../../generated/prisma/index.js';

/** What happened when a reading was merged into (or created as) a series. */
export type SeriesMergeOutcome = 'created' | 'promoted' | 'archived' | 'corrected';

/**
 * A single biomarker reading, already encrypted and range-classified by the
 * caller. The caller owns encryption (per-user salt) and out-of-range
 * computation; this module only owns the series-merge decision.
 */
export interface BiomarkerReadingInput {
  category: string;
  name: string;
  unit: string;
  valueEncrypted: string;
  notesEncrypted?: string | null;
  normalRangeMin: number;
  normalRangeMax: number;
  normalRangeSource?: string | null;
  measurementDate: Date;
  sourceType: DataSourceType;
  sourceFile?: string | null;
  extractionConfidence?: number | null;
  labName?: string | null;
  isOutOfRange: boolean;
}

/** A Biomarker row with its history rows eagerly loaded (oldest-first). */
export type BiomarkerWithHistory = PrismaBiomarker & {
  history: { measurementDate: Date; valueEncrypted: string }[];
};

export interface UpsertResult {
  biomarker: BiomarkerWithHistory;
  outcome: SeriesMergeOutcome;
}

// Always return history oldest-first so the trend math (which treats
// history[0] as the oldest point) is correct regardless of insert order.
const HISTORY_INCLUDE = {
  history: { orderBy: { measurementDate: 'asc' as const } },
};

/**
 * Append `reading` to the user's existing series for (name, unit), or create
 * the series if none exists. MUST run inside an RLS transaction (`tx`); when
 * called repeatedly in one transaction, a later reading sees the rows written
 * by an earlier one, so a batch containing several points of the same metric
 * collapses into a single series correctly regardless of order.
 *
 * Merge rules (by measurement date relative to the series' current point):
 *  - no existing series  -> create the anchor row                  ('created')
 *  - newer than current  -> archive current to history, promote it ('promoted')
 *  - older than current  -> insert as a history point, keep current('archived')
 *  - same date as current-> correct the current point in place     ('corrected')
 */
export async function upsertBiomarkerReading(
  tx: Prisma.TransactionClient,
  userId: string,
  reading: BiomarkerReadingInput
): Promise<UpsertResult> {
  // name/unit are plaintext, so match the series case-insensitively at the DB
  // layer. If legacy duplicate rows exist (pre-consolidation), merge into the
  // most recent one so new readings still land on a single growing series.
  const existing = await tx.biomarker.findFirst({
    where: {
      userId,
      name: { equals: reading.name, mode: 'insensitive' },
      unit: { equals: reading.unit, mode: 'insensitive' },
    },
    orderBy: { measurementDate: 'desc' },
  });

  if (!existing) {
    const created = await tx.biomarker.create({
      data: {
        userId,
        category: reading.category,
        name: reading.name,
        unit: reading.unit,
        valueEncrypted: reading.valueEncrypted,
        notesEncrypted: reading.notesEncrypted ?? null,
        normalRangeMin: reading.normalRangeMin,
        normalRangeMax: reading.normalRangeMax,
        normalRangeSource: reading.normalRangeSource ?? null,
        measurementDate: reading.measurementDate,
        sourceType: reading.sourceType,
        sourceFile: reading.sourceFile ?? null,
        extractionConfidence: reading.extractionConfidence ?? null,
        labName: reading.labName ?? null,
        isOutOfRange: reading.isOutOfRange,
        isAcknowledged: false,
      },
      include: HISTORY_INCLUDE,
    });
    return { biomarker: created as BiomarkerWithHistory, outcome: 'created' };
  }

  const newTime = reading.measurementDate.getTime();
  const curTime = existing.measurementDate.getTime();

  if (newTime > curTime) {
    // Newer reading becomes the current point; the prior current is archived.
    await tx.biomarkerHistory.create({
      data: {
        biomarkerId: existing.id,
        valueEncrypted: existing.valueEncrypted,
        measurementDate: existing.measurementDate,
      },
    });
    const updated = await tx.biomarker.update({
      where: { id: existing.id },
      data: {
        valueEncrypted: reading.valueEncrypted,
        // The new measurement is now "current", so its notes (or absence of
        // notes) define the current notes. History never stored per-point
        // notes, so the prior note is not lost beyond what the model ever kept.
        notesEncrypted: reading.notesEncrypted ?? null,
        measurementDate: reading.measurementDate,
        normalRangeMin: reading.normalRangeMin,
        normalRangeMax: reading.normalRangeMax,
        normalRangeSource: reading.normalRangeSource ?? existing.normalRangeSource,
        sourceType: reading.sourceType,
        sourceFile: reading.sourceFile ?? existing.sourceFile,
        extractionConfidence: reading.extractionConfidence ?? existing.extractionConfidence,
        labName: reading.labName ?? existing.labName,
        isOutOfRange: reading.isOutOfRange,
      },
      include: HISTORY_INCLUDE,
    });
    return { biomarker: updated as BiomarkerWithHistory, outcome: 'promoted' };
  }

  if (newTime < curTime) {
    // Back-dated reading: store as a history point; the current stays newest.
    await tx.biomarkerHistory.create({
      data: {
        biomarkerId: existing.id,
        valueEncrypted: reading.valueEncrypted,
        measurementDate: reading.measurementDate,
      },
    });
    const refreshed = await tx.biomarker.findUnique({
      where: { id: existing.id },
      include: HISTORY_INCLUDE,
    });
    // refreshed is non-null: we just confirmed the row exists in this tx.
    return { biomarker: refreshed as BiomarkerWithHistory, outcome: 'archived' };
  }

  // Same measurement date: correct the current point in place (do not create a
  // duplicate-date history entry).
  const corrected = await tx.biomarker.update({
    where: { id: existing.id },
    data: {
      valueEncrypted: reading.valueEncrypted,
      notesEncrypted: reading.notesEncrypted ?? existing.notesEncrypted,
      normalRangeMin: reading.normalRangeMin,
      normalRangeMax: reading.normalRangeMax,
      normalRangeSource: reading.normalRangeSource ?? existing.normalRangeSource,
      isOutOfRange: reading.isOutOfRange,
    },
    include: HISTORY_INCLUDE,
  });
  return { biomarker: corrected as BiomarkerWithHistory, outcome: 'corrected' };
}
