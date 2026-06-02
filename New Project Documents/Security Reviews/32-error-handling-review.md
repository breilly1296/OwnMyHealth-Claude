# 32-error-handling Review — 2026-06-01

Scope: the error-response pipeline end-to-end — central `errorHandler`, the `AppError` family + translation maps, Zod validation errors, middleware registration order, the inline-handling controllers that bypass the central handler (`aiChatController`, `fhirController`, plus inline `res.status().json` in `authController`/`biomarkerController`/`fileController`), async propagation (`asyncHandler`, schedulers, top-level crash handlers), and the frontend consumption layer (`client.ts`, `ai.ts`, `ErrorBoundary.tsx`).

Method: every claim below was confirmed against live code with Grep/Read. Findings are ranked by exploitability × blast radius.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 5 |

## Findings

### F-1 — FHIR inline handlers reflect raw downstream `err.message` into 5xx bodies — **Medium**
- **Location:** `backend/src/controllers/fhirController.ts:170-176` (`triggerSync`) and `backend/src/controllers/fhirController.ts:197-203` (`deleteConnection`).
- **Observation:** Both inline catch blocks place the raw error message directly into the user-facing 500 body: `message: err instanceof Error ? err.message : 'Sync failed'`. These errors originate from the SMART-on-FHIR / Quest lab-sync stack (`labSyncService`), which can surface OAuth/SMART error strings, upstream HTTP detail, internal hostnames, or token-handshake hints. Because these controllers write their own response instead of `throw`/`next(error)`, they never reach the central handler's `GENERIC_ERROR_MESSAGE` collapse, so the leak is unconditional in production and staging.
- **Impact:** An authenticated user (the feature is plan-gated and demo-blocked, which bounds the audience) can probe the Quest integration and read verbatim downstream-service error text from a 500 body — internal-detail leakage that can expose OAuth/SMART internals or infrastructure hints, the exact failure mode this prompt exists to catch. Blast radius is limited to the caller's own connections (RLS-scoped), so it is not a cross-user PHI path; severity is Medium, not High.
- **Fix:** In both catch blocks, return a fixed generic message (e.g. `'Lab sync failed. Please try again.'` / `'Could not disconnect. Please try again.'`) with the existing stable code, and keep `logger.error` for the server-side detail (already present at `fhirController.ts:167` and `:194`). Better: convert these handlers to `throw new ExternalServiceError('Quest', ...)` / `ServiceUnavailableError` and let the central handler format the body, since the response is plain JSON (not yet a redirect/stream) at the point of failure.
- **Evidence:**
  ```ts
  res.status(500).json({
    error: { code: 'SYNC_FAILED', message: err instanceof Error ? err.message : 'Sync failed' },
  });
  ```

### F-2 — `resendVerification` is an account-enumeration oracle — **Low**
- **Location:** `backend/src/controllers/authController.ts:700-725`; root cause `backend/src/services/authService.ts:941-951`.
- **Observation:** The service returns `{ success: true }` for a non-existent email (`authService.ts:943`) but `{ success: false, error: 'Email is already verified' }` when the email exists and is already verified (`:946-951`). The controller maps `success: false` to a **400 `RESEND_FAILED`** (`authController.ts:700-708`) and `success: true` to a **200** generic message (`:717-725`). So a registered-and-verified address returns 400 while a non-existent (or registered-but-unverified) address returns 200 — a clean existence oracle. This directly contradicts the controller's own comment "Always return success (don't reveal if user exists)" (`authController.ts:717`).
- **Impact:** An unauthenticated attacker can enumerate which emails have verified accounts by diffing 400 vs 200. `forgotPassword` (the sibling endpoint) is correctly uniform (`authController.ts:756-764`), so this is an inconsistency, not a systemic gap. Login already leaks verified-vs-unverified via the 403 `EMAIL_NOT_VERIFIED` path, so the incremental exposure is modest — hence Low.
- **Fix:** In `resendVerificationEmail`, return `{ success: true }` for the already-verified case too (still skip sending the email), so the controller always emits the uniform 200 "If the email exists and is unverified…" message. Note the spec marks email-enumeration uniformity as a checklist item under §8.
- **Evidence:**
  ```ts
  if (prismaUser.emailVerified) {
    return { success: false, error: 'Email is already verified' };
  }
  ```

