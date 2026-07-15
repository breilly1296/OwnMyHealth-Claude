---
tags:
  - security
  - infrastructure
  - critical
type: prompt
priority: 1
updated: 2026-06-16
---

# Environment & Secrets Review

## Files to Review
- `backend/src/config/index.ts` (config loading + startup validation/hard-fails)
- `backend/src/config/jwtOptions.ts`, `backend/src/config/plans.ts` (sibling config modules)
- `.env.example` (frontend documented variables — VITE_*)
- `backend/.env.example` (backend-specific documented variables)
- `.github/workflows/ci.yml` (the actual secret-hygiene gate — gitleaks secret scan + `npm audit --audit-level=high` + RLS-wrapper guard; `deploy.yml` invokes it via `workflow_call` and `needs: ci`)
- `.github/workflows/deploy.yml`, `.github/workflows/deploy-staging.yml` (CI/CD secrets; deploy is now gated on `ci.yml`)
- `.github/workflows/maintenance.yml` (one-time data-migration Cloud Run job — same secret wiring)
- `backend/Dockerfile` (build-time variables; note migrations do NOT run at boot — see §4)
- Note: some env vars are read directly via `process.env` outside `config/index.ts`
  (e.g. `GCP_PROCESSOR_ID`, `GCP_LOCATION` in `ocrService.ts`; `DISABLE_CSRF` in `csrf.ts`/`app.ts`; `DATABASE_POOL_SIZE` (default 10, pg pool `max`) in `database.ts:108` — grep `process.env` across `backend/src/`).
  `RLS_ENFORCEMENT` is documented in `.env.example` but NOT actually read by code — the BYPASSRLS posture is hardcoded in `database.ts → assertNoBypassRLS()` (prod hard-exits, non-prod warns). Flag the documented-but-dead flag.

## OwnMyHealth Secrets Architecture
- **Secret Storage**: GCP Secret Manager
- **Access**: Mounted as environment variables in Cloud Run
- **Local Dev**: `.env` files (not committed)

## Checklist

### 1. Secret Manager Inventory
Verify these secrets exist and are used:

**Critical Secrets (Secret Manager):**
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `JWT_ACCESS_SECRET` - Access token signing (`requireEnv` — no fallback in ANY env; min 32 chars; blocked-placeholder list enforced)
- [ ] `JWT_REFRESH_SECRET` - Refresh token signing (`requireEnv` — same rules)
- [ ] `PHI_ENCRYPTION_KEY` - AES encryption key (64 hex chars, 256-bit; format + insecure-key checks in prod/staging)
- [ ] `AUDIT_LOG_SALT` - Audit-log encryption salt (C-8; min 16 chars; hard-fail at boot — rotating it makes historic audit PHI undecryptable)
- [ ] `ANTHROPIC_API_KEY` - Claude API access
- [ ] `SENDGRID_API_KEY` - Email service
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` - GCP service account credentials JSON path
- [ ] `AUDIT_CLEANUP_TOKEN` - shared secret for `POST /api/v1/internal/audit-cleanup` (Cloud Scheduler); unset ⇒ endpoint 404s + in-process interval runs (audit #38)
- [ ] `QUEST_FHIR_CLIENT_SECRET` - Quest SMART-on-FHIR OAuth client secret (only sent to allowlisted `QUEST_FHIR_AUTH_HOSTS`)

**Configuration Variables (Environment):**
- [ ] `NODE_ENV` - Runtime mode (`development` | `staging` | `production`; staging is production-like with carveouts)
- [ ] `PORT` - Server port (3001)
- [ ] `CORS_ORIGIN` - Allowed frontend origins
- [ ] `FRONTEND_URL` - Frontend URL for email links
- [ ] `GCS_BUCKET_NAME` - Google Cloud Storage bucket (dev/staging fallback `ownmyhealth-user-files`; hard-fail if unset in prod — F-28)
- [ ] `GCP_PROJECT_ID` - GCP project identifier
- [ ] `GCP_PROCESSOR_ID` - Document AI processor (read directly via `process.env` in `ocrService.ts`, NOT in config object; presence triggers the `GOOGLE_BAA_ACTIVE` gate)
- [ ] `GCP_LOCATION` - Document AI region (read via `process.env` in `ocrService.ts`, default `us`)
- [ ] `EMAIL_FROM` - Sender email address (default `noreply@ownmyhealth.com`)
- [ ] `EMAIL_FROM_NAME` - Sender display name (default `OwnMyHealth`)
- [ ] `SENDGRID_SANDBOX_MODE` - validates but never delivers; forced on in staging; hard-fail if `true` in prod
- [ ] `REDIS_URL` - shared rate-limit store (Cloud Memorystore); unset ⇒ per-instance in-memory store (audit #37)

**BAA Gates (HIPAA — PHI disclosure to third parties):**
- [ ] `ANTHROPIC_BAA_ACTIVE` - asserts signed Anthropic BAA (C-7); prod hard-fails if `ANTHROPIC_API_KEY` set but this unset; dev/staging warn (runtime gate in `claudeExtraction`/`sbcExtraction` is load-bearing)
- [ ] `GOOGLE_BAA_ACTIVE` - asserts signed Google Cloud BAA covering Document AI image OCR; prod hard-fails if `GCP_PROCESSOR_ID` set but this unset; runtime gate in `ocrService.processImageWithDocumentAI`

**AI Spend Control (cost circuit breaker):**
- [ ] `AI_DAILY_BUDGET_USD` - per-UTC-day global cap (default 50; 0 = disabled); enforced by `aiSpendGuard` middleware, accumulated by `aiCostTracker`
- [ ] `AI_USER_DAILY_BUDGET_USD` - per-user per-day cap (default 5); NOTE: accumulator is in-memory/per-instance (N×budget under autoscale)

**Quest Diagnostics SMART-on-FHIR (optional lab sync):**
- [ ] `QUEST_FHIR_CLIENT_ID` - OAuth client id (feature disabled unless set; "Connect Quest" returns 503)
- [ ] `QUEST_FHIR_BASE_URL` - FHIR R4 base (default `https://api.questdiagnostics.com/fhir/r4`; point at mock server for local dev)
- [ ] `QUEST_FHIR_REDIRECT_URI` - OAuth callback URI
- [ ] `QUEST_FHIR_SUCCESS_REDIRECT` - post-callback frontend redirect
- [ ] `QUEST_FHIR_AUTH_HOSTS` - SSRF/exfil allowlist for authorize/token/revoke hosts (comma-separated; empty ⇒ must be on FHIR base host)

