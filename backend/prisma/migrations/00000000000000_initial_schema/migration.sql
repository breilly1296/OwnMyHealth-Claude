-- OwnMyHealth Initial Schema Migration
-- Generated from Prisma schema for baseline

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE "UserRole" AS ENUM ('PATIENT', 'PROVIDER', 'ADMIN');

CREATE TYPE "ProviderRelationType" AS ENUM ('PRIMARY_CARE', 'SPECIALIST', 'CONSULTANT', 'EMERGENCY', 'OTHER');

CREATE TYPE "ProviderPatientStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED');

CREATE TYPE "DataSourceType" AS ENUM ('MANUAL', 'LAB_UPLOAD', 'EHR_IMPORT', 'DEVICE_SYNC', 'API_IMPORT');

CREATE TYPE "PlanType" AS ENUM ('HMO', 'PPO', 'EPO', 'POS', 'HDHP');

CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TYPE "RiskLevel" AS ENUM ('HIGH', 'MODERATE', 'LOW', 'PROTECTIVE', 'UNKNOWN');

CREATE TYPE "HealthNeedType" AS ENUM ('CONDITION', 'ACTION', 'SERVICE', 'FOLLOW_UP');

CREATE TYPE "Urgency" AS ENUM ('IMMEDIATE', 'URGENT', 'FOLLOW_UP', 'ROUTINE');

CREATE TYPE "HealthNeedStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED');

CREATE TYPE "GoalDirection" AS ENUM ('INCREASE', 'DECREASE', 'MAINTAIN');

CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ACHIEVED', 'FAILED', 'CANCELLED');

CREATE TYPE "ReminderFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'API', 'ADMIN', 'ANONYMOUS');

CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'READ', 'VIEW', 'EXPORT', 'PRINT', 'CREATE', 'UPDATE', 'DELETE', 'PHI_ACCESS', 'PHI_EXPORT', 'PHI_DECRYPT', 'PERMISSION_CHANGE', 'SETTINGS_CHANGE', 'KEY_ROTATION');

-- ============================================
-- TABLES
-- ============================================

-- Users table
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name_encrypted" TEXT,
    "last_name_encrypted" TEXT,
    "date_of_birth_encrypted" TEXT,
    "phone_encrypted" TEXT,
    "address_encrypted" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verification_token" VARCHAR(255),
    "email_verification_expires" TIMESTAMPTZ,
    "password_reset_token" VARCHAR(255),
    "password_reset_expires" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "role" "UserRole" NOT NULL DEFAULT 'PATIENT',
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_failed_login" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- Sessions table
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- User Encryption Keys table
CREATE TABLE "user_encryption_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "key_type" VARCHAR(50) NOT NULL,
    "key_hash" VARCHAR(255) NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ,

    CONSTRAINT "user_encryption_keys_pkey" PRIMARY KEY ("id")
);

-- Provider-Patient relationships table
CREATE TABLE "provider_patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "can_view_biomarkers" BOOLEAN NOT NULL DEFAULT true,
    "can_view_insurance" BOOLEAN NOT NULL DEFAULT false,
    "can_view_dna" BOOLEAN NOT NULL DEFAULT false,
    "can_view_health_needs" BOOLEAN NOT NULL DEFAULT true,
    "can_edit_data" BOOLEAN NOT NULL DEFAULT false,
    "relationship_type" "ProviderRelationType" NOT NULL DEFAULT 'PRIMARY_CARE',
    "status" "ProviderPatientStatus" NOT NULL DEFAULT 'PENDING',
    "consent_granted_at" TIMESTAMPTZ,
    "consent_expires_at" TIMESTAMPTZ,
    "notes_encrypted" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_patients_pkey" PRIMARY KEY ("id")
);

