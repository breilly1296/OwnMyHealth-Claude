# Authentication Security Audit Report

**Project:** OwnMyHealth
**Audit Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (Automated Security Audit)
**Scope:** Backend authentication service, middleware, controllers, routes, and frontend auth state management
**Severity Levels:** CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Executive Summary

The OwnMyHealth authentication system is well-designed with defense-in-depth controls including JWT access/refresh token architecture, bcrypt password hashing, account lockout, database-backed sessions, CSRF double-submit cookies, rate limiting, and comprehensive audit logging. The implementation demonstrates strong security awareness throughout.

**Key Findings:**
- 2 MEDIUM-severity issues identified
- 3 LOW-severity issues identified
- 2 informational notes
- Overall assessment: **STRONG** -- production-ready with minor improvements recommended

---

## Files Reviewed

| File | Path |
|------|------|
| Auth Service | `backend/src/services/authService.ts` |
| Auth Middleware | `backend/src/middleware/auth.ts` |
| Auth Controller | `backend/src/controllers/authController.ts` |
| Auth Routes | `backend/src/routes/authRoutes.ts` |
| Frontend Auth Context | `src/contexts/AuthContext.tsx` |
| Config | `backend/src/config/index.ts` |
| Rate Limiter | `backend/src/middleware/rateLimiter.ts` |
| CSRF Middleware | `backend/src/middleware/csrf.ts` |
| Demo Protection | `backend/src/middleware/demoProtection.ts` |
| Validation Middleware | `backend/src/middleware/validation.ts` |
| API Client | `src/services/api/client.ts` |
| Auth API (Frontend) | `src/services/api/auth.ts` |
| Email Service | `backend/src/services/emailService.ts` |
| Verify Email Page | `src/components/auth/VerifyEmailPage.tsx` |
| Reset Password Page | `src/components/auth/ResetPasswordPage.tsx` |
| App Root | `src/App.tsx` |
| Prisma Schema | `backend/prisma/schema.prisma` (Session model) |

---

## Checklist Results

### 1. JWT Implementation

- [x] **PASS** -- Access token expiration is short (<=15 minutes)
  - `config.jwt.accessExpiresIn` defaults to `900` seconds (15 minutes) via `JWT_ACCESS_EXPIRES_SECONDS`.
  - Cookie `maxAge` is `15 * 60 * 1000` ms (15 min).
  - **File:** `backend/src/config/index.ts:17`, `backend/src/config/index.ts:42`

- [x] **PASS** -- Refresh token expiration is reasonable (<=7 days)
  - `config.jwt.refreshExpiresIn` defaults to `604800` seconds (7 days) via `JWT_REFRESH_EXPIRES_SECONDS`.
  - Cookie `maxAge` is `7 * 24 * 60 * 60 * 1000` ms (7 days).
  - **File:** `backend/src/config/index.ts:20-21`, `backend/src/config/index.ts:43`

- [x] **PASS** -- Tokens are signed with strong secret (256+ bits)
  - Production startup validation enforces `MIN_JWT_SECRET_LENGTH = 32` characters for both `accessSecret` and `refreshSecret`. A 32-character base64 string yields 192+ bits of entropy; the comment recommends `openssl rand -base64 32` which produces 44 characters (256 bits). The code will reject secrets shorter than 32 characters.
  - **File:** `backend/src/config/index.ts:134-149`

- [x] **PASS** -- Secrets loaded from environment, not hardcoded
  - Secrets read from `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` environment variables. Development fallbacks exist (`'access-secret-change-in-production'`) but production startup explicitly rejects these defaults and throws errors.
  - **File:** `backend/src/config/index.ts:16,20,120-132`

- [~] **PARTIAL** -- Token validation checks expiration, signature, and issuer
  - `jwt.verify()` validates expiration and signature automatically. The `type` field is checked to ensure access tokens are not confused with refresh tokens (and vice versa). However, **no `issuer` (`iss`) claim is set during signing or verified during validation**. This is a low-risk gap since the tokens are signed with application-specific secrets, but adding `issuer` would strengthen token provenance verification.
  - **File:** `backend/src/middleware/auth.ts:63-68`, `backend/src/services/authService.ts:174-177,262-266`
  - **Severity:** LOW -- `iss` claim not used, but acceptable given unique per-application secrets.

