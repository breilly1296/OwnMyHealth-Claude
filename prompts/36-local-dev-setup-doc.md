---
tags:
  - documentation
  - onboarding
  - local-dev
  - reference
type: prompt
priority: 2
updated: 2026-06-01
---

# Generate LOCAL_DEV.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/LOCAL_DEV.md` — the **zero-to-running setup guide** for a developer (or Claude agent) new to the repo. Every command must run verbatim on a stock machine with the prereqs installed. A reader should go from `git clone` to a working login in under 20 minutes.

---

## Files to review

| File | Why read it |
|---|---|
| `README.md` | High-level orientation (cross-check any existing setup steps). |
| `package.json` (root) | Scripts: `dev`, `build`, `test`, `test:unit`, `test:e2e`, `lint`. |
| `backend/package.json` | Backend scripts: `dev`, `build`, `test`, Prisma scripts. |
| `backend/.env.example`, `.env.example` | Required env vars for local dev. (Frontend `.env.example` only needs `VITE_API_URL`.) |
| `backend/src/config/index.ts` | Which vars boot with defaults vs throw (`requireEnv` for JWT secrets; hard-fail validation for `AUDIT_LOG_SALT`, `PHI_ENCRYPTION_KEY`). |
| `backend/src/app.ts` | Backend entry point + startup assertions — local-dev failure modes. (There is no `src/index.ts`; dev script is `tsx watch src/app.ts`.) |
| `backend/prisma/schema.prisma` | DB to provision (18 models). |
| `backend/prisma/migrations/` | Number of migrations to run (22 as of 2026-06-01). |
| `e2e/setup/seed-test-user.ts` | Test-user seeding (idempotent; sets `emailVerified`, `plan: PRO`, `onboardingCompletedAt`) — useful for smoke test. No `backend/scripts/seed*` exists. |
| `backend/scripts/setup-rls-test-db.sh` | RLS test-DB bootstrap (only script in `backend/scripts/`). |
| `backend/Dockerfile` | Node version confirmation (`node:20-alpine`). |
| `vite.config.ts` | Dev server port + chunking. |
| `CLAUDE.md` | Dev commands section. |

---

## Required sections

1. **Prerequisites** — Node version (from Dockerfile / engines), Postgres version, npm version, optional `gcloud` for GCS features.
2. **Clone + install** — exact commands, root + workspace install.
3. **Environment setup** — copying `.env.example` files, generating local secrets. Note the differing generators: JWT secrets use `openssl rand -base64 32` (min 32 chars, no fallback — `requireEnv` crashes at boot if missing); `PHI_ENCRYPTION_KEY` and `AUDIT_LOG_SALT` use `openssl rand -hex 32`. There is **no** `CSRF_SECRET` (CSRF is a stateless double-submit cookie). Postgres connection string.
4. **Database provisioning** — create DB (or run Prisma Postgres locally via `npx prisma dev` per `.env.example`), run migrations (`npx prisma migrate deploy` or `migrate dev` — 22 migrations), generate Prisma client, optional seed (`npx tsx e2e/setup/seed-test-user.ts`).
5. **Run** — start backend (`npm run dev` in `backend/`, runs `tsx watch src/app.ts`), start frontend (`npm run dev` at root), how to verify each is up.
6. **Golden-path smoke test** — a copy-paste sequence of `curl` calls (or a script) that: registers a test user, verifies email (in dev without a SendGrid key the verification URL is printed to the backend console via `logger.devBox('EMAIL VERIFICATION', ...)` — or set `DISABLE_CSRF=true` and seed `emailVerified: true`), logs in, creates a biomarker, lists it, deletes it. End-to-end proof.
7. **Test suites** — how to run unit tests (`npm run test:unit`), integration tests (`npm run test:integration`), RLS (`npm run test:rls`), and e2e (`npm run test:e2e`, which seeds first). Expected runtimes.
8. **Local mocking** — which external services can be skipped locally. Anthropic key optional (warns at boot; runtime gate blocks Claude calls unless `ANTHROPIC_BAA_ACTIVE=true`). SendGrid optional (no key → emails logged, never sent; or `SENDGRID_SANDBOX_MODE=true`). Redis optional (`REDIS_URL` unset → in-memory rate-limit store). Quest FHIR optional (point `QUEST_FHIR_BASE_URL` at the local mock `http://localhost:3001/api/v1/mock-fhir/r4`).
9. **Reset procedures** — wipe local DB, clear sessions, reset migrations.
10. **Common failures + fixes** — "if this fails, try that" table.
11. **IDE setup** — recommended extensions (ESLint, Prisma), Prettier/format-on-save if configured.
12. **Related Documents**.
13. **Prompt drift log**.

