---
tags:
  - security
  - hipaa
  - critical
type: prompt
priority: 1
---

# Audit Logging Review (HIPAA Required)

## Files to Review
- `backend/src/services/auditLog.ts` (primary)
- `backend/prisma/schema.prisma` (AuditLog model)
- All controllers in `backend/src/controllers/` (verify audit calls)

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
Run this to find controllers without audit logging:
```bash
grep -L "auditLog" backend/src/controllers/*.ts
```

## Questions to Ask
1. Are all PHI access events being logged?
2. Is the IP address source secure (req.ip vs headers)?
3. Are there any console.log statements bypassing the logger?
