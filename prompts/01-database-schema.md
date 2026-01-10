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
- [ ] RLS policies defined for user-owned tables:
  - `biomarkers`
  - `user_files`
  - `insurance_plans`
  - `health_goals`
  - `audit_logs`
- [ ] Policies use `user_id = current_setting('app.current_user_id')::uuid`

### 3. PHI Fields Identification
- [ ] Identify all PHI-containing columns
- [ ] Verify encryption service is used for:
  - Lab values and biomarker data
  - DNA/genetic information
  - Insurance details
  - Notes and free-text fields

### 4. Indexes
- [ ] Compound indexes exist for common query patterns:
  - `biomarkers(user_id, category, measurement_date)`
  - `audit_logs(user_id, created_at)`
  - `insurance_plans(user_id, is_active)`
- [ ] No missing indexes on foreign keys

### 5. Migration Safety
- [ ] No destructive migrations without data backup plan
- [ ] `CREATE INDEX CONCURRENTLY` used for production indexes
- [ ] Migrations are idempotent where possible

## Questions to Ask
1. Are there any tables without RLS that should have it?
2. Are any PHI fields missing encryption?
3. Are there N+1 query patterns that need indexes?
