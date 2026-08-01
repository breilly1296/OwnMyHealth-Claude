# Cross-Instance Token / Session Revocation Review — 2026-08-01

> **Refresh of the 2026-06-16 review** (HEAD `fb2cd32`), re-run at HEAD `12b45ae` after 66 commits.
> Re-run because OF-22 — a refresh-rotation break caused by a missing `sessions` RLS UPDATE policy —
> landed on 2026-07-12, squarely inside this prompt's domain, and the prior review predates it.
> The prior review's three Low findings and two Info items were re-verified and all still hold;
> they are restated below in condensed form with their ledger ids. Everything under
> "New since the 2026-06-16 review" is new.

**Posture:** Sandbox — no GCP (billing disabled ~2026-07-12; no deployment target, founder-only data) — per [OPEN_FINDINGS.md §Posture](../OPEN_FINDINGS.md)
**Code state:** `master` @ `12b45ae`; `backend/src/services/authService.ts` changed in 2 commits since the prior review (`0dadd8d`, `0456c50`)
**Ledger read at:** `12b45ae`, last updated 2026-07-14
**Prompt:** [`prompts/44-token-revocation.md`](../../prompts/44-token-revocation.md)
**Scope:** the access-JWT `jti`, the DB-backed `tokens_valid_after` cutoff, the single-device `revoked_access_tokens` table + its RLS/FORCE policies, refresh rotation → reuse → family revoke, the ~15s revocation-state cache, audit coverage, fail posture. Login/lockout/cookie mechanics are out of scope (owned by `03-authentication`). No code was modified.

---

## Summary

| Severity | New | Already in ledger |
|---|---|---|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 1 | 0 |
| Low | 1 | 3 |
| Info | 0 | 2 |
| Dormant (launch checklist) | 0 | 1 |

The revocation core remains sound and matches the prompt's architecture description with no drift:
both enforcement layers run on every protected entrypoint, the identity guard and exp clamp hold,
refresh-reuse family-revoke is correct, and the cache and cleanup are bounded. OF-22 is genuinely
fixed, with a regression test.

The one new Medium is **the same latent defect class as OF-22, in this subsystem**:
`revoked_access_tokens` has SELECT / INSERT / DELETE policies but **no UPDATE policy**, and the
single-device revocation write is an `upsert` — whose conflict branch is an UPDATE. Two sibling
sites in the maintenance jobs have the identical shape and are flagged for review 45.

---

## New since the 2026-06-16 review

### F-4 — `revoked_access_tokens` has no RLS UPDATE policy, but is written by `upsert` — **Medium**

- **Location:** `backend/prisma/migrations/20260613_revoked_access_tokens/migration.sql:29-39` (policies);
  `backend/src/services/authService.ts:379-383` (the write)
- **Observation:** The table is `ENABLE` + `FORCE ROW LEVEL SECURITY` and defines exactly three
  policies — `revoked_access_tokens_select_own` (SELECT), `_insert_own` (INSERT), `_delete_own`
  (DELETE). There is **no UPDATE policy**. Under PostgreSQL, a command with no matching policy on an
  RLS-enabled table is denied outright — `is_admin_session()` does not help, because the admin branch
  lives *inside* policies that do not exist for UPDATE.

  The single-device revocation write is a Prisma `upsert` keyed by `jti`, running under a **user**
  RLS context (`withRLSContext(verifiedUserId)`), not an admin one:

  ```ts
  // Source: backend/src/services/authService.ts:377-383
  await withRLSContext(verifiedUserId, async (tx) => {
    await tx.revokedAccessToken.upsert({
      where: { jti: decoded!.jti! },
      create: { jti: decoded!.jti!, userId: verifiedUserId, expiresAt: new Date(expMs) },
      update: {},
    });
  });
  ```

  The `create` branch satisfies `_insert_own`. The **conflict branch is an UPDATE**, and there is no
  policy to satisfy. This is structurally identical to OF-22: `sessions` had SELECT/INSERT/DELETE and
  no UPDATE policy, and the UPDATE-shaped operation (`SELECT … FOR UPDATE`) silently matched zero
  rows under the NOBYPASSRLS role while working fine in dev/staging under BYPASSRLS.
