# Admin Panel Security Audit

**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (automated security review)
**Scope:** Admin routes, RBAC enforcement, demo protections, audit logging, frontend gating
**Status:** PARTIAL PASS -- Several findings require remediation

---

## Files Reviewed

| File | Path |
|------|------|
| Admin Routes | `backend/src/routes/adminRoutes.ts` |
| RBAC Middleware | `backend/src/middleware/rbac.ts` |
| Auth Middleware | `backend/src/middleware/auth.ts` |
| Demo Protection | `backend/src/middleware/demoProtection.ts` |
| Rate Limiter | `backend/src/middleware/rateLimiter.ts` |
| Audit Log Service | `backend/src/services/auditLog.ts` |
| Validation Schemas | `backend/src/middleware/validation.ts` |
| Auth Service | `backend/src/services/authService.ts` |
| Auth Controller | `backend/src/controllers/authController.ts` |
| Prisma Schema | `backend/prisma/schema.prisma` |
| Frontend Admin API | `src/services/api/admin.ts` |
| useRBAC Hook | `src/hooks/useRBAC.ts` |
| RoleGuard Component | `src/components/common/RoleGuard.tsx` |
| Route Index | `backend/src/routes/index.ts` |
| Config | `backend/src/config/index.ts` |

---

## 1. Route Authorization

### [x] PASS -- All admin routes require `requireRole('ADMIN')` middleware

**File:** `backend/src/routes/adminRoutes.ts:25-26`

```typescript
router.use(authenticate);
router.use(requireRole('ADMIN'));
```

All routes defined on this router inherit both middleware via `router.use()`. The `requireRole('ADMIN')` function at `backend/src/middleware/rbac.ts:61-75` checks that `req.user.role` is exactly `'ADMIN'` (not hierarchical -- it uses `allowedRoles.includes(userRole)`). This is applied as a blanket middleware on all routes in the admin router.

### [x] PASS -- Admin routes registered AFTER authentication middleware

**File:** `backend/src/routes/adminRoutes.ts:25-26`

`authenticate` is applied at line 25, `requireRole('ADMIN')` at line 26. Middleware is processed in registration order, so authentication always runs before role checking. Individual route handlers are registered after both.

### [x] PASS -- No admin endpoints accessible without authentication

The `authenticate` middleware at `backend/src/middleware/auth.ts:50-87` throws `UnauthorizedError('Authentication required')` if no valid JWT token is found. It validates the token signature, checks expiration, and verifies the token type is `'access'`. Since this is applied via `router.use()` before all admin route handlers, no admin endpoint can be reached without a valid access token.

### [x] PASS -- No admin endpoints accessible by PATIENT or PROVIDER roles

`requireRole('ADMIN')` at `backend/src/middleware/rbac.ts:69` checks `allowedRoles.includes(userRole)` where `allowedRoles` is `['ADMIN']`. Neither `'PATIENT'` nor `'PROVIDER'` is included, so they receive a `ForbiddenError`.

### [x] PASS -- Admin middleware cannot be bypassed via parameter manipulation

The `requireRole` middleware reads the role from `req.user.role`, which is set by the `authenticate` middleware from the verified JWT payload (`backend/src/middleware/auth.ts:71-75`). The JWT is cryptographically signed with `config.jwt.accessSecret`, so the role claim cannot be tampered with. Route parameters, query strings, and request body do not influence the role check.

---

## 2. User Management Security

### [x] PASS -- List users: paginated, no password hashes exposed

**File:** `backend/src/routes/adminRoutes.ts:36-97`

The `findMany` query uses explicit `select` (lines 57-76) that only includes: `id`, `email`, `role`, `isActive`, `emailVerified`, `createdAt`, `lastLoginAt`, and `_count` relations. The `passwordHash` field is not selected. Pagination is enforced with `skip/take` (lines 74-75) and limit is capped at 100 (`Math.min(100, ...)` at line 42). Validation is via `schemas.admin.listUsersQuery` which caps limit at 100 (`backend/src/middleware/validation.ts:568`).

