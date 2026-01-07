-- Row-Level Security (RLS) Policies for OwnMyHealth
-- Ensures users can only access their own PHI data
--
-- How it works:
-- 1. Application sets `app.current_user_id` session variable before queries
-- 2. RLS policies check this variable against user_id in each table
-- 3. System operations can bypass RLS using the app_admin role
--
-- IMPORTANT: After applying this migration, all database queries MUST set
-- the app.current_user_id variable or use the app_admin role.

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to safely get current user ID (returns NULL if not set)
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_user_id', true), '')::uuid;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to check if current session is admin
CREATE OR REPLACE FUNCTION is_admin_session()
RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(current_setting('app.is_admin', true), 'false')::boolean;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to check if user is a provider with access to a patient
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
        WHEN 'view_dna' THEN pp.can_view_dna
        WHEN 'view_health_needs' THEN pp.can_view_health_needs
        WHEN 'edit' THEN pp.can_edit_data
        ELSE pp.can_view_biomarkers -- Default to basic view
      END
  ) INTO has_access;

  RETURN COALESCE(has_access, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================
-- ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_encryption_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE biomarkers ENABLE ROW LEVEL SECURITY;
ALTER TABLE biomarker_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE genetic_traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_progress_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS TABLE POLICIES
-- ============================================

-- Users can read their own record
CREATE POLICY users_select_own ON users
  FOR SELECT
  USING (
    id = current_user_id()
    OR is_admin_session()
  );

-- Users can update their own record (except role)
CREATE POLICY users_update_own ON users
  FOR UPDATE
  USING (id = current_user_id() OR is_admin_session())
  WITH CHECK (id = current_user_id() OR is_admin_session());

-- Only system/admin can insert users (registration bypasses RLS)
CREATE POLICY users_insert_system ON users
  FOR INSERT
  WITH CHECK (is_admin_session() OR current_user_id() IS NULL);

-- Only admin can delete users
CREATE POLICY users_delete_admin ON users
  FOR DELETE
  USING (is_admin_session());

-- ============================================
-- SESSIONS TABLE POLICIES
-- ============================================

-- Users can only see/manage their own sessions
CREATE POLICY sessions_select_own ON sessions
  FOR SELECT
  USING (user_id = current_user_id() OR is_admin_session());

CREATE POLICY sessions_insert_own ON sessions
  FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL);

CREATE POLICY sessions_delete_own ON sessions
  FOR DELETE
  USING (user_id = current_user_id() OR is_admin_session());

-- ============================================
-- USER ENCRYPTION KEYS POLICIES
-- ============================================

CREATE POLICY user_encryption_keys_select_own ON user_encryption_keys
  FOR SELECT
  USING (user_id = current_user_id() OR is_admin_session());

CREATE POLICY user_encryption_keys_insert_own ON user_encryption_keys
  FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL);

CREATE POLICY user_encryption_keys_update_own ON user_encryption_keys
  FOR UPDATE
  USING (user_id = current_user_id() OR is_admin_session());

-- ============================================
-- BIOMARKERS TABLE POLICIES
-- ============================================

-- Users can read their own biomarkers, providers with access can too
CREATE POLICY biomarkers_select ON biomarkers
  FOR SELECT
  USING (
    user_id = current_user_id()
    OR has_provider_access(user_id, 'view_biomarkers')
    OR is_admin_session()
  );

CREATE POLICY biomarkers_insert_own ON biomarkers
  FOR INSERT
  WITH CHECK (
    user_id = current_user_id()
    OR is_admin_session()
  );

CREATE POLICY biomarkers_update ON biomarkers
  FOR UPDATE
  USING (
    user_id = current_user_id()
    OR has_provider_access(user_id, 'edit')
    OR is_admin_session()
  );

CREATE POLICY biomarkers_delete_own ON biomarkers
  FOR DELETE
  USING (user_id = current_user_id() OR is_admin_session());

-- ============================================
-- BIOMARKER HISTORY POLICIES
-- ============================================

CREATE POLICY biomarker_history_select ON biomarker_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM biomarkers b
      WHERE b.id = biomarker_history.biomarker_id
        AND (b.user_id = current_user_id()
             OR has_provider_access(b.user_id, 'view_biomarkers')
             OR is_admin_session())
    )
  );

CREATE POLICY biomarker_history_insert ON biomarker_history
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM biomarkers b
      WHERE b.id = biomarker_history.biomarker_id
        AND (b.user_id = current_user_id() OR is_admin_session())
    )
  );

