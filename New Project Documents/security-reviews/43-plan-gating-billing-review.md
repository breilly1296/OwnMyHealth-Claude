# Plan Gating & Billing-Tier Security Review — 2026-06-16

> **Reconciled 2026-08-01 — not re-run.** The reviewed code (`planGating.ts`, `usageTracker.ts`,
> `plans.ts`, `planRoutes.ts`, the 11 gate mount points) is **unchanged** since this review was
> written, so its findings stand as-is. What changed is the governance around them:
>
> - **Posture:** sandbox — no GCP, no deployment target, founder-only data (declared 2026-07-14).
>   See [OPEN_FINDINGS.md §Posture](../OPEN_FINDINGS.md). Severity below is impact × exposure at
>   2026-06-16, when a deployed stack was assumed; the ledger has since re-rated these downward.
> - **Ledger:** [OPEN_FINDINGS.md](../OPEN_FINDINGS.md) is now the single authoritative findings
>   ledger and owns severity. This document does **not**. Mapping:
>
>   | Finding here | Ledger | Current ledger severity |
>   |---|---|---|
>   | F-1 blocked/failed guidance burns quota | *not yet in ledger* | proposed **Medium** |
>   | F-2 TOCTOU + batch overshoot | **OF-06** (Accepted) | **Low** (was Medium) — becomes High and a launch blocker the day plan limits guard paid entitlements |
>   | F-3 JWT `plan` snapshot unused | *hygiene, not ledgered* | — |
>   | F-4 prompt drift | prompt-library issue → `_drift-audit-2026-08-01.md` | — |
>   | F-5 `normalizePlan` is the only guard on the VARCHAR column | *not ledgered* | — |
>   | (billing stub, noted in §4) | **OF-15** (product decision) | **Low** |
>
> - **Also observed 2026-08-01, not in this review:** `checkPlanLimit` calls `getUserUsage`, which
>   issues **all six** count queries when one is needed (`usageTracker.ts:199`) — a lab upload passes
>   two gates and so fires 12 counts before the handler runs. Low; performance only.
> - **OF-06 amendment worth making:** the ledger describes the race as "N concurrent requests
>   overshoot by N−1". F-2 below establishes something the ledger omits — `POST /biomarkers/batch`
>   overshoots by `batchSize − 1` with **no concurrency at all**, because the gate is per-request,
>   not per-row.

Scope: subscription plan gating and billing tiers per `prompts/43-plan-gating-billing.md`, run against live code at HEAD `fb2cd32`. Every check was executed by reading the actual source; the AI guard stack and dollar-budget governance are cross-linked, not re-audited (owned by `27-ai-integration` / `42-ai-cost-control`).

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 3 |

Total findings: 5. Checks passed: 35.

Headline: the gate is server-side, fail-closed, RLS-scoped, and reads the live DB plan rather than the stale JWT — the authorization integrity is sound and there is no self-elevation path. The findings are correctness/fairness gaps (a blocked AI-guidance attempt wrongly burns quota; the documented TOCTOU and batch-overshoot residuals) and prompt drift, none of which open a paid feature to a FREE user.

## Findings

