---
tags:
  - security
  - authorization
  - medium
type: prompt
priority: 3
updated: 2026-06-01
---

# Admin Panel Security Review

## Files to Review
- `backend/src/routes/adminRoutes.ts` (admin API endpoints — handlers are INLINE here, there is no separate admin controller)
- `backend/src/middleware/rbac.ts` (ADMIN role enforcement: `requireRole`, `requireMinRole`, `ROLE_HIERARCHY`)
- `backend/src/middleware/auth.ts` (authentication for admin routes)
- `backend/src/middleware/demoProtection.ts` (`blockDemoAdminAccess`, `blockDemoRoleChange`, `isDemoAccount`)
- `backend/src/middleware/rateLimiter.ts` (admin endpoints use `sensitiveLimiter`; 8 named limiters total, backed by `rateLimitStore.ts`)
- `backend/src/middleware/validation.ts` (`schemas.admin.*`: createUser, updateUser, listUsersQuery, auditLogQuery, updateUserPlan, permanentDelete)
- `backend/src/services/auditLog.ts` (admin action logging: `logAccess`/`logCreate`/`logUpdate`/`logDelete`)
- `backend/prisma/schema.prisma` (User model + `role`/`isActive`/`plan` fields; `SystemConfig` model; `AuditAction` enum)
- `backend/prisma/migrations/20260424_prevent_self_role_elevation/migration.sql` (DB trigger blocking self-elevation of `role`/`is_active`)
- `src/services/api/admin.ts` (frontend admin API: users, stats, audit-logs, plan, provider-relationships)
- `src/hooks/useRBAC.ts` (admin permission checks: `canManageUsers`, `canViewAuditLogs`, `canAccessAdminPanel`)
- `src/components/admin/AdminPage.tsx` (ADMIN operations console — 4 tabs; lazy-loaded in `Dashboard.tsx`)
- `src/components/common/RoleGuard.tsx` (admin UI gating)

## OwnMyHealth Admin Architecture
- **Role**: ADMIN is highest privilege level (level 3 in `ROLE_HIERARCHY`); there is no super-admin tier
- **Capabilities**: User management (CRUD + soft/permanent delete), plan assignment, provider-relationship management, audit log access, system statistics
- **Access**: Router-level middleware chain enforces it in order — `authenticate` → `blockDemoAdminAccess` → `requireRole('ADMIN')` (see `adminRoutes.ts` `router.use(...)`)
- **DB-level guard**: a `BEFORE UPDATE` trigger (`users_prevent_self_privilege_change` / `enforce_user_privilege_immutability()`) blocks any non-admin session from changing `role` or `is_active`, even via direct row update (migration `20260424_prevent_self_role_elevation`)
- **Frontend**: Admin console (`AdminPage.tsx`) lazy-loaded; nav item gated by `roles: ['ADMIN']` config + `useRBAC().permissions.canAccessAdminPanel`; `RoleGuard` available for component gating
- **Audit**: Every admin action is logged, including read/list operations and the meta-audit of viewing audit logs themselves
- **NOTE**: `SystemConfig` model exists in the schema but is NOT yet wired to any admin route — if config-management endpoints get added, re-run this review against them

## Checklist

### 1. Route Authorization
- [ ] All admin routes require `requireRole('ADMIN')` or `requireMinRole('ADMIN')` middleware
- [ ] Admin routes registered AFTER authentication middleware
- [ ] No admin endpoints accessible without authentication
- [ ] No admin endpoints accessible by PATIENT or PROVIDER roles
- [ ] Admin middleware cannot be bypassed via parameter manipulation

