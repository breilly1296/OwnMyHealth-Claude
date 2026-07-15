# Audit Logging Review — 2026-06-16

> Scope: HIPAA audit-trail integrity, coverage, retention, and PHI handling in audit rows.
> Checklist: `prompts/05-audit-logging.md`. Protocol: `prompts/_review-protocol.md`.
> Target: HEAD `fb2cd32` (2026-06-15). Static review only (no DB connection).
> Companion reviews in this run: see the `New Project Documents/security-reviews/` set.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 4 |
| Info | 3 |

The audit subsystem is in strong shape. The service is a single, well-documented singleton; all 12 non-test top-level controllers, both upload sub-controllers, and `providerRoutes`/`adminRoutes` emit audit rows on PHI access (including failure branches); PHI/metadata in audit rows is field-level AES-256-GCM encrypted; retention is now DB-enforced; immutability is enforced by FORCE RLS with no UPDATE policy; and the Cloud Scheduler cleanup endpoint is constant-time-token-gated and CSRF-exempt for the right reason. No Critical/High/Medium audit findings. The four Lows are narrow defense-in-depth / coverage gaps; the three Info items are design observations.

## Findings

### F-1 — OAuth denial / missing-param callback branches return un-audited — **Low**
- **Location:** `backend/src/controllers/fhirController.ts:84-97`
- **Observation:** In `handleCallback`, the two early-return branches — `oauthError` present (user denied / provider error, lines 84-89) and `!code || !state` (missing params, lines 90-97) — redirect back to the frontend with an `?error=` marker but write **no** audit row. Only the post-`handleOAuthCallback` `catch` (lines 108-132) audits a `CONNECT_FAILED`. A user who initiates a Quest lab connection (a `CONNECT_INITIATED` row is written at `services/fhir/labSyncService.ts:104-109`) and then denies consent leaves a dangling initiation with no terminal audit event.
- **Impact:** A failed/denied lab-connection attempt is not durably recorded. HIPAA §164.312(b) favors logging attempted access to PHI-bearing integrations. No PHI is disclosed (the connection never completes), and there is no exploit path — this is an audit-completeness gap, not a vulnerability. The prompt itself acknowledges this as a known narrow caveat (`prompts/05-audit-logging.md:72`).
- **Fix:** In both early-return branches, call `auditService.logAccess('LabConnection', undefined, { userId: undefined }, { operation: 'CONNECT_DENIED' | 'CONNECT_MISSING_PARAMS', success: false, provider: 'quest' })` mirroring the existing `CONNECT_FAILED` block before redirecting. (As with `CONNECT_FAILED`, `userId` is unavailable pre-exchange — accept the unbound user, same as line 118.)
- **Evidence:**
  ```ts
  if (oauthError) {
    const sep = frontendBase.includes('?') ? '&' : '?';
    res.redirect(`${frontendBase}${sep}error=${encodeURIComponent(oauthError)}`);
    return;            // <-- no audit
  }
  ```

