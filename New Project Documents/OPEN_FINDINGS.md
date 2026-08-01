# OPEN_FINDINGS.md — Single Authoritative Open-Findings Ledger

> **Reader contract**: this is the ONE list of open security / compliance / cost / trust findings for OwnMyHealth.
> Every other document (`SECURITY_STATUS.md`, `KNOWN_ISSUES.md`, security reviews, GTM readiness) **links here and must not restate severities**. If another doc disagrees with this ledger, this ledger wins and the other doc is stale.
>
> Created 2026-07-11 to close scrutiny finding **P0-6** (severity ledgers contradicted each other: `SECURITY_STATUS.md` claimed 0 open High while `KNOWN_ISSUES.md` listed H-1/H-2/H-3; the 2026-06-21 assessment's Critical appeared in neither).
>
> Severities are posture-dependent (impact × exposure under the **current posture** — see §Posture). Re-triaged 2026-07-14 for the sandbox posture; the full old→new disposition is in §Re-triage disposition.

| Field | Value |
|---|---|
| **Last updated** | 2026-08-01 (OF-24–OF-27 from the prompt-library refresh; OF-28–OF-31 from the first runs of prompts 47/48/49) |
| **Posture** | **Sandbox — no GCP** (see §Posture) |
| **Code state** | master `12b45ae` (PR #230 merged). Working tree carries the 2026-08-01 prompt-library refresh + `New Project Documents/` regeneration, uncommitted |
| **Sources reconciled** | This ledger @ `2656a82`; founder posture decision (2026-07-14 session); repo re-verification 2026-07-14 (OF-01 blob presence via `git cat-file -e`, commits `8ec3989`/`0456c50`, migrations through `20260712`, PR #227 state). **2026-08-01**: full RLS policy inventory across all 34 migrations, `prompts/_drift-audit-2026-08-01.md`, and `security-reviews/44-token-revocation-review.md` |
| **Open counts** | **Live: 0 Critical · 1 High · 0 Medium · 18 Low** (19 items; 7 Lows Accepted-with-trigger) **· Dormant (launch checklist): 7** · OF-20 merged into OF-08 · OF-11 & OF-23 closed 2026-07-14 · **OF-24–OF-31 added 2026-08-01** |

---

## Posture: sandbox, no GCP (declared 2026-07-14)

**Facts.** The founder decided 2026-07-14 that OwnMyHealth will not use Google Cloud for the time being (cost); the project is a pre-launch sandbox for a hopeful future launch. GCP billing on project `#1046989989964` has been disabled since ~2026-07-12 (verified: deploys fail at image push), which suspends the deployed stack (Cloud Run backend, Cloud SQL prod DB, GCS buckets); Google eventually deletes resources on billing-disabled projects. There is no deployment target and no real users.

**Explicit assumption.** All data ever stored in the prod stack was founder/test data. **If any real third-party PHI was ever stored, this re-triage is invalid** and the affected findings (OF-01, OF-03, OF-12) revert to their pre-2026-07-14 severities.

**What this changes.** Exposure is now "local sandbox, single process, founder-only data." Findings that only exist when deployed move to **Dormant (launch checklist)** below — they are not current risks, but each carries the severity it re-acquires at launch so nothing is forgotten.

**Global reactivation triggers (hard).** Any one of the following reopens every dormant item at its reactivation severity and forces a full re-triage of this ledger:
- re-enabling GCP billing on any project this repo's history can authenticate to — **OF-01's key deletion is a precondition for this**;
- deploying the app anywhere (any cloud, any tier);
- any real user, or any non-founder PHI entering any database;
- marketing/making the product available to others.

---

## Severity rubric (the ONE rubric)

Severity = worst realistic impact × exposure **under the current posture**, on a single scale regardless of class (security, cost, availability, compliance, product trust). A cost-DoS or compliance gap can be High; "not a classic vuln" is not a reason to downgrade.

| Severity | Meaning |
|---|---|
| **Critical** | PHI exposure or credential-compromise path exercisable **now** |
| **High** | Material harm likely on the current path (e.g. a hazard that silently re-arms on a foreseeable event, a core flow broken under normal ops) |
| **Medium** | Harmful under specific conditions; accepted races with backstops; missing detection |
| **Low** | Hardening, documented-accepted residuals, tech debt |

Status values: **Open** · **In progress** (fix drafted/uncommitted) · **Accepted** (with a written re-evaluation trigger) · **External-ops** (action lives outside the repo — GCP console, vendor paperwork) · **Dormant (launch checklist)** (not a current risk under this posture; carries a reactivation severity + trigger).

---

## High

### OF-01 — Production GCP service-account private key recoverable from git history
- **Class**: security / compliance · **Status**: Open (External-ops + repo work) · **Alias**: OMH-C01 (assessment 2026-06-21) · **Critical → High 2026-07-14**
- **Fact**: commit `202f2dd` (2026-01-07) committed `backend/gcp-ocr-key.json.json` containing the real private key for `ocr-service@ownmyhealth-prod.iam.gserviceaccount.com` (key id `109ec48bab8a95f27168f8d6e406ce28ac4794bc`). It was removed from HEAD ~37s later (`528d5f9`) but the blob is still reachable — **re-verified 2026-07-14** via `git cat-file -e 202f2dd:backend/gcp-ocr-key.json.json` (exists; contents not printed). Anyone with repo read access (clone, fork, CI cache, backup) can recover it.
- **Why High (was Critical)**: rubric-Critical requires a path exercisable *now*. Billing on the project has been disabled since ~2026-07-12, which suspends the billed APIs this SA could reach (Document AI, GCS) — the key still authenticates to IAM but currently has nothing live behind it. The remaining hazard is **silent re-arm**: re-enabling billing instantly revives the key with whatever access it retained, and nothing would force anyone to remember it at that moment. IAM deletion status is **unverified — treat the key as alive**.
- **Hard gate**: deleting this key is a **precondition for ever re-enabling GCP billing** (posture §Global reactivation triggers).
- **Done when**:
  1. Key `109ec48b…` deleted — or the `ocr-service` SA deleted, or the GCP project shut down — in GCP IAM. Free, works with billing disabled, ~5 minutes — **external, GCP console**;
  2. A dated determination recorded here that the key is dead (this downgrades the historical blob to inert);
  3. Best-effort: check Cloud Logging for use of the key since 2026-01-07 while console access lasts; if logs are unavailable or data-access logs were never enabled, record that instead. (Sandbox assumption — founder/test data only — lowers the stakes of this step.)
  4. History purged (`git filter-repo` / BFG + force-push) **before the repo ever gains collaborators, forks, or goes public** — hygiene once 1–2 are done. Until purged, the OF-11 nightly history scan stays red **by design** (it is this finding's regression guard). Alternative after step 2 only: a narrowly-scoped, dated `.gitleaks.toml` allowlist entry for the dead key.
- **Owner**: founder (GCP console + repo).

---

## Medium

*(none open — OF-23 closed 2026-07-14, see Closed findings)*

---

## Low

### OF-03 — Legacy plaintext filenames confined to the suspended prod DB (sunset path)
- **Class**: compliance / ops · **Status**: Open (External-ops) · **Aliases**: L-3 (KNOWN_ISSUES), L24 ops follow-up (SECURITY_STATUS §3), scrutiny P0-1 · **High → Low 2026-07-14**
- **Fact**: new uploads encrypt `user_files.original_filename`; legacy plaintext rows exist only in the prod Cloud SQL instance, which is suspended under disabled billing and subject to Google's eventual deletion. No DROP migration in tree (latest: `20260712_add_sessions_update_policy`); **PR #227** (self-guarded drop of the plaintext column) is OPEN/DRAFT — re-verified 2026-07-14.
- **Why Low (was High)**: the High rationale was plaintext PHI residue *in production while marketed as encrypted-at-rest*. There is no production and no marketing; residual exposure requires GCP account compromise or a billing re-enable before deletion.
- **Done when** (either path):
  - (a) **Sunset (expected)**: prod Cloud SQL instance deletion confirmed in the console — deliberate deletion preferred over waiting for Google (clean "no PHI left behind" exit; export anything wanted first) → close this finding; then merge PR #227 (with no legacy rows anywhere, its backfill precondition is vacuous and any future DB is created post-DROP).
  - (b) **Revival**: if the instance is ever brought back, the original path applies — `backfill-userfile-filenames` DRY RUN → `--apply` → DROP migration, evidence in `RUNBOOK.md`.

### OF-06 — Plan-limit / AI-quota TOCTOU race (count-then-allow)
- **Class**: correctness · **Status**: Accepted · **Aliases**: H-1 (KNOWN_ISSUES), M-L34/L36 (SECURITY_STATUS), scrutiny P1-7 · **Medium → Low 2026-07-14**
- **Fact**: `checkPlanLimit` is read-only; N concurrent requests can overshoot a finite limit by N−1 (`backend/src/services/usageTracker.ts` KNOWN RACE comment). Highest-cost path backstopped by the fail-closed dollar `aiSpendGuard`.
- **Amended 2026-08-01 — concurrency is not required.** `requirePlanLimit('maxBiomarkers')` gates per-**request**, not per-**row**, so a single `POST /api/v1/biomarkers/batch` from a user one row under the cap overshoots by up to `batchSize−1` with **no concurrency at all** (`backend/src/routes/biomarkerRoutes.ts:95-105`, where the residual is commented). The OCR/upload path mitigates by truncating the batch in-transaction (`controllers/upload/shared.ts`, M12); the direct batch endpoint has no equivalent. Consequence for the prescribed fix: the atomic reservation must reserve **N slots**, not one.
- **Why Low now**: no deployed instance and no third-party users — an overshoot requires the founder racing their own requests, bounded by the dollar cap.
- **Re-eval trigger (unchanged, sharpened)**: **becomes High and a launch blocker the day plan limits guard paid entitlements** — atomic reservation (`UPDATE … WHERE n < :limit RETURNING n` inside `withRLSTransaction`) is a billing-launch prerequisite (scrutiny P0-5). Also: observed abuse.

### OF-09 — Access-token staleness check fails OPEN on DB error
- **Class**: security (fail-open) · **Status**: Accepted · **Alias**: M-3 (KNOWN_ISSUES) · **Medium → Low 2026-07-14**
- **Fact**: `isAccessTokenStale` returns `false` if the revocation-cutoff read throws (`backend/src/services/authService.ts`); a just-revoked token could be accepted during a DB outage. Bounded by 15-min access-token lifetime + 15s cache TTL.
- **Why Low now**: requires a DB outage + a freshly revoked token + an attacker holding it — negligible in a founder-only sandbox.
- **Re-eval trigger**: any real incident involving revocation; a move to longer session lifetimes; **re-rate at launch** (was Medium).

### OF-10 — CSP allows `'unsafe-inline'` styles
- **Class**: hardening · **Status**: Open · **Aliases**: M-4 (KNOWN_ISSUES), scrutiny P2-6 · **Medium → Low 2026-07-14**
- **Fact**: `styleSrc: ["'self'", "'unsafe-inline'"]` with `TODO(csp-nonce)` (`backend/src/app.ts`); Tailwind + third-party runtime style injection block a nonce CSP today.
- **Why Low now**: style-injection XSS hardening with a single founder user has ~nil exposure. Still valid sandbox-era code work (no cloud dependency).
- **Done when**: nonce-based CSP migration; `'unsafe-inline'` removed. **Re-rate Medium at launch.**

### OF-14 — In-memory access-token blacklist is per-process
- **Status**: Accepted · **Alias**: M-2 (KNOWN_ISSUES) · unchanged Low. Largely closed by DB-backed `tokens_valid_after` + `revoked_access_tokens`; only the redundant in-memory map is per-process — moot single-process anyway.

### OF-16 — PBKDF2 iteration try-both fallback (no per-ciphertext KDF metadata)
- **Status**: Open (debt) · **Aliases**: L-2 (KNOWN_ISSUES), scrutiny P2-7 · unchanged Low. `TODO(key-rotation)` in `backend/src/services/encryption.ts`. Environment-independent; fine sandbox-era work. **Done when**: KDF params stored per row/user; full re-encrypt; fallback removed.

### OF-17 — `pdf-parse@1.1.1` unmaintained on the PHI ingestion path
- **Status**: Accepted (documented decision) · **Aliases**: L-4 (KNOWN_ISSUES), OMH-L01 (2026-06-21) · unchanged Low. Exact-pinned, pure-JS, wrapped in `secureParsePdf()` guards. **Re-eval trigger**: a CVE against `pdf-parse`, or a verified `pdfjs-dist` text-only migration on the future deploy platform.

### OF-18 — FHIR sync has no page/byte budget
- **Status**: Accepted · **Alias**: L-13 (SECURITY_STATUS) · unchanged Low. Feature off by default (`QUEST_FHIR_CLIENT_ID` empty). **Done when**: page/byte budget in `labSyncService.syncLabResults`.

### OF-19 — SSRF allowlist validates host, not resolved IP (DNS-rebind residual)
- **Status**: Accepted · **Alias**: L-40 (SECURITY_STATUS) · unchanged Low. Trusted hosts are operator-configured, not user input.

### OF-21 — Transitive npm advisories: 1 high (hono) + 8 moderate (uuid chain)
- **Status**: Accepted / deferred majors · **Aliases**: M-5 (KNOWN_ISSUES), OMH-I01/I02 · unchanged Low. `hono` advisories are Lambda/Windows-static specific; `uuid` fix gated on a breaking `@google-cloud/storage` major (which OF-23's storage abstraction may make swappable). Nothing is deployed, so reachability is nil.

### OF-24 — Blocked and failed AI-guidance requests consume the user's daily quota
- **Class**: correctness / product trust · **Status**: Open · **Found**: 2026-08-01 (prompt-43 review re-run)
- **Fact**: the `aiGuidancePerDay` counter counts audit rows matching `resourceType='biomarker_ai_guidance'` **and** `action='READ'`, with **no filter on the `operation` metadata field** (`backend/src/services/usageTracker.ts:115-122`). All three guidance audit writes use `auditService.logAccess(...)` under that resourceType, and `logAccess` unconditionally writes `action: 'READ'` (`backend/src/services/auditLog.ts:383`). So the BAA-gate refusal (`GUIDANCE_BLOCKED_NO_BAA`, 503, `biomarkerRoutes.ts:154`) and the not-found path (`GUIDANCE_NOT_FOUND`, 404, `:187`) each burn a quota slot for a request that never reached Claude — only `:284` (`PHI_ACCESS`) is a real use.
- **Why this is a bug and not a design choice**: the identical defect was found and deliberately fixed on the AI-**chat** path. `aiChatController.ts:40-48` documents it as **L-35** and routes blocked/failed attempts to a separate `RESOURCE_TYPE_ATTEMPT = 'HealthGuideAttempt'` that the counter does not match, explicitly so they do not consume quota. The guidance path never received the same treatment.
- **Impact**: a FREE user (`aiGuidancePerDay: 5`) exhausts their whole daily allowance with five requests against non-existent biomarker UUIDs, or on any day `ANTHROPIC_BAA_ACTIVE` is unset — the BAA gate 503s *and* burns quota, so restoring the key leaves the user still locked out for the rest of the UTC day. Self-inflicted only: the audit row carries the caller's own `userId` and RLS scopes the count, so there is no cross-tenant path.
- **Why Low now**: founder-only sandbox; the only person whose quota can be burned is the person who can also raise the limit.
- **Done when**: the two non-success writes move to a distinct resourceType (e.g. `biomarker_ai_guidance_attempt`) that `usageTracker` does not match, preserving the audit trail without consuming quota — a controller-side change only, exactly as in L-35; plus a case in `biomarkerRoutes.guidance.test.ts`.
- **Re-eval trigger**: **Medium the moment any non-founder user exists.** The fix is small and has a working precedent in the same codebase, so there is no good reason to carry this to launch.

### OF-25 — `revoked_access_tokens` has no RLS UPDATE policy but is written by `upsert`
- **Class**: correctness / RLS · **Status**: Open (**structural fact confirmed; runtime failure UNVERIFIED**) · **Found**: 2026-08-01 (prompt-44 review re-run) · **Same class as**: OF-22 (closed)
- **Fact (confirmed)**: the table is `ENABLE` + `FORCE ROW LEVEL SECURITY` and defines exactly three policies — `_select_own`, `_insert_own`, `_delete_own` (`backend/prisma/migrations/20260613_revoked_access_tokens/migration.sql:29-39`). There is **no UPDATE policy**. On an RLS-enabled table a command with no matching policy is denied outright; `is_admin_session()` cannot help, because the admin branch lives inside policies that do not exist for UPDATE. The single-device revocation write is a Prisma `upsert` keyed by `jti`, running under a **user** context (`withRLSContext(verifiedUserId, ...)`, `backend/src/services/authService.ts:377-383`). The `create` branch satisfies `_insert_own`; the **conflict branch is an UPDATE** with nothing to satisfy.
- **Not established**: whether Prisma's `upsert` with an **empty** `update: {}` actually emits an UPDATE at runtime (it may emit `INSERT ... ON CONFLICT DO UPDATE`, a SELECT-then-UPDATE pair, or optimize the no-op away). Both non-optimized forms require an UPDATE policy. This was not executed — do not treat the failure as confirmed.
- **Impact if realized**: bounded. The conflict branch is reached only on a **replayed revocation of the same `jti`** (double-clicked logout, client retry, logout on an already-revoked token). The first insert succeeded, so the revocation holds and **no token stays valid** — this is not a security bypass. What breaks is (a) the documented idempotency of the write, (b) silently, because the throw is swallowed by the best-effort catch (`authService.ts:388-393`) and surfaces only as a `warn`, and (c) as a trap for any future code that legitimately needs to update a revocation row, which would pass in dev (BYPASSRLS) and fail in production (NOBYPASSRLS) — precisely the OF-22 failure shape.
- **Note**: the migration's own comment says the policies mirror `sessions` (`migration.sql:20-25`). That is no longer true — `sessions` gained `sessions_update_own` on 2026-07-12 and this table did not.
- **Done when**: (1) confirm-or-refute by revoking the same `jti` twice under the NOBYPASSRLS `omh_app` role — cheap, the `rls` CI job already provisions that role; (2) if confirmed, either add `revoked_access_tokens_update_own` mirroring `sessions_update_own`, or make the write insert-only and tolerate the duplicate-key error (`update: {}` shows no update is actually wanted); (3) pin it with a case in `rls.test.ts` beside the existing `sessions row lock` block (`rls.test.ts:541`).
- **Re-eval trigger**: any deploy; or any change that makes a revocation row legitimately mutable.

### OF-26 — Two maintenance jobs UPDATE tables that have no RLS UPDATE policy (potential silent data loss)
- **Class**: correctness / data-loss risk · **Status**: Open (**structural fact confirmed; runtime behavior UNVERIFIED**) · **Found**: 2026-08-01 · **Same class as**: OF-22 (closed), OF-25
- **Fact (confirmed)**: a full policy inventory across all 34 migrations found four live tables with SELECT/INSERT/DELETE policies and no UPDATE policy. `audit_logs` is **intentional** (audit rows are immutable by design). The other three are UPDATEd by code:

  | Table | Written by | RLS context |
  |---|---|---|
  | `biomarker_history` | `tx.biomarkerHistory.updateMany` — history re-parenting (`backend/src/services/biomarkerConsolidation.ts:145`) | **user** (`withRLSTransaction(userId, ...)`, `maintenance/consolidateBiomarkerSeries.ts:103`) |
  | `goal_progress_history` | `tx.goalProgressHistory.update` — PHI re-encryption (`backend/src/services/goalValueBackfill.ts:127`) | **user** (`withRLSTransaction(userId, ...)`, `maintenance/backfillGoalValues.ts:113`) |
  | `revoked_access_tokens` | `upsert` conflict branch | **user** — tracked separately as OF-25 |

  Unlike OF-25 there is no Prisma ambiguity here: `.update()` and `.updateMany()` are unambiguously UPDATE statements. Both run under a *user* context, so `is_admin_session()` does not apply — and with no UPDATE policy at all, nothing does.
- **Impact if realized**: `backfill-goal-values` would fail to re-encrypt `GoalProgressHistory.valueEncrypted`; `consolidate-biomarkers` would fail to re-parent history rows. The second is the dangerous one: `applyUserConsolidation` documents that the re-parent must succeed **before** the duplicate delete, or the duplicate's FK cascade drops the history (`biomarkerConsolidation.ts:130-136`). A silently-failing re-parent followed by a successful delete is **irreversible PHI loss**, not a no-op. Whether the transaction aborts (safe) or the failure is caught and the delete proceeds (unsafe) is the specific question to answer.
- **Why Low now**: no deployment target; these are `workflow_dispatch`-only jobs, DRY-RUN by default, and local development connects as a BYPASSRLS role — so the failure cannot be triggered by ordinary sandbox work.
- **Done when**: (1) determine per table whether UPDATE should be **allowed** (add the policy) or **forbidden** (change the code — for `biomarker_history`, delete-and-reinsert rather than re-parent). Do not add policies reflexively: `audit_logs` proves the absence is sometimes the point. (2) Establish the abort-vs-continue behavior of `applyUserConsolidation` on a failed re-parent. (3) Add live-PG coverage under the NOBYPASSRLS role.
- **Re-eval trigger**: **High** on any `apply=true` maintenance run against a NOBYPASSRLS role, or any deploy. This is a launch blocker, not a current risk.

### OF-27 — Plan gate issues six count queries per gated request
- **Class**: performance / tech debt · **Status**: Open · **Found**: 2026-08-01
- **Fact**: `checkPlanLimit` needs exactly one usage counter but calls `getUserUsage`, which issues all six counts in a `Promise.all` — including unbounded `tx.biomarker.count` and `tx.auditLog.count` (`backend/src/services/usageTracker.ts:199`, `:87-137`). A single lab upload passes two gates (`pdfUploadsPerMonth` + `maxBiomarkers`, `uploadRoutes.ts:84,88`) and therefore fires **12** count queries before the handler runs.
- **Why Low now**: single user, no load. No security consequence.
- **Done when**: `checkPlanLimit` resolves `NUMERIC_LIMIT_TO_USAGE[action]` and issues only that count. Keep `getUserUsage` as-is for `planRoutes.ts`, which genuinely needs all six for the usage-bar display — the one-transaction design there is deliberate (mutually-consistent numbers, `usageTracker.ts:84-85`).
- **Re-eval trigger**: any load testing, or a deploy.

### OF-28 — Accessibility defects (4 items, one owner, one fix session)
- **Class**: accessibility · **Status**: Open · **Found**: 2026-08-01 (first run of prompt 47) · **Full detail**: [`security-reviews/47-accessibility-review.md`](./security-reviews/47-accessibility-review.md)
- **Context**: the 2026-06-20/21 a11y waves largely succeeded — all 15 dialog surfaces use `useFocusTrap` with `role="dialog"` + `aria-modal` + a resolving `aria-labelledby` **and** `tabIndex={-1}`; a skip link works; `lang` is set; zoom is not blocked; there are no positive `tabIndex` values; every `focus:outline-none` has a `focus-visible` replacement. Data export and account deletion — the two compliance-critical flows — are fully keyboard-operable. These four items are what the waves did not reach.
- **Items**:
  1. **The HIPAA idle-timeout dialog bypasses the shared focus trap** (`src/contexts/AuthContext.tsx:379-418`). It has the right ARIA and `autoFocus` moves focus in, but there is no Tab trap, no Escape, no focus restoration, no scroll-lock — so `aria-modal="true"` promises an inertness nothing enforces, on the one modal whose purpose is to be acted on before an automatic logoff. Missed because the wave searched `src/components/**` and this lives in `src/contexts/`.
  2. **Trend charts have no non-visual equivalent** (`BiomarkerChart.tsx`, `TrendSparkline.tsx`) — Recharts emits SVG with no accessible name. `BiomarkerRangeBar.tsx:65-70` is the in-repo pattern to copy (`role="img"` + a label carrying status in words).
  3. **Dropdowns declare `role="menu"` / `aria-haspopup="listbox"` without arrow-key or Escape support** (`ExportMenu.tsx:112-130`, `TrendsPage.tsx:189,248`) — promising an interaction model that is not implemented is worse than promising nothing.
  4. **No `eslint-plugin-jsx-a11y`** (zero hits in `eslint.config.js` / `package.json`), so the waves' gains have no regression guard. Item 1 is the proof: one dialog outside the search path stayed unmigrated for six weeks with nothing flagging it.
- **Why Low now**: founder-only sandbox. Accessibility harm requires users who are not the author.
- **Done when**: item 1 migrated to `useFocusTrap` and added to `dialogA11y.test.tsx`; items 2-3 addressed or explicitly accepted; `eslint-plugin-jsx-a11y` recommended ruleset added to the existing `frontend` CI lint step.
- **Re-eval trigger**: **Medium on any non-founder user.** ADA Title III / Section 508 expectations attach to consumer health services — a legal question this ledger does not answer, but the reason this is not purely cosmetic.
- **Caveat on the evidence**: all verification was **static** (attributes present, handlers wired, names resolving). No screen reader was used, and nothing in CI uses one. Treat the passes as "correct by construction", not "verified in use".

### OF-29 — Goal deadlines off by one day in negative-UTC locales, and the whole date class is unguarded
- **Class**: correctness · **Status**: Open · **Found**: 2026-08-01 (first run of prompt 49) · **Full detail**: [`security-reviews/49-calculation-correctness-review.md`](./security-reviews/49-calculation-correctness-review.md)
- **Fact (a) — the bug**: `daysRemaining` (`src/components/analytics/GoalTrackerPanel.tsx:97-101`) mixes a UTC-parsed date-only value (`new Date(targetDate)`, where `HealthGoal.targetDate` is `@db.Date`) with a local `new Date()`. In America/Los_Angeles a goal due `2026-08-02` reads **"Due today"** on the afternoon of Aug 1 and **"Overdue by 1 day"** on the afternoon of Aug 2. Silent, plausible, consistent — nothing looks broken.
- **Fact (b) — why it survived, and will recur**: `Grep` for `TZ=` / `timezone` / `America/` across `vitest.config.ts`, `src/__tests__/setup.ts` and `package.json` returns **zero hits**, and there is no test file for `src/utils/format.ts`. CI runs in **UTC** — the one timezone where this entire class is invisible. Three commits of fixes (`b376949`, `ea57001`, `45a0cbc`) are protected by nothing.
- **Why Low now**: display-only (no stored value is wrong) and one user.
- **Done when**: (1) `daysRemaining` compares calendar days on both sides, with a deliberate, commented choice between viewer-UTC and viewer-local "today"; (2) the frontend suite runs under a forced negative-UTC timezone (`test: { env: { TZ: 'America/Los_Angeles' } }`), ideally a two-timezone matrix; (3) a `format.test.ts` asserts `formatDateOnly('2026-01-01')` renders Jan 1 and that `formatDate` on a timestamp still renders local.
- **Re-eval trigger**: **Medium on any non-founder user.** Fix (1) and (2) together — (1) alone fixes one instance of a class that has now recurred four times.

### OF-30 — `isInRange` reports "out of range" for a biomarker with no reference range
- **Class**: correctness / clinical trust · **Status**: Open (**reachability UNVERIFIED**) · **Found**: 2026-08-01
- **Fact**: `isInRange` is `value >= normalRange.min && value <= normalRange.max` (`src/utils/biomarkers/trendCalculations.ts:179-181`). `Biomarker.normalRange` is non-optional, but **`ExtractedBiomarker.normalRange` is optional** (`src/types/index.ts:125`) — a lab report stating no reference range legitimately produces one. With an absent range both comparisons against `undefined` are false, so the function returns `false`, rendering as **out of range**.
- **Not established**: whether the upload → review → save path can deliver such a biomarker to `isInRange` without a range being populated first. The type permits it; the runtime path was not traced.
- **Impact if reachable**: "we don't know this marker's reference range" and "this marker is abnormal" are different clinical statements. Showing the second for the first is alarming rather than reassuring — the safer failure direction, but still wrong, and it erodes trust in every other out-of-range badge.
- **Done when**: absence is represented explicitly (`boolean | null`, or a `hasRange` flag) and rendered as "range unknown" rather than a status. Cheaper than tracing the reachability question.
- **Re-eval trigger**: any real lab upload lacking a stated reference range.

### OF-31 — SBC extraction confidence is computed then discarded; plan financials shown without uncertainty
- **Class**: product trust · **Status**: Open · **Found**: 2026-08-01 (first run of prompt 48) · **Full detail**: [`security-reviews/48-insurance-domain-review.md`](./security-reviews/48-insurance-domain-review.md)
- **Fact**: `sbcExtraction.ts:734` defines a confidence-scoring contract for the model, and the lab path persists an equivalent (`UserFile.extractionConfidence`). `InsurancePlan` has no such column and no confidence value reaches the SBC upload UI. A deductible extracted at low confidence from a poor scan is stored and rendered identically to a high-confidence one — and then feeds `extractProjectedOOP` to produce a dollar figure the user makes decisions on.
- **Context — what is *not* wrong**: the extraction trust boundary itself is sound. `sanitizeExtractedSbc` (`controllers/upload/shared.ts:509-562`) type-checks, non-negative-checks and ceiling-clamps every numeric, strips control characters and caps every string, caps every array, whitelists `planType`, and validates dates — so a hallucinated or hostile value cannot reach the database out of range. This finding is about *uncertainty disclosure*, not input validation.
- **Why Low**: the user can see and edit every extracted field in the confirm step before it is used.
- **Done when**: confidence is persisted alongside the plan and surfaced per-field in the existing SBC review step.
- **Re-eval trigger**: any non-founder user; any marketing claim about extraction accuracy.
- **Related, not separately ledgered**: `comparePlans` silently drops unowned/stale plan ids then 404s with "At least 2 valid plans required", which reads as a broken feature (`insuranceController.ts:802-812`) — note the per-id silence is deliberate and correct, since naming the id would confirm another user's plan exists. And `planIdNumber` is unvalidated plaintext `VarChar(100)` sitting next to the encrypted `memberId`; a user transcribing from their card can put a member ID in it, outside `PHI_FIELDS` and every guarantee `PHI_TAXONOMY.md` makes. Cheap to encrypt now, expensive after there are rows.

---

## Dormant — launch checklist (not current risks; reactivation severity in parentheses)

These items were open operational risks under the deployed-on-GCP posture. Under the sandbox posture they have no exposure surface. **They reopen automatically at the listed severity on any global reactivation trigger** (§Posture). Platform-specific wording is generalized — the next deploy may not be GCP.

### OF-04 (High) — No MFA
- **Aliases**: scrutiny P0-4, GTM readiness. No TOTP/second-factor library in backend deps. A medical record is a high-value account; MFA is the standard consumer mitigation for the simplest takeover path. **Pure code, no cloud dependency — recommended sandbox-era build.** Done when: optional TOTP + recovery codes; enforced on sensitive operations; recovery flow tested.

### OF-05 (High, if FHIR is enabled multi-instance) — FHIR PKCE verifier store is per-process
- **Aliases**: H-2 (KNOWN_ISSUES), L-39 (SECURITY_STATUS), scrutiny P1-2. PKCE `code_verifier` Map is per-process (`backend/src/services/fhir/smartAuth.ts` — "SHARED STORE REQUIRED"); a callback routed to a different instance drops the connect. Feature off by default; single-process sandbox unaffected. Ships with OF-07's shared-store work. Done when: shared verifier store; multi-instance OAuth verified.

### OF-07 (Medium) — Rate-limit + AI-spend stores are per-process without `REDIS_URL`
- **Amended 2026-08-01**: there is a **third** per-process store with the same multi-instance caveat — the revocation-state cache in `authService.ts` (`TOKENS_VALID_AFTER_TTL_MS = 15_000`, `authService.ts:168`), which bounds cross-instance convergence of `tokens_valid_after` and the revoked-`jti` set to ~15s. Correct single-process; must be considered alongside the rate-limit and AI-spend stores before `max-instances > 1`.
- **Aliases**: M-1 (KNOWN_ISSUES), L-M11 (SECURITY_STATUS), scrutiny P1-1. Under N instances the effective AI ceiling is N×budget and per-IP limits are per-instance. Code is Redis-pluggable; store failure fails closed (503). **Hard requirement before `max-instances > 1` on any platform.** Done when: shared Redis provisioned wherever the app next deploys; `REDIS_URL` set; documented as required.

### OF-08 (Medium) — No HSTS / HTTPS-redirect / security headers codified on the SPA (PHI) origin
- **Aliases**: OMH-M02 (06-21), OMH-M01 (06-20), L-M16 (SECURITY_STATUS), scrutiny P1-8. **Absorbs OF-20 (staging bucket plaintext website) as of 2026-07-14** — both GCS-hosted SPA origins are out of service under this posture; the requirement survives platform choice. Done when: wherever the SPA is next hosted, HTTP→HTTPS redirect + HSTS (+ nosniff, frame-ancestors) response-header policy, asserted by a post-deploy smoke check.

### OF-12 (Medium; expect High at launch re-triage) — No breach-detection alerting or error-tracking SDK
- **Aliases**: scrutiny P0-8 + P2-2, GTM readiness. No Sentry/equivalent; no alerts on audit anomalies or repeated login failures; no named owner. A forensic substrate without detection does not reliably start an HBNR 60-day breach clock — that clock only matters once real users exist. Done when: error tracking in prod + alerting on audit/login anomalies + named owner + runbook section.

### OF-13 (Medium) — SendGrid BAA status unconfirmed; PHI-free email policy unverified
- **Aliases**: SECURITY_STATUS §6 BAA "TBD" row, scrutiny P0-7. SendGrid is not HIPAA-eligible by default; sandbox email is transactional to founder/test accounts only. Done when: SendGrid BAA confirmed **or** replaced **or** documented + tested PHI-free-templates policy.

### OF-15 (Low; product decision) — Upgrade button is a billing stub
- **Aliases**: L-1 (KNOWN_ISSUES), scrutiny P0-5. `src/components/settings/PlanSection.tsx` toasts "not available yet"; no Stripe in deps. Harmful only when non-founder eyes see the app; the billing-or-remove-CTA decision (P0-5) can be made any time. Done when: live checkout + webhooks, **or** the CTA is removed.

---

## Revision 2026-08-01 — findings added from the prompt-library refresh

Four findings were added (OF-24–OF-27) and two existing entries amended (OF-06, OF-07). None came
from new code — all four are pre-existing conditions surfaced by re-running the prompt library
against HEAD and by a full RLS policy inventory. Sources: `prompts/_drift-audit-2026-08-01.md`,
`security-reviews/44-token-revocation-review.md`.

| ID | Title | Severity | Note |
|---|---|---|---|
| OF-24 | Blocked/failed AI-guidance requests consume daily quota | Low (Medium with any real user) | The L-35 fix exists on the chat path and was never mirrored to guidance |
| OF-25 | `revoked_access_tokens` has no RLS UPDATE policy but is `upsert`ed | Low | Structural fact confirmed; runtime failure **unverified** |
| OF-26 | Two maintenance jobs UPDATE tables with no RLS UPDATE policy | Low (**High** at launch) | Potential irreversible PHI loss in biomarker consolidation |
| OF-27 | Plan gate issues six count queries per gated request | Low | Performance only |

**Theme worth naming:** OF-22 was not a one-off. Three more tables have the same shape — code
issues an UPDATE-flavored statement against a table whose RLS policy set omits UPDATE — and the
class is invisible in dev because dev connects as BYPASSRLS. The standing rule now recorded in
`DATA_MODEL.md` and `prompts/01-database-schema.md`: **every table that is row-locked or updated
needs an UPDATE policy, even if it looks like it is never `UPDATE`d — and review under the same DB
role production uses.**

---

## Re-triage disposition — 2026-07-14 sandbox posture

| ID | Was (2026-07-12) | Now | Why |
|---|---|---|---|
| OF-01 | **Critical**, Open | **High**, Open | Billing disabled suspends the APIs behind the key — not "exercisable now"; hazard is silent re-arm. Key deletion in IAM is a hard gate on any GCP return. |
| OF-03 | High, Open | **Low**, Open (sunset) | No production, no marketing; residue confined to a suspended, decaying instance. Close on confirmed instance deletion, then merge PR #227. |
| OF-04 | High, Open | **Dormant (High)** | Takeover exposure requires users. Recommended sandbox build item. |
| OF-05 | High, Open | **Dormant (High if enabled multi-instance)** | Needs a multi-instance deploy to be broken; feature off by default. |
| OF-06 | Medium, Accepted | **Low**, Accepted | Overshoot needs concurrent third-party traffic. Trigger unchanged: High + launch blocker when billing ships. |
| OF-07 | Medium, Open | **Dormant (Medium)** | Per-process stores are correct single-process; required before `max-instances > 1` anywhere. |
| OF-08 | Medium, Open | **Dormant (Medium)**, absorbs OF-20 | No deployed SPA origin exists. |
| OF-09 | Medium, Accepted | **Low**, Accepted | DB outage + fresh revocation + attacker-held token ≈ nil in sandbox. Re-rate at launch. |
| OF-10 | Medium, Open | **Low**, Open | Single-user XSS hardening; still valid code work. Re-rate Medium at launch. |
| OF-11 | Medium, In progress | **Closed 2026-07-14** | Workflow + root `.gitignore` landed (`8ec3989`); `backend/.gitignore` leak-shape patterns landed with this ledger revision. Scan-green criterion lives in OF-01. |
| OF-12 | Medium, Open | **Dormant (Medium; likely High at launch)** | Detection matters when there are users to breach. |
| OF-13 | Medium, Open | **Dormant (Medium)** | Vendor paperwork for real-user PHI email. |
| OF-14..OF-19, OF-21 | Low | **Low** (unchanged) | Environment-independent debt/accepted residuals; OF-20 merged into OF-08. |
| OF-15 | Low, Open | **Dormant (Low; product decision)** | CTA honesty matters only with non-founder eyes. |
| OF-20 | Low, Open | **Merged into OF-08** | Staging GCS website out of service; requirement folded into the launch edge-config item. |
| OF-23 | — | **Medium**, Open (new) → **Closed same day** | Upload flows were dead in the sandbox: `storageService` was GCS-only with no local fallback. Fixed by the local encrypted backend — see Closed findings. |

## Legacy-ID crosswalk (2026-07-11 reconciliation — severities as of that date)

| Old ID (doc) | This ledger | Severity change (at 2026-07-11) |
|---|---|---|
| — (in no ledger; OMH-C01, 2026-06-21 assessment) | **OF-01** | **new Critical** |
| H-3 (KNOWN_ISSUES) / 🟡 controls note (SECURITY_STATUS) | OF-02 | High (STATUS had no numbered finding) — **CLOSED 2026-07-11**, `1047506` |
| L-3 (KNOWN_ISSUES) / L24 ops note (SECURITY_STATUS) | OF-03 | **Low → High** |
| — (in no ledger; scrutiny P0-4) | OF-04 | **new High** |
| H-2 (KNOWN_ISSUES) / L-39 (SECURITY_STATUS) | OF-05 | Low → High (KNOWN_ISSUES was right) |
| H-1 (KNOWN_ISSUES) / M-L34/L36 (SECURITY_STATUS) | OF-06 | **High → Medium** (conditional: High when billing ships) |
| M-1 (KNOWN_ISSUES) / L-M11 (SECURITY_STATUS) | OF-07 | Low → Medium |
| OMH-M02 (06-21) / OMH-M01 (06-20) / L-M16 (SECURITY_STATUS) | OF-08 | Low → Medium |
| M-3 (KNOWN_ISSUES) | OF-09 | unchanged Medium |
| M-4 (KNOWN_ISSUES) | OF-10 | unchanged Medium |
| OMH-M01 (06-21) | OF-11 | new Medium (fix in progress) |
| — (scrutiny P0-8/P2-2) | OF-12 | **new Medium** |
| — (SECURITY_STATUS BAA "TBD"; scrutiny P0-7) | OF-13 | new Medium |
| M-2 (KNOWN_ISSUES) | OF-14 | Medium → Low |
| L-1, L-2, L-4 (KNOWN_ISSUES); L-13, L-40 (SECURITY_STATUS); OMH-L02 (06-21) | OF-15..20 | unchanged Low |
| M-5 (KNOWN_ISSUES) | OF-21 | Medium → Low |

## Closed findings

### OF-23 — File upload hard-depended on GCS; upload flows nonfunctional in the GCP-less sandbox (CLOSED 2026-07-14)
- **Was**: Medium · availability / product (sandbox ops) · opened earlier the same day by the sandbox re-triage
- **Closed by**: the commit landing this ledger revision (branch `feat/local-storage-backend-2026-07-14`) — `storageService.ts` became a backend-selecting façade over `services/storage/` (`gcsBackend.ts` = the GCS code moved intact; `localBackend.ts` = AES-256-GCM-encrypted blobs under `backend/.local-storage`, sealed with the master PHI key in an `OMHL | version | iv(16) | tag(16) | ciphertext` envelope; tmp+rename writes; storage-key shape + containment validation). `STORAGE_BACKEND=local|gcs`, dev default `local`; **production/staging refuse `local` at boot** — ephemeral deployed disks must not hold PHI files. Zero caller churn.
- **Verification (2026-07-14, no GCP credentials, server under the NOBYPASSRLS `omh_app` role)**: SBC upload via the regex fallback → encrypted `OMHL` blob on disk (0 plaintext hits for the plan name; size = plaintext + 37) → byte-identical download (matching SHA-256) → unauthenticated download 401 → tampered-blob probe detected (server-side GCM stream error logged) → delete removes the blob (re-download 404, re-delete 404 — idempotent). Plus 17 unit/guard tests; backend suite 745 green.
- **Residuals**: (a) no Playwright UI upload spec yet — the verified journey is API-level; (b) the lab-report PDF route hard-requires `ANTHROPIC_API_KEY` (no regex fallback; SBC is the keyless upload path) — an AI-config dependency, not storage.

### OF-11 — CI secret scan was working-tree-only (CLOSED 2026-07-14)
- **Was**: Medium (Low after the 2026-07-14 re-triage) · detection · **Alias**: OMH-M01 (2026-06-21)
- **Fact**: `ci.yml` runs `gitleaks detect --no-git` (working tree only), so the OF-01 key in history passed the gate green, and the ignore patterns missed the leaked filename shape (`*.json.json`).
- **Closed by**: `8ec3989` (nightly full-history gitleaks workflow — `.github/workflows/secret-history-scan.yml`, daily 07:17 UTC + `workflow_dispatch`, full-clone scan with `.gitleaks.toml`; root `.gitignore` broadened) **+ the commit landing this ledger revision** (`backend/.gitignore` patterns closing the leaked shape: `*.json.json`, `gcp-*key*.json*`, `*serviceaccount*.json`).
- **Residual (by design)**: the nightly scan stays **red** until OF-01 closes — it is OF-01's regression guard (OF-01 done-when #4).

### OF-22 — Refresh-token rotation broken under enforced RLS (FOUND & FIXED 2026-07-12)
- **Was**: Critical · production availability + spurious mass session revocation · **Found by**: the e2e CI job's first real run (PR #226) — the suite passed locally against a BYPASSRLS dev role and failed in CI against the NOBYPASSRLS role, i.e. the PRODUCTION posture.
- **Fact**: `sessions` had SELECT/INSERT/DELETE policies but no UPDATE policy. PostgreSQL applies UPDATE-policy checks to `SELECT … FOR UPDATE` row locks, so under FORCE RLS the refresh-rotation lock in `authService.refreshTokens()` saw ZERO rows. Confirmed with psql as `omh_app`: plain SELECT sees the session row, `FOR UPDATE` returns nothing.
- **Impact**: since the omh_app NOBYPASSRLS cutover, every production token refresh (a) 401'd — logging the user out when the 15-minute access token expired — and (b) was misclassified as token REUSE, firing the M-1 compromise detector: `revokeAllUserTokens()` destroyed ALL the user's sessions and stamped `tokens_valid_after`, killing in-flight access tokens across devices.
- **Fix**: migration `20260712_add_sessions_update_policy` (+ two live-PG regression tests in `rls.test.ts` pinning the exact lock shape in admin and user contexts); companion frontend fix single-flights `authApi.refreshToken` so parallel boot refreshes (React StrictMode, multi-tab) can't race the single-use rotation.
- **Deploy note (updated 2026-07-14)**: moot under the sandbox posture — there is no live prod (billing disabled). The fix is on master and ships with any future deploy; the post-deploy verification step stands (log in, wait >15 min, confirm the session silently renews).

### OF-02 — Document AI OCR spend has no dollar cap (CLOSED 2026-07-11)
- **Was**: High · cost governance · **Aliases**: H-3 (KNOWN_ISSUES), "Document AI dollar accounting 🟡" (SECURITY_STATUS §5), scrutiny P0-2
- **Closing commit**: `1047506` — `trackDocumentAIUsage()` accrues per-page OCR cost (`DOCUMENT_AI_COST_PER_PAGE_USD`, default $0.0015) into the same daily global + per-user accumulator as Claude spend, recorded the moment Google returns; the existing `aiSpendGuard` 503 fail-closed gate on every OCR entry route now bounds OCR dollars too.
- **Verification**: tests prove OCR spend trips the global cap (refuse, scope `global`), trips the per-user cap without blocking other users, and small jobs accrue without blocking (`backend/src/services/aiCostTracker.test.ts`); backend tsc clean.
- **Residual**: the accumulator remains per-process without `REDIS_URL` — that ceiling-inflation is OF-07 (now dormant).

## Closed since the fb2cd32 ledgers (for the avoidance of doubt)

| Finding | Closed by |
|---|---|
| OMH-L02 2026-06-20 (dompurify range) | `0dadd8d` + lockfile fix `762ce62` |
| OMH-L03 2026-06-20 (staging deploy not CI-gated) | `0dadd8d` (`needs: [ci, build-and-deploy]`) |
| OMH-L04 2026-06-20 (no consent at registration) | `0dadd8d` (+ migration `20260620_add_registration_consent`) |
| OMH-L05 2026-06-20 (sub-processors undisclosed) | `0dadd8d` (/privacy + /terms pages, DRAFT copy) |
| OMH-I01 2026-06-20 (no-Origin CORS) | Accepted + documented in `0dadd8d` |
| OMH-L03 2026-06-21 (consent not validated at API boundary) | `0456c50` — `schemas.auth.register` requires `acceptedTerms: z.literal(true)` |

---

## Ledger protocol

1. **Add** a finding here first (next OF-nn), then link from other docs. Never assign a severity anywhere else.
2. **Close** by moving the entry to a dated "Closed" section with the closing commit and verification evidence; update the counts in the header.
3. **Accepted** findings must carry a written re-evaluation trigger — "accepted" without a trigger is not a status.
4. Any doc refresh that touches security posture must reconcile against this file at generation time and cite its **Last updated** date.
5. **Posture changes** (deploy target, user base, cloud provider) get a dated §Posture entry plus a full old→new disposition table; **Dormant** items must each carry a reactivation severity, and the global reactivation triggers must be stated in §Posture. The header names the active posture.
