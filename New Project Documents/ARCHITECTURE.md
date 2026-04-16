# OwnMyHealth Architecture

**Last verified against codebase: 2026-04-16**

---

## System Overview

OwnMyHealth is a HIPAA-oriented, privacy-first health biomarker and insurance tracking platform. A React SPA (Vite build, served from a GCS bucket) communicates with an Express API running on Google Cloud Run. All PHI is encrypted at the application layer (AES-256-GCM with per-user derived keys) before being written to Cloud SQL PostgreSQL. The backend integrates with Anthropic Claude for AI guidance and document extraction, Google Document AI for OCR of scanned lab reports, Google Cloud Storage for uploaded files, and SendGrid for transactional email.

```
                            +------------------------+
                            |   Browser (React SPA)  |
                            |   Vite build on GCS    |
                            |   bucket: ownmyhealth- |
                            |   frontend             |
                            +-----------+------------+
                                        | HTTPS (JWT in HttpOnly cookie,
                                        |        X-CSRF-Token header)
                                        v
                            +------------------------+
                            |  Cloud Run (us-central1)|
                            |  ownmyhealth-backend    |
                            |  Express + Prisma       |
                            |  Node 20 Alpine         |
                            +----+-------+-------+---+
                                 |       |       |
                    Prisma/pg    |       |       |    HTTPS
                                 v       v       v
                    +---------------+  +------+ +--------------------+
                    | Cloud SQL     |  | GCS  | |  External Services |
                    | PostgreSQL    |  |bucket| |                    |
                    | RLS policies  |  | user |  | Anthropic Claude  |
                    | audit_logs    |  | files|  | Google Doc AI OCR |
                    +---------------+  +------+  | SendGrid email    |
                                                 +--------------------+
```

---

## Technology Stack

### Frontend
| Component | Technology |
|-----------|------------|
| Framework | React 18.3 |
| Build tool | Vite 7.3 |
| Language | TypeScript 5.5 |
| Styling | Tailwind CSS 3.4 + PostCSS |
| Charts | Recharts 3.5 (code-split as `charts` chunk) |
| PDF generation / display | pdfjs-dist 4, jspdf 4, html2canvas-pro (code-split as `pdf` chunk) |
| OCR (client fallback) | tesseract.js 5 (code-split as `ocr` chunk) |
| Icons | lucide-react |
| Testing | Vitest 4, @testing-library/react, jsdom |
| Static hosting | Google Cloud Storage (`ownmyhealth-frontend`) |

### Backend
| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 (Alpine, multi-stage Docker build) |
| Framework | Express 4.18 |
| Language | TypeScript 5.3 |
| ORM | Prisma 7.0 + `@prisma/adapter-pg` + `pg` 8.16 |
| Auth | JWT (`jsonwebtoken` 9) access+refresh, bcryptjs 2.4, HttpOnly cookies |
| Security headers | helmet 7.1 |
| CORS | `cors` 2.8 with origin allowlist + credentials |
| Rate limiting | express-rate-limit 7 (6 named limiters) |
| Validation | Zod 3.22 |
| File uploads | multer 2 (memory storage, 10 MB cap) |
| PDF parsing | pdf-parse 1.1 |
| Logging | morgan + custom `utils/logger.ts` |
| Cookies / CSRF | cookie-parser 1.4 + custom double-submit CSRF |
| Testing | Vitest 4, supertest 7 |
| Container | Node 20 Alpine, multi-stage, non-root `nodejs` user |

### Database
| Component | Technology |
|-----------|------------|
| Engine | PostgreSQL (Google Cloud SQL) |
| Access | Prisma Client (generated to `backend/generated/prisma`) |
| Security | Row-Level Security via `app.current_user_id` session var; admin bypass via `app.is_admin` |
| Migrations | Prisma Migrate (`npx prisma migrate deploy` in container start command) |
| Encryption at rest | AES-256-GCM ciphertext in `*_encrypted` columns |

