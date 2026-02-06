---
tags:
  - security
  - hipaa
  - medium
type: prompt
priority: 3
---

# Data Portability & Deletion Security Review

## Files to Review
- `backend/src/controllers/settingsController.ts` (export, delete handlers)
- `backend/src/routes/settingsRoutes.ts` (settings endpoints)
- `backend/src/services/encryption.ts` (decryption for export)
- `backend/src/services/userEncryption.ts` (key cleanup on deletion)
- `backend/src/services/storageService.ts` (GCS file cleanup)
- `backend/src/services/auditLog.ts` (audit log retention on deletion)
- `backend/prisma/schema.prisma` (cascade delete relationships)
- `src/services/api/settings.ts` (frontend settings API)
- `src/components/settings/AccountSettingsPage.tsx` (export/delete UI)

## OwnMyHealth Data Portability Architecture
- **Export**: JSON download of all user data (biomarkers, insurance plans, goals, etc.)
- **Data Deletion**: Two modes — health data only (keep account) or full account deletion
- **Encryption**: All PHI decrypted for export, encryption keys destroyed on account deletion
- **File Cleanup**: GCS objects deleted when account deleted
- **Audit Retention**: Audit logs retained for 7 years even after account deletion (HIPAA)

## Checklist

### 1. Data Export Completeness
- [ ] Export includes ALL user data categories:
  - Biomarkers (decrypted values, notes, history)
  - Insurance plans (decrypted member/group IDs)
  - Health goals (decrypted descriptions, progress)
  - Health needs (decrypted descriptions)
  - Expense projections and actuals
  - Cost analyses
  - Uploaded file metadata (not file content — or separate download)
  - Provider relationships (status, permissions, dates)
- [ ] PHI fields properly decrypted for export
- [ ] Export includes metadata (dates, categories, sources)
- [ ] Export format documented and machine-readable (JSON)
- [ ] Export is a single download (no partial exports)
- [ ] No other users' data included in export

### 2. Export Security
- [ ] Export endpoint requires authentication
- [ ] Export endpoint rate limited (prevent abuse)
- [ ] Export audit logged (HIPAA: PHI_EXPORT action)
- [ ] Export doesn't include password hashes or internal IDs
- [ ] Export doesn't include encryption keys or salts
- [ ] Export response uses secure headers (no caching)
- [ ] Large exports handled without server memory issues

### 3. Health Data Deletion (Keep Account)
- [ ] Deletes biomarkers, history, and related records
- [ ] Deletes insurance plans and benefits
- [ ] Deletes health goals and progress history
- [ ] Deletes health needs
- [ ] Deletes expense projections, actuals, and analyses
- [ ] Deletes uploaded files (DB records AND GCS objects)
- [ ] Preserves user account, sessions, and credentials
- [ ] Preserves audit logs (HIPAA requirement)
- [ ] Deletion is transactional (all-or-nothing)
- [ ] Deletion audit logged

### 4. Full Account Deletion
- [ ] Requires password confirmation (prevent accidental deletion)
- [ ] Deletes all data from health data deletion (above)
- [ ] Deletes user record
- [ ] Deletes all sessions (invalidates all tokens)
- [ ] Destroys per-user encryption keys (UserEncryptionKey records)
- [ ] Deletes DNA data, variants, and genetic traits (if present)
- [ ] Revokes all provider relationships
- [ ] Removes user from provider's patient lists
- [ ] GCS files for user completely removed from bucket
- [ ] Audit logs PRESERVED (7-year HIPAA retention, even after deletion)
- [ ] Deletion is transactional
- [ ] Account cannot be recovered after deletion

### 5. Cascade Integrity
- [ ] Prisma schema defines proper `onDelete` cascades:
  - User → Biomarkers (cascade)
  - User → InsurancePlans (cascade)
  - User → HealthGoals (cascade)
  - User → HealthNeeds (cascade)
  - User → Sessions (cascade)
  - User → UserEncryptionKeys (cascade)
  - User → UserFiles (cascade)
  - Biomarker → BiomarkerHistory (cascade)
  - HealthGoal → GoalProgressHistory (cascade)
  - InsurancePlan → InsuranceBenefits (cascade)
  - InsurancePlan → ExpenseProjections (cascade)
  - InsurancePlan → ExpenseActuals (cascade)
  - ProviderPatient → removed for both provider and patient
- [ ] No orphaned records after deletion
- [ ] No foreign key violations during deletion

### 6. Encryption Key Lifecycle
- [ ] Per-user encryption salt destroyed on account deletion
- [ ] Master key NOT affected by individual user deletion
- [ ] Key rotation doesn't break existing encrypted data
- [ ] After key destruction, encrypted data is permanently unrecoverable
- [ ] Key destruction audit logged

### 7. Audit Log Preservation
- [ ] Audit logs survive account deletion (HIPAA 7-year requirement)
- [ ] Audit logs reference userId but don't depend on user existence
- [ ] Deleted user's audit logs still queryable by admin
- [ ] Audit logs retain encrypted PHI values (with system salt, not user salt)

## Verification Commands
```bash
# Check export endpoint
grep -r "export\|exportData\|export-data" backend/src/controllers/settingsController.ts

# Check deletion handlers
grep -r "deleteAll\|deleteAccount\|delete-data\|delete-account" backend/src/controllers/settingsController.ts

# Check cascade deletes in schema
grep -r "onDelete" backend/prisma/schema.prisma

# Check GCS cleanup
grep -r "deleteFile\|delete.*storage\|removeFile" backend/src/services/storageService.ts

# Check encryption key cleanup
grep -r "deleteKey\|destroyKey\|removeKey\|encryptionKey.*delete" backend/src/services/userEncryption.ts

# Verify audit log preservation
grep -r "auditLog.*delete\|delete.*auditLog" backend/src/controllers/settingsController.ts
```

## Questions to Ask
1. Does the data export include ALL user data categories?
2. Are GCS files deleted when a user deletes their account?
3. Are encryption keys properly destroyed on account deletion?
4. Are audit logs preserved after account deletion (HIPAA)?
5. Can a deleted account be recovered?
6. Is there a grace period before permanent deletion?
