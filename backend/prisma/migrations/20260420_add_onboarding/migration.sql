-- Track when a user finished the onboarding wizard.
-- NULL  = first-time user, wizard should render on dashboard.
-- NOT NULL = onboarding finished (or auto-detected as complete because the
--            account already has data from before this migration).
--
-- The backfill below marks every existing account as already onboarded so
-- long-time users don't get the wizard shown after the rollout. New accounts
-- default to NULL via their freshly-created row (no DEFAULT clause here by
-- design — we don't want Postgres auto-filling for new signups).

ALTER TABLE "users"
  ADD COLUMN "onboarding_completed_at" TIMESTAMPTZ(6);

UPDATE "users"
SET "onboarding_completed_at" = COALESCE("updated_at", "created_at", NOW())
WHERE "onboarding_completed_at" IS NULL;
