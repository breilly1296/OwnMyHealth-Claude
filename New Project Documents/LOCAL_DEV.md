# LOCAL_DEV.md — Zero-to-Running Setup Guide

> Zero-to-login in under 20 minutes. Every command is copy-paste; every env var name matches what `backend/src/config/index.ts` actually reads.

**Target reader**: a developer (or Claude agent) with a stock machine and the prereqs installed, following this doc top-to-bottom. If anything below fails verbatim, the doc is wrong — file a drift note under **Prompt drift log** at the end.

**Last verified**: 2026-04-24 against `main` branch.

---

## 1. Prerequisites

| Prereq | Version | Why | Install hint |
|---|---|---|---|
| Node.js | **20.x** LTS | `backend/Dockerfile:4,24` pins `node:20-alpine`. `backend/package.json:68-70` `engines.node >= 18.0.0` is the floor, but 20 matches the production image. Node 24 on Windows ARM64 is known-broken for native SWC (see Common failures). | `nvm install 20 && nvm use 20` |
| npm | Bundled with Node 20 (>= 10.x) | Workspaces + `optionalDependencies` resolution | Comes with Node |
| PostgreSQL | **14+** (README.md:229, `schema.prisma:7` provider `postgresql`). Production runs Cloud SQL Postgres 15 — target 15 locally for parity. | Backing store for Prisma + RLS policies | `docker run -d --name omh-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:15` |
| `openssl` | Any recent (1.1+) | Secret generation (`openssl rand -hex 32` / `-base64 32`) | Usually pre-installed; on Windows use Git-for-Windows or WSL |
| `gcloud` CLI | Latest (optional) | Only needed if you want the GCS-backed file-upload flow locally. The server degrades gracefully without it — lab-report upload will error, but biomarker CRUD + auth work. | https://cloud.google.com/sdk/docs/install |
| Anthropic API key | n/a (optional) | Only required to exercise AI features (biomarker guidance, SBC extraction). Not required for auth + biomarker CRUD. | https://console.anthropic.com/ |
| SendGrid key | n/a (optional) | Only required to deliver real email. Without it, email bodies are printed to the backend console (see §8). | https://sendgrid.com/ |

---

## 2. Clone and install

```bash
# 1. Clone
git clone https://github.com/breilly1296/OwnMyHealth.git
cd OwnMyHealth

# 2. Install root (frontend) — Vite, React, Playwright, Vitest
npm install

# 3. Install backend
cd backend
npm install
cd ..
```

**Note**: The root `package.json:66` pins `rollup` to `@rollup/wasm-node` via `overrides`, so OneDrive-synced repos don't hit native `.node` binary corruption. Do not add `rollup` directly.

---

## 3. Environment setup

### 3.1 Copy the example files

```bash
cp backend/.env.example backend/.env
cp .env.example .env
```

### 3.2 Generate local secrets

The backend refuses to boot without these (`backend/src/config/index.ts:18-28` `requireEnv` + `:195-238` validators):

| Env var | Generate with | Validator |
|---|---|---|
| `JWT_ACCESS_SECRET` | `openssl rand -base64 32` | Required via `requireEnv` (`config/index.ts:61`); min 32 chars (`:208-215`); rejects known placeholders (`:186-200`) |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 32` | Required via `requireEnv` (`config/index.ts:65`); same min-length + placeholder checks |
| `PHI_ENCRYPTION_KEY` | `openssl rand -hex 32` | Must be **exactly 64 hex chars**, rejects placeholder keys (`config/index.ts:280-308`, enforced hard in prod/staging; dev validation lives in `backend/src/services/encryption.ts`) |
| `AUDIT_LOG_SALT` | `openssl rand -hex 32` | Min 16 chars (`config/index.ts:228-238`). For a fresh DB this is safe to generate; for a DB that already has audit logs, extracting the historic salt is required (see `config/index.ts:50-53`). |

Paste each into `backend/.env`:

```bash
# backend/.env
NODE_ENV=development
PORT=3001
DATABASE_URL="postgresql://postgres:dev@localhost:5432/ownmyhealth_dev"

JWT_ACCESS_SECRET=<paste openssl rand -base64 32>
JWT_ACCESS_EXPIRES_SECONDS=900

JWT_REFRESH_SECRET=<paste a DIFFERENT openssl rand -base64 32>
JWT_REFRESH_EXPIRES_SECONDS=604800

