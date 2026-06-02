---
tags:
  - documentation
  - strategy
type: prompt
priority: 2
updated: 2026-06-01
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

> **Note:** `New Project Documents/` is currently **empty** — this doc and its sibling docs (ARCHITECTURE, DATA_MODEL, API_REFERENCE, FINANCIAL_TRACKER, etc.) have not been generated yet. Cross-link to them as the canonical targets even though they don't exist on disk at generation time.

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
5. **AI integration strategy** — Claude use cases with file:line refs: biomarker guidance (`biomarkerRoutes.ts`), SBC/document extraction (`sbcExtraction.ts`, `claudeExtraction.ts`), expense cost analysis (`expenseController.ts`), and the conversational **Health Guide chat** (`aiRoutes.ts` → `aiChatController.ts`, SSE streaming). Dual BAA gates from memory/env (`ANTHROPIC_BAA_ACTIVE` for Claude, `GOOGLE_BAA_ACTIVE` for Document AI OCR). Cost controls: `aiLimiter` (one of 8 rate limiters), `aiSpendGuard` middleware + `aiCostTracker`/`usageTracker` services + budget env vars (`AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD`). The dedicated `anthropicClient.ts` wraps all calls.
6. **Provider collaboration strategy** — consent model, permission flags, scope of access. Cite `providerRoutes.ts`, `patientRoutes.ts`, `ProviderPatient` model (status enum `ProviderPatientStatus`, relation enum `ProviderRelationType`). Note: backend-complete with no provider-facing UI yet (per project memory feature-map) — flag the UI gap as a strategic open question.
6a. **Lab connection strategy (Quest FHIR)** — SMART-on-FHIR OAuth lab sync. Cite `fhirRoutes.ts` → `fhirController.ts`, `services/fhir/` (`smartAuth`, `labSyncService`, `loincMapper`, `fhirClient`, `urlSafety` SSRF guard), `LabConnection` model (encrypted `accessTokenEncrypted`/`refreshTokenEncrypted`), and the `QUEST_FHIR_*` env vars. Gated behind the `questFhirIntegration` plan feature.
6b. **Plan / tier strategy** — three tiers FREE / PRO / TEAM defined in `backend/src/config/plans.ts`; enforced by `planGating.ts` (`requirePlanLimit`, `requirePlanFeature`). No billing/Stripe yet (plans assigned manually via admin or DB). Treat pricing numbers in `plans.ts` as placeholders, not committed pricing.
7. **Roadmap** — derived from recent PR titles (last 6 months). Distinguish completed vs in-flight vs planned.
8. **Strategic decisions log** — major choices with rationale. Pull from commit bodies ("chose X because Y"), memory entries, and `CLAUDE.md`.
9. **Open strategic questions** — crisply stated with who needs to answer.
10. **User journey** — ASCII diagram: signup → email verify → onboarding wizard → first biomarker (or Quest FHIR lab sync) → dashboard → insurance upload → cost analysis → AI Health Guide → provider share. Reflect plan-tier gating where steps are restricted.
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
| Biomarker tracking (manual entry, history, trends, AI guidance) | `backend/src/routes/biomarkerRoutes.ts`, `Biomarker`/`BiomarkerHistory` models, `src/components/biomarkers/` | Shipped |
| Insurance management (SBC upload + Claude extraction) | `insuranceRoutes.ts`, `claudeExtraction.ts`, `sbcExtraction.ts`, `InsurancePlan`/`InsuranceBenefit` models | Shipped |
| Expense tracking (projections + actuals + AI cost analysis) | `expenseRoutes.ts`, `ExpenseProjection`/`ExpenseActual`/`CostAnalysis` models | Shipped |
| Health goals + needs | `healthGoalsRoutes.ts`, `healthNeedsRoutes.ts`, `HealthGoal`/`HealthNeed` models | Shipped |
| Provider-patient consent | `providerRoutes.ts`, `patientRoutes.ts`, `ProviderPatient` model | Shipped (no provider UI yet) |
| File management (lab reports + OCR) | `fileRoutes.ts`, `uploadRoutes.ts`, `fileController.ts` (list/download/delete), `controllers/upload/` (labUploadController/sbcUploadController), `ocrService.ts`, `pdfParser.ts` | Shipped |
| AI Health Guide chat (SSE streaming) | `aiRoutes.ts`, `aiChatController.ts`, `anthropicClient.ts`, `services/knowledge/` | Shipped |
| Quest FHIR lab connections (SMART-on-FHIR OAuth) | `fhirRoutes.ts`, `fhirController.ts`, `services/fhir/`, `LabConnection` model | Shipped |
| Onboarding wizard | `onboardingRoutes.ts`, `onboardingService.ts`, `src/components/onboarding/` | Shipped |
| Plan tiers / gating (FREE/PRO/TEAM, no billing) | `planRoutes.ts`, `config/plans.ts`, `middleware/planGating.ts` | Shipped |
| Admin panel | `adminRoutes.ts`, `src/components/admin/` | Shipped |
| Audit logging (7y retention) | `auditLog.ts` + scheduler, `AuditLog` model | Shipped |
| Email verification + password reset + email change | `authService.ts`, `emailService.ts`, `emailTemplates.ts` (migration `20260601_add_email_change`) | Shipped |
| Notification preferences | `notificationService.ts` (migration `20260417_add_notification_preferences`) | Shipped |
| Demo mode | `demoProtection.ts` | Shipped |

