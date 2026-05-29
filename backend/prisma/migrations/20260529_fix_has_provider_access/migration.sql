-- Fix has_provider_access() — drop the dead can_view_dna reference.
--
-- The 20260107_add_rls_policies migration defined has_provider_access() with a
-- `WHEN 'view_dna' THEN pp.can_view_dna` branch. 20260423_drop_dna_genetics
-- later dropped the provider_patients.can_view_dna column. Because the function
-- body is a single SELECT that Postgres parses/plans as a whole, the now-missing
-- column makes the function throw `column pp.can_view_dna does not exist` at
-- runtime for EVERY permission_type — not just 'view_dna'.
--
-- This is masked wherever the connecting role has BYPASSRLS (dev/staging
-- superuser) because the USING clauses are never evaluated. Under a real
-- NOBYPASSRLS role (production, and the RLS CI harness) ANY RLS-filtered read of
-- a row the caller doesn't own — which evaluates has_provider_access — fails.
-- That breaks not only consent-scoped provider access but ALL multi-tenant
-- reads of biomarkers / insurance / health needs / goals.
--
-- Recreate the function without the view_dna branch. Behavior is otherwise
-- identical; the DNA models/permission no longer exist.

CREATE OR REPLACE FUNCTION has_provider_access(patient_user_id uuid, permission_type text DEFAULT 'view')
RETURNS boolean AS $$
DECLARE
  has_access boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM provider_patients pp
    WHERE pp.provider_id = current_user_id()
      AND pp.patient_id = patient_user_id
      AND pp.status = 'ACTIVE'
      AND (pp.consent_expires_at IS NULL OR pp.consent_expires_at > NOW())
      AND CASE permission_type
        WHEN 'view_biomarkers' THEN pp.can_view_biomarkers
        WHEN 'view_insurance' THEN pp.can_view_insurance
        WHEN 'view_health_needs' THEN pp.can_view_health_needs
        WHEN 'edit' THEN pp.can_edit_data
        ELSE pp.can_view_biomarkers -- Default to basic view
      END
  ) INTO has_access;

  RETURN COALESCE(has_access, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- GRANT EXECUTE ... TO PUBLIC from 20260107 persists across CREATE OR REPLACE.
