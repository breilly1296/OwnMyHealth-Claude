---
tags:
  - security
  - api
  - high
type: prompt
priority: 2
updated: 2026-06-01
---

# API Routes Security Review

## Files to Review
- `backend/src/routes/*.ts` (all 18 route files incl. `index.ts`)
- `backend/src/app.ts` (route registration + `internalRoutes` mount + CSRF/limiter wiring order)
- `backend/src/middleware/` (auth, csrf, rbac, rateLimiter/rateLimitStore, validation, demoProtection, planGating, aiSpendGuard, errorHandler)
- `backend/src/controllers/upload/` (upload handlers; `uploadController.ts` was removed)

## OwnMyHealth API Architecture
- **Base Path**: `/api/${config.apiVersion}` (= `/api/v1`); mounted in `backend/src/app.ts` (`app.use(\`/api/${config.apiVersion}\`, routes)`)
- **Auth**: JWT access token via HttpOnly cookie OR `Authorization: Bearer` header. Most routes use `authenticate` (accepts either). The AI streaming route uses `requireBearerAuth` (bearer-only) because it is CSRF-exempt — see note in `aiRoutes.ts`.
- **CSRF**: Double-submit cookie required on mutations (POST/PUT/PATCH/DELETE), EXCEPT exempted paths in `middleware/csrf.ts`: `bearerOnlyStreamingRoutes` (`/ai/chat`) and the scheduler path (`/internal/audit-cleanup`).
- **Internal routes**: `/api/v1/internal/*` (mounted separately in `app.ts`, NOT via `routes/index.ts`) authenticate via the `X-Cleanup-Token` shared-secret header — NOT JWT/session — and 404 unless `AUDIT_CLEANUP_TOKEN` is configured. Intended for Cloud Scheduler.
- **Rate Limiting**: 8 named limiters in `middleware/rateLimiter.ts`, backed by `rateLimitStore.ts` (Redis via `REDIS_URL`, in-memory fallback)
- **AI spend control**: `/ai/chat` is additionally gated by `aiSpendGuard` (daily budget) and `requirePlanLimit('aiChatsPerDay')`

## Checklist

### 1. Route Authentication
For each route file, verify auth middleware applied (18 route files incl. `index.ts`):
- [ ] `authRoutes.ts` - public routes (register, login, refresh, demo, verify-email, resend-verification, forgot-password, reset-password, confirm-email-change); protected routes use `authenticate` (logout, logout-all, me, change-password, change-email)
- [ ] `biomarkerRoutes.ts` - all protected (includes AI guidance endpoint)
- [ ] `fileRoutes.ts` - all protected
- [ ] `uploadRoutes.ts` - all protected (handlers live in `controllers/upload/` — `labUploadController`, `sbcUploadController`; the old single `uploadController.ts` was removed)
- [ ] `insuranceRoutes.ts` - all protected
- [ ] `expenseRoutes.ts` - all protected
- [ ] `healthGoalsRoutes.ts` - all protected
- [ ] `healthNeedsRoutes.ts` - all protected
- [ ] `providerRoutes.ts` - protected + `requireRole('PROVIDER', 'ADMIN')`
- [ ] `patientRoutes.ts` - protected + `requireRole('PATIENT')`
- [ ] `adminRoutes.ts` - protected + `requireRole('ADMIN')`
- [ ] `settingsRoutes.ts` - all protected (notification prefs, export, delete data, delete account)
- [ ] `aiRoutes.ts` (NEW) - `requireBearerAuth` (bearer-only, CSRF-exempt) + `aiLimiter` + `aiSpendGuard` + `blockDemoAI` + `requirePlanLimit('aiChatsPerDay')` on `POST /ai/chat`
- [ ] `fhirRoutes.ts` (NEW) - `authenticate` on all EXCEPT `GET /fhir/callback` (OAuth redirect lands as an unauthenticated GET; bound to a user via PKCE + stashed state). All authed routes add `sensitiveLimiter` + `blockDemoAI`; `connect/quest` (GET) + `sync` (POST) also add `requirePlanFeature('questFhirIntegration')`; `sync` (POST) + `connections/:id` (DELETE) also add `csrfProtection` (the GET `connect/quest` does not)
- [ ] `onboardingRoutes.ts` (NEW) - `authenticate` on all (`GET /status`, `POST /complete`)
- [ ] `planRoutes.ts` (NEW) - `GET /plan/available` is PUBLIC (no auth, pricing page); `GET /plan` requires `authenticate`
- [ ] `internalRoutes.ts` (NEW) - NOT JWT-protected: `X-Cleanup-Token` shared secret only; 404 unless `AUDIT_CLEANUP_TOKEN` set; mounted in `app.ts`, not `routes/index.ts`

### 2. Authorization (Beyond Authentication)
- [ ] Users can only access their own resources
- [ ] `userId` from JWT used (not from request body)
- [ ] No IDOR vulnerabilities (can't access other users' data by changing IDs)

### 3. Input Validation
- [ ] Request body validated before processing
- [ ] URL parameters validated (UUIDs, enums)
- [ ] Query parameters sanitized
- [ ] File uploads validated (type, size)