PHI_ENCRYPTION_KEY=<paste openssl rand -hex 32>
AUDIT_LOG_SALT=<paste openssl rand -hex 32>

# Optional: lets you exercise CSRF-protected routes from curl without headers.
# NEVER set in production — the app reads this only when NODE_ENV=development
# (backend/src/app.ts:211).
# DISABLE_CSRF=true
```

> **`CSRF_SECRET` is NOT read by the config.** The CSRF middleware uses random per-session tokens (`backend/src/middleware/csrf.ts:24-26`), not a shared secret. Ignore `CSRF_SECRET` references in older docs.

### 3.3 Frontend env

The root `.env` only needs the backend base URL:

```bash
# .env (repo root)
VITE_API_URL=http://localhost:3001
```

---

## 4. Database provisioning

### 4.1 Create the database

```bash
# Option A: Local Postgres (brew / apt install)
createdb ownmyhealth_dev

# Option B: Docker one-liner
docker run -d --name omh-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:15
docker exec omh-pg psql -U postgres -c 'CREATE DATABASE ownmyhealth_dev;'

# Option C: Prisma Postgres dev server (bundled, zero-config Postgres)
# Starts a managed local Postgres on port 51213 (see backend/.env.example:28-30)
cd backend && npx prisma dev &
# Then use the printed prisma+postgres:// URL as DATABASE_URL instead.
```

### 4.2 Generate client + run migrations

```bash
cd backend
npx prisma generate          # outputs generated/prisma/ per schema.prisma:3
npx prisma migrate deploy    # applies 16 migrations from backend/prisma/migrations/
cd ..
```

**Migration count**: 16 migrations as of 2026-04-24 — from `00000000000000_initial_schema` through `20260420_encrypt_health_goal_target`. Full list in `backend/prisma/migrations/`.

> Use `migrate deploy` (not `migrate dev`) unless you are creating a new migration. `deploy` is the same command the Dockerfile runs at container start (`backend/Dockerfile:51`).

### 4.3 Seed (optional)

There is **no app-data seed script**. The only seed in-repo is the E2E test user:

```bash
# Creates / refreshes e2e-test@ownmyhealth.io with password E2ETestPass123!
# emailVerified=true, plan=PRO, onboardingCompletedAt=now.
# Source: e2e/setup/seed-test-user.ts
npx tsx e2e/setup/seed-test-user.ts
```

This is what `npm run test:e2e:setup` calls (root `package.json:16`). For ad-hoc dev, use the smoke test in §6 to create your own user.

---

## 5. Run dev servers

```bash
# Terminal 1 — Backend on :3001
cd backend
npm run dev              # → `tsx watch src/app.ts` (backend/package.json:7)

# Terminal 2 — Frontend on :5173
npm run dev              # → `vite` (package.json:7)
```

### 5.1 Expected backend banner

The backend prints an ASCII banner when it's ready (`backend/src/app.ts:335-352`):

```
╔═══════════════════════════════════════════════════════╗
║   🏥  OwnMyHealth API Server                          ║
║   Environment: development                            ║
║   Port:        3001                                   ║
║   API:         /api/v1                                ║
║   Database:    Connected                              ║
╚═══════════════════════════════════════════════════════╝
```

### 5.2 Quick health checks

```bash
curl http://localhost:3001/health
# → {"status":"healthy","timestamp":"...","checks":{"database":"connected"}}

curl http://localhost:5173
# → HTML shell from Vite
```

---

## 6. Golden-path smoke test

End-to-end proof that auth + biomarker CRUD + PHI encryption all work. Copy-paste as-is (bash / WSL / Git Bash).

```bash
# 0. Fetch CSRF token (also sets the csrf_token cookie in cookies.txt)
#    Source: backend/src/middleware/csrf.ts:17 (cookie name = "csrf_token")
#            backend/src/app.ts:258 (route = /api/v1/csrf-token)
curl -c cookies.txt -b cookies.txt \
  http://localhost:3001/api/v1/csrf-token
CSRF=$(awk '$6=="csrf_token" {print $7}' cookies.txt)
echo "CSRF=$CSRF"

