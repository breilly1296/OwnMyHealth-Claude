---
tags:
  - documentation
  - strategy
type: prompt
priority: 2
updated: 2026-04-24
---

# Generate STRATEGY.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc must pass the five tests in `_doc-quality.md` before you stop.

Note: Strategy has more legitimately external facts than other docs (mission, pricing, runway decisions). The No-TBD rule still applies — derive everything derivable from code/CLAUDE.md/git log first, then mark remaining gaps with a clear external resolution path.

---

## Purpose

Produce `New Project Documents/STRATEGY.md` — the **product + business direction reference**. Mission, target user, current feature map (from code), removed/deprecated features (from code + CLAUDE.md), roadmap (from git log PR titles), strategic decisions (from commit messages + project memory), open questions.

---

## Files to review

| File | Why read it |
|---|---|
| `CLAUDE.md` | **Primary** — "Current Features", "Removed Features", "Deprecated" sections. Reconcile every feature name with code. |
| `README.md` | Product description, value prop. |
| Git log (`git log --grep='Merge pull request' --pretty='%ad %s' --date=short`) | PR milestones as roadmap evidence. |
| `New Project Documents/ARCHITECTURE.md`, `DATA_MODEL.md`, `API_REFERENCE.md` | Shipped capabilities (features that have API + schema + UI). |
| `FINANCIAL_TRACKER.md` (after generated) | Cross-link to economics. |
| Project memory (`ownmyhealth-project.md`, `url-validation-progress.md`, etc.) | Strategic context. |

---

## Required sections

1. **Mission / vision** — one paragraph derived from `README.md` + `CLAUDE.md`. If neither explicitly states a mission, quote what they do say and mark the crisp mission as `TBD (external: ...)`.
2. **Core principles** — from `CLAUDE.md` (privacy-first, consent-based, AI educational, no medical advice). Each principle cites the repo rule that enforces it.
3. **Target user** — derive from feature set. Mark explicit personas TBD if not in repo.
4. **Feature map** — three tables: Shipped, Removed, Deprecated. Every row cites code evidence.
5. **AI integration strategy** — Claude use cases with file:line refs (biomarker guidance, SBC extraction, cost analysis); BAA status from memory/env; cost controls (`aiLimiter`).
6. **Provider collaboration strategy** — consent model, permission flags, scope of access. Cite `providerRoutes.ts`, `ProviderPatient` model.
7. **Roadmap** — derived from recent PR titles (last 6 months). Distinguish completed vs in-flight vs planned.
8. **Strategic decisions log** — major choices with rationale. Pull from commit bodies ("chose X because Y"), memory entries, and `CLAUDE.md`.
9. **Open strategic questions** — crisply stated with who needs to answer.
10. **User journey** — ASCII diagram: signup → email verify → first biomarker → insurance upload → cost analysis → provider share.
11. **Competitive posture** — mark TBD if not in repo; provide resolution path.
12. **Success metrics** — link to the `Biomarkers in Range %` dashboard metric referenced in CLAUDE.md.
13. **Risks** — top 3-5 derived from `SECURITY_STATUS.md`, `KNOWN_ISSUES.md` + business (mark business risks TBD external).
14. **Related Documents**.
15. **Prompt drift log**.

---

## Required artifacts

### Shipped features table

| Feature | Code evidence (file:line / model) | Status |
|---|---|---|
| Biomarker tracking (manual entry, history, trends, AI guidance) | `backend/src/routes/biomarkerRoutes.ts`, `Biomarker` model, `src/components/biomarkers/` | Shipped |
| Insurance management (SBC upload + Claude extraction) | `insuranceRoutes.ts`, `claudeExtraction.ts`, `sbcExtraction.ts` | Shipped |
| Expense tracking (projections + actuals + AI cost analysis) | `expenseRoutes.ts`, `ExpenseProjection`/`ExpenseActual`/`CostAnalysis` models | Shipped |
| Health goals + needs | `healthGoalsRoutes.ts`, `healthNeedsRoutes.ts` | Shipped |
| Provider-patient consent | `providerRoutes.ts`, `patientRoutes.ts`, `ProviderPatient` model | Shipped |
| File management (lab reports + OCR) | `fileRoutes.ts`, `uploadRoutes.ts`, `ocrService.ts` | Shipped |
| Admin panel | `adminRoutes.ts` | Shipped |
| Audit logging (7y retention) | `auditLog.ts` + scheduler | Shipped |
| Email verification + password reset | `authService.ts`, `emailService.ts` | Shipped |
| Demo mode | `demoProtection.ts` | Shipped |

### Removed features table

