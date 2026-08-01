---
tags:
  - security
  - domain
  - insurance
  - high
type: prompt
priority: 2
updated: 2026-08-01
---

# Insurance Domain Review (SBC extraction, plans, benefits, comparison)

> Follow the [review protocol](./_review-protocol.md) — including reading
> `New Project Documents/OPEN_FINDINGS.md` before you report anything.
> Use the [PHI inventory](./_phi-inventory.md) for `memberIdEncrypted` / `groupIdEncrypted`.
> Use [Claude Code tools](./_verification-tools.md) for all greps.

## Why this prompt exists

Insurance is the second-largest domain in the app — `insuranceController.ts` (947 lines),
`sbcExtraction.ts` (1040), `knowledge/insuranceKnowledge.ts` (459), and 20 components under
`src/components/insurance/` — and until 2026-08-01 it had **no dedicated owner**. It was reviewed
only in fragments: prompt 27 covered the Claude call, 28 covered the PDF upload, 42 covered the
dollar spend, 43 covered the plan-count gate. Nobody reviewed the domain as a system.

What falls between those fragments is exactly where the interesting bugs are:

- **A trust boundary nobody owns.** An SBC is an attacker-influenced PDF whose contents become
  structured financial numbers that later drive cost math and user decisions. Prompt 28 stops at
  "the file was validated"; prompt 27 stops at "PHI was redacted before Claude". The step where an
  LLM's output becomes a `Decimal` in the database is unowned.
- **PHI in an unexpected place.** `memberIdEncrypted` and `groupIdEncrypted` are the only PHI here,
  but the *plan* fields around them (`planIdNumber`, `insurerName`, deductible/OOP progress) are
  plaintext and quasi-identifying in combination.
- **A provider-visible surface.** `canViewInsurance` gates a whole provider read path
  (`providerRoutes.ts:619-632`, M3), separate from biomarker consent.

This prompt owns the **security and integrity** of the domain. Whether the *arithmetic* is right —
deductible burn-down, coinsurance, OOP caps — belongs to
[49-calculation-correctness](./49-calculation-correctness.md). Cite across rather than duplicating.

## Files to Review

| File | Why |
|---|---|
| `backend/src/routes/insuranceRoutes.ts` | Middleware chains; the two `aiSpendGuard` mounts (`:125`, `:139`) |
| `backend/src/controllers/insuranceController.ts` | 7 exported handlers: `getInsurancePlans`, `getInsurancePlan`, `createInsurancePlan`, `updateInsurancePlan`, `deleteInsurancePlan`, `comparePlans`, `searchBenefits` |
| `backend/src/services/sbcExtraction.ts` | Claude-driven SBC → structured plan extraction, incl. the confidence-scoring contract (`:734`) and `isSBCExtractionConfigured` (`:1033`) |
| `backend/src/services/pdfParser.ts` | The regex SBC fallback parser |
| `backend/src/services/knowledge/insuranceKnowledge.ts` | Retrieval corpus backing insurance guidance |
| `backend/src/services/knowledge/knowledgeRetrieval.ts` | How that corpus is selected into prompts |
| `backend/src/controllers/upload/sbcUploadController.ts` | The SBC upload path (also covered by 28 — do not re-report upload validation here) |
| `backend/prisma/schema.prisma` | `InsurancePlan` (`:239`) and `InsuranceBenefit` (`:408`) |
| `backend/src/routes/providerRoutes.ts` | `canViewInsurance` provider read path (`:619-632`) |
| `backend/src/middleware/validation.ts` | `schemas.insurancePlan.create` / `.update`, `compareSchema`, `benefitSearchSchema` |
| `src/components/insurance/` (20 files) | Client surface, incl. `planFormatters.ts`, `insuranceKnowledgeBaseConstants.ts` |
| `src/utils/insurance/` | `sbcParser.ts`, `insuranceUtils.ts`, `insuranceEducation.ts`, `insuranceKnowledgeBase.ts` — the **client-side** parser duplicate |

## Checklist

### 1. Extraction trust boundary (the core of this prompt)
- [ ] Claude's SBC output is **validated before persistence**, not trusted as-shaped. Every numeric
      field that becomes a `Decimal` column must pass a schema/range check — a hallucinated
      `deductibleIndividual` of `999999999` or a negative `oopMaxFamily` must be rejected, not stored
