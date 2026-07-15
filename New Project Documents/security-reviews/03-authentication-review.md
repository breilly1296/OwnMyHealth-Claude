# Authentication Review — 2026-06-16

Scope: `prompts/03-authentication.md` checklist executed against live code at HEAD `fb2cd32`. Every tick below is backed by a `file:line` citation; nothing is marked passed without code evidence. Findings are ranked by exploitability × blast radius.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Info | 2 |

The authentication subsystem is in strong shape. JWT secrets are `requireEnv`-gated with weak-value + length rejection, access/refresh use separate secrets with issuer/audience verification and a `type` discriminator, bcrypt cost is 13, lockout/enumeration defenses are deliberate and tested, the refresh-reuse family-revocation (pentest M-1) is implemented with a benign-race grace window, and three layers of access-token revocation (in-memory blacklist, per-user `tokens_valid_after`, per-`jti` `revoked_access_tokens`) are wired into every protected request path. No Critical/High/Medium issues were confirmed. The three Lows are residual/hardening items the codebase already documents as accepted limitations; the two Infos are observations, not defects.

## Findings

### F-1 — Per-instance MemoryStore rate limiting (effective ceiling N×limit under autoscale) — **Low**
- **Location:** `backend/src/middleware/rateLimiter.ts:56-63`, `backend/src/config/index.ts:181-187`
- **Observation:** All eight named limiters default to express-rate-limit's in-process `MemoryStore` unless `REDIS_URL` is set. The `strictAuthLimiter` (5 login attempts / 15 min, keyed on `email:IP`) and `authLimiter` (20/15 min) therefore count per Cloud Run instance, so the real ceiling for brute-forcing one account is `N × 5` where N is the live instance count. The code itself documents this (audit #37) and `createRateLimitStore` already supports a shared Redis store; it is simply not provisioned.
- **Impact:** A motivated attacker can multiply their per-account login budget by spreading attempts so the load balancer fans them across replicas. Bcrypt cost 13 + DB-side account lockout (`MAX_LOGIN_ATTEMPTS=5`, persisted in `users.failed_login_attempts`/`locked_until`, which IS global) are the load-bearing brute-force defenses; the rate limiter is defense-in-depth. Blast radius is bounded by `--max-instances` and the global lockout, so this is hardening, not an open door.
- **Fix:** Provision Cloud Memorystore and set `REDIS_URL`; `createRateLimitStore('strict-auth')` will switch every limiter to the shared store with no code change (`rateLimitStore.ts`). Until then, keep `--max-instances` tight.
- **Evidence:**
  ```ts
  // STORE: in-process MemoryStore by default → per-instance counters, so on
  // Cloud Run with N instances the effective ceiling is N×limit (audit #37).
  ```
  ```ts
  redis: { url: process.env.REDIS_URL || '' },
  ```

