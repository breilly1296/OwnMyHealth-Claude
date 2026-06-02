---
tags:
  - security
  - ai-cost
  - high
type: prompt
priority: 2
updated: 2026-06-01
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
- `backend/src/services/aiCostTracker.ts` (the heart of this domain — token→USD pricing table `PRICING` with the sonnet fallback at line 92, in-memory per-UTC-day rolling accumulator `globalSpentUsd`/`userSpentUsd`, `rollIfNewDay`, `recordSpend`, `isAISpendExceeded` (line 69), `trackAIUsage` (line 91), `__resetAISpendForTests`)
- `backend/src/middleware/aiSpendGuard.ts` (the dollar circuit breaker — `aiSpendGuard`; reads `isAISpendExceeded`, fails closed with `ServiceUnavailableError` 503; bails to `next()` when `req.user` is absent, line 25)
- `backend/src/services/usageTracker.ts` (per-user plan-limit counters — `getUserUsage` (line 56), `checkPlanLimit` (line 125); `RESOURCE_HEALTH_GUIDE = 'HealthGuide'` (line 38), `RESOURCE_BIOMARKER_GUIDANCE = 'biomarker_ai_guidance'` (line 39); `NUMERIC_LIMIT_TO_USAGE` map, line 111)
- `backend/src/middleware/planGating.ts` (`requirePlanLimit` (line 37) — fresh DB plan read under RLS, `planExpiresAt` runtime downgrade to FREE, 403 `PLAN_LIMIT_EXCEEDED`; DB-failure fallback to JWT plan, line 80)
- `backend/src/middleware/rateLimiter.ts` (`aiLimiter` (line 108) — 10 AI req/hour, user-keyed via `keyGenerator` line 121; per-instance `MemoryStore` unless `REDIS_URL` set, header comment line 8)
- `backend/src/middleware/demoProtection.ts` (`blockDemoAI` (line 164) — 403 to prevent anonymous cost generation from the demo account)
- `backend/src/config/index.ts` (`config.ai.dailyBudgetUsd` / `config.ai.userDailyBudgetUsd`, lines 195-198, defaults 50 / 5; `config.anthropic.baaActive`, line 185)
- `backend/src/config/plans.ts` (`PlanLimits` shape line 18; per-tier `aiChatsPerDay`, `aiGuidancePerDay`, `costAnalysisPerMonth`, `pdfUploadsPerMonth`; `isUnlimited` `-1`, line 118; `normalizePlan`)
- `backend/src/services/anthropicClient.ts` (shared lazy SDK singleton — `getAnthropicClient`, `isEnabled`; cost/spend logic lives elsewhere, but every metered call flows through here)
- `backend/src/services/auditLog.ts` (`logAccess` always writes `action: 'READ'`, line 318 — the rows `usageTracker` counts for chat + guidance)

### Claude call sites — every one must call `trackAIUsage`
- `backend/src/controllers/aiChatController.ts` (`handleAIChat` — `trackAIUsage` line 248, `MODEL = claude-haiku-4-5-20251001`; audits `HealthGuide`/`READ`)
- `backend/src/routes/biomarkerRoutes.ts` (inline `POST /:id/guidance` handler — `trackAIUsage` line 248, gated by `aiSpendGuard` line 123; audits `biomarker_ai_guidance`/`READ`)
- `backend/src/controllers/expenseController.ts` (`analyzeCosts` line 614 — `trackAIUsage` line 715, `claude-sonnet-4-5-20250929`; plan count read from `costAnalysis` table, NOT audit rows)
- `backend/src/services/claudeExtraction.ts` (lab-report extraction — `trackAIUsage` line 167; called from `POST /upload/lab-report`)
- `backend/src/services/sbcExtraction.ts` (SBC extraction — `trackAIUsage` line 844; called from `upload-sbc` / `reanalyze`)

