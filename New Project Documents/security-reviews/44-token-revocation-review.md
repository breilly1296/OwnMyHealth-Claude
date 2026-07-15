# Cross-Instance Token / Session Revocation Review — 2026-06-16

> Scope: the token & session revocation subsystem rebuilt after 2026-06-01 — the
> access-JWT `jti`, the DB-backed `tokens_valid_after` per-user cutoff, the
> single-device `revoked_access_tokens` table + its RLS/FORCE policies, refresh
> rotation → reuse → family revoke, the ~15s revocation-state cache, audit
> coverage, and fail-open/fail-closed posture. Login/lockout/cookie mechanics are
> out of scope (owned by `03-authentication`). All claims cite live code at HEAD
> `fb2cd32`. No code was modified.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Info | 2 |

The revocation subsystem is sound and matches the prompt's architecture
description with no fabrication or drift in the core. Both enforcement layers run
on every protected entrypoint, the identity guard + exp clamp hold, refresh-reuse
family-revoke is correct, and the cache/cleanup are bounded. The three Low
findings are least-privilege / defense-in-depth observations on intentional,
documented design choices; the two Info items are accepted-window notes.

---

## Findings

### F-1 — `revoked_access_tokens` INSERT policy admits an unauthenticated row whose only DB-layer guard is the application identity check — **Low**
- **Location:** `backend/prisma/migrations/20260613_revoked_access_tokens/migration.sql:33-35`
- **Observation:** The INSERT policy is
  `WITH CHECK (user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL)`.
  The third disjunct deliberately admits an INSERT when no user context is set,
  so the `optionalAuth` `/logout` route (which can run with an expired access
  token — `authRoutes.ts:114`) can still record a revocation. The application
  caller `revokeAccessTokenCrossInstance` does enforce the real guard at the app
  layer: it only writes when `decoded.id === verifiedUserId` (`authService.ts:369`,
  where `verifiedUserId` is resolved from the verified access token or the
  signature-checked refresh session at `authController.ts:479-481`) and clamps
  `expiresAt` to one access-token lifetime + skew (`authService.ts:373-374`). But
  at the DB layer the policy itself places **no** ownership constraint on the NULL
  branch: any connection that reaches this table with `app.current_user_id` unset
  may insert an arbitrary `(jti, user_id, expires_at)` row.
- **Impact:** Bounded. The row only causes the matching `jti` to be rejected by
  `isAccessTokenStale` (`authService.ts:323`) — i.e. it can force a *specific,
  already-known* access token to stop authenticating; it cannot disclose PHI,
  forge a session, or stamp the per-user cutoff. To abuse it an actor would need
  (a) a DB connection running without a user context and (b) knowledge of a live
  token's `jti`. Worst case is a self-targeted/known-token denial of service, not
  a confidentiality breach. The application path is correctly scoped; this is a
  least-privilege gap in the policy, not an exploitable hole in the running code.
- **Fix:** If tightening is desired, narrow the NULL branch so it can only insert
  for a user that has no live session contradiction — e.g. require the inserted
  `user_id` to correspond to a row in `sessions` being deleted in the same flow,
  or move the expired-logout revocation behind a short-lived system context
  (`is_admin_session()`) instead of relying on `current_user_id() IS NULL`. Lower
  priority because the app-layer guard already constrains the only production
  writer and the blast radius is a known-token DoS.
- **Evidence:**
  ```sql
  CREATE POLICY revoked_access_tokens_insert_own ON revoked_access_tokens
    FOR INSERT
    WITH CHECK (user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL);
  ```

### F-2 — In-memory `revokedTokens` blacklist and `recentlyRotatedJtis` are per-instance and lost on restart — **Low**
- **Location:** `backend/src/services/authService.ts:156` (`revokedTokens`),
  `:669` (`recentlyRotatedJtis`)
- **Observation:** The immediate same-instance stop (`revokeAccessToken` /
  `isTokenRevoked`) and the double-tab grace mark are both plain in-process `Map`s.
  The code documents this honestly: a Cloud Run restart drops the blacklist, and a
  cross-instance refresh race can miss the rotation mark. The DB layer
  (`tokens_valid_after` + `revoked_access_tokens`) is what actually spans replicas
  and survives restart, so a dropped blacklist entry only loses the *immediate*
  same-instance stop, not cross-instance revocation.
