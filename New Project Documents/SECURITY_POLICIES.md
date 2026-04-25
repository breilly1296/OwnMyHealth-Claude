---
tags:
  - documentation
  - security
  - compliance
  - hipaa
type: hipaa-administrative-safeguard
hipaa-citation: §164.316 (Policies and procedures)
generated: 2026-04-25
version: 1.0
status: draft
review-cycle: annual + on-policy-change
next-review: 2027-04-25
---

# Security Policies — OwnMyHealth

> **Purpose**: this document is the written security policies and procedures
> required by 45 CFR §164.316 and referenced throughout
> [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md). Each section maps to a
> specific HIPAA standard or implementation specification, names the
> control, points at the code that enforces it, and acknowledges where
> the control is partial or pending.
>
> Companion documents:
> [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md) (§164.308(a)(1)(ii)(A) Risk Analysis),
> [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md) (§164.400-414),
> [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) (the standard-by-standard map).

---

## 1. Access Control Policy — §164.312(a)

### 1.1 Standard

PHI must be accessible only to authorized users, scoped to the minimum
data necessary for the task.

### 1.2 Authentication

Users authenticate with email + password. The platform enforces:

| Control | Value | Source |
|---|---|---|
| Password minimum length | 12 characters | [`validation.ts:117-123`](../backend/src/middleware/validation.ts) `strongPassword` |
| Password complexity | Upper + lower + digit + special | Same Zod schema |
| Password hashing | bcrypt, ≥13 rounds | [`config/index.ts:90-94`](../backend/src/config/index.ts) `bcryptRounds` |
| Failed-login lockout | 5 attempts → 30 min lock | [`config/index.ts:90-94`](../backend/src/config/index.ts) `maxLoginAttempts`, `lockoutDuration` |
| Login rate limiter | 5 attempts / 15 min, keyed `email:ip`, failed-only | [`rateLimiter.ts:50-69`](../backend/src/middleware/rateLimiter.ts) `strictAuthLimiter` |
| Multi-factor authentication | **Not implemented** | Pre-beta blocker — see [`RISK_ASSESSMENT.md` § 6.1 item 3](./RISK_ASSESSMENT.md#61-pre-beta-must-close-before-live-phi) |
| JWT signing algorithm | HS256, pinned | [`config/jwtOptions.ts`](../backend/src/config/jwtOptions.ts) |
| JWT issuer + audience | Pinned on sign and verify | Same file |

### 1.3 Session management

| Control | Value | Source |
|---|---|---|
| Access token TTL | 15 min (900 s) | [`config/index.ts:62`](../backend/src/config/index.ts) `accessExpiresIn` |
| Refresh token TTL | 7 days (604800 s) | [`config/index.ts:66`](../backend/src/config/index.ts) `refreshExpiresIn` |
| Demo account refresh TTL | 30 days | [`authService.ts:216`](../backend/src/services/authService.ts) `DEMO_SESSION_DURATION_MS` |
| Token storage | HttpOnly cookies, `Secure` (prod), `SameSite=strict` (same-domain prod) | [`config/index.ts:74-88`](../backend/src/config/index.ts) |
| Refresh-token-as-DB-session | Yes — every refresh token has a `sessions` row, revocable | [`authService.ts:1197-1218`](../backend/src/services/authService.ts) |
| Session cleanup interval | 10 min | [`authService.ts:1232`](../backend/src/services/authService.ts) (post-2026-04-24 — was 1h) |
| Forced logout on admin password reset | Yes — `tx.session.deleteMany({ where: { userId: id } })` runs in the same transaction | [`adminRoutes.ts`](../backend/src/routes/adminRoutes.ts) F-41 fix |
| Self-password-change session rotation | Revokes all tokens, re-issues fresh tokens for the current request | [`authController.ts:518`](../backend/src/controllers/authController.ts) |
| CSRF on cookie-auth state changes | Double-submit cookie + SHA-256-then-`timingSafeEqual` constant-time compare | [`csrf.ts`](../backend/src/middleware/csrf.ts) |

### 1.4 Role-based access control

Three roles with strict ordering: `PATIENT < PROVIDER < ADMIN`.

| Resource | PATIENT | PROVIDER | ADMIN |
|---|---|---|---|
| Own PHI (CRUD) | ✅ | ✅ (own provider data) | ✅ + audit-log access |
| Other patient's PHI | — | Only via consent (`ProviderPatient`) with capability flag | ✅ |
| User management | — | — | ✅ |
| Audit logs | — | — | ✅ |
| System config | — | — | ✅ |

Source: [`rbac.ts:16-56`](../backend/src/middleware/rbac.ts) (`UserRole` ordering, `ROLE_PERMISSIONS` matrix).

The middleware pipeline for a typical PHI route is:
`authenticate → rateLimit → blockDemo* → requireRole → validate → controller → withRLSContext(userId, ...)`.

### 1.5 Provider access — consent-based

Providers see patient PHI only when **all** of the following hold:

1. A `ProviderPatient` row exists with `providerId = self` and `patientId = target`.
2. Status is `ACTIVE` (not `PENDING`, `SUSPENDED`, `EXPIRED`, `REVOKED`).
3. `consentExpiresAt` is `null` OR in the future.
4. The capability flag for the requested resource is `true` (`canViewBiomarkers` / `canViewInsurance` / `canViewDna` / `canViewHealthNeeds` / `canEditData`).
5. The patient's account is `isActive = true` AND `lockedUntil` is null or past (F-7 fix).

Source: [`rbac.ts:205-258`](../backend/src/middleware/rbac.ts) `checkProviderPatientAccess`,
[`providerRoutes.ts:431-438`](../backend/src/routes/providerRoutes.ts).

Provider patient list **does not leak email on PENDING relationships** — the patient must `ACTIVE` the consent before their email is visible to the provider (F-8 fix).

### 1.6 Database-layer RLS

PostgreSQL Row-Level Security policies are present on every PHI-bearing
table ([`backend/prisma/migrations/20260107_add_rls_policies/migration.sql`](../backend/prisma/migrations/20260107_add_rls_policies/migration.sql)).
Policies fire on `app.current_user_id` / `app.is_admin` session GUCs set by
the `withRLSContext` / `withRLSTransaction` wrappers
([`database.ts:377-386`](../backend/src/services/database.ts) `applyRLSContext`).

Self-elevation guard: a `BEFORE UPDATE OF role, is_active ON users`
trigger ([`20260424_prevent_self_role_elevation/migration.sql`](../backend/prisma/migrations/20260424_prevent_self_role_elevation/migration.sql))
raises `42501 (insufficient_privilege)` if a non-admin session attempts to
mutate either column. Admin sessions bypass.

Startup assertion: in production, the app hard-exits unconditionally on
`rolbypassrls = true` ([`database.ts:200-265`](../backend/src/services/database.ts)
`assertNoBypassRLS`). Non-prod logs a warning. There is **no env-var opt-out**.

CI guard: `scripts/check-rls-wrappers.sh` fails the build on any bare
`prisma.<model>.<verb>(`, `prisma.$queryRaw(`, `prisma.$executeRaw(`, or
`prisma.$transaction(` outside the wrapper definition itself.

### 1.7 Principle of least privilege — database roles

Two distinct roles are intended:

| Role | Privileges | Used by |
|---|---|---|
| `postgres` (Cloud SQL superuser) | Full DDL + BYPASSRLS | Schema migrations only |
| `omh_app` (NOBYPASSRLS) | DML on user-data tables; cannot bypass RLS | Application connection |

**Status today**: the application connects as the superuser
(`BYPASSRLS = true`). The cutover to `omh_app` is C-8 — code-complete,
operator-pending. See [`SECURITY_STATUS.md` § 2 C-8 row](./SECURITY_STATUS.md#2-open-findings)
for the runbook. Until cutover, app-layer `withRLSContext` wrappers are
the load-bearing tenant-isolation control. The DB-level guard activates
the moment the rotation completes.

### 1.8 Demo account restrictions

The demo account (when enabled, dev/staging only):
- Cannot reach admin paths — `blockDemoAdminAccess` middleware ([`demoProtection.ts:67-78`](../backend/src/middleware/demoProtection.ts))
- Cannot edit profile, notifications, or health profile — `blockDemoProfileUpdate`
- Cannot trigger AI features that incur cost — `blockDemoAI`
- Cannot perform destructive operations (`delete-data`, `delete-account`)
- Refused entirely in production — `config.demo.enabled` hard-fails to `false` in production via `config/index.ts:319-325`.

---

## 2. Encryption Policy — §164.312(a)(2)(iv), §164.312(e)(2)(ii)

### 2.1 Standard

ePHI must be rendered unusable, unreadable, or indecipherable to
unauthorized individuals at rest and in transit. Compliance with this
policy enables the §164.402 encryption safe harbor (see
[`BREACH_NOTIFICATION_PLAN.md` § 3.1](./BREACH_NOTIFICATION_PLAN.md)).

### 2.2 Data at rest

| Layer | Mechanism |
|---|---|
| Cipher | AES-256-GCM with authenticated encryption (12-byte IV, 16-byte auth tag) |
| Key derivation | **PBKDF2-SHA512, 600,000 iterations** (per-user, salted from `UserEncryptionKey`) — [`encryption.ts:86-87,193-201`](../backend/src/services/encryption.ts) |
| Master key | `PHI_ENCRYPTION_KEY` (256 bits / 64 hex chars), GCP Secret Manager in prod |
| Master-key validation | Refuses placeholder values in **every** environment ([`encryption.ts:129-141`](../backend/src/services/encryption.ts), closed C-4) |
| User salt storage | `UserEncryptionKey.salt` column, encrypted with the master key |
| Legacy iteration count | 100k retained as fallback for pre-rotation rows; documented in `TODO(key-rotation)` at [`encryption.ts:81-85`](../backend/src/services/encryption.ts) |
| Backups | Cloud SQL automated backups, encrypted by Google with Google-managed keys `[CONFIRM: backup retention period]` |
| GCS objects | Server-side encryption by Google with Google-managed keys |
| Audit log values | `previousValueEncrypted` / `newValueEncrypted` use the same AES-256-GCM, salted from `AUDIT_LOG_SALT` env var ([`auditLog.ts`](../backend/src/services/auditLog.ts), closed C-2) |

> **Note on the spec wording**: the original spec referenced HKDF; the
> implementation uses PBKDF2-SHA512. PBKDF2 is the deliberate choice
> because the input is a moderately-entropy master key and per-user salts
> are stored in the DB — the iteration cost (600k) is the load-bearing
> work-factor against an offline attack on a stolen DB row. HKDF would
> be appropriate for a key-derivation-from-shared-secret scenario, which
> is not the threat model here.

### 2.3 Data in transit

| Channel | Protection |
|---|---|
| Browser ↔ Backend | TLS 1.3 (Cloud Run + Google LB), HSTS via helmet |
| Backend ↔ Cloud SQL | TLS via Cloud SQL Auth Proxy |
| Backend ↔ Anthropic / GCS / Document AI / SendGrid | TLS via vendor SDK |
| Cookies | `Secure` (prod), `HttpOnly`, `SameSite=strict` (same-domain prod) — [`config/index.ts:74-88`](../backend/src/config/index.ts) |

### 2.4 Key management

| Concern | Current state | Gap |
|---|---|---|
| Master key storage | GCP Secret Manager (prod), `.env` (dev) | OK |
| Per-user salt storage | DB row encrypted with master key | OK |
| Master key rotation | **No documented runbook** | Pre-beta blocker — see [`RISK_ASSESSMENT.md` § 6.3 item 20](./RISK_ASSESSMENT.md#63-beta-window) |
| Per-user salt rotation | Helper exists at `userEncryption.ts:rotateUserEncryptionKey` | Not exercised in production |
| HSM / Cloud KMS | Not used | Roadmap |
| Key escrow | No | Acceptable for a CE without separate-custodian requirements |

**Master key rotation procedure (planned, not yet runbook'd)**:

1. Generate new master key: `openssl rand -hex 32`.
2. Place new key in Secret Manager as a new secret version.
3. Run a re-encryption job: for every `UserEncryptionKey`, decrypt the
   salt under the old master, re-encrypt under the new master.
4. Re-encrypt every PHI ciphertext column with the new per-user-derived
   key. (This step is the multi-hour offline operation; needs a
   migration plan.)
5. Update `PHI_ENCRYPTION_KEY` env var to the new secret version.
6. Verify a known-good column decrypts correctly post-deploy.
7. Disable / version-pin the old secret only after verification.

This procedure is **NOT YET DOCUMENTED in operational form** and is
flagged as a pre-beta gap.

### 2.5 Encryption safe harbor — applicability + limitations

The encryption safe harbor (§164.402, HHS guidance) applies to
ciphertext-only disclosures **as long as the encryption key has not been
compromised in the same incident**.

OwnMyHealth-specific limitations:
- Per-user salts are encrypted with **a single master key**. If the
  master key is exposed, the safe harbor evaporates **for every user
  simultaneously**. This is the system's largest concentration of risk
  ([`BREACH_NOTIFICATION_PLAN.md` § 8.3](./BREACH_NOTIFICATION_PLAN.md)).
- Application-layer disclosures (decrypted records served to an
  authorized user, then exfiltrated) do NOT qualify for safe harbor —
  the data was unencrypted at the moment of disclosure.
- Logged stack traces / error messages may contain plaintext PHI
  fragments that bypass encryption entirely. Logger redaction
  ([`logger.ts`](../backend/src/utils/logger.ts)) is the mitigation;
  drift is documented in
  [`PHI_TAXONOMY.md` § 7](./PHI_TAXONOMY.md#7-drift-findings).

### 2.6 What is encrypted

The full PHI inventory is in
[`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — 36 encrypted columns across 15
Prisma models. High-level categories enumerated in
[`RISK_ASSESSMENT.md` § 1](./RISK_ASSESSMENT.md#1-executive-summary).
The `PHI_FIELDS` constant in [`encryption.ts`](../backend/src/services/encryption.ts)
is the single source of truth for the encryption boundary; it is checked
against the Prisma schema during regression review.

---

## 3. Audit Logging Policy — §164.312(b)

### 3.1 Standard

Hardware, software, and procedural mechanisms that record and examine
activity in information systems containing or using ePHI.

### 3.2 What is logged

The audit log records every PHI access, write, and management event with
encrypted previous/new value snapshots where applicable.

| Event | Trigger | Action enum |
|---|---|---|
| Login | Successful credential verification | `LOGIN` |
| Login failed | Bad password, locked account, missing email | `LOGIN_FAILED` |
| Logout | Explicit logout endpoint | `LOGOUT` |
| Token refresh | `POST /auth/refresh` | (audit captured implicitly via session row update) |
| Password change | User-initiated | `PASSWORD_CHANGE` |
| Password reset | Reset-token redemption | `PASSWORD_RESET` |
| Account lockout | Auto-lockout after 5 failures | `ACCOUNT_LOCKOUT` |
| PHI access (read) | Every controller `findMany` / `findFirst` / `findUnique` on a PHI table | `READ` |
| PHI export | `GET /settings/export-data` | `EXPORT` (with `recordCount`, `resourceIds[≤100]`, `exportFormat`) |
| PHI create | New encrypted row | `CREATE` |
| PHI update | Encrypted column changed | `UPDATE` (with encrypted previous + new values) |
| PHI delete | Row removed | `DELETE` (with encrypted previous value snapshot) |
| Admin permission change | `PATCH /admin/users/:id` with `role` | `PERMISSION_CHANGE` |
| Provider access request | `POST /provider/patients/request` | `READ` on `provider_patient_request` |
| Provider PHI access | Cross-user reads through consent | `READ` on `patient_*` resources |
| External API disclosure | Every Claude call | `READ` on `biomarker_ai_guidance` / `cost_analysis` / `LabReportUpload` with `externalApiCall: true` |
| File access | Signed URL generation | `READ` on `UserFile` |
| Demo block fired | Demo account hit a blocked path | `READ` with `success: false`, `reason: '<demo-block>'` |
| BAA gate blocked | Claude call refused (BAA flag false) | `READ` with `operation: 'GUIDANCE_BLOCKED_NO_BAA'` |
| Data deletion (user-initiated) | `DELETE /settings/delete-data` | `DELETE` on `UserData` (with per-category counts) |
| Account deletion | `DELETE /settings/delete-account` | `DELETE` on `User` |
| System events | Schedulers, retention cleanup | `actorType: 'SYSTEM'`, action varies |

KEY_ROTATION events are not yet emitted because key rotation is not yet
runbook'd; will be added when the procedure is operationalized.

Source of truth: [`auditLog.ts`](../backend/src/services/auditLog.ts) +
the call-site map in [`PHI_TAXONOMY.md` § 5](./PHI_TAXONOMY.md#5-audit-log-coverage-gaps).

### 3.3 Retention

7 years (`RETENTION_DAYS = 2555`) — [`auditLog.ts:9`](../backend/src/services/auditLog.ts).
Daily cleanup scheduler at [`auditLog.ts:520-546`](../backend/src/services/auditLog.ts)
deletes rows older than the retention horizon and emits a
`SYSTEM / DELETE / retention_cleanup` audit entry recording the deletion count.

### 3.4 Audit log integrity

| Property | Mechanism |
|---|---|
| Encrypted PHI snapshots | `previousValueEncrypted` / `newValueEncrypted` columns, AES-256-GCM with the system audit salt |
| System salt source | `AUDIT_LOG_SALT` env var (Secret Manager in prod), validated at boot ([`config/index.ts:228-238`](../backend/src/config/index.ts)) |
| Append-only via RLS policies | RLS policy on `audit_logs` permits SELECT under admin context + INSERT under any RLS-wrapped context; no UPDATE policy and no DELETE policy except the retention scheduler |
| Tamper evidence | Database-internal — no external WORM target today; `[CONFIRM]` whether GCP Cloud Logging Sink → BigQuery export is desired for cross-system verification |

### 3.5 Log review schedule

**Today**: ad-hoc, on incident. No formal review cadence.

**Recommended (pre-beta)**:
| Cadence | Activity |
|---|---|
| Weekly | Review `LOGIN_FAILED` patterns; review `EXPORT` events; review admin-action audit entries |
| Monthly | Review `PHI_ACCESS` summary by user; verify retention cleanup ran |
| Quarterly | Re-validate audit coverage against `PHI_TAXONOMY.md` PHI inventory |
| Post-incident | Per [`BREACH_NOTIFICATION_PLAN.md` § 6.5](./BREACH_NOTIFICATION_PLAN.md) |

A solo operator approximation: a 30-minute "audit log review" calendar
recurrence on Mondays.

### 3.6 PHI redaction in application logs

The audit log is one stream. Application logs (Cloud Logging /
`console.error` in dev) are a second stream that must NOT carry PHI.
[`logger.ts`](../backend/src/utils/logger.ts) `sanitizeData` redacts
`SENSITIVE_FIELDS` keys with `[REDACTED]` and recurses into arrays
(closed F-21).

**Known drift**: `*Encrypted` field names like `valueEncrypted` are not
redacted because the matcher lowercases the input but the set has
camelCase entries. Documented in
[`PHI_TAXONOMY.md` § 7](./PHI_TAXONOMY.md#7-drift-findings); fix is in
[`RISK_ASSESSMENT.md` § 6.1 item 8](./RISK_ASSESSMENT.md#61-pre-beta-must-close-before-live-phi).

---

## 4. Data Integrity Policy — §164.312(c)(1)

### 4.1 Standard

ePHI must not be improperly altered or destroyed.

### 4.2 Input validation

| Layer | Control |
|---|---|
| Request body | Zod schemas at every API boundary ([`validation.ts`](../backend/src/middleware/validation.ts)) |
| URL parameters | UUID format validation (`uuidParam`, `patientIdParam`, `userIdParam`) |
| Query parameters | Per-endpoint Zod schemas |
| Content-Type | `requireJsonContentType` middleware on JSON routes |
| Body size | 10 MB cap (`app.ts:226-227`) |
| Validation error shape | `{field, message, code}` only — no `received` / `input` echoed back (F-15 fix) |

### 4.3 File upload validation

| Check | Source |
|---|---|
| Mimetype allowlist | [`controllers/upload/shared.ts:54-58`](../backend/src/controllers/upload/shared.ts) `SUPPORTED_MIME_TYPES` |
| Magic-byte verification | `validateMagicBytes` at [`shared.ts:82-91`](../backend/src/controllers/upload/shared.ts) — covers PDF, PNG, JPEG, TIFF, GIF, WebP |
| PDF version + structure | `validatePdfHeader` at [`utils/securePdfParsing.ts`](../backend/src/utils/securePdfParsing.ts) |
| File size cap | 10 MB per upload (multer config) |
| Filename sanitization | `sanitizeFilename` strips control + Windows-illegal + path separators; 255-byte cap (F-15) |

### 4.4 CSRF protection

Double-submit cookie pattern. Cookie token is also a constant-time SHA-256
hash compare ([`csrf.ts`](../backend/src/middleware/csrf.ts), F-17 fix).
Default-on for all state-changing methods. Only `/ai/chat` SSE is exempt
(uses bearer-only `requireBearerAuth`). Upload routes are no longer
exempt (post-2026-04-24).

### 4.5 Rate limiting

Six named limiters scoped per route risk:

| Limiter | Window | Cap | Key |
|---|---|---|---|
| `standardLimiter` | 15 min | 100 | IP |
| `authLimiter` | 15 min | 20 | IP |
| `strictAuthLimiter` | 15 min | 5 | `email:ip`, failed-only |
| `uploadLimiter` | 60 min | 20 | IP |
| `sensitiveLimiter` | 60 min | 10 | IP |
| `aiLimiter` | 60 min | 10 | userId (cost protection) |
| `bulkOperationLimiter` | 60 min | 30 | IP |
| `providerAccessRequestLimiter` | 60 min | 10 | userId (F-6 fix) |

Source: [`rateLimiter.ts`](../backend/src/middleware/rateLimiter.ts).

Known limitation: in-memory store; bounded by Cloud Run `--max-instances=3`.
Documented at [`rateLimiter.ts:6-13`](../backend/src/middleware/rateLimiter.ts).

### 4.6 Database-level integrity

- **Foreign key constraints** on every cross-table relationship
- **`onDelete: Cascade`** on User-owned tables — account deletion cleanly purges children
- **GCM authentication tag** on every PHI ciphertext — tampering detected at decrypt time, returns `null` not the ciphertext (closed F-21)
- **Self-elevation trigger** prevents non-admin sessions from changing role/is_active (§ 1.6)

---

## 5. PHI Minimization Policy

### 5.1 Standard

§164.502(b) Minimum Necessary — for any disclosure, use the minimum PHI
necessary for the purpose.

### 5.2 External AI calls (Claude)

The C-7 closure is the load-bearing implementation here:

| Layer | Control |
|---|---|
| BAA gate | `ANTHROPIC_BAA_ACTIVE` env var, runtime-checked at every Claude call ([`config/index.ts:245-258`](../backend/src/config/index.ts), [`claudeExtraction.ts:118-123`](../backend/src/services/claudeExtraction.ts)) |
| Production hard-fail | App refuses to boot if `ANTHROPIC_API_KEY` is set but `ANTHROPIC_BAA_ACTIVE != 'true'` |
| Local PDF text extraction | `pdf-parse` runs in the backend; raw PDF bytes never leave the server |
| Input PHI redaction | `redactPHI` strips SSN, NPI, DEA, dates (free-standing + DOB-prefixed), ZIP codes, emails, phones, addresses, labeled patient names ([`utils/phiRedaction.ts`](../backend/src/utils/phiRedaction.ts)) |
| No vision input | The vision fallback was removed 2026-04-24; text-only is the only Claude path |
| Output PHI scrubbing | `stripPHIFromText` runs on every response before display or storage |
| Cost-analysis prompt floor | `stripPHIFromText` also runs on the assembled prompt before send ([`expenseController.ts`](../backend/src/controllers/expenseController.ts)) |
| Audit log of every disclosure | `externalApiCall: true`, `phiDisclosedFields` enumeration, biomarker name NOT in plaintext (F-16) |

### 5.3 Log redaction for PHI-adjacent data

See § 3.6 above. `logger.ts` `SENSITIVE_FIELDS` redacts known PHI keys
with `[REDACTED]`. Drift on `*Encrypted` keys documented; fix scheduled.

SBC extraction logs no longer include `planName` / `insurerName` (F-19).

### 5.4 Data export — user-controlled

`GET /settings/export-data` returns all 11 PHI categories the user owns:

| Category | Source |
|---|---|
| User profile (decrypted) | `User.firstName/lastName/dob/phone/address` |
| Biomarkers + history (decrypted) | `Biomarker` + nested `BiomarkerHistory` |
| Insurance plans + benefits (decrypted) | `InsurancePlan` + `InsuranceBenefit[]` |
| Health goals + progress (decrypted) | `HealthGoal` + `GoalProgressHistory[]` |
| Health needs (decrypted) | `HealthNeed` |
| Expense projections (decrypted) | `ExpenseProjection` |
| Expense actuals (decrypted) | `ExpenseActual` |
| Cost analyses (decrypted) | `CostAnalysis` |
| Provider relationships (consent flags + notes) | `ProviderPatient` |
| User files (metadata + storageKey, NOT bytes) | `UserFile` |
| Notification preferences | `User.notificationPreferences` |

Source: [`settingsController.ts:exportUserData`](../backend/src/controllers/settingsController.ts). Audit-logged as `EXPORT` with per-category counts.

### 5.5 Data deletion — comprehensive cascade

Two paths:

`DELETE /settings/delete-data` — preserves the User row, wipes everything else. Deletes:
- BiomarkerHistory (cascade), Biomarker
- InsuranceBenefit (cascade), InsurancePlan
- GoalProgressHistory (cascade), HealthGoal
- HealthNeed
- ExpenseProjection, ExpenseActual, CostAnalysis
- UserFile (DB rows) + corresponding GCS objects (C-6 — GCS deleted FIRST, then DB)
- ProviderPatient (provider AND patient sides)
- DNAData (cascades to DNAVariant, GeneticTrait)
- LabConnection
- Audit-log metadata records the per-category deletion counts (F-5 fix)

Source: [`settingsController.ts:deleteAllData`](../backend/src/controllers/settingsController.ts).

`DELETE /settings/delete-account` — same as above PLUS deletes the User row, which cascades to anything not explicitly listed above.

Both endpoints require:
- Password confirmation (`bcrypt.compare`) — closed F-10
- Demo block — `blockDemoProfileUpdate` middleware
- CSRF protection (no exemption)
- `sensitiveLimiter` rate limit
- Audit log of the deletion event

---

## 6. Workforce Security Policy — §164.308(a)(3)

### 6.1 Standard

Implement procedures to ensure all members of the workforce have
appropriate access to ePHI.

### 6.2 Current state — solo founder

The workforce is **one person** (the founder/operator). This is acknowledged as a structural risk in
[`RISK_ASSESSMENT.md` T-02](./RISK_ASSESSMENT.md#32-t-02--insider-threat--privilege-escalation).

Implications:
- No separation of duties between developer, operator, and security reviewer
- No second-pair-of-eyes code review (a structural limit of team size, not a process gap)
- No segregation of production credentials from the development workstation
- No formal access provisioning/deprovisioning procedure (one person; access is intrinsic)

Compensating controls:
- All admin actions audit-logged with `actorType: 'ADMIN'`
- Self-elevation blocked at the DB layer (§ 1.6)
- Demo account blocked from admin paths
- Production deploys go through GitHub Actions, not local `gcloud` (no production secrets on the workstation by design `[CONFIRM: no `gcloud auth login` on the workstation outside an active session]`)
- 7-year audit trail for forensic review

### 6.3 Future workforce — required procedures

When the team grows beyond one, the following become required (not yet
authored):

1. **Background check** for any role with PHI access (`[CONFIRM: scope per state law]`)
2. **HIPAA training** before access grant; annual refresher
3. **Workforce member access form** (signed acknowledgment of responsibilities)
4. **Access provisioning procedure**: role assigned → IAM grants → access verified → access logged
5. **Access deprovisioning procedure (termination checklist)**:
   - Revoke session tokens (`tx.session.deleteMany({ where: { userId } })`)
   - Revoke GCP IAM
   - Rotate any shared credentials they had access to
   - Delete repository access
   - Final audit-log review for unusual activity in the last 30 days
6. **Sanction policy** for HIPAA violations (§164.308(a)(1)(ii)(C))

These procedures are tracked as pre-beta documentation in
[`RISK_ASSESSMENT.md` § 6.2](./RISK_ASSESSMENT.md#62-pre-beta--documentation).

### 6.4 Sanctions

Per §164.308(a)(1)(ii)(C). Today: solo operator, no sanctions framework
needed. Future: a written sanctions policy is required before the first
hire, covering HIPAA violations from inadvertent disclosure to malicious
access.

---

## 7. Incident Response Policy

This policy is operationalized in
[`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md). Summary
here for completeness.

### 7.1 Severity classification

| Level | Description | Target containment |
|---|---|---|
| 1 | Non-breach security event (failed login, blocked CSRF, rate limit) | Log only |
| 2 | Potential breach — investigate | 4 hours |
| 3 | Confirmed small-scale breach (1–500 individuals) | 1 hour containment + 7 days investigation + 60 days notification |
| 4 | Confirmed large-scale breach (>500 individuals or systemic) | 1 hour containment + 24 hours total rotation + 60 days notification |

### 7.2 Escalation procedures

Solo operator:
- Backup decision-maker `[CONFIRM]` is the only escalation path beyond
  the founder. Required before beta.
- External legal counsel for any Level 3+ classification before sending
  notifications (`[CONFIRM: counsel name + retainer status]`).
- BA notification channels documented in
  [`BREACH_NOTIFICATION_PLAN.md` § 5.6](./BREACH_NOTIFICATION_PLAN.md#56-business-associate-notifications).

### 7.3 Evidence preservation

Per [`BREACH_NOTIFICATION_PLAN.md` § 6.1 Step 2](./BREACH_NOTIFICATION_PLAN.md#step-2--preserve-evidence):
- Audit log range snapshot (admin context, JSON file, offline storage)
- Cloud Logging export for the affected window
- Cloud SQL point-in-time backup snapshot if data integrity in question
- GCS bucket ACL snapshot if a bucket is implicated
- Verbatim user reports
- All stored in `New Project Documents/incidents/` (encrypted, NOT in git)

### 7.4 Documentation retention

§164.530(j) — 6 years for breach notification documentation. Audit log
retention exceeds this at 7 years.

---

## 8. Physical Safeguard Policy — §164.310

### 8.1 Standard

Limit physical access to electronic information systems and the
facilities housing them.

### 8.2 Cloud infrastructure — delegated to GCP

OwnMyHealth has **no on-premises servers**. All ePHI processing happens
on:
- Google Cloud Run (managed)
- Google Cloud SQL (managed PostgreSQL)
- Google Cloud Storage (managed object store)

GCP's physical-security controls (24/7 staffing, biometric access, video
surveillance, data-center-tier compliance) are documented in their HIPAA
BAA and SOC 2 reports `[CONFIRM: GCP HIPAA BAA acknowledged for project
ownmyhealth-prod]`. No physical-safeguard responsibility flows back to
OwnMyHealth for the production data plane.

### 8.3 Developer workstation requirements

The single physical asset OwnMyHealth controls is the founder's
workstation, which:

| Requirement | Status |
|---|---|
| Full-disk encryption (FileVault / BitLocker / LUKS) | `[CONFIRM]` |
| Screen lock auto-engage after ≤ 5 min idle | `[CONFIRM]` |
| Strong login password OR biometric | `[CONFIRM]` |
| OS auto-updates enabled for security patches | `[CONFIRM]` |
| `.env` files excluded from git (verified `.gitignore`) | ✅ |
| No production credentials cached outside an active session | `[CONFIRM]` |
| Backup of repo state (separate from production data) | `[CONFIRM]` |
| Lost-device SOP | ❌ — required pre-beta |

### 8.4 Removable media

Default policy: **no PHI on removable media**. PHI export is JSON via
authenticated API only. `[CONFIRM: no documented exception]`.

### 8.5 Disposal

Per §164.310(d)(2)(i): media disposal must render PHI unrecoverable.
GCS objects are deleted via `Storage.bucket(...).deleteFiles(...)` with
generation matching, and the bucket has versioning `[CONFIRM]`. Cloud
SQL automated backups age out per the configured retention window. No
local PHI is held that requires physical disposal.

---

## 9. Change Management Policy

### 9.1 Standard

Implement security measures sufficient to ensure that ePHI is not
improperly altered or destroyed during change events.

### 9.2 CI/CD pipeline

GitHub Actions runs the deploy pipeline (`.github/workflows/deploy.yml`).
Every PR must pass:

| Gate | Source |
|---|---|
| `npx tsc --noEmit` | Backend type-check |
| `npx vitest run` | Backend test suite |
| Frontend type-check + Vitest | Frontend test suite |
| `npm audit --audit-level=high` (root + backend) | Fails build on high or critical advisory |
| `scripts/check-rls-wrappers.sh` | Fails build on bare `prisma.<model>.<verb>(` or raw-SQL outside the wrapper |

Production deploy is triggered by push to `master`/`main`. The deploy
shape is build-image → push to Artifact Registry (SHA-tagged only,
`:latest` removed 2026-04-24) → Cloud Run deploy at 0% traffic with a
named tag → manual traffic shift → operator verification.

### 9.3 Code review

**Solo founder — no second-pair-of-eyes review.** Acknowledged structural
limit of team size. Compensating controls:
- CI gates above
- Comprehensive test suite (392 backend tests as of 2026-04-25)
- Audit log captures every code-deployed change as a deploy event

When the team grows, code review becomes a **mandatory gate** for any PR
that touches:
- `services/encryption.ts` or `services/userEncryption.ts`
- `services/database.ts` (`withRLSContext` wrappers)
- `services/auditLog.ts`
- `middleware/auth.ts` or `middleware/csrf.ts`
- Any Prisma migration
- Any change to `.github/workflows/`

### 9.4 Database migrations

Authored as Prisma migration directories. Reviewed manually (today —
solo). Applied via `npx prisma migrate deploy` in production deploy step.
RLS policies + self-elevation trigger documented in
[`DATA_MODEL.md`](./DATA_MODEL.md).

Pre-deploy migration verification:
1. Migration applied against staging Cloud SQL instance first.
2. Live-DB integration suite (`npm run test:integration`) run against
   the staging instance.
3. Production migration applied during the deploy step, before the new
   Cloud Run revision receives traffic.

### 9.5 Security audit before production deploys

For changes that touch the security-sensitive surface above (§ 9.3
list), the operator runs an explicit pre-deploy audit:
1. Re-read the changed file's CI guard expectations
2. Verify regression tests cover the new behavior
3. Verify no new `process.env` reads bypassing `config/index.ts`
4. Run `npm audit --audit-level=high` locally to confirm CI green
5. Run `bash scripts/check-rls-wrappers.sh` locally

### 9.6 Rollback procedure

Cloud Run revisions are pinned by tag. Rollback:

```
gcloud run services update-traffic ownmyhealth-backend \
  --to-revisions=<previous-known-good-revision>=100 \
  --region=us-central1 --project=ownmyhealth-prod
```

Documented in [`RUNBOOK.md`](./RUNBOOK.md). The Cloud Run env-var
revision-pinning postmortem (2026-04-17) is the load-bearing reason this
procedure is named-revision rather than `--to-latest`.

---

## 10. Data Retention and Destruction Policy — §164.530(j)

### 10.1 Standard

Documentation of policies, procedures, communications, and required
retention periods.

### 10.2 Retention windows

| Data category | Retention | Source |
|---|---|---|
| Audit logs | 7 years (HIPAA minimum 6 + buffer) | `auditLog.ts:9` `RETENTION_DAYS = 2555` |
| User PHI | Retained until user-initiated deletion | `delete-data` / `delete-account` endpoints |
| Sessions | Until expiry (15 min access / 7 day refresh / 30 day demo) | `authService.ts` cleanup scheduler @ 10 min |
| Email verification tokens | Single-use; expire after the email's TTL | Hashed before storage |
| Password reset tokens | Single-use; expire after 1 hour | Hashed before storage |
| Failed login attempts | Cleared on successful login or 30-min auto-clear after lockout | `authService.ts` |
| Cloud SQL automated backups | `[CONFIRM: GCP-configured retention period — typically 7 days; PITR up to 7 days]` |
| GCS object versioning | `[CONFIRM: enabled, retention window]` |
| Cloud Logging | `[CONFIRM: prod project log retention period]` |
| Breach incident docs | 6 years per §164.530(j)(2) |
| BAA agreements | Term + 6 years |
| This policies document | Annually reviewed; superseded versions retained 6 years per §164.530(j) |

### 10.3 Account deletion — comprehensive cascade

See § 5.5 above. Every user-initiated deletion:
1. Verifies password (`bcrypt.compare`)
2. Deletes GCS objects FIRST (C-6 — fail-hard if GCS deletion fails; preserves audit trail)
3. Deletes DB rows in FK dependency order within an admin RLS transaction
4. Audit-logs the deletion with per-category counts
5. Returns success only after all phases complete

Post-deletion, the user's PHI is **not recoverable** from active storage.
Cloud SQL backups may retain a copy for the backup retention window
`[CONFIRM]`. This is acknowledged in the privacy notice (see
[`PRIVACY_POLICY_DRAFT.md`](./PRIVACY_POLICY_DRAFT.md)).

### 10.4 Data portability

`GET /settings/export-data` provides full export in JSON of all 11 PHI
categories the user owns. Source: § 5.4. Required by §164.524 (right of
access) — satisfied.

### 10.5 Backup retention

`[CONFIRM: Cloud SQL automated backup retention window]` —
typically 7 days for default Cloud SQL automated backups; longer windows
require explicit configuration. Document the actual configured value
here once verified.

### 10.6 Destruction at end-of-life

If OwnMyHealth shuts down:
- Notify all users 60+ days in advance
- Provide the data-export endpoint until the last day
- After shutdown: drop all Cloud SQL databases (PHI rows), purge all GCS
  buckets, rotate `PHI_ENCRYPTION_KEY` to nothing, decommission Cloud Run
  service, cancel BAA agreements
- Document the destruction event with timestamps for the 6-year retention

---

## 11. Business Associate Management Policy

### 11.1 Standard

§164.308(b) requires written contracts (BAAs) with any business associate
that creates, receives, maintains, or transmits PHI on the covered
entity's behalf.

### 11.2 Current Business Associates

| Vendor | Service | BAA status | Date | Code anchor |
|---|---|---|---|---|
| **Google Cloud Platform** | Cloud Run, Cloud SQL, GCS, Document AI, Cloud Logging, Secret Manager | `[CONFIRM: BAA acknowledged in GCP Console for project ownmyhealth-prod]` (Google's standard HIPAA BAA auto-applies once accepted) | Pre-existing | `.github/workflows/deploy.yml`; `services/storageService.ts`; `services/ocrService.ts` |
| **Anthropic** | Claude API for biomarker guidance, SBC extraction, cost analysis, AI chat | ✅ Signed | **2026-04-16** | Runtime gate at [`config/index.ts:245-258`](../backend/src/config/index.ts) and [`claudeExtraction.ts:118-123`](../backend/src/services/claudeExtraction.ts) — production refuses to boot if BAA flag is unset |
| **SendGrid (Twilio)** | Transactional email (verification, password reset) | `[CONFIRM: BAA execution date]` — templates carry no PHI today | TBD | [`emailService.ts`](../backend/src/services/emailService.ts) |
| **Quest Diagnostics (FHIR)** | Lab data ingest via SMART-on-FHIR | 🟡 Pending — feature flagged off until BAA executed | TBD | [`config/index.ts:158-169`](../backend/src/config/index.ts) `quest.clientId` empty |

### 11.3 BAA requirements before onboarding

Any service that touches PHI must have a signed BAA before the connection
is enabled. Required clauses:
- Definitions of PHI handled
- Permitted uses and disclosures
- Safeguard requirements (encryption at rest + in transit)
- Subcontractor flow-down (if the BA uses sub-processors, they must also sign BAAs)
- Breach notification timeline (60 days from discovery, ideally shorter)
- Termination clause + return/destruction of PHI
- Audit cooperation clause

### 11.4 Runtime gating

Every BA integration has a runtime kill switch:
- **Anthropic**: `ANTHROPIC_BAA_ACTIVE=true` env var; production hard-fails if API key set without flag
- **GCP**: Secret-Manager-stored credentials; revoking the service account ends access immediately
- **SendGrid**: `SENDGRID_API_KEY` env var; absence disables email path gracefully
- **Quest**: `quest.clientId` env var; absence disables the feature entirely

### 11.5 BAA review schedule

| Trigger | Action |
|---|---|
| Annually | Review every BAA for clause currency; verify each is still in force |
| BA security-incident notification | Confirm BAA breach clause still applies; verify timeline |
| BA acquisition / subcontractor change | Re-verify BAA flow-down |
| New BA candidate | BAA must be signed before any PHI flows |
| OwnMyHealth headcount change | Re-verify BAA scope (workforce membership clauses) |

### 11.6 Subcontractor flow-down

When OwnMyHealth's BAs use sub-processors (e.g., Anthropic uses AWS;
GCP uses its own subnetwork providers), the sub-processor coverage must
flow down via the parent BAA. OwnMyHealth does not contract directly
with sub-processors; reliance is on the BA's own subcontractor
management.

`[CONFIRM: review Anthropic's published sub-processor list at least
annually; same for GCP and SendGrid]`.

---

## 12. Document Control

| Field | Value |
|---|---|
| Document | SECURITY_POLICIES.md |
| Version | 1.0 |
| Status | Draft (initial) |
| Generated | 2026-04-25 |
| Author | OwnMyHealth founder/security lead `[CONFIRM: name + role for the formal record]` |
| Reviewer | `[CONFIRM: external HIPAA reviewer if engaged]` |
| Approved by | `[CONFIRM]` |
| Last reviewed | 2026-04-25 (initial) |
| Next scheduled review | Annual: **2027-04-25**, plus on any policy change |
| HIPAA citations satisfied | §164.312(a), §164.312(a)(2)(iv), §164.312(b), §164.312(c)(1), §164.312(e)(2)(ii), §164.308(a)(3), §164.308(a)(6), §164.308(b), §164.310, §164.316, §164.502(b), §164.530(j) |
| Source-of-truth references | [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md), [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md), [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md), [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) |

---

## Items requiring confirmation

1. Cloud SQL automated backup retention period (§ 2.2, § 10.5)
2. GCP HIPAA BAA acknowledged in console for prod project (§ 11.2)
3. SendGrid BAA execution date (§ 11.2)
4. Cloud Logging retention period for prod (§ 10.2)
5. GCS object versioning enabled + retention window (§ 8.5, § 10.2)
6. Workstation FDE + screen lock + auto-update + lost-device SOP (§ 8.3)
7. No production gcloud credentials cached on the workstation outside active session (§ 6.2)
8. Backup decision-maker for incident response (§ 7.2)
9. External legal counsel name + retainer status (§ 7.2)
10. Author + reviewer + approver names for the formal record (§ 12)
11. Annual sub-processor list review for each BA (§ 11.6)
12. Master key rotation runbook authored — pre-beta blocker (§ 2.4)
