# Environment & Secrets Security Audit

**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (automated security audit)
**Scope:** Environment variable management, secret storage, CI/CD secrets, Dockerfile security
**Severity Rating:** HIGH -- Critical findings require immediate action

---

## Executive Summary

The OwnMyHealth project has a well-structured environment configuration system with strong production validation guards. However, the audit identified **two critical findings**: (1) a live Anthropic API key committed in the local `backend/.env` file, and (2) a real database password with IP address in that same file. While `backend/.env` is correctly excluded from git tracking, its presence on an OneDrive-synced directory means the secret is replicated to Microsoft cloud storage. Additionally, the `.env` file was briefly committed to git history (commit `1e4a167`), though it only contained placeholder Supabase values.

---

## Files Reviewed

| File | Path |
|------|------|
| Config loader | `backend/src/config/index.ts` |
| Root .env.example | `.env.example` |
| Backend .env.example | `backend/.env.example` |
| Root .env.production.example | `.env.production.example` |
| Backend .env.production.example | `backend/.env.production.example` |
| Root .gitignore | `.gitignore` |
| Backend .gitignore | `backend/.gitignore` |
| Deploy workflow | `.github/workflows/deploy.yml` |
| CI workflow | `.github/workflows/ci.yml` |
| Dockerfile | `backend/Dockerfile` |
| Backend .env (local) | `backend/.env` (NOT in git) |
| Encryption service | `backend/src/services/encryption.ts` |
| Email service | `backend/src/services/emailService.ts` |
| Claude extraction | `backend/src/services/claudeExtraction.ts` |
| SBC extraction | `backend/src/services/sbcExtraction.ts` |
| OCR service | `backend/src/services/ocrService.ts` |
| Storage service | `backend/src/services/storageService.ts` |
| Logger utility | `backend/src/utils/logger.ts` |

---

## Checklist Results

### 1. Secret Manager Inventory

**Critical Secrets (Secret Manager):**

- [x] PASS -- `DATABASE_URL` - Referenced in `backend/src/config/index.ts` (implicit via Prisma), `backend/src/services/database.ts:38`. Loaded from environment. Production validation at `config/index.ts:110` ensures it is set.

- [x] PASS -- `JWT_ACCESS_SECRET` - Loaded at `config/index.ts:16` via `process.env.JWT_ACCESS_SECRET`. Production validation at lines 107-128 ensures it is set and not a default value. Minimum 32-character length enforced at lines 134-142.

- [x] PASS -- `JWT_REFRESH_SECRET` - Loaded at `config/index.ts:20` via `process.env.JWT_REFRESH_SECRET`. Same production validation as above (lines 107-132, 144-149).

- [x] PASS -- `PHI_ENCRYPTION_KEY` - Loaded at `config/index.ts:152` and `encryption.ts:140`. Production validation at `config/index.ts:151-180` enforces 64 hex characters, valid hex format, and rejects known insecure placeholder keys. Additionally, `encryption.ts:86-123` (`validateEncryptionKey`) performs the same checks independently.

- [x] PASS -- `ANTHROPIC_API_KEY` - Used via lazy initialization in three locations: `claudeExtraction.ts:49`, `sbcExtraction.ts:316`, `biomarkerRoutes.ts:106`, `expenseController.ts:293`. Missing key results in 503/500 error, not a crash.

- [~] PARTIAL -- `SENDGRID_API_KEY` - Referenced at `config/index.ts:82-83`. Email feature is enabled only when the key exists (`enabled: !!process.env.SENDGRID_API_KEY`). However, this variable is **not included in the production required vars check** at `config/index.ts:107-112`. If SendGrid is intended to be required in production, validation should be added.
  - **Finding:** Not listed in `backend/.env.example` as required for production, but IS listed in `backend/.env.production.example:62`.

- [x] PASS -- `GOOGLE_APPLICATION_CREDENTIALS` - Loaded at `config/index.ts:94` and `ocrService.ts:89`. Supports both file path and inline JSON formats (`ocrService.ts:91-104`).

**Configuration Variables (Environment):**

- [x] PASS -- `NODE_ENV` - `config/index.ts:9`. Defaults to `'development'`. Production checks depend on this value.

- [x] PASS -- `PORT` - `config/index.ts:10`. Defaults to `3001`. Parsed as integer.

- [x] PASS -- `CORS_ORIGIN` - `config/index.ts:56`. Falls back to array of localhost ports in development. Production warns if localhost URLs detected (`config/index.ts:186-188`).

