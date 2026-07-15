---
tags:
  - security
  - auth
  - high
type: prompt
updated: 2026-06-16
severity: High
---

> Follow the [review protocol](./_review-protocol.md).
> For PHI fields stored in audit rows, see [PHI inventory](./_phi-inventory.md) — `AuditLog.previousValueEncrypted` / `newValueEncrypted` / `metadataEncrypted`.
> Use [Claude Code tools](./_verification-tools.md).

# Cross-Instance Token / Session Revocation Review

> **Scope.** This is the deep single-domain owner for **token & session
> revocation across Cloud Run replicas** — the subsystem rebuilt entirely after
> 2026-06-01. [[03-authentication]] owns the broader auth surface (login, lockout,
> password reset, email change, cookies, demo gating) and now only *survey-level*
> covers revocation; its "in-memory blacklist, per-instance" description is
> **stale** and superseded by this file. Do **not** re-audit login/lockout/cookie
> mechanics here — cross-link [[03-authentication]] for those. This prompt goes
> deep on: the access-JWT `jti`, the DB-backed `tokens_valid_after` per-user
> cutoff, single-device `revoked_access_tokens` revocation + its RLS/FORCE
> policies, refresh-rotation reuse → family revoke, the ~15s revocation-state
> cache (and its staleness window), audit coverage, and the fail-open/fail-closed
> posture.

## Files to Review
- `backend/src/services/authService.ts` — the revocation core:
  - in-memory same-instance blacklist `revokedTokens` Map + `revokeAccessToken`
    (`authService.ts:212`), `isTokenRevoked` (`:230`), `sweepRevokedTokens`
    (`:239`); the exp-clamp + `REVOKED_TOKEN_EXP_SKEW_MS` poisoning guard
    (`:181`, `:202-223`)
  - cross-instance cutoff + jti cache: `TOKENS_VALID_AFTER_TTL_MS = 15_000`
    (`:167`), `tokensValidAfterCache` Map (`:173`), `fetchUserRevocationState`
    (`:259`), `isAccessTokenStale` (`:299`), `invalidateTokensValidAfterCache`
    (`:334`)
  - single-device cross-instance revoke: `revokeAccessTokenCrossInstance`
    (`:358`) — jti+identity guards, exp clamp, `revokedAccessToken.upsert`
    under `withRLSContext(verifiedUserId)`
  - access-JWT minting with `jti: uuidv4()` in `generateAccessToken` (`:446-457`)
  - logout-all / cutoff stamp: `revokeAllUserTokens` (`:637`) — session wipe +
    `tokensValidAfter: new Date()` in one tx + cache invalidation
  - refresh rotation + reuse → family revoke: `refreshTokens` (`:700`),
    `markRecentRotation` (`:671`), `getRecentRotation` (`:685`),
    `REFRESH_REUSE_GRACE_MS = 10_000` (`:668`), the `reuse`/`expired`/`inactive`
    discriminated result and the `LOGIN_FAILED` / `REFRESH_TOKEN_REUSE` audit
    (`:776-841`)
  - DB-backed cleanup of expired sessions AND expired revoked-jti rows:
    `cleanupExpiredSessions` (`:1753`), swept on the 10-min interval
    `startSessionCleanup` (`:1792`)
- `backend/src/middleware/auth.ts` — every protected entrypoint enforces both
  layers: `authenticate` runs `isTokenRevoked` (`auth.ts:90`) then
  `await isAccessTokenStale(decoded.id, decoded.iat, decoded.jti)` (`:106`);
  same checks in `optionalAuth` (`:150`, `:163`) and `requireBearerAuth`
  (`:210`, `:222`); `jti?` on the `JwtPayload` (`:30`); the L22 note that the
  unsafe legacy `verifyToken` was removed (`:245-250`)
- `backend/src/controllers/authController.ts` — `logout` (`:439`):
  `revokeAccessToken` + `revokeAccessTokenCrossInstance(accessTokenValue, verifiedUserId)`
  scoped to the verified identity (`:471-483`); `logoutAll` (`:508`) →
  `revokeAllUserTokens`; `changePassword` (`:569`) → `revokeAllUserTokens` +
  same-instance `revokeAccessToken` of the current request token (`:608-623`);
  the M-4 "cutoff stamped by revokeAllUserTokens" comments on change-password,
  reset, email-change paths
