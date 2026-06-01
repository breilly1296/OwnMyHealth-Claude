-- Stop leaking PHI from the plaintext HealthGoal.target_value column.
--
-- `target_value` is a plaintext Decimal(10,4). The numeric value alone reveals
-- sensitive health conditions (e.g., 6.5 with unit=HbA1c indicates diabetes
-- management; weight goals encode body composition; blood pressure targets
-- encode hypertension). Migration 20260420_encrypt_health_goal_target added the
-- `target_value_encrypted` column and the controller now writes to it, but the
-- plaintext twin is still populated for those rows — duplicating the PHI in the
-- clear.
--
-- Strategy (partial, non-destructive):
--   1. Drop the NOT NULL constraint so the column can be nulled.
--   2. NULL `target_value` ONLY for rows that already have a
--      `target_value_encrypted` value (i.e. the PHI is safely preserved in
--      ciphertext). Legacy rows that were never re-encrypted keep their
--      plaintext value so no data is lost; a follow-up backfill script (which
--      needs per-user key access via the userEncryption service, not pure SQL)
--      will encrypt and then null those.
--
-- The column is intentionally NOT dropped — legacy-only rows still depend on it
-- until the backfill runs.

ALTER TABLE "health_goals"
  ALTER COLUMN "target_value" DROP NOT NULL;

UPDATE "health_goals"
  SET "target_value" = NULL
  WHERE "target_value_encrypted" IS NOT NULL;
