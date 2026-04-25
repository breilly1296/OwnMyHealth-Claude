---
tags:
  - documentation
  - api
type: prompt
priority: 2
updated: 2026-04-24
---

# Generate API_REFERENCE.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — identify endpoints that expose PHI.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/API_REFERENCE.md` — the **contract-facing reference** for every API endpoint. A reader with only this doc must be able to: call any endpoint with a working `curl`, know the request + response shapes, know which errors it can return, and know what PHI it exposes. The security-stack lens (middleware chain per route) lives in `ROUTING_TABLE.md`; both docs cross-link heavily.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/routes/*.ts` (all 19) | Endpoint enumeration + middleware chain. |
| `backend/src/routes/index.ts` | Base mount paths. |
| `backend/src/controllers/*.ts` (all 10) | Handler bodies — request parsing, response shape, `auditLog.log(...)` calls, thrown errors. |
| `backend/src/middleware/validation.ts` + controller-local schemas | Zod schemas for requests. |
| `backend/src/middleware/errorHandler.ts` | Error envelope format. |
| `backend/src/middleware/rateLimiter.ts` | Rate limiter definitions (7 total). |
| `backend/src/middleware/rbac.ts` | Role hierarchy (PATIENT < PROVIDER < ADMIN). |
| `backend/src/middleware/demoProtection.ts` | Demo-blocked routes. |
| `backend/src/services/auditLog.ts` | `AuditAction` enum — what `action` values exist. |
| `backend/src/services/encryption.ts` | Which fields are encrypted (and thus decrypted in responses). |

---

## Required sections

1. **Base URL + auth model** — base URL per env, cookie vs Bearer, how `X-CSRF-Token` flows.
2. **Error envelope** — quote `errorHandler.ts` response shape; enumerate `code` values by scanning thrown errors.
3. **Global rate limits** — table of all 7 limiters.
4. **At-a-glance mega-table** (see Required artifacts) — every endpoint, one row.
5. **Per-endpoint-group sections** (one H2 per route file):
   - Auth (`authRoutes.ts`)
   - Biomarkers (`biomarkerRoutes.ts`)
   - Insurance (`insuranceRoutes.ts`)
   - Expenses (`expenseRoutes.ts`)
   - Health goals (`healthGoalsRoutes.ts`)
   - Health needs (`healthNeedsRoutes.ts`)
   - Uploads (`uploadRoutes.ts`)
   - Files (`fileRoutes.ts`)
   - Provider (`providerRoutes.ts`)
   - Patient (`patientRoutes.ts`)
   - Settings (`settingsRoutes.ts`)
   - Admin (`adminRoutes.ts`)
   - Onboarding (`onboardingRoutes.ts`)
   - FHIR (`fhirRoutes.ts`)
   - AI chat (`aiRoutes.ts`)
   - Plan (`planRoutes.ts`)
   - (Any others discovered via Glob — add a section.)
6. **Health checks** — `GET /health` + any liveness/readiness endpoints.
7. **Webhooks / external callbacks** — if any (e.g., SendGrid, Stripe-style).
8. **Related Documents**.
9. **Prompt drift log**.

---

## Required artifacts

### At-a-glance mega-table

| Method | Path | Auth | CSRF | Rate limiter | RBAC role | RLS wrap | Controller (`file:fn:line`) | Audit event | PHI returned? |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/v1/auth/login` | public | yes | `authLimiter` + `strictAuthLimiter` | — | — | `authController.login:L74` | `LOGIN_SUCCESS` / `LOGIN_FAIL` | none |
| GET | `/api/v1/biomarkers` | yes | no (GET) | `standardLimiter` | — | `withRLSContext` | `biomarkerController.list:L22` | `BIOMARKER_LIST` | yes — see `PHI_TAXONOMY.md` |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

### Per-endpoint entry (the 10 required fields per entry)

````markdown
#### `POST /api/v1/biomarkers`

Create a new biomarker reading for the authenticated user.

1. **Route**: `backend/src/routes/biomarkerRoutes.ts:L18`
2. **Middleware** (in order): `authenticate`, `standardLimiter`, `validate(createBiomarkerSchema)`, `blockDemo`.
3. **Controller**: `biomarkerController.create` (`backend/src/controllers/biomarkerController.ts:L52`).
4. **RLS wrap**: `withRLSTransaction(userId, async (tx) => { ... })` — `...:L58-L90`.
5. **Request (Zod schema)**:

    ```ts
    // Source: backend/src/controllers/biomarkerController.ts:L42-L48
    const createBiomarkerSchema = z.object({
      name: z.string().min(1).max(100),
      value: z.number(),
      unit: z.string().min(1).max(20),
      measuredAt: z.string().datetime(),
      notes: z.string().max(2000).optional(),
    });
    ```

6. **Response (201)**:

    ```json
    {
      "success": true,
      "data": {
        "id": "cuid...",
        "name": "...",
        "value": 5.4,
        "unit": "mg/dL",
        "measuredAt": "2026-04-24T10:00:00.000Z"
      }
    }
    ```

7. **Errors**:

    | HTTP | `code` | Origin (file:line) | When |
    |---|---|---|---|
    | 400 | `VALIDATION_ERROR` | `validation.ts:Lxx` | Zod schema fails |
    | 401 | `UNAUTHENTICATED` | `auth.ts:Lxx` | Missing/invalid access token |
    | 403 | `DEMO_BLOCKED` | `demoProtection.ts:Lxx` | Demo account write attempt |
    | 429 | `RATE_LIMIT_EXCEEDED` | `rateLimiter.ts:Lxx` | `standardLimiter` exceeded |

8. **Working curl**:

    ```bash
    curl -X POST https://api.ownmyhealth.io/api/v1/biomarkers \
      -H "Cookie: access=<jwt>; csrfToken=<token>" \
      -H "X-CSRF-Token: <token>" \
      -H "Content-Type: application/json" \
      -d '{"name":"LDL","value":120,"unit":"mg/dL","measuredAt":"2026-04-24T10:00:00Z"}'
    ```

9. **Audit log**: `auditLog.log({ action: 'BIOMARKER_CREATE', resourceType: 'Biomarker', resourceId: id, newValues: {...} })` — `biomarkerController.ts:L85`.
10. **PHI exposure**: write of encrypted `valueEncrypted`, `unitEncrypted`, `notesEncrypted`. Response decrypts. See [`PHI_TAXONOMY.md#biomarker`](./PHI_TAXONOMY.md#biomarker).

