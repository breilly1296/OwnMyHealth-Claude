# 43-plan-gating-billing Review — 2026-06-01

Scope: subscription plan gating and billing-tier security per `prompts/43-plan-gating-billing.md`, run against the live repo at `C:/Users/breil/Projects/OwnMyHealth/`. The AI guard stack (`aiLimiter` → `aiSpendGuard` → `blockDemoAI`) and the dollar-budget governance are owned by `27-ai-integration` / `42-ai-cost-control` and are cross-linked, not re-audited here, except where this prompt's checklist explicitly requires confirming `aiSpendGuard` presence on a gated route.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 4 |
| Low | 4 |
| Info | 1 |

## Findings

### F-1 — `insurancePlans` limit counted and advertised but never enforced — **Medium**
- **Location:** `backend/src/routes/insuranceRoutes.ts:80-84` (create route); `backend/src/services/usageTracker.ts:81-83` (counter); `src/components/settings/PlanSection.tsx:35,62-63` (UI bar + over-limit copy).
- **Observation:** `POST /api/v1/insurance/plans` runs only `authenticate` + `validate(schemas.insurancePlan.create)` — there is no `requirePlanLimit('insurancePlans')`. `usageTracker` counts active plans and `PlanSection` draws a usage bar, and `overLimitMessage` even tells the user adding another plan "requires removing an existing one or upgrading", but nothing on the server blocks it. A direct grep for `requirePlanLimit('insurancePlans')` returns zero hits.
- **Impact:** A FREE user (`insurancePlans: 1`) can create unlimited active insurance plans through the API with a valid token. The displayed cap is a promise the API does not keep; entitlement enforcement is UI-only for this limit. Low PHI/abuse blast radius (each plan is the user's own data under RLS), but it is a real authorization-integrity gap and undermines the paid-tier value proposition.
- **Fix:** Add `requirePlanLimit('insurancePlans')` to the middleware chain of `POST /plans` in `insuranceRoutes.ts` (before `insuranceController.createInsurancePlan`). Decide whether re-activating a soft-deleted plan should also be gated.
- **Evidence:**
  ```ts
  // insuranceRoutes.ts:80
  router.post(
    '/plans',
    validate(schemas.insurancePlan.create),
    asyncHandler(insuranceController.createInsurancePlan)
  );
  ```

### F-2 — `maxBiomarkers` limit counted but never enforced on manual/batch entry — **Medium**
- **Location:** `backend/src/routes/biomarkerRoutes.ts:83-87` (create), `:91-96` (batch); `backend/src/services/usageTracker.ts:80` (counter); `src/components/settings/PlanSection.tsx:34,60-61`.
- **Observation:** `POST /api/v1/biomarkers` and `POST /api/v1/biomarkers/batch` carry no `requirePlanLimit('maxBiomarkers')`. `usageTracker` counts total biomarkers and `PlanSection` shows the bar plus "New uploads won't extract additional biomarkers" copy, but direct manual/batch entry is not bounded. Grep for `requirePlanLimit('maxBiomarkers')` returns zero hits, and `biomarkerController.createBiomarker`/`bulkCreateBiomarkers` contain no plan check.
- **Impact:** A FREE user (`maxBiomarkers: 50`) can store unlimited biomarkers by direct entry/batch. The PDF *upload* path is bounded by `pdfUploadsPerMonth`, but the manual write path is not, so the displayed "Biomarkers stored" cap is unenforceable through the documented gate. Same UI-only class as F-1.
- **Fix:** Add `requirePlanLimit('maxBiomarkers')` to the `POST /` and `POST /batch` chains in `biomarkerRoutes.ts`. For batch, decide whether the limit is enforced per-row or as a count-before vs. count-after check (a 49→batch-of-100 request needs an explicit policy).
- **Evidence:**
  ```ts
  // biomarkerRoutes.ts:83
  router.post(
    '/',
    validate(schemas.biomarker.create),
    asyncHandler(biomarkerController.createBiomarker)
  );
  ```

### F-3 — `providerSharing` is a paid boolean feature but no route enforces it — **Medium**
- **Location:** `backend/src/config/plans.ts:55,74,93` (`providerSharing` flag per tier); `backend/src/routes/patientRoutes.ts:180-265` (consent approve), `:328-412` (permission update), `:418-476` (revoke); `src/components/settings/PlanSection.tsx:45` (shown as a locked feature on FREE).
- **Observation:** `providerSharing` is `false` on FREE and `true` on PRO/TEAM, and the settings UI renders it in the feature list, but a repo-wide grep for `requirePlanFeature('providerSharing')` returns zero hits. The patient consent routes (`POST /providers/:id/approve`, `PATCH /providers/:id`, `revoke`, `deny`, `delete`) all run under `authenticate` + `requireRole('PATIENT')` with no plan feature gate. A FREE user can therefore approve a provider's access request and grant provider-sharing consent server-side.
- **Impact:** Either (a) a gating gap — FREE users get a "Pro" feature for free — or (b) an intentional carve-out because consent-based sharing of one's own PHI is arguably a patient right (analogous to `dataExport` being ungated). The code does not document which. Reporting per the prompt's instruction to "report whether this is intended ... but do not assume." If sharing is meant to be paid, this is an entitlement bypass; if it is a right, `plans.ts:55` is misleading and should not show it as locked.
- **Fix:** Resolve the product question (Q2 in the prompt). If paid: add `requirePlanFeature('providerSharing')` to the consent-granting routes in `patientRoutes.ts` (approve/update-permissions at minimum). If a right: change `plans.ts` so `providerSharing` is `true` across tiers (like `dataExport`) and stop rendering it as a locked Pro feature in `PlanSection.tsx:45`. Do not leave the flag and the enforcement out of sync.
- **Evidence:**
  ```ts
  // plans.ts:55 (FREE)
  providerSharing: false,
  // patientRoutes.ts:24 — only role gate, no plan feature gate
  router.use(requireRole('PATIENT'));
  ```

### F-4 — Upload routes call Claude/Document AI without `aiSpendGuard`; unbounded for TEAM tier — **Medium**
- **Location:** `backend/src/routes/uploadRoutes.ts:77-85` (lab-report), `:94-102` (insurance-sbc), `:124-132` (lab-results-ocr). Controllers that issue the external calls: `backend/src/controllers/upload/labUploadController.ts`, `backend/src/controllers/upload/sbcUploadController.ts`.
- **Observation:** These three upload endpoints apply `aiLimiter` + `blockDemoAI` + `requirePlanLimit('pdfUploadsPerMonth')` but do NOT apply `aiSpendGuard` (the file does not import it). The handlers call Claude extraction / Google Document AI. By contrast, every other AI route (`aiRoutes.ts:32`, `biomarkerRoutes.ts:123`, `expenseRoutes.ts:114`, `insuranceRoutes.ts:123,136`) carries `aiSpendGuard` before the handler. Note the *duplicate* SBC entry point `POST /api/v1/insurance/upload-sbc` (`insuranceRoutes.ts:131-140`) IS protected, but the `POST /api/v1/upload/insurance-sbc` entry point to the same handler is not.
- **Impact:** `pdfUploadsPerMonth` is `-1` (unlimited) on TEAM, so a TEAM account has no per-request cap (the count short-circuits, `usageTracker.ts:144`) AND no dollar-budget circuit breaker on these upload paths — the cost ceiling that bounds unlimited tiers on every other AI route is absent here. The prompt's §3 check ("every AI route that allows an unlimited tier also carries `aiSpendGuard` BEFORE the handler") fails for these three routes. Cross-link `42-ai-cost-control`.
- **Fix:** Add `aiSpendGuard` to the middleware chain (after `authenticate`/`aiLimiter`, before the handler) on all three upload routes in `uploadRoutes.ts`, matching the order used in `insuranceRoutes.ts:117-127`.
- **Evidence:**
  ```ts
  // uploadRoutes.ts:77-85 — chain is authenticate→aiLimiter→blockDemoAI→requirePlanLimit, no aiSpendGuard
  router.post(
    '/lab-report',
    authenticate,
    aiLimiter,
    blockDemoAI,
    requirePlanLimit('pdfUploadsPerMonth'),
    upload.single('file'),
    asyncHandler(uploadLabReport)
  );
  ```

### F-5 — BAA-blocked AI calls consume the user's daily quota (mis-counted usage) — **Low**
- **Location:** `backend/src/controllers/aiChatController.ts:129-132` (chat BAA block); `backend/src/routes/biomarkerRoutes.ts:141-143` (guidance BAA block) and `:173-177` (guidance not-found); `backend/src/services/auditLog.ts:309-323` (`logAccess` writes `action:'READ'`); `backend/src/services/usageTracker.ts:69-91` (count query).
- **Observation:** A blocked guidance/chat call still calls `auditService.logAccess(RESOURCE_TYPE, …)`, which always writes `action:'READ'` with the same `resourceType` (`'HealthGuide'` / `'biomarker_ai_guidance'`). The distinguishing `operation` (`CHAT_BLOCKED_NO_BAA`, `GUIDANCE_BLOCKED_NO_BAA`, `GUIDANCE_NOT_FOUND`) lives only in the plain-JSON `metadata` column. `usageTracker` counts purely on `resourceType + action='READ' + window` and never filters on `operation`, so a blocked or not-found request is counted as a successful use against `aiChatsPerDay` / `aiGuidancePerDay`. The prompt's §3 check ("a blocked AI call writes a different `operation`/`resourceType` so it isn't miscounted") therefore fails: it writes a different `operation` but the same `resourceType` + `action`.
- **Impact:** A user who hits the BAA-disabled or 404 path burns their daily AI quota without getting any AI output — a fairness/availability bug that slightly *over*-counts (fails safe for cost, but degrades the paid experience). Blast radius is small because the BAA flag is a global config, not per-user (when off, nothing succeeds anyway), and 404s require the user to probe their own ids; but the design does not match the prompt's stated guarantee. Note: the gate runs in middleware before these handler-level blocks, so the *check* uses the prior count; the mis-count affects the *next* request in the window.
- **Fix:** Either (a) give blocked/failed paths a distinct `resourceType` (e.g. `HealthGuide_blocked`) or a distinct `action` not in the count window, or (b) make `usageTracker`'s count queries also match on a metadata/operation discriminator for successful uses only. Option (a) is simpler and matches the prompt's intent.
- **Evidence:**
  ```ts
  // aiChatController.ts:130 — blocked path still logs action:'READ' on 'HealthGuide'
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'CHAT_BLOCKED_NO_BAA',
  });
  ```

### F-6 — TOCTOU: finite limits can be exceeded by concurrent in-flight requests — **Low**
- **Location:** `backend/src/services/usageTracker.ts:148-157` (`checkPlanLimit` read-then-allow); `backend/src/middleware/planGating.ts:87-108` (check in middleware, before the action writes its usage row).
- **Observation:** The limit is evaluated as `allowed: current < limitValue` against a count read in middleware *before* the handler runs; the usage row (audit log for AI, `userFile`/`costAnalysis` row for uploads/analysis) is written *during/after* the handler. There is no atomic reservation, lock, or unique constraint enforcing the cap. Two or more requests that arrive while `current` is still below the limit will all read the same pre-write count and all pass.
- **Impact:** A user can exceed a finite cap (e.g. `aiChatsPerDay: 3` on FREE) by the number of concurrent requests they can launch before the first one's audit row commits. For cost-bearing AI limits this means a bounded but real cost overrun; the `aiSpendGuard` dollar ceiling is the backstop for AI routes (but see F-4 for upload routes that lack it). Exploitability is modest (needs concurrency and only overshoots by the in-flight count).
- **Fix:** If strict enforcement matters for the cost-bearing limits, serialize per-user (advisory lock keyed on `userId+limitKey`) or move to an atomic increment-and-check (e.g. a counter row with a DB-side `CHECK`/conditional update) instead of count-then-allow. Otherwise document the cap as best-effort and rely on `aiSpendGuard` for the dollar bound — and close F-4 so uploads are covered.
- **Evidence:**
  ```ts
  // usageTracker.ts:153
  return {
    allowed: current < limitValue,
  ```

### F-7 — Request-time expiry downgrade is not reflected in `GET /api/v1/plan` reported limits — **Low**
- **Location:** `backend/src/routes/planRoutes.ts:72-84`. Compare with the gate's expiry handling at `backend/src/middleware/planGating.ts:73-75`.
- **Observation:** `planGating` correctly applies the `planExpiresAt` request-time downgrade (`effectivePlan = 'FREE'` when expired) before checking limits. But `GET /api/v1/plan` computes `tier = normalizePlan(row?.plan)` and returns `limits: config.limits` for that raw tier — it never applies the same expiry downgrade. It returns `expiresAt` for display, but the `limits` block (and `currentPlan`/`planName`) still reflect PRO/TEAM for an expired-but-not-yet-rewritten user.
- **Impact:** A user whose `plan` column still says `PRO` but whose `planExpiresAt` is in the past sees PRO limits and tier on the settings page, while every gated action is actually enforced at FREE limits. This is a confusing-but-not-dangerous inconsistency (enforcement is correct; only the report is optimistic). The prompt's §4 last check asks that reporting "reflect the effective (expired→FREE) limits or clearly shows the expiry" — it shows `expiresAt` but does not downgrade the reported limits.
- **Fix:** In `planRoutes.ts`, after reading `row`, apply the same `planExpiresAt < now → FREE` downgrade used in `planGating.ts:73` before deriving `config`/`limits`, or have the frontend treat an expired `expiresAt` as effective-FREE. Keep the displayed `expiresAt` so the user understands why.
- **Evidence:**
  ```ts
  // planRoutes.ts:72 — no planExpiresAt downgrade before deriving limits
  const tier = normalizePlan(row?.plan);
  const config = getPlanConfig(tier);
  ```

### F-8 — Prompt drift: minor line-number / count mismatches in the spec — **Low**
- **Location:** `prompts/43-plan-gating-billing.md` vs. the live files.
- **Observation:** The spec is overwhelmingly accurate, but two cited line numbers have drifted: (1) `planGating.ts` line citations — the spec references `:37`, `:45`, `:66`, `:73`, `:83`, `:90-104`, `:120`; in the live file the gate function is `requirePlanLimit` at `:37`, bail-out at `:45`, DB read at `:66`, expiry at `:73`, JWT fallback at `:83`, the 403 body spans `:90-104`, and the alias is at `:120` — all confirmed accurate. (2) `usageTracker.ts` citations: the spec says `NUMERIC_LIMIT_TO_USAGE` at `:111` (live: `:111` ✔), short-circuit at `:144` (live: `:144` ✔), `withRLSContext` at `:60` (live: `:60` ✔), off-by-one at `:153` (live: `:153` ✔). I found no incorrect line citations in this prompt during the audit; the items I expected to drift did not. The only genuine drift is in `_phi-inventory`/`CLAUDE.md` cross-refs unrelated to this domain. Recording as Low per protocol so the quarterly refresh can confirm.
- **Impact:** None functional. The spec is current as of 2026-06-01; this finding exists only to satisfy the protocol's "trust the code, record drift" rule and to note that no material drift was found in the plan-gating prompt itself.
- **Fix:** No change required for this prompt. (If anything, mark the prompt as verified-current on 2026-06-01.)
- **Evidence:**
  ```ts
  // planGating.ts:37 — matches spec exactly
  export function requirePlanLimit(limitKey: keyof PlanLimits) {
  ```

### F-9 — Future Stripe webhook will be an unauthenticated entitlement-granting endpoint (record-now) — **Info**
- **Location:** `backend/src/config/plans.ts:5-6`; `backend/prisma/migrations/20260420_add_user_plan/migration.sql:8-10`; `backend/src/routes/planRoutes.ts:9-11`; `backend/src/routes/adminRoutes.ts:553-554`.
- **Observation:** No payment integration exists today (confirmed: grep `stripe|webhook|checkout|billing|payment` across `backend/src/` and `src/` returns only comments/TODOs and unrelated insurance-knowledge text). Multiple comments narrate a future Stripe webhook that "will update the same `users.plan` column." No webhook scaffolding — guarded or unguarded — is present.
- **Impact:** None today. Recorded so it is not missed when wired: a Stripe webhook is internet-facing, unauthenticated by session, and grants paid entitlements, so when added it MUST have Stripe signature verification, idempotency keys, and must write the same `plan`/`planExpiresAt`/`planUpdatedAt` columns the admin path uses (no body spread). Flag any partial scaffolding the moment it appears.
- **Fix:** Add the webhook controls above when billing lands; no action required now beyond tracking.
- **Evidence:**
  ```ts
  // plans.ts:5
  * manually via the admin panel or a direct DB update. When Stripe is added,
  * its webhook handler will update the same `users.plan` column.
  ```

## Checks passed

### 1. Authorization Integrity
- [x] Each gated route runs the gate in the middleware chain BEFORE the handler — verified `aiRoutes.ts:34`, `biomarkerRoutes.ts:125`, `expenseRoutes.ts:116`, `insuranceRoutes.ts:124,137`, `uploadRoutes.ts:82,99,129`, `settingsRoutes.ts:80`, `fhirRoutes.ts:34,47` (each `requirePlan*` precedes `asyncHandler(handler)`).
- [x] Gate→limit mapping confirmed exactly as the spec enumerates — `aiChatsPerDay` (`aiRoutes.ts:34`), `aiGuidancePerDay` (`biomarkerRoutes.ts:125`), `costAnalysisPerMonth` (`expenseRoutes.ts:116`), `pdfUploadsPerMonth` (`insuranceRoutes.ts:124,137`; `uploadRoutes.ts:82,99,129`), `healthProfile` (`settingsRoutes.ts:80`), `questFhirIntegration` (`fhirRoutes.ts:34,47`).
- [x] `requirePlanLimit` only runs after auth — `biomarkerRoutes.ts:47`, `expenseRoutes.ts:32`, `insuranceRoutes.ts:64`, `settingsRoutes.ts:31`, `fhirRoutes.ts:27` all `router.use(authenticate)` first; `aiRoutes.ts:21` uses `router.use(requireBearerAuth)`; `uploadRoutes.ts:79,97,127` place `authenticate` first on each route.
- [x] The `if (!userId) next()` bail-out (`planGating.ts:45`) cannot be reached on a gated route, because every gated route is fronted by `authenticate`/`requireBearerAuth` (above), which 401s an unauthenticated request before the gate runs.

### 2. Tier Source of Truth & Self-Elevation
- [x] `users.plan` has exactly one realized writer — the admin endpoint; the `tx.user.update` write is at `adminRoutes.ts:587`, behind `requireRole('ADMIN')` + `blockDemoAdminAccess` (`adminRoutes.ts:30-31`), under `withRLSContext(null, { isAdmin: true })` (`:576,605`).
- [x] No self-service writer of `plan` — the only other `tx.user.update` calls (`settingsController.ts:1065`, `:1190`) write `firstName/lastName/notificationPreferences` only via explicit `data:` objects, no `plan` field, no body spread; the only `plan` enum in `validation.ts` is `schemas.admin.updateUserPlan:782`.
- [x] Admin plan change is audited with before/after + acting admin — `adminRoutes.ts:621` `logUpdate('admin_user_plan', …)` captures `previousPlan`/`newPlan` (`:632-633`) and `userId: adminId` (`:626`).
- [x] No mass-assignment — admin update uses explicit `data: { plan, planExpiresAt, planUpdatedAt }` (`adminRoutes.ts:589-593`), no `...req.body` spread.
- [x] JWT `plan` treated as untrusted stale snapshot — gate reads DB (`planGating.ts:66`) and only falls back to JWT on DB error (`:83`); `auth.ts:107,157,207` populate `req.user.plan` from `decoded.plan || 'FREE'`.
- [x] `normalizePlan` fails *down* to FREE for unknown/garbage values (`plans.ts:103-108`); the VARCHAR column (`schema.prisma:34`) is not DB-constrained, so this function is the only guard — and it cannot escalate.

### 3. Limit-Counting Correctness & Clock/Reset Semantics
- [x] Resource-type strings match the writers — `usageTracker.ts:38-39` uses `'HealthGuide'` / `'biomarker_ai_guidance'`; `aiChatController.ts:38` `RESOURCE_TYPE='HealthGuide'`, successful write at `:260`; biomarker guidance writes `'biomarker_ai_guidance'` at `biomarkerRoutes.ts:266`. (Counting deflation by blocked/failed calls is the *exception* — see F-5.)
- [x] Window math is UTC and server-side — `startOfTodayUTC` (`usageTracker.ts:41-45`) and `startOfMonthUTC` (`:47-50`) compute from `new Date()`; no request field influences the window (clock-manipulation resistant). `PlanSection.tsx:29-36` labels rows "today"/"this month"/"total" consistent with these windows.
- [x] Unlimited tiers short-circuit the count (`usageTracker.ts:144`); the dollar budget (`aiSpendGuard`, `AI_DAILY_BUDGET_USD`/`AI_USER_DAILY_BUDGET_USD` defaults 50/5 at `config/index.ts:196-197`) bounds them on the AI routes that carry the guard (the upload-route exception is F-4).
- [x] `getUserUsage` runs all counts in one `withRLSContext(userId)` transaction (`usageTracker.ts:60-105`) via `tx.*` — no bare `prisma.*` call inside, so RLS context is carried and counts aren't silently zeroed.
- [x] Off-by-one boundary is intentional — `allowed: current < limitValue` (`usageTracker.ts:153`); the Nth use passes, the N+1th is blocked, matching the `(${current}/${limit})` message in `planGating.ts:96`.

### 4. Billing Path / Realized-Revenue Gap
- [x] No payment integration — grep `stripe|webhook|checkout|billing|payment` over `backend/src/` + `src/` yields only comments/TODOs (`plans.ts:4-6,35`, `migration.sql:8-10`, `planRoutes.ts:9-11`, `adminRoutes.ts:554`, `PlanSection.tsx:157`) and unrelated insurance-knowledge prose. Displayed `price`/`annualPrice` (`plans.ts:64,65,88,89`) are decorative.
- [x] Upgrade button is a placeholder — `PlanSection.tsx:156-158` fires `onError('Upgrades are not available yet. Contact us to upgrade manually.')`; no working checkout.
- [x] `users.plan` set today only via admin `PATCH /users/:id/plan` (RBAC-gated) or direct DB edit (per `plans.ts:5` comment); the admin endpoint is the only application path.
- [x] `planExpiresAt` enforcement is request-time only — `planGating.ts:73-75` downgrades to FREE when expired; `emailScheduler.ts:241-273` only *reads* `planExpiresAt` to send the warning and never writes `plan`. (Reporting inconsistency in `planRoutes` is F-7.)

### 5. Error Shape & Frontend CTA Contract
- [x] Gate returns HTTP 403 with `code:'PLAN_LIMIT_EXCEEDED'` + `{ limit, current, feature, upgradeRequired }` — `planGating.ts:90-104`, status set at `:104`; no sensitive data in the extra fields.
- [x] `isPlanLimitError` narrows strictly on `code==='PLAN_LIMIT_EXCEEDED'` AND `!!planLimit` (`client.ts:55-62`), so a 429/503 never renders the upgrade CTA.
- [x] REST maps the body into `apiError.planLimit` (`client.ts:328-341`); the SSE chat path re-parses the same shape off the streaming 4xx body (`ai.ts:135-141`) — both surfaces build an identical `planLimit`.
- [x] A gated 403 does not fall through to the generic FORBIDDEN toast — the planLimit branch (`client.ts:328`) attaches structured context; `HealthGuidePage.tsx:30` treats `PLAN_LIMIT_EXCEEDED` as terminal; `LabConnectionsSection.tsx:178` routes it to an upgrade prompt.
- [x] CTA is honest about unwired billing — `PlanSection.tsx:157` (above); no UI implies a working purchase flow.

### 6. Demo Accounts & Feature-Flag Alignment
- [x] `blockDemoAI` returns a hard 403 `ForbiddenError` independent of plan — `demoProtection.ts:164-175`; stacked alongside the plan gate on AI routes (`aiRoutes.ts:33-34`, `biomarkerRoutes.ts:124-125`, `expenseRoutes.ts:115-116`, `insuranceRoutes.ts:120,133`, `fhirRoutes.ts:33-34,47`). Either guard refusing is sufficient, so ordering doesn't change the outcome.
- [x] FHIR feature flag and route gate use the same key — `plans.ts:28` `questFhirIntegration` ↔ `fhirRoutes.ts:34,47` `requirePlanFeature('questFhirIntegration')`; `healthProfile` (`plans.ts:25`) ↔ `settingsRoutes.ts:80`.
- [x] `dataExport` correctly ungated — `plans.ts:56` `true` on every tier ("HIPAA requires this regardless of plan"); `settingsRoutes.ts:86-90` `GET /export-data` has no plan gate. Correct absence of a gate.
- [x] `healthProfile` GET ungated, PATCH gated — `settingsRoutes.ts:66-70` (GET, no gate) vs `:76-83` (PATCH, `requirePlanFeature('healthProfile')`), matching the comment at `:73-75`: a downgraded user can read/export prior data but cannot write new profile data.

## Unverifiable
- None. Every file, function, constant, and line the spec names was located and confirmed in the live repo. (No `npm audit`/`npm outdated`/`git` step was required by this spec; the domain is code-structural, not dependency-driven.)

## Out of scope
- The AI guard stack internals (`aiLimiter`, `aiSpendGuard` accumulator correctness, per-instance budget under Cloud Run autoscale) — owned by `27-ai-integration` and `42-ai-cost-control`; this review only confirmed `aiSpendGuard` *presence/absence* on gated routes (F-4) as the prompt's §3 check requires.
- The 429 rate-limit path (`rateLimiter.ts`) and the 503 BAA/spend refusals beyond confirming they are distinguishable from the 403 plan gate — owned by `08-rate-limiting`.
- PHI encryption of fields read/written by the gated routes — owned by `02-encryption` / `_phi-inventory`; the gate itself reads only `plan`/`planExpiresAt` (non-PHI metadata).
- The FHIR/Quest lab-connection mechanics behind `questFhirIntegration` — owned by `41-fhir-lab-integration`; only the gate-key alignment was checked here.
- Provider-side routes (`providerRoutes.ts`) consent enforcement detail beyond the `providerSharing` flag question (F-3) — the consent-grant write lives on the patient side, which was audited.
