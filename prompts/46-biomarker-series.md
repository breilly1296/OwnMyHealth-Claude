---
tags:
  - documentation
  - data-integrity
  - biomarkers
type: prompt
updated: 2026-06-16
---

# Generate BIOMARKER_SERIES.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — `Biomarker.valueEncrypted` / `BiomarkerHistory.valueEncrypted` are PHI; the series logic moves ciphertext but never decrypts.

This doc must pass the five tests in `_doc-quality.md` (question-answering, path-and-line, snippet, diagram, reproducibility) before you stop.

---

## Purpose

Produce `New Project Documents/BIOMARKER_SERIES.md` — the **deep reference for the biomarker time-series subsystem**: the data-model shape that represents a metric as a series, the single merge primitive every write path funnels through, the create/bulk API contract (including the `history[]` payload), FHIR sync idempotency + dedupe, the one-time legacy consolidation, and the reference-range definition table.

This is the "core trend" feature. Until the series fix, every reading (manual create, bulk upload, FHIR sync) inserted a *new* disconnected single-point `Biomarker` row, so the trend/sparkline UI could never draw more than one point — the product's "track it over time" promise silently did nothing (`biomarkerSeries.ts:11-16`). A reader with only this doc must be able to answer *"how does one metric accumulate history, and which write paths preserve the series invariant?"* without reading the service files.