### Removed features table

| Feature | Removed (date) | Evidence | Reason |
|---|---|---|---|
| Health Scoring (0-100, risk assessments) | Jan 2025 (per `CLAUDE.md`) | Replaced by "Biomarkers in Range %" ratio | Over-promised advice / simpler surrogate |
| CMS Marketplace Integration | Jan 2025 | `git log --grep='marketplace'` | External dependency |
| Provider Directory | Jan 2025 | `git log --grep='provider directory'` | Moved to sibling project HealthcareProviderDB |
| DNA / Genetics (`DNAVariant`, `GeneticTrait` models + encrypted genotype/trait fields) | 2026-04-23 | Migration `20260423_drop_dna_genetics` — models no longer in `schema.prisma`; PHI fields removed from `encryption.ts` | Dropped feature (NOT deprecated — fully removed) |

> **Note:** `uploadController.ts` no longer exists either — upload logic now lives in the `controllers/upload/` directory (`labUploadController.ts`, `sbcUploadController.ts`), wired via `uploadRoutes.ts`; `fileController.ts` handles only file management (list/download/delete). If `CLAUDE.md` still lists `uploadController`, flag it as stale, not as a shipped feature.

### Deprecated (still in schema)

| Model/Feature | Evidence | Removal plan |
|---|---|---|
| `reminderFrequency` field / `ReminderFrequency` enum (per project memory: dead code) | `schema.prisma` enum `ReminderFrequency` | TBD — verify whether wired to any reminder feature; if unused, plan removal |

> Do not list DNA/Genetics here — those models were dropped in migration `20260423_drop_dna_genetics`. Verify the schema before adding any deprecated row; only models present in `schema.prisma` but unused belong here.

### Roadmap table (from PR titles)

| Status | Title / scope | Evidence |
|---|---|---|
| Shipped | C-1/F-14/F-15 RLS set_config in-transaction | PR #30, 2026-04-16 |
| Shipped | Anthropic BAA env gate | memory `ownmyhealth-project.md` |
| In flight | C-7 PHI-to-Claude minimization | `SECURITY_STATUS.md` |
| In flight | C-8 BYPASSRLS cutover | `C8_PART3_RUNBOOK.md` |

### User journey (ASCII)

```
  Register ──▶ Verify email ──▶ Login ──▶ Onboarding wizard ──▶ First biomarker entry
                                                                        │
                                          ┌──────────────────┐          ▼
                                          │ Connect Quest    │   Dashboard (In-range %)
                                          │ lab (FHIR OAuth) │          │
                                          └────────┬─────────┘          │
                                                   └──▶ Biomarkers auto-sync
                                                                        │
              ┌─────────────────────────────────────────┬──────────────┴──────────────┐
              ▼                                           ▼                             ▼
   Insurance SBC upload ──▶ Benefit search    AI Health Guide chat        Add health goal / need
              │                                                                        │
              ▼                                                                        ▼
     Cost analysis (AI)                                                    Grant provider access
              │                                                                        │
              ▼                                                                        ▼
     Expense projection                                                  Provider views scoped data
```

