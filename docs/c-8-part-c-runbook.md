# C-8 Part C Runbook — DB Role Cutover

**Status:** DRAFT. Read before executing. Do not execute top-to-bottom in one sitting.

**Goal:** Make PostgreSQL RLS policies actually enforce at runtime by switching the app from a `BYPASSRLS` role to a `NOSUPERUSER NOBYPASSRLS` role (`omh_app`).

**Why it matters:** Every `CREATE POLICY` in `20260107_add_rls_policies` is silently bypassed today because the app connects as `cloudsqlsuperuser` (dev) or `postgres` (prod). Tenant isolation is carried by application-level `where: { userId }` filters only. Any missed filter = live cross-tenant bug. This runbook closes that gap.

**Prerequisite:** Parts A and B already shipped — `auditService.initialize()` and all known `prisma.*` call sites are wrapped in `withRLSContext`. Verified in today's deploy.

**Blast radius if it goes wrong:** App cannot read/write the database. Every request 500s until `DATABASE_URL` is rotated back to the old role.

**Estimated time:** 2-4 hours spread across sessions. Do not attempt in one sitting.

---

## Phase 0 — Pre-flight (before you touch anything)

### 0.1 Know your dev environment
Run `echo $DATABASE_URL` (or check `backend/.env`). Identify:
- Host — `localhost`? Cloud SQL?
- Role — the `user` portion of `postgresql://user:pass@host/db`

**Stop and record the answer.** Everything downstream assumes you know this.

### 0.2 Know your prod environment
```bash
gcloud secrets versions access latest --secret=DATABASE_URL --project=ownmyhealth-prod \
  | sed 's/:[^@]*@/:REDACTED@/'
```
The `sed` strips the password between `:` and `@`, leaving protocol + user + host + db visible. (Previous draft used `head -c 80`, which leaks most of a 32-byte base64 password.)

### 0.3 Snapshot prod DB before anything else
```bash
# Cloud SQL automated backup — trigger one manually
gcloud sql backups create \
  --instance=<cloud-sql-instance-name> \
  --project=ownmyhealth-prod \
  --description="pre-C-8-Part-C cutover $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```
Wait until `gcloud sql backups list --instance=<instance>` shows it as `SUCCESSFUL`. This is your nuclear rollback option.

### 0.4 Read the RLS policy migration
```bash
cat backend/prisma/migrations/20260107_add_rls_policies/migration.sql
```
Identify every table that has `ENABLE ROW LEVEL SECURITY`. As of today: **16 tables** — `users`, `sessions`, `user_encryption_keys`, `biomarkers`, `biomarker_history`, `insurance_plans`, `insurance_benefits`, `dna_data`, `dna_variants`, `genetic_traits`, `health_needs`, `health_goals`, `goal_progress_history`, `provider_patients`, `audit_logs`, `system_config`.

### 0.5 Confirm current role actually has BYPASSRLS
Connect to the dev DB and run:
```sql
SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```
**Expected:** `rolbypassrls = t`. Confirms the problem we're fixing is real.

### 0.6 Gating PR — split DATABASE_URL_MIGRATIONS from DATABASE_URL

**This PR must land and deploy cleanly before Phase 1 starts.** It does not change any runtime behavior but is a hard prerequisite for everything after.

**Why:** `backend/Dockerfile:51` runs `npx prisma migrate deploy && node dist/app.js` as the app user. Once Phase 4 flips the app user to `omh_app` (which has no DDL privileges), the next deploy with any DDL in it crash-loops prod before the app ever starts. We need migrations to run under a separate superuser connection string, owned by CI / a pre-deploy step, not the runtime container.

**Changes:**
1. Remove `npx prisma migrate deploy` from the Dockerfile `CMD`. New `CMD`: `["node", "dist/app.js"]`.
2. Add a `migrate-prod` step in `.github/workflows/deploy.yml` that runs **before** `deploy`:
   ```yaml
   migrate-prod:
     needs: build-and-stage
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with: { node-version: '20' }
       - run: npm ci
         working-directory: backend
       - run: npx prisma migrate deploy --schema=prisma/schema.prisma
         working-directory: backend
         env:
           DATABASE_URL: ${{ secrets.DATABASE_URL_MIGRATIONS }}
   ```
