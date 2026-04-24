# KNOWN_ISSUES.md

**Generated**: 2026-04-24
**Scope**: open bugs, tech debt, deprecated surfaces, code markers, skipped tests, dependency vulnerabilities, and test-coverage gaps across the OwnMyHealth monorepo.

> This doc is the **bug and tech-debt ledger** — it is *not* the authoritative security register. Security findings (C-*, F-*) are **mirrored here with a pointer** to `SECURITY_STATUS.md`. Do not re-assess severity here; update `SECURITY_STATUS.md` and reflect back.

---

## Quick answers (TL;DR)

| Question | Answer | Anchor |
|---|---|---|
| Most urgent open issue | **C-8: RLS policies inert at runtime** — app runs as BYPASSRLS role in dev+prod. Defense-in-depth gap (controllers still filter by `userId`). | [Critical](#critical) |
| TODO / FIXME / HACK / XXX markers | **4 total** (3 backend, 1 frontend). No `FIXME`, `HACK`, or `XXX` — all `TODO`. | [Code-marker inventory](#code-marker-inventory) |
| Skipped / TODO tests | **0** `it.skip` / `it.todo`. One **conditional** `describe.skipIf(!hasLiveDb)` at `backend/src/services/rls.test.ts:29`. | [Skipped / TODO tests](#skipped--todo-tests) |
| `npm audit` — root | **2 moderate**, 0 high, 0 critical | [Dependency vulnerabilities](#dependency-vulnerabilities) |
| `npm audit` — backend | **9 moderate**, 2 low, 0 high, 0 critical | [Dependency vulnerabilities](#dependency-vulnerabilities) |
| Deprecated items flagged | **7** — DNA trio, 5 unused `RoleGuard` wrappers, 3 unused API modules, 2 `railway.toml` files, 1 stray `nul` file, `scratchpad.md.md` | [Deprecated](#deprecated-kept-for-compat) |
| Controllers with zero tests | `fileController.ts`, `fhirController.ts`, `aiChatController.ts`, `upload/labUploadController.ts`, `upload/sbcUploadController.ts` | [Missing test coverage](#missing-test-coverage) |

---

## Critical

Issues that block core functionality or PHI isolation. Severity mirrors `SECURITY_STATUS.md` — do not re-grade here.

### RLS policies inert at runtime (C-8)

- **Severity**: Critical
- **Symptom**: PostgreSQL RLS policies exist (`backend/prisma/migrations/20260107_add_rls_policies/`) and application code wraps queries in `withRLSContext` / `withRLSTransaction` (`backend/src/services/database.ts:L377-L465`), but the database role that the app connects as has the `BYPASSRLS` attribute in both dev and prod. `SET LOCAL app.current_user_id = ...` runs, policies evaluate — but the role bypasses them, so RLS does not enforce. Only the in-code `userId` filters in controllers and services actually protect tenant isolation.
- **Root cause**: During Cloud SQL bootstrap the app role was granted `BYPASSRLS`. A non-superuser NOBYPASSRLS role needs to be provisioned, granted table-level rights, and swapped into `DATABASE_URL`.
- **Workaround**: None at runtime. Treat every `withRLSContext(...)` call as advisory; continue to filter by `userId` in controllers. `rls.test.ts` auto-skips when the live-DB env is absent, and when present it runs against the same BYPASSRLS role — so regressions will not fail CI until the role cutover lands.
- **Fix plan**: 4-PR sequence tracked as C-8 Parts 1 / 2a / 2b-i / 2b-ii / 3 — see [`SECURITY_STATUS.md#c-8`](./SECURITY_STATUS.md) (doc pending — see prompt `./19-security-status-doc.md`) and `docs/c-8-part-c-runbook.md`. Parts 1, 2a, 2b-i, 2b-ii and the code-prep step (commit `4290520`) have landed; Part 3 (DB role cutover) is the remaining work.
- **Tracked in**: user memory `ownmyhealth-project.md` ("C-1/F-14/F-15 closed by PR #30 but runtime-role issue not fixed"); commit chain `9727492` (C-1) → `65f9ffb` (C-8 Part 1) → `a648eb8` (2a) → `4fa6460` (2b-i) → `74af20e` (2b-ii) → `4290520` (code prep).
- **Files**: `backend/src/services/database.ts:L14-L31`, `backend/src/services/database.ts:L377-L465`, `backend/prisma/migrations/20260107_add_rls_policies/migration.sql`, Cloud SQL role config (external to repo — resolve in GCP console).

---

## High

Significant feature gaps or security concerns that should be resolved before public beta. Security-severity items mirror [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

### Logger redaction gaps let PHI leak through structured logs

- **Severity**: High
- **Symptom**: `backend/src/utils/logger.ts:L21-L30` `SENSITIVE_FIELDS` redacts a subset of PHI keys, but several encrypted columns slip through because the sanitizer matches on exact (lowercased) key names. Known gaps per [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md):
  - `firstNameEncrypted`, `lastNameEncrypted` — **not redacted** (PHI_TAXONOMY §7, lines 132, 138).
  - `dateOfBirthEncrypted` — only `dateOfBirth` matches; the `Encrypted`-suffixed key slips through (PHI_TAXONOMY line 146).
  - `phoneEncrypted` / `phone` — only `phoneNumber` matches; other variants slip through (PHI_TAXONOMY line 154).
  - `healthProfileEncrypted` — JSON blob of conditions/medications/family history; **not redacted** (PHI_TAXONOMY line 182).
  - `notesEncrypted` — generic suffix not matched anywhere in `SENSITIVE_FIELDS` (PHI_TAXONOMY lines 223, 276).
  - `genotypeEncrypted`, `recommendationsEncrypted` — **not redacted** (PHI_TAXONOMY lines 288, 303).
- **Root cause**: redaction list was authored before the `*Encrypted`-suffix naming convention was standardized; the sanitizer does not strip the suffix before matching.
- **Workaround**: avoid logging whole Prisma rows in new code. Log `{ id, userId }` only, or destructure to a vetted projection.
- **Fix plan**: either (a) add every `*Encrypted` suffix variant to `SENSITIVE_FIELDS`, or (b) change the sanitizer to strip `Encrypted` suffix and `_encrypted` column-name suffix before matching. Track as F-series finding in `SECURITY_STATUS.md`.
- **Files**: `backend/src/utils/logger.ts:L21-L30`, `backend/src/utils/logger.ts:121` (log sink); full gap matrix in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) §7 Drift findings.

### Environment variable name drift — `GCP_PROCESSOR_ID` vs `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`

- **Severity**: High (startup throw if the wrong name is set)
- **Symptom**: [`ENV_VARS.md#drift-findings`](./ENV_VARS.md) documents that `CLAUDE.md:255-256` and prompt `35-env-vars-doc.md:103` advertise `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` / `GOOGLE_DOCUMENT_AI_LOCATION`, but the code reads `GCP_PROCESSOR_ID` / `GCP_LOCATION` (`backend/src/services/ocrService.ts:85, 115, 116, 452`). A correctly-provisioned env with the documented name still throws at runtime because the code never reads it.
- **Workaround**: set **both** names in Cloud Run env until code or docs are aligned; `.env.example` should be updated.
- **Fix plan**: choose canonical name, update the other site. Low-risk code change; higher-risk if any runbook references the old name.
- **Files**: `backend/src/services/ocrService.ts:L85-L87`, `CLAUDE.md:255-256`, [`ENV_VARS.md`](./ENV_VARS.md) lines 400-401.

### Duplicate route mount — `/insurance/upload-sbc` has no plan-limit gate

- **Severity**: High (feature security / billing correctness)
- **Symptom**: `POST /api/v1/insurance/upload-sbc` (`backend/src/routes/insuranceRoutes.ts:127`) and `POST /api/v1/upload/insurance-sbc` (`backend/src/routes/uploadRoutes.ts:94`) both resolve to `upload/sbcUploadController.uploadSBC` (per [`ROUTING_TABLE.md#duplicate-route-mounts`](./ROUTING_TABLE.md) lines 709-713). The `/upload/*` variant runs `requirePlanLimit('pdfUploadsPerMonth')`; the `/insurance/upload-sbc` variant does not. A client targeting the legacy path bypasses plan-tier uploads. Both paths are CSRF-exempt (`backend/src/middleware/csrf.ts:117-122`).
- **Workaround**: consumers (`src/components/insurance/SBCUpload.tsx`) should prefer `/api/v1/upload/insurance-sbc`. Audit API clients for legacy-path usage.
- **Fix plan**: either remove the `insuranceRoutes.ts:127` mount entirely, or add `requirePlanLimit('pdfUploadsPerMonth')` middleware to that route to reach parity.
- **Files**: `backend/src/routes/insuranceRoutes.ts:127`, `backend/src/routes/uploadRoutes.ts:94`, `backend/src/middleware/csrf.ts:117-122`, `backend/src/controllers/upload/sbcUploadController.ts:33`.

### `__mocks__/` dirs expected by prompts do not exist

- **Severity**: High (test architecture drift)
- **Symptom**: Prompt `38-testing-patterns-doc.md` expects `__mocks__/` directories for Anthropic / SendGrid / GCS / Document AI. Glob `**/__mocks__/**` returns no matches ([`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) line 955). Every mock is an inline `vi.mock(...)` factory, typically with `vi.hoisted(...)`. This is a drift between the prompt and the repo, not a bug — but any future test author following the prompt will create one-off mocks that diverge from the inline catalog.
- **Workaround**: follow the Mock catalog in `TESTING_PATTERNS.md` (line 953) rather than the prompt.
- **Fix plan**: update prompt OR extract canonical mock factories into `backend/src/__tests__/mocks/`.
- **Files**: `TESTING_PATTERNS.md` lines 953-988 (canonical inline-mock catalog).

---

## Medium

Usability issues and tech debt that should be addressed during beta. Non-security tech debt; does not mirror from `SECURITY_STATUS.md`.

### PBKDF2 iteration count is a global constant, not per-user

- **Severity**: Medium
- **Symptom**: `backend/src/services/encryption.ts:86-87` hardcodes `PBKDF2_ITERATIONS = 600_000` with a `PBKDF2_ITERATIONS_LEGACY = 100_000` fallback. If the auth tag fails to verify at the new count, the code retries at the legacy count. This means any future iteration bump requires the same dual-try scheme forever.
- **Root cause**: iteration count is not stored per-row or per-user — the deriver just knows the current global value. See the `TODO(key-rotation)` comment at `encryption.ts:81`.
- **Workaround**: none needed today; the scheme is secure. It is a migration-debt item.
- **Fix plan**: store iteration count on the `UserSalt` row (or per-ciphertext envelope), write a background re-encryption job, then remove the legacy fallback.
- **Files**: `backend/src/services/encryption.ts:L78-L87`, `backend/src/services/userEncryption.ts`.

### CSP allows `'unsafe-inline'` for styles

- **Severity**: Medium
- **Symptom**: `backend/src/app.ts:L125-L134` sets Helmet CSP with `styleSrc: ["'self'", "'unsafe-inline'"]`. Required today because Tailwind and third-party libraries inject runtime `<style>` tags. Leaves a stylesheet-injection XSS vector open — limited in scope (style, not script) but not defense-in-depth ideal.
- **Workaround**: none.
- **Fix plan**: per the `TODO(csp-nonce)` at `app.ts:129-132`, add per-request nonce middleware, thread the nonce into `index.html` + React style injection, then drop `'unsafe-inline'`.
- **Files**: `backend/src/app.ts:L125-L140`.

### CSRF exemption list contains upload paths that already send the token

- **Severity**: Medium
- **Symptom**: `backend/src/middleware/csrf.ts:117-122` exempts `/upload/lab-report`, `/upload/insurance-sbc`, `/upload/lab-results-ocr`, `/insurance/upload-sbc` from CSRF. The upload client `uploadUtils.ts` already attaches `x-csrf-token`, so validation would succeed — the exemption is defensive only. Per the `TODO` at `csrf.ts:115`, this should be removed once all upload paths are confirmed.
- **Workaround**: none — exemption is safe because routes are still `authenticate`-guarded and enforce magic-byte validation inside the controller.
- **Fix plan**: verify every upload client path routes through `uploadUtils.ts`, then remove the exemption list.
- **Files**: `backend/src/middleware/csrf.ts:L110-L122`.

### Stripe billing not wired — plan upgrade button is a no-op

- **Severity**: Medium
- **Symptom**: `src/components/settings/PlanSection.tsx:119` has `// TODO: wire to Stripe checkout when billing goes live.` — the "Upgrade" affordance is present but the handler does not initiate a checkout session.
- **Workaround**: manual plan changes via admin console.
- **Fix plan**: integrate Stripe Checkout; backend currently has no `/billing/*` endpoints.
- **Files**: `src/components/settings/PlanSection.tsx:119`.

### Backend `test:unit` / `test:integration` npm scripts point at non-existent dirs

- **Severity**: Medium
- **Symptom**: `backend/package.json:14-15` defines `test:unit` / `test:integration` scripts that target `src/__tests__/unit` / `src/__tests__/integration`. Those directories do not exist; colocated `*.test.ts` files next to source are the active convention. Running either script reports 0 tests silently. Per [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) line 1088.
- **Workaround**: use `npm run test` (full Vitest suite) instead.
- **Fix plan**: delete the orphaned scripts or move colocated tests into those dirs.
- **Files**: `backend/package.json:L14-L15`.

### `tesseract.js` manualChunks entry references code that is never imported

- **Severity**: Medium
- **Symptom**: `vite.config.ts:27-30` carves out a `tesseract.js` manual chunk. Grep `tesseract` over `src/**` shows no match — OCR moved server-side to Google Document AI. Build emits an empty chunk (harmless) but documents an obsolete dep boundary. Per [`FRONTEND_MAP.md`](./FRONTEND_MAP.md) line 654.
- **Workaround**: none.
- **Fix plan**: remove the `tesseract.js` entry from `vite.config.ts` and drop the package if it is still in `package.json`.
- **Files**: `vite.config.ts:27-30`, `package.json` (root).

### E2E fixture PDFs not committed

- **Severity**: Medium
- **Symptom**: `e2e/biomarker-entry.spec.ts` upload scenarios require PDF fixtures that are not checked in. Fresh clones fail the spec. Per [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) line 1089.
- **Workaround**: locally generate or copy a 1KB stub PDF.
- **Fix plan**: commit a stub PDF to `e2e/fixtures/` or document the required fixtures in `e2e/fixtures/README.md`.
- **Files**: `e2e/biomarker-entry.spec.ts`, `e2e/fixtures/` (missing).

---

## Low

Minor annoyances or backlog items that do not block beta.

### Stray `nul` file at repo root

- **Severity**: Low
- **Symptom**: `C:/Users/breil/OneDrive/Desktop/OwnMyHealth/nul` — a 106-byte file created by a Windows shell redirection mis-fire (Windows treats `NUL` specially; OneDrive sync'd the actual file). Causes cross-platform oddities and shows up in `ls` output.
- **Workaround**: ignore.
- **Fix plan**: delete the file with `git rm -- nul` (quote required because `nul` is a reserved device name on Windows).
- **Files**: `/nul`.

### Stray `scratchpad.md.md` file at repo root

- **Severity**: Low
- **Symptom**: `C:/Users/breil/OneDrive/Desktop/OwnMyHealth/scratchpad.md.md` — 1015-byte file with double `.md.md` extension, likely an IDE-save accident.
- **Workaround**: ignore.
- **Fix plan**: rename to `scratchpad.md` or delete.
- **Files**: `/scratchpad.md.md`.

### `BCRYPT_ROUNDS` doc/code default mismatch

- **Severity**: Low
- **Symptom**: Code default is `13` (`backend/src/config/index.ts:93`); `.env.example:109` and `.env.production.example:61` list `12`. Per [`ENV_VARS.md`](./ENV_VARS.md) line 409. Not a bug — example is softer than code default — but misleads contributors reading the example.
- **Workaround**: none.
- **Fix plan**: bump the example comments to `13` or lower the code default to `12`.
- **Files**: `backend/src/config/index.ts:93`, `backend/.env.example:109`, `backend/.env.production.example:61`.

### `railway.toml` vestigial — both root and backend

- **Severity**: Low (infra cruft)
- **Symptom**: Two `railway.toml` files exist (`railway.toml` at repo root, `backend/railway.toml`). Live deploy target is GCP Cloud Run via `.github/workflows/deploy.yml`; neither Railway file is referenced by the pipeline. Per [`RUNBOOK.md`](./RUNBOOK.md) line 986 and [`ARCHITECTURE.md`](./ARCHITECTURE.md) line 823. Backend Railway config's health-check path is `/api/v1/health`; Cloud Run Dockerfile uses `/health` — any future Railway reactivation would fail the health check.
- **Workaround**: none.
- **Fix plan**: delete both files, OR annotate them as dead infra.
- **Files**: `railway.toml`, `backend/railway.toml`.

### `DEPLOY.md` describes un-shipped Railway deploy

- **Severity**: Low
- **Symptom**: Repo-root `DEPLOY.md` still documents Railway deployment (per [`RUNBOOK.md`](./RUNBOOK.md) line 986). Actual prod is Cloud Run.
- **Workaround**: use `RUNBOOK.md` for deploy instructions.
- **Fix plan**: rewrite `DEPLOY.md` to match Cloud Run reality or delete in favor of `RUNBOOK.md`.
- **Files**: `DEPLOY.md`.

### `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` declared, never consumed

- **Severity**: Low
- **Symptom**: `.env.example:32-33` and `.env.production.example:14-15` declare these vars; no TS consumer imports them. Per [`ENV_VARS.md`](./ENV_VARS.md) lines 74-75, 198-199.
- **Workaround**: none.
- **Fix plan**: delete the declarations — Supabase is not a dependency.
- **Files**: `.env.example:32-33`, `.env.production.example:14-15`.

### `CMS_API_KEY` retired but still in `.env.example`

- **Severity**: Low
- **Symptom**: `backend/.env.example:176` and `backend/.env.production.example:85` declare `CMS_API_KEY`; retired along with the CMS Marketplace integration. No TS consumer. Per [`ENV_VARS.md`](./ENV_VARS.md) line 76.
- **Workaround**: none.
- **Fix plan**: delete the line from both example files.
- **Files**: `backend/.env.example:176`, `backend/.env.production.example:85`.

---

## Deprecated (kept for compat)

Items marked deprecated or unused but still present in the tree. Removing them is safe but requires a coordinated PR.

| Item | Kind | Location | Status | Removal plan |
|---|---|---|---|---|
| `DNAData` | Prisma model | `backend/prisma/schema.prisma:383-400` | Deprecated per CLAUDE.md §Deprecated; no UI, no controller write site. Encrypted columns have no write or read site (per [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) lines 78-79). | Generate a migration that drops `dna_data`, `dna_variants`, `genetic_traits` tables and their `User.dnaData` relation (`schema.prisma:40`). |
| `DNAVariant` | Prisma model | `backend/prisma/schema.prisma:402-415` | Deprecated | Same migration as above. |
| `GeneticTrait` | Prisma model | `backend/prisma/schema.prisma:417-435` | Deprecated | Same migration as above. |
| `RoleGuard` | React component | `src/components/common/RoleGuard.tsx:44` | Exported; **never mounted** in any component (per [`FRONTEND_MAP.md`](./FRONTEND_MAP.md) lines 528, 648-651) | Delete or mount on `ProviderOnly` routes once Provider UI lands. |
| `PatientOnly` | React component | `src/components/common/RoleGuard.tsx:72` | Never mounted | Same. |
| `ProviderOnly` | React component | `src/components/common/RoleGuard.tsx:83` | Never mounted | Same. |
| `AdminOnly` | React component | `src/components/common/RoleGuard.tsx:94` | Never mounted | Same. |
| `ProviderOrAdmin` | React component | `src/components/common/RoleGuard.tsx:105` | Never mounted | Same. |
| `providerApi` | API client module | `src/services/api/provider.ts:33-71` | Exported; no component consumer (per [`FRONTEND_MAP.md`](./FRONTEND_MAP.md) lines 484, 642) | Delete or wire to a Provider dashboard page. |
| `patientApi` | API client module | `src/services/api/patient.ts:39-105` | Exported; no consumer (`FRONTEND_MAP.md` lines 485, 643) | Same. |
| `adminApi` | API client module | `src/services/api/admin.ts:37-134` | Exported; no consumer (`FRONTEND_MAP.md` lines 486, 644) | Same. |
| `railway.toml` (root) | Build config | `railway.toml` | Vestigial — Cloud Run is live target | Delete. |
| `backend/railway.toml` | Build config | `backend/railway.toml` | Same | Delete. |
| `nul` | Stray file | `/nul` | Shell-redirect artifact | Delete (`git rm -- nul`). |
| `scratchpad.md.md` | Stray file | `/scratchpad.md.md` | Double-extension artifact | Delete or rename. |
| `tesseract.js` chunk | Vite config | `vite.config.ts:27-30` | Client-side OCR removed; Document AI now server-side | Remove chunk entry and the package. |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Env var | `.env.example:32-33` | Supabase not a dep | Delete declarations. |
| `CMS_API_KEY` | Env var | `backend/.env.example:176` | CMS integration retired | Delete declarations. |

---

## Code-marker inventory

Every `TODO`, `FIXME`, `HACK`, and `XXX` marker in `backend/src/**` and `src/**`. Search performed with Grep pattern `TODO|FIXME|HACK|XXX` on 2026-04-24 — **no `FIXME`, `HACK`, or `XXX` occurrences exist** in either tree.

| Marker | File:line | Context (as-written) |
|---|---|---|
| TODO | `backend/src/app.ts:129` | `// TODO(csp-nonce): 'unsafe-inline' is required today because Tailwind` (→ [Medium: CSP](#csp-allows-unsafe-inline-for-styles)) |
| TODO | `backend/src/middleware/csrf.ts:115` | `// TODO: once all upload paths are confirmed to send CSRF headers, remove` (→ [Medium: CSRF exempt list](#csrf-exemption-list-contains-upload-paths-that-already-send-the-token)) |
| TODO | `backend/src/services/encryption.ts:81` | `* TODO(key-rotation): store the iteration count per user (or per-ciphertext` (→ [Medium: PBKDF2 per-user](#pbkdf2-iteration-count-is-a-global-constant-not-per-user)) |
| TODO | `src/components/settings/PlanSection.tsx:119` | `// TODO: wire to Stripe checkout when billing goes live.` (→ [Medium: Stripe not wired](#stripe-billing-not-wired--plan-upgrade-button-is-a-no-op)) |

Total: **4 TODO**, 0 FIXME, 0 HACK, 0 XXX. No single file has more than one marker.

---

## Skipped / TODO tests

Searches performed on 2026-04-24:

- `Grep pattern: "\.skip\("` over `backend/src/**/*.test.ts` → no matches
- `Grep pattern: "\.todo\("` over `backend/src/**/*.test.ts` → no matches
- `Grep pattern: "\.skip\("` over `src/__tests__/**` → no matches
- `Grep pattern: "\.skip\("` over `e2e/**` → no matches
- `Grep pattern: "xit\(|xtest\(|xdescribe\("` over `backend/src/**` and `e2e/**` → no matches (earlier false positives were `process.exit(...)` in non-test files)

Conditional skips only:

| Form | File:line | Condition |
|---|---|---|
| `describe.skipIf(!hasLiveDb)` | `backend/src/services/rls.test.ts:29` | Skips the entire `RLS tenant isolation` suite when `DATABASE_URL` or `PHI_ENCRYPTION_KEY` is unset. Intentional (unit-only CI stays green); becomes mandatory once the C-8 DB-role cutover lands. See [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) line 626. |

Total hard-skipped or `.todo` tests: **0**.

---

## Dependency vulnerabilities

`npm audit --json` run on 2026-04-24 against `C:/Users/breil/OneDrive/Desktop/OwnMyHealth/` and `C:/Users/breil/OneDrive/Desktop/OwnMyHealth/backend/`.

### Severity summary

| Scope | Critical | High | Moderate | Low | Info | Total |
|---|---:|---:|---:|---:|---:|---:|
| Root (frontend) | 0 | 0 | 2 | 0 | 0 | **2** |
| Backend | 0 | 0 | 9 | 2 | 0 | **11** |
| **Monorepo total** | **0** | **0** | **11** | **2** | **0** | **13** |

### Root — notable advisories

| Package | Severity | Advisory | Fix |
|---|---|---|---|
| `postcss` (direct) | moderate | GHSA-qx2v-qp2m-jg93 — XSS via unescaped `</style>` in CSS stringify output | `postcss@>=8.5.10` (`fixAvailable: true`, non-major) |
| `ajv` (transitive) | moderate | GHSA-2g4f-4pwh-qvx6 — ReDoS when using `$data` option | `ajv@>=6.14.0` (`fixAvailable: true`, non-major) |

### Backend — notable advisories

| Package | Severity | Advisory | Fix | Notes |
|---|---|---|---|---|
| `prisma` (direct) | moderate | Chains via `@prisma/dev` → `@hono/node-server` GHSA-92pp-h63x-v22m (middleware bypass via repeated slashes in serveStatic) | `prisma@6.19.3` (**SemVer major**) | Only hits dev-time `@prisma/dev` — production prisma client is unaffected; still flagged because `prisma` CLI is shipped in the backend image build chain. |
| `@google-cloud/storage` (direct) | moderate | Transitive via `retry-request`, `teeny-request`, `uuid` | `@google-cloud/storage@5.20.4` (**SemVer major**) | Bump is a breaking change; storage API surface has moved since v5. Validate `storageService.ts` against the new SDK before upgrading. |
| `uuid` (direct) | moderate | GHSA-w5hq-g745-h8pq — missing buffer bounds check in v3/v5/v6 when `buf` is provided | `uuid@14.0.0` (**SemVer major**) | Code uses v4 (random) + passes no `buf` param — exploit path does not apply, but `npm audit` still flags. |
| `postcss` (transitive) | moderate | GHSA-qx2v-qp2m-jg93 (same as root) | `postcss@>=8.5.10` | Shared with root. |
| `gaxios` (transitive) | moderate | Via `uuid` | `fixAvailable: true` | Chains through `@google-cloud/storage`. |
| `retry-request` (transitive) | moderate | Via `teeny-request` | via `@google-cloud/storage@5.20.4` | Same chain. |
| `teeny-request` (transitive) | moderate | Via `http-proxy-agent`, `uuid` | via `@google-cloud/storage@5.20.4` | Same chain. |
| `@hono/node-server` (transitive) | moderate | GHSA-92pp-h63x-v22m — middleware bypass via repeated slashes in serveStatic | via `prisma@6.19.3` | Dev-only path. |
| `@prisma/dev` (transitive) | moderate | Via `@hono/node-server` | via `prisma@6.19.3` | Dev-only. |
| `@tootallnate/once` (transitive) | low | GHSA-vpq2-c234-7xj6 — incorrect control flow scoping | via `@google-cloud/storage@5.20.4` | Chains through `http-proxy-agent`. |
| `http-proxy-agent` (transitive) | low | Via `@tootallnate/once` | via `@google-cloud/storage@5.20.4` | Same chain. |

### Remediation plan

1. **Non-major fixes first**: run `npm audit fix` in root (closes `postcss`, `ajv`). Low risk.
2. **Bump `uuid@14`**: direct dep in `backend/package.json`; exploit path is not hit by current code (no `buf` arg, no v3/5/6 usage), but closes the advisory. Medium risk — v14 is ESM-only, confirm Vitest + Jest interop.
3. **Bump `@google-cloud/storage@5.20.4`**: major. Blocks closure of 5 advisories. Validate `storageService.ts` signed-URL generation and `uploadObject` signatures against the v5 API.
4. **Bump `prisma@6.19.3`**: major. Only closes dev-time advisories. Coordinate with `@prisma/client` version.

Zero high / critical advisories exist today in either tree.

---

## Missing test coverage

Derived from [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) plus Glob of `backend/src/**/*.test.ts` vs `backend/src/**/*.ts` on 2026-04-24.

### Controllers

| Controller | File | Has test? | Gap |
|---|---|---|---|
| `authController` | `backend/src/controllers/authController.ts` | yes (`authController.test.ts`) | — |
| `biomarkerController` | `backend/src/controllers/biomarkerController.ts` | yes | — |
| `expenseController` | `backend/src/controllers/expenseController.ts` | yes | — |
| `healthGoalsController` | `backend/src/controllers/healthGoalsController.ts` | yes | — |
| `healthNeedsController` | `backend/src/controllers/healthNeedsController.ts` | yes | — |
| `settingsController` | `backend/src/controllers/settingsController.ts` | yes | — |
| `aiChatController` | `backend/src/controllers/aiChatController.ts` | **no** | Streaming SSE + decryption outside transaction (per commit `52507c3`) — zero coverage of error paths. |
| `fileController` | `backend/src/controllers/fileController.ts` | **no** | GCS signed-URL + download paths untested. |
| `fhirController` | `backend/src/controllers/fhirController.ts` | **no** | Quest FHIR integration (PR #71) has service tests but no controller test. |
| `insuranceController` | `backend/src/controllers/insuranceController.ts` | **no** | Plan CRUD + SBC re-analyze paths untested. |
| `upload/labUploadController` | `backend/src/controllers/upload/labUploadController.ts` | **no** | PDF parsing + OCR branch untested at controller layer. |
| `upload/sbcUploadController` | `backend/src/controllers/upload/sbcUploadController.ts` | **no** | SBC Claude extraction + plan creation untested at controller layer. |

**6 controllers out of 12** (excluding index/testHelpers/shared) have no tests.

### Routes

Glob: 17 `*Routes.ts` files under `backend/src/routes/`; **2** have route-level tests (`adminRoutes.demoProtection.test.ts`, `biomarkerRoutes.guidance.test.ts`). Per [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md), route tests exist only where middleware behavior (demo-protection, rate limit) is the thing under test. Routes without integration tests: `authRoutes`, `expenseRoutes`, `fhirRoutes`, `fileRoutes`, `healthGoalsRoutes`, `healthNeedsRoutes`, `insuranceRoutes`, `onboardingRoutes`, `planRoutes`, `patientRoutes`, `providerRoutes`, `settingsRoutes`, `uploadRoutes`, `aiRoutes`, plus the index barrels.

### Services

| Service | Test exists? | Notes |
|---|---|---|
| `authService.ts` | yes | — |
| `auditLog.ts` | yes | — |
| `claudeExtraction.ts` | yes | — |
| `encryption.ts` | yes | — |
| `userEncryption.ts` | yes | — |
| `pdfTextExtraction.ts` | yes | — |
| `sbcExtraction.ts` | yes | — |
| `database.ts` (`rls.test.ts`) | yes (auto-skipped without live DB) | — |
| `emailService.ts` | **no** | `authService.register` → SendGrid template send is unasserted. Per [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) line 1085. |
| `ocrService.ts` | **no** | Google Document AI boundary has zero coverage. Per [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) line 1086. |
| `storageService.ts` | **no** | GCS signed-URL + bucket ops untested. |
| `notificationService.ts` | **no** | — |
| `onboardingService.ts` | **no** | — |
| `healthProfileService.ts` | **no** | — |
| `healthContextService.ts` | **no** | Feeds Claude AI health-guide context — untested. |
| `usageTracker.ts` | **no** | Plan-limit counters untested. |
| `aiCostTracker.ts` | **no** | Cost accounting untested. |
| `biomarkerExtractor.ts` | **no** | — |
| `biomarkerPatterns.ts` | **no** | — |
| `pdfParser.ts` | **no** | — |
| `fhir/fhirClient.ts` | **no** | Per PR #71 — Quest FHIR integration; only some paths covered by integration tests. |
| `fhir/labSyncService.ts` | **no** | — |
| `fhir/smartAuth.ts` | **no** | — |
| `fhir/loincMapper.ts` | **no** | — |
| `knowledge/*.ts` | **no** | 4 files — all new (PR #59) — uncovered. |

### Middleware

| Middleware | Test exists? |
|---|---|
| `errorHandler` | yes |
| `validation` | yes |
| `rbac` | yes |
| `auth` | **no** — JWT verify path untested at unit level |
| `csrf` | **no** — exemption list + double-submit check untested |
| `rateLimiter` | **no** |
| `demoProtection` | tested indirectly via `adminRoutes.demoProtection.test.ts` |

### Mock / fixture infra gaps

- No `__mocks__/` directories anywhere (Glob `**/__mocks__/**` empty). Inline `vi.mock(...)` factories only.
- No `testHelpers/`, `fixtures/`, or `factories/` directories. Only `backend/src/controllers/testHelpers.ts` (single file).
- No shared `asUser` / `asAdmin` RLS-helper. Each test writes its own stub. Per [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) line 1087.

---

## Fixed issues reference

Recent issues closed — from `git log --oneline` on 2026-04-24. Provides context for anyone triaging a regression. This is **not** a changelog; see [`CHANGELOG.md`](./CHANGELOG.md) (doc pending — see prompt `./17-changelog-doc.md`) for the authoritative list.

| Finding | Status | Closing commit | Summary |
|---|---|---|---|
| C-1 — RLS enforcement | Closed (code) | `9727492` — "fix(security): close C-1 — enforce RLS via transaction-scoped SET LOCAL" | Introduced `withRLSContext` / `withRLSTransaction`; **policies still inert at runtime** → tracked as [C-8](#rls-policies-inert-at-runtime-c-8). |
| C-2 — audit-log salt at rest | Closed | `f6bdc9a` — "fix(security): encrypt audit-log system salt at rest" | — |
| C-3 — JWT secret fallbacks | Closed | `2808b97` — "fix(security): close C-3 — JWT secret fallbacks removed" | — |
| C-4 — insecure PHI encryption key accepted in prod | Closed | `ea67ccb` — "fix(security): close C-4 — reject insecure PHI encryption key in all environments" | — |
| C-5 — `jspdf` CVE | Closed | `4a08802` — "fix(deps): bump jspdf to 4.2.1+ to close CVE-2026-31938 and siblings (C-5)" | — |
| C-6 — GCS object lifecycle on delete | Closed | `0f7970a` — "fix(security): close C-6 — delete GCS objects on account/data deletion" | — |
| C-7 — PHI minimization before Claude calls | Closed | `8c19438` + `4fa53a6` — "fix(security): close C-7 — PHI minimization before Claude API calls" (+ remaining gaps) | `4fa53a6` also closed F-3 IDOR. |
| C-8 Part 1 — `auditService.initialize` RLS wrap | Closed | `65f9ffb` — "fix(security): wrap auditService.initialize in admin RLS context (C-8 Part 1)" | Runtime-role still outstanding. |
| C-8 Part 2a — cross-user ProviderPatient writes | Closed | `a648eb8` — "fix(security): wrap cross-user ProviderPatient writes in RLS context" | — |
| C-8 Part 2b-i — authService + userEncryption pre-auth | Closed | `4fa6460` — "fix(security): wrap authService + userEncryption pre-auth paths in RLS context" | — |
| C-8 Part 2b-ii — adminRoutes + auditLog runtime | Closed | `74af20e` — "fix(security): wrap adminRoutes + auditLog runtime + users-by-email in RLS context" | — |
| C-8 code prep — audit salt env, bare-prisma sweep, startup assertion | Closed | `4290520` — "feat(c-8): prepare code for RLS role cutover" | Leaves **Part 3 DB role cutover** open. |
| F-3 IDOR | Closed | `4fa53a6` + `b2b762e` — "fix(security): close F-3/F-4/F-5/F-7 trust gaps" | — |
| F-4 / F-5 / F-7 trust gaps | Closed | `b2b762e` | Batch close. |
| F-14 / F-15 | Closed per user memory | PR #30 | See user memory `ownmyhealth-project.md`. |
| F-21 upload controller split | Closed | `1ab1206` — "refactor(backend): split uploadController into upload/ module + fix F-21" | — |
| Batch-close 5 High-severity audit findings | Closed | `fb8a864` — "fix(security): batch-close 5 High-severity audit findings (#52)" | — |
| `/ai/chat` CSRF bypass | Closed | `5e4241e` — "fix(csrf): actually exempt /ai/chat from validation" → `2843339` — "fix(csrf): remove duplicate route-level csrfProtection from /ai/chat" | Two-PR fix; second removed the duplicate. |
| `/ai/chat` transaction timeout leak (decryption inside transaction) | Closed | `52507c3` — "fix(ai-chat): move decryption out of withRLSContext transaction" | Introduces new risk: aiChatController still has **zero tests** — see [Missing test coverage](#missing-test-coverage). |
| CORS_ORIGIN parsing | Closed | `64b7d14` + `8deed18` | Prod origins hardcoded as always-allowed. |
| Dead-code audit | Closed | `eb45a57` — "Cleanup/dead code audit 2026 04 23 (#74)" | Surfaced the unused `RoleGuard` / `providerApi` / `patientApi` / `adminApi` — still not removed (tracked in [Deprecated](#deprecated-kept-for-compat)). |

**Recently closed issue that introduced new known risk**: `52507c3` ("move decryption out of `withRLSContext` transaction") fixed a 15s transaction timeout on `/ai/chat` but the controller has zero tests, so the new shape of the decryption pipeline is not regression-guarded.

---

## Acceptance questions — self-answered

**Q1. What's the single most important open Critical issue?**
C-8: RLS policies are inert at runtime because the app connects as a BYPASSRLS role in dev and prod. Controllers still filter by `userId`, so no PHI leak today, but RLS is not actually defending — see [Critical: RLS policies inert at runtime (C-8)](#rls-policies-inert-at-runtime-c-8).

**Q2. How many TODO/FIXME/HACK markers exist, and which file has the most?**
**4 total** — all `TODO`, no `FIXME`, `HACK`, or `XXX`. Each marker is in a different file; no file has more than one. Files: `backend/src/app.ts`, `backend/src/middleware/csrf.ts`, `backend/src/services/encryption.ts`, `src/components/settings/PlanSection.tsx`. See [Code-marker inventory](#code-marker-inventory).

**Q3. Are any tests currently skipped or marked `.todo`?**
**No hard skips and no `.todo` tests.** One conditional `describe.skipIf(!hasLiveDb)` at `backend/src/services/rls.test.ts:29` auto-disables the RLS tenant-isolation suite when the live-DB env is absent. See [Skipped / TODO tests](#skipped--todo-tests).

**Q4. What's the `npm audit` severity breakdown?**
Root (frontend): 0 critical / 0 high / **2 moderate** / 0 low. Backend: 0 critical / 0 high / **9 moderate** / **2 low**. See [Dependency vulnerabilities](#dependency-vulnerabilities) for the full advisory list.

**Q5. Which deprecated models are still in `schema.prisma` and should be dropped?**
`DNAData` (`schema.prisma:383-400`), `DNAVariant` (`:402-415`), `GeneticTrait` (`:417-435`). Dropped model data has no UI consumer and no controller write site (per [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md)). See [Deprecated](#deprecated-kept-for-compat).

**Q6. Which controllers have no test coverage at all?**
`aiChatController`, `fileController`, `fhirController`, `insuranceController`, `upload/labUploadController`, `upload/sbcUploadController`. See [Missing test coverage → Controllers](#controllers).

**Q7. What's the workaround for the RLS runtime gap (C-8)?**
None at runtime — continue filtering by `userId` in controllers; treat `withRLSContext` wrappers as advisory. `rls.test.ts` needs a NOBYPASSRLS role in `DATABASE_URL` to catch regressions. Fix lands with the C-8 Part 3 DB role cutover (`docs/c-8-part-c-runbook.md`). See [Critical: C-8](#rls-policies-inert-at-runtime-c-8).

**Q8. Which recently closed issue introduced new known risk?**
`52507c3` ("fix(ai-chat): move decryption out of withRLSContext transaction") closed a transaction-timeout bug but left `aiChatController` with **zero tests**, so the new decryption-outside-transaction shape is not regression-guarded. See [Fixed issues reference](#fixed-issues-reference).

**Q9. Is the `nul` stray file still in the tree?**
**Yes** — `C:/Users/breil/OneDrive/Desktop/OwnMyHealth/nul`, 106 bytes, dated 2026-01-09. Fix: `git rm -- nul`. See [Low: Stray `nul` file](#stray-nul-file-at-repo-root).

**Q10. Which axios / vite advisories are open, and what's the remediation plan?**
**Zero axios advisories** open in either tree (axios itself is not in the vulnerability list). Vite is not directly flagged; its ecosystem surfaces `postcss` (moderate, non-major fix to `>=8.5.10`) via Tailwind. No critical / high advisories exist. Full plan in [Dependency vulnerabilities → Remediation plan](#remediation-plan).

---

## Related Documents

- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — authoritative source for C-/F-numbered security findings; this doc mirrors severity without re-auditing.
- [CHANGELOG.md](./CHANGELOG.md) — recently closed items with PR links; [Fixed issues reference](#fixed-issues-reference) above is a derived subset.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — symptom → root cause for live bugs, including the Railway / Cloud Run deploy drift.
- [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) — how to close the missing-test gaps; canonical inline `vi.mock(...)` catalog.
- [DATA_MODEL.md](./DATA_MODEL.md) — full ER diagram including the deprecated DNA models.
- [FRONTEND_MAP.md](./FRONTEND_MAP.md) — full component + API-client inventory; source of the unused `RoleGuard` / `providerApi` / `patientApi` / `adminApi` drift.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — logger-redaction gap matrix (§7 Drift findings).
- [ENV_VARS.md](./ENV_VARS.md) — env-var name drift (`GCP_PROCESSOR_ID` vs `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`), unused `VITE_SUPABASE_*`, retired `CMS_API_KEY`.
- [ROUTING_TABLE.md](./ROUTING_TABLE.md) — duplicate `/insurance/upload-sbc` mount analysis.
- [RUNBOOK.md](./RUNBOOK.md) — live deploy topology; source of the `railway.toml` / `DEPLOY.md` vestigial-infra findings.

---

## Prompt drift log

- Prompt `20-known-issues-doc.md` expects a live `SECURITY_STATUS.md` / `SECURITY_AUDIT_*.md` to mirror. Neither exists under `New Project Documents/` as of 2026-04-24; `SECURITY_STATUS.md` is a sibling doc still in generation (per task `#32`). C-8 mirrored from user memory `ownmyhealth-project.md` and the `docs/c-8-part-c-runbook.md` runbook instead. Security-row citations point at commits and `SECURITY_STATUS.md` as the intended authoritative source — update this doc once the sibling lands.
- Prompt's "Skipped tests" regex (`\.(skip|todo)\(|xit\(`) matches `process.exit(` on non-test files in this codebase (4 false positives). Refined search to `(it|test|describe)\.(skip|todo)\(|xit\(|xtest\(|xdescribe\(` then `\.skip\(` / `\.todo\(` scoped to `*.test.ts`. Zero true positives.
- Prompt asks "Which axios / vite advisories are open?" (Acceptance Q10). Neither axios nor vite is currently flagged by `npm audit` — answered "none" with the actual open advisories (postcss, ajv, uuid, @google-cloud/storage chain, prisma chain).
- Prompt lists `fileController` and `aiChatController` as missing-test examples; also missing are `fhirController`, `insuranceController`, `upload/labUploadController`, `upload/sbcUploadController` — all surfaced in the [Controllers](#controllers) table.
- `CLAUDE.md:16` says "Testing: Vitest (frontend), **Jest** (backend)"; actual backend runner is **Vitest 4.x** (`backend/package.json:11`, `backend/vitest.config.ts:1`) per [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) line 1170. Not re-documented here.
