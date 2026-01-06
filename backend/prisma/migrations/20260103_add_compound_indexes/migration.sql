-- Add compound indexes for query optimization
-- These indexes improve performance for common query patterns
-- Note: CONCURRENTLY removed because it cannot run inside a transaction

-- Audit logs: User + CreatedAt for HIPAA compliance queries
-- Critical for: "Show me all PHI access for user X in date range"
CREATE INDEX IF NOT EXISTS "audit_logs_user_created_at_idx"
ON "audit_logs" ("user_id", "created_at" DESC);

-- Biomarkers: User + Category + Date for filtered biomarker listings
-- Critical for: "Show me all lipid biomarkers for user X sorted by date"
CREATE INDEX IF NOT EXISTS "biomarkers_user_category_date_idx"
ON "biomarkers" ("user_id", "category", "measurement_date" DESC);

-- Health goals: User + Status + Target date for goal tracking
-- Critical for: "Show me all active goals for user X sorted by target date"
CREATE INDEX IF NOT EXISTS "health_goals_user_status_target_idx"
ON "health_goals" ("user_id", "status", "target_date");

-- Insurance plans: User + Active + Primary for plan lookups
-- Critical for: "Show me user X's active plans with primary first"
CREATE INDEX IF NOT EXISTS "insurance_plans_user_active_primary_idx"
ON "insurance_plans" ("user_id", "is_active", "is_primary" DESC);