-- Biomarkers table
CREATE TABLE "biomarkers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "value_encrypted" TEXT NOT NULL,
    "notes_encrypted" TEXT,
    "normal_range_min" DECIMAL(10, 4) NOT NULL,
    "normal_range_max" DECIMAL(10, 4) NOT NULL,
    "normal_range_source" VARCHAR(200),
    "measurement_date" DATE NOT NULL,
    "source_type" "DataSourceType" NOT NULL DEFAULT 'MANUAL',
    "source_file" VARCHAR(255),
    "extraction_confidence" DECIMAL(3, 2),
    "lab_name" VARCHAR(200),
    "is_out_of_range" BOOLEAN NOT NULL DEFAULT false,
    "is_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biomarkers_pkey" PRIMARY KEY ("id")
);

-- Biomarker History table
CREATE TABLE "biomarker_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "biomarker_id" UUID NOT NULL,
    "value_encrypted" TEXT NOT NULL,
    "measurement_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biomarker_history_pkey" PRIMARY KEY ("id")
);

-- Insurance Plans table
CREATE TABLE "insurance_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_name" VARCHAR(300) NOT NULL,
    "insurer_name" VARCHAR(200) NOT NULL,
    "plan_type" "PlanType" NOT NULL,
    "member_id_encrypted" TEXT,
    "group_id_encrypted" TEXT,
    "effective_date" DATE NOT NULL,
    "termination_date" DATE,
    "premium_monthly" DECIMAL(10, 2),
    "deductible_individual" DECIMAL(10, 2) NOT NULL,
    "deductible_family" DECIMAL(10, 2) NOT NULL,
    "oop_max_individual" DECIMAL(10, 2) NOT NULL,
    "oop_max_family" DECIMAL(10, 2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_plans_pkey" PRIMARY KEY ("id")
);

-- Insurance Benefits table
CREATE TABLE "insurance_benefits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "service_name" VARCHAR(300) NOT NULL,
    "service_category" VARCHAR(100) NOT NULL,
    "in_network_covered" BOOLEAN NOT NULL,
    "in_network_copay" DECIMAL(10, 2),
    "in_network_coinsurance" DECIMAL(5, 2),
    "in_network_deductible_applies" BOOLEAN NOT NULL DEFAULT true,
    "out_network_covered" BOOLEAN NOT NULL,
    "out_network_copay" DECIMAL(10, 2),
    "out_network_coinsurance" DECIMAL(5, 2),
    "out_network_deductible_applies" BOOLEAN NOT NULL DEFAULT true,
    "limitations" TEXT,
    "pre_auth_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_benefits_pkey" PRIMARY KEY ("id")
);

-- DNA Data table
CREATE TABLE "dna_data" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "upload_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_variants" INTEGER NOT NULL,
    "valid_variants" INTEGER NOT NULL,
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dna_data_pkey" PRIMARY KEY ("id")
);

-- DNA Variants table
CREATE TABLE "dna_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dna_data_id" UUID NOT NULL,
    "rsid" VARCHAR(20) NOT NULL,
    "chromosome" VARCHAR(5) NOT NULL,
    "position" INTEGER NOT NULL,
    "genotype_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dna_variants_pkey" PRIMARY KEY ("id")
);

-- Genetic Traits table
CREATE TABLE "genetic_traits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dna_data_id" UUID NOT NULL,
    "trait_name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "rsid" VARCHAR(20) NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "description_encrypted" TEXT NOT NULL,
    "recommendations_encrypted" TEXT,
    "citation_count" INTEGER NOT NULL DEFAULT 0,
    "confidence" DECIMAL(3, 2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genetic_traits_pkey" PRIMARY KEY ("id")
);

-- Health Needs table
CREATE TABLE "health_needs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "need_type" "HealthNeedType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description_encrypted" TEXT NOT NULL,
    "urgency" "Urgency" NOT NULL,
    "status" "HealthNeedStatus" NOT NULL DEFAULT 'PENDING',
    "related_biomarker_ids" UUID[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "health_needs_pkey" PRIMARY KEY ("id")
);

