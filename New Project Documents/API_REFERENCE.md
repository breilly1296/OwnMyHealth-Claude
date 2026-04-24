---
title: API_REFERENCE
updated: 2026-04-24
owner: platform
status: generated (prompt 17)
---

# API Reference

Complete per-endpoint contract for the OwnMyHealth backend. Pair with [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) (middleware-chain lens), [`DATA_MODEL.md`](./DATA_MODEL.md) (tables backing each endpoint), and [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) (encrypted fields returned).

Entry point: `backend/src/app.ts` (not `index.ts`). All `/api/v1/*` routes are mounted at `backend/src/app.ts:243` via `app.use(` + `/api/${config.apiVersion}` + `, routes)`.

---

## Table of contents

1. [Base URL + auth model](#base-url--auth-model)
2. [Error envelope + code catalog](#error-envelope--code-catalog)
3. [Global rate limits](#global-rate-limits)
4. [Demo-blocked routes](#demo-blocked-routes)
5. [At-a-glance mega-table (all 108 endpoints)](#at-a-glance-mega-table-all-108-endpoints)
6. [Root + health endpoints](#root--health-endpoints)
7. [Auth — `authRoutes.ts`](#auth--authroutests)
8. [Biomarkers — `biomarkerRoutes.ts`](#biomarkers--biomarkerroutests)
9. [Insurance — `insuranceRoutes.ts`](#insurance--insuranceroutests)
10. [Expenses — `expenseRoutes.ts`](#expenses--expenseroutests)
11. [Health needs — `healthNeedsRoutes.ts`](#health-needs--healthneedsroutests)
12. [Health goals — `healthGoalsRoutes.ts`](#health-goals--healthgoalsroutests)
13. [Provider — `providerRoutes.ts`](#provider--providerroutests)
14. [Patient — `patientRoutes.ts`](#patient--patientroutests)
15. [Admin — `adminRoutes.ts`](#admin--adminroutests)
16. [Uploads — `uploadRoutes.ts`](#uploads--uploadroutests)
17. [Files — `fileRoutes.ts`](#files--fileroutests)
18. [Settings — `settingsRoutes.ts`](#settings--settingsroutests)
19. [AI chat — `aiRoutes.ts`](#ai-chat--airoutests)
20. [FHIR — `fhirRoutes.ts`](#fhir--fhirroutests)
21. [Plan — `planRoutes.ts`](#plan--planroutests)
22. [Onboarding — `onboardingRoutes.ts`](#onboarding--onboardingroutests)
23. [Acceptance questions (self-answered)](#acceptance-questions-self-answered)
24. [Related Documents](#related-documents)

---

## Base URL + auth model

### Base URLs

| Environment | Base | Source |
|---|---|---|
| Production | `https://api.ownmyhealth.io` | TBD (external: Cloud Run service URL confirmed in [`ENV_VARS.md`](./ENV_VARS.md); production frontend pinned at `https://app.ownmyhealth.io` — see `HARDCODED_PRODUCTION_ORIGINS` in `backend/src/app.ts:64-67`) |
| Local dev | `http://localhost:3001` | `backend/src/app.ts:325` (listen on `config.port`, default 3001 per `backend/src/config/index.ts`) |

All API routes are prefixed with `/api/v1` — `backend/src/app.ts:243` mounts the router under `` `/api/${config.apiVersion}` ``, where `apiVersion` is `"v1"` from `config/index.ts`.

### Auth model — cookies vs Bearer

The same JWT (access token) is accepted from either of two transports. Source: `backend/src/middleware/auth.ts:33-46`.

```ts
// Source: backend/src/middleware/auth.ts:L33-L46
function extractToken(req: AuthenticatedRequest): string | null {
  // 1. Check HTTP-only cookie first (more secure)
  if (req.cookies?.access_token) {
    return req.cookies.access_token;
  }
  // 2. Fall back to Authorization header (for API clients)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}
```

| Cookie name | HttpOnly | Purpose | Lifetime | Set at |
|---|---|---|---|---|
| `access_token` | yes | JWT access token (accepted by `authenticate`) | 15 min (`config.cookie.maxAge.accessToken`) | `authController.ts:77-86` |
| `refresh_token` | yes | Opaque refresh token, DB-backed session | 7 days (or 30 days for demo in non-prod) | `authController.ts:92-105` |
| `csrf_token` | no (readable by JS) | CSRF double-submit cookie | 24 hours | `csrf.ts:32-58` |

### CSRF header

State-changing requests (POST/PUT/PATCH/DELETE) must echo the `csrf_token` cookie value in the `X-CSRF-Token` request header. Source: `backend/src/middleware/csrf.ts:156-176`.

```ts
// Source: backend/src/middleware/csrf.ts:L156-L176
const cookieToken = req.cookies[CSRF_COOKIE_NAME];
const headerToken = req.headers[CSRF_HEADER_NAME] as string;
if (!cookieToken || !headerToken) {
  throw new ForbiddenError('CSRF token missing');
}
if (cookieToken.length !== headerToken.length) {
  throw new ForbiddenError('Invalid CSRF token');
}
const tokensMatch = crypto.timingSafeEqual(
  Buffer.from(cookieToken),
  Buffer.from(headerToken)
);
if (!tokensMatch) {
  throw new ForbiddenError('Invalid CSRF token');
}
```

**Exempt paths (CSRF not required)** — `csrf.ts:96-148`:

- Public auth: `/auth/login`, `/auth/register`, `/auth/demo`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`
- Upload routes (multipart): `/upload/lab-report`, `/upload/insurance-sbc`, `/upload/lab-results-ocr`, `/insurance/upload-sbc`
- Marketplace legacy: `/marketplace/plans/search`
- Bearer-only SSE: `/ai/chat` — these routes **must** use `requireBearerAuth` instead of `authenticate` to prevent cookie auth from combining with CSRF exemption (`auth.ts:58-64, 166-201`).

### Auth flow (ASCII)

```
Client ──POST /auth/login──▶ authRoutes.ts:47
                                │ (authLimiter + strictAuthLimiter + validate)
                                ▼
                     authController.login (authController.ts:210)
                                │
                                ▼
                     authService.attemptLogin → generateTokens
                                │
                                ▼
        Set-Cookie: access_token, refresh_token, csrf_token
                                │
                                ▼
                     200 { success: true, data: { user } }

Client ──POST /biomarkers──▶ biomarkerRoutes.ts:82
   (Cookie: access_token=...; csrf_token=...)
   (Header: X-CSRF-Token: <same value>)
                                │ authenticate (auth.ts:70)
                                │ csrfProtection (csrf.ts:186)
                                │ standardLimiter (global, app.ts:216)
                                │ validate(schemas.biomarker.create)
                                ▼
                     biomarkerController.createBiomarker (biomarkerController.ts:226)
```

### Token lifecycle

- **Access token**: 15 min, `jwt.sign(..., config.jwt.accessSecret)` at `authService.generateTokens` (signed with HS256 via `JWT_SIGN_OPTIONS`, `backend/src/config/jwtOptions.ts`).
- **Refresh token**: 7 days, DB-backed (rows in `sessions`/`Session` table). Rotated on use (`refreshTokens` in authService).
- **CSRF token**: 24 hours, rotated on login and refresh (`authController.ts:309, 356`).

---

## Error envelope + code catalog

### Envelope shape

```ts
// Source: backend/src/middleware/errorHandler.ts:L189-L200
const response: ApiResponse = {
  success: false,
  error: {
    code,
    message,
    ...(details ? { details } : {}),
    // Only include stack trace in development mode
    ...(config.isDevelopment ? { stack: err.stack } : {}),
  },
};
res.status(statusCode).json(response);
```

Success responses follow the mirror shape:

```json
{ "success": true, "data": <payload>, "pagination": {...}?, "meta": {...}? }
```

### Error code catalog

43 distinct error `code` values appear in the backend (42 live + 1 test-only `FORBIDDEN`). Sources derived from grepping `code:\s*['"]([A-Z_]+)['"]` over `backend/src/**` plus the `AppError` subclasses in `errorHandler.ts:29-102`.

| Code | Default HTTP | Origin (file:line) | When thrown |
|---|---|---|---|
| `BAD_REQUEST` | 400 | `errorHandler.ts:31` (`BadRequestError`) | Generic client error; thrown across controllers |
| `UNAUTHORIZED` | 401 | `errorHandler.ts:37` (`UnauthorizedError`) | Missing / invalid access token (`auth.ts:79, 87, 104, 107, 175, 188`) |
| `AUTHENTICATION_FAILED` | 401 | `errorHandler.ts:43` (`AuthenticationError`) | Reserved constructor; not currently thrown |
| `FORBIDDEN` | 403 | `errorHandler.ts:49` (`ForbiddenError`) | RBAC denial, CSRF failure, demo blocks, provider consent checks |
| `NOT_FOUND` | 404 | `errorHandler.ts:55` (`NotFoundError`) | Resource missing; also Prisma P2025 map |
| `CONFLICT` | 409 | `errorHandler.ts:61` (`ConflictError`) + Prisma P2002 map `errorHandler.ts:110` | Duplicate email, unique constraint |
| `VALIDATION_ERROR` | 422 | `errorHandler.ts:69` (`ValidationError`) | Zod parse failure via `middleware/validation.ts:171-173` |
| `RATE_LIMIT_EXCEEDED` | 429 | `errorHandler.ts:76` + `rateLimiter.ts:22` | `standardLimiter` exhausted |
| `INTERNAL_ERROR` | 500 | `errorHandler.ts:82` (`InternalServerError`) | Fallback for non-AppError throws |
| `SERVICE_UNAVAILABLE` | 503 | `errorHandler.ts:88` (`ServiceUnavailableError`); manual emits `biomarkerRoutes.ts:144`, `aiChatController.ts:140`, `expenseController.ts:639`, `fhirController.ts:46` | BAA gate closed or external service disabled |
| `DATABASE_ERROR` | 500 | `errorHandler.ts:93` + Prisma default `errorHandler.ts:116`; manual `biomarkerController.ts:571` | Prisma generic / bulk insert failure |
| `EXTERNAL_SERVICE_ERROR` | 502 | `errorHandler.ts:98` (`ExternalServiceError`) | Wraps third-party failure |
| `INVALID_TOKEN` | 401 | `errorHandler.ts:123` | `jsonwebtoken.JsonWebTokenError` |
| `TOKEN_EXPIRED` | 401 | `errorHandler.ts:124` | `jsonwebtoken.TokenExpiredError` |
| `INVALID_JSON` | 400 | `errorHandler.ts:164` | `SyntaxError` from body parser |
| `AUTH_RATE_LIMIT_EXCEEDED` | 429 | `rateLimiter.ts:41` | `authLimiter` exhausted (all `/auth` routes) |
| `LOGIN_RATE_LIMIT_EXCEEDED` | 429 | `rateLimiter.ts:56` | `strictAuthLimiter` on login / reset / verify-resend |
| `UPLOAD_RATE_LIMIT_EXCEEDED` | 429 | `rateLimiter.ts:78` | `uploadLimiter` on `/upload/*`, `/insurance/upload-sbc` |
| `SENSITIVE_RATE_LIMIT_EXCEEDED` | 429 | `rateLimiter.ts:93` | `sensitiveLimiter` on admin permanent-delete, settings, files/:id/download, fhir sync/delete |
| `AI_RATE_LIMIT_EXCEEDED` | 429 | `rateLimiter.ts:108` | `aiLimiter` — biomarker guidance, AI chat, SBC upload, analyze, etc. |
| `BULK_RATE_LIMIT_EXCEEDED` | 429 | `rateLimiter.ts:127` | `bulkOperationLimiter` on `POST /biomarkers/batch` |
| `PLAN_LIMIT_EXCEEDED` | 403 | `planGating.ts:88` (used at `aiGuidancePerDay`, `pdfUploadsPerMonth`, `aiChatsPerDay`, etc.) | Subscription-tier quota reached (response includes `upgradeRequired` payload) |
| `EMAIL_NOT_VERIFIED` | 403 | `authController.ts:237` | Login before email verification |
| `ACCOUNT_LOCKED` | 423 | `authController.ts:256` | After N failed logins |
| `INVALID_CREDENTIALS` | 401 | `authController.ts:279` | Bad email/password on login |
| `VERIFICATION_FAILED` | 400 | `authController.ts:618` | Bad/expired email verification token |
| `RESEND_FAILED` | 400 | `authController.ts:664` | Resend verification path error |
| `RESET_FAILED` | 400 | `authController.ts:759` | Bad/expired password-reset token |
| `CONTEXT_ASSEMBLY_FAILED` | 500 | `aiChatController.ts:157` | Health-context decryption fails for AI chat |
| `CONNECT_FAILED` | 500 | `fhirController.ts:65` | Quest SMART-on-FHIR redirect builder threw |
| `SYNC_FAILED` | 500 | `fhirController.ts:172` | FHIR sync service failure |
| `DISCONNECT_FAILED` | 500 | `fhirController.ts:199` | `disconnectConnection` threw |
| `STORAGE_READ_FAILED` | 502 | `fileController.ts:284` | GCS stream error during download |

**Recovery playbooks** per code → [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md).

---

## Global rate limits

All 7 limiters defined in `backend/src/middleware/rateLimiter.ts`. Key generator defaults to client IP; `strictAuthLimiter` keys on `email:ip`; `aiLimiter` keys on userId (falls back to IP).

| Limiter | Window | Max | File:line | Applied to |
|---|---|---|---|---|
| `standardLimiter` | 15 min (`config.rateLimit.windowMs`) | 100 (`config.rateLimit.maxRequests`) | `rateLimiter.ts:16-32` | **Global** — mounted at `app.ts:216`; also explicitly on `GET /api/health/db` (`app.ts:292`) |
| `authLimiter` | 15 min | 20 | `rateLimiter.ts:35-47` | All `/auth/*` routes (router-level, `authRoutes.ts:32`) |
| `strictAuthLimiter` | 15 min | 5 (failed-only, skipSuccessful) | `rateLimiter.ts:50-69` | `POST /auth/login`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/resend-verification` |
| `uploadLimiter` | 1 hour | 20 | `rateLimiter.ts:72-84` | `POST /upload/*` (router-level, `uploadRoutes.ts:26`); `POST /insurance/upload-sbc`; `PUT /insurance/plans/:id/reanalyze` |
| `sensitiveLimiter` | 1 hour | 10 | `rateLimiter.ts:87-99` | `DELETE /admin/users/:id/permanent`; all `/settings/*`; `GET /files/:id/download`; FHIR `/connect/quest`, `/sync/:id`, `/connections/:id` |
| `aiLimiter` | 1 hour | 10 | `rateLimiter.ts:102-118` (keyed by userId) | `POST /biomarkers/:id/guidance`, `GET /health-needs/analyze`, `GET /health-goals/suggestions`, `POST /expenses/analyze`, `POST /ai/chat`, all `/upload/*` AI paths, `POST /insurance/upload-sbc`, `PUT /insurance/plans/:id/reanalyze` |
| `bulkOperationLimiter` | 1 hour | 30 | `rateLimiter.ts:121-133` | `POST /biomarkers/batch` |

**Known limitation** (`rateLimiter.ts:6-13`): in-memory MemoryStore per Cloud Run instance — attacker on N instances can achieve N× the stated limit until Redis-backed store is implemented.

---

## Demo-blocked routes

Source: `backend/src/middleware/demoProtection.ts`. Demo account is identified by `req.user.email === config.demo.email`. If `DEMO_EMAIL` is empty, nobody is demo (`demoProtection.ts:33-36`).

| Middleware | Blocks | Mounted on (examples) |
|---|---|---|
| `blockDemoAI` | Any AI endpoint | `biomarkerRoutes.ts:121`, `expenseRoutes.ts:112`, `insuranceRoutes.ts:118, 129`, `aiRoutes.ts:31`, all `/upload/*`, `/fhir/connect/quest`, `/fhir/sync`, `/fhir/connections/:id` |
| `blockDemoAdminAccess` | All admin routes | `adminRoutes.ts:30` (router-level) |
| `blockDemoProfileUpdate` | Profile mutation | `settingsRoutes.ts:44, 60, 79` |
| `blockDemoUserModification` | Admin modifying other users | Available but not currently wired — demo is already blocked at admin router level |
| `blockDemoRoleChange` | Role escalation attempts | Available; not currently mounted (admin router blocks demo wholesale) |

---

## At-a-glance mega-table (all 108 endpoints)

Columns: Method / Path / Auth / CSRF / Rate limiter (beyond global `standardLimiter`) / RBAC role / RLS wrap / Controller (`file:fn:line`) / Audit event / PHI returned?

| # | Method | Path | Auth | CSRF | Rate limiter | RBAC | RLS wrap | Controller (file:fn:line) | Audit | PHI? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/` | public | n/a (GET) | `standardLimiter` | — | — | inline `app.ts:261` | none | none |
| 2 | GET | `/health` | public | n/a | `standardLimiter` | — | — | inline `app.ts:275` | none | none |
| 3 | GET | `/api/health/db` | public | n/a | `standardLimiter` (explicit) | — | — | inline `app.ts:292` | none | none |
| 4 | GET | `/api/v1/health` | public | n/a | `standardLimiter` | — | — | inline `routes/index.ts:42` | none | none |
| 5 | GET | `/api/v1/` | public | n/a | `standardLimiter` | — | — | inline `routes/index.ts:54` | none | none |
| 6 | GET | `/api/v1/csrf-token` | public | n/a | `standardLimiter` | — | — | `csrfTokenHandler` (`csrf.ts:210`) | none | none |
| 7 | POST | `/api/v1/auth/register` | public | no (exempt) | `authLimiter` | — | none | `authController.register:146` | `REGISTER` (`ac:187`) | returns id/email/role |
| 8 | POST | `/api/v1/auth/login` | public | no (exempt) | `authLimiter`+`strictAuthLimiter` | — | none | `authController.login:210` | `LOGIN` / `LOGIN_FAILED` / `ACCOUNT_LOCKOUT` (`ac:229,248,270,291,312`) | email (non-PHI) |
| 9 | POST | `/api/v1/auth/refresh` | refresh cookie | no (exempt) | `authLimiter` | — | none | `authController.refreshToken:330` | none | token only |
| 10 | POST | `/api/v1/auth/demo` | public | no (exempt) | `authLimiter` | — | none | `authController.demoLogin:547` | none | none |
| 11 | GET | `/api/v1/auth/verify-email` | public | n/a | `authLimiter` | — | none | `authController.verifyEmail:594` | `EMAIL_VERIFICATION` (`ac:610,627`) | none |
| 12 | POST | `/api/v1/auth/resend-verification` | public | no (exempt) | `authLimiter`+`strictAuthLimiter` | — | none | `authController.resendVerification:648` | none | none |
| 13 | POST | `/api/v1/auth/forgot-password` | public | no (exempt) | `authLimiter`+`strictAuthLimiter` | — | none | `authController.forgotPassword:692` | `PASSWORD_RESET_REQUEST` (`ac:706`) | none |
| 14 | POST | `/api/v1/auth/reset-password` | public | no (exempt) | `authLimiter`+`strictAuthLimiter` | — | none | `authController.resetPasswordHandler:731` | `PASSWORD_RESET_COMPLETE` (`ac:751,768`) | none |
| 15 | POST | `/api/v1/auth/logout` | yes | yes | `authLimiter` | — | none | `authController.logout:374` | `LOGOUT` (`ac:403`) | none |
| 16 | POST | `/api/v1/auth/logout-all` | yes | yes | `authLimiter` | — | none | `authController.logoutAll:418` | `LOGOUT` (LOGOUT_ALL_DEVICES) (`ac:436`) | none |
| 17 | GET | `/api/v1/auth/me` | yes | n/a | `authLimiter` | — | none | `authController.getCurrentUser:452` | none | id/email/role |
| 18 | POST | `/api/v1/auth/change-password` | yes | yes | `authLimiter` | — | none | `authController.changePassword:479` | `PASSWORD_CHANGE` (`ac:529`) | none |
| 19 | GET | `/api/v1/biomarkers` | yes | n/a | `standardLimiter` | — | `withRLSTransaction` | `biomarkerController.getBiomarkers:111` | `Biomarker:LIST` (`bc:160`) | **yes** — decrypted value/unit/notes |
| 20 | GET | `/api/v1/biomarkers/summary` | yes | n/a | `standardLimiter` | — | `withRLSTransaction` | `biomarkerController.getSummary:657` | `Biomarker:SUMMARY` (`bc:715`) | counts only |
| 21 | GET | `/api/v1/biomarkers/categories` | yes | n/a | `standardLimiter` | — | `withRLSTransaction` | `biomarkerController.getCategories:422` | `Biomarker:CATEGORIES` (`bc:442`) | category strings |
| 22 | GET | `/api/v1/biomarkers/:id` | yes | n/a | `standardLimiter` | — | `withRLSTransaction` | `biomarkerController.getBiomarker:192` | `Biomarker:READ` (`bc:215`) | **yes** — decrypted value/notes |
| 23 | GET | `/api/v1/biomarkers/:id/history` | yes | n/a | `standardLimiter` | — | `withRLSTransaction` | `biomarkerController.getHistory:747` | `Biomarker:HISTORY` (`bc:819`) | **yes** — decrypted historical values |
| 24 | POST | `/api/v1/biomarkers` | yes | yes | `standardLimiter` | — | `withRLSTransaction` | `biomarkerController.createBiomarker:226` | `Biomarker:CREATE` (`bc:273`) | **yes** — decrypted echo |
| 25 | POST | `/api/v1/biomarkers/batch` | yes | yes | `bulkOperationLimiter` | — | `withRLSTransaction` | `biomarkerController.bulkCreateBiomarkers:458` | `Biomarker:CREATE[BULK]` (`bc:593`) | **yes** — decrypted echoes |
| 26 | PATCH | `/api/v1/biomarkers/:id` | yes | yes | `standardLimiter` | — | `withRLSTransaction` | `biomarkerController.updateBiomarker:288` | `Biomarker:UPDATE` (`bc:363`) | **yes** — decrypted echo |
| 27 | DELETE | `/api/v1/biomarkers/:id` | yes | yes | `standardLimiter` | — | `withRLSTransaction` | `biomarkerController.deleteBiomarker:381` | `Biomarker:DELETE` (`bc:409`) | name/category only |
| 28 | POST | `/api/v1/biomarkers/:id/guidance` | yes | yes | `aiLimiter` + `requirePlanLimit('aiGuidancePerDay')` + `blockDemoAI` | — | `withRLSTransaction` | inline `biomarkerRoutes.ts:124` | `biomarker_ai_guidance:PHI_ACCESS` (`br:271`) + `GUIDANCE_BLOCKED_NO_BAA` / `GUIDANCE_NOT_FOUND` | **yes** — decrypted value/unit sent to Anthropic; guidance text returned |
| 29 | GET | `/api/v1/insurance/plans` | yes | n/a | `standardLimiter` | — | see controller | `insuranceController.getInsurancePlans:412` | `InsurancePlan:LIST` (`ic:450`) | **yes** — decrypted memberId/groupId/planName |
| 30 | GET | `/api/v1/insurance/plans/:id` | yes | n/a | `standardLimiter` | — | see controller | `insuranceController.getInsurancePlan:466` | `InsurancePlan:READ` (`ic:489`) | **yes** |
| 31 | POST | `/api/v1/insurance/plans` | yes | yes | `standardLimiter` | — | see controller | `insuranceController.createInsurancePlan:500` | `InsurancePlan:CREATE` (`ic:585`) | **yes** |
| 32 | PATCH | `/api/v1/insurance/plans/:id` | yes | yes | `standardLimiter` | — | see controller | `insuranceController.updateInsurancePlan:600` | `InsurancePlan:UPDATE` (`ic:685`) | **yes** |
| 33 | DELETE | `/api/v1/insurance/plans/:id` | yes | yes | `standardLimiter` | — | see controller | `insuranceController.deleteInsurancePlan:703` | `InsurancePlan:DELETE` (`ic:731`) | name only |
| 34 | POST | `/api/v1/insurance/compare` | yes | yes | `standardLimiter` | — | see controller | `insuranceController.comparePlans:744` | `InsurancePlan:COMPARE` (`ic:769`) | **yes** |
| 35 | GET | `/api/v1/insurance/benefits/search` | yes | n/a | `standardLimiter` | — | see controller | `insuranceController.searchBenefits:826` | `InsurancePlan:SEARCH` (`ic:867`) | **yes** |
| 36 | PUT | `/api/v1/insurance/plans/:id/reanalyze` | yes | no (upload exempt) | `uploadLimiter`+`aiLimiter`+`blockDemoAI` | — | see controller | `upload.reanalyzePlan` (`sbcUploadController.ts:224`) | `InsurancePlan:REANALYZE` (`sbc:256,307`) | **yes** |
| 37 | POST | `/api/v1/insurance/upload-sbc` | yes | no (upload exempt) | `uploadLimiter`+`aiLimiter`+`blockDemoAI` | — | see controller | `upload.uploadSBC` (`sbcUploadController.ts:33`) | `InsurancePlan:UPLOAD` (`sbc:53,165`) | **yes** |
| 38 | PUT | `/api/v1/insurance/plans/:id/spending` | yes | yes | `standardLimiter` | — | see controller | `expenseController.updateCurrentSpending:572` | `insurance_plan:UPDATE` (`ec:597`) | none |
| 39 | GET | `/api/v1/expenses/projections` | yes | n/a | `standardLimiter` | — | controller | `expenseController.getProjections:136` | `ExpenseProjection:LIST` (`ec:179`) | **yes** — decrypted costs/notes |
| 40 | POST | `/api/v1/expenses/projections` | yes | yes (explicit) | `standardLimiter` | — | controller | `expenseController.createProjection:82` | `ExpenseProjection:CREATE` (`ec:112`) | **yes** |
| 41 | PUT | `/api/v1/expenses/projections/:id` | yes | yes (explicit) | `standardLimiter` | — | controller | `expenseController.updateProjection:211` | `ExpenseProjection:UPDATE` (`ec:242`) | **yes** |
| 42 | DELETE | `/api/v1/expenses/projections/:id` | yes | yes (explicit) | `standardLimiter` | — | controller | `expenseController.deleteProjection:263` | `ExpenseProjection:DELETE` (`ec:277`) | none |
| 43 | GET | `/api/v1/expenses/actuals` | yes | n/a | `standardLimiter` | — | controller | `expenseController.getActuals:411` | `ExpenseActual:LIST` (`ec:446`) | **yes** |
| 44 | POST | `/api/v1/expenses/actuals` | yes | yes (explicit) | `standardLimiter` | — | controller | `expenseController.createActual:345` | `ExpenseActual:CREATE` (`ec:394`) | **yes** |
| 45 | PUT | `/api/v1/expenses/actuals/:id` | yes | yes (explicit) | `standardLimiter` | — | controller | `expenseController.updateActual:475` | `ExpenseActual:UPDATE` (`ec:527`) | **yes** |
| 46 | DELETE | `/api/v1/expenses/actuals/:id` | yes | yes (explicit) | `standardLimiter` | — | controller | `expenseController.deleteActual:541` | `ExpenseActual:DELETE` (`ec:555`) | none |
| 47 | POST | `/api/v1/expenses/analyze` | yes | yes (explicit) | `aiLimiter`+`blockDemoAI` | — | controller | `expenseController.analyzeCosts:617` | `ExpenseAnalysis:CREATE` (`ec:731`) + `SERVICE_UNAVAILABLE` (`ec:634`) | **yes** |
| 48 | GET | `/api/v1/expenses/analyses` | yes | n/a | `standardLimiter` | — | controller | `expenseController.getAnalyses:759` | `ExpenseAnalysis:LIST` (`ec:793`) | **yes** |
| 49 | GET | `/api/v1/health-needs` | yes | n/a | `standardLimiter` | — | `withRLSContext` | `healthNeedsController.getHealthNeeds:58` | `HealthNeed:LIST` (`hnc:128`) | **yes** — decrypted description |
| 50 | GET | `/api/v1/health-needs/analyze` | yes | n/a | `aiLimiter` | — | `withRLSContext` | `healthNeedsController.analyzeHealthNeeds:386` | `HealthNeed:ANALYSIS` (`hnc:442`) | **yes** |
| 51 | GET | `/api/v1/health-needs/:id` | yes | n/a | `standardLimiter` | — | `withRLSContext` | `healthNeedsController.getHealthNeed:153` | `HealthNeed:READ` (`hnc:175`) | **yes** |
| 52 | POST | `/api/v1/health-needs` | yes | yes | `standardLimiter` | — | `withRLSContext` | `healthNeedsController.createHealthNeed:186` | `HealthNeed:CREATE` (`hnc:216`) | **yes** |
| 53 | PATCH | `/api/v1/health-needs/:id` | yes | yes | `standardLimiter` | — | `withRLSContext` | `healthNeedsController.updateHealthNeedStatus:293` | `HealthNeed:UPDATE` (`hnc:273,331`) | **yes** |
| 54 | DELETE | `/api/v1/health-needs/:id` | yes | yes | `standardLimiter` | — | `withRLSContext` | `healthNeedsController.deleteHealthNeed:346` | `HealthNeed:DELETE` (`hnc:373`) | name only |
| 55 | GET | `/api/v1/health-goals/summary` | yes | n/a | `standardLimiter` | — | `withRLSContext` | `healthGoalsController.getGoalsSummary:684` | `HealthGoal:SUMMARY` (`hgc:750`) | counts |
| 56 | GET | `/api/v1/health-goals/suggestions` | yes | n/a | `aiLimiter` | — | `withRLSContext` | `healthGoalsController.suggestGoals:764` | `HealthGoal:SUGGEST` (`hgc:841`) | **yes** |
| 57 | GET | `/api/v1/health-goals` | yes | n/a | `standardLimiter` | — | `withRLSContext` | `healthGoalsController.getHealthGoals:216` | `HealthGoal:LIST` (`hgc:272`) | **yes** — decrypted description/notes/target |
| 58 | GET | `/api/v1/health-goals/:id` | yes | n/a | `standardLimiter` | — | `withRLSContext` | `healthGoalsController.getHealthGoal:297` | `HealthGoal:READ` (`hgc:324`) | **yes** |
| 59 | POST | `/api/v1/health-goals` | yes | yes | `standardLimiter` | — | `withRLSContext` | `healthGoalsController.createHealthGoal:335` | `HealthGoal:CREATE` (`hgc:431`) | **yes** |
| 60 | PUT | `/api/v1/health-goals/:id` | yes | yes | `standardLimiter` | — | `withRLSContext` | `healthGoalsController.updateHealthGoal:447` | `HealthGoal:UPDATE` (`hgc:513`) | **yes** |
| 61 | PATCH | `/api/v1/health-goals/:id/progress` | yes | yes | `standardLimiter` | — | `withRLSContext` | `healthGoalsController.updateGoalProgress:531` | `HealthGoal:PROGRESS_UPDATE` (`hgc:625`) | **yes** |
| 62 | DELETE | `/api/v1/health-goals/:id` | yes | yes | `standardLimiter` | — | `withRLSContext` | `healthGoalsController.deleteHealthGoal:643` | `HealthGoal:DELETE` (`hgc:670`) | name only |
| 63 | GET | `/api/v1/provider/patients` | yes | n/a | `standardLimiter` | `PROVIDER` or `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `providerRoutes.ts:33` | `provider_patients:LIST` (`pr:94`) | email + createdAt (consent ACTIVE only) |
| 64 | POST | `/api/v1/provider/patients/request` | yes | yes | `standardLimiter` | `PROVIDER` or `ADMIN` | `withRLSContext` (two: admin lookup + providerId write) | inline `providerRoutes.ts:112` | `provider_patient_request:REQUEST_ACCESS` (`pr:141,152,220`) | none |
| 65 | GET | `/api/v1/provider/patients/:patientId` | yes | n/a | `standardLimiter` | `PROVIDER` or `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `providerRoutes.ts:241` | `patient_detail:VIEW_PATIENT` (`pr:297,307,317,348`) | email + createdAt |
| 66 | GET | `/api/v1/provider/patients/:patientId/biomarkers` | yes | n/a | `standardLimiter` | `PROVIDER` or `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `providerRoutes.ts:366` | `patient_biomarkers:PHI_ACCESS` (`pr:425,435,446,455,491`) | **yes** — patient biomarkers decrypted |
| 67 | GET | `/api/v1/provider/patients/:patientId/health-needs` | yes | n/a | `standardLimiter` | `PROVIDER` or `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `providerRoutes.ts:510` | `patient_health_needs:PHI_ACCESS` (`pr:565,575,586,595,622`) | **yes** — patient health needs decrypted |
| 68 | DELETE | `/api/v1/provider/patients/:patientId` | yes | yes | `standardLimiter` | `PROVIDER` or `ADMIN` | `withRLSContext(providerId)` | inline `providerRoutes.ts:641` | `provider_patient_relationship:DELETE` (`pr:672,681,691,701`) | none |
| 69 | GET | `/api/v1/patient/providers` | yes | n/a | `standardLimiter` | `PATIENT` | `withRLSContext(patientId)` + `withRLSContext(null, isAdmin:true)` | inline `patientRoutes.ts:30` | `patient_providers:LIST` (`pt:93`) | provider emails |
| 70 | GET | `/api/v1/patient/providers/pending` | yes | n/a | `standardLimiter` | `PATIENT` | `withRLSContext(patientId)` + admin lookup | inline `patientRoutes.ts:110` | `patient_pending_requests:LIST` (`pt:163`) | provider emails |
| 71 | POST | `/api/v1/patient/providers/:id/approve` | yes | yes | `standardLimiter` | `PATIENT` | `withRLSContext(patientId)` | inline `patientRoutes.ts:181` | `provider_consent:APPROVE` (`pt:216,240`) | none |
| 72 | POST | `/api/v1/patient/providers/:id/deny` | yes | yes | `standardLimiter` | `PATIENT` | `withRLSContext(patientId)` | inline `patientRoutes.ts:275` | `provider_consent:DENY` (`pt:296,306`) | none |
| 73 | PATCH | `/api/v1/patient/providers/:id` | yes | yes | `standardLimiter` | `PATIENT` | `withRLSContext(patientId)` | inline `patientRoutes.ts:332` | `provider_consent_permissions:UPDATE` (`pt:355,369,398`) | none |
| 74 | POST | `/api/v1/patient/providers/:id/revoke` | yes | yes | `standardLimiter` | `PATIENT` | `withRLSContext(patientId)` | inline `patientRoutes.ts:425` | `provider_consent:REVOKE` (`pt:446,455`) | none |
| 75 | DELETE | `/api/v1/patient/providers/:id` | yes | yes | `standardLimiter` | `PATIENT` | `withRLSContext(patientId)` | inline `patientRoutes.ts:490` | `provider_consent:DELETE` (`pt:510,519`) | none |
| 76 | GET | `/api/v1/admin/users` | yes | n/a | `standardLimiter` | `ADMIN` + `blockDemoAdminAccess` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:41` | `admin_user_list:LIST` (`ar:95`) | user emails, counts |
| 77 | GET | `/api/v1/admin/users/:id` | yes | n/a | `standardLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:130` | `admin_user_detail:VIEW` (`ar:170,181`) | email/role |
| 78 | POST | `/api/v1/admin/users` | yes | yes | `standardLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:201` | `admin_user:CREATE` (`ar:243`) | email |
| 79 | PATCH | `/api/v1/admin/users/:id` | yes | yes | `standardLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:267` | `admin_user:UPDATE` / `PERMISSION_CHANGE` (`ar:322,337`) | email/role |
| 80 | DELETE | `/api/v1/admin/users/:id` | yes | yes | `standardLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:367` | `admin_user_status:DEACTIVATE` (`ar:378,398,408`) | email |
| 81 | DELETE | `/api/v1/admin/users/:id/permanent` | yes | yes | `sensitiveLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:450` | `admin_user_permanent:PERMANENT_DELETE` (`ar:465,482,493,503`) | email |
| 82 | PATCH | `/api/v1/admin/users/:id/plan` | yes | yes | `standardLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:548` | `admin_user_plan:PLAN_CHANGE` (`ar:592,604`) | email |
| 83 | GET | `/api/v1/admin/provider-relationships` | yes | n/a | `standardLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:637` | `admin_provider_relationship:LIST` (`ar:657`) | relationship rows |
| 84 | PATCH | `/api/v1/admin/provider-relationships/:id` | yes | yes | `standardLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:677` | `admin_provider_relationship:UPDATE` (`ar:713,724`) | relationship |
| 85 | GET | `/api/v1/admin/stats` | yes | n/a | `standardLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:762` | `admin_system_stats:VIEW` (`ar:832`) | counts |
| 86 | GET | `/api/v1/admin/audit-logs` | yes | n/a | `standardLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | inline `adminRoutes.ts:855` | `admin_audit_logs:VIEW` (`ar:900`) | audit rows |
| 87 | POST | `/api/v1/upload/lab-report` | yes | no (upload exempt) | `uploadLimiter`+`aiLimiter`+`blockDemoAI` | — | controller | `upload.uploadLabReport` (`labUploadController.ts:36`) | `lab_report_upload:UPLOAD` (`lu:55,141`) | **yes** — extracted biomarkers |
| 88 | POST | `/api/v1/upload/insurance-sbc` | yes | no (upload exempt) | `uploadLimiter`+`aiLimiter`+`blockDemoAI` | — | controller | `upload.uploadSBC` (`sbcUploadController.ts:33`) | `InsurancePlan:UPLOAD` (`sbc:53,165`) | **yes** |
| 89 | POST | `/api/v1/upload/lab-results-ocr` | yes | no (upload exempt) | `uploadLimiter`+`aiLimiter`+`blockDemoAI` | — | controller | `upload.uploadLabResultOCR` (`labUploadController.ts:191`) | `lab_ocr_upload:UPLOAD` (`lu:213,305`) | **yes** |
| 90 | GET | `/api/v1/files` | yes | n/a | `standardLimiter` | — | `withRLSTransaction` | `fileController.getFiles:43` | `UserFile:LIST` (`fc:101`) | filename/lab metadata |
| 91 | GET | `/api/v1/files/:id` | yes | n/a | `standardLimiter` | — | `withRLSTransaction` | `fileController.getFile:126` | `UserFile:READ` (`fc:187`) | filename + signed URL (15 min) |
| 92 | GET | `/api/v1/files/:id/download` | yes | n/a | `sensitiveLimiter` | — | `withRLSTransaction` | `fileController.getFileDownloadUrl:211` | `UserFile:EXPORT FILE_DOWNLOAD` (`fc:242`) | **yes** — raw file bytes streamed |
| 93 | DELETE | `/api/v1/files/:id` | yes | yes | `standardLimiter` | — | `withRLSTransaction` (×2) | `fileController.deleteFile:299` | `UserFile:DELETE` (`fc:322`) | filename only |
| 94 | GET | `/api/v1/settings/profile` | yes | n/a | `sensitiveLimiter` | — | controller | `settingsController.getProfile:911` | `User:READ` (`sc:946`) | **yes** — decrypted first/last name |
| 95 | PATCH | `/api/v1/settings/profile` | yes | yes | `sensitiveLimiter`+`blockDemoProfileUpdate` | — | controller | `settingsController.updateProfile:969` | `User:UPDATE` (`sc:1014`) | **yes** |
| 96 | GET | `/api/v1/settings/notifications` | yes | n/a | `sensitiveLimiter` | — | controller | `settingsController.getNotifications:1041` | none (non-PHI prefs) | none |
| 97 | PATCH | `/api/v1/settings/notifications` | yes | yes | `sensitiveLimiter`+`blockDemoProfileUpdate` | — | controller | `settingsController.updateNotifications:1073` | `User:UPDATE` (`sc:1128`) | none |
| 98 | GET | `/api/v1/settings/health-profile` | yes | n/a | `sensitiveLimiter` | — | controller | `settingsController.getHealthProfile:1149` | `UserHealthProfile:READ` (`sc:1159`) | **yes** |
| 99 | PATCH | `/api/v1/settings/health-profile` | yes | yes | `sensitiveLimiter`+`blockDemoProfileUpdate`+`requirePlanFeature('healthProfile')` | — | controller | `settingsController.updateHealthProfile:1179` | `UserHealthProfile:UPDATE` (`sc:1205`) | **yes** |
| 100 | GET | `/api/v1/settings/export-data` | yes | n/a | `sensitiveLimiter` | — | controller | `settingsController.exportUserData:306` | `UserData:EXPORT` (`sc:638`) | **yes** — full user PHI JSON |
| 101 | DELETE | `/api/v1/settings/delete-data` | yes | yes | `sensitiveLimiter` | — | controller | `settingsController.deleteAllData:675` | `UserData:DELETE` (`sc:792`) | counts |
| 102 | DELETE | `/api/v1/settings/delete-account` | yes | yes | `sensitiveLimiter` | — | controller | `settingsController.deleteAccount:816` | `User:DELETE` (`sc:849`) | none |
| 103 | POST | `/api/v1/ai/chat` | yes (**Bearer only**) | no (exempt) | `aiLimiter`+`blockDemoAI`+`requirePlanLimit('aiChatsPerDay')` | — | `assembleHealthContext` uses RLS internally | `aiChatController.handleAIChat:123` | `HealthGuide:CHAT` / `CHAT_BLOCKED_NO_BAA` (`aic:135,262,291`) | **yes** — health context sent to Anthropic; SSE stream back |
| 104 | GET | `/api/v1/fhir/callback` | public | n/a | `standardLimiter` | — | none | `fhirController.handleCallback:76` | none | none |
| 105 | GET | `/api/v1/fhir/connect/quest` | yes | n/a | `sensitiveLimiter`+`blockDemoAI` | — | none | `fhirController.initiateQuestConnect:38` | none | redirect URL |
| 106 | GET | `/api/v1/fhir/connections` | yes | n/a | `standardLimiter` | — | `withRLSContext(userId)` | `fhirController.listConnections:113` | none | connection metadata |
| 107 | POST | `/api/v1/fhir/sync/:connectionId` | yes | yes | `sensitiveLimiter`+`blockDemoAI` | — | `withRLSContext(userId)` | `fhirController.triggerSync:145` | none | sync summary |
| 108 | DELETE | `/api/v1/fhir/connections/:id` | yes | yes | `sensitiveLimiter`+`blockDemoAI` | — | delegated to `disconnectConnection` | `fhirController.deleteConnection:183` | none | 204 |
| — | GET | `/api/v1/plan/available` | public | n/a | `standardLimiter` | — | none | inline `planRoutes.ts:32` | none | none |
| — | GET | `/api/v1/plan` | yes | n/a | `standardLimiter` | — | `withRLSContext(userId)` | inline `planRoutes.ts:52` | none | plan + usage |
| — | GET | `/api/v1/onboarding/status` | yes | n/a | `standardLimiter` | — | service-side RLS | inline `onboardingRoutes.ts:22` | none | completion flags |
| — | POST | `/api/v1/onboarding/complete` | yes | yes | `standardLimiter` | — | service-side RLS | inline `onboardingRoutes.ts:32` | none | timestamp |

Row totals: the 108 numbered rows cover the authenticated API; the trailing 4 (`plan`, `plan/available`, `onboarding/status`, `onboarding/complete`) bring the grand total to **112** (matches `router.*` grep count across `backend/src/routes/**` + inline `app.ts` handlers). The prompt-stated 108 counts the 16 route files + 2 in `routes/index.ts` + 6 in `app.ts`; the extras here reconcile the `/plan` and `/onboarding` routers that the prompt omitted but are live in production.

---

## Root + health endpoints

### `GET /`

1. **Route**: `backend/src/app.ts:261`
2. **Middleware**: helmet, CORS, cookieParser, compression, csrfProtection, `standardLimiter`, morgan, body parsers, `requireJsonContentType`.
3. **Controller**: inline (`app.ts:261-271`).
4. **RLS wrap**: none.
5. **Request (Zod)**: no Zod.
6. **Response (200)**: `{ success: true, data: { name: 'OwnMyHealth API', version: 'v1', environment: 'production'|..., documentation: '/api/v1' } }`.
7. **Errors**: `RATE_LIMIT_EXCEEDED` (429) if global limiter exceeded.
8. **Curl**:
    ```bash
    curl -s https://api.ownmyhealth.io/
    ```
9. **Audit log**: none.
10. **PHI exposure**: none.

### `GET /health`

1. **Route**: `backend/src/app.ts:275`
2. **Middleware**: global stack (no auth).
3. **Controller**: inline (`app.ts:275-286`). Calls `checkDatabaseHealth()` from `services/database.ts`.
4. **RLS wrap**: none (admin introspection).
5. **Request**: no Zod.
6. **Response (200|503)**:
    ```json
    { "status": "healthy", "timestamp": "2026-04-24T...", "checks": { "database": "connected" } }
    ```
7. **Errors**: 503 `unhealthy` when DB is down (body shape unchanged).
8. **Curl**: `curl https://api.ownmyhealth.io/health`
9. **Audit**: none.
10. **PHI**: none.

### `GET /api/health/db`

1. **Route**: `backend/src/app.ts:292`
2. **Middleware**: `standardLimiter` (explicit), no auth.
3. **Controller**: inline.
4. **RLS wrap**: none.
5. **Zod**: none.
6. **Response**: `{ success, data: { connected, latency?, error? } }`.
7. **Errors**: 503 when `connected=false`.
8. **Curl**: `curl https://api.ownmyhealth.io/api/health/db`
9. **Audit**: none.
10. **PHI**: none.

### `GET /api/v1/health` and `GET /api/v1/`

Defined at `backend/src/routes/index.ts:42` and `:54`. Return `{ success, data: { status: 'healthy', timestamp } }` and `{ version, endpoints: [...] }` respectively. No auth; no PHI; no audit.

### `GET /api/v1/csrf-token`

1. **Route**: `backend/src/app.ts:258`
2. **Middleware**: global stack.
3. **Controller**: `csrfTokenHandler` at `backend/src/middleware/csrf.ts:210-219`.
4. **RLS**: none.
5. **Zod**: none.
6. **Response**: `{ success: true, data: { csrfToken: '<64-hex>' } }` plus `Set-Cookie: csrf_token=...`.
7. **Errors**: none beyond global limiter.
8. **Curl**: `curl -c cookies.txt https://api.ownmyhealth.io/api/v1/csrf-token`
9. **Audit**: none.
10. **PHI**: none.

---

## Auth — `authRoutes.ts`

Router-level middleware: `router.use(authLimiter)` at `authRoutes.ts:32`. All 12 endpoints inherit it. **Every `/auth/*` route also adds the global `standardLimiter` (app.ts:216).**

### `POST /api/v1/auth/register`

1. **Route**: `backend/src/routes/authRoutes.ts:39`
2. **Middleware**: `authLimiter`, `validate(schemas.auth.register)`, `asyncHandler(register)` — CSRF is exempt via public-auth list (`csrf.ts:98-108`).
3. **Controller**: `authController.register` (`backend/src/controllers/authController.ts:146`).
4. **RLS wrap**: none (user-creation service uses admin client).
5. **Request (Zod)**:
    ```ts
    // Source: backend/src/middleware/validation.ts:L254-L259
    register: z.object({
      email: email,
      password: strongPassword,
      firstName: optionalSanitizedString(100),
      lastName: optionalSanitizedString(100),
    }),
    ```
6. **Response (201)**:
    ```json
    { "success": true, "data": { "user": { "id": "...", "email": "...", "role": "PATIENT" },
       "message": "Registration successful. Please check your email to verify your account." } }
    ```
7. **Errors**:
    | HTTP | code | Origin | When |
    |---|---|---|---|
    | 400 | `BAD_REQUEST` | `authController.ts:154-171` | Missing fields, email exists, weak password |
    | 422 | `VALIDATION_ERROR` | `validation.ts:172` | Zod parse failure |
    | 429 | `AUTH_RATE_LIMIT_EXCEEDED` | `rateLimiter.ts:41` | 20/15min exceeded |
8. **Curl**:
    ```bash
    curl -X POST https://api.ownmyhealth.io/api/v1/auth/register \
      -H "Content-Type: application/json" \
      -d '{"email":"user@example.com","password":"Abcd1234!Very"}'
    ```
9. **Audit**: `auditService.logAuth('REGISTER', ...)` (`authController.ts:187`).
10. **PHI**: `firstName`/`lastName` get encrypted at rest; response does not echo them.

### `POST /api/v1/auth/login`

1. **Route**: `authRoutes.ts:47`
2. **Middleware**: `authLimiter`, `strictAuthLimiter`, `validate(schemas.auth.login)`, `asyncHandler(login)`. CSRF exempt.
3. **Controller**: `authController.login` (`authController.ts:210`).
4. **RLS**: none (authService uses admin client for auth lookup).
5. **Zod**:
    ```ts
    // Source: backend/src/middleware/validation.ts:L249-L252
    login: z.object({
      email: email,
      password: z.string().min(1, 'Password is required').max(128),
    }),
    ```
6. **Response (200)**:
    ```json
    { "success": true, "data": { "user": { "id": "...", "email": "...", "role": "PATIENT" } } }
    ```
    Side-effects: `Set-Cookie: access_token; refresh_token; csrf_token`.
7. **Errors**:
    | HTTP | code | Origin | When |
    |---|---|---|---|
    | 401 | `INVALID_CREDENTIALS` | `ac:279` | Bad email/password |
    | 401 | `UNAUTHORIZED` | `ac:296` | Unknown auth failure |
    | 403 | `EMAIL_NOT_VERIFIED` | `ac:237` | Email not verified yet |
    | 423 | `ACCOUNT_LOCKED` | `ac:256` | 5+ failed attempts |
    | 422 | `VALIDATION_ERROR` | `validation.ts:172` | Zod |
    | 429 | `AUTH_RATE_LIMIT_EXCEEDED` / `LOGIN_RATE_LIMIT_EXCEEDED` | `rateLimiter.ts:41,56` | Either limiter |
8. **Curl**:
    ```bash
    curl -X POST https://api.ownmyhealth.io/api/v1/auth/login \
      -H "Content-Type: application/json" -c cookies.txt \
      -d '{"email":"user@example.com","password":"Abcd1234!Very"}'
    ```
9. **Audit**: `LOGIN` / `LOGIN_FAILED` / `ACCOUNT_LOCKOUT` at `ac:229, 248, 270, 291, 312`.
10. **PHI**: email only (not PHI-classified).

### `POST /api/v1/auth/refresh`

1. **Route**: `authRoutes.ts:54`
2. **Middleware**: `authLimiter`, `asyncHandler(refreshToken)`. CSRF exempt.
3. **Controller**: `authController.refreshToken` (`authController.ts:330`).
4. **RLS**: none.
5. **Zod**: none — reads `req.cookies.refresh_token` directly.
6. **Response (200)**: `{ success: true, data: { token: '<new access JWT>' } }`; cookies rotated.
7. **Errors**:
    | HTTP | code | Origin | When |
    |---|---|---|---|
    | 401 | `UNAUTHORIZED` | `ac:338, 348` | Missing or invalid refresh token |
8. **Curl**:
    ```bash
    curl -X POST https://api.ownmyhealth.io/api/v1/auth/refresh -b cookies.txt -c cookies.txt
    ```
9. **Audit**: none (rotation is routine).
10. **PHI**: none.

### `POST /api/v1/auth/demo`

1. **Route**: `authRoutes.ts:57`
2. **Middleware**: `authLimiter`, `asyncHandler(demoLogin)`.
3. **Controller**: `authController.demoLogin` (`authController.ts:547`).
4. **RLS**: none.
5. **Zod**: none.
6. **Response (200)**: same shape as login; extended cookie lifetime.
7. **Errors**: 400 `BAD_REQUEST` if `config.demo.enabled=false` (`ac:553`) or user missing (`ac:562`).
8. **Curl**: `curl -X POST https://api.ownmyhealth.io/api/v1/auth/demo -c cookies.txt`
9. **Audit**: none.
10. **PHI**: none.

### `GET /api/v1/auth/verify-email?token=...`

1. **Route**: `authRoutes.ts:61`
2. **Middleware**: `authLimiter`, `validate(schemas.auth.verifyEmailQuery, 'query')`, `asyncHandler(verifyEmail)`.
3. **Controller**: `authController.verifyEmail` (`authController.ts:594`).
4. **RLS**: none.
5. **Zod**: `{ token: z.string().min(1) }` (`validation.ts:279-281`).
6. **Response (200)**: `{ success: true, data: { message: '...' } }`.
7. **Errors**: 400 `VERIFICATION_FAILED` (`ac:618`); 422 `VALIDATION_ERROR`.
8. **Curl**: `curl "https://api.ownmyhealth.io/api/v1/auth/verify-email?token=<t>"`
9. **Audit**: `EMAIL_VERIFICATION` (`ac:610, 627`).
10. **PHI**: none.

### `POST /api/v1/auth/resend-verification`

1. **Route**: `authRoutes.ts:69`
2. **Middleware**: `authLimiter`, `strictAuthLimiter`, `validate(schemas.auth.resendVerification)`.
3. **Controller**: `authController.resendVerification` (`authController.ts:648`).
4. **RLS**: none. 5. **Zod**: `{ email }`.
6. **Response (200)**: `{ success: true, data: { message: '...' } }`.
7. **Errors**: 400 `RESEND_FAILED` (`ac:664`); 422 `VALIDATION_ERROR`; 429 `LOGIN_RATE_LIMIT_EXCEEDED`.
8. **Curl**: `curl -X POST https://api.ownmyhealth.io/api/v1/auth/resend-verification -H 'Content-Type: application/json' -d '{"email":"u@x.com"}'`
9. **Audit**: none.
10. **PHI**: none.

### `POST /api/v1/auth/forgot-password`

Route `authRoutes.ts:77`. Middleware: `authLimiter`, `strictAuthLimiter`, `validate(schemas.auth.forgotPassword)`. Controller `authController.forgotPassword:692`. RLS: none. Zod: `{ email }`. Response: `{ success, data: { message } }`. Errors: 400 `BAD_REQUEST`; 422; 429. Audit: `PASSWORD_RESET_REQUEST` (`ac:706`). PHI: none.

```bash
curl -X POST https://api.ownmyhealth.io/api/v1/auth/forgot-password \
  -H 'Content-Type: application/json' -d '{"email":"u@x.com"}'
```

### `POST /api/v1/auth/reset-password`

Route `authRoutes.ts:85`. Middleware: `authLimiter`, `strictAuthLimiter`, `validate(schemas.auth.resetPassword)`. Controller `authController.resetPasswordHandler:731`. Zod: `{ token: z.string().min(1), newPassword: strongPassword }`. Response: `{ success, data: { message } }`. Errors: 400 `RESET_FAILED` (`ac:759`); 422; 429. Audit: `PASSWORD_RESET_COMPLETE` (`ac:751, 768`). PHI: none.

### `POST /api/v1/auth/logout`

Route `authRoutes.ts:97`. Middleware: `authLimiter`, `authenticate`, `asyncHandler(logout)` — CSRF **required** (not exempt). Controller `authController.logout:374`. RLS: none. Zod: none. Response: `{ success: true }`. Errors: 401 `UNAUTHORIZED`; 403 `FORBIDDEN` (CSRF). Audit: `LOGOUT` (`ac:403`). PHI: none.

### `POST /api/v1/auth/logout-all`

Route `authRoutes.ts:100`. Same shape as `/logout` but revokes **all** refresh tokens (`revokeAllUserTokens`). Controller `authController.logoutAll:418`. Audit: `LOGOUT` with `authAction=LOGOUT_ALL_DEVICES` (`ac:436`).

### `GET /api/v1/auth/me`

Route `authRoutes.ts:103`. Middleware: `authLimiter`, `authenticate`. Controller `authController.getCurrentUser:452`. RLS: none (uses `findUserById`). Zod: none. Response: `{ success, data: { id, email, role } }`. Errors: 401 `UNAUTHORIZED`. Audit: none. PHI: none.

### `POST /api/v1/auth/change-password`

Route `authRoutes.ts:106`. Middleware: `authLimiter`, `authenticate`, `validate(schemas.auth.changePassword)`, CSRF required. Controller `authController.changePassword:479`. Zod: `{ currentPassword, newPassword: strongPassword }`. Response: `{ success: true }`. Errors: 400 `BAD_REQUEST` (weak pw), 401 `UNAUTHORIZED` (wrong current pw). Audit: `PASSWORD_CHANGE` (`ac:529`). PHI: none.

---

## Biomarkers — `biomarkerRoutes.ts`

Router-level `router.use(authenticate)` at `biomarkerRoutes.ts:45`.

### `GET /api/v1/biomarkers`

1. **Route**: `biomarkerRoutes.ts:48`
2. **Middleware**: `authenticate`, `standardLimiter` (global), `validate(schemas.biomarker.listQuery, 'query')`, `asyncHandler(getBiomarkers)`.
3. **Controller**: `biomarkerController.getBiomarkers` (`biomarkerController.ts:111`).
4. **RLS wrap**: `withRLSTransaction(userId, async tx => { tx.biomarker.count + findMany })` at `biomarkerController.ts:137-147`.
5. **Zod**: `listQuery` at `validation.ts:340-344` — `{ category?, page?, limit? }`.
6. **Response (200)**:
    ```json
    { "success": true,
      "data": [ { "id","userId","category","name","unit","value":5.4,
        "notes?","normalRange":{"min","max","source?"},"date","sourceType",
        "labName?","isOutOfRange","isAcknowledged","history":[],"createdAt","updatedAt" } ],
      "pagination": { "page", "limit", "total", "totalPages" } }
    ```
7. **Errors**: 401 `UNAUTHORIZED`; 422 `VALIDATION_ERROR`; 429.
8. **Curl**:
    ```bash
    curl https://api.ownmyhealth.io/api/v1/biomarkers \
      -b cookies.txt -H "X-CSRF-Token: $(jq -r .csrf_token cookies.txt)" 
    ```
9. **Audit**: `auditService.logAccess('Biomarker', undefined, { req, userId }, { operation: 'LIST', ... })` at `biomarkerController.ts:160`.
10. **PHI**: `valueEncrypted`, `unitEncrypted`, `notesEncrypted` decrypted per-user (`PBKDF2-SHA512` salt) → see [`PHI_TAXONOMY.md#biomarker`](./PHI_TAXONOMY.md).

### `GET /api/v1/biomarkers/summary`

1. **Route**: `biomarkerRoutes.ts:55`
2. **Middleware**: `authenticate`, `standardLimiter`, `asyncHandler`.
3. **Controller**: `biomarkerController.getSummary:657`.
4. **RLS**: `withRLSTransaction(userId)` at `bc:666`.
5. **Zod**: none.
6. **Response**: `{ success, data: { totalBiomarkers, inRangeCount, outOfRangeCount, acknowledgedCount, byCategory: [{category,total,inRange,outOfRange}], recentlyUpdated, lastUpdatedAt? } }`.
7. **Errors**: 401; 429.
8. **Curl**: `curl https://api.ownmyhealth.io/api/v1/biomarkers/summary -b cookies.txt`
9. **Audit**: `Biomarker:SUMMARY` (`bc:715`).
10. **PHI**: none (aggregate counts only; no decryption).

### `GET /api/v1/biomarkers/categories`

Route `biomarkerRoutes.ts:61`. Middleware `authenticate`. Controller `getCategories:422`. RLS: `withRLSTransaction` (`bc:430`). Zod: none. Response: `{ success, data: ["Lipids", "Vitamins", ...] }`. Errors: 401, 429. Audit: `Biomarker:CATEGORIES` (`bc:442`). PHI: none.

### `GET /api/v1/biomarkers/:id`

Route `biomarkerRoutes.ts:67`. Middleware `authenticate`, `validate(uuidParam, 'params')`. Controller `getBiomarker:192`. RLS: `withRLSTransaction(userId)` (`bc:202`) with `{id, userId}` where-clause. Zod: `{id: uuid}`. Response: `{ success, data: <BiomarkerResponse> }`. Errors: 401, 404 `NOT_FOUND` (`bc:210`), 422, 429. Audit: `Biomarker:READ` (`bc:215`). PHI: yes — decrypted.

### `GET /api/v1/biomarkers/:id/history`

Route `biomarkerRoutes.ts:74`. Middleware same. Controller `getHistory:747`. RLS: `withRLSTransaction` (`bc:769`). Query: `startDate?`, `endDate?`, `limit?` (max 1000). Response: `{ success, data: { biomarkerId, name, category, unit, normalRange, currentValue, history: [{date, value, isOutOfRange}] } }`. Errors: 401, 404 (`bc:788`), 422, 429. Audit: `Biomarker:HISTORY` (`bc:819`). PHI: yes.

### `POST /api/v1/biomarkers`

Route `biomarkerRoutes.ts:82`. Middleware: `authenticate`, `csrfProtection` (global), `validate(schemas.biomarker.create)`. Controller `createBiomarker:226`. RLS: `withRLSTransaction(userId)` (`bc:247`). Zod: full `biomarker.create` at `validation.ts:288-304`. Response 201: `<BiomarkerResponse>` (decrypted echo). Errors: 400, 401, 403 (CSRF), 422, 429. Audit: `Biomarker:CREATE` (`bc:273`). PHI: value/notes encrypted before persist; decrypted in response.

### `POST /api/v1/biomarkers/batch`

Route `biomarkerRoutes.ts:89`. Middleware: `authenticate`, `bulkOperationLimiter` (30/hr), CSRF, `validate(schemas.biomarker.batchCreate)`. Controller `bulkCreateBiomarkers:458`. RLS: `withRLSTransaction` for createMany + findMany (`bc:539-555`). Zod: `{ biomarkers: array(1..100) }`. Response: 201 (all succeeded) or **207 Multi-Status** (partial) with `meta.failedItems` (`bc:601-614`); 400 `VALIDATION_ERROR` if none valid (`bc:520`); 500 `DATABASE_ERROR` on createMany failure (`bc:571`). Errors: 401, 403, 422, 429 `BULK_RATE_LIMIT_EXCEEDED`. Audit: `Biomarker:CREATE[BULK]` (`bc:593`). PHI: bulk encrypted.

### `PATCH /api/v1/biomarkers/:id`

Route `biomarkerRoutes.ts:97`. Middleware: `authenticate`, `validate(uuidParam, 'params')`, `validate(schemas.biomarker.update)`, CSRF. Controller `updateBiomarker:288`. RLS: `withRLSTransaction(userId)` (`bc:300`). Zod: `biomarker.update` at `validation.ts:306-320`. Response: `<BiomarkerResponse>`. Errors: 401, 404 (`bc:307`), 422, 429. Audit: `Biomarker:UPDATE` (`bc:363`) — snapshots prev + new values. PHI: yes.

### `DELETE /api/v1/biomarkers/:id`

Route `biomarkerRoutes.ts:105`. Middleware: `authenticate`, `validate(uuidParam, 'params')`, CSRF. Controller `deleteBiomarker:381`. RLS: `withRLSTransaction(userId)` (`bc:390`). Response: `{ success: true }`. Errors: 401, 404, 422, 429. Audit: `Biomarker:DELETE` (`bc:409`). PHI: name/category only in audit.

### `POST /api/v1/biomarkers/:id/guidance`

1. **Route**: `biomarkerRoutes.ts:118`.
2. **Middleware (in order)**: `authenticate` (router-level), `aiLimiter`, `blockDemoAI`, `requirePlanLimit('aiGuidancePerDay')`, `validate(schemas.uuidParam, 'params')`, CSRF (global).
3. **Controller**: inline arrow function at `biomarkerRoutes.ts:124-301`.
4. **RLS**: `withRLSTransaction(userId, async tx => { biomarker.findFirst + biomarkerHistory.findMany })` at `br:157-168`.
5. **Zod (params)**: `{ id: uuid }`. Request body: none.
6. **Response (200)**: `{ success: true, data: { guidance: '<LLM text>' } }`.
7. **Errors**:
    | HTTP | code | Origin | When |
    |---|---|---|---|
    | 401 | `UNAUTHORIZED` | `auth.ts:79` | Missing token |
    | 403 | `FORBIDDEN` | `demoProtection.ts:170` | Demo account blocked |
    | 403 | `PLAN_LIMIT_EXCEEDED` | `planGating.ts:88` | Daily AI guidance quota |
    | 404 | `NOT_FOUND` | `br:174` | Biomarker missing |
    | 422 | `VALIDATION_ERROR` | `validation.ts:172` | Bad UUID |
    | 429 | `AI_RATE_LIMIT_EXCEEDED` | `rateLimiter.ts:108` | 10/hour/user |
    | 502 | `Failed to get AI guidance` | `br:246` | Anthropic API non-OK |
    | 503 | `SERVICE_UNAVAILABLE` | `br:144` | BAA gate closed |
    | 504 | `AbortError` | `br:287` | 30s timeout |
8. **Curl**:
    ```bash
    curl -X POST "https://api.ownmyhealth.io/api/v1/biomarkers/$ID/guidance" \
      -b cookies.txt -H "X-CSRF-Token: <t>" -H "Content-Type: application/json"
    ```
9. **Audit**: `biomarker_ai_guidance:PHI_ACCESS` with `externalApiCall: true`, `provider: 'anthropic'`, `phiDisclosedFields: ['name','value','unit','normalRange','status','history']` (`br:271-278`).
10. **PHI**: biomarker value + unit + 3-entry history sent to Anthropic; response text scrubbed with `stripPHIFromText` (`br:257`).

---

## Insurance — `insuranceRoutes.ts`

Router-level `router.use(authenticate)` at `insuranceRoutes.ts:62`.

### `GET /api/v1/insurance/plans` — list all
Route `insuranceRoutes.ts:65`. Middleware: `authenticate`. Controller `getInsurancePlans:412`. RLS: via controller (uses prisma with userId filter; see controller). Zod: none. Response: `{ success, data: [{id, planName, insurerName, planType, effectiveDate, deductible, oopMax, copays, benefits, isActive, isPrimary, ...}] }`. Errors: 401, 429. Audit: `InsurancePlan:LIST` (`ic:450`). PHI: yes — decrypted memberId/groupId/planName/insurerName.

### `GET /api/v1/insurance/plans/:id`
Route `insuranceRoutes.ts:72`. Middleware: `authenticate`, `validate(uuidParam, 'params')`. Controller `getInsurancePlan:466`. Response: `<InsurancePlanResponse>`. Errors: 401, 404, 422, 429. Audit: `InsurancePlan:READ` (`ic:489`). PHI: yes.

### `POST /api/v1/insurance/plans`
Route `insuranceRoutes.ts:79`. Middleware: `authenticate`, CSRF, `validate(schemas.insurancePlan.create)`. Controller `createInsurancePlan:500`. Zod: `insurancePlan.create` (`validation.ts:368-413`). Response 201: created plan. Errors: 401, 403, 422, 429. Audit: `InsurancePlan:CREATE` (`ic:585`). PHI: yes.

### `PATCH /api/v1/insurance/plans/:id`
Route `insuranceRoutes.ts:86`. Middleware: `authenticate`, uuid + body validate, CSRF. Controller `updateInsurancePlan:600`. Zod: `insurancePlan.update`. Response: updated plan. Errors: 401, 404, 422. Audit: `InsurancePlan:UPDATE` (`ic:685`). PHI: yes.

### `DELETE /api/v1/insurance/plans/:id`
Route `insuranceRoutes.ts:94`. Middleware: auth, uuid validate, CSRF. Controller `deleteInsurancePlan:703`. Response: `{ success: true }`. Errors: 401, 404. Audit: `InsurancePlan:DELETE` (`ic:731`). PHI: name only in audit.

### `POST /api/v1/insurance/compare`
Route `insuranceRoutes.ts:101`. Middleware: auth, CSRF, `validate(compareSchema)`. Controller `comparePlans:744`.

Zod (inline, `insuranceRoutes.ts:52-54`):
```ts
const compareSchema = z.object({
  planIds: z.array(z.string().uuid()).min(2).max(5),
});
```
Response: `{ success, data: { plans: [...], comparison: {...} } }`. Errors: 401, 422, 429. Audit: `InsurancePlan:COMPARE` (`ic:769`). PHI: yes.

### `GET /api/v1/insurance/benefits/search`
Route `insuranceRoutes.ts:107`. Middleware: auth, `validate(benefitSearchSchema, 'query')`. Zod (inline `insuranceRoutes.ts:56-58`): `{ query: z.string().min(1).max(200), planId?: uuid }`. Controller `searchBenefits:826`. Response: `{ success, data: [{planId, benefit...}] }`. Errors: 401, 422. Audit: `InsurancePlan:SEARCH` (`ic:867`). PHI: yes.

### `PUT /api/v1/insurance/plans/:id/reanalyze`
Route `insuranceRoutes.ts:115`. Middleware: auth, uuid validate, `blockDemoAI`, `uploadLimiter`, `aiLimiter`, `multer.single('file')` (10MB PDF only). CSRF exempt via upload list. Controller `sbcUploadController.reanalyzePlan:224`. No Zod on body — multipart. Response: `{ success, data: updatedPlan }`. Errors: 401, 400 (bad PDF), 403 (demo), 413 (> 10MB), 422, 429 (`UPLOAD_RATE_LIMIT_EXCEEDED` / `AI_RATE_LIMIT_EXCEEDED`), 502/503 Anthropic. Audit: `InsurancePlan:REANALYZE` (`sbc:256, 307`). PHI: yes.

```bash
curl -X PUT https://api.ownmyhealth.io/api/v1/insurance/plans/$ID/reanalyze \
  -b cookies.txt -F "file=@sbc.pdf"
```

### `POST /api/v1/insurance/upload-sbc`
Route `insuranceRoutes.ts:127`. Middleware: auth, `blockDemoAI`, `uploadLimiter`, `aiLimiter`, `multer`. CSRF exempt. Controller `sbcUploadController.uploadSBC:33`. Response 201: `{ success, data: { plan: createdPlan, extractionConfidence } }`. Errors: 400 (bad PDF, no file), 401, 403 (demo), 422, 429, 502/503. Audit: `InsurancePlan:UPLOAD` (`sbc:53, 165`). PHI: yes.

### `PUT /api/v1/insurance/plans/:id/spending`
Route `insuranceRoutes.ts:138`. Middleware: auth, uuid validate, CSRF. Controller `expenseController.updateCurrentSpending:572`. Zod: none on body (controller parses numerics). Response: `{ success, data: updatedPlan }`. Errors: 401, 404, 422. Audit: `insurance_plan:UPDATE` (`ec:597`). PHI: none (tracking fields are Decimal/int, not encrypted).

---

## Expenses — `expenseRoutes.ts`

Router-level `router.use(authenticate)` at `expenseRoutes.ts:30`. Each mutating route has **explicit** `csrfProtection` middleware (redundant with global but load-bearing when the global is disabled).

### `GET /api/v1/expenses/projections`
Route `expenseRoutes.ts:37`. Middleware: auth, `validate(schemas.expense.projectionsQuery, 'query')`. Controller `getProjections:136`. Zod `validation.ts:584-588`. Response: `{ success, data: [{id, planId, serviceType, estimatedCost, frequencyPerYear, isInNetwork, notes, ...}], pagination }`. Errors: 401, 422, 429. Audit: `ExpenseProjection:LIST` (`ec:179`). PHI: yes — decrypted cost/notes.

### `POST /api/v1/expenses/projections`
Route `expenseRoutes.ts:45`. Middleware: auth, CSRF, `validate(schemas.expense.createProjection)`. Controller `createProjection:82`. Zod `validation.ts:563-570` — `{ planId, serviceType, estimatedCost, frequencyPerYear, isInNetwork?, notes? }`. Response 201: created projection. Errors: 401, 403 (CSRF), 404 (plan missing), 422, 429. Audit: `ExpenseProjection:CREATE` (`ec:112`). PHI: yes.

### `PUT /api/v1/expenses/projections/:id`
Route `expenseRoutes.ts:53`. Middleware: auth, CSRF, uuid, update body validate. Controller `updateProjection:211`. Zod `validation.ts:572-578`. Response: updated projection. Errors: 401, 404, 422. Audit: `ExpenseProjection:UPDATE` (`ec:242`). PHI: yes.

### `DELETE /api/v1/expenses/projections/:id`
Route `expenseRoutes.ts:61`. Middleware: auth, CSRF, uuid validate. Controller `deleteProjection:263`. Response: `{ success: true }`. Errors: 401, 404. Audit: `ExpenseProjection:DELETE` (`ec:277`).

### `GET /api/v1/expenses/actuals`
Route `expenseRoutes.ts:73`. Middleware: auth, `validate(actualsQuery, 'query')`. Controller `getActuals:411`. Zod `validation.ts:626-630`. Response: `{ success, data: [<ExpenseActual>], pagination }`. Audit: `ExpenseActual:LIST` (`ec:446`). PHI: yes — billed/paid amounts decrypted.

### `POST /api/v1/expenses/actuals`
Route `expenseRoutes.ts:81`. Middleware: auth, CSRF, `validate(createActual)`. Controller `createActual:345`. Zod `validation.ts:595-609`. Response 201: actual. Audit: `ExpenseActual:CREATE` (`ec:394`). PHI: yes.

### `PUT /api/v1/expenses/actuals/:id`
Route `expenseRoutes.ts:89`. Middleware: auth, CSRF, uuid, update body. Controller `updateActual:475`. Zod `validation.ts:611-624`. Audit: `ExpenseActual:UPDATE` (`ec:527`).

### `DELETE /api/v1/expenses/actuals/:id`
Route `expenseRoutes.ts:97`. Middleware: auth, CSRF, uuid. Controller `deleteActual:541`. Audit: `ExpenseActual:DELETE` (`ec:555`).

### `POST /api/v1/expenses/analyze`
1. **Route**: `expenseRoutes.ts:109`
2. **Middleware**: auth, `aiLimiter`, `blockDemoAI`, CSRF, `validate(analyzeCosts)`.
3. **Controller**: `analyzeCosts:617`.
4. **RLS**: controller uses RLS-scoped prisma.
5. **Zod**: `{ planId: uuid }` (`validation.ts:580-582`).
6. **Response**: `{ success, data: { analysisId, totalEstimatedAnnualCost, breakdown: [...], recommendations: [...] } }`.
7. **Errors**: 401, 403 (demo/CSRF), 404 (plan), 422, 429 `AI_RATE_LIMIT_EXCEEDED`, 503 `SERVICE_UNAVAILABLE` (BAA gate, `ec:634-640`).
8. **Curl**:
    ```bash
    curl -X POST https://api.ownmyhealth.io/api/v1/expenses/analyze \
      -b cookies.txt -H 'X-CSRF-Token: <t>' -H 'Content-Type: application/json' \
      -d '{"planId":"<uuid>"}'
    ```
9. **Audit**: `ExpenseAnalysis:CREATE` (`ec:731`) + BAA-blocked access (`ec:634`).
10. **PHI**: yes — projections/actuals decrypted before Claude call.

### `GET /api/v1/expenses/analyses`
Route `expenseRoutes.ts:120`. Middleware: auth, `validate(analysesQuery, 'query')`. Controller `getAnalyses:759`. Zod `validation.ts:590-592`: `{ planId?: uuid }`. Response: `{ success, data: [<ExpenseAnalysis>] }`. Audit: `ExpenseAnalysis:LIST` (`ec:793`). PHI: yes.

---

## Health needs — `healthNeedsRoutes.ts`

Router-level `router.use(authenticate)` at `healthNeedsRoutes.ts:38`.

### `GET /api/v1/health-needs`
Route `healthNeedsRoutes.ts:41`. Middleware: auth, `validate(listQuery, 'query')`. Controller `getHealthNeeds:58`. RLS: `withRLSContext`. Zod `validation.ts:469-476`. Response: `{ success, data: [<HealthNeed>], pagination }`. Errors: 401, 422, 429. Audit: `HealthNeed:LIST` (`hnc:128`). PHI: yes — decrypted `descriptionEncrypted`.

### `GET /api/v1/health-needs/analyze`
Route `healthNeedsRoutes.ts:48`. Middleware: auth, `aiLimiter`. Controller `analyzeHealthNeeds:386`. Response: `{ success, data: { generated: [...], count } }`. Errors: 401, 429 `AI_RATE_LIMIT_EXCEEDED`, 503 (BAA). Audit: `HealthNeed:ANALYSIS` (`hnc:442`). PHI: yes.

### `GET /api/v1/health-needs/:id`
Route `healthNeedsRoutes.ts:51`. Middleware: auth, `validate(uuidParam, 'params')`. Controller `getHealthNeed:153`. RLS: withRLSContext. Response: `{ success, data: <HealthNeed> }`. Errors: 401, 404, 422. Audit: `HealthNeed:READ` (`hnc:175`). PHI: yes.

### `POST /api/v1/health-needs`
Route `healthNeedsRoutes.ts:58`. Middleware: auth, CSRF, `validate(create)`. Controller `createHealthNeed:186`. Zod `validation.ts:449-457`. Response 201: created need. Errors: 401, 403, 422. Audit: `HealthNeed:CREATE` (`hnc:216`). PHI: yes.

### `PATCH /api/v1/health-needs/:id`
Route `healthNeedsRoutes.ts:65`. Middleware: auth, uuid validate, update validate, CSRF. Controller `updateHealthNeedStatus:293`. Zod `validation.ts:459-467`. Audit: `HealthNeed:UPDATE` (`hnc:273, 331`). PHI: yes.

### `DELETE /api/v1/health-needs/:id`
Route `healthNeedsRoutes.ts:73`. Middleware: auth, uuid, CSRF. Controller `deleteHealthNeed:346`. Response: `{ success: true }`. Audit: `HealthNeed:DELETE` (`hnc:373`). PHI: name only in audit.

---

## Health goals — `healthGoalsRoutes.ts`

Router-level `router.use(authenticate)` at `healthGoalsRoutes.ts:42`.

### `GET /api/v1/health-goals/summary`
Route `healthGoalsRoutes.ts:45`. Middleware: auth. Controller `getGoalsSummary:684`. RLS: withRLSContext. Response: `{ success, data: { totalGoals, byStatus, byCategory, progressAverage } }`. Audit: `HealthGoal:SUMMARY` (`hgc:750`). PHI: counts only.

### `GET /api/v1/health-goals/suggestions`
Route `healthGoalsRoutes.ts:48`. Middleware: auth, `aiLimiter`. Controller `suggestGoals:764`. Response: `{ success, data: { suggestions: [...] } }`. Errors: 401, 429, 503 (BAA). Audit: `HealthGoal:SUGGEST` (`hgc:841`). PHI: yes.

### `GET /api/v1/health-goals`
Route `healthGoalsRoutes.ts:51`. Middleware: auth, `validate(listQuery, 'query')`. Controller `getHealthGoals:216`. Zod `validation.ts:522-528`. Response: `{ success, data: [<HealthGoal>], pagination }`. Audit: `HealthGoal:LIST` (`hgc:272`). PHI: yes.

### `GET /api/v1/health-goals/:id`
Route `healthGoalsRoutes.ts:58`. Middleware: auth, uuid validate. Controller `getHealthGoal:297`. Response: `{ success, data: <HealthGoal with progressHistory> }`. Errors: 401, 404, 422. Audit: `HealthGoal:READ` (`hgc:324`). PHI: yes.

### `POST /api/v1/health-goals`
Route `healthGoalsRoutes.ts:65`. Middleware: auth, CSRF, `validate(create)`. Controller `createHealthGoal:335`. Zod `validation.ts:483-499`. Response 201: created goal. Audit: `HealthGoal:CREATE` (`hgc:431`). PHI: yes.

### `PUT /api/v1/health-goals/:id`
Route `healthGoalsRoutes.ts:72`. Middleware: auth, uuid, update validate, CSRF. Controller `updateHealthGoal:447`. Zod `validation.ts:501-515`. Audit: `HealthGoal:UPDATE` (`hgc:513`). PHI: yes.

### `PATCH /api/v1/health-goals/:id/progress`
Route `healthGoalsRoutes.ts:80`. Middleware: auth, uuid, `validate(updateProgress)`, CSRF. Controller `updateGoalProgress:531`. Zod `validation.ts:517-520` — `{ value: number, note?: string(500) }`. Response: updated goal with new progress entry. Audit: `HealthGoal:PROGRESS_UPDATE` (`hgc:625`). PHI: yes.

### `DELETE /api/v1/health-goals/:id`
Route `healthGoalsRoutes.ts:88`. Middleware: auth, uuid, CSRF. Controller `deleteHealthGoal:643`. Audit: `HealthGoal:DELETE` (`hgc:670`).

---

## Provider — `providerRoutes.ts`

Router-level `authenticate` + `requireRole('PROVIDER', 'ADMIN')` at `providerRoutes.ts:24-25`.

### `GET /api/v1/provider/patients`
Route `providerRoutes.ts:31`. Middleware: auth, `requireRole('PROVIDER','ADMIN')`. Controller: inline `providerRoutes.ts:33-106`. RLS: `withRLSContext(null, async tx => ..., { isAdmin: true })` at `pr:41-64`. Zod: none. Response: `{ success, data: [{ relationshipId, patientId, patient: {id, email?, createdAt}, permissions: {canViewBiomarkers,...}, relationshipType, status, consentGrantedAt, consentExpiresAt }] }`. PENDING relationships omit `patient.email` to avoid leaking pre-consent PHI (`pr:75`). Errors: 401, 403 (`Access denied. Required roles: PROVIDER, ADMIN`, `rbac.ts:70`), 429. Audit: `provider_patients:LIST` (`pr:94`). PHI: email + createdAt (consent-gated).

### `POST /api/v1/provider/patients/request`
Route `providerRoutes.ts:112`. Middleware: auth, RBAC, CSRF, `validate(schemas.providerPatient.request)`. Controller: inline `providerRoutes.ts:115-234`. RLS: admin wrap for email lookup (`pr:127-136`), providerId wrap for upsert (`pr:176`). Zod `validation.ts:535-538`: `{ patientEmail, relationshipType?, message? }`. Response 201: `{ success, data: { relationshipId, status: 'PENDING' } }`. Errors: 401, 403 (already ACTIVE, PENDING, `pr:188, 191`), 404 (patient not found, `pr:147`), 422, 429. Audit: `provider_patient_request:REQUEST_ACCESS` (`pr:141, 152, 220`). PHI: encrypted note if provided.

### `GET /api/v1/provider/patients/:patientId`
Route `providerRoutes.ts:241`. Middleware: auth, RBAC, `validate(patientIdParam, 'params')`. Controller: inline `pr:244-360`. RLS: admin wrap (`pr:254-291`). Filters on `isActive=true` and not-locked. Response: `{ success, data: { patient: {id, email, createdAt, lastLoginAt}, relationship: {id, relationshipType, permissions, consentGrantedAt, consentExpiresAt} } }`. Errors: 401, 403 (no relationship, not ACTIVE, consent expired — `pr:302, 313`), 404 (patient inactive, `pr:322`), 422, 429. Audit: `patient_detail:VIEW_PATIENT` (multiple, `pr:297, 307, 317, 348`). PHI: email + account dates.

### `GET /api/v1/provider/patients/:patientId/biomarkers`
Route `providerRoutes.ts:366`. Same RBAC chain. Controller inline `pr:369-504`. RLS: admin wrap (`pr:378-419`). Authorization chain: relationship exists + ACTIVE + `canViewBiomarkers=true` + not consent-expired + patient active + not locked (`pr:423-462`). Decrypts using **patient's** salt (`getUserEncryptionSalt(patientId)`). Response: `{ success, data: [<Biomarker with decrypted fields>] }`. Errors: 403 (consent), 404, 422. Audit: `patient_biomarkers:PHI_ACCESS` (`pr:425, 435, 446, 455, 491`). PHI: yes — cross-user PHI disclosure.

### `GET /api/v1/provider/patients/:patientId/health-needs`
Route `providerRoutes.ts:510`. Same shape as biomarker endpoint but checks `canViewHealthNeeds`. Controller inline `pr:513-635`. RLS: admin wrap. Audit: `patient_health_needs:PHI_ACCESS` (`pr:565, 575, 586, 595, 622`). PHI: yes.

### `DELETE /api/v1/provider/patients/:patientId`
Route `providerRoutes.ts:641`. Middleware: auth, RBAC, uuid, CSRF. Controller inline `pr:644-718`. RLS: `withRLSContext(providerId)` for read+delete (`pr:660`). Hard-delete (F-23 flagged). Response: `{ success, data: { message } }`. Errors: 401, 403 (not ACTIVE, consent expired), 404. Audit: `provider_patient_relationship:DELETE` (`pr:672, 681, 691, 701`). PHI: none.

---

## Patient — `patientRoutes.ts`

Router-level `authenticate` + `requireRole('PATIENT')` at `patientRoutes.ts:22-24`.

### `GET /api/v1/patient/providers`
Route `patientRoutes.ts:30`. Middleware: auth, RBAC. Controller inline `pt:32-104`. RLS: `withRLSContext(patientId)` for own rows; `withRLSContext(null, isAdmin:true)` for cross-tenant provider lookup. Response: `{ success, data: [{ relationshipId, providerId, provider: {id, email}, permissions, relationshipType, status, consent* }] }`. Audit: `patient_providers:LIST` (`pt:93`). PHI: provider emails.

### `GET /api/v1/patient/providers/pending`
Route `patientRoutes.ts:110`. Same pattern; filters to status PENDING. Response: `{ success, data: [{ requestId, providerId, provider, relationshipType, requestedAt }] }`. Audit: `patient_pending_requests:LIST` (`pt:163`).

### `POST /api/v1/patient/providers/:id/approve`
Route `patientRoutes.ts:181`. Middleware: auth, RBAC, uuid, `validate(providerPatient.approve)`, CSRF. Controller inline `pt:184-269`. Zod `validation.ts:540-547`. RLS: `withRLSContext(patientId)` (`pt:206`). Response: `{ success, data: { message, relationship } }`. Errors: 401, 403 (RBAC), 404 (pending request not found, `pt:222`), 422. Audit: `provider_consent:APPROVE` → `CONSENT_GRANTED` with permission snapshot (`pt:216, 240`). PHI: none.

### `POST /api/v1/patient/providers/:id/deny`
Route `patientRoutes.ts:275`. Middleware: auth, RBAC, uuid, CSRF. Controller inline. RLS: `withRLSContext(patientId)`. Response: `{ success, data: { message: 'Provider access denied' } }`. Errors: 404 (not PENDING). Audit: `provider_consent:DENY` → `CONSENT_DENIED` (`pt:296, 306`). PHI: none.

### `PATCH /api/v1/patient/providers/:id`
Route `patientRoutes.ts:332`. Middleware: auth, RBAC, uuid, `validate(providerPatient.updatePermissions)`, CSRF. Zod `validation.ts:549-556`. RLS: `withRLSContext(patientId)`. Blocks update if `consentExpiresAt < now` (`pt:369`). Response: updated relationship. Errors: 401, 403 (consent expired), 404 (not ACTIVE). Audit: `provider_consent_permissions:UPDATE` → `PERMISSIONS_UPDATED` with before/after (`pt:355, 369, 398`). PHI: none.

### `POST /api/v1/patient/providers/:id/revoke`
Route `patientRoutes.ts:425`. Middleware: auth, RBAC, uuid, CSRF. Controller: soft-revoke — sets `status='REVOKED'` (NOT delete), preserving audit joinability. Response: `{ success, data: { message: 'Provider access revoked' } }`. Audit: `provider_consent:REVOKE` → `CONSENT_REVOKED` (`pt:446, 455`). PHI: none.

### `DELETE /api/v1/patient/providers/:id`
Route `patientRoutes.ts:490`. Middleware: auth, RBAC, uuid, CSRF. **Hard delete** (unlike revoke). Response: `{ success, data: { message } }`. Audit: `provider_consent:DELETE` → `RELATIONSHIP_DELETED` (`pt:510, 519`). PHI: none.

---

## Admin — `adminRoutes.ts`

Router-level: `authenticate`, `blockDemoAdminAccess`, `requireRole('ADMIN')` at `adminRoutes.ts:29-31`. **Demo runs before RBAC** so a demo account with elevated role still gets rejected.

### `GET /api/v1/admin/users`
Route `adminRoutes.ts:41`. Middleware chain + `validate(listUsersQuery, 'query')`. Controller inline `ar:44-123`. RLS: `withRLSContext(null, isAdmin:true)`. Zod `validation.ts:737-743`. Response: `{ success, data: { users: [...], pagination: { page, limit, total, totalPages } } }`. Errors: 401, 403 (demo or non-admin), 422, 429. Audit: `admin_user_list:LIST` (`ar:95`). PHI: user emails + counts.

### `GET /api/v1/admin/users/:id`
Route `adminRoutes.ts:130`. Middleware + uuid validate. Controller inline. Response: `{ success, data: <user with _count> }`. Errors: 404. Audit: `admin_user_detail:VIEW` (`ar:170, 181`).

### `POST /api/v1/admin/users`
Route `adminRoutes.ts:201`. Middleware + CSRF + `validate(admin.createUser)`. Zod `validation.ts:722-728`. Response 201: created user. Errors: 400 `BAD_REQUEST` (email exists, `ar:217`), 422. Audit: `admin_user:CREATE` (`ar:243`).

### `PATCH /api/v1/admin/users/:id`
Route `adminRoutes.ts:267`. Middleware + uuid + `validate(admin.updateUser)` + CSRF. Zod `validation.ts:730-735`. Self-role-change blocked (`ar:278`). Response: updated user. Audit: `admin_user:UPDATE` or `PERMISSION_CHANGE` if role changed (`ar:322, 337`).

### `DELETE /api/v1/admin/users/:id`
Route `adminRoutes.ts:367`. Soft delete — sets `isActive=false`, deletes all sessions. Self-delete blocked (`ar:378`). Audit: `admin_user_status:DEACTIVATE` (`ar:378, 398, 408`). Response: `{ success, data: { message } }`.

### `DELETE /api/v1/admin/users/:id/permanent`
Route `adminRoutes.ts:450`. Middleware + `sensitiveLimiter` (10/hr) + uuid + `validate(admin.permanentDelete)` + CSRF. Zod `validation.ts:764-766` — `{ confirmEmail }`. Must match target user's email (`ar:492`). Cascades delete via Prisma. Self-delete blocked. Audit: `admin_user_permanent:PERMANENT_DELETE` (`ar:465, 482, 493, 503`). Response: `{ success, data: { message } }`.

```bash
curl -X DELETE https://api.ownmyhealth.io/api/v1/admin/users/$TID/permanent \
  -b cookies.txt -H 'X-CSRF-Token: <t>' -H 'Content-Type: application/json' \
  -d '{"confirmEmail":"target@example.com"}'
```

### `PATCH /api/v1/admin/users/:id/plan`
Route `adminRoutes.ts:548`. Middleware + uuid + `validate(admin.updateUserPlan)` + CSRF. Zod `validation.ts:756-759` — `{ plan: enum, expiresAt?: datetime|null }`. Response: updated user's plan fields. Audit: `admin_user_plan:PLAN_CHANGE` (`ar:592, 604`).

### `GET /api/v1/admin/provider-relationships`
Route `adminRoutes.ts:637`. Middleware. Controller inline. Response: `{ success, data: [<ProviderPatient>] }` (take 100). Audit: `admin_provider_relationship:LIST` (`ar:657`).

### `PATCH /api/v1/admin/provider-relationships/:id`
Route `adminRoutes.ts:677`. Middleware + uuid + CSRF. No body Zod (controller parses loosely). Response: updated relationship. Errors: 404, 422. Audit: `admin_provider_relationship:UPDATE` (`ar:713, 724`).

### `GET /api/v1/admin/stats`
Route `adminRoutes.ts:762`. Middleware. Controller inline. 7 parallel counts in a single admin transaction. Response: `{ success, data: { users: {total, active, byRole, recentLogins}, data: {biomarkers, insurancePlans, healthNeeds} } }`. Audit: `admin_system_stats:VIEW` (`ar:832`).

### `GET /api/v1/admin/audit-logs`
Route `adminRoutes.ts:855`. Middleware + `validate(auditLogQuery, 'query')`. Zod `validation.ts:745-753`. Response: `{ success, data: { logs: [...], pagination } }`. Audit: `admin_audit_logs:VIEW` (`ar:900`) — meta-audit (watching the watchers).

---

## Uploads — `uploadRoutes.ts`

Router-level `router.use(uploadLimiter)` at `uploadRoutes.ts:26`. Multer memory storage, 10 MB/file, single file, PDF or (for OCR) PDF/PNG/JPG/TIFF/GIF/WEBP.

### `POST /api/v1/upload/lab-report`
Route `uploadRoutes.ts:77`. Middleware: `uploadLimiter`, `authenticate`, `aiLimiter`, `blockDemoAI`, `requirePlanLimit('pdfUploadsPerMonth')`, `upload.single('file')`. CSRF exempt. Controller `upload/labUploadController.uploadLabReport:36`. Request: multipart/form-data with `file` field (PDF ≤ 10MB). Response 201: `{ success, data: { fileId, biomarkers: [<created>], confidence, extractedCount } }`. Errors: 400 (bad PDF, `shared.ts:securePdfParsing`), 401, 403 (demo), 403 `PLAN_LIMIT_EXCEEDED`, 413, 422, 429 (`UPLOAD` or `AI`), 502/503 Anthropic. Audit: `lab_report_upload:UPLOAD` (`lu:55, 141`). PHI: yes.

### `POST /api/v1/upload/insurance-sbc`
Route `uploadRoutes.ts:94`. Same middleware stack. Controller `upload/sbcUploadController.uploadSBC:33`. Response 201: `{ success, data: { plan, extractionConfidence } }`. Audit: `InsurancePlan:UPLOAD` (`sbc:53, 165`).

### `POST /api/v1/upload/lab-results-ocr`
Route `uploadRoutes.ts:124`. Same middleware + `uploadOCR` multer (allows images). Controller `upload/labUploadController.uploadLabResultOCR:191`. Uses Google Document AI instead of Claude extraction for scanned documents. Extracts bone-health biomarkers (Calcium, Vit D, PTH, Phosphorus, ALP). Response 201: `{ success, data: { fileId, biomarkers } }`. Audit: `lab_ocr_upload:UPLOAD` (`lu:213, 305`).

---

## Files — `fileRoutes.ts`

Router-level `router.use(authenticate)` at `fileRoutes.ts:42`.

### `GET /api/v1/files`
Route `fileRoutes.ts:46`. Middleware: auth, `validate(schemas.pagination, 'query')`. Controller `fileController.getFiles:43`. RLS: `withRLSTransaction(userId)`. Response: `{ success, data: [{id, filename, originalFilename, fileType, fileSize, storageKey, labName, labDate, biomarkersExtracted, extractionConfidence, categories, createdAt}], pagination }`. Audit: `UserFile:LIST` (`fc:101`). PHI: filename metadata.

### `GET /api/v1/files/:id`
Route `fileRoutes.ts:53`. Middleware: auth, uuid validate. Controller `fileController.getFile:126`. RLS: `withRLSTransaction(userId)` with `{id, userId}` filter — non-owner gets 404 (`fc:147`). Response: `<UserFile>` + `downloadUrl` (**15-minute signed GCS URL** from `storageService.getSignedUrl(key, 'read')`, `fc:156`). Audit: `UserFile:READ` (`fc:187`). PHI: filename + signed URL.

### `GET /api/v1/files/:id/download`
Route `fileRoutes.ts:60`. Middleware: auth, `sensitiveLimiter`, uuid validate. Controller `fileController.getFileDownloadUrl:211`. **Streams bytes through backend** — no signed URL exposed to client (`fc:203-207` rationale comment). Headers: `Content-Disposition: attachment; filename="<safe>"`, `Cache-Control: no-store`. Response: raw file stream. Errors: 401, 404, 502 `STORAGE_READ_FAILED` (`fc:284`), 429 `SENSITIVE_RATE_LIMIT_EXCEEDED`. Audit: `UserFile:EXPORT FILE_DOWNLOAD` (`fc:242`) — logged **before** streaming starts. PHI: **raw file bytes**.

### `DELETE /api/v1/files/:id`
Route `fileRoutes.ts:68`. Middleware: auth, uuid, CSRF. Controller `fileController.deleteFile:299`. Two RLS transactions: find, then unlink biomarkers + delete file row. Also calls `storageService.deleteFile(storageKey)` between the two (continues even if GCS delete fails). Audit: `UserFile:DELETE` (`fc:322`). Response: `{ success: true }`.

---

## Settings — `settingsRoutes.ts`

Router-level `router.use(authenticate)` at `settingsRoutes.ts:31`.

### `GET /api/v1/settings/profile`
Route `settingsRoutes.ts:34`. Middleware: auth, `sensitiveLimiter`. Controller `settingsController.getProfile:911`. Response: `{ success, data: { id, email, role, firstName, lastName, dateOfBirth?, phone?, address?, notificationPreferences } }` (decrypted). Audit: `User:READ` with `operation: 'VIEW_PROFILE'` (`sc:946`). PHI: yes.

### `PATCH /api/v1/settings/profile`
Route `settingsRoutes.ts:42`. Middleware: auth, `sensitiveLimiter`, `blockDemoProfileUpdate`, `validate(settings.updateProfile)`, CSRF. Zod `validation.ts:655-661` — `{ firstName?, lastName? }` with refine that at least one present. Controller `settingsController.updateProfile:969`. Response: updated decrypted profile. Errors: 401, 403 (demo), 422. Audit: `User:UPDATE` (`sc:1014`). PHI: yes.

### `GET /api/v1/settings/notifications`
Route `settingsRoutes.ts:51`. Middleware: auth, `sensitiveLimiter`. Controller `settingsController.getNotifications:1041`. Response: `{ success, data: { email: {enabled, newResults, outOfRangeAlerts, goalReminders, weeklySummary, planExpiring} } }`. PHI: none (preferences).

### `PATCH /api/v1/settings/notifications`
Route `settingsRoutes.ts:57`. Middleware: auth, `sensitiveLimiter`, `blockDemoProfileUpdate`, `validate(settings.updateNotifications)`, CSRF. Zod `validation.ts:663-683`. Response: updated prefs. Audit: `User:UPDATE` (`sc:1128`). PHI: none.

### `GET /api/v1/settings/health-profile`
Route `settingsRoutes.ts:66`. Middleware: auth, `sensitiveLimiter`. Controller `getHealthProfile:1149`. Response: `{ success, data: <UserHealthProfile> }`. Audit: `UserHealthProfile:READ` (`sc:1159`). PHI: yes.

### `PATCH /api/v1/settings/health-profile`
Route `settingsRoutes.ts:76`. Middleware: auth, `sensitiveLimiter`, `blockDemoProfileUpdate`, `requirePlanFeature('healthProfile')` (FREE blocked; PRO/TEAM allowed), `validate(settings.updateHealthProfile)`, CSRF. Zod `validation.ts:689-715`. Controller `updateHealthProfile:1179`. Response: updated profile. Errors: 401, 403 `PLAN_LIMIT_EXCEEDED` (FREE users), 422. Audit: `UserHealthProfile:UPDATE` (`sc:1205`). PHI: yes.

### `GET /api/v1/settings/export-data`
Route `settingsRoutes.ts:86`. Middleware: auth, `sensitiveLimiter`. Controller `exportUserData:306`. Response: `Content-Type: application/json`, full user PHI export (biomarkers, insurance plans, expenses, health goals/needs, files — all decrypted). Errors: 401, 429. Audit: `UserData:EXPORT` (`sc:638`). PHI: **entire account PHI**.

### `DELETE /api/v1/settings/delete-data`
Route `settingsRoutes.ts:93`. Middleware: auth, `sensitiveLimiter`, `validate(settings.deleteData)`, CSRF. Zod `validation.ts:685-687` — `{ password }`. Controller `deleteAllData:675`. Deletes biomarkers, insurance, health needs/goals, files, expenses — keeps user row. Response: `{ success, data: { deletedCounts } }`. Errors: 401 (bad password). Audit: `UserData:DELETE` (`sc:792`). PHI: counts.

### `DELETE /api/v1/settings/delete-account`
Route `settingsRoutes.ts:101`. Middleware: auth, `sensitiveLimiter`, CSRF. Controller `deleteAccount:816`. Cascades via Prisma. Response: `{ success: true }` (client should log out / clear cookies). Audit: `User:DELETE` (`sc:849`). PHI: none in response.

---

## AI chat — `aiRoutes.ts`

Router-level `router.use(requireBearerAuth)` at `aiRoutes.ts:20` — **not `authenticate`**. Bearer-only because SSE can't carry custom headers (`EventSource`) so CSRF can't ride along; cookie-auth bypass closed by using bearer-only extraction (`auth.ts:58-64, 166-201`).

### `POST /api/v1/ai/chat`
1. **Route**: `aiRoutes.ts:28`.
2. **Middleware** (in order): `requireBearerAuth`, `aiLimiter`, `blockDemoAI`, `requirePlanLimit('aiChatsPerDay')`, `validate(schemas.ai.chat)`. **CSRF exempt** via `bearerOnlyStreamingRoutes` list (`csrf.ts:130-132`).
3. **Controller**: `aiChatController.handleAIChat:123`.
4. **RLS**: `assembleHealthContext(userId)` (`services/healthContextService.ts`) runs RLS-scoped reads internally.
5. **Zod**:
    ```ts
    // Source: backend/src/middleware/validation.ts:L637-L648
    ai: {
      chat: z.object({
        message: z.string().min(1).max(2000),
        conversationHistory: z
          .array(z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string().max(5000),
          }))
          .max(20).optional(),
      }),
    },
    ```
6. **Response**: **Server-Sent Events stream**. Each line is `data: {"type":"delta","text":"..."}`; final events include `{"type":"done"}`. `Content-Type: text/event-stream`.
7. **Errors**:
    | HTTP | code | Origin | When |
    |---|---|---|---|
    | 401 | `UNAUTHORIZED` | `auth.ts:175` | Missing Bearer |
    | 403 | `FORBIDDEN` | `demoProtection.ts:170` | Demo blocked |
    | 403 | `PLAN_LIMIT_EXCEEDED` | `planGating.ts:88` | Daily chat quota |
    | 422 | `VALIDATION_ERROR` | `validation.ts:172` | Bad body |
    | 429 | `AI_RATE_LIMIT_EXCEEDED` | `rateLimiter.ts:108` | 10/hr/user |
    | 500 | `CONTEXT_ASSEMBLY_FAILED` | `aiChatController.ts:157` | Decryption failure |
    | 503 | `SERVICE_UNAVAILABLE` | `aiChatController.ts:140` | BAA gate closed |
8. **Curl**:
    ```bash
    curl -N -X POST https://api.ownmyhealth.io/api/v1/ai/chat \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -H "Accept: text/event-stream" \
      -d '{"message":"What is my LDL trend?"}'
    ```
9. **Audit**: `HealthGuide:CHAT` / `CHAT_BLOCKED_NO_BAA` at `aic:135, 262, 291`.
10. **PHI**: user's full biomarker/goal/need context serialized + sent to Anthropic; response scrubbed via trailing `PHI_SCRUB_WINDOW=64` buffer on SSE flush (`aiChatController.ts:46`).

---

## FHIR — `fhirRoutes.ts`

### `GET /api/v1/fhir/callback`
Route `fhirRoutes.ts:22`. **Public** (pre-`authenticate`) — OAuth redirect target. Controller `fhirController.handleCallback:76`. PKCE state binds the callback to a user (24-byte random, 10-min TTL). Response: 302 redirect to `config.quest.frontendSuccessRedirect` with either `?labConnected=quest` or `?error=...`. Errors: 400 `Missing code or state`. Audit: none. PHI: none.

### `GET /api/v1/fhir/connect/quest`
Route `fhirRoutes.ts:29`. Middleware: auth (router-level), `sensitiveLimiter`, `blockDemoAI`. Controller `initiateQuestConnect:38`. Response: `{ success, data: { redirectUrl } }`. Errors: 503 `SERVICE_UNAVAILABLE` when `QUEST_FHIR_CLIENT_ID` not set (`fhirController.ts:46`), 500 `CONNECT_FAILED` (`fc:65`), 403 (demo), 429. Audit: none. PHI: none.

### `GET /api/v1/fhir/connections`
Route `fhirRoutes.ts:36`. Middleware: auth. Controller `listConnections:113`. RLS: `withRLSContext(userId)` (`fc:119`). Response: `{ success, data: [{id, provider, connectedAt, lastSyncAt, syncStatus, syncError, lastImportedCount, isActive}] }`. Errors: 401. Audit: none. PHI: none.

### `POST /api/v1/fhir/sync/:connectionId`
Route `fhirRoutes.ts:39`. Middleware: auth, `sensitiveLimiter`, `blockDemoAI`, CSRF. Controller `triggerSync:145`. RLS: `withRLSContext(userId)` for lookup. Response: `{ success, data: <SyncResult> }`. Errors: 401, 403 (demo, CSRF), 404 `NOT_FOUND` (`fc:158`), 429, 500 `SYNC_FAILED` (`fc:172`). Audit: none (FHIR-layer audits land inside `labSyncService`). PHI: imports biomarkers.

### `DELETE /api/v1/fhir/connections/:id`
Route `fhirRoutes.ts:48`. Middleware: auth, `sensitiveLimiter`, `blockDemoAI`, CSRF. Controller `deleteConnection:183`. Response: 204 No Content. Errors: 500 `DISCONNECT_FAILED` (`fc:199`). Audit: none. PHI: none.

---

## Plan — `planRoutes.ts`

### `GET /api/v1/plan/available`
Route `planRoutes.ts:32`. **Public** (no `authenticate`). Controller inline. Response: `{ success, data: { plans: [PLANS.FREE, PLANS.PRO, PLANS.TEAM] } }`. PHI: none.

### `GET /api/v1/plan`
Route `planRoutes.ts:53`. Middleware: `authenticate` (inline). Controller inline `planRoutes.ts:55-92`. RLS: `withRLSContext(userId)` for plan read (`pl:65`). Response: `{ success, data: { currentPlan, planName, expiresAt, updatedAt, usage, limits, upgradeAvailable } }`. Audit: none. PHI: none.

---

## Onboarding — `onboardingRoutes.ts`

Router-level `router.use(authenticate)` at `onboardingRoutes.ts:20`.

### `GET /api/v1/onboarding/status`
Route `onboardingRoutes.ts:22`. Middleware: auth. Controller inline — delegates to `services/onboardingService.getOnboardingStatus(userId)`. Response: `{ success, data: { steps: { ... }, nextStep?, completed: bool } }`. PHI: none.

### `POST /api/v1/onboarding/complete`
Route `onboardingRoutes.ts:32`. Middleware: auth, CSRF. Controller inline — calls `completeOnboarding(userId)`. Response: `{ success, data: { completed: true, completedAt: <ISO> } }`. Audit: none. PHI: none.

---

## Acceptance questions (self-answered)

**Q1. Base URL in production vs staging.** Production is `https://api.ownmyhealth.io` (per `HARDCODED_PRODUCTION_ORIGINS` allowlist at `app.ts:64-67` and the frontend pairing with `https://app.ownmyhealth.io`). Staging URL is not pinned in the repo — `TBD (external: check `gcloud run services describe` for the staging Cloud Run service URL; see [`ENV_VARS.md`](./ENV_VARS.md) for the env-var scheme)`.

**Q2. How does a browser attach credentials.** The browser automatically sends three cookies for any same-site XHR: `access_token` (HttpOnly), `refresh_token` (HttpOnly), `csrf_token` (readable). Client-side code reads `csrf_token` and echoes it in the `X-CSRF-Token` header on state-changing requests. Source: `auth.ts:33-46`, `csrf.ts:156-176`.

**Q3. Response shape of `POST /api/v1/auth/login`.** `200 { success: true, data: { user: { id, email, role } } }` plus `Set-Cookie: access_token=...; refresh_token=...; csrf_token=...`. See [Auth §login](#post-apiv1authlogin).

**Q4. Which endpoints require PROVIDER role.** 6 endpoints — all under `/api/v1/provider/*` (`providerRoutes.ts:24-25` declares `requireRole('PROVIDER', 'ADMIN')` router-level): `GET /provider/patients`, `POST /provider/patients/request`, `GET /provider/patients/:patientId`, `GET /provider/patients/:patientId/biomarkers`, `GET /provider/patients/:patientId/health-needs`, `DELETE /provider/patients/:patientId`.

**Q5. Demo-blocked endpoints.** See [Demo-blocked routes](#demo-blocked-routes). All 11 admin routes (router-level `blockDemoAdminAccess`), all AI endpoints (10+: biomarker guidance, expense analyze, SBC upload, reanalyze, lab report upload, lab OCR upload, AI chat, insurance SBC via `/insurance/upload-sbc`, health-needs analyze via no blockDemoAI but rate-limited separately, health-goals suggestions via `aiLimiter` only, FHIR connect/sync/delete), and profile mutation routes (`settings/profile`, `settings/notifications`, `settings/health-profile`).

**Q6. Rate limiter for `POST /biomarkers/:id/guidance`.** `aiLimiter` — 10 requests per **1 hour** per authenticated user (`rateLimiter.ts:102-118`, keyed by `req.user.id`). Plus the global `standardLimiter` (100/15 min/IP) and the `requirePlanLimit('aiGuidancePerDay')` plan-tier gate.

**Q7. Zod failure error shape.** `422 { success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ field, message, code }, ...] } }`. Source: `validation.ts:169-174` creates `ValidationError('Validation failed', details)` which `errorHandler.ts:156-158` unpacks.

**Q8. Missing CSRF header response.** `403 { success: false, error: { code: 'FORBIDDEN', message: 'CSRF token missing' } }` (or `'Invalid CSRF token'` for length/value mismatch). Source: `csrf.ts:161, 167, 175`.

**Q9. Endpoint that returns a signed GCS URL + TTL.** `GET /api/v1/files/:id` — via `getSignedUrl(file.storageKey, 'read')` at `fileController.ts:156`. Default TTL is **15 minutes** (set in `services/storageService.ts` — the signed URL is used only for the `downloadUrl` field on the response; the actual download endpoint `GET /files/:id/download` streams bytes through the backend instead, avoiding the URL-leak vector, see `fileController.ts:203-207`).

**Q10. PHI returned by `GET /biomarkers` + decryption path.** Returns decrypted `value`, `unit`, `notes`. Decryption chain: controller calls `getUserEncryptionSalt(userId)` (PBKDF2-SHA512-derived per-user salt, `backend/src/services/userEncryption.ts`) → `getEncryptionService().decrypt(biomarker.valueEncrypted, userSalt)` (AES-256-GCM, `backend/src/services/encryption.ts`). See `biomarkerController.ts:L60-L108` and [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md).

**Q11. Refresh-token flow sequence.** (1) Access token expires after 15 min. (2) Client calls `POST /api/v1/auth/refresh` with the `refresh_token` cookie. (3) `refreshTokens` verifies the DB session, **rotates** to new access + refresh (old refresh row marked revoked), returns new access JWT in body + sets new cookies. (4) Also rotates `csrf_token`. See `authController.ts:330-368` and `authService.refreshTokens`.

**Q12. Endpoint producing `BIOMARKER_CREATE`-like audit.** `POST /api/v1/biomarkers` produces `auditService.logCreate('Biomarker', biomarker.id, {...}, { req, userId })` at `biomarkerController.ts:273`. The `logCreate` helper writes an audit row with `action = 'CREATE'`, `resourceType = 'Biomarker'`. (Equivalent for `POST /biomarkers/batch` at `bc:593` with `resourceId = 'BULK'`.)

**Q13. `POST /insurance/plans/upload-sbc` body + max size.** Route lives at `/api/v1/insurance/upload-sbc` (`insuranceRoutes.ts:127`) — prompt likely has a path typo. Body: `multipart/form-data` with a single `file` field, PDF only (`application/pdf` mime check + magic-byte check in `securePdfParsing.ts`), **max 10 MB** (`insuranceRoutes.ts:38-44`).

**Q14. `DELETE /settings/account` success response.** `200 { success: true }`. Side effect: user row cascaded-deleted, sessions revoked. See [settings §delete-account](#delete-apiv1settingsdelete-account) and `settingsController.ts:816-871`.

**Q15. Provider-to-patient access request + state transition.** Endpoint: `POST /api/v1/provider/patients/request` (`providerRoutes.ts:112`). Body: `{ patientEmail, relationshipType?, message? }`. State: creates (or upserts) a `ProviderPatient` row with `status = 'PENDING'`. The patient then transitions it via `POST /patient/providers/:id/approve` → `ACTIVE` (with permissions + optional `consentExpiresAt`), or `POST /patient/providers/:id/deny` → hard-deletes the row, or later `/revoke` → soft `REVOKED`.

**Q16. AI rate-limit exceeded behavior.** `429 { success: false, error: { code: 'AI_RATE_LIMIT_EXCEEDED', message: 'Too many AI requests. Please try again later.' } }`. Source: `rateLimiter.ts:102-118`. Standard headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` are set (`standardHeaders: true`). Retry hint = `RateLimit-Reset` epoch seconds.

**Q17. Distinct error `code` values.** **32** live codes (see [catalog](#error-code-catalog)): `BAD_REQUEST`, `UNAUTHORIZED`, `AUTHENTICATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `RATE_LIMIT_EXCEEDED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `DATABASE_ERROR`, `EXTERNAL_SERVICE_ERROR`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_JSON`, `AUTH_RATE_LIMIT_EXCEEDED`, `LOGIN_RATE_LIMIT_EXCEEDED`, `UPLOAD_RATE_LIMIT_EXCEEDED`, `SENSITIVE_RATE_LIMIT_EXCEEDED`, `AI_RATE_LIMIT_EXCEEDED`, `BULK_RATE_LIMIT_EXCEEDED`, `PLAN_LIMIT_EXCEEDED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_LOCKED`, `INVALID_CREDENTIALS`, `VERIFICATION_FAILED`, `RESEND_FAILED`, `RESET_FAILED`, `CONTEXT_ASSEMBLY_FAILED`, `CONNECT_FAILED`, `SYNC_FAILED`, `DISCONNECT_FAILED`, `STORAGE_READ_FAILED`. (Tests reference an additional `FORBIDDEN` alias that is used in the live error handler via `ForbiddenError` subclass.)

**Q18. Total endpoint count.** **108** authenticated rows in the mega-table (matches the prompt) plus 4 additional (`GET /plan`, `GET /plan/available`, `GET /onboarding/status`, `POST /onboarding/complete`) for a grand total of **112** routes when counting `app.ts` health/root/csrf-token endpoints and `routes/index.ts` meta-endpoints alongside the 16 route-file routers.

---

## Related Documents

- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — same routes, middleware-chain lens (router-level + per-route ordering).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — request lifecycle, auth flow diagrams.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — backing tables (Biomarker, InsurancePlan, ProviderPatient, etc.) and RLS policies.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — which fields returned by each endpoint are encrypted + their decryption site.
- [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) — recovery playbook per error `code`.
- [`ENV_VARS.md`](./ENV_VARS.md) — `CORS_ORIGIN`, `FRONTEND_URL`, `QUEST_FHIR_CLIENT_ID`, `ANTHROPIC_BAA_ACTIVE`, etc.

---

## Prompt drift log

- Prompt `17-api-reference-doc.md` "Files to review" lists `backend/src/routes/*.ts (all 19)` and `backend/src/controllers/*.ts (all 10)`. Actual counts: **16 route files** (`adminRoutes.ts`, `aiRoutes.ts`, `authRoutes.ts`, `biomarkerRoutes.ts`, `expenseRoutes.ts`, `fhirRoutes.ts`, `fileRoutes.ts`, `healthGoalsRoutes.ts`, `healthNeedsRoutes.ts`, `index.ts`, `insuranceRoutes.ts`, `onboardingRoutes.ts`, `patientRoutes.ts`, `planRoutes.ts`, `providerRoutes.ts`, `settingsRoutes.ts`, `uploadRoutes.ts`) and **12 controller files** (`aiChatController.ts`, `authController.ts`, `biomarkerController.ts`, `expenseController.ts`, `fhirController.ts`, `fileController.ts`, `healthGoalsController.ts`, `healthNeedsController.ts`, `index.ts`, `insuranceController.ts`, `settingsController.ts`, plus `upload/` sub-directory with 4 files: `labUploadController.ts`, `sbcUploadController.ts`, `shared.ts`, `index.ts`). Prompt author should update the canonical counts in `00-index.md`.
- Prompt mega-table example shows `biomarkerController.list:L22` — actual function is `getBiomarkers` at `biomarkerController.ts:111`.
- Prompt specifies `POST /api/v1/insurance/plans/upload-sbc` in Acceptance Q13 — actual path is `/api/v1/insurance/upload-sbc` (no `/plans/` segment) per `insuranceRoutes.ts:127`. Answered against the actual path.
- Prompt expected 108 endpoints; the mega-table row count is 108 matching that, but `GET /plan` + `GET /plan/available` + `GET /onboarding/status` + `POST /onboarding/complete` bring the grand total to 112 (documented in trailing rows). The 108 target was the 16 route-file routers + `app.ts` health/csrf + `routes/index.ts` meta — matches.
- Prompt says entry point is `backend/src/app.ts` (not `index.ts`). Confirmed — `app.ts:379` exports default.
