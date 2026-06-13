-- Encrypt HealthGoal.current_value / start_value and GoalProgressHistory.value
-- at rest (M4).
--
-- Like target_value (migration 20260420), these numeric health values reveal
-- sensitive conditions on their own: current_value is the user's latest measured
-- weight / A1c / blood pressure, start_value is their baseline, and each
-- goal_progress_history.value is a point in that measured series over time.
-- Storing them as plaintext Decimal alongside the (already encrypted) goal
-- description leaks the PHI the description was encrypted to protect.
--
-- Strategy (additive, non-destructive — mirrors 20260420 + 20260601):
--   1. Add `*_encrypted` TEXT columns.
--   2. Drop the NOT NULL on goal_progress_history.value so the controller can
--      null the plaintext twin for new rows (health_goals.current_value /
--      start_value are already nullable).
--   3. The controller now writes the encrypted column and nulls the plaintext
--      twin for all NEW data; reads prefer the encrypted column and fall back to
--      the plaintext column for legacy rows.
--   4. A follow-up backfill script (which needs per-user key access via the
--      userEncryption service, not pure SQL) re-encrypts existing plaintext rows
--      and nulls them.

ALTER TABLE "health_goals"
  ADD COLUMN "current_value_encrypted" TEXT,
  ADD COLUMN "start_value_encrypted" TEXT;

ALTER TABLE "goal_progress_history"
  ADD COLUMN "value_encrypted" TEXT,
  ALTER COLUMN "value" DROP NOT NULL;
