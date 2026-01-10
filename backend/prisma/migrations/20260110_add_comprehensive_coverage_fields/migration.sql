-- Add comprehensive insurance coverage fields to insurance_plans table
-- These columns enable tracking of all SBC-extracted coverage details

-- Copays (if not already exists - using IF NOT EXISTS alternative via DO block)
DO $$
BEGIN
    -- Additional copay fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'copay_telehealth') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "copay_telehealth" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'copay_lab_work') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "copay_lab_work" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'copay_xray') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "copay_xray" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'copay_advanced_imaging') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "copay_advanced_imaging" DECIMAL(10, 2);
    END IF;

    -- Inpatient coverage
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'inpatient_hospital_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "inpatient_hospital_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'inpatient_hospital_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "inpatient_hospital_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'inpatient_mental_health_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "inpatient_mental_health_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'inpatient_mental_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "inpatient_mental_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'maternity_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "maternity_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'maternity_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "maternity_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'skilled_nursing_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "skilled_nursing_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'skilled_nursing_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "skilled_nursing_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'skilled_nursing_days_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "skilled_nursing_days_limit" INTEGER;
    END IF;

    -- Outpatient coverage
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'outpatient_surgery_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "outpatient_surgery_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'outpatient_surgery_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "outpatient_surgery_coinsurance" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'outpatient_mental_health_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "outpatient_mental_health_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'outpatient_mental_coinsurance') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "outpatient_mental_coinsurance" DECIMAL(5, 2);
    END IF;

    -- Therapy/Rehab coverage
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'physical_therapy_visits_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "physical_therapy_visits_limit" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'occupational_therapy_visits_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "occupational_therapy_visits_limit" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'speech_therapy_visits_limit') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "speech_therapy_visits_limit" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'physical_therapy_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "physical_therapy_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'occupational_therapy_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "occupational_therapy_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'speech_therapy_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "speech_therapy_copay" DECIMAL(10, 2);
    END IF;

    -- Prescription (Rx) benefits
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_tier1_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_tier1_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_tier2_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_tier2_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_tier3_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_tier3_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_tier4_copay') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_tier4_copay" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_retail_days_supply') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_retail_days_supply" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_mail_order_days_supply') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_mail_order_days_supply" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_deductible_individual') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_deductible_individual" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_deductible_family') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_deductible_family" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_oop_max_individual') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_oop_max_individual" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'rx_oop_max_family') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "rx_oop_max_family" DECIMAL(10, 2);
    END IF;

    -- JSON list fields (stored as TEXT)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'preventive_services_list') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "preventive_services_list" TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'exclusions_list') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "exclusions_list" TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'prior_auth_requirements') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "prior_auth_requirements" TEXT;
    END IF;

    -- Also ensure the base tracking fields exist (in case they weren't added from earlier migration)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'plan_id_number') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "plan_id_number" VARCHAR(100);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'coinsurance_rate') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "coinsurance_rate" DECIMAL(5, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'copay_primary_care') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "copay_primary_care" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'copay_specialist') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "copay_specialist" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'copay_urgent_care') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "copay_urgent_care" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'copay_emergency') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "copay_emergency" DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'deductible_met_individual') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "deductible_met_individual" DECIMAL(10, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'deductible_met_family') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "deductible_met_family" DECIMAL(10, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'oop_met_individual') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "oop_met_individual" DECIMAL(10, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'oop_met_family') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "oop_met_family" DECIMAL(10, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'extracted_from_sbc') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "extracted_from_sbc" BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insurance_plans' AND column_name = 'sbc_extraction_confidence') THEN
        ALTER TABLE "insurance_plans" ADD COLUMN "sbc_extraction_confidence" DECIMAL(3, 2);
    END IF;

END $$;