### Routes that carry the AI guard stack
- `backend/src/routes/aiRoutes.ts` (`POST /chat` — `aiLimiter` → `aiSpendGuard` → `blockDemoAI` → `requirePlanLimit('aiChatsPerDay')` → `validate`, lines 29-37)
- `backend/src/routes/expenseRoutes.ts` (`POST /analyze` — full stack incl. `aiSpendGuard`, lines 111-120)
- `backend/src/routes/insuranceRoutes.ts` (`upload-sbc` line 131 and `plans/:id/reanalyze` line 117 — both carry `aiSpendGuard`)
- `backend/src/routes/biomarkerRoutes.ts` (`POST /:id/guidance` — full stack incl. `aiSpendGuard`, lines 120-126)
- `backend/src/routes/uploadRoutes.ts` (`lab-report` line 77, `insurance-sbc` line 94, `lab-results-ocr` line 124 — `aiLimiter` + `requirePlanLimit('pdfUploadsPerMonth')` but **no** `aiSpendGuard`)
- `backend/src/routes/healthGoalsRoutes.ts` (`GET /suggestions` — `aiLimiter` only, line 48)
- `backend/src/routes/healthNeedsRoutes.ts` (`GET /analyze` — `aiLimiter` only, line 49)

### Frontend
- `src/services/api/ai.ts` (`aiApi.chat` — SSE client; reads `usage.input_tokens`/`output_tokens` from `message_stop`, and decodes the 403 `PLAN_LIMIT_EXCEEDED` body into an upgrade CTA, lines 135-147)

> NOTE: there is no schema/migration that owns spend state — the accumulator is
> process memory in `aiCostTracker.ts`, not a table. That is itself a finding
> dimension (see §3). Plan-limit counts are derived from existing tables
> (`AuditLog`, `UserFile`, `Biomarker`, `InsurancePlan`, `CostAnalysis`), so no
> new migration backs this domain.

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
- **The dollar circuit breaker (spend budget)** — "has this *instance* spent
  more than the daily USD budget?" Enforced by `aiSpendGuard` middleware →
  `isAISpendExceeded` (`aiCostTracker.ts`). Two scopes: global
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
  (`aiCostTracker.ts:92`). The estimated USD is added to the in-memory
  accumulator via `recordSpend` and emitted to the `AICost` structured logger.
- The accumulator is **process memory**: a global running total plus a
  per-user `Map`, both keyed implicitly by a `spendDayKey` string. `rollIfNewDay`
  compares the current UTC `YYYY-MM-DD` against `spendDayKey` and zeroes both
  totals on the first call of a new UTC day (`aiCostTracker.ts:47`). There is no
  persistence and no shared store — the same per-instance limitation the
  in-memory rate limiters carry (see [[08-rate-limiting]], `rateLimiter.ts:8`).
- `aiSpendGuard` checks **before** the call; the in-flight call's cost isn't
  known until it returns, so a single call can push slightly past the cap, but
  the *next* call is refused. That refusal is what bounds a runaway loop —
  there is no pre-debit / reservation.

Where the two governors meet the data:

- Plan-limit counts for **chat** and **biomarker guidance** are derived from
  `AuditLog` rows: `usageTracker.getUserUsage` counts rows where
  `resourceType === 'HealthGuide'` (chat) or `'biomarker_ai_guidance'` (guidance)
  AND `action === 'READ'` for today (UTC). `logAccess` always stamps
  `action: 'READ'` (`auditLog.ts:318`) and passes `resourceType` verbatim, so
  the writer strings in `aiChatController` (`RESOURCE_TYPE = 'HealthGuide'`,
  line 38) and `biomarkerRoutes` (`'biomarker_ai_guidance'`, lines 141/174/266)
  MUST byte-match the constants in `usageTracker.ts:38-39`. A typo on either side
  silently zeroes the counter — the user gets unlimited "free" chats and the
  gate never fires.
- Cost-analysis count is read from a **real table** (`tx.costAnalysis.count`,
  `usageTracker.ts:92`), not audit rows — so it is immune to the resourceType
  drift above. PDF upload count is read from `tx.userFile.count`
  (`usageTracker.ts:77`).

PHI / secrets posture for this domain: the cost path handles **token counts and
USD only** — no PHI flows through `aiCostTracker`. The accumulator stores a
`userId` key and a float; the `AICost` log line includes `userId` but no prompt,
response, or health values. The Anthropic key itself is owned by
[[11-environment-secrets]] and [[27-ai-integration]].

## Checklist

