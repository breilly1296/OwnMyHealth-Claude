# LOCAL_DEV.md — Zero-to-Running Setup Guide

> **Goal:** go from `git clone` to a working login in under 20 minutes. Every command below runs verbatim on a stock machine (macOS/Linux/WSL/Git-Bash) with the prereqs installed.
> **Last verified against code:** 2026-06-01.
> **Repo layout:** npm-workspace-less two-package monorepo — the **frontend** lives at the repo root (`package.json` `name: ownmyhealth-frontend`), the **backend** lives in `backend/` (`backend/package.json` `name: ownmyhealth-backend`). They install and run independently.

This doc passes the five quality tests in [`_doc-quality.md`](./_doc-quality.md): every non-trivial claim cites `file:path:line`, snippets are real, flows are diagrammed, and commands run as written.

---

## 1. Prerequisites

| Prereq | Required version | Why / Source | Install hint |
|---|---|---|---|
| Node.js | **20** (LTS) | Both Dockerfile stages pin `FROM node:20-alpine` (`backend/Dockerfile:4`, `backend/Dockerfile:24`). `engines` only floors at `>=18.0.0` (`backend/package.json:73-75`), and Vitest targets `node18` (`backend/vitest.config.ts:39`), but **use 20** to match the build image. | `nvm install 20 && nvm use 20` |
| npm | bundled with Node 20 | — | comes with Node |
| PostgreSQL | **15 or 16** | CI runs `postgres:16` (`.github/workflows/ci.yml:147`); RLS test bootstrap runs `postgres:16` (`backend/scripts/setup-rls-test-db.sh:47`); README floor is `PostgreSQL 14+` (`README.md:229`, `README.md:249`). Any of 14/15/16 works locally. | Docker one-liner in §4 |
| `gcloud` SDK | latest (optional) | Only needed to exercise GCS file storage (`storageService.ts`) and Document AI OCR. Skippable locally — see §8. | [cloud.google.com/sdk](https://cloud.google.com/sdk) |
| Redis | latest (optional) | Only to test the **shared** rate-limit store. Unset `REDIS_URL` ⇒ in-memory store (`backend/src/middleware/rateLimitStore.ts:33`). See §8. | `docker run -d -p 6379:6379 redis:7` |
| Docker | latest (optional) | Easiest way to run Postgres locally; **required** for the RLS test DB (`backend/scripts/setup-rls-test-db.sh:34`). | [docker.com](https://docker.com) |

> **Windows ARM64 + Node 24 caveat:** native SWC/rollup binaries are incompatible. The frontend pins `rollup` to the WASM build via `overrides` (`package.json:65-67`). If `npm install` fails with "not a valid Win32 application", drop to Node 20. See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

---

## 2. Clone + Install

The frontend (root) and backend are **separate npm projects**. Install both.

```bash
# 1. Clone
git clone https://github.com/breilly1296/OwnMyHealth.git
cd OwnMyHealth

# 2. Install frontend deps (root) — also runs husky prepare hook
npm install

# 3. Install backend deps
cd backend && npm install && cd ..
```

- Root install script set: `dev`, `build`, `test`, `test:e2e`, `lint`, `preview` (`package.json:6-21`). `prepare: husky` (`package.json:20`) wires the pre-commit hook (`lint-staged` config at `package.json:68-76`).
- Backend install script set: `dev`, `build`, `start`, `test`, `test:unit`, `test:integration`, `test:rls`, `test:ci` (`backend/package.json:6-18`).

---

## 3. Environment Setup

Two `.env` files. The frontend needs only `VITE_API_URL`; the backend needs four secrets it **refuses to boot without**.

```bash
# Copy the example files
cp backend/.env.example backend/.env
cp .env.example .env
```

### 3.1 Frontend `.env`

Only one variable matters (`.env.example:15`):

```bash
# Source: .env.example:15
VITE_API_URL=http://localhost:3001
```

### 3.2 Backend `.env` — the four mandatory secrets

The backend validates secrets **at module load** in `backend/src/config/index.ts`. There are **no fallbacks** for JWT secrets, and weak/missing PHI key or audit salt also hard-fail. There is **no `CSRF_SECRET`** — CSRF is a stateless double-submit cookie (`backend/src/middleware/csrf.ts:4-5`).

| Env var | Generator | Rule (enforced at boot) | Source citation |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | `openssl rand -base64 32` | Required (no fallback); `>= 32` chars; not a blocked placeholder | `config/index.ts:61`, `:18-28`, `:241-270` |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 32` | Required (no fallback); `>= 32` chars; not a blocked placeholder | `config/index.ts:65`, `:271-277` |
| `PHI_ENCRYPTION_KEY` | `openssl rand -hex 32` | In prod/staging: exactly 64 hex chars, hex-only, not a placeholder | `config/index.ts:355-383` |
| `AUDIT_LOG_SALT` | `openssl rand -hex 32` | Required in **every** env; `>= 16` chars; rotating breaks past audit logs | `config/index.ts:283-293` |

Generate and paste them:

```bash
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 32)"   # paste into backend/.env
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 32)"  # paste into backend/.env
echo "PHI_ENCRYPTION_KEY=$(openssl rand -hex 32)"     # 64 hex chars / 256 bits
echo "AUDIT_LOG_SALT=$(openssl rand -hex 32)"
```

The `requireEnv` helper is what crashes the boot when a JWT secret is absent:

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

The audit-salt hard-fail (note the `>= 16` floor, not 64):

```ts
// Source: backend/src/config/index.ts:283-293
const MIN_AUDIT_SALT_LENGTH = 16;
if (!config.auditSalt || config.auditSalt.length < MIN_AUDIT_SALT_LENGTH) {
  throw new Error(
    `AUDIT_LOG_SALT must be set and at least ${MIN_AUDIT_SALT_LENGTH} characters. ` +
    `Historic audit logs are encrypted with this salt — rotating it breaks decryption. ` +
    `For new environments, generate with: openssl rand -hex 32. ` +
    ...
  );
}
```

> **Note:** the `.env.example` ships `PHI_ENCRYPTION_KEY=REPLACE_WITH_openssl_rand_hex_32` (`backend/.env.example:78`) and the same placeholder for `AUDIT_LOG_SALT` (`backend/.env.example:86`). These contain non-hex characters so "copied the example and forgot to edit" fails loudly rather than running insecure. You **must** replace them.

For the full env-var catalog (consumers, secret classification, optional vars), see [ENV_VARS.md](./ENV_VARS.md).

---

## 4. Database Provisioning

Two supported paths. Pick one.

### Path A — Local Postgres in Docker (recommended, matches CI's `postgres:16`)

```bash
# Start a Postgres 16 container
docker run -d --name omh-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16

