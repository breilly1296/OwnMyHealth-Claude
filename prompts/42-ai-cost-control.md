---
tags:
  - security
  - ai-cost
  - high
type: prompt
priority: 2
updated: 2026-06-16
---

# AI Cost & Spend-Control Security Review

This is the deep, single-domain owner for the **dollar / usage governance** of
the Claude integration: cost accounting, the spend circuit breaker, per-user
plan-limit counting, and where the ceilings leak. The *basics* of the AI
integration (BAA gate, PHI-in-prompt minimization, the shared client, prompt
injection) are owned by [[27-ai-integration]] and surveyed by [[09-external-apis]] —
this prompt cross-links them and does NOT re-audit them. Treat a runaway
Anthropic bill, a silently-broken plan counter, or an unguarded paid route as
the in-scope failures here.

## Files to Review
- `backend/src/services/aiCostTracker.ts` (the heart of this domain — token→USD pricing table `PRICING` with the sonnet fallback (`aiCostTracker.ts:303`); a **pluggable** `SpendStore` interface (`aiCostTracker.ts:86-90`) with two impls: `InMemorySpendStore` (private `global`/`users`; methods `roll()` line 100, `admit()` line 109, `record()` line 151, `reset()`, `snapshot()`) and `RedisSpendStore` (line 172; same reserve-first semantics via atomic `INCRBYFLOAT`); store selection memoized in `getStore()` (line 257); public API is `admitAISpend(userId)` returning `Admission{admitted,scope,settle}` (line 285), `trackAIUsage` (line 302), `RESERVATION_USD = 0.05` (line 67), `__resetAISpendForTests`. The legacy `globalSpentUsd`/`userSpentUsd`/`rollIfNewDay`/`recordSpend`/`isAISpendExceeded`/`reserveAISpend` symbols are GONE — do not look for them)
- `backend/src/middleware/aiSpendGuard.ts` (the dollar circuit breaker — `aiSpendGuard`; calls `admitAISpend(userId)` (line 37) — the atomic reserve+check — NOT the deleted `isAISpendExceeded`; fails closed with `ServiceUnavailableError` 503 on a store error (line 47) and on budget reached (line 61); bails to `next()` when `req.user?.id` is absent (line 30); registers `admission.settle` on `res` `finish`/`close` (lines 74-75) to back the reservation out)
- `backend/src/services/usageTracker.ts` (per-user plan-limit counters — `getUserUsage` (line 87), `checkPlanLimit` (line 156); `RESOURCE_HEALTH_GUIDE = 'HealthGuide'` (line 40), `RESOURCE_BIOMARKER_GUIDANCE = 'biomarker_ai_guidance'` (line 41); `NUMERIC_LIMIT_TO_USAGE` map, line 142)
- `backend/src/middleware/planGating.ts` (`requirePlanLimit` (line 37) — fresh DB plan read under RLS, `planExpiresAt` runtime downgrade to FREE, 403 `PLAN_LIMIT_EXCEEDED`; on a DB-lookup error it fails **CLOSED to FREE** (`effectivePlan = 'FREE'`, lines 76-88), deliberately NOT trusting the more-permissive JWT snapshot — the catch comment explicitly rejects the JWT path)
- `backend/src/middleware/rateLimiter.ts` (`aiLimiter` (line 177) — 10 AI req/hour, user-keyed via `keyGenerator` line 190; per-instance `MemoryStore` unless `REDIS_URL` set, store comment lines 56-63; the 429 is emitted via `options.statusCode` in `makeRateLimitHandler` line 53)
- `backend/src/middleware/demoProtection.ts` (`blockDemoAI` (line 164) — 403 to prevent anonymous cost generation from the demo account)
- `backend/src/config/index.ts` (`config.ai.dailyBudgetUsd` / `config.ai.userDailyBudgetUsd`, lines 256-257, defaults 50 / 5, parsed by `parseBudget(...)` which warns + falls back to the default on NaN/negative; `config.anthropic.baaActive`, line 245; `config.redis.url`, line 186)
- `backend/src/config/plans.ts` (`PlanLimits` shape line 18; per-tier `aiChatsPerDay`, `aiGuidancePerDay`, `costAnalysisPerMonth`, `pdfUploadsPerMonth`; `isUnlimited` `-1`, line 122; `normalizePlan`)
- `backend/src/services/anthropicClient.ts` (shared lazy SDK singleton — `getAnthropicClient`, `isEnabled`; cost/spend logic lives elsewhere, but every metered call flows through here)
- `backend/src/services/auditLog.ts` (`logAccess` (line 373) always writes `action: 'READ'` (line 383) — the rows `usageTracker` counts for chat + guidance)

