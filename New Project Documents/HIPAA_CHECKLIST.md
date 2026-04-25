---
tags:
  - documentation
  - hipaa
  - compliance
  - reference
type: generated-doc
prompt: prompts/22-hipaa-checklist-doc.md
generated: 2026-04-24
audit-date: 2026-04-25
maturity-phase: pre-beta
compliance-officer: TBD (external: no named compliance officer yet — appoint before beta; stakeholder decision required)
---

# HIPAA Compliance Checklist

## Purpose and scope

This document maps every applicable HIPAA Security Rule standard (45 CFR §§ 164.308, 164.310, 164.312) and Breach Notification Rule element (§§ 164.400–414) to concrete **code evidence** (`file:line`), **status**, and **gaps**. It is a current-state reference, not a policy document: policies, SOPs, and workforce training artifacts live outside the repo and are flagged TBD where absent.

For per-field encryption/audit coverage (e.g., "is `User.phoneEncrypted` redacted in logs?"), consult [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — this doc does **not** re-enumerate PHI fields. For open security findings (C-1 … C-8, F-series), consult [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

**Audit date**: 2026-04-25
**Maturity phase**: pre-beta. No live PHI at scale; small alpha-tester cohort.
**Compliance officer**: TBD (external: unassigned — must be named before beta launch).

Status legend: ✅ shipped • 🟡 partial • ⚠️ gap / open finding • ⏳ pending / planned

---

## 1. Business Associate Agreements (BAAs)

| Vendor | Service | BAA status | Date (ISO) | Source of truth |
|---|---|---|---|---|
| Google Cloud (GCP) | Cloud Run, Cloud SQL (PostgreSQL), Cloud Storage, Document AI, Secret Manager, Artifact Registry | TBD (external: check GCP Console billing contact for `ownmyhealth-prod` project; Google's standard [BAA](https://cloud.google.com/terms/service-terms) auto-applies once customer accepts it — no in-repo artifact) | TBD (external: resolve via GCP Console → IAM & Admin → Identity & Organization → Compliance) | Not in repo — `.github/workflows/deploy.yml:9` references `PROJECT_ID: ownmyhealth-prod` |
| Anthropic | Claude API (`claude-sonnet-*`, `claude-haiku-*`) for biomarker guidance, SBC extraction, cost analysis | ✅ Signed | 2026-04-16 | Project memory — see also runtime gate `ANTHROPIC_BAA_ACTIVE` at [`backend/src/config/index.ts:150`](../backend/src/config/index.ts) and hard-fail at [`config/index.ts:L245-L258`](../backend/src/config/index.ts) |
| SendGrid (Twilio) | Transactional email (verification, password reset) | TBD (external: BAA required before any email-linked PHI context; today's templates carry no PHI) | TBD (external: Twilio HIPAA BAA request portal) | `backend/src/services/emailService.ts`, consumers `SENDGRID_API_KEY` (see [`ENV_VARS.md`](./ENV_VARS.md)) |
| Google Document AI | OCR of scanned lab reports | Covered by GCP umbrella BAA (same project/billing — row above) | (inherits GCP row) | `backend/src/services/ocrService.ts` |

### Anthropic BAA enforcement (code path)

```ts
// Source: backend/src/config/index.ts:L144-L151
// Anthropic Claude API (see C-7 — BAA gate for PHI disclosure)
anthropic: {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  // Explicit flag that asserts a signed Business Associate Agreement
  // is in effect. Runtime callers in claudeExtraction / sbcExtraction
  // check this before sending any PDF content.
  baaActive: process.env.ANTHROPIC_BAA_ACTIVE === 'true',
},
```

```ts
// Source: backend/src/config/index.ts:L245-L258
if (config.anthropic.apiKey && !config.anthropic.baaActive) {
  if (config.isProduction) {
    throw new Error(
      'ANTHROPIC_BAA_ACTIVE must be set to "true" in production when ANTHROPIC_API_KEY is configured. ' +
      'This flag asserts that a signed Business Associate Agreement is in effect. ' +
      'If no BAA is in place, unset ANTHROPIC_API_KEY to disable AI features.'
    );
  } else {
    process.stderr.write(
      '⚠️  ANTHROPIC_BAA_ACTIVE is not set to "true". Claude calls will be blocked by the runtime gate. ' +
      'Set ANTHROPIC_BAA_ACTIVE=true after confirming BAA coverage.\n'
    );
  }
}
```

---

## 2. Administrative Safeguards (§164.308)

| Requirement | Reference | Status | Evidence / owner | Gap |
|---|---|---|---|---|
| Security Management Process — Risk Analysis | §164.308(a)(1)(ii)(A) | 🟡 | Draft at [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md) (v1.0, 2026-04-25) — 12 enumerated threats, controls assessment, residual-risk matrix, remediation plan. Code-level audits remain in `New Project Documents/SECURITY_AUDIT_*.md` and [`SECURITY_STATUS.md`](./SECURITY_STATUS.md). | Move from draft to signed: owner sign-off + external HIPAA reviewer if engaged. Quarterly review cadence (next: 2026-07-25). |
| Security Management — Risk Management (remediation) | §164.308(a)(1)(ii)(B) | ✅ | [`SECURITY_STATUS.md`](./SECURITY_STATUS.md): C-1 through C-7 closed, C-8 code-complete (operator-pending), all ~22 Highs and ~33 Mediums closed in the 2026-04-16 + 2026-04-24 remediation cycles. | Runtime RLS gap (C-8) is operator-pending only — code prerequisites all merged. See §4 Technical Safeguards. |
| Sanction Policy | §164.308(a)(1)(ii)(C) | ⏳ | No workforce sanction policy doc. | Draft policy before first workforce member beyond founder. |
| Information System Activity Review | §164.308(a)(1)(ii)(D) | 🟡 | Audit logs retained 7y ([`auditLog.ts:9`](../backend/src/services/auditLog.ts) `RETENTION_DAYS = 2555`); admin UI can query ([`auditLog.ts:426`](../backend/src/services/auditLog.ts) `queryLogs`). No scheduled review cadence. | Stand up monthly log-review SOP. |
| Assigned Security Responsibility (Privacy/Security Officer) | §164.308(a)(2) | ⏳ | TBD (external: unassigned — founder role until compliance officer hired). | Appoint before beta. |
| Workforce Security — Authorization / Clearance | §164.308(a)(3)(ii)(A–B) | 🟡 | Code-level role separation (`PATIENT` / `PROVIDER` / `ADMIN`) enforced by [`rbac.ts:16`](../backend/src/middleware/rbac.ts) `ROLE_HIERARCHY`. No written workforce-clearance procedure. | Draft workforce access-authorization SOP. |
| Workforce Security — Termination Procedures | §164.308(a)(3)(ii)(C) | ⏳ | `revokeAllUserTokens(userId)` ([`authService.ts:387`](../backend/src/services/authService.ts)) can force re-login everywhere on credential revocation. No written termination checklist. | Create termination SOP. |
| Information Access Management — Isolating Health-Care Clearinghouse Functions | §164.308(a)(4)(ii)(A) | N/A | Not a clearinghouse. | — |
| Information Access Management — Access Authorization | §164.308(a)(4)(ii)(B) | ✅ | [`rbac.ts:31`](../backend/src/middleware/rbac.ts) `ROLE_PERMISSIONS` matrix (PATIENT/PROVIDER/ADMIN × resource × action); consent-based provider access via `ProviderPatient.canView*` flags checked in [`rbac.ts:241-L256`](../backend/src/middleware/rbac.ts). | — |
| Information Access Management — Access Establishment & Modification | §164.308(a)(4)(ii)(C) | ✅ | Consent grants/revokes are first-class audit events via [`providerRoutes.ts:220`](../backend/src/routes/providerRoutes.ts) (`logCreate` on `provider_patient_request`). | — |
| Security Awareness & Training | §164.308(a)(5) | ⏳ | No training program. | Required before first non-founder workforce member. |
| Security Incident Procedures | §164.308(a)(6)(ii) | 🟡 | [`RUNBOOK.md`](./RUNBOOK.md) operational incident runbook; HIPAA-specific breach-response SOP drafted at [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md) (v1.0, 2026-04-25); written security policies at [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md). | Move from draft to signed; wire Cloud Logging alert policies for detection (see §5). |
| Contingency Plan — Data Backup | §164.308(a)(7)(ii)(A) | 🟡 | Backup posture documented in [`CONTINGENCY_PLAN.md §2`](./CONTINGENCY_PLAN.md#2-data-backup-plan--164308a7iia) — Cloud SQL automated backups, PITR, GCS object versioning, master-key Secret Manager versioning. | Confirm `[CONFIRM]` markers in §2 (PITR enabled, retention window, GCS versioning); execute first quarterly restore drill 2026-07-25. |
| Contingency Plan — Disaster Recovery | §164.308(a)(7)(ii)(B) | 🟡 | Per-scenario recovery procedures with `gcloud` commands and RTO targets in [`CONTINGENCY_PLAN.md §3`](./CONTINGENCY_PLAN.md#3-disaster-recovery-plan--164308a7iib): Cloud Run, Cloud SQL, GCS, Anthropic, SendGrid, DNS, workstation, master-key compromise/loss, complete-infra rebuild. RPO/RTO targets at [`§1.4`](./CONTINGENCY_PLAN.md#14-rpo--rto-targets). | Resolve `[CONFIRM]` markers; provision multi-region failover (deferred — pre-beta acceptable). |
| Contingency Plan — Emergency Mode Operation | §164.308(a)(7)(ii)(C) | 🟡 | Read-only mode, maintenance page, manual-decryption skeleton, and communication plan documented in [`CONTINGENCY_PLAN.md §4`](./CONTINGENCY_PLAN.md#4-emergency-mode-operation-plan--164308a7iic). | Read-only feature flag and maintenance-page URL-map override are documentation-only today; track as pre-beta gaps in [`CONTINGENCY_PLAN.md §7.1`](./CONTINGENCY_PLAN.md#71-pre-beta-gaps-acknowledged-in-this-plan). |
| Contingency Plan — Testing & Revision | §164.308(a)(7)(ii)(D) | 🟡 | Quarterly drill schedule, success criteria, drill-log template, and step-by-step restore runbook in [`CONTINGENCY_PLAN.md §§5–6`](./CONTINGENCY_PLAN.md#5-testing-and-revision-procedures--164308a7iid). | First drill scheduled 2026-07-25; until then, plan is documented but unexercised. |
| Contingency Plan — Applications & Data Criticality Analysis | §164.308(a)(7)(ii)(E) | 🟡 | Component criticality enumerated in [`CONTINGENCY_PLAN.md §1.2`](./CONTINGENCY_PLAN.md#12-scope) (component → purpose → failure section); RPO/RTO per-component in [`§1.4`](./CONTINGENCY_PLAN.md#14-rpo--rto-targets). | — |
| Evaluation (periodic technical/non-technical) | §164.308(a)(8) | 🟡 | Security audits exist (`SECURITY_AUDIT_*.md`). Not yet on a formal cadence. | Set semi-annual cadence. |
| Business Associate Contracts | §164.308(b)(1) | 🟡 | Anthropic ✅; GCP and SendGrid TBD — see §1. | Close outstanding BAAs before live PHI intake. |

---

## 3. Physical Safeguards (§164.310)

All physical controls are **inherited from Google Cloud Platform** via the GCP BAA (see §1 — TBD until confirmed in Console). GCP-hosted services: Cloud Run (compute), Cloud SQL (database), Cloud Storage (file storage), Document AI (OCR), Secret Manager (secrets), Artifact Registry (container images).

| Requirement | Reference | Status | Evidence |
|---|---|---|---|
| Facility Access Controls | §164.310(a) | ✅ inherited | GCP data centers (see [Google Cloud security](https://cloud.google.com/security/compliance/hipaa)). Workforce accesses production only via authenticated `gcloud`/Console — no physical facility owned by OwnMyHealth. |
| Workstation Use / Workstation Security | §164.310(b)–(c) | ⏳ | Founder-only workstation today. | Workstation-use SOP before workforce expands. |
| Device & Media Controls — Disposal | §164.310(d)(2)(i) | ✅ inherited | GCP media disposal per [Google's data-deletion SLA](https://cloud.google.com/security/deletion). |
| Device & Media Controls — Media Re-use | §164.310(d)(2)(ii) | ✅ inherited | Same as above. |
| Accountability (who handles media) | §164.310(d)(2)(iii) | ✅ inherited | GCP IAM audit trail. |
| Data Backup & Storage (physical) | §164.310(d)(2)(iv) | ✅ inherited | Cloud SQL replicated backups. |

---

## 4. Technical Safeguards (§164.312) — load-bearing table

Status counts (see also self-check in §9): ✅ 6 / 🟡 2 / ⚠️ 1 / ⏳ 0.

| Requirement | Standard | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| Unique user identification | §164.312(a)(2)(i) | ✅ | `User.id` is a DB-generated UUID — [`backend/prisma/schema.prisma:11`](../backend/prisma/schema.prisma) `id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`. Every JWT carries this ID in `payload.id` ([`authService.ts:200`](../backend/src/services/authService.ts) `generateAccessToken`). | UUID format validated at the RLS boundary ([`database.ts:358`](../backend/src/services/database.ts) `UUID_REGEX`). |
| Emergency access procedure | §164.312(a)(2)(ii) | 🟡 | `ADMIN` role has full override via [`rbac.ts:48-L55`](../backend/src/middleware/rbac.ts) + admin RLS bypass via [`database.ts:377-L386`](../backend/src/services/database.ts) `applyRLSContext`. | No documented "break-glass" SOP naming an emergency-access actor. Draft before beta. |
| Automatic logoff | §164.312(a)(2)(iii) | ✅ | Access token expires in **15 min** (900 s) — [`config/index.ts:62`](../backend/src/config/index.ts) `accessExpiresIn: parseInt(process.env.JWT_ACCESS_EXPIRES_SECONDS \|\| '900', 10)`. Refresh token expires 7 d — [`config/index.ts:66`](../backend/src/config/index.ts). Token-expired branch returns `UnauthorizedError('Token has expired…')` at [`auth.ts:103-L105`](../backend/src/middleware/auth.ts). Server-side enforcement: 10-minute session cleanup scheduler [`authService.ts:1227`](../backend/src/services/authService.ts) `startSessionCleanup`, running `cleanupExpiredSessions` every 10 min (was hourly; tightened in F-13 fix). | Revoked on logout via in-memory set at [`authService.ts:139`](../backend/src/services/authService.ts) (`revokedTokens`) — see Drift §8 for multi-instance caveat. |
| Encryption / decryption at rest | §164.312(a)(2)(iv) | ✅ | AES-256-GCM at [`encryption.ts:58`](../backend/src/services/encryption.ts) (`ALGORITHM = 'aes-256-gcm'`), `encrypt()` [`encryption.ts:263`](../backend/src/services/encryption.ts), `decrypt()` [`encryption.ts:288`](../backend/src/services/encryption.ts). Per-user key derivation PBKDF2-SHA512 600k iters at [`encryption.ts:86`](../backend/src/services/encryption.ts) (`PBKDF2_ITERATIONS`), derived in [`encryption.ts:193`](../backend/src/services/encryption.ts) `deriveUserKey`. Per-user salt lifecycle in [`userEncryption.ts:29`](../backend/src/services/userEncryption.ts) `getUserEncryptionSalt`. Master key validated at [`encryption.ts:103`](../backend/src/services/encryption.ts) `validateEncryptionKey` and again at [`config/index.ts:L279-L308`](../backend/src/services/index.ts). | Coverage: 36 PHI fields across 15 models enumerated in [`PHI_TAXONOMY.md §2`](./PHI_TAXONOMY.md#2-master-phi-table). Single source of truth = `PHI_FIELDS` at [`encryption.ts:411`](../backend/src/services/encryption.ts). |
| Audit controls | §164.312(b) | ✅ | `AuditLogService` at [`auditLog.ts:91`](../backend/src/services/auditLog.ts). Every `log*` method (`logAccess` `:259`, `logCreate` `:279`, `logUpdate` `:301`, `logDelete` `:325`, `logAuth` `:347`, `logExport` `:385`, `logSystem` `:410`) persists to `audit_logs` table with encrypted `previousValueEncrypted` / `newValueEncrypted`. 7-year retention (`RETENTION_DAYS = 2555`) at [`auditLog.ts:9`](../backend/src/services/auditLog.ts). Cleanup scheduler: daily interval at [`auditLog.ts:534`](../backend/src/services/auditLog.ts) (`setInterval(…, 24 * 60 * 60 * 1000)`) running `cleanupOldLogs` at `:475`. Audit values use **system salt** (not per-user) so rows remain decryptable after account deletion — [`auditLog.ts:L119-L127`](../backend/src/services/auditLog.ts). | Coverage per PHI field in [`PHI_TAXONOMY.md §2`](./PHI_TAXONOMY.md#2-master-phi-table) — every write audited; most reads audited. |
| Integrity controls (ePHI authentication) | §164.312(c) | 🟡 | AES-256-GCM's authentication tag (AEAD) provides tamper detection — generated at [`encryption.ts:224`](../backend/src/services/encryption.ts) (`cipher.getAuthTag()`), verified at [`encryption.ts:320`](../backend/src/services/encryption.ts) (`decipher.setAuthTag(authTag)`). Auth-tag failure throws at [`encryption.ts:322`](../backend/src/services/encryption.ts). Immutable audit log (no UPDATE / DELETE by policy — only 7y retention DELETE via `cleanupOldLogs`) provides integrity ledger. | No application-level integrity signing beyond AEAD (no HMAC-over-record, no chain-of-custody ledger). Acceptable for current maturity; revisit if regulatory auditor pushes for record-level signatures. |
| Person or entity authentication | §164.312(d) | ✅ | JWT verification (`jwt.verify`) at [`auth.ts:83`](../backend/src/middleware/auth.ts) and [`authService.ts:309`](../backend/src/services/authService.ts) `verifyAccessToken`. Passwords hashed with bcrypt (13 rounds, HIPAA-grade) at [`authService.ts:158`](../backend/src/services/authService.ts) `hashPassword` using `bcrypt.hash(password, config.security.bcryptRounds)`; rounds set at [`config/index.ts:93`](../backend/src/services/config/index.ts) (`BCRYPT_ROUNDS \|\| '13'`). Password strength enforced (12 chars + upper/lower/digit/special) at [`authService.ts:171`](../backend/src/services/authService.ts) `validatePasswordStrength`. Account lockout after 5 failed attempts for 30 min at [`authService.ts:L506-L538`](../backend/src/services/authService.ts) `recordFailedLogin`. Timing-safe login path at [`authService.ts:L739-L755`](../backend/src/services/authService.ts). | MFA not implemented — flagged on roadmap (§6). |
| Transmission security | §164.312(e)(1) + (e)(2)(ii) | ✅ | **TLS 1.2+ enforced at the edge** by Cloud Run — HTTPS-only ingress, automatic certificates. Backend deploy at [`.github/workflows/deploy.yml:66`](../.github/workflows/deploy.yml) `gcloud run deploy`; post-deploy probe hits `https://api.ownmyhealth.io/api/v1/health` ([`deploy.yml:160`](../.github/workflows/deploy.yml)). Frontend served over HTTPS from GCS bucket ([`deploy.yml:208`](../.github/workflows/deploy.yml)). Cookies set `secure: true` in production at [`config/index.ts:75`](../backend/src/services/config/index.ts). App sits behind `app.set('trust proxy', 1)` at [`app.ts:119`](../backend/src/app.ts) so Cloud Run's TLS-terminating proxy is honored. DB-layer encryption in transit via **Cloud SQL Auth Proxy** (TLS 1.3 between Cloud Run and Cloud SQL) — configured by the `DATABASE_URL` secret pointing at the proxy host. HSTS supplied by `helmet()` defaults at [`app.ts:124`](../backend/src/app.ts). | Railway frontend config at [`railway.toml`](../railway.toml) is dev-only; production front-end is GCS per `deploy.yml`. |
| Access control — technical (RLS at DB layer) | §164.312(a)(1) | 🟡 **policy + code complete, infra-pending** | Policies defined at [`backend/prisma/migrations/20260107_add_rls_policies/migration.sql:1-L100+`](../backend/prisma/migrations/20260107_add_rls_policies/migration.sql). Application-side wrappers `withRLSContext` / `withRLSTransaction` at [`database.ts:456`](../backend/src/services/database.ts) / [`database.ts:477`](../backend/src/services/database.ts) issue parameterized `SELECT set_config('app.current_user_id', …, true)` via `applyRLSContext` at [`database.ts:377-L386`](../backend/src/services/database.ts). Self-elevation guard added 2026-04-24 via [`20260424_prevent_self_role_elevation/migration.sql`](../backend/prisma/migrations/20260424_prevent_self_role_elevation/migration.sql) — DB-level trigger blocks role/`is_active` mutation by non-admin sessions. CI footgun guard at `scripts/check-rls-wrappers.sh` extended 2026-04-24 to catch `prisma.$queryRaw` / `$executeRaw` / `$transaction` and the `utils/` directory. Multi-tenant integration tests at [`__tests__/integration/rls-isolation.test.ts`](../backend/src/__tests__/integration/rls-isolation.test.ts) pin every user-scoped model + admin context + privilege-immutability + pool-leak invariants. Startup assertion `assertNoBypassRLS()` at [`database.ts:200-265`](../backend/src/services/database.ts) hard-exits in production unconditionally on `BYPASSRLS=true` (the `RLS_ENFORCEMENT=strict` env-var opt-out was removed 2026-04-24). | **C-8 — operator-pending only**: the live application role has `BYPASSRLS=true` in both dev and prod today. All code prerequisites merged; the only remaining step is the `omh_app` NOBYPASSRLS role provisioning + `DATABASE_URL` rotation in Secret Manager. The startup assertion will catch any deploy that ships before the rotation completes. See [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) C-8 row for the operator runbook. |
| Minimum necessary (log redaction) | §164.502(b) + §164.312(b) | 🟡 | `SENSITIVE_FIELDS` Set at [`logger.ts:21-L30`](../backend/src/utils/logger.ts); recursive redaction `sanitizeData` / `sanitizeValue` at [`logger.ts:L39-L56`](../backend/src/utils/logger.ts). Auth logs are dev-only ([`logger.ts:150`](../backend/src/utils/logger.ts)). Structured JSON logs for Cloud Logging at [`logger.ts:L88-L104`](../backend/src/utils/logger.ts). | **Drift vs. PHI_FIELDS** — several encrypted keys (`firstNameEncrypted`, `lastNameEncrypted`, `dateOfBirthEncrypted`, `phoneEncrypted`, `addressEncrypted`, `healthProfileEncrypted`, `notesEncrypted`, `targetValueEncrypted`, expense `*Encrypted` fields) are not in `SENSITIVE_FIELDS` — see redaction-gap table in [`PHI_TAXONOMY.md §4 "Drift — PHI fields NOT redacted"`](./PHI_TAXONOMY.md#drift--phi-fields-not-redacted-by-sensitive_fields). |

### Defense-in-depth supporting §164.312(a)

| Layer | Source | Purpose |
|---|---|---|
| Helmet (security headers incl. HSTS, CSP) | [`app.ts:124`](../backend/src/app.ts) | Transport hardening |
| CORS allow-list | [`app.ts:L147-L187`](../backend/src/app.ts) | Origin validation |
| CSRF double-submit cookie | [`csrf.ts:17-L18`](../backend/src/middleware/csrf.ts) (`csrf_token` cookie + `x-csrf-token` header), mounted at [`app.ts:212`](../backend/src/app.ts) | Prevent state-changing cross-site requests |
| Bearer-only auth for SSE routes | [`auth.ts:166`](../backend/src/middleware/auth.ts) `requireBearerAuth` | CSRF-exempt routes cannot rely on cookie auth (closes the hole the exemption would otherwise open) |
| Rate limiting (6 named limiters) | `backend/src/middleware/rateLimiter.ts`, global standard limiter at [`app.ts:216`](../backend/src/app.ts) | Brute-force + DoS |
| Zod input validation | `backend/src/middleware/validation.ts` | Reject malformed PHI payloads at the API boundary |
| Content-Type validation | [`app.ts:230`](../backend/src/app.ts) `requireJsonContentType` | Prevent form-type confusion / CSRF bypass |
| Cache-Control `no-store` on `/api` | [`app.ts:L237-L239`](../backend/src/app.ts) | Block intermediate cache of PHI responses |

### §164.312 status flow (request-lifecycle view)

```
Client (HTTPS)
   │
   ▼  TLS 1.2+ terminated by Cloud Run edge (§164.312(e)) ✅
Cloud Run revision (trust proxy=1, HSTS via helmet) — app.ts:119, :124
   │
   ▼  helmet → CORS → cookieParser → compression → CSRF → rate-limit → body-parse → requireJsonContentType
   │                                                                       (app.ts:124-230)
   ▼
authenticate middleware — auth.ts:70 ✅ §164.312(d)
   │  (JWT verify: iss/aud via JWT_VERIFY_OPTIONS, exp ≤ 15 min — config/index.ts:62)
   │  (auto-logoff on exp: §164.312(a)(2)(iii) ✅)
   ▼
rbac.requireRole / requirePermission — rbac.ts:61 / :101 ✅ §164.308(a)(4)(ii)(B)
   │
   ▼
Controller → withRLSContext(userId, async (tx) => ...) — database.ts:456
   │                                                  │
   │                                                  └── SET LOCAL app.current_user_id  🟡  C-8: BYPASSRLS role still defeats policy in prod today; startup assertion fails-closed the moment role rotates
   ▼                                                       (database.ts:377, :220)
tx.* query          ──┐
   │                  │
   ▼                  ▼
PostgreSQL (TLS via Cloud SQL Auth Proxy)
 ├── RLS policies — migration.sql:1-L100+  (would enforce if role were NOBYPASSRLS)
 └── PHI columns (ciphertext)
         │
         ▼ decrypt(value, userSalt) — encryption.ts:288  ✅ §164.312(a)(2)(iv) + integrity via AEAD §164.312(c)
Controller response
 ├── auditService.logAccess / logUpdate / logDelete — auditLog.ts:259+  ✅ §164.312(b)
 └── logger.* (SENSITIVE_FIELDS redaction — logger.ts:21)  🟡 §164.502(b) drift
```

---

## 5. Breach Notification (§164.400–414)

| Item | Reference | Status | Evidence / owner | Gap |
|---|---|---|---|---|
| Detection procedures | §164.402 (Breach definition) | 🟡 | `logger.error` paths for encryption failures ([`encryption.ts:L376-L378`](../backend/src/services/encryption.ts)), audit failures ([`auditLog.ts:L238-L248`](../backend/src/services/auditLog.ts)), and auth anomalies; Cloud Run structured logs routable to Cloud Logging ([`logger.ts:L88-L104`](../backend/src/utils/logger.ts)). No Cloud Logging alert policies wired. | Wire Cloud Logging alert policies on `severity=ERROR` + specific breach-shape patterns (e.g., decrypt failure spikes, RLS warning at boot). Tracked in [`RUNBOOK.md`](./RUNBOOK.md). |
| Notification to individuals | §164.404 | ⏳ | TBD (external: policy doc does not exist; SendGrid templates for breach letters unbuilt). | Draft breach-notification SOP. Owner: compliance officer (unassigned). |
| Notification to media (>500 persons) | §164.406 | ⏳ | Not applicable at current scale; N/A until user base >500. | Include placeholder in SOP. |
| Notification to HHS | §164.408 | ⏳ | Not yet wired. HHS OCR portal ([breach.hhs.gov](https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html)) — manual process. | Document filing steps in SOP. |
| Business-associate notification | §164.410 | ⏳ | See BAA row §1 — depends on executed BAAs. | Close BAAs. |
| Law enforcement delay | §164.412 | ⏳ | — | Include in SOP. |
| Administrative requirements (documentation, training) | §164.414 | ⏳ | Not started. | Incorporate into workforce training program (§164.308(a)(5)). |

**Most urgent gap**: no breach-notification SOP exists. Before any live-PHI alpha cohort, stand up a minimal incident-response playbook covering detection → containment → individual notification → HHS reporting timeline (60 days per §164.404(b)).

---

## 6. Required HIPAA documentation — status

| Document | Required by | Status | Location (or TBD) |
|---|---|---|---|
| Risk Analysis | §164.308(a)(1)(ii)(A) | ✅ Draft | [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md) v1.0, 2026-04-25 — 12 enumerated threats, controls assessment, residual-risk matrix, remediation plan ordered by reduction × ease. Awaits owner sign-off + (optional) external HIPAA reviewer. |
| Risk Management Plan | §164.308(a)(1)(ii)(B) | 🟡 | Remediation tracker in [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) (C-1…C-7 closed, C-8 code-complete operator-pending; all Highs and ~33 Mediums closed). Forward-looking remediation in [`RISK_ASSESSMENT.md §6`](./RISK_ASSESSMENT.md#6-remediation-plan). |
| Sanction Policy | §164.308(a)(1)(ii)(C) | ⏳ | TBD (external). |
| Information System Activity Review SOP | §164.308(a)(1)(ii)(D) | ⏳ | TBD. |
| Privacy/Security Officer designation | §164.308(a)(2) | ⏳ | TBD (external: unassigned). |
| Workforce Access Authorization SOP | §164.308(a)(3)(ii)(B) | ⏳ | TBD. |
| Termination Checklist | §164.308(a)(3)(ii)(C) | ⏳ | TBD. |
| Security Awareness Training Plan | §164.308(a)(5) | ⏳ | TBD. |
| Security Incident Response SOP | §164.308(a)(6) | 🟡 | Operational runbook at [`RUNBOOK.md`](./RUNBOOK.md); HIPAA-specific incident response written in [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md) and [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md). Awaits sign-off + Cloud Logging alert wiring. |
| Contingency Plan (backup + DR + emergency mode + testing) | §164.308(a)(7) | ✅ Draft | [`CONTINGENCY_PLAN.md`](./CONTINGENCY_PLAN.md) v1.0, 2026-04-25 — covers all four implementation specs (A: data backup, B: disaster recovery, C: emergency mode, D: testing) and includes a step-by-step quarterly restore-drill runbook. First drill scheduled 2026-07-25. |
| Business Associate Agreements | §164.308(b) / §164.314(a) | 🟡 | Anthropic ✅ 2026-04-16; GCP and SendGrid TBD — see §1. |
| Policies & Procedures (general) | §164.316(a) | ✅ Draft | [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md) v1.0, 2026-04-25 — written policies for access control, encryption, audit, authentication, transmission, integrity, contingency, and breach response. Awaits sign-off. |
| Documentation retention (6 years) | §164.316(b)(2) | 🟡 | `AuditLog` retains 7y ([`auditLog.ts:9`](../backend/src/services/auditLog.ts)). Policy docs (`RISK_ASSESSMENT.md`, `SECURITY_POLICIES.md`, `BREACH_NOTIFICATION_PLAN.md`, `CONTINGENCY_PLAN.md`, `PRIVACY_POLICY_DRAFT.md`, `TERMS_OF_SERVICE_DRAFT.md`) live in version control — git history retains every revision indefinitely. |
| Breach Notification SOP | §164.400–414 | ✅ Draft | [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md) v1.0, 2026-04-25 — detection, individual / HHS / media notification timelines, post-incident review. Awaits Cloud Logging alert policy wiring (detection layer). |
| Notice of Privacy Practices (NPP) | §164.520 | ✅ Draft | [`PRIVACY_POLICY_DRAFT.md`](./PRIVACY_POLICY_DRAFT.md) v0.1, 2026-04-25 — patient rights, uses & disclosures, complaint path. **Pre-publication legal review required.** |
| Terms of Service | Contractual basis | ✅ Draft | [`TERMS_OF_SERVICE_DRAFT.md`](./TERMS_OF_SERVICE_DRAFT.md) v0.1, 2026-04-25 — service description, AI educational disclaimer, data ownership/portability/deletion, acceptable use, liability/indemnification/disputes. **Pre-publication legal review required** (§§ 5, 10–13, 17). |
| User consent (data use, AI processing) | §164.508 + general | 🟡 | Cross-referenced in [`PRIVACY_POLICY_DRAFT.md`](./PRIVACY_POLICY_DRAFT.md) (NPP acknowledgement on signup) and [`TERMS_OF_SERVICE_DRAFT.md §5`](./TERMS_OF_SERVICE_DRAFT.md) (AI educational-only acknowledgement). Provider-access consent is first-class in code — `ProviderPatient.canView*` flags and granular permission grants/revokes audited per [`providerRoutes.ts:220`](../backend/src/routes/providerRoutes.ts). | UI signup-flow consent checkboxes need to bind to the published NPP / ToS URLs (post-publication). |

---

## 7. Minimum necessary + PHI access

Per-field encryption, write-site, read-site, audit coverage, and logger-redaction status for every one of the 36 cataloged PHI fields live in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md#2-master-phi-table). This doc does not duplicate that table.

Key access-scoping principles, with code anchors:

| Principle | Code evidence |
|---|---|
| Patient sees only their own rows | RLS policies (e.g., `users_select_own` at [`migration.sql:L90-L95`](../backend/prisma/migrations/20260107_add_rls_policies/migration.sql)) + application wrappers `withRLSContext(userId, …)` at [`database.ts:456`](../backend/src/services/database.ts). 🟡 see C-8 — runtime DB enforcement pending operator role rotation; app-layer wrappers are the load-bearing control today. |
| Provider sees only consented patients | `has_provider_access(patient_user_id, permission_type)` at [`migration.sql:L39-L62`](../backend/prisma/migrations/20260107_add_rls_policies/migration.sql) + application check `checkProviderPatientAccess` at [`rbac.ts:205`](../backend/src/middleware/rbac.ts). Consent flags: `canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canViewHealthNeeds`, `canEditData`. |
| ADMIN never reads PHI in plaintext via admin UI | `queryLogs` returns ciphertext ([`auditLog.ts:456`](../backend/src/services/auditLog.ts)); admin audit-log viewer does not decrypt `previousValueEncrypted` / `newValueEncrypted`. |
| Logs never carry decrypted PHI | `sanitizeData` at [`logger.ts:46`](../backend/src/utils/logger.ts) — 🟡 drift flagged in [`PHI_TAXONOMY.md §4`](./PHI_TAXONOMY.md#4-logger-redaction-coverage). |
| AI calls are BAA-gated | `ANTHROPIC_BAA_ACTIVE` runtime gate at [`config/index.ts:150`](../backend/src/services/config/index.ts), hard-fail in prod at [`config/index.ts:L245-L258`](../backend/src/services/config/index.ts). |

---

## 8. Roadmap

| Phase | Target | Items | Tracking |
|---|---|---|---|
| **Pre-beta (now)** | Execute C-8 operator cutover; close remaining BAAs; name compliance officer | 1) Provision `omh_app` NOBYPASSRLS role in Cloud SQL + rotate `DATABASE_URL` in Secret Manager (code prerequisites all merged 2026-04-24; the `RLS_ENFORCEMENT=strict` env-var was removed — startup assertion is now unconditional in prod). 2) Confirm GCP BAA in Console; execute SendGrid BAA. 3) Appoint privacy/security officer. | [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) (C-8 row, operator runbook); §1 BAA table; §2 admin safeguards |
| **Pre-beta — documentation** | Move drafts to signed; close remaining ⏳ policies | **Drafted 2026-04-25:** Risk Analysis ([`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md)), Breach Notification SOP ([`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md)), Security Policies ([`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md)), Privacy Notice ([`PRIVACY_POLICY_DRAFT.md`](./PRIVACY_POLICY_DRAFT.md), legal review required), Terms of Service ([`TERMS_OF_SERVICE_DRAFT.md`](./TERMS_OF_SERVICE_DRAFT.md), legal review required), Contingency Plan ([`CONTINGENCY_PLAN.md`](./CONTINGENCY_PLAN.md), incl. restore-drill runbook). **Still ⏳:** Sanction Policy, Workforce Access Authorization SOP, Termination Checklist, Security Awareness Training Plan, Information System Activity Review SOP. **Still pending execution:** first quarterly restore drill (scheduled 2026-07-25). | §6 table |
| **Pre-beta — log redaction drift** | Patch `SENSITIVE_FIELDS` drift | Add `firstnameencrypted`, `lastnameencrypted`, `dateofbirthencrypted`, `phoneencrypted`, `addressencrypted`, `healthprofileencrypted`, `notesencrypted`, `targetvalueencrypted`, expense `*encrypted` keys. | [`PHI_TAXONOMY.md §4 drift table`](./PHI_TAXONOMY.md#drift--phi-fields-not-redacted-by-sensitive_fields) |
| **Beta** | Hardening + MFA | 1) MFA for all users (TOTP + WebAuthn stretch). 2) Wire Cloud Logging alert policies (breach detection). 3) Move in-memory token revocation set to Redis (per [`authService.ts:L130-L137`](../backend/src/services/authService.ts) note) so logout is cluster-wide. 4) Quarterly backup-restore drill. | GitHub milestones TBD |
| **GA / prod** | Formal compliance | 1) Semi-annual third-party HIPAA assessment. 2) Workforce training program + sanction policy activation. 3) DR tabletop exercise annually. 4) Application-level integrity signing (HMAC-over-record) if auditor requests. | TBD (external: auditor engagement) |

---

## 9. Acceptance questions — self-answers

1. **Which vendors have signed BAAs, and when?** Anthropic ✅ 2026-04-16 (§1, gate at [`config/index.ts:150`](../backend/src/services/config/index.ts)). GCP and SendGrid TBD — see §1.
2. **What code evidence satisfies §164.312(a) auto-logoff, and what's the timeout?** 15-minute JWT access-token expiry ([`config/index.ts:62`](../backend/src/services/config/index.ts)); 7-day refresh; 10-minute server-side session cleanup scheduler at [`authService.ts:1227`](../backend/src/services/authService.ts). Expired-token rejection at [`auth.ts:103-L105`](../backend/src/middleware/auth.ts). See §4 row "Automatic logoff".
3. **Where is ePHI encryption implemented and which PHI fields are covered?** AES-256-GCM in [`encryption.ts:263`](../backend/src/services/encryption.ts) / `:288`; per-user PBKDF2-SHA512 600k-iter key derivation; 36 PHI fields across 15 models, fully cross-linked in [`PHI_TAXONOMY.md §2`](./PHI_TAXONOMY.md#2-master-phi-table).
4. **What's the status of §164.312(a)(1) access control and what's the open runtime gap?** 🟡 policy-and-code complete, infra-pending. RLS SQL exists at [`migration.sql:1-L100+`](../backend/prisma/migrations/20260107_add_rls_policies/migration.sql), self-elevation trigger at [`20260424_prevent_self_role_elevation/migration.sql`](../backend/prisma/migrations/20260424_prevent_self_role_elevation/migration.sql), app wrappers at [`database.ts:456`](../backend/src/services/database.ts), multi-tenant integration tests at [`__tests__/integration/rls-isolation.test.ts`](../backend/src/__tests__/integration/rls-isolation.test.ts). Today's DB login still has `BYPASSRLS=true` — see finding **C-8** in [`SECURITY_STATUS.md`](./SECURITY_STATUS.md). Startup assertion at [`database.ts:200-265`](../backend/src/services/database.ts) hard-exits in prod the moment the role rotates and is ever rolled back; the `RLS_ENFORCEMENT=strict` env-var opt-out was removed 2026-04-24.
5. **Which scheduler enforces 7-year audit retention, and where in code?** Daily interval at [`auditLog.ts:534`](../backend/src/services/auditLog.ts) (`setInterval(… , 24 * 60 * 60 * 1000)`) invoking `cleanupOldLogs` at [`auditLog.ts:475`](../backend/src/services/auditLog.ts), which deletes rows older than `RETENTION_DAYS = 2555` ([`auditLog.ts:9`](../backend/src/services/auditLog.ts)).
6. **Which HIPAA standards are ✅ shipped vs 🟡 partial vs ⏳ pending?** Technical Safeguards §164.312: 6 ✅ (unique ID, auto-logoff, encryption at rest, audit controls, person/entity auth, transmission security), 3 🟡 (integrity AEAD-only, minimum necessary with drift, access control — C-8 code-complete pending operator role cutover). Administrative & Physical: mostly 🟡/⏳ — see §2, §3. Breach Notification: mostly ⏳ — see §5.
7. **Is the Anthropic BAA active, and how does the code gate on it?** Yes, signed 2026-04-16. Gate is `ANTHROPIC_BAA_ACTIVE === 'true'` at [`config/index.ts:150`](../backend/src/services/config/index.ts); production refuses to boot with API key set but BAA flag unset ([`config/index.ts:L245-L258`](../backend/src/services/config/index.ts)); runtime callers `claudeExtraction` / `sbcExtraction` re-check before each outbound request.
8. **What breach-notification gap is most urgent to close?** No breach-notification SOP exists — see §5. Wire Cloud Logging alert policies (detection) + draft individual + HHS notification SOP before live-PHI alpha cohort.
9. **Where would a reader find the per-field PHI encryption matrix?** [`PHI_TAXONOMY.md §2 Master PHI table`](./PHI_TAXONOMY.md#2-master-phi-table) — model × field × write sites × read sites × audit-on-write × audit-on-read × logger redaction × provider accessibility.
10. **What's the RLS runtime gap (C-8) and where is the remediation plan tracked?** App runs as a `BYPASSRLS` DB role in dev and prod today, so RLS policies don't enforce at the database layer. Code-side remediation is complete — see the [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) C-8 row for the merged code prerequisites and operator runbook. Cutover: create NOBYPASSRLS `omh_app` role in Cloud SQL, rotate `DATABASE_URL` in Secret Manager, deploy. The startup assertion at [`database.ts:200-265`](../backend/src/services/database.ts) is unconditional in prod (no env-var opt-out), so any rollback to a BYPASSRLS role will hard-exit on boot.
11. **How does password hashing satisfy §164.312(d)?** bcrypt at cost factor 13 (HIPAA-grade for 2024+) — `bcrypt.hash(password, config.security.bcryptRounds)` at [`authService.ts:158`](../backend/src/services/authService.ts); rounds configured at [`config/index.ts:93`](../backend/src/services/config/index.ts). Password complexity enforced at [`authService.ts:171`](../backend/src/services/authService.ts) (12-char minimum + upper/lower/digit/special). Lockout after 5 failed attempts for 30 min at [`authService.ts:L506-L538`](../backend/src/services/authService.ts). Timing-safe login path (bcrypt dummy compare when user missing) at [`authService.ts:L739-L755`](../backend/src/services/authService.ts).
12. **Is transmission security (TLS) enforced at the load balancer, and what cites this?** Yes — Cloud Run terminates TLS 1.2+ at the edge; production URL `https://api.ownmyhealth.io` configured in [`.github/workflows/deploy.yml:160`](../.github/workflows/deploy.yml). `app.set('trust proxy', 1)` at [`app.ts:119`](../backend/src/app.ts) honors the proxy's `X-Forwarded-For`. Cookies set `secure: true` in prod at [`config/index.ts:75`](../backend/src/services/config/index.ts). DB-leg uses Cloud SQL Auth Proxy (TLS 1.3). HSTS via `helmet()` defaults at [`app.ts:124`](../backend/src/app.ts).

---

## Related Documents

- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — live findings log (C-1…C-8, F-series). Source of truth for open gaps mapped into §4 and §8 here.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — per-field encryption, audit, redaction, and provider-access matrix for every PHI field.
- [DATA_MODEL.md](./DATA_MODEL.md) — full ER, RLS policies, cascade behavior, column-level PHI markings.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system-level view of encryption, audit, auth layers.
- [ENV_VARS.md](./ENV_VARS.md) — `ANTHROPIC_BAA_ACTIVE`, `PHI_ENCRYPTION_KEY`, `AUDIT_LOG_SALT`, `RLS_ENFORCEMENT`, JWT secrets.
- [RUNBOOK.md](./RUNBOOK.md) — operational incident playbook (input for the breach-notification SOP).
- [RISK_ASSESSMENT.md](./RISK_ASSESSMENT.md) — §164.308(a)(1)(ii)(A) Risk Analysis (draft 2026-04-25).
- [SECURITY_POLICIES.md](./SECURITY_POLICIES.md) — §164.316 written policies and procedures (draft 2026-04-25).
- [BREACH_NOTIFICATION_PLAN.md](./BREACH_NOTIFICATION_PLAN.md) — §164.400-414 breach response playbook (draft 2026-04-25).
- [CONTINGENCY_PLAN.md](./CONTINGENCY_PLAN.md) — §164.308(a)(7) backup, DR, emergency mode, testing & restore-drill runbook (draft 2026-04-25).
- [PRIVACY_POLICY_DRAFT.md](./PRIVACY_POLICY_DRAFT.md) — §164.520 Notice of Privacy Practices (draft, pre-legal-review).
- [TERMS_OF_SERVICE_DRAFT.md](./TERMS_OF_SERVICE_DRAFT.md) — Terms of Service (draft, pre-legal-review).

---

## Prompt drift log

- `22-hipaa-checklist-doc.md` BAA table example shows `Anthropic | AI API | ✅ Signed | 2026-04-16`. Confirmed in code (gate at [`config/index.ts:150`](../backend/src/services/config/index.ts)) and in project memory — no drift.
- `22-hipaa-checklist-doc.md` Technical-safeguards example row for Auto-logoff references `config/index.ts:Lxx (JWT expiry), authService.ts:Lyy (session cleanup)`. Real lines resolved to [`config/index.ts:62`](../backend/src/services/config/index.ts) (`accessExpiresIn`) and [`authService.ts:1227`](../backend/src/services/authService.ts) (`startSessionCleanup`) — matches expectation.
- `22-hipaa-checklist-doc.md` BAA-status prompt mentions memory note "Anthropic BAA 2026-04-16"; resolved.
- Prompt expects a `DEPLOY.md` cross-link implicitly (via `railway.toml` reading). `railway.toml` at repo root ([`railway.toml`](../railway.toml)) is for the **frontend** dev-preview deploy (Railway) only; the load-bearing backend deploy path is `.github/workflows/deploy.yml` → Cloud Run. Cited both; TLS posture is on Cloud Run, not Railway. Flagging so prompt author can narrow "TLS posture" guidance to `deploy.yml` in a future refresh.
- Prompt's "Required sections" includes a separate `6. Breach Notification` and `7. Required documentation` item while "Required artifacts" nests them differently. Followed "Required sections" order: BAAs → Admin → Physical → Technical → Breach → Docs → Min-necessary → Roadmap → Related → Drift.
- `_doc-quality.md` banned cross-linking to nonexistent docs. `SECURITY_STATUS.md` and `DATA_MODEL.md` exist (confirmed via directory listing of `New Project Documents/`); `ARCHITECTURE.md`, `ENV_VARS.md`, `RUNBOOK.md` also exist. No stub cross-links needed.