- **Impact:** Bounded, but real. The conflict branch is reached on a **replayed revocation of the
  same `jti`** — a double-clicked logout, a client retry, or logout on a token already revoked. The
  first insert succeeds, so the revocation itself holds and no token stays valid: this is not a
  security bypass. The consequences are (a) the write throws instead of being idempotent, which
  contradicts the prompt's own §3 "idempotent on replay" claim; (b) the throw is swallowed by the
  best-effort catch (`authService.ts:388-393`) and surfaces only as a `warn` line, so it degrades
  silently; and (c) it is a latent trap for any future code that legitimately needs to update a
  revocation row (e.g. extending `expiresAt`) — that code would fail in production and pass in dev.
- **Verification status — read carefully.** The *structural* fact is confirmed: no UPDATE policy
  exists on this table. Whether the conflict branch actually errors at runtime depends on how Prisma
  compiles `upsert` with an **empty** `update: {}` — it may emit
  `INSERT … ON CONFLICT DO UPDATE SET …`, a SELECT-then-UPDATE pair, or optimize the no-op away.
  Both non-optimized forms require an UPDATE policy. I could not determine which Prisma emits by
  reading TypeScript, and I did not execute it. **Do not treat the runtime failure as confirmed —
  treat the missing policy as confirmed and the realization as untested.**
- **Fix:** Two options, in preference order.
  1. **Add the policy** (mirrors the OF-22 fix and the table's own "mirroring `sessions`" comment at
     `migration.sql:20-25`, which is now inaccurate because `sessions` gained an UPDATE policy and
     this table did not):
     ```sql
     CREATE POLICY revoked_access_tokens_update_own ON revoked_access_tokens
       FOR UPDATE
       USING (user_id = current_user_id() OR is_admin_session())
       WITH CHECK (user_id = current_user_id() OR is_admin_session());
     ```
  2. Or make the write insert-only and tolerate the duplicate-key error, since `update: {}` shows no
     update is actually wanted. This is arguably the more honest expression of intent, but leaves the
     latent trap in place for future writers.

  Either way, **add a case to `rls.test.ts`** next to the existing `sessions row lock` regression
  block (`backend/src/services/rls.test.ts:541`) that revokes the same `jti` twice under the
  NOBYPASSRLS role. That is the only test shape that can catch this class, and it now runs in CI.
- **Ledger check:** searched `OPEN_FINDINGS.md` for `revoked_access_tokens`, `upsert`, `UPDATE
  policy`, `RLS policy` — OF-22 is the same *class* but is a distinct, closed finding against a
  different table. No match for this one.

### F-5 — Two maintenance-job writes hit the same no-UPDATE-policy trap — **Low** (cross-domain: belongs to prompt 45)

- **Location:** `backend/src/services/goalValueBackfill.ts:127` and
  `backend/src/services/biomarkerConsolidation.ts:145`
- **Observation:** A full policy inventory across all 34 migrations shows four live tables with
  SELECT/INSERT/DELETE policies and no UPDATE policy: `audit_logs`, `biomarker_history`,
  `goal_progress_history`, `revoked_access_tokens`. (`dna_variants` and `genetic_traits` also lack
  one but were dropped in `20260423_drop_dna_genetics`.)

  | Table | No UPDATE policy | Is it UPDATEd by code? |
  |---|---|---|
  | `audit_logs` | yes | No — **intentional**, audit rows are immutable by design |
  | `biomarker_history` | yes | **Yes** — `tx.biomarkerHistory.updateMany` (`biomarkerConsolidation.ts:145`, history re-parenting) |
  | `goal_progress_history` | yes | **Yes** — `tx.goalProgressHistory.update` (`goalValueBackfill.ts:127`, PHI re-encryption) |
  | `revoked_access_tokens` | yes | **Yes** — see F-4 |

  Both maintenance writes run under a **user** RLS context, not admin —
  `withRLSTransaction(userId, …)` at `consolidateBiomarkerSeries.ts:103-105` and
  `backfillGoalValues.ts:113`. Unlike F-4 there is no Prisma ambiguity here: `.update()` and
  `.updateMany()` are unambiguously UPDATE statements.
