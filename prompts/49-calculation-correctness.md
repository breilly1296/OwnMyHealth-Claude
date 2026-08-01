---
tags:
  - correctness
  - clinical
  - financial
  - high
type: prompt
priority: 2
updated: 2026-08-01
---

# Calculation Correctness Review (reference ranges, cost math, dates)

> Follow the [review protocol](./_review-protocol.md) — including reading
> `New Project Documents/OPEN_FINDINGS.md` before you report anything.
> Use [Claude Code tools](./_verification-tools.md) for all greps.
> Cross-check [`_phi-inventory.md`](./_phi-inventory.md) before proposing any change to a decrypt path.

## Why this prompt exists

Every other security prompt asks *"can someone else see this data, or make the system do something
it shouldn't?"* None asks **"is the number right?"** — and for a health app that is the more likely
way a user gets harmed. A biomarker shown as in-range when it is out of range, or a projected
out-of-pocket that is $4,000 too low, does real damage without any attacker involved.

This is not hypothetical. Three waves of exactly these bugs shipped and were fixed after the
2026-06-16 prompt refresh, none of which any existing prompt would have caught:

| Bug class | What happened | Commits |
|---|---|---|
| **Date-only off-by-one** | `new Date('2026-01-01')` parses as UTC midnight; `toLocaleDateString()` then renders the **previous day** in any negative-UTC locale. Affected biomarker `measurementDate`, insurance `effectiveDate`, expense `serviceDate` | `b376949`, `ea57001`, `45a0cbc` |
| **Ordering / windowing** | Trend statistics computed on wrongly-ordered series; goal-progress ordering; history windowing off-by-one | `4795e1d` |
| **Silent omission in cost math** | Out-of-network projections were **dropped** from projected OOP, so they contributed $0 instead of their real cost | `expenseController.costMath.test.ts` |

The last one is the shape to internalize: not a crash, not an exception — a category of input that
silently contributed nothing, producing a plausible-looking number that was simply wrong.

**Severity guidance.** Grade by *what decision the wrong number drives*. A biomarker misclassified
as in-range, or an OOP projection materially understated, is **High** — a core flow producing wrong
output under normal operation. A cosmetic rounding difference in a non-decision display is **Low**.

## Files to Review

### Clinical / biomarker
| File | Why |
|---|---|
| `src/utils/biomarkers/trendCalculations.ts` | The core: `classifyBiomarkerTrend` (`:56`), `isInRange` (`:179`), `calculateTrend` (`:188`), `classifyRangeStatusChange` (`:204`), `computeBiomarkerStats` (`:228`) |
| `src/components/biomarkers/BiomarkerRangeBar.tsx` | Visual in/out-of-range rendering — must agree with `isInRange` |
| `backend/src/services/data/biomarkerDefinitions.ts` | Canonical ranges + units |
| `backend/src/services/biomarkerSeries.ts` | Series merge (`upsertBiomarkerReading`) — ordering guarantees everything downstream assumes |
| `backend/src/services/biomarkerConsolidation.ts` | Dedupe — a wrong dedupe silently deletes data points |
| `src/utils/goals/progressTrend.ts` | `toChronologicalProgress` (`:25`), `progressTrend` (`:37`) |
| `src/utils/biomarkers/dateNormalizer.ts` | Where parsed lab dates become canonical |
| `src/components/analytics/`, `src/components/trends/` | Chart/stat consumers |

### Financial
| File | Why |
|---|---|
| `backend/src/controllers/expenseController.ts` | `extractProjectedOOP` (`:1046`), `decryptNumberOrZero`, `extractDeductibleMonth` |
| `backend/src/controllers/expenseController.costMath.test.ts` | The pinned contract — read this first; it documents intent |
| `backend/src/controllers/insuranceController.ts` | Deductible/OOP progress arithmetic |
| `src/components/insurance/DeductibleProgressBar.tsx`, `CostOptimization.tsx`, `planFormatters.ts` | Client-side financial display |
| `src/utils/insurance/insuranceUtils.ts` | Client-side financial helpers |

### Dates
| File | Why |
|---|---|
| `src/utils/format.ts` | `formatDateOnly` (`:47`) — the fix, with its rationale at `:36-46`; and `formatDate` for true timestamps |
| `backend/prisma/schema.prisma` | Every `@db.Date` column (date-only) vs `DateTime` (timestamp) — the distinction that drives which formatter is correct |

## Checklist

