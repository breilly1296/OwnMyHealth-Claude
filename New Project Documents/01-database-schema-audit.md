# Database Schema Security Audit Report

**Project:** OwnMyHealth
**Audit Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (Automated Security Audit)
**Scope:** Database schema, RLS policies, encryption mapping, migration safety
**Risk Rating:** MODERATE -- most security controls are strong; several findings require remediation

---

## Files Reviewed

| File | Path |
|------|------|
| Prisma Schema | `backend/prisma/schema.prisma` |
| Database Service | `backend/src/services/database.ts` |
| Encryption Service | `backend/src/services/encryption.ts` |
| Initial Migration | `backend/prisma/migrations/00000000000000_initial_schema/migration.sql` |
| RLS Policies Migration | `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` |
| Compound Indexes Migration | `backend/prisma/migrations/20260103_add_compound_indexes/migration.sql` |
| User Files Migration | `backend/prisma/migrations/20260108000000_add_user_files_table/migration.sql` |
| Comprehensive Coverage | `backend/prisma/migrations/20260110_add_comprehensive_coverage_fields/migration.sql` |
| Extended Coverage | `backend/prisma/migrations/20260110_add_extended_coverage_fields/migration.sql` |
| Coinsurance Columns | `backend/prisma/migrations/20260110_add_coinsurance_columns/migration.sql` |
| Out-of-Network Fields | `backend/prisma/migrations/20260111_add_out_of_network_fields/migration.sql` |
| Expense Tracking | `backend/prisma/migrations/20260111_add_expense_tracking/migration.sql` |

---

## 1. Schema Security

### [x] PASS -- All tables have appropriate indexes for query performance

Every table has at least a primary key index and relevant foreign key indexes. Compound indexes exist for the most common query patterns. See Section 4 for detailed index analysis.

**Evidence:** `schema.prisma` lines 47-49 (User), 62-65 (Session), 81-82 (UserEncryptionKey), 105-108 (ProviderPatient), 128-130 (UserFile), 158-168 (Biomarker), 179-181 (BiomarkerHistory), 346-350 (InsurancePlan), 371-373 (InsuranceBenefit), 391-392 (DNAData), 405-407 (DNAVariant), 424-427 (GeneticTrait), 444-447 (HealthNeed), 475-481 (HealthGoal), 493-495 (GoalProgressHistory), 516-524 (AuditLog), 686-688 (ExpenseProjection), 714-716 (ExpenseActual), 733-735 (CostAnalysis).

### [x] PASS -- Foreign keys properly defined with ON DELETE behavior

All foreign keys are defined with explicit `ON DELETE` behavior:

| Table | FK Target | ON DELETE |
|-------|-----------|-----------|
| sessions | users | CASCADE |
| user_encryption_keys | users | CASCADE |
| provider_patients | users (provider) | CASCADE |
| provider_patients | users (patient) | CASCADE |
| biomarkers | users | CASCADE |
| biomarkers | user_files | SET NULL (via Prisma default, no explicit onDelete in schema) |
| biomarker_history | biomarkers | CASCADE |
| insurance_plans | users | CASCADE |
| insurance_benefits | insurance_plans | CASCADE |
| dna_data | users | CASCADE |
| dna_variants | dna_data | CASCADE |
| genetic_traits | dna_data | CASCADE |
| health_needs | users | CASCADE |
| health_goals | users | CASCADE |
| goal_progress_history | health_goals | CASCADE |
| audit_logs | users | NO ACTION (no `onDelete` specified) |
| expense_projections | users | CASCADE |
| expense_projections | insurance_plans | CASCADE |
| expense_actuals | users | CASCADE |
| expense_actuals | insurance_plans | CASCADE |
| expense_actuals | expense_projections | SetNull |
| cost_analyses | users | CASCADE |
| cost_analyses | insurance_plans | CASCADE |

**Finding (LOW):** `AuditLog.userId` FK (`schema.prisma:514`) has no explicit `onDelete` -- Prisma defaults to no action. This is actually correct behavior for HIPAA audit logs: audit records should NOT be deleted when a user is deleted. The logs must be retained for 7 years. However, this means user deletion will fail if audit logs reference that user ID. The application must handle this by nullifying audit log user_id references before deleting the user account.

