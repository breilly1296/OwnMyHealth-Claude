---
tags:
  - index
  - meta
type: index
priority: 1
updated: 2026-04-24
---

# OwnMyHealth Prompts Index

**Counts verified against the live repo on 2026-04-24.** When in doubt, trust the code — these numbers drift.

---

## Shared (read once, reference everywhere)

| File | Purpose |
|---|---|
| [_review-protocol](./_review-protocol.md) | Output format + severity rubric for every security/audit prompt |
| [_doc-quality](./_doc-quality.md) | Self-containedness + citation + TBD + format rules for every doc prompt |
| [_phi-inventory](./_phi-inventory.md) | Canonical PHI field list — single source of truth |
| [_verification-tools](./_verification-tools.md) | Mapping from Bash grep to Claude Code `Grep`/`Glob`/`Read` |

Every security prompt (01-13, 26-32) *assumes* you have read `_review-protocol.md`.
Every doc prompt (14-23, 33-40) *assumes* you have read `_doc-quality.md`.

The output docs live in `New Project Documents/` and are the primary substitute for attaching the GitHub repo to a Claude.ai Project. That quality bar is what `_doc-quality.md` enforces.

---

## Security Audit Prompts (01–13, 26–32)

| # | Prompt | Purpose | Severity |
|---|---|---|---|
| 01 | [database-schema](./01-database-schema.md) | Schema security, RLS policies, indexes | Critical |
| 02 | [encryption](./02-encryption.md) | AES-256-GCM, per-user key mgmt | Critical |
| 03 | [authentication](./03-authentication.md) | JWT, bcrypt, session lifecycle | Critical |
| 04 | [csrf](./04-csrf.md) | Double-submit cookie, timing-safe compare | Critical |
| 05 | [audit-logging](./05-audit-logging.md) | HIPAA 7-year retention, immutability | Critical |
| 06 | [api-routes](./06-api-routes.md) | Auth/RBAC/RLS context on every route | High |
| 07 | [input-validation](./07-input-validation.md) | Zod schemas, UUIDs, file validation | High |
| 08 | [rate-limiting](./08-rate-limiting.md) | 7 limiters — brute-force + cost control | Medium |
| 09 | [external-apis](./09-external-apis.md) | API key handling, SSRF, timeouts | Medium |
| 10 | [frontend-auth](./10-frontend-auth.md) | Memory-only tokens, refresh order | High |
| 11 | [environment-secrets](./11-environment-secrets.md) | Secret Manager, env var inventory | Critical |
| 12 | [cicd-security](./12-cicd-security.md) | GitHub Actions, Docker, service accounts | High |
| 13 | [dependency-health](./13-dependency-health.md) | npm audit, deprecated packages | Medium |
| 26 | [provider-collaboration](./26-provider-collaboration.md) | Consent lifecycle, cross-user IDOR | High |
| 27 | [ai-integration](./27-ai-integration.md) | Claude API, PHI in prompts, cost control | High |
| 28 | [file-storage](./28-file-storage.md) | GCS, signed URLs, upload validation | Medium |
| 29 | [data-portability](./29-data-portability.md) | Export, deletion, HIPAA retention | Medium |
| 30 | [admin-security](./30-admin-security.md) | Admin privilege, escalation prevention | Medium |
| 31 | [logging-observability](./31-logging-observability.md) | PHI redaction in logs, Cloud Logging | High |
| 32 | [error-handling](./32-error-handling.md) | Error shape, stack-trace safety, async flow | Medium |

Total: **20 security prompts.**

---

## Documentation Prompts (14–23, 33–40)

### Core reference docs (14–23)

| # | Prompt | Generates | Mode |
|---|---|---|---|
| 14 | [strategy-doc](./14-strategy-doc.md) | STRATEGY.md | Q&A + CLAUDE.md + git log |
| 15 | [runbook-doc](./15-runbook-doc.md) | RUNBOOK.md | Code + Q&A |
| 16 | [architecture-doc](./16-architecture-doc.md) | ARCHITECTURE.md | Code + Q&A |
| 17 | [api-reference-doc](./17-api-reference-doc.md) | API_REFERENCE.md | Code |
| 18 | [troubleshooting-doc](./18-troubleshooting-doc.md) | TROUBLESHOOTING.md | Git + Q&A |
| 19 | [changelog-doc](./19-changelog-doc.md) | CHANGELOG.md | Git + Q&A |
| 20 | [known-issues-doc](./20-known-issues-doc.md) | KNOWN_ISSUES.md | Code + Q&A |
| 21 | [security-status-doc](./21-security-status-doc.md) | SECURITY_STATUS.md | Code + Q&A |
| 22 | [hipaa-checklist-doc](./22-hipaa-checklist-doc.md) | HIPAA_CHECKLIST.md | Code + Q&A |
| 23 | [financial-tracker-doc](./23-financial-tracker-doc.md) | FINANCIAL_TRACKER.md | Q&A |

### Deep-reference docs (33–40) — repo-substitute layer

These fill the gaps that make `New Project Documents/` self-sufficient as a Claude Project context. Run *before* 16 and 17 — they cross-link into these.