- **Impact:** Minimal and already mitigated. After a restart a single-device
  logout's token is still rejected cross-instance by its `revoked_access_tokens`
  row (`isAccessTokenStale` `:323`); a logout-all / password change is still
  rejected by the `tokens_valid_after` cutoff (`:325`). The only residual is the
  ~15s cache-convergence window (see F-3 / Info) re-applying after a restart. A
  cross-instance refresh-race miss costs at most one *spurious-but-safe* family
  revoke (forced re-login), never a missed revoke.
- **Fix:** None required for correctness. The documented future hardening is a
  shared store (Redis/Memorystore) for the blacklist + rotation marks once the
  deployment fans out beyond one instance; tracked as the M11 Redis infra item.
- **Evidence:**
  ```ts
  // In-Memory Token Blacklist ... does NOT survive a restart or span instances
  const revokedTokens: Map<string, number> = new Map();
  ```

### F-3 — Cross-instance revocation lag of up to `TOKENS_VALID_AFTER_TTL_MS` (~15s) is documented but not enforced as a config invariant — **Low**
- **Location:** `backend/src/services/authService.ts:167`, `:308`
- **Observation:** `isAccessTokenStale` serves a cached revocation snapshot for up
  to `TOKENS_VALID_AFTER_TTL_MS = 15_000` ms. A revocation on instance A is not
  enforced on instance B until B's cached entry for that user expires (≤15s) or B
  has no entry. This is the intended, documented window, but the 15s value is a
  bare module constant with no asserted relationship to the access-token lifetime;
  a future change that raised it materially (e.g. to minutes) would silently widen
  the cross-instance honoring window with no guard rail.
- **Impact:** Low. Bounded by the 15-min access-token cap regardless, and the
  originating instance is always immediate via `invalidateTokensValidAfterCache`.
  The risk is purely a future-regression / maintainability one, not a current
  exploit.
- **Fix:** Add a startup assertion (or a code comment with a hard ceiling) that
  `TOKENS_VALID_AFTER_TTL_MS` stays well under `accessTokenLifetimeMs()`, so the
  staleness window can never approach the token lifetime.
- **Evidence:**
  ```ts
  const TOKENS_VALID_AFTER_TTL_MS = 15_000;
  ```

### F-4 (Info) — `isAccessTokenStale` fail-open is the correct posture, recorded for the fail-posture table — **Info**
- **Location:** `backend/src/services/authService.ts:314-320`
- **Observation:** On a DB error the stale-check returns `false` (token allowed)
  and logs a warning. This is intentional: a transient DB blip must not mass-logout
  the entire user base, and a stale token cannot reach PHI during a real DB outage
  because PHI reads need the same DB. Confirmed correct, no change.
- **Evidence:**
  ```ts
  logger.warn('token revocation lookup failed; allowing token (fail-open)', ...);
  return false;
  ```

### F-5 (Info) — Refresh-reuse audit metadata carries `jti` only, no token material or PHI — **Info**
- **Location:** `backend/src/services/authService.ts:818-829`
- **Observation:** The `LOGIN_FAILED` / `REFRESH_TOKEN_REUSE` audit row records
  `reason`, `authAction`, `success`, a capped human-readable `errorMessage`,
  `familyRevoked`, the refresh `jti` (a UUID, not the signed token), and session
  IP/UA from the metadata. No signed token, no password, no PHI. The `jti` is an
  opaque identifier, acceptable in the audit trail. Confirmed clean.
- **Evidence:**
  ```ts
  familyRevoked: !benignRace,
  jti: payload!.jti,
  ipAddress: metadata?.ipAddress,
  userAgent: metadata?.userAgent,
  ```

---

## Required Artifacts

### Revocation-event matrix

