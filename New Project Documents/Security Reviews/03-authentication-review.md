# 03-authentication Review — 2026-06-01

Scope: JWT validation, auth service (token rotation, lockout, email-change, reset), auth controller/routes, JWT/cookie/lockout/demo config, CSRF token regeneration, frontend auth state + inactivity timeout, email-change confirmation page. Evidence cited as `file:line` against the live repo at `C:/Users/breil/Projects/OwnMyHealth/`.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |

No critical/high/medium auth findings. The authentication subsystem is well-hardened: secrets are `requireEnv`-gated with placeholder + length rejection in every environment, JWT verification pins HS256 + issuer + audience, refresh rotation is single-use and row-locked, tokens are SHA-256-hashed at rest, lockout/timing defenses are real, and the demo bypass is gated on `isDevelopment` (not just `demo.enabled`). The three Low findings are hardening/correctness nits, two of which are prompt drift.

## Findings

### F-1 — `strictAuthLimiter` keys on `req.body.email`, but `/change-email` and `/confirm-email-change` carry no `email` field — **Low**
- **Location:** `backend/src/middleware/rateLimiter.ts:67`; routes `backend/src/routes/authRoutes.ts:96-101` (`/confirm-email-change`) and `:127-133` (`/change-email`).
- **Observation:** `strictAuthLimiter`'s key generator builds the bucket from `req.body?.email || ''` plus IP. `/change-email` sends `newEmail` (not `email`) and `/confirm-email-change` is a `GET` with no body, so for both routes the email component is the empty string and the effective key collapses to `:<ip>`. All confirm-email-change attempts and all change-email attempts from a single IP share one 5-per-15-min bucket (and share it with each other).
- **Impact:** Not a weakening — the limit becomes *stricter/shared*, never looser, so brute-force protection is intact. The practical effect is a correctness/UX nit: e.g. a NAT'd office, or a user who legitimately requests a change and then clicks the confirm link, can collide into the same 5/15min ceiling and get throttled earlier than intended. No exploitable security impact.
- **Fix:** In `strictAuthLimiter.keyGenerator`, fall back through the relevant identifiers, e.g. `const id = req.body?.email || req.body?.newEmail || (req.query?.token as string) || ''`, or define a dedicated limiter for the email-change routes keyed on user id (these routes are authenticated for `/change-email`).
- **Evidence:**
  ```ts
  const email = req.body?.email || '';
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `${email}:${ip}`;
  ```

### F-2 — Prompt drift: spec says activity events "exclude mousemove" but lists no count; warning constant is 13 min, not "2-min warning" value — **Low**
- **Location:** `src/contexts/AuthContext.tsx:40-42`.
- **Observation:** The spec checklist item 5 states "HIPAA inactivity auto-logoff present (15-min timeout, 2-min warning; activity events exclude mousemove)." The code matches the *intent* exactly (`INACTIVITY_TIMEOUT_MS = 15 min`, warning fires at 13 min = 2 min before logout, `ACTIVITY_EVENTS` excludes `mousemove`). This is recorded as confirmation, but the spec phrasing "2-min warning" maps to a `13`-minute constant (`INACTIVITY_WARNING_MS`), which can read as a mismatch on a quick scan. Minor doc-vs-code naming gap, no behavior issue.
- **Impact:** None functionally; flagged per protocol so the quarterly prompt refresh can clarify that the "2-minute warning" is implemented as `15min - 2min = 13min`.
- **Fix:** No code change. Optionally clarify the spec to reference `INACTIVITY_WARNING_MS = 13 * 60 * 1000` so reviewers don't expect a literal `2` constant.
- **Evidence:**
  ```ts
  const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
  const INACTIVITY_WARNING_MS = 13 * 60 * 1000; // 2 minutes before logout
  const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;
  ```