3. Create a new GitHub Actions secret `DATABASE_URL_MIGRATIONS` containing a connection string for the **existing superuser** (pre-cutover: same role as `DATABASE_URL`; post-cutover: still the superuser, not `omh_app`).
4. `deploy` step `needs: [build-and-stage, migrate-prod]`.

**Acceptance for this PR:**
- CI green (lint + test + build + audit — all from PR #52's gate).
- Next deploy of any commit through the new pipeline succeeds: migrations run in the `migrate-prod` job, Docker image boots with `node dist/app.js` only, prod `/health` stays 200.
- At least one deploy post-merge confirms the pipeline works end-to-end.

**Only after Phase 0.6 is live and proven** do you proceed to Phase 1. Otherwise Phase 4 has no clean path for future schema changes.

**Stop here** and review everything above before continuing.

---

## Phase 1 — Dev DB (local or Cloud SQL dev)

Do this first. Get the grants list right here. Get the code change right here. Only then touch prod.

### 1.1 Create the new role on dev

Connect as superuser:
```sql
-- Run as the current superuser (cloudsqlsuperuser or postgres)
CREATE ROLE omh_app WITH
  LOGIN
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEDB
  NOCREATEROLE
  PASSWORD '<generate-strong-password>';

-- Verify
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
FROM pg_roles WHERE rolname = 'omh_app';
-- Expected: rolsuper=f, rolbypassrls=f, rolcreatedb=f, rolcreaterole=f, rolcanlogin=t
```

Generate the password with `openssl rand -base64 32`. Store it somewhere you can retrieve it for Phase 1.3 and eventually Phase 2.4 (different password for prod).

### 1.2 Grant the minimum privileges

```sql
-- Schema access
GRANT USAGE ON SCHEMA public TO omh_app;

-- Read/write on every existing table
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omh_app;

-- Sequences (Prisma uses these for autoincrement IDs, if any)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO omh_app;

-- Future objects created by migrations must auto-grant
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omh_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO omh_app;
```

**Do NOT** grant `ALL PRIVILEGES` or any `CREATE` or `ALTER` permission. `omh_app` must be runtime-only. Migrations run as the superuser via `DATABASE_URL_MIGRATIONS` (wired up in Phase 0.6).

### 1.3 Verify grants against all 16 RLS-enabled tables

Single query — counts table/privilege rows for `omh_app` and shows the total. The final row tells you whether the grant list is complete.

```sql
WITH expected_tables(name) AS (
  VALUES
    ('users'), ('sessions'), ('user_encryption_keys'),
    ('biomarkers'), ('biomarker_history'),
    ('insurance_plans'), ('insurance_benefits'),
    ('dna_data'), ('dna_variants'), ('genetic_traits'),
    ('health_needs'), ('health_goals'), ('goal_progress_history'),
    ('provider_patients'), ('audit_logs'), ('system_config')
),
grants_per_table AS (
  SELECT
    e.name AS table_name,
    COUNT(g.privilege_type) FILTER (
      WHERE g.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
    ) AS priv_count,
    string_agg(g.privilege_type, ',' ORDER BY g.privilege_type) AS privileges
  FROM expected_tables e
  LEFT JOIN information_schema.role_table_grants g
    ON g.table_name = e.name
    AND g.grantee = 'omh_app'
    AND g.table_schema = 'public'
  GROUP BY e.name
)
SELECT table_name, priv_count, privileges
FROM grants_per_table
WHERE priv_count <> 4
UNION ALL
SELECT 'TOTAL', SUM(priv_count)::int, CASE WHEN SUM(priv_count) = 64 THEN 'PASS' ELSE 'FAIL' END
FROM grants_per_table
ORDER BY table_name NULLS LAST;
```

**Expected result: exactly one row — `TOTAL | 64 | PASS`.** Any other row in the output is a table with missing privileges; fix its grant and re-run until only the TOTAL row remains.

### 1.4 Test Prisma against the new role

Update `backend/.env` locally:
```diff
-DATABASE_URL=postgresql://<old-role>:<old-pw>@localhost/ownmyhealth
+DATABASE_URL=postgresql://omh_app:<new-pw>@localhost/ownmyhealth
```

Then:
```bash
cd backend
npm run test 2>&1 | tail -40
```

**Possible outcomes:**

**(a) Happy path** — all tests pass, including the 3 RLS tenant-isolation tests in `src/services/rls.test.ts` that fail today on `origin/master`. RLS is now actually enforcing; the tests were written to prove exactly that.

**(b) Tests fail with `permission denied for table X`** — a grant is missing. Add the grant to 1.2, re-run 1.3, re-run the tests.

**(c) Tests fail with `permission denied for sequence X`** — sequence grant missing, same pattern.

**(d) Server doesn't boot** — `auditService.initialize()` or some other startup path is trying to write as `omh_app` in a context that can't. This is what Part A was supposed to catch. If this happens, stop and investigate — do not proceed to prod.

**(e) Server boots but 500s immediately on first request** — some `prisma.*` call site outside an `withRLSContext` wrapper. Part B missed one. Grep for `prisma\.` outside `withRLSContext` / `withRLSTransaction` usage and fix before proceeding.

**(f) The 3 RLS tests still fail with the SAME error they fail with today** (`expected length 1, got 2`) — RLS is not enforcing. Either the role grant didn't take, or your `DATABASE_URL` is still on the old role. Re-check `SELECT current_user` inside a Prisma query.

### 1.5 Run the RLS integration tests as the acceptance gate

```bash
cd backend
npx vitest run src/services/rls.test.ts --reporter=verbose
```

The 3 tests that fail on `origin/master` today (per PR #52 verification):
- `user A sees only their row when no where-filter is applied`
- `user B sees only their row when no where-filter is applied`
- `queries across pooled connections do not leak context between calls`

**Acceptance: all 3 now pass.** If any still fail, the role cutover didn't work — investigate before Phase 2.

### 1.6 Commit the dev work (code only, not the .env change)

At this point you have:
- No code change yet (dev is running on the new role, configured via `.env`)
- You've verified the grants list is complete
- You've proven the 3 RLS tests pass under the new role

**Do not commit anything yet.** You need the startup assertion (Phase 3). But you now know it'll work.

---

## Phase 2 — Provision prod role

Only proceed if Phase 1 fully succeeded. If Phase 1 is still debugging, stop.

### 2.1 Connect to Cloud SQL prod as superuser
```bash
gcloud sql connect <instance-name> --database=<db-name> --user=postgres --project=ownmyhealth-prod
```

### 2.2 Create `omh_app` on prod — same SQL as 1.1, new password

Generate a different password: `openssl rand -base64 32`. Do not reuse the dev password.

Run the same `CREATE ROLE` + `GRANT` sequence from 1.1 and 1.2.

### 2.3 Verify grants on prod

Run the **same single 16-table verification query from Phase 1.3**. Expected result: exactly one row — `TOTAL | 64 | PASS`.

### 2.4 Do NOT rotate `DATABASE_URL` yet

The prod role now exists but nothing uses it. Prod is still running on the old role. This is a safe waypoint — you can leave things here indefinitely and nothing changes behavior.

**Stop here** and commit Phase 3's code change in a separate session. You want the code live in prod before the role cutover, not during it.

---

## Phase 3 — Code PR: startup assertion (feature-flagged)

**Phase 3.2 from the original draft (the role migration file) has been dropped.** Grants are applied out-of-band as superuser in Phases 1.2 and 2.2. No Prisma migration touches grants. Rationale: `GRANT` requires the grantor to hold the privilege WITH GRANT OPTION; `omh_app` has neither, so any GRANT inside a Prisma migration would fail once migrations run under `DATABASE_URL_MIGRATIONS` as the superuser (which does have the privilege) — actually wait, that works fine. But it still conflates runtime concerns with one-time provisioning, and the idempotent check-then-abort pattern adds complexity for no upside. Cleaner to keep grants as a human/IaC concern and keep Prisma migrations purely about schema.

### 3.1 Startup assertion (feature-flagged)

`backend/src/app.ts` (or wherever the server bootstraps):

```ts
// Add after config load, before server start
if (config.isProduction && process.env.ASSERT_NOBYPASSRLS === 'true') {
  const prisma = getPrismaClient();
  const result = await prisma.$queryRaw<{ rolbypassrls: boolean }[]>`
    SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  if (result[0]?.rolbypassrls === true) {
    throw new Error(
      'FATAL: Database role has BYPASSRLS. RLS policies are not enforced. ' +
      'DATABASE_URL must point at a non-superuser role in production. ' +
      'See C-8 Part C runbook.'
    );
  }
  logger.startup('✓ DB role verified as NOBYPASSRLS');
}
```

The flag defaults off. Ship the code. Phase 4 flips `ASSERT_NOBYPASSRLS=true` at the same time as the `DATABASE_URL` rotation. Until then, the assertion is dormant and cannot regress prod.

### 3.2 Test locally

```bash
cd backend
npm run test
npm run build
npm run lint
```

All pass. Specifically confirm the 3 RLS tests still pass (they should — your local dev `DATABASE_URL` still points at `omh_app`).

### 3.3 PR and merge

Branch: `fix/c-8-part-c-rls-role-assertion`.

In the PR description, reference this runbook. Note that prod will not change behavior when this merges — the flag is off, so the assertion doesn't fire. The assertion gates the cutover in Phase 4.

**Land this PR and let it deploy through the normal pipeline.** Watch the deploy. Confirm:
- `build-and-stage` green
- `migrate-prod` green (no-op unless your PR touched the schema)
- `smoke-test` green
- `promote` green
- Prod `/health` still returns 200

---

## Phase 4 — The cutover

This is the moment. Everything before was setup. This step changes what prod connects as.

### 4.1 Confirm dev has been stable on `omh_app` for at least 24 hours

You've been running dev against `omh_app` since Phase 1. If anything subtle broke — a missed grant, a Prisma query that silently requires a privilege you didn't grant — 24 hours of normal dev use should have surfaced it.

If dev has had issues you haven't fully resolved, stop.

### 4.2 Confirm Phase 3 PR is live in prod
```bash
gcloud run services describe ownmyhealth-backend \
  --region=us-central1 \
  --format='value(spec.template.spec.containers[0].image)'
```
Expect the image SHA matching the Phase 3 merge commit.

### 4.3 Rotate `DATABASE_URL` in Secret Manager

```bash
# Build the new URL — omh_app + prod password + same host/db
NEW_URL='postgresql://omh_app:<prod-pw>@<host>/<db>?schema=public'

echo -n "$NEW_URL" | gcloud secrets versions add DATABASE_URL \
  --project=ownmyhealth-prod \
  --data-file=-
```

This creates a new secret version. Cloud Run is not yet using it — it's pinned to whatever version was live when the service was last deployed.

**Do NOT touch `DATABASE_URL_MIGRATIONS`.** It stays on the superuser so future migrations keep working.

### 4.4 Flip the assertion flag, force Cloud Run to pull the new secret, and tag the new revision

```bash
gcloud run services update ownmyhealth-backend \
  --region=us-central1 \
  --project=ownmyhealth-prod \
  --update-env-vars=ASSERT_NOBYPASSRLS=true \
  --tag=rls-cutover \
  --no-traffic
```

The `--tag=rls-cutover` assigns a named traffic tag to the new revision, which gives it a stable tagged URL reachable at **0% traffic**. Without a tag you cannot smoke-test a zero-traffic revision — it has no reachable endpoint.

The `--no-traffic` makes the no-traffic behavior explicit (in case the service isn't pinned, which today's gotcha showed can be inconsistent).

### 4.5 Smoke-test the new revision via its tagged URL

```bash
# Resolve the tagged URL — gcloud prints it under spec.traffic[].url for the tag
TAGGED_URL=$(gcloud run services describe ownmyhealth-backend \
  --region=us-central1 \
  --format='value(status.traffic[?(@.tag="rls-cutover")].url)')
echo "$TAGGED_URL"

curl -sS "$TAGGED_URL/api/v1/health"
```

**Expected:** 200 with success body, AND the startup logs show `✓ DB role verified as NOBYPASSRLS`.

Check logs:
```bash
gcloud run services logs read ownmyhealth-backend \
  --region=us-central1 \
  --limit=100 | grep -iE "NOBYPASSRLS|FATAL|role"
```

**If the assertion fires (`FATAL: Database role has BYPASSRLS`):** the new secret version didn't propagate, or Cloud Run is still using the old secret. Stop. Do not shift traffic. Investigate.

**If the revision 500s on /health:** missing grant. Look at logs for the exact Postgres error. Fix the grant on prod (as superuser), redeploy, retry.

### 4.6 Shift traffic

Only if 4.5 fully succeeded:

```bash
# 10% first
NEW_REV=$(gcloud run services describe ownmyhealth-backend \
  --region=us-central1 \
  --format='value(status.latestReadyRevisionName)')

gcloud run services update-traffic ownmyhealth-backend \
  --region=us-central1 \
  --to-revisions=$NEW_REV=10
```

Watch logs for 5 minutes. Look for any `permission denied` errors.

If clean, 50%, wait 5 min, then 100%.

### 4.7 Verify the cutover took

```bash
# From inside a prod-connected psql session, or via a one-off query in the app:
SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Expected: omh_app, rolbypassrls = f
```

### 4.8 Retire the old role

**Not today.** Leave it in place for at least a week as a rollback option. Schedule its removal for a future maintenance window.

---

## Rollback procedures

**If Phase 4.5 fails:** no traffic shifted, nothing to roll back. Drop the new revision, investigate.

**If Phase 4.6 shows errors during partial rollout:**
```bash
gcloud run services update-traffic ownmyhealth-backend \
  --region=us-central1 \
  --to-revisions=<PRE-CUTOVER-REVISION>=100
```
Instant rollback to the previous revision, which is still using the old `DATABASE_URL` secret version.

**Then:** rotate `DATABASE_URL` back to the old role (`gcloud secrets versions add` with the old URL). The old secret version still exists — `gcloud secrets versions list` to find it.

**If things go deeply wrong:** Phase 0.3's backup is your nuclear option. Restoring from it loses any writes since the backup was taken.

---

## What NOT to do

- Do not grant `ALL PRIVILEGES` to `omh_app`. If it works with `ALL`, you missed figuring out what it actually needs — fix the tests, don't mask the problem.
- Do not skip Phase 0.6. Without the migration-runner split, Phase 4 leaves prod one DDL migration away from a crash-loop.
- Do not skip Phase 1 (dev). The grants list is the single most error-prone part, and prod is not the place to discover you forgot one.
- Do not do Phase 2 and Phase 4 in the same session. Separate them by at least a few hours. You want to be fresh for Phase 4.
- Do not flip `ASSERT_NOBYPASSRLS=true` before `DATABASE_URL` is rotated. The assertion will fire, boot will fail, and the rollback is "flip the flag off" — which is fine, but avoidable.
- Do not retire the old role in the same PR as the cutover. Keep it as a rollback vehicle for at least a week.

---

## Open questions for Brian before executing

1. **Dev DB host** — `backend/.env` shows `@127.0.0.1:5433` (Cloud SQL Proxy to dev) + `34.172.83.230:5432` (direct IP, prod). Phase 1 assumes the proxy target is the dev instance. Confirm.
2. **Cloud SQL admin access** — can't answer from the repo. Check:
   ```
   gcloud projects get-iam-policy ownmyhealth-prod \
     --flatten=bindings \
     --filter='bindings.members:breilly1296@pm.me'
   ```
   Need `cloudsql.client` + `cloudsql.instances.connect` at minimum. Superuser psql access for Phase 2.1 requires either a Cloud SQL IAM-superuser binding or the `postgres` password from Secret Manager.
3. **Existing deploy pipeline compatibility** — Phase 0.6 adds a `migrate-prod` job upstream of `deploy`. The existing `deploy.yml` (PR #51) needs to cleanly accept the new `needs:` graph. Verify before writing the gating PR.
