# API Routes Security Audit Report

**Project:** OwnMyHealth
**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6
**Scope:** All files in `backend/src/routes/`, `backend/src/controllers/`, `backend/src/middleware/`, and `backend/src/app.ts`
**Severity Scale:** CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Executive Summary

The OwnMyHealth API demonstrates a generally strong security posture with layered authentication, RBAC enforcement, Zod input validation, PHI encryption, and HIPAA audit logging. However, several findings require attention:

- **2 HIGH findings:** Missing RLS context in multiple controllers; IDOR vulnerability in expense controller
- **3 MEDIUM findings:** Excessive CSRF bypasses; debug logging in production; missing input validation on expense routes
- **4 LOW findings:** Missing pagination on some endpoints; inconsistent asyncHandler usage; demo protection not applied to all routes

---

## Route Inventory

All 13 expected route files are present:

| File | Mount Path | Routes |
|------|-----------|--------|
| `authRoutes.ts` | `/api/v1/auth` | 12 endpoints |
| `biomarkerRoutes.ts` | `/api/v1/biomarkers` | 10 endpoints |
| `fileRoutes.ts` | `/api/v1/files` | 4 endpoints |
| `uploadRoutes.ts` | `/api/v1/upload` | 3 endpoints |
| `insuranceRoutes.ts` | `/api/v1/insurance` | 9 endpoints |
| `expenseRoutes.ts` | `/api/v1/expenses` | 6 endpoints |
| `healthGoalsRoutes.ts` | `/api/v1/health-goals` | 8 endpoints |
| `healthNeedsRoutes.ts` | `/api/v1/health-needs` | 6 endpoints |
| `providerRoutes.ts` | `/api/v1/provider` | 6 endpoints |
| `patientRoutes.ts` | `/api/v1/patient` | 7 endpoints |
| `adminRoutes.ts` | `/api/v1/admin` | 9 endpoints |
| `settingsRoutes.ts` | `/api/v1/settings` | 3 endpoints |
| `index.ts` | `/api/v1` | 2 endpoints (health, info) |

**Total: ~85 endpoints across 13 route files.**

---

## 1. Route Authentication

### 1.1 authRoutes.ts

[x] **PASS** - Public routes (login, register, refresh, verify-email, forgot-password, reset-password, demo, resend-verification) are correctly unauthenticated. Protected routes (logout, logout-all, me, change-password) use `authenticate` middleware.

- **File:** `backend/src/routes/authRoutes.ts`
- **Details:** `router.use(authLimiter)` applies rate limiting to all auth routes (line 32). Login and forgot-password additionally use `strictAuthLimiter` (lines 48, 76). Registration and login use Zod `validate()` middleware. `authenticate` is applied per-route on lines 93, 96, 99, 103.

### 1.2 biomarkerRoutes.ts

[x] **PASS** - All routes protected via `router.use(authenticate)` at line 34.

- **File:** `backend/src/routes/biomarkerRoutes.ts:34`
- **Details:** Authentication applied at router level. All 10 endpoints (GET /, GET /summary, GET /categories, GET /:id, GET /:id/history, POST /, POST /batch, PATCH /:id, DELETE /:id, POST /:id/guidance) inherit auth.

### 1.3 fileRoutes.ts

[x] **PASS** - All routes protected via `router.use(authenticate)` at line 26.

- **File:** `backend/src/routes/fileRoutes.ts:26`

### 1.4 uploadRoutes.ts

[x] **PASS** - All routes protected. `authenticate` is applied per-route (lines 77, 92, 118) rather than at router level. Rate limiting via `router.use(uploadLimiter)` at line 23.

- **File:** `backend/src/routes/uploadRoutes.ts:23,77,92,118`

### 1.5 insuranceRoutes.ts

[x] **PASS** - All routes protected via `router.use(authenticate)` at line 61.

- **File:** `backend/src/routes/insuranceRoutes.ts:61`

### 1.6 expenseRoutes.ts

[x] **PASS** - All routes protected via `router.use(authenticate)` at line 22.

- **File:** `backend/src/routes/expenseRoutes.ts:22`

### 1.7 healthGoalsRoutes.ts

[x] **PASS** - All routes protected via `router.use(authenticate)` at line 41.

