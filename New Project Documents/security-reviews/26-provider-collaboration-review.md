# Provider-Patient Collaboration Security Review — 2026-06-16

Scope: consent lifecycle, granular permission enforcement, IDOR prevention, HIPAA minimum-necessary, cross-user audit logging, relationship-data security, frontend authorization, and edge cases for the provider-patient data-sharing feature. Reviewed at HEAD `fb2cd32`. Static review only (no live DB exercised). Files reviewed are listed in `prompts/26-provider-collaboration.md`; every check below cites a `file:line` proof.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 5 |

Overall: this is the most thoroughly hardened domain in the codebase. App-layer access flows through a single `resolveProviderAccess` choke point that requires the consent flag as an argument; the DB backstops it with `has_provider_access()`/`has_active_consent()` policies under `FORCE ROW LEVEL SECURITY` on all 19 RLS tables; consent booleans are DB-immutable to a provider's own UPDATE via a BEFORE-UPDATE trigger; and the enumeration-probe response is collapsed to a uniform body. The five findings are all Low: stale comments, dead defensive branches, a documented missing feature, and a cosmetic inconsistency. None is exploitable.

## Findings

### F-1 — Stale/inaccurate security comment on `getUserEncryptionSalt` in the request handler — **Low**
- **Location:** `backend/src/routes/providerRoutes.ts:233-237`
- **Observation:** The comment claims `getUserEncryptionSalt` "is not yet RLS-wrapped … under a NOBYPASSRLS role it will work because the salt belongs to the provider themselves. Flagged for Part 2b." That is no longer true. `getUserEncryptionSalt` *is* RLS-wrapped — it runs in an explicit **admin** context (`withRLSContext(null, …, { isAdmin: true })`), not the provider's own session, so its correctness does not depend on the salt "belonging to the provider." For provider PHI reads it actually decrypts the **patient's** salt (`providerRoutes.ts:480`, `:563`, `:637`), which an own-session policy would *deny* — the admin context is what makes those reads work at all.
- **Impact:** No runtime impact (behavior is correct). The risk is that a future maintainer trusts the comment, "fixes" it by switching to the provider's session, and breaks every provider PHI read (or, worse, reasons incorrectly about the trust boundary). Documentation drift on a security-sensitive path.
- **Fix:** Replace the comment with the accurate statement: `getUserEncryptionSalt` runs in admin RLS context (`userEncryption.ts:29-31, 70`) because salt lookup is infrastructure, not user-scoped; provider reads decrypt the *patient's* salt. Drop the "Part 2b / not yet RLS-wrapped" language.
- **Evidence:**
  ```ts
  // NOTE: `getUserEncryptionSalt` is one of the Part 2b bare-prisma call
  // sites (userEncryption.ts) and is not yet RLS-wrapped. Under the
  // current superuser DATABASE_URL this is a no-op; under a
  // NOBYPASSRLS role it will work because the salt belongs to the
  // provider themselves. Flagged for Part 2b.
  ```
  vs. the actual implementation:
  ```ts
  // userEncryption.ts:29-31, 70
  export async function getUserEncryptionSalt(userId: string): Promise<string> {
    return withRLSContext(null, async (tx) => { … }, { isAdmin: true });
  ```

### F-2 — Dead `APPROVED` status branch in provider roster UI — **Low**
- **Location:** `src/components/provider/MyPatientsPage.tsx:473`
- **Observation:** The roster computes `active` by accepting both `'ACTIVE'` and `'APPROVED'`: `const active = (rel.status||'').toUpperCase() === 'ACTIVE' || (rel.status||'').toUpperCase() === 'APPROVED';`. `APPROVED` is **not** a member of `ProviderPatientStatus` (`schema.prisma:578-584` defines only PENDING/ACTIVE/SUSPENDED/REVOKED/EXPIRED), and no backend code ever emits it. The branch is unreachable.
- **Impact:** Cosmetic only — no over-disclosure (the gate is permissive toward a value the server never returns, and the real security boundary is server-side). It signals a phantom status to future readers and could mask an actual contract drift if someone later relies on it.
- **Fix:** Drop the `|| … === 'APPROVED'` clause; key the gate solely on `'ACTIVE'`. Optionally derive the comparison from the shared status enum to prevent drift.
- **Evidence:**
  ```tsx
  const active = (rel.status || '').toUpperCase() === 'ACTIVE' || (rel.status || '').toUpperCase() === 'APPROVED';
  ```

