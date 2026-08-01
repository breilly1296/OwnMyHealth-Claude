---
tags:
  - documentation
  - environment
  - config
  - reference
type: prompt
priority: 2
updated: 2026-08-01
---

# Generate ENV_VARS.md

> **New since 2026-06-16 (OF-23)** — both must appear in the generated table:
> - `STORAGE_BACKEND` — `gcs` | `local`. Validated in **every** environment (`config/index.ts:343`)
>   and **refused in production/staging** (`config/index.ts:349`, because Cloud Run disks are
>   ephemeral and must never hold PHI files). `local` is the development default.
> - `LOCAL_STORAGE_DIR` — root for the local encrypted-disk backend, default
>   `backend/.local-storage` (`config/index.ts:255`). Git-ignored at `backend/.gitignore:49`.
>
> Document the **coupling**, not just the two rows: with `STORAGE_BACKEND=local`,
> `PHI_ENCRYPTION_KEY` becomes the at-rest key for uploaded **files** as well as PHI columns
> (`localBackend.ts:46-55`), which changes that variable's blast radius. Classify accordingly.
>
> **Posture stamp required** (see `_doc-quality.md`): Secret Manager sourcing is the *launch*
> configuration; as of 2026-07-14 the only live secret surface is local `.env` files.

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — when PHI surface touches this doc (e.g., `PHI_ENCRYPTION_KEY`).

This doc must pass the five tests in `_doc-quality.md` (question-answering, path-and-line, snippet, diagram, reproducibility) before you stop.

---

## Purpose

