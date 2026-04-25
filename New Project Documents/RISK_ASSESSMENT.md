---
tags:
  - documentation
  - security
  - compliance
  - hipaa
type: hipaa-administrative-safeguard
hipaa-citation: §164.308(a)(1)(ii)(A) Risk Analysis
generated: 2026-04-25
version: 1.0
status: draft
review-cycle: quarterly
next-review: 2026-07-25
---

# Risk Assessment — OwnMyHealth

> **Purpose**: this document satisfies the Risk Analysis administrative
> safeguard required by 45 CFR §164.308(a)(1)(ii)(A). It enumerates the
> reasonable threats to electronic Protected Health Information (ePHI) in
> the OwnMyHealth system, the controls currently in place, and the
> residual risk after those controls. It is an internal document. It is
> not marketing; it is honest about the gaps.

---

## 1. Executive Summary

OwnMyHealth is a privacy-first, HIPAA-targeted health platform built and
operated by a **single founder/engineer** (no team, no employees, no
contractors with PHI access). It is **pre-beta**: no production user data,
no live PHI, no active patient cohort. `[CONFIRM: pre-beta status — no
external users have been onboarded as of 2026-04-25.]`

**Scope of ePHI handled** — 36 encrypted PHI fields across 15 Prisma models
(see [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md)). The high-level categories:

| # | PHI category | Model(s) | Encrypted? |
|---|---|---|---|
| 1 | Identity (name, DOB, phone, address) | `User` | ✅ AES-256-GCM, per-user salt |
| 2 | Lab biomarker values + history + notes | `Biomarker`, `BiomarkerHistory` | ✅ |
| 3 | Insurance plan + member identifiers | `InsurancePlan`, `InsuranceBenefit` | ✅ |
| 4 | Health goals + progress notes | `HealthGoal`, `GoalProgressHistory` | ✅ |
| 5 | Health needs / referrals | `HealthNeed` | ✅ |
| 6 | Expense projections / actuals | `ExpenseProjection`, `ExpenseActual` | ✅ |
| 7 | AI cost-analysis narratives | `CostAnalysis` | ✅ (renamed `claudeResponse` → `claudeResponseEncrypted` 2026-04-24) |
| 8 | Health profile (conditions / medications / family history) | `User.healthProfileEncrypted` | ✅ |
| 9 | Provider-patient relationship notes | `ProviderPatient.notesEncrypted` | ✅ |
| 10 | Lab/insurance source files | `UserFile` (file bytes in GCS, metadata in DB) | ⚠️ DB metadata not encrypted; bytes encrypted at rest by GCS |
| 11 | OAuth tokens for lab integrations | `LabConnection` | ✅ |
| 12 | DNA / genetic data (deprecated, schema present) | `DNAData`, `DNAVariant`, `GeneticTrait` | ✅ — feature paused; tables empty |

**Current security posture** — `B+` grade ([`SECURITY_STATUS.md`](./SECURITY_STATUS.md)):

| Severity | Open | Code-complete (operator-pending) | Closed |
|---|---:|---:|---:|
| Critical | 0 | 1 (C-8 — runtime RLS) | 7 |
| High | 0 | 0 | ~22 |
| Medium | ~4 (deferred design) | 0 | ~33 |
| Low | 0 | 0 | 4 |

**Top three residual risks** (full matrix in §5):
1. **C-8 — RLS not yet enforcing at the database layer.** Today's tenant
   isolation depends entirely on application-layer `withRLSContext`
   wrappers and explicit `where: { userId }` filters. Code-complete; the
   operator role rotation will activate the second-layer database guard.
2. **No multi-factor authentication.** Password-only login plus DB-backed
   refresh sessions. Acceptable for a pre-beta solo system; not acceptable
   for live PHI.
3. **No backup-restore drill on record.** Cloud SQL automated backups exist
   `[CONFIRM: GCP Cloud SQL automated backup retention period]`, but no
   documented restore exercise has been performed.

---

## 2. System Description

System anchors are pulled from [`ARCHITECTURE.md`](./ARCHITECTURE.md). This
section is a HIPAA-relevant subset, not a complete architecture overview.

### 2.1 Tech stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | React 18 + Vite 7.3 + TypeScript | — |
| Backend | Node 20 + Express 4.18 + TypeScript | — |
| ORM | Prisma 7 (GA) | `^7.0.1` |
| Database | PostgreSQL 16 on Google Cloud SQL | — |
| File storage | Google Cloud Storage | — |
| OCR | Google Document AI | — |
| AI | Anthropic Claude API (`claude-sonnet-*`, `claude-haiku-*`) | — |
| Email | SendGrid (Twilio) | — |
| Hosting | Cloud Run (backend) + GCS bucket (frontend SPA) | — |
| Secrets | GCP Secret Manager | — |
| CI/CD | GitHub Actions | — |

### 2.2 Data flows

