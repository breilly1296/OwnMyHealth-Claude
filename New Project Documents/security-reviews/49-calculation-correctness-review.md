# Calculation Correctness Review (reference ranges, cost math, dates) — 2026-08-01

**Posture:** Sandbox — no GCP (no deployment target, founder-only data) — per [OPEN_FINDINGS.md §Posture](../OPEN_FINDINGS.md)
**Code state:** `master` @ `12b45ae`
**Ledger read at:** `12b45ae`, last updated 2026-08-01
**Prompt:** [`prompts/49-calculation-correctness.md`](../../prompts/49-calculation-correctness.md) — **first run of this prompt** (authored 2026-08-01; the index had flagged "biomarker reference-range + cost-math correctness" as uncovered since 2026-06-16, and the date class was added after three shipped bug waves)

---

## Summary

| Severity | New | Already in ledger |
|---|---|---|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 2 | 0 |
| Low | 2 | 0 |
| Info | 1 | 0 |
| Dormant (launch checklist) | 0 | 0 |

Two of the three areas came out well. **Cost math is in better shape than its history suggests** —
`extractProjectedOOP` carries explicit poisoned-row guards, correct sequential deductible burn-down,
and a genuinely subtle `oopMax > 0` check that distinguishes "no cap recorded" from "cap to $0"; it
also has the only dedicated arithmetic test file in the repo. **Reference-range classification** is
simpler and safer than the prompt assumed, because the range is a structured `{min, max}` object
rather than a string to parse.

**Dates are where the findings are.** The June wave (`ea57001`, `45a0cbc`, `b376949`) fixed display
comprehensively but left one date-*arithmetic* site behind, and — more importantly — **nothing pins
the fix**: there is no timezone-forcing test anywhere, so the entire class is unguarded and CI runs
in the one timezone where it cannot reproduce.

---

## New findings

### F-1 — Goal deadlines are off by one day in every negative-UTC locale — **Medium**

