---
tags:
  - documentation
  - api
type: prompt
priority: 2
updated: 2026-06-16
---

# Generate API_REFERENCE.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — identify endpoints that expose PHI. Note `PHI_FIELDS` now has 14 models / 39 fields (see `encryption.ts:476`); the Files endpoints return a decrypted `originalFilename` (PHI as of L24) — don't miss the Files group.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/API_REFERENCE.md` — the **contract-facing reference** for every API endpoint. A reader with only this doc must be able to: call any endpoint with a working `curl`, know the request + response shapes, know which errors it can return, and know what PHI it exposes. The security-stack lens (middleware chain per route) lives in `ROUTING_TABLE.md`; both docs cross-link heavily.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/routes/*.ts` (all 18 non-test, incl `index.ts`) | Endpoint enumeration + middleware chain. Note `internalRoutes.ts` is mounted in `backend/src/app.ts`, NOT in `routes/index.ts`. |
| `backend/src/routes/index.ts` | Base mount paths for the user-facing modules. |
| `backend/src/app.ts` | Where `/internal` is mounted (`app.use('/api/${config.apiVersion}/internal', internalRoutes)` ~L269) + global middleware order. |
| `backend/src/controllers/*.ts` (10 non-test + `index.ts`; `testHelpers.ts` is not a controller) and `backend/src/controllers/upload/*.ts` (the old monolithic `uploadController.ts` is GONE — upload handlers now live in `controllers/upload/`: `labUploadController.ts`, `sbcUploadController.ts`, `shared.ts`, re-exported via `controllers/upload/index.ts`). | Handler bodies — request parsing, response shape, `auditService.logCreate/logRead/logUpdate/logDelete/logAuth/logExport(...)` calls (controllers do NOT call `auditLog.log(...)` directly — `.log()` is the internal method behind the typed wrappers), thrown errors. |
| `backend/src/middleware/validation.ts` + controller-local schemas | Zod schemas for requests (`schemas.*`). |
| `backend/src/middleware/errorHandler.ts` | Error envelope format + all `AppError` subclass `code` values + Prisma/JWT/Multer error mapping. |
| `backend/src/middleware/rateLimiter.ts` | Rate limiter definitions (8 total), backed by `rateLimitStore.ts` (Redis via `REDIS_URL`, in-memory fallback). |
| `backend/src/middleware/planGating.ts` | `requirePlanLimit(...)` / `requirePlanFeature(...)` gates on upload/AI/FHIR routes. |
| `backend/src/middleware/aiSpendGuard.ts` | Daily AI budget guard on `POST /ai/chat`. |
| `backend/src/middleware/rbac.ts` | Role hierarchy (PATIENT < PROVIDER < ADMIN). |
| `backend/src/middleware/demoProtection.ts` | Demo-blocked routes (`blockDemoAI`, `blockDemoRoleChange`, `blockDemoAdminAccess`, `blockDemoUserModification`, `blockDemoProfileUpdate`, `demoProtection`). |
| `backend/src/services/auditLog.ts` | `AuditAction` enum (generic verbs — `LOGIN`, `LOGOUT`, `READ`, `VIEW`, `CREATE`, `UPDATE`, `DELETE`, `EXPORT`, `PHI_ACCESS`, …; defined in `schema.prisma:652-671`) + the typed wrappers (`logCreate`/`logRead`/`logUpdate`/`logDelete`/`logAuth`/`logExport`) and `logAuth`'s `AUTH_ACTION_MAP`. There are NO domain-specific actions like `BIOMARKER_CREATE`/`LOGIN_SUCCESS`. |
| `backend/src/services/encryption.ts` | Which fields are encrypted (`PHI_FIELDS` declared at `encryption.ts:476` — 14 models / 39 fields, incl. `UserFile.originalFilenameEncrypted`, `HealthGoal.target/current/startValueEncrypted`, `GoalProgressHistory.valueEncrypted`, `AuditLog.metadataEncrypted`) and thus decrypted in responses. |