> Onboarding and Quest FHIR lab sync are gated by plan tier (`questFhirIntegration` is PRO/TEAM only). Reflect plan gating where journey steps are tier-restricted.

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. What's the mission in one sentence?
2. What are the major user-visible feature pillars live today (biomarkers, insurance/SBC, expenses, health goals/needs, provider sharing, AI Health Guide chat, Quest FHIR lab sync, onboarding)?
3. Which feature was removed in Jan 2025 and what replaced it? Which feature was fully dropped in 2026-04 (DNA/Genetics)?
4. Which features were fully removed/dropped (e.g., DNA/Genetics in migration `20260423_drop_dna_genetics`), and which models (if any) remain deprecated-but-present in `schema.prisma`?
5. What's the Anthropic BAA status (and the separate Google Document AI BAA status)?
6. How does provider access work (consent → permissions → revocation)?
7. What are the top 3 strategic risks?
8. What's the next on the roadmap (highest-priority in-flight)?
9. What's the current primary success metric (dashboard-level)?
10. What strategic questions remain open, and who needs to answer each?
11. What plan tiers exist (FREE/PRO/TEAM) and what gates each — and is billing wired yet?
12. What is the Quest FHIR lab-sync strategy, and which tier unlocks it?

---

## No-TBD enforcement

Before marking anything TBD:

- **Feature set**: cross-reference `CLAUDE.md` "Current Features" with code — every feature should have at least one route or service.
- **Roadmap**: run `git log --since='6 months ago' --grep='Merge pull request' --pretty='%ad %s' --date=short`. Every PR is a roadmap data point.
- **Removed features**: `git log --grep='remove|delete|drop' --pretty='%ad %s' --date=short`.
- **AI use cases**: read `claudeExtraction.ts`, `sbcExtraction.ts`, biomarker guidance endpoint (`biomarkerRoutes.ts`), expense cost analysis (`expenseController.ts`), and the Health Guide chat (`aiChatController.ts`).
- **BAA**: check both `ANTHROPIC_BAA_ACTIVE` (Claude) and `GOOGLE_BAA_ACTIVE` (Document AI) gates in `config/index.ts` + project memory.
- **Plan tiers / billing**: read `config/plans.ts` (FREE/PRO/TEAM) and `planGating.ts` — note prices are placeholders, no billing wired.

Legitimate external TBDs (and their resolution path):

- Mission wording → owner interview; stub with code-derived product description for now.
- Pricing tiers → tier *structure* (FREE/PRO/TEAM) and placeholder prices are in `config/plans.ts`; the *committed* prices + billing model (Stripe not wired) → `FINANCIAL_TRACKER.md` or owner; cross-link.
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
| AI sites | Grep | `pattern: "@anthropic-ai\|claudeExtraction\|sbcExtraction\|aiChatController\|anthropicClient"` over `backend/src/**` |
| AI cost controls | Grep | `pattern: "aiSpendGuard\|aiCostTracker\|usageTracker\|AI_DAILY_BUDGET"` over `backend/src/**` |
| FHIR / lab sync | Glob | `backend/src/services/fhir/*.ts`, `backend/src/routes/fhirRoutes.ts` |
| Plan tiers | Read | `backend/src/config/plans.ts` (FREE/PRO/TEAM + limits) |

---

## Questions to ask the user (last resort — after exhausting the search)

1. Crisp mission wording beyond code-derived product description.
2. Target persona(s) — solo patient? caregiver? provider-led rollout?
3. Committed pricing + business model (placeholder tiers/prices exist in `config/plans.ts`; no billing wired — confirm real numbers and whether Stripe is planned).
4. Strategic risks beyond those implied by open findings.
5. Any pivots or strategy changes not yet reflected in code.

---

## Output: file and location

Write the final document to `New Project Documents/STRATEGY.md`.
