---
tags:
  - security
  - authentication
  - critical
type: prompt
priority: 1
updated: 2026-08-01
---

# Authentication Review

## Files to Review
- `backend/src/middleware/auth.ts` (JWT validation, `authenticate` / `optionalAuth` / `requireBearerAuth`)
- `backend/src/services/authService.ts` (auth logic, token rotation, lockout, email-change)
- `backend/src/controllers/authController.ts` (endpoints)
- `backend/src/routes/authRoutes.ts` (route definitions)
- `backend/src/config/index.ts` (JWT secrets, expiry, lockout & bcrypt config, demo gating)
- `backend/src/config/jwtOptions.ts` (`JWT_SIGN_OPTIONS` / `JWT_VERIFY_OPTIONS` — issuer/audience)
- `backend/src/middleware/csrf.ts` (`setCsrfCookie` — token regeneration on login/refresh)
- `src/contexts/AuthContext.tsx` (frontend auth state, HIPAA inactivity timeout)
- `src/components/auth/ConfirmEmailChangePage.tsx` (email-change confirmation page)
- `backend/prisma/migrations/20260606000002_add_tokens_valid_after/` (`User.tokensValidAfter` cross-instance access-token cutoff)
- `backend/prisma/migrations/20260613_revoked_access_tokens/` (`RevokedAccessToken` table — single-device cross-instance logout, FORCE RLS)

## OwnMyHealth Auth Architecture
- **Method**: JWT with HttpOnly cookies (access + refresh tokens, DB-backed sessions)
- **Access Token**: 15-minute expiration (`JWT_ACCESS_EXPIRES_SECONDS`, default 900s)
- **Refresh Token**: 7-day expiration (`JWT_REFRESH_EXPIRES_SECONDS`, default 604800s; 30-day for demo accounts)
- **Refresh Rotation**: single-use, rotated atomically (`SELECT ... FOR UPDATE` in `refreshTokens`)
- **Refresh-Token Reuse Detection** (pentest M-1): a signature-valid refresh token whose `jti` is no longer the live session triggers FULL FAMILY revocation via `revokeAllUserTokens(payload.id)` — UNLESS it falls inside a 10s benign-race grace window (`REFRESH_REUSE_GRACE_MS`, `authService.ts:668`). Reuse writes a `LOGIN_FAILED` audit row with reason `REFRESH_TOKEN_REUSE` + a `familyRevoked` flag (`authService.ts:791-806`, `:815-830`)
- **Access Token**: now carries a per-token `jti` (`jti: uuidv4()`, `authService.ts:447,456`; `JwtPayload.jti` documented `auth.ts:28-31`), load-bearing for single-device cross-instance revocation
- **Access Token Revocation** (three layers): (1) in-memory blacklist (`revokeAccessToken` / `isTokenRevoked`), per-instance only; (2) per-user `tokens_valid_after` DB cutoff stamped by `revokeAllUserTokens` (logout-all / password-change / reset / email-change / admin-deactivate, `authService.ts:648-651`) — kills all in-flight access tokens on every replica; (3) `revoked_access_tokens` table keyed by `jti` for single-device cross-instance logout (`revokeAccessTokenCrossInstance`, `authService.ts:358-394`). `authenticate` / `optionalAuth` / `requireBearerAuth` call `isAccessTokenStale(id, iat, jti)` on EVERY request (`auth.ts:106`, `:163`, `:222`; impl `authService.ts:299`), checking layers (2)+(3) (~15s revocation-state cache TTL, `authService.ts:259-278`)
- **Password**: bcrypt hashed (cost factor configurable via `BCRYPT_ROUNDS`, default 13)
- **CSRF**: Double-submit cookie pattern; CSRF token regenerated on login/refresh (token-fixation defense)
- **Account Lockout**: `MAX_LOGIN_ATTEMPTS` (default 5) → `LOCKOUT_DURATION_MINUTES` (default 30) lockout
- **Email Verification**: 24-hour token (`EMAIL_VERIFICATION_EXPIRATION_HOURS`), required before login; token stored as SHA-256 hash
- **Password Reset**: 1-hour token via SendGrid; token stored as SHA-256 hash; all sessions revoked on reset
- **Email Change**: re-auth with current password → tokenized confirmation link to new address + notice to old (1-hour token, SHA-256 hashed; migration `20260601_add_email_change`)
- **Account Enumeration Defenses**: generic register response, timing-safe dummy bcrypt for unknown emails, no `remainingAttempts` leaked to client
- **Sessions**: Database-backed (PostgreSQL `sessions` table), cleanup every 10 minutes (`startSessionCleanup`, `authService.ts:1792-1808`) — sweeps the in-memory revoked-token blacklist via `sweepRevokedTokens` AND prunes expired rows from the DB-backed `revoked_access_tokens` table (`cleanupExpiredSessions` → `tx.revokedAccessToken.deleteMany`, `authService.ts:1766-1769`)
- **Inactivity Timeout**: HIPAA auto-logoff after 15 min idle, 2-min warning (frontend `AuthContext`)

