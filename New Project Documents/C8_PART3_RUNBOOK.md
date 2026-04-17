# C-8 Part 3 — Production Cutover Runbook

**Status:** Not executed. Deferred until product is ready for launch.
**Blocking:** Closes C-8, the last Critical security finding.
**Prerequisites merged:** PRs #30, #32, #33, #34, #36, #37, #39, #40, #41, #42, #43.

---

## What this runbook does

Switches your backend from connecting to Postgres as a superuser (bypasses RLS) to connecting as a dedicated non-superuser role that RLS actually applies to. After this runbook completes, every tenant-isolation policy defined in `20260107_add_rls_policies` becomes a real database-enforced control instead of a dormant one.

---

## Why this exists (one-paragraph context)

The repo has row-level security policies on every PHI table. Those policies check `current_user_id()` and `is_admin_session()` against the app's session variables. However, Postgres unconditionally skips RLS for roles with `BYPASSRLS` or `SUPERUSER` attributes — and both Cloud SQL's `postgres` user and Railway's default `postgres` user have that. All seven preceding PRs in the C-8 sequence wrapped every database call in `withRLSContext` so the code is ready, but the runtime role bypasses RLS entirely. This runbook is the one-time infrastructure change that flips the switch.

---

## Pre-flight checklist

Before executing anything below, confirm:

1. **Master is green.**
   - `cd backend && npm test` → all passing.
   - `cd backend && npx tsc --noEmit` → exit 0.
   - No bare `prisma.*` writes: `Select-String -Pattern "prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b" -Path "backend\src\**\*.ts" | Select-String -NotMatch "tx\." | Select-String -NotMatch "mockPrisma"` returns nothing except the `createBiomarkersFromOCRResult` helper (which receives `tx` as parameter named `prisma` — documented false positive).

2. **Cloud SQL instance is reachable.**
   - `gcloud sql instances list --project=ownmyhealth-prod` shows `ownmyhealth-db` as `RUNNABLE` (not `SUSPENDED`). If suspended, un-suspend first: `gcloud sql instances patch ownmyhealth-db --activation-policy=ALWAYS --project=ownmyhealth-prod`. Wait for status to flip.

3. **You have a backup.** `gcloud sql backups list --instance=ownmyhealth-db --project=ownmyhealth-prod` shows a backup from within the last 24 hours. If not, create one: `gcloud sql backups create --instance=ownmyhealth-db --project=ownmyhealth-prod --description="Pre-C-8 Part 3 cutover"`.

4. **You have a rollback plan.** The rollback is: revert the `DATABASE_URL` secret in Secret Manager to its prior value (stored as an older version automatically). Full rollback takes ~2 minutes via `gcloud run services update-traffic` to flip to the previous revision.

5. **You are not doing this on a Friday afternoon.** This change affects the auth path of every request. If something is wrong, you want working hours and full attention, not a weekend on call.

---

## Step 1 — Provision the `omh_app` role on Cloud SQL

Connect to the database as the superuser. The simplest way is via `gcloud sql connect` (uses Cloud SQL Auth Proxy automatically):

```bash
gcloud sql connect ownmyhealth-db --user=postgres --database=ownmyhealth --project=ownmyhealth-prod
```

When prompted, enter the postgres password (stored in Secret Manager as `db-postgres-password` or similar — check your Secret Manager).

Once connected, run:

```sql
-- Create the application role (no superuser, no RLS bypass)
CREATE USER omh_app WITH LOGIN PASSWORD 'REPLACE_ME_WITH_A_STRONG_GENERATED_PASSWORD'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Grant minimum necessary privileges on the schema
GRANT USAGE ON SCHEMA public TO omh_app;

-- Grant CRUD on all existing tables and sequences
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omh_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO omh_app;

-- Grant execute on the RLS helper functions
GRANT EXECUTE ON FUNCTION current_user_id() TO omh_app;
GRANT EXECUTE ON FUNCTION is_admin_session() TO omh_app;
GRANT EXECUTE ON FUNCTION has_provider_access(uuid, text) TO omh_app;

-- For future migrations: newly created tables auto-grant to omh_app
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omh_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO omh_app;

-- Verify the role was created with the right attributes
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles
WHERE rolname IN ('postgres', 'omh_app')
ORDER BY rolname;
```

