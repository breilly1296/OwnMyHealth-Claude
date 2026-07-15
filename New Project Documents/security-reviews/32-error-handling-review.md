# Error Handling Review — 2026-06-16

> Scope: the error-response pipeline end-to-end per `prompts/32-error-handling.md`, run against live code at HEAD `fb2cd32`. Method: every checklist item executed by reading the actual files (Read/Grep). No code modified. Findings ranked by exploitability × blast radius.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 4 |

The error pipeline is in strong shape. The central handler collapses all unmapped errors to a generic message, the dev-only stack/message branch is correctly gated on `config.isDevelopment` (which is false in BOTH production and staging), every inline `res.status(4xx/5xx).json` site matches the `ApiResponse` shape and leaks no raw library message, and all async route handlers are wrapped in `asyncHandler`. The four Low findings are hygiene/hardening items, not exploitable leaks.

## Findings

### F-1 — Two raw `throw new Error(...)` in settings deletion paths bypass the typed-error contract — **Low**
- **Location:** `backend/src/controllers/settingsController.ts:842` and `:1020`
- **Observation:** The GCS-pre-delete failure branches in `deleteData` and `deleteAccount` throw a bare `Error` (not an `AppError` subclass). These propagate through `asyncHandler` to the central handler, hit the unmapped path, and surface to the client as a generic 500 (`INTERNAL_ERROR`, `GENERIC_ERROR_MESSAGE`) — even though the condition is a recoverable, user-actionable "storage cleanup failed, nothing was deleted, please try again." The carefully-worded message (`Failed to delete N of M files… Please try again.`) is discarded in prod/staging, and the failure is recorded as a non-operational programmer error rather than an operational transient.
- **Impact:** No data leak (the message collapses to generic in prod). The downside is operational: a transient GCS hiccup shows the user an opaque "unexpected error" 500 with no retry hint, and the event pollutes 5xx error metrics/alerts as if it were a bug. Mild violation of checklist §4 ("Library error messages wrapped in an `AppError` subclass before throwing") and §11 ("never mark a user-input/transient error as non-operational").
- **Fix:** Replace both `throw new Error(...)` with a typed `ServiceUnavailableError(...)` (503, `SERVICE_UNAVAILABLE`, operational) or `ExternalServiceError('Storage', ...)` (502). Because `AppError` messages are returned verbatim by the central handler (`errorHandler.ts:155`), the actionable "nothing was deleted, please try again" text would then reach the client and the event would no longer be classified non-operational.
- **Evidence:**
  ```ts
  throw new Error(
    `Failed to delete ${gcsFailures.length} of ${filesToDelete.length} files from storage. ` +
    `No data was deleted. Please try again.`
  );
  ```

### F-2 — Batch-create per-item error string echoes the input value (defense-in-depth only; not reachable today) — **Low**
- **Location:** `backend/src/controllers/biomarkerController.ts:516` (constructed) → surfaced at `:554` / `:574` in the all-failed 400 body's `meta.failedItems[].error`
- **Observation:** Inside `bulkCreateBiomarkers`, the per-item guard throws `` new Error(`Invalid value: ${input.value}`) `` and that message string is collected into `failedItems` and returned to the client when the *entire* batch fails. `Biomarker` value is PHI (`valueEncrypted` in the PHI inventory), so this string would echo a PHI value back to the caller. In practice it is **unreachable**: the route applies `validate(schemas.biomarker.batchCreate)` first (`biomarkerRoutes.ts:106`), and the schema enforces `value: finiteNumber.pipe(z.number().min(0))`, so a non-number / non-finite value is rejected at the boundary before the controller runs. The other two per-item strings (`'Missing required fields…'`, `'Missing normal range min/max'`) carry no input data.
- **Impact:** None today (validation-shadowed). It is a latent defense-in-depth gap: if the Zod schema for batch were ever loosened or the route re-wired without `validate`, this path would reflect a raw PHI value in an error body. The caller is always the data owner (RLS-scoped to `userId`), so even if reachable the blast radius is self-disclosure, not cross-user — hence Low.
- **Fix:** Drop the value from the message — `throw new Error('Invalid value')` — so the per-item error never carries input data regardless of upstream validation. The index + name already identify the offending row.
- **Evidence:**
  ```ts
  if (typeof input.value !== 'number' || isNaN(input.value)) {
    throw new Error(`Invalid value: ${input.value}`);
  }
  ```

