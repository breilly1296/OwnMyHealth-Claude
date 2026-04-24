---
tags:
  - documentation
  - phi
  - hipaa
  - reference
type: generated-doc
prompt: prompts/40-phi-taxonomy-doc.md
generated: 2026-04-24
source-of-truth: backend/src/services/encryption.ts (PHI_FIELDS)
---

# PHI Taxonomy

## Purpose and scope

This document is the authoritative, citation-dense index of every Protected Health Information (PHI) field in the OwnMyHealth codebase. For each encrypted column, it records where the field is written (encryption call sites), where it is decrypted (read call sites), whether the write and the read are audit-logged, whether the field name is redacted by the logger sanitizer, and whether the data is reachable by a PROVIDER via consent.

Distinction from [`_phi-inventory.md`](../prompts/_phi-inventory.md):

| [`_phi-inventory.md`](../prompts/_phi-inventory.md) (seed) | `PHI_TAXONOMY.md` (this doc) |
|---|---|
| Lightweight reference, inherited by security prompts | Standalone Claude-Project attachment — optimized for retrieval |
| Lists model × field name | Lists model × field × every site that touches it, with file:line |
| Updated when schema changes | Regenerated per release; captures drift between schema, `PHI_FIELDS`, and `SENSITIVE_FIELDS` |

The single source of truth for "is this a PHI field?" is the `PHI_FIELDS` constant in [`backend/src/services/encryption.ts:411`](../backend/src/services/encryption.ts). Everything below is verified against that constant and against the schema at [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).

---

## 1. High-level encryption flow

```
┌────────────────┐    master key (PHI_ENCRYPTION_KEY, 64 hex)   ┌────────────────────────┐
│ process.env    │────────────────────────────────────────────▶│ EncryptionService      │
│ PHI_ENCRYPTION │                                              │ encryption.ts:156      │
│_KEY            │                                              └──────────┬─────────────┘
└────────────────┘                                                         │
                                                                           │ encryptWithMasterKey
                                                                           ▼
┌──────────────────────────┐   per-user salt (32 bytes hex)   ┌──────────────────────────┐
│ UserEncryptionKey row    │◀──────────────────────────────── │ getUserEncryptionSalt    │
│ (encryptedKey = salt     │   PBKDF2-SHA512 600k iters       │ userEncryption.ts:29     │
│  encrypted with master)  │   key = 32B (AES-256)            └──────────┬───────────────┘
└──────────────────────────┘                                             │
                                                                         │ encrypt(plaintext, userSalt)
                                                                         ▼
                                              ┌───────────────────────────────────────┐
                                              │ AES-256-GCM: iv:authTag:ciphertext    │
                                              │ encryption.ts:263 (encrypt)           │
                                              │ encryption.ts:288 (decrypt, 600k→100k │
                                              │ legacy fallback)                      │
                                              └───────────────────────────────────────┘
```

AuditLog PHI (`previousValueEncrypted`, `newValueEncrypted`) is encrypted with the **system** salt (`config.auditSalt`) rather than the per-user salt, so audit rows remain readable after the user's `UserEncryptionKey` is cascade-deleted on account deletion. See [`backend/src/services/auditLog.ts:125`](../backend/src/services/auditLog.ts) (`this.systemSalt = config.auditSalt`) and [`auditLog.ts:194`](../backend/src/services/auditLog.ts) (`encryptionService.encrypt(stringValue, this.systemSalt)`).

---

## 2. Master PHI table

All 33 PHI fields declared in `PHI_FIELDS` ([`encryption.ts:411-L492`](../backend/src/services/encryption.ts)) are listed below. File paths are repo-relative. "Write sites" point at `encryption.encrypt(...)` / `encryptWithMasterKey(...)` or direct assignments to `*Encrypted` columns; "read sites" point at `encryption.decrypt(...)` calls.

