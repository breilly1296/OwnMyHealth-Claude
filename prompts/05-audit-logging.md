---
tags:
  - security
  - hipaa
  - critical
type: prompt
priority: 1
updated: 2026-04-16
---

# Audit Logging Review (HIPAA Required)

> Follow the [review protocol](./_review-protocol.md).
> For PHI fields stored in audit rows, see [PHI inventory](./_phi-inventory.md) — `AuditLog.previousValueEncrypted` / `newValueEncrypted`.
> Application logs (non-audit) are reviewed separately in [31-logging-observability](./31-logging-observability.md).
> Use [Claude Code tools](./_verification-tools.md).

## Files to Review
- `backend/src/services/auditLog.ts` — `getAuditLogService(prisma)` singleton + retention scheduler
- `backend/prisma/schema.prisma` — `AuditLog` model
- All controllers in `backend/src/controllers/` — every PHI access must produce an audit row

## OwnMyHealth Audit Architecture
- **Singleton Service**: `getAuditLogService(prisma)`
- **Retention**: 7 years (~2555 days) per HIPAA
- **Encryption**: PHI values encrypted with system salt before storage
- **Immutability**: No UPDATE/DELETE operations on audit logs (except retention cleanup)

## Checklist

### 1. AuditLog Model (schema.prisma)
- [ ] Required fields present:
  - `id` (UUID)
  - `userId` (optional - for anonymous actions)
  - `actorType` (USER, SYSTEM, API, ADMIN, ANONYMOUS)
  - `action` (enum: LOGIN, LOGOUT, READ, CREATE, UPDATE, DELETE, EXPORT, etc.)
  - `resourceType` (string)
  - `resourceId` (optional UUID)
  - `ipAddress` (string)
  - `userAgent` (string)
  - `metadata` (JSON - encrypted if contains PHI)
  - `createdAt` (timestamp)
- [ ] No `updatedAt` field (immutable records)

### 2. Actions Being Logged
- [ ] Authentication events:
  - Login success/failure
  - Logout (single and all-sessions)
  - Token refresh
  - Password change/reset
  - Email verification
  - Account lockout triggered
- [ ] PHI access events:
  - Biomarker read/create/update/delete
  - File upload/download/delete
  - DNA data import (if active)
  - Insurance plan access/create/update/delete
  - Health goal access/create/update/delete
  - Health need access/create/update/delete
  - Expense data access/create/update/delete
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
- [ ] AI feature usage:
  - Biomarker AI guidance requests
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
- [ ] No DELETE except retention policy
- [ ] Timestamps are server-generated (not client-provided)

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
2. Is the IP address source secure (`req.ip` with `trust proxy` set, not raw `X-Forwarded-For`)?
3. Is the audit-log retention scheduler running (check `authService.ts` / `auditLog.ts` for `setInterval` or equivalent)? What happens if the server crashes mid-sweep?
4. Can an admin tamper with audit rows via Prisma Studio or direct SQL? If so, is there an offline backup / append-only mirror?
5. If a user is deleted, do their audit rows remain readable (system salt, not per-user salt)?
