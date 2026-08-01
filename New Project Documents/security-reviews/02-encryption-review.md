# Encryption Review — 2026-06-16

> Executed against live code at HEAD `fb2cd32`, per [02-encryption.md](../../prompts/02-encryption.md) and the [review protocol](../../prompts/_review-protocol.md). Every tick below carries a `file:line` proof. No code was modified.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |

Overall: the PHI encryption surface is implemented correctly and defensively. AES-256-GCM with authenticated decryption, per-user PBKDF2-SHA512 keys, master-key-wrapped salts, schema↔`PHI_FIELDS` parity (CI-enforced), encrypt-on-write / decrypt-on-read at every controller site reviewed, FHIR OAuth tokens encrypted under the per-user salt, audit metadata encrypted under the system salt, and salt destruction on account deletion via cascade. The three findings are all Low (a validator-consistency gap that is fully backstopped, a legacy-row plaintext-scrubbing nuance, and one stale claim in the source `CLAUDE.md`).

## Findings

### F-1 — Two divergent `PHI_ENCRYPTION_KEY` length validators (≥64 vs ==64) — **Low**
- **Location:** `backend/src/config/index.ts:439` vs `backend/src/services/encryption.ts:118`
- **Observation:** The config boot gate accepts a key of length **≥ 64** hex chars (`if (phiKey.length < 64)`), and its error text says "must be **at least** 64 hex characters." The authoritative `EncryptionService` gate requires **exactly** 64 (`if (key.length !== KEY_HEX_LENGTH)`), because `Buffer.from(key, 'hex')` would silently truncate an over-long key to its first 32 bytes. A 65–128-char hex key therefore PASSES `config/index.ts` but THROWS in the `EncryptionService` constructor.
- **Impact:** No confidentiality impact — the service fails closed. `getEncryptionService()` is invoked at boot (`backend/src/services/database.ts:174`, the "encryption service initialization" init step), so an over-long key aborts startup before any PHI is processed; a truncated/weak key can never be constructed. The only effect is a confusing two-stage failure and a misleading "at least 64" message that implies longer keys are valid.
- **Fix:** In `config/index.ts:439`, change the check to `phiKey.length !== 64` and update the message to "exactly 64 hex characters," matching `KEY_HEX_LENGTH` in `encryption.ts`. Better still, have `config/index.ts` call the exported `validateEncryptionKey()` from `encryption.ts` so there is a single source of truth.
- **Evidence:**
  ```ts
  // config/index.ts:439
  if (phiKey.length < 64) {
    throw new Error(`PHI_ENCRYPTION_KEY must be at least 64 hex characters ...`);
  ```
  ```ts
  // encryption.ts:118
  if (key.length !== KEY_HEX_LENGTH) { // KEY_HEX_LENGTH = 64
  ```

### F-2 — HealthGoal `targetValue` plaintext twin not nulled on update (legacy rows) — **Low**
- **Location:** `backend/src/controllers/healthGoalsController.ts:508-528` (`updateHealthGoal`)
- **Observation:** On goal **create** and on **progress update**, the plaintext numeric twins are explicitly nulled (`currentValue: null`, `startValue: null`, `value: null` — lines 420-422, 444, 633, 646), so new writes persist no plaintext PHI. But the goal **update** path writes only `targetValueEncrypted` and intentionally leaves the legacy plaintext `targetValue` Decimal column untouched (documented at lines 509-513). For a row created *before* the M4/`20260420` migrations, editing the target re-encrypts the new value but the OLD plaintext target remains in the `target_value` column until the `backfillGoalValues` job runs.
- **Impact:** Minimal and bounded. The read path always prefers the encrypted column (`readTargetValue`/`readEncryptedNumber`, lines 50-55, 30-43), so the stale plaintext is never served. It is residual plaintext PHI at rest on pre-migration rows only, scrubbed by `backend/src/maintenance/backfillGoalValues.ts` and then dropped by a follow-up migration. Not a new leak — the plaintext was already there pre-migration; the update simply doesn't proactively clear it.
- **Fix:** Optionally add `updateData.targetValue = null` alongside `targetValueEncrypted` at line 514 so an edit also scrubs the legacy plaintext on that row (defense-in-depth; the backfill job remains the authoritative cleanup). The `currentValue`/`startValue` twins are already nulled correctly elsewhere.
- **Evidence:**
  ```ts
  // healthGoalsController.ts:509-517
  // Write ONLY the encrypted column. The plaintext `targetValue` Decimal
  // is no longer updated for changed rows ...
  updateData.targetValueEncrypted = encryptionService.encrypt(targetValue.toString(), userSalt);
  ```

