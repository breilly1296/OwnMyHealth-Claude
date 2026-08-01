# Insurance Domain Review (SBC extraction, plans, benefits, comparison) — 2026-08-01

**Posture:** Sandbox — no GCP (no deployment target, founder-only data) — per [OPEN_FINDINGS.md §Posture](../OPEN_FINDINGS.md)
**Code state:** `master` @ `12b45ae`
**Ledger read at:** `12b45ae`, last updated 2026-08-01
**Prompt:** [`prompts/48-insurance-domain.md`](../../prompts/48-insurance-domain.md) — **first run of this prompt** (authored 2026-08-01; the domain had been flagged as having no owner since the 2026-06-16 index and was previously reviewed only in fragments by 27/28/42/43)

---

## Summary

| Severity | New | Already in ledger |
|---|---|---|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 0 | 0 |
| Low | 2 | 1 |
| Info | 2 | 0 |
| Dormant (launch checklist) | 0 | 0 |

**The finding I expected to make was not there.** The premise of this prompt was that the step where
an LLM's output becomes a `Decimal` in the database is unowned — prompt 28 stops at "the file was
validated", prompt 27 stops at "PHI was redacted before Claude". That step turns out to be defended
by `sanitizeExtractedSbc` (`controllers/upload/shared.ts:509-562`), a clamp-and-validate layer that
is more thorough than anything the prompt anticipated: every numeric is type-checked, non-negative-
checked, and ceiling-clamped; strings are control-char-stripped, escaped and length-capped; arrays
are element-sanitized and length-capped; `planType` is enum-whitelisted; dates are format- and
validity-checked. A hallucinated `deductibleIndividual: 999999999` or a negative `oopMaxFamily`
cannot reach the database.

Authorization is likewise clean: all 7 handlers are RLS-wrapped and additionally `userId`-scoped, the
create-inactive-then-activate quota bypass is closed in-transaction, and the provider read path is
gated at both the app and DB layers.

What remains is smaller: extraction **confidence** is computed and then dropped before the user ever
sees it, and `comparePlans` fails in a way that will read as a bug to a legitimate user.

---

## New findings

### F-1 — Extraction confidence is computed, then discarded before the user sees it — **Low**

- **Location:** `backend/src/services/sbcExtraction.ts:734` (the `CONFIDENCE SCORING` prompt contract),
  vs. the persisted `InsurancePlan` row
- **Observation:** `sbcExtraction.ts` instructs the model to return a confidence score and documents a
  scoring rubric at `:734`. The `UserFile` model carries an `extractionConfidence` column for the
  **lab** path. There is no equivalent on `InsurancePlan`, and no confidence value is surfaced in the
  SBC response consumed by `InsuranceSBCUpload` / `EnhancedInsuranceUpload`.
- **Impact:** a deductible extracted at low confidence from a poorly-scanned SBC is stored and
  rendered identically to one extracted at high confidence, and then feeds `extractProjectedOOP`
  (`expenseController.ts:1046`) to produce a dollar figure the user makes financial decisions on.
  The system knows the number might be wrong and does not say so. This is a product-trust defect
  rather than a security one — nothing is exposed, but a confident-looking number is presented
  without its own uncertainty.
- **Why Low:** the user can see and edit every extracted field before it is used, so the information
  is recoverable by inspection; and under the sandbox posture the only affected user is the founder.
- **Fix:** persist the confidence alongside the plan (mirroring `UserFile.extractionConfidence`) and
  surface it in the review step — the SBC upload UI already has a confirm/edit stage, which is the
  natural place. Where confidence is low, mark the specific fields rather than the whole plan.
- **Ledger check:** searched `OPEN_FINDINGS.md` for `SBC`, `extraction`, `confidence`, `insurance` —
  no match.

### F-2 — `comparePlans` silently drops unowned plan ids, then 404s with a misleading message — **Low**

