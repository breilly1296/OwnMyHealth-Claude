---
tags:
  - documentation
  - database
  - schema
  - rls
  - reference
type: prompt
priority: 2
updated: 2026-06-01
---

# Generate DATA_MODEL.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — canonical PHI fields; every encrypted column must match.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/DATA_MODEL.md` — the **complete, deep reference for the database**: every model, every field, every index, every FK, every RLS policy, every cascade rule, and the `withRLSContext` / `withRLSTransaction` usage matrix. The goal is that a Claude Project attached only to `New Project Documents/` can answer *"what does the DB look like and how is it access-controlled?"* without reading the schema file.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/prisma/schema.prisma` | **Source of truth** — every model, field, `@@map`, `@map`, `@index`, `@unique`, relations, cascades. |
| `backend/prisma/migrations/` (entire directory, in chronological order) | Migration history; SQL bodies of RLS policies, triggers, non-Prisma constraints. |
| `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` | Base RLS policy text + `current_user_id()`/`is_admin_session()`/`has_provider_access()` helpers — copy into the RLS section. |
| `backend/prisma/migrations/20260529_fix_has_provider_access/migration.sql` and `20260530_add_users_select_provider/migration.sql` | Later RLS corrections — `has_provider_access()` fix + provider-side users SELECT policy; reflect the FINAL policy bodies. |
| `backend/src/services/database.ts` | `withRLSContext`, `withRLSTransaction`, pool config, SSL handling, RLS context setter. |
| `backend/src/services/encryption.ts` | `PHI_FIELDS` mapping — cross-reference encrypted columns against the schema. |
| `backend/src/services/userEncryption.ts` | Per-user key derivation — where the wrap key is stored, what model holds it. |
| `backend/src/services/auditLog.ts` | Retention policy, cleanup scheduler, audit log schema cross-ref. |
| `backend/src/controllers/*.ts`, `backend/src/services/*.ts` | Grep every `withRLSContext(` and `withRLSTransaction(` call site for the usage matrix. |
| `backend/scripts/check-rls-wrappers.sh` (if present) | Existing wrapper validator — honor its invariants. |

---

## Required sections

1. **Overview** — model count (18), migration count (22), RLS-enabled model count, encrypted-field count. One paragraph.
2. **ER diagram (Mermaid)** — see Required artifacts.
3. **Naming conventions** — `@@map("snake_case")` + `@map("snake_case")` pattern, `*Encrypted` suffix convention, `id` PK convention (all models use `@default(dbgenerated("gen_random_uuid()")) @db.Uuid` — NOT cuid; aligned by `20260424_align_uuid_defaults_and_rename_claude_response`).
4. **Model catalog** — one H3 per model (18 models), alphabetical. Each H3 contains: purpose (1 sentence), field table, index table (if any), relation list, RLS note. Active models: `User`, `Session`, `UserEncryptionKey`, `ProviderPatient`, `UserFile`, `Biomarker`, `BiomarkerHistory`, `InsurancePlan`, `InsuranceBenefit`, `HealthNeed`, `HealthGoal`, `GoalProgressHistory`, `AuditLog`, `SystemConfig`, `ExpenseProjection`, `ExpenseActual`, `CostAnalysis`, `LabConnection`.
5. **Encryption matrix** — table of every `*Encrypted` column vs `PHI_FIELDS` in `encryption.ts`. Drift rows flagged.
6. **RLS policy catalog** — per table: SELECT/INSERT/UPDATE/DELETE policy bodies (from migration SQL). Include the `is_admin_session()` helper definition.
7. **`withRLSContext` vs `withRLSTransaction` usage matrix** — every call site: `file:line` → which wrapper → `userId | null` → reason ("multi-statement atomicity", "single read", "admin listing").
8. **Index catalog** — every `@@index` / `@@unique` across the schema, in a single table. Useful for query-plan reasoning.
9. **Cascade / deletion behavior** — per relation: `onDelete` (Cascade | SetNull | Restrict | NoAction) and what it means for user-data deletion.
10. **Migration timeline** — one row per migration dir: timestamp, name, one-line effect, links any drop/rename to affected docs.
11. **Enum catalog** — every Prisma `enum` (13: `UserRole`, `ProviderRelationType`, `ProviderPatientStatus`, `DataSourceType`, `PlanType`, `HealthNeedType`, `Urgency`, `HealthNeedStatus`, `GoalDirection`, `GoalStatus`, `ReminderFrequency`, `ActorType`, `AuditAction`), its values, and which model/field uses it. Confirm values against `schema.prisma` — do not paraphrase.
12. **Removed models** — explicit callout that `DNAData`, `DNAVariant`, `GeneticTrait` (plus the `ProcessingStatus`/`RiskLevel` enums and `provider_patients.can_view_dna` column) were **dropped** in migration `20260423_drop_dna_genetics` — they are NO longer in `schema.prisma`. `CLAUDE.md` still calls them deprecated/in-schema; flag that as stale.
13. **Related Documents** — cross-links.
14. **Prompt drift log** — if this prompt's file list, model count, migration count, or enum list is stale.

