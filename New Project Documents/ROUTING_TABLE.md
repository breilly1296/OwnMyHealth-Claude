# ROUTING_TABLE.md

> Security-stack-facing companion to [`API_REFERENCE.md`](./API_REFERENCE.md).
> Generated 2026-06-01 from the live `backend/src/` tree. Every row cites `file:line`.

## Purpose + how to read

This document is the **middleware-facing** map of every HTTP endpoint in the OwnMyHealth backend. Where [`API_REFERENCE.md`](./API_REFERENCE.md) answers "how do I call this endpoint?" (request body, response JSON, curl), this doc answers "**what guards this endpoint, in what order, and what breaks if a guard is removed?**" — auth mechanism, CSRF posture, rate limiter, RBAC role, plan/AI-spend gate, RLS wrap, validation schema, demo blocking, and audit logging. A security reviewer or a developer adding a new route should open this file first.

The two docs cover the same endpoint set and cross-link heavily. The authoritative source for the chain is always the route file itself: the arguments passed to `router.get/post/put/patch/delete(...)` **are** the middleware chain, in order. Router-level middleware applied via `router.use(...)` runs before every route below it and is easy to miss — those are called out explicitly per group. Global middleware in [`app.ts`](#global-middleware-chain) runs before any route module.

---

## Verified endpoint count

Enumerated from `backend/src/routes/*.ts` (16 modules mounted in `routes/index.ts` + `internalRoutes` mounted in `app.ts`), counting each `router.get/post/put/patch/delete(...)` registration once at the file where it is registered. **Total user/scheduler endpoints: 110.** Plus 4 app-level utility endpoints in `app.ts` (`GET /`, `GET /health`, `GET /api/health/db`, `GET /api/v1/csrf-token`) and 2 in `routes/index.ts` (`GET /api/v1/`, `GET /api/v1/health`). The mega-table below enumerates all 110 routed endpoints; the 6 utility endpoints are listed in [App-level endpoints](#app-level-endpoints).

| Route file | Base mount | Mount source | Endpoints |
|---|---|---|---|
| `authRoutes.ts` | `/api/v1/auth` | `routes/index.ts:82` | 14 |
| `biomarkerRoutes.ts` | `/api/v1/biomarkers` | `routes/index.ts:83` | 10 |
| `insuranceRoutes.ts` | `/api/v1/insurance` | `routes/index.ts:84` | 10 |
| `expenseRoutes.ts` | `/api/v1/expenses` | `routes/index.ts:85` | 10 |
| `healthNeedsRoutes.ts` | `/api/v1/health-needs` | `routes/index.ts:86` | 7 |
| `healthGoalsRoutes.ts` | `/api/v1/health-goals` | `routes/index.ts:87` | 8 |
| `providerRoutes.ts` | `/api/v1/provider` | `routes/index.ts:90` | 6 |
| `patientRoutes.ts` | `/api/v1/patient` | `routes/index.ts:91` | 7 |
| `adminRoutes.ts` | `/api/v1/admin` | `routes/index.ts:92` | 11 |
| `uploadRoutes.ts` | `/api/v1/upload` | `routes/index.ts:95` | 3 |
| `fileRoutes.ts` | `/api/v1/files` | `routes/index.ts:98` | 4 |
| `settingsRoutes.ts` | `/api/v1/settings` | `routes/index.ts:101` | 9 |
| `aiRoutes.ts` | `/api/v1/ai` | `routes/index.ts:104` | 1 |
| `fhirRoutes.ts` | `/api/v1/fhir` | `routes/index.ts:107` | 5 |
| `planRoutes.ts` | `/api/v1/plan` | `routes/index.ts:110` | 2 |
| `onboardingRoutes.ts` | `/api/v1/onboarding` | `routes/index.ts:113` | 2 |
| `internalRoutes.ts` | `/api/v1/internal` | **`app.ts:269`** (not `routes/index.ts`) | 1 |

> Per-file counts sum to 110, the unique `router.X(...)` registration count across all 17 route modules. `PUT /insurance/plans/:id/spending` is registered in `insuranceRoutes.ts` (counted there, under insurance = 10) even though its handler lives in `expenseController` — the expense mega-table re-lists it for completeness but does not double-count it.

> `internalRoutes` is mounted directly in `app.ts:269`, separately from the other 16 modules. Its base path `/api/v1/internal` is composed from `config.apiVersion`, not from `routes/index.ts`.

---

## Global middleware chain

Every request passes through this stack (configured in [`backend/src/app.ts`](./ARCHITECTURE.md#middleware-stack)) before any route module sees it. Order is load-bearing.

```
HTTP request
   │
   ▼
1. app.set('trust proxy', 1)              app.ts:120  (req.ip = real client IP for rate-limit + audit)
   ▼
2. helmet(...)                            app.ts:125  (CSP, X-Frame-Options; CSP styleSrc allows 'unsafe-inline')
   ▼
3. cors(corsOptions)                      app.ts:191  (origin allowlist + credentials:true)
   app.options('*', cors(corsOptions))    app.ts:194  (explicit preflight handler)
   ▼
4. cookieParser()                         app.ts:197  (must precede CSRF + auth — both read cookies)
   ▼
5. compression({...})                     app.ts:204  (filter OPTS OUT of text/event-stream — app.ts:208)
   ▼
6. csrfProtection                         app.ts:216  (skipped only if isDevelopment && DISABLE_CSRF=true)
   ▼
7. standardLimiter                        app.ts:220  (global 100 req / 15 min, IP-keyed)
   ▼
8. morgan(...)                            app.ts:242/244 (dev: 'dev'; prod: path-only, no query string)
   ▼
9. express.json({ limit: '10mb' })        app.ts:248
   express.urlencoded({ limit:'10mb' })   app.ts:249
   ▼
10. requireJsonContentType               app.ts:252  (POST/PUT/PATCH with body must be application/json)
   ▼
11. app.use('/api', Cache-Control: no-store, no-cache, private)  app.ts:259-262
   ▼
12. routes (mounted at /api/v1)          app.ts:265  + internalRoutes at /api/v1/internal  app.ts:269
   ▼
13. notFoundHandler                      app.ts:327
   ▼
14. errorHandler                         app.ts:330  (centralized — see ERROR_RECOVERY.md)
```

Snippet — the compression SSE opt-out that keeps the AI chat stream un-buffered:

```ts
// Source: backend/src/app.ts:L204-L211
app.use(compression({
  threshold: 1024,
  level: 6,
  filter: (req, res) => {
    if (req.headers.accept === 'text/event-stream') return false;
    return compression.filter(req, res);
  },
}));
```

Snippet — the global standard limiter (the implicit limiter on any route that adds none of its own):

```ts
// Source: backend/src/middleware/rateLimiter.ts:L17-L34
export const standardLimiter = rateLimit({
  store: createRateLimitStore('standard'),
  windowMs: config.rateLimit.windowMs,   // RATE_LIMIT_WINDOW_MS, default 900000 (15 min)
  max: config.rateLimit.maxRequests,     // RATE_LIMIT_MAX_REQUESTS, default 100
  // ...
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
});
```

> **Rate-limit store caveat**: `createRateLimitStore(prefix)` (`backend/src/middleware/rateLimitStore.ts`) returns a shared Redis store only when `REDIS_URL` is set; otherwise it returns `undefined`, leaving express-rate-limit's in-process `MemoryStore` in place — per-instance counters, so the effective ceiling on Cloud Run with N instances is N×limit (`rateLimiter.ts:L7-L14`). See [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) audit #37.

---

## Mega-table — every endpoint

Legend: **Auth** = `authenticate` (cookie-or-Bearer), `requireBearerAuth` (Bearer-only), `public` (none), `token` (shared-secret header). **CSRF**: `global` = handled by the app-level `csrfProtection`; `exempt(<bucket>)` = on a `csrf.ts` exemption list; `route` = an extra route-level `csrfProtection` is also present; `n/a` = GET/HEAD/OPTIONS (CSRF only checks state-changing methods). **Rate limiter**: `standard` = global only; named = added at router/route level. **RLS wrap** = the Prisma wrapper used in the controller (`withRLSContext` / `withRLSTransaction` / `admin null-ctx`). Demo/Plan/AI-spend columns name the exact middleware/key.

### auth (`/api/v1/auth`) — `router.use(authLimiter)` at `authRoutes.ts:34`

| Method | Path | Route file:line | Auth | CSRF | Extra rate limiter | RBAC | Plan / AI-spend | RLS wrap | Validation | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `/auth/register` | `authRoutes.ts:41` | public | exempt(publicAuth) | authLimiter | — | — | (svc) | `auth.register` | `authController.register:162` | — | yes |
| POST | `/auth/login` | `authRoutes.ts:48` | public | exempt(publicAuth) | authLimiter + strictAuthLimiter | — | — | (svc) | `auth.login` | `authController.login:257` | — | yes |
| POST | `/auth/refresh` | `authRoutes.ts:56` | public (refresh cookie) | exempt(publicAuth) | authLimiter | — | — | (svc) | — | `authController.refreshToken:369` | — | yes |
| POST | `/auth/demo` | `authRoutes.ts:59` | public | exempt(publicAuth) | authLimiter | — | — | (svc) | — | `authController.demoLogin:587` | — | yes |
| GET | `/auth/verify-email` | `authRoutes.ts:62` | public | n/a | authLimiter | — | — | (svc) | `auth.verifyEmailQuery` (query) | `authController.verifyEmail:634` | — | yes |
| POST | `/auth/resend-verification` | `authRoutes.ts:71` | public | exempt(publicAuth) | authLimiter + strictAuthLimiter | — | — | (svc) | `auth.resendVerification` | `authController.resendVerification:688` | — | yes |
| POST | `/auth/forgot-password` | `authRoutes.ts:79` | public | exempt(publicAuth) | authLimiter + strictAuthLimiter | — | — | (svc) | `auth.forgotPassword` | `authController.forgotPassword:732` | — | yes |
| POST | `/auth/reset-password` | `authRoutes.ts:87` | public | exempt(publicAuth) | authLimiter + strictAuthLimiter | — | — | (svc) | `auth.resetPassword` | `authController.resetPasswordHandler:771` | — | yes |
| GET | `/auth/confirm-email-change` | `authRoutes.ts:96` | public | n/a | authLimiter + strictAuthLimiter | — | — | (svc) | `auth.confirmEmailChangeQuery` (query) | `authController.confirmEmailChangeHandler:892` | — | yes |
| POST | `/auth/logout` | `authRoutes.ts:108` | authenticate | global | authLimiter | — | — | (svc) | — | `authController.logout:413` | — | yes |
| POST | `/auth/logout-all` | `authRoutes.ts:111` | authenticate | global | authLimiter | — | — | (svc) | — | `authController.logoutAll:457` | — | yes |
| GET | `/auth/me` | `authRoutes.ts:114` | authenticate | n/a | authLimiter | — | — | (svc) | — | `authController.getCurrentUser:491` | — | yes |
| POST | `/auth/change-password` | `authRoutes.ts:117` | authenticate | global | authLimiter | — | — | (svc) | `auth.changePassword` | `authController.changePassword:518` | — | yes |
| POST | `/auth/change-email` | `authRoutes.ts:127` | authenticate | global | authLimiter + strictAuthLimiter | — | — | (svc) | `auth.changeEmail` | `authController.changeEmailHandler:833` | — | yes |

> `(svc)` = the auth controller resolves users via `authService` / direct prisma rather than a per-request `withRLSContext` wrap (login has no authenticated user yet). See [`DATA_MODEL.md`](./DATA_MODEL.md) for the User RLS policy.

### biomarkers (`/api/v1/biomarkers`) — `router.use(authenticate)` at `biomarkerRoutes.ts:47`

| Method | Path | Route file:line | Auth | CSRF | Extra rate limiter | Plan / AI-spend | RLS wrap | Validation | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/biomarkers` | `biomarkerRoutes.ts:50` | authenticate | n/a | standard | — | withRLSContext | `biomarker.listQuery` (query) | `biomarkerController.getBiomarkers:111` | — | yes |
| GET | `/biomarkers/summary` | `biomarkerRoutes.ts:57` | authenticate | n/a | standard | — | withRLSContext | — | `biomarkerController.getSummary:665` | — | yes |
| GET | `/biomarkers/categories` | `biomarkerRoutes.ts:63` | authenticate | n/a | standard | — | withRLSContext | — | `biomarkerController.getCategories:422` | — | yes |
| GET | `/biomarkers/:id` | `biomarkerRoutes.ts:69` | authenticate | n/a | standard | — | withRLSContext | `uuidParam` (params) | `biomarkerController.getBiomarker:192` | — | yes |
| GET | `/biomarkers/:id/history` | `biomarkerRoutes.ts:76` | authenticate | n/a | standard | — | withRLSContext | `uuidParam` (params) | `biomarkerController.getHistory:755` | — | yes |
| POST | `/biomarkers` | `biomarkerRoutes.ts:83` | authenticate | global | standard | — | withRLSTransaction | `biomarker.create` | `biomarkerController.createBiomarker:226` | — | yes |
| POST | `/biomarkers/batch` | `biomarkerRoutes.ts:91` | authenticate | global | bulkOperationLimiter (30/hr) | — | withRLSTransaction | `biomarker.batchCreate` | `biomarkerController.bulkCreateBiomarkers:458` | — | yes |
| PATCH | `/biomarkers/:id` | `biomarkerRoutes.ts:99` | authenticate | global | standard | — | withRLSTransaction | `uuidParam`(params)+`biomarker.update` | `biomarkerController.updateBiomarker:288` | — | yes |
| DELETE | `/biomarkers/:id` | `biomarkerRoutes.ts:107` | authenticate | global | standard | — | withRLSTransaction | `uuidParam` (params) | `biomarkerController.deleteBiomarker:381` | — | yes |
| POST | `/biomarkers/:id/guidance` | `biomarkerRoutes.ts:120` | authenticate | global | aiLimiter (10/hr/user) | aiSpendGuard + `requirePlanLimit('aiGuidancePerDay')` | withRLSTransaction | `uuidParam` (params) | inline handler `biomarkerRoutes.ts:127` | **blockDemoAI** | yes (PHI_ACCESS) |

### insurance (`/api/v1/insurance`) — `router.use(authenticate)` at `insuranceRoutes.ts:64`

| Method | Path | Route file:line | CSRF | Extra rate limiter | Plan / AI-spend | RLS wrap | Validation | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/insurance/plans` | `insuranceRoutes.ts:67` | n/a | standard | — | withRLSContext | — | `insuranceController.getInsurancePlans:412` | — | yes |
| GET | `/insurance/plans/:id` | `insuranceRoutes.ts:73` | n/a | standard | — | withRLSContext | `uuidParam` (params) | `insuranceController.getInsurancePlan:466` | — | yes |
| POST | `/insurance/plans` | `insuranceRoutes.ts:80` | global | standard | — | withRLSTransaction | `insurancePlan.create` | `insuranceController.createInsurancePlan:500` | — | yes |
| PATCH | `/insurance/plans/:id` | `insuranceRoutes.ts:87` | global | standard | — | withRLSTransaction | `uuidParam`(params)+`insurancePlan.update` | `insuranceController.updateInsurancePlan:600` | — | yes |
| DELETE | `/insurance/plans/:id` | `insuranceRoutes.ts:95` | global | standard | — | withRLSTransaction | `uuidParam` (params) | `insuranceController.deleteInsurancePlan:703` | — | yes |
| POST | `/insurance/compare` | `insuranceRoutes.ts:102` | global | standard | — | withRLSContext | `compareSchema` (inline) | `insuranceController.comparePlans:744` | — | yes |
| GET | `/insurance/benefits/search` | `insuranceRoutes.ts:109` | n/a | standard | — | withRLSContext | `benefitSearchSchema` (inline, query) | `insuranceController.searchBenefits:826` | — | yes |
| PUT | `/insurance/plans/:id/reanalyze` | `insuranceRoutes.ts:117` | global | uploadLimiter + aiLimiter | aiSpendGuard + `requirePlanLimit('pdfUploadsPerMonth')` | withRLSTransaction | `uuidParam` (params) | `upload/sbcUploadController.reanalyzePlan:224` | **blockDemoAI** | yes |
| POST | `/insurance/upload-sbc` | `insuranceRoutes.ts:131` | global | uploadLimiter + aiLimiter | aiSpendGuard + `requirePlanLimit('pdfUploadsPerMonth')` | withRLSTransaction | — | `upload/sbcUploadController.uploadSBC:33` | **blockDemoAI** | yes |
| PUT | `/insurance/plans/:id/spending` | `insuranceRoutes.ts:143` | global | standard | — | withRLSTransaction | `uuidParam`(params)+`expense.updateSpending` | `expenseController.updateCurrentSpending:575` | — | yes |

### expenses (`/api/v1/expenses`) — `router.use(authenticate)` at `expenseRoutes.ts:32`

> Note: this router redundantly adds **route-level `csrfProtection`** on top of the global one (e.g. `expenseRoutes.ts:48`). Belt-and-suspenders — see [drift](#drift--findings).

| Method | Path | Route file:line | CSRF | Extra rate limiter | Plan / AI-spend | RLS wrap | Validation | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/expenses/projections` | `expenseRoutes.ts:39` | n/a | standard | — | withRLSContext | `expense.projectionsQuery` (query) | `expenseController.getProjections:125` | — | yes |
| POST | `/expenses/projections` | `expenseRoutes.ts:46` | global + route | standard | — | withRLSTransaction | `expense.createProjection` | `expenseController.createProjection:74` | — | yes |
| PUT | `/expenses/projections/:id` | `expenseRoutes.ts:54` | global + route | standard | — | withRLSTransaction | `uuidParam`(params)+`expense.updateProjection` | `expenseController.updateProjection:195` | — | yes |
| DELETE | `/expenses/projections/:id` | `expenseRoutes.ts:63` | global + route | standard | — | withRLSTransaction | `uuidParam` (params) | `expenseController.deleteProjection:242` | — | yes |
| GET | `/expenses/actuals` | `expenseRoutes.ts:75` | n/a | standard | — | withRLSContext | `expense.actualsQuery` (query) | `expenseController.getActuals:422` | — | yes |
| POST | `/expenses/actuals` | `expenseRoutes.ts:82` | global + route | standard | — | withRLSTransaction | `expense.createActual` | `expenseController.createActual:358` | — | yes |
| PUT | `/expenses/actuals/:id` | `expenseRoutes.ts:90` | global + route | standard | — | withRLSTransaction | `uuidParam`(params)+`expense.updateActual` | `expenseController.updateActual:481` | — | yes |
| DELETE | `/expenses/actuals/:id` | `expenseRoutes.ts:99` | global + route | standard | — | withRLSTransaction | `uuidParam` (params) | `expenseController.deleteActual:545` | — | yes |
| POST | `/expenses/analyze` | `expenseRoutes.ts:111` | global + route | aiLimiter (10/hr/user) | aiSpendGuard + `requirePlanLimit('costAnalysisPerMonth')` | withRLSTransaction | `expense.analyzeCosts` | `expenseController.analyzeCosts:614` | **blockDemoAI** | yes (PHI_ACCESS) |
| GET | `/expenses/analyses` | `expenseRoutes.ts:123` | n/a | standard | — | withRLSContext | `expense.analysesQuery` (query) | `expenseController.getAnalyses:774` | — | yes |
| PUT | `/insurance/plans/:id/spending` | (handler on `insuranceRoutes.ts:143`) | global | standard | — | withRLSTransaction | `expense.updateSpending` | `expenseController.updateCurrentSpending:575` | — | yes |

> The last row is the same `updateCurrentSpending` handler counted under `insurance` — it lives in `expenseController` but is wired into `insuranceRoutes`, not `expenseRoutes`. Listed once in the count.

### health-needs (`/api/v1/health-needs`) — `router.use(authenticate)` at `healthNeedsRoutes.ts:39`

| Method | Path | Route file:line | CSRF | Extra rate limiter | RLS wrap | Validation | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/health-needs` | `healthNeedsRoutes.ts:42` | n/a | standard | withRLSContext | `healthNeed.listQuery` (query) | `healthNeedsController.getHealthNeeds:58` | — | yes |
| GET | `/health-needs/analyze` | `healthNeedsRoutes.ts:49` | n/a | aiLimiter (10/hr/user) | withRLSTransaction | — | `healthNeedsController.analyzeHealthNeeds:386` | — | yes |
| GET | `/health-needs/summary` | `healthNeedsRoutes.ts:53` | n/a | standard | withRLSContext | — | `healthNeedsController.getHealthNeedsSummary:465` | — | yes |
| GET | `/health-needs/:id` | `healthNeedsRoutes.ts:56` | n/a | standard | withRLSContext | `uuidParam` (params) | `healthNeedsController.getHealthNeed:153` | — | yes |
| POST | `/health-needs` | `healthNeedsRoutes.ts:63` | global | standard | withRLSTransaction | `healthNeed.create` | `healthNeedsController.createHealthNeed:186` | — | yes |
| PATCH | `/health-needs/:id` | `healthNeedsRoutes.ts:70` | global | standard | withRLSTransaction | `uuidParam`(params)+`healthNeed.update` | `healthNeedsController.updateHealthNeedStatus:293` | — | yes |
| DELETE | `/health-needs/:id` | `healthNeedsRoutes.ts:78` | global | standard | withRLSTransaction | `uuidParam` (params) | `healthNeedsController.deleteHealthNeed:346` | — | yes |

> `GET /analyze` carries `aiLimiter` but **does not call Claude** — it is a rule-based recommender (`healthNeedsController.ts:L410-L415`). No `aiSpendGuard`/`blockDemoAI`/plan gate. See [drift](#drift--findings).

### health-goals (`/api/v1/health-goals`) — `router.use(authenticate)` at `healthGoalsRoutes.ts:42`

| Method | Path | Route file:line | CSRF | Extra rate limiter | RLS wrap | Validation | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/health-goals/summary` | `healthGoalsRoutes.ts:45` | n/a | standard | withRLSContext | — | `healthGoalsController.getGoalsSummary:703` | — | yes |
| GET | `/health-goals/suggestions` | `healthGoalsRoutes.ts:48` | n/a | aiLimiter (10/hr/user) | withRLSTransaction | — | `healthGoalsController.suggestGoals:783` | — | yes |
| GET | `/health-goals` | `healthGoalsRoutes.ts:51` | n/a | standard | withRLSContext | `healthGoal.listQuery` (query) | `healthGoalsController.getHealthGoals:216` | — | yes |
| GET | `/health-goals/:id` | `healthGoalsRoutes.ts:58` | n/a | standard | withRLSContext | `uuidParam` (params) | `healthGoalsController.getHealthGoal:297` | — | yes |
| POST | `/health-goals` | `healthGoalsRoutes.ts:65` | global | standard | withRLSTransaction | `healthGoal.create` | `healthGoalsController.createHealthGoal:335` | — | yes |
| PUT | `/health-goals/:id` | `healthGoalsRoutes.ts:72` | global | standard | withRLSTransaction | `uuidParam`(params)+`healthGoal.update` | `healthGoalsController.updateHealthGoal:450` | — | yes |
| PATCH | `/health-goals/:id/progress` | `healthGoalsRoutes.ts:80` | global | standard | withRLSTransaction | `uuidParam`(params)+`healthGoal.updateProgress` | `healthGoalsController.updateGoalProgress:550` | — | yes |
| DELETE | `/health-goals/:id` | `healthGoalsRoutes.ts:88` | global | standard | withRLSTransaction | `uuidParam` (params) | `healthGoalsController.deleteHealthGoal:662` | — | yes |

> `GET /suggestions` carries `aiLimiter` but is also rule-based, no Claude call (`healthGoalsController.ts:L805+`). See [drift](#drift--findings).

### provider (`/api/v1/provider`) — `router.use(authenticate)` + `router.use(requireRole('PROVIDER','ADMIN'))` at `providerRoutes.ts:25-26`

| Method | Path | Route file:line | RBAC | CSRF | Extra rate limiter | RLS wrap | Validation | Handler | Audit |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/provider/patients` | `providerRoutes.ts:32` | PROVIDER/ADMIN | n/a | standard | withRLSContext | — | inline `providerRoutes.ts:34` | yes |
| POST | `/provider/patients/request` | `providerRoutes.ts:150` | PROVIDER/ADMIN | global | providerAccessRequestLimiter (10/hr/user) | withRLSContext + admin null-ctx | `providerPatient.request` | inline `providerRoutes.ts:154` | yes |
| GET | `/provider/patients/:patientId` | `providerRoutes.ts:292` | PROVIDER/ADMIN | n/a | standard | withRLSContext | `patientIdParam` (params) | inline `providerRoutes.ts:295` | yes (VIEW_PATIENT) |
| GET | `/provider/patients/:patientId/biomarkers` | `providerRoutes.ts:415` | PROVIDER/ADMIN | n/a | standard | withRLSContext | `patientIdParam` (params) | inline `providerRoutes.ts:418` | yes (PHI_ACCESS) |
| GET | `/provider/patients/:patientId/health-needs` | `providerRoutes.ts:559` | PROVIDER/ADMIN | n/a | standard | withRLSContext | `patientIdParam` (params) | inline `providerRoutes.ts:562` | yes (PHI_ACCESS) |
| DELETE | `/provider/patients/:patientId` | `providerRoutes.ts:690` | PROVIDER/ADMIN | global | standard | withRLSContext | `patientIdParam` (params) | inline `providerRoutes.ts:693` | yes |

> The email→patient-id lookup in `POST /patients/request` deliberately uses an **admin null-ctx** wrap (`withRLSContext(null, ..., { isAdmin: true })`, `providerRoutes.ts:165-174`) because `users_select_own` would otherwise deny a provider resolving another user's id by email. The relationship write uses the provider's own RLS identity (`providerRoutes.ts:227`).

### patient (`/api/v1/patient`) — `router.use(authenticate)` + `router.use(requireRole('PATIENT'))` at `patientRoutes.ts:22-24`

| Method | Path | Route file:line | RBAC | CSRF | RLS wrap | Validation | Handler | Audit |
|---|---|---|---|---|---|---|---|---|
| GET | `/patient/providers` | `patientRoutes.ts:30` | PATIENT | n/a | withRLSContext + admin null-ctx | — | inline `patientRoutes.ts:32` | yes |
| GET | `/patient/providers/pending` | `patientRoutes.ts:109` | PATIENT | n/a | withRLSContext + admin null-ctx | — | inline `patientRoutes.ts:111` | yes |
| POST | `/patient/providers/:id/approve` | `patientRoutes.ts:180` | PATIENT | global | withRLSContext | `uuidParam`(params)+`providerPatient.approve` | inline `patientRoutes.ts:184` | yes (CONSENT_GRANTED) |
| POST | `/patient/providers/:id/deny` | `patientRoutes.ts:271` | PATIENT | global | withRLSContext | `uuidParam` (params) | inline `patientRoutes.ts:274` | yes (CONSENT_DENIED) |
| PATCH | `/patient/providers/:id` | `patientRoutes.ts:328` | PATIENT | global | withRLSContext | `uuidParam`(params)+`providerPatient.updatePermissions` | inline `patientRoutes.ts:332` | yes (PERMISSIONS_UPDATED) |
| POST | `/patient/providers/:id/revoke` | `patientRoutes.ts:418` | PATIENT | global | withRLSContext | `uuidParam` (params) | inline `patientRoutes.ts:421` | yes (CONSENT_REVOKED) |
| DELETE | `/patient/providers/:id` | `patientRoutes.ts:482` | PATIENT | global | withRLSContext | `uuidParam` (params) | inline `patientRoutes.ts:485` | yes (RELATIONSHIP_DELETED) |

### admin (`/api/v1/admin`) — `router.use(authenticate)` → `router.use(blockDemoAdminAccess)` → `router.use(requireRole('ADMIN'))` at `adminRoutes.ts:29-31`

All admin reads/writes run under an **admin null-ctx** wrap (`withRLSContext(null, ..., { isAdmin: true })`).

| Method | Path | Route file:line | RBAC | CSRF | Extra rate limiter | RLS wrap | Validation | Handler | Audit |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/admin/users` | `adminRoutes.ts:41` | ADMIN | n/a | standard | admin null-ctx | `admin.listUsersQuery` (query) | inline `adminRoutes.ts:44` | yes |
| GET | `/admin/users/:id` | `adminRoutes.ts:130` | ADMIN | n/a | standard | admin null-ctx | `uuidParam` (params) | inline `adminRoutes.ts:133` | yes |
| POST | `/admin/users` | `adminRoutes.ts:200` | ADMIN | global | standard | admin null-ctx | `admin.createUser` | inline `adminRoutes.ts:203` | yes (CREATE) |
| PATCH | `/admin/users/:id` | `adminRoutes.ts:266` | ADMIN | global | standard | admin null-ctx | `uuidParam`(params)+`admin.updateUser` | inline `adminRoutes.ts:270` | yes (UPDATE/PERMISSION_CHANGE) |
| DELETE | `/admin/users/:id` | `adminRoutes.ts:383` | ADMIN | global | standard | admin null-ctx | `uuidParam` (params) | inline `adminRoutes.ts:386` | yes (DEACTIVATE) |
| DELETE | `/admin/users/:id/permanent` | `adminRoutes.ts:466` | ADMIN | global | sensitiveLimiter (10/hr) | admin null-ctx | `uuidParam`(params)+`admin.permanentDelete` | inline `adminRoutes.ts:471` | yes (PERMANENT_DELETE) |
| PATCH | `/admin/users/:id/plan` | `adminRoutes.ts:564` | ADMIN | global | standard | admin null-ctx | `uuidParam`(params)+`admin.updateUserPlan` | inline `adminRoutes.ts:568` | yes (PLAN_CHANGE) |
| GET | `/admin/provider-relationships` | `adminRoutes.ts:653` | ADMIN | n/a | standard | admin null-ctx | — | inline `adminRoutes.ts:655` | yes |
| PATCH | `/admin/provider-relationships/:id` | `adminRoutes.ts:693` | ADMIN | global | standard | admin null-ctx | `uuidParam` (params) | inline `adminRoutes.ts:696` | yes |
| GET | `/admin/stats` | `adminRoutes.ts:775` | ADMIN | n/a | standard | admin null-ctx | — | inline `adminRoutes.ts:777` | yes |
| GET | `/admin/audit-logs` | `adminRoutes.ts:868` | ADMIN | n/a | standard | admin null-ctx | `admin.auditLogQuery` (query) | inline `adminRoutes.ts:871` | yes (meta-audit) |

### upload (`/api/v1/upload`) — `router.use(uploadLimiter)` at `uploadRoutes.ts:26`

`authenticate` is applied **per-route** here (not router-level), after `uploadLimiter`.

| Method | Path | Route file:line | Auth | CSRF | Extra rate limiter | Plan / AI-spend | RLS wrap | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|---|
| POST | `/upload/lab-report` | `uploadRoutes.ts:77` | authenticate | global | uploadLimiter + aiLimiter | `requirePlanLimit('pdfUploadsPerMonth')` | withRLSTransaction | `upload/labUploadController.uploadLabReport:36` | **blockDemoAI** | yes |
| POST | `/upload/insurance-sbc` | `uploadRoutes.ts:94` | authenticate | global | uploadLimiter + aiLimiter | `requirePlanLimit('pdfUploadsPerMonth')` | withRLSTransaction | `upload/sbcUploadController.uploadSBC:33` | **blockDemoAI** | yes |
| POST | `/upload/lab-results-ocr` | `uploadRoutes.ts:124` | authenticate | global | uploadLimiter + aiLimiter | `requirePlanLimit('pdfUploadsPerMonth')` | withRLSTransaction | `upload/labUploadController.uploadLabResultOCR:191` | **blockDemoAI** | yes |

> Upload routes carry `aiLimiter` + `blockDemoAI` + plan gate but **no `aiSpendGuard`** in the chain (compare `insuranceRoutes.ts:131` upload-sbc which does). See [drift](#drift--findings).

### files (`/api/v1/files`) — `router.use(authenticate)` at `fileRoutes.ts:42`

| Method | Path | Route file:line | CSRF | Extra rate limiter | RLS wrap | Validation | Controller (file:fn:line) | Audit |
|---|---|---|---|---|---|---|---|---|
| GET | `/files` | `fileRoutes.ts:45` | n/a | standard | withRLSTransaction | `pagination` (query) | `fileController.getFiles:41` | yes |
| GET | `/files/:id` | `fileRoutes.ts:52` | n/a | standard | withRLSTransaction | `uuidParam` (params) | `fileController.getFile:131` | yes |
| GET | `/files/:id/download` | `fileRoutes.ts:59` | n/a | sensitiveLimiter (10/hr) | withRLSTransaction | `uuidParam` (params) | `fileController.getFileDownloadUrl:201` | yes |
| DELETE | `/files/:id` | `fileRoutes.ts:67` | global | standard | withRLSTransaction | `uuidParam` (params) | `fileController.deleteFile:289` | yes |

### settings (`/api/v1/settings`) — `router.use(authenticate)` at `settingsRoutes.ts:31`

| Method | Path | Route file:line | CSRF | Extra rate limiter | Plan feature | RLS wrap | Validation | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/settings/profile` | `settingsRoutes.ts:34` | n/a | sensitiveLimiter | — | withRLSContext | — | `settingsController.getProfile:982` | — | yes |
| PATCH | `/settings/profile` | `settingsRoutes.ts:41` | global | sensitiveLimiter | — | withRLSTransaction | `settings.updateProfile` | `settingsController.updateProfile:1040` | **blockDemoProfileUpdate** | yes |
| GET | `/settings/notifications` | `settingsRoutes.ts:50` | n/a | sensitiveLimiter | — | withRLSContext | — | `settingsController.getNotifications:1112` | — | yes |
| PATCH | `/settings/notifications` | `settingsRoutes.ts:57` | global | sensitiveLimiter | — | withRLSTransaction | `settings.updateNotifications` | `settingsController.updateNotifications:1144` | **blockDemoProfileUpdate** | yes |
| GET | `/settings/health-profile` | `settingsRoutes.ts:66` | n/a | sensitiveLimiter | — | withRLSContext | — | `settingsController.getHealthProfile:1220` | — | yes |
| PATCH | `/settings/health-profile` | `settingsRoutes.ts:76` | global | sensitiveLimiter | `requirePlanFeature('healthProfile')` | withRLSTransaction | `settings.updateHealthProfile` | `settingsController.updateHealthProfile:1250` | **blockDemoProfileUpdate** | yes |
| GET | `/settings/export-data` | `settingsRoutes.ts:86` | n/a | sensitiveLimiter | — | withRLSContext | — | `settingsController.exportUserData:330` | — | yes |
| DELETE | `/settings/delete-data` | `settingsRoutes.ts:98` | global | sensitiveLimiter | — | withRLSTransaction | `settings.deleteData` | `settingsController.deleteAllData:732` | **blockDemoProfileUpdate** | yes |
| DELETE | `/settings/delete-account` | `settingsRoutes.ts:107` | global | sensitiveLimiter | — | withRLSTransaction | `settings.deleteAccount` | `settingsController.deleteAccount:887` | **blockDemoProfileUpdate** | yes |

### ai (`/api/v1/ai`) — `router.use(requireBearerAuth)` at `aiRoutes.ts:21`

| Method | Path | Route file:line | Auth | CSRF | Extra rate limiter | Plan / AI-spend | RLS wrap | Validation | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `/ai/chat` | `aiRoutes.ts:29` | **requireBearerAuth** | **exempt(bearerOnlyStreaming)** | aiLimiter (10/hr/user) | aiSpendGuard + `requirePlanLimit('aiChatsPerDay')` | (none — see note) | `ai.chat` | `aiChatController.handleAIChat:118` | **blockDemoAI** | yes |

> `/ai/chat` uses `requireBearerAuth` (Bearer-only) — never the cookie path — precisely because it is CSRF-exempt for SSE streaming. See [Why Bearer-only](#why-aichat-is-bearer-only). The handler does not wrap its DB reads in `withRLSContext` (it reads a per-user health snapshot via service helpers); audit logging is done via `auditService.logAccess` at `aiChatController.ts:130/260/289`.

### fhir (`/api/v1/fhir`) — `router.use(authenticate)` at `fhirRoutes.ts:27` (AFTER the public callback)

| Method | Path | Route file:line | Auth | CSRF | Extra rate limiter | Plan feature | RLS wrap | Validation | Controller (file:fn:line) | Demo | Audit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/fhir/callback` | `fhirRoutes.ts:24` | **public** (OAuth redirect) | n/a | standard | — | (svc — `persistConnection`) | — | `fhirController.handleCallback:76` | — | (svc) |
| GET | `/fhir/connect/quest` | `fhirRoutes.ts:30` | authenticate | n/a | sensitiveLimiter | `requirePlanFeature('questFhirIntegration')` | (svc) | — | `fhirController.initiateQuestConnect:38` | **blockDemoAI** | (svc) |
| GET | `/fhir/connections` | `fhirRoutes.ts:39` | authenticate | n/a | standard | — | withRLSContext | — | `fhirController.listConnections:113` | — | (svc) |
| POST | `/fhir/sync/:connectionId` | `fhirRoutes.ts:42` | authenticate | global + route | sensitiveLimiter | `requirePlanFeature('questFhirIntegration')` | withRLSContext | `connectionIdParam` (params) | `fhirController.triggerSync:145` | **blockDemoAI** | (svc) |
| DELETE | `/fhir/connections/:id` | `fhirRoutes.ts:53` | authenticate | global + route | sensitiveLimiter | — | withRLSContext | `uuidParam` (params) | `fhirController.deleteConnection:183` | **blockDemoAI** | (svc) |

> `GET /fhir/callback` is the **one FHIR route without `authenticate`** — it is declared before `router.use(authenticate)` at `fhirRoutes.ts:27`. See [Why the callback is unauthenticated](#why-fhir-callback-has-no-authenticate).

### plan (`/api/v1/plan`) — no router-level middleware; `authenticate` per-route

| Method | Path | Route file:line | Auth | CSRF | RLS wrap | Controller (file:fn:line) | Audit |
|---|---|---|---|---|---|---|---|
| GET | `/plan/available` | `planRoutes.ts:32` | **public** (pricing page) | n/a | — (static `PLANS` catalog) | inline `planRoutes.ts:34` | — |
| GET | `/plan` | `planRoutes.ts:52` | authenticate | n/a | withRLSContext | inline `planRoutes.ts:55` | — |

### onboarding (`/api/v1/onboarding`) — `router.use(authenticate)` at `onboardingRoutes.ts:20`

| Method | Path | Route file:line | Auth | CSRF | RLS wrap | Controller | Audit |
|---|---|---|---|---|---|---|---|
| GET | `/onboarding/status` | `onboardingRoutes.ts:22` | authenticate | n/a | (svc `onboardingService`) | inline `onboardingRoutes.ts:24` | — |
| POST | `/onboarding/complete` | `onboardingRoutes.ts:32` | authenticate | global | (svc `onboardingService`) | inline `onboardingRoutes.ts:34` | — |

### internal (`/api/v1/internal`) — mounted in `app.ts:269`, NOT `routes/index.ts`

| Method | Path | Route file:line | Auth | CSRF | RLS wrap | Handler | Audit |
|---|---|---|---|---|---|---|---|
| POST | `/internal/audit-cleanup` | `internalRoutes.ts:40` | **`X-Cleanup-Token` shared secret** (constant-time) | **exempt(scheduler)** | (svc `auditLogService.cleanupOldLogs`) | inline `internalRoutes.ts:42` | yes (logger) |

### App-level endpoints (not in a route module)

| Method | Path | Source | Auth | Notes |
|---|---|---|---|---|
| GET | `/` | `app.ts:287` | public | API name/version banner |
| GET | `/health` | `app.ts:301` | public | DB health probe for Docker/Cloud Run (returns 503 if DB down) |
| GET | `/api/health/db` | `app.ts:318` | public | legacy DB health, explicit `standardLimiter` |
| GET | `/api/v1/csrf-token` | `app.ts:284` | public | `csrfTokenHandler` — issues a fresh `csrf_token` cookie |
| GET | `/api/v1/` | `routes/index.ts:54` | public | endpoint catalog |
| GET | `/api/v1/health` | `routes/index.ts:42` | public | API health JSON |

---

## Per-group deep dives

### `biomarkerRoutes.ts`

**Base mount**: `/api/v1/biomarkers` — `routes/index.ts:83`. **Router-level**: `router.use(authenticate)` at line 47 — every route below requires auth; it does not appear on each route line, so do not report it as missing.

```ts
// Source: backend/src/routes/biomarkerRoutes.ts:L47-L96
router.use(authenticate);

router.get('/', validate(schemas.biomarker.listQuery, 'query'), asyncHandler(biomarkerController.getBiomarkers));
// ... summary, categories, :id, :id/history ...
router.post('/', validate(schemas.biomarker.create), asyncHandler(biomarkerController.createBiomarker));
router.post('/batch', bulkOperationLimiter, validate(schemas.biomarker.batchCreate), asyncHandler(biomarkerController.bulkCreateBiomarkers));
```

The AI guidance route is the most heavily-guarded route in the file — five guards plus an in-handler BAA gate:

```ts
// Source: backend/src/routes/biomarkerRoutes.ts:L120-L127
router.post(
  '/:id/guidance',
  aiLimiter,
  aiSpendGuard,
  blockDemoAI,
  requirePlanLimit('aiGuidancePerDay'),
  validate(schemas.uuidParam, 'params'),
```

Notable:
- The biomarker for guidance is **loaded from the DB under RLS by id+userId** (`biomarkerRoutes.ts:160-171`), never read from `req.body` — closing an IDOR (F-3 in [`SECURITY_STATUS.md`](./SECURITY_STATUS.md)).
- The handler refuses with **503** before any decryption or network call unless `ANTHROPIC_BAA_ACTIVE=true` and an API key is set (`biomarkerRoutes.ts:137-151`) — the C-7 BAA gate. See [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).
- Claude output is run through `stripPHIFromText` (`biomarkerRoutes.ts:244`) before return; the audit row records `phiDisclosedFields` but **not** the biomarker name (F-16, `biomarkerRoutes.ts:266-272`).

### `aiRoutes.ts`

**Base mount**: `/api/v1/ai` — `routes/index.ts:104`. **Router-level**: `router.use(requireBearerAuth)` at line 21.

```ts
// Source: backend/src/routes/aiRoutes.ts:L21-L37
router.use(requireBearerAuth);

router.post(
  '/chat',
  aiLimiter,
  aiSpendGuard,
  blockDemoAI,
  requirePlanLimit('aiChatsPerDay'),
  validate(schemas.ai.chat),
  asyncHandler(handleAIChat)
);
```

This is the only route group that uses `requireBearerAuth` instead of `authenticate`. See [Why Bearer-only](#why-aichat-is-bearer-only).

### `fhirRoutes.ts`

**Base mount**: `/api/v1/fhir` — `routes/index.ts:107`. The OAuth callback is declared **before** the router-level `authenticate`:

```ts
// Source: backend/src/routes/fhirRoutes.ts:L24-L36
router.get('/callback', asyncHandler(fhir.handleCallback));

// Authenticated routes below.
router.use(authenticate);

router.get('/connect/quest', sensitiveLimiter, blockDemoAI, requirePlanFeature('questFhirIntegration'), asyncHandler(fhir.initiateQuestConnect));
```

Because `router.use(authenticate)` is placed at line 27, only `/callback` (declared at line 24) escapes it; every route below requires auth.

### `internalRoutes.ts`

**Base mount**: `/api/v1/internal` — **`app.ts:269`**, NOT `routes/index.ts`. This module is imported separately (`app.ts:50`) and mounted on its own line so the Cloud Scheduler trigger lives outside the user-facing router tree. It is authenticated by a shared-secret header, not the session JWT or CSRF cookie:

```ts
// Source: backend/src/routes/internalRoutes.ts:L43-L62
const expected = config.scheduler.auditCleanupToken;
if (!expected) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  return;
}
const provided = req.get('X-Cleanup-Token') || '';
if (!tokenMatches(provided, expected)) {
  res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
  return;
}
```

The route **404s** unless `AUDIT_CLEANUP_TOKEN` is set (`config.scheduler.auditCleanupToken`, `config/index.ts:136`), so mounting it is always safe. Token comparison is constant-time (`timingSafeEqual`, `internalRoutes.ts:27-33`).

---

## Middleware cross-reference

| Middleware | File:line | Routes / scope using it |
|---|---|---|
| `authenticate` | `auth.ts:71` | Router-level: `biomarkerRoutes:47`, `insuranceRoutes:64`, `expenseRoutes:32`, `healthNeedsRoutes:39`, `healthGoalsRoutes:42`, `providerRoutes:25`, `patientRoutes:22`, `adminRoutes:29`, `fileRoutes:42`, `settingsRoutes:31`, `onboardingRoutes:20`, `fhirRoutes:27` (after callback). Per-route: `authRoutes:108/111/114/117/127`, `uploadRoutes:77/94/124`, `planRoutes:54`. |
| `requireBearerAuth` | `auth.ts:180` | Router-level: `aiRoutes:21` (CSRF-exempt SSE — the only consumer). |
| `csrfProtection` (global) | `csrf.ts:180`, mounted `app.ts:216` | All state-changing routes except the three exemption buckets. |
| `csrfProtection` (route-level, redundant) | imported `expenseRoutes.ts:9`, `fhirRoutes.ts:7` | `expenseRoutes` POST/PUT/DELETE (`:48,56,65,84,92,101,117`); `fhirRoutes` sync (`:48`), delete-connection (`:58`). |
| `requireRole(...)` | `rbac.ts:58` | `providerRoutes:26` (`'PROVIDER','ADMIN'`), `patientRoutes:24` (`'PATIENT'`), `adminRoutes:31` (`'ADMIN'`). |
| `standardLimiter` | `rateLimiter.ts:17` | Global (`app.ts:220`) + explicit on `app.ts:318` (`/api/health/db`). 100 req / 15 min, IP-keyed. |
| `authLimiter` | `rateLimiter.ts:37` | Router-level `authRoutes:34` (all 14 auth routes). 20 / 15 min. |
| `strictAuthLimiter` | `rateLimiter.ts:53` | `authRoutes` login(`:51`), resend-verification(`:73`), forgot-password(`:81`), reset-password(`:89`), confirm-email-change(`:98`), change-email(`:130`). 5 / 15 min, email+IP keyed, `skipSuccessfulRequests`. |
| `uploadLimiter` | `rateLimiter.ts:76` | Router-level `uploadRoutes:26`; route-level `insuranceRoutes:121` (reanalyze), `:135` (upload-sbc). 20 / hr. |
| `sensitiveLimiter` | `rateLimiter.ts:92` | `fileRoutes:60` (download); all `settingsRoutes`; `adminRoutes:468` (permanent delete); `fhirRoutes:32/45/56`. 10 / hr. |
| `aiLimiter` | `rateLimiter.ts:108` | `biomarkerRoutes:122`, `insuranceRoutes:122/136`, `expenseRoutes:113`, `healthNeedsRoutes:49`, `healthGoalsRoutes:48`, `uploadRoutes:80/97/127`, `aiRoutes:31`. 10 / hr **per user** (id-keyed). |
| `providerAccessRequestLimiter` | `rateLimiter.ts:133` | `providerRoutes:152` (patient access request). 10 / hr per user. |
| `bulkOperationLimiter` | `rateLimiter.ts:157` | `biomarkerRoutes:93` (batch). 30 / hr. |
| `aiSpendGuard` | `aiSpendGuard.ts:23` | `biomarkerRoutes:123`, `insuranceRoutes:123/137`, `expenseRoutes:114`, `aiRoutes:32`. (NOT on `uploadRoutes` — see drift.) |
| `requirePlanLimit(key)` | `planGating.ts:37` | `aiGuidancePerDay` → `biomarkerRoutes:125`; `pdfUploadsPerMonth` → `insuranceRoutes:124/137`, `uploadRoutes:82/99/129`; `costAnalysisPerMonth` → `expenseRoutes:116`; `aiChatsPerDay` → `aiRoutes:34`. |
| `requirePlanFeature(key)` | `planGating.ts:120` (alias of `requirePlanLimit`) | `healthProfile` → `settingsRoutes:80`; `questFhirIntegration` → `fhirRoutes:34/47`. |
| `blockDemoAI` | `demoProtection.ts:164` | `biomarkerRoutes:124`, `insuranceRoutes:120/133`, `expenseRoutes:115`, `uploadRoutes:81/98/128`, `aiRoutes:33`, `fhirRoutes:33/46/57`. |
| `blockDemoAdminAccess` | `demoProtection.ts:67` | Router-level `adminRoutes:30` (runs between auth and RBAC). |
| `blockDemoProfileUpdate` | `demoProtection.ts:145` | `settingsRoutes:44/60/79/101/110` (profile, notifications, health-profile, delete-data, delete-account). |
| `blockDemoUserModification` | `demoProtection.ts:85` | **Exported but not wired to any route** — see drift. |
| `blockDemoRoleChange` | `demoProtection.ts:43` | **Exported but not wired to any route** — see drift. |
| `validate(schema, source?)` | `validation.ts:148` | Used on nearly every route — see [validation schema map](#validation-schema-map). |
| `requireJsonContentType` | `validation.ts:190` | Global (`app.ts:252`). |

---

## RLS wrap usage

The RLS contract (see [`DATA_MODEL.md`](./DATA_MODEL.md) and `CLAUDE.md`): queries MUST run through the `tx` handed to `withRLSContext` / `withRLSTransaction` (`backend/src/services/database.ts`), which issues `SET LOCAL app.current_user_id`. A bare `prisma.*` inside the callback runs on a different connection without the `SET LOCAL`, so RLS evaluates against NULL.

| Controller / handler location | Wrap used | Identity | Notes |
|---|---|---|---|
| `biomarkerController` (all CRUD) | `withRLSContext` (reads) / `withRLSTransaction` (writes) | user | 10 wrap sites (`biomarkerController.ts`). |
| `insuranceController` | both | user | 7 wrap sites. |
| `expenseController` | both | user | 12 wrap sites. |
| `healthGoalsController` | both | user | 8 wrap sites; `suggestGoals` uses `withRLSTransaction`. |
| `healthNeedsController` | both | user | 9 wrap sites; `analyzeHealthNeeds` uses `withRLSTransaction`. |
| `fileController` | `withRLSTransaction` | user | 5 wrap sites; all scoped by `{id, userId}` AND backed by the `user_files` RLS policy. |
| `settingsController` | both | user | 11 wrap sites. |
| `fhirController` | `withRLSContext` | user | 2 wrap sites (`listConnections:119`, `triggerSync:152`). `handleCallback` uses `persistConnection(result.userId, ...)` — the userId comes from the verified OAuth state, not the wrap. |
| `providerRoutes` inline handlers | `withRLSContext` | provider OR admin null-ctx | The email lookup in `/patients/request` and cross-tenant identity reads use `{ isAdmin: true }`. |
| `patientRoutes` inline handlers | `withRLSContext` | patient OR admin null-ctx | Own rows = patient identity; provider display lookups = admin null-ctx. |
| `adminRoutes` inline handlers | `withRLSContext(null, ..., { isAdmin: true })` | admin null-ctx | Every read/write — belt-and-suspenders on top of `requireRole('ADMIN')`. |
| `planGating` middleware | `withRLSContext` | user | Reads `plan` + `planExpiresAt` (`planGating.ts:66`). |
| `rbac.checkProviderPatientAccess` / `requireOwnership` | `withRLSContext(null, ..., { isAdmin: true })` | admin null-ctx | `rbac.ts:208`, `rbac.ts:288`. |

**Handlers that do NOT use a per-request RLS wrap:**
- `authController` routes — login/register/refresh have no authenticated user yet; user resolution is via `authService`. Not a finding (no per-user RLS identity exists pre-auth).
- `aiChatController.handleAIChat` — does not wrap DB reads in `withRLSContext`; it pulls a per-user health snapshot via service helpers. Under the current superuser `DATABASE_URL` this is functionally fine; under a `NOBYPASSRLS` role it would need wrapping. Flagged in [drift](#drift--findings) and [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).
- `onboardingService`, `usageTracker`, `aiCostTracker` — service-layer, not route-level; out of scope for this table.

---

## CSRF exemption list

Authority: `backend/src/middleware/csrf.ts` `validateCsrfToken` — three explicit buckets. CSRF only runs on state-changing methods (`csrf.ts:92`).

```ts
// Source: backend/src/middleware/csrf.ts:L98-L118
const publicAuthRoutes = [
  '/auth/login', '/auth/register', '/auth/demo', '/auth/refresh',
  '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email',
  '/auth/resend-verification', '/marketplace/plans/search',
];
const bearerOnlyStreamingRoutes = [ '/ai/chat' ];
```

| Route(s) | Bucket | Authority | Exemption reason |
|---|---|---|---|
| `/auth/login`, `/auth/register`, `/auth/demo`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`, `/marketplace/plans/search` | `publicAuthRoutes` | `csrf.ts:98-108` | Pre-session / public — no session cookie to protect yet. **`/marketplace/plans/search` is dead** — the CMS Marketplace feature was removed (`CLAUDE.md` "Removed Features"); the exemption entry is stale. See [drift](#drift--findings). |
| `POST /ai/chat` | `bearerOnlyStreamingRoutes` | `csrf.ts:116-118` | SSE/`EventSource` cannot attach `x-csrf-token`. Safe **only** because the route is `requireBearerAuth` (cookie path rejected at the route layer, `aiRoutes.ts:21`). |
| `POST /internal/audit-cleanup` | scheduler | `csrf.ts:139` | Cloud Scheduler cannot carry the CSRF cookie; authed by constant-time `X-Cleanup-Token`; 404s unless `AUDIT_CLEANUP_TOKEN` set. |

> **Upload routes are NOT CSRF-exempt.** The old exemption was removed (`csrf.ts:L120-125`); the frontend `services/uploadUtils.ts` attaches `X-CSRF-Token` on every upload, so any new upload path that forgets it fails closed.

---

## Demo-blocked routes

Demo identity is `req.user.email === config.demo.email` (case-insensitive; false if `DEMO_EMAIL` unset, `demoProtection.ts:33-36`). Variants:

| Variant | File:line | Guards | Why |
|---|---|---|---|
| `blockDemoAI` | `demoProtection.ts:164` | Every AI/PHI-write + external-API path: `biomarkers/:id/guidance`, `insurance/upload-sbc` + `reanalyze`, `expenses/analyze`, all 3 `upload/*`, `ai/chat`, `fhir/connect|sync|delete`. | Demo accounts cannot generate real Anthropic/OCR cost or create real PHI / lab connections. |
| `blockDemoAdminAccess` | `demoProtection.ts:67` | Router-level `adminRoutes:30` — runs **between** `authenticate` and `requireRole('ADMIN')`, so demo is rejected before any role check even if its role were elevated (F-5). | All admin endpoints. |
| `blockDemoProfileUpdate` | `demoProtection.ts:145` | `settings` profile/notifications/health-profile updates + delete-data + delete-account (`settingsRoutes:44/60/79/101/110`). | Keeps shared demo state consistent; demo has a real password so would otherwise pass re-auth. |
| `blockDemoUserModification` | `demoProtection.ts:85` | **Exported, not wired.** | Intended for user-management routes; admin routes already covered by `blockDemoAdminAccess`. See drift. |
| `blockDemoRoleChange` | `demoProtection.ts:43` | **Exported, not wired.** | Intended for role-change routes; same coverage gap. See drift. |

---

## Plan-gating map

Keys resolve against `PlanLimits` in `backend/src/config/plans.ts:18-29`. `requirePlanLimit` reads the **DB** plan (not the JWT) under RLS, enforces `planExpiresAt`, and 403s with `code: 'PLAN_LIMIT_EXCEEDED', upgradeRequired: true` (`planGating.ts:89-106`).

| Plan key | Type | FREE / PRO / TEAM | Routes gated (file:line) |
|---|---|---|---|
| `aiChatsPerDay` | numeric | 3 / 50 / -1 | `aiRoutes:34` |
| `aiGuidancePerDay` | numeric | 5 / -1 / -1 | `biomarkerRoutes:125` |
| `costAnalysisPerMonth` | numeric | 1 / -1 / -1 | `expenseRoutes:116` |
| `pdfUploadsPerMonth` | numeric | 2 / 20 / -1 | `insuranceRoutes:124`, `insuranceRoutes:137`, `uploadRoutes:82`, `uploadRoutes:99`, `uploadRoutes:129` |
| `healthProfile` | boolean | false / true / true | `settingsRoutes:80` (via `requirePlanFeature`) |
| `questFhirIntegration` | boolean | false / true / true | `fhirRoutes:34`, `fhirRoutes:47` (via `requirePlanFeature`) |

> `-1` = unlimited (`plans.ts:118 isUnlimited`). `maxBiomarkers`, `insurancePlans`, `providerSharing`, `dataExport` exist in `PlanLimits` but are **not enforced via route middleware** — they are checked in controllers / always-on (`dataExport` is `true` on all tiers per HIPAA, `plans.ts:56`).

---

## AI spend-guard usage

`aiSpendGuard` (`aiSpendGuard.ts:23`) is a **daily dollar-budget circuit breaker**, distinct from `aiLimiter` (a per-user request-count cap). It reads the rolling accumulator in `aiCostTracker` (written post-call by `trackAIUsage`) and fails closed with **503** when the budget is exhausted.

```ts
// Source: backend/src/middleware/aiSpendGuard.ts:L23-L34
export function aiSpendGuard(req: Request, _res: Response, next: NextFunction): void {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) { next(); return; }
  const { exceeded, scope } = isAISpendExceeded(userId);
  if (!exceeded) { next(); return; }
  // ... 503 ServiceUnavailableError ...
}
```

| Aspect | `aiLimiter` | `aiSpendGuard` |
|---|---|---|
| Unit | request **count** (10/hr per user) | accumulated **dollars** per day |
| Scope | per-user (id-keyed), `rateLimiter.ts:121` | per-user **and** global (`AI_USER_DAILY_BUDGET_USD` default $5 / `AI_DAILY_BUDGET_USD` default $50, `config/index.ts:196-197`) |
| Failure | 429 `AI_RATE_LIMIT_EXCEEDED` | 503 `SERVICE_UNAVAILABLE` |
| Resets | rolling 1-hour window | daily |

Routes with `aiSpendGuard`: `biomarkerRoutes:123`, `insuranceRoutes:123` + `:137`, `expenseRoutes:114`, `aiRoutes:32`. The three `uploadRoutes` AI paths carry `aiLimiter` but **omit** `aiSpendGuard` — see [drift](#drift--findings).

---

## Validation schema map

Schemas live in the central registry `schemas` in `backend/src/middleware/validation.ts:223`. `validate(schema, source?)` (`validation.ts:148`) defaults to `'body'`; pass `'query'` / `'params'` otherwise.

| Schema | File:line | Validates (route + source) |
|---|---|---|
| `uuidParam` | `validation.ts:231` | `:id` params across biomarker/insurance/health-needs/health-goals/expense/file/admin/patient + `fhir/connections/:id` (params) |
| `connectionIdParam` | `validation.ts:236` | `POST /fhir/sync/:connectionId` (params) |
| `patientIdParam` | `validation.ts:241` | `provider/patients/:patientId*` (params) |
| `pagination` | `validation.ts:225` | `GET /files` (query) |
| `auth.login` | `validation.ts:254` | `POST /auth/login` (body) |
| `auth.register` | `validation.ts:259` | `POST /auth/register` (body) |
| `auth.changePassword` | `validation.ts:266` | `POST /auth/change-password` (body) |
| `auth.forgotPassword` | `validation.ts:271` | `POST /auth/forgot-password` (body) |
| `auth.resetPassword` | `validation.ts:275` | `POST /auth/reset-password` (body) |
| `auth.resendVerification` | `validation.ts:280` | `POST /auth/resend-verification` (body) |
| `auth.verifyEmailQuery` | `validation.ts:284` | `GET /auth/verify-email` (query) |
| `auth.changeEmail` | `validation.ts:288` | `POST /auth/change-email` (body) |
| `auth.confirmEmailChangeQuery` | `validation.ts:293` | `GET /auth/confirm-email-change` (query) |
| `biomarker.create` | `validation.ts:302` | `POST /biomarkers` (body) |
| `biomarker.update` | `validation.ts:320` | `PATCH /biomarkers/:id` (body) |
| `biomarker.batchCreate` | `validation.ts:336` | `POST /biomarkers/batch` (body) |
| `biomarker.listQuery` | `validation.ts:354` | `GET /biomarkers` (query) |
| `insurancePlan.create` | `validation.ts:382` | `POST /insurance/plans` (body) |
| `insurancePlan.update` | `validation.ts:429` | `PATCH /insurance/plans/:id` (body) |
| `compareSchema` (inline) | `insuranceRoutes.ts:54` | `POST /insurance/compare` (body) |
| `benefitSearchSchema` (inline) | `insuranceRoutes.ts:58` | `GET /insurance/benefits/search` (query) |
| `healthNeed.create` | `validation.ts:463` | `POST /health-needs` (body) |
| `healthNeed.update` | `validation.ts:473` | `PATCH /health-needs/:id` (body) |
| `healthNeed.listQuery` | `validation.ts:483` | `GET /health-needs` (query) |
| `healthGoal.create` | `validation.ts:497` | `POST /health-goals` (body) |
| `healthGoal.update` | `validation.ts:515` | `PUT /health-goals/:id` (body) |
| `healthGoal.updateProgress` | `validation.ts:531` | `PATCH /health-goals/:id/progress` (body) |
| `healthGoal.listQuery` | `validation.ts:536` | `GET /health-goals` (query) |
| `providerPatient.request` | `validation.ts:549` | `POST /provider/patients/request` (body) |
| `providerPatient.approve` | `validation.ts:555` | `POST /patient/providers/:id/approve` (body) |
| `providerPatient.updatePermissions` | `validation.ts:563` | `PATCH /patient/providers/:id` (body) |
| `expense.createProjection` | `validation.ts:575` | `POST /expenses/projections` (body) |
| `expense.updateProjection` | `validation.ts:584` | `PUT /expenses/projections/:id` (body) |
| `expense.analyzeCosts` | `validation.ts:592` | `POST /expenses/analyze` (body) |
| `expense.projectionsQuery` | `validation.ts:596` | `GET /expenses/projections` (query) |
| `expense.analysesQuery` | `validation.ts:602` | `GET /expenses/analyses` (query) |
| `expense.createActual` | `validation.ts:607` | `POST /expenses/actuals` (body) |
| `expense.updateActual` | `validation.ts:623` | `PUT /expenses/actuals/:id` (body) |
| `expense.actualsQuery` | `validation.ts:638` | `GET /expenses/actuals` (query) |
| `expense.updateSpending` | `validation.ts:647` | `PUT /insurance/plans/:id/spending` (body) |
| `ai.chat` | `validation.ts:657` | `POST /ai/chat` (body) |
| `settings.updateProfile` | `validation.ts:675` | `PATCH /settings/profile` (body) |
| `settings.updateNotifications` | `validation.ts:683` | `PATCH /settings/notifications` (body) |
| `settings.updateHealthProfile` | `validation.ts:715` | `PATCH /settings/health-profile` (body) |
| `settings.deleteData` | `validation.ts:705` | `DELETE /settings/delete-data` (body) |
| `settings.deleteAccount` | `validation.ts:711` | `DELETE /settings/delete-account` (body) |
| `admin.createUser` | `validation.ts:748` | `POST /admin/users` (body) |
| `admin.updateUser` | `validation.ts:756` | `PATCH /admin/users/:id` (body) |
| `admin.listUsersQuery` | `validation.ts:763` | `GET /admin/users` (query) |
| `admin.auditLogQuery` | `validation.ts:771` | `GET /admin/audit-logs` (query) |
| `admin.updateUserPlan` | `validation.ts:782` | `PATCH /admin/users/:id/plan` (body) |
| `admin.permanentDelete` | `validation.ts:790` | `DELETE /admin/users/:id/permanent` (body) |

> Routes with **no** `validate(...)` (no input to validate or body parsed manually): `POST /auth/refresh`, `POST /auth/demo`, the auth `logout`/`logout-all`/`me`, `GET /biomarkers/summary|categories`, `GET /health-needs/analyze|summary`, `GET /health-goals/summary|suggestions`, `provider GET /patients`, `patient GET /providers*`, `admin GET /provider-relationships|stats`, `PATCH /admin/provider-relationships/:id` (params not validated — see drift), `fhir GET /callback|connect/quest|connections`, `plan` routes, `onboarding` routes, `internal/audit-cleanup`.

---

## Detailed answers

### Why `/ai/chat` is Bearer-only

```ts
// Source: backend/src/middleware/auth.ts:L50-L57 (extractBearerToken doc)
// CSRF-exempt routes ... must be genuinely Bearer-only, not cookie-and-Bearer.
// The base `authenticate` reads the cookie first — meaning a cookie-carrying
// cross-site request would pass auth AND bypass CSRF at the same time.
```

`/ai/chat` is CSRF-exempt because an SSE `EventSource` cannot attach `x-csrf-token`. If the route also accepted the cookie auth path, a cross-site POST would satisfy auth (via the ambient cookie) **and** skip CSRF simultaneously. `requireBearerAuth` (`auth.ts:180`) ignores cookies entirely (`extractBearerToken`, `auth.ts:59-65`), so a cross-site request with no Bearer header is rejected at the auth layer. The exemption is only safe because of this pairing (`aiRoutes.ts:17-20`).

### Why `/fhir/callback` has no `authenticate`

OAuth providers redirect the browser to `/fhir/callback` as a plain unauthenticated GET — there is no session cookie or Bearer token on that hop. The route is bound to a user by **PKCE + a stashed `state` token** (24-byte random, 10-minute TTL), verified inside `handleOAuthCallback('quest', code, state)` which returns the resolved `userId`; the connection is then persisted with that id (`fhirController.ts:95-96`):

```ts
// Source: backend/src/controllers/fhirController.ts:L95-L96
const result = await handleOAuthCallback('quest', code, state);
await persistConnection(result.userId, result.provider, result.tokenSet);
```

A cross-user forgery would require guessing the random `state` within its TTL (`fhirRoutes.ts:17-23`).

---

## Drift / findings

Red-flag and stale-config list. Cross-link: [`SECURITY_STATUS.md`](./SECURITY_STATUS.md), [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

1. **Upload AI routes lack `aiSpendGuard`.** `uploadRoutes.ts:77/94/124` carry `aiLimiter` + `blockDemoAI` + `requirePlanLimit('pdfUploadsPerMonth')` but **not** `aiSpendGuard`, even though they invoke Claude (SBC extraction) / Document AI (OCR). By contrast, `insuranceRoutes.ts:131` (same `uploadSBC` handler) **does** include `aiSpendGuard`. The daily dollar circuit-breaker can be bypassed via the `/upload/*` paths. Recommend adding `aiSpendGuard` to the three upload routes. (Not in the prompt's example chain — code confirms the omission.)

2. **`/ai/chat` handler does not use `withRLSContext`.** `aiChatController.handleAIChat` (`aiChatController.ts:118`) reads a per-user health snapshot without a per-request RLS wrap. Functionally fine under the current superuser `DATABASE_URL`; under a `NOBYPASSRLS` role it would need wrapping to remain correct. Tracked alongside the broader RLS-runtime gap in [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

3. **`/marketplace/plans/search` CSRF exemption is dead.** `csrf.ts:107` still exempts a route for a removed feature (CMS Marketplace, per `CLAUDE.md` "Removed Features"). No route file mounts it. Harmless but stale — remove from `publicAuthRoutes` to keep the exemption list honest.

4. **`blockDemoUserModification` and `blockDemoRoleChange` are exported but never wired.** `demoProtection.ts:43` and `:85` have no route consumers (admin paths are covered by `blockDemoAdminAccess`). Dead-ish code; either wire onto `PATCH /admin/users/:id` (role-change path) as defense-in-depth or remove.

5. **"AI" routes that aren't AI.** `GET /health-needs/analyze` (`healthNeedsController.ts:386`) and `GET /health-goals/suggestions` (`healthGoalsController.ts:783`) carry `aiLimiter` but are rule-based recommenders with **no Claude call**, no `aiSpendGuard`, no `blockDemoAI`, no plan gate. The `aiLimiter` is the only AI-flavored guard and is arguably misapplied (it throttles a cheap local computation at 10/hr). Naming implies external AI; behavior is local. Low severity.

6. **`PATCH /admin/provider-relationships/:id` validates params but not body.** `adminRoutes.ts:693` applies `validate(schemas.uuidParam, 'params')` but no body schema; `status` and the permission booleans are read directly from `req.body` (`adminRoutes.ts:700`). Admin-only and audit-logged, but lacks the Zod boundary every other mutation has.

---

## Acceptance questions (self-answered from this doc)

1. **Middleware before any route, in order?** — [Global middleware chain](#global-middleware-chain): trust-proxy → Helmet → CORS(+OPTIONS) → cookie-parser → compression(SSE-opt-out) → CSRF → standardLimiter → morgan → body-parser(10MB) → requireJsonContentType → `/api` no-store → routes (`app.ts:120-269`).
2. **Chain for `POST /api/v1/biomarkers`?** — router-level `authenticate` (`biomarkerRoutes.ts:47`) → global CSRF → global `standardLimiter` → `validate(schemas.biomarker.create)` → `createBiomarker` (`withRLSTransaction`). See [biomarkers table](#biomarkers-apiv1biomarkers--routeruseauthenticate-at-biomarkerroutests47).
3. **Limiter on `POST /biomarkers/:id/guidance`?** — `aiLimiter` (10/hr per user, 1-hour window) + `aiSpendGuard` (daily budget) + `requirePlanLimit('aiGuidancePerDay')` + in-handler BAA gate. ([biomarkers table](#biomarkers-apiv1biomarkers--routeruseauthenticate-at-biomarkerroutests47), [AI spend-guard](#ai-spend-guard-usage)).
4. **CSRF-exempt routes / buckets / why?** — [CSRF exemption list](#csrf-exemption-list): `publicAuthRoutes`, `bearerOnlyStreamingRoutes` (`/ai/chat`), scheduler (`/internal/audit-cleanup`).
5. **Demo-blocked routes / variant?** — [Demo-blocked routes](#demo-blocked-routes): `blockDemoAI` (AI/PHI writes), `blockDemoAdminAccess` (admin router-level), `blockDemoProfileUpdate` (settings mutations).
6. **Which controllers skip `withRLSContext` — a finding?** — [RLS wrap usage](#rls-wrap-usage): `authController` (no finding, pre-auth) and `aiChatController` (finding #2). All user-data controllers wrap.
7. **Schema for `POST /api/v1/insurance/plans`?** — `schemas.insurancePlan.create` (`validation.ts:382`). [Validation map](#validation-schema-map).
8. **Routes requiring PROVIDER?** — all `provider/*` routes via `requireRole('PROVIDER','ADMIN')` (`providerRoutes.ts:26`). [provider table](#provider-apiv1provider--routeruseauthenticate--routeruserequirerole-provideradmin-at-providerroutests25-26).
9. **Routes requiring ADMIN?** — all `admin/*` routes via `requireRole('ADMIN')` (`adminRoutes.ts:31`). [admin table](#admin-apiv1admin--routeruseauthenticate--routeruseblockdemoadminaccess--routeruserequirerole-admin-at-adminroutests29-31).
10. **`POST /api/v1/upload/lab-report` guards + handler?** — `uploadLimiter` (router-level 20/hr) + per-route `authenticate` + `aiLimiter` + `blockDemoAI` + `requirePlanLimit('pdfUploadsPerMonth')`; handler `upload/labUploadController.uploadLabReport:36`. (Note: no `aiSpendGuard` — drift #1.) [upload table](#upload-apiv1upload--routeruseuploadlimiter-at-uploadroutests26).
11. **Total endpoints?** — **110** routed endpoints (incl. `/internal/audit-cleanup`), + 6 utility endpoints. [Verified endpoint count](#verified-endpoint-count).
12. **`requirePlanLimit`/`requirePlanFeature` routes + keys?** — [Plan-gating map](#plan-gating-map): `aiChatsPerDay`, `aiGuidancePerDay`, `costAnalysisPerMonth`, `pdfUploadsPerMonth`, `healthProfile`, `questFhirIntegration`.
13. **`aiSpendGuard` routes + how it differs from `aiLimiter`?** — [AI spend-guard](#ai-spend-guard-usage): dollar budget (503) vs request count (429); on biomarker-guidance, insurance upload/reanalyze, expense analyze, ai/chat.
14. **Why `GET /fhir/callback` has no `authenticate`?** — [Why the callback is unauthenticated](#why-fhir-callback-has-no-authenticate): OAuth redirect; bound by PKCE + random `state` (10-min TTL) → `result.userId`.
15. **Why `POST /ai/chat` uses `requireBearerAuth`?** — [Why Bearer-only](#why-aichat-is-bearer-only): CSRF-exempt SSE; cookie path would let a cross-site POST pass auth and bypass CSRF at once.

---

## Related Documents

- [API_REFERENCE.md](./API_REFERENCE.md) — contract-facing counterpart: request/response shapes, curl, JSON for each endpoint here.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — global middleware stack and request lifecycle in narrative form (`#middleware-stack`).
- [DATA_MODEL.md](./DATA_MODEL.md) — the RLS policies each `withRLSContext` wrap relies on, per-model.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — per-field encryption, audit, and redaction for PHI returned by these routes.
- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — open findings referenced here (RLS runtime gap, upload spend-guard, BAA gate C-7, F-3/F-5/F-16).
- [ERROR_RECOVERY.md](./ERROR_RECOVERY.md) — the error each guard produces (401/403/429/503) and recovery paths.
- [ENV_VARS.md](./ENV_VARS.md) — `RATE_LIMIT_*`, `REDIS_URL`, `AI_DAILY_BUDGET_USD`, `AUDIT_CLEANUP_TOKEN`, `ANTHROPIC_BAA_ACTIVE`, `DEMO_EMAIL`.

---

## Prompt drift log

- `./34-routing-table-doc.md` "Files to review" says the route surface should be enumerated from **18 non-test files incl. `index.ts`**. Live count via `Glob backend/src/routes/*.ts` (excluding `*.test.ts`): **18 files** = 17 route modules + `index.ts`. Confirmed accurate.
- The prompt's mega-table example marks `/ai/chat` Audit column as `—`. Actual: `aiChatController.handleAIChat` **does** audit-log via `auditService.logAccess` at `aiChatController.ts:130/260/289`. Corrected to "yes" in this doc.
- The prompt's `aiSpendGuard` cross-reference example lists `uploadRoutes.ts` ("lab-report/sbc/ocr") as a consumer. **Code disagrees**: `uploadRoutes.ts` imports `aiLimiter` but NOT `aiSpendGuard` (no import at `uploadRoutes.ts:14-21`). Logged as finding #1; the prompt's example should not assume upload routes carry the spend guard.
- The prompt lists `blockDemoUserModification` / `blockDemoRoleChange` as guarding "admin user-management / role-change paths." **Code disagrees**: both are exported from `demoProtection.ts` but have zero route consumers (verified — only `blockDemoAdminAccess` guards admin routes). Logged as finding #4.
- The prompt example shows biomarker guidance audit as "(see controller)"/blank. Actual inline handler audit-logs PHI access at `biomarkerRoutes.ts:266`. Filled in.
- Prompt says "60+ endpoints" was the old figure (`CLAUDE.md` still says "13 files, 60+ endpoints" at the `routes/` line) — actual is **18 route files (17 modules + `index.ts`), 110 routed endpoints**. `CLAUDE.md`'s controllers list also still references a non-existent `uploadController.ts`; upload handlers live in `backend/src/controllers/upload/`. Both `CLAUDE.md` lines are stale.