### F-2 — Auth state-change events are best-effort, not fail-closed — **Low**
- **Location:** `backend/src/services/auditLog.ts:504-512` (`logAuth`); call sites `backend/src/controllers/authController.ts:641` (`PASSWORD_CHANGE`), `:859/:876` (`PASSWORD_RESET_COMPLETE`), `:991` (`EMAIL_CHANGE_COMPLETE`)
- **Observation:** `logAuth()` never sets `failClosed`, so its underlying `log()` swallows a write failure (auditLog.ts:358-362 only re-throws when `failClosed` is set). For *read* and *login* events this best-effort posture is the documented, correct trade-off (a transient audit hiccup must not deny logins). But it also covers security-state mutations — password change, password-reset completion, email-change completion — which are credential/identity changes whose audit trail is exactly what an incident responder needs. If the audit write fails, these complete silently with no durable record.
- **Impact:** A credential change could succeed while its audit row is lost (e.g. DB hiccup, encryption transient). Defense-in-depth gap, not directly exploitable; an attacker cannot force the audit write to fail on demand. The mutation itself is correctly performed; only the trail is at risk.
- **Fix:** Add an optional `AuditOutcome`-style `failClosed` parameter to `logAuth` (the plumbing already exists for the value-bearing wrappers) and set it `true` for `PASSWORD_CHANGE`, `PASSWORD_RESET_COMPLETE`, and `EMAIL_CHANGE_COMPLETE`. Keep `LOGIN`/`LOGIN_FAILED`/`LOGOUT`/`PASSWORD_RESET_REQUEST` best-effort.
- **Evidence:**
  ```ts
  await this.log({
    userId: context.userId,
    actorType: context.userId ? 'USER' : 'ANONYMOUS',
    action: auditAction,
    resourceType: 'Authentication',
    ...this.contextFields(context),
    metadata: { ...metadata, authAction: action },
  });   // <-- no failClosed, no success/errorMessage passthrough
  ```