### F-3 — Inline error bodies omit `success: false` (`aiChatController`, `fhirController`) — **Low**
- **Location:** `backend/src/controllers/aiChatController.ts:133-140` and `:151-154`; `backend/src/controllers/fhirController.ts:44-51`, `:64-66`, `:158`, `:170-175`, `:197-202`.
- **Observation:** Every inline error body in these two controllers is `{ error: { code, message } }` with **no** `success: false` field, diverging from the `ApiResponse` contract (`backend/src/types/index.ts:123-138`) and from the central handler, which always sets `success: false` (`errorHandler.ts:199-200`). The frontend tolerates this (it reads `data.error?.message` regardless), so it is shape drift rather than a functional break.
- **Impact:** Inconsistent error envelope across the API. Any consumer (or future code) that branches on `success === false` would mis-handle these endpoints' errors. No security impact, but it is the exact "inline controller responses must match the shape" item the spec flags (§2).
- **Fix:** Add `success: false` to each inline error object in both controllers, or refactor to throw `ServiceUnavailableError` / `AppError` where headers are not yet flushed (all of `aiChatController:133/151`, `fhirController:44/64/158` fire before any stream/redirect commit, so they could go through the central handler).
- **Evidence:**
  ```ts
  res.status(503).json({
    error: { code: 'SERVICE_UNAVAILABLE', message: 'AI Health Guide is disabled: ...' },
  });
  ```

### F-4 — `fhirController.handleCallback` returns a bare-string error body — **Low**
- **Location:** `backend/src/controllers/fhirController.ts:87`.
- **Observation:** The missing-params branch responds `res.status(400).json({ error: 'Missing code or state' })` — `error` is a raw string, not the `{ code, message }` object the rest of the API uses, and again no `success: false`. This is the most divergent error body in the codebase.
- **Impact:** Shape drift only. The OAuth callback is reached by a browser redirect (the user lands on a JSON 400 page rather than the frontend), so the practical effect is a poor UX edge case rather than a leak. The frontend `client.ts` does handle string `error` (`client.ts:313-315`), but this endpoint is hit by the browser directly, not via `apiFetch`.
- **Fix:** Either normalize to `{ success: false, error: { code: 'BAD_REQUEST', message: 'Missing code or state' } }`, or — consistent with the other failure branch at `:104-105` — redirect to `frontendBase?error=invalid_callback` so the user is bounced back into the app UI rather than shown raw JSON.
- **Evidence:**
  ```ts
  if (!code || !state) {
    res.status(400).json({ error: 'Missing code or state' });
    return;
  }
  ```

### F-5 — Inline `details` populated for non-`ValidationError` paths in `biomarkerController` — **Low**
- **Location:** `backend/src/controllers/biomarkerController.ts:528-534` (400 `VALIDATION_ERROR` with `details: failedItems`) and `:576-586` (500 `DATABASE_ERROR` with a synthesized `details` array).
- **Observation:** The spec's §2 invariant is that `details` is attached **solely** for `ValidationError` and only carries `{ field, message, code }[]`. The central handler honors this (`errorHandler.ts:156-158`). These two inline batch-create responses bypass the handler and attach `details` arrays of `{ index, name, error }` — including, in the 400 case, per-item `error` strings derived from caught exceptions (`biomarkerController.ts:521`). The 500 case is careful to use a fixed `'Database operation failed'` string and not the raw DB error (good), but it still ships a `details` array on a 500, which the contract reserves for validation.
- **Impact:** Low. The 400 `details[].error` strings come from per-item encryption/build failures inside the batch loop, not raw DB/library errors, so the realistic leak is bounded; but it is an uncontrolled channel that could surface internal exception text if a new throw is added inside that loop. Primarily a contract-consistency issue.
- **Fix:** For the 400 path, restrict `details` to `{ field, message, code }`-shaped entries (e.g. `{ field: 'biomarkers[i]', message: 'Invalid', code: 'INVALID_ITEM' }`) so no caught-exception text reaches the client; drop the `details` array entirely from the 500 path (a 500 should be generic per §5).
- **Evidence:**
  ```ts
  error: { code: 'VALIDATION_ERROR', message: 'All biomarkers failed validation', details: failedItems },
  ```