---

### 2. Password Security

- [x] **PASS** -- bcrypt used with cost factor >=10
  - bcrypt cost factor defaults to `12` via `config.security.bcryptRounds`, configurable with `BCRYPT_ROUNDS` env var.
  - **File:** `backend/src/config/index.ts:51`, `backend/src/services/authService.ts:124`

- [x] **PASS** -- Password requirements enforced (length, complexity)
  - Backend `validatePasswordStrength()` requires: 12+ characters, uppercase, lowercase, number, special character.
  - Zod validation schema `strongPassword` requires: 8+ characters, uppercase, lowercase, number, special character.
  - **Finding:** There is a **discrepancy** between the Zod schema (min 8) and `validatePasswordStrength()` (min 12). The Zod validation runs first in middleware, so a password of 8-11 characters would pass Zod but could fail the service-level check. In practice, registration calls `validatePasswordStrength()` in the service, so both checks apply to registration. The password reset flow also calls `validatePasswordStrength()`. The Zod schema acts as a first pass and the service function provides the stricter check.
  - **File:** `backend/src/services/authService.ts:137-157`, `backend/src/middleware/validation.ts:99-105`
  - **Severity:** LOW -- The stricter backend check (12 chars) always runs. Recommend aligning Zod min to 12 for consistent error messages.

- [x] **PASS** -- Password not logged anywhere
  - Explicit comment `"Note: Password intentionally not logged for security"` at line 955. Grep confirms no password values are logged. Only email addresses appear in log messages.
  - **File:** `backend/src/services/authService.ts:955`

- [x] **PASS** -- Timing-safe comparison used for password verification
  - `bcrypt.compare()` is inherently timing-safe by design. Additionally, the `attemptLogin()` function performs a dummy `bcrypt.compare()` when the user does not exist, plus a random 0-50ms delay, to prevent user enumeration via timing analysis.
  - **File:** `backend/src/services/authService.ts:594-601`

---

### 3. Cookie Security

- [x] **PASS** -- `HttpOnly` flag set on auth cookies
  - Both `access_token` and `refresh_token` cookies are set with `httpOnly: true`.
  - **File:** `backend/src/controllers/authController.ts:80-87,99-106`

- [x] **PASS** -- `Secure` flag set (HTTPS only)
  - `config.cookie.secure` is `true` when `NODE_ENV === 'production'`.
  - **File:** `backend/src/config/index.ts:34`

- [x] **PASS** -- `SameSite` attribute configured appropriately
  - Defaults to `'lax'` in production (same-domain). Supports `'none'` for cross-domain deployments when `COOKIE_DOMAIN` is set. Configuration is via `COOKIE_SAME_SITE` env var.
  - **File:** `backend/src/config/index.ts:38-39`

- [x] **PASS** -- Cookie expiration matches token expiration
  - Access token cookie: `15 * 60 * 1000` ms = 15 minutes. JWT `expiresIn`: 900 seconds = 15 minutes.
  - Refresh token cookie: `7 * 24 * 60 * 60 * 1000` ms = 7 days. JWT `expiresIn`: 604800 seconds = 7 days.
  - **File:** `backend/src/config/index.ts:42-44`

---

### 4. Token Refresh Flow

- [x] **PASS** -- Refresh token stored in HttpOnly cookie
  - Set via `setRefreshTokenCookie()` with `httpOnly: true`.
  - **File:** `backend/src/controllers/authController.ts:94-107`

- [x] **PASS** -- Refresh endpoint issues new access token
  - `POST /api/v1/auth/refresh` verifies the refresh token, generates new access and refresh tokens, sets them as cookies, and returns the access token in the response body.
  - **File:** `backend/src/controllers/authController.ts:329-364`

- [x] **PASS** -- Refresh token rotation on use (recommended)
  - `refreshTokens()` revokes the old refresh token before generating new ones: `await revokeRefreshToken(refreshToken)` followed by `await generateTokens(user, metadata)`.
  - **File:** `backend/src/services/authService.ts:351-355`

