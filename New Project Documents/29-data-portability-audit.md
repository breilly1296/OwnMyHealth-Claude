# Data Portability & Deletion Security Audit

**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (Automated Security Audit)
**Scope:** Data export, health data deletion, full account deletion, cascade integrity, encryption key lifecycle, and audit log preservation.
**Severity Rating:** MEDIUM (HIPAA-relevant gaps identified)

---

## Files Reviewed

| File | Path |
|------|------|
| Settings Controller | `backend/src/controllers/settingsController.ts` |
| Settings Routes | `backend/src/routes/settingsRoutes.ts` |
| Prisma Schema | `backend/prisma/schema.prisma` |
| User Encryption | `backend/src/services/userEncryption.ts` |
| Audit Log Service | `backend/src/services/auditLog.ts` |
| Encryption Service | `backend/src/services/encryption.ts` |
| Storage Service | `backend/src/services/storageService.ts` |
| Frontend Settings API | `src/services/api/settings.ts` |
| Account Settings UI | `src/components/settings/AccountSettingsPage.tsx` |
| Rate Limiter | `backend/src/middleware/rateLimiter.ts` |
| CSRF Middleware | `backend/src/middleware/csrf.ts` |
| Routes Index | `backend/src/routes/index.ts` |
| App Entry | `backend/src/app.ts` |
| File Controller | `backend/src/controllers/fileController.ts` |
| Batch Processor | `backend/src/utils/batchProcessor.ts` |
| Initial Migration | `backend/prisma/migrations/00000000000000_initial_schema/migration.sql` |

---

## Checklist

### 1. Data Export Completeness

- [~] **PARTIAL** - Export includes ALL user data categories:
  - [x] Biomarkers (decrypted values) -- `settingsController.ts:95-98` fetches all biomarkers with history, decrypts `valueEncrypted` at line 114.
  - [~] **PARTIAL** - Biomarker history is fetched (`include: { history: true }` at line 97) but the history records are NOT included in the export output. The `ExportBiomarker` interface (lines 22-36) has no `history` field, and decrypted history values are never mapped into the response. **Notes are also not decrypted or included** -- `notesEncrypted` is never referenced in the export handler.
  - [~] **PARTIAL** - Insurance plans are exported (lines 102-104, 147-159) with plan metadata and financial limits, but **encrypted fields `memberIdEncrypted` and `groupIdEncrypted` are NOT decrypted for export**. The `ExportInsurancePlan` interface (lines 39-51) does not include member ID or group ID fields at all.
  - [ ] **FAIL** - Health goals are NOT exported. No query for `prisma.healthGoal.findMany()` exists in `exportUserData()`.
  - [ ] **FAIL** - Health needs are NOT exported. No query for `prisma.healthNeed.findMany()` exists in `exportUserData()`.
  - [ ] **FAIL** - Expense projections are NOT exported. No query for `prisma.expenseProjection.findMany()` exists.
  - [ ] **FAIL** - Expense actuals are NOT exported. No query for `prisma.expenseActual.findMany()` exists.
  - [ ] **FAIL** - Cost analyses are NOT exported. No query for `prisma.costAnalysis.findMany()` exists.
  - [ ] **FAIL** - Uploaded file metadata is NOT exported. No query for `prisma.userFile.findMany()` exists.
  - [ ] **FAIL** - Provider relationships are NOT exported. No query for `prisma.providerPatient.findMany()` exists.

- [~] **PARTIAL** - PHI fields properly decrypted for export
  - Biomarker `valueEncrypted` is decrypted (`settingsController.ts:114`).
  - Biomarker `notesEncrypted` is NOT decrypted or exported.
  - Insurance `memberIdEncrypted` and `groupIdEncrypted` are NOT decrypted or exported.
  - All other data categories (health goals, health needs, expenses) are not exported at all.

- [x] **PASS** - Export includes metadata (dates, categories, sources) -- `settingsController.ts:128-142` includes measurement dates, categories, source types, reference ranges.

- [x] **PASS** - Export format documented and machine-readable (JSON) -- Response is `res.json(response)` at line 203. Frontend downloads as `.json` file (`AccountSettingsPage.tsx:101-106`).

