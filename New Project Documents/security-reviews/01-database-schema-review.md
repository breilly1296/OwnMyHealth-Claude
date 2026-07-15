# Database Schema Review — 2026-06-16

Scope: `backend/prisma/schema.prisma`, `backend/prisma/migrations/` (32 dirs), `backend/src/services/database.ts`, `backend/src/services/encryption.ts` (`PHI_FIELDS`), plus the wired call sites that consume the schema (auth, audit, health-goal, expense controllers/services). Static review against HEAD `fb2cd32`. No code was modified.

Method: every checklist item in `prompts/01-database-schema.md` was executed by reading the actual files. Each tick below cites a `file:line`. Items that could not be confirmed by reading code (e.g. live `pg_class` state, whether the backfill jobs ran in prod) are in *Unverifiable*.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |

The schema/RLS/encryption layer is in strong shape. PHI_FIELDS and the schema are in perfect 14-model / 39-field lockstep; all 19 RLS tables have policies; FORCE RLS is applied to all 19 and boot-asserted; the historically dangerous gaps (stale `view_dna` branch, self-role-elevation, consent self-escalation, forgeable audit rows, plaintext audit metadata, plaintext goal/filename PHI) are all closed and verified. The three Low findings are hardening/hygiene, not exploitable paths.

## Findings

### F-1 — `users_select_provider` exposes secret columns to a consented provider session (row-level, not column-level) — **Low**
- **Location:** `backend/prisma/migrations/20260530_add_users_select_provider/migration.sql:54-56`
- **Observation:** The additive policy `users_select_provider ON users FOR SELECT USING (has_active_consent(id))` authorizes a provider's RLS session to read the **entire** consented patient `users` row. Postgres RLS is row-level, so this includes the plaintext security-sensitive columns `password_hash`, `email_verification_token`, `password_reset_token`, `email_change_token` (schema.prisma:13, 20, 22, 25). The encrypted PHI columns stay protected (the provider lacks the patient's per-user key), but the secret-token columns do not. The only thing standing between a provider session and those secrets is that every provider route handler must use an explicit non-secret column allowlist (`select { id, email, ... }`).
- **Impact:** A future provider-context query that does a bare `findUnique`/`findFirst` (no `select`) on the patient `users` row would return `password_hash` and the live reset/verification tokens to the provider. A provider who can read another user's `password_reset_token` could complete a password reset and take over that account. This is a latent foot-gun, not a current exploit (the migration documents the constraint and current handlers comply), so it is rated Low — but the blast radius if a handler regresses is account takeover.
- **Fix:** Track the documented follow-up to enforce column scope at the engine level: split the secret tokens into a separate sibling table (RLS-scoped to self/admin only) so provider identity reads physically cannot reach them, OR expose patient identity to providers through a restricted view that selects only `{id, email, firstName/lastName via the patient's own context}`. Until then, add a CI guard (extend `scripts/check-rls-wrappers.sh` or a lint rule) that fails any `tx.user.find*` call lacking an explicit `select`. The migration already names this as a tracked hardening item (lines 24-29).
- **Evidence:**
  ```sql
  -- COLUMN-SCOPE CAVEAT: Postgres RLS is row-level, not column-level. This
  -- policy authorizes the provider's session to read the ENTIRE consented
  -- patient users row — which includes plaintext security-sensitive columns
  -- (password_hash, email_verification_token, password_reset_token).
  CREATE POLICY users_select_provider ON users
    FOR SELECT
    USING (has_active_consent(id));
  ```

