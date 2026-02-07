-- Fix expense tracking column types for PHI encryption
-- These columns store AES-256-GCM ciphertext, not raw numeric/JSON values.
-- Changing from DECIMAL/JSONB to TEXT to match the encrypted data stored by the application.

-- expense_projections: estimated_cost stores encrypted ciphertext, not a decimal
ALTER TABLE expense_projections
  ALTER COLUMN estimated_cost TYPE TEXT USING estimated_cost::TEXT;

-- expense_actuals: all monetary fields store encrypted ciphertext
ALTER TABLE expense_actuals
  ALTER COLUMN billed_amount TYPE TEXT USING billed_amount::TEXT,
  ALTER COLUMN insurance_paid TYPE TEXT USING insurance_paid::TEXT,
  ALTER COLUMN patient_paid TYPE TEXT USING patient_paid::TEXT,
  ALTER COLUMN applied_to_deductible TYPE TEXT USING applied_to_deductible::TEXT,
  ALTER COLUMN applied_to_oop TYPE TEXT USING applied_to_oop::TEXT;

-- cost_analyses: total_projected_oop and projected_expenses_snapshot store encrypted ciphertext
ALTER TABLE cost_analyses
  ALTER COLUMN total_projected_oop TYPE TEXT USING total_projected_oop::TEXT,
  ALTER COLUMN projected_expenses_snapshot TYPE TEXT USING projected_expenses_snapshot::TEXT;
