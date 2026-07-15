---
tags:
  - documentation
  - testing
  - engineering
  - reference
type: prompt
priority: 2
updated: 2026-06-16
---

# Generate TESTING_PATTERNS.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — tests that touch PHI must respect encryption + audit contracts.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/TESTING_PATTERNS.md` — the **how-to-write-a-test** reference. A dev adding a new controller / route / service / middleware / e2e test must be able to copy the closest real pattern without re-reading the whole test tree.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/vitest.config.ts` + `backend/vitest.config.ci.ts` + `backend/src/testSetup.ts` | Backend test runner config (Vitest, `node` env) and the setup file that seeds NODE_ENV + required secrets so `config/index.ts` doesn't throw in CI. |
| `vitest.config.ts`, `src/__tests__/` (incl. `src/__tests__/setup.ts`) | Frontend test runner (Vitest, `jsdom` env) + existing unit tests. Note: frontend tests live under `src/__tests__/`, NOT colocated. |
| `playwright.config.ts`, `e2e/*.spec.ts`, `e2e/setup/seed-test-user.ts`, `e2e/helpers/{auth,testData}.ts` | E2E setup, seeded test user, helpers. |
| `backend/src/controllers/*.test.ts` (representative samples) | Controller test recipe (colocated `*.test.ts`). |
| `backend/src/controllers/testHelpers.ts` | Shared controller-test factory module (NOT a `*.test.ts`): `createMockRequest`, `createMockResponse`, `createMockPrismaTransaction`, `createMockAuditService`, `createMockEncryptionService`. Reuse these — don't reinvent. |
| `backend/src/services/*.test.ts` (e.g., `encryption.test.ts`, `authService.test.ts`, `aiCostTracker.test.ts`, `pdfTextExtraction.test.ts`, `claudeExtraction.test.ts`, `sbcExtraction.test.ts`, `database.test.ts`, plus the post-06-01 suites `biomarkerSeries.test.ts` (biomarker time-series merge — the headline fix), `biomarkerConsolidation.test.ts`, `usageTracker.test.ts` (plan-usage counting), `goalValueBackfill.test.ts`, `providerAccess.test.ts` (the `resolveProviderAccess` choke point), `phiFieldsCoverage.test.ts` (schema↔PHI_FIELDS guard), `fhir/labSyncService.sync.test.ts` (FHIR sync idempotency)) | Service recipe. |
| `backend/src/services/rls.test.ts` | Live-DB RLS tenant-isolation regression test (skip-if-no-DB via `describe.skipIf`). |
| `backend/src/services/fhir/urlSafety.test.ts` | SSRF-guard unit test for the Quest FHIR domain. |
| `backend/src/middleware/*.test.ts` (`errorHandler.test.ts`, `validation.test.ts`, `validation.healthNeed.test.ts`, `csrf.test.ts`, `rateLimitStore.test.ts`, `planGating.test.ts` (plan-tier limit enforcement), `aiSpendGuard.test.ts` (AI dollar spend cap / 503 fail-closed)) | Middleware recipe. There is no `rbac.test.ts` — the rbac parallel-authz cluster + its tests were removed (L-26). |
| `backend/src/routes/*.test.ts` (`adminRoutes.demoProtection.test.ts`, `adminRoutes.updateUser.test.ts`, `biomarkerRoutes.guidance.test.ts`, `internalRoutes.test.ts`, `providerRoutes.requestUniformity.test.ts`) | Route-level integration recipe (supertest against a minimal Express app). |
| `backend/src/utils/*.test.ts` (`logger.test.ts`, `phiRedaction.test.ts`) + `backend/src/schedulers/emailScheduler.test.ts` + `backend/src/config/index.test.ts` | Util/scheduler/config recipes. |
| `backend/src/services/database.ts` | RLS wrappers (`withRLSContext`, `withRLSTransaction`) that test helpers must integrate with. |