### [x] PASS -- View user: no sensitive credentials returned

**File:** `backend/src/routes/adminRoutes.ts:103-144`

The `findUnique` query uses explicit `select` (lines 112-131) that excludes `passwordHash`, `emailVerificationToken`, `passwordResetToken`, and all encrypted PHI fields (`firstNameEncrypted`, `lastNameEncrypted`, `dateOfBirthEncrypted`, `phoneEncrypted`, `addressEncrypted`). Only metadata fields are returned.

### [x] PASS -- Create user: validates required fields, hashes password properly

**File:** `backend/src/routes/adminRoutes.ts:150-190`

Validation uses `schemas.admin.createUser` (`backend/src/middleware/validation.ts:549-555`) which requires `email` (validated email format) and `password` (strong password: 8+ chars, uppercase, lowercase, number, special char). Password is hashed with bcrypt at `config.security.bcryptRounds` (line 164). Duplicate email check is performed (lines 158-160). The response only returns the safe `select` fields (lines 174-181).

### [ ] FAIL -- Update user: role changes NOT audit logged with old/new values

**File:** `backend/src/routes/adminRoutes.ts:196-243`

**FINDING: No audit logging is performed for any admin user update operations.** The PATCH `/users/:id` handler updates the user record but does not call the `AuditLogService` to log the change. The old role value is available in `existing` (line 211) and the new role in `role` (line 204), but no audit entry is created. This is a significant gap for HIPAA compliance and security monitoring.

Additionally, when a role is changed, **user sessions are NOT invalidated**. The existing JWT tokens remain valid with the old role until they expire (15 minutes). This means a user whose role is downgraded from ADMIN to PATIENT could continue making admin API calls for up to 15 minutes.

### [x] PASS -- Deactivate user (soft delete): user sessions revoked

**File:** `backend/src/routes/adminRoutes.ts:249-282`

The DELETE `/users/:id` handler performs a soft delete by setting `isActive: false` (line 270) and then invalidates all sessions with `prisma.session.deleteMany({ where: { userId: id } })` (line 274). This revokes refresh tokens, though the 15-minute access token window remains.

### [x] PASS -- Hard delete: requires explicit confirmation (confirm email)

**File:** `backend/src/routes/adminRoutes.ts:289-323`

The DELETE `/users/:id/permanent` handler requires `confirmEmail` in the request body and validates it matches the target user's email (lines 310-312). If it doesn't match, a `BadRequestError` is thrown. Rate limiting is also applied via `sensitiveLimiter` (line 291).

### [x] PASS -- Admin cannot delete their own account via admin panel

**File:** `backend/src/routes/adminRoutes.ts:258-259` (soft delete) and `300-301` (hard delete)

Both delete handlers check `if (id === adminId)` and throw `ForbiddenError('Cannot delete your own account')`.

### [~] PARTIAL -- Admin cannot demote themselves below ADMIN

**File:** `backend/src/routes/adminRoutes.ts:207-209`

```typescript
if (id === adminId && role) {
  throw new ForbiddenError('Cannot modify your own role');
}
```

The check prevents an admin from changing their OWN role. However, it does not prevent the last remaining ADMIN from demoting ALL other admins, potentially leaving zero admins in the system. There is no "last admin" protection.

### [x] PASS -- Role assignment restricted to valid enum values only

**File:** `backend/src/middleware/validation.ts:552` (create) and `558` (update)

Both schemas use `z.enum(['PATIENT', 'PROVIDER', 'ADMIN'])` which strictly validates the role against the three allowed enum values. Any other value is rejected by Zod validation before reaching the handler.

---

## 3. Audit Log Access

### [x] PASS -- Admin can view audit logs with filters (date, user, action, resource)

**File:** `backend/src/routes/adminRoutes.ts:458-513`

