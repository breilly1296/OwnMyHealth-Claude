-- P7: let a provider read a CONSENTED patient's users row (minimal identity).
--
-- The PHI table policies (biomarkers/insurance/health_needs/...) already carry
-- an `OR has_provider_access(user_id, <perm>)` branch, but users_select_own
-- only permits self/admin. So moving provider PHI reads off admin-bypass onto
-- withRLSContext(providerId) would make the patient's {id,email} read return
-- zero rows. This adds the missing provider SELECT path on the users table.
--
-- Identity disclosure is gated on ANY ACTIVE, unexpired consent relationship —
-- NOT a specific data-capability flag. That mirrors the app layer, which lists
-- a consented patient's email for every ACTIVE relationship regardless of which
-- data permissions (biomarkers/insurance/health-needs) were granted. Gating on
-- a single flag (e.g. can_view_biomarkers) would wrongly hide the identity of a
-- patient who consented to, say, insurance-only access.
--
-- COLUMN-SCOPE CAVEAT: Postgres RLS is row-level, not column-level. This
-- policy authorizes the provider's session to read the ENTIRE consented
-- patient users row — which includes plaintext security-sensitive columns
-- (password_hash, email_verification_token, password_reset_token). The
-- encrypted PHI columns (name/DOB/phone/address) stay protected because the
-- provider lacks the patient's per-user key, but the secret-token columns do
-- NOT. Therefore EVERY provider-context read of the users table MUST use an
-- explicit, non-secret column allowlist (select { id, email, ... }); the
-- provider route handlers do. (This is still strictly narrower than the prior
-- admin-bypass, which read every column of every user.) A future hardening to
-- enforce column scope at the engine level — splitting the secret tokens into
-- a separate table, or exposing identity via a restricted view — is tracked as
-- a follow-up; with a single shared app role, column-level GRANTs aren't an
-- option (self-reads such as login legitimately need password_hash).

-- SECURITY DEFINER so it can read provider_patients without being re-filtered by
-- that table's own RLS (same pattern as has_provider_access).
CREATE OR REPLACE FUNCTION has_active_consent(patient_user_id uuid)
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
  ) INTO has_access;

  RETURN COALESCE(has_access, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION has_active_consent(uuid) TO PUBLIC;

-- Additive PERMISSIVE policy: Postgres ORs multiple SELECT policies, so the
-- existing self/admin access (users_select_own) is unchanged.
CREATE POLICY users_select_provider ON users
  FOR SELECT
  USING (has_active_consent(id));