### Claude call sites — every one must call `trackAIUsage`
- `backend/src/controllers/aiChatController.ts` (`handleAIChat` — `trackAIUsage` line 308, `MODEL = claude-haiku-4-5-20251001`; SUCCESS audits `HealthGuide`/`READ` via `RESOURCE_TYPE` (line 320); L33 server-side disclaimer appended via `disclaimerToAppend()` (line 289))
- `backend/src/routes/biomarkerRoutes.ts` (inline `POST /:id/guidance` handler — `trackAIUsage` line 267, gated by `aiSpendGuard` line 136; audits `biomarker_ai_guidance`/`READ` (success at line 284); L33 disclaimer via `disclaimerToAppend()` (line 260))
- `backend/src/controllers/expenseController.ts` (`analyzeCosts` line 667 — `trackAIUsage` line 779, `claude-sonnet-4-5-20250929`; plan count read from `costAnalysis` table, NOT audit rows; `costAnalysis.create` at line 793)
- `backend/src/services/claudeExtraction.ts` (lab-report extraction — `trackAIUsage` line 170; called from `POST /upload/lab-report`)
- `backend/src/services/sbcExtraction.ts` (SBC extraction — `trackAIUsage` line 847; called from `upload-sbc` / `reanalyze`)

### Routes that carry the AI guard stack
- `backend/src/routes/aiRoutes.ts` (`POST /chat` — mounted under `router.use(requireBearerAuth)` (line 21), Bearer-ONLY / CSRF-exempt for SSE (NOT `authenticate`) — a material auth-model fact, since it changes how `aiSpendGuard` resolves `req.user`; stack `aiLimiter` → `aiSpendGuard` → `blockDemoAI` → `requirePlanLimit('aiChatsPerDay')` → `validate`, lines 29-37)
- `backend/src/routes/expenseRoutes.ts` (`POST /analyze` — full stack incl. `aiSpendGuard` line 114, route lines 111-119)
- `backend/src/routes/insuranceRoutes.ts` (`upload-sbc` `aiSpendGuard` line 138 (route 133-141) and `plans/:id/reanalyze` `aiSpendGuard` line 125 (route 119-128) — both carry `aiSpendGuard`)
- `backend/src/routes/biomarkerRoutes.ts` (`POST /:id/guidance` — full stack incl. `aiSpendGuard` line 136, `requirePlanLimit('aiGuidancePerDay')` line 138, guard stack lines 133-139)
- `backend/src/routes/uploadRoutes.ts` (`lab-report` `aiSpendGuard` line 82 (+ `requirePlanLimit('maxBiomarkers')` line 88, the M12 in-handler-plus-middleware gate), `insurance-sbc` line 104, `lab-results-ocr` line 135 (+ `maxBiomarkers` line 139) — all carry `aiLimiter` + `aiSpendGuard` + `requirePlanLimit('pdfUploadsPerMonth')`; the earlier `no aiSpendGuard` gap on these three was closed, so **all eight** Claude-spending routes now carry the dollar breaker)
- `backend/src/routes/healthGoalsRoutes.ts` (`GET /suggestions` — `aiLimiter` only, line 48)
- `backend/src/routes/healthNeedsRoutes.ts` (`GET /analyze` — `aiLimiter` only, line 49)

### Frontend
- `src/services/api/ai.ts` (`aiApi.chat` — SSE client; reads `usage.input_tokens`/`output_tokens` from `message_stop`, and decodes the 403 `PLAN_LIMIT_EXCEEDED` body into an upgrade CTA, lines 135-147)

> NOTE: there is no schema/migration that owns spend state. The accumulator is
> per-process memory in `aiCostTracker.ts` BY DEFAULT, but it is now pluggable
> (M11/L33): when `REDIS_URL` is set it uses a shared Redis store (the same
> Memorystore + ioredis connection the rate limiters use), so the daily cap is
> consistent across Cloud Run instances instead of N×budget. The atomic gate
> (`admitAISpend`) reserves + checks in one `INCRBYFLOAT`-then-compare-and-refund
> per key, and fails CLOSED (503) on a store error. Plan-limit counts are still
> derived from existing tables (`AuditLog`, `UserFile`, `Biomarker`,
> `InsurancePlan`, `CostAnalysis`), so no new migration backs this domain.