### F-1 — Blocked/not-found biomarker AI-guidance attempts consume `aiGuidancePerDay` quota — **Medium**
- **Location:** `backend/src/routes/biomarkerRoutes.ts:154`, `:187`, `:284`; counter at `backend/src/services/usageTracker.ts:115-122`; `backend/src/services/auditLog.ts:383`.
- **Observation:** All three guidance audit writes — the BAA-gate refusal (`operation: 'GUIDANCE_BLOCKED_NO_BAA'`, returns 503), the IDOR/not-found path (`operation: 'GUIDANCE_NOT_FOUND'`, returns 404), and the successful disclosure (`operation: 'PHI_ACCESS'`) — call `auditService.logAccess('biomarker_ai_guidance', ...)`. `logAccess` unconditionally writes `action: 'READ'` regardless of the `operation` metadata (`auditLog.ts:383`). The `aiGuidancePerDay` usage counter counts every row where `resourceType = 'biomarker_ai_guidance' AND action = 'READ'` (`usageTracker.ts:115-122`), so a guidance call that never reached Claude (BAA disabled, or a 404 for a non-existent/other-user biomarker) still consumes one of the FREE tier's 5 daily guidance slots.
- **Impact:** A FREE user whose deployment has `ANTHROPIC_BAA_ACTIVE` off, or who fat-fingers a biomarker id, silently burns their daily guidance quota on attempts that produced no value. This is the exact failure mode the §3 checklist item ("counting cannot be deflated by failed/blocked calls") probes, and it is the *inverse* of the fix already applied to the chat path: `aiChatController.ts` routes blocked/failed attempts to a separate `RESOURCE_TYPE_ATTEMPT = 'HealthGuideAttempt'` (`aiChatController.ts:40-48,147-155,213-218,349-362`) precisely so they are not counted. The biomarker-guidance route never received the parallel L-35 treatment. Direction is user-hostile (over-counts), not a bypass — it cannot let a user *exceed* the limit — which is why this is Medium, not High.
- **Fix:** Mirror the chat fix in `biomarkerRoutes.ts`: log `GUIDANCE_BLOCKED_NO_BAA` (`:154`) and `GUIDANCE_NOT_FOUND` (`:187`) under a distinct resourceType (e.g. `'biomarker_ai_guidance_attempt'`) that `usageTracker.ts` does not match, keeping the durable audit trail (`success:false`) without consuming quota. Leave the success path (`:284`) on `'biomarker_ai_guidance'`.
- **Evidence:**
  ```ts
  // auditLog.ts:380-383 — operation never changes the action
  await this.log({ ...
    action: 'READ',
    resourceType, ... });
  // usageTracker.ts:115-122 — counts ALL READ rows of that resourceType
  tx.auditLog.count({ where: { userId,
    resourceType: RESOURCE_BIOMARKER_GUIDANCE, action: 'READ',
    createdAt: { gte: today } } }),
  ```

### F-2 — Finite-limit TOCTOU + per-request batch overshoot let counts exceed the cap — **Medium**
- **Location:** `backend/src/services/usageTracker.ts:179-209` (TOCTOU note + `allowed: current < limitValue`); `backend/src/middleware/planGating.ts:91-98`; batch gate `backend/src/routes/biomarkerRoutes.ts:102-108`; truncation backstop `backend/src/controllers/upload/shared.ts:206-231`; activation re-check `backend/src/controllers/insuranceController.ts:680-691`.
- **Observation:** `checkPlanLimit` is a read-then-allow with no atomic reservation: the usage row (audit row, `userFile`/`biomarker` insert, `insurancePlan` activation) is written by the handler *after* the gate returns. Two concurrent same-user requests can both read `current = limit - 1`, both pass, and both write — overshooting by the number of in-flight requests. Separately, `requirePlanLimit('maxBiomarkers')` is per-request, not per-row, so a single `POST /batch` or upload by a user one row under the cap can push the stored total over by up to `batchSize - 1` rows; the `upload/shared.ts` M12 truncation only bounds the OCR/upload insert path (it slices to `remaining`), and the `POST /batch` direct path has no equivalent truncation.
- **Impact:** Cost-bearing and storage caps (`maxBiomarkers`, `insurancePlans`, `aiChatsPerDay`, `aiGuidancePerDay`, `pdfUploadsPerMonth`, `costAnalysisPerMonth`) can be modestly exceeded by a determined user racing requests or sending a large batch. Blast radius is bounded (overshoot is O(concurrent requests) or O(batchSize), and the dollar-budget `aiSpendGuard` independently caps AI spend), so this is a quota-integrity weakness, not an unbounded abuse vector. Both the TOCTOU and the batch residual are explicitly documented in-code as known/accepted, which is the correct posture but does not make them non-findings.
- **Fix:** For exactness, move the check-and-consume into a single transaction: an atomic `UPDATE counter SET n = n + :rows WHERE n + :rows <= :limit RETURNING n` (or `SELECT ... FOR UPDATE` on a per-user/per-window counter) in the same `withRLSTransaction` as the usage write, rolling back on failure — exactly the design sketched at `usageTracker.ts:186-195`. For the batch path specifically, make the gate count-aware (compare `current + batch.length` against the limit) or extend the `upload/shared.ts` truncation pattern to `bulkCreateBiomarkers`.
- **Evidence:**
  ```ts
  // usageTracker.ts:204 — read-then-allow, no reservation
  return { allowed: current < limitValue, current, ... };
  // biomarkerRoutes.ts:96-100 — documented batchSize-1 residual
  // "A single batch can therefore still push the stored total past the
  //  limit by up to (batchSize - 1) rows."
  ```

