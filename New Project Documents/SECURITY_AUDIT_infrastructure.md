# Infrastructure Security Audit — 2026-04-16

## Scope
Files reviewed: `backend/.env`, `backend/.env.example`, `backend/.env.production.example`, `backend/railway.toml`, `backend/src/services/database.ts`, `backend/prisma/migrations/20260107_add_rls_policies/migration.sql`, `backend/src/services/auditLog.ts`, `.github/workflows/deploy.yml`. Out-of-band verification: a local Postgres 16 container seeded with the full migration chain, queried as both the default `postgres` role and a newly created `NOBYPASSRLS` role.

This audit covers infrastructure-level concerns (database role model, connection identity, secret provisioning) that the code-only audits (core/periphery/domain) did not surface because they're defined outside the repo — in the Cloud SQL / Railway managed-Postgres defaults and in the `DATABASE_URL` that those platforms inject.

## Summary
| Severity | Count |
|---|---|
| Critical | 1 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 0 |

## Findings

### F-1 (C-8) — RLS policies inert at runtime: app connects as a BYPASSRLS role — Critical
- **Prompt:** Surfaced out-of-band during C-1 regression testing in PR #30. Not produced by any of the existing prompts 01–32 — they review application code, not database role provisioning.
- **Location:** Infrastructure (Cloud SQL instance + Railway Postgres plugin); repo-side evidence: `backend/.env` (DATABASE_URL), `backend/.env.production.example` (Railway auto-injection note), `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` (policies that never fire), `backend/src/services/auditLog.ts:106,114` (compounding dependency — see F-2 context below).
- **Observation:** The Row-Level Security policies defined in migration `20260107_add_rls_policies` never actually fire at runtime because the Postgres role the application connects as has the `rolbypassrls = true` attribute. Postgres unconditionally skips RLS policies for roles with BYPASSRLS. The policies are structurally correct, compile cleanly, are enabled on every PHI table, and would enforce tenant isolation correctly if the app connected as a role without BYPASSRLS — but that is not the current state in either dev or prod.

  Evidence chain (no remote DB access needed):
  - `backend/.env`: `DATABASE_URL="postgresql://postgres:***@34.172.83.230:5432/ownmyhealth"` — app connects as `postgres` on the Cloud SQL dev instance. On Cloud SQL for PostgreSQL, the `postgres` user is automatically a member of the `cloudsqlsuperuser` role, which has `BYPASSRLS` granted. (Google Cloud documentation: "The `cloudsqlsuperuser` role has the `CREATEROLE`, `CREATEDB`, `LOGIN`, and `BYPASSRLS` attributes.")
  - `backend/.env.production.example`: production is Railway; `DATABASE_URL` is auto-injected by the Railway Postgres plugin. Railway's managed Postgres ships the default `postgres` user as a full superuser (`rolsuper=t`, which unconditionally implies RLS bypass). No provisioning step in this repo creates a less-privileged role.
  - No `CREATE ROLE` / `CREATE USER` anywhere in the repo (migrations, scripts, app code, workflow files). There is no deployment step that downgrades the runtime role.
  - Local reproduction: Postgres 16 in Docker, querying as the same role the app uses:

    ```
    $ docker exec omh-pg psql -U postgres -d omh -c \
        "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles \
         WHERE rolname IN ('postgres', 'omh_app', 'cloudsqlsuperuser') ORDER BY rolname;"

     rolname  | rolsuper | rolbypassrls
    ----------+----------+--------------
     omh_app  | f        | f
     postgres | t        | t
    (2 rows)
    ```

    `omh_app` is a role I created manually with `NOSUPERUSER NOBYPASSRLS` so the regression test in PR #30 could actually exercise the RLS policies. The default role everything else runs as (`postgres`) has both attributes set.