The GET `/audit-logs` endpoint accepts query parameters for filtering: `userId`, `action`, `resourceType`, `startDate`, `endDate`, `page`, and `limit`. All validated through `schemas.admin.auditLogQuery` (`backend/src/middleware/validation.ts:572-580`).

### [ ] FAIL -- Audit log viewing is NOT itself audit logged

**File:** `backend/src/routes/adminRoutes.ts:458-513`

**FINDING: The audit log query handler does not create an audit log entry recording who viewed the audit logs.** There is no call to `AuditLogService.logAccess()` or any equivalent in this handler. For HIPAA compliance, access to audit logs should itself be logged (who viewed what logs, when, with what filters).

### [~] PARTIAL -- PHI values in audit logs encrypted

**File:** `backend/src/services/auditLog.ts:169-180`

The `AuditLogService.encryptValue()` method encrypts `previousValue` and `newValue` before storage using AES-256-GCM, stored as `previousValueEncrypted` and `newValueEncrypted` in the database schema (`backend/prisma/schema.prisma:508-509`). However, the admin audit log viewer endpoint (`backend/src/routes/adminRoutes.ts:481-492`) returns raw `auditLog.findMany()` results without decrypting the values. This means the admin sees the encrypted ciphertext strings, not the plaintext PHI. **There is no endpoint to decrypt audit log values**, which may limit the usefulness of the audit log viewer, but is acceptable from a security standpoint.

The `metadata` field in audit logs (`schema.prisma:510`) is stored as a plain `String?` (JSON) and is NOT encrypted. Metadata may contain search terms, filter criteria, email addresses, and other potentially sensitive information.

### [x] PASS -- Audit logs cannot be modified or deleted by admin

There are no PUT, PATCH, or DELETE endpoints for audit logs in `adminRoutes.ts`. The only audit log endpoint is the GET query. The `AuditLogService` only exposes `log()`, `logAccess()`, `logCreate()`, `logUpdate()`, `logDelete()`, `logAuth()`, `logExport()`, `logSystem()`, and `queryLogs()` -- none of which provide update or delete operations. The only deletion is the automated `cleanupOldLogs()` method that removes records older than 7 years (2555 days) per HIPAA retention requirements.

### [x] PASS -- Pagination enforced on audit log queries

**File:** `backend/src/routes/adminRoutes.ts:463-464` and `backend/src/middleware/validation.ts:579`

The audit log query uses `skip` and `take` for pagination. The limit is capped at 200 per page (`Math.min(Math.max(1, parseInt(val || '50', 10)), 200)` in the validation schema). Default is 50.

### [~] PARTIAL -- Date range filtering prevents unbounded queries

Date range filtering is supported via `startDate` and `endDate` query parameters. However, **neither parameter is required**. If no date range is specified, the query returns results across the entire audit log history (up to 7 years). The `take: limit` parameter (max 200) prevents a single response from being too large, but the absence of a mandatory date range means the database must still evaluate a potentially large index scan for `count()`.

---

## 4. System Statistics

### [x] PASS -- Statistics endpoint returns aggregate data only

**File:** `backend/src/routes/adminRoutes.ts:396-448`

The `/stats` endpoint returns only aggregate counts: `totalUsers`, `usersByRole` (groupBy count), `activeUsers` (count), `totalBiomarkers` (count), `totalInsurancePlans` (count), `totalHealthNeeds` (count), and `recentLogins` (count with date filter). All queries use Prisma `.count()` or `.groupBy()` with `_count`.

### [x] PASS -- No individual user PHI exposed in statistics

The statistics queries only return numeric counts and role-grouped counts. No individual user records, names, emails, or other PII/PHI is included in the response.

### [x] PASS -- No PII in statistics responses

The response structure contains only: `users.total`, `users.active`, `users.byRole` (role name to count mapping), `users.recentLogins`, `data.biomarkers`, `data.insurancePlans`, `data.healthNeeds`. No email addresses, names, or identifiable information.