| # | Prompt | Generates | Mode |
|---|---|---|---|
| 33 | [data-model-doc](./33-data-model-doc.md) | DATA_MODEL.md | Code |
| 34 | [routing-table-doc](./34-routing-table-doc.md) | ROUTING_TABLE.md | Code |
| 35 | [env-vars-doc](./35-env-vars-doc.md) | ENV_VARS.md | Code |
| 36 | [local-dev-setup-doc](./36-local-dev-setup-doc.md) | LOCAL_DEV.md | Code |
| 37 | [error-recovery-doc](./37-error-recovery-doc.md) | ERROR_RECOVERY.md | Code |
| 38 | [testing-patterns-doc](./38-testing-patterns-doc.md) | TESTING_PATTERNS.md | Code |
| 39 | [frontend-component-map-doc](./39-frontend-component-map-doc.md) | FRONTEND_MAP.md | Code |
| 40 | [phi-taxonomy-doc](./40-phi-taxonomy-doc.md) | PHI_TAXONOMY.md | Code |

Generated docs go to `New Project Documents/`. That folder is attached directly to the Claude.ai Project.

---

## Meta (24–25)

| # | Prompt | Purpose |
|---|---|---|
| 24 | [full-security-audit](./24-full-security-audit.md) | Orchestrates prompts 01–13 and 26–32 |
| 25 | [full-doc-refresh](./25-full-doc-refresh.md) | Orchestrates prompts 14–23 |

---

## Verified codebase counts (2026-04-24)

Use these when the prompts contradict each other. Re-verify quarterly with `Glob` (see [`_verification-tools.md`](./_verification-tools.md)).

| Thing | Count | Path |
|---|---|---|
| Route files | 19 (incl. `index.ts`) | `backend/src/routes/` |
| Controllers | 10 (+ `index.ts`) | `backend/src/controllers/` |
| Services | ~30 (excl. tests, `data/`, subdirs `fhir/`, `knowledge/`) | `backend/src/services/` |
| Middleware | 8 (`auth`, `csrf`, `rbac`, `rateLimiter`, `demoProtection`, `validation`, `errorHandler`, `planGating`) | `backend/src/middleware/` |
| Rate limiters | **7** (standard, auth, strictAuth, upload, sensitive, **ai**, bulkOperation) | `backend/src/middleware/rateLimiter.ts` |
| Frontend API modules | 17 + `index.ts` | `src/services/api/` |
| Frontend `.tsx` files | 79 across 12 component dirs | `src/components/` |
| Prisma models | 21 (incl. deprecated DNA/Genetics) | `backend/prisma/schema.prisma` |
| Prisma migrations | 16 directories | `backend/prisma/migrations/` |
| GitHub workflows | 3 (`ci.yml`, `deploy.yml`, `deploy-staging.yml`) | `.github/workflows/` |
| Playwright e2e specs | 5 (`auth`, `biomarker-entry`, `data-export`, `health-guide`, `settings`) | `e2e/` |

**If your prompt cites a different number, trust the code and log the drift** per `_doc-quality.md` "Prompt drift log" rule.

---

## Quick start

### Security review (new engagement)
1. Read `_review-protocol.md` (once).
2. Run [24-full-security-audit](./24-full-security-audit.md) which fans out to all 20 security prompts.
3. Consolidate findings into [21-security-status-doc](./21-security-status-doc.md).

### Adding or changing a PHI field
1. Update `schema.prisma` (add `Encrypted` suffix).
2. Update `PHI_FIELDS` in `backend/src/services/encryption.ts`.
3. Update `_phi-inventory.md`.
4. Add `SENSITIVE_FIELDS` entry in `backend/src/utils/logger.ts`.
5. Re-run [02-encryption](./02-encryption.md), [31-logging-observability](./31-logging-observability.md).

### Running a full doc refresh (for Claude Project)
1. Read `_doc-quality.md` once.
2. Run [25-full-doc-refresh](./25-full-doc-refresh.md) — it sequences every doc prompt in dependency order (env vars → data model → PHI taxonomy → routing → architecture → API → operational docs → narrative docs).
3. Attach the final `New Project Documents/` folder to the Claude.ai Project.

### Adding a new prompt
1. Pick the next number (41+).
2. Include frontmatter with `updated:` date.
3. For security prompts: open with the three "review-protocol / phi-inventory / verification-tools" reference lines.
   For doc prompts: open with the three "doc-quality / verification-tools / phi-inventory-if-relevant" reference lines (see `_doc-quality.md` "Required opening boilerplate").
4. Organize checks into numbered sections.
5. End with: **Required sections**, **Required artifacts**, **Acceptance questions**, **No-TBD enforcement**, **Cross-links**, and **Verification** (tool usage).
6. Register in this index.

---

## Prompt maintenance

Review cadence:

| Item | Frequency |
|---|---|
| Counts in this file | Quarterly (run `Glob` across key dirs) |
| `_phi-inventory.md` vs `PHI_FIELDS` | Every PR that touches schema.prisma |
| `_review-protocol.md` | Yearly |
| Individual prompts | When a prompt produces low-value output (fix the prompt, don't the review) |

Out-of-date prompts produce out-of-date reviews. Treat prompt drift as a bug.
