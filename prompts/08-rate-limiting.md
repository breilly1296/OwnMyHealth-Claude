---
tags:
  - security
  - api
  - medium
type: prompt
priority: 3
updated: 2026-06-16
---

# Rate Limiting Review

> Follow the [review protocol](./_review-protocol.md). Use [Claude Code tools](./_verification-tools.md).

## Files to Review
- `backend/src/middleware/rateLimiter.ts` — 8 exported limiters
- `backend/src/middleware/rateLimitStore.ts` — pluggable store: shared Redis (Cloud Memorystore) when `REDIS_URL` is set, in-process MemoryStore fallback otherwise
- `backend/src/middleware/aiSpendGuard.ts` — complementary dollar-based circuit breaker for AI routes (not a rate limiter, but the cost-control partner of `aiLimiter`)
- `backend/src/app.ts` — global limiter registration (`standardLimiter`)
- `backend/src/routes/*.ts` — per-route limiter attachment

## OwnMyHealth Rate Limiting Strategy
- **Global**: Basic protection on all routes
- **Auth Endpoints**: Strict limits (prevent brute force)
- **Upload Endpoints**: Prevent abuse
- **AI/API Endpoints**: Cost control (count-based via `aiLimiter`, dollar-based via `aiSpendGuard`)
- **Provider Outreach**: Cap access-request fan-out (anti-spam / anti-enumeration)

## Checklist

### 1. Rate Limiter Configuration
- [ ] Rate limiting middleware installed (`express-rate-limit`)
- [ ] Applied globally or to sensitive routes
- [ ] Limits are reasonable for legitimate use

### 2. Authentication Endpoints
- [ ] `POST /auth/login` - strict limit (e.g., 5/minute per IP)
- [ ] `POST /auth/register` - moderate limit (e.g., 3/hour per IP)
- [ ] `POST /auth/forgot-password` - strict limit
- [ ] `POST /auth/reset-password` - strict limit

### 3. Resource-Intensive Endpoints
- [ ] `POST /upload/*` - limit uploads (e.g., 20/hour) — `uploadLimiter` (applied via `router.use(uploadLimiter)` in `uploadRoutes.ts`)
- [ ] `POST /biomarkers/:id/guidance` - limit AI calls — expensive Claude API — `aiLimiter` + `aiSpendGuard`
- [ ] `POST /expenses/analyze` - limit cost analysis — expensive Claude API — `aiLimiter` + `aiSpendGuard` (note: the route is `/analyze`; `/analyses` is the GET list endpoint, which is NOT AI-gated)
- [ ] `POST /ai/chat` - limit AI chat turns — expensive Claude API — `aiLimiter` + `aiSpendGuard`
- [ ] `POST /biomarkers/batch` - limit bulk creates (e.g., 30/hour) — `bulkOperationLimiter`
- [ ] `GET /files/*/download` - prevent bulk downloads — `sensitiveLimiter` (attached in `fileRoutes.ts`)
- [ ] `GET /settings/export-data` - limit data exports — `sensitiveLimiter`
- [ ] `DELETE /settings/*` - limit deletion operations — `sensitiveLimiter`
- [ ] `POST /provider/patients/request` - prevent spam/enumeration — `providerAccessRequestLimiter`

### 4. Rate Limit Headers
- [ ] `X-RateLimit-Limit` - max requests
- [ ] `X-RateLimit-Remaining` - requests left
- [ ] `X-RateLimit-Reset` - when limit resets
- [ ] `Retry-After` on 429 responses

### 5. Rate Limit Key
- [ ] Based on IP address (for unauthenticated)
- [ ] Based on user ID (for authenticated)
- [ ] Considers proxy headers correctly

### 6. Response on Limit
- [ ] Returns 429 Too Many Requests
- [ ] Includes helpful error message
- [ ] Doesn't leak information about limits

## Example Configuration
```typescript
import rateLimit from 'express-rate-limit';

// Strict limit for auth
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: 'Too many attempts, please try again later'
});

// Moderate limit for uploads
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Upload limit reached'
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/upload', uploadLimiter);
```