### 1. Cost-accounting correctness (`trackAIUsage` on every metered call)
- [ ] `trackAIUsage` is called on EVERY successful Claude response — confirm all five call sites fire it: chat (`aiChatController.ts:248`), biomarker guidance (`biomarkerRoutes.ts:248`), cost analysis (`expenseController.ts:715`), lab extraction (`claudeExtraction.ts:167`), SBC extraction (`sbcExtraction.ts:844`). A call site that skips it under-reports spend and lets the budget run hot.
- [ ] The token counts passed are the **actual** usage from the response (`response.usage.input_tokens` / `output_tokens`), not estimates — verify each call site reads `response.usage` (chat reads `finalMessage.usage`, `aiChatController.ts:238`).
- [ ] Each call site passes the **real authenticated `userId`**, never a hardcoded `'system'` — the per-user budget and per-user log attribution depend on it (see the regression test `claudeExtraction.test.ts:182`).
- [ ] `PRICING` rates match current Anthropic pricing for the models actually in use (`claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`, `aiCostTracker.ts:16-19`); stale rates make the budget a fiction.
- [ ] The unknown-model fallback (`PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929']`, `aiCostTracker.ts:92`) errs **expensive** (sonnet > haiku) so a model-id change never silently under-counts — confirm the fallback model is the most expensive in the table, not the cheapest.
- [ ] `estimatedCostUsd` is logged with enough precision to be summable (`toFixed(6)`, `aiCostTracker.ts:102`) and emitted under the `AICost` service logger so spend can be aggregated downstream.
- [ ] `recordSpend` increments BOTH `globalSpentUsd` and the per-user `Map` entry (`aiCostTracker.ts:56-60`) — a path that updates only one breaks one of the two scopes.

### 2. Spend-guard route coverage (KNOWN GAP — do not soften)
- [ ] Enumerate the AI routes that carry `aiSpendGuard`. As of 2026-06-01 there are exactly **five**: `POST /biomarkers/:id/guidance` (`biomarkerRoutes.ts:123`), `POST /expenses/analyze` (`expenseRoutes.ts:114`), `POST /ai/chat` (`aiRoutes.ts:32`), `POST /insurance/upload-sbc` (`insuranceRoutes.ts:136`), `PUT /insurance/plans/:id/reanalyze` (`insuranceRoutes.ts:123`).
- [ ] FLAG: the Claude-backed **upload** routes carry `aiLimiter` (rate) and `requirePlanLimit('pdfUploadsPerMonth')` but **NOT** `aiSpendGuard` (dollar cap): `POST /upload/lab-report` (`uploadRoutes.ts:77-85` → `claudeExtraction`), `POST /upload/insurance-sbc` (`uploadRoutes.ts:94-102` → `sbcExtraction`), `POST /upload/lab-results-ocr` (`uploadRoutes.ts:124-132`, PDF branch → Claude). These call Claude (and `trackAIUsage` accrues their cost into the same accumulator) yet are NOT refused when the budget is exhausted. The dollar circuit breaker does not protect them.
- [ ] Note the asymmetry: SBC extraction is reachable by two routes — `POST /insurance/upload-sbc` (guarded) and `POST /upload/insurance-sbc` (unguarded) — so the same expensive operation is dollar-capped on one path and not the other. Confirm this is intentional or close the gap.
- [ ] Verify `aiLimiter` and `requirePlanLimit('pdfUploadsPerMonth')` are present on every unguarded upload route, since they are the ONLY cost controls there (rate + per-user monthly count, no global dollar ceiling).
- [ ] FLAG / verify: `GET /health-goals/suggestions` (`healthGoalsRoutes.ts:48`) and `GET /health-needs/analyze` (`healthNeedsRoutes.ts:49`) carry `aiLimiter` but no `aiSpendGuard`. As of 2026-06-01 their controllers (`healthGoalsController`, `healthNeedsController`) do **not** import the Anthropic client and do not call Claude — so they accrue no Claude spend today. If a future change wires Claude into either handler, they would become Claude-backed routes with no dollar cap. Re-confirm they are still non-Claude before clearing this item.
- [ ] The intended full AI guard order is `aiLimiter` → `aiSpendGuard` → `blockDemoAI` → `requirePlanLimit(...)` → `validate(...)` (see `aiRoutes.ts`); confirm each guarded route preserves it. Note `insuranceRoutes` orders the upload guards differently (`blockDemoAI` → `uploadLimiter` → `aiLimiter` → `aiSpendGuard`, lines 120-127 / 133-138) — verify the ordering is still safe (spend guard still runs after `authenticate` so `req.user` resolves).

