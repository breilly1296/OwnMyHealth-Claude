---
tags:
  - documentation
  - routing
  - security
  - reference
type: prompt
priority: 2
updated: 2026-06-16
---

# Generate ROUTING_TABLE.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — when a route exposes PHI.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/ROUTING_TABLE.md` — the **security-stack-facing companion** to `API_REFERENCE.md`. Same routes, different lens:

| `API_REFERENCE.md` | `ROUTING_TABLE.md` |
|---|---|
| Contract-facing: request/response, curl, JSON shape | Middleware-facing: chain, rate limiter, RBAC role, RLS wrap, validation schema |
| Answers: "how do I call this?" | Answers: "what guards this? what breaks if a guard is missing?" |

Both docs reference the same endpoints; they cross-link heavily. `ROUTING_TABLE.md` is what a security reviewer or a developer adding a new route should open first. Enumerate the real endpoint count from the route files (do not assume an old "~70" figure) — the route surface has grown with `aiRoutes`, `fhirRoutes`, `internalRoutes`, `onboardingRoutes`, and `planRoutes`.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/routes/*.ts` (all 18 non-test files incl. `index.ts`) | **Source of truth** — middleware chain per route, in order. New since prompt era: `aiRoutes`, `fhirRoutes`, `internalRoutes`, `onboardingRoutes`, `planRoutes`. |
| `backend/src/routes/index.ts` | Route mounting (base paths per group). Mounts 16 modules; **`internalRoutes` is NOT here** — it is mounted in `backend/src/app.ts` at `/api/v1/internal`. |
| `backend/src/controllers/*.ts` (10 controllers + `index.ts`; `testHelpers.ts` is not a controller) | Handler function bodies — to locate RLS wrap usage and validation schemas. New: `aiChatController`, `fhirController`. **`uploadController` no longer exists** — upload handlers live in `backend/src/controllers/upload/` (`labUploadController`, `sbcUploadController`, re-exported via `upload/index.ts`). |
| `backend/src/middleware/auth.ts` | `authenticate` (cookie-or-Bearer) and `requireBearerAuth` (Bearer-only, used by CSRF-exempt streaming routes) exports. |
| `backend/src/middleware/csrf.ts` | `csrfProtection` middleware + the single flat `EXEMPT_PATHS` Set of fully-qualified exempt paths (public auth routes, `/api/v1/ai/chat`, `/api/v1/internal/audit-cleanup`). There are **no** named bucket variables anymore — `publicAuthRoutes` / `bearerOnlyStreamingRoutes` no longer exist. **`/api/v1/auth/refresh` is NOT exempt** (cookie-authed, state-changing — the SPA double-submits `X-CSRF-Token` on it). |
| `backend/src/middleware/rbac.ts` | `requireRole(...)` factory, role hierarchy. |
| `backend/src/middleware/rateLimiter.ts` | **8** named limiters (standard, auth, strictAuth, upload, sensitive, ai, providerAccessRequest, bulkOperation). |
| `backend/src/middleware/rateLimitStore.ts` | `createRateLimitStore(prefix)` — shared Redis store when `REDIS_URL` is set, in-memory per-instance fallback otherwise. |
| `backend/src/middleware/validation.ts` | `validate(schema, source?)` factory + the `schemas` registry (e.g. `schemas.biomarker.create`, `schemas.uuidParam`, `schemas.ai.chat`) — which schemas validate which routes. |
| `backend/src/middleware/demoProtection.ts` | `blockDemoAI`, `blockDemoAdminAccess`, `blockDemoUserModification`, `blockDemoProfileUpdate`, `blockDemoRoleChange` — routes off-limits to demo users (there is **no** generic `blockDemo` export). |
| `backend/src/middleware/planGating.ts` | `requirePlanLimit(limitKey)` and `requirePlanFeature(feature)` — plan/tier gating (limits + feature flags from `config/plans.ts`). |
| `backend/src/middleware/aiSpendGuard.ts` | `aiSpendGuard` — daily AI budget check (`AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD`), runs before AI controllers. |
| `backend/src/app.ts` | Global middleware mount order (what runs before route-level) + where `/api/v1/internal` is mounted. |

---

## Required sections

1. **Purpose + how to read** — 1 paragraph + 1 paragraph for the relationship to `API_REFERENCE.md`.
2. **Global middleware chain** — the order Express runs middleware before routes (Helmet → CORS + OPTIONS handler → cookie-parser → compression → CSRF → global `standardLimiter` → morgan → body-parser (10MB) → `requireJsonContentType` → `/api` `Cache-Control: no-store` → routes) — cite `backend/src/app.ts`. Note: compression explicitly opts OUT of `text/event-stream` so the AI Health Guide SSE stream isn't buffered.
3. **Route group index** — mega-table across every endpoint enumerated from the route files (see Required artifacts).
4. **Per-group deep dives** — one H2 per route file (authRoutes, biomarkerRoutes, insuranceRoutes, expenseRoutes, healthGoalsRoutes, healthNeedsRoutes, uploadRoutes, fileRoutes, providerRoutes, patientRoutes, settingsRoutes, adminRoutes, onboardingRoutes, fhirRoutes, aiRoutes, planRoutes, internalRoutes). For each: the full route-file snippet (or representative slice), annotation of non-obvious middleware combos. **`internalRoutes` is mounted in `app.ts`, not `routes/index.ts`** — call that out in its deep dive.
5. **Middleware cross-reference** — for each middleware, which routes use it.
6. **RLS wrap usage** — which controllers wrap their Prisma calls in `withRLSContext` / `withRLSTransaction`, which use the `null` admin context, and which (if any) skip wrapping — flagged as a security issue.
7. **CSRF exemption list** — Bearer-auth'd / streaming / scheduler routes, with justification. `csrf.ts` has a **single flat `EXEMPT_PATHS` Set** (no named buckets — `publicAuthRoutes` / `bearerOnlyStreamingRoutes` were removed). Its members fall into three conceptual groups: public auth routes (login/register/demo/forgot-password/reset-password/verify-email/resend-verification — note `/auth/refresh` is **deliberately NOT** here), the Bearer-only streaming route (`/ai/chat` — must use `requireBearerAuth`), and the scheduler route (`/internal/audit-cleanup`).
8. **Demo-blocked routes** — every route behind a `blockDemo*` variant: `blockDemoAI` (PHI/AI writes), `blockDemoAdminAccess` (`adminRoutes` router-level), `blockDemoUserModification`, `blockDemoProfileUpdate` (`settingsRoutes`), `blockDemoRoleChange`. Note which variant guards which route and why.
9. **Plan-gating map** — every route behind `requirePlanLimit(limitKey)` or `requirePlanFeature(feature)` (e.g. `aiChatsPerDay`, `aiGuidancePerDay`, `pdfUploadsPerMonth`, `questFhirIntegration`) → the limit/feature key from `config/plans.ts`.
10. **AI spend-guard usage** — every route behind `aiSpendGuard` (AI/Claude routes), and how it relates to `aiLimiter` (per-user rate cap) vs the daily-budget kill switch.
11. **Validation schema map** — Zod schema name → routes it validates.
12. **Drift findings** — routes that bypass the expected stack (e.g., PHI route without auth).
13. **Related Documents**.
14. **Prompt drift log**.

---

## Required artifacts

### Mega-table (top of doc)

| Method | Path | Route file:line | Auth | CSRF | Rate limiter | RBAC | Plan gate / AI spend | RLS wrap | Validation | Controller (`file:fn:line`) | Demo blocked? | Audit logged? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/v1/auth/login` | `authRoutes.ts:Lxx` | public | exempt (in `EXEMPT_PATHS`) | `authLimiter` + `strictAuthLimiter` | — | — | — | `schemas.auth.login` | `authController.login:Lxx` | — | yes |
| GET | `/api/v1/biomarkers` | `biomarkerRoutes.ts:L50` | yes (`authenticate`, router-level) | — (GET) | global `standardLimiter` | — | — | `withRLSContext` (in controller) | `schemas.biomarker.listQuery` | `biomarkerController.getBiomarkers` | no | yes |
| POST | `/api/v1/ai/chat` | `aiRoutes.ts:L29` | yes (`requireBearerAuth`, router-level) | exempt (in `EXEMPT_PATHS` — Bearer-only streaming) | `aiLimiter` | — | `requirePlanLimit('aiChatsPerDay')` + `aiSpendGuard` | (see controller) | `schemas.ai.chat` | `aiChatController.handleAIChat` | `blockDemoAI` | — |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

Every endpoint gets one row. Do not truncate. Use `Grep pattern: "router\\.(get|post|put|patch|delete)"` to enumerate. Verify line numbers and controller fn names against the live files — do not trust the example placeholders above.

### Per-group deep dive (template)

````markdown
## `biomarkerRoutes.ts` (`backend/src/routes/biomarkerRoutes.ts`)

**Base mount**: `/api/v1/biomarkers` — `backend/src/routes/index.ts:L83`.

Annotated source:

```ts
// Source: backend/src/routes/biomarkerRoutes.ts
router.use(authenticate); // router-level: every route requires auth

router.get(
  '/',
  validate(schemas.biomarker.listQuery, 'query'),
  asyncHandler(biomarkerController.getBiomarkers),
);
router.post(
  '/',
  validate(schemas.biomarker.create),
  asyncHandler(biomarkerController.createBiomarker),
);
router.post(
  '/:id/guidance',
  aiLimiter,
  aiSpendGuard,
  blockDemoAI,
  requirePlanLimit('aiGuidancePerDay'),
  validate(schemas.uuidParam, 'params'),
  asyncHandler(/* inline AI guidance handler */),
);
// ...
```

Notable:
- `authenticate` is applied **router-level** via `router.use(authenticate)` — it does not appear on each route line, so don't report it as missing.
- The global `standardLimiter` (from `app.ts`) covers ordinary routes; only routes that need a tighter cap add their own limiter.
- `POST /batch` adds `bulkOperationLimiter` (30/hr) on top of the global limiter.
- `POST /:id/guidance` is the AI path: `aiLimiter` (10/hr per user) + `aiSpendGuard` (daily budget) + `blockDemoAI` + `requirePlanLimit('aiGuidancePerDay')`. It is also BAA-gated (`ANTHROPIC_BAA_ACTIVE`) inside the handler.
- RLS wrapping happens **inside the controller** (`withRLSContext` / `withRLSTransaction` from `services/database.ts`), not in the route file — read the controller body to confirm.
- Validation uses the central `schemas` registry (`schemas.biomarker.*`, `schemas.uuidParam`), not standalone schema imports.

Route → middleware chain summary (chain shown after the router-level `authenticate`):

| Route | Middleware chain (in order) | RLS wrap (in controller) | Audit event |
|---|---|---|---|
| `GET /` | `validate(schemas.biomarker.listQuery,'query')` | `withRLSContext` | (verify) |
| `POST /` | `validate(schemas.biomarker.create)` | `withRLSTransaction` | (verify) |
| `POST /batch` | `bulkOperationLimiter, validate(schemas.biomarker.batchCreate)` | `withRLSTransaction` | (verify) |
| `POST /:id/guidance` | `aiLimiter, aiSpendGuard, blockDemoAI, requirePlanLimit('aiGuidancePerDay'), validate(schemas.uuidParam,'params')` | `withRLSContext` | (verify) |
| ... | ... | ... | ... |
````

### Middleware cross-reference

Cover every middleware: `authenticate`, `requireBearerAuth`, `csrfProtection`, `requireRole`, all 8 rate limiters, every `blockDemo*` variant, `requirePlanLimit`/`requirePlanFeature`, `aiSpendGuard`, `validate`.

| Middleware | File:line | Routes using it (count + file:line list) |
|---|---|---|
| `authenticate` | `backend/src/middleware/auth.ts:L74` | `biomarkerRoutes.ts:L47` (router-level), `onboardingRoutes.ts:L20` (router-level), ... (N uses) |
| `requireBearerAuth` | `backend/src/middleware/auth.ts:L197` | `aiRoutes.ts:L21` (router-level — CSRF-exempt streaming) |
| `aiLimiter` | `backend/src/middleware/rateLimiter.ts:L177` | `aiRoutes.ts:L31`, `biomarkerRoutes.ts:L122` (guidance), `uploadRoutes.ts` (lab-report/sbc/ocr), `expenseRoutes.ts` (analyze), ... |
| `providerAccessRequestLimiter` | `backend/src/middleware/rateLimiter.ts:L211` | `providerRoutes.ts` (access-request fan-out) |
| `aiSpendGuard` | `backend/src/middleware/aiSpendGuard.ts:L28` | `aiRoutes.ts:L32`, `biomarkerRoutes.ts:L123`, ... (all AI routes) |
| `requirePlanLimit` / `requirePlanFeature` | `backend/src/middleware/planGating.ts:L37` / `L131` | `aiRoutes.ts`, `biomarkerRoutes.ts`, `uploadRoutes.ts`, `fhirRoutes.ts`, ... |
| ... | ... | ... |

### CSRF exemption list

Authority: `backend/src/middleware/csrf.ts` `validateCsrfToken` — a single flat `EXEMPT_PATHS` Set (`csrf.ts:124-145`). There are **no** named bucket variables; the "Group" column below is a conceptual label, not a code symbol. Every entry is a fully-qualified path (e.g. `/api/v1/auth/login`).

| Route(s) | Group (conceptual) | Exemption reason | Authority |
|---|---|---|---|
| `/auth/login`, `/auth/register`, `/auth/demo`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`, `/marketplace/plans/search` | public auth | Public/pre-session — no session cookie to protect yet. **`/auth/refresh` is deliberately NOT exempt** (RT-Low fix): it is cookie-authed and state-changing, so exempting it was a real CSRF hole — the SPA now double-submits `X-CSRF-Token` on `/refresh` (see comment `csrf.ts:114-123`). Also note `/marketplace/plans/search` is dead — the CMS Marketplace feature was removed; flag it. | `csrf.ts:124-132` |
| `POST /ai/chat` | Bearer-only streaming | SSE/`EventSource` can't attach `x-csrf-token`; safe ONLY because the route uses `requireBearerAuth` (cookie-auth rejected) | `csrf.ts:139` |
| `POST /internal/audit-cleanup` | scheduler | Cloud Scheduler can't carry the CSRF cookie; authed by constant-time `X-Cleanup-Token`; 404s unless `AUDIT_CLEANUP_TOKEN` set | `csrf.ts:144` |

