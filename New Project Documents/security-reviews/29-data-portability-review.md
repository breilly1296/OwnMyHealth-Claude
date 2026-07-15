# Data Portability & Deletion Security Review — 2026-06-16

Scope: `prompts/29-data-portability.md` against HEAD `fb2cd32`. Reviewed the export
handler (`exportUserData`), both deletion handlers (`deleteAllData`, `deleteAccount`),
the settings routes/validation/demo-protection, the encryption PHI inventory, per-user
salt lifecycle, FHIR OAuth revocation, GCS cleanup, audit-log preservation/system-salt,
and the Prisma cascade graph. Static review only (no DB/runtime execution).

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 3 |
| Info | 1 |

The export and deletion paths are well-built: password re-auth on both destructive
operations, GCS-first/fail-hard ordering, fail-closed audit on export/delete, atomic
User-delete + audit insert, system-salt audit encryption that survives user deletion,
and a clean cascade graph. The one material defect is a **data-completeness bug in the
§164.524 export**: encrypted health-goal numeric values (target/current/start and
progress-history values) are read from the now-nulled plaintext twins, so they are
silently dropped (or zeroed) from the user's right-of-access export.

## Findings

### F-1 — Export reads goal numeric PHI from nulled plaintext twins; values silently dropped from §164.524 export — **High**
- **Location:** `backend/src/controllers/settingsController.ts:567-569,575,579`
- **Observation:** The health-goal export block reads the *plaintext* Decimal columns
  directly through `toNumber(...)` instead of the encrypted M4 twins:
  ```ts
  targetValue: toNumber(goal.targetValue),
  currentValue: goal.currentValue !== null && goal.currentValue !== undefined ? toNumber(goal.currentValue) : undefined,
  startValue: goal.startValue !== null && goal.startValue !== undefined ? toNumber(goal.startValue) : undefined,
  ...
  progressHistory: goal.progressHistory.map((entry) => ({
    value: toNumber(entry.value),
  ```
  But the M4 write path and the one-time backfill both **null** those plaintext columns
  whenever they populate the encrypted twin. New goals are written with
  `currentValueEncrypted: <cipher>, currentValue: null` and `startValueEncrypted: <cipher>,
  startValue: null` (`healthGoalsController.ts:418-422`, and on progress update
  `:632-633`); the backfill nulls them for legacy rows too (`backend/src/services/goalValueBackfill.ts:111,115,119,129`).
  `toNumber(null)` returns `0` (`utils/numberConversion.ts:29`), and the explicit
  `!== null` guards make current/start come out `undefined`.
  The controller itself reads these correctly via `readEncryptedNumber`
  (`healthGoalsController.ts:30-43,144-146`) which prefers the encrypted column — the
  export is the lone reader that was never migrated to that helper.
- **Impact:** For essentially **every** post-M4 health goal (the normal case), the
  user's data export emits `targetValue: 0`, omits `currentValue`/`startValue`, and emits
  every progress-history `value: 0`. The actual goal target, latest reading, baseline,
  and the entire numeric progression — the substance of the goal — never appear in the
  §164.524 right-of-access download even though the app holds them encrypted. This is a
  HIPAA right-of-access completeness defect (PHI the covered entity holds but does not
  return to the patient), and the export is also the one place a corrupt-twin decrypt is
  meant to degrade gracefully — here it degrades to a wrong number with no warning. Unlike
  most PHI-loss bugs it does not leak data outward, hence High not Critical.
- **Fix:** In `exportUserData`, route all four reads through the same decrypt-preferring
  logic the controller uses. Reuse/lift `readEncryptedNumber` (it already falls back to
  the plaintext twin for un-backfilled legacy rows): e.g.
  `targetValue: readEncryptedNumber(goal.targetValueEncrypted, goal.targetValue, userSalt) ?? 0`,
  and likewise for `currentValue`, `startValue`, and `progressHistory[].value`. Note the
  export's `withRLSContext` select must also include `targetValueEncrypted`,
  `currentValueEncrypted`, `startValueEncrypted`, and `progressHistory.valueEncrypted`
  (the current `findMany` at `:399-403` returns the full rows, so the columns are present;
  just consume the encrypted ones). Add a test asserting a goal whose plaintext twins are
  null still exports the decrypted values.
