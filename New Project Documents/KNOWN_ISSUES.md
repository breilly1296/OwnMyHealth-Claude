# KNOWN_ISSUES.md — Bug & Tech-Debt Ledger

> **Scope**: This is the authoritative bug and tech-debt ledger for the OwnMyHealth codebase. Every `TODO`/`FIXME`/`HACK`/`XXX` code marker is tracked here as a row, every skipped/gated test is recorded, dependency vulnerabilities are summarised from `npm audit`, and open security findings are mirrored with a pointer to [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).
>
> **Generated**: 2026-06-01 against `git HEAD = 13db267` (`fix(auth): fire one-time-token confirmation exactly once (#134)`).
> **Repo root**: `C:/Users/breil/Projects/OwnMyHealth/`.
> **Reproduce the audit numbers**: see [§8 Dependency vulnerabilities](#8-dependency-vulnerabilities) and [§6 Code-marker inventory](#6-code-marker-inventory) for the exact `npm audit` / Grep commands.

This doc passes the five `_doc-quality.md` tests (question-answering, path-and-line, snippet, diagram, reproducibility). Every non-trivial claim cites `file:path:line`.

---

## Severity legend

| Severity | Meaning |
|---|---|
| **Critical** | Blocks core functionality or PHI isolation. |
| **High** | Significant feature broken; must fix before beta. |
| **Medium** | Usability / fix during beta. |
| **Low** | Minor annoyance / backlog. |

---

## 1. Critical

### 1.1 RLS policies inert at runtime in dev/staging (C-8)

- **Severity**: Critical (defense-in-depth gap; **production is now hard-blocked**).
- **Symptom**: PostgreSQL Row-Level Security policies exist (migration `backend/prisma/migrations/20260107_add_rls_policies/`) but if the DB login role has `BYPASSRLS`, the policies do not enforce at runtime — every `withRLSContext`/`withRLSTransaction` query sees all rows regardless of `app.current_user_id`.
- **Current state (post-cutover)**: Boot-time assertion `assertNoBypassRLS()` now **fails closed in production** and only warns in dev/staging:

  ```ts
  // Source: backend/src/services/database.ts:L248-L260
  if (config.isProduction) {
    logger.error(
      'FATAL: Production database role has BYPASSRLS. ' +
      'RLS policies are not enforcing. Refusing to start. ' +
      'See C8_PART3_RUNBOOK.md.'
    );
    process.exit(1);
  }

  logger.warn(
    'WARNING: Database role has BYPASSRLS — RLS policies are not enforcing. ' +
    'This is acceptable in development but must be fixed before production.'
  );
  ```

- **Root cause**: The DB role provisioned at Cloud SQL was granted `BYPASSRLS`. The app should run as a non-superuser role (`omh_app`).
- **Workaround**: None at the dev/staging runtime layer — RLS is **defense-in-depth**, not the only control. The real tenant boundary is the application layer: controllers filter by `userId` and the RBAC middleware (`backend/src/middleware/rbac.ts`) gates provider/admin access. Treat all `withRLSContext` uses in dev/staging as **advisory** until the role is cut over. The boot check reads `pg_roles.rolbypassrls` for `current_user`:

  ```ts
  // Source: backend/src/services/database.ts:L228-L231
  const rows = await prisma.$queryRaw<Array<{ rolbypassrls: boolean }>>`
    SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  bypass = rows[0]?.rolbypassrls;
  ```

- **Fix plan**: Cut the production app over to the non-`BYPASSRLS` `omh_app` role; the transitional `RLS_ENFORCEMENT=strict` flag was removed once that landed (`backend/src/services/database.ts:210-211`). See [`SECURITY_STATUS.md#c-8`](./SECURITY_STATUS.md) and `C8_PART3_RUNBOOK.md` (external runbook, not in `New Project Documents/`).
- **Tracked in**: memory `ownmyhealth-project.md`; open finding C-8 in [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).
- **Test coverage**: live-DB RLS isolation tested in `backend/src/services/rls.test.ts` (gated by `describe.skipIf(!hasLiveDb)` — see [§7](#7-skipped--gated-tests)); production-bypass FATAL path tested in `backend/src/services/database.test.ts:220`.
- **Files**: `backend/src/services/database.ts:218` (`assertNoBypassRLS`); Cloud SQL role config (external — GCP Console).

```
Boot sequence (backend/src/services/database.ts)
  initializeDatabase()
        │
        ▼
  assertNoBypassRLS()  ──reads──▶ pg_roles.rolbypassrls
        │
        ├─ bypass = false ─────────▶ ✓ startup log, continue           (database.ts:244)
        ├─ bypass = true  + prod ──▶ FATAL log + process.exit(1)        (database.ts:254)
        └─ bypass = true  + dev ───▶ WARN log, continue (RLS advisory)  (database.ts:257)
```

---

## 2. High

### 2.1 No PHI key-rotation capability (dead helper removed)

- **Severity**: High (operational / compliance — no safe path to rotate a compromised `PHI_ENCRYPTION_KEY`).
- **Symptom**: There is no working function to rotate a user's encryption key. The former `rotateUserEncryptionKey()` helper was **removed** in commit `79c532c` (`fix: role-guard restricted pages; drop dead key-rotation footgun`) because it rotated the key *version* (new salt, old marked inactive) but did **not** re-encrypt existing PHI — calling it would have bricked all of that user's encrypted data.
- **Root cause**: Partial implementation; zero callers; documented as a footgun.

  ```ts
  // Source: backend/src/services/userEncryption.ts:L74-L80
  // NOTE: A key-rotation helper used to live here. It rotated the key VERSION
  // (new salt, old marked inactive) but did NOT re-encrypt the user's existing
  // PHI, so calling it without a paired full re-encryption pass would have
  // bricked all of that user's encrypted data. It had no callers. Removed to
  // eliminate the footgun; proper key rotation should be a dedicated job that
  // re-encrypts every PHI column across all tables in one transaction. The
  // `KEY_ROTATION` AuditAction enum value is retained for that future work.
  ```

- **Workaround**: None. The `KEY_ROTATION` AuditAction enum value is retained for the future job (`backend/src/services/userEncryption.ts:80`).
- **Fix plan**: Build a dedicated full-re-encryption job that re-encrypts every PHI column across all tables in one transaction. Related debt: the PBKDF2 iteration-count fallback (see [§4.1](#41-pbkdf2-iteration-count-not-stored-per-ciphertext)).
- **Tracked in**: commit `79c532c`; [`CHANGELOG.md`](./CHANGELOG.md).
- **Files**: `backend/src/services/userEncryption.ts:74`.

### 2.2 AI spend circuit-breaker is per-instance, not cluster-wide

- **Severity**: High (cost / billing exposure under autoscale).
- **Symptom**: The daily AI spend cap (`aiSpendGuard`) is enforced against an **in-memory, per-instance** accumulator. Under Cloud Run autoscale with N instances, the effective ceiling is **N × budget**, not the configured budget.
- **Root cause**: Accumulator state lives in module-level variables, not a shared store:

  ```ts
  // Source: backend/src/services/aiCostTracker.ts:L39-L41
  let spendDayKey = '';
  let globalSpentUsd = 0;
  const userSpentUsd = new Map<string, number>();
  ```

  The config comment documents the limitation explicitly:

  ```ts
  // Source: backend/src/config/index.ts:L188-L198
  // AI spend circuit breaker. Rolling per-UTC-day budgets enforced by the
  // aiSpendGuard middleware (accumulator updated by aiCostTracker). 0 = the
  // cap is disabled. NOTE: the accumulator is in-memory/per-instance, so under
  // Cloud Run autoscale the effective ceiling is N×budget (same limitation as
  // the rate limiters; bounded by --max-instances). Move to a shared store
  // (Memorystore) for multi-instance precision. ...
  ai: {
    dailyBudgetUsd: Number(process.env.AI_DAILY_BUDGET_USD ?? '50'),
    userDailyBudgetUsd: Number(process.env.AI_USER_DAILY_BUDGET_USD ?? '5'),
  },
```

- **Secondary gap**: `aiSpendGuard` checks the cap **before** the call, so a single in-flight call can push slightly past the cap; the *next* call is then refused — that is what bounds a runaway loop, not a hard per-call ceiling (`backend/src/services/aiCostTracker.ts:L62-L78`).
- **Workaround**: Set conservative budgets (`AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD` — see [`ENV_VARS.md`](./ENV_VARS.md)) and bound Cloud Run with `--max-instances` so `N × budget` stays acceptable. `0` disables a scope.
- **Fix plan**: Move the accumulator (and the in-memory rate limiters — finding #37) to a shared store (Memorystore/Redis). Tracked under infra finding #37 (Redis rate-limiting) — provisioning runbook merged in `ad536b2`.
- **Tracked in**: [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) (finding #37); config comment above.
- **Files**: `backend/src/services/aiCostTracker.ts:29`, `backend/src/middleware/aiSpendGuard.ts:23`, `backend/src/config/index.ts:195`.

### 2.3 `test:unit` / `test:integration` scripts run ZERO tests

- **Severity**: High (false signal — CI/dev may believe a suite ran when it ran nothing).
- **Symptom**: `npm run test:unit` and `npm run test:integration` point at `src/__tests__/unit` and `src/__tests__/integration`, which **do not exist** in the backend. Vitest finds no files and exits successfully, giving a green "0 tests" result.

  ```json
  // Source: backend/package.json:L15-L16
  "test:unit": "vitest run src/__tests__/unit",
  "test:integration": "vitest run src/__tests__/integration",
  ```

- **Root cause**: Tests are **colocated** (e.g. `backend/src/services/encryption.test.ts`), not under a `__tests__/` tree, so these legacy script paths are stale.
- **Workaround**: Use `npm test` (= `vitest run`, all colocated tests) locally or `npm run test:ci` (`vitest run --config vitest.config.ci.ts`) in CI (`backend/package.json:11,14`). RLS isolation: `npm run test:rls` (`backend/package.json:17`).
- **Fix plan**: Either delete the two dead scripts or repoint them at real globs.
- **Tracked in**: [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) (§2 trap callout — `backend/package.json:15-16`).
- **Files**: `backend/package.json:15`, `backend/package.json:16`.

---

## 3. Medium

### 3.1 CSP allows `'unsafe-inline'` for styles (XSS surface)

- **Severity**: Medium (XSS hardening gap, not an active exploit).
- **Symptom**: The Helmet Content-Security-Policy permits `'unsafe-inline'` in `style-src`, leaving a CSS-injection / inline-style XSS vector open.
- **Root cause**: Tailwind and third-party libraries inject runtime `<style>` tags; a nonce-based CSP is not yet wired.

  ```ts
  // Source: backend/src/app.ts:L130-L134
  // TODO(csp-nonce): 'unsafe-inline' is required today because Tailwind
  // and third-party libs inject runtime <style> tags. Migrate to a
  // nonce-based CSP (generate per-request nonce middleware → thread
  // into index.html + React style injection) to close the XSS vector.
  styleSrc: ["'self'", "'unsafe-inline'"],
  ```

- **Workaround**: `script-src` is already locked to `'self'` (`backend/src/app.ts:129`); the residual risk is style-only injection.
- **Fix plan**: Per-request nonce middleware threaded into `index.html` + React style injection.
- **Files**: `backend/src/app.ts:130`.

### 3.2 Billing / plan upgrades are not wired (manual only)

- **Severity**: Medium (feature gap — paid tiers cannot self-serve).
- **Symptom**: Clicking "Upgrade" in the settings Plan section does nothing but surface an error toast; there is no Stripe checkout.

  ```tsx
  // Source: src/components/settings/PlanSection.tsx:L156-L159
  onClick={() => {
    // TODO: wire to Stripe checkout when billing goes live.
    onError?.('Upgrades are not available yet. Contact us to upgrade manually.');
  }}
  ```

- **Root cause**: No payment processor integrated. Plans are assigned manually via the admin panel or a direct DB update:

  ```ts
  // Source: backend/src/config/plans.ts:L4-L6
  * Defines what each tier gets. No payment processing yet — plans are assigned
  * manually via the admin panel or a direct DB update. When Stripe is added,
  * its webhook handler will update the same `users.plan` column.
  ```

- **Workaround**: Assign `users.plan` manually (admin panel / DB). Plan tiers: `FREE | PRO | TEAM` (`backend/src/config/plans.ts:16`).
- **Fix plan**: Add Stripe checkout + webhook that updates `users.plan`. Plan-gating enforcement (`questFhirIntegration`, etc.) already exists in `backend/src/config/plans.ts:18-29`.
- **Files**: `src/components/settings/PlanSection.tsx:157`, `backend/src/config/plans.ts:1`.

### 3.3 FHIR / Quest SMART-on-FHIR subsystem has thin test coverage

- **Severity**: Medium (untested PHI-adjacent OAuth + sync path).
- **Symptom**: The Quest lab-sync subsystem (OAuth token handling, lab import, LOINC mapping) has **only one** test file — `backend/src/services/fhir/urlSafety.test.ts` (the SSRF guard). The core services have **no tests**: `labSyncService.ts`, `smartAuth.ts`, `fhirClient.ts`, `loincMapper.ts`.
- **Root cause**: Subsystem shipped after the test-coverage push (`feat(quest-fhir)` commit `63dd1d8`).
- **Risk**: `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted` hold live OAuth tokens to PHI at the lab. They are encrypted with the per-user key (schema confirms intent):

  ```prisma
  // Source: backend/prisma/schema.prisma:L698-L702
  // OAuth tokens are treated as PHI-adjacent — encrypted with the user's
  // per-user key via the existing encryption service.
  accessTokenEncrypted  String    @map("access_token_encrypted")
  refreshTokenEncrypted String?   @map("refresh_token_encrypted")
  tokenExpiresAt        DateTime? @map("token_expires_at") @db.Timestamptz(6)
  ```

  Encrypt/decrypt lives in `backend/src/services/fhir/labSyncService.ts` (token load/refresh in the documented sync flow, `labSyncService.ts:L4-L17`); the OAuth handshake is in `backend/src/services/fhir/smartAuth.ts`.
- **Workaround**: Feature is disabled unless `QUEST_FHIR_CLIENT_ID` is set (`backend/src/services/fhir/labSyncService.ts:L56-L58`; `backend/src/config/index.ts:201`) and gated behind the `questFhirIntegration` plan flag (`backend/src/config/plans.ts:28`).
- **Fix plan**: Add unit tests for token encrypt/decrypt round-trip, refresh-on-expiry, LOINC mapping fallback, and dedupe. See [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md).
- **Files**: `backend/src/services/fhir/labSyncService.ts`, `smartAuth.ts`, `fhirClient.ts`, `loincMapper.ts` (all under `backend/src/services/fhir/`).

### 3.4 Untested controllers (AI chat, FHIR, file, insurance)

- **Severity**: Medium. See [§9 Missing test coverage](#9-missing-test-coverage) for the full table.
- **Symptom**: `aiChatController`, `fhirController`, `fileController`, `insuranceController` have **no** colocated `.test.ts`.
- **Files**: `backend/src/controllers/aiChatController.ts`, `fhirController.ts`, `fileController.ts`, `insuranceController.ts`.

---

## 4. Low

### 4.1 PBKDF2 iteration count not stored per-ciphertext

- **Severity**: Low (migration artifact; leaks nothing).
- **Symptom**: Decryption tries the current iteration count (600,000) first, then falls back to the legacy count (100,000) if the auth tag fails — both derivations use the same stored salt.

  ```ts
  // Source: backend/src/services/encryption.ts:L80-L83
  * TODO(key-rotation): store the iteration count per user (or per-ciphertext
  * envelope) and remove the legacy fallback once all rows are re-encrypted.
  * The current scheme leaks nothing — both derivations use the same stored
  * salt — but it's a migration artifact, not a long-term design.
  ```

- **Root cause**: Iteration count was raised (100k → 600k) without a coordinated re-encryption (`backend/src/services/encryption.ts:L74-L86`).
- **Fix plan**: Bundle with the key-rotation job (see [§2.1](#21-no-phi-key-rotation-capability-dead-helper-removed)); store iteration count per ciphertext envelope and drop the legacy fallback.
- **Files**: `backend/src/services/encryption.ts:80`.

### 4.2 `npm run lint` glob may miss nested dirs on some shells

- **Severity**: Low (tooling — informational).
- **Symptom**: `lint` is `eslint src/**/*.ts` (`backend/package.json:10`); unquoted `**` relies on shell globstar. Not a runtime bug; noted for reproducibility.
- **Files**: `backend/package.json:10`.

---

## 5. Deprecated (kept for compat)

There are **no** `@deprecated` / `legacy` markers and **no** deprecated models in the live schema. Grep over `backend/prisma/schema.prisma` for `deprecated|DNAVariant|GeneticTrait|@deprecated|legacy` (case-insensitive) returns **zero** matches. The 18 current models are: `User`, `Session`, `UserEncryptionKey`, `ProviderPatient`, `UserFile`, `Biomarker`, `BiomarkerHistory`, `InsurancePlan`, `InsuranceBenefit`, `HealthNeed`, `HealthGoal`, `GoalProgressHistory`, `AuditLog`, `SystemConfig`, `ExpenseProjection`, `ExpenseActual`, `CostAnalysis`, `LabConnection` (`backend/prisma/schema.prisma:10-716`).

| Item | Status | Note + Source |
|---|---|---|
| `uploadController` (single-file) | **Refactored, not deleted** | Now a barrel re-export of `./upload/index.js`; concrete handlers live in `backend/src/controllers/upload/` (`labUploadController.ts`, `sbcUploadController.ts`, `shared.ts`). Re-export at `backend/src/controllers/index.ts:12`. |
| `KEY_ROTATION` AuditAction enum value | **Retained, unused** | Kept for a future re-encryption job; the helper that used it was removed (`backend/src/services/userEncryption.ts:80`). See [§2.1](#21-no-phi-key-rotation-capability-dead-helper-removed). |

> The memory note "dead code (legacy uploadController, reminderFrequency)" is **stale** — see [Prompt drift log](#prompt-drift-log). `reminderFrequency` is now live (honored by the email scheduler, `backend/src/schedulers/emailScheduler.ts:194`).

---

## 6. Code-marker inventory

Every `TODO|FIXME|HACK|XXX` marker across `backend/src/**` and `src/**`. Reproduce with:

```bash
# Grep tool equivalent — pattern: "TODO|FIXME|HACK|XXX", glob: **/*.{ts,tsx}
# over backend/src and src
```

| Marker | File:line | Context (first ~80 chars) |
|---|---|---|
| TODO | `backend/src/app.ts:130` | `// TODO(csp-nonce): 'unsafe-inline' is required today because Tailwind` |
| TODO | `backend/src/services/encryption.ts:80` | `* TODO(key-rotation): store the iteration count per user (or per-ciphertext` |
| NOTE (ex-TODO) | `backend/src/middleware/csrf.ts:120` | `// NOTE on upload routes: previously CSRF-exempt with a TODO. The` — describes a **removed** TODO; the upload CSRF exemption is resolved (see below). |
| TODO | `src/components/settings/PlanSection.tsx:157` | `// TODO: wire to Stripe checkout when billing goes live.` |

**Total live `TODO`/`FIXME`/`HACK`/`XXX`: 3** (2 backend `TODO`, 1 frontend `TODO`). The `csrf.ts:120` entry is a `NOTE` documenting a TODO that was already resolved — it is not an open marker:

```ts
// Source: backend/src/middleware/csrf.ts:L120-L125
// NOTE on upload routes: previously CSRF-exempt with a TODO. The
// frontend's `services/uploadUtils.ts` reads csrf_token from the cookie
// and attaches it as `X-CSRF-Token` on every upload (verified). The
// exemption is now removed so any new upload path that forgets to pipe
// through uploadUtils will fail closed instead of silently bypassing
// CSRF protection.
```

**File with the most markers**: none has more than one open marker — the three open `TODO`s are spread across `app.ts`, `encryption.ts`, and `PlanSection.tsx`.

---

## 7. Skipped / gated tests

Reproduce with the Grep pattern `\.(skip|todo|skipIf)\(|xit\(` over `backend/src/**` and `e2e/**`.

| Kind | File:line | Detail |
|---|---|---|
| `describe.skipIf` | `backend/src/services/rls.test.ts:29` | Intentional live-DB gate — **not** dead test debt. |

```ts
// Source: backend/src/services/rls.test.ts:L27-L29
const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.PHI_ENCRYPTION_KEY);

describe.skipIf(!hasLiveDb)('RLS tenant isolation (withRLSContext)', () => {
```

- This is the **only** conditional skip in the suite. It runs the full provider-consent RLS matrix only when a live DB + PHI key are configured (e.g. `npm run test:rls`). With no live DB it self-skips by design, so unit CI stays hermetic.
- There are **no** `it.skip`, `xit`, `.todo`, or commented-out test bodies. (The other `\.skip`/`process.exit` hits found by Grep are non-test code: `database.ts:254`, `app.ts:390/398/415/421`, `database.test.ts:212-224` asserting the exit path, and `e2e/setup/seed-test-user.ts:84`.)

---

## 8. Dependency vulnerabilities

Run from the repo root and from `backend/`:

```bash
npm audit            # root: clean
cd backend && npm audit   # 8 moderate (all transitive via uuid / @hono/node-server)
```

### Root (`C:/Users/breil/Projects/OwnMyHealth/`)

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Moderate | 0 |
| Low | 0 |
| **Total** | **0** (558 deps audited) |

### Backend (`backend/`)

| Severity | Count | Notable advisories (status) |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Moderate | **8** | `uuid <11.1.1` (GHSA-w5hq-g745-h8pq — missing buffer bounds check in v3/v5/v6; CVSS 7.5) — transitive via `@google-cloud/storage`. `@hono/node-server <1.19.13` (GHSA-92pp-h63x-v22m — serveStatic middleware bypass via repeated slashes; CVSS 5.3) — transitive via `prisma`/`@prisma/dev` (dev-only). |
| Low | 0 | — |
| **Total** | **8** | 700 deps audited |

**Vulnerable packages** (all transitive, none direct app runtime except `@google-cloud/storage` and `prisma`): `@google-cloud/storage`, `@hono/node-server`, `@prisma/dev`, `gaxios`, `prisma`, `retry-request`, `teeny-request`, `uuid`.

**Remediation plan**:
- The `uuid` chain is fixed by upgrading `@google-cloud/storage` to `5.20.4` — but `npm audit` flags that as a **semver-major** downgrade-style fix (`isSemVerMajor: true`); the project pins `@google-cloud/storage` `^7.19.0` (`backend/package.json:22`). Track upstream for a `7.x` patch rather than auto-applying `npm audit fix --force`.
- The `@hono/node-server` chain is via `@prisma/dev` (a **dev** dependency) and is fixed by `prisma@6.19.3` (also `isSemVerMajor`). The project pins `@prisma/client ^7.7.0` / `prisma` modern (`backend/package.json:24`); downgrading is not desirable. This advisory affects a dev-only static-file server, not production runtime.
- **Status**: accepted moderate risk; no automated `fix --force` (would break major pins). Re-run `npm audit` after each `@google-cloud/storage` / `prisma` bump.

> Note: the acceptance question references "axios / vite advisories" — those are **not** the live advisories. The actual open advisories are `uuid` and `@hono/node-server` (see [Prompt drift log](#prompt-drift-log)). A `vitest` advisory (GHSA-5xrq-8626-4rwp) was already remediated by bumping vitest to `^4.1.0` in commit `5309c4f`.

---

## 9. Missing test coverage

Counts as of `HEAD = 13db267`: 34 backend `*.test.ts` files, 14 frontend `*.{test,spec}.{ts,tsx}` files under `src/` (`git ls-files`; plus 5 Playwright `*.spec.ts` under `e2e/`).

### Controllers

10 non-test controllers exist (excluding `index.ts` barrel and `testHelpers.ts`). Test files exist for: `authController`, `biomarkerController`, `expenseController`, `healthGoalsController`, `healthNeedsController`, `settingsController`.

| Controller | Test file present? | Source |
|---|---|---|
| `authController` | ✅ `authController.test.ts` (+ `.register.test.ts`) | `backend/src/controllers/authController.ts` |
| `biomarkerController` | ✅ `biomarkerController.test.ts` | `backend/src/controllers/biomarkerController.ts` |
| `expenseController` | ✅ `expenseController.test.ts` | `backend/src/controllers/expenseController.ts` |
| `healthGoalsController` | ✅ `healthGoalsController.test.ts` | `backend/src/controllers/healthGoalsController.ts` |
| `healthNeedsController` | ✅ `healthNeedsController.test.ts` | `backend/src/controllers/healthNeedsController.ts` |
| `settingsController` | ✅ `settingsController.test.ts` (+ `.updateProfile.test.ts`) | `backend/src/controllers/settingsController.ts` |
| **`aiChatController`** | ❌ **no test** | `backend/src/controllers/aiChatController.ts` |
| **`fhirController`** | ❌ **no test** | `backend/src/controllers/fhirController.ts` |
| **`fileController`** | ❌ **no test** | `backend/src/controllers/fileController.ts` |
| **`insuranceController`** | ❌ **no test** | `backend/src/controllers/insuranceController.ts` |

> Upload handlers are tested at `backend/src/controllers/upload/shared.test.ts`. The standalone `uploadController.ts` no longer exists (refactored — see [§5](#5-deprecated-kept-for-compat)).

### Routes

17 non-test route files (`backend/src/routes/*.ts`, excluding `index.ts`). 4 distinct route files have dedicated route-level tests — across 5 test files: `adminRoutes.demoProtection`, `adminRoutes.updateUser` (both cover `adminRoutes`), `biomarkerRoutes.guidance`, `internalRoutes`, `providerRoutes.requestUniformity`. The remaining 13 route files have no route-level test.

| Area | Pattern | Exists? | Gap |
|---|---|---|---|
| Controllers | `backend/src/controllers/*.test.ts` | partial | 4 untested: `aiChatController`, `fhirController`, `fileController`, `insuranceController` |
| Routes | `backend/src/routes/*.test.ts` | partial | 13 of 17 route files have no dedicated route-level test (4 tested across 5 test files) |
| FHIR services | `backend/src/services/fhir/*.test.ts` | partial | only `urlSafety.test.ts`; `labSyncService`, `smartAuth`, `fhirClient`, `loincMapper` untested ([§3.3](#33-fhir--quest-smart-on-fhir-subsystem-has-thin-test-coverage)) |
| Onboarding | `backend/src/services/onboardingService.test.ts` | ❌ | `onboardingService.ts` has no test |
| Usage tracking | `backend/src/services/usageTracker.test.ts` | ❌ | `usageTracker.ts` has no test (`aiCostTracker.test.ts` exists) |

See [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) for how to close these gaps (colocated `*.test.ts` convention; `vitest run`).

---

## 10. Fixed issues reference

Recently closed items (from `git log`, most recent first). Several introduced or revealed new known risk — see the "New risk?" column.

| Issue / change | Closing commit (PR) | New risk introduced? |
|---|---|---|
| One-time-token confirmation fired twice | `13db267` (#134) | No |
| Email-change flow (request → confirm) | `ca0024b` (#133) | No |
| `pdfReportGenerator` was untested | `f85e515` / #132 | No (closed a coverage gap) |
| `vitest` advisory GHSA-5xrq-8626-4rwp | `5309c4f` | No (bumped vitest `^4.1.0`) |
| **Role-guard restricted pages + drop dead key-rotation helper** | `79c532c` (#131) | **Yes** — removing `rotateUserEncryptionKey()` means there is now **no** key-rotation capability at all (see [§2.1](#21-no-phi-key-rotation-capability-dead-helper-removed)). Deliberate (the helper was a footgun), but it is a known gap. |
| Full provider-consent RLS test matrix | `6bf51b4` (#130) | No |
| Provider + admin UI built (was backend-only) | `fa7c50c` (#128), `7764e79`, `cdd2156` | No |
| Goal `reminderFrequency` honored by scheduler | `a22bb63` | No (turned former dead field live) |
| P1–P5 high-severity security gaps (legacy signed-URL egress, logout no-op, PDF DoS, audit fail-closed, expenses envelope) + delete stray `nul` / `scratchpad.md.md` | `d36f051` | No (and resolved the OneDrive `nul` file — see Q9) |
| Quest SMART-on-FHIR integration | `63dd1d8` (#71) | Yes — shipped with thin test coverage ([§3.3](#33-fhir--quest-smart-on-fhir-subsystem-has-thin-test-coverage)) |

> The `nul` stray file (OneDrive artifact noted in project memory) was **deleted** in `d36f051` and is **not** in the tree today: `git ls-files | grep -i nul` returns nothing.

The DNA/Genetics models (`DNAVariant`/`GeneticTrait`) were **removed entirely** in migration `backend/prisma/migrations/20260423_drop_dna_genetics/migration.sql` — this is a **resolved removal**, not a live deprecation. The migration also dropped the `can_view_dna` column on `provider_patients` and the `ProcessingStatus`/`RiskLevel` enums:

```sql
-- Source: backend/prisma/migrations/20260423_drop_dna_genetics/migration.sql:L22-L32
DROP TABLE IF EXISTS "genetic_traits" CASCADE;
DROP TABLE IF EXISTS "dna_variants" CASCADE;
DROP TABLE IF EXISTS "dna_data" CASCADE;
ALTER TABLE "provider_patients" DROP COLUMN IF EXISTS "can_view_dna";
DROP TYPE IF EXISTS "ProcessingStatus";
DROP TYPE IF EXISTS "RiskLevel";
```

---

## Acceptance questions (self-answered from this doc)

1. **Most important open Critical issue?** RLS policies inert at runtime in dev/staging (C-8) — production now hard-blocks via `assertNoBypassRLS()` (`backend/src/services/database.ts:248`). See [§1.1](#11-rls-policies-inert-at-runtime-in-devstaging-c-8).
2. **How many TODO/FIXME/HACK markers, and which file has the most?** 3 open `TODO`s (no FIXME/HACK/XXX); no file has more than one — they are in `app.ts:130`, `encryption.ts:80`, `PlanSection.tsx:157`. The `csrf.ts:120` entry is a NOTE about a *resolved* TODO. See [§6](#6-code-marker-inventory).
3. **Any skipped or `.todo` tests?** One conditional skip: `describe.skipIf(!hasLiveDb)` at `backend/src/services/rls.test.ts:29` (intentional live-DB gate). No `it.skip`/`xit`/`.todo`. See [§7](#7-skipped--gated-tests).
4. **`npm audit` severity breakdown?** Root: 0. Backend: 8 moderate (0 critical/high/low). See [§8](#8-dependency-vulnerabilities).
5. **Deprecated models remaining, and is DNA/Genetics removal recorded as resolved?** No deprecated models remain (18 live models, zero `@deprecated`/`DNAVariant`/`GeneticTrait` hits). DNA/Genetics removal via `20260423_drop_dna_genetics` is recorded as **resolved**. See [§5](#5-deprecated-kept-for-compat) and [§10](#10-fixed-issues-reference).
6. **Controllers with no test coverage?** `aiChatController`, `fhirController`, `fileController`, `insuranceController`. See [§9](#9-missing-test-coverage).
7. **Workaround for the RLS runtime gap (C-8)?** None at the dev/staging runtime layer; rely on app-layer `userId` filtering + RBAC; treat `withRLSContext` as advisory until the `omh_app` cutover. Production refuses to boot if the role has `BYPASSRLS`. See [§1.1](#11-rls-policies-inert-at-runtime-in-devstaging-c-8).
8. **Which recently closed issue introduced new known risk?** PR #131 (`79c532c`) — removing the dead `rotateUserEncryptionKey()` left **no** key-rotation capability. (Secondary: Quest FHIR `#71` shipped with thin tests.) See [§10](#10-fixed-issues-reference) and [§2.1](#21-no-phi-key-rotation-capability-dead-helper-removed).
9. **Is the `nul` stray file still in the tree?** No — deleted in `d36f051`; `git ls-files | grep -i nul` returns nothing. See [§10](#10-fixed-issues-reference).
10. **Which axios/vite advisories are open, and the remediation plan?** None — there are no open axios or vite advisories. The live moderate advisories are `uuid <11.1.1` and `@hono/node-server <1.19.13`; remediation is to track upstream `@google-cloud/storage`/`prisma` bumps rather than force semver-major fixes. The earlier `vitest` advisory was already fixed (`5309c4f`). See [§8](#8-dependency-vulnerabilities) and [Prompt drift log](#prompt-drift-log).

---

## Related Documents

- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — authoritative source for open security findings (C-8, #37, #38); this ledger mirrors and points to it.
- [CHANGELOG.md](./CHANGELOG.md) — recently closed items and their PRs (mirrored in [§10](#10-fixed-issues-reference)).
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — symptom → root cause for live bugs.
- [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) — how to close the missing-test gaps; the `test:unit`/`test:integration` zero-test trap.
- [DATA_MODEL.md](./DATA_MODEL.md) — the 18 live models, the DNA/Genetics removal, `LabConnection` token fields.
- [ENV_VARS.md](./ENV_VARS.md) — `AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD`, `QUEST_FHIR_CLIENT_ID` and other consumers referenced here.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — PHI field × encryption coverage, including `LabConnection` OAuth tokens.

---

## Prompt drift log

- **`20-known-issues-doc.md` acceptance Q10 references "axios / vite advisories"** — neither is a live advisory at `HEAD = 13db267`. Actual open advisories are `uuid <11.1.1` (GHSA-w5hq-g745-h8pq) and `@hono/node-server <1.19.13` (GHSA-92pp-h63x-v22m), both backend-only and transitive (`backend` `npm audit`). The `vitest` advisory GHSA-5xrq-8626-4rwp was already remediated in commit `5309c4f`. Prompt author should refresh the example advisories.
- **Memory `ownmyhealth-feature-map.md` lists "dead code (legacy uploadController, reminderFrequency)"** — both are stale. `reminderFrequency` is now live (honored by `backend/src/schedulers/emailScheduler.ts:194`, wired in commit `a22bb63`). The single-file `uploadController.ts` was refactored into `backend/src/controllers/upload/` (re-exported at `backend/src/controllers/index.ts:12`), not left as dead code.
- **Prompt §Required-artifacts says "the `csrf.ts:120` NOTE describing a *removed* TODO; the upload-route CSRF-exempt TODO is already resolved"** — confirmed accurate. The note documents a resolved exemption (`backend/src/middleware/csrf.ts:L120-L125`); recorded as a NOTE, not an open marker, in [§6](#6-code-marker-inventory).
- **Prompt §Required-sections C-8 framing says "app runs as BYPASSRLS role in dev+prod"** — partially outdated. Production now **hard-exits** if the role has `BYPASSRLS` (`backend/src/services/database.ts:248-255`); only dev/staging warn-and-continue. Documented per the live code in [§1.1](#11-rls-policies-inert-at-runtime-in-devstaging-c-8).
- **`SECURITY_STATUS.md` now exists** in `New Project Documents/` (a sibling generated in this same batch); cross-links to it resolve. The `Security Reviews/` subfolder is still empty (no per-review artifacts yet) — the authoritative findings live in `SECURITY_STATUS.md` itself.
