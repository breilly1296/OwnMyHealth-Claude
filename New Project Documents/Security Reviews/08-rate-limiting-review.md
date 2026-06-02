# 08-rate-limiting Review — 2026-06-01

Scope: rate-limiting posture for OwnMyHealth backend per `prompts/08-rate-limiting.md`, run against live code at repo root `C:/Users/breil/Projects/OwnMyHealth/`. Report only — no code modified.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 3 |

The rate-limiting design is unusually complete: all 8 named limiters exist, each carries a distinct store prefix, and the spec-named route attachments check out. The residual risk is operational, not a missing control: the in-process store dilutes every cap to `N×limit` until Redis is provisioned (Cloud Run N≤3), the AI dollar circuit breaker is absent on three Claude/Document-AI-touching upload routes (F-1 — the two "analysis" routes the spec also names turned out to be rule-based with no AI call; see F-6), and 429 throttle events are not logged so abuse spikes are invisible.

## Findings

### F-1 — AI spend circuit breaker (`aiSpendGuard`) absent on 3 Claude/Document-AI upload routes — **Medium**
- **Location:** `backend/src/routes/uploadRoutes.ts:77-85, 94-102, 124-132`
- **Observation:** The three upload routes (`POST /upload/lab-report`, `POST /upload/insurance-sbc`, `POST /upload/lab-results-ocr`) attach `aiLimiter` but NOT `aiSpendGuard`. These routes drive Claude and/or Google Document AI calls (lab-report = Claude PDF extraction, insurance-sbc = Claude SBC extraction, lab-results-ocr = Google Document AI OCR — see `labUploadController.ts:4-5,16`) yet are bounded only by the count cap, not the dollar cap. The matching AI routes that DO pair both are `biomarkerRoutes.ts:120-123`, `aiRoutes.ts:29-32`, `expenseRoutes.ts:111-114`, `insuranceRoutes.ts:117-123` and `131-136`.
- **Impact:** A runaway/abusive client looping an upload route burns Anthropic + Document AI budget. Each call counts against `aiLimiter` (10/hr) but bypasses the per-user $5/global $50 budget guard until the count cap trips. With the in-process store diluted across N=3 instances (F-2), the count ceiling is effectively 30/hr/user with no dollar backstop — a large-PDF extraction is the most expensive AI call shape in the app, so this is the worst route family to leave un-guarded.
- **Fix:** Add `aiSpendGuard` after `authenticate` and before the controller on these three routes, mirroring `expenseRoutes.ts:113-114`. `aiSpendGuard` requires a resolved `req.user` (it no-ops without one), so place it after `authenticate`, which all three already run at router level.
- **Evidence:**
  ```ts
  // uploadRoutes.ts:77-85 — aiLimiter present, aiSpendGuard absent
  router.post('/lab-report', authenticate, aiLimiter, blockDemoAI,
    requirePlanLimit('pdfUploadsPerMonth'), upload.single('file'),
    asyncHandler(uploadLabReport));
  ```
  Note: the spec explicitly calls this out as a known gap to "flag," so this matches design intent, not a regression. It is reported Medium because the dollar circuit breaker is the only spend-bounded control and it is missing on the most expensive route shape.

  **VERIFIER CORRECTION (2026-06-01):** The original finding listed FIVE routes, also including `GET /health-goals/suggestions` (`healthGoalsRoutes.ts:48`) and `GET /health-needs/analyze` (`healthNeedsRoutes.ts:49`). Those two are **NOT** AI-spend routes: `suggestGoals` (`healthGoalsController.ts:783-872`) and `analyzeHealthNeeds` (`healthNeedsController.ts:386-462`) are pure rule-based logic — they query biomarkers and emit hard-coded recommendation/suggestion strings with NO Anthropic or Document AI call and NO `trackAIUsage`. `healthGoalsController.ts` imports no Claude/aiCostTracker module at all. Attaching `aiSpendGuard` to them would be a no-op against a spend accumulator they never increment. The spec (line 107) makes the same erroneous claim ("These still trigger Claude/Document AI calls"); per protocol "trust the code" — this is recorded as prompt drift in F-6. Finding scoped down to the three upload routes, which are genuinely AI-touching and genuinely lack the dollar guard; severity unchanged.

