# SECURITY_STATUS.md — OwnMyHealth Current Security Posture

> **Reader contract**: this is the current-state security posture reference (not a history log). A Claude Project reader with only this doc + its siblings can answer "what's open? what's critical? what's the plan?" Every non-trivial code claim cites `file:line`. Generated per [`prompts/21-security-status-doc.md`](../prompts/21-security-status-doc.md) against live code.

| Field | Value |
|---|---|
| **Last updated** | 2026-08-01 (ISO) — controls re-verified; severities owned by the ledger |
| **Code state** | `master` @ `12b45ae` (controls tables re-verified 2026-08-01; previously `fb2cd32`) |
| **Last audit** | 2026-06-13 full 16-dimension multi-agent teardown (per [`prompts/24-full-security-audit.md`](../prompts/24-full-security-audit.md) orchestration) + 2026-06-15 security long-tail remediation cycle |
| **Audit tool** | Multi-agent static review (105 agents, per-finding adversarial verification) + hands-on live-PG pentest (throwaway Docker Postgres 16) |
| **Security grade** | ~~B+ → A-~~ **Superseded** — the 2026-06-21 assessment graded **D** on discovery of OF-01 (prod key in git history, unremediated). The A- reflects the *engineering core* (encryption/RLS/auth), which remains strong; the open-findings picture is owned by [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md) (1 C / 3 H / 8 M / 8 L at 2026-07-11) |
| **Production deploy** | **None — suspended.** GCP billing disabled ~2026-07-12; no deployment target (see Posture below). The CI-gated pipeline (`needs: ci`, [`deploy.yml`](#infrastructure--deploy)) and migrate-as-a-job model remain the *launch* design |
| **Posture** | **Sandbox — no GCP**, declared 2026-07-14. No real users; founder/test data only. See [`OPEN_FINDINGS.md` §Posture](./OPEN_FINDINGS.md) |

> **⚠️ SEVERITY IS NOT OWNED BY THIS DOCUMENT (updated 2026-08-01).** [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md) is the single authoritative findings ledger and the single severity rubric. This document describes **controls** — what exists, where, and how it is verified. Any open-count or severity claim below is stale by construction; go to the ledger. Current ledger state (2026-07-14 sandbox re-triage): **Live: 0 Critical · 1 High · 0 Medium · 10 Low** (11 items; 7 Lows Accepted-with-trigger) **· Dormant (launch checklist): 7**. The earlier "0 open Critical / 0 open High" language in this doc reflects an fb2cd32-era rubric and predates the 2026-06-21 assessment that found **OF-01** (production GCP service-account key recoverable from git history — still open, now graded High under the sandbox posture because billing is disabled; it re-arms the instant billing returns). Legacy-ID crosswalk (this doc's L-39 / L-M11 / L34-L36 → OF-05 / OF-07 / OF-06) lives in the ledger. The controls tables in §5 were re-verified at `12b45ae` on 2026-08-01 and remain accurate.
>
> **Why this rule exists:** this document claiming "0 open High" while `KNOWN_ISSUES.md` listed H-1/H-2/H-3 *was* scrutiny finding **P0-6**. The fix was to make one document authoritative, not to re-synchronize two.

---

## 1. Posture summary

This cycle (HEAD `fb2cd32`) closed the entire security long-tail from the 2026-06-13 teardown plus the 2026-06-12 pentest. The theme since 2026-06-01 was **closing "designed-but-unwired" seams** — cross-instance token revocation, FORCE RLS, PHI-field expansion, and DB-enforced audit retention are all now wired and verified.

*(fb2cd32 cycle counts under the old rubric — superseded; current counts are in [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md))*

| Severity | Open | Closed this cycle | Total discovered (this + prior cycles) |
|---|---|---|---|
| Critical | 0 | 0 | 2 (C-7 PHI-to-Claude/BAA + C-8 BYPASSRLS, both closed — see [§4](#4-closed-in-current-cycle)) |
| High | 0 | 2 | 26 (24 from 2026-06-13 teardown were M/L; 2 Highs = biomarker-no-time-series + deploy-not-gated, both closed) |
| Medium | 2 (documented-accepted) | ~14 | ~63 |
| Low | ~5 (infra-only) | ~20 | ~55 |
| Info | 0 | — | 12 |

**One-line state (fb2cd32 rubric — SUPERSEDED, see notice above)**: this doc's cycle-scoped count was 0 open Critical/High with 2 accepted Medium races (L34/L36) + ~5 infra Low. Under the unified rubric in [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md) — which counts cost-governance, compliance-residue, and product-security gaps on the same scale and includes the post-fb2cd32 2026-06-21 assessment — the honest posture is:

```
Posture at 2026-07-11 (per OPEN_FINDINGS.md — authoritative)
┌────────────────────────────────────────────────────────────────┐
│  Critical: 1 open   OF-01 prod GCP key in git history           │
│  High:     3 open   plaintext filename residue · no MFA ·       │
│                     FHIR PKCE per-process                       │
│  Medium:   8 open   incl. TOCTOU (accepted), Redis, HSTS,       │
│                     breach detection, SendGrid BAA              │
│  Low:      8 open   accepted residuals + debt                   │
│  Closed:   OF-02 OCR $ cap (1047506, 2026-07-11)                │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Severity rubric (synthesized)

This doc synthesizes findings under the standard severity rubric ([`prompts/_review-protocol.md`](../prompts/_review-protocol.md)):

| Severity | Meaning | Example this cycle |
|---|---|---|
| **Critical** | Direct PHI exposure / auth bypass exploitable remotely | C-8 BYPASSRLS (closed) |
| **High** | Core security/data-integrity feature structurally broken | biomarker time-series dead; deploy not test-gated (both closed) |
| **Medium** | Exploitable under specific conditions; defense-in-depth gap | L34/L36 quota TOCTOU (open, accepted); audit-metadata plaintext (closed) |
| **Low** | Hardening / least-privilege / observability gap | login-enum oracle, IPv6 rate-limit keygen (closed); Redis store (open, infra) |
| **Info** | No security impact; cleanup / documentation | dead `rbac.ts` authz cluster (removed) |

---

## 3. Open findings

> **Superseded** — the authoritative open set lives in [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md) (1 Critical / 3 High / 8 Medium / 8 Low at 2026-07-11). The entries below are kept as evidence detail for the findings this doc originally tracked; their severity labels are the old rubric's (crosswalk: L34/L36→OF-06 Medium-accepted, L-M11→OF-07 Medium, L-M16→OF-08 Medium, L-13→OF-18 Low, L-39→OF-05 **High**, L-40→OF-19 Low, L24 ops→OF-03 **High**). Findings this doc missed entirely: OF-01 (Critical, key in git history), OF-02 (was High, OCR $ — closed `1047506`), OF-04 (High, no MFA), OF-11/12/13 (Medium).

### M-L34/L36 — AI-quota / plan-limit TOCTOU race (Medium → documented & accepted)

- **Area**: domain / AI cost control + plan gating
- **Evidence**: Both the plan-limit gate and the AI-quota gate are **count-then-allow with no atomic reservation** spanning the gate and the route handler's write. The window is documented in code at `backend/src/services/usageTracker.ts:179-198`:

  ```ts
  // Source: backend/src/services/usageTracker.ts:183-184 (TOCTOU note)
  // The window is the gap between this checkPlanLimit read and the caller's
  // later write (audit row / userFile / biomarker insert). Two concurrent
  // requests can both read current = limit - 1, both pass, and both write.
  ```

  The plan-gating middleware re-reads the effective plan fresh from the DB under RLS (`backend/src/middleware/planGating.ts:66-72`) and fails CLOSED to FREE on DB error (`planGating.ts:76-88`), but the count check itself is not atomic (`planGating.ts:90-98`).
- **Impact**: A user issuing N concurrent requests can overshoot a finite plan limit (e.g. `pdfUploadsPerMonth`, `aiChatsPerDay`) or the per-user AI budget by up to N-1 before the counters catch up. Bounded by the global/per-user **dollar** spend-cap (`aiSpendGuard` → `admitAISpend`, 503 fail-closed; see [§5 AI integration](#ai-integration-controls)).
- **Why accepted (not fixing now)**: the codebase explicitly documents these as known races backstopped by the dollar circuit-breaker; the fix needs a quota-architecture change to atomic reservation (`UPDATE … WHERE n < :limit RETURNING n`), which is low value for a documented-accepted race. Two paths are already partially narrowed in-transaction: `maxBiomarkers` upload truncation (`backend/src/controllers/upload/shared.ts:206-231`) and `insurancePlans` activation count (`backend/src/controllers/insuranceController.ts:680-689`).
- **Remediation plan**: implement atomic usage reservation in the same RLS transaction as the usage write, or a DB constraint/trigger — see `usageTracker.ts:186-198`.
- **Owner**: backend (product call deferred)
- **ETA**: deferred — re-evaluate if abuse observed or if a hard plan-limit SLA is introduced.
- **Cross-link**: [`SECURITY_AUDIT_domain.md`](./SECURITY_AUDIT_domain.md), [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md).

### L-M11 — Per-process rate-limit + AI-spend store (Low → infra-only)

- **Area**: infrastructure
- **Evidence**: The AI spend accumulator defaults to an in-memory per-process store (`InMemorySpendStore`, `backend/src/services/aiCostTracker.ts:95`); shared atomic enforcement requires `REDIS_URL` to be set (`RedisSpendStore`, `aiCostTracker.ts:172`, selected by `getStore()` at `aiCostTracker.ts:257-274`). Same pattern for rate limiting: `getRedisClient()`/`RedisLike` in `backend/src/middleware/rateLimitStore.ts` provide a shared store only when `REDIS_URL` is configured. Documented at `backend/src/config/index.ts:250-254`.
- **Impact**: Under Cloud Run autoscale (N instances), the effective AI ceiling is N×budget and per-IP rate limits are per-instance — a higher-than-intended ceiling, not a bypass. The store **fails closed (503)** on a shared-store error so an outage never *uncaps* spend (`backend/src/middleware/aiSpendGuard.ts:42-51`).
- **Remediation plan**: provision Redis/Memorystore, set `REDIS_URL`. Code is already pluggable — no code change required.
- **Owner**: TBD (external: infra owner)
- **ETA**: TBD (external: provision Memorystore in GCP Console project ownmyhealth-prod)
- **Cross-link**: [`ENV_VARS.md#redis_url`](./ENV_VARS.md), [`RUNBOOK.md`](./RUNBOOK.md).

### L-M16 — SPA edge security headers (Low → infra-only)

- **Area**: infrastructure / frontend delivery
- **Evidence**: In-app clickjacking defense exists (frame-bust util + `src/utils/frameGuard.ts`), but the static SPA is served from a GCS bucket which does not emit `Content-Security-Policy` / `X-Frame-Options` / HSTS at the edge. Backend API responses already carry Helmet headers (middleware stack, [`CLAUDE.md`](../CLAUDE.md) "Middleware Stack" §1).
- **Impact**: defense-in-depth gap on the static asset origin only; the API origin is covered by Helmet.
- **Remediation plan**: add edge headers via Cloud CDN / load-balancer response-header policy (runbook exists per `recent-changes` digest "RLS / SPA edge headers (M16)").
- **Owner**: TBD (external: infra owner)
- **ETA**: TBD (external: configure GCS/Cloud-CDN response headers, GCP Console).
- **Cross-link**: [`RUNBOOK.md`](./RUNBOOK.md).

### L-13 — No outbound-spend circuit breaker on FHIR sync (Low → accepted residual)

- **Area**: periphery / Quest FHIR
- **Evidence**: FHIR sync mutation routes carry `csrfProtection`, `sensitiveLimiter` (10/hr, shared), `blockDemoAI`, and `requirePlanFeature('questFhirIntegration')` (`backend/src/routes/fhirRoutes.ts:30-72`), but there is **no dedicated per-sync outbound-spend breaker** — only the count-based `sensitiveLimiter` bounds request count, not pages fetched / tokens spent. Documented at `backend/src/routes/fhirRoutes.ts:43-53`.
- **Impact**: a single authorized sync can fetch unbounded FHIR pages; bounded by request count, not work. No PHI exposure.
- **Remediation plan**: add a page/byte budget to `labSyncService.syncLabResults`.
- **Owner**: backend (deferred)
- **ETA**: deferred — low risk (provider-rate-limited upstream, plan-gated).
- **Cross-link**: [`SECURITY_AUDIT_periphery.md`](./SECURITY_AUDIT_periphery.md).

### L-39 / L-40 — FHIR PKCE store multi-instance gap & DNS-rebind residual (Low → accepted)

- **Area**: periphery / Quest FHIR
- **Evidence**: PKCE verifier store is an in-memory per-process `Map` keyed by `state` (10-min TTL, delete-on-read), so a load-balanced callback to a different replica returns null and the connect flow fails intermittently — **availability**, not forgeable-state (`backend/src/services/fhir/smartAuth.ts:374-386`). Separately, the SSRF allowlist validates the URL *host*, not the resolved IP, so DNS rebinding of a trusted operator-configured host is not caught (`backend/src/services/fhir/urlSafety.ts:13-24`).
- **Impact**: L-39 is a dropped-callback availability issue (mitigation: pin `--max-instances=1` until a shared store exists). L-40 is knowingly accepted because trusted hosts are operator-configured, not user input.
- **Remediation plan**: L-39 → shared Redis store for PKCE verifiers (ships with L-M11 Redis work). L-40 → accepted.
- **Owner**: backend / infra
- **ETA**: deferred (folds into Redis provisioning).
- **Cross-link**: [`SECURITY_AUDIT_periphery.md`](./SECURITY_AUDIT_periphery.md).

### Open ops follow-up (not a finding — operational)

- **L24 re-encrypt backfill not yet run in prod.** New uploads encrypt `user_files.original_filename` at rest (`backend/src/services/encryption.ts:499`); reads fall back to the plaintext twin. Legacy prod rows are still plaintext until the `backfill-userfile-filenames` maintenance Cloud Run job is run (DRY RUN → `--apply`), followed by a migration to drop the plaintext column. Run via [`.github/workflows/maintenance.yml`](#infrastructure--deploy) → `ownmyhealth-maintenance` job. See [`RUNBOOK.md`](./RUNBOOK.md).

---

## 4. Closed in current cycle

The 2026-06-15 release (`release/security-ux-2026-06-15`, FF-merged to master `ee76212`, final deploy run **GREEN**) closed the security long-tail. C-8 closed in the prior (2026-06-12) cycle.

| Finding | Severity | Closing commit / PR | Date | Verification |
|---|---|---|---|---|
| **C-7** — PHI-to-Claude minimization / BAA enforcement | Critical | runtime BAA gate (`ANTHROPIC_BAA_ACTIVE`) + per-call re-check; M10 prompt-injection hardening | 2026-04-17 (BAA flip) / -06-15 (hardening) | Prod refuses to boot if `ANTHROPIC_API_KEY` set without `ANTHROPIC_BAA_ACTIVE=true` (`config/index.ts:381-394`); gate re-checked per-call in `biomarkerRoutes`/`aiChatController`/`claudeExtraction`/`sbcExtraction`/`expenseController`; document delimiting + `MAX_EXTRACTION_DOCUMENT_CHARS = 200_000` (`validation.ts`). **Residual**: Claude receives decrypted PHI by design (educational guidance); covered by the active BAA, not field-level minimization — see [§5 AI integration](#ai-integration-controls) |
| **C-8** — RLS not enforced under BYPASSRLS login | Critical | fix/teardown-blockers-2026-06-12 (`a9fb707`); FORCE-RLS in migration `20260613_force_rls_and_audit_retention` | 2026-06-12 / -13 | `assertNoBypassRLS()` prod hard-exit (`database.ts:247-253`) **+ NEW** `assertRLSForced()` prod hard-exit (`database.ts:299-306`); live-PG RLS regression job in CI ([§Infrastructure](#infrastructure--deploy)) |
| **H** — biomarker no time-series (trends structurally dead) | High | `biomarkerSeries.ts` (`upsertBiomarkerReading`) | 2026-06-14 | All create/bulk/FHIR paths append to one series (anchor=newest, history=older), outcomes `created/promoted/archived/corrected` (`backend/src/services/biomarkerSeries.ts:81-190`); `biomarkerSeries.test.ts` |
| **H** — deploy not gated on tests | High | `deploy.yml` `needs: ci` | 2026-06-14 | `deploy.yml:57-66` invokes `ci.yml` via `workflow_call`; lint+test+build+gitleaks+npm-audit+RLS regression must pass before build/stage |
| **M1** — single-device cross-instance logout | Medium | migration `20260613_revoked_access_tokens` | 2026-06-13 | `revoked_access_tokens` table + `revokeAccessTokenCrossInstance` (`authService.ts:358-394`); jti checked every request via `isAccessTokenStale` (`auth.ts:106-108`) |
| **M-1** (pentest) — refresh-reuse family not revoked | Medium | `revokeAllUserTokens` in reuse branch | 2026-06-13 | Reuse outside 10s grace → `revokeAllUserTokens(payload.id)` (`authService.ts:795-806`); live-PG pentest confirmed exploitable-then-fixed |
| **M-4** — cross-instance access-token cutoff | Medium | migration `20260606000002_add_tokens_valid_after` | 2026-06-06 | `users.tokens_valid_after` checked on every request on every replica (`auth.ts:106`); stamped by `revokeAllUserTokens` (`authService.ts:648-651`) |
| **M2/M19** — FORCE RLS + DB-enforced audit retention | Medium | migration `20260613_force_rls_and_audit_retention` | 2026-06-13 | FORCE RLS on all 19 tables; `audit_logs_delete` policy `USING (is_admin_session() AND created_at < now() - interval '7 years')`; live-PG RLS test |
| **M4** — health-goal numeric values plaintext | Medium | migration `20260613_encrypt_goal_values` | 2026-06-13 | `currentValueEncrypted`/`startValueEncrypted`/`targetValueEncrypted` + `GoalProgressHistory.valueEncrypted` in PHI_FIELDS (`encryption.ts:518-524`) |
| **M6** — audit-metadata plaintext column | Medium | migration `20260615_drop_legacy_audit_metadata` (irreversible DROP) | 2026-06-15 | `audit_logs.metadata` dropped; replaced by `metadataEncrypted` (`encryption.ts:530`); applied in prod via migrate job |
| **M7/F-18** — cookie Secure/SameSite derivation | Medium | unified resolution + boot invariant | 2026-06-15 | `secure` forced when SameSite=None or COOKIE_DOMAIN set, any tier (`config/index.ts:88-95,138-147`); `config.test.ts` covers all tiers |
| **L23/L40** — consent immutability + audit-insert WITH CHECK | Low | migration `20260615_provider_consent_immutable_audit_insert_check` | 2026-06-15 | BEFORE-UPDATE trigger restores consent booleans unless writer is patient/admin; `audit_logs_insert` tightened from `WITH CHECK (true)` to `user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL`; live-PG validated |
| **L24** — raw lab filename plaintext at rest | Low | migration `20260615_encrypt_userfile_original_filename` | 2026-06-15 | `user_files.original_filename_encrypted` + `decryptOriginalFilename` helper (`backend/src/utils/userFileNames.ts`); twin plaintext null on write; live-PG validated |
| **L21/L41/L37** — login lockout oracle, atomic audit, canEditData | Low | `security/login-oracle-audit-consent-2026-06-15` | 2026-06-15 | Lock/verified state revealed only after password verify; unknown-email dummy bcrypt + 0-50ms jitter (`authService.ts:1116-1132`) |
| **L26/L22** — CSRF cookie cleared on logout; dead token helpers removed | Low | `security/session-cookie-2026-06-15` | 2026-06-15 | `csrf_token` cleared on logout (`authController.ts:143-153`); legacy `generateToken`/`verifyToken` removed (`auth.ts:245-251`) |
| **L-1/L-2** — login-enum oracle, IPv6 rate-limit keygen | Low | `rateLimiter.ts` `ipKeyGenerator` (/64) + email+IP login key | 2026-06-15 | `rateLimiter.ts` uses `ipKeyGenerator`; login keyed by email+IP |
| **L28-L32** — upload/extraction guards | Low | `security/upload-extraction-guards-2026-06-15` | 2026-06-15 | `MAX_PDF_PAGES = 50` + `PdfPageLimitError` incl. OCR path (`backend/src/utils/securePdfParsing.ts:27,35,219-228`); WebP magic-byte check; biomarker numeric sanity |
| **L33/L42** — server-side AI disclaimer + fail-closed chat audit | Low | `backend/src/utils/aiDisclaimer.ts` | 2026-06-15 | `disclaimerToAppend()` appends canonical `AI_DISCLAIMER` unless model included one; applied in `aiChatController`/`biomarkerController` |
| **L-26** — dead `rbac.ts` parallel-authz cluster | Info | removed | 2026-06-13 | `rbac.ts` trimmed + tests removed; `pdfRedaction.ts` deleted (`pdf-lib` now unused) |
| **F-28** (prior) — boot guard requires GCS_BUCKET_NAME | (prod outage) | env var set + deploy rerun | 2026-06-12 | Prod must set `GCS_BUCKET_NAME` (`config/index.ts:480`); dev/staging fall back |

**Most-recent closed Critical verification (C-8)**: two independent boot hard-exits now make a BYPASSRLS or non-FORCE-RLS deployment unbootable in production — `assertNoBypassRLS()` (`backend/src/services/database.ts:247-253`) and `assertRLSForced()` (`backend/src/services/database.ts:299-306`), both `process.exit(1)` in prod — plus a CI RLS regression job that runs the tenant-isolation suite against a real Postgres 16 as a NOBYPASSRLS role on every commit ([§Infrastructure](#infrastructure--deploy)).

---

## 5. Controls status

Legend: ✅ verified in code at HEAD `fb2cd32` · 🟡 partial / documented gap · ⚠️ accepted residual / infra-pending.

### Auth controls

```
Request ──cookie: access_token──▶ authenticate (auth.ts:74)
                                       │
              ┌────────────────────────┼───────────────────────────┐
              ▼                        ▼                            ▼
   in-memory blacklist        isAccessTokenStale            req.user set
   (per-instance, auth.ts:90)  (cross-instance, auth.ts:106) (auth.ts:111)
                                       │
                    ┌──────────────────┴───────────────────┐
                    ▼                                       ▼
     users.tokens_valid_after cutoff          revoked_access_tokens jti set
     (logout-all / pwd / email change)        (single-device logout)
     stamped by revokeAllUserTokens           upsert by revokeAccessTokenCrossInstance
     (authService.ts:648-651)                 (authService.ts:358-394)
```

| Control | Status | Evidence | Notes |
|---|---|---|---|
| JWT access (15 min) + refresh (7 d) | ✅ | `config/index.ts:121,125`; payload `authService.ts:446-463` | HS256; access carries `jti` (M1) |
| DB-backed refresh sessions | ✅ | `authService.ts:521-532` | every refresh token = a `sessions` row keyed by `jti` |
| Refresh rotation single-use + atomic | ✅ | `authService.ts:730-744` | `SELECT … FOR UPDATE`, delete+reinsert in one `withRLSTransaction` |
| **Refresh-reuse full-family revocation (M-1)** | ✅ | `authService.ts:795-806` | reuse outside 10s grace → `revokeAllUserTokens`; benign double-tab race inside grace not revoked (`authService.ts:668-688`) |
| **Cross-instance cutoff `tokens_valid_after` (M-4)** | ✅ | `auth.ts:106-108`, `authService.ts:648-651`; migration `20260606000002_add_tokens_valid_after` | checked on every request, every replica; fails OPEN on DB error (`authService.ts:314-320`) |
| **Single-device cross-instance logout `revoked_access_tokens` (M1)** | ✅ | `authService.ts:358-394`; migration `20260613_revoked_access_tokens` | upsert guarded so a forged token can't seed rows for another user (`authService.ts:369`) |
| `revokeAllUserTokens` on logout-all / pwd change+reset / email change | ✅ | `authController.ts:519,608-622` | also stamps `tokensValidAfter` |
| `requireBearerAuth` for SSE `/ai/chat` | ✅ | `auth.ts:197-243` | closes "CSRF-exempt route still accepts cookie auth" hole |
| Login lockout (5 attempts / 30 min) | ✅ | `config/index.ts:157-158`; `authService.ts:856-915` | |
| Anti-enumeration (L21) | ✅ | `authService.ts:1116-1132` | dummy bcrypt + 0-50ms jitter on unknown email; lock state only after pwd verify |
| bcrypt rounds = 13 | ✅ | `config/index.ts:160` | password policy ≥12 + upper/lower/number/special (`authService.ts:417-437`) |

> **Note for older guidance**: the per-user `tokens_valid_after`, the `revoked_access_tokens` table, and refresh-reuse family revocation (`revokeAllUserTokens`) are first-class auth controls — they are **not** BYPASSRLS-adjacent. Older docs that only described the in-memory blacklist were missing cross-instance revocation.

### CSRF controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Stateless double-submit cookie | ✅ | `csrf.ts:43` | `csrf_token` cookie httpOnly:false (JS-readable); no server-side CSRF secret |
| Constant-time compare (length not leaked) | ✅ | `csrf.ts:172-183` | SHA-256 then `timingSafeEqual` |
| Strict exemption matching (M-2) | ✅ | `csrf.ts:100-156` | was suffix `endsWith` (bypassable via `/api/v1/evil/auth/login`); now strict `===` on normalized path |
| `/auth/refresh` no longer exempt (RT-Low) | ✅ | `csrf.ts:114-123` | SPA double-submits on refresh; cookie re-issued each refresh (`csrf.ts:47-51`) |
| Upload routes no longer exempt | ✅ | `csrf.ts:147-152` | |
| CSRF cookie cleared on logout (L26) | ✅ | `authController.ts:143-153` | maxAge tied to refresh lifetime, not fixed 24h |

### RBAC controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Role hierarchy PATIENT(1)/PROVIDER(2)/ADMIN(3) | ✅ | [`CLAUDE.md`](../CLAUDE.md) "Roles & Access Control"; `middleware/rbac.ts` | |
| Provider access choke point (M3/L35) | ✅ | `backend/src/services/providerAccess.ts` `resolveProviderAccess(tx, providerId, patientId, requiredFlag)` | replaced 4 drifted inline copies; routes now require the flag arg |
| Self-role-elevation prevented | ✅ | migration `20260424_prevent_self_role_elevation` | |
| Dead parallel-authz cluster removed (L-26) | ✅ | `rbac.ts` trimmed | cleanup, no behavior change |

### Encryption controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| AES-256-GCM PHI at rest | ✅ | `backend/src/services/encryption.ts` (PHI_FIELDS `:476-562`) | |
| Per-user key derivation (PBKDF2-SHA512) | ✅ | `backend/src/services/userEncryption.ts` | |
| PHI_FIELDS = **14 models / 39 fields** | ✅ | `encryption.ts:476-562` | counted: User 6 + Biomarker 2 + BiomarkerHistory 1 + UserFile 1 + InsurancePlan 2 + ProviderPatient 1 + HealthNeed 1 + HealthGoal 4 + GoalProgressHistory 2 + AuditLog 3 + ExpenseProjection 3 + ExpenseActual 8 + CostAnalysis 3 + LabConnection 2 = 39 |
| Schema ⇄ PHI_FIELDS coverage guard | ✅ | `backend/src/services/phiFieldsCoverage.test.ts` | every `*Encrypted` column appears in PHI_FIELDS and vice-versa; 39 matching columns in schema |
| **UserFile.original_filename encrypted (L24)** | ✅ | `encryption.ts:499`; migration `20260615_encrypt_userfile_original_filename` | plaintext twin null on write; legacy backfill pending (see [§3 ops follow-up](#open-ops-follow-up-not-a-finding--operational)) |
| **HealthGoal current/start/target encrypted (M4)** | ✅ | `encryption.ts:517-520`; migration `20260613_encrypt_goal_values` | plaintext Decimal twins retained, read path prefers encrypted |
| **GoalProgressHistory.value encrypted (M4)** | ✅ | `encryption.ts:524`; migration `20260613_encrypt_goal_values` | |
| LabConnection OAuth tokens encrypted | ✅ | `encryption.ts:559-560` | per-user key; "a stolen access token is a direct path to live PHI at Quest" |
| Key rotation procedure | 🟡 | — | not yet documented as a runbook — see [`RUNBOOK.md`](./RUNBOOK.md) (pending) |
| TLS in transit | ✅ | Cloud Run HTTPS-only | API origin |

PHI_FIELDS constant, abbreviated:

```ts
// Source: backend/src/services/encryption.ts:498-525
UserFile: [ 'originalFilenameEncrypted' ],            // L24
HealthGoal: [
  'descriptionEncrypted', 'targetValueEncrypted',
  'currentValueEncrypted', 'startValueEncrypted',     // M4
],
GoalProgressHistory: [ 'noteEncrypted', 'valueEncrypted' ],  // M4
AuditLog: [ 'previousValueEncrypted', 'newValueEncrypted', 'metadataEncrypted' ], // M6
```

> See [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) for per-field write/read-site × audit-coverage detail. Deliberate plaintext twins (legacy, being phased out) and `Biomarker.sourceFile` (a FHIR idempotency/dedupe key — encrypting it breaks dedupe) are NOT in PHI_FIELDS by design.

### PHI handling controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| PHI encrypted before storage | ✅ | `encryption.ts:476-562` | |
| PHI redaction in logs | ✅ | `backend/src/utils/phiRedaction.ts` | `pdfRedaction.ts` / `redactPatientBanner` **deleted** post-06-01; `pdf-lib` now unused (do not reference) |
| Data portability (export) | ✅ | not paywalled — `dataExport` true on all tiers (`config/plans.ts:60`) | "HIPAA requires this regardless of plan" |
| Account deletion | ✅ | settings flow; cascade FKs | |

### RLS controls

```
withRLSContext(userId, tx => …)  ──SET LOCAL app.current_user_id──▶ Postgres
                                                                       │
   migration 20260107_add_rls_policies  ──ENABLE ROW LEVEL SECURITY──▶ per-table policies
   migration 20260613_force_rls…        ──FORCE ROW LEVEL SECURITY──▶ all 19 tables (owner can't bypass)
                                                                       │
   boot:  assertNoBypassRLS()  ──prod process.exit(1) if role has BYPASSRLS  (database.ts:247-253)
          assertRLSForced()    ──prod process.exit(1) if any RLS table not FORCE (database.ts:299-306)
```

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Per-tenant RLS policies | ✅ | migration `20260107_add_rls_policies` (+ `20260529_fix_has_provider_access`, `20260530_add_users_select_provider`) | enforced via `SET LOCAL app.current_user_id` in `withRLSContext`/`withRLSTransaction` |
| **FORCE RLS on all 19 RLS tables (M2)** | ✅ | migration `20260613_force_rls_and_audit_retention`; new table in `20260613_revoked_access_tokens` | closes table-owner bypass |
| `assertNoBypassRLS()` boot hard-exit | ✅ | `backend/src/services/database.ts:247-253` | prod `process.exit(1)` if role has BYPASSRLS; non-prod warns (`:256-259`) |
| **`assertRLSForced()` boot hard-exit (NEW)** | ✅ | `backend/src/services/database.ts:299-306` | prod `process.exit(1)` if any RLS table not FORCE-protected; catches a future table that forgets FORCE |
| CI RLS-wrapper guard | ✅ | `scripts/check-rls-wrappers.sh` (`ci.yml:148-149`) | fails build if a controller/service bypasses RLS via module-level Prisma client |
| CI RLS regression (live PG, NOBYPASSRLS) | ✅ | `ci.yml:155-213` | tenant-isolation suite vs real Postgres 16 |

```ts
// Source: backend/src/services/database.ts:299-306 (assertRLSForced, prod)
if (config.isProduction) {
  logger.error(
    `FATAL: ${unforced.length} RLS-enabled table(s) are NOT FORCE-protected ` +
      `(${unforced.join(', ')}). A table owner could bypass tenant isolation on them. ` +
      'Refusing to start — add FORCE ROW LEVEL SECURITY (see migration 20260613).'
  );
  process.exit(1);
}
```

### Audit logging controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| HIPAA audit trail (`AuditLogService`) | ✅ | `backend/src/services/auditLog.ts` — `log`, `logAccess`, `logCreate`, `logUpdate`, `logDelete`, `logAuth`, `logExport`, `logSystem` | |
| Encrypted audit PHI snapshots | ✅ | `encryption.ts:528-530` | `previousValueEncrypted`, `newValueEncrypted`, `metadataEncrypted` |
| **Legacy plaintext `metadata` column dropped (M6)** | ✅ | migration `20260615_drop_legacy_audit_metadata` | irreversible DROP; replaced by `metadataEncrypted` (`encryption.ts:530`) |
| **DB-enforced 7-year retention** | ✅ | migration `20260613_force_rls_and_audit_retention` | `audit_logs_delete` policy `USING (is_admin_session() AND created_at < now() - interval '7 years')` — even admin context can't purge recent history |
| Tightened `audit_logs_insert` WITH CHECK | ✅ | migration `20260615_provider_consent_immutable_audit_insert_check` | `WITH CHECK (user_id = current_user_id() OR is_admin_session() OR current_user_id() IS NULL)` (was `true`) — audit rows can't be forged to an arbitrary user |
| Scheduled cleanup (token-gated) | ✅ | `AUDIT_CLEANUP_TOKEN` (`config/index.ts:196`); internal route | |

### Rate limiting controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| 8 named rate limiters | ✅ | `backend/src/middleware/rateLimiter.ts` — `standardLimiter:66`, `authLimiter:88`, `strictAuthLimiter:105`, `uploadLimiter:134`, `sensitiveLimiter:151`, `aiLimiter:177`, `providerAccessRequestLimiter:211`, `bulkOperationLimiter:240` | |
| IPv6-safe keygen (L-2) | ✅ | `rateLimiter.ts` uses `ipKeyGenerator` (/64 normalization) | login keyed by email+IP |
| Shared store (optional) | 🟡 / ⚠️ | `rateLimitStore.ts` `getRedisClient()`/`RedisLike` | per-instance unless `REDIS_URL` set — see [L-M11](#l-m11--per-process-rate-limit--ai-spend-store-low--infra-only) |

### Input validation controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Zod validation at API boundary | ✅ | `backend/src/middleware/validation.ts` | |
| Prompt-injection hardening (M10) | ✅ | `validation.ts` `delimitDocumentForPrompt()` + `sanitizeForPrompt()`; `MAX_EXTRACTION_DOCUMENT_CHARS = 200_000` | SBC fields range/sign/type/date-validated before persist (`upload/shared.ts` `sanitizeExtractedSbc`) |

### External APIs controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| FHIR SSRF allowlist | ✅ | `backend/src/services/fhir/urlSafety.ts:64-99` (`assertAllowedFhirUrl`) | host must equal FHIR base host or be in `extraAllowedHosts`; public host must be https |
| Cloud-metadata block | ✅ | `urlSafety.ts:28-43` (`isPrivateOrLoopbackHost`), incl. `169.254.169.254` (`:39`) | |
| Outbound timeouts | ✅ | `smartAuth.ts:85-95` (15s OAuth), `fhirClient.ts:26,45-46` (30s data) | |
| DNS-rebind residual | ⚠️ | `urlSafety.ts:13-24` | L-40 accepted (host validated, not resolved IP; trusted operator-configured hosts) |

### File storage controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| GCS storage + signed-URL downloads | ✅ | `backend/src/services/storageService.ts` | |
| GCS orphan cleanup on tx rollback (M8/M25) | ✅ | `upload/shared.ts` `withGcsOrphanCleanup()` | deletes GCS object if upload DB tx rolls back |
| PDF page-limit hard-reject (L28) | ✅ | `backend/src/utils/securePdfParsing.ts:27,35,219-228` | `MAX_PDF_PAGES = 50` + `PdfPageLimitError`, incl. OCR path |
| WebP magic-byte check (L31) | ✅ | `upload/shared.ts` | strict magic-byte validation |
| `GCS_BUCKET_NAME` required in prod (F-28) | ✅ | `config/index.ts:480` | dev/staging fall back to `ownmyhealth-user-files` (`:228`) |

### Logging & observability controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| PHI redaction in logs | ✅ | `backend/src/utils/phiRedaction.ts` | **`utils/pdfRedaction.ts` / `redactPatientBanner` deleted post-06-01; `pdf-lib` unused** |
| Structured logger | ✅ | `backend/src/utils/logger.ts` | |

### Error handling controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Centralized error handler (no internal leak) | ✅ | `backend/src/middleware/errorHandler.ts` | |
| 503 fail-closed on AI store outage | ✅ | `aiSpendGuard.ts:42-51` | never uncaps spend during outage |

### Data portability & Admin & Provider collaboration controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Data export (not paywalled) | ✅ | `config/plans.ts:60` (`dataExport` true all tiers) | HIPAA requirement |
| Admin panel (user mgmt, audit viewer, health) | ✅ | `adminRoutes.ts`, `demoProtection` | demo account blocked in prod (`config/index.ts:489`) |
| Consent-based provider sharing | ✅ | `providerAccess.ts` `resolveProviderAccess`; `providerSharing` true all tiers (not paywalled, `plans.ts:54-59`) | consent booleans immutable except by patient/admin (L23 trigger) |

### AI integration controls

```
POST /ai/chat (and 7 other mount points)
   │  authenticate ─▶ aiSpendGuard ─▶ admitAISpend(userId)
   │                      │              reserve $0.05 (aiCostTracker.ts:67)
   │                      ▼
   │            admitted? ──no──▶ 503 ServiceUnavailableError (fail-closed)
   │                      │yes
   ▼                      ▼
 Claude call ──▶ res.on('finish'|'close') ─▶ settle() (back out reservation)
   │
   ▼  trackAIUsage() records REAL per-call cost (aiCostTracker.ts:302-323)
```

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Anthropic BAA gate (prod hard-fail) | ✅ | `config/index.ts:245`, gate `:381-394` | prod throws if `ANTHROPIC_API_KEY` set + `ANTHROPIC_BAA_ACTIVE` unset; re-checked per-call in `biomarkerRoutes`, `aiChatController`, `claudeExtraction`, `sbcExtraction`, `expenseController` |
| Google Document AI BAA gate (prod hard-fail) | ✅ | `config/index.ts:236`, gate `:401-414` | prod throws if `GCP_PROCESSOR_ID` set + `GOOGLE_BAA_ACTIVE` unset; re-checked in `ocrService` |
| Dollar circuit-breaker (`aiSpendGuard` + `admitAISpend`) | ✅ | `aiSpendGuard.ts`; `aiCostTracker.ts:67` reserve / `settle()` | 8 mount points across 5 route files; `isAISpendExceeded` was DELETED; 503 fail-closed |
| Pluggable spend store | 🟡 / ⚠️ | `InMemorySpendStore` (`aiCostTracker.ts:95`) default; `RedisSpendStore` (`:172`) when `REDIS_URL` | per-process unless Redis — see [L-M11](#l-m11--per-process-rate-limit--ai-spend-store-low--infra-only) |
| Server-side disclaimer enforcement (L33) | ✅ | `backend/src/utils/aiDisclaimer.ts` `disclaimerToAppend()` | appends `AI_DISCLAIMER` unless model already did |
| Document AI dollar accounting | 🟡 | `ocrService.ts:300` `processDocument` | the real Document AI cost is **not** recorded into the dollar accumulator; bounded by count-based `pdfUploadsPerMonth` quota + `aiLimiter`, not dollars — documented gap |

**8 `aiSpendGuard` mount points** (`aiRoutes.ts:32`, `biomarkerRoutes.ts:136`, `expenseRoutes.ts:114`, `insuranceRoutes.ts:125`, `insuranceRoutes.ts:138`, `uploadRoutes.ts:82`, `uploadRoutes.ts:104`, `uploadRoutes.ts:135`).

### Quest FHIR / lab connection controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| SMART-on-FHIR OAuth + PKCE (S256) | ✅ | `backend/src/services/fhir/smartAuth.ts:101-114` | code_verifier=64 random bytes; no reliance on client_secret confidentiality |
| Encrypted LabConnection tokens | ✅ | `encryption.ts:559-560` (`accessTokenEncrypted`/`refreshTokenEncrypted`) | per-user key (`labSyncService.ts:144-187`) |
| SSRF allowlist on every outbound FHIR URL | ✅ | `urlSafety.ts:64-99` enforced at `fhirClient.ts:31-42`, `smartAuth.ts:146-160,202,246,339-343` | pagination `next`, discovery, token, refresh, revoke all re-validated |
| Sync IDOR protection | ✅ | `fhirController.ts:171-203` ownership check + RLS; keyed by `(userId, provider)` | attacker-supplied id never reaches DB write path directly |
| Sync idempotency | ✅ | dedupe on `sourceFile = fhir:{provider}:{obs.id}` (`labSyncService.ts:280-330`) | re-sync no-op; user edits not clobbered |
| Per-sync outbound-spend breaker | ⚠️ | `fhirRoutes.ts:43-53` | L-13 accepted — only count-based `sensitiveLimiter`, not page/token budget |

### Plan gating / billing controls

| Control | Status | Evidence | Notes |
|---|---|---|---|
| `requirePlanLimit` middleware | ✅ | `backend/src/middleware/planGating.ts:37-124` | reads plan fresh from DB under RLS; applies `planExpiresAt` → FREE downgrade |
| Fails CLOSED to FREE on DB error | ✅ | `planGating.ts:76-88` | does not trust the more-permissive JWT snapshot |
| 6/6 numeric limits enforced | ✅ | `usageTracker.ts:156-209`; `maxBiomarkers`/`insurancePlans` now enforced | `maxBiomarkers` upload truncation (`upload/shared.ts:206-231`), `insurancePlans` activation gate (`insuranceController.ts:680-727`) |
| `providerSharing` / `dataExport` ungated by design | ✅ | `plans.ts:54-60` | `true` all tiers — patient rights / HIPAA, deliberately not paywalled |
| Quota TOCTOU | 🟡 | `usageTracker.ts:179-198` | L34/L36 documented-accepted — see [§3 open](#m-l34l36--ai-quota--plan-limit-toctou-race-medium--documented--accepted) |

### Infrastructure / deploy controls

```
push master ─▶ ci (ci.yml via workflow_call)
                 ├─ frontend lint+test+build
                 ├─ backend lint + test:ci + build
                 ├─ Security Audit: gitleaks + npm audit --audit-level=high + check-rls-wrappers.sh
                 └─ RLS Regression: tenant-isolation suite vs Postgres 16 (NOBYPASSRLS)
                        │ needs: ci
                        ▼
            build-and-stage ─▶ push image :${sha}
                        │      ─▶ ownmyhealth-migrate Cloud Run JOB (prisma migrate deploy, --max-retries 0)
                        │      ─▶ deploy revision @ 0% traffic, staging-<sha> tag
                        ▼
                  smoke-test ─▶ promote (100% via --to-revisions) ─▶ deploy-frontend (needs: [ci, promote])
```

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Migrations NOT at container boot | ✅ | `backend/Dockerfile:86-93` — CMD `["node","dist/app.js"]` | comment documents the migrate-as-job model |
| Migrations as `ownmyhealth-migrate` Cloud Run job | ✅ | `deploy.yml:106-161`; `MIGRATE_JOB: ownmyhealth-migrate` (`deploy.yml:43`) | `--max-retries 0` (human reviews failures); runs after image push, before staging |
| Deploy gated on full CI | ✅ | `deploy.yml:57-66` (`needs: ci`); `ci.yml:106-149,155-213` | lint+test+build+gitleaks+npm-audit-high+RLS regression |
| 0%-traffic staged deploy + smoke + named-revision promote | ✅ | `deploy.yml:48-344` | deterministic `--to-revisions` rollback |
| Node 22-alpine (digest-pinned) | ✅ | `backend/Dockerfile:11-16`; `ci.yml` `NODE_VERSION: '22'` | M15 (Node 20 EOL Apr 2026) |
| Source maps stripped from prod image | ✅ | `Dockerfile` `find ./dist -name '*.map' -delete` | `OMH_DEPLOY_ENFORCE_PROD=true` baked in (RT-H1) |
| One-time data-migration workflow | ✅ | `.github/workflows/maintenance.yml` → `ownmyhealth-maintenance` job | dry-run default; runs L24/M4 backfills |
| Email-scheduler multi-instance dedupe | ✅ | `emailScheduler.ts` + `users.last_weekly_summary_sent`/`last_plan_expiring_sent` (migration `20260614_add_email_sent_markers`) | atomic at-most-once claim across replicas |

---

## 6. BAA inventory

| Vendor | Service | Status | Gate / evidence | Date |
|---|---|---|---|---|
| Anthropic | Claude API (guidance, cost analysis, extraction) | ✅ Signed / active (BAA flag enforced) | `ANTHROPIC_BAA_ACTIVE` — prod hard-fail if key set + flag unset (`config/index.ts:381-394`); per-call re-check | TBD (external: BAA signature date — ask compliance owner; flag is active in prod per memory 2026-04-17 `ANTHROPIC_BAA_ACTIVE` flip) |
| Google Cloud | Document AI (image OCR) | ✅ Required-if-enabled (BAA flag enforced) | `GOOGLE_BAA_ACTIVE` — prod hard-fail if `GCP_PROCESSOR_ID` set + flag unset (`config/index.ts:401-414`) | TBD (external: Google Cloud BAA covering Document AI — GCP Console / compliance owner) |
| Google Cloud | Cloud Run + Cloud SQL + GCS + Cloud Storage | ✅ Covered under GCP BAA | infra runs in GCP project ownmyhealth-prod | TBD (external: GCP BAA — Google Cloud Console / compliance owner) |
| SendGrid (Twilio) | Transactional email (verification, reset) | TBD (external: SendGrid BAA status — ask compliance owner) | `SENDGRID_API_KEY` gates email (`config/index.ts:209-210`) | TBD — email is non-PHI transactional (verification/reset links); confirm no PHI in templates |
| Quest Diagnostics | SMART-on-FHIR lab data | TBD (external: Quest data-sharing agreement — ask compliance owner) | `QUEST_FHIR_*` (`config/index.ts:266-280`); patient-authorized OAuth | Patient grants access via OAuth; not a classic BAA |

> Anthropic and Google BAA flags are **runtime-enforced**: production refuses to boot if the API key/processor is configured without its BAA flag set to `"true"`. This is the strongest available in-repo assertion that a BAA is in effect.

---

## 7. Incidents

| Incident | Date | Root cause | Resolution / learning |
|---|---|---|---|
| Production all-routes outage (10-day silent) | 2026-06-02 → 2026-06-12 | The 2026-06-01 F-28 boot guard required `GCS_BUCKET_NAME`, which the Cloud Run service never had; boot-time `prisma migrate` masked the failure | Set `GCS_BUCKET_NAME` (`config/index.ts:480`); **removed boot-migrate** (now `ownmyhealth-migrate` job) so a failing migration fails the *deploy*, not the running service (`Dockerfile:86-93`) |
| Pentest finding M-1 (refresh-reuse family not revoked) | 2026-06-12 | Refresh-token reuse outside the rotation window did not revoke the token family | Closed: `revokeAllUserTokens` in the reuse branch (`authService.ts:795-806`); confirmed exploitable-then-fixed on a live throwaway Postgres |

No PHI-exposure incident has occurred. RLS, CSRF, IDOR, SSRF, JWT, and file-handling were all verified SOLID under the 2026-06-12 hands-on pentest.

---

## 8. Compliance status

| Item | Status | Evidence |
|---|---|---|
| GCP BAA (Cloud Run / SQL / GCS) | ✅ Covered | infra in GCP; runtime BAA gates for Document AI |
| Anthropic BAA | ✅ Active (flag-enforced) | `config/index.ts:381-394` |
| HIPAA §164.312(a)(1) Access control | ✅ | RLS (all 19 tables FORCE-protected) + RBAC + per-user encryption keys |
| HIPAA §164.312(b) Audit controls | ✅ | `AuditLogService`; DB-enforced 7-year retention (`20260613_force_rls_and_audit_retention`) |
| HIPAA §164.312(a)(2)(iv) Encryption at rest | ✅ | AES-256-GCM, 39 PHI fields (`encryption.ts:476-562`) |
| HIPAA §164.312(e)(1) Transmission security | ✅ | Cloud Run HTTPS-only; TLS to Cloud SQL |
| HIPAA §164.308(a)(7) Data portability/deletion | ✅ | export + account deletion (not paywalled) |
| SOC 2 | TBD (external: SOC 2 start date — ask compliance owner) | not started in-repo |

See [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) for the full safeguard-by-safeguard mapping.

---

## 9. Posture trendline

| Cycle (audit date) | Critical open | High open | Medium open | Low open | Note |
|---|---|---|---|---|---|
| **2026-06-15 / -16 (this)** | **0** | **0** | **2** (accepted) | **~5** (infra) | Security long-tail closed; FORCE RLS + cross-instance revocation + PHI expansion wired |
| 2026-06-13 (teardown) | 0 | 2 | 30 | 40 | 84 confirmed findings; "seams" theme; both Highs (time-series, deploy-gate) closed 2026-06-14 |
| 2026-06-12 (blockers + pentest) | 1 (C-8, fixing) | 9 (teardown blockers) | 1 (M-1 pentest) | 2 (L-1/L-2) | All 9 ship-blockers fixed; C-8 closed via FORCE RLS |
| 2026-06-09 (teardown) | 1 | 24 | 63 | 55 | 143 findings; ship-blocker bucket fixed 2026-06-12 |

Trend: monotonic decrease in open Critical/High; the residual is documented-accepted Medium races + infra-pending Low items.

---

## 10. Next-audit trigger

Re-run [`prompts/24-full-security-audit.md`](../prompts/24-full-security-audit.md) (the 01-13 + 26-32 suite) when **any** of:

1. A new PHI field or model is added (the `phiFieldsCoverage.test.ts` guard will fail-fast, but a full audit confirms write/read/audit wiring).
2. A new external data egress is added (new vendor, new outbound API, new FHIR/lab provider) — re-verify SSRF allowlist + BAA gate.
3. The auth/session model changes (token format, revocation mechanism, cookie policy).
4. RLS policies, FORCE-RLS coverage, or the DB role's BYPASSRLS/FORCE posture changes.
5. Redis/Memorystore is provisioned (closes L-M11 / L-39) — re-verify shared-store enforcement.
6. Before any HITRUST/SOC 2 assessment, or after a confirmed security incident.
7. Routine cadence: quarterly, or on a major dependency bump (zod 4, vite 8, rate-limit-redis 5 — currently held).

---

## Related Documents

- [SECURITY_AUDIT_core.md](./SECURITY_AUDIT_core.md) — per-area findings: auth, CSRF, RBAC, encryption, RLS (the primary findings set this doc synthesizes).
- [SECURITY_AUDIT_domain.md](./SECURITY_AUDIT_domain.md) — per-area findings: PHI handling, plan gating, AI cost, audit logging.
- [SECURITY_AUDIT_infrastructure.md](./SECURITY_AUDIT_infrastructure.md) — per-area findings: deploy/CI, migrate job, Redis, edge headers.
- [SECURITY_AUDIT_periphery.md](./SECURITY_AUDIT_periphery.md) — per-area findings: FHIR/SSRF, file storage, external APIs.
- [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) — safeguard-by-safeguard technical-safeguard mapping.
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — the documented-accepted residuals (L34/L36 races, L-13, L-40) in product context.
- [CHANGELOG.md](./CHANGELOG.md) — closing-PR / commit history for this cycle.
- [DATA_MODEL.md](./DATA_MODEL.md) — full ER, RLS policies, FORCE-RLS coverage (evidence for §5 RLS).
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — every PHI field × encryption × write/read site × audit coverage (evidence for §5 Encryption).
- [ENV_VARS.md](./ENV_VARS.md) — `REDIS_URL`, BAA flags, AI budget vars, cookie vars (evidence for §6 BAA, §5 infra).
- [RUNBOOK.md](./RUNBOOK.md) — operational steps: L24 backfill, key rotation, Redis provisioning, edge headers.

> Cross-links above point only to the doc set this run produces; sibling reports (TEARDOWN / UX_REVIEW) are not claimed to exist.

---

## Prompt drift log

- `prompts/21-security-status-doc.md` (Required sections §5 Encryption) says "PHI_FIELDS (14 models / **39** fields)" in one place and the C-8 example references older line numbers. The **39 fields** figure is correct (counted from `encryption.ts:476-562`: 6+2+1+1+2+1+1+4+2+3+3+8+3+2 = 39). The ground-truth fact digest's PHI table summed to "37" — that was a digest miscount (it omitted 2 of the ExpenseActual/CostAnalysis entries when tallying); the schema has 39 matching `*Encrypted` columns. Used **39**.
- `prompts/21-security-status-doc.md` "Files to review" lists `utils/phiRedaction.ts` and notes `utils/pdfRedaction.ts` was deleted — confirmed: `Glob`/dir listing of `backend/src/utils/` shows `phiRedaction.ts` present and no `pdfRedaction.ts`; `pdf-lib` is unused. No drift, noted for the reader.
- `prompts/21-security-status-doc.md` references existing `SECURITY_AUDIT_*.md` and `HIPAA_CHECKLIST.md` as "Primary — synthesize, don't re-audit." At generation time `New Project Documents/` contained only an (empty) `security-reviews/` subdir — these siblings are being (re)generated by the same refresh run. This doc cross-links them as part of the doc set this run produces (per the task constraint) and grounds every finding directly in code rather than re-citing sibling prose.
- [`CLAUDE.md`](../CLAUDE.md) is stale on several points already corrected here: it lists "controllers (10 files)" / "services (18 files)" / "routes (13 files)" (actual: 18 routes, 12+4 controllers, 39 services incl. subdirs — see fact digest `[backend-counts]`); its PHI list omits `UserFile.original_filename`, HealthGoal current/start, GoalProgressHistory.value, audit `metadataEncrypted`; and it still implies `/auth/refresh` + upload routes are CSRF-exempt and does not mention `tokens_valid_after`/`revoked_access_tokens`/`requireBearerAuth`. These should be reconciled in the next `CLAUDE.md` refresh.
