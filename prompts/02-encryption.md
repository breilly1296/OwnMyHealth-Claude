---
tags:
  - security
  - hipaa
  - critical
type: prompt
priority: 1
---

# Encryption Review

## Files to Review
- `backend/src/services/encryption.ts` (primary — AES-256-GCM implementation)
- `backend/src/services/userEncryption.ts` (per-user key management)
- `backend/prisma/schema.prisma` (identify encrypted fields)
- `backend/src/controllers/*.ts` (verify encrypt/decrypt calls)
- `backend/src/services/auditLog.ts` (PHI encryption in logs)
- Any file importing encryption service

## OwnMyHealth Encryption Architecture
- **Algorithm**: AES-256-GCM
- **Key Management**: PHI_ENCRYPTION_KEY from Secret Manager
- **Per-User Keys**: Derived from master key + user salt
- **At Rest**: All PHI encrypted before database storage
- **In Transit**: TLS 1.3 enforced

## Checklist

### 1. Encryption Implementation
- [ ] AES-256-GCM algorithm used (not AES-CBC or weaker)
- [ ] Unique IV/nonce generated for each encryption operation
- [ ] Authentication tag verified on decryption
- [ ] No ECB mode usage anywhere

### 2. Key Management
- [ ] Master key loaded from environment variable (`PHI_ENCRYPTION_KEY`)
- [ ] Key is not hardcoded anywhere in codebase
- [ ] Key is not logged or exposed in error messages
- [ ] Key derivation uses proper KDF (PBKDF2, scrypt, or Argon2)

### 3. Per-User Key Management
- [ ] Per-user salt stored in `UserEncryptionKey` table
- [ ] Salt encrypted with master key before DB storage (`encryptWithMasterKey()`)
- [ ] PBKDF2-SHA512 with 100,000 iterations for key derivation
- [ ] 32-byte random salt per user (`generateUserSalt()`)
- [ ] Key rotation supported (version tracking, `isActive` flag)
- [ ] Salt created on user registration
- [ ] Salt destroyed on account deletion

### 4. PHI Field Coverage
Verify encryption is applied to ALL PHI fields:

**User PII:**
- [ ] firstName, lastName, dateOfBirth, phone, address

**Biomarker Data:**
- [ ] Biomarker `valueEncrypted`, `notesEncrypted`
- [ ] BiomarkerHistory `valueEncrypted`

**Insurance:**
- [ ] InsurancePlan `memberIdEncrypted`, `groupIdEncrypted`

**Health Tracking:**
- [ ] HealthNeed `descriptionEncrypted`
- [ ] HealthGoal `descriptionEncrypted`
- [ ] GoalProgressHistory `noteEncrypted`

**Provider Collaboration:**
- [ ] ProviderPatient `notesEncrypted`

**DNA/Genetic (if models still active):**
- [ ] DNAVariant `genotypeEncrypted`
- [ ] GeneticTrait `descriptionEncrypted`, `recommendationsEncrypted`

**Expense Tracking:**
- [ ] Expense service types, costs, provider names, claim amounts

**AI Responses:**
- [ ] CostAnalysis `claudeResponse` (contains health recommendations)

**Audit Logs:**
- [ ] AuditLog `previousValueEncrypted`, `newValueEncrypted`

### 5. Encryption Service Usage
- [ ] All PHI writes go through encryption service
- [ ] All PHI reads go through decryption
- [ ] No plaintext PHI in logs
- [ ] Error messages don't leak plaintext data
- [ ] Decryption errors handled gracefully (corrupted data doesn't crash)

### 6. Memory Safety
- [ ] Sensitive data cleared from memory after use
- [ ] No plaintext PHI stored in global variables
- [ ] PDF/document buffers cleared after processing
- [ ] Encryption keys not retained beyond function scope

## Verification Commands
```bash
# Find all encrypted fields in schema
grep -r "Encrypted" backend/prisma/schema.prisma

# Find files using encryption service
grep -r "encrypt\|decrypt" backend/src/controllers/ --include="*.ts" -l

# Find potential plaintext PHI storage
grep -r "firstName\|lastName\|dateOfBirth\|phone\|address\|memberId\|groupId" backend/src/ --include="*.ts" | grep -v "Encrypted\|encrypt\|decrypt\|test\|\.d\.ts"
```

## Questions to Ask
1. Are there any PHI fields being stored without encryption?
2. Is the encryption key being rotated periodically?
3. Are decryption errors handled without leaking data?
4. Is the per-user key properly destroyed on account deletion?
5. Are AI responses (Claude) encrypted before storage?
