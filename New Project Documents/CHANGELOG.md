# CHANGELOG

> **Last updated:** 2026-08-01 · **HEAD:** `12b45ae` (previously `fb2cd32`) · **Format:** [Keep a Changelog](https://keepachangelog.com)
>
> **Prior-entry cutoff:** None. This is the **first** generated `CHANGELOG.md` for OwnMyHealth (`New Project Documents/` previously held only `security-reviews/`; verified via `Glob "New Project Documents/*"`). The cutoff is therefore the **start of git history** — `1e4a167 "backup before cleanup"` (2025-11-26) and `0c6c022 "Initial production-ready release"` (2025-12-03), confirmed by `git log --reverse --date=short`. Every merged PR from #1 through the 2026-06-15 security/UX wave is in scope; entries below are grouped by deploy date, most-recent first.
>
> **Versioning:** There are **no git tags** (`git tag -l` is empty) and both `package.json` files pin `"version": "1.0.0"` (root + `backend/package.json`, verified `git show HEAD:package.json`). Per the prompt, every entry uses the `deploy YYYY-MM-DD` form — no semver is invented.

This document is a reference. Every non-trivial claim cites `file:line` or a PR. It is self-contained for a reader who has only the docs in `New Project Documents/` (the GitHub repo has outgrown the Claude Project attachment limit). It satisfies the five [`_doc-quality.md`](../prompts/_doc-quality.md) tests.

---

---

## deploy 2026-07-14 — sandbox posture, local storage backend, doc reorg

> **PRs:** #228, #229, #230 · **Not deployed** — this is the release where the project stopped deploying.

### Changed
- **Project posture: sandbox, no GCP.** GCP billing on project `#1046989989964` was disabled ~2026-07-12 (verified: deploys fail at image push), suspending the Cloud Run backend, Cloud SQL prod DB, and GCS buckets. No deployment target, no real users; the declared assumption is founder/test data only. Recorded with hard reactivation triggers in [`OPEN_FINDINGS.md` §Posture](./OPEN_FINDINGS.md). Findings that only exist when deployed moved to **Dormant (launch checklist)**, each carrying the severity it re-acquires at launch (#228, `86d2b03`).

### Added
- **Pluggable file-storage backend (OF-23)** — `storageService.ts` became a facade selecting `storage/gcsBackend.ts` or `storage/localBackend.ts` from `config.storage.backend` (`storageService.ts:33-44`). The new local backend seals every blob AES-256-GCM with the **master** `PHI_ENCRYPTION_KEY` in an `OMHL`-magic envelope, writes tmp-then-rename at mode `0600`, and validates key shape plus `path.resolve` containment so a corrupted DB key cannot escape the root (`localBackend.ts:38-42,65-74,97-103`). New env: `STORAGE_BACKEND` (`gcs`/`local`, default `local` in development) and `LOCAL_STORAGE_DIR`. `config/index.ts:349` refuses `local` in production/staging — Cloud Run disks are ephemeral and must not hold PHI files. **Effect: upload/download/delete now work with zero GCP credentials** (#229, `5e067db`).
- `New Project Documents/OPEN_FINDINGS.md` reorganized as the single authoritative ledger; `Go-To-Market/` pack and `analysis/codebase-scrutiny-2026-07/` added (#230, `81a67d7`).

### Fixed
- Refreshed the stale committed Prisma client, which was missing the June consent fields (`3fdf3a0`).

---

## deploy 2026-07-11/12 — e2e in CI, and the bug it immediately found

> **PRs:** #210, #223, #224, #225, #226

### Fixed
- **OF-22 — refresh-token rotation broken under enforced RLS** (`3159731`). `sessions` had SELECT/INSERT/DELETE policies but **no UPDATE policy**; PostgreSQL applies UPDATE-policy checks to `SELECT ... FOR UPDATE` row locks, so the rotation lock in `authService.refreshTokens()` matched zero rows under FORCE RLS with the NOBYPASSRLS role. Every token refresh returned 401, and the not-found row was misclassified as token **reuse**, firing `revokeAllUserTokens()` — wiping all sessions and stamping `tokens_valid_after` across devices. Invisible in dev/staging, which connect as BYPASSRLS. Fixed by migration `20260712_add_sessions_update_policy`; pinned by `rls.test.ts:541`.
- e2e-db commands now run in an admin RLS transaction (`d6a21e7`); `VITE_API_URL` supplied so the meta CSP admits the e2e backend origin (`94b9ccd`).

### Added
- **`e2e` job in `ci.yml`** (`919398a`, #226) — the full Playwright suite against real Postgres with a seeded standing user, closing the long-standing `ci.yml` TODO. **Its first real run surfaced OF-22.**
- **`secret-history-scan.yml`** (`8ec3989`, OMH-M01) — nightly plus on-demand **full-history** gitleaks scan. The `ci.yml` scan is working-tree-only and cannot see removed commits. Deliberately not on push so it never blocks a merge; red by design until OF-01's committed key is purged. Closed **OF-11**.
- `export-delete-journey.spec.ts` — export plus account-deletion journey with DB forensics, completing scrutiny **P0-3** (`5c1787e`, #225).
- Live-PG evidence that account deletion destroys the per-user salt (`8c9c3d6`, #224).
- Test coverage for the three remaining untested PHI controllers, closing scrutiny **P1-6** (`440762d`, #223).

### Security
- **OF-02 closed** — Document AI OCR dollars now accrue into the fail-closed AI budget (`1047506`, #210).
- Registration now requires a validated `acceptedTerms` at the API boundary (OMH-L03, `0456c50`).
- `OPEN_FINDINGS.md` created as the single authoritative ledger, closing scrutiny **P0-6** — `SECURITY_STATUS.md` had claimed 0 open High while `KNOWN_ISSUES.md` listed H-1/H-2/H-3 (`d9616cb`).

---

## deploy 2026-06-20/21 — readiness fixes, accessibility, correctness waves

> **PRs:** #183–#209

### Added
- **Registration consent (OMH-L04)** — migration `20260620_add_registration_consent` adds `users.terms_accepted_at` plus `users.terms_version`, stamped on successful registration. Deliberately **not PHI**: a timestamp and a version string, not encrypted, not in `PHI_FIELDS`. New `src/components/legal/` surface (`LegalPageShell`, `PrivacyPolicy`, `TermsOfService`).
- **Accessibility subsystem** — shared `useFocusTrap` hook (`dc78c5b`, #185) migrated into 14 bespoke dialogs/overlays/cards plus `common/Modal` (`f41ed1f`, #198); ARIA tab semantics and `GoalTrackerPanel`/`AddInsurancePlan` dialogs (`c66ce43`, #186); keyboard-operable cards, header-menu ARIA, compare-form labels (`ff2a3c8`, #199); AI-chat screen-reader status and goal terminal-status confirm (`c2356cc`). Regression suite: `src/__tests__/components/dialogA11y.test.tsx`.
- `src/services/api/pagination.ts` — deduped client pager, added when provider patient-PHI list endpoints were paginated (`4a9c67f`, #190).

### Fixed
- **Date-only UTC off-by-ones.** `new Date('2026-01-01')` parses as UTC midnight, so a plain `toLocaleDateString()` renders the *previous* day in any negative-UTC locale. Fixed for insurance `effectiveDate` (`b376949`, #192), then swept across all date-only display (`ea57001`, #194) and date arithmetic (`45a0cbc`, #195). The canonical helper is `formatDateOnly` (`src/utils/format.ts:47`), which pins `timeZone: 'UTC'` — use it for `@db.Date` values only, never for timestamps.
- Trend statistics, goal-progress ordering, and history windowing corrected (`4795e1d`, #197).
- SBC import now adopts the saved plan instead of re-creating it (`6faea4b`, #196).
- Expense decrypt paths made robust to a corrupt row (`eaf8efe`, #202); `deleteAllData` success audit moved inside the deletion transaction (`f5b4b83`, #201); `PATCH /providers/:id` returns the documented shape and no longer leaks `notesEncrypted` (`485328a`, #204).
- Four dead or broken interactions repaired — preview, double-submit, back, view-biomarker (`2fca770`, #205); `ExpenseActualsList` edit affordance wired (`7f30648`, #207).

### Security
- 2026-06-20 readiness-assessment fixes applied (`0dadd8d`); salt-create race hardened, internal-token compare made constant-time, RLS CI guard tightened (`1e4c9c2`, #203); admin consent reactivation locked down and the `canEditData` no-op dropped (`e805431`, #200).

### Changed
- FHIR lab-sync writes chunked into batched transactions with per-row fallback (`c7c28e6`, #191).
- `InsurancePlan` types consolidated; all `as unknown as` casts removed (`98ee502`, #189); dead client contract surface pruned (`6e08748`, #187).
- SHA-pinned GitHub Actions bumped to latest stable including majors (`a5b38a5`, #209); safe in-range backend dependency updates applied with majors held (`2a8dafe`, #208).

---

## How to read this file

- **Per-deploy entries** (descending) carry `Added / Changed / Fixed / Security / Deprecated / Removed / Infrastructure` subsections.
- The **[PR Table](#pr-table)** is the authoritative anti-omission artifact — one row per merged PR since the cutoff.
- PR numbers run **#1 → #182**. The repo uses **two merge styles**, so both were unioned:
  - Squash merges with a trailing `(#N)` subject (`git log --oneline | grep -E "\(#[0-9]+\)"`) — e.g. #103–#141.
  - Classic `Merge pull request #N` commits (`git log --grep="Merge pull request"`) — e.g. #1, #109–#173.
  - The final wave #174–#182 was integrated through `release/security-ux-2026-06-15` (each a `Merge remote-tracking branch 'origin/<branch>'` commit, e.g. `7484a32`, `3933ee7`), then fast-forwarded to `master` as `ee76212`/`fb2cd32`.

---

## [Unreleased] — staged, not yet executed against prod

These are **operational follow-ups** that exist in code/runbook but have **not** been run in production as of 2026-06-16. Source: project memory `ownmyhealth-2026-06-15-security-longtail.md` + the L24 migration design.

| Item | What is staged | Why not done | Where |
|---|---|---|---|
| L24 filename re-encrypt backfill | `backfill-userfile-filenames` maintenance job re-encrypts legacy plaintext `user_files.original_filename`, then a follow-up migration drops the plaintext column | New uploads already encrypt (`UserFile.originalFilenameEncrypted`); reads fall back to plaintext for legacy rows, so it is correctness-safe to defer. The drop migration is not yet authored. | Maintenance job (Cloud Run `ownmyhealth-maintenance`, `.github/workflows/maintenance.yml`); see [`RUNBOOK.md`](./RUNBOOK.md) |

There is **no code change** sitting un-deployed: HEAD `fb2cd32` was deployed to prod on 2026-06-15 (deploy run `27587954630`, all stages green incl. the migrate job `ownmyhealth-migrate-xspd8`).

---

## [deploy 2026-06-15] — Security long-tail + UX accessibility/interaction wave (PRs #174–#182)

Nine PRs integrated via `release/security-ux-2026-06-15`, fast-forwarded to `master` (`ee76212` → `fb2cd32`). Deploy run `27587954630` ran the three pending migrations (incl. the **irreversible** M6 column drop), smoke-tested, promoted, and pushed the frontend to GCS. Tests at this deploy: **643 backend + 269 frontend + 26 live-PG RLS** (per project memory; the live-PG RLS suite runs in CI against a throwaway Postgres).

### Security

- **Cross-instance & session-cookie hardening (#174, `b06756d`)** — `SameSite=None` now forces `Secure`; the `csrf_token` cookie is cleared on logout (previously survived) and its lifetime is tied to the refresh-token lifetime; dead `generateToken`/`verifyToken` helpers removed (M7/L26/L22). `secure`/`sameSite` are resolved together at `backend/src/config/index.ts:88-95,138-147`; `clearAuthCookies` clears `csrf_token` at `backend/src/controllers/authController.ts:143-153`.
- **RLS provider-consent immutability + audit-insert tightening (#175, `3880ee4`; migration `20260615_provider_consent_immutable_audit_insert_check`)** — a `BEFORE UPDATE` trigger `provider_patients_guard_consent()` restores the four consent columns (`can_view_biomarkers/insurance/health_needs`, `can_edit_data`) unless the writer is the patient or admin (L23); `audit_logs_insert` `WITH CHECK` changed from `(true)` to `(user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL)` so audit rows cannot be forged to an arbitrary user (L40). Live-PG validated.

  ```sql
  -- Source: backend/prisma/migrations/20260615_provider_consent_immutable_audit_insert_check/migration.sql:70-76
  CREATE POLICY audit_logs_insert ON audit_logs
    FOR INSERT
    WITH CHECK (
      user_id = current_user_id()
      OR is_admin_session()
      OR current_user_id() IS NULL
    );
  ```

- **Upload / extraction guards (#176, `8062a9f`)** — page cap, AI-text cap, strict WebP validation, biomarker numeric sanity bounds, and safe date parsing on the upload/extraction paths (L28–L32). OCR lab path also hard-rejects over-cap PDFs (L28 completeness, `c6d5993`).
- **AI-path consent hardening (#177, `52efc7d`)** — server-side AI disclaimer enforcement, fail-closed pre-flight chat audit, corrected budget env docs (L33/L42/L39). The L33 disclaimer is appended server-side, which required updating the biomarker guidance happy-path assertion (`2a1206f`, and integration twin `ee76212` in `biomarkerController.test.ts`).
- **Login-oracle / atomic audit / `canEditData` neutralization (#178, `f0563f0`)** — closes the login-lockout enumeration oracle (L21), makes bulk audit writes atomic (L41), and neutralizes the unconsumed `canEditData` provider permission (L37).
- **IRREVERSIBLE drop of plaintext audit metadata (#179, `38e84e6`; migration `20260615_drop_legacy_audit_metadata`)** — see [Removed](#removed-2026-06-15). The encrypted twin `AuditLog.metadataEncrypted` (added 2026-06-06) is now the sole metadata store.
- **Encrypt raw lab filenames at rest (#180, `ae91986`; migration `20260615_encrypt_userfile_original_filename`, L24)** — adds `user_files.original_filename_encrypted` (per-user AES-256-GCM via `decryptOriginalFilename` helper) and drops `NOT NULL` on the plaintext twin; `Biomarker.sourceFile` is deliberately **left plaintext** (it is a FHIR idempotency/dedupe key — encrypting it breaks de-dup). `PHI_FIELDS` now lists `UserFile.originalFilenameEncrypted` at `backend/src/services/encryption.ts:499`. Live-PG validated. See [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md).

### Added

- **Screen-reader accessibility wave 1 (#181, `53ffa7f`)** — biomarker range-bar in/out-of-range announcement (A11Y-5), toast live regions (`alert`/`status`, A11Y-3), keyboard-operable biomarker cards (A11Y-4). A keyboard regression introduced by the keyboard-card work (nested-button keydown bubbling → double toggle) was fixed in `bd0159e` with an `e.target !== e.currentTarget` guard plus a value-announcing `aria-label` and two regression tests.
- **AI-chat Stop button (#182, `16c9cc8`, FB-7)** — lets the user abort an in-flight streaming Health Guide response.

### Fixed

- **Enhanced-parser insurance plans now persist (#182, `16c9cc8`, FB-8)** — the client previously generated a `crypto.randomUUID()` id, which made `handleInsurancePlanExtracted` skip `createPlan`, so parsed plans were silently dropped. Fix routes an empty id through `createPlan` so the server assigns the id and the plan is saved.

### Removed (2026-06-15)

- **`audit_logs.metadata` plaintext column DROPPED (#179, migration `20260615_drop_legacy_audit_metadata/migration.sql:18`)** — `DROP COLUMN IF EXISTS "metadata"`. **Breaking / irreversible:** any legacy plaintext metadata content is permanently lost (the encrypted twin `metadataEncrypted` has carried new writes since 2026-06-06). Done via DDL because `audit_logs` is immutable-by-RLS. See [`DATA_MODEL.md`](./DATA_MODEL.md), [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

### Infrastructure

- **CI Security Audit gate unblocked (`fb2cd32`)** — non-breaking `npm audit fix` in `backend/` (lockfile-only, no major bumps) cleared the new `form-data` CRLF + `vite` HIGH advisories so the deploy's `npm audit --audit-level=high` gate passed; 8 moderate advisories remain.

---

## [deploy 2026-06-14] — Teardown-remediation wave (PRs #142–#173)

The 2026-06-13 16-dimension teardown (`PROJECT_TEARDOWN_2026-06-13.md`, regenerated by this run — see [Related Documents](#related-documents)) produced 18 feature PRs + the migrate-job PR, all merged and deployed to prod (`master 50a56b1`), every deploy CI-green including the live-PG RLS job.

### Changed

- **Biomarker time-series merge — headline behavioral fix (#143 `4325daa`, #145 `e34648f`)** — NEW `backend/src/services/biomarkerSeries.ts` (`upsertBiomarkerReading()`) routes all create/bulk/FHIR write paths into one appended series; previously every write created a disconnected single-point row, so trend math was silently dead. NEW `backend/src/services/biomarkerConsolidation.ts` + a one-time consolidation job collapse legacy duplicate rows. These two services did not exist at the 2026-06-01 baseline (confirmed in the fact digest backend inventory).
- **Health-goal create fixed (#146, `9b63e02`)** — goal create previously 422'd on a missing/invalid category; the category requirement was corrected so goal creation actually succeeds.
- **OCR "review" placebo replaced with real wiring (#150 `d6d2450`, #153 `cc8cab6`)** — the upload review step previously displayed extracted values that were not actually persisted on confirm; clinical-upload wiring now persists the reviewed data.
- **Cost-math respects out-of-pocket / copays (#152, `b322afa`)** — expense cost analysis math corrected for OOP application.

### Fixed

- **FHIR dead vitals + same-day dedupe (#167 `2e2f160`, #168 `5dfa97c`)** — vitals that were imported but never surfaced are now wired through; same-day duplicate lab imports are de-duplicated.
- **Cross-replica logout (#155, `f0b1290`)** — see the cross-instance token revocation work landed 2026-06-13 below; this PR completed the logout wiring across Cloud Run instances.
- **Onboarding no longer writes on GET (#164, `987b0fb`)** — an onboarding GET handler that mutated state was made read-only.
- **SBC field validation + extraction-prompt delimiting (#159 `d33fc38`, #160 `da7deb2`)** — stricter SBC field validation and safer Claude-extraction prompt delimiting.
- **GCS orphan on DB failure (#157, `c429b96`)** — a file uploaded to GCS whose DB row insert then failed previously orphaned the object; now cleaned up.

### Security

- **FORCE ROW LEVEL SECURITY + DB-enforced 7-year audit retention (#154, `9af5043`; migration `20260613_force_rls_and_audit_retention`)** — `FORCE ROW LEVEL SECURITY` on the **18** then-existing RLS tables (the 19th, `revoked_access_tokens`, is FORCE-protected by its own same-day migration `20260613_revoked_access_tokens`, so all **19** RLS tables are now FORCE-protected; closes the table-owner RLS-bypass), and the `audit_logs_delete` policy rewritten to `USING (is_admin_session() AND created_at < now() - interval '7 years')` so even admin context cannot purge recent audit history. `backend/src/services/database.ts` `assertRLSForced()` hard-exits at boot (prod) if any RLS table is not FORCE-protected.

  ```sql
  -- Source: backend/prisma/migrations/20260613_force_rls_and_audit_retention/migration.sql:42-44
  CREATE POLICY audit_logs_delete ON audit_logs
    FOR DELETE
    USING (is_admin_session() AND created_at < (now() - interval '7 years'));
  ```

- **Cross-instance access-token revocation (#155, `f0b1290`; migrations `20260613_revoked_access_tokens`, `20260606000002_add_tokens_valid_after`)** — NEW `revoked_access_tokens` table + Prisma model `RevokedAccessToken`, plus `users.tokens_valid_after` cutoff. Access JWTs now carry a `jti` (`backend/src/services/authService.ts:446-463`). Logout records the `jti` (single-device, cross-instance via `revokeAccessTokenCrossInstance`, `authService.ts:358-394`); logout-all / password-change / reset / email-change / admin-deactivate stamp `tokensValidAfter` (`authService.ts:648-651`); refresh-reuse outside a 10s grace window revokes the entire token family (`authService.ts:795-806`, pentest finding M-1). `pdfRedaction.ts` was DELETED (pdf-lib now unused). See [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).
- **PHI encryption expanded — goal numeric values (#147 `d1a9056`, M4; migration `20260613_encrypt_goal_values`)** — adds `HealthGoal.currentValueEncrypted` + `startValueEncrypted` and `GoalProgressHistory.valueEncrypted`; plaintext Decimal twins retained for read-fallback, not in `PHI_FIELDS`. Backfill job added in #148 (`0e6bad0`, `backend/src/services/goalValueBackfill.ts`).
- **Plan-limit bypass closed (#162, `0792c2f`, M12/M13)** — `maxBiomarkers` per-upload truncation and `insurancePlans` quota re-check on archived-plan reactivation are now enforced; `planGating` fails **CLOSED to FREE** on a DB error.
- **AI spend-cap shared store (#158, `b981a23`)** — `aiCostTracker` reservation/settle backed by a pluggable store (`InMemorySpendStore` default / `RedisSpendStore` when `REDIS_URL` set); `aiSpendGuard` fails closed with 503 on budget reached or shared-store error.
- **Audit coverage + provider-consent enforcement (#151 `3712c90`, #149 `3cafc61`)** — added missing audit rows and enforced provider consent on the relevant read paths.
- **SPA security headers (#156, `453994e`)** — edge security headers on the static frontend.

### Removed / Deprecated

- **RBAC dead-code cleanup (#166, `6c6c555`, L26)** — removed unused RBAC code paths.

### Infrastructure

- **Migrations no longer run at container boot → dedicated Cloud Run migrate job (#142, `50a56b1`)** — the single biggest pipeline change. The Dockerfile CMD is now `CMD ["node", "dist/app.js"]` (was `prisma migrate deploy && node …`); `prisma migrate deploy` runs once per deploy as the Cloud Run **job `ownmyhealth-migrate`**. This resolved the 10-day silent-outage class of failure (a bad migration no longer wedges every cold start). See [`RUNBOOK.md`](./RUNBOOK.md).

  ```dockerfile
  # Source: backend/Dockerfile:86-93
  # Migrations do NOT run at boot. `prisma migrate deploy` runs as a Cloud Run
  # job (deploy.yml step "Run database migrations") — teardown finding #18: the
  # old `migrate && node` CMD made every cold start pay the ~10s migrate check…
  CMD ["node", "dist/app.js"]
  ```

  ```yaml
  # Source: .github/workflows/deploy.yml:43,158
  MIGRATE_JOB: ownmyhealth-migrate
  # …
  gcloud run jobs execute ${{ env.MIGRATE_JOB }} …
  ```

- **Node 20 → Node 22 LTS (#169, `7fed6b6`, M15 — Node 20 EOL Apr 2026)** — `backend/Dockerfile:11,15,37` `FROM node:22-alpine@sha256:…` (digest-pinned, both stages); `ci.yml` `NODE_VERSION: '22'`; `deploy.yml` frontend `setup-node node-version: '22'`. `backend/package.json` `engines.node` = `"^20.19 || ^22.12 || >=24"` (verified `git show HEAD:backend/package.json`).
- **Maintenance jobs as a Cloud Run job (#163, `75c8800`)** — `.github/workflows/maintenance.yml` (one of the 4 workflows at that time; there are 5 today).
- **Email scheduler multi-instance dedupe (#165, `6230467`; migration `20260614_add_email_sent_markers`)** — adds `users.last_weekly_summary_sent` + `last_plan_expiring_sent` for at-most-once claiming of scheduler emails across Cloud Run instances.
- **Trend-semantics classifier (#173, `9e2c3c7`)** — UX wave 3 trend-direction classification fix.

> **Note on deploy-gating:** "Deploy gated on full CI" landed earlier as **#144** (`7e24adc`, 2026-06-13) — `deploy.yml:58 uses: ./.github/workflows/ci.yml`, `build-and-stage` has `needs: ci` (`deploy.yml:66`), `deploy-frontend` has `needs: [ci, promote]` (`deploy.yml:301`), plus 0%-traffic staged deploy + smoke-test + named-revision promote with `--to-revisions` rollback (`deploy.yml:188,217,253,274`).

---

## [deploy 2026-06-13] — Pentest + parallel-pagination (PRs #139–#141)

### Security

- **2026-06-12 pentest remediation (#139, `3988b05`)** — fixes pentest M-1 (refresh-token family not revoked on reuse — `revokeAllUserTokens` now called in the reuse branch) and Lows L-1..L-5. This is the precursor to the cross-instance revocation table that landed 2026-06-13/14.

### Changed

- **Bounded-parallel biomarker pagination (#141, `9aad082`)** — frontend fetches biomarker pages in bounded parallel batches instead of serially.

### Infrastructure

- **Dependency audit clear (#140, `ebfdf78`)** — frontend `vite 7→8` + backend high-severity patches.

---

## [deploy 2026-06-01] — Email-change, provisioning runbook, RLS test matrix (PRs #113–#134)

### Added

- **Verified email-change flow (#133 `ca0024b`, #134 `13db267`; migration `20260601_add_email_change`)** — request → confirm; adds `users.pending_email`, `email_change_token`, `email_change_expires` (`migration.sql:7-12`). #134 ensures the one-time confirmation fires exactly once. Stamps `tokens_valid_after` on success (cross-instance logout). See [Auth/session facts](#).
- **Quest FHIR / SMART-on-FHIR lab connect (#115 `1ecd13a`, #119 `0584956`; migration `20260418_add_lab_connections`)** — SMART App Launch OAuth 2.0 + PKCE (S256) lab sync. Code: `backend/src/routes/fhirRoutes.ts`, `fhirController.ts`, `backend/src/services/fhir/` (`fhirClient`, `labSyncService`, `loincMapper`, `smartAuth`, `urlSafety`), Prisma `LabConnection` model. Env vars `QUEST_FHIR_CLIENT_ID/SECRET/BASE_URL/REDIRECT_URI/SUCCESS_REDIRECT/AUTH_HOSTS` (`backend/src/config/index.ts:266-280`). SSRF hardening landed earlier in #110 (closes finding #26). See [`ENV_VARS.md`](./ENV_VARS.md).
- **Doctor data export (#114, `ec50502`)** — patient-driven export of health data for a provider.
- **Provider/Admin UI + RLS coverage (#128 `fa7c50c`, #129 `24f4a29`, #130 `a65570e`, #132 `3d57540`)** — complete provider/admin UI wiring, provider-admin UI test coverage, an RLS provider-matrix test suite, and a PDF report-generator test.

### Changed

- **PHI: drop plaintext health-goal target (#131 chore; migrations `20260420_encrypt_health_goal_target`, `20260601_null_plaintext_health_goal_target`)** — `health_goals.target_value` plaintext is NULLed for rows that already have `target_value_encrypted` (`migration.sql:23-28`); dead key-rotation code removed (#131 `f289131`).

### Security

- **Encrypt audit-metadata at rest (#126-era; migration `20260606000001_encrypt_audit_metadata` applied 2026-06-06)** — adds `audit_logs.metadata_encrypted`; new rows write AES-256-GCM, legacy plaintext retained read-only until the 2026-06-15 drop.
- **Cross-instance token cutoff column (migration `20260606000002_add_tokens_valid_after`, 2026-06-06)** — adds `users.tokens_valid_after` (M-4).

### Infrastructure

- **Optional shared Redis rate-limit store (#125, `b602156`; PR squash `d72651c`)** — `backend/src/middleware/rateLimitStore.ts` (Redis via `REDIS_URL`, in-memory fallback); 8 named limiters in `rateLimiter.ts`. Audit finding #37.
- **Cloud Scheduler-driven audit retention cleanup (#126 `b0..`, squash `d0939f3`)** — behind `AUDIT_CLEANUP_TOKEN` (`backend/src/config/index.ts:196`). Audit finding #38.
- **Provisioning runbook (#127 `8a0e616`, #37/#38 docs `ad536b2`)** — Redis rate-limiting + Cloud Scheduler retention provisioning. See [`RUNBOOK.md`](./RUNBOOK.md).
- **Colocated backend tests in CI (#117, `6816b6a`)**, **CSV export hardening (#118, `ea5647c`)**, **scheduler plan-expiry dedup (#120, `da38e93`)**, **audit-log tx atomicity (#122, `4ed7f00`)**, **modal/dropdown a11y (#124, `654be60`)**, **insurance UI medium bugs (#121, `b6c7ad5`)**, **pdf-parse typing pin (#123, `afc95d2`)**.

---

## [deploy 2026-05-29] — Security batch + FHIR SSRF + features (PRs #103–#112, plus mid-history feature PRs)

### Added

- **Health Guide streaming AI chat + knowledge layer (#58 `34b861f`, #59 `334c247`, #60 `3cd6c44`)** — streaming conversational AI over the user's health data, a knowledge-retrieval layer (`backend/src/services/knowledge/`), and a self-reported health profile feeding condition-aware AI context. Wired to `backend/src/routes/aiRoutes.ts`, `aiChatController.ts`, guarded by `aiSpendGuard` (`aiRoutes.ts:32`). See [AI cost facts](#).
- **Onboarding wizard (mid-history; migration `20260420_add_onboarding`)** — `backend/src/routes/onboardingRoutes.ts`, `services/onboardingService.ts`, `src/components/onboarding/`.
- **Plan gating / billing tiers (mid-history; migrations `20260420_add_user_plan`)** — `backend/src/routes/planRoutes.ts`, `middleware/planGating.ts`, `config/plans.ts`, `PlanType` enum.
- **Notification preferences (migration `20260417_add_notification_preferences`)** — `backend/src/services/notificationService.ts`.
- **Quest FHIR integration scaffolding (#68 `799c61c`, #69 `394cc3a`, #71 `63dd1d8`)** — earlier FHIR integration + backend refactor + test coverage, before the #115 user-facing connect flow.
- **Insurance hub refactor, expense actuals + visualization, account settings, upload review step, dashboard overview (#54 `2c680d7`, #55 `31f3c28`, #56 `781b881`, #57 `38ef578`)** — large UI/feature batch wiring goals/needs/expenses/insurance to real APIs.

### Security

- **C-1..C-8 critical security batch** — the early-2026 hardening line, all verifiable in code:
  - **C-1 RLS via transaction-scoped `SET LOCAL` (#30, `9727492`)** — `set_config` runs inside transactions so `SET LOCAL` scope survives connection reuse; `withRLSTransaction`/`withRLSContext` in `backend/src/services/database.ts`. **No user-visible UI change; PHI isolation hardened.** See [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).
  - **C-2 encrypt audit-log system salt at rest (#32, `f6bdc9a`)**.
  - **C-3 JWT secret fallbacks removed (#33, `2808b97`)** — `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` have no fallback, ever (`backend/src/config/index.ts:120,124`).
  - **C-4 reject insecure PHI encryption key in all environments (#34, `ea67ccb`)** — `PHI_ENCRYPTION_KEY` format-checked (`config/index.ts:436-459`).
  - **C-5 bump jspdf to close CVE-2026-31938 (#36, `4a08802`)**.
  - **C-6 delete GCS objects on account/data deletion (#37, `0f7970a`)**.
  - **C-7 PHI minimization before Claude API calls (#39, `8c19438`)**.
  - **C-8 RLS runtime context across pre-auth/admin/provider paths (#40 `65f9ffb`, #41 `a648eb8`, #42 `4fa6460`, #43 `74af20e`, #76 `ca8b2c0`)** — wraps `auditService.initialize`, cross-user `ProviderPatient` writes, `authService`/`userEncryption` pre-auth paths, and `adminRoutes`/`auditLog`/users-by-email in RLS context; prepares the audit salt in env for the RLS role cutover.
- **FHIR SSRF + credential-exfiltration block (#110 `5d76cd0`, squash `4ead894`)** — `backend/src/services/fhir/urlSafety.ts` `assertAllowedFhirUrl` enforces host-allowlist + https-for-public + blocks `169.254.169.254` (closes finding #26).
- **Document AI BAA gate (#111 `57a4736`, squash `b0ac61c`)** — Google Document AI OCR gated behind `GOOGLE_BAA_ACTIVE` (`config/index.ts:401-414`).
- **Anthropic BAA activated (#35, `2bd7e36`, 2026-04-16)** — `ANTHROPIC_BAA_ACTIVE` toggled on; PHI-in-prompts flow compliant. Prod hard-fails if `ANTHROPIC_API_KEY` is set while the flag is unset (`config/index.ts:381-394`). See [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).
- **Auth/registration enumeration hardening (#18 `db4289b`/`067f2fd`, #113 `c9781bc`, #116 `a7ac84b`)** — equalized register timing on the existing-email path and stopped leaking account existence on login/registration.
- **CI secret scanning (#112, `cd42dae`)** — gitleaks in CI.
- **Audit fail-closed on value-encryption error (#28, `5c7023a`)** — no `[ENCRYPTION_FAILED]` sentinel.
- **5-High batch close (#52, `fb8a864`)** and P1–P8 security hardening (#103 `07788d6`, #108 `7aaea91`, #109 `02b6a4d`).

### Removed

- **DNA / Genetics removed (#75 `d71269f`, squash; migration `20260423_drop_dna_genetics`)** — `DNAVariant` / `GeneticTrait` models and their encrypted fields dropped. **Breaking** for any client that read those models. Reconcile against [`CLAUDE.md` "Removed Features"](../CLAUDE.md).
- **Dead-code audit cleanup (#74, `eb45a57`)**.

### Changed

- **`CostAnalysis.claudeResponse` → `claudeResponseEncrypted` (migration `20260424_align_uuid_defaults_and_rename_claude_response`)** — the field is now encrypted-suffixed; the old un-suffixed plaintext name is gone (`PHI_FIELDS` lists `claudeResponseEncrypted` at `backend/src/services/encryption.ts:552`).
- **Prevent self role-elevation (migration `20260424_prevent_self_role_elevation`)**, **fix `has_provider_access` (`20260529_fix_has_provider_access`)**, **add `users_select_provider` policy (`20260530_add_users_select_provider`)**.

### Infrastructure

- **CI `--no-traffic` guard + smoke test + explicit promote (#51, `bf381e7`)** — the first version of the staged-deploy pipeline (later extended by #144).
- **RLS NOBYPASSRLS test harness (#105, `93f836a`)**, **green CI (#107, `7e03222`)**, **exempt `/auth/refresh` + `/auth/logout` from the 401 retry loop (#44, `50de4d2`)**, **Dependabot bumps (#29, #67, #77–#82)**.

---

## [deploy 2025-12 → 2026-04] — Baseline + initial deployment docs (PRs #1, #30–#52)

### Added

- **Initial production-ready release (`0c6c022`, 2025-12-03)** — the baseline app: biomarker tracking, insurance management, expense tracking, health goals/needs, provider collaboration, file management, admin panel, audit logging. See [`CLAUDE.md` "Current Features"](../CLAUDE.md).
- **Deployment docs (#1, `1785066`, 2025-12-09)** — first PR.

### Security

- **C-8 documented as a finding (#31, `56bba28`)** — "RLS policies not enforced at runtime (BYPASSRLS)" filed; remediated across the C-8 PRs listed above.

---

## PR Table

Authoritative, anti-omission. Sorted descending. Union of squash-`(#N)` and `Merge pull request #N` styles. Dependabot bumps are condensed into a single row to keep the table navigable (each is non-user-visible).

| PR # | Date (ISO) | Title | Category | User-visible impact | Breaking? |
|---|---|---|---|---|---|
| #182 | 2026-06-15 | Persist enhanced-parser insurance plans + AI-chat Stop button (FB-8/FB-7) | Fixed/Added | Parsed insurance plans now save; chat can be stopped | no |
| #181 | 2026-06-15 | A11y screen-reader wave 1 (A11Y-5/3/4) | Added | Range-bar/toast/keyboard a11y for screen readers | no |
| #180 | 2026-06-15 | Encrypt raw lab filenames at rest (L24) | Security | None (transparent encryption) | no |
| #179 | 2026-06-15 | Drop legacy plaintext `audit_logs.metadata` (M6) | Removed/Security | None visible; legacy plaintext metadata lost | **yes (irreversible)** |
| #178 | 2026-06-15 | Login-oracle, atomic audit, neutralize `canEditData` (L21/L41/L37) | Security | Login no longer reveals lockout/email-verified state | no |
| #177 | 2026-06-15 | AI-path consent hardening (L33/L42/L39) | Security | AI responses always carry disclaimer | no |
| #176 | 2026-06-15 | Upload/extraction guards (L28–L32) | Security | Over-cap/invalid uploads rejected | no |
| #175 | 2026-06-15 | RLS consent-immutability + audit-insert check (L23/L40) | Security | Providers cannot self-grant consent | no |
| #174 | 2026-06-15 | Cookie/session hardening (M7/L26/L22) | Security | CSRF cookie cleared on logout | no |
| #173 | 2026-06-15 | Trend-semantics classifier | Fixed | Correct trend direction labels | no |
| #172 | 2026-06-14 | UX zero-data first-run wave 3 | Changed | Better empty-state experience | no |
| #171 | 2026-06-14 | UX activation funnel wave 2 | Changed | Activation funnel improvements | no |
| #170 | 2026-06-14 | UX honest feedback wave 1 | Changed | Honest success/failure feedback | no |
| #169 | 2026-06-14 | Node 22 EOL bump (M15) | Infrastructure | None | no |
| #168 | 2026-06-14 | FHIR same-day dedupe | Fixed | No duplicate same-day lab rows | no |
| #167 | 2026-06-14 | FHIR dead vitals | Fixed | Imported vitals now surface | no |
| #166 | 2026-06-14 | RBAC dead-code cleanup (L26) | Removed | None | no |
| #165 | 2026-06-14 | Email scheduler multi-instance dedupe | Infrastructure | No duplicate scheduler emails | no |
| #164 | 2026-06-14 | Onboarding GET no longer writes | Fixed | None visible | no |
| #163 | 2026-06-14 | Maintenance as Cloud Run job | Infrastructure | None | no |
| #162 | 2026-06-14 | Plan-limit bypass closed (M12/M13) | Security | Plan limits enforced on upload/reactivation | no |
| #160 | 2026-06-14 | Extraction-prompt delimiting | Fixed/Security | Safer document extraction | no |
| #159 | 2026-06-14 | SBC field validation | Fixed | Stricter SBC parse validation | no |
| #157 | 2026-06-14 | GCS orphan on DB failure | Fixed | No orphaned uploaded files | no |
| #155 | 2026-06-14 | Cross-replica logout | Security | Logout effective across instances | no |
| #154 | 2026-06-14 | FORCE RLS + 7-yr audit retention | Security | None visible; isolation hardened | no |
| #153 | 2026-06-14 | Clinical-upload wiring | Changed | Reviewed upload data actually saved | no |
| #152 | 2026-06-14 | Cost-math OOP/copays | Changed | Accurate cost analysis | no |
| #151 | 2026-06-14 | Audit coverage | Security | More complete audit trail | no |
| #150 | 2026-06-14 | OCR-review placebo fix | Changed | Review step now persists | no |
| #149 | 2026-06-14 | Provider consent enforcement | Security | Consent honored on reads | no |
| #148 | 2026-06-14 | Backfill goal-value encryption | Security | None (data migration) | no |
| #147 | 2026-06-14 | Encrypt goal values (M4) | Security | None (transparent encryption) | no |
| #146 | 2026-06-14 | Health-goal create category fix | Fixed | Goal creation works | no |
| #145 | 2026-06-14 | Consolidate biomarker series | Changed | Trends populate correctly | no |
| #144 | 2026-06-14 | Gate deploy on CI | Infrastructure | None | no |
| #143 | 2026-06-14 | Biomarker time-series merge | Changed | Biomarker trends work | no |
| #142 | 2026-06-14 | Prisma migrate as Cloud Run job | Infrastructure | Faster, safer cold starts | no |
| #141 | 2026-06-13 | Parallel biomarker pagination | Changed | Faster biomarker list load | no |
| #140 | 2026-06-13 | npm audit clear (vite 7→8) | Infrastructure | None | no |
| #139 | 2026-06-13 | Pentest remediation (M-1, L-1..L-5) | Security | Token reuse revokes family | no |
| #134 | 2026-06-01 | Email-change confirm-once fix | Fixed | Email change reliable | no |
| #133 | 2026-06-01 | Verified email-change flow | Added | Change account email (verified) | no |
| #132 | 2026-06-01 | PDF report-generator test | Infrastructure | None | no |
| #131 | 2026-06-01 | Role-guard + dead key-rotation removal | Fixed/Removed | None visible | no |
| #130 | 2026-06-01 | RLS provider-matrix tests | Infrastructure | None | no |
| #129 | 2026-06-01 | Provider/admin UI coverage | Infrastructure | None | no |
| #128 | 2026-05-31 | Complete wiring + UI | Added | Provider/admin/goals/needs UI | no |
| #127 | 2026-05-30 | Infra provisioning runbook | Infrastructure | None | no |
| #126 | 2026-05-30 | Scheduler audit-retention | Infrastructure | None | no |
| #125 | 2026-05-30 | Redis rate-limit store | Infrastructure | None | no |
| #124 | 2026-05-30 | Modal/dropdown a11y | Fixed | Keyboard/focus a11y | no |
| #123 | 2026-05-30 | pdf-parse typing pin | Fixed | None | no |
| #122 | 2026-05-30 | Audit-log tx atomicity | Security | None visible | no |
| #121 | 2026-05-30 | Insurance UI medium bugs | Fixed | Insurance UI fixes | no |
| #120 | 2026-05-30 | Scheduler plan-expiry dedup | Fixed | No duplicate expiry emails | no |
| #119 | 2026-05-30 | FHIR UI review follow-ups | Fixed | FHIR connect UI polish | no |
| #118 | 2026-05-30 | CSV export hardening | Security | Safer CSV export | no |
| #117 | 2026-05-30 | Colocated backend tests in CI | Infrastructure | None | no |
| #116 | 2026-05-30 | Register enumeration fix | Security | No account-existence leak | no |
| #115 | 2026-05-29 | FHIR lab connect | Added | Connect Quest labs (SMART-on-FHIR) | no |
| #114 | 2026-05-29 | Doctor export | Added | Export data for a provider | no |
| #113 | 2026-05-29 | Auth enumeration fix | Security | No account-existence leak | no |
| #112 | 2026-05-29 | CI secret scanning (gitleaks) | Infrastructure | None | no |
| #111 | 2026-05-29 | Document AI BAA gate | Security | OCR gated on BAA flag | no |
| #110 | 2026-05-29 | FHIR SSRF + token-exfil block (#26) | Security | None visible | no |
| #109 | 2026-05-29 | Provider RLS context (P7) | Security | None visible | no |
| #108 | 2026-05-29 | Spend + export hardening (P6/P8) | Security | None visible | no |
| #107 | 2026-05-29 | Green CI | Infrastructure | None | no |
| #105 | 2026-05-29 | RLS NOBYPASSRLS test harness | Infrastructure | None | no |
| #103 | 2026-05-29 | P1–P5 security hardening | Security | None visible | no |
| #76 | 2026-04-24 | C-8: prepare RLS role cutover | Security | None visible | no |
| #75 | 2026-04-23 | Remove DNA/Genetics | Removed | DNA/Genetics tracking removed | **yes** |
| #74 | 2026-04-23 | Dead-code audit cleanup | Removed | None | no |
| #73 | 2026-04-23 | Sync working tree (staging/onboarding/plan/e2e) | Added | Onboarding + plan-gating groundwork | no |
| #72 | 2026-04 | Exempt `/ai/chat` from CSRF validation | Fixed | AI chat works | no |
| #71/#69/#68 | 2026-04 | Quest FHIR integration + refactor | Added | FHIR groundwork | no |
| #70 | 2026-04 | Drop unused import (lint) | Fixed | None | no |
| #58/#59/#60 | 2026-04 | Health Guide AI chat + knowledge + profile | Added | Streaming AI chat over health data | no |
| #54/#55/#56/#57 | 2026-04 | Insurance hub, expenses, settings, goals/needs UI | Added | Major UI wiring | no |
| #53 | 2026-04 | C-8 Part C DB role cutover runbook | Infrastructure | None | no |
| #52 | 2026-04 | Batch-close 5 High audit findings | Security | None visible | no |
| #51 | 2026-04 | CI --no-traffic guard + smoke + promote | Infrastructure | None | no |
| #44 | 2026-04 | Exempt /auth refresh+logout from 401 retry loop | Fixed | No logout loop | no |
| #43/#42/#41/#40 | 2026-04 | C-8 RLS-context wrapping (Parts 1–2b) | Security | None visible | no |
| #39 | 2026-04 | C-7 PHI minimization before Claude | Security | None visible | no |
| #38 (docs) | 2026-04 | Sweep stale status post C-1..C-6 | Infrastructure | None | no |
| #37 | 2026-04 | C-6 delete GCS on account/data deletion | Security | Files purged on deletion | no |
| #36 | 2026-04 | C-5 bump jspdf (CVE-2026-31938) | Security | None visible | no |
| #35 | 2026-04-16 | Anthropic BAA signed; C-7 is prod gate | Security | AI features compliant | no |
| #34 | 2026-04 | C-4 reject insecure PHI key | Security | None visible | no |
| #33 | 2026-04 | C-3 remove JWT secret fallbacks | Security | None visible | no |
| #32 | 2026-04 | C-2 encrypt audit salt at rest | Security | None visible | no |
| #31 | 2026-04 | C-8 finding filed (BYPASSRLS) | Security (doc) | None | no |
| #30 | 2026-04-16 | C-1 RLS transaction-scoped SET LOCAL | Security | None visible; PHI isolation hardened | no |
| #28 | 2026-04 | Audit fail-closed on encryption error | Security | None visible | no |
| #29/#67/#77–#82 | 2026-04 | Dependabot bumps (storage, rate-limit, prisma, sdk, vitest, eslint, rollup) | Infrastructure | None | no |
| #26/#20/#17/#18/#9/#36(a11y)/#32(pdf)/#37(redis)/#38(audit) | 2026-05-30 era | Finding-numbered squash fixes folded into PRs above | Security/Fixed | See per-deploy entries | no |
| #1 | 2025-12-09 | Deployment docs | Infrastructure | None | no |

> PR numbers **#135, #136, #137, #138, #156, #161, #158-via-#158, #145-line** — the gaps #135–#138 are unused/closed-without-merge numbers (no commit references them in `git log --all`); they ship nothing. #156 (`453994e`) and #158 (`b981a23`) are listed above under 2026-06-14.

---

## Statistics

| Metric | Value | Source |
|---|---|---|
| Merged PRs since cutoff | **≈ 110** (range #1–#182, with gaps #2–#8, #10–#16, #19, #21–#27, #45–#50, #61–#66, #83–#102, #104, #106, #135–#138 unused/closed) | `git log --all` union of both merge styles |
| Deploys recorded | **6** dated buckets (2025-12→2026-04, 2026-05-29, 2026-06-01, 2026-06-13, 2026-06-14, 2026-06-15) | this doc |
| Backend tests (current) | **643** backend + **26** live-PG RLS | project memory `ownmyhealth-2026-06-15-security-longtail.md` |
| Frontend tests (current) | **269** | same |
| Prisma migrations | **32** directories | `Glob "backend/prisma/migrations/*"` / fact digest |
| Prisma models | **19** (incl. `RevokedAccessToken`, `LabConnection`) | fact digest `FACT[db-schema]` |
| PHI encrypted fields | **39** across **14** models | `backend/src/services/encryption.ts:476-562` (canonical-number note from task) |
| Security findings closed this cycle (2026-06-13→15) | **C-class 0 open**; teardown High×2 + ~30 Medium + ~40 Low addressed across #142–#182; pentest **M-1** closed (#139); long-tail L21–L42 closed (#174–#180) | [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) |

> **Note on the PHI field count:** the fact digest table enumerates 37 explicit `*Encrypted` rows; the task's canonical number is **39** (`encryption.ts:476-562`). The difference is reconciled by the canonical count — use **39 / 14 models** for cross-doc consistency, verifiable against [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md). Both agree on **14 models**.

---

## Migrations → user-visible schema effects

Every migration directory added since the cutoff, and whether a user sees a schema effect. Full list (32) in the fact digest; the ones that **add/remove fields** are flagged.

| Migration | Field change | User-visible? |
|---|---|---|
| `20260601_add_email_change` | +`users.pending_email`, `email_change_token`, `email_change_expires` | Yes — enables verified email change |
| `20260601_null_plaintext_health_goal_target` | NULLs plaintext `health_goals.target_value` | No (data only) |
| `20260606000001_encrypt_audit_metadata` | +`audit_logs.metadata_encrypted` | No |
| `20260606000002_add_tokens_valid_after` | +`users.tokens_valid_after` | No (logout-all now cross-instance) |
| `20260613_encrypt_goal_values` (M4) | +`health_goals.current_value_encrypted`/`start_value_encrypted`, +`goal_progress_history.value_encrypted` | No (transparent) |
| `20260613_force_rls_and_audit_retention` | FORCE RLS on the 18 then-existing tables (revoked_access_tokens FORCE'd in its own same-day migration) + DELETE-policy 7-yr window | No (DB enforcement) |
| `20260613_revoked_access_tokens` (M1) | +`revoked_access_tokens` table | No (single-device logout cross-instance) |
| `20260614_add_email_sent_markers` | +`users.last_weekly_summary_sent`/`last_plan_expiring_sent` | No (no duplicate emails) |
| `20260615_drop_legacy_audit_metadata` (M6) | **DROP** `audit_logs.metadata` | No visible; **irreversible** |
| `20260615_encrypt_userfile_original_filename` (L24) | +`user_files.original_filename_encrypted`, drop NOT NULL on plaintext | No (transparent) |
| `20260615_provider_consent_immutable_audit_insert_check` | consent trigger + tighter `audit_logs_insert` WITH CHECK | Providers can no longer self-grant consent |
| `20260423_drop_dna_genetics` | **DROP** `DNAVariant`/`GeneticTrait` | **Yes** — DNA/Genetics tracking removed |
| `20260424_align_uuid_defaults_and_rename_claude_response` | rename `claudeResponse`→`claudeResponseEncrypted` | No |
| `20260418_add_lab_connections` | +`lab_connections` table | Yes — enables FHIR lab connect |
| `20260420_add_onboarding` / `20260420_add_user_plan` | onboarding + `PlanType` | Yes — onboarding wizard + plan tiers |
| `20260417_add_notification_preferences` | +notification prefs | Yes — notification settings |

---

## Deploy pipeline at HEAD (diagram)

```
push to master
   │
   ▼
ci.yml  (lint · test · build · gitleaks · npm-audit --audit-level=high · live-PG RLS suite)
   │  (deploy.yml:58  uses: ./.github/workflows/ci.yml)
   ▼  needs: ci  (deploy.yml:66)
build-and-stage ──► docker build (Node 22, CMD ["node","dist/app.js"])
   │                 push image :${github.sha}
   ▼
"Run database migrations"  ──► gcloud run jobs execute ownmyhealth-migrate
   │                            (prisma migrate deploy, NOT at boot)   deploy.yml:43,158
   ▼
deploy no-traffic tagged revision  (--no-traffic)            deploy.yml:188
   │
   ▼  needs: build-and-stage
smoke-test                                                   deploy.yml:217
   │
   ▼  needs: [build-and-stage, smoke-test]
promote ──► gcloud run services update-traffic --to-revisions="$NEW=100"   deploy.yml:274
   │
   ▼  needs: [ci, promote]
deploy-frontend ──► GCS (Node 22 setup)                      deploy.yml:301
```

A commit that fails any CI stage is never built, migrated, staged, or promoted.

---

## Acceptance questions (self-answered from this doc)

1. **Cutoff date of the previous changelog entry?** → None — this is the first generated CHANGELOG; cutoff is git-history start `1e4a167` (2025-11-26) / `0c6c022` "Initial production-ready release" (2025-12-03). See the header.
2. **What shipped in PR #30, and its user-visible impact?** → C-1: RLS enforced via transaction-scoped `SET LOCAL` (`backend/src/services/database.ts`). **No user-visible UI change; PHI isolation hardened.** ([2026-05-29 entry](#deploy-2026-05-29--security-batch--fhir-ssrf--features-prs-103112-plus-mid-history-feature-prs), PR table).
3. **When was the Anthropic BAA activated?** → **2026-04-16** (PR #35, `ANTHROPIC_BAA_ACTIVE` on; prod hard-fails if the API key is set while the flag is unset, `config/index.ts:381-394`).
4. **Which changes are breaking?** → #75/`20260423_drop_dna_genetics` (DNA/Genetics models dropped) and #179/`20260615_drop_legacy_audit_metadata` (plaintext audit-metadata column dropped, **irreversible**). Both flagged "yes" in the PR table.
5. **How many PRs merged since the cutoff?** → ≈110 merged across the #1–#182 range (with documented unused/closed gaps); see [Statistics](#statistics).
6. **Which migrations added/removed fields, and do users see a schema effect?** → See [Migrations → user-visible schema effects](#migrations--user-visible-schema-effects). Visible: email-change, lab-connections, onboarding/plan, notification prefs, DNA-removal, consent-immutability. Transparent: all `*_encrypted` additions, FORCE RLS, token tables.
7. **Most recent infrastructure change?** → CI Security Audit gate unblocked via non-breaking `npm audit fix` (`fb2cd32`, 2026-06-15); prior to that, Node 22 bump (#169) and migrate-as-Cloud-Run-job (#142).
8. **Which security findings closed this cycle?** → pentest M-1 (#139); FORCE-RLS/audit-retention + cross-instance revocation + goal-value/filename encryption + consent-immutability + login-oracle (teardown M/L wave #142–#180); see [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).
9. **What's in `[Unreleased]`?** → No un-deployed code. One pending **operational** follow-up: run the `backfill-userfile-filenames` job (L24) then drop the plaintext filename column. See [[Unreleased]](#unreleased--staged-not-yet-executed-against-prod).

---

## Prompt drift log


> **These entries are a historical record of the 2026-06-16 generation run (HEAD `fb2cd32`), not a description of the current repo.** They were written to log where the *generating prompt* disagreed with the code at that time. Several cite counts that have since moved — as of the 2026-08-01 refresh the live figures are **34 migrations**, **66 backend / 33 frontend / 6 e2e tests**, **75 `.tsx` across 15 dirs**, **19 API modules**, **5 workflows**. Where an entry below conflicts with the body of this document, **the body is current and this log is not**. The prompt-side corrections were applied in `prompts/_drift-audit-2026-08-01.md`.

- **`prompts/19-changelog-doc.md` assumes a prior `CHANGELOG.md` with a cutoff entry.** None exists — `New Project Documents/` held only `security-reviews/` at generation time (`Glob "New Project Documents/*"`). The cutoff was set to git-history start. The prompt author may want a "first-run / no-prior-doc" branch.
- **`prompts/19-changelog-doc.md:108` says "Migrations `20260613_revoked_access_tokens`, `20260606000002_add_tokens_valid_after`" for cross-instance revocation** — confirmed correct; both directories exist (fact digest `FACT[db-schema]`).
- **Cross-link targets `SECURITY_STATUS.md`, `HIPAA_CHECKLIST.md`, `RUNBOOK.md`, `KNOWN_ISSUES.md`, `DATA_MODEL.md`, `PHI_TAXONOMY.md`, `ENV_VARS.md` do not yet exist** in `New Project Documents/` — they are siblings generated by **this same refresh run** (per the task's "New Project Documents/ is being (re)generated by this run"). Links are kept per the prompt's cross-link requirement; if a sibling is not produced this run, treat that link as `(doc pending)`.
- **PHI field count drift:** fact-digest table enumerates 37 explicit rows; task canonical number is 39 (`encryption.ts:476-562`). Used 39/14-models per the cross-doc-consistency instruction; flagged in [Statistics](#statistics). Prompt author / `00-index.md` "Verified codebase counts" should reconcile the 37-vs-39 framing (the 39 includes twin/derived encrypted columns the digest summarized differently).
- **`backend/package.json engines.node`** is `"^20.19 || ^22.12 || >=24"` (not a hard pin to 22). The runtime image is pinned to `node:22-alpine` in `backend/Dockerfile:15,37`; the prompt's "Node 20 → Node 22" is accurate for the **runtime**, but the engines range still permits 20.19+/24+. Documented precisely above.

---

## Related Documents

- [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) — per-finding status (C-1..C-8, teardown M/L, pentest M-1) referenced by every Security entry above.
- [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) — BAA activation (Anthropic 2026-04-16, Google Document AI gate) and 7-year audit-retention compliance.
- [`RUNBOOK.md`](./RUNBOOK.md) — migrate-job, Redis rate-limiting, Cloud Scheduler retention, and the L24 backfill operational steps.
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) — documented accepted races (L34/L36 AI-quota TOCTOU) and infra-only open items.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — full ER + RLS policies behind every migration listed here.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — the 39 encrypted fields × 14 models referenced in the encryption entries.
- [`ENV_VARS.md`](./ENV_VARS.md) — every env var introduced by the FHIR, AI-budget, BAA, and Redis features above.