### F-6 — Prompt drift: `ApiResponse.error` declares no `stack`, but the handler adds one in dev — **Low**
- **Location:** Type at `backend/src/types/index.ts:125-130`; runtime addition at `backend/src/middleware/errorHandler.ts:205-206`.
- **Observation:** The spec note (Files to Review, §2/§3) correctly states the `ApiResponse` type does *not* declare `stack`. The runtime nonetheless spreads `...(config.isDevelopment ? { stack: err.stack } : {})` into `error`. This is intentional and safe (dev-only, and staging/prod are excluded because `config.isDevelopment === !isProduction && !isStaging`, confirmed at `config/index.ts:36`), but it means the runtime emits a field the TypeScript contract forbids — the object is cast to `ApiResponse` at `errorHandler.ts:199`, so the excess property is silently allowed. This is the kind of type/runtime mismatch the protocol asks to record as prompt/spec drift.
- **Impact:** None at runtime in prod/staging. The drift is documentation/typing hygiene: a reader of the type would not know `stack` can appear, and a future strict-mode change could surface it.
- **Fix:** Either add an optional `stack?: string` to `ApiResponse['error']` with a comment that it is dev-only, or build the dev response via an explicitly-typed extended shape. No code-behavior change required.
- **Evidence:**
  ```ts
  // types/index.ts
  error?: { code: string; message: string; details?: unknown; };
  // errorHandler.ts:206
  ...(config.isDevelopment ? { stack: err.stack } : {}),
  ```

## Checks passed

### 1. Middleware registration order
- [x] Error handler is the last middleware registered — `app.use(errorHandler)` at `backend/src/app.ts:330`, after `notFoundHandler` and all routes; nothing is registered after it (file ends with `startServer()`).
- [x] 404 handler registered before the error handler — `app.use(notFoundHandler)` at `backend/src/app.ts:327`, immediately preceding `:330`.
- [x] Error handler has the 4-param `(err, req, res, next)` signature Express requires — `errorHandler(err, req, res, _next)` at `backend/src/middleware/errorHandler.ts:135-140`.
- [x] No middleware after the error handler — verified `app.ts:330` is the final `app.use`.

### 2. Response shape consistency
- [x] Central handler always emits `{ success: false, error: { code, message } }` — `errorHandler.ts:199-208`.
- [x] `details` attached only for `ValidationError` in the central handler — `errorHandler.ts:156-158`.
- [x] No raw HTML error pages — all error paths emit JSON; the central handler calls `res.status().json(response)` (`errorHandler.ts:210`).
- [x] No `stack` in prod/staging response body — gated on `config.isDevelopment` (`errorHandler.ts:206`), which is false in both prod and staging (`config/index.ts:36`).
- [x] SSE endpoint emits `text/event-stream` and signals errors via a `{ type: 'error', message }` event, not an HTTP body — `aiChatController.ts:180` (header) and `:277-283` (error event).
- [x] Rate-limit 429 bodies match the shape and emit standard headers — `rateLimiter.ts:21-28` (`success:false` body, `standardHeaders: true`).

### 3. Stack trace safety
- [x] Stack never in response body in prod or staging — single gate at `errorHandler.ts:206`, `config.isDevelopment` only.
- [x] Dev gate is `config.isDevelopment`, NOT `config.isProduction` — Grep for `config.isProduction` in `errorHandler.ts` returned **zero** hits; the message gate (`:144`) and stack gate (`:206`) both use `config.isDevelopment`.
- [x] `err.message` echoed only for unmapped errors in dev — `let message = config.isDevelopment ? err.message : GENERIC_ERROR_MESSAGE` (`errorHandler.ts:144`); prod/staging take the generic branch.
- [x] `Error.captureStackTrace` retained in the `AppError` constructor for logging, and `stack` is logged only in dev — `errorHandler.ts:24` (capture) and `:186` (`...(config.isDevelopment && { stack: err.stack })` in `logData`).

### 4. Internal-detail leakage
- [x] Prisma errors translated via `PRISMA_ERROR_MAP` / `handlePrismaError`, default returns `GENERIC_ERROR_MESSAGE`, `err.meta` never reflected — `errorHandler.ts:109-120, 159-160`; `PRISMA_DEFAULT` message is `GENERIC_ERROR_MESSAGE` (`:116`).
- [x] PG error codes only surface through the Prisma map — Grep for `PrismaClientKnownRequestError|P20\d{2}` across `backend/src/**/*.ts` found matches only in `errorHandler.ts` and its test file; no controller/service passthrough.
- [x] Library messages wrapped in `AppError` subclasses before throwing — Grep for `throw new (?!AppError|...)` across `backend/src/controllers/**/*.ts` returned **zero** raw `throw new Error(...)` hits.
- [x] No `.catch(console.*)` leaks — Grep for `\.catch\(console\.` across `backend/src/**/*.ts` returned **zero** hits.