### F-3 — `req.user.plan` JWT snapshot carried but unused by the gate (defense-in-depth hygiene) — **Low**
- **Location:** `backend/src/middleware/auth.ts:118`, `:174`, `:230` (`plan: decoded.plan || 'FREE'`); consumed nowhere in enforcement.
- **Observation:** Every auth path attaches a `plan` field to `req.user` from the JWT payload. The gate deliberately ignores it and reads the DB fresh (`planGating.ts:66-72`), and on DB error fails closed to FREE rather than reading the snapshot (`:76-88`). The snapshot is therefore dead weight in the request object: a future maintainer could reasonably (and wrongly) reach for `req.user.plan` as a "cheap" plan source, reintroducing the up-to-15-min-stale-entitlement bug the gate was written to avoid.
- **Impact:** No exploit today — nothing reads it for authorization. Purely a footgun / latent-regression risk.
- **Fix:** Either drop `plan` from the `req.user` shape entirely (and from the JWT payload) so the only plan source is the DB read, or add a code comment at each attach site stating it must never drive enforcement. A grep guard in CI (`req.user.plan` outside tests) would harden it.
- **Evidence:**
  ```ts
  // auth.ts:115-118
  // Tokens issued before plan was added to the payload won't have it;
  // fall back to FREE so the request still flows. New tokens get the real plan.
  plan: decoded.plan || 'FREE',
  ```

### F-4 — Prompt drift: line references in `prompts/43-plan-gating-billing.md` are off by a few lines — **Low**
- **Location:** `prompts/43-plan-gating-billing.md` vs live code.
- **Observation:** Per the protocol's "trust the code" rule, several cited line numbers have drifted: the prompt cites `requirePlanFeature` at `planGating.ts:131` (actual `:131` is correct, but the function spans `:131-133`); `insuranceController.ts:680-727` for the M13 gate (actual: the gate logic is `:680-691`, the 403 emit `:710-727` — close but the range conflates two blocks); `validation.ts:899` for `updateUserPlan` (actual `:899-902`); `PlanSection.tsx:162,163` for the TODO/`onError` (actual: TODO `:162`, `onError` `:163` — correct). Material claims (file names, function names, behavior) all hold; only some exact spans are slightly off.
- **Impact:** None functional. Drift accumulates and erodes trust in the prompt as a verification aid; flagged per the protocol's quarterly-refresh convention.
- **Fix:** Refresh the cited line spans in the prompt at the next prompt-refresh pass.
- **Evidence:** `requirePlanFeature` lives at `planGating.ts:131`; `validation.ts:899-902` is the `updateUserPlan` schema (verified above).

### F-5 — `normalizePlan` is the *only* guard on the VARCHAR plan column; no DB constraint — **Low**
- **Location:** `backend/prisma/schema.prisma:39` (`plan String @default("FREE") @db.VarChar(20)`); `backend/src/config/plans.ts:107-112` (`normalizePlan`); migration `backend/prisma/migrations/20260420_add_user_plan/migration.sql:13-16`.
- **Observation:** `users.plan` is a free-form `VARCHAR(20)`, not a CHECK-constrained column or native enum. The DB will accept any ≤20-char string; the migration comment states this is intentional ("future plan tiers can be added without a migration"). Application safety rests entirely on `normalizePlan` coercing unknown values to `FREE` everywhere the column is read (`planGating.ts:72`, `usageTracker.ts:76`, `planRoutes.ts:78`). This is verified to fail *down* (unknown → FREE, never up). The single realized writer (`adminRoutes.ts:621`) is itself Zod-constrained to the three valid tiers (`validation.ts:900`).
- **Impact:** Today, none — every write path validates and every read normalizes. The residual risk is a *future* writer (the narrated Stripe webhook, or a direct DBA edit) that bypasses `normalizePlan` on write and writes a garbage/typo'd tier; reads would silently treat it as FREE (fail-safe), but a `'pro'` (wrong case) or `'Premium'` would silently downgrade a paying customer. A DB-level CHECK would make the invalid write fail loudly instead.
- **Fix:** Add a `CHECK (plan IN ('FREE','PRO','TEAM'))` constraint (or keep VARCHAR but document that all writers MUST go through a single typed helper), and ensure the future Stripe webhook writes a normalized tier. Low priority because the read-side coercion already fails safe.
- **Evidence:**
  ```sql
  -- migration.sql:13-14
  ALTER TABLE "users"
    ADD COLUMN "plan" VARCHAR(20) NOT NULL DEFAULT 'FREE',
  ```
  ```ts
  // plans.ts:107-111 — only guard, fails down
  if (typeof value === 'string' && (PLAN_TIERS as readonly string[]).includes(value)) return value as PlanTier;
  return 'FREE';
  ```

