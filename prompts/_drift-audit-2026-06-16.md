---
tags:
  - meta
  - maintenance
  - drift-log
type: shared
priority: 2
updated: 2026-06-16
---

# Prompt-Library Drift Audit — 2026-06-16

A full re-run of the codebase against all 49 prompt-library files, to answer: *which prompts
need updating, and which new prompts are needed?* This is the quarterly refresh trigger from
`00-index.md` — overdue by **111 commits** (baseline `13db267` / 2026-06-01 → HEAD `fb2cd32` / 2026-06-15).

**Method:** multi-agent workflow `audit-prompt-library-drift` (118 agents, ~9.55M tokens, ~29 min):
11 fact-gathering agents built one authoritative fact set from the live code → 49 audit agents
(one per file) compared every claim against that fact set + the cited code → an adversarial verify
agent re-checked every claimed drift (default: refute) to kill false positives → 11 gap probes +
1 completeness critic looked for domains needing new prompts.

> **This file is the audit, not the fix.** No prompt files were edited. It records what to change
> so the actual refresh (editing the 49 files) is a follow-up task.

---

## Headline verdict

| Bucket | Count | Files |
|---|---|---|
| **needs-update** | **43** | almost everything — see table below |
| minor (low-only) | 4 | `23-financial-tracker-doc`, `_doc-quality`, `_review-protocol`, `_verification-tools` |
| **clean** | 2 | `24-full-security-audit`, `39-frontend-component-map-doc` |

