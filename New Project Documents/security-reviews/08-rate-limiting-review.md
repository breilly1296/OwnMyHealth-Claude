# Rate Limiting Review — 2026-06-16

> Scope: `backend/src/middleware/rateLimiter.ts`, `rateLimitStore.ts`, `aiSpendGuard.ts`, `services/aiCostTracker.ts`, `app.ts`, and per-route limiter attachment across all 18 route files. Static review only; no code modified. Verified against HEAD `fb2cd32`.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 4 |

The rate-limiting subsystem is in good shape: all 8 limiters exist with unique store prefixes, the global limiter is registered before routes, AI routes stack the count limiter + the dollar circuit breaker, and the spend guard fails closed (503) on both budget-exhaustion and store error. The findings cluster around two real seams — the in-process MemoryStore default (N×limit on multi-instance Cloud Run) and two AI endpoints that count-limit but escape the dollar guard — plus hygiene items.

## Findings

### F-1 — Two Claude-backed endpoints bypass the dollar circuit breaker and the demo/plan guardrails — Medium
- **Location:** `backend/src/routes/healthGoalsRoutes.ts:48`, `backend/src/routes/healthNeedsRoutes.ts:49`
- **Observation:** `GET /health-goals/suggestions` and `GET /health-needs/analyze` both trigger Claude calls but are mounted with **only** `aiLimiter` — no `aiSpendGuard`, no `blockDemoAI`, no `requirePlanLimit(...)`. Every other AI route stacks all four (e.g. `aiRoutes.ts:31-34`, `biomarkerRoutes.ts:135-138`, `uploadRoutes.ts:81-88`).
- **Impact:** A runaway client loop (or a demo account, or an over-quota free user) hitting these two routes consumes Anthropic budget that the per-user/global dollar cap (`AI_USER_DAILY_BUDGET_USD`/`AI_DAILY_BUDGET_USD`) never observes until the 10/hr count cap trips. The count cap bounds per-user request *volume*, but with N Cloud Run instances and MemoryStore (see F-2) the effective per-user ceiling is 10N/hr, and the spend accumulator — the one control that would refuse further calls once the dollar budget is reached — is simply not in the chain. Demo accounts can also burn the shared API key here since `blockDemoAI` is absent. Blast radius is limited to two read endpoints with modest per-call token counts, hence Medium not High.
- **Fix:** Insert `aiSpendGuard` immediately after `aiLimiter` on both routes, and add `blockDemoAI` + an appropriate `requirePlanLimit(...)` (mirroring the chain in `aiRoutes.ts`). Both are GETs, so confirm the spend guard's `res.on('finish'/'close')` settle works for non-streaming GET responses (it does — it is response-lifecycle, not method, dependent).
- **Evidence:**
  ```ts
  // healthGoalsRoutes.ts:48
  router.get('/suggestions', aiLimiter, asyncHandler(suggestGoals));
  // healthNeedsRoutes.ts:49
  router.get('/analyze', aiLimiter, asyncHandler(analyzeHealthNeeds));
  ```
  vs. the full chain at `aiRoutes.ts:29-37`: `aiLimiter, aiSpendGuard, blockDemoAI, requirePlanLimit('aiChatsPerDay'), ...`.

