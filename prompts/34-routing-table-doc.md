---
tags:
  - documentation
  - routing
  - security
  - reference
type: prompt
priority: 2
updated: 2026-04-24
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

Both docs reference the same ~70 endpoints; they cross-link heavily. `ROUTING_TABLE.md` is what a security reviewer or a developer adding a new route should open first.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/routes/*.ts` (all 19 files) | **Source of truth** — middleware chain per route, in order. |
| `backend/src/routes/index.ts` | Route mounting (base paths per group). |
| `backend/src/controllers/*.ts` (all 10 files) | Handler function bodies — to locate RLS wrap usage and validation schemas. |
| `backend/src/middleware/auth.ts` | `authenticate` export. |
| `backend/src/middleware/csrf.ts` | CSRF middleware, exemptions. |
| `backend/src/middleware/rbac.ts` | `requireRole(...)` factory, role hierarchy. |
| `backend/src/middleware/rateLimiter.ts` | 7 named limiters (standard, auth, strictAuth, upload, sensitive, ai, bulkOperation). |
| `backend/src/middleware/validation.ts` | `validate(schema)` factory — which schemas validate which routes. |
| `backend/src/middleware/demoProtection.ts` | `blockDemo` / `blockDemoAI` — routes off-limits to demo users. |
| `backend/src/middleware/planGating.ts` | Feature-flag/plan gating. |
| `backend/src/index.ts` | Global middleware mount order (what runs before route-level). |

---

## Required sections

1. **Purpose + how to read** — 1 paragraph + 1 paragraph for the relationship to `API_REFERENCE.md`.
2. **Global middleware chain** — the order Express runs middleware before routes (Helmet, CORS, cookie-parser, CSRF, rate limit global, body-parser) — cite `backend/src/index.ts`.
3. **Route group index** — mega-table across all ~70 endpoints (see Required artifacts).
4. **Per-group deep dives** — one H2 per route file (authRoutes, biomarkerRoutes, insuranceRoutes, expenseRoutes, healthGoalsRoutes, healthNeedsRoutes, uploadRoutes, fileRoutes, providerRoutes, patientRoutes, settingsRoutes, adminRoutes, onboardingRoutes, fhirRoutes, aiRoutes, planRoutes, …). For each: the full route-file snippet (or representative slice), annotation of non-obvious middleware combos.
5. **Middleware cross-reference** — for each middleware, which routes use it.
6. **RLS wrap usage** — which controllers wrap their Prisma calls in `withRLSContext` / `withRLSTransaction`, which use the `null` admin context, and which (if any) skip wrapping — flagged as a security issue.
7. **CSRF exemption list** — Bearer-auth'd routes or webhook routes, with justification.
8. **Demo-blocked routes** — every route behind `blockDemo` or `blockDemoAI`.
9. **Validation schema map** — Zod schema name → routes it validates.
10. **Drift findings** — routes that bypass the expected stack (e.g., PHI route without auth).
11. **Related Documents**.
12. **Prompt drift log**.

---

## Required artifacts

### Mega-table (top of doc)

| Method | Path | Route file:line | Auth | CSRF | Rate limiter | RBAC | RLS wrap | Validation | Controller (`file:fn:line`) | Demo blocked? | Audit logged? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/v1/auth/login` | `authRoutes.ts:Lxx` | public | yes | `authLimiter` + `strictAuthLimiter` | — | — | `loginSchema` | `authController.login:L74` | — | yes |
| GET | `/api/v1/biomarkers` | `biomarkerRoutes.ts:L14` | yes | — (GET) | `standardLimiter` | — | `withRLSContext` | — | `biomarkerController.list:L22` | no | yes |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

Every endpoint gets one row. Do not truncate. Use `Grep pattern: "router\\.(get|post|put|patch|delete)"` to enumerate.

### Per-group deep dive (template)

````markdown
## `biomarkerRoutes.ts` (`backend/src/routes/biomarkerRoutes.ts`)

**Base mount**: `/api/v1/biomarkers` — `backend/src/routes/index.ts:Lxx`.

Annotated source:

```ts
// Source: backend/src/routes/biomarkerRoutes.ts:L10-L40
router.get('/', authenticate, standardLimiter, biomarkerController.list);
router.post(
  '/',
  authenticate,
  standardLimiter,
  validate(createBiomarkerSchema),
  blockDemo,
  biomarkerController.create,
);
// ...
```

Notable:
- All routes require `authenticate`.
- Writes are behind `blockDemo` — demo accounts get 403.
- `POST /batch` uses `bulkOperationLimiter` (rate-limited more strictly than `standardLimiter`).
- `GET /:id/guidance` uses `aiLimiter` (AI-specific budget) and logs to audit as `BIOMARKER_GUIDANCE`.

Controller → middleware chain summary:

| Route | Middleware chain (in order) | RLS wrap | Audit event |
|---|---|---|---|
| `GET /` | `authenticate, standardLimiter` | `withRLSContext` | `BIOMARKER_LIST` |
| `POST /` | `authenticate, standardLimiter, validate(createBiomarkerSchema), blockDemo` | `withRLSTransaction` | `BIOMARKER_CREATE` |
| ... | ... | ... | ... |
````

### Middleware cross-reference

| Middleware | File:line | Routes using it (count + file:line list) |
|---|---|---|
| `authenticate` | `backend/src/middleware/auth.ts:Lxx` | `biomarkerRoutes.ts:L14`, `biomarkerRoutes.ts:L22`, ... (N uses) |
| `aiLimiter` | `backend/src/middleware/rateLimiter.ts:Lxx` | `biomarkerRoutes.ts:Lxx` (guidance), `expenseRoutes.ts:Lxx` (analyze), ... |
| ... | ... | ... |

### CSRF exemption list

| Route | Exemption reason | Authority |
|---|---|---|
| `POST /api/v1/auth/refresh` | Bearer-authenticated, no cookie-based state change | `csrf.ts:Lxx` exemption list |
| ... | ... | ... |

### Demo-blocked routes

Every route with `blockDemo` or `blockDemoAI`, with justification (e.g., "demo accounts cannot create real PHI" or "AI quota preserved for real users").

### Validation schema map

| Schema | File:line | Validates |
|---|---|---|
| `loginSchema` | `backend/src/middleware/validation.ts:Lxx` or controller-local | `POST /auth/login` |
| `createBiomarkerSchema` | `...:Lxx` | `POST /biomarkers`, `POST /biomarkers/batch` |
| ... | ... | ... |

### Drift / findings

Routes that appear to bypass the expected stack (e.g., PHI-writing route missing `authenticate`, or missing `withRLSContext`). If any, emit a red-flag list here and cross-link to `SECURITY_STATUS.md`.

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. Which middleware always runs before any route, in what order?
2. What's the middleware chain for `POST /api/v1/biomarkers`?
3. Which rate limiter guards `POST /api/v1/biomarkers/:id/guidance` and what window?
4. Which routes are exempt from CSRF and why?
5. Which routes are blocked for demo accounts?
6. Which controller functions skip `withRLSContext` — and is any such skip a finding?
7. What validation schema validates `POST /api/v1/insurance/plans`?
8. Which routes require the `PROVIDER` role?
9. Which routes require the `ADMIN` role?
10. For `POST /api/v1/upload/lab-report`: what rate limiter, what auth, what demo gating, what audit event?
11. How many total endpoints exist? (count rows in the mega-table)
12. Which routes produce a `BIOMARKER_CREATE` audit event?

---

## No-TBD enforcement

Before marking anything TBD:

- **For the route list**: `Grep pattern: "router\\.(get|post|put|patch|delete)\\("` over `backend/src/routes/**`. Every hit is one row.
- **For the middleware chain**: read each route file literally. The arguments passed to `router.X(...)` *are* the chain, in order.
- **For RLS wrap**: read the controller function body; grep for `withRLSContext(|withRLSTransaction(`.
- **For validation schema**: grep for `validate(` in the route file; the argument name maps to a schema.
- **For CSRF exemptions**: read `backend/src/middleware/csrf.ts` — any explicit skip list is the authoritative exemption set.
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
| Trace each controller | Read | `backend/src/controllers/<group>Controller.ts` |
| Find RLS wraps | Grep | `pattern: "withRLS(Context|Transaction)\\("` over `backend/src/controllers/**` |
| Find CSRF exemptions | Read | `backend/src/middleware/csrf.ts` |
| Find rate limiter registrations | Read | `backend/src/middleware/rateLimiter.ts` |
| Find validation schemas | Grep | `pattern: "validate\\("` over `backend/src/routes/**` |
| Find audit events | Grep | `pattern: "auditLog\\.log\\("` over `backend/src/controllers/**` |

---

## Output: file and location

Write the final document to `New Project Documents/ROUTING_TABLE.md`.