**Browser → Backend → Database (typical PHI write)**

```
User browser (React SPA, HTTPS)
   │
   │  HttpOnly access_token cookie + X-CSRF-Token header
   ▼
Cloud Run (backend Express app, TLS termination at Google LB)
   │
   ├── helmet → CORS → cookie-parser → CSRF validate (timing-safe)
   ├── rate-limit middleware (6 named limiters)
   ├── authenticate (JWT verify with pinned alg/iss/aud)
   ├── RBAC check (role + ownership)
   ├── Zod input validation (+ magic-byte for uploads)
   ├── controller: encrypt(plaintext, userSalt)  ← AES-256-GCM
   ▼
withRLSContext(userId, tx => tx.<model>.create(...))
   │  SET LOCAL app.current_user_id = $1
   │  SET LOCAL app.is_admin       = 'false'
   ▼
PostgreSQL (TLS via Cloud SQL Auth Proxy)
   ├── RLS policies fire on user_id   ⚠️ today: BYPASSRLS role bypasses (C-8)
   └── Encrypted ciphertext at rest
```

**Backend → Anthropic Claude (PHI minimization path)**

```
PDF upload → pdf-parse (local extraction, no network)
          → redactPHI()  ← strips SSN, email, phone, NPI, DEA, ZIP, dates,
                            addresses, labeled patient names
          → text-only prompt to Claude (no PDF vision/document input)
          → Claude API (TLS) — Anthropic BAA signed 2026-04-16
          → response: stripPHIFromText() defense-in-depth
          → encrypt(response, userSalt) → DB
```

### 2.3 Data at rest

| Data | Mechanism | Reference |
|---|---|---|
| PHI columns | AES-256-GCM with per-user PBKDF2-SHA512 (600k iter) derived key, master key from `PHI_ENCRYPTION_KEY` env (Secret Manager in prod) | [`encryption.ts:57-61, 263-279`](../backend/src/services/encryption.ts) |
| Audit log encrypted values | Same AES-256-GCM, salted from `AUDIT_LOG_SALT` env | [`auditLog.ts`](../backend/src/services/auditLog.ts) |
| User encryption salts | Encrypted with master key, stored on `UserEncryptionKey` | [`userEncryption.ts`](../backend/src/services/userEncryption.ts) |
| Backups | Google Cloud SQL automated backups, encrypted by Google by default | `[CONFIRM: backup retention window in GCP Console]` |
| GCS objects (lab/SBC PDFs) | Encrypted by GCS server-side encryption (Google-managed keys) | [`storageService.ts`](../backend/src/services/storageService.ts) |
| Secrets | GCP Secret Manager | `.github/workflows/deploy.yml` |

### 2.4 Data in transit

| Channel | Protection | Reference |
|---|---|---|
| Browser ↔ Backend | TLS 1.3 (Cloud Run + Google LB), HSTS via helmet | [`app.ts`](../backend/src/app.ts) |
| Backend ↔ Cloud SQL | TLS via Cloud SQL Auth Proxy | `DATABASE_URL` configuration |
| Backend ↔ Anthropic | TLS via Anthropic SDK | [`anthropicClient.ts`](../backend/src/services/anthropicClient.ts) |
| Backend ↔ GCS | TLS via Google SDK | [`storageService.ts`](../backend/src/services/storageService.ts) |
| Backend ↔ SendGrid | TLS via SendGrid SDK | [`emailService.ts`](../backend/src/services/emailService.ts) |
| Cookies | `Secure` (prod), `HttpOnly`, `SameSite=strict` (same-domain prod), CSRF double-submit token | [`config/index.ts:74-88`](../backend/src/config/index.ts) |

### 2.5 External processors

| Vendor | Service | BAA | PHI exposure |
|---|---|---|---|
| Google Cloud Platform | Cloud Run, Cloud SQL, GCS, Document AI, Secret Manager | ✅ Standard GCP HIPAA BAA `[CONFIRM: BAA acknowledged in GCP Console for project ownmyhealth-prod]` | Full PHI surface (storage, processing, OCR) |
| Anthropic | Claude API | ✅ Signed 2026-04-16 (project memory; runtime gate at `config/index.ts:245-258`) | Lab text + biomarker values + cost narratives, after PHI-redaction floor |
| SendGrid (Twilio) | Transactional email (verification, password reset) | `[CONFIRM: BAA execution date]` — templates carry no PHI today | None today; emails contain only verification links and user email |
| Quest Diagnostics (FHIR) | Lab data ingest | 🟡 Pending — feature flagged off; `clientId` unset | None until enabled |

---

## 3. Threat Inventory

Threat model methodology: HIPAA Security Rule "reasonably anticipated"
threats. Likelihood and impact are graded conservatively for a pre-beta
solo-founder system; numbers should be re-graded once a real user cohort
exists. The "Risk" column is the qualitative product, not a numeric score.

### 3.1 T-01 — Unauthorized access via credential theft

