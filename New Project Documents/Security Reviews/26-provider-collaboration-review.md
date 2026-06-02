# 26-provider-collaboration Review — 2026-06-01

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 5 |
| Info | 2 |

Scope: provider-patient consent lifecycle, granular permission enforcement, IDOR/RLS backstop, HIPAA minimum-necessary, cross-user audit logging, relationship data security, frontend authorization, and edge cases — verified against the live backend routes, RBAC middleware, RLS migrations, encryption/audit services, and the React consent/roster UI.

The consent core is strong: every data route gates on `status === 'ACTIVE'` plus a `consentExpiresAt` time check **and** is backstopped at the DB by `has_provider_access()` / `users_select_provider`; the email-enumeration response is collapsed; the self-role-elevation trigger is in place; `notesEncrypted` uses the provider's per-user salt. Findings are concentrated in (a) audit-atomicity gaps on the provider-side write path, (b) an unvalidated admin status mutation, and (c) orphaned permission flags / dead RBAC helpers that create drift risk.

## Findings

### F-1 — Provider access-request audit rows are not atomic with the relationship write — **Medium**
- **Location:** `backend/src/routes/providerRoutes.ts:227` (write) and `:271` (audit)
- **Observation:** The `POST /provider/patients/request` handler performs the `upsert` of the `provider_patients` row inside `withRLSContext(providerId, ...)`, then calls `auditService.logCreate(...)` **after** the transaction has committed, without threading `tx`. The patient-side consent writes (approve/deny/revoke/delete) all thread `{ ..., tx }` so the audit row commits atomically (e.g. `patientRoutes.ts:248`), but the provider request path does not. Checklist item 5 ("Consent-write audit rows are threaded onto the RLS `tx` so they commit atomically") therefore fails on this one endpoint.
- **Impact:** If the audit `INSERT` fails (DB blip, encryption error) the relationship has already been created as PENDING with no durable audit record of who initiated it — and because `logCreate` is `failClosed`, the request returns a 500 to the provider even though the relationship persisted, leaving an orphaned PENDING row the audit trail can't explain. Weakens HIPAA §164.312(b) reconstructability for the request event specifically.
- **Fix:** Move the `logCreate` call inside the `withRLSContext(providerId, async (tx) => {...})` block and pass `{ req, userId: providerId, tx }`, mirroring the patient-side pattern. The `audit_logs_insert` policy is `WITH CHECK (true)` so the provider-scoped tx is permitted.
- **Evidence:**
  ```ts
  const relationship = await withRLSContext(providerId, async (tx) => { ... return tx.providerPatient.upsert(...) });
  // ...transaction already committed...
  await auditService.logCreate('provider_patient_request', relationship.id, {...}, { req, userId: providerId });
  ```

### F-2 — Admin relationship PATCH accepts unvalidated `status` (and permission flags) from the body — **Medium**
- **Location:** `backend/src/routes/adminRoutes.ts:693-721`
- **Observation:** `PATCH /admin/provider-relationships/:id` validates only the URL param (`schemas.uuidParam, 'params'`) and then destructures `status, canViewBiomarkers, ...` directly from `req.body` with no Zod body schema. `status` is written straight through (`...(status && { status })`) into the `ProviderPatientStatus` column. There is no `schemas.adminProviderRelationship.update` equivalent. The checklist (§1) asserts "no provider endpoint mutates `status` to ACTIVE; only patient `approve` can" and (§2) "approve/updatePermissions only accept the 4 known boolean flags … no permission injection" — both hold for provider/patient routes, but this admin route is the one unguarded mutation surface.
- **Impact:** An authenticated ADMIN can set `status` to any string (Prisma will reject values outside the enum at the driver layer, but non-boolean permission values and arbitrary status transitions such as re-activating a patient-REVOKED relationship are possible). Admin is trusted, so this is not a privilege-escalation path, but it (a) lets an admin silently re-grant access a patient deliberately revoked with no consent re-collection, undermining "Revocation cannot be undone by provider," and (b) accepts unvalidated input into a PHI-gating column. Blast radius is bounded to ADMIN actors but is audit-logged after the fact only.
- **Fix:** Add a Zod body schema (`status: z.enum([...ProviderPatientStatus]).optional()`, the 4 booleans as `z.boolean().optional()`) and `validate(...)` it on this route. Consider blocking admin re-activation of a REVOKED relationship without an explicit re-consent flag.
- **Evidence:**
  ```ts
  const { status, canViewBiomarkers, canViewInsurance, canViewHealthNeeds, canEditData } = req.body;
  // ...
  data: { ...(status && { status }), ...(canViewBiomarkers !== undefined && { canViewBiomarkers }), ... }
  ```

