# Audit Logging Security Review (HIPAA Required)

**Date**: 2026-02-06
**Auditor**: Automated Security Audit (Claude)
**Scope**: OwnMyHealth audit logging system -- service, schema, and controller coverage
**Priority**: 1 (Critical)
**Tags**: security, hipaa

---

## Files Reviewed

| File | Path |
|------|------|
| Audit Service | `backend/src/services/auditLog.ts` |
| Schema | `backend/prisma/schema.prisma` (AuditLog model, lines 498-525) |
| Auth Controller | `backend/src/controllers/authController.ts` |
| Biomarker Controller | `backend/src/controllers/biomarkerController.ts` |
| Expense Controller | `backend/src/controllers/expenseController.ts` |
| File Controller | `backend/src/controllers/fileController.ts` |
| Health Goals Controller | `backend/src/controllers/healthGoalsController.ts` |
| Health Needs Controller | `backend/src/controllers/healthNeedsController.ts` |
| Insurance Controller | `backend/src/controllers/insuranceController.ts` |
| Settings Controller | `backend/src/controllers/settingsController.ts` |
| Upload Controller | `backend/src/controllers/uploadController.ts` |
| Provider Routes | `backend/src/routes/providerRoutes.ts` |
| Patient Routes | `backend/src/routes/patientRoutes.ts` |
| Admin Routes | `backend/src/routes/adminRoutes.ts` |
| Biomarker Routes | `backend/src/routes/biomarkerRoutes.ts` (AI guidance endpoint) |
| App Config | `backend/src/app.ts` (trust proxy config) |

---

## Architecture Summary

- **Singleton Service**: `getAuditLogService(prisma)` -- `backend/src/services/auditLog.ts:473-478`
- **Retention**: 2555 days (~7 years) -- `backend/src/services/auditLog.ts:7`
- **Encryption**: PHI values encrypted with system salt via AES-256-GCM before storage -- `backend/src/services/auditLog.ts:169-180`
- **Immutability**: Only `create` and `findMany` operations on audit logs; `deleteMany` restricted to retention cleanup -- `backend/src/services/auditLog.ts:450-467`
- **Cleanup Scheduler**: Runs daily via `setInterval` -- `backend/src/services/auditLog.ts:490-510`

---

## Checklist Results

### 1. AuditLog Model (schema.prisma)

**[x] PASS** -- Required fields present:

| Field | Schema Definition | Status |
|-------|-------------------|--------|
| `id` (UUID) | `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` (line 499) | Present |
| `userId` (optional) | `String? @map("user_id") @db.Uuid` (line 500) | Present, nullable for anonymous |
| `actorType` | `ActorType @map("actor_type")` (line 501) | Present -- enum: USER, SYSTEM, API, ADMIN, ANONYMOUS |
| `action` | `AuditAction` (line 505) | Present -- enum covers LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGE, PASSWORD_RESET, READ, VIEW, EXPORT, PRINT, CREATE, UPDATE, DELETE, PHI_ACCESS, PHI_EXPORT, PHI_DECRYPT, PERMISSION_CHANGE, SETTINGS_CHANGE, KEY_ROTATION |
| `resourceType` | `String @map("resource_type") @db.VarChar(100)` (line 506) | Present |
| `resourceId` (optional) | `String? @map("resource_id") @db.Uuid` (line 507) | Present, nullable |
| `ipAddress` | `String? @map("ip_address") @db.VarChar(45)` (line 502) | Present |
| `userAgent` | `String? @map("user_agent")` (line 503) | Present |
| `metadata` (JSON) | `String?` (line 510) | Present -- stored as stringified JSON |
| `createdAt` | `DateTime @default(now()) @map("created_at") @db.Timestamptz(6)` (line 513) | Present, server-generated |

Additional fields present:
- `sessionId` -- `String? @map("session_id") @db.VarChar(100)` (line 504)
- `previousValueEncrypted` -- `String? @map("previous_value_encrypted")` (line 508)
- `newValueEncrypted` -- `String? @map("new_value_encrypted")` (line 509)
- `success` -- `Boolean @default(true)` (line 511)
- `errorMessage` -- `String? @map("error_message")` (line 512)

**[x] PASS** -- No `updatedAt` field present on the AuditLog model. Records are immutable.

---

### 2. Actions Being Logged

