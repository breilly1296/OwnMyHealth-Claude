# OwnMyHealth Project Documents — Index

**Generated:** 2026-04-16 by running the prompt library in `prompts/`.

---

## Start here

1. **[SECURITY_STATUS.md](./SECURITY_STATUS.md)** — **READ FIRST.** 7 Critical findings block production. Actionable remediation plan with owners and timelines.
2. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — system overview, data flows, security architecture. Start here for anyone new to the codebase.
3. **[CHANGELOG.md](./CHANGELOG.md)** — what shipped, organized by date and theme (derived from git log).

---

## Security (3 audit reports + consolidated status)

| Doc | What it contains | Source prompts |
|---|---|---|
| [SECURITY_STATUS.md](./SECURITY_STATUS.md) | Consolidated view: Critical/High findings, controls status, remediation plan | 21 + all audits |
| [SECURITY_AUDIT_core.md](./SECURITY_AUDIT_core.md) | 32 findings: schema, encryption, auth, CSRF, audit logging, API routes, frontend auth, secrets | 01, 02, 03, 04, 05, 06, 10, 11 |
| [SECURITY_AUDIT_periphery.md](./SECURITY_AUDIT_periphery.md) | 45 findings: input validation, rate limiting, external APIs, CI/CD, deps, admin, logging, errors | 07, 08, 09, 12, 13, 30, 31, 32 |
| [SECURITY_AUDIT_domain.md](./SECURITY_AUDIT_domain.md) | 33 findings: provider collaboration, AI integration, file storage, data portability | 26, 27, 28, 29 |
| [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) | §164.308/310/312 section-by-section status; BAA inventory | 22 |

**Critical findings total: 7.** See SECURITY_STATUS.md for full remediation plan.

---

## Technical reference

| Doc | What it contains | Source prompt |
|---|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Tech stack, data flow diagrams, schema overview, middleware stack, RBAC, file structure | 16 |
| [API_REFERENCE.md](./API_REFERENCE.md) | ~70 endpoints across 13 route files: auth, CSRF, rate limit, RBAC, request/response shapes per endpoint | 17 |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | TODOs, code-size flags, test coverage gaps, npm audit results, deprecated models | 20 |

---

## Operations

| Doc | What it contains | Source prompt |
|---|---|---|
| [RUNBOOK.md](./RUNBOOK.md) | Deploy, rollback, logs, DB ops, secret management, schedulers, emergency procedures | 15 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Symptom index + root causes (mostly derived from git `fix:` commits) | 18 |

---

## Business / Strategy

| Doc | What it contains | Source prompt |
|---|---|---|
| [STRATEGY.md](./STRATEGY.md) | Mission, product strategy, decision log, risks. **Has TBD sections** — run prompt 14 Q&A | 14 |
| [FINANCIAL_TRACKER.md](./FINANCIAL_TRACKER.md) | Skeleton for monthly burn, runway, revenue model. **Has TBD sections** — run prompt 23 Q&A | 23 |
| [CHANGELOG.md](./CHANGELOG.md) | Keep-a-Changelog format, organized by date (derived from git log) | 19 |

---

## What's not here (and why)

These prompts were part of the library but weren't run as standalone docs:

- **Prompt 14 §Q&A-heavy sections** → embedded as **TBD** markers in STRATEGY.md. Interactive session needed.
- **Prompt 18 §recent problems you solved that aren't in git** → embedded in TROUBLESHOOTING.md. Q&A needed.
- **Prompt 23 §financial figures** → embedded in FINANCIAL_TRACKER.md. Q&A needed.
- **Prompts 24, 25 (orchestrators)** → already executed indirectly; their fan-out produced this directory.

---

## Summary of findings (from security audits)

| Severity | Count | Notable (see SECURITY_STATUS.md for full list) |
|---|---|---|
| **Critical** | **7** | RLS `SET LOCAL` outside tx; audit salt plaintext; JWT dev fallbacks; insecure `.env.example` key; jspdf CVEs; GCS files not deleted on account deletion; raw PHI PDFs sent to Claude |
| **High** | ~22 | aiLimiter missing on 4 Claude endpoints; demo-protection middleware never attached; data export missing 8 of 11 PHI categories; password-policy mismatch (8 vs 12); provider cross-user RLS bypass; no password confirmation on destructive ops |
| **Medium** | ~37 | Bare `console.*` leaking frontend auth state; Zod errors echoing PHI; CSRF readable from JS; session race conditions; narrow PHI regex; deprecated models still exposed |
| **Low** | ~27 | Code quality, comments, UUID generation inconsistencies, old env var names |
| **Info** | ~6 | Architecture notes, passing checks |

Total: **~99 findings** across the 20 security prompts. The architecture is sound — the issues are implementation gaps, mostly fixable in a 2-3 week remediation sprint.

---

## How this directory was generated

1. Prompts in `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\prompts\` — security prompts (01-13, 26-32) + doc prompts (14-23) + shared templates (`_review-protocol.md`, `_phi-inventory.md`, `_verification-tools.md`).
2. Six parallel Claude Code agents ran groups of prompts and wrote findings directly to this directory.
3. Findings consolidated into SECURITY_STATUS.md; overview in INDEX.md (this file).

### Re-generate
Re-run after major changes:
- After security fixes: `prompts/24-full-security-audit.md` → regenerate the three SECURITY_AUDIT_* files → refresh SECURITY_STATUS.md.
- After API changes: `prompts/17-api-reference-doc.md` → regenerate API_REFERENCE.md.
- After infra changes: `prompts/16-architecture-doc.md` + `prompts/15-runbook-doc.md`.
- After releases: `prompts/19-changelog-doc.md`.

---

## Suggested next actions (in order)

1. **Fix the 7 Criticals** (SECURITY_STATUS.md §Remediation plan §Immediate). Target: this week.
2. **Sign Anthropic BAA** (blocks production PHI through Claude). Legal process.
3. **Clear npm audit** on root (`jspdf@latest`) and backend (29 vulns). `npm audit fix` + re-test.
4. **Fill STRATEGY.md and FINANCIAL_TRACKER.md** TBD sections via prompts 14 and 23 Q&A.
5. **Write the HIPAA compliance documents** listed in HIPAA_CHECKLIST.md §Required Documentation.
6. **Re-run full security audit** after fixes; target: Critical=0, High<5 before beta launch.
