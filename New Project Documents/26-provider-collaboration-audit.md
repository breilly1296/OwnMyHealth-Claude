# Provider-Patient Collaboration Security Audit

**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (Automated Security Review)
**Severity:** HIGH (HIPAA / cross-user data access)
**Status:** Multiple critical and high-severity findings

---

## Files Reviewed

| File | Path |
|------|------|
| Provider Routes | `backend/src/routes/providerRoutes.ts` |
| Patient Routes | `backend/src/routes/patientRoutes.ts` |
| RBAC Middleware | `backend/src/middleware/rbac.ts` |
| Auth Middleware | `backend/src/middleware/auth.ts` |
| Validation Middleware | `backend/src/middleware/validation.ts` |
| Prisma Schema | `backend/prisma/schema.prisma` (ProviderPatient model, lines 85-109) |
| Encryption Service | `backend/src/services/encryption.ts` |
| Audit Log Service | `backend/src/services/auditLog.ts` |
| RLS Migration | `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` |
| Database Service | `backend/src/services/database.ts` |
| Rate Limiter | `backend/src/middleware/rateLimiter.ts` |
| Frontend Provider API | `src/services/api/provider.ts` |
| Frontend Patient API | `src/services/api/patient.ts` |
| Frontend useRBAC Hook | `src/hooks/useRBAC.ts` |
| Frontend RoleGuard | `src/components/common/RoleGuard.tsx` |
| Route Index | `backend/src/routes/index.ts` |

---

## Checklist

### 1. Consent Lifecycle Security

- [x] **PASS** -- Provider can only request access (cannot self-approve)
  - `providerRoutes.ts:92-172`: POST `/patients/request` creates relationship with `status: 'PENDING'` (line 153). The provider routes use `requireRole('PROVIDER', 'ADMIN')` (line 24) and never expose an approve endpoint. Approval is exclusively on the patient routes (`patientRoutes.ts:144-201`), which require `requireRole('PATIENT')` (line 23).

- [x] **PASS** -- Patient is the sole approver of access requests
  - `patientRoutes.ts:23`: `router.use(requireRole('PATIENT'))` gates all patient routes. The approve endpoint (`/providers/:id/approve`, line 144) validates `patientId` from `req.user!.id` (line 149) and requires `status: 'PENDING'` (line 165). Only the patient who owns the relationship can approve.

- [x] **PASS** -- PENDING relationships grant zero data access
  - `providerRoutes.ts:196,269`: All data access endpoints check `relationship.status !== 'ACTIVE'` and throw `ForbiddenError`. PENDING status is explicitly rejected. The `checkProviderPatientAccess` function in `rbac.ts:218` also checks `relationship.status !== 'ACTIVE'`.

- [x] **PASS** -- SUSPENDED/REVOKED/EXPIRED statuses block all data access
  - `providerRoutes.ts:196,269`: The check `relationship.status !== 'ACTIVE'` blocks any status other than ACTIVE. SUSPENDED, REVOKED, and EXPIRED are all non-ACTIVE values and are therefore blocked.

- [ ] **FAIL** -- Consent expiration (`consentExpiresAt`) NOT enforced on every data query
  - **CRITICAL FINDING.** In `providerRoutes.ts`, the data access endpoints at lines 178-245 (patient details), 251-288 (biomarkers), and 294-331 (health needs) check `relationship.status !== 'ACTIVE'` but **never check `consentExpiresAt`**. An expired consent with status still set to ACTIVE will continue granting access indefinitely. The `consentExpiresAt` field is only returned in response data (lines 76, 235) but never evaluated.
  - The RLS `has_provider_access` function in the migration SQL (line 49) does check `consent_expires_at IS NULL OR consent_expires_at > NOW()`, but providerRoutes.ts does NOT use `withRLSContext` (see finding below), so this RLS protection may not be active.
  - The `checkProviderPatientAccess` in `rbac.ts:223` does check expiration, but this middleware function is not used in the provider routes (they do inline checks instead).