### F-3 — Prompt drift: spec references migration `20260601_add_email_change` and `EMAIL_CHANGE_EXPIRATION_HOURS` env var; constant is a hardcoded literal, not env-configurable — **Low**
- **Location:** `backend/src/services/authService.ts:1174`; migration `backend/prisma/migrations/20260601_add_email_change/migration.sql`.
- **Observation:** The spec (section 8b) implies `EMAIL_CHANGE_EXPIRATION_HOURS` is a configurable knob alongside `PASSWORD_RESET_EXPIRATION_HOURS` and `EMAIL_VERIFICATION_EXPIRATION_HOURS`. In the live code all three are module-level `const` literals, not `process.env` reads (`EMAIL_CHANGE_EXPIRATION_HOURS = 1` is a bare constant). The 1-hour value and SHA-256-hashed-token storage are correct; only the "env var" framing is drift. The migration named in the spec exists and matches (`pending_email`, `email_change_token` unique-indexed, `email_change_expires`).
- **Impact:** None — the 1-hour expiry is enforced exactly as specified. Flagged so the spec doesn't imply an env override that doesn't exist (an operator setting `EMAIL_CHANGE_EXPIRATION_HOURS` in env would have no effect).
- **Fix:** No security change required. Either make the constant `parseInt(process.env.EMAIL_CHANGE_EXPIRATION_HOURS || '1', 10)` to match the spec, or update the spec to note these expirations are compile-time constants.
- **Evidence:**
  ```ts
  const EMAIL_CHANGE_EXPIRATION_HOURS = 1;
  ```

## Checks passed

### 1. JWT Implementation
- [x] Access token expiration ≤15 min — `accessExpiresIn` defaults to 900s at `backend/src/config/index.ts:62`.
- [x] Refresh token expiration ≤7 days — `refreshExpiresIn` defaults to 604800s at `backend/src/config/index.ts:66`.
- [x] Separate secrets for access vs refresh — `accessSecret`/`refreshSecret` are distinct `requireEnv` reads at `backend/src/config/index.ts:61,65`; access verified with `accessSecret` (`auth.ts:92`), refresh with `refreshSecret` (`authService.ts:449`).
- [x] Secrets required via `requireEnv` (no fallback any env); weak values rejected; min 32 chars — `requireEnv` throws on missing (`config/index.ts:18-28`); `BLOCKED_JWT_VALUES` set rejects placeholders (`config/index.ts:241-261`); `MIN_JWT_SECRET_LENGTH = 32` enforced (`config/index.ts:263-277`).
- [x] Validation checks expiration, signature, issuer/audience — `JWT_VERIFY_OPTIONS` pins `algorithms:['HS256'], issuer:'ownmyhealth-api', audience:'ownmyhealth-web'` at `backend/src/config/jwtOptions.ts:9-13`, used in `jwt.verify` at `auth.ts:92`.
- [x] Token `type` field checked — access middleware rejects non-`access` (`auth.ts:95-97`); refresh paths reject non-`refresh` (`authService.ts:450,365`). Cross-secret signing makes a refresh token fail signature against `accessSecret` regardless.

### 2. Password Security
- [x] bcrypt cost ≥12 (default 13) — `bcryptRounds` defaults to 13 at `backend/src/config/index.ts:100`, used in `hashPassword` (`authService.ts:195`).
- [x] Password requirements (≥12, upper/lower/number/special) enforced in `validatePasswordStrength` — `authService.ts:208-228`; mirrored in Zod `strongPassword` (`validation.ts:117-123`).
- [x] Password not logged; demo password explicitly not logged — `initializeDemoUser` comment + log omit password (`authService.ts:1349-1350`).
- [x] Timing-safe comparison via `bcrypt.compare` — `verifyPassword` (`authService.ts:201-203`).
- [x] Unknown-email login still runs a real bcrypt compare against a dummy hash — `attemptLogin` (`authService.ts:780-787`).

### 3. Cookie Security
- [x] `HttpOnly` on access + refresh cookies — `setAccessTokenCookie`/`setRefreshTokenCookie` set `httpOnly:true` (`authController.ts:95,114`).
- [x] `Secure` in production — `config.cookie.secure = NODE_ENV === 'production'` (`config/index.ts:75`), applied in cookie setters (`authController.ts:96,115`).
- [x] `SameSite` configured (explicit override → cross-domain `none` → prod same-domain `strict` → dev `lax`) — `config/index.ts:86-87`.
- [x] Cookie expiry matches token expiry; demo refresh 30 days only non-prod — `setRefreshTokenCookie` gates extended maxAge on `!config.isProduction` (`authController.ts:108-111`).
- [x] Cookies cleared on logout with matching path/domain — `clearAuthCookies` (`authController.ts:126-141`).