---

## Required sections

1. **Base URL + auth model** — base URL per env, cookie vs Bearer, how `X-CSRF-Token` flows.
2. **Error envelope** — quote `errorHandler.ts` response shape; enumerate `code` values by scanning thrown errors.
3. **Global rate limits** — table of all 8 limiters.
4. **At-a-glance mega-table** (see Required artifacts) — every endpoint, one row.
5. **Per-endpoint-group sections** (one H2 per route file — 16 user-facing route-group files + 1 internal; `routes/index.ts` is the aggregator/health-check mount, covered in section 6, not its own group):
   - Auth (`authRoutes.ts`)
   - Biomarkers (`biomarkerRoutes.ts`)
   - Insurance (`insuranceRoutes.ts`)
   - Expenses (`expenseRoutes.ts`)
   - Health goals (`healthGoalsRoutes.ts`)
   - Health needs (`healthNeedsRoutes.ts`)
   - Uploads (`uploadRoutes.ts`) — handlers in `controllers/upload/` (`uploadLabReport`, `uploadSBC`, `uploadLabResultOCR`), gated by `uploadLimiter` + `aiLimiter` + `blockDemoAI` + `requirePlanLimit('pdfUploadsPerMonth')`. Endpoints: `POST /lab-report`, `POST /insurance-sbc`, `POST /lab-results-ocr` (PDF + image OCR via Document AI).
   - Files (`fileRoutes.ts`) — **PHI returned**: the file's `originalFilename` is now encrypted at rest (`UserFile.originalFilenameEncrypted`, L24) and decrypted on every response via `decryptOriginalFilename(file, encryption, userSalt)` (`fileController.ts:20,89,172,258`; also `settingsController.ts:651`), so `GET /files`, file-detail, and the settings data-export expose decrypted PHI (the raw client filename) — mark the Files group as PHI-returning.
   - Provider (`providerRoutes.ts`)
   - Patient (`patientRoutes.ts`)
   - Settings (`settingsRoutes.ts`)
   - Admin (`adminRoutes.ts`)
   - Onboarding (`onboardingRoutes.ts`) — `GET /status`, `POST /complete`; handlers inline, delegating to `onboardingService`.
   - FHIR (`fhirRoutes.ts`) — SMART-on-FHIR / Quest lab sync: `GET /callback` (public OAuth redirect, NO session auth), `GET /connect/quest`, `GET /connections`, `POST /sync/:connectionId`, `DELETE /connections/:id`. Gated by `requirePlanFeature('questFhirIntegration')` + `sensitiveLimiter`.
   - AI chat (`aiRoutes.ts`) — `POST /chat`, Bearer-only (`requireBearerAuth`, CSRF-exempt for SSE), gated by `aiLimiter` + `aiSpendGuard` + `blockDemoAI` + `requirePlanLimit('aiChatsPerDay')`.
   - Plan (`planRoutes.ts`) — `GET /available` (PUBLIC, no auth), `GET /` (authenticated tier + usage).
   - Internal (`internalRoutes.ts`, mounted in `app.ts` not `routes/index.ts`) — `POST /internal/audit-cleanup`, authenticated by the `X-Cleanup-Token` shared secret (NOT session JWT / CSRF), 404 when `AUDIT_CLEANUP_TOKEN` unset.
   - (Any others discovered via Glob — add a section.)
6. **Health checks** — `GET /api/v1/health` (in `routes/index.ts`) + `GET /api/v1/` (version/endpoint info) + any liveness/readiness endpoints in `app.ts`.
7. **Webhooks / external callbacks** — the FHIR OAuth callback (`GET /api/v1/fhir/callback`) and any SendGrid / Stripe-style hooks.
8. **Related Documents**.
9. **Prompt drift log**.

---

## Required artifacts

### At-a-glance mega-table