Produce `New Project Documents/ENV_VARS.md` — the **complete, single-source-of-truth reference for every environment variable** consumed by OwnMyHealth (backend, frontend build, CI, Cloud Run). A reader with only this doc must be able to answer: *what env vars do I need to set to run this app? which are secrets? what happens if I omit one? which file reads each one?*

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/config/index.ts` | **Primary source of truth** — the typed `config` object **and** all startup validation. Every env var the backend reads, its default (the `??` / `||` right-hand side), and the boot-time throws all live in this one module. There is no separate `index.ts` entry file. |
| `backend/src/config/jwtOptions.ts`, `backend/src/config/plans.ts` | Sibling config modules — `jwtOptions.ts` defines the static `jsonwebtoken` sign/verify options (`algorithm`/`issuer`/`audience`; reads no env vars — the JWT secrets/expiries live in `config/index.ts`); `plans.ts` defines plan/billing tiers consumed by `planGating` (no env vars of its own, but cite it for completeness). |
| `backend/.env.example`, `backend/.env.production.example`, `backend/.env.staging.example` | Documented defaults, sample values, production overrides. NOTE: the old CMS/OpenAI leftover vars (`CMS_API_KEY`, `CMS_API_BASE_URL`, `CMS_API_TIMEOUT_MS`, `OPENAI_API_KEY`) are **no longer present** in `backend/.env.example` — do NOT instruct the generator to flag them as live drift (a flag would produce a false "safe to delete" row for keys that don't exist). The only `RLS_ENFORCEMENT` mention in `backend/.env.example` is an explanatory removal comment that explicitly says "Do not re-add" (`backend/.env.example:95-98`) — it is a comment, not a settable `key=value` entry. The one place a commented-out `# RLS_ENFORCEMENT=strict` still lingers is `backend/.env.staging.example:39-41`, with stale "flip to strict after the omh_app NOBYPASSRLS role is live" guidance that now contradicts `database.ts:209-210` (the flag was **removed**, not pending). |
| `.env.example`, `.env.production.example`, `.env.staging` (repo root) | Frontend-side (`VITE_*`) and any shared vars. NOTE: these are the **root** frontend/shared examples — they do NOT carry the dead `RLS_ENFORCEMENT` flag. The lingering commented `# RLS_ENFORCEMENT=strict` lives in the **backend** staging example at `backend/.env.staging.example:39-41`. |
| `backend/src/app.ts` | The actual Express entry point (`dist/app.js` is the prod start command — see `railway.toml`). Reads `CORS_ORIGIN` and `DISABLE_CSRF`. Startup throws come from importing `config/index.ts`, not from here. |
| `backend/railway.toml` | Start command + healthcheck only — no env pins. Despite this file, **production runs on GCP Cloud Run** via `deploy.yml` (`gcloud run deploy`), not Railway. The file now documents itself as a legacy/alternate target that **deliberately keeps boot-migrate** (`startCommand = "npx prisma migrate deploy && node dist/app.js"`, `backend/railway.toml:9-14`) because Railway has no migrate-job step. On Cloud Run this is split: the image `CMD` is `["node", "dist/app.js"]` only (`backend/Dockerfile`), and migrations run as the separate `ownmyhealth-migrate` Cloud Run job (`deploy.yml`). Relevant to "how/where DATABASE_URL is provisioned for a deploy" (acceptance Q5). |
| `.github/workflows/ci.yml`, `deploy.yml`, `deploy-staging.yml`, `maintenance.yml` | CI/CD env vars, GitHub secrets (`secrets.GCP_SA_KEY`) used at build/deploy time; `deploy.yml` sets `VITE_API_URL` for the frontend build and gates the deploy on CI (`needs: ci`). A fourth workflow, `.github/workflows/maintenance.yml` (manual `workflow_dispatch` that runs one-time data-migration / backfill Cloud Run jobs, e.g. `backfill-userfile-filenames`), was added post-06-01 — relevant for ops/maintenance context. |
| `backend/Dockerfile` | `ENV` directives, build args. |
| `vite.config.ts`, `src/utils/logger.ts` | Build-time `VITE_*` var consumption (`VITE_API_URL`, `VITE_DEMO_MODE`, `VITE_DEBUG`, plus Vite built-ins `import.meta.env.DEV/PROD`). |
| `backend/src/services/*.ts` (27 non-test top-level modules + `fhir/`, `knowledge/`, `data/` subdirs; new since 06-01: `biomarkerSeries.ts`, `biomarkerConsolidation.ts`, `goalValueBackfill.ts`) | Consumer files — every `process.env.X` or `config.X` usage for the "consumer" column. `ocrService.ts` reads the Document AI vars directly (`GCP_PROCESSOR_ID`, `GCP_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`); `anthropicClient.ts` reads `ANTHROPIC_API_KEY`; `database.ts` reads `DATABASE_URL`, `DATABASE_POOL_SIZE`. |
| `backend/src/middleware/*.ts` (11 non-test modules: `auth`, `csrf`, `rateLimiter`, `rateLimitStore`, `rbac`, `demoProtection`, `errorHandler`, `planGating`, `aiSpendGuard`, `validation`, `index`) | Rate limiter (`rateLimiter.ts` + `rateLimitStore.ts` → `REDIS_URL`), CSRF (`csrf.ts` → `DISABLE_CSRF`), `aiSpendGuard.ts` (AI budget vars), CORS consumers. |
| `src/services/api/client.ts`, `src/services/uploadUtils.ts` | Frontend consumers of `VITE_API_URL`. |

Use `Grep` for `process\.env\.[A-Z_]+` and `import\.meta\.env\.[A-Z_]+` across the whole repo to catch drift between `config/index.ts` and actual usage. Note that several vars are read **directly from `process.env`** (not via the `config` object): `DATABASE_URL`, `PHI_ENCRYPTION_KEY`, `DATABASE_POOL_SIZE`, `DISABLE_CSRF`, `GCP_LOCATION`, `GCP_PROCESSOR_ID`, `GOOGLE_APPLICATION_CREDENTIALS` — so a pure `config.X` grep will miss them.

---

## Required sections

The output `ENV_VARS.md` must contain, in order:

1. **Purpose / how to read this doc** (1 paragraph).
2. **Master table** — every env var (see Required artifacts).
3. **By category**:
   - Critical secrets (JWT access/refresh, `PHI_ENCRYPTION_KEY`, `AUDIT_LOG_SALT`, DB, third-party API keys)
   - Database & persistence (`DATABASE_URL`, `DATABASE_POOL_SIZE`)
   - Auth & sessions (JWT expiry seconds, `BCRYPT_ROUNDS`, `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES`, cookie config `COOKIE_SAME_SITE` / `COOKIE_DOMAIN`)
   - Rate limiting (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `REDIS_URL` shared store)
   - AI — Anthropic (`ANTHROPIC_API_KEY`, `ANTHROPIC_BAA_ACTIVE`) + spend circuit breaker (`AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD`) + Google Document AI (`GCP_PROCESSOR_ID`, `GCP_LOCATION`, `GOOGLE_BAA_ACTIVE`)
   - Quest Diagnostics SMART-on-FHIR lab sync (`QUEST_FHIR_CLIENT_ID`, `QUEST_FHIR_CLIENT_SECRET`, `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`, `QUEST_FHIR_SUCCESS_REDIRECT`, `QUEST_FHIR_AUTH_HOSTS`)
   - Email (SendGrid: `SENDGRID_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `SENDGRID_SANDBOX_MODE`)
   - File storage (GCS: `GCS_BUCKET_NAME`, `GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`)
   - Scheduled maintenance / ops (`AUDIT_CLEANUP_TOKEN`)
   - CORS & frontend URLs (`CORS_ORIGIN`, `FRONTEND_URL`)
   - Demo mode (`DEMO_ACCOUNT_ENABLED`, `DEMO_EMAIL`, `DEMO_PASSWORD`)
   - Feature flags / BAA gates (`ANTHROPIC_BAA_ACTIVE`, `GOOGLE_BAA_ACTIVE`, `DISABLE_CSRF`)
   - CI/CD-only (GitHub Secrets, not runtime — e.g. `secrets.GCP_SA_KEY`)
   - Frontend build-time (`VITE_API_URL`, `VITE_DEMO_MODE`, `VITE_DEBUG`)
4. **Startup validation** — which vars throw on boot, where, and with what message. All startup checks live in `backend/src/config/index.ts` (executed at module load): `requireEnv()` for the JWT secrets, the `BLOCKED_JWT_VALUES` / `MIN_JWT_SECRET_LENGTH` checks, the `AUDIT_LOG_SALT` length gate, the Anthropic + Document AI BAA gates, and the prod/staging block that validates `DATABASE_URL`, `PHI_ENCRYPTION_KEY` (64-hex), `GCS_BUCKET_NAME`, demo/sandbox prohibitions. There is **no** `backend/src/index.ts` — do not cite it; the entry point is `backend/src/app.ts`.
5. **Secret rotation policy** — per secret, cadence + where it lives (GCP Secret Manager? GitHub Secrets? Cloud Run env?). NOTE: `AUDIT_LOG_SALT` and `PHI_ENCRYPTION_KEY` are NOT freely rotatable — rotating either makes existing encrypted PHI / audit logs undecryptable; document this explicitly.
6. **Local vs staging vs prod** — per-env differences (quick diff table).
7. **Drift findings** — env vars used in code but not in `config/index.ts` (or vice versa). Generated by the grep above.
8. **Related Documents** — cross-links.
9. **Prompt drift log** — if this prompt's file list disagrees with reality.

---

## Required artifacts

### Master table (columns, in this exact order)

| Column | Source of the value |
|---|---|
| **Name** | From `config/index.ts` or `process.env.*` grep. |
| **Required?** | `required` if startup throws on missing; `optional` if defaulted; `build-time` for VITE_*. Cite the line that decides. |
| **Default** | Literal default in `config/index.ts` (or "none" if required). |
| **Format** | `string`, `int`, `hex:64`, `url`, `email`, `bool`, `secret:256-bit`, etc. |
| **Consumer(s)** | Every `file:line` that reads this var or the `config.X` field. |
| **Secret?** | `yes` / `no`. Yes = never log, never commit. |
| **Where stored (prod)** | GCP Secret Manager / Railway env / GitHub Secret / Cloud Run env / not applicable. |
| **Notes** | Rotation cadence, validation rules, gotchas. |

At minimum, cover (verify each by reading `config/index.ts` — the canonical inventory below is ~42 vars; these are the **real** names, not the pre-2026-04 names this prompt used to list):

- **Core/server**: `NODE_ENV`, `PORT`, `DATABASE_URL`, `DATABASE_POOL_SIZE` (read directly in `database.ts`), `FRONTEND_URL`, `CORS_ORIGIN`, `OMH_DEPLOY_ENFORCE_PROD` (RT-H1 boot guard: when `'true'` on a dev-tier image the app hard-fails to refuse booting at the dev security tier — `config/index.ts:53`; a complete env SSOT must list it)
- **Auth/crypto secrets**: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (NOT `JWT_SECRET` — there are two, both via `requireEnv`), `JWT_ACCESS_EXPIRES_SECONDS`, `JWT_REFRESH_EXPIRES_SECONDS` (integers in seconds, NOT `JWT_*_EXPIRY` strings), `PHI_ENCRYPTION_KEY`, `AUDIT_LOG_SALT`
- **Account security**: `BCRYPT_ROUNDS`, `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES`
- **Cookies**: `COOKIE_SAME_SITE`, `COOKIE_DOMAIN` (there is NO `CSRF_SECRET` — CSRF is a double-submit cookie with no server-side secret; toggled only by `DISABLE_CSRF`)
- **Rate limiting**: `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` (NOT `RATE_LIMIT_MAX`), `REDIS_URL` (optional shared store backing all 8 limiters)
- **Ops**: `AUDIT_CLEANUP_TOKEN` (enables `POST /api/v1/internal/audit-cleanup`)
- **AI (Anthropic)**: `ANTHROPIC_API_KEY`, `ANTHROPIC_BAA_ACTIVE` (there is NO configurable `ANTHROPIC_MODEL` env var — the model is pinned in `anthropicClient.ts`), `AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD`
- **Email (SendGrid)**: `SENDGRID_API_KEY`, `EMAIL_FROM` (NOT `SENDGRID_FROM_EMAIL`), `EMAIL_FROM_NAME`, `SENDGRID_SANDBOX_MODE`
- **Storage/GCP/OCR**: `GCS_BUCKET_NAME`, `GCP_PROJECT_ID` (NOT `GOOGLE_CLOUD_PROJECT`), `GCP_PROCESSOR_ID` (NOT `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`), `GCP_LOCATION` (NOT `GOOGLE_DOCUMENT_AI_LOCATION`; default `'us'`, read in `ocrService.ts`), `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_BAA_ACTIVE`
- **Quest FHIR (lab sync)**: `QUEST_FHIR_CLIENT_ID`, `QUEST_FHIR_CLIENT_SECRET`, `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`, `QUEST_FHIR_SUCCESS_REDIRECT`, `QUEST_FHIR_AUTH_HOSTS` (comma-separated SSRF allowlist)
- **Demo**: `DEMO_ACCOUNT_ENABLED`, `DEMO_EMAIL`, `DEMO_PASSWORD`
- **CSRF toggle**: `DISABLE_CSRF` (dev only — refused by `csrf.ts` if NODE_ENV=production)
- **Frontend build-time**: `VITE_API_URL`, `VITE_DEMO_MODE`, `VITE_DEBUG`

If `config/index.ts` contains others, add them. If any var is **not** in `config/index.ts` (nor read via `process.env` anywhere) but *is* genuinely present as a settable `key=value` in an example env file, flag it as drift. Caveats — verify the file contents before flagging, do NOT carry these forward from memory:

- The old CMS/OpenAI leftover vars (`CMS_API_KEY`, `CMS_API_BASE_URL`, `CMS_API_TIMEOUT_MS`, `OPENAI_API_KEY`, from the removed CMS Marketplace / provider-search features) are **no longer present** in `backend/.env.example` — there is nothing to flag. Listing them as live drift would produce a false "safe to delete" row for keys that don't exist.
- `RLS_ENFORCEMENT` (the strict-mode flag removed at the `omh_app` NOBYPASSRLS cutover) is **not a settable entry** in `backend/.env.example` — the only mention there is an explanatory removal comment that says "Do not re-add" (`backend/.env.example:95-98`). The flag DOES still linger as a commented-out `# RLS_ENFORCEMENT=strict` in `backend/.env.staging.example:39-41`, with stale "flip to strict after the omh_app NOBYPASSRLS role is live" guidance. The removal is documented in the `assertNoBypassRLS()` doc-comment at `database.ts:209-210` ("The transitional `RLS_ENFORCEMENT=strict` flag was removed when the omh_app cutover landed."). A sibling boot check, `assertRLSForced()` (`database.ts:193`), was added post-06-01 to hard-exit if FORCE ROW LEVEL SECURITY is missing.

### Startup-validation snippet

Quote the real assertion blocks from `backend/src/config/index.ts` (all startup checks live there — there is no `backend/src/index.ts`). For example, the `requireEnv` helper and the prod/staging required-vars gate:

```ts
// Source: backend/src/config/index.ts (requireEnv — throws at module load for JWT secrets)
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}. ...`);
  }
  return value;
}
// jwt.accessSecret = requireEnv('JWT_ACCESS_SECRET');
// jwt.refreshSecret = requireEnv('JWT_REFRESH_SECRET');

