---
tags:
  - security
  - api
  - reliability
  - medium
type: prompt
priority: 3
updated: 2026-06-16
---

# Error Handling Review

> Follow the [review protocol](./_review-protocol.md).
> See [31-logging-observability](./31-logging-observability.md) for how errors flow to logs.
> Use [Claude Code tools](./_verification-tools.md).

## Why this prompt exists

Error responses are the easiest unintentional data leak in a web app: stack traces with file paths, ORM errors with column names, validation messages echoing raw input. This prompt owns the review of the error-response pipeline end-to-end.

## Files to Review
- `backend/src/middleware/errorHandler.ts` — the full `AppError` family (`BadRequestError`, `UnauthorizedError`, `AuthenticationError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`, `RateLimitError`, `InternalServerError`, `ServiceUnavailableError`, `DatabaseError`, `ExternalServiceError`), the Prisma/JWT/Multer/SyntaxError translation maps, the Express `errorHandler`, `notFoundHandler`, and the `asyncHandler` wrapper
- `backend/src/middleware/validation.ts` — Zod validation errors → `ValidationError` (`{ field, message, code }[]` details) and `requireJsonContentType`
- `backend/src/app.ts` — middleware registration order (404 then error handler **last**) and the top-level `unhandledRejection` / `uncaughtException` handlers (~lines 411-422)
- Controllers that **bypass** the central handler — `aiChatController.ts` (SSE error events), `fhirController.ts` (OAuth callback redirects + inline `res.status().json` **pre-checks** only — `initiateQuestConnect` 503 at `fhirController.ts:46-54`, `triggerSync` 404 at `fhirController.ts:184-189`). NOTE: the actual error PATHS of `triggerSync` (`fhirController.ts:201`) and `deleteConnection` (`fhirController.ts:225`) now `throw new ExternalServiceError(...)` and route through the central handler — they do NOT write their own error bodies for failures, so don't reflexively flag those as bypass
- Every other controller — async flow, `next(error)` vs throw, unhandled promises
- `backend/src/types/index.ts` — `ApiResponse` type (`error: { code, message, details? }` — note it does NOT declare `stack`)
- `src/services/api/client.ts` — how the frontend consumes error responses (`getUserFriendlyMessage`, 401 refresh, 429 backoff, `PLAN_LIMIT_EXCEEDED` parsing)
- `src/components/common/ErrorBoundary.tsx` — React render-error boundary
- Any component with `try/catch` that renders error state

## OwnMyHealth Error Architecture
- **Error classes**: `AppError` base + typed subclasses carry `statusCode`, `code`, `isOperational`. `ValidationError` additionally carries `details` (the `{ field, message, code }[]` array). `InternalServerError`, `DatabaseError` set `isOperational = false`. `ExternalServiceError` is a 502 prefixing the service name.
- **Translation maps**: `errorHandler` does not rely on subclasses alone. It maps Prisma errors (`PRISMA_ERROR_MAP`: P2002→409, P2025→404, P2003/P2014→400, default 500 `DATABASE_ERROR`), JWT errors (`JWT_ERROR_MAP`: `JsonWebTokenError`/`TokenExpiredError`→401), JSON-body `SyntaxError`→400 `INVALID_JSON`, and `MulterError` (`LIMIT_FILE_SIZE`→413 `FILE_TOO_LARGE`, else 400 `UPLOAD_ERROR`). All collapse to a `GENERIC_ERROR_MESSAGE` for unmapped 500s.
- **Client shape**: errors return `{ success: false, error: { code, message, details? } }` from the central handler (verify in `ApiResponse` type). NOTE: a few inline responses still emit error bodies directly without going through the handler — confirm they match the shape and omit no `success: false`. `aiChatController` SSE error events and the `fhirController` inline pre-checks (503/404) are the live ones. The OAuth callback (`fhirController.handleCallback`) does NOT return a JSON error body at all: on missing code/state it redirects to the frontend with `?error=missing_code_or_state` (`fhirController.ts:90-97`), consistent with the OAuth-denied (`:84-89`) and exchange-failure (`:108-132`) branches — the old "bare `{ error: 'Missing code or state' }` string" shape no longer exists.
- **Stack traces / dev gate**: the dev-only branch is gated on `config.isDevelopment`, NOT `config.isProduction`. `config.isDevelopment` is `false` in BOTH production AND **staging** (it is `!isProduction && !isStaging`), so staging exposes the generic message and no stack — verify staging is treated like production, not like dev.
- **Async flow**: Express 4 does not auto-propagate async errors — routes use the `asyncHandler` wrapper (forwards rejections to `next`). NOTE: SSE (AI chat) and OAuth-redirect (FHIR callback) handlers are wrapped in `asyncHandler` but still handle their own errors inline because once headers are flushed / a redirect is committed the central JSON handler can't respond — they write SSE `error` events or redirect with `?error=...` instead.