# 1. Register (password must satisfy strongPassword:
#    12+ chars, upper, lower, digit, special — validation.ts:117-123)
curl -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -X POST http://localhost:3001/api/v1/auth/register \
  -d '{"email":"smoke@test.local","password":"SmokePass123!xyz","firstName":"Smoke","lastName":"Test"}'

# 2. Verify email locally
#    In development, SendGrid is typically unconfigured, so the verification
#    URL is printed to the backend console instead of emailed
#    (backend/src/services/emailService.ts:276-283).
#    Copy the URL from the backend log and hit it:
curl -b cookies.txt -c cookies.txt \
  "http://localhost:3001/api/v1/auth/verify-email?token=<PASTE_TOKEN_FROM_BACKEND_LOG>"

# 3. Login (issues access + refresh cookies)
curl -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -X POST http://localhost:3001/api/v1/auth/login \
  -d '{"email":"smoke@test.local","password":"SmokePass123!xyz"}'

# 4. Refresh the CSRF token var — login rotated the cookie
CSRF=$(awk '$6=="csrf_token" {print $7}' cookies.txt)

# 5. Create a biomarker
#    Payload shape comes from schemas.biomarker.create (validation.ts:287-304):
#    name, value, unit, category, date, normalRange.{min,max,source?}, ...
curl -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -X POST http://localhost:3001/api/v1/biomarkers \
  -d '{"name":"LDL Cholesterol","value":120,"unit":"mg/dL","category":"Lipids","date":"2026-04-24","normalRange":{"min":0,"max":100,"source":"AHA 2024"}}'
# → 201 + {success:true, data:{id:"<uuid>", name:"LDL Cholesterol", ...}}

# 6. List biomarkers
curl -b cookies.txt http://localhost:3001/api/v1/biomarkers
# → {success:true, data:{items:[{...}], ...}}

# 7. Logout
curl -b cookies.txt -c cookies.txt \
  -H "x-csrf-token: $CSRF" \
  -X POST http://localhost:3001/api/v1/auth/logout