### F-3 — `CONNECT_FAILED` audit rows have no user binding — **Low**
- **Location:** `backend/src/controllers/fhirController.ts:116-124`
- **Observation:** The `CONNECT_FAILED` audit is written with `{ userId: undefined }` because the PKCE-bound `userId` is consumed inside `handleOAuthCallback` and only returned on success. A token-exchange failure therefore produces an audit row attributable only by IP/user-agent/timestamp, not by `userId`. This is documented as intentional in the code comment and in the prompt (`prompts/05-audit-logging.md:72`).
- **Impact:** Reduced forensic precision for failed lab-connection attempts — an investigator cannot directly join the failed attempt to a user account from the audit row alone (the `state`/PKCE record would be needed). No confidentiality/integrity impact. Listed separately from F-1 because it is a distinct, accepted limitation of the success-only branch.
- **Fix:** Have `handleOAuthCallback` surface the decoded `userId` (or the PKCE record's userId) even on the failure path — e.g. return it on the thrown error or resolve it before the token exchange — so the catch block can bind the audit row. Low priority; accept-as-is is defensible.
- **Evidence:**
  ```ts
  // userId is unknown here — the PKCE-bound userId is consumed inside
  // handleOAuthCallback and only surfaced on success ...
  await auditService.logAccess('LabConnection', undefined, { userId: undefined }, {
    operation: 'CONNECT_FAILED', ...
  ```

### F-4 — Prompt drift: `AuditAction` enum advertises 18 values; the service writes 7 — **Low**
- **Location:** `backend/prisma/schema.prisma:652-671` (enum) vs `backend/src/services/auditLog.ts:496-502` (`AUTH_ACTION_MAP`) and the `log*` wrappers
- **Observation:** The `AuditAction` enum defines `VIEW`, `PRINT`, `PHI_ACCESS`, `PHI_EXPORT`, `PHI_DECRYPT`, `PERMISSION_CHANGE`, `SETTINGS_CHANGE`, `PASSWORD_RESET`, and `KEY_ROTATION`, but the service only ever persists `LOGIN`/`LOGOUT`/`READ`/`CREATE`/`UPDATE`/`DELETE`/`EXPORT` to the `action` column. Finer event semantics live in `metadata.operation` / `metadata.authAction` instead (e.g. `PHI_ACCESS`, `CHAT_INITIATED`, `SYNC_FAILED`). This is by design and the prompt notes it (`prompts/05-audit-logging.md:53`), but an auditor querying `action = 'PHI_ACCESS'` would get zero rows and wrongly conclude PHI access is unlogged.
- **Impact:** No security impact — an analyst-confusion / maintainability risk only. The enum is misleading as written.
- **Fix:** Either (a) collapse the enum to the values actually written and document `metadata.operation` as the discriminator, or (b) keep the enum and add a schema comment + an `action` index on `metadata.operation` extraction for queryability. Documentation-level change; keep this Low and roll into the quarterly prompt/schema-alignment pass.
- **Evidence:**
  ```ts
  const AUTH_ACTION_MAP: Partial<Record<typeof action, AuditAction>> = {
    LOGIN: 'LOGIN', LOGIN_FAILED: 'LOGIN', LOGOUT: 'LOGOUT', REGISTER: 'CREATE',
  };
  const auditAction: AuditAction = AUTH_ACTION_MAP[action] ?? 'UPDATE';
  ```

### F-5 — Untyped metadata `[key: string]` index relies on developer discipline — **Info**
- **Location:** `backend/src/services/auditLog.ts:35` (`AuditMetadata`), `:57` (`SystemAuditDetails`)
- **Observation:** Both metadata interfaces end with an open index signature (`[key: string]: string | number | boolean | string[] | undefined`), so any field can be attached to an audit row's metadata. There is no allowlist or PHI/secret guard. The blast radius is contained because metadata is now encrypted at rest (`metadataEncrypted`, AES-256-GCM, system salt — auditLog.ts:301) and the admin view decrypts only for ADMIN sessions, so even an accidental PHI/secret in metadata is encrypted. Reviewed call sites already avoid raw secrets (e.g. `PASSWORD_RESET_REQUEST` logs `tokenGenerated: !!result.token`, not the token — authController.ts:814-817; file audits log the non-PHI storage key `file.filename`, not `originalFilename` — fileController.ts:249).
- **Impact:** None observed. Latent risk that a future call site logs a secret/PHI into metadata; encryption-at-rest mitigates the at-rest exposure but not an authorized-admin-view exposure.
- **Fix:** Optional hardening — narrow the metadata type to a closed union, or add a runtime denylist (`/token|secret|password|authorization/i`) before encryption. Not actionable as a finding.
- **Evidence:**
  ```ts
  /** Any additional contextual data */
  [key: string]: string | number | boolean | string[] | undefined;
  ```

### F-6 — Single retention path correctness depends on env wiring, not code — **Info**
- **Location:** `backend/src/services/auditLog.ts:669-700` (`startAuditCleanup`), `backend/src/routes/internalRoutes.ts:40-72`, `backend/src/config/index.ts:195-197`
- **Observation:** Exactly one retention path is active per environment: when `AUDIT_CLEANUP_TOKEN` is set, the in-process 24h `setInterval` is disabled (auditLog.ts:674-679) and retention runs via `POST /api/v1/internal/audit-cleanup`; when unset, the interval runs and the endpoint 404s. This is correct, but if **neither** is effectively active — e.g. `AUDIT_CLEANUP_TOKEN` is set (disabling the interval) but Cloud Scheduler is never provisioned, or a scale-to-zero Cloud Run instance is reaped before the 24h interval fires — retention never runs. Retention failing is fail-safe (logs are *kept*, not lost), and DB-side the `audit_logs_delete` policy independently blocks deletion of <7-year rows, so over-retention is the only outcome. No code defect; an ops-wiring observation the prompt already raises (Q3).
- **Impact:** Possible silent over-retention (logs kept past 7 years) if the token is set without a scheduler. No PHI exposure; arguably safer than under-retention.
- **Fix:** Add a startup assertion or health check that, in production, `AUDIT_CLEANUP_TOKEN` is set AND records the last successful cleanup time; alert if no cleanup has run in >48h. Ops/observability change.
- **Evidence:**
  ```ts
  if (config.scheduler.auditCleanupToken) {
    logger.info('Audit retention cleanup delegated to Cloud Scheduler; in-process interval disabled', ...);
    return;
  }
  ```

### F-7 — Standalone audit writes open a second connection per non-tx call — **Info**
- **Location:** `backend/src/services/auditLog.ts:329-340`
- **Observation:** When no `tx` is threaded, `log()` opens a fresh admin RLS context (`withRLSContext(null, ..., { isAdmin: true })`) to satisfy `audit_logs_insert`'s `is_admin_session()` check. The atomic tx path (#17) avoids the extra pooled connection, but the many `logAccess` call sites in `providerRoutes`/`adminRoutes` and read controllers pass `{ req, userId }` without a `tx`, so each takes a standalone connection. This is correct and intentional (read audits are best-effort and not inside a transaction), and the DB pool sizing accounts for it — noting it only as a performance/connection-pressure observation under burst load, not a defect.
- **Impact:** Under high read concurrency, audit writes add pooled-connection pressure. No correctness or security impact.
- **Fix:** None required. If pool pressure is ever observed, batch or fire-and-forget best-effort read audits. Not a finding.
- **Evidence:**
  ```ts
  await withRLSContext(null, async (tx) => { await tx.auditLog.create({ data }); }, { isAdmin: true });
  ```

## Checks passed

### 1. AuditLog Model (schema.prisma)
- [x] All required columns present (`id` UUID `gen_random_uuid()`, optional `userId @db.Uuid`, `actorType`, `action`, `resourceType @db.VarChar(100)`, optional `resourceId @db.Uuid`, `previousValueEncrypted`/`newValueEncrypted`, `ipAddress @db.VarChar(45)`, `userAgent`, `sessionId @db.VarChar(100)`, `metadataEncrypted`, `success` default true, `errorMessage`, `createdAt @db.Timestamptz(6)`) — verified at `schema.prisma:515-548`.
- [x] No `updatedAt` field (immutable records) — verified absent in `schema.prisma:515-548`.
- [x] Retention/query indexes present: `createdAt` asc + desc and `(userId, createdAt desc)` — verified at `schema.prisma:543-546`.
- [x] Legacy plaintext `metadata` column dropped; only `metadataEncrypted` remains — verified `schema.prisma:533` and `migrations/20260615_drop_legacy_audit_metadata/migration.sql:18`.

### 2. Actions Being Logged
- [x] Authentication events — LOGIN, LOGIN_FAILED (3 branches), ACCOUNT_LOCKOUT (2 branches), LOGOUT (single + all-sessions), REGISTER, PASSWORD_CHANGE, PASSWORD_RESET_REQUEST/COMPLETE, EMAIL_VERIFICATION, EMAIL_CHANGE_REQUEST/COMPLETE — verified at `authController.ts:225,249,289,310,334,347,356,377,493,526,641,722,739,814,859,876,921,939,975,991`.
- [x] PHI read/create/update/delete audited across all domain controllers — biomarker, file, insurance, healthGoals, healthNeeds, expense, settings, aiChat, fhir, labUpload, sbcUpload (audit calls present in all) — verified via Grep `glob: backend/src/controllers/**/*.ts` (21 files match incl. tests; all 12 non-test top-level controllers + both upload sub-controllers present).
- [x] File upload/download/delete audited — `logAccess`/`logExport`/`logDelete` at `fileController.ts:106,188,244,354`.
- [x] FHIR lab sync/disconnect/connect lifecycle audited — `CONNECT_INITIATED`/`CONNECT`/`SYNC`/`SYNC_FAILED`/`DISCONNECT` at `services/fhir/labSyncService.ts:106,183,397,423,470`; `CONNECT_FAILED` at `fhirController.ts:118` (gaps tracked in F-1/F-3).
- [x] Cross-user (provider) access audited including failure branches — `providerRoutes.ts:137,213,223,295,374,384,394,424,468,507,551,581,624,640,690,699,709,721` (patient detail, biomarkers, health-needs, insurance, relationship CRUD, with `success:false` branches).
- [x] Administrative events audited — user list/detail/create/update/status/delete/plan, provider-relationship admin, system stats, audit-log view — `adminRoutes.ts:101,176,186,247,350,371,419,438,448,516,532,544,554,643,655,708,796,809,825,932,1028`.
- [x] Data export audited via `logExport` (action=EXPORT, failClosed) — `settingsController.ts:721-724` (user data export) and `fileController.ts:244` (file download).
- [x] AI PHI paths audited — biomarker AI guidance + AI health-guide chat with pre-flight `CHAT_INITIATED` (`failClosed:true`) before PHI streams to Anthropic — `aiChatController.ts:212-217`.

### 3. IP Address Handling
- [x] Uses `req.ip` (not manual X-Forwarded-For parsing) — `auditLog.ts:208-210` (`getClientIp` returns `req.ip || req.socket.remoteAddress`).
- [x] Trust proxy configured — `app.set('trust proxy', 1)` at `app.ts:120`, hop count 1 matches Cloud Run's single LB hop.
- [x] IP not spoofable via headers — `trust proxy = 1` means Express trusts only the first hop; client-injected XFF beyond hop 1 is ignored (`app.ts:112-120`).

### 4. Sensitive Data in Logs
- [x] PHI values encrypted before logging — `previousValue`/`newValue`/`metadata` all run through `encryptValue()` (AES-256-GCM, system salt) before the row write — `auditLog.ts:299-301`.
- [x] No plaintext passwords in audit metadata — password-reset audit logs `tokenGenerated: !!result.token` boolean, not the token (`authController.ts:814-817`); password verification uses `verifyPassword` and the password is never threaded to audit metadata (`settingsController.ts:784,966`).
- [x] No reset tokens / OAuth tokens in audit metadata — FHIR audits log `provider`/`operation`/`externalApiCall` only (`fhirController.ts:118-124`); OAuth tokens are encrypted into `LabConnection.*Encrypted`, not audited.
- [x] Encryption failure re-throws instead of persisting a counterfeit `[ENCRYPTION_FAILED]` ciphertext (#28) — `auditLog.ts:252-262`.

### 5. Log Integrity
- [x] No UPDATE policy on `audit_logs` (updates denied) — confirmed: only SELECT/INSERT/DELETE policies exist (`migrations/20260107_add_rls_policies/migration.sql:512-530`, comment at :525 "No UPDATE policy means updates are denied").
- [x] FORCE ROW LEVEL SECURITY on `audit_logs` (owner-bypass closure) — `migrations/20260613_force_rls_and_audit_retention/migration.sql:25`.
- [x] `audit_logs_insert` tightened from `WITH CHECK (true)` to `(user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL)` (L40) — `migrations/20260615_provider_consent_immutable_audit_insert_check/migration.sql:69-76`.
- [x] DELETE restricted to retention window — `audit_logs_delete USING (is_admin_session() AND created_at < now() - interval '7 years')` (M19) — `migrations/20260613_force_rls_and_audit_retention/migration.sql:41-44`.
- [x] Timestamps server-generated — the `data` object written in `log()` (auditLog.ts:303-317) omits `createdAt`; it is set by the DB `@default(now())` (`schema.prisma:536`). No client-supplied timestamp path.
- [x] `failClosed` set for all PHI mutations — `logCreate`/`logUpdate`/`logDelete` hardcode `failClosed: true` (auditLog.ts:416,444,470); `logExport` sets `failClosed: true` (auditLog.ts:536). Re-throw on failure at `auditLog.ts:358-362`.

### 5a. Retention Scheduler & Internal Cleanup Endpoint
- [x] In-process daily scheduler runs `cleanupOldLogs()` every 24h via `setInterval` when no token — `auditLog.ts:688-697`.
- [x] Token path disables the interval — `auditLog.ts:674-679`; cleanup driven by `POST /api/v1/internal/audit-cleanup` — `internalRoutes.ts:40-72`. Exactly one path active per env (ops caveat noted in F-6).
- [x] Cleanup endpoint auth: `X-Cleanup-Token` header via constant-time `timingSafeEqual` (`internalRoutes.ts:16,27-33,54-55`); 404 when token unset (`:45-52`), 401 on mismatch (`:55-62`).
- [x] Endpoint CSRF-exempt and not behind session JWT — `'/api/v1/internal/audit-cleanup'` in CSRF exemption list (`middleware/csrf.ts:144`); router carries no `authenticate` middleware (`internalRoutes.ts:40` is the only middleware = `asyncHandler`).

### 6. Coverage Verification (two-step diff)
- [x] Glob `backend/src/controllers/**/*.ts` → all controllers; Grep `auditLog|logAccess|...` → 21 files. Every non-test PHI-touching controller appears in the audit list (authController, biomarkerController, expenseController, fileController, healthGoalsController, healthNeedsController, insuranceController, settingsController, aiChatController, fhirController, upload/labUploadController, upload/sbcUploadController). No PHI controller missing → no Critical coverage gap.

### 7. Audit Log ≠ Application Log
- [x] Audit rows persist to PostgreSQL `audit_logs` (Prisma `tx.auditLog.create`), not Cloud Logging — `auditLog.ts:328,336`.
- [x] Audit entries created on failed actions too — `success:false` failure branches in providerRoutes/adminRoutes/authController (e.g. `providerRoutes.ts:213,699`, `authController.ts:289,347`).

### PHI inventory cross-check
- [x] `AuditLog` encrypted fields `previousValueEncrypted`, `newValueEncrypted`, `metadataEncrypted` match `prompts/_phi-inventory.md:77` and `schema.prisma:525-533`. Audit uses the **system salt** (`config.auditSalt`, auditLog.ts:179,251) not a per-user salt, so rows remain decryptable after account deletion (7-year retention) — verified.
- [x] Admin decrypt path (`decryptMetadata`, `queryLogs`) is ADMIN-gated — `adminRoutes.ts` router-level `requireRole('ADMIN')` at `:32`; raw `metadataEncrypted` stripped before response (`adminRoutes.ts:1029-1032`, `auditLog.ts:600-607`). Pre-2026-06-06 rows surface `null` metadata (decryptMetadata returns null when `metadataEncrypted` is null — `auditLog.ts:287`).

## Unverifiable

- **Runtime: only one retention path actually fires in prod.** Whether `AUDIT_CLEANUP_TOKEN` is set in the prod Cloud Run env and a Cloud Scheduler job is provisioned cannot be confirmed from code (env-only). Code logic is correct; see F-6. Requires `gcloud run services describe` + Scheduler inspection.
- **Runtime: DB policies are actually applied to the live database.** The migration SQL is present and correct, but static review cannot confirm the prod DB has these policies live (would need a live `pg_policies` query). The teardown notes a live-PG-validated RLS test job exists in CI, which is corroborating but out of this review's static scope.
- **`AUDIT_LOG_SALT` is stored only as a secret and rotated.** Config reads it from env (`config/index.ts:113`) and length-validates (≥ `MIN_AUDIT_SALT_LENGTH`, `:358-365`); secret-manager storage and rotation cadence are deployment concerns not visible in code (prompt Q7).
- **`AUDIT_CLEANUP_TOKEN` rotation / leak posture.** Same as above — secret hygiene is an ops control, not statically verifiable.

## Out of scope
- Application (non-audit) logging and PHI redaction in `logger.ts` / `utils/phiRedaction.ts` — reviewed under `prompts/31-logging-observability.md`.
- Full FHIR/Quest OAuth audit-parity deep-dive — owned by `prompts/41-fhir-lab-integration.md` §4; this review only confirms the audit calls exist and notes F-1/F-3.
- Encryption-primitive correctness (AES-GCM IV/auth-tag handling, key derivation) — owned by `prompts/02-encryption.md`. This review assumes `encryption.encrypt/decrypt` is sound and only checks that audit values pass through it.
- RBAC/RLS policy correctness for non-audit tables — owned by the RLS/RBAC reviews. Only `audit_logs` policies were assessed here.
