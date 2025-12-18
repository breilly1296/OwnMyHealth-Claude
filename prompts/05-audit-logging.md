---
tags: [security, hipaa, critical]
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
  - `ipAddress`, `userAgent`, `sessionId`
  - `previousValueEncrypted`, `newValueEncrypted`
  - `metadata` (JSON string)
  - `success`, `errorMessage`
  - `createdAt` (with index)
- [ ] No UPDATE or DELETE cascades

### 2. Event Types Logged
- [ ] **Authentication**: LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGE, PASSWORD_RESET
- [ ] **Data Access**: READ, VIEW
- [ ] **Data Modification**: CREATE, UPDATE, DELETE
- [ ] **PHI Specific**: PHI_ACCESS, PHI_EXPORT, PHI_DECRYPT
- [ ] **Administrative**: PERMISSION_CHANGE, SETTINGS_CHANGE, KEY_ROTATION

### 3. Required Context Captured
- [ ] `extractContext(req)` gets: ipAddress, userAgent, sessionId, userId
- [ ] IP address handles proxies (`x-forwarded-for` header)
- [ ] User agent truncated to 500 characters

### 4. PHI Value Handling
- [ ] Values encrypted before storage with `encryptValue()`
- [ ] System salt stored in `SystemConfig` table
- [ ] `logCreate()` encrypts new values
- [ ] `logUpdate()` encrypts both previous and new values
- [ ] `logDelete()` encrypts previous values

### 5. Logging Methods
Verify these methods exist and are used:
- [ ] `logAccess(resourceType, resourceId, context, metadata)` - for READ operations
- [ ] `logCreate(resourceType, resourceId, newValue, context)` - for CREATE
- [ ] `logUpdate(resourceType, resourceId, previousValue, newValue, context)` - for UPDATE
- [ ] `logDelete(resourceType, resourceId, previousValue, context)` - for DELETE
- [ ] `logAuth(action, context, metadata)` - for auth events
- [ ] `logExport(resourceType, resourceIds, format, context)` - for data exports
- [ ] `logSystem(action, resourceType, details)` - for system events

### 6. Controller Integration
Cross-reference controllers to ensure audit logging:
- [ ] `authController.ts`: login, logout, register, password change
- [ ] `biomarkerController.ts`: all CRUD operations
- [ ] `insuranceController.ts`: all CRUD operations
- [ ] `dnaController.ts`: upload, access
- [ ] `healthNeedsController.ts`: all CRUD
- [ ] `healthGoalsController.ts`: all CRUD
- [ ] `uploadController.ts`: file uploads
- [ ] `adminRoutes.ts`: user management actions

### 7. Retention & Cleanup
- [ ] `RETENTION_DAYS = 2555` (~7 years)
- [ ] `cleanupOldLogs()` method exists
- [ ] `startAuditCleanup()` runs daily
- [ ] Cleanup itself is logged

### 8. Query Capabilities
- [ ] `queryLogs()` supports filtering by:
  - userId, resourceType, resourceId, action
  - startDate, endDate
  - pagination (limit, offset)
- [ ] Results sorted by createdAt DESC

### 9. Error Handling
- [ ] Audit logging failures are logged to console (never silent)
- [ ] Audit failures don't crash the main operation
- [ ] Critical: "CRITICAL: Failed to create audit log entry" message

### 10. Initialization
- [ ] `initialize()` called at startup
- [ ] System salt created if not exists
- [ ] Fatal error if salt is invalid

## Red Flags
- PHI values stored unencrypted in audit logs
- Missing audit calls in PHI-accessing controllers
- Audit logs can be deleted (except retention cleanup)
- No IP address or session tracking
- Silent failures in audit logging
- Retention less than 7 years