**Finding (LOW):** `Biomarker.userFileId` FK (`schema.prisma:155`) has no explicit `onDelete` in the Prisma schema relation definition. The migration (`20260108000000`) correctly sets `ON DELETE SET NULL`, so the database enforces it, but the Prisma schema should explicitly declare this for documentation clarity.

### [x] PASS -- No sensitive data stored in plaintext (check for PHI fields)

All PHI fields use the `*Encrypted` suffix naming convention for dedicated encrypted columns. The encryption service (`encryption.ts`) maps these fields via the `PHI_FIELDS` constant.

**CRITICAL FINDING (HIGH) -- Expense model PHI naming inconsistency:**

The expense tracking models (`ExpenseProjection`, `ExpenseActual`, `CostAnalysis`) have fields listed in `PHI_FIELDS` (e.g., `serviceType`, `estimatedCost`, `providerName`, `billedAmount`, `insurancePaid`, `patientPaid`, `notes`, `claudeResponse`, `totalProjectedOop`) that do NOT follow the `*Encrypted` column naming convention used by all other models. These columns are defined as plain `String`, `Decimal`, and `Text` types in `schema.prisma` (lines 669-736).

The `PHI_FIELDS` mapping (`encryption.ts:418-437`) lists these non-suffixed field names, suggesting application-layer encryption is intended. However:

1. The Decimal fields (`estimatedCost`, `billedAmount`, `insurancePaid`, `patientPaid`, `appliedToDeductible`, `appliedToOop`, `totalProjectedOop`) are declared as `Decimal(10,2)` in the schema -- encrypted ciphertext cannot be stored in a Decimal column. This is a **type mismatch** that would cause runtime errors if encryption were actually applied.
2. The `projectedExpensesSnapshot` field is `Json?` type -- encrypted data cannot be stored as JSONB.
3. This strongly suggests that **expense PHI data is NOT actually encrypted** despite being listed in PHI_FIELDS, or the PHI_FIELDS mapping is aspirational but not enforced for these models.

**Recommendation:** Either (a) change expense columns storing PHI to `String/Text` type with `*Encrypted` suffix and ensure the encryption service encrypts them before storage, or (b) remove them from PHI_FIELDS if they do not contain PHI. Given that service types, provider names, billed amounts, and AI analysis responses clearly constitute PHI/financial health data, option (a) is required for HIPAA compliance.

### [x] PASS -- UUID used for primary keys (not sequential integers)

All tables use `UUID` primary keys generated by `gen_random_uuid()` (PostgreSQL native) or Prisma's `@default(uuid())`. No sequential integer IDs are used anywhere.

**Evidence:** Every model's `id` field uses `@db.Uuid` with either `@default(dbgenerated("gen_random_uuid()"))` or `@default(uuid())`.

**Minor note:** `UserFile`, `ExpenseProjection`, `ExpenseActual`, and `CostAnalysis` use `@default(uuid())` (Prisma-generated) while other models use `@default(dbgenerated("gen_random_uuid()"))` (database-generated). Both produce valid UUIDs, but the inconsistency is worth noting. Database-generated UUIDs are preferable as they cannot be manipulated client-side.

---

## 2. Row-Level Security

### [x] PASS -- RLS policies defined for ALL user-owned tables

RLS is enabled on all 19 tables with appropriate policies:

| Table | RLS Enabled | Migration |
|-------|-------------|-----------|
| users | Yes | `20260107_add_rls_policies:68` |
| sessions | Yes | `20260107_add_rls_policies:69` |
| user_encryption_keys | Yes | `20260107_add_rls_policies:70` |
| biomarkers | Yes | `20260107_add_rls_policies:71` |
| biomarker_history | Yes | `20260107_add_rls_policies:72` |
| insurance_plans | Yes | `20260107_add_rls_policies:73` |
| insurance_benefits | Yes | `20260107_add_rls_policies:74` |
| dna_data | Yes | `20260107_add_rls_policies:75` |
| dna_variants | Yes | `20260107_add_rls_policies:76` |
| genetic_traits | Yes | `20260107_add_rls_policies:77` |
| health_needs | Yes | `20260107_add_rls_policies:78` |
| health_goals | Yes | `20260107_add_rls_policies:79` |
| goal_progress_history | Yes | `20260107_add_rls_policies:80` |
| provider_patients | Yes | `20260107_add_rls_policies:81` |
| audit_logs | Yes | `20260107_add_rls_policies:82` |
| system_config | Yes | `20260107_add_rls_policies:83` |
| user_files | Yes | `20260108000000:37` |
| expense_projections | Yes | `20260111_add_expense_tracking:61` |
| expense_actuals | Yes | `20260111_add_expense_tracking:62` |
| cost_analyses | Yes | `20260111_add_expense_tracking:63` |

