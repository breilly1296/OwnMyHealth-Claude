-- M1: cross-instance single-device access-token revocation.
--
-- Single-device logout deletes the refresh session and blacklists the access
-- token IN MEMORY on the current Cloud Run instance only — the access JWT keeps
-- authenticating on the other replicas until its 15-min natural expiry. The
-- per-user `tokensValidAfter` cutoff can't be used here because it logs out the
-- user's OTHER devices too. This table records the revoked token's `jti` so
-- authenticate() rejects it on EVERY replica, folded into the same cached
-- per-user lookup that already reads tokensValidAfter.

CREATE TABLE revoked_access_tokens (
  jti        UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX revoked_access_tokens_user_id_idx ON revoked_access_tokens(user_id);
CREATE INDEX revoked_access_tokens_expires_at_idx ON revoked_access_tokens(expires_at);

-- RLS, mirroring `sessions`: a user reads/writes only their own revocation rows;
-- admin context (system cleanup) sees all; unauthenticated INSERT is allowed so
-- the optionalAuth logout route (which can run with an expired access token) can
-- still record a revocation. FORCE so a future owner-role connection can't
-- silently bypass the policies (see M2 / assertRLSForced).
ALTER TABLE revoked_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE revoked_access_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY revoked_access_tokens_select_own ON revoked_access_tokens
  FOR SELECT
  USING (user_id = current_user_id() OR is_admin_session());

CREATE POLICY revoked_access_tokens_insert_own ON revoked_access_tokens
  FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL);

CREATE POLICY revoked_access_tokens_delete_own ON revoked_access_tokens
  FOR DELETE
  USING (user_id = current_user_id() OR is_admin_session());
