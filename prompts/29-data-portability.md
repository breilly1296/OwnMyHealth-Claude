---
tags:
  - security
  - hipaa
  - medium
type: prompt
priority: 3
updated: 2026-06-01
---

# Data Portability & Deletion Security Review

## Files to Review
- `backend/src/controllers/settingsController.ts` (`exportUserData`, `deleteAllData`, `deleteAccount` handlers)
- `backend/src/routes/settingsRoutes.ts` (settings endpoints; all use `sensitiveLimiter` + `blockDemoProfileUpdate`)
- `backend/src/services/encryption.ts` (`PHI_FIELDS` constant ~line 410; decryption for export)
- `backend/src/services/userEncryption.ts` (per-user salt lifecycle — note: there is NO explicit key-destruction call; `UserEncryptionKey` rows cascade from `User` on account delete)
- `backend/src/services/healthProfileService.ts` (`getDecryptedHealthProfile`, `saveHealthProfile` — self-reported profile in export scope)
- `backend/src/services/fhir/labSyncService.ts` (`revokeAllUserConnections`, `disconnectConnection` — OAuth token revocation before LabConnection delete)
- `backend/src/services/storageService.ts` (`deleteFiles` GCS cleanup, returns per-key `{ ok, error }`)
- `backend/src/services/auditLog.ts` (audit log retention on deletion; PHI in audit logs encrypted with `config.auditSalt` / `AUDIT_LOG_SALT`, not the user salt)
- `backend/prisma/schema.prisma` (cascade delete relationships; `AuditLog.user` is the only non-cascading User relation)
- `src/services/api/settings.ts` (frontend settings API)
- `src/components/settings/AccountSettingsPage.tsx` (export/delete UI)
- `src/components/settings/LabConnectionsSection.tsx`, `HealthProfileSection.tsx`, `PlanSection.tsx`, `NotificationSettingsSection.tsx` (settings sub-sections)

## OwnMyHealth Data Portability Architecture
- **Export**: JSON download of all user data (`exportUserData`) — biomarkers (+ history), insurance plans (+ benefits), health goals (+ progress), health needs, expense projections/actuals, cost analyses, file metadata, provider relationships, AND the self-reported `healthProfile` (decrypted via `getDecryptedHealthProfile`). Cited as the §164.524 right-of-access export in code.
- **Data Deletion**: Two modes — `deleteAllData` (health data only, keep account) or `deleteAccount` (full deletion). BOTH now require password confirmation (validated by `verifyPassword`).
- **Encryption**: All PHI decrypted for export. On account deletion the per-user salt row (`UserEncryptionKey`) is removed via Prisma `onDelete: Cascade` from `User` — there is NO explicit key-destroy call in `userEncryption.ts` (the old key-rotation helper was removed). `deleteAllData` does NOT touch `UserEncryptionKey` (account/key survive).
- **Lab Connections (Quest FHIR)**: `deleteAccount` calls `revokeAllUserConnections` to best-effort revoke OAuth tokens at the provider BEFORE the `LabConnection` cascade delete; `deleteAllData` wipes `LabConnection` rows explicitly (account survives) but only revokes locally, not at the provider.
- **File Cleanup**: GCS objects deleted via `storageService.deleteFiles` BEFORE DB rows ("GCS first, fail hard" — see C-6); any non-404 GCS failure aborts with DB intact for retry.
- **Audit Retention**: Audit logs retained for 7 years even after account deletion (HIPAA). `AuditLog.userId` is nullable and the `user` relation does NOT cascade, so audit rows survive user deletion. Encrypted PHI snapshots in audit logs use the system salt (`config.auditSalt` / `AUDIT_LOG_SALT`), so they remain decryptable after the user's salt is gone.

## Checklist

### 1. Data Export Completeness
- [ ] Export includes ALL user data categories:
  - User profile (decrypted name, DOB, phone, address)
  - Self-reported health profile (`healthProfile`: conditions, medications, family history, etc. — feeds AI, MUST be in §164.524 export)
  - Biomarkers (decrypted values, notes, history)
  - Insurance plans (decrypted member/group IDs) AND per-plan benefits
  - Health goals (decrypted descriptions, target values, progress)
  - Health needs (decrypted descriptions)
  - Expense projections and actuals
  - Cost analyses (decrypted `claudeResponse` — JSON key keeps legacy name despite `claudeResponseEncrypted` column rename)
  - Uploaded file metadata (id/storageKey/filename — bytes downloaded separately, per `filesNote`)
  - Provider relationships (status, permissions, dates)