| Event | In-memory blacklist | `tokens_valid_after` cutoff | `revoked_access_tokens` jti | Family revoke | Cross-instance latency | Audit row |
|---|---|---|---|---|---|---|
| Single-device logout | Yes — `revokeAccessToken` (`authController.ts:473`) | **No** (by design — would log out other devices) | Yes — `revokeAccessTokenCrossInstance` (`authController.ts:481`) | No | jti: ≤15s; same-instance immediate | `LOGOUT` (`authController.ts:493`) |
| Logout-all | No (cutoff covers it) | Yes — `revokeAllUserTokens` (`authController.ts:519` → `authService.ts:648-651`) | No | Sessions wiped (`authService.ts:641`) | ≤15s; origin immediate (`:654`) | `LOGOUT` + `LOGOUT_ALL_DEVICES` (`authController.ts:526-529`) |
| Password change | Yes — current token (`authController.ts:622`) | Yes — `revokeAllUserTokens` (`authController.ts:608`) | No | Sessions wiped | ≤15s; origin immediate | `PASSWORD_CHANGE` (`authController.ts:641`) |
| Password reset | No (public flow, no request token) | Yes — `revokeAllUserTokens` (`authService.ts:1504`) | No | Sessions wiped | ≤15s | `PASSWORD_RESET_COMPLETE` (`authController.ts:876`) |
| Email-change confirm | No (public flow) | Yes — `revokeAllUserTokens` (`authService.ts:1679`) | No | Sessions wiped | ≤15s | `EMAIL_CHANGE_COMPLETE` (`authController.ts:991`) |
| Admin deactivate | No | Yes — `tokensValidAfter` in tx (`adminRoutes.ts:478`) | No | Sessions wiped (`:480`) | ≤15s; origin immediate (`:485`) | `DEACTIVATE` (`adminRoutes.ts:455-461`) |
| Admin role change | No | Yes — `mustRevoke` → `tokensValidAfter` (`adminRoutes.ts:317-322`) | No | Sessions wiped (`:339`) | ≤15s; origin immediate (`:363`) | `PERMISSION_CHANGE` (`adminRoutes.ts:368-392`) |
| Admin password reset | No | Yes — `mustRevoke` (`!!password`, `adminRoutes.ts:319-322`) | No | Sessions wiped | ≤15s; origin immediate (`:363`) | `UPDATE` w/ `passwordChanged` (`adminRoutes.ts:368-379`) |
| Refresh-reuse (outside grace) | No | Yes — `revokeAllUserTokens` (`authService.ts:797`) | No | Whole family (sessions + cutoff) | ≤15s | `LOGIN_FAILED` / `REFRESH_TOKEN_REUSE`, `familyRevoked:true` (`authService.ts:815-830`) |
| Refresh-reuse (inside grace) | No | No (benign race) | No | None | n/a | `LOGIN_FAILED` / `REFRESH_TOKEN_REUSE`, `familyRevoked:false` (`authService.ts:822-826`) |

### Staleness-window statement

Worst-case cross-instance lag = `TOKENS_VALID_AFTER_TTL_MS` = **15 seconds**
(`authService.ts:167`). A revocation stamped on replica A is enforced on replica B
only after B's cached entry for that user expires (`:308`) or B has no entry. The
originating replica is always immediate because every stamping path calls
`invalidateTokensValidAfterCache` (`:654`, `:387`, `adminRoutes.ts:363`, `:485`).
**Acceptable because** an access token is capped at the 15-min access lifetime
regardless (`generateAccessToken` `:459-462`), so 15s is a small fraction of the
window in which the token would otherwise be honored, and the refresh-session
deletion is effective on the very next refresh on any replica (the session row is
gone DB-wide). The window is documented in code (`authService.ts:161-166`).

### Fail-posture table

| Failure point | Posture | Justification | Evidence |
|---|---|---|---|
| DB error in `isAccessTokenStale` | **Fail-open** (allow) | A transient blip must not mass-logout; a stale token can't reach PHI during a real DB outage (PHI reads need the same DB). | `authService.ts:314-320` |
| Cross-instance jti write fails | **Best-effort** (logged, not thrown) | Logout must still clear cookies; same-instance blacklist still stops the token locally. | `authService.ts:388-393` |
| Family-revoke-on-reuse fails | **Best-effort** (logged at `error`, not thrown) | The 401 the caller already gets must not change; failure is logged loudly. | `authService.ts:798-805` |
| Reuse audit-write fails | **Best-effort** (logged, not thrown) | Audit hiccup must not block the 401. | `authService.ts:831-836` |
| `revoked_access_tokens` table access | **Fail-closed (FORCE RLS)** | Even an owner-role connection can't bypass the policies; boot `assertRLSForced` hard-exits in prod if any RLS table lacks FORCE. | `migration.sql:27`; `database.ts:299-305` |

---

## Checks passed