**Security / JWT / Cookie Configuration:**
- [ ] `JWT_ACCESS_EXPIRES_SECONDS` - access token TTL in SECONDS, integer (default 900)
- [ ] `JWT_REFRESH_EXPIRES_SECONDS` - refresh token TTL in SECONDS, integer (default 604800)
- [ ] `MAX_LOGIN_ATTEMPTS` - Account lockout threshold (default: 5)
- [ ] `LOCKOUT_DURATION_MINUTES` - Lockout duration (default: 30)
- [ ] `BCRYPT_ROUNDS` - Password hashing cost (default: 13 in code AND `backend/.env.example:113`, in sync — no mismatch to flag)
- [ ] `COOKIE_SAME_SITE` - `strict|lax|none` override (prod same-domain default `strict` per F-18; cross-domain needs `none`)
- [ ] `COOKIE_DOMAIN` - cross-subdomain cookie domain (leading dot, e.g. `.ownmyhealth.io`)
- [ ] `RATE_LIMIT_WINDOW_MS` (default 900000) / `RATE_LIMIT_MAX_REQUESTS` (default 100)

**Demo Configuration (non-production only — hard-fail if `DEMO_ACCOUNT_ENABLED=true` in prod):**
- [ ] `DEMO_ACCOUNT_ENABLED` - Enable demo login
- [ ] `DEMO_EMAIL` - Demo account email
- [ ] `DEMO_PASSWORD` - Demo account password (no hardcoded fallback)

### 2. No Hardcoded Secrets
Search for hardcoded values:
```bash
# Search for potential hardcoded secrets
grep -r "sk-ant\|password.*=.*['\"]" backend/src/ --include="*.ts"
grep -r "secret.*=.*['\"]" backend/src/ --include="*.ts" | grep -v "process.env"
# AI / FHIR / GCP keys and OAuth client secrets
grep -rn "client_secret\|clientSecret\|QUEST_FHIR\|AIza\|-----BEGIN" backend/src/ --include="*.ts"
```
- [ ] No API keys in source code (Anthropic, SendGrid, Quest OAuth)
- [ ] No passwords in source code
- [ ] No connection strings in source code
- [ ] No service-account JSON / private keys committed (`.gitignore` covers `*-key.json`, `*-credentials.json`, `service-account*.json`, `*.pem`, `*.key`, `*.p12`, `*.pfx`)
- [ ] Note the intentional, deliberately-invalid placeholders in `backend/.env.example` (`PHI_ENCRYPTION_KEY=REPLACE_WITH_openssl_rand_hex_32`, `DEMO_PASSWORD=CHANGE_ME_...`) — these fail validation by design, not real secrets

