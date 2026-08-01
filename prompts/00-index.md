---
tags:
  - index
  - meta
type: index
priority: 1
updated: 2026-08-01
---

# OwnMyHealth Prompts Index

**Counts verified against the live repo on 2026-08-01** (HEAD `12b45ae`, 2026-07-14 — 66 commits past the 2026-06-16 baseline). When in doubt, trust the code — these numbers drift.

---

## Read first: posture and the one ledger

Two facts govern every prompt in this library. Neither is optional context.

**1. The project is a sandbox with no deployment target (declared 2026-07-14).** GCP billing was
disabled ~2026-07-12; the Cloud Run backend, Cloud SQL prod database, and GCS buckets are suspended;
there are no real users and the declared assumption is that all stored data was founder/test data.
`STORAGE_BACKEND=local` (AES-256-GCM-encrypted local disk) is the development default and the only
storage path currently running.

Consequence: any check about GCS ACLs, Secret Manager, Cloud Run IAM, or log sinks is reviewing
infrastructure that does not currently exist. Report those as **Dormant (launch checklist)** with a
reactivation severity and trigger — not as live Criticals. Code-level concerns (encryption, RLS,
authz, validation, cost control, correctness) are fully live and reviewed normally.

**2. [`New Project Documents/OPEN_FINDINGS.md`](../New%20Project%20Documents/OPEN_FINDINGS.md) is the
single authoritative findings ledger** and carries the one severity rubric. It was created
2026-07-11 to close scrutiny finding P0-6 (`SECURITY_STATUS.md` claimed 0 open High while
`KNOWN_ISSUES.md` listed three). **Read it before running any security prompt.** If a prompt, a
generated doc, or this index disagrees with the ledger, the ledger wins. Findings already in it are
reported as known with their `OF-NN` id, never rediscovered.

If any **reactivation trigger** has fired — GCP billing re-enabled, the app deployed anywhere, any
non-founder PHI in any database, or the product made available to others — the sandbox framing in
this library is invalid. Stop, say so, and re-triage the ledger before reviewing.

---

## Shared (read once, reference everywhere)

| File | Purpose |
|---|---|
| [_review-protocol](./_review-protocol.md) | Output format + severity rubric + posture rules for every security/audit prompt |
| [_doc-quality](./_doc-quality.md) | Self-containedness + citation + TBD + **surgical-patch-over-regeneration** rules for every doc prompt |
| [_phi-inventory](./_phi-inventory.md) | Canonical PHI field list — single source of truth |
| [_verification-tools](./_verification-tools.md) | Mapping from Bash grep to Claude Code `Grep`/`Glob`/`Read` |
| [_drift-audit-2026-08-01](./_drift-audit-2026-08-01.md) | **Current** drift audit — what changed since 2026-06-16 and what was done about it |
| [_drift-audit-2026-06-16](./_drift-audit-2026-06-16.md) | Prior per-file drift audit (historical) |
| [_refresh-2026-06-16](./_refresh-2026-06-16.md) | Summary of the 2026-06-16 refresh (companion to `_refresh-2026-06-01`) |

Every security prompt (01-13, 26-32, 41-49) *assumes* you have read `_review-protocol.md`.
Every doc prompt (14-23, 33-40, 46) *assumes* you have read `_doc-quality.md`.

The output docs live in `New Project Documents/` and are the primary substitute for attaching the GitHub repo to a Claude.ai Project. That quality bar is what `_doc-quality.md` enforces.

---

## Security Audit Prompts (01–13, 26–32, 41–49)