### [x] PASS -- Statistics queries optimized

All statistics queries use Prisma `.count()` and `.groupBy()`, which translate to SQL `COUNT(*)` and `GROUP BY` operations. The schema has appropriate indexes: `users` has indexes on `email` and `createdAt` (`schema.prisma:47-48`). The `recentLogins` query filters on `lastLoginAt` which, while not explicitly indexed, uses a simple range comparison. These are efficient aggregate operations.

---

## 5. Privilege Escalation Prevention

### [x] PASS -- No path from PATIENT/PROVIDER to ADMIN without DB change

The registration endpoint (`backend/src/controllers/authController.ts:148-206`) only accepts `email` and `password` -- no role parameter. The `createUser` function in `authService.ts:456-459` defaults to `'PATIENT'` role. The `schemas.auth.register` validation schema (`backend/src/middleware/validation.ts:236-241`) only accepts `email`, `password`, `firstName`, `lastName` -- no role field. The only way to change a user's role is through the admin PATCH `/users/:id` endpoint, which requires ADMIN authentication.

### [x] PASS -- Role field in User model not modifiable via non-admin API

No non-admin route handler modifies the `role` field. The auth controller only reads roles for JWT generation. The settings/profile endpoints (if they exist) do not accept role changes. The only role modification is in `backend/src/routes/adminRoutes.ts:217`.

### [~] PARTIAL -- JWT claims include role but are NOT re-verified on each request

**File:** `backend/src/middleware/auth.ts:63-75`

The `authenticate` middleware decodes the JWT and trusts the `role` claim from the token without querying the database:

```typescript
const decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
req.user = {
  id: decoded.id,
  email: decoded.email,
  role: decoded.role,  // Trusts JWT claim, no DB lookup
};
```

**FINDING:** If an admin changes a user's role, the user's existing access tokens (valid for up to 15 minutes) will still carry the OLD role. This creates a window where a demoted admin or escalated patient has incorrect permissions. The role is NOT re-verified against the database on each request. This is a common performance trade-off (avoiding a DB query per request), but should be documented as a known limitation.

### [ ] FAIL -- Role changes do NOT require re-authentication

**File:** `backend/src/routes/adminRoutes.ts:196-243`

When an admin changes a user's role via PATCH `/users/:id`, the handler does NOT invalidate the target user's sessions or tokens. The `session.deleteMany()` call is only in the DELETE (deactivation) handler, not the PATCH handler. This means:
1. The user's existing access tokens remain valid with the old role for up to 15 minutes.
2. The user's refresh tokens remain valid, and on next refresh, the new role will be picked up (since `generateAccessToken` reads from the DB user object).

### [~] PARTIAL -- No hidden admin routes discoverable via enumeration

**File:** `backend/src/routes/index.ts:50-68`

The API info endpoint at `GET /api/v1/` returns a list of all endpoint prefixes including `'/api/v1/admin'`. This publicly reveals the existence of admin routes. While this doesn't expose specific endpoints within the admin namespace, it does confirm that an admin API exists. The `/health` endpoint is also publicly accessible. The admin routes themselves are protected, but their existence is discoverable.

---

## 6. Demo Account Protections

### [~] PARTIAL -- Demo accounts cannot be granted ADMIN role

**File:** `backend/src/middleware/demoProtection.ts:37-54`

The `blockDemoRoleChange` middleware blocks a demo account from changing its OWN role to anything other than PATIENT. However, this middleware is NOT applied on the admin routes. There is no check in `adminRoutes.ts` that prevents a non-demo admin from changing the demo user's role to ADMIN. Additionally, the demo user is always created as PATIENT (`backend/src/services/authService.ts:944`), and since the demo user would not have ADMIN access to reach the admin routes, they cannot self-escalate. But an existing admin could theoretically promote the demo user to ADMIN.