- **Evidence:**
  ```ts
  // settingsController.ts:567-569 (export — reads nulled plaintext)
  targetValue: toNumber(goal.targetValue),
  currentValue: goal.currentValue !== null && goal.currentValue !== undefined ? toNumber(goal.currentValue) : undefined,
  ```
  ```ts
  // healthGoalsController.ts:418-422 (write — nulls the plaintext twin)
  targetValueEncrypted,
  currentValueEncrypted,
  currentValue: null,
  startValueEncrypted,
  startValue: null,
  ```

### F-2 — `deleteAllData` lab-token revocation runs AFTER the irreversible GCS delete, before the DB wipe (best-effort, partial-failure window) — **Medium**
- **Location:** `backend/src/controllers/settingsController.ts:810-854`, `:873-911`; `backend/src/services/fhir/labSyncService.ts:480-493`
- **Observation:** In `deleteAllData` the sequence is: (1) GCS objects deleted with
  fail-hard abort (`:810-846`); (2) `revokeAllUserConnections(userId)` (`:854`); (3) the
  RLS transaction that deletes all DB rows including `labConnection.deleteMany` (`:896`).
  `revokeAllUserConnections` is best-effort — each `disconnectConnection` swallows its own
  revoke error (`labSyncService.ts:459-463`) and the loop swallows per-connection failures
  too (`:484-492`). Crucially, `disconnectConnection` itself **deletes the LabConnection
  row** as part of its work (`labSyncService.ts:465-467`). So at the point step (3) runs,
  the connections are already gone; that is fine. The real exposure is the ordering vs.
  GCS: GCS deletion (irreversible) happens *before* token revocation, so if the process
  dies between GCS-delete and revoke, the user's files are gone but provider OAuth tokens
  may still be live at Quest. There is also no audit row recording whether provider-side
  revocation actually succeeded (it's logged at warn only).
- **Impact:** A crash/timeout in the narrow window after GCS deletion but before/within
  `revokeAllUserConnections` leaves a live Quest access/refresh token at the upstream lab
  with the local connection state in an indeterminate spot, and no durable audit signal
  that revocation failed. The token grants continued read access to the patient's lab PHI
  at Quest. Likelihood is low (the window is small and revoke failures are typically
  transient), and `deleteAccount` has the same best-effort property by design — hence
  Medium, defense-in-depth, not High.
- **Fix:** (a) Move `revokeAllUserConnections(userId)` *before* the irreversible GCS
  delete so a revoke that throws can abort before any unrecoverable step (the current
  comment at `:848-854` justifies the present order to avoid severing access for data that
  was never deleted, but GCS is itself irreversible, so revoke-first is the safer
  invariant). (b) Surface provider-revoke failures into an audit row (e.g.
  `logSystem('UPDATE','LabConnection',{action:'REVOKE_FAILED',...})`) so an incident
  responder can find tokens that may still be live. Consider the same for `deleteAccount`
  (`:975`).

### F-3 — `deleteData`/`deleteAccount` Zod schemas are non-strict; extra body fields are accepted — **Low**
- **Location:** `backend/src/middleware/validation.ts:822-830`
- **Observation:** The `settings.deleteData` and `settings.deleteAccount` schemas are
  plain `z.object({ password: ... })` with no `.strict()`. Zod's default strips unknown
  keys rather than rejecting them, so a request body with arbitrary extra fields passes
  validation. The handlers only read `password`, so there is no injection here, but for
  the two most destructive endpoints in the app a strict contract is cheap belt-and-suspenders.
- **Impact:** No direct exploit — the controllers ignore extra keys. The risk is purely
  future-proofing: if a later refactor reads more of `req.body` on these handlers, a
  non-strict schema would silently let unexpected input through. Hygiene/hardening only.
- **Fix:** Add `.strict()` to both `deleteData` and `deleteAccount` schemas so unknown
  keys are rejected with 400.
- **Evidence:**
  ```ts
  deleteData: z.object({ password: z.string().min(1, 'Password is required') }),
  deleteAccount: z.object({ password: z.string().min(1, 'Password is required') }),
  ```

### F-4 — Export's per-row decrypt-failure degrades silently to NaN/0/"" with no per-field audit signal — **Low**
- **Location:** `backend/src/controllers/settingsController.ts:448-462,486,502,593`
- **Observation:** The export wraps inline decrypts in `tryDecrypt`, which on failure
  logs a warn and returns `null` so one bad row can't 500 the whole export (good, M-7).
  But the numeric biomarker paths then do `parseFloat(decryptedValue)` where
  `decryptedValue` may be `null` → `NaN` is serialized into the JSON (`:486,502`), and the
  string paths coerce to `''` (e.g. health-need `description` at `:593`). The `logExport`
  audit (`:724-736`) records only per-category *counts*, not a "fields that failed to
  decrypt" flag, so a partially-corrupt export looks complete in the audit trail.
- **Impact:** A user with a key-mismatched/corrupt PHI row receives an export that
  silently contains `NaN`/`""`/`0` placeholders for the affected fields, and the audit
  log gives no indication the export was lossy. This is a data-integrity/observability
  gap on the right-of-access path, not a disclosure. Low.
- **Fix:** Count decrypt failures in the `tryDecrypt` wrapper and include a
  `decryptFailureCount` in the `logExport` metadata; optionally surface a non-PHI warning
  field in the export envelope (e.g. `"partial": true`) so the user knows to contact
  support. Coerce `NaN` to `null` for numeric fields so the JSON stays well-typed.

### F-5 — Prompt/type drift: backend export now emits `plan.id` but frontend `ExportInsurancePlan` type omits it — **Low (Prompt drift)**
- **Location:** `backend/src/controllers/settingsController.ts:166-184,529`; `src/services/api/settings.ts:30-44`
- **Observation:** The backend `ExportInsurancePlan` interface and the emitted object now
  include `id: plan.id` (settingsController.ts:169,529) so per-plan benefits/expense rows
  can be cross-referenced. The frontend `ExportInsurancePlan` type
  (`src/services/api/settings.ts:30-44`) and the frontend `ExportUserFile` type
  (`:109-117`, missing `id`/`storageKey`) do not list these fields. The data is still
  present in the JSON the user downloads (the frontend just `JSON.stringify`s the raw
  response in `AccountSettingsPage.handleExportData`), so there is no functional break —
  the typings are merely behind the wire shape.
- **Impact:** None at runtime (export is serialized verbatim). Type-only drift that could
  mislead a future frontend consumer of the typed export. Recorded per the protocol's
  "trust the code, log the drift" rule.
- **Fix:** Add `id: string` to the frontend `ExportInsurancePlan`, and `id`/`storageKey`
  to `ExportUserFile`, to match the backend contract.

### F-6 — `Biomarker.userFile` relation has no `onDelete`; relies on user-cascade ordering, not its own rule — **Info**
- **Location:** `backend/prisma/schema.prisma:204` (`userFile UserFile? @relation(fields:[userFileId], references:[id])`)
- **Observation:** `Biomarker.userFile` (child→parent FK to `UserFile`) declares no
  `onDelete`, so it defaults to `Restrict`/`NoAction` at the DB level. On full account
  deletion this never bites because both `Biomarker` and `UserFile` cascade from `User`
  independently, and Postgres resolves the cascade set together. On `deleteAllData`,
  `userFile.deleteMany` and `biomarker.deleteMany` run in the same transaction
  (`settingsController.ts:891,895`); both target all of the user's rows, so no biomarker
  is left pointing at a deleted file. No orphan/FK-violation path was found.
- **Impact:** None observed — noted only because a `Restrict` child relation is the kind
  of thing that can surface FK errors if a future partial-delete path deletes `UserFile`
  rows without also deleting their `Biomarker` children. Worth an explicit
  `onDelete: SetNull` on `userFileId` for clarity/robustness, but not a current defect.
- **Fix:** (Optional) Set `userFile UserFile? @relation(..., onDelete: SetNull)` and make
  `userFileId` nullable-on-delete behavior explicit, so the dependency is enforced by the
  schema rather than by delete ordering.

## Checks passed

### 1. Data Export Completeness
- [x] Export includes user profile (decrypted name/DOB/phone/address) — `settingsController.ts:470-479` (decrypts `firstName/lastName/dateOfBirth/phone/address`).
- [x] Self-reported `healthProfile` included via `getDecryptedHealthProfile` — `settingsController.ts:468,693`; service at `healthProfileService.ts:58-88`.
- [x] Biomarkers + per-marker history decrypted — `settingsController.ts:482-526` (history at `:499-505`).
- [x] Insurance plans + per-plan benefits, member/group IDs decrypted — `settingsController.ts:528-559` (`memberId`/`groupId` decrypt at `:541-542`).
- [x] Health needs decrypted descriptions — `settingsController.ts:588-601`.
- [x] Expense projections + actuals decrypted (incl. all monetary `*Encrypted` strings) — `settingsController.ts:603-632`.
- [x] Cost analyses `claudeResponse` decrypted (legacy JSON key kept) — `settingsController.ts:634-645,640`.
- [x] File metadata incl. L24-decrypted `originalFilename` via `decryptOriginalFilename` — `settingsController.ts:14,647-658,651`; helper `utils/userFileNames.ts:13-26`.
- [x] Provider relationships (status/permissions/dates/notes) — `settingsController.ts:660-675`.
- [x] PHI decrypted with the per-user salt from `getUserEncryptionSalt` — `settingsController.ts:342`; salt service `userEncryption.ts:29-72`.
- [x] LabConnection rows deliberately NOT exported (only OAuth tokens live in them; no user-facing lab metadata silently dropped — sync state lives on biomarkers which ARE exported) — confirmed `exportUserData` `Promise.all` (`:376-427`) has no `labConnection.findMany`.
- [x] Export includes metadata (`exportDate`, per-category `summary`, `byCategory`, `filesNote`) — `settingsController.ts:690-718`.
- [x] Single machine-readable JSON download; no partial exports — one `res.json(response)` (`:752`); frontend blobs the whole payload (`AccountSettingsPage.tsx:163-172`).
- [x] No other users' data in export — all queries scoped `where:{userId}` under `withRLSContext(userId,...)`; provider relations scoped to `patientId|providerId === userId` (`:424-426`).
- [x] `healthGoals` descriptions/notes decrypted — `settingsController.ts:565,581`. *(Numeric goal values are the F-1 exception.)*

### 2. Export Security
- [x] Endpoint requires auth — `settingsRoutes.ts:31` (`router.use(authenticate)`), `:86-90`.
- [x] Rate limited with `sensitiveLimiter` — `settingsRoutes.ts:88`.
- [x] Audit logged as `action=EXPORT`, `failClosed`, with per-category counts (M18) — `settingsController.ts:724-736`; `auditLog.ts:517-538` (`action:'EXPORT'`, `failClosed:true`).
- [x] No `passwordHash`/internal-only fields in export — user `select` is profile fields only (`:360-369`); no `passwordHash` selected.
- [x] No encryption keys/salts in export — `userSalt` used to decrypt but never serialized; no `UserEncryptionKey` query in the handler.
- [x] No-cache headers set — `settingsController.ts:746-750` (`Cache-Control: no-store, no-cache, private, must-revalidate`, `Pragma`, `Expires: 0`).
- [x] Large exports use bounded-concurrency decrypt (`processBatch`, `DECRYPT_BATCH_SIZE=20`) — `settingsController.ts:29,482,561,588,603,616,634,660`; `utils/batchProcessor.ts`.
- [x] One corrupt PHI row does not 500 the whole export (M-7 `tryDecrypt`) — `settingsController.ts:448-462`. *(Silent degradation noted as F-4.)*

### 3. Health Data Deletion (`deleteAllData`)
- [x] Requires password confirmation before any deletion — `settingsController.ts:773-787`; `verifyPassword` from `authService`.
- [x] Deletes biomarkers (history cascades) — `settingsController.ts:891`; `schema.prisma:226` (`BiomarkerHistory ... onDelete: Cascade`).
- [x] Deletes insurance plans (benefits cascade) — `settingsController.ts:892`; `schema.prisma:418`.
- [x] Deletes health goals (progress history cascades; M4 encrypted columns dropped by cascade) — `settingsController.ts:894`; `schema.prisma:508`.
- [x] Deletes health needs — `settingsController.ts:893`.
- [x] Deletes cost analyses → expense actuals → projections in FK order — `settingsController.ts:874-876`.
- [x] Deletes `LabConnection` rows explicitly (account survives) + provider revoke — `settingsController.ts:854,896`. *(Ordering caveat = F-2.)*
- [x] Deletes uploaded files (GCS-first then DB rows) — `settingsController.ts:810-812,895`.
- [x] Preserves account/credentials/`UserEncryptionKey` (only health rows deleted; no `user.delete`/`userEncryptionKey.delete`) — confirmed no such call in `deleteAllData`.
- [x] Preserves audit logs (no `auditLog.deleteMany`; only success/failure rows added) — `settingsController.ts:914-926`.
- [x] DB deletes transactional (`withRLSTransaction`); GCS runs first outside txn and aborts on failure — `settingsController.ts:810-846,873`.
- [x] Deletion audit logged with per-category counts — `settingsController.ts:914-926`; blocked-attempt audit at `:830-840`.

### 4. Full Account Deletion (`deleteAccount`)
- [x] Requires password confirmation — `settingsController.ts:944-969`.
- [x] Single `tx.user.delete` relies on cascade — `settingsController.ts:1045-1047`; every User-owned relation has `onDelete: Cascade` (Session `:81`, RevokedAccessToken `:101`, UserEncryptionKey `:118`, ProviderPatient both sides `:140-141`, UserFile `:175`, Biomarker `:205`, InsurancePlan `:390`, HealthNeed `:437`, HealthGoal `:485`, ExpenseProjection `:690`, ExpenseActual `:718`, CostAnalysis `:743`, LabConnection `:774`).
- [x] Per-user salt removed via UserEncryptionKey cascade (no explicit destroy) — `schema.prisma:118`; `userEncryption.ts` has no delete helper (confirmed; rotation helper removed `:74-80`).
- [x] DNA/Genetics removed — no `DNAVariant`/`GeneticTrait` in schema (Grep over `schema.prisma`: 0 hits); migration `20260423_drop_dna_genetics` present.
- [x] Quest OAuth tokens revoked before cascade — `settingsController.ts:975` (`revokeAllUserConnections` before `tx.user.delete`).
- [x] Provider relationships cascade both sides — `schema.prisma:140-141` (`PatientUser`/`ProviderUser`, both Cascade).
- [x] GCS files removed before cascade, fail-hard — `settingsController.ts:977-1024`.
- [x] Audit logs PRESERVED — `AuditLog.user` is the only non-cascading User relation (`schema.prisma:537`, no `onDelete`), `userId` nullable (`:517`); success audit inserted BEFORE delete on same tx so FK SET NULL keeps the row — `settingsController.ts:1037-1048`.
- [x] Delete + cascade runs in admin RLS context — `settingsController.ts:1037` (`withRLSContext(null, ...)`).
- [x] Account unrecoverable — single hard `tx.user.delete`; no soft-delete/grace-period column or restore path found (`isActive` is a lockout flag, not a tombstone).

### 5. Cascade Integrity
- [x] All required `onDelete` cascades present and `ExpenseProjection→ExpenseActual` is `SetNull` (actuals survive projection delete) — `schema.prisma:720`.
- [x] `AuditLog.user` intentionally non-cascading — `schema.prisma:537`.
- [x] No orphan risk from removed DNA models; manual `deleteAllData` order respects FKs (actuals/cost-analyses before projections/plans) — `settingsController.ts:874-876`.

### 6. Encryption Key Lifecycle
- [x] Salt removed on account delete via cascade — `schema.prisma:118`.
- [x] Master key (`PHI_ENCRYPTION_KEY`) unaffected by user deletion — salt encrypted with master key (`userEncryption.ts:49,55` `encryptWithMasterKey`/`decryptWithMasterKey`); deletion only drops the salt row.
- [x] Rotation helper removed; `KEY_ROTATION` enum retained, no caller — `userEncryption.ts:74-80`; `schema.prisma:670`; Grep `readEncryptedNumber`/rotation callers = none rotate.
- [x] `deleteAllData` preserves `UserEncryptionKey` so post-wipe PHI still decrypts with same salt — no key delete in that path (confirmed).
- [x] After salt row gone, user's encrypted data is unrecoverable — salt is the only per-user key material; nothing else stores it.

### 7. Audit Log Preservation
- [x] Audit logs survive deletion (7-yr retention; non-cascading relation) — `auditLog.ts:10` (`RETENTION_DAYS=2555`), `schema.prisma:537`.
- [x] `userId` nullable, rows don't depend on user existence — `schema.prisma:517`.
- [x] Deleted user's logs queryable by admin — `auditLog.ts:559-612` (admin RLS context).
- [x] Audit PHI (`previousValueEncrypted`/`newValueEncrypted`/`metadataEncrypted`) uses SYSTEM salt, not per-user — `auditLog.ts:153,179` (`systemSalt = config.auditSalt`), used in `encryptValue` `:251` and `decryptMetadata` `:278`; legacy plaintext `metadata` column dropped (migration `20260615_drop_legacy_audit_metadata`).

## Unverifiable
- **Cascade actually fires from `tx.user.delete` at runtime** — the schema declares the
  cascades (verified), but this static review did not run the live-PG delete to observe
  the cascade and salt-row removal end to end. The prompt itself flags this as a
  "confirm the cascade is wired and tested" item; the wiring is correct in schema, the
  runtime assertion is out of scope for static review.
- **`config.auditSalt` length validation at boot** — `auditLog.ts:175-179` asserts the
  value is validated in `config/index.ts`; I did not re-open `config/index.ts` to confirm
  the `>=16`/`>=64` hex check, so I cannot tick it from this review's evidence (it is in
  scope of prompt 02-encryption / 31-logging, not re-verified here).

## Out of scope
- `storageService.deleteFiles` GCS semantics and the single-file `fileController.deleteFile`
  log-and-continue inconsistency (F-22 in the file-handling domain) — referenced by the
  prompt but owned by the file-management / storage review.
- Refresh-token family revocation, CSRF, and rate-limiter keying — covered by the auth
  and middleware reviews; only the export/delete endpoints' auth+rate-limit presence was
  checked here.
- General PHI-field ↔ schema lockstep audit (39 fields / 14 models) — owned by the
  encryption review (`02`) / PHI inventory; spot-confirmed only for the export/delete-
  relevant fields here.