---

## Checklist

### 1. Middleware registration order
- [ ] Error handler is the **last** middleware registered in `app.ts` (after all routes).
- [ ] 404 handler is registered **before** the error handler (catch-all for unmatched routes).
- [ ] Error handler signature is `(err, req, res, next)` — 4 params, or Express won't recognize it.
- [ ] No middleware after the error handler.

### 2. Response shape consistency
- [ ] Every error response matches `ApiResponse` error shape `{ success: false, error: { code, message, details? } }` (confirm in `types/index.ts`).
- [ ] `details` is only present for `ValidationError` and only carries `{ field, message, code }[]` (never internal info). The central handler attaches `details` solely for `ValidationError` instances — verify nothing else populates it.
- [ ] Inline controller error responses (`aiChatController` SSE events, `fhirController` 503/404 pre-checks) match the shape — verify none omit `success: false`. NOTE: `fhirController.handleCallback` no longer returns a JSON error body — its failure branches redirect with `?error=...` (`fhirController.ts:84-97,108-132`), so there is no bare `{ error: 'Missing code or state' }` string left to normalize.
- [ ] No raw error strings or HTML error pages in production.
- [ ] In production/staging, the response body has no `stack` field (only added when `config.isDevelopment`).
- [ ] Content-Type is always `application/json` — **except** the AI chat SSE endpoint, which emits `text/event-stream` and signals errors via a `{ type: 'error', message }` event, not an HTTP status body.

### 3. Stack trace safety
- [ ] Stack traces **never** appear in response body in production **or staging**.
- [ ] The `config.isDevelopment` gate (errorHandler ~line 144 for the message, ~line 206 for `stack`) wraps any stack/dev-message inclusion. Confirm the gate is `config.isDevelopment` and NOT `config.isProduction` (the latter would leak in staging, where `isDevelopment` is false but `isProduction` is also false).
- [ ] In dev, `err.message` is echoed for unmapped errors (line 144) — confirm this path is unreachable in production/staging so raw library messages never escape.
- [ ] `Error.captureStackTrace` (in the `AppError` constructor) retained for logging, but the log sink must also strip PHI per [31-logging-observability](./31-logging-observability.md). `stack` is only logged when `config.isDevelopment` (errorHandler `logData`).

### 4. Internal-detail leakage
- [ ] Prisma errors translated via `PRISMA_ERROR_MAP` / `handlePrismaError` (matches on `err.name === 'PrismaClientKnownRequestError' || 'PrismaClientValidationError'`). Confirm the default branch returns `GENERIC_ERROR_MESSAGE`, not the raw Prisma message, and that `err.meta` is never reflected.
- [ ] PostgreSQL error codes (`23505`, `42P01`, etc.) not in response body (these surface as Prisma errors; verify they hit the map, not the unmapped 500 path which echoes `err.message` only in dev).
- [ ] File paths in `err.stack` stripped before any user-visible text (stack only attached in dev — verify dev is the only path).
- [ ] Library error messages wrapped in an `AppError` subclass before throwing (raw `throw new Error(...)` falls through to the generic 500).
- [ ] Third-party API errors (Anthropic, SendGrid, GCS, **Quest FHIR / Document AI**) never reflected verbatim — they can contain internal IDs or hints. CONFIRM this stays fixed: `fhirController.triggerSync` (`fhirController.ts:201`) and `deleteConnection` (`fhirController.ts:225`) log full detail server-side and `throw new ExternalServiceError('Lab provider', '<generic message>')` so the central handler emits a generic 502 — no `err.message` reaches the client. Flag any regression that puts `err.message` back into a response body.

