-- Add out-of-network financial fields to insurance_plans table
-- These fields capture deductibles and out-of-pocket maximums for out-of-network coverage

ALTER TABLE "insurance_plans"
ADD COLUMN "deductible_individual_oon" DECIMAL(10, 2),
ADD COLUMN "deductible_family_oon" DECIMAL(10, 2),
ADD COLUMN "oop_max_individual_oon" DECIMAL(10, 2),
ADD COLUMN "oop_max_family_oon" DECIMAL(10, 2);

-- Add comments for documentation
COMMENT ON COLUMN "insurance_plans"."deductible_individual_oon" IS 'Out-of-network individual deductible amount';
COMMENT ON COLUMN "insurance_plans"."deductible_family_oon" IS 'Out-of-network family deductible amount';
COMMENT ON COLUMN "insurance_plans"."oop_max_individual_oon" IS 'Out-of-network individual out-of-pocket maximum';
COMMENT ON COLUMN "insurance_plans"."oop_max_family_oon" IS 'Out-of-network family out-of-pocket maximum';