### [ ] FAIL -- `demoProtection.ts` middleware NOT applied to admin routes

**File:** `backend/src/routes/adminRoutes.ts`

**FINDING:** None of the demo protection middleware functions (`blockDemoAdminAccess`, `blockDemoRoleChange`, `blockDemoUserModification`, or the combined `demoProtection`) are imported or applied on the admin routes. There is no `import` statement for `demoProtection.ts` in `adminRoutes.ts`, and no `router.use(blockDemoAdminAccess)` call.

In practice, this is partially mitigated by the fact that demo accounts are created as PATIENT role and cannot reach admin routes. However, if a demo account were somehow granted ADMIN role (e.g., by direct DB manipulation or another admin), the demo protection middleware would not block them from performing admin operations.

### [x] PASS -- Demo account restrictions enforced at backend (not just frontend)

**File:** `backend/src/middleware/demoProtection.ts`

The demo protection middleware is server-side Express middleware that checks `req.user.email` against the configured demo email. It throws `ForbiddenError` (HTTP 403) from the backend. However, as noted above, these middleware functions are not applied to admin routes specifically.

---

## 7. Admin Action Audit Trail

### [ ] FAIL -- User creation NOT logged

**File:** `backend/src/routes/adminRoutes.ts:150-190`

The POST `/users` handler creates a user but does NOT call any audit logging function. No `auditLogService.logCreate()` or equivalent is invoked. The admin's action of creating a new user is unrecorded.

### [ ] FAIL -- User update NOT logged with changed fields

**File:** `backend/src/routes/adminRoutes.ts:196-243`

The PATCH `/users/:id` handler updates user fields but does NOT call any audit logging function. The old values are available in `existing` and new values in `updateData`, but no audit entry is created. Role changes, password resets by admin, email verification overrides -- none are logged.

### [ ] FAIL -- User deactivation/deletion NOT logged

**File:** `backend/src/routes/adminRoutes.ts:249-282` (soft delete) and `289-323` (hard delete)

Neither the soft delete (deactivation) nor the hard delete (permanent deletion) handlers create audit log entries. The admin performing the deletion is not recorded.

### [ ] FAIL -- Role changes NOT logged with old and new role

Same as the user update finding above. The PATCH handler has access to `existing.role` (old) and `role` (new) but does not create an audit entry.

### [ ] FAIL -- Email verification overrides NOT logged

When an admin sets `emailVerified: true` via the PATCH `/users/:id` endpoint, this override is not audit logged.

### [ ] FAIL -- Audit log access NOT logged

The GET `/audit-logs` endpoint does not record an audit entry for the admin viewing audit logs.

### [ ] FAIL -- System health checks by admin NOT logged

The GET `/stats` endpoint does not record an audit entry for the admin viewing system statistics.

**Summary:** The `AuditLogService` at `backend/src/services/auditLog.ts` provides comprehensive logging methods (`logCreate`, `logUpdate`, `logDelete`, `logAccess`), but NONE of these are called anywhere in `adminRoutes.ts`. The admin routes have ZERO audit logging. This is a critical gap for HIPAA compliance.

---

## 8. Frontend Admin Security

### [ ] FAIL -- Admin pages NOT lazy-loaded

**File:** `src/App.tsx:37-42` and `src/components/dashboard/Dashboard.tsx:40-44`

The lazy-loaded components in the app are: `Dashboard`, `LoginPage`, `RegisterPage`, `VerifyEmailPage`, `ResetPasswordPage`, `ForgotPasswordPage`, `InsuranceHub`, `FilesPage`, `TrendsPage`, `AccountSettingsPage`, and various modal components. There is no dedicated lazy-loaded admin page component. In fact, there are no admin page components at all in `src/components/` -- no `AdminPanel`, `AdminDashboard`, `UserManagement`, or similar component files were found. The admin API (`src/services/api/admin.ts`) exists, but no frontend admin UI components are present, suggesting the admin panel UI has not yet been built, or is built into the Dashboard without separate components.