- [x] **PASS** - Export is a single download (no partial exports) -- Single GET request returns all data in one JSON response. Frontend creates a single Blob download (`AccountSettingsPage.tsx:101-109`).

- [x] **PASS** - No other users' data included in export -- Queries are scoped by `userId` (lines 85, 96, 103) and wrapped in `withRLSContext(userId, ...)` at line 84, providing both application-level and database-level (RLS) isolation.

### 2. Export Security

- [x] **PASS** - Export endpoint requires authentication -- `settingsRoutes.ts:32` applies `router.use(authenticate)` to all settings routes before any handler is mounted.

- [~] **PARTIAL** - Export endpoint rate limited (prevent abuse) -- There is NO endpoint-specific rate limiter on settings routes (`settingsRoutes.ts` does not import or apply any rate limiter). However, the global `standardLimiter` is applied at the app level (`app.ts:166`), which provides baseline protection (configurable window/max, default 100 requests per 15 minutes). **A dedicated `sensitiveLimiter` should be applied to the export endpoint** given it performs bulk decryption of all PHI.

- [~] **PARTIAL** - Export audit logged (HIPAA: PHI_EXPORT action) -- The export IS audit logged (`settingsController.ts:192-196`) with `logAccess('UserData', userId, ...)` and operation metadata. However, it uses `logAccess` (which maps to `READ` action in the audit log) rather than the dedicated `logExport` method (`auditLog.ts:367-389`) which would use the `EXPORT` action and properly record resource IDs. **The audit action should be `EXPORT` / `PHI_EXPORT`, not `READ`**, for accurate HIPAA compliance reporting.

- [x] **PASS** - Export doesn't include password hashes or internal IDs -- The `User` select at line 87-88 only retrieves `email` and `createdAt`. No `passwordHash`, no `id` fields. Biomarker internal IDs (`id`, `userId`) are not mapped to the export interface.

- [x] **PASS** - Export doesn't include encryption keys or salts -- Neither `UserEncryptionKey` data nor user salts appear in the export output. The salt is used internally for decryption only.

- [~] **PARTIAL** - Export response uses secure headers (no caching) -- The export endpoint uses `res.json()` with no explicit `Cache-Control` headers set (`settingsController.ts:203`). Helmet is configured globally (`app.ts:94-106`) but does NOT include `noCache` or `noStore` directives. **Export responses containing decrypted PHI should explicitly set `Cache-Control: no-store, no-cache` and `Pragma: no-cache` headers** to prevent browser/proxy caching of sensitive data.

- [x] **PASS** - Large exports handled without server memory issues -- Biomarker decryption uses `processBatch()` (`settingsController.ts:111-145`) with `DECRYPT_BATCH_SIZE = 20` (line 19) to control concurrency. The `batchProcessor.ts` utility processes items in sequential batches of 20, preventing connection pool exhaustion. However, the entire result set is still held in memory for the JSON response; streaming would be more robust for very large datasets.

### 3. Health Data Deletion (Keep Account)

- [x] **PASS** - Deletes biomarkers and related records -- `settingsController.ts:232` executes `tx.biomarker.deleteMany({ where: { userId } })`. Cascade on `BiomarkerHistory` (`schema.prisma:177`, `onDelete: Cascade` on `biomarkerId`) ensures history records are also deleted.

- [x] **PASS** - Deletes insurance plans and benefits -- `settingsController.ts:233` executes `tx.insurancePlan.deleteMany({ where: { userId } })`. Cascade on `InsuranceBenefit` (`schema.prisma:369`, `onDelete: Cascade` on `planId`) ensures benefits are also deleted.

- [x] **PASS** - Deletes health goals and progress history -- `settingsController.ts:235` executes `tx.healthGoal.deleteMany({ where: { userId } })`. Cascade on `GoalProgressHistory` (`schema.prisma:491`, `onDelete: Cascade` on `goalId`) ensures progress history is also deleted.

- [x] **PASS** - Deletes health needs -- `settingsController.ts:234` executes `tx.healthNeed.deleteMany({ where: { userId } })`.