> **Scope.** This is the deep owner of the series-merge semantics. [`DATA_MODEL.md`](./DATA_MODEL.md) owns the raw `Biomarker` / `BiomarkerHistory` schema; [`API_REFERENCE.md`](./API_REFERENCE.md) owns the per-endpoint contracts; [`FHIR_LAB_INTEGRATION` prompt `./41-fhir-lab-integration.md`] owns OAuth/SSRF/token security. Do NOT re-derive those here — cross-link and go one layer deeper on the merge decision.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/services/biomarkerSeries.ts` | **Source of truth for the merge primitive.** `upsertBiomarkerReading` (`biomarkerSeries.ts:81`), the four `SeriesMergeOutcome` values (`biomarkerSeries.ts:28`), `BiomarkerReadingInput` (`:35`), `BiomarkerWithHistory` (`:53`), `HISTORY_INCLUDE` oldest-first ordering (`:64-66`). The header comment (`:1-19`) states the invariant. |
| `backend/src/controllers/biomarkerController.ts` | Create (`createBiomarker:260`) and bulk (`bulkCreateBiomarkers:493`) funnel through `upsertBiomarkerReading`; `toResponse` (`:91`) decrypts and emits `history[]` (`:105-112`); `getHistory` (`:804`), `getSummary` (`:714`). |
| `backend/src/services/fhir/labSyncService.ts` | FHIR sync path also funnels through `upsertBiomarkerReading` (`labSyncService.ts:340-354`); idempotency on `sourceFile = fhir:{provider}:{obs.id}` (`:316-321`); secondary `dedupeKey` (`:568-573`, used `:291`,`:326`); `mapObservation` (`:511`). |
| `backend/src/services/biomarkerConsolidation.ts` | One-time legacy dedupe: `seriesKey` (`:62`), `planUserConsolidation` (pure, `:71`), `applyUserConsolidation` (`:137`), the load-bearing re-parent-before-delete order (`:130-136`). |
| `backend/src/maintenance/consolidateBiomarkerSeries.ts` | The runner that wraps consolidation: DRY-RUN default / `--apply` (`:38`), `--user` scoping (`:44`), per-user RLS execution (`:102-107`), Cloud Run job invocation. |
| `backend/src/services/data/biomarkerDefinitions.ts` | `BIOMARKER_DEFINITIONS` reference/normal ranges (`:19`), `BiomarkerDefinition` shape (`:8`), `unitRanges` unit-specific ranges (`:16`). |
| `backend/src/services/pdfParser.ts` | The definitions *consumer*: `findBiomarkerDefinition` (`pdfParser.ts:851`), range derivation incl. `unitRanges` override (`:948-950`), unknown-biomarker fallback (`:1046`). |
| `backend/src/controllers/upload/shared.ts` | The upload/OCR persist path (`createBiomarkersFromExtraction`-style `tx.biomarker.create` at `shared.ts:244`). **This path does NOT funnel through `upsertBiomarkerReading`** — document the gap, do not paper over it. |
| `backend/src/routes/biomarkerRoutes.ts` | Endpoint wiring for create (`:85`), batch (`:102`), history (`:77`). |
| `backend/prisma/schema.prisma` | `Biomarker` model (`:182-218`), `BiomarkerHistory` model (`:220-231`); note both `measurementDate` columns are `@db.Date` (day precision). |
| `backend/src/services/biomarkerSeries.test.ts`, `backend/src/services/biomarkerConsolidation.test.ts` | (If present) the merge/consolidation unit tests — confirm the documented outcomes match assertions. |
| `.github/workflows/maintenance.yml` | `consolidate-biomarkers` job → `dist/maintenance/consolidateBiomarkerSeries.js` (`maintenance.yml:27`,`:81`). |

---

## OwnMyHealth biomarker-series architecture (verify against code, then write)

- **Series shape.** A biomarker is a *time series* of one metric (e.g. Glucose in mg/dL) for one user, stored as a single `Biomarker` anchor row whose own `valueEncrypted` / `measurementDate` is the **newest** point, plus a `BiomarkerHistory[]` of strictly older points (`biomarkerSeries.ts:1-19`, `:17-18`). `name` / `unit` / `category` are plaintext columns (`schema.prisma:185-187`); only `valueEncrypted` and `notesEncrypted` are PHI (`schema.prisma:188-189`).
- **One write primitive.** Every NEW reading routes through `upsertBiomarkerReading(tx, userId, reading)` (`biomarkerSeries.ts:81`), which MUST run inside an RLS transaction so repeated calls in one tx see each other's writes (`biomarkerSeries.ts:69-73`).
- **Caller owns encryption + range classification.** The module takes already-encrypted `valueEncrypted` and a precomputed `isOutOfRange`; it owns ONLY the series-merge decision and never decrypts (`biomarkerSeries.ts:30-50`).

---

## Required sections

1. **Overview** — what a series is, the invariant in one sentence, the "core trend was structurally broken" backstory (`biomarkerSeries.ts:11-16`), and the three write paths.
2. **The series-merge invariant** (see Required artifacts: diagram). Anchor row = newest point; `BiomarkerHistory` = strictly older points. State why `HISTORY_INCLUDE` orders oldest-first (`biomarkerSeries.ts:62-66`) — trend math treats `history[0]` as the oldest point.
3. **`upsertBiomarkerReading` decision table** — the four `SeriesMergeOutcome` branches, each with its date condition, DB writes, and returned outcome. Quote the branch snippets.
4. **Series identity / matching** — how an incoming reading finds its series: case-insensitive `(name, unit)` match, most-recent-first to absorb legacy duplicates (`biomarkerSeries.ts:86-96`). Contrast with consolidation's NUL-joined `seriesKey` (`biomarkerConsolidation.ts:62-64`).
5. **Write-path funnel matrix** — every place a reading is persisted, and whether it goes through `upsertBiomarkerReading`. **This is the load-bearing accuracy section** (see Required artifacts).
6. **Create / bulk API contract** — request shape, the `history[]` in the response, status-code semantics (201 vs 200 vs 207), and the bulk per-series collapse. Cross-link to `API_REFERENCE.md`.
7. **FHIR sync idempotency + dedupe** — primary key `sourceFile = fhir:{provider}:{obs.id}` vs secondary `dedupeKey = name|YYYY-MM-DD|value`; the amendment exception; why `sourceFile` is deliberately plaintext.
8. **Legacy consolidation** — the pure planner / transactional applier split, the re-parent-before-delete ordering, idempotency, and the maintenance job (DRY-RUN → `--apply`).
9. **Reference-range definitions** — `BIOMARKER_DEFINITIONS` structure, alias matching, `unitRanges`, and where ranges feed extraction.
10. **PHI / safety notes** — ciphertext is moved as-is across history and consolidation; nothing decrypts in the merge or consolidation layer; per-user RLS scoping.
11. **Known gaps / drift** — the upload path bypass (§5), the `@db.Date` day-precision implication on the same-date "corrected" branch, the bulk per-series `data[]`-vs-`succeeded` count mismatch.
12. **Related Documents**.
13. **Prompt drift log**.

---

## Required artifacts

### Series-merge invariant diagram (ASCII)

Render the anchor/history relationship and the four merge branches. Example shape (verify against code, do not copy blindly):

```
                     upsertBiomarkerReading(tx, userId, reading)
                                     │
                 findFirst (name,unit) case-insensitive, newest-first   (biomarkerSeries.ts:89-96)
                                     │
        ┌───────────────┬───────────┴───────────┬────────────────────┐
     no match       new > current            new < current        new == current
        │               │                        │                    │
   create anchor   archive current→history   insert history pt    correct anchor
   'created'         + promote new            keep current         in place
   (:98-120)         'promoted' (:126-156)    'archived' (:158-173) 'corrected' (:177-189)

  Anchor Biomarker row  ── always the NEWEST point ──┐
                                                      │ history[] (oldest-first, :64-66)
  BiomarkerHistory[]    ── strictly OLDER points ─────┘
