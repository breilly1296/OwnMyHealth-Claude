# Environment & Secrets Review — 2026-06-16

Scope: `backend/src/config/index.ts` + sibling config modules (`jwtOptions.ts`, `plans.ts`), the env templates (`.env.example`, `backend/.env.example`, `backend/.env.production.example`, `backend/.env.staging.example`, frontend `.env.staging`), the four GitHub Actions workflows (`ci.yml`, `deploy.yml`, `deploy-staging.yml`, `maintenance.yml`), `backend/Dockerfile`, `.dockerignore`, `.gitignore`, `.gitleaks.toml`, and all out-of-config `process.env` reads (`ocrService.ts`, `csrf.ts`, `app.ts`, `database.ts`, `anthropicClient.ts`). Static review only; no code modified. HEAD `fb2cd32`.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 4 |

No hardcoded secrets, no committed credential/cert files, no real secrets in any tracked `.env*` file. Every load-bearing startup hard-fail fires and is unit-tested. All findings are hygiene/prompt-drift (Low).

## Findings

### F-1 — `.env.staging.example` documents the dead `RLS_ENFORCEMENT` flag — **Low** (prompt drift / doc drift)
- **Location:** `backend/.env.staging.example:39-41`
- **Observation:** The staging template still tells operators to set `RLS_ENFORCEMENT=strict` after the NOBYPASSRLS cutover:
  - `# Controls RLS BYPASSRLS assertion at startup. Leave unset during the C-8`
  - `# rollout; flip to "strict" after the omh_app NOBYPASSRLS role is live.`
  - `# RLS_ENFORCEMENT=strict`
  This variable is **no longer read by any code** — the BYPASSRLS posture is hardcoded in `database.ts → assertNoBypassRLS()` (prod hard-exits, non-prod warns). The main `backend/.env.example:92-98` correctly documents the flag as REMOVED, so the two templates contradict each other.
- **Impact:** An operator copying `.env.staging.example` may believe RLS enforcement is gated on an env var and set/omit it expecting an effect — wasted effort and a false mental model of how RLS is enforced. No security weakening (the real guard is unconditional in code), hence Low.
- **Fix:** In `backend/.env.staging.example`, replace lines 39-41 with the same "REMOVED — has no effect; BYPASSRLS posture is unconditional in `database.ts`" note used in `backend/.env.example:92-98`.
- **Evidence:** `database.ts:209` confirms the flag is dead: `*     unisolated PHI. The transitional` RLS_ENFORCEMENT=strict `flag` (cited in the assertNoBypassRLS doc comment as the historical/transitional flag, not a live read). No `process.env.RLS_ENFORCEMENT` read exists anywhere in `backend/src/`.