- [~] **PARTIAL** -- Expired consents automatically blocked (not just UI-hidden)
  - The RLS policy `has_provider_access` (migration SQL line 49) checks `consent_expires_at > NOW()` at the database level. However, the application-layer code in `providerRoutes.ts` does NOT check expiration. If RLS context is properly set (which it currently is NOT -- see finding below), then expired consents would be blocked at the DB level. Without RLS context, expired consents pass through.

- [x] **PASS** -- Patient can revoke access at any time (immediate effect)
  - `patientRoutes.ts:286-317`: The revoke endpoint changes status to `'REVOKED'` immediately. Subsequent provider access checks will fail because `status !== 'ACTIVE'`.

- [x] **PASS** -- Revocation cannot be undone by provider
  - Provider routes have no endpoint to change relationship status. The upsert in `providerRoutes.ts:142-161` can only set status to `'PENDING'`, and this only fires when an existing relationship is REVOKED or SUSPENDED (the existing check at lines 124-131 blocks if ACTIVE or PENDING). Provider cannot set status back to ACTIVE.

### 2. Granular Permission Enforcement

- [~] **PARTIAL** -- Each permission flag checked independently on data access

  - `canViewBiomarkers` -> biomarker endpoints: **PASS** (`providerRoutes.ts:273`)
  - `canViewInsurance` -> insurance plan endpoints: **FAIL** -- No insurance endpoint exists in providerRoutes.ts. There is no `/provider/patients/:patientId/insurance` route.
  - `canViewDna` -> DNA/genetic data endpoints: **FAIL** -- No DNA endpoint exists in providerRoutes.ts. There is no `/provider/patients/:patientId/dna` route.
  - `canViewHealthNeeds` -> health needs endpoints: **PASS** (`providerRoutes.ts:316`)
  - `canEditData` -> mutation endpoints: **FAIL** -- No mutation (POST/PATCH/DELETE on patient data) endpoints exist for providers. The only DELETE endpoint (`providerRoutes.ts:337-368`) removes the relationship itself, not patient data.

  Note: The permission flags exist in the schema and are set during approval, but only biomarkers and health needs have actual provider-facing endpoints. Insurance and DNA data access routes for providers have not been implemented.

- [x] **PASS** -- Permissions enforced at backend (not just frontend UI)
  - `providerRoutes.ts:273`: `if (!relationship.canViewBiomarkers)` throws ForbiddenError.
  - `providerRoutes.ts:316`: `if (!relationship.canViewHealthNeeds)` throws ForbiddenError.
  - These are server-side checks, not just UI hiding.

- [x] **PASS** -- Default permissions are restrictive (canViewDna=false, canEditData=false)
  - `schema.prisma:89-93`: Defaults are `canViewBiomarkers: true`, `canViewInsurance: false`, `canViewDna: false`, `canViewHealthNeeds: true`, `canEditData: false`. The sensitive permissions (DNA, insurance, edit) default to false.
  - `validation.ts:528-533`: Validation schema defaults match: `canViewDna: false`, `canEditData: false`, `canViewInsurance: false`.

- [ ] **FAIL** -- Permission changes NOT logged in audit trail
  - **HIGH SEVERITY.** Neither `providerRoutes.ts` nor `patientRoutes.ts` import or call any audit logging function. Permission changes in `patientRoutes.ts:241-280` (PATCH `/providers/:id`) update permissions without any audit log entry. Zero audit logging exists in any provider-patient collaboration route.

### 3. IDOR Prevention (Cross-User Access)

- [x] **PASS** -- Provider can only access patients with ACTIVE relationship
  - Every data endpoint in `providerRoutes.ts` queries `providerPatient.findUnique` with both `providerId` (from JWT) and `patientId` (from URL param), then checks `status !== 'ACTIVE'`.

- [x] **PASS** -- Patient ID validated against ProviderPatient table on every request
  - `providerRoutes.ts:187-198,260-271,303-314`: Each endpoint queries the compound unique key `providerId_patientId` before returning data.

- [x] **PASS** -- Provider cannot enumerate patients they don't have relationships with
  - `providerRoutes.ts:37-39`: The patient list endpoint filters by `providerId` from JWT and `status: { in: ['ACTIVE', 'PENDING'] }`. No endpoint allows querying arbitrary patients.