### F-3 — Prompt drift: source `CLAUDE.md` PHI list understates encrypted fields — **Low**
- **Location:** `CLAUDE.md` ("PHI Encryption" section) vs `backend/src/services/encryption.ts:476-562`
- **Observation:** The repo `CLAUDE.md` PHI list says "Insurance: member ID, group ID, plan name, provider name, benefits" and "Health Goals/Progress: descriptions, notes, target values," and lists "unit" for Biomarker. The live `PHI_FIELDS` encrypts `InsurancePlan` only as `memberIdEncrypted`/`groupIdEncrypted` (no plan-name/benefits encrypted columns exist in schema), encrypts HealthGoal `currentValue`/`startValue` in addition to target (M4), and `Biomarker` has no `unitEncrypted` column. This is documentation drift, not a code defect — the authoritative `PHI_FIELDS` and the canonical [_phi-inventory](../../prompts/_phi-inventory.md) are correct and CI-guarded.
- **Impact:** None at runtime. Risk is a future developer trusting the stale `CLAUDE.md` list (e.g., assuming insurance "benefits" are encrypted). Per protocol §"When the prompt disagrees with the code," logged as a Low prompt-drift item.
- **Fix:** Update the `CLAUDE.md` "PHI Encryption" bullet list to reference `PHI_FIELDS` / `_phi-inventory.md` as the single source of truth rather than re-listing fields inline.
- **Evidence:**
  ```ts
  // encryption.ts:502-505 — only member/group encrypted, no plan name / benefits
  InsurancePlan: ['memberIdEncrypted', 'groupIdEncrypted'],
  ```

## Checks passed

### 1. Encryption Implementation
- [x] AES-256-GCM used (not CBC/ECB/weaker) — `const ALGORITHM = 'aes-256-gcm'` at `encryption.ts:57`; `createCipheriv(ALGORITHM, ...)` at `encryption.ts:284,335`.
- [x] Unique IV per operation — `crypto.randomBytes(IV_LENGTH)` generated inside each `encrypt`/`encryptWithMasterKey` call (`encryption.ts:283,333`); 16-byte IV (`IV_LENGTH = 16`, line 60).
- [x] Authentication tag verified on decryption — `decipher.setAuthTag(authTag)` then `decipher.final()` in `attemptDecrypt` (`encryption.ts:384-388`) and `decryptWithMasterKey` (`encryption.ts:313-316`); a tampered tag throws.
- [x] No ECB mode anywhere — only GCM is referenced; no `createCipheriv('aes-...-ecb'` hits in `backend/src`.

### 2. Key Management
- [x] Master key from env `PHI_ENCRYPTION_KEY` — `process.env.PHI_ENCRYPTION_KEY` at `encryption.ts:182`; required env in prod/staging gate at `config/index.ts:427`.
- [x] Key not hardcoded — no literal 64-hex master key in source; the only literals are the three rejected `INSECURE_KEYS` placeholders (`encryption.ts:95-99`).
- [x] Key not logged / not in error messages — error strings reference only the validation *reason* and decoded *byte length* (`encryption.ts:121,216`), never the key value; no `logger.*`/`console.*` emits the key, master key, or a salt (verified by targeted grep across `backend/src`).
- [x] Proper KDF — PBKDF2-SHA512 via `crypto.pbkdf2Sync(masterKey, userSalt, iterations, KEY_LENGTH, 'sha512')` (`encryption.ts:247-253`).

### 3. Per-User Key Management
- [x] Per-user salt stored in `UserEncryptionKey` — `tx.userEncryptionKey.create({...})` in `userEncryption.ts:57-66`; model at `schema.prisma:108`.
- [x] Salt encrypted with master key before storage — `encryptWithMasterKey(newSalt)` at `userEncryption.ts:55`; decrypted on read at `userEncryption.ts:49`.
- [x] PBKDF2-SHA512 at 600,000 iterations for new encryption — `const PBKDF2_ITERATIONS = 600000` (`encryption.ts:85`); `deriveUserKey` defaults to it (`encryption.ts:236`); `encrypt` uses the default (`encryption.ts:332`).
- [x] Legacy 100k fallback only on auth-tag failure, no silent downgrade of writes — `decrypt` tries `PBKDF2_ITERATIONS` first, falls back to `PBKDF2_ITERATIONS_LEGACY` only in the catch (`encryption.ts:371-380`); `encrypt` never passes the legacy count, so new ciphertext is always written at 600k.
- [x] 32-byte random salt per user — `crypto.randomBytes(SALT_LENGTH).toString('hex')`, `SALT_LENGTH = 32` (`encryption.ts:63,271-272`).
- [x] Version + isActive present for future rotation — `version`/`isActive` on `UserEncryptionKey` (`schema.prisma:108-118`); written at create (`userEncryption.ts:62-64`).
- [x] In-service key-rotation footgun removed, no dangling caller — removal documented at `userEncryption.ts:74-80`; no caller of a rotation helper found. `KEY_ROTATION` enum retained for the future re-encryption job (noted in same block).
- [x] Salt created lazily on first use — `getUserEncryptionSalt` create-if-absent (`userEncryption.ts:36-68`).
- [x] Salt destroyed on account deletion — `UserEncryptionKey.user @relation(... onDelete: Cascade)` (`schema.prisma:118`); `tx.user.delete()` at `settingsController.ts:1045` cascades the salt row, rendering all per-user ciphertext unrecoverable.