## Checklist

### 1. JWT Implementation
- [ ] Access token expiration is short (≤15 minutes, `JWT_ACCESS_EXPIRES_SECONDS`)
- [ ] Refresh token expiration is reasonable (≤7 days, `JWT_REFRESH_EXPIRES_SECONDS`)
- [ ] Separate secrets for access vs refresh tokens (`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`)
- [ ] Secrets required via `requireEnv` (no hardcoded fallback in ANY environment); weak/placeholder values rejected; min 32 chars enforced at config load
- [ ] Token validation checks expiration, signature, and issuer/audience (`JWT_VERIFY_OPTIONS` in `config/jwtOptions.ts`)
- [ ] Token `type` field checked — access endpoints reject refresh tokens and vice versa
- [ ] Access tokens carry a per-token `jti` (`jti: uuidv4()`, `authService.ts:447,456`; `JwtPayload.jti`, `auth.ts:28-31`) — load-bearing for single-device cross-instance revocation

### 2. Password Security
- [ ] bcrypt used with cost factor ≥12 (`BCRYPT_ROUNDS`, default 13 for HIPAA workloads)
- [ ] Password requirements enforced in `validatePasswordStrength` (≥12 chars, upper/lower/number/special)
- [ ] Password not logged anywhere (demo password explicitly not logged in `initializeDemoUser`)
- [ ] Timing-safe comparison used for password verification (`bcrypt.compare`)
- [ ] Login against an unknown email still runs a real bcrypt compare against a dummy hash (timing-attack defense in `attemptLogin`)

### 3. Cookie Security
- [ ] `HttpOnly` flag set on `access_token` and `refresh_token` cookies
- [ ] `Secure` flag forced on (`config.cookie.secure` = `resolvedCookieSecure`, `config/index.ts:91-95,138`) whenever production OR staging OR `SameSite=None` OR any `COOKIE_DOMAIN` deploy (M7/F-18) — NOT gated on `NODE_ENV === 'production'` alone; a boot invariant hard-fails `SameSite=None` without `Secure`
- [ ] `SameSite` configured appropriately (`COOKIE_SAME_SITE` override; production same-domain defaults to `strict`, cross-domain `COOKIE_DOMAIN` set → `none`)
- [ ] Cookie expiration matches token expiration (demo refresh cookie extended to 30 days only in non-production)
- [ ] Cookies cleared on logout (`clearAuthCookies` with matching path/domain attributes)

### 4. Token Refresh Flow
- [ ] Refresh token stored in HttpOnly cookie
- [ ] Refresh endpoint (`POST /api/v1/auth/refresh`) issues new access token + new refresh token
- [ ] Refresh token rotation on use — single-use; old session row deleted, new one inserted in the same transaction
- [ ] Concurrent refresh with the same token serializes (`SELECT ... FOR UPDATE` row lock in `refreshTokens`) so only one succeeds
- [ ] **That row lock depends on an RLS UPDATE policy** (OF-22, fixed `20260712_add_sessions_update_policy`).
  PostgreSQL applies UPDATE-policy checks to `SELECT ... FOR UPDATE`, so under FORCE RLS with a NOBYPASSRLS
  role the lock saw zero rows: every refresh 401'd, and the missing row was misread as **reuse**, firing
  `revokeAllUserTokens()` and logging users out across all devices. Confirm `sessions_update_own` exists and
  that the reuse detector cannot be triggered by a *policy* miss rather than a real replayed token — the
  failure modes are indistinguishable at the call site. See prompt [01](./01-database-schema.md) §RLS.
