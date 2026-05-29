-- Provision the NOBYPASSRLS application role used to test Row-Level Security.
--
-- Run this AS THE SUPERUSER (the role that ran `prisma migrate deploy`) AFTER
-- migrations are applied. The tables are then owned by the superuser, so the
-- separate, non-owner `omh_app` role has RLS actually enforced against it
-- (table owners and BYPASSRLS/superuser roles skip RLS — which is exactly the
-- gap that lets RLS regressions ship undetected in dev/staging).
--
-- Used by both the CI `rls` job (.github/workflows/ci.yml) and the local
-- helper (scripts/setup-rls-test-db.sh). Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omh_app') THEN
    CREATE ROLE omh_app LOGIN PASSWORD 'test' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Belt-and-suspenders: ensure the attributes are correct even if the role
-- pre-existed from an earlier run with different flags.
ALTER ROLE omh_app NOSUPERUSER NOBYPASSRLS LOGIN;

GRANT USAGE ON SCHEMA public TO omh_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omh_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO omh_app;

-- Cover tables/sequences created by future migrations too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omh_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO omh_app;

-- The RLS helper functions (current_user_id / is_admin_session /
-- has_provider_access) are already GRANT EXECUTE ... TO PUBLIC in
-- 20260107_add_rls_policies, which omh_app inherits — no extra grant needed.
