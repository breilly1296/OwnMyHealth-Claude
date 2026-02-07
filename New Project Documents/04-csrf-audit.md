# CSRF Protection Security Audit

**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (Automated Security Audit)
**Scope:** Cross-Site Request Forgery protection across OwnMyHealth backend and frontend
**Method:** Double-submit cookie pattern

---

## Architecture Overview

OwnMyHealth uses the **double-submit cookie pattern** for CSRF protection:

1. The backend sets a `csrf_token` cookie (readable by JavaScript, `httpOnly: false`) on every request via the `csrfProtection` middleware.
2. The frontend reads the `csrf_token` cookie and sends it back as the `X-CSRF-Token` header on all mutating requests (POST, PUT, PATCH, DELETE).
3. The backend validates that the cookie value matches the header value using a timing-safe comparison.
4. Certain routes are exempted from CSRF validation because they rely on Bearer token authentication (which is stored in memory, not cookies, and thus not subject to CSRF).

---

## Checklist Results

### 1. Backend CSRF Middleware

- [x] **PASS** - CSRF middleware applied to all routes (or all mutating routes)
  - `csrfProtection` is registered globally in `backend/src/app.ts:162` via `app.use(csrfProtection)`.
  - It runs before all route handlers (middleware stack position 4, before rate limiting and body parsing).
  - Additionally, the expense routes apply `csrfProtection` per-route as a belt-and-suspenders approach (`backend/src/routes/expenseRoutes.ts:32-45`).

- [x] **PASS** - Validates `X-CSRF-Token` header against cookie
  - `backend/src/middleware/csrf.ts:171-172` extracts the cookie token from `req.cookies[CSRF_COOKIE_NAME]` and the header token from `req.headers[CSRF_HEADER_NAME]`.
  - Validation at lines 175-191 checks both tokens exist, have equal length, and match via `crypto.timingSafeEqual`.

- [x] **PASS** - Returns 403 on CSRF validation failure
  - `backend/src/middleware/csrf.ts:176` throws `ForbiddenError('CSRF token missing')` when tokens are absent.
  - `backend/src/middleware/csrf.ts:181` throws `ForbiddenError('Invalid CSRF token')` on length mismatch.
  - `backend/src/middleware/csrf.ts:190` throws `ForbiddenError('Invalid CSRF token')` on value mismatch.
  - `ForbiddenError` (defined in `backend/src/middleware/errorHandler.ts:47-50`) maps to HTTP 403.

- [ ] **FAIL** - Token regenerated on login (prevent fixation)
  - **Finding:** The login controller (`backend/src/controllers/authController.ts:212-323`) does **not** call `setCsrfCookie()` to regenerate the CSRF token upon successful login. The CSRF token is only set by the `csrfProtection` middleware when no cookie exists (`csrf.ts:207-209`), or on GET requests (`csrf.ts:72`).
  - **Risk:** An attacker who can set a CSRF cookie before login (e.g., via a subdomain or cookie injection) could pre-set a known CSRF token. After the user logs in, the same token remains valid, enabling CSRF attacks with the known token.
  - **Severity:** Medium. The double-submit cookie pattern without server-side session binding is inherently more vulnerable to fixation than server-side token patterns. However, the `SameSite` cookie attribute (set to `lax` in production) and CORS restrictions mitigate this significantly.
  - **Recommendation:** Call `setCsrfCookie(res)` in the login controller after successful authentication to rotate the CSRF token.

### 2. CSRF Token Generation

- [x] **PASS** - Cryptographically random token (crypto.randomBytes or similar)
  - `backend/src/middleware/csrf.ts:25` uses `crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex')`.
  - Node.js `crypto.randomBytes` is a CSPRNG suitable for security tokens.

- [x] **PASS** - Sufficient length (>=32 bytes)
  - `CSRF_TOKEN_LENGTH = 32` at `csrf.ts:19`, yielding `crypto.randomBytes(32)` which produces 32 bytes (256 bits) of entropy, rendered as 64 hex characters.
  - This exceeds OWASP's recommended minimum of 128 bits.

- [~] **PARTIAL** - New token generated per session
  - The token is generated when no `csrf_token` cookie exists (`csrf.ts:207-209`) or on any GET request (`csrf.ts:72`). This means a new token is issued on the first request and refreshed on subsequent GET requests.
  - However, there is no explicit per-session rotation. The token persists for 24 hours (`maxAge: 24 * 60 * 60 * 1000` at `csrf.ts:47`) regardless of session changes. A new session (login) does not force a new CSRF token (see finding 1.4 above).
  - **Recommendation:** Tie CSRF token rotation to authentication events (login, password change, logout).