### [~] PARTIAL -- Policies use `user_id = current_setting('app.current_user_id')::uuid`

**Finding (MEDIUM) -- Inconsistent RLS implementation patterns:**

Two distinct RLS patterns are used across migrations:

**Pattern A (Main RLS migration -- `20260107`):** Uses helper functions `current_user_id()` and `is_admin_session()`. These functions handle exceptions gracefully (return NULL/false on errors) and cast properly. Example:
```sql
user_id = current_user_id() OR is_admin_session()
```

**Pattern B (Expense tracking -- `20260111`, User files -- `20260108`):** Uses raw `current_setting()` calls directly in policy definitions without the helper functions. Example:
```sql
user_id::text = current_setting('app.current_user_id', true)
-- and --
current_setting('app.is_admin', true)::boolean = true
```

Pattern B has two issues:
1. It compares `user_id::text` to the string setting, rather than casting the setting to UUID. This works functionally but is less type-safe and could fail on UUID format edge cases.
2. It does not use the established helper functions, meaning if the helper functions are updated (e.g., to add additional safety checks), the expense and user_files policies will not benefit.

**Recommendation:** Refactor expense tracking and user_files RLS policies to use `current_user_id()` and `is_admin_session()` helper functions for consistency and maintainability.

### [x] PASS -- ProviderPatient table has RLS for both `providerId` and `patientId`

The `provider_patients` table has comprehensive RLS policies (`20260107_add_rls_policies:473-505`):

- **SELECT:** `provider_id = current_user_id() OR patient_id = current_user_id() OR is_admin_session()`
- **INSERT:** `provider_id = current_user_id() OR is_admin_session()` (only providers can create requests)
- **UPDATE:** Both provider and patient can update (provider modifies access, patient approves/revokes)
- **DELETE:** Either party can delete the relationship

This correctly implements dual-party access control.

### [x] PASS -- Admin bypass uses `app.is_admin = true` correctly

The `is_admin_session()` function (`20260107_add_rls_policies:28-36`) correctly reads `app.is_admin` setting with a default of `false` and handles exceptions. All RLS policies include `OR is_admin_session()` for admin bypass.

The application code sets admin context via `setAdminContext()` (`database.ts:301-315`) and `withRLSContext(null, ...)` (`database.ts:362-363`), which correctly sets `app.is_admin = 'true'`.

**Security note:** The `withRLSContext` function (`database.ts:353-376`) uses `SET LOCAL` which scopes settings to the current transaction. However, `withRLSContext` does NOT wrap operations in an explicit transaction -- it sets the context, runs the function, then clears it. Since `SET LOCAL` only works within a transaction block, and Prisma operations may run in separate implicit transactions, the RLS context set outside `withRLSTransaction` may not actually take effect. The `withRLSTransaction` function (`database.ts:388-415`) correctly uses `$transaction` to ensure `SET LOCAL` applies. **Controllers should prefer `withRLSTransaction` for reliable RLS enforcement.**

---

## 3. PHI Fields Identification

### [x] PASS -- Identify all PHI-containing columns

All PHI-containing columns identified across the schema:

| Model | Field | Schema Line | PHI_FIELDS Listed |
|-------|-------|-------------|-------------------|
| User | firstNameEncrypted | 14 | Yes |
| User | lastNameEncrypted | 15 | Yes |
| User | dateOfBirthEncrypted | 16 | Yes |
| User | phoneEncrypted | 17 | Yes |
| User | addressEncrypted | 18 | Yes |
| Biomarker | valueEncrypted | 139 | Yes |
| Biomarker | notesEncrypted | 140 | Yes |
| BiomarkerHistory | valueEncrypted | 174 | Yes |
| InsurancePlan | memberIdEncrypted | 191 | Yes |
| InsurancePlan | groupIdEncrypted | 192 | Yes |
| ProviderPatient | notesEncrypted | 98 | Yes |
| DNAVariant | genotypeEncrypted | 401 | Yes |
| GeneticTrait | descriptionEncrypted | 417 | Yes |
| GeneticTrait | recommendationsEncrypted | 418 | Yes |
| HealthNeed | descriptionEncrypted | 435 | Yes |
| HealthGoal | descriptionEncrypted | 454 | Yes |
| GoalProgressHistory | noteEncrypted | 489 | Yes |
| AuditLog | previousValueEncrypted | 508 | Yes |
| AuditLog | newValueEncrypted | 509 | Yes |