- [ ] **FAIL** - Deletes expense projections, actuals, and analyses -- The `deleteAllData` handler (`settingsController.ts:210-251`) does NOT delete `ExpenseProjection`, `ExpenseActual`, or `CostAnalysis` records. These tables have `userId` foreign keys (`schema.prisma:671,693,722`) with `onDelete: Cascade` on the User, so they would only be deleted during full account deletion, NOT during "delete health data only" mode. **Expense data is orphaned or retained when it should be deleted as health data.**

- [ ] **FAIL** - Deletes uploaded files (DB records AND GCS objects) -- The `deleteAllData` handler does NOT delete `UserFile` records or their corresponding GCS objects. There is no import of `storageService` or `deleteFile` in `settingsController.ts`. The `UserFile` model has `onDelete: Cascade` on the User relation (`schema.prisma:126`), so DB records would only be cascade-deleted on full account deletion. **GCS files are NEVER cleaned up during health data deletion. Even during full account deletion, GCS objects are not explicitly deleted** -- only the database records are cascade-deleted, leaving orphaned files in the GCS bucket.

- [x] **PASS** - Preserves user account, sessions, and credentials -- The `deleteAllData` handler only deletes biomarkers, insurance plans, health needs, and health goals. It does not touch the `users`, `sessions`, or `user_encryption_keys` tables.

- [x] **PASS** - Preserves audit logs (HIPAA requirement) -- Audit logs are not targeted for deletion in `deleteAllData`. The `AuditLog` model does not cascade on user deletion (`schema.prisma:514` has no `onDelete` clause; migration confirms `ON DELETE SET NULL`).

- [x] **PASS** - Deletion is transactional (all-or-nothing) -- `settingsController.ts:231` uses `withRLSTransaction(userId, async (tx) => { ... })` wrapping all four `deleteMany` calls in a single Prisma transaction with RLS context.

- [x] **PASS** - Deletion audit logged -- `settingsController.ts:239-244` calls `auditService.logDelete('UserData', userId, { deletedBiomarkers, deletedInsurancePlans, ... })` with counts of deleted records.

### 4. Full Account Deletion

- [x] **PASS** - Requires password confirmation -- `settingsController.ts:263-264` checks for `password` in request body and throws `UnauthorizedError` if missing. Lines 284-287 verify the password against the stored hash using `verifyPassword()`. Frontend enforces this with a password input field (`AccountSettingsPage.tsx:465-487`).

- [~] **PARTIAL** - Deletes all data from health data deletion (above) -- The account deletion handler (`settingsController.ts:296-300`) deletes the `User` record, relying on Prisma schema cascades to delete related data. All data categories with `onDelete: Cascade` on `userId` will be deleted: Biomarkers, InsurancePlans, HealthGoals, HealthNeeds, Sessions, UserEncryptionKeys, UserFiles, ExpenseProjections, ExpenseActuals, CostAnalyses, ProviderPatient relationships. However, **GCS file objects are NOT cleaned up** (see finding in section 3).

- [x] **PASS** - Deletes user record -- `settingsController.ts:297-299` executes `prisma.user.delete({ where: { id: userId } })` within admin RLS context (`withRLSContext(null, ...)`).

- [x] **PASS** - Deletes all sessions (invalidates all tokens) -- `Session` model has `onDelete: Cascade` on `userId` (`schema.prisma:60`). All sessions are cascade-deleted when the user is deleted.

- [x] **PASS** - Destroys per-user encryption keys (UserEncryptionKey records) -- `UserEncryptionKey` model has `onDelete: Cascade` on `userId` (`schema.prisma:78`). All encryption key records (including salts encrypted with master key) are cascade-deleted.

- [x] **PASS** - Deletes DNA data, variants, and genetic traits (if present) -- `DNAData` has `onDelete: Cascade` on `userId` (`schema.prisma:387`). `DNAVariant` has `onDelete: Cascade` on `dnaDataId` (`schema.prisma:403`). `GeneticTrait` has `onDelete: Cascade` on `dnaDataId` (`schema.prisma:422`). All cascade correctly through the chain.

