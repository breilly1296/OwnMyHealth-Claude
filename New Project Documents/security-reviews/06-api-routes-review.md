# API Routes Review — 2026-06-16

Scope: `backend/src/routes/*.ts` (18 files incl. `index.ts`), `backend/src/app.ts`, `backend/src/middleware/*` (auth, csrf, rbac, rateLimiter/rateLimitStore, validation, demoProtection, planGating, aiSpendGuard, errorHandler), `backend/src/controllers/upload/`, plus the FHIR OAuth path (`controllers/fhirController.ts`, `services/fhir/smartAuth.ts`, `services/fhir/urlSafety.ts`) and the AI streaming controller. HEAD `fb2cd32`. Static review only — no code modified. Route inventory: 113 `router.<verb>(` declarations across the 18 files (verified via Grep).

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |

No Critical/High/Medium findings. The API surface is uniformly authenticated, RLS-scoped, CSRF-protected, role-gated, plan-gated, and audit-logged. The three Low findings are hygiene/latent-trap items, not live exploits. Two of them are prompt-drift notes per the review protocol.

## Findings

### F-1 — Dead CSRF exemption for an unmounted `/marketplace/plans/search` route — **Low**
- **Location:** `backend/src/middleware/csrf.ts:132`
- **Observation:** The CSRF `EXEMPT_PATHS` set contains `'/api/v1/marketplace/plans/search'`, but no `marketplace` route is mounted anywhere. `routes/index.ts` (lines 82-113) mounts auth/biomarkers/insurance/expenses/health-needs/health-goals/provider/patient/admin/upload/files/settings/ai/fhir/plan/onboarding — no marketplace. A Grep for `marketplace` across `backend/src` returns only knowledge-base text (`services/knowledge/*`) and this exemption line. The CLAUDE.md "Removed Features" section confirms CMS Marketplace was removed.
- **Impact:** No current exploit — the exempt path resolves to a non-existent route, so nothing handles it. The risk is latent: if a `POST /marketplace/plans/search` (or any path normalizing to that string) is ever re-introduced, it would silently ship CSRF-exempt because the carve-out already exists. Defense-in-depth erosion by accumulation of stale allowlist entries.
- **Fix:** Remove the `'/api/v1/marketplace/plans/search'` entry from `EXEMPT_PATHS` in `validateCsrfToken` (`csrf.ts:132`). The exemption set should only contain paths that correspond to live routes whose CSRF-exemption is individually justified.
- **Evidence:**
  ```ts
  // csrf.ts:132 — inside EXEMPT_PATHS
  '/api/v1/marketplace/plans/search',
  ```

