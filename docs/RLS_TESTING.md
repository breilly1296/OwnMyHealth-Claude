# Testing Row-Level Security (RLS)

OwnMyHealth enforces tenant isolation at the database layer with PostgreSQL
Row-Level Security. RLS only does anything when the connecting role is **not** a
superuser and does **not** have `BYPASSRLS`. Dev and staging connect as the
`postgres` superuser, so **RLS is silently disabled there** and policy
regressions can ship undetected. This harness runs the RLS suite against a real
`NOBYPASSRLS` role so those regressions surface — in CI on every PR, and locally
on demand.

## What runs

`backend/src/services/rls.test.ts` (`npm run test:rls`) covers:

- **Own-data isolation** — user A sees only A's rows, B sees only B's, with no
  `where: { userId }` filter (proves the policy, not the query, is isolating).
- **Admin context** sees all tenants.
- **No cross-call context leak** across pooled connections.
- **Provider-consent access** — a provider with an `ACTIVE`, `canViewBiomarkers`
  consent reads the patient's biomarker through `has_provider_access()`; a
  provider with no consent (or expired consent) sees nothing.

The suite **skips** unless `DATABASE_URL` and `PHI_ENCRYPTION_KEY` are set, so
ordinary unit-only runs stay green.

> The provider-consent path exercises `has_provider_access()`. That function was
> broken (referenced the dropped `provider_patients.can_view_dna` column) and
> threw for *any* permission type under a NOBYPASSRLS role — which also broke the
> own-data reads, since `biomarkers_select` evaluates it for every non-owned row.
> Fixed in migration `20260529_fix_has_provider_access`. This harness is what
> makes that class of regression visible.

## CI

The `rls` job in `.github/workflows/ci.yml`:

1. Starts a `postgres:16` service.
2. `prisma migrate deploy` as the **superuser** (it must own the tables so the
   app role has RLS enforced against it).
3. Applies `backend/prisma/rls-test-role.sql` to create the `omh_app`
   `NOBYPASSRLS` role with table/sequence grants.
4. Runs `npm run test:rls` with `DATABASE_URL` pointing at `omh_app`.

## Locally

Requires Docker running.

```bash
bash backend/scripts/setup-rls-test-db.sh        # postgres:16 on :5433, migrated, omh_app provisioned

# from backend/
DATABASE_URL=postgresql://omh_app:test@localhost:5433/omh \
PHI_ENCRYPTION_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff \
npm run test:rls

bash backend/scripts/setup-rls-test-db.sh --down # tear it down
```

## Why a separate role (and why migrations run as the superuser)

PostgreSQL skips RLS for the **table owner** and for `BYPASSRLS`/superuser roles.
Migrations therefore run as the superuser (which owns the tables and can create
policies/functions), while the tests connect as a distinct, non-owner
`NOBYPASSRLS` role — the only configuration in which the policies are truly
exercised. This mirrors the intended production posture (an app role provisioned
`NOBYPASSRLS`, distinct from the migration/admin role).