- **Description**: Attacker obtains a user's password (phishing, password
  reuse, breach replay) and logs in.
- **Likelihood**: Medium. Pre-beta means a small attack surface, but the
  industry baseline rate for credential compromise is non-trivial.
- **Impact**: High. Successful login grants full access to the user's PHI
  records (biomarkers, insurance, health profile).
- **Current controls**:
  - bcrypt password hashing at 13 rounds ([`config/index.ts:90-94`](../backend/src/config/index.ts))
  - Password policy: 12 chars + complexity, enforced both Zod and frontend ([`validation.ts:117-123`](../backend/src/middleware/validation.ts))
  - Account lockout after 5 failed login attempts ([`config/index.ts:90-94`](../backend/src/config/index.ts))
  - Brute-force rate limiter (5/15 min, keyed on `email:ip`, failed-only) ([`rateLimiter.ts:50-69`](../backend/src/middleware/rateLimiter.ts))
  - 15-minute access-token TTL + 7-day refresh with DB-backed sessions
  - Audit log of every login (`logAuth('LOGIN' / 'LOGIN_FAILED')`)
- **Gap**: No MFA. No detection signal on "successful login from new IP".
- **Residual risk**: **Medium**. Adding MFA before beta drops this to Low.

### 3.2 T-02 — Insider threat / privilege escalation

- **Description**: A malicious insider with system access reads or
  exfiltrates PHI. For OwnMyHealth this is a single founder with full
  GCP/repo access — **no separation of duties exists**.
- **Likelihood**: Low (single trusted operator).
- **Impact**: Critical (full PHI exposure).
- **Current controls**:
  - DB self-elevation trigger blocks role/`is_active` mutation by non-admin sessions ([`20260424_prevent_self_role_elevation/migration.sql`](../backend/prisma/migrations/20260424_prevent_self_role_elevation/migration.sql))
  - All admin actions audited with `actorType: 'ADMIN'` ([`auditLog.ts:179-183`](../backend/src/services/auditLog.ts))
  - Demo account explicitly blocked from admin paths
  - Audit log uses 7-year retention with encrypted previous/new values
- **Gap**: No audit-log review process. No second-pair-of-eyes for
  destructive admin actions. No segregation of production secrets from
  the development workstation.
- **Residual risk**: **Medium**. Documenting an audit-log review cadence
  and rotating prod secrets through a key-management service would drop
  this to Low. The structural issue (one operator) cannot be fully
  mitigated until headcount grows.

### 3.3 T-03 — Application vulnerability (OWASP Top 10)

- **Description**: SQL injection, XSS, IDOR, broken access control, etc.
- **Likelihood**: Medium. New code is a continuous source of new bugs;
  vulnerability density is bounded by the small surface (one engineer).
- **Impact**: High to Critical depending on exploit class.
- **Current controls**:
  - **SQLi**: Prisma parameterizes everything; no raw SQL with user input.
    `set_config()` uses `$executeRaw` template tags (parameterized) — no
    interpolation.
  - **XSS**: Helmet CSP (`scriptSrc: 'self'`); React JSX auto-escapes.
    `'unsafe-inline'` is allowed for `styleSrc` for Tailwind compatibility,
    documented limitation ([`app.ts:129-134`](../backend/src/app.ts)).
  - **IDOR**: every controller validates ownership via `withRLSContext(userId, ...)`
    and `where: { id, userId }`. F-3 IDOR closed in 2026-04-17.
  - **CSRF**: double-submit cookie + constant-time compare via SHA-256 hashes
    ([`csrf.ts`](../backend/src/middleware/csrf.ts)). Only `/ai/chat` SSE
    is exempt — and uses bearer-only auth, not cookies.
  - **Input validation**: Zod schemas at every API boundary; magic-byte +
    filename sanitization on uploads.
  - **CI guard**: `check-rls-wrappers.sh` fails the build on bare `prisma.<model>.<verb>` or `prisma.$queryRaw` outside the wrapper.
- **Gap**: No external penetration test on record.
- **Residual risk**: **Medium**. A pre-beta external pen test would drop
  to Low.

### 3.4 T-04 — Infrastructure misconfiguration

- **Description**: GCP IAM mistake, public bucket, exposed secret in env,
  Cloud Run revision pinning bug.
- **Likelihood**: Medium. The 2026-04-17 incident (env-var update silently
  held back by revision pinning) shows this class is real.
- **Impact**: Critical (potential PHI bucket exposure).
- **Current controls**:
  - Secrets in GCP Secret Manager (not in code, not in `.env`)
  - `GCS_BUCKET_NAME` hard-fails in production when unset (no silent fallback) ([`config/index.ts:330-340`](../backend/src/config/index.ts))
  - Cloud Run deploys via tagged-revision-then-shift pattern, not direct overwrite (`.github/workflows/deploy.yml`)
  - `app.set('trust proxy', 1)` (single hop, not `true`) — prevents X-Forwarded-For spoofing
  - HSTS + secure cookies enforced in production
