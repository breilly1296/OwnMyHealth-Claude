-- Per-recipient "last sent" markers for the email scheduler.
--
-- The engagement-email scheduler (weekly summary, plan-expiring notice) runs on
-- every Cloud Run instance with no cross-instance coordination, so a given user
-- could receive up to N duplicate emails (one per replica). These columns let
-- each send be CLAIMED atomically (UPDATE ... WHERE last_*_sent IS NULL OR
-- < cutoff) so it is sent at most once per period even if multiple instances
-- tick concurrently or the advisory lock is lost mid-batch. Goal reminders reuse
-- the existing health_goals.last_reminder_sent column.
--
-- These are send timestamps, NOT PHI: not encrypted, not added to PHI_FIELDS.
-- Nullable with no default → on first run after deploy every eligible user is
-- mailed once (column NULL ⇒ claimable), as intended.
--
-- No new RLS policy needed: the scheduler writes these in the admin/system RLS
-- context (withRLSContext(null, ..., { isAdmin: true })) and the users table
-- already carries is_admin_session() policies under FORCE RLS.

ALTER TABLE "users"
  ADD COLUMN "last_weekly_summary_sent" TIMESTAMPTZ(6),
  ADD COLUMN "last_plan_expiring_sent" TIMESTAMPTZ(6);
