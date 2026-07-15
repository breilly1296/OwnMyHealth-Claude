---
tags:
  - security
  - authorization
  - medium
type: prompt
priority: 3
updated: 2026-06-16
---

# Admin Panel Security Review

## Files to Review
- `backend/src/routes/adminRoutes.ts` (admin API endpoints — handlers are INLINE here, there is no separate admin controller)
- `backend/src/middleware/rbac.ts` (ADMIN role enforcement: `requireRole`, `requireMinRole`, `ROLE_HIERARCHY`)
- `backend/src/middleware/auth.ts` (authentication for admin routes)
- `backend/src/middleware/demoProtection.ts` (`blockDemoAdminAccess`, `blockDemoRoleChange`, `isDemoAccount`)
- `backend/src/middleware/rateLimiter.ts` (admin endpoints use `sensitiveLimiter`; 8 named limiters total, backed by `rateLimitStore.ts`)
- `backend/src/middleware/validation.ts` (`schemas.admin.*`: createUser, updateUser, listUsersQuery, auditLogQuery, updateUserPlan, permanentDelete, and the strict `updateProviderRelationship` schema at `validation.ts:915` — `.strict()`, rejects unknown keys, M-3)
- `backend/src/services/auditLog.ts` (admin action logging: `logAccess`/`logCreate`/`logUpdate`/`logDelete`; writes audit metadata to the encrypted-at-rest `metadataEncrypted` column, `auditLog.ts:301-314`, and exposes `decryptMetadata()` for the authorized admin view, `:268-278` — the legacy plaintext `metadata` column was DROPPED, M6)
- `backend/prisma/schema.prisma` (User model + `role`/`isActive`/`plan` fields; `SystemConfig` model; `AuditAction` enum)
- `backend/prisma/migrations/20260424_prevent_self_role_elevation/migration.sql` (DB trigger blocking self-elevation of `role`/`is_active`)
- `src/services/api/admin.ts` (frontend admin API: users, stats, audit-logs, plan, provider-relationships)
- `src/hooks/useRBAC.ts` (role helpers only: returns `{ role, isAuthenticated, hasRole, hasMinRole, getRoleLabel, getRoleBadgeClasses }` — the old `permissions` capability-flags object incl. `canManageUsers`/`canViewAuditLogs`/`canAccessAdminPanel` was removed as never-consumed dead code, audit L-28; `useRBAC.ts:23-29` documents the removal)
- `src/components/admin/AdminPage.tsx` (ADMIN operations console — 4 tabs; lazy-loaded in `Dashboard.tsx`)
- `src/components/common/RoleGuard.tsx` (admin UI gating)

## OwnMyHealth Admin Architecture
- **Role**: ADMIN is highest privilege level (level 3 in `ROLE_HIERARCHY`); there is no super-admin tier
- **Capabilities**: User management (CRUD + soft/permanent delete), plan assignment, provider-relationship management, audit log access, system statistics
- **Access**: Router-level middleware chain enforces it in order — `authenticate` → `blockDemoAdminAccess` → `requireRole('ADMIN')` (see `adminRoutes.ts` `router.use(...)`)
- **DB-level guard**: a `BEFORE UPDATE` trigger (`users_prevent_self_privilege_change` / `enforce_user_privilege_immutability()`) blocks any non-admin session from changing `role` or `is_active`, even via direct row update (migration `20260424_prevent_self_role_elevation`)
- **Frontend**: Admin console (`AdminPage.tsx`) lazy-loaded; nav item gated by `roles: ['ADMIN']` config (resolved via `useRBAC().hasRole`/`hasMinRole` — there is no `permissions.canAccessAdminPanel` flag anymore, see Files to Review); `RoleGuard` available for component gating
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
- [ ] `PATCH /users/:id`: a consent-bearing change (password reset, role change, OR deactivation → `mustRevoke`, `adminRoutes.ts:319`) revokes ALL of the target user's sessions in the same admin RLS tx (F-41 fix) AND stamps `tokensValidAfter` for cross-instance access-token cutoff (M-4); `revokedSessionCount` is surfaced in the audit metadata (`:343`)
- [ ] `DELETE /users/:id` (soft delete): sets `isActive=false` AND deletes all the user's sessions atomically
- [ ] `DELETE /users/:id/permanent`: requires `confirmEmail` body matching the target's email (`schemas.admin.permanentDelete`); rate limited via `sensitiveLimiter`; logged as `PERMANENT_DELETE` before deletion
- [ ] `PATCH /users/:id/plan`: plan assignment (FREE/PRO/TEAM) + optional `expiresAt`; logged as `PLAN_CHANGE` with previous/new plan (plan gates features/spend)
- [ ] Admin cannot delete their own account (self-deletion blocked in both `DELETE /users/:id` and `/permanent`)
- [ ] Admin cannot modify their own role (`if (id === adminId && role) throw ForbiddenError` in `PATCH /users/:id`)
- [ ] Role assignment restricted to the `UserRole` enum (PATIENT/PROVIDER/ADMIN) by the Zod schema

