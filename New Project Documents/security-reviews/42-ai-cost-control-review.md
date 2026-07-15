# AI Cost & Spend-Control Security Review — 2026-06-16

Scope: the dollar/usage governance of the Claude integration — cost accounting
(`trackAIUsage`), the spend circuit breaker (`aiSpendGuard` + `aiCostTracker`),
per-user plan-limit counting, and where the ceilings leak. BAA gating, PHI-in-prompt
minimization, the shared client, and prompt injection are owned by
[27-ai-integration] / [09-external-apis] and are NOT re-audited here (see Out of scope).
Executed by reading the live code at HEAD `fb2cd32`; every passed check cites a `file:line`.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Info | 2 |

No exploitable runaway-billing path, broken plan counter, or unguarded paid AI route
was found. The two governors (per-user plan quota → 403; dollar circuit breaker → 503)
are both wired, return distinct status codes, and are atomic-reserve-first. The findings
are a documented multi-instance ceiling (accepted, bounded by `--max-instances=3`), an
aborted-stream cost under-count edge, and the absence of automated alerting on a
budget breach.

## Findings

### F-1 — Aborted chat stream skips real-cost recording (reservation refunds, real tokens go uncounted) — **Low**
- **Location:** `backend/src/controllers/aiChatController.ts:254-314` (success path) vs `:330-363` (catch path); `backend/src/middleware/aiSpendGuard.ts:74-75`.
- **Observation:** `trackAIUsage(...)` for the chat endpoint is only called on the SUCCESS path, after `await stream.finalMessage()` resolves (`aiChatController.ts:308`). If the client disconnects mid-stream (or the stream throws), control jumps to the `catch` block (`:330`), which logs a `CHAT_FAILED` audit row but never calls `trackAIUsage`. The Anthropic call may already have consumed (and billed) input/output tokens. Meanwhile `aiSpendGuard` registers `admission.settle` on both `res.finish` and `res.close` (`aiSpendGuard.ts:74-75`), so the `$0.05` reservation IS refunded on the aborted connection. Net effect for an aborted call: the reservation is backed out and the real cost is recorded as `$0` — the accumulator under-reports real spend for partially-streamed answers.
- **Impact:** The daily spend accumulator drifts low relative to the true Anthropic bill when chats are aborted. Exploitability is low: each aborted chat is still bounded by `aiLimiter` (10/hr/user) and `requirePlanLimit('aiChatsPerDay')`, and the per-call cost is small (haiku, `max_tokens: 1000`). The breaker still trips correctly on completed calls; this only loosens accounting precision for the abort case, it does not uncap spend.
- **Fix:** In the `catch` block of `handleAIChat`, call `trackAIUsage` with the best-available token counts before/while handling the error — capture `inputTokens`/`outputTokens` from any partial `finalMessage()`/`stream` state already accumulated (the locals are declared at `:227-228`), or record an estimate keyed off `MODEL` + bytes emitted. Even recording the reservation-sized floor on abort would tighten the books. The biomarker-guidance, extraction, and cost-analysis sites are non-streaming `messages.create` and do not have this gap (they `await` the full response before `trackAIUsage`).
- **Evidence:**
  ```ts
  // success path only:
  res.end();
  trackAIUsage({ endpoint: 'ai-chat', model: MODEL, inputTokens, outputTokens, userId });
  // catch path (aiChatController.ts:330+): no trackAIUsage call
  ```