# Create the dev database
docker exec omh-pg psql -U postgres -c 'CREATE DATABASE ownmyhealth_dev;'
```

Then set the connection string in `backend/.env`:

```bash
# Source: matches the format read by config/index.ts:5 (dotenv) and Prisma
DATABASE_URL="postgresql://postgres:dev@localhost:5432/ownmyhealth_dev"
```

Postgres defaults to port **5432** in this string (the container maps `-p 5432:5432`).

### Path B — Prisma Postgres (zero Docker)

The shipped `.env.example` default points at Prisma's local Postgres (`backend/.env.example:30`):

```bash
# Source: backend/.env.example:30
DATABASE_URL="prisma+postgres://localhost:51213/?api_key=YOUR_API_KEY"
```

Start it from `backend/` (per `backend/.env.example:28`):

```bash
cd backend && npx prisma dev
```

### 4.1 Generate client + run migrations (both paths)

```bash
cd backend
npx prisma generate          # emits client to backend/generated/ (see Dockerfile:19,41)
npx prisma migrate deploy    # applies all 22 migrations
cd ..
```

- **22 migration directories** exist as of 2026-06-01 (glob `backend/prisma/migrations/*/migration.sql`): from `00000000000000_initial_schema` through `20260601_add_email_change`. The Dockerfile runs the same `npx prisma migrate deploy` on container start (`backend/Dockerfile:51`).
- The schema defines **18 models** (grep `^model ` in `backend/prisma/schema.prisma`): `User`, `Session`, `UserEncryptionKey`, `ProviderPatient`, `UserFile`, `Biomarker`, `BiomarkerHistory`, `InsurancePlan`, `InsuranceBenefit`, `HealthNeed`, `HealthGoal`, `GoalProgressHistory`, `AuditLog`, `SystemConfig`, `ExpenseProjection`, `ExpenseActual`, `CostAnalysis`, `LabConnection`. See [DATA_MODEL.md](./DATA_MODEL.md).
- Migration `20260107_add_rls_policies` installs the PostgreSQL Row-Level Security policies. RLS is enforced by `withRLSContext` / `withRLSTransaction` in `backend/src/services/database.ts` (referenced from `biomarkerRoutes.ts:32`).

### 4.2 (Optional) Seed an already-verified PRO test user

The **only** seed script is `e2e/setup/seed-test-user.ts` — there is **no** `backend/scripts/seed*` (the only file in `backend/scripts/` is `setup-rls-test-db.sh`). It is idempotent and skips the email/onboarding/plan gates:

```bash
# Run from repo root; reads DATABASE_URL from backend/.env
npx tsx e2e/setup/seed-test-user.ts
```

```ts
// Source: e2e/setup/seed-test-user.ts:64-75
await prisma.user.create({
  data: {
    email: EMAIL,                    // 'e2e-test@ownmyhealth.io'  (line 29)
    passwordHash,                    // bcrypt of 'E2ETestPass123!' (line 30)
    role: 'PATIENT',
    isActive: true,
    emailVerified: true,             // skips the login email-gate
    plan: 'PRO',                     // unlimited rate-limits + features
    planUpdatedAt: new Date(),
    onboardingCompletedAt: new Date(),
  },
});
```

Seeded credentials: `e2e-test@ownmyhealth.io` / `E2ETestPass123!` (`e2e/setup/seed-test-user.ts:29-30`).

---

## 5. Run

Two processes. Start the backend first (the frontend proxies to it).

```bash
# Terminal 1 — backend on :3001  (tsx watch src/app.ts)
cd backend && npm run dev

# Terminal 2 — frontend on :5173 (vite)
npm run dev
```

| Process | Command | Script source | Port | Port source |
|---|---|---|---|---|
| Backend API | `npm run dev` (in `backend/`) → `tsx watch src/app.ts` | `backend/package.json:7` | **3001** | `config/index.ts:41` (`PORT \|\| '3001'`); listen at `app.ts:351` |
| Frontend SPA | `npm run dev` (root) → `vite` | `package.json:7` | **5173** | Vite default; CORS allows 5173 (`config/index.ts:106`) |

**Verify the backend is up** (no auth needed):

```bash
curl http://localhost:3001/health
# → {"status":"healthy","timestamp":"...","checks":{"database":"connected"}}
```

The `/health` handler checks the DB and returns 503 if disconnected (`backend/src/app.ts:301-312`). The root `/` returns API metadata (`app.ts:287-297`).

**Verify the frontend is up:** open `http://localhost:5173` in a browser — Vite prints the URL on start.

### What `npm run dev` boots (backend startup sequence)

```
startServer()  (app.ts:333)
   │
   ├─▶ initializeDatabase()          app.ts:336  (Prisma connect)
   ├─▶ initializeDemoUser()          app.ts:339  (non-prod only)
   ├─▶ startSessionCleanup()         app.ts:342
   ├─▶ startAuditCleanup(prisma)     app.ts:345  (24h interval unless AUDIT_CLEANUP_TOKEN set)
   ├─▶ startEmailScheduler()         app.ts:349
   └─▶ app.listen(config.port)       app.ts:351  ──▶ "🏥 OwnMyHealth API Server" banner (app.ts:361)
```

If a required secret is missing, the process **throws before `startServer` runs** — config validation happens at import time (`config/index.ts:38-440`). See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full middleware stack.

---

## 6. Golden-Path Smoke Test

Proves auth + biomarker CRUD end-to-end with `curl`. The flow: register → verify email → login → create biomarker → list → delete.

### 6.1 The flow

```mermaid
sequenceDiagram
  participant C as curl
  participant API as Express :3001
  participant DB as Postgres
  C->>API: POST /api/v1/auth/register {email,password}
  API->>DB: createUser (unverified) + verification token
  API-->>C: 201 {message} (generic, no tokens)
  Note over API: dev: verification URL printed via logger.devBox('EMAIL VERIFICATION')
  C->>API: GET /api/v1/auth/verify-email?token=...
  API-->>C: 200 {message:"Email verified..."}
  C->>API: POST /api/v1/auth/login {email,password}
  API-->>C: 200 + Set-Cookie: access, refresh, csrf_token
  C->>API: POST /api/v1/biomarkers (cookies + X-CSRF-Token)
  API->>DB: withRLSTransaction → biomarker.create
  API-->>C: 201 {biomarker}
  C->>API: GET /api/v1/biomarkers (cookies)
  API-->>C: 200 {data:[...]}
  C->>API: DELETE /api/v1/biomarkers/:id (cookies + X-CSRF-Token)
  API-->>C: 200
```

### 6.2 Copy-paste sequence (Bash)

```bash
BASE=http://localhost:3001/api/v1
EMAIL=smoke@test.local
# Password MUST be >= 12 chars + upper + lower + digit + special (authService.ts:208-228)
PASS='SmokePass123!'

# 1) Register (returns a generic message; NO tokens by design — authController.ts:230-248)
curl -s -X POST $BASE/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"

# 2) Verify email. With no SendGrid key, the verification URL is printed to the
#    BACKEND CONSOLE via logger.devBox('EMAIL VERIFICATION', ...) (emailService.ts:355).
#    The printed URL points at the FRONTEND (http://localhost:5173/verify-email?token=...
#    — emailService.ts:350). Copy just the token and hit the BACKEND endpoint:
TOKEN=<paste-token-from-backend-console>
curl -s "$BASE/auth/verify-email?token=$TOKEN"
#    → {"success":true,"data":{"message":"Email verified successfully. You can now log in."}}
#    (authController.ts:674-679)
#
#    SHORTCUT: skip steps 1-2 entirely by seeding a verified user:
#      npx tsx e2e/setup/seed-test-user.ts   (then EMAIL=e2e-test@ownmyhealth.io PASS='E2ETestPass123!')

# 3) Login — captures cookies (access, refresh, csrf_token) into cookies.txt
curl -s -c cookies.txt -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"

# 4) Extract the CSRF token from the csrf_token cookie (column 7 of the netscape cookie jar)
CSRF=$(awk '/csrf_token/ {print $7}' cookies.txt)

# 5) Create a biomarker — requires name,value,unit,category,date,normalRange{min,max}
#    (validation.ts:302-318). State-changing → needs X-CSRF-Token matching the cookie.
BIO=$(curl -s -b cookies.txt -X POST $BASE/biomarkers \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"name":"LDL","value":120,"unit":"mg/dL","category":"Lipids","date":"2026-06-01T10:00:00Z","normalRange":{"min":0,"max":100}}')
echo "$BIO"

# 6) List biomarkers (GET — no CSRF header needed; GET is exempt, csrf.ts:92)
curl -s -b cookies.txt $BASE/biomarkers

# 7) Delete the biomarker we just created (extract its id, then DELETE)
ID=$(echo "$BIO" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -s -b cookies.txt -X DELETE $BASE/biomarkers/$ID -H "X-CSRF-Token: $CSRF"
```

### 6.3 Why each step is shaped this way

- **Register returns no tokens** — by design, login is gated on email verification (`authController.ts:230-233`). The register response is byte-identical for new vs duplicate emails to prevent account enumeration (`authController.ts:241-248`).
- **Login is blocked until verified** — an unverified login returns **403 `EMAIL_NOT_VERIFIED`** (`authController.ts:274-289`). Verify first, or seed a verified user.
- **Biomarker create needs a `normalRange`** object with numeric `min`/`max`:

  ```ts
  // Source: backend/src/middleware/validation.ts:302-318
  create: z.object({
    name: sanitizedString(1, 100),
    value: finiteNumber.pipe(z.number().min(0, 'Value must be non-negative')),
    unit: sanitizedString(1, 20),
    category: sanitizedString(1, 50),
    date: dateString,
    normalRange: z.object({ min: finiteNumber, max: finiteNumber, source: optionalSanitizedString(100) }),
    notes: optionalSanitizedString(1000),
    ...
  }),
  ```
- **CSRF on mutations** — POST/PUT/PATCH/DELETE require `X-CSRF-Token` matching the `csrf_token` cookie; GET/HEAD/OPTIONS are exempt (`csrf.ts:92`). Login/register/verify-email are public and CSRF-exempt (`csrf.ts:98-108`). In dev you can disable CSRF entirely with `DISABLE_CSRF=true` (`csrf.ts:146-148`, `app.ts:215`).

Endpoints used: `POST /auth/register`, `GET /auth/verify-email`, `POST /auth/login`, `POST /biomarkers`, `GET /biomarkers`, `DELETE /biomarkers/:id` — full contracts in [API_REFERENCE.md](./API_REFERENCE.md). Route wiring: `authRoutes.ts:41-66`, `biomarkerRoutes.ts:50-110`.

---

## 7. Test Suites

| Suite | Command (in `backend/`) | What it runs | Script source |
|---|---|---|---|
| All backend | `npm test` | `vitest run` over `src/**/*.test.ts` | `backend/package.json:11`, `vitest.config.ts:12-15` |
| Unit (subset) | `npm run test:unit` | `vitest run src/__tests__/unit` | `backend/package.json:15` |
| Integration (subset) | `npm run test:integration` | `vitest run src/__tests__/integration` | `backend/package.json:16` |
| RLS | `npm run test:rls` | `vitest run src/services/rls.test.ts` | `backend/package.json:17` |
| CI config | `npm run test:ci` | `vitest run --config vitest.config.ci.ts` | `backend/package.json:14` |
| Frontend | `npm test` (root) | `vitest run` | `package.json:12` |
| E2E | `npm run test:e2e` (root) | seeds test user, then `playwright test` | `package.json:16-17` |

> **Drift warning (see Prompt drift log):** `test:unit` and `test:integration` point at `src/__tests__/unit` and `src/__tests__/integration`, which **do not exist** — all 34 backend test files are co-located as `src/**/*.test.ts` (e.g. `backend/src/services/encryption.test.ts`, `backend/src/middleware/csrf.test.ts`). Those two subset scripts currently match **zero** tests. Use `npm test` (in `backend/`) to actually run the backend suite.

**Backend tests need no live DB or `.env`** — `vitest.config.ts:11` loads `src/testSetup.ts`, which seeds dummy secrets only if unset:

```ts
// Source: backend/src/testSetup.ts:11-18
const testDefaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/test',
  JWT_ACCESS_SECRET: 'test-access-secret-' + 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'test-refresh-secret-' + 'b'.repeat(32),
  PHI_ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  AUDIT_LOG_SALT: 'test-audit-salt-' + 'c'.repeat(32),
};
```

**RLS tests need a NOBYPASSRLS role** (a superuser bypasses RLS, so policies wouldn't be exercised). Bootstrap with the only `backend/scripts/` helper (Docker required):

```bash
bash backend/scripts/setup-rls-test-db.sh          # starts postgres:16 on :5433, applies migrations + omh_app role
# then, from backend/:
DATABASE_URL=postgresql://omh_app:test@localhost:5433/omh \
PHI_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
npm run test:rls
bash backend/scripts/setup-rls-test-db.sh --down   # tear down
```

(Commands verbatim from `backend/scripts/setup-rls-test-db.sh:8-12`, `:71-77`.)

**E2E** seeds first (`test:e2e:setup` → `seed-test-user.ts`) then runs Playwright (`package.json:16-17`); install the browser once with `npm run test:e2e:install` (`package.json:19`). E2E needs the backend + frontend **running** and a live DB.

> Expected runtimes are not pinned in the repo; `testTimeout` is 30s per test (`vitest.config.ts:30`). For patterns on adding new tests, see [TESTING_PATTERNS.md](./TESTING_PATTERNS.md).

---

## 8. Local Mocking — What You Can Skip

The app degrades gracefully. None of these are required to log in and do biomarker CRUD.

| Service | Skip behavior | Source |
|---|---|---|
| **Anthropic (Claude)** | Key optional. Boot warns if unset (`config/index.ts:431-433`). Even **with** a key, runtime gate blocks every Claude call unless `ANTHROPIC_BAA_ACTIVE=true` (`config/index.ts:300-313`; route-level gate at `biomarkerRoutes.ts:137-151` → 503). | `config/index.ts:180-186`, `:300-313` |
| **SendGrid (email)** | Key optional. No key ⇒ `config.email.enabled=false` (`config/index.ts:149`); verification/reset URLs are **logged, never sent**, via `logger.devBox` (`emailService.ts:355`, `:377`). Or set `SENDGRID_SANDBOX_MODE=true` (validates, never delivers — `config/index.ts:157-158`). | `config/index.ts:147-159`, `emailService.ts:353-362` |
| **Redis (rate-limit store)** | `REDIS_URL` unset ⇒ in-memory MemoryStore (per-instance counters). `getRateLimitStore` returns `null` and express-rate-limit falls back. | `config/index.ts:125-127`, `rateLimitStore.ts:33` |
| **Quest FHIR (lab sync)** | Disabled unless `QUEST_FHIR_CLIENT_ID` set (`config/index.ts:206`); "Connect Quest" returns 503. For local end-to-end, point at the dev mock — see below. | `config/index.ts:200-224`, `.env.example:217-230` |
| **GCS / Document AI** | `GCP_PROJECT_ID` unset ⇒ storage + OCR unavailable (warn at `config/index.ts:437-438`). Document AI also gated by `GOOGLE_BAA_ACTIVE=true` (`config/index.ts:320-333`). | `config/index.ts:161-177` |

### ANTHROPIC_BAA_ACTIVE in dev

A real `ANTHROPIC_API_KEY` is **not required** to run the app. AI features are simply unavailable without one. If you *do* set a key in dev but leave `ANTHROPIC_BAA_ACTIVE=false` (the `.env.example` default, `.env.example:215`), boot **warns** (it does not throw — only production throws):

```ts
// Source: backend/src/config/index.ts:300-313
if (config.anthropic.apiKey && !config.anthropic.baaActive) {
  if (config.isProduction) {
    throw new Error('ANTHROPIC_BAA_ACTIVE must be set to "true" in production when ANTHROPIC_API_KEY is configured. ...');
  } else {
    process.stderr.write('⚠️  ANTHROPIC_BAA_ACTIVE is not set to "true". Claude calls will be blocked by the runtime gate. ...\n');
  }
}
```

To actually exercise Claude locally: set `ANTHROPIC_API_KEY` **and** `ANTHROPIC_BAA_ACTIVE=true`.

### Quest FHIR via the dev mock server

`app.ts:275-281` mounts a mock FHIR server **only in development**. Point Quest at it (per `.env.example:224` and `config/index.ts:202-204`):

```bash
# In backend/.env — exercises the SMART-on-FHIR flow without real Quest creds
QUEST_FHIR_CLIENT_ID=mock-client
QUEST_FHIR_CLIENT_SECRET=mock-secret
QUEST_FHIR_BASE_URL=http://localhost:3001/api/v1/mock-fhir/r4
```

The mock exposes `.well-known/smart-configuration`, `/authorize`, `/token`, `/Patient/:id`, `/Observation`, `/DiagnosticReport` (`backend/src/services/fhir/mockFhirServer.ts:102-177`), mounted at `/api/v1/mock-fhir` (`mockFhirServer.ts:200`). FHIR routes are wired at `routes/index.ts:107`.

---

## 9. Reset Procedures

```bash
# A) Nuke and rebuild the local DB (drops, recreates, replays all 22 migrations)
cd backend
npx prisma migrate reset --force
cd ..