### 4. Error Responses
- [ ] Generic error messages to client
- [ ] Detailed errors logged server-side
- [ ] No stack traces in production responses
- [ ] No database error details leaked

### 5. HTTP Methods
- [ ] Correct methods used (GET for read, POST for create, etc.)
- [ ] No sensitive operations on GET endpoints
- [ ] DELETE endpoints require confirmation or are idempotent

### 6. Response Security
- [ ] No sensitive data in responses (passwords, tokens, keys)
- [ ] PHI decrypted only when needed
- [ ] Pagination on list endpoints (prevent data dumps)

### 7. Role-Based Route Protection
- [ ] Provider routes enforce `requireRole('PROVIDER', 'ADMIN')` (router-level `router.use` in `providerRoutes.ts`)
- [ ] Patient consent routes enforce `requireRole('PATIENT')` (router-level `router.use` in `patientRoutes.ts`)
- [ ] Admin routes enforce `requireRole('ADMIN')` (router-level `router.use` in `adminRoutes.ts`; `requireMinRole`/`adminOnly` helpers also exist in `rbac.ts`)
- [ ] Role checked from JWT claims (re-verified on each request)
- [ ] Demo accounts blocked from sensitive operations (`demoProtection.ts`: `blockDemoAI` used on `/ai/chat` and FHIR connect/sync)

### 7a. Plan Gating & AI Spend Control (NEW domains)
- [ ] `/ai/chat` enforces `requirePlanLimit('aiChatsPerDay')` (`middleware/planGating.ts`) and `aiSpendGuard` (per-day budget via `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD`)
- [ ] FHIR connect/sync enforce `requirePlanFeature('questFhirIntegration')`
- [ ] Plan/feature limits read live from DB, not stale JWT claims (see `planRoutes.ts` reads `users.plan` via `withRLSContext`)
- [ ] Tier definitions live in `config/plans.ts` (FREE/PRO/TEAM); usage tracked via `services/usageTracker.ts`

### 7b. FHIR / SMART-on-FHIR OAuth (NEW domain)
- [ ] `GET /fhir/callback` is the ONLY unauthenticated FHIR route; verify it is bound to a user via PKCE + a short-TTL random `state` (not user-supplied IDs)
- [ ] OAuth tokens stored encrypted (`LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted` in `PHI_FIELDS`)
- [ ] Outbound FHIR URLs validated against SSRF (`services/fhir/urlSafety.ts`, `QUEST_FHIR_AUTH_HOSTS` allowlist)
- [ ] Mutations carry `csrfProtection`: `sync` (POST) and `connections/:id` (DELETE) do; `connect/quest` (GET) does not (read-only OAuth initiation). All authed FHIR routes carry `sensitiveLimiter`

### 8. RLS Context
- [ ] `withRLSContext(userId, ...)` or `withRLSTransaction(userId, ...)` used for all DB queries
- [ ] userId from JWT token (not request body)
- [ ] Admin operations use `withRLSContext(null, ...)` for system access
- [ ] Provider cross-user queries properly scoped

## Route Inventory
Generate a complete route list (use the Grep tool; pattern `router\.(get|post|put|delete|patch)\(` over `backend/src/routes/`, excluding `*.test.ts`).

Expected route files (18 incl. `index.ts`):
```
authRoutes.ts, biomarkerRoutes.ts, insuranceRoutes.ts, expenseRoutes.ts,
healthGoalsRoutes.ts, healthNeedsRoutes.ts, uploadRoutes.ts, fileRoutes.ts,
providerRoutes.ts, patientRoutes.ts, settingsRoutes.ts, adminRoutes.ts,
aiRoutes.ts, fhirRoutes.ts, internalRoutes.ts, onboardingRoutes.ts,
planRoutes.ts, index.ts
```
Mounting: `routes/index.ts` mounts auth/biomarkers/insurance/expenses/health-needs/health-goals/provider/patient/admin/upload/files/settings/ai/fhir/plan/onboarding. `internalRoutes.ts` is mounted directly in `app.ts` at `/api/v1/internal` (NOT via `index.ts`).

## Questions to Ask
1. Are there any routes missing authentication?
2. Can users access other users' resources?
3. Are all inputs validated before use?
4. Are provider routes properly checking consent permissions?
5. Are admin routes restricted to ADMIN role only?
6. Is the CSRF exemption for `/ai/chat` safe? (i.e., is it bearer-only via `requireBearerAuth`, so a cookie-borne cross-site POST can't pass auth AND skip CSRF?)
7. Does `/fhir/callback` (the only unauthenticated FHIR route) safely bind to a user without a session (PKCE + random state)?
8. Are `internalRoutes` adequately protected by the `X-Cleanup-Token` constant-time check, and do they fail closed (404) when the secret is unset?
9. Are plan-gated routes (`/ai/chat`, FHIR connect/sync) reading the live plan, not a stale JWT claim?
10. Are OAuth tokens (`LabConnection`) encrypted and outbound FHIR URLs SSRF-guarded?