- [ ] The extraction response is parsed defensively (malformed JSON, missing keys, extra keys, wrong
      types) and failure produces a `BadRequestError`, never a partial write
- [ ] **Prompt-injection resistance**: SBC text is attacker-influenced. Verify the extracted text is
      delivered as data, not concatenated into instructions, and that model output cannot alter
      control flow (e.g. a "plan name" of `"; DROP` or a value that becomes a field name)
- [ ] Confidence scores (`sbcExtraction.ts:734`) are **carried through to the user**, not silently
      discarded — a low-confidence deductible that drives cost projections without a visible caveat is
      a trust defect
- [ ] The regex fallback (`pdfParser.ts`) and the Claude path cannot disagree silently — establish
      which wins and whether a fallback result is labelled as such
- [ ] `isSBCExtractionConfigured()` gates the feature cleanly when `ANTHROPIC_API_KEY` /
      `ANTHROPIC_BAA_ACTIVE` are absent — no half-configured path that sends PHI anyway
- [ ] BAA gating holds on this path exactly as on the lab path (cross-check prompt 27)
- [ ] Adopt-on-import: `6faea4b` changed SBC import to adopt the saved plan rather than re-create it.
      Verify no duplicate-plan path remains, and that adoption cannot attach a plan to another user

### 2. Client/server parser duplication
- [ ] `src/utils/insurance/sbcParser.ts` duplicates server extraction logic. Confirm the **server is
      authoritative** and client output is only a UX preview — a client-computed plan that is
      persisted verbatim is a trust-boundary violation (scrutiny P1-4 tracks this class)
- [ ] Client-supplied plan fields are re-validated server-side by `schemas.insurancePlan.create`,
      regardless of what the client claims it extracted

### 3. Authorization and tenancy
- [ ] All 7 controller handlers wrap DB access in `withRLSTransaction`/`withRLSContext`
- [ ] `getInsurancePlan`, `updateInsurancePlan`, `deleteInsurancePlan` scope by `userId` **in
      addition to** RLS (defense in depth), and use `schemas.uuidParam` on params
- [ ] `comparePlans` cannot be used to read a plan the caller does not own — it accepts a list of
      plan ids (`compareSchema`); verify every id is ownership-checked, not just the first
- [ ] `searchBenefits` (`benefitSearchSchema`, query-validated) cannot enumerate other users'
      benefits, and its query parameters cannot be used for injection into a `LIKE`/full-text clause
- [ ] Provider read path enforces `canViewInsurance` through `resolveProviderAccess`
      (`providerRoutes.ts:632`) — and the RLS policies `insurance_plans_select` /
      `insurance_benefits_select` back it at the DB layer, not only in app code
- [ ] Provider **cannot** write insurance data — confirm no PATCH/PUT/DELETE reachable with a
      provider session
- [ ] Deleting a plan cascades or nulls dependent `ExpenseProjection`/`ExpenseActual`/`CostAnalysis`
      rows predictably, without orphaning PHI

### 4. PHI handling in the insurance model
- [ ] `memberIdEncrypted` / `groupIdEncrypted` are the **only** encrypted fields on `InsurancePlan`
      (`schema.prisma:246-247`) and match `_phi-inventory.md`
- [ ] `planIdNumber`, `insurerName`, `planName` are plaintext by design — verify that decision is
      recorded somewhere, and consider whether `planIdNumber` (`VarChar(100)`) can carry a member
      identifier in practice. If it can, that is a finding
- [ ] Decrypt paths are robust to a corrupt/key-mismatched row (the pattern established for expenses
      in `eaf8efe`) — a single bad row must not 500 the whole list endpoint
- [ ] Member/group ids never reach logs, AI prompts, or error messages — `Grep` `memberId` across
      `backend/src/` and check each hit
- [ ] Deductible/OOP *progress* fields (`deductibleMetIndividual`, `oopMetIndividual`, …) are
      plaintext financial-health signals. Confirm this is an accepted exception, not an oversight

### 5. AI cost and rate limiting on this domain
- [ ] Both AI-backed insurance routes carry `aiLimiter` + `aiSpendGuard` + `requirePlanLimit`
      (`insuranceRoutes.ts:124-126,137-139`) — 2 of the 8 `aiSpendGuard` mounts app-wide
- [ ] `requirePlanLimit('insurancePlans')` gates plan creation (`insuranceRoutes.ts:83`); confirm the
      count is computed server-side and cannot be raced (cross-ref prompt 43 / scrutiny P1-7)