### 2. User Management Security
- [ ] `GET /users`: paginated (limit capped at 100), `select` excludes `passwordHash`/encryption keys; supports role/isActive/search filters
- [ ] `GET /users/:id`: `select` returns no credentials (no passwordHash, no UserEncryptionKey); UUID param validated
- [ ] `POST /users`: validates via `schemas.admin.createUser` (strong password), hashes with `bcrypt`/`config.security.bcryptRounds`, rejects duplicate email inside the transaction
- [ ] `PATCH /users/:id`: role change audit logged as `PERMISSION_CHANGE` with previous/new role; updates run in admin RLS context
- [ ] `PATCH /users/:id`: admin password reset revokes ALL of the target user's sessions in the same transaction (F-41 fix), and `revokedSessionCount` is surfaced in the audit metadata
- [ ] `DELETE /users/:id` (soft delete): sets `isActive=false` AND deletes all the user's sessions atomically
- [ ] `DELETE /users/:id/permanent`: requires `confirmEmail` body matching the target's email (`schemas.admin.permanentDelete`); rate limited via `sensitiveLimiter`; logged as `PERMANENT_DELETE` before deletion
- [ ] `PATCH /users/:id/plan`: plan assignment (FREE/PRO/TEAM) + optional `expiresAt`; logged as `PLAN_CHANGE` with previous/new plan (plan gates features/spend)
- [ ] Admin cannot delete their own account (self-deletion blocked in both `DELETE /users/:id` and `/permanent`)
- [ ] Admin cannot modify their own role (`if (id === adminId && role) throw ForbiddenError` in `PATCH /users/:id`)
- [ ] Role assignment restricted to the `UserRole` enum (PATIENT/PROVIDER/ADMIN) by the Zod schema

### 3. Audit Log Access
- [ ] Admin can view audit logs with filters (date, user, action, resource)
- [ ] Audit log viewing is itself audit logged
- [ ] PHI values in audit logs encrypted (admin sees encrypted values or decrypted with authorization)
- [ ] Audit logs cannot be modified or deleted by admin
- [ ] Pagination enforced on audit log queries (prevent data dumps)
- [ ] Date range filtering prevents unbounded queries

### 4. System Statistics
- [ ] Statistics endpoint returns aggregate data only (counts, totals)
- [ ] No individual user PHI exposed in statistics
- [ ] No PII in statistics responses (no names, emails in counts)
- [ ] Statistics queries optimized (no full table scans)

### 5. Privilege Escalation Prevention
- [ ] No path from PATIENT/PROVIDER to ADMIN without an admin-context DB write
- [ ] Role field in User model not modifiable via non-admin API (settings/profile endpoints must not accept `role`)
- [ ] DB trigger `users_prevent_self_privilege_change` rejects any non-admin session that changes `role` or `is_active` — verify the trigger and `enforce_user_privilege_immutability()` function still exist and the trigger fires `BEFORE UPDATE OF role, is_active` (migration `20260424_prevent_self_role_elevation`)
- [ ] Trigger's admin bypass keys off `is_admin_session()` (i.e. `SET LOCAL app.is_admin = 'true'` via `withRLSContext(null, ..., { isAdmin: true })`) — confirm only admin routes set that context
- [ ] `requireRole('ADMIN')` reads `req.user.role` from the verified JWT on every request (no role caching across requests)
- [ ] Admin password reset invalidates the target's sessions; verify there is also session/token invalidation when an admin changes a user's role (currently only password change wipes sessions in `PATCH /users/:id`)
- [ ] No hidden admin routes discoverable via enumeration (all live under `/api/v1/admin`, mounted in `routes/index.ts`)

### 6. Demo Account Protections
- [ ] `blockDemoAdminAccess` runs BEFORE `requireRole('ADMIN')` in the admin router chain, so a demo account is rejected even if its role were somehow elevated (F-5)
- [ ] `blockDemoRoleChange` blocks demo users from setting any non-PATIENT role
- [ ] `isDemoAccount` returns false when `DEMO_EMAIL` is unset/empty (guards against matching a blank `req.user.email` in production)
- [ ] Demo account restrictions enforced at backend (not just frontend)

### 7. Admin Action Audit Trail
(Every handler uses `getAuditLogService(prisma)` and tags `actorType: 'ADMIN'`; failures are logged too with `success: false` + a `reason`.)
- [ ] User creation logged via `logCreate('admin_user', ...)` with role/isActive/emailVerified
- [ ] User update logged via `logUpdate('admin_user', ...)` with previous/new state and `passwordChanged` flag
- [ ] Role changes logged with `operation: 'PERMISSION_CHANGE'` and `previousRole`/`newRole`
- [ ] Plan changes logged with `operation: 'PLAN_CHANGE'` and `previousPlan`/`newPlan`
- [ ] User deactivation logged (`admin_user_status`, DEACTIVATE); permanent delete logged via `logDelete('admin_user_permanent', ...)` BEFORE the delete
- [ ] User listing and user-detail views logged (`admin_user_list` / `admin_user_detail`) — read access is audited, not just mutations
- [ ] Provider-relationship list/update logged (`admin_provider_relationship`)
- [ ] Audit log access itself logged (`admin_audit_logs`, VIEW — meta-audit "who watches the watchers")
- [ ] System statistics views logged (`admin_system_stats`, VIEW)