- [x] PASS -- `GCS_BUCKET_NAME` - `config/index.ts:91` and `storageService.ts:19`. Defaults to `'ownmyhealth-user-files'`.

- [x] PASS -- `GCP_PROJECT_ID` - `config/index.ts:92`, `storageService.ts:16`, `ocrService.ts:82,114`. Required for OCR and storage.

- [x] PASS -- `EMAIL_FROM` - `config/index.ts:84`. Defaults to `'noreply@ownmyhealth.com'`.

- [x] PASS -- `EMAIL_FROM_NAME` - `config/index.ts:85`. Defaults to `'OwnMyHealth'`.

- [x] PASS -- `FRONTEND_URL` - `config/index.ts:86`. Defaults to `'http://localhost:5173'`. Used for email verification and password reset links.

**Security Configuration:**

- [x] PASS -- `MAX_LOGIN_ATTEMPTS` - `config/index.ts:49`. Defaults to `5`. Parsed as integer.

- [x] PASS -- `LOCKOUT_DURATION_MINUTES` - `config/index.ts:50`. Defaults to `30`. Converted to milliseconds.

- [x] PASS -- `BCRYPT_ROUNDS` - `config/index.ts:51`. Defaults to `12`.

**Demo Configuration (non-production only):**

- [x] PASS -- `DEMO_ACCOUNT_ENABLED` - `config/index.ts:75`. Only enabled when explicitly `'true'`. Production startup crashes if enabled (`config/index.ts:191-197`).

- [x] PASS -- `DEMO_EMAIL` - `config/index.ts:76`. Defaults to empty string. No hardcoded fallback.

- [x] PASS -- `DEMO_PASSWORD` - `config/index.ts:77`. Defaults to empty string. No hardcoded fallback. Comment at line 73 confirms: "SECURITY: No hardcoded fallbacks."

---

### 2. No Hardcoded Secrets

- [x] PASS -- **No API keys in source code.** Grep for `sk-ant` in `backend/src/**/*.ts` returned zero matches in source code. The only match was in the local `backend/.env` file (not committed). All API key access goes through `process.env.ANTHROPIC_API_KEY`.

- [x] PASS -- **No passwords in source code.** Grep for `password.*=.*['"]` only matched test files (`authService.test.ts:183,190,199`) using test fixture passwords like `'mysecretpassword'` and `'wrongpassword'`, which is acceptable for unit tests.

- [~] PARTIAL -- **No connection strings in source code.** No production connection strings are hardcoded. However:
  - `backend/Dockerfile:18,37` contains `ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"` -- this is a dummy value used only for `prisma generate` at build time and does not connect to any real database. Acceptable but could use a comment.
  - `.github/workflows/ci.yml:76` contains `DATABASE_URL: postgresql://user:password@localhost:5432/test` for CI Prisma generation. Also a dummy value. Acceptable.

- [x] PASS -- **No hardcoded `secret.*=` patterns** returning real secrets. Grep for `secret.*=.*['"]` excluding `process.env` returned zero matches in source code.

**Finding:** The `config/index.ts` file contains development fallback values for JWT secrets:
  - Line 16: `'access-secret-change-in-production'`
  - Line 20: `'refresh-secret-change-in-production'`
  - Line 24: `'fallback-secret-change-in-production'`

  These are **acceptable** because: (a) they are clearly labeled as needing change, (b) production validation at lines 120-132 explicitly checks for and rejects these exact default values, and (c) the application will refuse to start in production with these defaults.

---

### 3. Environment Variable Documentation

- [x] PASS -- **All required variables documented in `.env.example`.** The `backend/.env.example` file documents all critical variables: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PHI_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES`, `BCRYPT_ROUNDS`, `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `DEMO_*` variables. Additionally, `backend/.env.production.example` adds `SENDGRID_API_KEY`, `EMAIL_FROM`, `FRONTEND_URL`, and `CMS_API_KEY`.

- [x] PASS -- **Optional variables marked as optional.** Variables like `DEMO_ACCOUNT_ENABLED`, `DEMO_EMAIL`, `OPENAI_API_KEY`, `CORS_ORIGIN`, `COOKIE_SAME_SITE`, `COOKIE_DOMAIN` are commented out by default. Required production variables are marked with `[REQUIRED IN PRODUCTION]` comments.