## Checks passed

### 1. Authorization Integrity
- [x] Every paid feature is gated **on the route** before the handler — verified each gated route places `requirePlanLimit`/`requirePlanFeature` ahead of the controller in the chain: `aiRoutes.ts:34`, `biomarkerRoutes.ts:87,105,138`, `expenseRoutes.ts:116`, `insuranceRoutes.ts:83,126,139`, `uploadRoutes.ts:84,88,106,137,139`, `settingsRoutes.ts:80`, `fhirRoutes.ts:34,59`.
- [x] Gate→limit mapping confirmed present and correct for every entry — `aiChatsPerDay` (`aiRoutes.ts:34`), `aiGuidancePerDay` (`biomarkerRoutes.ts:138`), `maxBiomarkers` create+batch (`biomarkerRoutes.ts:87,105`), `costAnalysisPerMonth` (`expenseRoutes.ts:116`), `pdfUploadsPerMonth` (`insuranceRoutes.ts:126,139`; `uploadRoutes.ts:84,106,137`), `insurancePlans` (`insuranceRoutes.ts:83`), `maxBiomarkers` upload routes (`uploadRoutes.ts:88,139`), `healthProfile` (`settingsRoutes.ts:80`), `questFhirIntegration` (`fhirRoutes.ts:34,59`).
- [x] `insurancePlans` enforced by middleware (`insuranceRoutes.ts:83`) AND the M13 in-tx activation re-check on `isActive` false→true (`insuranceController.ts:680-691`), which returns a hand-built `PLAN_LIMIT_EXCEEDED` 403 (`:714-727`) — closing the create-inactive-then-activate bypass. Create handler relies on the gate (which counts only active plans, `insuranceController.ts:684-685`) and defaults `isActive: input.isActive ?? true` (`:565`), so the M13 backstop is necessary and present.
- [x] `maxBiomarkers` enforced on create+batch (`biomarkerRoutes.ts:87,105`) and both ingesting upload routes (`uploadRoutes.ts:88,139`); the OCR/upload insert truncates to the cap in-tx via `resolveEffectivePlan` (`upload/shared.ts:206-231`). Residual per-request overshoot documented in F-2.
- [x] `providerSharing` is `true` on every tier (`plans.ts:59,78,98`) with the 2026-06-01 product-decision comment (`:55-58`); zero `requirePlanFeature('providerSharing')` calls exist (grep returned none in routes) — deliberate non-gate, like `dataExport`, not a missing enforcement.
- [x] `requirePlanLimit` runs only after auth — each gated router calls `router.use(authenticate)` (biomarker `:48`, insurance `:64`, expense `:32`, settings `:31`, fhir `:27`) or `router.use(requireBearerAuth)` (ai `:21`); upload routes attach `authenticate` per-route before the gate (`uploadRoutes.ts:80,105,134`).
- [x] The `if (!userId) next()` bail-out (`planGating.ts:45`) cannot front a public route — every gate sits behind auth (above); no gated route is unauthenticated.

### 2. Tier Source of Truth & Self-Elevation
- [x] `users.plan` has exactly one realized writer — the admin `PATCH /users/:id/plan` (`adminRoutes.ts:598-677`, write at `:621-627`), behind `authenticate` + `blockDemoAdminAccess` + `requireRole('ADMIN')` (`:30-32`), run under `withRLSContext(null, { isAdmin:true })`. The other two admin `user.update` sites (`:324`, `:473`) write role/isActive/tokensValidAfter only, never `plan` (verified the `data` objects).
- [x] No self-service writer of `plan` — settings/health-profile/onboarding `user.update` sites (`settingsController.ts:1144,1269`, `healthProfileService.ts:105`, `onboardingService.ts:135`) write name/notification/health-profile/onboarding fields, never `plan`. The only `plan` enum in `validation.ts` is the admin-scoped `updateUserPlan:900`.
- [x] Admin plan change is audited with before/after — `auditService.logUpdate('admin_user_plan', ...)` captures `{plan, planExpiresAt}` before vs after (`adminRoutes.ts:655-669`), `previousPlan`/`newPlan` (`:666-667`), and the acting admin id (`:660`); a separate failure `logAccess` at `:643-648`.
- [x] No mass-assignment — admin update uses an explicit `data: { plan, planExpiresAt, planUpdatedAt }` (`adminRoutes.ts:623-627`), no `...req.body` spread; `plan`/`expiresAt` destructured from a Zod-validated body (`:606`, schema `validation.ts:899-902`).
- [x] JWT plan treated as untrusted — gate reads DB (`planGating.ts:66-72`) and fails CLOSED to FREE on DB error (`:76-88`), explicitly not reading `req.user.plan`. The fail-closed trade-off (deny premium during outage, never reopen) is the intended posture per the in-code comment (`:77-83`). (See F-3 on the unused snapshot.)
- [x] `normalizePlan` fails down — unknown/garbage/null → `FREE` (`plans.ts:107-111`); validated by `usageTracker.test.ts:26-27`. (See F-5 on the absent DB constraint.)