### [~] PARTIAL -- Verify encryption service is used for all PHI

**Verified encrypted fields (schema columns use `*Encrypted` suffix):**

- [x] Biomarker values and notes (`valueEncrypted`, `notesEncrypted`) -- `schema.prisma:139-140`
- [x] BiomarkerHistory values (`valueEncrypted`) -- `schema.prisma:174`
- [x] User PII (firstNameEncrypted, lastNameEncrypted, dateOfBirthEncrypted, phoneEncrypted, addressEncrypted) -- `schema.prisma:14-18`
- [x] Insurance details (memberIdEncrypted, groupIdEncrypted) -- `schema.prisma:191-192`
- [x] Health goal descriptions (`descriptionEncrypted`) -- `schema.prisma:454`
- [x] Goal progress notes (`noteEncrypted`) -- `schema.prisma:489`
- [x] Provider relationship notes (`notesEncrypted`) -- `schema.prisma:98`
- [x] DNA/genetic data (genotypeEncrypted, descriptionEncrypted, recommendationsEncrypted) -- `schema.prisma:401,417-418`
- [x] Audit log PHI values (previousValueEncrypted, newValueEncrypted) -- `schema.prisma:508-509`
- [x] Health need descriptions (`descriptionEncrypted`) -- `schema.prisma:435`

**FINDINGS requiring remediation:**

- [ ] **FAIL -- Expense data (HIGH):** `ExpenseProjection.serviceType` (`schema.prisma:673`), `ExpenseProjection.estimatedCost` (`schema.prisma:674`), `ExpenseProjection.notes` (`schema.prisma:677`), `ExpenseActual.serviceType` (`schema.prisma:696`), `ExpenseActual.providerName` (`schema.prisma:697`), `ExpenseActual.billedAmount` (`schema.prisma:699`), `ExpenseActual.insurancePaid` (`schema.prisma:700`), `ExpenseActual.patientPaid` (`schema.prisma:701`), `ExpenseActual.appliedToDeductible` (`schema.prisma:702`), `ExpenseActual.appliedToOop` (`schema.prisma:703`), `ExpenseActual.notes` (`schema.prisma:706`) -- These are declared as plain `String`/`Decimal` types, NOT encrypted Text columns. The `PHI_FIELDS` mapping references these field names but encryption cannot be applied to Decimal columns.

- [ ] **FAIL -- Cost analysis AI responses (HIGH):** `CostAnalysis.claudeResponse` (`schema.prisma:724`) is `String` (Text), which could hold encrypted data, but `CostAnalysis.totalProjectedOop` (`schema.prisma:725`) is `Decimal(10,2)` and `CostAnalysis.projectedExpensesSnapshot` (`schema.prisma:727`) is `Json?` -- neither can store encrypted ciphertext.

- [~] **PARTIAL -- InsurancePlan additional fields:** The `planName` (`schema.prisma:187`), `insurerName` (`schema.prisma:188`), and many copay/deductible financial fields are stored as plain VARCHAR/Decimal. While plan names and insurer names alone may not constitute PHI, when combined with user identity they could identify a patient's insurance status. The `PHI_FIELDS` mapping does not include these fields. This is a **risk acceptance decision** rather than a clear violation.

- [~] **PARTIAL -- HealthNeed.name:** `schema.prisma:434` stores health need names (e.g., "Diabetes management") as plain `VARCHAR(200)`. This could constitute PHI. It is NOT listed in `PHI_FIELDS` and not encrypted.

- [~] **PARTIAL -- HealthGoal.name, category, unit:** `schema.prisma:452,455,459` store goal names, categories, and units in plain text. Goal names like "Lower A1C" could reveal health conditions. Not encrypted.