## OwnMyHealth AI Cost-Control Architecture

There are **two independent governors** on AI usage, and they answer different
questions. Confusing them is the most common review mistake here.

- **Per-user request quotas (plan limits)** — "has this user used their N chats
  today?" Enforced by `requirePlanLimit(limitKey)` (`planGating.ts`) →
  `usageTracker.checkPlanLimit` → counts rows under RLS. Numeric limits live in
  `plans.ts`; `-1` means unlimited and short-circuits the DB count. On breach:
  **403 `PLAN_LIMIT_EXCEEDED`** with `upgradeRequired: true`. This is a *product
  / billing* gate, not a dollar gate — an unlimited (`-1`) tier sails straight
  through it.
- **The dollar circuit breaker (spend budget)** — "has spend exceeded the daily
  USD budget?" Enforced by `aiSpendGuard` middleware →
  `admitAISpend(userId)` (`aiCostTracker.ts:285`) — an atomic reserve+check (the
  former `isAISpendExceeded` was deleted). Two scopes: global
  (`AI_DAILY_BUDGET_USD`, default 50) and per-user (`AI_USER_DAILY_BUDGET_USD`,
  default 5); a budget of `0` disables that scope. On breach: **503
  `SERVICE_UNAVAILABLE`** (distinct from the 429 `aiLimiter` returns and the 403
  plan gate returns — three different status codes for three different limits).
  This is the backstop that bounds unlimited-tier and compromised-key abuse that
  the plan quotas cannot.

How the spend number is computed and stored:

- `trackAIUsage({ endpoint, model, inputTokens, outputTokens, userId })` is
  called **after** each successful Claude response. It looks up the model in
  `PRICING` (per-token input/output rates) and falls back to
  `claude-sonnet-4-5-20250929` pricing for any unknown model id
  (`aiCostTracker.ts:303`). The estimated USD is added to the spend store via
  `SpendStore.record()` (`InMemorySpendStore.record` line 151 / `RedisSpendStore.record`
  line 234, both updating global + per-user) and emitted to the `AICost` structured logger.
- The default store is **process memory** (`InMemorySpendStore`): a global running
  total plus a per-user `Map`, rolled per UTC day by `roll()` (`aiCostTracker.ts:100`)
  which compares the current UTC `YYYY-MM-DD` (`utcDayKey()`, line 76) against the
  stored `dayKey` and zeroes both totals on the first call of a new UTC day. When
  `config.redis.url` is set, `getStore()` (line 257) selects `RedisSpendStore`
  instead — a SHARED store keyed `ai:spend:g|u:...:YYYY-MM-DD` so the cap is
  consistent across instances, reusing the same ioredis connection the rate
  limiters use (see [[08-rate-limiting]], `rateLimiter.ts:56-63`).
- `aiSpendGuard` `admit()`s **before** the call: it optimistically reserves a
  fixed `RESERVATION_USD = 0.05` (`aiCostTracker.ts:67`) so N concurrent requests
  can't all observe "under budget" before any records a cost, then `settle()`s
  (refunds the reservation) on response `finish`/`close` while `trackAIUsage`
  adds the real cost. The in-flight call's real cost still isn't known until it
  returns, so a single call can push slightly past the cap, but the reservation
  bounds concurrent overshoot to the per-request estimate rather than (N-1) full calls.

Where the two governors meet the data:

- Plan-limit counts for **chat** and **biomarker guidance** are derived from
  `AuditLog` rows: `usageTracker.getUserUsage` (line 87) counts rows where
  `resourceType === 'HealthGuide'` (chat) or `'biomarker_ai_guidance'` (guidance)
  AND `action === 'READ'` for today (UTC). `logAccess` (line 373) always stamps
  `action: 'READ'` (`auditLog.ts:383`) and passes `resourceType` verbatim, so
  the SUCCESS-path writer strings in `aiChatController` (`RESOURCE_TYPE = 'HealthGuide'`,
  line 39) and `biomarkerRoutes` (`'biomarker_ai_guidance'`, lines 154/187/284)
  MUST byte-match the constants in `usageTracker.ts:40-41`. A typo on either side
  silently zeroes the counter — the user gets unlimited "free" chats and the
  gate never fires. (NOTE: blocked/failed/initiated attempts are now logged under
  a SEPARATE `RESOURCE_TYPE_ATTEMPT = 'HealthGuideAttempt'` resourceType the
  counter does NOT match — see §5 EDGE CASE.)
