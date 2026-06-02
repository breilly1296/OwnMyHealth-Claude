# 29-data-portability Review — 2026-06-01

Scope: data export (§164.524 right-of-access), health-data deletion, full account deletion, cascade integrity, encryption-key lifecycle, and audit-log preservation. Reviewed against the live code at `C:/Users/breil/Projects/OwnMyHealth/`. Report only — no code modified.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 3 |
| Info | 1 |

## Findings

### F-1 — `sensitiveLimiter` on export/delete is IP-keyed, not user-keyed — **Medium**
- **Location:** `backend/src/middleware/rateLimiter.ts:92` (definition); applied to every settings route at `backend/src/routes/settingsRoutes.ts:36,43,52,59,68,77,88,100,109` (including `/export-data` at :88, `/delete-data` at :100, `/delete-account` at :109)
- **Observation:** `sensitiveLimiter` is created with `max: 10 / 1h` but **no `keyGenerator`**, so express-rate-limit falls back to its default key (the client IP). Every sensitive settings endpoint — `GET /profile`, `GET /notifications`, `GET /health-profile`, `GET /export-data`, `DELETE /delete-data`, `DELETE /delete-account` — shares one IP-scoped 10/hour bucket. The sibling limiters `aiLimiter` (line 121) and the provider limiter (line 127+) both explicitly key by `req.user?.id`, so the per-user pattern is the established design elsewhere and was simply not applied here.
- **Impact:** (1) Legit-user DoS: multiple users behind one NAT/VPN/corporate egress IP contend for the same 10/hour budget; routine profile + notification reads can lock a different user out of their right-of-access export. (2) The per-user abuse cap that protects the expensive full-record export dump does not exist — the cap is per-IP, not per-account.
- **Fix:** Add a `keyGenerator` to `sensitiveLimiter` mirroring `aiLimiter:121-124` (`req.user?.id ?? req.ip ?? ...`). Consider a tighter dedicated limiter for `export-data`/`delete-*` separate from the read-only `GET /profile`/`/notifications` so a full-record dump isn't sharing a bucket with cheap reads.
- **Evidence:**
  ```ts
  export const sensitiveLimiter = rateLimit({
    store: createRateLimitStore('sensitive'),
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 requests per hour
    // (no keyGenerator → defaults to IP)
  ```

### F-2 — `deleteAccount` writes a DELETE-User audit "success" before deletion can abort — **Medium**
- **Location:** `backend/src/controllers/settingsController.ts:920` (logDelete) vs `:941-962` (GCS abort) and `:965-969` (actual cascade)
- **Observation:** In `deleteAccount`, `auditService.logDelete('User', userId, { reason: 'user_requested' })` runs at line 920 — *before* `revokeAllUserConnections` (929), the GCS enumeration/delete (934-943), the fail-hard GCS check (946-962), and the actual `tx.user.delete` (966). If any GCS object fails to delete, the handler throws at line 958 with the account **preserved**, yet a primary `action=DELETE resourceType=User` audit row (which `logDelete` marks `failClosed: true`, i.e. recorded as a normal success entry) already claims the user was deleted. `deleteAllData` does the opposite — it logs success *after* the deletes complete (line 862). A compensating `logSystem('DELETE_ACCOUNT_FAILED')` row is written at 947, so the truth is reconstructable by correlating two rows, but the canonical DELETE-User entry is misleading on its own.
- **Impact:** Audit-trail accuracy gap for the single most consequential HIPAA event (account destruction). A compliance query for "was user X deleted?" returns a false positive; a deleted-then-not-deleted account looks deleted in the primary log. No PHI disclosure, hence Medium not High.
- **Fix:** Move the `logDelete('User', ...)` call to *after* the successful `tx.user.delete` (after line 969), matching the post-deletion ordering used in `deleteAllData`. Keep the pre-flight intent recordable via the existing `DELETE_ACCOUNT_FAILED` system log on the failure path.
- **Evidence:**
  ```ts
  // Audit log: DELETE account (log before deletion)
  await auditService.logDelete('User', userId, { email: user.email, reason: 'user_requested' }, { req, userId });
  ...
  throw new Error(`Failed to delete ${gcsFailures.length} of ${filesToDelete.length} files from storage. Your account was not deleted. ...`);
  ```