### 3. Environment Variable Documentation
- [ ] All required variables documented in `backend/.env.example`
- [ ] Optional variables marked as optional
- [ ] Example values don't contain real secrets
- [ ] Format/validation requirements noted (e.g. JWT secrets are SECONDS not "15m"; PHI key is 64 hex)
- [ ] **Drift check**: `backend/.env.example` was rewritten and now documents EVERY env var
      read by `config/index.ts` — the previously-omitted set (`SENDGRID_API_KEY:201`,
      `EMAIL_FROM:205`, `EMAIL_FROM_NAME:208`, `SENDGRID_SANDBOX_MODE:218`,
      `GCS_BUCKET_NAME:227`, `GCP_PROJECT_ID:230`, `GCP_PROCESSOR_ID:235`, `GCP_LOCATION:238`,
      `GOOGLE_APPLICATION_CREDENTIALS:243`, `GOOGLE_BAA_ACTIVE:250`, `AI_DAILY_BUDGET_USD:278`,
      `AI_USER_DAILY_BUDGET_USD:280`, `QUEST_FHIR_AUTH_HOSTS:300`) is now all present. Do NOT
      report these as documentation gaps. Still verify any NEW config var introduced since the
      last refresh appears in `.env.example`; the one var read by code but historically missed
      is `DATABASE_POOL_SIZE` (`backend/.env.example:32-34`, default 10) — now documented.
- [ ] **Stale defaults**: none currently — `BCRYPT_ROUNDS` is `13` in both code
      (`config/index.ts:160`) and `backend/.env.example:113`. (Re-check on each refresh.)
- [ ] No removed-integration cruft: `CMS_API_KEY` / `OPENAI_API_KEY` (CMS Marketplace / OpenAI)
      do NOT appear in `backend/.env.example` or the frontend `.env.example` — there is no
      "external APIs" block listing dead integrations (the frontend "External Services" block at
      `.env.example:27-33` lists only optional Supabase vars). Nothing to flag here.

