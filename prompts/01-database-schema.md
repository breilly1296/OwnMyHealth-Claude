---
tags:
  - security
  - database
  - critical
type: prompt
priority: 1
updated: 2026-08-01
---

# Database Schema Review

> **Update (2026-08-01):** **34** migration directories (was 32) — `20260620_add_registration_consent`
> (`users.terms_accepted_at` / `terms_version`; deliberately **not** PHI and **not** in `PHI_FIELDS`,
> written by `createUser` in the admin/system RLS context, needing no new policy) and
> `20260712_add_sessions_update_policy` (OF-22 — see the row-lock check below). Models remain **19**
> and `PHI_FIELDS` remains **14 models / 39 fields**, still in lockstep with the schema columns.

> Follow the [review protocol](./_review-protocol.md).
> Use the [PHI inventory](./_phi-inventory.md) for encrypted-field verification.
> Use [Claude Code tools](./_verification-tools.md).

## Files to Review
- `backend/prisma/schema.prisma` — authoritative model definitions (19 models — `RevokedAccessToken` added 2026-06-13)
- `backend/prisma/migrations/` — migration history, 32 dirs (esp. `20260107_add_rls_policies` and the
  RLS follow-ups `20260424_prevent_self_role_elevation`, `20260529_fix_has_provider_access`,
  `20260530_add_users_select_provider`, and the FORCE-RLS / consent-immutability hardening
  `20260613_force_rls_and_audit_retention`, `20260613_revoked_access_tokens`,
  `20260615_provider_consent_immutable_audit_insert_check`)