### 3. Audit Log Access
- [ ] Admin can view audit logs with filters (date, user, action, resource)
- [ ] Audit log viewing is itself audit logged
- [ ] PHI values in audit logs encrypted at rest: audit metadata lives in `metadataEncrypted` (AES-256-GCM; the legacy plaintext `metadata` column was IRREVERSIBLY dropped in migration `20260615_drop_legacy_audit_metadata`, M6). The admin audit-logs route selects `metadataEncrypted`, decrypts it via `getAuditLogService().decryptMetadata()` for the authorized ADMIN view, and strips the raw ciphertext before responding; the PHI snapshot columns `previousValueEncrypted`/`newValueEncrypted` are EXCLUDED from the select (`adminRoutes.ts:1000-1032`)
- [ ] Audit logs cannot be modified or deleted by admin — this is now a DATABASE guarantee, not just app-scheduler discipline: `FORCE ROW LEVEL SECURITY` is applied to all 19 RLS tables incl. `audit_logs` (a table owner cannot bypass RLS), and the `audit_logs_delete` policy was rewritten to `USING (is_admin_session() AND created_at < now() - interval '7 years')` so even an admin-context bug cannot purge recent audit history (migration `20260613_force_rls_and_audit_retention:14-31,41-44`)
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
- [ ] Admin mutations revoke the target's access on ANY consent-bearing change, not just password reset: `PATCH /users/:id` computes `mustRevoke = !!password || roleChanged || deactivated` (`adminRoutes.ts:317-319`) and, when true, deletes ALL the target's sessions AND stamps `tokensValidAfter = now()` in the SAME admin RLS update (`:321`, `:338-341`); `DELETE /users/:id` (soft-delete) stamps `tokensValidAfter` too (`:478`). Verify role-change and deactivation both trip `mustRevoke` (this is implemented — M-14/M-4 — do NOT flag it as an open gap)
- [ ] Cross-instance access-token revocation is wired (M-4): the `tokensValidAfter` stamp (`users.tokens_valid_after`, migration `20260606000002_add_tokens_valid_after`; `schema.prisma:36`) is followed by `invalidateTokensValidAfterCache(id)` (`adminRoutes.ts:363`, `:485`) so `authenticate()` rejects in-flight access JWTs on EVERY Cloud Run replica, not just the DB-backed refresh sessions — verify the cache invalidation call fires on every admin path that stamps `tokensValidAfter`
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
- [ ] Provider-relationship list/update logged (`admin_provider_relationship`); `PATCH /provider-relationships/:id` validates with the strict `schemas.admin.updateProviderRelationship` (`adminRoutes.ts:733`) and enforces the M-3 re-consent gate — an admin CANNOT reactivate a `REVOKED` relationship (status moving off `REVOKED`) without an explicit `reConsent=true` flag; it fails closed otherwise (`:768-775`, `:813-819`). `canEditData` is deliberately ignored / never persisted (L-37, `:738-742`, `:786`) — confirm it is not silently restored
- [ ] Audit log access itself logged (`admin_audit_logs`, VIEW — meta-audit "who watches the watchers")
- [ ] System statistics views logged (`admin_system_stats`, VIEW)

### 8. Frontend Admin Security
- [ ] `AdminPage` is lazy-loaded in `Dashboard.tsx` (`lazy(() => import('../admin/AdminPage'))`) so it is not bundled into the main chunk for non-admin users
- [ ] Admin nav item gated by `roles: ['ADMIN']` (see `src/data/sampleData.ts`), resolved through `useRBAC().hasRole('ADMIN')` (the `permissions.canAccessAdminPanel` flag was removed as dead code, L-28 — do NOT expect a capability-flags object on `useRBAC`)
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

# Check frontend admin gating — useRBAC now exposes only role helpers
# (canAccessAdminPanel/canManageUsers/canViewAuditLogs were removed, L-28;
#  the grep below should match ONLY the removal comment at useRBAC.ts:23-29,
#  never an actual capability-flags object)
grep -n "canAccessAdminPanel\|canManageUsers\|canViewAuditLogs" src/hooks/useRBAC.ts
grep -n "hasRole\|hasMinRole\|return {" src/hooks/useRBAC.ts
grep -n "roles:\s*\['ADMIN'\]" src/data/sampleData.ts
grep -n "lazy(() => import('../admin/AdminPage')" src/components/dashboard/Dashboard.tsx
```

## Questions to Ask
1. Can an admin modify or delete audit logs? (There is no audit-log mutation route — `adminRoutes.ts` only exposes `GET /audit-logs`. Immutability is now DB-enforced: `FORCE RLS` on `audit_logs` + the `audit_logs_delete` policy restricts deletes to rows older than 7 years even in admin context — so retention is a database guarantee, not just the `AUDIT_CLEANUP_TOKEN` scheduler. Confirm no other path lets `AuditLog` rows be edited/deleted and that the FORCE-RLS + retention policy from `20260613_force_rls_and_audit_retention` is still present.)
2. ADMIN is the highest level (`ROLE_HIERARCHY` = 3); confirm no super-admin/system role is being added.
3. How are initial ADMIN accounts created (seed script, manual DB write in admin context, first-user)? The self-elevation trigger means a non-admin session cannot bootstrap one.
4. `SystemConfig` exists in the schema but is unwired — is config management planned for the admin panel? If so it needs its own RBAC + audit + (if `isEncrypted`) PHI handling review.
5. (RESOLVED — keep as a regression check, not an open question) Role change AND deactivation already force-invalidate the target's sessions and stamp the cross-instance `tokensValidAfter` cutoff via `mustRevoke = !!password || roleChanged || deactivated` in `PATCH /users/:id` (M-14/M-4). Verify any NEW admin mutation that changes a user's effective privileges also trips `mustRevoke` (or otherwise stamps `tokensValidAfter`) so it can't leave a live access token behind.
6. Are admin sessions treated differently (shorter expiration, step-up verification)? Is there IP allowlisting for admin access?
