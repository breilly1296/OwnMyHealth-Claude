# 01-database-schema Review — 2026-06-01

Scope: `backend/prisma/schema.prisma`, `backend/prisma/migrations/`, `backend/src/services/database.ts`, `backend/src/services/encryption.ts`, plus the call sites the checklist points at (provider route handlers, expense/health-goal controllers, FHIR lab sync, account deletion). Report only — no code modified.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 3 |
| Info | 1 |

> Verifier note (2026-06-01): F-2 was removed as a false finding (migration count is 22, matching the spec — not 23). Low count adjusted 4 → 3. Remaining findings F-1, F-3, F-4, F-5, F-6 verified against the live code.

## Findings

### F-1 — Numeric health-goal target written to a plaintext `target_value` column on every create and update — **High**
- **Location:** `backend/src/controllers/healthGoalsController.ts:401` (create) and `backend/src/controllers/healthGoalsController.ts:487` (update); schema column `backend/prisma/schema.prisma:410` (`targetValue Decimal @map("target_value")`).
- **Observation:** Migration `20260420_encrypt_health_goal_target` added `targetValueEncrypted` so the numeric goal target (target cholesterol, weight, A1c, etc.) is stored as ciphertext, and the read path already prefers it (`readTargetValue`, `healthGoalsController.ts:37`). But both write paths still populate the legacy plaintext `targetValue` Decimal column in the same write — not just for backward-compat reads of old rows, but for brand-new writes. The checklist explicitly says to flag this: *"the plaintext `targetValue` Decimal column is retained for backward-compat reads — flag if new writes still populate it unencrypted."*
- **Impact:** A sensitive health datum is persisted in cleartext in the `target_value` column for every goal created or edited today. RLS limits row visibility, but RLS is not encryption: a DB-level read (backup, replica, snapshot, SQL injection, or a BYPASSRLS role in dev/staging) exposes the plaintext target, and any future iteration-based PHI sweep keyed off `PHI_FIELDS` (export/deletion/audit redaction) will skip `target_value` because it is not an `*Encrypted` column. A numeric target alone can reveal a managed condition.
- **Fix:** In `createGoal` (line ~401) and `updateGoal` (line ~487), stop writing `targetValue` for new rows — write only `targetValueEncrypted`. Then ship a data migration that re-encrypts any remaining plaintext `target_value` values into `target_value_encrypted` and NULLs the plaintext column, completing the rollout the comment at `healthGoalsController.ts:388-390` describes as still in progress.
- **Evidence:**
  ```ts
  // healthGoalsController.ts:400-402 (create)
        category,
        targetValue,
        targetValueEncrypted,
  ```
  ```ts
  // healthGoalsController.ts:486-487 (update)
    if (targetValue !== undefined) {
      updateData.targetValue = targetValue;
  ```

### F-2 — REMOVED (false finding) — migration count is NOT stale
- **Verifier note (2026-06-01):** The original F-2 claimed prompt drift — "migration count is 23, not 22." This is wrong. The live repo has exactly **22** migration directories (`ls backend/prisma/migrations` → 22 dirs excluding `migration_lock.toml`), which matches the spec's "22 dirs" at `prompts/01-database-schema.md:19`. The `20260601_add_email_change` migration is real and is the newest dir, but its presence does not push the count to 23 — it is already included in the 22. There is no count drift to report, so this finding is withdrawn. (The schema/migration content cited — `pending_email`/`email_change_token`/`email_change_expires` at `schema.prisma:24-26` and `20260601_add_email_change/migration.sql:7-10` — is accurate; only the count premise was false.)

### F-3 — `users_select_provider` exposes secret columns; safety depends entirely on hand-maintained per-query allowlists — **Low**
- **Location:** `backend/prisma/migrations/20260530_add_users_select_provider/migration.sql:54` (policy); enforcement in `backend/src/routes/providerRoutes.ts:77,170,329,457,597`.
- **Observation:** The additive `users_select_provider` policy lets a provider session read the *entire* consented patient `users` row, including `password_hash`, `email_verification_token`, `password_reset_token`, and `email_change_token`. The encrypted PHI columns stay protected (provider lacks the per-user key) but the plaintext secret-token / password-hash columns do not. The migration comment acknowledges this and states every provider-context `users` read MUST use an explicit non-secret column allowlist. I verified the current provider handlers do exactly that (`select: { id, email, createdAt }` etc.), so there is no live leak today — but the protection is a coding convention with no engine-level backstop.
- **Impact:** No current exploit (handlers comply). Forward risk: any future provider-context `users` query that omits an explicit `select`, or uses `select: true` / a spread, would return the patient's `password_hash` and live reset/verification tokens to the provider session — a direct account-takeover path. The CI guard checks for `prisma.*` RLS-bypass, not for column allowlists on `users`.
- **Fix:** Move the secret columns (`password_hash`, `*_token`) into a separate table not covered by `users_select_provider`, or expose provider-visible identity through a restricted view, so the engine enforces column scope. Until then, add a lint/CI rule that fails any `tx.user.find*` lacking an explicit `select`.
- **Evidence:**
  ```sql
  -- 20260530_add_users_select_provider/migration.sql:54-56
  CREATE POLICY users_select_provider ON users
    FOR SELECT
    USING (has_active_consent(id));
  ```
  ```ts
  // providerRoutes.ts:76-77 — handlers comply with the allowlist requirement
  // never select password_hash / *_token in provider context.
  select: { id: true, email: true, createdAt: true },
  ```