### F-3 — `deleteAllData` revokes lab OAuth tokens only locally, not at the provider — **Low**
- **Location:** `backend/src/controllers/settingsController.ts:844` (the explicit `labConnection.deleteMany`) with the comment at `:814-820`
- **Observation:** `deleteAllData` deletes `LabConnection` rows with `tx.labConnection.deleteMany({ where: { userId } })` but does **not** call `revokeAllUserConnections`. `deleteAccount` does call it (line 929). The in-code comment (814-820) acknowledges this: tokens "stay valid at the upstream provider until the next refresh attempt." So after a health-data wipe, the encrypted refresh/access tokens are destroyed locally while the grant remains live at Quest until it naturally expires, with no way left to revoke it.
- **Impact:** A previously-issued SMART-on-FHIR access/refresh token (a direct path to live PHI at the lab per `_phi-inventory.md`) outlives the user's local deletion of the connection. The blast radius is limited (token must already be exfiltrated; it expires on its own), so Low — but it is an inconsistent posture vs. the account-delete path and answers spec Question 7 ("should deleteAllData revoke at provider?") in the negative.
- **Fix:** Call `await revokeAllUserConnections(userId)` before the `labConnection.deleteMany` in `deleteAllData`, the same as `deleteAccount:929`. The function already swallows per-connection errors so it won't block the wipe.
- **Evidence:**
  ```ts
  // LabConnection ... deleteAllData just severs the local record. Document if a future
  // requirement is "revoke at provider on data-wipe too".
  ...
  tx.labConnection.deleteMany({ where: { userId } }).then((r) => r.count),
  ```

### F-4 — Prompt drift: stale "DNA/lab connections" comment in `deleteAllData` — **Low**
- **Location:** `backend/src/controllers/settingsController.ts:809`
- **Observation:** The deletion-order comment reads "...biomarkers/insurance/goals/needs/ DNA/lab connections." DNA/Genetics models (`DNAVariant`/`GeneticTrait`) were dropped in migration `20260423_drop_dna_genetics`; `Grep` for `DNAVariant|GeneticTrait|dna_data` in `schema.prisma` returns **no matches**. There is no DNA data to delete, so the comment names a table that no longer exists. The spec checklist (item 4, "stale code comment still says 'DNA/lab connections'") predicted exactly this — so this confirms the prompt's own note rather than contradicting it.
- **Impact:** Documentation/maintenance only — a future reader may believe a DNA wipe is happening when it is not. No runtime effect.
- **Fix:** Delete "DNA/" from the comment at line 809.
- **Evidence:**
  ```ts
  // provider relationships → user files → biomarkers/insurance/goals/needs/
  // DNA/lab connections. Cost analyses and expense actuals reference
  ```

### F-5 — Prompt drift: frontend `ExportUserFile` type omits `id`/`storageKey` returned by backend — **Low**
- **Location:** `src/services/api/settings.ts:109-117` vs backend `backend/src/controllers/settingsController.ts:247-260,620-630`
- **Observation:** The backend export now emits `id` and `storageKey` per file (added to `ExportUserFile`, controller lines 251-252 and populated 621-622), but the frontend `ExportUserFile` interface starts at `originalFilename` and never declares `id` or `storageKey`. The exported JSON still contains those fields (the download is `JSON.stringify(data)` of the raw response in `AccountSettingsPage.tsx:162`), so no data is dropped from the user's file — this is purely a TypeScript contract that has drifted behind the server shape.
- **Impact:** No security impact and no data loss; type-safety/maintenance gap only. `storageKey` is a bucket path, not PHI, and is intentionally exported per the controller's own comment (lines 247-250).
- **Fix:** Add `id: string; storageKey: string;` to the frontend `ExportUserFile` interface to match the server.
- **Evidence:**
  ```ts
  export interface ExportUserFile {
    originalFilename: string;   // backend also sends id + storageKey
    fileType: string;
  ```

