# ERROR_RECOVERY.md

_Generated 2026-04-24 — reference for every HTTP error this API can produce: envelope, code catalog, per-code recovery, frontend handling, and incident playbooks._

---

## 1. Error envelope

Every non-success response emitted by the centralized error handler has this shape. The handler is registered last in the Express stack (see [`ARCHITECTURE.md`](./ARCHITECTURE.md)) and funnels all thrown errors through a single JSON contract.

```ts
// Source: backend/src/middleware/errorHandler.ts:L189-L200
const response: ApiResponse = {
  success: false,
  error: {
    code,
    message,
    ...(details ? { details } : {}),
    // Only include stack trace in development mode
    ...(config.isDevelopment ? { stack: err.stack } : {}),
  },
};

res.status(statusCode).json(response);
```

The `AppError` base class (`backend/src/middleware/errorHandler.ts:L7-L26`) carries `statusCode`, `code`, `message`, and an `isOperational` flag. The handler **replaces `message` with a generic string in production unless the error was `instanceof AppError`** (`errorHandler.ts:L144` and `L153-L158`), so only `AppError` subclass messages are user-safe.

`ValidationError` additionally carries `details` (`errorHandler.ts:L66-L72`, surfaced at `L157`).

### Subclass catalog (code defaults set in `errorHandler.ts`)