### 5. Status code correctness
- [x] 400 for invalid JSON (`SyntaxError`→`INVALID_JSON`), P2003/P2014, generic Multer (`UPLOAD_ERROR`) — `errorHandler.ts:163-164, 112-113, 172-173`.
- [x] 401 incl. `JsonWebTokenError`→`INVALID_TOKEN`, `TokenExpiredError`→`TOKEN_EXPIRED` — `errorHandler.ts:122-125, 161-162`.
- [x] 403 for `PLAN_LIMIT_EXCEEDED` with `{ limit, current, feature, upgradeRequired }` (non-sensitive metadata) — `planGating.ts:90-104`.
- [x] 404 generic via Prisma P2025 — `errorHandler.ts:111`.
- [x] 409 via Prisma P2002 — `errorHandler.ts:110`.
- [x] 413 for oversize uploads (`LIMIT_FILE_SIZE`→`FILE_TOO_LARGE`) — `errorHandler.ts:170-171`.
- [x] 422 is the `ValidationError` status (not 400) — `ValidationError` constructor sets 422 (`errorHandler.ts:69`); frontend treats 422 distinctly (`client.ts:100-101`).
- [x] 429 from the rate limiter, not the error handler — `rateLimiter.ts` limiters respond directly with `RATE_LIMIT_EXCEEDED` (`:24` etc.); `RateLimitError` exists in the family but is not the live 429 path.
- [x] 500 body is generic in prod/staging (`GENERIC_ERROR_MESSAGE`, `INTERNAL_ERROR`/`DATABASE_ERROR`) — `errorHandler.ts:105, 116, 142-144`.
- [x] 503 inline from the BAA-off AI path (`SERVICE_UNAVAILABLE`) — `aiChatController.ts:129-141`.

### 6. Async error propagation
- [x] Every async route handler is wrapped in `asyncHandler` — Grep for `async (req...res...) =>` across `backend/src/routes/**/*.ts`: all 29 hits are inside `asyncHandler(...)`; AI and FHIR routes confirmed at `aiRoutes.ts:36` and `fhirRoutes.ts:24,35,39,49,59`.
- [x] `asyncHandler` forwards rejections to `next` — `Promise.resolve(fn(...)).catch(next)` at `errorHandler.ts:222-224`.
- [x] Top-level `unhandledRejection` / `uncaughtException` handlers log via the structured logger and `process.exit(1)` — `app.ts:411-422`.
- [x] SSE / OAuth handlers wrapped in `asyncHandler` AND catch internally for the post-flush window — `aiChatController.ts:189-294` (try/catch around the whole stream, emits error SSE then `res.end()`); `fhirController.handleCallback` catch redirects with `?error=` (`:100-106`).
- [x] Schedulers/background flows catch their own rejections so they can't crash the process via the new exit handler — `emailScheduler.runTick` try/catch (`emailScheduler.ts:287-308`); session cleanup `.catch` (`authService.ts:1421-1423`); audit cleanup try/catch (`auditLog.ts:601-608`).

### 7. Validation error output
- [x] Zod errors converted to `{ field, message, code }[]` via `zodIssueToDetail` (field = `issue.path.join('.')`, code = the Zod issue code) — `validation.ts:24-30, 171-172`, surfaced as 422 `ValidationError`.
- [x] Validation runs before the controller body and replaces `req[source]` with parsed+sanitized output — `validate` factory `validation.ts:148-179`; `Object.defineProperty(req, source, { value: validated, ... })` at `:160-165`.
- [x] No PHI value echoed in validation messages — schemas in `validation.ts` use static messages (`'Invalid email format'`, `'Password must be at least 12 characters'`, `'Invalid date format'`, etc.); no `.refine()`/custom message interpolates the input value (`validation.ts:104-132, 117-132`).

### 8. Timing attack defense
- [x] Login uses a timing-safe dummy bcrypt compare + random delay when the user doesn't exist — `authService.ts:780-791`.
- [x] Password comparison uses `bcrypt.compare`, not `===` — `authService.ts:202` (`verifyPassword`) and `:785` (dummy).
- [x] `forgotPassword` responds identically whether the email exists or not — always the generic 200 message (`authController.ts:756-764`).