**~111 High + ~119 Medium + ~150 Low confirmed drift items** (post-verify). These are *doc/prompt*
drift — stale counts, dead references, and post-06-01 realities the frozen prompts are silent about —
**not** newly-discovered app security bugs. The app moved forward (two remediation+deploy waves,
PRs #142–#160 and #174–#182); the prompts didn't move with it.

Only **1 false positive** was caught by the adversarial pass (an over-broad `useRBAC` claim in
`10-frontend-auth`), which is a good signal the rest are real.

---

## Headline drift (what the project grew since 2026-06-01)

| Thing | Was (prompt) | Now (verified) | Evidence |
|---|---|---|---|
| Prisma migrations | 22 | **32** (+10) | `backend/prisma/migrations/` (32 dirs, newest `20260615_provider_consent_immutable_audit_insert_check`) |
| Prisma models | 18 | **19** (+`RevokedAccessToken`) | `schema.prisma:96` |
| Encrypted PHI fields / models | ~31 / 13 | **39 / 14** | `encryption.ts:476-562` |
| Workflows | 3 | **4** (+`maintenance.yml`) | `.github/workflows/` |
| Node | 20-alpine | **22-alpine (digest-pinned)** | `Dockerfile:15,37`; `ci.yml NODE_VERSION:'22'` |
| Migration model | boot CMD (`migrate && node`) | **Cloud Run job `ownmyhealth-migrate`; Dockerfile CMD node-only; deploy gated on CI** | `Dockerfile:86-93`; `deploy.yml:43,57-66,106-161` |
| Backend services (top-level) | ~23 | **27** (+`biomarkerSeries`, `biomarkerConsolidation`, `goalValueBackfill`, `data/`) | Glob `backend/src/services` |
| `New Project Documents/` | empty | **still empty** (audit agent's "populated" listing was a hallucination — corrected 2026-06-16; generated fresh by the run-all-prompts step) | `Glob` verified |

---

## Cross-cutting themes (one root change → many stale prompts)

Fixing these ~13 themes resolves the bulk of the 43 files. Each lists the touched prompts.

1. **Schema/migration/PHI growth** — migrations 22→32, models 18→19, +6 encrypted columns
   (`UserFile.originalFilenameEncrypted` L24; `HealthGoal.currentValue/startValue` + `GoalProgressHistory.value` M4;
   `AuditLog.metadataEncrypted` M6 — and the **plaintext `audit_logs.metadata` column was IRREVERSIBLY dropped**).
   → `00-index`, `01`, `02`, `_phi-inventory`, `33`, `40`, `16`, `21`, `22`, `36`.

2. **Migrate-as-Cloud-Run-job** — boot-migrate removed; Dockerfile CMD `node dist/app.js`; deploy `needs: ci`
   (lint+test+build+gitleaks+`npm audit high`+RLS gate); Node 20→22; 4th workflow `maintenance.yml`.
   → `12`, `15`, `16`, `36`, `37`, `18`, `11`, `19`.

3. **Cross-instance token revocation** — `users.tokens_valid_after` + `revoked_access_tokens` table checked every
   request (`isAccessTokenStale`), `requireBearerAuth`, access-JWT `jti`, refresh-reuse → full-family revoke (10s grace).
   → `03`, `16`, `21`, `30`, `34`. **(also the strongest new-prompt candidate — see below)**

4. **FORCE RLS everywhere + boot guard** — `20260613_force_rls_and_audit_retention` FORCEs all 19 RLS tables;
   `database.ts assertRLSForced()` hard-exits prod if any isn't FORCE'd; audit DELETE policy now DB-enforces the
   7-year window; `audit_logs_insert` tightened from `WITH CHECK(true)`; provider-consent-immutable BEFORE-UPDATE trigger.
   → `01`, `05`, `16`, `20`, `21`, `22`, `26`, `30`, `33`.

5. **RLS now enforced in prod** — omh_app cutover landed; `assertNoBypassRLS()` `process.exit(1)` in prod.
   `20-known-issues`'s "RLS is inert/advisory in prod" is now **wrong** (dev/staging only warn).

6. **AI cost rewrite** — `isAISpendExceeded` **deleted** → `admitAISpend()` reserve($0.05)/settle model; pluggable
   `InMemorySpendStore`/`RedisSpendStore` (Redis when `REDIS_URL` set); 503 fail-closed; `aiSpendGuard` now on **8 mount
   points across 5 route files** incl. all 3 upload routes. → `06`, `08`, `09`, `27`, `42`, `_refresh`.

7. **Plan-gating reversals** — gate **fails CLOSED to FREE** on DB error (not JWT); `maxBiomarkers` and `insurancePlans`
   are **now enforced** (M12/M13, middleware + in-handler); `providerSharing` is now `true` on all tiers (product decision).
   `43`'s central thesis is inverted in 3+ places. → `42`, `43`, `_refresh`.

8. **`pdfRedaction.ts` DELETED** — `redactPatientBanner` has zero refs; `pdf-lib` is now an unused dependency. Every
   "unwired dead code, verify whether to wire" item is now a dead reference to a removed file.
   → `28`, `31`, `21`, `22`, `18`, `13`, `_refresh`.

9. **Biomarker time-series merge** — new `biomarkerSeries.upsertBiomarkerReading`; all create/bulk/FHIR paths APPEND into
   one series (anchor=newest, `BiomarkerHistory`=older); FHIR sync idempotent on `fhir:{provider}:{obs.id}`.
   The headline behavioral fix; create contract now returns `history[]`. → `16`, `17`, `41`. **(new-prompt candidate)**

10. **Provider-access refactor** — `rbac.ts` parallel cluster (`checkProviderPatientAccess`/`requireOwnership`) **removed**
    (L-26); single choke point `services/providerAccess.ts resolveProviderAccess`; `canViewInsurance` route now wired;
    `canEditData` intentionally orphaned (L37). → `26`, `30`, `10`.

11. **FHIR audit gaps closed** — `CONNECT_INITIATED` + `CONNECT_FAILED` now audited; FHIR error paths now throw
    `ExternalServiceError` (502) instead of leaking `err.message`. → `05`, `41`, `32`, `37`, `_refresh`.

12. **Logger hardened** — `SENSITIVE_FIELDS` lowercased + snake_case tokens added; depth cap + circular guard; staging
    also suppresses/JSON-logs. Resolves the `_refresh` "latent redaction gap" finding. → `31`, `40`, `_refresh`.

13. **`New Project Documents/` doc set** — ⚠️ the audit agent claimed this folder was populated with ~18 docs + 3 reports;
    a later `Glob` proved that was a **hallucinated listing** — the folder was actually **empty**. The `25`/`14` edits made from
    that false premise were reverted on 2026-06-16; the docs are generated fresh by the run-all-prompts step. (SECURITY_AUDIT_* family does not exist.) → `25`, `14`, `22`.

---

## Per-file verdict (confirmed drift, after adversarial verify)

`H/M/L` = High/Medium/Low confirmed items. Sorted by severity weight.

| File | Verdict | H | M | L | Headline drift |
|---|---|---|---|---|---|
| `12-cicd-security` | needs-update | 8 | 2 | 5 | 4th workflow, F-30 SHA-pins DONE, permissions blocks, Node22, CI-gate, migrate-job — all missing/wrong |
| `33-data-model-doc` | needs-update | 7 | 2 | 2 | 19 models, 32 migrations, +6 PHI fields, FORCE RLS, 7-yr DB retention |
| `28-file-storage` | needs-update | 6 | 5 | 2 | `pdfRedaction` deleted; L24 filename encryption; F-22 GCS-delete-fail-hard; page cap; aiSpendGuard on uploads |
| `01-database-schema` | needs-update | 6 | 4 | 4 | 19 models, 32 migrations, FORCE RLS, new PHI fields, irreversible metadata drop |
| `16-architecture-doc` | needs-update | 5 | 5 | 9 | migrate-job, FORCE RLS, token revocation, biomarker series, AI-cost rewrite |
| `38-testing-patterns-doc` | needs-update | 5 | 3 | 2 | 54 backend / 25 FE test files (was 34/14); `rbac.test` gone; many new suites |
| `43-plan-gating-billing` | needs-update | 5 | 1 | 16 | fail-CLOSED-to-FREE; maxBiomarkers/insurancePlans now enforced; providerSharing all-tiers; line nums shifted |
| `41-fhir-lab-integration` | needs-update | 4 | 3 | 11 | CONNECT_INITIATED/FAILED now audited; series merge; idempotency on obs.id; line nums off |
| `15-runbook-doc` | needs-update | 4 | 2 | 4 | Node22, migrate-job, maintenance.yml backfills, token-revocation force-logout mechanism |
| `36-local-dev-setup-doc` | needs-update | 4 | 2 | 4 | 32 migrations, Node22, engines `^20.19||^22.12||>=24`, root has no test:unit/rls, migrate-not-at-boot |
| `26-provider-collaboration` | needs-update | 4 | 2 | 2 | rbac cluster removed → `providerAccess.ts`; canViewInsurance wired; canEditData orphaned; consent-immutable trigger |
| `27-ai-integration` | needs-update | 4 | 2 | 2 | `isAISpendExceeded`→`admitAISpend`; pluggable store; server-side disclaimer; pre-flight CHAT_INITIATED audit |
| `_phi-inventory` | needs-update | 4 | 2 | 2 | missing UserFile, goal-value twins, GoalProgressHistory.value, AuditLog.metadata; 14 models/39 fields |
| `42-ai-cost-control` | needs-update | 3 | 9 | 9 | dead symbols; fail-closed-to-FREE; Redis store now consumed; ~60-line citation shift |
| `11-environment-secrets` | needs-update | 3 | 3 | 3 | .env.example now documents all; F-30 done; CI is the secret-scan gate; migrate-job secret wiring |
| `21-security-status-doc` | needs-update | 3 | 3 | 2 | FORCE RLS + assertRLSForced; token revocation; metadata drop; `pdfRedaction` gone |
| `05-audit-logging` | needs-update | 3 | 2 | 7 | metadata now encrypted (plaintext col dropped); DB-enforced retention; FHIR audit gaps closed |
| `03-authentication` | needs-update | 3 | 2 | 3 | cross-instance revocation; refresh-reuse family revoke; resolvedCookieSecure |
| `09-external-apis` | needs-update | 3 | 2 | 1 | `isAISpendExceeded` gone; Document-AI PDF OCR fallback exists; Document-AI has no dollar accounting |
| `40-phi-taxonomy-doc` | needs-update | 3 | 2 | 1 | 14 models/39 fields; new PHI fields; SENSITIVE_FIELDS gaps |
| `31-logging-observability` | needs-update | 2 | 4 | 4 | `pdfRedaction` deleted; snake_case tokens added; depth/circular guards; staging gating; maintenance scripts log |
| `30-admin-security` | needs-update | 2 | 4 | 0 | role-change revokes sessions+tokensValidAfter; useRBAC flags removed; re-consent guard; metadataEncrypted view |
| `_refresh-2026-06-01` | needs-update | 2 | 3 | 1 | its own findings now actioned (aiSpendGuard, plan limits, logger, FHIR audit, pdfRedaction) |
| `00-index` | needs-update | 2 | 2 | 2 | 32 migrations, 4 workflows, "41/42/43 not yet numbered" self-contradiction, bump date |
| `34-routing-table-doc` | needs-update | 2 | 1 | 6 | csrf `EXEMPT_PATHS` flat Set; `/auth/refresh` no longer exempt |
| `08-rate-limiting` | needs-update | 2 | 1 | 1 | aiSpendGuard on 8 mounts; reserve/settle model |
| `32-error-handling` | needs-update | 2 | 1 | 1 | FHIR handlers now throw ExternalServiceError (502); callback redirects not bare-JSON |
| `25-full-doc-refresh` | needs-update | 2 | 0 | 2 | `New Project Documents/` not empty → incremental, not from-scratch; stale "fold-in" list |
| `20-known-issues-doc` | needs-update | 1 | 6 | 5 | RLS enforced in prod now; runbook path renamed; insuranceController now tested; 8 route tests |
| `37-error-recovery-doc` | needs-update | 1 | 5 | 8 | no SYNC_FAILED HTTP; 502 EXTERNAL_SERVICE_ERROR; 429 retry-with-backoff; line nums off |
| `22-hipaa-checklist-doc` | needs-update | 1 | 4 | 3 | `pdfRedaction` gone; SECURITY_AUDIT_* doc family absent; PBKDF2 lives in encryption.ts; FORCE RLS |
| `02-encryption` | needs-update | 1 | 3 | 4 | L24 filename PHI; 39 encrypted cols/19 models; M4 goal values; M6 metadata |
| `14-strategy-doc` | needs-update | 1 | 3 | 4 | reminderFrequency now live; provider UI shipped; C-8 RLS shipped not in-flight; docs exist |
| `19-changelog-doc` | needs-update | 1 | 2 | 4 | HEAD no longer #134; 11 new migrations + infra wave to record |
| `04-csrf` | needs-update | 1 | 1 | 2 | `/auth/refresh` no longer exempt; csrf cookie maxAge now 7d session-tied |
| `10-frontend-auth` | needs-update | 1 | 1 | 1 | useRBAC flags removed; RoleGuard/useRBAC unused (1 FP killed) |
| `29-data-portability` | needs-update | 0 | 4 | 4 | GET routes lack blockDemo; logExport fail-closed; filename decrypt at export; metadataEncrypted |
| `35-env-vars-doc` | needs-update | 0 | 3 | 6 | CMS/OPENAI vars gone from .env.example; RLS_ENFORCEMENT removed; OMH_DEPLOY_ENFORCE_PROD missing |
| `17-api-reference-doc` | needs-update | 0 | 3 | 4 | invented audit actions; `auditService.log*` not `auditLog.log`; series/history create contract |
| `07-input-validation` | needs-update | 0 | 3 | 2 | FHIR callback redirects not 400; `delimitDocumentForPrompt` injection guard; `sanitizeExtractedSbc` |
| `06-api-routes` | needs-update | 0 | 2 | 3 | aiSpendGuard on 8 mounts, not just /ai/chat |
| `13-dependency-health` | needs-update | 0 | 2 | 3 | vite 7→8; `pdf-lib` now unused dep |
| `18-troubleshooting-doc` | needs-update | 0 | 2 | 3 | `pdfRedaction` gone; migrate-job deploy-fail symptom |
| `23-financial-tracker-doc` | minor | 0 | 1 | 4 | Document-AI not dollar-accounted caveat |
| `_doc-quality` | minor | 0 | 0 | 4 | minor example refresh |
| `_review-protocol` | minor | 0 | 0 | 3 | minor example refresh |
| `_verification-tools` | minor | 0 | 0 | 1 | minor |
| `24-full-security-audit` | **clean** | 0 | 0 | 0 | — (orchestrator; may want to register new prompts) |
| `39-frontend-component-map-doc` | **clean** | 0 | 0 | 0 | — |

---

## Prompts to ADD

Gap probes + the completeness critic, each adversarially scoped. Most candidate domains (email-change,
notifications, onboarding, knowledge/RAG, health-profile, internal-routes, deploy-ops) were judged **already
adequately covered** — only these warrant new prompts:

| # | Proposed prompt | Type | Priority | Why it's not already covered |
|---|---|---|---|---|
| 44 | **token-revocation** | security | **High** | Subsystem rebuilt entirely *after* the refresh (`tokens_valid_after` + `revoked_access_tokens` + refresh-reuse family revoke + `requireBearerAuth`). `03-authentication` is now stale, not a home. Multi-layer, multi-instance, audited — deserves its own owner. Files: `authService.ts`, `auth.ts`, `revoked_access_tokens`/`tokens_valid_after` migrations. |
| 45 | **maintenance-jobs** (PHI backfills + Cloud Run jobs) | security/ops | **Medium** | `backend/src/maintenance/{backfillGoalValues,backfillUserFileNames,consolidateBiomarkerSeries}.ts` + service cores + `maintenance.yml` run in prod **with the live per-user encryption key**, touch PHI, and are owned by **no prompt**. Critic: "security-critical, zero prompt hits." Also captures the not-yet-run L24 filename backfill. |
| 46 | **biomarker-series** (trend data-integrity) | doc/correctness | **Medium** | The fixed "core trend" subsystem (`biomarkerSeries.upsertBiomarkerReading`, `biomarkerConsolidation`, series-merge invariant, FHIR idempotency). Data model is in `33`/`01` and FHIR write-path in `41`, but the merge/consolidation **logic** is uncovered. |

**Lower-priority candidates** (critic, optional — flag, don't necessarily build): a dedicated **insurance-domain**
prompt (largest FE cluster ~22 `.tsx` + encrypted PHI, currently spread thin across many prompts) and **biomarker
reference-range / cost-math correctness** owners.

### Domains checked and judged ALREADY COVERED (no new prompt)
email-change (→`03` §8b), notifications (→`09`/`06`/`07`/`15`), onboarding (→`06`/`17`), knowledge/RAG (→`27`),
health-profile (→`27`), internal-routes (→`05`/`06`), deploy/migrate-ops (→ refresh `12`+`15`).
This prunes the stale "candidates for future prompts" note in `00-index.md:129` (FHIR/AI-cost/plan-gating from that
note are already prompts 41/42/43).

---

## Recommended execution order (the actual refresh)

1. **Shared truth first** — `00-index` counts table + `_phi-inventory` (the canonical PHI SSOT is wrong about
   `UserFile`/goal-values/audit-metadata). Everything downstream cites these.
2. **Theme-batched edits** — fix the 13 cross-cutting themes; ~30 of the 43 files fall out of themes 1–8.
3. **Per-file long-tail** — the residual file-specific items (line-number shifts, dead refs).
4. **Add prompts 44–46**; register them in `00-index` and `24-full-security-audit`.
5. **Bump every `updated:` date to 2026-06-16** and append a `_refresh-2026-06-16.md` log.

Full per-item evidence (file:line) is in the workflow output: run `wf_a1f8fac4-cb0`
(`tasks/w65qy5fpl.output`) / `drift-summary.txt`.