- **File:** `backend/src/routes/healthGoalsRoutes.ts:41`

### 1.8 healthNeedsRoutes.ts

[x] **PASS** - All routes protected via `router.use(authenticate)` at line 37.

- **File:** `backend/src/routes/healthNeedsRoutes.ts:37`

### 1.9 providerRoutes.ts

[x] **PASS** - All routes require `authenticate` AND `requireRole('PROVIDER', 'ADMIN')`.

- **File:** `backend/src/routes/providerRoutes.ts:23-24`
- **Details:** `router.use(authenticate)` at line 23, `router.use(requireRole('PROVIDER', 'ADMIN'))` at line 24.

### 1.10 patientRoutes.ts

[x] **PASS** - All routes require `authenticate` AND `requireRole('PATIENT')`.

- **File:** `backend/src/routes/patientRoutes.ts:21-23`

### 1.11 adminRoutes.ts

[x] **PASS** - All routes require `authenticate` AND `requireRole('ADMIN')`.

- **File:** `backend/src/routes/adminRoutes.ts:25-26`

### 1.12 settingsRoutes.ts

[x] **PASS** - All routes protected via `router.use(authenticate)` at line 32.

- **File:** `backend/src/routes/settingsRoutes.ts:32`

---

## 2. Authorization (Beyond Authentication)

### 2.1 Users can only access their own resources

[~] **PARTIAL** - Most controllers correctly scope queries to the authenticated user's ID, but the expense controller has an IDOR vulnerability.

**FINDING (HIGH) - IDOR in expenseController.ts:**

- `updateProjection` (line 150): `prisma.expenseProjection.update({ where: { id } })` -- does NOT include `userId` in the where clause. An authenticated user could update any other user's expense projection by guessing/knowing the ID.
  - **File:** `backend/src/controllers/expenseController.ts:150`
- `deleteProjection` (line 184): Same issue -- `prisma.expenseProjection.delete({ where: { id } })` without `userId` scope.
  - **File:** `backend/src/controllers/expenseController.ts:184`
- `updateCurrentSpending` (line 219): `prisma.insurancePlan.update({ where: { id } })` without verifying the plan belongs to the authenticated user.
  - **File:** `backend/src/controllers/expenseController.ts:219`
- `analyzeCosts` (line 264): `prisma.insurancePlan.findUnique({ where: { id: planId } })` does NOT filter by `userId`, allowing a user to trigger AI analysis on another user's plan.
  - **File:** `backend/src/controllers/expenseController.ts:264`

**Correctly scoped controllers (PASS):**
- `biomarkerController.ts`: All queries use `where: { id, userId }` or `where: { userId }` (e.g., lines 123, 197, 292, 377, 413).
- `fileController.ts`: All queries use `where: { id, userId }` or `where: { userId }` (e.g., lines 49, 108, 181, 229).
- `insuranceController.ts`: All queries use `where: { id, userId }` or `where: { userId }` (e.g., lines 474, 606, 699, 737, 826).
- `healthGoalsController.ts`: All queries use `where: { id, userId }` or `where: { userId }`.
- `healthNeedsController.ts`: All queries use `where: { id, userId }` or `where: { userId }`.
- `settingsController.ts`: All queries scoped to `userId` from JWT.
- `providerRoutes.ts`: Uses `providerId = req.user!.id` and verifies relationship before accessing patient data.
- `patientRoutes.ts`: Uses `patientId = req.user!.id` and verifies relationship ownership with `where: { id, patientId }`.

### 2.2 userId from JWT used (not from request body)

[x] **PASS** - All controllers extract `userId` from `req.user!.id` which is set by the JWT `authenticate` middleware.

- **Evidence:** Every controller starts with `const userId = req.user!.id` (e.g., `biomarkerController.ts:109`, `fileController.ts:43`, `insuranceController.ts:417`, `settingsController.ts:76`, `expenseController.ts:40`).

### 2.3 No IDOR vulnerabilities

[ ] **FAIL** - The expense controller has 4 IDOR vulnerabilities as documented in section 2.1 above.

---

## 3. Input Validation

### 3.1 Request body validated before processing

[~] **PARTIAL**