### 5. Status code correctness
- [ ] 400 for invalid JSON body (`SyntaxError`→`INVALID_JSON`), bad Prisma references (P2003/P2014), and generic Multer upload errors (`UPLOAD_ERROR`). NOTE: Zod schema validation failures (malformed input, missing fields) are 422, not 400 — see below.
- [ ] 401 for missing/expired/invalid auth (unauthenticated) — including `JsonWebTokenError`→`INVALID_TOKEN` and `TokenExpiredError`→`TOKEN_EXPIRED`.
- [ ] 403 for authenticated-but-unauthorized (wrong role, no consent, CSRF fail) **and `PLAN_LIMIT_EXCEEDED`** (plan gating returns 403 with `{ limit, current, feature, upgradeRequired }` — verify those extra fields are intentional and non-sensitive).
- [ ] 404 for missing resources **owned by the user** — never for resources owned by another user (would be an enumeration oracle; return 404 for those too). Prisma P2025 maps to 404 generically.
- [ ] 409 for state conflicts (duplicate email, concurrent update). Prisma P2002 maps here.
- [ ] 413 for oversize uploads (`MulterError` `LIMIT_FILE_SIZE`→`FILE_TOO_LARGE`, 10MB cap). Confirm it no longer surfaces as an opaque 500.
- [ ] 422 is the actual `ValidationError` status (Zod failures map to 422, NOT 400 — the older "use 400" advice is stale). Confirm the frontend treats 422 distinctly (it does: `client.ts` returns the server message for 422).
- [ ] 429 from rate limiter, not the error handler. (`RateLimitError` exists in the family but the limiters respond directly.)
- [ ] 500 for unexpected errors — and the body is **generic** (`GENERIC_ERROR_MESSAGE` = "An unexpected error occurred. Please try again later.", code `INTERNAL_ERROR`/`DATABASE_ERROR`). No leakage outside dev.
- [ ] 502 `ExternalServiceError` for downstream API failures; 503 `ServiceUnavailableError` for downstream unavailable (Anthropic BAA off, DB pool exhausted). The BAA-off AI path returns 503 inline from `aiChatController` (SERVICE_UNAVAILABLE). Add `Retry-After` where appropriate.

### 6. Async error propagation
- [ ] Every async route handler is wrapped in the `asyncHandler` helper (errorHandler.ts ~line 219, `Promise.resolve(fn).catch(next)`) or calls `next(error)` explicitly. All 18 non-test route files already use it — verify no route registered a bare async fn.
- [ ] No bare `.then()` without `.catch()` in controller/service code.
- [ ] `router.get('/x', async (req, res) => { ... })` without the wrapper is a finding — Express 4 swallows these.
- [ ] Top-level `process.on('unhandledRejection', ...)` and `process.on('uncaughtException', ...)` handlers present in `app.ts` (~lines 411-422) — both log via the structured logger and `process.exit(1)` so Cloud Run restarts. Confirm they remain after any refactor.
- [ ] SSE / OAuth handlers (`aiChatController`, `fhirController`) are wrapped in `asyncHandler` but ALSO catch internally — confirm the inner try/catch covers the post-`flushHeaders` window where `next(error)` can no longer set a status (otherwise an unhandled stream rejection leaves the SSE connection hanging open).
- [ ] New scheduler/background flows (`schedulers/emailScheduler`, audit/session cleanup, FHIR `labSyncService`) catch their own rejections — an unhandled one would now crash the process via the `unhandledRejection` handler.