**Related**: [`ROUTING_TABLE.md#biomarkerroutes`](./ROUTING_TABLE.md), [`DATA_MODEL.md#biomarker`](./DATA_MODEL.md).
````

Every endpoint gets this shape. Do not abbreviate — a Claude Project cannot "just read the code."

### Global rate limits table

| Limiter | Window | Max | File:line | Applied to |
|---|---|---|---|---|
| `standardLimiter` | 15 min | 100 | `rateLimiter.ts:Lxx` | All endpoints (global) |
| `authLimiter` | 15 min | 20 | `rateLimiter.ts:Lxx` | Auth routes |
| `strictAuthLimiter` | 15 min | 5 (failed-only, email:IP) | `rateLimiter.ts:Lxx` | `/auth/login` |
| `uploadLimiter` | 1 hour | 20 | `rateLimiter.ts:Lxx` | File uploads |
| `sensitiveLimiter` | 1 hour | 10 | `rateLimiter.ts:Lxx` | Export, delete |
| `aiLimiter` | 1 hour | N | `rateLimiter.ts:Lxx` | Claude-calling endpoints |
| `bulkOperationLimiter` | 1 hour | 30 | `rateLimiter.ts:Lxx` | Batch creates |

### Error envelope

Quote from `errorHandler.ts`:

```ts
// Source: backend/src/middleware/errorHandler.ts:Lxx-Lyy
res.status(status).json({
  success: false,
  error: { code, message, details? },
});
```

Followed by a **full list** of possible `code` values, derived by grepping `new AppError(` and `throw new` in `backend/src/**`. Cross-link to `ERROR_RECOVERY.md` for recovery playbooks.

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
12. Which endpoint produces a `BIOMARKER_CREATE` audit event?
13. What body does `POST /api/v1/insurance/plans/upload-sbc` accept, and what's the max size?
14. What response does `DELETE /api/v1/settings/account` return on success?
15. Which endpoint is used by a provider to request access to a patient, and what's the resulting state transition?
16. What happens when an AI endpoint's rate limit is exceeded — status, body, retry hint?
17. How many distinct error `code` values exist across the API? (grep result)
18. What's the total endpoint count? (row count in the mega-table)

---

## No-TBD enforcement

Before marking anything TBD:

- **Endpoint list**: `Grep pattern: "router\\.(get|post|put|patch|delete)\\("` over `backend/src/routes/**`. Every hit = one endpoint.
- **Request schemas**: read the controller file; grep `z.object({`. If schema lives in a shared file, follow the import.
- **Response shape**: read the controller return; the response body is whatever `res.json({...})` ships.
- **Errors**: `Grep pattern: "new AppError\\(|throw new "` over `backend/src/**` to enumerate every `code`.
- **Rate limiter membership**: read each route file for `aiLimiter`, `uploadLimiter`, etc. and the `rateLimiter.ts` definition.
- **Audit events**: `Grep pattern: "auditLog\\.log\\("` in the relevant controller.
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
| Enumerate endpoints | Grep | `pattern: "router\\.(get|post|put|patch|delete)\\("` |
| Find Zod schemas | Grep | `pattern: "z\\.object\\("` over `backend/src/**` |
| Find throws | Grep | `pattern: "new AppError\\(|throw new "` over `backend/src/**` |
| Find audit events | Grep | `pattern: "auditLog\\.log\\("` over `backend/src/controllers/**` |
| Read error handler | Read | `backend/src/middleware/errorHandler.ts` |
| Read rate limiters | Read | `backend/src/middleware/rateLimiter.ts` |
| Read RBAC helper | Read | `backend/src/middleware/rbac.ts` |

---

## Questions to ask the user (last resort)

Only after exhausting the No-TBD search:

1. Production Cloud Run URL if not in `deploy.yml`.
2. Any internal/private endpoints used by automation (not in public docs).
3. Deprecation schedule for any endpoint marked `@deprecated`.

---

## Output: file and location

Write the final document to `New Project Documents/API_REFERENCE.md`.