### F-2 — No automated alert on a global-budget breach; the only signal is a log line — **Low**
- **Location:** `backend/src/services/aiCostTracker.ts:315-322` (`AICost` `info` log); `backend/src/middleware/aiSpendGuard.ts:55-58` (`warn` on refusal).
- **Observation:** Spend is emitted only via `aiCostLogger.info('AI API usage', {...})` per call and `logger.warn('AI request refused — daily spend budget reached', {...})` when the breaker trips. There is no code path that raises an alert (PagerDuty/email/metric threshold) when the global daily budget is reached or when cumulative spend crosses a fraction of the cap. Grep for `AICost`/alert/`dailyBudget` outside the tracker/config finds no alerting consumer (`backend/src/services/aiCostTracker.ts` is the sole `AICost` producer; `emailTemplates.ts`/`errorHandler.ts` matches are unrelated "alert"-word noise).
- **Impact:** A sustained budget breach (compromised key, buggy loop) is invisible until someone reads logs or notices the 503s. The circuit breaker still *bounds* the bill, but the operator learns about the incident late. This is observability hardening, not an exploit.
- **Fix:** Add a log-based metric + alert on the `AICost` `warn` ("daily spend budget reached") and on a `% of cap` threshold, or emit a structured metric from `aiSpendGuard` on refusal and from `trackAIUsage` when the running total nears the cap. This is an ops/infra change, out of band of this codebase, but worth tracking.
- **Evidence:**
  ```ts
  aiCostLogger.info('AI API usage', { endpoint, model, inputTokens, outputTokens, estimatedCostUsd: ..., userId });
  ```

### F-3 — `REDIS_URL` not provisioned in prod → dollar cap is per-instance (N×budget, resets on deploy) — **Low**
- **Location:** `backend/src/services/aiCostTracker.ts:257-274` (`getStore()`); `backend/src/config/index.ts:185-187` (`config.redis.url`); `.github/workflows/deploy.yml:189` (`--max-instances=3`, no `REDIS_URL`); `.github/workflows/deploy-staging.yml:88`.
- **Observation:** `getStore()` selects `RedisSpendStore` only when `config.redis.url` is set (`aiCostTracker.ts:259`); otherwise it returns `InMemorySpendStore` (per-process). `REDIS_URL` appears in NO deploy workflow (grep over `.github/workflows` returns no match), so prod runs the in-memory store. Under autoscale the effective daily ceiling is therefore `N × AI_DAILY_BUDGET_USD`, and each instance's running total resets to `0` on every redeploy/scale event, so the true daily ceiling can exceed `N × budget` across a day. This is bounded by `--max-instances=3` (deploy.yml:189) → worst case ≈ `3 × $50 = $150/day` global and `3 × $5 = $15/day` per user (plus deploy/scale resets). The code is correctly wired to go cross-instance the moment `REDIS_URL` is set; this is an infra-provisioning gap, not a code defect.
- **Impact:** The runaway-billing backstop is a 3×-loose ceiling rather than a hard shared cap, and a mid-day deploy re-opens headroom. Accepted-risk territory given the small absolute dollar exposure and the max-instances pin, but it means `aiSpendGuard` is not yet a precise global cap in prod.
- **Fix:** Provision Cloud Memorystore and set `REDIS_URL` on the Cloud Run service (the single switch that also makes the rate limiters cross-instance — `rateLimitStore.ts`). Until then, keep `--max-instances=3` in lockstep with the documented exposure and treat `N × budget` as the real ceiling. The module header (`aiCostTracker.ts:9-17`) and config comment (`config/index.ts:248-258`) already document this honestly.
- **Evidence:**
  ```ts
  if (config.redis.url) { const client = getRedisClient(); if (client) { ...RedisSpendStore... } }
  memoStore = new InMemorySpendStore(); // default in prod (REDIS_URL unset)
  ```