### 3. Frontend Token Handling

- [x] **PASS** - API client reads `csrf_token` from cookies
  - `src/services/api/client.ts:97-107` contains `getCsrfToken()` that reads from `document.cookie` using regex `/csrf[_-]?token=([^;]+)/i`.
  - `src/services/uploadUtils.ts:37-46` contains a separate `getCsrfToken()` that parses `document.cookie` to find `csrf_token`.

- [x] **PASS** - `X-CSRF-Token` header included on all POST/PUT/DELETE
  - `src/services/api/client.ts:161-168`: The `apiFetch` function checks if the method is POST, PUT, PATCH, or DELETE, and adds the `x-csrf-token` header.
  - `src/services/uploadUtils.ts:128-136`: The `uploadFile` function also reads the CSRF token and sets the `X-CSRF-Token` header on file upload requests.

- [x] **PASS** - Token retrieved fresh for each request (not cached)
  - `getCsrfToken()` in `client.ts:97-107` reads `document.cookie` on every invocation. It is called inside `apiFetch()` on every mutating request at line 162. There is no caching of the token.
  - Similarly, `uploadUtils.ts:133` calls `getCsrfToken()` fresh for each upload.

### 4. Exempt Routes

- [~] **PARTIAL** - Only safe routes exempted
  - **Public auth endpoints (PASS):** `csrf.ts:98-108` exempts login, register, demo, refresh, forgot-password, reset-password, verify-email, resend-verification. These are all pre-authentication endpoints where CSRF protection is unnecessary (no session exists to protect).
  - **File upload endpoints (PASS):** `csrf.ts:112-117` exempts `/upload/lab-report`, `/upload/insurance-sbc`, `/upload/lab-results-ocr`, `/insurance/upload-sbc`. These require Bearer token authentication (stored in memory, not cookies), so CSRF is redundant.
  - **Settings routes (PASS with caveat):** `csrf.ts:121-125` exempts `/settings/delete-data`, `/settings/delete-account`, `/settings/export-data`. These require Bearer token auth. However, `export-data` is a GET endpoint so it would already be exempt; listing it is harmless but unnecessary.
  - **Bearer-protected routes (PASS):** `csrf.ts:131-133` exempts `/guidance` (the AI guidance POST endpoint). This requires Bearer auth.
  - **Delete routes (PASS):** `csrf.ts:137-139` exempts DELETE on `/insurance/plans/`. This requires Bearer auth.
  - **Stale exempt entry (INFO):** `csrf.ts:107` lists `/marketplace/plans/search` as an exempt public auth route. This endpoint does not exist in the current route configuration -- it references a removed feature (CMS Marketplace Integration). While harmless, it should be cleaned up.

- [~] **PARTIAL** - No sensitive operations exempted
  - **Finding:** The settings routes `/settings/delete-data` and `/settings/delete-account` are CSRF-exempt (`csrf.ts:121-125`). While these routes do require Bearer token authentication (which is not automatically sent by browsers), the comment at `csrf.ts:119-120` and `csrf.ts:127-130` explains the rationale that Bearer tokens stored in memory provide equivalent protection.
  - **Assessment:** This is architecturally sound. The application uses JWT Bearer tokens stored in JavaScript memory (not cookies), which browsers cannot automatically include in cross-origin requests. This makes CSRF redundant for these endpoints. However, defense-in-depth argues for keeping CSRF on destructive operations like account deletion.
  - **Risk:** Low. The Bearer token must be explicitly set by JavaScript, preventing automatic inclusion in cross-origin forged requests.

- [x] **PASS** - CSRF token endpoint available: `GET /api/v1/csrf-token`
  - `backend/src/app.ts:186` registers `csrfTokenHandler` at `GET /api/v1/csrf-token`.
  - `csrf.ts:225-234`: The handler generates a new CSRF token, sets it as a cookie, and returns it in the JSON response body.

### 5. Component-Level Check

- [x] **PASS** - `BiomarkerAIGuidance.tsx` uses CSRF
  - `src/components/trends/BiomarkerAIGuidance.tsx:199` calls `biomarkersApi.getGuidance()`.
  - `src/services/api/biomarkers.ts:119` calls `apiFetch('/biomarkers/${id}/guidance', { method: 'POST', ... })`.
  - `apiFetch` in `client.ts:161-164` automatically includes the CSRF token on POST requests.
  - **Note:** The backend exempts this endpoint (`csrf.ts:132`: `/guidance` in `bearerProtectedRoutes`), so the CSRF header is sent by the client but not validated by the server. This is acceptable since the route requires Bearer auth.