### F-3 — No patient-facing "who accessed my data" access-history endpoint — **Low**
- **Location:** `backend/src/services/auditLog.ts:559-612` (`queryLogs` is admin-only); no patient route in `backend/src/routes/patientRoutes.ts`.
- **Observation:** Every provider PHI access is durably audit-logged (see Checks passed §5), and `audit_logs_select` RLS even permits a user to read their own rows (`20260107_add_rls_policies/migration.sql:512-517`). But there is no patient-facing route that surfaces "which providers viewed my data and when." `queryLogs` is only reachable through the ADMIN-gated admin routes; `patientRoutes.ts` exposes consent management only. A `Grep` for access-history routes returned only `providerRoutes.ts` (the provider side), confirming the absence.
- **Impact:** HIPAA §164.524 (right of access) and the "user owns their data / transparency" product principle are partially unmet: a patient cannot self-serve an accounting of disclosures even though the data and the RLS permission to read it exist. Not an exploit; a compliance/transparency gap the checklist explicitly asks to flag.
- **Fix:** Add `GET /patient/access-history` gated `requireRole('PATIENT')` that runs `withRLSContext(patientId, tx => tx.auditLog.findMany({ where: { resourceId: patientId / metadata.patientId, resourceType: { in: ['patient_biomarkers','patient_health_needs','patient_insurance','patient_detail'] } } }))` — or expose a filtered view of the existing audit query scoped to the patient as the subject. Note the resource-id model stores the patient id in `resourceId`/`metadata.patientId`, so the query must match on those.
- **Evidence:** `auditLog.ts:582-586` — `// Admin context — queryLogs is called from adminRoutes /audit-logs, which is already RBAC-gated to ADMIN.` No corresponding patient route exists in `patientRoutes.ts`.

### F-4 — Provider hard-delete vs. patient soft-revoke breaks audit joinability (known F-23) — **Low**
- **Location:** `backend/src/routes/providerRoutes.ts:727-729` (`tx.providerPatient.delete`) vs. `backend/src/routes/patientRoutes.ts:468-471` (`update { status: 'REVOKED' }`).
- **Observation:** When a provider removes a relationship it is a **hard delete** of the `provider_patients` row; when a patient revokes, it is a **soft** transition to `REVOKED`. The delete is audit-logged *before* the row is removed (`providerRoutes.ts:721-725`, threaded on `tx`), so the event itself is not lost, but the relationship row it references is gone, so later reconstruction ("show me the consent state at the time of access X") cannot join back to a live relationship row. The code itself documents this as deferred F-23.
- **Impact:** Weakens forensic reconstruction of historical consent state and the disclosure-accounting story (compounds F-3). No confidentiality impact — a deleted relationship correctly removes all RLS access. Low because the audit *event* is preserved with the relationship's permission snapshot in `previousValue`.
- **Fix:** Migrate the provider DELETE to a soft `status: 'REVOKED'` (mirroring the patient revoke), or introduce a `DELETED` terminal status, so the audit trail stays joinable. As the inline note says, this is a deliberate behavior change deserving its own PR.
- **Evidence:**
  ```ts
  // providerRoutes.ts:673-677
  // F-23 note: this is a hard delete, inconsistent with patientRoutes.ts's
  // soft-revoke pattern for the revoke endpoint. … Deliberately deferred …
  await tx.providerPatient.delete({ where: { id: relationship.id } });
  ```