**1. Access-Token Model + `jti`**
- [x] Every access token carries a unique `jti` — `generateAccessToken` sets `jti: uuidv4()` (`authService.ts:456`); middleware passes `decoded.jti` to `isAccessTokenStale` (`auth.ts:106`, `:163`, `:222`).
- [x] `jti` is optional end-to-end — `JwtPayload.jti?` (`auth.ts:30`); `isAccessTokenStale(userId, iat, jti?)` (`authService.ts:299-302`); a no-`jti` token is matched only by the cutoff (`:323-325`).
- [x] Access-token lifetime derives from the same config used to sign — `accessTokenLifetimeMs` reads `config.jwt.accessExpiresIn` (`authService.ts:190-194`); `generateAccessToken` signs with the same value (`:461`).
- [x] Legacy unsafe `verifyToken`/`generateToken` removed and not reintroduced — the only `jwt.verify` callers in production are the three middleware entrypoints (all revocation-gated) and `authService` (`verifyAccessToken`/`verifyRefreshToken`/`refreshTokens`); removal documented at `auth.ts:245-250`.
- [x] `verifyAccessToken` consults the in-memory blacklist (`authService.ts:555`) and has **no production callers** (grep: only its own definition + a comment calling it "unused" at `auth.ts:89`), so it is not the sole gate on any route.

**2. Per-User Cutoff — every stamping event**
- [x] Logout-all — `logoutAll` → `revokeAllUserTokens` (`authController.ts:519`); session wipe + cutoff in one `withRLSContext` tx (`authService.ts:640-652`) + cache invalidation (`:654`).
- [x] Password change — `changePassword` → `revokeAllUserTokens(user.id)` (`authController.ts:608`); M-4 comment (`:624-629`).
- [x] Password reset — `resetPassword` → `revokeAllUserTokens(updatedPrismaUser.id)` (`authService.ts:1504`); public-flow rationale (`:1506-1512`).
- [x] Email-change confirm — `confirmEmailChange` → `revokeAllUserTokens(lookup.userId)` (`authService.ts:1679`); same rationale (`:1673-1678`).
- [x] Admin deactivate / role change / admin password reset — `updateUser` computes `mustRevoke = !!password || roleChanged || deactivated` and folds `tokensValidAfter` into the same `user.update` (`adminRoutes.ts:317-322`) then invalidates (`:363`); `deleteUser` stamps cutoff + wipes sessions in one tx (`:473-481`) then invalidates (`:485`).
- [x] Cutoff comparison correct — strict `<` at whole-second granularity (`iatSeconds < Math.floor(validAfterMs/1000)`, `authService.ts:325`); `validAfterMs === 0` short-circuits (`:324`).

**3. Single-Device Revocation + RLS**
- [x] Single-device logout records the jti cross-instance and does NOT stamp the cutoff — `logout` calls `revokeAccessTokenCrossInstance` (`authController.ts:481`); no `tokensValidAfter` write in that path.
- [x] Identity guard — `revokeAccessTokenCrossInstance` writes only when `decoded.id === verifiedUserId` (`authService.ts:369`); caller resolves `verifiedUserId` from verified token or signature-checked refresh session (`authController.ts:479`).
- [x] Exp clamp — `expiresAt` = token exp clamped to one lifetime + skew (`authService.ts:373-374`); already-expired token skipped (`:371`).
- [x] Write is `upsert` keyed by `jti` under `withRLSContext(verifiedUserId)` (`authService.ts:377-383`) — RLS-scoped, idempotent.
- [x] RLS + FORCE on `revoked_access_tokens` — `ENABLE` + `FORCE` (`migration.sql:26-27`); three policies scoped to `user_id = current_user_id() OR is_admin_session()` (`:29-39`); helpers `current_user_id()`/`is_admin_session()` exist (`20260107_add_rls_policies/migration.sql:17`, `:28`).
- [x] Expired-logout INSERT NULL branch is intentional and mirrors the sessions/audit insert pattern (`migration.sql:33-35`, comment `:21-25`) — see F-1 for the least-privilege note.
- [x] Same-instance immediacy — `invalidateTokensValidAfterCache(verifiedUserId)` after the write (`authService.ts:387`).
- [x] Expired revoked-jti rows reaped — `cleanupExpiredSessions` deletes `revokedAccessToken` past `expiresAt` (`authService.ts:1766-1769`); 10-min interval (`:1801-1808`); `expiresAt` indexed (`schema.prisma:104`).