- Cost-analysis count is read from a **real table** (`tx.costAnalysis.count`,
  `usageTracker.ts:123`), not audit rows — so it is immune to the resourceType
  drift above. PDF upload count is read from `tx.userFile.count`
  (`usageTracker.ts:108`).

PHI / secrets posture for this domain: the cost path handles **token counts and
USD only** — no PHI flows through `aiCostTracker`. The accumulator stores a
`userId` key and a float; the `AICost` log line includes `userId` but no prompt,
response, or health values. The Anthropic key itself is owned by
[[11-environment-secrets]] and [[27-ai-integration]].

## Checklist

### 1. Cost-accounting correctness (`trackAIUsage` on every metered call)
- [ ] `trackAIUsage` is called on EVERY successful Claude response — confirm all five call sites fire it: chat (`aiChatController.ts:308`), biomarker guidance (`biomarkerRoutes.ts:267`), cost analysis (`expenseController.ts:779`), lab extraction (`claudeExtraction.ts:170`), SBC extraction (`sbcExtraction.ts:847`). A call site that skips it under-reports spend and lets the budget run hot.
- [ ] The token counts passed are the **actual** usage from the response (`response.usage.input_tokens` / `output_tokens`), not estimates — verify each call site reads `response.usage` (chat reads `finalMessage.usage`, `aiChatController.ts:298-299`).
- [ ] Each call site passes the **real authenticated `userId`**, never a hardcoded `'system'` — the per-user budget and per-user log attribution depend on it (see the regression test `claudeExtraction.test.ts:184-193`).
- [ ] `PRICING` rates match current Anthropic pricing for the models actually in use (`claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`, `aiCostTracker.ts:33-36`); stale rates make the budget a fiction.
- [ ] The unknown-model fallback (`PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929']`, `aiCostTracker.ts:303`) errs **expensive** (sonnet > haiku) so a model-id change never silently under-counts — confirm the fallback model is the most expensive in the table, not the cheapest.
- [ ] `estimatedCostUsd` is logged with enough precision to be summable (`toFixed(6)`, `aiCostTracker.ts:320`) and emitted under the `AICost` service logger so spend can be aggregated downstream.
- [ ] `SpendStore.record()` increments BOTH the global total and the per-user entry (`InMemorySpendStore.record` `aiCostTracker.ts:151-155`; `RedisSpendStore.record` `aiCostTracker.ts:234-237`) — a path that updates only one breaks one of the two scopes. (The old `recordSpend`/`globalSpentUsd`/`userSpentUsd` symbols no longer exist.)