### F-3 — `config/index.ts` warning/budget diagnostics use `console.warn` / `process.stderr` instead of the structured logger — **Low**
- **Location:** `backend/src/config/index.ts:69` (`parseBudget` → `console.warn`), and `:389,:409,:471,:513,:516,:519` (`process.stderr.write`)
- **Observation:** The config module emits its boot-time diagnostics (invalid AI-budget env, BAA-not-active warnings, missing optional creds, localhost-CORS warning) via `console.warn` / `process.stderr.write` rather than the app's structured `logger`. This is a deliberate, documented choice in two of the cases (avoiding a circular import with the logger, and ensuring the security CORS warning always prints), and these are startup-only — they never run in the request/error path. But it means these messages bypass the logger's PHI-redaction sink and structured-field formatting. None of the strings contain PHI (env-var names, budget values, boolean flags), so there is no leak today.
- **Impact:** Hygiene only. The error-handling checklist (§9 / cross-ref 31-logging) prefers all server output flow through the redaction-aware logger; raw stderr writes are an audited exception. No exploit.
- **Fix:** Where the circular-import constraint allows (the `parseBudget` `console.warn` and the optional-credential warnings run after module init), route through `logger.warn`. The two security-critical writes that must run before the logger is safe to import can stay, with a comment (already present at `:467`).
- **Evidence:**
  ```ts
  console.warn(
    `⚠️  ${name} is invalid (got: ${JSON.stringify(raw)}); using default ${fallback}. ` + …
  );
  ```

### F-4 — `ApiResponse` type does not declare the dev-only `stack` field the handler attaches — **Low**
- **Location:** `backend/src/types/index.ts:111-115` (the `error` member of `ApiResponse`) vs `backend/src/middleware/errorHandler.ts:206`
- **Observation:** The central handler spreads `{ stack: err.stack }` into the error object when `config.isDevelopment` is true (`errorHandler.ts:206`), but the `ApiResponse['error']` interface declares only `{ code, message, details? }` — no `stack`. The runtime behavior is correct and safe (stack is only added in dev, stripped in prod/staging), but the type contract diverges from what the code can emit. The prompt explicitly notes "`ApiResponse` … does NOT declare `stack`" — confirmed.
- **Impact:** None at runtime; this is a type-safety / contract-drift hygiene gap. The spread compiles because of the conditional `...` but a future refactor that relies on the type to enumerate fields would miss `stack`. It also slightly obscures the dev-only leak surface from anyone reading the type alone.
- **Fix:** Either add an optional `stack?: string` to `ApiResponse['error']` with a comment that it is dev-only, or (cleaner) keep the type as-is and add an inline comment at `errorHandler.ts:206` noting the intentional, dev-gated type widening so the divergence is documented rather than silent.
- **Evidence:**
  ```ts
  // types/index.ts
  error?: { code: string; message: string; details?: unknown; };
  // errorHandler.ts:206
  ...(config.isDevelopment ? { stack: err.stack } : {}),
  ```

## Checks passed

### 1. Middleware registration order
- [x] Error handler is the **last** middleware — `app.ts:330` `app.use(errorHandler)` is the final `app.use`, after all routes and the 404 handler.
- [x] 404 handler registered **before** the error handler — `app.ts:327` `app.use(notFoundHandler)` precedes `:330`.
- [x] Error handler signature is `(err, req, res, _next)` — 4 params — `errorHandler.ts:135-140`.
- [x] No middleware after the error handler — `:330` is the last `app.use`; only `startServer()` / process handlers follow.

