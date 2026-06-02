# 42-ai-cost-control Review — 2026-06-01

Scope: dollar/usage governance of the Claude integration — cost accounting (`trackAIUsage`),
the spend circuit breaker (`aiSpendGuard` / `aiCostTracker`), per-user plan-limit counting, and
spend-guard route coverage. BAA gating, PHI minimization, and shared-client construction are owned
by prompts 27 / 09 / 02 and were cross-checked only at the boundary, not re-audited.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 3 |
| Info | 1 |

## Findings

### F-1 — Claude-backed upload routes have NO dollar circuit breaker (`aiSpendGuard` missing) — High
- **Location:** `backend/src/routes/uploadRoutes.ts:77-85` (`/lab-report`), `:94-102` (`/insurance-sbc`), `:124-132` (`/lab-results-ocr`)
- **Observation:** All three `/upload/*` routes invoke Claude — `lab-report` and the PDF branch of `lab-results-ocr` go through `processDocument` → `processPDFWithClaude` → `extractBiomarkersWithClaude` (`ocrService.ts:393-397`, comment "For PDFs, use Claude API"), and `insurance-sbc` calls `extractInsuranceFromSBC`. Each accrues real cost via `trackAIUsage` (`claudeExtraction.ts:167`, `sbcExtraction.ts:844`). Yet the route guard stacks carry only `aiLimiter` + `blockDemoAI` + `requirePlanLimit('pdfUploadsPerMonth')` — **no `aiSpendGuard`**. When the daily USD budget is exhausted, these routes still call Claude and add to the bill; only the chat/guidance/analyze/insurance-SBC surface is refused.
- **Impact:** The dollar circuit breaker (the documented backstop against runaway Anthropic billing from a compromised key, buggy loop, or abusive account) does not protect the document-extraction surface — and SBC extraction (Sonnet, `max_tokens: 16384`) is the single most expensive metered call in the app. The only ceilings here are the per-user 10/hour rate limit and a monthly PDF count; neither bounds total dollars across users/instances. SBC extraction is reachable two ways with asymmetric protection: `POST /insurance/upload-sbc` (`insuranceRoutes.ts:136`, guarded by `aiSpendGuard`) vs `POST /upload/insurance-sbc` (`uploadRoutes.ts:94-102`, unguarded) — the same expensive operation is dollar-capped on one path and not the other.
- **Fix:** Add `aiSpendGuard` to all three upload routes in `uploadRoutes.ts` (after `authenticate`, alongside `aiLimiter`), matching the order in `aiRoutes.ts`/`insuranceRoutes.ts`. This closes the `/insurance/upload-sbc` vs `/upload/insurance-sbc` asymmetry. If document extraction is intentionally excluded from the dollar cap, document that decision and rely explicitly on `uploadLimiter` + `pdfUploadsPerMonth` as the sole controls.
- **Evidence:**
  ```ts
  // uploadRoutes.ts:94-102 — no aiSpendGuard
  router.post('/insurance-sbc', authenticate, aiLimiter, blockDemoAI,
    requirePlanLimit('pdfUploadsPerMonth'), upload.single('file'), asyncHandler(uploadSBC));
  // ocrService.ts:394-397 — PDF path calls Claude
  if (mimeType === 'application/pdf') { if (isClaudeExtractionConfigured()) {
    return await processPDFWithClaude(buffer, mimeType, startTime, userId);
  ```