### F-3 — `canViewInsurance` and `canEditData` are grantable but have no consuming route (orphaned permissions) — **Low**
- **Location:** `backend/src/routes/providerRoutes.ts` (no insurance/write route) vs `backend/src/middleware/validation.ts:557` and `:559`
- **Observation:** The approve/update schemas accept `canViewInsurance` and `canEditData`, the schema defaults them (`InsurancePlan` provider RLS branch `has_provider_access(user_id,'view_insurance')` exists), but `providerRoutes.ts` exposes **no** provider-facing insurance read route and **no** write/PATCH/POST route on patient data — the only routes are GET detail, GET biomarkers, GET health-needs, and DELETE relationship. A grep for `insurance` in `providerRoutes.ts` returns zero matches; `canEditData` is consumed only inside `rbac.ts` `checkProviderPatientAccess`, which is itself unwired (see F-4).
- **Impact:** A patient can toggle on `canViewInsurance`/`canEditData` believing it grants/permits something, but no endpoint consumes them, so the consent UI overstates capability. Conversely, when an insurance-read or provider-edit route is later added, the developer must remember the RLS branch already exists — risk of an under-gated rollout. No current disclosure.
- **Fix:** Either wire the routes (gated on the flag in handler + the existing RLS branch) or hide/remove the unconsumed flags from the patient consent UI and approve schema until a consumer exists. Document the orphan in the model docblock.
- **Evidence:**
  ```ts
  canViewInsurance: z.boolean().optional().default(false),
  ...
  canEditData: z.boolean().optional().default(false),
  ```

### F-4 — `requireResourceAccess` / `requireOwnership` / `checkProviderPatientAccess` / `enforceUserScope` are dead code on the collaboration path — **Low**
- **Location:** `backend/src/middleware/rbac.ts:121,202,256,320`
- **Observation:** These exported middleware/helpers implement the consent-aware access model (relationship lookup + status + expiry + per-resource flag), but a repo-wide grep shows they are referenced only inside `rbac.ts` and `rbac.test.ts` — never imported by `providerRoutes.ts`, `patientRoutes.ts`, or any other route module. The live provider routes re-implement the same status/expiry/flag checks inline in each handler. The spec lists `checkProviderPatientAccess` and `requireOwnership` as files to review as if they are on the request path.
- **Impact:** Two parallel implementations of the same authorization logic. The tested-but-unused middleware can drift from the inline handler checks (e.g. `checkProviderPatientAccess` for `healthNeed` returns `canViewBiomarkers` for read — see F-5 — but the route uses `canViewHealthNeeds`), giving false assurance from green RBAC unit tests that don't cover the actual enforcement path.
- **Fix:** Either adopt the middleware on the provider routes (replacing the inline checks) or delete the unused exports to remove the drift surface. If kept for a future generic controller, mark them clearly as not-yet-wired.
- **Evidence:**
  ```ts
  export function requireResourceAccess(resource: ResourceType, permission: Permission = 'read') {
  ```

### F-5 — Dead helper `checkProviderPatientAccess` maps `healthNeed` reads to the biomarker flag — **Low**
- **Location:** `backend/src/middleware/rbac.ts:238-242`
- **Observation:** In the unused `checkProviderPatientAccess`, `resource === 'biomarker' || resource === 'healthNeed'` are collapsed into one branch where read returns `relationship.canViewBiomarkers`. So a health-needs read is authorized by the *biomarker* flag, not `canViewHealthNeeds`. The live route (`providerRoutes.ts:585`) correctly gates health-needs on `rel.canViewHealthNeeds`, so this is latent, not active.
- **Impact:** If F-4 is resolved by wiring this middleware onto a future health-needs route, a provider granted only `canViewBiomarkers` would gain health-needs access (or one granted only `canViewHealthNeeds` would be denied) — a permission-scope inversion. Currently dormant because the helper is unwired.
- **Fix:** Split the `healthNeed` case to return `relationship.canViewHealthNeeds` for `read`. Best resolved together with F-4.
- **Evidence:**
  ```ts
  if (resource === 'biomarker' || resource === 'healthNeed') {
    if (permission === 'read') return relationship.canViewBiomarkers;
  ```