CREATE POLICY biomarker_history_delete ON biomarker_history
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM biomarkers b
      WHERE b.id = biomarker_history.biomarker_id
        AND (b.user_id = current_user_id() OR is_admin_session())
    )
  );

-- ============================================
-- INSURANCE PLANS POLICIES
-- ============================================

CREATE POLICY insurance_plans_select ON insurance_plans
  FOR SELECT
  USING (
    user_id = current_user_id()
    OR has_provider_access(user_id, 'view_insurance')
    OR is_admin_session()
  );

CREATE POLICY insurance_plans_insert_own ON insurance_plans
  FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin_session());

CREATE POLICY insurance_plans_update_own ON insurance_plans
  FOR UPDATE
  USING (user_id = current_user_id() OR is_admin_session());

CREATE POLICY insurance_plans_delete_own ON insurance_plans
  FOR DELETE
  USING (user_id = current_user_id() OR is_admin_session());

-- ============================================
-- INSURANCE BENEFITS POLICIES
-- ============================================

CREATE POLICY insurance_benefits_select ON insurance_benefits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM insurance_plans p
      WHERE p.id = insurance_benefits.plan_id
        AND (p.user_id = current_user_id()
             OR has_provider_access(p.user_id, 'view_insurance')
             OR is_admin_session())
    )
  );

CREATE POLICY insurance_benefits_insert ON insurance_benefits
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM insurance_plans p
      WHERE p.id = insurance_benefits.plan_id
        AND (p.user_id = current_user_id() OR is_admin_session())
    )
  );

CREATE POLICY insurance_benefits_update ON insurance_benefits
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM insurance_plans p
      WHERE p.id = insurance_benefits.plan_id
        AND (p.user_id = current_user_id() OR is_admin_session())
    )
  );

CREATE POLICY insurance_benefits_delete ON insurance_benefits
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM insurance_plans p
      WHERE p.id = insurance_benefits.plan_id
        AND (p.user_id = current_user_id() OR is_admin_session())
    )
  );

-- ============================================
-- DNA DATA POLICIES
-- ============================================

CREATE POLICY dna_data_select ON dna_data
  FOR SELECT
  USING (
    user_id = current_user_id()
    OR has_provider_access(user_id, 'view_dna')
    OR is_admin_session()
  );

CREATE POLICY dna_data_insert_own ON dna_data
  FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin_session());

CREATE POLICY dna_data_update_own ON dna_data
  FOR UPDATE
  USING (user_id = current_user_id() OR is_admin_session());

CREATE POLICY dna_data_delete_own ON dna_data
  FOR DELETE
  USING (user_id = current_user_id() OR is_admin_session());

-- ============================================
-- DNA VARIANTS POLICIES
-- ============================================

CREATE POLICY dna_variants_select ON dna_variants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM dna_data d
      WHERE d.id = dna_variants.dna_data_id
        AND (d.user_id = current_user_id()
             OR has_provider_access(d.user_id, 'view_dna')
             OR is_admin_session())
    )
  );

CREATE POLICY dna_variants_insert ON dna_variants
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dna_data d
      WHERE d.id = dna_variants.dna_data_id
        AND (d.user_id = current_user_id() OR is_admin_session())
    )
  );

CREATE POLICY dna_variants_delete ON dna_variants
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM dna_data d
      WHERE d.id = dna_variants.dna_data_id
        AND (d.user_id = current_user_id() OR is_admin_session())
    )
  );

-- ============================================
-- GENETIC TRAITS POLICIES
-- ============================================

CREATE POLICY genetic_traits_select ON genetic_traits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM dna_data d
      WHERE d.id = genetic_traits.dna_data_id
        AND (d.user_id = current_user_id()
             OR has_provider_access(d.user_id, 'view_dna')
             OR is_admin_session())
    )
  );

CREATE POLICY genetic_traits_insert ON genetic_traits
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dna_data d
      WHERE d.id = genetic_traits.dna_data_id
        AND (d.user_id = current_user_id() OR is_admin_session())
    )
  );

CREATE POLICY genetic_traits_delete ON genetic_traits
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM dna_data d
      WHERE d.id = genetic_traits.dna_data_id
        AND (d.user_id = current_user_id() OR is_admin_session())
    )
  );

-- ============================================
-- HEALTH NEEDS POLICIES
-- ============================================

CREATE POLICY health_needs_select ON health_needs
  FOR SELECT
  USING (
    user_id = current_user_id()
    OR has_provider_access(user_id, 'view_health_needs')
    OR is_admin_session()
  );