- [x] PASS -- **Example values don't contain real secrets.** All example files use clearly fake/placeholder values:
  - `JWT_ACCESS_SECRET=access-secret-change-in-production`
  - `PHI_ENCRYPTION_KEY=0123456789abcdef...` (explicitly stated "DO NOT USE THIS IN PRODUCTION")
  - `SENDGRID_API_KEY=SG.your_api_key_here`
  - `CMS_API_KEY=your_cms_api_key_here`
  - `DATABASE_URL="prisma+postgres://localhost:51213/?api_key=YOUR_API_KEY"`

- [x] PASS -- **Format/validation requirements noted.** The `.env.example` files include:
  - Generation instructions: `openssl rand -base64 32` for JWT, `openssl rand -hex 32` for PHI key
  - Format requirements: "64 hexadecimal characters", "only valid hex characters"
  - Expiration format: "Must be an integer, NOT a string like '15m'"
  - Full production checklist at bottom of file

**Minor finding:** The `backend/.env.production.example:29,31` uses `JWT_ACCESS_EXPIRES_IN=15m` and `JWT_REFRESH_EXPIRES_IN=7d` (string format), while `config/index.ts:17,21` expects `JWT_ACCESS_EXPIRES_SECONDS` and `JWT_REFRESH_EXPIRES_SECONDS` (integer seconds). This is a **documentation mismatch** that could cause configuration errors in production.

---

### 4. Secret Rotation

- [x] PASS -- **Secrets can be rotated without code changes.** All secrets are loaded from environment variables at runtime via `config/index.ts`. Restarting the Cloud Run service with updated Secret Manager values will pick up new secrets.

- [ ] FAIL -- **Process documented for rotating each secret.** There is no dedicated secret rotation documentation. The `.env.example` files mention generation commands but not a rotation procedure. Key concerns:
  - `PHI_ENCRYPTION_KEY` rotation would break all existing encrypted PHI data unless a re-encryption migration is performed. The `EncryptionService.reEncrypt()` method exists (`encryption.ts:347-350`) but there is no migration script.
  - JWT secret rotation would invalidate all existing sessions (acceptable but should be documented).
  - No documented process for database credential rotation.

- [x] PASS -- **No secrets embedded in Docker images.** The `backend/Dockerfile` only embeds a dummy `DATABASE_URL` for Prisma client generation (lines 18, 37). No real secrets are baked into the image. The production stage copies only build artifacts and relies on runtime environment variables.

---

### 5. CI/CD Secrets

- [~] PARTIAL -- `GCP_PROJECT_ID` -- **Hardcoded in workflow, not a GitHub secret.** The `deploy.yml:9` uses `PROJECT_ID: ownmyhealth-prod` as a plain-text workflow env var, not a GitHub secret. This is the GCP project ID (not a secret per se, but a configuration value). Acceptable for a project ID, but using a secret would be more flexible.

- [x] PASS -- `GCP_SA_KEY` (service account JSON) -- Referenced as `${{ secrets.GCP_SA_KEY }}` at `deploy.yml:25,97`. Properly stored as a GitHub Actions secret.

- [~] PARTIAL -- `GCP_REGION` -- **Hardcoded as `REGION: us-central1`** in `deploy.yml:10`, not stored as a GitHub secret. This is a configuration value, not a true secret, so this is acceptable but less flexible.

- [x] PASS -- **Secrets not echoed in logs.** The `deploy.yml` echo statements only output image names, service URLs, and deployment status. No secret values are echoed. The `${{ secrets.GCP_SA_KEY }}` is only passed to the `google-github-actions/auth@v2` action, which handles it securely.

**Additional CI/CD finding:** The `ci.yml:76` uses a hardcoded dummy `DATABASE_URL: postgresql://user:password@localhost:5432/test` for Prisma generation. This is a non-functional dummy value and is acceptable.

---

### 6. Local Development

- [x] PASS -- **`.env` files in `.gitignore`.** Root `.gitignore:19-20` includes:
  ```
  .env
  .env.local
  ```
  `backend/.gitignore:8-10` includes:
  ```
  .env
  .env.local
  .env.*.local
  ```

- [x] PASS -- **`.env.local` files in `.gitignore`.** Both root (`.gitignore:20`) and backend (`backend/.gitignore:9`) exclude `.env.local`.