# B) Clear all sessions (force re-login) — sessions are DB rows in the Session model
#    (schema.prisma:61). migrate reset (A) wipes them; or truncate just that table:
docker exec omh-pg psql -U postgres -d ownmyhealth_dev -c 'TRUNCATE "Session" CASCADE;'

# C) Re-seed the verified test user after a reset
npx tsx e2e/setup/seed-test-user.ts

# D) Tear down the Postgres container entirely
docker rm -f omh-pg
```

`prisma migrate reset` is the canonical "broken DB" fix — it drops the database, recreates it, and reapplies every migration in `backend/prisma/migrations/`. See [ERROR_RECOVERY.md](./ERROR_RECOVERY.md) for deeper recovery scenarios.

---

## 10. Common Failures + Fixes

| Symptom | Likely cause | Fix | Evidence |
|---|---|---|---|
| `Missing required environment variable: JWT_ACCESS_SECRET` (or REFRESH) | Secret empty/missing — `requireEnv` throws at import | `openssl rand -base64 32` → paste into `backend/.env`, restart | `config/index.ts:18-28`, `:61`, `:65` |
| `AUDIT_LOG_SALT must be set and at least 16 characters` | Salt missing or still the placeholder | `openssl rand -hex 32` → paste, restart | `config/index.ts:283-293` |
| `PHI_ENCRYPTION_KEY must be at least 64 hex characters` (prod/staging) | Key missing/short/non-hex | `openssl rand -hex 32` (exactly 64 hex) | `config/index.ts:355-369` |
| `JWT_ACCESS_SECRET is set to a known-weak placeholder value` | You pasted a blocked string (`secret`, `change-me`, …) | Generate a real random secret | `config/index.ts:241-255` |
| `Can't reach database server` / Prisma init error | Postgres not running / wrong port / wrong password | `docker ps`; check `DATABASE_URL` host:port:password | §4; `config/index.ts:5` |
| `/health` returns 503 `"database":"disconnected"` | DB down or migrations not run | start Postgres, `npx prisma migrate deploy` | `app.ts:301-312` |
| `403 EMAIL_NOT_VERIFIED` on login | Account never verified its email | hit `verify-email?token=...` from the dev console, or seed a verified user | `authController.ts:274-289` |
| `403 CSRF token missing` / `Invalid CSRF token` on a mutation | No `X-CSRF-Token`, or it doesn't match the `csrf_token` cookie | re-read the cookie after login; or set `DISABLE_CSRF=true` in dev | `csrf.ts:155-170`, `:146-148` |
| `401 Invalid email or password` on every protected call | Access cookie not sent, or secret changed between issue & verify | restart backend after editing `.env`; ensure `-b cookies.txt` | `config/index.ts:61`; auth at `authRoutes.ts:114` |
| CORS error from browser | Frontend origin not in allowlist | dev allows 5173-5176 + 3000 (`config/index.ts:105-111`); set `CORS_ORIGIN` if custom | `app.ts:79-107` |
| Vite port `:5173` in use | Another process owns the port | `npm run dev -- --port 5174` | `vite.config.ts` |
| `npm install` fails on Windows ARM64 + Node 24 | Native binary incompatibility | use Node 20; rollup already pinned to WASM (`package.json:65-67`) | §1 caveat |
| `npm run test:unit` runs 0 tests | Script path `src/__tests__/unit` does not exist | run `npm test` in `backend/` instead | §7 drift note |