- [x] **PASS** -- Provider cannot access patient data outside granted permissions
  - Individual permission flags are checked before returning data (lines 273, 316).

- [x] **PASS** -- No path parameter manipulation to access other patients
  - `patientId` from URL params is always paired with `providerId` from JWT in the compound lookup (`providerId_patientId`). Changing `patientId` without a valid relationship returns ForbiddenError.
  - `validation.ts:218-219`: `patientIdParam` validates UUID format, preventing injection.

- [ ] **FAIL** -- RLS policies do NOT cover provider-patient queries in practice
  - **CRITICAL FINDING.** `providerRoutes.ts` uses `getPrismaClient()` directly without calling `withRLSContext()` or `setRLSContext()`. This means PostgreSQL RLS policies are NOT applied to any query in the provider routes. The application relies entirely on inline Prisma `where` clause checks, not on database-level RLS enforcement.
  - The same issue exists in `patientRoutes.ts` -- no RLS context is set.
  - While the `has_provider_access()` SQL function and RLS policies exist in the migration (lines 39-62, 151-157), they are effectively bypassed because the application does not set `app.current_user_id` before these queries.

### 4. HIPAA Minimum Necessary Principle

- [~] **PARTIAL** -- Provider only receives data within granted permission scope
  - Biomarkers and health needs are correctly gated. However, the patient detail endpoint (`providerRoutes.ts:178-245`) returns patient email, creation date, and last login time regardless of which specific permissions the provider has. This metadata exposure may violate minimum necessary.

- [~] **PARTIAL** -- Responses filtered to exclude non-permitted data categories
  - Biomarkers and health needs are separate endpoints with permission checks. However, within the biomarkers endpoint (`providerRoutes.ts:277-286`), ALL biomarker fields are returned including encrypted values. There is no field-level filtering based on the specific use case.

- [x] **PASS** -- Bulk data endpoints respect per-patient permissions
  - The patient list endpoint (`providerRoutes.ts:30-86`) only returns relationship metadata (permissions, status, dates), not actual patient health data. Each data endpoint requires a separate request with permission checking.

- [x] **PASS** -- No "select all" that bypasses permission filtering
  - No bulk patient data endpoint exists. Each data category (biomarkers, health needs) requires a separate permissioned request per patient.

### 5. Audit Logging (Cross-User Access)

- [ ] **FAIL** -- Provider access to patient data is NOT audit logged
  - **CRITICAL FINDING (HIPAA NON-COMPLIANCE).** Neither `providerRoutes.ts` nor `patientRoutes.ts` import or use the `AuditLogService`. Zero audit log entries are created for:
    - Provider viewing patient biomarkers
    - Provider viewing patient health needs
    - Provider viewing patient details
    - Provider requesting access
    - Provider deleting a relationship

- [ ] **FAIL** -- Audit log does NOT capture both provider ID and patient ID
  - No audit logging exists in these routes.

- [ ] **FAIL** -- Consent grant/deny/revoke events NOT logged
  - `patientRoutes.ts:144-201` (approve), `207-235` (deny), `286-317` (revoke) contain no audit logging calls.

- [ ] **FAIL** -- Permission changes NOT logged with old and new values
  - `patientRoutes.ts:241-280` (PATCH permissions) does not log old vs. new permission values.

- [ ] **FAIL** -- Failed access attempts NOT logged (provider without permission)
  - When `ForbiddenError` is thrown in `providerRoutes.ts:197,274,317`, no audit log entry is created for the failed attempt.

- [~] **PARTIAL** -- Audit logs queryable by patient (who accessed my data?)
  - The `AuditLogService.queryLogs()` method in `auditLog.ts:410-444` supports filtering by `userId`. However, since no provider-patient access logs are created, this capability is moot for cross-user access scenarios.

### 6. Relationship Data Security

- [x] **PASS** -- ProviderPatient `notesEncrypted` field encrypted before storage
  - `providerRoutes.ts:134-139`: Notes are encrypted using `encryptionService.encrypt(message, providerSalt)` with the provider's user-specific salt before being stored in `notesEncrypted`.
  - `encryption.ts:389-391`: `ProviderPatient: ['notesEncrypted']` is listed in PHI_FIELDS.