- [~] PARTIAL -- **No real secrets in committed files.** Currently tracked files do not contain real secrets. However:
  - **Git history finding:** Commit `1e4a167` ("backup before cleanup") committed a root `.env` file. It only contained placeholder Supabase values (`VITE_SUPABASE_URL=https://your-project-url.supabase.co`, `VITE_SUPABASE_ANON_KEY=your-anon-key`). This was later removed in commit `8cbf298`. No real secrets were exposed in git history.
  - **Ongoing risk:** The `backend/.env` file on disk contains a **live Anthropic API key** (`sk-ant-api03-...`) and a **real database password** (`REDACTED`) with the Cloud SQL IP address (`REDACTED`). While this file is git-ignored, it resides in an **OneDrive-synced directory**, which means these secrets are synced to Microsoft cloud storage.

- [x] PASS -- **Clear instructions for local setup.** The `.env.example` files include copy instructions ("Copy this file to .env and update the values"), generation commands, and a production checklist.

---

### 7. Secret Access Patterns

- [x] PASS -- **Secrets loaded once at startup.** The `config/index.ts` module loads all `process.env` values at import time (module initialization). The exported `config` object is `as const`, preventing runtime mutation. Production validation runs once at startup (lines 106-198).

- [x] PASS -- **Lazy initialization where needed (Anthropic).** All three Anthropic client initializations use singleton lazy patterns:
  - `claudeExtraction.ts:42-57`: `let anthropicClient: Anthropic | null = null;` with `getAnthropicClient()` factory
  - `sbcExtraction.ts:314-324`: Same pattern with `getAnthropicClient()`
  - `emailService.ts:28-46`: SendGrid client lazy-loaded with `getSendGridClient()`
  - `ocrService.ts:75-108`: Document AI client lazy-loaded with `getDocumentAIClient()`

  **Note:** `expenseController.ts:293-299` and `biomarkerRoutes.ts:106-114` create new Anthropic instances per request rather than using the singleton. This works but is less efficient and inconsistent.

- [x] PASS -- **Missing secrets cause clear error messages.** The production validation at `config/index.ts:106-197` throws descriptive `Error` messages for missing or invalid secrets with generation instructions. The `EncryptionService` constructor (`encryption.ts:139-165`) produces a formatted ASCII-art error box. Service-specific checks (OCR, Claude, SendGrid) throw `InternalServerError` with clear messages or return graceful 503 responses.

- [x] PASS -- **Secrets not logged even in debug mode.** The logger utility (`utils/logger.ts:21-27`) defines a `SENSITIVE_FIELDS` set including `password`, `token`, `accessToken`, `refreshToken`, `secret`, `ssn`, `memberId`, `groupNumber`, etc. The `sanitizeData` function (lines 32-44) redacts these fields to `'[REDACTED]'` before any log output. In production, debug and info logs are suppressed entirely (line 51).

  **Minor finding:** The `SENSITIVE_FIELDS` check at `logger.ts:35` uses `key.toLowerCase()` for comparison, but the set itself contains camelCase entries. This means a field named `PASSWORD` (uppercase) would match, but a field named `apiKey` would NOT match because `'apikey'` is not in the set. Consider adding `'apikey'`, `'apiKey'`, `'authorization'` to the set.

---

## Critical Findings

### CRITICAL-1: Live API Key in Local .env File on OneDrive

