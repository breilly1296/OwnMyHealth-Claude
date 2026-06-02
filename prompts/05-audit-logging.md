---
tags:
  - security
  - hipaa
  - critical
type: prompt
priority: 1
updated: 2026-06-01
---

# Audit Logging Review (HIPAA Required)

> Follow the [review protocol](./_review-protocol.md).
> For PHI fields stored in audit rows, see [PHI inventory](./_phi-inventory.md) — `AuditLog.previousValueEncrypted` / `newValueEncrypted`.
> Application logs (non-audit) are reviewed separately in [31-logging-observability](./31-logging-observability.md).
> Use [Claude Code tools](./_verification-tools.md).

## Files to Review
- `backend/src/services/auditLog.ts` — `AuditLogService` + `getAuditLogService(prisma)` singleton, `startAuditCleanup`/`stopAuditCleanup` scheduler, `RETENTION_DAYS = 2555`
- `backend/prisma/schema.prisma` — `AuditLog` model (line ~458), `ActorType` enum (~581), `AuditAction` enum (~589)
- `backend/src/routes/internalRoutes.ts` — `POST /api/v1/internal/audit-cleanup`, the Cloud Scheduler retention endpoint gated by `AUDIT_CLEANUP_TOKEN`
- `backend/src/config/index.ts` — `config.scheduler.auditCleanupToken` (~line 136), `config.auditSalt` (AUDIT_LOG_SALT, the salt used to encrypt audit values)
- All controllers in `backend/src/controllers/` (10 controllers + the `upload/` subdir: `labUploadController.ts`, `sbcUploadController.ts`) — every PHI access must produce an audit row. Provider/admin audit calls also live in `routes/providerRoutes.ts` and `routes/adminRoutes.ts`, not just controllers.

