# OPEN_FINDINGS.md — Single Authoritative Open-Findings Ledger

> **Reader contract**: this is the ONE list of open security / compliance / cost / trust findings for OwnMyHealth.
> Every other document (`SECURITY_STATUS.md`, `KNOWN_ISSUES.md`, security reviews, GTM readiness) **links here and must not restate severities**. If another doc disagrees with this ledger, this ledger wins and the other doc is stale.
>
> Created 2026-07-11 to close scrutiny finding **P0-6** (severity ledgers contradicted each other: `SECURITY_STATUS.md` claimed 0 open High while `KNOWN_ISSUES.md` listed H-1/H-2/H-3; the 2026-06-21 assessment's Critical appeared in neither).

| Field | Value |
|---|---|
| **Last updated** | 2026-07-11 |
| **Code state** | HEAD `762ce62` + working tree (uncommitted OMH-L03 consent validation + `secret-history-scan.yml`) |
| **Sources reconciled** | `SECURITY_STATUS.md` (fb2cd32), `KNOWN_ISSUES.md` (fb2cd32), `security/assessment-2026-06-20/`, `security/assessment-2026-06-21/`, `analysis/codebase-scrutiny-2026-07/` |
| **Open counts** | **1 Critical · 3 High · 8 Medium · 8 Low** (20 open; OF-02 closed 2026-07-11) |

---

## Severity rubric (the ONE rubric)

Severity = worst realistic impact × exposure, on a single scale regardless of class (security, cost, availability, compliance, product trust). A cost-DoS or compliance gap can be High; "not a classic vuln" is not a reason to downgrade.

| Severity | Meaning |
|---|---|
| **Critical** | PHI exposure or credential-compromise path exercisable **now** |
| **High** | Material harm likely if the product launches / is marketed as-is (uncapped spend, prod PHI residue, trivial account takeover, core feature broken under normal ops) |
| **Medium** | Harmful under specific conditions; accepted races with backstops; missing detection |
| **Low** | Hardening, documented-accepted residuals, tech debt |

Status values: **Open** · **In progress** (fix drafted/uncommitted) · **Accepted** (with a written re-evaluation trigger) · **External-ops** (action lives outside the repo — GCP console, vendor paperwork).

---

## Critical

### OF-01 — Production GCP service-account private key recoverable from git history
- **Class**: security / compliance · **Status**: Open (External-ops + repo work) · **Alias**: OMH-C01 (assessment 2026-06-21)
- **Fact**: commit `202f2dd` (2026-01-07) committed `backend/gcp-ocr-key.json.json` containing the real private key for `ocr-service@ownmyhealth-prod.iam.gserviceaccount.com`. It was removed from HEAD ~37s later (`528d5f9`) but **`git show 202f2dd:backend/gcp-ocr-key.json.json` still returns the full key — re-verified 2026-07-11**. Anyone with repo read access (clone, fork, CI cache, backup) can recover it.
- **Why Critical**: if the key has not been revoked in GCP IAM, it authenticates as a prod service account with Document AI (and possibly GCS/PHI-bucket) access. Key-rotation status is **unverified** — treat as live until proven dead.
- **Done when** (all four):
  1. Key id `109ec48bab8a95f27168f8d6e406ce28ac4794bc` deleted/disabled in GCP IAM (prefer switching OCR to Workload Identity so no JSON key exists) — **external, GCP console**;
  2. Cloud Logging / GCS access logs audited for use of the key since 2026-01-07;
  3. History purged (`git filter-repo` / BFG + force-push) **or** a dated determination recorded here that the key is dead and the historical copy inert;
  4. Nightly full-history gitleaks scan (OF-11) committed and green (it will correctly fail until 1–3 land).
- **Owner**: founder (GCP console + repo).

---

## High

### OF-03 — Legacy plaintext filenames still in production rows
- **Class**: compliance / ops · **Status**: Open (External-ops) · **Aliases**: L-3 (KNOWN_ISSUES — was rated Low), L24 ops follow-up (SECURITY_STATUS §3), scrutiny P0-1
- **Fact**: new uploads encrypt `user_files.original_filename`; legacy prod rows remain plaintext until the `backfill-userfile-filenames` maintenance job runs (DRY RUN → `--apply`) and a DROP migration lands. Re-verified 2026-07-11: latest migration is `20260620_add_registration_consent` — no drop migration exists.
- **Why High** (raised from Low): this is known plaintext PHI residue in production while docs and marketing say "encrypted at rest" — a compliance/honesty exposure, not a minor annoyance.
- **Done when**: prod dry-run → apply completed; DROP migration applied; run evidence recorded in `RUNBOOK.md`.

### OF-04 — No MFA
- **Class**: product security · **Status**: Open · **Aliases**: scrutiny P0-4, GTM readiness checklist (absent from both prior ledgers)
- **Fact**: no TOTP/second-factor library exists in backend dependencies (re-verified 2026-07-11). Auth is password + lockout + email reset.
- **Why High**: a medical record is a high-value account; account takeover via credential stuffing/phishing is the simplest PHI-exposure path and MFA is the standard consumer mitigation.
- **Done when**: optional TOTP + recovery codes shipped; enforced on sensitive operations; recovery flow tested.

### OF-05 — FHIR PKCE verifier store is per-process (connect fails under autoscale)
- **Class**: availability (feature-scoped) · **Status**: Open — deferred into Redis work · **Aliases**: H-2 (KNOWN_ISSUES), L-39 (SECURITY_STATUS), scrutiny P1-2
- **Fact**: PKCE `code_verifier` Map is per-process (`backend/src/services/fhir/smartAuth.ts:374` — "SHARED STORE REQUIRED", re-verified 2026-07-11); a callback routed to a different Cloud Run instance drops the connect. Availability, not forgeable state.
- **Mitigations**: feature off by default (`QUEST_FHIR_CLIENT_ID` empty → disabled); pin `--max-instances=1` while enabled.
- **Why High**: the feature is structurally broken under the platform's default scaling model; it must not be marketed or enabled multi-instance until fixed.
- **Done when**: shared Redis/Memorystore verifier store (ships with OF-07's Redis provisioning); multi-instance OAuth verified.

---

## Medium

### OF-06 — Plan-limit / AI-quota TOCTOU race (count-then-allow)
- **Class**: correctness · **Status**: Accepted (re-eval trigger below) · **Aliases**: H-1 (KNOWN_ISSUES — was High), M-L34/L36 (SECURITY_STATUS — was Medium), scrutiny P1-7
- **Fact**: `checkPlanLimit` is read-only; the caller writes later, so N concurrent requests can overshoot a finite limit by N−1 (`backend/src/services/usageTracker.ts:179` KNOWN RACE comment, re-verified 2026-07-11). Highest-cost path backstopped by the fail-closed dollar `aiSpendGuard`.
- **Severity resolution**: **Medium while billing is not live** (overshooting a free-tier count has bounded blast radius behind the dollar cap). **Automatically becomes High the day plan limits guard paid entitlements** — atomic reservation (`UPDATE … WHERE n < :limit RETURNING n` inside `withRLSTransaction`) is a launch prerequisite for billing (scrutiny P0-5).
- **Re-eval trigger**: observed abuse, or billing/hard plan-limit SLA ships.

### OF-07 — Rate-limit + AI-spend stores are per-process without `REDIS_URL`
- **Class**: cost / abuse control · **Status**: Open (External-ops: provision Memorystore) · **Aliases**: M-1 (KNOWN_ISSUES), L-M11 (SECURITY_STATUS — was Low), scrutiny P1-1
- **Fact**: default `InMemorySpendStore` / per-instance rate limits; under N instances the effective AI ceiling is N×budget and per-IP limits are per-instance (`backend/src/services/aiCostTracker.ts`, `backend/src/middleware/rateLimitStore.ts`). Code is Redis-pluggable; store failure fails closed (503).
- **Done when**: Redis/Memorystore provisioned, `REDIS_URL` set in staging + prod, documented as **required** before `max-instances > 1`.

### OF-08 — No HSTS / HTTPS-redirect codified on the SPA (PHI) origin
- **Class**: transit security · **Status**: Open (External-ops: LB/CDN config) · **Aliases**: OMH-M02 (2026-06-21), OMH-M01 (2026-06-20), L-M16 (SECURITY_STATUS — was Low), scrutiny P1-8
- **Fact**: SPA deploy is a plain `gsutil rsync` to a bucket; HSTS/redirect exist only as a manual runbook step (`DEPLOY.md`), leaving an SSL-strip window on first navigation. API origin has Helmet; frontend origin does not.
- **Done when**: HTTPS LB/CDN with HTTP→HTTPS redirect + HSTS (+ nosniff, frame-ancestors) response-header policy, asserted by a post-deploy smoke check.

### OF-09 — Access-token staleness check fails OPEN on DB error
- **Class**: security (fail-open) · **Status**: Accepted (availability trade-off) · **Alias**: M-3 (KNOWN_ISSUES)
- **Fact**: `isAccessTokenStale` returns `false` if the revocation-cutoff read throws (`backend/src/services/authService.ts` fail-open branch); a just-revoked token could be accepted during a DB outage. Bounded by 15-min access-token lifetime + 15s cache TTL.
- **Re-eval trigger**: any real incident involving revocation, or a move to sessions with longer lifetimes.

### OF-10 — CSP allows `'unsafe-inline'` styles
- **Class**: hardening · **Status**: Open · **Aliases**: M-4 (KNOWN_ISSUES), scrutiny P2-6
- **Fact**: `styleSrc: ["'self'", "'unsafe-inline'"]` with `TODO(csp-nonce)` (`backend/src/app.ts:130`); Tailwind + third-party runtime style injection block a nonce CSP today.
- **Done when**: nonce-based CSP migration; `'unsafe-inline'` removed.

### OF-11 — CI secret scan is working-tree-only (history leaks invisible)
- **Class**: detection · **Status**: **In progress** — `.github/workflows/secret-history-scan.yml` drafted (untracked, nightly full-history gitleaks) · **Alias**: OMH-M01 (2026-06-21)
- **Fact**: `ci.yml` runs `gitleaks detect --no-git`, so the OF-01 key in history passes the gate green; `.gitignore` patterns also miss the leaked filename shape (`*.json.json`).
- **Done when**: workflow committed and running nightly; `.gitignore` tightened (`*key*.json`, `gcp-*.json`); scan goes green after OF-01 closes (it is the regression guard).

### OF-12 — No breach-detection alerting or error-tracking SDK
- **Class**: detection / ops · **Status**: Open · **Aliases**: scrutiny P0-8 + P2-2, GTM readiness (absent from both prior ledgers)
- **Fact**: no Sentry/equivalent in any `package.json` (re-verified 2026-07-11); no alerts on audit anomalies or repeated login failures; no named owner. A forensic substrate (audit logs) without detection does not reliably start an HBNR 60-day breach clock.
- **Done when**: error tracking in prod + alerting on audit/login anomalies + named owner + runbook section.

### OF-13 — SendGrid BAA status unconfirmed; PHI-free email policy unverified
- **Class**: compliance · **Status**: Open (External-ops: vendor paperwork) · **Aliases**: SECURITY_STATUS §6 BAA inventory "TBD" row, scrutiny P0-7
- **Fact**: SendGrid is not HIPAA-eligible by default; email today is transactional (verification/reset links), but no gate verifies templates stay PHI-free.
- **Done when**: SendGrid BAA confirmed **or** SendGrid replaced **or** a documented + tested PHI-free-templates policy in place.

---

## Low

### OF-14 — In-memory access-token blacklist is per-process
- **Status**: Accepted · **Alias**: M-2 (KNOWN_ISSUES — was Medium). Largely closed by DB-backed `tokens_valid_after` + `revoked_access_tokens` checked on every replica; only the redundant in-memory map is per-process.

### OF-15 — Upgrade button is a billing stub
- **Class**: product honesty · **Status**: Open (product decision) · **Aliases**: L-1 (KNOWN_ISSUES), scrutiny P0-5. `src/components/settings/PlanSection.tsx` toasts "not available yet"; no Stripe in dependencies (re-verified 2026-07-11). **Done when**: live checkout + webhooks, **or** the CTA is removed.

### OF-16 — PBKDF2 iteration try-both fallback (no per-ciphertext KDF metadata)
- **Status**: Open (debt) · **Aliases**: L-2 (KNOWN_ISSUES), scrutiny P2-7. `TODO(key-rotation)` at `backend/src/services/encryption.ts:80`. **Done when**: KDF params stored per row/user; full re-encrypt; fallback removed.

### OF-17 — `pdf-parse@1.1.1` unmaintained on the PHI ingestion path
- **Status**: Accepted (documented decision) · **Aliases**: L-4 (KNOWN_ISSUES), OMH-L01 (2026-06-21). Exact-pinned, pure-JS, wrapped in `secureParsePdf()` guards. **Re-eval trigger**: a CVE against `pdf-parse`, or a verified `pdfjs-dist` text-only migration on Cloud Run.

### OF-18 — FHIR sync has no page/byte budget
- **Status**: Accepted · **Alias**: L-13 (SECURITY_STATUS). Count-based `sensitiveLimiter` only; one authorized sync can page unboundedly. **Done when**: page/byte budget in `labSyncService.syncLabResults`.

### OF-19 — SSRF allowlist validates host, not resolved IP (DNS-rebind residual)
- **Status**: Accepted · **Alias**: L-40 (SECURITY_STATUS). Trusted hosts are operator-configured, not user input.

### OF-20 — Staging SPA served via plaintext GCS website config
- **Status**: Open (External-ops) · **Alias**: OMH-L02 (2026-06-21). Public bucket, no HTTPS LB on staging. Folds into OF-08's edge work.

### OF-21 — Transitive npm advisories: 1 high (hono) + 8 moderate (uuid chain)
- **Status**: Accepted / deferred majors · **Aliases**: M-5 (KNOWN_ISSUES — was Medium), OMH-I01/I02. `hono` advisories are Lambda/Windows-static specific (app is Express on Cloud Run); `uuid` fix is gated on a breaking `@google-cloud/storage` major. Rated Low because none are reachable in the deployed stack.

---

## Legacy-ID crosswalk

| Old ID (doc) | This ledger | Severity change |
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

### OF-22 — Refresh-token rotation broken under enforced RLS (FOUND & FIXED 2026-07-12)
- **Was**: Critical · production availability + spurious mass session revocation · **Found by**: the e2e CI job's first real run (PR #226) — the suite passed locally against a BYPASSRLS dev role and failed in CI against the NOBYPASSRLS role, i.e. the PRODUCTION posture.
- **Fact**: `sessions` had SELECT/INSERT/DELETE policies but no UPDATE policy. PostgreSQL applies UPDATE-policy checks to `SELECT … FOR UPDATE` row locks, so under FORCE RLS the refresh-rotation lock in `authService.refreshTokens()` saw ZERO rows. Confirmed with psql as `omh_app`: plain SELECT sees the session row, `FOR UPDATE` returns nothing.
- **Impact**: since the omh_app NOBYPASSRLS cutover, every production token refresh (a) 401'd — logging the user out when the 15-minute access token expired — and (b) was misclassified as token REUSE, firing the M-1 compromise detector: `revokeAllUserTokens()` destroyed ALL the user's sessions and stamped `tokens_valid_after`, killing in-flight access tokens across devices.
- **Fix**: migration `20260712_add_sessions_update_policy` (+ two live-PG regression tests in `rls.test.ts` pinning the exact lock shape in admin and user contexts); companion frontend fix single-flights `authApi.refreshToken` so parallel boot refreshes (React StrictMode, multi-tab) can't race the single-use rotation.
- **Deploy note**: prod carries this bug until the next successful deploy (currently blocked on GCP billing). Verify post-deploy: log in, wait >15 min, confirm the session silently renews.

### OF-02 — Document AI OCR spend has no dollar cap (CLOSED 2026-07-11)
- **Was**: High · cost governance · **Aliases**: H-3 (KNOWN_ISSUES), "Document AI dollar accounting 🟡" (SECURITY_STATUS §5), scrutiny P0-2
- **Closing commit**: `1047506` — `trackDocumentAIUsage()` accrues per-page OCR cost (`DOCUMENT_AI_COST_PER_PAGE_USD`, default $0.0015) into the same daily global + per-user accumulator as Claude spend, recorded the moment Google returns; the existing `aiSpendGuard` 503 fail-closed gate on every OCR entry route now bounds OCR dollars too.
- **Verification**: tests prove OCR spend trips the global cap (refuse, scope `global`), trips the per-user cap without blocking other users, and small jobs accrue without blocking (`backend/src/services/aiCostTracker.test.ts`); backend tsc clean.
- **Residual**: the accumulator remains per-process without `REDIS_URL` — that ceiling-inflation is OF-07, unchanged.

## Closed since the fb2cd32 ledgers (for the avoidance of doubt)

| Finding | Closed by |
|---|---|
| OMH-L02 2026-06-20 (dompurify range) | `0dadd8d` + lockfile fix `762ce62` |
| OMH-L03 2026-06-20 (staging deploy not CI-gated) | `0dadd8d` (`needs: [ci, build-and-deploy]`) |
| OMH-L04 2026-06-20 (no consent at registration) | `0dadd8d` (+ migration `20260620_add_registration_consent`) |
| OMH-L05 2026-06-20 (sub-processors undisclosed) | `0dadd8d` (/privacy + /terms pages, DRAFT copy) |
| OMH-I01 2026-06-20 (no-Origin CORS) | Accepted + documented in `0dadd8d` |
| OMH-L03 2026-06-21 (consent not validated at API boundary) | **Working tree (uncommitted)** — `schemas.auth.register` now requires `acceptedTerms: z.literal(true)` |

---

## Ledger protocol

1. **Add** a finding here first (next OF-nn), then link from other docs. Never assign a severity anywhere else.
2. **Close** by moving the entry to a dated "Closed" section with the closing commit and verification evidence; update the counts in the header.
3. **Accepted** findings must carry a written re-evaluation trigger — "accepted" without a trigger is not a status.
4. Any doc refresh that touches security posture must reconcile against this file at generation time and cite its **Last updated** date.