### 4. PHI Field Coverage
- [x] schema↔`PHI_FIELDS` two-way parity — 39 `*Encrypted` String columns in `schema.prisma` (grep, lines 14-764) exactly match the 14-model/39-field `PHI_FIELDS` map (`encryption.ts:476-562`). Enforced in CI by `phiFieldsCoverage.test.ts` (two-way assertions at lines 120-152).
- [x] Plaintext-PHI twin guard — `PLAINTEXT_PHI_REQUIRING_TWIN` asserts `HealthGoal.{targetValue,currentValue,startValue}` and `GoalProgressHistory.value` each have an `*Encrypted` sibling (`phiFieldsCoverage.test.ts:107-110,154-171`).
- [x] `UserFile.originalFilenameEncrypted` wired — in `PHI_FIELDS` (`encryption.ts:498-500`), schema col `schema.prisma:164`; encrypted on write in all three uploaders (`labUploadController.ts:111,275`, `sbcUploadController.ts:126`) with plaintext nulled; read via `decryptOriginalFilename` (`fileController.ts:89,172,258`). Server-generated `filename` left plaintext by design.
- [x] HealthGoal `currentValueEncrypted`/`startValueEncrypted` (M4) — in `PHI_FIELDS` (`encryption.ts:519-520`); encrypted on create (`healthGoalsController.ts:405-407,418-421`) and progress update (`:632`); plaintext twins nulled on new writes.
- [x] `GoalProgressHistory.valueEncrypted` (M4) — in `PHI_FIELDS` (`encryption.ts:524`); encrypted at `healthGoalsController.ts:443,645`, plaintext `value: null`.
- [x] No plaintext PHI write path — bare-name grep (`firstName:`/`memberId:`/etc.) across `backend/src/**/*.ts` resolved entirely to: decrypted-output properties (`settingsController.ts:474-478,541-542`), Zod input schemas (`validation.ts:363-364,493,540`), response/type interfaces, plan config flags (`plans.ts`), and test files. No model write assigns a bare PHI field. Registration writes only email/passwordHash/verification metadata (`authService.ts:969-979`).

### 5. Encryption Service Usage
- [x] All reviewed PHI writes go through the encryption service — biomarker (`biomarkerController.ts:272-274,363-367,538-539`), insurance (`insuranceController.ts:519-523,627-633`), expenses (`expenseController.ts:136-140,443-453`), CostAnalysis (`expenseController.ts:801-806`), health profile (`healthProfileService.ts:102,107`), profile name (`settingsController.ts:1135,1139`).
- [x] All reviewed PHI reads decrypt — corresponding decrypt/`tryDecrypt` sites (e.g. `biomarkerController.ts:99-109`, `expenseController.ts:154-156,345-355,860-866`, `healthGoalsController.ts:124-187`).
- [x] No plaintext PHI in logs — see §2; decrypt-failure logs emit only the field *name* and error message, never the value (`encryption.ts:441-443`, `healthGoalsController.ts:129-131`).
- [x] Error messages don't leak plaintext — generic "Invalid encrypted data format" (`encryption.ts:305,357`); `decryptFields` returns `null` (not ciphertext) on failure and logs only the error message (`encryption.ts:435-444`).
- [x] Decryption errors handled gracefully — per-field try/catch returning `null` across read paths so one corrupt row never crashes a list (`encryption.ts:433-445`, `healthGoalsController.ts:122-134,164-179`, `fileController.ts` via `decryptOriginalFilename` `userFileNames.ts:18-25`).
- [x] Audit `metadata` encrypted, no plaintext column — `metadataEncrypted = this.encryptValue(entry.metadata)` (`auditLog.ts:301,314`); in `PHI_FIELDS` (`encryption.ts:530`), schema `schema.prisma:533`; legacy plaintext `metadata` column absent from schema (dropped in `20260615_drop_legacy_audit_metadata`).
- [x] Audit reads decrypt + strip ciphertext — `decryptMetadata` (`auditLog.ts:275-288`) and `queryLogs` strips `metadataEncrypted` before returning (`auditLog.ts:600-607`).
- [x] Audit `previousValue`/`newValue` snapshots encrypted, fail-closed on encrypt error — `encryptValue` re-throws rather than persisting counterfeit ciphertext (`auditLog.ts:245-263`); mutations are `failClosed` → `InternalServerError` (`auditLog.ts:355-362`, `logCreate/Update/Delete/Export` set `failClosed: true`).
- [x] AuditLog uses system salt, not per-user — `encryptValue`/`decryptMetadata` use `this.systemSalt` (`auditLog.ts:251,278`), sourced from `config.auditSalt` (`AUDIT_LOG_SALT`) at `auditLog.ts:179`; survives account deletion (7-yr retention), unlike per-user salts.

