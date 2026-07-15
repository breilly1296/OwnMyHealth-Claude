# ENV_VARS.md — Environment Variable Reference

> Single source of truth for every environment variable consumed by OwnMyHealth (backend runtime, frontend build, CI/CD, Cloud Run). Generated from the live code at HEAD `fb2cd32` (2026-06-15). Every non-trivial claim cites `file:line`.

## Purpose / how to read this doc

A reader with only this doc must be able to answer: *what env vars do I need to set to run this app? which are secrets? what happens if I omit one? which file reads each one?* The authoritative inventory is the typed `config` object **and** all boot-time validation in `backend/src/config/index.ts` (there is **no** `backend/src/index.ts`; the Express entry point is `backend/src/app.ts`, which does no env validation of its own except the prod `CORS_ORIGIN` check). Several vars are read **directly** from `process.env` outside the `config` object — those are flagged in the master table and the [Drift findings](#drift-findings) section. Start with the [Master table](#master-table), then jump to the category section you need, then read [Startup validation](#startup-validation) for boot-time behavior.

Two helpers in `config/index.ts` drive most behavior:
- `requireEnv(key)` — throws at module load if the var is missing/empty (`backend/src/config/index.ts:18-28`). Used only for the two JWT secrets.
- `parseBudget(raw, fallback, name)` — warns and falls back on a NaN/negative AI budget instead of crashing boot (`backend/src/config/index.ts:66-76`).

```ts
// Source: backend/src/config/index.ts:18-28
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

---

## Where vars are loaded and where they end up

```
                           process.env (Cloud Run env + Secret Manager refs)
                                          │
       ┌──────────────────────────────────┼─────────────────────────────────────┐
       │                                   │                                       │
       ▼                                   ▼                                       ▼
backend/src/config/index.ts        Direct process.env reads             Frontend build (Vite)
(typed `config` object +           (NOT in the config object)           import.meta.env.VITE_*
 ALL boot-time throws)             ─ DATABASE_URL  database.ts:58       ─ VITE_API_URL  client.ts:10
 ─ requireEnv(JWT_*)               ─ DATABASE_POOL_SIZE database.ts:108 ─ VITE_DEBUG     logger.ts:17
 ─ AUDIT_LOG_SALT gate             ─ PHI_ENCRYPTION_KEY encryption.ts:182─ VITE_DEMO_MODE App.tsx:281
 ─ PHI/CORS/BAA/demo gates         ─ GCP_LOCATION   ocrService.ts:117    (baked into dist/ at build time)
       │                           ─ GCP_PROCESSOR_ID ocrService.ts:88   deploy.yml sets VITE_API_URL:330
       ▼                           ─ GOOGLE_APPLICATION_CREDENTIALS ocrService.ts:91
config.jwt / config.gcp / ...      ─ DISABLE_CSRF   csrf.ts:159, app.ts:215
 consumed by services/middleware   ─ CORS_ORIGIN    app.ts:80
```

`config/index.ts` loads a local `.env` via `dotenv.config()` at `backend/src/config/index.ts:5`; in deployed environments the values come from the Cloud Run service env / GCP Secret Manager refs (see [Where stored in prod](#local-vs-staging-vs-prod) and `.github/workflows/deploy.yml`).

---

## Master table

Columns: **Name | Required? | Default | Format | Consumer(s) (file:line) | Secret? | Where stored (prod) | Notes**. "Required?" cites the line that decides. `required` = boot throws on missing; `prod/staging` = required only in those tiers; `optional` = defaulted; `build-time` = VITE_*.

### Backend — read in `backend/src/config/index.ts`

| Name | Required? | Default | Format | Consumer(s) (file:line) | Secret? | Where stored (prod) | Notes |
|---|---|---|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | required (all envs) — `config/index.ts:120` | none | secret:≥32 chars | `config/index.ts:120`; blocklist `:324`; length `:338` | yes | GCP Secret Manager → Cloud Run secret ref | `requireEnv`; rejected if in `BLOCKED_JWT_VALUES` (`:315-322`) or `<32` chars. Generate `openssl rand -base64 32`. |
| `JWT_REFRESH_SECRET` | required (all envs) — `config/index.ts:124` | none | secret:≥32 chars | `config/index.ts:124`; blocklist `:330`; length `:345` | yes | GCP Secret Manager | Same rules as access secret. |
| `AUDIT_LOG_SALT` | required (all envs) — `config/index.ts:358` | `''` (then hard-fail) | hex (≥16 chars) | `config/index.ts:113`, gate `:358` | yes | GCP Secret Manager | **NOT rotatable** — rotating makes historic audit-log PHI undecryptable (`:358-366`). |
| `PHI_ENCRYPTION_KEY` | prod/staging — `config/index.ts:427-432`; format `:436-464` | none | hex:64 (256-bit) | `config/index.ts:436`; `encryption.ts:182` | yes | GCP Secret Manager | 64 hex chars, hex-only, non-placeholder. **NOT rotatable** — rotating orphans all encrypted PHI. |
| `DATABASE_URL` | prod/staging (config) — `config/index.ts:425-432`; always (runtime) — `database.ts:58-62` | none | url (postgres / prisma+postgres) | `database.ts:58`; required-list `config/index.ts:426` | yes | GCP Secret Manager (`DATABASE_URL:latest`) | Migrate job consumes the same secret (`deploy.yml:144`). Throws "DATABASE_URL environment variable is not set" if unset in any env. |
| `NODE_ENV` | optional | `'development'` | enum: development/staging/production | `config/index.ts:34-36,99`; `database.ts:120`; `mockFhirServer.ts:195` | no | Cloud Run env (+ Dockerfile `ENV`) | Drives the security tier. Dev tier loosens cookies + downgrades BAA gates to warnings. |
| `OMH_DEPLOY_ENFORCE_PROD` | optional | unset | bool (`'true'`) | `config/index.ts:53` | no | Dockerfile `ENV` (`Dockerfile:54`) | RT-H1: if `'true'` + NODE_ENV resolves to dev → boot hard-fails (refuses to serve at dev tier on a deployed image). |
| `PORT` | optional | `3001` | int | `config/index.ts:100` | no | Cloud Run injects `$PORT` | |
| `JWT_ACCESS_EXPIRES_SECONDS` | optional | `900` (15 min) | int (seconds) | `config/index.ts:121` | no | Cloud Run env | Integer seconds, NOT a string like `15m`. |
| `JWT_REFRESH_EXPIRES_SECONDS` | optional | `604800` (7 days) | int (seconds) | `config/index.ts:125` | no | Cloud Run env | |
| `COOKIE_SAME_SITE` | optional | derived | enum: strict/lax/none | `config/index.ts:89`, used `:147` | no | Cloud Run env | Explicit value wins; else `none` if `COOKIE_DOMAIN` set; else `strict` (prod) / `lax` (dev). |
| `COOKIE_DOMAIN` | optional | `undefined` | string (`.domain.tld`) | `config/index.ts:90,95,148` | no | Cloud Run env | Setting it forces SameSite=None + Secure (`:91-95`). |
| `MAX_LOGIN_ATTEMPTS` | optional | `5` | int | `config/index.ts:157` | no | Cloud Run env | |
| `LOCKOUT_DURATION_MINUTES` | optional | `30` | int (minutes) | `config/index.ts:158` | no | Cloud Run env | Multiplied to ms. |
| `BCRYPT_ROUNDS` | optional | `13` | int | `config/index.ts:160` | no | Cloud Run env | HIPAA-recommended ≥13. |
| `CORS_ORIGIN` | prod (required) — `app.ts:83-84` | localhost array | csv of urls | `config/index.ts:165`; `app.ts:80` | no | Cloud Run env | Comma-separated; localhost rejected in prod (`app.ts:87-88`). |
| `RATE_LIMIT_WINDOW_MS` | optional | `900000` (15 min) | int (ms) | `config/index.ts:177` | no | Cloud Run env | |
| `RATE_LIMIT_MAX_REQUESTS` | optional | `100` | int | `config/index.ts:178` | no | Cloud Run env | NOT `RATE_LIMIT_MAX`. |
| `REDIS_URL` | optional | `''` | url (redis://) | `config/index.ts:186` | yes (conn string) | GCP Secret Manager / Cloud Run env | Shared rate-limit + AI-spend store (Cloud Memorystore). Unset → per-instance in-memory. If set but unreachable → requests error (fail-closed). |
| `AUDIT_CLEANUP_TOKEN` | optional | `''` | secret:string | `config/index.ts:196` | yes | GCP Secret Manager | When set, enables `POST /api/v1/internal/audit-cleanup` for Cloud Scheduler and disables the in-process 24h interval. |
| `DEMO_ACCOUNT_ENABLED` | optional (prod-blocked) | `false` | bool (`'true'`) | `config/index.ts:202`; prod-block `:489` | no | Cloud Run env | Boot hard-fails if `true` in production (`:489-495`). |
| `DEMO_EMAIL` | optional | `''` | email | `config/index.ts:203` | no | Cloud Run env | |
| `DEMO_PASSWORD` | optional | `''` | secret:string | `config/index.ts:204` | yes | Cloud Run env | |
| `SENDGRID_API_KEY` | optional | `''` | secret (`SG.*`) | `config/index.ts:209,210` | yes | GCP Secret Manager | `config.email.enabled` derived from whether this is set (`:209`). |
| `EMAIL_FROM` | optional | `noreply@ownmyhealth.com` | email | `config/index.ts:211` | no | Cloud Run env | Must be a verified SendGrid sender; default unsafe for prod. |
| `EMAIL_FROM_NAME` | optional | `OwnMyHealth` | string | `config/index.ts:212` | no | Cloud Run env | |
| `FRONTEND_URL` | optional | `http://localhost:5173` | url | `config/index.ts:213` | no | Cloud Run env | Builds links inside emails. Default unsafe for prod. |
| `SENDGRID_SANDBOX_MODE` | optional (prod-blocked) | `false` (forced `true` in staging) | bool (`'true'`) | `config/index.ts:218`; prod-block `:502` | no | Cloud Run env | Boot hard-fails if `true` in production (`:502-508`). |
| `GCS_BUCKET_NAME` | prod (required) — `config/index.ts:480-486` | `ownmyhealth-user-files` (dev/staging only) | string | `config/index.ts:228`; `storageService.ts:17` | no | Cloud Run env | F-28: prod must set explicitly or boot hard-fails. |
| `GCP_PROJECT_ID` | optional (OCR/storage) | `''` | string | `config/index.ts:229`; `ocrService.ts:84,116,502`; `storageService.ts:17` | no | Cloud Run env | NOT `GOOGLE_CLOUD_PROJECT`. Warns at boot in prod if unset (`:518`). |
| `GOOGLE_APPLICATION_CREDENTIALS` | optional | `''` | path OR inline JSON | `config/index.ts:231`; `ocrService.ts:91,507` | yes (if inline JSON) | Cloud Run env (prefer Workload Identity) | `ocrService` parses inline JSON if value starts with `{` (`ocrService.ts:93`). |
| `GOOGLE_BAA_ACTIVE` | conditional: prod + `GCP_PROCESSOR_ID` set — `config/index.ts:401-414` | `false` | bool (`'true'`) | `config/index.ts:236`; gate `:401-414` | no | Cloud Run env | Gates Document AI OCR. Prod hard-fails if processor set + flag unset. |
| `GCP_PROCESSOR_ID` | optional (OCR) | unset | string | `config/index.ts:401` (gate trigger); `ocrService.ts:87,118,504` | no | Cloud Run env | NOT `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`. Setting it triggers the `GOOGLE_BAA_ACTIVE` requirement in prod. |
| `ANTHROPIC_API_KEY` | optional (feature-gate) | `''` | secret (`sk-ant-*`) | `config/index.ts:241`; `anthropicClient.ts:49,68`; `claudeExtraction.ts:279`; `sbcExtraction.ts:1034` | yes | GCP Secret Manager | Setting it triggers the `ANTHROPIC_BAA_ACTIVE` requirement in prod. |
| `ANTHROPIC_BAA_ACTIVE` | conditional: prod + `ANTHROPIC_API_KEY` set — `config/index.ts:381-394` | `false` | bool (`'true'`) | `config/index.ts:245`; gate `:381-394` | no | Cloud Run env | Gates Claude calls. Prod hard-fails if key set + flag unset; dev/staging warn (runtime gate still blocks). |
| `AI_DAILY_BUDGET_USD` | optional | `50` | number (USD; `0` disables) | `config/index.ts:256` | no | Cloud Run env | Global rolling daily AI spend cap (M-4). NaN/neg → warn + default. |
| `AI_USER_DAILY_BUDGET_USD` | optional | `5` | number (USD; `0` disables) | `config/index.ts:257` | no | Cloud Run env | Per-user rolling daily cap (M-4). |
| `QUEST_FHIR_CLIENT_ID` | optional (feature-gate) | `''` | string | `config/index.ts:266` | yes | GCP Secret Manager | Feature disabled unless set ("Connect Quest" returns 503). |
| `QUEST_FHIR_CLIENT_SECRET` | optional | `''` | secret | `config/index.ts:267` | yes | GCP Secret Manager | |
| `QUEST_FHIR_BASE_URL` | optional | `https://api.questdiagnostics.com/fhir/r4` | url | `config/index.ts:268-269` | no | Cloud Run env | Set to mock URL `http://localhost:3001/api/v1/mock-fhir/r4` for local dev. |
| `QUEST_FHIR_REDIRECT_URI` | optional | `https://api.ownmyhealth.io/api/v1/fhir/callback` | url | `config/index.ts:270-272` | no | Cloud Run env | Default unsafe for non-prod. |
| `QUEST_FHIR_SUCCESS_REDIRECT` | optional | `http://localhost:5173/settings?labConnected=quest` | url | `config/index.ts:273-275` | no | Cloud Run env | Default points at localhost — set per-env. |
| `QUEST_FHIR_AUTH_HOSTS` | optional | `''` (→ empty list) | csv of hostnames | `config/index.ts:280` | no | Cloud Run env | SSRF/exfil allowlist (see [Quest FHIR](#quest-diagnostics-smart-on-fhir-lab-sync)). |

### Backend — read directly via `process.env` (NOT in the `config` object)

| Name | Required? | Default | Format | Consumer(s) (file:line) | Secret? | Where stored (prod) | Notes |
|---|---|---|---|---|---|---|---|
| `DATABASE_POOL_SIZE` | optional | `10` | int | `database.ts:108` | no | Cloud Run env | pg pool `max`. |
| `GCP_LOCATION` | optional | `us` | string | `ocrService.ts:117` | no | Cloud Run env | Document AI processor location. NOT `GOOGLE_DOCUMENT_AI_LOCATION`. |
| `DISABLE_CSRF` | optional (dev only) | unset | bool (`'true'`) | `csrf.ts:159`; `app.ts:215` | no | not set in prod | Only honored when `config.isDevelopment` (`csrf.ts:159`). |

### Frontend — build-time (`import.meta.env.VITE_*`)

| Name | Required? | Default | Format | Consumer(s) (file:line) | Secret? | Where stored (prod) | Notes |
|---|---|---|---|---|---|---|---|
| `VITE_API_URL` | build-time | `http://localhost:3001/api/v1` | url | `src/services/api/client.ts:10`; `src/services/uploadUtils.ts:8`; `vite.config.ts:74` | no | Set in CI build step (`deploy.yml:330`) | Baked into `dist/` at build time; also rewrites the CSP `connect-src` (`vite.config.ts:32-56`). |
| `VITE_DEBUG` | build-time | unset | bool (`'true'`) | `src/utils/logger.ts:17` | no | Build env (unset in prod) | Re-enables debug/info logs in a prod build. |
| `VITE_DEMO_MODE` | build-time | unset | bool (`'true'`) | `src/App.tsx:281`; `src/components/dashboard/DashboardHeader.tsx:90`; `src/hooks/useBiomarkerData.ts:19` | no | Build env (unset in prod) | Shows the demo login + banner; demo data path requires `import.meta.env.DEV` too (`useBiomarkerData.ts:19`). |
| `import.meta.env.DEV` / `import.meta.env.PROD` | build-time (Vite built-in) | derived from `--mode` | bool | `src/utils/logger.ts:14`; `src/components/auth/LoginPage.tsx:79,90`; `src/services/api/client.ts:129,248` | no | n/a (Vite internal) | Vite-injected mode flags, not user-set env vars. |

### CI/CD — GitHub Secret (deploy time only, never read at runtime)

| Name | Required? | Format | Consumer(s) (file:line) | Secret? | Where stored | Notes |
|---|---|---|---|---|---|---|
| `secrets.GCP_SA_KEY` | required for deploy | JSON service-account key | `deploy.yml:79,259,310`; `deploy-staging.yml` | yes | GitHub repository Secret | Authenticates `google-github-actions/auth` to GCP. Never read by the running app. |

---

## By category

### Critical secrets

| Var | Why critical | Boot behavior | Source |
|---|---|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Sign/verify all auth tokens | `requireEnv` throws if missing (`config/index.ts:120,124`); blocklist + ≥32 chars | `:120,124,315-351` |
| `PHI_ENCRYPTION_KEY` | Master key for AES-256-GCM PHI encryption | prod/staging required + 64-hex/format validated | `:427-464`; `encryption.ts:182` |
| `AUDIT_LOG_SALT` | Salts audit-log PHI snapshot encryption | hard-fail if missing or `<16` chars (all envs) | `:358-366` |
| `DATABASE_URL` | DB connection (Cloud SQL) | prod/staging required (config) + always required at runtime (`database.ts:58`) | `:426`; `database.ts:58` |
| `ANTHROPIC_API_KEY`, `SENDGRID_API_KEY`, `QUEST_FHIR_CLIENT_SECRET`, `REDIS_URL`, `AUDIT_CLEANUP_TOKEN` | Third-party / shared-store secrets | optional / feature-gated | see master table |

### Database & persistence

```ts
// Source: backend/src/services/database.ts:58-62
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set');
}
```

- `DATABASE_URL` — required at runtime in every env (`database.ts:58`); also in the prod/staging required-list (`config/index.ts:426`).
- `DATABASE_POOL_SIZE` — pg pool `max`, default `10` (`database.ts:108`).

### Auth & sessions

- `JWT_ACCESS_EXPIRES_SECONDS` (900) / `JWT_REFRESH_EXPIRES_SECONDS` (604800) — integer seconds (`config/index.ts:121,125`).
- `BCRYPT_ROUNDS` (13), `MAX_LOGIN_ATTEMPTS` (5), `LOCKOUT_DURATION_MINUTES` (30) — `config/index.ts:157-160`.
- Cookie config `COOKIE_SAME_SITE` / `COOKIE_DOMAIN` — resolved together with a `secure` derivation (M7). There is **no `CSRF_SECRET`** — CSRF is a stateless double-submit cookie (`csrf.ts`), toggled only by `DISABLE_CSRF`.

```ts
// Source: backend/src/config/index.ts:88-95
const resolvedSameSite: 'strict' | 'lax' | 'none' =
  (process.env.COOKIE_SAME_SITE as 'strict' | 'lax' | 'none') ||
  (process.env.COOKIE_DOMAIN ? 'none' : (isProductionEnv ? 'strict' : 'lax'));
const resolvedCookieSecure =
  isProductionEnv ||
  isStagingEnv ||
  resolvedSameSite === 'none' ||
  !!process.env.COOKIE_DOMAIN;
```

A boot invariant rejects the impossible `SameSite=None` without `Secure` combination in every env (`config/index.ts:301-307`).

### Rate limiting

- `RATE_LIMIT_WINDOW_MS` (900000) / `RATE_LIMIT_MAX_REQUESTS` (100) — `config/index.ts:177-178`.
- `REDIS_URL` (optional) — shared store backing all 8 rate limiters across Cloud Run instances (`config/index.ts:186`). Unset → per-instance in-memory `MemoryStore`; set-but-unreachable → rate-limited requests **error** rather than silently skip the limit (`backend/.env.example:154-155`).

### AI — Anthropic + spend circuit breaker + Google Document AI

- `ANTHROPIC_API_KEY` (`config/index.ts:241`) + `ANTHROPIC_BAA_ACTIVE` (`:245`) — the BAA flag gates `claudeExtraction`/`sbcExtraction` and all Claude calls.
- `AI_DAILY_BUDGET_USD` (50) / `AI_USER_DAILY_BUDGET_USD` (5) — rolling per-UTC-day spend caps enforced by `aiSpendGuard`, accumulator updated by `aiCostTracker`; `0` disables a scope (`config/index.ts:256-257`).
- `GCP_PROCESSOR_ID` (`ocrService.ts:88`), `GCP_LOCATION` (`ocrService.ts:117`, default `us`), `GOOGLE_APPLICATION_CREDENTIALS` (`ocrService.ts:91`) + `GOOGLE_BAA_ACTIVE` (`config/index.ts:236`) — gate Document AI image OCR.

**Per-instance caveat (acceptance Q11):** the AI spend accumulator is in-memory per Cloud Run instance, so under autoscale the effective ceiling is N×budget (bounded by `--max-instances=3`, `deploy.yml:189`). The fix is to back it with `REDIS_URL` (`config/index.ts:250-254`).

### Quest Diagnostics SMART-on-FHIR lab sync

| Var | Default | Source |
|---|---|---|
| `QUEST_FHIR_CLIENT_ID` | `''` (feature disabled unless set) | `config/index.ts:266` |
| `QUEST_FHIR_CLIENT_SECRET` | `''` | `config/index.ts:267` |
| `QUEST_FHIR_BASE_URL` | `https://api.questdiagnostics.com/fhir/r4` | `config/index.ts:268-269` |
| `QUEST_FHIR_REDIRECT_URI` | `https://api.ownmyhealth.io/api/v1/fhir/callback` | `config/index.ts:270-272` |
| `QUEST_FHIR_SUCCESS_REDIRECT` | `http://localhost:5173/settings?labConnected=quest` | `config/index.ts:273-275` |
| `QUEST_FHIR_AUTH_HOSTS` | `''` (→ empty list) | `config/index.ts:280` |

```ts
// Source: backend/src/config/index.ts:280-283
authHosts: (process.env.QUEST_FHIR_AUTH_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean),
```

`QUEST_FHIR_AUTH_HOSTS` is an **SSRF / token-exfiltration allowlist**: the patient Bearer token and the OAuth `client_secret` are only ever sent to the FHIR base host or a host on this list (`config/index.ts:276-279`). Empty list means the SMART authorize/token/revoke endpoints must live on the FHIR base host. **Local dev / mock**: set `QUEST_FHIR_BASE_URL=http://localhost:3001/api/v1/mock-fhir/r4` and leave `QUEST_FHIR_CLIENT_ID` empty/sandbox to exercise the flow without real Quest credentials (`backend/.env.example:285-300`).

### Email (SendGrid)

- `SENDGRID_API_KEY` (`config/index.ts:210`; `config.email.enabled` derived at `:209`), `EMAIL_FROM` (default `noreply@ownmyhealth.com`, `:211`), `EMAIL_FROM_NAME` (`:212`), `SENDGRID_SANDBOX_MODE` (`:218`).
- Staging forces `SENDGRID_SANDBOX_MODE=true` (`:218`); production boot hard-fails if it is `true` (`:502-508`).

### File storage (GCS)

- `GCS_BUCKET_NAME` (prod required, `:480-486`), `GCP_PROJECT_ID` (`:229`), `GOOGLE_APPLICATION_CREDENTIALS` (`:231` / `ocrService.ts:91`).

### Scheduled maintenance / ops

- `AUDIT_CLEANUP_TOKEN` (`config/index.ts:196`) — see [acceptance Q14](#acceptance-questions).

### CORS & frontend URLs

- `CORS_ORIGIN` (`config/index.ts:165`; `app.ts:80`, prod-required at `app.ts:83-84`), `FRONTEND_URL` (`config/index.ts:213`).

```ts
// Source: backend/src/app.ts:80-91
const envValue = process.env.CORS_ORIGIN;
if (config.isProduction) {
  if (!envValue) {
    throw new Error('CORS_ORIGIN must be set in production');
  }
  const envOrigins = envValue.split(',').map(o => o.trim()).filter(Boolean);
  if (envOrigins.some(o => o.includes('localhost') || o.includes('127.0.0.1'))) {
    throw new Error('CORS_ORIGIN cannot contain localhost in production');
  }
  const origins = Array.from(new Set([...envOrigins, ...HARDCODED_PRODUCTION_ORIGINS]));
  return origins.length === 1 ? origins[0] : origins;
}
```

### Demo mode

- `DEMO_ACCOUNT_ENABLED` (prod-blocked, `:489`), `DEMO_EMAIL`, `DEMO_PASSWORD` (`config/index.ts:202-204`).

### Feature flags / BAA gates

- `ANTHROPIC_BAA_ACTIVE`, `GOOGLE_BAA_ACTIVE` (BAA gates), `DISABLE_CSRF` (dev-only CSRF off), `OMH_DEPLOY_ENFORCE_PROD` (deploy-tier guard).

### Frontend build-time

- `VITE_API_URL`, `VITE_DEMO_MODE`, `VITE_DEBUG` (see master table).

---

## Startup validation

All startup checks execute at module load of `backend/src/config/index.ts` (importing it triggers them; `app.ts` does no env validation except the prod `CORS_ORIGIN` check in `app.ts`). Order and behavior:

```
import config/index.ts
   │
   ├─ OMH_DEPLOY_ENFORCE_PROD=true + dev-tier?  → throw (:53-60)
   ├─ requireEnv('JWT_ACCESS_SECRET')           → throw if missing (:120)
   ├─ requireEnv('JWT_REFRESH_SECRET')          → throw if missing (:124)
   ├─ cookie SameSite=None without Secure?      → throw (:301-307)
   ├─ JWT secret in BLOCKED_JWT_VALUES?         → throw (:324,330)
   ├─ JWT secret length < 32?                   → throw (:338,345)
   ├─ AUDIT_LOG_SALT missing or < 16 chars?     → throw (:358-366)
   ├─ ANTHROPIC_API_KEY set + BAA off?          → prod: throw / dev,staging: warn (:381-394)
   ├─ GCP_PROCESSOR_ID set + GOOGLE_BAA off?    → prod: throw / dev,staging: warn (:401-414)
   └─ if prod OR staging (:422):
        ├─ DATABASE_URL / PHI_ENCRYPTION_KEY missing? → throw (:429-433)
        ├─ PHI_ENCRYPTION_KEY < 64 / non-hex / placeholder? → throw (:439-464)
        ├─ CORS_ORIGIN contains localhost?      → warn to stderr (:470-472)
        ├─ prod + GCS_BUCKET_NAME unset?         → throw (:480-486)
        ├─ prod + DEMO_ACCOUNT_ENABLED=true?     → throw (:489-495)
        ├─ prod + SENDGRID_SANDBOX_MODE=true?    → throw (:502-508)
        └─ ANTHROPIC/SENDGRID/GCP key unset?     → warn to stderr (:512-520)
```

### JWT secrets — `requireEnv` (throws at module load)

```ts
// Source: backend/src/config/index.ts:120,124
accessSecret: requireEnv('JWT_ACCESS_SECRET'),
...
refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
```

If omitted, `requireEnv` throws `Missing required environment variable: JWT_ACCESS_SECRET. ...` (`config/index.ts:21-25`) — boot crash, every environment.

### Prod/staging required-vars gate

```ts
// Source: backend/src/config/index.ts:422-433
if (config.isProduction || config.isStaging) {
  const envLabel = config.isProduction ? 'production' : 'staging';
  const requiredEnvVars = [
    'DATABASE_URL',
    'PHI_ENCRYPTION_KEY',
  ];
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for ${envLabel}: ${missing.join(', ')}`);
  }
```

### PHI_ENCRYPTION_KEY format gate

```ts
// Source: backend/src/config/index.ts:436-450
const phiKey = process.env.PHI_ENCRYPTION_KEY!;
const hexRegex = /^[0-9a-fA-F]+$/;
if (phiKey.length < 64) {
  throw new Error(
    `PHI_ENCRYPTION_KEY must be at least 64 hex characters (256 bits). Current length: ${phiKey.length}. ` +
    `Generate with: openssl rand -hex 32`
  );
}
if (!hexRegex.test(phiKey)) {
  throw new Error('PHI_ENCRYPTION_KEY must contain only hexadecimal characters (0-9, a-f, A-F)');
}
```

Known placeholder keys are also rejected (`config/index.ts:453-464`).

### AUDIT_LOG_SALT length gate

```ts
// Source: backend/src/config/index.ts:357-366
const MIN_AUDIT_SALT_LENGTH = 16;
if (!config.auditSalt || config.auditSalt.length < MIN_AUDIT_SALT_LENGTH) {
  throw new Error(
    `AUDIT_LOG_SALT must be set and at least ${MIN_AUDIT_SALT_LENGTH} characters. ` +
    `Historic audit logs are encrypted with this salt — rotating it breaks decryption. ...`
  );
}
```

### BAA gates (Anthropic + Document AI)

```ts
// Source: backend/src/config/index.ts:381-394 (Anthropic)
if (config.anthropic.apiKey && !config.anthropic.baaActive) {
  if (config.isProduction) {
    throw new Error(
      'ANTHROPIC_BAA_ACTIVE must be set to "true" in production when ANTHROPIC_API_KEY is configured. ...'
    );
  } else {
    process.stderr.write('⚠️  ANTHROPIC_BAA_ACTIVE is not set to "true". Claude calls will be blocked ...\n');
  }
}

// Source: backend/src/config/index.ts:401-414 (Google Document AI)
if (process.env.GCP_PROCESSOR_ID && !config.gcp.documentAiBaaActive) {
  if (config.isProduction) {
    throw new Error(
      'GOOGLE_BAA_ACTIVE must be set to "true" in production when GCP_PROCESSOR_ID is configured. ...'
    );
  } else {
    process.stderr.write('⚠️  GOOGLE_BAA_ACTIVE is not set to "true". Document AI image OCR will be blocked ...\n');
  }
}
```

`ANTHROPIC_BAA_ACTIVE` gates `claudeExtraction` / `sbcExtraction` (Claude PDF extraction) and Claude calls generally; `GOOGLE_BAA_ACTIVE` gates `ocrService.processImageWithDocumentAI` (the runtime gate is the load-bearing check in dev/staging).

### Prod-only prohibitions

`DEMO_ACCOUNT_ENABLED=true` (`:489-495`), `SENDGRID_SANDBOX_MODE=true` (`:502-508`), and missing `GCS_BUCKET_NAME` (`:480-486`) each hard-fail boot in production.

---

## Secret rotation policy

| Secret | Rotatable? | Cadence | Where it lives (prod) | Notes |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | yes | rotate freely; in-flight access tokens (≤15 min) invalidate naturally | GCP Secret Manager → Cloud Run secret ref | Rotating logs everyone out as cached tokens expire. |
| `JWT_REFRESH_SECRET` | yes | rotate on suspected compromise; invalidates all refresh tokens (forces re-login) | GCP Secret Manager | |
| `PHI_ENCRYPTION_KEY` | **NO — not rotatable in place** | n/a | GCP Secret Manager | Rotating orphans every encrypted PHI column (`config/index.ts:436` / `encryption.ts:182`). A rotation requires bulk decrypt-with-old / re-encrypt-with-new — TBD (external: no in-repo re-encryption procedure exists; resolve via an ops runbook + a maintenance Cloud Run job modeled on `backfill-userfile-filenames` in `maintenance.yml`). |
| `AUDIT_LOG_SALT` | **NO — not rotatable in place** | n/a | GCP Secret Manager | Rotating makes historic audit-log PHI undecryptable (`config/index.ts:358-366`). For existing prod, extract the historic salt from `system_config.audit_encryption_salt` (decrypt with `PHI_ENCRYPTION_KEY`) before first setting it (`config/index.ts:362-365`). |
| `DATABASE_URL` | yes | rotate DB password per ops policy | GCP Secret Manager (`DATABASE_URL:latest`, `deploy.yml:144`) | Migrate job + service both read this secret ref. |
| `ANTHROPIC_API_KEY`, `SENDGRID_API_KEY`, `QUEST_FHIR_CLIENT_SECRET` | yes | per third-party provider policy | GCP Secret Manager | No re-encryption impact. |
| `AUDIT_CLEANUP_TOKEN`, `REDIS_URL`, `DEMO_PASSWORD` | yes | rotate freely | GCP Secret Manager / Cloud Run env | |
| `secrets.GCP_SA_KEY` | yes | rotate per ops policy (or migrate to Workload Identity Federation, `deploy.yml:22-24`) | GitHub repository Secret | Deploy-time only. |

**Exact rotation cadence numbers** (e.g. "every 90 days") are **TBD (external: rotation cadence lives in an ops runbook outside the repo — resolve via GCP Secret Manager UI / the owner's password vault).** No file in the repo records a numeric cadence.

---

## Local vs staging vs prod

| Var | Local (dev) | Staging | Production | Source |
|---|---|---|---|---|
| `NODE_ENV` | unset → `development` | `staging` | `production` | `config/index.ts:34-36`; `Dockerfile:53` |
| `OMH_DEPLOY_ENFORCE_PROD` | unset | `true` (image) | `true` (image + deploy) | `Dockerfile:54`; `deploy.yml:190` |
| `DATABASE_URL` | local Prisma Postgres | Cloud SQL | Cloud SQL (Secret Manager) | `backend/.env.example:30`; `deploy.yml:144` |
| `PHI_ENCRYPTION_KEY` | placeholder fails validation in dev examples; set a real hex32 to run | required | required (Secret Manager) | `backend/.env.example:82`; `config/index.ts:427` |
| `CORS_ORIGIN` | localhost array default | staging frontend domain | `https://ownmyhealth.io` (+ hardcoded prod origins) | `config/index.ts:165`; `backend/.env.production.example:67`; `app.ts:82-91` |
| `SENDGRID_SANDBOX_MODE` | `false` | forced `true` (`isStagingEnv`) | must NOT be `true` (boot hard-fails) | `config/index.ts:218,502` |
| `ANTHROPIC_BAA_ACTIVE` | warn if key set + off | warn (no real PHI) | hard-fail if key set + off | `config/index.ts:381-394` |
| `GCS_BUCKET_NAME` | falls back to `ownmyhealth-user-files` | falls back | required explicit (`ownmyhealth-prod` bucket) | `config/index.ts:228,480` |
| `DEMO_ACCOUNT_ENABLED` | allowed | allowed (testing) | hard-fail if `true` | `config/index.ts:489` |
| `VITE_API_URL` (build) | `http://localhost:3001` | `https://api-staging.ownmyhealth.io/api/v1` | `https://api.ownmyhealth.io/api/v1` | `.env.example:15`; `.env.staging:5`; `deploy.yml:330` (prod build env); staging via `--mode staging` (`deploy-staging.yml:131`) |

**Defaults safe for local dev that must NEVER be left as default in prod (acceptance Q8):** `GCS_BUCKET_NAME` (boot hard-fails in prod if unset, but a wrong-namespace value silently mis-routes PHI), `EMAIL_FROM` (`noreply@ownmyhealth.com` is a default; prod needs a verified sender), and the Quest FHIR redirect URIs `QUEST_FHIR_REDIRECT_URI` / `QUEST_FHIR_SUCCESS_REDIRECT` (defaults point at `localhost:5173` and the prod callback host).

---

## How DATABASE_URL is provisioned for a Cloud Run deploy (acceptance Q5)

Production runs on **GCP Cloud Run** (not Railway — `backend/railway.toml` is a legacy/alternate target, `railway.toml:9-13`). `DATABASE_URL` is a **GCP Secret Manager** secret. The deploy pipeline wires it into both the migrate job and the service:

```yaml
# Source: .github/workflows/deploy.yml:139-150 (migrate job)
gcloud run jobs deploy ${{ env.MIGRATE_JOB }} \
  --image "$IMAGE" \
  --region "${{ env.REGION }}" \
  --project "${{ env.PROJECT_ID }}" \
  --set-cloudsql-instances "${{ env.CLOUDSQL_INSTANCE }}" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" \
  ...
  --command npx \
  --args prisma,migrate,deploy \
  --max-retries 0 ...
```

Migrations run as the `ownmyhealth-migrate` Cloud Run **job** AFTER image push and BEFORE the new revision is staged (`deploy.yml:106-161`). The container image `CMD` is `["node", "dist/app.js"]` only — **no boot-migrate** (`Dockerfile:93`). The service itself reads `DATABASE_URL` from the same Secret Manager ref (wired out-of-band on the Cloud Run service; the deploy step uses `--update-env-vars=NODE_ENV=production` to merge one key without wiping the secret refs, `deploy.yml:179-191`). The whole deploy is gated on CI (`needs: ci`, `deploy.yml:57-66`).

```
push master ──▶ ci.yml (lint/test/audit/RLS) ──needs──▶ build-and-stage
                                                          ├─ docker build + push :sha
                                                          ├─ jobs deploy ownmyhealth-migrate (DATABASE_URL secret) + execute --wait
                                                          └─ run deploy --no-traffic --tag staging-<sha>
                                                                   │
                                                          smoke-test (/health) ──▶ promote (100% traffic) ──▶ deploy-frontend (VITE_API_URL)
```

---

## Drift findings

Generated by grepping `process\.env\.[A-Z_]+` (backend), `import\.meta\.env\.[A-Z_]+` (frontend), and reading the example env files.

| Env var | Declared in `config/index.ts`? | In example env file? | Code usage (grep) | Notes |
|---|---|---|---|---|
| `DATABASE_POOL_SIZE` | no | yes (`backend/.env.example:34`, commented) | `database.ts:108` | Read directly via `process.env`, not surfaced in `config`. Working, not drift. |
| `GCP_LOCATION` | no | yes (`backend/.env.example:238`, commented) | `ocrService.ts:117` | Read directly via `process.env`. Working, not drift. |
| `DISABLE_CSRF` | no | yes (`backend/.env.example:191`, commented) | `csrf.ts:159`; `app.ts:215` | Read directly via `process.env`. Working, not drift. |
| `RLS_ENFORCEMENT` | no | comment-only in two files | **0 code hits** | **Dead flag.** Removed at the `omh_app` NOBYPASSRLS cutover; no longer read by any code (`database.ts:209-210`). In `backend/.env.example:95-98` it is an explanatory "Do not re-add" removal comment (not a settable `key=value`). In `backend/.env.staging.example:39-41` a stale commented `# RLS_ENFORCEMENT=strict` still lingers with outdated "flip to strict after omh_app is live" guidance that now contradicts the unconditional posture — safe to delete the commented line. |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | n/a (frontend) | yes (`.env.example:32-33`, commented) | **0 code hits** | Legacy/unused Supabase placeholders; never read by `src/**`. Safe to delete from `.env.example`. |

No env var declared in `config/index.ts` is unread by code, and (aside from the dead/unused entries above) no settable example-file entry lacks a code reader. The legacy CMS/OpenAI vars (`CMS_API_KEY`, `CMS_API_BASE_URL`, `CMS_API_TIMEOUT_MS`, `OPENAI_API_KEY`) are **not present** in `backend/.env.example` — nothing to flag.

---

## Acceptance questions

Self-answered from this doc alone.

**Q1. Which env vars are strictly required to boot the backend in production?**
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AUDIT_LOG_SALT` (all envs); plus `DATABASE_URL`, `PHI_ENCRYPTION_KEY`, and `GCS_BUCKET_NAME` in production. See [Startup validation](#startup-validation) and the [Master table](#master-table). `CORS_ORIGIN` is also required in prod (`app.ts:83-84`).

**Q2. What happens if `JWT_ACCESS_SECRET` is omitted?**
`requireEnv('JWT_ACCESS_SECRET')` throws at module load: `Missing required environment variable: JWT_ACCESS_SECRET. ...` (`backend/src/config/index.ts:120` calling the helper at `:18-28`). Boot crashes in every environment.

**Q3. Which env vars hold PHI-adjacent secrets, and which are NOT rotatable without re-encrypting data?**
`PHI_ENCRYPTION_KEY` and `AUDIT_LOG_SALT` are PHI-adjacent and **not rotatable in place** — see [Secret rotation policy](#secret-rotation-policy). Rotating either orphans existing encrypted PHI / audit logs.

**Q4. Which vars are build-time vs runtime?**
Build-time: `VITE_API_URL`, `VITE_DEBUG`, `VITE_DEMO_MODE` (+ Vite built-ins `import.meta.env.DEV/PROD`) — baked into `dist/` at build time. Everything else is runtime. See [Frontend build-time](#frontend--build-time-importmetaenvvite_) in the master table.

**Q5. Where is `DATABASE_URL` stored in production and how is it provisioned for a new Cloud Run deploy?**
GCP Secret Manager (`DATABASE_URL:latest`); the migrate job and service both reference it. See [How DATABASE_URL is provisioned](#how-database_url-is-provisioned-for-a-cloud-run-deploy-acceptance-q5) (`deploy.yml:144`).

**Q6. Which vars control Anthropic / Google Document AI BAA protections, and what do they gate?**
`ANTHROPIC_BAA_ACTIVE` → gates `claudeExtraction` / `sbcExtraction` and Claude calls (`config/index.ts:381-394`). `GOOGLE_BAA_ACTIVE` → gates `ocrService.processImageWithDocumentAI` (`config/index.ts:401-414`). Both hard-fail prod boot when the corresponding key/processor is set but the flag is off.

**Q7. What's the CORS origin in staging vs prod, and which file reads it?**
Prod: `https://ownmyhealth.io` (+ hardcoded prod origins, `backend/.env.production.example:67`); staging: the staging frontend domain. Read in `config/index.ts:165` and `app.ts:80` (prod-required at `app.ts:83-84`). See [CORS & frontend URLs](#cors--frontend-urls).

**Q8. Which vars have local-safe defaults that must never be left as default in prod?**
`GCS_BUCKET_NAME`, `EMAIL_FROM`, `QUEST_FHIR_REDIRECT_URI`, `QUEST_FHIR_SUCCESS_REDIRECT`. See [Local vs staging vs prod](#local-vs-staging-vs-prod).

**Q9. Does `PHI_ENCRYPTION_KEY` have a rotation procedure?**
No in-repo procedure exists; rotation is not supported in place. Flagged `TBD (external: ...)` in [Secret rotation policy](#secret-rotation-policy).

**Q10. Which GitHub Actions secrets are used at deploy time but never read at runtime?**
`secrets.GCP_SA_KEY` (`deploy.yml:79,259,310`). See [CI/CD — GitHub Secret](#cicd--github-secret-deploy-time-only-never-read-at-runtime).

**Q11. How is the AI spend circuit breaker configured, and what's the per-instance caveat?**
`AI_DAILY_BUDGET_USD` (50) / `AI_USER_DAILY_BUDGET_USD` (5), enforced by `aiSpendGuard`; in-memory per Cloud Run instance → effective ceiling N×budget under autoscale (bounded by `--max-instances=3`). See [AI category](#ai--anthropic--spend-circuit-breaker--google-document-ai) (`config/index.ts:256-257,250-254`).

**Q12. What's required to enable Quest lab sync vs run the mock locally, and what does `QUEST_FHIR_AUTH_HOSTS` protect against?**
Live sync needs `QUEST_FHIR_CLIENT_ID` (+ secret); local/mock needs `QUEST_FHIR_BASE_URL=http://localhost:3001/api/v1/mock-fhir/r4` with no real credentials. `QUEST_FHIR_AUTH_HOSTS` is an SSRF / token-exfiltration allowlist. See [Quest FHIR](#quest-diagnostics-smart-on-fhir-lab-sync).

**Q13. How is rate-limit state shared across Cloud Run instances, and what's the failure mode if `REDIS_URL` is set but unreachable?**
`REDIS_URL` backs a shared store for all 8 limiters; if set but unreachable, rate-limited requests **error** (fail-closed) rather than silently skip the limit. See [Rate limiting](#rate-limiting) (`config/index.ts:186`; `backend/.env.example:154-155`).

**Q14. What does `AUDIT_CLEANUP_TOKEN` enable, and what runs in its absence?**
When set, it enables `POST /api/v1/internal/audit-cleanup` (authenticated by this shared secret for Cloud Scheduler) and disables the in-process 24h `setInterval`. When unset, the endpoint returns 404 and the in-process interval runs (rarely fires on scale-to-zero Cloud Run). See `config/index.ts:189-197` and the master-table notes.

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — how env vars wire into the middleware stack and the Cloud Run deployment topology.
- [RUNBOOK.md](./RUNBOOK.md) — operational procedures for setting and rotating secrets in production (GCP Secret Manager / Cloud Run).
- [LOCAL_DEV.md](./LOCAL_DEV.md) — how to populate `.env` locally and run against the mock FHIR server.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — every PHI field × encryption; context for `PHI_ENCRYPTION_KEY` and `AUDIT_LOG_SALT`.
- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — open secret-management findings and the BAA-gate / NOBYPASSRLS posture.

---

## Prompt drift log

- `./35-env-vars-doc.md` says the master table covers "~42 vars". The live count is **41 distinct backend env vars** (the 38 read in `config/index.ts` + `DATABASE_POOL_SIZE`, `GCP_LOCATION`, `DISABLE_CSRF` read directly) plus **3 active frontend `VITE_*`** vars (`VITE_API_URL`, `VITE_DEBUG`, `VITE_DEMO_MODE`) — close enough to "~42" but documented exactly here. The two commented Supabase `VITE_*` placeholders are dead (see [Drift findings](#drift-findings)).
- `./35-env-vars-doc.md` "Files to review" lists `backend/src/services/*.ts` as "27 non-test top-level modules". Confirmed against the fact digest (27 top-level non-test services). No drift.
- `CLAUDE.md` (repo root) still lists `uploadController.ts` as a controller and says "services (18 files)" / "config (20+ variables)". Live state: the single-file `uploadController.ts` is gone (upload handlers now live under `backend/src/controllers/upload/`), there are 27 top-level services, and `config/index.ts` reads ~38 vars directly plus 3 more read elsewhere. This is repo-CLAUDE drift, not prompt drift, but noted because a reader may cross-check against it.
- `backend/.env.staging.example:39-41` still carries a commented `# RLS_ENFORCEMENT=strict` with stale "flip to strict after omh_app is live" guidance; the flag was **removed**, not pending (`database.ts:209-210`). Recommend deleting the commented line. (Already captured in [Drift findings](#drift-findings).)