### F-2 — Spend accumulator is in-memory/per-instance; effective ceiling is N×budget and resets on redeploy — Medium
- **Location:** `backend/src/services/aiCostTracker.ts:39-41`, config doc at `config/index.ts:188-198`
- **Observation:** The spend state is module-level process memory: `globalSpentUsd`, the `userSpentUsd` Map, and the `spendDayKey` string. There is no shared store and no persistence. Under Cloud Run autoscale with N instances each tracks its own total, so the real global ceiling is N × `AI_DAILY_BUDGET_USD`; any redeploy or scale-down/up zeroes a running total mid-day, so daily spend can exceed even N × budget across a day. `config.redis.url` already exists (`config/index.ts`) and the rate limiters can consume it via `createRateLimitStore` (`rateLimiter.ts:5-14`), but `aiCostTracker` does not read it (verified — no `REDIS_URL`/`config.redis`/`createRateLimitStore` reference in the file).
- **Impact:** If `aiSpendGuard` is the last line of defense against a runaway Anthropic bill, the actual worst-case daily spend is unbounded by a single budget number — it scales with instance count and restart frequency. With the default per-user $5 cap hit simultaneously by many users across N instances, the bill multiplies. The limitation is documented in comments, but it is a real billing-exposure dimension, not a clean control.
- **Fix:** Either (a) pin `--max-instances` and accept N × budget as the documented worst case (record the number), or (b) move the accumulator to the shared atomic store already wired for rate limiting (Cloud Memorystore via `config.redis.url`), mirroring `createRateLimitStore`. Add an alert on the `AICost` structured-log stream / a global-budget breach so a runaway is caught even before the cap.
- **Evidence:**
  ```ts
  // aiCostTracker.ts:39-41
  let spendDayKey = '';
  let globalSpentUsd = 0;
  const userSpentUsd = new Map<string, number>();
  ```

### F-3 — Non-numeric budget env var yields NaN, silently disabling the cap — Medium
- **Location:** `backend/src/config/index.ts:196-197`
- **Observation:** `dailyBudgetUsd: Number(process.env.AI_DAILY_BUDGET_USD ?? '50')` and the per-user equivalent coerce with `Number(...)`. The `?? '50'` default only triggers when the var is *unset*; if it is set to a non-numeric string (e.g. `"50usd"`, a stray space, an empty string round-trips to `0`), `Number()` returns `NaN`. `isAISpendExceeded` gates each scope with `config.ai.dailyBudgetUsd > 0` and `config.ai.userDailyBudgetUsd > 0` (`aiCostTracker.ts:71`/`:74`), and `NaN > 0` is `false` — so a malformed value silently disables that scope's cap with no error and no log.
- **Impact:** A typo or formatting error in the deployed `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` env var turns off the circuit breaker without any startup failure. Combined with F-2 (this is the only dollar backstop), a silent disable removes the runaway-billing protection entirely on that scope.
- **Fix:** Validate at config load: parse with `Number(...)`, then `if (!Number.isFinite(value) || value < 0) throw new Error('AI_DAILY_BUDGET_USD must be a non-negative number')`. Add to the startup validation block already present in `config/index.ts` (it hard-fails on other misconfigs at `:300`, `:399`, `:408`). Note: `0` is an intentional "disable this scope" value, so only reject `NaN`/negative, not `0`.
- **Evidence:**
  ```ts
  // config/index.ts:196-197
  dailyBudgetUsd: Number(process.env.AI_DAILY_BUDGET_USD ?? '50'),
  userDailyBudgetUsd: Number(process.env.AI_USER_DAILY_BUDGET_USD ?? '5'),
  ```

### F-4 — Biomarker guidance only records spend when `response.usage` is present — Low
- **Location:** `backend/src/routes/biomarkerRoutes.ts:247-255`
- **Observation:** The biomarker-guidance call site wraps `trackAIUsage` in `if (response.usage) { ... }`. The other four call sites record cost unconditionally using a `?? 0` fallback (`aiChatController.ts:248-254` uses `finalMessage.usage?.input_tokens ?? 0`; `expenseController.ts:715-721` uses `message.usage?.… ?? 0` (local var is `message`, not `response`); `claudeExtraction.ts:167-173` and `sbcExtraction.ts:844-850` use `response.usage?.… ?? 0`). If the SDK ever returns a response with `usage` undefined, the guidance call's cost is **not** recorded at all — neither the accumulator nor the `AICost` log line fires — whereas the other paths would still record (with 0 tokens) and at least emit the log.
- **Impact:** Inconsistent under-reporting on one metered path. A guidance response missing `usage` accrues a real Anthropic charge that never reaches the spend accumulator, letting the per-user/global budget run slightly hot and dropping the audit-adjacent `AICost` log entry. Low likelihood (the SDK normally populates `usage`), but it is the one call site that can skip tracking entirely.
- **Fix:** Mirror the other call sites — call `trackAIUsage` unconditionally with `response.usage?.input_tokens ?? 0` / `?? 0`, removing the `if (response.usage)` guard at `biomarkerRoutes.ts:247`.
- **Evidence:**
  ```ts
  // biomarkerRoutes.ts:247-255
  if (response.usage) {
    trackAIUsage({ endpoint: 'biomarker-guidance', model: response.model,
      inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, userId });
  }
  ```