---

## Required artifacts

### Prereqs table

| Prereq | Version | Install hint |
|---|---|---|
| Node.js | 20 (`backend/Dockerfile` uses `node:20-alpine`; `engines` says `>=18`) | `nvm install 20` |
| npm | latest | bundled with Node |
| PostgreSQL | 15.x (or `npx prisma dev` for local Prisma Postgres) | Docker: `docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:15` |
| gcloud (optional) | latest | for GCS-backed file features + Document AI OCR |
| Redis (optional) | latest | only if testing the shared rate-limit store (`REDIS_URL`) |

### Step-by-step commands

```bash
# 1. Clone
git clone <repo-url> && cd OwnMyHealth

# 2. Install (root)
npm install

# 3. Install (backend)
cd backend && npm install && cd ..

# 4. Env setup
cp backend/.env.example backend/.env
cp .env.example .env

# Generate required secrets (commit-safe only for local).
# Backend refuses to boot if any of these are missing/weak (see config/index.ts).
openssl rand -base64 32  # → JWT_ACCESS_SECRET  (min 32 chars, no fallback)
openssl rand -base64 32  # → JWT_REFRESH_SECRET (min 32 chars, no fallback)
openssl rand -hex 32     # → PHI_ENCRYPTION_KEY (exactly 64 hex chars / 256 bits)
openssl rand -hex 32     # → AUDIT_LOG_SALT     (>=16 chars; hard-fail if unset)
# NOTE: there is NO CSRF_SECRET — CSRF uses a stateless double-submit cookie.
# Paste each into backend/.env

# 5. Database
createdb ownmyhealth_dev
# or: docker exec pg psql -U postgres -c 'CREATE DATABASE ownmyhealth_dev;'
# or (Prisma Postgres, per .env.example): cd backend && npx prisma dev

# Edit backend/.env:
# DATABASE_URL="postgresql://postgres:dev@localhost:5432/ownmyhealth_dev"

cd backend
npx prisma generate
npx prisma migrate deploy   # applies all 22 migrations
cd ..

# (optional) seed an already-verified PRO test user for smoke/e2e flows
npx tsx e2e/setup/seed-test-user.ts

# 6. Start dev
(cd backend && npm run dev) &   # backend on :3001 (tsx watch src/app.ts)
npm run dev                      # frontend on :5173
```

### Smoke test (copy-paste to verify end-to-end)

```bash
# Register (email + password required; firstName/lastName optional)
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.local","password":"SmokePass123!","firstName":"Smoke","lastName":"Test"}'

# Email verification gates login. With no SendGrid key the verification URL is
# printed to the backend console (logger.devBox 'EMAIL VERIFICATION'); GET it,
# OR seed an already-verified user with: npx tsx e2e/setup/seed-test-user.ts

# Login (capture cookies — sets csrf_token + auth cookies)
curl -c cookies.txt -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.local","password":"SmokePass123!"}'

# Extract CSRF token from the csrf_token cookie and set the header
CSRF=$(awk '/csrf_token/ {print $7}' cookies.txt)

# Create biomarker (schemas.biomarker.create requires name, value, unit,
# category, date, and a normalRange {min,max} — see middleware/validation.ts)
curl -b cookies.txt -X POST http://localhost:3001/api/v1/biomarkers \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"name":"LDL","value":120,"unit":"mg/dL","category":"Lipids","date":"2026-06-01T10:00:00Z","normalRange":{"min":0,"max":100}}'

# List biomarkers
curl -b cookies.txt http://localhost:3001/api/v1/biomarkers
```

### Common failures table