A broader catalog lives in [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

---

## 11. IDE Setup

There is **no `.vscode/` directory** in the repo (glob `.vscode/*` → none), so no committed workspace settings. Recommended VS Code extensions:

| Extension | ID | Why |
|---|---|---|
| Prisma | `Prisma.prisma` | `schema.prisma` syntax, format, autocomplete |
| ESLint | `dbaeumer.vscode-eslint` | Lint config at root (`eslint` v9, `package.json:46`) + `backend/eslint.config.js` |
| Prettier | `esbenp.prettier-vscode` | No repo Prettier config found; formatting is enforced via ESLint `--fix` in the pre-commit hook |

**Pre-commit enforcement:** `husky` + `lint-staged` run on commit — frontend files get `eslint --fix --max-warnings=0`, backend files get the same plus `tsc --noEmit` (`package.json:68-76`). Format-on-save is optional but harmless; the hook is the source of truth.

---

## Acceptance Questions (self-answered from this doc)

1. **Node version & why?** Node **20** — both Dockerfile stages use `node:20-alpine` (`backend/Dockerfile:4`, `:24`). §1.
2. **Command to provision the local DB?** `docker run -d --name omh-pg ... postgres:16` + `CREATE DATABASE`, or `npx prisma dev` (Path B), then `npx prisma migrate deploy`. §4.
3. **Env vars that must be set manually before boot?** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PHI_ENCRYPTION_KEY`, `AUDIT_LOG_SALT` (+ `DATABASE_URL`). §3.2.
4. **Generate a valid `PHI_ENCRYPTION_KEY`?** `openssl rand -hex 32` (64 hex chars). §3.2.
5. **Default backend / frontend ports?** Backend **3001**, frontend **5173**. §5.
6. **Smoke-test sequence?** register → verify-email → login → create biomarker → list → delete. §6.
7. **Test runners?** Backend & frontend: Vitest (`vitest run`); E2E: Playwright. §7.
8. **Reset a broken DB?** `cd backend && npx prisma migrate reset --force`. §9.
9. **Most common reason for 401 on every call?** Access cookie not sent, or `JWT_ACCESS_SECRET` changed between token issue and verify (restart after editing `.env`). §10.
10. **Is a real `ANTHROPIC_API_KEY` required; what does `ANTHROPIC_BAA_ACTIVE` do in dev?** Not required (AI features just unavailable). In dev, key set + flag false ⇒ **warning** at boot and the runtime gate blocks Claude calls; set the flag `true` to enable. §8.
11. **Trigger email verification without SendGrid?** The verification URL is printed to the backend console via `logger.devBox('EMAIL VERIFICATION')`; copy the token and GET `/api/v1/auth/verify-email?token=...`. Or seed a verified user. §6.2, §8.
12. **Postgres port in the dev `DATABASE_URL`?** **5432** (Docker Path A). §4.
13. **Is `REDIS_URL` required; what happens when unset?** Not required — unset ⇒ in-memory MemoryStore (per-instance rate-limit counters). §8.
14. **Exercise Quest FHIR without real creds?** Set `QUEST_FHIR_BASE_URL=http://localhost:3001/api/v1/mock-fhir/r4` (+ any client id/secret); dev-only mock server handles the SMART flow. §8.

---

## Related Documents

- [ENV_VARS.md](./ENV_VARS.md) — full env-var reference: consumers, defaults, secret classification.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — what's running when `npm run dev` starts (middleware stack, RLS, schedulers).
- [DATA_MODEL.md](./DATA_MODEL.md) — the 18-model schema Prisma migrates, RLS policies, cascade behavior.
- [API_REFERENCE.md](./API_REFERENCE.md) — per-endpoint contracts for the routes the smoke test hits.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — broader failure catalog beyond the §10 table.
- [ERROR_RECOVERY.md](./ERROR_RECOVERY.md) — deeper DB/session recovery scenarios.
- [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) — how to add unit/integration/RLS tests after setup works.

---

## Prompt drift log

- **Migration count is 22 (prompt was right).** `./36-local-dev-setup-doc.md` (and `00-index.md` "Verified codebase counts") say "22 migrations as of 2026-06-01". The glob `backend/prisma/migrations/*/migration.sql` returns exactly **22** directories — from `00000000000000_initial_schema` through `20260601_add_email_change` (the latter matching the new `/auth/change-email` + `/auth/confirm-email-change` routes at `authRoutes.ts:96-133`). No drift: keep the count at 22 in both the prompt and `00-index.md`. (A QA pass corrected an earlier "23" miscount in this doc.)
- **`test:unit` / `test:integration` target non-existent directories.** The prompt's "Test suites" section tells readers to run `npm run test:unit` (`vitest run src/__tests__/unit`) and `npm run test:integration` (`vitest run src/__tests__/integration`). Neither `backend/src/__tests__/unit` nor `backend/src/__tests__/integration` exists — there is no `src/__tests__/` directory at all. All 34 backend test files are co-located as `src/**/*.test.ts` (e.g. `backend/src/services/encryption.test.ts`). Both subset scripts therefore match **zero** tests today; `npm test` (in `backend/`) is the working command. Prompt should either fix the scripts or document `npm test` as the canonical backend runner.
- **Password minimum is 12 chars, not 8.** `validatePasswordStrength` enforces `>= 12` characters plus upper/lower/digit/special (`backend/src/services/authService.ts:208-228`). The prompt's smoke-test password `SmokePass123!` (13 chars) passes, but any 8-11 char example would be rejected at registration. Documented the real rule in §6.2.
- **Postgres version reference.** The prompt's prereqs table says "PostgreSQL 15.x". CI and the RLS bootstrap both use **`postgres:16`** (`.github/workflows/ci.yml:147`, `backend/scripts/setup-rls-test-db.sh:47`), while README floors at 14+ (`README.md:229`). Documented the 14/15/16 range with citations rather than a single pinned 15.x. The production **Cloud SQL** Postgres version is not captured in any repo file — TBD (external: Cloud SQL instance version, GCP Console project for OwnMyHealth / `gcloud sql instances describe`).
- **Backend controller/route counts in CLAUDE.md are stale** (not load-bearing for this doc, noted for the refresh task): CLAUDE.md lists "10 controllers / 13 route files" and an `uploadController.ts`, but `routes/index.ts:21-36` mounts **16 route modules** and upload handlers live under `controllers/upload/` (`upload/shared.test.ts` exists). Out of scope here; flagged for ROUTING_TABLE.md / ARCHITECTURE.md authors.