**Expected output of the last query:**

```
 rolname  | rolsuper | rolbypassrls | rolcreatedb | rolcreaterole
----------+----------+--------------+-------------+---------------
 omh_app  | f        | f            | f           | f
 postgres | t        | t            | t           | t
```

If `omh_app` shows `t` in any column other than what's expected, something went wrong — the `CREATE USER` or grants didn't apply cleanly. Drop the role (`DROP USER omh_app;`) and re-run.

**Before generating the password:** use a strong random generator. In PowerShell:
```powershell
[System.Web.Security.Membership]::GeneratePassword(32, 8)
```
Or run `openssl rand -base64 32` if you have OpenSSL installed. Store this password — you'll need it in Step 2.

Exit the psql session with `\q`.

---

## Step 2 — Store the new `DATABASE_URL` in Secret Manager

The connection string format is the standard Postgres URL. The host is whatever your current `DATABASE_URL` uses — check the existing secret first:

```bash
gcloud secrets versions access latest --secret=DATABASE_URL --project=ownmyhealth-prod
```

This prints the current connection string. It will look something like:
```
postgresql://postgres:OLD_PASSWORD@34.172.83.230:5432/ownmyhealth
```

Construct the new one with the same host, port, and database name, but different user and password:
```
postgresql://omh_app:NEW_PASSWORD_FROM_STEP_1@34.172.83.230:5432/ownmyhealth
```

Add it as a new secret version:

```bash
echo -n "postgresql://omh_app:NEW_PASSWORD@34.172.83.230:5432/ownmyhealth" | \
  gcloud secrets versions add DATABASE_URL --data-file=- --project=ownmyhealth-prod
```

**Important:** do NOT delete the old secret version. Secret Manager keeps versions automatically. The old one is your rollback path.

Verify:
```bash
gcloud secrets versions list DATABASE_URL --project=ownmyhealth-prod
```

You should see the new version at the top, marked as `ENABLED`. The previous version is still enabled but no longer the "latest".

---

## Step 3 — Redeploy the backend

Cloud Run services don't automatically pick up new secret versions — they read the secret at container start. You need to force a new revision.

Option A (simplest): push any commit to master, let the GitHub Actions deploy workflow run.

Option B (if you want to redeploy without a code change): 
```bash
gcloud run services update ownmyhealth-backend \
  --region=us-central1 \
  --project=ownmyhealth-prod \
  --update-env-vars=REDEPLOY_TRIGGER=$(date +%s)
```

This adds a harmless env var with a timestamp, which forces a new revision.

**Critical — watch the deploy logs:**

```bash
gcloud run services logs tail ownmyhealth-backend --region=us-central1 --project=ownmyhealth-prod
```

Look for the startup banner:
```
✓ Prisma client created
✓ Database connected
✓ Encryption service initialized
✓ All database services initialized
🏥  OwnMyHealth API Server
```

If you see those lines, the new role works. If you see a FATAL error instead, see "Rollback" below.

---

## Step 4 — Verify RLS is actually enforcing

The whole point of this runbook is that RLS is now live. Prove it with a direct database query:

```bash
gcloud sql connect ownmyhealth-db --user=omh_app --database=ownmyhealth --project=ownmyhealth-prod
```

(Use the password you generated in Step 1.)

Once in:
```sql
-- Without setting a user context, RLS should deny reads on user-owned tables.
SELECT COUNT(*) FROM biomarkers;
-- Expected: 0 rows (or ERROR: permission denied), NOT the total row count.

-- With admin context, RLS should permit reads.
SET LOCAL app.is_admin = 'true';
SELECT COUNT(*) FROM biomarkers;
-- Expected: actual row count.
```

If the first query returns the actual count (not 0), RLS is NOT enforcing. Something is wrong — the policies may not be enabled on the table, or `omh_app` may still have `BYPASSRLS` somehow. Rollback and investigate.