| Symptom | Likely cause | Fix |
|---|---|---|
| `PrismaClientInitializationError: Can't reach database server` | Postgres not running / wrong port / wrong password | `docker ps` / check `DATABASE_URL` |
| `Missing required environment variable: JWT_ACCESS_SECRET` (or REFRESH) | secret missing/empty — `requireEnv` hard-fails at boot | generate with `openssl rand -base64 32` |
| `PHI_ENCRYPTION_KEY must be at least 64 hex characters` | key missing / wrong format | generate with `openssl rand -hex 32` |
| `AUDIT_LOG_SALT must be set and at least 16 characters` | salt missing (new requirement) | generate with `openssl rand -hex 32` |
| `ECONNREFUSED 127.0.0.1:3001` from frontend | Backend not started | start backend first |
| `401` on every request | `JWT_ACCESS_SECRET` differs between token issuance and verification | restart backend after changing `.env` |
| `403 CSRF mismatch` | not sending `X-CSRF-Token` matching the `csrf_token` cookie | re-read cookie after login (or set `DISABLE_CSRF=true` in dev) |
| Next dev/vite port conflict | `:5173` in use | `vite --port 5174` |
| `npm install` fails on Windows ARM64 + Node 24 | Native binary incompat (see CLAUDE.md note) | use Node 20 or apply documented SWC patch |

### Reset procedures

```bash
# Nuke local DB and reapply migrations
cd backend
npx prisma migrate reset --force
```

### IDE setup

Recommended VS Code extensions: `Prisma.prisma`, `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`. Workspace settings if present in `.vscode/`.

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. What Node version is required, and why (cite Dockerfile)?
2. What command provisions the local database?
3. Which env vars must be set manually before the backend will boot?
4. How do you generate a valid `PHI_ENCRYPTION_KEY` for local use?
5. What's the default backend port? Frontend port?
6. What's the smoke-test sequence to verify auth + biomarker CRUD end-to-end?
7. Which test runner runs backend tests? Frontend? E2E?
8. How do you reset a broken local database?
9. What's the most common reason the frontend returns 401 on every call?
10. Is a real `ANTHROPIC_API_KEY` required to run the app locally, or can AI features be skipped (and what does `ANTHROPIC_BAA_ACTIVE` do in dev)?
11. How do you trigger email verification locally without a real SendGrid key?
12. What port does Postgres default to in the dev `DATABASE_URL`?
13. Is `REDIS_URL` required locally, and what happens to rate limiting when it's unset?
14. How do you exercise the Quest FHIR / lab-connection flow locally without real Quest credentials?

---

## No-TBD enforcement

Before marking anything TBD:

- **Node version**: `backend/Dockerfile` `FROM` line (`node:20-alpine`); `package.json` `engines` field (`>=18`).
- **Postgres version**: check Cloud SQL version in `.github/workflows/deploy.yml`, or infer from Prisma's minimum supported.
- **Seed scripts**: the only seed is `e2e/setup/seed-test-user.ts` (no `backend/scripts/seed*` exists — `backend/scripts/` holds only `setup-rls-test-db.sh`). State this explicitly.
- **Email verification local bypass**: `emailService.ts` — when SendGrid is unavailable the verification URL is logged via `logger.devBox('EMAIL VERIFICATION', ...)`. The e2e seed sets `emailVerified: true` to skip the gate entirely.
- **Anthropic key optional**: `Grep pattern: "ANTHROPIC_API_KEY"` in `config/index.ts` — it is optional (boot warns), but the runtime gate blocks Claude calls unless `ANTHROPIC_BAA_ACTIVE=true`. Document both.
- **Redis optional**: `Grep pattern: "REDIS_URL"` in `config/index.ts` / `middleware/rateLimitStore.ts` — unset falls back to in-memory rate-limit store; document the fallback.

If any of the above cannot be resolved from the repo, mark `TBD (external: ...)` with the specific file or owner to ask.

---

## Cross-links

The generated `LOCAL_DEV.md` must link to:

- [`ENV_VARS.md`](./ENV_VARS.md) — full env var reference.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — what's running when `npm run dev` starts.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — schema that Prisma migrates.
- [`API_REFERENCE.md`](./API_REFERENCE.md) — endpoints hit by the smoke test.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — broader failure catalog.
- [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) — how to add tests after setup works.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Read root scripts | Read | `package.json` |
| Read backend scripts | Read | `backend/package.json` |
| Read env examples | Read | `backend/.env.example`, `.env.example` |
| Read Dockerfile | Read | `backend/Dockerfile` |
| Confirm boot-time env validation | Read | `backend/src/config/index.ts` (`requireEnv`, salt/key/secret checks) |
| Find seed script | Glob | `pattern: "e2e/setup/seed-test-user.ts"` |
| Count migrations | Glob | `pattern: "backend/prisma/migrations/*/"` (22 dirs) |
| Find dev-only bypasses | Grep | `pattern: "DISABLE_CSRF|isDevelopment"` over `backend/src/**` |

---

## Output: file and location

Write the final document to `New Project Documents/LOCAL_DEV.md`.