- [x] **PASS** -- Unique constraint on providerId + patientId (no duplicate relationships)
  - `schema.prisma:104`: `@@unique([providerId, patientId])` prevents duplicate relationships.
  - `providerRoutes.ts:115-131`: Application also checks for existing relationships before creating.

- [x] **PASS** -- Relationship type validated against enum
  - `validation.ts:523`: `z.enum(['PRIMARY_CARE', 'SPECIALIST', 'CONSULTANT', 'EMERGENCY', 'OTHER'])` validates the relationship type.
  - `schema.prisma:94`: Database enforces `ProviderRelationType` enum.

- [x] **PASS** -- Provider email validated when requesting access
  - `validation.ts:522`: `patientEmail: email` uses the Zod email validator.
  - `providerRoutes.ts:110`: Additional check that `patient.role !== 'PATIENT'` throws ForbiddenError.

- [ ] **FAIL** -- No rate limiting on access request endpoint (prevent spam)
  - `providerRoutes.ts` does not import or use any rate limiter. Neither `sensitiveLimiter` nor any other rate limiter from `rateLimiter.ts` is applied to the POST `/patients/request` endpoint. A provider could spam access requests to many patients.
  - The global standard rate limiter may apply at the app level, but no endpoint-specific rate limiting is configured for this sensitive operation.

### 7. Frontend Authorization

- [~] **PARTIAL** -- `useRBAC` hook correctly gates provider-only UI
  - `src/hooks/useRBAC.ts`: The hook correctly computes `isProvider`, `isPatient`, `canViewPatients`, `canManageProviderAccess` based on role. However, a search of the entire `src/components/` directory shows that `useRBAC` is **never imported or used** by any feature component (only exported from `hooks/index.ts`). The hook exists but is not consumed.

- [~] **PARTIAL** -- `RoleGuard` component prevents unauthorized component rendering
  - `src/components/common/RoleGuard.tsx`: The component correctly implements role checking with `hasRole()` and `hasMinRole()`. Convenience wrappers `PatientOnly`, `ProviderOnly`, `AdminOnly`, `ProviderOrAdmin` are defined. However, none of these components are imported by any feature component in the codebase. They exist but are not used.

- [ ] **FAIL** -- Patient consent UI not gated to patients only (in frontend)
  - No feature component imports `PatientOnly` or uses `RoleGuard` with `roles={['PATIENT']}` to gate consent management UI. Backend enforcement exists, but the frontend does not prevent showing the UI to the wrong role.

- [ ] **FAIL** -- Provider patient list not gated to providers/admins only (in frontend)
  - No feature component imports `ProviderOnly` or `ProviderOrAdmin` to gate the provider patient list UI. The API will reject unauthorized requests, but the frontend shows no role-based UI gating.

- [ ] **FAIL** -- Permission-based data sections not hidden when not granted
  - The frontend `provider.ts` API module fetches biomarkers and health needs without checking permissions first. No conditional rendering based on `canViewBiomarkers`, `canViewHealthNeeds`, etc. exists in any frontend component.

- [x] **PASS** -- No client-side data leakage (e.g., prefetching unauthorized data)
  - The frontend API modules (`src/services/api/provider.ts`, `src/services/api/patient.ts`) only fetch data on explicit function calls, not automatically. No prefetching or eager loading of unauthorized data occurs.

### 8. Edge Cases

- [x] **PASS** -- Provider cannot access data after patient deletes their account
  - `schema.prisma:101`: `onDelete: Cascade` on the patient relation means deleting a User record cascades to delete all associated ProviderPatient rows. Provider will get "not found" on subsequent access attempts.

- [ ] **FAIL** -- Provider CAN access data during active account lockout
  - `auth.ts`: The authentication middleware verifies JWT tokens but does NOT check the user's `isActive` flag or `lockedUntil` timestamp from the database. A provider with a valid JWT token can continue accessing patient data even if their account has been locked or deactivated. The JWT remains valid until expiration (15 minutes).