**Validated (PASS):**
- `authRoutes.ts`: Login, register, change-password, forgot-password, reset-password, resend-verification all use `validate(schemas.auth.*)`.
- `biomarkerRoutes.ts`: Create, update, batch create, list query all validated with Zod schemas.
- `insuranceRoutes.ts`: Create, update, compare, benefit search all validated.
- `healthGoalsRoutes.ts`: Create, update, updateProgress, list query all validated.
- `healthNeedsRoutes.ts`: Create, update, list query all validated.
- `providerRoutes.ts`: Request, approve, update permissions all validated.
- `patientRoutes.ts`: Approve, update permissions validated.
- `adminRoutes.ts`: Create user, update user, list users query, audit log query all validated.

**FINDING (MEDIUM) - Missing Zod validation on expense routes:**
- `expenseRoutes.ts` does NOT use `validate()` middleware on any route. All 6 endpoints rely on ad-hoc validation in the controller (e.g., `if (!planId || !serviceType)` at `expenseController.ts:45`).
  - **File:** `backend/src/routes/expenseRoutes.ts:29-48`
  - **Impact:** Inconsistent with the rest of the codebase. Missing type checking, sanitization, and length limits. The `serviceType`, `notes`, and `estimatedCost` fields are not validated for type or length before encryption.

### 3.2 URL parameters validated (UUIDs, enums)

[~] **PARTIAL**

- Most routes validate `:id` params with `validate(schemas.uuidParam, 'params')`.
- `providerRoutes.ts` uses `validate(schemas.patientIdParam, 'params')` for `:patientId`.
- **Gap:** `expenseRoutes.ts` does not validate `:id` parameter on PUT/DELETE routes.
- **Gap:** `settingsRoutes.ts` has no URL params to validate (N/A).

### 3.3 Query parameters sanitized

[x] **PASS** - Routes that accept query parameters use Zod validation:
- `biomarkerRoutes.ts:39`: `validate(schemas.biomarker.listQuery, 'query')`
- `insuranceRoutes.ts:108`: `validate(benefitSearchSchema, 'query')`
- `healthGoalsRoutes.ts:52`: `validate(schemas.healthGoal.listQuery, 'query')`
- `healthNeedsRoutes.ts:42`: `validate(schemas.healthNeed.listQuery, 'query')`
- `adminRoutes.ts:38,460`: List users and audit log queries validated.
- `authRoutes.ts:63`: Verify-email query validated.

### 3.4 File uploads validated (type, size)

[x] **PASS** - Multer configured with strict file filters and size limits.

- `uploadRoutes.ts:28-41`: PDF-only filter, 10MB limit, single file.
- `uploadRoutes.ts:44-66`: OCR upload accepts PDF + images, 10MB limit.
- `insuranceRoutes.ts:35-48`: Separate multer config for SBC uploads with same restrictions.
- `uploadController.ts:71-92`: `validateUploadFile()` provides additional server-side validation of MIME type and file size.

---

## 4. Error Responses

### 4.1 Generic error messages to client

[x] **PASS** - The centralized `errorHandler` in `backend/src/middleware/errorHandler.ts:147` uses a generic `GENERIC_ERROR_MESSAGE` ("An unexpected error occurred. Please try again later.") for unknown errors in production. AppError subclasses provide safe, pre-defined messages.

### 4.2 Detailed errors logged server-side

[x] **PASS** - Server-side logging includes full error details:
- `errorHandler.ts:194-199`: 500+ errors always logged with full details. Client errors logged in development only.
- `biomarkerController.ts:550-556`: Database errors logged with context but generic message returned to client.

### 4.3 No stack traces in production responses

[x] **PASS** - Stack traces are conditionally included only in development:
- `errorHandler.ts:210`: `...(config.isDevelopment ? { stack: err.stack } : {})`

### 4.4 No database error details leaked

[x] **PASS** - Prisma errors are mapped to safe messages via `handlePrismaError()` at `errorHandler.ts:108-123`. Raw Prisma error codes are never exposed to the client.

**Minor note:** `insuranceController.ts:228` uses `console.error` with plan ID in decryption failure messages. This is server-side only but should use the structured logger instead.

---

## 5. HTTP Methods

### 5.1 Correct methods used