### [x] PASS -- `useRBAC().canAccessAdminPanel` check available

**File:** `src/hooks/useRBAC.ts:33,47`

The `useRBAC` hook computes `canAccessAdminPanel: roleLevel >= ROLE_HIERARCHY.ADMIN` which evaluates to `true` only for ADMIN role (level 3). This permission flag is available for any future admin UI components to check.

### [x] PASS -- RoleGuard wraps admin components

**File:** `src/components/common/RoleGuard.tsx:44-67`

The `RoleGuard` component and its `AdminOnly` convenience wrapper (`src/components/common/RoleGuard.tsx:94-100`) correctly check authentication and role before rendering children. However, since no admin page components were found, this is a theoretical pass -- the guard exists but may not be in active use.

### [x] PASS -- Admin API calls fail gracefully if role is insufficient

**File:** `src/services/api/admin.ts`

The frontend admin API module uses `apiFetch` which goes through the standard HTTP client. If the backend returns 403 (Forbidden) for non-admin users, the promise will reject. The API calls do not attempt to handle authorization differently from other errors, which is the correct behavior -- the backend enforces access control.

### [x] PASS -- No admin-only data prefetched for non-admin users

No evidence of admin data prefetching was found in the frontend code. The admin API functions in `src/services/api/admin.ts` are standard async functions that must be explicitly called. There are no `useEffect` hooks, React Query prefetch calls, or similar patterns that would automatically load admin data.

---

## 9. Rate Limiting

### [~] PARTIAL -- Admin endpoints rate limited

**File:** `backend/src/routes/adminRoutes.ts` and `backend/src/middleware/rateLimiter.ts`

The admin routes inherit the global rate limiter (`standardLimiter`) that is applied application-wide in `app.ts`. However, no admin-specific rate limiter is applied to the admin router or its individual endpoints. The only endpoint with explicit rate limiting is the permanent delete endpoint (`/users/:id/permanent`) which uses `sensitiveLimiter` (10 requests/hour).

The `standardLimiter` provides `config.rateLimit.maxRequests` per `config.rateLimit.windowMs` window for ALL API endpoints combined. This offers basic protection but does not specifically limit admin operations.

### [ ] FAIL -- Bulk user operations NOT specifically rate limited

There are no bulk admin operations in the current implementation (no batch create/delete). However, an admin could rapidly iterate through individual user management endpoints. No per-operation rate limiting exists beyond the global limiter.

### [~] PARTIAL -- Audit log queries rate limited (global only)

The GET `/audit-logs` endpoint is only protected by the global rate limiter. Given that audit log queries can be expensive (they join with the `user` table and potentially scan large date ranges), a dedicated rate limiter would be appropriate.

### [x] PASS -- Hard delete operations rate limited

**File:** `backend/src/routes/adminRoutes.ts:291`

The permanent delete endpoint uses `sensitiveLimiter` (10 requests/hour per IP), which is appropriate for this destructive operation.

---

## Additional Security Questions (from prompt)

### Q1: Can an admin modify or delete audit logs?

**Answer: No.** There are no write/delete endpoints for audit logs in the admin routes. The `AuditLogService` does not expose any public update or delete methods. The only deletion is the automated 7-year retention cleanup via `cleanupOldLogs()` which runs on a scheduled interval.

### Q2: Is there a super-admin role or is ADMIN the highest level?

**Answer: ADMIN is the highest level.** The role hierarchy at `backend/src/middleware/rbac.ts:16-20` defines three levels: PATIENT(1), PROVIDER(2), ADMIN(3). There is no super-admin or system administrator role. All ADMIN users have equal privileges.

### Q3: How are initial ADMIN accounts created?

