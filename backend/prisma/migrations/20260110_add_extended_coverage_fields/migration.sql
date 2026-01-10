-- Add extended insurance coverage fields for comprehensive SBC extraction
-- Includes: ambulance, vision, dental, DME, home health, hospice, additional therapy types

DO $$
BEGIN
    -- ==========================================
    -- Emergency/Ambulance coverage
    -- ==========================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'ambulance_ground_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "ambulance_ground_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'ambulance_ground_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "ambulance_ground_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'ambulance_air_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "ambulance_air_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'ambulance_air_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "ambulance_air_coinsurance" DECIMAL(5, 2);
    END IF;

    -- ==========================================
    -- Vision coverage
    -- ==========================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'vision_exam_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "vision_exam_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'vision_exam_frequency') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "vision_exam_frequency" VARCHAR(100);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'vision_lenses_allowance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "vision_lenses_allowance" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'vision_frames_allowance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "vision_frames_allowance" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'vision_contacts_allowance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "vision_contacts_allowance" DECIMAL(10, 2);
    END IF;

    -- ==========================================
    -- Dental coverage
    -- ==========================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'dental_preventive_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "dental_preventive_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'dental_basic_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "dental_basic_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'dental_major_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "dental_major_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'dental_annual_max') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "dental_annual_max" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'dental_deductible') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "dental_deductible" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'dental_orthodontia_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "dental_orthodontia_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'dental_orthodontia_lifetime_max') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "dental_orthodontia_lifetime_max" DECIMAL(10, 2);
    END IF;

    -- ==========================================
    -- DME (Durable Medical Equipment) coverage
    -- ==========================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'dme_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "dme_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'dme_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "dme_coinsurance" DECIMAL(5, 2);
    END IF;

    -- ==========================================
    -- Home Health coverage
    -- ==========================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'home_health_visit_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "home_health_visit_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'home_health_visit_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "home_health_visit_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'home_health_visit_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "home_health_visit_limit" INTEGER;
    END IF;

    -- ==========================================
    -- Hospice coverage
    -- ==========================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'hospice_inpatient_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "hospice_inpatient_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'hospice_inpatient_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "hospice_inpatient_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'hospice_respite_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "hospice_respite_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'hospice_respite_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "hospice_respite_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'hospice_respite_day_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "hospice_respite_day_limit" INTEGER;
    END IF;

    -- ==========================================
    -- Additional therapy types
    -- ==========================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'chiropractic_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "chiropractic_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'chiropractic_visits_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "chiropractic_visits_limit" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'acupuncture_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "acupuncture_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'acupuncture_visits_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "acupuncture_visits_limit" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'cardiac_rehab_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "cardiac_rehab_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'cardiac_rehab_visits_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "cardiac_rehab_visits_limit" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'pulmonary_rehab_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "pulmonary_rehab_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'pulmonary_rehab_visits_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "pulmonary_rehab_visits_limit" INTEGER;
    END IF;

    -- ==========================================
    -- Services with limits (JSON storage)
    -- ==========================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'services_with_limits') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "services_with_limits" TEXT;
    END IF;

END $$;
