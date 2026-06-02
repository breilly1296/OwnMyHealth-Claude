# 02-encryption Review — 2026-06-01

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 2 |

The encryption core is in good shape: AES-256-GCM with authenticated decryption, unique random IV per op, per-user PBKDF2-SHA512 keys at 600k iterations with a leak-free legacy fallback, hard-fail key validation, and `PHI_FIELDS` ↔ `schema.prisma` in exact lockstep. The two Medium findings are (1) a plaintext `HealthGoal.targetValue` column still written in parallel with its encrypted twin, and (2) inline `decrypt()` calls in list/export hot paths with no per-field error handling, so one corrupted ciphertext fails the whole request (incl. the HIPAA data-export endpoint).

## Findings

### F-1 — Plaintext `targetValue` PHI still persisted alongside ciphertext — **Medium**
- **Location:** `backend/src/controllers/healthGoalsController.ts:401` (create) and `backend/src/controllers/healthGoalsController.ts:487` (update); column at `backend/prisma/schema.prisma:410`.
- **Observation:** `HealthGoal.targetValueEncrypted` is the canonical PHI field (`_phi-inventory.md` line 42, `encryption.ts:446`), but the legacy plaintext `targetValue Decimal` column is still written on every create and update. A numeric health goal target (target cholesterol, A1c, weight) is exactly the kind of value the inventory classifies as PHI — and it sits in the DB in cleartext. The same row also keeps `currentValue`/`startValue` Decimals in cleartext, but only `targetValue` has a declared encrypted counterpart, so it is the unambiguous drift.
- **Impact:** Defeats application-layer PHI encryption for this field: a DB dump, read-replica, or backup leaks the goal target in cleartext even though the encrypted column exists. The encrypt-at-rest control is silently half-applied.
- **Fix:** Complete the migration the code comment promises (`backend/src/controllers/healthGoalsController.ts:388-390` says the plaintext column "stays for backward-compat reads until a migration re-encrypts and nulls it"). Add a migration that backfills `targetValueEncrypted` for any null rows then sets `target_value` to a non-PHI sentinel (or drops it), and stop writing `targetValue` in both `createGoal` (line 401) and `updateGoal` (line 487). The read path already prefers the encrypted column (`readTargetValue`, line 37-44), so removing the plaintext write is safe once backfilled.
- **Evidence:**
  ```ts
  // healthGoalsController.ts:401-402 (create)
  targetValue,
  targetValueEncrypted,
  ```
  ```prisma
  // schema.prisma:410 — plaintext PHI column still present
  targetValue          Decimal               @map("target_value") @db.Decimal(10, 4)
  ```

### F-2 — Inline `decrypt()` in list/export paths has no per-field error handling — **Medium**
- **Location:** `backend/src/controllers/expenseController.ts:799` (`getAnalyses`), and the wider pattern at `expenseController.ts:113-115,160-162,299-309`; `biomarkerController.ts:67`; `settingsController.ts:451-455,613` (data export).
- **Observation:** The encryption service ships a graceful helper (`decryptFields`, `encryption.ts:357-384`) that catches per-field decrypt failures and returns `null`, and a few call sites wrap decrypt in try/catch (`insuranceController.ts:228-236`, `healthGoalsController.ts:37-42`). But the high-volume list/export paths call `encryption.decrypt(...)` inline inside `.map()` with no try/catch. `decrypt()` throws `'Invalid encrypted data format'` (`encryption.ts:291`) or an auth-tag failure on any corrupted/key-mismatched row, which rejects the entire request — including the HIPAA-mandated data export at `settingsController.ts:613`.
- **Impact:** A single bit-rotted or partially-rotated ciphertext row turns the user's whole expense/biomarker/cost-analysis list (and their full account export) into a hard 500, denying access to all their other (intact) PHI. Availability/recoverability gap; not a disclosure. Maps to checklist item 5.5 ("corrupted data doesn't crash").
- **Fix:** Route these reads through `decryptFields`, or wrap each inline `decrypt` in a local `tryDecrypt` helper mirroring `insuranceController.ts:228-236`, returning `null`/`undefined` and logging at warn level so one bad row degrades gracefully instead of failing the batch. Prioritise the export path (`settingsController.ts:613`) since it is the user's last-resort data-portability route.
- **Evidence:**
  ```ts
  // expenseController.ts:799 — no try/catch; one bad row throws the whole getAnalyses map
  claudeResponse: encryption.decrypt(a.claudeResponseEncrypted, userSalt),
  ```
  ```ts
  // settingsController.ts:613 — same in the data-export path
  claudeResponse: decrypt(analysis.claudeResponseEncrypted, userSalt),
  ```

