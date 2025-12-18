---
tags: [security, hipaa, review]
type: prompt
priority: 1
---

# Database Schema Review

## Files to Review
- `backend/prisma/schema.prisma` (primary source)

## OwnMyHealth-Specific Patterns

This codebase uses a consistent PHI encryption pattern:
- All PHI fields end with `Encrypted` suffix (e.g., `firstNameEncrypted`, `valueEncrypted`)
- Non-PHI metadata fields use regular naming

## Checklist

### 1. PHI Field Identification
- [ ] Verify ALL PHI fields have `Encrypted` suffix:
  - User: `firstNameEncrypted`, `lastNameEncrypted`, `dateOfBirthEncrypted`, `phoneEncrypted`, `addressEncrypted`
  - Biomarker: `valueEncrypted`, `notesEncrypted`
  - InsurancePlan: `memberIdEncrypted`, `groupIdEncrypted`
  - DNAVariant: `genotypeEncrypted`
  - GeneticTrait: `descriptionEncrypted`, `recommendationsEncrypted`
  - HealthNeed: `descriptionEncrypted`
  - HealthGoal: `descriptionEncrypted`
  - ProviderPatient: `notesEncrypted`
  - AuditLog: `previousValueEncrypted`, `newValueEncrypted`
  - GoalProgressHistory: `noteEncrypted`

### 2. Schema Security
- [ ] All PHI fields are `@db.Text` type (for encrypted data length)
- [ ] UUIDs used for all IDs (`@id @default(uuid()) @db.Uuid`)
- [ ] Cascade delete configured correctly (prevent orphaned PHI)
- [ ] Email is unique and indexed
- [ ] No PHI stored in plain text

### 3. Relationships
- [ ] User -> Biomarkers (one-to-many with cascade delete)
- [ ] User -> InsurancePlans (one-to-many with cascade delete)
- [ ] User -> DNAData (one-to-many with cascade delete)
- [ ] User -> Sessions (one-to-many with cascade delete)
- [ ] User -> AuditLogs (one-to-many, SetNull on delete for audit retention)
- [ ] ProviderPatient relationship properly configured

### 4. HIPAA Compliance
- [ ] AuditLog model exists with required fields:
  - userId, actorType, action, resourceType, resourceId
  - ipAddress, userAgent, sessionId
  - previousValueEncrypted, newValueEncrypted
  - createdAt (with DESC index for queries)
- [ ] Session model tracks: userId, token, ipAddress, userAgent, expiresAt
- [ ] UserEncryptionKey model for per-user encryption keys

### 5. Indexing
- [ ] Indexes on frequently queried fields:
  - `users.email`
  - `sessions.token`, `sessions.userId`, `sessions.expiresAt`
  - `audit_logs.createdAt` (both ASC and DESC)
  - `biomarkers.userId`, `biomarkers.category`
- [ ] No indexes on encrypted PHI fields (useless for queries)

### 6. Account Security
- [ ] User model has lockout fields: `failedLoginAttempts`, `lockedUntil`, `lastFailedLogin`
- [ ] Email verification fields: `emailVerified`, `emailVerificationToken`, `emailVerificationExpires`
- [ ] Password reset fields: `passwordResetToken`, `passwordResetExpires`

## Red Flags
- Any field containing name, DOB, phone, address, SSN, or medical data without `Encrypted` suffix
- PHI stored in JSON fields without encryption
- Missing cascade delete on PHI-containing models
- AuditLog allowing UPDATE or DELETE (should be immutable)