### F-2 — In-process MemoryStore dilutes every limit to N×cap on Cloud Run — **Medium**
- **Location:** `backend/src/middleware/rateLimitStore.ts:71-82`; `backend/src/config/index.ts:125-127`; `.github/workflows/deploy.yml:88`
- **Observation:** `createRateLimitStore` returns `undefined` whenever `REDIS_URL` is unset (the current dev/test/CI/prod default), so `express-rate-limit` falls back to its per-instance `MemoryStore`. The same per-instance limitation applies to the AI spend accumulator (`aiCostTracker.ts:30-41`, in-memory `globalSpentUsd`/`userSpentUsd`). On Cloud Run with up to 3 instances, every cap becomes `3×limit`: login brute-force 5→15, `aiLimiter` 10/hr→30/hr, global $50/day budget→$150/day, per-user $5/day→$15/day.
- **Impact:** Defense-in-depth controls are weaker than their stated numbers. Brute-force, AI cost-control, and anti-enumeration ceilings are all 3x looser than configured. The blast radius is bounded only by the `--max-instances=3` pin; raising that pin (or a future autoscale change) without first enabling Redis silently multiplies every cap.
- **Fix:** Provision Cloud Memorystore and set `REDIS_URL` so all limiters share a store (the code path at `rateLimitStore.ts:71-82` already supports this with distinct `rl:<prefix>:` namespaces). Until then, keep `--max-instances=3` and treat it as a hard coupling. Consider moving the AI spend accumulator to the same shared store for multi-instance dollar precision.
- **Evidence:**
  ```ts
  // rateLimitStore.ts:72-73
  const c = getClient();
  if (!c) return undefined;   // → express-rate-limit MemoryStore (per-instance)
  ```
  ```yaml
  # deploy.yml:78,88 — the pin is the only thing bounding dilution
  # --max-instances=3 bounds in-memory rate-limiter dilution.
            --max-instances=3 \
  ```

### F-3 — 429 throttle events are not logged — **Medium**
- **Location:** `backend/src/middleware/rateLimiter.ts:17-170` (no `handler:` on any of the 8 limiters)
- **Observation:** None of the 8 limiters define a custom `handler`; they only set a static `message` body. `express-rate-limit`'s default handler returns 429 with that body but emits no application log. A repo-wide search for limiter logging (`handler:`/`onLimitReached`) finds none in `rateLimiter.ts`. By contrast, the dollar-cap `aiSpendGuard` DOES log its 503 (`aiSpendGuard.ts:36-39`).
- **Impact:** A burst of 429s — the strongest early signal of credential-stuffing, scraping, AI-budget abuse, or a buggy client — produces no log line, alert, or audit trail. Operators cannot distinguish "feature legitimately hitting the cap" from "active attack," and there is nothing to correlate against the audit log. (Spec Question 6 asks exactly this.)
- **Fix:** Add a shared `handler` to each limiter (or a single factory wrapper) that calls `logger.warn('Rate limit exceeded', { prefix, key, path })` then sends the existing `message`/429, mirroring the `aiSpendGuard.ts:36` pattern. Avoid logging raw PII: for `strictAuthLimiter` log a hashed/redacted email, not the `email:IP` key verbatim.
- **Evidence:**
  ```ts
  // rateLimiter.ts:108-118 — message only, no handler → no log on throttle
  export const aiLimiter = rateLimit({
    store: createRateLimitStore('ai'),
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { success: false, error: { code: 'AI_RATE_LIMIT_EXCEEDED', ... } },
  ```

