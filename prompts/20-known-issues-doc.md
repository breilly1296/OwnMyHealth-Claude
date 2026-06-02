---
tags:
  - documentation
  - bugs
type: prompt
priority: 2
updated: 2026-06-01
---

# Generate KNOWN_ISSUES.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/KNOWN_ISSUES.md` — the **bug and tech-debt ledger**. Every TODO, FIXME, HACK marker in code becomes a tracked row. Every open security finding from `SECURITY_STATUS.md` is mirrored with a pointer. A Claude Project reader should be able to answer: "is this a known issue? what's the workaround? where's the fix tracked?"

---

## Files to review

| File | Why read it |
|---|---|
| All of `backend/src/**` and `src/**` | Grep `TODO|FIXME|HACK|XXX` markers. |
| `backend/src/**/*.test.ts` | Look for `.skip(`, `.todo(`, `xit(`, `.skipIf(`, commented-out tests. |
| Newer subsystems (untested surfaces): `backend/src/controllers/aiChatController.ts`, `backend/src/controllers/fhirController.ts`, `backend/src/services/fhir/**` (Quest SMART-on-FHIR OAuth, `labSyncService`, `loincMapper`, `urlSafety` SSRF guard), AI cost control (`aiCostTracker`, `aiSpendGuard`, `usageTracker`, `anthropicClient`), `onboardingService`, `planGating`/`config/plans.ts`. | These shipped after the prompt era and have thin/no test coverage — surface their known gaps and risks (e.g., encrypted OAuth token storage on `LabConnection`, AI budget enforcement). |
| `package.json` audit outputs (or run `npm audit --json`) | Open vulnerabilities with severity. |
| `backend/prisma/schema.prisma` | Deprecated/dropped models. Note: DNAVariant/GeneticTrait were REMOVED in migration `20260423_drop_dna_genetics` — do not list them as "still present"; confirm no resurrected deprecated models remain (18 models as of HEAD). |
| `New Project Documents/SECURITY_STATUS.md`, `SECURITY_AUDIT_*.md` | Open findings to mirror. |
| Git log `git log --grep='revert\|hotfix'` | Reverts often leave scars — symptoms worth tracking. |

---

## Required sections

1. **Critical** — blocks core functionality or PHI isolation. C-8 (runtime BYPASSRLS) lives here.
2. **High** — significant feature broken / before beta.
3. **Medium** — usability / during beta.
4. **Low** — minor annoyance / backlog.
5. **Deprecated (kept for compat)** — models, endpoints, components marked deprecated but still present. (DNAVariant/GeneticTrait are NOT here — they were dropped entirely in migration `20260423_drop_dna_genetics`; record that as a *resolved* removal, not a live deprecation.)
6. **Code-marker inventory** — table: every `TODO|FIXME|HACK|XXX` with file:line + context one-liner.
7. **Skipped / TODO tests** — table: every `.skip|.todo|xit` occurrence with file:line.
8. **Dependency vulnerabilities** — `npm audit` summary + per-severity count + notable advisories with status.
9. **Missing test coverage** — areas with zero tests (controllers, routes) as noted in `TESTING_PATTERNS.md`.
10. **Fixed issues reference** — table of recently closed issues with closing PR.
11. **Related Documents**.
12. **Prompt drift log**.

---

## Required artifacts

### Issue row template

```markdown
### RLS policies inert at runtime (C-8)
- **Severity**: Critical
- **Symptom**: PostgreSQL RLS policies exist but app runs as BYPASSRLS role in dev+prod, so policies do not enforce at runtime.
- **Root cause**: DB role provisioning at Cloud SQL granted BYPASSRLS; app should use a non-superuser role.
- **Workaround**: None runtime — RLS is defense-in-depth; controllers do filter by `userId`. Treat all `withRLSContext` uses as advisory.
- **Fix plan**: 4-PR sequence — see `SECURITY_STATUS.md#c-8` + `C8_PART3_RUNBOOK.md`.
- **Tracked in**: memory `ownmyhealth-project.md`; open finding C-8.
- **Files**: `backend/src/services/database.ts`, Cloud SQL role config (external).
```

### Code-marker inventory table

| Marker | File:line | Context (first 80 chars) |
|---|---|---|
| TODO | `backend/src/services/encryption.ts:80` | `// TODO(key-rotation): store the iteration count per user (or per-ciphertext` |
| TODO | `backend/src/app.ts:130` | `// TODO(csp-nonce): 'unsafe-inline' is required today because Tailwind` |
| TODO | `src/components/settings/PlanSection.tsx:157` | `// TODO: wire to Stripe checkout when billing goes live.` |
| ... | ... | ... |