### F-6 — "Care Team" patient-consent nav item is not role-restricted — **Low**
- **Location:** `src/data/sampleData.ts:229` (vs `:230`, `:233`)
- **Observation:** `My Patients` carries `roles: ['PROVIDER', 'ADMIN']` and `Admin` carries `roles: ['ADMIN']`, but the `Care Team` category (the patient-facing consent UI) has **no** `roles` key, so `Dashboard.tsx:135` (`categories.filter((c) => !c.roles || c.roles.includes(role))`) shows it to every role including PROVIDER/ADMIN. Checklist §7 requires "Patient consent UI only visible to patients."
- **Impact:** A PROVIDER or ADMIN sees a "Care Team" menu entry that renders `CareTeamPage`, which calls `patientApi.*` → `/patient/*` routes gated by `requireRole('PATIENT')`. The backend returns 403, so no data leaks — this is a cosmetic/role-hygiene inconsistency and a confusing empty/error UI, not an authorization bypass. The real gate (server-side `requireRole`) holds.
- **Fix:** Add `roles: ['PATIENT']` to the `Care Team` category entry, matching the pattern used for the provider/admin entries.
- **Evidence:**
  ```ts
  { name: 'Care Team', description: 'Manage who can access your health data', icon: 'Users', group: 'care' },
  { name: 'My Patients', ..., roles: ['PROVIDER', 'ADMIN'] },
  ```

### F-7 — `Dashboard.renderCategory` re-renders provider/admin pages without a role recheck — **Low**
- **Location:** `src/components/dashboard/Dashboard.tsx:300-317`
- **Observation:** The `case 'My Patients'` / `case 'Admin'` / `case 'Care Team'` branches render their pages directly. Authorization relies entirely on the nav-list filter (`visibleCategories`); the render switch itself does not re-check role and does not wrap the pages in the available `ProviderOnly` / `AdminOnly` / `PatientOnly` guards. The `RoleGuard` family is defined and exported (`src/components/common/RoleGuard.tsx`) but a grep shows it is used by nothing outside its own file/barrel.
- **Impact:** Defense-in-depth gap only. If a future code path sets `selectedCategory` without going through the filtered nav (deep link, programmatic navigation, a bug in the filter), the page renders for the wrong role. No PHI leaks because the backend routes enforce role, but it defeats the purpose of the existing `RoleGuard` components.
- **Fix:** Wrap the `My Patients`/`Admin`/`Care Team` render branches in `ProviderOrAdmin` / `AdminOnly` / `PatientOnly` respectively, so UI gating doesn't depend solely on the nav filter.
- **Evidence:**
  ```tsx
  case 'My Patients':
    return ( <Suspense fallback={<PageLoadSpinner />}> <MyPatientsPage /> </Suspense> );
  ```

### F-8 — Prompt drift: stale DNA-policy artifacts in the original RLS migration — **Info / Low (prompt-accuracy)**
- **Location:** `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:53,292,319,355`
- **Observation:** The checklist (§2) says "confirm no dead reference [to `canViewDna`/`view_dna`] remains in code or RLS functions." The live `has_provider_access()` was correctly recreated without the `view_dna` branch in `20260529_fix_has_provider_access`, and `20260423_drop_dna_genetics` dropped the column and tables. But the **original** `20260107` migration file still contains the `WHEN 'view_dna'` branch and `dna_*` table policies referencing `has_provider_access(..., 'view_dna')`. These are historical migration text (already superseded by later migrations) and Postgres no longer has the objects, so they are inert — but a grep for `view_dna` is non-empty, which contradicts the spec's "zero hits outside the drop migration" expectation in the Verification Commands block.
- **Impact:** None at runtime (superseded). Pure prompt/doc drift: the verification command's stated expectation ("zero hits") is wrong because applied migrations are never edited; the residual hits live in `20260107` and `20260529`'s explanatory comments, not just the drop migration.
- **Fix:** Update the spec's Verification Command note to expect hits in `20260107` (historical), `20260423` (drop), and `20260529` (fix) — i.e. only the *current function body* and live code must be DNA-free, not the migration history.
- **Evidence:**
  ```sql
  WHEN 'view_dna' THEN pp.can_view_dna
  ...
  OR has_provider_access(user_id, 'view_dna')
  ```