### F-6 — Info: no soft-delete / grace period; deletion is immediate and irreversible — **Info**
- **Location:** `backend/src/controllers/settingsController.ts:965-969` (`deleteAccount` cascade) and `:821-859` (`deleteAllData`)
- **Observation:** Both delete paths perform hard deletes with no soft-delete flag, tombstone, or recovery window. Once `tx.user.delete` cascades (and the `UserEncryptionKey` row goes with it), the user's encrypted data is permanently unrecoverable. This is by design per the spec ("Account cannot be recovered after deletion") and answers spec Question 6, but is flagged so the product owner confirms there is intentionally no grace period.
- **Impact:** None as a vulnerability; a deliberate product/compliance choice worth an explicit sign-off.
- **Fix:** None required. Confirm intent.
- **Evidence:**
  ```ts
  // Only now run the cascade delete. admin context (userId=null).
  await withRLSContext(null, async (tx) => { await tx.user.delete({ where: { id: userId } }); });
  ```

## Checks passed

### 1. Data Export Completeness
- [x] Export includes user profile (decrypted name/DOB/phone/address) — `settingsController.ts:447-456`.
- [x] Self-reported `healthProfile` included in export — fetched via `getDecryptedHealthProfile(userId)` at `settingsController.ts:445` and placed in `exportData.healthProfile` at `:665`.
- [x] Biomarkers + per-biomarker history decrypted — `settingsController.ts:459-499` (history map at `:475-478`).
- [x] Insurance plans (decrypted member/group IDs) AND per-plan benefits — `settingsController.ts:501-532`; `memberId`/`groupId` decrypt at `:514-515`, benefits included via `include: { benefits: true }` at `:392`.
- [x] Health goals + descriptions/target/progress history — `settingsController.ts:534-559`.
- [x] Health needs (decrypted description) — `settingsController.ts:561-574` (`decrypt(need.descriptionEncrypted, ...)` at `:566`).
- [x] Expense projections and actuals decrypted — `settingsController.ts:576-605`.
- [x] Cost analyses with decrypted `claudeResponse` (legacy JSON key, `claudeResponseEncrypted` column) — `settingsController.ts:607-618` (`decrypt(analysis.claudeResponseEncrypted, ...)` at `:613`).
- [x] Uploaded file metadata (id/storageKey/filename; bytes downloaded separately) — `settingsController.ts:620-630`; `filesNote` at `:675`.
- [x] Provider relationships (status/permissions/dates/notes) — `settingsController.ts:632-647`.
- [x] PHI decrypted with the user salt from `getUserEncryptionSalt` — `settingsController.ts:338` (`getUserEncryptionSalt(userId)`) feeding `decrypt(..., userSalt)` throughout.
- [x] LabConnection rows deliberately NOT exported (no token/connection data in `ExportData`) — verified `ExportData` interface `:286-314` has no lab field; no `labConnection.findMany` in `exportUserData`.
- [x] Export includes metadata (dates, categories, source labels) — `summary`/`byCategory` at `:649-660,676-689`; per-biomarker `source` derivation at `:464-473`.
- [x] Machine-readable single JSON download — `res.json(response)` at `:722`; client wraps in one Blob at `AccountSettingsPage.tsx:162`.
- [x] No other users' data — all reads RLS-scoped under `withRLSContext(userId, ...)` (`:353`) and `where: { userId }`; provider relations scoped to `patientId===userId OR providerId===userId` (`:421`).

### 2. Export Security
- [x] Export endpoint requires auth — `settingsRoutes.ts:31` (`router.use(authenticate)`), route at `:86-90`.
- [x] Export rate limited — `sensitiveLimiter` at `settingsRoutes.ts:88` (but see F-1 on IP-keying).
- [x] Export audit logged with per-category counts — `settingsController.ts:693-706` (`operation: 'EXPORT'` + 11 counts incl. healthProfile condition/medication counts).
- [x] Export excludes `passwordHash`/internal-only fields — `user` `select` (`:356-365`) omits `passwordHash`; only enumerated fields are mapped.
- [x] Export excludes encryption keys/salts — no `userEncryptionKey`/`encryptedKey`/salt read in `exportUserData`.
- [x] No-cache headers set — `settingsController.ts:716-720` (`Cache-Control: no-store, no-cache, private, must-revalidate`, `Pragma`, `Expires: 0`).
- [x] Large exports use bounded concurrency — `processBatch(..., DECRYPT_BATCH_SIZE)` with `DECRYPT_BATCH_SIZE = 20` (`:27`, used at `:459,534,561,576,589,607,632`).