| Method | Path | Auth | CSRF | Rate limiter | RBAC role | RLS wrap | Controller (`file:fn:line`) | Audit event | PHI returned? |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/v1/auth/login` | public | yes | `authLimiter` + `strictAuthLimiter` | — | — | `authController.login:L270` | `LOGIN` (via `logAuth`) | none |
| GET | `/api/v1/biomarkers` | yes | no (GET) | `standardLimiter` | — | `withRLSContext` | `biomarkerController.getBiomarkers:L143` | `READ`/`VIEW` (via `logRead`) | yes — see `PHI_TAXONOMY.md` |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

### Per-endpoint entry (the 10 required fields per entry)

````markdown
#### `POST /api/v1/biomarkers`

Create a new biomarker reading for the authenticated user. Writes now go through the time-series merge service (see step 9) — a reading APPENDS to a single per-name series rather than creating a disconnected one-shot row, so the response carries a `history` array.

1. **Route**: `backend/src/routes/biomarkerRoutes.ts:L85`
2. **Middleware** (in order): `authenticate`, `standardLimiter`, `validate(...)`, `blockDemoAI`. (Illustrative — list the ACTUAL chain from the route file; demo guards are exported as `blockDemoAI` / `blockDemoRoleChange` / `blockDemoAdminAccess` / `blockDemoUserModification` / `blockDemoProfileUpdate` / `demoProtection`, there is no bare `blockDemo`.)
3. **Controller**: `biomarkerController.createBiomarker` (`backend/src/controllers/biomarkerController.ts:260`).
4. **RLS wrap**: `withRLSTransaction(userId, async (tx) => { ... })` — confirm the exact line span from the handler body.
5. **Request (Zod schema)**: the request type `BiomarkerCreateInput` is imported from `middleware/validation.js` (`biomarkerController.ts:12`); there is no longer an inline `createBiomarkerSchema` in the controller — follow the import to `middleware/validation.ts` and quote the real schema from there.
6. **Response (201)**: the controller returns a `BiomarkerResponse` (`biomarkerController.ts:62-86`) which includes a `history: { date; value }[]` array (the appended series), e.g.:

    ```json
    {
      "success": true,
      "data": {
        "id": "uuid...",
        "name": "...",
        "value": 5.4,
        "unit": "mg/dL",
        "date": "2026-04-24T10:00:00.000Z",
        "history": [{ "date": "2026-01-10T00:00:00.000Z", "value": 5.1 }]
      }
    }
    ```

7. **Errors**:

    | HTTP | `code` | Origin (file:line) | When |
    |---|---|---|---|
    | 422 | `VALIDATION_ERROR` | `errorHandler.ts:L65-L72` (`ValidationError`) | Zod schema fails |
    | 401 | `UNAUTHORIZED` / `AUTHENTICATION_FAILED` | `errorHandler.ts:L35-L45` | Missing/invalid access token |
    | 403 | `FORBIDDEN` | `errorHandler.ts:L47-L51` | Demo account write attempt (`blockDemoAI`) |
    | 429 | `RATE_LIMIT_EXCEEDED` | `rateLimiter.ts:L24` (`standardLimiter` message) | `standardLimiter` exceeded |

    > Use the **real** `code` values from `errorHandler.ts` (`UNAUTHORIZED`, `AUTHENTICATION_FAILED`, `FORBIDDEN`, `VALIDATION_ERROR`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMIT_EXCEEDED`, `FILE_TOO_LARGE`, `UPLOAD_ERROR`, `INVALID_JSON`, …) — not invented ones like `DEMO_BLOCKED` or `UNAUTHENTICATED`. Rate-limit responses carry limiter-specific codes (`AUTH_RATE_LIMIT_EXCEEDED`, `LOGIN_RATE_LIMIT_EXCEEDED`, `UPLOAD_RATE_LIMIT_EXCEEDED`, `AI_RATE_LIMIT_EXCEEDED`, `PROVIDER_REQUEST_RATE_LIMIT_EXCEEDED`, `BULK_RATE_LIMIT_EXCEEDED`, `SENSITIVE_RATE_LIMIT_EXCEEDED`).