### 1. Reference-range classification
- [ ] `isInRange` (`trendCalculations.ts:179`) parses `normalRange` robustly. Enumerate the formats
      it must handle — `"70-100"`, `"<100"`, `">40"`, `"70 - 100"`, `"Negative"`, `""`, `null` — and
      confirm each has defined behavior. **An unparseable range must not silently classify as
      in-range**; that is the failure mode that reassures a user who should be alarmed
- [ ] Boundary semantics are explicit and consistent: is a value exactly equal to the bound in or
      out? Verify the bar, the badge, and any AI-guidance trigger all agree
- [ ] Unit mismatch cannot produce a false classification — a value in mg/dL compared against a
      mmol/L range. Confirm units are compared, not assumed
- [ ] `BiomarkerRangeBar` derives its status from the **same** function as the textual badge; two
      independent implementations will diverge
- [ ] Sex-/age-specific ranges: does `biomarkerDefinitions.ts` carry them, and if not, is a
      single-range approximation flagged to the user? (Currently 113 lines — verify what it actually
      encodes rather than assuming)
- [ ] Direction awareness: for markers where *higher is worse* vs *lower is worse*,
      `classifyRangeStatusChange` (`:204`) must not report "improved" for a move in the harmful
      direction

### 2. Trend statistics and ordering
- [ ] Every consumer agrees on series order. `biomarkerController` deliberately fetches history
      **oldest-first** so trend math is order-independent — verify that contract holds at every call
      site, and that nothing re-sorts descending in between
- [ ] `toChronologicalProgress` (`progressTrend.ts:25`) is applied before any progress delta
- [ ] Windowing (last N readings / last N days) is inclusive/exclusive consistently, and a window
      with **fewer than 2 points** yields "no trend", never a fabricated slope
- [ ] Percent-change math guards divide-by-zero and sign flips across zero
- [ ] `computeBiomarkerStats` (`:228`) handles a single reading, duplicate timestamps, and
      all-identical values without NaN
- [ ] Consolidation/dedupe (`biomarkerConsolidation`) cannot drop a *distinct* reading that merely
      shares a date — verify the dedupe key includes enough to distinguish

### 3. Cost math (`extractProjectedOOP`)
Read `expenseController.ts:1046-1085` and its test file together; the test encodes intent.
- [ ] **Every projection contributes.** The OON bug was a silent omission — verify no filter,
      `continue`, or conditional excludes a category. The current code deliberately includes both
      in- and out-of-network (`:1064-1067`)
- [ ] The OON approximation is **documented and surfaced**: OON is priced with *in-network* rates
      because the plan model has no OON-specific rates (`:1065-1067`). That understates real cost.
      Confirm the user sees this caveat — an unlabelled understatement is a trust defect
- [ ] Deductible burn-down is sequential and correct: `min(annualCost, remainingDeductible)` to the
      deductible, remainder at coinsurance (`:1069-1077`)
- [ ] `totalOOP` seeds from `oopMetIndividual` (`:1061`) so already-spent dollars count
- [ ] OOP cap applies only when recorded: `oopMax > 0 ? min(totalOOP, oopMax) : totalOOP`
      (`:1081-1082`) — a non-positive `oopMax` means "no cap recorded", **not** "cap to $0"
- [ ] Poisoned-row guards hold (M9): coinsurance clamped to 0–100 then divided by 100 (`:1056`);
      `Number(x) || 0` floors NaN. Confirm these cover legacy rows written before SBC sanitization
- [ ] `decryptNumberOrZero` coerces a corrupt/key-mismatched row to **0, not NaN** — and consider
      whether silently zeroing a decrypt failure is right, or whether it should surface. A zeroed
      $8,000 projection looks like a real answer
- [ ] The whole function is wrapped in `try { … } catch { return null }` (`:1083`). Verify `null` is
      rendered as "unavailable" and never as `$0`
- [ ] **Family vs individual**: only `*Individual` fields are used. Confirm family plans are either
      handled or explicitly out of scope — this is the most likely remaining gap
- [ ] `extractDeductibleMonth` regex-scrapes Claude's prose (`:1088+`). A regex over model output is
      fragile by construction: verify a miss yields `null` (not a wrong month), and consider whether
      a *displayed* month sourced this way needs a confidence caveat
- [ ] Currency arithmetic uses a consistent representation; check for float-accumulation drift where
      values are summed then compared against a `Decimal` column
- [ ] Client-side financial displays derive from server values rather than recomputing — two
      implementations of deductible math will diverge

### 4. Date and timezone handling
- [ ] **Every date-only value uses `formatDateOnly`** (`format.ts:47`), never `formatDate` or a bare
      `toLocaleDateString()`. Date-only fields include biomarker `measurementDate`, insurance
      `effectiveDate`/`terminationDate`, expense `serviceDate` — everything typed `@db.Date`