- [x] **PASS** -- Old tokens invalidated on logout
  - `logout()` calls `revokeRefreshToken()` which deletes the session from the database. `logoutAll()` calls `revokeAllUserTokens()` which deletes all sessions for the user.
  - Access tokens are short-lived (15 min) and there is an in-memory `revokedTokens` Set, though individual access token revocation is not called on logout (they expire naturally).
  - **File:** `backend/src/controllers/authController.ts:370-396,402-430`, `backend/src/services/authService.ts:308-324,329-334`

---

### 5. Frontend Auth State

- [x] **PASS** -- `refreshToken()` called BEFORE `getCurrentUser()` on page load
  - The `useEffect` in `AuthProvider` explicitly calls `authApi.refreshToken()` first, then `authApi.getCurrentUser()`. Clear comments explain why order matters.
  - **File:** `src/contexts/AuthContext.tsx:80-97`

- [x] **PASS** -- Auth state cleared on logout
  - `logout()` calls `authApi.logout()` (server-side), then `setUser(null)` and `clearAuthToken()` in a `finally` block ensuring state is always cleared.
  - **File:** `src/contexts/AuthContext.tsx:157-164`

- [x] **PASS** -- Failed auth redirects to login
  - The `AppContent` component checks `isAuthenticated` and renders `LoginPage` when false. The API client has an `onAuthFailureCallback` mechanism that can trigger navigation on 401 errors.
  - **File:** `src/App.tsx:237-273`, `src/services/api/client.ts:59-61,192-194`

- [x] **PASS** -- Token stored in memory only (not localStorage)
  - `authToken` is a module-level `let` variable in `client.ts`. No calls to `localStorage` or `sessionStorage` exist anywhere in the frontend source. Comments explicitly state: "Auth token management (stored in memory only)".
  - **File:** `src/services/api/client.ts:42-57`

---

### 6. Account Lockout

- [x] **PASS** -- Failed login attempts tracked (`failedLoginAttempts` field)
  - `recordFailedLogin()` increments `failedLoginAttempts` and stores `lastFailedLogin` timestamp in the database.
  - **File:** `backend/src/services/authService.ts:392-422`

- [x] **PASS** -- Account locked after 5 failed attempts (`lockedUntil` field)
  - `config.security.maxLoginAttempts` defaults to `5`. When `newAttempts >= maxLoginAttempts`, `lockedUntil` is set.
  - **File:** `backend/src/config/index.ts:49`, `backend/src/services/authService.ts:398-399`

- [x] **PASS** -- Lockout duration: 30 minutes (configurable via `LOCKOUT_DURATION_MINUTES`)
  - `config.security.lockoutDuration` defaults to `30 * 60 * 1000` ms (30 minutes), configurable via `LOCKOUT_DURATION_MINUTES`.
  - **File:** `backend/src/config/index.ts:50`

- [x] **PASS** -- Successful login resets failed attempt counter
  - `resetFailedLoginAttempts()` sets `failedLoginAttempts: 0`, `lockedUntil: null`, `lastFailedLogin: null`, and updates `lastLoginAt`.
  - **File:** `backend/src/services/authService.ts:427-438`

- [x] **PASS** -- Lockout status checked before password comparison
  - In `attemptLogin()`, `isAccountLocked(user)` is checked at line 626 before `verifyPassword()` at line 636.
  - **File:** `backend/src/services/authService.ts:626-633`

- [x] **PASS** -- Lockout not bypassable via API manipulation
  - Lockout state is stored server-side in the database. The `attemptLogin()` function always checks lockout status. The only bypass is for demo accounts (which are blocked in production). Rate limiting provides an additional layer of protection.

---

### 7. Email Verification Flow

- [x] **PASS** -- Verification token generated on registration
  - `createUser()` calls `generateEmailVerificationToken()` (32 random bytes, hex-encoded) and stores it with the user.
  - **File:** `backend/src/services/authService.ts:447-483`

- [x] **PASS** -- Token has 24-hour expiration
  - `EMAIL_VERIFICATION_EXPIRATION_HOURS = 24`. Expiration is set as `Date.now() + 24 * 60 * 60 * 1000`.
  - **File:** `backend/src/services/authService.ts:26,466`