| # | Prompt | Purpose | Severity |
|---|---|---|---|
| 01 | [database-schema](./01-database-schema.md) | Schema security, RLS policies (incl. the row-lock UPDATE-policy trap, OF-22), indexes | Critical |
| 02 | [encryption](./02-encryption.md) | AES-256-GCM, per-user key mgmt | Critical |
| 03 | [authentication](./03-authentication.md) | JWT, bcrypt, session lifecycle, refresh rotation | Critical |
| 04 | [csrf](./04-csrf.md) | Double-submit cookie, timing-safe compare | Critical |
| 05 | [audit-logging](./05-audit-logging.md) | HIPAA 7-year retention, immutability | Critical |
| 06 | [api-routes](./06-api-routes.md) | Auth/RBAC/RLS context on every route | High |
| 07 | [input-validation](./07-input-validation.md) | Zod schemas, UUIDs, file validation | High |
| 08 | [rate-limiting](./08-rate-limiting.md) | 8 limiters — brute-force + cost control | Medium |
| 09 | [external-apis](./09-external-apis.md) | API key handling, SSRF, timeouts | Medium |
| 10 | [frontend-auth](./10-frontend-auth.md) | Memory-only tokens, refresh order | High |
| 11 | [environment-secrets](./11-environment-secrets.md) | Env var inventory; Secret Manager **dormant**, `.env` now the only live surface | Critical |
| 12 | [cicd-security](./12-cicd-security.md) | GitHub Actions, Docker, service accounts; deploy half **dormant** | High |
| 13 | [dependency-health](./13-dependency-health.md) | npm audit, deprecated packages, tarball supply chain | Medium |
| 26 | [provider-collaboration](./26-provider-collaboration.md) | Consent lifecycle, cross-user IDOR | High |
| 27 | [ai-integration](./27-ai-integration.md) | Claude API, PHI in prompts, cost control | High |
| 28 | [file-storage](./28-file-storage.md) | **Storage backend dispatch (OF-23)**, local encrypted disk, upload validation, proxy egress; GCS **dormant** | Medium |
| 29 | [data-portability](./29-data-portability.md) | Export, deletion, HIPAA retention | Medium |
| 30 | [admin-security](./30-admin-security.md) | Admin privilege, escalation prevention | Medium |
| 31 | [logging-observability](./31-logging-observability.md) | PHI redaction in logs, Cloud Logging | High |
| 32 | [error-handling](./32-error-handling.md) | Error shape, stack-trace safety, async flow | Medium |
| 41 | [fhir-lab-integration](./41-fhir-lab-integration.md) | Quest SMART-on-FHIR OAuth, encrypted lab tokens, SSRF, sync IDOR | High |
| 42 | [ai-cost-control](./42-ai-cost-control.md) | AI dollar/usage governance — spend cap, cost tracking, plan limits | High |
| 43 | [plan-gating-billing](./43-plan-gating-billing.md) | Plan-tier enforcement, gate bypass, billing-tier authz | Medium |
| 44 | [token-revocation](./44-token-revocation.md) | Cross-instance token revocation — `revoked_access_tokens`, `users.tokens_valid_after`, refresh-reuse family revoke | High |
| 45 | [maintenance-jobs](./45-maintenance-jobs.md) | One-off maintenance/backfill jobs + the `ownmyhealth-maintenance` Cloud Run job | Medium |
| 47 | [accessibility](./47-accessibility.md) | **New** — keyboard operability, focus trap, dialog semantics, SR announcements | Medium |
| 48 | [insurance-domain](./48-insurance-domain.md) | **New** — SBC extraction trust boundary, plan/benefit authz, insurance PHI | High |
| 49 | [calculation-correctness](./49-calculation-correctness.md) | **New** — reference-range classification, cost math, date-only UTC | High |

Total: **28 security prompts.**

---

## Documentation Prompts (14–23, 33–40, 46)

> **Default to a surgical patch, not a regeneration.** See `_doc-quality.md` §"Before you generate"
> and the gate in [25-full-doc-refresh](./25-full-doc-refresh.md).

### Core reference docs (14–23)

