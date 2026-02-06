---
tags:
  - security
  - database
  - critical
type: prompt
priority: 1
---

# Database Schema Review

## Files to Review
- `backend/prisma/schema.prisma` (primary)
- `backend/prisma/migrations/` (migration history)
- `backend/src/services/database.ts` (connection handling)

## OwnMyHealth Database Architecture
- **ORM**: Prisma with PostgreSQL
- **Hosting**: Cloud SQL (us-central1)
- **Security**: Row-level security (RLS) policies
- **Encryption**: PHI fields encrypted at application layer

## Checklist

### 1. Schema Security
- [ ] All tables have appropriate indexes for query performance
- [ ] Foreign keys properly defined with ON DELETE behavior
- [ ] No sensitive data stored in plaintext (check for PHI fields)
- [ ] UUID used for primary keys (not sequential integers)

### 2. Row-Level Security
- [ ] RLS policies defined for ALL user-owned tables:
  - `biomarkers`
  - `biomarker_history`
  - `user_files`
  - `insurance_plans`
  - `insurance_benefits`
  - `health_goals`
  - `goal_progress_history`
  - `health_needs`
  - `expense_projections`
  - `expense_actuals`
  - `cost_analyses`
  - `dna_data` (still in schema)
  - `dna_variants`
  - `genetic_traits`
  - `audit_logs`
  - `sessions`
- [ ] Policies use `user_id = current_setting('app.current_user_id')::uuid`
- [ ] ProviderPatient table has RLS for both `providerId` and `patientId`
- [ ] Admin bypass uses `app.is_admin = true` correctly

### 3. PHI Fields Identification
- [ ] Identify all PHI-containing columns
- [ ] Verify encryption service is used for:
  - Biomarker values and notes (`valueEncrypted`, `notesEncrypted`)
  - BiomarkerHistory values (`valueEncrypted`)
  - User PII (firstName, lastName, dateOfBirth, phone, address)
  - Insurance details (memberIdEncrypted, groupIdEncrypted)
  - Health goal and need descriptions (`descriptionEncrypted`)
  - Goal progress notes (`noteEncrypted`)
  - Provider relationship notes (`notesEncrypted`)
  - DNA/genetic data (genotypeEncrypted, descriptionEncrypted, recommendationsEncrypted)
  - Expense data (service types, costs, provider names, claim amounts)
  - Cost analysis AI responses (`claudeResponse`)
  - Audit log PHI values (previousValueEncrypted, newValueEncrypted)

### 4. Indexes
- [ ] Compound indexes exist for common query patterns:
  - `biomarkers(user_id, category, measurement_date)`
  - `biomarkers(user_id, is_out_of_range)`
  - `audit_logs(user_id, created_at)`
  - `audit_logs(action, resource_type)`
  - `insurance_plans(user_id, is_active)`
  - `health_needs(user_id, status, urgency)`
  - `health_goals(user_id, status)`
  - `sessions(user_id, expires_at)`
  - `provider_patient(provider_id, patient_id, status)`
- [ ] No missing indexes on foreign keys

### 5. Migration Safety
- [ ] No destructive migrations without data backup plan
- [ ] `CREATE INDEX CONCURRENTLY` used for production indexes
- [ ] Migrations are idempotent where possible

### 6. Model Completeness
- [ ] All 15+ models present and correct:
  - User, Session, UserEncryptionKey
  - Biomarker, BiomarkerHistory
  - InsurancePlan, InsuranceBenefit
  - HealthNeed, HealthGoal, GoalProgressHistory
  - DNAData, DNAVariant, GeneticTrait
  - ProviderPatient
  - UserFile
  - ExpenseProjection, ExpenseActual, CostAnalysis
  - AuditLog
- [ ] Proper ON DELETE behavior for all foreign keys
- [ ] Unique constraints where needed (email, providerId+patientId, etc.)

## Questions to Ask
1. Are there any tables without RLS that should have it?
2. Are any PHI fields missing encryption?
3. Are there N+1 query patterns that need indexes?
4. Are cascade deletes correct for account deletion?
5. Are DNA/genetic models still needed or should they be removed?