### 3. Limit-Counting Correctness & Clock/Reset
- [x] Successful AI usage IS counted with matching resourceType strings — chat success writes `'HealthGuide'`/READ (`aiChatController.ts:320`), guidance success writes `'biomarker_ai_guidance'`/READ (`biomarkerRoutes.ts:284`); the usageTracker constants match exactly (`usageTracker.ts:40-41,103,118`).
- [x] Chat blocked/failed attempts are NOT miscounted — they use `RESOURCE_TYPE_ATTEMPT = 'HealthGuideAttempt'` (`aiChatController.ts:48,150,213,353`), which the counter does not match. (The biomarker-guidance equivalent is the F-1 gap.)
- [x] Window math is UTC and server-side — `startOfTodayUTC`/`startOfMonthUTC` (`usageTracker.ts:43-52`) compute from `new Date()`; `PlanSection.tsx` labels usage as "today"/"this month" consistent with these windows.
- [x] Clock-manipulation resistant — windows derive only from server `new Date()`; no request field feeds the count window (verified `getUserUsage`/`checkPlanLimit` take only `userId`/`plan`/`action`).
- [x] KNOWN GAP acknowledged: unlimited (`-1`) tiers short-circuit the count (`usageTracker.ts:175-177`), so PRO/TEAM AI calls are bounded only by the dollar budget — and every AI route carries `aiSpendGuard` BEFORE the handler (`aiRoutes.ts:32`, `biomarkerRoutes.ts:136`, `insuranceRoutes.ts:125,138`, `uploadRoutes.ts:82,104,135`, `expenseRoutes.ts:114`). aiSpendGuard fails closed with 503 (`aiSpendGuard.ts:14-19,38-67`). Cross-link `42-ai-cost-control`.
- [x] `getUserUsage` runs all counts in one `withRLSContext` transaction via `tx.*` (`usageTracker.ts:91-126`) — no bare `prisma.*` call inside, so RLS `SET LOCAL` applies and counts can't silently fall to zero under NOBYPASSRLS.
- [x] Off-by-one correct — `allowed: current < limitValue` (`usageTracker.ts:204`); Nth use allowed, N+1th blocked, matching the `(${current}/${limit})` message (`planGating.ts:107`).
- [x] Pre-check vs action — limit checked in middleware before the action; the usage row written during/after. No double-counting confirmed; the TOCTOU race is the F-2 finding (documented in-code at `usageTracker.ts:179-198` and `planGating.ts:91-97`). Row-count-based limits naturally exclude failures: e.g. `costAnalysis` row is created only after a successful Claude call (`expenseController.ts:792-809`).

### 4. Billing Path / Realized-Revenue Gap
- [x] No payment integration exists — grep for `stripe|webhook|checkout|billing|payment` across `backend/src` and `src` returns only comments/TODOs (`plans.ts:4-6`, `adminRoutes.ts:588`, `planRoutes.ts:9-10`, `PlanSection.tsx:6-7,162`, `plan.ts:4-5`) plus unrelated insurance-domain "billing" knowledge text. Displayed `price`/`annualPrice` are display-only (`plans.ts:35`) and tie to no charge.
- [x] Price/entitlement gap documented — the "Upgrade" button only fires `onError('Upgrades are not available yet. Contact us to upgrade manually.')` (`PlanSection.tsx:158-170`); no user-facing self-activation path.
- [x] `users.plan` is set today only by the admin endpoint (`adminRoutes.ts:598-677`) or direct DB edit (per `plans.ts:5`); the admin endpoint is the only application path and is RBAC-gated (§2 above).
- [x] Future-webhook risk surface recorded — a Stripe webhook will be an unauthenticated, internet-facing, entitlement-granting endpoint requiring signature verification + idempotency + writing the same `plan`/`planExpiresAt`/`planUpdatedAt` columns. No partial/unguarded webhook scaffolding exists today (grep confirms comments only).
- [x] `planExpiresAt` enforcement is request-time only (`planGating.ts:73-75`; mirrored in `usageTracker.resolveEffectivePlan:77-79`); `emailScheduler.ts` only reads it (`:374,376,386,409,413`) to send the expiry warning, never downgrades `plan`. `planRoutes.ts` reports the EFFECTIVE (expired→FREE) tier and limits (`:78-92`) so the settings UI matches what the gate enforces.

