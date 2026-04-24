---
tags:
  - documentation
  - changelog
type: reference
priority: 3
last_updated: 2026-04-24
prior_cutoff: 2026-01-07
commits_processed: 292
format: Keep a Changelog
---

# CHANGELOG

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Last updated: **2026-04-24**.
Prior entry cutoff: **2026-01-07** (the prior `CHANGELOG.md` in this folder did not exist on disk at the time of generation; the floor specified by `prompts/19-changelog-doc.md` was used and every commit since `2026-01-07` inclusive is in scope).

Source of truth: `git log --all --since=2026-01-07 --pretty=format:'%h %ad %s' --date=short` run from the repo root `C:\Users\breil\OneDrive\Desktop\OwnMyHealth`. 292 commits processed.

Security finding IDs (C-N / F-N / H-N / M-N) are used below where commits cite them. See [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) for the canonical register.

---

## [Unreleased]

Changes merged to `master` but not yet promoted to production traffic (PR #74 is the freshest merge; staging validation ongoing per `deploy-staging.yml`, added 2026-04-23).

### Changed
- **Dead-code sweep** — unused analytics components and stale DNA plumbing removed (`eb45a57`, `5303e30`; PR #74 2026-04-23). See [Removed](#removed-2026-04-23) below.
- **Lint hygiene** — unused `toggles` locator dropped from `e2e/settings.spec.ts` (`1676230` 2026-04-23).

### Security
- **C-8 cutover prep** — audit-log salt moved to env, bare-prisma sweep performed across controllers/services, startup assertion added so the backend refuses to boot with a `BYPASSRLS` DB role (`4290520` 2026-04-23, `feat(c-8): prepare code for RLS role cutover`). See `prompts` memory note: the C-8 runtime-role gap remains **open** until the DB-role cutover itself runs in production — prep landed, cutover pending.

### Removed
- **DNA / Genetics feature** — `DNAData`, `DNAVariant`, `GeneticTrait` models, tables, permissions, and frontend types purged (`a793880`, `d62a8e7` 2026-04-23; PR #74). `CLAUDE.md` "Deprecated (Still in Schema)" section is now stale and will drop on next doc refresh.

---

## [2026-04-23] — Staging pipeline + dead-code cleanup

### Added
- **Staging deploy pipeline** — new `.github/workflows/deploy-staging.yml` (4,317 bytes, committed 2026-04-23 via PR #73). Staging service now gets its own revision and smoke test before `master` deploy can promote.
- **Onboarding flow** — `backend/prisma/migrations/20260420_add_onboarding/` introduces onboarding state columns (`dfdb111`, PR #73).
- **Plan gating** — `backend/prisma/migrations/20260420_add_user_plan/` adds `UserPlan` tiering that gates feature access (`dfdb111`, PR #73).
- **Encrypted health-goal target** — `backend/prisma/migrations/20260420_encrypt_health_goal_target/` converts `targetValue` to encrypted storage (`dfdb111`, PR #73). PHI-field list in `backend/src/services/encryption.ts` updated to match. See [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md).
- **e2e test scaffolding** — Playwright-style `e2e/settings.spec.ts` added (PR #73).

### Changed
- **Working-tree sync** — consolidated staging env, onboarding, plan gating, and e2e changes into a single PR (`61a6c67` → `dfdb111`, PR #73).

### Removed <a id="removed-2026-04-23"></a>
- **DNA/Genetics** (see Unreleased above — landed on `master` 2026-04-23, not yet promoted).
- **Unused analytics components** — pruned in `5303e30`.

---

## [2026-04-18] — FHIR integration + High-severity batch + CSRF fixes

### Added
- **Quest FHIR integration** (`feat(quest-fhir)`, PRs #68/#69/#71; SHAs `aac9a89`, `6d2eaeb`, `394cc3a`, `799c61c`, `63dd1d8` across 2026-04-17/18).
  - OAuth client for Quest Diagnostics (`aac9a89` 2026-04-17, `feat(fhir): OAuth + FHIR client + sync service + routes`).
  - LOINC code → internal biomarker mapping (`6d2eaeb` 2026-04-17, `feat(fhir): foundation — schema, RLS, LOINC mapping, mock server`).
  - Mock FHIR server for tests.
  - Migration: `backend/prisma/migrations/20260418_add_lab_connections/` — adds `LabConnection` with RLS policies for Quest OAuth token storage.
- **Backend controller-test coverage** — settings/biomarker/goals/needs controllers now have Jest tests (`72defaa` 2026-04-18).
- **Health-needs filters + manual create** — status/urgency filters and manual-create modal (`4d31ec0` 2026-04-18).

### Changed
- **`uploadController` split into `upload/` module** — refactored and simultaneously closes F-21 (`1ab1206` 2026-04-18, `refactor(backend): split uploadController into upload/ module + fix F-21`). See [`SECURITY_STATUS.md#f-21`](./SECURITY_STATUS.md).
- **Backend simplifications** — controllers, services, middleware (`8b40079` 2026-04-18).
- **Frontend TypeScript** — 131 `tsc` errors blocking `npm run build` resolved (`b047645` 2026-04-18).
- **Dependencies bumped** (all 2026-04-18):
  - `express-rate-limit` 7.5.1 → 8.3.2 (`7c73155`).
  - `@types/node` 20.19.27 → 25.6.0 (`d127345`).
  - `@prisma/adapter-pg` 7.2.0 → 7.7.0 (`c998dfb`).
  - `@typescript-eslint/eslint-plugin` bumped (`3cbe07d`).
  - `vitest` 4.0.16 → 4.1.4 in backend (`65ae85e`).
  - `@rollup/rollup-win32-arm64-msvc` bumped (`ee57278`).
  - `@anthropic-ai/sdk` 0.71.2 → 0.90.0 (`da0eee8`).

### Fixed
- **CSRF exempts `/ai/chat`** — duplicate route-level `csrfProtection` removed; `/ai/*` routes now correctly exempted in the central chain (`2843339`, `32cfa44`/`cba12b9`, `5e4241e` PR #72, `dc8f905` 2026-04-18).
- **AI chat decryption moved out of `withRLSContext` transaction** — avoids holding a DB transaction across Anthropic streaming I/O (`52507c3` 2026-04-18).
- **CORS** — production frontend origins hardcoded as always-allowed (`8deed18`), and `CORS_ORIGIN` parsed + unioned in every environment (`64b7d14`) 2026-04-18.
- **Lint** — unused `LabConnectionsSection` import dropped (`8ee5486`, `2de0208` PR #70, `5df1571`).

### Security
- **F-3/F-4/F-5/F-7 trust gaps closed** (`b2b762e` 2026-04-18, `fix(security): close F-3/F-4/F-5/F-7 trust gaps`). See [`SECURITY_STATUS.md#f-3`](./SECURITY_STATUS.md), F-4, F-5, F-7.

### Infrastructure
- **CORS redeploy trigger** — empty commit forced redeploy for `CORS_ORIGIN` env var to take effect (`f07f587` 2026-04-18) — this is the concrete downstream of the [`RUNBOOK.md`](./RUNBOOK.md#rollback) Cloud-Run-env-update pinning postmortem filed 2026-04-17.

---

## [2026-04-17] — Health Guide AI, Health Profile, Dashboard overview, High-severity batch

### Added
- **AI Health Guide chat** — streaming conversational AI over the user's own health data (PRs #58/#59/#60; SHAs `c96e468`, `b2ddce6`, `c037831`, `9fcf0f8`, `76e4b12`, `34b861f`, `334c247`, `3cd6c44` 2026-04-17).
  - Streaming `/ai/chat` endpoint with SSE (`b2ddce6`).
  - Health-context service that supplies biomarkers/goals/needs as prompt context.
  - Knowledge layer for canned educational content (`c037831`, PR #59).
  - Self-reported health profile with condition-aware AI context (`9fcf0f8`, PR #60); settings form + Health Guide profile indicator (`76e4b12`).
  - Migration: `backend/prisma/migrations/20260418_add_health_profile/` — new `HealthProfile` model with RLS policies.
- **Dashboard overview** — trend indicators, activity feed, contextual pro-tip (`43a9db5` 2026-04-17, PR #54).
- **Biomarkers: inline sparklines, date grouping, range bars, opt-in AI guidance** (`d46339d` 2026-04-17, PR #54).
- **Upload review step** — extraction-review preview before import (`d7f49b1` 2026-04-17, PR #54).
- **Settings persistence** — profile + notification preferences (`66bbe00` 2026-04-17, PR #54). Migration: `backend/prisma/migrations/20260417_add_notification_preferences/`.
- **Account settings page** (PR #54, consolidated).
- **Goals/Needs wired to real APIs + sidebar nav** (`4dc15e9` 2026-04-17, PR #57).
- **Expenses: actuals endpoints + UI for recorded claims** (`92fd090`, `c881c14` 2026-04-17, PR #56) — users can now record actual claim outcomes alongside projections.
- **Expenses: spending timeline chart + structured AI analysis output** (`56fffbd`, `b9432e7` 2026-04-17, PR #55).
- **Insurance Hub refactor** — split into focused sub-components (`147c8a1`, `d16e9e1` 2026-04-17, PR #55).
- **Markdown rendering utility** extracted to `utils/renderMarkdown` (`f2bea49` 2026-04-17).

### Changed
- **`withRLSContext` transaction timeouts** — `maxWait` 5s→20s, `timeout` 15s→30s to accommodate Claude streaming reads under RLS (`cacb750` 2026-04-17).

### Security
- **5 High-severity audit findings batch-closed** (`fb8a864` 2026-04-17, PR #52; component SHAs below):
  - `b035e97` — CI uses `npm ci` and enforces `npm audit high+` as a CI gate.
  - `7baf2d2` — `blockDemoAdminAccess` attached to `adminRoutes`.
  - `8a0ea3f` — session IP read from `req.ip` (trust-proxy-aware) instead of raw `X-Forwarded-For`.
  - `9499308` — JWT algorithm / issuer / audience asserted on both sign and verify.
  - `ca74644` — Zod password policy aligned with service-level check (12 chars).
- **C-7 gaps + F-3 IDOR closed** (`4fa53a6` 2026-04-17).
- **C-8 Part 2b-ii** — `adminRoutes`, `auditLog` runtime, and users-by-email wrapped in RLS context (`da6f536`, `74af20e` PR #43 2026-04-17).
- **C-8 Part C cutover runbook** — docs filed for the production DB-role switch (`a738711`, `cec5a40` 2026-04-17, PR #53).

### Fixed
- **`/auth/refresh` and `/auth/logout` exempted from 401 retry loop** — clears a request storm that occurred when the refresh cookie was already invalid (`de1eeb0`, `50de4d2` 2026-04-17, PR #44).
- **Dashboard tests aligned with new greeting** + Prisma client/CLI version aligned (`f5357fc`, `6aee3c6` 2026-04-17).

### Infrastructure
- **`deploy.yml` hardened** (`f352593`, `bf381e7` 2026-04-17, PR #51):
  - `--no-traffic` guard on `gcloud run deploy` — new revisions start at 0% traffic.
  - Smoke test between deploy and promote.
  - Explicit `gcloud run services update-traffic` promote step.
  - This is the direct fix for the 2026-04-17 Cloud-Run-env-update pinning postmortem (see [`RUNBOOK.md#rollback`](./RUNBOOK.md#rollback) and project-memory `cloud-run-env-update-pinning.md`).

---

## [2026-04-16] — Critical-severity sweep: C-1 through C-7 closed, Anthropic BAA activated

This release is the single biggest security milestone in the project's history: six of the eight Critical audit findings closed on the same day, plus the Anthropic Business Associate Agreement signed and activated.

### Security
- **C-1 — RLS enforced via transaction-scoped `SET LOCAL`** (`77ac5a5`, `9727492` 2026-04-16, PR #30). Previously `set_config` ran outside a transaction so the session variable was silently dropped when Prisma's pg pool reused a connection. Regression test `f336f3d` `test(rls): add regression test proving tenant isolation via withRLSContext` proves the fix. See [`SECURITY_STATUS.md#c-1`](./SECURITY_STATUS.md). **Caveat**: C-1 closes the *code-level* bug; the project-memory note "app runs as a `BYPASSRLS` role" means policies still don't *enforce* at runtime until the C-8 role cutover completes.
- **C-2 — Audit-log system salt encrypted at rest** (`1ba923c`, `f6bdc9a` 2026-04-16, PR #32) with coverage tests for fresh-install, normal-boot, and legacy-migration paths (`6b1b3d9`).
- **C-3 — JWT secret fallbacks removed; env vars required in every environment** (`beb2993`, `2808b97` 2026-04-16, PR #33) + env-var tests (`596146e`).
- **C-4 — Insecure `PHI_ENCRYPTION_KEY` rejected in every environment** (`61e1e7a`, `ea67ccb` 2026-04-16, PR #34) + flipped assertion and regression guards (`b6057a8`).
- **C-5 — `jspdf` bumped to 4.2.1+ to close CVE-2026-31938 and siblings** (`02e9c48`, `4a08802` 2026-04-16, PR #36).
- **C-6 — GCS objects deleted on account / data deletion** (`6dde28c`, `0f7970a` 2026-04-16, PR #37). Prerequisite: `375c9b2` `feat(storage): add deleteFiles batch helper to storageService`.
- **C-7 — PHI minimization before Claude API calls** (`c3fe7d7`, `8c19438` 2026-04-16, PR #39). Prerequisites: `d6fb811` (expand `phiRedaction` pattern set, add `redactPHI` helper) and `d671887` (local PDF text-extraction helper) — PHI is now redacted locally before any prompt leaves the cluster.
- **C-8 — filed as an audit finding and worked in parts** (2026-04-16):
  - `35c8981`, `56bba28` PR #31 — C-8 **filed**: "RLS policies not enforced at runtime (BYPASSRLS)".
  - `745c699`, `65f9ffb` PR #40 — **Part 1**: `auditService.initialize` wrapped in admin RLS context.
  - `650f692`, `a648eb8` PR #41 — **Part 2a**: cross-user `ProviderPatient` writes wrapped in RLS context.
  - `1e8e704`, `4fa6460` PR #42 — **Part 2b-i**: `authService` + `userEncryption` pre-auth paths wrapped in RLS context.
- **F-14 / F-15 — `set_config` SQL injection + raw-SQL interpolation** closed by parameterizing `set_config` (`ee86fd4` 2026-04-16; bundled into PR #30). Project-memory note identified PR #30 as the shipping vehicle for C-1/F-14/F-15.
- **Documentation sweep** — stale status references cleaned post-C-1..C-6 merges (`cddb880`, `3e3faab` PR #38).

### Added
- **Anthropic BAA active** — Business Associate Agreement signed 2026-04-16; `docs: Anthropic BAA signed 2026-04-16; C-7 now the production gate` (`e7c3975`, `2bd7e36` PR #35 2026-04-16). With the BAA in place and C-7 closed, PHI-in-prompts is now contractually covered. Project memory notes `ANTHROPIC_BAA_ACTIVE` env var flipped on via Cloud Run env update (see 2026-04-17 infrastructure entry). See [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).
- **`storageService.deleteFiles` batch helper** (`375c9b2` 2026-04-16).
- **PDF local text-extraction helper** (`d671887` 2026-04-16) — a prerequisite for C-7.
- **Expanded `phiRedaction` pattern set + `redactPHI` helper** (`d6fb811` 2026-04-16).

### Infrastructure
- **`@google-cloud/storage` bump in backend** (`1ecbe0f` PR #29 2026-04-16).
- **Full prompt library refresh** and project-doc regeneration (`ea9520a` 2026-04-16) — this is the provenance for the current `prompts/*.md` set that produced this CHANGELOG.

---

## [2026-02-06 / 2026-02-07] — Batch 3 security fixes + dependency wave

### Security
- **Batch 3 hardening** — PHI redaction, AI cost tracking, demo restrictions (`6a5d56e` 2026-02-06, `Implement Batch 3 security fixes: PHI redaction, AI cost tracking, demo restrictions`).
- **Prompt-injection defense** on Claude endpoints (`eecf14f` 2026-02-06, `Prevent prompt injection in Claude API endpoints`).
- **Backend hardening sweep** — RLS, IDOR fixes, timeouts, validation, logging (`efaec73` 2026-02-06, `Harden backend security: RLS, IDOR fixes, timeouts, validation, logging`).
- **AI rate limiter** applied to Health Goals and Health Needs endpoints (`6987d9f` 2026-02-06).

### Added
- **Project documentation baseline** — security audits, architecture, and runbook docs (`abe42fb` 2026-02-06, `Add project documentation: security audits, architecture, and runbook`) — this is the provenance of the original `New Project Documents/` folder contents.

### Fixed
- **CI lint + tests for Batch 3** (`3df9313` 2026-02-06).
- **Lint cleanup**: unused vars, explicit `any` casts removed (`49878ea` 2026-02-06).
- **Fix expense encryption types** — migration `20260206_fix_expense_encryption_types` landed; all monetary fields converted to `*Encrypted String` ciphertext columns (not Decimal). Direct link: [`CLAUDE.md` PHI Encryption](../CLAUDE.md#phi-encryption).

### Changed
- **Prompt library + `CLAUDE.md` aligned with actual codebase** (`7579b19` 2026-02-06).

### Infrastructure (dependency bumps, all 2026-02-07)
- Frontend / tooling: `react` + `@types/react` (`ddb1085`), `jspdf` 4.0.0 → 4.1.0 (`0c5abb0`), `@google-cloud/storage` (`87e8284`), `@rollup/wasm-node` 4.53.4 → 4.57.1 (`311bbe2`), `vitest` 4.0.16 → 4.0.18 in backend (`4bed04b`), `@types/node` 20.19.27 → 25.2.1 in backend (`336160f`), `pdf-parse` 1.1.1 → 2.4.5 (`f17cccf`), `@eslint/js` 9.39.2 → 10.0.1 (`d58033e`), `@typescript-eslint/eslint-plugin` (`a10019c`), `@vitejs/plugin-react` 4.7.0 → 5.1.3 (`1ea9973`), `@prisma/adapter-pg` 7.2.0 → 7.3.0 (`da06ec0`), `typescript-eslint` 8.49.0 → 8.54.0 (`fa48dfe`), `express-rate-limit` 7.5.1 → 8.2.1 (`9713a46`), `vite` 7.3.0 → 7.3.1 (`292a4f9`), `express` + `@types/express` (`8a3b05a`), `globals` 15.15.0 → 17.3.0 (`5ac3b9b`), `@rollup/rollup-win32-arm64-msvc` (`0503a7a`), `vitest` 4.0.15 → 4.0.18 (`7615967`), `eslint-plugin-react-hooks` 5.2.0 → 7.0.1 (`3ca2cd8`), `zod` 3.25.76 → 4.3.6 (`a930c04`).
- **GitHub Actions**: `actions/checkout` 4 → 6 (`03f2538`), `actions/upload-artifact` 4 → 6 (`30da7ca`), `actions/setup-node` 4 → 6 (`1a2d0c1`), `google-github-actions/setup-gcloud` 2 → 3 (`714c5f5`), `google-github-actions/auth` 2 → 3 (`e75c5f8`).

---

## [2026-01-11] — Frontend crash fix

### Fixed
- **CostOptimization crash** — handles undefined API responses instead of blowing up (`a292287` 2026-01-11).

---

## [2026-01-10] — Expense tracking feature + insurance display polish

### Added
- **Expense tracking + cost optimization** — both backend (`baa6425`) and frontend (`6aba34a`) landed 2026-01-10.
  - Migration: `backend/prisma/migrations/20260111_add_expense_tracking/` (commit `baa6425`, dated 2026-01-10).
  - Migration: `backend/prisma/migrations/20260111_add_out_of_network_fields/` (from `f0b0288` 2026-01-10, `Add out-of-network financial fields to insurance plan schema`).
- **Re-analyze Plan feature** for SBC extraction (`0239e81` 2026-01-10).
- **Insurance plan delete** with success toast (`10d4bbe`, `a3189c4` 2026-01-10).
- **Coinsurance support in SBC extraction** (`df1747e` 2026-01-10) — migration `20260110_add_coinsurance_columns/`.
- **README with architecture diagrams** + prompt reorganization (`abf79e2` 2026-01-10).

### Changed
- Display conventions: `$0` → `--` in preventive services (`b8db4bc`), across insurance cost displays (`61c7648`), and "No charge" → `--` in plan display (`80d68e7`).

### Fixed
- **Frontend crash from `reduce()` on undefined** — null checks added (`3c0f3fb` 2026-01-10).
- **ESLint errors** in insurance components (`6be8a92`) and `expenseController.ts` (`71824af`).
- **Coinsurance display** in Therapy and Other Services sections (`6582759`); rendering when `copay` is null (`67e069c`).
- **SBC extraction** — reverted broken prompt to working state (`e2afff2`) after attempted improvements (`1aa50a6`) regressed output.
- **Insurance plan DELETE exempted from CSRF** (Bearer-token-protected route; `bb66914`).
- **DB connection timeout increased** for Cloud SQL (`cdd1d7f`).
- **500 on decrypting insurance plan PHI** (`9167a07`).
- **Auth-token restoration order** on page refresh — `refreshToken`-first flow, access token now returned in `/auth/refresh` response body (`195ccc1`, `0889ff6`, `17b8e91`, `c929a28`, `c903916`).
- **Debug-logging scaffolds** added to diagnose insurance fetch race conditions (`a44cea7`, `2432bc6`) and later removed.

---

## [2026-01-09] — Insurance feature launch + Dashboard refactor + dark mode default

### Added
- **Insurance feature with Claude Sonnet SBC parsing** (`019eb46` 2026-01-09) — initial release.
- **Comprehensive insurance plan detail view** (`e3d44de` 2026-01-09).
- **Comprehensive SBC extraction** with all coverage details (`4badc6e` 2026-01-09).
- **Insurance coverage fields migration** (`9e2961e` 2026-01-09) — corresponds to `backend/prisma/migrations/20260110_add_comprehensive_coverage_fields/` and `20260110_add_extended_coverage_fields/`.
- **Dark mode default + premium login UI redesign** (`b949fa6` 2026-01-09).
- **Mobile value proposition on login page** (`96c25a4` 2026-01-09).

### Changed
- **Dashboard refactor** — `Dashboard.tsx` shrunk 75% (1,136 → 284 lines), infinite-loop fix included (`dc65ca4` 2026-01-09).
- **Initial bundle reduced 91%** (895 KB → 78 KB) via code splitting and lazy loading (`1fb87e2` 2026-01-09).
- **Biomarker reference ranges corrected** based on clinical verification (`d12ca2a`, `7e0bf85` 2026-01-09) — advanced lipid markers added.
- **Consolidated duplicate code** across multiple files (`197da0a` 2026-01-09).
- **Simplified `api.ts`, `measurementOptions.ts`, `InsuranceKnowledgeBase`** (`c19246c` 2026-01-09).
- **`biomarkerPatterns` split; `InsurancePlanCompare` simplified** (`7d14bd7` 2026-01-09).

### Fixed
- **SBC extraction display** — flat API fields transformed to UI arrays (`405ef6b` 2026-01-09).
- **Insurance plans disappearing after page refresh** (`de689c9` 2026-01-09).
- **Schema mismatch preventing insurance plan saves** (`8df7c64` 2026-01-09).
- **Error-message extraction in SBC upload** (`e82f71c` 2026-01-09).
- **Claude API `max_tokens` reduced** to valid limit (`e029127` 2026-01-09).
- **PDF.js removed from frontend SBC pipeline** — PDF.js-in-browser was causing bundle-size and CSP issues; all parsing is backend-side now (`4654968`, `8f9314f`, `0d2cd7a` 2026-01-09).
- **Various polish**: Insurance category name matched with navigation (`f6b7cc3`), `InsuranceHub` wired with correct props in Dashboard (`cf4f341`), insurance tracking fields added to Prisma schema (`469b089`), Health Score shows `—` when no biomarkers (`4d9119b`), Lab OCR button restored in Quick Actions (`402fe51`), Account Settings button fixed (`d2e8c3a`), Dashboard nav consistency (`1620733`), lint fixes in Dashboard refactor (`813364f`), dead DNA and healthAnalysis hooks removed (`412a8e3`), unused imports in InsuranceKnowledgeBase (`4e6adc1`), unused type imports in EnhancedInsuranceUpload (`6cdf698`), LoginPage tests aligned with dark UI (`2a72eb4`).

### Security
- **SQL injection in RLS context fixed; debug logging removed** (`a133256` 2026-01-09, `security: fix SQL injection in RLS context, remove debug logging`). This is the first RLS-related security commit; the complete hardening lands 2026-04-16 as C-1 (`77ac5a5`).

---

## [2026-01-08] — AI Health Guide MVP + CSRF cross-domain cookies + file repository

### Added
- **AI Health Guide** — educational per-biomarker guidance (`c475dca`, `25536da` 2026-01-08).
- **Trends page** for biomarker trend analysis (`c77a968` 2026-01-08).
- **AI Health Guide shown for all biomarkers when expanded** (`d26725d` 2026-01-08).
- **File repository for uploaded lab reports** (`3c5b852` 2026-01-08).
- **Biomarker count badges on sidebar categories** (`6b50faf` 2026-01-08).
- **Claude API replaces PDF extraction for biomarker extraction** (`7563bc8` 2026-01-08).
- **`pdf-parse` for direct text extraction, OCR fallback** (`1312413` 2026-01-08).
- **Extracted `labDate` from Claude used as biomarker measurement date** (`36b7306` 2026-01-08).

### Changed
- **AI Health Guide UX + output size reduced** (`6a0d135` 2026-01-08).
- **AI Health Guide prompt improved + model upgraded** (`39f0d3b` 2026-01-08).
- **Markdown rendering in AI Health Guide** (`078898d` 2026-01-08).
- **Bundle split into smaller chunks** for faster loading (`8b19586` 2026-01-08); React + recharts kept in the same bundle to fix `forwardRef` error (`1e1bac0`).

### Fixed
- **Show More click no longer collapses biomarker card** (`b37786` 2026-01-08).
- **`/biomarkers/:id/guidance` exempted from CSRF** (`b9203ef` 2026-01-08).
- **CORS + cross-domain cookies** — domain added to all auth cookies (`50d7426`), CSRF cross-domain supported (`8db4317`), CORS config fixed (`327b2f4`), CORS preflight handled (`ad2dff9` 2026-01-08).
- **Deployment stability**: graceful handling of missing `ANTHROPIC_API_KEY` (`e7ae477`); dynamic import for Anthropic SDK to prevent startup crash (`769685c`); switched to `require()` when dynamic import misbehaved (`94004d0`); AI guidance re-added using `fetch` instead of SDK (`e86a999`). Revert/diagnose cycle recorded at `12292bb`.
- **Biomarker decryption timing logs** (`97b8975` 2026-01-08).
- **CSRF token regex for cookie matching** (`b721788`); CSRF included in AI guidance API calls (`7ad1272`).
- **Biomarkers disappearing due to pagination** (`080ad8e` 2026-01-08).
- **Lab upload modal kept open** after extraction to show results (`45cef63` 2026-01-08).
- **Migration**: `backend/prisma/migrations/20260108000000_add_user_files_table/` — the `UserFile` model for the file repository (provenance: `3c5b852`).

### Infrastructure
- **Docker image rebuilt on every deploy** (`f0eff7a` 2026-01-08).

---

## [2026-01-07] — OCR shipping, Account Settings page, Data Export/Delete, biomarker expansion

### Added
- **OCR for lab results** (`202f2dd` 2026-01-07) via Google Document AI.
- **Account Settings page with dark-mode support** (`e900d9e` 2026-01-07).
- **Export All My Data** functionality (`bc2f6bc` 2026-01-07).
- **Delete all data feature** + biomarker extraction bug fix (`04b3a01` 2026-01-07).
- **Full mobile responsiveness** across app (`19aea90` 2026-01-07).
- **`measurementOptions.ts` expanded** with 200+ biomarkers across 24 categories (`e1fbe2d` 2026-01-07).
- **Comprehensive biomarker patterns (200+) across 24 categories** (`0f7336d` 2026-01-07).
- **New biomarker categories infrastructure** (`faa84a7` 2026-01-07).
- **Comprehensive biomarker extraction with debug logging** (`3eda225` 2026-01-07).

### Fixed
- **OCR stability**: service-account key gitignored and removed from git history (`17de968`, `528d5f9`); build errors resolved (`61fe2d9`); Dashboard tests updated with `LabUploadModal` + `uploadUtils` mocks (`289c6b8`, `f39f71f`); module tag added to `ocrService` (`0cd3162`); CSRF exempted on file upload routes (`750357e`), CSRF token added to upload requests (`be803f3`); JSON-credentials support in `GOOGLE_APPLICATION_CREDENTIALS` (`2b79d46`).
- **Biomarker extraction robustness**: more flexible pattern matching for OCR (`8e87ea3`), extraction tolerates Quest whitespace (`a59c547`), `[\s\S]{0,50}?` flexible pattern (`e79e1e2`), detailed debug logging (`eb3d829`), `console.log` used instead of logger for Cloud Run visibility (`58853b5`), improved filtering (`a6e177d`), multi-line Document-AI extraction (`f62796f`), lint fix restore (`425df7f`, `a26e722`), newline-spanning extraction + table logging (`56fd294`), immediate-next-line only multi-line check (`2cbf6e4`), comprehensive OCR logging (`eef8cd2`), rebuild lockfile with `pdf-parse` 1.x (`154e52e`, `254e2ec`).
- **Settings routes**: skip CSRF (Bearer-token protected) (`adca319`), add RLS context to settings delete-data endpoint (`87545ec`), typed `AuthenticatedRequest` instead of `any` (`12d57ff`), frontend DELETE requests include CSRF token (`4d40b79`).
- **Dark mode**: text visibility across components (`4952c95`).
- **Sidebar scrolling** enabled for biomarker categories (`d851fd3`).
- **`jspdf` bumped to 4.0.0** to resolve a critical vulnerability (`cb662c5`); lockfile mismatch resolved (`5711094`).
- **Unused import removed** from `AccountSettingsPage` (`cdeaaed`).

---

## PR table — every merged PR since 2026-01-07

Every PR with a `(#N)` marker in the commit subject since the cutoff. Sorted descending (most recent first). "Breaking?" is "no" unless marked otherwise — no breaking API changes were found in this range.

| PR # | Date (ISO) | Title (from commit subject) | Category | User-visible impact | Breaking? |
|---|---|---|---|---|---|
| #74 | 2026-04-23 | Cleanup/dead code audit 2026 04 23 | Cleanup | No UI change; DNA/Genetics feature surface removed | no |
| #73 | 2026-04-23 | chore: sync working tree — staging env, onboarding, plan gating, e2e | Infra/Feature | Onboarding flow, plan gating, encrypted health-goal target, staging deploy pipeline | no |
| #72 | 2026-04-18 | fix(csrf): actually exempt /ai/chat from validation | Fixed | `/ai/chat` requests no longer 403 after the earlier exemption bug | no |
| #71 | 2026-04-18 | feat(quest-fhir): FHIR integration + backend refactor + test coverage | Added | Quest lab connection via FHIR; LabConnection model w/ RLS | no |
| #70 | 2026-04-18 | fix(lint): drop unused LabConnectionsSection import | Fixed | Build unblocks; no user-visible UI change | no |
| #69 | 2026-04-18 | Feat/quest fhir integration | Added | Intermediate merge of the quest-fhir branch (superseded by #71) | no |
| #68 | 2026-04-18 | Feat/quest fhir integration | Added | Earlier intermediate merge of the quest-fhir branch | no |
| #60 | 2026-04-17 | feat(health-profile): self-reported profile + condition-aware AI context | Added | Users can file a health profile; AI responses are condition-aware | no |
| #59 | 2026-04-17 | feat(ai): knowledge layer for Health Guide chat | Added | Health Guide answers now draw on a knowledge layer | no |
| #58 | 2026-04-17 | feat(ai): Health Guide — streaming conversational AI over user's health data | Added | Chat UI with SSE streaming over biomarkers/goals/needs | no |
| #57 | 2026-04-17 | feat(health): wire goals/needs UI to real APIs + add sidebar nav | Added | Goals / Needs reachable from sidebar; real-API backed | no |
| #56 | 2026-04-17 | feat(expenses): actuals endpoints + UI for recorded claims | Added | Can now record actual claim outcomes | no |
| #55 | 2026-04-17 | feat: insurance hub refactor + expense visualization | Changed/Added | Spending timeline chart; structured AI analysis | no |
| #54 | 2026-04-17 | feat: account settings, upload review step, dashboard overview | Added | Settings persisted; upload preview before import; dashboard trend indicators, activity feed, pro tip | no |
| #53 | 2026-04-17 | docs: add C-8 Part C DB role cutover runbook | Docs | No runtime change; cutover-prep runbook filed | no |
| #52 | 2026-04-17 | fix(security): batch-close 5 High-severity audit findings | Security | CI audit gate, admin demo block, `req.ip` session IP, JWT alg/iss/aud asserted, Zod pw policy 12 chars | no |
| #51 | 2026-04-17 | fix(ci): add --no-traffic guard + smoke test + explicit promote to deploy.yml | Infra | New Cloud Run revisions start at 0% traffic and must pass smoke test before promote | no |
| #44 | 2026-04-17 | fix(auth): exempt /auth/refresh and /auth/logout from 401 retry loop | Fixed | No more request storm when refresh cookie is invalid | no |
| #43 | 2026-04-17 | fix(security): wrap adminRoutes + auditLog runtime + users-by-email in RLS context (C-8 Part 2b-ii) | Security | RLS context now set on admin + audit + email-lookup paths | no |
| #42 | 2026-04-16 | fix(security): wrap authService + userEncryption pre-auth paths in RLS context (C-8 Part 2b-i) | Security | RLS context set on pre-auth flows | no |
| #41 | 2026-04-16 | fix(security): wrap cross-user ProviderPatient writes in RLS context (C-8 Part 2a) | Security | Provider-patient writes enforce RLS context | no |
| #40 | 2026-04-16 | fix(security): wrap auditService.initialize in admin RLS context (C-8 Part 1) | Security | Audit service boot runs under admin RLS context | no |
| #39 | 2026-04-16 | fix(security): close C-7 — PHI minimization before Claude API calls | Security | PHI redacted locally before prompts leave the cluster | no |
| #38 | 2026-04-16 | docs(security): sweep stale status references post C-1..C-6 merges | Docs | No runtime impact | no |
| #37 | 2026-04-16 | fix(security): close C-6 — delete GCS objects on account/data deletion | Security | Data deletion now purges GCS files too | no |
| #36 | 2026-04-16 | fix(deps): bump jspdf to 4.2.1+ to close CVE-2026-31938 and siblings (C-5) | Security | No UI change; dep CVE closed | no |
| #35 | 2026-04-16 | docs: Anthropic BAA signed 2026-04-16; C-7 now the production gate | Docs/Compliance | BAA active; C-7 identified as production gate | no |
| #34 | 2026-04-16 | fix(security): close C-4 — reject insecure PHI encryption key in all environments | Security | Insecure keys rejected at boot in every env | no |
| #33 | 2026-04-16 | fix(security): close C-3 — JWT secret fallbacks removed | Security | Boot fails without explicit JWT secrets | no |
| #32 | 2026-04-16 | fix(security): encrypt audit-log system salt at rest (C-2) | Security | Audit salt encrypted at rest | no |
| #31 | 2026-04-16 | docs(security): file C-8 — RLS policies not enforced at runtime (BYPASSRLS) | Docs | Finding C-8 formally filed | no |
| #30 | 2026-04-16 | fix(security): close C-1 — enforce RLS via transaction-scoped SET LOCAL | Security | **Tenant isolation hardened** — `set_config` in-transaction; closes C-1 + F-14 + F-15 per project memory | no |
| #29 | 2026-04-16 | build(deps): bump @google-cloud/storage in /backend | Infra | Dep bump | no |

PRs #1-#28 predate the cutoff or were not assigned in this range. Commit `ae64596` (a `WIP on feat/quest-fhir-integration` stash commit) and `d62a8e7` (a local merge) are excluded — they are not GitHub PR merges.

---

## Statistics

### Activity

| Metric | Value | Source |
|---|---|---|
| Commits in range | 292 | `git log --all --since=2026-01-07 --pretty=format:'%h' | wc -l` |
| PRs merged in range | 32 | Commit subjects with `(#N)` markers since cutoff |
| Deploy dates observed (commit bursts) | 2026-01-07, 2026-01-08, 2026-01-09, 2026-01-10, 2026-01-11, 2026-02-06, 2026-02-07, 2026-04-16, 2026-04-17, 2026-04-18, 2026-04-23 | Dates in `git log` output |
| New migrations since cutoff | 14 | See [migration table](#new-migrations) below |
| Security-related commits | 29 | Commits matching `fix(security)`, `docs(security)`, or `security:` |
| Dependency bumps (commits) | 26 | Commits matching `build(deps)` or `fix(deps)` |

### New migrations <a id="new-migrations"></a>

All 14 migration directories added under `backend/prisma/migrations/` since 2026-01-07 are treated as potentially user-visible schema changes. See [`DATA_MODEL.md`](./DATA_MODEL.md) for per-model impact.

| # | Directory | First shipped | Purpose |
|---|---|---|---|
| 1 | `20260107_add_rls_policies/` | 2026-01-07 | Row-Level Security policies — the foundation the C-1..C-8 work sits on |
| 2 | `20260108000000_add_user_files_table/` | 2026-01-08 | `UserFile` model for file repository |
| 3 | `20260110_add_comprehensive_coverage_fields/` | 2026-01-09 | Insurance coverage fields |
| 4 | `20260110_add_extended_coverage_fields/` | 2026-01-09 | Insurance coverage fields (extended) |
| 5 | `20260110_add_coinsurance_columns/` | 2026-01-10 | Coinsurance fields on insurance plans |
| 6 | `20260111_add_out_of_network_fields/` | 2026-01-10 | Out-of-network financial fields on plans |
| 7 | `20260111_add_expense_tracking/` | 2026-01-10 | Expense tracking tables + cost optimization inputs |
| 8 | `20260206_fix_expense_encryption_types/` | 2026-02-06 | Expense monetary fields moved to `*Encrypted String` (AES-256-GCM ciphertext, not `Decimal`) |
| 9 | `20260417_add_notification_preferences/` | 2026-04-17 | User notification preferences |
| 10 | `20260418_add_health_profile/` | 2026-04-17 | `HealthProfile` self-reported profile + RLS |
| 11 | `20260418_add_lab_connections/` | 2026-04-17 | `LabConnection` (Quest FHIR OAuth tokens) + RLS |
| 12 | `20260420_add_onboarding/` | 2026-04-23 | Onboarding state columns |
| 13 | `20260420_add_user_plan/` | 2026-04-23 | `UserPlan` tiering for feature gating |
| 14 | `20260420_encrypt_health_goal_target/` | 2026-04-23 | Convert `targetValue` to encrypted storage |

### Security findings closed in this release cycle

Every finding cited in a commit subject with `fix(security)` and an ID. Cross-reference: [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

| Finding | Closed on | Via PR | Via SHA | Prior-state note |
|---|---|---|---|---|
| C-1 | 2026-04-16 | #30 | `77ac5a5` / `9727492` | RLS via transaction-scoped `SET LOCAL`. Project memory: closes C-1/F-14/F-15. |
| C-2 | 2026-04-16 | #32 | `1ba923c` / `f6bdc9a` | Audit-log system salt encrypted at rest |
| C-3 | 2026-04-16 | #33 | `beb2993` / `2808b97` | JWT secret fallbacks removed |
| C-4 | 2026-04-16 | #34 | `61e1e7a` / `ea67ccb` | Insecure PHI key rejected in every env |
| C-5 | 2026-04-16 | #36 | `02e9c48` / `4a08802` | jspdf bumped past CVE-2026-31938 |
| C-6 | 2026-04-16 | #37 | `6dde28c` / `0f7970a` | GCS objects deleted on data/account deletion |
| C-7 | 2026-04-16 | #39 | `c3fe7d7` / `8c19438` | PHI redaction before Claude calls |
| C-8 (Part 1) | 2026-04-16 | #40 | `745c699` / `65f9ffb` | auditService.initialize under admin RLS context |
| C-8 (Part 2a) | 2026-04-16 | #41 | `650f692` / `a648eb8` | ProviderPatient writes under RLS context |
| C-8 (Part 2b-i) | 2026-04-16 | #42 | `1e8e704` / `4fa6460` | authService + userEncryption pre-auth RLS context |
| C-8 (Part 2b-ii) | 2026-04-17 | #43 | `da6f536` / `74af20e` | adminRoutes + auditLog + users-by-email RLS context |
| C-8 (Part C) | **open** | — (runbook only, PR #53) | `a738711` | Runtime-role cutover still pending per project memory |
| F-3 | 2026-04-17 (and again in 2026-04-18 batch) | — | `4fa53a6`, `b2b762e` | IDOR gap closed |
| F-4 | 2026-04-18 | — | `b2b762e` | Trust gap closed |
| F-5 | 2026-04-18 | — | `b2b762e` | Trust gap closed |
| F-7 | 2026-04-18 | — | `b2b762e` | Trust gap closed |
| F-14 | 2026-04-16 | #30 (bundled) | `ee86fd4` | Parameterized `set_config` |
| F-15 | 2026-04-16 | #30 (bundled) | `ee86fd4` | Raw-SQL interpolation removed |
| F-21 | 2026-04-18 | — | `1ab1206` | Fixed while splitting uploadController |
| H-? (5 High-severity, batch) | 2026-04-17 | #52 | `b035e97` `7baf2d2` `8a0ea3f` `9499308` `ca74644` | IDs not cited in subjects — see [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) for mapping to individual H-N IDs. |

Total distinct findings closed: **19** (7 Critical + 8 related High/F-level + 4 H-level bundled in PR #52). C-8's runtime-role cutover is the one remaining open item from the Critical set.

---

## Known drift vs. CLAUDE.md

- `CLAUDE.md` still lists "**Deprecated (Still in Schema): DNA/Genetics** — DNAData, DNAVariant, GeneticTrait models — consider removing if not planned." As of PR #74 (2026-04-23), these models and tables are **removed**. `CLAUDE.md` should drop this section on next doc refresh.
- `CLAUDE.md` "Removed Features (Jan 2025)" date is a typo — the removals are January 2026. (Unchanged in this cycle; noted for the next `CLAUDE.md` pass.)

---

## Related Documents

- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — canonical register of C-N / F-N / H-N / M-N findings and their current status.
- [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) — BAA status, including Anthropic BAA activated 2026-04-16.
- [RUNBOOK.md](./RUNBOOK.md) — Cloud Run env-var update pinning postmortem (2026-04-17) and rollback procedures.
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — issues introduced or closed in this cycle.
- [DATA_MODEL.md](./DATA_MODEL.md) — per-model impact of the 14 new migrations.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — context for the FHIR integration, Health Guide streaming, and RLS context wrapping.
- [ROUTING_TABLE.md](./ROUTING_TABLE.md) — new `/ai/chat`, `/health-profile`, `/lab-connections`, `/expenses/actuals` routes.

---

## Acceptance questions (self-answered from this doc only)

**Q1. What was the cutoff date of the previous changelog entry?**
→ **2026-01-07.** See header: "Prior entry cutoff: **2026-01-07** (the prior `CHANGELOG.md` in this folder did not exist on disk at the time of generation; the floor specified by `prompts/19-changelog-doc.md` was used)."

**Q2. What shipped in PR #30, and what user-visible impact did it have?**
→ `fix(security): close C-1 — enforce RLS via transaction-scoped SET LOCAL` (2026-04-16). User-visible impact: **tenant isolation hardened** — `set_config` now runs inside a transaction so `SET LOCAL` scope survives connection reuse. Also bundled F-14 and F-15 (parameterized `set_config`, removed raw-SQL interpolation). Regression test `f336f3d` proves isolation. No UI change. See [2026-04-16] entry and PR table.

**Q3. When was the Anthropic BAA activated?**
→ **2026-04-16**, per PR #35 (`e7c3975`, `2bd7e36`): `docs: Anthropic BAA signed 2026-04-16; C-7 now the production gate`. With the BAA active and C-7 closed the same day, PHI-in-prompts is contractually covered. The `ANTHROPIC_BAA_ACTIVE` env var was flipped on via Cloud Run env update the following day, per project memory.

**Q4. Which changes are breaking?**
→ **None.** Every row of the PR table is marked "no". The closest thing to a breaking change is the removal of DNA/Genetics models in PR #74, but those were already marked Deprecated in `CLAUDE.md` and were never wired into the production UI.

**Q5. How many PRs merged since the cutoff?**
→ **32 PRs** (PR #29 through PR #74, minus gaps). See the [PR table](#pr-table--every-merged-pr-since-2026-01-07) — every row is one merged PR.

**Q6. Which migrations added/removed fields, and do users see a schema effect?**
→ **14 new migrations**; see [new migrations table](#new-migrations). Field-adding migrations (user-visible via new UI fields): `20260108000000_add_user_files_table`, `20260110_add_comprehensive_coverage_fields`, `20260110_add_extended_coverage_fields`, `20260110_add_coinsurance_columns`, `20260111_add_out_of_network_fields`, `20260111_add_expense_tracking`, `20260417_add_notification_preferences`, `20260418_add_health_profile`, `20260418_add_lab_connections`, `20260420_add_onboarding`, `20260420_add_user_plan`. Internal-only / type-conversion: `20260107_add_rls_policies` (security), `20260206_fix_expense_encryption_types` (types: Decimal → encrypted String), `20260420_encrypt_health_goal_target` (types: plaintext → encrypted). PR #74 removed DNA/Genetics tables but via application-layer cleanup rather than a `migrations/*` directory listed in this range.

**Q7. What was the most recent infrastructure change?**
→ **Staging deploy pipeline added 2026-04-23** (`.github/workflows/deploy-staging.yml`, 4,317 bytes, PR #73). The second-most-recent is the `deploy.yml` hardening on 2026-04-17 (PR #51) which added `--no-traffic`, smoke test, and explicit promote — the direct mitigation for the Cloud Run env-update pinning postmortem. See [`RUNBOOK.md`](./RUNBOOK.md).

**Q8. Which security findings closed in this release cycle?**
→ 19 distinct items: **C-1, C-2, C-3, C-4, C-5, C-6, C-7** (all 2026-04-16), **C-8 Parts 1, 2a, 2b-i** (2026-04-16) and **Part 2b-ii** (2026-04-17) — the **Part C runtime-role cutover remains open**. Plus **F-3, F-4, F-5, F-7** (2026-04-18), **F-14, F-15** (2026-04-16, bundled into PR #30), **F-21** (2026-04-18), and **5 High-severity findings batched in PR #52** (2026-04-17; IDs TBD — see [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) for the individual H-N mapping; commit subjects do not carry the H-N ID). See [security findings table](#security-findings-closed-in-this-release-cycle).

**Q9. What's in [Unreleased]?**
→ DNA/Genetics feature removal (PR #74, merged 2026-04-23, not yet promoted), the C-8 cutover prep landing (`4290520`) — which adds a startup assertion that will refuse to boot on `BYPASSRLS` — and a trivial lint fix (`1676230`). The underlying **C-8 runtime-role cutover itself has not yet run** in production per project memory.

---

## Prompt drift log

- `prompts/19-changelog-doc.md` presumes the prior `CHANGELOG.md` exists in `New Project Documents/`. It did not exist on disk at generation time; per task instructions the 2026-01-07 floor was used. Prompt author may want to soften "Prior `New Project Documents/CHANGELOG.md` — Cutoff date (last entry)" to allow a from-scratch first generation.
- `prompts/19-changelog-doc.md` requires "5 High-severity findings closed in PR #52" to cite specific H-N IDs; commit subjects under PR #52 do not carry the H-N tag (only the human-readable description). The mapping is deferred to `SECURITY_STATUS.md` rather than invented here (per the "no fabrication" rule of `_doc-quality.md`).
- `CLAUDE.md` "Deprecated (Still in Schema) — DNA/Genetics" is stale as of PR #74 2026-04-23 and should be dropped on the next refresh.
- `CLAUDE.md` "Removed Features (Jan 2025)" is a year typo — removals are Jan 2026.
