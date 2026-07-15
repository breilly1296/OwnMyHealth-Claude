---
tags:
  - security
  - hipaa
  - critical
type: prompt
priority: 1
updated: 2026-06-16
---

# Encryption Review

> Follow the [review protocol](./_review-protocol.md).
> The [PHI inventory](./_phi-inventory.md) is the canonical field list — don't duplicate it here.
> Use [Claude Code tools](./_verification-tools.md).

## Files to Review
- `backend/src/services/encryption.ts` — AES-256-GCM implementation, `PHI_FIELDS` constant (declared at line 476, runs 476–562)
- `backend/src/services/userEncryption.ts` — per-user salt management (salt encrypted with master key; key-derivation iterations live in `encryption.ts`)
- `backend/prisma/schema.prisma` — encrypted column declarations (currently 39 `*Encrypted` columns across 19 models, 14 of which hold encrypted PHI)
- `backend/src/controllers/*.ts` — every encrypt/decrypt call site
- `backend/src/services/auditLog.ts` — audit log PHI encryption (uses `systemSalt` from `AUDIT_LOG_SALT`, not per-user). Now covers `metadataEncrypted` too — see Audit-metadata lifecycle below.
- `backend/src/utils/userFileNames.ts` — raw client filename encryption (L24, 2026-06-15): `UserFile.originalFilenameEncrypted` is AES-256-GCM per-user encrypted; `decryptOriginalFilename` is the read helper. The plaintext `originalFilename` twin is deliberately retained-but-nullable pending the backfill job `backend/src/maintenance/backfillUserFileNames.ts`.
- `backend/src/services/fhir/labSyncService.ts` — SMART-on-FHIR OAuth token encryption (`accessTokenEncrypted` / `refreshTokenEncrypted` on `LabConnection`, encrypted with the **per-user salt**)
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
- [ ] PBKDF2-SHA512 key derivation uses `PBKDF2_ITERATIONS = 600000` (OWASP 2023 target) for new encryption (`encryption.ts` ~line 85)
- [ ] Decryption falls back to `PBKDF2_ITERATIONS_LEGACY = 100000` only when the current count fails the auth tag — confirm this dual-derivation does NOT silently downgrade new writes
- [ ] 32-byte random salt per user (`generateUserSalt()`)
- [ ] Version tracking (`version`) + `isActive` flag present for future rotation. NOTE: the old in-service key-rotation helper was **removed** from `userEncryption.ts` (it rotated the salt without re-encrypting existing PHI — a footgun with no callers). Verify no caller still expects it; proper rotation must be a dedicated job that re-encrypts every PHI column in one transaction. The `KEY_ROTATION` AuditAction enum value is retained for that future work.
- [ ] Salt created on user registration (lazily via `getUserEncryptionSalt()`)
- [ ] Salt destroyed on account deletion

### 4. PHI Field Coverage
Verify against [_phi-inventory](./_phi-inventory.md) — do **not** re-enumerate fields in this prompt. For each model in the inventory:

- [ ] Every listed field appears in `PHI_FIELDS` in `encryption.ts`.
- [ ] Every listed field has a corresponding encrypted column in `schema.prisma`.
- [ ] The controller for that model encrypts on write and decrypts on read (find with Grep: `pattern: "encrypt\|decrypt"`, then locate the `<fieldName>` write/read; the service exposes `encrypt`/`decrypt` and the batch helpers `encryptFields`/`decryptFields`, NOT `encryptField`/`decryptField`).
- [ ] No PLAINTEXT write path exists that bypasses encryption (Grep each non-`Encrypted` concept name — `firstName`, `memberId`, etc. — outside test files).

**New PHI classes since the 2026-06-01 inventory — confirm each is present and wired:**
- [ ] `UserFile.originalFilenameEncrypted` (L24, `encryption.ts:499`, `schema.prisma:164`). Raw client filenames are PHI; encrypted per-user, read via `decryptOriginalFilename` (`utils/userFileNames.ts`). The plaintext `originalFilename` twin (`schema.prisma:163`) is deliberately NOT in `PHI_FIELDS` (legacy column being phased out via `maintenance/backfillUserFileNames.ts`, then a follow-up migration drops it). Server-generated `filename` (`schema.prisma:156`) is intentionally plaintext (non-PHI).
- [ ] HealthGoal numeric values (M4): `currentValueEncrypted` (`encryption.ts:519`, `schema.prisma:467`) and `startValueEncrypted` (`encryption.ts:520`, `schema.prisma:470`) — both now in `PHI_FIELDS` alongside `descriptionEncrypted`/`targetValueEncrypted`. Each has a plaintext Decimal twin (`targetValue`/`currentValue`/`startValue`) NOT in `PHI_FIELDS` (read path prefers encrypted; backfilled by `maintenance/backfillGoalValues.ts`). Migration `20260613_encrypt_goal_values`.
- [ ] `GoalProgressHistory.valueEncrypted` (M4, `encryption.ts:524`, `schema.prisma:504`) — was previously only `noteEncrypted`; plaintext twin `value` (`schema.prisma:503`) retained, not in `PHI_FIELDS`.