- **Impact:** Under the NOBYPASSRLS role, `backfill-goal-values` would fail to re-encrypt
  `GoalProgressHistory.valueEncrypted` and `consolidate-biomarkers` would fail to re-parent history
  rows. In `applyUserConsolidation` the ordering comment (`biomarkerConsolidation.ts:130-136`) notes
  that re-parenting must happen *before* the duplicate delete, or the FK cascade drops the history —
  so a silently-failing re-parent inside a transaction that then deletes would be data loss, not just
  a no-op. Whether the transaction aborts (safe) or the failure is caught and the delete proceeds
  (unsafe) is the question review 45 needs to answer.
- **Why Low here:** no deployment target, no scheduled runs, and these are `workflow_dispatch`-only
  jobs that are DRY-RUN by default. This is a launch-blocking correctness issue, not a current one.
- **Fix:** Determine for each table whether UPDATE should be *allowed* (add the policy) or *forbidden*
  (change the code — for `biomarker_history`, delete-and-reinsert instead of re-parent). Do not add
  policies reflexively: `audit_logs` proves the absence is sometimes the point.
- **Ledger check:** no match. Flagged here because it was found by generalizing OF-22 from this
  subsystem; the domain owner is [`prompts/45-maintenance-jobs.md`](../../prompts/45-maintenance-jobs.md),
  whose 2026-06-16 review does not cover it.

### OF-22 verified fixed — no finding

The refresh-rotation break is genuinely closed, and the mechanism is worth stating because it is
non-obvious:

- `refreshTokens` locks the session row with a raw `SELECT … FOR UPDATE` (`authService.ts:730-736`).
- It runs under `withRLSTransaction(null, …)` (`authService.ts:720`), and `runWithRLS` treats a null
  `userId` as admin context — `const useAdmin = options.isAdmin || userId === null`
  (`database.ts:485`). So `is_admin_session()` is true for this transaction.
- Pre-fix, that was still not enough: `sessions` had no UPDATE policy at all, and PostgreSQL applies
  UPDATE-policy checks to `FOR UPDATE` row locks, so the lock matched zero rows regardless of the
  admin flag. Every refresh 401'd, and the missing row was classified as **reuse**
  (`authService.ts:738-745`), firing `revokeAllUserTokens` and logging the user out everywhere.
- `20260712_add_sessions_update_policy` adds `sessions_update_own` with
  `USING (user_id = current_user_id() OR is_admin_session())`, whose admin branch is what this call
  path relies on.
- A regression test exists: `backend/src/services/rls.test.ts:541` — `describe('sessions row lock
  (refresh rotation regression)')`, asserting an admin-context `SELECT … FOR UPDATE` can see and lock
  a session row. It runs in CI under the NOBYPASSRLS `omh_app` role via the `rls` job, and the flow
  is additionally exercised end-to-end by the `e2e` job added in `919398a` (`ci.yml:221`). The fix
  itself is `3159731`; the e2e job's first real run is what surfaced the bug.

**One residual worth recording** (not a finding, a design note for the ledger): the reuse branch
cannot distinguish "row genuinely rotated" from "row invisible to me". Both present as
`locked[0] === undefined`. OF-22 is what that indistinguishability looks like when it goes wrong —
a policy miss was read as a compromise signal and escalated to a full family revoke. If a future
change makes the session row conditionally invisible again, the same misfire recurs silently. A
cheap mitigation: before classifying as reuse, re-check existence with a plain (non-locking)
`SELECT`; a row that exists but could not be locked is an infrastructure fault, not reuse, and should
401 without revoking the family.

---

## Already-tracked (no new severity)

These three were the prior review's findings; all re-verified at `12b45ae` and unchanged.

- **F-1 — `revoked_access_tokens` INSERT policy admits `current_user_id() IS NULL`** — confirmed at
  `20260613_revoked_access_tokens/migration.sql:35`. The NULL branch is **strictly necessary**: the
  logout route uses `optionalAuth` (`authRoutes.ts:114`) so the HIPAA idle-logoff still reaches
  revocation when the access token has already expired, which means no established user context. The
  DB-layer guard is therefore weaker than the other two policies, and the real guard is the
  application-side identity check `decoded.id !== verifiedUserId` (`authService.ts:371`) plus the
  exp clamp (`:374-375`). Both re-verified present. Matches the `audit_logs` insert pattern. Still
  Low; still an accepted least-privilege gap.