- **Gap**:
  - No automated check that GCS buckets are private (manual GCP Console review).
  - No alert on IAM changes.
  - Cloud Run revision pinning postmortem captured ([`SECURITY_STATUS.md` § 6](./SECURITY_STATUS.md#6-incidents-since-prior-cycle)) but the runbook step that prevents recurrence is documented, not enforced.
- **Residual risk**: **Medium**.

### 3.5 T-05 — PHI disclosure to AI processor (Anthropic)

- **Description**: PHI sent to Claude either contains identifiers that
  shouldn't have left the system, or Claude reflects PHI back into a
  response that gets logged or displayed.
- **Likelihood**: Medium (every Claude call processes user PHI).
- **Impact**: Medium (Anthropic BAA in place; the failure mode is
  "minimum-necessary violation," not unauthorized disclosure).
- **Current controls** (closure of C-7):
  - Anthropic BAA signed 2026-04-16 (runtime-gated by `ANTHROPIC_BAA_ACTIVE` env, hard-failed in prod if BAA flag absent)
  - PHI stripped from input via `redactPHI` (SSN, NPI, DEA, dates, ZIPs, emails, phones, addresses, labeled names) before every Claude call
  - PDF text extracted locally first; **no PDF vision input** any more (vision fallback removed 2026-04-24)
  - Cost-analysis prompts pass through `stripPHIFromText` as a final scrub before send
  - Claude responses pass through `stripPHIFromText` defense-in-depth before storage / display
  - Audit log records every Claude call with `externalApiCall: true` and `phiDisclosedFields` enumeration; biomarker name no longer in plaintext metadata
- **Gap**: Service-type anonymization (`"HIV PrEP consultation"` → `"Specialist Visit"`) deferred — needs a curated medical taxonomy.
- **Residual risk**: **Low** for HIPAA-grade PHI (covered identifiers); **Low-Medium** for inference-disclosure (free-text notes can carry condition information).

### 3.6 T-06 — PHI disclosure via logs

- **Description**: PHI written to Cloud Logging / stdout where it
  accumulates with longer retention than HIPAA's minimum-necessary
  principle would prefer.
- **Likelihood**: Medium. Field-name-based redaction has known drift
  (camelCase set vs lowercase comparison).
- **Impact**: Medium (Cloud Logging is access-controlled, but a long
  retention window means an exposed key creates a long disclosure tail).
- **Current controls**:
  - `sanitizeData` redacts known PHI field names with `[REDACTED]` ([`logger.ts:21-50`](../backend/src/utils/logger.ts))
  - Array recursion fixed (F-21, 2026-04-18)
  - `stripPHIFromText` available for narrative scrubbing
  - SBC extraction logs no longer carry `planName` / `insurerName` (F-19, 2026-04-24)
- **Gap**:
  - `*Encrypted` field names are NOT redacted because the matcher
    lowercases the input but the set has camelCase entries. Documented
    in [`PHI_TAXONOMY.md` § 7 Drift findings](./PHI_TAXONOMY.md#7-drift-findings); field-by-field gap matrix in §4 there.
  - No detection alert on PHI-pattern strings hitting the log stream.
- **Residual risk**: **Medium**. The drift is well-characterized; a
  one-pass fix covers it.

### 3.7 T-07 — Ransomware / data destruction

- **Description**: Adversary obtains write access (compromised credential,
  CI/CD compromise) and encrypts/deletes the PHI database or GCS bucket.
- **Likelihood**: Low (small attack surface, no public ingress except the
  app itself).
- **Impact**: Critical (data loss, no documented restore).
- **Current controls**:
  - Cloud SQL automated backups (Google-managed) `[CONFIRM: retention window]`
  - GCS object versioning `[CONFIRM: enabled on the user-files bucket]`
  - Production deploys via signed CI commits only (no direct `gcloud run deploy` from a developer workstation)
  - Audit log retention 7 years (deletion attempts at scale would surface in `cleanupOldLogs` activity)
- **Gap**:
  - **No restore drill has been performed.** The first time a backup is
    restored will be the first time anyone learns whether it works.
  - No GCS object-lock / immutability policy.
- **Residual risk**: **High** — not because the threat is likely, but
  because the recovery path is unverified. Drops to Medium once a tabletop
  restore is documented; Low after a real restore drill.

### 3.8 T-08 — Denial of service

- **Description**: Volumetric or application-layer attack that prevents
  legitimate users from accessing their data.
- **Likelihood**: Medium for a public-facing app; Low pre-beta.
- **Impact**: Low (availability, not confidentiality/integrity).
- **Current controls**:
  - 6 named rate limiters (standard, auth, strict-auth, upload, sensitive,
    AI, bulk) ([`rateLimiter.ts`](../backend/src/middleware/rateLimiter.ts))
  - Cloud Run scales horizontally (bounded by `--max-instances=3` to avoid
    rate-limiter-dilution; documented in deploy.yml)
  - 10MB body-size cap, magic-byte validation, PDF header check, 30s
    statement timeout on Postgres
- **Gap**: Rate limiter is in-memory per-instance; with 3 instances an
  attacker can hit each up to 3× the per-instance cap. Documented limit at
  [`rateLimiter.ts:6-13`](../backend/src/middleware/rateLimiter.ts);
  upgrade to `rate-limit-redis` deferred until traffic justifies.
- **Residual risk**: **Low** for the current scale.

### 3.9 T-09 — Supply chain attack (npm dependencies)

- **Description**: A direct or transitive dependency is compromised and
  ships malicious code through a release.
- **Likelihood**: Medium (industry baseline; Node ecosystem has had
  high-profile cases).
- **Impact**: High to Critical depending on the package.
- **Current controls**:
  - CI fails on any `npm audit --audit-level=high` finding (zero
    high+ today across both frontend and backend; verified 2026-04-25)
  - `npm ci` rather than `npm install` in CI (lockfile-pinned)
  - `package-lock.json` committed
  - `--ignore-scripts` not currently set in CI `[CONFIRM]`
- **Gap**:
  - GitHub Actions are pinned to **major version tags** (`@v2`, `@v4`),
    not commit SHAs. A compromised release of `actions/checkout` or
    `google-github-actions/auth` would propagate. Tracked in
    `.github/workflows/deploy.yml` header TODO.
  - 11 moderate-severity advisories in transitive deps (uuid, gaxios,
    @hono/node-server) — all in dev-time / GCP SDK chains, no runtime
    PHI exposure path.
  - No SBOM generated.
- **Residual risk**: **Medium**. SHA-pinning the actions and adding an
  SBOM step would drop to Low.

### 3.10 T-10 — Physical device compromise (developer workstation)

- **Description**: The single developer's laptop is stolen, malware'd, or
  the screen is shoulder-surfed. Local repo + `.env` + GCP credentials may
  grant access to prod.
- **Likelihood**: Low (single device, locked, encrypted disk
  `[CONFIRM: full-disk encryption enabled on the development workstation]`).
- **Impact**: Critical (gcloud SDK + repo + Secret Manager access can
  reach prod PHI).
- **Current controls**:
  - `.env` files excluded from git (`.gitignore` and `.dockerignore`)
  - Production secrets only in GCP Secret Manager (not on the workstation)
    `[CONFIRM: no prod credentials in `~/.config/gcloud/` outside an
    active gcloud auth session]`
  - GitHub Actions runs deploys, not local commands (no production secrets
    on the workstation by design)
  - Workstation has full-disk encryption `[CONFIRM]`
- **Gap**: No documented "lost device" SOP. No remote wipe / kill switch
  for cached gcloud credentials.
- **Residual risk**: **Medium**. Documenting a lost-device SOP and adding
  short TTLs to gcloud auth tokens would drop to Low.

### 3.11 T-11 — Social engineering

- **Description**: Phishing or pretext call targeting the operator to
  obtain credentials or trick them into a privileged action.
- **Likelihood**: Low — no public attack surface yet, no SaaS partners
  with privileged access. Will rise post-beta.
- **Impact**: Critical (operator access = root).
- **Current controls**: None operationally beyond standard email hygiene.
- **Gap**: No formal awareness training, no documented "we will never
  ask you for your password by email" comms posture.
- **Residual risk**: **Medium**. Adding a HIPAA awareness training
  document and rotating critical credentials through a hardware-backed MFA
  (YubiKey or equivalent) would drop to Low.

### 3.12 T-12 — Third-party service compromise (GCP, Anthropic, SendGrid)

- **Description**: A vendor with access to PHI suffers their own breach.
- **Likelihood**: Low for top-tier vendors with active SOC 2 / ISO
  programs; non-zero industry-wide.
- **Impact**: Critical (depending on the vendor's PHI scope).
- **Current controls**:
  - BAAs with GCP and Anthropic (legal coverage transfers some liability
    and obliges breach notification)
  - SendGrid handles no PHI today (templates carry only verification
    links and the user's email address — email is technically PHI but
    minimal)
  - Quest FHIR feature flagged off until BAA executed
- **Gap**:
  - SendGrid BAA execution date is not documented `[CONFIRM]`.
  - No documented procedure to rotate PHI keys / re-encrypt at rest
    after a vendor breach notification.
- **Residual risk**: **Medium**. Drops to Low once the SendGrid BAA is
  filed and a key-rotation runbook exists.

---

## 4. Controls Assessment

### 4.1 Access control

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| RBAC (PATIENT < PROVIDER < ADMIN) | ✅ | High | — |
| Resource-type × permission matrix | ✅ | High | — |
| Ownership check on every mutation | ✅ | High | Verified by CI guard `check-rls-wrappers.sh` |
| Provider consent required + ACTIVE + non-expired | ✅ | High | — |
| Provider capability flags (`canViewBiomarkers`, etc.) | ✅ | High | `canViewInsurance` / `canViewDna` / `canEditData` are wired but no UI surface; `SUSPENDED` / `EXPIRED` statuses defined but no transition path — see [`SECURITY_STATUS.md` deferred Mediums](./SECURITY_STATUS.md#remaining-open-mediums) |
| Admin self-elevation blocked at DB layer | ✅ | High | Trigger in `20260424_prevent_self_role_elevation/migration.sql`; admin context bypasses, user context blocked |
| RLS at database layer | 🟡 | High once enforced | **C-8 — operator role rotation pending.** App-layer wrappers are the load-bearing control today. |
| Demo account blocked from admin paths | ✅ | High | `blockDemoAdminAccess` middleware |

### 4.2 Encryption

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| AES-256-GCM at rest for PHI | ✅ | High | — |
| Per-user PBKDF2-SHA512 600k iter key derivation | ✅ | High | OWASP 2023 baseline |
| Master key validation rejects placeholder values in every env | ✅ | High | `encryption.ts:129-141` — closed C-4 |
| TLS 1.3 in transit | ✅ | High | Cloud Run + Google LB |
| HttpOnly + Secure + SameSite=strict cookies (prod) | ✅ | High | Tightened 2026-04-24 (was Lax) |
| User salts encrypted with master key at rest | ✅ | High | — |
| Key rotation runbook | 🟡 Pending | — | `TODO(key-rotation)` in `encryption.ts:81-85`; legacy 100k fallback retained for compat |
| HSM / managed key (Cloud KMS) | 🟡 Not used | — | Master key is an env var in Secret Manager; Cloud KMS would add HSM-backed wrap |

### 4.3 Audit logging

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| HIPAA-compliant audit trail table (`audit_logs`) | ✅ | High | — |
| 7-year retention scheduler | ✅ | High | `RETENTION_DAYS = 2555` |
| Audit logs include IP, UA, session, actor, action, resource | ✅ | High | IP via `req.ip` (trust-proxy=1); closed F-9 |
| Previous/new values encrypted | ✅ | High | — |
| Audit-log encryption salt from env | ✅ | High | Closed C-2 (was in `system_config`) |
| Coverage over PHI reads/writes | 🟡 | Medium-High | 188 call sites verified against `PHI_TAXONOMY.md` master table; FHIR path is freshest |
| Tamper evidence (append-only, immutable) | 🟡 | Medium | RLS policies prevent UPDATE/DELETE outside admin context, but admin context can still modify. No external WORM target. |
| Audit log review cadence | ❌ | — | Not documented |

### 4.4 Authentication

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| JWT with pinned alg / iss / aud | ✅ | High | `config/jwtOptions.ts` |
| Bcrypt 13+ rounds | ✅ | High | — |
| Brute-force lockout (5 failed → 30 min lock) | ✅ | High | — |
| Strict auth limiter (5/15 min, email:ip-keyed) | ✅ | High | — |
| 15-min access tokens / 7-day refresh / DB-backed sessions | ✅ | High | — |
| Refresh tokens revocable | ✅ | High | Session table + 10-min cleanup interval |
| Password policy 12+ chars w/ complexity | ✅ | High | Closed F-7 |
| **Multi-factor authentication** | ❌ | — | **Not implemented.** Required before beta. |

### 4.5 Input validation

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| Zod schemas at API boundary | ✅ | High | — |
| UUID parameter validation | ✅ | High | — |
| 10MB body-size cap | ✅ | High | — |
| Content-Type guard on JSON routes | ✅ | High | — |
| Magic-byte validation on uploads | ✅ | High | PDF/PNG/JPEG/GIF/TIFF/WebP |
| PDF-bomb header check | ✅ | High | `validatePdfHeader` |
| Filename sanitization (path traversal + control chars) | ✅ | High | F-15 fix 2026-04-24 |
| Validation errors do not echo user input | ✅ | High | F-15 verified |

### 4.6 Rate limiting

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| 6 named limiters per route risk | ✅ | High | — |
| AI limiter user-keyed (cost protection) | ✅ | High | 10/hr/user |
| Provider access-request limiter (10/hr/user) | ✅ | High | F-6 fix |
| Login limiter email+IP keyed, failed-only | ✅ | High | — |
| Shared store across instances | 🟡 | Medium | In-memory; bounded by `--max-instances=3` per [`rateLimiter.ts:6-13`](../backend/src/middleware/rateLimiter.ts) |

### 4.7 CSRF protection

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| Double-submit cookie pattern | ✅ | High | — |
| Constant-time SHA-256 hash compare | ✅ | High | F-17 fix 2026-04-24 |
| Default-on for state-changing methods | ✅ | High | — |
| Upload routes follow standard CSRF flow | ✅ | High | Exemption removed 2026-04-24 |
| SSE chat exempt (bearer-only via `requireBearerAuth`) | ✅ | High | Documented invariant |

### 4.8 PHI minimization for external services

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| BAA gate before any Claude call | ✅ | High | — |
| Local PDF text extraction (no raw bytes leave server) | ✅ | High | C-7 |
| `redactPHI` on input (SSN/NPI/DEA/dates/ZIP/email/phone/address/names) | ✅ | High | — |
| `stripPHIFromText` on output | ✅ | High | — |
| User attribution via `userId` in cost tracker | ✅ | High | Plumbed through 2026-04-24 |
| Service-type anonymization (medical taxonomy) | 🟡 | Low | Deferred design item |
| Audit log records every external PHI call | ✅ | High | — |

### 4.9 Backup and recovery

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| Cloud SQL automated backups | ✅ `[CONFIRM]` | Unknown effectiveness | **No restore drill on record** |
| GCS object versioning | `[CONFIRM]` | Unknown | — |
| GCS object-lock / immutability | ❌ | — | Not configured |
| Documented RPO / RTO | ❌ | — | Not documented |
| Backup-restore tabletop exercise | ❌ | — | Required before beta |

### 4.10 Incident detection and response

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| Audit log captures suspicious events (LOGIN_FAILED, PHI_ACCESS, EXPORT) | ✅ | High | — |
| Cloud Logging captures app errors with structured severity | ✅ | High | — |
| Cloud Logging alert policies | ❌ | — | Not configured |
| Breach notification SOP | ❌ | — | Required by §164.404–414 |
| Postmortem culture | 🟡 | Medium | One postmortem on file (Cloud Run env-var pinning, 2026-04-17); no formal template |

### 4.11 Change management (CI/CD, code review)

| Control | Status | Effectiveness | Gap |
|---|---|---|---|
| Type-check + tests gate every PR | ✅ | High | GitHub Actions CI |
| `npm audit high+` gate | ✅ | High | Fails build on high or critical |
| `check-rls-wrappers.sh` CI guard | ✅ | High | Prevents bare-prisma regressions |
| Code review on every PR | 🟡 | — | Solo founder — no second-pair-of-eyes review (a structural limit of the team size, not a process gap) |
| Signed commits / signed Docker images | ❌ | — | Not configured |
| GitHub Actions pinned to commit SHA | ❌ | — | Pinned to major-version tags; flagged with TODO in deploy.yml |

---

## 5. Risk Matrix

Likelihood × Impact → qualitative residual risk (after current controls).

| Threat | Likelihood | Impact | Residual risk | Trend |
|---|:---:|:---:|:---:|:---:|
| T-01 Credential theft | Medium | High | **Medium** | → Low after MFA |
| T-02 Insider / privilege escalation | Low | Critical | **Medium** | Structural; → Low with audit-log review cadence |
| T-03 App vulnerability | Medium | High | **Medium** | → Low after pen test |
| T-04 Infra misconfiguration | Medium | Critical | **Medium** | → Low with IAM-change alerts |
| T-05 PHI to AI processor | Medium | Medium | **Low-Medium** | Already at floor; → Low after service-type anonymization |
| T-06 PHI in logs | Medium | Medium | **Medium** | → Low after `*Encrypted` redaction-drift fix |
| T-07 Ransomware / destruction | Low | Critical | **High** | **→ Medium after restore drill, → Low after object lock** |
| T-08 Denial of service | Medium | Low | **Low** | OK at current scale |
| T-09 Supply chain | Medium | High | **Medium** | → Low after SHA-pin actions + SBOM |
| T-10 Physical device compromise | Low | Critical | **Medium** | → Low after lost-device SOP + short gcloud token TTL |
| T-11 Social engineering | Low | Critical | **Medium** | → Low after awareness training + hardware MFA |
| T-12 Third-party compromise | Low | Critical | **Medium** | → Low after key-rotation runbook + SendGrid BAA filed |

**Summary**: 1 High residual (T-07 ransomware/destruction), 9 Medium, 1
Low-Medium, 1 Low. The High collapses to Medium with a single
documentation-and-tabletop exercise.

---

## 6. Remediation Plan

Priorities ordered by residual risk reduction × ease of execution.

### 6.1 Pre-beta (must close before live PHI)

| # | Item | Source | Effort | Closes |
|---|---|---|:---:|---|
| 1 | **C-8 operator cutover** — provision `omh_app` NOBYPASSRLS role on Cloud SQL, rotate `DATABASE_URL` in Secret Manager | [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) C-8 row, `C8_PART3_RUNBOOK.md` | Operator | C-8 |
| 2 | **Backup-restore drill** — restore last night's Cloud SQL backup to a staging instance, verify a known-good audit-log entry decrypts | This document T-07 | 1 day | T-07 High → Medium |
| 3 | **MFA for the founder account** — TOTP (authenticator app) at minimum; YubiKey recommended | T-01, T-02, T-10, T-11 | 1-2 days backend + UI | Several Mediums → Low |
| 4 | **Document RPO / RTO** — even tentative numbers ("PHI: 24h RPO, 4h RTO") are better than silent | T-07 | 1 hour | T-07 |
| 5 | **External penetration test** — third-party scoped against the live staging deploy | T-03 | 2-4 weeks vendor lead time | T-03 Medium → Low |
| 6 | **SendGrid BAA** — execute and date-stamp | T-12 | Vendor request | T-12 |
| 7 | **GCP BAA confirmation** — verify acknowledged in GCP Console for the prod project | T-12 | 1 hour | `[CONFIRM]` |
| 8 | **Logger redaction drift fix** — sweep `*Encrypted` field names into `SENSITIVE_FIELDS` (or fix the matcher) | T-06 | 1 hour + tests | T-06 Medium → Low |

### 6.2 Pre-beta — documentation

| # | Item | HIPAA citation |
|---|---|---|
| 9 | Sanction Policy | §164.308(a)(1)(ii)(C) |
| 10 | Workforce Access Authorization SOP | §164.308(a)(3) |
| 11 | Termination Checklist | §164.308(a)(3)(ii)(C) |
| 12 | Security Awareness Training Plan | §164.308(a)(5) |
| 13 | Breach Notification SOP | §164.400-414 |
| 14 | Contingency Plan with documented restore drill | §164.308(a)(7) |
| 15 | Lost Device SOP | T-10 |

### 6.3 Beta-window

| # | Item | Source |
|---|---|---|
| 16 | Cloud Logging alert policies on PHI-shaped patterns + RLS-warning patterns | T-06 |
| 17 | SHA-pin all GitHub Actions, generate SBOM | T-09 |
| 18 | Move in-memory token revocation to Redis (cluster-wide logout) | [`authService.ts:L130-L137`](../backend/src/services/authService.ts) |
| 19 | Service-type anonymization for cost analysis prompts | T-05 |
| 20 | Key rotation runbook | T-02, T-12 |
| 21 | DNA model removal decision (deprecated feature, schema still present) | [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) Deprecated |
| 22 | Audit-log review cadence (weekly for solo, daily once headcount > 1) | T-02 |

### 6.4 GA / production

| # | Item |
|---|---|
| 23 | Semi-annual third-party HIPAA assessment |
| 24 | Quarterly DR tabletop exercise |
| 25 | Application-level integrity signing (HMAC over audit_log records) — if auditor requests |
| 26 | SOC 2 program kickoff |

### 6.5 Deferred design items (acknowledged risk)

These are tracked but NOT scheduled — they require a design pass, not a fix:

- **Service-type anonymization in cost analysis** (T-05 follow-up): needs a curated medical taxonomy.
- **Provider consent feature gaps** (`canViewInsurance` / `canViewDna` / `canEditData` / `SUSPENDED` / `EXPIRED`): schema-present but unimplemented features. Decision needed: implement or remove.
- **Signed-URL session/IP binding**: GCS limitation; would require a proxy-download endpoint.

---

## 7. Review Schedule

| Trigger | Cadence |
|---|---|
| Time-based | Quarterly. Next review: **2026-07-25**. |
| Critical / High security finding opens | Within 7 days of finding |
| Schema migration touches PHI table | Within 7 days |
| New external integration with PHI scope | Pre-launch |
| Vendor BAA breach notification | Within 72 hours |
| Workforce change (first hire) | Pre-onboarding |
| Pre-beta launch | Required gate |
| Post-incident | Within 14 days of incident closure |

---

## 8. Document Control

| Field | Value |
|---|---|
| Document | RISK_ASSESSMENT.md |
| Version | 1.0 |
| Status | Draft (initial) |
| Generated | 2026-04-25 |
| Author | OwnMyHealth founder/security lead `[CONFIRM: name + role for the formal record]` |
| Reviewer | `[CONFIRM: external HIPAA reviewer if engaged]` |
| Approved by | `[CONFIRM]` |
| Last reviewed | 2026-04-25 (initial) |
| Next scheduled review | 2026-07-25 |
| HIPAA citation satisfied | §164.308(a)(1)(ii)(A) Risk Analysis |
| Source-of-truth references | [`SECURITY_STATUS.md`](./SECURITY_STATUS.md), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md), [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) |

---

## Items requiring confirmation

The following claims in this document are unverified from inside the
repo and need operator confirmation before the next review:

1. Pre-beta status (no live external PHI / users)
2. GCP HIPAA BAA acknowledged in the prod-project console
3. SendGrid BAA execution date
4. Cloud SQL automated backup retention window
5. GCS object versioning enabled on the user-files bucket
6. Full-disk encryption on the development workstation
7. Author + reviewer + approver names for the formal record