### F-3 — Prompt drift: "38 `*Encrypted` columns across 18 models" — **Low**
- **Location:** Prompt `prompts/02-encryption.md:20`; verification table `prompts/02-encryption.md:95`; counted against `backend/prisma/schema.prisma`.
- **Observation:** The prompt states the schema has "38 `*Encrypted` columns across 18 models" and the verification recipe greps `pattern: "Encrypted\\b"`. That grep returns 38 hits, but the count conflates three non-columns: the `isEncrypted Boolean` flag on `SystemConfig` (`schema.prisma:493`) and two comment lines (`schema.prisma:411,670-671`). The actual PHI `*Encrypted` columns number **34**, spread across **13** models, and they match `PHI_FIELDS` exactly (see Checks passed). The headline "38 columns / 18 models" overcounts both.
- **Impact:** None to security; the recipe could mislead a future reviewer into hunting for 4 "missing" PHI columns that don't exist, or treating `SystemConfig.isEncrypted` as a PHI column.
- **Fix:** Update `prompts/02-encryption.md` to "34 `*Encrypted` PHI columns across 13 models" and note that the `Encrypted\b` grep includes the `isEncrypted` boolean flag + comment lines as false positives.
- **Evidence:**
  ```prisma
  // schema.prisma:493 — counted by the "Encrypted\b" grep but NOT a PHI column
  isEncrypted Boolean  @default(false) @map("is_encrypted")
  ```

### F-4 — Prompt/doc drift: CLAUDE.md claims insurance plan name / provider name encrypted — **Low**
- **Location:** `CLAUDE.md` "PHI Encryption" section ("Insurance: member ID, group ID, plan name, provider name, benefits"); reality in `backend/prisma/schema.prisma:199-200` and `encryption.ts:430-433`.
- **Observation:** `CLAUDE.md` lists insurance "plan name, provider name, benefits" as encrypted PHI, but `InsurancePlan` only encrypts `memberIdEncrypted` and `groupIdEncrypted`. `planName`/`insurerName` are stored and returned as plaintext (`insuranceController.ts:264-266`), consistent with the canonical `_phi-inventory.md` (line 48 lists only `memberIdEncrypted`, `groupIdEncrypted`). The inventory governs, so this is doc drift in CLAUDE.md, not a code gap — but it could lead a future change to assume plan/provider names are already protected.
- **Impact:** None directly; documentation overstates the encrypted-field set. Worth a one-line correction so the lockstep rule (schema ↔ `PHI_FIELDS` ↔ inventory) isn't muddied by a fourth, divergent list in CLAUDE.md.
- **Fix:** Trim the CLAUDE.md "Insurance" bullet to "member ID, group ID" to match `PHI_FIELDS`/inventory, or, if plan/provider name are intended to be PHI, add them to schema + `PHI_FIELDS` + inventory in lockstep.
- **Evidence:**
  ```prisma
  // schema.prisma:199-200 — only member/group encrypted; no planName/insurerName encrypted column
  memberIdEncrypted       String?            @map("member_id_encrypted")
  groupIdEncrypted        String?            @map("group_id_encrypted")
  ```

## Checks passed

### 1. Encryption Implementation
- [x] AES-256-GCM used (not CBC/weaker) — `encryption.ts:57` `const ALGORITHM = 'aes-256-gcm'`; used in `createCipheriv` at `encryption.ts:218,269` and `createDecipheriv` at `encryption.ts:246,318`.
- [x] Unique IV per encryption op — `encryption.ts:217` and `encryption.ts:267` both `crypto.randomBytes(IV_LENGTH)` (16 bytes) per call.
- [x] Auth tag verified on decryption — `encryption.ts:319` `decipher.setAuthTag(authTag)` before `decipher.final()`; `attemptDecrypt` throws if the tag fails (`encryption.ts:317-322`).
- [x] No ECB mode anywhere — Grep for `aes-256-cbc|aes-128|createCipher\b|-ecb|ECB` over `backend/src/**/*.ts` returned no matches; only GCM is used.