### F-2 — `backend/.dockerignore` excludes `.env`/`.env.local`/`.env.*.local` but not `.env.staging` or `.env.production` — **Low** (latent / defense-in-depth)
- **Location:** `backend/.dockerignore:10-12`
- **Observation:** The Docker build context is `backend/` (`deploy.yml:102-103` `cd backend; docker build ... .`). `.dockerignore` excludes only `.env`, `.env.local`, `.env.*.local`. It does **not** exclude `.env.staging`, `.env.production`, or the bare `.env.<name>` shapes that the deploy templates reference. Today this is harmless because no `backend/.env.staging` / `backend/.env.production` file exists (only `*.example` variants, and `*.md` is already stripped at `:30` so the examples themselves are excluded too). It is a latent gap: if an operator ever drops a real `backend/.env.production` (a shape the repo's own production checklist discusses), it would be copied into the image layer by the `COPY ... ./` steps and baked into a HIPAA backend image.
- **Impact:** Potential future secret-in-image exposure (DATABASE_URL, PHI key, JWT secrets) if a non-`.local` dotenv file is created in the backend dir. Currently dormant — no such file exists — so Low.
- **Fix:** Broaden `backend/.dockerignore` to a catch-all `*.env` / `.env*` (keeping `!*.example` if any example must ship, though none do — `*.md` already excludes the doc-style examples). Mirrors the root `.gitignore` intent.
- **Evidence:** `.dockerignore:10-12` = `.env` / `.env.local` / `.env.*.local`; the Dockerfile `COPY package*.json ./` + `COPY prisma ./prisma/` + `COPY --from=builder /app/dist ./dist` build from the un-pruned `backend/` context.

### F-3 — Frontend `.env.staging` is git-tracked outside the `.example` allowlist — **Low** (hygiene)
- **Location:** `.env.staging` (repo root, tracked per `git ls-files`)
- **Observation:** `.env.staging` is committed and contains only a non-secret build-time value (`VITE_API_URL=https://api-staging.ownmyhealth.io/api/v1`). It is a legitimate Vite `--mode staging` file (consumed by `deploy-staging.yml:133-134` `npm run build -- --mode staging`) and VITE_* values are embedded in the public bundle, so this is by design and contains no secret. However, it is a tracked dotenv file whose name does **not** match the `.gitleaks.toml` `.example` allowlist patterns (`(^|/)\.env\.example$`, `(^|/)\.env\..+\.example$`), so the CI gitleaks scan applies full default rules to it. That is actually protective (a future real secret added here would be caught), but the file is a footgun: its dotenv name invites someone to paste a real `VITE_*` token or, worse, a backend secret under the assumption that "`.env*` is gitignored."
- **Impact:** No active exposure (URL only). Risk is a future operator treating it as a private env file. Low.
- **Fix:** Add a header comment in `.env.staging` stating "PUBLIC build-time values only — committed on purpose; never put secrets here (VITE_* is embedded in the shipped bundle)." The file already carries lines 1-3 to this effect; consider strengthening to an explicit "COMMITTED" banner. Optionally rename to make its committed-by-design status obvious. No gitignore change needed (it must stay tracked for the staging build).
- **Evidence:** `.env.staging:1-5` (`# VITE_* variables are embedded at build time; never put secrets here.` … `VITE_API_URL=https://api-staging.ownmyhealth.io/api/v1`); `git ls-files` lists `.env.staging`; `.gitleaks.toml:15-16` allowlist matches only `.example` paths.

### F-4 — Realistic-looking `SG.`-prefixed SendGrid placeholder in production template — **Low** (hygiene)
- **Location:** `backend/.env.production.example:89`
- **Observation:** `SENDGRID_API_KEY=SG.your_api_key_here`. The `SG.` prefix is the exact format of a real SendGrid key, so this placeholder resembles a live credential. It is in an `.example` file (allowlisted in `.gitleaks.toml:15-16`), so CI does not flag it, and the suffix `your_api_key_here` is obviously fake — but it is the only env example that ships a credential-shaped value with a real provider prefix rather than a `CHANGE_ME_*` / empty-string placeholder (compare `PHI_ENCRYPTION_KEY=CHANGE_ME_...:45`, `AUDIT_LOG_SALT=CHANGE_ME_...:52`, and the empty `JWT_*`/`DATABASE_URL`/`ANTHROPIC_API_KEY`).
- **Impact:** Cosmetic; a careless reader could mistake it for a leaked key during an audit, or a tool with a looser ruleset than the project's gitleaks allowlist could false-positive on it. No real secret. Low.
- **Fix:** Change to an empty value (`SENDGRID_API_KEY=`) or a `CHANGE_ME`-style placeholder to match the rest of the template, removing the `SG.` prefix.
- **Evidence:** `backend/.env.production.example:89` `SENDGRID_API_KEY=SG.your_api_key_here`.

## Checks passed

**1. Secret Manager inventory / config wiring**
- [x] `DATABASE_URL` read for the pool and required in prod/staging — `database.ts:58`, `config/index.ts:425-433`.
- [x] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` via `requireEnv` (no fallback, any env) — `config/index.ts:120,124`, helper at `:18-28`.
- [x] `PHI_ENCRYPTION_KEY` required in prod/staging, 64+ hex, insecure-key blocklist — `config/index.ts:436-464`.
- [x] `AUDIT_LOG_SALT` required (min 16) at boot in every env — `config/index.ts:357-367`.
- [x] `ANTHROPIC_API_KEY` lazy, read in shared client — `config/index.ts:241`, `anthropicClient.ts:49`.
- [x] `SENDGRID_API_KEY` drives `email.enabled` — `config/index.ts:209-210`.
- [x] `GOOGLE_APPLICATION_CREDENTIALS` plumbed — `config/index.ts:231`.
- [x] `AUDIT_CLEANUP_TOKEN` gates the internal endpoint (404 when unset) — `config/index.ts:196`, `internalRoutes.ts:43-52`, `auditLog.ts:674`.
- [x] `QUEST_FHIR_CLIENT_SECRET` from env, only sent to allowlisted hosts — `config/index.ts:267`, `smartAuth.ts:216-217,256-257,333-334`, allowlist `urlSafety.ts:64-99`.
- [x] Config vars (`NODE_ENV`, `PORT`, `CORS_ORIGIN`, `FRONTEND_URL`, `GCS_BUCKET_NAME`, `GCP_PROJECT_ID`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `SENDGRID_SANDBOX_MODE`, `REDIS_URL`) all loaded once into the `config` object — `config/index.ts:97-293`.
- [x] `GCP_PROCESSOR_ID` / `GCP_LOCATION` read via `process.env` in OCR service (not config object), as documented — `ocrService.ts:87,117,118`.
- [x] BAA gates: `ANTHROPIC_BAA_ACTIVE` / `GOOGLE_BAA_ACTIVE` parsed and enforced — `config/index.ts:236,245`.
- [x] AI spend caps `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` parsed safely (NaN/negative → warn + default, breaker stays ON) — `config/index.ts:66-76,256-257`.
- [x] Quest FHIR vars (`CLIENT_ID`, `BASE_URL`, `REDIRECT_URI`, `SUCCESS_REDIRECT`, `AUTH_HOSTS`) all loaded — `config/index.ts:265-284`.
- [x] Cookie/JWT/rate-limit/demo config all loaded — `config/index.ts:115-205`.

**2. No hardcoded secrets**
- [x] No `sk-ant`, `AIza`, `-----BEGIN`, or literal `client_secret=`/`password=` constants in production source — Grep across `backend/src/**/*.ts`: every `clientSecret`/`password`/`secret` hit is either a `process.env` read, a config-object property, a prose comment, or a `*.test.ts` fixture.
- [x] No connection strings in source — `DATABASE_URL` only via `process.env` (`database.ts:58`); only literal is the Dockerfile's dummy `postgresql://dummy:dummy@localhost` for `prisma generate` (`Dockerfile:30,65`), never used to connect.
- [x] No service-account JSON / private keys committed — `git ls-files | grep` for `*.pem|*.key|*.p12|*.pfx|*-key.json|*-credentials.json|service-account*.json` returns nothing; `.gitignore:42-50` + `backend/.gitignore:37-46` cover all of them.
- [x] Intentional invalid placeholders behave as designed — `backend/.env.example:82` `PHI_ENCRYPTION_KEY=REPLACE_WITH_openssl_rand_hex_32` (underscores = non-hex → fails the hex regex), `:183` `DEMO_PASSWORD=CHANGE_ME_...` (allowlisted in `.gitleaks.toml:28`).

**3. Environment documentation / drift**
- [x] Every var read by `config/index.ts` appears in `backend/.env.example`, incl. the previously-omitted set (SendGrid, EMAIL_*, GCS/GCP, GOOGLE_BAA_ACTIVE, AI budgets, QUEST_FHIR_AUTH_HOSTS) — verified `backend/.env.example:197-300`.
- [x] `DATABASE_POOL_SIZE` documented — `backend/.env.example:32-34`; read at `database.ts:108`.
- [x] `BCRYPT_ROUNDS` default `13` in code and template (in sync) — `config/index.ts:160`, `backend/.env.example:113`, `backend/.env.production.example:75`.
- [x] JWT expiry documented as integer SECONDS, PHI key as 64 hex — `backend/.env.example:46-58,64-82`.
- [x] No CMS/OpenAI dead-integration cruft in either `.env.example` — confirmed absent (Grep).
- [x] Frontend `.env.example` "External Services" block lists only optional Supabase vars — `.env.example:27-33`.

**4. Secret rotation / no secrets in image**
- [x] Migrations run as the `ownmyhealth-migrate` Cloud Run job, NOT at container boot — `Dockerfile:86-93` `CMD ["node","dist/app.js"]`; `deploy.yml:106-161`.
- [x] DATABASE_URL reaches the migrate job the same way as the service (`--set-secrets DATABASE_URL=DATABASE_URL:latest`, same Cloud SQL instance, service runtime SA) — `deploy.yml:143-145,125-134`; no migrate-specific secret.
- [x] No secrets baked into the image — `Dockerfile` only sets non-secret `ENV NODE_ENV`/`OMH_DEPLOY_ENFORCE_PROD`/dummy DATABASE_URL; secrets are injected at the Cloud Run service level out-of-band (`deploy.yml:179-191` uses `--update-env-vars=NODE_ENV` only). (`.dockerignore` `.env` exclusion noted as F-2 for latent completeness.)
- [x] PHI key / audit salt documented as non-rotatable-in-place (rotation breaks decryption) — `config/index.ts:102-112,353-366`, `backend/.env.example:84-90`.

**5. CI/CD secrets**
- [x] `GCP_SA_KEY` is the only repo secret referenced — `deploy.yml:79,259,310`, `deploy-staging.yml:50,114`, `maintenance.yml:64`.
- [x] `PROJECT_ID`/`REGION`/`SERVICE`/`REPOSITORY`/`FRONTEND_BUCKET`/`MIGRATE_JOB`/`CLOUDSQL_INSTANCE` are workflow `env:` values, not secrets — `deploy.yml:37-46`.
- [x] Deploy gated on CI — `deploy.yml:57-58` `uses: ./.github/workflows/ci.yml`, `build-and-stage` `needs: ci` (`:66`), `promote` `needs: [build-and-stage, smoke-test]` (`:253`), `deploy-frontend` `needs: [ci, promote]` (`:301`). A failed `ci` blocks all downstream jobs.
- [x] Secret-hygiene gate lives in `ci.yml` security job — gitleaks `--no-git --source . --config .gitleaks.toml` (`ci.yml:123-127`), `npm audit --audit-level=high` ×2 (`:138-143`), RLS-wrapper guard (`:148-149`).
- [x] Third-party actions pinned to 40-char SHAs with version comments — `actions/checkout@34e11487…` , `setup-node@49933ea5…`, `auth@c200f369…`, `setup-gcloud@e427ad8a…` across `deploy.yml`/`deploy-staging.yml`/`maintenance.yml`/`ci.yml`; no tag-only action introduced.
- [x] Least-privilege `permissions: contents: read` on every workflow — `ci.yml:14-15`, `deploy.yml:25-26`, `deploy-staging.yml:12-13`, `maintenance.yml:41-42`.
- [x] Secrets not echoed — workflows print SHAs/URLs/counts only; gitleaks runs `--redact` (`ci.yml:127`).
- [x] `maintenance.yml` clones service env+secret mounts into the job (master key never leaves Secret Manager), defaults to dry run (`apply=false`) — `maintenance.yml:30-34,99-114,118`.

**6. Local development**
- [x] `.env`, `.env.local`, `.env.*.local`, `.env.production` gitignored — `.gitignore:19-23,53`, `backend/.gitignore:8-11`.
- [x] `backend/.env` is gitignored AND untracked — `git check-ignore` exit 0, `git ls-files` returns nothing for it.
- [x] No real secrets in committed files — `.env.staging` (URL only, F-3), all `.env*.example` are placeholders/empty; gitleaks gate enforces this in CI.
- [x] Local setup instructions present — `backend/.env.example` header + production checklist (`:302-323`).

**7. Secret access patterns**
- [x] Secrets loaded once into the frozen `config` object — `config/index.ts:97-293` (`as const`).
- [x] Lazy Anthropic client construction (boot doesn't crash when key unset) — `anthropicClient.ts:46-60`; `getDocumentAIClient` lazy too — `ocrService.ts:82-90`.
- [x] Missing required secrets throw at module load with actionable messages — `requireEnv` (`config/index.ts:18-28`) + all hard-fail blocks.
- [x] CSRF disable flag is dev-gated in both call sites — `csrf.ts:159` (`config.isDevelopment && process.env.DISABLE_CSRF === 'true'`), `app.ts:215`.

**8. Startup validation hard-fails (each confirmed + unit-tested)**
- [x] JWT secrets missing/empty/whitespace/placeholder/<32 → throw, every env — `config/index.ts:18-28,315-351`; tests `config/index.test.ts:60-114`.
- [x] `AUDIT_LOG_SALT` missing or <16 → throw — `config/index.ts:357-367`.
- [x] prod/staging require `DATABASE_URL` + `PHI_ENCRYPTION_KEY`; PHI key 64+ hex, not insecure placeholder — `config/index.ts:422-464`.
- [x] prod requires `GCS_BUCKET_NAME` (F-28); forbids `DEMO_ACCOUNT_ENABLED=true`; forbids `SENDGRID_SANDBOX_MODE=true` — `config/index.ts:480-508`.
- [x] BAA gates throw in prod (key/processor set without BAA flag); dev/staging warn — `config/index.ts:381-414`; runtime backstops `ocrService.ts:276-282`, claude/sbc extraction gates.
- [x] prod/staging non-fatal warnings for unset `ANTHROPIC_API_KEY`/`SENDGRID_API_KEY`/`GCP_PROJECT_ID` — `config/index.ts:512-520`.
- [x] M7 cookie invariant: SameSite=None without Secure → throw, every env — `config/index.ts:301-307`; RT-H1 deployed-image-at-dev-tier hard-fail — `:53-60`.

**9. SSRF / egress allowlists**
- [x] `QUEST_FHIR_AUTH_HOSTS` allowlist enforced before token/client_secret egress; empty ⇒ must be on FHIR base host; blocks private/loopback/metadata IPs and cleartext-to-public — `urlSafety.ts:28-99`, called from `smartAuth.ts:46,142`.
- [x] AI budget caps wired through `aiSpendGuard` (reserve/settle, 503 fail-closed) so a compromised key can't run unbounded billing — `aiSpendGuard.ts:35-78`, `aiCostTracker.ts:111-112,190-191,236,285`.

## Unverifiable
- Whether `ANTHROPIC_BAA_ACTIVE` / `GOOGLE_BAA_ACTIVE` are actually set to `true` in the live prod Cloud Run service (vs PHI egress being blocked by the runtime gate) — requires `gcloud run services describe`, not in the static tree.
- Whether `QUEST_FHIR_AUTH_HOSTS`, `REDIS_URL`, and `AI_*_BUDGET_USD` are sized/provisioned correctly for the live `--max-instances=3` — runtime/infra state (the per-instance accumulator + `--max-instances=3` bound are documented at `deploy.yml:171-174`, `config/index.ts:248-258`).
- Whether any secret exists in deeper Git history before HEAD — the CI gitleaks gate runs `--no-git` (current tree only) by design (`ci.yml:127`); a history scan was out of scope for this static review.
- Actual values in the live Secret Manager / Cloud Run env (DATABASE_URL, JWT secrets, PHI key) — not present in the repo (correct).

## Out of scope
- Encryption algorithm correctness and PHI_FIELDS↔schema lockstep — owned by `02-encryption` / the PHI inventory; this review only confirmed the key's env loading + format validation.
- Rate-limiter and CSRF token-comparison internals — owned by `08-rate-limiting` / `04-csrf`; only their env-var inputs (`RATE_LIMIT_*`, `DISABLE_CSRF`, `REDIS_URL`) were checked here.
- RLS policy correctness — owned by `01-database-schema`; only the documented-but-dead `RLS_ENFORCEMENT` flag (F-1) was checked as an env-var concern.
- Dependency CVEs surfaced by `npm audit` — owned by `13-dependency-health`; this review only confirmed the `--audit-level=high` gate is wired into CI and blocks deploy.
