# Encryption Security Audit Report

**Project:** OwnMyHealth
**Audit Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (automated code review)
**Scope:** Application-layer PHI encryption (AES-256-GCM), per-user key management, controller encrypt/decrypt usage, audit log encryption
**Severity Scale:** CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Executive Summary

The OwnMyHealth encryption architecture is well-designed and implements strong cryptographic practices. AES-256-GCM with per-user key derivation via PBKDF2-SHA512 provides robust confidentiality and integrity for PHI at rest. Most controllers correctly encrypt before storage and decrypt on retrieval. Several issues were identified, primarily around **missing ExpenseActual encryption in controllers**, **audit log salt stored in plaintext**, **provider route returning encrypted (undecrypted) data to providers**, and **minor console.error usage that could leak plan IDs**. No critical cryptographic weaknesses were found in the core encryption implementation.

**Overall Rating: STRONG with targeted remediation needed**

---

## 1. Encryption Implementation

### [x] PASS - AES-256-GCM algorithm used (not AES-CBC or weaker)
- **File:** `backend/src/services/encryption.ts:58`
- **Finding:** `const ALGORITHM = 'aes-256-gcm';` is used throughout. No AES-CBC, AES-ECB, or weaker ciphers found anywhere in the codebase.
- **Evidence:** All `createCipheriv` and `createDecipheriv` calls use the `ALGORITHM` constant.

### [x] PASS - Unique IV/nonce generated for each encryption operation
- **File:** `backend/src/services/encryption.ts:197,247`
- **Finding:** `crypto.randomBytes(IV_LENGTH)` (16 bytes) is called at the start of every `encrypt()` and `encryptWithMasterKey()` call. Each encryption operation generates a fresh, cryptographically random IV.
- **Evidence:** IV is generated within the function scope, not reused or stored globally.

### [x] PASS - Authentication tag verified on decryption
- **File:** `backend/src/services/encryption.ts:226-232,281-287`
- **Finding:** Both `decrypt()` and `decryptWithMasterKey()` call `decipher.setAuthTag(authTag)` before decryption and specify `{ authTagLength: 16 }`. GCM mode will throw an authentication error if the tag does not match, preventing tampered ciphertext from being accepted.
- **Evidence:** Auth tag is extracted from the stored format (`iv:authTag:ciphertext`) and set on the decipher instance.

### [x] PASS - No ECB mode usage anywhere
- **Finding:** Searched the entire `backend/src` directory for `ecb`, `aes-128`, `aes-192`, `DES`, `RC4`, and other weak algorithms. None found. Only `aes-256-gcm` is used.

---

## 2. Key Management

### [x] PASS - Master key loaded from environment variable (`PHI_ENCRYPTION_KEY`)
- **File:** `backend/src/services/encryption.ts:140`
- **Finding:** `const masterKeyHex = process.env.PHI_ENCRYPTION_KEY;` -- key is loaded exclusively from environment variable. The `config/index.ts` file also validates this variable at startup.

### [x] PASS - Key is not hardcoded anywhere in codebase
- **Finding:** Searched the entire codebase for 64-character hex strings. The only matches are:
  - Known-insecure placeholder keys in the `INSECURE_KEYS` blocklist (`encryption.ts:76-80`, `config/index.ts:170-172`)
  - Test-only mock values in `encryption.test.ts` and `authService.test.ts` (test files, not production code)
- No production key material is hardcoded.

### [x] PASS - Key is not logged or exposed in error messages
- **File:** `backend/src/services/encryption.ts:148-162`
- **Finding:** The error thrown on invalid key configuration includes the *validation error message* (e.g., "key must be at least 64 hex characters") but never includes the key value itself. The `logger.ts` utility redacts sensitive fields including encryption-related ones.
- **File:** `backend/src/utils/logger.ts:21-27` -- `SENSITIVE_FIELDS` set includes `password`, `token`, `secret`, `memberIdEncrypted`, `valueEncrypted`, etc.

### [x] PASS - Key derivation uses proper KDF (PBKDF2, scrypt, or Argon2)
- **File:** `backend/src/services/encryption.ts:172-180`
- **Finding:** `crypto.pbkdf2Sync(this.masterKey, userSalt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512')` -- Uses PBKDF2 with SHA-512 digest, 100,000 iterations, deriving a 32-byte key.