### F-4 — Redis-unreachable path silently degrades to N×limit at runtime — **Low**
- **Location:** `backend/src/middleware/rateLimitStore.ts:32-64`
- **Observation:** `getClient()` is memoized once (`initialized` flag). If `REDIS_URL` is set but ioredis construction throws, it logs and sets `client = null`, falling back to MemoryStore for the process lifetime. Per-request `on('error')` failures are logged but the `RedisStore` (built once at startup, `rateLimitStore.ts:77-81`) is not swapped out, so a Redis that goes flaky after boot can silently degrade consistency without re-degrading the store object.
- **Impact:** Once Redis is enabled, an operator may believe caps are cluster-consistent while a flaky/unreachable Redis quietly reverts the effective ceiling to `N×limit` — the exact posture F-2 describes — with only an error log to signal it. `enableOfflineQueue: false` + `maxRetriesPerRequest: 2` mean commands fail fast rather than hang, which is the right tradeoff, but the degradation is invisible without alerting.
- **Fix:** When Redis is enabled, alert on the `Rate-limit Redis client error` / `Failed to initialize Redis rate-limit store` log lines (`rateLimitStore.ts:48,57`) and surface store health on the `/health` endpoint so the degraded-to-MemoryStore state is observable. The fallback-on-error-rather-than-crash choice itself is acceptable for availability; the gap is observability.
- **Evidence:**
  ```ts
  // rateLimitStore.ts:57-62
  logger.error('Failed to initialize Redis rate-limit store; using MemoryStore', {
    prefix: 'RateLimit',
    data: { error: err instanceof Error ? err.message : String(err) },
  });
  client = null;
  ```

### F-5 — `strictAuthLimiter` email key is attacker-controlled and unnormalized — **Low**
- **Location:** `backend/src/middleware/rateLimiter.ts:67-72`
- **Observation:** The login limiter key is `${email}:${ip}`, read from `req.body.email`. The `skipSuccessfulRequests: true` flag means only failed attempts count, which is good, but because the bucket is per `(email, IP)` pair, an attacker iterating distinct usernames from one IP gets a fresh 5-attempt bucket per username, and case/whitespace variants of the same email (`Bob@x.com` vs `bob@x.com`) map to different buckets. The key is taken pre-validation (the limiter runs before `validate(schemas.auth.login)` at `authRoutes.ts:50-51`).
- **Impact:** Password spraying (one guess against many accounts) and case-variant evasion are not bounded by this limiter — only repeated guesses against the *same* exact email string from the *same* IP are. The IP-only `authLimiter` (20/15min, applied router-wide at `authRoutes.ts:34`) is the real backstop against single-IP spraying, so this is defense-in-depth weakening rather than an open door.
- **Fix:** Normalize the email in the keyGenerator (`.trim().toLowerCase()`) so case/whitespace variants collapse to one bucket. Optionally also maintain an IP-only failed-login counter so cross-account spraying from one IP is throttled independently of the username.
- **Evidence:**
  ```ts
  // rateLimiter.ts:69-71
  const email = req.body?.email || '';
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `${email}:${ip}`;
  ```