- [x] **PASS** -- Token sent via SendGrid email
  - `sendVerificationEmail()` constructs the verification URL and sends it via SendGrid (or logs it in development when SendGrid is not configured).
  - **File:** `backend/src/services/emailService.ts:250-267`, `backend/src/controllers/authController.ts:180`

- [x] **PASS** -- Token cleared from URL immediately after read (frontend)
  - `App.tsx` reads the token from the URL into state via `getSpecialRoute()`, then a `useEffect` immediately calls `window.history.replaceState({}, document.title, window.location.pathname)` to strip the query string. The token is held only in React state.
  - **File:** `src/App.tsx:116-121`

- [x] **PASS** -- Token single-use (invalidated after verification)
  - `verifyEmail()` sets `emailVerificationToken: null` and `emailVerificationExpires: null` after successful verification. If the token is already used, the lookup by token returns null.
  - **File:** `backend/src/services/authService.ts:713-720`

- [~] **PARTIAL** -- Resend verification endpoint rate limited
  - The `resend-verification` route is covered by the general `authLimiter` (20 requests per 15 minutes) applied to all auth routes. However, it does not have `strictAuthLimiter` applied, which means an attacker could trigger 20 verification emails per 15-minute window per IP. This is a moderate rate for email sending.
  - **File:** `backend/src/routes/authRoutes.ts:32,67-71`
  - **Severity:** MEDIUM -- Recommend adding `strictAuthLimiter` or a dedicated rate limiter to prevent email bombing.

---

### 8. Password Reset Flow

- [x] **PASS** -- Reset token generated on forgot-password request
  - `forgotPassword()` generates a token via `generatePasswordResetToken()` (32 random bytes, hex-encoded).
  - **File:** `backend/src/services/authService.ts:803-845`

- [x] **PASS** -- Token has expiration (time-limited)
  - `PASSWORD_RESET_EXPIRATION_HOURS = 1` (1 hour).
  - **File:** `backend/src/services/authService.ts:786,831`

- [x] **PASS** -- Token sent via SendGrid email
  - `sendPasswordResetEmail()` constructs the reset URL and sends via SendGrid.
  - **File:** `backend/src/services/emailService.ts:272-289`, `backend/src/controllers/authController.ts:696-698`

- [x] **PASS** -- Token cleared from URL immediately after read (frontend)
  - Same mechanism as email verification -- `App.tsx` strips query string via `history.replaceState` immediately after reading.
  - **File:** `src/App.tsx:116-121`

- [x] **PASS** -- Token single-use (invalidated after reset)
  - `resetPassword()` sets `passwordResetToken: null` and `passwordResetExpires: null` after successful reset. Expired tokens are also cleared.
  - **File:** `backend/src/services/authService.ts:894-903`

- [x] **PASS** -- All sessions revoked on password reset
  - `resetPassword()` calls `revokeAllUserTokens(prismaUser.id)` which deletes all sessions from the database.
  - **File:** `backend/src/services/authService.ts:907`

- [x] **PASS** -- Forgot-password endpoint rate limited (strict)
  - `strictAuthLimiter` is applied to `/forgot-password`: 5 requests per 15 minutes per email+IP.
  - **File:** `backend/src/routes/authRoutes.ts:74-79`

---

### 9. Session Management

- [x] **PASS** -- Sessions stored in PostgreSQL `sessions` table
  - Prisma schema defines `model Session` mapped to `@@map("sessions")` with proper indexes.
  - **File:** `backend/prisma/schema.prisma:52-66`

- [x] **PASS** -- Session includes: token, userId, IP, userAgent, expiresAt
  - Schema fields: `id` (UUID), `userId`, `token` (VARCHAR 500), `ipAddress` (VARCHAR 45), `userAgent`, `expiresAt`, `createdAt`.
  - **File:** `backend/prisma/schema.prisma:53-59`

