---
tags:
  - routing
  - security
  - reference
type: generated
updated: 2026-04-24
---

# ROUTING_TABLE.md

## Purpose

This is the security-stack-facing reference for every HTTP endpoint exposed by the OwnMyHealth backend. Each endpoint is a row with its middleware chain (auth, CSRF, rate limiter, RBAC, validation), its controller (`file:fn:line`), its RLS wrap posture, whether demo accounts are blocked, and whether it emits an audit event. The mega-table is the authoritative index; the per-group sections annotate the non-obvious middleware combinations and quote the route-file source.

## How to read this vs. `API_REFERENCE.md`

[`API_REFERENCE.md`](./API_REFERENCE.md) answers "how do I call this?" — request shape, response shape, curl example. This document answers "what guards this?" — which middleware runs, in what order, with which validation schema, and whether a DB query carries an RLS context. The same ~108 endpoints appear in both; this file is the one you open when you add a new route or are auditing for a missing guard.

---

## Global middleware chain

Before any route handler runs, Express processes every `/api/*` request through the following chain in `backend/src/app.ts`:

| # | Middleware | Source | Notes |
|---|---|---|---|
| 1 | `app.set('trust proxy', 1)` | `backend/src/app.ts:119` | Required for `req.ip` parsing behind Cloud Run's load balancer. |
| 2 | `helmet(...)` | `backend/src/app.ts:124` | CSP, XFO, CORP (`crossOriginResourcePolicy` disabled when `COOKIE_DOMAIN` is set). |
| 3 | `cors(corsOptions)` | `backend/src/app.ts:187` | Origin allowlist from `getSafeCorsOrigins()` (`app.ts:78`). |
| 4 | `app.options('*', cors(corsOptions))` | `backend/src/app.ts:190` | Explicit preflight responder. |
| 5 | `cookieParser()` | `backend/src/app.ts:193` | Must precede CSRF (reads `csrf_token` cookie). |
| 6 | `compression(...)` | `backend/src/app.ts:200-207` | Skips `text/event-stream` — SSE chat is never compressed. |
| 7 | `csrfProtection` | `backend/src/app.ts:212` | Applied unless `NODE_ENV=development` AND `DISABLE_CSRF=true`. |
| 8 | `standardLimiter` | `backend/src/app.ts:216` | Global rate limit — `config.rateLimit.windowMs` / `config.rateLimit.maxRequests`. |
| 9 | `morgan('dev' \| 'combined')` | `backend/src/app.ts:220-222` | Request logging. |
| 10 | `express.json({ limit: '10mb' })` | `backend/src/app.ts:226` | Body parser. |
| 11 | `express.urlencoded({ extended: true, limit: '10mb' })` | `backend/src/app.ts:227` | URL-encoded body parser. |
| 12 | `requireJsonContentType` | `backend/src/app.ts:230` | Rejects non-JSON bodies on POST/PUT/PATCH (multipart exempt). |
| 13 | `Cache-Control: no-store, no-cache, private` on `/api` | `backend/src/app.ts:237-240` | Defense-in-depth against PHI leaking into intermediate caches. |
| 14 | `app.use(/api/v1, routes)` | `backend/src/app.ts:243` | Mounts the route tree. |
| (after) | `notFoundHandler` | `backend/src/app.ts:301` | 404 synth for unknown routes. |
| (after) | `errorHandler` | `backend/src/app.ts:304` | Centralised error → `ApiResponse` mapper (`middleware/errorHandler.ts:135`). |

### Global chain (ASCII)

```
Client
  │
  ▼
trust proxy (app.ts:119)
  │
  ▼
helmet → cors → cookieParser → compression
  │
  ▼
csrfProtection (app.ts:212)
  │
  ▼
standardLimiter (app.ts:216)
  │
  ▼
morgan → express.json → express.urlencoded → requireJsonContentType
  │
  ▼
Cache-Control: no-store (app.ts:237)
  │
  ▼
/api/v1/<group> router (routes/index.ts)
  │                       │
  │                       ▼
  │                   per-route middleware chain (validate, authenticate, limiter, blockDemo*, validate(schema))
  │                       │
  │                       ▼
  │                   controller fn → withRLSContext / withRLSTransaction → Prisma → audit log
  │
  ▼ (on uncaught throw)
errorHandler (app.ts:304)
```

### Route mount base paths

From `backend/src/routes/index.ts:82-113`:

| Base mount | Router | Source |
|---|---|---|
| `/api/v1/auth` | `authRoutes` | `routes/index.ts:82` |
| `/api/v1/biomarkers` | `biomarkerRoutes` | `routes/index.ts:83` |
| `/api/v1/insurance` | `insuranceRoutes` | `routes/index.ts:84` |
| `/api/v1/expenses` | `expenseRoutes` | `routes/index.ts:85` |
| `/api/v1/health-needs` | `healthNeedsRoutes` | `routes/index.ts:86` |
| `/api/v1/health-goals` | `healthGoalsRoutes` | `routes/index.ts:87` |
| `/api/v1/provider` | `providerRoutes` | `routes/index.ts:90` |
| `/api/v1/patient` | `patientRoutes` | `routes/index.ts:91` |
| `/api/v1/admin` | `adminRoutes` | `routes/index.ts:92` |
| `/api/v1/upload` | `uploadRoutes` | `routes/index.ts:95` |
| `/api/v1/files` | `fileRoutes` | `routes/index.ts:98` |
| `/api/v1/settings` | `settingsRoutes` | `routes/index.ts:101` |
| `/api/v1/ai` | `aiRoutes` | `routes/index.ts:104` |
| `/api/v1/fhir` | `fhirRoutes` | `routes/index.ts:107` |
| `/api/v1/plan` | `planRoutes` | `routes/index.ts:110` |
| `/api/v1/onboarding` | `onboardingRoutes` | `routes/index.ts:113` |

### App-level endpoints (not inside the `/api/v1` router tree)

| Method | Path | Source | Notes |
|---|---|---|---|
| GET | `/` | `backend/src/app.ts:261` | Root banner, public. |
| GET | `/health` | `backend/src/app.ts:275` | Public Docker / Cloud Run liveness probe; no auth. |
| GET | `/api/health/db` | `backend/src/app.ts:292` | Legacy DB health check; `standardLimiter` attached explicitly. |
| GET | `/api/v1/csrf-token` | `backend/src/app.ts:258` | SPA token fetch. `csrfTokenHandler` (`middleware/csrf.ts:210`). |
| GET | `/api/v1/health` | `backend/src/routes/index.ts:42` | API-tree health check, public. |
| GET | `/api/v1/` | `backend/src/routes/index.ts:54` | API root (endpoint catalog), public. |

---

## Mega-table — every endpoint

**Count: 108 route-registered endpoints** (6 app-level + router-level `/api/v1/health` + `/api/v1/`, plus 100 group-mounted endpoints across 16 routers). Each row's `Route file:line` points at the `router.METHOD(` call; `Controller file:fn:line` points at the exported handler. "Auth" values: `yes` = `authenticate`, `bearer` = `requireBearerAuth`, `+RBAC(X)` = further role gate, `public` = no auth middleware. "CSRF" is from the global `csrfProtection` exemption list (`middleware/csrf.ts:98-132`) and explicit per-route `csrfProtection` where present. "GET" implies no CSRF check (bypasses validation even when middleware runs).