-- Health Goals table
CREATE TABLE "health_goals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description_encrypted" TEXT,
    "category" VARCHAR(100) NOT NULL,
    "target_value" DECIMAL(10, 4) NOT NULL,
    "current_value" DECIMAL(10, 4),
    "start_value" DECIMAL(10, 4),
    "unit" VARCHAR(50) NOT NULL,
    "direction" "GoalDirection" NOT NULL DEFAULT 'DECREASE',
    "related_biomarker_id" UUID,
    "start_date" DATE NOT NULL,
    "target_date" DATE NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "progress" DECIMAL(5, 2) NOT NULL DEFAULT 0,
    "milestones" TEXT,
    "reminder_frequency" "ReminderFrequency",
    "last_reminder_sent" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "health_goals_pkey" PRIMARY KEY ("id")
);

-- Goal Progress History table
CREATE TABLE "goal_progress_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "goal_id" UUID NOT NULL,
    "value" DECIMAL(10, 4) NOT NULL,
    "progress" DECIMAL(5, 2) NOT NULL,
    "note_encrypted" TEXT,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_progress_history_pkey" PRIMARY KEY ("id")
);

-- Audit Logs table (HIPAA Compliance)
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "session_id" VARCHAR(100),
    "action" "AuditAction" NOT NULL,
    "resource_type" VARCHAR(100) NOT NULL,
    "resource_id" UUID,
    "previous_value_encrypted" TEXT,
    "new_value_encrypted" TEXT,
    "metadata" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- System Config table
CREATE TABLE "system_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "value_type" VARCHAR(50) NOT NULL DEFAULT 'string',
    "description" TEXT,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- ============================================
-- UNIQUE CONSTRAINTS
-- ============================================

ALTER TABLE "users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");
ALTER TABLE "users" ADD CONSTRAINT "users_email_verification_token_key" UNIQUE ("email_verification_token");
ALTER TABLE "users" ADD CONSTRAINT "users_password_reset_token_key" UNIQUE ("password_reset_token");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_token_key" UNIQUE ("token");

ALTER TABLE "user_encryption_keys" ADD CONSTRAINT "user_encryption_keys_user_id_key_type_version_key" UNIQUE ("user_id", "key_type", "version");

ALTER TABLE "provider_patients" ADD CONSTRAINT "provider_patients_provider_id_patient_id_key" UNIQUE ("provider_id", "patient_id");

ALTER TABLE "system_config" ADD CONSTRAINT "system_config_key_key" UNIQUE ("key");

-- ============================================
-- FOREIGN KEYS
-- ============================================

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_encryption_keys" ADD CONSTRAINT "user_encryption_keys_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_patients" ADD CONSTRAINT "provider_patients_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_patients" ADD CONSTRAINT "provider_patients_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "biomarkers" ADD CONSTRAINT "biomarkers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "biomarker_history" ADD CONSTRAINT "biomarker_history_biomarker_id_fkey"
    FOREIGN KEY ("biomarker_id") REFERENCES "biomarkers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "insurance_plans" ADD CONSTRAINT "insurance_plans_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "insurance_benefits" ADD CONSTRAINT "insurance_benefits_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "insurance_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dna_data" ADD CONSTRAINT "dna_data_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dna_variants" ADD CONSTRAINT "dna_variants_dna_data_id_fkey"
    FOREIGN KEY ("dna_data_id") REFERENCES "dna_data"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "genetic_traits" ADD CONSTRAINT "genetic_traits_dna_data_id_fkey"
    FOREIGN KEY ("dna_data_id") REFERENCES "dna_data"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "health_needs" ADD CONSTRAINT "health_needs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "health_goals" ADD CONSTRAINT "health_goals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "goal_progress_history" ADD CONSTRAINT "goal_progress_history_goal_id_fkey"
    FOREIGN KEY ("goal_id") REFERENCES "health_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- INDEXES
-- ============================================

-- Users indexes
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- Sessions indexes
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_token_idx" ON "sessions"("token");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- User Encryption Keys indexes
CREATE INDEX "user_encryption_keys_user_id_idx" ON "user_encryption_keys"("user_id");

