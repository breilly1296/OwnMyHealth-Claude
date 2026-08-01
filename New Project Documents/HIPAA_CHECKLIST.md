# HIPAA Compliance Checklist — OwnMyHealth

> **Audit date:** 2026-08-01 (previous: 2026-06-16)
> **Codebase:** `master` @ `12b45ae` (previous: `fb2cd32`)
> **Posture:** sandbox — no GCP (billing disabled ~2026-07-12; no deployment target, founder/test data only), declared 2026-07-14. See [`OPEN_FINDINGS.md` §Posture](./OPEN_FINDINGS.md). Administrative and physical safeguards that reference the deployed stack describe the **launch** configuration — a control on suspended infrastructure is neither PASS nor FAIL, it is dormant.
> **Severity:** open findings and their severities are owned by [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md). This checklist maps safeguards to code evidence; it does not grade the open-findings picture.
> **Compliance officer:** TBD (external: no named Security/Privacy Officer in repo — assign per §164.308(a)(2); record in `New Project Documents/RUNBOOK.md` when designated)
> **Maturity phase:** pre-launch sandbox (GCP infrastructure **suspended** since ~2026-07-12; no public beta cohort; formal policy set not yet authored)
> **Scope:** maps each HIPAA Security Rule safeguard (§164.308 / §164.310 / §164.312) and the Breach Notification Rule (§164.400–414) to **code evidence** (`file:line`) and a **status**.

**New since the last audit (2026-08-01):**

- **§164.520 consent capture** — registration now records `users.terms_accepted_at` plus `users.terms_version` (`20260620_add_registration_consent`), validated at the register API boundary (`0456c50`). This addresses the FTC Health Breach Notification Rule expectation that a consumer health app hold proof of consent to its stated data practices and AI processing of health data. Previously the flow presented an agreement notice but recorded nothing.
- **§164.312(a)(2)(iv) encryption at rest — a new path.** Uploaded files are no longer encrypted by a cloud provider. Under `STORAGE_BACKEND=local` (the development default since OF-23) the application seals every blob AES-256-GCM before it touches disk. The key model differs from column PHI: the **master** `PHI_ENCRYPTION_KEY` is used directly rather than a per-user derived key (`localBackend.ts:15-19`), so one key compromise exposes every user's files. See [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) §8.0.
- **§164.312(a)(2)(i) / (c)(1) access control and integrity — regression found and fixed.** OF-22: a missing RLS UPDATE policy on `sessions` broke refresh rotation under the production role and misfired the token-reuse detector into revoking all sessions. Fixed by `20260712_add_sessions_update_policy`; regression-pinned under a real NOBYPASSRLS role (`rls.test.ts:541`).
- **§164.308(a)(1)(ii)(D) information system activity review** — CI gained a full-history secret scan (`secret-history-scan.yml`) and an end-to-end `e2e` job. The history scan is **failing by design** while **OF-01** (a production service-account key recoverable from git history) remains open; deleting that key in IAM is a hard precondition for re-enabling GCP billing.
- **§164.308(a)(6) breach detection remains the largest open gap** — OF-12 (Dormant; expected to re-rate High at launch). There is no alerting on audit anomalies or repeated login failures, and no error-tracking SDK. Under the sandbox posture there is nothing to monitor; this is a launch blocker, not a current risk.

This document is a reference, not a narrative. Every non-trivial claim cites `file:line`. It is generated against the live code per [`22-hipaa-checklist-doc.md`](../prompts/22-hipaa-checklist-doc.md) and the [`_doc-quality.md`](../prompts/_doc-quality.md) protocol.

**Status legend:** ✅ shipped • 🟡 partial • ⚠️ gap / open finding • ⏳ TBD / pending (external)

---

## 1. Business Associate Agreements (BAAs)

Every vendor that touches ePHI must have a signed BAA before production PHI flows. Code-side BAA gates (`config/index.ts`) refuse to boot in production when a PHI-bearing integration is enabled without its BAA flag asserted.