### 2. Spend-guard route coverage (GAP CLOSED — verify it stays closed)
- [ ] Enumerate the AI routes that carry `aiSpendGuard`. As of 2026-06-13 there are **eight** — the original five plus the three Claude-backed upload routes whose gap was closed: `POST /biomarkers/:id/guidance` (`biomarkerRoutes.ts:136`), `POST /expenses/analyze` (`expenseRoutes.ts:114`), `POST /ai/chat` (`aiRoutes.ts:32`), `POST /insurance/upload-sbc` (`insuranceRoutes.ts:138`), `PUT /insurance/plans/:id/reanalyze` (`insuranceRoutes.ts:125`), and `POST /upload/lab-report` (`uploadRoutes.ts:82`), `POST /upload/insurance-sbc` (`uploadRoutes.ts:104`), `POST /upload/lab-results-ocr` (`uploadRoutes.ts:135`). NOTE: the two biomarker-ingesting upload routes (`lab-report`, `lab-results-ocr`) ALSO carry `requirePlanLimit('maxBiomarkers')` (M12, `uploadRoutes.ts:88`/`:139`) on top of `pdfUploadsPerMonth`.
- [ ] (Historical) The three `/upload/*` routes once carried `aiLimiter` + `requirePlanLimit('pdfUploadsPerMonth')` but NOT `aiSpendGuard`; that gap is now closed, so every route that reaches `claudeExtraction`/`sbcExtraction`/OCR-Claude is dollar-capped. Verify a new upload/AI route never reintroduces the gap.
- [ ] The earlier SBC asymmetry (`/insurance/upload-sbc` guarded, `/upload/insurance-sbc` unguarded) is resolved — both paths now carry `aiSpendGuard`.
- [ ] Multi-instance (M11/L33): the dollar cap is per-process in memory BY DEFAULT (effective ceiling N×budget under autoscale) UNLESS `REDIS_URL` is set, in which case `aiCostTracker` uses a shared Redis store (atomic `INCRBYFLOAT` gate) so the cap is consistent across instances. The rate limiters share the same switch (`rateLimitStore.ts`). Provisioning Cloud Memorystore + setting `REDIS_URL` is the single infra step that makes BOTH cross-instance.
- [ ] Verify `aiLimiter` and `requirePlanLimit('pdfUploadsPerMonth')` are present on every unguarded upload route, since they are the ONLY cost controls there (rate + per-user monthly count, no global dollar ceiling).
- [ ] FLAG / verify: `GET /health-goals/suggestions` (`healthGoalsRoutes.ts:48`) and `GET /health-needs/analyze` (`healthNeedsRoutes.ts:49`) carry `aiLimiter` but no `aiSpendGuard`. As of 2026-06-01 their controllers (`healthGoalsController`, `healthNeedsController`) do **not** import the Anthropic client and do not call Claude — so they accrue no Claude spend today. If a future change wires Claude into either handler, they would become Claude-backed routes with no dollar cap. Re-confirm they are still non-Claude before clearing this item.
- [ ] The intended full AI guard order is `aiLimiter` → `aiSpendGuard` → `blockDemoAI` → `requirePlanLimit(...)` → `validate(...)` (see `aiRoutes.ts`); confirm each guarded route preserves it. Note `insuranceRoutes` orders the upload guards differently (`blockDemoAI` → `uploadLimiter` → `aiLimiter` → `aiSpendGuard` → `requirePlanLimit`, reanalyze lines 119-128 / upload-sbc lines 133-141) — verify the ordering is still safe (spend guard still runs after `authenticate` so `req.user` resolves).