### External Services
| Service | Provider | Purpose |
|---------|----------|---------|
| AI / LLM | Anthropic Claude (`@anthropic-ai/sdk` 0.71 + direct `fetch` for streaming-lite use) | Biomarker educational guidance, insurance SBC extraction, expense cost analysis, document extraction |
| File storage | Google Cloud Storage (`@google-cloud/storage` 7.18) | Lab report PDFs, SBC documents, user files |
| OCR | Google Document AI (`@google-cloud/documentai` 9.5) | Text extraction from scanned/image-based lab PDFs |
| Email | SendGrid (`@sendgrid/mail` 8.1) | Email verification, password reset, transactional notifications |

---

## Data Flow Diagrams

### Authentication Flow
```
Register:
  Client -> POST /api/v1/auth/register
    -> validate (Zod)
    -> bcrypt hash password (12 rounds)
    -> insert User (isActive=true, emailVerified=false)
    -> generate email verification token -> SendGrid
    -> 200 OK

Verify Email:
  Click link -> GET /api/v1/auth/verify-email?token=...
    -> lookup by emailVerificationToken -> mark verified

Login:
  Client -> POST /api/v1/auth/login (strictAuthLimiter: 5/15min, skipSuccessful)
    -> validate -> bcrypt compare -> check lockout (5 failures -> 30 min)
    -> issue access JWT (15 min) + refresh JWT (7 days)
    -> insert Session row (refresh token hash, ip, userAgent, expiresAt)
    -> Set-Cookie: accessToken (HttpOnly, Secure, SameSite) + refreshToken
    -> Issue CSRF token (double-submit cookie + X-CSRF-Token header)

Subsequent request:
  Client attaches cookie + X-CSRF-Token
    -> helmet -> cors -> cookieParser -> csrfProtection
    -> standardLimiter -> authenticate (verify JWT, load user)
    -> route handler executes withRLSContext(userId, ...)

Refresh:
  Client -> POST /api/v1/auth/refresh (cookie only)
    -> verify refresh JWT -> verify Session row -> issue new access token

Logout:
  /logout deletes current Session row; /logout-all deletes all Session rows for user.
```

### PDF Upload Flow
```
Client -> POST /api/v1/upload/lab-report (multipart/form-data)
  -> authenticate -> uploadLimiter (20/hr)
  -> multer memoryStorage (10 MB max, pdf mime whitelist)
  -> pdfParser.extractText(buffer)
      |
      +-- text extracted? --YES--> claudeExtraction.extractBiomarkers(text)
      |
      +-- empty/scanned? ---------> ocrService (Google Document AI)
                                     -> claudeExtraction.extractBiomarkers(ocrText)
  -> encryption.encrypt(biomarker.value, userKey) for each result
  -> storageService.upload(buffer) -> GCS object with storageKey
  -> prisma.userFile.create + prisma.biomarker.createMany (within withRLSTransaction)
  -> auditLog: PHI_ACCESS (external Claude call), CREATE (biomarkers, file)
  -> 200 { fileId, biomarkers, extractionConfidence }
```

### Provider-Patient Access Flow
```
Provider -> POST /api/v1/provider/request-access { patientEmail, permissions }
  -> requireRole(PROVIDER|ADMIN)
  -> resolve patient by email -> ProviderPatient row (status=PENDING)
  -> email patient (SendGrid)

Patient -> GET /api/v1/patient/provider-requests
  -> requireRole(PATIENT) -> list PENDING rows where patientId = me

Patient -> PATCH /api/v1/patient/provider-access/:id
  -> body: { status: ACTIVE, canViewBiomarkers, canViewInsurance, canViewDna,
             canViewHealthNeeds, canEditData, consentExpiresAt }
  -> update ProviderPatient, set consentGrantedAt
  -> auditLog: PERMISSION_CHANGE

Provider -> GET /api/v1/provider/patients/:patientId/biomarkers
  -> requireRole(PROVIDER|ADMIN)
  -> load ProviderPatient; assert status=ACTIVE and canViewBiomarkers
  -> assert consentExpiresAt is null or in future
  -> withRLSContext(patientId) { prisma.biomarker.findMany(...) }
  -> decrypt with patient's key -> return scoped projection
  -> auditLog: PHI_ACCESS (actorId=provider, resourceUserId=patient)

Revoke:
  Patient -> DELETE /api/v1/patient/provider-access/:id
    -> set status=REVOKED; subsequent provider queries fail the status check.
```