[x] **PASS** - HTTP methods are semantically correct throughout:
- GET for reads (list, detail, summary, history, suggestions, download)
- POST for creates and actions (create, batch, guidance, compare, analyze, approve, deny, revoke, request)
- PUT for full updates (update projection, reanalyze, spending)
- PATCH for partial updates (update biomarker, update plan, update permissions, update progress)
- DELETE for deletions (delete biomarker, plan, file, goal, need, account, data)

### 5.2 No sensitive operations on GET endpoints

[~] **PARTIAL**

**FINDING (LOW):** `GET /api/v1/auth/verify-email?token=xxx` performs a state-changing operation (marks email as verified) via GET. This is a common pattern for email verification links clicked from email clients, but it technically violates REST semantics. The risk is mitigated because the token is single-use.

- **File:** `backend/src/routes/authRoutes.ts:60-64`

All other GET endpoints are read-only.

### 5.3 DELETE endpoints require confirmation or are idempotent

[x] **PASS**

- `DELETE /admin/users/:id/permanent` requires `confirmEmail` in the body matching the user's email (line 310).
- `DELETE /settings/delete-account` requires password verification (`settingsController.ts:264`).
- `DELETE /settings/delete-data` does not require confirmation -- this is acceptable as it only deletes health data, not the account.
- All other DELETE endpoints are idempotent (deleting a non-existent resource returns 404).

---

## 6. Response Security

### 6.1 No sensitive data in responses

[x] **PASS** - No passwords, tokens, encryption keys, or secrets are returned in API responses.

- `authController.ts:132-138`: `formatUserResponse()` returns only `id`, `email`, `role`.
- Password hashes are never included in user responses.
- Access tokens are set in HttpOnly cookies, not response bodies (except the refresh endpoint which returns an access token for SPA storage).
- `adminRoutes.ts:57-64`: User listing excludes `passwordHash`.

### 6.2 PHI decrypted only when needed

[x] **PASS** - PHI fields are stored encrypted and only decrypted at response time:

- `biomarkerController.ts:53-101`: `toResponse()` decrypts value and notes per-request.
- `insuranceController.ts:212-409`: `toResponse()` decrypts memberId and groupNumber per-request.
- `healthNeedsController.ts:39-55`: `toResponse()` decrypts description per-request.
- `healthGoalsController.ts:64-119`: `toResponse()` decrypts description per-request.
- `expenseController.ts:73-78,109-114`: Decrypts serviceType, estimatedCost, notes per-request.
- `settingsController.ts:84-108`: Export function decrypts all PHI within RLS context.
- `biomarkerController.ts:669-678`: Summary endpoint does NOT decrypt values (only needs isOutOfRange flag).

### 6.3 Pagination on list endpoints

[~] **PARTIAL**

**Paginated (PASS):**
- `biomarkerRoutes.ts`: Uses `parsePagination()` with default limit 50, max 100.
- `insuranceController.ts`: Uses `parsePagination()` with default limit 20, max 100.
- `adminRoutes.ts` users list: Paginated with default 20, max 100 (line 42).
- `adminRoutes.ts` audit logs: Paginated with default 50, max 200 (line 464).
- `biomarkerController.ts:767`: History endpoint has limit parameter with max 1000.
- `adminRoutes.ts` provider-relationships: Limited to `take: 100` (line 346).

**FINDING (LOW) - Missing pagination:**
- `fileController.ts:48`: `getFiles()` returns ALL files for user with no pagination.
- `healthGoalsController.ts:177`: `getHealthGoals()` returns all goals with no pagination (though limited by `take: 10` on progressHistory sub-query).
- `healthNeedsController.ts:85`: `getHealthNeeds()` returns all needs with no pagination.
- `expenseController.ts:100`: `getProjections()` returns all projections with no pagination.
- `expenseController.ts:365`: `getAnalyses()` limited to `take: 10` but no user-configurable pagination.

These are lower risk because they are user-scoped (each user has limited data), but could become a concern with heavy users.

---

## 7. Role-Based Route Protection

### 7.1 Provider routes enforce requireRole('PROVIDER', 'ADMIN')

[x] **PASS** - `backend/src/routes/providerRoutes.ts:24` applies `router.use(requireRole('PROVIDER', 'ADMIN'))`.