- [~] **PARTIAL -- Biomarker.category, name, unit, labName:** `schema.prisma:136-138,148` store biomarker metadata in plain text. While the actual value is encrypted, knowing that a user has a "Hemoglobin A1C" biomarker from "Quest Diagnostics" is itself PHI.

---

## 4. Indexes

### [x] PASS -- Compound indexes exist for common query patterns

| Required Index | Present | Location |
|---------------|---------|----------|
| `biomarkers(user_id, category, measurement_date)` | Yes | `schema.prisma:163-164`, `20260103:12-13` |
| `biomarkers(user_id, is_out_of_range)` | Yes | `schema.prisma:166`, initial migration:426 |
| `audit_logs(user_id, created_at)` | Yes | `schema.prisma:522-523`, `20260103:7-8` |
| `audit_logs(action, resource_type)` | Separate single-column indexes only | `schema.prisma:517-518` |
| `insurance_plans(user_id, is_active)` | Yes (compound with isPrimary) | `schema.prisma:348-349`, `20260103:22-23` |
| `health_needs(user_id, status, urgency)` | Separate single-column indexes only | `schema.prisma:444-446` |
| `health_goals(user_id, status)` | Yes (compound with targetDate) | `schema.prisma:479-480`, `20260103:17-18` |
| `sessions(user_id, expires_at)` | Separate single-column indexes only | `schema.prisma:62-64` |
| `provider_patient(provider_id, patient_id, status)` | Unique on (provider_id, patient_id) + separate status index | `schema.prisma:104-107` |

**Findings:**

- [~] **PARTIAL -- `audit_logs(action, resource_type)` compound index missing:** Only separate single-column indexes exist on `action` and `resource_type`. A compound index would benefit queries that filter by both (e.g., "show all READ actions on biomarkers"). Severity: LOW.

- [~] **PARTIAL -- `health_needs(user_id, status, urgency)` compound index missing:** Only separate single-column indexes exist. Common queries like "show user's PENDING IMMEDIATE health needs" would benefit from a compound index. Severity: LOW.

- [~] **PARTIAL -- `sessions(user_id, expires_at)` compound index missing:** Separate indexes exist. Session cleanup queries that filter by user and expiration would benefit from a compound index. Severity: LOW.

### [x] PASS -- No missing indexes on foreign keys

All foreign key columns have indexes:

| FK Column | Index |
|-----------|-------|
| sessions.user_id | `schema.prisma:62` |
| user_encryption_keys.user_id | `schema.prisma:81` |
| provider_patients.provider_id | `schema.prisma:105` |
| provider_patients.patient_id | `schema.prisma:106` |
| biomarkers.user_id | `schema.prisma:158` |
| biomarkers.user_file_id | `schema.prisma:162` |
| biomarker_history.biomarker_id | `schema.prisma:179` |
| insurance_plans.user_id | `schema.prisma:346` |
| insurance_benefits.plan_id | `schema.prisma:371` |
| dna_data.user_id | `schema.prisma:391` |
| dna_variants.dna_data_id | `schema.prisma:405` |
| genetic_traits.dna_data_id | `schema.prisma:424` |
| health_needs.user_id | `schema.prisma:444` |
| health_goals.user_id | `schema.prisma:475` |
| goal_progress_history.goal_id | `schema.prisma:493` |
| audit_logs.user_id | `schema.prisma:516` |
| expense_projections.user_id+plan_id | `schema.prisma:686` (compound) |
| expense_actuals.user_id+plan_id | `schema.prisma:714` (compound) |
| cost_analyses.user_id+plan_id | `schema.prisma:733` (compound) |

**Note:** `expense_actuals.projection_id` does NOT have its own index. Only the compound `(user_id, plan_id)` index exists. If queries frequently join on `projection_id`, a dedicated index would be beneficial. Severity: LOW.

---

## 5. Migration Safety

### [~] PARTIAL -- No destructive migrations without data backup plan

All migrations are additive (CREATE TABLE, ADD COLUMN, CREATE INDEX, ALTER TABLE ENABLE RLS, CREATE POLICY). No DROP, TRUNCATE, or DELETE operations found in any migration.

However, the `20260111_add_out_of_network_fields/migration.sql` uses a bare `ALTER TABLE ADD COLUMN` without `IF NOT EXISTS` guard (unlike the idempotent patterns used in `20260110` migrations). If re-run, this migration would fail.