---

## Required sections

1. **Test pyramid** — unit vs integration vs e2e, counts, runtimes, what each catches. As of 2026-06-16: 54 backend `*.test.ts` (colocated), 25 frontend tests under `src/__tests__/`, 5 Playwright e2e specs. Note the live-DB integration tests (`rls.test.ts`) skip when `DATABASE_URL`/`PHI_ENCRYPTION_KEY` are absent.
2. **Runners + commands** — exact `npm run` commands per scope. Backend: `test` (runs the full colocated suite), `test:watch`, `test:coverage`, `test:ci` (uses `vitest.config.ci.ts`; the real CI command — runs every colocated `*.test.ts` except `rls.test.ts`), `test:unit`, `test:integration`, `test:rls`. NOTE: `test:unit` (`src/__tests__/unit`) and `test:integration` (`src/__tests__/integration`) point at directories that do NOT exist today, so they run zero tests — the way to run the backend unit suite is `test` or `test:ci`, not `test:unit` (see the comment block in `vitest.config.ci.ts`). Root/frontend: `test`, `test:watch`, `test:coverage`, `test:ui`, `test:e2e` (runs `test:e2e:setup` seed first), `test:e2e:ui`, `test:e2e:install`.
3. **Backend unit test recipe** — service functions.
4. **Controller test recipe** — full example copy (uses `testHelpers.ts` factories + hoisted `vi.mock`).
5. **Route (integration) test recipe** — full example copy (supertest against a minimal Express app).
6. **Middleware test recipe** — full example copy (`validation`, `csrf`, `errorHandler`, `rateLimitStore`, plus the two highest-value post-06-01 recipes `planGating.test.ts` (plan-tier limit enforcement) and `aiSpendGuard.test.ts` (AI dollar spend cap / 503 fail-closed)). Do NOT use `rbac` as an exemplar — `rbac.test.ts` was removed (L-26).
7. **Service test recipe (RLS-aware)** — how to test `withRLSContext` + `withRLSTransaction`, including cross-user isolation tests; note the `describe.skipIf(!hasLiveDb)` gate.
8. **Frontend unit test recipe** — Vitest (`jsdom`) + React Testing Library; tests live under `src/__tests__/`.
9. **E2E test recipe** — Playwright spec + seeded test user helper (`e2e/setup/seed-test-user.ts`, `e2e/helpers/auth.ts`).
10. **Mock catalog** — inline `vi.mock`/`vi.hoisted` + `testHelpers.ts` factories for Prisma/audit/encryption; Anthropic / SendGrid / GCS / Document AI mocked inline (no `__mocks__/` dirs).
11. **Security-domain test recipes** — FHIR SSRF guard (`fhir/urlSafety.test.ts`), AI cost/budget (`aiCostTracker.test.ts`), PHI redaction (`utils/phiRedaction.test.ts`), provider-access uniformity (`providerRoutes.requestUniformity.test.ts`), internal/cron endpoints (`internalRoutes.test.ts`), plus the post-06-01 security suites: AI spend-cap 503 fail-closed (`middleware/aiSpendGuard.test.ts`), plan-limit enforcement (`middleware/planGating.test.ts`), the `resolveProviderAccess` choke point (`services/providerAccess.test.ts`), the schema↔PHI_FIELDS guard (`services/phiFieldsCoverage.test.ts`), server-side AI-disclaimer enforcement (`utils/aiDisclaimer.test.ts`), filename PHI encrypt/decrypt (`utils/userFileNames.test.ts`), and FHIR sync idempotency (`services/fhir/labSyncService.sync.test.ts`).
12. **Fixture + factory conventions** — how to seed users, biomarkers, insurance plans, etc. (via `testHelpers.ts` + the e2e seed script).
13. **PHI-aware test conventions** — never print decrypted PHI, always use real encryption path. Cite `services/phiFieldsCoverage.test.ts` as the canonical example: it is the automated guard that enforces every schema `*Encrypted` column is in `PHI_FIELDS` and vice versa (added after the L24 filename-encryption, M4 goal-value, and M6 audit-metadata PHI work — `PHI_FIELDS` now covers `UserFile.originalFilenameEncrypted`, `HealthGoal.current/start/targetValueEncrypted`, `GoalProgressHistory.valueEncrypted`, `AuditLog.metadataEncrypted`; `encryption.ts:499-530`).
14. **Bad vs good examples** — two pairs per test type.
15. **Related Documents**.
16. **Prompt drift log**.