### AI Guidance Flow
```
Client -> POST /api/v1/biomarkers/:id/guidance
  -> authenticate -> aiLimiter (10/hr per userId) -> blockDemoAI
  -> validate uuid + body (name, value, unit, range, status, short history)
  -> NOTE: request body carries only minimal, user-visible biomarker fields
           (no name/DOB/address). Values are PHI but already user's own.
  -> Build prompt (educational disclaimers baked in, <200 word cap)
  -> fetch https://api.anthropic.com/v1/messages
       model: claude-haiku-4-5-20251001, max_tokens: 600, 30s timeout (AbortController)
  -> on success: trackAIUsage(inputTokens, outputTokens, userId)
  -> auditLog: PHI_ACCESS (externalApiCall=true, provider=anthropic,
               phiDisclosedFields=[name, value, unit, normalRange, status, history])
  -> return { guidance } to client
```

---

## Database Schema

Twenty Prisma models are defined in `backend/prisma/schema.prisma`. PHI columns are stored as `*Encrypted` strings (AES-256-GCM ciphertext) and marked below with **✱**.

### Identity & Access
| Model | Purpose |
|-------|---------|
| `User` | Account root. Encrypts **✱** firstName, lastName, dateOfBirth, phone, address. Holds role (PATIENT/PROVIDER/ADMIN), email verification state, lockout counters. |
| `Session` | Refresh-token-backed session rows; unique token, expiresAt, ip, userAgent. Cascades on user delete. |
| `UserEncryptionKey` | Per-user envelope keys for PHI. Tracks keyType, version, rotation. Used by `userEncryption.ts`. |
| `ProviderPatient` | Provider/patient relationship with granular boolean consents (canViewBiomarkers, canViewInsurance, canViewDna, canViewHealthNeeds, canEditData), status, consentGrantedAt/expiresAt, **✱** notes. |

### Biomarkers & Files
| Model | Purpose |
|-------|---------|
| `Biomarker` | A single measurement. Encrypts **✱** value, notes. Stores category, unit, normal range, measurementDate, sourceType, extraction confidence, userFile link. |
| `BiomarkerHistory` | Historical time-series entries for a Biomarker; encrypts **✱** value. |
| `UserFile` | Uploaded files (lab reports, SBCs). Stores storageKey (GCS), labName, labDate, biomarkersExtracted, extractionConfidence. |

### Insurance
| Model | Purpose |
|-------|---------|
| `InsurancePlan` | Benefits-rich plan record. Encrypts **✱** memberId, groupId. Holds deductibles, OOP maxes, copay/coinsurance for ~30 service categories, Rx tiers, vision/dental/DME/home health/hospice fields, JSON lists (preventiveServices, exclusions, priorAuth, servicesWithLimits), SBC extraction confidence. |
| `InsuranceBenefit` | Per-service benefit row (in-network/out-of-network copay, coinsurance, deductible-applies, limitations, preAuthRequired). |

### Health Goals & Needs
| Model | Purpose |
|-------|---------|
| `HealthGoal` | Goal record with encrypted **✱** description. Category, target/current/start values, direction, status, progress, milestones, reminderFrequency. |
| `GoalProgressHistory` | Goal progress snapshots with encrypted **✱** note. |
| `HealthNeed` | Tracked need (condition/action/service/followup). Encrypts **✱** description. Urgency, status, relatedBiomarkerIds[]. |