### 3. Health Data Deletion (`deleteAllData`)
- [x] Requires password confirmation — `verifyPassword` before any deletion at `settingsController.ts:754-757`; Zod `deleteData` schema requires non-empty password (`validation.ts:705-707`).
- [x] Deletes biomarkers (+history cascades) — `:839`; `BiomarkerHistory` cascade from `Biomarker` at `schema.prisma:185`.
- [x] Deletes insurance plans (+benefits cascade) — `:840`; benefit cascade from `InsurancePlan` confirmed in schema relations.
- [x] Deletes health goals (+progress cascade) — `:842`; `GoalProgressHistory` cascade at `schema.prisma:451`.
- [x] Deletes health needs — `:841`.
- [x] Deletes cost analyses → actuals → projections in FK order — `:822-824`.
- [x] Deletes `LabConnection` rows explicitly (account survives, no cascade) — `:844` (provider-side revoke gap is F-3).
- [x] Deletes files DB + GCS, GCS-first — GCS `deleteFiles` at `:780` before the DB transaction at `:821`; user files deleted at `:843`.
- [x] Preserves account/sessions/credentials AND `UserEncryptionKey` — no `user`/`session`/`userEncryptionKey` delete in `deleteAllData`.
- [x] Preserves audit logs — no `auditLog` delete; audit success row written at `:862`.
- [x] DB deletes transactional; GCS first + aborts on failure — `withRLSTransaction(userId, ...)` at `:821`; GCS fail-hard at `:785-801`.
- [x] Deletion audit logged with per-category counts — `auditService.logDelete('UserData', ...)` at `:862-874`.

### 4. Full Account Deletion (`deleteAccount`)
- [x] Requires password confirmation — `:894-895` (presence) and `:914-917` (`verifyPassword`); Zod `deleteAccount` at `validation.ts:711-713`.
- [x] Single `tx.user.delete` relying on cascade — `:966-968`.
- [x] Per-user salt removed via cascade — `UserEncryptionKey.user ... onDelete: Cascade` at `schema.prisma:87`.
- [x] Revokes Quest OAuth tokens at provider BEFORE cascade — `revokeAllUserConnections(userId)` at `:929`, which calls `disconnectConnection` → `revokeToken` (`labSyncService.ts:405,427-440`).
- [x] Revokes provider relationships (both sides) — `ProviderPatient` cascades for `PatientUser` and `ProviderUser` (`schema.prisma:109-110`).
- [x] GCS files removed before cascade, fail-hard — enumerated at `:934-939`, deleted at `:941`, abort at `:946-962`.
- [x] Audit logs preserved — `AuditLog.user` relation has no `onDelete` (`schema.prisma:474`) and the DB FK is `ON DELETE SET NULL` (`00000000000000_initial_schema/migration.sql:400`); `userId` nullable (`schema.prisma:460`).
- [x] Cascade runs in admin RLS context — `withRLSContext(null, ...)` at `:965`.