### F-5 — `resolveProviderAccess` accepts a `now` param but re-derives `new Date()` for the patient-active check — **Low**
- **Location:** `backend/src/services/providerAccess.ts:54, 64, 73-78`
- **Observation:** The function takes `now: Date = new Date()` and uses it for the consent-expiry comparison via `new Date(relationship.consentExpiresAt) < now` (`:64`). But the patient-active/lock check uses the captured `now` correctly (`lockedUntil: { lt: now }`, `:77`) — that part is consistent. The minor inconsistency is at `:64`: it wraps the already-`Date`-typed `consentExpiresAt` in a redundant `new Date(...)`. There is no second wall-clock read inside, so the time-of-check is internally consistent; this is a code-clarity nit rather than a TOCTOU. (Callers also re-check expiry in the handler with a fresh `new Date()` at `providerRoutes.ts:383`, etc., which is harmless redundancy.)
- **Impact:** None functionally — the captured `now` is used for both time-sensitive comparisons within a single transaction. Flagged only as a hygiene/clarity item so a future edit doesn't accidentally introduce a real split-clock.
- **Fix:** Drop the redundant `new Date(relationship.consentExpiresAt)` wrap (it is already a `Date`) and compare directly against `now`. Keep the single captured `now` as the only clock source.
- **Evidence:**
  ```ts
  // providerAccess.ts:54
  now: Date = new Date()
  // :64
  if (relationship.consentExpiresAt && new Date(relationship.consentExpiresAt) < now) {
  ```

## Checks passed

### 1. Consent Lifecycle Security
- [x] Provider requests access only via `POST /provider/patients/request`; cannot self-approve — status is forced to `PENDING` on create/upsert and only patient routes flip it to `ACTIVE`. Verified `providerRoutes.ts:274-285` (create/update both set `status: 'PENDING'`) and `patientRoutes.ts:230` (only approve sets `'ACTIVE'`).
- [x] `patientRoutes.ts` gated `requireRole('PATIENT')` — patient is the sole approver/denier/revoker. Verified `patientRoutes.ts:22-24`.
- [x] PENDING grants zero data access — every PHI route requires `status === 'ACTIVE'` via `resolveProviderAccess` (`providerAccess.ts:61-63`) and the detail route checks it directly (`providerRoutes.ts:372`).
- [x] SUSPENDED/REVOKED/EXPIRED block all data access — the gate is positive (`status !== 'ACTIVE'` → reject), so anything non-ACTIVE is denied. Verified `providerAccess.ts:61-63`.
- [x] Consent expiration enforced in handler AND RLS — `providerAccess.ts:64-66` (handler) and `has_provider_access()` `pp.consent_expires_at > NOW()` (`20260529_fix_has_provider_access/migration.sql:30`) + `has_active_consent()` (`20260530_add_users_select_provider/migration.sql:43`).
- [x] Expired consents blocked independent of `status` — pure time check `consentExpiresAt < now()` in both the DB functions and `resolveProviderAccess`; expiry is time-derived, not a status flip (no background EXPIRED-flip job needed). Verified `providerAccess.ts:64` and migration line 30.
- [x] Patient can revoke at any time via `POST /patient/providers/:id/revoke` (immediate soft update to REVOKED). Verified `patientRoutes.ts:422-471`.
- [x] `PATCH /patient/providers/:id` rejects edits on expired relationships — re-checks `consentExpiresAt` even when `status==='ACTIVE'`. Verified `patientRoutes.ts:369-377`.
- [x] Revocation cannot be undone by provider — no provider route mutates `status` to ACTIVE; the only ACTIVE write is patient approve (`patientRoutes.ts:230`). Re-request upserts back to `PENDING`, not ACTIVE (`providerRoutes.ts:282`).
- [x] Re-requesting an already-ACTIVE/PENDING patient is rejected with ForbiddenError. Verified `providerRoutes.ts:258-265`.

