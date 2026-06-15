-- Teardown 2026-06-13 hardening — two latent RLS gaps made engine-enforced.
--
-- Both are defense-in-depth: no current route exploits either gap (providers
-- never write the consent booleans, and the audit service is the only inserter
-- and already attributes user_id to the acting session). These changes make the
-- invariant enforced by the database so a future route cannot quietly break it.

-- ============================================================
-- L23 — provider_patients consent columns are patient-owned (immutable to providers)
-- ============================================================
-- The provider_patients_update policy permits a provider's own session
-- (provider_id = current_user_id()) to UPDATE the row — needed for the legitimate
-- access RE-REQUEST, which writes status / relationship_type / notes_encrypted.
-- RLS WITH CHECK evaluates only the NEW row, so it cannot express "these columns
-- are unchanged". A BEFORE UPDATE trigger instead restores the consent permission
-- columns to their prior values whenever the writer is NOT the patient and NOT an
-- admin session. The provider's re-request still goes through untouched; only the
-- patient-granted permission booleans are protected. Patient/admin keep full control.
CREATE OR REPLACE FUNCTION provider_patients_guard_consent()
RETURNS trigger AS $$
BEGIN
  IF NOT (NEW.patient_id = current_user_id() OR is_admin_session()) THEN
    NEW.can_view_biomarkers   := OLD.can_view_biomarkers;
    NEW.can_view_insurance    := OLD.can_view_insurance;
    NEW.can_view_health_needs := OLD.can_view_health_needs;
    NEW.can_edit_data         := OLD.can_edit_data;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS provider_patients_guard_consent ON provider_patients;
CREATE TRIGGER provider_patients_guard_consent
  BEFORE UPDATE ON provider_patients
  FOR EACH ROW
  EXECUTE FUNCTION provider_patients_guard_consent();

-- Make the UPDATE policy's WITH CHECK explicit (previously implicit, defaulting
-- to USING). Functionally identical, but it documents the row-visibility rule in
-- the schema; the trigger above is what enforces column-level ownership of the
-- consent booleans (RLS alone cannot).
DROP POLICY IF EXISTS provider_patients_update ON provider_patients;
CREATE POLICY provider_patients_update ON provider_patients
  FOR UPDATE
  USING (
    provider_id = current_user_id()
    OR patient_id = current_user_id()
    OR is_admin_session()
  )
  WITH CHECK (
    provider_id = current_user_id()
    OR patient_id = current_user_id()
    OR is_admin_session()
  );

-- ============================================================
-- L40 — audit_logs_insert no longer accepts an arbitrary user_id
-- ============================================================
-- Was WITH CHECK (true), which let the app role insert an audit row attributed to
-- ANY user_id with any actor_type. The audit service is the only inserter:
--   * standalone audits run in an admin context  -> is_admin_session()
--   * tx-threaded audits run in the acting user's own RLS context, with
--     user_id = that user                        -> user_id = current_user_id()
--     (verified across all tx-threaded call sites: patient/provider self-context)
--   * login / anonymous audits run with no app.current_user_id set
--                                                 -> current_user_id() IS NULL
-- Restrict the check to exactly those three legitimate shapes so a future code
-- path cannot forge an audit row attributed to an arbitrary user.
DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT
  WITH CHECK (
    user_id = current_user_id()
    OR is_admin_session()
    OR current_user_id() IS NULL
  );