- [~] **PARTIAL** -- Expired sessions cleaned up automatically (10-min interval)
  - Session cleanup is implemented via `startSessionCleanup()` but runs every **60 minutes** (not 10 as documented). The prompt states 10-minute interval, but the code uses `60 * 60 * 1000` (1 hour).
  - **File:** `backend/src/services/authService.ts:1010-1014`
  - **Severity:** LOW -- The cleanup still happens; the interval is just longer than documented. Expired sessions are also individually cleaned up during token verification (line 294). Recommend either updating documentation or changing interval to match.

- [x] **PASS** -- Logout revokes current session token from DB
  - `logout()` calls `revokeRefreshToken()` which decodes the JWT to get the `jti` and deletes the session by ID.
  - **File:** `backend/src/services/authService.ts:308-324`, `backend/src/controllers/authController.ts:378-379`

- [x] **PASS** -- Logout-all revokes all user sessions
  - `logoutAll()` calls `revokeAllUserTokens(userId)` which does `prisma.session.deleteMany({ where: { userId } })`.
  - **File:** `backend/src/services/authService.ts:329-334`, `backend/src/controllers/authController.ts:413`

- [x] **PASS** -- Session metadata tracked for audit trail
  - `getSessionMetadata()` extracts IP address (handling proxies via `x-forwarded-for`) and user agent from requests. These are stored in the session record and also passed to audit log entries.
  - **File:** `backend/src/controllers/authController.ts:59-70`

---

### 10. Demo Account Security

- [x] **PASS** -- Demo login only enabled when `DEMO_ACCOUNT_ENABLED=true`
  - `config.demo.enabled` is `process.env.DEMO_ACCOUNT_ENABLED === 'true'`. The `demoLogin()` controller checks this flag and returns 400 if disabled. The `attemptLogin()` function also checks this flag before applying demo bypass logic.
  - **File:** `backend/src/config/index.ts:75`, `backend/src/controllers/authController.ts:536-538`, `backend/src/services/authService.ts:545`

- [x] **PASS** -- Demo blocked in production (`NODE_ENV=production`)
  - Production config validation throws a fatal error if `config.demo.enabled` is true: `"DEMO_ACCOUNT_ENABLED cannot be true in production"`.
  - **File:** `backend/src/config/index.ts:191-197`

- [x] **PASS** -- Demo sessions have extended duration (30 days)
  - `DEMO_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000`. Demo users get 30-day refresh token expiry via `generateRefreshToken()` and 30-day cookie maxAge via `setRefreshTokenCookie()`.
  - **File:** `backend/src/services/authService.ts:180,207-209`, `backend/src/controllers/authController.ts:94-97`

- [x] **PASS** -- Demo accounts restricted from sensitive operations (`demoProtection.ts`)
  - `demoProtection.ts` exports middleware to block: role changes, admin access, and modification of other users' data. Individual middleware functions (`blockDemoRoleChange`, `blockDemoAdminAccess`, `blockDemoUserModification`) and a combined `demoProtection` middleware are available.
  - **File:** `backend/src/middleware/demoProtection.ts:37-133`

---

### 11. Rate Limiting

- [x] **PASS** -- Login endpoint: strict limit (5/15 min per email+IP)
  - `strictAuthLimiter`: 5 requests per 15-minute window. Uses `email:IP` composite key. `skipSuccessfulRequests: true` ensures only failed attempts count.
  - **File:** `backend/src/middleware/rateLimiter.ts:40-59`, `backend/src/routes/authRoutes.ts:48`

- [x] **PASS** -- Register endpoint: moderate limit (20/15 min)
  - `authLimiter` (20/15 min) is applied to all auth routes via `router.use(authLimiter)`.
  - **File:** `backend/src/middleware/rateLimiter.ts:25-37`, `backend/src/routes/authRoutes.ts:32`

- [x] **PASS** -- Password reset endpoint: strict limit
  - `strictAuthLimiter` (5/15 min per email+IP) applied to `/forgot-password`.
  - **File:** `backend/src/routes/authRoutes.ts:74-79`

- [~] **PARTIAL** -- Verification resend: rate limited
  - Covered by `authLimiter` (20/15 min) but not by `strictAuthLimiter`. This allows up to 20 verification emails to be triggered per IP per 15-minute window.
  - **File:** `backend/src/routes/authRoutes.ts:67-71`
  - **Severity:** MEDIUM -- Same finding as checklist item 7.6. Recommend stricter rate limiting.