Do not truncate to "top 10" — every marker gets a row. (As of HEAD the count is small — ~4 markers total across `backend/src` + `src`, including the `csrf.ts:120` NOTE describing a *removed* TODO; the upload-route CSRF-exempt TODO is already resolved. Re-Grep to get the current set rather than trusting these examples.)

### `npm audit` summary

| Severity | Count | Notable advisories (status) |
|---|---|---|
| Critical | N | pkg@ver — status |
| High | N | ... |
| Moderate | N | ... |

### Test coverage gaps

| Area | Expected test file pattern | Exists? | Gap |
|---|---|---|---|
| Controllers | `backend/src/controllers/*.test.ts` | partial | 10 non-test controllers (+ `index.ts`, `testHelpers.ts`); tests exist for auth, biomarker, expense, healthGoals, healthNeeds, settings. No tests for `aiChatController`, `fhirController`, `fileController`, `insuranceController`. (`uploadController` no longer exists — removed; upload logic lives in `uploadRoutes`/`fileController`.) |
| Routes | `backend/src/routes/*.test.ts` | partial | 18 non-test route files; 5 route test files exist (`adminRoutes.demoProtection`, `adminRoutes.updateUser`, `biomarkerRoutes.guidance`, `internalRoutes`, `providerRoutes.requestUniformity`). The other route files have no dedicated route-level tests. |
| ... | ... | ... | ... |

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. What's the single most important open Critical issue?
2. How many TODO/FIXME/HACK markers exist, and which file has the most?
3. Are any tests currently skipped or marked `.todo`?
4. What's the `npm audit` severity breakdown?
5. Which deprecated models remain in `schema.prisma` (if any), and is the DNAVariant/GeneticTrait removal — via migration `20260423_drop_dna_genetics` — recorded as resolved?
6. Which controllers have no test coverage at all? (Expected answer set: `aiChatController`, `fhirController`, `fileController`, `insuranceController`.)
7. What's the workaround for the RLS runtime gap (C-8)?
8. Which recently closed issue introduced new known risk?
9. Is the `nul` stray file (from memory about OneDrive) still in the tree?
10. Which axios / vite advisories are open, and what's the remediation plan?

---

## No-TBD enforcement

Before marking anything TBD:

- **Code markers**: `Grep pattern: "TODO|FIXME|HACK|XXX"` over `backend/src/**` and `src/**`. Every hit is a row.
- **Skipped tests**: `Grep pattern: "\\.(skip|todo|skipIf)\\(|xit\\("` over `backend/src/**` and `e2e/**`. (As of HEAD the only conditional skip is `describe.skipIf(!hasLiveDb)` in `backend/src/services/rls.test.ts:29` — an intentional gate on a live DB, not dead test debt; record it as such rather than as a skipped/TODO test.)
- **Vulnerabilities**: run `npm audit --json` or `npm audit` (Bash); quote the counts.
- **Deprecated models**: `Grep pattern: "deprecated|DNAVariant|GeneticTrait"` over `backend/prisma/schema.prisma`. Expect **zero** DNA/Genetics hits — those models were dropped in migration `20260423_drop_dna_genetics`; record the removal as resolved. Cross-check the 18 current models against any remaining `@deprecated`/legacy markers.
- **Open findings mirror**: read `New Project Documents/SECURITY_STATUS.md` for the Critical/High list; do not re-audit here, just reference.
- **Test gaps**: `Glob pattern: "backend/src/controllers/*.test.ts"`; compare against `Glob pattern: "backend/src/controllers/*.ts"` to compute coverage gap.

If a claim is purely user-reported with no repo evidence:

```
TBD (external: reported in session summary / support channel — add trace link once filed)
```

---

## Cross-links

The generated `KNOWN_ISSUES.md` must link to:

- [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) — authoritative source for security findings.
- [`CHANGELOG.md`](./CHANGELOG.md) — recently closed items.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — symptom → root cause for live bugs.
- [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) — how to close the missing-test gaps.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — deprecated models.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Code markers | Grep | `pattern: "TODO|FIXME|HACK|XXX"` over `{backend/src,src}/**` |
| Skipped tests | Grep | `pattern: "\\.(skip|todo|skipIf)\\(|xit\\("` over `{backend/src,e2e}/**` |
| Console.log in prod code | Grep | `pattern: "console\\.log"` over `backend/src/**` (exclude `.test.`); cross-ref `backend/src/utils/phiRedaction.ts` + `logger.ts` for whether raw logging is already redacted |
| Audit findings | Read | `New Project Documents/SECURITY_STATUS.md` |
| Schema deprecation | Grep | `pattern: "DNAVariant|GeneticTrait"` over `backend/prisma/schema.prisma` (expect zero — dropped in `20260423_drop_dna_genetics`) |
| npm vulnerabilities | Bash | `npm audit` (in root + `backend/`) |

---

## Output: file and location

Write the final document to `New Project Documents/KNOWN_ISSUES.md`.