### F-2 — `revoked_access_tokens` INSERT permits an unauthenticated (`current_user_id() IS NULL`) row for an arbitrary `user_id` — **Low**
- **Location:** `backend/prisma/migrations/20260613_revoked_access_tokens/migration.sql:33-35`
- **Observation:** The insert policy is `WITH CHECK (user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL)`. The `current_user_id() IS NULL` branch allows a query run with no RLS user context to insert a revocation row attributed to *any* `user_id` with any `jti`. The migration comment justifies this for "the optionalAuth logout route (which can run with an expired access token)."
- **Impact:** At HEAD this branch is **not reachable with attacker-controlled input through any wired code path** — verified below — so there is no current exploit. It is flagged Low purely as defense-in-depth: if a future unauthenticated route ever inserts into this table without re-binding the RLS context to a verified user, an attacker could forge a denial-of-service by pre-revoking another user's not-yet-issued `jti`s, or pollute the revocation set. The current sole inserter (`revokeAccessTokenCrossInstance`, `backend/src/services/authService.ts:377-383`) runs under `withRLSContext(verifiedUserId, ...)` — a non-null context — so it uses the `user_id = current_user_id()` branch, never the NULL branch. And `verifiedUserId` is always derived from a signature-verified identity (`authReq.user?.id ?? sessionUser?.id`, `authController.ts:479`, where `sessionUser` comes from `verifyRefreshToken`, `authController.ts:455-457`), with an additional `decoded.id === verifiedUserId` guard inside the revoke fn (`authService.ts:369`). So the NULL branch is dead with respect to attacker control today.
- **Fix:** Drop the `OR current_user_id() IS NULL` branch from `revoked_access_tokens_insert_own` (it is unused: the only inserter always sets a user context). If a genuinely unauthenticated logout path is ever needed, have it set `app.is_admin = true` for the single scoped insert instead, matching the standalone-audit pattern in `auditLog.ts:333-338`. This removes the latent forge-vector entirely.
- **Evidence:**
  ```sql
  CREATE POLICY revoked_access_tokens_insert_own ON revoked_access_tokens
    FOR INSERT
    WITH CHECK (user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL);
  ```