| Method | Path | Route file:line | Auth | CSRF | Rate limiter | RBAC | RLS wrap | Validation | Controller (`file:fn:line`) | Demo blocked? | Audit logged? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/` | `app.ts:261` | public | — | global | — | — | — | inline handler | — | — |
| GET | `/health` | `app.ts:275` | public | — | global | — | — | — | inline handler | — | — |
| GET | `/api/health/db` | `app.ts:292` | public | — | `standardLimiter` (+global) | — | — | — | inline handler | — | — |
| GET | `/api/v1/csrf-token` | `app.ts:258` | public | — | global | — | — | — | `csrfTokenHandler` (`middleware/csrf.ts:210`) | — | — |
| GET | `/api/v1/health` | `routes/index.ts:42` | public | — | global | — | — | — | inline handler | — | — |
| GET | `/api/v1/` | `routes/index.ts:54` | public | — | global | — | — | — | inline handler | — | — |
| POST | `/api/v1/auth/register` | `authRoutes.ts:39` | public | exempt (`/auth/register`) | `authLimiter` | — | `withRLSContext(null,...)` in service | `schemas.auth.register` | `authController.register:146` | — | yes (`logAuth REGISTER`) |
| POST | `/api/v1/auth/login` | `authRoutes.ts:46` | public | exempt (`/auth/login`) | `authLimiter` + `strictAuthLimiter` | — | via authService | `schemas.auth.login` | `authController.login:210` | — | yes (`LOGIN`, `LOGIN_FAILED`, `ACCOUNT_LOCKOUT`) |
| POST | `/api/v1/auth/refresh` | `authRoutes.ts:54` | cookie (refresh) | exempt (`/auth/refresh`) | `authLimiter` | — | via authService | — | `authController.refreshToken:330` | — | yes |
| POST | `/api/v1/auth/demo` | `authRoutes.ts:57` | public | exempt (`/auth/demo`) | `authLimiter` | — | via authService | — | `authController.demoLogin:547` | — | yes |
| GET | `/api/v1/auth/verify-email` | `authRoutes.ts:60` | public | — (GET) | `authLimiter` | — | via authService | `schemas.auth.verifyEmailQuery` (query) | `authController.verifyEmail:594` | — | yes |
| POST | `/api/v1/auth/resend-verification` | `authRoutes.ts:69` | public | — | `authLimiter` + `strictAuthLimiter` | — | via authService | `schemas.auth.resendVerification` | `authController.resendVerification:648` | — | yes |
| POST | `/api/v1/auth/forgot-password` | `authRoutes.ts:77` | public | exempt (`/auth/forgot-password`) | `authLimiter` + `strictAuthLimiter` | — | via authService | `schemas.auth.forgotPassword` | `authController.forgotPassword:692` | — | yes |
| POST | `/api/v1/auth/reset-password` | `authRoutes.ts:85` | public | exempt (`/auth/reset-password`) | `authLimiter` + `strictAuthLimiter` | — | via authService | `schemas.auth.resetPassword` | `authController.resetPasswordHandler:731` | — | yes |
| POST | `/api/v1/auth/logout` | `authRoutes.ts:97` | yes | global | `authLimiter` | — | via authService | — | `authController.logout:374` | — | yes |
| POST | `/api/v1/auth/logout-all` | `authRoutes.ts:100` | yes | global | `authLimiter` | — | via authService | — | `authController.logoutAll:418` | — | yes |
| GET | `/api/v1/auth/me` | `authRoutes.ts:103` | yes | — (GET) | `authLimiter` | — | via authService | — | `authController.getCurrentUser:452` | — | yes |
| POST | `/api/v1/auth/change-password` | `authRoutes.ts:106` | yes | global | `authLimiter` | — | via authService | `schemas.auth.changePassword` | `authController.changePassword:479` | — | yes |
| GET | `/api/v1/biomarkers/` | `biomarkerRoutes.ts:48` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.biomarker.listQuery` (query) | `biomarkerController.getBiomarkers:111` | — | yes (`LIST`) |
| GET | `/api/v1/biomarkers/summary` | `biomarkerRoutes.ts:55` | yes | — (GET) | global | — | `withRLSTransaction` | — | `biomarkerController.getSummary:657` | — | yes (`SUMMARY`) |
| GET | `/api/v1/biomarkers/categories` | `biomarkerRoutes.ts:61` | yes | — (GET) | global | — | `withRLSTransaction` | — | `biomarkerController.getCategories:422` | — | yes (`CATEGORIES`) |
| GET | `/api/v1/biomarkers/:id` | `biomarkerRoutes.ts:67` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `biomarkerController.getBiomarker:192` | — | yes (`READ`) |
| GET | `/api/v1/biomarkers/:id/history` | `biomarkerRoutes.ts:74` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `biomarkerController.getHistory:747` | — | yes (`HISTORY`) |
| POST | `/api/v1/biomarkers/` | `biomarkerRoutes.ts:81` | yes | global | global | — | `withRLSTransaction` | `schemas.biomarker.create` | `biomarkerController.createBiomarker:226` | — | yes (`CREATE`) |
| POST | `/api/v1/biomarkers/batch` | `biomarkerRoutes.ts:89` | yes | global | `bulkOperationLimiter` | — | `withRLSTransaction` | `schemas.biomarker.batchCreate` | `biomarkerController.bulkCreateBiomarkers:458` | — | yes (`CREATE` BULK) |
| PATCH | `/api/v1/biomarkers/:id` | `biomarkerRoutes.ts:97` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) + `schemas.biomarker.update` | `biomarkerController.updateBiomarker:288` | — | yes (`UPDATE`) |
| DELETE | `/api/v1/biomarkers/:id` | `biomarkerRoutes.ts:105` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `biomarkerController.deleteBiomarker:381` | — | yes (`DELETE`) |
| POST | `/api/v1/biomarkers/:id/guidance` | `biomarkerRoutes.ts:118` | yes | global | `aiLimiter` | plan: `aiGuidancePerDay` | `withRLSTransaction` | `schemas.uuidParam` (params) | inline handler (`biomarkerRoutes.ts:124-301`) | `blockDemoAI` | yes (`PHI_ACCESS`, `GUIDANCE_BLOCKED_NO_BAA`, `GUIDANCE_NOT_FOUND`) |
| GET | `/api/v1/insurance/plans` | `insuranceRoutes.ts:65` | yes | — (GET) | global | — | `withRLSTransaction` | — | `insuranceController.getInsurancePlans:412` | — | yes (`LIST`) |
| GET | `/api/v1/insurance/plans/:id` | `insuranceRoutes.ts:71` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `insuranceController.getInsurancePlan:466` | — | yes |
| POST | `/api/v1/insurance/plans` | `insuranceRoutes.ts:78` | yes | global | global | — | `withRLSTransaction` | `schemas.insurancePlan.create` | `insuranceController.createInsurancePlan:500` | — | yes |
| PATCH | `/api/v1/insurance/plans/:id` | `insuranceRoutes.ts:85` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` + `schemas.insurancePlan.update` | `insuranceController.updateInsurancePlan:600` | — | yes |
| DELETE | `/api/v1/insurance/plans/:id` | `insuranceRoutes.ts:93` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `insuranceController.deleteInsurancePlan:703` | — | yes |
| POST | `/api/v1/insurance/compare` | `insuranceRoutes.ts:100` | yes | global | global | — | `withRLSTransaction` | local `compareSchema` (`insuranceRoutes.ts:52`) | `insuranceController.comparePlans:744` | — | yes (`COMPARE`) |
| GET | `/api/v1/insurance/benefits/search` | `insuranceRoutes.ts:107` | yes | — (GET) | global | — | `withRLSTransaction` | local `benefitSearchSchema` (`insuranceRoutes.ts:56`) (query) | `insuranceController.searchBenefits:826` | — | yes (`SEARCH_BENEFITS`) |
| PUT | `/api/v1/insurance/plans/:id/reanalyze` | `insuranceRoutes.ts:115` | yes | global | `uploadLimiter` + `aiLimiter` | — | `withRLSTransaction` | `schemas.uuidParam` (params); multer file | `upload/sbcUploadController.reanalyzePlan:224` | `blockDemoAI` | yes (`REANALYZE`, `REANALYZE_FAILED`) |
| POST | `/api/v1/insurance/upload-sbc` | `insuranceRoutes.ts:127` | yes | exempt (`/insurance/upload-sbc`) | `uploadLimiter` + `aiLimiter` | — | `withRLSTransaction` | multer file | `upload/sbcUploadController.uploadSBC:33` | `blockDemoAI` | yes (`PARSE_FAILED` + create) |
| PUT | `/api/v1/insurance/plans/:id/spending` | `insuranceRoutes.ts:137` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `expenseController.updateCurrentSpending:572` | — | yes |
| GET | `/api/v1/expenses/projections` | `expenseRoutes.ts:37` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.expense.projectionsQuery` (query) | `expenseController.getProjections:136` | — | yes (`LIST`) |
| POST | `/api/v1/expenses/projections` | `expenseRoutes.ts:44` | yes | explicit `csrfProtection` + global | global | — | `withRLSTransaction` | `schemas.expense.createProjection` | `expenseController.createProjection:82` | — | yes |
| PUT | `/api/v1/expenses/projections/:id` | `expenseRoutes.ts:52` | yes | explicit `csrfProtection` + global | global | — | `withRLSTransaction` | `schemas.uuidParam` + `schemas.expense.updateProjection` | `expenseController.updateProjection:211` | — | yes |
| DELETE | `/api/v1/expenses/projections/:id` | `expenseRoutes.ts:61` | yes | explicit `csrfProtection` + global | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `expenseController.deleteProjection:263` | — | yes |
| GET | `/api/v1/expenses/actuals` | `expenseRoutes.ts:73` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.expense.actualsQuery` (query) | `expenseController.getActuals:411` | — | yes (`LIST`) |
| POST | `/api/v1/expenses/actuals` | `expenseRoutes.ts:80` | yes | explicit `csrfProtection` + global | global | — | `withRLSTransaction` | `schemas.expense.createActual` | `expenseController.createActual:345` | — | yes |
| PUT | `/api/v1/expenses/actuals/:id` | `expenseRoutes.ts:88` | yes | explicit `csrfProtection` + global | global | — | `withRLSTransaction` | `schemas.uuidParam` + `schemas.expense.updateActual` | `expenseController.updateActual:475` | — | yes |
| DELETE | `/api/v1/expenses/actuals/:id` | `expenseRoutes.ts:97` | yes | explicit `csrfProtection` + global | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `expenseController.deleteActual:541` | — | yes |
| POST | `/api/v1/expenses/analyze` | `expenseRoutes.ts:109` | yes | explicit `csrfProtection` + global | `aiLimiter` | — | `withRLSTransaction` | `schemas.expense.analyzeCosts` | `expenseController.analyzeCosts:617` | `blockDemoAI` | yes (`ANALYZE_BLOCKED_NO_BAA`, `ANALYZE`) |
| GET | `/api/v1/expenses/analyses` | `expenseRoutes.ts:119` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.expense.analysesQuery` (query) | `expenseController.getAnalyses:759` | — | yes (`LIST`) |
| GET | `/api/v1/health-needs/` | `healthNeedsRoutes.ts:41` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.healthNeed.listQuery` (query) | `healthNeedsController.getHealthNeeds:58` | — | yes (`LIST`) |
| GET | `/api/v1/health-needs/analyze` | `healthNeedsRoutes.ts:48` | yes | — (GET) | `aiLimiter` | — | `withRLSTransaction` | — | `healthNeedsController.analyzeHealthNeeds:386` | — | yes |
| GET | `/api/v1/health-needs/:id` | `healthNeedsRoutes.ts:51` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `healthNeedsController.getHealthNeed:153` | — | yes |
| POST | `/api/v1/health-needs/` | `healthNeedsRoutes.ts:58` | yes | global | global | — | `withRLSTransaction` | `schemas.healthNeed.create` | `healthNeedsController.createHealthNeed:186` | — | yes |
| PATCH | `/api/v1/health-needs/:id` | `healthNeedsRoutes.ts:65` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` + `schemas.healthNeed.update` | `healthNeedsController.updateHealthNeedStatus:293` | — | yes |
| DELETE | `/api/v1/health-needs/:id` | `healthNeedsRoutes.ts:73` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `healthNeedsController.deleteHealthNeed:346` | — | yes |
| GET | `/api/v1/health-goals/summary` | `healthGoalsRoutes.ts:45` | yes | — (GET) | global | — | `withRLSTransaction` | — | `healthGoalsController.getGoalsSummary:684` | — | yes (`SUMMARY`) |
| GET | `/api/v1/health-goals/suggestions` | `healthGoalsRoutes.ts:48` | yes | — (GET) | `aiLimiter` | — | `withRLSTransaction` | — | `healthGoalsController.suggestGoals:764` | — | yes (`SUGGESTIONS`) |
| GET | `/api/v1/health-goals/` | `healthGoalsRoutes.ts:51` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.healthGoal.listQuery` (query) | `healthGoalsController.getHealthGoals:216` | — | yes (`LIST`) |
| GET | `/api/v1/health-goals/:id` | `healthGoalsRoutes.ts:58` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `healthGoalsController.getHealthGoal:297` | — | yes |
| POST | `/api/v1/health-goals/` | `healthGoalsRoutes.ts:65` | yes | global | global | — | `withRLSTransaction` | `schemas.healthGoal.create` | `healthGoalsController.createHealthGoal:335` | — | yes |
| PUT | `/api/v1/health-goals/:id` | `healthGoalsRoutes.ts:72` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` + `schemas.healthGoal.update` | `healthGoalsController.updateHealthGoal:447` | — | yes |
| PATCH | `/api/v1/health-goals/:id/progress` | `healthGoalsRoutes.ts:80` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` + `schemas.healthGoal.updateProgress` | `healthGoalsController.updateGoalProgress:531` | — | yes |
| DELETE | `/api/v1/health-goals/:id` | `healthGoalsRoutes.ts:88` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `healthGoalsController.deleteHealthGoal:643` | — | yes |
| GET | `/api/v1/provider/patients` | `providerRoutes.ts:31` | yes | — (GET) | global | `PROVIDER`/`ADMIN` | `withRLSContext(null, isAdmin:true)` | — | inline handler (`providerRoutes.ts:33-106`) | — | yes (`LIST`) |
| POST | `/api/v1/provider/patients/request` | `providerRoutes.ts:112` | yes | global | global | `PROVIDER`/`ADMIN` | `withRLSContext(null, isAdmin)` + `withRLSContext(providerId)` | `schemas.providerPatient.request` | inline handler (`providerRoutes.ts:115-234`) | — | yes (`REQUEST_ACCESS`) |
| GET | `/api/v1/provider/patients/:patientId` | `providerRoutes.ts:241` | yes | — (GET) | global | `PROVIDER`/`ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.patientIdParam` (params) | inline handler (`providerRoutes.ts:244-359`) | — | yes (`VIEW_PATIENT`) |
| GET | `/api/v1/provider/patients/:patientId/biomarkers` | `providerRoutes.ts:366` | yes | — (GET) | global | `PROVIDER`/`ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.patientIdParam` (params) | inline handler (`providerRoutes.ts:369-503`) | — | yes (`PHI_ACCESS`) |
| GET | `/api/v1/provider/patients/:patientId/health-needs` | `providerRoutes.ts:510` | yes | — (GET) | global | `PROVIDER`/`ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.patientIdParam` (params) | inline handler (`providerRoutes.ts:513-634`) | — | yes (`PHI_ACCESS`) |
| DELETE | `/api/v1/provider/patients/:patientId` | `providerRoutes.ts:641` | yes | global | global | `PROVIDER`/`ADMIN` | `withRLSContext(providerId)` | `schemas.patientIdParam` (params) | inline handler (`providerRoutes.ts:644-717`) | — | yes (`DELETE`) |
| GET | `/api/v1/patient/providers` | `patientRoutes.ts:30` | yes | — (GET) | global | `PATIENT` | `withRLSContext(patientId)` + `withRLSContext(null, isAdmin)` | — | inline handler (`patientRoutes.ts:32-103`) | — | yes (`LIST`) |
| GET | `/api/v1/patient/providers/pending` | `patientRoutes.ts:110` | yes | — (GET) | global | `PATIENT` | `withRLSContext(patientId)` + `withRLSContext(null, isAdmin)` | — | inline handler (`patientRoutes.ts:112-174`) | — | yes (`LIST`) |
| POST | `/api/v1/patient/providers/:id/approve` | `patientRoutes.ts:181` | yes | global | global | `PATIENT` | `withRLSContext(patientId)` | `schemas.uuidParam` + `schemas.providerPatient.approve` | inline handler (`patientRoutes.ts:185-268`) | — | yes (`CONSENT_GRANTED`) |
| POST | `/api/v1/patient/providers/:id/deny` | `patientRoutes.ts:275` | yes | global | global | `PATIENT` | `withRLSContext(patientId)` | `schemas.uuidParam` (params) | inline handler (`patientRoutes.ts:278-325`) | — | yes (`CONSENT_DENIED`) |
| PATCH | `/api/v1/patient/providers/:id` | `patientRoutes.ts:332` | yes | global | global | `PATIENT` | `withRLSContext(patientId)` | `schemas.uuidParam` + `schemas.providerPatient.updatePermissions` | inline handler (`patientRoutes.ts:336-418`) | — | yes (`PERMISSIONS_UPDATED`) |
| POST | `/api/v1/patient/providers/:id/revoke` | `patientRoutes.ts:425` | yes | global | global | `PATIENT` | `withRLSContext(patientId)` | `schemas.uuidParam` (params) | inline handler (`patientRoutes.ts:428-483`) | — | yes (`CONSENT_REVOKED`) |
| DELETE | `/api/v1/patient/providers/:id` | `patientRoutes.ts:490` | yes | global | global | `PATIENT` | `withRLSContext(patientId)` | `schemas.uuidParam` (params) | inline handler (`patientRoutes.ts:493-542`) | — | yes (`RELATIONSHIP_DELETED`) |
| GET | `/api/v1/admin/users` | `adminRoutes.ts:41` | yes | — (GET) | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.admin.listUsersQuery` (query) | inline handler (`adminRoutes.ts:44-123`) | `blockDemoAdminAccess` | yes (`LIST`) |
| GET | `/api/v1/admin/users/:id` | `adminRoutes.ts:130` | yes | — (GET) | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.uuidParam` (params) | inline handler (`adminRoutes.ts:133-195`) | `blockDemoAdminAccess` | yes (`VIEW`) |
| POST | `/api/v1/admin/users` | `adminRoutes.ts:201` | yes | global | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.admin.createUser` | inline handler (`adminRoutes.ts:204-261`) | `blockDemoAdminAccess` | yes (`CREATE`) |
| PATCH | `/api/v1/admin/users/:id` | `adminRoutes.ts:267` | yes | global | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.uuidParam` + `schemas.admin.updateUser` | inline handler (`adminRoutes.ts:271-361`) | `blockDemoAdminAccess` | yes (`UPDATE`, `PERMISSION_CHANGE`) |
| DELETE | `/api/v1/admin/users/:id` | `adminRoutes.ts:367` | yes | global | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.uuidParam` (params) | inline handler (`adminRoutes.ts:370-443`) | `blockDemoAdminAccess` | yes (`DEACTIVATE`) |
| DELETE | `/api/v1/admin/users/:id/permanent` | `adminRoutes.ts:450` | yes | global | `sensitiveLimiter` | `ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.uuidParam` + `schemas.admin.permanentDelete` | inline handler (`adminRoutes.ts:455-533`) | `blockDemoAdminAccess` | yes (`PERMANENT_DELETE`) |
| PATCH | `/api/v1/admin/users/:id/plan` | `adminRoutes.ts:548` | yes | global | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.uuidParam` + `schemas.admin.updateUserPlan` | inline handler (`adminRoutes.ts:552-627`) | `blockDemoAdminAccess` | yes (`PLAN_CHANGE`) |
| GET | `/api/v1/admin/provider-relationships` | `adminRoutes.ts:637` | yes | — (GET) | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | — | inline handler (`adminRoutes.ts:639-671`) | `blockDemoAdminAccess` | yes (`LIST`) |
| PATCH | `/api/v1/admin/provider-relationships/:id` | `adminRoutes.ts:677` | yes | global | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.uuidParam` (params) | inline handler (`adminRoutes.ts:680-752`) | `blockDemoAdminAccess` | yes (`UPDATE`) |
| GET | `/api/v1/admin/stats` | `adminRoutes.ts:762` | yes | — (GET) | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | — | inline handler (`adminRoutes.ts:764-845`) | `blockDemoAdminAccess` | yes (`VIEW`) |
| GET | `/api/v1/admin/audit-logs` | `adminRoutes.ts:855` | yes | — (GET) | global | `ADMIN` | `withRLSContext(null, isAdmin:true)` | `schemas.admin.auditLogQuery` (query) | inline handler (`adminRoutes.ts:858-932`) | `blockDemoAdminAccess` | yes (`VIEW` meta-audit) |
| POST | `/api/v1/upload/lab-report` | `uploadRoutes.ts:77` | yes | exempt (`/upload/lab-report`) | `uploadLimiter` + `aiLimiter` | plan: `pdfUploadsPerMonth` | `withRLSTransaction` | multer file | `upload/labUploadController.uploadLabReport:36` | `blockDemoAI` | yes (`PARSE_FAILED` + biomarker create) |
| POST | `/api/v1/upload/insurance-sbc` | `uploadRoutes.ts:94` | yes | exempt (`/upload/insurance-sbc`) | `uploadLimiter` + `aiLimiter` | plan: `pdfUploadsPerMonth` | `withRLSTransaction` | multer file | `upload/sbcUploadController.uploadSBC:33` | `blockDemoAI` | yes (`PARSE_FAILED` + plan create) |
| POST | `/api/v1/upload/lab-results-ocr` | `uploadRoutes.ts:124` | yes | exempt (`/upload/lab-results-ocr`) | `uploadLimiter` + `aiLimiter` | plan: `pdfUploadsPerMonth` | `withRLSTransaction` | multer file (PDF + image) | `upload/labUploadController.uploadLabResultOCR:191` | `blockDemoAI` | yes (`OCR_PARSE_FAILED` + biomarker create) |
| GET | `/api/v1/files/` | `fileRoutes.ts:45` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.pagination` (query) | `fileController.getFiles:43` | — | yes (`LIST`) |
| GET | `/api/v1/files/:id` | `fileRoutes.ts:52` | yes | — (GET) | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `fileController.getFile:126` | — | yes |
| GET | `/api/v1/files/:id/download` | `fileRoutes.ts:59` | yes | — (GET) | `sensitiveLimiter` | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `fileController.getFileDownloadUrl:211` | — | yes |
| DELETE | `/api/v1/files/:id` | `fileRoutes.ts:67` | yes | global | global | — | `withRLSTransaction` | `schemas.uuidParam` (params) | `fileController.deleteFile:299` | — | yes |
| GET | `/api/v1/settings/profile` | `settingsRoutes.ts:34` | yes | — (GET) | `sensitiveLimiter` | — | `withRLSContext` | — | `settingsController.getProfile:911` | — | yes (`PHI_ACCESS`) |
| PATCH | `/api/v1/settings/profile` | `settingsRoutes.ts:41` | yes | global | `sensitiveLimiter` | — | `withRLSContext` | `schemas.settings.updateProfile` | `settingsController.updateProfile:969` | `blockDemoProfileUpdate` | yes |
| GET | `/api/v1/settings/notifications` | `settingsRoutes.ts:50` | yes | — (GET) | `sensitiveLimiter` | — | `withRLSContext` | — | `settingsController.getNotifications:1041` | — | yes |
| PATCH | `/api/v1/settings/notifications` | `settingsRoutes.ts:57` | yes | global | `sensitiveLimiter` | — | `withRLSContext` | `schemas.settings.updateNotifications` | `settingsController.updateNotifications:1073` | `blockDemoProfileUpdate` | yes |
| GET | `/api/v1/settings/health-profile` | `settingsRoutes.ts:66` | yes | — (GET) | `sensitiveLimiter` | — | `withRLSContext` | — | `settingsController.getHealthProfile:1149` | — | yes (`PHI_ACCESS`) |
| PATCH | `/api/v1/settings/health-profile` | `settingsRoutes.ts:76` | yes | global | `sensitiveLimiter` | plan: `healthProfile` | `withRLSContext` | `schemas.settings.updateHealthProfile` | `settingsController.updateHealthProfile:1179` | `blockDemoProfileUpdate` | yes |
| GET | `/api/v1/settings/export-data` | `settingsRoutes.ts:86` | yes | — (GET) | `sensitiveLimiter` | — | `withRLSContext` | — | `settingsController.exportUserData:306` | — | yes (`EXPORT`) |
| DELETE | `/api/v1/settings/delete-data` | `settingsRoutes.ts:93` | yes | global | `sensitiveLimiter` | — | `withRLSTransaction` | `schemas.settings.deleteData` | `settingsController.deleteAllData:675` | — | yes |
| DELETE | `/api/v1/settings/delete-account` | `settingsRoutes.ts:101` | yes | global | `sensitiveLimiter` | — | `withRLSContext` (user+null) | — | `settingsController.deleteAccount:816` | — | yes |
| POST | `/api/v1/ai/chat` | `aiRoutes.ts:28` | `requireBearerAuth` | exempt (`/ai/chat`) | `aiLimiter` | plan: `aiChatsPerDay` | `withRLSContext` (within service) | `schemas.ai.chat` | `aiChatController.handleAIChat:123` | `blockDemoAI` | yes (`CHAT`, `CHAT_BLOCKED_NO_BAA`, `CHAT_FAILED`) |
| GET | `/api/v1/fhir/callback` | `fhirRoutes.ts:22` | public (OAuth redirect) | — (GET) | global | — | via service | — | `fhirController.handleCallback:76` | — | yes |
| GET | `/api/v1/fhir/connect/quest` | `fhirRoutes.ts:28` | yes | — (GET) | `sensitiveLimiter` | — | via service | — | `fhirController.initiateQuestConnect:38` | `blockDemoAI` | yes |
| GET | `/api/v1/fhir/connections` | `fhirRoutes.ts:36` | yes | — (GET) | global | — | `withRLSContext(userId)` | — | `fhirController.listConnections:113` | — | yes |
| POST | `/api/v1/fhir/sync/:connectionId` | `fhirRoutes.ts:39` | yes | explicit `csrfProtection` + global | `sensitiveLimiter` | — | `withRLSContext(userId)` | — | `fhirController.triggerSync:145` | `blockDemoAI` | yes |
| DELETE | `/api/v1/fhir/connections/:id` | `fhirRoutes.ts:48` | yes | explicit `csrfProtection` + global | `sensitiveLimiter` | — | via service | — | `fhirController.deleteConnection:183` | `blockDemoAI` | yes |
| GET | `/api/v1/plan/available` | `planRoutes.ts:32` | public | — (GET) | global | — | — | — | inline handler (`planRoutes.ts:34-46`) | — | — |
| GET | `/api/v1/plan/` | `planRoutes.ts:52` | yes | — (GET) | global | — | `withRLSContext(userId)` | — | inline handler (`planRoutes.ts:55-91`) | — | — |
| GET | `/api/v1/onboarding/status` | `onboardingRoutes.ts:22` | yes | — (GET) | global | — | via service | — | `onboardingService.getOnboardingStatus` (called from `onboardingRoutes.ts:26`) | — | — |
| POST | `/api/v1/onboarding/complete` | `onboardingRoutes.ts:32` | yes | global | global | — | via service | — | `onboardingService.completeOnboarding` (called from `onboardingRoutes.ts:36`) | — | — |

---

## Per-route-group deep dives

### `authRoutes.ts` (`backend/src/routes/authRoutes.ts`)

**Base mount**: `/api/v1/auth` — `backend/src/routes/index.ts:82`.

Annotated source (chain definition):

```ts
// Source: backend/src/routes/authRoutes.ts:L32-L111
router.use(authLimiter);                                            // L32 — all auth routes
router.post('/register',           validate(schemas.auth.register),         asyncHandler(register));
router.post('/login',              strictAuthLimiter, validate(schemas.auth.login), asyncHandler(login));
router.post('/refresh',            asyncHandler(refreshToken));
router.post('/demo',               asyncHandler(demoLogin));
router.get ('/verify-email',       validate(schemas.auth.verifyEmailQuery, 'query'), asyncHandler(verifyEmail));
router.post('/resend-verification', strictAuthLimiter, validate(schemas.auth.resendVerification), asyncHandler(resendVerification));
router.post('/forgot-password',    strictAuthLimiter, validate(schemas.auth.forgotPassword),     asyncHandler(forgotPassword));
router.post('/reset-password',     strictAuthLimiter, validate(schemas.auth.resetPassword),      asyncHandler(resetPasswordHandler));
router.post('/logout',             authenticate, asyncHandler(logout));
router.post('/logout-all',         authenticate, asyncHandler(logoutAll));
router.get ('/me',                 authenticate, asyncHandler(getCurrentUser));
router.post('/change-password',    authenticate, validate(schemas.auth.changePassword), asyncHandler(changePassword));
```

Notable:
- `router.use(authLimiter)` (`authRoutes.ts:32`) attaches `authLimiter` (20/15-min window, `middleware/rateLimiter.ts:35`) to every route in this router.
- `/login`, `/resend-verification`, `/forgot-password`, `/reset-password` stack **both** `authLimiter` and `strictAuthLimiter` (5/15-min window keyed on `email:ip`, `rateLimiter.ts:50`).
- `/register`, `/login`, `/refresh`, `/demo`, `/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification` are in the CSRF exemption list (`middleware/csrf.ts:98-108`).
- `/logout`, `/logout-all`, `/me`, `/change-password` require `authenticate` and are CSRF-validated by the global chain (for POST variants).

### `biomarkerRoutes.ts` (`backend/src/routes/biomarkerRoutes.ts`)

**Base mount**: `/api/v1/biomarkers` — `backend/src/routes/index.ts:83`.

```ts
// Source: backend/src/routes/biomarkerRoutes.ts:L42-L122
router.use(authenticate);                                                            // L45
router.get   ('/',              validate(schemas.biomarker.listQuery, 'query'), ...);
router.get   ('/summary',       ...);
router.get   ('/categories',    ...);
router.get   ('/:id',           validate(schemas.uuidParam, 'params'), ...);
router.get   ('/:id/history',   validate(schemas.uuidParam, 'params'), ...);
router.post  ('/',              validate(schemas.biomarker.create), ...);
router.post  ('/batch',         bulkOperationLimiter, validate(schemas.biomarker.batchCreate), ...);
router.patch ('/:id',           validate(schemas.uuidParam, 'params'), validate(schemas.biomarker.update), ...);
router.delete('/:id',           validate(schemas.uuidParam, 'params'), ...);
router.post  ('/:id/guidance',  aiLimiter, blockDemoAI, requirePlanLimit('aiGuidancePerDay'),
                                validate(schemas.uuidParam, 'params'), asyncHandler(...));