### F-9 — No patient-facing "who accessed my data" endpoint (known gap) — **Info**
- **Location:** `backend/src/services/auditLog.ts` (`queryLogs` is admin-only, `:505-524`); no patient route in `patientRoutes.ts`
- **Observation:** Checklist §5 asks to verify whether a patient-facing access-history endpoint exists and to "flag as a gap if still required." `queryLogs` is wrapped `{ isAdmin: true }` and is only called from admin routes; `patientRoutes.ts` exposes no "access history" route. This matches the spec's own note that no such route currently exists.
- **Impact:** Patients cannot self-serve "which providers viewed my data and when," which HIPAA's accounting-of-disclosures expectations (§164.528) lean toward. All accesses ARE audit-logged (provider VIEW_PATIENT / PHI_ACCESS with patientId), so the data exists; only the patient-facing surface is missing. Not a vulnerability — a compliance feature gap.
- **Fix:** Add `GET /patient/access-history` returning the patient's own audit rows where they are the resource subject (filter by `patientId` metadata / resourceId), wrapped in the patient's RLS context. Tracked as future work.
- **Evidence:**
  ```ts
  // queryLogs ... Admin context — queryLogs is called from adminRoutes /audit-logs
  return withRLSContext(null, async (tx) => {...}, { isAdmin: true });
  ```

## Checks passed

### 1. Consent Lifecycle Security
- [x] Provider can only request via `POST /provider/patients/request`; cannot self-approve — request handler only ever writes `status: 'PENDING'`, never ACTIVE (`providerRoutes.ts:258,262`).
- [x] `patientRoutes.ts` gated `requireRole('PATIENT')` as the sole approver/denier/revoker — `patientRoutes.ts:24`.
- [x] PENDING grants zero data access; every data route requires `status === 'ACTIVE'` — `providerRoutes.ts:345,472,612` (detail/biomarkers/health-needs) and the viable-check `:443-447,:583-587`.
- [x] Anything not ACTIVE (SUSPENDED/REVOKED/EXPIRED) is rejected — `relationship.status !== 'ACTIVE'` branch throws ForbiddenError, `providerRoutes.ts:345,472,612`.
- [x] Consent expiration enforced in handlers AND RLS functions — handler `consentExpiresAt < new Date()` (`providerRoutes.ts:356,483,623`) and SQL `consent_expires_at > NOW()` in `has_provider_access` (`20260529_fix_has_provider_access/migration.sql:30`) and `has_active_consent` (`20260530_add_users_select_provider/migration.sql:43`).
- [x] Expiry is time-derived independent of `status` (no background EXPIRED flip relied upon) — time check is a separate condition from the status check in every handler, e.g. `providerRoutes.ts:356`.
- [x] Patient revoke is an immediate soft update to REVOKED — `patientRoutes.ts:464-467`.
- [x] `PATCH /patient/providers/:id` re-checks `consentExpiresAt` and rejects edits on expired consent even when status is ACTIVE — `patientRoutes.ts:365-373`.
- [x] No provider endpoint mutates `status` to ACTIVE; only patient `approve` sets ACTIVE — `patientRoutes.ts:226`; provider routes never write ACTIVE (admin route is the only other writer, see F-2).
- [x] Re-requesting an already-ACTIVE or already-PENDING patient is rejected with ForbiddenError — `providerRoutes.ts:238-243`.

