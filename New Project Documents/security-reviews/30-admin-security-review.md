# Admin Panel Security Review — 2026-06-16

Scope: `prompts/30-admin-security.md` checklist, executed against live code at HEAD `fb2cd32`.
Method: every checklist item verified by reading the actual source (no tick without a `file:line` proof). Findings ranked by exploitability × blast radius per `prompts/_review-protocol.md`.

Bottom line: the admin surface is one of the strongest-defended areas of the codebase. Authorization is layered (router-level RBAC + demo block + DB self-elevation trigger + FORCE RLS), every handler audits read and write access, PHI snapshot columns are withheld from the wire, and admin mutations correctly revoke the target's sessions and stamp the cross-instance access-token cutoff. **No Critical, High, or Medium finding has a real exploit path.** The findings below are Low/hardening items, several of which the prompt already flags as "gaps to assess."

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 4 |

## Findings

### F-1 — Multi-instance rate-limit ceiling on destructive admin ops depends on `REDIS_URL` — **Low**
- **Location:** `backend/src/middleware/rateLimiter.ts:56-64,151-174`; applied at `backend/src/routes/adminRoutes.ts:502`.
- **Observation:** `DELETE /users/:id/permanent` is the only admin route with an endpoint-specific limiter (`sensitiveLimiter`, 10/hour, keyed by user id). The store defaults to an in-process `MemoryStore` and only becomes a shared Redis store when `REDIS_URL` is set (`createRateLimitStore('sensitive')` returns `undefined` otherwise). On Cloud Run with N replicas and no `REDIS_URL`, the effective ceiling for a single admin is N×10/hour because each instance keeps its own counter.
- **Impact:** A compromised/rogue admin (already the highest privilege) could permanently delete more users per hour than the intended 10 by spreading requests across replicas. Blast radius is bounded — the actor must already be ADMIN, every delete is audited as `PERMANENT_DELETE` before deletion (`adminRoutes.ts:554-566`), and the cap is a throttle, not an authorization boundary. The code comment at `rateLimiter.ts:56-64` already documents the N×limit behaviour as accepted (audit #37).
- **Fix:** Provision Cloud Memorystore and set `REDIS_URL` in the backend Cloud Run service so all 8 limiters share counters across instances. No code change required — the store wiring already supports it.
- **Evidence:**
  ```ts
  // STORE: in-process MemoryStore by default → per-instance counters, so on
  // Cloud Run with N instances the effective ceiling is N×limit (audit #37).
  ```

### F-2 — Expensive admin read routes rely only on the global limiter — **Low**
- **Location:** `backend/src/routes/adminRoutes.ts:42` (`GET /users`), `:860` (`GET /stats`), `:953` (`GET /audit-logs`); global limiter at `backend/src/app.ts:220`.
- **Observation:** Only `DELETE /users/:id/permanent` carries a dedicated limiter. `GET /audit-logs` runs a `findMany` + `count` over the 7-year `audit_logs` table (with per-row metadata decryption — `adminRoutes.ts:1028-1032`) and `GET /stats` runs 7 aggregate queries per call (`:877-899`); both are throttled only by the global `standardLimiter` (`RATE_LIMIT_MAX_REQUESTS`, default 100/window). This is the prompt's own "gap to assess" (checklist §9).
- **Impact:** An authenticated admin could issue up to ~100 audit-log or stats queries per window per replica, each non-trivial DB work. No PHI exposure (the audit route withholds `previousValueEncrypted`/`newValueEncrypted`, `:1000-1021`) and lookback is capped to 1 year route-side (`:971-989`), so this is a DoS/cost-hygiene concern against a privileged actor, not a data-exposure path.
- **Fix:** Apply `sensitiveLimiter` (or a tuned `bulkOperationLimiter`) to `GET /audit-logs` and `GET /stats`, keyed by `req.user.id` as `sensitiveLimiter` already is (`rateLimiter.ts:164-168`).
- **Evidence:**
  ```ts
  router.get('/audit-logs', validate(schemas.admin.auditLogQuery, 'query'), asyncHandler(async (req, res) => {
  ```

### F-3 — Admin list/audit query schemas are not `.strict()` — **Low**
- **Location:** `backend/src/middleware/validation.ts:880-896` (`listUsersQuery`, `auditLogQuery`).
- **Observation:** The provider-relationship update schema correctly uses `.strict()` to reject unknown keys (`validation.ts:915-921`, M-3), but `listUsersQuery` and `auditLogQuery` do not. Unknown query parameters are silently ignored rather than rejected.
- **Impact:** Not exploitable as written — both handlers build their Prisma `where` from an explicit allowlist of named fields (`adminRoutes.ts:53-58`, `:974-989`), so an unknown param can't reach the query. This is a defense-in-depth/consistency gap: a future handler change that started spreading `req.query` would inherit a parameter-smuggling surface that `.strict()` would have closed. Pure hygiene.
- **Fix:** Add `.strict()` to `listUsersQuery` and `auditLogQuery` for parity with `updateProviderRelationship`. Note Zod `.strict()` on a schema with `.transform()`-bearing fields still rejects unrecognized keys at parse time, so this is safe to add.
- **Evidence:**
  ```ts
  auditLogQuery: z.object({
    userId: uuid.optional(),
    action: z.string().max(100).optional(),
    // ... no .strict()
  }),
  ```

### F-4 — `blockDemoRoleChange` is dead on the admin path (no impact; the harder block is mounted) — **Low (prompt drift / dead-code note)**
- **Location:** `backend/src/middleware/demoProtection.ts:43-60`; admin router chain at `backend/src/routes/adminRoutes.ts:30-32`.
- **Observation:** The admin router mounts `authenticate → blockDemoAdminAccess → requireRole('ADMIN')`. `blockDemoAdminAccess` (`demoProtection.ts:67-78`) hard-rejects any demo account from the entire admin surface before the role check, so the more granular `blockDemoRoleChange` (which only blocks demo from setting a non-PATIENT role) is never reached on admin routes. The checklist item "`blockDemoRoleChange` blocks demo users from setting any non-PATIENT role" (§6) is satisfied by the strictly stronger `blockDemoAdminAccess` on this path; `blockDemoRoleChange` would only matter on a hypothetical non-admin self-service role endpoint, which does not exist (settings/profile schemas do not accept `role` — verified at `settingsController.ts`, no `role` write).
- **Impact:** None — security is intact (the broader block subsumes it). Flagged so the next prompt refresh notes that `blockDemoRoleChange` is currently unmounted, to avoid a false sense that it is actively guarding the admin path.
- **Fix:** No security change needed. Optionally, document `blockDemoRoleChange` as reserved for a future self-service role endpoint, or remove it if that endpoint is never planned (cf. the L-26 cleanup of unmounted rbac helpers).
- **Evidence:**
  ```ts
  router.use(authenticate);
  router.use(blockDemoAdminAccess);   // rejects ALL demo admin access here
  router.use(requireRole('ADMIN'));
  ```

## Checks passed

### 1. Route Authorization
- [x] All admin routes require `requireRole('ADMIN')` — applied router-wide at `adminRoutes.ts:32` (no per-route override loosens it).
- [x] Admin routes registered AFTER authentication — `router.use(authenticate)` precedes everything at `adminRoutes.ts:30`.
- [x] No admin endpoint accessible without authentication — every handler is under the `router.use(authenticate)` chain; mounted at `routes/index.ts:92` (`/api/v1/admin`).
- [x] No admin endpoint accessible by PATIENT/PROVIDER — `requireRole('ADMIN')` rejects any non-ADMIN role (`rbac.ts:70-72`); reads `req.user.role` from the verified JWT, not a cache.
- [x] Middleware not bypassable via parameter manipulation — RBAC keys off the JWT-derived `req.user.role` (`rbac.ts:68`), not any request param/body.

### 2. User Management Security
- [x] `GET /users` paginated, limit capped at 100, `select` excludes credentials, supports role/isActive/search filters — `adminRoutes.ts:47-98` (no `passwordHash`/encryption-key columns in the select; `limit = Math.min(100, ...)` at `:48`).
- [x] `GET /users/:id` returns no credentials, UUID validated — `validate(schemas.uuidParam, 'params')` at `:138`; select at `:148-167` carries no `passwordHash`/keys.
- [x] `POST /users` validates via `schemas.admin.createUser` (strong password), bcrypt with `config.security.bcryptRounds`, rejects duplicate email inside the tx — `:208,214,220-224`.
- [x] `PATCH /users/:id` role change logged as `PERMISSION_CHANGE` with previous/new role, runs in admin RLS context — `:367-368,391`, `withRLSContext(null, ..., {isAdmin:true})` at `:300,345`.
- [x] `PATCH /users/:id` consent-bearing change (`mustRevoke = !!password || roleChanged || deactivated`) wipes all target sessions in the same admin tx AND stamps `tokensValidAfter`, surfaces `revokedSessionCount` — `:317-343,390`.
- [x] `DELETE /users/:id` (soft delete) sets `isActive=false` AND deletes all sessions atomically — `:470-483`.
- [x] `DELETE /users/:id/permanent` requires `confirmEmail` matching target, rate-limited via `sensitiveLimiter`, logged as `PERMANENT_DELETE` before deletion — `:502-504,542-566`.
- [x] `PATCH /users/:id/plan` assigns FREE/PRO/TEAM + optional `expiresAt`, logged as `PLAN_CHANGE` with previous/new plan — `:598-669`.
- [x] Admin cannot delete own account — blocked in both `DELETE /users/:id` (`:417-426`) and `/permanent` (`:514-523`).
- [x] Admin cannot modify own role — `if (id === adminId && role) throw ForbiddenError` at `:283-285`.
- [x] Role assignment restricted to `UserRole` enum by Zod — `z.enum(['PATIENT','PROVIDER','ADMIN'])` in `createUser`/`updateUser` (`validation.ts:868,874`).

### 3. Audit Log Access
- [x] Admin can view audit logs with date/user/action/resource filters — `:960-989`.
- [x] Audit-log viewing is itself audited — `admin_audit_logs` VIEW meta-audit at `:1040-1051`.
- [x] PHI in audit logs encrypted at rest; route decrypts `metadataEncrypted` for the authorized view and strips ciphertext; PHI snapshot columns excluded from select — `:1000-1032`; `decryptMetadata` uses the system salt (`auditLog.ts:275-288,179`).
- [x] Audit logs cannot be modified/deleted by admin — no mutation route exists; FORCE RLS on `audit_logs` + `audit_logs_delete USING (is_admin_session() AND created_at < now() - interval '7 years')` (`20260613_force_rls_and_audit_retention/migration.sql:25,41-44`).
- [x] Pagination enforced on audit queries — `skip`/`take` with `limit` capped to 200 by schema (`validation.ts:895`); used at `:998-999`.
- [x] Date range bounded — route-side `MAX_LOOKBACK_MS = 1 year` floor always pins a `gte`, even with no `startDate` (`:971-989`).

### 4. System Statistics
- [x] Stats endpoint returns aggregates only (counts/groupBy) — `:877-928`.
- [x] No individual user PHI in stats — only `count`/`groupBy(role)`/active/recent-login counts; no PHI columns selected.
- [x] No PII (names/emails) in stats response — response shape `users.{total,active,byRole,recentLogins}` + data counts (`:913-928`).
- [x] Queries are bounded aggregate `count`/`groupBy` (no per-row PHI scan); all share one admin tx (`:866-911`).

### 5. Privilege Escalation Prevention
- [x] No PATIENT/PROVIDER→ADMIN path without an admin-context DB write — role changes only via `PATCH /admin/users/:id` under `{isAdmin:true}`; self-service endpoints do not accept `role` (settingsController has no `role` write).
- [x] Role field not modifiable via non-admin API — `updateUser`/profile schemas; the DB trigger blocks it even via direct row update.
- [x] DB trigger `users_prevent_self_privilege_change` fires `BEFORE UPDATE OF role, is_active` and rejects non-admin sessions — `20260424_prevent_self_role_elevation/migration.sql:41-49,59-62`.
- [x] Trigger admin bypass keys off `is_admin_session()` — `migration.sql:34`; `is_admin_session()` reads `app.is_admin` defaulting false (`20260107_add_rls_policies/migration.sql:28-36`); only `withRLSContext(..., {isAdmin:true})` sets it (`database.ts:425-427`), used solely by admin routes.
- [x] `requireRole('ADMIN')` reads `req.user.role` from the verified JWT each request, no cross-request caching — `rbac.ts:68-72`.
- [x] Admin mutations revoke target access on ANY consent-bearing change (`mustRevoke = !!password || roleChanged || deactivated`) + soft-delete stamps `tokensValidAfter` — `adminRoutes.ts:317-321,478`.
- [x] Cross-instance access-token revocation wired — `tokensValidAfter` stamp followed by `invalidateTokensValidAfterCache(id)` at `:363` and `:485`; `authenticate()` rejects pre-cutoff tokens on every replica via `isAccessTokenStale` (`auth.ts:106-108`; `authService.ts:299-326`).
- [x] No hidden admin routes via enumeration — all live under `/api/v1/admin` (`routes/index.ts:92`); handlers inline in `adminRoutes.ts` (no separate controller).

### 6. Demo Account Protections
- [x] `blockDemoAdminAccess` runs before `requireRole('ADMIN')` — `adminRoutes.ts:31-32`.
- [x] Demo cannot set non-PATIENT role on the admin path — subsumed by `blockDemoAdminAccess` (see F-4); `blockDemoRoleChange` itself implements the rule at `demoProtection.ts:53-57`.
- [x] `isDemoAccount` returns false when `DEMO_EMAIL` unset/empty — `demoProtection.ts:34`.
- [x] Demo restrictions enforced at backend — middleware in the router chain, not frontend-only.

### 7. Admin Action Audit Trail
- [x] User creation logged via `logCreate('admin_user', ...)` with role/isActive/emailVerified — `:248-258`.
- [x] User update logged via `logUpdate('admin_user', ...)` with previous/new + `passwordChanged` — `:371-392`.
- [x] Role changes logged with `operation: 'PERMISSION_CHANGE'` + previousRole/newRole — `:367-368,391`.
- [x] Plan changes logged with `operation: 'PLAN_CHANGE'` + previousPlan/newPlan — `:662-668`.
- [x] Deactivation logged (`admin_user_status`, DEACTIVATE); permanent delete via `logDelete` BEFORE delete — `:448-461`, `:554-566`.
- [x] List/detail views logged (`admin_user_list`/`admin_user_detail`) — `:102-111`, `:186-192`; failed lookups logged with `success:false` (`:176-181`).
- [x] Provider-relationship list/update logged; PATCH validated with strict schema; M-3 re-consent gate fails closed; `canEditData` ignored (L-37) — `:708-713`, `:733`, `:758,771-778,806-821`, `:738-742,786`.
- [x] Audit-log access itself logged (`admin_audit_logs`, VIEW) — `:1040-1051`.
- [x] System-stats views logged (`admin_system_stats`, VIEW) — `:932-935`.

### 8. Frontend Admin Security
- [x] `AdminPage` lazy-loaded in `Dashboard.tsx` — `lazy(() => import('../admin/AdminPage'))` at `Dashboard.tsx:55`.
- [x] Admin nav gated by `roles: ['ADMIN']`, resolved via role — `sampleData.ts:237`; nav filtered by `c.roles.includes(role)` at `Dashboard.tsx:135`. `useRBAC` exposes only role helpers (no capability-flags object) — `useRBAC.ts:23-29,81-88`.
- [x] Frontend gating is UX-only with independent server RBAC — AdminPage header comment asserts it (`AdminPage.tsx:4-6`); render-site role recheck at `Dashboard.tsx:248-268` shows an access notice for deep-link access (defense beyond nav hide).
- [x] `RoleGuard` available for component gating — `src/components/common/RoleGuard.tsx:55-120`, exported via barrel (`common/index.ts:5-11`).
- [x] Admin API calls fail gracefully on 403 — `adminApi` uses `apiFetch`; AdminPage routes errors through `extractErrorMessage` + `onError` notify, not a crash (`AdminPage.tsx:35,70`).
- [x] No admin-only data prefetched for non-admins — admin fetches are inside AdminPage's own `useEffect`s, which only mount when the ADMIN-gated 'Admin' category is selected (`Dashboard.tsx:249,336-341`).

### 9. Rate Limiting
- [x] Permanent delete rate-limited via `sensitiveLimiter` (only admin route with a dedicated limiter) — `adminRoutes.ts:502`.
- [x] Gap assessed — list/stats/audit/update rely on the global `standardLimiter` (`app.ts:220`); see F-2.
- [x] Limiters backed by `rateLimitStore.ts` (Redis via `REDIS_URL`, in-memory fallback) — `rateLimiter.ts:8,67,152`; multi-instance posture caveat captured in F-1.

## Unverifiable
- Whether `REDIS_URL` is actually configured in the production Cloud Run service (determines if F-1/F-3 multi-instance ceiling is live). The code supports a shared store; the runtime env is not in-repo. Confirm via `gcloud run services describe` if needed.
- Initial ADMIN account bootstrap (Question 3): no seed script for an ADMIN was located in the admin/auth code read for this review. The self-elevation trigger means a non-admin session cannot create one, so the first ADMIN must come from an out-of-band admin-context write or migration not examined here. Not a finding — noted for completeness.
- Step-up verification / IP allowlisting for admin sessions (Question 6): none observed in the admin path. Absence is a design choice, not a defect against this checklist; access tokens are short-lived (15 min) and admin actions are fully audited.

## Out of scope
- `SystemConfig` model: present in the schema but NOT wired to any admin route (verified — only test/config/auditLog references via Grep; no handler in `adminRoutes.ts`). Per the prompt, re-run this review if config-management endpoints are added (they will need their own RBAC + audit + PHI handling for any `isEncrypted` field).
- General RLS/encryption correctness, provider-collaboration resource scoping (`services/providerAccess.ts`), and the broader auth/session lifecycle — covered by their dedicated review prompts; only the admin-touching seams were verified here.
- `has_provider_access()` dead `can_view_dna` reference: already remediated in `20260529_fix_has_provider_access/migration.sql` (the live function is clean). Mentioned only to confirm it is NOT an open issue for the admin provider-relationship feature.