- [ ] **Every true timestamp uses `formatDate`** (local time). Applying UTC pinning to `createdAt`
      is the same bug mirrored
- [ ] Build the `@db.Date` column list from `schema.prisma`, then `Grep` every render site for each
      — this is the only way to be sure the wave was complete rather than mostly complete
- [ ] Date **arithmetic** (day counts, "N days ago", window boundaries) is done in UTC for date-only
      values; mixing a UTC-parsed date with a local `new Date()` reintroduces the off-by-one
      (`45a0cbc` fixed a wave of these)
- [ ] Date **input** round-trips: a date picked in a negative-UTC locale, saved, and re-rendered
      shows the same day
- [ ] `dateNormalizer.ts` produces canonical `YYYY-MM-DD` for parsed lab dates, and ambiguous
      formats (`03/04/2026`) have a defined interpretation
- [ ] Sort keys use the raw ISO value, not a formatted display string
- [ ] Backend date comparisons for windows/retention use UTC consistently

### 5. Test coverage of the math
- [ ] Each rule above has a test pinning it. `expenseController.costMath.test.ts` is the model:
      it pins deductible burn-down, coinsurance, the OOP cap, **and** the specific regression (OON
      contributing rather than counting as $0)
- [ ] Range classification has boundary tests (exactly-at-bound, unparseable, null)
- [ ] Date rendering has a test that runs under a negative-UTC timezone — a test in UTC cannot catch
      the bug the whole wave was about
- [ ] Trend math has single-point, two-identical-points, and empty-series cases

## Verification Commands
```bash
# Date-only columns (the authoritative list to check render sites against)
grep -n "@db.Date" backend/prisma/schema.prisma

# Bare locale date rendering that should be formatDateOnly
grep -rn "toLocaleDateString\|toLocaleString" src/ | grep -v "format.ts"

# Date arithmetic that may mix UTC-parsed dates with local now()
grep -rn "getTime()\|getDate()\|setDate(\|Date.now()" src/utils/ src/components/

# Range classification call sites — all must route through one function
grep -rn "isInRange\|normalRange\|classifyBiomarker" src/ backend/src/ --include=*.ts --include=*.tsx

# Cost math surface
grep -n "coinsurance\|deductible\|oopMax\|oopMet" backend/src/controllers/expenseController.ts

# Client-side financial recomputation (should not exist independently of the server)
grep -rn "deductible\|coinsurance\|oopMax" src/utils/insurance/ src/components/insurance/

# NaN / divide-by-zero guards in stats
grep -rn "isNaN\|Number.isNaN\|Infinity\|/ 0" src/utils/biomarkers/ src/utils/goals/
```

## Questions to Ask
1. If `normalRange` is unparseable, what does the user see — "unknown", or a green in-range badge?
2. Does the range bar and the range badge use the same classification function, or two?
3. Which biomarkers need sex- or age-specific ranges that `biomarkerDefinitions.ts` does not encode,
   and is that limitation shown to the user?
4. Is the OON in-network-rate approximation visible anywhere in the UI, or does the user see a
   confident number that is systematically low?
5. Are family-plan deductibles/OOP handled at all, or is `*Individual` silently used for everyone?
6. When `decryptNumberOrZero` swallows a decrypt failure as 0, does anything alert — or does a
   corrupted row quietly shrink a user's projected costs?
7. Is there a single test that runs under a negative-UTC timezone? If not, the date wave is unpinned
   and will regress.
8. Does any client component recompute a financial figure the server already computed?

## Required artifacts
- A table of every `@db.Date` column × every render site × which formatter it uses
- A worked example of `extractProjectedOOP` on a plan with a partially-met deductible, one in-network
  and one out-of-network projection, and an OOP max — hand-computed, then compared to the code path
- A list of every distinct `normalRange` format present in `biomarkerDefinitions.ts` and whether
  `isInRange` handles each

## Cross-links
- [46-biomarker-series](./46-biomarker-series.md) — series consolidation/ordering this prompt depends on
- [48-insurance-domain](./48-insurance-domain.md) — where the plan values being computed on come from
- [47-accessibility](./47-accessibility.md) — whether in/out-of-range status is perceivable without color
- [38-testing-patterns-doc](./38-testing-patterns-doc.md) — where these regression tests belong
- [20-known-issues-doc](./20-known-issues-doc.md) — for accepted approximations (OON pricing, family plans)