---

## Questions and Answers

### Q1: Is the token refresh order correct in AuthContext?

**YES.** The `checkAuth` function in `AuthProvider` correctly calls `authApi.refreshToken()` first, then `authApi.getCurrentUser()`. This is explicitly documented with a "CRITICAL FIX" comment explaining that the access token cookie (15 min) expires before the refresh token (7 days), so refreshing first ensures a valid access token is available for the subsequent `getCurrentUser()` call.

**File:** `src/contexts/AuthContext.tsx:80-97`

### Q2: Are there any auth bypass vulnerabilities?

**NO significant bypasses found.** The demo account bypass in `attemptLogin()` is properly gated behind `config.demo.enabled` which is forced to `false` in production (with a fatal error if set to `true`). All protected routes use the `authenticate` middleware. The `optionalAuth` middleware correctly does not grant access if the token is invalid -- it simply continues without setting `req.user`.

One minor observation: the access token blacklist (`revokedTokens` Set in `authService.ts:114`) is in-memory and not persisted. On server restart, previously revoked access tokens would be accepted until they expire. Given the 15-minute access token lifetime, this is acceptable risk.

### Q3: Is password validation consistent across frontend/backend?

**MOSTLY.** Both check uppercase, lowercase, number, and special character requirements. However:
- Backend `validatePasswordStrength()`: minimum **12** characters
- Backend Zod schema `strongPassword`: minimum **8** characters
- Frontend `ResetPasswordPage.tsx`: minimum **8** characters, checks uppercase/lowercase/number but **not special character**

The backend service function always runs for registration and password reset, so the 12-character requirement is enforced server-side. The frontend has weaker validation, meaning users could see a client-side success followed by a server-side rejection for passwords between 8-11 characters.

**Severity:** LOW -- Server enforces the stricter rule. Frontend validation is advisory only.

### Q4: Is account lockout working correctly?

**YES.** The lockout flow is well-implemented:
1. `isAccountLocked()` is checked before password verification
2. `recordFailedLogin()` increments the counter and locks after 5 attempts
3. `resetFailedLoginAttempts()` clears lockout on successful login
4. Lockout state is server-side in PostgreSQL (not bypassable client-side)
5. Rate limiting provides an additional layer even before account-level lockout

### Q5: Are email verification tokens properly invalidated after use?

**YES.** The `verifyEmail()` function sets `emailVerificationToken: null` and `emailVerificationExpires: null` after successful verification. Subsequent attempts to verify with the same token will fail because `findUnique({ where: { emailVerificationToken: token } })` returns null.

---

## Detailed Findings

### FINDING-01: Resend Verification Endpoint Missing Strict Rate Limit
- **Severity:** MEDIUM
- **Location:** `backend/src/routes/authRoutes.ts:67-71`
- **Description:** The `/resend-verification` endpoint only has the general `authLimiter` (20 requests per 15 minutes per IP) rather than `strictAuthLimiter`. An attacker could trigger up to 20 verification emails per 15-minute window to a target email address, potentially causing email service costs or user annoyance.
- **Recommendation:** Apply `strictAuthLimiter` to the resend-verification route, or create a dedicated rate limiter (e.g., 3 per hour per email address).

### FINDING-02: Password Validation Inconsistency Between Zod and Service
- **Severity:** LOW
- **Location:** `backend/src/middleware/validation.ts:99-101` vs `backend/src/services/authService.ts:140`
- **Description:** The Zod `strongPassword` schema allows passwords with minimum 8 characters, while `validatePasswordStrength()` requires minimum 12. The frontend `ResetPasswordPage.tsx` also uses 8 as the minimum and omits the special character check. This inconsistency can cause confusing user experiences where frontend validation passes but backend rejects.
- **Recommendation:** Align the Zod schema minimum to 12 characters and ensure the frontend mirrors all backend requirements.