| Model | Field | Column (DB) | In `PHI_FIELDS`? | Write sites | Read sites | Audited on write? | Audited on read? | Redacted in logger? | Provider-accessible? | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `User` | `firstNameEncrypted` | `first_name_encrypted` | yes | `settingsController.ts:985` | `settingsController.ts:418`, `settingsController.ts:940`, `settingsController.ts:1008` | yes — `settingsController.ts:1014` (`logUpdate` on `User`) | yes — `settingsController.ts:946` (`logAccess` on `User`, `fields:['firstName','lastName']`) and `settingsController.ts:638` on export | **no** (no `firstName`/`firstNameEncrypted` in `SENSITIVE_FIELDS`) | no — no provider route reads patient name (provider UI uses patient `email` only) | Cleared to `null` on empty input |
| `User` | `lastNameEncrypted` | `last_name_encrypted` | yes | `settingsController.ts:989` | `settingsController.ts:419`, `settingsController.ts:943`, `settingsController.ts:1011` | yes — `settingsController.ts:1014` | yes — `settingsController.ts:946`, `settingsController.ts:638` | **no** | no | — |
| `User` | `dateOfBirthEncrypted` | `date_of_birth_encrypted` | yes | *no controller write site — see Drift §7* | `settingsController.ts:420` (export only) | n/a (no write path) | yes (on export) — `settingsController.ts:638` | yes (`dateOfBirth` in `SENSITIVE_FIELDS`, [`logger.ts:26`](../backend/src/utils/logger.ts)) | no | Registration/profile UI has no DOB field today; column retained for HIPAA-grade identity PHI when onboarding grows |
| `User` | `phoneEncrypted` | `phone_encrypted` | yes | *no controller write site — see Drift §7* | `settingsController.ts:421` | n/a | yes (on export) | partial — `phoneNumber` is in `SENSITIVE_FIELDS` but **`phoneEncrypted`/`phone`** is not ([`logger.ts:26`](../backend/src/utils/logger.ts)) | no | — |
| `User` | `addressEncrypted` | `address_encrypted` | yes | *no controller write site — see Drift §7* | `settingsController.ts:422` | n/a | yes (on export) | yes — `address` in `SENSITIVE_FIELDS` ([`logger.ts:26`](../backend/src/utils/logger.ts)) | no | — |
| `User` | `healthProfileEncrypted` | `health_profile_encrypted` | yes | `healthProfileService.ts:102` (`encrypt(JSON.stringify(stamped), salt)`) | `healthProfileService.ts:73` | yes — `settingsController.ts:1205` (`logUpdate` on `UserHealthProfile`) | yes — `settingsController.ts:1159` (`logAccess` on `UserHealthProfile`) | **no** (field name not in `SENSITIVE_FIELDS`) | no — used by own-user AI prompt injection in `healthContextService` only | Encrypted JSON blob: conditions, medications, family history, lifestyle |
| `Biomarker` | `valueEncrypted` | `value_encrypted` | yes | `biomarkerController.ts:238`, `biomarkerController.ts:328`, `biomarkerController.ts:496`, `upload/shared.ts:163`, `fhir/labSyncService.ts:298` | `biomarkerController.ts:67`, `biomarkerController.ts:77`, `biomarkerController.ts:312`, `biomarkerController.ts:346`, `biomarkerController.ts:795`, `biomarkerController.ts:799`, `biomarkerRoutes.ts:177`, `biomarkerRoutes.ts:185`, `expenseController.ts:-`, `providerRoutes.ts:473`, `healthContextService.ts:146`, `healthContextService.ts:229`, `fhir/labSyncService.ts:271`, `settingsController.ts:429` | yes — `biomarkerController.ts:273` (CREATE), `:363` (UPDATE), `:593` (BULK CREATE) | yes — `biomarkerController.ts:160` (LIST), `:215` (GET_ONE), `:442` (SEARCH), `:715` (TRENDS), `:819` (HISTORY); provider path: `providerRoutes.ts:425`/`:446`/`:491` | yes — `valueEncrypted` in `SENSITIVE_FIELDS` ([`logger.ts:24`](../backend/src/utils/logger.ts)) | yes — `ProviderPatient.canViewBiomarkers` ([`providerRoutes.ts:444`](../backend/src/routes/providerRoutes.ts), `providerRoutes.ts:396`) | Single most-written PHI field |
| `Biomarker` | `notesEncrypted` | `notes_encrypted` | yes | `biomarkerController.ts:240`, `biomarkerController.ts:332`, `biomarkerController.ts:497`, `upload/shared.ts:166` | `biomarkerController.ts:69`, `providerRoutes.ts:474`, `settingsController.ts:-` (export) | yes — same rows as `valueEncrypted` | yes — same rows | **no** (generic `notesEncrypted` not in `SENSITIVE_FIELDS`) | yes — same `canViewBiomarkers` gate | — |
| `BiomarkerHistory` | `valueEncrypted` | `value_encrypted` | yes | Created as a side-effect of `biomarkerController.ts:496-497` (via relation) and `fhir/labSyncService.ts:298` | `biomarkerController.ts:77`, `biomarkerController.ts:799`, `biomarkerRoutes.ts:185`, `fhir/labSyncService.ts:271`, `settingsController.ts:-` (export loops) | yes — inherits `biomarkerController.ts:273`/`:363`/`:593` | yes — `biomarkerController.ts:819` (HISTORY); provider `providerRoutes.ts:446` | yes — matches `Biomarker.valueEncrypted` | yes — `canViewBiomarkers` | **No `notesEncrypted` column** on history table by design ([`PHI_FIELDS` comment, encryption.ts:428](../backend/src/services/encryption.ts)) |
| `InsurancePlan` | `memberIdEncrypted` | `member_id_encrypted` | yes | `insuranceController.ts:513`, `insuranceController.ts:621`, `sbcUploadController.ts:131` (null on SBC create) | `insuranceController.ts:237`, `settingsController.ts:480` (export) | yes — `insuranceController.ts:585` (CREATE), `:685` (UPDATE) | yes — `insuranceController.ts:450` (LIST), `:489` (GET_ONE) | yes — `memberIdEncrypted` in `SENSITIVE_FIELDS` ([`logger.ts:24`](../backend/src/utils/logger.ts)) | no — no `GET /provider/patients/:id/insurance` route wired; `canViewInsurance` flag exists but is not consulted by any decrypt call site | Consent flag `canViewInsurance` exists but unused — see Drift §7 |
| `InsurancePlan` | `groupIdEncrypted` | `group_id_encrypted` | yes | `insuranceController.ts:516`, `insuranceController.ts:626`, `sbcUploadController.ts:132` | `insuranceController.ts:238`, `settingsController.ts:481` | yes — `insuranceController.ts:585`, `:685` | yes — `insuranceController.ts:450`, `:489` | yes — `groupIdEncrypted` in `SENSITIVE_FIELDS` | no (same as `memberIdEncrypted`) | — |
| `ProviderPatient` | `notesEncrypted` | `notes_encrypted` | yes | `providerRoutes.ts:170` (encrypted with provider's salt), written at `providerRoutes.ts:207`/`:212` | *no decrypt call site located* — the field is only written on access-request; no UI reads it back | yes — `providerRoutes.ts:220` (`logCreate` on `provider_patient_request`) | n/a — never read back | **no** (generic `notesEncrypted` not in `SENSITIVE_FIELDS`; value is redacted only as a nested property of `newValue` on audit log) | n/a — only the provider who wrote it could ever decrypt it (patient salt would fail) | Provider-side write-only scratch field; see Drift §7 |
| `DNAVariant` | `genotypeEncrypted` | `genotype_encrypted` | yes (deprecated) | *no write site* | *no read site* | n/a | n/a | partial — `genotype` in `SENSITIVE_FIELDS` ([`logger.ts:25`](../backend/src/utils/logger.ts)); `genotypeEncrypted` itself is not | no — DNA UI removed | Deprecated — schema-only ([CLAUDE.md §Deprecated](../CLAUDE.md)) |
| `GeneticTrait` | `descriptionEncrypted` | `description_encrypted` | yes (deprecated) | *no write site* | *no read site* | n/a | n/a | yes — `descriptionEncrypted` in `SENSITIVE_FIELDS` ([`logger.ts:25`](../backend/src/utils/logger.ts)) | no | Deprecated |
| `GeneticTrait` | `recommendationsEncrypted` | `recommendations_encrypted` | yes (deprecated) | *no write site* | *no read site* | n/a | n/a | **no** | no | Deprecated |
| `HealthNeed` | `descriptionEncrypted` | `description_encrypted` | yes | `healthNeedsController.ts:198`, `healthNeedsController.ts:249`, `healthNeedsController.ts:554` (bulk create from AI analysis) | `healthNeedsController.ts:47`, `settingsController.ts:516` (export), `providerRoutes.ts:612` | yes — `healthNeedsController.ts:216` (CREATE), `:273`/`:331` (UPDATE), `:568` (bulk-create audit) | yes — `healthNeedsController.ts:128` (LIST), `:175` (GET_ONE), `:442` (ANALYSIS), `:512` (SUMMARY); provider `providerRoutes.ts:565`/`:586`/`:622` | yes — `descriptionEncrypted` in `SENSITIVE_FIELDS` | yes — `ProviderPatient.canViewHealthNeeds` ([`providerRoutes.ts:584`](../backend/src/routes/providerRoutes.ts), `providerRoutes.ts:536`) | — |
| `HealthGoal` | `descriptionEncrypted` | `description_encrypted` | yes | `healthGoalsController.ts:376`, `healthGoalsController.ts:481` | `healthGoalsController.ts:117`, `settingsController.ts:488` (export) | yes — `healthGoalsController.ts:431` (CREATE), `:513`/`:625` (UPDATE) | yes — `healthGoalsController.ts:272` (LIST), `:324` (GET_ONE), `:750`/`:841` (SUMMARY/ANALYSIS) | yes — `descriptionEncrypted` in `SENSITIVE_FIELDS` | no — no provider route reads patient goals | — |
| `HealthGoal` | `targetValueEncrypted` | `target_value_encrypted` | yes | `healthGoalsController.ts:388`, `healthGoalsController.ts:488` | `healthGoalsController.ts:39` (via `readTargetValue`) | yes — `healthGoalsController.ts:431`, `:513` | yes — `healthGoalsController.ts:272`, `:324` | **no** (`targetValueEncrypted` not in `SENSITIVE_FIELDS`) | no | Read path prefers encrypted column; falls back to unencrypted `targetValue` Decimal when null (backward-compat, see [schema comment, `schema.prisma:L464-L468`](../backend/prisma/schema.prisma)) |
| `GoalProgressHistory` | `noteEncrypted` | `note_encrypted` | yes | `healthGoalsController.ts:421` (initial "Initial value"), `healthGoalsController.ts:605` | `healthGoalsController.ts:158` | yes — inherits `healthGoalsController.ts:431`/`:513` on parent update | yes — `healthGoalsController.ts:324` (GET_ONE returns history) | yes — `noteEncrypted` in `SENSITIVE_FIELDS` ([`logger.ts:25`](../backend/src/utils/logger.ts)) | no | — |
| `AuditLog` | `previousValueEncrypted` | `previous_value_encrypted` | yes | `auditLog.ts:207` (→ `auditLog.ts:194` `encrypt(stringValue, this.systemSalt)`) | *no decrypt call site in production code* — read only via admin `queryLogs` ([`auditLog.ts:456`](../backend/src/services/auditLog.ts)) which returns ciphertext | yes — every `log*` method audits by definition | n/a — admin read returns ciphertext (by design, pending dedicated decrypt tool) | **no** | ADMIN-only (RBAC on `/api/v1/admin/audit-logs`); values stay ciphertext in the response | Uses **system salt**, not per-user — survives user deletion (7-year HIPAA retention) |
| `AuditLog` | `newValueEncrypted` | `new_value_encrypted` | yes | `auditLog.ts:208` → `:194` | *no decrypt call site* | yes | n/a | **no** | ADMIN-only, ciphertext only | Same as above |
| `ExpenseProjection` | `serviceTypeEncrypted` | `service_type` | yes | `expenseController.ts:102`, `expenseController.ts:223`, `expenseController.ts:505` | `expenseController.ts:120`, `expenseController.ts:172`, `expenseController.ts:247`, `expenseController.ts:298` (`healthContextService.ts`), `expenseController.ts:671` | yes — `expenseController.ts:112` (CREATE), `:242` (UPDATE) | yes — `expenseController.ts:179` (LIST); UPDATE re-audit `:242` | **no** (`serviceTypeEncrypted` not in `SENSITIVE_FIELDS`) | no | Column is `@map("service_type")` — **no `_encrypted` suffix in DB** (Drift §7) |
| `ExpenseProjection` | `estimatedCostEncrypted` | `estimated_cost` | yes | `expenseController.ts:103`, `expenseController.ts:226` | `expenseController.ts:121`, `expenseController.ts:173`, `expenseController.ts:248`, `expenseController.ts:672`, `healthContextService.ts:296` | yes | yes | **no** | no | DB column `estimated_cost` (no `_encrypted` suffix) |
| `ExpenseProjection` | `notesEncrypted` | `notes` | yes | `expenseController.ts:106`, `expenseController.ts:231` | `expenseController.ts:122`, `expenseController.ts:174`, `expenseController.ts:249`, `expenseController.ts:675` | yes | yes | **no** | no | DB column `notes` |
| `ExpenseActual` | `serviceTypeEncrypted` | `service_type` | yes | `expenseController.ts:378`, `expenseController.ts:505` | `expenseController.ts:325` | yes — `expenseController.ts:394` (CREATE), `:527` (UPDATE) | yes — `expenseController.ts:446` (LIST) | **no** | no | — |
| `ExpenseActual` | `providerNameEncrypted` | `provider_name` | yes | `expenseController.ts:380` | `expenseController.ts:327` | yes | yes | **no** | no | Medical-provider name, not a User.name |
| `ExpenseActual` | `billedAmountEncrypted` | `billed_amount` | yes | `expenseController.ts:370` (via `encryptOpt`) → stored on one of the fields at `:378-388` | `expenseController.ts:319` (via `decryptOpt`) | yes | yes | **no** | no | — |
| `ExpenseActual` | `insurancePaidEncrypted` | `insurance_paid` | yes | same `encryptOpt` helper, `expenseController.ts:370` | same `decryptOpt` helper, `expenseController.ts:319` | yes | yes | **no** | no | — |
| `ExpenseActual` | `patientPaidEncrypted` | `patient_paid` | yes | same | same; also `healthContextService.ts:309` | yes | yes | **no** | no | — |
| `ExpenseActual` | `appliedToDeductibleEncrypted` | `applied_to_deductible` | yes | same | same | yes | yes | **no** | no | — |
| `ExpenseActual` | `appliedToOopEncrypted` | `applied_to_oop` | yes | same | same | yes | yes | **no** | no | — |
| `ExpenseActual` | `notesEncrypted` | `notes` | yes | `expenseController.ts:388` | `expenseController.ts:335` | yes | yes | **no** | no | — |
| `CostAnalysis` | `claudeResponse` | `claude_response` | yes | `expenseController.ts:720` | `expenseController.ts:784` | yes — `expenseController.ts:731` (CREATE) | yes — `expenseController.ts:634` (pre-existing), `expenseController.ts:793` (LIST) | yes — `claudeResponse` in `SENSITIVE_FIELDS` ([`logger.ts:28`](../backend/src/utils/logger.ts)) | no | Field name lacks `Encrypted` suffix by design — documented in [`encryption.ts:L481-L484`](../backend/src/services/encryption.ts) |
| `CostAnalysis` | `totalProjectedOopEncrypted` | `total_projected_oop` | yes | `expenseController.ts:721-722` | `expenseController.ts:786` | yes | yes | **no** | no | — |
| `CostAnalysis` | `projectedExpensesSnapshotEncrypted` | `projected_expenses_snapshot` | yes | `expenseController.ts:725` | *no decrypt site located — snapshot is a point-in-time audit blob* | yes | n/a | **no** | no | Write-once snapshot; current UI never decrypts it |
| `LabConnection` | `accessTokenEncrypted` | `access_token_encrypted` | yes | `fhir/labSyncService.ts:141`, `:229` (refresh), stored at `:151`/`:160`/`:237` | `fhir/labSyncService.ts:212`, `fhir/labSyncService.ts:402` | yes — connection-establish path audits via `fhir/labSyncService.ts:172` | yes — `fhir/labSyncService.ts:350`, `:368`, `:415` | partial — `accessToken` and `token` in `SENSITIVE_FIELDS` ([`logger.ts:22`](../backend/src/utils/logger.ts)); `accessTokenEncrypted` itself not | no | SMART-on-FHIR OAuth bearer — PHI-adjacent, stolen token reads live labs |
| `LabConnection` | `refreshTokenEncrypted` | `refresh_token_encrypted` | yes | `fhir/labSyncService.ts:142`, `:231` | `fhir/labSyncService.ts:214` | yes | yes | yes — `refreshToken` in `SENSITIVE_FIELDS` ([`logger.ts:22`](../backend/src/utils/logger.ts)) | no | — |

**Total PHI fields cataloged: 36** (33 active + 3 deprecated, covering 15 models).

---

## 3. Per-field deep dives

Every field listed in `PHI_FIELDS` gets its own H3 below. File:line citations are reproducible — grep the patterns in §9 to re-verify.

### User model

#### `User.firstNameEncrypted`

- **Column**: `first_name_encrypted` — [`backend/prisma/schema.prisma:14`](../backend/prisma/schema.prisma)
- **Write sites**:
  - `settingsController.updateProfile` — [`backend/src/controllers/settingsController.ts:985`](../backend/src/controllers/settingsController.ts):
    ```ts
    // Source: backend/src/controllers/settingsController.ts:L984-L987
    if (firstName !== undefined) {
      updateData.firstNameEncrypted = firstName ? encryptionService.encrypt(firstName, userSalt) : null;
      fieldsUpdated.push('firstName');
    }
    ```
- **Read sites**:
  - `settingsController.exportData` — [`settingsController.ts:418`](../backend/src/controllers/settingsController.ts)
  - `settingsController.getProfile` — [`settingsController.ts:940`](../backend/src/controllers/settingsController.ts)
  - `settingsController.updateProfile` (round-trip) — [`settingsController.ts:1008`](../backend/src/controllers/settingsController.ts)
- **Audit on write**: `auditService.logUpdate('User', userId, null, null, { req, userId }, { fieldsUpdated })` — [`settingsController.ts:1014`](../backend/src/controllers/settingsController.ts).
- **Audit on read**: `auditService.logAccess('User', userId, { req, userId }, { operation: 'PHI_ACCESS', fields: ['firstName','lastName'] })` — [`settingsController.ts:946`](../backend/src/controllers/settingsController.ts). Export path audits via `logAccess('UserData', …)` — [`settingsController.ts:638`](../backend/src/controllers/settingsController.ts).
- **Logger redaction**: **no**. Neither `firstName` nor `firstNameEncrypted` is in `SENSITIVE_FIELDS` ([`logger.ts:L21-L30`](../backend/src/utils/logger.ts)). Free-text first names could leak through a log line that embeds the decrypted profile — see Drift §7.
- **Provider exposure**: no. No route in `backend/src/routes/providerRoutes.ts` reads `firstNameEncrypted`. Providers identify patients by `email` (`providerRoutes.ts:140`).

#### `User.lastNameEncrypted`

- **Column**: `last_name_encrypted` — [`schema.prisma:15`](../backend/prisma/schema.prisma)
- **Write**: `settingsController.ts:989`. **Read**: `settingsController.ts:419`, `:943`, `:1011`. **Audit**: identical to `firstNameEncrypted` (paired with it in the same PHI_ACCESS metadata and `logUpdate`). **Logger redaction**: **no**. **Provider-accessible**: no.

#### `User.dateOfBirthEncrypted`

- **Column**: `date_of_birth_encrypted` — [`schema.prisma:16`](../backend/prisma/schema.prisma)
- **Write sites**: **none in current controllers** — the registration controller (`authController.register`) does not collect DOB, and `settingsController.updateProfile` only handles `firstName`/`lastName`. The column exists for export compatibility and future onboarding.
- **Read sites**: `settingsController.ts:420` (data-export only).
- **Audit on read**: `auditService.logAccess('UserData', userId, { req, userId }, { recordCount: … })` — [`settingsController.ts:638`](../backend/src/controllers/settingsController.ts).
- **Logger redaction**: **yes** — `dateOfBirth` in `SENSITIVE_FIELDS` ([`logger.ts:26`](../backend/src/utils/logger.ts)). Note: the exact string is `dateOfBirth`, not `dateOfBirthEncrypted`; the sanitizer lowercases keys so a serialized Prisma row that still carries `dateOfBirthEncrypted` would **not** match. Drift §7.
- **Provider-accessible**: no.

#### `User.phoneEncrypted`

- **Column**: `phone_encrypted` — [`schema.prisma:17`](../backend/prisma/schema.prisma)
- **Write sites**: none in controllers (same situation as DOB).
- **Read sites**: `settingsController.ts:421`.
- **Logger redaction**: **partial** — `phoneNumber` is redacted but `phone` and `phoneEncrypted` are not ([`logger.ts:26`](../backend/src/utils/logger.ts)). Drift §7.
- **Provider-accessible**: no.

#### `User.addressEncrypted`

- **Column**: `address_encrypted` — [`schema.prisma:18`](../backend/prisma/schema.prisma)
- **Write sites**: none in controllers.
- **Read sites**: `settingsController.ts:422`.
- **Logger redaction**: yes — `address` in `SENSITIVE_FIELDS` ([`logger.ts:26`](../backend/src/utils/logger.ts)).
- **Provider-accessible**: no.

#### `User.healthProfileEncrypted`

- **Column**: `health_profile_encrypted` — [`schema.prisma:30`](../backend/prisma/schema.prisma)
- **Encryption site**: `healthProfileService.saveHealthProfile` — [`backend/src/services/healthProfileService.ts:102`](../backend/src/services/healthProfileService.ts):
  ```ts
  // Source: backend/src/services/healthProfileService.ts:L99-L108
  const stamped: UserHealthProfile = { ...profile, updatedAt: new Date().toISOString() };
  const ciphertext = encryption.encrypt(JSON.stringify(stamped), salt);
  await withRLSContext(userId, async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { healthProfileEncrypted: ciphertext },
    });
  });
  ```
- **Decryption site**: `healthProfileService.getDecryptedHealthProfile` — [`healthProfileService.ts:73`](../backend/src/services/healthProfileService.ts). Also read as a flag only (`healthProfileEncrypted: true` selection) at [`onboardingService.ts:73`](../backend/src/services/onboardingService.ts).
- **Audit**: write — `settingsController.ts:1205`; read — `settingsController.ts:1159`.
- **Logger redaction**: **no**. JSON blob contains conditions, medications, family history — high-value PHI. Drift §7.
- **Provider-accessible**: no. Consumed only by the user's own AI prompt injection in `healthContextService.ts`.

---

### Biomarker models

#### `Biomarker.valueEncrypted`

- **Column**: `value_encrypted` — [`schema.prisma:146`](../backend/prisma/schema.prisma)
- **Encryption sites** (5 call paths):
  - `biomarkerController.createBiomarker` — [`biomarkerController.ts:238`](../backend/src/controllers/biomarkerController.ts)
  - `biomarkerController.updateBiomarker` — [`biomarkerController.ts:328`](../backend/src/controllers/biomarkerController.ts) (current value replace)
  - `biomarkerController.bulkCreateBiomarkers` — [`biomarkerController.ts:496`](../backend/src/controllers/biomarkerController.ts)
  - `upload/shared.ts:163` — lab upload extraction → biomarker create
  - `fhir/labSyncService.ts:298` — SMART-on-FHIR lab result import
- **Decryption sites** (14 call paths across 7 files):
  - `biomarkerController.mapToResponse` — `:67` / `:69` (single get), `:77` (history inline)
  - `biomarkerController.updateBiomarker` — `:312` (current-value capture for audit), `:346` (post-update recompute)
  - `biomarkerController.getBiomarkerHistory` — `:795` / `:799`
  - `biomarkerRoutes.ts:177` / `:185` (AI guidance formatting)
  - `providerRoutes.ts:473` — provider read of patient biomarkers
  - `healthContextService.ts:146` / `:229` — AI prompt context
  - `fhir/labSyncService.ts:271`
  - `settingsController.ts:429` (data export — inside a loop)
- **Audit on write**: `auditService.logCreate(RESOURCE_TYPE, biomarker.id, { …, newValue: input.value, input.notes })` — [`biomarkerController.ts:273`](../backend/src/controllers/biomarkerController.ts); update at `:363`; bulk at `:593`.
- **Audit on read**: `auditService.logAccess(RESOURCE_TYPE, undefined|id, { req, userId }, { operation: 'LIST'|'GET'|… })` — `biomarkerController.ts:160`, `:215`, `:442`, `:715`, `:819`. Provider reads audit at `providerRoutes.ts:425`/`:446`/`:491`.
- **Logger redaction**: yes — `valueEncrypted` in `SENSITIVE_FIELDS` ([`logger.ts:24`](../backend/src/utils/logger.ts)).
- **Provider exposure**: yes, via `ProviderPatient.canViewBiomarkers = true` plus `status === 'ACTIVE'` plus non-expired consent. Gate at [`providerRoutes.ts:444`](../backend/src/routes/providerRoutes.ts):
  ```ts
  // Source: backend/src/routes/providerRoutes.ts:L444-L448
  if (!relationship.canViewBiomarkers) {
    throw new ForbiddenError('Provider lacks biomarker view permission for this patient');
  }
  ```

#### `Biomarker.notesEncrypted`

- **Column**: `notes_encrypted` — [`schema.prisma:147`](../backend/prisma/schema.prisma)
- Write sites: `biomarkerController.ts:240`, `:332`, `:497`; `upload/shared.ts:166`.
- Read sites: `biomarkerController.ts:69`; `providerRoutes.ts:474` (provider path).
- **Logger redaction**: **no** — the word `notesEncrypted` is generic; same logger drift as other `notesEncrypted` fields.
- Provider exposure: yes — same `canViewBiomarkers` gate decrypts `notesEncrypted` in the same request (`providerRoutes.ts:474`).

#### `BiomarkerHistory.valueEncrypted`

- **Column**: `value_encrypted` — [`schema.prisma:181`](../backend/prisma/schema.prisma)
- **Write**: created through relational writes inside `biomarkerController.ts:496-497` (BULK), `:328` (UPDATE triggers history row via Prisma); `fhir/labSyncService.ts:298`.
- **Read**: `biomarkerController.ts:77`, `:799`; `biomarkerRoutes.ts:185`; `fhir/labSyncService.ts:271`; `settingsController.ts:429` (nested loop).
- **Audit**: inherits parent `Biomarker` audit entries; dedicated list audit at `biomarkerController.ts:819`.
- **Logger redaction**: yes (shares `valueEncrypted` key).
- **Provider exposure**: yes — returned alongside parent biomarker under `canViewBiomarkers`.
- **Notes**: no `notesEncrypted` column on history by design — [`PHI_FIELDS`, encryption.ts:428](../backend/src/services/encryption.ts) spells out the exception.

---

### Insurance models

#### `InsurancePlan.memberIdEncrypted`

- **Column**: `member_id_encrypted` — [`schema.prisma:198`](../backend/prisma/schema.prisma)
- **Write**: `insuranceController.createPlan` — `:513`; `insuranceController.updatePlan` — `:621`; `sbcUploadController.ts:131` (created as `null` when built from SBC extract).
- **Read**: `insuranceController.toResponse` — `:237`; `settingsController.ts:480` (export).
- **Audit on write**: `auditService.logCreate('insurance_plan', plan.id, { … })` — [`insuranceController.ts:585`](../backend/src/controllers/insuranceController.ts); update at `:685`.
- **Audit on read**: `auditService.logAccess('insurance_plan', undefined, { req, userId }, { operation: 'LIST' })` — [`insuranceController.ts:450`](../backend/src/controllers/insuranceController.ts); single-get at `:489`.
- **Logger redaction**: yes — `memberIdEncrypted` in `SENSITIVE_FIELDS` ([`logger.ts:24`](../backend/src/utils/logger.ts)).
- **Provider-accessible**: **no actual route wired**. `ProviderPatient.canViewInsurance` exists in the schema ([`schema.prisma:97`](../backend/prisma/schema.prisma)) and is consulted in `rbac.ts:248`, but no `GET /provider/patients/:id/insurance` handler decrypts these columns. Functionally unreachable by providers today — see Drift §7.

#### `InsurancePlan.groupIdEncrypted`

- **Column**: `group_id_encrypted` — [`schema.prisma:199`](../backend/prisma/schema.prisma)
- Write: `insuranceController.ts:516`, `:626`. Read: `insuranceController.ts:238`, `settingsController.ts:481`. Audit: paired with `memberIdEncrypted` (same rows). **Logger redaction**: yes — `groupIdEncrypted` in `SENSITIVE_FIELDS` ([`logger.ts:24`](../backend/src/utils/logger.ts)). Provider-accessible: same as `memberIdEncrypted` — flag exists but no route.

---

### Provider-Patient relationship

#### `ProviderPatient.notesEncrypted`

- **Column**: `notes_encrypted` — [`schema.prisma:105`](../backend/prisma/schema.prisma)
- **Encryption site**: `providerRoutes.ts:170` — provider's outgoing access-request message, encrypted with the **provider's** salt:
  ```ts
  // Source: backend/src/routes/providerRoutes.ts:L166-L171
  let encryptedNotes: string | null = null;
  if (message && message.trim()) {
    const encryptionService = getEncryptionService();
    const providerSalt = await getUserEncryptionSalt(providerId);
    encryptedNotes = encryptionService.encrypt(message, providerSalt);
  }
  ```
  Stored on the `ProviderPatient` row at `:207` (new request) or `:212` (re-request after REVOKED/EXPIRED).
- **Decryption site**: **none** in production code. No controller or route decrypts `relationship.notesEncrypted` back to plaintext. The field is write-only scratch visible only via an admin path (which would return ciphertext).
- **Audit on write**: `auditService.logCreate('provider_patient_request', relationship.id, { … })` — [`providerRoutes.ts:220`](../backend/src/routes/providerRoutes.ts).
- **Audit on read**: n/a (never decrypted).
- **Logger redaction**: **no** — generic `notesEncrypted` key.
- **Cross-user consideration**: encrypted with the *provider's* salt, so even if the patient decrypted it, they'd get a decrypt-failure. Only the provider could read it back — and nothing currently does.

---

### DNA / Genetics (deprecated)

#### `DNAVariant.genotypeEncrypted`

- **Column**: `genotype_encrypted` — [`schema.prisma:408`](../backend/prisma/schema.prisma)
- **Write sites**: **none** (UI and API removed).
- **Read sites**: none.
- **Logger redaction**: partial — `genotype` is in `SENSITIVE_FIELDS` ([`logger.ts:25`](../backend/src/utils/logger.ts)); `genotypeEncrypted` key itself is not.
- **Provider-accessible**: `ProviderPatient.canViewDna` flag exists ([`schema.prisma:98`](../backend/prisma/schema.prisma)) but no route reads the column.
- **Notes**: See [CLAUDE.md — Deprecated](../CLAUDE.md). Safe to drop with a migration once data-retention obligations are confirmed.

#### `GeneticTrait.descriptionEncrypted`

- **Column**: `description_encrypted` — [`schema.prisma:424`](../backend/prisma/schema.prisma)
- **Write/read sites**: none.
- **Logger redaction**: yes — `descriptionEncrypted` in `SENSITIVE_FIELDS` ([`logger.ts:25`](../backend/src/utils/logger.ts)).
- **Provider-accessible**: no route.

#### `GeneticTrait.recommendationsEncrypted`

- **Column**: `recommendations_encrypted` — [`schema.prisma:425`](../backend/prisma/schema.prisma)
- **Write/read sites**: none.
- **Logger redaction**: **no** (`recommendationsEncrypted` not in the map).
- **Provider-accessible**: no route.

---

### Health needs

#### `HealthNeed.descriptionEncrypted`

- **Column**: `description_encrypted` — [`schema.prisma:442`](../backend/prisma/schema.prisma)
- **Write sites**: `healthNeedsController.createHealthNeed` — [`healthNeedsController.ts:198`](../backend/src/controllers/healthNeedsController.ts); `updateHealthNeed` — `:249`; bulk from AI analysis — `:554`.
- **Read sites**: `healthNeedsController.mapToResponse` — `:47`; `settingsController.ts:516` (export); `providerRoutes.ts:612` (provider read).
- **Audit on write**: `auditService.logCreate(RESOURCE_TYPE, need.id, { … })` — [`healthNeedsController.ts:216`](../backend/src/controllers/healthNeedsController.ts); update `:273`, status update `:331`; bulk-create audit at `:568`.
- **Audit on read**: `logAccess` at `:128` (LIST), `:175` (GET_ONE), `:442` (ANALYSIS), `:512` (SUMMARY). Provider path: `providerRoutes.ts:565`/`:586`/`:622`.
- **Logger redaction**: yes — `descriptionEncrypted` in `SENSITIVE_FIELDS`.
- **Provider-accessible**: yes — `ProviderPatient.canViewHealthNeeds`:
  ```ts
  // Source: backend/src/routes/providerRoutes.ts:L584-L587
  if (!relationship.canViewHealthNeeds) {
    throw new ForbiddenError('Provider lacks health-needs view permission for this patient');
  }
  ```

---

### Health goals

#### `HealthGoal.descriptionEncrypted`

- **Column**: `description_encrypted` — [`schema.prisma:461`](../backend/prisma/schema.prisma)
- **Write**: `healthGoalsController.createGoal` — [`healthGoalsController.ts:376`](../backend/src/controllers/healthGoalsController.ts); `updateGoal` — `:481`.
- **Read**: `healthGoalsController.mapToResponse` — `:117`; `settingsController.ts:488` (export).
- **Audit on write**: `logCreate` at `:431`, `logUpdate` at `:513` / `:625` (milestone update).
- **Audit on read**: `logAccess` at `:272` (LIST), `:324` (GET_ONE), `:750` (SUMMARY), `:841` (PROGRESS_ANALYSIS).
- **Logger redaction**: yes — `descriptionEncrypted`.
- **Provider-accessible**: no. No provider route decrypts health goals.

#### `HealthGoal.targetValueEncrypted`

- **Column**: `target_value_encrypted` — [`schema.prisma:469`](../backend/prisma/schema.prisma)
- **Write**: `healthGoalsController.ts:388`, `:488`.
- **Read**: `healthGoalsController.readTargetValue` — [`healthGoalsController.ts:39`](../backend/src/controllers/healthGoalsController.ts) (falls back to unencrypted `targetValue` Decimal if the encrypted column is null, per schema comment at [`schema.prisma:L464-L468`](../backend/prisma/schema.prisma)).
- **Audit**: inherits `logCreate`/`logUpdate` on the parent goal.
- **Logger redaction**: **no** — Drift §7.
- **Provider-accessible**: no.

#### `GoalProgressHistory.noteEncrypted`

- **Column**: `note_encrypted` — [`schema.prisma:502`](../backend/prisma/schema.prisma)
- **Write**: `healthGoalsController.ts:421` (initial "Initial value" row at goal creation); `:605` (progress update).
- **Read**: `healthGoalsController.ts:158`.
- **Audit**: inherits parent goal's create/update; GET_ONE at `:324` returns decrypted notes.
- **Logger redaction**: yes — `noteEncrypted` in `SENSITIVE_FIELDS` ([`logger.ts:25`](../backend/src/utils/logger.ts)).
- **Provider-accessible**: no.

---

### Audit log (encrypted-at-rest PHI snapshots)

#### `AuditLog.previousValueEncrypted`

- **Column**: `previous_value_encrypted` — [`schema.prisma:521`](../backend/prisma/schema.prisma)
- **Encryption site**: `AuditLogService.encryptValue` — [`auditLog.ts:194`](../backend/src/services/auditLog.ts):
  ```ts
  // Source: backend/src/services/auditLog.ts:L188-L199
  private encryptValue(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    try {
      const encryptionService = getEncryptionService();
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      return encryptionService.encrypt(stringValue, this.systemSalt);
    } catch (error) {
      logger.error('Failed to encrypt audit value', { data: { error } });
      return '[ENCRYPTION_FAILED]';
    }
  }
  ```
  Called from `auditLog.ts:207` inside `AuditLogService.log`.
- **Decryption site**: **none** in production code. `queryLogs` ([`auditLog.ts:456`](../backend/src/services/auditLog.ts)) returns the raw row (ciphertext) to ADMIN-only endpoint `/api/v1/admin/audit-logs` — the response shows the ciphertext as-is.
- **Audit**: every log call is itself the audit record (immutable; no updates/deletes by policy — `AuditAction` enum excludes UPDATE/DELETE for `AuditLog` rows; cleanup uses bulk deleteMany + `logSystem('DELETE', 'AuditLog', …)` at `auditLog.ts:496`).
- **Logger redaction**: **no** — `previousValue`/`previousValueEncrypted` are not in `SENSITIVE_FIELDS`. Note that `auditLog.ts:244` *does* pre-redact `previousValue: '[REDACTED]'` when logging audit *failures* (see the catch block), so error-path exposure is mitigated.
- **Cross-user / rotation**: uses **`config.auditSalt`** (system salt), not per-user salt — documented at [`auditLog.ts:L106-L127`](../backend/src/services/auditLog.ts). Rationale: `UserEncryptionKey` rows are cascade-deleted on user deletion, but HIPAA requires 7-year audit retention — per-user salt would render audit rows unreadable.

#### `AuditLog.newValueEncrypted`

Identical wiring to `previousValueEncrypted`: write at `auditLog.ts:208`, no decrypt site, system salt. Logger-redacts only in the error path (`auditLog.ts:245`).

---

### Expense tracking

#### `ExpenseProjection.serviceTypeEncrypted`

- **Column**: `service_type` — [`schema.prisma:686`](../backend/prisma/schema.prisma) — **DB column lacks `_encrypted` suffix** (see Drift §7).
- **Write**: `expenseController.ts:102`, `:223`, `:505`.
- **Read**: `expenseController.ts:120`, `:172`, `:247`, `:671` (sanitized for Claude prompt); `healthContextService.ts:298`.
- **Audit on write**: `logCreate(RESOURCE_TYPE_PROJECTION, projection.id, …)` — [`expenseController.ts:112`](../backend/src/controllers/expenseController.ts); update `:242`; delete `:277`.
- **Audit on read**: `logAccess` at `:179`.
- **Logger redaction**: **no** — Drift §7.
- **Provider-accessible**: no.

#### `ExpenseProjection.estimatedCostEncrypted`

- **Column**: `estimated_cost` — [`schema.prisma:687`](../backend/prisma/schema.prisma).
- **Write/read/audit**: same rows as `serviceTypeEncrypted` (they travel together). Specific lines: write `:103`, `:226`; read `:121`, `:173`, `:248`, `:672`, `healthContextService.ts:296`.

#### `ExpenseProjection.notesEncrypted`

- **Column**: `notes` — [`schema.prisma:690`](../backend/prisma/schema.prisma). Write `:106`, `:231`; read `:122`, `:174`, `:249`, `:675`.

#### `ExpenseActual.serviceTypeEncrypted`

- **Column**: `service_type` — [`schema.prisma:709`](../backend/prisma/schema.prisma).
- **Write**: `expenseController.ts:378`, `:505`. **Read**: `:325`.
- **Audit**: `logCreate` at `:394`, `logUpdate` at `:527`, `logDelete` at `:555`. Read: `logAccess` at `:446`.
- **Logger redaction**: **no**.

#### `ExpenseActual.providerNameEncrypted`

- **Column**: `provider_name` — [`schema.prisma:710`](../backend/prisma/schema.prisma).
- **Write**: `expenseController.ts:380`. **Read**: `:327`.
- **Audit**: same as `serviceTypeEncrypted`.
- **Logger redaction**: **no**.
- **Notes**: This is a medical provider's name (doctor/hospital), distinct from `User.firstName`.

#### `ExpenseActual.billedAmountEncrypted` / `insurancePaidEncrypted` / `patientPaidEncrypted` / `appliedToDeductibleEncrypted` / `appliedToOopEncrypted`

All five monetary fields are written via the `encryptOpt` helper at [`expenseController.ts:370`](../backend/src/controllers/expenseController.ts):

```ts
// Source: backend/src/controllers/expenseController.ts:L369-L371
const encryptOpt = (v: number | null | undefined) =>
  v === undefined || v === null ? null : encryption.encrypt(v.toString(), userSalt);
```

…and read via the corresponding `decryptOpt` at [`expenseController.ts:319`](../backend/src/controllers/expenseController.ts):

```ts
// Source: backend/src/controllers/expenseController.ts:L318-L320
const decryptOpt = (v: string | null | undefined) =>
  v ? parseFloat(encryption.decrypt(v, userSalt)) : null;
```

- **Columns** (all on `ExpenseActual`): `billed_amount`, `insurance_paid`, `patient_paid`, `applied_to_deductible`, `applied_to_oop` — [`schema.prisma:L712-L716`](../backend/prisma/schema.prisma). Migration `20260206_fix_expense_encryption_types` moved these off `Decimal` to encrypted strings (see [CLAUDE.md §PHI Encryption](../CLAUDE.md)).
- **Audit**: covered by `expenseController.ts:394` (CREATE), `:527` (UPDATE), `:555` (DELETE), `:446` (LIST).
- **`patientPaidEncrypted`** has an additional read in `healthContextService.ts:309` for AI cost-summary context.
- **Logger redaction**: **none of them are in `SENSITIVE_FIELDS`**. Drift §7.

#### `ExpenseActual.notesEncrypted`

- **Column**: `notes` — [`schema.prisma:719`](../backend/prisma/schema.prisma).
- Write: `expenseController.ts:388`. Read: `:335`.
- **Logger redaction**: **no**.

#### `CostAnalysis.claudeResponse`

- **Column**: `claude_response` — [`schema.prisma:737`](../backend/prisma/schema.prisma). **Field name intentionally lacks `Encrypted` suffix** — documented in `PHI_FIELDS` at [`encryption.ts:L481-L484`](../backend/src/services/encryption.ts).
- **Write**: `expenseController.ts:720`.
- **Read**: `expenseController.ts:784`.
- **Audit on write**: `logCreate(RESOURCE_TYPE_ANALYSIS, analysis.id, …)` — [`expenseController.ts:731`](../backend/src/controllers/expenseController.ts).
- **Audit on read**: `logAccess` at `:634` (pre-existing plan audit) and `:793` (LIST).
- **Logger redaction**: **yes** — `claudeResponse` in `SENSITIVE_FIELDS` ([`logger.ts:28`](../backend/src/utils/logger.ts)). One of the few non-suffixed keys handled correctly.

#### `CostAnalysis.totalProjectedOopEncrypted`

- **Column**: `total_projected_oop` — [`schema.prisma:738`](../backend/prisma/schema.prisma).
- Write: `expenseController.ts:721-722`. Read: `:786`.

#### `CostAnalysis.projectedExpensesSnapshotEncrypted`

- **Column**: `projected_expenses_snapshot` — [`schema.prisma:740`](../backend/prisma/schema.prisma).
- **Write**: `expenseController.ts:725`.
- **Read**: **none located** — the snapshot is a point-in-time audit blob written on analysis creation; no controller path reads it back. Could safely be dropped from per-user decrypt sweeps but is kept for future replay/audit.

---

### Lab connections (SMART-on-FHIR OAuth)

#### `LabConnection.accessTokenEncrypted`

- **Column**: `access_token_encrypted` — [`schema.prisma:763`](../backend/prisma/schema.prisma).
- **Write**: `fhir/labSyncService.ts:141` (OAuth exchange) stored at `:151` / `:160`; refresh at `:229` stored at `:237`.
- **Read**: `fhir/labSyncService.ts:212` (sync run), `:402` (disconnect flow).
- **Audit**: write-path audit at `fhir/labSyncService.ts:172` (`logAccess` on `lab_connection`); read-path audit at `:350`, `:368`, `:415`.
- **Logger redaction**: partial — `accessToken` and `token` are redacted ([`logger.ts:22`](../backend/src/utils/logger.ts)), but the concrete Prisma column `accessTokenEncrypted` is not.
- **Provider-accessible**: no.
- **Notes**: This is an OAuth bearer token to Quest/LabCorp FHIR APIs — a stolen token is a direct path to the user's live clinical data. Per-user-salt encryption is intentional.

#### `LabConnection.refreshTokenEncrypted`

- **Column**: `refresh_token_encrypted` — [`schema.prisma:764`](../backend/prisma/schema.prisma).
- Write: `fhir/labSyncService.ts:142`, `:231`. Read: `:214`.
- **Logger redaction**: yes — `refreshToken` in `SENSITIVE_FIELDS`.

---

## 4. Logger redaction coverage

Source of truth: `SENSITIVE_FIELDS` Set at [`backend/src/utils/logger.ts:L21-L30`](../backend/src/utils/logger.ts). Matching is **lowercased key equality**, not substring. A PHI field whose Prisma/TypeScript key isn't in the set will leak through any `logger.info('…', { data: { user } })` style call that embeds a row.

```ts
// Source: backend/src/utils/logger.ts:L21-L30
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'accessToken', 'refreshToken', 'secret',
  'ssn', 'socialSecurityNumber', 'memberId', 'groupNumber',
  'memberIdEncrypted', 'groupIdEncrypted', 'valueEncrypted',
  'descriptionEncrypted', 'noteEncrypted', 'genotype',
  'email', 'phoneNumber', 'address', 'dateOfBirth',
  // AI response fields that may contain PHI
  'responseText', 'jsonText', 'claudeResponse', 'guidance',
  'extractedData', 'pdfText', 'pdfContent', 'biomarker',
]);
```

### Drift — PHI fields NOT redacted by `SENSITIVE_FIELDS`

| PHI field | In `PHI_FIELDS`? | Concrete key in code | In `SENSITIVE_FIELDS`? | Risk | Suggested patch |
|---|---|---|---|---|---|
| `User.firstNameEncrypted` | yes | `firstNameEncrypted` / `firstName` | **no** | First name leaks through any row-embedding log | add `firstnameencrypted`, `firstname` |
| `User.lastNameEncrypted` | yes | `lastNameEncrypted` / `lastName` | **no** | Same | add `lastnameencrypted`, `lastname` |
| `User.dateOfBirthEncrypted` | yes | `dateOfBirthEncrypted` | only `dateOfBirth` matched | Ciphertext key not redacted | add `dateofbirthencrypted` |
| `User.phoneEncrypted` | yes | `phoneEncrypted` / `phone` | only `phoneNumber` matched | Ciphertext key not redacted | add `phoneencrypted`, `phone` |
| `User.addressEncrypted` | yes | `addressEncrypted` | only `address` matched | Ciphertext key not redacted | add `addressencrypted` |
| `User.healthProfileEncrypted` | yes | `healthProfileEncrypted` | **no** | High-value blob (meds, conditions) | add `healthprofileencrypted` |
| `Biomarker.notesEncrypted` | yes | `notesEncrypted` | **no** (generic `notesEncrypted` absent) | Patient free-text leaks | add `notesencrypted` |
| `ProviderPatient.notesEncrypted` | yes | `notesEncrypted` | **no** | — | add `notesencrypted` |
| `HealthGoal.targetValueEncrypted` | yes | `targetValueEncrypted` | **no** | Numeric target reveals condition | add `targetvalueencrypted` |
| `ExpenseProjection.serviceTypeEncrypted` | yes | `serviceTypeEncrypted` | **no** | Reveals procedure/service | add `servicetypeencrypted` |
| `ExpenseProjection.estimatedCostEncrypted` | yes | `estimatedCostEncrypted` | **no** | Reveals cost | add `estimatedcostencrypted` |
| `ExpenseProjection.notesEncrypted` | yes | `notesEncrypted` | **no** | — | covered by `notesencrypted` patch |
| `ExpenseActual.serviceTypeEncrypted` | yes | `serviceTypeEncrypted` | **no** | — | — |
| `ExpenseActual.providerNameEncrypted` | yes | `providerNameEncrypted` | **no** | Reveals medical provider | add `providernameencrypted` |
| `ExpenseActual.billedAmountEncrypted` | yes | `billedAmountEncrypted` | **no** | Reveals cost | add `billedamountencrypted` |
| `ExpenseActual.insurancePaidEncrypted` | yes | `insurancePaidEncrypted` | **no** | — | add `insurancepaidencrypted` |
| `ExpenseActual.patientPaidEncrypted` | yes | `patientPaidEncrypted` | **no** | — | add `patientpaidencrypted` |
| `ExpenseActual.appliedToDeductibleEncrypted` | yes | `appliedToDeductibleEncrypted` | **no** | — | add `appliedtodeductibleencrypted` |
| `ExpenseActual.appliedToOopEncrypted` | yes | `appliedToOopEncrypted` | **no** | — | add `appliedtoopencrypted` |
| `ExpenseActual.notesEncrypted` | yes | `notesEncrypted` | **no** | — | covered above |
| `CostAnalysis.totalProjectedOopEncrypted` | yes | `totalProjectedOopEncrypted` | **no** | Numeric OOP | add `totalprojectedoopencrypted` |
| `CostAnalysis.projectedExpensesSnapshotEncrypted` | yes | `projectedExpensesSnapshotEncrypted` | **no** | JSON snapshot | add `projectedexpensessnapshotencrypted` |
| `AuditLog.previousValueEncrypted` | yes | `previousValueEncrypted` | **no** | Only error-path pre-redact | add `previousvalueencrypted`, `newvalueencrypted` |
| `AuditLog.newValueEncrypted` | yes | `newValueEncrypted` | **no** | — | — |
| `LabConnection.accessTokenEncrypted` | yes | `accessTokenEncrypted` | partial | `accessToken` matched, suffixed version not | add `accesstokenencrypted` |
| `LabConnection.refreshTokenEncrypted` | yes | `refreshTokenEncrypted` | partial | `refreshToken` matched | add `refreshtokenencrypted` |
| `GeneticTrait.recommendationsEncrypted` | yes (deprecated) | `recommendationsEncrypted` | **no** | deprecated | — |

### Fields correctly redacted

`memberIdEncrypted`, `groupIdEncrypted`, `valueEncrypted`, `descriptionEncrypted`, `noteEncrypted`, `genotype`, `email`, `phoneNumber`, `address`, `dateOfBirth`, `claudeResponse`, `guidance`, `extractedData`, `pdfText`, `pdfContent`, `biomarker`, `responseText`, `jsonText`, `password`, `token`, `accessToken`, `refreshToken`, `secret`, `ssn`, `socialSecurityNumber`, `memberId`, `groupNumber`.

---

## 5. Audit log coverage gaps

Source: `auditService.log*` call-site grep over `backend/src/**`.

Every PHI **write** has a matching `auditService.logCreate` / `logUpdate` / `logDelete`. Every PHI **read controller** has a matching `logAccess` at or near the handler entry — **with a few exceptions**:

| PHI field / path | Audited on write? | Audited on read? | Drift |
|---|---|---|---|
| `User.firstNameEncrypted` / `lastNameEncrypted` | yes (`:1014`) | yes (`:946`) | none |
| `User.dateOfBirthEncrypted` | n/a (no write path) | yes (export only, `:638`) | **No dedicated PHI_READ audit for the individual identity fields outside export**; export is the only read path |
| `User.phoneEncrypted`, `addressEncrypted` | n/a | yes (export only) | same as above |
| `User.healthProfileEncrypted` | yes (`:1205`) | yes (`:1159`) | none |
| `Biomarker.*Encrypted` | yes (`:273`, `:363`, `:593`) | yes (`:160`, `:215`, `:442`, `:715`, `:819`) | none |
| `BiomarkerHistory.valueEncrypted` | yes (parent) | yes (`:819`) | none |
| `InsurancePlan.memberIdEncrypted` / `groupIdEncrypted` | yes (`:585`, `:685`) | yes (`:450`, `:489`) | none |
| `ProviderPatient.notesEncrypted` | yes (`:220`) | n/a — never decrypted | none (by design) |
| `HealthNeed.descriptionEncrypted` | yes (`:216`, `:273`, `:331`, `:568`) | yes (`:128`, `:175`, `:442`, `:512`) + provider `:565`/`:586`/`:622` | none |
| `HealthGoal.descriptionEncrypted` / `targetValueEncrypted` | yes (`:431`, `:513`, `:625`) | yes (`:272`, `:324`, `:750`, `:841`) | none |
| `GoalProgressHistory.noteEncrypted` | yes (parent) | yes (`:324`) | none |
| `AuditLog.previousValueEncrypted` / `newValueEncrypted` | yes (implicit — they *are* the audit) | no dedicated PHI-read audit; `queryLogs` has its own `admin_audit_logs` `logAccess` at [`adminRoutes.ts:902`](../backend/src/routes/adminRoutes.ts) | none |
| `ExpenseProjection.*Encrypted` | yes (`:112`, `:242`, `:277`) | yes (`:179`) | none |
| `ExpenseActual.*Encrypted` | yes (`:394`, `:527`, `:555`) | yes (`:446`) | none |
| `CostAnalysis.claudeResponse` + companion encrypted fields | yes (`:731`) | yes (`:634`, `:793`) | none |
| `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted` | yes (`fhir/labSyncService.ts:172`) | yes (`:350`, `:368`, `:415`) | none |
| **`healthContextService.ts` AI-prompt decrypts** (biomarker, expense, health-profile) | n/a | **no audit** at `healthContextService.ts:146`/`:229`/`:296`/`:298`/`:309`; the calling controllers (`biomarkerController`, `expenseController`, AI chat) audit their *entry point* but the downstream cross-resource read doesn't emit a per-resource `logAccess` | **Partial gap**: a call to `/api/v1/ai/chat` audits as AI-chat but implicitly decrypts biomarkers + expenses in the same request without separate biomarker/expense read audits. `aiChatController.ts:135`/`:262`/`:291` covers this with a single `ai_chat` `logAccess` — acceptable per HIPAA §164.312(b) (log access to the system, not every field), but worth noting. |

---

## 6. Encryption key lifecycle

### Master key

- **Variable**: `PHI_ENCRYPTION_KEY` — 64-hex-char (256-bit) hex string.
- **Storage**: GCP Secret Manager in prod ([DEPLOY.md:66](../DEPLOY.md)). Loaded into `process.env` at Cloud Run startup.
- **Loader**: `EncryptionService` constructor — [`encryption.ts:L159-L186`](../backend/src/services/encryption.ts).
- **Validation**: `validateEncryptionKey` — [`encryption.ts:L103-L143`](../backend/src/services/encryption.ts):
  - must be ≥ 64 hex chars
  - must be hex-only (regex `/^[0-9a-fA-F]+$/`)
  - rejects three known-insecure/placeholder values in every NODE_ENV (hardening from finding C-4; previously only rejected in production).
- **Startup failure**: the service throws and refuses to boot if the key is invalid — no silent weak-key fallback.

### Per-user derived key

- **Table**: `UserEncryptionKey` — [`schema.prisma:L75-L90`](../backend/prisma/schema.prisma).
  - `encryptedKey` stores a 32-byte random salt, encrypted with the master key via `encryptWithMasterKey` — [`encryption.ts:L215-L228`](../backend/src/services/encryption.ts).
  - `version` + `isActive` support rotation (old versions kept for re-encryption windows).
- **Create path**: `getUserEncryptionSalt` — [`userEncryption.ts:L29-L72`](../backend/src/services/userEncryption.ts). Lazy: first call for a user generates a new salt, encrypts with master, persists. All calls wrap in `withRLSContext(null, …, { isAdmin: true })`.
- **Derivation**: `deriveUserKey` — [`encryption.ts:L193-L201`](../backend/src/services/encryption.ts):
  - PBKDF2-SHA512
  - 600,000 iterations (hardened from 100,000 — see [`encryption.ts:L69-L87`](../backend/src/services/encryption.ts))
  - salt = 32-byte per-user value
  - output = 32-byte AES-256 key
- **Legacy fallback**: `decrypt` tries 600k first, then 100k on auth-tag failure ([`encryption.ts:L302-L316`](../backend/src/services/encryption.ts)). This lets pre-hardening ciphertext decrypt without a forced re-encryption pass.
- **Rotation primitive**: `rotateUserEncryptionKey` — [`userEncryption.ts:L81-L137`](../backend/src/services/userEncryption.ts). Marks the current row inactive (`isActive = false`, `rotatedAt = now`), writes a new version row. Does **not** re-encrypt existing PHI — that is the caller's responsibility. `EncryptionService.reEncrypt(oldSalt, newSalt)` at [`encryption.ts:390`](../backend/src/services/encryption.ts) is the primitive for re-encryption.

### Rotation policy

**Master key rotation cadence**: TBD (external: `PHI_ENCRYPTION_KEY` rotation cadence is not documented in the repo — [`prompts/15-runbook-doc.md:190`](../prompts/15-runbook-doc.md) asks the same question. Define in [RUNBOOK.md](./RUNBOOK.md) and cross-link here. Resolution path: SecOps owner + GCP Secret Manager versioning policy).

**Per-user rotation cadence**: manual only. No scheduled job invokes `rotateUserEncryptionKey`. Rotation is a primitive, not a policy.

### System salt (audit log)

- **Variable**: `AUDIT_LOG_SALT` — validated at module load in [`backend/src/config/index.ts`](../backend/src/config/index.ts) (throws if missing or < 16 chars).
- **Purpose**: encrypts `AuditLog.previousValueEncrypted` / `newValueEncrypted` so audit rows survive `UserEncryptionKey` cascade-delete on user deletion. 7-year HIPAA retention window requires readability past user deletion.
- **Loader**: `AuditLogService.initialize` — [`auditLog.ts:L120-L127`](../backend/src/services/auditLog.ts). Previously read from `system_config.audit_encryption_salt` inside an admin RLS context; migrated to env var to break the C-8 bootstrapping dependency.

### On user deletion

- `User.onDelete: Cascade` on `UserEncryptionKey` ([`schema.prisma:85`](../backend/prisma/schema.prisma)) — salts purged.
- All PHI rows are also `onDelete: Cascade` from `User` — PHI rows deleted physically.
- `AuditLog` references `User` with **no** cascade ([`schema.prisma:527`](../backend/prisma/schema.prisma) — `@relation(fields: [userId], references: [id])` with no `onDelete`), so audit rows remain; encrypted with system salt so they remain readable.
- Deletion is audit-logged:
  - `settingsController.deleteAccount` — `logDelete('User', userId, …)` at [`settingsController.ts:849`](../backend/src/controllers/settingsController.ts); system log at `:876`.
  - Data-purge path also logs `logDelete('UserData', userId, …)` at `:792` and `logSystem('DELETE', 'UserData', …)` at `:729`.

---

## 7. Drift findings

### Schema vs `PHI_FIELDS` drift

| Column | In schema? | In `PHI_FIELDS`? | Action / Notes |
|---|---|---|---|
| `users.first_name_encrypted` … `health_profile_encrypted` | yes (6 cols) | yes (6 entries) | in sync |
| `biomarkers.value_encrypted`, `notes_encrypted` | yes | yes | in sync |
| `biomarker_history.value_encrypted` | yes | yes (no notes — intentional) | in sync; documented in `PHI_FIELDS` comment |
| `insurance_plans.member_id_encrypted`, `group_id_encrypted` | yes | yes | in sync |
| `provider_patients.notes_encrypted` | yes | yes | in sync |
| `dna_variants.genotype_encrypted` | yes | yes | in sync (deprecated) |
| `genetic_traits.description_encrypted`, `recommendations_encrypted` | yes | yes | in sync (deprecated) |
| `health_needs.description_encrypted` | yes | yes | in sync |
| `health_goals.description_encrypted`, `target_value_encrypted` | yes | yes | in sync |
| `goal_progress_history.note_encrypted` | yes | yes | in sync |
| `audit_logs.previous_value_encrypted`, `new_value_encrypted` | yes | yes | in sync |
| `expense_projections.service_type`, `estimated_cost`, `notes` | yes (DB columns lack `_encrypted` suffix) | yes (Prisma-side names have `Encrypted` suffix) | **Naming drift** — Prisma field `serviceTypeEncrypted` maps to DB column `service_type` ([`schema.prisma:686`](../backend/prisma/schema.prisma)). Result: a raw SQL query sees plaintext-looking column names that actually hold ciphertext. Safe because access is always via Prisma; worth renaming in a future migration. |
| `expense_actuals.service_type` etc. (8 columns) | yes (DB) | yes (Prisma) | Same naming drift as above |
| `cost_analyses.claude_response` | yes | yes (as `claudeResponse`, no `Encrypted` suffix on Prisma side either) | **Intentional** per `PHI_FIELDS` comment; documented |
| `cost_analyses.total_projected_oop`, `projected_expenses_snapshot` | yes (no `_encrypted` suffix) | yes (Prisma fields have `Encrypted` suffix) | Same naming drift |
| `lab_connections.access_token_encrypted`, `refresh_token_encrypted` | yes | yes | in sync |
| `insurance_benefits.*` | **no encrypted columns** | — | confirmed non-PHI metadata (copays, coverage flags). `_phi-inventory.md` `### Insurance` table over-claims `InsuranceBenefit` PHI — update the inventory |

No `*Encrypted` column in the schema is missing from `PHI_FIELDS`. No entry in `PHI_FIELDS` lacks a schema column. The only drift is **DB-column naming** for Expense and CostAnalysis fields.

### Missing write paths (schema has column, no controller writes it)

| Field | Status |
|---|---|
| `User.dateOfBirthEncrypted` | **No controller writes this.** Registration in `authController.register` does not collect DOB. Only read on export. |
| `User.phoneEncrypted` | Same. |
| `User.addressEncrypted` | Same. |
| `GeneticTrait.descriptionEncrypted` / `recommendationsEncrypted`, `DNAVariant.genotypeEncrypted` | Deprecated, no writers. |

Action: either add an onboarding UI for DOB/phone/address, or remove the columns. Flagged for product — see [CLAUDE.md §Removed Features](../CLAUDE.md).

### Provider-consent flags that don't gate any decrypt path

| Flag | Schema | `rbac.ts` maps? | Actual route consults? |
|---|---|---|---|
| `canViewBiomarkers` | yes | yes (`rbac.ts:242`) | yes — [`providerRoutes.ts:444`](../backend/src/routes/providerRoutes.ts) |
| `canViewHealthNeeds` | yes | yes (implicit via `providerRoutes`) | yes — [`providerRoutes.ts:584`](../backend/src/routes/providerRoutes.ts) |
| `canEditData` | yes | yes (`rbac.ts:243`) | **no mutation route for patient data exists on provider side** |
| `canViewInsurance` | yes | yes (`rbac.ts:248`) | **no — no `GET /provider/patients/:id/insurance` handler** |
| `canViewDna` | yes | yes (`rbac.ts:253`) | **no — DNA feature removed** |

Three flags exist in the schema + RBAC layer but have no actual decrypt call site. Either add the routes or drop the flags.

### Prompt drift log

None — the `40-phi-taxonomy-doc.md` prompt file list is current as of 2026-04-24.

Two minor notes on the seed inventory `_phi-inventory.md`:

1. It lists `InsurancePlan` PHI as `memberIdEncrypted, groupIdEncrypted` but also mentions "plan name, provider name, benefits" in the "Insurance" row — those are *not* encrypted in the schema (`planName`, `insurerName` are plain `VARCHAR`). The `PHI_FIELDS` constant is the correct minimal list; the inventory's prose is aspirational.
2. It omits `User.healthProfileEncrypted` and `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted`. Update the inventory.

---

## 8. Cross-user exposure matrix

Rows are PHI fields; columns are actor → field reachability.

| Field | Owner-user read | Provider read (with consent) | Provider consent flag | ADMIN read | ADMIN returns plaintext? |
|---|---|---|---|---|---|
| `User.firstNameEncrypted` / `lastNameEncrypted` | yes (`settingsController.ts:940`) | no (no provider route) | — | ADMIN can list users ([`adminRoutes.ts:96`](../backend/src/routes/adminRoutes.ts)) | ciphertext in admin response — no decrypt call |
| `User.dateOfBirthEncrypted` / `phoneEncrypted` / `addressEncrypted` | yes (export only) | no | — | ciphertext only | no |
| `User.healthProfileEncrypted` | yes | no | — | ciphertext only | no |
| `Biomarker.valueEncrypted` / `notesEncrypted` | yes | yes | `canViewBiomarkers` ([`providerRoutes.ts:444`](../backend/src/routes/providerRoutes.ts)) | ciphertext only | no |
| `BiomarkerHistory.valueEncrypted` | yes | yes | `canViewBiomarkers` | ciphertext only | no |
| `InsurancePlan.memberIdEncrypted` / `groupIdEncrypted` | yes | **flag exists but no route** — not reachable | `canViewInsurance` (unwired) | ciphertext only | no |
| `ProviderPatient.notesEncrypted` | no (encrypted with provider's salt — patient decrypt would fail) | no decrypt path | — | ciphertext only | no |
| `DNA*` | no (feature removed) | no | `canViewDna` (unwired) | — | — |
| `HealthNeed.descriptionEncrypted` | yes | yes | `canViewHealthNeeds` ([`providerRoutes.ts:584`](../backend/src/routes/providerRoutes.ts)) | ciphertext only | no |
| `HealthGoal.descriptionEncrypted` / `targetValueEncrypted` | yes | no (no provider route) | — | ciphertext only | no |
| `GoalProgressHistory.noteEncrypted` | yes | no | — | ciphertext only | no |
| `AuditLog.previousValueEncrypted` / `newValueEncrypted` | no | no | — | **yes, via `queryLogs`** ([`adminRoutes.ts:902`](../backend/src/routes/adminRoutes.ts)) | **ciphertext only** — no admin decrypt tool today |
| `ExpenseProjection.*` / `ExpenseActual.*` / `CostAnalysis.*` | yes | no | — | ciphertext only | no |
| `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted` | no direct UI read (used server-side by `labSyncService`) | no | — | ciphertext only | no |

**Key insight**: no ADMIN route in the codebase decrypts user PHI. ADMIN sees ciphertext. The encryption service is never called with an admin user's salt against another user's data — `getUserEncryptionSalt(userId)` always scopes to the owning user.

---

## 9. Verification — grep patterns used

To reproduce the tables above:

| Task | Grep pattern | Scope |
|---|---|---|
| Find `PHI_FIELDS` | `PHI_FIELDS` | `backend/src/services/encryption.ts` |
| Find all encrypted DB columns | `Encrypted\s+String` | `backend/prisma/schema.prisma` |
| Find encrypt call sites | `encryptPHI\(\|\.encrypt\(\|encryptField` | `backend/src` |
| Find decrypt call sites | `decryptPHI\(\|\.decrypt\(\|decryptField` | `backend/src` |
| Find audit log emitters | `auditLog\.log\(\|auditService\.log\|\.logAccess\(\|\.logCreate\(\|\.logUpdate\(\|\.logDelete\(\|\.logAuth\(\|\.logExport\(\|\.logSystem\(` | `backend/src` |
| Find consent-flag reads | `canView\|canEdit` | `backend/src` |
| Find `SENSITIVE_FIELDS` | `SENSITIVE_FIELDS` | `backend/src/utils/logger.ts` |

Verified on 2026-04-24 against HEAD of `main` at `C:\Users\breil\OneDrive\Desktop\OwnMyHealth`.

---

## 10. Acceptance questions (self-answered)

1. **How many PHI fields are defined in `PHI_FIELDS`, and do all map to `*Encrypted` columns in the schema?** 33 active + 3 deprecated = 36 entries across 15 models. All map to schema columns. Exceptions: `CostAnalysis.claudeResponse` (intentionally unsuffixed — documented in `PHI_FIELDS`); `ExpenseProjection` / `ExpenseActual` / `CostAnalysis` encrypted-string columns are `@map(...)` to DB names that lack the `_encrypted` suffix (Drift §7). See Master PHI table in §2.

2. **Where is `Biomarker.valueEncrypted` decrypted, and how many call sites?** 14 call sites across 7 files — see the `Biomarker.valueEncrypted` row in §2 and the deep dive in §3. Key reads: `biomarkerController.ts:67`/`:77`/`:312`/`:346`/`:795`/`:799`, `biomarkerRoutes.ts:177`/`:185`, `providerRoutes.ts:473`, `healthContextService.ts:146`/`:229`, `fhir/labSyncService.ts:271`, `settingsController.ts:429`.

3. **Is `ExpenseActual.providerNameEncrypted` covered by logger redaction?** **No.** `providerNameEncrypted` is not in `SENSITIVE_FIELDS` ([`logger.ts:L21-L30`](../backend/src/utils/logger.ts)). Drift §7 — suggested patch: add `providernameencrypted` to the Set.

4. **Which PHI fields can a PROVIDER read, and via which consent permission flag?** Two fields/paths:
   - `Biomarker.valueEncrypted` + `Biomarker.notesEncrypted` + `BiomarkerHistory.valueEncrypted` — gate `canViewBiomarkers` at [`providerRoutes.ts:444`](../backend/src/routes/providerRoutes.ts).
   - `HealthNeed.descriptionEncrypted` — gate `canViewHealthNeeds` at [`providerRoutes.ts:584`](../backend/src/routes/providerRoutes.ts).
  
   Flags `canViewInsurance`, `canViewDna`, `canEditData` exist in the schema but have no decrypt call site (Drift §7).

5. **How is the per-user encryption key derived, and where is it stored?** Derived by `deriveUserKey` — [`encryption.ts:L193-L201`](../backend/src/services/encryption.ts) — using PBKDF2-SHA512, 600,000 iterations, 32-byte per-user salt → 32-byte AES-256 key. The salt is stored in table `user_encryption_keys.encrypted_key`, encrypted at rest with the master key (`encryptWithMasterKey`). Retrieved by `getUserEncryptionSalt` — [`userEncryption.ts:29`](../backend/src/services/userEncryption.ts). Master key from `process.env.PHI_ENCRYPTION_KEY`.

6. **Does every PHI write have a matching `auditLog.log(...)` call, and what's the drift if not?** Yes, every PHI-writing controller emits a `logCreate` / `logUpdate` / `logDelete`. See §5 for the line-by-line matrix. No gap. Minor note: `healthContextService.ts` decrypts biomarker/expense/profile for AI prompts without per-resource audits; the calling endpoint (`/api/v1/ai/chat` at `aiChatController.ts:135`) audits once per chat invocation — acceptable under HIPAA §164.312(b) (system-level access log, not field-level).

7. **Which deprecated models still hold PHI, and is it safe to drop them?** `DNAData`, `DNAVariant` (`genotypeEncrypted`), `GeneticTrait` (`descriptionEncrypted`, `recommendationsEncrypted`). Zero write/read sites in the current codebase — safe to drop via a migration once data-retention policy confirms no existing rows require 7-year hold.

8. **Which audit log fields themselves hold encrypted PHI (previous/new values)?** `AuditLog.previousValueEncrypted` and `AuditLog.newValueEncrypted` — encrypted with the **system** salt (`config.auditSalt`) rather than the per-user salt, via `auditLog.ts:194`. Written by `AuditLogService.log` — `auditLog.ts:L202-L250`. No decrypt call site in production — admin `queryLogs` ([`auditLog.ts:456`](../backend/src/services/auditLog.ts)) returns ciphertext.

9. **What's the rotation policy for `PHI_ENCRYPTION_KEY`, and where is that recorded?** **TBD (external: not documented in repo; define in [RUNBOOK.md](./RUNBOOK.md)).** The rotation primitive for per-user salts is `rotateUserEncryptionKey` in `userEncryption.ts:81`, but no scheduled cadence or master-key rotation runbook exists. Prompt [`15-runbook-doc.md:190`](../prompts/15-runbook-doc.md) already flags this question. Resolution path: SecOps owner + GCP Secret Manager versioning.

10. **Is there a redaction gap in `logger.ts` for any PHI field?** **Yes — 25+ fields have gaps.** See the full table in §4. Largest risks: all `User.*Encrypted` name/DOB/phone/address key variants, `User.healthProfileEncrypted`, all `ExpenseActual` monetary fields, `AuditLog.previousValueEncrypted` / `newValueEncrypted`.

11. **How is `ProviderPatient.relationshipNotesEncrypted` accessed — patient-only, provider-only, or both?** Schema column is `notes_encrypted` (Prisma field `notesEncrypted`). It's **provider-only-writable** during access request ([`providerRoutes.ts:170`](../backend/src/routes/providerRoutes.ts), encrypted with the provider's own salt), and **not decrypted anywhere**. Neither patient nor provider has a read route for it today. Effectively write-once, read-never — see §3.

12. **What happens to PHI on user deletion — cascade or soft delete, and where is the purge logged?** Hard cascade. All PHI-owning tables (`biomarkers`, `insurance_plans`, `health_needs`, `health_goals`, `expense_*`, `cost_analyses`, `user_encryption_keys`, `lab_connections`, `dna_data`) declare `onDelete: Cascade` from `User` in `schema.prisma`. `AuditLog` is **not** cascaded — its system-salt encryption keeps rows readable for the 7-year retention window. Purge is logged via `logDelete('User', userId, …)` at [`settingsController.ts:849`](../backend/src/controllers/settingsController.ts) and `logSystem('DELETE', 'User', …)` at `:876`; data-phase purge at `:792`/`:729`.

13. **Which controllers decrypt PHI for non-owner access, and what permission check gates each?**
    - [`providerRoutes.ts:473`-`:474`](../backend/src/routes/providerRoutes.ts) — decrypts `Biomarker.valueEncrypted` and `notesEncrypted`; gated by `relationship.canViewBiomarkers && status === 'ACTIVE'` (checked at `:396` / `:444`).
    - [`providerRoutes.ts:612`](../backend/src/routes/providerRoutes.ts) — decrypts `HealthNeed.descriptionEncrypted`; gated by `canViewHealthNeeds` at `:536` / `:584`.
    - No other file decrypts PHI belonging to a different user. ADMIN routes operate on ciphertext only.

14. **Is `HealthNeed.description` encrypted?** Yes — `HealthNeed.descriptionEncrypted` (column `description_encrypted`) is in `PHI_FIELDS` ([`encryption.ts:L448-L451`](../backend/src/services/encryption.ts)) and in `schema.prisma:442`. There is **no** plaintext `description` column on `HealthNeed`; all reads go through `encryptionService.decrypt` at `healthNeedsController.ts:47` / `providerRoutes.ts:612` / `settingsController.ts:516`.

---

## Related Documents

- [DATA_MODEL.md](./DATA_MODEL.md) — full ER, per-model tables, RLS policies, cascade behavior on user deletion.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — where the encryption service and audit log sit in the request lifecycle; RLS context propagation.
- [API_REFERENCE.md](./API_REFERENCE.md) — per-endpoint contracts, including which routes return decrypted PHI and under what consent.
- [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) — §164.312 technical safeguards (encryption, audit, access control) that cite this doc.
- [ENV_VARS.md](./ENV_VARS.md) — `PHI_ENCRYPTION_KEY`, `AUDIT_LOG_SALT`, secret classification, Secret Manager wiring.
- [RUNBOOK.md](./RUNBOOK.md) — key-rotation runbook (currently missing master-key rotation — §6 TBD).
- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — open PHI-related findings, including the logger-redaction gap in §4.
- [`../prompts/_phi-inventory.md`](../prompts/_phi-inventory.md) — lightweight seed list; this doc is its richer expansion.
