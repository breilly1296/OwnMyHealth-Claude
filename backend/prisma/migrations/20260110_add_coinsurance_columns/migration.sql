-- Add per-service coinsurance columns for plans with "X% after deductible" instead of copays
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "coinsurance_primary_care" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "coinsurance_specialist" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "coinsurance_urgent_care" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "coinsurance_emergency" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "coinsurance_telehealth" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "coinsurance_lab_work" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "coinsurance_xray" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "coinsurance_advanced_imaging" DECIMAL(5, 2);

-- Add Rx tier coinsurance columns
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "rx_tier1_coinsurance" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "rx_tier2_coinsurance" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "rx_tier3_coinsurance" DECIMAL(5, 2);
ALTER TABLE "insurance_plans" ADD COLUMN IF NOT EXISTS "rx_tier4_coinsurance" DECIMAL(5, 2);
