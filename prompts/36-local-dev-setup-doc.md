---
tags:
  - documentation
  - onboarding
  - local-dev
  - reference
type: prompt
priority: 2
updated: 2026-04-24
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
| `backend/.env.example`, `.env.example` | Required env vars for local dev. |
| `backend/src/config/index.ts` | Which vars boot with defaults vs throw. |
| `backend/src/index.ts` | Startup assertions — local-dev failure modes. |
| `backend/prisma/schema.prisma` | DB to provision. |
| `backend/prisma/migrations/` | Number of migrations to run. |
| `backend/scripts/*` | Seed scripts, schema checks, data loaders. |
| `e2e/setup/*` | Test-user seeding (e.g., `seed-test-user.ts`) — useful for smoke test. |
| `backend/Dockerfile` | Node version confirmation (Alpine). |
| `vite.config.ts` | Dev server port + chunking. |
| `CLAUDE.md` | Dev commands section. |

---

## Required sections

1. **Prerequisites** — Node version (from Dockerfile / engines), Postgres version, npm version, optional `gcloud` for GCS features.
2. **Clone + install** — exact commands, root + workspace install.
3. **Environment setup** — copying `.env.example` files, generating local secrets (`openssl rand -hex 32` for `PHI_ENCRYPTION_KEY` / `JWT_SECRET` / etc.), Postgres connection string.
4. **Database provisioning** — create DB, run migrations (`npx prisma migrate deploy` or `migrate dev`), generate Prisma client, optional seed script.
5. **Run** — start backend (`npm run dev` in `backend/`), start frontend (`npm run dev` at root), how to verify each is up.
6. **Golden-path smoke test** — a copy-paste sequence of `curl` calls (or a script) that: registers a test user, verifies email (dev bypass? flag?), logs in, creates a biomarker, lists it, deletes it. End-to-end proof.
7. **Test suites** — how to run unit tests, integration tests, e2e. Expected runtimes.
8. **Local mocking** — which external services can be skipped locally (Anthropic key optional? SendGrid noop mode?).
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
| Node.js | >= 18 (matches `backend/Dockerfile`) | `nvm install 20` |
| npm | latest | bundled with Node |
| PostgreSQL | 15.x | Docker: `docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:15` |
| gcloud (optional) | latest | for GCS-backed file features |

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

# Generate required secrets (commit-safe only for local)
openssl rand -hex 32  # → JWT_SECRET
openssl rand -hex 32  # → JWT_REFRESH_SECRET
openssl rand -hex 32  # → PHI_ENCRYPTION_KEY
openssl rand -hex 32  # → CSRF_SECRET
# Paste each into backend/.env

# 5. Database
createdb ownmyhealth_dev
# or: docker exec pg psql -U postgres -c 'CREATE DATABASE ownmyhealth_dev;'

# Edit backend/.env:
# DATABASE_URL="postgresql://postgres:dev@localhost:5432/ownmyhealth_dev"

cd backend
npx prisma generate
npx prisma migrate deploy
cd ..

# 6. Start dev
(cd backend && npm run dev) &   # backend on :3001
npm run dev                      # frontend on :5173
```

### Smoke test (copy-paste to verify end-to-end)

```bash
# Register
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.local","password":"SmokePass123!"}'

# Login (capture cookies)
curl -c cookies.txt -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.local","password":"SmokePass123!"}'

# Extract CSRF token from cookies.txt and set header
CSRF=$(awk '/csrfToken/ {print $7}' cookies.txt)

# Create biomarker
curl -b cookies.txt -X POST http://localhost:3001/api/v1/biomarkers \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"name":"LDL","value":120,"unit":"mg/dL","measuredAt":"2026-04-24T10:00:00Z"}'

# List biomarkers
curl -b cookies.txt http://localhost:3001/api/v1/biomarkers
```

### Common failures table

| Symptom | Likely cause | Fix |
|---|---|---|
| `PrismaClientInitializationError: Can't reach database server` | Postgres not running / wrong port / wrong password | `docker ps` / check `DATABASE_URL` |
| `Error: PHI_ENCRYPTION_KEY is required` | env var missing / too short | generate with `openssl rand -hex 32` |
| `ECONNREFUSED 127.0.0.1:3001` from frontend | Backend not started | start backend first |
| `401` on every request | `JWT_SECRET` differs between token issuance and verification | restart backend after changing `.env` |
| `403 CSRF mismatch` | not sending `X-CSRF-Token` matching cookie | re-read cookie after login |
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
10. Is a real `ANTHROPIC_API_KEY` required to run the app locally, or can AI features be skipped?
11. How do you trigger email verification locally without a real SendGrid key?
12. What port does Postgres default to in the dev `DATABASE_URL`?

---

## No-TBD enforcement

Before marking anything TBD:

- **Node version**: `backend/Dockerfile` `FROM` line; `package.json` `engines` field.
- **Postgres version**: check Cloud SQL version in `railway.toml`, `deploy.yml`, or infer from Prisma's minimum supported.
- **Seed scripts**: `Glob "backend/scripts/seed*.{ts,mjs}"`; read whatever exists. If none, state so explicitly.
- **Email verification local bypass**: `Grep pattern: "NODE_ENV"` in `emailService.ts`, `authService.ts`, `authController.ts`.
- **Anthropic key optional**: `Grep pattern: "ANTHROPIC_API_KEY"` — if the config marks it optional or a service no-ops on missing key, document that. Otherwise state "required for AI features".

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
| Find seed scripts | Glob | `pattern: "backend/scripts/seed*"` |
| Find dev-only bypasses | Grep | `pattern: "NODE_ENV"` over `backend/src/**` |

---

## Output: file and location

Write the final document to `New Project Documents/LOCAL_DEV.md`.
