# LOCAL_DEV.md — Zero-to-Running Setup Guide

> **Code state:** `master` @ `12b45ae` · **Refreshed:** 2026-08-01 (previous: `fb2cd32`, 2026-06-16) · **Posture:** sandbox — no GCP, see [OPEN_FINDINGS.md §Posture](./OPEN_FINDINGS.md)
>
> Every command runs verbatim on a stock machine with the prereqs below installed. Target: `git clone` → working login in under 20 minutes.
>
> **This is now the primary environment, not a convenience path.** The project has had no deployment
> target since 2026-07-14, so local is where the app runs. The practical consequence for you:
> **file upload, download and delete now work with zero GCP credentials.** `STORAGE_BACKEND=local` is
> the development default (OF-23) and stores AES-256-GCM-sealed blobs under `backend/.local-storage`.
> All you need is a valid `PHI_ENCRYPTION_KEY`.

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](../prompts/_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](../prompts/_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc passes the five tests in `_doc-quality.md` (question-answering, path-and-line, snippet, diagram, reproducibility).

---

## 1. Prerequisites

| Prereq | Version | Why / Source | Install hint |
|---|---|---|---|
| Node.js | 22.x | `backend/Dockerfile:15` pins `FROM node:22-alpine@sha256:…`; `backend/package.json:77` `engines` = `^20.19 \|\| ^22.12 \|\| >=24`. Prisma 7 requires Node `^22.12` (`backend/Dockerfile:13`). | `nvm install 22 && nvm use 22` |
| npm | bundled with Node 22 | — | comes with Node |
| PostgreSQL | 16.x recommended | CI's RLS-regression job runs `image: postgres:16` (`.github/workflows/ci.yml:165`); 15.x also works, or use `npx prisma dev` for local Prisma Postgres (`backend/.env.example:28`). | `docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16` |
| gcloud (optional) | latest | **No longer needed for file uploads** — the local storage backend covers them (OF-23). Only useful for Document AI OCR, which is also skippable (see [§8](#8-local-mocking)). | [Cloud SDK install](https://cloud.google.com/sdk/docs/install) |
| Redis (optional) | latest | Only to test the *shared* rate-limit store (`REDIS_URL`). Unset → in-memory fallback (`backend/src/middleware/rateLimitStore.ts:41`). | `docker run -d -p 6379:6379 redis` |

> **Windows ARM64 + Node 24 caveat**: native binaries can fail to install on Windows ARM64 under Node 24. Use Node 22 (recommended) or apply the documented SWC patch. See [`CLAUDE.md`](../CLAUDE.md) "Next.js SWC on Windows ARM64".

Node version is **not** TBD: `backend/Dockerfile:15` (`node:22-alpine`, digest-pinned) and `backend/package.json:77` (`engines`). Do not cite the old `node:20-alpine`.

---

## 2. Clone + install

This repo is **not** an npm-workspaces monorepo — frontend (`package.json`, root) and backend (`backend/package.json`) have **separate** `node_modules`. Install both.

```bash
# 1. Clone
git clone <repo-url> && cd OwnMyHealth

# 2. Install frontend (root)
npm install

# 3. Install backend
cd backend && npm install && cd ..
```

- Root `package.json:7` → `"dev": "vite"` (frontend dev server).
- `backend/package.json:7` → `"dev": "tsx watch src/app.ts"` (backend dev server).

---

## 3. Environment setup

Copy both `.env.example` files, then generate local secrets. **The backend refuses to boot if JWT/salt secrets are missing or weak** (boot-time `throw`, see [§10](#10-common-failures--fixes)).

```bash
cp backend/.env.example backend/.env
cp .env.example .env
```

### Required secrets (backend won't boot without these)

| Var | Generator | Boot validation | Source |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | `openssl rand -base64 32` | `requireEnv` (no fallback ever); blocklist + min 32 chars | `backend/src/config/index.ts:120`, `:324`, `:338` |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 32` | `requireEnv` (no fallback ever); blocklist + min 32 chars | `backend/src/config/index.ts:124`, `:330`, `:345` |
| `PHI_ENCRYPTION_KEY` | `openssl rand -hex 32` | 64 hex chars, hex-only, non-placeholder (prod/staging hard-fail; dev format-checked in `encryption.ts`) | `backend/src/config/index.ts:436-464` |
| `AUDIT_LOG_SALT` | `openssl rand -hex 32` | hard-fail if unset or `< 16` chars — in **every** env | `backend/src/config/index.ts:113`, `:358-367` |

```bash
openssl rand -base64 32   # → JWT_ACCESS_SECRET   (min 32 chars, no fallback)
openssl rand -base64 32   # → JWT_REFRESH_SECRET  (min 32 chars, no fallback)
openssl rand -hex 32      # → PHI_ENCRYPTION_KEY  (exactly 64 hex chars / 256 bits)
openssl rand -hex 32      # → AUDIT_LOG_SALT      (>= 16 chars; hard-fail if unset)
# Paste each into backend/.env
```

> Source marker — JWT secrets go through `requireEnv` with **no fallback** in any environment:
> ```ts
> // Source: backend/src/config/index.ts:118-125
> jwt: {
>   accessSecret: requireEnv('JWT_ACCESS_SECRET'),
>   accessExpiresIn: parseInt(process.env.JWT_ACCESS_EXPIRES_SECONDS || '900', 10),
>   refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
>   refreshExpiresIn: parseInt(process.env.JWT_REFRESH_EXPIRES_SECONDS || '604800', 10),
> },
> ```

> **There is NO `CSRF_SECRET`.** CSRF uses a stateless double-submit cookie (`backend/src/middleware/csrf.ts`). The placeholder `RLS_ENFORCEMENT=strict` was also removed — setting it has no effect (`backend/.env.example:95-98`).

### Postgres connection string

Set `DATABASE_URL` in `backend/.env`. The `.env.example` default points at a local Prisma Postgres (`backend/.env.example:30`); for a stock Postgres container use:

```bash
# backend/.env
DATABASE_URL="postgresql://postgres:dev@localhost:5432/ownmyhealth_dev"
```

Postgres defaults to port **5432** in this string. `DATABASE_URL` is read directly in `backend/src/services/database.ts:58` (throws if unset, any env) and is in the prod/staging required-list at `backend/src/config/index.ts:427`.

### Frontend env

The frontend only needs `VITE_API_URL` (`.env.example:15`):

```bash
# .env (repo root)
VITE_API_URL=http://localhost:3001
```

A fuller env reference (every var, consumer, default) lives in [`ENV_VARS.md`](./ENV_VARS.md).

---

## 4. Database provisioning

```bash
# Create the database (pick one)
createdb ownmyhealth_dev
# or:  docker exec pg psql -U postgres -c 'CREATE DATABASE ownmyhealth_dev;'
# or (Prisma Postgres, per .env.example): cd backend && npx prisma dev

cd backend
npx prisma generate          # generate the Prisma client into backend/generated/
npx prisma migrate deploy    # apply all 34 migrations
cd ..

# (optional) seed an already-verified PRO test user for smoke / e2e flows
npx tsx backend/scripts/e2e-db.ts
```

- **34 migrations** as of 2026-08-01, newest `backend/prisma/migrations/20260712_add_sessions_update_policy/`. Verify with `Glob pattern: backend/prisma/migrations/*/`.
- **19 Prisma models** in `backend/prisma/schema.prisma` (incl. `RevokedAccessToken` at `:96` and `LabConnection` at `:755`). See [`DATA_MODEL.md`](./DATA_MODEL.md) for the full ER.
- **The only seed script** is `backend/scripts/e2e-db.ts` (`npm run test:e2e:setup`). There is **no** `backend/scripts/seed*` (`backend/scripts/` holds only `setup-rls-test-db.sh`).

> The seed user is created already-verified + PRO so it bypasses the email gate and plan gating:
> ```ts
> // Source: backend/scripts/e2e-db.ts:64-74
> await prisma.user.create({
>   data: {
>     email: EMAIL,
>     passwordHash,
>     role: 'PATIENT',
>     isActive: true,
>     emailVerified: true,
>     plan: 'PRO',
>     planUpdatedAt: new Date(),
>     onboardingCompletedAt: new Date(),
>   },
> });
> ```
> Seeded credentials: `e2e-test@ownmyhealth.io` / `E2ETestPass123!` (`backend/scripts/e2e-db.ts:29-30`).

### Migrations are NOT applied at container boot

The production `Dockerfile` `CMD` is `node dist/app.js` only — migrations run as a **separate Cloud Run job** (`ownmyhealth-migrate`), gated on CI passing:

```dockerfile
# Source: backend/Dockerfile:86-93
# Migrations do NOT run at boot. `prisma migrate deploy` runs as a Cloud Run
# job in the deploy pipeline (.github/workflows/deploy.yml, "Run database
# migrations") — teardown finding #18 ...
#   docker run --rm -e DATABASE_URL=... <image> npx prisma migrate deploy
CMD ["node", "dist/app.js"]
```

The deploy pipeline runs `gcloud run jobs execute ${{ env.MIGRATE_JOB }}` (`.github/workflows/deploy.yml:158`, `MIGRATE_JOB: ownmyhealth-migrate` at `:43`), and the whole deploy is gated `needs: ci` (`.github/workflows/deploy.yml:66`). **Local impact:** running the backend from source (`npm run dev`) is unaffected — you ran `prisma migrate deploy` yourself in §4. Only if you run the *Docker image* locally must you apply migrations separately (the `docker run … npx prisma migrate deploy` line above).

```
git clone ──▶ npm install (root + backend)
                    │
                    ▼
            cp .env.example → .env (×2)  +  openssl-generate 4 secrets
                    │
                    ▼
            createdb  ──▶  npx prisma generate  ──▶  npx prisma migrate deploy (32)
                    │
                    ▼
            [optional] npx tsx backend/scripts/e2e-db.ts
                    │
                    ▼
            backend npm run dev (:3001)  +  root npm run dev (:5173)
```

---

## 5. Run

```bash
# Backend (port 3001) — tsx watch src/app.ts
(cd backend && npm run dev) &

# Frontend (port 5173) — vite
npm run dev
```

- **Backend port 3001**: default in `backend/src/config/index.ts:100` (`parseInt(process.env.PORT || '3001', 10)`); dev script `backend/package.json:7`.
- **Frontend port 5173**: Vite default (`package.json:7` → `vite`); CORS dev allowlist includes `http://localhost:5173` (`backend/src/config/index.ts:165-171`).

### Verify each is up

```bash
# Backend health (does NOT require auth) — returns 200 + {status:"healthy"} when DB connected
curl http://localhost:3001/health

# Frontend — open the Vite dev server
#   http://localhost:5173
```

The `/health` route is unauthenticated and checks DB connectivity (`backend/src/app.ts:301-312`). On boot, the backend also runs RLS assertions before listening — in dev these **warn**, in prod they `process.exit(1)`:

```ts
// Source: backend/src/services/database.ts:190-193
//   exits if BYPASSRLS=true; in non-prod it warns. See assertNoBypassRLS for
await assertNoBypassRLS();
await assertRLSForced();
```

If FORCE ROW LEVEL SECURITY is missing on the 19 RLS tables, `assertRLSForced()` logs `Refusing to start — add FORCE ROW LEVEL SECURITY (see migration 20260613)` and exits in prod (`backend/src/services/database.ts:303-305`). Running the 32 migrations from §4 satisfies this. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full startup/middleware flow.

---

## 6. Golden-path smoke test

Copy-paste sequence proving register → verify → login → biomarker create → list → **delete** end-to-end. Run with the backend up on `:3001`.

```bash
# --- Register (email + password required; firstName/lastName optional) ---
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.local","password":"SmokePass123!","firstName":"Smoke","lastName":"Test"}'

# --- Email verification gates login. Two options in dev: ---
#  (A) With no SENDGRID_API_KEY, the verification URL is PRINTED to the backend
#      console via logger.devBox('EMAIL VERIFICATION', ...). Copy the
#      /verify-email?token=... link and GET its backend equivalent:
#        curl "http://localhost:3001/api/v1/auth/verify-email?token=<TOKEN>"
#  (B) OR seed an already-verified user instead of registering:
#        npx tsx backend/scripts/e2e-db.ts
#      then log in as e2e-test@ownmyhealth.io / E2ETestPass123!

# --- Login (capture cookies — sets csrf_token + auth cookies) ---
curl -c cookies.txt -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.local","password":"SmokePass123!"}'

# --- Extract the CSRF token from the csrf_token cookie ---
CSRF=$(awk '/csrf_token/ {print $7}' cookies.txt)

# --- Create biomarker (schemas.biomarker.create: name, value, unit, category,
#     date, normalRange{min,max} all required) ---
curl -b cookies.txt -X POST http://localhost:3001/api/v1/biomarkers \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"name":"LDL","value":120,"unit":"mg/dL","category":"Lipids","date":"2026-06-01T10:00:00Z","normalRange":{"min":0,"max":100}}'

# --- List biomarkers (grab the id of the created marker) ---
curl -b cookies.txt http://localhost:3001/api/v1/biomarkers

# --- Delete it (close the loop — needs the id from the list + the CSRF header) ---
BIOMARKER_ID=<id-from-list-response>
curl -b cookies.txt -X DELETE "http://localhost:3001/api/v1/biomarkers/$BIOMARKER_ID" \
  -H "X-CSRF-Token: $CSRF"
```

### Why those exact biomarker fields

```ts
// Source: backend/src/middleware/validation.ts:403-413
create: z.object({
  name: sanitizedString(1, 100),
  value: finiteNumber.pipe(z.number().min(0, 'Value must be non-negative')),
  unit: sanitizedString(1, 20),
  category: sanitizedString(1, 50),
  date: dateString,
  normalRange: z.object({
    min: finiteNumber,
    max: finiteNumber,
    source: optionalSanitizedString(100),
  }),
```

Routes hit: `POST /` (`backend/src/routes/biomarkerRoutes.ts:85-90`), `GET /` (`:51-55`), `DELETE /:id` (`backend/src/routes/biomarkerRoutes.ts:119-123`). All require `authenticate` (router-wide, `:48`); state-changing routes require the `X-CSRF-Token` header to match the `csrf_token` cookie. Per-endpoint contracts are in [`API_REFERENCE.md`](./API_REFERENCE.md).

> **Informational**: biomarker writes route through `upsertBiomarkerReading` (`backend/src/services/biomarkerSeries.ts`), so repeated readings of the same marker append to one time-series instead of disconnected rows. The create→list→delete path above still validates as written.

```mermaid
sequenceDiagram
  participant C as curl
  participant API as backend :3001
  C->>API: POST /api/v1/auth/register
  API-->>C: 201 (verification URL logged via devBox)
  C->>API: GET /api/v1/auth/verify-email?token=...
  API-->>C: 200 emailVerified=true
  C->>API: POST /api/v1/auth/login
  API-->>C: 200 + cookies (access, refresh, csrf_token)
  C->>API: POST /api/v1/biomarkers (X-CSRF-Token)
  API-->>C: 201 { data: { id, ... } }
  C->>API: GET /api/v1/biomarkers
  API-->>C: 200 { data: [ { id } ] }
  C->>API: DELETE /api/v1/biomarkers/:id (X-CSRF-Token)
  API-->>C: 200 deleted
```

> **Dev shortcut**: set `DISABLE_CSRF=true` in `backend/.env` to skip the CSRF header entirely (dev-only). The guard is gated on `config.isDevelopment` so it cannot be enabled in prod:
> ```ts
> // Source: backend/src/app.ts:214-217
> // Skip in development if DISABLE_CSRF=true for easier testing
> if (!config.isDevelopment || process.env.DISABLE_CSRF !== 'true') {
>   app.use(csrfProtection);
> }
> ```
> (Mirror guard in `backend/src/middleware/csrf.ts:159`.)

---

## 7. Test suites

Backend `test:unit` / `test:integration` / `test:rls` live **only** in `backend/package.json` — running them at the repo root yields "missing script".

| Suite | Command | cwd | Runner | Source |
|---|---|---|---|---|
| Frontend unit | `npm test` (`vitest run`) | repo root | Vitest | `package.json:12` |
| Frontend coverage | `npm run test:coverage` | repo root | Vitest | `package.json:14` |
| Frontend UI | `npm run test:ui` | repo root | Vitest | `package.json:15` |
| E2E | `npm run test:e2e` (seeds, then `playwright test`) | repo root | Playwright | `package.json:17` |
| Backend all | `npm test` (`vitest run`) | `backend/` | Vitest | `backend/package.json:11` |
| Backend unit | `npm run test:unit` (`vitest run src/__tests__/unit`) | `backend/` | Vitest | `backend/package.json:15` |
| Backend integration | `npm run test:integration` (`vitest run src/__tests__/integration`) | `backend/` | Vitest | `backend/package.json:16` |
| Backend RLS | `npm run test:rls` (`vitest run src/services/rls.test.ts`) | `backend/` | Vitest | `backend/package.json:17` |

```bash
# Frontend (repo root)
npm test                 # Vitest, ~seconds
npm run test:e2e         # seeds e2e user then Playwright (needs backend + DB up)

# Backend (cd backend first)
cd backend
npm test                 # all backend Vitest
npm run test:rls         # RLS regression (needs a Postgres reachable via DATABASE_URL)
```

The RLS suite needs a real Postgres — bootstrap a dedicated test DB with `backend/scripts/setup-rls-test-db.sh` (the only script in `backend/scripts/`). How to add new tests is in [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md).

---

## 8. Local mocking

External services are all skippable locally. The app boots without any of them (dev warns rather than hard-fails).

| Service | Skip locally? | Behavior when unset/disabled | Source |
|---|---|---|---|
| Anthropic Claude | yes | `ANTHROPIC_API_KEY` unset → boots; AI routes return data-less. With key set but `ANTHROPIC_BAA_ACTIVE != true`, dev **warns** at boot and the runtime gate blocks Claude calls (prod hard-fails). | `backend/src/config/index.ts:241,245`; gate `:381-394` |
| Google Document AI OCR | yes | `GCP_PROCESSOR_ID` set without `GOOGLE_BAA_ACTIVE=true` → dev warns; runtime gate blocks image OCR (prod hard-fails). | `backend/src/config/index.ts:236`; gate `:401-414` |
| SendGrid email | yes | No `SENDGRID_API_KEY` → `config.email.enabled=false`; emails are **logged, never sent** (verification URL via `devBox`). Or `SENDGRID_SANDBOX_MODE=true`. | `backend/src/config/index.ts:209`; `emailService.ts:313,376` |
| Redis (rate-limit store) | yes | `REDIS_URL` unset → in-memory `MemoryStore` fallback. | `backend/src/middleware/rateLimitStore.ts:41,77`; `config/index.ts:186` |
| **File storage** | **not needed at all** | `STORAGE_BACKEND` defaults to `local` in development (OF-23): uploads are AES-256-GCM-sealed to `backend/.local-storage`, so upload/download/delete work end-to-end with **no GCP**. Set `STORAGE_BACKEND=gcs` only if you specifically want to exercise the bucket path. Requires `PHI_ENCRYPTION_KEY` — without it the app still boots and only storage calls fail, with a pointed message. | `backend/src/config/index.ts:251-256`; `services/storage/localBackend.ts:44-55`; dispatch `storageService.ts:33-44` |
| Quest SMART-on-FHIR | yes | Unset creds → "Connect Quest" returns 503. Point `QUEST_FHIR_BASE_URL` at the **dev mock server** `http://localhost:3001/api/v1/mock-fhir/r4`. | `backend/.env.example:289`; mock mounted `app.ts:275-281` |

### Email verification without SendGrid

When SendGrid is unavailable, dev always logs the verification URL to the backend console:

```ts
// Source: backend/src/services/emailService.ts:374-381
// Always log in development for debugging
if (config.isDevelopment) {
  logger.devBox('EMAIL VERIFICATION', [
    `To: ${email}`,
    `Verification URL: ${verificationUrl}`,
    'Token expires in 24 hours',
  ]);
}
```

Copy the printed `/verify-email?token=…` token and GET `http://localhost:3001/api/v1/auth/verify-email?token=<TOKEN>` (`backend/src/routes/authRoutes.ts:62-66`). Or skip the gate by seeding (`backend/scripts/e2e-db.ts` (`npm run test:e2e:setup`) sets `emailVerified: true`).

### Quest FHIR / lab-connection without real Quest credentials

The dev-only mock FHIR server is mounted automatically when `config.isDevelopment`:

```ts
// Source: backend/src/app.ts:275-281
if (config.isDevelopment) {
  // Lazy import so production builds don't carry the mock data.
  import('./services/fhir/mockFhirServer.js').then(({ mountMockFhirServer }) => {
    mountMockFhirServer(app);
  });
}
```

Set `QUEST_FHIR_BASE_URL=http://localhost:3001/api/v1/mock-fhir/r4` in `backend/.env` (`backend/.env.example:289`) to exercise the lab-connection flow against the mock.

### AI spend circuit breaker (post-2026-06-01)

When testing AI features locally, a `503 SERVICE_UNAVAILABLE` on an AI route can be a **budget hit, not a bug**. Two per-UTC-day budgets feed the `aiSpendGuard` middleware:

| Var | Default | Source |
|---|---|---|
| `AI_DAILY_BUDGET_USD` | `50` (global/day across all users) | `backend/src/config/index.ts:256` |
| `AI_USER_DAILY_BUDGET_USD` | `5` (per-user/day) | `backend/src/config/index.ts:257` |

`aiSpendGuard` mounts on 8 points across 5 route files and fails closed with a 503 when the budget is exceeded. A NaN/negative value warns and falls back to the default (breaker stays ON) — it does not crash boot.

### Cross-origin cookies (post-2026-06-01)

If the SPA and API run on different hosts/ports, `COOKIE_SAME_SITE` and `COOKIE_DOMAIN` (M7) change local cookie behavior (`backend/src/config/index.ts:147-148`). `OMH_DEPLOY_ENFORCE_PROD` (RT-H1) is baked into the prod image only (`backend/Dockerfile:54`) and is never set by local `npm run dev`.

---

## 9. Reset procedures

```bash
# Nuke the local DB and reapply all 34 migrations from scratch
cd backend
npx prisma migrate reset --force
```

`prisma migrate reset` drops + recreates the schema and replays migrations; combined with regenerating secrets it gives a clean slate.

| To reset… | Do this |
|---|---|
| Local DB / schema | `cd backend && npx prisma migrate reset --force` |
| Sessions (force re-login) | Restart backend; or delete cookie jar (`rm cookies.txt`) and re-login. Server-side: `POST /api/v1/auth/logout-all` (`backend/src/routes/authRoutes.ts:117`). |
| A wedged `.env` | Re-copy `cp backend/.env.example backend/.env` and regenerate the 4 secrets ([§3](#3-environment-setup)). |
| Prisma client out of sync | `cd backend && npx prisma generate`. |

---

## 10. Common failures + fixes

| Symptom | Likely cause | Fix | Source |
|---|---|---|---|
| `PrismaClientInitializationError: Can't reach database server` | Postgres not running / wrong port / wrong password | `docker ps`; check `DATABASE_URL` (port 5432) | `database.ts:58` |
| `Missing required environment variable: JWT_ACCESS_SECRET` (or REFRESH) | secret missing/empty — `requireEnv` hard-fails at boot | `openssl rand -base64 32` → `backend/.env` | `config/index.ts:120,124` |
| `PHI_ENCRYPTION_KEY must be at least 64 hex characters` | key missing / wrong format | `openssl rand -hex 32` | `config/index.ts:439-443` |
| `AUDIT_LOG_SALT must be set and at least 16 characters` | salt missing | `openssl rand -hex 32` | `config/index.ts:358-367` |
| `JWT_ACCESS_SECRET is set to a known-weak placeholder value` | using a blocklisted value | generate a real secret | `config/index.ts:315-328` |
| `Refusing to start — add FORCE ROW LEVEL SECURITY` | RLS migrations not applied | `npx prisma migrate deploy` | `database.ts:303-305` |
| `ECONNREFUSED 127.0.0.1:3001` from frontend | backend not started | start backend first | `app.ts:351` |
| `401` on every request | `JWT_ACCESS_SECRET` differs between token issuance and verification (e.g. edited `.env` mid-session) | restart backend after changing `.env`; re-login | `config/index.ts:120` |
| `403` CSRF mismatch | not sending `X-CSRF-Token` matching the `csrf_token` cookie | re-read the cookie after login; or `DISABLE_CSRF=true` in dev | `app.ts:214-217`, `csrf.ts:159` |
| `503` on an AI route | AI spend budget hit, not a bug | raise `AI_*_BUDGET_USD` or wait for UTC-day rollover | `config/index.ts:256-257` |
| Vite port `:5173` in use | port conflict | `npm run dev -- --port 5174` | `package.json:7` |
| `npm install` fails on Windows ARM64 + Node 24 | native binary incompat | use Node 22 or apply the SWC patch | [`CLAUDE.md`](../CLAUDE.md) |

A broader failure catalog is in [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

---

## 11. IDE setup

Recommended VS Code extensions:

- `Prisma.prisma` — schema syntax + format for `backend/prisma/schema.prisma`.
- `dbaeumer.vscode-eslint` — ESLint (root `package.json:10` `"lint": "eslint ."`; backend `backend/package.json:10`).
- `esbenp.prettier-vscode` — formatting (if a `.vscode/` workspace config is present).

Pre-commit hygiene is enforced by `husky` + `lint-staged` (`package.json:20,68-76`): staged `src/**/*.{ts,tsx}` run `eslint --fix --max-warnings=0`, and staged `backend/src/**/*.ts` additionally run `tsc --noEmit`. Format-on-save (Prettier) is recommended to match.

---

## Acceptance questions (self-answered from this doc)

**Q1. What Node version is required, and why (cite Dockerfile)?** → Node 22.x. `backend/Dockerfile:15` pins `node:22-alpine`; Prisma 7 requires `^22.12` (`backend/Dockerfile:13`); `engines` = `^20.19 || ^22.12 || >=24` (`backend/package.json:77`). [§1](#1-prerequisites)

**Q2. What command provisions the local database?** → `createdb ownmyhealth_dev` (or Docker / `npx prisma dev`), then `npx prisma generate` + `npx prisma migrate deploy` from `backend/`. [§4](#4-database-provisioning)

**Q3. Which env vars must be set manually before the backend will boot?** → `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AUDIT_LOG_SALT` (every env), plus `DATABASE_URL`; `PHI_ENCRYPTION_KEY` is format-required (hard-fail in prod/staging). [§3](#3-environment-setup)

**Q4. How do you generate a valid `PHI_ENCRYPTION_KEY`?** → `openssl rand -hex 32` (64 hex chars / 256 bits). [§3](#3-environment-setup)

**Q5. Default backend / frontend port?** → Backend 3001 (`config/index.ts:100`); frontend 5173 (Vite). [§5](#5-run)

**Q6. Smoke-test sequence for auth + biomarker CRUD?** → register → verify-email → login (capture cookies + CSRF) → POST biomarker → GET list → DELETE by id. [§6](#6-golden-path-smoke-test)

**Q7. Which runner runs backend / frontend / E2E tests?** → Vitest (both, different cwd), Playwright (E2E). [§7](#7-test-suites)

**Q8. How do you reset a broken local database?** → `cd backend && npx prisma migrate reset --force`. [§9](#9-reset-procedures)

**Q9. Most common reason the frontend returns 401 on every call?** → `JWT_ACCESS_SECRET` changed between token issuance and verification — restart backend + re-login. [§10](#10-common-failures--fixes)

**Q10. Is a real `ANTHROPIC_API_KEY` required, and what does `ANTHROPIC_BAA_ACTIVE` do in dev?** → Not required; app boots without it. With a key set but `ANTHROPIC_BAA_ACTIVE != true`, dev **warns** and the runtime gate blocks Claude calls (prod hard-fails). [§8](#8-local-mocking)

**Q11. How do you trigger email verification locally without SendGrid?** → The verification URL is logged via `logger.devBox('EMAIL VERIFICATION', …)` (`emailService.ts:376`); GET `…/auth/verify-email?token=<TOKEN>`, or seed an already-verified user. [§8](#8-local-mocking)

**Q12. What port does Postgres default to in the dev `DATABASE_URL`?** → 5432. [§3](#3-environment-setup)

**Q13. Is `REDIS_URL` required locally, and what happens to rate limiting when unset?** → Not required; unset → in-memory `MemoryStore` fallback (`rateLimitStore.ts:41,77`). [§8](#8-local-mocking)

**Q14. How do you exercise the Quest FHIR / lab-connection flow without real Quest credentials?** → Point `QUEST_FHIR_BASE_URL` at the dev mock server `http://localhost:3001/api/v1/mock-fhir/r4` (auto-mounted in dev, `app.ts:275-281`). [§8](#8-local-mocking)

---

## Related Documents

- [ENV_VARS.md](./ENV_VARS.md) — full env-var reference (every var, consumer, secret classification).
- [ARCHITECTURE.md](./ARCHITECTURE.md) — what's running when `npm run dev` starts; middleware + startup flow.
- [DATA_MODEL.md](./DATA_MODEL.md) — the 19-model schema Prisma migrates + RLS policies.
- [API_REFERENCE.md](./API_REFERENCE.md) — per-endpoint contracts for the routes the smoke test hits.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — broader failure catalog beyond the local-dev table.
- [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) — how to add tests once setup works.

## Prompt drift log


> **These entries are a historical record of the 2026-06-16 generation run (HEAD `fb2cd32`), not a description of the current repo.** They were written to log where the *generating prompt* disagreed with the code at that time. Several cite counts that have since moved — as of the 2026-08-01 refresh the live figures are **34 migrations**, **66 backend / 33 frontend / 6 e2e tests**, **75 `.tsx` across 15 dirs**, **19 API modules**, **5 workflows**. Where an entry below conflicts with the body of this document, **the body is current and this log is not**. The prompt-side corrections were applied in `prompts/_drift-audit-2026-08-01.md`.

- `prompts/36-local-dev-setup-doc.md:42,250` and the "Files to review" table say **32** migrations; accurate at HEAD `fb2cd32`, now **34** (`20260620_add_registration_consent`, `20260712_add_sessions_update_policy`) (`Glob backend/prisma/migrations/*/` → 32 dirs, newest `20260615_provider_consent_immutable_audit_insert_check`). No drift.
- `prompts/36-local-dev-setup-doc.md:41` says **19 models** (with `RevokedAccessToken` + `LabConnection`); confirmed — `backend/prisma/schema.prisma` defines 19 models (`RevokedAccessToken` at `:96`, `LabConnection` at `:755`). The ground-truth `fact-digest.md` FACT[db-schema] block initially counted "17" then self-corrects to **18** for one omission and is itself stale on the canonical **19** — trusting the canonical number per the run instructions and the schema. Prompt author should reconcile `fact-digest.md` FACT[db-schema] to 19.
- `prompts/36-local-dev-setup-doc.md:77` recommends Postgres "16.x … or 15.x"; confirmed against `.github/workflows/ci.yml:165` (`image: postgres:16`). The commented-out block at `ci.yml:227` references `postgres:15` (disabled). No drift; documented 16 as primary.
- `CLAUDE.md` "Development Commands" still lists `npx prisma migrate dev` and omits the 32-migration / migrate-as-Cloud-Run-job split; the live Dockerfile (`backend/Dockerfile:86-93`) and deploy workflow (`.github/workflows/deploy.yml:43,158`) are authoritative. `CLAUDE.md` also predates the post-2026-06-01 env vars (`AI_DAILY_BUDGET_USD`, `COOKIE_SAME_SITE`, `OMH_DEPLOY_ENFORCE_PROD`). Documented from code per the "trust the code" rule.