### F-6 — Prompt drift: spec claims two non-AI routes "trigger Claude/Document AI calls" — **Low**
- **Location:** Spec `prompts/08-rate-limiting.md:107` vs code `backend/src/controllers/healthGoalsController.ts:783-872`, `backend/src/controllers/healthNeedsController.ts:386-462`
- **Observation:** Spec line 107 names `GET /health-goals/suggestions` and `GET /health-needs/analyze` among routes that "still trigger Claude/Document AI calls but the dollar circuit breaker is NOT attached." In the live code neither route makes any AI call: `suggestGoals` and `analyzeHealthNeeds` are deterministic, rule-based handlers that read biomarkers under RLS and return hard-coded recommendation/suggestion strings. There is no Anthropic SDK call, no Document AI call, and no `trackAIUsage` on either path; `healthGoalsController.ts` does not import any Claude/aiCostTracker module. They DO correctly carry `aiLimiter` (`healthGoalsRoutes.ts:48`, `healthNeedsRoutes.ts:49`) as a generic request cap, but they are not part of the AI-spend surface. Per protocol "trust the code." (Confirmatory drift checks that PASSED: spec's per-limiter numeric claims — login 5, auth 20, upload 20, sensitive 10, ai 10, provider 10, bulk 30, standard 100/15min — all verified exactly at `rateLimiter.ts`; and the spec's "standardLimiter re-applied on `GET /api/health/db`" claim is accurate at `app.ts:318`. These are noted as passed checks, not findings.)
- **Impact:** Documentation accuracy only. The risk is that the inaccurate spec causes a future reviewer (or this review — it did, see the F-1 correction) to "fix" a non-existent gap by bolting `aiSpendGuard` onto two routes where it is a no-op, or to misjudge the AI-spend blast radius.
- **Fix:** No code change. Update `prompts/08-rate-limiting.md:107` to drop `GET /health-goals/suggestions` and `GET /health-needs/analyze` from the "trigger Claude/Document AI" list (they are non-AI rule-based routes), leaving only the three upload routes. Fold into the quarterly prompt-refresh task.
- **Evidence:**
  ```ts
  // healthNeedsController.ts:411-414 — rule-based, no AI call
  const recommendations: string[] = [];
  if (outOfRangeBiomarkers.length > 0) {
    recommendations.push('Schedule appointment with healthcare provider to discuss out-of-range biomarkers');
  }
  ```

## Checks passed

### 1. Rate Limiter Configuration
- [x] `express-rate-limit` installed — `backend/package.json:32` (`"express-rate-limit": "^8.3.2"`); `ioredis` `:34`, `rate-limit-redis` `:41`.
- [x] Applied globally — `app.ts:220` `app.use(standardLimiter)`, before route mounting at `app.ts:265`.
- [x] Limits reasonable for legitimate use — verified per-limiter at `rateLimiter.ts:17-170` (login 5/15min, auth 20/15min, upload 20/hr, sensitive 10/hr, ai 10/hr, provider 10/hr, bulk 30/hr, standard 100/15min).

### 2. Authentication Endpoints
- [x] `POST /auth/login` strict — `authRoutes.ts:48-53` (`strictAuthLimiter`, 5/15min, `skipSuccessfulRequests`).
- [x] `POST /auth/register` — covered by router-wide `authLimiter` (`authRoutes.ts:34`, 20/15min).
- [x] `POST /auth/forgot-password` strict — `authRoutes.ts:79-84` (`strictAuthLimiter`).
- [x] `POST /auth/reset-password` strict — `authRoutes.ts:87-92` (`strictAuthLimiter`).
- [x] (Bonus) `resend-verification`, `confirm-email-change`, `change-email` also `strictAuthLimiter` — `authRoutes.ts:73, 98, 130`.

### 3. Resource-Intensive Endpoints
- [x] `POST /upload/*` limited — `uploadRoutes.ts:26` (`router.use(uploadLimiter)`, 20/hr).
- [x] `POST /biomarkers/:id/guidance` — `aiLimiter` + `aiSpendGuard` at `biomarkerRoutes.ts:122-123`.
- [x] `POST /expenses/analyze` — `aiLimiter` + `aiSpendGuard` at `expenseRoutes.ts:113-114`; `GET /analyses` correctly NOT AI-gated (`expenseRoutes.ts:123-127`).
- [x] `POST /ai/chat` — `aiLimiter` + `aiSpendGuard` at `aiRoutes.ts:31-32`.
- [x] `POST /biomarkers/batch` — `bulkOperationLimiter` at `biomarkerRoutes.ts:93`.
- [x] `GET /files/:id/download` — `sensitiveLimiter` at `fileRoutes.ts:61`.
- [x] `GET /settings/export-data` — `sensitiveLimiter` at `settingsRoutes.ts:88`.
- [x] `DELETE /settings/*` — `sensitiveLimiter` at `settingsRoutes.ts:100` (delete-data) and `:109` (delete-account).
- [x] `POST /provider/patients/request` — `providerAccessRequestLimiter` at `providerRoutes.ts:152`.
- [x] AI-backed insurance routes paired with both guards — `insuranceRoutes.ts:121-123` (reanalyze) and `:135-136` (upload-sbc).
- [x] Admin destructive route — `sensitiveLimiter` on `DELETE /admin/users/:id/permanent` at `adminRoutes.ts:468`.
- [x] FHIR routes — `sensitiveLimiter` on connect/sync/delete at `fhirRoutes.ts:32, 45, 56`.