```

Notable:
- `router.use(authenticate)` at `biomarkerRoutes.ts:45` — every route authenticated.
- `/batch` swaps the global limiter for `bulkOperationLimiter` (30/hour, `rateLimiter.ts:121`).
- `/:id/guidance` is the only route here that calls `aiLimiter` (10/hour per-user, `rateLimiter.ts:102`), `blockDemoAI` (`demoProtection.ts:164`), and `requirePlanLimit('aiGuidancePerDay')` (`planGating.ts:37`). Its inline handler wraps the DB lookup in `withRLSTransaction(userId, ...)` (`biomarkerRoutes.ts:157`) and refuses before any DB decryption or Claude call if `!config.anthropic.baaActive` (`biomarkerRoutes.ts:134`).
- Audit events (from `biomarkerController`): `LIST` (`:161`), `READ` (`:215`), `CREATE` (`:273`), `UPDATE` (`:363`), `DELETE` (`:409`), `CATEGORIES` (`:443`), `CREATE` BULK (`:593`), `SUMMARY` (`:716`), `HISTORY` (`:820`). Guidance handler emits `PHI_ACCESS` (`:271`), `GUIDANCE_BLOCKED_NO_BAA` (`biomarkerRoutes.ts:138`), `GUIDANCE_NOT_FOUND` (`:171`).

### `insuranceRoutes.ts` (`backend/src/routes/insuranceRoutes.ts`)

**Base mount**: `/api/v1/insurance` — `backend/src/routes/index.ts:84`.

```ts
// Source: backend/src/routes/insuranceRoutes.ts:L62-L141
router.use(authenticate);                                                             // L62
router.get   ('/plans',                  ...);
router.get   ('/plans/:id',              validate(schemas.uuidParam, 'params'), ...);
router.post  ('/plans',                  validate(schemas.insurancePlan.create), ...);
router.patch ('/plans/:id',              validate(schemas.uuidParam) + validate(schemas.insurancePlan.update), ...);
router.delete('/plans/:id',              validate(schemas.uuidParam, 'params'), ...);
router.post  ('/compare',                validate(compareSchema), ...);                 // local schema L52
router.get   ('/benefits/search',        validate(benefitSearchSchema, 'query'), ...);  // local schema L56
router.put   ('/plans/:id/reanalyze',    validate(schemas.uuidParam, 'params'), blockDemoAI,
                                         uploadLimiter, aiLimiter, upload.single('file'), ...);