### 2. Key Management
- [x] Master key from `PHI_ENCRYPTION_KEY` env — `encryption.ts:159` `process.env.PHI_ENCRYPTION_KEY`; required in prod/staging at `config/index.ts:346`.
- [x] Key not hardcoded — the only literals are the *rejected* placeholder values in `INSECURE_KEYS` (`encryption.ts:92-96`), used to block weak keys, not to encrypt.
- [x] Key not logged / not in error messages — startup error banner (`encryption.ts:167-181`) prints only `validation.error`, never the key; no `logger.*` call references the key (Grep clean).
- [x] Proper KDF — PBKDF2-SHA512 via `crypto.pbkdf2Sync(... 'sha512')` at `encryption.ts:192-200`.
- [x] Weak/placeholder keys rejected in every environment — `encryption.ts:134-139` (no NODE_ENV gate) plus a second guard in `config/index.ts:371-383`.

### 3. Per-User Key Management
- [x] Per-user salt in `UserEncryptionKey` table — `userEncryption.ts:36-66`; model at `schema.prisma:77-92`.
- [x] Salt encrypted with master key before storage — `userEncryption.ts:55` `encryptWithMasterKey(newSalt)`; stored in `encryptedKey` (line 62).
- [x] PBKDF2-SHA512 at 600,000 iterations for new encryption — `encryption.ts:85` `PBKDF2_ITERATIONS = 600000`; default param in `deriveUserKey` (`encryption.ts:192`) and `encrypt` uses it (`encryption.ts:266`).
- [x] Legacy fallback (100k) only on auth-tag failure, no downgrade of new writes — `decrypt` tries 600k first (`encryption.ts:306`) and only retries 100k on throw (`encryption.ts:309`); `encrypt` never passes the legacy count, so new writes always use 600k.
- [x] 32-byte random salt per user — `encryption.ts:63` `SALT_LENGTH = 32`; `generateUserSalt` = `randomBytes(SALT_LENGTH)` (`encryption.ts:205-207`).
- [x] `version` + `isActive` present for future rotation — `schema.prisma:83-84`; set on create (`userEncryption.ts:63-64`).
- [x] In-service rotation helper removed, no dangling callers — removal note at `userEncryption.ts:74-80`; Grep for `rotateUserEncryptionKey` finds only the test comment (`userEncryption.test.ts:128`) confirming its tests were deleted. `KEY_ROTATION` enum retained as documented.
- [x] Salt created lazily via `getUserEncryptionSalt()` — `userEncryption.ts:29-72` (find-or-create).
- [x] Salt destroyed on account deletion — `UserEncryptionKey.user` is `onDelete: Cascade` (`schema.prisma:87`); `deleteAccount` deletes the `User` row (`settingsController.ts:965-969`), cascading the key away.

### 4. PHI Field Coverage
- [x] Every `*Encrypted` schema column appears in `PHI_FIELDS` — 34 PHI columns from `schema.prisma` (lines 14-18,33,106,147-148,182,199-200,389,408,416,449,468-469,618-651,674-677,700-701) map 1:1 to `PHI_FIELDS` (`encryption.ts:410-486`); counts match per model.
- [x] Every `PHI_FIELDS` entry has a schema column — verified both directions (no `PHI_FIELDS` key without a column).
- [x] No DNA/Genetics residue — Grep `DNAVariant|GeneticTrait` over `backend/` returned no hits, consistent with `_phi-inventory.md:73`.
- [x] `CostAnalysis.claudeResponseEncrypted` encrypted on write / decrypted on read — write `expenseController.ts:737`, read `expenseController.ts:799`, export read `settingsController.ts:613`; column `schema.prisma:674`, `PHI_FIELDS` `encryption.ts:476`.
- [x] Insurance member/group encrypted on write & read — write `insuranceController.ts:512-515,535-536`, read `insuranceController.ts:237-238`.
- [x] Expense PHI encrypted on write — `ExpenseActual` create `expenseController.ts:390-397`; `ExpenseProjection` `expenseController.ts:95-96,390`.
- [x] No plaintext write path for `memberId/groupId/healthProfile/dateOfBirth` — Grep over controllers shows every bare hit is a Zod input, a decrypted output property, or fed straight into `encrypt(...)`; no plaintext persistence (the one exception, `targetValue`, is F-1).