### 4. Rate Limit Headers
- [x] Standard headers enabled on every limiter — `standardHeaders: true, legacyHeaders: false` at `rateLimiter.ts:28-29, 48-49, 64-65, 87-88, 103-104, 119-120, 144-145, 168-169`. express-rate-limit v8 emits `RateLimit`/`RateLimit-Policy` (and `Retry-After` on 429) via `standardHeaders`.

### 5. Rate Limit Key
- [x] IP-based for unauthenticated — `standardLimiter` keyGenerator uses `req.ip` (`rateLimiter.ts:30-33`); `strictAuthLimiter` uses `email:IP` (`rateLimiter.ts:67-72`).
- [x] User-ID-based for authenticated — `aiLimiter` (`rateLimiter.ts:121-124`) and `providerAccessRequestLimiter` (`rateLimiter.ts:146-153`) key by `req.user.id` with IP fallback.
- [x] Proxy headers handled — `app.set('trust proxy', 1)` at `app.ts:120`, so `req.ip` reflects the real client behind Cloud Run's LB.
- [x] IP-fallback in user-keyed limiters is NOT reachable pre-auth (Question 1) — every AI/provider route runs `authenticate`/`requireBearerAuth` at router level before the limiter: `uploadRoutes.ts:79`, `aiRoutes.ts:21`, `expenseRoutes.ts:32`, `insuranceRoutes.ts:64`, `biomarkerRoutes` (router auth), `providerRoutes.ts:25`.

### 6. Response on Limit
- [x] Returns 429 — express-rate-limit default status; custom `RateLimitError` also maps to 429 (`errorHandler.ts:76`).
- [x] Helpful, non-leaky messages — static generic messages per limiter (`rateLimiter.ts:21-27` etc.), no per-key counts or limit internals exposed.

### Actual Limiters (all 8 exported, distinct prefixes)
- [x] `standardLimiter` — `rateLimiter.ts:17` (prefix `standard`, config-driven 100/15min, IP-keyed).
- [x] `authLimiter` — `rateLimiter.ts:37` (prefix `auth`, 20/15min).
- [x] `strictAuthLimiter` — `rateLimiter.ts:53` (prefix `strict-auth`, 5/15min, `email:IP`, `skipSuccessfulRequests`).
- [x] `uploadLimiter` — `rateLimiter.ts:76` (prefix `upload`, 20/hr).
- [x] `sensitiveLimiter` — `rateLimiter.ts:92` (prefix `sensitive`, 10/hr).
- [x] `aiLimiter` — `rateLimiter.ts:108` (prefix `ai`, 10/hr, user-keyed); attachment verified on all named routes (see §3).
- [x] `providerAccessRequestLimiter` — `rateLimiter.ts:133` (prefix `provider-access-request`, 10/hr, user-keyed); attached `providerRoutes.ts:152`.
- [x] `bulkOperationLimiter` — `rateLimiter.ts:157` (prefix `bulk`, 30/hr).
- [x] No two limiters share a prefix — distinct strings at `rateLimiter.ts:18,38,54,77,93,109,134,158` (`standard`, `auth`, `strict-auth`, `upload`, `sensitive`, `ai`, `provider-access-request`, `bulk`).