### F-4 (Info) — Plan-limit counting is a known, documented TOCTOU (overshoot by concurrent requests) — **Info**
- **Location:** `backend/src/services/usageTracker.ts:179-208`; `backend/src/middleware/planGating.ts:91-98`.
- **Observation:** Finite numeric plan limits are enforced count-then-allow with no atomic reservation spanning the gate and the usage write. Two concurrent same-user requests can both read `current = limit - 1` and both proceed, overshooting by the concurrency. This is extensively documented in-code (the `KNOWN RACE (TOCTOU)` block, `usageTracker.ts:179-198`, and the mirror note in `planGating.ts:91-97`) and is the deliberately-deferred L34/L36 item. It is bounded for AI cost specifically because the dollar circuit breaker (§3) is the true billing backstop — overshooting a *request-count* quota does not uncap *dollars*. Noted here for completeness, not as a new finding; the deep plan-gating ownership is [43-plan-gating-billing].
- **Impact:** A user can exceed a per-day chat/guidance count by a small concurrency factor. No dollar uncap (breaker still applies); no PHI exposure.
- **Fix:** As documented in-code — atomic `UPDATE ... SET n = n+1 WHERE n < :limit RETURNING n` (or a DB constraint/trigger) in the same transaction as the usage write. Deferred by product decision.

### F-5 (Info) — `PRICING` currency is an external fact that must be re-confirmed on Anthropic price changes — **Info**
- **Location:** `backend/src/services/aiCostTracker.ts:33-36`.
- **Observation:** The pricing table hardcodes haiku-4.5 at `$0.80/$4.00` per MTok and sonnet-4.5 at `$3.00/$15.00` per MTok. The *structure* is correct and the unknown-model fallback correctly errs expensive (sonnet > haiku, see §1 below), but the literal rates are a point-in-time copy of Anthropic's published pricing. If Anthropic raises prices and this table isn't updated, the budget becomes a fiction (under-counts). This is not a bug today — it is a maintenance dependency the comment `// Token pricing (update when Anthropic changes pricing)` already calls out.
- **Impact:** None today; latent budget drift if rates go stale.
- **Fix:** Add a periodic reconciliation task (or a test that pins the expected rates so a silent edit is caught) when Anthropic pricing is reviewed.

## Checks passed

### 1. Cost-accounting correctness
- [x] `trackAIUsage` fires on all five metered call sites — chat `aiChatController.ts:308`, biomarker guidance `biomarkerRoutes.ts:267`, cost analysis `expenseController.ts:779`, lab extraction `claudeExtraction.ts:170`, SBC extraction `sbcExtraction.ts:847`. The Claude-call-site set and the `trackAIUsage` set are identical save for the SDK singleton (`anthropicClient.ts`, which makes no call) and the tracker definition (`aiCostTracker.ts`) — verified by diffing the two `Grep` file lists.
- [x] Token counts are the actual `response.usage`, not estimates — chat reads `finalMessage.usage?.input_tokens/output_tokens` (`aiChatController.ts:298-299`); guidance `response.usage?.* ?? 0` (`biomarkerRoutes.ts:270-271`); cost analysis `message.usage?.* ?? 0` (`expenseController.ts:782-783`); both extractions `response.usage?.* ?? 0` (`claudeExtraction.ts:173-174`, `sbcExtraction.ts:850-851`).
- [x] Each call site passes the real authenticated `userId`, never `'system'` — `userId = req.user!.id` flows through every site; extraction services take `userId: string` params (`claudeExtraction.ts:96`, `sbcExtraction.ts:759`) supplied by `req.user!.id` at the controllers (`labUploadController.ts:53/216`, `sbcUploadController.ts:64/269`); regression test asserts this (`claudeExtraction.test.ts:184-195`, "never 'system'").
- [x] `PRICING` rates present for the two models in use (`aiCostTracker.ts:34-35`); see F-5 for the currency-maintenance caveat.
- [x] Unknown-model fallback errs EXPENSIVE — `PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929']` (`aiCostTracker.ts:303`); sonnet ($3/$15) > haiku ($0.80/$4), so a model-id change over-counts rather than under-counts.
- [x] `estimatedCostUsd` logged at `toFixed(6)` under the `AICost` service logger (`aiCostTracker.ts:30,320`) — summable downstream.
- [x] `record()` increments BOTH global and per-user — `InMemorySpendStore.record` `aiCostTracker.ts:151-155`; `RedisSpendStore.record` `aiCostTracker.ts:234-237` (per-user only when `userDailyBudgetUsd > 0`).
- [x] Old spend symbols are GONE — grep for `globalSpentUsd|userSpentUsd|rollIfNewDay|recordSpend|isAISpendExceeded|reserveAISpend` over `backend/src` returns no files.