- **F-2 — In-memory `revokedTokens` and `recentlyRotatedJtis` are per-instance** — confirmed
  (`authService.ts:213-250`, `:672-688`). This is **OF-14** in the ledger (Accepted, Low): largely
  closed by the DB-backed `tokens_valid_after` + `revoked_access_tokens` layers; the residual
  in-memory map is per-process and moot in a single-process sandbox. A cross-instance miss on
  `recentlyRotatedJtis` costs only a spurious-but-safe family revoke — the documented trade-off at
  `authService.ts:664-667` still holds.
- **F-3 — ≤15s cross-instance revocation lag not enforced as a config invariant** — confirmed:
  `TOKENS_VALID_AFTER_TTL_MS = 15_000` (`authService.ts:168`) is a module constant with no assertion
  tying it to `config.jwt.accessExpiresIn`. Still Low. Related to but distinct from **OF-07**
  (Dormant — rate-limit and AI-spend stores per-process without `REDIS_URL`); the revocation cache
  is a third per-process store with the same multi-instance caveat and should be named in OF-07's
  fact line at reactivation.
- **OF-09 — Access-token staleness check fails OPEN on DB error** — confirmed at
  `authService.ts:314-320`. The prior review recorded this as an Info-level accepted window; the
  ledger carries it as an Accepted Low with the re-eval trigger "any real incident involving
  revocation; a move to longer session lifetimes; re-rate at launch". No change. Note the deliberate
  asymmetry with `planGating`, which fails **closed** on the same kind of DB error
  (`planGating.ts:76-88`) — opposite postures, each documented, each defensible: failing open here
  avoids mass-logout on a blip, and a stale token cannot reach PHI during a real outage because PHI
  reads need the same DB.

---

## Checks passed

**§1 Access-token model + `jti`**
- [x] `generateAccessToken` mints `jti: uuidv4()` (`authService.ts:447`+); middleware reads
      `decoded.jti` and forwards it (`auth.ts:106`, `:163`, `:222`).
- [x] `jti` optional end-to-end — pre-M1 tokens authenticate and are matched by the cutoff alone.
- [x] Clamp windows derive from the same config used to sign (`accessTokenLifetimeMs()`), used at
      `authService.ts:215` and `:374`.
- [x] No verify path skips revocation. `grep` for `jwt.verify|verifyToken|verifyAccessToken` in
      `auth.ts` returns only the L22 tombstone comment (`auth.ts:247`) explaining that the unsafe
      `verifyToken` was removed. All three entrypoints run both layers.

**§2 Per-user cutoff — every stamping event**
- [x] All six stamping paths fire `revokeAllUserTokens` or an equivalent `tokensValidAfter` write,
      each followed by cache invalidation: logout-all, password change, password reset, email-change
      confirm, admin `updateUser` (folded into the same `user.update`), admin `deleteUser`.
- [x] Cutoff comparison is strict `<` at whole-second granularity, so the fresh token handed back by
      a password change survives its own cutoff.

**§3 Single-device revocation**
- [x] Single-device logout records a per-`jti` row and never stamps the per-user cutoff — verified by
      reading `revokeAccessTokenCrossInstance` end to end; it touches only `revokedAccessToken`.
- [x] Identity guard `decoded.id !== verifiedUserId` (`authService.ts:371`) — `jwt.decode` does not
      verify signatures, so this is load-bearing; the caller resolves `verifiedUserId` from a verified
      access token or a signature-checked refresh session.
- [x] Exp clamp: `Math.min(decoded.exp * 1000, maxExpMs)` with an already-expired short-circuit
      (`authService.ts:373-375`). A forged `exp=year-9999` cannot pin an unsweepable row.
- [x] `ENABLE` + `FORCE ROW LEVEL SECURITY` (`migration.sql:26-27`); tenant isolation covered by
      `rls.test.ts:264-290`.
- [x] Expired rows reaped by `cleanupExpiredSessions` (`authService.ts:1774`) on the 10-min interval;
      `expiresAt` indexed.
- *(The UPDATE-policy gap in this same table is F-4 above.)*

**§4 Refresh rotation + reuse**
- [x] Rotation is single-use and atomic: row lock → delete → re-insert in one transaction
      (`authService.ts:730-770`).