**4. Refresh Rotation + Reuse → Family Revoke + Grace**
- [x] Rotation is single-use + atomic — `SELECT ... FOR UPDATE` row lock, delete, re-insert in one `withRLSTransaction` (`authService.ts:730-763`); racing refresh finds the row gone → `reuse` (`:738-744`).
- [x] Discriminated `reuse | expired | inactive` returned (`authService.ts:722`); `expired`/`inactive` → plain 401, no family action (`:838-840`).
- [x] Reuse outside grace → full family revoke (`revokeAllUserTokens(payload.id)`, `authService.ts:795-797`); revoke failure logged not thrown (`:798-805`).
- [x] Reuse inside `REFRESH_REUSE_GRACE_MS = 10_000` → benign race, family NOT revoked (`authService.ts:668`, `:791-806`).
- [x] Rotation mark recorded inside the tx before lock release — `markRecentRotation(payload!.jti)` (`authService.ts:770`); `getRecentRotation` is a non-deleting peek (`:685-688`).
- [x] `recentlyRotatedJtis` self-prunes (`authService.ts:674-679`); in-memory/per-instance trade-off documented (`:664-667`) — cross-instance miss costs only a spurious-but-safe revoke.

**5. Cross-Instance Consistency + ~15s Cache**
- [x] Caches per user for `TOKENS_VALID_AFTER_TTL_MS = 15_000` (`authService.ts:167`, `:308`); one `fetchUserRevocationState` populates both cutoff + revoked-jti set (`:259-278`).
- [x] Staleness window ≤15s documented + accepted (`authService.ts:161-166`) — see Info F-4 and the staleness-window statement above.
- [x] Every stamping path invalidates the local cache — logout-all (`:654`), jti write (`:387`), admin update (`adminRoutes.ts:363`), admin deactivate (`:485`).
- [x] Cache can't grow unbounded — `sweepRevokedTokens` evicts entries past the TTL (`authService.ts:244-250`) on the 10-min interval (`:1804`).
- [x] Read is RLS-correct — `fetchUserRevocationState` runs under `withRLSContext(userId)` and queries via `tx.user`/`tx.revokedAccessToken` (`authService.ts:262-272`).
- [x] Middleware runs BOTH layers, not the blacklist alone — `isTokenRevoked` (`auth.ts:90`) then `await isAccessTokenStale` (`:106`); same in `optionalAuth` (`:150`, `:163`) and `requireBearerAuth` (`:210`, `:222`).

**6. Audit Coverage**
- [x] Logout writes `LOGOUT` attributed to the verified identity, unattributed only when neither resolves (`authController.ts:491-495`); refresh identity resolved via signature-checked `verifyRefreshToken` (`:455`).
- [x] Logout-all writes `LOGOUT` + `authAction: 'LOGOUT_ALL_DEVICES'` (`authController.ts:526-529`).
- [x] Refresh-reuse audited — `LOGIN_FAILED` / `reason: 'REFRESH_TOKEN_REUSE'` / `authAction: 'REFRESH'` / `familyRevoked` (`authService.ts:808-830`); best-effort, never blocks the 401 (`:831-836`).
- [x] Admin role change emits `PERMISSION_CHANGE` vs `UPDATE` (`adminRoutes.ts:367-368`); deactivate emits `DEACTIVATE` (`:455-461`).
- [x] Password change / reset / email-change-complete each audit — `PASSWORD_CHANGE` (`authController.ts:641`), `PASSWORD_RESET_COMPLETE` (`:876`), `EMAIL_CHANGE_COMPLETE` (`:991`).
- [x] No token material/PHI in revocation logs — reuse audit carries `jti` + capped error string + IP/UA only (`authService.ts:822-829`); see Info F-5.

**7. Failure Modes**
- [x] `isAccessTokenStale` fails OPEN on DB error (`authService.ts:314-320`) — see Info F-4.
- [x] Cross-instance jti write best-effort (`authService.ts:388-393`).
- [x] Family-revoke-on-reuse best-effort at `error` level (`authService.ts:798-805`).
- [x] Logout idempotent — cookies cleared always, even with no resolved session (`authController.ts:485-487`).
- [x] `revoked_access_tokens` FORCE-RLS fail-closed (`migration.sql:27`) + boot `assertRLSForced` hard-exit in prod (`database.ts:299-305`) covers it dynamically (queries `pg_class` for any RLS table missing FORCE).
- [x] Poisoning defense — `revokeAccessToken` (`authService.ts:212-223`) and `revokeAccessTokenCrossInstance` (`:373-374`) clamp stored expiry to one lifetime + skew, so a forged far-future `exp` can't pin an unsweepable entry/row.
- [x] 10-min cleanup runs in the deployed topology — `startSessionCleanup` (`authService.ts:1792`) is called inside `startServer()` (`app.ts:342`), the long-lived API process started at module load (`app.ts:424`); the Cloud Run CMD is `node dist/app.js` (migrations run as a separate job), so the interval ticks.

