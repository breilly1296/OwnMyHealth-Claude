---
tags:
  - documentation
  - meta
type: prompt
priority: 2
updated: 2026-08-01
---

# Full Documentation Refresh

## Required reading before generating

Before running any doc prompt, read:

1. [`_doc-quality.md`](./_doc-quality.md) — quality bar every output doc must pass.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — PHI canonical list.

---

## Before you run this: the regeneration gate (2026-08-01)

**Default to a surgical patch instead of this prompt.** Two findings from
`analysis/codebase-scrutiny-2026-07/` bind here:

> "**Stop regenerating** full doc sets until P0 engineering closes; prefer surgical updates."
> — `10-documentation-pathology.md:67`

> Explicit non-goal until P0 clears: "Another full multi-agent 'security theater' doc refresh."
> — `11-priority-fix-list.md:68`

The doc set already runs to ~24K lines across ~120 files. Past a certain point, regenerating it
buries the pages that actually changed and re-dates pages whose facts did not.

Run the **full** refresh only when:

- a **posture reactivation** fired (see `OPEN_FINDINGS.md` §Posture) — the deployment framing in
  `ARCHITECTURE`, `RUNBOOK`, `ENV_VARS`, and `LOCAL_DEV` all invert simultaneously; **or**
- the doc set is being stood up from an empty/near-empty folder; **or**
- a full re-read shows **> ~30%** of the set is stale — measured against the current
  `_drift-audit-*.md`, not assumed.

For anything smaller: read the drift audit, open the 2-4 docs it names, patch the cited sections,
bump their stamps, and stop. Record what you patched. See `_doc-quality.md` §"Before you generate".

## Purpose