### Store backing & Cloud Run scaling
- [x] Redis unset → `undefined` → MemoryStore per-instance — `rateLimitStore.ts:72-73` (and see F-2 for the N×limit consequence).
- [x] Redis set → shared store, distinct `rl:<prefix>:` namespace — `rateLimitStore.ts:77-81`.
- [x] Lazy ioredis, `maxRetriesPerRequest: 2`, `enableOfflineQueue: false`, fall-back-on-error not crash — `rateLimitStore.ts:40-62` (acceptability caveat raised as F-4).

### AI dollar-cap circuit breaker
- [x] Reads rolling daily accumulator, global ($50) + per-user ($5) budgets — `aiSpendGuard.ts:30` calls `isAISpendExceeded`; budgets at `aiCostTracker.ts:69-77`, defaults at `config/index.ts:196-197`.
- [x] Runs after `authenticate`, falls through with no user, fails closed 503 — `aiSpendGuard.ts:24-28` (no-user fall-through), `:41-47` (`ServiceUnavailableError` = 503).
- [x] Lives in separate middleware, attached alongside `aiLimiter` on the 5 paired routes — `aiSpendGuard.ts` (standalone); attachments at `biomarkerRoutes.ts:123`, `aiRoutes.ts:32`, `expenseRoutes.ts:114`, `insuranceRoutes.ts:123, 136`.

### Questions to Ask (answers)
- [x] Q1 — IP fallback not exploitable pre-auth; all user-keyed limiters sit behind router-level auth (see §5).
- [x] Q2 — `standardLimiter` registered globally at `app.ts:220` before routes (`app.ts:265`); route-specific limiters stack after it. Confirmed.
- [x] Q3 — Demo/plan guardrails are `blockDemoAI` + `requirePlanLimit(...)`, stacked on AI routes (`uploadRoutes.ts:81-82`, `aiRoutes.ts:33-34`, `biomarkerRoutes.ts:124-125`), not the limiter — confirmed these, not the rate limiter, are the demo/plan boundary.
- [x] Q4 — `--max-instances=3` bounds worst case; Redis is required before scaling out (`deploy.yml:78-88`, `deploy-staging.yml:60-67`). See F-2.
- [x] Q5 — Count vs dollar math: per-user worst case = `aiLimiter.max(10/hr) × 24 × cost-per-call`, but the per-user $5/day guard (`config/index.ts:197`) trips first on any non-trivial call; both are per-instance (×3). The dollar guard is the binding constraint where attached — but NOT attached on the 3 upload routes in F-1.
- [x] Q6 — `aiSpendGuard` 503s ARE logged (`aiSpendGuard.ts:36-39`); 429s are NOT (see F-3).

## Unverifiable
- Live `RateLimit`/`Retry-After` header emission at runtime — inferred from `standardHeaders: true` (`rateLimiter.ts:28` et al.) and express-rate-limit v8 (`package.json:32`) behavior; not exercised against a running server in this static review.
- Whether `REDIS_URL` is actually set in the production Cloud Run revision — not present in repo workflows (`deploy.yml`/`deploy-staging.yml` set `--max-instances=3` but no `REDIS_URL`), consistent with the "MemoryStore is the current default" comments. The true production env state is outside the repo.

## Out of scope
- Frontend client-side throttling/retry behavior (`src/services/api/client.ts`) — the spec targets server-side enforcement only.
- Multer file-size/count limits (`uploadRoutes.ts:31-34`) and `express.json` 10MB body cap (`app.ts:248`) — DoS-adjacent input bounds, but covered by other prompts (request-size/validation), not rate limiting.
- `requirePlanLimit` / `blockDemoAI` internals — these are plan-gating and demo controls examined only as context for Question 3; their correctness is a separate review.