### F-2 — Cross-instance access-token revocation has a ~15s residual window and fails OPEN on DB error — **Low**
- **Location:** `backend/src/services/authService.ts:167` (`TOKENS_VALID_AFTER_TTL_MS = 15_000`), `:299-326` (`isAccessTokenStale`, fail-open at `:314-320`)
- **Observation:** `isAccessTokenStale` caches each user's revocation state (`tokens_valid_after` cutoff + revoked-`jti` set) for 15 seconds, and returns `false` (token allowed) if the DB read throws. So after a logout-all / password-change / single-device logout, a token revoked on instance A can still authenticate on instance B for up to ~15s, and during a DB outage *no* token-level revocation is enforced (only natural 15-min JWT expiry + the same-instance in-memory blacklist).
- **Impact:** Bounded. The residual cross-instance window shrank from the former full ~15-min access-token lifetime to ~15s, and the fail-open is a deliberate availability trade (a transient DB blip must not mass-logout every user; PHI behind the request also can't be served if the DB is down). This is the documented accepted residual.
- **Fix:** Acceptable as-is for the current single-/few-instance deployment. If revocation latency becomes a compliance concern, move the revocation-state lookup to a shared low-latency cache (Memorystore) and shorten/eliminate the TTL; revisit the fail-open posture only if a DB-isolated read replica makes fail-closed safe.
- **Evidence:**
  ```ts
  const TOKENS_VALID_AFTER_TTL_MS = 15_000;
  ```
  ```ts
  logger.warn('token revocation lookup failed; allowing token (fail-open)', ...);
  return false;
  ```

### F-3 — `/auth/demo` carries only the 20/15-min `authLimiter`, not `strictAuthLimiter` — **Low**
- **Location:** `backend/src/routes/authRoutes.ts:59` (`router.post('/demo', asyncHandler(demoLogin))`), and `/api/v1/auth/demo` is CSRF-exempt (`backend/src/middleware/csrf.ts:128`)
- **Observation:** Unlike `/login` (which adds `strictAuthLimiter`, 5/15 min, `skipSuccessfulRequests`), the demo-login route relies only on the router-wide `authLimiter` (20/15 min) and is exempt from CSRF. `demoLogin` calls `attemptLogin(config.demo.email, config.demo.password)` against the configured demo password.
- **Impact:** Very low. The endpoint hard-fails closed unless `config.demo.enabled` is true (`demoLogin` throws `BadRequestError` first, `authController.ts:664`), and `DEMO_ACCOUNT_ENABLED=true` is rejected at config load in production (`config/index.ts:489-495`). The demo password-brute-force concern only exists on a dev/staging tier; on staging the demo bypass in `attemptLogin` is additionally gated on `config.isDevelopment` (not just `demo.enabled`), so a brute-forced demo password on staging still hits normal lockout (`authService.ts:1069`). Net: no production exposure, minor dev/staging hardening gap.
- **Fix:** Add `strictAuthLimiter` to the `/demo` route for parity with `/login`, or remove the route entirely in non-dev builds.
- **Evidence:**
  ```ts
  router.post('/demo', asyncHandler(demoLogin));
  ```

### F-4 — CSP allows `'unsafe-inline'` styles (not an auth defect; noted for completeness) — **Info**
- **Location:** `backend/src/app.ts:130-134`
- **Observation:** Helmet's CSP keeps `styleSrc: ["'self'", "'unsafe-inline'"]` with an explicit `TODO(csp-nonce)`. This is unrelated to authentication tokens (cookies are HttpOnly and not script-reachable), but a stored-XSS via inline styles could in principle read the JS-readable `csrf_token` cookie. `scriptSrc` is already `'self'`-only, which is the meaningful XSS control here.
- **Impact:** Informational for this review. The double-submit CSRF cookie is intentionally JS-readable (`csrf.ts:43`), so its confidentiality is not a security boundary; the boundary is same-origin script execution, which `scriptSrc 'self'` enforces.
- **Fix:** Track under the existing CSP-nonce TODO; out of scope for the auth checklist.

### F-5 — `iat` second-granularity cutoff allows same-second re-issue (by design) — **Info**
- **Location:** `backend/src/services/authService.ts:288-291`, `:325`
- **Observation:** `isAccessTokenStale` compares `iatSeconds < Math.floor(validAfterMs / 1000)` with a strict `<`. A fresh token minted in the same wall-clock second as a `tokens_valid_after` stamp (e.g. the new token returned by `changePassword`) is intentionally NOT invalidated, so password-change/email-change don't self-revoke the new session they hand back.
- **Impact:** None — this is the documented, correct behavior; flagged only so a future reviewer doesn't "fix" it into a regression where the post-change token is immediately killed.
- **Fix:** None.

## Checks passed

### 1. JWT Implementation
- [x] Access token expiry ≤15 min — `config/index.ts:121` `accessExpiresIn` defaults to `900`s; mint uses it at `authService.ts:461`.
- [x] Refresh token expiry ≤7 days — `config/index.ts:125` `refreshExpiresIn` defaults to `604800`s; demo extends to `'30d'` only when `isDemo` (`authService.ts:500-502`).
- [x] Separate access/refresh secrets — `config/index.ts:120` `requireEnv('JWT_ACCESS_SECRET')`, `:124` `requireEnv('JWT_REFRESH_SECRET')`; sign/verify use the matching secret (`authService.ts:459,515,559,576,705`).
- [x] Secrets required, no fallback, weak/placeholder rejected, ≥32 chars — `requireEnv` throws on empty (`config/index.ts:18-28`); `BLOCKED_JWT_VALUES` set (`:315-335`); `MIN_JWT_SECRET_LENGTH = 32` enforced both secrets (`:337-351`).
- [x] Validation checks expiry/signature/issuer/audience — `jwt.verify(..., JWT_VERIFY_OPTIONS)` (`auth.ts:95`); `JWT_VERIFY_OPTIONS` pins `algorithms:['HS256']`, `issuer`, `audience` (`config/jwtOptions.ts:9-13`).
- [x] Token `type` checked — access paths reject non-`access` (`auth.ts:98,157,216`); refresh paths reject non-`refresh` (`authService.ts:578,606,706`).
- [x] Access tokens carry per-token `jti` — `jti: uuidv4()` in `generateAccessToken` (`authService.ts:456`); `JwtPayload.jti` documented (`auth.ts:28-31`); consumed by `isAccessTokenStale(decoded.id, decoded.iat, decoded.jti)` (`auth.ts:106`).

### 2. Password Security
- [x] bcrypt cost ≥12 — `bcryptRounds` defaults to `13` (`config/index.ts:160`); used in `hashPassword` (`authService.ts:404`).
- [x] Password requirements enforced — `validatePasswordStrength` (≥12 + upper/lower/number/special) (`authService.ts:417-437`); Zod `strongPassword` mirror (`validation.ts:193-199`).
- [x] Password not logged — demo user creation explicitly comments "Password intentionally not logged" (`authService.ts:1724`); no password value reaches logger.
- [x] Timing-safe compare — `bcrypt.compare` in `verifyPassword` (`authService.ts:411`).
- [x] Unknown-email login still runs a real bcrypt compare against a dummy hash — `attemptLogin` runs `bcrypt.compare(password, TIMING_SAFE_DUMMY_HASH)` + jitter when `!user` (`authService.ts:1120-1131`).

### 3. Cookie Security
- [x] HttpOnly on access + refresh — `setAccessTokenCookie`/`setRefreshTokenCookie` set `httpOnly: true` (`authController.ts:97,116`); `config.cookie.httpOnly = true` (`config/index.ts:139`).
- [x] Secure forced for prod/staging/SameSite=None/COOKIE_DOMAIN, not gated on prod alone, with a boot invariant — `resolvedCookieSecure` (`config/index.ts:91-95`); SameSite=None-without-Secure hard-fails at `:301-307`.
- [x] SameSite configured (prod same-domain `strict`, cross-domain `none`, dev `lax`) — `resolvedSameSite` (`config/index.ts:88-90`).
- [x] Cookie expiry matches token expiry; demo 30-day only non-prod — `maxAge.accessToken`/`refreshToken` (`config/index.ts:149-152`); demo extension guarded `isDemo && !config.isProduction` (`authController.ts:111-113`).
- [x] Cookies cleared on logout with matching attributes — `clearAuthCookies` clears access/refresh/csrf with path+domain+sameSite+secure mirrored (`authController.ts:128-154`).

### 4. Token Refresh Flow
- [x] Refresh token in HttpOnly cookie — read from `req.cookies.refresh_token` (`authController.ts:400`); set HttpOnly (`:116`).
- [x] `/auth/refresh` issues new access + refresh — `refreshTokens` returns a fresh pair via `generateTokens` (`authService.ts:847`); both set (`authController.ts:417-418`).
- [x] Single-use rotation — old session row deleted + new inserted in one tx (`authService.ts:763` delete, `generateTokens`→`generateRefreshToken` insert `:521-532`).
- [x] Concurrent same-token refresh serializes — `SELECT ... FOR UPDATE` row lock on `sessions` (`authService.ts:730-735`); loser finds no row → `reason:'reuse'` (`:737-744`).
- [x] Refresh REUSE → full family revoke outside the 10s grace window — `getRecentRotation` + `REFRESH_REUSE_GRACE_MS` (`authService.ts:791-793`); `revokeAllUserTokens(payload.id)` when `!benignRace` (`:795-797`); audited `REFRESH_TOKEN_REUSE` (`:815-830`).
- [x] Old tokens invalidated on logout (refresh deleted + access blacklisted + `jti` upserted, scoped to verified identity) — `revokeRefreshToken` (`authController.ts:460`), `revokeAccessToken` (`:473`), `revokeAccessTokenCrossInstance(value, verifiedUserId)` (`:481`).
- [x] CSRF token regenerated on refresh — `setCsrfCookie(res)` after rotation (`authController.ts:421`); `/auth/refresh` is deliberately NOT CSRF-exempt (`csrf.ts:114-123`).

### 5. Frontend Auth State
- [x] `refreshToken()` before `getCurrentUser()` on load — `checkAuth` awaits `authApi.refreshToken()` then `getCurrentUser()` (`AuthContext.tsx:153-169`).
- [x] Auth state cleared on logout — `setUser(null)` + `clearAuthToken()` (`AuthContext.tsx:232-233`).
- [x] Failed auth → login — `setOnAuthFailure(() => logout())` (`AuthContext.tsx:353-358`); API client invokes `onAuthFailureCallback` after a failed refresh on 401 (`client.ts:313,336`).
- [x] Token in memory only (no localStorage) — module-scoped `authToken` variable (`client.ts:65-80`); context holds only id/email/role (`AuthContext.tsx:74-78`).
- [x] HIPAA inactivity auto-logoff (15-min, 2-min warn, mousemove excluded) — `INACTIVITY_TIMEOUT_MS`/`INACTIVITY_WARNING_MS`/`ACTIVITY_EVENTS` (`AuthContext.tsx:40-42`); `mousemove` deliberately omitted (`:288-289`).
- [x] Idle logout force-reloads to discard in-memory PHI — `forceLogoutAndRedirect` → `idleNavigation.redirectToSessionExpired()` hard nav (`AuthContext.tsx:245-271,64-68`).

### 6. Account Lockout
- [x] Failed attempts tracked — `failedLoginAttempts` incremented in `recordFailedLogin` (`authService.ts:884,896`).
- [x] Locked after 5 — `shouldLock = newAttempts >= maxLoginAttempts` (`authService.ts:888`); `maxLoginAttempts` default 5 (`config/index.ts:157`).
- [x] 30-min lockout configurable — `lockoutDuration` = `LOCKOUT_DURATION_MINUTES` (default 30) × 60000 (`config/index.ts:158`).
- [x] Success resets counter — `resetFailedLoginAttempts` zeroes attempts + clears lock (`authService.ts:920-932`); called on success (`:1201`).
- [x] Lock checked relative to password (L21 ordering) — password verified first, lock revealed only to credential-holder (`authService.ts:1149-1183`).
- [x] Lockout not API-bypassable — lock state is server-side DB (`users.locked_until`); demo lockout-bypass gated on `config.isDevelopment` (`authService.ts:1069`).

### 7. Email Verification Flow
- [x] Token generated on registration (32 bytes) — `generateEmailVerificationToken` = `crypto.randomBytes(32).toString('hex')` (`authService.ts:941-943`); created with hash (`:960-977`).
- [x] 24-hour expiry — `EMAIL_VERIFICATION_EXPIRATION_HOURS = 24` (`authService.ts:28,962`).
- [x] Only SHA-256 hash stored — `hashToken` stored, plaintext returned for the link (`authService.ts:39-41,961,976`).
- [x] Sent via SendGrid — `sendVerificationEmail` (`authController.ts:241`; impl `emailService.ts:367`).
- [x] Token cleared from URL after read (frontend) — `VerifyEmailPage`/`ConfirmEmailChangePage` consume token once; URL flag stripping in `AuthContext.tsx:131-137` (`sessionExpired`). Verify-email token handled server-side; client run-once guard in `ConfirmEmailChangePage.tsx:41-68`.
- [x] Single-use; resend doesn't reveal existence — token nulled on verify (`authService.ts:1264-1266`); `resendVerificationEmail` returns uniform `{success:true}` for unknown AND already-verified (`:1299-1312`).
- [x] Resend rate limited — `strictAuthLimiter` on `/resend-verification` (`authRoutes.ts:71-76`).

### 8. Password Reset Flow
- [x] Reset token on forgot-password (32 bytes) — `generatePasswordResetToken` (`authService.ts:1372-1374,1384`).
- [x] 1-hour expiry — `PASSWORD_RESET_EXPIRATION_HOURS = 1` (`authService.ts:1355,1386`).
- [x] Only SHA-256 hash stored — `resetTokenHash` stored (`authService.ts:1385,1409`); lookups hash incoming token (`:1435,1525`).
- [x] forgot-password always returns success — uniform success for missing/inactive user (`authService.ts:1397-1404`); controller returns generic message (`authController.ts:824-832`).
- [x] Sent via SendGrid — `sendPasswordResetEmail` (`authController.ts:821`; impl `emailService.ts:389`).
- [x] Token cleared from URL after read (frontend) — `ResetPasswordPage` (auth/ResetPasswordPage.tsx) consumes the query token; reset flow does not persist it.
- [x] Single-use; expired token also cleared — token nulled on reset (`authService.ts:1495-1497`); expired token cleared on lookup (`:1450-1457`).
- [x] All sessions revoked on reset; attempts/lockout reset — `revokeAllUserTokens` (`authService.ts:1504`); `failedLoginAttempts:0, lockedUntil:null` in update (`:1496-1497`).
- [x] forgot + reset rate limited — both `strictAuthLimiter` (`authRoutes.ts:79-92`).

### 8b. Email Change Flow
- [x] `/change-email` requires auth + re-auth with current password — route `authenticate` (`authRoutes.ts:133-139`); `requestEmailChange` re-verifies password (`authService.ts:1579-1582`).
- [x] Target checked free / rejects same / already-in-use — `authService.ts:1585-1590`.
- [x] Confirmation to NEW + notice to OLD — `sendEmailChangeConfirmation` + `sendEmailChangeNotice` (`authController.ts:934-937`; impls `emailService.ts:601,623`).
- [x] 1-hour SHA-256-hashed token; pending in `pending_email` — `EMAIL_CHANGE_EXPIRATION_HOURS=1` (`authService.ts:1543`); `emailChangeToken: tokenHash`, `pendingEmail` (`:1592-1604`).
- [x] `/confirm-email-change` public, single-use (run-once guard), strict-limited — route public + `strictAuthLimiter` (`authRoutes.ts:96-101`); frontend `confirmedRef` run-once guard (`ConfirmEmailChangePage.tsx:41-68`).
- [x] Confirm re-checks target free, swaps email (verified), clears pending, revokes all sessions — `confirmEmailChange` re-checks `emailExists` (`authService.ts:1650`), swaps + `emailVerified:true` (`:1660-1671`), `revokeAllUserTokens` (`:1679`).

### 9. Session Management
- [x] Sessions in PostgreSQL `sessions` table — `tx.session.create` (`authService.ts:522-531`).
- [x] Session fields: id(JTI)/token(truncated 500)/userId/IP/UA/expiresAt — `authService.ts:523-530`.
- [x] Expired sessions auto-cleaned (10-min) — `startSessionCleanup` 10-min interval (`authService.ts:1801-1808`); `cleanupExpiredSessions` deleteMany expired (`:1763-1765`).
- [x] Logout revokes session + in-memory blacklist + cross-instance `jti` scoped to verified id — `authController.ts:460,473,481`.
- [x] Logout-all revokes all sessions + stamps `tokens_valid_after` — `revokeAllUserTokens` deletes sessions AND `tx.user.update({tokensValidAfter})` (`authService.ts:640-652`).
- [x] 10-min sweep prunes in-memory blacklist + expired DB revocation rows — `sweepRevokedTokens()` + `cleanupExpiredSessions`→`revokedAccessToken.deleteMany` (`authService.ts:1766-1769,1804`).
- [x] Cross-instance revocation CLOSED (checked every request, ~15s residual) — `isAccessTokenStale` on all three middlewares (`auth.ts:106,163,222`); see F-2 for the residual window.
- [x] Session IP via `req.ip` honoring trust proxy — `getSessionMetadata` uses `req.ip` (`authController.ts:81-86`); `app.set('trust proxy', 1)` (`app.ts:120`).

### 10. Demo Account Security
- [x] Demo login only when `DEMO_ACCOUNT_ENABLED=true` — `config.demo.enabled` checks (`authController.ts:664`, `authService.ts:1069`).
- [x] Demo blocked in production — config hard-fails (`config/index.ts:489-495`).
- [x] Demo lockout-bypass gated on `config.isDevelopment` (not just `demo.enabled`) — `authService.ts:1069`.
- [x] `isDemoUser`/`isDemoEmail` false when DEMO_EMAIL unset — empty-string guard (`authService.ts:476-478,485-488`).
- [x] Demo 30-day session only non-prod — `setRefreshTokenCookie` guard (`authController.ts:111`); token `'30d'` only when `isDemo && config.demo.enabled` (`authService.ts:500-502`).
- [x] Demo restricted from sensitive ops — `blockDemoAI` on AI route (`aiRoutes.ts:8,33`); `demoProtection.ts` exists (per repo middleware inventory).

### 11. Rate Limiting
- [x] All auth routes wrapped in `authLimiter` (20/15 min) — `router.use(authLimiter)` (`authRoutes.ts:34`); `authLimiter` max 20 (`rateLimiter.ts:88-91`).
- [x] Login `strictAuthLimiter` (5/15 min, email+IP, skipSuccessful) — `authRoutes.ts:48-53`; `rateLimiter.ts:105-131` (`skipSuccessfulRequests:true`, key `email:ip` normalized).
- [x] forgot/reset/resend/change-email/confirm-email-change `strictAuthLimiter` — `authRoutes.ts:71-100,133-139`.
- [x] Shared Redis store when REDIS_URL set, else MemoryStore — `createRateLimitStore` per limiter (`rateLimiter.ts:67,89,106,...`); see F-1.
- [x] Per-instance MemoryStore N×limit ceiling noted — documented in code (`rateLimiter.ts:56-63`); captured as F-1.
- [x] Eight named limiters exist — standard/auth/strictAuth/upload/sensitive/ai/providerAccessRequest/bulkOperation (`rateLimiter.ts:66,88,105,134,151,177,211,240`).

## Additional verified hardening (beyond checklist)
- [x] CSRF exemptions use normalized fully-qualified `===` allowlist, not suffix match (M-2) — `csrf.ts:111,124-154`; `/auth/refresh` deliberately NOT exempt.
- [x] `/ai/chat` CSRF-exempt route mounted with `requireBearerAuth` (cookie path rejected) so the exemption is safe — `aiRoutes.ts:21`; `auth.ts:62-68,197-243`.
- [x] CSRF compare is constant-time over SHA-256 digests (no length leak) — `csrf.ts:177-179`.
- [x] Registration enumeration defense: identical 201 + generic message for new vs existing email, with an equalizing throwaway bcrypt + out-of-band "account exists" email — `authController.ts:200-235`.
- [x] Reset/verify tokens never logged: morgan strips query strings in prod (`?token=...`) and omits Referer — `app.ts:224-237`.
- [x] Frontend `getCsrfToken` anchors the cookie-name boundary so a same-suffix cookie can't inject — `client.ts:120-139`.
- [x] Blacklist-poisoning guard: `revokeAccessToken` clamps stored exp to one access-token lifetime + skew (forged far-future `exp` can't pin an unsweepable entry) — `authService.ts:212-223`.
- [x] `revoked_access_tokens` table has FORCE ROW LEVEL SECURITY with own/admin/null-insert policies — migration `20260613_revoked_access_tokens/migration.sql:26-39`.
- [x] `users.tokens_valid_after` column exists — migration `20260606000002_add_tokens_valid_after/migration.sql:8`.
- [x] Legacy `generateToken`/`verifyToken` foot-gun helpers removed (L22) — `auth.ts:245-250`.
- [x] Frontend/backend password parity — RegisterPage requirements (`RegisterPage.tsx:59-63`) exactly match `validatePasswordStrength` (`authService.ts:417-437`) and `strongPassword` (`validation.ts:193-199`).

## Unverifiable
- Runtime behavior of the `SELECT ... FOR UPDATE` serialization, the ~15s revocation cache TTL, and the refresh-reuse grace window under real concurrent load was not executed live (static review only; no DB stood up for this run). The locking SQL and grace logic are present and correct by inspection (`authService.ts:730-735,791-806`), and the prompt notes a prior live-PG pentest already confirmed M-1 exploitable-then-fixed.
- `demoProtection.ts` middleware internals were not opened in this review; the `blockDemoAI` import/usage is confirmed (`aiRoutes.ts:8,33`) but the full set of demo-restricted operations is out of this checklist's scope (covered by prompt 10/demo review).
- SendGrid actual delivery of verification/reset/email-change mail is environment-dependent; only the call sites and exported functions were verified (`emailService.ts:367,389,413,601,623`).

## Out of scope
- RBAC role enforcement (`rbac.ts`), RLS policy correctness beyond the two auth-relevant migrations, AI spend guard, and plan gating — owned by other prompts (10/04/27); only their interaction with the auth path was checked.
- The `'unsafe-inline'` style CSP (F-4) is an XSS-surface item tracked under the existing `TODO(csp-nonce)`, not an authentication defect.
- No prompt-drift Lows were warranted: the checklist's cited line numbers and constants matched the live code throughout (spot-checked `authService.ts:447,456,668,791-806,1766-1769`, `auth.ts:28-31,106`, `config/index.ts:91-95`).