- [~] **PARTIAL** -- Concurrent consent changes handled safely (no race conditions)
  - `patientRoutes.ts:178` uses `prisma.providerPatient.update()` which is atomic at the database level. However, there is no optimistic locking or version checking. Two concurrent PATCH requests to update permissions could result in a last-write-wins scenario where one set of permission changes is silently overwritten.

- [~] **PARTIAL** -- Provider who is also a patient keeps roles separate
  - The database `User.role` is a single enum value (PATIENT, PROVIDER, ADMIN), not a set. A user can only have one role. This means a healthcare professional who is also a patient must use two separate accounts. The system does not support dual roles, which is a design constraint rather than a security flaw, but it should be documented.

- [ ] **FAIL** -- Admin bypass NOT documented or audit-logged
  - `rbac.ts:140-142`: Admin role bypasses `requireResourceAccess` checks with `if (userRole === 'ADMIN') { return next(); }`. This bypass is not audit-logged. The `requireOwnership` function also bypasses for admins (line 260). No audit entry is created when an admin accesses patient data through provider routes (admins pass the `requireRole('PROVIDER', 'ADMIN')` check on line 24).

---

## Critical Findings Summary

### CRITICAL (Requires Immediate Action)

1. **No Audit Logging on Provider-Patient Routes (HIPAA Non-Compliance)**
   - Files: `backend/src/routes/providerRoutes.ts`, `backend/src/routes/patientRoutes.ts`
   - Impact: All provider access to patient data, all consent lifecycle events (grant, deny, revoke, permission changes), and all failed access attempts are completely unlogged. This is a direct HIPAA violation (45 CFR 164.312(b) -- Audit Controls).

2. **Consent Expiration Not Checked at Application Layer**
   - File: `backend/src/routes/providerRoutes.ts` (lines 196, 269, 310)
   - Impact: Expired consents with ACTIVE status continue granting provider access to patient data. Only `status !== 'ACTIVE'` is checked; `consentExpiresAt` is never evaluated.

3. **RLS Context Not Set in Provider/Patient Routes**
   - Files: `backend/src/routes/providerRoutes.ts`, `backend/src/routes/patientRoutes.ts`
   - Impact: Row-Level Security policies are not enforced. Queries use `getPrismaClient()` directly without `withRLSContext()`. The comprehensive RLS policies defined in the migration are effectively inactive for these routes.

### HIGH (Should Fix Before Production)

4. **Permission Check Bug: `healthNeed` Uses `canViewBiomarkers`**
   - File: `backend/src/middleware/rbac.ts` (lines 228-229)
   - Impact: In the `checkProviderPatientAccess` function, the `healthNeed` resource is grouped with `biomarker` and both use `relationship.canViewBiomarkers` for read access. The `canViewHealthNeeds` flag is checked correctly in the inline route handler (`providerRoutes.ts:316`), but the RBAC middleware function has a logic error. If `requireResourceAccess('healthNeed', 'read')` is ever used (it is not currently, since routes use inline checks), it would check the wrong permission flag.

5. **No Rate Limiting on Provider Access Request Endpoint**
   - File: `backend/src/routes/providerRoutes.ts` (line 92)
   - Impact: The POST `/patients/request` endpoint has no endpoint-specific rate limiting. A malicious provider account could spam access requests to enumerate patient emails or flood patients with requests.

6. **No Account Lockout Check in Authentication Middleware**
   - File: `backend/src/middleware/auth.ts`
   - Impact: JWT authentication does not verify the user's `isActive` or `lockedUntil` status. A locked/deactivated provider retains access until their JWT expires (15 min).

7. **Admin Bypass Not Audit-Logged**
   - File: `backend/src/middleware/rbac.ts` (lines 140-142, 260)
   - Impact: Admin users can access any patient's data through provider routes without generating any audit trail.

### MEDIUM (Should Address in Upcoming Sprint)