- [ ] `comparePlans` and `searchBenefits` — establish whether either is AI-backed. If yes, they need
      spend guarding too; if no, confirm they are cheap enough to sit behind only `standardLimiter`
- [ ] Cost analysis results are cached/persisted (`CostAnalysis` has `claudeResponseEncrypted`) so a
      repeated request does not re-bill; verify cache-key scoping is per-user

### 6. Knowledge base integrity
- [ ] `insuranceKnowledge.ts` content is static repo data, not user-supplied — confirm no user input
      can enter the retrieval corpus (a retrieval-poisoning path)
- [ ] `knowledgeRetrieval.ts` selection is deterministic and bounded — an unbounded retrieval that
      grows the prompt with plan count is a cost bug
- [ ] Insurance guidance carries the same AI disclaimer enforcement as health guidance
      (`utils/aiDisclaimer`) — insurance advice has its own liability profile

### 7. Frontend surface
- [ ] Insurance components render only what the API returns; no client-side re-derivation of plan
      financials that could disagree with the server (cross-ref prompt 49)
- [ ] `effectiveDate` / `terminationDate` are `@db.Date` (date-only). They must render in **UTC** —
      this was a real bug (`b376949`, `45a0cbc`). Cross-ref prompt 49 §dates
- [ ] The SBC upload UI communicates extraction confidence and lets the user correct values before
      they are persisted
- [ ] Member/group ids are masked in list views and revealed only deliberately

## Verification Commands
```bash
# Route middleware chains for the whole domain
grep -nE "router\.(get|post|put|patch|delete)|aiSpendGuard|aiLimiter|requirePlanLimit|validate\(" backend/src/routes/insuranceRoutes.ts

# Ownership + RLS on every insurance handler
grep -n "withRLSTransaction\|withRLSContext\|userId" backend/src/controllers/insuranceController.ts

# Where extracted values become persisted numbers
grep -n "parseFloat\|Number(\|Decimal\|toFixed" backend/src/services/sbcExtraction.ts backend/src/controllers/insuranceController.ts

# Member/group id leak surface
grep -rn "memberId\|groupId" backend/src/ --include=*.ts | grep -v test

# Client-side parser duplicate (server must be authoritative)
grep -rn "export " src/utils/insurance/sbcParser.ts

# Provider consent gate for insurance reads
grep -n "canViewInsurance\|resolveProviderAccess" backend/src/routes/providerRoutes.ts
```

## Questions to Ask
1. What stops a hallucinated or adversarial SBC value from becoming a `Decimal` the user then makes
   financial decisions on? Name the validation, with a `file:line`.
2. Where does extraction confidence go after `sbcExtraction` returns it — is it persisted, shown, or
   dropped?
3. Is the client-side `sbcParser.ts` a preview or a source of truth? If any persisted field can
   originate from it without server re-validation, that is a finding.
4. Can `comparePlans` read a plan the caller does not own if one id in the list belongs to someone
   else?
5. Is `planIdNumber` ever populated with something that identifies the member?
6. Are `comparePlans` / `searchBenefits` AI-backed? If so, why do they lack `aiSpendGuard` when the
   other two AI insurance routes have it?
7. Can a provider with `canViewInsurance` see `memberIdEncrypted` decrypted, and should they?

## Required artifacts
- A route table: method, path, middleware chain in order, ownership check, AI-backed y/n, spend-guarded y/n
- A trust-boundary trace for one SBC upload: PDF bytes → text → redaction → Claude → parse →
  validation → `InsurancePlan` row, with the `file:line` of every transformation
- The PHI column list for `InsurancePlan` reconciled against `_phi-inventory.md`

## Cross-links
- [27-ai-integration](./27-ai-integration.md) — PHI-before-Claude, BAA gating (do not duplicate)
- [28-file-storage](./28-file-storage.md) — SBC upload validation and storage (do not duplicate)
- [42-ai-cost-control](./42-ai-cost-control.md) — spend cap mechanics
- [43-plan-gating-billing](./43-plan-gating-billing.md) — `insurancePlans` limit enforcement
- [49-calculation-correctness](./49-calculation-correctness.md) — whether the resulting cost math is right
- [26-provider-collaboration](./26-provider-collaboration.md) — consent model behind `canViewInsurance`