```

If steps 1–6 all return `success:true`, your environment works end-to-end: auth, CSRF, JWT cookie issuance, RLS context injection, AES-256-GCM encrypt/decrypt round-trip, and audit logging are all exercised.

### 6.1 Faster alternative: use the E2E seed user

```bash
npx tsx e2e/setup/seed-test-user.ts
# Pre-verified user: e2e-test@ownmyhealth.io / E2ETestPass123!
# plan=PRO, onboarding complete — skip straight to login.
```

---

## 7. Test suites

All three runners come from the package files; no extra install needed after `npm install`.

| Suite | Runner | Command | Config | Notes |
|---|---|---|---|---|
| Frontend unit | Vitest | `npm run test` (root) | `vitest.config.ts` | Watches `src/__tests__/**`; jsdom env |
| Frontend coverage | Vitest + v8 | `npm run test:coverage` | `vitest.config.ts:20-28` | HTML coverage in `coverage/` |
| Backend unit | **Vitest** (NOT Jest — `backend/package.json:11`) | `cd backend && npm run test:unit` | `backend/vitest.config.ts` | Seeds secrets via `backend/src/testSetup.ts:12` so config boots |
| Backend integration | Vitest | `cd backend && npm run test:integration` | same | Requires `DATABASE_URL` to a test DB |
| Backend all | Vitest | `cd backend && npm run test` | same | Runs unit + integration |
| E2E | Playwright | `npm run test:e2e` | `playwright.config.ts` | Auto-starts backend + frontend via `webServer:` (`playwright.config.ts:50-64`); single worker (DB state shared) |
| E2E install | Playwright | `npm run test:e2e:install` | — | Installs chromium (one-time) |
| E2E UI mode | Playwright | `npm run test:e2e:ui` | — | Interactive runner |

> **CLAUDE.md drift**: the project doc says backend tests use Jest. The actual runner is Vitest — see `backend/package.json:11` (`"test": "vitest run"`). Correct command is `npm run test`, not `jest`.

---

## 8. Local mocking (which external services can be skipped)

| Service | Skippable locally? | How | Source |
|---|---|---|---|
| **SendGrid** (email) | Yes. Default state. | If `SENDGRID_API_KEY` is unset, `config.email.enabled === false` and every `sendEmail()` call prints a `devBox` log to the backend console and returns `{success:true}`. The verification URL is also logged separately so you can click/curl it. | `config/index.ts:123-124` (`email.enabled = !!SENDGRID_API_KEY`); `emailService.ts:217-223` (devBox fallback); `emailService.ts:276-283` (verification URL logged) |
| **Anthropic Claude** (AI features) | Yes, with caveat. AI features (biomarker guidance, SBC extraction, cost analysis) are **disabled** locally by default. Auth + CRUD are unaffected. | AI endpoints call `getAnthropicClient()` which throws if `ANTHROPIC_API_KEY` is unset (`claudeExtraction.ts:53-56`). Even with a key, a C-7 runtime gate throws unless `ANTHROPIC_BAA_ACTIVE=true` (`claudeExtraction.ts:118-123`, `sbcExtraction.ts:781`). To exercise AI locally: set BOTH `ANTHROPIC_API_KEY` and `ANTHROPIC_BAA_ACTIVE=true` in `backend/.env`. | `claudeExtraction.ts:118`, `sbcExtraction.ts:781`, `config/index.ts:245-258` |
| **Google Cloud Storage** (file uploads) | Partly. Auth + biomarker flows don't touch GCS. Uploading lab reports will 500 without `GCP_PROJECT_ID` + `GOOGLE_APPLICATION_CREDENTIALS`. | No in-repo mock — the service talks to GCS directly. | `config/index.ts:137-142` |
| **Google Document AI** (OCR) | Yes by default (scanned-PDF flow is opt-in). Without creds, OCR path in `ocrService.ts` falls back / errors. | Env vars are `GCP_PROCESSOR_ID` and `GCP_LOCATION` (NOT the `GOOGLE_DOCUMENT_AI_*` names in older docs). | `backend/src/services/ocrService.ts`; cross-ref [`ENV_VARS.md`](./ENV_VARS.md) |
| **Quest SMART-on-FHIR** | Yes. Feature disables itself if `QUEST_FHIR_CLIENT_ID` is empty (`config/index.ts:158-169`). A mock FHIR server is mounted in dev: set `QUEST_FHIR_BASE_URL=http://localhost:3001/api/v1/mock-fhir/r4`. | `backend/src/app.ts:249-255` (mounts `mockFhirServer` when `isDevelopment`); `backend/.env.example:197-210` | |

### 8.1 Dev-only bypasses (grep `NODE_ENV` over `backend/src`)

| Bypass | Trigger | Source |
|---|---|---|
| Verification URL printed to backend console (no SendGrid needed) | `config.isDevelopment === true` | `backend/src/services/emailService.ts:276-283` |
| Password-reset URL printed to backend console | `config.isDevelopment === true` | `backend/src/services/emailService.ts:299-305` |
| CSRF protection can be turned off for curl-style testing | `NODE_ENV !== 'production'` **and** `DISABLE_CSRF=true` | `backend/src/app.ts:211-213` |
| Mock FHIR server mounted at `/api/v1/mock-fhir/r4` | `config.isDevelopment === true` | `backend/src/app.ts:249-255` |
| Demo login (`POST /api/v1/auth/demo`) bypasses failed-login tracking | `config.isDevelopment === true && config.demo.enabled === true` | `backend/src/services/authService.ts:689-692` |
| Prisma query logging (noisy) | `NODE_ENV === 'development'` | `backend/src/services/database.ts:122-124` |

> **There is no "skip email verification" flag.** Unverified users cannot log in (`authService.ts:766-772`). Local options: (1) copy the verification URL from the backend log and hit it, or (2) use the seeded E2E user (`e2e/setup/seed-test-user.ts`) which sets `emailVerified:true` directly in the DB.

---

## 9. Reset procedures

### 9.1 Nuke and reapply the DB

```bash
cd backend
npx prisma migrate reset --force
# Drops, recreates, re-runs all 16 migrations. Deletes ALL local data.
```

### 9.2 Clear sessions (keep data)

```bash
# Sessions live in the `sessions` table (schema.prisma:59-73). Truncating
# forces every logged-in user to re-authenticate.
psql "$DATABASE_URL" -c 'TRUNCATE sessions;'
```

### 9.3 Kill stuck Node processes (Windows)

```bash
# When `npm run dev` leaves a ghost on :3001 or :5173
taskkill //F //IM node.exe   # Git Bash on Windows
# or: Stop-Process -Name node -Force  (PowerShell)
```

### 9.4 Rebuild generated Prisma client after schema edits

```bash
cd backend
npx prisma generate
# Then re-run `npm run dev` to pick up the new types.
```

---

## 10. Common failures + fixes

| Symptom | Likely cause | Fix | Source |
|---|---|---|---|
| `Error: Missing required environment variable: JWT_ACCESS_SECRET` at startup | Secret not set or empty | `openssl rand -base64 32` → paste into `backend/.env` | `config/index.ts:18-28` |
| `JWT_ACCESS_SECRET is set to a known-weak placeholder value` | Copied `.env.example` literal | Generate a real one with `openssl rand -base64 32` | `config/index.ts:186-200` |
| `AUDIT_LOG_SALT must be set and at least 16 characters` | Not set, or set to a short string | `openssl rand -hex 32` | `config/index.ts:228-238` |
| `PHI_ENCRYPTION_KEY must be at least 64 hex characters` | Used 32 hex chars or base64 | Must be **hex**, exactly 64 chars: `openssl rand -hex 32` | `config/index.ts:283-287`, `.env.example:78` |
| `PrismaClientInitializationError: Can't reach database server at localhost:5432` | Postgres not running / wrong credentials | `docker ps`; verify `DATABASE_URL` host/port/password | — |
| `npm install` fails on Windows ARM64 + Node 24 with "not a valid Win32 application" | Native SWC binaries are incompatible with Node 24 on win32-arm64 (Next.js ecosystem issue; same pattern hits Vite's rollup) | Use Node 20 (`nvm install 20 && nvm use 20`). The repo already pins `rollup` to `@rollup/wasm-node` via `package.json:65-67` to avoid native rollup corruption on OneDrive. Do NOT add rollup directly. | User memory `next-swc-arm64.md`; `package.json:65-67` |
| `OneDrive corrupts node_modules .node binaries` | File sync munges native binaries | Use WASM fallbacks where possible; `package.json:65-67` already forces rollup-wasm. For stubborn cases, move the repo off OneDrive (`git clone` into `C:\Users\breil\code\` instead). | User memory `OneDrive + node_modules` |
| `CORS policy: Origin http://localhost:5173 not allowed` | Custom `CORS_ORIGIN` set and doesn't include the Vite port | Unset `CORS_ORIGIN` in dev (the default array includes 5173-5176, 3000 — `config/index.ts:98-104`) or add your port | `config/index.ts:98-104`, `app.ts:78-106` |
| `403 CSRF validation failed` on mutations | Missing / stale `x-csrf-token` header or cookie mismatch | GET `/api/v1/csrf-token` first to seed the cookie, then send `x-csrf-token: <value>` on every POST/PUT/PATCH/DELETE. For pure-curl iteration, set `DISABLE_CSRF=true` in dev. | `backend/src/middleware/csrf.ts:17-18`; `app.ts:211-213` |
| `401` on every request after changing `.env` | JWT secrets rotated — old cookies no longer verify | Clear cookies (`rm cookies.txt`) and log in again | `config/index.ts:61,65` |
| Frontend returns 401 on every API call | Backend not started, or `VITE_API_URL` mismatch, or cookies blocked cross-origin | Start backend; verify `.env` has `VITE_API_URL=http://localhost:3001`; check browser devtools → Application → Cookies shows `csrf_token`, `accessToken`, `refreshToken` | `.env.example:15` |
| Vite port 5173 already in use | Another Vite or stray node | `vite --port 5174`, or `taskkill //F //IM node.exe` | — |
| `Email not verified` on login | Registration sent a verification email but no SendGrid key → email only logged to backend console | Copy the URL from the backend log (look for the `EMAIL VERIFICATION` devBox) and curl/click it; OR use the E2E seed user | `emailService.ts:276-283`; `authService.ts:766-772` |
| `ANTHROPIC_API_KEY environment variable is not set` when clicking AI-guidance | AI features require both key + BAA flag | Set `ANTHROPIC_API_KEY=<key>` **and** `ANTHROPIC_BAA_ACTIVE=true` in `backend/.env`. Or avoid the AI endpoint. | `claudeExtraction.ts:53-56, 118-123` |
| `Claude extraction is disabled: ANTHROPIC_BAA_ACTIVE is not set` | Key is set but BAA flag isn't | Set `ANTHROPIC_BAA_ACTIVE=true` (local dev only — this flag is a legal assertion) | `claudeExtraction.ts:118-123`; `config/index.ts:245-258` |
| `CSRF_SECRET` has no effect | Variable is not read by the backend | Delete it from your `.env` — CSRF uses random per-session tokens | `middleware/csrf.ts:24-26` (no env-var lookup) |

See [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) for the broader failure catalog.

---

## 11. IDE setup (VS Code)

Recommended extensions:

| Extension | ID | Why |
|---|---|---|
| Prisma | `Prisma.prisma` | Syntax + formatting for `schema.prisma`; click-through on `@relation` |
| ESLint | `dbaeumer.vscode-eslint` | Repo has flat config at `eslint.config.js` + `backend/eslint.config.js` |
| Prettier | `esbenp.prettier-vscode` | No repo-local Prettier config, but husky/lint-staged run ESLint `--fix` pre-commit (`package.json:68-76`) |
| Tailwind CSS IntelliSense | `bradlc.vscode-tailwindcss` | The frontend is Tailwind-heavy |

Workspace settings: none are committed in `.vscode/`. Format-on-save is developer choice.

### 11.1 Pre-commit hook

Husky is configured (`package.json:20`, `"prepare": "husky"`) and runs `lint-staged` on commit. Staged `src/**/*.ts(x)` files run ESLint `--fix --max-warnings=0`; backend files additionally run `tsc --noEmit` (`package.json:68-76`). If a commit fails with ESLint errors, fix and re-stage — never `--no-verify`.

---

## 12. Architecture quick-reference

What `npm run dev` actually starts (abbreviated):

```
┌────────────────────────────┐        ┌────────────────────────────────────────┐
│  Frontend (Vite)           │        │  Backend (tsx watch src/app.ts)        │
│  port 5173                 │        │  port 3001                             │
│  VITE_API_URL=…:3001       │◄──────►│  /api/v1/* (60+ endpoints)             │
│  package.json:7            │        │  /health, /, /api/v1/csrf-token        │
└────────────────────────────┘        │  backend/src/app.ts                    │
                                      └─────────────┬──────────────────────────┘
                                                    │
                                                    │ Prisma (pg pool, PrismaPg adapter)
                                                    │ backend/src/services/database.ts
                                                    ▼
                                      ┌────────────────────────────────────────┐
                                      │  PostgreSQL 14+/15 (local or Docker)   │
                                      │  ownmyhealth_dev                       │
                                      │  + Row-Level Security policies         │
                                      │  (migration 20260107_add_rls_policies) │
                                      └────────────────────────────────────────┘
```

Schedulers the backend starts on boot (`app.ts:315-323`): session cleanup, audit log retention cleanup (7-year HIPAA window), engagement email scheduler. These run on timers and will log activity even on an idle dev instance.

For the full system diagram, request/middleware pipeline, and RLS context flow, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Acceptance questions (self-answered)

**Q1. What Node version is required, and why?**
Node 20.x LTS. `backend/Dockerfile:4` and `:24` both pin `node:20-alpine` for the production image; `backend/package.json:68-70` declares `engines.node >= 18.0.0` as the floor. Local parity with production ⇒ 20. (See §1.)

**Q2. What command provisions the local database?**
`createdb ownmyhealth_dev` (local Postgres) or the Docker one-liner in §4.1, then `cd backend && npx prisma generate && npx prisma migrate deploy`. 16 migrations are applied.

**Q3. Which env vars must be set manually before the backend will boot?**
`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PHI_ENCRYPTION_KEY`, `AUDIT_LOG_SALT`. All enforced at module load by `backend/src/config/index.ts`. (See §3.2.)

**Q4. How do you generate a valid `PHI_ENCRYPTION_KEY` for local use?**
`openssl rand -hex 32` → produces exactly 64 hex chars (256 bits). Anything shorter or non-hex is rejected at startup (`config/index.ts:283-294`). (See §3.2.)

**Q5. What's the default backend port? Frontend port?**
Backend `3001` (`.env.example:22`, `config/index.ts:41`). Frontend `5173` (Vite default; `vite.config.ts` has no override). (See §5.)

**Q6. What's the smoke-test sequence to verify auth + biomarker CRUD end-to-end?**
GET `/api/v1/csrf-token` → register → verify-email (URL from backend console log) → login → POST `/api/v1/biomarkers` → GET `/api/v1/biomarkers`. Full copy-paste curl sequence in §6.

**Q7. Which test runner runs backend tests? Frontend? E2E?**
Frontend: Vitest (`package.json:12`). Backend: Vitest (`backend/package.json:11` — NOT Jest, contrary to CLAUDE.md). E2E: Playwright (`package.json:17`, `playwright.config.ts`). (See §7.)

**Q8. How do you reset a broken local database?**
`cd backend && npx prisma migrate reset --force`. Drops, recreates, re-runs all 16 migrations. (See §9.1.)

**Q9. What's the most common reason the frontend returns 401 on every call?**
Either (a) backend not running, (b) `VITE_API_URL` points to the wrong host/port, or (c) JWT secrets changed in `.env` so existing cookies no longer verify — clear `cookies.txt` / browser cookies and log in again. (See §10.)

**Q10. Is a real `ANTHROPIC_API_KEY` required to run the app locally, or can AI features be skipped?**
AI features can be skipped — auth and biomarker CRUD work fine without a key. The AI endpoints themselves refuse to run without BOTH `ANTHROPIC_API_KEY` set AND `ANTHROPIC_BAA_ACTIVE=true` (C-7 runtime gate in `claudeExtraction.ts:118-123`). So to *exercise* AI locally, you need both vars; to *develop without touching AI*, you need neither. (See §8.)

**Q11. How do you trigger email verification locally without a real SendGrid key?**
Leave `SENDGRID_API_KEY` unset. `config.email.enabled` becomes false (`config/index.ts:124`) and `emailService.ts:276-283` / `:217-223` print the verification URL (and email body) to the backend console inside a `devBox`. Copy the URL and hit it with curl or a browser. (See §6 step 2 and §8.1.)

**Q12. What port does Postgres default to in the dev `DATABASE_URL`?**
`5432` — the Postgres default (see the example URL in §3.2: `postgresql://postgres:dev@localhost:5432/ownmyhealth_dev`). If you use Prisma's bundled dev server (`npx prisma dev`), it listens on `51213` instead (`backend/.env.example:30`).

---

## Related Documents

- [`ENV_VARS.md`](./ENV_VARS.md) — full env-var reference: required vs optional, consumers, secret classification, prod vs dev.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system overview, middleware stack, RLS context flow.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — Prisma models (15+), encrypted fields, cascade behavior, migration list.
- [`API_REFERENCE.md`](./API_REFERENCE.md) — per-endpoint contracts for the routes the smoke test exercises.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — broader failure catalog beyond the local-dev table in §10.
- [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) — how to write unit / integration / e2e tests once setup works.

---

## Prompt drift log

- `prompts/36-local-dev-setup-doc.md` lists `backend/src/index.ts` as the entry point; the actual entry is `backend/src/app.ts` (see `backend/package.json:6` `main: "dist/app.js"` and `:7` `dev: "tsx watch src/app.ts"`). The prompt's own note at the top of this task already flags this. Author should update the prompt's "Files to review" table.
- The prompt's sample env-setup block lists `JWT_SECRET` / `JWT_REFRESH_SECRET` / `CSRF_SECRET`. The actual config reads `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and does not read `CSRF_SECRET` at all (`config/index.ts:61,65`; `middleware/csrf.ts` uses random per-session tokens). Documented here; prompt author should update.
- CLAUDE.md "Tech Stack" line says **Testing: Vitest (frontend), Jest (backend)**. Backend actually uses Vitest (`backend/package.json:11`, `backend/vitest.config.ts`). CLAUDE.md should be updated.
- CLAUDE.md "Environment Variables" block lists `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` and `GOOGLE_DOCUMENT_AI_LOCATION`. The actual code reads `GCP_PROCESSOR_ID` / `GCP_LOCATION` (cross-ref `ENV_VARS.md`). Documented here per §8.
- The prompt's "Files to review" includes `backend/scripts/*`. That directory does not exist — the only seed in-repo is `e2e/setup/seed-test-user.ts`. The scripts that DO exist live at the repo root (`scripts/`) and are unrelated (HealthcareProviderDB loader scripts). Stated explicitly in §4.3.
- The prompt's sample smoke test uses field `measuredAt`. The actual `schemas.biomarker.create` field is `date` (`backend/src/middleware/validation.ts:293`). Smoke test in §6 uses the correct field.