#### [x] PASS -- Authentication events:

| Event | Logged? | Location |
|-------|---------|----------|
| Login success | Yes | `authController.ts:311` -- `logAuth('LOGIN', ...)` |
| Login failure | Yes | `authController.ts:231,272,293` -- `logAuth('LOGIN_FAILED', ...)` with reason codes |
| Logout (single) | Yes | `authController.ts:387` -- `logAuth('LOGOUT', ...)` |
| Logout (all sessions) | Yes | `authController.ts:420` -- `logAuth('LOGOUT', { authAction: 'LOGOUT_ALL_DEVICES' })` |
| Token refresh | **No** | `authController.ts:329-364` -- `refreshToken()` has no audit log call |
| Password change | Yes | `authController.ts:513` -- `logAuth('PASSWORD_CHANGE', ...)` |
| Password reset request | Yes | `authController.ts:690` -- `logAuth('PASSWORD_RESET_REQUEST', ...)` |
| Password reset complete | Yes | `authController.ts:735,752` -- `logAuth('PASSWORD_RESET_COMPLETE', ...)` for both success/failure |
| Email verification | Yes | `authController.ts:594,611` -- `logAuth('EMAIL_VERIFICATION', ...)` for both success/failure |
| Account lockout | Yes | `authController.ts:250` -- `logAuth('ACCOUNT_LOCKOUT', ...)` |
| Registration | Yes | `authController.ts:189` -- `logAuth('REGISTER', ...)` |

**FINDING**: Token refresh events are NOT audit logged. This is a gap -- refresh token usage should be tracked for session monitoring and replay attack detection. Severity: **Medium**.

#### [x] PASS -- PHI access events (with gaps noted below):

| Resource | Read | Create | Update | Delete |
|----------|------|--------|--------|--------|
| Biomarker | Yes (list: line 154, single: line 208, summary: line 716, history: line 818) | Yes (single: line 264, bulk: line 596) | Yes (line 350) | Yes (line 387) |
| File (UserFile) | Yes (list: line 83, single: line 158) | N/A (created by upload) | N/A | Yes (line 240) |
| File download | Yes (line 195 -- `logExport`) | N/A | N/A | N/A |
| Insurance Plan | Yes (list: line 448, single: line 485, compare: line 750, search: line 846) | Yes (line 579) | Yes (line 672) | Yes (line 709) |
| Health Goal | Yes (list: line 195, single: line 236, summary: line 630, suggestions: line 719) | Yes (line 337) | Yes (goal: line 406, progress: line 507) | Yes (line 555) |
| Health Need | Yes (list: line 112, single: line 148, analysis: line 397, summary: line 465) | Yes (single: line 187, bulk: line 521) | Yes (update: line 240, status: line 294) | Yes (line 328) |
| Expense Projection | **No READ** | Yes (line 67) | Yes (line 155) | Yes (line 188) |
| Expense Actual | Not implemented in controller | Not implemented | Not implemented | Not implemented |
| Cost Analysis | **No READ** | Yes (line 332) | N/A | N/A |
| Current Spending | N/A | N/A | Yes (line 228) | N/A |

**FINDING**: `getProjections()` (expenseController.ts:91-121) reads expense projection PHI data but has **no audit log call**. Severity: **High** -- PHI read without audit trail violates HIPAA.

**FINDING**: `getAnalyses()` (expenseController.ts:356-391) reads cost analysis PHI data but has **no audit log call**. Severity: **High** -- PHI read without audit trail.

**FINDING**: `getCategories()` (biomarkerController.ts:405-427) reads biomarker category data without audit logging. Severity: **Low** -- category names alone are not PHI, but could reveal health conditions.

#### [ ] FAIL -- Cross-user access events:

| Event | Logged? | Location |
|-------|---------|----------|
| Provider access to patient biomarkers | **No** | `providerRoutes.ts:251-288` -- no audit log |
| Provider access to patient health needs | **No** | `providerRoutes.ts:294-331` -- no audit log |
| Provider access to patient details | **No** | `providerRoutes.ts:178-245` -- no audit log |
| Provider request patient access | **No** | `providerRoutes.ts:92-172` -- no audit log |
| Provider remove relationship | **No** | `providerRoutes.ts:337-368` -- no audit log |
| Consent grant (patient approve) | **No** | `patientRoutes.ts:144-201` -- no audit log |
| Consent deny | **No** | `patientRoutes.ts:207-235` -- no audit log |
| Consent revoke | **No** | `patientRoutes.ts:286-317` -- no audit log |
| Permission changes | **No** | `patientRoutes.ts:241-280` -- no audit log |
| Patient list providers | **No** | `patientRoutes.ts:29-84` -- no audit log |
| Patient view pending requests | **No** | `patientRoutes.ts:90-138` -- no audit log |

