# OPEN_FINDINGS.md — Single Authoritative Open-Findings Ledger

> **Reader contract**: this is the ONE list of open security / compliance / cost / trust findings for OwnMyHealth.
> Every other document (`SECURITY_STATUS.md`, `KNOWN_ISSUES.md`, security reviews, GTM readiness) **links here and must not restate severities**. If another doc disagrees with this ledger, this ledger wins and the other doc is stale.
>
> Created 2026-07-11 to close scrutiny finding **P0-6** (severity ledgers contradicted each other: `SECURITY_STATUS.md` claimed 0 open High while `KNOWN_ISSUES.md` listed H-1/H-2/H-3; the 2026-06-21 assessment's Critical appeared in neither).
>
> Severities are posture-dependent (impact × exposure under the **current posture** — see §Posture). Re-triaged 2026-07-14 for the sandbox posture; the full old→new disposition is in §Re-triage disposition.

| Field | Value |
|---|---|
| **Last updated** | 2026-07-14 (sandbox-posture re-triage) |
| **Posture** | **Sandbox — no GCP** (see §Posture) |
| **Code state** | master `f57061e` (PR #228 merged) + branch `feat/local-storage-backend-2026-07-14` (OF-23 fix + this ledger revision); docs reorg still uncommitted in the working tree |
| **Sources reconciled** | This ledger @ `2656a82`; founder posture decision (2026-07-14 session); repo re-verification 2026-07-14 (OF-01 blob presence via `git cat-file -e`, commits `8ec3989`/`0456c50`, migrations through `20260712`, PR #227 state) |
| **Open counts** | **Live: 0 Critical · 1 High · 0 Medium · 10 Low** (11 items; 7 Lows Accepted-with-trigger) **· Dormant (launch checklist): 7** · OF-20 merged into OF-08 · OF-11 & OF-23 closed 2026-07-14 |

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

---

## Dormant — launch checklist (not current risks; reactivation severity in parentheses)

These items were open operational risks under the deployed-on-GCP posture. Under the sandbox posture they have no exposure surface. **They reopen automatically at the listed severity on any global reactivation trigger** (§Posture). Platform-specific wording is generalized — the next deploy may not be GCP.

### OF-04 (High) — No MFA
- **Aliases**: scrutiny P0-4, GTM readiness. No TOTP/second-factor library in backend deps. A medical record is a high-value account; MFA is the standard consumer mitigation for the simplest takeover path. **Pure code, no cloud dependency — recommended sandbox-era build.** Done when: optional TOTP + recovery codes; enforced on sensitive operations; recovery flow tested.

### OF-05 (High, if FHIR is enabled multi-instance) — FHIR PKCE verifier store is per-process
- **Aliases**: H-2 (KNOWN_ISSUES), L-39 (SECURITY_STATUS), scrutiny P1-2. PKCE `code_verifier` Map is per-process (`backend/src/services/fhir/smartAuth.ts` — "SHARED STORE REQUIRED"); a callback routed to a different instance drops the connect. Feature off by default; single-process sandbox unaffected. Ships with OF-07's shared-store work. Done when: shared verifier store; multi-instance OAuth verified.

### OF-07 (Medium) — Rate-limit + AI-spend stores are per-process without `REDIS_URL`
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