---

## 3. Per-User Key Management

### [x] PASS - Per-user salt stored in `UserEncryptionKey` table
- **File:** `backend/prisma/schema.prisma:68-83`
- **Finding:** The `UserEncryptionKey` model has `encryptedKey`, `keyType`, `keyHash`, `version`, `isActive`, and `rotatedAt` fields. Each user has a unique row with `keyType = 'phi_encryption'`.
- **File:** `backend/src/services/userEncryption.ts:24-33`

### [x] PASS - Salt encrypted with master key before DB storage (`encryptWithMasterKey()`)
- **File:** `backend/src/services/userEncryption.ts:48-49`
- **Finding:** `const encryptedSalt = encryptionService.encryptWithMasterKey(newSalt);` is called before storing, and `encryptionService.decryptWithMasterKey(existingKey.encryptedKey)` is called on retrieval. The raw salt is never persisted in plaintext.

### [x] PASS - PBKDF2-SHA512 with 100,000 iterations for key derivation
- **File:** `backend/src/services/encryption.ts:69-70,173-179`
- **Finding:** `const PBKDF2_ITERATIONS = 100000;` and the `deriveUserKey()` method uses `'sha512'` as the digest algorithm. This meets OWASP minimum recommendations.

### [x] PASS - 32-byte random salt per user (`generateUserSalt()`)
- **File:** `backend/src/services/encryption.ts:64,185-187`
- **Finding:** `const SALT_LENGTH = 32;` and `generateUserSalt()` calls `crypto.randomBytes(SALT_LENGTH).toString('hex')`, producing a 64-character hex string (32 bytes of entropy).

### [x] PASS - Key rotation supported (version tracking, `isActive` flag)
- **File:** `backend/src/services/userEncryption.ts:72-129`
- **Finding:** `rotateUserEncryptionKey()` function atomically marks the old key as inactive (`isActive: false`, `rotatedAt: new Date()`) and creates a new key with `version + 1`. Uses `prisma.$transaction` for atomicity. The `reEncrypt()` method on `EncryptionService` supports re-encrypting data with a new salt.

### [~] PARTIAL - Salt created on user registration
- **File:** `backend/src/services/authService.ts:456-484`
- **Finding:** The `createUser()` function does NOT explicitly call `getUserEncryptionSalt()` during registration. However, `getUserEncryptionSalt()` (`userEncryption.ts:20-63`) implements a lazy-initialization pattern -- it auto-creates the salt on the first call if none exists. This means the salt is created on first PHI write/read rather than at registration time.
- **Risk:** LOW -- The salt is guaranteed to exist before any encryption occurs, but there is a slight latency penalty on the user's first PHI operation. No data integrity risk.

### [~] PARTIAL - Salt destroyed on account deletion
- **File:** `backend/prisma/schema.prisma:78`
- **Finding:** The `UserEncryptionKey` model has `onDelete: Cascade` on the `user` relation. When a user is deleted via `prisma.user.delete()` (in `settingsController.ts:297`), the cascade will automatically delete all associated `UserEncryptionKey` records.
- **Note:** The encryption keys are destroyed, but the `deleteAllData()` function (`settingsController.ts:210-251`) which deletes health data does NOT delete encryption keys -- only `deleteAccount()` does. This is correct behavior since keys are needed as long as the account exists.

---

## 4. PHI Field Coverage

### User PII

#### [x] PASS - firstName, lastName, dateOfBirth, phone, address
- **File:** `backend/prisma/schema.prisma:14-18`
- **Finding:** All five fields use the `Encrypted` suffix: `firstNameEncrypted`, `lastNameEncrypted`, `dateOfBirthEncrypted`, `phoneEncrypted`, `addressEncrypted`.
- **File:** `backend/src/services/encryption.ts:367-373` -- PHI_FIELDS.User lists all five fields.
- **Note:** The `authController.ts` does not handle profile updates (first name, last name, etc.) -- these are stored encrypted but no controller for updating them was found. This means profile data may only be set via a separate mechanism not reviewed here.

### Biomarker Data