---

## Required artifacts

### ER diagram (Mermaid)

Emit a ```mermaid fence with an ER diagram of active (non-deprecated) models. Show PK and a representative FK per relation. Example shape:

```mermaid
erDiagram
  User ||--o{ Biomarker : owns
  User ||--o{ BiomarkerHistory : owns
  User ||--|| UserEncryptionKey : "wraps PHI key"
  User ||--o{ AuditLog : emits
  User ||--o{ Session : has
  User ||--o{ ProviderPatient : "patient-side"
  User ||--o{ ProviderPatient : "provider-side"
  InsurancePlan ||--o{ InsuranceBenefit : lists
  User ||--o{ InsurancePlan : owns
  User ||--o{ LabConnection : "FHIR lab link"
  User ||--o{ ExpenseProjection : projects
  User ||--o{ ExpenseActual : records
  User ||--o{ CostAnalysis : analyzes
  ...
```

There are no deprecated models to diagram — the DNA/genetics models were dropped (migration `20260423_drop_dna_genetics`). Note that `SystemConfig` is the one model with no FK to `User` (global key/value config).

### Per-model field table (template)

```markdown
### Biomarker

**Table**: `biomarkers` (`@@map`)   **Source**: `backend/prisma/schema.prisma:Lxx-Lyy`

Purpose: one measured biomarker reading tied to a user.

| Field | Column | Type | Encrypted? | Nullable? | Index | FK | Notes |
|---|---|---|---|---|---|---|---|
| `id` | `id` | `String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` | — | no | PK | — | uuid |
| `userId` | `user_id` | `String @db.Uuid` | — | no | yes | `User.id` (onDelete Cascade) | RLS anchor |
| `valueEncrypted` | `value_encrypted` | `String` | **yes** | no | — | — | AES-256-GCM per `PHI_FIELDS` |
| ... | ... | ... | ... | ... | ... | ... | ... |

**Indexes**: `(user_id, measured_at DESC)` — `backend/prisma/migrations/.../migration.sql:Lxx`.

**Relations**:
- Belongs to `User` via `userId` — `onDelete: Cascade`.
- Has many `BiomarkerHistory` via `biomarkerId` — `onDelete: Cascade`.

**RLS**: yes — see RLS catalog.

**Deprecated?**: no.
```

### RLS usage matrix

| Caller (`file:line`) | Wrapper | `userId` | Purpose |
|---|---|---|---|
| `backend/src/controllers/biomarkerController.ts:28` | `withRLSContext` | `req.user.id` | List own biomarkers |
| `backend/src/controllers/biomarkerController.ts:74` | `withRLSTransaction` | `req.user.id` | Create + audit atomically |
| `backend/src/routes/adminRoutes.ts:61` | `withRLSContext(null, fn, { isAdmin: true })` | `null` | Admin user listing — the `{ isAdmin: true }` flag makes RLS see `is_admin_session() = true` |
| `backend/src/controllers/settingsController.ts:Lxx` | `withRLSContext(null, ...)` | `null` | System/no-user context |
| ... | ... | ... | ... |

Use `Grep` `pattern: "withRLS(Context|Transaction)\\("` over `backend/src/**`.

### RLS policy catalog

For each table with RLS, quote the SQL policy bodies:

```sql
-- Source: backend/prisma/migrations/20260107_add_rls_policies/migration.sql:Lxx-Lyy
ALTER TABLE biomarkers ENABLE ROW LEVEL SECURITY;

CREATE POLICY biomarkers_select ON biomarkers
  FOR SELECT
  USING (
    user_id = current_setting('app.current_user_id', true)::text
    OR is_admin_session()
  );
-- plus INSERT / UPDATE / DELETE
```

Include the three helper-function definitions once, at the top of this section: `current_user_id()`, `is_admin_session()`, and `has_provider_access(patient_user_id uuid, permission_type text)` — all defined in `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` (with `has_provider_access()` later corrected by `20260529_fix_has_provider_access` and the users SELECT policy added by `20260530_add_users_select_provider`). Quote their final bodies.

### Encryption matrix

| Model.Field | In `PHI_FIELDS`? | In schema as `*Encrypted`? | Reader (decrypt site) | Writer (encrypt site) |
|---|---|---|---|---|
| `Biomarker.valueEncrypted` | yes | yes | `biomarkerController.ts:Lxx` | `biomarkerController.ts:Lyy` |
| `Biomarker.notesEncrypted` | yes | yes | ... | ... |
| `LabConnection.accessTokenEncrypted` | yes | yes | ... | ... |
| ... | ... | ... | ... | ... |

Rows where either column disagrees = drift; flag in Prompt drift log.

### Index catalog

| Model | Index | Columns | Type | Rationale |
|---|---|---|---|---|
| Biomarker | `Biomarker_user_measured_idx` | `(user_id, measured_at DESC)` | btree | Dashboard list query |
| ... | ... | ... | ... | ... |

### Cascade / deletion behavior

| Relation | Parent | Child | onDelete | User-deletion impact |
|---|---|---|---|---|
| `Biomarker.userId → User.id` | `User` | `Biomarker` | `Cascade` | All biomarkers purged when user is deleted |
| ... | ... | ... | ... | ... |

### Migration timeline

| Date | Migration | Effect |
|---|---|---|
| 2026-01-07 | `add_rls_policies` | Enabled RLS on all user-scoped tables + `current_user_id()` / `is_admin_session()` / `has_provider_access()` helpers |
| 2026-02-06 | `fix_expense_encryption_types` | Changed expense monetary fields from `Decimal` to `String` (encrypted) |
| 2026-04-18 | `add_lab_connections` | Added `lab_connections` table (FHIR/SMART OAuth token storage) |
| 2026-04-20 | `encrypt_health_goal_target` | Added `target_value_encrypted` to `health_goals` |
| 2026-04-23 | `drop_dna_genetics` | Dropped `dna_data`/`dna_variants`/`genetic_traits` tables, `can_view_dna` column, `ProcessingStatus`/`RiskLevel` enums |
| 2026-04-24 | `align_uuid_defaults_and_rename_claude_response` | Renamed `claude_response` → `claude_response_encrypted` on `cost_analyses` |
| 2026-04-24 | `prevent_self_role_elevation` | Trigger/policy preventing users elevating own `role` |
| 2026-05-29 | `fix_has_provider_access` | Fixed the `has_provider_access()` RLS helper |
| 2026-05-30 | `add_users_select_provider` | Added users SELECT policy for provider-side access |
| 2026-06-01 | `add_email_change` | Added `pending_email`/`email_change_token`/`email_change_expires` on `users` |
| ... | ... | ... |

Total: 22 migration directories (excluding `migration_lock.toml`).

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. How many models are in the schema (18), and which models/enums were removed by `20260423_drop_dna_genetics`?
2. Which field on `Biomarker` stores the encrypted value, and what service decrypts it?
3. What is the `onDelete` behavior for `ProviderPatient → User` and what does that mean for GDPR-style deletion?
4. Which tables have RLS enabled, and which function lets admin code bypass the policy?
5. What's the difference between `withRLSContext` and `withRLSTransaction`, and when must you use the latter?
6. Name one RLS policy SQL body verbatim.
7. Which index supports the biomarker dashboard list query?
8. Which models hold the per-user encryption wrap key, and where is it derived?
9. How many Prisma migrations exist in the repo (22), and what was the most recent change (`20260601_add_email_change`)?
10. Which callers pass `null` as `userId` to `withRLSContext` and why?
11. Which models were dropped (DNA/genetics) and in which migration is that recorded?
12. Is `Biomarker.notesEncrypted` in `PHI_FIELDS`? (consistency check)
13. What cascade behavior applies when deleting a `User` — full list of child records removed?
14. Where is `AuditLog` retention enforced (table, scheduler file:line)?
15. What SQL-level constraint prevents a non-admin session from reading someone else's data, even if the app layer is compromised?
16. Which two columns on `LabConnection` are encrypted, and why are SMART-on-FHIR OAuth tokens treated as PHI-adjacent?
17. Which model has no FK to `User`, and what is its purpose (`SystemConfig` — global key/value config)?
18. How does `InsuranceBenefit` relate to `InsurancePlan`, and what is its `onDelete` behavior?
19. Which two helper functions besides `is_admin_session()` underpin RLS, and what does `has_provider_access()` gate?

---

## No-TBD enforcement

Before marking anything TBD:

- **For field/column types**: read `schema.prisma` literally. Every column's type is there.
- **For RLS policy bodies**: open the latest `add_rls_policies` migration's `migration.sql`; do not paraphrase.
- **For wrapper usage**: `Grep pattern: "withRLS(Context|Transaction)\\("` over `backend/src/**`. If zero hits, the wrapper is unused (unlikely — flag).
- **For encryption drift**: read `encryption.ts` `PHI_FIELDS`; diff against `Grep pattern: "Encrypted" path: backend/prisma/schema.prisma`.
- **For migration effects**: read each migration's `migration.sql` top comment or SQL body.

If a claim cannot be derived from these files, mark:

```
TBD (external: <what>, <where to resolve — e.g., ask owner about planned DNA model removal>)
```

---

## Cross-links

The generated `DATA_MODEL.md` must link to:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — where the database sits in the system.
- [`API_REFERENCE.md`](./API_REFERENCE.md) — which endpoints touch which models.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — richer field-level PHI reference.
- [`ENV_VARS.md`](./ENV_VARS.md) — `DATABASE_URL`, SSL config, `PHI_ENCRYPTION_KEY`.
- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — per-route RLS wrap usage.
- [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) — technical safeguards pointing here.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| List migration dirs | Glob | `pattern: "backend/prisma/migrations/*/migration.sql"` |
| Read schema | Read | `backend/prisma/schema.prisma` |
| Find RLS callers | Grep | `pattern: "withRLS(Context|Transaction)\\("` over `backend/src/**` |
| Find `*Encrypted` columns | Grep | `pattern: "Encrypted[\\s]+String"` over `backend/prisma/schema.prisma` |
| Find `PHI_FIELDS` | Grep | `pattern: "PHI_FIELDS"` over `backend/src/services/encryption.ts` |
| Find policy bodies | Read | latest `add_rls_policies/migration.sql` |
| Find cascades | Grep | `pattern: "onDelete:"` over `backend/prisma/schema.prisma` |

---

## Output: file and location

Write the final document to `New Project Documents/DATA_MODEL.md`.
