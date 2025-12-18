---
tags: [security, hipaa, critical]
type: prompt
priority: 1
---

# Encryption Service Review

## Files to Review
- `backend/src/services/encryption.ts` (primary - AES-256-GCM)
- `backend/src/services/userEncryption.ts` (per-user key management)

## OwnMyHealth Encryption Architecture

This codebase uses:
- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Derivation**: PBKDF2-SHA512 with per-user salt
- **Format**: `iv:authTag:ciphertext` (base64 encoded)
- **Master Key**: 256-bit from `PHI_ENCRYPTION_KEY` env var

## Checklist

### 1. Algorithm & Configuration
- [ ] Verify `ALGORITHM = 'aes-256-gcm'`
- [ ] IV_LENGTH = 16 bytes (128 bits for AES)
- [ ] SALT_LENGTH = 32 bytes
- [ ] KEY_LENGTH = 32 bytes (256 bits)
- [ ] PBKDF2_ITERATIONS >= 100,000 (OWASP minimum)

### 2. IV (Initialization Vector) Security
- [ ] IVs generated with `crypto.randomBytes(IV_LENGTH)` - NEVER reused
- [ ] Each `encrypt()` call generates a fresh IV
- [ ] IV stored with ciphertext (not separately)

### 3. Authentication Tag
- [ ] GCM mode auth tag (16 bytes) included in encrypted output
- [ ] `decipher.setAuthTag(authTag)` called before decryption
- [ ] Decryption fails if auth tag doesn't match (integrity check)

### 4. Key Management
- [ ] Master key loaded from `process.env.PHI_ENCRYPTION_KEY`
- [ ] `validateEncryptionKey()` checks:
  - Minimum 64 hex characters (256 bits)
  - Valid hex format (0-9, a-f)
  - Not a known insecure/placeholder key in production
- [ ] Service throws fatal error if key is invalid
- [ ] Per-user keys derived via `deriveUserKey(userSalt)` using PBKDF2

### 5. Key Rotation Support
- [ ] `reEncrypt(encryptedData, oldSalt, newSalt)` function exists
- [ ] `UserEncryptionKey` model in schema with version tracking

### 6. No Sensitive Data Leakage
- [ ] Decrypted values NEVER logged (check `logger` calls)
- [ ] No `console.log` with plaintext PHI
- [ ] Error messages don't reveal plaintext
- [ ] `PHI_FIELDS` constant maps which fields need encryption per model

### 7. Encryption Service Usage
- [ ] `getEncryptionService()` returns singleton instance
- [ ] `encryptFields()` / `decryptFields()` for bulk operations
- [ ] `hashForSearch()` for one-way hashing (searchable encrypted fields)

### 8. Production Safeguards
- [ ] `INSECURE_KEYS` array blocks known placeholder keys:
  - `0123456789abcdef...`
  - All f's
  - All zeros
- [ ] Service fails to start with invalid key (no silent fallback)

## Red Flags
- Any hardcoded encryption keys
- IVs reused across encryptions
- Missing auth tag verification
- Decrypted PHI in log files
- Fallback to weak encryption in development
- `crypto.createCipher` instead of `createCipheriv` (deprecated)