#### [x] PASS - Biomarker `valueEncrypted`, `notesEncrypted`
- **File:** `backend/prisma/schema.prisma:139-140`
- **Finding:** Both fields exist in the schema with encrypted naming convention. The `biomarkerController.ts` encrypts values at lines 231-234 (create), 318-323 (update), and decrypts at lines 60-63 (toResponse). Bulk creation in lines 484-487 also encrypts properly.

#### [x] PASS - BiomarkerHistory `valueEncrypted`
- **File:** `backend/prisma/schema.prisma:174`
- **Finding:** `valueEncrypted` field exists. History records are created from existing encrypted values in `biomarkerController.ts:304-310` (reusing the already-encrypted value from the parent biomarker) and decrypted in `toResponse()` at lines 66-73.

### Insurance

#### [x] PASS - InsurancePlan `memberIdEncrypted`, `groupIdEncrypted`
- **File:** `backend/prisma/schema.prisma:191-192`
- **Finding:** Both fields use encrypted column names. `insuranceController.ts` encrypts at lines 508-513 (create), 622-630 (update), and decrypts at lines 223-239 (toResponse) with proper error handling.

### Health Tracking

#### [x] PASS - HealthNeed `descriptionEncrypted`
- **File:** `backend/prisma/schema.prisma:435`
- **Finding:** Field exists. `healthNeedsController.ts` encrypts at line 171 (create), line 228 (update), and decrypts at line 47 (toResponse). Bulk creation at line 507 also encrypts.

#### [x] PASS - HealthGoal `descriptionEncrypted`
- **File:** `backend/prisma/schema.prisma:454`
- **Finding:** Field exists. `healthGoalsController.ts` encrypts at line 287-289 (create), line 386 (update), and decrypts at line 72 (toResponse).

#### [x] PASS - GoalProgressHistory `noteEncrypted`
- **File:** `backend/prisma/schema.prisma:489`
- **Finding:** Field exists. `healthGoalsController.ts` encrypts at lines 327 (initial history) and 501 (progress update), decrypts at line 113 (toResponse via progressHistory mapping).

### Provider Collaboration

#### [x] PASS - ProviderPatient `notesEncrypted`
- **File:** `backend/prisma/schema.prisma:98`
- **Finding:** Field exists. `providerRoutes.ts` encrypts notes at lines 136-138 using provider's encryption salt. The notes are encrypted with the provider's key (since the provider writes them).

### DNA/Genetic (deprecated but in schema)

#### [x] PASS - DNAVariant `genotypeEncrypted`
- **File:** `backend/prisma/schema.prisma:401`
- **Finding:** Field exists in schema. Listed in `PHI_FIELDS.DNAVariant` at `encryption.ts:395`. No active controller found (deprecated feature), but the schema correctly uses encrypted storage.

#### [x] PASS - GeneticTrait `descriptionEncrypted`, `recommendationsEncrypted`
- **File:** `backend/prisma/schema.prisma:417-418`
- **Finding:** Both fields exist. Listed in `PHI_FIELDS.GeneticTrait` at `encryption.ts:398-399`. No active controller (deprecated), but schema is correct.

### Expense Tracking

#### [x] PASS - ExpenseProjection: serviceType, estimatedCost, notes encrypted
- **File:** `backend/src/controllers/expenseController.ts:56-63`
- **Finding:** `createProjection()` encrypts `serviceType`, `estimatedCost`, and `notes` before database storage. `getProjections()` at lines 109-114 decrypts all three fields. `updateProjection()` at lines 138-148 re-encrypts on update.
- **File:** `backend/src/services/encryption.ts:419-421` -- PHI_FIELDS.ExpenseProjection lists all three fields.

#### [ ] FAIL - ExpenseActual: serviceType, providerName, billedAmount, insurancePaid, patientPaid, appliedToDeductible, appliedToOop, notes NOT encrypted in any controller
- **File:** `backend/src/services/encryption.ts:422-432` -- PHI_FIELDS.ExpenseActual lists 8 fields for encryption.
- **File:** `backend/src/routes/expenseRoutes.ts` -- No routes exist for ExpenseActual CRUD operations.
- **File:** `backend/src/controllers/expenseController.ts` -- No `createActual`, `getActuals`, `updateActual`, or `deleteActual` functions exist.
- **Finding:** The `ExpenseActual` model is defined in the Prisma schema (`schema.prisma:691-717`) with fields like `serviceType`, `providerName`, `billedAmount`, `insurancePaid`, `patientPaid` etc. These fields are listed in PHI_FIELDS but are stored as **plaintext** in the schema (no `Encrypted` suffix on column names). No controller implements CRUD for this model, so either the feature is unimplemented or data is being written elsewhere without encryption.
- **Severity:** HIGH -- If ExpenseActual records are created by any code path, they would contain plaintext PHI (service types, provider names, dollar amounts).