### 2. Granular Permission Enforcement
- [x] `canViewBiomarkers` → biomarkers route gated via `resolveProviderAccess(tx,…,'canViewBiomarkers')`. Verified `providerRoutes.ts:456`.
- [x] `canViewHealthNeeds` → health-needs route gated. Verified `providerRoutes.ts:539`.
- [x] `canViewInsurance` → insurance route gated (M3, wired). Verified `providerRoutes.ts:611`.
- [x] `canEditData` stays intentionally orphaned — no provider POST/PUT/PATCH route exists (only `POST /patients/request` at `providerRoutes.ts:171`); approve omits it (`patientRoutes.ts:194-198`), updatePermissions omits it (`patientRoutes.ts:340, 392`), and the UI toggle is removed (`CareTeamPage.tsx:41-51`, only 3 labels). `canEditData` references are read-only response fields (`providerRoutes.ts:126, 416`). DB column + RLS `'edit'` branch retained (`schema.prisma:132`, `20260529_fix_has_provider_access/migration.sql:35`).
- [x] `canViewDna`/`can_view_dna` fully removed from live code — `Grep` hits confined to the drop migration (`20260423_drop_dna_genetics`), the fix migration comments (`20260529_fix_has_provider_access`), the initial schema, and a test comment (`rls.test.ts:292`). No reference in any controller/route/service.
- [x] Permission enforced at backend route handler AND RLS `has_provider_access(user_id,<perm>)`, holding under FORCE RLS. Verified handler choke point (`providerAccess.ts:67`) + RLS branches on `biomarkers_select`/`insurance_plans_select`/`health_needs_select` (`20260107_add_rls_policies/migration.sql:155, 222, 388`) + FORCE on all tables (`20260613_force_rls_and_audit_retention/migration.sql:14-31` + `20260613_revoked_access_tokens/migration.sql:27`).
- [x] Consent columns DB-immutable to a provider's own UPDATE — BEFORE UPDATE trigger `provider_patients_guard_consent()` restores the 4 booleans to OLD unless writer is patient/admin. Verified `20260615_provider_consent_immutable_audit_insert_check/migration.sql:19-36`.
- [x] Restrictive schema defaults — `canViewInsurance`/`canEditData` default `false`, `canViewBiomarkers`/`canViewHealthNeeds` default `true`. Verified `schema.prisma:129-132`.
- [x] approve/updatePermissions accept only the 4 known booleans (no injection) — Zod `schemas.providerPatient.approve`/`updatePermissions` enumerate exactly those keys; `validate()` replaces `req.body` with the parsed output. Verified `validation.ts:672-685, 239-248`.
- [x] Permission changes logged with before/after — `logUpdate('provider_consent_permissions', …, previousPermissions, {new}, …, { operation: 'PERMISSIONS_UPDATED' })`. Verified `patientRoutes.ts:379-405`.

### 3. IDOR Prevention
- [x] Provider access keyed on the compound unique `providerId_patientId` with ACTIVE+unexpired check. Verified `providerAccess.ts:56-57` and `schema.prisma:143`.
- [x] `:patientId` validated (`schemas.patientIdParam`, UUID) and joined to the provider's own row each request. Verified `providerRoutes.ts:444, 528, 604, 661` + `validation.ts:342-344`.
- [x] Provider cannot enumerate non-related patients — `GET /provider/patients` lists only the provider's own `provider_patients` rows (`providerRoutes.ts:75-81`); email/createdAt disclosed only for ACTIVE-unexpired relationships (`providerRoutes.ts:83-120`); PENDING/expired disclose neither.
- [x] `POST /provider/patients/request` returns a uniform generic body for not-found / not-PATIENT / valid-patient (real reason kept only in audit). Verified `providerRoutes.ts:204-230`.
- [x] Provider cannot access data outside granted permissions — `resolveProviderAccess` returns `permission_denied` when the required flag is false (`providerAccess.ts:67-68`), backed by per-permission RLS branches.
- [x] No path-param manipulation path — all reads are scoped by `userId: patientId` *inside* the provider's RLS transaction, so RLS filters cross-tenant rows even if a check were missed. Verified `providerRoutes.ts:455-463, 538-546, 610-619`.
- [x] All provider/patient queries run inside `withRLSContext`; the only `{ isAdmin: true }` lifts are the email→id lookup (`providerRoutes.ts:186-195`) and provider display-info lookups (`patientRoutes.ts:49-63, 129-143`), each with a minimal non-secret column allowlist.
- [x] `20260529_fix_has_provider_access` applied — function recreated without the `view_dna` branch that previously threw for every permission type under NOBYPASSRLS. Verified `20260529_fix_has_provider_access/migration.sql:20-42`.
- [x] `users_select_provider` is row-level; every provider-context user read uses an explicit non-secret allowlist (`{ id, email, createdAt }` / `{ id, email, firstNameEncrypted, lastNameEncrypted, … }`), never `passwordHash`/`*Token`. Verified `providerRoutes.ts:98, 357-364`, `patientRoutes.ts:54-60, 134-140`, and the policy's column-scope caveat (`20260530_add_users_select_provider/migration.sql:16-29, 54-56`).