### Expenses & Cost Analysis
| Model | Purpose |
|-------|---------|
| `ExpenseProjection` | Expected annual costs. Encrypts **✱** serviceType, estimatedCost, notes. |
| `ExpenseActual` | Real claim/expense rows. Encrypts **✱** serviceType, providerName, billedAmount, insurancePaid, patientPaid, appliedToDeductible, appliedToOop, notes. |
| `CostAnalysis` | Claude-generated analysis snapshot. Stores claudeResponse (text), encrypted **✱** totalProjectedOop, projectedExpensesSnapshot. |

### Audit & System
| Model | Purpose |
|-------|---------|
| `AuditLog` | HIPAA audit trail. Encrypts **✱** previousValue, newValue. Holds actorType, action enum (LOGIN, PHI_ACCESS, PHI_EXPORT, PHI_DECRYPT, CREATE/UPDATE/DELETE, PERMISSION_CHANGE, KEY_ROTATION, etc.), resourceType, resourceId, ipAddress, userAgent, success/errorMessage. 7-year retention via `startAuditCleanup` scheduler. |
| `SystemConfig` | Admin-managed key/value config. |

### Deprecated (still in schema, not wired into UI)
| Model | Status |
|-------|--------|
| `DNAData` | **Deprecated** — pending removal. Was 23andMe-style upload metadata. |
| `DNAVariant` | **Deprecated** — encrypts **✱** genotype. |
| `GeneticTrait` | **Deprecated** — encrypts **✱** description, recommendations. |

### Key Relationships
- `User` 1..N everything user-owned (`Biomarker`, `InsurancePlan`, `HealthGoal`, `HealthNeed`, `UserFile`, `ExpenseProjection`, `ExpenseActual`, `CostAnalysis`, `Session`, `UserEncryptionKey`, `AuditLog?`). All cascade on delete.
- `User` <-> `User` via `ProviderPatient` (self-relation: `providerId`, `patientId`).
- `InsurancePlan` 1..N `InsuranceBenefit`, `ExpenseProjection`, `ExpenseActual`, `CostAnalysis`.
- `Biomarker` 1..N `BiomarkerHistory`; `Biomarker` N..1 `UserFile?`.
- `HealthGoal` 1..N `GoalProgressHistory`; `HealthGoal` N..1 `Biomarker?` (via scalar `relatedBiomarkerId`).

---

## Security Architecture

### Encryption Layers
| Layer | Data | Method | Key source |
|-------|------|--------|------------|
| At rest (application) | All PHI columns (`*Encrypted`) | AES-256-GCM | Per-user derived key (PBKDF2-SHA512 over `PHI_ENCRYPTION_KEY` + user salt), envelope-wrapped in `UserEncryptionKey` |
| At rest (database) | Cloud SQL volumes | Google-managed encryption | GCP KMS (platform) |
| In transit (client<->API) | All HTTP traffic | TLS 1.2+ | Cloud Run managed certificate |
| In transit (API<->DB) | Prisma/pg connections | TLS | Cloud SQL connector / SSL |
| In transit (API<->GCS/Claude/SendGrid) | HTTPS | TLS | External managed |
| Passwords | `User.passwordHash` | bcrypt (12 rounds) | n/a (one-way) |
| Tokens at rest | `Session.token` | JWT signed with `JWT_REFRESH_SECRET` | HMAC-SHA256 |