- **Impact:**
  - **Tenant isolation is carried by application-level `where: { userId }` filters only.** Any controller that omits such a filter, or any future refactor that removes one, becomes a live cross-tenant read or write — there is no database-side backstop. This is the exact failure mode RLS is designed to prevent.
  - **The C-1 fix in PR #30 is necessary but inert until this is addressed.** C-1 fixed `SET LOCAL` running outside a transaction so that `app.current_user_id` is actually set at query time. But the RLS policies that consume `app.current_user_id` never fire under the BYPASSRLS role — the whole control stack is off at runtime.
  - **Compliance posture is weaker than HIPAA_CHECKLIST.md claims.** The §164.312(a) Access Control checkbox was green in part because RLS was assumed to be enforcing access control at the database layer. It is not.
  - **Detection is poor.** A missed application-layer filter doesn't throw, doesn't log, and doesn't show up in audit logs as an RLS violation — it just returns the wrong rows.
- **Fix (infrastructure + code, out of scope for this PR — filed for a follow-up):**
  1. **Code prerequisite (blocker):** `auditService.initialize()` at `backend/src/services/auditLog.ts:106,114` currently does bare `prisma.systemConfig.findUnique` / `.create` without an RLS wrapper. Against a `NOBYPASSRLS` role, `findUnique` returns null (blocked by the admin-only SELECT policy on `system_config`) and `create` fails the INSERT policy — server startup will crash. Must be wrapped in `withRLSContext(null, …, { isAdmin: true })` (or the salt moved to Secret Manager and the `system_config` row dropped) **before** the role cutover.
  2. **Audit the bare-prisma call sites.** PR #30 identified 24 `prisma.<model>.(create|update|delete|...)` call sites outside any RLS wrapper (`authService.ts` × 13, `userEncryption.ts` × 3, `adminRoutes.ts` × 3, `patientRoutes.ts` × 3, `providerRoutes.ts` × 1, `uploadController.ts` × 1). Each needs to either (a) be wrapped in `withRLSContext(null, …, { isAdmin: true })` for legitimate admin-scope operations (most of `authService.ts`, all of `userEncryption.ts`) or (b) be wrapped in `withRLSContext(userId, …)` for user-scoped operations (the `providerPatient` writes, `biomarker.create` in `uploadController.ts`). Under a BYPASSRLS role these all silently succeed; under `NOBYPASSRLS` they fail.
  3. **Provision a non-privileged app role** on both Cloud SQL and Railway:

     ```sql
     CREATE USER omh_app WITH LOGIN PASSWORD '<rotated>' NOSUPERUSER NOBYPASSRLS;
     GRANT USAGE ON SCHEMA public TO omh_app;
     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omh_app;
     GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO omh_app;
     GRANT EXECUTE ON FUNCTION current_user_id(), is_admin_session() TO omh_app;
     ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omh_app;
     ```

     Migrations continue to run as `postgres` (owns tables, can `ALTER`, can `CREATE POLICY`); the app connects as `omh_app` for runtime queries.
  4. **Rotate `DATABASE_URL`** in GCP Secret Manager (dev/staging) and Railway variables (prod) to use `omh_app`. Stage the cutover behind a feature flag or canary if possible so the audit-init prerequisite can be rolled back quickly if it trips.
  5. **Add a startup assertion.** On boot, issue `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user` and refuse to start if it returns `t` in `NODE_ENV=production`. Keeps this from silently regressing.
  6. **Add an integration test** (beyond the single-file regression test in `backend/src/services/rls.test.ts`) that loops over every controller endpoint with two distinct users and asserts cross-tenant reads are blocked. Only meaningful once the role cutover is complete.
- **Context / sequencing.** This finding is the blocker for claiming RLS as a live compliance control. It does not need to ship with PR #30 (which is purely application-side code correctness and stands on its own as defense-in-depth). But until C-8 is closed, **do not cite RLS as an enforced access control** in HIPAA_CHECKLIST or SECURITY_STATUS — the policies are inert.

---

## Related — not separate findings, already tracked elsewhere
- **Audit-service initialization will fail under a `NOBYPASSRLS` role** (`backend/src/services/auditLog.ts:106,114`). This is the code-side prerequisite to C-8's infrastructure remediation and is already flagged in PR #30's description. Not filed as its own severity because it is only observable as a symptom of fixing C-8 — under the current BYPASSRLS posture, the code path works fine.
- **24 bare `prisma.*` writes outside any RLS wrapper.** Enumerated in PR #30's "Follow-up" section. Not filed as a Critical on their own — under the current BYPASSRLS posture they work fine; they become live failures only at the moment of the role cutover, which is why they are scoped as the sweep that must precede the cutover.