### 7.2 Patient consent routes enforce requireRole('PATIENT')

[x] **PASS** - `backend/src/routes/patientRoutes.ts:23` applies `router.use(requireRole('PATIENT'))`.

**Note:** This means PROVIDERs and ADMINs cannot manage consent on behalf of a patient, which is the correct security posture. Only patients can approve/deny/revoke provider access.

### 7.3 Admin routes enforce requireRole('ADMIN')

[x] **PASS** - `backend/src/routes/adminRoutes.ts:26` applies `router.use(requireRole('ADMIN'))`.

### 7.4 Role checked from JWT claims

[x] **PASS** - The `authenticate` middleware at `backend/src/middleware/auth.ts:63-75` extracts role from the JWT payload and attaches it to `req.user.role`. The `requireRole` middleware at `backend/src/middleware/rbac.ts:61-75` checks `req.user.role` against allowed roles.

**Note:** Roles are embedded in the JWT at token issuance time. If an admin changes a user's role, the old JWT remains valid until it expires (15 min). This is an acceptable tradeoff for the short access token lifetime.

### 7.5 Demo accounts blocked from sensitive operations

[~] **PARTIAL**

**FINDING (LOW) - Demo protection middleware exists but is not applied to routes:**

- `backend/src/middleware/demoProtection.ts` defines `demoProtection`, `blockDemoAdminAccess`, `blockDemoRoleChange`, and `blockDemoUserModification` middleware functions.
- However, **none of these middleware functions are imported or applied in any route file.** A grep for `demoProtection` usage in route files finds zero matches.
- The demo account is restricted by environment config (`config.demo.enabled` checked in `demoLogin`), and the demo user is created with `PATIENT` role. Since admin routes require `ADMIN` role, and the demo account is `PATIENT`, the demo user cannot access admin routes.
- However, if the demo account's role were ever changed (e.g., by an admin), the demo protection middleware would not catch it because it is not wired into any routes.

---

## 8. RLS Context

### 8.1 withRLSContext / withRLSTransaction used for all DB queries

[ ] **FAIL (HIGH)** - RLS context is used inconsistently across controllers.

**Using RLS (PASS):**
- `settingsController.ts:84`: `withRLSContext(userId, ...)` for export data.
- `settingsController.ts:220`: `withRLSContext(userId, ...)` for delete-data counts.
- `settingsController.ts:231`: `withRLSTransaction(userId, ...)` for delete-data operation.
- `settingsController.ts:272`: `withRLSContext(userId, ...)` for password verification.
- `settingsController.ts:296`: `withRLSContext(null, ...)` for user deletion (admin context).

**NOT using RLS (FAIL):**
- `biomarkerController.ts`: All queries use direct `prisma.biomarker.findMany({ where: { userId } })` without RLS context. While the application-level `where: { userId }` filter provides data isolation, it bypasses the database-level RLS policies, reducing defense-in-depth.
  - Lines: 135, 197, 292, 377, 413, 544, 669, 770, 859
- `fileController.ts`: No RLS context on any query. Direct Prisma calls with `where: { userId }`.
- `insuranceController.ts`: No RLS context. Direct Prisma calls with `where: { userId }`.
- `healthGoalsController.ts`: No RLS context. Direct Prisma calls with `where: { userId }`.
- `healthNeedsController.ts`: No RLS context. Direct Prisma calls with `where: { userId }`.
- `expenseController.ts`: No RLS context. Direct Prisma calls with `where: { userId }`.
- `uploadController.ts`: No RLS context. Direct Prisma calls.
- `providerRoutes.ts`: No RLS context. Direct Prisma calls.
- `patientRoutes.ts`: No RLS context. Direct Prisma calls.
- `adminRoutes.ts`: No RLS context. Direct Prisma calls (admin operations should use `withRLSContext(null, ...)` for explicit bypass).

**Impact:** The application-level `where: { userId }` filter means data is still isolated per-user in practice. However, skipping RLS context means a coding error that omits the userId filter would not be caught by database-level policies. The `settingsController.ts` demonstrates the intended pattern but other controllers have not been updated to match.

### 8.2 userId from JWT token (not request body)

