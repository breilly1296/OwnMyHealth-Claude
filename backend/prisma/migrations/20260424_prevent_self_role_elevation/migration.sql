-- Prevent self-elevation of `role` and `is_active` on the users table.
--
-- Background:
-- The original `users_update_own` policy in 20260107_add_rls_policies has a
-- comment that says "(except role)", but its WITH CHECK is just
--   `id = current_user_id() OR is_admin_session()`
-- which has no notion of OLD vs NEW. Postgres RLS policies cannot reference
-- OLD columns; that's a trigger-only capability. So a user who can update
-- their own row can also flip their own `role` to ADMIN — exactly the
-- scenario the comment claimed was blocked. Same story for `is_active`.
--
-- The fix is a BEFORE UPDATE trigger that compares OLD vs NEW for the
-- two privilege-bearing columns and rejects the change unless the session
-- has `app.is_admin = 'true'` set (i.e., the call ran inside
-- `withRLSContext(null, ..., { isAdmin: true })`).
--
-- Why a trigger and not the policy: the policy gates the row's overall
-- visibility/writability; the trigger gates which columns can change
-- *within* an allowed write. Both layers run, both layers must pass.
--
-- Allowed legitimate writes (verified against current callers):
--   - Self-edit of profile fields (firstName/lastName/phone/etc.) — these
--     don't touch role or is_active, so the trigger is a no-op.
--   - Auth-engine writes to failedLoginAttempts / lockedUntil / lastLoginAt
--     — these run in user-context (withRLSContext(user.id, ...)) but don't
--     touch role/is_active either, so the trigger no-ops.
--   - Admin-context writes (admin panel, demo seeding) — explicitly allowed
--     by the is_admin_session() check inside the trigger.

CREATE OR REPLACE FUNCTION enforce_user_privilege_immutability()
RETURNS trigger AS $$
BEGIN
  -- Admin sessions can change anything. Defer to the policy.
  IF is_admin_session() THEN
    RETURN NEW;
  END IF;

  -- Non-admin: role and is_active must not change. IS DISTINCT FROM
  -- handles NULLs symmetrically (defensive — neither column is nullable
  -- in the current schema, but cheap insurance against future changes).
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Self-elevation blocked: role can only be changed by admin sessions'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Self-mutation blocked: is_active can only be changed by admin sessions'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the trigger first if a prior version exists (idempotency for
-- repeated apply during dev / replay).
DROP TRIGGER IF EXISTS users_prevent_self_privilege_change ON users;

CREATE TRIGGER users_prevent_self_privilege_change
  BEFORE UPDATE OF role, is_active ON users
  FOR EACH ROW
  EXECUTE FUNCTION enforce_user_privilege_immutability();

COMMENT ON TRIGGER users_prevent_self_privilege_change ON users IS
  'F-6 fix — non-admin sessions cannot change role or is_active even though '
  'the users_update_own policy permits writing to the row. Admin context '
  '(SET LOCAL app.is_admin = ''true'') bypasses the trigger.';
