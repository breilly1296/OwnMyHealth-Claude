-- Add subscription tier columns to users.
-- `plan` enumerated in application code (backend/src/config/plans.ts) as
-- FREE | PRO | TEAM. Stored as VARCHAR(20) rather than a native enum so
-- future plan tiers can be added without a migration. Default FREE so
-- existing users keep working with no code-path changes.
--
-- plan_expires_at: null for FREE and for non-expiring plans; set for
--   comped/trial upgrades to auto-downgrade via a scheduled job.
-- plan_updated_at: stamped by the admin plan-change endpoint and by the
--   future Stripe webhook handler. Not tied to updatedAt so we can tell
--   plan changes apart from any other user row update.

ALTER TABLE "users"
  ADD COLUMN "plan" VARCHAR(20) NOT NULL DEFAULT 'FREE',
  ADD COLUMN "plan_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "plan_updated_at" TIMESTAMPTZ(6);