### 2. Granular Permission Enforcement
- [x] `canViewBiomarkers` gates `GET /provider/patients/:patientId/biomarkers` in handler — `providerRoutes.ts:447,493`.
- [x] `canViewHealthNeeds` gates `GET /provider/patients/:patientId/health-needs` in handler — `providerRoutes.ts:587,633`.
- [x] Permission enforced at handler AND RLS branch — handler flag checks plus `has_provider_access(user_id,'view_biomarkers'|'view_health_needs')` (`20260529_fix_has_provider_access/migration.sql:32-34`).
- [x] `canViewDna` fully removed from code and the live RLS function — only migration-history hits remain (see F-8); `has_provider_access` body has no `view_dna` branch (`20260529.../migration.sql:31-37`).
- [x] Schema defaults restrictive — `canViewInsurance` / `canEditData` default false; `canViewBiomarkers` / `canViewHealthNeeds` default true (`schema.prisma:98-101`).
- [x] approve/updatePermissions accept only the 4 known booleans (+ `consentDurationDays` on approve) — `validation.ts:555-568`; no permission injection (handlers destructure named fields, `patientRoutes.ts:188-194,336`).
- [x] Permission changes logged before/after on `provider_consent_permissions` op `PERMISSIONS_UPDATED` — `patientRoutes.ts:393-401`.

### 3. IDOR Prevention
- [x] Provider access keyed on the `providerId_patientId` compound unique with ACTIVE+unexpired checks — `providerRoutes.ts:308-315,431-447`.
- [x] `:patientId` validated as UUID via `schemas.patientIdParam` on every data route — `providerRoutes.ts:294,417,561`; `validation.ts:241-243`.
- [x] `GET /provider/patients` lists only the provider's own rows; email/createdAt disclosed only for ACTIVE unexpired relationships — `providerRoutes.ts:54-79,91-100`.
- [x] `POST .../request` returns a uniform generic response for not-found / not-patient / valid, with the real reason kept only in the audit log — `providerRoutes.ts:183-209`.
- [x] All provider/patient queries run inside `withRLSContext`; cross-tenant identity lookups use explicit `{ isAdmin: true }` with a non-secret column allowlist — `providerRoutes.ts:51,165-174,227,305`; `patientRoutes.ts:37,49-63`.
- [x] `20260529_fix_has_provider_access` applied — function recreated without the column that 500'd all multi-tenant reads under NOBYPASSRLS (`20260529.../migration.sql:20-42`).
- [x] `users_select_provider` is row-level; every provider-context user read uses a non-secret allowlist (`{ id, email, ... }`, never `passwordHash`/`*Token`) — `providerRoutes.ts:77,329-337,457`; policy `20260530.../migration.sql:54-56`.