- [ ] Refresh-token REUSE triggers full family revocation — a signature-valid token whose `jti` is no longer the live session calls `revokeAllUserTokens(payload.id)` unless inside the 10s benign-race window (`REFRESH_REUSE_GRACE_MS`, `authService.ts:791-806`); reuse audited as `REFRESH_TOKEN_REUSE` (`:815-830`)
- [ ] Old tokens invalidated on logout (refresh session deleted; access token added to in-memory blacklist AND `jti` upserted into `revoked_access_tokens` via `revokeAccessTokenCrossInstance`, scoped to the verified identity — `authController.ts:473,481`)
- [ ] CSRF token regenerated on refresh (`setCsrfCookie`)

### 5. Frontend Auth State
- [ ] `refreshToken()` called BEFORE `getCurrentUser()` on page load (`checkAuth` in `AuthContext`)
- [ ] Auth state cleared on logout (`setUser(null)` + `clearAuthToken()`)
- [ ] Failed auth redirects to login (`setOnAuthFailure` wires the API client 401 path to `logout`)
- [ ] Token stored in memory only (not localStorage) — only non-PHI identity (id/email/role) held in context
- [ ] HIPAA inactivity auto-logoff present (15-min timeout, 2-min warning; activity events exclude mousemove)
- [ ] Idle logout force-reloads to login so in-memory PHI in other tabs is discarded

### 6. Account Lockout
- [ ] Failed login attempts tracked (`failedLoginAttempts` field)
- [ ] Account locked after 5 failed attempts (`lockedUntil` field)
- [ ] Lockout duration: 30 minutes (configurable via `LOCKOUT_DURATION_MINUTES`)
- [ ] Successful login resets failed attempt counter
- [ ] Lockout status checked before password comparison
- [ ] Lockout not bypassable via API manipulation

### 7. Email Verification Flow
- [ ] Verification token generated on registration (`generateEmailVerificationToken`, 32 random bytes)
- [ ] Token has 24-hour expiration
- [ ] Only the SHA-256 hash stored in DB (`hashToken`); plaintext goes in the email link only
- [ ] Token sent via SendGrid email
- [ ] Token cleared from URL immediately after read (frontend)
- [ ] Token single-use (cleared on verification; `resendVerification` does not reveal whether the user exists)
- [ ] Resend verification endpoint rate limited (`strictAuthLimiter`)

### 8. Password Reset Flow
- [ ] Reset token generated on forgot-password request (`generatePasswordResetToken`, 32 random bytes)
- [ ] Token has 1-hour expiration (`PASSWORD_RESET_EXPIRATION_HOURS`)
- [ ] Only the SHA-256 hash stored in DB (`hashToken`); plaintext goes in the email link only
- [ ] Forgot-password always returns success (no email enumeration)
- [ ] Token sent via SendGrid email
- [ ] Token cleared from URL immediately after read (frontend)
- [ ] Token single-use (cleared on reset; expired token also cleared on lookup)
- [ ] All sessions revoked on password reset (`revokeAllUserTokens`); failed attempts/lockout reset
- [ ] Forgot-password AND reset-password endpoints rate limited (`strictAuthLimiter`)

### 8b. Email Change Flow (NEW — migration `20260601_add_email_change`)
- [ ] `POST /auth/change-email` requires authentication AND re-auth with current password (`requestEmailChange`)
- [ ] Target address checked free; rejects if same as current or already in use
- [ ] Tokenized confirmation link emailed to the NEW address (`sendEmailChangeConfirmation`) + security notice to the OLD (`sendEmailChangeNotice`)
- [ ] 1-hour token (`EMAIL_CHANGE_EXPIRATION_HOURS`), stored as SHA-256 hash in `email_change_token`; pending address in `pending_email`
- [ ] `GET /auth/confirm-email-change` is public, single-use (`ConfirmEmailChangePage` has run-once guard), strict rate limited
- [ ] Confirmation re-checks the target is still free, swaps email (marks verified), clears pending state, revokes all sessions (forces re-login)