### [ ] FAIL -- `CREATE INDEX CONCURRENTLY` used for production indexes

**Finding (MEDIUM):** No migration uses `CREATE INDEX CONCURRENTLY`. The compound indexes migration (`20260103`) explicitly notes in a comment (line 3): "CONCURRENTLY removed because it cannot run inside a transaction." While this is a valid Prisma migration limitation (Prisma runs migrations in transactions), it means index creation will lock the affected tables for writes during index build.

For the initial deployment this is acceptable (no live traffic), but any future index additions on populated tables in production should be applied outside of Prisma migrations using `CREATE INDEX CONCURRENTLY` to avoid downtime.

### [x] PASS -- Migrations are idempotent where possible

The `20260110_add_comprehensive_coverage_fields` and `20260110_add_extended_coverage_fields` migrations use `IF NOT EXISTS` checks (via `DO $$ BEGIN ... END $$` blocks) to safely add columns. The `20260110_add_coinsurance_columns` migration uses `ADD COLUMN IF NOT EXISTS`.

**Exception:** `20260111_add_out_of_network_fields` does NOT use `IF NOT EXISTS` -- this migration is not idempotent.

---

## 6. Model Completeness

### [x] PASS -- All 15+ models present and correct

All required models are present in `schema.prisma`:

| Model | Present | Schema Line |
|-------|---------|-------------|
| User | Yes | 10 |
| Session | Yes | 52 |
| UserEncryptionKey | Yes | 68 |
| Biomarker | Yes | 133 |
| BiomarkerHistory | Yes | 171 |
| InsurancePlan | Yes | 184 |
| InsuranceBenefit | Yes | 353 |
| HealthNeed | Yes | 430 |
| HealthGoal | Yes | 450 |
| GoalProgressHistory | Yes | 484 |
| DNAData | Yes | 376 |
| DNAVariant | Yes | 395 |
| GeneticTrait | Yes | 410 |
| ProviderPatient | Yes | 85 |
| UserFile | Yes | 111 |
| ExpenseProjection | Yes | 669 |
| ExpenseActual | Yes | 691 |
| CostAnalysis | Yes | 719 |
| AuditLog | Yes | 498 |
| SystemConfig | Yes | 527 |

Total: 20 models (exceeds the 15+ requirement).

### [x] PASS -- Proper ON DELETE behavior for all foreign keys

See Section 1 table. All user-owned data cascades on user deletion. Audit logs correctly use no cascade (HIPAA retention). Child records cascade from parents. `ExpenseActual.projectionId` uses `SetNull` appropriately.

### [x] PASS -- Unique constraints where needed

| Constraint | Present | Location |
|-----------|---------|----------|
| User.email unique | Yes | `schema.prisma:12` |
| ProviderPatient (providerId, patientId) unique | Yes | `schema.prisma:104` |
| Session.token unique | Yes | `schema.prisma:55` |
| UserEncryptionKey (userId, keyType, version) unique | Yes | `schema.prisma:80` |
| SystemConfig.key unique | Yes | `schema.prisma:529` |
| User.emailVerificationToken unique | Yes | `schema.prisma:20` |
| User.passwordResetToken unique | Yes | `schema.prisma:22` |

---

## Questions to Ask (Answered)

### 1. Are there any tables without RLS that should have it?

**No.** All 20 tables have RLS enabled. The `system_config` table (admin-only) and `user_encryption_keys` table both correctly have RLS. Even the `audit_logs` table has RLS with a permissive INSERT policy (any session can create audit entries) but restricted SELECT (only own logs or admin).

### 2. Are any PHI fields missing encryption?

**Yes -- CRITICAL.** The expense tracking models have PHI fields that cannot be encrypted due to column type mismatches (Decimal, Json types). See Section 3 findings.

Additionally, several metadata fields that could constitute PHI when combined with user identity are stored in plaintext:
- `HealthNeed.name` (VARCHAR) -- could reveal health conditions
- `HealthGoal.name`, `category` -- could reveal health conditions
- `Biomarker.category`, `name`, `unit`, `labName` -- biomarker metadata reveals what was tested
- `InsurancePlan.planName`, `insurerName` -- insurance identity
- `UserFile.filename`, `originalFilename`, `labName` -- file metadata