### 2. Spend-guard route coverage
- [x] Exactly 8 `aiSpendGuard` mount points across 5 route files — uploadRoutes `:82,:104,:135`, expenseRoutes `:114`, aiRoutes `:32`, biomarkerRoutes `:136`, insuranceRoutes `:125,:138` (verified by `Grep` over `backend/src/routes`).
- [x] All three `/upload/*` Claude routes carry `aiSpendGuard` (gap stays closed) — lab-report `uploadRoutes.ts:82`, insurance-sbc `:104`, lab-results-ocr `:135`; the two biomarker-ingesting ones also carry `requirePlanLimit('maxBiomarkers')` (`:88`, `:139`).
- [x] SBC asymmetry resolved — both `/insurance/upload-sbc` (`insuranceRoutes.ts:138`) and `/upload/insurance-sbc` (`uploadRoutes.ts:104`) carry `aiSpendGuard`.
- [x] `aiLimiter` + `requirePlanLimit('pdfUploadsPerMonth')` present on every upload route alongside the spend guard (`uploadRoutes.ts:81/84`, `:103/106`, `:134/137`; `insuranceRoutes.ts:124/126`, `:137/139`).
- [x] `GET /health-goals/suggestions` (`healthGoalsRoutes.ts:48`) and `GET /health-needs/analyze` (`healthNeedsRoutes.ts:49`) carry `aiLimiter` but no `aiSpendGuard` — RE-CONFIRMED non-Claude: grep for `getAnthropicClient|anthropic|messages.create|trackAIUsage|claude` in `healthGoalsController.ts` and `healthNeedsController.ts` returns NO matches, so they accrue no Claude spend today. (The `aiLimiter`-superset-minus-`aiSpendGuard` difference is exactly these two benign routes.)
- [x] Guard order preserved — `aiLimiter → aiSpendGuard → blockDemoAI → requirePlanLimit → validate` on aiRoutes (`:31-35`), expenseRoutes (`:113-118`), biomarkerRoutes (`:135-139`); insurance/upload variants run `aiSpendGuard` after `authenticate` (`router.use(authenticate)` insuranceRoutes `:64`, expenseRoutes `:32`, uploadRoutes per-route `authenticate` `:80/102/133`; aiRoutes `requireBearerAuth` `:21`), so `req.user` always resolves before the guard.

### 3. Circuit-breaker behavior & response codes
- [x] Fails CLOSED with 503 `ServiceUnavailableError` on BOTH store error (`aiSpendGuard.ts:46-51`) and budget reached (`aiSpendGuard.ts:60-67`); distinct from `aiLimiter`'s 429 (`rateLimiter.ts:53` via `options.statusCode`) and the plan gate's 403 (`planGating.ts:115`).
- [x] `admit()` checks global BEFORE per-user and returns the offending `scope` — `aiCostTracker.ts:130` (global) then `:134` (user) in-memory; `:209`/`:213` in Redis. Middleware picks the message by scope: global → "temporarily unavailable (daily budget reached)", user → "reached today's AI usage limit. Please try again tomorrow." (`aiSpendGuard.ts:62-64`).
- [x] A budget of `0` disables that scope — `gCap > 0` / `uCap > 0` guards (`aiCostTracker.ts:130,134,117`). `parseBudget` (`config/index.ts:66-76`) warns + falls back to the default (50/5) on NaN/negative so a typo can't silently zero the cap; only a deliberately-set `0` disables.
- [x] `aiSpendGuard` `next()`s through when `req.user?.id` is absent (`aiSpendGuard.ts:30-33`) and always runs after auth (see §2) — an unauthenticated request can't slip past, and the global cap still applies on the next authenticated request.
- [x] Per-UTC-day reset via `roll()` comparing `utcDayKey()` (`aiCostTracker.ts:76-78`, `toISOString().slice(0,10)`) against stored `dayKey`; `admit()` (`:110`) and `record()` (`:152`) both call `roll()` first. Redis keys are UTC-day-stamped with a 48h self-expiring TTL (`:72,:176-179,:185`).