Flag any drift between schema ↔ `PHI_FIELDS` ↔ inventory as a **Critical** finding. NOTE: an automated guard test, `backend/src/services/phiFieldsCoverage.test.ts`, now enforces schema ↔ `PHI_FIELDS` parity in CI — drift fails the build. Treat this as the first line of defense (confirm it still passes), but still review the write/read wiring manually, which the guard does not cover.

### 5. Encryption Service Usage
- [ ] All PHI writes go through encryption service
- [ ] All PHI reads go through decryption
- [ ] No plaintext PHI in logs
- [ ] Error messages don't leak plaintext data
- [ ] Decryption errors handled gracefully (corrupted data doesn't crash)

**Audit-metadata lifecycle (M6, 2026-06-06 → 2026-06-15):** `AuditLog.metadataEncrypted` is now a `PHI_FIELDS.AuditLog` member (`encryption.ts:530`, `schema.prisma:533`), encrypted/decrypted with `systemSalt` via `encryptValue`/`decryptMetadata` (`auditLog.ts:251,275-278,301,314`) — same salt as `previousValueEncrypted`/`newValueEncrypted`, NOT the per-user salt. The legacy plaintext `metadata` column was **IRREVERSIBLY DROPPED** in migration `20260615_drop_legacy_audit_metadata` (done via DDL because `audit_logs` is immutable-by-RLS).
- [ ] Audit writes encrypt `metadata` (no plaintext `metadata` column remains; do not flag its absence as a regression).
- [ ] Audit reads decrypt via `decryptMetadata` and strip `metadataEncrypted` from the returned row (`auditLog.ts:604-605`).

### 6. Memory Safety
- [ ] Sensitive data cleared from memory after use
- [ ] No plaintext PHI stored in global variables
- [ ] PDF/document buffers cleared after processing
- [ ] Encryption keys not retained beyond function scope

### 7. SMART-on-FHIR OAuth Token Encryption (new sensitive class)
`LabConnection` stores live OAuth tokens for Quest/LabCorp FHIR lab sync. A stolen
access/refresh token is a direct path to the user's PHI at the external lab — treat
these with the same rigor as PHI fields.

- [ ] `accessTokenEncrypted` and `refreshTokenEncrypted` are in `PHI_FIELDS.LabConnection` and in `schema.prisma` (migration `20260418_add_lab_connections`).
- [ ] Tokens are encrypted with the **per-user salt** (`getUserEncryptionSalt(userId)` → `encryption.encrypt(token, salt)` in `labSyncService.ts` `persistConnection()`), NOT the system/master key. Flag any path that stores a token in plaintext.
- [ ] Refresh-on-expiry re-encrypts the rotated token (`labSyncService.ts` ~line 230) and persists `accessTokenEncrypted`/`refreshTokenEncrypted` under the same salt.
- [ ] Decrypted tokens are never logged and never returned to the client (FHIR token flows go through `services/fhir/`; `urlSafety.ts` provides SSRF protection on outbound FHIR calls).
- [ ] Tokens are destroyed/orphaned correctly on account deletion (per-user salt is destroyed on deletion, so ciphertext becomes unrecoverable — confirm the row is also deleted).

## Verification (Claude Code tools)

| Check | Tool | Parameters |
|---|---|---|
| All `*Encrypted` columns in schema | Grep | `pattern: "Encrypted\\b"`, `path: "backend/prisma/schema.prisma"`, `output_mode: "content"` |
| Controllers that touch encryption | Grep | `pattern: "encrypt\|decrypt"`, `glob: "backend/src/controllers/**/*.ts"`, `output_mode: "files_with_matches"` |
| Plaintext PHI leaks | Grep | `pattern: "firstName\|lastName\|dateOfBirth\|phone\|address\|healthProfile\|memberId\|groupId\|targetValue\|accessToken\|refreshToken"`, `glob: "backend/src/**/*.ts"`; manually filter hits inside `encrypt(...)` / `decrypt(...)` calls and test files |
| `PHI_FIELDS` definition | Read | `backend/src/services/encryption.ts` lines 476–562 |
| Per-user PBKDF2 iterations | Grep | `pattern: "PBKDF2_ITERATIONS"`, `path: "backend/src/services/encryption.ts"`, `output_mode: "content"` |

## Questions to Ask
1. Are there any PHI fields being stored without encryption? (Compare `PHI_FIELDS` ↔ schema's 39 `*Encrypted` columns ↔ [_phi-inventory](./_phi-inventory.md). The `phiFieldsCoverage.test.ts` guard enforces this parity in CI.)
2. Is there a working key-rotation path, given the in-service rotation helper was removed? (Confirm no dead reference, and that rotation is acknowledged as a future dedicated re-encryption job.)
3. Are decryption errors handled without leaking data, including the legacy-iteration PBKDF2 fallback?
4. Is the per-user key properly destroyed on account deletion (and do `LabConnection` rows go with it)?
5. Are AI responses encrypted before storage? `CostAnalysis.claudeResponse` was renamed to `claudeResponseEncrypted` (migration `20260424_align_uuid_defaults_and_rename_claude_response`) — confirm the column and `PHI_FIELDS` entry both use the new name.
6. Are SMART-on-FHIR OAuth tokens (`LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted`) encrypted with the per-user salt and never logged?