### 4. Token Refresh Flow
- [x] Refresh token in HttpOnly cookie; read from cookie on refresh — `authController.ts:374`.
- [x] `POST /api/v1/auth/refresh` issues new access + refresh — route `authRoutes.ts:56`; `refreshTokens` returns a fresh pair (`authService.ts:507`).
- [x] Single-use rotation — old session row deleted, new inserted in same flow — `refreshTokens` deletes locked row (`authService.ts:495`) then `generateTokens` inserts new session (`authService.ts:329-334,308-319`).
- [x] Concurrent refresh serializes via `SELECT ... FOR UPDATE` — `authService.ts:469-474`.
- [x] Old tokens invalidated on logout — refresh session deleted (`revokeRefreshToken`, `authController.ts:422`) + access token blacklisted (`revokeAccessToken`, `authController.ts:434`).
- [x] CSRF token regenerated on refresh — `setCsrfCookie(res)` (`authController.ts:395`); and on login (`authController.ts:348`).

### 5. Frontend Auth State
- [x] `refreshToken()` called BEFORE `getCurrentUser()` on load — `checkAuth` order (`AuthContext.tsx:105,119`).
- [x] Auth state cleared on logout — `setUser(null)` + `clearAuthToken()` (`AuthContext.tsx:183-184`).
- [x] Failed auth → logout — `setOnAuthFailure(() => logout())` (`AuthContext.tsx:240`), wired to 401 path in `apiFetch` (`client.ts:289-291,308-310`).
- [x] Token in memory only; only id/email/role in context — `authToken` is a module variable, no localStorage (`client.ts:64-65`); `User` interface holds only id/email/role (`AuthContext.tsx:48-52`).
- [x] HIPAA inactivity auto-logoff (15-min, 2-min warning; excludes mousemove) — `AuthContext.tsx:40-42,196-203`.
- [x] Idle logout force-reloads to login — `window.location.href = '/?sessionExpired=true'` (`AuthContext.tsx:200-202`).

### 6. Account Lockout
- [x] Failed attempts tracked (`failedLoginAttempts`) — `recordFailedLogin` (`authService.ts:543-561`).
- [x] Locked after 5 attempts (`lockedUntil`) — `shouldLock = newAttempts >= maxLoginAttempts` (`authService.ts:548-549`); default 5 (`config/index.ts:97`).
- [x] Lockout 30 min configurable — `lockoutDuration` default 30 (`config/index.ts:98`).
- [x] Successful login resets counter — `resetFailedLoginAttempts` (`authService.ts:580-592`), called at `authService.ts:843`.
- [x] Lockout checked before password compare — `isAccountLocked` short-circuits before `verifyPassword` (`authService.ts:812-822`).
- [x] Lockout not bypassable via API — only the dev-gated demo path skips it (`authService.ts:729`); all other accounts go through the lockout gate.

### 7. Email Verification Flow
- [x] Verification token generated on registration (32 random bytes) — `generateEmailVerificationToken` = `crypto.randomBytes(32)` (`authService.ts:601-603`), used in `createUser` (`authService.ts:620`).
- [x] 24-hour expiration — `EMAIL_VERIFICATION_EXPIRATION_HOURS = 24` (`authService.ts:27,622`).
- [x] Only SHA-256 hash stored; plaintext only in email link — `hashToken` stored (`authService.ts:621,636`); plaintext returned to caller for the link (`authService.ts:646`).
- [x] Sent via SendGrid — `sendVerificationEmail` (`authController.ts:228`); link built at `emailService.ts:350`.
- [x] Token cleared from URL after read (frontend) — `window.history.replaceState` (`src/App.tsx:121-125`).
- [x] Single-use; `resendVerification` doesn't reveal user existence — token nulled on verify (`authService.ts:905-907`); resend returns generic success when user absent (`authService.ts:941-943`; controller `authController.ts:717-723`).
- [x] Resend endpoint rate limited (`strictAuthLimiter`) — `authRoutes.ts:71-76`.