### 3. Circuit-breaker behavior & response codes
- [ ] `aiSpendGuard` fails **closed** with **503 `SERVICE_UNAVAILABLE`** (via `ServiceUnavailableError`, `aiSpendGuard.ts:42`), NOT 429 — 429 is `aiLimiter`'s rate-limit code (`rateLimiter.ts:115`) and 403 is the plan gate's code. Confirm the three governors return three distinct codes so the client can tell them apart.
- [ ] `isAISpendExceeded` checks **global before per-user** and returns the offending `scope` (`aiCostTracker.ts:71-77`); the middleware uses `scope` to pick a global vs. per-user message (`aiSpendGuard.ts:43-46`). Verify the per-user message says "try again tomorrow" and the global says "temporarily unavailable" — they imply different remediation.
- [ ] A budget of `0` disables that scope (the `> 0` guards at `aiCostTracker.ts:71` and `:74`). Confirm `config.ai.dailyBudgetUsd` / `userDailyBudgetUsd` (`config/index.ts:196-197`) are not accidentally `0`/`NaN` in any deployed env — `Number(process.env... ?? '50')` yields `NaN` if the var is set to a non-numeric string, and `NaN > 0` is `false`, silently disabling the cap.
- [ ] `aiSpendGuard` calls `next()` (allows the request) when `req.user?.id` is absent (`aiSpendGuard.ts:25`). Confirm it always runs AFTER `authenticate`/`requireBearerAuth` so an unauthenticated request can't slip past — and note that even so, the *global* cap still applies on the next authenticated request.
- [ ] The per-UTC-day reset is driven by string comparison in `rollIfNewDay` (`aiCostTracker.ts:47`); confirm `utcDayKey` uses UTC (`toISOString().slice(0,10)`) so the window doesn't drift with server timezone, and that `isAISpendExceeded` calls `rollIfNewDay` before reading (it does, line 70) so a stale day's total can't block a fresh day.

### 4. In-memory / per-instance ceiling (KNOWN LIMITATION — do not soften)
- [ ] The spend accumulator is **in-memory, per-instance** (`aiCostTracker.ts:30-41`). Under Cloud Run autoscale with N instances the effective ceiling is **N × budget** — each instance tracks its own total. Confirm this is bounded by an explicit `--max-instances` pin and that the resulting worst-case daily spend (N × `AI_DAILY_BUDGET_USD`) is an acceptable billing exposure.
- [ ] State is lost on instance restart/redeploy — a scale event or deploy resets every instance's running total to `0` mid-day, so the real daily ceiling can exceed N × budget across the day. Confirm this is understood and acceptable, or that a shared store is planned.
- [ ] Spend is recorded **post-call** with no pre-debit (`isAISpendExceeded` reads, `trackAIUsage` writes after the response, `aiCostTracker.ts:62-67` doc). A single runaway loop on one instance is bounded only by the *next* call's refusal — verify there is no path that fires many concurrent Claude calls before any of them returns to update the accumulator (e.g. a `Promise.all` fan-out of AI calls).
- [ ] RECOMMENDATION (record as a finding if this is the billing backstop): if `aiSpendGuard` is the last line of defense against runaway Anthropic billing, the accumulator should move to a shared atomic store (Cloud Memorystore / Redis), mirroring the `REDIS_URL` path already built for the rate limiters (`rateLimiter.ts:8-14`). Note that `config.redis.url` already exists (`config/index.ts:125`) but `aiCostTracker` does not consume it.