### F-2 — Default MemoryStore makes every limit N×limit on multi-instance Cloud Run — Medium
- **Location:** `backend/src/middleware/rateLimitStore.ts:79-90` (returns `undefined` when `REDIS_URL` unset), `backend/src/config/index.ts:185-187` (`redis.url` defaults to `''`), and the AI spend accumulator at `backend/src/services/aiCostTracker.ts:257-274` (falls back to `InMemorySpendStore`).
- **Observation:** When `REDIS_URL` is unset — the current dev/staging/CI/prod default per the module header and `config.redis.url` default — `createRateLimitStore` returns `undefined`, so `express-rate-limit` uses its in-process `MemoryStore`. Counters are per-instance. The same applies to the dollar circuit breaker, which selects `InMemorySpendStore`. So with N instances, the login cap of 5 becomes 5N failed attempts/window, the AI count cap becomes 10N/hr, and the *dollar* cap becomes N×`AI_DAILY_BUDGET_USD` before any instance refuses.
- **Impact:** The only thing bounding the worst case is the Cloud Run `--max-instances` pin (referenced as audit #37 / `--max-instances=3` in `rateLimitStore.ts:7`). Brute-force protection, AI cost control, and the billing breaker all degrade proportionally to instance count. This is a defense-in-depth weakening, not a direct exploit (the caps still apply per instance and `--max-instances` caps the multiplier), so Medium.
- **Fix:** Provision Cloud Memorystore and set `REDIS_URL` before scaling `--max-instances` above 1. The code path is already built and shared between the limiters and the spend store (`getRedisClient()` is reused) — this is an infra/config action, not a code change. Until then, keep `--max-instances` low and document the N×limit posture in the runbook.
- **Evidence:**
  ```ts
  // rateLimitStore.ts:80-81
  const c = getRedisClient();
  if (!c) return undefined;   // → express-rate-limit MemoryStore (per-instance)
  ```
  ```ts
  // config/index.ts:186
  url: process.env.REDIS_URL || '',
  ```

### F-3 — Redis construction failure silently degrades to per-instance MemoryStore (limiters) / memory accumulator (spend cap) — Medium
- **Location:** `backend/src/middleware/rateLimitStore.ts:62-71` (catch → `client = null`), `backend/src/services/aiCostTracker.ts:266-273` (Redis set but client unavailable → `InMemorySpendStore`).
- **Observation:** If `REDIS_URL` is set but `ioredis` cannot be loaded/constructed at boot, both the rate limiters and the AI spend cap log an error and fall back to in-process stores. After a deliberate decision to require Redis for multi-instance correctness, an operator who sets `REDIS_URL` will reasonably believe the shared store is active; a construction failure silently reverts to N×limit. Note this only covers *construction* failure — a runtime Redis command error in the spend path is correctly fail-closed (`aiSpendGuard.ts:38-52`), and the rate-limiter `error` handler at `rateLimitStore.ts:55-60` only logs (express-rate-limit's own behavior on a store command error then governs).
- **Impact:** A flaky/missing Redis silently downgrades the security posture from "consistent across instances" back to "per-instance," exactly when the operator expects the opposite. This is the prompt's explicitly-called-out "confirm the fallback-on-error path is acceptable" concern. Medium because it requires a Redis misconfig and is bounded by `--max-instances`, but it is a silent, monitoring-only signal.
- **Fix:** Consider making Redis construction failure fail-fast (refuse to boot) when `REDIS_URL` is explicitly set AND the deployment is multi-instance (`OMH_DEPLOY_ENFORCE_PROD` / a `--max-instances>1` signal), rather than silently degrading. At minimum, emit a high-severity alert metric (not just `logger.error`) on the fallback path so the degraded posture pages someone.
- **Evidence:**
  ```ts
  // rateLimitStore.ts:65-70
  logger.error('Failed to initialize Redis rate-limit store; using MemoryStore', { ... });
  client = null;
  ```

### F-4 — `strictAuthLimiter` only counts failed logins, leaving a credential-confirmation oracle and unbounded successful-login volume — Low
- **Location:** `backend/src/middleware/rateLimiter.ts:118` (`skipSuccessfulRequests: true`), keyed by `email:IP` at `:119-126`.
- **Observation:** Login is capped at 5 *failed* attempts per `email:IP` per 15 min. A successful login does not count. An attacker with a list of valid credential pairs (e.g. from a credential-stuffing dump) can authenticate unlimited times — only wrong guesses are throttled. Combined with the `email:IP` key, an attacker who rotates IPs (or sits behind a large NAT/IPv6 range, partially mitigated by the /64 normalization at `:124`) gets a fresh 5-attempt budget per IP/64.
- **Impact:** Standard brute-force of a single account is well-bounded (5 wrong guesses/15min/email/IP). The residual is (a) no throttle on successful auth volume from a stuffing list, and (b) per-IP budget reset on IP rotation. This is the documented L-1/L-2 design (case/whitespace email normalization + IPv6 /64 keying both implemented), so the remaining gap is intentional and low.
- **Fix:** If stuffing is a concern, add a complementary IP-only login counter (counting all attempts, success included) on top of the `email:IP` failed-only counter, or move to an account-lockout signal independent of IP. The account-lockout config already exists (`config.security.maxLoginAttempts`/`lockoutDuration`, `config/index.ts:157-158`) — confirm it is enforced in the login controller as the real per-account backstop (out of scope for this prompt; flag for the auth review).
- **Evidence:**
  ```ts
  // rateLimiter.ts:118
  skipSuccessfulRequests: true, // Only count failed attempts
  ```

### F-5 — FHIR sync caps request count but not per-request outbound work (documented L-13) — Low
- **Location:** `backend/src/routes/fhirRoutes.ts:54-62` (`POST /sync/:connectionId` gated only by `sensitiveLimiter`).
- **Observation:** Each sync fans out to the external FHIR server (paginated Observation/DiagnosticReport pulls) plus downstream Claude/OCR work, but the only cap is the shared user-keyed `sensitiveLimiter` (10/hr), which it also shares with connect + delete-connection. That bounds request *count*, not the unbounded per-sync work (page count, token usage). The code documents this as L-13 inline.
- **Impact:** A user (or compromised account) can trigger up to 10 syncs/hr, each of which may fetch many pages and spend Claude/OCR budget that is not metered by `aiSpendGuard` (the FHIR sync path does not pass through the AI spend middleware). The 10/hr count cap × unbounded per-call cost is a cost-amplification vector. Low because it requires a connected Quest/FHIR account (plan-gated `questFhirIntegration`) and is bounded to 10/hr.
- **Fix:** As the inline note suggests, add a cost-aware budget that accounts for pages fetched / tokens spent during sync (route the FHIR-triggered Claude/OCR work through the same spend accumulator), rather than a second count-based limiter. Tracked as L-13.
- **Evidence:**
  ```ts
  // fhirRoutes.ts:46-53 (comment) + :54-62 (route) — only sensitiveLimiter, no spend guard
  router.post('/sync/:connectionId', validate(...), sensitiveLimiter, blockDemoAI, requirePlanFeature('questFhirIntegration'), csrfProtection, asyncHandler(fhir.triggerSync));
  ```

### F-6 — Document AI / OCR billing is outside the AI dollar accumulator — Low
- **Location:** `backend/src/services/aiCostTracker.ts:33-36` (PRICING only covers Claude models), `:302-323` (`trackAIUsage` only records token-priced Claude cost); upload routes `uploadRoutes.ts:78-142`.
- **Observation:** The upload routes correctly stack `aiSpendGuard` now (closing the old "uploads bypass the budget guard" gap), but the spend accumulator's reservation/settle and `record()` only model the **Claude** token estimate. Google Document AI billing (per-page OCR on the `lab-results-ocr` and image paths) is never added to the accumulator, so the dollar cap reflects Claude spend only.
- **Impact:** A user repeatedly uploading large multi-page documents incurs Document AI charges that the `AI_DAILY_BUDGET_USD`/`AI_USER_DAILY_BUDGET_USD` breaker does not see. The `uploadLimiter` (20/hr) and `aiLimiter` (10/hr) count caps bound volume, so this is a metering-completeness gap, not an uncapped spend hole. Low.
- **Fix:** Extend `trackAIUsage` (or add a sibling `trackOCRUsage`) to add a per-page Document AI cost estimate to the same accumulator so the dollar breaker reflects total external AI spend, not just Claude. This is the "subtler residual concern" the prompt itself flags.
- **Evidence:**
  ```ts
  // aiCostTracker.ts:33-36 — PRICING keys are claude-* only
  const PRICING: Record<string, { input: number; output: number }> = {
    'claude-haiku-4-5-20251001': { ... },
    'claude-sonnet-4-5-20250929': { ... },
  };
  ```

### F-7 — `internalRoutes` maintenance endpoint relies only on the IP-keyed global limiter for throttling — Low
- **Location:** `backend/src/app.ts:269` (mount after `standardLimiter` at `:220`), `backend/src/routes/internalRoutes.ts:40-72`.
- **Observation:** `POST /api/v1/internal/audit-cleanup` runs an unbounded DB retention sweep. It is mounted after the global `standardLimiter` (so it inherits the IP-keyed 100/15min global cap) and is protected by a constant-time shared-secret check that returns 404 when unset and 401 on mismatch. It has no dedicated rate limiter.
- **Impact:** Low. The shared-secret gate is the real control (an attacker without the token gets 401/404 and the heavy `cleanupOldLogs()` never runs), and the global limiter bounds raw request volume. The residual is that a leaked `AUDIT_CLEANUP_TOKEN` would allow up to 100 cleanup invocations/15min from one IP. Worth noting since the endpoint does heavy, RLS-bypassing work.
- **Fix:** Optionally attach a dedicated low-ceiling limiter (e.g. a few/hour) to the internal cleanup route as defense-in-depth, so even a leaked token can't drive repeated full-table sweeps. The token rotation is the primary mitigation.
- **Evidence:**
  ```ts
  // app.ts:220 then :269
  app.use(standardLimiter);
  ...
  app.use(`/api/${config.apiVersion}/internal`, internalRoutes);
  ```

## Checks passed

### Limiter inventory (all 8 exist, unique prefixes)
- [x] `standardLimiter` — `config.rateLimit.windowMs`/`maxRequests` (100/15min default), IP-keyed — `rateLimiter.ts:66-85`, defaults at `config/index.ts:176-179`.
- [x] `authLimiter` — 20/15min — `rateLimiter.ts:88-102`.
- [x] `strictAuthLimiter` — 5/15min, keyed `email:IP`, `skipSuccessfulRequests: true` — `rateLimiter.ts:105-131`.
- [x] `uploadLimiter` — 20/hour — `rateLimiter.ts:134-148`.
- [x] `sensitiveLimiter` — 10/hour, user-keyed w/ IP fallback — `rateLimiter.ts:151-174`.
- [x] `aiLimiter` — 10/hour, user-keyed w/ /64 IP fallback — `rateLimiter.ts:177-203`.
- [x] `providerAccessRequestLimiter` — 10/hour, user-keyed — `rateLimiter.ts:211-237`.
- [x] `bulkOperationLimiter` — 30/hour — `rateLimiter.ts:240-254`.
- [x] All 8 use a distinct `createRateLimitStore('<prefix>')` prefix (standard / auth / strict-auth / upload / sensitive / ai / provider-access-request / bulk) — verified no collisions, `rateLimiter.ts:67,89,106,135,152,178,212,241`.

### Auth endpoints
- [x] `POST /auth/login` — `strictAuthLimiter` (5/15min) — `authRoutes.ts:48-53`.
- [x] `authLimiter` registered globally on the auth router via `router.use(authLimiter)` — `authRoutes.ts:34` (covers `/register` etc.).
- [x] `POST /auth/forgot-password`, `/reset-password`, `/resend-verification`, `/confirm-email-change`, `/change-email` — all `strictAuthLimiter` to prevent token brute-force/enumeration/email-bombing — `authRoutes.ts:79-92,71-76,96-101,133-139`.

### Resource-intensive endpoints
- [x] `router.use(uploadLimiter)` on all upload routes — `uploadRoutes.ts:27`.
- [x] `POST /upload/lab-report`, `/insurance-sbc`, `/lab-results-ocr` each have `aiLimiter` + `aiSpendGuard` (upload-route budget gap closed) — `uploadRoutes.ts:81-82,104-105,134-135`.
- [x] `POST /biomarkers/:id/guidance` — `aiLimiter` + `aiSpendGuard` — `biomarkerRoutes.ts:135-136`.
- [x] `POST /expenses/analyze` — `aiLimiter` + `aiSpendGuard` (the `/analyses` GET list is correctly NOT AI-gated) — `expenseRoutes.ts:113-114`, list at `:123-127`.
- [x] `POST /ai/chat` — `aiLimiter` + `aiSpendGuard` — `aiRoutes.ts:31-32`.
- [x] `POST /insurance/upload-sbc` and `PUT /insurance/plans/:id/reanalyze` — `aiLimiter` + `aiSpendGuard` — `insuranceRoutes.ts:124-125,137-138`.
- [x] `POST /biomarkers/batch` — `bulkOperationLimiter` — `biomarkerRoutes.ts:103-104`.
- [x] `GET /files/:id/download` — `sensitiveLimiter` — `fileRoutes.ts:59-61`.
- [x] `GET /settings/export-data`, `DELETE /settings/delete-data`, `DELETE /settings/delete-account` — `sensitiveLimiter` (also on profile/notifications/health-profile) — `settingsRoutes.ts:86-89,98-104,107-113`.
- [x] `POST /provider/patients/request` — `providerAccessRequestLimiter` — `providerRoutes.ts:171-173`.
- [x] `sensitiveLimiter` on FHIR connect/sync/delete — `fhirRoutes.ts:31,57,68`; and the admin permanent-delete — `adminRoutes.ts:500-502`.

### Rate limit headers & response
- [x] `standardHeaders: true, legacyHeaders: false` on all 8 limiters → emits `RateLimit-*` standard headers (incl. `Retry-After` on 429) — e.g. `rateLimiter.ts:77-78,99-100,116-117,145-146,162-163,188-189,222-223,251-252`.
- [x] 429 body is a structured `ApiResponse` with a non-leaky message per limiter; `makeRateLimitHandler` preserves `options.statusCode`/`options.message` — `rateLimiter.ts:42-54`.
- [x] 429 breaches are logged (`logger.warn('Rate limit exceeded', ...)`) with a HASHED key (SHA-256/16) so no raw email/IP reaches logs — `rateLimiter.ts:26-27,45-52`.

### Rate limit key
- [x] Unauthenticated limiters key by IP via `ipKeyGenerator` wrapper, collapsing IPv6 to /64 (L-2) and avoiding `ERR_ERL_KEY_GEN_IPV6` — `rateLimiter.ts:14-21`.
- [x] Authenticated cost/abuse limiters (`aiLimiter`, `sensitiveLimiter`, `providerAccessRequestLimiter`) key by `req.user.id` with IP fallback — `rateLimiter.ts:164-168,190-193,224-227`. All three sit behind `authenticate`/`requireBearerAuth`/`requireRole`, so the IP fallback is effectively unreachable in normal flow (answers prompt Q1).
- [x] Login email is normalized (trim+lowercase) before keying to prevent budget multiplication (L-1) — `rateLimiter.ts:29-33,123`.
- [x] `app.set('trust proxy', 1)` so `req.ip` reflects the real client behind Cloud Run's LB — `app.ts:120`.

### Global registration & order
- [x] `standardLimiter` registered globally via `app.use(standardLimiter)` BEFORE the route mount, so it applies first (answers prompt Q2) — `app.ts:220` vs route mount `:265`.
- [x] `standardLimiter` re-applied explicitly on `GET /api/health/db` — `app.ts:318`.

### AI dollar-cap circuit breaker (`aiSpendGuard` / `aiCostTracker`)
- [x] `aiSpendGuard` calls `admitAISpend(userId)` which atomically reserves `RESERVATION_USD = $0.05` and returns `Admission{admitted,scope,settle}` — `aiSpendGuard.ts:37`, `aiCostTracker.ts:67,285-287`.
- [x] `settle` registered on both `'finish'` and `'close'`; idempotent — `aiSpendGuard.ts:74-75`, idempotency guard `aiCostTracker.ts:139-148,218-231`.
- [x] Reserve/settle model; the old `isAISpendExceeded` read is GONE — Grep for `isAISpendExceeded` across `backend/src` returns **no matches**.
- [x] Pluggable store: `InMemorySpendStore` default, `RedisSpendStore` when `REDIS_URL` set, reusing the rate-limiter ioredis client — `aiCostTracker.ts:257-274,28`.
- [x] Enforces global (`AI_DAILY_BUDGET_USD` default 50) and per-user (`AI_USER_DAILY_BUDGET_USD` default 5) budgets; global checked before user; `scope` reports which tripped — `aiCostTracker.ts:111-137,189-216`, defaults `config/index.ts:255-258`.
- [x] Runs after `authenticate`, falls through when no user — `aiSpendGuard.ts:29-33`.
- [x] Fails CLOSED with 503 SERVICE_UNAVAILABLE on budget reached AND on store error — `aiSpendGuard.ts:38-52,54-68`.
- [x] `aiSpendGuard` is attached alongside `aiLimiter` on all 8 enumerated mount points (chat, biomarker guidance, expenses analyze, 2 insurance, 3 upload) — see Resource-intensive checks above. (The 2 exceptions in F-1 are the only AI routes missing it.)
- [x] Spend-budget env parsing fails safe: NaN/negative falls back to default keeping the breaker ON; 0 is a valid explicit disable — `config/index.ts:66-76,256-257`.

### Store backing
- [x] When `REDIS_URL` unset, `createRateLimitStore` returns `undefined` → MemoryStore (documented N×limit; see F-2) — `rateLimitStore.ts:79-81`.
- [x] When set, each limiter gets a `RedisStore` namespaced `rl:<prefix>:` so buckets don't collide — `rateLimitStore.ts:85-89`.
- [x] ioredis client lazy, `maxRetriesPerRequest: 2`, `enableOfflineQueue: false`; falls back to MemoryStore on construction error (see F-3) — `rateLimitStore.ts:45-71`.

## Unverifiable
- Whether `--max-instances` is actually pinned low enough to bound the F-2 N×limit worst case (prompt Q4). The pin lives in Cloud Run deploy config / `.github/workflows/deploy.yml` runtime flags, not in the reviewed source; the code comments reference `--max-instances=3` but the live value is a deploy-time setting not assertable from these files.
- Whether 429/503 spikes are surfaced as alerts (prompt Q6). The handler logs `logger.warn`/`logger.error` (`rateLimiter.ts:45`, `aiSpendGuard.ts:42,55`), but whether those log lines drive a metric/alert is a Cloud Logging/Monitoring config concern outside the repo.
- Live multi-instance behavior of the Redis-backed atomic admit (`INCRBYFLOAT`-then-compare) under true concurrency — reasoned correct from the code (each `INCRBYFLOAT` returns the caller's distinct post-increment total), but not exercised against a live Redis in this static review.

## Out of scope
- Account-lockout enforcement in the login controller (`config.security.maxLoginAttempts`/`lockoutDuration`) — referenced in F-4 as the real per-account backstop but belongs to the authentication review (`01`/`auth`), not rate limiting.
- `blockDemoAI` / `requirePlanLimit` / `requirePlanFeature` semantics beyond their presence/absence on AI routes — these are the demo/plan guardrails (prompt Q3 notes they, not the limiter, are the real demo/plan gate); their internal correctness is the plan-gating review's domain.
- CSRF exemption correctness on `/ai/chat` and `/internal/*` — covered by the CSRF review.
- The `pdfRedaction.ts` deletion / `redactPatientBanner` removal — not a rate-limiting concern (noted in the run's canonical facts only to avoid stale cross-refs).
