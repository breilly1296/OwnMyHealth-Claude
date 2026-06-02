---
tags:
  - security
  - database
  - critical
type: prompt
priority: 1
updated: 2026-06-01
---

# Database Schema Review

> Follow the [review protocol](./_review-protocol.md).
> Use the [PHI inventory](./_phi-inventory.md) for encrypted-field verification.
> Use [Claude Code tools](./_verification-tools.md).

## Files to Review
- `backend/prisma/schema.prisma` — authoritative model definitions (18 models)
- `backend/prisma/migrations/` — migration history, 22 dirs (esp. `20260107_add_rls_policies` and the
  RLS follow-ups `20260424_prevent_self_role_elevation`, `20260529_fix_has_provider_access`,
  `20260530_add_users_select_provider`)
- `backend/src/services/database.ts` — Prisma client, `withRLSContext`, `withRLSTransaction`, `assertNoBypassRLS`
- `backend/src/services/encryption.ts` — `PHI_FIELDS` constant (must mirror every `*Encrypted` schema column)

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
- [ ] RLS policies defined for ALL user-owned tables (each created with its table's migration):
  - `users`, `sessions`, `user_encryption_keys`
  - `biomarkers`, `biomarker_history`
  - `insurance_plans`, `insurance_benefits`
  - `health_needs`, `health_goals`, `goal_progress_history`
  - `provider_patients`
  - `user_files` (policies in `20260108000000_add_user_files_table`)
  - `expense_projections`, `expense_actuals`, `cost_analyses` (policies in `20260111_add_expense_tracking`)
  - `lab_connections` (NEW — SMART-on-FHIR OAuth token rows; policies in `20260418_add_lab_connections`)
  - `system_config` (admin-only: every policy gated on `is_admin_session()`)
  - `audit_logs`
- [ ] DNA/genetics tables are GONE — `dna_data`, `dna_variants`, `genetic_traits` were dropped in
  `20260423_drop_dna_genetics` (CASCADE). Flag any RLS check, policy, or `can_view_dna` reference that still
  assumes they exist.
- [ ] Policies key off the helpers in `20260107_add_rls_policies`: `current_user_id()` (= `NULLIF(current_setting('app.current_user_id', true), '')::uuid`), `is_admin_session()`, and `has_provider_access(patient_user_id, permission_type)`.
- [ ] `has_provider_access()` no longer references the dropped `can_view_dna` column — the fix in
  `20260529_fix_has_provider_access` recreates the function; verify no copy still carries the `'view_dna'`
  branch (under a NOBYPASSRLS role the stale branch broke EVERY multi-tenant read, not just DNA).
- [ ] `provider_patients` table has RLS for both `provider_id` and `patient_id`.
- [ ] Provider can read a CONSENTED patient's `users` row via the additive `users_select_provider` policy
  (`has_active_consent()`, `20260530_add_users_select_provider`) — confirm provider route handlers select an
  explicit non-secret column allowlist (RLS is row-level, so this policy exposes `password_hash` and the
  reset/verification token columns to the provider session unless the query restricts columns).
- [ ] Self-elevation is blocked: the `users_update_own` policy comment says "(except role)" but RLS can't see
  OLD vs NEW — the actual guard is the BEFORE UPDATE trigger `users_prevent_self_privilege_change`
  (`20260424_prevent_self_role_elevation`) on `role`/`is_active`. Confirm it is present.
- [ ] Admin bypass uses `app.is_admin = true` correctly (RLS sees `is_admin_session() = true`).

### 3. PHI Fields Identification
- [ ] Every `*Encrypted` column in `schema.prisma` matches a field listed in the `PHI_FIELDS` constant in
  `backend/src/services/encryption.ts` (~line 410) and in [_phi-inventory](./_phi-inventory.md). Drift here means
  iteration-based sweeps (export, deletion, admin views, audit redaction) silently skip fields.
- [ ] Every field in `PHI_FIELDS` / the inventory exists in the schema (no stale entries after a migration).
- [ ] No plaintext PHI column: if a non-`Encrypted` column name matches a PHI concept (`firstName`, `dateOfBirth`, `phone`, `memberId`), flag it.
- [ ] Confirm the NEW encrypted fields are present in BOTH schema and `PHI_FIELDS`:
  - `User.healthProfileEncrypted` (added `20260418_add_health_profile`)
  - `HealthGoal.targetValueEncrypted` (added `20260420_encrypt_health_goal_target`; the plaintext `targetValue`
    Decimal column is retained for backward-compat reads — flag if new writes still populate it unencrypted)
  - `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted` (SMART-on-FHIR OAuth tokens — a stolen
    token is a direct path to live PHI at Quest/LabCorp)
- [ ] `CostAnalysis.claudeResponseEncrypted` carries the `Encrypted` suffix (RENAMED from `claudeResponse`,
  column `claude_response` → `claude_response_encrypted`, in `20260424_align_uuid_defaults_and_rename_claude_response`).
  Flag any lingering reference to the old `claudeResponse` name.
- [ ] DNA encrypted fields are GONE: `DNAVariant.genotypeEncrypted`, `GeneticTrait.descriptionEncrypted/recommendationsEncrypted`
  no longer exist (models dropped in `20260423_drop_dna_genetics`). Flag any inventory/`PHI_FIELDS` entry that still lists them.

### 4. Indexes
- [ ] Compound indexes exist for common query patterns (see `20260103_add_compound_indexes` + `@@index` in schema):
  - `biomarkers(user_id, category, measurement_date DESC)` (`biomarkers_user_category_date_idx`)
  - `biomarkers(user_id, is_out_of_range)`, `biomarkers(user_id, created_at)`, `biomarkers(user_id, source_type)`
  - `audit_logs(user_id, created_at DESC)` (`audit_logs_user_created_at_idx`)
  - `insurance_plans(user_id, is_active, is_primary DESC)` (`insurance_plans_user_active_primary_idx`)
  - `health_goals(user_id, status, target_date)` (`health_goals_user_status_target_idx`)
  - `expense_projections(user_id, plan_id)`, `expense_actuals(user_id, plan_id)`, `cost_analyses(user_id, plan_id)`
- [ ] Single-column indexes back the remaining hot lookups: `health_needs` indexes `status`/`urgency` separately
  (no `(user_id, status, urgency)` compound); `provider_patients` indexes `provider_id`, `patient_id`, `status`
  separately (no `(provider_id, patient_id, status)` compound — the unique constraint covers the pair);
  `sessions` indexes `expires_at`, `token`, `user_id`; `lab_connections` indexes `user_id`.
- [ ] No missing indexes on foreign keys

### 5. Migration Safety
- [ ] No destructive migrations without a data backup plan (e.g. `20260423_drop_dna_genetics` documents that
  tables were verified empty in every env before the `DROP ... CASCADE`).
- [ ] Index DDL: note that `20260103_add_compound_indexes` deliberately does NOT use `CREATE INDEX CONCURRENTLY`
  (Prisma wraps each migration in a transaction; `CONCURRENTLY` cannot run inside one) — it uses plain
  `CREATE INDEX IF NOT EXISTS` instead. Flag only locking risk on large tables, not the absence of `CONCURRENTLY`.
- [ ] Migrations are idempotent where possible (`IF EXISTS` / `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`).

### 6. Model Completeness
- [ ] All 18 models present and correct:
  - User, Session, UserEncryptionKey
  - ProviderPatient, UserFile
  - Biomarker, BiomarkerHistory
  - InsurancePlan, InsuranceBenefit
  - HealthNeed, HealthGoal, GoalProgressHistory
  - AuditLog, SystemConfig
  - ExpenseProjection, ExpenseActual, CostAnalysis
  - LabConnection (NEW — `20260418_add_lab_connections`)
- [ ] `DNAData`, `DNAVariant`, `GeneticTrait` are NO LONGER models — dropped in `20260423_drop_dna_genetics`.
  Flag any code, relation, or doc still referencing them.
- [ ] 13 enums present: `UserRole`, `ProviderRelationType`, `ProviderPatientStatus`, `DataSourceType`, `PlanType`,
  `HealthNeedType`, `Urgency`, `HealthNeedStatus`, `GoalDirection`, `GoalStatus`, `ReminderFrequency`, `ActorType`,
  `AuditAction`. The DNA-only enums `ProcessingStatus` and `RiskLevel` were dropped with the DNA tables.
- [ ] Proper ON DELETE behavior for all foreign keys (most user-owned rows `onDelete: Cascade`;
  `ExpenseActual.projection` is `onDelete: SetNull`).
- [ ] Unique constraints where needed (`User.email`, `ProviderPatient(providerId, patientId)`,
  `LabConnection(userId, provider)`, `UserEncryptionKey(userId, keyType, version)`, `SystemConfig.key`, etc.).

## Questions to Ask
1. Are there any tables without RLS that should have it (e.g. is the next new table's migration creating
   its policies, like `lab_connections` did)?
2. Are any PHI fields missing encryption, or present in the schema but absent from `PHI_FIELDS`?
3. Are there N+1 query patterns that need indexes?
4. Are cascade deletes correct for account deletion (does deleting a `User` reach every dependent table,
   including the new `LabConnection` rows holding live OAuth tokens)?
5. Does any code still reference the removed DNA/genetic models, `can_view_dna`, or the `ProcessingStatus`/
   `RiskLevel` enums?