[x] **PASS** - Already covered in section 2.2. All controllers use `req.user!.id`.

### 8.3 Admin operations use withRLSContext(null, ...)

[ ] **FAIL** - `adminRoutes.ts` does not use RLS context at all. Admin queries like `prisma.user.findMany()` at line 55 and `prisma.user.delete()` at line 315 should use `withRLSContext(null, ...)` to explicitly document the admin bypass.

### 8.4 Provider cross-user queries properly scoped

[x] **PASS** - Provider routes in `providerRoutes.ts` properly check:
1. Provider-patient relationship exists and is ACTIVE (lines 187-198, 260-275, 302-317).
2. Specific permission flags are checked (`canViewBiomarkers` at line 273, `canViewHealthNeeds` at line 316).
3. Consent expiration is checked in `rbac.ts:223` (`checkProviderPatientAccess`).

---

## 9. CSRF Protection

### 9.1 Global CSRF middleware applied

[x] **PASS** - `app.ts:161-163` applies `csrfProtection` middleware globally (unless `DISABLE_CSRF=true` in development).

### 9.2 CSRF validation on state-changing requests

[~] **PARTIAL**

**FINDING (MEDIUM) - Excessive CSRF bypass list:**

The CSRF middleware at `backend/src/middleware/csrf.ts:96-163` has an extensive list of routes that bypass CSRF validation:

1. **Public auth routes** (line 98-108): Correctly bypassed -- no session to protect yet.
2. **Upload routes** (line 112-117): Bypassed with comment "harder to exploit via CSRF." This is partially true for multipart/form-data but not a strong justification. Upload routes ARE authenticated and could be exploited if an attacker crafts a form submission.
3. **Settings routes** (line 121-125): `delete-data`, `delete-account`, `export-data` all bypass CSRF. The comment says "Bearer tokens are not automatically sent by browsers" -- but the app uses HttpOnly cookies for auth, which ARE automatically sent by browsers. This justification is incorrect.
4. **Bearer protected routes** (line 131-133): `/guidance` endpoint bypasses CSRF with same incorrect justification.
5. **Delete routes** (line 137-139): All DELETE on `/insurance/plans/` bypass CSRF with same incorrect justification.

**The core issue:** The app uses HttpOnly cookies for authentication (not just Bearer tokens). Since cookies are sent automatically by the browser on cross-origin requests (depending on SameSite policy), CSRF protection IS relevant. The SameSite cookie policy provides some protection, but in cross-domain deployments with `sameSite: 'none'`, CSRF tokens become critical.

**Additionally:** The `expenseRoutes.ts` file applies `csrfProtection` per-route (lines 32, 35, 38, 45) on POST/PUT/DELETE, which is correct and shows the intended pattern. But this is redundant with the global CSRF middleware in `app.ts` for routes that aren't on the bypass list.

---

## 10. Rate Limiting

### 10.1 Global rate limiting

[x] **PASS** - `app.ts:166` applies `standardLimiter` globally (100 requests per 15 minutes).

### 10.2 Endpoint-specific rate limiting

[x] **PASS** - Six named rate limiters are defined in `rateLimiter.ts`:

| Limiter | Window | Max | Applied To |
|---------|--------|-----|-----------|
| `standardLimiter` | 15 min | 100 | Global (app.ts:166) |
| `authLimiter` | 15 min | 20 | All auth routes (authRoutes.ts:32) |
| `strictAuthLimiter` | 15 min | 5 | Login, forgot-password (authRoutes.ts:48,76) |
| `uploadLimiter` | 1 hour | 20 | Upload routes, insurance upload/reanalyze |
| `sensitiveLimiter` | 1 hour | 10 | Admin permanent delete (adminRoutes.ts:291) |
| `bulkOperationLimiter` | 1 hour | 30 | Biomarker batch create (biomarkerRoutes.ts:80) |

**Note:** `strictAuthLimiter` uses `skipSuccessfulRequests: true` and keys by `email:ip`, which is good for brute-force protection.

---

## 11. Additional Findings

### 11.1 Debug logging in settingsRoutes.ts (MEDIUM)

**FINDING:** `settingsRoutes.ts:25-29` contains debug `console.log` statements that log request headers and user IDs:

```typescript
router.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[SETTINGS ROUTE] ${req.method} ${req.path}`);
  console.log(`[SETTINGS ROUTE] Headers: x-csrf-token=${req.headers['x-csrf-token'] ? 'present' : 'missing'}, authorization=${req.headers['authorization'] ? 'present' : 'missing'}`);
  next();
});
```

And at line 43-46:
```typescript
(req: Request, _res: Response, next: NextFunction) => {
  console.log('[DELETE-DATA] Handler reached after auth');
  console.log('[DELETE-DATA] User ID:', (req as AuthenticatedRequest).user?.id);
  next();
},
```

- **File:** `backend/src/routes/settingsRoutes.ts:25-29,43-46`
- **Impact:** Debug logging should not be in production code. User IDs in console.log bypass the structured logger and may not be captured by log aggregation systems. The authorization header presence check could reveal security-relevant information in shared logs.

### 11.2 Inconsistent asyncHandler usage in expenseRoutes.ts (LOW)

**FINDING:** `expenseRoutes.ts` does not use `asyncHandler` wrappers on route handlers. Instead, controllers use try/catch internally with manual `res.status(500).json()` responses. This is functional but inconsistent with all other route files and means unhandled promise rejections could crash the process.

- **File:** `backend/src/routes/expenseRoutes.ts:29-48`
- Compare with `biomarkerRoutes.ts:37-41` which uses `asyncHandler(biomarkerController.getBiomarkers)`.

### 11.3 Provider biomarker access bypasses encryption (INFO)

**FINDING:** In `providerRoutes.ts:277-288`, when a provider accesses a patient's biomarkers, the raw Prisma records are returned directly without decryption. The `valueEncrypted` field would be included in the response as encrypted ciphertext, which is not useful to the provider.

- **File:** `backend/src/routes/providerRoutes.ts:277-288`
- **Impact:** This is not a security vulnerability (data is still encrypted), but it is a functionality gap -- providers cannot actually read the biomarker values they are authorized to see.

### 11.4 Admin relationship update lacks body validation (LOW)

**FINDING:** `adminRoutes.ts:360-386` - The PATCH `/admin/provider-relationships/:id` endpoint validates the `:id` param as UUID but does NOT validate the request body. The `status`, `canViewBiomarkers`, etc. fields from `req.body` are used directly without Zod validation.

- **File:** `backend/src/routes/adminRoutes.ts:360-386`

### 11.5 Biomarker guidance endpoint constructs prompts from user data (INFO)

**FINDING:** The AI guidance endpoint at `biomarkerRoutes.ts:105-190` constructs a Claude API prompt using data from `req.body.biomarker` (name, value, unit, status, history). While this data comes from the authenticated user, it could potentially be used for prompt injection if malicious values were stored. The Zod validation on the POST body only validates the `:id` param, not the body content for this specific endpoint.

- **File:** `backend/src/routes/biomarkerRoutes.ts:105-190`
- **Mitigation:** The biomarker data originates from the user's own encrypted records, so the attack surface is limited to self-harm scenarios.

---

## Summary of Findings

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | **HIGH** | IDOR vulnerability in expense controller -- update/delete operations don't verify resource ownership | `expenseController.ts:150,184,219,264` |
| 2 | **HIGH** | RLS context (`withRLSContext`/`withRLSTransaction`) not used in 9 of 10 controllers | Multiple controllers |
| 3 | **MEDIUM** | Excessive CSRF bypass list with incorrect justifications; settings delete endpoints skip CSRF despite cookie-based auth | `csrf.ts:112-139` |
| 4 | **MEDIUM** | Debug `console.log` statements in settingsRoutes.ts that log user IDs and header presence | `settingsRoutes.ts:25-29,43-46` |
| 5 | **MEDIUM** | No Zod validation on any expense route (6 endpoints) | `expenseRoutes.ts:29-48` |
| 6 | **LOW** | Missing pagination on file list, health goals list, health needs list, expense projections | `fileController.ts:48`, `healthGoalsController.ts:177`, etc. |
| 7 | **LOW** | `asyncHandler` not used in expense routes; manual try/catch instead | `expenseRoutes.ts:29-48` |
| 8 | **LOW** | Demo protection middleware defined but never applied to any route | `demoProtection.ts` (unused) |
| 9 | **LOW** | Admin relationship update endpoint lacks body validation | `adminRoutes.ts:360-386` |
| 10 | **INFO** | Provider biomarker access returns encrypted values without decryption | `providerRoutes.ts:277-288` |
| 11 | **INFO** | AI guidance prompt constructed from user-controlled body data without body-specific validation | `biomarkerRoutes.ts:116-143` |

---

## Checklist from Prompt (Complete)

### 1. Route Authentication
- [x] `authRoutes.ts` - public routes (login, register, refresh, verify-email) correctly public; protected routes use `authenticate`
- [x] `biomarkerRoutes.ts` - all protected via `router.use(authenticate)`
- [x] `fileRoutes.ts` - all protected via `router.use(authenticate)`
- [x] `uploadRoutes.ts` - all protected via per-route `authenticate`
- [x] `insuranceRoutes.ts` - all protected via `router.use(authenticate)`
- [x] `expenseRoutes.ts` - all protected via `router.use(authenticate)`
- [x] `healthGoalsRoutes.ts` - all protected via `router.use(authenticate)`
- [x] `healthNeedsRoutes.ts` - all protected via `router.use(authenticate)`
- [x] `providerRoutes.ts` - protected + requires PROVIDER or ADMIN role
- [x] `patientRoutes.ts` - protected + requires PATIENT role
- [x] `adminRoutes.ts` - protected + requires ADMIN role
- [x] `settingsRoutes.ts` - all protected via `router.use(authenticate)`

### 2. Authorization (Beyond Authentication)
- [~] Users can only access their own resources -- FAIL on expense controller (IDOR)
- [x] `userId` from JWT used (not from request body)
- [ ] No IDOR vulnerabilities -- FAIL on expense controller

### 3. Input Validation
- [~] Request body validated before processing -- FAIL on expense routes (no Zod)
- [~] URL parameters validated (UUIDs, enums) -- FAIL on expense route params
- [x] Query parameters sanitized
- [x] File uploads validated (type, size)

### 4. Error Responses
- [x] Generic error messages to client
- [x] Detailed errors logged server-side
- [x] No stack traces in production responses
- [x] No database error details leaked

### 5. HTTP Methods
- [x] Correct methods used (GET for read, POST for create, etc.)
- [~] No sensitive operations on GET endpoints -- verify-email is state-changing via GET
- [x] DELETE endpoints require confirmation or are idempotent

### 6. Response Security
- [x] No sensitive data in responses (passwords, tokens, keys)
- [x] PHI decrypted only when needed
- [~] Pagination on list endpoints -- missing on several endpoints

### 7. Role-Based Route Protection
- [x] Provider routes enforce `requireRole('PROVIDER', 'ADMIN')`
- [x] Patient consent routes enforce `requireRole('PATIENT')`
- [x] Admin routes enforce `requireRole('ADMIN')`
- [x] Role checked from JWT claims (re-verified on each request)
- [~] Demo accounts blocked from sensitive operations -- middleware defined but not applied to routes

### 8. RLS Context
- [ ] `withRLSContext`/`withRLSTransaction` used for all DB queries -- FAIL, only settingsController uses it
- [x] userId from JWT token (not request body)
- [ ] Admin operations use `withRLSContext(null, ...)` for system access -- FAIL, admin routes don't use RLS
- [x] Provider cross-user queries properly scoped via relationship checks

---

## Questions Answered

1. **Are there any routes missing authentication?** No. All non-public routes have `authenticate` middleware applied either at the router level or per-route.

2. **Can users access other users' resources?** Yes -- the expense controller has IDOR vulnerabilities in update, delete, spending, and analyze endpoints where resource ownership is not verified.

3. **Are all inputs validated before use?** No. The expense routes lack Zod validation entirely. The admin provider-relationship update endpoint also lacks body validation.

4. **Are provider routes properly checking consent permissions?** Yes. Provider routes verify active relationship status, check granular permission flags (canViewBiomarkers, canViewHealthNeeds), and check consent expiration.

5. **Are admin routes restricted to ADMIN role only?** Yes. `requireRole('ADMIN')` is applied at the router level for all admin routes.