### AI Responses

#### [x] PASS - CostAnalysis `claudeResponse` encrypted
- **File:** `backend/src/controllers/expenseController.ts:323`
- **Finding:** `claudeResponse: encryption.encrypt(claudeResponse, userSalt)` -- The AI response is encrypted before storage. `totalProjectedOop` and `projectedExpensesSnapshot` are also encrypted at lines 324-328. Decryption occurs in `getAnalyses()` at lines 375-384.

### Audit Logs

#### [x] PASS - AuditLog `previousValueEncrypted`, `newValueEncrypted`
- **File:** `backend/prisma/schema.prisma:508-509`
- **Finding:** Both fields use encrypted naming. `auditLog.ts:169-179` encrypts values via `encryptValue()` method before storage (lines 194-195 in the `log()` method). The method handles both string and object values (JSON.stringify for objects).

---

## 5. Encryption Service Usage

### [x] PASS - All PHI writes go through encryption service
- **Finding:** Reviewed all 9 controllers. Every controller that writes PHI fields calls `getEncryptionService()` and `getUserEncryptionSalt()` before constructing database write payloads. The encryption service is the only code path that handles raw PHI-to-ciphertext conversion.
- **Exception:** ExpenseActual (see Section 4 finding above -- no controller exists).

### [x] PASS - All PHI reads go through decryption
- **Finding:** Every controller that returns PHI data has a `toResponse()` or equivalent function that decrypts fields before sending to the client.
- **Exception:** Provider routes (`providerRoutes.ts:277-287`) return raw biomarker data (including `valueEncrypted` field) to providers **without decryption**. See finding below.

### [~] PARTIAL - No plaintext PHI in logs
- **File:** `backend/src/utils/logger.ts:21-27`
- **Finding:** The logger has a comprehensive `SENSITIVE_FIELDS` set that redacts known PHI field names. However:
  1. `insuranceController.ts:227,236` uses `console.error` directly (bypassing the logger) to log decryption failures with the plan ID. The plan ID itself is not PHI, but this bypasses the sanitization pipeline.
  2. `biomarkerController.ts:264-268` passes `input.value` (a numeric biomarker value) to the audit log's `newValue` field. The audit service encrypts this, so it is safe. But the value is briefly in the `logCreate` call's parameter -- acceptable since audit log encrypts it.
- **Severity:** LOW -- The `console.error` calls in `insuranceController.ts` do not leak actual PHI, only plan IDs and error objects.

### [x] PASS - Error messages don't leak plaintext data
- **Finding:** All error responses use generic messages like "Biomarker not found", "Failed to create expense projection", etc. The `encryption.ts:334` `decryptFields()` logs `Failed to decrypt field: ${fieldName}` (field name only, not the value). Error messages in `auditLog.ts:204-214` redact `previousValue` and `newValue` with `[REDACTED]`.

### [x] PASS - Decryption errors handled gracefully (corrupted data doesn't crash)
- **File:** `backend/src/services/encryption.ts:330-341`
- **Finding:** `decryptFields()` wraps each field decryption in try/catch and logs a warning if decryption fails, keeping the original (encrypted) value. This prevents application crashes from corrupted or re-keyed data.
- **File:** `backend/src/controllers/insuranceController.ts:224-239` -- memberId and groupId decryption failures are caught individually and return `undefined` instead of crashing.
- **File:** `backend/src/services/auditLog.ts:176-179` -- `encryptValue()` returns `[ENCRYPTION_FAILED]` on error rather than throwing.

---

## 6. Memory Safety

