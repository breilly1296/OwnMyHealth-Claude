-- Encrypt HealthGoal.target_value at rest.
--
-- `target_value` is plaintext Decimal(10,4). The numeric value alone reveals
-- sensitive health conditions (e.g., 6.5 with unit=HbA1c indicates diabetes
-- management; weight goals encode body composition; blood pressure targets
-- encode hypertension). Treated as PHI from here forward.
--
-- Strategy (additive, non-destructive for this migration):
--   1. Add `target_value_encrypted` TEXT column.
--   2. Leave `target_value` in place — existing rows keep working; the
--      controller writes to the new column for all new data and reads
--      prefer it with a fallback to the plaintext column.
--   3. A follow-up migration encrypts existing `target_value` rows into the
--      new column and drops the plaintext column. That migration is
--      deliberately separate because it requires per-user key access, which
--      runs through the application's userEncryption service (not pure SQL).

ALTER TABLE "health_goals"
  ADD COLUMN "target_value_encrypted" TEXT;