- [x] **PASS** - Revokes all provider relationships -- `ProviderPatient` has `onDelete: Cascade` on both `patientId` (`schema.prisma:101`) and `providerId` (`schema.prisma:102`). Deleting a user removes all relationships where they are either patient or provider.

- [x] **PASS** - Removes user from provider's patient lists -- Same cascade as above ensures the user is removed from all `ProviderPatient` records.

- [ ] **FAIL** - GCS files for user completely removed from bucket -- The `deleteAccount` handler (`settingsController.ts:295-300`) does NOT query `UserFile` records to get `storageKey` values before deletion, and does NOT call `deleteFile()` from `storageService.ts` for any GCS objects. The database `user_files` records are cascade-deleted, but **the actual GCS bucket objects persist as orphans**. The `storageService.ts` provides a `deleteFile(storageKey)` function (line 140) but it is never invoked during account deletion.

- [x] **PASS** - Audit logs PRESERVED (7-year HIPAA retention, even after deletion) -- The `AuditLog` model uses `User?` (nullable relation, `schema.prisma:500,514`) with no `onDelete` cascade. The initial migration (`migration.sql:400`) confirms `ON DELETE SET NULL`. When a user is deleted, `audit_logs.user_id` is set to NULL, preserving the log entries. The deletion is also audit logged BEFORE the user delete (`settingsController.ts:290-293`).

- [x] **PASS** - Deletion is transactional -- The user deletion uses `withRLSContext(null, ...)` which wraps the operation. Since it's a single `prisma.user.delete()` call, the database cascades execute atomically within the same database transaction.

- [x] **PASS** - Account cannot be recovered after deletion -- The delete operation is immediate with no soft-delete flag, no grace period, and no recovery mechanism. The frontend redirects to `/` after successful deletion (`AccountSettingsPage.tsx:148`). The UI explicitly states "This action cannot be undone" (`AccountSettingsPage.tsx:448`).

### 5. Cascade Integrity

- [x] **PASS** - Prisma schema defines proper `onDelete` cascades:
  - [x] User -> Biomarkers: `onDelete: Cascade` (`schema.prisma:156`)
  - [x] User -> InsurancePlans: `onDelete: Cascade` (`schema.prisma:341`)
  - [x] User -> HealthGoals: `onDelete: Cascade` (`schema.prisma:473`)
  - [x] User -> HealthNeeds: `onDelete: Cascade` (`schema.prisma:442`)
  - [x] User -> Sessions: `onDelete: Cascade` (`schema.prisma:60`)
  - [x] User -> UserEncryptionKeys: `onDelete: Cascade` (`schema.prisma:78`)
  - [x] User -> UserFiles: `onDelete: Cascade` (`schema.prisma:126`)
  - [x] Biomarker -> BiomarkerHistory: `onDelete: Cascade` (`schema.prisma:177`)
  - [x] HealthGoal -> GoalProgressHistory: `onDelete: Cascade` (`schema.prisma:491`)
  - [x] InsurancePlan -> InsuranceBenefits: `onDelete: Cascade` (`schema.prisma:369`)
  - [x] InsurancePlan -> ExpenseProjections: `onDelete: Cascade` (`schema.prisma:683`)
  - [x] InsurancePlan -> ExpenseActuals: `onDelete: Cascade` (`schema.prisma:711`)
  - [x] User -> ExpenseProjections: `onDelete: Cascade` (`schema.prisma:682`)
  - [x] User -> ExpenseActuals: `onDelete: Cascade` (`schema.prisma:710`)
  - [x] User -> CostAnalyses: `onDelete: Cascade` (`schema.prisma:730`)
  - [x] ProviderPatient -> Cascade on both patient and provider sides (`schema.prisma:101-102`)