### 6. Memory Safety (partial — see Unverifiable)
- [x] No plaintext PHI in global/module-scope variables — encryption operates on locals; the only module singletons hold the service instance and the derived-key cache, no plaintext PHI (`encryption.ts:177,462`).
- [x] Encryption keys scoped per call / cached as derived keys only — derived keys live in a bounded LRU `keyCache` (`MAX_CACHE_SIZE = 500`, `encryption.ts:179,236-266`); derived keys are no more sensitive than the resident master key (documented rationale, `encryption.ts:226-234`).

### 7. SMART-on-FHIR OAuth Token Encryption
- [x] `accessTokenEncrypted`/`refreshTokenEncrypted` in `PHI_FIELDS` + schema — `encryption.ts:558-560`; `schema.prisma:763-764`.
- [x] Tokens encrypted with the **per-user** salt — `persistConnection` calls `getUserEncryptionSalt(userId)` then `encryption.encrypt(token, salt)` (`labSyncService.ts:150-152,161-162`).
- [x] Refresh-on-expiry re-encrypts rotated token under same salt — `labSyncService.ts:239-251` (`newAccessEnc`/`newRefreshEnc` persisted).
- [x] Decrypted tokens never logged / never returned to client — token plaintext used only for outbound FHIR calls (`labSyncService.ts:222-225,260,456`); warn/error logs reference operations, not values (`smartAuth.ts:318,346,351`); SSRF guard `assertAllowedFhirUrl` confines endpoints before any token POST (`smartAuth.ts:50-56,202,246,339`).
- [x] Tokens destroyed on account deletion — best-effort upstream revocation via `revokeAllUserConnections` BEFORE the cascade (`settingsController.ts:854,975`), then `LabConnection` rows cascade-delete (`schema.prisma:774`); per-user salt also destroyed, making any residual ciphertext unrecoverable.

### Questions to Ask (from prompt)
- [x] Q1 No unencrypted PHI fields — parity confirmed (§4); CI guard passing structurally.
- [x] Q2 Key rotation acknowledged as future dedicated job, no dead reference — `userEncryption.ts:74-80`.
- [x] Q3 Decrypt errors + legacy-fallback handled without leak — `encryption.ts:371-389,433-445`.
- [x] Q4 Per-user key destroyed on deletion incl. LabConnection rows — `schema.prisma:118,774`; `settingsController.ts:854,975,1045`.
- [x] Q5 `CostAnalysis.claudeResponseEncrypted` encrypted — write `expenseController.ts:801`, decrypt `:866`.
- [x] Q6 FHIR tokens per-user-salt + never logged — `labSyncService.ts:150-152`; §7.

## Unverifiable
- **Sensitive data explicitly cleared/zeroed from memory after use** — Node strings/Buffers are not zeroed (no `sodium_memzero` equivalent in use); plaintext PHI and derived keys remain reachable until GC. This is a known Node/V8 limitation, not a code defect, and is out of practical reach for app-layer mitigation. Stated as Info per the rubric, not a finding.
- **PDF/document buffers cleared after processing** — out of scope for this prompt (file-handling/upload pipeline); covered by the upload/file-handling review prompt. The encryption service itself buffers nothing beyond a single field's ciphertext within function scope.
- **TLS 1.3 "in transit" enforcement** — terminated at the GCP load balancer / Cloud Run ingress, not in this repo's source; cannot be confirmed from code. Belongs to infra/transport review.
- **`backfillGoalValues` / `backfillUserFileNames` execution status against prod** — the jobs are correct and idempotent (`maintenance/backfillUserFileNames.ts:63-91`), but whether the prod backfill has actually run (legacy plaintext physically scrubbed) is an ops fact, not verifiable from source. Per project memory, the L24 re-encrypt backfill was still pending as of 2026-06-15.

## Out of scope
- RLS policy correctness, JWT/CSRF/session security, rate limiting, SSRF internals beyond the token-egress guard — covered by their dedicated review prompts.
- Audit-logging completeness/coverage (which events get logged) — see the audit-logging review prompt; this review covered only the *encryption* of audit PHI columns.
- AI prompt-injection / PHI-stripping efficacy of `stripPHIFromText` — see the AI-integration review prompt; this review confirmed only that the AI response is encrypted before the DB write.