---

## Required artifacts

### Full real-test copies (one per category)

For each of: controller, route, service, middleware, frontend component, e2e — quote a **complete** real test file from the repo with its full source-line range. Do not paraphrase; do not truncate past a single `describe` block. If a real test is too long, quote one full `it()` with setup/teardown.

Template per copy:

````markdown
### Controller test recipe

**Reference**: `backend/src/controllers/biomarkerController.test.ts:L1-L60`

```ts
// Source: backend/src/controllers/biomarkerController.test.ts:L1-L60
import { describe, it, expect, beforeEach } from 'vitest';
import { biomarkerController } from './biomarkerController';
// ... (full first describe block, verbatim)
```

What this covers:
- Mocks `withRLSContext` to inject a fake tx.
- Asserts response shape and that `auditLog.log` was called with the right action.
- Verifies error path (throws `AppError('NOT_FOUND', ...)`).

When to copy this pattern: any new controller function.
````

### RLS-aware test helper recipe

There is **no** `asUser`/`asAdmin` wrapper helper in the repo today. The real RLS test
(`backend/src/services/rls.test.ts`) calls `withRLSContext(userId, fn)` and
`withRLSContext(null, fn)` (admin context) directly, and the whole suite is gated behind
`describe.skipIf(!hasLiveDb)` because it requires a live Postgres with migration
`20260107_add_rls_policies` applied (it reads `DATABASE_URL` + `PHI_ENCRYPTION_KEY`). Quote
the real pattern verbatim from that file; if you also want a thin convenience wrapper, label
it explicitly as proposed:

```ts
// Real pattern — backend/src/services/rls.test.ts
import { withRLSContext } from './database.js';

// Seed via admin context so both tenants' rows can be inserted:
await withRLSContext(null, async (tx) => {
  await tx.user.create({ data: { id: userA.id, email: userA.email, passwordHash: '...' } });
  await tx.biomarker.create({ data: { userId: userA.id, valueEncrypted: 'ct-a', /* ... */ } });
});

// Proposed (does NOT exist yet) — a thin wrapper aligned with database.ts:
export async function asUser<T>(userId: string, fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return withRLSContext(userId, fn);
}
```

Cross-user isolation pattern (modeled on the real `rls.test.ts` — queries intentionally OMIT
a `where: { userId }` filter so a leak would surface if RLS were off):

```ts
it('prevents cross-user biomarker read via RLS', async () => {
  // Queries run as userB but omit any userId filter; RLS must scope them to userB only.
  const rowsAsB = await withRLSContext(userB.id, (tx) =>
    tx.biomarker.findMany({ where: { name: '__RLS_TEST_A__' } }),
  );
  expect(rowsAsB).toHaveLength(0); // RLS blocks userA's row
});
```

### Mock catalog

There are **no `__mocks__/` directories** in the repo. Backend tests mock dependencies two ways:
(1) inline `vi.mock('../services/...')` factory calls declared BEFORE the module-under-test
import (often hoisted via `vi.hoisted()` so the same handle is shared across describe blocks —
see `biomarkerController.test.ts`), and (2) the reusable factory functions exported from
`backend/src/controllers/testHelpers.ts`. Document the real pattern; only propose a `__mocks__/`
recipe if you explicitly label it as not-yet-present.