router.post  ('/upload-sbc',             blockDemoAI, uploadLimiter, aiLimiter, upload.single('file'), ...);
router.put   ('/plans/:id/spending',     validate(schemas.uuidParam, 'params'), ...);
```

Notable:
- `POST /upload-sbc` is in the CSRF exemption list (`csrf.ts:117-122`) — it duplicates `/api/v1/upload/insurance-sbc` and is still exempted because the upload client sends multipart bodies.
- `/reanalyze` and `/upload-sbc` stack `uploadLimiter` (20/hour, `rateLimiter.ts:72`) and `aiLimiter` on the same request — both cost a slot.
- Local schemas `compareSchema` (`insuranceRoutes.ts:52`) and `benefitSearchSchema` (`insuranceRoutes.ts:56`) are defined in the route file rather than `middleware/validation.ts`.

### `expenseRoutes.ts` (`backend/src/routes/expenseRoutes.ts`)

**Base mount**: `/api/v1/expenses` — `backend/src/routes/index.ts:85`.

```ts
// Source: backend/src/routes/expenseRoutes.ts:L28-L123
router.use(authenticate);                                                  // L30
router.get   ('/projections',       validate(schemas.expense.projectionsQuery, 'query'), ...);
router.post  ('/projections',       csrfProtection, validate(schemas.expense.createProjection), ...);
router.put   ('/projections/:id',   csrfProtection, validate(schemas.uuidParam) + validate(schemas.expense.updateProjection), ...);
router.delete('/projections/:id',   csrfProtection, validate(schemas.uuidParam, 'params'), ...);
router.get   ('/actuals',           validate(schemas.expense.actualsQuery, 'query'), ...);
router.post  ('/actuals',           csrfProtection, validate(schemas.expense.createActual), ...);
router.put   ('/actuals/:id',       csrfProtection, validate(schemas.uuidParam) + validate(schemas.expense.updateActual), ...);
router.delete('/actuals/:id',       csrfProtection, validate(schemas.uuidParam, 'params'), ...);
router.post  ('/analyze',           aiLimiter, blockDemoAI, csrfProtection, validate(schemas.expense.analyzeCosts), ...);
router.get   ('/analyses',          validate(schemas.expense.analysesQuery, 'query'), ...);
```

Notable:
- Every mutation route re-applies `csrfProtection` explicitly, **in addition to** the global chain. This is belt-and-suspenders — the global `csrfProtection` in `app.ts:212` already covers them. (See Drift findings.)
- `/analyze` also stacks `aiLimiter` and `blockDemoAI`. Emits `ANALYZE` or `ANALYZE_BLOCKED_NO_BAA` audit events (`expenseController.ts:635`, `:715`).

### `healthNeedsRoutes.ts` (`backend/src/routes/healthNeedsRoutes.ts`)

**Base mount**: `/api/v1/health-needs` — `backend/src/routes/index.ts:86`.

```ts
// Source: backend/src/routes/healthNeedsRoutes.ts:L35-L78
router.use(authenticate);
router.get   ('/',            validate(schemas.healthNeed.listQuery, 'query'), ...);
router.get   ('/analyze',     aiLimiter, ...);
router.get   ('/:id',         validate(schemas.uuidParam, 'params'), ...);
router.post  ('/',            validate(schemas.healthNeed.create), ...);
router.patch ('/:id',         validate(schemas.uuidParam) + validate(schemas.healthNeed.update), ...);
router.delete('/:id',         validate(schemas.uuidParam, 'params'), ...);
```

Notable:
- `/analyze` is a GET with `aiLimiter` but no `blockDemoAI` — a demo user CAN fire analysis (which calls Claude). See Drift findings.
- The PATCH handler is `updateHealthNeedStatus` (`healthNeedsController.ts:293`), not the `updateHealthNeed` function (`:231`); the latter is an unmounted export.

### `healthGoalsRoutes.ts` (`backend/src/routes/healthGoalsRoutes.ts`)

**Base mount**: `/api/v1/health-goals` — `backend/src/routes/index.ts:87`.

```ts
// Source: backend/src/routes/healthGoalsRoutes.ts:L39-L93
router.use(authenticate);
router.get   ('/summary',          ...);
router.get   ('/suggestions',      aiLimiter, ...);
router.get   ('/',                 validate(schemas.healthGoal.listQuery, 'query'), ...);
router.get   ('/:id',              validate(schemas.uuidParam, 'params'), ...);
router.post  ('/',                 validate(schemas.healthGoal.create), ...);
router.put   ('/:id',              validate(schemas.uuidParam) + validate(schemas.healthGoal.update), ...);
router.patch ('/:id/progress',     validate(schemas.uuidParam) + validate(schemas.healthGoal.updateProgress), ...);
router.delete('/:id',              validate(schemas.uuidParam, 'params'), ...);
```

Notable:
- `/suggestions` fires Claude for AI goal suggestions but has no `blockDemoAI`. See Drift findings.
- `PUT /:id` vs `PATCH /:id/progress` — the main goal payload uses PUT (full replace) while progress uses PATCH (partial).

### `providerRoutes.ts` (`backend/src/routes/providerRoutes.ts`)

**Base mount**: `/api/v1/provider` — `backend/src/routes/index.ts:90`.

```ts
// Source: backend/src/routes/providerRoutes.ts:L21-L25
router.use(authenticate);
router.use(requireRole('PROVIDER', 'ADMIN'));
```

Routes:

| Route | Middleware chain | RLS wrap | Audit event |
|---|---|---|---|
| `GET /patients` (`:31`) | auth, `requireRole('PROVIDER','ADMIN')` | `withRLSContext(null, isAdmin:true)` | `LIST` |
| `POST /patients/request` (`:112`) | auth, RBAC, `validate(schemas.providerPatient.request)` | `withRLSContext(null, isAdmin:true)` + `withRLSContext(providerId)` | `REQUEST_ACCESS` |
| `GET /patients/:patientId` (`:241`) | auth, RBAC, `validate(schemas.patientIdParam)` | `withRLSContext(null, isAdmin:true)` | `VIEW_PATIENT` |
| `GET /patients/:patientId/biomarkers` (`:366`) | auth, RBAC, `validate(schemas.patientIdParam)` | `withRLSContext(null, isAdmin:true)` | `PHI_ACCESS` |
| `GET /patients/:patientId/health-needs` (`:510`) | auth, RBAC, `validate(schemas.patientIdParam)` | `withRLSContext(null, isAdmin:true)` | `PHI_ACCESS` |
| `DELETE /patients/:patientId` (`:641`) | auth, RBAC, `validate(schemas.patientIdParam)` | `withRLSContext(providerId)` | `DELETE` |

### `patientRoutes.ts` (`backend/src/routes/patientRoutes.ts`)

**Base mount**: `/api/v1/patient` — `backend/src/routes/index.ts:91`.

```ts
// Source: backend/src/routes/patientRoutes.ts:L21-L24
router.use(authenticate);
router.use(requireRole('PATIENT'));
```

All routes require authenticated `PATIENT` role; inline handlers wrap DB writes in `withRLSContext(patientId, ...)`. Audit events: `LIST`, `CONSENT_GRANTED`, `CONSENT_DENIED`, `PERMISSIONS_UPDATED`, `CONSENT_REVOKED`, `RELATIONSHIP_DELETED`.

### `settingsRoutes.ts` (`backend/src/routes/settingsRoutes.ts`)

**Base mount**: `/api/v1/settings` — `backend/src/routes/index.ts:101`.

```ts
// Source: backend/src/routes/settingsRoutes.ts:L28-L106
router.use(authenticate);
router.get   ('/profile',         sensitiveLimiter, ...);
router.patch ('/profile',         sensitiveLimiter, blockDemoProfileUpdate, validate(schemas.settings.updateProfile), ...);
router.get   ('/notifications',   sensitiveLimiter, ...);
router.patch ('/notifications',   sensitiveLimiter, blockDemoProfileUpdate, validate(schemas.settings.updateNotifications), ...);
router.get   ('/health-profile',  sensitiveLimiter, ...);
router.patch ('/health-profile',  sensitiveLimiter, blockDemoProfileUpdate, requirePlanFeature('healthProfile'),
                                  validate(schemas.settings.updateHealthProfile), ...);