NOTE: upload routes are **no longer CSRF-exempt** — the frontend `uploadUtils.ts` attaches `X-CSRF-Token` and the old exemption was removed so new upload paths fail closed (see `csrf.ts` comment ~L120-125).

### Demo-blocked routes

Every route behind a `blockDemo*` variant, with the variant named and justification. The variants:
- `blockDemoAI` — AI/PHI writes (biomarker create via guidance, insurance/expense AI, all upload routes, `/ai/chat`, FHIR connect/sync/delete). Justification: demo accounts cannot create real PHI / preserve AI quota.
- `blockDemoAdminAccess` — applied router-level in `adminRoutes.ts:L31` (runs between `authenticate` at `:L30` and `requireRole('ADMIN')` at `:L32`).
- `blockDemoProfileUpdate` — `settingsRoutes.ts` profile/account-mutating routes.
- `blockDemoUserModification`, `blockDemoRoleChange` — admin user-management / role-change paths.

### Validation schema map

Schemas live in the central `schemas` registry in `backend/src/middleware/validation.ts` (e.g. `schemas.auth.*`, `schemas.biomarker.*`, `schemas.ai.chat`, `schemas.uuidParam`, `schemas.connectionIdParam`). The `validate(schema, source?)` factory takes an optional source (`'body'` default, `'query'`, `'params'`).

