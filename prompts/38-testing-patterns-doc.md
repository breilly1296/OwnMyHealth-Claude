---
tags:
  - documentation
  - testing
  - engineering
  - reference
type: prompt
priority: 2
updated: 2026-04-24
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
| `backend/vitest.config.ts` (or equivalent) / `backend/jest.config.*` | Backend test runner config. |
| `vitest.config.ts`, `src/__tests__/` | Frontend test runner + existing unit tests. |
| `playwright.config.ts`, `e2e/*.spec.ts`, `e2e/setup/*`, `e2e/helpers/*` | E2E setup, fixtures, helpers. |
| `backend/src/controllers/*.test.ts` (representative samples) | Controller test recipe. |
| `backend/src/services/*.test.ts` (e.g., `encryption.test.ts`, `authService.test.ts`, `rls.test.ts`) | Service recipe + RLS-aware helper. |
| `backend/src/middleware/*.test.ts` (`errorHandler.test.ts`, `rbac.test.ts`, `validation.test.ts`) | Middleware recipe. |
| `backend/src/routes/*.test.ts` (`adminRoutes.demoProtection.test.ts`, `biomarkerRoutes.guidance.test.ts`) | Route-level integration recipe. |
| Any `testHelpers/`, `fixtures/`, `factories/`, `mocks/` dirs | Existing shared helpers — reuse, don't reinvent. |
| `backend/src/services/database.ts` | RLS wrappers that test helpers must integrate with. |

---

## Required sections

1. **Test pyramid** — unit vs integration vs e2e, counts, runtimes, what each catches.
2. **Runners + commands** — exact `npm run` commands per scope.
3. **Backend unit test recipe** — service functions.
4. **Controller test recipe** — full example copy.
5. **Route (integration) test recipe** — full example copy (supertest + in-memory DB or test schema).
6. **Middleware test recipe** — full example copy.
7. **Service test recipe (RLS-aware)** — how to test `withRLSContext` + `withRLSTransaction`, including cross-user isolation tests.
8. **Frontend unit test recipe** — Vitest + React Testing Library.
9. **E2E test recipe** — Playwright spec + seeded test user helper.
10. **Mock catalog** — Anthropic / SendGrid / GCS / Google Document AI mocks (file:line or recipe).
11. **Fixture + factory conventions** — how to seed users, biomarkers, insurance plans, etc.
12. **PHI-aware test conventions** — never print decrypted PHI, always use real encryption path.
13. **Bad vs good examples** — two pairs per test type.
14. **Related Documents**.
15. **Prompt drift log**.

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

Quote the real helper (if one exists in `rls.test.ts` or `testHelpers/`), or design one aligned with `database.ts`:

```ts
// Source (or proposed): backend/src/services/__tests__/rlsHelpers.ts
export async function asUser<T>(userId: string, fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return withRLSContext(userId, fn);
}
export async function asAdmin<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return withRLSContext(null, fn);
}
```

Cross-user isolation pattern:

```ts
it('prevents cross-user biomarker read via RLS', async () => {
  const alice = await seedUser();
  const bob = await seedUser();
  const row = await asUser(alice.id, (tx) => tx.biomarker.create({ data: {...} }));
  const leaked = await asUser(bob.id, (tx) => tx.biomarker.findUnique({ where: { id: row.id } }));
  expect(leaked).toBeNull();  // RLS blocks the read
});
```

### Mock catalog

| Mock | File (if exists) | How to use |
|---|---|---|
| Anthropic client | `backend/src/services/__mocks__/anthropic.ts` (check; if missing, write the pattern) | Return canned extraction JSON per input type |
| SendGrid | `backend/src/services/__mocks__/emailService.ts` | No-op send; expose spy on `sentMessages` |
| GCS | `backend/src/services/__mocks__/storageService.ts` | In-memory Map from path to Buffer |
| Google Document AI | `backend/src/services/__mocks__/ocrService.ts` | Return fixed OCR text per fixture |

### Bad vs good table

| Category | Bad pattern | Good pattern |
|---|---|---|
| Controller test | Mocks Prisma directly, misses RLS | Uses `asUser` helper; asserts on tx-level |
| Route test | Issues raw SQL to set up state | Uses factory + RLS wrapper |
| Service test | Stubs encryption to return plaintext | Uses real `encryptPHI` with a test key |
| E2E | Hardcodes test user creds | Uses `e2e/setup/seed-test-user.ts` helper |

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. What runner runs backend unit tests? Frontend? E2E?
2. What's the exact npm script for running only backend unit tests?
3. How do you write a controller test that respects RLS?
4. How do you mock the Anthropic client in a service test?
5. Where is the seed-test-user helper for Playwright specs?
6. What does the `asUser` helper do, and how does it differ from calling Prisma directly?
7. How many e2e spec files exist? What do they cover?
8. What's the factory for creating a `Biomarker` in tests?
9. Is there an RLS-isolation test that proves Alice cannot read Bob's data?
10. What's the pattern for asserting that an `auditLog.log(...)` was emitted in a controller test?
11. How should a test handle encrypted PHI fields when asserting equality?
12. What frontend component(s) have the most test coverage, and what pattern do they use?

---

## No-TBD enforcement

Before marking anything TBD:

- **Runner**: read `backend/vitest.config.ts` (or `jest.config.*`) and root `vitest.config.ts`.
- **Test counts**: `Glob pattern: "backend/src/**/*.test.ts"`, `Glob pattern: "src/**/*.test.{ts,tsx}"`, `Glob pattern: "e2e/*.spec.ts"`. Exact numbers.
- **Helpers**: `Glob pattern: "**/testHelpers/**"`, `**/fixtures/**`, `**/factories/**`, `**/__mocks__/**`.
- **RLS test**: `Grep pattern: "rls.test"` + read `backend/src/services/rls.test.ts` if present.
- **Mock recipes**: read any `__mocks__/` dir next to services.
- **Seed helpers**: `Glob pattern: "e2e/setup/*"` and `backend/scripts/seed*`.

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
| Count frontend tests | Glob | `pattern: "src/**/*.test.{ts,tsx}"` |
| Count e2e specs | Glob | `pattern: "e2e/*.spec.ts"` |
| Find test helpers | Glob | `pattern: "**/{testHelpers,fixtures,factories,__mocks__}/**"` |
| Read runner config | Read | `backend/vitest.config.ts`, `vitest.config.ts`, `playwright.config.ts` |
| Find RLS tests | Grep | `pattern: "withRLSContext.*test|asUser\\("` over `backend/src/**` |

---

## Output: file and location

Write the final document to `New Project Documents/TESTING_PATTERNS.md`.