**Severity:** CRITICAL
**File:** `backend/.env:127`
**Finding:** The local `backend/.env` contains a live Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-api03-REDACTED
```
While this file is git-ignored and not committed, the project directory is under `OneDrive\Desktop`, meaning this file is synced to Microsoft cloud storage. This API key should be **rotated immediately** via the Anthropic console.

**Remediation:**
1. Rotate the Anthropic API key at https://console.anthropic.com/
2. Update the local `.env` with the new key
3. Consider moving the project out of the OneDrive-synced directory, or configure OneDrive to exclude `.env` files

### CRITICAL-2: Database Password and IP Exposed in Local .env

**Severity:** CRITICAL
**File:** `backend/.env:30`
**Finding:** Contains a real database connection string with password and public IP:
```
DATABASE_URL="postgresql://postgres:REDACTED@REDACTED:5432/ownmyhealth"
```
Same OneDrive-sync risk as CRITICAL-1.

**Remediation:**
1. Rotate the database password on Cloud SQL
2. Ensure Cloud SQL only allows connections from authorized networks/Cloud Run
3. Consider using Cloud SQL Auth Proxy instead of direct IP connection

### HIGH-1: PHI Encryption Key Uses Known Insecure Placeholder Locally

**Severity:** HIGH
**File:** `backend/.env:75`
**Finding:** The local development environment uses the known insecure placeholder:
```
PHI_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```
While this is acceptable for local development (the production validation would reject it), any PHI data encrypted with this key in development is trivially decryptable. If development databases contain real user data, this is a risk.

**Remediation:** Generate a unique development key with `openssl rand -hex 32`.

### HIGH-2: JWT Secrets Use Default Values Locally

**Severity:** HIGH
**File:** `backend/.env:39,47`
**Finding:** Both JWT secrets are set to their default placeholder values:
```
JWT_ACCESS_SECRET=access-secret-change-in-production
JWT_REFRESH_SECRET=refresh-secret-change-in-production
```
Production validation would reject these, but local development tokens are signed with publicly known strings.

### MEDIUM-1: Production .env.example Has Incorrect Variable Names

**Severity:** MEDIUM
**File:** `backend/.env.production.example:29,31`
**Finding:** Uses `JWT_ACCESS_EXPIRES_IN=15m` and `JWT_REFRESH_EXPIRES_IN=7d` (string format), but `config/index.ts:17,21` reads `JWT_ACCESS_EXPIRES_SECONDS` and `JWT_REFRESH_EXPIRES_SECONDS` (integer format). A production deployment following this example would use default 900/604800 second values instead of the configured values.

### MEDIUM-2: backend/.gitignore Has Corrupted Line

**Severity:** MEDIUM
**File:** `backend/.gitignore:35-37`
**Finding:** The `gcp-ocr-key.json` gitignore entry appears corrupted with space-separated characters and duplicate entries:
```
gcp-ocr-key.jsong c p - o c r - k e y . j s o n
 g c p - o c r - k e y . j s o n . j s o n
```
This may not correctly ignore the GCP OCR key file. Should be cleaned up to simply `gcp-ocr-key.json`.

### MEDIUM-3: SENDGRID_API_KEY Not Validated at Production Startup

**Severity:** MEDIUM
**File:** `backend/src/config/index.ts:107-112`
**Finding:** The `requiredEnvVars` list only checks `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, and `PHI_ENCRYPTION_KEY`. If email functionality is required in production (email verification, password reset), `SENDGRID_API_KEY` should be added to the required list.

### LOW-1: Inconsistent Anthropic Client Instantiation

**Severity:** LOW
**Files:** `backend/src/controllers/expenseController.ts:299`, `backend/src/routes/biomarkerRoutes.ts:106`
**Finding:** These two locations create a new `Anthropic` client instance per request instead of using the singleton pattern established in `claudeExtraction.ts` and `sbcExtraction.ts`. This wastes resources and is inconsistent.

### LOW-2: CORS_ORIGIN Not Validated in Production Startup

**Severity:** LOW
**File:** `backend/src/config/index.ts:185-188`
**Finding:** The config only warns about localhost in CORS origin during production but does not enforce that `CORS_ORIGIN` is set. If it is not set, the default array of localhost ports will be used in production, which is a security risk. This should be a fatal error, not just a warning.

---

## Environment Variable Reference (Verified)

| Variable | Required | In config/index.ts | In .env.example | In Production Check | Status |
|----------|----------|-------------------|-----------------|-------------------|--------|
| DATABASE_URL | Yes | Implicit (Prisma) | Yes | Yes (line 110) | OK |
| JWT_ACCESS_SECRET | Yes | Line 16 | Yes | Yes (line 108) | OK |
| JWT_REFRESH_SECRET | Yes | Line 20 | Yes | Yes (line 109) | OK |
| PHI_ENCRYPTION_KEY | Yes | Line 152 (encryption.ts:140) | Yes | Yes (line 111) | OK |
| ANTHROPIC_API_KEY | Yes | Lines 106, 293, 49, 316 (various services) | Yes | No | Missing from prod check |
| SENDGRID_API_KEY | Yes | Line 82-83 | Yes (.production.example) | No | Missing from prod check |
| GOOGLE_APPLICATION_CREDENTIALS | Yes | Line 94 | No (backend only) | No | Missing from prod check |
| NODE_ENV | Yes | Line 9 | Yes | N/A (implicit) | OK |
| PORT | No | Line 10 | Yes | N/A | OK |
| CORS_ORIGIN | Yes | Line 56 | Yes | Warn only (line 186) | Should be required |
| GCS_BUCKET_NAME | Yes | Line 91 | No | No | Missing from docs & check |
| GCP_PROJECT_ID | Yes | Line 92 | Yes (.env has it) | No | Missing from prod check |
| EMAIL_FROM | Yes | Line 84 | Yes (.production.example) | No | OK (has default) |
| EMAIL_FROM_NAME | No | Line 85 | Yes (.production.example) | No | OK (has default) |
| FRONTEND_URL | Yes | Line 86 | Yes (.production.example) | No | Missing from prod check |
| MAX_LOGIN_ATTEMPTS | No | Line 49 | Yes | No | OK (has default) |
| LOCKOUT_DURATION_MINUTES | No | Line 50 | Yes | No | OK (has default) |
| BCRYPT_ROUNDS | No | Line 51 | Yes | No | OK (has default) |
| DEMO_ACCOUNT_ENABLED | No | Line 75 | Yes | Blocked (line 191) | OK |
| DEMO_EMAIL | No | Line 76 | Yes | N/A | OK |
| DEMO_PASSWORD | No | Line 77 | Yes | N/A | OK |