### F-4 — Redundant duplicate `@@index` declarations in schema — **Low**
- **Location:** `backend/prisma/schema.prisma:171-172`, `:356-357`, `:439-440`, `:482-483` (audit_logs; line 481 is the distinct `audit_logs_created_at_desc_idx`, the duplicate pair is 482-483).
- **Observation:** Several compound indexes are declared twice — once with an explicit `map:` name (the one the migration created) and once without (auto-named). E.g. `biomarkers` declares `@@index([userId, category, measurementDate(sort: Desc)], map: "biomarkers_user_category_date_idx")` immediately followed by an identical `@@index([userId, category, measurementDate(sort: Desc)])`. Same pattern on `insurance_plans`, `health_goals`, and `audit_logs`.
- **Impact:** Low. If `prisma migrate` ever materializes the un-mapped duplicates, Postgres carries two identical indexes per pattern — extra write amplification and storage on hot, per-user tables (`biomarkers`, `audit_logs`) — with no query benefit. No security impact; a performance/hygiene gap.
- **Fix:** Drop the un-mapped duplicate `@@index` lines, keeping only the `map:`-named ones that the migrations actually created.
- **Evidence:**
  ```prisma
  // schema.prisma:171-172
  @@index([userId, category, measurementDate(sort: Desc)], map: "biomarkers_user_category_date_idx")
  @@index([userId, category, measurementDate(sort: Desc)])
  ```

### F-5 — Backend dependencies carry known moderate CVEs — **Low**
- **Location:** `backend/package.json` (transitive deps via `@google-cloud/storage` and `prisma`/`@prisma/dev`).
- **Observation:** `npm audit --omit=dev` reports 8 moderate vulnerabilities: `uuid` < 11.1.1 (GHSA-w5hq-g745-h8pq, missing buffer bounds check) pulled in transitively by `@google-cloud/storage`/`gaxios`/`teeny-request`, and a `@hono/node-server` advisory under `@prisma/dev`. Out of the strict schema lane but surfaced because the spec authorizes `npm audit`.
- **Impact:** Low for a schema review. The `uuid` flaw requires an attacker-controlled `buf` argument, which the GCS client does not expose to user input; the `@prisma/dev`/`@hono` chain is dev tooling. Worth tracking, not urgent.
- **Fix:** Bump `@google-cloud/storage` to a release that depends on `uuid >= 11.1.1`; track the Prisma advisory (fix lands with `prisma@6.20+`). Avoid `npm audit fix --force` blindly — it proposes breaking majors (`uuid@14`, `prisma@6.19`).
- **Evidence:** `npm audit --omit=dev` output: `uuid <11.1.1 ... Severity: moderate ... 8 moderate severity vulnerabilities`.

### F-6 — Dead RLS scaffolding for dropped DNA tables remains in migration history (informational) — **Info**
- **Location:** `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:75-77, 288-378`.
- **Observation:** The original RLS migration still contains `ALTER TABLE dna_data ENABLE ROW LEVEL SECURITY` and ~90 lines of `dna_*` / `genetic_traits` policies plus the `view_dna` branch in `has_provider_access`. These are correct as immutable history — `20260423_drop_dna_genetics` (CASCADE) drops the tables/column and `20260529_fix_has_provider_access` recreates the function without the `view_dna` branch. The live function, schema, and `PHI_FIELDS` are all clean (verified below). This is noted only because a reader grepping migration history will hit DNA references; they are historical, not live.
- **Impact:** None. Replaying migrations from scratch applies create-then-drop correctly.
- **Fix:** None required. Optionally annotate the dropped-feature note already present in `20260423_drop_dna_genetics/migration.sql:14-19`.
- **Evidence:**
  ```sql
  -- 20260107_add_rls_policies/migration.sql:53 (historical; removed by 20260529)
  WHEN 'view_dna' THEN pp.can_view_dna
  ```