| Schema | File:line | Validates (route + source) |
|---|---|---|
| `schemas.auth.login` | `backend/src/middleware/validation.ts:Lxx` | `POST /auth/login` (body) |
| `schemas.biomarker.create` | `...:Lxx` | `POST /biomarkers` (body) |
| `schemas.uuidParam` | `...:Lxx` | `GET/PATCH/DELETE /biomarkers/:id`, `DELETE /fhir/connections/:id` (params) |
| `schemas.ai.chat` | `...:Lxx` | `POST /ai/chat` (body) |
| `schemas.connectionIdParam` | `...:Lxx` | `POST /fhir/sync/:connectionId` (params) |
| ... | ... | ... |

### Drift / findings

Routes that appear to bypass the expected stack (e.g., PHI-writing route missing `authenticate`, or missing `withRLSContext`). If any, emit a red-flag list here and cross-link to `SECURITY_STATUS.md`.

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. Which middleware always runs before any route, in what order? (cite `app.ts`)
2. What's the middleware chain for `POST /api/v1/biomarkers`? (remember `authenticate` is router-level)
3. Which rate limiter guards `POST /api/v1/biomarkers/:id/guidance`, what window, and what else gates it (spend guard, plan limit)?
4. Which routes are in the `EXEMPT_PATHS` Set (exempt from CSRF), and why? (Confirm `/auth/refresh` is NOT among them.)
5. Which routes are blocked for demo accounts, and via which `blockDemo*` variant?
6. Which controller functions skip `withRLSContext` — and is any such skip a finding?
7. What validation schema validates `POST /api/v1/insurance/plans`?
8. Which routes require the `PROVIDER` role?
9. Which routes require the `ADMIN` role?
10. For `POST /api/v1/upload/lab-report`: what rate limiter, what auth, what demo gating, what plan limit, and which handler (in `controllers/upload/`)?
11. How many total endpoints exist? (count rows in the mega-table) — `internalRoutes` (`/internal/audit-cleanup`) is mounted in `app.ts`, count it too.
12. Which routes are guarded by `requirePlanLimit` / `requirePlanFeature`, and against which plan keys?
13. Which routes use `aiSpendGuard`, and how does it differ from `aiLimiter`?
14. Why is `GET /api/v1/fhir/callback` the one FHIR route with no `authenticate`, and what binds it to a user instead?
15. Why does `POST /api/v1/ai/chat` use `requireBearerAuth` instead of `authenticate`?