router.get   ('/export-data',     sensitiveLimiter, ...);
router.delete('/delete-data',     sensitiveLimiter, validate(schemas.settings.deleteData), ...);
router.delete('/delete-account',  sensitiveLimiter, ...);
```

Notable:
- Every route swaps the global `standardLimiter` for `sensitiveLimiter` (10/hour, `rateLimiter.ts:87`).
- `PATCH /health-profile` is the only route gated behind a plan feature (`requirePlanFeature('healthProfile')`, `planGating.ts:115`). FREE users can still GET.
- `DELETE /delete-account` drops all PHI and deletes the account — `settingsController.deleteAccount:816` uses `withRLSContext(null, ...)` (`settingsController.ts:894`) for the final `user.delete` to cascade across tables the user no longer "owns" post-deletion.

### `adminRoutes.ts` (`backend/src/routes/adminRoutes.ts`)

**Base mount**: `/api/v1/admin` — `backend/src/routes/index.ts:92`.

```ts
// Source: backend/src/routes/adminRoutes.ts:L26-L31
router.use(authenticate);
router.use(blockDemoAdminAccess);   // L30 — demo account 403'd before RBAC runs
router.use(requireRole('ADMIN'));   // L31
```

Every admin route has this three-layer prelude. `blockDemoAdminAccess` (`demoProtection.ts:67`) ensures a demo user with a hypothetically-escalated role can't slip past the ADMIN gate. Every DB read/write uses `withRLSContext(null, isAdmin: true)` (11 call sites across `adminRoutes.ts`). `DELETE /users/:id/permanent` (`adminRoutes.ts:450`) additionally adds `sensitiveLimiter`.

### `uploadRoutes.ts` (`backend/src/routes/uploadRoutes.ts`)

**Base mount**: `/api/v1/upload` — `backend/src/routes/index.ts:95`.

```ts
// Source: backend/src/routes/uploadRoutes.ts:L22-L132
router.use(uploadLimiter);                                                  // L26
router.post('/lab-report',       authenticate, aiLimiter, blockDemoAI,
            requirePlanLimit('pdfUploadsPerMonth'), upload.single('file'), ...);
router.post('/insurance-sbc',    authenticate, aiLimiter, blockDemoAI,
            requirePlanLimit('pdfUploadsPerMonth'), upload.single('file'), ...);
router.post('/lab-results-ocr',  authenticate, aiLimiter, blockDemoAI,
            requirePlanLimit('pdfUploadsPerMonth'), uploadOCR.single('file'), ...);
