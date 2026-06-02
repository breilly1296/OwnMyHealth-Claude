# 06-api-routes Review — 2026-06-01

Scope: all 18 route files under `backend/src/routes/` (incl. `index.ts`), `backend/src/app.ts`, the security middleware (`auth`, `csrf`, `rbac`, `rateLimiter`/`rateLimitStore`, `validation`, `demoProtection`, `planGating`, `aiSpendGuard`, `errorHandler`), and `backend/src/controllers/upload/`. Route inventory confirmed: 112 route registrations across 18 files (Grep `router\.(get|post|put|delete|patch)\(` over `backend/src/routes/`, excluding `*.test.ts`).

The route layer is in strong shape. Auth, RBAC, RLS scoping, CSRF, plan-gating, AI-spend, and demo blocks are applied consistently and the controllers uniformly derive `userId` from the JWT (`req.user!.id`), never from the request body. The findings below are hardening / hygiene items and prompt drift; none is an open authentication-bypass or IDOR.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 5 |

## Findings

### F-1 — CSRF exemption matched by `req.path.endsWith(...)` (over-broad suffix match) — **Medium**
- **Location:** `backend/src/middleware/csrf.ts:127`, `:131`, `:139`
- **Observation:** CSRF exemptions for public auth routes, the bearer-only streaming route, and the scheduler route are decided with suffix matching against the full request path, not an exact-path/mount-aware match. Any future route whose path *ends with* one of these strings (e.g. a hypothetical `POST /api/v1/foo/ai/chat`, or any path ending `/auth/login`) would silently inherit the CSRF exemption.
- **Impact:** Today the exposure is contained — `/ai/chat` is the only `bearerOnlyStreamingRoutes` entry and it is correctly mounted with `requireBearerAuth` (cookie auth rejected, so a cross-site cookie POST can't pass auth anyway), and `/internal/audit-cleanup` fails closed (404 + constant-time token). So there is no live exploit. The risk is latent: a developer adding a route that coincidentally ends in one of these suffixes (especially a cookie-authenticated one ending `/auth/...`) reopens a CSRF hole without any visible signal at the route layer. The `publicAuthRoutes` entries are cookie-eligible, so a suffix collision there is the most dangerous case.
- **Fix:** Match against the path *after* the API-version prefix using exact equality (e.g. compare `req.path` to `/api/v1/ai/chat` exactly, or strip the mount prefix and compare to a fixed set), rather than `endsWith`. At minimum, restrict the public-auth list to exact matches.
- **Evidence:**
  ```ts
  const isPublicAuthRoute = publicAuthRoutes.some(route =>
    req.path.endsWith(route)
  );
  const isBearerOnlyStreamingRoute = bearerOnlyStreamingRoutes.some(route =>
    req.path.endsWith(route)
  );
  const isSchedulerRoute = req.path.endsWith('/internal/audit-cleanup');
  ```

### F-2 — Prompt drift: spec calls the biomarker bulk route `POST /bulk`; code mounts `POST /batch` — **Low**
- **Location:** `backend/src/routes/biomarkerRoutes.ts:92` (route) vs `backend/src/routes/biomarkerRoutes.ts:13` (file header) and spec checklist (`06-api-routes.md`, biomarker bulk reference).
- **Observation:** The route is registered at `/batch`, but the file's own JSDoc header documents it as `POST /bulk`. The route is correctly protected (`bulkOperationLimiter` + `validate(schemas.biomarker.batchCreate)`), so this is purely a documentation/spec mismatch, not a security gap.
- **Impact:** None to runtime security. Stale internal documentation; could mislead a future reviewer or a client integrator into calling a non-existent `/bulk` endpoint.
- **Fix:** Update the JSDoc header in `biomarkerRoutes.ts` line 13 to `POST /batch`. Per protocol, recording as Low "Prompt drift".
- **Evidence:**
  ```ts
  // header:  * - POST /bulk      - Bulk create multiple biomarkers (for lab uploads)
  // route:   '/batch',  // line 92, validate(schemas.biomarker.batchCreate)
  ```

### F-3 — AI-guidance error responses use a non-standard error shape — **Low**
- **Location:** `backend/src/routes/biomarkerRoutes.ts:284`, `:289`
- **Observation:** The timeout (504) and failure (500) branches of the inline biomarker-guidance handler return `{ success: false, error: '<string>' }`, whereas every other endpoint (and the BAA-gate 503 a few lines above, `:144`) returns the structured `{ success: false, error: { code, message } }` shape. The FHIR controller has the same inconsistency (`fhirController.ts:44`, `:64`, etc. emit `{ error: { ... } }` without `success: false`).
- **Impact:** Low. A client that parses `error.code`/`error.message` will mis-handle these paths (it gets a bare string). No data leak — the messages are generic. Contract inconsistency only.
- **Fix:** Return `error: { code: 'AI_TIMEOUT' | 'AI_FAILED', message: '...' }` from these two branches to match `ApiResponse`. Optionally route both through the shared `errorHandler` via `next(err)` instead of hand-rolling the response.
- **Evidence:**
  ```ts
  return res.status(504).json({ success: false, error: 'AI guidance request timed out. Please try again.' });
  ...
  return res.status(500).json({ success: false, error: 'Failed to generate AI guidance' });
  ```

### F-4 — `requireJsonContentType` skips Content-Type enforcement on empty-body mutations — **Low**
- **Location:** `backend/src/middleware/validation.ts:205`
- **Observation:** The content-type guard returns early when `req.body` is empty (`Object.keys(req.body).length === 0`). For state-changing requests that carry no JSON body (e.g. `POST /auth/logout`, `POST /patient/providers/:id/revoke`, the empty-body DELETEs), no Content-Type is required. This relaxes the "JSON-only" intent for those endpoints.
- **Impact:** Low. These endpoints rely on cookie/JWT auth + CSRF for state change; the missing content-type check does not by itself enable CSRF (the double-submit token is still enforced for non-exempt routes). It is a minor weakening of the simple-request hardening that a JSON content-type requirement provides.
- **Fix:** Acceptable as-is for genuinely body-less mutations; if tightening is desired, require an explicit `Content-Type` (or `Content-Length: 0`) on POST/PUT/PATCH even when the parsed body is empty, rather than skipping the check entirely.
- **Evidence:**
  ```ts
  // Skip for empty bodies (some DELETE requests may include body)
  if (!req.body || Object.keys(req.body).length === 0) {
    return next();
  }
  ```

### F-5 — `triggerSync` (FHIR) is a state-changing POST mounted on `GET-mapped` SSRF-trusted host but uses fixed CSRF; no rate-limit class for outbound spend distinct from sensitiveLimiter — **Low**
- **Location:** `backend/src/routes/fhirRoutes.ts:42-50`
- **Observation:** `POST /fhir/sync/:connectionId` triggers an outbound, potentially expensive FHIR fetch + decrypt loop. It is protected by `sensitiveLimiter` (10/hour), `blockDemoAI`, `requirePlanFeature('questFhirIntegration')`, and `csrfProtection` — all correct. However, unlike the Anthropic AI routes, there is no per-day spend/abuse circuit-breaker analogous to `aiSpendGuard` for outbound FHIR traffic; the only ceiling is the 10/hour sensitive limiter and the plan feature flag.
- **Impact:** Low. A PRO/TEAM account could trigger up to 10 full lab syncs/hour against Quest. Each sync is bounded by the connection's own data volume and the SSRF allowlist (`urlSafety.ts`), so blast radius is the user's own lab data + outbound request volume to a trusted host — not a PHI disclosure. Noted as a hardening gap, not a vulnerability.
- **Fix:** If outbound FHIR volume becomes a cost/abuse concern, add a per-user daily sync cap (mirroring `aiSpendGuard`'s pattern) or lower the `sensitiveLimiter` window for this route. No change required for correctness today.
- **Evidence:**
  ```ts
  router.post('/sync/:connectionId',
    validate(schemas.connectionIdParam, 'params'),
    sensitiveLimiter, blockDemoAI,
    requirePlanFeature('questFhirIntegration'), csrfProtection,
    asyncHandler(fhir.triggerSync));
  ```

### F-6 — Admin `PATCH /provider-relationships/:id` accepts unvalidated body (no Zod schema) — **Low**
- **Location:** `backend/src/routes/adminRoutes.ts:693-696`
- **Observation:** Every other admin mutation validates its body with a `schemas.admin.*` Zod schema, but `PATCH /provider-relationships/:id` validates only the `:id` param (`schemas.uuidParam`) and then reads `status, canViewBiomarkers, canViewInsurance, canViewHealthNeeds, canEditData` straight from `req.body` with no schema. The handler applies them via spread-on-defined, so unexpected keys are ignored and `status` is written without enum validation.
- **Impact:** Low. The route is fully gated (`authenticate` + `blockDemoAdminAccess` + `requireRole('ADMIN')`), the update is column-allowlisted in the handler (only the five named fields are applied), and Prisma will reject an out-of-enum `status` value at the DB layer. So the missing schema is a defense-in-depth/consistency gap, not an injection path — but an invalid `status` surfaces as an opaque DB error instead of a clean 422.
- **Fix:** Add a `schemas.admin.updateProviderRelationship` Zod object (`status` enum + the four booleans, all optional) and apply `validate(...)` on this route to match the rest of `adminRoutes.ts`.
- **Evidence:**
  ```ts
  router.patch('/provider-relationships/:id',
    validate(schemas.uuidParam, 'params'),
    asyncHandler(async (req, res) => {
      const { status, canViewBiomarkers, canViewInsurance, canViewHealthNeeds, canEditData } = req.body;
  ```

## Checks passed

### 1. Route Authentication
- [x] `authRoutes.ts` — public routes (register/login/refresh/demo/verify-email/resend-verification/forgot-password/reset-password/confirm-email-change) carry no `authenticate`; protected routes (logout/logout-all/me/change-password/change-email) all use `authenticate` — `backend/src/routes/authRoutes.ts:56,59,108,111,114,119,128`.
- [x] `biomarkerRoutes.ts` — router-level `router.use(authenticate)` covers all routes incl. AI guidance — `backend/src/routes/biomarkerRoutes.ts:47`.
- [x] `fileRoutes.ts` — `router.use(authenticate)` — `backend/src/routes/fileRoutes.ts:42`.
- [x] `uploadRoutes.ts` — `authenticate` on each handler; handlers live in `controllers/upload/` (`labUploadController`/`sbcUploadController`); no `uploadController.ts` present — `backend/src/routes/uploadRoutes.ts:79,96,125`; `backend/src/controllers/upload/index.ts`.
- [x] `insuranceRoutes.ts` — `router.use(authenticate)` — `backend/src/routes/insuranceRoutes.ts:64`.
- [x] `expenseRoutes.ts` — `router.use(authenticate)` — `backend/src/routes/expenseRoutes.ts:32`.
- [x] `healthGoalsRoutes.ts` — `router.use(authenticate)` — `backend/src/routes/healthGoalsRoutes.ts:42`.
- [x] `healthNeedsRoutes.ts` — `router.use(authenticate)` — `backend/src/routes/healthNeedsRoutes.ts:39`.
- [x] `providerRoutes.ts` — `router.use(authenticate)` + `router.use(requireRole('PROVIDER','ADMIN'))` — `backend/src/routes/providerRoutes.ts:25-26`.
- [x] `patientRoutes.ts` — `router.use(authenticate)` + `router.use(requireRole('PATIENT'))` — `backend/src/routes/patientRoutes.ts:22,24`.
- [x] `adminRoutes.ts` — `router.use(authenticate)` + `blockDemoAdminAccess` + `requireRole('ADMIN')` — `backend/src/routes/adminRoutes.ts:29-31`.
- [x] `settingsRoutes.ts` — `router.use(authenticate)`; all routes also `sensitiveLimiter` — `backend/src/routes/settingsRoutes.ts:31`.
- [x] `aiRoutes.ts` — `router.use(requireBearerAuth)` (bearer-only); `POST /chat` adds `aiLimiter + aiSpendGuard + blockDemoAI + requirePlanLimit('aiChatsPerDay') + validate(schemas.ai.chat)` — `backend/src/routes/aiRoutes.ts:21,29-37`.
- [x] `fhirRoutes.ts` — `GET /callback` is the only unauthenticated route; `router.use(authenticate)` after it; authed routes add `sensitiveLimiter + blockDemoAI`; `connect/quest` (GET) + `sync` (POST) add `requirePlanFeature('questFhirIntegration')`; `sync` (POST) + `connections/:id` (DELETE) add `csrfProtection`; `connect/quest` (GET) has no CSRF — `backend/src/routes/fhirRoutes.ts:24,27,30-59`.
- [x] `onboardingRoutes.ts` — `router.use(authenticate)` on `GET /status` and `POST /complete` — `backend/src/routes/onboardingRoutes.ts:20`.
- [x] `planRoutes.ts` — `GET /available` is PUBLIC (no auth); `GET /` requires `authenticate` — `backend/src/routes/planRoutes.ts:32-34,52-54`.
- [x] `internalRoutes.ts` — not JWT-protected; `X-Cleanup-Token` shared secret, constant-time compared; 404 when `AUDIT_CLEANUP_TOKEN` unset; mounted in `app.ts`, not `routes/index.ts` — `backend/src/routes/internalRoutes.ts:27-62`; `backend/src/app.ts:269`; `backend/src/config/index.ts:136`.

### 2. Authorization (beyond auth)
- [x] `userId` always taken from the JWT, never the body — Grep for `req.body.userId|body.patientId` in `controllers/**` returned no matches; handlers use `req.user!.id` (e.g. `providerRoutes.ts:36`, `patientRoutes.ts:34`, `aiChatController.ts` via `req.user`).
- [x] No IDOR on biomarker AI guidance — biomarker loaded under RLS scoped to `{ id, userId }`, null → 404 — `backend/src/routes/biomarkerRoutes.ts:160-178`.
- [x] Reanalyze-plan scopes by owner — `tx.insurancePlan.findFirst({ where: { id: planId, userId } })` under RLS — `backend/src/controllers/upload/sbcUploadController.ts:238-247`.
- [x] File access scoped by `{ id, userId }` under RLS + `user_files` RLS policy backstop (controller comment documents the two-layer defense) — `backend/src/routes/fileRoutes.ts:28-41`.

### 3. Input validation
- [x] Bodies validated with Zod across routes (`validate(schemas.*)`) — e.g. `biomarkerRoutes.ts:85`, `insuranceRoutes.ts:82`, `settingsRoutes.ts:45`.
- [x] URL params validated as UUIDs (`schemas.uuidParam` / `patientIdParam` / `connectionIdParam`) — `validation.ts:231-243`; applied at `biomarkerRoutes.ts:71`, `providerRoutes.ts:294`, `fhirRoutes.ts:44,55`.
- [x] Query params validated/clamped (pagination clamped 1..100/200; enums) — `validation.ts:225-228,354-358,536-543,763-779`.
- [x] File uploads validated for type + size — multer `fileFilter` (PDF / image allowlist) + 10MB + single-file limit; PDF header magic-byte check — `uploadRoutes.ts:29-68`; `labUploadController.ts:43-44`; `sbcUploadController.ts:40-41`.

### 4. Error responses
- [x] Production responses use a generic message; client/server errors mapped to safe shapes; Prisma/JWT errors mapped to generic codes — `errorHandler.ts:104-175`.
- [x] Stack traces only in development (`config.isDevelopment` gate) — `errorHandler.ts:144,206`.
- [x] No DB error detail leaked — `PRISMA_DEFAULT` returns the generic message in prod — `errorHandler.ts:116`.

### 5. HTTP methods
- [x] Methods match intent (GET read, POST create, PATCH/PUT update, DELETE delete) across routers — e.g. `biomarkerRoutes.ts`, `expenseRoutes.ts`.
- [x] DELETE endpoints idempotent / confirmation-gated — admin permanent delete requires `confirmEmail` match — `adminRoutes.ts:466-517`; account/data deletes require password re-auth — `validation.ts:705-713`, `settingsRoutes.ts:98-113`.
- [x] No sensitive mutation on a GET except the FHIR OAuth callback (provider-driven redirect, PKCE+state bound) and `connect/quest` (read-only OAuth initiation) — by design — `fhirRoutes.ts:24,30`.

### 6. Response security
- [x] No password hash / token in user-facing selects — admin/provider/patient user selects allowlist non-secret columns (`id,email,role,...`); explicit comment forbids `password_hash`/`*_token` in provider context — `providerRoutes.ts:76-77`, `adminRoutes.ts:67-82`.
- [x] Pagination enforced on list endpoints (admin users/audit-logs paginated; provider-relationships `take:100`) — `adminRoutes.ts:84-87,667,898-899`.
- [x] PHI decrypted only when serving the owning/consented user — provider biomarker/health-need decrypt happens only after ACTIVE+unexpired+capability checks — `providerRoutes.ts:512-537,652-668`.

### 7. Role-based route protection
- [x] Provider routes — router-level `requireRole('PROVIDER','ADMIN')` — `providerRoutes.ts:26`.
- [x] Patient consent routes — router-level `requireRole('PATIENT')` — `patientRoutes.ts:24`.
- [x] Admin routes — router-level `requireRole('ADMIN')` + `blockDemoAdminAccess`; `requireMinRole`/`adminOnly` helpers exist — `adminRoutes.ts:29-31`; `rbac.ts:77-93,358-359`.
- [x] Role read from JWT claims on each request (`req.user.role` set from verified token in `authenticate`) — `auth.ts:92-108`; `rbac.ts:64`.
- [x] Demo accounts blocked from sensitive ops — `blockDemoAI` on `/ai/chat` (`aiRoutes.ts:33`), FHIR connect/sync (`fhirRoutes.ts:33,46`), biomarker guidance (`biomarkerRoutes.ts:123`), uploads (`uploadRoutes.ts:81,98,129`); `blockDemoProfileUpdate` on settings mutations (`settingsRoutes.ts:44,60,79,101,110`); `isDemoAccount` fails closed when `DEMO_EMAIL` unset — `demoProtection.ts:33-36`.

### 7a. Plan gating & AI spend control
- [x] `/ai/chat` enforces `requirePlanLimit('aiChatsPerDay')` + `aiSpendGuard` — `aiRoutes.ts:32-34`.
- [x] FHIR connect/sync enforce `requirePlanFeature('questFhirIntegration')` — `fhirRoutes.ts:34,47`.
- [x] Plan limits read live from DB under RLS, not stale JWT; also enforces `planExpiresAt` downgrade — `planGating.ts:66-75`; `planRoutes.ts:65-72`.
- [x] Tier definitions in `config/plans.ts` (FREE/PRO/TEAM); usage via `services/usageTracker.ts` — `planRoutes.ts:19-24,73`; `planGating.ts:15`.

### 7b. FHIR / SMART-on-FHIR OAuth
- [x] `GET /fhir/callback` is the only unauthenticated FHIR route; bound to a user via PKCE + short-TTL (10 min) random 24-byte `state` (not user-supplied IDs); state consumed once — `fhirController.ts:76-107`; `smartAuth.ts:78-83,317-346`; `labSyncService.ts:95-128`.
- [x] OAuth tokens stored encrypted per-user (`accessTokenEncrypted`/`refreshTokenEncrypted`) and never logged in plaintext — `labSyncService.ts:142-169,213-216,230-239`.
- [x] Outbound FHIR URLs SSRF-guarded against host allowlist + private/loopback/metadata block + cleartext-to-public refusal — `services/fhir/urlSafety.ts:20-91`; `smartAuth.ts:44-50,117-127,167,211,289-293`.
- [x] Mutations carry `csrfProtection` (`sync` POST, `connections/:id` DELETE); `connect/quest` GET does not (read-only); all authed FHIR routes carry `sensitiveLimiter` — `fhirRoutes.ts:30-59`.

### 8. RLS context
- [x] DB queries run through `withRLSContext`/`withRLSTransaction` with userId from JWT — provider/patient/biomarker/file/fhir/plan handlers all wrap reads/writes (e.g. `providerRoutes.ts:51,227,709`; `patientRoutes.ts:37,204`; `fhirController.ts:119,152`; `planGating.ts:66`).
- [x] Admin/system ops use `withRLSContext(null, ..., { isAdmin: true })` — `adminRoutes.ts:61-92,137-164,407-411,535-541`.
- [x] Provider cross-user queries scoped by ACTIVE+unexpired+capability before decrypt; RLS provider policies are the backstop — `providerRoutes.ts:443-466,583-606`; `rbac.ts:202-250`.

### Middleware ordering (app.ts)
- [x] Helmet → CORS → cookie-parser → compression → global `csrfProtection` → `standardLimiter` → morgan (query-stripped in prod) → body parser (10MB) → `requireJsonContentType` → `no-store` cache header on `/api` → routes → internal routes → 404 → error handler — `app.ts:125-330`.
- [x] CSRF double-submit uses SHA-256-normalized constant-time compare (`timingSafeEqual` on equal-length digests) — `csrf.ts:164-166`.
- [x] Internal scheduler route fails closed (404 when token unset) and uses constant-time token compare — `internalRoutes.ts:27-33,45-62`.
- [x] `requireBearerAuth` ignores the cookie path so the `/ai/chat` CSRF exemption can't be combined with cookie auth — `auth.ts:59-65,180-220`.

## Unverifiable
- Frontend CSRF token attachment on uploads — `csrf.ts:120-125` references `services/uploadUtils.ts` reading `csrf_token` and attaching `X-CSRF-Token`; this review covered backend routes/middleware only, so the frontend's actual behavior was not opened (out of declared scope for this prompt). The backend correctly *requires* CSRF on upload routes now (the prior exemption was removed), which is what matters for the route-layer review.
- Effective rate-limit ceiling across Cloud Run instances — `rateLimiter.ts:7-14` defaults to in-process MemoryStore (N×limit across N instances) unless `REDIS_URL` is set. Whether `REDIS_URL` is configured in the live deploy is a deploy-config fact not present in the repo. The code path for the shared Redis store exists and is correct; this is already tracked as audit #37 and is out of scope for an API-routes review.

## Out of scope
- Encryption/PHI-field correctness (`PHI_FIELDS` vs schema) — covered by 02-encryption / `_phi-inventory.md`. I confirmed LabConnection OAuth tokens are encrypted (relevant to checklist 7b) but did not re-audit the full PHI inventory.
- Audit-log content/retention internals — covered by 05-audit-logging. I verified audit calls are *present* on the route paths (auth/access/create/update/delete) but did not validate salt/retention semantics.
- AI prompt-injection / PHI-redaction depth in `aiChatController`/`biomarkerRoutes` guidance prompt construction — covered by 27-ai-integration / 31-logging-observability. I confirmed `sanitizeForPrompt` and `stripPHIFromText` are applied (`biomarkerRoutes.ts:184-185,244`) but did not audit their completeness.
- The dev-only mock FHIR server (`app.ts:275-281`) — gated on `config.isDevelopment` and never mounted in production; not exercised.