### 4. In-memory / per-instance ceiling (known limitation)
- [x] Accumulator is in-memory/per-instance by default (`InMemorySpendStore`, `aiCostTracker.ts:95-167`); the `N×budget` ceiling is bounded by an explicit `--max-instances=3` pin (`deploy.yml:189`, `deploy-staging.yml:88`). See F-3 — `REDIS_URL` is NOT set in prod, so the in-memory path is live.
- [x] State loss on restart/redeploy is understood and documented (`aiCostTracker.ts:9-13`, `config/index.ts:250-253`).
- [x] Spend recorded post-call by `trackAIUsage`; reservation `RESERVATION_USD = 0.05` charged pre-call (`aiCostTracker.ts:67`). No `Promise.all` fan-out of Claude calls outside the guard — extraction is invoked once per upload (`sbcUploadController.ts:64/269`, `ocrService.ts:215` via `processDocument`), grep for `Promise.all` in the extraction services returns nothing.
- [x] `aiCostTracker` consumes `config.redis.url` via `getStore()` (`:257-274`), importing `getRedisClient` from `rateLimitStore` (`:28`); on `REDIS_URL` set but client-unavailable it logs and falls back to memory rather than crashing (`:266-272`).

### 5. Per-user plan-limit counting (resourceType agreement)
- [x] Chat writer `RESOURCE_TYPE = 'HealthGuide'` (`aiChatController.ts:39`) == reader `RESOURCE_HEALTH_GUIDE = 'HealthGuide'` (`usageTracker.ts:40`); guidance writer `'biomarker_ai_guidance'` (`biomarkerRoutes.ts:154/187/284`) == reader `RESOURCE_BIOMARKER_GUIDANCE = 'biomarker_ai_guidance'` (`usageTracker.ts:41`).
- [x] Reader filters `action: 'READ'` (`usageTracker.ts:104/119`); `logAccess` hardcodes `action: 'READ'` (`auditLog.ts:383`). Both AI-usage success writes go through `logAccess` (`aiChatController.ts:320`, `biomarkerRoutes.ts:284`), not `logCreate` (which stamps `'CREATE'`, `auditLog.ts:408`).
- [x] L-35 (reversed) verified — blocked/failed/initiated chats log under `RESOURCE_TYPE_ATTEMPT = 'HealthGuideAttempt'` (`aiChatController.ts:48`): `CHAT_BLOCKED_NO_BAA` `:150`, `CHAT_INITIATED` `:213`, `CHAT_FAILED` `:353` — a resourceType the counter does NOT match. ONLY the success path writes `'HealthGuide'`/`READ` (`:320`). A failed/blocked call cannot burn the user's daily quota.
- [x] Cost-analysis count derived from `tx.costAnalysis.count` (`usageTracker.ts:123`), PDF count from `tx.userFile.count` (`:108`) — immune to resourceType drift. A `CostAnalysis` row is written on every successful analyze (`expenseController.ts:793`).
- [x] `checkPlanLimit` short-circuits unlimited (`isUnlimited(-1)`, `usageTracker.ts:175`) without a DB read; the unlimited AI tiers (PRO `aiGuidancePerDay`/`costAnalysisPerMonth` = -1 `plans.ts:75-76`, TEAM `aiChatsPerDay` = -1 `:90`) are still bounded by the §3 dollar budget (the spend guard runs regardless of plan tier).
- [x] `NUMERIC_LIMIT_TO_USAGE` (`usageTracker.ts:142-149`) maps all four numeric AI limits — `aiChatsPerDay`, `aiGuidancePerDay`, `costAnalysisPerMonth`, `pdfUploadsPerMonth` — plus `maxBiomarkers`/`insurancePlans`; no AI limit yields the unmapped `current = 0` always-allow path (`:200-201`).
- [x] `requirePlanLimit` reads plan from DB under RLS (`planGating.ts:66-71`), downgrades to FREE when `planExpiresAt` passed (`:73-74`), and fails CLOSED to FREE on DB error (`:76-88`, catch comment explicitly rejects the JWT path).