## Actual Limiters in Codebase
Verify all **8** are exported from `backend/src/middleware/rateLimiter.ts` (every limiter is constructed with a `store` from `createRateLimitStore('<prefix>')` — see the store section below):
- [ ] `standardLimiter` — `config.rateLimit.windowMs`/`maxRequests` (defaults 100 req/15 min), keyed by IP (global default)
- [ ] `authLimiter` — 20 req/15 min (auth routes)
- [ ] `strictAuthLimiter` — 5 req/15 min (login), keyed by `email:IP`, `skipSuccessfulRequests: true` (only failed attempts count)
- [ ] `uploadLimiter` — 20 uploads/hour
- [ ] `sensitiveLimiter` — 10 req/hour (export, delete, FHIR connect, file download)
- [ ] `aiLimiter` — 10 req/hour, keyed by `user.id` (fallback IP). Applied to Claude-backed endpoints. **Verify it's actually attached to those routes**, not just exported.
- [ ] `providerAccessRequestLimiter` — 10 req/hour, keyed by `user.id` (fallback IP). Caps provider access-request fan-out. **NEW since prompt era.**
- [ ] `bulkOperationLimiter` — 30 req/hour (batch creates)

### Limiter-to-route coverage (cross-check)
- [ ] `strictAuthLimiter` on `POST /auth/login` (also on resend-verification / forgot / reset routes to prevent enumeration)
- [ ] `authLimiter` registered globally in `authRoutes.ts` via `router.use(authLimiter)` (covers register etc.)
- [ ] `uploadLimiter` on every route in `uploadRoutes.ts` (via `router.use(uploadLimiter)`)
- [ ] `aiLimiter` **+ `aiSpendGuard`** now covers **8 mount points across 5 route files** (not five routes): `POST /ai/chat` (`aiRoutes.ts:32`), `POST /biomarkers/:id/guidance` (`biomarkerRoutes.ts:136`), `POST /expenses/analyze` (`expenseRoutes.ts:114`), the two AI-backed insurance routes `POST /insurance/upload-sbc` and `PUT /insurance/plans/:id/reanalyze` (`insuranceRoutes.ts:125,138`), **and all three `/upload/*` routes** `POST /upload/lab-report`, `POST /upload/insurance-sbc`, `POST /upload/lab-results-ocr` (`uploadRoutes.ts:82,104,135`, each `aiSpendGuard` immediately after `aiLimiter`). The dollar circuit breaker is now attached to every upload route — the old "upload routes bypass the budget guard" gap is **closed**.
- [ ] `aiLimiter` **only (NO `aiSpendGuard`)** remains on `GET /health-goals/suggestions` (`healthGoalsRoutes.ts:48`) and `GET /health-needs/analyze` (`healthNeedsRoutes.ts:49`). These still trigger Claude calls but the dollar guard is not attached — **flag**: a runaway loop here counts against `aiLimiter` but bypasses the budget guard until the count cap (10/hr) trips. (Note: a subtler residual concern is that Document AI / OCR cost on the upload path is not dollar-accounted by `aiSpendGuard` — its reservation/settle model tracks the Claude estimate, not Document AI billing — but that is a different issue from the now-closed upload-route coverage gap.)
- [ ] `sensitiveLimiter` on `GET /settings/export-data`, `DELETE /settings/delete-data`, `DELETE /settings/delete-account`, file download in `fileRoutes.ts`, FHIR routes in `fhirRoutes.ts`, and the admin sensitive route
- [ ] `providerAccessRequestLimiter` on `POST /provider/patients/request`
- [ ] `bulkOperationLimiter` on `POST /biomarkers/batch`
- [ ] `standardLimiter` registered globally in `app.ts` (`app.use(standardLimiter)`; also re-applied explicitly on `GET /api/health/db`)