- `backend/src/services/database.ts` — Prisma client, `withRLSContext`, `withRLSTransaction`,
  `assertNoBypassRLS`, and the boot check `assertRLSForced()` (database.ts:193 call, :270 definition)
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
- [ ] RLS policies defined for ALL user-owned tables — **19 RLS-protected tables** (each created with its table's migration):
  - `users`, `sessions`, `user_encryption_keys`
  - `biomarkers`, `biomarker_history`
  - `insurance_plans`, `insurance_benefits`
  - `health_needs`, `health_goals`, `goal_progress_history`
  - `provider_patients`
  - `user_files` (policies in `20260108000000_add_user_files_table`)
  - `expense_projections`, `expense_actuals`, `cost_analyses` (policies in `20260111_add_expense_tracking`)
  - `lab_connections` (SMART-on-FHIR OAuth token rows; policies in `20260418_add_lab_connections`)
  - `revoked_access_tokens` (NEW — M1 cross-instance access-token revocation; ENABLE + FORCE with
    select/insert/delete-own policies in `20260613_revoked_access_tokens`. NOTE: insert is allowed when
    `current_user_id() IS NULL`, the expired-token logout path — confirm this NULL branch is intentional and
    can't be abused to forge revocation rows for other users)
  - `system_config` (admin-only: every policy gated on `is_admin_session()`)
  - `audit_logs`
- [ ] **FORCE ROW LEVEL SECURITY is present on EVERY RLS table** (closes the silent owner-bypass gap — plain
  `ENABLE RLS` does not apply to the table owner). `20260613_force_rls_and_audit_retention` applies
  `FORCE ROW LEVEL SECURITY` to all 18 then-existing tables (migration.sql:14-31) and
  `20260613_revoked_access_tokens` FORCEs the 19th (migration.sql:27). Flag any RLS-enabled table missing FORCE.
- [ ] Boot enforcement: `database.ts` runs `assertRLSForced()` (database.ts:193) right after `assertNoBypassRLS()`,
  which hard-exits in production if any RLS-enabled table is not FORCE-protected
  (database.ts:270 definition, :303 `'Refusing to start — add FORCE ROW LEVEL SECURITY (see migration 20260613).'`).
  Confirm the check is wired and not short-circuited.
- [ ] DNA/genetics tables are GONE — `dna_data`, `dna_variants`, `genetic_traits` were dropped in
  `20260423_drop_dna_genetics` (CASCADE). Flag any RLS check, policy, or `can_view_dna` reference that still
  assumes they exist.
- [ ] Policies key off the helpers in `20260107_add_rls_policies`: `current_user_id()` (= `NULLIF(current_setting('app.current_user_id', true), '')::uuid`), `is_admin_session()`, and `has_provider_access(patient_user_id, permission_type)`.
- [ ] `has_provider_access()` no longer references the dropped `can_view_dna` column — the fix in
  `20260529_fix_has_provider_access` recreates the function; verify no copy still carries the `'view_dna'`
  branch (under a NOBYPASSRLS role the stale branch broke EVERY multi-tenant read, not just DNA).
- [ ] `provider_patients` table has RLS for both `provider_id` and `patient_id`.
- [ ] **Every row-locked table has an UPDATE policy, even if it is never `UPDATE`d** (OF-22, the highest-value
  new check on this list). PostgreSQL applies UPDATE-policy checks to `SELECT ... FOR UPDATE` row locks.
  `sessions` had SELECT/INSERT/DELETE policies but no UPDATE policy — rotation is delete+reinsert, so none
  looked necessary — and under FORCE RLS with a NOBYPASSRLS role the `FOR UPDATE` lock in
  `authService.refreshTokens()` matched **zero rows**. Consequences: every token refresh returned 401, and
  the not-found row was misclassified as token **reuse**, firing the M-1 compromise detector so
  `revokeAllUserTokens()` nuked every session and stamped `tokens_valid_after` across devices. Fixed by
  `20260712_add_sessions_update_policy` (`sessions_update_own`). **Verification:** `Grep` for `FOR UPDATE`
  and `SELECT ... FOR SHARE` across `backend/src/`, map each to its table, and confirm that table has an
  UPDATE policy covering the locking role.
- [ ] The bug above was invisible in dev/staging because they connect as a **BYPASSRLS** role. Confirm the
  `rls` and `e2e` CI jobs both run under the NOBYPASSRLS `omh_app` role — that is the only place this class
  of bug can surface before production.
- [ ] Consent-column immutability (L23): `20260615_provider_consent_immutable_audit_insert_check` adds a
  BEFORE UPDATE trigger `provider_patients_guard_consent()` that restores the four consent permission columns
  (`can_view_biomarkers`, `can_view_insurance`, `can_view_health_needs`, `can_edit_data`) to their OLD values
  unless the writer is the patient or an admin (migration.sql:19-36), and makes `provider_patients_update`
  WITH CHECK explicit (migration.sql:50-56). RLS WITH CHECK alone can't compare OLD vs NEW, so verify the
  trigger is present and a provider session cannot self-escalate its own permissions.
- [ ] `audit_logs_insert` no longer accepts an arbitrary `user_id` (L40): the same migration rewrites the policy
  from `WITH CHECK (true)` to `WITH CHECK (user_id = current_user_id() OR is_admin_session() OR
  current_user_id() IS NULL)` (migration.sql:69-72) so audit rows can't be forged against another user.
  Flag any remaining `WITH CHECK (true)` insert policy.
- [ ] `audit_logs` retention is DB-enforced, not just app-side: the DELETE policy is now
  `USING (is_admin_session() AND created_at < (now() - interval '7 years'))`
  (`20260613_force_rls_and_audit_retention` migration.sql:41-44) — even an admin context cannot purge audit rows
  newer than 7 years. Confirm the 7-year window matches the HIPAA retention requirement and that no code path
  bypasses it.
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
  `backend/src/services/encryption.ts` (`export const PHI_FIELDS` at encryption.ts:476) and in
  [_phi-inventory](./_phi-inventory.md). Drift here means iteration-based sweeps (export, deletion, admin views,
  audit redaction) silently skip fields.
- [ ] Every field in `PHI_FIELDS` / the inventory exists in the schema (no stale entries after a migration).
- [ ] No plaintext PHI column: if a non-`Encrypted` column name matches a PHI concept (`firstName`, `dateOfBirth`, `phone`, `memberId`), flag it.
- [ ] Confirm the NEW encrypted fields are present in BOTH schema and `PHI_FIELDS`:
  - `User.healthProfileEncrypted` (added `20260418_add_health_profile`)
  - `HealthGoal.targetValueEncrypted` (added `20260420_encrypt_health_goal_target`)
  - `HealthGoal.currentValueEncrypted` / `startValueEncrypted` (M4, `20260613_encrypt_goal_values`;
    encryption.ts:519-520, schema.prisma:467,470)
  - `GoalProgressHistory.valueEncrypted` (M4, `20260613_encrypt_goal_values`; encryption.ts:524, schema.prisma:504)
  - `UserFile.originalFilenameEncrypted` (L24, `20260615_encrypt_userfile_original_filename`;
    encryption.ts:499, schema.prisma:164 — per-user AES-GCM; the plaintext twin `originalFilename` is being
    phased out via the `backfill-userfile-filenames` job + a follow-up drop, so it is deliberately NOT in `PHI_FIELDS`)
  - `AuditLog.metadataEncrypted` (M6, `20260606000001_encrypt_audit_metadata`; encryption.ts:530, schema.prisma:533 —
    the legacy plaintext `audit_logs.metadata` column was IRREVERSIBLY dropped in `20260615_drop_legacy_audit_metadata`)
  - `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted` (SMART-on-FHIR OAuth tokens — a stolen
    token is a direct path to live PHI at Quest/LabCorp)
- [ ] Health-goal numeric PHI now follows the encrypt-then-null pattern: `20260601_null_plaintext_health_goal_target`
  drops NOT NULL on `health_goals.target_value` and NULLs the plaintext value where an encrypted twin exists; M4
  (`20260613_encrypt_goal_values`) extends the same nullable-twin pattern to `current_value`/`start_value` and to
  `goal_progress_history.value`. The plaintext Decimal twins (`targetValue` schema.prisma:455, `currentValue` :462,
  `startValue` :468, `GoalProgressHistory.value` :503) are retained read-only and are NOT in `PHI_FIELDS` — flag if
  any new write path still populates them unencrypted instead of writing only the `*Encrypted` column.
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
- [ ] `20260615_drop_legacy_audit_metadata` (M6) IRREVERSIBLY drops the legacy plaintext `audit_logs.metadata`
  column (`ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "metadata"`, migration.sql:18) — done via DDL because
  `audit_logs` is immutable-by-RLS. New rows write only `metadata_encrypted`. Confirm no code still reads/writes
  the dropped plaintext `metadata` column and that the encrypted backfill ran before the drop.
- [ ] Index DDL: note that `20260103_add_compound_indexes` deliberately does NOT use `CREATE INDEX CONCURRENTLY`
  (Prisma wraps each migration in a transaction; `CONCURRENTLY` cannot run inside one) — it uses plain
  `CREATE INDEX IF NOT EXISTS` instead. Flag only locking risk on large tables, not the absence of `CONCURRENTLY`.
- [ ] Migrations are idempotent where possible (`IF EXISTS` / `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`).

### 6. Model Completeness
- [ ] All 19 models present and correct:
  - User, Session, RevokedAccessToken
  - UserEncryptionKey
  - ProviderPatient, UserFile
  - Biomarker, BiomarkerHistory
  - InsurancePlan, InsuranceBenefit
  - HealthNeed, HealthGoal, GoalProgressHistory
  - AuditLog, SystemConfig
  - ExpenseProjection, ExpenseActual, CostAnalysis
  - LabConnection (`20260418_add_lab_connections`)
  - `RevokedAccessToken` is the newest model (M1 cross-instance single-device access-token revocation;
    `jti` PK, `userId`, `expiresAt`, `createdAt`, `onDelete: Cascade`; table `revoked_access_tokens`,
    schema.prisma:96-106, added `20260613_revoked_access_tokens`)
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