### 4. HIPAA Minimum Necessary
- [x] Provider responses scoped to permission — biomarkers/health-needs only returned when the corresponding flag is set (`providerRoutes.ts:443-466,583-606`).
- [x] No "select all" bypass — every provider PHI query is `where: { userId: patientId }` inside the provider RLS context, never an unscoped findMany.
- [x] Patient-identity disclosure minimized — provider detail select is `{ id, email, firstNameEncrypted, lastNameEncrypted, createdAt, lastLoginAt }` and only encrypted name columns (undecryptable without the patient's key) plus email are returned (`providerRoutes.ts:329-337,375-381`).

### 5. Audit Logging
- [x] All provider PHI access audit-logged with `VIEW_PATIENT` / `PHI_ACCESS` ops on `patient_detail`/`patient_biomarkers`/`patient_health_needs` — `providerRoutes.ts:397,540,671`.
- [x] Audit captures provider (`userId`) and patient (resourceId + `patientId` metadata) — `providerRoutes.ts:397-401`.
- [x] Consent grant/deny/revoke/delete logged (`CONSENT_GRANTED`/`CONSENT_DENIED`/`CONSENT_REVOKED`/`RELATIONSHIP_DELETED`) — `patientRoutes.ts:249,309,460,521`.
- [x] Patient-side consent-write audit rows threaded onto `tx` for atomicity — `patientRoutes.ts:248,308,459,520` (provider request path is the exception, F-1).
- [x] Failed access attempts logged with specific reason (`no_relationship`/`relationship_not_active`/`consent_expired`/`permission_denied`/`patient_inactive_or_locked`) — `providerRoutes.ts:350,361,498,507`.
- [x] Enumeration probes on `/request` logged with real reason (`patient_not_found` vs `not_patient_role`) despite collapsed API response — `providerRoutes.ts:195,205`.

### 6. Relationship Data Security
- [x] `notesEncrypted` encrypted with the provider's per-user salt (AES-256-GCM) before storage — `providerRoutes.ts:219-221`; `encryption.ts:262-278`; `ProviderPatient` in `PHI_FIELDS` (`encryption.ts:435-437`).
- [x] `@@unique([providerId, patientId])` enforced; request uses `upsert` on that compound key — `schema.prisma:112`; `providerRoutes.ts:246-265`.
- [x] `relationshipType` validated against the enum via Zod — `validation.ts:551`; enum `schema.prisma:507-513`.
- [x] Patient email validated as email; message sanitized + capped at 500 — `validation.ts:550,552`.
- [x] `providerAccessRequestLimiter` is 10/hour, user-keyed, Redis-backed with MemoryStore fallback — `rateLimiter.ts:133-154`; store factory `rateLimitStore.ts:71-82`; applied after router-level `authenticate` so `req.user.id` is the key (`providerRoutes.ts:25,152`).

### 7. Frontend Authorization
- [x] `useRBAC` gates provider-only capability flags (`canViewPatients = roleLevel >= PROVIDER`, `canManageProviderAccess = role === 'PATIENT'`) — `useRBAC.ts:44,48`.
- [x] `RoleGuard` renders nothing for unauthorized roles (returns `fallback`) — `RoleGuard.tsx:53-66`.
- [x] Provider patient list nav gated to PROVIDER/ADMIN — `sampleData.ts:230`.
- [x] Permission-based data sections hidden when not granted; fetch is also skipped per-flag (defense-in-depth) — `MyPatientsPage.tsx:143-147,202,247`.

### 8. Edge Cases
- [x] Provider loses access when patient deactivates/locks — `User.findFirst` filters `isActive: true` + `lockedUntil` null-or-past on every PHI route (`providerRoutes.ts:323-327,451-455,591-595`); reason `patient_inactive_or_locked` (`:370,507,647`).
- [x] Relationships cascade-delete on user delete — `onDelete: Cascade` on both `patient` and `provider` relations (`schema.prisma:109-110`).
- [x] Concurrent consent changes safe — read+write wrapped in a single `withRLSContext` transaction (`patientRoutes.ts:204,341,429`).
- [x] Provider-who-is-also-patient kept separate — single `role` per user; each route family `requireRole`-gated (`providerRoutes.ts:26`, `patientRoutes.ts:24`).
- [x] User cannot self-elevate `role`/`is_active` — BEFORE UPDATE trigger `users_prevent_self_privilege_change` rejects non-admin changes (`20260424_prevent_self_role_elevation/migration.sql:41-49,59-62`).
- [x] Production hard-exits if the DB role has BYPASSRLS, so the RLS backstop is guaranteed active in prod — `database.ts:248-255`.

## Unverifiable
- Notification on access request (checklist §3 Q3 / "patient gets emailed"): the request handler writes the PENDING row and audit log but contains no email/notification dispatch; I did not find an email call in `providerRoutes.ts`. Whether a notification is *required* is a product decision, not confirmable as a defect from code alone — patients see requests via `GET /patient/providers/pending` (`patientRoutes.ts:109-174`).
- Session/token invalidation on mid-session revoke (checklist §4 Q4): revoke flips status to REVOKED and the *next* provider request fails the ACTIVE check, but there is no provider-token invalidation tied to a patient's revoke. This is by design (token is the provider's, not patient-scoped) and the per-request gate is the control; I could not find — and would not expect — a cross-user token-revocation hook, so I cannot mark it pass or fail against the spec's phrasing.
- Anomaly monitoring of enumeration/rate-limit patterns beyond raw audit rows (checklist §5 Q8): no alerting/monitoring layer is present in the reviewed backend modules; whether one exists in infra (GCP log-based metrics) is outside the repo and not verifiable here.

## Out of scope
- `npm audit` / `npm outdated`: the spec for this domain has no dependency-CVE checklist item; dependency hygiene is covered by the dedicated dependency-review prompt, so I did not run it here.
- Deep review of `encryption.ts` crypto internals, `authService` token lifecycle, and the FHIR/Quest path: referenced only for the salt/PHI-field cross-check needed by this domain (confirmed `ProviderPatient.notesEncrypted` is in `PHI_FIELDS`); full review belongs to prompts 02 (encryption), 04 (auth), and 09 (external APIs).
- F-23 hard-delete vs soft-revoke inconsistency (provider DELETE is a hard delete, patient revoke is soft): explicitly called out in the spec as a known, deliberately deferred item (`providerRoutes.ts:702-708`), so reported as context rather than a new finding.
