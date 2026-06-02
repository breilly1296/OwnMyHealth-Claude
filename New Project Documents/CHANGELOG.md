# Changelog

All notable, user-visible changes to **OwnMyHealth**. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are ISO `YYYY-MM-DD`.

- **Last updated**: 2026-06-01
- **Cutoff of prior entry**: none — this is the **first** `CHANGELOG.md` for the project. There was no `New Project Documents/CHANGELOG.md` before this file (verified: `Glob CHANGELOG*.md` returns only `node_modules/**` copies). The detailed history below is reconstructed from `git log` and anchored at the **2026-04-16 security baseline** (PRs #30–#42, the C-1…C-8 hardening series), the same baseline the documentation system treats as the prior cutoff. Changes before 2026-04-16 are summarized in the [Pre-baseline history](#pre-baseline-history-2026-01--2026-02) section, not enumerated per-PR.
- **HEAD at time of writing**: `13db267` — `fix(auth): fire one-time-token confirmation exactly once (#134)` (`git log -1`, 2026-06-01).

> **Versioning note**: there are **no git tags** (`git tag` returns empty) and both `package.json` files are pinned at `"version": "1.0.0"` (`package.json:3`, `backend/package.json:3`). Per project convention every entry below is dated as `deploy YYYY-MM-DD`, not a semver version. Do not infer a semver from this file.

> **PR-numbering note**: this repo merges with **two** styles, so a single grep misses half the PRs. Classic merge commits (`Merge pull request #N from …`) and squash merges with a trailing `(#N)` in the subject (no "Merge pull request" line) are **both** counted in the [PR table](#pr-table-since-the-2026-04-16-baseline). Example squash merge with no merge-commit line: `feat: verified email-change flow (request → confirm) (#133)` (`ca0024b`).

---

## [Unreleased]

Nothing is staged-but-undeployed at the time of writing. HEAD (`13db267`, #134) is the most recent merge on `master`, and the deploy pipeline auto-promotes on push to `master` after a smoke test (`.github/workflows/deploy.yml`; the `--no-traffic` guard + smoke test + explicit promote was added in PR #51, `bf381e7`). Whether the latest commit has been **promoted to 100% traffic** on Cloud Run is not recorded in the repo.

- TBD (external: confirm the currently-serving Cloud Run revision and traffic split for `13db267`/#134, GCP Console → Cloud Run → service `ownmyhealth` backend). See [`RUNBOOK.md`](./RUNBOOK.md) for the promote procedure and the known env-var/traffic-pinning footgun.

---

## [deploy 2026-06-01]

The 2026-06-01 work is two feature/fix PRs (email-change) plus four test/hardening PRs (#129–#132).

### Added
- **Verified email-change flow (request → confirm)** — PR #133 (`ca0024b`). New authenticated endpoint `POST /auth/change-email` re-authenticates with the current password, rejects same/taken addresses, then stores `pending_email` + a SHA-256-hashed `email_change_token` + 1h expiry; `confirmEmailChange` swaps the address, marks it verified, clears pending state, and **revokes all sessions** so the user re-auths under the new identity. Two emails fire: a confirm link to the NEW address and an out-of-band security notice to the OLD address.
  - Schema: migration `20260601_add_email_change` adds `pending_email VARCHAR(255)`, `email_change_token VARCHAR(255)` (unique index), `email_change_expires TIMESTAMPTZ(6)` (`backend/prisma/migrations/20260601_add_email_change/migration.sql:7-12`). User-visible schema effect: yes — users can now change their email and must confirm via a tokenized link. See [`DATA_MODEL.md`](./DATA_MODEL.md).

### Fixed
- **One-time-token confirmation fired twice** — PR #134 (`13db267`). The confirm/verify React effect depended on `[token, onSuccess]`; `onSuccess` was a fresh inline closure on every parent render, so when `AuthContext` settled its initial session check the effect re-ran and called the API a **second** time with the now-consumed single-use token — a 400 that overwrote the success state, so a SUCCESSFUL email change/verification rendered a false "failed" screen (reproduced even in a production build, not just React StrictMode). Fix: gate the call behind a run-once ref and depend only on `[token]`, calling the latest `onSuccess` via a ref. Applied to **both** `ConfirmEmailChangePage` (new flow) and `VerifyEmailPage` (pre-existing email-verification flow that shared the identical bug). Backend was correct throughout — only the UI mis-rendered. Adds a regression test asserting the confirm call fires exactly once across a parent re-render.

### Changed
- **Provider patient-detail now reads scopes from the relationship** — `829fe59` (part of the 2026-05-31 wiring PR #128, deployed 2026-05-31/06-01 window) — provider patient-detail reads scopes from `relationship.permissions`. See [Provider/Admin UI](#deploy-2026-05-31).

### Infrastructure / Tests
- **PDF report-generator now covered by tests** — PR #132 (`f85e515`, merge `3d57540`): adds `pdfReportGenerator` export tests (the previously-untested PDF report path).
- **Dependency: `vitest` bumped to `^4.1.0`** — `5309c4f`, closes advisory **GHSA-5xrq-8626-4rwp**.
- **Full provider-consent RLS test matrix** — PR #130 (`6bf51b4`): scopes, revoked/suspended relationships, `health_needs`. See [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md).
- **Provider + Admin UI test coverage** — PR #129 (`eeb2bc3`): also excludes OneDrive sync-conflict duplicate test files from the suite.

### Removed
- **Dead `rotateUserEncryptionKey` function dropped** — PR #131 (`79c532c`, tests dropped in `d445aa3`): removed the unused key-rotation "footgun" alongside a role-guard fix for restricted pages. No user-visible behavior change; eliminates a path that could have corrupted per-user keys if ever called.

---

## [deploy 2026-05-31]

The "complete wiring + UI" release (PR #128, `fa7c50c`) — turns several backend-only features into real screens, plus a batch of enum/contract bug fixes.

### Added
- **Provider–patient collaboration UI** — `cdd2156`. The consent-based provider→patient data-sharing backend (long present) now has a real frontend. See [`FRONTEND_MAP.md`](./FRONTEND_MAP.md).
- **Admin console UI + missing API client methods** — `7764e79`. Admin user-management / audit-viewer / health-stats screens wired to the admin API.
- **Real benefit search + coverage matrix wired to backend** — `1100dfc` (insurance).
- **"Sign out of all devices" wired to `/auth/logout-all`** — `d589d32`.
- **Expense ↔ plan deductible/OOP sync from logged claims** — `aef282a`. Logging a claim now advances the plan's deductible/out-of-pocket counters.

### Fixed
- **Provider patient-detail scopes** — `829fe59`: read patient-detail scopes from `relationship.permissions` instead of an incorrect source (was over/under-granting fields).
- **Goal reminder scheduler** — `a22bb63`: honor goal `reminderFrequency` + stamp `lastReminderSent` (previously ignored the per-goal frequency).
- **FHIR plan gating** — `92f4841`: enforce the `questFhirIntegration` plan entitlement on FHIR routes.
- **`GET /health-needs/summary` was unmounted** — `d9401d5`: route now mounted.
- **Cost-analysis API missing `createdAt`** — `a17f2cc`: returns `createdAt` so the UI can sort/display analysis timestamps.
- **SBC extraction model/pricing** — `bf38119`: price SBC extraction by using `claude-sonnet-4-5`.
- **Goal-status enum mismatch** — `fd3bf8c`: align the goal-status enum with Prisma `GoalStatus` (frontend was sending values the DB rejected).

### Infrastructure
- **Build excludes OneDrive sync-conflict duplicates from `tsc`** — `cd7ab6c`. The repo lives under OneDrive; sync creates `… (1).ts` duplicates that broke the type-check. See [`LOCAL_DEV.md`](./LOCAL_DEV.md) and [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

---

## [deploy 2026-05-30]

Largest hardening/cleanup batch: closes a wave of medium-severity audit findings and adds two infra options (Redis rate-limit store, scheduled audit retention). PRs #116–#127.

### Security
- **Audit value-encryption fails closed** — PR (`5c7023a`, #28): on a value-encryption error the audit writer now **fails the operation** instead of writing an `[ENCRYPTION_FAILED]` sentinel into the audit row. See [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).
- **Consent-mutation audit rows written on the caller's transaction** — `3d5ff07` (#17): consent changes and their audit rows now commit atomically (same `tx`), so a consent change can't persist without its audit trail.
- **Audit-log transaction atomicity** — PR #122 (`4ed7f00`): the consent/audit atomicity fix above, merged.
- **Register/login account-enumeration hardening** — PR #116 (`a7ac84b`) + `db4289b` (#18) + `067f2fd` (#18): equalize register timing on the existing-email path and stop leaking account existence on registration. (Login-side `remainingAttempts` leak was closed earlier in PR #113; see [2026-05-29](#deploy-2026-05-29).)

### Added
- **Redis-backed rate limiting (optional, shared)** — PR #125 (`d72651c`, #37). `middleware/rateLimitStore.ts` uses Redis when `REDIS_URL` is set, falling back to in-memory otherwise; this makes the **8 named limiters** in `rateLimiter.ts` consistent across Cloud Run instances. Limiters: `standardLimiter`, `authLimiter`, `strictAuthLimiter`, `uploadLimiter`, `sensitiveLimiter`, `aiLimiter`, `providerAccessRequestLimiter`, `bulkOperationLimiter` (`backend/src/middleware/rateLimiter.ts:17,37,53,76,92,108,133,157`). Env: `REDIS_URL` (`backend/.env.example:152`). See [`ENV_VARS.md`](./ENV_VARS.md).
- **Cloud Scheduler-driven audit retention cleanup** — PR #126 (`d0939f3`, #38). Retention cleanup is now triggerable via an internal endpoint guarded by `AUDIT_CLEANUP_TOKEN` (`backend/.env.example:164`), so the 7-year-retention purge runs on a Cloud Scheduler cadence rather than only an in-process timer. See [`RUNBOOK.md`](./RUNBOOK.md).

### Fixed
- **Insurance UI medium bugs** — PR #121 (`b6c7ad5`) + `a1c013e` (#25,#26,#27): repair SBC key-terms panel, duplicate-filename results, and stale knowledge-base search.
- **Plan-expiring emails sent ~24× per day** — `c5d79c1` (#20): now send plan-expiring emails **once per day**. PR #120 (`da38e93`) also de-dups plan-expiry scheduling.
- **Modal/dropdown accessibility** — PR #124 (`654be60`) + `b03f316` (#36): dialog semantics + focus trap on the shared `Modal`; ARIA state on Trends dropdowns.
- **`pdf-parse` typing + version pin** — PR #123 (`afc95d2`) + `2ca2695` (#32): type `pdf-parse` and pin its version; documents why **`pdf-parse` v2 is NOT adopted** (the v2 trap). Close Dependabot PR #24 if it proposes v2.

### Infrastructure
- **Infra provisioning runbook** — PR #127 (`ad536b2`, #37/#38): documents how to provision Redis (rate-limit store) and Cloud Scheduler (audit retention). See [`RUNBOOK.md`](./RUNBOOK.md).
- **Dependency bumps**: `zod` 3.25.76 → 4.4.3 in `/backend` (`555e0bc`).

---

## [deploy 2026-05-29]

Big security + feature day: P1–P8 hardening series, Quest FHIR lab connect, doctor data export, and CI secret scanning.

### Added
- **Quest FHIR / SMART-on-FHIR lab connections** — PR #115 (`1ecd13a`, branch `feat/fhir-lab-connect`); UI wired in `c39d799`. SMART-on-FHIR OAuth lab sync that pulls lab results from Quest. Code: `backend/src/routes/fhirRoutes.ts`, `backend/src/services/fhir/` (`smartAuth.ts`, `labSyncService.ts`, `fhirClient.ts`, `loincMapper.ts`, `urlSafety.ts`, `mockFhirServer.ts`). OAuth tokens stored as `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted` — treated as PHI (see [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md)). Schema: migration `20260418_add_lab_connections`. Env: `QUEST_FHIR_CLIENT_ID`, `QUEST_FHIR_CLIENT_SECRET`, `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`, `QUEST_FHIR_SUCCESS_REDIRECT` (`backend/.env.example:225-230`). The OAuth handshake + lab UI were originally scaffolded 2026-04-18 (PRs #68/#69/#71); the production lab-connect + UI shipped here.
- **Doctor PDF report + CSV export** — PR #114 (`ec50502`); wired into Trends in `c31acb7`.

### Security
- **FHIR SSRF + credential-exfiltration guard** — PR #110 (`5d76cd0`, `4ead894`, #26). Server-supplied FHIR URLs (pagination `link[rel=next]`, `.well-known/smart-configuration` endpoints) carry the patient Bearer token and the OAuth `client_secret`; without validation a malicious/compromised endpoint could redirect those credentials to an attacker host or the cloud metadata IP `169.254.169.254`. `urlSafety.ts` blocks private/loopback/link-local hosts and confines URLs to the configured trusted host(s) (`backend/src/services/fhir/urlSafety.ts:1-35`). Closes finding #26.

  ```ts
  // Source: backend/src/services/fhir/urlSafety.ts:25-33
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  ```

- **BAA gate for Google Document AI (image OCR)** — PR #111 (`57a4736`, `b0ac61c`, #9). Image OCR ships raw image bytes (PHI that text redaction can't scrub) to Document AI; the runtime now refuses unless `GOOGLE_BAA_ACTIVE=true`. Mirrors the Anthropic BAA gate. In production a missing flag with a configured processor is a fatal config error; dev/staging warn (`backend/src/config/index.ts:172-176,315-330`). See [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).
- **AI spend ceiling + plan gating (P6); complete HIPAA export (P8)** — PR #108 (`7aaea91`, `319b009`). AI spend guard caps Claude spend per day; defaults `AI_DAILY_BUDGET_USD=50`, `AI_USER_DAILY_BUDGET_USD=5` (`backend/src/config/index.ts:196-197`); enforced by `middleware/aiSpendGuard.ts`. HIPAA data-export completed (P8). See [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).
- **Provider PHI reads moved to provider RLS context (P7, app layer)** — PR #109 (`02b6a4d`, `a52946f`).
- **P1–P5 high-severity gaps closed + quick-win hardening** — PR #103 (`07788d6`, `d36f051`).
- **NOBYPASSRLS test harness + `has_provider_access` fix (P7 unblock)** — PR #105 (`93f836a`, `47a5463`). Underpins the production `assertNoBypassRLS()` hard-exit (`backend/src/services/database.ts:218-255`): in production a DB role with `BYPASSRLS` logs FATAL and `process.exit(1)`; dev/staging only warn.

  ```ts
  // Source: backend/src/services/database.ts:248-255
  if (config.isProduction) {
    logger.error(
      'FATAL: Production database role has BYPASSRLS. ' +
      'RLS policies are not enforcing. Refusing to start. ' +
      'See C8_PART3_RUNBOOK.md.'
    );
    process.exit(1);
  }
  ```

- **Account-enumeration on login** — PR #113 (`c9781bc`, `d5e5c47`, #17): stop leaking `remainingAttempts` on login.
- **CSV export hardening** — PR #118 (`ea5647c`, `cb809eb`): harden doctor CSV against formula injection + RFC-4180 corruption.
- **CI secret scanning** — PR #112 (`cd42dae`, `a98cf5b`, #76/#43): add gitleaks + scrub example creds; allowlist test-infra fixtures.

### Infrastructure
- **CI now actually runs the colocated backend unit suite** — PR #117 (`6816b6a`, `516fe14`).
- **Green CI** — PR #107 (`7e03222`, `5365eb9`): fix pre-existing test debt + clear dependency CVEs.

---

## [deploy 2026-04-25]

Frontend UX/a11y polish wave + dependency bumps + DNA/Genetics removal + C-8 RLS-cutover code prep.

### Removed
- **DNA / Genetics feature dropped** — PRs #74 (`eb45a57`), #75 (`d71269f`); migration `20260423_drop_dna_genetics`. The DNA upload + variant-browsing models (`dna_data`, `dna_variants`, `genetic_traits`), the `can_view_dna` provider-consent column, and the `ProcessingStatus`/`RiskLevel` enums are dropped with CASCADE. The feature was scaffolded in the initial schema but **never shipped** (no frontend, no upload endpoint, no extraction pipeline) and tables were empty in every environment (`backend/prisma/migrations/20260423_drop_dna_genetics/migration.sql:1-32`). Reconciles `CLAUDE.md` "Removed Features". No PHI loss — there was no DNA PHI in production. See [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) (DNA/Genetics no longer appear in `PHI_FIELDS`).

### Security
- **C-8 RLS role-cutover code prep** — PR #76 (`ca8b2c0`, `4290520`): move the audit salt to an env var (`AUDIT_LOG_SALT`), bare-`prisma` sweep, and a startup assertion — preparing for the `NOBYPASSRLS` DB-role cutover so RLS policies actually enforce at runtime. (The runtime `assertNoBypassRLS()` hard-exit landed 2026-05-29; see above.)

### Fixed (UX / a11y / frontend)
- **UX batch** — `dd95e99`, `f16e7c3`: over-quota messaging, email help text, name flash, KB theme, settings overflow, loading splash; sidebar settings, suggestions overflow, plan groups, empty states, deduped activity feed.
- **Accessibility** — `65902be`, `cc8d464`: skip link, `<h1>` dedupe, sidebar nav as real links, aria-labels, focus-visible rings, footer landmarks.
- **Real error surfacing + AI timeout taming** — `937da89`; stop fabricating health reassurance at zero data (`b7e78ac`).
- **Deep-link URL ↔ category sync** — `38aeca9` (back/forward navigation).
- **Stale-chunk recovery after deploys** — `3904c98`: recover gracefully when a client holds a stale JS chunk after a new deploy.
- **Login-page fetch storm + 429 backoff** — `862a300`.
- **Auth UX** — `0776482` (drop misleading OAuth divider, link Terms/Privacy), `bc63ed9` (preserve email on login failure + inline field errors).

### Infrastructure
- **SEO / favicon / social previews** — `c8234a2`.
- **Dependency bumps (Dependabot)** — PRs #77–#82 and others: `prisma` 7.7.0 → 7.8.0 (`bdff6c4`), `@anthropic-ai/sdk` 0.71.2 → 0.91.1 (`e36ef2f`), `@prisma/adapter-pg` 7.2.0 → 7.8.0 (`05861b9`), `vitest` 4.0.16 → 4.1.5 (`b80e3d6`), `vite` 7.3.2 → 8.0.10 (`7d62721`), `dotenv` 16.6.1 → 17.4.2 (`279bdea`), plus rollup/eslint/express-rate-limit/cors/bcryptjs/multer bumps.

---

## [deploy 2026-04-23]

### Added
- **Onboarding wizard** — migration `20260420_add_onboarding`; sync PR #73 (`dfdb111`, `61a6c67`). New-user onboarding flow. Code: `backend/src/routes/onboardingRoutes.ts`. User-visible schema effect: yes (onboarding state persisted).
- **Plan gating / billing tiers** — migration `20260420_add_user_plan`; same sync PR #73. `PlanType` user plan + `middleware/planGating.ts` gate feature access (e.g., `questFhirIntegration`) by tier. Code: `backend/src/routes/planRoutes.ts`, `backend/src/middleware/planGating.ts`. See [`DATA_MODEL.md`](./DATA_MODEL.md).
- **Staging environment** — `.github/workflows/deploy-staging.yml` + staging env wiring (PR #73).

### Removed
- **Dead code audit** — PRs #74 (`eb45a57`), `5303e30`: removed unused analytics components + stale DNA plumbing (precedes the schema drop above).

---

## [deploy 2026-04-18]

### Added
- **Quest FHIR integration (initial)** — PRs #68 (`799c61c`), #69 (`394cc3a`), #71 (`63dd1d8`): FHIR integration + backend refactor + test coverage. Migration `20260418_add_lab_connections` (the `LabConnection` model). This is the OAuth/handshake foundation; production lab-connect + UI shipped 2026-05-29 (see above).

### Fixed
- **`/ai/chat` CSRF exemption** — PR #72 (`5e4241e`), `2843339`: SSE streaming chat endpoint is exempt from CSRF double-submit validation (it's a GET-style stream); removed a duplicate route-level `csrfProtection`.
- **AI-chat decryption moved out of the RLS transaction** — `52507c3`: decryption no longer runs inside `withRLSContext`, avoiding holding a transaction open during CPU-bound crypto.
- **CORS robustness** — `64b7d14` (parse + union `CORS_ORIGIN` in every environment), `8deed18` (hardcode production frontend origins as always-allowed).

---

## [deploy 2026-04-17]

Large feature day: Health Guide AI chat, health profile, expenses actuals, dashboard/insurance refactors, plus a 5-finding security batch.

### Added
- **Health Guide — streaming conversational AI** — PRs #58 (`34b861f`), #59 (`334c247`), #60 (`3cd6c44`). SSE-streamed Claude chat over the user's own health data, with a knowledge layer and condition-aware context from a self-reported **health profile** (migration `20260418_add_health_profile`; `User.healthProfileEncrypted`). Code: `backend/src/routes/aiRoutes.ts` (`/ai/chat`). See [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md).
- **Expense actuals (recorded claims)** — PR #56 (`781b881`): actuals list, entry modal, and projection-vs-actual comparison + spending timeline chart and structured AI analysis output.
- **Goals / Needs wired to real APIs + sidebar nav** — PR #57 (`38ef578`).
- **Account settings, upload review step, dashboard overview** — PR #54 (`2c680d7`): inline biomarker sparklines, date grouping, range bars, opt-in AI guidance, extraction review step before import, persisted profile + notification preferences.
- **Insurance hub refactor + expense visualization** — PR #55 (`31f3c28`).
- **Notification preferences** — migration `20260417_add_notification_preferences`; persisted in `2c680d7`/`66bbe00`. See [`DATA_MODEL.md`](./DATA_MODEL.md).

### Security
- **Batch-close 5 High-severity audit findings** — PR #52 (`fb8a864`): assert JWT algorithm/issuer/audience on sign + verify (`9499308`); use `req.ip` for session IP instead of raw `X-Forwarded-For` (`8a0ea3f`); attach `blockDemoAdminAccess` to admin routes (`7baf2d2`); align Zod password policy with the service-level 12-char check (`ca74644`).
- **Admin/audit/users-by-email wrapped in RLS context (C-8 Part 2b-ii)** — PR #43 (`74af20e`).
- **Remaining C-7 gaps + F-3 IDOR** — `4fa53a6`.

### Fixed
- **401 retry loop on `/auth/refresh` and `/auth/logout`** — PR #44 (`50de4d2`): exempt these from the client's 401-retry interceptor.

### Infrastructure
- **Deploy safety: `--no-traffic` guard + smoke test + explicit promote** — PR #51 (`bf381e7`). New revisions deploy with 0% traffic, get smoke-tested, then are explicitly promoted. This is the procedure (and footgun) documented in [`RUNBOOK.md`](./RUNBOOK.md).
- **RLS transaction timeouts bumped** — `cacb750`: `withRLSContext` `maxWait` 5s→20s, `timeout` 15s→30s (Cloud SQL latency).

---

## [deploy 2026-04-16] — Security baseline (C-1 … C-8)

The critical-finding hardening series. **No user-visible UI changes**; this cycle hardened PHI isolation, secrets handling, and BAA posture. This is the baseline the documentation set treats as the prior changelog cutoff.

### Security
- **C-1 — Runtime RLS context hardened (`set_config` in-transaction)** — PR #30 (`9727492`). Fixes the core RLS bug: session variables are now set with PostgreSQL `set_config('app.current_user_id', …, true)` / `set_config('app.is_admin', …, true)` **inside the transaction** (`SET LOCAL` scope), so connection reuse in the pool can't leak one user's context into another's queries. Parameterized via `$executeRaw` — the userId can't alter SQL structure. **User-visible impact: none in the UI; PHI cross-user isolation hardened.** Breaking: no. See [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

  ```ts
  // Source: backend/src/services/database.ts:373-377
  const userIdValue = userId ?? '';
  const isAdminValue = isAdmin ? 'true' : 'false';
  await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userIdValue}, true)`;
  await tx.$executeRaw`SELECT set_config('app.is_admin', ${isAdminValue}, true)`;
  ```

- **C-2 — Audit-log system salt encrypted at rest** — PR #32 (`f6bdc9a`).
- **C-3 — JWT secret fallbacks removed** — PR #33 (`2808b97`): no hardcoded default JWT secrets; `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are required.
- **C-4 — Insecure PHI encryption key rejected in all environments** — PR #34 (`ea67ccb`): the app refuses to start with a weak/placeholder `PHI_ENCRYPTION_KEY`.
- **C-5 — `jspdf` bumped to 4.2.1+** — PR #36 (`4a08802`): closes CVE-2026-31938 and siblings.
- **C-6 — GCS objects deleted on account/data deletion** — PR #37 (`0f7970a`): lab reports / SBC files in Cloud Storage are removed when a user deletes their account or data (right-to-erasure). See [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).
- **C-7 — PHI minimization before Claude API calls** — PR #39 (`8c19438`, `c3fe7d7`, `d671887`, `d6fb811`): extract PDF text locally and redact PHI before any Claude call; expanded `phiRedaction` pattern set. **The C-7 runtime gate refuses to send anything to Claude unless `ANTHROPIC_BAA_ACTIVE=true`** (`backend/src/config/index.ts:295-310`, enforced at `backend/src/controllers/expenseController.ts:624-633`).

  ```ts
  // Source: backend/src/controllers/expenseController.ts:627-633
  if (!config.anthropic.baaActive) {
    // ... ANALYZE_BLOCKED_NO_BAA audit + 503
    'Cost analysis is disabled: ANTHROPIC_BAA_ACTIVE must be "true". See SECURITY_STATUS.md C-7.'
  ```

- **C-8 — RLS not enforced at runtime (BYPASSRLS) filed + Part 1/2a/2b started** — PRs #31 (`56bba28`, the finding), #40 (`65f9ffb`, wrap `auditService.initialize` in admin RLS context), #41 (`a648eb8`, wrap cross-user `ProviderPatient` writes), #42 (`4fa6460`, wrap pre-auth `authService`/`userEncryption` paths). The runtime hard-exit (`assertNoBypassRLS`) and DB-role cutover completed 2026-05-29.

### Compliance
- **Anthropic BAA activated — 2026-04-16** — PR #35 (`2bd7e36`): "Anthropic BAA signed 2026-04-16; C-7 now the production gate." The `ANTHROPIC_BAA_ACTIVE` env var is the runtime switch (defaults `false` in `backend/.env.example:215`); set to `true` in production once the BAA is confirmed. PHI-in-prompts flow is compliant only when this flag is on. See [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).

### Documentation / Infrastructure
- **Prompt library + project docs regenerated** — `ea9520a`, and follow-ups `987b4ae`, `c5eadf7` (8 administrative-safeguard HIPAA policy drafts), `3a55971`.

---

## Pre-baseline history (2026-01 … 2026-02)

Summarized — not enumerated per-PR (these predate the documentation cutoff and used direct-to-`master` commits, not numbered PRs). Source: `git log --all` 2026-01-08 … 2026-02-07.

| Date (ISO) | Theme | Key commits |
|---|---|---|
| 2026-02-06 | **Backend security batch 3** — RLS, IDOR fixes, query timeouts, validation, logging; PHI redaction; AI cost tracking; demo restrictions; prompt-injection prevention in Claude endpoints | `efaec73`, `6a5d56e`, `eecf14f`, `49878ea` |
| 2026-02-06 | **Expense encryption types fix** — monetary expense fields stored as `*Encrypted` String (AES-256-GCM), not Decimal | migration `20260206_fix_expense_encryption_types` |
| 2026-02-06 | First project documentation set (security audits, architecture, runbook) | `abe42fb` |
| 2026-01-10 | **Expense tracking + cost optimization** (backend + frontend) | `baa6425`, `6aba34a` |
| 2026-01-09/10 | **Insurance feature** — SBC upload + Claude Sonnet extraction, comprehensive coverage fields, plan detail view, delete, coinsurance support | `019eb46`, `4badc6e`, `9e2961e`, migrations `20260110_add_*_coverage_fields`, `20260110_add_coinsurance_columns`, `20260111_add_out_of_network_fields` |
| 2026-01-09 | **Dark-mode default + premium login redesign**; perf: 91% initial-bundle cut via code-splitting; Dashboard split 75% | `b949fa6`, `1fb87e2`, `dc65ca4` |
| 2026-01-08 | **AI educational guidance** (Trends + category pages), **Trends page**, **lab-report file repository**, **PDF→Claude biomarker extraction** (OCR fallback) | `25536da`, `c77a968`, `3c5b852`, `7563bc8`, `1312413` |
| 2026-01-07 | **Row-Level Security policies introduced** | migration `20260107_add_rls_policies` |
| 2025-12-09 | First deployment docs PR (#1) | merge `1785066` |

---

## PR table (since the 2026-04-16 baseline)

Every merged PR from the 2026-04-16 baseline to HEAD, descending. Union of classic merge commits (`Merge pull request #N`) and squash merges with a trailing `(#N)`. Dependabot PRs (#29, #67, #77–#82, etc.) are rolled up under "Dependency bumps" in the dated entries above and not all re-listed here.

| PR # | Date (ISO) | Title (commit subject) | Category | User-visible impact | Breaking? |
|---|---|---|---|---|---|
| #134 | 2026-06-01 | fix(auth): fire one-time-token confirmation exactly once | Fixed | Email change/verify no longer shows false "failed" screen on success | no |
| #133 | 2026-06-01 | feat: verified email-change flow (request → confirm) | Added | Users can change their account email via confirm link; all sessions revoked on change | no |
| #132 | 2026-06-01 | test(export): cover pdfReportGenerator | Tests | None | no |
| #131 | 2026-06-01 | fix: role-guard restricted pages; drop dead key-rotation footgun | Fixed/Removed | Restricted pages now correctly role-guarded | no |
| #130 | 2026-06-01 | test(rls): full provider-consent matrix | Tests | None | no |
| #129 | 2026-06-01 | test(ui): cover provider + admin screens | Tests | None | no |
| #128 | 2026-05-31 | feat: complete wiring and UI (provider + admin UI, benefit search, logout-all, deductible sync) | Added/Fixed | Provider & Admin consoles now have real UI; multiple fixes | no |
| #127 | 2026-05-30 | docs: provisioning runbook for Redis + Cloud Scheduler retention | Infrastructure | None (ops doc) | no |
| #126 | 2026-05-30 | feat(audit): Cloud Scheduler-driven retention cleanup behind AUDIT_CLEANUP_TOKEN | Added/Infra | None (background retention) | no |
| #125 | 2026-05-30 | feat(ratelimit): optional shared Redis store behind REDIS_URL | Added/Infra | Consistent rate limits across instances | no |
| #124 | 2026-05-30 | fix(a11y): dialog semantics + focus trap on Modal; ARIA on Trends dropdowns | Fixed | Better screen-reader/keyboard support | no |
| #123 | 2026-05-30 | fix(pdf): type pdf-parse + pin version | Fixed/Infra | None | no |
| #122 | 2026-05-30 | fix(audit): consent-mutation audit rows on caller's tx | Security | None (atomic audit) | no |
| #121 | 2026-05-30 | fix(insurance): SBC key-terms panel, dup-filename, stale KB search | Fixed | Insurance UI bugs resolved | no |
| #120 | 2026-05-30 | fix(scheduler): plan-expiry dedup + once-per-day emails | Fixed | No more ~24× duplicate plan-expiry emails | no |
| #119 | 2026-05-30 | fix(fhir-ui): surface real server errors + de-clobber toasts | Fixed | Clearer FHIR connection errors | no |
| #118 | 2026-05-30 | fix(export): harden doctor CSV vs formula injection + RFC-4180 | Security | Safer CSV exports | no |
| #117 | 2026-05-30 | ci(backend): run colocated unit suite in CI | Infrastructure | None | no |
| #116 | 2026-05-30 | fix(register): equalize timing / stop account enumeration | Security | None (anti-enumeration) | no |
| #115 | 2026-05-29 | feat/fhir-lab-connect (Quest SMART-on-FHIR lab connections) | Added | Connect a Quest lab account to sync results | no |
| #114 | 2026-05-29 | feat/doctor-export (PDF report + CSV) | Added | Export a doctor-ready report/CSV | no |
| #113 | 2026-05-29 | fix/auth-enumeration (stop leaking remainingAttempts on login) | Security | None (anti-enumeration) | no |
| #112 | 2026-05-29 | chore/ci-secret-scanning (gitleaks) | Infrastructure | None | no |
| #111 | 2026-05-29 | fix(ocr): BAA gate for Google Document AI image OCR | Security | Image OCR disabled unless GOOGLE_BAA_ACTIVE=true | no* |
| #110 | 2026-05-29 | fix(fhir): block SSRF + credential exfiltration | Security | None (hardening) | no |
| #109 | 2026-05-29 | fix(rls): provider PHI reads in provider RLS context (P7) | Security | None | no |
| #108 | 2026-05-29 | fix(security): AI spend ceiling + plan gating (P6); HIPAA export (P8) | Security/Added | AI usage capped per day; full data export | no |
| #107 | 2026-05-29 | chore(ci): green CI | Infrastructure | None | no |
| #105 | 2026-05-29 | chore(rls): NOBYPASSRLS test harness + has_provider_access fix | Security | None | no |
| #103 | 2026-05-29 | fix(security): close P1–P5 high-severity gaps | Security | None | no |
| #76 | 2026-04-25 | feat(c-8): prepare code for RLS role cutover (audit salt in env) | Security | None | no |
| #75 | 2026-04-25 | Cleanup/remove dna genetics | Removed | DNA/Genetics feature gone (was never shipped) | no |
| #74 | 2026-04-23 | Cleanup/dead code audit | Removed | None | no |
| #73 | 2026-04-23 | chore: sync working tree (staging env, onboarding, plan gating, e2e) | Added/Infra | Onboarding wizard + plan tiers introduced | no |
| #72 | 2026-04-18 | fix(csrf): exempt /ai/chat from validation | Fixed | AI chat stream works | no |
| #71 | 2026-04-18 | feat(quest-fhir): FHIR integration + backend refactor | Added | FHIR foundation | no |
| #69 | 2026-04-18 | Feat/quest fhir integration | Added | FHIR foundation | no |
| #68 | 2026-04-18 | Feat/quest fhir integration | Added | FHIR foundation | no |
| #60 | 2026-04-17 | feat(health-profile): self-reported profile + condition-aware AI | Added | Health profile drives AI context | no |
| #59 | 2026-04-17 | feat(ai): knowledge layer for Health Guide chat | Added | Better AI answers | no |
| #58 | 2026-04-17 | feat(ai): Health Guide streaming chat | Added | Conversational AI over your health data | no |
| #57 | 2026-04-17 | feat(health): wire goals/needs UI to real APIs | Added | Goals/Needs are live | no |
| #56 | 2026-04-17 | feat(expenses): actuals endpoints + UI | Added | Record claims; projection-vs-actual | no |
| #55 | 2026-04-17 | feat: insurance hub refactor + expense visualization | Added/Changed | Reworked insurance hub + charts | no |
| #54 | 2026-04-17 | feat: account settings, upload review step, dashboard overview | Added | Settings, upload review, richer dashboard | no |
| #53 | 2026-04-17 | docs: C-8 Part C DB role cutover runbook | Infrastructure | None | no |
| #52 | 2026-04-17 | fix(security): batch-close 5 High-severity audit findings | Security | None | no |
| #51 | 2026-04-17 | fix(ci): --no-traffic guard + smoke test + promote | Infrastructure | None | no |
| #44 | 2026-04-17 | fix(auth): exempt /auth/refresh + /auth/logout from 401 retry loop | Fixed | No more refresh/logout retry loops | no |
| #43 | 2026-04-17 | fix(security): wrap adminRoutes + auditLog + users-by-email in RLS (C-8 2b-ii) | Security | None | no |
| #42 | 2026-04-16 | fix(security): wrap authService + userEncryption pre-auth in RLS (C-8 2b-i) | Security | None | no |
| #41 | 2026-04-16 | fix(security): wrap cross-user ProviderPatient writes in RLS (C-8 2a) | Security | None | no |
| #40 | 2026-04-16 | fix(security): wrap auditService.initialize in admin RLS (C-8 Part 1) | Security | None | no |
| #39 | 2026-04-16 | fix(security): close C-7 — PHI minimization before Claude | Security | AI cost-analysis blocked unless BAA active | no* |
| #38 | 2026-04-16 | docs(security): sweep stale status references | Documentation | None | no |
| #37 | 2026-04-16 | fix(security): close C-6 — delete GCS objects on deletion | Security | Files purged on account/data delete | no |
| #36 | 2026-04-16 | fix(deps): bump jspdf (C-5, CVE-2026-31938) | Security | None | no |
| #35 | 2026-04-16 | docs: Anthropic BAA signed 2026-04-16 | Compliance | AI features compliant when flag on | no |
| #34 | 2026-04-16 | fix(security): close C-4 — reject insecure PHI key | Security | None (startup guard) | no |
| #33 | 2026-04-16 | fix(security): close C-3 — JWT secret fallbacks removed | Security | None (startup guard) | no |
| #32 | 2026-04-16 | fix(security): encrypt audit-log system salt (C-2) | Security | None | no |
| #31 | 2026-04-16 | docs(security): file C-8 — RLS not enforced at runtime | Documentation | None | no |
| #30 | 2026-04-16 | fix(security): close C-1 — RLS via transaction-scoped SET LOCAL | Security | None in UI; PHI isolation hardened | no |

`*` = behaviorally gating, not API-breaking: AI/OCR features fail closed with a clear 503 unless the relevant BAA flag is set. No request/response **contract** changed.

---

## Breaking changes

**None.** Across the full range (#30 → #134) no PR is marked breaking. The closest are the two BAA gates (#39 C-7 Anthropic, #111 Google Document AI) which make AI cost-analysis / image-OCR **fail closed** with a 503 unless `ANTHROPIC_BAA_ACTIVE` / `GOOGLE_BAA_ACTIVE` are `true` — a deployment-config change, not an API-contract change. The `CostAnalysis.claude_response` → `claude_response_encrypted` column rename (migration `20260424_align_uuid_defaults_and_rename_claude_response`) is column-only/metadata, no data rewrite, and no API field name changed (`backend/prisma/migrations/20260424_align_uuid_defaults_and_rename_claude_response/migration.sql:24-30,52-53`).

---

## Migrations since the baseline (schema effects)

| Migration directory | Date (from name) | What it does | User-visible schema effect? |
|---|---|---|---|
| `20260417_add_notification_preferences` | 2026-04-17 | Adds notification-preference columns | Yes — notification settings persist |
| `20260418_add_health_profile` | 2026-04-18 | Adds `User.healthProfileEncrypted` self-reported profile | Yes — health profile drives AI |
| `20260418_add_lab_connections` | 2026-04-18 | Adds `LabConnection` (FHIR OAuth tokens, encrypted) | Yes — connect a lab |
| `20260420_add_onboarding` | 2026-04-20 | Onboarding state | Yes — onboarding wizard |
| `20260420_add_user_plan` | 2026-04-20 | `PlanType` user plan / billing tier | Yes — plan gating |
| `20260420_encrypt_health_goal_target` | 2026-04-20 | `HealthGoal.targetValueEncrypted` (numeric target now encrypted) | No (transparent) |
| `20260423_drop_dna_genetics` | 2026-04-23 | Drops DNA/Genetics tables, `can_view_dna`, 2 enums | No (feature never shipped) |
| `20260424_align_uuid_defaults_and_rename_claude_response` | 2026-04-24 | UUID defaults → `gen_random_uuid()`; rename `claude_response` → `claude_response_encrypted` | No (metadata only) |
| `20260424_prevent_self_role_elevation` | 2026-04-24 | BEFORE UPDATE trigger blocking non-admin role/`is_active` changes (F-6) | No (security hardening) |
| `20260529_fix_has_provider_access` | 2026-05-29 | Fixes the `has_provider_access` RLS helper for NOBYPASSRLS role | No |
| `20260530_add_users_select_provider` | 2026-05-30 | Adds a `users` SELECT policy for the provider role | No |
| `20260601_add_email_change` | 2026-06-01 | `pending_email`, `email_change_token` (unique), `email_change_expires` | Yes — email-change flow |

Full schema and per-model details live in [`DATA_MODEL.md`](./DATA_MODEL.md); PHI-field encryption mapping in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md).

---

## Statistics

| Metric | Value | Source |
|---|---|---|
| Deploys recorded (dated entries since baseline) | 8 (2026-04-16, -17, -18, -23, -25, -05-29, -05-30, -05-31/06-01) | this doc |
| PRs merged since 2026-04-16 baseline (excl. pure Dependabot) | ~60 in [PR table](#pr-table-since-the-2026-04-16-baseline); 64 rows incl. select dep PRs | `git log` union of merge + `(#N)` styles |
| Highest PR number (HEAD) | #134 | `13db267` |
| Backend test files | 34 | `find backend/src -name "*.test.ts"` |
| Frontend test files | 14 | `find src -name "*.test.ts*"` |
| E2E spec files (Playwright) | `auth.spec.ts`, `biomarker-entry.spec.ts`, `data-export.spec.ts`, `health-guide.spec.ts`, `settings.spec.ts` (+ helpers) | `e2e/` |
| Frontend tests passing (per #134 commit body) | 163 | `13db267` commit message |
| Named rate limiters | 8 | `backend/src/middleware/rateLimiter.ts:17,37,53,76,92,108,133,157` |
| Prisma migrations total | 22 (excl. lock file) | `ls backend/prisma/migrations/` |
| Critical security findings (C-1…C-8) closed/advanced | C-1..C-7 closed by 2026-04-16; C-8 finished 2026-05-29 | [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) |

Security finding status changes are tracked in [`SECURITY_STATUS.md`](./SECURITY_STATUS.md); open issues in [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

### Reproduce the full commit range

```bash
# Every commit since the 2026-04-16 baseline (all in scope):
git log --all --since=2026-04-16 --pretty=format:'%h %ad %s' --date=short

# PR titles — classic merge commits:
git log --all --grep='Merge pull request' --pretty=format:'%h %ad %s' --date=short

# PR titles — squash merges with a trailing (#N) and NO merge line:
git log --all --oneline | grep -E '\(#[0-9]+\)'

# New migration directories since the baseline:
ls -1 backend/prisma/migrations/

# Confirm there are no git tags and versions are 1.0.0:
git tag                              # (empty)
grep '"version"' package.json backend/package.json
```

---

## Acceptance questions (self-answered from this doc)

1. **Cutoff date of the previous changelog entry?** There was no prior `CHANGELOG.md`; the detailed history is anchored at the **2026-04-16** security baseline (header + [deploy 2026-04-16] section).
2. **What shipped in PR #30, and its user-visible impact?** C-1: runtime RLS context hardened via transaction-scoped `set_config`/`SET LOCAL` (`9727492`); **no user-visible UI change**, PHI cross-user isolation hardened ([deploy 2026-04-16] → C-1; snippet `database.ts:373-377`).
3. **When was the Anthropic BAA activated?** **2026-04-16** (PR #35, `2bd7e36`); runtime switch is `ANTHROPIC_BAA_ACTIVE` ([deploy 2026-04-16] → Compliance).
4. **Which changes are breaking?** **None** — see [Breaking changes](#breaking-changes); BAA gates fail-closed but don't change API contracts.
5. **How many PRs merged since the cutoff?** ~60 non-Dependabot, listed in the [PR table](#pr-table-since-the-2026-04-16-baseline) (64 rows incl. select dep bumps), HEAD = #134.
6. **Which migrations added/removed fields, and do users see a schema effect?** See [Migrations since the baseline](#migrations-since-the-baseline-schema-effects); user-visible ones: notification prefs, health profile, lab connections, onboarding, user plan, email change.
7. **Most recent infrastructure change?** CI now runs the colocated backend unit suite (PR #117, 2026-05-30) is the latest infra PR; the latest infra **feature** is Redis rate-limit store + Cloud Scheduler retention (PRs #125/#126, 2026-05-30).
8. **Which security findings closed in this release cycle?** P1–P8 + #9/#17/#18/#26/#28 across 2026-05-29/05-30; C-1…C-8 across 2026-04-16; see [Statistics](#statistics) and [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).
9. **What's in `[Unreleased]`?** Nothing staged; only an external TBD to confirm the live Cloud Run revision/traffic split for HEAD ([\[Unreleased\]](#unreleased)).

---

## Related Documents

- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — current status of each security finding (C-1…C-8, P1–P8) referenced in these entries.
- [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) — BAA activation (Anthropic 2026-04-16, Google Document AI gate) and compliance posture.
- [RUNBOOK.md](./RUNBOOK.md) — deploy/promote procedure, Redis + Cloud Scheduler provisioning, env-var/traffic-pinning postmortem.
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — issues introduced or still open after these changes.
- [DATA_MODEL.md](./DATA_MODEL.md) — full schema for every migration listed here.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — encryption mapping for fields added/renamed (e.g., `claudeResponseEncrypted`, `LabConnection` tokens, DNA removal).
- [ENV_VARS.md](./ENV_VARS.md) — `ANTHROPIC_BAA_ACTIVE`, `GOOGLE_BAA_ACTIVE`, `REDIS_URL`, `AUDIT_CLEANUP_TOKEN`, `AI_DAILY_BUDGET_USD`, `QUEST_FHIR_*`.
- [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) — the RLS/provider-matrix and UI test suites referenced in 2026-06-01.

---

## Prompt drift log

- **No prior CHANGELOG existed.** `./19-changelog-doc.md` ("Prior `New Project Documents/CHANGELOG.md` — Cutoff date") presumes an existing file; `Glob CHANGELOG*.md` finds only `node_modules/**` copies. This is the first generation, so the cutoff is set to the spec's stated 2026-04-16 baseline.
- **Migration name `20260417_add_notification_preferences`** — the spec (`./19-changelog-doc.md` "Major feature lines") lists `20260417_add_notification_preferences`; on disk the directory is exactly that name ✓ (no drift). Likewise `20260418_add_lab_connections`, `20260420_add_onboarding`, `20260420_add_user_plan`, `20260423_drop_dna_genetics`, `20260424_align_uuid_defaults_and_rename_claude_response`, `20260601_add_email_change` all match disk.
- **Health-profile migration date** — the spec groups health profile loosely; on disk it is `20260418_add_health_profile` (2026-04-18) while the *UI/feature* PRs (#58–#60) landed 2026-04-17. The migration directory name, not the feature PR date, is authoritative for the [Migrations](#migrations-since-the-baseline-schema-effects) table.
- **Three migrations the spec did not enumerate** are present and recorded here: `20260424_prevent_self_role_elevation` (F-6 trigger), `20260529_fix_has_provider_access`, `20260530_add_users_select_provider`. The prompt author should add these to `./19-changelog-doc.md` "Major feature lines" / `00-index.md` migration counts (total = 22 incl. initial schema and lock file excluded).
- **PR count** — the spec example PR table starts at #30/#32; actual range is #30 → #134 with two merge styles. Confirmed both styles are required; documented in the header note.
- **Two extra Document AI / Google BAA env var** — spec lists `ANTHROPIC_BAA_ACTIVE` but the code also gates Google Document AI behind `GOOGLE_BAA_ACTIVE` (`backend/src/config/index.ts:176,315-330`). Added to this doc; prompt author may want to add it to the BAA-related feature lines.