### 2. Response shape consistency
- [x] Central handler emits `{ success: false, error: { code, message, details? } }` — `errorHandler.ts:199-208`, matching `ApiResponse` (`types/index.ts:108-123`).
- [x] `details` attached **only** for `ValidationError` — `errorHandler.ts:156-158` (`if (err instanceof ValidationError) details = err.details;`); nothing else sets `details`.
- [x] Inline controller error bodies match the shape and carry `success: false`: `aiChatController.ts:156,175`; `fhirController.ts:46,67,184`; `authController.ts:301,325,734,871,987`; `biomarkerController.ts:564,628`; `biomarkerRoutes.ts:157,300,309`; `fileController.ts:293`; `insuranceController.ts:715`. Every one verified by reading the body.
- [x] No raw error strings / HTML error pages — all error bodies are JSON objects; `notFoundHandler` (`errorHandler.ts:214-216`) routes 404s through the central JSON handler.
- [x] No `stack` in prod/staging body — `stack` only spread under `config.isDevelopment` (`errorHandler.ts:206`); `isDevelopment` is `!isProduction && !isStaging` (`config/index.ts:36`), so it is false in both prod and staging.
- [x] Content-Type is JSON except SSE — AI chat sets `text/event-stream` and signals errors via `{ type: 'error', message }` (`aiChatController.ts:221,337-343`); `compression` filter opts SSE out (`app.ts:207-208`).

### 3. Stack trace safety
- [x] Stack never in body in prod/staging — gated on `config.isDevelopment` (`errorHandler.ts:206`).
- [x] The dev gate is `config.isDevelopment`, NOT `config.isProduction` — Grep for `config.isProduction` in `errorHandler.ts` returned **zero** hits; both the message (`:144`) and stack (`:206`) gates use `config.isDevelopment`.
- [x] `err.message` echoed only in dev for unmapped errors — `errorHandler.ts:144` `message = config.isDevelopment ? err.message : GENERIC_ERROR_MESSAGE`; unreachable in prod/staging.
- [x] `Error.captureStackTrace` retained for logging only — `AppError` constructor `:24`; `stack` is included in `logData` only when `config.isDevelopment` (`errorHandler.ts:186`).

### 4. Internal-detail leakage
- [x] Prisma errors mapped via `PRISMA_ERROR_MAP` / `handlePrismaError`; default returns `GENERIC_ERROR_MESSAGE` and never reflects `err.meta` — `errorHandler.ts:109-120,159-160`. `err.meta` is never read into a response.
- [x] PG error codes surface only through the Prisma map, not the body — no raw passthrough; the unmapped path echoes `err.message` only in dev (`:144`).
- [x] File paths in `err.stack` only attached in dev — confirmed via the §3 gate.
- [x] Third-party API errors not reflected verbatim — `fhirController.triggerSync:201` and `deleteConnection:225` log full detail server-side and `throw new ExternalServiceError('Lab provider', '<generic>')`; `aiChatController.ts:330-343` logs the raw error but emits a fixed generic SSE message; `biomarkerController.ts:617-623` logs the raw DB error and returns a constant string. No `err.message` reaches any client body.

### 5. Status code correctness
- [x] 400 for invalid JSON (`SyntaxError`→`INVALID_JSON`, `errorHandler.ts:163-164`), bad Prisma refs (P2003/P2014→400, `:112-113`), generic Multer errors (`UPLOAD_ERROR`, `:173`).
- [x] 401 for auth failures incl. `JsonWebTokenError`→`INVALID_TOKEN`, `TokenExpiredError`→`TOKEN_EXPIRED` — `errorHandler.ts:122-131,161-162`.
- [x] 403 for authz failures and `PLAN_LIMIT_EXCEEDED` with `{ limit, current, feature, upgradeRequired }` extra fields — `insuranceController.ts:715-725`; the fields are non-sensitive usage counts, consumed by `client.ts:356-369`.
- [x] 404 generic via Prisma P2025 (`:111`) and `NotFoundError`; the AI-guidance IDOR path returns 404 for both "not found" and "other user's resource" (`biomarkerRoutes.ts:186-191`) — no enumeration oracle.
- [x] 409 for conflicts via P2002 (`:110`) / `ConflictError`.
- [x] 413 for oversize uploads — `MulterError LIMIT_FILE_SIZE`→`FILE_TOO_LARGE` (`errorHandler.ts:170-171`), no longer an opaque 500.
- [x] 422 is the real `ValidationError` status (`:69`); frontend treats 422 distinctly, returning the server message (`client.ts:100-101`).
- [x] 429 handled by the rate limiters directly, not the error handler (`RateLimitError` exists but limiters respond) — consistent with `client.ts` 429 backoff path.
- [x] 500 is generic — `GENERIC_ERROR_MESSAGE = 'An unexpected error occurred. Please try again later.'` (`errorHandler.ts:105`), codes `INTERNAL_ERROR`/`DATABASE_ERROR`.
- [x] 502 `ExternalServiceError` (`:98-102`), 503 `ServiceUnavailableError` (`:86-90`); BAA-off AI path returns 503 inline (`aiChatController.ts:156`).