## Checks passed

### 1. Schema Security
- [x] UUID primary keys, not sequential ints — every model uses `@default(dbgenerated("gen_random_uuid()")) @db.Uuid` (e.g. `schema.prisma:11`, `:62`, `:693`).
- [x] PHI not in plaintext (with the F-1 exception) — identity/health/insurance/expense/token PHI all live in `*Encrypted` columns (`schema.prisma:14-18,147-148,199-200,618-619,700-701`).
- [x] Foreign keys defined with explicit ON DELETE — verified in `00000000000000_initial_schema/migration.sql:358-400` and per-table migrations.

### 2. Row-Level Security
- [x] RLS enabled for all 18 tables — core set `20260107_add_rls_policies/migration.sql:68-83`; `user_files` `20260108000000_add_user_files_table/migration.sql:37`; expense trio `20260111_add_expense_tracking/migration.sql:61-63`; `lab_connections` `20260418_add_lab_connections/migration.sql:35`. All 18 `@@map` tables (`schema.prisma:58…715`) are covered.
- [x] DNA/genetics tables gone — `schema.prisma` has no `DNAData`/`DNAVariant`/`GeneticTrait` model; `20260423_drop_dna_genetics/migration.sql:23-32` drops tables, `can_view_dna`, and the `ProcessingStatus`/`RiskLevel` enums. No `src/` code references them (only migration history + one test comment, `rls.test.ts:227`).
- [x] Policies key off the documented helpers — `current_user_id()` `migration.sql:17-25`, `is_admin_session()` `:28-36`, `has_provider_access()` `:39-62`.
- [x] `has_provider_access()` no longer references `can_view_dna` — recreated without the branch in `20260529_fix_has_provider_access/migration.sql:20-42`; no live copy carries `'view_dna'`.
- [x] `provider_patients` RLS covers both provider_id and patient_id — `20260107_add_rls_policies/migration.sql:473-505`.
- [x] Provider can read a consented patient's `users` row via `users_select_provider` AND handlers restrict columns — policy `20260530_add_users_select_provider/migration.sql:54`; allowlists at `providerRoutes.ts:77,170,329,457,597` (see F-3 for the residual hardening gap).
- [x] Self-elevation blocked by trigger, not the policy comment — `users_prevent_self_privilege_change` BEFORE UPDATE trigger on `role`/`is_active`, `20260424_prevent_self_role_elevation/migration.sql:59-62`.
- [x] Admin bypass via `app.is_admin = true` → `is_admin_session()` — set parameterized in `database.ts:376` (`set_config('app.is_admin', …, true)`), read by helper `migration.sql:28-36`.

### 3. PHI Fields Identification
- [x] Every `*Encrypted` schema column is in `PHI_FIELDS` and vice versa — schema columns (`schema.prisma`) map 1:1 to `encryption.ts:410-486`: User(6), Biomarker(2), BiomarkerHistory(1), InsurancePlan(2), ProviderPatient(1), HealthNeed(1), HealthGoal(2), GoalProgressHistory(1), AuditLog(2), ExpenseProjection(3), ExpenseActual(8), CostAnalysis(3), LabConnection(2).
- [x] New encrypted fields present in both schema and `PHI_FIELDS` — `User.healthProfileEncrypted` (`schema.prisma:33`, `encryption.ts:418`), `HealthGoal.targetValueEncrypted` (`schema.prisma:416`, `encryption.ts:446`), `LabConnection.accessTokenEncrypted`/`refreshTokenEncrypted` (`schema.prisma:700-701`, `encryption.ts:483-484`).
- [x] `CostAnalysis.claudeResponseEncrypted` renamed and encrypted on write — `schema.prisma:674`, `encryption.ts:476`; encrypted at `expenseController.ts:737`, decrypted at `:799`, export at `settingsController.ts:613`. No live `claudeResponse` plaintext column reference remains.
- [x] DNA encrypted fields gone from `PHI_FIELDS` and inventory — no `genotypeEncrypted`/`GeneticTrait` entries in `encryption.ts:410-486`.

### 4. Indexes
- [x] Compound indexes for hot patterns exist — `20260103_add_compound_indexes/migration.sql:7-23` creates `audit_logs_user_created_at_idx`, `biomarkers_user_category_date_idx`, `health_goals_user_status_target_idx`, `insurance_plans_user_active_primary_idx`; expense trio `@@index([userId, planId])` at `schema.prisma:631,659,683`.
- [x] Single-column indexes back the remaining hot lookups — `health_needs` indexes `status`/`urgency` separately (`schema.prisma:399-400`); `provider_patients` indexes `providerId`/`patientId`/`status` separately (`:113-115`); `sessions` indexes `userId`/`token`/`expiresAt` (`:71-73`); `lab_connections` indexes `userId` (`:714`).
- [x] FKs are indexed — each `*_id` FK has a backing `@@index` (e.g. `biomarkers.userFileId` `schema.prisma:170`, `insurance_benefits.planId` `:379`).