| Class | HTTP | `code` | Default message | Source |
|---|---|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST` | `'Bad Request'` | `errorHandler.ts:L29-L33` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` | `'Unauthorized'` | `errorHandler.ts:L35-L39` |
| `AuthenticationError` | 401 | `AUTHENTICATION_FAILED` | `'Authentication failed'` | `errorHandler.ts:L41-L45` |
| `ForbiddenError` | 403 | `FORBIDDEN` | `'Forbidden'` | `errorHandler.ts:L47-L51` |
| `NotFoundError` | 404 | `NOT_FOUND` | `'Resource not found'` | `errorHandler.ts:L53-L57` |
| `ConflictError` | 409 | `CONFLICT` | `'Conflict'` | `errorHandler.ts:L59-L63` |
| `ValidationError` | 422 | `VALIDATION_ERROR` | `'Validation failed'` | `errorHandler.ts:L65-L72` |
| `RateLimitError` | 429 | `RATE_LIMIT_EXCEEDED` | `'Too many requests'` | `errorHandler.ts:L74-L78` |
| `InternalServerError` | 500 | `INTERNAL_ERROR` | `'Internal server error'` | `errorHandler.ts:L80-L84` |
| `DatabaseError` | 500 | `DATABASE_ERROR` | `'Database operation failed'` | `errorHandler.ts:L92-L96` |
| `ExternalServiceError` | 502 | `EXTERNAL_SERVICE_ERROR` | `'{service}: {message}'` | `errorHandler.ts:L98-L102` |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` | `'Service temporarily unavailable'` | `errorHandler.ts:L86-L90` |

> Throw sites pass **domain-specific `message` strings** to these subclasses; the table above shows the defaults only. The per-code sections below list the exact thrown-at lines and their actual messages.

---

## 2. HTTP status conventions

| Status | Meaning in this API | Typical code(s) | Typical producers |
|---|---|---|---|
| 400 | Client-side malformed input (missing field, wrong JSON, wrong PDF) | `BAD_REQUEST`, `INVALID_JSON` | `BadRequestError`, JSON parser in `errorHandler.ts:L163-L165` |
| 401 | Not authenticated, or token invalid/expired | `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` | `authenticate` (`auth.ts:79`), JWT map (`errorHandler.ts:L122-L127`) |
| 403 | Authenticated but forbidden (CSRF, role, consent, demo, plan) | `FORBIDDEN`, `CSRF_MISMATCH` (via `ForbiddenError`), `EMAIL_NOT_VERIFIED`, `PLAN_LIMIT_EXCEEDED` | `csrf.ts`, `rbac.ts`, `demoProtection.ts`, `planGating.ts` |
| 404 | Resource not found, or RLS-masked as not-found | `NOT_FOUND` | All `throw new NotFoundError(...)` sites |
| 409 | Uniqueness violation at the DB | `CONFLICT` | Prisma `P2002` (`errorHandler.ts:L110`) |
| 413 | **Not emitted.** File size limits raise `VALIDATION_ERROR` (422) through `ValidationError`, not a native 413 | — | `controllers/upload/shared.ts:113` |
| 419 | **Not emitted.** The codebase expresses session expiry as 401 `TOKEN_EXPIRED` / `UNAUTHORIZED` — see §8 decision tree | — | — |
| 422 | Zod validation failure, bad file content | `VALIDATION_ERROR` | `validate()` (`validation.ts:L170-L172`), `controllers/upload/shared.ts` |
| 423 | Account lockout after repeated failed logins | `ACCOUNT_LOCKED` | `authController.ts:263` |
| 429 | Rate limit exceeded | `RATE_LIMIT_EXCEEDED`, `AUTH_RATE_LIMIT_EXCEEDED`, `LOGIN_RATE_LIMIT_EXCEEDED`, `UPLOAD_RATE_LIMIT_EXCEEDED`, `SENSITIVE_RATE_LIMIT_EXCEEDED`, `AI_RATE_LIMIT_EXCEEDED`, `BULK_RATE_LIMIT_EXCEEDED` | `rateLimiter.ts` |
| 500 | Unhandled server error, DB write fail, AI extraction fail | `INTERNAL_ERROR`, `DATABASE_ERROR`, `CONTEXT_ASSEMBLY_FAILED`, `SYNC_FAILED`, `DISCONNECT_FAILED` | `InternalServerError`, inline `res.status(500).json(...)` |
| 502 | Upstream dependency failed (GCS read, Anthropic upstream error) | `STORAGE_READ_FAILED`, `EXTERNAL_SERVICE_ERROR` | `fileController.ts:282`, `biomarkerRoutes.ts:246` |
| 503 | BAA-gated AI disabled, or 3rd-party integration disabled | `SERVICE_UNAVAILABLE` | `claudeExtraction.ts` BAA gate, `biomarkerRoutes.ts:141`, `aiChatController.ts:138`, `fhirController.ts:44`, `expenseController.ts:637` |
| 504 | Upstream timeout (Anthropic read timed out) | (no code field, `{error: '...'}`) | `biomarkerRoutes.ts:287`, `expenseController.ts:747` |

> **Drift note (see §11):** the prompt specified `419 SESSION_EXPIRED` and `413 UPLOAD_TOO_LARGE` as canonical codes. Neither exists in the codebase today.

---

## 3. Master error-code table

Every `code` value emitted by the backend is listed here. Codes come from three sources: (a) `AppError` subclass constructors, (b) the `errorHandler`'s Prisma/JWT/JSON mapping, and (c) inline `res.status(N).json({ error: { code: ... } })` controllers.

**Legend:** "User-facing message" quotes what the client receives. For `AppError` subclass throws, the handler passes the thrown `message` through verbatim (`errorHandler.ts:L153-L158`). Where a throw site supplies a specific message, it's quoted; where it relies on the constructor default, the default is shown.

| `code` | HTTP | User-facing message | Thrown at (file:line) | Recovery action | Related |
|---|---|---|---|---|---|
| `BAD_REQUEST` | 400 | Varies by throw site (see [§5 BAD_REQUEST](#bad_request-http-400)) | `authController.ts:154,160,166,171,218,491,497,553,560,569,601,655,699,738,742`; `adminRoutes.ts:217,500`; `validation.ts:211`; `utils/securePdfParsing.ts:62,74,85,97,187,199,246,260`; `services/pdfParser.ts:872,889,1324,1341`; `services/ocrService.ts:374,425` | Fix input per field-level error | [`API_REFERENCE.md`](./API_REFERENCE.md) |
| `INVALID_JSON` | 400 | `"Request body contains invalid JSON"` | `errorHandler.ts:164` (SyntaxError path) | Send a valid JSON body with `Content-Type: application/json` | — |
| `UNAUTHORIZED` | 401 | `"Authentication required"` / `"Invalid token type"` / `"Bearer token required"` / `"User not found"` / `"Invalid password"` / `"Password is required to delete account"` / `"Current password is incorrect"` / `"Refresh token not provided"` / `"Invalid or expired refresh token"` / `"Not authenticated"` | `auth.ts:79,87,175,181`; `authController.ts:296,338,348,425,459,464,487,502,509`; `settingsController.ts:345,694,699,824,839,845,936,1055,1095` | Retry with fresh cookies; refresh token or log in | [`ARCHITECTURE.md#auth-flow`](./ARCHITECTURE.md) |
| `INVALID_TOKEN` | 401 | `"Invalid authentication token"` | `errorHandler.ts:123` (JWT map) | Log out + log in (refresh path won't help for malformed tokens) | — |
| `TOKEN_EXPIRED` | 401 | `"Authentication token has expired"` | `errorHandler.ts:124` (JWT map) | Call `/api/v1/auth/refresh`; retry on success | [`API_REFERENCE.md#auth-endpoints`](./API_REFERENCE.md) |
| `INVALID_CREDENTIALS` | 401 | `"Invalid email or password"` (+ `details.remainingAttempts`) | `authController.ts:279` | Prompt user to correct credentials; show `remainingAttempts` if present | `LOGIN_FAILED` audit row |
| `FORBIDDEN` | 403 | Varies (CSRF, consent, demo, role, ownership). Quoted per throw site below | `csrf.ts:161,166,175`; `rbac.ts:70,91,111,136,155,165,317`; `demoProtection.ts:54,73,99,123,131,151,170`; `adminRoutes.ts:279,386,472`; `providerRoutes.ts:157,188,191,302,313,430,441,451,570,581,591,686,697`; `patientRoutes.ts:376` | See [§5 FORBIDDEN family](#forbidden-family-http-403) | [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) |
| `EMAIL_NOT_VERIFIED` | 403 | Whatever `attemptLogin` returns for `emailNotVerified` (fallback `"Email not verified"`) | `authController.ts:237` | POST `/auth/resend-verification` then verify | — |
| `PLAN_LIMIT_EXCEEDED` | 403 | `"You've reached your plan limit ({current}/{limit}). Upgrade to continue."` or `"This feature is not available on your current plan. Upgrade to access it."` | `planGating.ts:88-99` | Surface upgrade CTA; response carries `{limit, current, feature, upgradeRequired: true}` | See frontend narrowing helper `isPlanLimitError` in `client.ts:L55-L62` |
| `NOT_FOUND` | 404 | Varies — `"Biomarker not found"` / `"File not found"` / `"Health goal not found"` / `"Health need not found"` / `"Insurance plan not found"` / `"User not found"` / `"Connection not found"` / `"Patient not found with this email"` / `"Patient not found or account is inactive"` / `"Relationship not found"` / `"Access request not found or already processed"` / `"Active provider relationship not found"` / `"Provider relationship not found"` / `"Provider-patient relationship not found"` / `"At least 2 valid plans required for comparison"` | `biomarkerController.ts:210,307,396,788`; `fileController.ts:147,235,317`; `healthGoalsController.ts:319,473,553,658`; `healthNeedsController.ts:170,260,318,361`; `insuranceController.ts:484,663,718,762`; `adminRoutes.ts:177,329,405,488,599,720`; `providerRoutes.ts:147,322,460,600,677`; `patientRoutes.ts:222,302,361,452,516`; `routes/biomarkerRoutes.ts:174`; `controllers/upload/sbcUploadController.ts:246`; `fhirController.ts:158`; `routes/notFoundHandler` (`errorHandler.ts:204-206`); Prisma P2025 (`errorHandler.ts:111`) | Verify resource ID. If user expected access, may be an RLS denial — see [§7](#7-recovery-playbooks) | [`DATA_MODEL.md#row-level-security-rls`](./DATA_MODEL.md) |
| `CONFLICT` | 409 | `"A record with this data already exists"` | `errorHandler.ts:110` (Prisma P2002) | Check for uniqueness violation; adjust payload | — |
| `VALIDATION_ERROR` | 422 | `"Validation failed"` + `details: ValidationErrorDetail[]` from Zod; or bespoke strings from throw sites — `"File content does not match its declared type"`, `"No file uploaded"`, `"Only {types} are accepted"`, `"File size must be less than {N}MB"`, `"Could not extract any biomarkers from the PDF..."`, `"Missing required fields: name, unit, category, startDate, targetDate"`, `"targetValue must be a valid number"`, `"currentValue must be a valid number when provided"`, `"Value is required"` | Zod: `validation.ts:170-172`. Explicit: `controllers/upload/shared.ts:89,100,108,113`; `controllers/upload/sbcUploadController.ts:61,264`; `controllers/upload/labUploadController.ts:61,221`; `healthGoalsController.ts:357,362,367,540`; inline `biomarkerController.ts:520-533` | Fix the field(s) listed in `details` | Zod schemas in `middleware/validation.ts:L220-L768` |
| `ACCOUNT_LOCKED` | 423 | Whatever `attemptLogin` returns, typically `"Account is locked"` (+ `details.lockedUntil`) | `authController.ts:263` | Wait until `lockedUntil`; or reset password to unlock | `ACCOUNT_LOCKOUT` audit |
| `RATE_LIMIT_EXCEEDED` | 429 | `"Too many requests, please try again later."` | `rateLimiter.ts:22` (standardLimiter) | Wait then retry; honor `RateLimit-*` headers (`standardHeaders: true`) | [`ROUTING_TABLE.md#rate-limiters`](./ROUTING_TABLE.md) |
| `AUTH_RATE_LIMIT_EXCEEDED` | 429 | `"Too many authentication attempts, please try again in 15 minutes."` | `rateLimiter.ts:41` (authLimiter) | Wait 15 min | — |
| `LOGIN_RATE_LIMIT_EXCEEDED` | 429 | `"Too many login attempts. Please try again in 15 minutes."` | `rateLimiter.ts:56` (strictAuthLimiter) | Wait 15 min; keyed by email+IP, so brute-force one account doesn't lock out others | — |
| `UPLOAD_RATE_LIMIT_EXCEEDED` | 429 | `"Too many file uploads, please try again later."` | `rateLimiter.ts:78` (uploadLimiter) | Wait (1h window, 20 uploads/hr) | — |
| `SENSITIVE_RATE_LIMIT_EXCEEDED` | 429 | `"Rate limit exceeded for sensitive operations."` | `rateLimiter.ts:93` (sensitiveLimiter) | Wait (1h window, 10/hr) | — |
| `AI_RATE_LIMIT_EXCEEDED` | 429 | `"Too many AI requests. Please try again later."` | `rateLimiter.ts:108` (aiLimiter, keyed by user id) | Wait (1h window, 10/hr per user) | — |
| `BULK_RATE_LIMIT_EXCEEDED` | 429 | `"Too many bulk operations. Please try again later."` | `rateLimiter.ts:127` (bulkOperationLimiter) | Wait (1h window, 30/hr) | — |
| `INTERNAL_ERROR` | 500 | Dev: thrown message; Prod: `"An unexpected error occurred. Please try again later."` (`errorHandler.ts:105,144`) | Default when `err` is not `AppError` and not Prisma/JWT/JSON; also `InternalServerError` throws like `claudeExtraction.ts:55,119,219,247,258,289,295,300,305`; `sbcExtraction.ts:323,782,870,909,920,1039,1045,1050,1057`; `ocrService.ts:83,86,100,287,390,404,411,418,431`; `pdfParser.ts:881,1333`; `securePdfParsing.ts:274` | Server bug; retry once. Check `RUNBOOK.md` if repeated. | [`RUNBOOK.md`](./RUNBOOK.md) |
| `DATABASE_ERROR` | 500 | Prisma default: `"An unexpected error occurred. Please try again later."` (`errorHandler.ts:116`). Inline: `"Failed to create biomarkers"` (`biomarkerController.ts:571`) | Prisma unmapped errors (`errorHandler.ts:L118-L120`); `biomarkerController.ts:568-578` | Server bug; check Cloud SQL logs | [`DATA_MODEL.md`](./DATA_MODEL.md) |
| `CONTEXT_ASSEMBLY_FAILED` | 500 | `"Unable to prepare your health context."` | `aiChatController.ts:157` | Retry; underlying error logged server-side; often RLS / decryption issue | — |
| `SYNC_FAILED` | 500 | Err message fallback `"Sync failed"` | `fhirController.ts:172` | Retry; inspect Quest OAuth token validity | [`ENV_VARS.md`](./ENV_VARS.md) (Quest keys) |
| `DISCONNECT_FAILED` | 500 | Err message fallback `"Disconnect failed"` | `fhirController.ts:199` | Retry; may require admin DB cleanup | — |
| `VERIFICATION_FAILED` | 400 | `result.error` or `"Email verification failed"` | `authController.ts:618` | Request a fresh token via `/auth/resend-verification` | — |
| `RESEND_FAILED` | 400 | `result.error` or `"Failed to resend verification email"` | `authController.ts:664` | Check email-service status; retry; real reason logged server-side | — |
| `RESET_FAILED` | 400 | `result.error` or `"Password reset failed"` | `authController.ts:759` | Request fresh reset token (1h TTL) | — |
| `EXTERNAL_SERVICE_ERROR` | 502 | `"{service}: {message}"` | `ExternalServiceError` class constructor (`errorHandler.ts:L98-L102`). **No throw sites found in the codebase** — class is defined but unused. Flag below. | Retry; check upstream status | — |
| `STORAGE_READ_FAILED` | 502 | `"Unable to read file from storage"` | `fileController.ts:284` (GCS read stream error) | Retry; check GCS bucket permissions + object existence | [`RUNBOOK.md`](./RUNBOOK.md) |
| `SERVICE_UNAVAILABLE` | 503 | `"AI Health Guide is disabled: ANTHROPIC_BAA_ACTIVE must be \"true\". See SECURITY_STATUS.md C-7."` (`aiChatController.ts:138-144`); `"AI guidance is disabled: ANTHROPIC_BAA_ACTIVE must be \"true\". See SECURITY_STATUS.md C-7."` (`biomarkerRoutes.ts:141-147`); `"AI cost analysis is disabled: ANTHROPIC_BAA_ACTIVE must be \"true\"..."` (`expenseController.ts:637`); `"Quest FHIR integration is not configured on this server. Set QUEST_FHIR_CLIENT_ID."` (`fhirController.ts:44`); and `ServiceUnavailableError` default `"Service temporarily unavailable"` (no throw sites found for the class itself) | Check `ANTHROPIC_BAA_ACTIVE` flag on Cloud Run; flip per `cloud-run-env-update-pinning.md` memory | [`RUNBOOK.md`](./RUNBOOK.md) |
| `CONNECT_FAILED` | 500 | `"Could not start the Quest connection flow."` | `fhirController.ts:65` | Check Quest OAuth config (`QUEST_FHIR_CLIENT_ID`) | — |

### Codes flagged for missing or non-standard messages

Per the prompt's quality bar ("if a code has no explicit user message, flag it"):

1. **`UNAUTHORIZED` 504 timeout responses in `biomarkerRoutes.ts:287` and `expenseController.ts:747`** use `error: '<string>'` rather than `error: { code, message }` — they never surface a code in the envelope.
2. **`AUTHENTICATION_FAILED`** (`errorHandler.ts:L41-L45`) is defined but never thrown anywhere in `backend/src/`.
3. **`EXTERNAL_SERVICE_ERROR`** (`errorHandler.ts:L98-L102`) is defined but never thrown anywhere in `backend/src/`.
4. **`ServiceUnavailableError`** class is defined but never thrown; the 503 responses that do exist use inline `res.status(503).json(...)` with `code: 'SERVICE_UNAVAILABLE'`.
5. **`RateLimitError`** class is defined but never thrown — rate-limit responses come from `express-rate-limit`'s `message` field, not this class.
6. **`ConflictError`** class is defined but never thrown — the only 409 in the codebase comes from Prisma `P2002` via `errorHandler.ts:L110`.
7. **`DatabaseError`** class is defined but never thrown as the class — `biomarkerController.ts:571` emits the `DATABASE_ERROR` code inline, and other DB errors flow through the Prisma path in `errorHandler.ts:L118-L120`.
8. **`expenseController.ts:89,128,203,255,282,403,467,534,560,579,605,623,664,747,751,802` and `biomarkerController.ts:568-578` (partial)** emit errors in a non-standard shape `{ error: '<string>' }` instead of `{ success: false, error: { code, message } }` — the frontend's interpreter reads `data.error?.message` which will be `undefined` in these paths.
9. **`mockFhirServer.ts:126,138`** return `{ error: 'invalid_request', ... }` and `{ error: 'unsupported_grant_type' }` — these are OAuth2-conformant error shapes, not the app envelope, and only run in dev.

---

## 4. AppError subclass throw map (summary)

High-level counts from `Grep throw new (NotFoundError|...)` over `backend/src/` (matches, not distinct messages):

| Subclass | Throw sites | Hottest files |
|---|---|---|
| `NotFoundError` | 40+ | `providerRoutes.ts` (6), `adminRoutes.ts` (6), `patientRoutes.ts` (5), `healthGoalsController.ts` (4), `healthNeedsController.ts` (4), `insuranceController.ts` (4), `fileController.ts` (3), `biomarkerController.ts` (4) |
| `ForbiddenError` | 30+ | `providerRoutes.ts` (11), `demoProtection.ts` (7), `csrf.ts` (3), `adminRoutes.ts` (3), `patientRoutes.ts` (1), `rbac.ts` (via `next(new ForbiddenError(...))` 7 sites) |
| `UnauthorizedError` | 20+ | `authController.ts` (9), `settingsController.ts` (8), `auth.ts` (4), `rbac.ts` (via `next` 5 sites) |
| `BadRequestError` | 30+ | `authController.ts` (12), `utils/securePdfParsing.ts` (8), `services/pdfParser.ts` (4), `adminRoutes.ts` (2), `services/ocrService.ts` (2), `validation.ts` (1) |
| `ValidationError` | ~12 | `controllers/upload/shared.ts` (4), `controllers/upload/sbcUploadController.ts` (2), `healthGoalsController.ts` (4), `controllers/upload/labUploadController.ts` (2) |
| `InternalServerError` | ~25 | `claudeExtraction.ts` (8), `sbcExtraction.ts` (9), `ocrService.ts` (7), `pdfParser.ts` (2), `securePdfParsing.ts` (1) |

All line-accurate citations are in [§3](#3-master-error-code-table) and the deep dives below.

---

## 5. Per-code deep dives (grouped by family)

### Auth family

#### `UNAUTHORIZED` (HTTP 401)

**Thrown at (middleware, 4 sites)**:
```
auth.ts:79   → 'Authentication required'   (no token in cookie or header)
auth.ts:87   → 'Invalid token type'        (refresh token presented where access expected)
auth.ts:175  → 'Bearer token required'     (requireBearerAuth: SSE routes)
auth.ts:181  → 'Invalid token type'        (same, bearer-only path)
```

**Thrown at (controllers, 17 sites)** — see [§3](#3-master-error-code-table) for full list.

**Developer recovery**:
1. If a cookie-authenticated client gets `UNAUTHORIZED`, check whether a refresh cookie is present. Call `POST /api/v1/auth/refresh`. If it succeeds, retry the original request.
2. If `/auth/refresh` itself returns 401 → terminal; full logout + login required.
3. Token-type mismatch (`'Invalid token type'`) indicates a client bug sending the refresh token where an access token is expected.

**Snippet**:
```ts
// Source: backend/src/middleware/auth.ts:L75-L110
const token = extractToken(req);
if (!token) {
  throw new UnauthorizedError('Authentication required');
}
const decoded = jwt.verify(token, config.jwt.accessSecret, JWT_VERIFY_OPTIONS) as JwtPayload;
if (decoded.type && decoded.type !== 'access') {
  throw new UnauthorizedError('Invalid token type');
}
```

**Audit log**: `LOGIN_FAILED` and `ACCOUNT_LOCKOUT` events are written in `authController.ts:229,248,270,291` via `auditService.logAuth(...)`. Middleware 401s (no token / expired) are **not** audited — they precede user identification.

**Frontend handling**: `client.ts:L223` and `L242` both check `response.status === 401 && !isRetry && !isAuthMgmtEndpoint` and call `attemptTokenRefresh()` (`client.ts:L136-L170`). On success, the original request is replayed with `isRetry = true`; on failure the `onAuthFailureCallback` fires (usually `AuthContext.logout()`).

#### `TOKEN_EXPIRED` (HTTP 401)

Emitted **only** by `errorHandler`'s JWT error map (`errorHandler.ts:L124`). It's how expiry is signaled: `jwt.verify` raises `TokenExpiredError`, the handler rewrites it to `{ code: 'TOKEN_EXPIRED', message: 'Authentication token has expired' }` at `errorHandler.ts:L161-L162`.

**Note:** `auth.ts:L102-L105` catches `TokenExpiredError` first and wraps it in `UnauthorizedError('Token has expired. Please refresh your session.')`. So most 401s from expired tokens surface as `UNAUTHORIZED` with the refresh-prompt message, **not** `TOKEN_EXPIRED`. The JWT-map path (`TOKEN_EXPIRED`) only fires for unwrapped `TokenExpiredError`s that slip past the middleware (rare — only if code elsewhere calls `jwt.verify` and lets the raw error propagate).

**Developer recovery**: Identical to `UNAUTHORIZED` — refresh path applies.

#### `INVALID_TOKEN` (HTTP 401)

Sibling of `TOKEN_EXPIRED`: the JWT map's `JsonWebTokenError` branch (`errorHandler.ts:L123`). `auth.ts:L105-L106` normally wraps this into `UnauthorizedError('Invalid token')`. Reaching the `INVALID_TOKEN` code means a `JsonWebTokenError` escaped the middleware — usually a corrupted header or signature.

**Recovery**: Log out + log in; the access token is unsalvageable.

#### `INVALID_CREDENTIALS` (HTTP 401)

**Thrown at**: `authController.ts:279` (`res.status(401).json({ ... code: 'INVALID_CREDENTIALS' ... })` — bypasses the error handler).

**Response shape**:
```ts
// Source: backend/src/controllers/authController.ts:L276-L287
const response: ApiResponse = {
  success: false,
  error: {
    code: 'INVALID_CREDENTIALS',
    message: result.error || 'Invalid email or password',
    details: { remainingAttempts: result.remainingAttempts },
  },
};
res.status(401).json(response);
```

**Audit log**: `LOGIN_FAILED` via `authController.ts:L270-L274` with `reason: 'INVALID_CREDENTIALS'`.

**Developer recovery**: Surface the message and `remainingAttempts` to the user; do not auto-retry.

#### `EMAIL_NOT_VERIFIED` (HTTP 403)

**Thrown at**: `authController.ts:237` (inline).

**Audit log**: `LOGIN_FAILED` with `reason: 'EMAIL_NOT_VERIFIED'` (`authController.ts:229`).

**Developer recovery**: Trigger `POST /api/v1/auth/resend-verification` with the email. User clicks link in email, re-attempts login.

#### `ACCOUNT_LOCKED` (HTTP 423)

**Thrown at**: `authController.ts:256-263` (inline `res.status(423)`).

**Response includes**: `details.lockedUntil` ISO timestamp.

**Audit log**: `ACCOUNT_LOCKOUT` action via `authController.ts:248`.

**Developer recovery**: Show countdown to `lockedUntil`; offer "reset password" as the unlock path.

### CSRF family

#### `FORBIDDEN` from CSRF (HTTP 403)

**Thrown at**:
```ts
// Source: backend/src/middleware/csrf.ts:L155-L176
const cookieToken = req.cookies[CSRF_COOKIE_NAME];
const headerToken = req.headers[CSRF_HEADER_NAME] as string;

if (!cookieToken || !headerToken) {
  throw new ForbiddenError('CSRF token missing');
}
if (cookieToken.length !== headerToken.length) {
  throw new ForbiddenError('Invalid CSRF token');
}
const tokensMatch = crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
if (!tokensMatch) {
  throw new ForbiddenError('Invalid CSRF token');
}
```

All three emit `code: 'FORBIDDEN'` (the `ForbiddenError` default) — there is **no dedicated `CSRF_MISMATCH` code**. This is a drift from the prompt, which assumed one (see [§11](#11-prompt-drift-log)).

**Exempt paths** (`csrf.ts:L98-L132`): `/auth/login`, `/auth/register`, `/auth/demo`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`, `/marketplace/plans/search`, `/upload/lab-report`, `/upload/insurance-sbc`, `/upload/lab-results-ocr`, `/insurance/upload-sbc`, `/ai/chat` (bearer-only SSE).

**Developer recovery**:
1. Hit `GET /api/v1/csrf-token` to set a fresh cookie (`csrf.ts:L210-L219`).
2. Read the `csrf_token` cookie (httpOnly: false by design — `csrf.ts:L43`).
3. Re-send the mutation with `x-csrf-token: <cookie value>`.

**Frontend handling**: `client.ts:L120-L134` reads the cookie via `document.cookie.match(/csrf[_-]?token=([^;]+)/i)` and attaches `x-csrf-token` to every POST/PUT/PATCH/DELETE automatically.

### Validation family

#### `VALIDATION_ERROR` (HTTP 422)

**Zod path** (primary): `validation.ts:L168-L178` turns any `ZodError` into `new ValidationError('Validation failed', details)` with `details: Array<{ field, message, code }>`.

```ts
// Source: backend/src/middleware/validation.ts:L168-L178
if (isZodError(error)) {
  const details: ValidationErrorDetail[] = error.errors.map(zodIssueToDetail);
  next(new ValidationError('Validation failed', details));
}
```

**Explicit throws** (non-Zod): 12 sites, full list in [§3](#3-master-error-code-table).

**Developer recovery**: Read `error.details`, map each `field` to its UI component, display the `message` inline.

**Audit log**: No validation audit log (validation runs before ownership is established — nothing PHI-meaningful to log).

#### `BAD_REQUEST` (HTTP 400)

Used for early-exit input validation that can't fit into Zod (e.g., `Content-Type` check, registration pre-flight):

```ts
// Source: backend/src/middleware/validation.ts:L207-L215
if (!contentType.includes('application/json')) {
  throw new BadRequestError(
    'Content-Type must be application/json for requests with body'
  );
}
```

Also used by PDF-parser defensive checks (`securePdfParsing.ts` — 8 sites for malformed PDFs, reporting version mismatches, header issues, size floor, etc.).

### RBAC family

All throws from `rbac.ts` flow through `next(new <Error>(...))`, so they land in the handler like any other throw.

**Role/scope errors**:
```
rbac.ts:70   → ForbiddenError: 'Access denied. Required roles: {roles}'       (requireRole)
rbac.ts:91   → ForbiddenError: 'Access denied. Minimum role required: {role}' (requireMinRole)
rbac.ts:111  → ForbiddenError: 'Permission denied: {permission} on {resource}' (requirePermission)
rbac.ts:136  → ForbiddenError: 'Permission denied: ...'                       (requireResourceAccess pre-check)
rbac.ts:155  → ForbiddenError: 'You can only access your own data'            (PATIENT accessing other user)
rbac.ts:165  → ForbiddenError: "You do not have access to this patient's data" (PROVIDER without consent)
rbac.ts:317  → ForbiddenError: 'You do not have access to this resource'      (requireOwnership)
rbac.ts:64,82,104,127,266 → UnauthorizedError: 'Authentication required'      (missing req.user)
```

**Provider consent throws** (`providerRoutes.ts:302,313,430,441,451,570,581,591,686,697`): active-ACTIVE + consent-not-expired checks done at the route layer before passing through `requireResourceAccess`.

**Developer recovery**: Ask the user to verify they're logged in with the right role. For PROVIDER consent errors, the patient must (re-)grant consent; PROVIDER cannot self-heal.

### Rate-limit family (HTTP 429)

Seven distinct codes — all emitted by `express-rate-limit` without passing through the centralized error handler. The limiter writes the JSON body from its `message` option directly.

| Code | Window | Max | Keyed by | Source |
|---|---|---|---|---|
| `RATE_LIMIT_EXCEEDED` | `config.rateLimit.windowMs` | `config.rateLimit.maxRequests` | IP | `rateLimiter.ts:16-32` |
| `AUTH_RATE_LIMIT_EXCEEDED` | 15 min | 20 | IP | `rateLimiter.ts:35-47` |
| `LOGIN_RATE_LIMIT_EXCEEDED` | 15 min | 5 | `email:ip` (skipSuccessfulRequests) | `rateLimiter.ts:50-69` |
| `UPLOAD_RATE_LIMIT_EXCEEDED` | 1 hr | 20 | IP | `rateLimiter.ts:72-84` |
| `SENSITIVE_RATE_LIMIT_EXCEEDED` | 1 hr | 10 | IP | `rateLimiter.ts:87-99` |
| `AI_RATE_LIMIT_EXCEEDED` | 1 hr | 10 | user id (fallback IP) | `rateLimiter.ts:102-118` |
| `BULK_RATE_LIMIT_EXCEEDED` | 1 hr | 30 | IP | `rateLimiter.ts:121-133` |

**`Retry-After` semantics**: all limiters set `standardHeaders: true` (e.g., `rateLimiter.ts:26`), which causes `express-rate-limit` to emit the IETF draft `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers, plus `Retry-After` (seconds) when the limit is hit. `legacyHeaders: false` suppresses the older `X-RateLimit-*` headers.

**Known limitation**: `rateLimiter.ts:L6-L13` documents that the in-memory store is per-instance; on Cloud Run with N instances an attacker can hit each instance independently before any bucket fills. Mitigated today by low `--max-instances`.

### PHI / data-access family

#### `NOT_FOUND` as RLS denial

**Thrown at**: See [§3](#3-master-error-code-table). The critical insight: every `findFirst` / `findUnique` inside `withRLSContext(userId, ...)` returns `null` both when the resource truly doesn't exist **and** when it exists under a different `user_id` — because the PostgreSQL RLS policy filters the row out before the app sees it.

Example pattern (same in every controller):
```ts
// Source: backend/src/controllers/fileController.ts:L140-L150 (approximate)
const file = await withRLSContext(userId, async (tx) =>
  tx.userFile.findUnique({ where: { id } })
);
if (!file) {
  throw new NotFoundError('File not found');
}
```

There is **no way for the client to distinguish** a real 404 from an RLS-masked denial — and that's intentional. The prompt's `RLS_DENIED` code does not exist in the codebase; RLS denials are universally returned as `NOT_FOUND`.

**How developers can tell the difference** (server-side only): query the row with `withRLSContext(null, ..., { isAdmin: true })` and check whether a row exists but with a different `userId`. Never surface that information to the client.

### Storage family

#### `STORAGE_READ_FAILED` (HTTP 502)

**Thrown at**: `fileController.ts:L281-L288` — the GCS stream emits an `error` event mid-download.

```ts
// Source: backend/src/controllers/fileController.ts:L278-L289
if (!res.headersSent) {
  res.status(502).json({
    success: false,
    error: { code: 'STORAGE_READ_FAILED', message: 'Unable to read file from storage' },
  });
} else {
  res.end();
}
```

**Recovery**: Retry. If the storage key exists (`fileExists` in `storageService.ts:L231-L246`), it's transient; if not, the DB row is orphaned — admin DB cleanup needed.

#### GCS upload / signed-URL / delete failures

`storageService.ts:86,152,187` throw generic `new Error('Failed to upload file to storage')` / `'Failed to generate file access URL'` / `'Failed to delete file from storage'`. These are **not** `AppError` subclasses, so the centralized handler treats them as unknown → HTTP 500 `INTERNAL_ERROR` with the generic production message. **Flagged**: these should be `ExternalServiceError` to surface as 502.

### AI family

#### `SERVICE_UNAVAILABLE` (HTTP 503) — BAA gate

Emitted by three AI routes when `ANTHROPIC_BAA_ACTIVE !== 'true'`:

| Route | Throw site | Message |
|---|---|---|
| `POST /api/v1/ai/chat` | `aiChatController.ts:134-145` | `"AI Health Guide is disabled: ANTHROPIC_BAA_ACTIVE must be \"true\". See SECURITY_STATUS.md C-7."` |
| `POST /api/v1/biomarkers/:id/guidance` | `biomarkerRoutes.ts:134-148` | `"AI guidance is disabled: ANTHROPIC_BAA_ACTIVE must be \"true\". See SECURITY_STATUS.md C-7."` |
| Expense cost analysis | `expenseController.ts:637` | BAA-gate message |

Also fired from the extraction path at `claudeExtraction.ts:L118-L123` — but as `InternalServerError` (HTTP 500), inconsistent with the 503 pattern above. See [§11](#11-prompt-drift-log).

**Recovery**:
1. Verify `ANTHROPIC_BAA_ACTIVE=true` is set on Cloud Run.
2. After flipping, run `gcloud run services update-traffic --to-revisions=<NEW>=100` (see memory postmortem `cloud-run-env-update-pinning.md`).
3. Audit log: `CHAT_BLOCKED_NO_BAA`, `GUIDANCE_BLOCKED_NO_BAA` via `auditService.logAccess` (`aiChatController.ts:135`, `biomarkerRoutes.ts:138`).

#### `INTERNAL_ERROR` from Claude extraction (HTTP 500)

8 throw sites in `claudeExtraction.ts` (`L55,119,219,247,258,289,295,300,305`); 9 in `sbcExtraction.ts`. The user-visible messages are:

| Site | Message | Trigger |
|---|---|---|
| `claudeExtraction.ts:55` | `'ANTHROPIC_API_KEY environment variable is not set'` | Missing API key |
| `claudeExtraction.ts:119` | BAA gate message (see above) | `baaActive=false` |
| `claudeExtraction.ts:219` | `'Claude returned no text content'` | Empty response |
| `claudeExtraction.ts:247` | `'Claude response did not contain valid JSON'` | Malformed response |
| `claudeExtraction.ts:258` | `'Failed to parse biomarker data from Claude response'` | JSON.parse fail |
| `claudeExtraction.ts:289` | `'AI extraction service timed out. Please try again.'` | APIConnectionTimeoutError / "timed out" |
| `claudeExtraction.ts:295` | `'AI extraction service not properly configured'` | 401 from Anthropic |
| `claudeExtraction.ts:300` | `'AI extraction service temporarily unavailable. Please try again.'` | 429 / `rate_limit` from Anthropic |
| `claudeExtraction.ts:305` | `'AI extraction service busy. Please try again in a moment.'` | 503 / `overloaded` from Anthropic |

**Recovery**: Retry with backoff. Anthropic 429/503 should resolve within minutes. If 401 from Anthropic, rotate `ANTHROPIC_API_KEY`.

#### `AI_RATE_LIMIT_EXCEEDED` (HTTP 429)

See [§5 rate-limit family](#rate-limit-family-http-429). Keyed **per user id** (`rateLimiter.ts:L114-L117`) to prevent one abusive user from burning the global AI budget.

### System / infrastructure family

| Code | HTTP | Site | Meaning |
|---|---|---|---|
| `INVALID_JSON` | 400 | `errorHandler.ts:164` | Raw `SyntaxError` from `express.json()` body parser |
| `INTERNAL_ERROR` | 500 | Default | Anything that's not `AppError` / Prisma / JWT / JSON-syntax |
| `DATABASE_ERROR` | 500 | `errorHandler.ts:116` + `biomarkerController.ts:571` | Prisma unmapped error |
| `SYNC_FAILED` | 500 | `fhirController.ts:172` | Lab-connection sync exception |
| `DISCONNECT_FAILED` | 500 | `fhirController.ts:199` | Lab-connection disconnect exception |
| `CONNECT_FAILED` | 500 | `fhirController.ts:65` | Quest OAuth redirect build failure |
| `CONTEXT_ASSEMBLY_FAILED` | 500 | `aiChatController.ts:157` | RLS-scoped health-context decryption failed |

---

## 6. Frontend interpretation layer

The frontend uses a **fetch**-based client (not axios despite the prompt wording). Interpretation lives in `src/services/api/client.ts`. Key behaviors:

### 6.1 CSRF auto-attach

```ts
// Source: src/services/api/client.ts:L187-L195
const method = (options.method || 'GET').toUpperCase();
if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    (headers as Record<string, string>)['x-csrf-token'] = csrfToken;
  } else {
    apiLogger.warn('Mutation request without CSRF token', { method, endpoint });
  }
}
```

### 6.2 Auto-refresh on 401

```ts
// Source: src/services/api/client.ts:L241-L250
if (!response.ok) {
  if (response.status === 401 && !isRetry && !isAuthMgmtEndpoint) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      return apiFetch<T>(endpoint, options, timeoutMs, true);
    }
    if (onAuthFailureCallback) {
      onAuthFailureCallback();
    }
  }
```

`attemptTokenRefresh` (`client.ts:L136-L170`) guards against concurrent refreshes with a module-level `isRefreshing` / `refreshPromise` pair — the second caller awaits the first's result instead of starting a second refresh.

**Loop guard**: `isAuthMgmtEndpoint` (`client.ts:L204`) is true for `/auth/refresh` and `/auth/logout`. A 401 from those endpoints **does not retry**, preventing the 10,000-call loop the comment block describes.

### 6.3 Error normalization

```ts
// Source: src/services/api/client.ts:L252-L263
const serverMessage = typeof data.error === 'string'
  ? data.error
  : data.error?.message;
const errorCode = typeof data.error === 'object'
  ? data.error?.code
  : data.code;

const apiError: ApiError = {
  message: getUserFriendlyMessage(response.status, serverMessage),
  code: errorCode || `HTTP_${response.status}`,
  status: response.status,
};
```

Handles both envelope shapes (structured `{code, message}` and legacy string `error`).

### 6.4 Plan-limit carry-over

```ts
// Source: src/services/api/client.ts:L265-L280
if (errorCode === 'PLAN_LIMIT_EXCEEDED' && typeof data.error === 'object' && data.error) {
  const err = data.error as { limit?: number; current?: number; feature?: string; upgradeRequired?: boolean; };
  apiError.planLimit = {
    limit: typeof err.limit === 'number' ? err.limit : 0,
    current: typeof err.current === 'number' ? err.current : 0,
    feature: typeof err.feature === 'string' ? err.feature : '',
    upgradeRequired: err.upgradeRequired === true,
  };
}
```

UI code then uses `isPlanLimitError(err)` (`client.ts:L55-L62`) to narrow and render the upgrade CTA.

### 6.5 Timeout & network errors

`createTimeoutController` (`client.ts:L114-L118`) aborts fetch after `DEFAULT_TIMEOUT_MS = 30000` (`client.ts:L12`). `AbortError` becomes `{code: 'TIMEOUT', status: 408}` (`client.ts:L289-L295`). Any other caught error becomes `{code: 'NETWORK_ERROR', status: 0}` (`client.ts:L301-L306`).

### 6.6 Status → user-friendly message map

```ts
// Source: src/services/api/client.ts:L14-L23
const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Unable to connect to the server. Please check your internet connection and try again.',
  TIMEOUT_ERROR: 'The request took too long to complete. Please try again.',
  UNAUTHORIZED: 'Your session has expired. Please log in again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again later.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};
```

Mapping in `getUserFriendlyMessage` (`client.ts:L86-L112`): 401 → "session expired"; 403 → "no permission"; 404 → "not found"; 422 → server message fallback; 408/504 → timeout; 5xx → "server error". Status 400-499 pass through the server's `message` verbatim (`client.ts:L87-L89`).

---

## 7. 401 vs 403 vs other-auth decision tree

This API does **not** use 419 (see [§11](#11-prompt-drift-log)); session expiry is a 401. The decision tree below is accurate for the codebase as shipped.

```
                    ┌─── API response ────┐
                    │                     │
       status 401 ──┤   status 403 ──┐    ├── status 423 ── ACCOUNT_LOCKED
                    │                │    │                  └─> show lockedUntil, offer reset
                    │                │    │
                    ▼                │    └── status 429 ── <limiter>_RATE_LIMIT_EXCEEDED
       code:?                        │                       └─> wait Retry-After, retry
         │                           │
         ├─ TOKEN_EXPIRED or         │
         │  UNAUTHORIZED             │
         │  ("Token has expired"     │
         │   or generic)             │
         │    │                      │
         │    ▼                      │
         │  isAuthMgmtEndpoint?      │
         │    │                      │
         │   no ─► attemptTokenRefresh()
         │    │     │
         │    │    yes ─► replay original (isRetry=true) ─► DONE
         │    │     │
         │    │    no  ─► onAuthFailureCallback()
         │    │           └─► logout → /login
         │    │
         │   yes (refresh/logout itself 401)
         │    └─► terminal: onAuthFailureCallback → /login
         │
         ├─ INVALID_CREDENTIALS
         │    └─► show message + remainingAttempts; user fixes password
         │
         ├─ INVALID_TOKEN
         │    └─► no refresh path; hard logout
         │
         └─ AUTHENTICATION_FAILED (unused today)

                                     ▼
                              code:?
                                │
                                ├─ FORBIDDEN
                                │   (CSRF / RBAC / demo / ownership / consent)
                                │   └─► show toast; NO retry
                                │       │
                                │       └─► if message mentions CSRF:
                                │           hit /csrf-token then retry once
                                │
                                ├─ EMAIL_NOT_VERIFIED
                                │   └─► redirect to "resend verification" flow
                                │
                                └─ PLAN_LIMIT_EXCEEDED
                                    └─► show upgrade CTA with limit/current
```

---

## 8. Recovery playbooks

### Playbook A — User stuck with 401 loop

**Symptom**: Every request returns 401; frontend console shows repeated `/auth/refresh` calls.

1. Confirm the loop origin. Open DevTools Network tab. Look for `/auth/refresh` requests — each should correspond to one failed original request, not cascade. `client.ts:L204` exempts `/auth/refresh` and `/auth/logout` from the retry path; if you see `/auth/refresh` itself retrying, the guard is broken.
2. Inspect cookie state: `document.cookie`. Expected cookies: `access_token`, `refresh_token`, `csrf_token`. If `refresh_token` is missing, refresh cannot succeed → 401 is terminal and `onAuthFailureCallback` should have fired once.
3. If `refresh_token` is present but `/auth/refresh` returns 401: the refresh token is invalid server-side. Possible causes:
   - `JWT_REFRESH_SECRET` rotated since the token was issued (deploy-time secret change).
   - Session was revoked in DB (check `Session` model).
   - `authService.ts` session cleanup scheduler removed the row.
   In any case: hard logout, require re-login.
4. If the loop persists through logout + login: it's a client bug. Check whether `isRetry` is being reset between unrelated calls, or whether `attemptTokenRefresh`'s `isRefreshing` lock is stuck (`client.ts:L137-L140`).
5. Forced resolution: admin can revoke all sessions for a user by deleting rows from `Session` table.

### Playbook B — AI endpoint returning 503 `SERVICE_UNAVAILABLE`

**Symptom**: `POST /api/v1/ai/chat` or `GET /biomarkers/:id/guidance` returns 503 with message `"...ANTHROPIC_BAA_ACTIVE must be \"true\"..."`.

1. Check Cloud Run service env: `gcloud run services describe <service> --format='value(spec.template.spec.containers[0].env)'`. Look for `ANTHROPIC_BAA_ACTIVE`.
2. If missing or `false`: this is the BAA gate. Flipping it requires a signed BAA in place (see `SECURITY_STATUS.md` C-7).
3. Update env: `gcloud run services update <service> --update-env-vars=ANTHROPIC_BAA_ACTIVE=true`. **Critical**: if the service has revision pinning, this creates a new revision at 0% traffic. Follow up with `gcloud run services update-traffic <service> --to-latest` (or specific revision). See user memory entry `cloud-run-env-update-pinning.md`.
4. Verify: `latestReadyRevisionName === latestCreatedRevisionName`. If not, pin is still active.
5. Retry the API call. Audit `CHAT_BLOCKED_NO_BAA` / `GUIDANCE_BLOCKED_NO_BAA` events should stop appearing.

### Playbook C — Upload too large (actual behavior)

**Symptom**: User uploads a large PDF; backend returns 422 `VALIDATION_ERROR` with message `"File size must be less than {N}MB"`.

1. **No 413 is ever emitted.** The size check is Zod/manual at `controllers/upload/shared.ts:L107-L114`:
```ts
// Source: backend/src/controllers/upload/shared.ts:L107-L114
if (file.size > maxSizeBytes) {
  throw new ValidationError(`File size must be less than ${maxSizeMB}MB`);
}
```
2. Frontend shows the `VALIDATION_ERROR` message in the uploader toast.
3. Recovery: compress PDF (reduce image resolution, re-export); or split into multiple uploads.
4. If repeated large uploads are legitimate, increase `maxSizeMB` in `controllers/upload/shared.ts`. There's no global express body-parser ceiling that would return 413 from multer — the app uses per-route size caps.

### Playbook D — Admin export/cost-analysis timing out

**Symptom**: `POST /api/v1/expenses/analyze-costs` returns 504 `{error: 'Cost analysis timed out. Please try again.'}`.

1. Throw site: `expenseController.ts:747`. Timeout is enforced by an `AbortController` around the Claude call (30s, same pattern as `biomarkerRoutes.ts:221`).
2. Check Anthropic status (console + `claudeExtraction.ts` wrapping may log `APIConnectionTimeoutError`).
3. Retry — Claude's first call may have been a cold-start. If it happens repeatedly, check token-count of the prompt: expense-analysis prompts scale with the number of `ExpenseActual` rows. Large accounts may need batching.
4. If still failing after retries: confirm BAA gate is still `true` (otherwise 503, not 504).
5. Cloud Run timeout: the service has a default 60s request timeout; if analysis routinely takes >60s, raise `--timeout` on the service (see `RUNBOOK.md`).

---

## 9. Logging and audit coverage for errors

The error handler emits structured server-side logs (`errorHandler.ts:L167-L186`):

- **5xx**: always `logger.error`, full stack in dev, method + path + userId always.
- **4xx**: `logger.warn` only in development.
- Stack traces **never** appear in production responses (`errorHandler.ts:L196`).

### Audit-logged error events

Audit writes happen in the controllers, **not** in the error handler. The ones that fire on error paths:

| Action | Source | Trigger |
|---|---|---|
| `LOGIN_FAILED` | `authController.ts:229,270,291` | 3 reasons: `EMAIL_NOT_VERIFIED`, `INVALID_CREDENTIALS`, `UNKNOWN` |
| `ACCOUNT_LOCKOUT` | `authController.ts:248` | 423 emitted |
| `EMAIL_VERIFICATION` (success=false) | `authController.ts:610-613` | 400 `VERIFICATION_FAILED` |
| `PASSWORD_RESET_REQUEST` | `authController.ts:706` | always (no 4xx surface, anti-enumeration) |
| `PASSWORD_RESET_COMPLETE` (success=false) | `authController.ts:751` | 400 `RESET_FAILED` |
| `DELETE_DATA_FAILED` | `settingsController.ts:730` | `deleteAllData` exception |
| `DELETE_ACCOUNT_FAILED` | `settingsController.ts:877` | `deleteAccount` exception |
| `CHAT_BLOCKED_NO_BAA` | `aiChatController.ts:135` (via `logAccess`) | 503 from BAA gate |
| `GUIDANCE_BLOCKED_NO_BAA` | `biomarkerRoutes.ts:138` (via `logAccess`) | 503 from BAA gate |
| `GUIDANCE_NOT_FOUND` | `biomarkerRoutes.ts:171` (via `logAccess`) | 404 from biomarker lookup under RLS |

**Not audited** (intentionally): generic 4xx responses (validation, not-found without PHI context), middleware 401s (no user yet).

The prompt's specific grep `auditLog\.log.*(FAILED|ERROR|DENIED)` returns no matches because the codebase uses `auditService.logAuth(...)` and `auditService.logAccess(...)` wrappers rather than a direct `auditLog.log(...)` call.

---

## 10. Known error drift

Codes emitted by the backend but absent from the prompt's canonical table (all now in [§3](#3-master-error-code-table)):

- `AUTH_RATE_LIMIT_EXCEEDED`, `LOGIN_RATE_LIMIT_EXCEEDED`, `UPLOAD_RATE_LIMIT_EXCEEDED`, `SENSITIVE_RATE_LIMIT_EXCEEDED`, `AI_RATE_LIMIT_EXCEEDED`, `BULK_RATE_LIMIT_EXCEEDED` — granular rate-limit codes, not the single `RATE_LIMIT_EXCEEDED` the prompt assumed.
- `EMAIL_NOT_VERIFIED`, `ACCOUNT_LOCKED`, `INVALID_CREDENTIALS`, `VERIFICATION_FAILED`, `RESEND_FAILED`, `RESET_FAILED` — auth controller's inline error codes.
- `PLAN_LIMIT_EXCEEDED` — planGating middleware, not a standard AppError.
- `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_JSON` — JWT/JSON reshaping in errorHandler.
- `CONTEXT_ASSEMBLY_FAILED`, `SYNC_FAILED`, `DISCONNECT_FAILED`, `CONNECT_FAILED`, `STORAGE_READ_FAILED` — integration-specific 500/502s.

Codes in the prompt but **not present in the codebase**:

- `CSRF_MISMATCH` — CSRF throws use the generic `FORBIDDEN` code.
- `SESSION_EXPIRED` (HTTP 419) — session expiry is a 401 with `UNAUTHORIZED` or `TOKEN_EXPIRED`.
- `UPLOAD_TOO_LARGE` (HTTP 413) — size errors use `VALIDATION_ERROR` (422).
- `RLS_DENIED` — RLS denials mask as `NOT_FOUND` and are indistinguishable to the client.
- `AI_UNAVAILABLE` — closest is `SERVICE_UNAVAILABLE` from the BAA gate.
- `STORAGE_ERROR` — closest is `STORAGE_READ_FAILED`; writes/deletes throw generic `Error`.
- `DEMO_BLOCKED` — demo protection uses `FORBIDDEN`.
- `FORBIDDEN_ROLE` — RBAC uses `FORBIDDEN`.

---

## 11. Prompt drift log

- **Axios vs fetch**: prompt describes `src/services/api/client.ts` as an "axios interceptor." The file uses native `fetch` with a custom timeout/refresh layer (`client.ts:L10,L114-L118,L209-L214`). Interceptor behaviors (auto-refresh on 401, CSRF on mutations) still hold — implemented as in-function branches rather than axios middleware.
- **Canonical code list**: prompt-listed codes `CSRF_MISMATCH`, `SESSION_EXPIRED`, `UPLOAD_TOO_LARGE`, `RLS_DENIED`, `AI_UNAVAILABLE`, `STORAGE_ERROR`, `DEMO_BLOCKED`, `FORBIDDEN_ROLE` are not in the code. See [§10](#10-known-error-drift) for the actual codes used instead. Prompt author should update `37-error-recovery-doc.md` master table to reflect reality.
- **HTTP 419 absent**: prompt assumes a distinct 419 status for expired sessions; no throw site in the codebase uses 419. All session-expiry paths return 401.
- **`AppError` direct usage**: prompt's enumeration pattern was `Grep "new AppError\(['\"]([A-Z_]+)['\"]"`. Zero matches — the codebase uses the subclass constructors (`NotFoundError`, `ForbiddenError`, etc.) rather than the base class, so codes are implicit via the subclass.
- **`auditLog.log(...)` pattern**: prompt expected `auditLog.log(...)`. The code uses `auditService.logAuth(...)` / `auditService.logAccess(...)` / `logDelete(...)` / `logCreate(...)` / `logUpdate(...)` wrappers.
- **`planGating` and `usageTracker`**: these middleware/service files are listed in the prompt as required reading but were absent in the initial CLAUDE.md project map. `planGating.ts` introduces the `PLAN_LIMIT_EXCEEDED` code, which carries extra response fields.
- **Claude extraction uses 500, not 503**: `claudeExtraction.ts:L118-L123` throws `InternalServerError` for BAA failures (HTTP 500), while `aiChatController.ts:L138-L145` and `biomarkerRoutes.ts:L141-L148` use inline 503. Inconsistent.
- **No `SESSION_EXPIRED` or `RLS_DENIED` codes**: recommend updating the frontend error-message map (`client.ts:L14-L23`) if those codes are ever introduced.

---

## 12. Acceptance-question self-check

Answered using only this doc plus siblings listed in [§ Related Documents](#related-documents).

**Q1. How many distinct error `code` values exist in the API?**
**26 distinct emitted codes** (counted in [§3](#3-master-error-code-table)): `BAD_REQUEST`, `INVALID_JSON`, `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `PLAN_LIMIT_EXCEEDED`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `ACCOUNT_LOCKED`, `RATE_LIMIT_EXCEEDED`, `AUTH_RATE_LIMIT_EXCEEDED`, `LOGIN_RATE_LIMIT_EXCEEDED`, `UPLOAD_RATE_LIMIT_EXCEEDED`, `SENSITIVE_RATE_LIMIT_EXCEEDED`, `AI_RATE_LIMIT_EXCEEDED`, `BULK_RATE_LIMIT_EXCEEDED`, `INTERNAL_ERROR`, `DATABASE_ERROR`, `VERIFICATION_FAILED`, `RESEND_FAILED`, `RESET_FAILED`, `CONTEXT_ASSEMBLY_FAILED`, `SYNC_FAILED`, `DISCONNECT_FAILED`, `CONNECT_FAILED`, `STORAGE_READ_FAILED`, `SERVICE_UNAVAILABLE` → **30 codes**. Plus 3 defined-but-unemitted: `AUTHENTICATION_FAILED`, `EXTERNAL_SERVICE_ERROR`, `UNAUTHORIZED` (from `UnauthorizedError` default — emitted, count overlap). Net distinct emitted: **30**. See [§3](#3-master-error-code-table).

**Q2. What's the difference between `UNAUTHORIZED` and `SESSION_EXPIRED`, and how should a client react to each?**
`SESSION_EXPIRED` does not exist in this API. Session expiry surfaces as `UNAUTHORIZED` (401) with message `'Token has expired. Please refresh your session.'` (`auth.ts:L102-L105`). Client reaction: `client.ts:L223,L242` auto-calls `/auth/refresh` and replays. `TOKEN_EXPIRED` code path exists only if the raw `TokenExpiredError` escapes the middleware. See [§5 UNAUTHORIZED](#unauthorized-http-401).

**Q3. What recovery action applies when a client receives `CSRF_MISMATCH`?**
`CSRF_MISMATCH` does not exist — CSRF failures emit `FORBIDDEN` (403) with message `'CSRF token missing'` or `'Invalid CSRF token'` (`csrf.ts:L161,L166,L175`). Recovery: `GET /api/v1/csrf-token`, re-read the `csrf_token` cookie, re-submit with `x-csrf-token` header. See [§5 CSRF family](#csrf-family).

**Q4. Does `NOT_FOUND` ever mask an RLS denial?**
Yes, every `findFirst`/`findUnique` inside `withRLSContext(userId, ...)` returns `null` both for non-existent rows and for rows owned by another user (PostgreSQL RLS filters them out before Prisma sees them). The controller then throws `NotFoundError`. The client cannot tell the difference, intentionally. Developers can tell by re-querying with `{ isAdmin: true }` server-side — never expose that to the client. See [§5 PHI/data-access family](#phi--data-access-family).

**Q5. What's the `Retry-After` semantics on a `429`, and which limiter set it?**
All 7 limiters in `rateLimiter.ts` set `standardHeaders: true`, which causes `express-rate-limit` to emit `Retry-After` (seconds) plus `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. `legacyHeaders: false` suppresses `X-RateLimit-*`. See [§5 rate-limit family](#rate-limit-family-http-429).

**Q6. When an AI call fails, what error is returned and where is the retry logic?**
Three layers: (a) BAA gate → 503 `SERVICE_UNAVAILABLE` at `aiChatController.ts:138`, `biomarkerRoutes.ts:141`, `expenseController.ts:637`, and (inconsistently) 500 `INTERNAL_ERROR` at `claudeExtraction.ts:119`. (b) Anthropic upstream errors → 500 `INTERNAL_ERROR` mapped in `claudeExtraction.ts:L287-L306` (timeout, 401, 429, 503 from Anthropic). (c) Biomarker guidance upstream non-ok → 502 with `{error: 'Failed to get AI guidance'}` at `biomarkerRoutes.ts:246`; timeout → 504 at `biomarkerRoutes.ts:287`. Retry logic: the Anthropic SDK client is configured with `maxRetries: 2` at `claudeExtraction.ts:57`. No client-side auto-retry. See [§5 AI family](#ai-family).

**Q7. Which errors are audited, and where?**
See [§9 table](#audit-logged-error-events). `LOGIN_FAILED`, `ACCOUNT_LOCKOUT`, `EMAIL_VERIFICATION`, `PASSWORD_RESET_REQUEST`, `PASSWORD_RESET_COMPLETE` in `authController.ts`. `DELETE_DATA_FAILED`, `DELETE_ACCOUNT_FAILED` in `settingsController.ts:730,877`. `CHAT_BLOCKED_NO_BAA`, `GUIDANCE_BLOCKED_NO_BAA`, `GUIDANCE_NOT_FOUND` in AI paths.

**Q8. Does the frontend auto-refresh the access token on 401? Where?**
Yes. `client.ts:L223-L231` (parse-fail path) and `client.ts:L242-L250` (structured-error path) both check `response.status === 401 && !isRetry && !isAuthMgmtEndpoint` and call `attemptTokenRefresh()` (`client.ts:L136-L170`). On success they replay the original request with `isRetry = true`.

**Q9. What's the recovery for `PHI_ENCRYPTION_KEY` rotation mid-session?**
The error surfaces as `DATABASE_ERROR` (500) via Prisma's catch-all path, or as a generic `INTERNAL_ERROR` from `userEncryption.ts:106` throwing `Error('No active encryption key found for user')` (not an `AppError`, so the production handler masks the message to `"An unexpected error occurred..."`). Recovery: server operator runs key-rotation playbook (see `RUNBOOK.md` — doc pending). Users must re-derive their per-user keys via login flow; decryption of old PHI continues to work as long as the historical key version is still present in the user's `EncryptionKey` rows (multi-version support).

**Q10. What happens if an admin endpoint is hit with `UNAUTHENTICATED` cookies? Status + code?**
Admin routes (`adminRoutes.ts`) sit behind `authenticate` + `requireRole('ADMIN')`. No cookie → `authenticate` throws `UnauthorizedError('Authentication required')` at `auth.ts:79` → **401 `UNAUTHORIZED`**, not 403. A non-ADMIN user would reach the next middleware and receive **403 `FORBIDDEN`** with message `'Access denied. Required roles: ADMIN'` from `rbac.ts:70`.

**Q11. Which error surfaces when demo accounts try to mutate data?**
**403 `FORBIDDEN`** from `demoProtection.ts:54,73,99,123,131,151,170`. Specific messages:
- role change: `'Demo account cannot change roles. Please create a real account for full access.'`
- admin: `'Demo account does not have admin access. Please create a real account.'`
- other user: `'Demo account cannot modify other users. Please create a real account.'`
- profile: `'Demo account cannot modify profile. Please create a real account.'`
- AI: `'AI features are not available in demo mode. Please create a real account.'`

**Q12. How does the client distinguish a real 404 from an RLS-masked 404?**
It cannot — by design. Both return `{ success: false, error: { code: 'NOT_FOUND', message: 'X not found' } }` with the same status 404. Only the server can tell, by querying the same row with `withRLSContext(null, fn, { isAdmin: true })` and inspecting ownership. See [§5 PHI/data-access family](#phi--data-access-family) and Q4.

---

## Related Documents

- [`API_REFERENCE.md`](./API_REFERENCE.md) — per-endpoint contracts; expected error codes per route.
- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — middleware chain per route, including which limiter / CSRF / RBAC guard is active.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — auth, CSRF, and RLS enforcement flows.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — symptom-first narrative catalog (doc pending — see prompt `./27-troubleshooting-doc.md`).
- [`RUNBOOK.md`](./RUNBOOK.md) — operational incident playbooks (Cloud Run env flips, DB restore, key rotation). Doc pending — see prompt `./26-runbook-doc.md`.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — RLS policies that drive the `NOT_FOUND` masking behavior.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — PHI field map; error paths must avoid leaking decrypted values.
- [`ENV_VARS.md`](./ENV_VARS.md) — `ANTHROPIC_BAA_ACTIVE`, `JWT_*`, `QUEST_FHIR_*` consumers referenced in recovery playbooks.