| Feature | Removed (date) | Evidence | Reason |
|---|---|---|---|
| Health Scoring (0-100, risk assessments) | Jan 2025 (per `CLAUDE.md`) | Replaced by "Biomarkers in Range %" ratio | Over-promised advice / simpler surrogate |
| CMS Marketplace Integration | Jan 2025 | `git log --grep='marketplace'` | External dependency |
| Provider Directory | Jan 2025 | `git log --grep='provider directory'` | Moved to sibling project HealthcareProviderDB |

### Deprecated (still in schema)

| Model/Feature | Evidence | Removal plan |
|---|---|---|
| `DNAData`, `DNAVariant`, `GeneticTrait` | `backend/prisma/schema.prisma:Lxx` | TBD (external: confirm with owner whether DNA features return) |

### Roadmap table (from PR titles)

| Status | Title / scope | Evidence |
|---|---|---|
| Shipped | C-1/F-14/F-15 RLS set_config in-transaction | PR #30, 2026-04-16 |
| Shipped | Anthropic BAA env gate | memory `ownmyhealth-project.md` |
| In flight | C-7 PHI-to-Claude minimization | `SECURITY_STATUS.md` |
| In flight | C-8 BYPASSRLS cutover | `C8_PART3_RUNBOOK.md` |

### User journey (ASCII)

```
  Register ──▶ Verify email ──▶ Login ──▶ First biomarker entry
                                                │
                                                ▼
                                      Dashboard (In-range %)
                                                │
              ┌─────────────────────────────────┴──────────────────────────┐
              ▼                                                             ▼
   Insurance SBC upload ──▶ Benefit search                 Add health goal / need
              │                                                             │
              ▼                                                             ▼
     Cost analysis (AI)                                      Grant provider access
              │                                                             │
              ▼                                                             ▼
     Expense projection                                     Provider views scoped data
```

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. What's the mission in one sentence?
2. What four user-visible feature pillars are live?
3. Which feature was removed in Jan 2025 and what replaced it?
4. Which models remain deprecated in `schema.prisma`?
5. What's the Anthropic BAA status?
6. How does provider access work (consent → permissions → revocation)?
7. What are the top 3 strategic risks?
8. What's the next on the roadmap (highest-priority in-flight)?
9. What's the current primary success metric (dashboard-level)?
10. What strategic questions remain open, and who needs to answer each?

---

## No-TBD enforcement

Before marking anything TBD:

- **Feature set**: cross-reference `CLAUDE.md` "Current Features" with code — every feature should have at least one route or service.
- **Roadmap**: run `git log --since='6 months ago' --grep='Merge pull request' --pretty='%ad %s' --date=short`. Every PR is a roadmap data point.
- **Removed features**: `git log --grep='remove|delete|drop' --pretty='%ad %s' --date=short`.
- **AI use cases**: read `claudeExtraction.ts`, `sbcExtraction.ts`, biomarker guidance endpoint.
- **BAA**: check `ANTHROPIC_BAA_ACTIVE` gate in code + project memory.

Legitimate external TBDs (and their resolution path):

- Mission wording → owner interview; stub with code-derived product description for now.
- Pricing tiers → `FINANCIAL_TRACKER.md` or owner; cross-link.
- Competitive positioning → external research; mark.
- Fundraising / grants → external.

---

## Cross-links

The generated `STRATEGY.md` must link to:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how shipped features map to components.
- [`API_REFERENCE.md`](./API_REFERENCE.md) — endpoints per feature.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — models backing each feature.
- [`FINANCIAL_TRACKER.md`](./FINANCIAL_TRACKER.md) — unit economics + runway.
- [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) — strategic risks.
- [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) — compliance maturity.
- [`CHANGELOG.md`](./CHANGELOG.md) — shipped milestones.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| PR history | Bash | `git log --since='6 months ago' --grep='Merge pull request' --pretty='%ad %s' --date=short` |
| Feature existence check | Grep | per feature, grep for route handler and model |
| Removed features | Bash | `git log --grep='remove\|delete\|drop' --pretty='%ad %s' --date=short` |
| Read CLAUDE.md | Read | `CLAUDE.md` |
| Read README | Read | `README.md` |
| AI sites | Grep | `pattern: "@anthropic-ai|claudeExtraction|sbcExtraction"` over `backend/src/**` |

---

## Questions to ask the user (last resort — after exhausting the search)

1. Crisp mission wording beyond code-derived product description.
2. Target persona(s) — solo patient? caregiver? provider-led rollout?
3. Pricing tiers and business-model choice (if not in `FINANCIAL_TRACKER.md`).
4. Strategic risks beyond those implied by open findings.
5. Any pivots or strategy changes not yet reflected in code.

---

## Output: file and location

Write the final document to `New Project Documents/STRATEGY.md`.