### 5. Cascade Integrity
- [x] User→Sessions cascade — `schema.prisma:69`.
- [x] User→UserEncryptionKey cascade — `schema.prisma:87`.
- [x] User→UserFiles cascade — `schema.prisma:134`.
- [x] User→Biomarkers cascade — `schema.prisma:164`.
- [x] User→InsurancePlans / HealthNeeds / HealthGoals cascade — `schema.prisma:349,396,433`.
- [x] User→ExpenseProjection/ExpenseActual/CostAnalysis cascade — `schema.prisma:627,655,680`.
- [x] User→ProviderPatient cascade (both relations) — `schema.prisma:109-110`.
- [x] User→LabConnection cascade — `schema.prisma:711`.
- [x] User→AuditLog NON-cascading (intentional) — `schema.prisma:474` (no action) + DB `SET NULL` (`initial_schema migration.sql:400`).
- [x] Biomarker→BiomarkerHistory cascade — `schema.prisma:185`.
- [x] HealthGoal→GoalProgressHistory cascade — `schema.prisma:451`.
- [x] InsurancePlan→ExpenseProjection/Actual/CostAnalysis cascade — `schema.prisma:628,656,681`.
- [x] ExpenseProjection→ExpenseActual is `SetNull` (not cascade) — `schema.prisma:657` and `20260111_add_expense_tracking/migration.sql:23`.
- [x] No DNA orphan risk — `DNAVariant`/`GeneticTrait`/`dna_data` absent from `schema.prisma` (Grep: no matches).

### 6. Encryption Key Lifecycle
- [x] Per-user salt removed on account delete via cascade (no explicit destroy) — cascade at `schema.prisma:87`; `Grep` of `userEncryption.ts` shows no `deleteKey`/`destroyKey`/`userEncryptionKey...delete`.
- [x] Master key unaffected by individual deletion — salt encrypted with master key via `encryptWithMasterKey` (`userEncryption.ts:55`); deletion only removes the per-user salt row.
- [x] Rotation helper removed; `KEY_ROTATION` enum retained; no caller expects rotation — documented at `userEncryption.ts:74-80`; no rotation export remains in the file.
- [x] `deleteAllData` preserves `UserEncryptionKey` so new PHI still decrypts with the same salt — no salt mutation/delete in `deleteAllData` (`:821-859`); `getUserEncryptionSalt` returns the existing active key (`userEncryption.ts:36-50`).

### 7. Audit Log Preservation
- [x] Audit logs survive account deletion (non-cascading) — `schema.prisma:474` + DB `SET NULL`.
- [x] `userId` nullable, logs don't depend on user existence — `userId String?` (`schema.prisma:460`).
- [x] Deleted user's logs queryable by admin — `audit_logs_select` policy `user_id = current_user_id() OR is_admin_session()` (`20260107_add_rls_policies/migration.sql:512-517`); delete restricted to admin (`:528-530`); no UPDATE policy = immutable (`:524-525`).
- [x] Audit PHI uses SYSTEM salt, not per-user salt — `this.systemSalt = config.auditSalt` (`auditLog.ts:148`) used in `encryptValue` (`:220`), so audit snapshots stay decryptable after the user's `UserEncryptionKey` is gone.

## Unverifiable
- Whether the User→UserEncryptionKey cascade is actually exercised by a test ("is the cascade wired and tested?" — spec Q3). The cascade is wired in schema and DB (`schema.prisma:87`), but no test file was located that asserts `UserEncryptionKey` rows disappear after `deleteAccount`. Reporting the wiring as passed; the *test* existence is unverified within this review's scope.
- Runtime confirmation that GCS `deleteFile` raises a non-404 distinguishable error for the fail-hard branch (`storageService.ts:170` re-throws whatever `deleteFile` throws). The 404→ok mapping is referenced in the docblock (`:155`) but the 404-classification logic lives inside `deleteFile` (not read in full here); the abort path's correctness depends on it.

## Out of scope
- The single-file `fileController.deleteFile` log-and-continue semantics (referenced as F-22 in the domain audit at `settingsController.ts:774-779`) — explicitly a different code path the spec did not list under data-portability; noted only as context for the bulk-delete GCS-first policy.
- `getProfile`/`updateProfile`/`getNotifications`/`updateNotifications`/`getHealthProfile`/`updateHealthProfile` handlers beyond their bearing on export/delete — these are settings CRUD, covered by other prompts; only their auth/limiter wiring (relevant to F-1) was assessed.
- SMART-on-FHIR OAuth handshake internals (`smartAuth.ts`, `urlSafety.ts`) — covered by prompt 09-external-apis; only `revokeToken`/`disconnectConnection`/`revokeAllUserConnections` reachability from the delete paths was verified here.