### [ ] FAIL - Sensitive data cleared from memory after use
- **Finding:** No explicit memory clearing (e.g., `Buffer.fill(0)`) is performed on:
  - Derived user keys after encryption/decryption operations (`encryption.ts:172-180` -- `deriveUserKey` returns the key buffer but never zeroes it)
  - Decrypted plaintext values after they are no longer needed
  - The master key buffer (`this.masterKey`) which persists for the singleton lifetime
- **Severity:** MEDIUM -- In a Node.js environment, manual memory clearing has limited effectiveness due to garbage collection, V8 string interning, and the lack of `SecureBuffer`. However, HIPAA best practices recommend minimizing the window of plaintext exposure. The singleton pattern means the master key buffer lives for the process lifetime, which is acceptable for a server process.

### [x] PASS - No plaintext PHI stored in global variables
- **Finding:** The encryption service singleton stores only the master key Buffer (not PHI). No global variables contain plaintext PHI. All PHI is decrypted within function scope and returned in response objects (which are garbage-collected after the response is sent).

### [~] PARTIAL - PDF/document buffers cleared after processing
- **File:** `backend/src/utils/securePdfParsing.ts`
- **Finding:** The `secureParsePdf()` function monitors memory usage and has timeout protection. However, the file `Buffer` from multer is not explicitly zeroed after processing. The buffer will be garbage-collected when the request handler completes, but it remains in memory until GC runs.
- **Severity:** LOW -- Node.js does not provide a reliable mechanism to zero multer buffers before GC.

### [~] PARTIAL - Encryption keys not retained beyond function scope
- **File:** `backend/src/services/encryption.ts:353-361`
- **Finding:** The `EncryptionService` is a singleton (`encryptionServiceInstance`) that retains `this.masterKey` for the process lifetime. Derived user keys are created within `deriveUserKey()` and returned by value -- they are not cached. However, PBKDF2 is called synchronously, and the derived key buffer is not zeroed after use.
- **Severity:** LOW -- Derived keys exist briefly in function scope. The singleton master key pattern is standard for server processes.

---

## Additional Findings

### FINDING-A: Provider Routes Return Encrypted Data Without Decryption (HIGH)

- **File:** `backend/src/routes/providerRoutes.ts:277-287`
- **Finding:** The `GET /api/v1/provider/patients/:patientId/biomarkers` endpoint returns raw biomarker records from Prisma without decrypting `valueEncrypted` or `notesEncrypted`. Providers would receive ciphertext instead of readable values.
- **Same issue at:** `backend/src/routes/providerRoutes.ts:320-329` -- health needs returned with `descriptionEncrypted` in ciphertext.
- **Same issue at:** `backend/src/routes/providerRoutes.ts:44-53` -- patient list includes `firstNameEncrypted` and `lastNameEncrypted` but the `toResponse` mapping at lines 57-78 omits decryption (comments on line 64: "Note: firstName/lastName would need decryption in a real app").
- **Impact:** Provider-facing endpoints are non-functional for viewing PHI data, or if functioning, they return ciphertext strings.
- **Severity:** HIGH -- Either a functionality gap or a design decision that needs documentation. Decryption would require the patient's encryption salt, which creates a cross-user key access pattern that needs careful consideration.

### FINDING-B: Audit Log Salt Stored in Plaintext in SystemConfig (MEDIUM)

- **File:** `backend/src/services/auditLog.ts:106-124`
- **Finding:** The audit encryption salt is stored in the `SystemConfig` table with `isEncrypted: false`. The comment on line 119 explicitly notes: "The salt itself is not encrypted". While the salt alone cannot decrypt data without the master key, storing the salt in plaintext reduces the defense-in-depth posture. If the database is compromised, an attacker with the salt and master key can decrypt all audit log values.
- **Mitigation:** The salt is only useful in combination with the master key (which is in the environment, not the database). However, per-user salts are encrypted with the master key before storage -- the audit salt should follow the same pattern for consistency.
- **Severity:** MEDIUM

### FINDING-C: ExpenseActual Schema Fields Not Using Encrypted Naming Convention (HIGH)