### Authentication
- **JWT + HttpOnly cookies.** Access token (15 min, `JWT_ACCESS_SECRET`) and refresh token (7 days, `JWT_REFRESH_SECRET`) issued on login and set as `Secure`, `HttpOnly`, `SameSite=lax` (or `none` for cross-domain) cookies. Secrets must be >=32 chars in production.
- **Refresh rotation.** `/auth/refresh` validates the refresh JWT against a `Session` row; `/logout` and `/logout-all` delete Session rows.
- **CSRF double-submit cookie.** `csrfProtection` middleware requires the client to echo the cookie value in the `X-CSRF-Token` header for state-changing methods. Exposed via `/api/v1/csrf-token`.
- **Lockout.** 5 failed logins -> `lockedUntil = now + 30 min` (configurable: `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES`).
- **Strict login limiter.** 5 attempts / 15 min, keyed by `email:ip`, `skipSuccessfulRequests`.
- **Row-Level Security.** Every request-scoped query runs inside `withRLSContext(userId, fn)` / `withRLSTransaction(userId, fn)` in `services/database.ts`, which sets `app.current_user_id`. PostgreSQL policies (migration `20260107_add_rls_policies`) filter all user-scoped tables. Admin queries use `withRLSContext(null, ...)` which sets `app.is_admin = true`.
- **Demo protection.** `blockDemoAI` and `demoProtection` middleware block the demo account from expensive or destructive operations; demo mode is hard-blocked in production by `config/index.ts`.

### Audit Logging
- Table: `audit_logs` (model `AuditLog`).
- Encrypted snapshots of previous/new values (**✱**).
- Logged actions include LOGIN, LOGIN_FAILED, LOGOUT, PASSWORD_CHANGE, PHI_ACCESS, PHI_EXPORT, PHI_DECRYPT, CREATE, UPDATE, DELETE, PERMISSION_CHANGE, KEY_ROTATION.
- Captures ipAddress (via `req.ip` after `app.set('trust proxy', 1)`), userAgent, sessionId, success flag, errorMessage, arbitrary metadata.
- External Claude calls log `externalApiCall: true` with the list of PHI fields disclosed.
- Retention: 7 years. Enforced by `startAuditCleanup(prisma)` scheduler in `services/auditLog.ts`, launched during `startServer()` and stopped on SIGTERM/SIGINT.

---

## Infrastructure Details

### Cloud Run Configuration
| Setting | Value |
|---------|-------|
| Service | `ownmyhealth-backend` |
| Project | `ownmyhealth-prod` |
| Region | `us-central1` |
| Platform | `managed` |
| Container | Node 20 Alpine, multi-stage build, non-root `nodejs` (uid 1001) |
| Listening port | `PORT` env (default 3001) |
| Start command | `npx prisma migrate deploy && node dist/app.js` |
| Healthcheck | `GET /health` (Docker `HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3`) |
| CPU / memory / concurrency / scaling | Configured via Cloud Run — verify in GCP console. `deploy.yml` uses default `gcloud run deploy` (no explicit `--cpu`, `--memory`, `--concurrency`, or `--min/max-instances` flags). |
| Ingress | HTTPS via Cloud Run managed cert; public URL mapped to `api.ownmyhealth.io` |
| Trust proxy | `app.set('trust proxy', 1)` for accurate `req.ip` behind Cloud Run's load balancer |

### Cloud SQL Configuration
| Setting | Value |
|---------|-------|
| Engine | PostgreSQL |
| Project | `ownmyhealth-prod` |
| Region | Configured via GCP — verify in GCP console (deploy.yml does not provision the instance) |
| Size / tier | Configured via GCP — verify in GCP console |
| Connection | `DATABASE_URL` (required in prod); Prisma `@prisma/adapter-pg` + `pg` driver |
| Migration strategy | `prisma migrate deploy` runs at container start |

### Frontend Hosting
| Setting | Value |
|---------|-------|
| Bucket | `gs://ownmyhealth-frontend` |
| Upload | `gsutil -m cp -r dist/* gs://...` in `deploy.yml` |
| Cache policy | `Cache-Control: no-cache, no-store, must-revalidate` on `index.html` |
| Build env | `VITE_API_URL=https://api.ownmyhealth.io/api/v1` |