### 4. HIPAA Minimum Necessary
- [x] Provider receives only data within granted permission scope — each PHI route requires its specific flag (§2).
- [x] Responses filtered to permitted categories — the route only queries the resource its flag gates; no cross-category bleed. Verified `providerRoutes.ts:458-461, 541-544, 613-617`.
- [x] Bulk/list endpoints respect per-relationship state — `GET /provider/patients` discloses identity only for ACTIVE-unexpired rows (`providerRoutes.ts:83-120`).
- [x] No "select all" bypass — provider reads are always `where: { userId: patientId }` under provider RLS, never an unscoped findMany. Verified `providerRoutes.ts:459, 542, 614`.

### 5. Audit Logging (Cross-User Access)
- [x] All provider PHI access audit-logged with `PHI_ACCESS`/`VIEW_PATIENT` ops on `patient_biomarkers`/`patient_health_needs`/`patient_insurance`/`patient_detail`. Verified `providerRoutes.ts:424-428, 507-512, 581-586, 640-645`.
- [x] Audit captures provider id (`userId: providerId`) and patient id (`resourceId` + `patientId` metadata). Verified `providerRoutes.ts:507-510`.
- [x] Consent grant/deny/revoke/delete logged (`CONSENT_GRANTED`/`CONSENT_DENIED`/`CONSENT_REVOKED`/`RELATIONSHIP_DELETED`). Verified `patientRoutes.ts:251, 311, 464, 525`.
- [x] Consent-write audits threaded onto the RLS `tx` so they commit atomically. Verified `{ req, userId, tx }` at `patientRoutes.ts:250, 310, 402, 463, 524` and `providerRoutes.ts:299, 725`; `auditLog.ts:319-328` writes on the threaded tx.
- [x] Audit rows cannot be forged to an arbitrary `user_id` — `audit_logs_insert` WITH CHECK tightened to `user_id=current_user_id() OR is_admin_session() OR current_user_id() IS NULL`. Every consent/provider audit insert is either tx-threaded in the acting user's own context (satisfies `user_id=current_user_id()`) or standalone-admin (`auditLog.ts:329-339`). Verified `20260615_provider_consent_immutable_audit_insert_check/migration.sql:69-76`.
- [x] Permission changes logged with old+new values. Verified `patientRoutes.ts:379-405`.
- [x] Failed access attempts logged with specific reason — `no_relationship`/`relationship_not_active`/`consent_expired`/`permission_denied`/`patient_inactive_or_locked` all emitted (`providerRoutes.ts:377, 387, 396, 468-475`; reasons defined `providerAccess.ts:29-34`).
- [x] Enumeration probes logged with real reason (`patient_not_found` vs `not_patient_role`) despite the collapsed API response. Verified `providerRoutes.ts:213-217, 223-227`.

### 6. Relationship Data Security
- [x] `notesEncrypted` encrypted with the provider's salt before storage (AES-256-GCM). Verified `providerRoutes.ts:238-242` and `PHI_FIELDS` `ProviderPatient.notesEncrypted` (`_phi-inventory.md:71-73`).
- [x] `@@unique([providerId, patientId])` enforced; request uses `upsert` on the compound key. Verified `schema.prisma:143` and `providerRoutes.ts:267-273`.
- [x] `relationshipType` validated against the enum via Zod. Verified `validation.ts:668`.
- [x] Patient email validated as email; message sanitized + capped at 500. Verified `validation.ts:666-669`.
- [x] Rate limiting on request endpoint — `providerAccessRequestLimiter` 10/hour, user-keyed, Redis-capable. Verified `rateLimiter.ts:211-237` and mount at `providerRoutes.ts:173`.