### 5. Encryption Service Usage
- [x] No plaintext PHI in logs — Grep for `logger.*` lines referencing PHI field names / `plaintext` / token names returned only `auditLog.ts:229` which logs the *error*, not the value.
- [x] Error messages don't leak plaintext — `decryptFields` logs only `err.message` and the field name, nulls the value (`encryption.ts:375-378`); decrypt throws generic `'Invalid encrypted data format'` (`encryption.ts:291,239`).
- [x] `decryptFields` handles corrupted data gracefully (returns null) — `encryption.ts:367-379`. (Note: inline `decrypt` call sites do *not* — see F-2.)

### 6. Memory Safety
- [x] No plaintext PHI in global variables — singletons hold only the master key buffer (`encryption.ts:156,396`) and the system salt (`auditLog.ts:122`); no PHI cached globally.
- [x] Encryption keys not retained beyond function scope — derived per-user keys are locals in `encrypt`/`decrypt`/`attemptDecrypt` (`encryption.ts:266,306-309,317`), never stored on the instance.
- [x] `hashForSearch` (weak 10k-iter SHA-256) is not used for any PHI lookup in production — Grep shows usages only in `encryption.test.ts`; no controller/service calls it.

### 7. SMART-on-FHIR OAuth Token Encryption
- [x] `accessTokenEncrypted`/`refreshTokenEncrypted` in `PHI_FIELDS.LabConnection` and schema — `encryption.ts:482-485`; `schema.prisma:700-701`.
- [x] Tokens encrypted with per-user salt, not master key — `labSyncService.ts:141-143` `getUserEncryptionSalt(userId)` → `encryption.encrypt(token, salt)` in `persistConnection`. No plaintext-token write path found.
- [x] Refresh-on-expiry re-encrypts rotated tokens under the same salt — `labSyncService.ts:230-242`.
- [x] Decrypted tokens never logged, never returned to client — decrypt outputs (`labSyncService.ts:213-215,403`) flow only into `FHIRClient` Bearer headers (`fhirClient.ts:50`) / `revokeToken`; SSRF-guarded endpoints (`smartAuth.ts:44-50`, `urlSafety` import); no token in any `logger.*`/`res.json`.
- [x] Tokens destroyed on account deletion — `LabConnection.user` is `onDelete: Cascade` (`schema.prisma:711`); `revokeAllUserConnections` revokes + deletes rows before cascade (`settingsController.ts:929`, `labSyncService.ts:412-413,427-440`), and the per-user salt is destroyed (Check 3) so any residue is unrecoverable.

### Audit log encryption
- [x] AuditLog PHI uses the system salt (`AUDIT_LOG_SALT`), not per-user — `auditLog.ts:148` `this.systemSalt = config.auditSalt`; `encryptValue` uses `this.systemSalt` (`auditLog.ts:220`). Survives account deletion for 7-year retention as designed.
- [x] Audit value encryption fails closed (no counterfeit ciphertext) — `auditLog.ts:221-231` re-throws on encrypt failure; `log()` converts to `InternalServerError` for `failClosed` mutations (`auditLog.ts:294-298`).

## Unverifiable
- "TLS 1.3 enforced" (in-transit) — the prompt's Architecture section claims this, but TLS termination is at GCP Cloud Run / the load balancer, not in repo code. No app-level TLS config exists to cite; cannot confirm 1.3 from the codebase.
- Working key-rotation job (Question 2) — confirmed the *old* in-service helper is removed with no callers, and that proper rotation is deferred to "a future dedicated re-encryption job" (`userEncryption.ts:74-80`, `encryption.ts:80-83`). No such job exists in the repo yet; whether one is planned/tracked is outside the code and unverifiable here. This is the acknowledged-future-work state the prompt expects, not a finding.

## Out of scope
- RLS policy correctness (`withRLSContext`/`withRLSTransaction` semantics) — owned by the RLS/access-control review; here only confirmed encryption call sites use it.
- SSRF protection internals of `fhir/urlSafety.ts` — covered by 09-external-apis; this review only confirmed token-bearing FHIR calls route through the guard.
- Application-log PHI redaction (`utils/phiRedaction.ts`) coverage breadth — owned by 31-logging-observability; here only confirmed no plaintext PHI/token is logged from the encryption path.
- `npm audit` / dependency CVEs — not part of the encryption spec checklist; deferred to the dependency-review prompt.
