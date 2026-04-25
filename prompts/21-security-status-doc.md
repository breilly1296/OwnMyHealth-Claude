---
tags:
  - documentation
  - security
type: prompt
priority: 1
updated: 2026-04-24
---

# Generate SECURITY_STATUS.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_review-protocol.md`](./_review-protocol.md) — severity rubric this doc synthesizes.
3. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
4. [`_phi-inventory.md`](./_phi-inventory.md) — PHI scope.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/SECURITY_STATUS.md` — the **current-state security posture reference** (not a history log). It synthesizes the findings from the security audit prompts (01-13 + 26-32, orchestrated by `24-full-security-audit.md`) and any pre-existing `SECURITY_AUDIT_*.md` outputs, and reports:

- One-page severity summary
- Open findings with remediation plan + owner + ETA
- Closed findings mapped to closing PRs (most recent release cycle)
- Controls status per area
- BAA inventory
- Next-audit trigger

A Claude Project reader must be able to answer "what's open? what's critical? what's the plan?" from this doc alone.

---

## Files to review

| File | Why read it |
|---|---|
| Existing `New Project Documents/SECURITY_AUDIT_core.md`, `SECURITY_AUDIT_domain.md`, `SECURITY_AUDIT_infrastructure.md`, `SECURITY_AUDIT_periphery.md` | **Primary** — these are the per-area outputs; synthesize, don't re-audit. |
| `New Project Documents/HIPAA_CHECKLIST.md` | Compliance posture. |
| Project memory (PR #30 → C-1/F-14/F-15, BYPASSRLS C-8 plan, Anthropic BAA) | Status cross-checks. |
| Git log PRs since last audit | Closing-PR map. |
| `backend/src/middleware/*.ts`, `backend/src/services/encryption.ts`, `auditLog.ts`, `database.ts` | Spot-check current controls before declaring ✅. |

---

## Required sections

1. **Header** — last-updated ISO date, last-audit date + tool, security grade.
2. **Posture summary** — severity counts (Critical / High / Medium / Low / Info), open vs fixed.
3. **Open findings** — per finding: ID (C-N, H-N, M-N), title, area, severity, evidence (file:line), remediation plan, ETA, owner.
4. **Closed in current cycle** — per finding: ID, closing PR, commit, verification note.
5. **Controls status** — one table per area: Auth, CSRF, RBAC, Encryption, PHI handling, RLS, Audit logging, Rate limiting, Input validation, External APIs, File storage, Logging & observability, Error handling, Data portability, Admin, Provider collaboration, AI integration.
6. **BAA inventory** — table (vendor, service, status, date).
7. **Incidents** — any security incidents since prior cycle + what was learned.
8. **Compliance status** — GCP / Anthropic BAA, HIPAA technical safeguards, SOC 2 roadmap.
9. **Posture trendline** — severity-count-by-cycle table (this cycle vs prior 2-3).
10. **Next-audit trigger** — under what condition to re-run `24-full-security-audit.md`.
11. **Related Documents**.
12. **Prompt drift log**.

---

## Required artifacts

### Posture summary

| Severity | Open | Closed this cycle | Total discovered |
|---|---|---|---|
| Critical | N | M | K |
| High | N | M | K |
| Medium | N | M | K |
| Low | N | M | K |
| Info | N | M | K |

### Open findings entry template

```markdown
### C-8 — RLS policies inert at runtime (Critical)

- **Area**: infrastructure
- **Evidence**: `backend/src/services/database.ts:Lxx` (app connects as BYPASSRLS role in dev + prod).
- **Impact**: RLS policies do not actually enforce; if app-layer filtering is compromised, all user data is reachable.
- **Remediation plan**: 4-PR sequence — see `C8_PART3_RUNBOOK.md` and `C8_PART3_STARTUP_ASSERTION.md` in `New Project Documents/`.
- **Owner**: TBD (external: infra owner)
- **ETA**: TBD (external: after PR #30 C-1 work)
- **Cross-link**: [`DATA_MODEL.md#rls-policies`](./DATA_MODEL.md), [`HIPAA_CHECKLIST.md#164312a`](./HIPAA_CHECKLIST.md).
```

### Closed findings table

| Finding | Severity | Closing PR | Date | Verification |
|---|---|---|---|---|
| C-1 — `set_config` outside transaction | Critical | PR #30 | 2026-04-16 | Regression test in `backend/src/services/rls.test.ts:Lxx` |
| ... | ... | ... | ... | ... |

### Controls status (one table per area)

Example (Encryption):

| Control | Status | Evidence | Notes |
|---|---|---|---|
| AES-256-GCM PHI at rest | ✅ | `backend/src/services/encryption.ts:Lxx` | See `PHI_TAXONOMY.md` for per-field coverage |
| Per-user key derivation | ✅ | `backend/src/services/userEncryption.ts:Lxx` | PBKDF2-SHA512 |
| Key rotation procedure | 🟡 | — | Not yet documented — see `RUNBOOK.md` TBD |
| TLS in transit | ✅ | Cloud Run HTTPS-only | — |

### Posture trendline

| Cycle | Critical open | High open | Medium open | Low open |
|---|---|---|---|---|
| 2026-04-24 | N | N | N | N |
| 2026-03-xx | N | N | N | N |
| 2026-02-xx | N | N | N | N |

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc + siblings**:

1. What's the current security grade, and what changed this cycle?
2. What critical findings are open today? What's the plan for each?
3. Which closed this cycle, and in which PR?
4. What's the status of C-7 (PHI-to-Claude minimization) and C-8 (BYPASSRLS runtime)?
5. Which controls are ✅ vs 🟡 vs ⚠️ today?
6. Which BAAs are signed, and which are pending?
7. When was the last audit, and what triggered the next one?
8. What's the verification for the most recent closed Critical?
9. How does audit logging coverage compare to `PHI_TAXONOMY.md` expectations?
10. What's the remediation owner for each open High finding?

---

## No-TBD enforcement

Before marking anything TBD:

- **Existing audits**: read `SECURITY_AUDIT_core.md`, `SECURITY_AUDIT_domain.md`, `SECURITY_AUDIT_infrastructure.md`, `SECURITY_AUDIT_periphery.md`. These files *are* the findings set — do not re-enumerate.
- **Closing PRs**: project memory + `git log --grep='C-N\|F-N\|H-N\|M-N'` to connect finding IDs to commits.
- **Control statuses**: spot-check the live code; `✅` means you verified in the last read, not just inherited from an older doc.
- **BAA status**: project memory + env gate (`ANTHROPIC_BAA_ACTIVE`).

Unresolvable external:

```
TBD (external: SOC 2 start date — ask compliance owner)
```

---

## Cross-links

The generated `SECURITY_STATUS.md` must link to:

- All 4 `SECURITY_AUDIT_*.md` outputs.
- [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).
- [`CHANGELOG.md`](./CHANGELOG.md) — closing PRs.
- [`DATA_MODEL.md`](./DATA_MODEL.md), [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — for evidence locations.
- [`RUNBOOK.md`](./RUNBOOK.md) — operational remediation steps.
- All 20 security audit prompts in `prompts/` (01-13, 26-32) — pointer for re-auditing.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Read audit outputs | Read | `New Project Documents/SECURITY_AUDIT_*.md` |
| Cross-check finding IDs | Grep | `pattern: "C-\\d+|H-\\d+|M-\\d+"` over `New Project Documents/**` |
| Closing PRs | Bash | `git log --all --grep='C-\\d\\+\\|F-\\d\\+' --pretty='%h %ad %s' --date=short` |
| Spot-check encryption | Read | `backend/src/services/encryption.ts` |
| Spot-check audit coverage | Grep | `pattern: "auditLog\\.log\\("` over `backend/src/**` |

---

## Output: file and location

Write the final document to `New Project Documents/SECURITY_STATUS.md`.