### FINDING-03: No JWT `issuer` Claim
- **Severity:** LOW
- **Location:** `backend/src/services/authService.ts:174`, `backend/src/middleware/auth.ts:63`
- **Description:** JWTs are signed without an `issuer` (`iss`) claim and verification does not check for one. While the tokens are signed with application-specific secrets (making cross-application token confusion unlikely), adding an issuer claim is a defense-in-depth measure.
- **Recommendation:** Add `issuer: 'ownmyhealth'` to `jwt.sign()` options and `issuer: 'ownmyhealth'` to `jwt.verify()` options.

### FINDING-04: Session Cleanup Interval Mismatch with Documentation
- **Severity:** LOW
- **Location:** `backend/src/services/authService.ts:1010-1014`
- **Description:** The prompt documentation states sessions are cleaned up every 10 minutes, but the actual interval is `60 * 60 * 1000` ms (1 hour). Expired sessions are still cleaned up individually during refresh token verification, so this gap has minimal security impact.
- **Recommendation:** Either update the documentation to state 1-hour interval, or change the interval to 10 minutes as originally intended.

### FINDING-05: In-Memory Access Token Blacklist Not Persisted
- **Severity:** INFO
- **Location:** `backend/src/services/authService.ts:114`
- **Description:** The `revokedTokens` Set is in-memory only. On server restart or in multi-instance deployments, revoked access tokens are not tracked. Given the 15-minute access token lifetime, the window of vulnerability is limited.
- **Recommendation:** For production at scale, consider using Redis for the token blacklist (as noted in the code comment). For single-instance deployments, the current approach is acceptable.

### FINDING-06: Demo Credentials in Frontend Source
- **Severity:** INFO
- **Location:** `src/App.tsx:201`
- **Description:** The frontend `handleDemoLogin` function contains a hardcoded fallback `login('demo@ownmyhealth.com', 'Demo123!')`. While demo mode is blocked in production and these credentials are not secrets, they are visible in the client bundle.
- **Recommendation:** Consider loading demo credentials from environment variables or removing the fallback entirely since the `/auth/demo` endpoint handles demo login.

---

## Summary Statistics

| Category | PASS | PARTIAL | FAIL | Total |
|----------|------|---------|------|-------|
| 1. JWT Implementation | 4 | 1 | 0 | 5 |
| 2. Password Security | 4 | 0 | 0 | 4 |
| 3. Cookie Security | 4 | 0 | 0 | 4 |
| 4. Token Refresh Flow | 4 | 0 | 0 | 4 |
| 5. Frontend Auth State | 4 | 0 | 0 | 4 |
| 6. Account Lockout | 6 | 0 | 0 | 6 |
| 7. Email Verification | 5 | 1 | 0 | 6 |
| 8. Password Reset Flow | 7 | 0 | 0 | 7 |
| 9. Session Management | 5 | 1 | 0 | 6 |
| 10. Demo Account Security | 4 | 0 | 0 | 4 |
| 11. Rate Limiting | 3 | 1 | 0 | 4 |
| **Totals** | **50** | **4** | **0** | **54** |

**Overall Pass Rate: 92.6% PASS, 7.4% PARTIAL, 0% FAIL**

---

## Additional Security Observations (Positive)

1. **Timing attack protection on login:** Dummy bcrypt comparison + random delay when user does not exist prevents user enumeration (`authService.ts:594-601`).
2. **Email enumeration prevention:** Both `forgotPassword()` and `resendVerificationEmail()` always return success regardless of whether the user exists (`authService.ts:820-821,741-742`).
3. **CSRF double-submit cookie:** Properly implemented with `crypto.timingSafeEqual` for token comparison (`csrf.ts:184`).
4. **Comprehensive audit logging:** All auth events (login, logout, registration, verification, password changes, lockouts) are logged with metadata.
5. **Production config validation:** Critical secrets, key lengths, and known-insecure placeholder keys are all validated at startup (`config/index.ts:106-198`).
6. **Input validation:** Zod schemas with sanitization run on all auth endpoints via middleware.
7. **Session metadata tracking:** IP address and user agent are captured for each session, enabling security forensics.
8. **Token rotation:** Refresh tokens are rotated on each use, limiting the impact of token theft.
9. **Password change revokes all sessions:** Both `changePassword` and `resetPassword` call `revokeAllUserTokens()` to force re-authentication on all devices.