8. **Missing Provider Endpoints for Insurance and DNA**
   - File: `backend/src/routes/providerRoutes.ts`
   - Impact: `canViewInsurance` and `canViewDna` permission flags exist in the schema and can be granted by patients, but no corresponding provider API endpoints exist to use them. This is a feature gap rather than a security issue, but it means the schema promises functionality that does not exist.

9. **Frontend Role Guards Defined But Never Used**
   - Files: `src/components/common/RoleGuard.tsx`, `src/hooks/useRBAC.ts`
   - Impact: The `RoleGuard`, `PatientOnly`, `ProviderOnly`, `AdminOnly`, and `ProviderOrAdmin` components and the `useRBAC` hook are well-implemented but never imported by any feature component. All role-based UI gating is missing from the actual application.

10. **Patient Detail Endpoint Exposes Metadata Without Permission Check**
    - File: `backend/src/routes/providerRoutes.ts` (lines 200-211)
    - Impact: The patient detail endpoint returns email, creation date, and last login date regardless of which specific data permissions the provider has. Any provider with an ACTIVE relationship (even with all `canView*` flags set to false) can access this patient metadata.

---

## Verification Commands (Results)

```
# Audit logging usage in provider/patient routes
grep -r "auditLog\|logAccess\|logCreate\|logUpdate\|logDelete" providerRoutes.ts patientRoutes.ts
Result: NO MATCHES -- zero audit logging

# RLS context usage in provider/patient routes
grep -r "withRLSContext\|withRLSTransaction\|setRLSContext" providerRoutes.ts patientRoutes.ts
Result: NO MATCHES -- RLS never set

# Rate limiter usage in provider routes
grep -r "rateLimiter\|sensitiveLimiter\|standardLimiter" providerRoutes.ts
Result: NO MATCHES -- no rate limiting

# consentExpiresAt checks (comparison/evaluation) in provider routes
grep -r "consentExpiresAt.*<\|consentExpiresAt.*>\|new Date" providerRoutes.ts
Result: NO MATCHES -- expiration never evaluated (only returned in responses)

# Account lockout checks in auth middleware
grep -r "lockedUntil\|isActive" auth.ts
Result: NO MATCHES -- no lockout verification
```

---

## Questions Answered

1. **Can a provider access any patient data without an ACTIVE relationship?**
   No. All data endpoints check `relationship.status !== 'ACTIVE'` and throw ForbiddenError. However, expired consents with ACTIVE status are not caught at the application layer.

2. **Are expired consents checked on every request or only periodically?**
   They are NOT checked at the application layer. The RLS `has_provider_access` function checks expiration, but RLS context is not set in provider routes, so this check is bypassed.

3. **Is there a notification system when a provider requests access?**
   No. The POST `/patients/request` endpoint creates the relationship and returns, but no email notification or in-app notification is sent to the patient. Patients must manually check their pending requests list.

4. **What happens to shared data if the patient revokes access mid-session?**
   Revocation is immediate (status changes to REVOKED in the database). Any subsequent API calls by the provider will fail with ForbiddenError. However, data already loaded in the provider's browser session remains visible until a new request is made.

5. **Are provider access patterns monitored for anomalies?**
   No. Since audit logging is entirely absent from provider routes, there is no data to analyze for anomalous patterns.

---

## Recommendations Priority

| Priority | Finding | Effort |
|----------|---------|--------|
| P0 | Add audit logging to all provider/patient route handlers | Medium |
| P0 | Add `consentExpiresAt` check to all provider data endpoints | Low |
| P0 | Add `withRLSContext()` calls to all provider/patient routes | Medium |
| P1 | Add rate limiting to provider access request endpoint | Low |
| P1 | Add `isActive`/`lockedUntil` check to auth middleware | Low |
| P1 | Fix `healthNeed` permission mapping in `rbac.ts:228` | Low |
| P1 | Add audit logging for admin bypass access | Low |
| P2 | Implement insurance/DNA provider data endpoints | Medium |
| P2 | Integrate `RoleGuard`/`useRBAC` into frontend feature components | Medium |
| P2 | Add notification when provider requests access | Medium |
| P3 | Add optimistic locking for concurrent permission updates | Low |
| P3 | Document dual-role (provider who is also patient) limitations | Low |
