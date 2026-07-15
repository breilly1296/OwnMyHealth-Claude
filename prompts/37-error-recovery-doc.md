---
tags:
  - documentation
  - errors
  - operational
  - reference
type: prompt
priority: 2
updated: 2026-06-16
---

# Generate ERROR_RECOVERY.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/ERROR_RECOVERY.md` — the **every-error-code playbook**. Symptom → root cause → user-facing message → developer recovery action → related code paths. A frontend dev seeing a `403 FORBIDDEN` (CSRF token missing/invalid) or a `401 TOKEN_EXPIRED` should land here and know exactly what to do.

> **NOTE on error model.** Codes are NOT free-form strings passed to `AppError`. Each code comes from either (a) a typed subclass in `errorHandler.ts` — `AppError` signature is `(message, statusCode, code, isOperational)`, so the *subclass* fixes the code (e.g., `ForbiddenError` → `FORBIDDEN`); (b) an inline mapping in `errorHandler.ts` for Prisma / JWT / Multer / JSON-syntax errors; (c) a per-limiter `message.error.code` in `rateLimiter.ts`; or (d) a hand-built `res.status(...).json({ error: { code } })` in newer controllers (FHIR, AI chat, plan gating). Enumerate from all four sources — see No-TBD enforcement. Do NOT assume codes like `UNAUTHENTICATED`, `SESSION_EXPIRED`, `CSRF_MISMATCH`, `DEMO_BLOCKED`, or `RLS_DENIED` exist; verify every code against the code before writing a row.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/middleware/errorHandler.ts` | Error envelope + `AppError` class + **all 12 typed subclasses** (`BadRequestError`, `UnauthorizedError`, `AuthenticationError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`, `RateLimitError`, `InternalServerError`, `ServiceUnavailableError`, `DatabaseError`, `ExternalServiceError`) + the Prisma / JWT / Multer / JSON-syntax mapping (`INVALID_TOKEN`, `TOKEN_EXPIRED`, `FILE_TOO_LARGE`, `UPLOAD_ERROR`, `INVALID_JSON`). |
| All of `backend/src/controllers/*.ts`, `backend/src/controllers/upload/*.ts`, and `backend/src/services/*.ts` | Grep every `new <Subclass>Error(`, `throw new`, `res.status(...).json({ error: ... })`. Note upload logic now lives in `controllers/upload/` (`labUploadController.ts`, `sbcUploadController.ts`, `shared.ts`) — the old `uploadController.ts` no longer exists. |
| `backend/src/middleware/auth.ts`, `csrf.ts`, `rbac.ts`, `rateLimiter.ts`, `rateLimitStore.ts`, `validation.ts`, `demoProtection.ts`, `planGating.ts`, `aiSpendGuard.ts` | Middleware throws / hand-built error bodies (the last three are NEW — `planGating` emits `PLAN_LIMIT_EXCEEDED` with an `upgradeRequired` envelope; `aiSpendGuard` emits `SERVICE_UNAVAILABLE` 503 on budget exhaustion). |
| `backend/src/controllers/fhirController.ts`, `backend/src/services/fhir/*.ts` | NEW FHIR/Quest lab-sync error paths — hand-built `res.status().json()` codes (`SERVICE_UNAVAILABLE`, `CONNECT_FAILED`, `NOT_FOUND`) + sync/disconnect failures that now `throw ExternalServiceError` → 502 `EXTERNAL_SERVICE_ERROR` (NOT a hand-built `SYNC_FAILED` HTTP code — `SYNC_FAILED` is audit-only) + OAuth-callback redirect-with-`error=` fallbacks. |
| `src/services/api/client.ts` | Frontend **fetch** wrapper (not axios) — `ERROR_MESSAGES` code→message map, one-shot 401 → `/auth/refresh` retry, and `isPlanLimitError()` narrowing for `PLAN_LIMIT_EXCEEDED` upgrade CTAs. |
| `src/components/**` | Which UI components render error states — grep for error-display components. |

---

## Required sections

1. **Error envelope** — quote `errorHandler.ts`; show the canonical shape (`{ success: false, error: { code, message, details?, stack? } }`, stack dev-only) AND flag the newer hand-built bodies (FHIR / AI chat) that emit `{ error: { code, message } }` **without** the top-level `success: false` — a real inconsistency worth documenting.
2. **HTTP status conventions** — 400 / 401 / 403 / 404 / 409 / 413 / 422 / 429 / 500 / 502 / 503 mapping. (There is NO 419 in this codebase — session/token expiry surfaces as 401 `TOKEN_EXPIRED`. Oversize uploads are 413 `FILE_TOO_LARGE`.)
3. **Master error-code table** (see Required artifacts) — every `code` constant from all four sources.
4. **Per-code deep dives** — H3 per code, grouped by family (auth/token, CSRF, validation, RBAC, rate limit — 8 distinct limiter codes, plan gating, AI/spend, FHIR/lab-sync, storage, system).
5. **Frontend interpretation layer** — how `client.ts` (a fetch wrapper) maps codes via `ERROR_MESSAGES`, the one-shot 401 → `/auth/refresh` retry, the **429 retry-with-backoff** (`client.ts:200` `MAX_RETRY_429=3`; `:291-301` honors `Retry-After`, else exponential 1s/2s/4s + ±25% jitter before surfacing — note this is NOT a blanket "hard-logout on 429"; only a 429 on the `/auth/refresh` path forces hard-logout), and `isPlanLimitError()` upgrade-CTA handling.
6. **Auth state decision tree** — 401 (`UNAUTHORIZED` / `TOKEN_EXPIRED` / `INVALID_TOKEN`) vs 403 (`FORBIDDEN`) flowchart (ASCII), including the auth-management-endpoint exemption (`isAuthMgmtEndpoint` = `/auth/refresh`, `/auth/logout`, `/auth/logout-all` — 3 endpoints — never trigger a refresh retry; `client.ts:269-272`).
7. **Recovery playbooks** — four full recipes: "user stuck with 401 loop", "AI endpoint returning 500 / 503 budget exhaustion", "upload 413 FILE_TOO_LARGE", "Quest FHIR lab sync failing (sync throws `ExternalServiceError` → 502 `EXTERNAL_SERVICE_ERROR`; `SYNC_FAILED` is audit-only; OAuth `error=connection_failed`)".
8. **Logging + audit** — which errors must emit an audit log (e.g., failed login) and which are noise.
9. **Known error drift** — error codes thrown in code but not documented here at first pass; a second pass closes them.
10. **Related Documents**.
11. **Prompt drift log**.

---

## Required artifacts

### Master error-code table

> Codes below are **real** (verified 2026-06-01). Resolve every `Lxx` to a concrete line from the cited file before writing — these are starting points, not the full set.

| `code` | HTTP status | User-facing message (source) | Thrown at (file:line list) | Recovery action | Related |
|---|---|---|---|---|---|
| `UNAUTHORIZED` | 401 | "Authentication required" / "Invalid token" / "Token has expired…" | `auth.ts:83,91,99,107` + catch `next()` branches `:124,126` (and `206,211,217,223` bearer path) — also `errorHandler.ts:37` (`UnauthorizedError`) | Frontend retries once via `/auth/refresh`; if that fails, hard-logout → `/login` | [`API_REFERENCE.md#auth-endpoints`](./API_REFERENCE.md) |
| `TOKEN_EXPIRED` / `INVALID_TOKEN` | 401 | "Authentication token has expired" / "Invalid authentication token" | `errorHandler.ts:123-124` (JWT_ERROR_MAP — raw `jsonwebtoken` errors that bypass the subclass) | Same as 401 refresh flow | — |
| `FORBIDDEN` | 403 | "CSRF token missing" / "Invalid CSRF token" / "Demo account cannot…" / RBAC denials | `csrf.ts:169` (token missing), `:182` (invalid token); `:155` is the EXEMPT_PATHS `return next()` (not a throw); `demoProtection.ts:54,73,…`; `rbac.ts` (`ForbiddenError`); `errorHandler.ts:49` | CSRF: reload CSRF cookie + re-read header + re-submit. RBAC/demo: surface toast, no retry | [`ROUTING_TABLE.md#csrf-exemption-list`](./ROUTING_TABLE.md) |
| `VALIDATION_ERROR` | 422 | Field-specific (`details` payload) | `validation.ts` + `errorHandler.ts:69` (`ValidationError`, status **422** not 400) | Fix request body per schema | schema in `API_REFERENCE.md` |
| `INVALID_JSON` | 400 | "Request body contains invalid JSON" | `errorHandler.ts:164` (SyntaxError branch) | Send well-formed JSON | — |
| `RATE_LIMIT_EXCEEDED` (+ 7 siblings) | 429 | "Too many requests…" | `rateLimiter.ts` — 8 limiters, each its own code: `RATE_LIMIT_EXCEEDED` (standard), `AUTH_RATE_LIMIT_EXCEEDED`, `LOGIN_RATE_LIMIT_EXCEEDED`, `UPLOAD_RATE_LIMIT_EXCEEDED`, `SENSITIVE_RATE_LIMIT_EXCEEDED`, `AI_RATE_LIMIT_EXCEEDED`, `PROVIDER_REQUEST_RATE_LIMIT_EXCEEDED`, `BULK_RATE_LIMIT_EXCEEDED` | Wait for `RateLimit-Reset` (`standardHeaders: true`) | [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) |
| `PLAN_LIMIT_EXCEEDED` | 403 | "You've reached your plan limit (…). Upgrade to continue." | `planGating.ts:104` (hand-built body code with `limit`/`current`/`feature`/`upgradeRequired`); `res.status(403)` at `:115` | Frontend `isPlanLimitError()` → upgrade CTA, not generic toast | [`API_REFERENCE.md`](./API_REFERENCE.md) |
| `SERVICE_UNAVAILABLE` | 503 | "AI features are temporarily unavailable (daily budget reached)…" / "AI Health Guide is disabled: ANTHROPIC_BAA_ACTIVE…" / "Quest FHIR integration is not configured…" | `aiSpendGuard.ts:54-67` (budget-reached `!admission.admitted` → `ServiceUnavailableError` — **503, not 429**; note `:42` is the Redis store-error fail-closed log line, a different cause); `aiChatController.ts:159` (BAA gate, message at `:161`); `fhirController.ts:46` (Quest unconfigured, code at `:49`); `errorHandler.ts:87` (`ServiceUnavailableError`) | Retry later; ops: check `AI_DAILY_BUDGET_USD`/`AI_USER_DAILY_BUDGET_USD`, `ANTHROPIC_BAA_ACTIVE`, `QUEST_FHIR_CLIENT_ID` | [`RUNBOOK.md#incident-playbooks`](./RUNBOOK.md) |
| `NOT_FOUND` | 404 | "Resource not found" / "Connection not found" | `errorHandler.ts:55` (`NotFoundError`), Prisma `P2025` (`errorHandler.ts:111`), `fhirController.ts:184` (`res.status(404)`) / `:186` (`code: 'NOT_FOUND'`) | Verify ID; an RLS-filtered row also surfaces as 404 (see note) | [`DATA_MODEL.md#rls-policies`](./DATA_MODEL.md) |
| RLS-filtered read | 404 (masked) | (surfaces as `NOT_FOUND`) | Postgres RLS policy (no explicit code — `findFirst`/`findUnique` returns null → controller 404) | See recovery playbook | [`ARCHITECTURE.md#rls-enforcement-path`](./ARCHITECTURE.md) |
| `FILE_TOO_LARGE` | 413 | "File too large. Maximum upload size is 10MB." | `errorHandler.ts:171` (MulterError `LIMIT_FILE_SIZE`) | Reduce file size | [`API_REFERENCE.md#upload-endpoints`](./API_REFERENCE.md) |
| `UPLOAD_ERROR` | 400 | "File upload failed. Check the file and try again." | `errorHandler.ts:173` (other MulterError) | Re-check file/field name | [`API_REFERENCE.md#upload-endpoints`](./API_REFERENCE.md) |
| `CONNECT_FAILED` | 500 | "Could not start the Quest connection flow." | `fhirController.ts:69` (hand-built body code) | Retry; ops: inspect Quest OAuth + `labSyncService` logs | [`RUNBOOK.md`](./RUNBOOK.md) |
| `EXTERNAL_SERVICE_ERROR` | 502 | "Lab provider: Could not sync lab results…" | `fhirController.ts:201` (`triggerSync` throws `ExternalServiceError('Lab provider', …)`), `:225` (`deleteConnection` throws `ExternalServiceError`) → `errorHandler.ts:98-102` (`ExternalServiceError` → 502). NOTE: there is **no** hand-built `SYNC_FAILED` HTTP code — `SYNC_FAILED` exists only as an audit `operation` string at `labSyncService.ts:423` | Retry; ops: inspect Quest OAuth + `labSyncService` logs, expired tokens, `urlSafety` SSRF rejection | [`RUNBOOK.md`](./RUNBOOK.md) |
| storage failure | 500 (`INTERNAL_ERROR`) | generic | `storageService.ts:90,145` throw **plain `Error`** (no dedicated code) → falls through to default 500. Flag the absence of a `STORAGE_ERROR` code in Known error drift | [`RUNBOOK.md#incident-playbooks`](./RUNBOOK.md) |
| ... | ... | ... | ... | ... | ... |

Every `throw new <Subclass>Error(` AND every hand-built `res.status(...).json({ error: { code } })` occurrence in `backend/src/**` must map to a row (~187 typed throws across 29 non-test files plus the controller-level hand-built bodies).

### Per-code deep dive (template)

```markdown
### `UNAUTHORIZED` (HTTP 401)

**Thrown at**:
- `backend/src/middleware/auth.ts:83` — access token missing (`UnauthorizedError('Authentication required')`).
- `backend/src/middleware/auth.ts:91` — session revoked; `:99` invalid token type; `:107` stale token (tokens-valid-after cutoff); `:124/:126` the catch `next(...)` branches (expired / invalid). The bearer path (`requireBearerAuth`) throws at `:206,211,217,223`.
- `backend/src/controllers/authController.ts:289,347,356` — bad-password login audits `LOGIN_FAILED` then returns a sanitized 401 (the auth event is the audit, not the HTTP code); `:310,334` audit `ACCOUNT_LOCKOUT`.

**User message**: "Authentication required" / "Token has expired. Please refresh your session." (from the subclass constructor; raw `jsonwebtoken` errors map to `TOKEN_EXPIRED` / `INVALID_TOKEN` at `errorHandler.ts:123-124`).

**Developer recovery**:
1. The client retries ONCE via `POST /api/v1/auth/refresh` (cookie-borne refresh token).
2. If refresh returns 401 (terminal) or 429 (rate-limited), hard-logout via `onAuthFailureCallback`; clear in-memory access token → `/login`.
3. After re-login, retry the original request.

**Snippet**:

```ts
// Source: backend/src/middleware/auth.ts:83
throw new UnauthorizedError('Authentication required');
```

**Audit log**: yes — failed login emits `LOGIN_FAILED` via `auditService.logAuth('LOGIN_FAILED', ...)` at `authController.ts:289` (and `:347,:356`); `ACCOUNT_LOCKOUT` is audited at `:310,:334`.

**Frontend handling**: `src/services/api/client.ts:308` (parse-error path) and `:327` (normal path) — the fetch wrapper detects `status === 401` (when `!isRetry && !isAuthMgmtEndpoint`) and calls `attemptTokenRefresh()`.
```

### 401 vs 403 flowchart

(There is NO 419 path — token/session expiry is a 401 `TOKEN_EXPIRED`.)

```
  API call → 401 ──▶ retry already attempted, or /auth/refresh|/auth/logout|/auth/logout-all endpoint?
                          │                                  │
                         yes                                no
                          │                                  ▼
                          ▼                          call /auth/refresh ──▶ success? ──yes──▶ retry original (one-shot)
                  hard logout (onAuthFailureCallback)              │
                          │                                       no (401 terminal, or 429 rate-limited)
                          ▼                                        ▼
                    redirect /login                          hard logout → /login

  API call → 403 FORBIDDEN ──▶ CSRF (reload cookie + re-submit) | RBAC/consent/demo (surface toast, no retry)
  API call → 403 PLAN_LIMIT_EXCEEDED ──▶ isPlanLimitError() → upgrade CTA with limit/current
```

### Recovery playbooks (narratives)

Write three or four end-to-end playbooks, e.g.:

#### Playbook: user stuck with `401` loop

1. The fetch wrapper is one-shot by design (`client.ts:308,327` guard on `!isRetry && !isAuthMgmtEndpoint`); a true loop means the original request is re-issued without the retry flag — inspect callers.
2. Check `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` rotation — if a deploy rotated secrets, all existing sessions are invalid and `/auth/refresh` will 401.
3. Inspect access/refresh TTLs (`JWT_ACCESS_EXPIRES_SECONDS`, `JWT_REFRESH_EXPIRES_SECONDS` in `config/index.ts`).
4. Forced resolution: revoke sessions server-side (DB-backed `Session` table) so the next refresh fails cleanly into hard-logout.

#### Playbook: AI endpoint returning 500 / 503

1. **503 `SERVICE_UNAVAILABLE` with "daily budget reached"** → the `!admission.admitted` branch at `aiSpendGuard.ts:54-67` tripped (NOT `:42`, which is the Redis store-error fail-closed log line); check `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` and the `aiCostTracker` accumulator. This is the spend circuit breaker, NOT a 429.
2. **503 with "ANTHROPIC_BAA_ACTIVE…"** → BAA gate at `aiChatController.ts:159` (message `:161`); confirm `ANTHROPIC_BAA_ACTIVE=true` (see memory postmortem on Cloud Run env pinning).
3. **500 `CONTEXT_ASSEMBLY_FAILED`** → `aiChatController.ts:177`; health-context assembly failed (RLS/decryption) — inspect logs for the wrapped error.
4. **500 from extraction** → `claudeExtraction.ts:108,181,209,220,251,257,262,267` wrap timeouts / config / parse failures as `InternalServerError`; check `ANTHROPIC_API_KEY` and Anthropic status.

#### Playbook: Quest FHIR lab sync failing

1. **503 `SERVICE_UNAVAILABLE` "Quest FHIR integration is not configured"** → `fhirController.ts:46` (`res.status(503)`, code at `:49`); set `QUEST_FHIR_CLIENT_ID` (+ secret/base/redirect env vars).
2. **OAuth callback bounce `?error=connection_failed`** → `fhirController.ts:131` (redirect with `error=connection_failed`); token exchange in `labSyncService.handleOAuthCallback` failed — inspect logs.
3. **502 `EXTERNAL_SERVICE_ERROR`** → `triggerSync` at `fhirController.ts:201` throws `ExternalServiceError('Lab provider', 'Could not sync lab results…')` (and `deleteConnection` at `:225`), mapped to 502 by `errorHandler.ts:98-102`. There is no hand-built `SYNC_FAILED` HTTP code — `SYNC_FAILED` is only an audit `operation` string at `labSyncService.ts:423`. Check `labSyncService` / `loincMapper`, expired OAuth tokens (`LabConnection.refreshTokenEncrypted`), or `urlSafety` SSRF rejection.
4. **404 "Connection not found"** → `fhirController.ts:184` (`res.status(404)`) / `:186` (`code: 'NOT_FOUND'`); RLS-scoped `findFirst` returned null for that `connectionId`.

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc + siblings**:

1. How many distinct error `code` values exist in the API (subclasses + mapped + 8 rate-limit codes + hand-built controller codes)?
2. How does token expiry surface — what status and code (there is no 419 / `SESSION_EXPIRED`), and how should a client react?
3. What status and code does a missing/invalid CSRF token produce, and what's the recovery? (`csrf.ts:169` token missing, `:182` invalid token)
4. Does a 404 `NOT_FOUND` ever mask an RLS-filtered row? (yes — why, and how to tell the difference?)
5. What header carries reset timing on a `429` (`standardHeaders: true`), and which of the 8 limiters set each distinct code?
6. When an AI call hits the spend budget, what status + code is returned (503, not 429), and where (`aiSpendGuard.ts:54-67`, the `!admission.admitted` branch — not `:42`, the store-error log)?
7. Which errors are audited, and where? (e.g., `LOGIN_FAILED` via `auditService.logAuth(...)` at `authController.ts:289,347,356`; `ACCOUNT_LOCKOUT` at `:310,334`)
8. Does the frontend auto-refresh the access token on 401? Where, and what makes it one-shot? (`client.ts:308,327`, guarded by `!isRetry && !isAuthMgmtEndpoint`)
9. What's the recovery for `PHI_ENCRYPTION_KEY` rotation mid-session?
10. What happens if a protected endpoint is hit with no/invalid auth? Status + code? (`auth.ts:83`)
11. Which error surfaces when demo accounts try a blocked mutation — what code and status? (`demoProtection.ts` → `ForbiddenError` → 403 `FORBIDDEN`)
12. How does the client distinguish a generic 403 from a plan-limit 403? (`isPlanLimitError()` / `PLAN_LIMIT_EXCEEDED`)
13. How does a Quest FHIR sync failure surface end-to-end (OAuth callback redirect `error=connection_failed` vs sync throwing `ExternalServiceError` → 502 `EXTERNAL_SERVICE_ERROR`; note `SYNC_FAILED` is audit-only, not an HTTP code)?

---

## No-TBD enforcement

Before marking anything TBD:

- **Map subclasses → codes**: read `errorHandler.ts` top-to-bottom; the 12 subclass constructors fix `(statusCode, code)`. Also capture the inline maps: `PRISMA_ERROR_MAP`, `JWT_ERROR_MAP`, the `SyntaxError`/`INVALID_JSON` and `MulterError`/`FILE_TOO_LARGE`/`UPLOAD_ERROR` branches.
- **Find every typed throw site**: `Grep pattern: "throw new \\w+Error\\(|next\\(new \\w+Error\\("` over `backend/src/**` (~187 across 29 non-test files). The bare `AppError` constructor with a literal code is essentially never used — do NOT rely on a `new AppError('CODE'` grep.
- **Find hand-built error bodies** (newer controllers/middleware): `Grep pattern: "code: '[A-Z_]+'"` and `Grep pattern: "res\\.status\\(\\d\\d\\d\\)"` over `backend/src/**`. This catches `PLAN_LIMIT_EXCEEDED` (`planGating.ts`), `SERVICE_UNAVAILABLE`/`CONTEXT_ASSEMBLY_FAILED` (`aiChatController.ts`, `aiSpendGuard.ts`), and `CONNECT_FAILED`/`NOT_FOUND` (`fhirController.ts`). NOTE: `SYNC_FAILED` is NOT a hand-built HTTP code — FHIR sync/disconnect failures throw `ExternalServiceError` → 502 `EXTERNAL_SERVICE_ERROR` (`fhirController.ts:201,225`); `SYNC_FAILED` exists only as an audit `operation` string (`labSyncService.ts:423`).
- **Rate-limit codes**: read `rateLimiter.ts` — 8 limiters, each with a distinct `message.error.code`.
- **Frontend handling**: read `src/services/api/client.ts` (a fetch wrapper); grep `response.status`, the `ERROR_MESSAGES` map, `attemptTokenRefresh`, and `isPlanLimitError`.
- **Audit events for errors**: `Grep pattern: "logAuth\\(['\"][A-Z_]*FAILED|logAccess.*(FAILED|BLOCKED|DENIED)"` over `backend/src/**` (auth events go through `auditService.logAuth(...)` / `logAccess(...)`, not a flat `auditLog.log`).

If a `code` is thrown but has no user-facing message defined anywhere, flag it in Prompt drift log — do not invent a message. Also flag the cases where a service throws a **plain `Error`** with no code (e.g., `storageService.ts:90,145`) and thus degrades to a generic 500 `INTERNAL_ERROR`.

---

## Cross-links

The generated `ERROR_RECOVERY.md` must link to:

- [`API_REFERENCE.md`](./API_REFERENCE.md) — per-endpoint error lists.
- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — middleware that produces each error.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — auth + CSRF + RLS flows.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — broader symptom catalog (narrative).
- [`RUNBOOK.md`](./RUNBOOK.md) — operational incident playbooks.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Enumerate subclass codes | Read | `backend/src/middleware/errorHandler.ts` (12 subclasses + PRISMA/JWT/Multer maps) |
| Find typed throws | Grep | `pattern: "throw new \\w+Error\\(|next\\(new \\w+Error\\("` over `backend/src/**` |
| Find hand-built codes | Grep | `pattern: "code: '[A-Z_]+'"` over `backend/src/**` (controllers/middleware) |
| Find inline status codes | Grep | `pattern: "res\\.status\\(\\d\\d\\d\\)"` over `backend/src/**` |
| Rate-limit codes | Read | `backend/src/middleware/rateLimiter.ts` (8 limiters) |
| Read fetch wrapper | Read | `src/services/api/client.ts` (not axios) |

---

## Output: file and location

Write the final document to `New Project Documents/ERROR_RECOVERY.md`.