| Vendor | Service | BAA status | Date (ISO) | Source / gate |
|---|---|---|---|---|
| Anthropic | Claude API — biomarker guidance, SBC/lab extraction, cost analysis, AI chat | ✅ Signed | 2026-04-16 | Project memory; runtime gate `ANTHROPIC_BAA_ACTIVE` — prod boot **throws** if `ANTHROPIC_API_KEY` set and flag unset (`backend/src/config/index.ts:381-394`) |
| Google Cloud | Document AI OCR (scanned lab/SBC images) | ⏳ TBD (external: confirm GCP BAA covers Document AI in GCP Console) — **runtime-gated** | TBD | `GOOGLE_BAA_ACTIVE` / `documentAiBaaActive` gate — prod boot **throws** if `GCP_PROCESSOR_ID` set and flag unset (`backend/src/config/index.ts:401-414`) |
| Google Cloud | Core infra — Cloud Run (compute), Cloud SQL (Postgres), Cloud Storage (lab/SBC files) | ⏳ TBD (external: confirm GCP BAA on file; resolve in GCP Console project `ownmyhealth-prod`, billing/legal contact) | TBD | Deploy target `backend/.github/workflows/deploy.yml` (`gcloud run deploy` at `.github/workflows/deploy.yml:183`; Cloud SQL `ownmyhealth-prod:us-central1:ownmyhealth-db` at `.github/workflows/deploy.yml:46`) |
| Quest Diagnostics | SMART-on-FHIR lab connection (OAuth, lab-result sync) | ⏳ TBD (external) — OAuth tokens stored encrypted at rest | TBD | `backend/src/services/fhir/smartAuth.ts`; `QUEST_FHIR_*` env vars (`backend/src/config/index.ts:266-280`); tokens in `LabConnection.accessTokenEncrypted/refreshTokenEncrypted` (`backend/prisma/schema.prisma:763-764`) |
| SendGrid | Transactional email (verification, password reset, notifications) | ⏳ TBD (external: confirm Twilio/SendGrid BAA; email content avoids PHI) | TBD | `SENDGRID_API_KEY` (`backend/src/config/index.ts:209-210`); `backend/src/services/emailService.ts` |

### BAA runtime-gate flow

```
                 boot: config/index.ts module load
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                        ▼
  ANTHROPIC_API_KEY set?                   GCP_PROCESSOR_ID set?
        │ yes                                    │ yes
        ▼                                        ▼
  ANTHROPIC_BAA_ACTIVE !== 'true'?         GOOGLE_BAA_ACTIVE !== 'true'?
        │ yes                                    │ yes
        ▼                                        ▼
  isProduction → throw (refuse boot)       isProduction → throw (refuse boot)
  dev/staging  → stderr warn               dev/staging  → stderr warn
  (config/index.ts:381-394)                (config/index.ts:401-414)
```

```ts
// Source: backend/src/config/index.ts:381-388
if (config.anthropic.apiKey && !config.anthropic.baaActive) {
  if (config.isProduction) {
    throw new Error(
      'ANTHROPIC_BAA_ACTIVE must be set to "true" in production when ANTHROPIC_API_KEY is configured. ' +
      'This flag asserts that a signed Business Associate Agreement is in effect. ' +
      'If no BAA is in place, unset ANTHROPIC_API_KEY to disable AI features.'
    );
  } else {
```

BAA gate env vars are documented in [`ENV_VARS.md`](./ENV_VARS.md) (`ANTHROPIC_BAA_ACTIVE` at `backend/src/config/index.ts:245`, `GOOGLE_BAA_ACTIVE` at `backend/src/config/index.ts:236`).

---

## 2. Technical Safeguards (§164.312) — the load-bearing artifact

