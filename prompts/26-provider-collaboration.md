---
tags:
  - security
  - hipaa
  - high
type: prompt
priority: 2
---

# Provider-Patient Collaboration Security Review

## Files to Review
- `backend/src/routes/providerRoutes.ts` (provider API endpoints)
- `backend/src/routes/patientRoutes.ts` (patient consent endpoints)
- `backend/src/middleware/rbac.ts` (role-based access control)
- `backend/src/controllers/` (any provider/patient handlers)
- `backend/prisma/schema.prisma` (ProviderPatient model)
- `backend/src/services/encryption.ts` (relationship notes encryption)
- `backend/src/services/auditLog.ts` (cross-user access logging)
- `src/services/api/provider.ts` (frontend provider API)
- `src/services/api/patient.ts` (frontend patient consent API)
- `src/hooks/useRBAC.ts` (frontend role checks)
- `src/components/common/RoleGuard.tsx` (UI role gating)

## OwnMyHealth Provider Collaboration Architecture
- **Model**: ProviderPatient with granular consent permissions
- **Roles**: PATIENT (data owner), PROVIDER (authorized viewer), ADMIN (system)
- **Consent Flow**: Provider requests access → Patient grants/denies → Time-limited access
- **Permissions**: canViewBiomarkers, canViewInsurance, canViewDna, canViewHealthNeeds, canEditData
- **Status Lifecycle**: PENDING → ACTIVE → SUSPENDED / REVOKED / EXPIRED
- **Encryption**: Relationship notes encrypted with provider's user salt

## Checklist

### 1. Consent Lifecycle Security
- [ ] Provider can only request access (cannot self-approve)
- [ ] Patient is the sole approver of access requests
- [ ] PENDING relationships grant zero data access
- [ ] SUSPENDED/REVOKED/EXPIRED statuses block all data access
- [ ] Consent expiration (`consentExpiresAt`) enforced on every data query
- [ ] Expired consents automatically blocked (not just UI-hidden)
- [ ] Patient can revoke access at any time (immediate effect)
- [ ] Revocation cannot be undone by provider

### 2. Granular Permission Enforcement
- [ ] Each permission flag checked independently on data access:
  - `canViewBiomarkers` → biomarker endpoints
  - `canViewInsurance` → insurance plan endpoints
  - `canViewDna` → DNA/genetic data endpoints
  - `canViewHealthNeeds` → health needs endpoints
  - `canEditData` → mutation endpoints (POST/PATCH/DELETE)
- [ ] Permissions enforced at backend (not just frontend UI)
- [ ] Default permissions are restrictive (canViewDna=false, canEditData=false)
- [ ] Permission changes logged in audit trail

### 3. IDOR Prevention (Cross-User Access)
- [ ] Provider can only access patients with ACTIVE relationship
- [ ] Patient ID validated against ProviderPatient table on every request
- [ ] Provider cannot enumerate patients they don't have relationships with
- [ ] Provider cannot access patient data outside granted permissions
- [ ] No path parameter manipulation to access other patients
- [ ] RLS policies cover provider-patient queries

### 4. HIPAA Minimum Necessary Principle
- [ ] Provider only receives data within granted permission scope
- [ ] Responses filtered to exclude non-permitted data categories
- [ ] Bulk data endpoints respect per-patient permissions
- [ ] No "select all" that bypasses permission filtering

### 5. Audit Logging (Cross-User Access)
- [ ] All provider access to patient data is audit logged
- [ ] Audit log captures both provider ID and patient ID
- [ ] Consent grant/deny/revoke events logged
- [ ] Permission changes logged with old and new values
- [ ] Failed access attempts logged (provider without permission)
- [ ] Audit logs queryable by patient (who accessed my data?)

### 6. Relationship Data Security
- [ ] ProviderPatient `notesEncrypted` field encrypted before storage
- [ ] Unique constraint on providerId + patientId (no duplicate relationships)
- [ ] Relationship type validated against enum (PRIMARY_CARE, SPECIALIST, etc.)
- [ ] Provider email validated when requesting access
- [ ] Rate limiting on access request endpoint (prevent spam)

### 7. Frontend Authorization
- [ ] `useRBAC` hook correctly gates provider-only UI
- [ ] `RoleGuard` component prevents unauthorized component rendering
- [ ] Patient consent UI only visible to patients
- [ ] Provider patient list only visible to providers/admins
- [ ] Permission-based data sections hidden when not granted
- [ ] No client-side data leakage (e.g., prefetching unauthorized data)

### 8. Edge Cases
- [ ] Provider cannot access data after patient deletes their account
- [ ] Provider cannot access data during active account lockout
- [ ] Concurrent consent changes handled safely (no race conditions)
- [ ] Provider who is also a patient keeps roles separate
- [ ] Admin bypass documented and audit-logged

## Verification Commands
```bash
# Find provider route handlers
grep -r "providerRoutes\|patientRoutes" backend/src/routes/

# Check permission enforcement in controllers
grep -r "canViewBiomarkers\|canViewInsurance\|canViewDna\|canViewHealthNeeds\|canEditData" backend/src/

# Find cross-user queries (potential IDOR)
grep -r "patientId\|providerId" backend/src/controllers/ backend/src/routes/

# Verify audit logging on provider access
grep -r "auditLog.*provider\|auditLog.*patient\|PROVIDER\|PATIENT" backend/src/controllers/
```

## Questions to Ask
1. Can a provider access any patient data without an ACTIVE relationship?
2. Are expired consents checked on every request or only periodically?
3. Is there a notification system when a provider requests access?
4. What happens to shared data if the patient revokes access mid-session?
5. Are provider access patterns monitored for anomalies?