- [x] Discriminated `reuse | expired | inactive`; `expired` and `inactive` 401 with **no** family
      action — an expired token is explicitly not treated as a stolen one (`authService.ts:747-752`).
- [x] Reuse outside the grace window → `revokeAllUserTokens`; failure logged, not thrown, 401
      unchanged.
- [x] `markRecentRotation` is called **inside** the transaction before the lock releases
      (`authService.ts:770`), so the racing reuse is guaranteed to observe it; `getRecentRotation` is
      a non-deleting peek, so a 3-tab race cannot have one loser consume the mark and another trigger
      a spurious revoke.

**§5 Cache + cross-instance consistency**
- [x] One `fetchUserRevocationState` populates both cutoff and revoked-jti set under
      `withRLSContext(userId)` through `tx` (not bare `prisma.*`), cached per user for 15s.
- [x] Every stamping path invalidates the local cache, so the originating instance is immediate.
- [x] Cache is bounded — `sweepRevokedTokens` evicts entries older than the TTL on the 10-min
      interval (`authService.ts:240-250`).

**§6 Audit coverage**
- [x] Logout, logout-all, refresh-reuse (`LOGIN_FAILED` + `REFRESH_TOKEN_REUSE` + `familyRevoked`),
      admin actions, and password/email flows all audit. Reuse audit is best-effort and never blocks
      the 401.
- [x] No token material beyond `jti`, and no PHI, in any revocation log line.

**§7 Fail posture**
- [x] Stale-check fails open (OF-09); jti write and family revoke are best-effort; logout clears
      cookies unconditionally; the table is FORCE-RLS fail-closed.

---

## Unverifiable

- **Whether Prisma's `upsert` with `update: {}` emits an UPDATE at all** (F-4). Requires executing
  against Postgres under the NOBYPASSRLS role. This is now cheap — the `rls` CI job provisions
  exactly that role — and is the recommended next step rather than further static analysis.
- **Whether `applyUserConsolidation` aborts or continues when the history re-parent fails** (F-5).
  Requires the same runtime check. The ordering comment implies an abort is required for safety.

---

## Not applicable under current posture

- **§5 cross-instance convergence.** With a single process and no deployment, the ≤15s TTL window
  and the per-instance in-memory structures are exact, not approximate. F-3 and OF-14 re-acquire
  their meaning at launch, when ≥2 replicas exist.
- **§7 "confirm the 10-min cleanup actually runs in the deployed topology."** There is no deployed
  topology. The interval is wired (`startSessionCleanup`, `authService.ts:1800`); whether a Cloud Run
  instance stays alive long enough to tick it is a launch-time question. **Dormant** — reactivation
  severity Low, trigger: any deploy.

---

## Out of scope

- Login, lockout, cookies, demo gating, email/password flows — [03-authentication](./03-authentication-review.md).
- The maintenance jobs themselves — [45-maintenance-jobs](./45-maintenance-jobs-review.md); F-5 is
  handed to that owner.
- General RLS policy design — [01-database-schema](./01-database-schema-review.md). The policy
  inventory in F-5 is offered to that review as input.

---

## Recommended ledger entries

Proposed for `OPEN_FINDINGS.md` (the ledger owns final severity):

| Proposed | Title | Class | Suggested severity | Re-eval trigger |
|---|---|---|---|---|
| new | `revoked_access_tokens` has no RLS UPDATE policy but is written by `upsert` | correctness / RLS | Medium | Confirm-or-refute by running a double-revoke under the NOBYPASSRLS role; **launch blocker if confirmed** |
| new | `biomarker_history` + `goal_progress_history` UPDATEd by maintenance jobs with no UPDATE policy | correctness / data-loss risk | Low now, **High at launch** | Any `apply=true` maintenance run against a NOBYPASSRLS role |
| amend **OF-07** | Add the revocation-state cache (`TOKENS_VALID_AFTER_TTL_MS`) as a third per-process store | — | unchanged Dormant | unchanged |
| note on **OF-22** | Record the residual: the reuse branch cannot distinguish "rotated" from "invisible to me"; a non-locking existence re-check would separate infrastructure faults from compromise signals | — | closed, informational | — |