| Requirement | Standard | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| Unique user identification | §164.312(a)(2)(i) | ✅ | `User.id` is a DB-generated UUID: `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` (`backend/prisma/schema.prisma:11`) | Was cuid; switched to DB-generated UUID in migration `20260424_align_uuid_defaults_and_rename_claude_response` |
| Emergency access procedure | §164.312(a)(2)(ii) | ⏳ | Admin context (`withRLSContext(null, …)`, `is_admin_session()`) can read user data for support, gated by `ADMIN` role (`backend/src/middleware/rbac.ts`) | No documented break-glass SOP — TBD (external: emergency-access policy, draft in `docs/`) |
| Automatic logoff | §164.312(a)(2)(iii) | ✅ | Access JWT lifetime **900s (15 min)**: `accessExpiresIn: parseInt(process.env.JWT_ACCESS_EXPIRES_SECONDS \|\| '900', 10)` (`backend/src/config/index.ts:121`); enforced by `jwt.verify` on every protected request (`backend/src/middleware/auth.ts:95`) | 15-min access + 7-day refresh rotation (`backend/src/config/index.ts:125`); frontend idle-logoff also clears tokens (memory-only, no localStorage) |
| Encryption / decryption at rest | §164.312(a)(2)(iv) | ✅ | AES-256-GCM (`ALGORITHM = 'aes-256-gcm'`, `backend/src/services/encryption.ts:57`; `createCipheriv` at `:284`, `getAuthTag` at `:289`); per-user key via PBKDF2-SHA512 at `deriveUserKey` (`backend/src/services/encryption.ts:236`, `crypto.pbkdf2Sync(..., 'sha512')` at `:247-253`), **600 000 iterations** (`PBKDF2_ITERATIONS = 600000`, `:85`) | Covers **14 models / 39 fields** (`PHI_FIELDS`, `backend/src/services/encryption.ts:476-562`). See [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) for the per-field matrix |
| OAuth token encryption (lab connections) | §164.312(a)(2)(iv) | ✅ | `PHI_FIELDS.LabConnection = ['accessTokenEncrypted', 'refreshTokenEncrypted']` (`backend/src/services/encryption.ts:558-561`); columns at `backend/prisma/schema.prisma:763-764` | Quest SMART-on-FHIR tokens — a stolen token reaches **live** PHI at the lab. Encrypted with the per-user key before write (`backend/src/services/fhir/labSyncService.ts:144-187`); migration `20260418_add_lab_connections` |
| Audit controls | §164.312(b) | ✅ | `RETENTION_DAYS = 2555` (~7y) (`backend/src/services/auditLog.ts:10`); scheduler `startAuditCleanup` (`:669`); audit PHI snapshots encrypted: `PHI_FIELDS.AuditLog = ['previousValueEncrypted', 'newValueEncrypted', 'metadataEncrypted']` (`backend/src/services/encryption.ts:527-531`) | Retention is also **DB-enforced**: the `audit_logs_delete` RLS policy only permits deletes of rows older than 7 years (`backend/prisma/migrations/20260613_force_rls_and_audit_retention/migration.sql:42-44`). Legacy plaintext `audit_logs.metadata` IRREVERSIBLY dropped in `20260615_drop_legacy_audit_metadata` (M6) |
| Integrity (ePHI authentication) | §164.312(c)(1) | 🟡 | AES-256-GCM provides an AEAD authentication tag per ciphertext (`getAuthTag` at `backend/src/services/encryption.ts:289`; verified on decrypt with `authTagLength: 16` at `:312`) | Tamper detection on each PHI field; no higher-level chain-of-custody / signed-record integrity |
| Person / entity authentication | §164.312(d) | ✅ | JWT verify (`backend/src/middleware/auth.ts:95`); password hashing via bcrypt (`bcrypt.hash(password, config.security.bcryptRounds)`, `backend/src/services/authService.ts:404`) at cost **13** (`bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS \|\| '13', 10)`, `backend/src/config/index.ts:160`) | Account lockout: 5 attempts / 30 min (`backend/src/config/index.ts:157-158`). MFA TBD (external: roadmap) |
| Transmission security | §164.312(e)(2)(ii) | ✅ | TLS enforced by Cloud Run (HTTPS-only at the edge); deployed via `gcloud run deploy` (`.github/workflows/deploy.yml:183`); DB over Cloud SQL connector (`--set-cloudsql-instances ownmyhealth-prod:us-central1:ownmyhealth-db`, `.github/workflows/deploy.yml:143`) | `railway.toml` is legacy; Cloud Run is the live target. AES-256-GCM AEAD adds integrity in transit between app and external FHIR/AI APIs |
| Access control (RLS) | §164.312(a)(1) | ✅ prod / 🟡 dev-staging | RLS policies (`backend/prisma/migrations/20260107_add_rls_policies/migration.sql`, patched by `20260529_fix_has_provider_access`, `20260530_add_users_select_provider`) + **FORCE ROW LEVEL SECURITY on all 19 RLS tables** (`backend/prisma/migrations/20260613_force_rls_and_audit_retention/migration.sql:14-31` + `revoked_access_tokens` in `20260613_revoked_access_tokens`); helpers `withRLSContext`/`withRLSTransaction` (`backend/src/services/database.ts`); boot guards `assertNoBypassRLS()` (`:217`) + `assertRLSForced()` (`:270`), both called at `:192-193` | **C-8 closed in production**: both guards `process.exit(1)` in prod (`backend/src/services/database.ts:253` and `:305`); dev/staging only `logger.warn` and continue (`:256`, `:308`). See [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) |
| Minimum necessary (log redaction) | §164.502(b) | 🟡 | `SENSITIVE_FIELDS` (`backend/src/utils/logger.ts:30`) + `backend/src/utils/phiRedaction.ts` redact PHI/secrets from application logs | Read-audit coverage is partial; redaction-list drift tracked in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md). `pdfRedaction.ts` was DELETED in dead-code cleanup (`redactPatientBanner` / `pdf-lib` gone) — do not cite it |
| Defense in depth — CSRF | §164.312(a)(1) | ✅ | Stateless double-submit cookie, constant-time compare (`backend/src/middleware/csrf.ts`); strict `===` exemption allowlist; `/auth/refresh` and upload routes are **not** exempt | Supports access control; CSRF token cleared on logout |
| Defense in depth — rate limiting | §164.312(a)(1) | ✅ | **8 named rate limiters** via `backend/src/middleware/rateLimiter.ts` + shared store `backend/src/middleware/rateLimitStore.ts` | In-memory per-instance by default; `REDIS_URL` enables a shared store (`backend/src/config/index.ts:186`). Deploy caps `--max-instances=3` to bound dilution (`.github/workflows/deploy.yml:189`) |
| Defense in depth — input validation | §164.312(a)(1) | ✅ | Zod validation at API boundaries (`backend/src/middleware/validation.ts`) | "Validate all input" per [`CLAUDE.md`](../CLAUDE.md) critical rules |
| AI spend circuit breaker | §164.312(a)(1) (availability) | ✅ | `aiSpendGuard` on **8 mount points across 5 route files**; `admitAISpend()` reserve/settle, **503 fail-closed** on budget or shared-store error (`backend/src/middleware/aiSpendGuard.ts`) | Bounds runaway AI cost; defaults `AI_DAILY_BUDGET_USD=50`, `AI_USER_DAILY_BUDGET_USD=5` (`backend/src/config/index.ts:256-257`) |