- [x] **PASS** - `InsuranceHub.tsx` delete uses CSRF
  - `src/components/insurance/InsuranceHub.tsx:120` calls `onDeletePlan(deleteConfirmPlan.id)`.
  - The parent passes `insuranceApi.deletePlan` which is defined at `src/services/api/insurance.ts:211-213` using `apiFetch('/insurance/plans/${id}', { method: 'DELETE' })`.
  - `apiFetch` includes the CSRF token on DELETE requests.
  - **Note:** The backend exempts DELETE on `/insurance/plans/` (`csrf.ts:137-139`), so the token is sent but not validated. The route requires Bearer auth which provides equivalent protection.

- [x] **PASS** - Upload components include CSRF header
  - `LabUploadModal.tsx:109` uses `uploadFile()` from `uploadUtils.ts`.
  - `uploadUtils.ts:133-136` reads the CSRF token and sets `X-CSRF-Token` header.
  - `PDFUploadModal.tsx` and `ClinicalFileUpload.tsx` use client-side-only processing (OCR via Tesseract.js / pdf.js) and do not make direct API calls for uploads -- they pass extracted data to parent components which then use `apiFetch` for persistence.
  - The `insuranceApi.uploadSBC()` and `insuranceApi.reanalyzePlan()` in `insurance.ts:221-240` both use `uploadFile()` which includes CSRF.

---

## Additional Findings

### 6. Debug Logging in Frontend Client

- [~] **PARTIAL** - Debug logging present in frontend CSRF handling
  - `src/services/api/client.ts:103`: `console.warn('[CSRF] No csrf token found in cookies:', cookies.substring(0, 200))` -- This logs the first 200 characters of `document.cookie` to the browser console when no CSRF token is found. While limited to 200 chars, this could reveal other cookie names to anyone viewing the console.
  - `src/services/api/client.ts:166`: `console.warn('[CSRF] Making ${method} request to ${endpoint} without CSRF token')` -- This warns when a mutating request is made without a CSRF token. This is useful for debugging but should be removed in production builds.
  - **Recommendation:** Gate these warnings behind a development-mode check or remove them for production.

### 7. Debug Logging in Settings Routes

- [ ] **FAIL** - Debug logging in settings routes leaks security-relevant info
  - `backend/src/routes/settingsRoutes.ts:26-27`: Logs every settings route request including whether `x-csrf-token` and `authorization` headers are present/missing.
  - `backend/src/routes/settingsRoutes.ts:44-45`: Logs the user ID when the delete-data handler is reached.
  - **Risk:** These `console.log` statements run in all environments (no environment check). They could leak HIPAA-relevant information (user IDs) to server logs without proper sanitization.
  - **Recommendation:** Remove these debug statements or replace with the structured `logger` utility that has proper sanitization.

### 8. CSRF Development Bypass

- [~] **PARTIAL** - Development bypass mechanism
  - `backend/src/middleware/csrf.ts:166-168`: CSRF validation can be skipped in development by setting `DISABLE_CSRF=true`.
  - `backend/src/app.ts:161-163`: The entire `csrfProtection` middleware is conditionally skipped if `isDevelopment && DISABLE_CSRF === 'true'`.
  - **Assessment:** This is standard practice for development. The check requires both `NODE_ENV=development` AND `DISABLE_CSRF=true`, so it cannot be accidentally activated in production.
  - **Risk:** None in production. The `config.isDevelopment` check is robust.

### 9. Stale Exempt Route Entry

- [~] **INFO** - Removed feature still in exempt list
  - `csrf.ts:107`: `/marketplace/plans/search` is listed in `publicAuthRoutes` but this endpoint no longer exists (CMS Marketplace was removed in Jan 2025 per CLAUDE.md).
  - **Risk:** None (non-existent route). This is dead code that should be cleaned up.

### 10. CSRF Error Messages

- [x] **PASS** - CSRF errors return generic messages (not leaking info)
  - The error messages are: `"CSRF token missing"` and `"Invalid CSRF token"`.
  - These are appropriately generic. They do not leak server-side details, token values, or implementation specifics.

### 11. Token Refresh Request Missing CSRF