### F-2 — Prompt drift: prompt enumerates `/marketplace/plans/search` as a current exempt path — **Low**
- **Location:** `prompts/06-api-routes.md:22` (and the same path baked into `csrf.ts:124-145`)
- **Observation:** The prompt's CSRF section lists "10 paths" including `/marketplace/plans/search` as a legitimate live exemption. Per the review protocol's "When the prompt disagrees with the code" rule, this is recorded as prompt drift: the path is exempt in code (csrf.ts:132) but has no mounted route, so describing it as a real exemption overstates the live surface. The accurate live exempt set is the 9 paths that map to real handlers (`/auth/login`, `/auth/register`, `/auth/demo`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`, `/ai/chat`, `/internal/audit-cleanup`) plus this dead 10th.
- **Impact:** Documentation only — feeds the quarterly prompt-refresh task. No runtime effect.
- **Fix:** When F-1 removes the dead entry, drop `/marketplace/plans/search` from the prompt's exempt list (06-api-routes.md:22) and update the count from 10 to 9.
- **Evidence:**
  ```
  prompts/06-api-routes.md:22 — "...EXCEPT the 10 paths ... '/marketplace/plans/search', ..."
  ```

### F-3 — `ensureCsrfToken` middleware is exported but never mounted (dead code) — **Low**
- **Location:** `backend/src/middleware/csrf.ts:70-80`
- **Observation:** `ensureCsrfToken` is a fully implemented exported middleware, but it is not referenced in `app.ts` or any route file (the live CSRF entry point is `csrfProtection`, mounted at `app.ts:216`, which has its own inline cookie-seeding at csrf.ts:199-201). The combined `csrfProtection` already seeds the cookie, so `ensureCsrfToken` is redundant. Dead exported middleware is a minor maintenance trap (a future dev could mount it believing it adds protection, or it could mask the real cookie-seeding path).
- **Impact:** None at runtime — it is never invoked. Hygiene only.
- **Fix:** Remove `ensureCsrfToken` (csrf.ts:70-80) unless a deliberate future caller is intended; the cookie-seeding it performs is already covered by `csrfProtection` and `csrfTokenHandler`. Confirm no test references it before deleting.
- **Evidence:**
  ```ts
  // csrf.ts:70 — exported, but no importer
  export function ensureCsrfToken(req, res, next): void { ... }
  ```

## Checks passed

### 1. Route Authentication
- [x] `authRoutes.ts` — public routes (register/login/refresh/demo/verify-email/resend-verification/forgot-password/reset-password/confirm-email-change) carry no `authenticate`; protected routes use `authenticate` (`logout` uses `optionalAuth` by design — authRoutes.ts:114; `logout-all`, `me`, `change-password`, `change-email` use `authenticate` — authRoutes.ts:117-138). `authLimiter` on the whole router (line 34); `strictAuthLimiter` on login/forgot/reset/resend/confirm/change-email.
- [x] `biomarkerRoutes.ts` — `router.use(authenticate)` (line 48) protects all; AI guidance adds `aiLimiter`+`aiSpendGuard`+`blockDemoAI`+`requirePlanLimit('aiGuidancePerDay')` (lines 133-139) and a BAA gate (lines 150-164).
- [x] `fileRoutes.ts` — `router.use(authenticate)` (line 42); ownership enforced by `{ id, userId }` scope + RLS in the controller (documented lines 27-41, verified `fileController.getFiles` scopes `where: { userId }` under `withRLSTransaction`, fileController.ts:59-72).
- [x] `uploadRoutes.ts` — every route carries `authenticate` (lines 80, 102, 133); handlers live in `controllers/upload/` (`uploadLabReport`, `uploadSBC`, `uploadLabResultOCR`).
- [x] `insuranceRoutes.ts` — `router.use(authenticate)` (line 64); AI-bearing reanalyze/upload-sbc add `blockDemoAI`+`uploadLimiter`+`aiLimiter`+`aiSpendGuard`+`requirePlanLimit('pdfUploadsPerMonth')` (lines 119-142).
- [x] `expenseRoutes.ts` — `router.use(authenticate)` (line 32); mutations add explicit `csrfProtection`; `/analyze` adds `aiLimiter`+`aiSpendGuard`+`blockDemoAI`+`requirePlanLimit('costAnalysisPerMonth')` (lines 113-119).
- [x] `healthGoalsRoutes.ts` — `router.use(authenticate)` (line 42).
- [x] `healthNeedsRoutes.ts` — `router.use(authenticate)` (line 39); `/summary` declared before `/:id` to avoid param capture (line 53).
- [x] `providerRoutes.ts` — `router.use(authenticate)` + `router.use(requireRole('PROVIDER','ADMIN'))` (lines 27-28).
- [x] `patientRoutes.ts` — `router.use(authenticate)` + `router.use(requireRole('PATIENT'))` (lines 22-24).
- [x] `adminRoutes.ts` — `router.use(authenticate)` + `router.use(blockDemoAdminAccess)` + `router.use(requireRole('ADMIN'))` (lines 30-32).
- [x] `settingsRoutes.ts` — `router.use(authenticate)` (line 31); profile/notification/health-profile/delete-data/delete-account add `sensitiveLimiter`+`blockDemoProfileUpdate`; health-profile PATCH adds `requirePlanFeature('healthProfile')`.
- [x] `aiRoutes.ts` — `router.use(requireBearerAuth)` (line 21, NOT `authenticate`) + `aiLimiter`+`aiSpendGuard`+`blockDemoAI`+`requirePlanLimit('aiChatsPerDay')`+`validate(schemas.ai.chat)` on `POST /chat` (lines 29-37).
- [x] `fhirRoutes.ts` — `GET /callback` is the only unauthenticated route (line 24); `router.use(authenticate)` for everything after (line 27); connect/sync/delete add `sensitiveLimiter`+`blockDemoAI`; connect/quest+sync add `requirePlanFeature('questFhirIntegration')`; sync(POST)+connections/:id(DELETE) add `csrfProtection`; connect/quest(GET) does not (read-only).
- [x] `onboardingRoutes.ts` — `router.use(authenticate)` (line 22) on both `/status` and `/complete`; GET is read-only (no write) per the comment at lines 6-12.
- [x] `planRoutes.ts` — `GET /available` is public (no `authenticate`, line 32); `GET /` requires `authenticate` (line 54).
- [x] `internalRoutes.ts` — NOT JWT/session protected; `X-Cleanup-Token` constant-time compare (`tokenMatches`, lines 27-33); 404 when `AUDIT_CLEANUP_TOKEN` unset (lines 45-52); mounted directly in `app.ts:269`, not via `routes/index.ts`.

### 2. Authorization (Beyond Authentication)
- [x] Users access only their own resources — every controller scopes by `req.user!.id` under RLS; provider cross-user reads go through `resolveProviderAccess(tx, providerId, patientId, flag)` (providerRoutes.ts:456, 539, 611).
- [x] `userId` taken from JWT, never request body — Grep for `req.body.userId` / `userId: req.body` across `controllers/` returns **zero** matches.
- [x] No IDOR — biomarker AI-guidance loads the row under RLS scoped `{ id, userId }` and 404s on miss to prevent enumeration (biomarkerRoutes.ts:173-191); file/insurance/expense/health-* controllers identically scope by `{ id, userId }`.

### 3. Input Validation
- [x] Bodies validated with Zod before processing — `validate(schemas.*)` on every mutation (e.g. biomarkerRoutes.ts:88, insuranceRoutes.ts:84, patientRoutes.ts:182-183).
- [x] URL params validated — `validate(schemas.uuidParam,'params')` / `patientIdParam` / `connectionIdParam` on every `:id`/`:patientId`/`:connectionId` route (validation.ts:332-349).
- [x] Query params sanitized/clamped — pagination clamped to 1..100 (`schemas.pagination`, validation.ts:326-329); enum filters validated.
- [x] File uploads validated — multer `fileSize: 10MB`, `files: 1`, MIME `fileFilter` (PDF-only for lab/SBC; PDF+images for OCR) (uploadRoutes.ts:30-69, insuranceRoutes.ts:38-51); oversize/invalid mapped to 413/400 in errorHandler.ts:165-175.

### 4. Error Responses
- [x] Generic client messages in production — `message = config.isDevelopment ? err.message : GENERIC_ERROR_MESSAGE` (errorHandler.ts:144); Prisma/JWT mapped to safe shapes (errorHandler.ts:109-131).
- [x] Detailed errors logged server-side only — 5xx always logged with full detail; 4xx logged only in dev (errorHandler.ts:190-196).
- [x] No stack traces in prod responses — stack included only when `config.isDevelopment` (errorHandler.ts:206).
- [x] No DB error details leaked — Prisma codes mapped to generic shapes; unknown DB errors fall back to `DATABASE_ERROR` + generic message (errorHandler.ts:116).

### 5. HTTP Methods
- [x] Correct verbs — GET for reads, POST/PUT/PATCH for writes, DELETE for removals across all routers.
- [x] No sensitive write on a GET — `onboarding/status` GET is explicitly a pure read (the durable stamp is written only by the CSRF-protected POST `/complete`, onboardingRoutes.ts:6-12); `fhir/connect/quest` GET only builds an OAuth redirect URL, no state change.
- [x] DELETE endpoints idempotent/confirmed — admin permanent-delete requires `confirmEmail` match (adminRoutes.ts:542); settings delete-data/delete-account require password re-auth (validation.ts:822-830); file/relationship deletes scoped by ownership and 404 on miss.

### 6. Response Security
- [x] No secrets in responses — admin user selects exclude `passwordHash`/tokens (adminRoutes.ts:68-87, provider patient select is `{id,email,createdAt}` only, providerRoutes.ts:98); audit-log admin view explicitly drops `previousValueEncrypted`/`newValueEncrypted` ciphertext (adminRoutes.ts:1000-1020).
- [x] PHI decrypted only when needed — provider reads decrypt with the *patient's* salt only after `resolveProviderAccess` passes (providerRoutes.ts:480-489, 563-571, 637-638).
- [x] Pagination on list endpoints — biomarkers/files/health-needs/health-goals/expenses/admin-users/audit-logs all clamp `take` to ≤100 (≤200 for audit logs); admin audit-logs additionally pins a 1-year lookback floor to prevent full-table scans (adminRoutes.ts:971-989).

### 7. Role-Based Route Protection
- [x] Provider routes enforce `requireRole('PROVIDER','ADMIN')` at router level (providerRoutes.ts:28).
- [x] Patient routes enforce `requireRole('PATIENT')` at router level (patientRoutes.ts:24).
- [x] Admin routes enforce `requireRole('ADMIN')` at router level, with `blockDemoAdminAccess` ahead of it (adminRoutes.ts:31-32).
- [x] Role re-checked per request from JWT claims — `requireRole` reads `req.user.role` set by `authenticate` on every request (rbac.ts:62-76); admin role/deactivation changes stamp `tokensValidAfter` so stale access JWTs are rejected cross-instance (adminRoutes.ts:317-322, 478).
- [x] Demo accounts blocked — `blockDemoAI` on `/ai/chat`, all AI upload paths, expense `/analyze`, insurance reanalyze/upload-sbc, and FHIR connect/sync/delete; `blockDemoProfileUpdate` on settings mutations; `blockDemoAdminAccess` on admin (demoProtection.ts:67-78, 145-175).

### 7a. Plan Gating & AI Spend Control
- [x] `aiSpendGuard` on all 8 mount points across 5 files — `aiRoutes.ts:32`, `uploadRoutes.ts:82/104/135`, `biomarkerRoutes.ts:136`, `expenseRoutes.ts:114`, `insuranceRoutes.ts:125/138`. Fails closed with 503 on budget-reached AND on shared-store error (aiSpendGuard.ts:38-68); reservation backed out on `finish`/`close` (idempotent settle, lines 74-75).
- [x] `/ai/chat` enforces `requirePlanLimit('aiChatsPerDay')` (aiRoutes.ts:34).
- [x] FHIR connect/sync enforce `requirePlanFeature('questFhirIntegration')` (fhirRoutes.ts:34, 59).
- [x] Plan limits read live from DB, not stale JWT — `requirePlanLimit` reads `users.plan`+`planExpiresAt` under `withRLSContext` and downgrades expired plans to FREE; fails CLOSED to FREE on DB error (planGating.ts:60-88). `GET /plan` reports the effective post-expiry tier (planRoutes.ts:78-92).
- [x] Tier defs in `config/plans.ts`; usage tracked via `services/usageTracker.ts` (imported in planGating.ts:15 and planRoutes.ts:18).

### 7b. FHIR / SMART-on-FHIR OAuth
- [x] `GET /fhir/callback` is the only unauthenticated FHIR route and binds to a user via PKCE + a 24-byte random `state` (smartAuth.ts:104) with a single-use, delete-on-read, 10-minute-TTL cache keyed by `state` carrying the `userId` server-side (smartAuth.ts:367-407); the callback never reads a user ID from the request (fhirController.ts:80-107).
- [x] OAuth tokens stored encrypted — `LabConnection.accessTokenEncrypted`/`refreshTokenEncrypted` are in `PHI_FIELDS` (per `_phi-inventory.md`); never logged in plaintext (fhirController.ts error logs carry only message strings).
- [x] Outbound FHIR URLs SSRF-guarded — `assertAllowedFhirUrl` enforces host allowlist (base host + `QUEST_FHIR_AUTH_HOSTS`), refuses cleartext http to public hosts, and `isPrivateOrLoopbackHost` blocks loopback/private/link-local incl. cloud metadata `169.254.169.254` (urlSafety.ts:28-99); applied to authorize/token/refresh/revoke and discovery (smartAuth.ts:143-163, 202, 246, 339).
- [x] Mutating FHIR routes carry CSRF — sync(POST) and connections/:id(DELETE) include `csrfProtection`; connect/quest(GET) correctly omits it; all authed FHIR routes carry `sensitiveLimiter` (fhirRoutes.ts:30-72).

### 8. RLS Context
- [x] All DB queries use `withRLSContext`/`withRLSTransaction` — 103 usages across controllers (Grep); spot-verified in fileController, biomarkerRoutes guidance, provider/patient routes, admin routes.
- [x] `userId` for RLS comes from JWT (`req.user!.id`), never request body.
- [x] Admin/system operations use `withRLSContext(null, …, { isAdmin: true })` — adminRoutes (users/stats/audit-logs), patientRoutes provider-display lookup (patientRoutes.ts:49-63), providerRoutes email→patient resolution (providerRoutes.ts:186-195). Disclosure is bounded by id-sets/column allowlists.
- [x] Provider cross-user queries scoped — run in the provider's own RLS session and gated by `resolveProviderAccess` before any patient PHI is read/decrypted (providerRoutes.ts:455-463, 538-546, 610-619).

### Cross-cutting (app.ts wiring)
- [x] CSRF mounted app-root before the `/api/v1` router so `req.path` includes the prefix and the `EXEMPT_PATHS` strict-`===` allowlist matches correctly (app.ts:215-217, csrf.ts:100-156). The prod-mount condition `!config.isDevelopment || process.env.DISABLE_CSRF !== 'true'` always mounts in production/staging.
- [x] `requireBearerAuth` truly ignores the cookie path (reads only `Authorization: Bearer`, auth.ts:62-68) — so the `/ai/chat` CSRF exemption cannot be combined with cookie auth for a cross-site POST. Confirms the answer to prompt Question 6.
- [x] CORS reflects an exact allowlist (never `*`), unions hardcoded prod origins, rejects localhost in prod, `credentials: true` (app.ts:79-191).
- [x] No PHI in request-line logs — prod morgan format strips query strings (`:urlpath`) and omits Referer, preventing `?token=` reset/verify secrets from reaching Cloud Logging (app.ts:231-244).
- [x] Blanket `Cache-Control: no-store` on `/api` (app.ts:259-262).

## Unverifiable
- **Cross-instance behavior of the in-memory PKCE state cache, AI-spend accumulator, and MemoryStore rate limiters under real multi-instance autoscale.** These are documented per-process unless `REDIS_URL` is set (smartAuth.ts:374-386 L-39; config/index.ts:248-258; rateLimiter.ts:56-63). Static review confirms the code and the documented limitation; the actual multi-instance failure/ceiling behavior is runtime/infra and not statically verifiable here.
- **`X-Cleanup-Token` value strength and Cloud Scheduler wiring.** Code path is correct (404 when unset, constant-time compare); whether the secret is provisioned and strong in prod is an ops fact outside the repo.

## Out of scope
- Deep encryption-correctness of `PHI_FIELDS` vs schema — owned by `02-encryption` / `_phi-inventory.md` (referenced, not re-audited here).
- Audit-log retention/immutability internals — owned by `05-audit-logging`.
- RLS policy SQL correctness in migrations — owned by `01-database-schema` (this review verifies the *application-layer* `withRLSContext` usage, not the policy DDL).
- Frontend CSRF token attachment (`services/uploadUtils.ts`, `services/api/client.ts`) — backend exemption logic verified; the client-side double-submit wiring is a frontend concern.
- TOCTOU plan-limit / AI-quota races (planGating.ts:90-98, biomarkerRoutes.ts:96-101) — these are *documented, deliberately-accepted* races backstopped by the dollar spend-cap (tracked as L34/L36 in project memory), not new findings of this review.
