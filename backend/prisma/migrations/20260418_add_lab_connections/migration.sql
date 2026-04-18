-- Lab Connections (SMART on FHIR integration with Quest Diagnostics, Labcorp, etc.)
--
-- Stores per-user OAuth token sets and sync state for FHIR lab-results
-- imports. Access and refresh tokens are application-layer-encrypted
-- with the user's per-user salt, so even a DB-level compromise doesn't
-- expose usable tokens without also compromising the PHI master key.
--
-- RLS policies follow the same pattern used for other user-scoped
-- tables: user owns their rows; admin sessions bypass.

CREATE TABLE lab_connections (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                VARCHAR(50)  NOT NULL,
  fhir_patient_id         VARCHAR(255),
  access_token_encrypted  TEXT         NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at        TIMESTAMPTZ(6),
  scope_granted           TEXT,
  connected_at            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  last_sync_at            TIMESTAMPTZ(6),
  sync_status             VARCHAR(20)  NOT NULL DEFAULT 'idle',
  sync_error              TEXT,
  last_imported_count     INTEGER      NOT NULL DEFAULT 0,
  is_active               BOOLEAN      NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX lab_connections_user_provider_key ON lab_connections(user_id, provider);
CREATE INDEX lab_connections_user_id_idx ON lab_connections(user_id);

-- ============================================
-- RLS
-- ============================================

ALTER TABLE lab_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY lab_connections_select ON lab_connections
  FOR SELECT
  USING (
    user_id = current_user_id()
    OR is_admin_session()
  );

CREATE POLICY lab_connections_insert_own ON lab_connections
  FOR INSERT
  WITH CHECK (
    user_id = current_user_id()
    OR is_admin_session()
  );

CREATE POLICY lab_connections_update ON lab_connections
  FOR UPDATE
  USING (
    user_id = current_user_id()
    OR is_admin_session()
  );

CREATE POLICY lab_connections_delete_own ON lab_connections
  FOR DELETE
  USING (user_id = current_user_id() OR is_admin_session());