### CI/CD Pipeline
- `.github/workflows/ci.yml` — Runs on PRs and pushes to main/master/develop/`claude/**`. Lints, tests (Vitest), builds frontend and backend, runs `npm audit --audit-level=high`.
- `.github/workflows/deploy.yml` — Runs on push to master/main. Two parallel jobs:
  1. **deploy-backend**: docker build in `backend/`, push to `us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:<sha>` and `:latest`, `gcloud run deploy`.
  2. **deploy-frontend**: `npm ci && npm run build`, wipe bucket, upload `dist/`, set cache headers on `index.html`.

### Cost Breakdown
Unknown — not derivable from the codebase. Cloud Run, Cloud SQL, GCS, Document AI, Claude API, and SendGrid charges depend on runtime sizing, traffic, and token volume, none of which are pinned in `deploy.yml` or config. Verify in the GCP billing console and provider dashboards.

---

## Middleware Stack (Request Processing Order)

From `backend/src/app.ts`:

1. `app.set('trust proxy', 1)` — correct `req.ip` behind Cloud Run load balancer (required for rate limiting and audit IPs).
2. **Helmet** — HTTP security headers; CSP `default-src 'self'`, `img-src 'self' data: https:`; `crossOriginResourcePolicy` relaxed when `COOKIE_DOMAIN` is set.
3. **CORS** — dynamic origin allowlist with `credentials: true`; rejects localhost in production; explicit `OPTIONS *` preflight handler; exposes `X-CSRF-Token`.
4. **cookie-parser** — parses cookies so CSRF and auth middleware can read them.
5. **CSRF protection** (`csrfProtection`) — double-submit cookie; skipped only if `NODE_ENV=development && DISABLE_CSRF=true`.
6. **Rate limiting** (`standardLimiter`) — global 100 req / 15 min by IP.
7. **Morgan** — `dev` logger in development, `combined` in production.
8. **Body parsers** — `express.json({ limit: '10mb' })` and `express.urlencoded({ extended: true, limit: '10mb' })`.
9. **requireJsonContentType** — rejects non-JSON bodies on JSON endpoints.
10. **Routes** — mounted at `/api/v1` via `routes/index.ts`. Per-route middleware adds `authenticate`, `requireRole(...)`, `validate(schema)`, and endpoint-specific limiters (`authLimiter`, `strictAuthLimiter`, `uploadLimiter`, `sensitiveLimiter`, `aiLimiter`, `bulkOperationLimiter`) plus `blockDemoAI` where applicable.
11. **Meta endpoints** — `/`, `/health` (DB connectivity probe, unauth), `/api/health/db` (legacy), `/api/v1/csrf-token`.
12. **404 handler** (`notFoundHandler`).
13. **Error handler** (`errorHandler`) — centralized, must be last; sanitizes error details in production.

Background schedulers started in `startServer()`:
- `initializeDemoUser()` (non-production only)
- `startSessionCleanup()` — expires stale `Session` rows.
- `startAuditCleanup(prisma)` — enforces 7-year audit retention.

Graceful shutdown on `SIGTERM`/`SIGINT` stops schedulers, closes the HTTP server, and calls `disconnectDatabase()`.

---

## Role-Based Access Control

Enforced by `middleware/rbac.ts` (`requireRole(...)`) on provider and admin routes.

| Role | Level | Capabilities |
|------|-------|--------------|
| `PATIENT` | 1 | Full CRUD on own Biomarker/BiomarkerHistory, InsurancePlan/Benefit, HealthGoal/GoalProgressHistory, HealthNeed, UserFile, ExpenseProjection/Actual, CostAnalysis. Manage own ProviderPatient consents (approve, scope permissions, revoke). Request AI guidance. Export own data; delete own account (`/settings`). |
| `PROVIDER` | 2 | Everything a PATIENT can do for themselves, plus scoped read access to consented patients via `/provider/*` routes. Access is gated by `ProviderPatient.status=ACTIVE`, per-field consent booleans, and `consentExpiresAt`. Cannot write unless `canEditData=true`. |
| `ADMIN` | 3 | User management (`/admin` routes: list, suspend, delete users), audit log viewer, system stats. Can bypass RLS via `withRLSContext(null, ...)` which sets `app.is_admin=true`. |