### 5. Migration Safety
- [x] Destructive drop documents an empty-table verification — `20260423_drop_dna_genetics/migration.sql:7-8` ("User confirmed … tables are empty in every env").
- [x] Index DDL uses `CREATE INDEX IF NOT EXISTS` (not CONCURRENTLY, by design in a Prisma transaction) — `20260103_add_compound_indexes/migration.sql:7,12,17,22`.
- [x] Migrations are idempotent where applicable — `DROP TRIGGER IF EXISTS` (`20260424_…:57`), `CREATE OR REPLACE FUNCTION` (`20260529_…:20`), `DROP … IF EXISTS` (`20260423_…:23-32`).

### 6. Model Completeness
- [x] All 18 models present — 18 `@@map` tables enumerated at `schema.prisma:58,74,91,116,138,176,189,358,381,401,441,455,484,498,633,661,685,715`, including `LabConnection`.
- [x] DNA models removed — confirmed under check 2.
- [x] 13 enums present — `UserRole`…`AuditAction` at `schema.prisma:501-608`; `ProcessingStatus`/`RiskLevel` absent.
- [x] ON DELETE behavior correct — user-owned rows `onDelete: Cascade` (incl. `LabConnection`, `schema.prisma:711`, and `lab_connections` migration `:13`); `ExpenseActual.projection` is `onDelete: SetNull` (`schema.prisma:657`); `AuditLog.user` is optional → SetNull (schema `:474`, migration `00000000000000_initial_schema/migration.sql:400`), so audit logs survive user deletion for 7-yr retention.
- [x] Unique constraints present — `User.email` (`:12`), `ProviderPatient(providerId,patientId)` (`:112`), `LabConnection(userId,provider)` (`:713`), `UserEncryptionKey(userId,keyType,version)` (`:89`), `SystemConfig.key` (`:489`).

### Questions to Ask
- Q1 (new table without RLS?) — No. The 9 migrations after `lab_connections` that I scanned (`20260417`…`20260601`) contain no `CREATE TABLE`; all are `ALTER TABLE`. Every table has RLS.
- Q2 (PHI missing encryption / schema-vs-PHI_FIELDS drift?) — One: F-1 (`target_value` plaintext duplicate). `*Encrypted` set is otherwise in lockstep.
- Q3 (N+1 needing indexes?) — Hot per-user query patterns are covered by the compound/single indexes above; no missing FK index found.
- Q4 (account-deletion cascade reaches every dependent incl. LabConnection?) — Yes. `deleteAllData` explicitly `deleteMany`s `labConnection` (`settingsController.ts:844`) and `deleteAccount` does a hard `tx.user.delete()` (`:966`) that cascades; `lab_connections` FK is `ON DELETE CASCADE`.
- Q5 (any code references removed DNA models / `can_view_dna` / `ProcessingStatus` / `RiskLevel`?) — No live references in `src/`; only immutable migration history and a descriptive test comment.

## Unverifiable
- Actual index-locking risk on large tables (checklist 5, "flag only locking risk on large tables") — cannot be assessed from source; row counts and live `EXPLAIN`/lock behavior require a populated database, which is not present in the repo. The DDL pattern (`CREATE INDEX IF NOT EXISTS`, non-concurrent) is as documented.
- Runtime enforcement that the connecting DB role is NOBYPASSRLS — `assertNoBypassRLS()` (`database.ts:218-261`) is present and hard-exits in production, but whether the deployed role actually lacks BYPASSRLS cannot be confirmed without DB access.

## Out of scope
- Encryption algorithm/key-derivation correctness (AES-256-GCM, PBKDF2 salts) — owned by `02-encryption`; this review only checked that `*Encrypted` columns map to `PHI_FIELDS` and are run through `encrypt()` at the named call sites.
- SMART-on-FHIR OAuth handshake / SSRF guard (`fhir/smartAuth.ts`, `fhir/urlSafety.ts`) — owned by `09-external-apis`; I confirmed only that `LabConnection` tokens are encrypted at rest (`labSyncService.ts:142-143,238-239`).
- Log-redaction completeness for PHI (`utils/phiRedaction.ts`, `logger.ts`) — owned by `31-logging-observability`.