```

Notable:
- All three routes are on the CSRF exemption list (`middleware/csrf.ts:117-122`). The TODO in that file acknowledges the `uploadUtils.ts` client does in fact attach `x-csrf-token`; the exemption is defensive against callers that don't.
- `uploadLimiter` (20/hour, `rateLimiter.ts:72`) is attached to the router level; `aiLimiter` stacks on top of each route.

### `fileRoutes.ts` (`backend/src/routes/fileRoutes.ts`)

**Base mount**: `/api/v1/files` — `backend/src/routes/index.ts:98`.

```ts
// Source: backend/src/routes/fileRoutes.ts:L42-L71
router.use(authenticate);
router.get   ('/',             validate(schemas.pagination, 'query'), ...);
router.get   ('/:id',          validate(schemas.uuidParam, 'params'), ...);
router.get   ('/:id/download', sensitiveLimiter, validate(schemas.uuidParam, 'params'), ...);
router.delete('/:id',          validate(schemas.uuidParam, 'params'), ...);
```

Notable — the file comment (`fileRoutes.ts:27-41`) explains the defense-in-depth model: (1) every controller scopes `findFirst` by `{ id, userId }`; (2) the `user_files` RLS policy filters by `user_id = current_user_id()`. The controller uses `withRLSTransaction(userId, ...)` (`fileController.ts:58, 135, 220, 309, 343`).

### `fhirRoutes.ts` (`backend/src/routes/fhirRoutes.ts`)

**Base mount**: `/api/v1/fhir` — `backend/src/routes/index.ts:107`.

```ts
// Source: backend/src/routes/fhirRoutes.ts:L13-L54
router.get('/callback', asyncHandler(fhir.handleCallback));                 // L22 — PUBLIC (OAuth redirect)
router.use(authenticate);                                                   // L25
router.get   ('/connect/quest',        sensitiveLimiter, blockDemoAI, ...);
router.get   ('/connections',          ...);
router.post  ('/sync/:connectionId',   sensitiveLimiter, blockDemoAI, csrfProtection, ...);
router.delete('/connections/:id',      sensitiveLimiter, blockDemoAI, csrfProtection, ...);
```

Notable:
- `/callback` is **intentionally unauthenticated** — OAuth providers redirect the browser here. PKCE + 24-byte state token (see `fhirRoutes.ts:15-21` comment) bind the callback to a user.
- POST/DELETE explicitly re-apply `csrfProtection` (redundant with the global chain) — belt-and-suspenders.

### `aiRoutes.ts` (`backend/src/routes/aiRoutes.ts`)

**Base mount**: `/api/v1/ai` — `backend/src/routes/index.ts:104`.

```ts
// Source: backend/src/routes/aiRoutes.ts:L14-L35
router.use(requireBearerAuth);                                              // L20 — Bearer-only
router.post('/chat',
  aiLimiter, blockDemoAI, requirePlanLimit('aiChatsPerDay'),
  validate(schemas.ai.chat),
  asyncHandler(handleAIChat));