### 3. Are there N+1 query patterns that need indexes?

The existing indexes cover the primary query patterns well. Three compound indexes noted as missing in Section 4 could improve performance:
- `audit_logs(action, resource_type)` -- for filtered HIPAA compliance reports
- `health_needs(user_id, status, urgency)` -- for filtered health needs listing
- `sessions(user_id, expires_at)` -- for session cleanup queries

### 4. Are cascade deletes correct for account deletion?

**Mostly yes, with one concern.** All user-owned data tables cascade on user deletion, which is correct for GDPR/data deletion requests. The `AuditLog` FK does NOT cascade (correct for HIPAA 7-year retention), but this means user deletion will fail with a foreign key violation unless the application first sets `audit_logs.user_id = NULL` for that user's records. The application must handle this in its account deletion workflow.

### 5. Are DNA/genetic models still needed or should they be removed?

The `CLAUDE.md` documents these as **deprecated**: "These models remain in schema.prisma but are not actively used in the UI." The schema still has `DNAData`, `DNAVariant`, and `GeneticTrait` with full RLS policies, indexes, and encryption. These are taking up schema complexity and migration maintenance burden. **Recommend removing if no roadmap exists for genetic features.**

---

## Summary of Findings

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| F1 | **HIGH** | Expense model PHI fields use Decimal/Json column types that cannot store encrypted ciphertext -- PHI likely stored in plaintext | `schema.prisma:669-736`, `encryption.ts:418-437` |
| F2 | **MEDIUM** | Inconsistent RLS policy patterns -- expense and user_files tables use raw `current_setting()` instead of helper functions | `20260111_add_expense_tracking:66-111`, `20260108000000:40-66` |
| F3 | **MEDIUM** | `withRLSContext` uses `SET LOCAL` outside a transaction -- may not reliably enforce RLS | `database.ts:353-376` |
| F4 | **MEDIUM** | No `CREATE INDEX CONCURRENTLY` in any migration -- table locks during index creation | All migration files |
| F5 | **LOW** | Biomarker/HealthNeed/HealthGoal metadata (name, category, labName) stored in plaintext | `schema.prisma:136-138,148,434,452,455` |
| F6 | **LOW** | `AuditLog.userId` FK lacks explicit onDelete -- user deletion may fail | `schema.prisma:514` |
| F7 | **LOW** | Missing compound indexes for `audit_logs(action, resource_type)`, `health_needs(user_id, status, urgency)`, `sessions(user_id, expires_at)` | `schema.prisma` |
| F8 | **LOW** | `expense_actuals.projection_id` lacks dedicated index | `schema.prisma:695` |
| F9 | **LOW** | `20260111_add_out_of_network_fields` migration not idempotent (no IF NOT EXISTS) | `20260111_add_out_of_network_fields:4-8` |
| F10 | **INFO** | Inconsistent UUID generation (some Prisma-side, some DB-side) | `schema.prisma:112,670,692,720` |
| F11 | **INFO** | Deprecated DNA/genetic models adding schema maintenance burden | `schema.prisma:376-428` |

---

## Recommended Remediation Priority

1. **(P0 -- Immediate)** F1: Redesign expense tracking columns to use Text/String types with `*Encrypted` suffix. Update controllers to encrypt/decrypt expense PHI through the encryption service.
2. **(P1 -- Next Sprint)** F2: Refactor expense/user_files RLS policies to use `current_user_id()` and `is_admin_session()` helper functions.
3. **(P1 -- Next Sprint)** F3: Audit all usages of `withRLSContext` (vs `withRLSTransaction`) in controllers. Ensure PHI-accessing queries use `withRLSTransaction` for reliable RLS enforcement.
4. **(P2 -- Planned)** F5: Evaluate whether biomarker/health metadata fields should be encrypted. At minimum, document the risk acceptance decision.
5. **(P2 -- Planned)** F6: Ensure account deletion workflow nullifies audit_logs.user_id before user deletion, or add explicit `onDelete: SetNull` to the Prisma schema.
6. **(P3 -- Backlog)** F7, F8: Add missing compound indexes.
7. **(P3 -- Backlog)** F11: Remove deprecated DNA/genetic models if not on roadmap.

---

*Report generated by automated security audit on 2026-02-06.*
