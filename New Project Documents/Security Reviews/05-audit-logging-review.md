# 05-audit-logging Review — 2026-06-01

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |

Overall the audit subsystem is in strong shape: every PHI-touching controller and the provider/patient/admin/biomarker routes emit audit rows, encryption-failure fails closed (#28), PHI mutations fail closed (#17), DB-level immutability is enforced by the absent UPDATE policy, retention is 7 years with mutually-exclusive scheduler paths, and the internal cleanup endpoint is constant-time-token-authenticated and CSRF-exempt. The findings below are integrity/queryability and defense-in-depth gaps, plus prompt-drift notes — none are a direct PHI-disclosure or auth-bypass path.

## Findings

### F-1 — `success` / `errorMessage` audit columns are never populated — **Medium**
- **Location:** `backend/src/services/auditLog.ts:243-255` (the `data` object built in `log()`)
- **Observation:** The schema defines `success Boolean @default(true)` and `errorMessage String?` on `AuditLog`, and callers pass failure context (e.g. `logAuth('LOGIN_FAILED', …)`, provider denied-access `logAccess(…, { reason: 'NO_CONSENT' })`). But `log()`'s `data` object writes only `userId, actorType, action, resourceType, resourceId, previousValueEncrypted, newValueEncrypted, ipAddress, userAgent, sessionId, metadata`. `success` and `errorMessage` are never set, so every row persists with `success = true` (the DB default) and `errorMessage = NULL`.
- **Impact:** A compliance query like `SELECT * FROM audit_logs WHERE success = false` returns zero rows even though failed logins, lockouts, and denied provider/admin access attempts occurred. The fail/success signal lives only inside the free-form `metadata` JSON (`reason`, `authAction`, `operation: '*_FAILED'`), which is not indexed and not the column an auditor or SIEM will filter on. This weakens HIPAA failed-access reporting (the checklist's "An audit entry is created even when the action fails" is met, but the row is mislabeled as successful).
- **Fix:** In `log()`, add `success: entry.success ?? true` and `errorMessage: entry.errorMessage` to the `data` object, add `success?`/`errorMessage?` to `AuditLogEntry`, and have `logAuth` set `success: false` for `LOGIN_FAILED`/`ACCOUNT_LOCKOUT` and the route denial paths set `success: false` with a reason in `errorMessage`.
- **Evidence:**
  ```ts
  metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
  };
  // no `success:` and no `errorMessage:` keys present in `data`
  ```
  (schema columns that go unwritten — `backend/prisma/schema.prisma:471-472`)
  ```prisma
  success                Boolean     @default(true)
  errorMessage           String?     @map("error_message")
  ```

### F-2 — Audit rows are deletable by any admin-context code path; no FORCE RLS, no append-only mirror — **Medium**
- **Location:** `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:82` and `:528-530`
- **Observation:** `audit_logs` is `ENABLE ROW LEVEL SECURITY` but not `FORCE ROW LEVEL SECURITY`, and the only delete control is `CREATE POLICY audit_logs_delete … USING (is_admin_session())`. Any code that opens `withRLSContext(null, …, { isAdmin: true })` can `deleteMany` on `audit_logs` — not just the retention sweep. The table owner role bypasses RLS entirely because FORCE is absent. There is no append-only mirror or offline backup of audit rows in the migrations (`Grep` for `append-only|mirror|FORCE ROW LEVEL` returns nothing for `audit_logs`).
- **Impact:** Tamper-resistance is weaker than HIPAA §164.312(b) integrity expects. An attacker who reaches an admin session, or anyone with table-owner DB credentials / Prisma Studio, can silently purge or selectively delete audit history with no second copy to detect the deletion (review-protocol Question #4). The immutability claim ("no UPDATE policy") holds for updates but not for targeted deletes.
- **Fix:** Add `ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;`, narrow the delete policy so only the retention path qualifies (e.g. a dedicated `is_retention_session()` GUC rather than the broad `is_admin_session()`), and ship audit rows to an append-only sink (Cloud Logging export bucket with object retention lock, or a separate write-once mirror). Track as defense-in-depth.
- **Evidence:**
  ```sql
  ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;   -- line 82 (ENABLE, not FORCE)
  CREATE POLICY audit_logs_delete ON audit_logs
    FOR DELETE
    USING (is_admin_session());                        -- lines 528-530
  ```

### F-3 — Prompt drift: spec says `fhirController.ts` calls `logAccess`; it does not — **Low**
- **Location:** spec `05-audit-logging.md:23` ("Provider/admin audit calls also live in routes…") and `:91` ("`fhirController.ts` — `logAccess`"); actual code `backend/src/controllers/fhirController.ts` (whole file)
- **Observation:** The spec's coverage step (§6) and §2 attribute the FHIR/Quest audit rows to `fhirController.ts` ("ARE audited via `logAccess` (called by `fhirController.ts`)"). The controller contains **no** audit call — `Grep` for `auditLog|logAccess` in `fhirController.ts` returns nothing. The CONNECT / SYNC / SYNC_FAILED / DISCONNECT audit rows are actually emitted from `backend/src/services/fhir/labSyncService.ts` (`persistConnection` 172-177, sync 343-351, sync-failed 369-374, disconnect 416-420). This is a coverage-diff trap: a naïve §6 diff would flag `fhirController.ts` as a missing-audit Critical, when the audit simply lives one layer down in the service.
- **Impact:** None to runtime (FHIR PHI access IS audited). Risk is auditor confusion / a false-positive Critical from the prescribed two-step diff. Documenting so the next reviewer doesn't file a phantom finding.
- **Fix:** Update the spec to say FHIR audit rows are written by `services/fhir/labSyncService.ts`, not `fhirController.ts`. Add the service file to §6's search scope (the controller-only Glob misses service-layer audits).
- **Evidence:** `backend/src/services/fhir/labSyncService.ts:351`
  ```ts
  await auditService.logAccess(RESOURCE_TYPE, undefined, { userId }, auditMeta);
  ```
  (and `fhirController.ts` has zero `logAccess` matches)

### F-4 — Connect-initiation and callback-failure FHIR paths emit no audit row — **Low**
- **Location:** `backend/src/services/fhir/labSyncService.ts:95-103` (`buildConnectRedirect`) and `backend/src/controllers/fhirController.ts:100-106` (`handleCallback` catch)
- **Observation:** The spec itself (§2) flags these as the real, narrow gaps and the code confirms them. `buildConnectRedirect` builds the OAuth authorize URL and stashes the PKCE verifier but writes no audit row — the start of a lab-PHI linkage is unrecorded. `handleCallback`'s catch logs to the app logger and redirects with `error=connection_failed` but emits no `CONNECT_FAILED` audit row, unlike `SYNC_FAILED` which does (`labSyncService.ts:369`).
- **Impact:** Low. A successful connect IS audited at `persistConnection` (172-177), so the durable linkage is captured; only the initiation attempt and failed-callback attempts are missing. For a HIPAA access trail this is an asymmetry, not a hole — failed connection attempts (e.g. token-exchange failures, replayed/expired state) leave no audit trace.
- **Fix:** Emit `logAccess(RESOURCE_TYPE, undefined, { userId }, { operation: 'CONNECT_INITIATED', provider })` in `buildConnectRedirect`, and a `CONNECT_FAILED` `logAccess` in the `handleCallback` catch (best-effort, mirroring `SYNC_FAILED`). Note: callback runs without a session, so `userId` is only known after `consumeChallenge`; log with `userId: undefined` plus the `state` on failure.
- **Evidence:** `backend/src/controllers/fhirController.ts:100-106`
  ```ts
  } catch (err) {
    logger.error('OAuth callback failed', { … });
    res.redirect(`${frontendBase}${sep}error=connection_failed`);
  }   // no CONNECT_FAILED audit row
  ```

### F-5 — AI-chat audit is written only after the stream completes (best-effort, post-egress) — **Low**
- **Location:** `backend/src/controllers/aiChatController.ts:260` (success) and `:289` (failure)
- **Observation:** PHI is assembled and shipped to Anthropic before the `logAccess` call fires (the success audit is at line 260, inside the post-stream block; the failure audit at 289). `logAccess` is intentionally best-effort (no `failClosed`). If the process is killed or the connection drops between the Anthropic call and line 260, PHI has already left the system with no durable audit row.
- **Impact:** Low and partly by-design (reads are best-effort so an audit hiccup can't deny a chat). But for an *external-egress* PHI path (PHI → Anthropic), an absent audit row understates the disclosure. The `CHAT_BLOCKED_NO_BAA` (130) and `CHAT_FAILED` (289) paths do log, so the only unrecorded window is mid-success-stream process death.
- **Fix:** Consider writing a pre-flight `operation: 'CHAT_INITIATED'` audit row before the Anthropic call (so egress is recorded even if the post-stream write never runs), keeping the post-stream row for token/usage detail. Low priority.
- **Evidence:** `backend/src/controllers/aiChatController.ts:260-262`
  ```ts
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'CHAT',
    externalApiCall: true,
  ```

### F-6 — Prompt drift: AuditLog "current columns" list implies `success`/`errorMessage` are written — **Low**
- **Location:** spec `05-audit-logging.md:48` ("`success` (Boolean, default true) and `errorMessage` (string)")
- **Observation:** §1 lists `success` and `errorMessage` as "current columns" of the model alongside fields the service actually populates, with no note that the service never writes them. They exist in `schema.prisma:471-472` but are dead columns at the application layer (see F-1). A reviewer ticking §1 against the schema would mark them "present" and move on, missing that they are never populated.
- **Impact:** None to runtime; documentation accuracy only. Tie-in to F-1.
- **Fix:** Annotate §1 to note `success`/`errorMessage` exist in the schema but are not currently written by `AuditLogService.log()` (cross-reference F-1), so the next reviewer treats them as a gap rather than a satisfied field.
- **Evidence:** `backend/src/services/auditLog.ts:254` (last key in `data` is `metadata`; no `success`)
  ```ts
  metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
  };
  ```

## Checks passed

### 1. AuditLog Model (schema.prisma)
- [x] Required fields present (`id` UUID `gen_random_uuid()`, `userId` `@db.Uuid` nullable, `actorType`, `action`, `resourceType` `@db.VarChar(100)`, `resourceId` `@db.Uuid` nullable, `previousValueEncrypted`/`newValueEncrypted`, `ipAddress` `@db.VarChar(45)`, `userAgent`, `sessionId` `@db.VarChar(100)`, `metadata` String, `createdAt` `@db.Timestamptz(6)`) — verified at `backend/prisma/schema.prisma:459-473`. (`success`/`errorMessage` exist but unwritten — see F-1/F-6.)
- [x] No `updatedAt` field (immutable records) — verified absent across `AuditLog` model `backend/prisma/schema.prisma:458-485`.
- [x] Retention/query indexes on `createdAt` asc, `createdAt` desc, and `(userId, createdAt desc)` — verified at `backend/prisma/schema.prisma:480-483`.
- [x] `ActorType` enum = USER, SYSTEM, API, ADMIN, ANONYMOUS — verified at `backend/prisma/schema.prisma:581-587`.
- [x] `AuditAction` enum full set incl. PHI_ACCESS/VIEW/PERMISSION_CHANGE/SETTINGS_CHANGE/KEY_ROTATION — verified at `backend/prisma/schema.prisma:589-608`. (Spec NOTE confirmed: service only persists LOGIN/LOGOUT/READ/CREATE/UPDATE/DELETE/EXPORT in `action`; finer types go in `metadata.operation` — `auditLog.ts:419-425`.)

### 2. Actions Being Logged
- [x] Authentication events via `logAuth` — LOGIN/LOGIN_FAILED/LOGOUT/REGISTER/PASSWORD_CHANGE/PASSWORD_RESET_*/EMAIL_VERIFICATION/EMAIL_CHANGE_*/ACCOUNT_LOCKOUT all emitted — verified at `backend/src/controllers/authController.ts:212,236,276,295,321,330,351,442,475,569,650,667,746,791,808,853,871,907,923`.
- [x] `logAuth` maps non-LOGIN/LOGOUT/REGISTER to `UPDATE`, specific event in `metadata.authAction` — verified at `backend/src/services/auditLog.ts:419-433`.
- [x] Biomarker read/create/update/delete audited — verified (9 audit calls) at `backend/src/controllers/biomarkerController.ts`.
- [x] File upload/download/delete audited — verified at `backend/src/controllers/fileController.ts:99,177,232,312`; lab + SBC uploads at `upload/labUploadController.ts:55,141,213,305` and `upload/sbcUploadController.ts:53,165,256,307`.
- [x] Insurance / health-goal / health-need / expense access+CRUD audited — verified (7/8/9/12 audit calls respectively) at `insuranceController.ts`, `healthGoalsController.ts`, `healthNeedsController.ts`, `expenseController.ts`.
- [x] FHIR lab sync CONNECT/SYNC/SYNC_FAILED/DISCONNECT audited — verified at `backend/src/services/fhir/labSyncService.ts:173,351,369,416` (not the controller — see F-3).
- [x] Cross-user provider→patient access (biomarkers, health needs, detail, relationship) audited incl. denied attempts — verified at `backend/src/routes/providerRoutes.ts:117,192,202,347,357,367,397,474,484,495,504,540,614,624,635,644,671,721,730,740,752`.
- [x] Consent grant/deny/revoke + permission changes audited — verified at `backend/src/routes/patientRoutes.ts:92,163,215,237,302,352,366,393,440,449,503,512`.
- [x] Admin user mgmt (list/detail/create/update/deactivate/delete/plan) + admin audit-log viewing audited — verified at `backend/src/routes/adminRoutes.ts:96,170,180,242,335,350,396,415,425,482,498,510,520,609,621,915`.
- [x] AI feature PHI paths audited: biomarker AI guidance at `backend/src/routes/biomarkerRoutes.ts:141,174,266`; AI health-guide chat at `backend/src/controllers/aiChatController.ts:130,260,289` (see F-5 for timing caveat).
- [x] DNA/Genetics audit path correctly absent (dropped in `20260423_drop_dna_genetics`) — no DNA audit code in controllers/services.

### 3. IP Address Handling
- [x] `getClientIp()` uses `req.ip` (falls back to socket addr), not manual X-Forwarded-For parsing — verified at `backend/src/services/auditLog.ts:177-179`.
- [x] Trust proxy configured to 1 hop (Cloud Run LB) — verified at `backend/src/app.ts:120` `app.set('trust proxy', 1)`.

### 4. Sensitive Data in Logs
- [x] PHI before/after values encrypted via `encryptValue()` → `encryptionService.encrypt(…, systemSalt)` before storage — verified at `backend/src/services/auditLog.ts:214-220,240-241`.
- [x] No plaintext passwords / card numbers in audit metadata — auth audits carry only `email`/`reason`/`role`/`outcome` (`authController.ts:213,277,322`); email is explicitly non-PHI per `_phi-inventory.md:100`. No name/DOB/health-value passed into metadata.
- [x] `log()` error path redacts `previousValue`/`newValue` to `[REDACTED]` before app-logging the failed entry — verified at `backend/src/services/auditLog.ts:284-287`.

### 5. Log Integrity
- [x] No UPDATE operations on audit_logs anywhere — only two `auditLog.create` and one `deleteMany`; `Grep` for `auditLog.update` returns no production hits — verified at `backend/src/services/auditLog.ts:264,272,542`.
- [x] DB enforces immutability: no UPDATE policy on `audit_logs` (updates denied) — verified at `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:524-525`.
- [x] DELETE only via retention `cleanupOldLogs()` deleteMany older than `RETENTION_DAYS = 2555` — verified at `backend/src/services/auditLog.ts:10,531-548`. (Delete-policy breadth noted in F-2.)
- [x] Timestamps server-generated (`createdAt @default(now())`), not client-provided — verified at `backend/prisma/schema.prisma:473`; service never sets `createdAt`.
- [x] `failClosed: true` set for create/update/delete/export → re-throws `InternalServerError` on audit-write failure — verified at `backend/src/services/auditLog.ts:294-298,345,370,393,459`.
- [x] Encryption failure re-throws (no fabricated `[ENCRYPTION_FAILED]` ciphertext, #28) — verified at `backend/src/services/auditLog.ts:221-231`.

### 5a. Retention Scheduler & Internal Cleanup Endpoint
- [x] In-process daily scheduler via `setInterval` every 24h — verified at `backend/src/services/auditLog.ts:601-610`; started at `backend/src/app.ts:345`.
- [x] Token path disables the in-process interval (exactly one path active) — verified at `backend/src/services/auditLog.ts:587-592` (early-return when `config.scheduler.auditCleanupToken` set).
- [x] Cleanup endpoint authed only by `X-Cleanup-Token` via `timingSafeEqual`, 404 when token unset, 401 on mismatch — verified at `backend/src/routes/internalRoutes.ts:27-33,45-62`.
- [x] Endpoint CSRF-exempt and NOT behind session JWT — CSRF exempt at `backend/src/middleware/csrf.ts:139-142`; mounted app-level outside the JWT-gated router tree at `backend/src/app.ts:269`.

### 6. Coverage Verification (two-step diff)
- [x] Glob of `backend/src/controllers/**/*.ts` vs Grep `auditLog` → every non-test PHI controller present: aiChat, auth, biomarker, expense, file, healthGoals, healthNeeds, insurance, settings, upload/lab, upload/sbc. Only `fhirController.ts` lacks an in-file audit call, and that is a false positive — FHIR audits live in `services/fhir/labSyncService.ts` (F-3). No genuine missing-audit Critical.

### 7. Audit Log ≠ Application Log
- [x] Audit rows persist to PostgreSQL `audit_logs` table (`@@map("audit_logs")`) — verified at `backend/prisma/schema.prisma:484`.
- [x] Failed actions create audit rows (LOGIN_FAILED, ACCOUNT_LOCKOUT, denied provider/admin access) — verified at `authController.ts:276,295,321,330` and `providerRoutes.ts:192,347,357` (though mislabeled `success=true`, see F-1).

### PHI inventory cross-checks
- [x] AuditLog uses the system salt `config.auditSalt` (from `AUDIT_LOG_SALT`), not per-user salt, so rows stay readable after account deletion (7-year retention) — verified at `backend/src/services/auditLog.ts:148,214-220`.
- [x] `AUDIT_LOG_SALT` length-validated (≥16) and hard-fails boot if missing — verified at `backend/src/config/index.ts:284-293`.
- [x] Audit service `initialize()` invoked at startup before any PHI flow — verified at `backend/src/services/database.ts:185-186`.

## Unverifiable
- **Whether exactly one retention path is wired per environment at runtime (review-protocol Q3).** The code makes the paths mutually exclusive (`auditLog.ts:587`), but whether `AUDIT_CLEANUP_TOKEN` is actually set in the prod Cloud Run env (and the Cloud Scheduler job provisioned) cannot be confirmed from the repo — it depends on deploy-time secrets not present here.
- **Whether `AUDIT_CLEANUP_TOKEN` is rotated and stored only as a managed secret (review-protocol Q7).** Confirmed read from `process.env` (`config/index.ts:136`) with no hardcoded fallback; rotation cadence and secret-manager storage are operational and not visible in code.
- **Actual Cloud Run / LB hop count vs `trust proxy = 1` (review-protocol Q2).** Code sets 1 hop with a documented rationale (`app.ts:113-120`); whether the live topology has exactly one trusted proxy in front (so X-Forwarded-For can't be spoofed) is a deployment fact, not verifiable from source.

## Out of scope
- **Application (non-audit) logging / `logger.ts` PHI redaction** — explicitly deferred to `31-logging-observability.md` per the spec header.
- **Full SMART-on-FHIR OAuth / SSRF / token-encryption review** — deferred to `41-fhir-lab-integration` and `09-external-apis`; this review covered only the FHIR *audit-parity* slice.
- **`FORCE ROW LEVEL SECURITY` / NOBYPASSRLS app-role posture in general** — the broad RLS hardening topic belongs to the RLS-specific spec; F-2 covers only the audit-table tamper/immutability slice (review-protocol Q4).
- **PHI encryption-service internals (`encryption.ts` algorithm, key derivation)** — deferred to `02-encryption.md`; this review only confirmed audit values pass through `encrypt()`.