### 5. Per-user plan-limit counting (resourceType string agreement)
> The plan-limit *governor* (tiers, `requirePlanLimit`, the 403 error contract, the
> Stripe/billing path that isn't wired yet) is the deep domain of
> [[43-plan-gating-billing]]; this section audits ONLY the slice where plan limits
> meet AI spend (the audit-row counter that backs `aiChatsToday`/`aiGuidanceToday`,
> and whether unlimited tiers are still bounded by the §3 dollar cap). Cross-link
> 43 rather than re-auditing the gate itself.
- [ ] The audit `resourceType` strings MUST agree between writers and `usageTracker`, or plan-limit counting silently breaks. Verify: chat writer `RESOURCE_TYPE = 'HealthGuide'` (`aiChatController.ts:38`) == reader `RESOURCE_HEALTH_GUIDE = 'HealthGuide'` (`usageTracker.ts:38`); guidance writer `'biomarker_ai_guidance'` (`biomarkerRoutes.ts:141`/`:174`/`:266`) == reader `RESOURCE_BIOMARKER_GUIDANCE = 'biomarker_ai_guidance'` (`usageTracker.ts:39`).
- [ ] The reader also filters `action: 'READ'` (`usageTracker.ts:72`/`:90`); `logAccess` hardcodes `action: 'READ'` (`auditLog.ts:318`), so confirm both AI usages go through `logAccess` (not `logCreate`/`logUpdate`, which stamp other actions) — a future switch to `logCreate` would zero the counter.
- [ ] EDGE CASE: the count query filters only `resourceType` + `action` + `createdAt >= today`, NOT the `operation` metadata. The chat handler writes `HealthGuide`/`READ` rows for `CHAT` (success), `CHAT_BLOCKED_NO_BAA` (`aiChatController.ts:130`), and `CHAT_FAILED` (`aiChatController.ts:289`) alike — so a blocked or failed chat still increments today's `aiChatsToday` count and consumes the user's daily quota. Confirm whether failed/blocked calls should count against the quota; today they do.
- [ ] Cost-analysis and PDF-upload counts are derived from real tables (`costAnalysis.count` `usageTracker.ts:92`, `userFile.count` `usageTracker.ts:77`), not audit rows — so they do NOT share the resourceType-drift risk. Verify a `CostAnalysis` row is actually written on every successful analyze (`expenseController.ts:728`) so the monthly count stays truthful.
- [ ] `checkPlanLimit` short-circuits unlimited tiers (`isUnlimited(-1)`, `usageTracker.ts:144`) without a DB read — confirm unlimited (`-1`) AI tiers in `plans.ts` (PRO `aiGuidancePerDay`/`costAnalysisPerMonth`, TEAM `aiChatsPerDay`) are still bounded by the dollar budget in §3, since the request-count gate no longer applies to them.
- [ ] `NUMERIC_LIMIT_TO_USAGE` (`usageTracker.ts:111`) maps each numeric `PlanLimits` key to a `UsageCount` field; a limit key with no mapping yields `current = 0` and always-allow (`usageTracker.ts:150`). Verify every numeric AI limit (`aiChatsPerDay`, `aiGuidancePerDay`, `costAnalysisPerMonth`, `pdfUploadsPerMonth`) has a mapping entry.
- [ ] `requirePlanLimit` reads the plan from the **DB under RLS**, not the JWT (`planGating.ts:66`), and downgrades to FREE when `planExpiresAt` has passed (`planGating.ts:73`) — confirm this so an expired paid plan can't keep spending at PRO/TEAM ceilings. Note the DB-failure fallback to the (possibly stale) JWT plan (`planGating.ts:80-83`): a transient DB outage degrades to the JWT's snapshot plan, which could be more permissive.

### 6. Demo-account cost containment
- [ ] `blockDemoAI` (403) is present on every Claude-backed route that carries it in the guard stack — chat, guidance, analyze, upload-sbc, reanalyze, and the three upload routes — so the demo account can't generate anonymous Anthropic cost (`demoProtection.ts:164`).
- [ ] `isDemoAccount` returns `false` when `DEMO_EMAIL` is unset (`demoProtection.ts:34`), so an empty `req.user.email` can't be mistaken for the demo user; and demo mode hard-fails in production (`config/index.ts:408`). Confirm both still hold (demo-account blocking on AI routes is also surveyed by [[27-ai-integration]]).

### 7. Scope boundaries (owned elsewhere — verify the cross-link, don't re-audit)
- [ ] BAA gating (`ANTHROPIC_BAA_ACTIVE`, the prod boot hard-exit at `config/index.ts:300`, and the per-caller runtime refusal) is owned by [[27-ai-integration]] — this prompt does NOT re-audit it. Just confirm the spend guard runs independently of the BAA gate (a BAA-blocked call returns 503 before any spend, so it never reaches `trackAIUsage`).
- [ ] PHI-in-prompt minimization and response scrubbing (`redactPHI`/`stripPHIFromText`) are owned by [[27-ai-integration]] and [[02-encryption]] — out of scope here except to confirm `aiCostTracker` itself logs no PHI (only `userId`, `endpoint`, `model`, token counts, `aiCostTracker.ts:97-104`).
- [ ] The shared-client construction, timeouts, and key handling are owned by [[09-external-apis]] — confirm only that every metered path goes through `getAnthropicClient()` so no off-client call escapes `trackAIUsage`.

## Verification Commands
```bash
# Every Claude call site must also call trackAIUsage — diff the two lists
grep -rln "getAnthropicClient\|messages.create\|messages.stream" backend/src/ | grep -v ".test."
grep -rln "trackAIUsage(" backend/src/ | grep -v ".test."

# Which routes carry the dollar circuit breaker vs. only the rate limiter
grep -rn "aiSpendGuard" backend/src/routes/        # the 5 guarded routes
grep -rn "aiLimiter" backend/src/routes/           # superset — the gap is the difference

# Confirm the spend cap config + the in-memory accumulator
grep -rn "AI_DAILY_BUDGET_USD\|AI_USER_DAILY_BUDGET_USD\|dailyBudgetUsd\|userDailyBudgetUsd" backend/src/
grep -rn "globalSpentUsd\|userSpentUsd\|rollIfNewDay\|isAISpendExceeded" backend/src/services/aiCostTracker.ts

# Resource-type strings must agree between writers and the usage counter
grep -rn "HealthGuide\|biomarker_ai_guidance" backend/src/controllers/ backend/src/routes/ backend/src/services/usageTracker.ts

# Confirm plan-limit gates are wired where money is spent
grep -rn "requirePlanLimit" backend/src/routes/
grep -n "aiChatsPerDay\|aiGuidancePerDay\|costAnalysisPerMonth\|pdfUploadsPerMonth" backend/src/config/plans.ts

# Pricing table currency check (rates must match current Anthropic pricing)
grep -n "PRICING\|input:\|output:" backend/src/services/aiCostTracker.ts

# Demo accounts blocked from paid AI features
grep -rn "blockDemoAI" backend/src/routes/

# Does the accumulator consume the shared Redis store the limiters can use? (expect: no)
grep -rn "REDIS_URL\|config.redis\|createRateLimitStore" backend/src/services/aiCostTracker.ts
```

## Questions to Ask
1. Is `trackAIUsage` provably called on every successful Claude response across all five call sites, with the *real* `userId` and the *actual* `response.usage` token counts (not estimates)?
2. Why do the three `/upload/*` routes (`lab-report`, `insurance-sbc`, `lab-results-ocr`) call Claude but omit `aiSpendGuard`? Is the dollar circuit breaker meant to cover document extraction, or only the chat/guidance/analyze surface? (Same SBC operation is dollar-capped on `/insurance/upload-sbc` but not `/upload/insurance-sbc`.)
3. The spend accumulator is in-memory/per-instance, so the effective daily ceiling is N × budget and resets on every redeploy/scale event. Is that an acceptable billing exposure, or does this need a shared store (Memorystore) before it's relied on as the runaway-billing backstop? `config.redis.url` already exists — should `aiCostTracker` consume it?
4. Do blocked/failed chats counting against the user's daily chat quota (because the `HealthGuide`/`READ` audit row is written regardless of `operation`) match the intended product behavior?
5. What is the worst-case daily Anthropic bill if the per-user cap (default $5) is hit simultaneously by many users across N instances, and is there an alert wired to the `AICost` structured logs / a global-budget breach?
6. Are unlimited (`-1`) AI tiers (PRO, TEAM) genuinely bounded by the dollar budget, given the request-count plan gate short-circuits for them?
7. Is `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` set to a numeric value in every deployed environment (a non-numeric value yields `NaN`, which silently disables the cap)?
