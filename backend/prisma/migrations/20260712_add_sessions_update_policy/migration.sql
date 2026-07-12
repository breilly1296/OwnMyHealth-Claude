-- Fix: refresh-token rotation broken under enforced RLS (found by the e2e CI
-- job's first real run; confirmed with psql as the NOBYPASSRLS role).
--
-- `sessions` had SELECT/INSERT/DELETE policies but NO UPDATE policy — its rows
-- are rotated via delete+reinsert, so none seemed needed. But PostgreSQL also
-- applies UPDATE-policy checks to `SELECT ... FOR UPDATE` row locks, and the
-- refresh rotation in authService.refreshTokens() locks the session row that
-- way. Under FORCE RLS with a NOBYPASSRLS role (CI's e2e job — and PRODUCTION
-- since the omh_app cutover) the lock query therefore saw ZERO rows:
--
--   1. every token refresh returned 401 ("Invalid or expired refresh token"),
--      logging the user out when their 15-minute access token expired; and
--   2. the not-found row was classified as token REUSE, misfiring the M-1
--      compromise detector: revokeAllUserTokens() nuked ALL the user's
--      sessions and stamped tokens_valid_after, killing in-flight access
--      tokens across devices.
--
-- Dev/staging connect as a BYPASSRLS role, so the bug was invisible there.
CREATE POLICY sessions_update_own ON sessions
  FOR UPDATE
  USING (user_id = current_user_id() OR is_admin_session())
  WITH CHECK (user_id = current_user_id() OR is_admin_session());
