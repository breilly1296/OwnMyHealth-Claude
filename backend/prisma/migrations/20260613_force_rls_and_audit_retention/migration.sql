-- M2: FORCE row-level security on every RLS-protected table.
--
-- These tables have RLS ENABLED but not FORCED. A PostgreSQL table OWNER bypasses
-- RLS unless FORCE is set, so if a future migration, `prisma db push`, manual DDL,
-- an `ALTER ... OWNER`, or a misconfigured DATABASE_URL ever connects as the table
-- owner, every tenant policy is silently skipped — total cross-tenant exposure with
-- no error. FORCE closes that: RLS applies even to the owner.
--
-- This is a no-op for the app's normal operation: it connects as a NOBYPASSRLS
-- non-owner role (RLS already applies), and BYPASSRLS dev/staging superusers
-- override FORCE too. It ONLY changes behaviour for a non-bypass role that OWNS
-- the tables — exactly the silent-bypass gap being closed.

ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE user_encryption_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE biomarkers FORCE ROW LEVEL SECURITY;
ALTER TABLE biomarker_history FORCE ROW LEVEL SECURITY;
ALTER TABLE insurance_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE insurance_benefits FORCE ROW LEVEL SECURITY;
ALTER TABLE health_needs FORCE ROW LEVEL SECURITY;
ALTER TABLE health_goals FORCE ROW LEVEL SECURITY;
ALTER TABLE goal_progress_history FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_patients FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE system_config FORCE ROW LEVEL SECURITY;
ALTER TABLE user_files FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_projections FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_actuals FORCE ROW LEVEL SECURITY;
ALTER TABLE cost_analyses FORCE ROW LEVEL SECURITY;
ALTER TABLE lab_connections FORCE ROW LEVEL SECURITY;

-- M19: DB-enforce the 7-year audit-log retention window.
--
-- The previous delete policy allowed ANY admin-session code path to DELETE ANY
-- audit row; the "only delete beyond 7 years" rule lived solely in the app-side
-- cleanup scheduler. Restricting the policy to aged rows makes the retention a
-- database-enforced guarantee: even an admin-context bug or abuse can no longer
-- purge recent audit history. The retention cleanup still works — it only ever
-- deletes rows already past the window.
DROP POLICY IF EXISTS audit_logs_delete ON audit_logs;
CREATE POLICY audit_logs_delete ON audit_logs
  FOR DELETE
  USING (is_admin_session() AND created_at < (now() - interval '7 years'));
