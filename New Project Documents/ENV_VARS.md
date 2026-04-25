---
tags:
  - reference
  - environment
  - config
  - secrets
type: generated-doc
priority: 1
updated: 2026-04-24
source-of-truth: backend/src/config/index.ts
---

# ENV_VARS.md — Environment Variable Reference

## Purpose / how to read this doc

This is the **single-source-of-truth reference for every environment variable** read by the OwnMyHealth backend (Express + Prisma on Cloud Run), the Vite-built frontend, and the GitHub Actions pipelines. A reader with only this document must be able to answer: *which vars are required to boot? which are secrets? where are they stored in prod? which file:line reads each?*

The master table below is the spine — one row per var. The primary source of truth is `backend/src/config/index.ts`; anything used in code but absent from that file is called out under [Drift findings](#drift-findings). The startup validation snippet quotes the exact throw paths. The per-environment diff covers local vs staging vs prod. The rotation-policy table covers who owns rotation of each secret.

Throughout this doc, citations use `file:line` or `file:Lstart-Lend` for ranges. ISO dates only (`YYYY-MM-DD`).

---

## Master table

Columns: **Name**, **Required?**, **Default**, **Format**, **Consumer(s)**, **Secret?**, **Where stored (prod)**, **Notes**.

| Name | Required? | Default | Format | Consumer(s) (file:line) | Secret? | Where stored (prod) | Notes |
|---|---|---|---|---|---|---|---|
| `NODE_ENV` | optional (but controls prod-only throws) | `development` | enum: `development` \| `staging` \| `production` \| `test` | `backend/src/config/index.ts:34`, `backend/src/config/index.ts:35`, `backend/src/config/index.ts:40`, `backend/src/services/database.ts:122`, `backend/src/services/fhir/mockFhirServer.ts:195` | no | Cloud Run env | Set to `production` on the prod Cloud Run service and `staging` on `ownmyhealth-backend-staging`. Production unset → CORS hardening, demo-account block, CORS localhost check, and BAA-prod throw all disengage. |
| `PORT` | optional | `3001` | int | `backend/src/config/index.ts:41`, `backend/Dockerfile:46`, `backend/Dockerfile:49` | no | Cloud Run injects | Cloud Run overrides with its own port (see `railway.toml:10` start command). |
| `DATABASE_URL` | **required** in prod/staging (throw at `backend/src/config/index.ts:L266-L277`); required at DB init (`backend/src/services/database.ts:L60-L64`) | none | url: `postgresql://user:pass@host:port/db` or `prisma+postgres://...` | `backend/src/services/database.ts:60`, `backend/src/services/database.ts:L68-L84`, `backend/src/services/rls.test.ts:27` | **yes** | GCP Secret Manager → Cloud Run env | Prod connects via Cloud SQL Auth Proxy; staging uses a separate DB. Parsed as Prisma-Postgres-URL when prefixed `prisma+postgres://` (local dev). |
| `DATABASE_POOL_SIZE` | optional | `10` | int | `backend/src/services/database.ts:110` | no | Cloud Run env | Raise only after switching the in-memory rate limiter to a shared store (`backend/src/middleware/rateLimiter.ts` — see `.github/workflows/deploy.yml:62-65`). |
| `JWT_ACCESS_SECRET` | **required everywhere** — `requireEnv` throw at `backend/src/config/index.ts:L18-L28`, re-validated at `backend/src/config/index.ts:L195-L215` | none (no fallback) | secret:256-bit, ≥32 chars, not in `BLOCKED_JWT_VALUES` | `backend/src/config/index.ts:61`, `backend/src/middleware/auth.ts:83`, `backend/src/middleware/auth.ts:129`, `backend/src/middleware/auth.ts:178`, `backend/src/middleware/auth.ts:209`, `backend/src/middleware/auth.ts:219` | **yes** | GCP Secret Manager → Cloud Run env | Generate per env: `openssl rand -base64 32`. C-3: no fallback in any environment. Blocked placeholder list at `backend/src/config/index.ts:L186-L193`. |
| `JWT_ACCESS_EXPIRES_SECONDS` | optional | `900` (15 min) | int (seconds) | `backend/src/config/index.ts:62`, `backend/src/middleware/auth.ts:210` | no | Cloud Run env | Must be integer seconds, not a string like `15m`. |
| `JWT_REFRESH_SECRET` | **required everywhere** — `requireEnv` at `backend/src/config/index.ts:65`, re-validated at `backend/src/config/index.ts:L201-L222` | none (no fallback) | secret:256-bit, ≥32 chars, not in `BLOCKED_JWT_VALUES` | `backend/src/config/index.ts:65` (consumed via `authService.ts` refresh flow) | **yes** | GCP Secret Manager → Cloud Run env | Generate per env: `openssl rand -base64 32`. Never reuse the access secret. |
| `JWT_REFRESH_EXPIRES_SECONDS` | optional | `604800` (7 days) | int (seconds) | `backend/src/config/index.ts:66` | no | Cloud Run env | Integer seconds only. |
| `PHI_ENCRYPTION_KEY` | **required** in prod/staging (throw at `backend/src/config/index.ts:L269-L308`); runtime requirement in `backend/src/services/encryption.ts:160` | none (prod/staging); dev fallback in encryption service | hex:64 (256 bits); hex chars only; not in `insecureKeys` blocklist | `backend/src/config/index.ts:280`, `backend/src/services/encryption.ts:160`, `backend/src/services/rls.test.ts:27` | **yes — PHI** | GCP Secret Manager → Cloud Run env | Generate: `openssl rand -hex 32`. **Losing this key makes all PHI unrecoverable.** Three explicit insecure keys rejected at `backend/src/config/index.ts:L297-L308`. |
| `AUDIT_LOG_SALT` | **required everywhere** — hard throw at `backend/src/config/index.ts:L228-L238` | none; fails boot if missing or < 16 chars | secret, ≥16 chars | `backend/src/config/index.ts:54`, `backend/src/services/auditLog.ts:125` | **yes — PHI** | GCP Secret Manager → Cloud Run env | C-8: moved out of `system_config` table so boot no longer requires admin-bypass DB access. For existing prod, extract the historic salt from `system_config.audit_encryption_salt` (decrypt with `PHI_ENCRYPTION_KEY`) before rotating. Rotating silently breaks historic audit-log decryption. |
| `RLS_ENFORCEMENT` | optional | unset (warn-only) | enum: `strict` \| (anything else) | `backend/src/services/database.ts:252` | no | Cloud Run env | Set to `strict` after the `omh_app` NOBYPASSRLS role cutover. Strict mode calls `process.exit(1)` at `backend/src/services/database.ts:L259-L263` when the DB role still has BYPASSRLS. |
| `MAX_LOGIN_ATTEMPTS` | optional | `5` | int | `backend/src/config/index.ts:90` | no | Cloud Run env | Feeds lockout logic in authService. |
| `LOCKOUT_DURATION_MINUTES` | optional | `30` | int (minutes) | `backend/src/config/index.ts:91` | no | Cloud Run env | Converted to ms by multiplying × 60_000. |
| `BCRYPT_ROUNDS` | optional | `13` (code); `12` in example files | int | `backend/src/config/index.ts:93` | no | Cloud Run env | Code default is 13 (HIPAA recommendation 2024+); example files still show `12`. Not a bug — higher default is always safe. |
| `CORS_ORIGIN` | **required** in production (throw at `backend/src/app.ts:L81-L88`); optional elsewhere | dev: 5-port localhost array (`backend/src/config/index.ts:L98-L104`) | comma-separated URLs | `backend/src/config/index.ts:98`, `backend/src/app.ts:79`, `backend/src/config/index.ts:313` | no | Cloud Run env | Prod is unioned with `HARDCODED_PRODUCTION_ORIGINS` at `backend/src/app.ts:L64-L67` (`https://app.ownmyhealth.io`, `https://ownmyhealth.io`). Prod refuses localhost (`backend/src/app.ts:L86-L88`). Staging value: `https://staging.ownmyhealth.io` (`backend/.env.staging.example:53`). |
| `COOKIE_DOMAIN` | optional | `undefined` | string (e.g. `.ownmyhealth.io`) | `backend/src/config/index.ts:80`, `backend/src/config/index.ts:81`, `backend/src/app.ts:123`, `backend/src/middleware/csrf.ts:51`, `backend/src/middleware/csrf.ts:52` | no | Cloud Run env | Required for cross-subdomain cookies (`app.ownmyhealth.io` ↔ `api.ownmyhealth.io`). Presence auto-flips SameSite default to `none` (`backend/src/config/index.ts:L79-L80`). |
| `COOKIE_SAME_SITE` | optional | `lax` (dev); `none` if `COOKIE_DOMAIN` set | enum: `strict` \| `lax` \| `none` | `backend/src/config/index.ts:79`, `backend/src/middleware/csrf.ts:45`, `backend/src/controllers/authController.ts:81` | no | Cloud Run env | Must be `none` + `Secure` for cross-domain. |
| `RATE_LIMIT_WINDOW_MS` | optional | `900000` (15 min) | int (ms) | `backend/src/config/index.ts:110`, `backend/src/middleware/rateLimiter.ts:17` | no | Cloud Run env | Rate-limiter is in-memory per-instance; diluted by Cloud Run fan-out (max-instances=3 pin at `.github/workflows/deploy.yml:72`). |
| `RATE_LIMIT_MAX_REQUESTS` | optional | `100` | int | `backend/src/config/index.ts:111`, `backend/src/middleware/rateLimiter.ts:18` | no | Cloud Run env | Per-instance, per-window. |
| `DEMO_ACCOUNT_ENABLED` | optional | unset (→ false) | bool (`"true"` / anything else) | `backend/src/config/index.ts:117`, `backend/src/config/index.ts:319` | no | Cloud Run env (staging only) | Prod boot refuses `true` (`backend/src/config/index.ts:L319-L325`). Staging sets it true (`backend/.env.staging.example:86`). |
| `DEMO_EMAIL` | optional | `''` | email | `backend/src/config/index.ts:118`, `backend/src/middleware/demoProtection.ts:34`, `backend/src/middleware/demoProtection.ts:35` | no | Cloud Run env (staging only) | Empty string disables the demo-user predicate (safe-by-default). |
| `DEMO_PASSWORD` | optional | `''` | string | `backend/src/config/index.ts:119` | **yes** (credential) | Cloud Run env (staging only) | Rotate per-environment. `.env.example` ships `Demo123!` placeholder. |
| `DISABLE_CSRF` | optional | unset | bool (`"true"` / else) | `backend/src/app.ts:211`, `backend/src/middleware/csrf.ts:151` | no | never in prod | Only honored when `config.isDevelopment` is true. Prod ignores it by construction. |
| `SENDGRID_API_KEY` | optional (warn at `backend/src/config/index.ts:L332-L334` if unset in prod/staging) | `''` | `SG.xxx` token | `backend/src/config/index.ts:124`, `backend/src/config/index.ts:125` (→ `backend/src/services/emailService.ts:43`) | **yes** | GCP Secret Manager → Cloud Run env | Presence turns on `config.email.enabled` (`backend/src/config/index.ts:124`). Free tier = 100/day; prod uses paid plan. |
| `SENDGRID_SANDBOX_MODE` | optional | `false` in dev/prod; `true` auto-enabled when `NODE_ENV=staging` (`backend/src/config/index.ts:L132-L133`) | bool | `backend/src/config/index.ts:133` | no | Cloud Run env (staging) | SendGrid validates payloads but never delivers. Staging always sandbox-mode, independent of the env var. |
| `EMAIL_FROM` | optional | `noreply@ownmyhealth.com` | email | `backend/src/config/index.ts:126` | no | Cloud Run env | Must be a verified SendGrid sender identity. Prod example uses `noreply@ownmyhealth.io`. |
| `EMAIL_FROM_NAME` | optional | `OwnMyHealth` | string | `backend/src/config/index.ts:127` | no | Cloud Run env | Staging uses `OwnMyHealth (Staging)` (`backend/.env.staging.example:80`). |
| `FRONTEND_URL` | optional | `http://localhost:5173` | url | `backend/src/config/index.ts:128` | no | Cloud Run env | Used in email templates to build verification/reset links. Prod: `https://ownmyhealth.io`. Staging: `https://staging.ownmyhealth.io`. |
| `ANTHROPIC_API_KEY` | optional (warn at `backend/src/config/index.ts:L329-L331`) | `''` | API key | `backend/src/config/index.ts:146`, `backend/src/controllers/aiChatController.ts:60`, `backend/src/controllers/expenseController.ts:39`, `backend/src/services/claudeExtraction.ts:53`, `backend/src/services/claudeExtraction.ts:317`, `backend/src/services/sbcExtraction.ts:321`, `backend/src/services/sbcExtraction.ts:1071`, `backend/src/routes/biomarkerRoutes.ts:131` | **yes** | GCP Secret Manager → Cloud Run env | Prod boot throws (`backend/src/config/index.ts:L246-L251`) if this is set but `ANTHROPIC_BAA_ACTIVE ≠ "true"`. |
| `ANTHROPIC_BAA_ACTIVE` | conditional (required `true` in prod when `ANTHROPIC_API_KEY` set) | `false` | bool (`"true"` / else) | `backend/src/config/index.ts:150`, `backend/src/controllers/aiChatController.ts:134`, `backend/src/routes/biomarkerRoutes.ts:134`, `backend/src/routes/biomarkerRoutes.ts:136` | no | Cloud Run env | Asserts a signed Anthropic BAA is in effect. Runtime gate in claudeExtraction / sbcExtraction blocks Claude calls when false. Staging stays `false` on purpose — Claude is locked out there. |
| `GCP_PROJECT_ID` | optional (warn at `backend/src/config/index.ts:L335-L337`) | `''` | string (e.g. `ownmyhealth-prod`) | `backend/src/config/index.ts:139`, `backend/src/services/ocrService.ts:82`, `backend/src/services/ocrService.ts:114`, `backend/src/services/ocrService.ts:450`, `backend/src/services/storageService.ts:17` | no | Cloud Run env | GCS + Document AI SDKs also auto-detect from Cloud Run metadata; explicit set is still required for local dev. |
| `GCS_BUCKET_NAME` | optional | `ownmyhealth-user-files` | string | `backend/src/config/index.ts:138`, `backend/src/services/storageService.ts:20` | no | Cloud Run env | Staging uses `ownmyhealth-user-files-staging` (`backend/.env.staging.example:94`). |
| `GOOGLE_APPLICATION_CREDENTIALS` | optional | `''` | path to JSON file **or** JSON string (`{...}`) | `backend/src/config/index.ts:141`, `backend/src/services/ocrService.ts:89`, `backend/src/services/ocrService.ts:455` | **yes** (contains GCP SA private key) | Cloud Run metadata (implicit) | On Cloud Run, the service account is bound to the revision; this var is normally unset. `ocrService.ts:L91-L101` detects JSON-string form and parses inline. |
| `GCP_PROCESSOR_ID` | **required** to use Document AI OCR (runtime throw at `backend/src/services/ocrService.ts:L85-L87`) | none | string (Document AI processor ID) | `backend/src/services/ocrService.ts:85`, `backend/src/services/ocrService.ts:116`, `backend/src/services/ocrService.ts:452` | no | Cloud Run env | CLAUDE.md and the prompt call this `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` — see [Drift findings](#drift-findings). |
| `GCP_LOCATION` | optional | `us` | string (Document AI region) | `backend/src/services/ocrService.ts:115` | no | Cloud Run env | CLAUDE.md and the prompt call this `GOOGLE_DOCUMENT_AI_LOCATION` — see [Drift findings](#drift-findings). |
| `QUEST_FHIR_CLIENT_ID` | optional | `''` | string | `backend/src/config/index.ts:159` | **yes** | GCP Secret Manager → Cloud Run env | Empty disables the Quest SMART-on-FHIR feature (`/api/v1/fhir/*` endpoints return 503). |
| `QUEST_FHIR_CLIENT_SECRET` | optional | `''` | string | `backend/src/config/index.ts:160` | **yes** | GCP Secret Manager → Cloud Run env | Pairs with `QUEST_FHIR_CLIENT_ID`. |
| `QUEST_FHIR_BASE_URL` | optional | `https://api.questdiagnostics.com/fhir/r4` | url | `backend/src/config/index.ts:162` | no | Cloud Run env | Set to `http://localhost:3001/api/v1/mock-fhir/r4` to exercise locally against the dev-only mock server (`backend/src/services/fhir/mockFhirServer.ts`, mounted only when `config.isDevelopment`). |
| `QUEST_FHIR_REDIRECT_URI` | optional | `https://api.ownmyhealth.io/api/v1/fhir/callback` | url | `backend/src/config/index.ts:164` | no | Cloud Run env | Staging override: `https://api-staging.ownmyhealth.io/api/v1/fhir/callback`. |
| `QUEST_FHIR_SUCCESS_REDIRECT` | optional | `http://localhost:5173/settings?labConnected=quest` | url | `backend/src/config/index.ts:167` | no | Cloud Run env | Front-end landing page after successful OAuth. |
| `VITE_API_URL` | **build-time** (Vite inlines at build) | `http://localhost:3001/api/v1` | url | `src/services/api/client.ts:10`, `src/services/uploadUtils.ts:8`, `.github/workflows/ci.yml:40`, `.github/workflows/deploy.yml:206`, `.env.staging:5` | no | GitHub Actions env (build-time) | Prod CI sets `https://api.ownmyhealth.io/api/v1`. Staging build reads `.env.staging` via `--mode staging` (`deploy-staging.yml:113`). |
| `VITE_DEBUG` | **build-time**, optional | unset | bool (`"true"` / else) | `src/utils/logger.ts:17` | no | Dev only | Enables verbose client logs. Never set in prod builds. |
| `VITE_DEMO_MODE` | **build-time**, optional | unset | bool (`"true"` / else) | `src/hooks/useBiomarkerData.ts:18`, `src/App.tsx:258` | no | Dev only | Gated behind `import.meta.env.DEV` at `src/hooks/useBiomarkerData.ts:18` — cannot activate in a production build. |
| `VITE_SUPABASE_URL` | **build-time**, optional | unset | url | declared in `.env.example:32`, `.env.production.example:14` — no active code consumer | no | not used | See [Drift findings](#drift-findings) — documented but not imported anywhere under `src/`. |
| `VITE_SUPABASE_ANON_KEY` | **build-time**, optional | unset | string | declared in `.env.example:33`, `.env.production.example:15` — no active code consumer | no | not used | See [Drift findings](#drift-findings). |
| `CMS_API_KEY` | optional | `''` | string | declared in `backend/.env.example:176`, `backend/.env.production.example:85` — **no active TS consumer** | no | not used | Retired with the CMS Marketplace integration; removed from `config/index.ts`. See [Drift findings](#drift-findings). |
| `CMS_API_BASE_URL` | optional | (documented) | url | declared in `backend/.env.example:178` — no code consumer | no | not used | Same as `CMS_API_KEY`. |
| `CMS_API_TIMEOUT_MS` | optional | (documented) | int | declared in `backend/.env.example:180` — no code consumer | no | not used | Same as `CMS_API_KEY`. |
| `OPENAI_API_KEY` | optional | `''` | API key | declared in `backend/.env.example:183` — no code consumer | **yes** if set | not used | Never wired into `config/index.ts`. Keep unset. |
| `GCP_SA_KEY` | — | none | JSON string (service-account key) | `.github/workflows/deploy.yml:31`, `.github/workflows/deploy.yml:140`, `.github/workflows/deploy.yml:186`, `.github/workflows/deploy-staging.yml:31`, `.github/workflows/deploy-staging.yml:93` | **yes** | **GitHub Secret** (org/repo) | Deploy-time only. Never read by the running backend. Used by `google-github-actions/auth@v2` to impersonate the deploy service account. |

---

## By category

### Critical secrets (JWT, encryption, DB, third-party API keys)

| Var | Why it is in this tier |
|---|---|
| `JWT_ACCESS_SECRET` | Signs access tokens; leak = session-forgery. Re-validated at `backend/src/config/index.ts:L195-L215`. |
| `JWT_REFRESH_SECRET` | Signs refresh tokens; leak = persistent account takeover. Re-validated at `backend/src/config/index.ts:L201-L222`. |
| `PHI_ENCRYPTION_KEY` | AES-256-GCM master key for all PHI. Loss = unrecoverable patient data. |
| `AUDIT_LOG_SALT` | HMAC salt for encrypted audit-log payloads. Silent rotation = undecryptable history (see `backend/src/config/index.ts:L229-L238`). |
| `DATABASE_URL` | Gives full read/write to Cloud SQL; contains the DB password. |
| `ANTHROPIC_API_KEY` | Billable and BAA-scoped; leak = cost + BAA-breach exposure. Gated by `ANTHROPIC_BAA_ACTIVE` (`backend/src/config/index.ts:L245-L258`). |
| `SENDGRID_API_KEY` | Enables outbound email from `noreply@ownmyhealth.io` — trivial phishing vehicle if leaked. |
| `QUEST_FHIR_CLIENT_SECRET` | OAuth client secret to Quest Diagnostics sandbox/prod. |
| `GOOGLE_APPLICATION_CREDENTIALS` | When a JSON blob is inlined (form detected at `backend/src/services/ocrService.ts:L91-L101`), the service-account private key is in that value. |

### Database and persistence

| Var | Consumer | Notes |
|---|---|---|
| `DATABASE_URL` | `backend/src/services/database.ts:60` | Throws immediately at init if missing. |
| `DATABASE_POOL_SIZE` | `backend/src/services/database.ts:110` | Default 10. |
| `RLS_ENFORCEMENT` | `backend/src/services/database.ts:252` | `strict` → `process.exit(1)` if DB role is BYPASSRLS. Default is warn-only. |

### Auth and sessions

| Var | Consumer | Notes |
|---|---|---|
| `JWT_ACCESS_SECRET` | `backend/src/middleware/auth.ts:83` (verify), `backend/src/middleware/auth.ts:209` (sign) | Validated at `backend/src/config/index.ts:L61, L195-L215`. |
| `JWT_REFRESH_SECRET` | `backend/src/config/index.ts:65` (config export) | Validated at `backend/src/config/index.ts:L201-L222`. |
| `JWT_ACCESS_EXPIRES_SECONDS` | `backend/src/config/index.ts:62` → `backend/src/middleware/auth.ts:210` | Seconds, integer. |
| `JWT_REFRESH_EXPIRES_SECONDS` | `backend/src/config/index.ts:66` | Seconds, integer. |
| `COOKIE_DOMAIN` | `backend/src/middleware/csrf.ts:52`, `backend/src/controllers/authController.ts:84` | Required for cross-subdomain. |
| `COOKIE_SAME_SITE` | `backend/src/config/index.ts:79` | `none` when cross-domain. |
| `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES`, `BCRYPT_ROUNDS` | `backend/src/config/index.ts:L89-L94` | Security defaults. |

### Rate limiting

| Var | Consumer |
|---|---|
| `RATE_LIMIT_WINDOW_MS` | `backend/src/config/index.ts:110`, `backend/src/middleware/rateLimiter.ts:17` |
| `RATE_LIMIT_MAX_REQUESTS` | `backend/src/config/index.ts:111`, `backend/src/middleware/rateLimiter.ts:18` |

### AI (Anthropic + Google Document AI)

| Var | Consumer |
|---|---|
| `ANTHROPIC_API_KEY` | `backend/src/services/claudeExtraction.ts:53`, `backend/src/services/sbcExtraction.ts:321`, `backend/src/controllers/aiChatController.ts:60`, `backend/src/controllers/expenseController.ts:39`, `backend/src/routes/biomarkerRoutes.ts:131` |
| `ANTHROPIC_BAA_ACTIVE` | `backend/src/config/index.ts:150`; gate at `backend/src/controllers/aiChatController.ts:134`, `backend/src/routes/biomarkerRoutes.ts:134` |
| `GCP_PROJECT_ID` | `backend/src/services/ocrService.ts:82, 114, 450` |
| `GCP_PROCESSOR_ID` | `backend/src/services/ocrService.ts:85, 116, 452` |
| `GCP_LOCATION` | `backend/src/services/ocrService.ts:115` (default `us`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | `backend/src/services/ocrService.ts:89, 455` |

### Email (SendGrid)

| Var | Consumer |
|---|---|
| `SENDGRID_API_KEY` | `backend/src/config/index.ts:124, 125` → `backend/src/services/emailService.ts:43` |
| `SENDGRID_SANDBOX_MODE` | `backend/src/config/index.ts:133` |
| `EMAIL_FROM` | `backend/src/config/index.ts:126` |
| `EMAIL_FROM_NAME` | `backend/src/config/index.ts:127` |
| `FRONTEND_URL` | `backend/src/config/index.ts:128` (email link builder) |

### File storage (GCS)

| Var | Consumer |
|---|---|
| `GCS_BUCKET_NAME` | `backend/src/config/index.ts:138`, `backend/src/services/storageService.ts:20` |
| `GCP_PROJECT_ID` | `backend/src/services/storageService.ts:17` |
| `GOOGLE_APPLICATION_CREDENTIALS` | implicit to `@google-cloud/storage` SDK |

### CORS and frontend URLs

| Var | Consumer |
|---|---|
| `CORS_ORIGIN` | `backend/src/app.ts:79`, `backend/src/config/index.ts:98`, `backend/src/config/index.ts:313` |
| `FRONTEND_URL` | `backend/src/config/index.ts:128` |
| `VITE_API_URL` | `src/services/api/client.ts:10`, `src/services/uploadUtils.ts:8` |

### Demo mode

| Var | Consumer |
|---|---|
| `DEMO_ACCOUNT_ENABLED` | `backend/src/config/index.ts:117`, `backend/src/config/index.ts:319` (prod throw) |
| `DEMO_EMAIL` | `backend/src/middleware/demoProtection.ts:L34-L35` |
| `DEMO_PASSWORD` | `backend/src/config/index.ts:119` |
| `VITE_DEMO_MODE` | `src/hooks/useBiomarkerData.ts:18`, `src/App.tsx:258` |

### Feature flags

| Var | Consumer | Purpose |
|---|---|---|
| `DISABLE_CSRF` | `backend/src/app.ts:211`, `backend/src/middleware/csrf.ts:151` | Skip CSRF in dev only (`config.isDevelopment` gate). |
| `RLS_ENFORCEMENT` | `backend/src/services/database.ts:252` | Escalate BYPASSRLS detection to fatal. |
| `ANTHROPIC_BAA_ACTIVE` | `backend/src/config/index.ts:150` | Gate all Claude PHI calls. |
| `SENDGRID_SANDBOX_MODE` | `backend/src/config/index.ts:133` | Validate-but-don't-send for staging. |
| `QUEST_FHIR_CLIENT_ID` | `backend/src/config/index.ts:159` | Empty string disables the Quest SMART-on-FHIR integration end-to-end. |

### CI/CD-only (GitHub Secrets, not runtime)

| Var | Where read | Purpose |
|---|---|---|
| `GCP_SA_KEY` | `.github/workflows/deploy.yml:31`, `.github/workflows/deploy.yml:140`, `.github/workflows/deploy.yml:186`, `.github/workflows/deploy-staging.yml:31`, `.github/workflows/deploy-staging.yml:93` | Auth to GCP via `google-github-actions/auth@v2` for `gcloud run deploy` and `gsutil`. Never read by the running backend. |
| `DATABASE_URL` (CI) | `.github/workflows/ci.yml:76` | Dummy value (`postgresql://user:password@localhost:5432/test`) used only for `prisma generate`. |
| `VITE_API_URL` (CI/deploy) | `.github/workflows/ci.yml:40`, `.github/workflows/deploy.yml:206` | Inlined into the frontend build. |

### Frontend build-time (`VITE_*`)

| Var | Default | Consumer |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001/api/v1` | `src/services/api/client.ts:10`, `src/services/uploadUtils.ts:8` |
| `VITE_DEBUG` | unset | `src/utils/logger.ts:17` |
| `VITE_DEMO_MODE` | unset | `src/hooks/useBiomarkerData.ts:18`, `src/App.tsx:258` |
| `VITE_SUPABASE_URL` | unset | declared only; no TS consumer (see [Drift findings](#drift-findings)). |
| `VITE_SUPABASE_ANON_KEY` | unset | declared only; no TS consumer (see [Drift findings](#drift-findings)). |

---

## Startup validation

Startup validation is concentrated in `backend/src/config/index.ts` (evaluated at module load during `backend/src/app.ts:48` import). A second line of defense lives in `backend/src/app.ts:L81-L88` (CORS origin).

### `requireEnv` — missing-or-empty secrets fail immediately

> Source: `backend/src/config/index.ts:L18-L28`

```ts
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `This secret must be set in every environment (dev, staging, prod). ` +
      `Generate with: openssl rand -base64 32`
    );
  }
  return value;
}
```

Callers: `backend/src/config/index.ts:61` (`JWT_ACCESS_SECRET`), `backend/src/config/index.ts:65` (`JWT_REFRESH_SECRET`).

### JWT secret placeholder + length gates (runs in every env)

> Source: `backend/src/config/index.ts:L186-L222`

```ts
const BLOCKED_JWT_VALUES = new Set([
  'access-secret-change-in-production',
  'refresh-secret-change-in-production',
  'fallback-secret-change-in-production',
  'change-me',
  'secret',
  'jwt-secret',
]);

if (BLOCKED_JWT_VALUES.has(config.jwt.accessSecret)) {
  throw new Error(
    'JWT_ACCESS_SECRET is set to a known-weak placeholder value. ' +
    'Generate a real secret with: openssl rand -base64 32'
  );
}
// ...refresh mirror...
const MIN_JWT_SECRET_LENGTH = 32;
if (config.jwt.accessSecret.length < MIN_JWT_SECRET_LENGTH) {
  throw new Error(
    `JWT_ACCESS_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters. ...`
  );
}
```

### Audit salt gate (runs in every env)

> Source: `backend/src/config/index.ts:L228-L238`

```ts
const MIN_AUDIT_SALT_LENGTH = 16;
if (!config.auditSalt || config.auditSalt.length < MIN_AUDIT_SALT_LENGTH) {
  throw new Error(
    `AUDIT_LOG_SALT must be set and at least ${MIN_AUDIT_SALT_LENGTH} characters. ...`
  );
}
```

### Anthropic BAA prod gate

> Source: `backend/src/config/index.ts:L245-L258`

```ts
if (config.anthropic.apiKey && !config.anthropic.baaActive) {
  if (config.isProduction) {
    throw new Error(
      'ANTHROPIC_BAA_ACTIVE must be set to "true" in production when ANTHROPIC_API_KEY is configured. ...'
    );
  } else {
    process.stderr.write(
      '⚠️  ANTHROPIC_BAA_ACTIVE is not set to "true". ...'
    );
  }
}
```

### Production-and-staging block: `DATABASE_URL`, `PHI_ENCRYPTION_KEY`, demo, warnings

> Source: `backend/src/config/index.ts:L266-L338`

```ts
if (config.isProduction || config.isStaging) {
  const envLabel = config.isProduction ? 'production' : 'staging';

  const requiredEnvVars = ['DATABASE_URL', 'PHI_ENCRYPTION_KEY'];
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for ${envLabel}: ${missing.join(', ')}`);
  }

  const phiKey = process.env.PHI_ENCRYPTION_KEY!;
  if (phiKey.length < 64) { throw new Error(...); }
  if (!/^[0-9a-fA-F]+$/.test(phiKey)) { throw new Error(...); }
  if (insecureKeys.includes(phiKey.toLowerCase())) { throw new Error(...); }

  if (config.isProduction && config.demo.enabled) {
    throw new Error('DEMO_ACCOUNT_ENABLED cannot be true in production. ...');
  }
  // Non-fatal warnings for ANTHROPIC_API_KEY / SENDGRID_API_KEY / GCP_PROJECT_ID unset
}
```

### Second-line CORS gate (`app.ts`)

> Source: `backend/src/app.ts:L81-L88`

```ts
if (config.isProduction) {
  if (!envValue) {
    throw new Error('CORS_ORIGIN must be set in production');
  }
  const envOrigins = envValue.split(',').map(o => o.trim()).filter(Boolean);
  if (envOrigins.some(o => o.includes('localhost') || o.includes('127.0.0.1'))) {
    throw new Error('CORS_ORIGIN cannot contain localhost in production');
  }
  // ...union with HARDCODED_PRODUCTION_ORIGINS...
}
```

### Summary — what throws at boot

| Var | Env(s) where it throws at boot | Source |
|---|---|---|
| `JWT_ACCESS_SECRET` | all (dev, staging, prod) if missing/empty/blocked/short | `backend/src/config/index.ts:L18-L28, L195-L215` |
| `JWT_REFRESH_SECRET` | all if missing/empty/blocked/short | `backend/src/config/index.ts:L18-L28, L201-L222` |
| `AUDIT_LOG_SALT` | all if missing/<16 | `backend/src/config/index.ts:L228-L238` |
| `ANTHROPIC_BAA_ACTIVE` | prod only, when `ANTHROPIC_API_KEY` also set | `backend/src/config/index.ts:L246-L251` |
| `DATABASE_URL` | prod + staging | `backend/src/config/index.ts:L269-L277` |
| `PHI_ENCRYPTION_KEY` | prod + staging (missing / wrong length / non-hex / blocklisted) | `backend/src/config/index.ts:L269-L308` |
| `DEMO_ACCOUNT_ENABLED=true` | prod only | `backend/src/config/index.ts:L319-L325` |
| `CORS_ORIGIN` | prod only (missing or localhost) | `backend/src/app.ts:L81-L88` |
| `DATABASE_URL` (at DB init) | all (second throw) | `backend/src/services/database.ts:L60-L64` |

---

## Secret rotation policy

| Secret | Classification | Rotation cadence | Rotation procedure | Where stored |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | auth | Every 90 days or on suspected leak | Generate `openssl rand -base64 32`; write to GCP Secret Manager; `gcloud run services update --update-secrets`; use traffic-pinned update (see `memory/cloud-run-env-update-pinning.md`). All active access tokens invalidated on first restart. | GCP Secret Manager → Cloud Run env |
| `JWT_REFRESH_SECRET` | auth | Every 90 days or on leak | Same as access secret. Invalidates all refresh tokens → forces users to re-login. | GCP Secret Manager |
| `PHI_ENCRYPTION_KEY` | **PHI master** | **Not yet automated** | TBD (external: PHI master-key rotation procedure is not checked into this repo — resolve via the owner's security runbook and docs/STAGING.md; a proper rotation requires re-encrypting every row whose fields appear in `PHI_FIELDS` at `backend/src/services/encryption.ts`). Losing this key destroys all PHI. | GCP Secret Manager |
| `AUDIT_LOG_SALT` | PHI-adjacent | **Do not rotate silently** | Rotating without re-encrypting historic `audit_logs` breaks decryption of 7-year retention data. See `backend/src/config/index.ts:L229-L238` and the docblock at `backend/src/config/index.ts:L43-L54`. | GCP Secret Manager |
| `DATABASE_URL` | DB credential | Every 90 days or on leak | Rotate the Cloud SQL user password; update Secret Manager; redeploy. Strict `RLS_ENFORCEMENT` mode guards against accidentally rotating back to a BYPASSRLS user. | GCP Secret Manager |
| `ANTHROPIC_API_KEY` | billable + BAA-scoped | On staff turnover or leak | Rotate via the Anthropic console under the BAA-covered org; update Secret Manager; `update-traffic --to-revisions=NEW=100`. The 2026-04-17 postmortem (see memory `cloud-run-env-update-pinning.md`) documents the env-update → traffic-pin failure mode. | GCP Secret Manager |
| `SENDGRID_API_KEY` | deliverability | On staff turnover or leak | Revoke in SendGrid; create new restricted-access key (`Mail Send` only); update Secret Manager. | GCP Secret Manager |
| `QUEST_FHIR_CLIENT_SECRET` | OAuth | Per Quest vendor policy | Rotate via Quest developer portal; update Secret Manager. | GCP Secret Manager |
| `DEMO_PASSWORD` | credential (staging only) | Per dev-team policy | Generate fresh password; update Cloud Run staging env. Demo account is blocked in prod (`backend/src/config/index.ts:L319-L325`). | Cloud Run env (staging only) |
| `GCP_SA_KEY` (GitHub secret) | deploy credential | Every 90 days | Create new SA key in GCP IAM; update GitHub repo secret; revoke old key. Not runtime. | GitHub Secret (`secrets.GCP_SA_KEY`) |

---

## Local vs staging vs prod diff

| Var | Local dev | Staging | Production |
|---|---|---|---|
| `NODE_ENV` | unset / `development` | `staging` | `production` |
| `DATABASE_URL` | local Postgres or `prisma+postgres://...` | staging Cloud SQL DB | prod Cloud SQL (separate) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | set in `.env` (ignored by git) | Secret Manager, fresh per env | Secret Manager, fresh per env |
| `PHI_ENCRYPTION_KEY` | local 64-hex (via `openssl rand -hex 32`) | Secret Manager | Secret Manager |
| `AUDIT_LOG_SALT` | local `openssl rand -hex 32` | Secret Manager (fresh — no historic logs to preserve) | Secret Manager (**do not rotate silently**) |
| `CORS_ORIGIN` | unset → localhost defaults (`backend/src/config/index.ts:L98-L104`) | `https://staging.ownmyhealth.io` | `https://ownmyhealth.io`, also unioned with hardcoded list (`backend/src/app.ts:L64-L67`) |
| `COOKIE_DOMAIN` / `COOKIE_SAME_SITE` | unset / `lax` | `.ownmyhealth.io` / `none` | `.ownmyhealth.io` / `none` |
| `DEMO_ACCOUNT_ENABLED` | `true` (optional) | `true` | **must be false or unset** (prod boot throws) |
| `ANTHROPIC_BAA_ACTIVE` | `false` (warn) | `false` (warn, Claude blocked by runtime gate) | `true` required if `ANTHROPIC_API_KEY` set |
| `SENDGRID_SANDBOX_MODE` | `false` (emails go to dev mailbox) | **auto-true** regardless of env var (`backend/src/config/index.ts:L132-L133`) | `false` (real delivery) |
| `RLS_ENFORCEMENT` | unset | unset during C-8 rollout | unset now; flip to `strict` after NOBYPASSRLS role is live |
| `DISABLE_CSRF` | optional (`true` for curl testing) | ignored (only `config.isDevelopment` honors it) | ignored |
| `GCS_BUCKET_NAME` | default `ownmyhealth-user-files` | `ownmyhealth-user-files-staging` | `ownmyhealth-user-files` |
| `FRONTEND_URL` | `http://localhost:5173` | `https://staging.ownmyhealth.io` | `https://ownmyhealth.io` |
| `VITE_API_URL` (build) | `http://localhost:3001/api/v1` | `https://api-staging.ownmyhealth.io/api/v1` (from `.env.staging`) | `https://api.ownmyhealth.io/api/v1` |

### Defaults safe for dev but never for prod

- `GCS_BUCKET_NAME` default `ownmyhealth-user-files` — prod uses this bucket name; staging must override to `...-staging` or files co-mingle with prod.
- `EMAIL_FROM` default `noreply@ownmyhealth.com` — production uses the `.io` domain; leaving this as the default would send from an unverified SendGrid sender.
- `FRONTEND_URL` default `http://localhost:5173` — email verification/reset links would be broken if left as default in prod.
- `QUEST_FHIR_REDIRECT_URI` default points at the `ownmyhealth.io` callback — staging must override (it does — see `.env.staging.example:102`).
- `JWT_ACCESS_EXPIRES_SECONDS` / `JWT_REFRESH_EXPIRES_SECONDS` are safe defaults (15 min / 7 days) — fine in prod.

---

## Drift findings

Env vars declared but not read, or read but not declared, or declared under a different name than the prompt/CLAUDE.md expects.

| Env var | Declared in `config/index.ts`? | Found in `.env.example` / prompt / CLAUDE.md? | Found in code usage (grep)? | Notes |
|---|---|---|---|---|
| `CSRF_SECRET` | no | yes — CLAUDE.md:259, prompt `35-env-vars-doc.md:99` | **0 hits** in `backend/src/**` | CSRF uses a double-submit-cookie design (`backend/src/middleware/csrf.ts` — random token, no keyed HMAC). No secret needed. **Remove from CLAUDE.md and prompt.** |
| `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` | no | yes — CLAUDE.md:255, prompt `35-env-vars-doc.md:103` | **0 hits** — code uses `GCP_PROCESSOR_ID` (`backend/src/services/ocrService.ts:85, 116, 452`) | Name drift. Either rename in code to match the prompt, or update prompt + CLAUDE.md to use `GCP_PROCESSOR_ID`. |
| `GOOGLE_DOCUMENT_AI_LOCATION` | no | yes — CLAUDE.md:256, prompt `35-env-vars-doc.md:103` | **0 hits** — code uses `GCP_LOCATION` (`backend/src/services/ocrService.ts:115`) | Same drift as processor id. |
| `OPENAI_API_KEY` | no | yes — `backend/.env.example:183` | **0 hits** | Never wired. Delete from example or wire an OpenAI service. |
| `CMS_API_KEY` | no | yes — `backend/.env.example:176`, `backend/.env.production.example:85` | **0 hits** (CMS Marketplace feature removed — see CLAUDE.md:34) | Vestigial. Safe to remove from example files. |
| `CMS_API_BASE_URL` | no | yes — `backend/.env.example:178` | **0 hits** | Vestigial. |
| `CMS_API_TIMEOUT_MS` | no | yes — `backend/.env.example:180` | **0 hits** | Vestigial. |
| `VITE_SUPABASE_URL` | n/a (frontend) | yes — `.env.example:32`, `.env.production.example:14` | **0 hits** under `src/` | Docs artifact from Bolt template. Delete from example. |
| `VITE_SUPABASE_ANON_KEY` | n/a | yes — `.env.example:33`, `.env.production.example:15` | **0 hits** under `src/` | Same as above. |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | no — code uses `_SECONDS` suffix (`backend/src/config/index.ts:62, 66`) | yes — `backend/.env.production.example:32, 34` | **0 hits** | `.env.production.example` still documents the old `15m`/`7d` string form. Code only reads `_SECONDS`. Example file is stale. |
| `BCRYPT_ROUNDS` default mismatch | yes (code default `13` at `backend/src/config/index.ts:93`) | `.env.example:109` and `.env.production.example:61` say `12` | n/a | Not a bug — example is softer than code default. Either align example to 13 or accept as documentation drift. |
| `GCP_PROCESSOR_ID` / `GCP_LOCATION` | **no — they never flow through `config`** | no (only in CLAUDE.md under the wrong name) | yes — `backend/src/services/ocrService.ts:85, 115, 116, 452` | Bypass `config/index.ts` entirely, making them invisible to the central validation block. Candidate for promotion into `config.gcp.documentAI` with a missing-at-runtime guard. |
| `DATABASE_POOL_SIZE` | **no** | no | yes — `backend/src/services/database.ts:110` | Not centralized in `config`. Works but violates the “config is the single source of truth” convention. |
| `DISABLE_CSRF` | **no** | yes — mentioned in `.env.example:167` | yes — `backend/src/app.ts:211`, `backend/src/middleware/csrf.ts:151` | Bypasses `config`. Acceptable because it is dev-only by construction, but worth centralizing. |
| `RLS_ENFORCEMENT` | **no** | yes — `.env.example:95`, `.env.staging.example:41` | yes — `backend/src/services/database.ts:252` | Read directly from `process.env`; not in `config`. |

External TBDs (genuinely outside the repo):

- **PHI_ENCRYPTION_KEY rotation procedure**: `TBD (external: PHI master-key rotation procedure is not checked into this repo — resolve via the security owner's runbook, to live under RUNBOOK.md or docs/STAGING.md; executing rotation requires re-encrypting every row whose fields appear in PHI_FIELDS at backend/src/services/encryption.ts)`.

---

## Acceptance-question self-checks

Answered using only this doc (and the siblings it cross-links).

**Q1. Which env vars are strictly required to boot the backend in production?**
→ `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (both globally required, `backend/src/config/index.ts:L18-L28`), `AUDIT_LOG_SALT` (globally required, `backend/src/config/index.ts:L228-L238`), `DATABASE_URL`, `PHI_ENCRYPTION_KEY` (prod/staging, `backend/src/config/index.ts:L269-L308`), `CORS_ORIGIN` (prod, `backend/src/app.ts:L81-L88`). Plus `ANTHROPIC_BAA_ACTIVE=true` conditionally if `ANTHROPIC_API_KEY` is set. See [Master table](#master-table) and [Startup validation](#startup-validation).

**Q2. What happens if `JWT_SECRET` is omitted?**
→ There is no `JWT_SECRET` — the code uses `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. If either is missing/empty, the boot throws at `backend/src/config/index.ts:L18-L28` with message "Missing required environment variable: JWT_ACCESS_SECRET. This secret must be set in every environment …".

**Q3. Which env vars contain PHI-adjacent secrets and how are they rotated?**
→ `PHI_ENCRYPTION_KEY` (AES-256-GCM master key — **not yet automated**, see external TBD in [Drift findings](#drift-findings)) and `AUDIT_LOG_SALT` (**do not rotate silently** — breaks 7-year audit-log decryption). Both stored in GCP Secret Manager. See [Secret rotation policy](#secret-rotation-policy).

**Q4. Which vars are build-time (`VITE_*`) vs runtime?**
→ Build-time (inlined into the frontend bundle by Vite): `VITE_API_URL`, `VITE_DEBUG`, `VITE_DEMO_MODE`, `VITE_SUPABASE_URL` (unused), `VITE_SUPABASE_ANON_KEY` (unused). Everything else is runtime. See the [Frontend build-time](#frontend-build-time-vite_) subsection.

**Q5. Where is `DATABASE_URL` stored in production and how is it provisioned for a new deploy?**
→ GCP Secret Manager, surfaced to the Cloud Run service as an env var via `gcloud run services update --update-secrets`. The deploy flow (`.github/workflows/deploy.yml`) does not set `DATABASE_URL` in the workflow — it inherits from the service's existing env/secret bindings. A new deploy or secret rotation follows the traffic-pin-aware update pattern in `memory/cloud-run-env-update-pinning.md`.

**Q6. Which env var controls whether Anthropic BAA protections are active, and what code path does it gate?**
→ `ANTHROPIC_BAA_ACTIVE`. Boot gate at `backend/src/config/index.ts:L245-L258` (throws in prod if false but `ANTHROPIC_API_KEY` is set). Runtime gate at `backend/src/controllers/aiChatController.ts:134` and `backend/src/routes/biomarkerRoutes.ts:134`; also checked inside `claudeExtraction` and `sbcExtraction` paths (the callers in `backend/src/services/claudeExtraction.ts:53` and `backend/src/services/sbcExtraction.ts:321`).

**Q7. What's the CORS origin in staging vs prod, and which file reads it?**
→ Staging: `https://staging.ownmyhealth.io` (`backend/.env.staging.example:53`). Prod: `https://ownmyhealth.io` + union with hardcoded list `https://app.ownmyhealth.io`, `https://ownmyhealth.io` at `backend/src/app.ts:L64-L67`. Both paths read through `backend/src/app.ts:79` (`process.env.CORS_ORIGIN`) and `backend/src/config/index.ts:98`.

**Q8. Which vars have defaults safe for local dev and should never be left as default in prod?**
→ `EMAIL_FROM` (→ `ownmyhealth.com` default, unverified on SendGrid), `FRONTEND_URL` (→ `http://localhost:5173`), `GCS_BUCKET_NAME` for staging (else co-mingles with prod), `QUEST_FHIR_REDIRECT_URI` for staging. Listed explicitly under [Defaults safe for dev but never for prod](#defaults-safe-for-dev-but-never-for-prod).

**Q9. Does `PHI_ENCRYPTION_KEY` have a rotation procedure?**
→ Not in the repo. Marked as external TBD under [Secret rotation policy](#secret-rotation-policy) and [Drift findings](#drift-findings). Resolution path: security owner's runbook, targeted to land in `RUNBOOK.md` or `docs/STAGING.md`. Rotating requires re-encrypting every row whose fields appear in `PHI_FIELDS` at `backend/src/services/encryption.ts`.

**Q10. Which GitHub Actions secrets are used at deploy time but never read at runtime?**
→ `GCP_SA_KEY` — read only by `.github/workflows/deploy.yml:31,140,186` and `.github/workflows/deploy-staging.yml:31,93` via `google-github-actions/auth@v2`. The running backend never sees it. See [CI/CD-only](#cicd-only-github-secrets-not-runtime).

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview, middleware stack, deployment topology (how env vars flow into the request pipeline).
- [RUNBOOK.md](./RUNBOOK.md) — on-call procedures, including secret rotation steps and the Cloud Run env-update pinning postmortem.
- [LOCAL_DEV.md](./LOCAL_DEV.md) — how to populate `.env` for local development.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — context for `PHI_ENCRYPTION_KEY` and the field inventory it protects.
- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — open secret-management findings (C-3 JWT fallbacks removed, C-7 BAA gate, C-8 audit-salt migration, RLS/BYPASSRLS runtime-role issue).

---

## Prompt drift log

- `./35-env-vars-doc.md:99` mentions `CSRF_SECRET` — the code uses a double-submit-cookie CSRF design (`backend/src/middleware/csrf.ts`) with no server secret. No such env var exists. Prompt should drop it.
- `./35-env-vars-doc.md:103` and `CLAUDE.md:255-256` reference `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` / `GOOGLE_DOCUMENT_AI_LOCATION`. The actual env vars are `GCP_PROCESSOR_ID` / `GCP_LOCATION` (`backend/src/services/ocrService.ts:85, 115, 116`). Either rename in code or update prompt + CLAUDE.md.
- `./35-env-vars-doc.md:98` lists `JWT_SECRET` / `JWT_REFRESH_SECRET` / `JWT_ACCESS_EXPIRY` / `JWT_REFRESH_EXPIRY`. Actual names: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_SECONDS`, `JWT_REFRESH_EXPIRES_SECONDS` (`backend/src/config/index.ts:L61-L66`).
- `./35-env-vars-doc.md:34` cites `backend/src/index.ts` as the startup-validation host; file does not exist. Startup validation actually lives in `backend/src/config/index.ts` (module-load throws) and `backend/src/app.ts` (CORS hardening). Prompt author should update the file list.
- `backend/.env.production.example:32-34` still documents `JWT_ACCESS_EXPIRES_IN=15m` / `JWT_REFRESH_EXPIRES_IN=7d`. The code only honors `_SECONDS` integer variants. The production example file is stale.
- `backend/.env.example:109` and `backend/.env.production.example:61` document `BCRYPT_ROUNDS=12`; code default is `13` (`backend/src/config/index.ts:93`). Not a bug, but the example files should be aligned.
- Several env vars bypass `backend/src/config/index.ts` entirely: `DATABASE_POOL_SIZE`, `RLS_ENFORCEMENT`, `DISABLE_CSRF`, `GCP_PROCESSOR_ID`, `GCP_LOCATION`. These should be promoted into the central `config` object so `_doc-quality.md`'s "config is single source of truth" rule holds.