| Dependency | Real source | How to use |
|---|---|---|
| Prisma tx | `createMockPrismaTransaction()` in `controllers/testHelpers.ts` | Returns a mock tx exposing the full method set `findMany/findFirst/findUnique/create/createMany/update/updateMany/delete/deleteMany/count` (`testHelpers.ts:50-59`) on every model the controllers touch (User, Biomarker, InsurancePlan, InsuranceBenefit, LabConnection, etc.). Inject via the `withRLSContext`/`withRLSTransaction` mock. Note: it also defines a stale `conversationHistory` model spy (`testHelpers.ts:79`) for which no `ConversationHistory` model exists in `schema.prisma` — harmless dead helper state, not a model to test against. |
| Audit log | `createMockAuditService()` in `controllers/testHelpers.ts` | Spies for `logAccess/logCreate/logUpdate/logDelete/logAuth/logExport/logSystem`. Assert the right method/action was called. |
| Encryption | `createMockEncryptionService()` in `controllers/testHelpers.ts` | Deterministic `encrypt`→`enc:<value>` / `decrypt` reverse (+ master-key + salt variants); assert that values were encrypted before persistence. |
| Anthropic client | inline `vi.mock` of `services/anthropicClient` / `aiChatController` deps (e.g. `messagesCreate` spy in `biomarkerController.test.ts`); see also `claudeExtraction.test.ts`, `sbcExtraction.test.ts` | Return canned `messages.create` JSON per input type. The guidance route now uses the shared `anthropicClient` SDK, not raw `fetch`. |
| SendGrid | inline `vi.mock('@sendgrid/mail')` / `services/emailService` (see `schedulers/emailScheduler.test.ts`) | No-op send; assert on the send spy. |
| GCS / Document AI OCR | inline `vi.mock` of `services/storageService` / `services/ocrService` | In-memory buffer return / fixed OCR text per fixture. |
| FHIR SSRF guard | real (no mock) — `services/fhir/urlSafety.test.ts` | Asserts that disallowed hosts/IPs are rejected before any outbound request. |
| AI cost/spend | real (no mock) — `services/aiCostTracker.test.ts` | Asserts per-day / per-user budget accounting used by `aiSpendGuard`. |

### Bad vs good table

| Category | Bad pattern | Good pattern |
|---|---|---|
| Controller test | Hand-rolls a bespoke Prisma stub per test | Uses `createMockPrismaTransaction()` from `controllers/testHelpers.ts`; mocks `withRLSContext`/`withRLSTransaction` to inject it; asserts on tx-level spies |
| Route test | Issues raw SQL to set up state | supertest against a minimal Express app + the shared mock factories (see `biomarkerRoutes.guidance.test.ts`) |
| Service test | Stubs encryption to return plaintext | Uses the real encryption path with a test `PHI_ENCRYPTION_KEY` (see `encryption.test.ts`) |
| RLS test | Adds a `where: { userId }` filter that hides whether RLS works | Omits the filter and gates on `describe.skipIf(!hasLiveDb)` against a live DB (see `rls.test.ts`) |
| E2E | Hardcodes test user creds inline | Imports `TEST_USER`/`loginAsTestUser` from `e2e/helpers/auth.ts`, seeds via `e2e/setup/seed-test-user.ts` (run by `npm run test:e2e`) |

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. What runner runs backend unit tests? Frontend? E2E?
2. What's the exact npm script that actually runs the backend unit suite (`test` / `test:ci` — NOT `test:unit`, which targets a nonexistent dir)?
3. How do you write a controller test that respects RLS?
4. How do you mock the Anthropic client in a service test?
5. Where is the seed-test-user helper for Playwright specs?
6. What does the `asUser` helper do, and how does it differ from calling Prisma directly?
7. How many e2e spec files exist (5) and what do they cover (auth, biomarker-entry, data-export, health-guide, settings)?
8. What's the factory for building a mock Prisma tx in controller tests (`createMockPrismaTransaction()` in `testHelpers.ts`)?
9. Is there an RLS-isolation test that proves user B cannot read user A's data, and what gates it from running in unit-only CI?
10. What's the pattern for asserting that the audit service (`createMockAuditService()`) was called with the right method in a controller test?
11. How should a test handle encrypted PHI fields when asserting equality?
12. What frontend component(s) have test coverage, and where do those tests live (`src/__tests__/`)?
13. How is the Quest FHIR SSRF guard tested, and which file?
14. How is AI cost/budget accounting tested, and which file?
15. What setup file seeds NODE_ENV + secrets before backend tests import config (`backend/src/testSetup.ts`)?