- `backend/src/routes/authRoutes.ts` — `POST /logout` uses **optionalAuth**
  (`authRoutes.ts:114`) so the HIPAA idle-logoff (fires at access-token expiry)
  still reaches revocation; `POST /logout-all` uses `authenticate` (`:117`)
- `backend/src/routes/adminRoutes.ts` — admin-triggered stamping:
  `updateUser` folds `tokensValidAfter = new Date()` into the same `user.update`
  when password/role/deactivation changes (`adminRoutes.ts:308-322`) then
  `invalidateTokensValidAfterCache(id)` (`:363`); `deleteUser` (deactivate)
  stamps the cutoff + wipes sessions in one tx (`:463-483`) then invalidates the
  cache (`:485`); import at `adminRoutes.ts:20`
- `backend/prisma/schema.prisma` — `User.tokensValidAfter` (`schema.prisma:36`,
  `@map("tokens_valid_after")`), `User.revokedAccessTokens` relation (`:60`),
  `model RevokedAccessToken` (`:96-106`: `jti` UUID PK, `userId` FK CASCADE,
  `expiresAt`, `createdAt`, indexes on `userId` + `expiresAt`)
- `backend/prisma/migrations/20260606000002_add_tokens_valid_after/migration.sql`
  — `ALTER TABLE "users" ADD COLUMN "tokens_valid_after" TIMESTAMPTZ(6)`
  (`migration.sql:8`)
- `backend/prisma/migrations/20260613_revoked_access_tokens/migration.sql` —
  table DDL (`migration.sql:11-16`) + indexes (`:18-19`) + `ENABLE`/`FORCE ROW
  LEVEL SECURITY` (`:26-27`) + the three policies select/insert/delete-own
  (`:29-39`), where the INSERT policy `WITH CHECK (user_id = current_user_id()
  OR is_admin_session() OR current_user_id() IS NULL)` (`:35`) admits the
  expired-logout path

## OwnMyHealth Revocation Architecture
- **Two access-token layers, by design.** (1) An in-process `revokedTokens` Map
  (`authService.ts:156`) keyed by raw token string → expiry — stops a token
  **immediately on this instance** but does NOT span replicas or survive restart.
  (2) A **DB-backed** layer read by `isAccessTokenStale` (`authService.ts:299`)
  that spans **every** Cloud Run replica: a per-user `tokensValidAfter` cutoff
  (logout-all / password change+reset / email change / admin
  deactivate+role-change) AND a per-`jti` `revoked_access_tokens` set
  (single-device logout). The middleware runs both on every protected request
  (`auth.ts:90`, `:106`).
- **`jti` on every access token.** `generateAccessToken` mints `jti: uuidv4()`
  (`authService.ts:456`) so one device's access token can be revoked
  cross-instance WITHOUT stamping the per-user cutoff (which would log the user
  out of all their other devices). Tokens minted before this change carry no
  `jti` and are matched only by the cutoff (`isAccessTokenStale` `:323`).
- **`tokens_valid_after` (per-user cutoff).** A nullable `TIMESTAMPTZ`
  (`schema.prisma:36`; `migration.sql:8`). NULL = no cutoff (the common case).
  When stamped, `isAccessTokenStale` rejects any access JWT whose `iat`
  (whole-second) is strictly `<` `floor(validAfterMs/1000)` (`authService.ts:325`)
  — strict `<` at second granularity so a token re-issued in the SAME wall-clock
  second as the cutoff (the fresh pair a password change hands back) survives.
- **`revoked_access_tokens` (single-device).** A table keyed by the access
  token's `jti` (`schema.prisma:96`), populated by
  `revokeAccessTokenCrossInstance` (`authService.ts:358`). Rows expire at the
  token's own (clamped) exp and are swept by `cleanupExpiredSessions`
  (`:1766`).