// Source: backend/src/config/index.ts (prod/staging block, ~L341)
const requiredEnvVars = ['DATABASE_URL', 'PHI_ENCRYPTION_KEY'];
const missing = requiredEnvVars.filter(key => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables for ${envLabel}: ${missing.join(', ')}`);
}
```

Also quote (don't just summarize) the BAA gates (`ANTHROPIC_BAA_ACTIVE`, `GOOGLE_BAA_ACTIVE`), the `PHI_ENCRYPTION_KEY` 64-hex / placeholder checks, the `AUDIT_LOG_SALT` length gate, and the prod-only prohibitions (`DEMO_ACCOUNT_ENABLED`, `SENDGRID_SANDBOX_MODE`, `GCS_BUCKET_NAME`). Cite each with its real line number (verify against the current file).

### Drift table

| Env var | Declared in `config/index.ts`? | Found in `.env.example`? | Found in code usage (grep)? | Notes |
|---|---|---|---|---|
| `FOO_BAR` | no | yes | 0 hits | Declared in example but never read — safe to delete. |

---

## Acceptance questions

A reader with only the generated `ENV_VARS.md` (and siblings) must be able to answer:

1. Which env vars are strictly required to boot the backend in production? (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AUDIT_LOG_SALT` always; plus `DATABASE_URL`, `PHI_ENCRYPTION_KEY` in prod/staging)
2. What happens if `JWT_ACCESS_SECRET` is omitted? (file:line of the `requireEnv` throw in `config/index.ts`)
3. Which env vars contain PHI-adjacent secrets, and which of them are NOT rotatable without re-encrypting data (`PHI_ENCRYPTION_KEY`, `AUDIT_LOG_SALT`)?
4. Which vars are build-time (`VITE_*`) vs runtime?
5. Where is `DATABASE_URL` stored in production and how is it provisioned for a new Cloud Run deploy?
6. Which env vars control whether Anthropic and Google Document AI BAA protections are active, and what code paths do they gate? (`ANTHROPIC_BAA_ACTIVE` → `claudeExtraction`/`sbcExtraction`; `GOOGLE_BAA_ACTIVE` → `ocrService.processImageWithDocumentAI`)
7. What's the CORS origin in staging vs prod, and which file reads it? (`CORS_ORIGIN`, read in `config/index.ts` and `app.ts`)
8. Which vars have defaults safe for local dev and should never be left as default in prod (`GCS_BUCKET_NAME`, `EMAIL_FROM`, the Quest FHIR redirect URIs)?
9. Does `PHI_ENCRYPTION_KEY` have a rotation procedure? (if not, flag as `TBD (external: ...)` with resolution path)
10. Which GitHub Actions secrets are used at deploy time but never read at runtime (`GCP_SA_KEY`)?
11. How is the AI spend circuit breaker configured, and what's the per-instance caveat (`AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` enforced by `aiSpendGuard`, in-memory per Cloud Run instance)?
12. What's required to enable Quest lab sync vs run it against the mock FHIR server locally, and what does `QUEST_FHIR_AUTH_HOSTS` protect against (SSRF/token-exfil allowlist)?
13. How is rate-limit state shared across Cloud Run instances (`REDIS_URL`), and what's the failure mode if it's set but unreachable?
14. What does `AUDIT_CLEANUP_TOKEN` enable, and what runs in its absence (in-process 24h interval vs Cloud Scheduler hitting the internal endpoint)?

After writing the doc, self-answer each question **using only the doc**. If any answer requires reading a source file, patch the doc and re-check.

---

## No-TBD enforcement

Before marking anything TBD:

- **For "which file reads X"**: `Grep` for `process.env.X` and `config.X` across `backend/src/**`, `src/**`, `vite.config.ts`, workflows.
- **For "what's the default"**: read `config/index.ts` literally; the `??` / `||` right-hand-side is the default.
- **For "required at boot?"**: read `backend/src/config/index.ts` for the explicit throws — `requireEnv()` calls, the prod/staging `requiredEnvVars` block, the JWT/PHI/audit-salt validators, and the BAA gates. (There is no `backend/src/index.ts`; the entry point is `backend/src/app.ts` but it does no env validation of its own.)
- **For "rotation cadence"**: Grep for rotation references in `RUNBOOK.md`, `SECURITY_STATUS.md`, session summaries, `CLAUDE.md`.
- **For "where stored in prod"**: production runs on GCP Cloud Run (not Railway). Read `.github/workflows/deploy.yml` / `deploy-staging.yml` for `secrets.*` and the `VITE_API_URL` build env; runtime env vars are set on the Cloud Run service itself (GCP Secret Manager / `gcloud run ... --set-env-vars`). `railway.toml` holds only the start command + healthcheck.

**Only** if the rotation cadence or prod-storage location is not recorded anywhere in the repo, mark:

```
TBD (external: rotation cadence lives in ops runbook outside repo — resolve via GCP Secret Manager UI or the owner's password vault)
```

---

## Cross-links

The generated `ENV_VARS.md` must link to:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — for how env vars wire into the middleware and deployment topology.
- [`RUNBOOK.md`](./RUNBOOK.md) — for how to set/rotate secrets in prod.
- [`LOCAL_DEV.md`](./LOCAL_DEV.md) — for how to populate `.env` locally.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — for `PHI_ENCRYPTION_KEY` context.
- [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) — for open secret-management findings.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Find every `process.env.X` reader | Grep | `pattern: "process\\.env\\.[A-Z_]+"` over `backend/src/**`, `src/**`, `*.config.*`, `.github/**` |
| Find every `config.X` reader | Grep | `pattern: "config\\.[a-z][A-Za-z.]+"` over `backend/src/**` (config fields are camelCase, e.g. `config.jwt.accessSecret`, `config.gcp.bucketName`) |
| Find every `VITE_*` reader | Grep | `pattern: "import\\.meta\\.env\\.[A-Z_]+"` over `src/**`, `vite.config.ts` |
| Read config schema + ALL startup assertions | Read | `backend/src/config/index.ts` (single source — config object and boot-time throws) |
| Read sibling config modules | Read | `backend/src/config/jwtOptions.ts`, `backend/src/config/plans.ts` |
| Read example envs | Read | `backend/.env.example`, `backend/.env.production.example`, `backend/.env.staging.example`, `.env.example`, `.env.production.example`, `.env.staging` |
| Read entry point (CORS/CSRF env reads) | Read | `backend/src/app.ts` (NOT `backend/src/index.ts` — it does not exist) |
| Read workflow env blocks | Read | `.github/workflows/ci.yml`, `deploy.yml`, `deploy-staging.yml` |
| Confirm start command (not env pins) | Read | `backend/railway.toml` (prod runs on Cloud Run via `deploy.yml`) |

---

## Output: file and location

Write the final document to `New Project Documents/ENV_VARS.md`.