**FINDING**: **CRITICAL** -- The entire `providerRoutes.ts` and `patientRoutes.ts` have **zero audit logging**. Neither file imports `getAuditLogService`. This means:
1. Provider access to patient PHI (biomarkers, health needs) goes completely unrecorded
2. Consent grant/deny/revoke events are not tracked
3. Permission changes on relationships are invisible to audit

This is a **HIPAA violation** -- cross-user PHI access MUST be logged, and consent management is a core audit requirement.

#### [ ] FAIL -- Administrative events:

| Event | Logged? | Location |
|-------|---------|----------|
| Admin create user | **No** | `adminRoutes.ts:150-190` -- no audit log |
| Admin update user | **No** | `adminRoutes.ts:196-243` -- no audit log |
| Admin deactivate user | **No** | `adminRoutes.ts:249-282` -- no audit log |
| Admin delete user | **No** | `adminRoutes.ts:289-323` -- no audit log |
| Admin role changes | **No** | Part of user update, not logged |
| Admin view audit logs | **No** | `adminRoutes.ts:458-513` -- no audit log |
| Admin view system stats | **No** | `adminRoutes.ts:396-448` -- no audit log |
| Admin list users | **No** | `adminRoutes.ts:36-97` -- no audit log |
| Admin manage provider relationships | **No** | `adminRoutes.ts:333-386` -- no audit log |

**FINDING**: **CRITICAL** -- The entire `adminRoutes.ts` has **zero audit logging**. The file does not import `getAuditLogService`. Administrative actions are among the highest-risk operations and MUST be logged:
1. User creation/modification/deletion by admins is untracked
2. Role changes (e.g., elevating a user to ADMIN) are invisible
3. Admin viewing of audit logs is not itself audited (who watches the watchers?)
4. Provider relationship management by admins is untracked

#### [~] PARTIAL -- Data lifecycle events:

| Event | Logged? | Location |
|-------|---------|----------|
| Data export | Yes | `settingsController.ts:192` -- `logAccess('UserData', ...)` with operation 'EXPORT' |
| Health data deletion | Yes | `settingsController.ts:239` -- `logDelete('UserData', ...)` |
| Account deletion | Yes | `settingsController.ts:290` -- `logDelete('User', ...)` |
| Settings changes | **No** | No settings change tracking beyond password |

**FINDING**: Data export uses `logAccess` instead of the dedicated `logExport` method, which was specifically designed for HIPAA PHI_EXPORT tracking. The `logExport` method (auditLog.ts:367-389) sets `action: 'EXPORT'` and captures resource IDs and format, but `settingsController` uses `logAccess` which sets `action: 'READ'`. This means full data exports are classified as reads rather than exports. Severity: **Medium**.

#### [ ] FAIL -- AI feature usage:

| Event | Logged? | Location |
|-------|---------|----------|
| Biomarker AI guidance | **No** | `biomarkerRoutes.ts:102-190` -- no audit log |
| Cost analysis generation | Yes | `expenseController.ts:332-336` -- logged as CREATE on cost_analysis |
| SBC extraction via Claude | Yes | `uploadController.ts:767-780` -- logged as CREATE on SBCUpload |

**FINDING**: The biomarker AI guidance endpoint (`POST /:id/guidance` in biomarkerRoutes.ts:102-190) sends decrypted biomarker PHI values to the Anthropic API with **no audit logging**. The endpoint receives the biomarker value, unit, normal range, and history in the request body and sends it to an external AI service. This is a PHI disclosure event that MUST be logged. Severity: **High**.

---

### 3. IP Address Handling

**[~] PARTIAL** -- IP address handling is inconsistent:

**Audit Service (CORRECT)**: `auditLog.ts:162-164`
```typescript
private getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
}
```
Uses `req.ip` which correctly respects the `trust proxy` setting.