---

## No-TBD enforcement

Before marking anything TBD:

- **For the route list**: `Grep pattern: "router\\.(get|post|put|patch|delete)\\("` over `backend/src/routes/**`. Every hit is one row. Don't forget `internalRoutes.ts` — its base path (`/api/v1/internal`) comes from `app.ts`, not `routes/index.ts`.
- **For the middleware chain**: read each route file literally. The arguments passed to `router.X(...)` *are* the chain, in order. Account for **router-level** middleware applied via `router.use(...)` (e.g. `router.use(authenticate)` in biomarker/onboarding/etc., `router.use(requireBearerAuth)` in `aiRoutes`, `router.use(blockDemoAdminAccess)` in `adminRoutes`) — these apply to every route below them and are easy to miss.
- **For RLS wrap**: read the controller function body; grep for `withRLSContext(|withRLSTransaction(`. Upload handlers live under `backend/src/controllers/upload/` (there is no `uploadController.ts`).
- **For validation schema**: grep for `validate(` in the route file; the first argument resolves through the `schemas` registry (`schemas.<group>.<name>` or `schemas.uuidParam`), and the optional second argument is the source (`'query'` / `'params'`).
- **For plan gating / AI spend**: grep for `requirePlanLimit(|requirePlanFeature(|aiSpendGuard` in the route files; the plan keys come from `config/plans.ts`.
- **For CSRF exemptions**: read `backend/src/middleware/csrf.ts` — the single flat `EXEMPT_PATHS` Set (`csrf.ts:124-145`) of fully-qualified paths is the authoritative exemption set (no named bucket variables). Confirm `/api/v1/auth/refresh` is **absent** (it is intentionally not exempt).
- **For audit events**: `Grep pattern: "auditLog\\.log\\("` over the relevant controller file.