### 8. Frontend Admin Security
- [ ] `AdminPage` is lazy-loaded in `Dashboard.tsx` (`lazy(() => import('../admin/AdminPage'))`) so it is not bundled into the main chunk for non-admin users
- [ ] Admin nav item gated by `roles: ['ADMIN']` (see `src/data/sampleData.ts`) AND `useRBAC().permissions.canAccessAdminPanel`
- [ ] Frontend gating is treated as UX-only — every admin route is independently RBAC-checked server-side (AdminPage's own header comment asserts this)
- [ ] `RoleGuard` available for component-level gating where needed
- [ ] Admin API calls (`adminApi` in `src/services/api/admin.ts`) fail gracefully if the server returns 403
- [ ] No admin-only data prefetched for non-admin users

### 9. Rate Limiting
- [ ] Permanent delete (`DELETE /users/:id/permanent`) is rate limited via `sensitiveLimiter` — currently the ONLY admin route with an endpoint-specific limiter
- [ ] Gap to assess: list/stats/audit-log/user-update routes rely only on the global `standardLimiter` (the router does NOT apply a dedicated admin limiter). Consider whether expensive audit-log queries or bulk user operations need `sensitiveLimiter` or `bulkOperationLimiter`
- [ ] Limiters are backed by `rateLimitStore.ts` (Redis via `REDIS_URL`, in-memory fallback) — verify admin limits survive multi-instance Cloud Run scaling

## Verification Commands
```bash
# Find all admin routes and their middleware (handlers are inline in this file)
grep -nE "router\.(get|post|patch|delete)\(" backend/src/routes/adminRoutes.ts

# Check role + demo enforcement applied at the router level
grep -nE "authenticate|blockDemoAdminAccess|requireRole" backend/src/routes/adminRoutes.ts

# Confirm every handler audit-logs (look for getAuditLogService usage per route)
grep -nc "getAuditLogService\|logAccess\|logUpdate\|logDelete\|logCreate" backend/src/routes/adminRoutes.ts

# Verify the DB-level self-elevation guard exists
grep -n "users_prevent_self_privilege_change\|enforce_user_privilege_immutability\|is_admin_session" backend/prisma/migrations/20260424_prevent_self_role_elevation/migration.sql

# Verify demo protection
grep -n "isDemoAccount\|blockDemoAdminAccess\|blockDemoRoleChange" backend/src/middleware/demoProtection.ts

# Check frontend admin gating
grep -n "canAccessAdminPanel\|canManageUsers\|canViewAuditLogs" src/hooks/useRBAC.ts
grep -n "roles:\s*\['ADMIN'\]" src/data/sampleData.ts
grep -n "lazy(() => import('../admin/AdminPage')" src/components/dashboard/Dashboard.tsx
```

## Questions to Ask
1. Can an admin modify or delete audit logs? (There is no audit-log mutation route — `adminRoutes.ts` only exposes `GET /audit-logs`. Confirm no other path lets `AuditLog` rows be edited/deleted, and whether 7-year retention cleanup is admin-triggerable only via `AUDIT_CLEANUP_TOKEN`.)
2. ADMIN is the highest level (`ROLE_HIERARCHY` = 3); confirm no super-admin/system role is being added.
3. How are initial ADMIN accounts created (seed script, manual DB write in admin context, first-user)? The self-elevation trigger means a non-admin session cannot bootstrap one.
4. `SystemConfig` exists in the schema but is unwired — is config management planned for the admin panel? If so it needs its own RBAC + audit + (if `isEncrypted`) PHI handling review.
5. Should a role change (not just a password reset) also force-invalidate the target user's sessions? Today only password resets wipe sessions in `PATCH /users/:id`.
6. Are admin sessions treated differently (shorter expiration, step-up verification)? Is there IP allowlisting for admin access?