**Auth Controller (INCORRECT)**: `authController.ts:59-65`
```typescript
function getSessionMetadata(req: Request): SessionMetadata {
    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress = typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : req.socket.remoteAddress || req.ip;
    ...
}
```
This manually parses `X-Forwarded-For` headers, bypassing Express's `trust proxy` mechanism. This is **spoofable** -- a malicious client can inject a fake `X-Forwarded-For` header to disguise their IP address. While `trust proxy` is configured (`app.ts:89`), the auth controller does not use `req.ip` for session metadata.

**FINDING**: The `getSessionMetadata()` function in `authController.ts:59-65` manually parses `X-Forwarded-For` headers instead of using `req.ip`. This creates two problems:
1. The IP stored in the **Session** table (via `getSessionMetadata`) can be spoofed
2. The IP stored in the **AuditLog** table (via `getClientIp`) is correct (uses `req.ip`)
3. These IPs may differ for the same request, creating forensic inconsistency

Severity: **Medium** -- affects session records but not audit logs directly.

**[x] PASS** -- Trust proxy configured: `app.ts:89` -- `app.set('trust proxy', 1)`

**[~] PARTIAL** -- IP not spoofable via headers: Audit logs use `req.ip` (safe), but session metadata in authController uses raw `X-Forwarded-For` (spoofable).

---

### 4. Sensitive Data in Logs

**[x] PASS** -- PHI values encrypted before logging:
- `auditLog.ts:194-195` -- `previousValueEncrypted` and `newValueEncrypted` are encrypted via `encryptValue()`
- `auditLog.ts:169-180` -- `encryptValue()` uses system salt with `encryptionService.encrypt()`
- The system salt is validated at startup to be at least 16 characters (`auditLog.ts:127-132`)

**[x] PASS** -- No plaintext passwords in logs:
- Auth controller logs email and metadata but never logs password values
- When audit log creation fails, sensitive values are redacted: `previousValue: '[REDACTED]', newValue: '[REDACTED]'` (`auditLog.ts:210-211`)

**[x] PASS** -- No full credit card numbers: Not applicable (no payment processing in the system).

**[x] PASS** -- API keys redacted: API keys are loaded from environment variables and never written to audit logs.

**FINDING (minor)**: `insuranceController.ts:227,236` uses `console.error` instead of the structured logger when decryption fails:
```typescript
console.error(`[Insurance] Failed to decrypt memberId for plan ${plan.id}:`, error);
console.error(`[Insurance] Failed to decrypt groupId for plan ${plan.id}:`, error);
```
While these do not log PHI values directly, `console.error` bypasses the structured logger and could expose error stack traces containing sensitive information in unstructured log destinations. Severity: **Low**.

---

### 5. Log Integrity

**[x] PASS** -- No UPDATE operations on audit_logs table:
- The `AuditLogService` only uses `prisma.auditLog.create()` (line 187) and `prisma.auditLog.findMany()` (line 434)
- No `.update()` or `.updateMany()` calls on `auditLog` exist
- The admin audit log viewer (adminRoutes.ts:458-513) only reads logs, never modifies them

**[x] PASS** -- No DELETE except retention policy:
- The only `deleteMany` call is in `cleanupOldLogs()` (line 454) which filters by `createdAt < cutoffDate`
- Retention cleanup itself is logged as a system event (`auditLog.ts:460-464`)

**[x] PASS** -- Timestamps are server-generated:
- `createdAt` uses `@default(now())` in the schema (line 513)
- The `log()` method does not accept or pass a `createdAt` field -- it is always DB-generated
- No client-provided timestamps are used for audit log creation

**NOTE**: Log integrity is enforced at the application layer only. There are no database-level constraints preventing direct SQL `UPDATE` or `DELETE` on the `audit_logs` table. Consider adding PostgreSQL triggers or using an append-only pattern at the database level for defense-in-depth.

---

### 6. Coverage Verification

Controllers **with** audit logging:
- `authController.ts` -- Yes (full auth event coverage)
- `biomarkerController.ts` -- Yes (CRUD + list/summary/history)
- `expenseController.ts` -- Partial (create/update/delete yes; reads missing)
- `fileController.ts` -- Yes (CRUD + download)
- `healthGoalsController.ts` -- Yes (CRUD + summary + suggestions)
- `healthNeedsController.ts` -- Yes (CRUD + analysis + summary + bulk create)
- `insuranceController.ts` -- Yes (CRUD + compare + search)
- `settingsController.ts` -- Yes (export + delete data + delete account)
- `uploadController.ts` -- Yes (lab report, SBC, OCR)