### F-5 — Blocked/failed chats consume the user's daily chat quota — Low
- **Location:** `backend/src/controllers/aiChatController.ts:130-132` (`CHAT_BLOCKED_NO_BAA`), `:289-293` (`CHAT_FAILED`); counter at `usageTracker.ts:69-75`
- **Observation:** `getUserUsage` counts `aiChatsToday` by filtering `AuditLog` rows on `resourceType = 'HealthGuide'` + `action = 'READ'` + `createdAt >= today` (`usageTracker.ts:69-75`) — it does NOT filter the `operation` metadata field. `logAccess` always stamps `action: 'READ'` (`auditLog.ts:318`). The chat handler writes a `HealthGuide`/`READ` row for the success case (`operation: 'CHAT'`), for the BAA-blocked case (`operation: 'CHAT_BLOCKED_NO_BAA'`, line 130), and for the failure case (`operation: 'CHAT_FAILED'`, line 289) alike. So a chat that was refused (no BAA) or errored before producing output still increments today's `aiChatsToday` and burns one of the user's daily chat allotment.
- **Impact:** A user can be denied chat access for the rest of the day by failures that never produced a Claude response — e.g. if BAA is misconfigured, every blocked attempt counts against the FREE tier's 3/day. This is a product-correctness / fairness issue, not a cost leak (no spend on blocked/failed calls), but it silently consumes quota. Confirm intended; today the gate counts them.
- **Fix:** If failed/blocked chats should not count, either (a) filter the usage count by `operation = 'CHAT'`, or (b) write the blocked/failed audit rows with a non-`READ` action / distinct resourceType so they fall outside the counter's `WHERE`. Option (a) keeps the audit trail intact.
- **Evidence:**
  ```ts
  // aiChatController.ts:130-132 — blocked attempt still writes a HealthGuide/READ row
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'CHAT_BLOCKED_NO_BAA',
  });
  ```