### 8. Password Reset Flow
- [x] Reset token on forgot-password (32 random bytes) — `generatePasswordResetToken` (`authService.ts:1011-1013,1023`).
- [x] 1-hour expiration — `PASSWORD_RESET_EXPIRATION_HOURS = 1` (`authService.ts:994,1025`).
- [x] Only SHA-256 hash stored — `resetTokenHash` stored (`authService.ts:1024,1048`).
- [x] Forgot-password always returns success (no enumeration) — `authService.ts:1036,1042` + controller generic message (`authController.ts:757-761`).
- [x] Sent via SendGrid — `sendPasswordResetEmail` (`authController.ts:753`; link `emailService.ts:372`).
- [x] Token cleared from URL after read — `src/App.tsx:121-125` (reset-password route).
- [x] Single-use; expired token cleared on lookup — token nulled on success (`authService.ts:1134`); expired token cleared (`authService.ts:1090-1095`).
- [x] All sessions revoked on reset; attempts/lockout reset — `revokeAllUserTokens` (`authService.ts:1143`); `failedLoginAttempts:0, lockedUntil:null` (`authService.ts:1135-1136`).
- [x] Forgot + reset endpoints rate limited (`strictAuthLimiter`) — `authRoutes.ts:79-92`.

### 8b. Email Change Flow
- [x] `POST /auth/change-email` requires auth + re-auth with current password — route `authenticate` (`authRoutes.ts:127-133`); `requestEmailChange` verifies password (`authService.ts:1210-1213`).
- [x] Target checked free; rejects same/in-use — `authService.ts:1216-1221`.
- [x] Confirmation link to NEW address + notice to OLD — `sendEmailChangeConfirmation` + `sendEmailChangeNotice` (`authController.ts:866-868`).
- [x] 1-hour SHA-256-hashed token in `email_change_token`; pending in `pending_email` — `authService.ts:1223-1235`; migration `20260601_add_email_change/migration.sql:7-12`.
- [x] `GET /auth/confirm-email-change` public, run-once guard, strict rate limited — route `strictAuthLimiter` (`authRoutes.ts:96-101`); `confirmedRef` run-once guard (`ConfirmEmailChangePage.tsx:41,44-46`).
- [x] Confirmation re-checks target free, swaps email (marks verified), clears pending, revokes all sessions — `authService.ts:1281-1304`.

### 9. Session Management
- [x] Sessions in PostgreSQL `sessions` table (`Session` model) — `schema.prisma:61-75`.
- [x] Session has id(JTI)/token(truncated 500)/userId/IP/userAgent/expiresAt — `schema.prisma:62-67`; insert at `authService.ts:309-318` (token `.substring(0,500)`).
- [x] Expired sessions cleaned automatically (10-min interval) — `startSessionCleanup` 10-min `setInterval` (`authService.ts:1417-1424`).
- [x] Logout revokes DB session + blacklists access token — `revokeRefreshToken` + `revokeAccessToken` (`authController.ts:422,434`).
- [x] Logout-all revokes all user sessions — `revokeAllUserTokens` (`authController.ts:468`; `authService.ts:424-432`).
- [x] Blacklist swept on same 10-min interval — `sweepRevokedTokens()` in the interval (`authService.ts:1420`; `180-185`).
- [x] Blacklist limitation noted as in-memory/per-instance — documented at `authService.ts:128-140` and `auth.ts:83-89`.
- [x] Session IP via `req.ip` honoring trust proxy — `getSessionMetadata` uses `req.ip` (`authController.ts:81`); `app.set('trust proxy', 1)` (`app.ts:120`).

