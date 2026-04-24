# OwnMyHealth — Claude Project Documents

**Generated**: 2026-04-24
**Purpose**: this folder is attached to a Claude.ai Project as a substitute for the full GitHub repo (which has outgrown Projects' attachment limit). Every doc here is designed to be answerable on its own plus its cross-linked siblings, with file:line citations. Quality standard: see `prompts/_doc-quality.md`.

---

## How to read this doc set

A reader (or Claude) with only these 24 files must be able to answer real implementation questions about the codebase without opening source. Each doc either:

- Is a **structural reference** (ENV_VARS, DATA_MODEL, ROUTING_TABLE, API_REFERENCE, PHI_TAXONOMY, FRONTEND_MAP)
- Is a **narrative overview** (ARCHITECTURE, STRATEGY)
- Is an **operational guide** (LOCAL_DEV, RUNBOOK, ERROR_RECOVERY, TROUBLESHOOTING, TESTING_PATTERNS)
- Tracks **posture and history** (CHANGELOG, KNOWN_ISSUES, SECURITY_STATUS, HIPAA_CHECKLIST, SECURITY_AUDIT_*, FINANCIAL_TRACKER)
- Tracks **open remediation** (C8_PART3_*)

Start here when answering a question:

| If the question is about… | Open first |
|---|---|
| "what does this app do?" / product scope | [STRATEGY.md](./STRATEGY.md) |
| "how does X work end to end?" | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| "what's the contract for endpoint X?" | [API_REFERENCE.md](./API_REFERENCE.md) |
| "what guards route X?" (middleware chain) | [ROUTING_TABLE.md](./ROUTING_TABLE.md) |
| "which model / fields / RLS policy?" | [DATA_MODEL.md](./DATA_MODEL.md) |
| "where is field X encrypted / audited / redacted?" | [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) |
| "what env vars do I need?" | [ENV_VARS.md](./ENV_VARS.md) |
| "how do I run this locally?" | [LOCAL_DEV.md](./LOCAL_DEV.md) |
| "how do I deploy / rollback / respond to incident?" | [RUNBOOK.md](./RUNBOOK.md) |
| "I got error `X` — what now?" | [ERROR_RECOVERY.md](./ERROR_RECOVERY.md) |
| "users see symptom Y — where to look?" | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| "how do I write a test?" | [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) |
| "which component does Z on the frontend?" | [FRONTEND_MAP.md](./FRONTEND_MAP.md) |
| "what's the security posture?" | [SECURITY_STATUS.md](./SECURITY_STATUS.md) |
| "HIPAA compliance evidence?" | [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) |
| "what changed recently?" | [CHANGELOG.md](./CHANGELOG.md) |
| "what's broken / technical debt?" | [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) |
| "unit economics / runway" | [FINANCIAL_TRACKER.md](./FINANCIAL_TRACKER.md) |
| "full audit trail by area" | [SECURITY_AUDIT_core.md](./SECURITY_AUDIT_core.md), [_domain](./SECURITY_AUDIT_domain.md), [_infrastructure](./SECURITY_AUDIT_infrastructure.md), [_periphery](./SECURITY_AUDIT_periphery.md) |
| "what's C-8 and how do we close it?" | [C8_PART3_RUNBOOK.md](./C8_PART3_RUNBOOK.md), [C8_PART3_STARTUP_ASSERTION.md](./C8_PART3_STARTUP_ASSERTION.md) |

---

## Document catalog (24 files)

### Structural reference (deep, dense, citation-heavy)

| # | File | Generated from | Scope |
|---|---|---|---|
| 1 | [ENV_VARS.md](./ENV_VARS.md) | `prompts/35-env-vars-doc.md` | ~45 env vars catalogued; drift between `config/index.ts`, `.env.example`, workflows flagged |
| 2 | [DATA_MODEL.md](./DATA_MODEL.md) | `prompts/33-data-model-doc.md` | 21 Prisma models (18 active + 3 deprecated), Mermaid ER, RLS policy catalog, 170-site wrapper usage matrix |
| 3 | [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) | `prompts/40-phi-taxonomy-doc.md` | 36 PHI fields × encryption × write sites × read sites × audit × logger redaction |
| 4 | [ROUTING_TABLE.md](./ROUTING_TABLE.md) | `prompts/34-routing-table-doc.md` | 108 endpoints × middleware chain × RLS wrap × audit events |
| 5 | [API_REFERENCE.md](./API_REFERENCE.md) | `prompts/17-api-reference-doc.md` | 112 endpoints documented with request/response, Zod, curl, errors, PHI exposure |
| 6 | [FRONTEND_MAP.md](./FRONTEND_MAP.md) | `prompts/39-frontend-component-map-doc.md` | 66 components × 12 dirs × contexts × 17 API modules × chunk map |

### Narrative overview

| # | File | Generated from | Scope |
|---|---|---|---|
| 7 | [ARCHITECTURE.md](./ARCHITECTURE.md) | `prompts/16-architecture-doc.md` | 10 Mermaid/ASCII diagrams, middleware stack, scheduled jobs, tech stack with versions |
| 8 | [STRATEGY.md](./STRATEGY.md) | `prompts/14-strategy-doc.md` | Mission, feature map (shipped / backend-only / removed / deprecated), roadmap from git, decisions log |

### Operational

| # | File | Generated from | Scope |
|---|---|---|---|
| 9 | [LOCAL_DEV.md](./LOCAL_DEV.md) | `prompts/36-local-dev-setup-doc.md` | Node 20, clone → run steps, smoke-test curls, common-failure table |
| 10 | [RUNBOOK.md](./RUNBOOK.md) | `prompts/15-runbook-doc.md` | Deploy/rollback, secrets, 3 schedulers, 8 incident playbooks |
| 11 | [ERROR_RECOVERY.md](./ERROR_RECOVERY.md) | `prompts/37-error-recovery-doc.md` | 30 grep-verified error codes × recovery playbooks × 401/419/403 decision tree |
| 12 | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | `prompts/18-troubleshooting-doc.md` | 26 symptoms from git log + memory + architecture, with commit SHAs |
| 13 | [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) | `prompts/38-testing-patterns-doc.md` | Vitest (not Jest), 21 backend + 7 frontend + 5 e2e tests; full real-test copies |

### Posture and history

| # | File | Generated from | Scope |
|---|---|---|---|
| 14 | [CHANGELOG.md](./CHANGELOG.md) | `prompts/19-changelog-doc.md` | 292 commits / 32 PRs since 2026-01-07 cutoff; 14 new migrations |
| 15 | [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | `prompts/20-known-issues-doc.md` | 4 TODOs (clean codebase), npm audit counts, 18 deprecated items flagged |
| 16 | [SECURITY_STATUS.md](./SECURITY_STATUS.md) | `prompts/21-security-status-doc.md` | Grade **B-**, 1 Critical open (C-8), 0 High; 17 control areas tallied |
| 17 | [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) | `prompts/22-hipaa-checklist-doc.md` | Technical Safeguards 6✅/2🟡/1⚠️; BAAs; admin/physical TBD (external) |
| 18 | [FINANCIAL_TRACKER.md](./FINANCIAL_TRACKER.md) | `prompts/23-financial-tracker-doc.md` | Cost structure + rate-limit ceilings + per-user formula; $ values external |

### Security audits (per-area outputs)

| # | File | Generated from | Scope |
|---|---|---|---|
| 19 | [SECURITY_AUDIT_core.md](./SECURITY_AUDIT_core.md) | `prompts/01–05` (last audit 2026-04-16) | Schema, encryption, auth, CSRF, audit-logging findings |
| 20 | [SECURITY_AUDIT_domain.md](./SECURITY_AUDIT_domain.md) | `prompts/26–29` (last audit 2026-04-16) | Provider collab, AI, file storage, data portability findings |
| 21 | [SECURITY_AUDIT_infrastructure.md](./SECURITY_AUDIT_infrastructure.md) | `prompts/11–12` (last audit 2026-04-16) | Secrets, CI/CD, infra findings (incl. C-8 BYPASSRLS) |
| 22 | [SECURITY_AUDIT_periphery.md](./SECURITY_AUDIT_periphery.md) | `prompts/06–10, 13, 30–32` (last audit 2026-04-16) | Routes, input validation, rate limit, external APIs, frontend auth, deps, admin, logging, errors |

### Active remediation

| # | File | Scope |
|---|---|---|
| 23 | [C8_PART3_RUNBOOK.md](./C8_PART3_RUNBOOK.md) | DB role cutover procedure for C-8 |
| 24 | [C8_PART3_STARTUP_ASSERTION.md](./C8_PART3_STARTUP_ASSERTION.md) | Startup-time RLS-role assertion spec |

---

## Regenerating this set

Use `prompts/25-full-doc-refresh.md` — it sequences the doc prompts in dependency order:

```
35 env-vars → 33 data-model → 40 phi-taxonomy → 34 routing-table
  → 16 architecture → 17 api-reference
  → 36 local-dev → 37 error-recovery → 15 runbook → 18 troubleshooting
  → 38 testing-patterns → 39 frontend-map
  → 19 changelog → 20 known-issues
  → 24 full-security-audit (refreshes SECURITY_AUDIT_*) → 21 security-status → 22 hipaa-checklist
  → 14 strategy → 23 financial-tracker
  → regenerate this INDEX.md
```

Every doc prompt inherits [`prompts/_doc-quality.md`](../prompts/_doc-quality.md) — self-containedness, evidence, no-TBD, and cross-link rules. Every security audit prompt inherits [`prompts/_review-protocol.md`](../prompts/_review-protocol.md).

---

## Notable findings surfaced during this regeneration

Generated 2026-04-24. Cross-cut discoveries that should drive follow-up work (details in the cited doc):

- **Runtime C-8 BYPASSRLS** still open — RLS policies shipped but DB role bypasses them. See [SECURITY_STATUS.md](./SECURITY_STATUS.md#open-findings) + [C8_PART3_RUNBOOK.md](./C8_PART3_RUNBOOK.md).
- **`CLAUDE.md` drift** — claims Jest (actual: Vitest); lists Admin Panel / Provider Collaboration as shipped (actual: backend-only — frontend UI absent). See [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) + [STRATEGY.md §4.2](./STRATEGY.md).
- **Env-var name drift** — `GCP_PROCESSOR_ID` used in code, `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` documented. `CSRF_SECRET` listed but unused. See [ENV_VARS.md](./ENV_VARS.md#drift-findings).
- **25+ logger redaction gaps** — PHI field names not in `SENSITIVE_FIELDS`. See [PHI_TAXONOMY.md §4](./PHI_TAXONOMY.md).
- **AI chat spend un-tracked** — `aiChatController` does not call `trackAIUsage`. See [FINANCIAL_TRACKER.md](./FINANCIAL_TRACKER.md).
- **Frontend orphans** — `providerApi`, `patientApi`, `adminApi`, 5 `RoleGuard` variants exported with zero UI consumers. See [FRONTEND_MAP.md §10](./FRONTEND_MAP.md).
- **Demo-AI quota holes** — `GET /health-needs/analyze` and `GET /health-goals/suggestions` call Claude without `blockDemoAI`. See [ROUTING_TABLE.md](./ROUTING_TABLE.md).
- **Vestigial config** — `backend/railway.toml` + `DEPLOY.md` describe a never-shipped Railway deploy. See [RUNBOOK.md Prompt drift log](./RUNBOOK.md).
- **Duplicate SBC upload mount** — `/insurance/upload-sbc` mounted twice with different guards. See [ROUTING_TABLE.md](./ROUTING_TABLE.md).
- **7 Criticals closed in a single day (2026-04-16)** — unusually dense security sweep (PRs #30–#42). See [CHANGELOG.md](./CHANGELOG.md).
