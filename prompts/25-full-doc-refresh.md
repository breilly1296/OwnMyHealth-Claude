---
tags:
  - documentation
  - meta
type: prompt
priority: 2
updated: 2026-06-01
---

# Full Documentation Refresh

## Required reading before generating

Before running any doc prompt, read:

1. [`_doc-quality.md`](./_doc-quality.md) — quality bar every output doc must pass.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — PHI canonical list.

---

## Purpose

Orchestrate a full refresh of `New Project Documents/`. The output set, in its entirety, must be rich enough to serve as a Claude.ai Project context **substitute for the full GitHub repo** (which has outgrown Projects' attachment limit).

This prompt is a runner, not a doc generator. It sequences the 18 doc prompts (14-23 plus the 33-40 deep-reference layer) so each run benefits from the context the earlier ones produced.

> **Current state (2026-06-01):** `New Project Documents/` is **empty** — none of the output docs exist yet. The first full run generates all 22 files from scratch (plus `INDEX.md`); it is not an incremental update of existing docs.

Before sequencing, verify the live codebase counts in [`00-index.md`](./00-index.md) ("Verified codebase counts") so each generated doc starts from accurate totals. Several product domains added since the prompt era — Quest FHIR / lab connections, AI chat + AI cost/spend control, onboarding, email-change, notification preferences, and plan gating / billing tiers — are now in code and must be reflected across the generated set (especially `DATA_MODEL.md`, `ROUTING_TABLE.md`, `ENV_VARS.md`, `ARCHITECTURE.md`, `API_REFERENCE.md`, and `FRONTEND_MAP.md`).

---

## Documentation set

Every prompt below produces exactly one file in `New Project Documents/`.

### Deep-reference layer (33-40) — run first

These fill the gaps that make the rest of the set self-sufficient. Later docs cross-link into these.

- [ ] [35-env-vars-doc](./35-env-vars-doc.md) → `ENV_VARS.md`
- [ ] [33-data-model-doc](./33-data-model-doc.md) → `DATA_MODEL.md`
- [ ] [40-phi-taxonomy-doc](./40-phi-taxonomy-doc.md) → `PHI_TAXONOMY.md`
- [ ] [34-routing-table-doc](./34-routing-table-doc.md) → `ROUTING_TABLE.md`

### Core reference layer

- [ ] [16-architecture-doc](./16-architecture-doc.md) → `ARCHITECTURE.md`
- [ ] [17-api-reference-doc](./17-api-reference-doc.md) → `API_REFERENCE.md`

### Operational layer

- [ ] [36-local-dev-setup-doc](./36-local-dev-setup-doc.md) → `LOCAL_DEV.md`
- [ ] [37-error-recovery-doc](./37-error-recovery-doc.md) → `ERROR_RECOVERY.md`
- [ ] [15-runbook-doc](./15-runbook-doc.md) → `RUNBOOK.md`
- [ ] [18-troubleshooting-doc](./18-troubleshooting-doc.md) → `TROUBLESHOOTING.md`

### Engineering-practices layer

- [ ] [38-testing-patterns-doc](./38-testing-patterns-doc.md) → `TESTING_PATTERNS.md`
- [ ] [39-frontend-component-map-doc](./39-frontend-component-map-doc.md) → `FRONTEND_MAP.md`

### History + posture layer

- [ ] [19-changelog-doc](./19-changelog-doc.md) → `CHANGELOG.md`
- [ ] [20-known-issues-doc](./20-known-issues-doc.md) → `KNOWN_ISSUES.md`

### Security + compliance layer — after re-running security audits

- [ ] [24-full-security-audit](./24-full-security-audit.md) (if due) → updated `SECURITY_AUDIT_*.md` files
- [ ] [21-security-status-doc](./21-security-status-doc.md) → `SECURITY_STATUS.md`
- [ ] [22-hipaa-checklist-doc](./22-hipaa-checklist-doc.md) → `HIPAA_CHECKLIST.md`

### Strategy + financials layer (highest external-fact density)

- [ ] [14-strategy-doc](./14-strategy-doc.md) → `STRATEGY.md`
- [ ] [23-financial-tracker-doc](./23-financial-tracker-doc.md) → `FINANCIAL_TRACKER.md`

---

## Execution order (dependency-aware)

Later docs cross-link into earlier ones, so running in this order maximises the "self-contained" quality of each doc:

1. **ENV_VARS** — pure config reference; no dependencies.
2. **DATA_MODEL** — pure schema reference; depends on ENV_VARS for `DATABASE_URL`.
3. **PHI_TAXONOMY** — depends on DATA_MODEL for field tables.
4. **ROUTING_TABLE** — security-stack-per-route; depends on none in `New Project Documents/` but needs to be available before ARCHITECTURE.
5. **ARCHITECTURE** — system overview; cross-links into all four above.
6. **API_REFERENCE** — contract-facing; cross-links to ROUTING_TABLE, DATA_MODEL, PHI_TAXONOMY.
7. **LOCAL_DEV** — uses ENV_VARS, DATA_MODEL, API_REFERENCE.
8. **ERROR_RECOVERY** — codes + recovery; cross-links to API_REFERENCE + ROUTING_TABLE.
9. **RUNBOOK** — operational; cross-links to ENV_VARS, ARCHITECTURE, ERROR_RECOVERY.
10. **TROUBLESHOOTING** — cross-links to ERROR_RECOVERY + RUNBOOK.
11. **TESTING_PATTERNS** — cross-links to DATA_MODEL, ROUTING_TABLE, LOCAL_DEV.
12. **FRONTEND_MAP** — cross-links to API_REFERENCE.
13. **CHANGELOG** — git-log-driven.
14. **KNOWN_ISSUES** — code-marker-driven; cross-links to SECURITY_STATUS.
15. **(optional)** Re-run `24-full-security-audit` if due.
16. **SECURITY_STATUS** — synthesizes `SECURITY_AUDIT_*.md`.
17. **HIPAA_CHECKLIST** — technical safeguards; cross-links to PHI_TAXONOMY, DATA_MODEL, SECURITY_STATUS.
18. **STRATEGY** — synthesizes current feature set (cross-links to everything).
19. **FINANCIAL_TRACKER** — unit economics; cross-links to ROUTING_TABLE (rate limits cap cost) + ENV_VARS.

---

## Self-check pass (final step — do not skip)

For each generated doc:

1. Open the doc.
2. Re-read the prompt's **Acceptance questions** list.
3. Answer each question using **only the doc + its cross-linked siblings**. No reading source files.
4. Any question you cannot answer means the doc is under-specified. **Patch the doc** (not the prompt, not yet) and re-check.
5. Only after every acceptance question passes, move on.

After the whole set passes self-check, spot-check by asking a fresh Claude.ai Project (with just `New Project Documents/` attached) 10 real implementation questions. If any fail, log in each affected prompt's `Prompt drift log` section and schedule a prompt-level fix.

---

## Output location

Save every generated document to:

```
OwnMyHealth/
├── New Project Documents/     ← attach THIS folder to Claude.ai Project
│   ├── ENV_VARS.md
│   ├── DATA_MODEL.md
│   ├── PHI_TAXONOMY.md
│   ├── ROUTING_TABLE.md
│   ├── ARCHITECTURE.md
│   ├── API_REFERENCE.md
│   ├── LOCAL_DEV.md
│   ├── ERROR_RECOVERY.md
│   ├── RUNBOOK.md
│   ├── TROUBLESHOOTING.md
│   ├── TESTING_PATTERNS.md
│   ├── FRONTEND_MAP.md
│   ├── CHANGELOG.md
│   ├── KNOWN_ISSUES.md
│   ├── SECURITY_AUDIT_core.md
│   ├── SECURITY_AUDIT_domain.md
│   ├── SECURITY_AUDIT_infrastructure.md
│   ├── SECURITY_AUDIT_periphery.md
│   ├── SECURITY_STATUS.md
│   ├── HIPAA_CHECKLIST.md
│   ├── STRATEGY.md
│   ├── FINANCIAL_TRACKER.md
│   └── INDEX.md               ← auto-regenerated last; navigation + one-liner per doc
└── prompts/
    └── [these prompt files]
```

---

## Refresh schedule

| Document | Frequency | Trigger |
|---|---|---|
| `ENV_VARS.md` | Per PR touching `config/index.ts` or `.env.example` | diff detection |
| `DATA_MODEL.md` | Per PR touching `schema.prisma` or migrations | diff detection |
| `PHI_TAXONOMY.md` | Per PR touching `PHI_FIELDS` or encrypted columns | diff detection |
| `ROUTING_TABLE.md` | Per PR touching `backend/src/routes/` or middleware chain | diff detection |
| `ARCHITECTURE.md` | When architecture changes | manual |
| `API_REFERENCE.md` | Per API change | diff detection |
| `LOCAL_DEV.md` | Semi-annual | schedule |
| `ERROR_RECOVERY.md` | Per PR adding/changing error codes | diff detection |
| `RUNBOOK.md` | When infra changes | manual |
| `TROUBLESHOOTING.md` | After solving a notable problem | manual |
| `TESTING_PATTERNS.md` | When test helpers change | diff detection |
| `FRONTEND_MAP.md` | Semi-annual | schedule |
| `CHANGELOG.md` | Per release | release tag |
| `KNOWN_ISSUES.md` | Weekly | schedule |
| `SECURITY_STATUS.md` | Monthly or after audits | schedule + trigger |
| `HIPAA_CHECKLIST.md` | Quarterly | schedule |
| `STRATEGY.md` | Quarterly | schedule |
| `FINANCIAL_TRACKER.md` | Monthly | schedule |

Out-of-date docs produce wrong Claude Project answers. Treat doc drift as a bug (see `_doc-quality.md` "Prompt drift log" rule).