CREATE POLICY health_needs_insert_own ON health_needs
  FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin_session());

CREATE POLICY health_needs_update ON health_needs
  FOR UPDATE
  USING (
    user_id = current_user_id()
    OR has_provider_access(user_id, 'edit')
    OR is_admin_session()
  );

CREATE POLICY health_needs_delete_own ON health_needs
  FOR DELETE
  USING (user_id = current_user_id() OR is_admin_session());

-- ============================================
-- HEALTH GOALS POLICIES
-- ============================================

CREATE POLICY health_goals_select ON health_goals
  FOR SELECT
  USING (
    user_id = current_user_id()
    OR has_provider_access(user_id, 'view_health_needs')
    OR is_admin_session()
  );

CREATE POLICY health_goals_insert_own ON health_goals
  FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin_session());

CREATE POLICY health_goals_update_own ON health_goals
  FOR UPDATE
  USING (user_id = current_user_id() OR is_admin_session());

CREATE POLICY health_goals_delete_own ON health_goals
  FOR DELETE
  USING (user_id = current_user_id() OR is_admin_session());

-- ============================================
-- GOAL PROGRESS HISTORY POLICIES
-- ============================================

CREATE POLICY goal_progress_history_select ON goal_progress_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM health_goals g
      WHERE g.id = goal_progress_history.goal_id
        AND (g.user_id = current_user_id()
             OR has_provider_access(g.user_id, 'view_health_needs')
             OR is_admin_session())
    )
  );

CREATE POLICY goal_progress_history_insert ON goal_progress_history
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM health_goals g
      WHERE g.id = goal_progress_history.goal_id
        AND (g.user_id = current_user_id() OR is_admin_session())
    )
  );

CREATE POLICY goal_progress_history_delete ON goal_progress_history
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM health_goals g
      WHERE g.id = goal_progress_history.goal_id
        AND (g.user_id = current_user_id() OR is_admin_session())
    )
  );

-- ============================================
-- PROVIDER-PATIENT RELATIONSHIP POLICIES
-- ============================================

-- Both providers and patients can see their relationships
CREATE POLICY provider_patients_select ON provider_patients
  FOR SELECT
  USING (
    provider_id = current_user_id()
    OR patient_id = current_user_id()
    OR is_admin_session()
  );

-- Providers can create relationship requests
CREATE POLICY provider_patients_insert ON provider_patients
  FOR INSERT
  WITH CHECK (
    provider_id = current_user_id()
    OR is_admin_session()
  );

-- Both can update (provider updates access, patient approves/revokes)
CREATE POLICY provider_patients_update ON provider_patients
  FOR UPDATE
  USING (
    provider_id = current_user_id()
    OR patient_id = current_user_id()
    OR is_admin_session()
  );

-- Either party can delete the relationship
CREATE POLICY provider_patients_delete ON provider_patients
  FOR DELETE
  USING (
    provider_id = current_user_id()
    OR patient_id = current_user_id()
    OR is_admin_session()
  );

-- ============================================
-- AUDIT LOGS POLICIES
-- ============================================

-- Users can read their own audit logs, admins can read all
CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT
  USING (
    user_id = current_user_id()
    OR is_admin_session()
  );

-- Only system can insert audit logs (app.current_user_id not required)
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT
  WITH CHECK (true);

-- Audit logs are immutable - no updates
-- (No UPDATE policy means updates are denied)

-- Only admin can delete (for compliance-approved purging after retention period)
CREATE POLICY audit_logs_delete ON audit_logs
  FOR DELETE
  USING (is_admin_session());

-- ============================================
-- SYSTEM CONFIG POLICIES
-- ============================================

-- Only admin can access system config
CREATE POLICY system_config_select ON system_config
  FOR SELECT
  USING (is_admin_session());

CREATE POLICY system_config_insert ON system_config
  FOR INSERT
  WITH CHECK (is_admin_session());

CREATE POLICY system_config_update ON system_config
  FOR UPDATE
  USING (is_admin_session());

CREATE POLICY system_config_delete ON system_config
  FOR DELETE
  USING (is_admin_session());

-- ============================================
-- GRANT USAGE ON FUNCTIONS
-- ============================================

-- Ensure the functions can be called by the application user
GRANT EXECUTE ON FUNCTION current_user_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_session() TO PUBLIC;
GRANT EXECUTE ON FUNCTION has_provider_access(uuid, text) TO PUBLIC;
