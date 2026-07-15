# PHI Taxonomy — OwnMyHealth

> **Authoritative, citation-dense reference for every PHI field**: where each field is written, read, audited, redacted in logs, and whether another user (including a consented PROVIDER) can reach it.
>
> Generated at HEAD `fb2cd32` (2026-06-16). All counts re-verified against live code.

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](../prompts/_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](../prompts/_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](../prompts/_phi-inventory.md) — baseline canonical PHI list; this doc is its richer standalone expansion.

This doc must pass the five tests in `_doc-quality.md` (question-answering, path-and-line, snippet, diagram, reproducibility).

---

## 1. Purpose and scope

This document is the **standalone, retrieval-optimized expansion** of [`_phi-inventory.md`](../prompts/_phi-inventory.md). The inventory is the lightweight seed list (model → encrypted field names) inherited by security prompts; this taxonomy is the verified, per-field deep dive attached to the Claude Project as a substitute for the repo. For each PHI field it answers: **where is it encrypted, where is it decrypted, is the access audited, is it redacted in logs, and can a non-owner read it?**

Scope is the **39 application-PHI fields across 14 models** registered in the `PHI_FIELDS` constant (`backend/src/services/encryption.ts:476-562`). All 39 are AES-256-GCM ciphertext stored as `*Encrypted String` columns. The single source of truth is `PHI_FIELDS`; any `*Encrypted` column in `schema.prisma` not in `PHI_FIELDS` (or vice versa) is drift (§8).

| `_phi-inventory.md` | `PHI_TAXONOMY.md` (this doc) |
|---|---|
| Short reference, read-once | Full standalone doc, Claude-Project attached |
| Lists field names | Lists field × every site that touches it |
| Updated when schema changes | Regenerated per release |

---

## 2. Canonical model × field list

`PHI_FIELDS` (`encryption.ts:476-562`) groups **39 fields across 14 models**. Hand count: User 6 + Biomarker 2 + BiomarkerHistory 1 + UserFile 1 + InsurancePlan 2 + ProviderPatient 1 + HealthNeed 1 + HealthGoal 4 + GoalProgressHistory 2 + AuditLog 3 + ExpenseProjection 3 + ExpenseActual 8 + CostAnalysis 3 + LabConnection 2 = **39**. The schema has exactly 39 matching `Encrypted String` columns (Grep `Encrypted\s+String` over `backend/prisma/schema.prisma` → 39 hits) — perfect lockstep, no orphans in either direction.

```ts
// Source: backend/src/services/encryption.ts:476-485
export const PHI_FIELDS = {
  // User profile PHI
  User: [
    'firstNameEncrypted',
    'lastNameEncrypted',
    'dateOfBirthEncrypted',
    'phoneEncrypted',
    'addressEncrypted',
    'healthProfileEncrypted',
  ],
```

Every encrypted value is salted **per user**: the controller fetches the user's salt via `getUserEncryptionSalt(userId)` (`backend/src/services/userEncryption.ts:29`) and calls `getEncryptionService().encrypt(plaintext, userSalt)` / `.decrypt(ciphertext, userSalt)` (`encryption.ts:328`, `encryption.ts:353`). The **one exception** is `AuditLog`, which uses the process-wide `systemSalt` from `AUDIT_LOG_SALT` (`auditLog.ts:179,251`) so audit rows survive account deletion (§6).

Legend for the master table:
- **Audited on write/read?** = `file:line` of an `AuditLogService` helper (`auditService.logCreate/logUpdate/logDelete/logAccess/logExport`, obtained via `getAuditLogService(prisma)`), **not** a bare `auditLog.log(...)`.
- **Redacted in logger?** = the **lowercased** field name is in `SENSITIVE_FIELDS` (`backend/src/utils/logger.ts:30-41`); matching is case-insensitive via `key.toLowerCase()` (`logger.ts:76`).
- **Provider-accessible?** = a consented PROVIDER can read it through a `providerRoutes.ts` PHI route, gated by a `ProviderPatient` flag resolved in `resolveProviderAccess(tx, providerId, patientId, flag)` (`backend/src/services/providerAccess.ts:49`).

### Master PHI table