Routes/controllers **without** audit logging:
- `providerRoutes.ts` -- **NO audit logging at all** (7 endpoints, all PHI access)
- `patientRoutes.ts` -- **NO audit logging at all** (7 endpoints, all consent management)
- `adminRoutes.ts` -- **NO audit logging at all** (10 endpoints, all admin operations)
- `biomarkerRoutes.ts` (AI guidance endpoint) -- **NO audit logging** (1 endpoint, sends PHI to external API)

---

## Summary of Findings

### Critical (HIPAA Violations)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| C-1 | Provider routes have zero audit logging -- cross-user PHI access untracked | `providerRoutes.ts` (entire file) | Provider access to patient biomarkers and health needs creates no audit trail |
| C-2 | Patient routes have zero audit logging -- consent management untracked | `patientRoutes.ts` (entire file) | Consent grant/deny/revoke and permission changes have no audit trail |
| C-3 | Admin routes have zero audit logging -- administrative actions untracked | `adminRoutes.ts` (entire file) | User create/update/delete, role changes, and audit log access not logged |

### High

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| H-1 | Expense projection reads not audit logged | `expenseController.ts:91-121` (`getProjections`) | PHI read operations without audit trail |
| H-2 | Cost analysis reads not audit logged | `expenseController.ts:356-391` (`getAnalyses`) | PHI read operations without audit trail |
| H-3 | Biomarker AI guidance sends PHI to external API without audit log | `biomarkerRoutes.ts:102-190` | PHI disclosure to third-party API untracked |

### Medium

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| M-1 | Token refresh events not audit logged | `authController.ts:329-364` | Session activity gaps -- cannot detect token replay attacks |
| M-2 | Auth controller IP handling bypasses trust proxy | `authController.ts:59-65` | Session records may contain spoofed IP addresses |
| M-3 | Data export uses logAccess instead of logExport | `settingsController.ts:192` | Full PHI exports classified as reads, not exports |

### Low

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| L-1 | console.error used instead of structured logger | `insuranceController.ts:227,236` | Error details may leak to unstructured log destinations |
| L-2 | Biomarker categories endpoint not audit logged | `biomarkerController.ts:405-427` | Category names could reveal health conditions |
| L-3 | No database-level immutability enforcement | Schema/DB level | Direct SQL could modify/delete audit logs |

---

## Questions Answered

### 1. Are all PHI access events being logged?

**No.** The following PHI access events lack audit logging:
- All provider access to patient data (providerRoutes.ts)
- Expense projection reads (expenseController.ts:getProjections)
- Cost analysis reads (expenseController.ts:getAnalyses)
- Biomarker AI guidance requests that send PHI to Anthropic API (biomarkerRoutes.ts)

### 2. Is the IP address source secure (req.ip vs headers)?

**Partially.** The audit log service correctly uses `req.ip` (auditLog.ts:163), which respects the `trust proxy` setting configured at `app.ts:89`. However, the auth controller's `getSessionMetadata()` function (authController.ts:59-65) manually parses `X-Forwarded-For` headers, which is spoofable and inconsistent with the audit log IP.

### 3. Are there any console.log statements bypassing the logger?

**Yes.** `insuranceController.ts:227,236` uses `console.error` instead of the structured logger for decryption failure cases. No `console.log` statements were found in the controllers directory, but the `console.error` usage bypasses the structured logging infrastructure.

---

## Remediation Priority

1. **Immediate** (C-1, C-2, C-3): Add audit logging to providerRoutes.ts, patientRoutes.ts, and adminRoutes.ts. These represent the most severe HIPAA compliance gaps.
2. **Next sprint** (H-1, H-2, H-3): Add audit logging to expense reads, cost analysis reads, and the biomarker AI guidance endpoint.
3. **Short-term** (M-1, M-2, M-3): Fix token refresh logging, auth controller IP handling, and data export audit action type.
4. **Backlog** (L-1, L-2, L-3): Replace console.error, add categories audit, evaluate DB-level immutability.