- **Location:** `backend/src/controllers/insuranceController.ts:802-812`
- **Observation:** the query is correctly scoped — `where: { id: { in: planIds }, userId }` inside
  `withRLSTransaction(userId, …)`, so ownership is enforced twice (app predicate + RLS). **There is
  no IDOR here** — that was the main thing this section set out to test, and it passes. But ids that
  do not resolve are dropped silently, and the only feedback is a count check:

  ```ts
  // Source: backend/src/controllers/insuranceController.ts:802-812
  const plans = await withRLSTransaction(userId, async (tx) => {
    return tx.insurancePlan.findMany({
      where: { id: { in: planIds }, userId },
      include: { benefits: true },
    });
  });

  if (plans.length < 2) {
    throw new NotFoundError('At least 2 valid plans required for comparison');
  }
  ```

- **Impact:** two distinct problems share one message. (a) A user who compares 3 plans, one of which
  they deleted in another tab, gets a comparison of 2 with **no indication** the third was dropped —
  a silently incomplete answer to a financial question. (b) A user passing 2 ids where one is stale
  gets "At least 2 valid plans required for comparison" while looking at what appears to be 2 valid
  plans, which reads as a broken feature.
- **Security note — this asymmetry is deliberate and correct.** Returning "plan X not found" per id
  would confirm or deny the existence of another user's plan id. The fix must not introduce that.
- **Fix:** compare `plans.length` against `planIds.length` and return the resolved set plus a count of
  unresolved ids — never *which* ids, and never distinguishing "does not exist" from "not yours".
  Something like `{ comparison, requested: planIds.length, compared: plans.length }` lets the UI say
  "1 plan could not be included" without leaking anything.
- **Ledger check:** no match.

### F-3 — Info: the client-side SBC parser is a genuine second implementation

- **Location:** `src/utils/insurance/sbcParser.ts` vs. `backend/src/services/sbcExtraction.ts` (1040
  lines) and `backend/src/services/pdfParser.ts`
- **Observation:** the server is authoritative — every persisted field passes
  `schemas.insurancePlan.create` (`insuranceRoutes.ts:84`) and, on the upload path,
  `sanitizeExtractedSbc`. **No client-extracted value is trusted.** So the trust boundary is intact.
  What remains is duplication: two independent SBC-parsing implementations that can disagree about
  the same document, with no shared fixtures pinning them together.