8. **Working curl**:

    ```bash
    curl -X POST https://api.ownmyhealth.io/api/v1/biomarkers \
      -H "Cookie: access=<jwt>; csrfToken=<token>" \
      -H "X-CSRF-Token: <token>" \
      -H "Content-Type: application/json" \
      -d '{"name":"LDL","value":120,"unit":"mg/dL","measuredAt":"2026-04-24T10:00:00Z"}'
    ```

9. **Audit log**: `auditService.logCreate(RESOURCE_TYPE, biomarker.id, { ... })` — `biomarkerController.ts:305` (this resolves to the generic `CREATE` action; controllers call the typed wrappers, NOT `auditLog.log(...)`). Note the create path routes through `upsertBiomarkerReading` (`services/biomarkerSeries.ts`, imported at `biomarkerController.ts:17-21`), which appends to the series (anchor = newest row, `BiomarkerHistory` = older points) — so document the series/history semantics, not a one-shot insert.
10. **PHI exposure**: write of encrypted `valueEncrypted`, `notesEncrypted` (per `PHI_FIELDS.Biomarker` in `encryption.ts` — `unit` is NOT encrypted). Response decrypts. See [`PHI_TAXONOMY.md#biomarker`](./PHI_TAXONOMY.md#biomarker).

**Related**: [`ROUTING_TABLE.md#biomarkerroutes`](./ROUTING_TABLE.md), [`DATA_MODEL.md#biomarker`](./DATA_MODEL.md).
````

Every endpoint gets this shape. Do not abbreviate — a Claude Project cannot "just read the code."

### Global rate limits table

All 8 limiters are backed by `rateLimitStore.ts` — a shared Redis store when `REDIS_URL` is set, otherwise per-instance `MemoryStore` (so on Cloud Run with N instances the effective ceiling is N×limit). Confirm windows/maxes against `rateLimiter.ts`; current values:

| Limiter | Window | Max | File:line | Applied to |
|---|---|---|---|---|
| `standardLimiter` | `RATE_LIMIT_WINDOW_MS` (default 15 min) | `RATE_LIMIT_MAX_REQUESTS` (default 100) | `rateLimiter.ts:L17` | General API endpoints |
| `authLimiter` | 15 min | 20 | `rateLimiter.ts:L37` | Auth routes |
| `strictAuthLimiter` | 15 min | 5 (failed-only via `skipSuccessfulRequests`, key = `email:IP`) | `rateLimiter.ts:L53` | `/auth/login` |
| `uploadLimiter` | 1 hour | 20 | `rateLimiter.ts:L76` | File uploads (all `uploadRoutes`) |
| `sensitiveLimiter` | 1 hour | 10 | `rateLimiter.ts:L92` | Export, delete, FHIR connect/sync/delete |
| `aiLimiter` | 1 hour | 10 (key = user ID, fallback IP) | `rateLimiter.ts:L108` | Claude-calling endpoints (`/ai/chat`, uploads) |
| `providerAccessRequestLimiter` | 1 hour | 10 (key = user ID) | `rateLimiter.ts:L133` | Provider access-request fan-out |
| `bulkOperationLimiter` | 1 hour | 30 | `rateLimiter.ts:L157` | Batch creates / imports |

### Error envelope

Quote from `errorHandler.ts` (the `errorHandler` function, `res.status(statusCode).json(...)` ~L199-L210):

```ts
// Source: backend/src/middleware/errorHandler.ts:L199-L210
const response: ApiResponse = {
  success: false,
  error: {
    code,
    message,
    ...(details ? { details } : {}),         // ValidationError only
    ...(config.isDevelopment ? { stack: err.stack } : {}), // dev only
  },
};
res.status(statusCode).json(response);
```

Followed by a **full list** of possible `code` values. Most come from the `AppError` subclasses defined in `errorHandler.ts` (`BAD_REQUEST` 400, `UNAUTHORIZED`/`AUTHENTICATION_FAILED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `VALIDATION_ERROR` 422, `RATE_LIMIT_EXCEEDED` 429, `INTERNAL_ERROR` 500, `SERVICE_UNAVAILABLE` 503, `DATABASE_ERROR` 500, `EXTERNAL_SERVICE_ERROR` 502). The handler also maps non-AppError errors: Prisma (`P2002→CONFLICT`, `P2025→NOT_FOUND`, `P2003`/`P2014→BAD_REQUEST`), JWT (`INVALID_TOKEN`, `TOKEN_EXPIRED`), JSON parse (`INVALID_JSON` 400), and Multer (`FILE_TOO_LARGE` 413, `UPLOAD_ERROR` 400). Derive the remainder by grepping `new AppError(` / `throw new ` / limiter `code:` strings in `backend/src/**`. Cross-link to `ERROR_RECOVERY.md` for recovery playbooks.

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc + siblings**:

1. What's the base URL in production vs staging?
2. How does a browser attach credentials to a request? (cookie names + CSRF header)
3. What's the exact response shape of `POST /api/v1/auth/login`?
4. Which endpoints require the PROVIDER role? (count + list)
5. Which endpoints are blocked for demo accounts?
6. What rate limiter guards `POST /api/v1/biomarkers/:id/guidance`, and what's the window?
7. What's the error shape when a Zod schema fails, including the `code`?
8. What error do you get if you omit the CSRF header on a state-changing request?
9. Which endpoint returns a signed GCS URL, and how long is it valid for?
10. What PHI is returned by `GET /api/v1/biomarkers` and what's the decryption path?
11. How does the refresh-token flow work end-to-end? (sequence of calls)
12. Which endpoint produces a biomarker `CREATE` audit event (via `auditService.logCreate`), and what generic `AuditAction` does it map to? (There is no `BIOMARKER_CREATE` action — the enum is generic.)
13. What body does `POST /api/v1/insurance/upload-sbc` accept, and what's the max size? (also reachable at `POST /api/v1/upload/insurance-sbc`)
14. What response does `DELETE /api/v1/settings/account` return on success?
15. Which endpoint is used by a provider to request access to a patient, and what's the resulting state transition?
16. What happens when an AI endpoint's rate limit is exceeded — status, body (`code: AI_RATE_LIMIT_EXCEEDED`), retry hint? And what additionally blocks `POST /api/v1/ai/chat` before the rate limiter (`aiSpendGuard`, `requirePlanLimit('aiChatsPerDay')`)?
17. How does the Quest SMART-on-FHIR flow work end-to-end? (`GET /fhir/connect/quest` → provider redirect → `GET /fhir/callback` (public, PKCE+state) → `POST /fhir/sync/:connectionId`). Which env vars (`QUEST_FHIR_*`) and plan feature (`questFhirIntegration`) gate it?
18. How is `POST /api/v1/internal/audit-cleanup` authenticated, and why is it CSRF-exempt? What status does it return when `AUDIT_CLEANUP_TOKEN` is unset?
19. What does `GET /api/v1/plan/available` return without auth, and what does `GET /api/v1/plan` add for an authenticated user (usage + limits)?
20. How many distinct error `code` values exist across the API? (grep result)
21. What's the total endpoint count? (row count in the mega-table — 16 user-facing route modules + the internal cleanup endpoint)

---

## No-TBD enforcement

Before marking anything TBD:

- **Endpoint list**: `Grep pattern: "router\\.(get|post|put|patch|delete)\\("` over `backend/src/routes/**`. Every hit = one endpoint. Remember `internalRoutes.ts` is mounted in `app.ts`, so its base path comes from there, not `routes/index.ts`.
- **Request schemas**: read the controller file; grep `z.object({` and `schemas.` (shared schemas live in `middleware/validation.ts`). If a schema lives in a shared file, follow the import.
- **Response shape**: read the controller return; the response body is whatever `res.json({...})` ships. Upload handlers are in `controllers/upload/` (`labUploadController.ts`, `sbcUploadController.ts`), not a single `uploadController.ts`.
- **Errors**: `Grep pattern: "new AppError\\(|throw new "` over `backend/src/**` plus the limiter `code:` strings in `rateLimiter.ts`, cross-checked against the `AppError` subclasses + Prisma/JWT/Multer maps in `errorHandler.ts`.
- **Rate limiter membership**: read each route file for `aiLimiter`, `uploadLimiter`, `sensitiveLimiter`, `providerAccessRequestLimiter`, etc. and the `rateLimiter.ts` definitions (8 limiters).
- **Audit events**: `Grep pattern: "auditService\\.log(Create|Read|Update|Delete|Auth|Export)?\\("` in the relevant controller. Controllers call the typed wrappers (`logCreate`/`logRead`/`logUpdate`/`logDelete`/`logAuth`/`logExport`), NOT `auditLog.log(` — grepping the bare `.log(` returns nothing and would falsely conclude "no audit events". Map each wrapper to its generic `AuditAction` (e.g. `logCreate`→`CREATE`, `logAuth('login',...)`→`LOGIN` via `AUTH_ACTION_MAP`); there are no domain-specific action strings.
- **PHI exposure**: cross-check `encryption.ts` `PHI_FIELDS` against the controller's decrypt path.
- **Base URL**: check `backend/railway.toml`, `deploy.yml` `env:`, `CORS_ORIGIN` / `FRONTEND_URL` in `config/index.ts`. If prod URL is not in repo, mark `TBD (external: Cloud Run service URL, check `gcloud run services describe`)`.

---

## Cross-links

The generated `API_REFERENCE.md` must link to:

- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — same routes, middleware-chain lens.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — request lifecycle diagram.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — backing tables for each endpoint.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — PHI fields returned.
- [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) — recovery per error code.
- [`ENV_VARS.md`](./ENV_VARS.md) — CORS, base URL vars.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| List route files | Glob | `pattern: "backend/src/routes/*.ts"` |
| Find the `/internal` mount | Grep | `pattern: "internalRoutes"` over `backend/src/app.ts` |
| Enumerate endpoints | Grep | `pattern: "router\\.(get|post|put|patch|delete)\\("` |
| Find Zod schemas | Grep | `pattern: "z\\.object\\(\|schemas\\."` over `backend/src/**` |
| Find throws | Grep | `pattern: "new AppError\\(|throw new "` over `backend/src/**` |
| Find audit events | Grep | `pattern: "auditService\\.log(Create\|Read\|Update\|Delete\|Auth\|Export)?\\("` over `backend/src/controllers/**` (NOT `auditLog\.log\(` — that internal method is not called from controllers) |
| Read error handler | Read | `backend/src/middleware/errorHandler.ts` |
| Read rate limiters | Read | `backend/src/middleware/rateLimiter.ts` (8 limiters) + `rateLimitStore.ts` |
| Read plan gating | Read | `backend/src/middleware/planGating.ts` + `config/plans.ts` |
| Read AI spend guard | Read | `backend/src/middleware/aiSpendGuard.ts` |
| Read RBAC helper | Read | `backend/src/middleware/rbac.ts` |
| List upload handlers | Glob | `pattern: "backend/src/controllers/upload/*.ts"` |

---

## Questions to ask the user (last resort)

Only after exhausting the No-TBD search:

1. Production Cloud Run URL if not in `deploy.yml`.
2. Any internal/private endpoints used by automation (not in public docs).
3. Deprecation schedule for any endpoint marked `@deprecated`.

---

## Output: file and location

Write the final document to `New Project Documents/API_REFERENCE.md`.