### Encryption-at-rest write path (PHI field → DB)

```
controller (Zod-validated plaintext)
        │  encrypt(value, userSalt)
        ▼
EncryptionService.deriveUserKey(userSalt, 600000)         (encryption.ts:236)
        │  crypto.pbkdf2Sync(masterKey, salt, 600000, KEY_LENGTH, 'sha512')   (:247-253)
        ▼
crypto.createCipheriv('aes-256-gcm', key, iv)            (encryption.ts:335)
        │  + cipher.getAuthTag()                          (:340)
        ▼
<iv>:<ciphertext>:<authTag>  →  *Encrypted column (e.g. valueEncrypted)
```

```ts
// Source: backend/src/services/encryption.ts:247-253
const derived = crypto.pbkdf2Sync(
  this.masterKey,
  userSalt,
  iterations,
  KEY_LENGTH,
  'sha512'
);
```

Per-user **salt** management (gets/creates the per-user salt in `UserEncryptionKey`, itself master-key-encrypted) lives in `backend/src/services/userEncryption.ts`; the **derivation** itself is `deriveUserKey` in `encryption.ts`. The master key is loaded from `PHI_ENCRYPTION_KEY` (64 hex chars, `backend/src/services/encryption.ts:182`; format-validated at `backend/src/config/index.ts:436-459`).

### RLS access-control flow + boot guards

```
Request (cookie: access JWT)
   │  authenticate → req.user.id                          (middleware/auth.ts:95-108)
   ▼
withRLSContext(userId, tx => …)                            (services/database.ts)
   │  $transaction: SET LOCAL app.current_user_id = userId
   ▼
Postgres RLS policy: USING (user_id = current_user_id())   (migrations/20260107_add_rls_policies)
   │  + FORCE ROW LEVEL SECURITY (owner cannot bypass)     (migrations/20260613_…:14-31)
   ▼
rows scoped to the authenticated user only

Boot guards (initializeDatabase, services/database.ts:192-193):
   assertNoBypassRLS() → prod: process.exit(1) if role has BYPASSRLS   (:253)
   assertRLSForced()   → prod: process.exit(1) if any RLS table not FORCE-protected (:305)
   dev/staging → logger.warn + continue                                (:256, :308)
```

```ts
// Source: backend/src/services/database.ts:247-254
  if (config.isProduction) {
    logger.error(
      'FATAL: Production database role has BYPASSRLS. ' +
      'RLS policies are not enforcing. Refusing to start. ' +
      'See docs/c-8-part-c-runbook.md.'
    );
    process.exit(1);
  }
```

The 19 FORCE-protected tables are listed in [`DATA_MODEL.md`](./DATA_MODEL.md); the migration enumerates 18 (`users` … `lab_connections`, `backend/prisma/migrations/20260613_force_rls_and_audit_retention/migration.sql:14-31`) plus `revoked_access_tokens` (forced in its own creation migration `20260613_revoked_access_tokens`).

---

## 3. Audit retention scheduler — which scheduler, where

Two mutually-exclusive paths run the 7-year retention cleanup; the choice is driven by whether `AUDIT_CLEANUP_TOKEN` is set.

| Path | Trigger condition | Code | Why |
|---|---|---|---|
| In-process `setInterval` (24h) | `AUDIT_CLEANUP_TOKEN` **unset** | `startAuditCleanup` schedules `service.cleanupOldLogs()` every 24h (`backend/src/services/auditLog.ts:688-697`) | Default for single-instance / dev |
| Cloud Scheduler → HTTP | `AUDIT_CLEANUP_TOKEN` **set** | In-process interval **disabled** (`backend/src/services/auditLog.ts:674-679`); cleanup runs via `POST /api/v1/internal/audit-cleanup` (`backend/src/routes/internalRoutes.ts:40-72`) | Scale-to-zero Cloud Run reaps instances before a 24h interval fires — see code comment `auditLog.ts:670-673` |