-- Provider Patients indexes
CREATE INDEX "provider_patients_provider_id_idx" ON "provider_patients"("provider_id");
CREATE INDEX "provider_patients_patient_id_idx" ON "provider_patients"("patient_id");
CREATE INDEX "provider_patients_status_idx" ON "provider_patients"("status");

-- Biomarkers indexes
CREATE INDEX "biomarkers_user_id_idx" ON "biomarkers"("user_id");
CREATE INDEX "biomarkers_user_id_category_idx" ON "biomarkers"("user_id", "category");
CREATE INDEX "biomarkers_user_id_is_out_of_range_idx" ON "biomarkers"("user_id", "is_out_of_range");
CREATE INDEX "biomarkers_user_id_created_at_idx" ON "biomarkers"("user_id", "created_at");
CREATE INDEX "biomarkers_user_id_source_type_idx" ON "biomarkers"("user_id", "source_type");
CREATE INDEX "biomarkers_measurement_date_idx" ON "biomarkers"("measurement_date");
CREATE INDEX "biomarkers_is_out_of_range_idx" ON "biomarkers"("is_out_of_range");

-- Biomarker History indexes
CREATE INDEX "biomarker_history_biomarker_id_idx" ON "biomarker_history"("biomarker_id");
CREATE INDEX "biomarker_history_measurement_date_idx" ON "biomarker_history"("measurement_date");

-- Insurance Plans indexes
CREATE INDEX "insurance_plans_user_id_idx" ON "insurance_plans"("user_id");
CREATE INDEX "insurance_plans_is_active_idx" ON "insurance_plans"("is_active");

-- Insurance Benefits indexes
CREATE INDEX "insurance_benefits_plan_id_idx" ON "insurance_benefits"("plan_id");
CREATE INDEX "insurance_benefits_service_category_idx" ON "insurance_benefits"("service_category");

-- DNA Data indexes
CREATE INDEX "dna_data_user_id_idx" ON "dna_data"("user_id");

-- DNA Variants indexes
CREATE INDEX "dna_variants_dna_data_id_idx" ON "dna_variants"("dna_data_id");
CREATE INDEX "dna_variants_rsid_idx" ON "dna_variants"("rsid");

-- Genetic Traits indexes
CREATE INDEX "genetic_traits_dna_data_id_idx" ON "genetic_traits"("dna_data_id");
CREATE INDEX "genetic_traits_category_idx" ON "genetic_traits"("category");
CREATE INDEX "genetic_traits_risk_level_idx" ON "genetic_traits"("risk_level");

-- Health Needs indexes
CREATE INDEX "health_needs_user_id_idx" ON "health_needs"("user_id");
CREATE INDEX "health_needs_status_idx" ON "health_needs"("status");
CREATE INDEX "health_needs_urgency_idx" ON "health_needs"("urgency");

-- Health Goals indexes
CREATE INDEX "health_goals_user_id_idx" ON "health_goals"("user_id");
CREATE INDEX "health_goals_status_idx" ON "health_goals"("status");
CREATE INDEX "health_goals_category_idx" ON "health_goals"("category");
CREATE INDEX "health_goals_target_date_idx" ON "health_goals"("target_date");

-- Goal Progress History indexes
CREATE INDEX "goal_progress_history_goal_id_idx" ON "goal_progress_history"("goal_id");
CREATE INDEX "goal_progress_history_recorded_at_idx" ON "goal_progress_history"("recorded_at");

-- Audit Logs indexes (critical for HIPAA compliance queries)
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_resource_type_idx" ON "audit_logs"("resource_type");
CREATE INDEX "audit_logs_resource_id_idx" ON "audit_logs"("resource_id");
CREATE INDEX "audit_logs_created_at_asc_idx" ON "audit_logs"("created_at" ASC);
CREATE INDEX "audit_logs_created_at_desc_idx" ON "audit_logs"("created_at" DESC);