### 6. Async error propagation
- [x] Every async route handler is wrapped in `asyncHandler` — Grep for `async (req…res…) =>` in `routes/**` returned 30 hits, **all** in the `asyncHandler(async …)` form (adminRoutes, patientRoutes, providerRoutes, onboardingRoutes, planRoutes, internalRoutes, biomarkerRoutes). Controller methods are registered as `asyncHandler(controller.fn)` (e.g. `biomarkerRoutes.ts:54,73,89,107`).
- [x] No bare `.then()` without `.catch()` and no `.catch(console.*)` — Grep for `.catch(console.` returned zero; the `.then()` in `app.ts:278` (mock FHIR, dev-only) is the lone hit and is non-request-path.
- [x] `process.on('unhandledRejection')` and `process.on('uncaughtException')` present, both log via the structured logger and `process.exit(1)` — `app.ts:411-422`.
- [x] SSE/OAuth handlers catch internally in the post-`flushHeaders` window — `aiChatController.ts:230-363` wraps the whole stream loop in try/catch and emits an SSE `error` event + `res.end()`; `fhirController.handleCallback:99-133` catches and redirects with `?error=`.
- [x] Schedulers catch their own rejections — `emailScheduler.runTick` wraps all sub-batches in try/catch (`emailScheduler.ts:438-459`) and is invoked via `void runTick()` (`:465`); `withTickLock` fails open with logging (`:145-160`); `labSyncService` has try/catch at `:292,359,414,459,487`.

### 7. Validation error output
- [x] Zod errors → stable `{ field, message, code }[]` via `zodIssueToDetail` (field = `issue.path.join('.')`, code = `issue.code`) — `validation.ts:25-31,254`; carried in `ValidationError.details`, surfaced as 422.
- [x] Field names are the public API names (`issue.path`), not internal TS names — `validation.ts:26`.
- [x] No PHI value echoed in validation messages — Zod default messages don't echo values; the custom `.refine()` messages audited in `validation.ts` (`'Invalid date format'`, `'Must be a finite number'`, password-strength strings, `'email: at least one field…'`) carry no input value.
- [x] The exposed Zod `code` is a stable issue label (`too_small`, `invalid_type`, etc.) — safe to expose — `validation.ts:29`.
- [x] Validation runs before the controller (the `validate(schema, source)` factory is middleware that replaces `req[source]` with parsed+sanitized output via `sanitizeString`/`sanitizeForPrompt`) — `validation.ts:231-262`, applied in route definitions (e.g. `biomarkerRoutes.ts:88,106`).

### 8. Timing attack defense
- [x] Login message identical for unknown email vs wrong password — both return `'Invalid email or password'` (`authService.ts:1130,1159,1170`; controller `authController.ts:352,361`); `remainingAttempts` is deliberately NOT leaked to the client (`authController.ts:340-352`).
- [x] Password comparison uses `bcrypt.compare` — `authService.ts:411`; unknown-email path runs `bcrypt.compare(password, TIMING_SAFE_DUMMY_HASH)` to equalize timing (`:1125`).
- [x] Enumeration endpoints respond identically — `resendVerification` always returns the same generic 200 (`authController.ts:779-793`, L-17); `forgotPassword` (`:800+`) follows the same pattern.