```ts
// Source: backend/src/services/auditLog.ts:674-679
  if (config.scheduler.auditCleanupToken) {
    logger.info('Audit retention cleanup delegated to Cloud Scheduler; in-process interval disabled', {
      prefix: 'AuditLog',
    });
    return;
  }
```

The Cloud Scheduler endpoint is shared-secret authenticated (constant-time compare of `X-Cleanup-Token`), returns **404** when `AUDIT_CLEANUP_TOKEN` is unset (hides the endpoint) and **401** on a bad token (`backend/src/routes/internalRoutes.ts:45-62`). The cutoff is `now() − RETENTION_DAYS` (`backend/src/services/auditLog.ts:619-620`). Database-level, the `audit_logs_delete` policy independently forbids deleting rows newer than 7 years even from an admin context (`backend/prisma/migrations/20260613_force_rls_and_audit_retention/migration.sql:42-44`).

`AUDIT_CLEANUP_TOKEN` is documented in [`ENV_VARS.md`](./ENV_VARS.md) (`backend/src/config/index.ts:196`).

---

## 4. Administrative Safeguards (§164.308)

| Standard | Requirement | Status | Evidence / Owner | Gap |
|---|---|---|---|---|
| §164.308(a)(1)(i) | Security management process | 🟡 | Prompt-driven security audits in `prompts/01-13,26-32,41-42`; status tracked in [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) and [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) | No formal written security-management policy — TBD (external: policy doc, stub in `docs/`) |
| §164.308(a)(1)(ii)(A) | Risk analysis | 🟡 | Recurring teardown/audit reports under `New Project Documents/` capture technical risk | No formal §164.308 risk-analysis document — TBD (external: risk-analysis SOP) |
| §164.308(a)(1)(ii)(B) | Risk management | 🟡 | Findings remediated PR-by-PR (e.g. C-8 RLS closure, L24 filename encryption) — see [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) | No formal risk-management plan doc |
| §164.308(a)(1)(ii)(D) | Information system activity review | ✅ | Audit log (`backend/src/services/auditLog.ts`), 7-year retention, encrypted PHI snapshots; admin audit-log viewer (`ADMIN` role) | No automated anomaly alerting — see Breach Notification §6 |
| §164.308(a)(2) | Assigned security responsibility | ⏳ | — | TBD (external: name a Security Officer; record in [`RUNBOOK.md`](./RUNBOOK.md)) |
| §164.308(a)(3) | Workforce security | ⏳ | RBAC roles PATIENT/PROVIDER/ADMIN (`backend/src/middleware/rbac.ts`) constrain in-app access | No HR onboarding/termination policy — TBD (external) |
| §164.308(a)(4) | Information access management | ✅ | Consent-based provider sharing with granular permissions (`can_view_biomarkers/insurance/health_needs`, `can_edit_data`), immutable-by-trigger except patient/admin (`backend/prisma/migrations/20260615_provider_consent_immutable_audit_insert_check/migration.sql:19-76`); enforced by RLS + `backend/src/services/providerAccess.ts` | Documented in [`DATA_MODEL.md`](./DATA_MODEL.md) |
| §164.308(a)(5) | Security awareness & training | ⏳ | — | TBD (external: training program) |
| §164.308(a)(6) | Security incident procedures | ⏳ | Audit log + log redaction support forensics | No incident-response SOP — TBD (external; outline in [`RUNBOOK.md`](./RUNBOOK.md)) |
| §164.308(a)(7) | Contingency plan (backup, DR) | 🟡 | Cloud SQL automated backups (GCP-managed); migrations run as a dedicated, retry-disabled Cloud Run job (`.github/workflows/deploy.yml:139-161`) | No written disaster-recovery / data-backup plan — TBD (external: DR doc) |
| §164.308(a)(8) | Evaluation | 🟡 | Periodic prompt-driven teardowns/audits (see `New Project Documents/`) | Cadence not formalized in policy |
| §164.308(b)(1) | Business associate contracts | 🟡 | Code-side BAA gates (§1); Anthropic BAA signed 2026-04-16 | Google / Quest / SendGrid BAAs TBD (external — §1 table) |

---

## 5. Physical Safeguards (§164.310)

All physical safeguards are **inherited from Google Cloud Platform** (the hosting provider) and are covered by the GCP BAA once confirmed (§1). No on-prem hardware holds ePHI.

