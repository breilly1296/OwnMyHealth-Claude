# 11-environment-secrets Review — 2026-06-01

Scope: environment-variable loading, startup hard-fails, secret hygiene, CI/CD secret handling, and SSRF/egress + AI-budget guards as enumerated in `prompts/11-environment-secrets.md`. All paths are repo-relative to `C:/Users/breil/Projects/OwnMyHealth/`. Report only — no code modified.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 6 |

The environment/secrets surface is in good shape: secrets go through `requireEnv()` (no fallbacks in any env), the production/staging boot path hard-fails on every load-bearing guard, the FHIR SSRF allowlist and AI budget caps are wired, and there are no real secrets in source or git history. All findings are documentation drift / hygiene (Low). The bulk of the prompt's own caveats (drift items it flagged) are confirmed accurate against the live code.

## Findings

### F-1 — `backend/.env.example` omits many env vars the code reads — **Low**
- **Location:** `backend/.env.example` (whole file; cf. `backend/src/config/index.ts:148-224`)
- **Observation:** `config/index.ts` reads `SENDGRID_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `SENDGRID_SANDBOX_MODE`, `GCS_BUCKET_NAME`, `GCP_PROJECT_ID`, `GCP_PROCESSOR_ID`, `GCP_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_BAA_ACTIVE`, `AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD`, and `QUEST_FHIR_AUTH_HOSTS`, none of which appear in `backend/.env.example`. (`COOKIE_SAME_SITE`, `COOKIE_DOMAIN`, `QUEST_FHIR_CLIENT_SECRET` ARE present — not flagged.) Matches the prompt's drift list exactly.
- **Impact:** An operator copying `.env.example` for a new deploy has no prompt for email sender config, the GCS bucket, the Document AI BAA gate, the AI cost circuit-breaker, or the FHIR SSRF allowlist. Missing `GCS_BUCKET_NAME`/`GOOGLE_BAA_ACTIVE` are caught by prod hard-fails, but `QUEST_FHIR_AUTH_HOSTS` and the AI budgets fail open silently (feature works but with the in-memory/default posture).
- **Fix:** Add the 13 variables above to `backend/.env.example` with format notes (mark optional ones as optional). Source of truth is the `config` object in `config/index.ts:38-224`.
- **Evidence:**
  ```ts
  // config/index.ts:158
  sandboxMode: process.env.SENDGRID_SANDBOX_MODE === 'true' || isStagingEnv,
  // config/index.ts:220 — read by code, absent from .env.example
  authHosts: (process.env.QUEST_FHIR_AUTH_HOSTS || '')
  ```

### F-2 — `BCRYPT_ROUNDS` documented as 12 but code default is 13 — **Low**
- **Location:** `backend/.env.example:107-109` vs `backend/src/config/index.ts:100`
- **Observation:** `.env.example` says "default: 12" and sets `BCRYPT_ROUNDS=12`; the code defaults to `13` (and the inline comment there says "13 rounds minimum recommended for healthcare/HIPAA").
- **Impact:** Cosmetic/operational. An operator trusting the example would set 12, weakening the cost factor below the code's intended HIPAA baseline of 13. No exploit, but it undoes the F-? hardening that bumped the default.
- **Fix:** Change `backend/.env.example:107-109` to document and set `BCRYPT_ROUNDS=13` to match `config/index.ts:100`.
- **Evidence:**
  ```
  # .env.example:107  Bcrypt hashing rounds (default: 12, higher = more secure but slower)
  # .env.example:109  BCRYPT_ROUNDS=12
  ```
  ```ts
  // config/index.ts:100
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '13', 10),
  ```

### F-3 — Dead integrations still documented as live secrets in `backend/.env.example` (CMS, OpenAI) — **Low**
- **Location:** `backend/.env.example:189-203`
- **Observation:** The "External APIs" block documents `CMS_API_KEY`, `CMS_API_BASE_URL`, `CMS_API_TIMEOUT_MS`, and `OPENAI_API_KEY`. None are read anywhere in `backend/src/` (grep for `process.env.CMS`/`process.env.OPENAI` returns no hits), and CMS Marketplace + OpenAI are listed as removed features in `CLAUDE.md`.
- **Impact:** Misleading documentation — implies the app integrates with CMS Marketplace / OpenAI. Risk is an operator provisioning and storing real keys for services the app never calls (needless secret sprawl / attack surface).
- **Fix:** Delete the `CMS_API_KEY`/`CMS_API_BASE_URL`/`CMS_API_TIMEOUT_MS`/`OPENAI_API_KEY` lines from `backend/.env.example:193-203`.
- **Evidence:**
  ```
  # .env.example:196  CMS_API_KEY=
  # .env.example:203  # OPENAI_API_KEY=your-openai-api-key
  ```

### F-4 — `RLS_ENFORCEMENT` documented as a live flag in `backend/.env.example` but is dead code — **Low**
- **Location:** `backend/.env.example:88-95` vs `backend/src/services/database.ts:210`
- **Observation:** `.env.example` documents `RLS_ENFORCEMENT` with "unset/warn" vs "strict" semantics as if the startup assertion reads it. It does not: `process.env.RLS_ENFORCEMENT` is read nowhere (only a comment in `database.ts:210` states "The transitional `RLS_ENFORCEMENT=strict` flag was removed when the omh_app cutover landed"). The BYPASSRLS posture is hardcoded in `assertNoBypassRLS()` — prod `process.exit(1)`, non-prod warns.
- **Impact:** An operator could set `RLS_ENFORCEMENT=strict` believing it tightens enforcement; it has zero effect. Creates a false sense of a configurable control. Matches the prompt's explicit "documented-but-dead flag" call-out.
- **Fix:** Remove the `RLS_ENFORCEMENT` block from `backend/.env.example:88-95` (the real behavior is unconditional in `database.ts:218-261`).
- **Evidence:**
  ```
  # .env.example:91  Controls how the startup assertion reacts to a BYPASSRLS database role.
  # .env.example:95  # RLS_ENFORCEMENT=strict
  ```
  ```ts
  // database.ts:210 — flag is gone; only this comment references it
  *     unisolated PHI. The transitional `RLS_ENFORCEMENT=strict` flag
  ```

### F-5 — Production example env files reference a decommissioned host (Railway) — **Low**
- **Location:** `backend/.env.production.example:5-6,18,21,23`, `.env.production.example:6,10` (frontend). Also `backend/railway.toml` (stale Railway config still in repo).
- **Observation:** Both production example files describe Railway as the deploy target. The backend file says "These values are for Railway deployment" / "Railway will automatically provide DATABASE_URL" (`backend/.env.production.example:5-6`); the frontend file says "Set them in Railway's environment variable settings" / "your Railway backend service URL" (`.env.production.example:6,10`). The live deploy is GCP Cloud Run + Secret Manager + Cloud SQL (`.github/workflows/deploy.yml:21-25`, `CLAUDE.md`). The `.env.example` production checklist also recommends "AWS Secrets Manager, HashiCorp Vault" (`backend/.env.example:245`). A stale `backend/railway.toml` is also still committed.
- **Impact:** Documentation drift. An operator following these would look for Railway/AWS plumbing that doesn't exist, and might miss that secrets live in GCP Secret Manager mounted as Cloud Run env vars. No direct security impact.
- **Fix:** Update `backend/.env.production.example`, the frontend `.env.production.example`, and the `backend/.env.example` production checklist to reference GCP Secret Manager / Cloud Run / Cloud SQL; delete `backend/railway.toml` if Railway is fully decommissioned.
- **Evidence:**
  ```
  # backend/.env.production.example:5  # IMPORTANT: These values are for Railway deployment.
  # backend/.env.production.example:6  # Railway will automatically provide DATABASE_URL when you add a PostgreSQL plugin.
  # .env.production.example:6          # Set them in Railway's environment variable settings before deploying.
  ```

### F-6 — Third-party GitHub Actions pinned by mutable tag, not SHA — **Low**
- **Location:** `.github/workflows/deploy.yml:38,41,47,211` and `.github/workflows/deploy-staging.yml:26,29,35,104`
- **Observation:** `actions/checkout@v4`, `google-github-actions/auth@v2`, `google-github-actions/setup-gcloud@v2`, and `actions/setup-node@v4` are pinned to floating major-version tags. A version tag is mutable; a force-pushed/compromised release tag would be picked up on the next CI run. The repo already acknowledges this as a known TODO (F-30 follow-up) in the deploy.yml header comment.
- **Impact:** Supply-chain risk. These actions handle `secrets.GCP_SA_KEY` (the GCP service-account JSON with deploy rights to prod). A malicious action body could exfiltrate that key. Exploitability is low (requires upstream/tag compromise), blast radius is high (prod deploy credential), netting Low given the precondition.
- **Fix:** Pin each action to a full commit SHA (verified against the publisher's release page), per the existing F-30 TODO at `deploy.yml:1-13`. Let Dependabot/Renovate bump SHAs with reviewable diffs.
- **Evidence:**
  ```yaml
  # deploy.yml:41
  uses: google-github-actions/auth@v2
  # deploy.yml:43
  credentials_json: ${{ secrets.GCP_SA_KEY }}
  ```

## Checks passed

### Secret access patterns & startup hard-fails
- [x] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` via `requireEnv` — no fallback in ANY env — `config/index.ts:18-28,61,65` (throws at module load; test-confirmed `config/index.test.ts:60-86`).
- [x] Blocked-placeholder JWT set rejected — `config/index.ts:241-261` (test `config/index.test.ts:88-100`).
- [x] JWT secrets min 32 chars enforced (every env) — `config/index.ts:263-277` (test `config/index.test.ts:102-114`).
- [x] `AUDIT_LOG_SALT` missing or < 16 chars → throw (every env) — `config/index.ts:283-293`.
- [x] prod/staging require `DATABASE_URL`, `PHI_ENCRYPTION_KEY`; PHI key must be 64+ hex, not a known insecure placeholder — `config/index.ts:341-383`.
- [x] prod requires `GCS_BUCKET_NAME` (F-28) — `config/index.ts:399-405`.
- [x] prod forbids `DEMO_ACCOUNT_ENABLED=true` — `config/index.ts:408-414`.
- [x] prod forbids `SENDGRID_SANDBOX_MODE=true` — `config/index.ts:421-427`.
- [x] BAA gate: prod throws if `ANTHROPIC_API_KEY` set without `ANTHROPIC_BAA_ACTIVE`; dev/staging warn — `config/index.ts:300-313`.
- [x] BAA gate: prod throws if `GCP_PROCESSOR_ID` set without `GOOGLE_BAA_ACTIVE`; dev/staging warn — `config/index.ts:320-333`.
- [x] prod/staging non-fatal warnings when `ANTHROPIC_API_KEY` / `SENDGRID_API_KEY` / `GCP_PROJECT_ID` unset — `config/index.ts:431-439`.
- [x] Secrets loaded once at startup into the frozen `config` object — `config/index.ts:38-233` (`as const`).
- [x] Anthropic client lazy-initialized (doesn't crash boot when key unset) — `services/anthropicClient.ts:46-60`.
- [x] `DEMO_PASSWORD` has no hardcoded fallback — `config/index.ts:144` (`process.env.DEMO_PASSWORD || ''`).

### Runtime BAA backstops (load-bearing in dev/staging)
- [x] Claude PDF extraction runtime gate on `config.anthropic.baaActive` — `services/claudeExtraction.ts:106-110` (test `claudeExtraction.test.ts:110-115`).
- [x] SBC extraction runtime gate — `services/sbcExtraction.ts:766-771` (test `sbcExtraction.test.ts:58-62`).
- [x] Document AI image OCR runtime BAA gate — `services/ocrService.ts:269-279`.

### Direct `process.env` reads outside config object
- [x] `GCP_PROCESSOR_ID`, `GCP_PROJECT_ID`, `GCP_LOCATION` (default `us`), `GOOGLE_APPLICATION_CREDENTIALS` read in `ocrService.ts` — `services/ocrService.ts:83-117,466-471`.
- [x] `DISABLE_CSRF` is dev-only gated — `middleware/csrf.ts:146` (`config.isDevelopment && process.env.DISABLE_CSRF === 'true'`) and `app.ts:215`.
- [x] `ANTHROPIC_API_KEY` read for client construction / `isEnabled` only — `services/anthropicClient.ts:49,68`, `claudeExtraction.ts:276`, `sbcExtraction.ts:1031` (no key logging).
- [x] `storageService.ts` reads `GCP_PROJECT_ID` via config-first fallback — `services/storageService.ts:17`.

### No hardcoded secrets
- [x] No `sk-ant-` / `AIza...` / `-----BEGIN PRIVATE KEY` patterns in `backend/src/` — grep returned no matches.
- [x] No API keys / passwords / connection strings hardcoded — all read from `process.env` (`config/index.ts` is the single funnel; `services/*` reads are env-backed).
- [x] `.gitignore` covers `*-key.json`, `*-credentials.json`, `service-account*.json`, `*.pem`, `*.key`, `*.p12`, `*.pfx` — `.gitignore:41-49`, `backend/.gitignore:36-46`.
- [x] Intentional invalid placeholders confirmed (fail validation by design, not real secrets) — `backend/.env.example:78` (`PHI_ENCRYPTION_KEY=REPLACE_WITH_openssl_rand_hex_32`), `:86` (`AUDIT_LOG_SALT=REPLACE_...`), `:179` (`DEMO_PASSWORD=CHANGE_ME_...`).

### Local development & git hygiene
- [x] `.env`, `.env.local`, `.env.*.local`, `.env.production` in both `.gitignore`s — `.gitignore:18-23,52-53`, `backend/.gitignore:7-11`.
- [x] No real secrets in committed files / working tree — only tracked env-ish files are `*.example`, `*.example`, and `.env.staging` (frontend, public `VITE_API_URL` only — `.env.staging:5`); `git status` shows no untracked `.env`.
- [x] No secrets in git history — the only committed `.env` (commit `1e4a167`, removed in `8cbf298`) held placeholder Supabase values (`your-project-url`, `your-anon-key`), no live credentials.
- [x] `backend/.env.staging.example` uses empty/placeholder secrets (`DATABASE_URL=...:***@...`, empty JWT/PHI/SendGrid, `DEMO_PASSWORD=CHANGE_ME_inject_from_secret_manager`) — git `HEAD:backend/.env.staging.example`.

### CI/CD secrets
- [x] `GCP_SA_KEY` is the only repo secret referenced, via `google-github-actions/auth@v2` — `deploy.yml:43,156,202`, `deploy-staging.yml:31,93`.
- [x] `PROJECT_ID`, `REGION`, `SERVICE`, `REPOSITORY`, `FRONTEND_BUCKET` are workflow `env:` values, not secrets — `deploy.yml:20-25`, `deploy-staging.yml:14-19` (correctly NOT treated as secrets).
- [x] No secrets echoed in logs — workflows echo only image names, revisions, URLs, HTTP status (`deploy.yml:55-191`); `GCP_SA_KEY` only passed to the auth action.
- [x] App env / Secret Manager values injected at Cloud Run service level, not in workflow — no `--update-env-vars`/`--set-env-vars` in either workflow; deploy uses image + `--max-instances` only (`deploy.yml:82-89`, `deploy-staging.yml:62-67`).

### Docker / image hygiene
- [x] No secrets embedded in image — only build-time dummy `DATABASE_URL` for `prisma generate` (never connects) — `backend/Dockerfile:18,37`; runs as non-root `nodejs` user — `Dockerfile:43-44`.
- [x] Secrets rotatable without code change (read from env at boot) — `config/index.ts:38-224`; documented non-rotatable-in-place caveat for `PHI_ENCRYPTION_KEY` / `AUDIT_LOG_SALT` noted in `config/index.ts:43-53,283-293` and `.env.example:80-86`.

### SSRF / egress allowlist & AI spend control
- [x] `QUEST_FHIR_AUTH_HOSTS` parsed into `config.quest.authHosts` — `config/index.ts:220-223`; wired to `allowedAuthHosts` → `extraAllowedHosts` — `labSyncService.ts:64`, `smartAuth.ts:44-49,117-123`.
- [x] Allowlist enforced before client_secret / Bearer token egress; empty ⇒ must be on FHIR base host; blocks private/metadata IPs and cleartext to public hosts — `services/fhir/urlSafety.ts:56-91` (tests `urlSafety.test.ts:22-39`).
- [x] AI budget caps wired through `aiSpendGuard` on all AI routes — `middleware/aiSpendGuard.ts:23`, mounted in `aiRoutes.ts:32`, `biomarkerRoutes.ts:123`, `expenseRoutes.ts:114`, `insuranceRoutes.ts:123,136`; defaults 50/5 — `config/index.ts:196-197`.
- [x] `AUDIT_CLEANUP_TOKEN` endpoint 404s when unset (in-process interval runs instead), 401 on bad token, constant-time compare — `routes/internalRoutes.ts:43-62` (`timingSafeEqual` via `tokenMatches` at `:16,27-32`); interval gated at `auditLog.ts:587`.
- [x] `REDIS_URL` optional; unset ⇒ per-instance MemoryStore (documented N×limit caveat) — `config/index.ts:125-127`, `.env.example:146-152`; `--max-instances=3` bounds the dilution — `deploy.yml:88`, `deploy-staging.yml:67`.

## Unverifiable
- Whether `ANTHROPIC_BAA_ACTIVE` / `GOOGLE_BAA_ACTIVE` are actually set to `true` in the live prod Cloud Run service — values live in GCP Secret Manager / service config, not in the repo. Code-side gates are confirmed present (`config/index.ts:300-333`, runtime gates above); the deployed value cannot be read from source.
- Whether `QUEST_FHIR_AUTH_HOSTS` and the AI budgets are sized correctly for the real `--max-instances` — the workflow sets `--max-instances=3` (`deploy.yml:88`), but the actual prod env-var values are not in the repo.
- Whether a `.env` containing real secrets exists on any developer/deploy machine — only the repo working tree was inspected (clean); local untracked files outside this checkout are out of view.

## Out of scope
- `npm audit` findings (`@google-cloud/storage` moderate, `@hono/node-server` via `@prisma/dev`, etc.) — dependency CVEs belong to `12-dependencies`, not this environment/secrets prompt. Noted here only so they aren't missed: run `npm audit` under that review.
- Frontend `VITE_*` exposure semantics beyond confirming no secrets are placed in `.env.example` / `.env.staging` — covered structurally; deeper frontend-bundle secret analysis belongs to a frontend-focused prompt.
- The CSRF / cookie `sameSite` policy correctness itself (only confirmed the env vars that drive it are read) — belongs to the auth/CSRF review.

## Prompt-accuracy note
The prompt's drift call-outs all verified correct against live code: the `.env.example` omissions (F-1), `BCRYPT_ROUNDS` 12-vs-13 (F-2), stale CMS/OpenAI block (F-3), dead `RLS_ENFORCEMENT` flag (F-4), and the `@v2`/`@v4` action-pin TODO (F-6). One ambient environment note ("Is directory a git repo: No") was contradicted by the actual repo — `git rev-parse --is-inside-work-tree` returned `true`, so git history was reviewable; the code was trusted over the harness note per protocol.
