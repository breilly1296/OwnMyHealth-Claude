---
tags:
  - documentation
  - changelog
type: prompt
priority: 3
updated: 2026-06-16
---

# Generate CHANGELOG.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/CHANGELOG.md` — a **[Keep-a-Changelog](https://keepachangelog.com)** formatted history of user-visible changes. Must cover every change since the prior entry cutoff; not a best-effort "most recent 10". A Claude Project reader should be able to answer "what changed in PR #30?" and "when did the Anthropic BAA land?" from this doc alone.

---

## Files to review

| File | Why read it |
|---|---|
| Git history (via Bash) | `git log` is the primary source of truth. |
| Prior `New Project Documents/CHANGELOG.md` | Cutoff date (last entry) — every commit since is in scope. |
| `package.json` (both) | Version bumps / engines changes. |
| `backend/prisma/migrations/` | Schema changes, each migration is a user-visible change if it adds/removes fields. |
| `.github/workflows/*` (history) | CI/CD changes. |
| `CLAUDE.md` "Removed Features" + "Current Features" | Reconcile against git log — each removal should have a commit. |
| Project memory (e.g., PR #30 ships C-1/F-14/F-15, Anthropic BAA 2026-04-16; mid-history PRs #113–#134 ship FHIR lab connect, AI chat, onboarding, plan gating, email-change; the **recent** frontier is the teardown-remediation wave #142–#160 and the security/a11y/interaction wave #174–#182, plus the migrate-job / CI-gating / Node-22 infra changes — do not anchor the cutoff at #134) | Record cross-sanity. |

---

## Required sections

1. **Header** — last updated ISO date, cutoff date of prior entry.
2. **[Unreleased]** — staged but un-deployed changes, if any.
3. **Per-release entries** (most recent at top) — each with:
   - Date (ISO)
   - Version or "deploy YYYY-MM-DD". NOTE: there are currently **no git tags** and both `package.json` files are pinned at `1.0.0`, so in practice every entry uses the `deploy YYYY-MM-DD` form. Do not invent a semver version.
   - Added / Changed / Fixed / Security / Deprecated / Removed / Infrastructure subsections
4. **PR table** — full list of merged PRs since the cutoff (PR#, date, title, category, user-visible impact, breaking?).
5. **Statistics** — deploy count, test-suite size change, Security findings closed (cross-link `SECURITY_STATUS.md`).
6. **Related Documents**.
7. **Prompt drift log**.

---

## Required artifacts

### PR table (the artifact that prevents missing entries)

| PR # | Date (ISO) | Title | Category | User-visible impact | Breaking? |
|---|---|---|---|---|---|
| #30 | 2026-04-16 | C-1/F-14/F-15 RLS set_config in-transaction fix | Security | No user-visible UI change; PHI isolation hardened | no |
| #32 | … | … | … | … | … |

Every PR since the cutoff gets a row. Sort descending.

### Per-release entry template

```markdown
## [2026-04-16]

### Security
- **Runtime RLS context hardened** — `set_config` now runs inside transactions (C-1) so `SET LOCAL` scope is retained through connection reuse. Fixes PR #30. See [`SECURITY_STATUS.md#c-1`](./SECURITY_STATUS.md).
- **Anthropic BAA activated** — `ANTHROPIC_BAA_ACTIVE` env var toggled on; PHI-in-prompts flow newly compliant. Cross-link [`HIPAA_CHECKLIST.md#baas`](./HIPAA_CHECKLIST.md).

### Fixed
- **Bug short name** — one-line description, file:line of the fix commit.

### Infrastructure
- **Cloud Run env-var update postmortem (2026-04-17)** — follow-up docs in `RUNBOOK.md#rollback`. See project memory `cloud-run-env-update-pinning.md`.
```

---

## Major feature lines to account for since the early-2026 cutoff

The codebase has grown well past the 2026-04-16 baseline. When reconstructing history from git, expect — and explicitly classify — these landed feature lines. Each is verifiable in code (cite real files when describing it):

- **Quest FHIR / lab connections** (Added) — SMART-on-FHIR OAuth lab sync. Code: `backend/src/routes/fhirRoutes.ts`, `fhirController.ts`, `services/fhir/` (`fhirClient`, `labSyncService`, `loincMapper`, `smartAuth`, `urlSafety` SSRF guard), Prisma `LabConnection` model, migration `20260418_add_lab_connections`, env vars `QUEST_FHIR_*`. PR #115 (`feat/fhir-lab-connect`) and #119 (`fix/fhir-ui-review-followups`); SSRF hardening in PR #110 (`fix/fhir-ssrf-token-exfil`, closes finding #26).
- **AI chat + AI spend control** (Added/Security) — `aiRoutes.ts`, `aiChatController.ts`, `services/anthropicClient.ts`, `aiCostTracker.ts`, `usageTracker.ts`, `middleware/aiSpendGuard.ts`; env vars `AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD`, `ANTHROPIC_BAA_ACTIVE`. NOTE: the spend cap was subsequently **reworked** (M11/L33, post-06-01) — `isAISpendExceeded` was deleted in favor of `admitAISpend()` reserve/settle with a fixed `RESERVATION_USD = 0.05` reservation (`aiCostTracker.ts:67`) and a pluggable `SpendStore` (`InMemorySpendStore` default / `RedisSpendStore` when `REDIS_URL` set), failing **closed with 503** on budget reached or shared-store error. Record this as a Changed/Security entry; `aiSpendGuard` now has **8 mount points across 5 route files** (`aiRoutes`, `biomarkerRoutes`, `expenseRoutes`, `insuranceRoutes`×2, `uploadRoutes`×3).
- **Onboarding wizard** (Added) — `onboardingRoutes.ts`, `services/onboardingService.ts`, `components/onboarding/`, migration `20260420_add_onboarding`.
- **Plan gating / billing tiers** (Added) — `planRoutes.ts`, `middleware/planGating.ts`, `config/plans.ts`, `PlanType` enum, migration `20260420_add_user_plan`.
- **Verified email-change flow** (Added) — request → confirm. PRs #133/#134, migration `20260601_add_email_change`.
- **Notification preferences** (Added) — `services/notificationService.ts`, migration `20260417_add_notification_preferences`.
- **Redis-backed rate limiting** (Infrastructure) — `middleware/rateLimitStore.ts` (Redis via `REDIS_URL`, in-memory fallback), now **8** named limiters in `rateLimiter.ts`. PR #125 (`feat/redis-rate-limit-store`).
- **DNA / Genetics removal** (Removed) — `DNAVariant` / `GeneticTrait` models and their encrypted fields dropped in migration `20260423_drop_dna_genetics`. This is a Removed-section entry; reconcile against `CLAUDE.md` "Removed Features".
- **`CostAnalysis.claudeResponse` → `claudeResponseEncrypted` rename** (Changed/Security) — migration `20260424_align_uuid_defaults_and_rename_claude_response`. The field is now encrypted-suffixed; the old un-suffixed name is gone.

### Post-2026-06-01 wave (the recent frontier — DO NOT stop the changelog at #134)

The bullets above stop at the 2026-06-01 baseline. The following landed AFTER that (PRs ~#142–#160 teardown remediation and #174–#182 security/a11y/interaction, plus infra) and a current changelog MUST record them. Each is verifiable in code (cite real files):

- **Migrations no longer run at container boot → dedicated Cloud Run migrate job** (Infrastructure — biggest pipeline change). The Dockerfile CMD is now `CMD ["node", "dist/app.js"]` (was `prisma migrate deploy && node`); `prisma migrate deploy` runs once per deploy as the Cloud Run **job `ownmyhealth-migrate`** (`backend/Dockerfile:86-93`; `deploy.yml:43` `MIGRATE_JOB: ownmyhealth-migrate`, run in the "Run database migrations" step `deploy.yml:106-161`). Record as an Infrastructure entry; cross-link `RUNBOOK.md` (root cause of the 10-day silent outage resolved 2026-06-12).
- **Deploy gated on full CI** (Infrastructure) — `deploy.yml` invokes `ci.yml` as a reusable workflow (`deploy.yml:57-58` `ci: uses: ./.github/workflows/ci.yml`) and `build-and-stage` has `needs: ci` (`deploy.yml:65-66`); a commit that fails lint/test/build/gitleaks/audit/RLS is never built or staged. Also: 0%-traffic staged deploy + smoke-test + named-revision promote with `--to-revisions` rollback; `deploy-frontend` now `needs: [ci, promote]`.
- **Node 20 → Node 22 LTS** (Infrastructure, M15 — Node 20 EOL Apr 2026) — `backend/Dockerfile:11-15` (`# M15: bumped from node:20-alpine … to node:22-alpine`), `FROM node:22-alpine` digest-pinned both stages (`:15,:37`); `ci.yml` `NODE_VERSION: '22'`; `deploy.yml:321` frontend setup-node `node-version: '22'`; `package.json` `engines`. Record as an Infrastructure entry.
- **Cross-instance access-token revocation** (Security) — NEW `revoked_access_tokens` table + Prisma model `RevokedAccessToken` and `users.tokens_valid_after` cutoff; access JWTs now carry a `jti`; logout records the jti, logout-all/password-change/reset/email-change/admin-deactivate stamp `tokensValidAfter`; refresh-reuse within the grace window revokes the whole token family (pentest M-1). Migrations `20260613_revoked_access_tokens`, `20260606000002_add_tokens_valid_after`. `pdfRedaction.ts` was DELETED (pdf-lib now unused).
- **FORCE ROW LEVEL SECURITY + DB-enforced 7-year audit retention** (Security) — migration `20260613_force_rls_and_audit_retention` adds `FORCE ROW LEVEL SECURITY` on all 19 RLS tables and rewrites the audit DELETE policy to require `created_at < now() - interval '7 years'`; `database.ts` `assertRLSForced()` boot check hard-fails (prod) if any RLS table isn't FORCE-protected. Consent-immutability trigger + tightened `audit_logs_insert` WITH CHECK in `20260615_provider_consent_immutable_audit_insert_check`. Cross-link `SECURITY_STATUS.md`.
- **PHI encryption expanded** (Security/Changed) — `UserFile.originalFilenameEncrypted` (L24, migration `20260615_encrypt_userfile_original_filename`); `HealthGoal.currentValueEncrypted` + `startValueEncrypted` and `GoalProgressHistory.valueEncrypted` (M4, `20260613_encrypt_goal_values`); `AuditLog.metadataEncrypted` (M6, `20260606000001_encrypt_audit_metadata`). PHI_FIELDS now covers 14 models / 39 fields.
- **IRREVERSIBLE removal of plaintext audit metadata** (Removed/Security) — migration `20260615_drop_legacy_audit_metadata` DROPs the `audit_logs.metadata` plaintext column (already applied in prod; legacy plaintext content lost). This is a Removed-section entry; flag it as breaking-irreversible.
- **Biomarker time-series merge** (Changed — headline behavioral fix) — NEW `services/biomarkerSeries.ts` `upsertBiomarkerReading()` routes all create/bulk/FHIR paths into one appended series (was: every write made a disconnected single-point row, so trends were silently dead). NEW `services/biomarkerConsolidation.ts` + one-time consolidation job.
- **Plan-limit bypass closed** (Security, M12/M13) — `maxBiomarkers` per-upload truncation and `insurancePlans` quota re-check on archived-plan reactivation now enforced; planGating fails CLOSED to FREE on DB error.

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. What was the cutoff date of the previous changelog entry?
2. What shipped in PR #30, and what user-visible impact did it have?
3. When was the Anthropic BAA activated?
4. Which changes are breaking?
5. How many PRs merged since the cutoff?
6. Which migrations added/removed fields, and do users see a schema effect?
7. What was the most recent infrastructure change?
8. Which security findings closed in this release cycle?
9. What's in `[Unreleased]`?

---

## No-TBD enforcement

Before marking anything TBD:

- **Full commit set**: run

  ```bash
  git log --all --since=<CUTOFF_ISO_DATE> --pretty=format:'%h %ad %s' --date=short
  ```

  Every commit in the output is in scope. Do not stop at "most recent 10."
- **PRs**: this repo uses **two** merge styles, so `--grep="Merge pull request"` alone WILL miss PRs. Capture both:
  - Classic merge commits: `git log --grep="Merge pull request"` (e.g. `Merge pull request #132 from …`).
  - Squash merges with a trailing `(#N)` in the subject: `git log --oneline | grep -E "\(#[0-9]+\)"` (e.g. `feat: verified email-change flow (request → confirm) (#133)`, `fix(auth): … (#134)`). These have NO "Merge pull request" line.
  Union both lists. PR numbers now run well past #134 — the security/UX waves merged through **#182** (e.g. the teardown-remediation wave #142–#160 and the security/a11y/interaction wave #174–#182). Do NOT anchor the cutoff at #134; run the commit-set commands and let git define the upper bound. If a PR title truly isn't in the commit, read GitHub (external) and mark `TBD (external: fill PR title from GitHub)` only then.
- **Schema changes**: list every directory added under `backend/prisma/migrations/` since cutoff.
- **Session summary integration**: if session summary files exist in the repo (e.g., `session-summaries/*.md`), read them and cross-reference to commit dates. If they live in an external doc store, mark and provide the locator.

---

## Cross-links

The generated `CHANGELOG.md` must link to:

- [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) — security findings that changed status.
- [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) — BAA / compliance status changes.
- [`RUNBOOK.md`](./RUNBOOK.md) — infra change postmortems referenced.
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) — issues introduced or closed.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — migrations.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Full commit range | Bash | `git log --all --since=<CUTOFF> --pretty=format:'%h %ad %s' --date=short` |
| PR titles (merge commits) | Bash | `git log --grep='Merge pull request' --since=<CUTOFF>` |
| PR titles (squash merges) | Bash | `git log --oneline --since=<CUTOFF> \| grep -E '\(#[0-9]+\)'` (catches squash-merged PRs that have no "Merge pull request" line) |
| Per-file change counts | Bash | `git log --since=<CUTOFF> --stat` |
| New migrations | Glob | `pattern: "backend/prisma/migrations/*"` + `ls -lt` to find ones newer than cutoff |
| Workflow changes | Bash | `git log --since=<CUTOFF> -- .github/workflows/` |

---

## Output: file and location

Write the final document to `New Project Documents/CHANGELOG.md`.