- **File:** `backend/prisma/schema.prisma:691-717`
- **Finding:** The `ExpenseActual` model has fields like `serviceType`, `providerName`, `billedAmount`, `insurancePaid`, `patientPaid`, `appliedToDeductible`, `appliedToOop`, and `notes` stored as plaintext database types (`String`, `Decimal`, etc.) rather than encrypted text fields. The `PHI_FIELDS` constant in `encryption.ts:422-432` lists these fields, but the schema does not use `Encrypted` suffixed names, and no controller exists to encrypt/decrypt them.
- **Comparison:** `ExpenseProjection` fields like `serviceType` and `estimatedCost` are stored as `String`/`Decimal` in the schema but are encrypted in the controller. The inconsistency suggests ExpenseActual CRUD is unimplemented.
- **Severity:** HIGH -- If any code path writes to `ExpenseActual`, PHI will be stored in plaintext.

### FINDING-D: CostAnalysis `projectedExpensesSnapshot` Stored as Json Type but Encrypted as String (LOW)

- **File:** `backend/prisma/schema.prisma:727`
- **Finding:** The `projectedExpensesSnapshot` field is typed as `Json?` in Prisma, but `expenseController.ts:328` stores it as `encryption.encrypt(JSON.stringify(decryptedProjections), userSalt)` -- an encrypted string. This type mismatch could cause Prisma to reject the value or store it incorrectly depending on the database driver behavior.
- **Severity:** LOW -- Needs verification that encrypted strings are accepted in Json columns.

### FINDING-E: `console.error` Bypasses Logger Sanitization (LOW)

- **File:** `backend/src/controllers/insuranceController.ts:227,236`
- **Finding:** Direct `console.error` calls: `console.error(\`[Insurance] Failed to decrypt memberId for plan ${plan.id}:\`, error)`. These bypass the logger's `sanitizeData()` function. While the logged data (plan ID and error object) is not PHI itself, using the centralized logger would be more consistent.
- **Severity:** LOW

---

## Verification Command Results Summary

### Encrypted fields in schema
All expected PHI fields use `Encrypted` suffixed names in the schema, with the exception of `ExpenseProjection` and `ExpenseActual` which use application-layer encryption on standard-named fields.

### Files using encryption service
18 files import or reference encryption/decryption functions:
- All 8 data controllers (biomarker, expense, healthGoals, healthNeeds, insurance, settings, upload)
- Services: encryption.ts, userEncryption.ts, auditLog.ts, database.ts
- Routes: providerRoutes.ts
- Utils: securePdfParsing.ts, batchProcessor.ts, logger.ts

### Potential plaintext PHI storage
- `ExpenseActual` model fields are not encrypted in any controller
- Provider routes return encrypted fields without decryption (ciphertext returned, not plaintext exposure)

---

## Checklist Summary

