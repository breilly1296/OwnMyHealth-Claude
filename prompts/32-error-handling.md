---
tags:
  - security
  - api
  - reliability
  - medium
type: prompt
priority: 3
updated: 2026-04-16
---

# Error Handling Review

> Follow the [review protocol](./_review-protocol.md).
> See [31-logging-observability](./31-logging-observability.md) for how errors flow to logs.
> Use [Claude Code tools](./_verification-tools.md).

## Why this prompt exists

Error responses are the easiest unintentional data leak in a web app: stack traces with file paths, ORM errors with column names, validation messages echoing raw input. This prompt owns the review of the error-response pipeline end-to-end.

## Files to Review
- `backend/src/middleware/errorHandler.ts` — `AppError`, `BadRequestError`, `UnauthorizedError`, `AuthenticationError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, and the Express error handler itself
- `backend/src/middleware/validation.ts` — Zod validation errors → HTTP responses
- `backend/src/app.ts` — middleware registration order (error handler must be **last**)
- Every controller — async flow, `next(error)` vs throw, unhandled promises
- `backend/src/types/index.ts` — `ApiResponse` type (if it enforces error shape)
- `src/services/api/client.ts` — how the frontend consumes error responses
- Any component with `try/catch` that renders error state

## OwnMyHealth Error Architecture
- **Error classes**: `AppError` base + typed subclasses (`BadRequestError`, etc.) carry `statusCode`, `code`, `isOperational`.
- **Client shape**: all errors return `{ success: false, error: { code, message } }` (verify in `ApiResponse` type).
- **Stack traces**: server-side only; never in response body.
- **Async flow**: Express 4 does not auto-propagate async errors — must use `next(error)` or an async wrapper.

---

## Checklist

### 1. Middleware registration order
- [ ] Error handler is the **last** middleware registered in `app.ts` (after all routes).
- [ ] 404 handler is registered **before** the error handler (catch-all for unmatched routes).
- [ ] Error handler signature is `(err, req, res, next)` — 4 params, or Express won't recognize it.
- [ ] No middleware after the error handler.

### 2. Response shape consistency
- [ ] Every error response matches `ApiResponse` error shape (confirm in `types/index.ts`).
- [ ] No raw error strings or HTML error pages in production.
- [ ] Response body has no fields beyond the declared shape (no `stack`, no `details` with internal info).
- [ ] Content-Type is always `application/json`.

### 3. Stack trace safety
- [ ] Stack traces **never** appear in response body in production.
- [ ] `config.isProduction` gate wraps any stack inclusion (dev-mode stack in response is okay).
- [ ] `Error.captureStackTrace` retained for logging, but the log sink must also strip PHI per [31-logging-observability](./31-logging-observability.md).

### 4. Internal-detail leakage
- [ ] Prisma errors translated to generic messages before response (raw `P2002` unique-constraint messages can reveal schema).
- [ ] PostgreSQL error codes (`23505`, `42P01`, etc.) not in response body.
- [ ] File paths in `err.stack` stripped before any user-visible text.
- [ ] Library error messages wrapped in `AppError` subclass before throwing.
- [ ] Third-party API errors (Anthropic, SendGrid, GCS) never reflected verbatim — they can contain internal IDs or hints.

### 5. Status code correctness
- [ ] 400 for validation failures (malformed input, missing fields, Zod errors).
- [ ] 401 for missing/expired/invalid auth (unauthenticated).
- [ ] 403 for authenticated-but-unauthorized (wrong role, no consent, CSRF fail).
- [ ] 404 for missing resources **owned by the user** — never for resources owned by another user (would be an enumeration oracle; return 404 for those too).
- [ ] 409 for state conflicts (duplicate email, concurrent update).
- [ ] 422 only if you meaningfully distinguish it from 400 (otherwise use 400 consistently).
- [ ] 429 from rate limiter, not the error handler.
- [ ] 500 for unexpected errors — and the body is **generic**, e.g. `{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }`. No leakage.
- [ ] 503 for downstream unavailable (Anthropic down, DB pool exhausted) with `Retry-After` where appropriate.

### 6. Async error propagation
- [ ] Every async route handler either (a) is wrapped in an `asyncHandler` helper that forwards rejections to `next`, or (b) calls `next(error)` explicitly.
- [ ] No bare `.then()` without `.catch()` in controller code.
- [ ] `router.get('/x', async (req, res) => { ... })` without wrapper is a finding — Express 4 swallows these.
- [ ] Top-level `process.on('unhandledRejection', ...)` and `uncaughtException` handlers present — log and exit 1 (Cloud Run restarts).

### 7. Validation error output
- [ ] Zod errors converted to a stable shape (`{ field, message }[]`) — not raw Zod internals.
- [ ] Field names in validation errors use the public API field name, not internal TypeScript name.
- [ ] No value echoed back in validation error messages for PHI fields (`"value '123-45-6789' is not a valid biomarker"` leaks the input back).
- [ ] Validation runs **before** the controller body, so request.body can't reach encryption/DB with bad data.

### 8. Timing attack defense
- [ ] Login error message identical for "user not found" and "wrong password" — same response, same timing.
- [ ] Password comparison uses `bcrypt.compare` (timing-safe), not `===`.
- [ ] Email-enumeration endpoints (forgot password, resend verification) respond identically whether the email exists or not.

### 9. Error to logs
- [ ] Every 5xx is logged at `error` level with: requestId, userId (if authenticated), route, status, error code, stack trace.
- [ ] 4xx logged at `warn` (or lower, to avoid noise). Don't log every 404.
- [ ] Log payload redacts request body per [31-logging-observability](./31-logging-observability.md).
- [ ] 401/403 failures logged with enough context for brute-force detection (IP, email if present, timestamp).

### 10. Frontend consumption
- [ ] `src/services/api/client.ts` parses `error.code` consistently, not just `error.message`.
- [ ] 401 globally triggers logout / redirect to login.
- [ ] 403 shows an appropriate "insufficient permission" UI, never the raw message.
- [ ] Network errors (server unreachable) are distinguished from HTTP errors in UI.
- [ ] Error boundaries (`<ErrorBoundary>`) wrap lazy-loaded route trees — a render error doesn't blank the app.

### 11. Non-operational errors
- [ ] `AppError.isOperational` used to distinguish expected vs programmer error. Non-operational errors should (a) log with higher severity, (b) potentially crash the process for supervisor restart.
- [ ] Never mark a user-input-caused error as non-operational (would hide real bugs in noise).

---

## Verification (Claude Code tools)

| Check | Tool | Parameters |
|---|---|---|
| Find `AppError` subclasses | Grep | `pattern: "extends AppError"`, `glob: "backend/src/**/*.ts"` |
| Find async handlers without wrappers | Grep | `pattern: "async \\(req.*res.*\\) =>"`, `glob: "backend/src/routes/**/*.ts"` — inspect each hit |
| Find raw `throw` of non-AppError | Grep | `pattern: "throw new (?!AppError\|BadRequest\|Unauthorized\|Forbidden\|NotFound\|Conflict\|Authentication)"`, `glob: "backend/src/**/*.ts"`, review hits |
| Find `.catch(console` leaks | Grep | `pattern: "\\.catch\\(console\\."`, `glob: "backend/src/**/*.ts"` |
| Prisma error passthrough | Grep | `pattern: "PrismaClientKnownRequestError\|P20\\d{2}"`, `glob: "backend/src/**/*.ts"` |
| 500 handler body | Read | `backend/src/middleware/errorHandler.ts` — confirm production branch is generic |
| Middleware order | Read | `backend/src/app.ts` — error handler last, 404 just before it |

---

## Questions to ask the user

1. Is there a server-side error aggregator (Cloud Error Reporting, Sentry)? If Sentry, is there a BAA?
2. What's the response-time SLO, and do 5xx rates appear on a dashboard?
3. Have you load-tested the error path (e.g., does a malformed biomarker batch bring down the process)?
4. Do you distinguish "expected 4xx from misconfigured clients" vs "unexpected 5xx" in alerts?
5. Is the frontend error UI tested for every status code (401, 403, 404, 409, 429, 500, 503)?