## Acceptance Questions

1. **Does EVERY protected route enforce both revocation layers?** Yes —
   `authenticate` (`auth.ts:90`+`:106`), `optionalAuth` (`:150`+`:163`), and
   `requireBearerAuth` (`:210`+`:222`) all run `isTokenRevoked` AND
   `await isAccessTokenStale`. The only other `jwt.verify` calls are inside
   `authService` (`verifyAccessToken` — no production callers; `verifyRefreshToken`
   / `refreshTokens` — refresh-secret paths, not access-route gates). No access
   route verifies a JWT and skips the DB layer.
2. **Can a single-device logout log out other devices?** No — `logout` calls
   `revokeAccessTokenCrossInstance` (per-jti row, `authController.ts:481`) and
   never stamps `tokens_valid_after`; that function writes only to
   `revoked_access_tokens` (`authService.ts:377-383`).
3. **Can a forged/decoded token seed a row for an arbitrary user or pin an
   unsweepable row?** No — the identity guard `decoded.id !== verifiedUserId`
   returns early (`authService.ts:369`) and the exp clamp bounds `expiresAt`
   (`:373-374`); already-expired tokens are skipped (`:371`). (The DB policy's NULL
   branch is broader than the app caller — F-1 — but the app path is the only
   production writer and the outcome is a known-token DoS, not impersonation.)
4. **Is the refresh-reuse grace window correct, and does a real replay revoke the
   whole family?** Yes — inside `REFRESH_REUSE_GRACE_MS` (10s) the reuse is treated
   as a benign double-tab race and the fresh session is preserved
   (`authService.ts:791-806`); outside the window it triggers
   `revokeAllUserTokens` (sessions + cutoff, cross-instance) (`:795-797`). The
   mark is recorded inside the tx (`:770`) and peeked non-destructively (`:685`),
   so a 3+-tab race can't cause a spurious revoke.
5. **Is fail-open on the stale-check right, and the ≤15s window accepted?** Yes —
   fail-open avoids a transient-blip mass-logout and a stale token can't reach PHI
   during a DB outage (`authService.ts:314-320`); the ≤15s window is documented
   and dwarfed by the 15-min access cap (see staleness-window statement). F-3 notes
   the TTL constant has no guard rail against a future material increase.
6. **Is the `current_user_id() IS NULL` INSERT branch strictly necessary and does
   it widen the write surface?** It is necessary for the expired-logout path (the
   `optionalAuth` `/logout` route can run with no established user context) and it
   *does* widen the DB-layer write surface beyond that path — the app-layer
   identity guard, not the policy, is what keeps it scoped. Reported as F-1 (Low).
7. **Does the deployed topology run the 10-min cleanup?** Yes — `startSessionCleanup`
   is invoked in `startServer()` (`app.ts:342`) in the long-lived API container
   (CMD `node dist/app.js`); the interval calls `sweepRevokedTokens` (in-memory
   blacklist + cache) and `cleanupExpiredSessions` (sessions + revoked-jti rows)
   every 10 min (`authService.ts:1801-1808`).

## Unverifiable
- None. Every checklist item was confirmed against live code at the cited
  `file:line`.

## Out of scope
- Login / lockout / cookie / demo-gating mechanics — owned by `03-authentication`
  per the prompt's scope note; not re-audited here.
- The L21 login-existence-oracle and L-1 email-verification-oracle fixes
  (`authService.ts:1142-1198`) — observed in passing, owned by `03-authentication`.
- Test files (`authService.test.ts`) — referenced only to confirm the prompt's
  grep hits; behavior was verified against the implementation, not the tests.
- General RLS correctness of non-revocation tables and the broader
  `assertNoBypassRLS` / encryption posture — owned by the RLS and encryption
  reviews; only the revocation-table FORCE/RLS facet was checked here.

## Prompt drift
- None material. The prompt's `file:line` anchors matched the live code throughout
  (e.g. `generateAccessToken` jti at `:456`, `isAccessTokenStale` at `:299`,
  `TOKENS_VALID_AFTER_TTL_MS` at `:167`, the INSERT policy at `migration.sql:35`).
  No stale claims to flag.