- **One cached round-trip.** `fetchUserRevocationState` (`authService.ts:259`)
  reads the cutoff and the live revoked-jti set in a single `withRLSContext(userId)`
  `Promise.all`. The result is cached per user for `TOKENS_VALID_AFTER_TTL_MS =
  15_000` (`:167`). Same-instance propagation is immediate (every stamping path
  calls `invalidateTokensValidAfterCache`); cross-instance convergence is bounded
  by the ~15s TTL.
- **Refresh rotation + reuse detection.** `refreshTokens` (`authService.ts:700`)
  locks the session row `SELECT ... FOR UPDATE`, deletes it, and inserts a new
  one in one transaction so two concurrent refreshes can't both win. A
  signature-valid refresh token whose `jti` is no longer the live session is
  **reuse**: outside the `REFRESH_REUSE_GRACE_MS = 10_000` window it triggers full
  family revoke (`revokeAllUserTokens` → sessions + cutoff); inside the window it
  is treated as a benign double-tab race and the freshly-minted session is left
  intact (`:776-806`).
- **Fail posture.** `isAccessTokenStale` **fails OPEN** on a DB error
  (`authService.ts:314-320`): a transient blip must not mass-logout users, and a
  stale token can't reach PHI during a real DB outage anyway. The
  refresh-reuse-family-revoke and the cross-instance jti write are **best-effort**
  (logged, not thrown) so logout/refresh still complete. The `revoked_access_tokens`
  table itself is **FORCE RLS** fail-closed (`migration.sql:27`).

## Checklist

### 1. Access-Token Model + `jti`
- [ ] Every access token carries a unique `jti`: `generateAccessToken` sets
  `jti: uuidv4()` in the signed payload (`authService.ts:456`); the middleware
  reads `decoded.jti` and passes it to `isAccessTokenStale` (`auth.ts:106`,
  `:163`, `:222`)
- [ ] `jti` is OPTIONAL end-to-end so pre-M1 tokens still authenticate: the
  `JwtPayload.jti?` (`auth.ts:30`) and `isAccessTokenStale(userId, iat, jti?)`
  (`authService.ts:299`) — a token with no `jti` is matched only by the cutoff
  and still expires naturally within the 15-min lifetime
- [ ] Access-token lifetime is derived from the SAME config used to sign
  (`accessTokenLifetimeMs` reads `config.jwt.accessExpiresIn`,
  `authService.ts:190-194`) so clamp windows can't drift from the real exp
- [ ] The unsafe legacy `verifyToken`/`generateToken` helpers were removed (they
  did a bare `jwt.verify` with NO revocation check) — confirm nothing reintroduced
  a verify path that skips `isTokenRevoked` + `isAccessTokenStale`
  (`auth.ts:245-250`)
- [ ] `verifyAccessToken` (`authService.ts:552`) — if any caller still uses it,
  confirm it consults the in-memory `revokedTokens` (`:555`); note it does NOT
  consult the DB layer, so it must not be the sole gate on a protected route
  (the real gate is the middleware)

### 2. Per-User Cutoff `tokens_valid_after` — every stamping event
Confirm `revokeAllUserTokens` (`authService.ts:637`) or an equivalent
`user.update({ tokensValidAfter: new Date() })` fires on EACH of these, and that
each path also drops the cache (`invalidateTokensValidAfterCache`):
- [ ] **Logout-all** — `logoutAll` → `revokeAllUserTokens(authReq.user.id)`
  (`authController.ts:519`); the service wipes sessions AND stamps the cutoff in
  ONE `withRLSContext` tx (`authService.ts:640-652`) then invalidates the cache
  (`:654`)
- [ ] **Password change** — `changePassword` → `revokeAllUserTokens(user.id)`
  (`authController.ts:608`); the M-4 comment confirms the cutoff stamp is what
  closes the cross-device gap (`:624-629`)
- [ ] **Password reset** — `resetPassword` → `revokeAllUserTokens(updatedUser.id)`
  (`authService.ts:1504`); public token flow with no request access token, so the
  DB cutoff is the only cross-device mechanism (`:1506-1512`)