```

Notable:
- `requireBearerAuth` (`middleware/auth.ts:166`), not `authenticate`. The route file's comment (`aiRoutes.ts:16-19`) explains why: `/ai/chat` is in the CSRF exemption list (`csrf.ts:130-132`) because SSE can't carry `x-csrf-token`; if the route accepted the cookie path, a cross-site POST would pass auth AND bypass CSRF. Bearer-only closes that shape.
- Controller `aiChatController.handleAIChat:123` emits `CHAT`, `CHAT_BLOCKED_NO_BAA`, and `CHAT_FAILED` audit events (`:136, :263, :292`).

### `planRoutes.ts` (`backend/src/routes/planRoutes.ts`)

**Base mount**: `/api/v1/plan` — `backend/src/routes/index.ts:110`.

```ts
// Source: backend/src/routes/planRoutes.ts:L27-L92
router.get('/available', asyncHandler(...));           // L32 — public
router.get('/',          authenticate, asyncHandler(...)); // L52-54 — auth per-route, no router.use
```

Notable:
- `GET /available` is **public** by design (pricing page). `GET /` reads plan + usage from DB via `withRLSContext(userId, ...)` (`planRoutes.ts:65`).
- No audit event — read-only pricing/plan-introspection.

### `onboardingRoutes.ts` (`backend/src/routes/onboardingRoutes.ts`)

**Base mount**: `/api/v1/onboarding` — `backend/src/routes/index.ts:113`.

```ts
// Source: backend/src/routes/onboardingRoutes.ts:L18-L43
router.use(authenticate);
router.get ('/status',   asyncHandler(...));
router.post('/complete', asyncHandler(...));
```

Handlers delegate to `onboardingService.getOnboardingStatus` / `completeOnboarding` (imported at `onboardingRoutes.ts:15`). No audit log at the route layer.

---

## Middleware cross-reference

| Middleware | File:line | Used by (non-exhaustive citations) |
|---|---|---|
| `authenticate` | `middleware/auth.ts:70` | `authRoutes.ts:97,100,103,106`; `biomarkerRoutes.ts:45` (router-wide); `insuranceRoutes.ts:62` (router-wide); `expenseRoutes.ts:30` (router-wide); `healthNeedsRoutes.ts:38`; `healthGoalsRoutes.ts:42`; `providerRoutes.ts:24`; `patientRoutes.ts:22`; `settingsRoutes.ts:31`; `adminRoutes.ts:29`; `fileRoutes.ts:42`; `onboardingRoutes.ts:20`; `fhirRoutes.ts:25` (post-callback); `planRoutes.ts:54`; `uploadRoutes.ts:79,96,126` |
| `requireBearerAuth` | `middleware/auth.ts:166` | `aiRoutes.ts:20` (router-wide) |
| `optionalAuth` | `middleware/auth.ts:117` | (exported but not used by any route) |
| `csrfProtection` | `middleware/csrf.ts:186` | Global: `app.ts:212`. Per-route (redundant): `expenseRoutes.ts:46,54,63,82,90,99,113`; `fhirRoutes.ts:43,52` |
| `ensureCsrfToken` | `middleware/csrf.ts:66` | (exported; `csrfProtection` delegates to `setCsrfCookie` directly) |
| `validateCsrfToken` | `middleware/csrf.ts:86` | Invoked inside `csrfProtection` (`csrf.ts:198`) |
| `requireRole(...)` | `middleware/rbac.ts:61` | `providerRoutes.ts:25` (`'PROVIDER','ADMIN'`); `patientRoutes.ts:24` (`'PATIENT'`); `adminRoutes.ts:31` (`'ADMIN'`) |
| `requireMinRole` | `middleware/rbac.ts:80` | (exported; no current consumers) |
| `requirePermission` | `middleware/rbac.ts:101` | (exported; no current consumers) |
| `requireResourceAccess` | `middleware/rbac.ts:124` | (exported; no current consumers) |
| `requireOwnership` | `middleware/rbac.ts:264` | (exported; no current consumers) |
| `enforceUserScope` | `middleware/rbac.ts:328` | (exported; no current consumers) |
| `adminOnly` / `providerOrAdmin` | `middleware/rbac.ts:366,373` | (exported; current admin/provider routers use `requireRole` directly) |
| `standardLimiter` | `middleware/rateLimiter.ts:16` | Global (`app.ts:216`); explicit on `/api/health/db` (`app.ts:292`) |
| `authLimiter` | `middleware/rateLimiter.ts:35` | `authRoutes.ts:32` (router-wide) |
| `strictAuthLimiter` | `middleware/rateLimiter.ts:50` | `authRoutes.ts:48,71,79,87` |
| `uploadLimiter` | `middleware/rateLimiter.ts:72` | `uploadRoutes.ts:26` (router-wide); `insuranceRoutes.ts:119,130` |
| `sensitiveLimiter` | `middleware/rateLimiter.ts:87` | `fileRoutes.ts:61`; `settingsRoutes.ts:36,43,52,59,68,78,88,95,103`; `adminRoutes.ts:452`; `fhirRoutes.ts:30,42,50` |
| `aiLimiter` | `middleware/rateLimiter.ts:102` | `biomarkerRoutes.ts:120`; `healthNeedsRoutes.ts:48`; `healthGoalsRoutes.ts:48`; `expenseRoutes.ts:111`; `insuranceRoutes.ts:120,131`; `uploadRoutes.ts:80,97,127`; `aiRoutes.ts:30` |
| `bulkOperationLimiter` | `middleware/rateLimiter.ts:121` | `biomarkerRoutes.ts:91` |
| `validate(schema, 'body' \| 'query' \| 'params')` | `middleware/validation.ts:148` | 43 call sites across `routes/*` (see Validation schema map) |
| `requireJsonContentType` | `middleware/validation.ts:190` | Global (`app.ts:230`) |
| `blockDemoAI` | `middleware/demoProtection.ts:164` | `biomarkerRoutes.ts:121`; `insuranceRoutes.ts:118,129`; `expenseRoutes.ts:112`; `uploadRoutes.ts:81,98,128`; `aiRoutes.ts:31`; `fhirRoutes.ts:31,43,51` |
| `blockDemoAdminAccess` | `middleware/demoProtection.ts:67` | `adminRoutes.ts:30` (router-wide) |
| `blockDemoProfileUpdate` | `middleware/demoProtection.ts:145` | `settingsRoutes.ts:44,60,79` |
| `blockDemoRoleChange` | `middleware/demoProtection.ts:43` | (exported; not currently mounted) |
| `blockDemoUserModification` | `middleware/demoProtection.ts:85` | (exported; `blockDemoAdminAccess` is the live guard on admin routes) |
| `demoProtection` | `middleware/demoProtection.ts:112` | (exported; not currently mounted) |
| `requirePlanLimit(key)` | `middleware/planGating.ts:37` | `biomarkerRoutes.ts:122` (`aiGuidancePerDay`); `uploadRoutes.ts:82,99,129` (`pdfUploadsPerMonth`); `aiRoutes.ts:32` (`aiChatsPerDay`) |
| `requirePlanFeature(feature)` | `middleware/planGating.ts:115` | `settingsRoutes.ts:80` (`healthProfile`) |
| `errorHandler` / `notFoundHandler` / `asyncHandler` | `middleware/errorHandler.ts:135, :204, :209` | Global error tail (`app.ts:301,304`); `asyncHandler` wraps every route handler |

---

## RLS wrap usage (controller-side)

Every controller that touches PHI wraps its Prisma calls in `withRLSContext(userId, ...)` or `withRLSTransaction(userId, ...)`. A grep of `backend/src/controllers/**` for `withRLS(Context|Transaction)\(` returns hits in: `biomarkerController`, `expenseController`, `fileController`, `fhirController`, `healthGoalsController`, `healthNeedsController`, `insuranceController`, `settingsController`, plus `upload/labUploadController`, `upload/sbcUploadController` (see mega-table rows for exact line numbers).

Admin-mode (`null, { isAdmin: true }`) call sites:

| Route group | Call site | Reason |
|---|---|---|
| `adminRoutes.ts` | 11 admin endpoints (`:61, :137, :211, :295, :391, :425, :475, :519, :560, :646, :689, :776, :878`) | Admins legitimately cross tenant boundaries; RBAC gate at `adminRoutes.ts:31` is the authorization. |
| `providerRoutes.ts` | 5 handlers (`:41, :127, :176, :254, :378, :521`) | Provider reads patient PHI only after application-level relationship/consent checks; admin context lets the relationship join return both sides. |
| `patientRoutes.ts` | `:49, :130` | Cross-tenant lookup of provider user display info. Same bounded-by-id-set reasoning. |
| `middleware/rbac.ts` | `:211, :296` (in `checkProviderPatientAccess` and `requireOwnership`) | Provider–patient relationship resolution at the RBAC layer. |
| `settingsController.ts:894` | `deleteAccount` final `user.delete` | Cascading delete after user-row deletion; user is no longer a valid RLS identity. |

No controller currently skips `withRLSContext` / `withRLSTransaction` for a PHI read — see Drift findings below for the auth-controller path (authService handles its own RLS context) and middleware bare-Prisma sites called out in `providerRoutes.ts:164` (`getUserEncryptionSalt`).

---

## CSRF exemption list

From `backend/src/middleware/csrf.ts:98-132`, three categories of exemption:

| Category | Routes | Why exempt | Safety | Authority |
|---|---|---|---|---|
| Public auth | `/auth/login`, `/auth/register`, `/auth/demo`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`, `/marketplace/plans/search` | No session to protect at request time (no cookie has been issued yet, or cookie is the refresh token being rotated) | `strictAuthLimiter` caps brute force; failed `/login` is not counted so attackers can't lock accounts by burning their own quota (`rateLimiter.ts:62`) | `csrf.ts:98-108` |
| File uploads | `/upload/lab-report`, `/upload/insurance-sbc`, `/upload/lab-results-ocr`, `/insurance/upload-sbc` | Multipart + XHR combo; `uploadUtils.ts` client does attach `x-csrf-token`, but the exemption is defensive | Each upload route still requires `authenticate`, magic-byte validation inside the controller, `uploadLimiter`, `aiLimiter`, `blockDemoAI` | `csrf.ts:117-122` (TODO to remove once clients confirmed) |
| Bearer-only SSE | `/ai/chat` | `EventSource` cannot attach custom headers; CSRF token can't ride along | Route is mounted with `requireBearerAuth` (`auth.ts:166`), **not** `authenticate`, so the cookie-auth path is rejected at the route layer. Prevents cross-site POST from passing auth + bypassing CSRF simultaneously | `csrf.ts:130-132` |

The exemption matcher uses `req.path.endsWith(route)` (`csrf.ts:134-144`). `DISABLE_CSRF=true` in development is honored at `csrf.ts:151-153`.

---

## Demo-blocked routes

| Route | Block middleware | File:line | Reason |
|---|---|---|---|
| `POST /biomarkers/:id/guidance` | `blockDemoAI` | `biomarkerRoutes.ts:121` | Preserve Anthropic quota for real users |
| `POST /expenses/analyze` | `blockDemoAI` | `expenseRoutes.ts:112` | Same |
| `POST /upload/lab-report` | `blockDemoAI` | `uploadRoutes.ts:81` | Same |
| `POST /upload/insurance-sbc` | `blockDemoAI` | `uploadRoutes.ts:98` | Same |
| `POST /upload/lab-results-ocr` | `blockDemoAI` | `uploadRoutes.ts:128` | Same |
| `PUT /insurance/plans/:id/reanalyze` | `blockDemoAI` | `insuranceRoutes.ts:118` | Same |
| `POST /insurance/upload-sbc` | `blockDemoAI` | `insuranceRoutes.ts:129` | Same |
| `POST /ai/chat` | `blockDemoAI` | `aiRoutes.ts:31` | Same |
| `GET /fhir/connect/quest` | `blockDemoAI` | `fhirRoutes.ts:31` | Prevent demo account from initiating real lab connections |
| `POST /fhir/sync/:connectionId` | `blockDemoAI` | `fhirRoutes.ts:43` | Same |
| `DELETE /fhir/connections/:id` | `blockDemoAI` | `fhirRoutes.ts:51` | Keep demo fixture state stable |
| `PATCH /settings/profile` | `blockDemoProfileUpdate` | `settingsRoutes.ts:44` | Keep demo state consistent across sessions |
| `PATCH /settings/notifications` | `blockDemoProfileUpdate` | `settingsRoutes.ts:60` | Same |
| `PATCH /settings/health-profile` | `blockDemoProfileUpdate` | `settingsRoutes.ts:79` | Same |
| Every `/admin/*` route | `blockDemoAdminAccess` (router-wide) | `adminRoutes.ts:30` | Defense-in-depth if demo user were ever role-elevated |

---

## Validation schema map

Schemas live in `backend/src/middleware/validation.ts:223-768` unless noted. `validate(schema, source)` is the factory at `middleware/validation.ts:148`.

| Schema | File:line | Validates |
|---|---|---|
| `schemas.auth.login` | `validation.ts:249` | `POST /auth/login` (`authRoutes.ts:49`) |
| `schemas.auth.register` | `validation.ts:254` | `POST /auth/register` (`authRoutes.ts:41`) |
| `schemas.auth.changePassword` | `validation.ts:261` | `POST /auth/change-password` (`authRoutes.ts:109`) |
| `schemas.auth.forgotPassword` | `validation.ts:266` | `POST /auth/forgot-password` (`authRoutes.ts:80`) |
| `schemas.auth.resetPassword` | `validation.ts:270` | `POST /auth/reset-password` (`authRoutes.ts:88`) |
| `schemas.auth.resendVerification` | `validation.ts:275` | `POST /auth/resend-verification` (`authRoutes.ts:72`) |
| `schemas.auth.verifyEmailQuery` | `validation.ts:279` | `GET /auth/verify-email` (`authRoutes.ts:62`) |
| `schemas.uuidParam` | `validation.ts:231` | Every `:id` route — biomarker, insurance, expense, health-goal, health-need, file, admin, provider-patient-approve/deny/etc. |
| `schemas.patientIdParam` | `validation.ts:236` | Provider routes with `:patientId` (`providerRoutes.ts:243,368,512,643`) |
| `schemas.userIdParam` | `validation.ts:241` | (exported; current admin routes use `uuidParam` instead) |
| `schemas.pagination` | `validation.ts:225` | `GET /files/` (`fileRoutes.ts:47`) |
| `schemas.biomarker.create` | `validation.ts:288` | `POST /biomarkers/` |
| `schemas.biomarker.update` | `validation.ts:306` | `PATCH /biomarkers/:id` |
| `schemas.biomarker.batchCreate` | `validation.ts:322` | `POST /biomarkers/batch` |
| `schemas.biomarker.listQuery` | `validation.ts:340` | `GET /biomarkers/` |
| `schemas.biomarker.guidance` | `validation.ts:346` | (exported; current `/guidance` route loads biomarker from DB instead) |
| `schemas.insurancePlan.create` | `validation.ts:368` | `POST /insurance/plans` |
| `schemas.insurancePlan.update` | `validation.ts:415` | `PATCH /insurance/plans/:id` |
| `compareSchema` (local) | `insuranceRoutes.ts:52` | `POST /insurance/compare` |
| `benefitSearchSchema` (local) | `insuranceRoutes.ts:56` | `GET /insurance/benefits/search` |
| `schemas.healthNeed.create` | `validation.ts:449` | `POST /health-needs/` |
| `schemas.healthNeed.update` | `validation.ts:459` | `PATCH /health-needs/:id` |
| `schemas.healthNeed.listQuery` | `validation.ts:469` | `GET /health-needs/` |
| `schemas.healthGoal.create` | `validation.ts:483` | `POST /health-goals/` |
| `schemas.healthGoal.update` | `validation.ts:501` | `PUT /health-goals/:id` |
| `schemas.healthGoal.updateProgress` | `validation.ts:517` | `PATCH /health-goals/:id/progress` |
| `schemas.healthGoal.listQuery` | `validation.ts:522` | `GET /health-goals/` |
| `schemas.providerPatient.request` | `validation.ts:535` | `POST /provider/patients/request` |
| `schemas.providerPatient.approve` | `validation.ts:541` | `POST /patient/providers/:id/approve` |
| `schemas.providerPatient.updatePermissions` | `validation.ts:550` | `PATCH /patient/providers/:id` |
| `schemas.expense.createProjection` | `validation.ts:563` | `POST /expenses/projections` |
| `schemas.expense.updateProjection` | `validation.ts:572` | `PUT /expenses/projections/:id` |
| `schemas.expense.analyzeCosts` | `validation.ts:580` | `POST /expenses/analyze` |
| `schemas.expense.projectionsQuery` | `validation.ts:584` | `GET /expenses/projections` |
| `schemas.expense.analysesQuery` | `validation.ts:590` | `GET /expenses/analyses` |
| `schemas.expense.createActual` | `validation.ts:595` | `POST /expenses/actuals` |
| `schemas.expense.updateActual` | `validation.ts:611` | `PUT /expenses/actuals/:id` |
| `schemas.expense.actualsQuery` | `validation.ts:626` | `GET /expenses/actuals` |
| `schemas.ai.chat` | `validation.ts:637` | `POST /ai/chat` |
| `schemas.settings.updateProfile` | `validation.ts:655` | `PATCH /settings/profile` |
| `schemas.settings.updateNotifications` | `validation.ts:663` | `PATCH /settings/notifications` |
| `schemas.settings.updateHealthProfile` | `validation.ts:689` | `PATCH /settings/health-profile` |
| `schemas.settings.deleteData` | `validation.ts:685` | `DELETE /settings/delete-data` |
| `schemas.admin.createUser` | `validation.ts:722` | `POST /admin/users` |
| `schemas.admin.updateUser` | `validation.ts:730` | `PATCH /admin/users/:id` |
| `schemas.admin.listUsersQuery` | `validation.ts:737` | `GET /admin/users` |
| `schemas.admin.auditLogQuery` | `validation.ts:745` | `GET /admin/audit-logs` |
| `schemas.admin.updateUserPlan` | `validation.ts:756` | `PATCH /admin/users/:id/plan` |
| `schemas.admin.permanentDelete` | `validation.ts:764` | `DELETE /admin/users/:id/permanent` |

---

## Drift / findings

Each item notes a route that deviates from the "expected stack" (authenticate → rate limiter → RBAC → validate → demo-block → RLS wrap → audit).

1. **`GET /health-needs/analyze` and `GET /health-goals/suggestions` fire Claude with no `blockDemoAI`.** `healthNeedsRoutes.ts:48`, `healthGoalsRoutes.ts:48`. Both stack `aiLimiter` only. A demo account can generate live AI analyses, burning Anthropic quota. Every other AI-calling route (guidance, expense analyze, chat, every upload, every FHIR mutation) blocks demo. This is a drift — either add `blockDemoAI` to these two, or mark them intentionally exempt in a comment. Cross-link: [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

2. **`expenseRoutes.ts` double-applies `csrfProtection`.** All 7 mutation routes call `csrfProtection` explicitly (`expenseRoutes.ts:46,54,63,82,90,99,113`) even though the global chain already runs it (`app.ts:212`). Harmless (idempotent), but confusing — either remove the per-route calls or document the belt-and-suspenders intent in the route file. Same pattern in `fhirRoutes.ts:43,52`.

3. **`POST /insurance/upload-sbc` is mounted twice.** Once at `insuranceRoutes.ts:127` and once at `uploadRoutes.ts:94` (`/api/v1/upload/insurance-sbc`). Both resolve to `upload/sbcUploadController.uploadSBC`. The CSRF exemption list contains both paths (`csrf.ts:118,121`). Callers should prefer the `/upload/*` path — it's the one with `requirePlanLimit('pdfUploadsPerMonth')`. The `/insurance/upload-sbc` variant has no plan gate.

4. **`GET /api/v1/onboarding/status` and `POST /api/v1/onboarding/complete` do not emit audit events at the route/handler layer.** `onboardingRoutes.ts:22,32` delegate to `onboardingService`; a grep for `auditLog.log` in `services/onboardingService.ts` would confirm whether the service layer logs (out of scope for this route-file review). Flag for cross-check.

5. **`planRoutes.ts` emits no audit events.** `GET /plan/available` is public and reads static data — arguably fine. `GET /plan/` reads the user's own plan + usage — also arguably fine as non-PHI introspection. Noted for completeness.

6. **`providerRoutes.ts` and `patientRoutes.ts` keep large inline handlers.** Unlike `biomarkerController`, these two route files contain ~500+ line handlers that do the RLS wrap + audit logic inline. This is fine (the handlers are correctly wrapped in `withRLSContext`), but makes them harder to reuse and test compared to extracted controllers. Not a security issue.

7. **`settingsController.deleteAccount` uses `withRLSContext(null, ...)` for the final `user.delete`.** `settingsController.ts:894`. Technically correct — the user row is the RLS identity, and deleting it from the user's own context would have to carry cascades across tables the policy may no longer evaluate cleanly. Flagged for awareness only.

8. **No route in the codebase uses `optionalAuth`, `requireMinRole`, `requirePermission`, `requireResourceAccess`, `requireOwnership`, `enforceUserScope`, `adminOnly`, `providerOrAdmin`, `blockDemoRoleChange`, `blockDemoUserModification`, or `demoProtection`.** These are all exported from `middleware/rbac.ts` and `middleware/demoProtection.ts` but have no consumers. Either wire them in or mark them deprecated.

9. **PHI routes without `authenticate`: none found.** Every route that exposes PHI (biomarker, insurance, expense, health-needs, health-goals, file, settings, provider-patient, admin-user, upload, fhir-sync) has either `authenticate` or `requireBearerAuth` at the router level or per-route. The only unauthenticated routes are the public `/health`, `/`, `/api/v1/health`, `/api/v1/`, `/api/v1/csrf-token`, `/api/v1/plan/available`, `/api/v1/auth/*` (by design), and `/api/v1/fhir/callback` (OAuth redirect, PKCE-bound). None of these return PHI.

---

## Acceptance questions (self-answered from this doc)

1. **Which middleware always runs before any route, in what order?** — See [Global middleware chain](#global-middleware-chain): trust proxy → helmet → cors → cookieParser → compression → csrfProtection → standardLimiter → morgan → express.json → express.urlencoded → requireJsonContentType → /api `Cache-Control: no-store` → routes. (`app.ts:119-243`.)
2. **What's the middleware chain for `POST /api/v1/biomarkers`?** — Global chain → `authenticate` (router.use at `biomarkerRoutes.ts:45`) → `standardLimiter` (global) → `csrfProtection` (global, validates because method is POST) → `validate(schemas.biomarker.create)` → `asyncHandler(biomarkerController.createBiomarker)` (`biomarkerController.ts:226`). RLS: `withRLSTransaction(userId, ...)`.
3. **Which rate limiter guards `POST /api/v1/biomarkers/:id/guidance` and what window?** — `aiLimiter` (`rateLimiter.ts:102`): 10 requests per 60-minute rolling window, keyed by `req.user.id` (falls back to IP). Plus the global `standardLimiter` still runs.
4. **Which routes are exempt from CSRF and why?** — See [CSRF exemption list](#csrf-exemption-list): public auth routes (no session to protect), upload routes (multipart; defensive exemption), and `POST /ai/chat` (SSE streaming — paired with `requireBearerAuth` to eliminate the cookie-auth path).
5. **Which routes are blocked for demo accounts?** — 15 routes, grouped as: AI-calling routes (9) under `blockDemoAI`, settings profile/notifications/health-profile mutations (3) under `blockDemoProfileUpdate`, and every admin route under router-wide `blockDemoAdminAccess`. See [Demo-blocked routes](#demo-blocked-routes).
6. **Which controller functions skip `withRLSContext` — and is any such skip a finding?** — No PHI-reading controller skips the wrap. Admin-context (`null, { isAdmin: true }`) is used in `adminRoutes.ts`, `providerRoutes.ts`, parts of `patientRoutes.ts` (cross-tenant display lookups), `middleware/rbac.ts`, and `settingsController.deleteAccount` — all documented with inline justification. The `onboardingRoutes` and `planRoutes` delegate to services; service-layer wrap posture is cross-linked to [`ARCHITECTURE.md`](./ARCHITECTURE.md). The only behavioral finding is item 1 of [Drift findings](#drift--findings): two AI GETs missing `blockDemoAI`, which is a demo-protection drift, not an RLS drift.
7. **What validation schema validates `POST /api/v1/insurance/plans`?** — `schemas.insurancePlan.create` (`middleware/validation.ts:368`), applied at `insuranceRoutes.ts:80`.
8. **Which routes require the `PROVIDER` role?** — Every route in `providerRoutes.ts` — `requireRole('PROVIDER','ADMIN')` at `providerRoutes.ts:25` (router-wide). Namely: `GET /provider/patients`, `POST /provider/patients/request`, `GET /provider/patients/:patientId`, `GET /provider/patients/:patientId/biomarkers`, `GET /provider/patients/:patientId/health-needs`, `DELETE /provider/patients/:patientId`.
9. **Which routes require the `ADMIN` role?** — Every route in `adminRoutes.ts` — `requireRole('ADMIN')` at `adminRoutes.ts:31` (router-wide). 11 endpoints listed in the mega-table.
10. **For `POST /api/v1/upload/lab-report`: what rate limiter, what auth, what demo gating, what audit event?** — `uploadLimiter` (router-wide at `uploadRoutes.ts:26`, 20/hour) **plus** `aiLimiter` per-route (`uploadRoutes.ts:80`, 10/hour per user). Auth via `authenticate` (`uploadRoutes.ts:79`). Demo gating via `blockDemoAI` (`uploadRoutes.ts:81`). Plan gate via `requirePlanLimit('pdfUploadsPerMonth')` (`uploadRoutes.ts:82`). Audit events emitted from `upload/labUploadController.uploadLabReport:36` — `PARSE_FAILED` on extraction failure (`:56`) and biomarker-create audit per inserted row inside `withRLSTransaction`.
11. **How many total endpoints exist?** — **108** total route-registered handlers: 6 app-level (`/`, `/health`, `/api/health/db`, `/api/v1/csrf-token`, `/api/v1/health`, `/api/v1/`) + 102 group-mounted endpoints across 16 routers. The core "API surface" (anything under `/api/v1/<group>/*` except health/csrf) is 100 endpoints.
12. **Which routes produce a `BIOMARKER_CREATE` audit event?** — The audit events emitted by `biomarkerController` use `RESOURCE_TYPE = 'Biomarker'` (`biomarkerController.ts:22`) combined with action types `CREATE` (`:273`) and `CREATE` with operation-flag `BULK` (`:593`). Mapped to routes: `POST /api/v1/biomarkers/` (`biomarkerRoutes.ts:81`, calls `createBiomarker`) and `POST /api/v1/biomarkers/batch` (`biomarkerRoutes.ts:89`, calls `bulkCreateBiomarkers`).

---

## Related Documents

- [API_REFERENCE.md](./API_REFERENCE.md) — contract-facing counterpart: request/response shapes, curl, error codes.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview, middleware stack diagram, service topology.
- [DATA_MODEL.md](./DATA_MODEL.md) — Prisma schema and the RLS policies each `withRLSContext` wrap relies on.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — per-PHI-field encryption / audit / redaction matrix.
- [ERROR_RECOVERY.md](./ERROR_RECOVERY.md) — what each middleware produces on failure (401 / 403 / 429 / 422 / 503).
- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — open findings, including the drift items above and the runtime-role / BYPASSRLS finding tracked in project memory.

---

## Prompt drift log

- `./34-routing-table-doc.md` expects ~70 endpoints; actual count is **108** (see mega-table). The "Verified codebase counts" table in `00-index.md` — if it exists — should be updated to 16 route files (not 13 as `CLAUDE.md:94` states) and 108 endpoints.
- `./34-routing-table-doc.md` and `CLAUDE.md:87` say `backend/src/middleware/` contains 8 files; actual count (excluding tests and `index.ts` barrel) is 8: `auth.ts`, `csrf.ts`, `demoProtection.ts`, `errorHandler.ts`, `planGating.ts`, `rateLimiter.ts`, `rbac.ts`, `validation.ts`. ✓
- `CLAUDE.md:94` says "13 files, 60+ endpoints"; actual routes directory has **16 route files** and **108 endpoints**. Update `CLAUDE.md` on next refresh.
- `CLAUDE.md:77` says `controllers/` has 10 files; actual count is 9 top-level TS files (`aiChatController`, `authController`, `biomarkerController`, `expenseController`, `fhirController`, `fileController`, `healthGoalsController`, `healthNeedsController`, `insuranceController`, `settingsController`) plus a `controllers/upload/` subdirectory with 3 files (`labUploadController`, `sbcUploadController`, `shared`). Close enough to the prompt's "10 files" claim.
- The prompt example mentions `biomarkerController.list:L22`; the actual exported function is `getBiomarkers` at `biomarkerController.ts:111` (`biomarkerController.getBiomarker` singular is at `:192`). Prompts should use the literal name.
- The prompt lists a `ENV_VARS.md` cross-link in the shared boilerplate (`_doc-quality.md:178`); it was trimmed from the Related Documents list here because the routing doc doesn't cite env vars except in global-chain context (where `app.ts` lines suffice).
