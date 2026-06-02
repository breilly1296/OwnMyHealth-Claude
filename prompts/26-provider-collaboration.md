---
tags:
  - security
  - hipaa
  - high
type: prompt
priority: 2
updated: 2026-06-01
---

# Provider-Patient Collaboration Security Review

## Files to Review
- `backend/src/routes/providerRoutes.ts` (provider API endpoints — list/request/view/biomarkers/health-needs/delete)
- `backend/src/routes/patientRoutes.ts` (patient consent endpoints — providers/pending/approve/deny/PATCH permissions/revoke/delete)
- `backend/src/middleware/rbac.ts` (role-based access control + `checkProviderPatientAccess`, `requireOwnership`)
- `backend/src/middleware/rateLimiter.ts` (`providerAccessRequestLimiter` — 10/hour, user-keyed, Redis-backed via `rateLimitStore.ts`)
- `backend/src/middleware/validation.ts` (`schemas.providerPatient.{request,approve,updatePermissions}`, `schemas.patientIdParam`, `schemas.uuidParam`)
- `backend/prisma/schema.prisma` (ProviderPatient model ~line 94; `ProviderRelationType`/`ProviderPatientStatus` enums ~line 507)
- `backend/prisma/migrations/20260107_add_rls_policies/` (original `has_provider_access()` + provider-scoped PHI policies)
- `backend/prisma/migrations/20260529_fix_has_provider_access/` (drops dead `can_view_dna` branch that 500'd ALL multi-tenant reads under NOBYPASSRLS)
- `backend/prisma/migrations/20260530_add_users_select_provider/` (`has_active_consent()` + `users_select_provider` policy — provider reads consented patient's minimal identity)
- `backend/prisma/migrations/20260424_prevent_self_role_elevation/` (trigger blocking self role/is_active elevation)
- `backend/src/services/encryption.ts` (relationship `notesEncrypted` — encrypted with the requesting provider's salt)
- `backend/src/services/auditLog.ts` (cross-user access logging via `logAccess`/`logCreate`/`logUpdate`/`logDelete`)
- `backend/src/services/database.ts` (`withRLSContext` — RLS identity for every provider/patient query)
- `src/services/api/provider.ts` (frontend provider API)
- `src/services/api/patient.ts` (frontend patient consent API)
- `src/hooks/useRBAC.ts` (frontend role checks)
- `src/components/common/RoleGuard.tsx` (UI role gating — `RoleGuard`, `PatientOnly`, `ProviderOnly`, `ProviderOrAdmin`)
- `src/components/provider/CareTeamPage.tsx` (patient-facing care-team / consent UI)
- `src/components/provider/MyPatientsPage.tsx` (provider-facing patient list UI)

## OwnMyHealth Provider Collaboration Architecture
- **Model**: `ProviderPatient` with granular consent permissions (`@@unique([providerId, patientId])`)
- **Roles**: PATIENT (data owner), PROVIDER (authorized viewer), ADMIN (system); hierarchy ADMIN=3 > PROVIDER=2 > PATIENT=1 in `rbac.ts` and `useRBAC.ts`
- **Consent Flow**: Provider requests access by patient email → Patient approves (sets permission flags + optional `consentDurationDays`) or denies → time-limited access
- **Permissions** (exactly 4 boolean flags): `canViewBiomarkers` (default true), `canViewInsurance` (default false), `canViewHealthNeeds` (default true), `canEditData` (default false). NOTE: the former `canViewDna` flag was REMOVED with the DNA/Genetics feature (column dropped in migration `20260423_drop_dna_genetics`; the dead RLS reference was fixed in `20260529_fix_has_provider_access`).
- **Status Lifecycle** (`ProviderPatientStatus` enum): PENDING, ACTIVE, SUSPENDED, REVOKED, EXPIRED. In practice the routes only positively gate on `status === 'ACTIVE'`; deny is a hard delete (no DENIED status), patient revoke is a soft update to REVOKED, provider remove is a hard delete (F-23: inconsistent soft- vs hard-delete is a known deferred item). EXPIRED/SUSPENDED are enum values but expiry is enforced via `consentExpiresAt` time checks, not a status transition.
- **Relationship type** (`ProviderRelationType` enum): PRIMARY_CARE (default), SPECIALIST, CONSULTANT, EMERGENCY, OTHER
- **Encryption**: relationship `notesEncrypted` encrypted with the requesting provider's per-user salt (`getUserEncryptionSalt(providerId)`)
- **RLS backstop**: PHI table policies carry `OR has_provider_access(user_id, <perm>)`; `users_select_provider` (via `has_active_consent`) lets a provider read a consented patient's minimal identity row. App-layer checks remain the primary gate + audit driver; RLS is the no-disclosure backstop.

## Checklist

### 1. Consent Lifecycle Security
- [ ] Provider can only request access via `POST /provider/patients/request` (cannot self-approve)
- [ ] `patientRoutes.ts` is gated `requireRole('PATIENT')` — patient is the sole approver/denier/revoker of access requests
- [ ] PENDING relationships grant zero data access (every data route requires `status === 'ACTIVE'`)
- [ ] SUSPENDED/REVOKED/EXPIRED statuses block all data access (anything not ACTIVE is rejected)
- [ ] Consent expiration (`consentExpiresAt`) enforced on every data query (checked in route handlers AND in `has_provider_access()` / `has_active_consent()` RLS functions)
- [ ] Expired consents automatically blocked (not just UI-hidden) — time check `consentExpiresAt < now()` in DB function + handlers, independent of `status`
- [ ] Patient can revoke access at any time (`POST /patient/providers/:id/revoke`, immediate soft update to REVOKED)
- [ ] `PATCH /patient/providers/:id` rejects permission edits on an expired relationship (status ACTIVE alone is insufficient; `consentExpiresAt` is re-checked)
- [ ] Revocation cannot be undone by provider (no provider endpoint mutates `status` to ACTIVE; only patient `approve` can)
- [ ] Re-requesting access to an already-ACTIVE or already-PENDING patient is rejected with ForbiddenError (no silent re-grant)

### 2. Granular Permission Enforcement
- [ ] Each permission flag checked independently on data access:
  - `canViewBiomarkers` → `GET /provider/patients/:patientId/biomarkers`
  - `canViewInsurance` → insurance plan endpoints (flag exists; verify whether a provider insurance read route is actually wired)
  - `canViewHealthNeeds` → `GET /provider/patients/:patientId/health-needs`
  - `canEditData` → mutation endpoints (write/POST/PATCH/DELETE on patient data)
  - NOTE: `canViewDna` no longer exists (DNA/Genetics removed) — confirm no dead reference remains in code or RLS functions
- [ ] Permission flag enforced at backend in BOTH the route handler AND the RLS `has_provider_access(user_id, <perm>)` branch (not just frontend UI)
- [ ] Default permissions are restrictive at schema level (`canViewInsurance` default false, `canEditData` default false; `canViewBiomarkers`/`canViewHealthNeeds` default true)
- [ ] `approve`/`updatePermissions` only accept the 4 known boolean flags (Zod `schemas.providerPatient.*`) — no permission injection
- [ ] Permission changes logged in audit trail with before/after (`logUpdate` on `provider_consent_permissions`, op `PERMISSIONS_UPDATED`)

### 3. IDOR Prevention (Cross-User Access)
- [ ] Provider can only access patients with ACTIVE, unexpired relationship (lookup keyed on `providerId_patientId` compound unique)
- [ ] `:patientId` param validated (`schemas.patientIdParam`) and joined to the provider's own `ProviderPatient` row on every request
- [ ] Provider cannot enumerate patients they don't have relationships with — `GET /provider/patients` lists only the provider's own rows; email/identity disclosed ONLY for ACTIVE unexpired relationships (PENDING/expired disclose neither)
- [ ] `POST /provider/patients/request` returns a UNIFORM generic response whether the email doesn't exist, isn't a PATIENT, or is a valid patient (prevents user-table enumeration; real reason kept only in audit log)
- [ ] Provider cannot access patient data outside granted permissions
- [ ] No path parameter manipulation to access other patients
- [ ] All provider/patient queries run inside `withRLSContext` — provider-context reads (P7) use the provider's session as RLS identity; cross-tenant identity lookups that legitimately need admin scope are explicit `{ isAdmin: true }` with a non-secret column allowlist
- [ ] RLS policies cover provider-patient queries: `has_provider_access()` (PHI tables) and `users_select_provider`/`has_active_consent()` (identity). Confirm the `20260529_fix_has_provider_access` fix is applied (the pre-fix `can_view_dna` reference threw for EVERY permission_type under NOBYPASSRLS, breaking all multi-tenant reads)
- [ ] `users_select_provider` is row-level not column-level — every provider-context `user` read MUST use an explicit non-secret column allowlist (never select `passwordHash`/`*Token`); verify all such selects

### 4. HIPAA Minimum Necessary Principle
- [ ] Provider only receives data within granted permission scope
- [ ] Responses filtered to exclude non-permitted data categories
- [ ] Bulk data endpoints respect per-patient permissions
- [ ] No "select all" that bypasses permission filtering

### 5. Audit Logging (Cross-User Access)
- [ ] All provider access to patient data is audit logged (`patient_detail`, `patient_biomarkers`, `patient_health_needs` resources with op `VIEW_PATIENT`/`PHI_ACCESS`)
- [ ] Audit log captures both provider ID (`userId`) and patient ID (resource id + `patientId` metadata)
- [ ] Consent grant/deny/revoke events logged (`provider_consent` ops `CONSENT_GRANTED`/`CONSENT_DENIED`/`CONSENT_REVOKED`/`RELATIONSHIP_DELETED`)
- [ ] Consent-write audit rows are threaded onto the RLS `tx` so they commit atomically with the state change (no orphaned/lost audit rows)
- [ ] Permission changes logged with old and new values (`logUpdate` carries before/after permission objects)
- [ ] Failed access attempts logged with specific reason (`no_relationship`, `relationship_not_active`, `consent_expired`, `permission_denied`, `patient_inactive_or_locked`)
- [ ] Enumeration probes on `/provider/patients/request` logged with real reason (`patient_not_found` vs `not_patient_role`) even though the API response is collapsed
- [ ] Audit logs queryable by patient (who accessed my data?) — VERIFY: no patient-facing "access history" endpoint currently exists in `auditLog.ts`/routes; flag as a gap if still required

### 6. Relationship Data Security
- [ ] ProviderPatient `notesEncrypted` field encrypted before storage (with the provider's salt, AES-256-GCM)
- [ ] `@@unique([providerId, patientId])` enforced (no duplicate relationships; request uses `upsert` on the compound key)
- [ ] `relationshipType` validated against `ProviderRelationType` enum (PRIMARY_CARE, SPECIALIST, CONSULTANT, EMERGENCY, OTHER) via Zod
- [ ] Patient email validated as an email when requesting access (`schemas.providerPatient.request.patientEmail`); message sanitized + length-capped (500)
- [ ] Rate limiting on access request endpoint: `providerAccessRequestLimiter` (10/hour, user-keyed not IP-keyed, Redis-backed via `rateLimitStore`/`REDIS_URL` with in-memory fallback)

### 7. Frontend Authorization
- [ ] `useRBAC` hook correctly gates provider-only UI
- [ ] `RoleGuard` component prevents unauthorized component rendering
- [ ] Patient consent UI only visible to patients
- [ ] Provider patient list only visible to providers/admins
- [ ] Permission-based data sections hidden when not granted
- [ ] No client-side data leakage (e.g., prefetching unauthorized data)

### 8. Edge Cases
- [ ] Provider cannot access data after patient deletes/deactivates their account (`User.findFirst` filters `isActive: true`; relationships cascade-delete on `User` delete)
- [ ] Provider cannot access data during active account lockout (`lockedUntil` null-or-past filter on patient lookup; reason `patient_inactive_or_locked`)
- [ ] Concurrent consent changes handled safely (read+write wrapped in a single `withRLSContext` transaction)
- [ ] Provider who is also a patient keeps roles separate (single `role` per user; `requireRole` gates each route family)
- [ ] User cannot self-elevate `role` or `is_active` (trigger `users_prevent_self_privilege_change`, migration `20260424_prevent_self_role_elevation`; only admin sessions bypass) — verify a patient cannot promote self to PROVIDER to gain access routes
- [ ] Admin bypass (`requireRole('PROVIDER','ADMIN')` on provider routes; `{ isAdmin: true }` RLS context) documented and audit-logged

## Verification Commands
```bash
# Find provider/patient route handlers
grep -rn "providerRoutes\|patientRoutes" backend/src/routes/

# Check the 4 real permission flags are enforced (canViewDna must return NOTHING — feature removed)
grep -rn "canViewBiomarkers\|canViewInsurance\|canViewHealthNeeds\|canEditData" backend/src/
grep -rn "canViewDna\|can_view_dna" backend/src/  # expect: zero hits outside the drop migration

# Find cross-user queries (potential IDOR) and confirm they run inside withRLSContext
grep -rn "providerId_patientId\|withRLSContext" backend/src/routes/providerRoutes.ts backend/src/routes/patientRoutes.ts backend/src/middleware/rbac.ts

# Verify audit logging on provider access
grep -rn "logAccess\|logUpdate\|logDelete\|PHI_ACCESS\|CONSENT_" backend/src/routes/providerRoutes.ts backend/src/routes/patientRoutes.ts

# Confirm the RLS consent functions and the dna-fix migration
grep -rn "has_provider_access\|has_active_consent\|users_select_provider" backend/prisma/migrations/

# Confirm the access-request rate limiter
grep -rn "providerAccessRequestLimiter" backend/src/
```

## Questions to Ask
1. Can a provider access any patient data without an ACTIVE, unexpired relationship — even under a NOBYPASSRLS role (is the `20260529_fix_has_provider_access` fix deployed)?
2. Are expired consents checked on every request (handler + RLS function) or only periodically? Is there a background job that flips status to EXPIRED, or is expiry purely time-derived?
3. Is there a notification system when a provider requests access (does the patient get emailed, or only see it on `GET /providers/pending`)?
4. What happens to shared data if the patient revokes access mid-session — does the next request fail, and is there access-token/session invalidation?
5. Does `canViewInsurance` have an actual provider-facing insurance read route, or is the flag granted but never consumable (orphaned permission)?
6. Provider remove is a hard delete (F-23) while patient revoke is a soft REVOKED update — does the hard delete break audit joinability / who-accessed-my-data reconstruction?
7. Is there any patient-facing endpoint to answer "which providers accessed my data and when?" (no such route currently exists)?
8. Are provider access patterns (enumeration probes, rate-limit hits) monitored for anomalies beyond raw audit rows?