| # | Item | Status | Notes |
|---|------|--------|-------|
| **1. Encryption Implementation** | | | |
| 1.1 | AES-256-GCM used | PASS | `encryption.ts:58` |
| 1.2 | Unique IV per operation | PASS | `crypto.randomBytes(16)` each call |
| 1.3 | Auth tag verified | PASS | `setAuthTag()` on all decryptions |
| 1.4 | No ECB mode | PASS | Only GCM found |
| **2. Key Management** | | | |
| 2.1 | Master key from env var | PASS | `PHI_ENCRYPTION_KEY` |
| 2.2 | Key not hardcoded | PASS | Only blocklist/test values |
| 2.3 | Key not logged | PASS | Logger redacts sensitive fields |
| 2.4 | Proper KDF used | PASS | PBKDF2-SHA512, 100k iterations |
| **3. Per-User Key Management** | | | |
| 3.1 | Salt in UserEncryptionKey table | PASS | Schema confirmed |
| 3.2 | Salt encrypted with master key | PASS | `encryptWithMasterKey()` used |
| 3.3 | PBKDF2-SHA512, 100k iterations | PASS | `encryption.ts:69-70` |
| 3.4 | 32-byte random salt | PASS | `SALT_LENGTH = 32` |
| 3.5 | Key rotation supported | PASS | Version tracking, isActive flag |
| 3.6 | Salt created on registration | PARTIAL | Lazy-init on first PHI access |
| 3.7 | Salt destroyed on deletion | PASS | Cascade delete on user |
| **4. PHI Field Coverage** | | | |
| 4.1 | User PII fields | PASS | All 5 fields encrypted |
| 4.2 | Biomarker value/notes | PASS | Encrypted in all paths |
| 4.3 | BiomarkerHistory value | PASS | Encrypted |
| 4.4 | InsurancePlan memberId/groupId | PASS | Encrypted |
| 4.5 | HealthNeed description | PASS | Encrypted |
| 4.6 | HealthGoal description | PASS | Encrypted |
| 4.7 | GoalProgressHistory note | PASS | Encrypted |
| 4.8 | ProviderPatient notes | PASS | Encrypted |
| 4.9 | DNAVariant genotype | PASS | Schema correct (deprecated) |
| 4.10 | GeneticTrait description/recommendations | PASS | Schema correct (deprecated) |
| 4.11 | ExpenseProjection fields | PASS | Encrypted in controller |
| 4.12 | ExpenseActual fields | **FAIL** | No controller/encryption exists |
| 4.13 | CostAnalysis claudeResponse | PASS | Encrypted |
| 4.14 | AuditLog previous/new values | PASS | Encrypted via `encryptValue()` |
| **5. Encryption Service Usage** | | | |
| 5.1 | All PHI writes encrypted | PARTIAL | ExpenseActual missing |
| 5.2 | All PHI reads decrypted | PARTIAL | Provider routes skip decryption |
| 5.3 | No plaintext PHI in logs | PASS | Logger sanitizes, minor console.error |
| 5.4 | Error messages safe | PASS | Generic messages only |
| 5.5 | Graceful decryption errors | PASS | Try/catch with fallbacks |
| **6. Memory Safety** | | | |
| 6.1 | Sensitive data cleared | **FAIL** | No explicit Buffer.fill(0) |
| 6.2 | No global plaintext PHI | PASS | Only master key in singleton |
| 6.3 | PDF buffers cleared | PARTIAL | GC-dependent cleanup |
| 6.4 | Keys not retained | PARTIAL | Master key in singleton (acceptable) |

---

## Recommendations (Priority Order)

### HIGH Priority
1. **Implement ExpenseActual encryption** -- Create controller with encrypt/decrypt for all 8 PHI fields listed in `PHI_FIELDS.ExpenseActual`, or remove the model if the feature is not needed.
2. **Fix provider routes decryption** -- Implement proper cross-user decryption for provider-facing endpoints, or document the intentional limitation. This likely requires accessing the patient's encryption salt when the provider queries their data.
3. **Encrypt audit log salt** -- Store the audit encryption salt using `encryptWithMasterKey()` for consistency with per-user salt storage.

### MEDIUM Priority
4. **Verify `projectedExpensesSnapshot` Json column compatibility** -- Test that encrypted strings are properly stored/retrieved from Prisma `Json?` columns.
5. **Replace `console.error` with logger** -- Use the centralized logger in `insuranceController.ts:227,236` to maintain consistent sanitization.

### LOW Priority
6. **Consider eager salt creation** -- Call `getUserEncryptionSalt()` during `createUser()` to avoid first-operation latency.
7. **Document memory safety limitations** -- Node.js inherently limits manual memory clearing; document this as an accepted risk in the security posture.

---

## Questions for the Development Team

1. **Are `ExpenseActual` records being created by any code path?** The model exists in the schema with a relation to `ExpenseProjection`, but no CRUD controller was found. If any external process (migration, seed, admin tool) writes to this table, PHI would be stored in plaintext.

2. **Is the encryption key being rotated periodically?** The infrastructure for per-user key rotation exists (`rotateUserEncryptionKey`), but no scheduled rotation mechanism or admin endpoint was found. What is the rotation policy?

3. **How should provider access to patient PHI work?** The current provider routes return encrypted data. The design challenge is that PHI is encrypted with the patient's salt, but the provider needs to read it. Options: (a) decrypt with patient's salt server-side when provider has permission, (b) re-encrypt shared data with a relationship-specific key, or (c) accept the current behavior and decrypt client-side (not recommended).

4. **Is the `projectedExpensesSnapshot` Json column intentional?** The field stores an encrypted string but is typed as `Json?` in Prisma. This may cause type errors or silent data corruption.

5. **Are AI responses (Claude) considered PHI for retention purposes?** The `claudeResponse` field is encrypted, which is correct. But should old cost analyses be subject to the same 7-year retention as audit logs, or can they be purged earlier?