### Store backing & Cloud Run scaling (`rateLimitStore.ts`)
Every limiter passes `store: createRateLimitStore('<prefix>')`. This is the multi-instance correctness boundary — review it explicitly:
- [ ] When `REDIS_URL` is **unset** (current dev/test/CI default), `createRateLimitStore` returns `undefined` and `express-rate-limit` falls back to its in-process `MemoryStore`. On Cloud Run with N instances, counters are per-instance, so the effective ceiling is **N × limit** (e.g., the login cap of 5 becomes 5N, the AI cost cap of 10/hr becomes 10N/hr). Today this is bounded only by the `--max-instances` pin (audit #37).
- [ ] When `REDIS_URL` is **set**, every limiter is backed by a SHARED Redis store (Cloud Memorystore) via `rate-limit-redis`, keyed by a distinct `rl:<prefix>:` namespace so buckets don't collide. Counters become consistent across instances and the posture is decoupled from `--max-instances`.
- [ ] Redis client is lazy (`ioredis` required only when enabled), `maxRetriesPerRequest: 2`, `enableOfflineQueue: false` — fails fast rather than buffering. On client construction failure it logs and falls back to MemoryStore rather than crashing boot. **Confirm the fallback-on-error path is acceptable** (a flaky Redis silently degrades back to N×limit).
- [ ] Each limiter uses a unique `prefix`; verify no two limiters share one (collision would merge their buckets).

### AI dollar-cap circuit breaker (`aiSpendGuard.ts`)
`aiLimiter` caps request *count*; `aiSpendGuard` caps *spend*. The two are complementary — both should be present on AI routes.
- [ ] `aiSpendGuard` calls `admitAISpend(userId)` (`aiSpendGuard.ts:24,37`), which **atomically RESERVES** a conservative `$0.05` estimate (`RESERVATION_USD`, `aiCostTracker.ts:67`) against the rolling daily accumulator and returns an `Admission { admitted, scope, settle }`. The guard registers `admission.settle` on both response `'finish'` and `'close'` (`aiSpendGuard.ts:74-75`) to back the in-flight reservation out; the **real** per-call cost is added later by `trackAIUsage`. This is a reserve/settle model — the old `isAISpendExceeded` read is **gone** (deleted; zero occurrences in `backend/src`). The store is pluggable (`InMemorySpendStore`, or `RedisSpendStore` when `REDIS_URL` is set) and enforces both a global (`AI_DAILY_BUDGET_USD`, default 50) and per-user (`AI_USER_DAILY_BUDGET_USD`, default 5) budget; `admission.scope` reports which one tripped (`'global'` vs `'user'`).
- [ ] It runs AFTER `authenticate` (so the per-user budget can resolve) and falls through when there is no user (`aiSpendGuard.ts:30-33`); it fails closed with **503 SERVICE_UNAVAILABLE** both when the budget is reached AND when the shared store (Redis) errors (`aiSpendGuard.ts:38-52` — a billing breaker must not uncap spend during a store blip).
- [ ] Verify `aiSpendGuard` is attached alongside `aiLimiter` on every Claude-backed route (it does NOT live in `rateLimiter.ts`; it's a separate middleware in `aiSpendGuard.ts`).

## Questions to Ask
1. `aiLimiter` and `providerAccessRequestLimiter` are keyed by `user.id` (fair per-user, IP-hop-resistant) with an IP fallback. Is the IP fallback exploitable pre-auth, or are these always behind `authenticate`?
2. Does `standardLimiter` registration in `app.ts` happen before or after route-specific limiters? Order affects which one applies. (Currently global, before routes.)
3. Do demo accounts have stricter AI limits (they can burn API budget on a shared key)? Note: AI routes also stack `blockDemoAI` and `requirePlanLimit(...)` — check whether those, not the limiter, are the real demo/plan guardrail.
4. With `REDIS_URL` unset, the real ceiling is `N × limit` per Cloud Run instance. Does the `--max-instances` pin actually bound the worst case, and is Redis required before scaling out?
5. Does the count-based `aiLimiter` math line up with the dollar-based `aiSpendGuard` caps (`AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD`)? Worst case ≈ `users × aiLimiter.max × cost-per-call` should not blow past the daily budget before the guard trips.
6. Are 429 responses (and `aiSpendGuard` 503s) logged? A spike signals either abuse or a legitimate feature hitting the cap.