### 9. Error to logs
- [x] Every 5xx logged at `error` level with statusCode/code/method/path/userId — `errorHandler.ts:178-192`; `req.path` (query-stripped), not `originalUrl` (Grep for `originalUrl` in `errorHandler.ts` = zero hits).
- [x] 4xx logged at `warn` only in development — `errorHandler.ts:193-196`.
- [x] Error handler does not log the request body, and no controller catch re-logs it — Grep for body-logging patterns in `backend/src/controllers/**/*.ts` returned zero hits.

### 10. Frontend consumption
- [x] `client.ts` parses both string and object `error` shapes and normalizes to `ApiError` — `client.ts:313-324`.
- [x] `getUserFriendlyMessage` echoes the server message only for 4xx, generic for 5xx — `client.ts:86-89` (4xx echo) and `:105-108` (5xx generic).
- [x] 401 triggers refresh-then-retry-once, exempting `/auth/refresh` and `/auth/logout` — `client.ts:248, 284-291, 303-311`.
- [x] `PLAN_LIMIT_EXCEEDED` 403 special-cased with `isPlanLimitError` + `planLimit` — `client.ts:55-62, 328-341`.
- [x] 429 retried with `Retry-After`/exponential backoff + jitter (`MAX_RETRY_429 = 3`), exempting auth-management endpoints — `client.ts:185, 201-206, 267-277`.
- [x] Network errors (status 0 → `NETWORK_ERROR`) and timeouts (`AbortError` → 408 `TIMEOUT`) distinguished — `client.ts:350-366`.
- [x] `ErrorBoundary` wraps the lazy route trees and shows dev-only details — wraps `AppContent` (which holds the `Suspense`/lazy routes) at `App.tsx:301-316`; dev gate at `ErrorBoundary.tsx:161`.
- [x] AI chat consumes `text/event-stream` via a reader and distinguishes the `{ type: 'error' }` event, `message_stop`, and a mid-stream silent close — `ai.ts:168, 193, 199-200, 217-218`.

### 11. Non-operational errors
- [x] `AppError.isOperational` distinguishes expected vs programmer error; `InternalServerError` and `DatabaseError` set `isOperational = false` — `errorHandler.ts:10, 82, 94`.
- [x] User-input-caused errors are operational — `BadRequestError`/`ValidationError`/etc. default `isOperational = true` via the base constructor (`errorHandler.ts:16, 29-78`).

## Unverifiable
- Whether 401/403 brute-force-relevant failures are captured in the auth/audit layer (the spec notes the central handler stays silent on 4xx in prod). The auth controller does call `auditService.logAuth('LOGIN_FAILED'/'ACCOUNT_LOCKOUT', ...)` (`authController.ts:276, 295, 321, 330`), which suggests coverage, but a full audit-coverage assessment belongs to prompt 31 (logging) / 05 (audit logging), not confirmed end-to-end here.
- Server-side error aggregator (Cloud Error Reporting / Sentry) and a BAA for it — `ErrorBoundary.tsx:77` has a `// logErrorToService` placeholder only; no aggregator wiring is present in the reviewed files. Whether one exists in infra is outside the code.
- Load behavior of the error path under a malformed biomarker batch (spec Q3) — not testable by static read; the batch path is bounded to 100 items by the Zod schema (`validation.ts:351`) and DB failures are caught (`biomarkerController.ts:565-593`), but actual process-stability under load is not verified.

## Out of scope
- `npm audit` / `npm outdated` for CVE-bearing dependencies — the error-handling spec's verification table does not call for it, and dependency posture is owned by the dedicated dependency-audit prompt. Skipped to keep this review focused on the error-response pipeline.
- PHI redaction internals of the log sink (`utils/phiRedaction.ts`) and `stripPHIFromText` correctness — cross-referenced by §3/§9 but owned by prompt 31 (logging-observability); only the call sites were confirmed here (`aiChatController.ts:222, 233`).
- Deep correctness of the SMART/OAuth handshake and SSRF allowlist (`fhir/smartAuth.ts`, `fhir/urlSafety.ts`) — relevant to F-1's blast radius but owned by prompt 09 (external APIs); only the controller-level error reflection was assessed.