### F-6 — Plan-gate DB-failure fallback degrades to the (possibly stale, more-permissive) JWT plan — Low
- **Location:** `backend/src/middleware/planGating.ts:76-84`
- **Observation:** `requirePlanLimit` deliberately reads the plan from the DB under RLS and runtime-downgrades to FREE when `planExpiresAt` has passed (`planGating.ts:66-75`) — a good control. But on a DB error it catches and falls back to `normalizePlan(authReq.user?.plan)`, i.e. the JWT snapshot. The JWT plan can be up to 15 min stale (per the same file's comment at `:50-53`) and does not carry the `planExpiresAt` downgrade — so during a transient DB outage an expired or recently-downgraded PRO/TEAM user is gated at their old, more-permissive ceiling.
- **Impact:** A DB blip widens the request-count gate to the JWT's snapshot plan. This only loosens the *count* governor; the §3 dollar cap (F-1/F-2 caveats aside) still applies independently, so blast radius is bounded. Documented and intentional (avoids wedging every gated route on a DB outage), but worth recording as a defense-in-depth gap.
- **Fix:** Accept as-is (availability tradeoff) or fail closed to FREE limits on DB error instead of trusting the JWT plan. If kept, ensure the `logger.warn` at `:80` is alerted so prolonged fallback windows are visible.
- **Evidence:**
  ```ts
  // planGating.ts:80-83
  logger.warn('Plan lookup failed; falling back to JWT plan', { ... });
  effectivePlan = normalizePlan(authReq.user?.plan);
  ```

### F-7 — `PRICING` table currency is unverifiable against live Anthropic rates — Info
- **Location:** `backend/src/services/aiCostTracker.ts:16-19`
- **Observation:** The pricing table hardcodes Haiku 4.5 at $0.80/$4.00 per M tokens and Sonnet 4.5 at $3.00/$15.00 per M tokens. The structure is correct (per-token rates, both in-use models present) and the unknown-model fallback errs expensive (falls back to Sonnet, the pricier of the two — see Checks passed). Whether these exact rates match Anthropic's current published pricing cannot be confirmed from the repo alone.
- **Impact:** If the published rates have changed, the budget becomes a fiction (over- or under-counts). No code defect — this is a data-freshness reminder.
- **Fix:** Cross-check $0.80/$4.00 (Haiku 4.5) and $3.00/$15.00 (Sonnet 4.5) against current Anthropic pricing during quarterly review; update the table comment at `:15` ("update when Anthropic changes pricing").
- **Evidence:**
  ```ts
  'claude-haiku-4-5-20251001': { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  'claude-sonnet-4-5-20250929': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  ```

## Checks passed

### §1 Cost-accounting correctness
- [x] `trackAIUsage` fires on all five metered call sites — chat `aiChatController.ts:248`, guidance `biomarkerRoutes.ts:248`, cost analysis `expenseController.ts:715`, lab extraction `claudeExtraction.ts:167`, SBC extraction `sbcExtraction.ts:844`. The two grep lists (Claude call sites vs `trackAIUsage` callers) match exactly — `getAnthropicClient/messages.create/messages.stream` resolves to the same 5 controllers/services (plus the `anthropicClient.ts` constructor and `aiCostTracker.ts` definer). No off-client escape.
- [x] Token counts are the response's actual `usage`, not estimates — chat reads `finalMessage.usage` (`aiChatController.ts:238-239`); guidance/analysis/extraction read `usage.input_tokens`/`output_tokens` (`biomarkerRoutes.ts:251-252`, `expenseController.ts:718-719` via `message.usage`, `claudeExtraction.ts:170-171`, `sbcExtraction.ts:847-848`).
- [x] Each call site passes the real authenticated `userId`, never `'system'` — controllers use `req.user!.id` (`aiChatController.ts:119`, biomarker handler `:129`, `expenseController.ts:615`); extraction services receive `userId` as a parameter forwarded from `req.user!.id` (`labUploadController.ts:40`, `sbcUploadController.ts:37`, passed at `shared.ts:338`). Regression test asserts `usageArgs.userId` `.not.toBe('system')` (`claudeExtraction.test.ts:182-190`).
- [x] Unknown-model fallback errs expensive — `PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929']` (`aiCostTracker.ts:92`); Sonnet ($3/$15) is the most expensive entry vs Haiku ($0.80/$4), so a model-id change over-counts rather than silently under-counting.
- [x] Cost logged with summable precision under the `AICost` logger — `estimatedCostUsd: estimatedCostUsd.toFixed(6)` emitted via `aiCostLogger.info` (`aiCostTracker.ts:13, 97-104`).
- [x] `recordSpend` increments BOTH global and per-user scopes — `globalSpentUsd += costUsd` and `userSpentUsd.set(...)` (`aiCostTracker.ts:58-59`).

### §2 Spend-guard route coverage
- [x] Exactly five routes carry `aiSpendGuard` — `biomarkerRoutes.ts:123`, `expenseRoutes.ts:114`, `aiRoutes.ts:32`, `insuranceRoutes.ts:136` (upload-sbc), `insuranceRoutes.ts:123` (reanalyze). (The gap on the three `/upload/*` routes is reported as F-1, not softened.)
- [x] Unguarded upload routes still carry `aiLimiter` + `requirePlanLimit('pdfUploadsPerMonth')` (the only cost controls there) — `uploadRoutes.ts:80,82 / 97,99 / 127,129`.
- [x] `GET /health-goals/suggestions` (`healthGoalsRoutes.ts:48`) and `GET /health-needs/analyze` (`healthNeedsRoutes.ts:49`) carry `aiLimiter` only and accrue no Claude spend today — re-confirmed: `healthGoalsController.ts` and `healthNeedsController.ts` contain zero references to `getAnthropicClient`/`messages.create`/`anthropic`/`claude`/`trackAIUsage` (grep returned no matches).
- [x] Guard order preserved on the chat route: `aiLimiter → aiSpendGuard → blockDemoAI → requirePlanLimit → validate` (`aiRoutes.ts:31-35`); insurance upload routes order `blockDemoAI → uploadLimiter → aiLimiter → aiSpendGuard → requirePlanLimit` after `router.use(authenticate)` (`insuranceRoutes.ts:64, 120-127, 133-138`), so `aiSpendGuard` still runs after auth and `req.user` resolves.

### §3 Circuit-breaker behavior & response codes
- [x] Fails closed with 503 via `ServiceUnavailableError`, distinct from `aiLimiter`'s 429 and the plan gate's 403 — `aiSpendGuard.ts:42`, `rateLimiter.ts:115` (`AI_RATE_LIMIT_EXCEEDED`), `planGating.ts:104` (403 `PLAN_LIMIT_EXCEEDED`).
- [x] `isAISpendExceeded` checks global before per-user and returns `scope` — `aiCostTracker.ts:71-77`; the middleware picks a per-user vs global message off `scope` ("try again tomorrow" vs "temporarily unavailable") — `aiSpendGuard.ts:43-46`. Test confirms ordering (`aiCostTracker.test.ts:52-60`).
- [x] A budget of `0` disables that scope via the `> 0` guards — `aiCostTracker.ts:71, 74`. (The NaN-disable hole is reported as F-3.)
- [x] `aiSpendGuard` calls `next()` when `req.user?.id` is absent and is mounted after `authenticate`/`requireBearerAuth` on every route — `aiSpendGuard.ts:24-28`; `aiRoutes.ts:21` (`requireBearerAuth`), `insuranceRoutes.ts:64`, `expenseRoutes.ts:32`, `biomarkerRoutes.ts:47`.
- [x] Per-UTC-day reset uses UTC string compare — `utcDayKey()` returns `new Date().toISOString().slice(0,10)` (`aiCostTracker.ts:43-44`); `rollIfNewDay` zeroes both totals on key change (`:47-54`); `isAISpendExceeded` calls `rollIfNewDay()` before reading (`:70`).

### §4 In-memory / per-instance ceiling
- [x] Accumulator is in-memory/per-instance with no shared store — confirmed (F-2); grep for `REDIS_URL|config.redis|createRateLimitStore` in `aiCostTracker.ts` returns nothing.
- [x] Spend is post-call with no pre-debit; no concurrent AI fan-out exists — every `Promise.all` in `backend/src` is over DB reads/decryption/file ops, none over Claude calls (the 5 metered sites each issue a single `messages.create`/`stream`). So a runaway is bounded by the next call's refusal as designed.

### §5 Per-user plan-limit counting
- [x] Audit `resourceType` strings agree — chat writer `RESOURCE_TYPE = 'HealthGuide'` (`aiChatController.ts:38`) == reader `RESOURCE_HEALTH_GUIDE = 'HealthGuide'` (`usageTracker.ts:38`); guidance writer `'biomarker_ai_guidance'` (`biomarkerRoutes.ts:141, 174, 266`) == reader `RESOURCE_BIOMARKER_GUIDANCE = 'biomarker_ai_guidance'` (`usageTracker.ts:39`).
- [x] Reader filters `action: 'READ'` (`usageTracker.ts:73, 88`) and both AI usages go through `logAccess`, which hardcodes `action: 'READ'` (`auditLog.ts:318`) — not `logCreate`/`logUpdate`.
- [x] Cost-analysis count comes from a real table and a `CostAnalysis` row is written on success — `tx.costAnalysis.count` (`usageTracker.ts:92`), `tx.costAnalysis.create` (`expenseController.ts:728-729`); PDF count from `tx.userFile.count` (`usageTracker.ts:77`), immune to resourceType drift.
- [x] `checkPlanLimit` short-circuits unlimited (`-1`) tiers without a DB read — `isUnlimited(limitValue)` returns early (`usageTracker.ts:144-146`); PRO/TEAM `-1` AI tiers (`plans.ts:71-72, 86, 90-91`) are still bounded by the §3 dollar cap (the spend guard runs independent of plan tier).
- [x] `NUMERIC_LIMIT_TO_USAGE` maps every numeric AI limit — `aiChatsPerDay`, `aiGuidancePerDay`, `costAnalysisPerMonth`, `pdfUploadsPerMonth` all present (`usageTracker.ts:111-118`); no AI limit falls through to the always-allow `current = 0` path.
- [x] `requirePlanLimit` reads plan from DB under RLS and downgrades on `planExpiresAt` — `withRLSContext(userId, …) tx.user.findUnique` (`planGating.ts:66-71`), expiry downgrade to FREE (`:73-75`). (DB-failure fallback reported as F-6.)

### §6 Demo-account cost containment
- [x] `blockDemoAI` (403) present on every Claude-backed route — chat `aiRoutes.ts:33`, guidance `biomarkerRoutes.ts:124`, analyze `expenseRoutes.ts:115`, upload-sbc `insuranceRoutes.ts:133`, reanalyze `insuranceRoutes.ts:120`, and all three upload routes `uploadRoutes.ts:81, 98, 128`.
- [x] `isDemoAccount` returns false when `DEMO_EMAIL` is unset — `if (!config.demo.email || config.demo.email.trim() === '') return false` (`demoProtection.ts:34`); `config.demo.email` defaults to `''` (`config/index.ts:143`); demo mode hard-fails in production (`config/index.ts:408-414`).

### §7 Scope boundaries (cross-link only)
- [x] Spend guard runs independently of the BAA gate — a BAA-blocked chat returns 503 at `aiChatController.ts:133` before reaching `trackAIUsage` at `:248`, so no spend accrues; prod boot hard-exits on BAA-unset+key-set at `config/index.ts:300-306`. (BAA gate owned by prompt 27 — not re-audited.)
- [x] `aiCostTracker` logs no PHI — only `endpoint`, `model`, `inputTokens`, `outputTokens`, `estimatedCostUsd`, `userId` (`aiCostTracker.ts:97-104`); no prompt/response/health value.
- [x] Every metered path goes through `getAnthropicClient()` — chat `aiChatController.ts:190`, guidance `biomarkerRoutes.ts:231`, analysis `expenseController.ts:684`, extraction services via the shared client (no raw `fetch` to `api.anthropic.com` remains; the F-29 migration note at `biomarkerRoutes.ts:223-229` confirms the last raw-fetch site was removed).

## Unverifiable
- Whether the hardcoded `PRICING` rates match Anthropic's *current* published pricing — cannot be confirmed from the repo (see F-7 Info). The table structure and fallback direction are correct; only the numeric currency is external.
- Whether a `--max-instances` cap is actually pinned on the deployed Cloud Run service — the spend-ceiling math in F-2 depends on it, but deployment config (`gcloud run` flags / IaC) is not in the reviewed source tree. CLAUDE.md and prior memory reference Cloud Run but no `--max-instances` value was found in `backend/src` or visible deploy config.

## Out of scope
- BAA gating internals (`ANTHROPIC_BAA_ACTIVE`, prod boot hard-exit, per-caller runtime refusal) — owned by prompt 27; verified only at the spend-guard boundary (Checks passed §7).
- PHI-in-prompt minimization / response scrubbing (`redactPHI`, `stripPHIFromText`) — owned by prompts 27 / 02; confirmed only that `aiCostTracker` itself logs no PHI.
- Shared-client construction, timeouts, key handling, key rotation (`anthropicClient.ts`) — owned by prompt 09; confirmed only that all metered paths route through `getAnthropicClient()`.
- The plan-limit *governor* itself (tier definitions, the 403 contract, the unwired Stripe/billing path) — owned by prompt 43; this review covered only the slice where plan limits meet AI spend (the audit-row counter and unlimited-tier dollar bounding).

## Prompt drift
None material. The spec's line-number anchors all resolved correctly against the live code (e.g. `aiCostTracker.ts:92` fallback, `:69` `isAISpendExceeded`, `aiSpendGuard.ts:25` no-user bail, `usageTracker.ts:38-39` resource constants, `config/index.ts:196-197` budgets). One minor note: the spec's Frontend bullet cites `src/services/api/ai.ts` "lines 135-147" for both `usage` reading and the 403 decode; the 403 `PLAN_LIMIT_EXCEEDED` decode is at `:135-147`, but the `message_stop` usage read is at `:193-197` — a documentation imprecision, not a code mismatch.