```

### `upsertBiomarkerReading` decision table

| Condition (vs series' current point) | DB writes | Outcome | Source |
|---|---|---|---|
| No existing series | `biomarker.create` (anchor) | `created` | `biomarkerSeries.ts:98-120` |
| `newTime > curTime` | archive current → `biomarkerHistory.create`, then `biomarker.update` (promote new value/date/notes) | `promoted` | `biomarkerSeries.ts:126-156` |
| `newTime < curTime` | `biomarkerHistory.create` (back-dated point); anchor unchanged | `archived` | `biomarkerSeries.ts:158-173` |
| `newTime === curTime` | `biomarker.update` in place (no duplicate-date history row) | `corrected` | `biomarkerSeries.ts:175-189` |

Include the `promoted` branch snippet verbatim (archive-then-promote), since it is the one that both writes history AND updates the anchor:

```ts
// Source: backend/src/services/biomarkerSeries.ts:L126-L156 (excerpt)
if (newTime > curTime) {
  await tx.biomarkerHistory.create({
    data: { biomarkerId: existing.id, valueEncrypted: existing.valueEncrypted, measurementDate: existing.measurementDate },
  });
  const updated = await tx.biomarker.update({
    where: { id: existing.id },
    data: { valueEncrypted: reading.valueEncrypted, measurementDate: reading.measurementDate, /* ...range/source/lab... */ },
    include: HISTORY_INCLUDE,
  });
  return { biomarker: updated as BiomarkerWithHistory, outcome: 'promoted' };
}
```

### Write-path funnel matrix (load-bearing)

Confirm each row by reading the cited file. Do NOT assert a path funnels through `upsertBiomarkerReading` unless the code shows the call.

| Write path | Entry (`file:line`) | Persist call | Funnels through `upsertBiomarkerReading`? |
|---|---|---|---|
| Manual create | `biomarkerController.createBiomarker:260` | `upsertBiomarkerReading` (`:283-300`) | **Yes** |
| Bulk / batch create | `biomarkerController.bulkCreateBiomarkers:493` | loop of `upsertBiomarkerReading` in one tx (`:588-609`) | **Yes** |
| FHIR lab sync | `labSyncService.syncLabResults:193` | `upsertBiomarkerReading` (`:340-354`) | **Yes** |
| Manual update | `biomarkerController.updateBiomarker:323` | direct `tx.biomarker.update` + manual history insert (`:387-391`) | No (in-place edit of an existing anchor, not a new reading) |
| Lab-upload / OCR ingestion | `controllers/upload/shared.ts:244` (`tx.biomarker.create`) | direct `tx.biomarker.create` | **No — GAP**: the PDF/OCR ingestion path still inserts a raw row, so an uploaded reading does NOT merge into an existing series. Flag in Known gaps + Prompt drift log. |

### Create-response `history[]` snippet

```ts
// Source: backend/src/controllers/biomarkerController.ts:L105-L112
const history = biomarker.history
  ? await Promise.all(
      biomarker.history.map(async (h) => ({
        date: h.measurementDate.toISOString().split('T')[0],
        value: parseFloat(tryDecrypt(encryptionService, h.valueEncrypted, userSalt, 'history.valueEncrypted') ?? ''),
      }))
    )
  : [];