### 3. Circuit-breaker behavior & response codes
- [ ] `aiSpendGuard` fails **closed** with **503 `SERVICE_UNAVAILABLE`** (via `ServiceUnavailableError`), on BOTH a store error (`aiSpendGuard.ts:47`) and budget reached (`aiSpendGuard.ts:61`), NOT 429 — 429 is `aiLimiter`'s rate-limit code (emitted via `options.statusCode` in `makeRateLimitHandler`, `rateLimiter.ts:53`) and 403 is the plan gate's code. Confirm the three governors return three distinct codes so the client can tell them apart.
- [ ] The atomic gate `admitAISpend` (in both `InMemorySpendStore`/`RedisSpendStore`) checks **global before per-user** and returns the offending `scope`; the middleware uses `scope` to pick a global vs. per-user message (`aiSpendGuard.ts:60-66`). Verify the per-user message says "try again tomorrow" and the global says "temporarily unavailable" — they imply different remediation. (Replaces the former separate `isAISpendExceeded` + `reserveAISpend` calls, which had a cross-instance check-then-reserve race; the gate is now one atomic reserve+check.)
- [ ] A budget of `0` disables that scope (the `> 0` guards in `admit()`, e.g. `aiCostTracker.ts:130`/`:134`). Confirm `config.ai.dailyBudgetUsd` / `userDailyBudgetUsd` (`config/index.ts:256-257`) are not accidentally `0`/`NaN` in any deployed env — the budgets are now parsed by `parseBudget(value, default, name)`, which **warns and falls back to the default** on NaN/negative input rather than silently producing `NaN` (the old raw `Number(... ?? '50')` that would yield `NaN > 0 === false` and silently disable the cap is gone).
- [ ] `aiSpendGuard` calls `next()` (allows the request) when `req.user?.id` is absent (`aiSpendGuard.ts:30`). Confirm it always runs AFTER `authenticate`/`requireBearerAuth` so an unauthenticated request can't slip past — and note that even so, the *global* cap still applies on the next authenticated request.
- [ ] The per-UTC-day reset is driven by `roll()` (`InMemorySpendStore.roll`, `aiCostTracker.ts:100-107`), which compares `utcDayKey()` (`aiCostTracker.ts:76-78`, `toISOString().slice(0,10)` — UTC, so the window doesn't drift with server timezone) against the stored `dayKey`; `admit()` and `record()` both call `roll()` before touching the totals so a stale day's total can't block a fresh day. (Redis keys are UTC-day-stamped and self-expire via a 48h TTL.)

### 4. In-memory / per-instance ceiling (KNOWN LIMITATION — do not soften)
- [ ] The spend accumulator is **in-memory, per-instance BY DEFAULT** (`InMemorySpendStore`, `aiCostTracker.ts:95-167`) — but this ceiling only applies when `REDIS_URL` is unset. Under Cloud Run autoscale with N instances the default effective ceiling is **N × budget** — each instance tracks its own total. Confirm this is bounded by an explicit `--max-instances` pin and that the resulting worst-case daily spend (N × `AI_DAILY_BUDGET_USD`) is an acceptable billing exposure, OR that `REDIS_URL` is provisioned (see next item).
- [ ] State is lost on instance restart/redeploy in the in-memory path — a scale event or deploy resets every instance's running total to `0` mid-day, so the real daily ceiling can exceed N × budget across the day. Confirm this is understood and acceptable, or that the shared Redis store is in use.
- [ ] Spend is recorded **post-call** by `trackAIUsage` while `admit()` reserves a fixed `RESERVATION_USD` pre-call (`aiCostTracker.ts:67`, `Admission` docs `aiCostTracker.ts:48-58`). A single runaway loop on one instance is bounded by the reservation + the *next* call's refusal — verify there is no path that fires many concurrent Claude calls outside the `aiSpendGuard`/`admitAISpend` reserve path (e.g. a `Promise.all` fan-out of AI calls that skips the middleware).
- [ ] RESOLVED (verify it stays wired): `aiCostTracker` NOW consumes `config.redis.url` — `getStore()` (`aiCostTracker.ts:257-274`) selects `RedisSpendStore` when `config.redis.url` is set (line 259), importing `getRedisClient` from `rateLimitStore` (line 28), so the cap goes cross-instance with the rate limiters via a single infra switch (set `REDIS_URL` + provision Cloud Memorystore). On `REDIS_URL` set but client-unavailable it logs and falls back to per-instance memory rather than crashing (`aiCostTracker.ts:266-271`). If `aiSpendGuard` is the billing backstop, confirm `REDIS_URL` is actually set in prod so the cap is shared.

### 5. Per-user plan-limit counting (resourceType string agreement)
> The plan-limit *governor* (tiers, `requirePlanLimit`, the 403 error contract, the
> Stripe/billing path that isn't wired yet) is the deep domain of
> [[43-plan-gating-billing]]; this section audits ONLY the slice where plan limits
> meet AI spend (the audit-row counter that backs `aiChatsToday`/`aiGuidanceToday`,
> and whether unlimited tiers are still bounded by the §3 dollar cap). Cross-link
> 43 rather than re-auditing the gate itself.
- [ ] The audit `resourceType` strings MUST agree between writers and `usageTracker`, or plan-limit counting silently breaks. Verify: chat SUCCESS writer `RESOURCE_TYPE = 'HealthGuide'` (`aiChatController.ts:39`) == reader `RESOURCE_HEALTH_GUIDE = 'HealthGuide'` (`usageTracker.ts:40`); guidance writer `'biomarker_ai_guidance'` (`biomarkerRoutes.ts:154`/`:187`/`:284`) == reader `RESOURCE_BIOMARKER_GUIDANCE = 'biomarker_ai_guidance'` (`usageTracker.ts:41`).
- [ ] The reader also filters `action: 'READ'` (`usageTracker.ts:104`/`:119`); `logAccess` (line 373) hardcodes `action: 'READ'` (`auditLog.ts:383`), so confirm both AI usages go through `logAccess` (not `logCreate`/`logUpdate`, which stamp other actions) — a future switch to `logCreate` would zero the counter.
- [ ] EDGE CASE (L-35, REVERSED — re-verify): the count query filters only `resourceType` + `action` + `createdAt >= today`, NOT the `operation` metadata, so the writer must choose its `resourceType` carefully. Blocked/failed/initiated chat attempts are now logged under a SEPARATE `RESOURCE_TYPE_ATTEMPT = 'HealthGuideAttempt'` (`aiChatController.ts:48`) — `CHAT_BLOCKED_NO_BAA` (line 150), `CHAT_INITIATED` (line 213), `CHAT_FAILED` (line 353) — a resourceType the counter does NOT match, so they do **NOT** consume the `aiChatsPerDay` quota. ONLY the success path writes `'HealthGuide'`/`READ` (`aiChatController.ts:320`). Confirm a blocked/failed call still lands under `HealthGuideAttempt` (not `HealthGuide`), so a failed call can't burn the user's quota.
- [ ] Cost-analysis and PDF-upload counts are derived from real tables (`costAnalysis.count` `usageTracker.ts:123`, `userFile.count` `usageTracker.ts:108`), not audit rows — so they do NOT share the resourceType-drift risk. Verify a `CostAnalysis` row is actually written on every successful analyze (`expenseController.ts:793`) so the monthly count stays truthful.
- [ ] `checkPlanLimit` short-circuits unlimited tiers (`isUnlimited(-1)`, `usageTracker.ts:175`) without a DB read — confirm unlimited (`-1`) AI tiers in `plans.ts` (PRO `aiGuidancePerDay`/`costAnalysisPerMonth`, TEAM `aiChatsPerDay`) are still bounded by the dollar budget in §3, since the request-count gate no longer applies to them.
- [ ] `NUMERIC_LIMIT_TO_USAGE` (`usageTracker.ts:142`) maps each numeric `PlanLimits` key to a `UsageCount` field; a limit key with no mapping yields `current = 0` and always-allow (`usageTracker.ts:200-201`). Verify every numeric AI limit (`aiChatsPerDay`, `aiGuidancePerDay`, `costAnalysisPerMonth`, `pdfUploadsPerMonth`) has a mapping entry.
- [ ] `requirePlanLimit` reads the plan from the **DB under RLS**, not the JWT (`planGating.ts:66`), and downgrades to FREE when `planExpiresAt` has passed (`planGating.ts:73-74`) — confirm this so an expired paid plan can't keep spending at PRO/TEAM ceilings. On a DB-lookup error it fails **CLOSED to FREE** (`effectivePlan = 'FREE'`, `planGating.ts:76-88`), deliberately NOT trusting the more-permissive JWT snapshot (the catch comment explicitly rejects the JWT path) — so a transient DB outage degrades to the SAFEST tier, not a more-permissive one.

### 6. Demo-account cost containment
- [ ] `blockDemoAI` (403) is present on every Claude-backed route that carries it in the guard stack — chat, guidance, analyze, upload-sbc, reanalyze, and the three upload routes — so the demo account can't generate anonymous Anthropic cost (`demoProtection.ts:81`).
- [ ] `isDemoAccount` (`demoProtection.ts:33`) returns `false` when `DEMO_EMAIL` is unset (the empty-email guard at `demoProtection.ts:34`), so an empty `req.user.email` can't be mistaken for the demo user; and demo mode hard-fails in production (`config/index.ts:489-493`). Confirm both still hold (demo-account blocking on AI routes is also surveyed by [[27-ai-integration]]).

### 7. Scope boundaries (owned elsewhere — verify the cross-link, don't re-audit)
- [ ] BAA gating (`ANTHROPIC_BAA_ACTIVE`, the prod boot hard-exit at `config/index.ts:381-384`, and the per-caller runtime refusal) is owned by [[27-ai-integration]] — this prompt does NOT re-audit it. Just confirm the spend guard runs independently of the BAA gate (a BAA-blocked call returns 503 before any spend, so it never reaches `trackAIUsage`).
- [ ] PHI-in-prompt minimization and response scrubbing (`redactPHI`/`stripPHIFromText`) are owned by [[27-ai-integration]] and [[02-encryption]] — out of scope here except to confirm `aiCostTracker` itself logs no PHI (only `userId`, `endpoint`, `model`, token counts, `aiCostTracker.ts:315-322`).
- [ ] L33 server-side disclaimer enforcement (`disclaimerToAppend()` in `utils/aiDisclaimer.ts`) is applied in BOTH Claude-spend call sites this file owns — `aiChatController.ts:289` and `biomarkerRoutes.ts:260` — so the educational disclaimer is enforced server-side, not just by the client. It is owned/deep-audited by [[27-ai-integration]]; here just confirm both spend-bearing AI responses still append it (a removed call would ship un-disclaimed AI guidance from a metered path).
- [ ] The shared-client construction, timeouts, and key handling are owned by [[09-external-apis]] — confirm only that every metered path goes through `getAnthropicClient()` so no off-client call escapes `trackAIUsage`.

## Verification Commands
```bash
# Every Claude call site must also call trackAIUsage — diff the two lists
grep -rln "getAnthropicClient\|messages.create\|messages.stream" backend/src/ | grep -v ".test."
grep -rln "trackAIUsage(" backend/src/ | grep -v ".test."

# Which routes carry the dollar circuit breaker vs. only the rate limiter
grep -rn "aiSpendGuard" backend/src/routes/        # the 8 guarded routes
grep -rn "aiLimiter" backend/src/routes/           # superset — the gap is the difference

# Confirm the spend cap config + the spend store API
grep -rn "AI_DAILY_BUDGET_USD\|AI_USER_DAILY_BUDGET_USD\|dailyBudgetUsd\|userDailyBudgetUsd" backend/src/
grep -rn "admitAISpend\|SpendStore\|RESERVATION_USD\|trackAIUsage" backend/src/services/aiCostTracker.ts
# Sanity: the OLD spend symbols must be GONE (expect: no matches)
grep -rn "globalSpentUsd\|userSpentUsd\|rollIfNewDay\|recordSpend\|isAISpendExceeded\|reserveAISpend" backend/src/services/aiCostTracker.ts

# Resource-type strings must agree between writers and the usage counter
grep -rn "HealthGuide\|biomarker_ai_guidance" backend/src/controllers/ backend/src/routes/ backend/src/services/usageTracker.ts

# Confirm plan-limit gates are wired where money is spent
grep -rn "requirePlanLimit" backend/src/routes/
grep -n "aiChatsPerDay\|aiGuidancePerDay\|costAnalysisPerMonth\|pdfUploadsPerMonth" backend/src/config/plans.ts

# Pricing table currency check (rates must match current Anthropic pricing)
grep -n "PRICING\|input:\|output:" backend/src/services/aiCostTracker.ts

# Demo accounts blocked from paid AI features
grep -rn "blockDemoAI" backend/src/routes/

# The accumulator NOW consumes the shared Redis store the limiters use (expect: getStore() picks RedisSpendStore when config.redis.url is set)
grep -rn "config.redis\|getRedisClient\|RedisSpendStore\|getStore" backend/src/services/aiCostTracker.ts
```

## Questions to Ask
1. Is `trackAIUsage` provably called on every successful Claude response across all five call sites, with the *real* `userId` and the *actual* `response.usage` token counts (not estimates)?
2. The three `/upload/*` routes (`lab-report`, `insurance-sbc`, `lab-results-ocr`) call Claude AND now carry `aiSpendGuard` (gap closed) — is the dollar circuit breaker definitely meant to cover document extraction, and is there a risk a NEW upload/AI route reintroduces the gap? (Both SBC paths — `/insurance/upload-sbc` and `/upload/insurance-sbc` — are now dollar-capped.)
3. The spend accumulator is in-memory/per-instance BY DEFAULT (effective daily ceiling N × budget, resets on every redeploy/scale event) UNLESS `REDIS_URL` is set, in which case `aiCostTracker` already uses the shared Redis store (`getStore()` → `RedisSpendStore`). Is `REDIS_URL` actually provisioned in prod, so the runaway-billing backstop is cross-instance rather than N×budget?
4. Blocked/failed/initiated chats are now logged under `RESOURCE_TYPE_ATTEMPT = 'HealthGuideAttempt'` (L-35) and therefore do NOT consume the user's daily chat quota (only the success path writes `'HealthGuide'`/`READ`). Confirm this is the intended product behavior — i.e. a user shouldn't lose a chat to a failed/blocked attempt.
5. What is the worst-case daily Anthropic bill if the per-user cap (default $5) is hit simultaneously by many users across N instances, and is there an alert wired to the `AICost` structured logs / a global-budget breach?
6. Are unlimited (`-1`) AI tiers (PRO, TEAM) genuinely bounded by the dollar budget, given the request-count plan gate short-circuits for them?
7. Is `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` set to a sensible numeric value in every deployed environment? (A non-numeric/negative value no longer silently disables the cap — `parseBudget` warns and falls back to the default — but a legitimately-set `0` still disables that scope, and a default that is too high is still an exposure.)