| Standard | Requirement | Status | Evidence / Owner | Gap |
|---|---|---|---|---|
| §164.310(a)(1) | Facility access controls | ✅ (inherited) | GCP data-center physical security; compute on Cloud Run, data on Cloud SQL/GCS (`.github/workflows/deploy.yml:40-46`) | Covered by GCP BAA — confirm (§1) |
| §164.310(b)/(c) | Workstation use & security | ⏳ | No org-managed workstations in scope yet | TBD (external: workstation policy when workforce grows) |
| §164.310(d)(1) | Device & media controls (disposal, reuse) | ✅ (inherited) | GCP-managed disk encryption & media disposal; app-side, account deletion destroys per-user salt (renders PHI unrecoverable) | Per-user salt destruction documented in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) |

---

## 6. Breach Notification (§164.400–414)

| Item | Status | Evidence / Owner | Gap |
|---|---|---|---|
| Detection — logging | 🟡 | Audit log (`backend/src/services/auditLog.ts`) + PHI redaction in app logs (`backend/src/utils/logger.ts:30`, `phiRedaction.ts`) | Logs exist; **no automated alerting** |
| Detection — alerting | ⚠️ | None in repo | **Most urgent gap** — hook Cloud Logging alert policies to audit anomalies / repeated `LOGIN_FAILED` / RLS-guard FATALs |
| Notification process (§164.404) | ⏳ | — | TBD (external: breach-notification SOP — create and store in [`RUNBOOK.md`](./RUNBOOK.md)) |
| HHS reporting (§164.408) | ⏳ | — | TBD (external: HHS Breach Portal procedure) |
| Notification to media (§164.406, ≥500 individuals) | ⏳ | — | TBD (external: PR/legal procedure) |

**Most urgent breach-notification gap:** automated **detection alerting** (⚠️). The forensic substrate (immutable, 7-year, encrypted audit log + log redaction) exists, but nothing notifies a human when an anomaly occurs. Without alerting, the §164.404 "without unreasonable delay, no later than 60 days" clock cannot start reliably. Resolution: wire Cloud Logging alert policies to audit-log writes and to the RLS boot-guard FATAL exits (`backend/src/services/database.ts:253,305`).

---

## 7. Required documentation status

| Document | Required by | Status | Where it lives / should live |
|---|---|---|---|
| Risk analysis | §164.308(a)(1)(ii)(A) | 🟡 (technical-only) | Teardown/audit reports in `New Project Documents/`; formal doc TBD (external) |
| Policies & procedures | §164.316(a) | ⏳ | TBD (external: formal policy not yet written — flag to compliance owner; stub in `docs/` when drafted) |
| Sanction policy | §164.308(a)(1)(ii)(C) | ⏳ | TBD (external) |
| BAAs | §164.308(b)(1) | 🟡 | §1 table; Anthropic signed 2026-04-16; others TBD (external) |
| Audit / activity logs | §164.312(b) | ✅ | `backend/src/services/auditLog.ts` (7-year, encrypted, DB-enforced retention) |
| Breach-response runbook | §164.404 | ⏳ | [`RUNBOOK.md`](./RUNBOOK.md) (breach-response operational steps) |
| Per-field PHI matrix | §164.502(b) min-necessary | ✅ | [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) |

---

## 8. Minimum necessary + PHI access

ePHI is encrypted field-by-field (AES-256-GCM, per-user PBKDF2-SHA512 key). The authoritative per-field matrix — every PHI field × encryption × write/read sites × audit coverage — is in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md). The canonical field list is `PHI_FIELDS` (`backend/src/services/encryption.ts:476-562`): **14 models / 39 encrypted fields**, in perfect lockstep with the 39 `*Encrypted` schema columns.

Recent coverage additions (post-2026-06-01) a stale inventory would miss:

| Field | `PHI_FIELDS` line | Migration |
|---|---|---|
| `UserFile.originalFilenameEncrypted` (raw client filename can embed identifiers) | `backend/src/services/encryption.ts:499` | `20260615_encrypt_userfile_original_filename` (L24) |
| `HealthGoal.currentValueEncrypted`, `startValueEncrypted` | `backend/src/services/encryption.ts:519-520` | `20260613_encrypt_goal_values` (M4) |
| `GoalProgressHistory.valueEncrypted` | `backend/src/services/encryption.ts:524` | `20260613_encrypt_goal_values` (M4) |
| `AuditLog.metadataEncrypted` (plaintext `metadata` column dropped) | `backend/src/services/encryption.ts:530` | `20260606000001_encrypt_audit_metadata` + `20260615_drop_legacy_audit_metadata` (M6) |
| `User.healthProfileEncrypted` | `backend/src/services/encryption.ts:484` | `20260418_add_health_profile` |
| `LabConnection.accessTokenEncrypted`, `refreshTokenEncrypted` | `backend/src/services/encryption.ts:559-560` | `20260418_add_lab_connections` |

Minimum-necessary in access: provider sharing is consent-scoped per permission column, and the consent columns are trigger-protected from forgery (`backend/prisma/migrations/20260615_provider_consent_immutable_audit_insert_check/migration.sql:19-76`).