Orchestrate a full refresh of `New Project Documents/`. The output set, in its entirety, must be rich enough to serve as a Claude.ai Project context **substitute for the full GitHub repo** (which has outgrown Projects' attachment limit).

This prompt is a runner, not a doc generator. It sequences the 19 doc prompts (14-23 plus the 33-40 deep-reference layer and the 46 biomarker-series deep reference) so each run benefits from the context the earlier ones produced.

> **Current state (2026-08-01):** `New Project Documents/` is **populated** — it holds the full doc set plus `OPEN_FINDINGS.md` (the authoritative ledger), a `security-reviews/` subfolder, and a `Go-To-Market/` pack. The 19 doc prompts (14-23, 33-40, 46) write the named docs here; the security prompts write review reports under `security-reviews/`, which currently holds **25 reports covering 01-13, 26-32, 41-45** (all dated 2026-07-14). The new prompts **47-49 have no review report yet** — close that with three targeted runs, not a full refresh. Because the folder is populated, a run is an **incremental refresh that supersedes existing docs** — which is exactly why the regeneration gate above applies. Verify what is on disk (`Glob "New Project Documents/*.md"`) before relying on a sibling. Do **not** assume any out-of-band reports (e.g. teardown / UX-review files) are present, and cross-link only to docs this prompt family actually produces. Verify what is on disk (`Glob "New Project Documents/*.md"`) before relying on a sibling.

Before sequencing, verify the live codebase counts in [`00-index.md`](./00-index.md) ("Verified codebase counts") so each generated doc starts from accurate totals. Several product domains added in the prompt era — Quest FHIR / lab connections, AI chat + AI cost/spend control, onboarding, email-change, notification preferences, and plan gating / billing tiers — are in code and must be reflected across the generated set (especially `DATA_MODEL.md`, `ROUTING_TABLE.md`, `ENV_VARS.md`, `ARCHITECTURE.md`, `API_REFERENCE.md`, and `FRONTEND_MAP.md`).

Beyond that snapshot, a re-run must also capture the post-2026-06-01 change wave — these are the new realities each generated doc should reflect:

- **Biomarker time-series merge** — every write path (manual create, bulk upload, FHIR sync) now funnels through `upsertBiomarkerReading` so a metric accumulates one series instead of disconnected single-point rows (`backend/src/services/biomarkerSeries.ts:81`); see the new `BIOMARKER_SERIES.md` deep reference. Reflect in `DATA_MODEL.md`, `API_REFERENCE.md`, `KNOWN_ISSUES.md`.
- **Cross-instance token revocation** — `users.tokens_valid_after` + the `revoked_access_tokens` table + refresh-reuse family revoke (migrations `20260606000002_add_tokens_valid_after`, `20260613_revoked_access_tokens`). Reflect in `DATA_MODEL.md`, `ROUTING_TABLE.md`, `SECURITY_STATUS.md`; see the new `44-token-revocation` security prompt.
- **FORCE ROW LEVEL SECURITY on all 19 RLS tables + DB-enforced 7-year audit retention** (`20260613_force_rls_and_audit_retention`); `database.ts` `assertRLSForced()` hard-exits on boot. Reflect in `DATA_MODEL.md`, `SECURITY_STATUS.md`, `HIPAA_CHECKLIST.md`.
- **Encrypted-PHI expansion** — audit-metadata moved to `metadataEncrypted` with the legacy plaintext `audit_logs.metadata` column **irreversibly dropped** (`20260615_drop_legacy_audit_metadata`, M6); `UserFile.originalFilenameEncrypted` (L24, `20260615_encrypt_userfile_original_filename`); goal-value encryption — `HealthGoal.currentValueEncrypted`/`startValueEncrypted`, `GoalProgressHistory.valueEncrypted` (M4, `20260613_encrypt_goal_values`). `PHI_FIELDS` is now 14 models / 39 fields. Reflect in `PHI_TAXONOMY.md`, `DATA_MODEL.md`, `HIPAA_CHECKLIST.md`; see the new `45-maintenance-jobs` prompt for the `backfill-userfile-filenames` job.
- **Deploy / runtime topology** — migrations run as the Cloud Run job `ownmyhealth-migrate` (boot-migrate removed); `backend/Dockerfile` CMD is `["node","dist/app.js"]`; deploy is gated on CI (`needs: ci` in `.github/workflows/deploy.yml`); base image is Node 22-alpine (digest-pinned), up from Node 20. Reflect in `RUNBOOK.md`, `LOCAL_DEV.md`, `ARCHITECTURE.md`, `CHANGELOG.md`.

---

## Documentation set

Every prompt below produces exactly one file in `New Project Documents/`.

### Deep-reference layer (33-40) — run first

These fill the gaps that make the rest of the set self-sufficient. Later docs cross-link into these.

- [ ] [35-env-vars-doc](./35-env-vars-doc.md) → `ENV_VARS.md`
- [ ] [33-data-model-doc](./33-data-model-doc.md) → `DATA_MODEL.md`
- [ ] [40-phi-taxonomy-doc](./40-phi-taxonomy-doc.md) → `PHI_TAXONOMY.md`
- [ ] [34-routing-table-doc](./34-routing-table-doc.md) → `ROUTING_TABLE.md`
- [ ] [46-biomarker-series](./46-biomarker-series.md) → `BIOMARKER_SERIES.md` (data-integrity deep reference; run after DATA_MODEL, before API_REFERENCE — it cross-links into both plus the FHIR layer)

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
5. **BIOMARKER_SERIES** — data-integrity deep reference for the time-series merge primitive; depends on DATA_MODEL, cross-links into API_REFERENCE + the FHIR layer (run before both).
6. **ARCHITECTURE** — system overview; cross-links into all four reference docs above.
7. **API_REFERENCE** — contract-facing; cross-links to ROUTING_TABLE, DATA_MODEL, PHI_TAXONOMY, BIOMARKER_SERIES.
8. **LOCAL_DEV** — uses ENV_VARS, DATA_MODEL, API_REFERENCE.
9. **ERROR_RECOVERY** — codes + recovery; cross-links to API_REFERENCE + ROUTING_TABLE.
10. **RUNBOOK** — operational; cross-links to ENV_VARS, ARCHITECTURE, ERROR_RECOVERY.
11. **TROUBLESHOOTING** — cross-links to ERROR_RECOVERY + RUNBOOK.
12. **TESTING_PATTERNS** — cross-links to DATA_MODEL, ROUTING_TABLE, LOCAL_DEV.
13. **FRONTEND_MAP** — cross-links to API_REFERENCE.
14. **CHANGELOG** — git-log-driven.
15. **KNOWN_ISSUES** — code-marker-driven; cross-links to SECURITY_STATUS.
16. **(optional)** Re-run `24-full-security-audit` if due.
17. **SECURITY_STATUS** — synthesizes `SECURITY_AUDIT_*.md`.
18. **HIPAA_CHECKLIST** — technical safeguards; cross-links to PHI_TAXONOMY, DATA_MODEL, SECURITY_STATUS.
19. **STRATEGY** — synthesizes current feature set (cross-links to everything).
20. **FINANCIAL_TRACKER** — unit economics; cross-links to ROUTING_TABLE (rate limits cap cost) + ENV_VARS.

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
│   ├── BIOMARKER_SERIES.md
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
| `BIOMARKER_SERIES.md` | Per PR touching `biomarkerSeries.ts`, `labSyncService.ts`, or biomarker write paths | diff detection |
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
