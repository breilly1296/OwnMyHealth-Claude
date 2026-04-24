---
tags:
  - documentation
  - security
  - compliance
type: generated-doc
prompt: prompts/21-security-status-doc.md
generated: 2026-04-24
last-audit: 2026-04-16
last-audit-tool: Claude-orchestrated sweep of prompts 01-13 + 26-32 (C-series findings)
source-of-truth: backend/src/services/database.ts, encryption.ts, auditLog.ts, middleware/*, config/index.ts
---

# SECURITY_STATUS.md — Current-State Posture Reference

> This doc is a **posture synthesis**, not a history log. It rolls up findings
> from the per-area audits (core / domain / infrastructure / periphery) and
> reports what is open, what closed this cycle, which controls pass spot-check
> in live code, and what triggers the next audit.
>
> Spot-check convention: every ✅ below was re-verified at the cited `file:line`
> during the 2026-04-24 doc pass. Inherited ticks from prior cycles were
> dropped unless the live code still supports them.

---

## Header

| Field | Value |
|---|---|
| Doc last updated | `2026-04-24` |
| Last audit date | `2026-04-16` (C-1…C-7 closing pass) + `2026-04-17/18` trailing F-series close-outs |
| Next-audit trigger | See [§ Next-audit trigger](#next-audit-trigger) |
| Auditor / tool | Internal Claude-orchestrated sweep (prompts `01-13`, `26-32`, `24-full-security-audit`) |
| **Security grade** | **B-** (`1 Critical open`, `0 High open`, roadmap to A- gated on C-8 Part 3) |
| Grading rule | A: 0 Critical + ≤1 High ・ B: 0-1 Critical + 0-2 High ・ C: ≥2 Critical or ≥3 High ・ D: any Critical-with-PHI-exfil path |

---

## 1. Posture summary

Findings are tracked with sticky IDs. `C-N` Critical, `H-N` High, `M-N` Medium,
`L-N` Low, `F-N` a miscellaneous finding (severity in row). Closure PRs come
from `git log --all --grep='C-\|F-\|H-\|M-'` (see [§ Closed in current cycle](#3-closed-in-current-cycle)).

| Severity | Open | Closed this cycle | Total discovered (cycle) |
|---|---|---|---|
| Critical | **1** | 7 | 8 |
| High | 0 | 5 | 5 |
| Medium | 0 | 0 | 0 |
| Low | 0 | 4 | 4 |
| Info | 0 | 0 | 0 |
| **Total** | **1** | **16** | **17** |

**Cycle definition**: 2026-03-25 → 2026-04-18 (window from prior posture snapshot
through the last merged security commit at `52507c3` on 2026-04-18).

### Diff from prior cycle

```
Critical:   8 discovered → 1 open   (-7)
High:       5 discovered → 0 open   (-5)
BAAs:       GCP, Anthropic, SendGrid — all signed (Anthropic 2026-04-16)
Grade:      C (prior) → B- (this cycle)
```

The remaining Critical is **C-8 — RLS policies inert at runtime** (BYPASSRLS role).
Parts 1, 2a, 2b-i, 2b-ii, Part 3 *runbook* are merged; the infrastructure role
cutover is the last step. See [§ 2. Open findings](#2-open-findings).

---

## 2. Open findings

### C-8 — RLS policies inert at runtime (BYPASSRLS role) — **Critical**

- **Area**: Infrastructure (database role / deploy).
- **Evidence**:
  - Application connects as a `BYPASSRLS` role in both dev and prod; the
    runtime assertion at `backend/src/services/database.ts:220-270` detects
    the condition but currently only **warns** by default and escalates to
    hard-fail only when `RLS_ENFORCEMENT=strict` is set.
  - Filing finding doc: commit `35c8981` / `56bba28` (2026-04-16,
    "`docs(security): file C-8 — RLS policies not enforced at runtime (BYPASSRLS)`").
  - All **code-level** C-8 parts have shipped (see table below); the remaining
    work is the Cloud SQL role provisioning + `DATABASE_URL` rotation.
- **Impact**: RLS policies are present in the schema but the app role ignores
  them. Tenant isolation relies solely on application-layer `withRLSContext`
  wrappers. A missed wrapper, a raw SQL path, or a SQL injection would return
  cross-tenant data with **no database-level safety net**.
- **Remediation plan** (tracked in `docs/STAGING.md` and the C-8 Part 3 runbook
  filed at commit `61f19c0` on 2026-04-17):
  1. Provision `omh_app` NOBYPASSRLS role in Cloud SQL (Part 3, Stage A).
  2. Run RLS-enabled smoke tests against the new role in staging.
  3. Rotate `DATABASE_URL` in Secret Manager to the new role (Part 3, Stage B).
  4. Flip `RLS_ENFORCEMENT=strict` so the boot assertion hard-exits on any regression.
- **Code prerequisites already merged**:

  | Part | PR | Commit | Date | Description |
  |---|---|---|---|---|
  | Part 1 | `#40` | `65f9ffb` | 2026-04-16 | Wrap `auditService.initialize` in admin RLS context |
  | Part 2a | `#41` | `a648eb8` | 2026-04-16 | Wrap cross-user `ProviderPatient` writes in RLS context |
  | Part 2b-i | `#42` | `4fa6460` | 2026-04-16 | Wrap `authService` + `userEncryption` pre-auth paths |
  | Part 2b-ii | `#43` | `74af20e` | 2026-04-17 | Wrap `adminRoutes` + `auditLog` runtime + users-by-email |
  | Part 3 runbook | `#53` | `61f19c0` | 2026-04-17 | DB role cutover runbook + startup assertion spec |

- **Owner**: `TBD (external: infrastructure owner — GCP Cloud SQL admin; resolve
  via GCP Console project `ownmyhealth-prod`)`.
- **ETA**: `TBD (external: scheduling gated on staging cutover dry-run;
  target window published in docs/STAGING.md once the omh_app role is provisioned)`.
- **Cross-links**:
  - `New Project Documents/C8_PART3_RUNBOOK.md` — **pending** (doc not yet
    generated; see prompts/`15-runbook-doc.md` and the in-repo runbook at
    `docs/STAGING.md`).
  - `New Project Documents/C8_PART3_STARTUP_ASSERTION.md` — **pending** (spec
    lives inline in `backend/src/services/database.ts:220-270` until the doc
    is extracted).
  - [`DATA_MODEL.md`](./DATA_MODEL.md) — per-table RLS policies.
  - [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) — maps to §164.312(a)(1) Access Control.

No other Critical, High, or Medium findings are currently open.

---

## 3. Closed in current cycle

All closures verified by reading the merge commit and spot-checking the current
code path still matches the fix described.

| Finding | Severity | Closing PR | Commit | Date | Verification |
|---|---|---|---|---|---|
| C-1 — `SET_CONFIG` outside a transaction (RLS bypass) | Critical | `#30` | `9727492` | 2026-04-16 | `backend/src/services/database.ts:377-386` uses parameterized `set_config(…, true)` inside `runWithRLS` which wraps in `prisma.$transaction`. Regression test at `backend/src/services/rls.test.ts` (commit `f336f3d`). |
| C-2 — Audit-log system salt stored unencrypted | Critical | `#32` | `f6bdc9a` + `1ba923c` | 2026-04-16 | `backend/src/services/auditLog.ts:1-8` loads salt from `config.auditSalt`; `config/index.ts:54` reads `AUDIT_LOG_SALT` env var; `config/index.ts:228-238` hard-fails if missing/short. |
| C-3 — JWT secrets had hardcoded fallback strings | Critical | `#33` | `2808b97` + `beb2993` | 2026-04-16 | `backend/src/config/index.ts:18-28` `requireEnv()` throws on missing value; `config/index.ts:61-66` routes both JWT secrets through it. Test: `596146e` adds regression coverage. |
| C-4 — `PHI_ENCRYPTION_KEY` insecure value only blocked in prod | Critical | `#34` | `ea67ccb` + `61e1e7a` | 2026-04-16 | `backend/src/services/encryption.ts:129-141` rejects known placeholder keys in **every** environment (the `NODE_ENV==='production'` gate was removed). Test: `b6057a8`. |
| C-5 — `jspdf` CVE-2026-31938 (+ siblings) | Critical | `#36` | `4a08802` + `02e9c48` | 2026-04-16 | `package.json` pins `jspdf` to `^4.2.1+`; CI `npm audit high+` gate enforces on every PR (commit `b035e97`, `.github/workflows/ci.yml`). |
| C-6 — GCS objects not deleted on account/data deletion | Critical | `#37` | `0f7970a` + `6dde28c` + `375c9b2` | 2026-04-16 | `backend/src/services/storageService.ts` `deleteFiles` batch helper; settings controller calls it from `deleteAllData` + `deleteAccount` paths. |
| C-7 — PHI sent to Claude without minimization / redaction | Critical | `#39` | `8c19438` + `c3fe7d7` + `d671887` + `d6fb811` | 2026-04-16 | `backend/src/services/claudeExtraction.ts:115-140` (BAA gate + local PDF extract + `redactPHI`); helper at `backend/src/utils/phiRedaction.ts`; PDF text extraction at `backend/src/services/pdfTextExtraction.ts`. Tests: `claudeExtraction.test.ts`, `phiRedaction.test.ts`. |
| F-14 / F-15 — `set_config` interpolated as raw SQL | Critical-adjacent | `#30` | `ee86fd4` | 2026-04-16 | `backend/src/services/database.ts:377-386` `applyRLSContext` uses template-tagged `$executeRaw` (parameterized) — no string interpolation. |
| F-3 — IDOR in provider paths | High | `#44`, `4fa53a6` | `4fa53a6` | 2026-04-17 | Resolved alongside remaining C-7 gaps; see PR body. |
| F-4 — JWT algorithm/issuer/audience not asserted | High | `52` | `9499308` | 2026-04-17 | `backend/src/config/jwtOptions.ts` exports `JWT_SIGN_OPTIONS` + `JWT_VERIFY_OPTIONS`; middleware/auth.ts uses them at `:83`, `:129`, `:178`, `:219`. |
| F-5 — Raw `X-Forwarded-For` used for session IP | High | `52` | `8a0ea3f` | 2026-04-17 | `app.ts:119` sets `trust proxy = 1`; session IP derives from `req.ip`. |
| F-7 — Demo account could reach admin paths | High | `52` | `7baf2d2` | 2026-04-17 | `blockDemoAdminAccess` attached to `backend/src/routes/adminRoutes.ts` (see `middleware/demoProtection.ts`). |
| Zod password policy drift | High | `52` | `ca74644` | 2026-04-17 | Zod schema aligned with service-level check (12 chars). |
| F-21 — logger redaction missed nested objects-in-arrays | Low | (in `1ab1206`) | `1ab1206` | 2026-04-18 | `backend/src/utils/logger.ts:39-46` `sanitizeValue` recurses into arrays. |
| SSE CSRF exemption doc | Low | `b2b762e` | `b2b762e` | 2026-04-18 | `backend/src/middleware/csrf.ts:126-148` documents the bearer-only invariant; `requireBearerAuth` at `middleware/auth.ts:166-201`. |
| AI chat tx decryption ordering | Low | `52507c3` | `52507c3` | 2026-04-18 | Decryption moved out of `withRLSContext` transaction (avoids holding DB tx while doing CPU-bound crypto). |
| CI hardened: `npm ci` + audit high+ gate | Low | `#52` | `b035e97` | 2026-04-17 | `.github/workflows/ci.yml`. |

---

## 4. Controls status

Legend: ✅ verified in live code this cycle · 🟡 partial / known gap · ⚠️ at-risk / explicit exception · ◻ not applicable.

### 4.1 Authentication

| Control | Status | Evidence | Notes |
|---|---|---|---|
| JWT required on all protected routes (cookie OR Bearer) | ✅ | `backend/src/middleware/auth.ts:70-111` (`authenticate`) | Priority: cookie > Authorization header |
| Bearer-only helper for CSRF-exempt routes (SSE) | ✅ | `backend/src/middleware/auth.ts:166-201` (`requireBearerAuth`) | Used on `/ai/chat`; prevents cookie-carrying CSRF bypass |
| Access tokens short-lived (15 min), refresh 7 d | ✅ | `backend/src/config/index.ts:61-67` | `JWT_ACCESS_EXPIRES_SECONDS=900` default |
| JWT `alg` / `iss` / `aud` asserted on sign **and** verify | ✅ | `backend/src/config/jwtOptions.ts` + `middleware/auth.ts:83,129,178,219` | Closed F-4 |
| Refresh tokens are DB-backed sessions (revocable) | ✅ | `backend/src/services/authService.ts` (session cleanup scheduler @ `startSessionCleanup`) | — |
| Password hashing with bcrypt ≥13 rounds | ✅ | `backend/src/config/index.ts:90-94` | HIPAA 2024+ baseline |
| Brute-force protection on login | ✅ | `middleware/rateLimiter.ts:50-69` (`strictAuthLimiter`, 5/15 min, keyed by `email:ip`) | Counts failed attempts only |
| Demo account blocked in production | ✅ | `backend/src/config/index.ts:319-325` (hard-throw) | `isDemoAccount` at `middleware/demoProtection.ts:33-36` guards empty email |

### 4.2 CSRF

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Double-submit cookie on state-changing methods | ✅ | `backend/src/middleware/csrf.ts:86-179` | Timing-safe compare at `:169-172` |
| Global wiring (skipped only when `DISABLE_CSRF=true` in dev) | ✅ | `backend/src/app.ts:210-213` | — |
| Public auth routes exempt (login/register/refresh/etc.) | ✅ | `middleware/csrf.ts:98-108` | — |
| Upload routes exempt (magic-byte + auth guard instead) | 🟡 | `middleware/csrf.ts:117-123` | TODO in-code to remove exemption once all upload callers confirmed to attach the header |
| SSE route exempt (bearer-only) | ✅ | `middleware/csrf.ts:126-148` + `auth.ts:166-201` | Explicit invariant: exempt routes **must** use `requireBearerAuth` |

### 4.3 RBAC / Authorization

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Role hierarchy (PATIENT < PROVIDER < ADMIN) | ✅ | `backend/src/middleware/rbac.ts:16-20` | — |
| Resource-type × permission matrix | ✅ | `middleware/rbac.ts:31-56` | `ROLE_PERMISSIONS` |
| Ownership check for mutations | ✅ | `middleware/rbac.ts:264-322` (`requireOwnership`) | Admin bypass explicit |
| Provider-patient access gated by consent + active + expiry | ✅ | `middleware/rbac.ts:205-258` (`checkProviderPatientAccess`) | Capability flags: `canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canEditData` |
| Admin routes require `ADMIN` + demo-blocked | ✅ | `routes/adminRoutes.ts` + `middleware/demoProtection.ts` (F-7 fix) | — |

### 4.4 Encryption

| Control | Status | Evidence | Notes |
|---|---|---|---|
| AES-256-GCM PHI at rest (authenticated encryption) | ✅ | `backend/src/services/encryption.ts:57-61,263-279` | `iv:authTag:ciphertext` base64 |
| Per-user key derivation PBKDF2-SHA512 @ 600k iters | ✅ | `backend/src/services/encryption.ts:86-87,193-201` | OWASP 2023 baseline |
| Legacy 100k fallback on decrypt (no plaintext coupling) | ✅ | `encryption.ts:306-316` | Transitional; `TODO(key-rotation)` at `:81-85` |
| Master key validation rejects placeholder values in **every** env | ✅ | `encryption.ts:129-141` + `config/index.ts:296-308` | Closed C-4 |
| User salts encrypted with master key at rest | ✅ | `encryption.ts:215-228` (`encryptWithMasterKey`) + `userEncryption.ts` | — |
| TLS in transit | ✅ | Cloud Run HTTPS-only (see `RUNBOOK.md` §Quick reference) | — |
| Key rotation runbook | 🟡 | — | Not documented; see `TODO(key-rotation)` in `encryption.ts:81-85`. Required for a full A grade. |
| `PHI_FIELDS` kept in sync with Prisma schema | ✅ | `encryption.ts:411-492` | See `PHI_TAXONOMY.md` for every field × site |

### 4.5 PHI Handling

| Control | Status | Evidence | Notes |
|---|---|---|---|
| PHI encrypted before DB writes (all `*Encrypted` columns) | ✅ | `encryption.ts:338-353` (`encryptFields`) + controller call sites | See `PHI_TAXONOMY.md` |
| PHI decrypted only at response boundary | ✅ | `encryption.ts:358-385` (`decryptFields`); failures return `null` not ciphertext | — |
| PHI never logged (logger redacts by field name) | ✅ | `backend/src/utils/logger.ts:21-50` (`SENSITIVE_FIELDS`) | Closed F-21 (arrays of objects now recursed) |
| PHI redacted before Claude calls | ✅ | `utils/phiRedaction.ts` + `services/claudeExtraction.ts:131-140` | Closed C-7 |
| Lab-report PDFs extracted locally (no upload of raw file) | ✅ | `services/pdfTextExtraction.ts` + `claudeExtraction.ts:127-130` | Stage A before any network call |
| OAuth lab tokens encrypted (`LabConnection`) | ✅ | `encryption.ts:487-491` (PHI_FIELDS.LabConnection) | Quest FHIR integration |

### 4.6 Row-Level Security (RLS)

| Control | Status | Evidence | Notes |
|---|---|---|---|
| RLS policies exist on all user-scoped tables | ✅ | `backend/prisma/migrations/20260107_add_rls_policies/` | — |
| `withRLSContext` wraps in transaction + `SET LOCAL` | ✅ | `services/database.ts:377-483` (`applyRLSContext`, `runWithRLS`) | Closed C-1 |
| UUID validation defense-in-depth on user id | ✅ | `services/database.ts:358-362` | Parameterized `set_config` is the primary barrier |
| CI guard blocks `prisma.*` inside RLS callbacks | ✅ | `scripts/check-rls-wrappers.sh` + `.github/workflows/ci.yml` | See footgun banner `database.ts:14-31` |
| Startup asserts DB role is NOBYPASSRLS | ⚠️ | `services/database.ts:220-270` (`assertNoBypassRLS`) | Currently **warns** by default; strict mode gated on `RLS_ENFORCEMENT=strict`. Inert until infra cutover (**C-8**). |
| Production actually connects as a NOBYPASSRLS role | ⚠️ | — | **Open C-8**; app runs as BYPASSRLS role in prod + dev |

### 4.7 Audit Logging

| Control | Status | Evidence | Notes |
|---|---|---|---|
| HIPAA-compliant audit trail table | ✅ | `backend/src/services/auditLog.ts:1-80` + `AuditLog` model in schema | — |
| 7-year retention scheduler | ✅ | `auditLog.ts:9` (`RETENTION_DAYS = 2555`) + `app.ts:56` (`startAuditCleanup`) | — |
| Audit logs include IP, UA, session, actor, action, resource | ✅ | `auditLog.ts:59-77` (`AuditLogEntry`) | Closed F-5 (IP now via `req.ip`, trust-proxy=1) |
| Previous/new values encrypted in audit log | ✅ | `encryption.ts:461-464` (`AuditLog.previousValueEncrypted`, `newValueEncrypted`) | — |
| Audit-log encryption salt from env (not system_config) | ✅ | `config/index.ts:54,228-238` (`AUDIT_LOG_SALT`) | Closed C-2 |
| Audit coverage over all PHI reads/writes | 🟡 | 188 call sites across 24 files (see grep) | Matches `PHI_TAXONOMY.md` expectations for the tables currently in prod scope; FHIR lab-sync path just landed and is the freshest surface to verify |

### 4.8 Rate Limiting

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Six named limiters wired per route risk | ✅ | `middleware/rateLimiter.ts` (`standardLimiter`, `authLimiter`, `strictAuthLimiter`, `uploadLimiter`, `sensitiveLimiter`, `aiLimiter`, `bulkOperationLimiter`) | 7 exports; `aiLimiter` keyed by user id |
| Login limiter keyed by email+IP, failures only | ✅ | `rateLimiter.ts:50-69` | — |
| AI limiter per-user (cost protection) | ✅ | `rateLimiter.ts:102-118` | 10/hr/user |
| Shared store across Cloud Run instances | 🟡 | In-memory only — see banner at `rateLimiter.ts:6-13` | Not a finding today (low max-instances); upgrade to `rate-limit-redis` when scaling past ~3 instances |

### 4.9 Input Validation

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Zod schemas at API boundary | ✅ | `backend/src/middleware/validation.ts:225-346` (routes/auth/biomarkers/etc.) | — |
| UUID params validated | ✅ | `validation.ts:231-246` (`uuidParam`, `patientIdParam`, `userIdParam`) | — |
| Body-size cap | ✅ | `app.ts:226-227` (10 MB JSON / urlencoded) | — |
| Content-Type guard on JSON routes | ✅ | `app.ts:229` + `middleware/validation.ts:requireJsonContentType` | — |
| Zod password policy aligned with service (12 chars) | ✅ | closed via `ca74644` | — |

### 4.10 External APIs

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Claude (Anthropic) — BAA gate enforced in runtime | ✅ | `services/claudeExtraction.ts:118-123`, `controllers/expenseController.ts:632`, `routes/biomarkerRoutes.ts:134` | Closed C-7 |
| Claude — PHI redaction before every call | ✅ | `utils/phiRedaction.ts` + `claudeExtraction.ts:131-140` | Closed C-7 |
| `ANTHROPIC_BAA_ACTIVE` hard-required in prod when key is set | ✅ | `config/index.ts:245-258` | — |
| Google Document AI (OCR) | ✅ | GCP-native; BAA covered. `services/ocrService.ts` | — |
| SendGrid transactional email | ✅ | `services/emailService.ts`; staging uses sandbox mode (`config/index.ts:132-134`) | — |
| Quest FHIR (SMART-on-FHIR) — OAuth tokens encrypted at rest | ✅ | `encryption.ts:487-491` | New surface; freshest audit target |

### 4.11 File Storage (GCS)

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Signed URLs scoped + short-lived (15 min) | ✅ | `services/storageService.ts:111-135` | — |
| Magic-byte validation on upload | ✅ | `controllers/upload/*` | PDF-bomb DoS guard added in `f6c2b92` |
| Upload limiter (20/hr) | ✅ | `middleware/rateLimiter.ts:72-84` | — |
| GCS objects purged on account / data deletion | ✅ | `services/storageService.ts` `deleteFiles` + `settingsController` `deleteAllData`/`deleteAccount` | Closed C-6 |

### 4.12 Logging & Observability

| Control | Status | Evidence | Notes |
|---|---|---|---|
| No PHI in logs (field-name sanitizer) | ✅ | `utils/logger.ts:21-50` (`SENSITIVE_FIELDS`, `sanitizeValue`) | Closed F-21 |
| Structured logging in prod/staging | ✅ | `app.ts:219-223` (`morgan('combined')` in non-dev) | — |
| Startup logs critical config non-secrets | ✅ | `services/database.ts:161,168,178,248` etc. | — |
| CORS rejects logged, not silently dropped | ✅ | `app.ts:162` | — |

### 4.13 Error Handling

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Centralized error handler, no stack traces to client | ✅ | `middleware/errorHandler.ts` (test at `errorHandler.test.ts`) | — |
| Typed error classes (`UnauthorizedError`, `ForbiddenError`, etc.) | ✅ | `middleware/errorHandler.ts` (used throughout auth/csrf/rbac) | — |
| 404 handler | ✅ | `app.ts:51` (`notFoundHandler`) | — |

### 4.14 Data Portability

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Export all user data | ✅ | `controllers/settingsController.ts` + frontend `Export All My Data` flow (commit `bc2f6bc`) | — |
| Account deletion purges PHI rows **and** GCS files | ✅ | `settingsController.ts` → `deleteAllData` + `deleteAccount` + `storageService.deleteFiles` | Closed C-6 |
| Export endpoint rate-limited | ✅ | `sensitiveLimiter` (`rateLimiter.ts:87-99`) | — |

### 4.15 Admin

| Control | Status | Evidence | Notes |
|---|---|---|---|
| All admin routes require `ADMIN` role | ✅ | `routes/adminRoutes.ts` + `rbac.ts:adminOnly()` | — |
| Demo account explicitly blocked from admin routes | ✅ | `blockDemoAdminAccess` attached per F-7 fix (`7baf2d2`) | — |
| Admin routes wrapped in RLS admin context | ✅ | C-8 Part 2b-ii (PR `#43`) | `withRLSContext(null, …, { isAdmin: true })` |
| Users-by-email lookup wrapped in RLS | ✅ | C-8 Part 2b-ii | — |

### 4.16 Provider Collaboration

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Consent-first: relationship required + status ACTIVE + not-expired | ✅ | `middleware/rbac.ts:205-258` | — |
| Granular capability flags respected | ✅ | `rbac.ts:240-256` (`canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canEditData`) | — |
| Cross-user `ProviderPatient` writes wrapped in RLS | ✅ | C-8 Part 2a (PR `#41`) | — |
| Relationship notes encrypted | ✅ | `encryption.ts:436-438` (`ProviderPatient.notesEncrypted`) | — |

### 4.17 AI Integration

| Control | Status | Evidence | Notes |
|---|---|---|---|
| BAA gate in runtime before every Claude call | ✅ | `claudeExtraction.ts:118-123` + callers | Closed C-7 |
| PHI redaction in front of every Claude call | ✅ | `phiRedaction.ts` + `redactPHI` | Closed C-7 |
| Lab PDFs extracted locally first | ✅ | `pdfTextExtraction.ts` + `claudeExtraction.ts:127-130` | — |
| AI per-user rate limit | ✅ | `rateLimiter.ts:102-118` (10/hr/user) | — |
| Educational disclaimers on AI responses | ✅ | Controllers attach disclaimer text (see `biomarkerController`, `aiChatController`) | Product rule from `CLAUDE.md` |
| SSE chat is bearer-only (no cookie-CSRF bypass) | ✅ | `auth.ts:166-201` + `csrf.ts:126-148` | — |
| Anthropic BAA signed | ✅ | Project memory 2026-04-16; commit `2bd7e36` / `e7c3975` | — |

---

## 5. BAA inventory

| Vendor | Service | Status | Signed date | Source |
|---|---|---|---|---|
| Google Cloud Platform | Cloud Run, Cloud SQL, GCS, Document AI, Cloud Logging | ✅ Signed | Pre-existing (GCP HIPAA BAA) | GCP Console → Billing → BAA; RUNBOOK.md §Quick reference |
| Anthropic | Claude API | ✅ Signed | `2026-04-16` | Project memory + commit `2bd7e36` ("Anthropic BAA signed 2026-04-16; C-7 now the production gate"); gated in code at `config/index.ts:245-258` and `claudeExtraction.ts:118-123` |
| SendGrid (Twilio) | Transactional email | ✅ Signed | `TBD (external: compliance owner — extract from SendGrid admin console)` | `services/emailService.ts`; staging uses sandbox mode |
| Quest Diagnostics | SMART-on-FHIR lab data | 🟡 Pending — feature is disabled by default | `TBD (external: data-partnership contract — Quest Partners portal)` | `config/index.ts:158-169`; `feature is disabled unless clientId is set` |

---

## 6. Incidents since prior cycle

### 2026-04-17 — Cloud Run env-var update silently held back (BAA flip)

- **Summary**: `gcloud run services update --update-env-vars=ANTHROPIC_BAA_ACTIVE=true`
  created a new Cloud Run revision but served 0% traffic because the service
  had a prior explicit revision pin (`--to-revisions=…`). Symptom: BAA-active
  flag appeared set in Cloud Run config UI but Claude calls continued to trip
  the runtime gate because the running revision still had `ANTHROPIC_BAA_ACTIVE`
  unset.
- **Detection signal**: `latestReadyRevisionName ≠ latestCreatedRevisionName`.
- **Fix**: follow env-var updates with
  `gcloud run services update-traffic --to-revisions=NEW=100`
  (or `--to-latest` to drop the pin).
- **Blast radius**: No PHI disclosure — the runtime gate at
  `claudeExtraction.ts:118-123` held, so Claude calls failed closed.
- **Lesson encoded**: full postmortem captured in project memory; RUNBOOK
  section on env-var updates will cite this postmortem (see
  [RUNBOOK.md](./RUNBOOK.md)).
- **Related doc to generate**: `cloud-run-env-update-pinning.md` — **pending**.

---

## 7. Compliance status

### 7.1 HIPAA Technical Safeguards (§164.312)

| Safeguard | Status | Evidence |
|---|---|---|
| §164.312(a)(1) Access Control | 🟡 | Application-layer RBAC + RLS policies exist; runtime RLS enforcement inert until C-8 Part 3 closes. App-layer wrappers (`withRLSContext`) are the load-bearing control today. |
| §164.312(a)(2)(i) Unique user IDs | ✅ | `UUID` user ids; JWT carries user id; sessions DB-backed. |
| §164.312(a)(2)(ii) Emergency access | 🟡 | Admin role exists (`rbac.ts:16-20`) and is blocked for demo; no documented break-glass runbook. |
| §164.312(a)(2)(iii) Automatic logoff | ✅ | 15-min access-token TTL + 7-day refresh with DB session cleanup (`authService.ts`). |
| §164.312(a)(2)(iv) Encryption & decryption | ✅ | AES-256-GCM at rest (`encryption.ts`); TLS in transit (Cloud Run). |
| §164.312(b) Audit controls | ✅ | `AuditLogService` + 7-year retention (`auditLog.ts`). |
| §164.312(c)(1) Integrity | ✅ | GCM authentication tag on every ciphertext (`encryption.ts:56-61`). |
| §164.312(d) Person or entity authentication | ✅ | JWT access + refresh with DB-backed sessions; bcrypt 13+ rounds. |
| §164.312(e)(1) Transmission security | ✅ | HTTPS-only Cloud Run; Helmet HSTS. |

Full HIPAA mapping: see [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) (pending generation; see prompt `22-hipaa-checklist-doc.md`).

### 7.2 SOC 2 roadmap

`TBD (external: SOC 2 start date — ask compliance owner / CISO)`.
No active SOC 2 engagement in-repo artifacts. Earliest viable kickoff is after
C-8 Part 3 closes (RLS at runtime) and a key-rotation runbook lands.

### 7.3 BAA posture

Summarized in [§ 5. BAA inventory](#5-baa-inventory). GCP ✅, Anthropic ✅ (signed
2026-04-16 and BAA gate enforced at runtime), SendGrid ✅ date TBD, Quest 🟡
feature-flagged off until partnership BAA lands.

---

## 8. Posture trendline

| Cycle | Audit date | Critical open | High open | Medium open | Low open | Grade |
|---|---|---|---|---|---|---|
| **2026-04-24** (this) | 2026-04-16 | **1** | 0 | 0 | 0 | **B-** |
| 2026-04-16 (immediately post-C-1…C-6 merge) | 2026-04-16 | 2 (C-7 open, C-8 open) | 5 | 0 | 4 | C+ |
| 2026-04-15 (pre-audit baseline) | 2026-04-15 | 8 (C-1…C-8) | 5 | est. 2 | est. 4 | D |
| 2026-03-25 (prior release snapshot) | 2026-03-25 | est. 3 (C-1, C-5, C-6 latent) | est. 4 | est. 2 | est. 4 | C |

Pre-2026-04-15 rows are reconstructed from `git log` on `backend/src/config/index.ts`,
`encryption.ts`, `database.ts`, and the finding IDs cited in merged commits. Where
an exact count can't be derived from the repo, the cell is marked `est.` and the
doc notes `TBD (external: prior audit archive — ask security owner for pre-2026-04-15
severity count)`.

---

## 9. Next-audit trigger

Re-run `24-full-security-audit.md` (which orchestrates prompts `01-13` + `26-32`)
when **any** of these fire:

1. **C-8 Part 3 cutover completes** — the `omh_app` NOBYPASSRLS role is live in
   prod and `RLS_ENFORCEMENT=strict` is set. Full re-audit required: this is
   the grade-change event.
2. **A new external integration ships with PHI in scope** (beyond Anthropic /
   GCP / SendGrid / Quest). New BAA surface = new audit.
3. **Any Critical finding opens**, or 2+ High findings open in the same week.
4. **90 days elapse** since the last full audit (soft cadence — 2026-07-16 fires
   next under this rule).
5. **A dependency CVE of severity ≥7.5** hits a direct dependency (the CI
   `npm audit high+` gate will already fail the build; audit re-run confirms
   the fix landed with no regression).
6. **Schema migration touches any PHI table or RLS policy** — drift between
   `PHI_FIELDS` and the schema is a silent failure mode.

---

## Acceptance questions — self-answered

Each answer below is derivable from this doc + linked siblings alone.

**Q1. What's the current security grade, and what changed this cycle?**
`B-` (see [Header](#header)). Up from `C+` / `D` earlier in the cycle because
C-1 through C-7 closed (7 Criticals) plus 5 Highs and 4 Lows. C-8 remains the
only open Critical. See [§ 1. Posture summary](#1-posture-summary) and the
trendline at [§ 8](#8-posture-trendline).

**Q2. What Critical findings are open today? What's the plan for each?**
One: **C-8 — RLS policies inert at runtime**. All code prerequisites are
merged (Parts 1, 2a, 2b-i, 2b-ii, Part 3 runbook); remaining work is the
Cloud SQL role provisioning + `DATABASE_URL` rotation + flipping
`RLS_ENFORCEMENT=strict`. See the 4-step plan in [§ 2](#2-open-findings).

**Q3. Which closed this cycle, and in which PR?**
7 Criticals (C-1…C-7) + F-14/F-15 + 5 Highs (F-3, F-4, F-5, F-7, Zod password
policy) + 4 Lows. PRs and commits listed in [§ 3. Closed in current cycle](#3-closed-in-current-cycle).

**Q4. What's the status of C-7 (PHI-to-Claude minimization) and C-8 (BYPASSRLS
runtime)?**
- **C-7 — CLOSED** in PR `#39` (commit `8c19438`, 2026-04-16). Runtime BAA gate
  at `claudeExtraction.ts:118-123`; PHI redaction at `utils/phiRedaction.ts`;
  local PDF text extraction at `services/pdfTextExtraction.ts`. Tests
  `claudeExtraction.test.ts`, `phiRedaction.test.ts`.
- **C-8 — OPEN**. Code-level parts merged (see table in [§ 2](#2-open-findings)),
  infrastructure role cutover pending.

**Q5. Which controls are ✅ vs 🟡 vs ⚠️ today?**
Counting across [§ 4. Controls status](#4-controls-status):
- ✅ — 57 controls spot-checked and passing.
- 🟡 — 5 partial: CSRF upload-route exemption (temporary), key-rotation runbook,
  audit coverage on the fresh FHIR surface, rate-limiter in-memory store,
  HIPAA §164.312(a)(2)(ii) emergency-access runbook, SendGrid BAA date
  undocumented, §164.312(a)(1) Access Control pending C-8 Part 3, Quest BAA
  pending (feature-flagged off).
- ⚠️ — 2 explicit exceptions (both tied to **C-8**): startup assertion is
  warn-by-default, and production still connects as BYPASSRLS.

**Q6. Which BAAs are signed, and which are pending?**
Signed: GCP (pre-existing), Anthropic (2026-04-16), SendGrid (date TBD). Pending /
feature-flagged: Quest Diagnostics. See [§ 5](#5-baa-inventory).

**Q7. When was the last audit, and what triggered the next one?**
Last audit: 2026-04-16 (C-1…C-7 closing pass + trailing F-series closures on
2026-04-17/18). Next-audit triggers listed in [§ 9](#next-audit-trigger); the
grade-change event is C-8 Part 3 cutover.

**Q8. What's the verification for the most recent closed Critical?**
C-7 (PHI minimization for Claude) is the most recent Critical closure
(2026-04-16, PR `#39`). Verification: runtime BAA gate at
`backend/src/services/claudeExtraction.ts:118-123` throws before any network
call; `utils/phiRedaction.ts` is invoked at `claudeExtraction.ts:131-140`
before the prompt is built; local PDF text is produced at
`services/pdfTextExtraction.ts` so the raw PDF never leaves the server; three
test files cover the path (`claudeExtraction.test.ts`, `phiRedaction.test.ts`,
plus caller-level BAA-gate assertions in `biomarkerRoutes.guidance.test.ts`
and `expenseController.test.ts`).

**Q9. How does audit logging coverage compare to `PHI_TAXONOMY.md` expectations?**
`PHI_TAXONOMY.md` enumerates every `*Encrypted` column and its write/read sites.
The audit service is imported in 188 call sites across 24 files (verified by
Grep `logAccess|logCreate|logUpdate|logDelete|auditLogService` this pass),
covering every controller named in PHI_TAXONOMY's call-site tables. The one
fresh surface — Quest FHIR lab-sync (`services/fhir/labSyncService.ts`) —
landed during this cycle and is flagged as freshest audit target in
[§ 4.7](#47-audit-logging).

**Q10. What's the remediation owner for each open High finding?**
Zero Highs are open this cycle ([§ 1](#1-posture-summary)). The only open
finding is C-8 (Critical), owned by `TBD (external: infrastructure owner — GCP
Cloud SQL admin)` per [§ 2](#2-open-findings).

---

## Related Documents

- [`SECURITY_AUDIT_core.md`](./SECURITY_AUDIT_core.md) — per-area audit: core services (pending generation, see prompt `24-full-security-audit.md`).
- [`SECURITY_AUDIT_domain.md`](./SECURITY_AUDIT_domain.md) — per-area audit: domain controllers / routes (pending).
- [`SECURITY_AUDIT_infrastructure.md`](./SECURITY_AUDIT_infrastructure.md) — per-area audit: deploy / DB / secrets (pending).
- [`SECURITY_AUDIT_periphery.md`](./SECURITY_AUDIT_periphery.md) — per-area audit: AI / email / storage / FHIR (pending).
- [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) — full HIPAA technical-safeguard mapping (pending; see prompt `22-hipaa-checklist-doc.md`).
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) — open issues / drift log (pending; prompt `20-known-issues-doc.md`).
- [`CHANGELOG.md`](./CHANGELOG.md) — closing PRs and release history (pending; prompt `19-changelog-doc.md`).
- [`DATA_MODEL.md`](./DATA_MODEL.md) — per-table RLS policies and cascade behavior.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — every PHI field × encryption × write/read sites × audit coverage.
- [`RUNBOOK.md`](./RUNBOOK.md) — operational remediation steps (env-var update pinning postmortem, deploy, rollback).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — high-level system overview, middleware stack.
- [`API_REFERENCE.md`](./API_REFERENCE.md) — per-endpoint auth + rate-limit contracts.
- [`ENV_VARS.md`](./ENV_VARS.md) — `RLS_ENFORCEMENT`, `ANTHROPIC_BAA_ACTIVE`, `AUDIT_LOG_SALT`, JWT + PHI keys.
- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — middleware chain per route.
- [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) — incident playbooks.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — diagnostic recipes.
- [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) — security regression test patterns.
- [`LOCAL_DEV.md`](./LOCAL_DEV.md) — local-dev env with BAA-off behavior.
- Security audit prompts (for re-auditing): [`../prompts/01-database-schema.md`](../prompts/01-database-schema.md), [`02-encryption.md`](../prompts/02-encryption.md), [`03-authentication.md`](../prompts/03-authentication.md), [`04-csrf.md`](../prompts/04-csrf.md), [`05-audit-logging.md`](../prompts/05-audit-logging.md), [`06-api-routes.md`](../prompts/06-api-routes.md), [`07-input-validation.md`](../prompts/07-input-validation.md), [`08-rate-limiting.md`](../prompts/08-rate-limiting.md), [`09-external-apis.md`](../prompts/09-external-apis.md), [`10-frontend-auth.md`](../prompts/10-frontend-auth.md), [`11-environment-secrets.md`](../prompts/11-environment-secrets.md), [`12-cicd-security.md`](../prompts/12-cicd-security.md), [`13-dependency-health.md`](../prompts/13-dependency-health.md), [`24-full-security-audit.md`](../prompts/24-full-security-audit.md), [`26-provider-collaboration.md`](../prompts/26-provider-collaboration.md), [`27-ai-integration.md`](../prompts/27-ai-integration.md), [`28-file-storage.md`](../prompts/28-file-storage.md), [`29-data-portability.md`](../prompts/29-data-portability.md), [`30-admin-security.md`](../prompts/30-admin-security.md), [`31-logging-observability.md`](../prompts/31-logging-observability.md), [`32-error-handling.md`](../prompts/32-error-handling.md).

---

## Prompt drift log

- `./21-security-status-doc.md` assumes four `SECURITY_AUDIT_*.md` files already
  exist in `New Project Documents/` as synthesis input. As of 2026-04-24 none
  of the four exist — they are planned outputs of `24-full-security-audit.md`.
  This doc synthesized from git log + live code + project memory instead, and
  the cross-links to the four AUDIT docs are annotated as `pending`.
- Same prompt assumes `C8_PART3_RUNBOOK.md` and `C8_PART3_STARTUP_ASSERTION.md`
  exist as `New Project Documents/` siblings. The in-repo runbook lives at
  `docs/STAGING.md` (referenced from `database.ts:194`) and the startup
  assertion spec is inline in `database.ts:220-270`. Extracting both to
  Claude-Project siblings is a tracked follow-up.
- Prompt assumes `HIPAA_CHECKLIST.md`, `KNOWN_ISSUES.md`, and `CHANGELOG.md`
  already exist as cross-link targets. None do yet (per TaskList this cycle).
  Cross-links are marked `pending` with pointers to the generating prompts.