**Answer: Direct database manipulation or admin panel.** The registration endpoint always creates PATIENT accounts. The `createUser` function defaults to PATIENT. An ADMIN user can create other ADMIN users via POST `/admin/users`. The first ADMIN account must be created by direct database UPDATE: `UPDATE users SET role = 'ADMIN' WHERE email = '...'`.

### Q4: Are admin sessions treated differently?

**Answer: No.** Admin sessions use the same JWT access token (15 min) and refresh token (7 days) durations as all other users. There is no shorter expiration, additional MFA, or IP-based restrictions for admin sessions.

### Q5: Is there IP allowlisting for admin access?

**Answer: No.** There is no IP allowlisting for admin routes. Any authenticated ADMIN user can access admin endpoints from any IP address.

---

## Provider Relationship Management (Additional Finding)

### [~] PARTIAL -- Provider relationship management lacks validation

**File:** `backend/src/routes/adminRoutes.ts:333-386`

The GET `/provider-relationships` endpoint has no pagination validation (hardcoded `take: 100`). The PATCH `/provider-relationships/:id` endpoint validates the `:id` param as UUID but does NOT validate the request body with a Zod schema. The `status`, `canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canViewHealthNeeds`, and `canEditData` fields from `req.body` are spread directly into the Prisma update. While Prisma provides type validation at the database layer, the lack of explicit input validation means unexpected fields could be passed (though they would be ignored by Prisma's type system).

---

## Summary of Findings

### Critical Issues (Must Fix)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| 1 | **No audit logging on ANY admin operation** | `adminRoutes.ts` (all handlers) | HIPAA compliance violation. Admin user creation, updates, role changes, deletions, and audit log access are all unlogged. |
| 2 | **Role changes do not invalidate sessions** | `adminRoutes.ts:196-243` | 15-minute window where demoted users retain elevated privileges. |
| 3 | **Demo protection middleware not applied to admin routes** | `adminRoutes.ts` | If demo user gains ADMIN role, no demo-specific restrictions are enforced. |

### Medium Issues (Should Fix)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| 4 | JWT role claims not re-verified against database | `auth.ts:63-75` | Stale role in JWT for up to 15 min after role change. |
| 5 | No "last admin" protection | `adminRoutes.ts:196-243` | An admin could demote all other admins, potentially leaving system with zero admins. |
| 6 | No admin-specific rate limiting | `adminRoutes.ts` | Admin endpoints rely only on global rate limiter; no per-operation throttling. |
| 7 | Admin routes discoverable via API info endpoint | `routes/index.ts:64` | `/api/v1/` publicly lists `/api/v1/admin`. |
| 8 | Audit log metadata field not encrypted | `schema.prisma:510` | Metadata (search terms, emails) stored as plain JSON. |
| 9 | No mandatory date range on audit log queries | `adminRoutes.ts:458-513` | Unbounded queries could strain the database. |
| 10 | Provider relationship PATCH lacks body validation | `adminRoutes.ts:360-386` | No Zod schema validates the request body. |

### Low Issues (Consider Fixing)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| 11 | Admin pages not built / not lazy-loaded | `src/` (no admin components) | Frontend admin UI appears incomplete. |
| 12 | No IP allowlisting for admin access | N/A | Any IP can access admin panel with valid credentials. |
| 13 | No shorter session duration for admin accounts | `config/index.ts` | Admin sessions have same 15-min/7-day tokens as patients. |

---

## Checklist Results

### 1. Route Authorization
- [x] All admin routes require `requireRole('ADMIN')` or `requireMinRole('ADMIN')` middleware
- [x] Admin routes registered AFTER authentication middleware
- [x] No admin endpoints accessible without authentication
- [x] No admin endpoints accessible by PATIENT or PROVIDER roles
- [x] Admin middleware cannot be bypassed via parameter manipulation

### 2. User Management Security
- [x] List users: paginated, no password hashes exposed
- [x] View user: no sensitive credentials returned (password hash, encryption keys)
- [x] Create user: validates required fields, hashes password properly
- [ ] FAIL: Update user: role changes NOT audit logged with old/new values
- [x] Deactivate user (soft delete): user sessions revoked
- [x] Hard delete: requires explicit confirmation (e.g., confirm email)
- [x] Admin cannot delete their own account via admin panel
- [~] PARTIAL: Admin cannot demote themselves below ADMIN (self-check exists, but no "last admin" protection)
- [x] Role assignment restricted to valid enum values only

### 3. Audit Log Access
- [x] Admin can view audit logs with filters (date, user, action, resource)
- [ ] FAIL: Audit log viewing is NOT itself audit logged
- [~] PARTIAL: PHI values in audit logs encrypted (values yes, metadata no)
- [x] Audit logs cannot be modified or deleted by admin
- [x] Pagination enforced on audit log queries (prevent data dumps)
- [~] PARTIAL: Date range filtering available but not mandatory

### 4. System Statistics
- [x] Statistics endpoint returns aggregate data only (counts, totals)
- [x] No individual user PHI exposed in statistics
- [x] No PII in statistics responses (no names, emails in counts)
- [x] Statistics queries optimized (no full table scans)

### 5. Privilege Escalation Prevention
- [x] No path from PATIENT/PROVIDER to ADMIN without DB change
- [x] Role field in User model not modifiable via non-admin API
- [~] PARTIAL: JWT claims include role but are NOT re-verified from DB on each request
- [ ] FAIL: Role changes do NOT require re-authentication (invalidate current tokens)
- [~] PARTIAL: Admin routes exist in public API info endpoint listing

### 6. Demo Account Protections
- [~] PARTIAL: Demo accounts cannot be granted ADMIN role (no protection on admin side)
- [ ] FAIL: `demoProtection.ts` middleware NOT applied to admin routes
- [x] Demo account restrictions enforced at backend (not just frontend)

### 7. Admin Action Audit Trail
- [ ] FAIL: User creation NOT logged (actor: ADMIN, action: CREATE, resource: User)
- [ ] FAIL: User update NOT logged with changed fields
- [ ] FAIL: User deactivation/deletion NOT logged
- [ ] FAIL: Role changes NOT logged with old and new role
- [ ] FAIL: Email verification overrides NOT logged
- [ ] FAIL: Audit log access NOT logged (who viewed what, when)
- [ ] FAIL: System health checks by admin NOT logged

### 8. Frontend Admin Security
- [ ] FAIL: Admin pages NOT lazy-loaded (no admin page components exist)
- [x] `useRBAC().canAccessAdminPanel` check before rendering (available for use)
- [x] RoleGuard wraps admin components (component exists and is correct)
- [x] Admin API calls fail gracefully if role is insufficient
- [x] No admin-only data prefetched for non-admin users

### 9. Rate Limiting
- [~] PARTIAL: Admin endpoints rate limited (global only, no admin-specific limiter)
- [ ] FAIL: Bulk user operations NOT specifically rate limited
- [~] PARTIAL: Audit log queries rate limited (global only)
- [x] Hard delete operations rate limited

---

## Overall Assessment

**Route authorization is solid.** The blanket `authenticate` + `requireRole('ADMIN')` middleware on the admin router ensures all endpoints are properly protected. Input validation via Zod schemas is thorough. User management endpoints correctly prevent self-deletion and self-demotion, and the hard delete requires email confirmation.

**The critical gap is the complete absence of audit logging on admin operations.** Despite having a well-designed `AuditLogService` with methods for logging creates, updates, deletes, and access events, NONE of these methods are called from the admin route handlers. This is the single most important finding in this audit, as HIPAA requires all access to and modifications of protected health information -- including administrative operations -- to be logged.

**Secondary concerns** include the lack of session invalidation on role changes, missing demo protection on admin routes, and the absence of admin-specific rate limiting. These should be addressed but are lower priority than the audit logging gap.