**Undocumented variables found in config/index.ts:**
- `JWT_SECRET` (legacy, line 24)
- `JWT_EXPIRES_SECONDS` (legacy, line 25)
- `JWT_ACCESS_EXPIRES_SECONDS` (line 17)
- `JWT_REFRESH_EXPIRES_SECONDS` (line 21)
- `COOKIE_SAME_SITE` (line 38)
- `COOKIE_DOMAIN` (line 40)
- `RATE_LIMIT_WINDOW_MS` (line 68)
- `RATE_LIMIT_MAX_REQUESTS` (line 69)
- `DISABLE_CSRF` (app.ts:161, csrf.ts:166)
- `GCP_PROCESSOR_ID` (ocrService.ts)
- `GCP_LOCATION` (ocrService.ts)

---

## Questions Answered

### 1. Are all secrets documented?
**Partially.** The core secrets are well-documented in `.env.example` files. However, several variables used in the code are not documented in any `.env.example` file: `GCS_BUCKET_NAME`, `GCP_PROCESSOR_ID`, `GCP_LOCATION`, `DISABLE_CSRF`, `COOKIE_SAME_SITE`, `COOKIE_DOMAIN`. The `backend/.env.example` documents cookie and CORS variables but in commented form.

### 2. Can secrets be rotated without deployment?
**Yes, with caveats.** JWT and API key secrets can be rotated by updating GCP Secret Manager and restarting the Cloud Run service (no code change or redeployment needed). However, `PHI_ENCRYPTION_KEY` rotation would require a data re-encryption migration. The `EncryptionService.reEncrypt()` method exists but no migration tooling is built.

### 3. Are there any secrets in the Git history?
**Minimal risk.** A root `.env` was committed in commit `1e4a167` but only contained placeholder Supabase values (`your-project-url.supabase.co`, `your-anon-key`). It was removed in commit `8cbf298`. No real secrets were found in git history. The `backend/.env` with real secrets was never committed to git.

---

## Recommendations (Priority Order)

1. **IMMEDIATE:** Rotate the Anthropic API key exposed in `backend/.env` on OneDrive
2. **IMMEDIATE:** Rotate the database password exposed in `backend/.env` on OneDrive
3. **HIGH:** Fix the corrupted `backend/.gitignore` entry for `gcp-ocr-key.json`
4. **HIGH:** Add `CORS_ORIGIN`, `SENDGRID_API_KEY`, `ANTHROPIC_API_KEY`, `FRONTEND_URL`, `GCP_PROJECT_ID`, and `GCS_BUCKET_NAME` to the production startup validation in `config/index.ts`
5. **HIGH:** Fix the variable name mismatch in `backend/.env.production.example` (use `_SECONDS` suffix)
6. **MEDIUM:** Move project out of OneDrive-synced directory or configure OneDrive exclusions for `.env` files
7. **MEDIUM:** Add `'apikey'`, `'authorization'`, `'cookie'` to the `SENSITIVE_FIELDS` set in `logger.ts`
8. **MEDIUM:** Document secret rotation procedures, especially for `PHI_ENCRYPTION_KEY`
9. **LOW:** Refactor `expenseController.ts` and `biomarkerRoutes.ts` to use singleton Anthropic client
10. **LOW:** Make `CORS_ORIGIN` a fatal error (not just warning) when containing localhost in production