If a fact is not derivable from these files, mark `TBD (external: ...)` with a resolution path.

---

## Cross-links

The generated `ROUTING_TABLE.md` must link to:

- [`API_REFERENCE.md`](./API_REFERENCE.md) — contract-facing counterpart (request/response).
- [`ARCHITECTURE.md#middleware-stack`](./ARCHITECTURE.md) — global middleware.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — RLS policies each wrap relies on.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — per-field audit + redaction.
- [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) — what errors each guard produces.
- [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) — open findings on missing guards.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| List route files | Glob | `pattern: "backend/src/routes/*.ts"` |
| Enumerate endpoints | Grep | `pattern: "router\\.(get|post|put|patch|delete)\\("` over `backend/src/routes/**` |
| Find the `/internal` mount | Grep | `pattern: "internalRoutes"` over `backend/src/app.ts` |
| Find router-level middleware | Grep | `pattern: "router\\.use\\("` over `backend/src/routes/**` |
| Trace each controller | Read | `backend/src/controllers/<group>Controller.ts` (upload handlers: `backend/src/controllers/upload/`) |
| Find RLS wraps | Grep | `pattern: "withRLS(Context|Transaction)\\("` over `backend/src/controllers/**` |
| Find CSRF exemptions | Read | `backend/src/middleware/csrf.ts` |
| Find rate limiter registrations | Read | `backend/src/middleware/rateLimiter.ts` (8 limiters) |
| Find plan gating / AI spend | Grep | `pattern: "requirePlan(Limit|Feature)\\(|aiSpendGuard"` over `backend/src/routes/**` |
| Find validation schemas | Grep | `pattern: "validate\\("` over `backend/src/routes/**` |
| Find audit events | Grep | `pattern: "auditLog\\.log\\("` over `backend/src/controllers/**` |

---

## Output: file and location

Write the final document to `New Project Documents/ROUTING_TABLE.md`.
