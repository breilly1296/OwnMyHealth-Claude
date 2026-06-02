# 30-admin-security Review — 2026-06-01

Scope: admin panel authorization, user management, audit-log access, statistics,
privilege-escalation defenses, demo protections, the admin audit trail, frontend
gating, and rate limiting — worked against the live code per `prompts/30-admin-security.md`
and `prompts/_review-protocol.md`.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |
| Info | 1 |

Headline: the admin surface is genuinely hardened — router-level `authenticate →
blockDemoAdminAccess → requireRole('ADMIN')`, admin-context RLS on every query, a
BEFORE-UPDATE DB trigger blocking self-elevation, exhaustive audit logging
(reads included), self-deletion/self-role-change guards, and confirm-email +
`sensitiveLimiter` on permanent delete. The findings are integrity/defense-in-depth
gaps, not disclosure or auth-bypass paths: a queryable `success` audit column that
is never written, and missing session invalidation when an admin demotes or
PATCH-deactivates a user.

## Findings

### F-1 — Failed admin actions are stored with `success = true`; the audit `success`/`errorMessage` columns are never written — **Medium**
- **Location:** `backend/src/services/auditLog.ts:243-255` (the `data` object built in `log()`); column defined at `backend/prisma/schema.prisma:471-472`; consumed in UI at `src/components/admin/AdminPage.tsx:336-339`.
- **Observation:** Every admin failure path (`user_not_found`, `email_confirmation_mismatch`, `self_deletion_blocked`, etc.) calls `auditService.logAccess(..., { success: false, reason: ... })` — but that `success`/`reason` only lands inside the `metadata` JSON blob. The `AuditLogService.log()` write object never sets the dedicated `success` or `errorMessage` columns, so they keep their schema default (`success Boolean @default(true)`). The admin Audit Log UI renders pass/fail from `log.success`, so a failed/blocked admin action is shown as "OK".
- **Impact:** The queryable, indexed integrity signal for "did this privileged action fail?" is wrong for 100% of rows. An auditor filtering `success = false` (or eyeballing the UI's Result column) will miss every blocked self-deletion, every email-confirmation-mismatch on a permanent delete, every not-found probe — exactly the events a HIPAA reviewer cares about. Detection of brute-forced or fat-fingered admin operations is silently degraded.
- **Fix:** In `AuditLogService.log()` (auditLog.ts ~line 243) add `success: entry.success ?? true` and `errorMessage: entry.errorMessage` to the `data` object, thread `success`/`errorMessage` through `AuditLogEntry` and the `logAccess` signature, and have the admin handlers pass them as first-class args instead of (or in addition to) metadata.
- **Evidence:**
  ```ts
  // auditLog.ts:243 — no success / errorMessage key
  const data = { userId: entry.userId, actorType: entry.actorType, action: entry.action,
    resourceType: entry.resourceType, resourceId: entry.resourceId,
    previousValueEncrypted, newValueEncrypted, ipAddress: entry.ipAddress, ... };
  ```
  ```prisma
  success                Boolean     @default(true)
  errorMessage           String?     @map("error_message")
  ```

### F-2 — Admin demotion and PATCH-deactivation do not invalidate the target's sessions/access token — **Medium**
- **Location:** `backend/src/routes/adminRoutes.ts:322-326` (session wipe is gated on `if (password)` only); compare `DELETE /users/:id` at `adminRoutes.ts:441-451` which does wipe sessions.
- **Observation:** In `PATCH /users/:id` the only branch that deletes sessions is `if (password)`. A role downgrade (`ADMIN→PATIENT`) or an account deactivation performed through PATCH (`isActive: false`) leaves the target's existing access token valid. `authenticate` (auth.ts:71-110) re-reads role from the verified JWT but never re-checks `isActive` or current role against the DB, so the stale token keeps working until its natural expiry. The dedicated soft-delete route `DELETE /users/:id` does wipe sessions — so two admin paths to "deactivate" behave differently.
- **Impact:** Bounded but real privilege-retention / continued-access window equal to the access-token TTL (`JWT_ACCESS_EXPIRES_SECONDS` default 900s = 15 min, config/index.ts:62). A just-demoted admin can keep performing admin actions for up to ~15 minutes; a just-deactivated user keeps reading PHI for up to ~15 minutes. The refresh path *does* fail closed (`refreshTokens` rejects `!prismaUser.isActive`, authService.ts:488, and re-reads role on rotation at :497/:507), so the window cannot extend past one access-token lifetime — which is why this is Medium, not High.
- **Fix:** In the `PATCH /users/:id` transaction (adminRoutes.ts ~line 322) also `tx.session.deleteMany({ where: { userId: id } })` when `isRoleChange` is true or when `isActive` transitions to `false`, mirroring the password-reset branch, and surface a `revokedSessionCount` in the audit metadata as the password path already does. (The spec's Privilege-Escalation checklist and Question 5 flag exactly this.)
- **Evidence:**
  ```ts
  let revokedSessionCount = 0;
  if (password) {
    const result = await tx.session.deleteMany({ where: { userId: id } });
    revokedSessionCount = result.count;
  }
  ```

### F-3 — `PATCH /provider-relationships/:id` has no request-body schema; `status` and capability flags are unvalidated — **Low**
- **Location:** `backend/src/routes/adminRoutes.ts:693-721` (only `validate(schemas.uuidParam, 'params')`; body destructured raw).
- **Observation:** Unlike every other admin mutation, this route applies no Zod body schema. `status` is forwarded into `tx.providerPatient.update` with no enum check (`...(status && { status })`), and the capability booleans are taken as-is. There is no `schemas.admin.updateProviderRelationship`.
- **Impact:** Low. An invalid `status` string is rejected by the Prisma enum at the DB layer (so no bad data persists), and the route is ADMIN-only, so blast radius is an admin sending malformed input to themselves — at worst a 500 instead of a clean 400, and an inconsistent validation posture that future refactors could widen. Not an injection vector (Prisma parameterizes).
- **Fix:** Add `schemas.admin.updateProviderRelationship` (z.enum for `status` over `ProviderPatientStatus`, booleans for the four capability flags) in validation.ts and `validate(...)` it on this route, matching the rest of `adminRoutes.ts`.
- **Evidence:**
  ```ts
  router.patch('/provider-relationships/:id',
    validate(schemas.uuidParam, 'params'),
    asyncHandler(async (req, res) => {
      const { status, canViewBiomarkers, canViewInsurance, canViewHealthNeeds, canEditData } = req.body;
  ```

### F-4 — Audit-log query returns raw encrypted PHI columns to the admin client — **Low**
- **Location:** `backend/src/routes/adminRoutes.ts:894-905` (`tx.auditLog.findMany` with no `select`, only `include: { user }`).
- **Observation:** The `/audit-logs` handler selects all `AuditLog` scalar columns, including `previousValueEncrypted` and `newValueEncrypted` (the encrypted PHI change-snapshots). These ciphertext blobs are serialized to the admin browser even though the frontend `AdminAuditLog` type omits them (`src/services/api/admin.ts:54-67`) and the UI never renders them.
- **Impact:** Low. The values are AES-256-GCM ciphertext encrypted under the system salt, so this is not a plaintext PHI disclosure — but shipping ciphertext PHI over the wire to clients that don't use it is needless attack surface and inflates payloads. Encryption-at-rest is preserved.
- **Fix:** Add an explicit `select` to the `findMany` listing only the columns the admin UI consumes (id, userId, actorType, action, resourceType, resourceId, ipAddress, success, errorMessage, metadata, createdAt, user) and exclude `previousValueEncrypted`/`newValueEncrypted`.
- **Evidence:**
  ```ts
  tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take,
    include: { user: { select: { id: true, email: true, role: true } } },
  }),
  ```

### F-5 — Prompt drift: admin nav gating uses `categories[].roles`, not `useRBAC().permissions.canAccessAdminPanel` — **Low**
- **Location:** Spec `30-admin-security.md` checklist 8 ("gated by `roles: ['ADMIN']` AND `useRBAC().permissions.canAccessAdminPanel`"); actual gating at `src/components/dashboard/Dashboard.tsx:135` and `:224-225`.
- **Observation:** `canAccessAdminPanel` is defined in `useRBAC` (`src/hooks/useRBAC.ts:47`) but is never read anywhere in `src/` (only the two definition sites). The admin nav item is filtered by `categories.filter((c) => !c.roles || c.roles.includes(role))` (Dashboard.tsx:135) and the page render is guarded by `if (cat?.roles && !cat.roles.includes(role))` (Dashboard.tsx:224-225). The "AND `canAccessAdminPanel`" claim in the spec does not match the code.
- **Impact:** Low (documentation accuracy). The actual gating is equivalent (`roles: ['ADMIN']` ⇔ `canAccessAdminPanel`), and the backend independently 403s, so there is no security gap — only a stale spec assertion and a dead `useRBAC` permission.
- **Fix:** Either wire the nav/render through `useRBAC().permissions.canAccessAdminPanel` (so the permission has one source of truth) or update the spec checklist to describe the `categories[].roles` mechanism. Per protocol, recorded as prompt drift.
- **Evidence:**
  ```ts
  // Dashboard.tsx:135 — gating is by category roles, not canAccessAdminPanel
  const visibleCategories = categories.filter((c) => !c.roles || c.roles.includes(role));
  ```
  ```ts
  // useRBAC.ts:47 — defined but never consumed
  canAccessAdminPanel: roleLevel >= ROLE_HIERARCHY.ADMIN, // Admins only
  ```

### F-6 — Prompt drift: `/audit-logs` `limit` is capped at 200, not (implied) unbounded; date range is genuinely unbounded — **Low**
- **Location:** Spec checklist 3 ("Date range filtering prevents unbounded queries") vs `backend/src/middleware/validation.ts:771-779` and `backend/src/routes/adminRoutes.ts:885-889`.
- **Observation:** Per-page rows are capped (`schemas.admin.auditLogQuery.limit` clamps to max 200, validation.ts:778), so a single response cannot dump unbounded rows. However, `startDate`/`endDate` are both `optional`, so a query with neither bound scans the entire 7-year table for the `count` and orders all rows before applying `skip/take`. The spec's checkbox implies date filtering *prevents* unbounded queries; in practice nothing forces a date bound — only pagination limits the returned page.
- **Impact:** Low. ADMIN-only, and the `count(*)` over a large `audit_logs` table (indexed on `createdAt`) is a potential expensive query / mild DoS lever, but requires an authenticated admin and there is no dedicated limiter on this route (it relies on the global `standardLimiter`; see Checks/Out-of-scope). No PHI exposure.
- **Fix:** Either default `endDate`/`startDate` to a bounded window (e.g. last 90 days) when both are omitted, or apply `sensitiveLimiter`/`bulkOperationLimiter` to `/audit-logs`. Update the spec checkbox to reflect that date bounding is optional, not enforced.
- **Evidence:**
  ```ts
  auditLogQuery: z.object({ ...
    startDate: dateString.optional(),
    endDate: dateString.optional(),
    limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '50', 10)), 200)),
  ```

### F-7 — Dependency hygiene: 8 moderate transitive advisories in backend prod tree — **Info**
- **Location:** `backend/` `npm audit --omit=dev` (run 2026-06-01).
- **Observation:** 8 moderate advisories, all transitive and outside the admin code path: `uuid` (missing buffer bounds check v3/v5/v6), `@hono/node-server` (serveStatic middleware bypass via repeated slashes, pulled in by `@prisma/dev`/`prisma`), and the `@google-cloud/storage → teeny-request → retry-request → gaxios` chain. 0 high, 0 critical.
- **Impact:** Informational for this admin-security review — none of these are reachable from the admin surface (no `uuid` buffer-mode use in admin handlers; `@hono/node-server` is a Prisma dev/tooling dependency, not the Express runtime). Tracked here for completeness against the protocol's "outdated dependency with known CVE" criterion.
- **Fix:** Run `npm audit fix` / bump `prisma`, `@prisma/dev`, and `@google-cloud/storage` when their patched releases land; re-audit. Not admin-blocking.
- **Evidence:**
  ```
  vulnerabilities summary: {"moderate":8,"high":0,"critical":0,"total":8}
  @hono/node-server: Middleware bypass via repeated slashes in serveStatic
  uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided
  ```

## Checks passed

### 1. Route Authorization
- [x] All admin routes require `requireRole('ADMIN')` — applied once at router level, `adminRoutes.ts:31` (`router.use(requireRole('ADMIN'))`); it is the only `requireRole('ADMIN')` in `backend/src/routes` (Grep), so no route escapes it.
- [x] Admin routes registered AFTER authentication — order is `authenticate` (`:29`) → `blockDemoAdminAccess` (`:30`) → `requireRole('ADMIN')` (`:31`).
- [x] No admin endpoint accessible without authentication — `authenticate` throws `UnauthorizedError` when no token (`auth.ts:79-81`), runs first.
- [x] Not accessible by PATIENT/PROVIDER — `requireRole('ADMIN')` rejects any role not in the allowlist (`rbac.ts:66-68`).
- [x] Cannot be bypassed via parameter manipulation — admin routes use the flat `requireRole('ADMIN')` gate, not `requireResourceAccess`/`getTargetUserId`, so the `userId`/`patientId` param-sniffing path (`rbac.ts:173-187`) is never on the admin chain.

### 2. User Management Security
- [x] `GET /users` paginated, limit capped at 100 — `adminRoutes.ts:47` (`Math.min(100, ...)`); `select` excludes `passwordHash`/keys (`:67-86`); role/isActive/search filters (`:52-57`).
- [x] `GET /users/:id` returns no credentials; UUID param validated — `select` has no passwordHash (`:142-160`); `validate(schemas.uuidParam, 'params')` (`:132`).
- [x] `POST /users` validates via `schemas.admin.createUser` (strongPassword), hashes with `config.security.bcryptRounds`, rejects duplicate email in-transaction — `:202`, `:208`, `:214-216`.
- [x] `PATCH /users/:id` role change audited as `PERMISSION_CHANGE` with previous/new role; runs in admin RLS context — `:346-347`, `:368`, `withRLSContext(null, ..., { isAdmin: true })` `:294/:330`.
- [x] `PATCH /users/:id` admin password reset revokes ALL target sessions in same transaction and surfaces `revokedSessionCount` — `:323-326`, `:367`.
- [x] `DELETE /users/:id` soft delete sets `isActive=false` AND deletes sessions atomically — `:444-449` (single `withRLSContext` tx).
- [x] `DELETE /users/:id/permanent` requires `confirmEmail` match, `sensitiveLimiter`, logged as `PERMANENT_DELETE` before delete — `:468` (limiter), `:508` (match), `:520-532` (logDelete before `:538` delete).
- [x] `PATCH /users/:id/plan` assigns FREE/PRO/TEAM + optional expiresAt; logged as `PLAN_CHANGE` with previous/new — `:572`, `:621-635`.
- [x] Admin cannot delete own account — blocked in both `DELETE /users/:id` (`:394`) and `/permanent` (`:480`).
- [x] Admin cannot modify own role — `if (id === adminId && role) throw ForbiddenError` (`:277-279`).
- [x] Role assignment restricted to UserRole enum by Zod — `schemas.admin.updateUser.role` / `.createUser.role` `z.enum(['PATIENT','PROVIDER','ADMIN'])` (`validation.ts:751`, `:757`).

### 3. Audit Log Access
- [x] Admin can filter audit logs (user/action/resource/date) — `adminRoutes.ts:874-889`.
- [x] Audit-log viewing is itself audited — `admin_audit_logs` VIEW meta-audit (`:915-926`).
- [x] PHI values in audit logs encrypted — `previousValueEncrypted`/`newValueEncrypted` written via `encryptValue` (`auditLog.ts:240-241`, encrypt at `:214-220`); admin UI never decrypts/renders them (admin.ts type omits them). (See F-4 re: ciphertext still sent over wire.)
- [x] Audit logs cannot be modified/deleted by admin — no AuditLog update/delete route exists; only mutation is retention `deleteMany` in `cleanupOldLogs` (`auditLog.ts:542`), not route-exposed (Grep confirmed).
- [x] Pagination enforced — `auditLogQuery` clamps limit ≤ 200 (`validation.ts:778`); handler applies skip/take (`adminRoutes.ts:898-899`).

### 4. System Statistics
- [x] `/stats` returns aggregate counts/groupBy only — `adminRoutes.ts:801-813` (count/groupBy); response is counts (`:828-843`).
- [x] No individual user PHI / no PII (names/emails) in stats — response exposes only totals and `byRole` enum counts (`:828-843`); no per-user rows.
- [x] Queries reasonable — seven `count`/`groupBy` in one admin tx (`:789-826`); `users(role)`/`isActive`/`lastLoginAt` are indexed aggregate counts, no row materialization.

### 5. Privilege Escalation Prevention
- [x] No PATIENT/PROVIDER→ADMIN path without an admin-context DB write — role mutation only via `PATCH /users/:id` (admin-gated) inside `{ isAdmin: true }` context.
- [x] DB trigger blocks self-elevation — `enforce_user_privilege_immutability()` + `BEFORE UPDATE OF role, is_active` trigger `users_prevent_self_privilege_change` exist and raise `42501` for non-admin sessions (`migration.sql:30-62`).
- [x] Trigger admin bypass keys off `is_admin_session()` — `IF is_admin_session() THEN RETURN NEW` (`migration.sql:34-35`); `withRLSContext` sets `app.is_admin` via `set_config('app.is_admin', ...)` (`database.ts:376`), and admin context is `{ isAdmin: true }`, set only on admin/system code paths.
- [x] `requireRole('ADMIN')` reads `req.user.role` from the verified JWT each request — `rbac.ts:64`; `authenticate` repopulates `req.user.role` from `jwt.verify` on every request (`auth.ts:92-108`), no cross-request role cache.
- [x] No hidden admin routes — all live under `/api/v1/admin` (mounted `routes/index.ts:92`); no other `requireRole('ADMIN')`/`adminOnly` usage in routes (Grep).
- (Partial — session invalidation on role change: see F-2.)

### 6. Demo Account Protections
- [x] `blockDemoAdminAccess` runs BEFORE `requireRole('ADMIN')` — `adminRoutes.ts:30` before `:31`.
- [x] `blockDemoRoleChange` blocks non-PATIENT role for demo — `demoProtection.ts:53-57`.
- [x] `isDemoAccount` returns false when `DEMO_EMAIL` unset/empty — `if (!config.demo.email || config.demo.email.trim() === '') return false` (`demoProtection.ts:34`).
- [x] Demo restrictions enforced at backend — middleware throws `ForbiddenError` server-side (`demoProtection.ts:72-77`).

### 7. Admin Action Audit Trail
- [x] User creation logged via `logCreate('admin_user', ...)` with role/isActive/emailVerified — `adminRoutes.ts:242-252`.
- [x] User update logged via `logUpdate('admin_user', ...)` with previous/new and `passwordChanged` — `:350-369`.
- [x] Role changes logged `operation: 'PERMISSION_CHANGE'` + previousRole/newRole — `:347`, `:368`.
- [x] Plan changes logged `operation: 'PLAN_CHANGE'` + previousPlan/newPlan — `:628-633`.
- [x] Deactivation logged (`admin_user_status`, DEACTIVATE); permanent delete via `logDelete('admin_user_permanent', ...)` before delete — `:425-438`, `:520-532`.
- [x] User listing/detail views logged (`admin_user_list` / `admin_user_detail`) — `:96`, `:180`.
- [x] Provider-relationship list/update logged (`admin_provider_relationship`) — `:674`, `:740`.
- [x] Audit-log access logged (`admin_audit_logs`, VIEW) — `:915`.
- [x] System stats views logged (`admin_system_stats`, VIEW) — `:847`.
- (Caveat — failure entries' `success:false` lands in metadata only, not the column: see F-1.)

### 8. Frontend Admin Security
- [x] `AdminPage` lazy-loaded in `Dashboard.tsx` — `const AdminPage = lazy(() => import('../admin/AdminPage'))` (`Dashboard.tsx:55`).
- [x] Admin nav item gated by `roles: ['ADMIN']` — `sampleData.ts:233`; render-time role gate at `Dashboard.tsx:224-225`. (AND-`canAccessAdminPanel` part is drift: F-5.)
- [x] Frontend gating treated as UX-only; backend independently RBAC-checks — comment at `Dashboard.tsx:220-223` ("The backend independently 403s the data"); AdminPage header asserts the same (`AdminPage.tsx:5-7`).
- [x] `RoleGuard` available for component gating — `src/components/common/RoleGuard.tsx:44-67` plus `AdminOnly` (`:94-100`).
- [x] Admin API calls fail gracefully on 403 — each tab wraps `adminApi.*` in try/catch surfacing `extractErrorMessage` (e.g. `AdminPage.tsx:69-71`, `:136-138`, `:292-293`).
- [x] No admin-only data prefetched for non-admins — tabs fetch in `useEffect` only after `AdminPage` mounts, which only mounts for `selectedCategory === 'Admin'` past the role gate.

### 9. Rate Limiting
- [x] Permanent delete rate limited via `sensitiveLimiter` (only admin route with endpoint-specific limiter) — `adminRoutes.ts:468`; no other admin route declares a limiter (read of full file).
- [x] Limiters backed by `rateLimitStore.ts` (Redis via `REDIS_URL`, in-memory fallback) — `sensitiveLimiter` uses `store: createRateLimitStore('sensitive')` (`rateLimiter.ts:93`); store comment documents per-instance MemoryStore fallback (`rateLimiter.ts:7-14`).

## Unverifiable
- Initial ADMIN bootstrap (Question 3 — seed/manual DB write in admin context): no seed/bootstrap script was located under the admin files named by the spec; the self-elevation trigger does block a non-admin session from creating one, but the actual creation mechanism is outside this prompt's file list and not confirmed here.
- 7-year retention cleanup is admin-triggerable only via `AUDIT_CLEANUP_TOKEN` (Question 1): `startAuditCleanup` defers to a Cloud Scheduler token path (`auditLog.ts:587`), but the `/internal/audit-cleanup` route + token check itself is outside the admin files reviewed and is covered by the logging/observability prompt, not confirmed here.
- Whether admin limits "survive multi-instance Cloud Run scaling" (checklist 9): depends on `REDIS_URL` being set in the deployed environment; `createRateLimitStore` returns undefined (MemoryStore, per-instance) when unset (`rateLimiter.ts:7-14`). Runtime env not inspectable from source.

## Out of scope
- `SystemConfig` model (`schema.prisma:487-499`): exists but is unwired to any admin route (Grep found no admin handler touching it); the spec explicitly defers it until config-management endpoints are added.
- The list/stats/user-update/audit-log routes relying on the global `standardLimiter` rather than a dedicated admin limiter (checklist 9 "Gap to assess"): noted as a hardening opportunity (see F-6 for the audit-log case); a full rate-limit-tuning pass belongs to the rate-limiting prompt.
- Encryption-service internals, RLS policy SQL, and JWT secret validation: covered by their own prompts (02-encryption, RLS migration review, auth review); only their admin-relevant call sites were verified here.
- The 8 moderate npm advisories are general dependency hygiene (transitive, off the admin path) — recorded as Info F-7, not actioned as an admin-security finding.