### 7. Validation error output
- [ ] Zod errors converted to a stable shape via `zodIssueToDetail` → `{ field, message, code }[]` (field = `issue.path.join('.')`, code = the Zod issue code) — not raw Zod internals. Carried in `ValidationError.details`, surfaced as 422.
- [ ] Field names in validation errors use the public API field name, not internal TypeScript name.
- [ ] No value echoed back in validation error messages for PHI fields (`"value '123-45-6789' is not a valid biomarker"` leaks the input back). Zod default messages don't echo values, but `.refine()`/custom messages might — audit the schemas in `validation.ts`.
- [ ] The Zod `code` exposed in `details` is a stable validation-issue label (e.g. `too_small`, `invalid_type`), not internal info — confirm it's safe to expose.
- [ ] Validation runs **before** the controller body (the `validate(schema, source)` factory is middleware), so request.body can't reach encryption/DB with bad data. Note the factory replaces `req[source]` with the parsed+sanitized output (HTML-escaped via `sanitizeString`, prompt-safe via `sanitizeForPrompt`).

### 8. Timing attack defense
- [ ] Login error message identical for "user not found" and "wrong password" — same response, same timing.
- [ ] Password comparison uses `bcrypt.compare` (timing-safe), not `===`.
- [ ] Email-enumeration endpoints (forgot password, resend verification) respond identically whether the email exists or not.

### 9. Error to logs
- [ ] Every 5xx is logged at `error` level. The current `logData` includes statusCode, code, `req.method`, `req.path`, `req.user?.id`, and (dev only) `stack`. Confirm `req.path` is query-stripped so verification/reset tokens can't land in logs (Express `req.path` excludes the query — good; verify nothing logs `originalUrl`).
- [ ] 4xx is currently logged at `warn` **only when `config.isDevelopment`** (errorHandler lines 193-196) — i.e. NOT in production/staging. Confirm this is intentional (avoids 404 noise) and that brute-force-relevant 401/403 are captured elsewhere (auth middleware / audit log), since the error handler stays silent on them in prod.
- [ ] Log payload redacts request body per [31-logging-observability](./31-logging-observability.md). The error handler does not log the body — verify no controller catch re-logs it.
- [ ] 401/403 failures logged with enough context for brute-force detection (IP, email if present, timestamp) — but note the central handler won't do this in prod (see above), so the auth/audit layer must.

### 10. Frontend consumption
- [ ] `src/services/api/client.ts` parses both string and object `error` shapes (`data.error` may be a string OR `{ code, message }`) and normalizes to `ApiError { message, code?, status, planLimit? }`. Confirm `getUserFriendlyMessage` only echoes the server message for 4xx (not 5xx, where it uses a generic).
- [ ] 401 triggers `attemptTokenRefresh()` then retries once; on failure calls `onAuthFailureCallback` (logout/redirect). `/auth/refresh` and `/auth/logout` are exempt from the retry loop — verify no new auth endpoint re-introduces the recursion.
- [ ] 403 shows an appropriate "insufficient permission" UI, never the raw message. The `PLAN_LIMIT_EXCEEDED` 403 is special-cased — `isPlanLimitError` + `apiError.planLimit` drive an upgrade CTA; confirm that path doesn't fall through to the generic "Forbidden" toast.
- [ ] 429 is retried with `Retry-After` / exponential backoff+jitter (`MAX_RETRY_429 = 3`), exempting auth-management endpoints — verify the backoff can't amplify a server overload.
- [ ] Network errors (status 0 → `NETWORK_ERROR`) and timeouts (`AbortError` → 408 `TIMEOUT`) are distinguished from HTTP errors in UI.
- [ ] Error boundaries (`src/components/common/ErrorBoundary.tsx`) wrap lazy-loaded route trees — a render error doesn't blank the app.
- [ ] AI chat consumes `text/event-stream` (EventSource/fetch reader), not `apiFetch` — verify its client distinguishes the `{ type: 'error' }` SSE event and a mid-stream disconnect from a normal `message_stop`.