---

## 9. Roadmap

Tracking is **in-repo** (no external issue tracker referenced in code); items map to findings in [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) and [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

### Phase A — close the highest-leverage compliance gaps (now)
- ⚠️ **Breach detection alerting** — wire Cloud Logging alert policies to audit anomalies + RLS boot-guard FATALs (`backend/src/services/database.ts:253,305`). §164.404 enabler.
- ⏳ **Confirm Google + Quest + SendGrid BAAs** — resolve §1 TBDs in GCP Console / vendor portals; gates already enforce in prod (`backend/src/config/index.ts:401-414`).
- ⏳ **Name a Security Officer** (§164.308(a)(2)) — record in [`RUNBOOK.md`](./RUNBOOK.md).

### Phase B — administrative policy set (beta gate)
- ⏳ Author §164.316 policies & procedures, incident-response SOP (§164.308(a)(6)), breach-notification SOP (§164.404), DR/backup plan (§164.308(a)(7)). Stub in `docs/`.
- ⏳ Formal §164.308(a)(1)(ii)(A) risk analysis.

### Phase C — technical hardening (post-beta)
- 🟡 MFA (strengthens §164.312(d)).
- 🟡 Shared rate-limit / spend store via `REDIS_URL` to remove per-instance dilution (`backend/src/config/index.ts:186`).
- 🟡 Break-glass emergency-access SOP (§164.312(a)(2)(ii)).
- 🟡 Resolve the dev/staging RLS-runtime caveat (provision a `NOBYPASSRLS` app role in those tiers) — see [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

---

## 10. Acceptance questions (self-answered from this doc)

**Q1. Which vendors have signed BAAs, and when?** Anthropic — ✅ signed **2026-04-16** (§1). Google Cloud (infra + Document AI), Quest, SendGrid — ⏳ TBD (external), with runtime gates enforcing in production (§1).

**Q2. What code evidence satisfies §164.312(a) auto-logoff, and what's the timeout?** Access JWT lifetime **900s / 15 min** (`backend/src/config/index.ts:121`), enforced by `jwt.verify` on every request (`backend/src/middleware/auth.ts:95`) — §2 row "Automatic logoff."

**Q3. Where is ePHI encryption implemented and which PHI fields are covered?** AES-256-GCM + PBKDF2-SHA512 (600k) in `backend/src/services/encryption.ts:236,247-253,284`; `PHI_FIELDS` covers **14 models / 39 fields** (`:476-562`). Per-field matrix in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) (§2, §8).

**Q4. §164.312(a)(1) access control status, prod vs dev/staging?** ✅ prod / 🟡 dev-staging. RLS + FORCE RLS on 19 tables; `assertNoBypassRLS()`/`assertRLSForced()` hard-exit in prod (`backend/src/services/database.ts:253,305`), warn-only in dev/staging (`:256,308`) — §2 row "Access control (RLS)."

**Q5. Which scheduler enforces 7-year audit retention, and where?** Either an in-process 24h `setInterval` (`backend/src/services/auditLog.ts:688`) when `AUDIT_CLEANUP_TOKEN` is unset, **or** Cloud Scheduler hitting `POST /api/v1/internal/audit-cleanup` (`backend/src/routes/internalRoutes.ts:40`) when it is set, with the in-process interval disabled (`auditLog.ts:674-679`). DB also enforces it via the delete policy (§3).

**Q6. Which standards are ✅ vs 🟡 vs ⏳?** ✅: unique ID, auto-logoff, encryption at rest, OAuth-token encryption, audit controls, authentication, transmission security, RLS (prod), CSRF, rate limiting, input validation, AI spend breaker. 🟡: integrity, log redaction, RLS (dev/staging), most §164.308 administrative items. ⏳: emergency access, security officer, training, incident/breach SOPs — §2, §4, §6.

**Q7. Is the Anthropic BAA active, and how does code gate on it? Same for Google Document AI?** Anthropic ✅; prod boot throws if `ANTHROPIC_API_KEY` set + `ANTHROPIC_BAA_ACTIVE` unset (`backend/src/config/index.ts:381-394`). Google Document AI gated identically by `GOOGLE_BAA_ACTIVE`/`documentAiBaaActive` (`backend/src/config/index.ts:401-414`); BAA status ⏳ TBD (external) — §1.

**Q8. Most urgent breach-notification gap?** Automated **detection alerting** (⚠️) — the audit/log substrate exists but nothing notifies a human; the §164.404 clock can't reliably start (§6).

**Q9. Where is the per-field PHI encryption matrix?** [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md), backed by `PHI_FIELDS` (`backend/src/services/encryption.ts:476-562`) — §8.

**Q10. RLS C-8 status, where is `assertNoBypassRLS()` enforced, residual dev/staging gap?** C-8 **closed in production**; `assertNoBypassRLS()` at `backend/src/services/database.ts:217`, called `:192`, `process.exit(1)` in prod `:253`. Residual: dev/staging only warn (`:256`) — RLS structurally present but not runtime-active until a `NOBYPASSRLS` role is provisioned there (§2, [`SECURITY_STATUS.md`](./SECURITY_STATUS.md)).

**Q11. How does password hashing satisfy §164.312(d), at what bcrypt cost?** `bcrypt.hash(password, config.security.bcryptRounds)` (`backend/src/services/authService.ts:404`), cost **13** (`backend/src/config/index.ts:160`) — §2 row "Person/entity authentication."

**Q12. Is TLS enforced at the load balancer, and what cites it?** Yes — Cloud Run is HTTPS-only at the edge; deploy step `gcloud run deploy` (`.github/workflows/deploy.yml:183`); DB over Cloud SQL connector (`.github/workflows/deploy.yml:143`) — §2 row "Transmission security."

**Q13. How are Quest SMART-on-FHIR OAuth tokens protected at rest, and which `PHI_FIELDS` entries cover them?** Encrypted with the per-user key before write (`backend/src/services/fhir/labSyncService.ts:144-187`); covered by `PHI_FIELDS.LabConnection = ['accessTokenEncrypted', 'refreshTokenEncrypted']` (`backend/src/services/encryption.ts:558-561`; columns `backend/prisma/schema.prisma:763-764`) — §1, §2, §8.

---

## Related Documents

- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — open findings (C-8 RLS, dev/staging gap) mapped to the partial/gap statuses above.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — per-field PHI × encryption × write/read × audit-coverage matrix (the min-necessary detail behind §164.312(a)(2)(iv)).
- [DATA_MODEL.md](./DATA_MODEL.md) — full ER, the 19 RLS tables, consent permission columns, cascade behavior.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — encryption + audit + RLS layers at the system level.
- [ENV_VARS.md](./ENV_VARS.md) — BAA gates (`ANTHROPIC_BAA_ACTIVE`, `GOOGLE_BAA_ACTIVE`), `PHI_ENCRYPTION_KEY`, `AUDIT_CLEANUP_TOKEN`, `QUEST_FHIR_*`.
- [RUNBOOK.md](./RUNBOOK.md) — breach-response operational steps; where to record the Security Officer.
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — tracked compliance-adjacent issues.

---

## Prompt drift log

- `../prompts/22-hipaa-checklist-doc.md` Files-to-review table and §164.312 example say `PHI_FIELDS` covers fields without a count, but the fact-digest's `FACT[phi-fields]` summary line states "14 models, 37 encrypted fields." The **live code and the canonical numbers are 14 models / 39 fields** (`backend/src/services/encryption.ts:476-562`, counted: User 6, Biomarker 2, BiomarkerHistory 1, UserFile 1, InsurancePlan 2, ProviderPatient 1, HealthNeed 1, HealthGoal 4, GoalProgressHistory 2, AuditLog 3, ExpenseProjection 3, ExpenseActual 8, CostAnalysis 3, LabConnection 2 = 39). The "37" in the fact-digest body is a stale sub-count; `prompts/_phi-inventory.md:29` correctly says 39. Used 39.
- `../prompts/22-hipaa-checklist-doc.md` cites the RLS guards at `database.ts:192` (`assertNoBypassRLS`), `:193`/`:270` (`assertRLSForced`), and exits at `:253`/`:305`. Verified live: `assertNoBypassRLS` is **defined** at `backend/src/services/database.ts:217` (called at `:192`, prod-exit at `:253`); `assertRLSForced` defined at `:270` (called at `:193`, prod-exit at `:305`). The prompt's `:192`/`:193` are the *call sites* (correct); the definition line for `assertNoBypassRLS` is `:217`, not `:192`. Cited both.
- `../prompts/22-hipaa-checklist-doc.md` says "GitHub workflows … deploy.yml:183" for `gcloud run deploy` — verified at `.github/workflows/deploy.yml:183`. The FORCE-RLS migration enumerates 18 tables (`:14-31`); the 19th (`revoked_access_tokens`) is forced in its own migration `20260613_revoked_access_tokens`. Total 19 RLS tables matches the canonical count.
- [`CLAUDE.md`](../CLAUDE.md) "PHI Encryption" section is stale: it lists `Biomarker.unit`, `InsurancePlan.planName/insurerName/benefits` as encrypted — none are `*Encrypted` columns or in `PHI_FIELDS`. Did not propagate; cited live `PHI_FIELDS` instead. CLAUDE.md also still lists `uploadController.ts` (10 controllers) — upload handlers now live in `backend/src/controllers/upload/`.