- [ ] PHI fields properly decrypted for export (`encryptionService.decrypt` with the user salt from `getUserEncryptionSalt`)
- [ ] LabConnection rows are deliberately NOT exported (only OAuth tokens + provider link — confirm this is intentional; verify no user-facing lab metadata is silently dropped)
- [ ] Export includes metadata (dates, categories, sources)
- [ ] Export format documented and machine-readable (JSON)
- [ ] Export is a single download (no partial exports)
- [ ] No other users' data included in export

### 2. Export Security
- [ ] Export endpoint requires authentication (`router.use(authenticate)`)
- [ ] Export endpoint rate limited (`sensitiveLimiter` — verify it's appropriate for a full-record dump)
- [ ] Export audit logged with per-category counts (`auditService.logAccess('UserData', ..., { operation: 'EXPORT' })`)
- [ ] Export doesn't include `passwordHash` or other internal-only fields
- [ ] Export doesn't include encryption keys or salts
- [ ] Export response sets no-cache headers (`Cache-Control: no-store, no-cache, private, must-revalidate`, `Pragma`, `Expires: 0`)
- [ ] Large exports handled without server memory issues (decryption uses `processBatch` with `DECRYPT_BATCH_SIZE = 20`)

### 3. Health Data Deletion (Keep Account) — `deleteAllData`
- [ ] Requires password confirmation (`verifyPassword` before any deletion — as destructive as full deletion)
- [ ] Deletes biomarkers, history, and related records (BiomarkerHistory cascades from Biomarker)
- [ ] Deletes insurance plans and benefits (InsuranceBenefit cascades from InsurancePlan)
- [ ] Deletes health goals and progress history (GoalProgressHistory cascades from HealthGoal)
- [ ] Deletes health needs
- [ ] Deletes expense projections, actuals, and cost analyses (ordered: cost analyses → actuals → projections, to respect FKs)
- [ ] Deletes `LabConnection` rows explicitly (account survives so no cascade; verify local-only revoke vs provider revoke is acceptable)
- [ ] Deletes uploaded files (DB records AND GCS objects via `storageService.deleteFiles`, GCS-first)
- [ ] Preserves user account, sessions, credentials, AND `UserEncryptionKey` (salt)
- [ ] Preserves audit logs (HIPAA requirement)
- [ ] DB deletes are transactional (`withRLSTransaction`); GCS deletion runs first, outside the txn, and aborts on failure
- [ ] Deletion audit logged with per-category counts (`auditService.logDelete('UserData', ...)`)

### 4. Full Account Deletion — `deleteAccount`
- [ ] Requires password confirmation (prevent accidental deletion; `verifyPassword`)
- [ ] Single `tx.user.delete` relies on Prisma `onDelete: Cascade` to drop all child rows (sessions, encryption key, files, biomarkers, insurance, goals, needs, expenses, cost analyses, provider relations, lab connections) — verify EVERY user-owned table cascades from User
- [ ] Per-user encryption salt (`UserEncryptionKey`) removed via cascade (no explicit destroy call — confirm cascade is wired)
- [ ] (DNA/Genetics REMOVED) `DNAVariant` / `GeneticTrait` models were dropped in migration `20260423_drop_dna_genetics`; a stale code comment still says "DNA/lab connections" — there is no DNA data to delete
- [ ] Revokes Quest FHIR OAuth tokens at provider BEFORE cascade (`revokeAllUserConnections`, best-effort) so tokens don't outlive the deleted `LabConnection` rows
- [ ] Revokes all provider relationships (ProviderPatient cascades for both patient and provider sides)
- [ ] Removes user from provider's patient lists
- [ ] GCS files for user removed from bucket BEFORE the cascade (storageKeys enumerated first; "GCS first, fail hard", any non-404 failure aborts and account is preserved)
- [ ] Audit logs PRESERVED (7-year HIPAA retention; `AuditLog.user` relation is non-cascading and `userId` is nullable)
- [ ] DELETE-then-cascade runs in admin RLS context (`withRLSContext(null, ...)`)
- [ ] Account cannot be recovered after deletion

### 5. Cascade Integrity
- [ ] Prisma schema defines proper `onDelete` cascades (verify against `schema.prisma`):
  - User → Sessions (cascade)
  - User → UserEncryptionKey (cascade)
  - User → UserFiles (cascade)
  - User → Biomarkers (cascade)
  - User → InsurancePlans (cascade)
  - User → HealthNeeds (cascade)
  - User → HealthGoals (cascade)
  - User → ExpenseProjections / ExpenseActuals / CostAnalysis (cascade)
  - User → ProviderPatient (cascade, both `PatientUser` and `ProviderUser` relations)
  - User → LabConnection (cascade)
  - User → AuditLog: NON-cascading (intentional — audit logs survive deletion)
  - Biomarker → BiomarkerHistory (cascade)
  - HealthGoal → GoalProgressHistory (cascade)
  - InsurancePlan → InsuranceBenefit (cascade)
  - InsurancePlan → ExpenseProjections / ExpenseActuals / CostAnalysis (cascade)
  - ExpenseProjection → ExpenseActual: `onDelete: SetNull` (NOT cascade — actuals survive projection deletion with `projectionId` nulled)
- [ ] No orphaned records after deletion (DNAVariant/GeneticTrait models removed — no orphan risk there anymore)
- [ ] No foreign key violations during deletion (manual `deleteAllData` deletes cost analyses + expense actuals before projections/plans to respect FK order)

### 6. Encryption Key Lifecycle
- [ ] Per-user encryption salt (`UserEncryptionKey`) removed on account deletion — via `onDelete: Cascade`, NOT an explicit destroy call. Confirm the cascade actually fires from `tx.user.delete`
- [ ] Master key (`PHI_ENCRYPTION_KEY`) NOT affected by individual user deletion (salt encrypted with master key via `encryptWithMasterKey`)
- [ ] Key rotation: the old `userEncryption.ts` rotation helper was REMOVED (it changed the salt without re-encrypting PHI — a data-bricking footgun); the `KEY_ROTATION` AuditAction enum value is retained for future dedicated re-encryption work. Verify no caller expects rotation
- [ ] After the salt row is gone, that user's encrypted data is permanently unrecoverable
- [ ] `deleteAllData` (keep-account) intentionally PRESERVES `UserEncryptionKey` — confirm new PHI written afterward still decrypts with the same salt

### 7. Audit Log Preservation
- [ ] Audit logs survive account deletion (HIPAA 7-year requirement; `AuditLog.user` relation is non-cascading)
- [ ] Audit logs reference `userId` (nullable) but don't depend on user existence
- [ ] Deleted user's audit logs still queryable by admin
- [ ] Audit logs retain encrypted PHI values using the SYSTEM salt (`config.auditSalt` from `AUDIT_LOG_SALT`, length-validated at config load), NOT the per-user salt — so they stay decryptable after the user's `UserEncryptionKey` cascade-deletes (`auditLog.ts` `systemSalt`, ~line 148/220)

## Verification Commands
```bash
# Check export handler (and that healthProfile is in scope)
grep -n "exportUserData\|getDecryptedHealthProfile\|healthProfile" backend/src/controllers/settingsController.ts

# Check deletion handlers
grep -n "deleteAllData\|deleteAccount\|revokeAllUserConnections" backend/src/controllers/settingsController.ts

# Check cascade deletes in schema (AuditLog.user must NOT cascade)
grep -n "onDelete\|model AuditLog" backend/prisma/schema.prisma

# Check GCS cleanup (bulk deleteFiles, GCS-first/fail-hard)
grep -n "deleteFiles\|storageService" backend/src/controllers/settingsController.ts

# Confirm NO explicit key-destroy exists (salt removal is cascade-only)
grep -n "deleteKey\|destroyKey\|userEncryptionKey.*delete" backend/src/services/userEncryption.ts

# Verify PHI_FIELDS is current (healthProfileEncrypted, LabConnection tokens, targetValueEncrypted)
grep -n "healthProfileEncrypted\|accessTokenEncrypted\|claudeResponseEncrypted" backend/src/services/encryption.ts

# Verify audit logs use the SYSTEM salt, not the user salt
grep -n "systemSalt\|auditSalt" backend/src/services/auditLog.ts

# Confirm DNA/Genetics models are gone
grep -rn "DNAVariant\|GeneticTrait" backend/prisma/schema.prisma   # expect: no matches
```

## Questions to Ask
1. Does the data export include ALL user data categories — including the self-reported `healthProfile`?
2. Are GCS files deleted (GCS-first) when a user deletes their account or wipes health data?
3. Is the per-user salt actually removed on account deletion? (It relies on cascade, not an explicit destroy — is the cascade wired and tested?)
4. Are Quest FHIR OAuth tokens revoked at the provider before `LabConnection` rows are deleted?
5. Are audit logs preserved after account deletion, and do their encrypted PHI snapshots stay decryptable (system salt)?
6. Can a deleted account be recovered? Is there any grace period / soft-delete before permanent deletion? (None found in code — confirm intent.)
7. Should `deleteAllData` revoke lab-connection tokens at the provider (not just locally), like `deleteAccount` does?