- [x] **PASS** - Token refresh request correctly excluded
  - `src/services/api/client.ts:117-121`: The `attemptTokenRefresh()` function makes a POST to `/auth/refresh` without a CSRF token. This is correct because `/auth/refresh` is in the CSRF exempt list (`csrf.ts:103`).
  - The refresh endpoint uses the `refresh_token` cookie (httpOnly) and does not need CSRF protection since it does not change server-side state in a way that benefits an attacker.

### 12. Cookie Security Configuration

- [x] **PASS** - CSRF cookie security attributes
  - `httpOnly: false` (`csrf.ts:43`) -- **Correct.** The CSRF cookie must be readable by JavaScript for the double-submit pattern.
  - `secure: config.cookie.secure` -- Uses environment-based config; `true` in production (`config/index.ts:34`).
  - `sameSite: config.cookie.sameSite` -- Defaults to `lax` in production (`config/index.ts:39`), which prevents the cookie from being sent on cross-site POST requests (additional CSRF mitigation layer).
  - `path: '/'` -- Cookie available on all paths.
  - `maxAge: 24 hours` -- Reasonable lifetime.

### 13. Route Coverage Analysis

The following is a comprehensive list of all mutating (POST/PUT/PATCH/DELETE) routes and their CSRF protection status:

| Route | Method | CSRF Protected | Auth Required | Notes |
|-------|--------|---------------|---------------|-------|
| `/auth/register` | POST | Exempt | No | Public pre-auth |
| `/auth/login` | POST | Exempt | No | Public pre-auth |
| `/auth/demo` | POST | Exempt | No | Public pre-auth |
| `/auth/refresh` | POST | Exempt | No | Public pre-auth |
| `/auth/forgot-password` | POST | Exempt | No | Public pre-auth |
| `/auth/reset-password` | POST | Exempt | No | Public pre-auth |
| `/auth/resend-verification` | POST | Exempt | No | Public pre-auth |
| `/auth/logout` | POST | **Yes (global)** | Yes | |
| `/auth/logout-all` | POST | **Yes (global)** | Yes | |
| `/auth/change-password` | POST | **Yes (global)** | Yes | |
| `/biomarkers` | POST | **Yes (global)** | Yes | Create biomarker |
| `/biomarkers/batch` | POST | **Yes (global)** | Yes | Bulk create |
| `/biomarkers/:id` | PATCH | **Yes (global)** | Yes | Update |
| `/biomarkers/:id` | DELETE | **Yes (global)** | Yes | Delete |
| `/biomarkers/:id/guidance` | POST | Exempt (bearer) | Yes | AI guidance |
| `/insurance/plans` | POST | **Yes (global)** | Yes | Create plan |
| `/insurance/plans/:id` | PATCH | **Yes (global)** | Yes | Update plan |
| `/insurance/plans/:id` | DELETE | Exempt (bearer) | Yes | Delete plan |
| `/insurance/plans/:id/reanalyze` | PUT | **Yes (global)** | Yes | Re-analyze |
| `/insurance/plans/:id/spending` | PUT | **Yes (global)** | Yes | Update spending |
| `/insurance/compare` | POST | **Yes (global)** | Yes | Compare plans |
| `/insurance/upload-sbc` | POST | Exempt (upload) | Yes | File upload |
| `/upload/lab-report` | POST | Exempt (upload) | Yes | File upload |
| `/upload/insurance-sbc` | POST | Exempt (upload) | Yes | File upload |
| `/upload/lab-results-ocr` | POST | Exempt (upload) | Yes | File upload |
| `/health-needs` | POST | **Yes (global)** | Yes | Create |
| `/health-needs/:id` | PATCH | **Yes (global)** | Yes | Update |
| `/health-needs/:id` | DELETE | **Yes (global)** | Yes | Delete |
| `/health-goals` | POST | **Yes (global)** | Yes | Create |
| `/health-goals/:id` | PUT | **Yes (global)** | Yes | Update |
| `/health-goals/:id/progress` | PATCH | **Yes (global)** | Yes | Update progress |
| `/health-goals/:id` | DELETE | **Yes (global)** | Yes | Delete |
| `/files/:id` | DELETE | **Yes (global)** | Yes | Delete file |
| `/settings/delete-data` | DELETE | Exempt (bearer) | Yes | Delete all data |
| `/settings/delete-account` | DELETE | Exempt (bearer) | Yes | Delete account |
| `/expenses/projections` | POST | **Yes (global + route)** | Yes | Double-protected |
| `/expenses/projections/:id` | PUT | **Yes (global + route)** | Yes | Double-protected |
| `/expenses/projections/:id` | DELETE | **Yes (global + route)** | Yes | Double-protected |
| `/expenses/analyze` | POST | **Yes (global + route)** | Yes | Double-protected |
| `/provider/patients/request` | POST | **Yes (global)** | Yes+RBAC | Provider access request |
| `/provider/patients/:id` | DELETE | **Yes (global)** | Yes+RBAC | Remove relationship |
| `/patient/providers/:id/approve` | POST | **Yes (global)** | Yes+RBAC | Approve access |
| `/patient/providers/:id/deny` | POST | **Yes (global)** | Yes+RBAC | Deny access |
| `/patient/providers/:id` | PATCH | **Yes (global)** | Yes+RBAC | Update permissions |
| `/patient/providers/:id/revoke` | POST | **Yes (global)** | Yes+RBAC | Revoke access |
| `/patient/providers/:id` | DELETE | **Yes (global)** | Yes+RBAC | Remove relationship |
| `/admin/users` | POST | **Yes (global)** | Yes+RBAC | Create user |
| `/admin/users/:id` | PATCH | **Yes (global)** | Yes+RBAC | Update user |
| `/admin/users/:id` | DELETE | **Yes (global)** | Yes+RBAC | Deactivate user |
| `/admin/users/:id/permanent` | DELETE | **Yes (global)** | Yes+RBAC | Permanent delete |
| `/admin/provider-relationships/:id` | PATCH | **Yes (global)** | Yes+RBAC | Update relationship |