- [ ] **Email change confirm** — `confirmEmailChange` → `revokeAllUserTokens`
  (`authService.ts:1679`); same public-flow rationale (`:1673-1678`)
- [ ] **Admin deactivate / role change / admin password reset** — `updateUser`
  computes `mustRevoke = !!password || roleChanged || deactivated` and folds
  `updateData.tokensValidAfter = new Date()` into the SAME `user.update`
  (`adminRoutes.ts:317-322`), then `invalidateTokensValidAfterCache(id)` (`:363`);
  `deleteUser` stamps `tokensValidAfter` + wipes sessions in one tx (`:478-481`)
  then invalidates (`:485`)
- [ ] The cutoff comparison is correct: strict `<` at whole-second granularity
  (`iatSeconds < Math.floor(validAfterMs/1000)`, `authService.ts:325`) so the
  fresh token a change/reset hands back (issued at/after the cutoff second) is NOT
  invalidated; `validAfterMs === 0` short-circuits to "no cutoff" (`:324`)

### 3. Single-Device Revocation via `revoked_access_tokens` + RLS
- [ ] Single-device logout records the jti cross-instance: `logout` calls
  `revokeAccessTokenCrossInstance(accessTokenValue, verifiedUserId)`
  (`authController.ts:481`), and it does NOT stamp the per-user cutoff (which
  would kill the user's other devices)
- [ ] **Identity guard** — `revokeAccessTokenCrossInstance` only writes a row when
  the decoded token's `id` matches `verifiedUserId` (`authService.ts:369`); the
  caller resolves `verifiedUserId` from the verified access token OR the
  signature-checked refresh session (`authController.ts:479`), so a forged token
  (`jwt.decode` does NOT verify the signature) cannot seed revocations for an
  arbitrary user
- [ ] **Exp clamp** — `expiresAt` is the token's own `exp` clamped to one
  access-token lifetime + skew (`authService.ts:373-374`) so a forged far-future
  `exp` can't pin an unsweepable row; an already-expired token is skipped (`:371`)
- [ ] The write is `upsert` keyed by `jti` under `withRLSContext(verifiedUserId)`
  (`authService.ts:377-383`) — RLS-scoped to the owner, idempotent on replay
- [ ] **RLS + FORCE** on `revoked_access_tokens`: `ENABLE` + `FORCE ROW LEVEL
  SECURITY` (`migration.sql:26-27`), select/insert/delete policies scoped to
  `user_id = current_user_id() OR is_admin_session()` (`:29-39`)
- [ ] **Expired-logout INSERT path** — the INSERT policy additionally admits
  `current_user_id() IS NULL` (`migration.sql:35`) so the `optionalAuth` logout
  route (which can run with an EXPIRED access token, i.e. no established user
  context — `authRoutes.ts:114`) can still record the revocation; confirm this
  NULL branch is intentional and matches the `sessions`/`audit_logs` insert
  pattern, not an accidental open-write
- [ ] Same-instance immediacy: after the DB write, `revokeAccessTokenCrossInstance`
  calls `invalidateTokensValidAfterCache(verifiedUserId)` (`authService.ts:387`)
  so the next request on THIS instance re-reads the new jti
- [ ] Expired revoked-jti rows are reaped: `cleanupExpiredSessions` deletes
  `revokedAccessToken` rows past `expiresAt` (`authService.ts:1766-1769`) on the
  10-min interval (`:1801-1808`); the schema indexes `expiresAt` (`schema.prisma:104`)

### 4. Refresh Rotation + Reuse → Family Revoke + Grace
- [ ] Rotation is single-use + atomic: `SELECT ... FOR UPDATE` row lock, delete,
  re-insert in one `withRLSTransaction` (`authService.ts:730-763`); a racing
  refresh of the same jti finds the row gone and lands in the `reuse` branch
- [ ] The transaction returns a discriminated `reuse | expired | inactive` so the
  caller can act per-case (`authService.ts:722`, `:738-758`); `expired` and
  `inactive` fall through to a plain 401 with NO family action (`:838-840`)
- [ ] Reuse OUTSIDE the grace window → **full family revoke**:
  `revokeAllUserTokens(payload.id)` (sessions + cutoff, cross-instance)
  (`authService.ts:795-797`); a revoke failure is logged, not thrown, and does
  not change the 401 (`:798-805`)
- [ ] Reuse INSIDE `REFRESH_REUSE_GRACE_MS = 10_000` → benign double-tab race,
  family NOT revoked, freshly-minted session left intact (`authService.ts:668`,
  `:791-806`)
- [ ] The rotation mark is recorded INSIDE the tx before the row lock releases
  (`markRecentRotation(payload.jti)`, `authService.ts:770`) so the racing reuse is
  guaranteed to observe it; `getRecentRotation` is a non-deleting peek so a 3+-tab
  race can't have one loser consume the mark and another trigger a spurious revoke
  (`:682-688`)
- [ ] `recentlyRotatedJtis` self-prunes (`authService.ts:674-679`) and is
  acknowledged as in-memory/per-instance: a cross-instance miss only costs a
  spurious-but-safe family revoke (`:664-667`) — confirm that trade-off is
  acceptable, not a correctness gap

### 5. Cross-Instance Consistency + the ~15s Revocation-State Cache
- [ ] `isAccessTokenStale` caches per user for `TOKENS_VALID_AFTER_TTL_MS =
  15_000` (`authService.ts:167`, `:308`); a single `fetchUserRevocationState`
  populates both the cutoff and the revoked-jti set (`:259-278`) — bound the
  per-request DB cost to ~1 lookup/user/TTL
- [ ] **Staleness window** — a revocation on instance A is visible to instance B
  only after B's cached entry for that user expires (≤15s) OR B has no cached
  entry. Confirm this ≤15s cross-instance lag is a documented, accepted window
  (an access token already can't outlive its 15-min cap, and the originating
  instance is immediate via cache invalidation)
- [ ] Every stamping path invalidates the LOCAL cache so the originating instance
  is immediate: logout-all (`authService.ts:654`), cross-instance jti write
  (`:387`), admin update (`adminRoutes.ts:363`), admin deactivate (`:485`)
- [ ] The cache cannot grow unbounded: `sweepRevokedTokens` evicts entries older
  than the TTL on the 10-min interval (`authService.ts:244-250`)
- [ ] The read is RLS-correct: `fetchUserRevocationState` runs under
  `withRLSContext(userId)` and queries `tx.user` + `tx.revokedAccessToken`
  through `tx` (not bare `prisma.*`) so the SET LOCAL applies
  (`authService.ts:262-272`)
- [ ] Note the in-memory `revokedTokens` blacklist remains per-instance by design
  (immediate same-instance stop); the DB layer is what makes revocation
  cross-instance — confirm the middleware runs BOTH (`auth.ts:90` + `:106`) and
  doesn't rely on the blacklist alone

### 6. Audit Coverage
- [ ] Logout writes a `LOGOUT` audit row attributed to the verified identity
  (access token or signature-checked refresh session), unattributed only when
  neither resolves (`authController.ts:491-495`); a forged refresh cookie cannot
  pollute the trail because `verifyRefreshToken` checks the signature
  (`authController.ts:455`)
- [ ] Logout-all writes `LOGOUT` with `authAction: 'LOGOUT_ALL_DEVICES'`
  (`authController.ts:526-529`)
- [ ] **Refresh-token reuse is audited** — `refreshTokens` writes a
  `LOGIN_FAILED` row with `reason: 'REFRESH_TOKEN_REUSE'`, `authAction:
  'REFRESH'`, and `familyRevoked` set per benign-race-vs-compromise
  (`authService.ts:808-830`); best-effort, never blocks the 401 (`:831-836`)
- [ ] Admin deactivate / role change / password reset emit the elevated audit
  operation (`PERMISSION_CHANGE` vs `UPDATE`, `adminRoutes.ts:366-368`) — the
  revocation is a side effect of an already-audited admin action
- [ ] Password change / reset / email-change-complete each audit
  (`PASSWORD_CHANGE` `authController.ts:641`, `PASSWORD_RESET_COMPLETE` `:876`,
  `EMAIL_CHANGE_COMPLETE` `:991`) — the cutoff stamp rides the same operation
- [ ] No token material (jti aside), no PHI, in any revocation log line — the
  reuse audit carries `jti`, capped error strings, and session IP/UA metadata
  only (`authService.ts:822-829`); cross-link [[31-logging-observability]]

### 7. Failure Modes / Fail-Closed vs Fail-Open
- [ ] `isAccessTokenStale` **fails OPEN** (returns false) on a DB error
  (`authService.ts:314-320`) — confirm this is the intended posture (a transient
  DB blip must not mass-logout; a stale token can't reach PHI during a real DB
  outage since data reads need the same DB)
- [ ] The cross-instance jti write **fails best-effort** (logged, not thrown)
  (`authService.ts:388-393`) so logout still clears cookies even if the DB write
  fails — same-instance blacklist still stops the token locally
- [ ] Family-revoke-on-reuse **fails best-effort** (logged at `error`, not
  thrown) so the 401 the caller already gets is unchanged (`authService.ts:798-805`)
- [ ] Logout is idempotent: cookies are cleared ALWAYS, even when no session
  resolves (`authController.ts:485-487`), so a stale/unknown cookie set never
  survives a logout
- [ ] The `revoked_access_tokens` table is FORCE-RLS fail-closed
  (`migration.sql:27`) — even an owner-role connection can't bypass the policies
  (ties to M2 `assertRLSForced`)
- [ ] Poisoning defense holds: `revokeAccessToken` (`authService.ts:212`) and
  `revokeAccessTokenCrossInstance` (`:358`) clamp stored expiry to one lifetime +
  skew so a forged `exp=year-9999` (reachable unauthenticated via the optionalAuth
  logout route) cannot pin a never-swept entry/row
- [ ] Confirm the 10-min cleanup actually runs in the deployed topology
  (`startSessionCleanup`, `authService.ts:1792`) — if migrations/jobs run
  out-of-process, verify the long-lived API instance still ticks the interval so
  the blacklist Map and revoked-jti table stay bounded

## Required Artifacts
- A revocation-event matrix: for each of {single-device logout, logout-all,
  password change, password reset, email-change confirm, admin deactivate, admin
  role change, admin password reset, refresh-reuse} → which mechanism fires
  (in-memory blacklist / `tokens_valid_after` cutoff / `revoked_access_tokens`
  jti / family revoke), the cross-instance latency, and the audit row emitted.
- A staleness-window statement: the worst-case lag (≤ `TOKENS_VALID_AFTER_TTL_MS`)
  between a revocation on one replica and enforcement on another, with the
  rationale for why it is acceptable given the 15-min access-token cap.
- A fail-posture table: each failure point (DB error in stale-check, jti-write
  failure, family-revoke failure, audit-write failure) → fail-open vs fail-closed
  vs best-effort, with justification.

## Acceptance Questions
1. Does EVERY protected route enforce both revocation layers? Confirm `authenticate`,
   `optionalAuth`, and `requireBearerAuth` all call `isTokenRevoked` AND
   `await isAccessTokenStale(...)` — no route verifies a JWT and skips the DB
   layer (the L22 removal of `verifyToken` was the last such foot-gun).
2. Can a single-device logout ever log a user out of their OTHER devices? It must
   not — confirm `revokeAccessTokenCrossInstance` writes a per-jti row and never
   stamps `tokens_valid_after`.
3. Can a forged/decoded-but-unverified token seed a `revoked_access_tokens` row
   for an arbitrary user, or pin an unsweepable row via a far-future `exp`? The
   identity guard (`decoded.id === verifiedUserId`) and the exp clamp must both
   hold.
4. Is the refresh-reuse grace window correctly distinguishing a benign double-tab
   race from a stolen-then-rotated replay, and does a real replay outside the
   window revoke the WHOLE family (sessions + cutoff, cross-instance)?
5. Is fail-open on the stale-check the right call, and is the ≤15s cross-instance
   staleness window formally accepted given the access-token cap?
6. Is the `current_user_id() IS NULL` branch in the `revoked_access_tokens` INSERT
   policy strictly necessary for the expired-logout path, and does it widen the
   write surface beyond that path?
7. Does the deployed topology actually run the 10-min cleanup so the in-memory
   blacklist Map, the revocation-state cache, and the `revoked_access_tokens`
   table all stay bounded?

## No-TBD Enforcement
Every claim in the deliverable must cite a confirmed `file:line` from the live
code. Do NOT carry forward the stale [[03-authentication]] §9 description
("in-memory blacklist … per-instance … a revoked access token can still be
honored by another Cloud Run replica until natural 15-min expiry") as the current
state — that gap was CLOSED by the `tokens_valid_after` cutoff + `revoked_access_tokens`
table. If a mechanism cannot be confirmed in code, mark it explicitly as
UNVERIFIED rather than asserting it. No placeholder line numbers.

## Cross-Links
- [[03-authentication]] — broader auth surface (login, lockout, cookies, demo,
  email/password flows); its revocation section is now survey-level and stale —
  this file is authoritative for revocation.
- [[05-audit-logging]] — `LOGOUT` / `LOGIN_FAILED`(`REFRESH_TOKEN_REUSE`) /
  `PERMISSION_CHANGE` audit expectations measured here.
- [[30-admin-security]] — the admin `updateUser`/`deleteUser` stamping paths and
  their RBAC/self-modification guards.
- [[34-routing-table-doc]] — confirm `/logout` (optionalAuth) vs `/logout-all`
  (authenticate) guard stacks match the live routes.
- [[_phi-inventory]] — audit rows that carry encrypted PHI snapshots
  (`previousValueEncrypted` / `newValueEncrypted` / `metadataEncrypted`).

## Verification (tool usage)
```bash
# The two enforcement layers must run on every auth entrypoint
grep -rn "isTokenRevoked\|isAccessTokenStale" backend/src/middleware/auth.ts

# Cutoff + jti cache core: TTL, fetch, stale-check, cache invalidation
grep -rn "TOKENS_VALID_AFTER_TTL_MS\|fetchUserRevocationState\|isAccessTokenStale\|invalidateTokensValidAfterCache" backend/src/services/authService.ts

# Every per-user cutoff stamp (logout-all / pwd / reset / email / admin)
grep -rn "tokensValidAfter\|revokeAllUserTokens" backend/src/services/authService.ts backend/src/controllers/authController.ts backend/src/routes/adminRoutes.ts

# Single-device cross-instance revoke + identity/exp guards
grep -rn "revokeAccessTokenCrossInstance\|revokedAccessToken\|decoded.id !== verifiedUserId" backend/src/services/authService.ts backend/src/controllers/authController.ts

# Refresh rotation + reuse → family revoke + grace window
grep -rn "FOR UPDATE\|REFRESH_REUSE_GRACE_MS\|markRecentRotation\|getRecentRotation\|REFRESH_TOKEN_REUSE" backend/src/services/authService.ts

# jti minted on every access token
grep -rn "jti" backend/src/services/authService.ts backend/src/middleware/auth.ts

# RLS + FORCE + the three policies + the expired-logout NULL insert branch
grep -rn "FORCE ROW LEVEL SECURITY\|current_user_id() IS NULL\|revoked_access_tokens_\(select\|insert\|delete\)_own" backend/prisma/migrations/20260613_revoked_access_tokens/migration.sql

# Schema: cutoff column + RevokedAccessToken model
grep -rn "tokensValidAfter\|RevokedAccessToken\|revoked_access_tokens" backend/prisma/schema.prisma

# Expired-row + cache cleanup on the 10-min interval
grep -rn "cleanupExpiredSessions\|sweepRevokedTokens\|startSessionCleanup" backend/src/services/authService.ts

# Confirm no verify path skips revocation (L22 removed verifyToken)
grep -rn "jwt.verify\|verifyToken\|verifyAccessToken" backend/src/middleware/auth.ts backend/src/services/authService.ts
```