```

State the status-code contract: create returns `201` only when a new series was minted, else `200` (`biomarkerController.ts:317-319`); bulk returns `201` (all ok) or `207` (partial) and `data[]` may have fewer rows than `succeeded` because readings of the same metric merge into one series (`biomarkerController.ts:654-669`).

### FHIR idempotency + dedupe snippet

```ts
// Source: backend/src/services/fhir/labSyncService.ts:L316-L321
const obsIdentity = `fhir:${provider}:${obs.id}`;
const isAmendment = obs.status === 'amended' || obs.status === 'corrected';
if (existingSourceFiles.has(obsIdentity) && !isAmendment) {
  skipped++;
  continue;
}
```

Then the secondary value-based guard:

```ts
// Source: backend/src/services/fhir/labSyncService.ts:L568-L573
function dedupeKey(name: string, date: Date, value: string): string {
  const day = new Date(date).toISOString().split('T')[0];
  return `${name.toLowerCase()}|${day}|${value}`;
}
```

Explain: primary idempotency is the **stable** external `obs.id` (stored in plaintext `sourceFile`, `schema.prisma:195`), so a re-sync is a true no-op and can't clobber a user's later edit via the same-date `corrected` branch (`labSyncService.ts:280-285`). `sourceFile` is deliberately NOT encrypted — encrypting it would break this dedupe key (cross-link [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — `Biomarker.sourceFile` is an intentional plaintext exception). Amended/corrected observations reuse the id with a new value and are allowed through; the value-based `dedupeKey` then no-ops an amendment whose value didn't change (`labSyncService.ts:323-330`).

### Consolidation ordering snippet

```ts
// Source: backend/src/services/biomarkerConsolidation.ts:L130-L136 (doc comment)
// Order is load-bearing:
//   1. re-parent each duplicate's existing history rows onto the anchor
//      (BEFORE deleting the duplicate, whose FK cascade would otherwise drop them),
//   2. add each duplicate's own current point to the anchor's history,
//   3. delete the (now history-free) duplicate rows.
```

State: `planUserConsolidation` is pure (groups by NUL-joined `seriesKey`, picks the latest-dated row as anchor, deterministic tie-breaks on `createdAt` then `id`) — `biomarkerConsolidation.ts:71-122`; `applyUserConsolidation` executes inside the RLS tx — `:137-168`; idempotent (a second run finds no group > 1) — `:17-21`.

### Reference-range definitions table (sample rows)

| `displayName` | `category` | `defaultUnit` | `normalRange` | `unitRanges` | Source |
|---|---|---|---|---|---|
| Total Cholesterol | Lipids | mg/dL | `{0, 200}` | `mmol/L: {0, 5.2}` | `biomarkerDefinitions.ts:21` |
| Glucose | Metabolic | mg/dL | `{70, 100}` | `mmol/L: {3.9, 5.6}` | `biomarkerDefinitions.ts:29` |
| HbA1c | Metabolic | % | `{4.0, 5.7}` | — | `biomarkerDefinitions.ts:30` |

Note the consumer chain: `BIOMARKER_DEFINITIONS` → `findBiomarkerDefinition` (`pdfParser.ts:851`) → range derivation, with a `unitRanges[unit]` override (`pdfParser.ts:948-950`) and a `{min:0,max:1000}` fallback for unknown biomarkers (`pdfParser.ts:1046`). A lab-supplied reference range, when present, wins over the standard one (`pdfParser.ts:970`).

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc + siblings**:

1. What is the series invariant — which row holds the newest point and what does `BiomarkerHistory` hold? (`biomarkerSeries.ts:17-18`)
2. What are the four `SeriesMergeOutcome` values and the date condition that triggers each?
3. Which function is the single merge primitive, and why must it run inside an RLS transaction?
4. How does an incoming reading find its existing series (matching rule + ordering)?
5. Which three write paths funnel through `upsertBiomarkerReading`, and which persist path does NOT (the gap)?
6. When does `POST /api/v1/biomarkers` return 201 vs 200?
7. Why can a bulk create's `data[]` length be smaller than its `succeeded` count?
8. What is the PRIMARY FHIR idempotency key, and why is `sourceFile` stored in plaintext?
9. What is the SECONDARY (value-based) dedupe key, and what date granularity does it use?
10. How does an amended/corrected FHIR observation get through the idempotency skip?
11. Why is the re-parent-before-delete order in `applyUserConsolidation` load-bearing?
12. Is the consolidation safe to run twice? What makes it idempotent?
13. How is the consolidation maintenance job invoked in production, and what is its default (DRY RUN vs apply)?
14. Where do normal/reference ranges come from for a manually-typed biomarker vs an OCR-extracted one?
15. What does `unitRanges` do, and give one biomarker that has it.
16. Does the series/consolidation layer ever decrypt PHI? Where is encryption owned instead?
17. Why does `HISTORY_INCLUDE` order history oldest-first?
18. What day-precision subtlety does `@db.Date` on `measurementDate` introduce for the `corrected` branch?

---

## No-TBD enforcement

Before marking anything TBD:

- **Merge branches**: read `biomarkerSeries.ts:81-190` literally — every branch and its writes are there.
- **Write-path funnel**: `Grep pattern: "upsertBiomarkerReading\\("` over `backend/src/**` for the funnel sites; then `Grep pattern: "tx\\.biomarker\\.create\\("` to find the raw-insert paths that bypass it (expect the hit in `controllers/upload/shared.ts`).
- **Dedupe / idempotency**: read `labSyncService.ts:266-358` and the `dedupeKey` at `:568-573`.
- **Consolidation**: read `biomarkerConsolidation.ts` end-to-end (it is < 170 lines).
- **Maintenance job**: read `maintenance/consolidateBiomarkerSeries.ts` and `.github/workflows/maintenance.yml` (the `consolidate-biomarkers` case).
- **Reference ranges**: read `data/biomarkerDefinitions.ts` and the consumer in `pdfParser.ts:851-970,1046`.
- **Schema lines**: read `schema.prisma:182-231`.

If a claim cannot be derived from these files, mark:

```
TBD (external: <what>, <where to resolve>)
```

---

## Cross-links

The generated `BIOMARKER_SERIES.md` must link to:

- [`DATA_MODEL.md`](./DATA_MODEL.md) — raw `Biomarker` / `BiomarkerHistory` schema, indexes, cascades, RLS.
- [`API_REFERENCE.md`](./API_REFERENCE.md) — create/batch/history endpoint contracts.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — `valueEncrypted` PHI, and the deliberate `sourceFile` plaintext exception.
- [`FHIR lab integration prompt`](./41-fhir-lab-integration.md) — OAuth/SSRF/token security for the sync path (BIOMARKER_SERIES owns only the merge after sync).

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Read merge primitive | Read | `backend/src/services/biomarkerSeries.ts` |
| Find all funnel call sites | Grep | `pattern: "upsertBiomarkerReading\\("` over `backend/src/**` |
| Find raw-insert bypass paths | Grep | `pattern: "tx\\.biomarker\\.create\\("` over `backend/src/**` |
| Read consolidation | Read | `backend/src/services/biomarkerConsolidation.ts` + `backend/src/maintenance/consolidateBiomarkerSeries.ts` |
| Find dedupe key | Grep | `pattern: "dedupeKey\\(|sourceFile"` over `backend/src/services/fhir/labSyncService.ts` |
| Read reference ranges | Read | `backend/src/services/data/biomarkerDefinitions.ts` |
| Find range consumer | Grep | `pattern: "BIOMARKER_DEFINITIONS\|findBiomarkerDefinition\|unitRanges"` over `backend/src/services/pdfParser.ts` |
| Read schema | Read | `backend/prisma/schema.prisma` (`:182-231`) |
| Confirm maintenance job | Grep | `pattern: "consolidate-biomarkers"` over `.github/workflows/maintenance.yml` |

---

## Output: file and location

Write the final document to `New Project Documents/BIOMARKER_SERIES.md`.