| # | Prompt | Generates | Mode |
|---|---|---|---|
| 14 | [strategy-doc](./14-strategy-doc.md) | STRATEGY.md | Q&A + CLAUDE.md + git log |
| 15 | [runbook-doc](./15-runbook-doc.md) | RUNBOOK.md | Code + Q&A (now a **launch/restore** runbook) |
| 16 | [architecture-doc](./16-architecture-doc.md) | ARCHITECTURE.md | Code + Q&A |
| 17 | [api-reference-doc](./17-api-reference-doc.md) | API_REFERENCE.md | Code |
| 18 | [troubleshooting-doc](./18-troubleshooting-doc.md) | TROUBLESHOOTING.md | Git + Q&A |
| 19 | [changelog-doc](./19-changelog-doc.md) | CHANGELOG.md | Git + Q&A |
| 20 | [known-issues-doc](./20-known-issues-doc.md) | KNOWN_ISSUES.md | Code + Q&A |
| 21 | [security-status-doc](./21-security-status-doc.md) | SECURITY_STATUS.md — **controls only**, links to the ledger for severities | Code + Q&A |
| 22 | [hipaa-checklist-doc](./22-hipaa-checklist-doc.md) | HIPAA_CHECKLIST.md | Code + Q&A |
| 23 | [financial-tracker-doc](./23-financial-tracker-doc.md) | FINANCIAL_TRACKER.md | Q&A |

### Deep-reference docs (33–40, 46) — repo-substitute layer

These fill the gaps that make `New Project Documents/` self-sufficient as a Claude Project context. Run *before* 16 and 17 — they cross-link into these.

| # | Prompt | Generates | Mode |
|---|---|---|---|
| 33 | [data-model-doc](./33-data-model-doc.md) | DATA_MODEL.md | Code |
| 34 | [routing-table-doc](./34-routing-table-doc.md) | ROUTING_TABLE.md | Code |
| 35 | [env-vars-doc](./35-env-vars-doc.md) | ENV_VARS.md | Code |
| 36 | [local-dev-setup-doc](./36-local-dev-setup-doc.md) | LOCAL_DEV.md | Code (**now the primary environment**) |
| 37 | [error-recovery-doc](./37-error-recovery-doc.md) | ERROR_RECOVERY.md | Code |
| 38 | [testing-patterns-doc](./38-testing-patterns-doc.md) | TESTING_PATTERNS.md | Code |
| 39 | [frontend-component-map-doc](./39-frontend-component-map-doc.md) | FRONTEND_MAP.md | Code |
| 40 | [phi-taxonomy-doc](./40-phi-taxonomy-doc.md) | PHI_TAXONOMY.md | Code |
| 46 | [biomarker-series](./46-biomarker-series.md) | BIOMARKER_SERIES.md (time-series consolidation/dedupe, `biomarkerSeries`/`biomarkerConsolidation`, `Biomarker.sourceFile` idempotency) | Code |

Generated docs go to `New Project Documents/`. That folder is attached directly to the Claude.ai Project.

---

## Meta (24–25)

| # | Prompt | Purpose |
|---|---|---|
| 24 | [full-security-audit](./24-full-security-audit.md) | Orchestrates the security prompts (01–13, 26–32, 41–49). **Gated** — see its scope gate before running |
| 25 | [full-doc-refresh](./25-full-doc-refresh.md) | Orchestrates the doc prompts. **Gated** — scrutiny discourages full regeneration; patch instead |

---

## Verified codebase counts

Use these when the prompts contradict each other. Counts exclude `*.test.ts` unless the row says otherwise.

> **This table is derived, not transcribed.** `scripts/check-counts.mjs` reads the repo and
> regenerates it, and CI fails if it drifts — so it cannot be stale, and there is no quarterly
> re-verification chore. **Do not hand-edit inside the markers**; a manual edit is a build failure,
> not a correction. To update after a real change: `node scripts/check-counts.mjs --write`.
>
> Added 2026-08-01. This table had drifted at every prior refresh (route, migration, test, and
> workflow counts were each wrong at some point), and a wrong number here propagates into every doc
> the prompts generate. If a metric you need is missing, add it to the script rather than the table.

<!-- BEGIN:codebase-counts (generated by scripts/check-counts.mjs — do not edit by hand) -->