### 10. Demo Account Security
- [x] Demo login only when `DEMO_ACCOUNT_ENABLED=true` — `demoLogin` guards on `config.demo.enabled` (`authController.ts:592`); `config.demo.enabled` derived from env (`config/index.ts:142`).
- [x] Demo blocked in production (hard-fail) — `config/index.ts:408-414`.
- [x] Demo lockout-bypass gated on `config.isDevelopment` (not just `demo.enabled`) — `attemptLogin` `if (isDemoAccount && config.demo.enabled && config.isDevelopment)` (`authService.ts:729`).
- [x] `isDemoUser`/`isDemoEmail` return false when `DEMO_EMAIL` unset — `authService.ts:264,273`; also `demoProtection.ts:34`.
- [x] Demo refresh duration 30 days only non-prod — `setRefreshTokenCookie` `(isDemo && !config.isProduction)` (`authController.ts:109-111`).
- [x] Demo restricted from sensitive operations — `demoProtection.ts` (role change, admin, user-mod, profile, AI guards `demoProtection.ts:43-175`).

### 11. Rate Limiting
- [x] All auth routes wrapped in `authLimiter` (20/15 min) — `router.use(authLimiter)` (`authRoutes.ts:34`); limiter 20/15min (`rateLimiter.ts:37-50`).
- [x] Login: `strictAuthLimiter` (5/15min per email+IP, `skipSuccessfulRequests`) — route `authRoutes.ts:48-53`; limiter `rateLimiter.ts:53-73`.
- [x] forgot/reset/resend/change-email/confirm-email-change use `strictAuthLimiter` — `authRoutes.ts:71,79,87,96,127`.
- [x] Limiters backed by shared Redis when `REDIS_URL` set, else MemoryStore — `createRateLimitStore` (`rateLimiter.ts:5,17` etc.); config `redis.url` (`config/index.ts:125-127`).
- [x] Per-instance MemoryStore N×limit limitation noted (audit #37) — `rateLimiter.ts:7-14`.
- [x] Eight named limiters exist — standard/auth/strictAuth/upload/sensitive/ai/providerAccessRequest/bulkOperation (`rateLimiter.ts:17,37,53,76,92,108,133,157`).

### Cross-cutting hardening confirmed
- [x] CSRF mounted globally; auth mutations protected — `app.use(csrfProtection)` (`app.ts:216`); constant-time SHA-256 compare (`csrf.ts:164-166`).
- [x] CSRF-exempt `/ai/chat` is genuinely Bearer-only — `aiRoutes.ts:21` uses `requireBearerAuth` (cookie path rejected, `auth.ts:180-220`), matching the exemption contract in `csrf.ts:110-118`.
- [x] No `remainingAttempts` leaked to client (enumeration) — kept server-side; uniform 401 returned (`authController.ts:314-327`).
- [x] Registration is enumeration-safe (generic 201 + equalized bcrypt cost both branches) — `authController.ts:194-250`.
- [x] `jsonwebtoken ^9.0.2` (alg-confusion-patched) + `algorithms:['HS256']` pinned — `package.json` dep; `jwtOptions.ts:10`.
- [x] `npm audit --omit=dev`: 8 moderate advisories, **none** in auth deps (jsonwebtoken/bcryptjs/cookie-parser/express-rate-limit not flagged).

## Unverifiable
- None. Every file, function, and constant named in the spec was located in the live repo and cited above.

## Out of scope
- Detailed review of the 8 moderate npm advisories (non-auth packages) — belongs to the dependency/SCA prompt (10/12), not this auth prompt. Confirmed only that none touch auth libraries.
- RLS policy correctness for the admin-context (`{ isAdmin: true }`) auth lookups (`findUserByEmail`/`findUserById`/refresh) — covered by the RLS/database review prompt; here only verified the context choice is intentional and pre-auth.
- Audit-log content/redaction quality (the auth flows call `auditService.logAuth` throughout) — covered by 05-audit-logging.
- General logging/PHI-redaction of the frontend `authLogger` — covered by 31-logging-observability; spot-checked that auth-flow debug logs are gated (`AuthContext.tsx:109`) and CSRF cookie value is never logged (`client.ts:125-134`).
