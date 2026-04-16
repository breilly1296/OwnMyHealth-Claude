---
tags:
  - security
  - hipaa
  - critical
type: prompt
priority: 1
updated: 2026-04-16
---

# Encryption Review

> Follow the [review protocol](./_review-protocol.md).
> The [PHI inventory](./_phi-inventory.md) is the canonical field list — don't duplicate it here.
> Use [Claude Code tools](./_verification-tools.md).

## Files to Review
- `backend/src/services/encryption.ts` — AES-256-GCM implementation, `PHI_FIELDS` constant
- `backend/src/services/userEncryption.ts` — per-user key derivation (PBKDF2-SHA512)
- `backend/prisma/schema.prisma` — encrypted column declarations
- `backend/src/controllers/*.ts` — every encrypt/decrypt call site
- `backend/src/services/auditLog.ts` — audit log PHI encryption (uses system salt, not per-user)
- Any file importing `getEncryptionService()`

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
Verify against [_phi-inventory](./_phi-inventory.md) — do **not** re-enumerate fields in this prompt. For each model in the inventory:

- [ ] Every listed field appears in `PHI_FIELDS` in `encryption.ts`.
- [ ] Every listed field has a corresponding encrypted column in `schema.prisma`.
- [ ] The controller for that model encrypts on write and decrypts on read (find with Grep: `pattern: "encryptField\\(.*<fieldName>|decryptField\\(.*<fieldName>"`).
- [ ] No PLAINTEXT write path exists that bypasses encryption (Grep each non-`Encrypted` concept name — `firstName`, `memberId`, etc. — outside test files).

Flag any drift between schema ↔ `PHI_FIELDS` ↔ inventory as a **Critical** finding.

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

## Verification (Claude Code tools)

| Check | Tool | Parameters |
|---|---|---|
| All `*Encrypted` columns in schema | Grep | `pattern: "Encrypted\\b"`, `path: "backend/prisma/schema.prisma"`, `output_mode: "content"` |
| Controllers that touch encryption | Grep | `pattern: "encrypt\|decrypt"`, `glob: "backend/src/controllers/**/*.ts"`, `output_mode: "files_with_matches"` |
| Plaintext PHI leaks | Grep | `pattern: "firstName\|lastName\|dateOfBirth\|phone\|address\|memberId\|groupId"`, `glob: "backend/src/**/*.ts"`; manually filter hits inside `encryptField(...)` / `decryptField(...)` calls and test files |
| `PHI_FIELDS` definition | Read | `backend/src/services/encryption.ts` lines ~360–440 |

## Questions to Ask
1. Are there any PHI fields being stored without encryption?
2. Is the encryption key being rotated periodically?
3. Are decryption errors handled without leaking data?
4. Is the per-user key properly destroyed on account deletion?
5. Are AI responses (Claude) encrypted before storage?