| Thing | Count | Path |
|---|---|---|
| Route files | 18 (incl. `index.ts`) | `backend/src/routes/` |
| Controllers | 10 domain controllers (+ `index.ts`, `testHelpers.ts`); upload logic lives in `controllers/upload/` (4 files) | `backend/src/controllers/` |
| Services | 27 top-level `.ts` (incl. `index.ts`) plus subdirs `data/` (1), `fhir/` (7), `knowledge/` (4), `storage/` (4) | `backend/src/services/` |
| Middleware | 10 (+ `index.ts`): `aiSpendGuard`, `auth`, `csrf`, `demoProtection`, `errorHandler`, `planGating`, `rateLimitStore`, `rateLimiter`, `rbac`, `validation` | `backend/src/middleware/` |
| Rate limiters | **8** — `standard`, `auth`, `strictAuth`, `upload`, `sensitive`, `ai`, `providerAccessRequest`, `bulkOperation` | `backend/src/middleware/rateLimiter.ts` |
| `aiSpendGuard` mount points | **8** across 5 route files (`aiRoutes`, `biomarkerRoutes`, `expenseRoutes`, `insuranceRoutes`, `uploadRoutes`) | `backend/src/middleware/aiSpendGuard.ts` |
| Storage backends | **2** — `gcs`, `local`; selected by `STORAGE_BACKEND`, `local` refused in prod/staging | `backend/src/services/storageService.ts` |
| Frontend API modules | 18 + `index.ts` | `src/services/api/` |
| Frontend `.tsx` files | **75** across **15** component dirs | `src/components/` |
| Frontend hooks | 8 + `index.ts` | `src/hooks/` |
| Prisma models | 19 | `backend/prisma/schema.prisma` |
| Prisma migrations | **34** directories (newest `20260712_add_sessions_update_policy`) | `backend/prisma/migrations/` |
| Encrypted PHI | `PHI_FIELDS` = 14 models / 39 fields, in lockstep with the schema's 39 `*Encrypted` columns | `backend/src/services/encryption.ts` |
| Backend test files | **66** `*.test.ts` | `backend/src/` |
| Frontend test files | **33** | `src/` |
| GitHub workflows | **5** — `ci.yml`, `deploy-staging.yml`, `deploy.yml`, `maintenance.yml`, `secret-history-scan.yml` | `.github/workflows/` |
| CI jobs in `ci.yml` | **5** — `frontend`, `backend`, `security`, `rls`, `e2e` | `.github/workflows/ci.yml` |
| Playwright e2e specs | **6** — `auth`, `biomarker-entry`, `data-export`, `export-delete-journey`, `health-guide`, `settings` | `e2e/` |

<!-- END:codebase-counts -->

**If your prompt cites a different number, trust the code and log the drift** per `_doc-quality.md` "Prompt drift log" rule.

**Material new realities since the 2026-06-16 baseline** (woven into the relevant prompts; surfaced here so the index reflects HEAD):
- **Sandbox posture** (2026-07-14) — no GCP, no deployment target. See "Read first" above (prompts `_review-protocol`, 11, 12, 15, 16, 24, 28, 35, 36).
- **`OPEN_FINDINGS.md` is the single ledger** (2026-07-11) — severity governance left the prompt library (prompts `_review-protocol`, 21, 24).
- **Pluggable storage (OF-23)** — `storageService.ts` façade over `gcsBackend`/`localBackend`; local blobs sealed AES-256-GCM with the **master** `PHI_ENCRYPTION_KEY` in an `OMHL`-magic envelope; tmp+rename at `0600`; path-containment on every key (prompts 28, 11, 35, 36, 16).
- **Row-lock RLS trap (OF-22)** — `sessions` lacked an UPDATE policy, and PostgreSQL applies UPDATE-policy checks to `SELECT ... FOR UPDATE`. Under FORCE RLS + NOBYPASSRLS every refresh 401'd and misfired the token-reuse detector. Fixed by `20260712_add_sessions_update_policy` (prompts 01, 03, 38).
- **CI grew a real e2e job** (2026-07-11) — full Playwright suite against live Postgres; it is what surfaced OF-22. Plus nightly `secret-history-scan.yml`, red by design until OF-01's history is purged (prompts 12, 13, 38).
- **Registration consent (OMH-L04)** — `users.terms_accepted_at` / `terms_version`, validated at the register boundary; `src/components/legal/`. Deliberately not PHI (prompts 07, 22 — no dedicated owner yet).
- **Accessibility became a subsystem** — `useFocusTrap` + ARIA semantics across 15 component files, with a `dialogA11y.test.tsx` regression suite (prompt 47).