### 7. Frontend Authorization
- [x] `useRBAC` provides role checks (advisory; backend is the boundary). Verified `src/hooks/useRBAC.ts:34-47`.
- [x] `RoleGuard`/`PatientOnly`/`ProviderOnly`/`ProviderOrAdmin` exist and gate by role. Verified `src/components/common/RoleGuard.tsx:55-122`.
- [x] Patient consent UI is patient-facing (CareTeamPage) and provider roster is provider-facing (MyPatientsPage); both note the backend is the real boundary. Verified `CareTeamPage.tsx:1-9`, `MyPatientsPage.tsx:8-12`.
- [x] Permission-based sections hidden when not granted — biomarkers/health-needs/insurance panels render only when the corresponding `permissions.*` flag is true, and gated sub-fetches only fire then. Verified `MyPatientsPage.tsx:155-163, 233, 280, 320`.
- [x] No client-side over-fetch — sub-fetches are conditioned on the granted permission flag, and a failed/denied sub-fetch renders an error rather than a false-empty (PA-1). Verified `MyPatientsPage.tsx:154-164, 184-198`.

### 8. Edge Cases
- [x] Provider loses access after patient deactivates/deletes — `User.findFirst` filters `isActive: true` (`providerAccess.ts:73-81`, `providerRoutes.ts:350-354`); relationships cascade-delete on user delete (`schema.prisma:140-141`).
- [x] Provider loses access during lockout — `lockedUntil` null-or-past filter; reason `patient_inactive_or_locked`. Verified `providerAccess.ts:77, 81`.
- [x] Concurrent consent changes safe — read+write wrapped in one `withRLSContext` transaction per mutation. Verified `patientRoutes.ts:208, 284, 345, 433, 497`.
- [x] Provider-who-is-also-patient — single `role` per user (`schema.prisma:564-568`); `requireRole` gates each route family (`providerRoutes.ts:28`, `patientRoutes.ts:24`).
- [x] Cannot self-elevate `role`/`is_active` — BEFORE UPDATE trigger `users_prevent_self_privilege_change` rejects non-admin changes. Verified `20260424_prevent_self_role_elevation/migration.sql:41-62`.
- [x] Admin bypass documented + audited — provider routes accept `requireRole('PROVIDER','ADMIN')` (`providerRoutes.ts:28`); admin RLS lifts are explicit `{ isAdmin: true }` with allowlists, and audits attribute the acting user.
- [x] CSRF on all mutations — `csrfProtection` mounted app-wide before the router (`app.ts:216`), validating POST/PATCH/DELETE; no provider/patient path is on `EXEMPT_PATHS` (`csrf.ts:124-145`). Double-submit with constant-time compare (`csrf.ts:177-183`).

## Unverifiable
- **Live NOBYPASSRLS behavior of the RLS policies/triggers** — this is a static review; the `has_provider_access`/`has_active_consent` functions, the consent-immutability trigger, and the `audit_logs_insert` WITH CHECK were read in migration SQL but not exercised against a running NOBYPASSRLS Postgres in this run. Memory notes a prior live-PG validation of `20260615` (L23/L40) under the dedicated RLS test job; treat that as the live evidence.
- **Whether all 19 RLS tables are FORCE-protected in the deployed DB** — verified in migration source (18 in `20260613_force_rls_and_audit_retention` + `revoked_access_tokens` in `20260613_revoked_access_tokens`) and backstopped at boot by `assertRLSForced()` (`database.ts:270-312`), but the actual prod catalog state was not queried here.

## Out of scope
- **Encryption-service internals (AES-256-GCM, PBKDF2 key derivation, master-key handling).** Covered by `02-encryption.md`; this review only confirmed `notesEncrypted` and patient-salt usage at the call sites.
- **CSRF mechanism deep-dive.** Confirmed the provider/patient mutations are protected app-wide; the double-submit design itself is covered by `04-csrf.md`.
- **Generic rate-limiter store/Redis posture.** Confirmed `providerAccessRequestLimiter` exists, is user-keyed, and is mounted; the multi-instance MemoryStore-vs-Redis posture is covered by `08-rate-limiting.md`.
- **Admin-route provider-relationship editing (`schemas.admin.updateProviderRelationship`).** Belongs to the admin-panel review; noted only that it is `.strict()` and enum-validated (`validation.ts:915-921`).
- **AI/FHIR/expense PHI paths.** Out of the provider-collaboration surface.