### 5. Error Shape & Frontend CTA Contract
- [x] Gate returns HTTP 403 with `code:'PLAN_LIMIT_EXCEEDED'` + `{limit,current,feature,upgradeRequired}` (`planGating.ts:100-116`); status is 403, not 402/429; extra fields leak nothing sensitive (numeric counts + the limit key + boolean).
- [x] Distinguishable from 429/503 — `isPlanLimitError` narrows strictly on `code==='PLAN_LIMIT_EXCEEDED' && !!planLimit` (`client.ts:54-62`); a 429 or 503 lacks `planLimit` so never renders the upgrade CTA.
- [x] REST + SSE build the same `planLimit` shape — REST maps it at `client.ts:356-369`; the SSE chat path re-parses the streaming 4xx body into the identical shape (`ai.ts:135-147`).
- [x] Gated 403 never falls to the generic Forbidden toast — `HealthGuidePage.tsx:30` treats `PLAN_LIMIT_EXCEEDED` (+ `SERVICE_UNAVAILABLE`) as terminal SSE codes; `LabConnectionsSection.tsx:183-184` uses `isPlanLimitError` for the upgrade prompt; the generic `case 403` message (`client.ts:96-97`) only applies when `planLimit` is absent.
- [x] Upgrade CTA is honest about unwired billing — `PlanSection.tsx:162-163` surfaces "Upgrades are not available yet. Contact us to upgrade manually." No UI implies a working purchase flow.

### 6. Demo Accounts & Feature-Flag Alignment
- [x] Demo vs plan independence — `blockDemoAI` returns a hard 403 `ForbiddenError` (`demoProtection.ts:164-175`) regardless of plan; it stacks alongside the plan gate on AI routes (e.g. `aiRoutes.ts:33-34`). Either guard refusing is sufficient, so ordering doesn't change the outcome; a demo account is blocked from AI even if its `plan` column were elevated.
- [x] Feature flags align with route gates — `questFhirIntegration` key matches `plans.ts:28`/`61`/`80`/`99` ↔ `fhirRoutes.ts:34,59`; `healthProfile` matches `plans.ts:25`/`54`/`77`/`96` ↔ `settingsRoutes.ts:80`. The §1 reconciliations hold (insurancePlans + maxBiomarkers enforced; providerSharing intentionally ungated).
- [x] `dataExport` is `true` on every tier (`plans.ts:60,79,98`, comment "HIPAA requires this regardless of plan") and the export route is correctly NOT gated (`settingsRoutes.ts:86-90`) — a correct absence of a gate.
- [x] `healthProfile` GET ungated (`settingsRoutes.ts:66-70`) while PATCH is gated (`:76-83`) — a downgraded user can still read/export saved profile data but cannot write new profile data, matching the comment at `settingsRoutes.ts:73-75`.

## Unverifiable
- Runtime/production behavior of the documented TOCTOU race (F-2) — confirmed by code inspection and the in-code race notes, but not reproduced against a live DB; severity is assessed from the code path, not a dynamic exploit.
- Whether `users.plan` is *also* set by direct DB edits in production (Question 3 in the prompt) — not determinable from the repo; the code path is admin-only, but a DBA out-of-band edit would leave no application audit trail and is outside static-analysis reach.

## Out of scope
- The AI guard stack mechanics (`aiLimiter` → `aiSpendGuard` → `blockDemoAI` → `requirePlanLimit`) and the dollar-budget accumulator internals — owned by `27-ai-integration` and `42-ai-cost-control`; cross-linked here, presence/order of `aiSpendGuard` confirmed but its store/settle correctness is not re-audited.
- `questFhirIntegration` lab-connection specifics (OAuth token PHI, sync cost) — owned by `41-fhir-lab-integration`; only the plan-gate key alignment was checked here.
- Encryption of PHI fields the gated routes touch — owned by `02-encryption` / `_phi-inventory`.