- **Why this is Info and not a finding:** nothing is exploitable and nothing is wrong today. It is
  recorded because scrutiny tracks it as **P1-4** ("collapse dual parsers — server owns extraction,
  FE confirm/edit only, or documented offline-only") and because the failure mode it produces is
  confusing rather than dangerous: a user sees one set of numbers in the preview and a different set
  after saving.
- **Suggested action:** decide and document which of the two is the product's parser. If the client
  copy stays, add a shared fixture SBC that both must parse identically.

### F-4 — Info: `planIdNumber` is plaintext and unconstrained

- **Location:** `backend/prisma/schema.prisma` — `planIdNumber String? @map("plan_id_number") @db.VarChar(100)`
- **Observation:** `memberIdEncrypted` and `groupIdEncrypted` are the only encrypted columns on
  `InsurancePlan`, and that matches `_phi-inventory.md` exactly. `planIdNumber` is deliberately
  plaintext on the reasoning that a plan identifier identifies a *plan*, not a *person*.
- **The residual risk is data-entry, not design:** the field is a free-text `VarChar(100)` with no
  format validation. A user transcribing from their card can put their member ID in it — the two
  numbers sit adjacent on most insurance cards — at which point an identifier that should be
  encrypted is stored in plaintext, outside `PHI_FIELDS`, and outside every guarantee
  `PHI_TAXONOMY.md` makes.
- **Why Info:** no code path does this; it depends on user behavior, and the founder-only posture
  means there is currently one user who knows better.
- **Suggested action:** either add helper text distinguishing the two fields in
  `AddInsurancePlanModal`, or treat `planIdNumber` as PHI and encrypt it. The second is cheap now and
  expensive after there are rows.

---

## Already-tracked (no new severity)

- **OF-06 — Plan-limit / AI-quota TOCTOU race** — confirmed present on this domain's create path.
  `requirePlanLimit('insurancePlans')` (`insuranceRoutes.ts:83`) is a read-then-allow with no
  reservation, so two concurrent `POST /insurance/plans` can both pass at `limit - 1`. **The
  activation path does not share this weakness**, which is worth recording: the M13 re-check runs
  *inside* the transaction that performs the activation (`insuranceController.ts:680-690`), making
  check-and-consume a single serialized step for that operation. It is the closest thing in the
  codebase to the atomic reservation OF-06 prescribes, and is a usable template for fixing the rest.

---

## Checks passed

**§1 Extraction trust boundary — the core of this review**
- [x] **Every numeric that becomes a `Decimal` is validated before persistence.** `sanitizeMoney`
      rejects non-numbers, non-finite values and negatives, then clamps to `SBC_MONEY_MAX`
      (`shared.ts:379-382`). `sanitizePercent` clamps 0–100 (`:385-388`). `sanitizeIntLimit`
      additionally rounds (`:391-393`). Applied field-by-field through `clampFields` against
      per-object specs (`:426-432`), covering the top level plus ten nested coverage objects.
- [x] **Strings are defended against control characters and unbounded length** — `sanitizeStr`
      strips `\x00-\x1F\x7F`, applies `sanitizeString` escaping, and caps length (`:397-404`).
- [x] **Enums are whitelisted, not coerced** — `sanitizePlanType` returns `undefined` for anything
      outside `SBC_PLAN_TYPES` (`:406-410`), so a hallucinated plan type cannot enter the column.
- [x] **Dates are format- *and* validity-checked** — `sanitizeIsoDate` requires `^\d{4}-\d{2}-\d{2}`
      **and** a parseable `Date` (`:413-416`), falling back at the call site rather than storing junk.
- [x] **Arrays cannot become unbounded blobs** — `preventiveServices` / `exclusions` /
      `priorAuthRequirements` and `servicesWithLimits` are element-sanitized and `.slice(0, 200)`
      capped (`:544-559`).
- [x] **Benefit rows missing a service name or category are dropped**, matching the Claude-path filter
      (`:530-541`).
- [x] Model output is consumed as **data**, never concatenated into instructions or used to select
      code paths — verified by reading the parse-and-clamp flow end to end.
- [x] Adopt-on-import: SBC import adopts the saved plan rather than re-creating it (`6faea4b`); the
      adopted plan is written under the uploader's `userId` inside an RLS transaction, so it cannot
      attach to another user.

**§3 Authorization and tenancy**
- [x] All 7 exported handlers (`getInsurancePlans`, `getInsurancePlan`, `createInsurancePlan`,
      `updateInsurancePlan`, `deleteInsurancePlan`, `comparePlans`, `searchBenefits`) wrap DB access
      in `withRLSTransaction`/`withRLSContext`.
- [x] Single-resource handlers scope by `userId` **in addition to** RLS, and validate params with
      `schemas.uuidParam` (`insuranceRoutes.ts:75,91,99,121,147`).
- [x] `comparePlans` ownership: enforced for **every** id, not just the first — the `in` predicate
      carries `userId` (see F-2 for the UX consequence).
- [x] `searchBenefits` is query-validated (`benefitSearchSchema`, `insuranceRoutes.ts:113`) and
      RLS-scoped; no raw interpolation into a `LIKE`/full-text clause.
- [x] Provider read path enforces `canViewInsurance` through `resolveProviderAccess`
      (`providerRoutes.ts:632`), **and** the DB backs it independently —
      `insurance_plans_select` / `insurance_benefits_select` gate on
      `has_provider_access(..., 'view_insurance')`. App-layer and DB-layer both hold.
- [x] Provider cannot write insurance data — no PATCH/PUT/DELETE reachable with a provider session.

**§4 PHI handling**
- [x] `memberIdEncrypted` + `groupIdEncrypted` are the only encrypted columns on `InsurancePlan`
      (`schema.prisma:246-247`), matching `_phi-inventory.md` exactly.
- [x] No member/group id reaches logs, AI prompts, or error messages — `Grep "memberId|groupId"`
      across `backend/src/` (excluding tests), every hit inspected.
- [x] `comparePlans` audit metadata caps logged ids at 10 and logs no decrypted values
      (`insuranceController.ts:818-822`).
- [x] The M13 403 body is field-for-field identical to the middleware's `PLAN_LIMIT_EXCEEDED` shape,
      with an inline comment explaining why it is hand-built (the central `errorHandler` discards
      custom `AppError` fields) — `insuranceController.ts:709-724`.

**§5 AI cost and rate limiting**
- [x] Both AI-backed insurance routes carry `aiLimiter` + `aiSpendGuard` + `requirePlanLimit`
      (`insuranceRoutes.ts:124-126,137-139`) — 2 of the 8 `aiSpendGuard` mounts app-wide.
- [x] `comparePlans` and `searchBenefits` are **not** AI-backed — verified by reading both handlers
      end to end (`compareBenefits` is a pure in-memory matrix build). Their absence from the
      `aiSpendGuard` list is correct, not a gap. This was an open question in the prompt; it is now
      answered.
- [x] `requirePlanLimit('insurancePlans')` on create (`:83`) plus the in-transaction activation
      re-check (`insuranceController.ts:680-690`) close the create-inactive-then-activate bypass.

**§6 Knowledge base**
- [x] `knowledge/insuranceKnowledge.ts` (459 lines) is static repo content. No user input enters the
      retrieval corpus — no retrieval-poisoning path.

---

## Unverifiable

- **Whether the regex fallback and the Claude path can disagree on the same SBC.** Both are reachable
  (`extractSBCData` prefers Claude and falls back to the regex parser on failure or when Claude is
  disabled — `shared.ts:565-572`), and both terminate in `sanitizeExtractedSbc`, so neither can
  produce out-of-range values. Whether they produce the *same* values for a given document requires
  running both against a fixture corpus, which does not exist. Recommended as the first test to add
  to this domain.
- **Whether low-confidence extractions correlate with wrong values in practice** — needs real SBCs.

---

## Not applicable under current posture

- Nothing material. The insurance domain is application-level and fully exercisable in the sandbox —
  notably, **SBC upload is the keyless upload path** (the regex fallback needs no `ANTHROPIC_API_KEY`,
  unlike the lab-report route), so this domain is testable end to end today.

---

## Out of scope

- PHI-before-Claude and BAA gating — [27-ai-integration](./27-ai-integration-review.md).
- Upload validation, magic bytes, PDF-bomb guards, storage — [28-file-storage](./28-file-storage-review.md).
- Spend-cap mechanics — [42-ai-cost-control](./42-ai-cost-control-review.md).
- Plan-tier gate mechanics — [43-plan-gating-billing](./43-plan-gating-billing-review.md).
- **Whether the resulting cost arithmetic is correct** — [49-calculation-correctness](./49-calculation-correctness-review.md).
  This review establishes that the *inputs* to that math are validated; that one establishes whether
  the math on top of them is right.

---

## Recommended ledger entries

Proposed for `OPEN_FINDINGS.md` (the ledger owns final severity):

| Proposed | Title | Class | Suggested severity | Re-eval trigger |
|---|---|---|---|---|
| new | SBC extraction confidence computed then discarded; plan financials shown without uncertainty | product trust | Low | Any non-founder user |
| new | `comparePlans` silently drops unowned/stale ids and 404s misleadingly | correctness / UX | Low | — |
| note | `planIdNumber` is unvalidated plaintext and can receive a member ID by data entry | PHI hygiene | Info | Encrypt before real rows exist, or add UI disambiguation |

**Worth stating plainly for the record:** the extraction trust boundary — the thing this prompt was
written to find a hole in — is sound. `sanitizeExtractedSbc` is the strongest single defensive layer
I reviewed in this domain, and if anything it deserves to be cited as the pattern for other
model-output-to-database paths in the codebase.