---

## No-TBD enforcement

Before marking anything TBD:

- **Runner**: read `backend/vitest.config.ts` (Vitest, `node` env, setup `src/testSetup.ts`), `backend/vitest.config.ci.ts`, and root `vitest.config.ts` (Vitest, `jsdom` env, setup `src/__tests__/setup.ts`). There is no Jest in this repo.
- **Test counts**: `Glob pattern: "backend/src/**/*.test.ts"` (currently 54 files, colocated), `Glob pattern: "src/__tests__/**/*.test.{ts,tsx}"` (currently 25 files), `Glob pattern: "e2e/*.spec.ts"` (currently 5 specs). Re-glob for exact numbers.
- **Helpers**: read `backend/src/controllers/testHelpers.ts` (the shared factory module) and `e2e/helpers/{auth,testData}.ts`. There are no `fixtures/`, `factories/`, or `__mocks__/` source directories — `e2e/fixtures/` holds only a README.
- **RLS test**: read `backend/src/services/rls.test.ts` (gated by `describe.skipIf(!hasLiveDb)`).
- **Mock recipes**: there are no `__mocks__/` dirs; read the inline `vi.mock`/`vi.hoisted` usage in `backend/src/controllers/biomarkerController.test.ts` and the factories in `testHelpers.ts`.
- **Seed helpers**: read `e2e/setup/seed-test-user.ts` (idempotent; run by the `test:e2e` script via `test:e2e:setup`).

If a category has no existing tests in the repo, explicitly state "no existing example — recipe below is proposed and aligns with `<similar pattern>`" and proceed.

---

## Cross-links

The generated `TESTING_PATTERNS.md` must link to:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the layers being tested.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — tables used by factories.
- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — middleware chains routed tests must exercise.
- [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) — error paths worth asserting.
- [`LOCAL_DEV.md`](./LOCAL_DEV.md) — how to run the suites locally.
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) — missing-test gaps to prioritize.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Count backend tests | Glob | `pattern: "backend/src/**/*.test.ts"` |
| Count frontend tests | Glob | `pattern: "src/__tests__/**/*.test.{ts,tsx}"` |
| Count e2e specs | Glob | `pattern: "e2e/*.spec.ts"` |
| Find test helpers | Read | `backend/src/controllers/testHelpers.ts`, `e2e/helpers/{auth,testData}.ts` (no `factories/`/`__mocks__/` dirs exist) |
| Read runner config | Read | `backend/vitest.config.ts`, `backend/vitest.config.ci.ts`, `backend/src/testSetup.ts`, `vitest.config.ts`, `src/__tests__/setup.ts`, `playwright.config.ts` |
| Find RLS tests | Read | `backend/src/services/rls.test.ts` (or `Grep pattern: "withRLSContext"` over `backend/src/**`) |
| Find npm test scripts | Read | `backend/package.json` (`test`, `test:ci`, `test:unit`, `test:integration`, `test:rls`) + root `package.json` (`test`, `test:coverage`, `test:e2e`, `test:e2e:setup`, `test:e2e:ui`) |

---

## Output: file and location

Write the final document to `New Project Documents/TESTING_PATTERNS.md`.