### 11. Non-operational errors
- [ ] `AppError.isOperational` used to distinguish expected vs programmer error. Non-operational errors should (a) log with higher severity, (b) potentially crash the process for supervisor restart.
- [ ] Never mark a user-input-caused error as non-operational (would hide real bugs in noise).

---

## Verification (Claude Code tools)

| Check | Tool | Parameters |
|---|---|---|
| Find `AppError` subclasses | Grep | `pattern: "extends AppError"`, `glob: "backend/src/**/*.ts"` (expect 12: BadRequest, Unauthorized, Authentication, Forbidden, NotFound, Conflict, Validation, RateLimit, InternalServer, ServiceUnavailable, Database, ExternalService) |
| Find async handlers without wrappers | Grep | `pattern: "async \\(req.*res.*\\) =>"`, `glob: "backend/src/routes/**/*.ts"` — inspect each hit; should be wrapped in `asyncHandler(...)` |
| Find raw `throw` of non-AppError | Grep | `pattern: "throw new (?!AppError\|BadRequest\|Unauthorized\|Authentication\|Forbidden\|NotFound\|Conflict\|Validation\|RateLimit\|InternalServer\|ServiceUnavailable\|Database\|ExternalService)"`, `glob: "backend/src/**/*.ts"`, review hits |
| Find inline error responses bypassing the handler | Grep | `pattern: "res\\.status\\((?:4\|5)\\d\\d\\)\\.json"`, `glob: "backend/src/controllers/**/*.ts"` — confirm each matches `{ success: false, error: { code, message } }` and leaks no `err.message` (esp. `fhirController`, `aiChatController`) |
| Find SSE error paths | Grep | `pattern: "type: 'error'\|writeSSE"`, `glob: "backend/src/controllers/**/*.ts"` |
| Find `.catch(console` leaks | Grep | `pattern: "\\.catch\\(console\\."`, `glob: "backend/src/**/*.ts"` |
| Prisma error passthrough | Grep | `pattern: "PrismaClientKnownRequestError\|P20\\d{2}"`, `glob: "backend/src/**/*.ts"` — confirm only the map in errorHandler.ts, no raw passthrough |
| 500 handler body | Read | `backend/src/middleware/errorHandler.ts` — confirm non-dev branch is generic (`GENERIC_ERROR_MESSAGE`) and `stack` only when `config.isDevelopment` |
| Dev gate is isDevelopment not isProduction | Grep | `pattern: "config\\.isProduction"`, `glob: "backend/src/middleware/errorHandler.ts"` — expect ZERO hits (gate must be `isDevelopment`) |
| Middleware order | Read | `backend/src/app.ts` — `notFoundHandler` then `errorHandler` last (lines ~327-330) |
| Crash-on-unhandled handlers | Read | `backend/src/app.ts` — `unhandledRejection` / `uncaughtException` log + exit 1 (~lines 411-422) |

---

## Questions to ask the user

1. Is there a server-side error aggregator (Cloud Error Reporting, Sentry)? If Sentry, is there a BAA?
2. What's the response-time SLO, and do 5xx rates appear on a dashboard?
3. Have you load-tested the error path (e.g., does a malformed biomarker batch bring down the process)?
4. Do you distinguish "expected 4xx from misconfigured clients" vs "unexpected 5xx" in alerts?
5. Is the frontend error UI tested for every status code (401, 403 incl. `PLAN_LIMIT_EXCEEDED`, 404, 409, 413, 422, 429, 500, 502, 503)?
6. For the AI chat SSE stream: how does the UI surface a mid-stream error or a dropped connection vs a clean `message_stop`? Is a partial answer shown or discarded?
7. For the Quest FHIR OAuth callback: when it redirects with `?error=connection_failed`, does the frontend show an actionable message, and are the underlying SMART/OAuth error details captured server-side (not leaked to the user)?
8. Now that `unhandledRejection`/`uncaughtException` exit the process, do scheduler/`labSyncService` background tasks swallow their own errors so a transient sync failure can't take down a live instance serving PHI?