---

## Questions Answered

### 1. Are there any POST/PUT/DELETE requests missing CSRF tokens?

**No.** All frontend mutating requests go through either `apiFetch()` (which auto-injects the CSRF token on POST/PUT/PATCH/DELETE) or `uploadFile()` (which also reads and sends the CSRF token). There are no raw `fetch()` calls in any React components -- all API communication is centralized through the service layer.

### 2. Is debug logging removed from CSRF middleware?

**Yes, for the middleware itself.** The `backend/src/middleware/csrf.ts` file contains no `console.log`, `console.warn`, or `console.debug` statements.

**However**, there are two related concerns:
- The **frontend** client (`src/services/api/client.ts:103,166`) has `console.warn` statements related to CSRF that run in all environments.
- The **settings routes** (`backend/src/routes/settingsRoutes.ts:26-27,44-45`) have `console.log` debug statements that log CSRF header presence -- these are outside the CSRF middleware but related to CSRF debugging.

### 3. Are CSRF errors returning generic messages (not leaking info)?

**Yes.** Error messages are `"CSRF token missing"` and `"Invalid CSRF token"` -- both appropriately generic. The `ForbiddenError` class returns HTTP 403 with the error code `"FORBIDDEN"`. No implementation details, token values, or internal state are leaked.

---

## Summary

| Category | Status | Issues |
|----------|--------|--------|
| Backend Middleware | PASS (3/4) | Token not regenerated on login |
| Token Generation | PASS (2/3) | No per-session rotation on auth events |
| Frontend Handling | PASS (3/3) | Clean |
| Exempt Routes | PASS (2/3) | Stale marketplace entry |
| Component Coverage | PASS (3/3) | All components use centralized client |
| Error Handling | PASS | Generic error messages |
| Debug Logging | FAIL | Settings routes + frontend console.warn |

### Critical Issues: 0
### High Issues: 0
### Medium Issues: 1
1. CSRF token not regenerated on login (fixation risk) -- `backend/src/controllers/authController.ts`

### Low Issues: 3
1. Debug `console.log` in `backend/src/routes/settingsRoutes.ts:26-27,44-45` logs CSRF/auth header presence and user IDs
2. Frontend `console.warn` in `src/services/api/client.ts:103,166` logs cookie substring and endpoint names
3. Stale exempt route `/marketplace/plans/search` in `backend/src/middleware/csrf.ts:107`

### Informational: 1
1. CSRF token 24-hour lifetime is not tied to session lifecycle

---

## Recommendations (Priority Order)

1. **Rotate CSRF token on login** -- Add `setCsrfCookie(res)` call in the login controller after successful authentication to mitigate fixation attacks.
2. **Remove debug logging from settings routes** -- Replace `console.log` statements in `backend/src/routes/settingsRoutes.ts` with the structured logger or remove them entirely.
3. **Gate frontend CSRF warnings** -- Wrap `console.warn` calls in `src/services/api/client.ts` with a development-mode check (e.g., `import.meta.env.DEV`).
4. **Clean up stale exempt entry** -- Remove `/marketplace/plans/search` from the CSRF exempt list in `backend/src/middleware/csrf.ts:107`.
