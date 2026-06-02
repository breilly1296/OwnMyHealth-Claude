---
tags:
  - documentation
  - security
type: prompt
priority: 1
updated: 2026-06-01
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
| `backend/src/middleware/*.ts` (incl. `aiSpendGuard.ts`, `rateLimiter.ts` (8 limiters), `rateLimitStore.ts`, `planGating.ts`), `backend/src/services/encryption.ts`, `auditLog.ts`, `database.ts` (`assertNoBypassRLS`), `config/index.ts` (BAA gates), `services/fhir/urlSafety.ts` (SSRF), `utils/phiRedaction.ts` | Spot-check current controls before declaring ✅. |

---

## Required sections

1. **Header** — last-updated ISO date, last-audit date + tool, security grade.
2. **Posture summary** — severity counts (Critical / High / Medium / Low / Info), open vs fixed.
3. **Open findings** — per finding: ID (C-N, H-N, M-N), title, area, severity, evidence (file:line), remediation plan, ETA, owner.
4. **Closed in current cycle** — per finding: ID, closing PR, commit, verification note.
5. **Controls status** — one table per area: Auth, CSRF, RBAC, Encryption, PHI handling, RLS, Audit logging, Rate limiting (8 named limiters in `rateLimiter.ts`, backed by `rateLimitStore.ts`), Input validation, External APIs, File storage, Logging & observability (PHI redaction in `utils/phiRedaction.ts` / `utils/pdfRedaction.ts`), Error handling, Data portability, Admin, Provider collaboration, AI integration (BAA gate + `aiSpendGuard` budget circuit breaker), Quest FHIR / lab connections (SMART-on-FHIR OAuth, encrypted `LabConnection` tokens, `fhir/urlSafety` SSRF guard), Plan gating / billing tiers (`planGating`, `config/plans.ts`).
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
### C-8 — RLS not enforced under a BYPASSRLS login (Critical → partially mitigated)

- **Area**: infrastructure
- **Evidence**: `backend/src/services/database.ts` — `assertNoBypassRLS()` (~L218) runs at startup: **production** hard-exits (`process.exit(1)`, ~L250) if the DB role has BYPASSRLS; **non-production** logs a WARNING and continues (~L258). RLS policies live in migration `20260107_add_rls_policies`; later fixes in `20260529_fix_has_provider_access` and `20260530_add_users_select_provider`.
- **Impact**: With a BYPASSRLS login, RLS policies do not enforce and app-layer filtering is the only barrier. The startup assertion closes this for production; dev/staging can still run BYPASSRLS (warning only).
- **Remediation plan**: verify the deployed Cloud SQL role is NOBYPASSRLS; close out the residual non-prod warning path; confirm `withRLSContext`/`withRLSTransaction` carry `SET LOCAL` on every query.
- **Owner**: TBD (external: infra owner)
- **ETA**: TBD (external: confirm prod role + dev/staging cutover)
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
- **BAA status**: project memory + env gates (`ANTHROPIC_BAA_ACTIVE` for Claude, `GOOGLE_BAA_ACTIVE` for Document AI OCR). Both gates are read in `backend/src/config/index.ts` (~L176, ~L185) and enforced at runtime: production startup throws if a key is configured without its BAA flag (~L300-330); the Claude gate is re-checked per-call in `biomarkerRoutes`, `aiChatController`, `claudeExtraction`, `sbcExtraction`, and `expenseController`, and the OCR gate in `ocrService`.

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
| Spot-check audit coverage | Grep | `pattern: "\\.log(Access\|Create\|Update\|Delete\|Auth\|Export\|System)?\\("` over `backend/src/**` — `AuditLogService` (`services/auditLog.ts`) exposes `log`, `logAccess`, `logCreate`, `logUpdate`, `logDelete`, `logAuth`, `logExport`, `logSystem` |

---

## Output: file and location

Write the final document to `New Project Documents/SECURITY_STATUS.md`.