- **Location:** `src/components/analytics/GoalTrackerPanel.tsx:97-101`
- **Observation:** `daysRemaining` mixes a **UTC-parsed date-only value** with a **local `now`**:

  ```ts
  // Source: src/components/analytics/GoalTrackerPanel.tsx:97-101
  function daysRemaining(targetDate: string): number {
    const target = new Date(targetDate);   // 'YYYY-MM-DD' → parsed as UTC midnight
    const now = new Date();                // local instant
    return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }
  ```

  `HealthGoal.targetDate` is `@db.Date` (`schema.prisma:481`) — a calendar date, not an instant. This
  is precisely the mixture the wave commit `45a0cbc` ("pin UTC for remaining date-only display **and
  date-arithmetic** off-by-ones") was sweeping for, and this site survived it.

- **Worked failure** (America/Los_Angeles, UTC-7 in August), goal `targetDate = 2026-08-02`:

  | Local wall clock | `now` as instant | `target - now` | `Math.ceil` | Displayed | Should say |
  |---|---|---|---|---|---|
  | 2026-08-01 18:00 PDT | 2026-08-02T01:00Z | −1 h | −0 → 0 | **"Due today"** | "1 day remaining" |
  | 2026-08-02 18:00 PDT | 2026-08-03T01:00Z | −25 h | −1 | **"Overdue by 1 day"** | "Due today" |

  Every afternoon in a negative-UTC locale, the goal deadline reads one day earlier than it is. The
  error is silent, plausible, and consistent — the worst combination, because nothing looks broken.
- **Impact:** users are told a health goal is overdue on the day it is actually due. In a product
  whose engagement model is goal tracking with reminder emails, a systematically pessimistic deadline
  is a real product defect, not a cosmetic one. It affects only display and messaging — no stored
  value is wrong.
- **Fix:** compare calendar days in UTC on both sides, rather than instants:
  ```ts
  function daysRemaining(targetDate: string): number {
    const target = Date.parse(`${targetDate.slice(0, 10)}T00:00:00Z`);
    const n = new Date();
    const todayUTC = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    return Math.round((target - todayUTC) / 86_400_000);
  }
  ```
  Note this makes "today" the *viewer's UTC* day. If the product wants the viewer's *local* calendar
  day, derive today from `n.getFullYear()/getMonth()/getDate()` instead — but pick one deliberately
  and comment it, because the two differ for exactly the users this bug already affects.
- **Ledger check:** searched `OPEN_FINDINGS.md` for `date`, `UTC`, `timezone`, `off-by-one`,
  `goal` — no match.

### F-2 — No test pins any date behavior to a non-UTC timezone — **Medium**

- **Location:** `vitest.config.ts`, `src/__tests__/setup.ts`, `package.json` — absence of a `TZ` setting
- **Observation:** `Grep` for `TZ=`, `timezone`, `America/`, `process.env.TZ` across the test config,
  setup file, and npm scripts returns **zero hits**. There is also no test file for
  `src/utils/format.ts` — `src/__tests__/utils/` contains `dateNormalizer`, `exportBiomarkers`,
  `extractionReview`, `frameGuard`, `pdfReportGenerator`, `pdfWorker`, and `trendCalculations`, but
  nothing covering `formatDateOnly`, the helper the whole wave was built around.
- **Impact:** this is why F-1 exists and why it will recur. CI runners default to **UTC**, which is
  the one timezone where the entire date-only bug class is invisible — at UTC+0 a UTC-parsed date and
  a local `now` agree, so every assertion passes and the suite reports green. Three commits of fixes
  (`b376949`, `ea57001`, `45a0cbc`) are currently protected by nothing.
- **Fix:** force a negative-UTC timezone for the frontend suite. One line in `vitest.config.ts`:
  ```ts
  test: { env: { TZ: 'America/Los_Angeles' }, /* ... */ }
  ```
  or `"test": "TZ=America/Los_Angeles vitest"` in `package.json`. Then add a `format.test.ts` asserting
  `formatDateOnly('2026-01-01')` renders **Jan 1** (not Dec 31) and that `formatDate` on a true
  timestamp still renders local. Running the suite under two timezones (UTC and one negative offset)
  is the stronger version and costs one CI matrix entry.
- **Why this is Medium and not Low:** it is not itself a bug, but it is the reason a whole class of
  shipped bugs has no regression guard. Fixing F-1 without fixing F-2 means the fourth wave arrives
  later.
- **Ledger check:** no match.

### F-3 — `isInRange` classifies a biomarker with no reference range as **out of range** — **Low**

- **Location:** `src/utils/biomarkers/trendCalculations.ts:179-181`
- **Observation:** the range is a structured object, not a parsed string — so the format-parsing risks
  the prompt anticipated (`"<100"`, `"Negative"`, `"70 - 100"`) do not apply here:

  ```ts
  // Source: src/utils/biomarkers/trendCalculations.ts:179-181
  export function isInRange(value: number, biomarker: Pick<Biomarker, 'normalRange'>): boolean {
    return value >= biomarker.normalRange.min && value <= biomarker.normalRange.max;
  }
  ```

  `NormalRange` requires `min`/`max` as `number` (`src/types/index.ts:7-11`) and `Biomarker.normalRange`
  is non-optional (`:75`), so the type system covers the common path. But **`ExtractedBiomarker.normalRange`
  is optional** (`src/types/index.ts:125`) — the upload/extraction path can legitimately produce a
  biomarker whose reference range the lab report did not state. If such a value reaches `isInRange`
  without a range, both comparisons against `undefined` evaluate false and the function returns
  `false` — rendering as **out of range**.
- **Impact:** the failure direction is alarming rather than reassuring, which is the safer of the two
  — but it is still wrong. "We don't know this marker's reference range" and "this marker is abnormal"
  are different clinical statements, and showing the second for the first erodes trust in every other
  out-of-range badge.
- **Boundary semantics are correct and consistent:** inclusive on both ends (`>=` / `<=`), and
  `BiomarkerRangeBar` derives its `isInRange` from the same source, so the bar and the badge cannot
  disagree.
- **Fix:** make the absence explicit — return `boolean | null` (or add `hasRange`) and render
  "range unknown" rather than a status. Guard at the boundary where extracted biomarkers become
  `Biomarker`s if changing the signature is too invasive.
- **Ledger check:** no match.

### F-4 — Date-only rendering is correct but duplicated at four sites — **Low**

- **Location:** `src/components/dashboard/CategoryContent.tsx:69`,
  `src/components/insurance/ExpenseActualsList.tsx:59`,
  `src/components/insurance/InsurancePlanCard.tsx:45`,
  `src/components/insurance/InsurancePlanDetail.tsx:340`
- **Observation:** each renders a date-only value with an **inline** `timeZone: 'UTC'` rather than
  calling `formatDateOnly`. All four are currently **correct** — I checked each. But the fix is
  copy-pasted, so correctness depends on the next author remembering the option, and the helper's
  own docblock (`src/utils/format.ts:36-46`) is where the reasoning lives.
- **Impact:** none today; this is a maintainability finding. It is listed because F-1 is what happens
  when this pattern is copied one time too few.
- **Fix:** replace the four inline calls with `formatDateOnly`. Verified as safe: `formatDateOnly`
  accepts an options object and merges `timeZone: 'UTC'` over it (`format.ts:53`), so each site keeps
  its existing format.
- **Note on the sites that correctly do *not* pin UTC:** `GoalTrackerPanel.tsx:427,606,789,868`
  (`completedAt`, `recordedAt`, `achievedAt`), `AdminPage.tsx:55`, `HealthNeedsPage.tsx:80`, and
  `DashboardContent.tsx:83` render true timestamps or `new Date()`, where **local** time is right.
  Applying UTC there would be the same bug mirrored. The distinction is being maintained correctly.
- **Ledger check:** no match.

### F-5 — Info: the out-of-network approximation is invisible to the user

- **Location:** `backend/src/controllers/expenseController.ts:1064-1067`
- **Observation:** the OON-drop bug is genuinely fixed — out-of-network projections now contribute to
  projected OOP instead of silently counting as $0, and `expenseController.costMath.test.ts` pins it.
  But the replacement is an approximation the code documents honestly and the UI does not surface:

  ```ts
  // Source: backend/src/controllers/expenseController.ts:1064-1067
  // Include BOTH in- and out-of-network projections (OON was previously
  // dropped, zeroing its contribution). OON is approximated with in-network
  // rates because the plan model has no OON-specific rates — see the doc above.
  const annualCost = proj.estimatedCost * proj.frequencyPerYear;
  ```

  OON care is priced with in-network rates, which **systematically understates** real cost — OON
  deductibles and coinsurance are typically far worse, and `InsurancePlan` does carry
  `deductibleIndividualOutOfNetwork` / `oopMaxIndividualOutOfNetwork` columns that this calculation
  does not consult.
- **Why Info, not a finding:** the arithmetic does what its own documentation says, and the fix
  direction (use the OON columns) is a product decision about precision, not a defect. Recorded
  because the prompt asks specifically whether the caveat reaches the user, and the answer is no.
- **Related gap in the same function:** only `*Individual` fields are used —
  `deductibleIndividual`, `deductibleMetIndividual`, `oopMaxIndividual`, `oopMetIndividual`. Family
  plans are neither handled nor rejected; a family-plan user silently gets individual-deductible math.
  Worth an explicit decision.

---

## Checks passed

**§1 Reference-range classification**
- [x] Range is a structured `{ min, max, source }` object (`src/types/index.ts:7-11`), not a string —
      so no parse-format risk on the display path.
- [x] Boundary semantics inclusive on both ends and **consistent between the bar and the badge**
      (both derive from `isInRange`), so the two cannot disagree.
- [x] **Direction awareness is handled centrally.** `calculateTrend` and `classifyRangeStatusChange`
      are documented as thin adapters over `classifyBiomarker` specifically so `isImproving` is
      *clinically* correct — a move toward the range is "improving" regardless of whether the value
      rose or fell (`trendCalculations.ts:184-215`). This was the check most likely to fail and it
      passes by construction.

**§2 Trend statistics and ordering**
- [x] `computeBiomarkerStats` includes the **current** reading alongside history, with an inline
      rationale: the backend stores the current value separately and never folds it into history, so
      computing over history alone dropped the newest and most clinically relevant point and
      disagreed with the chart in the same modal (`trendCalculations.ts:221-235`). Ordering is
      explicitly mirrored to `BiomarkerChart` so stats match the plotted points.
- [x] `toChronologicalProgress` (`src/utils/goals/progressTrend.ts:25`) exists as a dedicated ordering
      step ahead of progress deltas.
- [x] `trendCalculations.test.ts` exists and covers the classifier.

**§3 Cost math (`extractProjectedOOP`, `expenseController.ts:1046-1085`)**
- [x] **Every projection contributes** — no filter or `continue` excludes a category; the OON
      inclusion is explicit (`:1064-1067`).
- [x] Deductible burn-down is sequential and correct: `min(annualCost, remainingDeductible)` to the
      deductible, remainder at coinsurance (`:1069-1077`).
- [x] `totalOOP` seeds from `oopMetIndividual` so already-spent dollars count (`:1061`).
- [x] **`oopMax > 0 ? min(totalOOP, oopMax) : totalOOP`** (`:1081-1082`) — a non-positive `oopMax`
      means "no cap recorded", **not** "cap to $0". This is the single easiest thing in the function
      to get catastrophically wrong and it is right.
- [x] M9 poisoned-row guards hold: coinsurance clamped 0–100 then divided by 100 (`:1056`);
      `Number(x) || 0` floors NaN and negatives (`:1057-1061`). These cover legacy rows written
      before SBC sanitization existed.
- [x] `decryptNumberOrZero` coerces a corrupt/key-mismatched row to **0, not NaN**, with tests
      pinning all three cases (valid, throwing decrypt, unparseable plaintext) —
      `expenseController.costMath.test.ts:22-40`.
- [x] The function is wrapped in `try { … } catch { return null }` (`:1083`), and `null` is stored as
      `null` rather than `0` (`expenseController.ts:837-839`) — an unavailable projection is not
      rendered as "$0".
- [x] `expenseController.costMath.test.ts` pins deductible burn-down, coinsurance, the OOP cap, **and**
      the specific regression (OON contributing rather than counting as $0). This is the model the
      other calculation surfaces should follow.

**§4 Dates**
- [x] `formatDateOnly` exists with the rationale documented in full (`src/utils/format.ts:36-53`),
      is NaN-guarded, and merges `timeZone: 'UTC'` over caller options.
- [x] Adopted at the highest-traffic date-only sites — `BiomarkerChart` (3 call sites), `TrendModal`,
      `FileCard`, `MyPatientsPage`, `TrendDetailModal`.
- [x] The timestamp/date-only distinction is **maintained correctly** — no site applies UTC pinning to
      a `createdAt`-style value (see F-4's note).
- [x] `dateNormalizer.ts` has dedicated test coverage (`src/__tests__/utils/dateNormalizer.test.ts`).

**§Backend**
- [x] Window math for quotas is UTC-consistent and computed server-side from `new Date()`, with no
      request field influencing it (`usageTracker.ts:43-52`) — clock-manipulation resistant.

---

## Unverifiable

- **Whether `ExtractedBiomarker` without a `normalRange` can actually reach `isInRange`** (F-3). The
  type permits it; whether the upload → review → save path always populates a range before
  conversion needs a trace through `extractionReview.ts` and the save handler, or a runtime probe.
  The fix is cheap enough that it is likely not worth the trace.
- **Whether `biomarkerDefinitions.ts` (113 lines) encodes sex- or age-specific ranges.** It is small
  enough that broad coverage is implausible, but establishing *which* markers need stratified ranges
  is a clinical question, not a code question. Flagged for a clinician, not for this review.
- **Float-accumulation drift in currency.** `totalOOP` accumulates in JS floats and is compared
  against `Decimal` columns. No error was observed in the pinned test values, but the test set is
  small and does not probe accumulation over many projections.

---

## Not applicable under current posture

Nothing. All three areas are pure application logic, fully live and fully testable in the sandbox.
Under a founder-only posture the *consequences* are small — one user sees the wrong goal deadline —
but nothing here is dormant, and every finding is fixable today with no infrastructure.

---

## Out of scope

- Whether in/out-of-range status is **perceivable** without color — [47-accessibility](./47-accessibility-review.md).
  (It is: `BiomarkerRangeBar` carries the status in its accessible name.)
- Where the plan values fed to the cost math come from — [48-insurance-domain](./48-insurance-domain-review.md).
  That review establishes the inputs are validated and clamped; this one covers the math on top.
- Series consolidation and dedupe — [`BIOMARKER_SERIES.md`](../BIOMARKER_SERIES.md) / prompt 46.

---

## Prompt drift log

- `prompts/49-calculation-correctness.md` §1 assumes `normalRange` is a **string** requiring parsing
  (`"70-100"`, `"<100"`, `"Negative"`) and asks which formats `isInRange` handles. On the frontend it
  is a structured `{ min, max, source }` object (`src/types/index.ts:7-11`) and no parsing occurs.
  The backend stores `normalRangeMin`/`normalRangeMax` as separate numeric columns. The checklist item
  should be rewritten to ask about **absent** ranges (F-3) rather than malformed strings — a real risk
  in place of a hypothetical one.

---

## Recommended ledger entries

Proposed for `OPEN_FINDINGS.md` (the ledger owns final severity):

| Proposed | Title | Class | Suggested severity | Re-eval trigger |
|---|---|---|---|---|
| new | Goal deadlines off by one day in negative-UTC locales (`daysRemaining` mixes UTC-parsed date with local `now`) | correctness | Low now (**Medium** with any real user) | Any non-founder user; ~5-line fix |
| new | No timezone-forcing test; the entire date-only bug class is unguarded and CI runs in UTC where it cannot reproduce | test coverage | Low (**the enabling condition** for the above) | — fix alongside the finding above |
| new | `isInRange` reports "out of range" for a biomarker with no reference range | correctness / clinical trust | Low | Any real lab upload lacking a stated range |
| note | OON projections priced at in-network rates; family plans silently use individual math | product accuracy | Info | Record as an accepted approximation in `KNOWN_ISSUES.md`, or consult the OON columns that already exist |

**The two date findings should be fixed together.** F-1 without F-2 fixes one instance of a class that
has now recurred four times with no guard against a fifth.