### 9. Error to logs
- [x] Every 5xx logged at `error` level — `errorHandler.ts:190-192`.
- [x] `logData` includes statusCode, code, `req.method`, `req.path`, `req.user?.id`, dev-only `stack` — `errorHandler.ts:178-188`; uses `req.path` (query-stripped), not `originalUrl`. Morgan in prod also strips the query (`app.ts:231-237`).
- [x] 4xx logged at `warn` only when `config.isDevelopment` (`errorHandler.ts:193-196`) — intentional 404-noise suppression; brute-force-relevant 401/403 captured by the auth/audit layer instead (`authController` `logAuth` calls at `:289,310,334,347,356,377`).
- [x] Error handler does not log the request body; no controller catch re-logs `req.body` — Grep shows all `req.body` hits are destructuring, except `healthGoalsController.ts:559` which logs `Object.keys(req.body)` (field names only, no values).
- [x] 401/403 logged with context for brute-force detection — `auditService.logAuth('LOGIN_FAILED'…)` records email + reason + IP (via `getClientIp`) — `authController.ts:347-351`.

### 10. Frontend consumption
- [x] `client.ts` parses both string and object `error` shapes and normalizes to `ApiError { message, code?, status, planLimit? }` — `client.ts:341-352`; `getUserFriendlyMessage` echoes the server message only for 4xx, generic for 5xx (`:86-112`).
- [x] 401 triggers `attemptTokenRefresh()` + one retry, then `onAuthFailureCallback`; `/auth/refresh`, `/auth/logout`, `/auth/logout-all` exempt from the retry loop — `client.ts:269-272,308-339`.
- [x] `PLAN_LIMIT_EXCEEDED` 403 special-cased via `isPlanLimitError` + `apiError.planLimit` — `client.ts:54-62,356-369`; doesn't fall through to the generic Forbidden toast.
- [x] 429 retried with `Retry-After` / exponential backoff + ±25% jitter (`MAX_RETRY_429 = 3`), auth-mgmt endpoints exempt, `retryCount429` preserved across the 401-refresh retry so it can't amplify load — `client.ts:200-221,286-301,334`.
- [x] Network errors (status 0 → `NETWORK_ERROR`) and timeouts (`AbortError` → 408 `TIMEOUT`) distinguished — `client.ts:378-394`.
- [x] `ErrorBoundary` renders a fallback (incl. a dedicated stale-chunk "new version" screen) and shows error detail only when `NODE_ENV === 'development'` — `ErrorBoundary.tsx:111-141,161-179`.
- [x] AI chat consumes `text/event-stream` via a fetch reader, distinguishing `content_block_delta`, `message_stop`, `{ type: 'error' }`, a silent mid-stream disconnect, timeout, and caller-cancel — `src/services/api/ai.ts:185-229`.

### 11. Non-operational errors
- [x] `AppError.isOperational` distinguishes expected vs programmer error — `errorHandler.ts:16,21`; `InternalServerError` and `DatabaseError` set `isOperational = false` (`:82,:94`).
- [x] User-input-caused errors are not marked non-operational — `BadRequestError`/`ValidationError`/`NotFoundError`/etc. default `isOperational = true`. (Exception: the raw `Error` throws in F-1 are untyped, neither operational nor not — see F-1.)

## Unverifiable
- None. Every file and constant named in the prompt was located and read. (The prompt's line-number hints `~144`, `~206`, `~219`, `~411-422`, `fhirController.ts:46,184,201,225` all matched the live code within 1-2 lines.)

## Out of scope
- The deeper logging/PHI-redaction sink behavior (`utils/phiRedaction.ts`, `utils/logger.ts` redaction rules) — owned by `prompts/31-logging-observability.md`; this review only confirms the error handler routes through the logger and does not log request bodies.
- Rate-limiter internals and the 429 server-side response (`middleware/rateLimiter.ts`) — the checklist explicitly notes 429 is produced by the limiters, not the error handler; the limiter's own correctness is out of scope here.
- The AI spend circuit breaker / `aiSpendGuard` 503 semantics beyond confirming the status code — owned by the AI-cost prompt.
- Multi-instance precision of the in-memory AI spend accumulator and the documented L34/L36 quota TOCTOU races — accepted/deferred per project memory, not an error-handling concern.

## Prompt drift
None observed. The prompt (updated 2026-06-16) matches the live code on all load-bearing claims: 12 `extends AppError` subclasses, the `config.isDevelopment` gate (zero `config.isProduction` hits in `errorHandler.ts`), the FHIR callback redirect-with-`?error=` shape, the `triggerSync`/`deleteConnection` `ExternalServiceError` paths, the SSE error-event design, and the `asyncHandler` wrapper coverage across all route files.