---

## API Surface Summary

12 resource route files mounted under `/api/v1` (plus the `routes/index.ts` meta router):

| Mount | File | Endpoints |
|-------|------|-----------|
| `/auth` | `authRoutes.ts` | register, login, refresh, demo, verify-email, resend-verification, forgot-password, reset-password, logout, logout-all, me, change-password |
| `/biomarkers` | `biomarkerRoutes.ts` | list, summary, categories, get, history, create, batch, update, delete, guidance (AI) |
| `/insurance` | `insuranceRoutes.ts` | plans list, plan get, plan create, plan update, plan delete, set primary, benefits list, benefits update, sbc upload, sbc replace |
| `/expenses` | `expenseRoutes.ts` | projections list, projection create, projection update, projection delete, actual create, actuals list |
| `/health-needs` | `healthNeedsRoutes.ts` | list, analyze (AI), get, create, update, delete |
| `/health-goals` | `healthGoalsRoutes.ts` | summary, suggestions (AI), list, get, create, update, patch progress, delete |
| `/provider` | `providerRoutes.ts` | list patients, request access, patient biomarkers, patient insurance, patient health needs, revoke relationship |
| `/patient` | `patientRoutes.ts` | list provider requests, list active providers, request by email, approve/deny, update permissions, renew, revoke |
| `/admin` | `adminRoutes.ts` | users list, user get, create user, update user, delete user, delete user data, audit logs list, audit log update, system stats, health |
| `/upload` | `uploadRoutes.ts` | lab-report, sbc, generic |
| `/files` | `fileRoutes.ts` | list, get, download (signed URL), delete |
| `/settings` | `settingsRoutes.ts` | export, delete account, delete all data |

Backend services (14, excluding tests, `data/`, and `index.ts`): `authService`, `database`, `encryption`, `userEncryption`, `auditLog`, `emailService`, `storageService`, `ocrService`, `pdfParser`, `biomarkerExtractor`, `biomarkerPatterns`, `claudeExtraction`, `sbcExtraction`, `aiCostTracker`.

Middleware (7 non-test files + barrel `index.ts`): `auth`, `csrf`, `demoProtection`, `errorHandler`, `rateLimiter`, `rbac`, `validation`.

---

## File Structure (top-level, 2 levels deep)

```
OwnMyHealth/
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── prisma/           (schema.prisma, migrations/)
│   ├── prisma.config.ts
│   ├── src/
│   │   ├── app.ts
│   │   ├── config/       (index.ts)
│   │   ├── controllers/  (~10 files)
│   │   ├── middleware/   (auth, csrf, rbac, rateLimiter, validation, demoProtection, errorHandler)
│   │   ├── routes/       (13 files)
│   │   ├── services/     (14 files)
│   │   ├── types/
│   │   └── utils/        (logger, helpers)
│   └── generated/        (prisma client output)
├── src/                   (frontend React app)
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/       (analytics, auth, biomarkers, common, dashboard,
│   │                      files, insurance, settings, trends, upload)
│   ├── contexts/         (AuthContext, Theme)
│   ├── services/         (api/, uploadUtils.ts)
│   ├── hooks/
│   ├── types/
│   ├── data/             (sample data, nav config)
│   └── __tests__/
├── e2e/                   (end-to-end tests)
├── scripts/               (ops scripts)
├── docs/                  (project docs)
├── prompts/               (Claude Code prompts, incl. 16-architecture-doc.md)
├── New Project Documents/ (generated artifacts incl. this file)
├── .github/workflows/    (ci.yml, deploy.yml)
├── vite.config.ts
├── vitest.config.ts
├── tailwind.config.js
├── tsconfig.json (+ app/node variants)
├── eslint.config.js
├── postcss.config.js
├── package.json           (frontend workspace)
├── CLAUDE.md              (agent context)
├── README.md
├── DEPLOY.md
└── index.html
```