## OwnMyHealth Audit Architecture
- **Singleton Service**: `getAuditLogService(prisma)` returning `AuditLogService`. The constructor `prisma` param is now unused at runtime — all DB access goes through `withRLSContext` against the module-level client.
- **Retention**: 7 years (`RETENTION_DAYS = 2555` days) per HIPAA, enforced by `cleanupOldLogs()`.
- **Encryption**: `previousValue`/`newValue` encrypted with the system salt (`config.auditSalt` from `AUDIT_LOG_SALT`, no longer read from `system_config`) before storage.
- **Immutability**: No UPDATE/DELETE operations on audit logs (except retention cleanup).
- **Fail-closed writes**: `log()` re-throws an `InternalServerError` when `failClosed` is set (create/update/delete/export via `logCreate`/`logUpdate`/`logDelete`/`logExport`). Read (`logAccess`) and auth (`logAuth`) audits are best-effort (logged but not fatal). A failed value encryption (#28) re-throws rather than persisting a counterfeit `[ENCRYPTION_FAILED]` ciphertext.
- **Atomic with operation**: when a `tx` (from an enclosing `withRLSContext`/`withRLSTransaction`) is threaded into the entry, the audit row commits/rolls back on the same connection (#17); otherwise it opens a standalone admin context.

## Checklist

### 1. AuditLog Model (schema.prisma)
- [ ] Required fields present (current columns):
  - `id` (UUID, `gen_random_uuid()`)
  - `userId` (optional `@db.Uuid` — null for anonymous/system actions)
  - `actorType` (`ActorType` enum: USER, SYSTEM, API, ADMIN, ANONYMOUS)
  - `action` (`AuditAction` enum — full set: LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGE, PASSWORD_RESET, READ, VIEW, EXPORT, PRINT, CREATE, UPDATE, DELETE, PHI_ACCESS, PHI_EXPORT, PHI_DECRYPT, PERMISSION_CHANGE, SETTINGS_CHANGE, KEY_ROTATION)
  - `resourceType` (string, `@db.VarChar(100)`)
  - `resourceId` (optional `@db.Uuid`)
  - `previousValueEncrypted` / `newValueEncrypted` (encrypted PHI before/after snapshots)
  - `ipAddress` (string, `@db.VarChar(45)`)
  - `userAgent` (string)
  - `sessionId` (string, `@db.VarChar(100)`)
  - `metadata` (String JSON — encrypted only if it carries PHI; most metadata is non-PHI counts/operation tags)
  - `success` (Boolean, default true) and `errorMessage` (string)
  - `createdAt` (`@db.Timestamptz(6)`)
- [ ] No `updatedAt` field (immutable records)
- [ ] Retention/query indexes present on `createdAt` (asc/desc) and `(userId, createdAt desc)`.

> NOTE: although `AuditAction` defines `VIEW`, `PRINT`, `PHI_ACCESS`, `PHI_EXPORT`, `PHI_DECRYPT`, `PERMISSION_CHANGE`, `SETTINGS_CHANGE`, and `KEY_ROTATION`, the service writes only `LOGIN`/`LOGOUT`/`READ`/`CREATE`/`UPDATE`/`DELETE`/`EXPORT` to the `action` column; finer event types (`PHI_ACCESS`, `VIEW`, `PERMISSION_CHANGE`, `SETTINGS_CHANGE`) are recorded in `metadata.operation` instead (see `providerRoutes.ts`, `adminRoutes.ts`, `biomarkerRoutes.ts`). `KEY_ROTATION` is reserved/unused (`userEncryption.ts`). Flag any auditor confusion that these enum values are persisted in `action`.

### 2. Actions Being Logged
- [ ] Authentication events (`logAuth`, see `authController.ts`):
  - Login success/failure (`LOGIN` / `LOGIN_FAILED`)
  - Logout (single and all-sessions)
  - Registration (`REGISTER` → mapped to `CREATE`)
  - Password change / reset request / reset complete
  - Email verification
  - Email change request / complete (`EMAIL_CHANGE_REQUEST` / `EMAIL_CHANGE_COMPLETE`, migration `20260601_add_email_change`)
  - Account lockout triggered
  - NOTE: `logAuth` maps everything except LOGIN/LOGOUT/REGISTER to a generic `UPDATE` action; the specific event lives in `metadata.authAction`.
- [ ] PHI access events:
  - Biomarker read/create/update/delete
  - File upload/download/delete (`fileController.ts`, `upload/labUploadController.ts`, `upload/sbcUploadController.ts`)
  - Insurance plan access/create/update/delete
  - Health goal access/create/update/delete
  - Health need access/create/update/delete
  - Expense data access/create/update/delete
  - Lab connection / FHIR lab sync (Quest SMART-on-FHIR) — sync (`operation: 'SYNC'`/`'SYNC_FAILED'`), disconnect (`operation: 'DISCONNECT'`), AND the successful OAuth connect callback (`operation: 'CONNECT'` written by `persistConnection()` at `services/fhir/labSyncService.ts:172-177`) ARE audited via `logAccess` (called by `fhirController.ts`). The real gaps are narrower: connect **initiation** (`buildConnectRedirect`, `labSyncService.ts:95-103`) emits no audit row, and callback **failures** (`handleCallback` catch, `fhirController.ts:100-106`) have no `CONNECT_FAILED` row analogous to `SYNC_FAILED`. See [[41-fhir-lab-integration]] §4 for the full audit-parity review.
  - NOTE: DNA/Genetics import was REMOVED (DNAVariant/GeneticTrait dropped in migration `20260423_drop_dna_genetics`) — there is no DNA audit path to check anymore.
- [ ] Cross-user access events:
  - Provider access to patient biomarkers
  - Provider access to patient health needs
  - Consent grant/deny/revoke
  - Permission changes on relationships
- [ ] Administrative events:
  - Admin user management (create, update, deactivate, delete)
  - Admin role changes
  - Admin audit log viewing
  - Admin system health checks
- [ ] Data lifecycle events:
  - Data export (PHI_EXPORT)
  - Health data deletion
  - Account deletion
  - Settings changes
- [ ] AI feature usage (now first-class — flag any AI PHI path with no audit row):
  - Biomarker AI guidance requests (`biomarkerRoutes.ts` logs with `metadata.operation = 'PHI_ACCESS'` + `externalApiCall`)
  - AI health-guide chat (`aiChatController.ts` — `logAccess` on the HealthGuide resource, since the prompt context ships PHI to Anthropic)
  - Cost analysis generation
  - SBC extraction via Claude

### 3. IP Address Handling
- [ ] Using `req.ip` (not manual X-Forwarded-For parsing)
- [ ] Trust proxy configured in Express app
- [ ] IP not spoofable via headers

### 4. Sensitive Data in Logs
- [ ] PHI values encrypted before logging
- [ ] No plaintext passwords in logs
- [ ] No full credit card numbers
- [ ] API keys redacted

### 5. Log Integrity
- [ ] No UPDATE operations on audit_logs table
- [ ] No DELETE except retention policy (`cleanupOldLogs()` deleteMany older than `RETENTION_DAYS`)
- [ ] Timestamps are server-generated (not client-provided)
- [ ] `failClosed` set for all PHI mutations so a failed audit write aborts the operation (`logCreate`/`logUpdate`/`logDelete`/`logExport`)
- [ ] Encryption failure on audit values re-throws (no fabricated `[ENCRYPTION_FAILED]` ciphertext, #28)

### 5a. Retention Scheduler & Internal Cleanup Endpoint
- [ ] In-process daily scheduler: `startAuditCleanup(prisma)` runs `cleanupOldLogs()` every 24h via `setInterval`.
- [ ] Cloud Scheduler path: when `AUDIT_CLEANUP_TOKEN` (`config.scheduler.auditCleanupToken`) is set, the in-process interval is DISABLED and retention is driven by `POST /api/v1/internal/audit-cleanup` (#38). Verify exactly one path is active per environment — on scale-to-zero Cloud Run the 24h interval rarely fires, so the token path is required in prod.
- [ ] `internalRoutes.ts` cleanup endpoint: authenticated only by the `X-Cleanup-Token` header via constant-time `timingSafeEqual`; returns 404 when the token is unset (does not reveal the endpoint) and 401 on mismatch. Confirm it is CSRF-exempt and NOT behind the session JWT (Cloud Scheduler can't carry either).

### 6. Coverage Verification
Two-step (replaces `grep -L`):
1. **Glob** `pattern: "backend/src/controllers/*.ts"` → full controller list.
2. **Grep** `pattern: "auditLog"`, `glob: "backend/src/controllers/**/*.ts"`, `output_mode: "files_with_matches"` → controllers with audit calls.
3. Diff the two lists. Every controller that touches PHI but is missing from the second list is a **Critical** finding.

### 7. Audit Log ≠ Application Log
- [ ] Audit log rows live in PostgreSQL `audit_logs` table, not Cloud Logging.
- [ ] Application logs (`logger.ts`) are **not** a HIPAA audit trail — they're redacted & ephemeral. Don't conflate.
- [ ] An audit entry is created even when the action fails (e.g., failed provider access attempts).

## Questions to Ask
1. Are all PHI access events being logged? Cross-check every route under `biomarkerRoutes`, `insuranceRoutes`, `expenseRoutes`, `fileRoutes`, `healthGoalsRoutes`, `healthNeedsRoutes`, `providerRoutes`, `patientRoutes`.
2. Is the IP address source secure? `getClientIp()` uses `req.ip`, which respects `app.set('trust proxy', 1)` in `app.ts` — confirm the hop count matches the actual Cloud Run / LB topology so X-Forwarded-For can't be spoofed.
3. Is exactly one retention path active? In prod, `AUDIT_CLEANUP_TOKEN` should be set (disabling the in-process `setInterval` and enabling `/api/v1/internal/audit-cleanup`); in dev the interval runs. What happens if the server crashes mid-sweep, or if neither path is wired in a given environment?
4. Can an admin tamper with audit rows via Prisma Studio or direct SQL? If so, is there an offline backup / append-only mirror?
5. If a user is deleted, do their audit rows remain readable (system salt `config.auditSalt`, not per-user salt)?
6. Are AI/FHIR PHI paths (`aiChatController.ts`, `fhirController.ts`, biomarker guidance) audited? These ship PHI to external APIs (Anthropic, Quest) and are newer than the rest of the audit coverage.
7. Is the `/api/v1/internal/audit-cleanup` token rotated and stored only as a secret? A leaked `AUDIT_CLEANUP_TOKEN` lets an attacker trigger retention deletion.