| Model | Field | Column (DB) | In `PHI_FIELDS`? | Write site(s) | Read site(s) | Audited on write? | Audited on read? | Redacted in logger? | Provider-accessible? | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **User** | `firstNameEncrypted` | `first_name_encrypted` (`schema.prisma:14`) | yes (`encryption.ts:479`) | `settingsController.updateProfile` `settingsController.ts:1135` | export `settingsController.ts:474`; profile `settingsController.ts:1157` | `logUpdate` `settingsController.ts:1164` | `logExport` `settingsController.ts:724` | **no** | no | — |
| **User** | `lastNameEncrypted` | `last_name_encrypted` (`schema.prisma:15`) | yes (`encryption.ts:480`) | `settingsController.updateProfile` `settingsController.ts:1139` | export `settingsController.ts:475` | `logUpdate` `settingsController.ts:1164` | `logExport` `settingsController.ts:724` | **no** | no | — |
| **User** | `dateOfBirthEncrypted` | `date_of_birth_encrypted` (`schema.prisma:16`) | yes (`encryption.ts:481`) | **none in `backend/src`** (drift §8.4) | export `settingsController.ts:476` | n/a | `logExport` `settingsController.ts:724` | **no** | no | No production write site — read-on-export only; see drift §8.4. |
| **User** | `phoneEncrypted` | `phone_encrypted` (`schema.prisma:17`) | yes (`encryption.ts:482`) | **none in `backend/src`** (drift §8.4) | export `settingsController.ts:477` | n/a | `logExport` `settingsController.ts:724` | **no** | no | Same as above. |
| **User** | `addressEncrypted` | `address_encrypted` (`schema.prisma:18`) | yes (`encryption.ts:483`) | **none in `backend/src`** (drift §8.4) | export `settingsController.ts:478` | n/a | `logExport` `settingsController.ts:724` | **partial** (`address` is in set, exact column name not) | no | Same as above. |
| **User** | `healthProfileEncrypted` | `health_profile_encrypted` (`schema.prisma:38`) | yes (`encryption.ts:484`) | `healthProfileService.saveHealthProfile` `healthProfileService.ts:102,107` | `healthProfileService.getHealthProfile` `healthProfileService.ts:62,73` | (onboarding/profile path) | (consumed by AI context) | **no** (drift §8.2) | no | Onboarding/health-profile JSON blob (migration `20260418_add_health_profile`). |
| **Biomarker** | `valueEncrypted` | `value_encrypted` (`schema.prisma:188`) | yes (`encryption.ts:488`) | `biomarkerController.createBiomarker` `biomarkerController.ts:272` | list `biomarkerController.ts:100`; provider `providerRoutes.ts:489` | `logCreate` `biomarkerController.ts:305` | `logAccess` `biomarkerController.ts:193` | **yes** (`valueencrypted` `logger.ts:35`) | **yes — `canViewBiomarkers`** | — |
| **Biomarker** | `notesEncrypted` | `notes_encrypted` (`schema.prisma:189`) | yes (`encryption.ts:489`) | `biomarkerController.createBiomarker` `biomarkerController.ts:273-275` | list `biomarkerController.ts:100-101`; provider `providerRoutes.ts:490` | `logCreate` `biomarkerController.ts:305` | `logAccess` `biomarkerController.ts:193` | **yes** (`noteencrypted` `logger.ts:36`) | **yes — `canViewBiomarkers`** | Provider reads notes via the biomarker route (`providerRoutes.ts:490`). |
| **BiomarkerHistory** | `valueEncrypted` | `value_encrypted` (`schema.prisma:223`) | yes (`encryption.ts:492`) | `biomarkerSeries.ts:128,160` (history append) | included with parent biomarker reads | via parent `logCreate` `biomarkerController.ts:305` | via parent `logAccess` `biomarkerController.ts:193` | **yes** (`valueencrypted` `logger.ts:35`) | yes (with parent) — `canViewBiomarkers` | No notes column by design (`encryption.ts:493`). |
| **UserFile** | `originalFilenameEncrypted` | `original_filename_encrypted` (`schema.prisma:164`) | yes (`encryption.ts:499`) | `sbcUploadController.ts:126`; `labUploadController` upload path; backfill `backfillUserFileNames.ts:85` | `decryptOriginalFilename` `userFileNames.ts:20`; callers `fileController.ts:89,172,258`, `settingsController.ts:651` | (file upload audit) | (file list/download audit) | **no** (drift §8.3) | no | L24 (migration `20260615_encrypt_userfile_original_filename`). Plaintext twin `originalFilename` being phased out; raw filename is a re-identification vector. |
| **InsurancePlan** | `memberIdEncrypted` | `member_id_encrypted` (`schema.prisma:240`) | yes (`encryption.ts:503`) | `insuranceController.ts:519-520` (create) | list `insuranceController.ts:430`; provider `providerRoutes.ts` insurance route | `logCreate` `insuranceController.ts:592` | `logAccess` `insuranceController.ts:457` | **yes** (`memberidencrypted` `logger.ts:35`) | **yes — `canViewInsurance`** | — |
| **InsurancePlan** | `groupIdEncrypted` | `group_id_encrypted` (`schema.prisma:241`) | yes (`encryption.ts:504`) | `insuranceController.ts:519-520` (create) | list `insuranceController.ts:430` | `logCreate` `insuranceController.ts:592` | `logAccess` `insuranceController.ts:457` | **yes** (`groupidencrypted` `logger.ts:35`) | **yes — `canViewInsurance`** | `InsuranceBenefit` holds **no** `*Encrypted` columns (confirmed — not member/group IDs). |
| **ProviderPatient** | `notesEncrypted` | `notes_encrypted` (`schema.prisma:137`) | yes (`encryption.ts:508`) | `providerRoutes.ts:242` (encrypt) → `:279,284` (write) | **no decrypt-for-display site** in `backend/src` | `logAccess('provider_patient_request', …)` `providerRoutes.ts:213,223` | n/a | **no** | no | Provider-authored access-request message, encrypted with the **provider's own salt** (`providerRoutes.ts:241-242`); write-only today (§8.5). |
| **HealthNeed** | `descriptionEncrypted` | `description_encrypted` (`schema.prisma:430`) | yes (`encryption.ts:512`) | `healthNeedsController.createNeed` `healthNeedsController.ts:201` | list `healthNeedsController.ts:66`; provider `providerRoutes.ts:571` | `logCreate` `healthNeedsController.ts:222` | `logAccess` `healthNeedsController.ts:133` | **yes** (`descriptionencrypted` `logger.ts:36`) | **yes — `canViewHealthNeeds`** | — |
| **HealthGoal** | `descriptionEncrypted` | `description_encrypted` (`schema.prisma:449`) | yes (`encryption.ts:517`) | `healthGoalsController.createGoal` `healthGoalsController.ts:384` | list `healthGoalsController.ts:234` | `logCreate` `healthGoalsController.ts:456` | `logAccess` `healthGoalsController.ts:282` | **yes** (`descriptionencrypted` `logger.ts:36`) | no | — |
| **HealthGoal** | `targetValueEncrypted` | `target_value_encrypted` (`schema.prisma:461`) | yes (`encryption.ts:518`) | `healthGoalsController.ts:384` (create) | decrypt helper `healthGoalsController.ts:37` | `logCreate` `healthGoalsController.ts:456` | `logAccess` `healthGoalsController.ts:282` | **no** (`targetvalueencrypted` not in set) | no | Migration `20260420_encrypt_health_goal_target`. Plaintext Decimal twin `targetValue` NOT in `PHI_FIELDS` (legacy). |
| **HealthGoal** | `currentValueEncrypted` | `current_value_encrypted` (`schema.prisma:467`) | yes (`encryption.ts:519`) | `healthGoalsController.ts:384` (create) | decrypt helper `healthGoalsController.ts:37` | `logCreate` `healthGoalsController.ts:456` | `logAccess` `healthGoalsController.ts:282` | **no** | no | M4 (`20260613_encrypt_goal_values`). Plaintext twin `currentValue` legacy. |
| **HealthGoal** | `startValueEncrypted` | `start_value_encrypted` (`schema.prisma:470`) | yes (`encryption.ts:520`) | `healthGoalsController.ts:384` (create) | decrypt helper `healthGoalsController.ts:37` | `logCreate` `healthGoalsController.ts:456` | `logAccess` `healthGoalsController.ts:282` | **no** | no | M4. Plaintext twin `startValue` legacy. |
| **GoalProgressHistory** | `noteEncrypted` | `note_encrypted` (`schema.prisma:506`) | yes (`encryption.ts:523`) | `healthGoalsController.ts` progress path | `healthGoalsController.ts` progress read | `logUpdate` `healthGoalsController.ts:553,668` | `logAccess` `healthGoalsController.ts:793,884` | **yes** (`noteencrypted` `logger.ts:36`) | no | — |
| **GoalProgressHistory** | `valueEncrypted` | `value_encrypted` (`schema.prisma:504`) | yes (`encryption.ts:524`) | `healthGoalsController.ts` progress path | `healthGoalsController.ts` progress read | `logUpdate` `healthGoalsController.ts:553` | `logAccess` `healthGoalsController.ts:793` | **yes** (`valueencrypted` `logger.ts:35`) | no | M4. Plaintext twin `value` legacy. |
| **AuditLog** | `previousValueEncrypted` | `previous_value_encrypted` (`schema.prisma:525`) | yes (`encryption.ts:528`) | `auditLog.ts:299,309` (system salt) | `auditLog.ts` admin viewer | n/a (is the audit itself) | n/a | **no** | no (ADMIN only) | Encrypted with `systemSalt` (`auditLog.ts:251`). |
| **AuditLog** | `newValueEncrypted` | `new_value_encrypted` (`schema.prisma:526`) | yes (`encryption.ts:529`) | `auditLog.ts:300,310` (system salt) | `auditLog.ts` admin viewer | n/a | n/a | **no** | no (ADMIN only) | Encrypted with `systemSalt`. |
| **AuditLog** | `metadataEncrypted` | `metadata_encrypted` (`schema.prisma:533`) | yes (`encryption.ts:530`) | `auditLog.ts:301,314` (system salt) | `auditLog.decryptMetadata` `auditLog.ts:275-278` | n/a | n/a | **no** (drift §8.1) | no (ADMIN only) | M6. Legacy plaintext `metadata` column **dropped** in `20260615_drop_legacy_audit_metadata`. |
| **ExpenseProjection** | `serviceTypeEncrypted` | `service_type` (`schema.prisma:681`) | yes (`encryption.ts:534`) | `expenseController.ts:136` | `expenseController.ts:154` | `logCreate` `expenseController.ts:146` | `logAccess` `expenseController.ts:209` | **no** | no | Column is `@map("service_type")` (name doesn't carry `_encrypted`). |
| **ExpenseProjection** | `estimatedCostEncrypted` | `estimated_cost` (`schema.prisma:682`) | yes (`encryption.ts:535`) | `expenseController.ts:137` | `expenseController.ts:155` | `logCreate` `expenseController.ts:146` | `logAccess` `expenseController.ts:209` | **no** | no | Monetary PHI stored as ciphertext string, not Decimal. |
| **ExpenseProjection** | `notesEncrypted` | `notes` (`schema.prisma:685`) | yes (`encryption.ts:536`) | `expenseController.ts:140` | `expenseController.ts:156` | `logCreate` `expenseController.ts:146` | `logAccess` `expenseController.ts:209` | **no** | no | — |
| **ExpenseActual** | `serviceTypeEncrypted` | `service_type` (`schema.prisma:704`) | yes (`encryption.ts:539`) | `expenseController.ts:443` | `expenseController.ts:355` | `logCreate` `expenseController.ts:462` | `logAccess` `expenseController.ts:509` | **no** | no | — |
| **ExpenseActual** | `providerNameEncrypted` | `provider_name` (`schema.prisma:705`) | yes (`encryption.ts:540`) | `expenseController.ts:445` | export `settingsController.ts:629` | `logCreate` `expenseController.ts:462` | `logAccess` `expenseController.ts:509` | **no** (drift) | no | Provider name is a strong identifier; not log-redacted. |
| **ExpenseActual** | `billedAmountEncrypted` | `billed_amount` (`schema.prisma:707`) | yes (`encryption.ts:541`) | `expenseController.ts:428,453` | `expenseController.ts:382` | `logCreate` `expenseController.ts:462` | `logAccess` `expenseController.ts:509` | **no** | no | — |
| **ExpenseActual** | `insurancePaidEncrypted` | `insurance_paid` (`schema.prisma:708`) | yes (`encryption.ts:542`) | `expenseController.ts:428` | `expenseController.ts:382` | `logCreate` `expenseController.ts:462` | `logAccess` `expenseController.ts:509` | **no** | no | — |
| **ExpenseActual** | `patientPaidEncrypted` | `patient_paid` (`schema.prisma:709`) | yes (`encryption.ts:543`) | `expenseController.ts:428` | `expenseController.ts:382` | `logCreate` `expenseController.ts:462` | `logAccess` `expenseController.ts:509` | **no** | no | — |
| **ExpenseActual** | `appliedToDeductibleEncrypted` | `applied_to_deductible` (`schema.prisma:710`) | yes (`encryption.ts:544`) | `expenseController.ts:428` | `expenseController.ts:382` | `logCreate` `expenseController.ts:462` | `logAccess` `expenseController.ts:509` | **no** | no | — |
| **ExpenseActual** | `appliedToOopEncrypted` | `applied_to_oop` (`schema.prisma:711`) | yes (`encryption.ts:545`) | `expenseController.ts:428` | `expenseController.ts:382` | `logCreate` `expenseController.ts:462` | `logAccess` `expenseController.ts:509` | **no** | no | — |
| **ExpenseActual** | `notesEncrypted` | `notes` (`schema.prisma:714`) | yes (`encryption.ts:546`) | `expenseController.ts:453` | `expenseController.ts:355` | `logCreate` `expenseController.ts:462` | `logAccess` `expenseController.ts:509` | **no** | no | — |
| **CostAnalysis** | `claudeResponseEncrypted` | `claude_response_encrypted` (`schema.prisma:737`) | yes (`encryption.ts:552`) | `expenseController.ts:801` | `expenseController.ts:866`; export `settingsController.ts` | `logCreate` `expenseController.ts:812` | `logAccess` `expenseController.ts:874` | **yes** (`clauderesponseencrypted` `logger.ts:39`) | no | Renamed from `claudeResponse` in `20260424_align_uuid_defaults_and_rename_claude_response`. |
| **CostAnalysis** | `totalProjectedOopEncrypted` | `total_projected_oop` (`schema.prisma:738`) | yes (`encryption.ts:553`) | `expenseController.ts:803` | `expenseController.ts:860` | `logCreate` `expenseController.ts:812` | `logAccess` `expenseController.ts:874` | **no** | no | — |
| **CostAnalysis** | `projectedExpensesSnapshotEncrypted` | `projected_expenses_snapshot` (`schema.prisma:740`) | yes (`encryption.ts:554`) | `expenseController.ts:806` | `expenseController.ts` analysis read | `logCreate` `expenseController.ts:812` | `logAccess` `expenseController.ts:874` | **no** | no | JSON snapshot of decrypted projections. |
| **LabConnection** | `accessTokenEncrypted` | `access_token_encrypted` (`schema.prisma:763`) | yes (`encryption.ts:559`) | `labSyncService.ts:151` → `:161,170,247` | `labSyncService.ts:222,456` | (FHIR connect path) | (sync path) | **partial** (`accesstoken`/`access_token` in set, not `accesstokenencrypted`) (drift §8.6) | **no — user-scoped only** | SMART-on-FHIR OAuth token; stolen token = direct path to live PHI at Quest. |
| **LabConnection** | `refreshTokenEncrypted` | `refresh_token_encrypted` (`schema.prisma:764`) | yes (`encryption.ts:560`) | `labSyncService.ts:152` → `:162,171,248` | `labSyncService.ts:223,242` | (FHIR connect path) | (refresh path) | **partial** (`refreshtoken`/`refresh_token` in set, not `refreshtokenencrypted`) (drift §8.6) | **no — user-scoped only** | Same risk class as access token. |

---

## 3. Per-field deep dives

Grouped by model. Each entry gives the column, encryption site, decryption site(s), audit coverage, logger-redaction status, and cross-user exposure. The general API is `getEncryptionService().encrypt(plaintext, userSalt)` / `.decrypt(ciphertext, userSalt)` — there is **no** `encryptPHI(userId, plaintext)` helper.

### User

#### `User.firstNameEncrypted` / `User.lastNameEncrypted`

- **Columns**: `first_name_encrypted` (`schema.prisma:14`), `last_name_encrypted` (`schema.prisma:15`).
- **Encryption site**: `settingsController.updateProfile` — `backend/src/controllers/settingsController.ts:1135,1139`.
- **Decryption sites**: profile read `settingsController.ts:1157`; data export `settingsController.ts:474-475`; admin/provider listings via `settingsController.ts:364`.
- **Audit**: write — `auditService.logUpdate('User', userId, …)` `settingsController.ts:1164`; export — `auditService.logExport('UserData', …)` `settingsController.ts:724`.
- **Logger redaction**: **no** — neither `firstnameencrypted` nor `lastnameencrypted` is in `SENSITIVE_FIELDS` (drift §8.2).
- **Provider exposure**: no (provider patient-detail returns identity from a separate non-PHI projection, not these columns).

```ts
// Source: backend/src/controllers/settingsController.ts:1134-1141
if (firstName !== undefined) {
  updateData.firstNameEncrypted = firstName ? encryptionService.encrypt(firstName, userSalt) : null;
  fieldsUpdated.push('firstName');
}
if (lastName !== undefined) {
  updateData.lastNameEncrypted = lastName ? encryptionService.encrypt(lastName, userSalt) : null;
  fieldsUpdated.push('lastName');
}
```

#### `User.dateOfBirthEncrypted` / `phoneEncrypted` / `addressEncrypted`

- **Columns**: `date_of_birth_encrypted` (`:16`), `phone_encrypted` (`:17`), `address_encrypted` (`:18`).
- **Encryption site**: **none in `backend/src`** — `updateProfile` only writes first/last name (`settingsController.ts:1131`, type `{ firstNameEncrypted?; lastNameEncrypted? }`). Grep `dateOfBirthEncrypted|phoneEncrypted|addressEncrypted` over `backend/src/**/*.ts` returns only the select+decrypt sites and test fixtures.
- **Decryption sites**: data export `settingsController.ts:476-478`.
- **Audit**: export — `logExport` `settingsController.ts:724`. No write audit (no write).
- **Logger redaction**: `address`, `dateofbirth` partially match (`logger.ts:37`) but the exact `*Encrypted` keys are absent; `phoneencrypted` is absent (`phonenumber` is present at `logger.ts:37`, not `phoneencrypted`).
- **Provider exposure**: no.
- **Finding**: defined in schema + `PHI_FIELDS` but never written by production code — see drift §8.4.

#### `User.healthProfileEncrypted`

- **Column**: `health_profile_encrypted` (`schema.prisma:38`) — onboarding/health-profile JSON blob (migration `20260418_add_health_profile`).
- **Encryption site**: `healthProfileService.saveHealthProfile` — `backend/src/services/healthProfileService.ts:102,107`.
- **Decryption site**: `healthProfileService.getHealthProfile` — `healthProfileService.ts:62,73`; consumed by AI health-context.
- **Logger redaction**: **no** — `healthprofileencrypted` is absent from `SENSITIVE_FIELDS` (drift §8.2). The blob can carry rich free-text PHI.
- **Provider exposure**: no.

```ts
// Source: backend/src/services/healthProfileService.ts:62-73
select: { healthProfileEncrypted: true },
...
if (!user?.healthProfileEncrypted) { ... }
const json = encryption.decrypt(user.healthProfileEncrypted, salt);
```

### Biomarker / BiomarkerHistory

#### `Biomarker.valueEncrypted`

- **Column**: `value_encrypted` — `backend/prisma/schema.prisma:188`.
- **Encryption site**: `biomarkerController.createBiomarker` — `biomarkerController.ts:272`.
- **Decryption sites**: `toResponse`/list & get `biomarkerController.ts:100`; provider path `providerRoutes.ts:489` (gated by `canViewBiomarkers`, decrypted with the **patient's** salt).
- **Audit**: write — `auditService.logCreate(RESOURCE_TYPE, biomarker.id, …)` `biomarkerController.ts:305`; read — `auditService.logAccess(RESOURCE_TYPE, undefined, …)` `biomarkerController.ts:193`; provider read — `logAccess('patient_biomarkers', …)` `providerRoutes.ts:468,507`.
- **Logger redaction**: `valueencrypted` in `SENSITIVE_FIELDS` `logger.ts:35`.
- **Provider exposure**: yes via `ProviderPatient.canViewBiomarkers`.

```ts
// Source: backend/src/controllers/biomarkerController.ts:271-275
// Encrypt PHI fields
const valueEncrypted = encryptionService.encrypt(String(input.value), userSalt);
const notesEncrypted = input.notes
  ? encryptionService.encrypt(input.notes, userSalt)
  : null;
```

```ts
// Source: backend/src/routes/providerRoutes.ts:489-490
value: parseFloat(encryptionService.decrypt(b.valueEncrypted, patientSalt)),
notes: b.notesEncrypted ? encryptionService.decrypt(b.notesEncrypted, patientSalt) : undefined,
```

#### `Biomarker.notesEncrypted`

Same write/read/audit as `valueEncrypted` (created together at `biomarkerController.ts:273`, updated at `:366,539`). Redacted via `noteencrypted` (`logger.ts:36`). Provider-readable via `canViewBiomarkers` (`providerRoutes.ts:490`).

#### `BiomarkerHistory.valueEncrypted`

- **Column**: `value_encrypted` (`schema.prisma:223`).
- **Write site**: history rows appended by `biomarkerSeries.ts:128,160` (series consolidation); the value carries the parent reading's `valueEncrypted`.
- **No notes column** by design (`encryption.ts:493`).
- Audit/redaction inherit from the parent biomarker (`logger.ts:35`).

### UserFile

#### `UserFile.originalFilenameEncrypted`

- **Column**: `original_filename_encrypted` (`schema.prisma:164`) — L24 (migration `20260615_encrypt_userfile_original_filename`).
- **Encryption sites**: SBC upload `sbcUploadController.ts:126` (`encryptionService.encrypt(file.originalname, userSalt)` + null plaintext at `:125`); lab upload path; legacy backfill `backfillUserFileNames.ts:85`.
- **Decryption site**: helper `decryptOriginalFilename(file, encryption, userSalt)` — `backend/src/utils/userFileNames.ts:13-26`; callers `fileController.ts:89,172,258` and `settingsController.ts:651`. The helper decrypts the twin when present, falling back to legacy plaintext on absence or decrypt failure so one bad row can't blow up a list.
- **Logger redaction**: **no** — `originalfilenameencrypted` absent from `SENSITIVE_FIELDS` (drift §8.3).
- **Provider exposure**: no.
- **Risk**: the raw client filename can embed identifiers ("Jane Doe MRI.pdf") — a stolen filename is a re-identification vector. Plaintext twin `originalFilename` (`schema.prisma:163`) is deliberately **not** in `PHI_FIELDS` (legacy, backfill + follow-up drop pending). Server-generated `filename` storage key is intentionally plaintext non-PHI.

```ts
// Source: backend/src/utils/userFileNames.ts:18-25
if (file.originalFilenameEncrypted) {
  try {
    return encryption.decrypt(file.originalFilenameEncrypted, userSalt);
  } catch {
    return file.originalFilename ?? '';
  }
}
return file.originalFilename ?? '';
```

### InsurancePlan

#### `InsurancePlan.memberIdEncrypted` / `groupIdEncrypted`

- **Columns**: `member_id_encrypted` (`:240`), `group_id_encrypted` (`:241`).
- **Encryption site**: `insuranceController.createPlan` — `insuranceController.ts:519-520` (salt fetched at `:516`).
- **Decryption sites**: list/get `insuranceController.ts:430`; provider insurance route (gated `canViewInsurance`, decrypted with patient salt) `providerRoutes.ts:611,624`.
- **Audit**: write — `logCreate` `insuranceController.ts:592`; read — `logAccess` `insuranceController.ts:457`; provider read — `logAccess('patient_insurance', …)` `providerRoutes.ts:624,640`.
- **Logger redaction**: `memberidencrypted`, `groupidencrypted` in set (`logger.ts:35`).
- **Provider exposure**: yes via `ProviderPatient.canViewInsurance` (route added M3).
- **Note**: `InsuranceBenefit` (`schema.prisma:402`) holds **no** `*Encrypted` columns — benefit data is plaintext metadata, not member/group IDs.

### ProviderPatient

#### `ProviderPatient.notesEncrypted`

- **Column**: `notes_encrypted` (`schema.prisma:137`).
- **Encryption site**: `providerRoutes.ts:242` — encrypted with the **provider's** salt (`getUserEncryptionSalt(providerId)` `:241`), written on access request at `:279,284`.
- **Decryption site**: **none in `backend/src`** — no route decrypts this back for display today.
- **Access**: **provider-authored, write-only**. It is the provider's free-text access-request message, not a patient note about the provider, and not shared to the patient. See drift §8.5.
- **Logger redaction**: **no** (`notesencrypted` not in set; only `noteencrypted` singular at `logger.ts:36`).

```ts
// Source: backend/src/routes/providerRoutes.ts:238-242
let encryptedNotes: string | null = null;
if (message && message.trim()) {
  const encryptionService = getEncryptionService();
  const providerSalt = await getUserEncryptionSalt(providerId);
  encryptedNotes = encryptionService.encrypt(message, providerSalt);
}
```

### HealthNeed

#### `HealthNeed.descriptionEncrypted`

- **Column**: `description_encrypted` (`schema.prisma:430`).
- **Encryption site**: `healthNeedsController.createNeed` — `healthNeedsController.ts:201`.
- **Decryption sites**: list `healthNeedsController.ts:66`; provider path `providerRoutes.ts:571` (gated `canViewHealthNeeds`, patient salt).
- **Audit**: write — `logCreate` `healthNeedsController.ts:222`; read — `logAccess` `healthNeedsController.ts:133`; provider read — `logAccess('patient_health_needs', …)` `providerRoutes.ts:551,581`.
- **Logger redaction**: `descriptionencrypted` in set (`logger.ts:36`).
- **Provider exposure**: yes via `canViewHealthNeeds`.

### HealthGoal / GoalProgressHistory

#### `HealthGoal.descriptionEncrypted` / `targetValueEncrypted` / `currentValueEncrypted` / `startValueEncrypted`

- **Columns**: `description_encrypted` (`:449`), `target_value_encrypted` (`:461`), `current_value_encrypted` (`:467`), `start_value_encrypted` (`:470`).
- **Encryption site**: `healthGoalsController.createGoal` — `healthGoalsController.ts:384`.
- **Decryption**: numeric values via the decrypt helper at `healthGoalsController.ts:37` (`parseFloat(getEncryptionService().decrypt(encrypted, userSalt))`); descriptions in list `:234`.
- **Audit**: write — `logCreate` `healthGoalsController.ts:456`; update — `logUpdate` `:553,668`; read — `logAccess` `:282,884`.
- **Logger redaction**: `descriptionencrypted` redacted (`logger.ts:36`); the three numeric `*ValueEncrypted` keys are **not** in `SENSITIVE_FIELDS` (the generic `value`/`valueencrypted` won't match `targetvalueencrypted`).
- **Provider exposure**: no (no provider goals route).
- **Note**: plaintext Decimal twins `targetValue` (`:455`), `currentValue` (`:462`), `startValue` (`:468`) are legacy back-compat, **not** in `PHI_FIELDS`; read path prefers the encrypted twin. `targetValueEncrypted` from `20260420_encrypt_health_goal_target`; `current/startValueEncrypted` from M4 `20260613_encrypt_goal_values`.

```ts
// Source: backend/src/controllers/healthGoalsController.ts:37
return parseFloat(getEncryptionService().decrypt(encrypted, userSalt));
```

#### `GoalProgressHistory.noteEncrypted` / `valueEncrypted`

- **Columns**: `note_encrypted` (`:506`), `value_encrypted` (`:504`).
- **Write/read**: goal-progress endpoints in `healthGoalsController.ts`; audit via `logUpdate` `:553` and `logAccess` `:793,884`.
- **Logger redaction**: `noteencrypted` (`logger.ts:36`) and `valueencrypted` (`logger.ts:35`) both redacted.
- **Note**: `valueEncrypted` is M4; plaintext twin `value` (`:503`) legacy, not in `PHI_FIELDS`.

### AuditLog (encrypted with the system salt)

#### `AuditLog.previousValueEncrypted` / `newValueEncrypted` / `metadataEncrypted`

- **Columns**: `previous_value_encrypted` (`:525`), `new_value_encrypted` (`:526`), `metadata_encrypted` (`:533`).
- **Encryption site**: `AuditLogService.encryptValue` → `getEncryptionService().encrypt(stringValue, this.systemSalt)` (`auditLog.ts:251`), called at `auditLog.ts:299-301`. **Uses the process-wide `systemSalt` (from `AUDIT_LOG_SALT`), not the per-user salt** (`auditLog.ts:179`) — so audit rows remain decryptable after the user (and their per-user salt) is deleted.
- **Decryption site**: `AuditLogService.decryptMetadata` `auditLog.ts:275-278` (admin audit viewer); previous/new values decrypted in the same admin path.
- **Logger redaction**: `metadataencrypted` is **not** in `SENSITIVE_FIELDS` (drift §8.1); `previousvalueencrypted`/`newvalueencrypted` also absent.
- **Provider exposure**: no — ADMIN-only via the audit viewer.
- **Note**: M6 — the legacy plaintext `metadata` column was **irreversibly dropped** in `20260615_drop_legacy_audit_metadata` (DDL, because `audit_logs` is immutable-by-RLS). Do not list a plaintext `metadata` column.

```ts
// Source: backend/src/services/auditLog.ts:299-314
const previousValueEncrypted = this.encryptValue(entry.previousValue);
const newValueEncrypted = this.encryptValue(entry.newValue);
const metadataEncrypted = this.encryptValue(entry.metadata);
...
  previousValueEncrypted,
  newValueEncrypted,
...
  metadataEncrypted,
```

### ExpenseProjection / ExpenseActual / CostAnalysis

All monetary PHI is stored as **encrypted strings, not Decimal** (migration `20260206_fix_expense_encryption_types`). Note the DB column names use `@map` to friendly names (`service_type`, `billed_amount`, …) — the column name does **not** advertise ciphertext for these, which is why none match logger-redaction keys.

#### `ExpenseActual` — 8 fields

- **Encryption sites**: `expenseController.ts:428` (`encStr` helper for monetary fields), `:443,445,453` (create).
- **Decryption sites**: `expenseController.ts:355,382`; export `settingsController.ts:629`.
- **Audit**: write — `logCreate` `expenseController.ts:462`; update — `logUpdate` `:588`; read — `logAccess` `:509`.
- **`providerNameEncrypted`** is a strong identifier and is **not** log-redacted — see drift §8 table.

```ts
// Source: backend/src/controllers/expenseController.ts:428
v === undefined || v === null ? null : encryption.encrypt(v.toString(), userSalt);
```

#### `CostAnalysis.claudeResponseEncrypted` / `totalProjectedOopEncrypted` / `projectedExpensesSnapshotEncrypted`

- **Encryption site**: `expenseController.ts:801-806` (Claude cost-analysis write).
- **Decryption site**: `expenseController.ts:860,866`; export in `settingsController.ts`.
- **Audit**: write — `logCreate` `expenseController.ts:812`; read — `logAccess` `:874`.
- **Logger redaction**: only `claudeResponseEncrypted` is covered (`clauderesponseencrypted` `logger.ts:39`); the two monetary fields are not.

```ts
// Source: backend/src/controllers/expenseController.ts:801-806
claudeResponseEncrypted: encryption.encrypt(claudeResponse, userSalt),
totalProjectedOopEncrypted: totalProjectedOop
  ? encryption.encrypt(totalProjectedOop.toString(), userSalt)
  : null,
projectedExpensesSnapshotEncrypted: encryption.encrypt(JSON.stringify(decryptedProjections), userSalt),
```

### LabConnection (SMART-on-FHIR OAuth tokens)

#### `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted`

- **Columns**: `access_token_encrypted` (`:763`), `refresh_token_encrypted` (`:764`).
- **Encryption site**: `labSyncService.ts:151-152` — `encryption.encrypt(tokenSet.accessToken, salt)` with the **user's** salt (`getUserEncryptionSalt(userId)` `:150`), written via upsert at `:161-162,170-171`; refreshed-token rewrite at `:247-248`.
- **Decryption sites**: `labSyncService.ts:222-224` (sync) and `:456` (refresh path).
- **Access scope**: **user-scoped only — never provider-shared.** No `providerRoutes` path reads `LabConnection`; the only readers are the user's own FHIR sync/refresh in `services/fhir/`.
- **Logger redaction**: **partial** — generic `accesstoken`/`access_token`/`refreshtoken`/`refresh_token` are in the set (`logger.ts:31,33`) but the exact column names `accesstokenencrypted`/`refreshtokenencrypted` are **not** (drift §8.6).
- **Risk**: top-tier — a stolen access token is a direct path to live PHI at Quest/LabCorp. The OAuth handshake itself is `services/fhir/smartAuth.ts`; SSRF allowlist in `services/fhir/urlSafety.ts`.

```ts
// Source: backend/src/services/fhir/labSyncService.ts:149-152
const encryption = getEncryptionService();
const salt = await getUserEncryptionSalt(userId);
const accessEnc = encryption.encrypt(tokenSet.accessToken, salt);
const refreshEnc = tokenSet.refreshToken ? encryption.encrypt(tokenSet.refreshToken, salt) : null;
```

---

## 4. Logger redaction coverage

`SENSITIVE_FIELDS` is a `Set` (`backend/src/utils/logger.ts:30-41`); lookup lowercases keys (`logger.ts:76`), so every entry **must** be lowercase. The recursive sanitizer (`sanitizeValue`/`sanitizeData` `logger.ts:57-83`) walks arrays element-by-element (F-21 fix) with an 8-deep cap and a `seen` cycle guard.

```ts
// Source: backend/src/utils/logger.ts:30-41
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'accesstoken', 'refreshtoken', 'secret',
  'access_token', 'refresh_token', 'authorization', 'cookie',
  'ssn', 'socialsecuritynumber', 'memberid', 'groupnumber',
  'memberidencrypted', 'groupidencrypted', 'valueencrypted',
  'descriptionencrypted', 'noteencrypted', 'genotype',
  'email', 'phonenumber', 'address', 'dateofbirth',
  'responsetext', 'jsontext', 'clauderesponseencrypted', 'guidance',
  'extracteddata', 'pdftext', 'pdfcontent', 'biomarker',
]);
```

### Coverage matrix (PHI key vs `SENSITIVE_FIELDS`)

| PHI `*Encrypted` key | In `PHI_FIELDS`? | In `SENSITIVE_FIELDS`? | Risk |
|---|---|---|---|
| `valueencrypted` | yes | yes (`logger.ts:35`) | — |
| `noteencrypted` | yes (Goal) | yes (`logger.ts:36`) | — |
| `descriptionencrypted` | yes | yes (`logger.ts:36`) | — |
| `memberidencrypted` / `groupidencrypted` | yes | yes (`logger.ts:35`) | — |
| `clauderesponseencrypted` | yes | yes (`logger.ts:39`) | — (do **not** flag as drift) |
| `notesencrypted` (Biomarker/Expense/Provider) | yes | **no** | only singular `noteencrypted` is in the set — plural keys never match |
| `originalfilenameencrypted` (UserFile) | yes | **no** | filename PHI could leak into logs — §8.3 |
| `metadataencrypted` (AuditLog) | yes | **no** | §8.1 |
| `healthprofileencrypted` (User) | yes | **no** | rich free-text PHI blob — §8.2 |
| `firstnameencrypted`/`lastnameencrypted` | yes | **no** | identity PHI not redacted by exact name |
| `targetvalueencrypted`/`currentvalueencrypted`/`startvalueencrypted` | yes | **no** | numeric goal PHI |
| `accesstokenencrypted`/`refreshtokenencrypted` | yes | **no (exact)** | only generic `accesstoken`/`access_token` match — §8.6 |
| `providernameencrypted` + monetary expense keys | yes | **no** | provider name + amounts |
| `genotype` | **no (model removed)** | yes (`logger.ts:36`) | **stale** — DNA model dropped in `20260423_drop_dna_genetics`; remove from set |

**Why most gaps are low-severity but non-zero**: the values stored in these columns are already AES-256-GCM ciphertext, so logging the *column* leaks ciphertext, not plaintext. The real exposure is logging the *decrypted* response object — which is mitigated because the decrypted output property names (`value`, `notes`, `firstName`, etc.) are partially covered (`address`, `dateofbirth`, `phonenumber`, `guidance`, `responsetext`, `biomarker`). Still, the `*Encrypted` column names should be added for defense-in-depth, and `notesencrypted` (plural) is a clear miss given `noteencrypted` (singular) is present.

---

## 5. Audit log coverage

All PHI controllers route audit through the `AuditLogService` helpers obtained via `getAuditLogService(prisma)`: `logCreate`/`logUpdate`/`logDelete`/`logAccess`/`logExport`. `logAccess` maps to `AuditAction.READ` (`auditLog.ts:383`); `logExport` to `EXPORT`. The `AuditAction` enum (`schema.prisma:652-671`) includes `READ, VIEW, EXPORT, CREATE, UPDATE, DELETE, PHI_ACCESS, PHI_EXPORT, PHI_DECRYPT, …`.

```mermaid
sequenceDiagram
  participant C as Client/Provider
  participant Ctl as Controller / providerRoutes
  participant Enc as EncryptionService
  participant DB as Postgres (RLS)
  participant AL as AuditLogService
  C->>Ctl: request (cookie: access)
  Ctl->>Enc: encrypt(plaintext, userSalt) / decrypt(ct, salt)
  Ctl->>DB: withRLSContext(userId, tx => create/findMany)
  DB-->>Ctl: rows (PHI ciphertext)
  Ctl->>AL: logCreate / logAccess / logExport (READ/EXPORT)
  AL->>Enc: encrypt(prev/new/metadata, systemSalt)
  AL->>DB: audit_logs.create (system salt; 7-yr retention)
  Ctl-->>C: 200 { decrypted PHI }
```

### Per-model audit coverage (write vs read)

| Model | Audited on write | Audited on read | Source |
|---|---|---|---|
| Biomarker | yes — `logCreate` | yes — `logAccess` | `biomarkerController.ts:305` / `:193` |
| HealthNeed | yes — `logCreate` | yes — `logAccess` | `healthNeedsController.ts:222` / `:133` |
| HealthGoal | yes — `logCreate`/`logUpdate` | yes — `logAccess` | `healthGoalsController.ts:456,553` / `:282` |
| InsurancePlan | yes — `logCreate` | yes — `logAccess` | `insuranceController.ts:592` / `:457` |
| ExpenseProjection | yes — `logCreate` | yes — `logAccess` | `expenseController.ts:146` / `:209` |
| ExpenseActual | yes — `logCreate`/`logUpdate` | yes — `logAccess` | `expenseController.ts:462,588` / `:509` |
| CostAnalysis | yes — `logCreate` | yes — `logAccess` | `expenseController.ts:812` / `:874` |
| User profile | yes — `logUpdate`/`logExport` | yes — `logExport` | `settingsController.ts:1163,724` |
| UserFile | yes (upload path) | yes (list/download path) | `fileController.ts`, upload controllers |
| Provider PHI reads | n/a (read-only) | yes — `logAccess('patient_*', …)` | `providerRoutes.ts:468,551,624` |
| LabConnection tokens | (FHIR connect) | (sync/refresh) | `labSyncService.ts` |

Account deletion is audited with `logDelete('UserData', …)` before the cascade (`settingsController.ts:1008,1038`), and bulk data-reset with `logDelete` (`settingsController.ts:830,914`). See §6 / §8.4 for write-audit drift on the unwritten User fields.

---

## 6. Encryption key lifecycle

```
                 PHI_ENCRYPTION_KEY (64 hex → 32-byte master key)   [env]
                          │  validateEncryptionKey()  encryption.ts:182-216
                          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ EncryptionService (singleton)                                  │
   │  masterKey: Buffer                                             │
   │  encryptWithMasterKey()  ── wraps the per-user salt           │
   │  deriveUserKey(salt) = pbkdf2(masterKey, salt, SHA512)        │  encryption.ts:236-265
   │  encrypt(plaintext, userSalt) / decrypt(ct, userSalt)        │  encryption.ts:328 / :353
   └──────────────────────────────────────────────────────────────┘
                          ▲
                          │ userSalt (hex)
   ┌──────────────────────┴───────────────────────────────────────┐
   │ getUserEncryptionSalt(userId)  userEncryption.ts:29           │
   │  admin-context lookup of UserEncryptionKey (active, vN)       │
   │  encryptedKey = encryptWithMasterKey(salt) stored at rest    │  userEncryption.ts:49,55,62
   └──────────────────────────────────────────────────────────────┘
```

- **Master key**: `PHI_ENCRYPTION_KEY` — 64 hex chars (32 bytes), validated for length/hex/placeholder at boot (`encryption.ts:182,206-216`; required in prod/staging via `config/index.ts:428`).
- **Per-user key derivation**: `deriveUserKey(userSalt) = crypto.pbkdf2Sync(masterKey, userSalt, iterations, 32, 'sha512')` (`encryption.ts:247-253`), with a bounded LRU key cache (`:236-266`). `decrypt` retries with `PBKDF2_ITERATIONS_LEGACY` for older rows (`encryption.ts:372-375`).
- **Salt storage**: each user's salt lives in `UserEncryptionKey` (`schema.prisma:108`), **itself encrypted** with the master key via `encryptWithMasterKey` before storage (`userEncryption.ts:55,62`); read back with `decryptWithMasterKey` (`userEncryption.ts:49`).

```ts
// Source: backend/src/services/encryption.ts:247-253
const derived = crypto.pbkdf2Sync(
  this.masterKey,
  userSalt,
  iterations,
  KEY_LENGTH,
  'sha512'
);
```

```ts
// Source: backend/src/services/userEncryption.ts:53-66
const newSalt = encryptionService.generateUserSalt();
const keyHash = newSalt.substring(0, 64);
const encryptedSalt = encryptionService.encryptWithMasterKey(newSalt);
await tx.userEncryptionKey.create({
  data: { userId, keyType: KEY_TYPE, keyHash, encryptedKey: encryptedSalt, version: 1, isActive: true },
});
```

- **AuditLog salt**: distinct — `AUDIT_LOG_SALT` (`auditLog.ts:179`), used so audit PHI survives per-user salt deletion (HIPAA 7-yr retention).
- **Rotation policy**: there is **no** in-repo single-pass full-corpus re-encryption job (the old per-user rotate helper was removed as a footgun — `userEncryption.ts:74-80`). The documented end-to-end procedure is in [`RUNBOOK.md`](./RUNBOOK.md) §8.3: stand up the new key, re-encrypt all PHI row-by-row, then cut over. The all-tables re-encryption migration itself is:

  `TBD (external: a full PHI re-encryption migration must be authored before a PHI_ENCRYPTION_KEY rotation — track in SECURITY_STATUS.md and add a maintenance entrypoint under backend/src/maintenance/; per RUNBOOK.md:397-399)`

---

## 7. Cross-user exposure matrix

A non-owner can read PHI only through the PROVIDER PHI routes, each gated by `resolveProviderAccess(tx, providerId, patientId, flag)` (`providerAccess.ts:49`), which checks: relationship exists → status `ACTIVE` → consent not expired → the specific permission flag granted → patient account active+unlocked. The provider's decrypt uses the **patient's** salt fetched server-side. The four flags are exactly `canViewBiomarkers | canViewInsurance | canViewHealthNeeds | canEditData` (`providerAccess.ts:23-27`); **`canEditData` is currently inert — providers are read-only, there is no provider write path** (`providerRoutes.ts:38`).

```
provider → providerRoutes PHI route
              │  withRLSContext(providerId, tx => …)
              ▼
   resolveProviderAccess(tx, providerId, patientId, REQUIRED_FLAG)   providerAccess.ts:49
              │  ok? else providerAccessError()                       providerAccess.ts:90
              ▼  (RLS has_provider_access() is the fail-closed DB backstop)
   decrypt(field, PATIENT_salt) → 200                                 providerRoutes.ts:489
```

| PHI field(s) | Provider-readable? | Flag | Route + decrypt |
|---|---|---|---|
| `Biomarker.value/notes`, `BiomarkerHistory.value` | yes | `canViewBiomarkers` | `providerRoutes.ts:456` (gate) → `:489-490` (decrypt) |
| `HealthNeed.description` | yes | `canViewHealthNeeds` | `providerRoutes.ts:539` → `:571` |
| `InsurancePlan.memberId/groupId` | yes | `canViewInsurance` | `providerRoutes.ts:611` → insurance decrypt |
| `HealthGoal.*`, `GoalProgressHistory.*` | **no** | — | no provider goals route |
| `User.*` (name/DOB/phone/address/healthProfile) | **no** | — | provider patient-detail uses a non-PHI projection |
| `ExpenseProjection/Actual/CostAnalysis.*` | **no** | — | no provider expense route |
| `LabConnection.access/refreshToken` | **no — user-scoped only** | — | only `services/fhir/` (the owner's sync) reads these |
| `ProviderPatient.notes` | **no** (provider-authored, write-only) | — | no decrypt-for-display site |
| `AuditLog.*` | **no** (ADMIN-only viewer) | — | admin audit route |

---

## 8. Drift findings

### Schema vs `PHI_FIELDS`

No drift. Grep `Encrypted\s+String` over `backend/prisma/schema.prisma` returns **39** columns; `PHI_FIELDS` (`encryption.ts:476-562`) defines **39** entries; every column maps 1:1. Plaintext twins (`UserFile.originalFilename`, `HealthGoal.targetValue/currentValue/startValue`, `GoalProgressHistory.value`) and `Biomarker.sourceFile` (FHIR dedupe key) are deliberately excluded — not drift.

| Column | In schema? | In `PHI_FIELDS`? | Action |
|---|---|---|---|
| (all 39 `*Encrypted`) | yes | yes | none |
| `audit_logs.metadata` (plaintext) | **no — dropped** | no | confirmed gone (`20260615_drop_legacy_audit_metadata`) |
| `DNAVariant`/`GeneticTrait` | **no — model dropped** | no | removed since seed (`20260423_drop_dna_genetics`) |

### Logger redaction gaps

| PHI field | In `PHI_FIELDS`? | In `SENSITIVE_FIELDS`? | Risk / §ref |
|---|---|---|---|
| §8.1 `AuditLog.metadataEncrypted` | yes | **no** | add `metadataencrypted` to set |
| §8.2 `User.healthProfileEncrypted` | yes | **no** | rich free-text PHI — add `healthprofileencrypted` |
| §8.3 `UserFile.originalFilenameEncrypted` | yes | **no** | filename re-id vector — add `originalfilenameencrypted` |
| §8.6 `LabConnection.access/refreshTokenEncrypted` | yes | **no (exact)** | only generic token keys match — add `accesstokenencrypted`/`refreshtokenencrypted` |
| `Biomarker/Expense/ProviderPatient.notesEncrypted` (plural) | yes | **no** | only singular `noteencrypted` present — add `notesencrypted` |
| `User.firstNameEncrypted/lastNameEncrypted` | yes | **no** | identity PHI |
| `HealthGoal.target/current/startValueEncrypted` | yes | **no** | numeric goal PHI |
| `ExpenseActual.providerNameEncrypted` + monetary | yes | **no** | provider name + amounts |
| `genotype` (in set) | **no (model gone)** | yes | **stale** — remove (`logger.ts:36`) |

### Audit coverage gaps

| PHI field | Audited on write? | Audited on read? | Notes / §ref |
|---|---|---|---|
| `User.dateOfBirth/phone/addressEncrypted` | **n/a — no write site** | yes (export) | §8.4 — defined but never written |
| `ProviderPatient.notesEncrypted` | request audited (`providerRoutes.ts:213`) | **no read site** | §8.5 — write-only field |

### §8.4 — `User.dateOfBirthEncrypted` / `phoneEncrypted` / `addressEncrypted` have no production write site

Grep `dateOfBirthEncrypted|phoneEncrypted|addressEncrypted` over `backend/src/**/*.ts` returns only the export-path decrypt (`settingsController.ts:476-478`) and test fixtures — `updateProfile` writes only `firstNameEncrypted`/`lastNameEncrypted` (`settingsController.ts:1131`). These three columns are registered in `PHI_FIELDS` and selected on export but are **never written by production code**. Action: either wire them into `updateProfile`/onboarding or note them as reserved.

### §8.5 — `ProviderPatient.notesEncrypted` is write-only

Encrypted with the **provider's** salt and written on access request (`providerRoutes.ts:242,279,284`), but no route decrypts it for display. It is dead-on-read today. Action: surface it to the patient on the consent screen, or drop it.

---

## 9. Acceptance questions (self-answered from this doc)

1. **How many PHI fields in `PHI_FIELDS` (14 models, expect 39), all mapping to `*Encrypted` schema columns?** — **39 across 14 models** (§2 hand-count + `encryption.ts:476-562`); schema has 39 matching `Encrypted String` columns, perfect lockstep (§8 schema-drift table).
2. **Where is `Biomarker.valueEncrypted` decrypted, how many call sites?** — Two production read paths: owner list/get `biomarkerController.ts:100`; provider `providerRoutes.ts:489` (gated `canViewBiomarkers`). §3 Biomarker.
3. **Is `ExpenseActual.providerNameEncrypted` covered by logger redaction?** — **No** (`providernameencrypted` absent from `SENSITIVE_FIELDS`); §4 matrix + §8 logger-gap table.
4. **Which PHI can a PROVIDER read, via which flag?** — Biomarkers/history (`canViewBiomarkers`), HealthNeed (`canViewHealthNeeds`), InsurancePlan member/group IDs (`canViewInsurance`); `canEditData` is inert (no provider writes). §7 matrix.
5. **How is the per-user key derived, where is the salt stored?** — `pbkdf2(masterKey from PHI_ENCRYPTION_KEY, userSalt, SHA512)` (`encryption.ts:247-253`); salt is fetched by `getUserEncryptionSalt` (`userEncryption.ts:29`) from `UserEncryptionKey` (`schema.prisma:108`), itself master-key-encrypted at rest. §6.
6. **Does every PHI write have a matching audit call, and what's the drift?** — Yes for all written fields (§5 table); drift is the never-written User DOB/phone/address fields (§8.4) and write-only `ProviderPatient.notes` (§8.5).
7. **`LabConnection` tokens — written/read where, user-scoped only?** — Written `labSyncService.ts:151-152`, read `:222-224,456`, all in `services/fhir/` with the user's own salt; **never provider-shared** (§3 LabConnection, §7).
8. **Which audit fields hold encrypted PHI; is plaintext `metadata` gone?** — `previousValueEncrypted`, `newValueEncrypted`, `metadataEncrypted` (M6), all system-salt encrypted (`auditLog.ts:299-314`); plaintext `metadata` **dropped** in `20260615_drop_legacy_audit_metadata`. §3 AuditLog.
9. **Rotation policy for `PHI_ENCRYPTION_KEY`?** — Documented procedure in [`RUNBOOK.md`](./RUNBOOK.md) §8.3; the full-corpus re-encryption migration is `TBD (external)` per §6.
10. **Logger redaction gap for any PHI field?** — Yes: `metadataencrypted`, `healthprofileencrypted`, `originalfilenameencrypted` missing; `accesstokenencrypted`/`refreshtokenencrypted` only generic-covered; `clauderesponseencrypted` **is** covered; `genotype` is stale. §4 + §8.
11. **How is `ProviderPatient.notesEncrypted` accessed?** — Provider-authored, encrypted with the provider's own salt, **write-only** (no decrypt site). §3 ProviderPatient + §8.5.
12. **What happens to PHI on user deletion?** — Cascade `tx.user.delete()` after GCS-first file purge, audited via `logDelete('UserData', …)` (`settingsController.ts:1008,1038,1045`); audit rows survive (system salt). §5/§6.
13. **Which controllers decrypt PHI for non-owner access, and what gates each?** — Only `providerRoutes.ts`, each via `resolveProviderAccess(...)` with the required flag (`providerAccess.ts:49`). §7.
14. **Is `HealthNeed.descriptionEncrypted` encrypted, and is `User.healthProfileEncrypted` covered everywhere?** — Yes, HealthNeed description is encrypted (`healthNeedsController.ts:201`); `healthProfileEncrypted` is encrypted at `healthProfileService.ts:102` and decrypted at `:62-73` (the only two sites), but is **not** log-redacted (§8.2). §3 User + HealthNeed.

---

## Related Documents

- [DATA_MODEL.md](./DATA_MODEL.md) — full Prisma schema, per-model tables, RLS policies, cascade behavior (PHI columns live here).
- [ARCHITECTURE.md](./ARCHITECTURE.md) — encryption layer, RLS context, and audit flow at system level.
- [API_REFERENCE.md](./API_REFERENCE.md) — endpoints that return decrypted PHI (per-route audit + PHI linkage).
- [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) — §164.312 technical safeguards citing this taxonomy.
- [ENV_VARS.md](./ENV_VARS.md) — `PHI_ENCRYPTION_KEY`, `AUDIT_LOG_SALT` definitions and consumers.
- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — open PHI-related findings (logger gaps, key-rotation TBD).
- [RUNBOOK.md](./RUNBOOK.md) — §8.3 key-rotation procedure, L24 filename backfill job.
- [`_phi-inventory.md`](../prompts/_phi-inventory.md) — the lightweight seed list this doc expands.

> Note: `DATA_MODEL.md`, `API_REFERENCE.md`, `ENV_VARS.md`, and `HIPAA_CHECKLIST.md` are part of the doc set produced/regenerated by this same documentation run; `ARCHITECTURE.md`, `SECURITY_STATUS.md`, and `RUNBOOK.md` already exist in `New Project Documents/`.

---

## Prompt drift log

- **`40-phi-taxonomy-doc.md` field count vs digest**: the prompt and `_phi-inventory.md` both state **14 models / 39 fields** (correct, re-verified by hand-count of `PHI_FIELDS` at `encryption.ts:476-562` and `Encrypted\s+String` → 39 schema hits). The intermediate `fact-digest.md` FACT[phi-fields] table totals "37 encrypted fields" — that is a **miscount** of the same correct field list; the canonical 39 stands. No code change needed; flag the digest.
- **`CLAUDE.md` PHI section is stale** (not this prompt, but surfaced while verifying): it lists `Biomarker.unit`, `InsurancePlan.planName/insurerName/benefits` as encrypted — none are `*Encrypted` columns or in `PHI_FIELDS`. `InsuranceBenefit` has **no** encrypted columns (confirmed §2). It also omits `healthProfileEncrypted`, the M4 goal-value fields, `UserFile.originalFilenameEncrypted`, and `AuditLog.metadataEncrypted`. Update `CLAUDE.md` "PHI Encryption" to point at `PHI_FIELDS` rather than re-listing.
- **New finding not in the prompt**: `User.dateOfBirthEncrypted`/`phoneEncrypted`/`addressEncrypted` are in `PHI_FIELDS` + schema but have **no production write site** (only export-path decrypt + test fixtures) — recorded as drift §8.4. The prompt's per-field template assumes every field has a write site; it does not.
