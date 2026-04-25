# OwnMyHealth — Claude Project Documents

**Generated**: 2026-04-24
**Last updated**: 2026-04-25 (HIPAA documentation drafting pass — 6 policy drafts + 2 supporting SOPs)
**Purpose**: this folder is attached to a Claude.ai Project as a substitute for the full GitHub repo (which has outgrown Projects' attachment limit). Every doc here is designed to be answerable on its own plus its cross-linked siblings, with file:line citations. Quality standard: see `prompts/_doc-quality.md`.

---

## How to read this doc set

A reader (or Claude) with only these 32 files must be able to answer real implementation questions about the codebase without opening source. Each doc either:

- Is a **structural reference** (ENV_VARS, DATA_MODEL, ROUTING_TABLE, API_REFERENCE, PHI_TAXONOMY, FRONTEND_MAP)
- Is a **narrative overview** (ARCHITECTURE, STRATEGY)
- Is an **operational guide** (LOCAL_DEV, RUNBOOK, ERROR_RECOVERY, TROUBLESHOOTING, TESTING_PATTERNS)
- Tracks **posture and history** (CHANGELOG, KNOWN_ISSUES, SECURITY_STATUS, HIPAA_CHECKLIST, SECURITY_AUDIT_*, FINANCIAL_TRACKER)
- Provides **HIPAA policy and legal artifacts** (RISK_ASSESSMENT, BREACH_NOTIFICATION_PLAN, SECURITY_POLICIES, CONTINGENCY_PLAN, SANCTION_POLICY, WORKFORCE_SECURITY_SOP, PRIVACY_POLICY_DRAFT, TERMS_OF_SERVICE_DRAFT)
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
| "what's our reasonable-threats analysis?" (§164.308(a)(1)(ii)(A)) | [RISK_ASSESSMENT.md](./RISK_ASSESSMENT.md) |
| "what do we do when a breach is suspected?" (§164.400-414) | [BREACH_NOTIFICATION_PLAN.md](./BREACH_NOTIFICATION_PLAN.md) |
| "what are our written security policies?" (§164.316) | [SECURITY_POLICIES.md](./SECURITY_POLICIES.md) |
| "how do we recover from a disaster / outage?" (§164.308(a)(7)) | [CONTINGENCY_PLAN.md](./CONTINGENCY_PLAN.md) |
| "what consequences for policy violations?" (§164.308(a)(1)(ii)(C)) | [SANCTION_POLICY.md](./SANCTION_POLICY.md) |
| "how do we onboard / offboard people with PHI access?" (§164.308(a)(3)/(a)(4)) | [WORKFORCE_SECURITY_SOP.md](./WORKFORCE_SECURITY_SOP.md) |
| "what's our public privacy notice?" (§164.520) | [PRIVACY_POLICY_DRAFT.md](./PRIVACY_POLICY_DRAFT.md) |
| "what are our terms of service?" | [TERMS_OF_SERVICE_DRAFT.md](./TERMS_OF_SERVICE_DRAFT.md) |

---

## Document catalog (32 files)

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
| 16 | [SECURITY_STATUS.md](./SECURITY_STATUS.md) | `prompts/21-security-status-doc.md` | Grade **B+**, 0 Critical open (C-8 code-complete pending operator role cutover), 0 High open, ~4 Medium deferred-design items; 17 control areas tallied |
| 17 | [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) | `prompts/22-hipaa-checklist-doc.md` | Technical Safeguards 6✅/3🟡 (access control 🟡 pending C-8 operator cutover); BAAs; admin/physical TBD (external) |
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

### HIPAA policy and legal artifacts (drafted 2026-04-25)

These documents satisfy the Administrative-Safeguard documentation
requirements at §164.308(a)(1)(ii), §164.308(a)(3), §164.308(a)(6-7),
§164.316, §164.400-414, and §164.520. The 6 marked `🟡 Draft` are
internal-review-ready; the 2 marked **legal review required** must be
attorney-approved before publication.

| # | File | HIPAA citation | Status |
|---|---|---|---|
| 25 | [RISK_ASSESSMENT.md](./RISK_ASSESSMENT.md) | §164.308(a)(1)(ii)(A) Risk Analysis | 🟡 Draft v1.0 |
| 26 | [BREACH_NOTIFICATION_PLAN.md](./BREACH_NOTIFICATION_PLAN.md) | §164.400-414 Breach Notification Rule | 🟡 Draft v1.0 |
| 27 | [SECURITY_POLICIES.md](./SECURITY_POLICIES.md) | §164.316 Policies and Procedures | 🟡 Draft v1.0 |
| 28 | [CONTINGENCY_PLAN.md](./CONTINGENCY_PLAN.md) | §164.308(a)(7) Contingency Plan (incl. restore-drill runbook) | 🟡 Draft v1.0 |
| 29 | [SANCTION_POLICY.md](./SANCTION_POLICY.md) | §164.308(a)(1)(ii)(C) Sanction Policy | 🟡 Draft v1.0 |
| 30 | [WORKFORCE_SECURITY_SOP.md](./WORKFORCE_SECURITY_SOP.md) | §164.308(a)(3)/(a)(4) Workforce Security & Information Access Management | 🟡 Draft v1.0 |
| 31 | [PRIVACY_POLICY_DRAFT.md](./PRIVACY_POLICY_DRAFT.md) | §164.520 Notice of Privacy Practices | 🟡 Draft v0.1 — **legal review required** |
| 32 | [TERMS_OF_SERVICE_DRAFT.md](./TERMS_OF_SERVICE_DRAFT.md) | Contractual basis (companion to NPP) | 🟡 Draft v0.1 — **legal review required** |

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

## Findings summary — current cycle

Updated 2026-04-25 (post-Lows-sweep + HIPAA documentation drafting).

| Severity | Open | Code-complete (operator-pending) | Closed this cycle | Total |
|---|---:|---:|---:|---:|
| Critical | **0** | 1 (C-8 — runtime RLS) | 7 | 8 |
| High | **0** | 0 | ~22 | ~22 |
| Medium | ~4 (deferred design) | 0 | ~33 | ~37 |
| Low | **0** | 0 | ~28 | ~28 |

**Security grade**: `B+` (held through the 2026-04-25 Lows sweep — Lows
don't move the risk profile; was `B-` early in the cycle, `D` baseline
2026-04-15).

**HIPAA Administrative-Safeguard documentation**: ⏳ → 🟡 — six policy
drafts (Risk Assessment, Breach Notification, Security Policies,
Privacy Policy, Terms of Service, Contingency Plan) plus two
supporting SOPs (Sanction Policy, Workforce Security SOP) drafted
2026-04-25. See [SECURITY_STATUS.md § 7.4](./SECURITY_STATUS.md#74-hipaa-administrative-safeguards-164308).

The full closures list, evidence, and per-finding verification anchors live in
[SECURITY_STATUS.md § 3](./SECURITY_STATUS.md#3-closed-in-current-cycle),
including the new "[2026-04-25 — Low closures](./SECURITY_STATUS.md#2026-04-25-remediation-pass--low-closures)" sub-section.

## Suggested next actions

In rough priority order. Items struck through have closed since the last regen.

1. **C-8 operator cutover** — provision `omh_app` NOBYPASSRLS role in Cloud SQL,
   rotate `DATABASE_URL` in Secret Manager, deploy. The startup assertion at
   `database.ts:200-265` is unconditional in prod (no env-var opt-out) — any
   rollback will hard-exit. Runbook in
   [SECURITY_STATUS.md § 2](./SECURITY_STATUS.md#2-open-findings) and
   [C8_PART3_RUNBOOK.md](./C8_PART3_RUNBOOK.md).
2. **Resolve `[CONFIRM]` markers across the new HIPAA documents** —
   each draft enumerates them at the bottom (Cloud SQL retention, PITR,
   GCS versioning, DNS registrar, master-key paper backup, workstation
   FDE, status-page provisioning, etc.). Most are GCP Console reads +
   operator decisions, not code changes. See:
   [RISK_ASSESSMENT.md](./RISK_ASSESSMENT.md#items-requiring-confirmation),
   [CONTINGENCY_PLAN.md](./CONTINGENCY_PLAN.md#items-requiring-confirmation),
   [TERMS_OF_SERVICE_DRAFT.md](./TERMS_OF_SERVICE_DRAFT.md#items-requiring-confirmation),
   [WORKFORCE_SECURITY_SOP.md](./WORKFORCE_SECURITY_SOP.md).
3. **Legal review of the two pre-publication drafts** —
   [PRIVACY_POLICY_DRAFT.md](./PRIVACY_POLICY_DRAFT.md) and
   [TERMS_OF_SERVICE_DRAFT.md](./TERMS_OF_SERVICE_DRAFT.md). Specific
   `[LEGAL REVIEW]` sections are flagged inline.
4. **External penetration test** — third-party scoped against the live
   staging deploy (post-C-8 cutover). Tracked in
   [RISK_ASSESSMENT.md § 6.1 row 5](./RISK_ASSESSMENT.md#61-pre-beta-must-close-before-live-phi).
5. **First Contingency-Plan restore drill** — scheduled 2026-07-25;
   step-by-step runbook in
   [CONTINGENCY_PLAN.md § 6](./CONTINGENCY_PLAN.md#6-restore-drill-runbook).
   Closes [RISK_ASSESSMENT.md T-07](./RISK_ASSESSMENT.md#37-t-07--ransomware--data-destruction)
   from High residual risk to Medium.
6. **SendGrid BAA** — date TBD (see § 5 of SECURITY_STATUS.md).
7. **Compliance/Security Officer designation** — required before beta
   (see [HIPAA_CHECKLIST.md § 2](./HIPAA_CHECKLIST.md)).
8. **Strategy / Financial Q&A pass** — both docs were last refreshed
   2026-04-24; the next regen cycle should incorporate the new
   HIPAA-doc landscape and updated documentation status.
9. **Cost-analysis service-type anonymization** — needs a curated
   medical taxonomy. The `stripPHIFromText` floor is in place; full
   mapping (e.g., "HIV PrEP consultation" → "Specialist Visit")
   deferred.
10. **Logger redaction drift** — 25+ PHI field names not in
    `SENSITIVE_FIELDS`. Single PR can sweep them all. See
    [PHI_TAXONOMY.md § 4](./PHI_TAXONOMY.md).
11. **Provider consent feature gaps** — `canViewInsurance` /
    `canViewDna` / `canEditData` and `SUSPENDED` / `EXPIRED` provider
    statuses are schema-present but unimplemented features (not bugs).
    Reframe as roadmap.
12. **Signed-URL session/IP binding** — Cloud Storage limitation;
    needs a proxy-download endpoint.
13. **AI chat spend un-tracked** — `aiChatController` doesn't call
    `trackAIUsage`. See [FINANCIAL_TRACKER.md](./FINANCIAL_TRACKER.md).
14. **Cloud Logging breach-detection alert policies** — wire alerts on
    `severity=ERROR` + breach-shape patterns. Required for the
    detection layer assumed by
    [BREACH_NOTIFICATION_PLAN.md](./BREACH_NOTIFICATION_PLAN.md).
15. **Backend `test:unit` script** — still points at non-existent dir
    (`test:integration` was repaired 2026-04-24).
16. **Frontend orphans** — `providerApi`, `patientApi`, `adminApi`, 5
    `RoleGuard` variants exported with zero UI consumers. Cleanup.

### Resolved this cycle (closed since prior regen)

- ~~Lows backlog~~ — ~24 Lows closed 2026-04-25 (UUID alignment,
  unhandled-rejection handlers, GCS bucket fail-fast, env-var naming,
  Anthropic client consolidation, raw-fetch migration, column rename,
  gsutil → `gcloud storage` migration, drop `:latest` tag, plus ~15
  cleanup items). See [SECURITY_STATUS.md § 3 — 2026-04-25 Low closures](./SECURITY_STATUS.md#2026-04-25-remediation-pass--low-closures).
- ~~No drafted HIPAA Risk Assessment~~ — drafted as
  [RISK_ASSESSMENT.md](./RISK_ASSESSMENT.md) 2026-04-25.
- ~~No drafted Breach Notification SOP~~ — drafted as
  [BREACH_NOTIFICATION_PLAN.md](./BREACH_NOTIFICATION_PLAN.md) 2026-04-25.
- ~~No drafted Security Policies (§164.316)~~ — drafted as
  [SECURITY_POLICIES.md](./SECURITY_POLICIES.md) 2026-04-25.
- ~~No drafted Contingency Plan (§164.308(a)(7))~~ — drafted as
  [CONTINGENCY_PLAN.md](./CONTINGENCY_PLAN.md) 2026-04-25 (incl.
  step-by-step restore-drill runbook).
- ~~No drafted Privacy Notice / Terms of Service~~ — drafted as
  [PRIVACY_POLICY_DRAFT.md](./PRIVACY_POLICY_DRAFT.md) and
  [TERMS_OF_SERVICE_DRAFT.md](./TERMS_OF_SERVICE_DRAFT.md) 2026-04-25
  (both pre-legal-review).
- ~~No drafted Sanction Policy / Workforce Security SOP~~ — drafted as
  [SANCTION_POLICY.md](./SANCTION_POLICY.md) and
  [WORKFORCE_SECURITY_SOP.md](./WORKFORCE_SECURITY_SOP.md) 2026-04-25.
- ~~Runtime C-8 BYPASSRLS open as a blocking Critical~~ — reframed to
  operator-pending; all code prerequisites merged 2026-04-24.
- ~~CSRF upload exemption~~ — removed; uploads now CSRF-validated.
- ~~Self-role elevation at the DB layer~~ — new trigger migration
  `20260424_prevent_self_role_elevation`.
- ~~Data export incompleteness~~ — `InsuranceBenefit[]` + UserFile
  `id`/`storageKey` added.
- ~~`deleteAllData` incompleteness~~ — DNA + LabConnection now wiped.
- ~~No rate limit on provider access-request~~ — `providerAccessRequestLimiter`
  added; uniform-error response collapses enumeration leaks.
- ~~Admin password reset doesn't invalidate target sessions~~ —
  `tx.session.deleteMany` in the same transaction.
- ~~`expenseController` bypassed central error handler~~ — 8 handlers
  refactored to throw typed errors.
- ~~Filename not sanitized~~ — `validateUploadFile` mutates `originalname`.
- ~~Session cleanup interval drift (1h vs 10min docs)~~ — flipped to 10min.
- ~~CSRF length-leak via early throw~~ — SHA-256-then-`timingSafeEqual`.
- ~~Cookie sameSite default `'lax'` in prod~~ — flipped to `'strict'`.
- ~~SBC log leaks `planName` / `insurerName`~~ — fields removed.
- ~~Frontend CSRF warn ships in prod~~ — guarded behind `import.meta.env.DEV`.
- ~~Audit log records biomarker name in plaintext metadata~~ — field dropped.
- ~~`expenseController` bare `Error` instead of `AppError`~~ — replaced.

### Drift items unrelated to this remediation cycle (still open)

- **`CLAUDE.md` drift** — claims Jest (actual: Vitest); lists Admin Panel /
  Provider Collaboration as shipped (actual: backend-only — frontend UI
  absent). See [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) + [STRATEGY.md
  §4.2](./STRATEGY.md).
- **Env-var name drift** — `GCP_PROCESSOR_ID` used in code,
  `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` documented. `CSRF_SECRET` listed but
  unused. See [ENV_VARS.md](./ENV_VARS.md#drift-findings).
- **Vestigial config** — `backend/railway.toml` + `DEPLOY.md` describe a
  never-shipped Railway deploy. See [RUNBOOK.md Prompt drift
  log](./RUNBOOK.md).
- **Duplicate SBC upload mount** — `/insurance/upload-sbc` mounted twice
  with different guards. See [ROUTING_TABLE.md](./ROUTING_TABLE.md).
- **7 Criticals closed in a single day (2026-04-16)** — unusually dense
  security sweep (PRs #30–#42); 2026-04-24 cycle then closed every
  remaining High and ~33 Mediums. See
  [CHANGELOG.md](./CHANGELOG.md) + [SECURITY_STATUS.md
  §3](./SECURITY_STATUS.md#3-closed-in-current-cycle).