### 4. Secret Rotation
- [ ] Secrets can be rotated without code changes
- [ ] Process documented for rotating each secret
- [ ] No secrets embedded in Docker images
- [ ] **Migrations run as a dedicated Cloud Run job, NOT at container boot.** The Dockerfile
      CMD is just `["node", "dist/app.js"]` (`backend/Dockerfile:86`, "Migrations do NOT run at
      boot"). `prisma migrate deploy` runs in the `ownmyhealth-migrate` Cloud Run job
      (`deploy.yml:43` `MIGRATE_JOB`, executed `deploy.yml:139,158`), wired to the same secret
      via `--set-secrets "DATABASE_URL=DATABASE_URL:latest"` (`deploy.yml:144`) and the same
      Cloud SQL instance via `--set-cloudsql-instances` (`deploy.yml:143`,
      `CLOUDSQL_INSTANCE:46`), run as the service runtime SA. Verify DATABASE_URL reaches the
      migrate job the same way it reaches the service (no migrate-specific secret exists).

### 5. CI/CD Secrets
GitHub Actions secrets actually referenced in `deploy.yml` / `deploy-staging.yml`:
- [ ] `GCP_SA_KEY` (service account JSON, passed to `google-github-actions/auth`) — the ONLY repo secret used
- [ ] `PROJECT_ID`, `REGION`, `SERVICE`, `REPOSITORY`, `FRONTEND_BUCKET`, `MIGRATE_JOB`
      (`ownmyhealth-migrate`), and `CLOUDSQL_INSTANCE`
      (`ownmyhealth-prod:us-central1:ownmyhealth-db`) are workflow `env:` values
      (`deploy.yml:37-46`), NOT secrets (do not check them as secrets)
- [ ] Secrets not echoed in logs
- [ ] App env vars / Secret Manager values are injected at the Cloud Run service level (not in the workflow); `--update-env-vars` traffic-pinning caveat applies (see `cloud-run-env-update-pinning` notes)
- [ ] **Deploy is gated on `ci.yml`** (`deploy.yml:57-58` `uses: ./.github/workflows/ci.yml`,
      `:66` `needs: ci`) — that reusable workflow is where the secret-hygiene gate lives
      (gitleaks secret scan + `npm audit --audit-level=high` + RLS-wrapper guard). Verify the
      deploy jobs cannot run if `ci` fails.
- [ ] **F-30 DONE — third-party actions are pinned to full 40-char commit SHAs** (with a
      trailing version comment), NOT floating tags: `actions/checkout@34e11487…# v4.3.1`
      (`deploy.yml:74,305`), `google-github-actions/auth@c200f369…# v2.1.13`
      (`deploy.yml:77,257,308`), `setup-gcloud@e427ad8a…# v2.2.1` (`deploy.yml:83,263,314`);
      `deploy-staging.yml` carries the same SHA pins. No supply-chain TODO remains here — flag
      only a NEW unpinned/tag-only action if one is introduced.

### 6. Local Development
- [ ] `.env` files in `.gitignore`
- [ ] `.env.local` files in `.gitignore`
- [ ] No real secrets in committed files
- [ ] Clear instructions for local setup

### 7. Secret Access Patterns
- [ ] Secrets loaded once at startup (the `config` object in `config/index.ts`)
- [ ] Lazy initialization where needed (Anthropic via `anthropicClient`)
- [ ] Missing secrets cause clear error messages (`requireEnv()` throws at module load)
- [ ] Secrets not logged even in debug mode (cross-ref `phiRedaction.ts` / logger)

### 8. Startup Validation Hard-Fails (verify each in `config/index.ts`)
These are the load-bearing boot-time guards — confirm each still fires:
- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` missing → throw (every env); blocked-placeholder set rejected; min 32 chars
- [ ] `AUDIT_LOG_SALT` missing or < 16 chars → throw (every env)
- [ ] prod/staging only: `DATABASE_URL`, `PHI_ENCRYPTION_KEY` required; PHI key must be 64+ hex, not an insecure placeholder
- [ ] prod: `GCS_BUCKET_NAME` required (F-28); `DEMO_ACCOUNT_ENABLED=true` forbidden; `SENDGRID_SANDBOX_MODE=true` forbidden
- [ ] BAA gates: prod throws if `ANTHROPIC_API_KEY` set without `ANTHROPIC_BAA_ACTIVE`, or `GCP_PROCESSOR_ID` set without `GOOGLE_BAA_ACTIVE`; dev/staging warn (runtime gates in `claudeExtraction`/`sbcExtraction`/`ocrService` are the real backstop)
- [ ] prod/staging warn (non-fatal) when `ANTHROPIC_API_KEY` / `SENDGRID_API_KEY` / `GCP_PROJECT_ID` unset

### 9. SSRF / Egress Allowlists (secret exfil surface)
- [ ] `QUEST_FHIR_AUTH_HOSTS` allowlist enforced before the patient Bearer token or OAuth `client_secret` is sent (see `services/fhir/urlSafety.ts`); empty allowlist ⇒ SMART endpoints must live on the FHIR base host
- [ ] AI budget caps (`AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD`) wired through `aiSpendGuard` so a compromised `ANTHROPIC_API_KEY` can't run up unbounded billing

## Environment Variable Reference

| Variable | Required | Source | Purpose |
|----------|----------|--------|---------|
| DATABASE_URL | Yes (prod/staging) | Secret Manager | DB connection |
| DATABASE_POOL_SIZE | No (default 10) | Environment | pg pool `max` (read via `process.env` in `database.ts:108`, NOT in config object) |
| JWT_ACCESS_SECRET | Yes (all envs) | Secret Manager | Access token signing (`requireEnv`) |
| JWT_REFRESH_SECRET | Yes (all envs) | Secret Manager | Refresh token signing (`requireEnv`) |
| JWT_ACCESS_EXPIRES_SECONDS | No | Environment | Access TTL (seconds, default 900) |
| JWT_REFRESH_EXPIRES_SECONDS | No | Environment | Refresh TTL (seconds, default 604800) |
| PHI_ENCRYPTION_KEY | Yes (prod/staging) | Secret Manager | PHI encryption (64 hex) |
| AUDIT_LOG_SALT | Yes (all envs, ≥16) | Secret Manager | Audit-log encryption salt |
| ANTHROPIC_API_KEY | No (warns if unset) | Secret Manager | Claude API |
| ANTHROPIC_BAA_ACTIVE | Yes if key+prod | Environment | Assert Anthropic BAA |
| AI_DAILY_BUDGET_USD | No | Environment | Global daily AI cap (default 50) |
| AI_USER_DAILY_BUDGET_USD | No | Environment | Per-user daily AI cap (default 5) |
| SENDGRID_API_KEY | No (warns if unset) | Secret Manager | Email service |
| SENDGRID_SANDBOX_MODE | No | Environment | Validate-but-don't-send (forbidden in prod) |
| EMAIL_FROM | No | Environment | Sender email |
| EMAIL_FROM_NAME | No | Environment | Sender name |
| GOOGLE_APPLICATION_CREDENTIALS | Yes (prod) | Secret Manager / file path | GCP service account JSON |
| GCS_BUCKET_NAME | Yes (prod, F-28) | Environment | File storage bucket |
| GCP_PROJECT_ID | No (warns if unset) | Environment | GCP project |
| GCP_PROCESSOR_ID | No (gates OCR) | Environment | Document AI processor (`ocrService.ts`) |
| GCP_LOCATION | No (default `us`) | Environment | Document AI region (`ocrService.ts`) |
| GOOGLE_BAA_ACTIVE | Yes if processor+prod | Environment | Assert Google Document AI BAA |
| AUDIT_CLEANUP_TOKEN | No | Secret Manager | Cloud Scheduler cleanup auth (audit #38) |
| REDIS_URL | No | Secret Manager | Shared rate-limit store (audit #37) |
| QUEST_FHIR_CLIENT_ID | No (disables feature) | Environment | SMART-on-FHIR client id |
| QUEST_FHIR_CLIENT_SECRET | No | Secret Manager | SMART-on-FHIR client secret |
| QUEST_FHIR_BASE_URL | No | Environment | FHIR R4 base URL |
| QUEST_FHIR_REDIRECT_URI | No | Environment | OAuth callback URI |
| QUEST_FHIR_SUCCESS_REDIRECT | No | Environment | Post-callback frontend redirect |
| QUEST_FHIR_AUTH_HOSTS | No | Environment | SSRF allowlist for auth/token/revoke hosts |
| NODE_ENV | Yes | Environment | Runtime mode (dev/staging/production) |
| PORT | No | Environment | Server port (default 3001) |
| CORS_ORIGIN | Yes (prod) | Environment | Allowed origins |
| FRONTEND_URL | No | Environment | Email link base |
| COOKIE_SAME_SITE | No | Environment | strict/lax/none override |
| COOKIE_DOMAIN | No | Environment | Cross-subdomain cookie domain |
| MAX_LOGIN_ATTEMPTS | No | Environment | Lockout threshold (default 5) |
| LOCKOUT_DURATION_MINUTES | No | Environment | Lockout duration (default 30) |
| BCRYPT_ROUNDS | No | Environment | Hash cost (default 13) |
| RATE_LIMIT_WINDOW_MS | No | Environment | Rate-limit window (default 900000) |
| RATE_LIMIT_MAX_REQUESTS | No | Environment | Rate-limit max (default 100) |
| DISABLE_CSRF | No (dev only) | Environment | Disable CSRF (dev only; `csrf.ts`/`app.ts`) |
| DEMO_ACCOUNT_ENABLED | No | Environment | Demo mode flag (forbidden in prod) |
| DEMO_EMAIL | No | Environment | Demo email |
| DEMO_PASSWORD | No | Environment | Demo password |

## Questions to Ask
1. Are all secrets documented in `backend/.env.example`, and conversely are any documented vars dead/removed? (As of this refresh, CMS/OpenAI cruft is gone; the one documented-but-dead flag remaining is `RLS_ENFORCEMENT` in the frontend `.env.example` — not read by code.)
2. Can secrets be rotated without deployment? (Note `AUDIT_LOG_SALT` and `PHI_ENCRYPTION_KEY` are NOT rotatable in place — rotating breaks decryption of historic PHI/audit data.)
3. Are there any secrets in the Git history?
4. Are the BAA gates (`ANTHROPIC_BAA_ACTIVE`, `GOOGLE_BAA_ACTIVE`) actually set to `true` in prod, or is PHI egress to Claude/Document AI being blocked by the runtime gates instead?
5. Is `QUEST_FHIR_AUTH_HOSTS` set so the OAuth client secret + patient token can only egress to approved hosts?
6. Are the AI budget caps (`AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD`) sized for the real Cloud Run `--max-instances` (in-memory accumulator means effective cap is N×budget)?
7. Is `REDIS_URL` provisioned so rate limiters share state across instances, or are per-instance counters letting an attacker get N×limit?