Exit with `\q`.

---

## Step 5 — Enable the startup assertion (one-time code change)

To prevent this from silently regressing if someone ever switches the DB URL back to a superuser, add a startup assertion that refuses to boot in production under a BYPASSRLS role.

See the separate file `C8_PART3_STARTUP_ASSERTION.md` in this directory for the code to add to `backend/src/services/database.ts`. This is a small code change (~15 lines), committed as its own PR.

**Do this step AFTER the runbook succeeds**, not before. If you add the assertion first and the DB URL is still superuser, the app refuses to boot and you've broken production. Order matters: cutover first, then assertion.

---

## Step 6 — Post-cutover validation

Over the next 24 hours, watch for:

1. **Error rate in Cloud Run logs.** Filter for 500s: should be comparable to pre-cutover baseline. A spike means some code path hit an RLS denial we didn't catch.

2. **Specific audit-log pattern.** Query the audit_logs table for any unusual SYSTEM-type entries around the cutover time — those would indicate the app fell back to admin context unexpectedly.

3. **The `/health` endpoint.** Should return 200 consistently.

If all three are clean after 24 hours, update:
- `New Project Documents/SECURITY_STATUS.md` — move C-8 from "Open" to "Closed" with the cutover date.
- `New Project Documents/HIPAA_CHECKLIST.md` — §164.312(a) Access Control goes from 🟡 to ✅.
- `New Project Documents/SECURITY_AUDIT_infrastructure.md` — add a closing note on F-1.

---

## Rollback

If the deploy in Step 3 fails or Step 4 shows RLS isn't enforcing:

```bash
# Find the previous secret version (should be the one before "latest")
gcloud secrets versions list DATABASE_URL --project=ownmyhealth-prod

# Disable the new version; the previous version becomes latest again
gcloud secrets versions disable <NEW_VERSION_NUMBER> --secret=DATABASE_URL --project=ownmyhealth-prod

# Force another redeploy to pick up the old secret
gcloud run services update ownmyhealth-backend \
  --region=us-central1 \
  --project=ownmyhealth-prod \
  --update-env-vars=REDEPLOY_TRIGGER=$(date +%s)
```

The backend should come back up connecting as `postgres` (the old role) within ~60 seconds.

To clean up the failed attempt:
```sql
-- Connect as postgres
DROP USER omh_app;  -- or keep it for the next attempt
```

Figure out what went wrong before trying again. Most likely causes:
- A bare `prisma.*` call slipped through the C-8 code sweep — find it via logs, wrap it, redeploy, retry.
- A migration added a table after C-8 code landed but before cutover, and the table doesn't have `GRANT` for `omh_app`. Fix: re-run the grants from Step 1.
- An unexpected RLS policy is stricter than anticipated. Debug by connecting as `omh_app` and manually reproducing the failing query.

---

## Done

Once Steps 1-5 succeed and 24 hours of post-cutover validation is clean, C-8 is closed. That closes the last Critical finding in the security audit. You're production-ready from a Critical-severity security perspective.

Remaining work after C-8:
- High and Medium findings from the audit docs.
- Beta-launch prep (penetration test, risk assessment, breach notification plan — all tracked in SECURITY_STATUS.md).

---

## Appendix — If you're coming back to this after months

If significant time has passed since this runbook was written:

1. Re-run the pre-flight checklist. The repo may have drifted.
2. Check if any new Prisma models were added — they'll need `GRANT` statements.
3. Check if the `20260107_add_rls_policies` migration has new siblings. Any new RLS policies should follow the same `current_user_id() OR is_admin_session()` pattern; non-conforming policies may block `omh_app`.
4. Verify `withRLSContext` is still the canonical wrapper name — refactors happen.
5. This runbook assumes Cloud SQL + Cloud Run. If you've migrated to a different platform (Railway, Supabase, self-hosted), the concepts transfer but the commands don't. The core principle — "create a NOBYPASSRLS role, rotate DATABASE_URL" — is platform-agnostic.