**Domains still NOT covered by a numbered prompt** (candidates for prompt 50+):
- **Breach detection / alerting** (scrutiny P0-8) — the strongest candidate, deferred only because there is no deployed log sink to review under the sandbox posture. Add at reactivation.
- **Onboarding wizard, email-change flow, notification preferences** — exercised via 06/03, no owner.
- **Registration consent capture** — exercised via 07/22, no owner.

Deliberately *not* added (see `_drift-audit-2026-08-01.md` §"Deliberately NOT added"): MFA/TOTP and billing prompts (both features unbuilt — a prompt would produce "Unverifiable" for every line), and a BAA/vendor-PHI prompt (the repo-side gates are already covered by 27/28; the rest is paperwork outside the repo).

---

## Quick start

### Security review — targeted (the default)
1. Read `_review-protocol.md` and `OPEN_FINDINGS.md` (once each).
2. Identify what changed (`git log`, current `_drift-audit-*.md`).
3. Run the **2–4 prompts that touch it**.
4. Propose new findings as `OF-NN` entries in the ledger.

A targeted run that closes one real finding beats a 28-prompt sweep that restates twenty known ones.

### Security review — full fan-out (gated)
Only when a posture reactivation fired, an external party requires a dated full-scope review, or
≥3 months have passed *and* a major domain shipped. Then run
[24-full-security-audit](./24-full-security-audit.md), which fans out to all 28 security prompts.

### Adding or changing a PHI field
1. Update `schema.prisma` (add `Encrypted` suffix).
2. Update `PHI_FIELDS` in `backend/src/services/encryption.ts`.
3. Update `_phi-inventory.md`.
4. Add `SENSITIVE_FIELDS` entry (key-based redaction) in `backend/src/utils/logger.ts`; if the field can appear free-text in logs/PDFs, also confirm a pattern in `backend/src/utils/phiRedaction.ts`.
5. Re-run [02-encryption](./02-encryption.md), [31-logging-observability](./31-logging-observability.md).

### Updating the docs (patch, don't regenerate)
1. Read `_doc-quality.md` §"Before you generate" once.
2. Read the current `_drift-audit-*.md` to learn which docs actually moved.
3. Patch those sections with citations, bump their stamps, record what you patched.
4. Only run [25-full-doc-refresh](./25-full-doc-refresh.md) if its gate is met.

### Adding a new prompt
1. Pick the next number (50+).
2. Include frontmatter with `updated:` date.
3. For security prompts: open with the three "review-protocol / phi-inventory / verification-tools" reference lines.
   For doc prompts: open with the three "doc-quality / verification-tools / phi-inventory-if-relevant" lines.
4. Organize checks into numbered sections.
5. End with: **Required artifacts**, **Questions to Ask**, **Verification Commands**, and **Cross-links**.
6. Register in this index **and** in [24-full-security-audit](./24-full-security-audit.md) if it is a security prompt.

---

## Prompt maintenance

Review cadence:

| Item | Frequency |
|---|---|
| Counts in this file | ~~Quarterly~~ **Never — automated.** Derived by `scripts/check-counts.mjs` and enforced by CI (`security` job). Re-run with `--write` after a structural change |
| Doc links, anchors, `file:line` citations | **Never — automated.** `scripts/check-docs.mjs`, same CI job |
| Full drift audit | Quarterly, **or immediately on any posture reactivation** (that event invalidates the sandbox framing in 8 files at once) |
| `_phi-inventory.md` vs `PHI_FIELDS` | Every PR that touches schema.prisma |
| `_review-protocol.md` | Yearly, or whenever `OPEN_FINDINGS.md` changes its rubric or posture |
| Individual prompts | When a prompt produces low-value output (fix the prompt, not the review) |

Out-of-date prompts produce out-of-date reviews. Treat prompt drift as a bug — and treat an
unnecessary full regeneration as a different bug, because it buries what actually changed.