- [~] **PARTIAL** - No orphaned records after deletion
  - Database records: All relational cascades are properly defined. No orphaned DB rows.
  - **GCS objects: Orphaned.** File records are cascade-deleted but GCS bucket objects persist.
  - **Biomarker -> UserFile (`schema.prisma:155`)**: The `userFile` relation on `Biomarker` has NO `onDelete` clause. If a `UserFile` is deleted (either directly or via cascade), the Biomarker's `userFileId` becomes a dangling reference. The `fileController.ts:261-264` handles this for individual file deletion by setting `userFileId: null`, but during cascade deletion of UserFiles (via User deletion), the Biomarkers are also being cascade-deleted so this is not an issue in practice.

- [x] **PASS** - No foreign key violations during deletion -- Cascade ordering ensures child records are deleted before parents. The `AuditLog` FK uses `SET NULL` to avoid blocking user deletion. The `ExpenseActual -> ExpenseProjection` FK uses `onDelete: SetNull` (`schema.prisma:712`) to avoid cascade conflicts.

### 6. Encryption Key Lifecycle

- [x] **PASS** - Per-user encryption salt destroyed on account deletion -- `UserEncryptionKey` records (which store the user's salt encrypted with master key) are cascade-deleted via `onDelete: Cascade` (`schema.prisma:78`) when the user is deleted.

- [x] **PASS** - Master key NOT affected by individual user deletion -- The master key is stored in the `PHI_ENCRYPTION_KEY` environment variable (`encryption.ts:140`) and is never modified by any user operation. User salts are derived separately.

- [x] **PASS** - Key rotation doesn't break existing encrypted data -- `userEncryption.ts:72-129` implements `rotateUserEncryptionKey()` which creates a new key version while marking the old one inactive (not deleting it). The function returns both `oldSalt` and `newSalt` to enable re-encryption. The `encryption.ts:347-350` provides `reEncrypt()` for this purpose.

- [x] **PASS** - After key destruction, encrypted data is permanently unrecoverable -- When `UserEncryptionKey` records are cascade-deleted, the encrypted salt (the only copy of the user's salt) is destroyed. Without the salt, the per-user derived key cannot be reconstructed from the master key, making all encrypted PHI permanently unrecoverable.

- [ ] **FAIL** - Key destruction audit logged -- There is NO explicit audit log entry for encryption key destruction during account deletion. The account deletion audit log (`settingsController.ts:290-293`) records the general deletion event with `logDelete('User', userId, { email, reason })` but does NOT specifically log the destruction of encryption keys. `userEncryption.ts` contains no audit logging of any kind. For HIPAA compliance, cryptographic key lifecycle events (creation, rotation, destruction) should be independently logged.

### 7. Audit Log Preservation

- [x] **PASS** - Audit logs survive account deletion (HIPAA 7-year requirement) -- The `AuditLog.userId` field is nullable (`String?` at `schema.prisma:500`) with no `onDelete` cascade. The database FK is `ON DELETE SET NULL` (confirmed in `migration.sql:400`). When a user is deleted, their audit logs remain with `userId = NULL`.

- [x] **PASS** - Audit logs reference userId but don't depend on user existence -- The relation is `User?` (optional, `schema.prisma:514`), and `userId` is `String?` (nullable). Audit logs can exist independently of the user record.

- [x] **PASS** - Deleted user's audit logs still queryable by admin -- The `queryLogs` method (`auditLog.ts:410-444`) accepts optional `userId` filter. Logs with `userId = NULL` (from deleted users) can be retrieved by date range, action type, or resource type. The `resourceId` field (`schema.prisma:507`) still contains the original user UUID for the deletion event itself.

- [x] **PASS** - Audit logs retain encrypted PHI values (with system salt, not user salt) -- The `AuditLogService.encryptValue()` method (`auditLog.ts:169-179`) encrypts audit values using `this.systemSalt` (initialized from `SystemConfig` table, `auditLog.ts:104-124`), NOT the user's personal salt. This means audit log values remain decryptable even after user salt destruction.

---

## Summary of Findings

### Critical Issues (Must Fix)

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| 1 | **GCS files not deleted on account deletion** -- Database records cascade-delete but actual GCS bucket objects persist as orphans. PHI in uploaded files (lab reports, SBC documents) remains in cloud storage indefinitely after account deletion. | **HIGH** | `settingsController.ts:295-300` |
| 2 | **Data export is incomplete** -- Export only includes biomarkers and insurance plans. Missing: health goals, health needs, expense projections/actuals, cost analyses, uploaded file metadata, provider relationships, biomarker history details, biomarker notes. | **HIGH** | `settingsController.ts:72-204` |
| 3 | **Health data deletion is incomplete** -- "Delete all health data" mode does not delete expense projections, expense actuals, cost analyses, or uploaded files (DB records or GCS objects). | **HIGH** | `settingsController.ts:210-251` |

### Medium Issues (Should Fix)

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| 4 | **Insurance encrypted fields not decrypted in export** -- `memberIdEncrypted` and `groupIdEncrypted` are not decrypted or included in the export. | MEDIUM | `settingsController.ts:147-159` |
| 5 | **Export audit action is READ instead of EXPORT** -- Uses `logAccess()` (READ action) instead of `logExport()` (EXPORT action). HIPAA auditors may miss export events when filtering by action type. | MEDIUM | `settingsController.ts:192-196` |
| 6 | **Encryption key destruction not independently audit logged** -- No specific audit trail for cryptographic key lifecycle events. | MEDIUM | `settingsController.ts:295-300`, `userEncryption.ts` |
| 7 | **No Cache-Control headers on export response** -- Decrypted PHI may be cached by browsers or proxies. | MEDIUM | `settingsController.ts:203` |

### Low Issues (Consider Fixing)

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| 8 | **No dedicated rate limiter on export/delete endpoints** -- Only protected by global standard rate limiter. Export triggers bulk decryption which is CPU-intensive. | LOW | `settingsRoutes.ts` |
| 9 | **Debug console.log statements in production routes** -- Settings routes include debug logging of headers and user IDs that may leak information in production logs. | LOW | `settingsRoutes.ts:25-29,43-46` |
| 10 | **Biomarker history fetched but not exported** -- Data is queried (`include: { history: true }`) but silently discarded in the export mapping. | LOW | `settingsController.ts:97` |

---

## Recommended Remediations

### 1. GCS File Cleanup on Account Deletion (Critical)

Before deleting the user record, query all `UserFile` records to get their `storageKey` values, then delete each GCS object:

```
// Pseudocode for the fix:
// 1. Query all UserFile records for userId
// 2. For each file, call deleteFile(file.storageKey)
// 3. Then proceed with prisma.user.delete()
```

The same pattern should be applied to "delete all health data" mode for uploaded files.

### 2. Complete the Data Export (Critical)

Add queries and decryption for all remaining data categories: health goals (with progress history), health needs, expense projections, expense actuals, cost analyses, uploaded file metadata, and provider relationships.

### 3. Complete Health Data Deletion (Critical)

Add deletion of `ExpenseProjection`, `ExpenseActual`, `CostAnalysis`, and `UserFile` records (plus GCS objects) to the `deleteAllData` transaction.

### 4. Use EXPORT Audit Action (Medium)

Replace `auditService.logAccess()` with `auditService.logExport()` in the export handler, passing resource IDs and export format.

### 5. Add Cache-Control Headers (Medium)

Add `res.set('Cache-Control', 'no-store, no-cache, must-revalidate')` and `res.set('Pragma', 'no-cache')` before sending the export response.

### 6. Add Dedicated Rate Limiting (Low)

Apply `sensitiveLimiter` (10 requests/hour) to the export and delete endpoints in `settingsRoutes.ts`.

---

## Questions for Development Team

1. **Is there an intentional reason expense data is excluded from "delete health data" mode?** If expenses are considered financial rather than health data, this should be documented and communicated to users in the UI.

2. **Is there a GCS lifecycle policy configured on the bucket?** If so, orphaned objects may eventually be cleaned up, but this should not be relied upon for HIPAA compliance with a right-to-deletion request.

3. **Is there a plan to implement a grace period or soft-delete for account deletion?** The current implementation is immediate and irreversible, which is correct for data minimization but may cause support issues.

4. **Should the export include file content (PDFs) or only metadata?** Current implementation exports neither; the prompt suggests metadata-only or a separate download option.

---

*Report generated 2026-02-06 by automated security audit.*
