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
- `backend/src/services/encryption.ts` (primary)
- `backend/src/services/encryptionService.ts` (if exists)
- `backend/prisma/schema.prisma` (identify encrypted fields)
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

### 3. PHI Field Coverage
Verify encryption is applied to:
- [ ] Biomarker values and lab results
- [ ] DNA/genetic data
- [ ] Insurance plan details (if sensitive)
- [ ] User notes and free-text fields
- [ ] Provider notes (`notesEncrypted` field)

### 4. Encryption Service Usage
- [ ] All PHI writes go through encryption service
- [ ] All PHI reads go through decryption
- [ ] No plaintext PHI in logs
- [ ] Error messages don't leak plaintext data

### 5. Memory Safety
- [ ] Sensitive data cleared from memory after use
- [ ] No plaintext PHI stored in global variables
- [ ] DNA parser clears buffers after processing

## Questions to Ask
1. Are there any PHI fields being stored without encryption?
2. Is the encryption key being rotated periodically?
3. Are decryption errors handled without leaking data?