### F-3 — Prompt drift: CLAUDE.md PHI/encryption section understates and mis-states the encrypted-field set — **Low**
- **Location:** `CLAUDE.md` "PHI Encryption" section (under "Critical Rules") and "Key Files" table.
- **Observation:** The repo's top-level `CLAUDE.md` lists the encrypted fields as "Insurance: member ID, group ID, plan name, provider name, benefits" and "User: name, DOB, phone, address" — but the actual `PHI_FIELDS` (encryption.ts:476-562) encrypts only `memberIdEncrypted`/`groupIdEncrypted` for `InsurancePlan` (NOT plan name, insurer name, or benefits, which are plaintext metadata columns), and `User` also includes `healthProfileEncrypted` (omitted from the doc). The doc also says "Database models (15+)" / "PHI fields are defined ... Must match Prisma schema exactly" but does not reflect the 19-model / 39-field current state, the dropped DNA models, the renamed `claudeResponseEncrypted`, the new goal-value/filename/audit-metadata encrypted columns, or `LabConnection` OAuth tokens. The authoritative inventory (`prompts/_phi-inventory.md`) and `PHI_FIELDS` are correct; only `CLAUDE.md` is stale.
- **Impact:** No runtime impact — the code is correct. The risk is human: a contributor following `CLAUDE.md` could believe `InsurancePlan.planName`/`insurerName` are encrypted (they are not, by design — they are metadata) and reason incorrectly about PHI exposure, or add a new PHI field and forget the now-larger `PHI_FIELDS` set. Accumulates into the quarterly prompt-refresh backlog.
- **Fix:** Update the `CLAUDE.md` PHI Encryption bullet list to point to `backend/src/services/encryption.ts` `PHI_FIELDS` as the single source of truth (mirroring `prompts/_phi-inventory.md`) rather than re-listing fields inline; correct the InsurancePlan entry to "member ID, group ID" and add `healthProfileEncrypted`, the M4 goal values, `originalFilenameEncrypted`, `metadataEncrypted`, and `LabConnection` tokens. Bump "15+ models" to 19.
- **Evidence (live PHI_FIELDS for InsurancePlan, contradicting the doc's "plan name, provider name, benefits"):**
  ```ts
  InsurancePlan: [
    'memberIdEncrypted',
    'groupIdEncrypted',
  ],
  ```

## Checks passed

### Schema Security
- [x] UUID primary keys (not sequential integers) — every model uses `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` (e.g. `schema.prisma:11`, `:74`, `:183`); `RevokedAccessToken` uses the token's own `jti` UUID PK (`schema.prisma:97`).
- [x] Foreign keys defined with explicit ON DELETE behavior — user-owned rows `onDelete: Cascade` (e.g. `Session` `schema.prisma:81`, `LabConnection` `:774`, `RevokedAccessToken` `:101`); `ExpenseActual.projection` is `onDelete: SetNull` (`schema.prisma:720`, migration `20260111_add_expense_tracking/migration.sql:23`); `Biomarker.userFile` defaults to SET NULL on optional FK (`schema.prisma:204`, migration `20260108000000_add_user_files_table/migration.sql:34`); `AuditLog.user` is intentionally non-cascading + nullable so audit rows survive user deletion for 7-yr retention (`schema.prisma:517,537`).
- [x] No sensitive data stored in plaintext — 39 `*Encrypted` String columns hold all PHI; verified the deliberate plaintext metadata columns (`Biomarker.category/name/unit`, `InsurancePlan.planName/insurerName/planType`, `UserFile.filename` storage label) are non-PHI per `_phi-inventory.md`.
- [x] Indexes for common query patterns — confirmed every compound index named in the checklist: `biomarkers_user_category_date_idx` (`schema.prisma:212`), `biomarkers(user_id,is_out_of_range)` (`:215`), `(user_id,created_at)` (`:214`), `(user_id,source_type)` (`:216`); `audit_logs_user_created_at_idx` (`:545`); `insurance_plans_user_active_primary_idx` (`:397`); `health_goals_user_status_target_idx` (`:491`); `expense_projections(user_id,plan_id)` (`:694`), `expense_actuals(user_id,plan_id)` (`:722`), `cost_analyses(user_id,plan_id)` (`:746`). Single-column hot lookups present: `health_needs` `status`/`urgency` (`:440-441`), `provider_patients` `provider_id`/`patient_id`/`status` (`:144-146`), `sessions` `expires_at`/`token`/`user_id` (`:83-85`), `lab_connections` `user_id` (`:777`).
- [x] No missing indexes on foreign keys — every FK column is indexed (each user-owned table has `@@index([userId])`; child tables index their parent FK, e.g. `biomarker_history` `@@index([biomarkerId])` `:228`, `goal_progress_history` `@@index([goalId])` `:510`, `insurance_benefits` `@@index([planId])` `:420`, `biomarkers` `@@index([userFileId])` `:211`).

### Row-Level Security
- [x] RLS policies for ALL 19 user-owned tables — original 16 in `20260107_add_rls_policies/migration.sql:68-551`; `user_files` in `20260108000000_add_user_files_table/migration.sql:37-66`; `expense_projections`/`expense_actuals`/`cost_analyses` in `20260111_add_expense_tracking/migration.sql:61-111`; `lab_connections` in `20260418_add_lab_connections/migration.sql:35-60`; `revoked_access_tokens` in `20260613_revoked_access_tokens/migration.sql:26-39`. (The 16 in 20260107 include the 3 DNA tables later dropped, leaving 13; +6 = 19 live tables.)
- [x] FORCE ROW LEVEL SECURITY on every RLS table — `20260613_force_rls_and_audit_retention/migration.sql:14-31` FORCEs all 18 then-existing tables; `20260613_revoked_access_tokens/migration.sql:27` FORCEs the 19th. No RLS-enabled table is left un-FORCEd.
- [x] Boot enforcement wired and not short-circuited — `assertRLSForced()` is called at `database.ts:193` immediately after `assertNoBypassRLS()` (`:192`), inside `initializeDatabase()`; the definition (`database.ts:270-312`) queries `pg_class` for `relrowsecurity=true AND relforcerowsecurity=false` and `process.exit(1)` in production (`:299-306`), warns in non-prod. A `pg_class` read error logs and returns (does not silently pass as "ok") — `:286-292`.
- [x] DNA/genetics tables are GONE and no stale references — `20260423_drop_dna_genetics/migration.sql:23-25` drops the 3 tables CASCADE, `:28` drops `can_view_dna`, `:31-32` drops `ProcessingStatus`/`RiskLevel`. Grep across `backend/src` found zero production references to DNA models/columns/enums (only one historical comment in `rls.test.ts:292`).
- [x] Policies key off the documented helpers — `current_user_id()` (`20260107_add_rls_policies/migration.sql:17-25`), `is_admin_session()` (`:28-36`), `has_provider_access()` (`:39-62`); all `GRANT EXECUTE ... TO PUBLIC` (`:558-560`).
- [x] `has_provider_access()` no longer references `can_view_dna` — recreated in `20260529_fix_has_provider_access/migration.sql:20-42` without the `view_dna` branch; the `CASE` now has only `view_biomarkers`/`view_insurance`/`view_health_needs`/`edit` (`:32-36`).
- [x] `provider_patients` has RLS for both `provider_id` and `patient_id` — `provider_patients_select`/`_update`/`_delete` all check `provider_id = current_user_id() OR patient_id = current_user_id() OR is_admin_session()` (`20260107_add_rls_policies/migration.sql:473-505`, with `_update` rebuilt at `20260615_provider_consent_immutable_audit_insert_check/migration.sql:42-54`).
- [x] Consent-column immutability (L23) enforced — BEFORE UPDATE trigger `provider_patients_guard_consent()` restores the 4 consent columns to OLD unless writer is patient or admin (`20260615_provider_consent_immutable_audit_insert_check/migration.sql:19-36`); a provider session updating its own row has the consent booleans reverted, so it cannot self-escalate.
- [x] `audit_logs_insert` no longer `WITH CHECK (true)` (L40) — rewritten to `WITH CHECK (user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL)` (`20260615_provider_consent_immutable_audit_insert_check/migration.sql:69-76`), superseding the original `WITH CHECK (true)` (`20260107_add_rls_policies/migration.sql:522`). Code matches: standalone audits run admin-context (`auditLog.ts:333-338`), tx-threaded audits attribute `userId` to the session user (`auditLog.ts:303-328`).
- [x] `audit_logs` DELETE is DB-enforced 7-yr retention — `USING (is_admin_session() AND created_at < (now() - interval '7 years'))` (`20260613_force_rls_and_audit_retention/migration.sql:41-44`); even an admin context cannot purge rows newer than 7 years. (7-yr window confirmed as the HIPAA-aligned retention.)
- [x] Self-elevation blocked by trigger — `users_prevent_self_privilege_change` BEFORE UPDATE OF role,is_active raises `42501` unless `is_admin_session()` (`20260424_prevent_self_role_elevation/migration.sql:30-62`).
- [x] Admin bypass uses `app.is_admin = true` correctly — `applyRLSContext` writes both `app.current_user_id` and `app.is_admin` via parameterized `set_config(..., is_local=true)` every call (`database.ts:419-428`), preventing pooled-connection variable bleed; policies read `is_admin_session()` / `current_setting('app.is_admin', true)`.

### PHI Fields Identification
- [x] Every `*Encrypted` schema column is in `PHI_FIELDS` and vice-versa — schema has exactly **39** `*Encrypted String` column declarations (`schema.prisma`, grep count) matching the **39** fields across **14** models in `PHI_FIELDS` (`encryption.ts:476-562`). Perfect lockstep, no orphans either direction.
- [x] No plaintext PHI column where an encrypted twin should exist — the deliberate plaintext twins (`HealthGoal.targetValue/currentValue/startValue` `schema.prisma:455,462,468`, `GoalProgressHistory.value` `:503`, `UserFile.originalFilename` `:163`) are nullable, read-only-for-legacy, and correctly excluded from `PHI_FIELDS`.
- [x] New encrypted fields present in BOTH schema and `PHI_FIELDS` — `User.healthProfileEncrypted` (`schema.prisma:38`, `encryption.ts:484`); `HealthGoal.targetValueEncrypted/currentValueEncrypted/startValueEncrypted` (`schema.prisma:461,467,470`, `encryption.ts:518-520`); `GoalProgressHistory.valueEncrypted` (`schema.prisma:504`, `encryption.ts:524`); `UserFile.originalFilenameEncrypted` (`schema.prisma:164`, `encryption.ts:499`); `AuditLog.metadataEncrypted` (`schema.prisma:533`, `encryption.ts:530`); `LabConnection.accessTokenEncrypted/refreshTokenEncrypted` (`schema.prisma:763-764`, `encryption.ts:559-560`).
- [x] Goal numeric PHI follows encrypt-then-null and no write path populates plaintext twins — verified the create path writes `*Encrypted` and sets `currentValue: null`/`startValue: null`/`value: null` (`healthGoalsController.ts:418-422,443-444`) and the progress-update path does the same (`:632-633,645-646`). Reads prefer the encrypted column via `readEncryptedNumber`/`readTargetValue` (`:144-146,182,669`).
- [x] `CostAnalysis.claudeResponseEncrypted` carries the suffix and is encrypted on write — `schema.prisma:737` (`@map("claude_response_encrypted")`); written through `encryption.encrypt(claudeResponse, userSalt)` (`expenseController.ts:801`), decrypted on read (`expenseController.ts:866`) and export (`settingsController.ts:640`). No production reference to the old `claudeResponse` column name (only the deliberate legacy export field name and code comments).
- [x] DNA encrypted fields are GONE from schema and `PHI_FIELDS` — no `DNAVariant.genotypeEncrypted` / `GeneticTrait.*Encrypted` in `schema.prisma` or `encryption.ts:476-562`.
- [x] AuditLog PHI uses the SYSTEM salt (not per-user) — `encryptValue` uses `this.systemSalt` (`auditLog.ts:251`); `decryptMetadata` uses `this.systemSalt` (`auditLog.ts:278`), so audit rows remain readable after a user's per-user key is destroyed on deletion (7-yr retention).
- [x] `LabConnection` OAuth tokens encrypted — both columns are `*Encrypted` (`schema.prisma:763-764`), in `PHI_FIELDS` (`encryption.ts:558-561`), and the migration stores them application-encrypted (`20260418_add_lab_connections/migration.sql:5-9` comment + `access_token_encrypted`/`refresh_token_encrypted` columns).

### Indexes
- [x] Compound + single-column indexes present (see Schema Security above for the full enumeration).
- [x] No FK without an index (see Schema Security above).

### Migration Safety
- [x] Destructive migrations document a data-safety plan — `20260423_drop_dna_genetics/migration.sql:7-8` records user-confirmed empty tables in every env before `DROP ... CASCADE`.
- [x] `20260615_drop_legacy_audit_metadata` (M6) irreversibly drops plaintext `audit_logs.metadata` and no code reads/writes it — `ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "metadata"` (`migration.sql:18`); the audit write `data` object writes only `metadataEncrypted` (`auditLog.ts:301,314`), with no `metadata` field; reads use `decryptMetadata(row.metadataEncrypted)` (`auditLog.ts:275-278`).
- [x] Index DDL uses `CREATE INDEX IF NOT EXISTS` (no `CONCURRENTLY` inside Prisma's transaction) — checklist explicitly accepts this; not flagged.
- [x] Migrations are idempotent where possible — `IF EXISTS`/`IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`/`DROP POLICY IF EXISTS` used throughout (e.g. `20260424_prevent_self_role_elevation/migration.sql:30,57`; `20260615_provider_consent_immutable_audit_insert_check/migration.sql:19,32,42,69`).

### Model Completeness
- [x] All 19 models present — User, Session, RevokedAccessToken, UserEncryptionKey, ProviderPatient, UserFile, Biomarker, BiomarkerHistory, InsurancePlan, InsuranceBenefit, HealthNeed, HealthGoal, GoalProgressHistory, AuditLog, SystemConfig, ExpenseProjection, ExpenseActual, CostAnalysis, LabConnection (`schema.prisma:10-779`). `RevokedAccessToken` matches the spec: `jti` PK, `userId`, `expiresAt`, `createdAt`, `onDelete: Cascade` (`schema.prisma:96-106`).
- [x] DNA models are NO LONGER present — no `DNAData`/`DNAVariant`/`GeneticTrait` in `schema.prisma`; no production code references.
- [x] 13 enums present — `UserRole`, `ProviderRelationType`, `ProviderPatientStatus`, `DataSourceType`, `PlanType`, `HealthNeedType`, `Urgency`, `HealthNeedStatus`, `GoalDirection`, `GoalStatus`, `ReminderFrequency`, `ActorType`, `AuditAction` (`schema.prisma:564-671`); the DNA-only `ProcessingStatus`/`RiskLevel` are gone.
- [x] Proper ON DELETE behavior (see Schema Security above).
- [x] Unique constraints present — `User.email` (`schema.prisma:12`), `ProviderPatient(providerId,patientId)` (`:143`), `LabConnection(userId,provider)` (`:776`), `UserEncryptionKey(userId,keyType,version)` (`:120`), `SystemConfig.key` (`:552`), plus token uniques on User (`:20,22,25`).
- [x] Account-deletion cascade reaches every dependent table incl. `LabConnection` — all user-owned children declare `onDelete: Cascade` to `users(id)` (verified `LabConnection.user` `schema.prisma:774`, `RevokedAccessToken.user` `:101`, etc.), so deleting a `User` cascades to the live OAuth-token rows.

## Unverifiable
- Whether the DB's live `pg_class` actually has `relforcerowsecurity = true` on all 19 tables in the running prod instance — `assertRLSForced()` checks this at boot, but a static review cannot observe the live catalog. (Migrations that set FORCE are present and applied via the `ownmyhealth-migrate` job per the deploy pipeline.)
- Whether the per-user-key backfills for the plaintext twins have completed in prod — `backfill-userfile-filenames` (filenames), and the goal-value/target-value re-encrypt scripts. Project memory notes the L24 filename re-encrypt backfill was NOT yet run in prod at HEAD, so legacy `user_files.original_filename` rows may still be plaintext (new uploads encrypt; reads fall back). Confirming requires running the maintenance job / querying prod, out of scope for static review.
- Whether the connecting prod role is genuinely NOBYPASSRLS — asserted at boot by `assertNoBypassRLS` (`database.ts:217-260`) but depends on live credentials.
- Locking risk of `CREATE INDEX` (non-CONCURRENTLY) on large tables in prod — depends on live table sizes at the time each migration was applied; cannot be assessed statically.

## Out of scope
- The application-layer encryption *algorithm* and key-derivation correctness (AES-256-GCM, PBKDF2-SHA512, per-user vs system salt selection beyond the audit-salt check) — covered by `prompts/02-encryption.md`.
- RLS *wrapper usage* correctness in every controller/service (the `withRLSContext` vs bare `prisma` foot-gun) beyond the schema/policy definitions — covered by the RLS/controller-focused prompts; this review confirmed the policy/migration layer and the specific call sites needed to validate the schema-level checks (audit insert, goal-value writes, revoked-token insert, claudeResponse encrypt).
- The 8 rate limiters / `aiSpendGuard` / CSRF / auth-token lifecycle — covered by middleware/auth prompts.