### 9. Session Management
- [ ] Sessions stored in PostgreSQL `sessions` table (model `Session`)
- [ ] Session includes: id (JTI), token (truncated), userId, IP, userAgent, expiresAt
- [ ] Expired sessions cleaned up automatically (10-min interval, `startSessionCleanup`)
- [ ] Logout revokes current session token from DB, blacklists the access token in-memory (`revokeAccessToken`, `authController.ts:473`), AND records its `jti` in `revoked_access_tokens` via `revokeAccessTokenCrossInstance(accessTokenValue, verifiedUserId)` (`authController.ts:481`) so it stops authenticating on other replicas — scoped to the verified identity to prevent forged-token seeding
- [ ] Logout-all (`revokeAllUserTokens`) revokes all user sessions AND stamps `users.tokens_valid_after` (`authService.ts:648-651`), killing all in-flight access tokens cross-instance via `isAccessTokenStale`
- [ ] 10-min cleanup sweeps the in-memory blacklist (`sweepRevokedTokens`) AND prunes expired DB rows from `revoked_access_tokens` (`cleanupExpiredSessions`, `authService.ts:1766-1769`) so both stay bounded
- [ ] Cross-instance revocation now CLOSED (M-4): `tokens_valid_after` + `revoked_access_tokens` are checked on every request via `isAccessTokenStale` (`auth.ts:106`); a revoked token survives on another replica only within the ~15s revocation-state cache TTL (`authService.ts:259-278`), not the full 15-min expiry. (Redis/Memorystore still relevant for the rate-limit store, not for token revocation.)
- [ ] Session metadata tracked for audit trail (IP via `req.ip`, honoring `trust proxy`, not raw X-Forwarded-For)

### 10. Demo Account Security
- [ ] Demo login only enabled when `DEMO_ACCOUNT_ENABLED=true`
- [ ] Demo blocked in production (config hard-fails if `DEMO_ACCOUNT_ENABLED=true` in production)
- [ ] Demo lockout-bypass gated on `config.isDevelopment` (NOT just `demo.enabled`) so staging/preview can't be brute-forced without lockout
- [ ] `isDemoUser` / `isDemoEmail` return false when `DEMO_EMAIL` is unset (no empty-string match)
- [ ] Demo sessions have extended duration (30 days) only in non-production
- [ ] Demo accounts restricted from sensitive operations (`demoProtection.ts`)

### 11. Rate Limiting
- [ ] All auth routes wrapped in `authLimiter` (20/15 min)
- [ ] Login endpoint: `strictAuthLimiter` (5/15 min per email+IP, `skipSuccessfulRequests`)
- [ ] Forgot-password / reset-password / resend-verification / change-email / confirm-email-change: `strictAuthLimiter`
- [ ] Limiters backed by shared Redis store when `REDIS_URL` set, else per-instance MemoryStore (`rateLimitStore.ts`)
- [ ] Per-instance MemoryStore limitation noted: effective ceiling is N×limit under Cloud Run autoscale (audit #37)
- [ ] (Eight named limiters exist project-wide: standard, auth, strictAuth, upload, sensitive, ai, providerAccessRequest, bulkOperation — see prompt 10)

## Questions to Ask
1. Is the token refresh order correct in AuthContext (refresh before getCurrentUser)?
2. Are there any auth bypass vulnerabilities?
3. Is password validation consistent across frontend/backend (12-char minimum + complexity)?
4. Is account lockout working correctly, and is it bypassable only via the dev-gated demo path?
5. Are email verification / reset / email-change tokens properly invalidated after use (and stored hashed)?
6. Do the cross-instance revocation mechanisms (`tokens_valid_after` + `revoked_access_tokens`, checked via `isAccessTokenStale`) actually fire on every request path, and is the ~15s revocation-state cache TTL an acceptable residual window?
8. On refresh-token reuse, is full family revocation (`revokeAllUserTokens`) correctly triggered outside the 10s benign-race grace window?
7. Is the email-change flow's re-authentication and session-revocation correct (a valid session alone must not move the login identity)?