### 6. Demo-account cost containment
- [x] `blockDemoAI` (403) present on every Claude route in the guard stack — chat `aiRoutes.ts:33`, guidance `biomarkerRoutes.ts:137`, analyze `expenseRoutes.ts:115`, upload-sbc `insuranceRoutes.ts:135` + `uploadRoutes.ts:105`, reanalyze `insuranceRoutes.ts:122`, lab-report `uploadRoutes.ts:83`, lab-results-ocr `:136` (`demoProtection.ts:164-175`).
- [x] `isDemoAccount` returns false when `DEMO_EMAIL` unset (`demoProtection.ts:34`); demo mode hard-fails in production (`config/index.ts:489-495`).

### 7. Scope boundaries (cross-link verified, not re-audited)
- [x] Spend guard runs independently of the BAA gate — a BAA-blocked chat returns 503 in the controller before reaching `trackAIUsage` (`aiChatController.ts:146-165`); BAA boot hard-exit confirmed at `config/index.ts:381-394` (owned by [27-ai-integration]).
- [x] `aiCostTracker` logs no PHI — only `endpoint`, `model`, token counts, `estimatedCostUsd`, `userId` (`aiCostTracker.ts:315-322`); accumulator stores `userId` key + float only.
- [x] L33 server-side disclaimer applied in both spend-bearing AI responses this file owns — `disclaimerToAppend()` chat `aiChatController.ts:289`, guidance `biomarkerRoutes.ts:260` (deep-audited by [27-ai-integration]).
- [x] Every metered path goes through `getAnthropicClient()` (`anthropicClient.ts:46`) — the 5 call sites + the shared singleton are the only `getAnthropicClient|messages.create|messages.stream` hits in `backend/src` (non-test); no off-client escape.

## Unverifiable
- Whether the literal `PRICING` rates (`aiCostTracker.ts:34-35`) match Anthropic's *currently published* pricing — that is an external fact not derivable from the repo. The table structure and fallback are correct (see F-5); the values match the rates published for Haiku 4.5 / Sonnet 4.5 as of the assistant's knowledge cutoff, but a live cross-check against anthropic.com pricing is required to certify currency.
- Whether `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` are set to sensible non-`0` values in the deployed Cloud Run env — the values are not in the repo (they would be set out-of-band on the service). The code defaults (50 / 5) and `parseBudget` fallback (`config/index.ts:256-257,66-76`) are correct; the live env values can only be confirmed with `gcloud run services describe`.

## Out of scope
- BAA gating internals, PHI-in-prompt minimization, response scrubbing (`redactPHI`/`stripPHIFromText`), and the shared-client timeout/key handling — owned by [27-ai-integration], [09-external-apis], [02-encryption]. Confirmed only at the seams (the spend guard runs independent of BAA; the tracker logs no PHI; all metered paths use the shared client).
- The deep plan-gating governor (tiers, the 403 contract, Stripe/billing) — owned by [43-plan-gating-billing]. This review covered only the slice where plan limits meet AI spend (the audit-row counter and whether unlimited tiers stay dollar-bounded). The plan-limit TOCTOU (F-4) is logged as Info and is the deferred L34/L36 item.
- Rate-limiter deep behavior (IPv6 keygen, login-enum oracle) — owned by [08-rate-limiting]. Confirmed only that `aiLimiter` is user-keyed (`rateLimiter.ts:190`) and returns 429 distinct from the 503/403 governors.
