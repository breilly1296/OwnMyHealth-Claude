# SECURITY_STATUS.md

> **Current-state security posture reference** for OwnMyHealth — not a history log.
> A reader with only this doc + its siblings should be able to answer
> *"what's open? what's critical? what's the plan?"* without repo access.

| Field | Value |
|---|---|
| **Last updated** | 2026-06-01 |
| **Last full audit** | 2026-05-29 (multi-agent verified sweep — 109 agents, 13 dimensions, adversarial per-finding verification) |
| **Prior audit** | 2026-04-25 (22-prompt doc + security audit baseline) |
| **Audit tool** | `prompts/24-full-security-audit.md` orchestrating prompts 01-13 + 26-32 |
| **Security grade** | **B+** (up from C+ on 2026-05-29 and B on 2026-04-25 — the entire High + Medium + infra backlog was remediated and merged to `master` 2026-05-29/05-30; residual items are Low/Info polish + external infra provisioning) |
| **Repo HEAD at writing** | `13db267` (2026-06-01) |
| **Production PHI exposure** | None known open at Critical. The one historic Critical (C-8 RLS runtime gap) is mitigated in production via a startup hard-exit; see [C-8](#c-8--rls-not-enforced-under-a-bypassrls-login-critical--mitigated-in-prod-residual-in-devstaging). |

This doc synthesizes the findings set. The per-area audit outputs
(`SECURITY_AUDIT_core.md`, `SECURITY_AUDIT_domain.md`,
`SECURITY_AUDIT_infrastructure.md`, `SECURITY_AUDIT_periphery.md`) are being
generated in the same documentation batch; until they land, every control and
finding below is grounded directly in the live code (`file:path:line`), git
history, and the 2026-05-29 durable analysis (recorded in session memory as
`PROJECT_ANALYSIS_2026-05-29.md`; not present in this repo checkout).

---

## 1. Posture summary

Counts reconcile the 2026-04-25 baseline (128 findings: 1C / 12H / 50M / 65L)
against the 2026-05-29/05-30 remediation cycle, which cleared the entire High +
Medium + infrastructure backlog to `master`. "Open" = not fixed in code as of
HEAD `13db267`.

| Severity | Open | Closed this cycle | Total discovered |
|---|---|---|---|
| Critical | 0 (1 mitigated-in-prod) | 1 | 1 |
| High | 0 | 12 | 12 |
| Medium | ~6 (Low-graded residuals) | ~50 | 50 |
| Low | ~33 | ~17 | 65 |
| Info | ~12 | 0 | 12 |

Notes:
- **Critical**: the single historic Critical (`C-8`, RLS runtime gap) is closed
  for production by `assertNoBypassRLS()` (`backend/src/services/database.ts:248-255`),
  which `process.exit(1)`s if the prod DB role has `BYPASSRLS`. It remains a
  warning-only path in dev/staging — tracked as a residual, not an open prod
  Critical.
- **Medium residuals**: the ~6 still-open items are multi-instance precision
  limitations (per-instance rate-limit + AI-spend accumulators) that are
  *code-complete with a shared-store opt-in already merged* — they need infra
  provisioning, not code. See [Open findings](#2-open-findings).
- The 2026-05-29 sweep independently confirmed 94 findings (16 H / 33 M / 33 L /
  12 Info) before remediation; all 16 High and the full Medium tier were fixed
  and merged. Source: `PROJECT_ANALYSIS_2026-05-29.md`.

```
2026-04-25 baseline ──▶ 2026-05-29 sweep ──▶ 2026-05-29/05-30 remediation ──▶ HEAD 13db267
   1C/12H/50M/65L          C+ grade,             #103-#127 merged,              B+ grade,
   grade B                 94 confirmed          all High+Med+infra closed      0 open Critical/High
```

---

## 2. Open findings

The High and Critical tiers are **closed in code**. What remains open are
residual hardening items (graded Low/Medium) where the *code* is complete but a
runtime/infra step or a follow-up is outstanding.

### C-8 — RLS not enforced under a BYPASSRLS login (Critical → mitigated in prod, residual in dev/staging)

- **Area**: infrastructure
- **Evidence**: `assertNoBypassRLS()` runs at startup after DB connect
  (`backend/src/services/database.ts:194`). It queries `pg_roles` for the current
  login (`database.ts:228-230`); **production** hard-exits
  (`process.exit(1)`, `database.ts:254`) if `rolbypassrls` is true; **non-prod**
  logs a WARNING and continues (`database.ts:257-260`). RLS policies live in
  migration `20260107_add_rls_policies`; later fixes in
  `20260529_fix_has_provider_access` and `20260530_add_users_select_provider`.

  ```ts
  // Source: backend/src/services/database.ts:248-260
  if (config.isProduction) {
    logger.error(
      'FATAL: Production database role has BYPASSRLS. ' +
      'RLS policies are not enforcing. Refusing to start. ' +
      'See C8_PART3_RUNBOOK.md.'
    );
    process.exit(1);
  }

  logger.warn(
    'WARNING: Database role has BYPASSRLS — RLS policies are not enforcing. ' +
    'This is acceptable in development but must be fixed before production.'
  );
  ```

- **Impact**: With a BYPASSRLS login, RLS policies do not enforce and app-layer
  filtering is the only barrier. The startup assertion closes this for
  production; dev/staging can still run BYPASSRLS (warning only).
- **Remediation plan**: verify the deployed Cloud SQL role is `NOBYPASSRLS`
  (the `omh_app` role); cut dev/staging over to `NOBYPASSRLS` to remove the
  warning path. App-layer wiring is already verified — `withRLSContext` /
  `withRLSTransaction` issue `SET LOCAL` via parameterized `set_config()`
  (`database.ts:368-377`), and the RLS regression suite runs against a real
  `NOBYPASSRLS` role in CI (the `rls` job, `.github/workflows/ci.yml:137-138`;
  suite at `backend/src/services/rls.test.ts`).
- **Owner**: TBD (external: infra owner — GCP Console / Cloud SQL IAM, project `ownmyhealth-prod`)
- **ETA**: TBD (external: confirm prod role is `omh_app`/`NOBYPASSRLS` + dev/staging cutover)
- **Cross-link**: [`DATA_MODEL.md`](./DATA_MODEL.md) (RLS policies), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) (§164.312(a)).

### M-37 — Rate-limit counters are per-instance under Cloud Run autoscale (Medium → code-complete, infra pending)

- **Area**: infrastructure / rate limiting
- **Evidence**: `express-rate-limit` defaults to in-process `MemoryStore`, so each
  Cloud Run instance keeps its own counters — effective ceiling is N×limit across
  N instances (`backend/src/middleware/rateLimitStore.ts:4-7`). A shared Redis
  (Cloud Memorystore) store is **already wired** behind `REDIS_URL`
  (`rateLimitStore.ts:32-53`); when unset, `createRateLimitStore` returns
  `undefined` and the limiters fall back to MemoryStore (`rateLimiter.ts:7-14`).
  Closed in code by PR #125 (commit `d72651c`, 2026-05-30).
- **Impact**: A login brute-force cap of 5/window becomes 5N; the AI cap of 10/hr
  becomes 10N/hr. Today bounded by `--max-instances=3`.
- **Remediation plan**: provision Memorystore + VPC connector, set `REDIS_URL`.
  Runbook merged: `docs/INFRA_REDIS_AND_SCHEDULER.md` (PR #127, commit `ad536b2`).
- **Owner**: TBD (external: infra owner — provisions billable Memorystore + VPC)
- **ETA**: TBD (external: infra provisioning decision)
- **Cross-link**: [`ENV_VARS.md#rate-limiting`](./ENV_VARS.md), [`RUNBOOK.md`](./RUNBOOK.md).

### M-budget — AI spend accumulator is per-instance (Medium → code-complete, same limitation as M-37)

- **Area**: AI integration / infrastructure
- **Evidence**: the daily-budget circuit breaker reads an in-memory per-UTC-day
  accumulator (`backend/src/middleware/aiSpendGuard.ts:30`, accumulator in
  `services/aiCostTracker.ts`). The config docblock states the effective ceiling
  is N×budget under autoscale (`backend/src/config/index.ts:188-194`).
- **Impact**: with N instances, the effective daily AI budget is N × `AI_DAILY_BUDGET_USD`.
- **Remediation plan**: move the accumulator to the same shared store as M-37
  (Memorystore) for multi-instance precision. Bounded today by `--max-instances`.
- **Owner**: TBD (external: infra owner)
- **ETA**: TBD (external: tied to M-37 Memorystore provisioning)
- **Cross-link**: [`ENV_VARS.md`](./ENV_VARS.md) (`AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD`).

### M-38 — Audit-retention cleanup relies on in-process interval on scale-to-zero (Medium → code-complete, infra pending)

- **Area**: infrastructure / audit logging
- **Evidence**: the in-process 24h `setInterval` rarely fires on scale-to-zero
  Cloud Run (`backend/src/services/auditLog.ts:582-592`). A Cloud Scheduler path
  is wired behind `AUDIT_CLEANUP_TOKEN` (`auditLog.ts:587-591`,
  `config/index.ts:135-137`); when the token is set, the interval is disabled and
  retention is driven by a shared-secret POST to `/internal/audit-cleanup`.
  Closed in code by PR #126 (commit `d0939f3`, 2026-05-30).
- **Impact**: without provisioning, 7-year-retention deletion may never run on a
  service that scales to zero (logs accumulate; not a confidentiality risk).
- **Remediation plan**: provision Cloud Scheduler + set `AUDIT_CLEANUP_TOKEN`.
  Runbook: `docs/INFRA_REDIS_AND_SCHEDULER.md`.
- **Owner**: TBD (external: infra owner)
- **ETA**: TBD (external: infra provisioning decision)
- **Cross-link**: [`RUNBOOK.md`](./RUNBOOK.md), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) (§164.312(b)).

### L-logout-all — Token revocation is single-instance + in-memory (Low → accepted residual)

- **Area**: auth
- **Evidence**: `isTokenRevoked` is checked on every protected route
  (`backend/src/middleware/auth.ts:87`, `:139`, `:193`), but the blacklist lives
  in `authService` per-instance/in-memory. A "log out of all devices" on one
  Cloud Run instance does not propagate to tokens held by another instance until
  natural 15-min access-token expiry.
- **Impact**: bounded to ≤15 min and to multi-instance deployments; access tokens
  are short-lived by design.
- **Remediation plan**: token-epoch column on `User` or shared Redis blacklist
  (pairs with M-37 Memorystore work).
- **Owner**: TBD (external: infra owner for shared store)
- **ETA**: TBD (external: tied to Memorystore provisioning)
- **Cross-link**: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (auth flow), [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

### Remaining Low/Info (~33 Low + ~12 Info)

Not individually triaged; optional polish per `ownmyhealth-2026-05-30-backlog`.
Examples carried from the sweep: CSP at the serving layer (deploy-layer change,
needs infra decision); engine-level column-scope hardening for the
`users_select_provider` policy (split secret tokens / restricted view). Tracked
in [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

---

## 3. Closed in current cycle

The 2026-05-29/05-30 remediation cycle. Finding IDs map to the 2026-04-25
baseline (`C-N`/`F-N`) and the 2026-05-29 sweep (`P1`-`P8`, `#NN` audit issues).
All PRs merged to `master` with CI green.

| Finding | Severity | Closing PR / commit | Date | Verification |
|---|---|---|---|---|
| C-1 — `set_config` outside transaction (RLS bypass) | Critical | PR #30 / `9727492` | 2026-04-16 | RLS now via `SET LOCAL` in a tx (`database.ts:368-377`); regression suite `backend/src/services/rls.test.ts` runs under NOBYPASSRLS in CI (`ci.yml:137`) |
| C-3 — JWT secret hardcoded fallbacks | Critical→High | `4290520`/`ca8b2c0` (C-3) | 2026-04-23/25 | `requireEnv('JWT_ACCESS_SECRET')` throws if unset (`config/index.ts:18-28, 61, 65`); blocked-value + length checks (`config/index.ts:241-277`) |
| C-4 — placeholder PHI key accepted | Critical→High | encryption hardening | 2026-04 | `validateEncryptionKey` rejects known insecure keys in **every** env (`encryption.ts:128-139`) |
| C-7 — PHI-to-Claude without BAA gate | Critical | PR #111 + earlier C-7 (`4fa53a6`) | 2026-04-17 / 2026-05-29 | BAA gate re-checked per call: `biomarkerRoutes.ts:137`, `claudeExtraction.ts:106`, `sbcExtraction.ts:767`, `aiChatController.ts:129`, `expenseController.ts:627`; Doc-AI gate `ocrService.ts:274` |
| C-8 — RLS role cutover prep | Critical | PRs #40-#43, #105, #109 | 2026-04-16…2026-05-29 | `assertNoBypassRLS()` (`database.ts:218-261`); provider PHI reads moved to `withRLSContext(providerId)`; migration `20260529_fix_has_provider_access` |
| P1 — legacy `getFile` 15-min signed URLs | High | PR #103 | 2026-05-29 | Endpoint now proxies bytes through `authenticate`+RLS+ownership (`fileController.ts:201-259`); audit logged before stream (`fileController.ts:232`) |
| P1 — PDF DoS guard on dead path | High | PR #103 | 2026-05-29 | Upload path guards added (per `PROJECT_ANALYSIS_2026-05-29.md`) |
| P2 — token revocation no-op | High | PR #103 | 2026-05-29 | `isTokenRevoked` wired into `authenticate`/`optionalAuth`/`requireBearerAuth` (`auth.ts:87,139,193`) |
| P3 — `morgan('combined')` logs `?token=` | High | PR #103 | 2026-05-29 | Prod uses custom format with query stripped + Referer omitted (`app.ts:231-244`) |
| P4 — SendGrid sandbox no prod hard-fail | High | PR #103 | 2026-05-29 | Prod throws if `SENDGRID_SANDBOX_MODE=true` (`config/index.ts:421-427`) |
| #28 — `[ENCRYPTION_FAILED]` audit sentinel | High | PR (`5c7023a`) | 2026-05-30 | `encryptValue` re-throws; `log()` fails closed for PHI mutations (`auditLog.ts:221-231, 294-298`) |
| #17 — audit write opened second connection | High/Med | PR #122 (`3d5ff07`) | 2026-05-30 | Audit row written on caller's `tx` (`auditLog.ts:257-264`) |
| P6 — no AI spend ceiling | High | PR #104/#108 | 2026-05-29 | `aiSpendGuard` 503 at budget (`aiSpendGuard.ts:41-47`); budgets `config/index.ts:195-198` |
| P7 — provider RLS backstop defeated | High | PRs #105, #109 | 2026-05-29 | `has_provider_access()` dead `can_view_dna` ref dropped; provider reads use provider RLS context; migration `20260530_add_users_select_provider` |
| P8 — HIPAA export omits health profile | High | PR #104/#108 | 2026-05-29 | `healthProfileEncrypted` added to export + `UserExportData` |
| #9 — Document AI no BAA gate | High | PR #111 (`b0ac61c`) | 2026-05-29 | `GOOGLE_BAA_ACTIVE` gate (`ocrService.ts:274`, prod boot hard-fail `config/index.ts:320-333`) |
| #26 — FHIR SSRF / token exfil | High | PR #110 | 2026-05-29 | `assertAllowedFhirUrl` host allowlist + cleartext refusal (`fhir/urlSafety.ts:56-91`) |
| #17 (login) / #18 (register) enumeration | High/Med | PRs #113, #116 | 2026-05-29 | Uniform 401 on login; byte-identical 201 on register |
| #37 — rate limiters in-memory | Med | PR #125 (`d72651c`) | 2026-05-30 | Shared Redis store behind `REDIS_URL` (`rateLimitStore.ts`) — **code merged, infra pending** ([M-37](#m-37--rate-limit-counters-are-per-instance-under-cloud-run-autoscale-medium--code-complete-infra-pending)) |
| #38 — audit cleanup never fires | Med | PR #126 (`d0939f3`) | 2026-05-30 | Cloud Scheduler path behind `AUDIT_CLEANUP_TOKEN` — **code merged, infra pending** ([M-38](#m-38--audit-retention-cleanup-relies-on-in-process-interval-on-scale-to-zero-medium--code-complete-infra-pending)) |
| F-6 — self-role-elevation via own-row update | High | migration `20260424_prevent_self_role_elevation` | 2026-04-24 | BEFORE UPDATE trigger blocks non-admin `role`/`is_active` change (`migration.sql:30-62`) |
| #12 — CI secret scanning absent | Med | PR #112 | 2026-05-29 | gitleaks `detect --no-git` in Security Audit job (`ci.yml:114-118`) |

**Most recent closed Critical** = C-8 RLS cutover (final app-layer piece PR #109,
`a52946f`, 2026-05-29). Verification: `rls.test.ts` passes 11/11 under a real
`NOBYPASSRLS` role in the CI `rls` job (`ci.yml:137-138`).

---

## 4. Controls status

Legend: ✅ verified-in-code at HEAD `13db267` · 🟡 partial / depends on external
infra · ⚠️ gap.

### Auth

| Control | Status | Evidence | Notes |
|---|---|---|---|
| JWT access (15m) + refresh (7d), DB-backed | ✅ | `config/index.ts:62, 66`; `auth.ts:92` | Cookie-first, Bearer fallback (`auth.ts:34-47`) |
| Token revocation on logout/password-change | ✅ | `auth.ts:87, 139, 193` | In-memory blacklist; single-instance ([L-logout-all](#l-logout-all--token-revocation-is-single-instance--in-memory-low--accepted-residual)) |
| Bearer-only auth for CSRF-exempt SSE | ✅ | `auth.ts:180-220` (`requireBearerAuth`) | Closes cookie+Bearer CSRF hole on `/ai/chat` |
| Login brute-force lockout | ✅ | `config/index.ts:97-98`; `strictAuthLimiter` (`rateLimiter.ts:53-73`) | 5 attempts/15m, email+IP keyed, counts only failures |
| Login/register enumeration safe | ✅ | PRs #113/#116 | Uniform 401 / byte-identical 201 |
| bcrypt cost ≥13 | ✅ | `config/index.ts:100` | Default 13 |

### CSRF

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Double-submit cookie, no server secret | ✅ | `csrf.ts:86-173` | Constant-time SHA-256 compare (`csrf.ts:164-166`) |
| Applied to all state-changing methods | ✅ | `app.ts:213-217`; `csrf.ts:91-93` | GET/HEAD/OPTIONS skip |
| Exemptions are Bearer-only or shared-secret | ✅ | `csrf.ts:98-143` | `/ai/chat` (Bearer), `/internal/audit-cleanup` (X-Cleanup-Token) |

### RBAC

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Role hierarchy PATIENT/PROVIDER/ADMIN | ✅ | `rbac.ts:16-20` | `requireRole`/`requireMinRole` (`rbac.ts:58-93`) |
| Provider→patient access scoped to consent | ✅ | `rbac.ts:202-250` | Checks status ACTIVE + `consentExpiresAt` + capability flags |
| Self-elevation blocked at DB layer | ✅ | migration `20260424_prevent_self_role_elevation` | Trigger, not just policy (policies can't see OLD) |
| Demo account privilege blocks | ✅ | `demoProtection.ts:33-50` | Empty `DEMO_EMAIL` matches nobody (`demoProtection.ts:34`) |

### Encryption

| Control | Status | Evidence | Notes |
|---|---|---|---|
| AES-256-GCM PHI at rest | ✅ | `encryption.ts:57, 262-278` | `iv:authTag:ciphertext` base64 (`encryption.ts:226`) |
| Per-user key derivation (PBKDF2-SHA512) | ✅ | `encryption.ts:192-200` | 600k iterations (`encryption.ts:85`), legacy 100k fallback on decrypt (`encryption.ts:300-314`) |
| Reject weak/placeholder keys in every env | ✅ | `encryption.ts:128-139` | Plus prod re-check `config/index.ts:372-383` |
| Decrypt failure → null, not ciphertext leak | ✅ | `encryption.ts:369-379` | Logged at error level |
| Key rotation procedure | 🟡 | TODO in `encryption.ts:80-83` | Per-ciphertext iteration envelope not yet implemented — see [`RUNBOOK.md`](./RUNBOOK.md) |
| TLS in transit | ✅ | Cloud Run HTTPS-only | Cookies `secure` in prod (`config/index.ts:75`) |

### PHI handling

| Control | Status | Evidence | Notes |
|---|---|---|---|
| `PHI_FIELDS` matches schema | ✅ | `encryption.ts:410-486` | 13 models; canonical list in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) |
| LabConnection OAuth tokens encrypted | ✅ | `encryption.ts:482-485` | Stolen token = live PHI at lab |
| AuditLog uses system salt (survives deletion) | ✅ | `auditLog.ts:148, 220` | Per-user salts destroyed on deletion; audit must outlive |
| Cache-Control no-store on `/api` | ✅ | `app.ts:259-262` | PHI never cached by intermediaries |

### RLS

| Control | Status | Evidence | Notes |
|---|---|---|---|
| `SET LOCAL` per query via `set_config()` | ✅ | `database.ts:368-377` | Parameterized; both `current_user_id` + `is_admin` always set |
| Startup BYPASSRLS assertion (prod hard-exit) | ✅ | `database.ts:218-261` | dev/staging warn-only ([C-8](#c-8--rls-not-enforced-under-a-bypassrls-login-critical--mitigated-in-prod-residual-in-devstaging)) |
| CI guard against bare `prisma.*` in callbacks | ✅ | `ci.yml:130-131`; `scripts/check-rls-wrappers.sh` | Fails build on RLS-bypassing query |
| NOBYPASSRLS regression suite in CI | ✅ | `ci.yml:137-138`; `rls.test.ts` | Real Postgres as NOBYPASSRLS role |
| lab_connections RLS enabled | ✅ | `20260418_add_lab_connections/migration.sql:35-60` | (Corrects 2026-04-25 note that claimed RLS was missing) |

### Audit logging

| Control | Status | Evidence | Notes |
|---|---|---|---|
| 8 typed log methods | ✅ | `auditLog.ts` — `log` (237), `logAccess` (309), `logCreate` (329), `logUpdate` (352), `logDelete` (377), `logAuth` (400), `logExport` (440), `logSystem` (466) | |
| Fail-closed for PHI mutations | ✅ | `auditLog.ts:294-298` | create/update/delete/export re-throw; reads best-effort |
| Atomic with operation (caller's tx) | ✅ | `auditLog.ts:257-264` | No second pooled connection mid-tx (#17) |
| 7-year retention | ✅ | `auditLog.ts:10` (`RETENTION_DAYS = 2555`) | Cleanup scheduler ([M-38](#m-38--audit-retention-cleanup-relies-on-in-process-interval-on-scale-to-zero-medium--code-complete-infra-pending)) |
| Coverage vs PHI taxonomy | ✅ | see [§ Audit coverage vs taxonomy](#5-audit-coverage-vs-phi_taxonomy) | |

### Rate limiting (8 named limiters)

| Limiter | Window / max | Source | Notes |
|---|---|---|---|
| `standardLimiter` | 15m / 100 | `rateLimiter.ts:17-34` | Global (`app.ts:220`) |
| `authLimiter` | 15m / 20 | `rateLimiter.ts:37-50` | Auth endpoints |
| `strictAuthLimiter` | 15m / 5 | `rateLimiter.ts:53-73` | Login; email+IP keyed, failures only |
| `uploadLimiter` | 1h / 20 | `rateLimiter.ts:76-89` | File uploads |
| `sensitiveLimiter` | 1h / 10 | `rateLimiter.ts:92-105` | Sensitive ops |
| `aiLimiter` | 1h / 10 | `rateLimiter.ts:108-125` | User-keyed, Claude cost protection |
| `providerAccessRequestLimiter` | 1h / 10 | `rateLimiter.ts:133-154` | User-keyed, anti-enumeration |
| `bulkOperationLimiter` | 1h / 30 | `rateLimiter.ts:157-170` | Batch creates/imports |

Status: ✅ all 8 active; backing store is MemoryStore by default, shared Redis
behind `REDIS_URL` (`rateLimitStore.ts`). Multi-instance precision 🟡 — see
[M-37](#m-37--rate-limit-counters-are-per-instance-under-cloud-run-autoscale-medium--code-complete-infra-pending).

### Input validation

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Zod schemas at API boundary | ✅ | `backend/src/middleware/validation.ts` | UUID re-validated at RLS boundary (`database.ts:349-353`) |
| JSON Content-Type enforced | ✅ | `app.ts:252` (`requireJsonContentType`) | |
| Body size limit (10MB) | ✅ | `app.ts:248-249` | |

### External APIs

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Anthropic Claude gated on BAA | ✅ | `config/index.ts:300-313`; per-call `claudeExtraction.ts:106` etc. | See [Compliance](#8-compliance-status) |
| Google Document AI gated on BAA | ✅ | `config/index.ts:320-333`; `ocrService.ts:274` | Image pixels carry demographics |
| FHIR/SMART SSRF + exfil guard | ✅ | `fhir/urlSafety.ts:56-91` | Host allowlist (`QUEST_FHIR_AUTH_HOSTS`), blocks 169.254.169.254 |
| SendGrid sandbox prod hard-fail | ✅ | `config/index.ts:421-427` | |

### File storage

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Downloads proxied (no shareable signed URL) | ✅ | `fileController.ts:201-259` | Every download passes authenticate+RLS+ownership |
| GCS bucket name required in prod | ✅ | `config/index.ts:399-405` | Prevents cross-namespace PHI writes (F-28) |
| Filename sanitized for Content-Disposition | ✅ | `fileController.ts:243-246` | Strips quotes/CRLF |

### Logging & observability

| Control | Status | Evidence | Notes |
|---|---|---|---|
| morgan strips query string in prod | ✅ | `app.ts:231-244` | No `?token=` in Cloud Logging |
| PHI redaction before/after AI | ✅ | `utils/phiRedaction.ts:14-77` | Best-effort regex; defense-in-depth, not sole control |
| Logger sanitizer | ✅ | `backend/src/utils/logger.ts` | Email/userId redaction |
| Structured PDF redaction | ✅ | `backend/src/utils/pdfRedaction.ts` | |

### Error handling

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Centralized error handler, no internal leak | ✅ | `backend/src/middleware/errorHandler.ts` | Typed `UnauthorizedError`/`ForbiddenError`/etc. |
| Auth errors generic | ✅ | `auth.ts:111-119` | "Invalid token" / "Token expired" only |

### Data portability

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Full HIPAA export incl. health profile | ✅ | `settingsController.ts` export; P8 fix | `claudeResponseEncrypted` decrypted for export (`settingsController.ts:~613`) |
| Account deletion (per-user salt destroyed) | ✅ | `settingsController.ts` | Audit logs survive (system salt) |

### Admin

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Admin routes RBAC-gated | ✅ | `rbac.ts:358-359` (`adminOnly`) | |
| Audit-log viewer admin-only | ✅ | `auditLog.ts:505-524` (`queryLogs` admin context) | UI now built (PR #128) |

### Provider collaboration

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Consent-scoped reads under provider RLS | ✅ | P7 (`rbac.ts:202-250`, migration `20260530_add_users_select_provider`) | |
| Access-request rate limited | ✅ | `providerAccessRequestLimiter` (`rateLimiter.ts:133-154`) | |
| Engine-level users-policy column scope | 🟡 | residual | Restricted view / split tokens — Low residual |

### AI integration

| Control | Status | Evidence | Notes |
|---|---|---|---|
| BAA gate per call | ✅ | `claudeExtraction.ts:106`, `sbcExtraction.ts:767`, `aiChatController.ts:129`, `expenseController.ts:627`, `biomarkerRoutes.ts:137` | |
| Spend circuit breaker (503 at budget) | ✅ | `aiSpendGuard.ts:41-47` | Per-instance ([M-budget](#m-budget--ai-spend-accumulator-is-per-instance-medium--code-complete-same-limitation-as-m-37)) |
| PHI minimization before send | ✅ | `phiRedaction.ts`; image OCR fully gated | |
| Educational disclaimers | ✅ | CLAUDE.md product rule; AI responses | |

### Quest FHIR / lab connections

| Control | Status | Evidence | Notes |
|---|---|---|---|
| SMART-on-FHIR OAuth | ✅ | `services/fhir/smartAuth.ts` | |
| Tokens encrypted per-user | ✅ | `encryption.ts:482-485`; `services/fhir/labSyncService.ts` | |
| SSRF guard on server-supplied URLs | ✅ | `fhir/urlSafety.ts:56-91` | |
| Plan-gated | ✅ | `92f4841` (questFhirIntegration gating); `planGating.ts:37` | |

### Plan gating / billing tiers

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Plan read fresh from DB (not stale JWT) | ✅ | `planGating.ts:66-72` | Closes 15-min downgrade window |
| `planExpiresAt` enforced at request time | ✅ | `planGating.ts:73-75` | Falls back to FREE on expiry |
| Limits config | ✅ | `backend/src/config/plans.ts` | |

---

## 5. Audit coverage vs PHI_TAXONOMY

Audit-log coverage matches the expectations in
[`PHI_TAXONOMY.md#audit-log-coverage`](./PHI_TAXONOMY.md). The
`AuditLogService` exposes the eight typed methods (`log`, `logAccess`,
`logCreate`, `logUpdate`, `logDelete`, `logAuth`, `logExport`, `logSystem`) —
all in `backend/src/services/auditLog.ts` — and PHI snapshots
(`previousValueEncrypted` / `newValueEncrypted`) are encrypted with the **system
salt** so they remain readable after a user's per-user salt is destroyed on
account deletion (`auditLog.ts:148, 214-231`). Mutations fail closed
(`auditLog.ts:294-298`); reads/auth are best-effort. See
[`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) for the per-field write/read/audit matrix.

---

## 6. BAA inventory

| Vendor | Service | PHI it touches | Runtime gate | Status | Date |
|---|---|---|---|---|---|
| Anthropic | Claude API (guidance, extraction, cost analysis, chat) | PDF/SBC content, biomarker context | `ANTHROPIC_BAA_ACTIVE` (`config/index.ts:185`), per-call re-check (5 sites) | TBD (external: confirm signed BAA — Anthropic account console) | TBD (external) — flag flip recorded 2026-04-17 per project memory |
| Google Cloud | Document AI (image OCR) | Raw image pixels (name/DOB/MRN in image) | `GOOGLE_BAA_ACTIVE` (`config/index.ts:176`), `ocrService.ts:274` | TBD (external: confirm Google Cloud BAA covers Document AI — GCP Console) | TBD (external) |
| Google Cloud | Cloud SQL, GCS, Cloud Run, Cloud Logging | All PHI at rest + logs | GCP BAA (org-level) | TBD (external: confirm GCP BAA executed — GCP Console, project `ownmyhealth-prod`) | TBD (external) |
| Twilio SendGrid | Transactional email (verification, reset) | Email address (not classified PHI; redacted in logs) | sandbox prod hard-fail (`config/index.ts:421-427`) | TBD (external: BAA not required if no PHI in email body — confirm content policy with compliance owner) | TBD (external) |

The **code-level** BAA enforcement is verified ✅; the **signed-agreement
status** for each vendor lives in vendor consoles / contracts and is `TBD
(external)` — resolve with the compliance owner. Production refuses to boot if
an API key is configured without its BAA flag (`config/index.ts:300-333`), so a
mis-set flag fails safe.

---

## 7. Incidents

No security incidents are recorded in the repo (git log, session memory) since
the prior cycle. One **operational** lesson carried forward (not an exposure
event): on 2026-04-17, a Cloud Run env-var update (`ANTHROPIC_BAA_ACTIVE` flip)
was silently held back at 0% traffic because the service was pinned to an
explicit revision — `latestReadyRevisionName` ≠ `latestCreatedRevisionName` is
the detection signal; fix is `update-traffic --to-latest`. See
[`RUNBOOK.md`](./RUNBOOK.md) and [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

A standing **operational hygiene** item (not an incident): `backend/.env` has
historically held real secrets on a OneDrive-synced path; treat any
long-committed Anthropic key as rotation-due. CI secret-scanning (gitleaks) now
gates new commits (`ci.yml:114-118`).

---

## 8. Compliance status

### GCP / Anthropic BAA

| Item | Status | Evidence |
|---|---|---|
| Anthropic BAA code gate | ✅ enforced | `config/index.ts:300-313` (prod hard-fail), per-call gates |
| Google Document AI BAA code gate | ✅ enforced | `config/index.ts:320-333`, `ocrService.ts:274` |
| Signed BAAs on file | TBD (external) | Vendor consoles / contracts — see [BAA inventory](#6-baa-inventory) |

### HIPAA technical safeguards (§164.312) — code view

| Safeguard | Status | Evidence |
|---|---|---|
| §164.312(a)(1) Access control (unique user, RLS) | ✅ | `database.ts:368-377`; RLS migrations; `requireRole`/RLS suite |
| §164.312(a)(2)(iv) Encryption at rest | ✅ | `encryption.ts:262-278` (AES-256-GCM, per-user keys) |
| §164.312(b) Audit controls | ✅ | `auditLog.ts` (8 methods, fail-closed, 7-yr retention) |
| §164.312(c)(1) Integrity (GCM auth tag) | ✅ | `encryption.ts:274, 317-322` |
| §164.312(d) Person/entity authentication | ✅ | JWT + bcrypt(13) + lockout |
| §164.312(e)(1) Transmission security (TLS) | ✅ | Cloud Run HTTPS-only; secure cookies |
| §164.524 Right of access (export) | ✅ | full export incl. health profile (P8) |

Full control-by-control posture: [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).

### SOC 2 roadmap

TBD (external: SOC 2 program start date and auditor selection — ask the
compliance owner; not derivable from the repo).

---

## 9. Posture trendline

| Cycle | Critical open | High open | Medium open | Low open | Grade |
|---|---|---|---|---|---|
| 2026-06-01 (this) | 0 (C-8 mitigated-in-prod) | 0 | ~6 (code-complete, infra-pending) | ~33 | B+ |
| 2026-05-29 | 1 (C-8 pre-cutover) | 16 | 33 | 33 | C+ |
| 2026-04-25 | 1 (C-8) | 12 | 50 | 65 | B |

The 2026-05-29 sweep re-discovered a *larger* High tier (16 vs 12) than the
2026-04-25 baseline because it traced wiring rather than presence ("controls
designed but not wired" theme). The 2026-05-29/05-30 remediation then drove all
High + Medium to closed in code. Source: `PROJECT_ANALYSIS_2026-05-29.md`,
`ownmyhealth-2026-05-30-backlog`.

---

## 10. Next-audit trigger

Re-run [`prompts/24-full-security-audit.md`](../prompts/24-full-security-audit.md)
(which orchestrates the per-area prompts below) when **any** of:

1. A new PHI field is added (new `*Encrypted` column / `PHI_FIELDS` change in
   `encryption.ts:410-486`).
2. A new external data egress is added (new third-party API receiving any user
   data — extends the [BAA inventory](#6-baa-inventory)).
3. RLS policies change (any new migration under `backend/prisma/migrations/`
   touching policies/triggers).
4. The auth or session model changes (token lifetime, revocation, cookie flags).
5. Infra provisioning lands for M-37 / M-38 (Memorystore + Cloud Scheduler) —
   re-verify the shared-store path under multi-instance load.
6. **Calendar**: quarterly, even with no triggering change (per
   [`_doc-quality.md`](../prompts/_doc-quality.md) refresh cadence).

Per-area re-audit prompts (in `prompts/`): `01-rls`, `02-encryption`,
`03-auth`, `04-csrf`, `05-audit-logging`, `06-rbac`, `07-input-validation`,
`08-error-handling`, `09-external-apis`, `10-file-storage`, `11-demo-mode`,
`12-rate-limiting`, `13-secrets`, and `26-31` (`26-fhir`, `27-ai-integration`,
`28-file-egress`, `29-data-portability`, `30-admin`, `31-logging-observability`),
plus `32`.

---

## Acceptance questions (self-check)

1. **Current grade + what changed?** B+ — the entire High + Medium + infra
   backlog was remediated and merged 2026-05-29/05-30 (§ Header, §1, §9).
2. **Open Criticals + plan?** None open; C-8 mitigated in prod by startup
   hard-exit, residual is dev/staging NOBYPASSRLS cutover ([C-8](#c-8--rls-not-enforced-under-a-bypassrls-login-critical--mitigated-in-prod-residual-in-devstaging)).
3. **Closed this cycle + PR?** §3 table (C-1/#30, P1-P8, #9/#111, #26/#110,
   #37/#125, #38/#126, etc.).
4. **C-7 (PHI-to-Claude) + C-8 (BYPASSRLS) status?** C-7 ✅ closed (BAA gate, 5
   call sites + Doc-AI); C-8 ✅ mitigated-in-prod ([C-8](#c-8--rls-not-enforced-under-a-bypassrls-login-critical--mitigated-in-prod-residual-in-devstaging)).
5. **Controls ✅ vs 🟡 vs ⚠️?** §4 — nearly all ✅; 🟡 are key-rotation
   procedure, multi-instance rate-limit/spend, engine-level users-policy scope.
6. **BAAs signed vs pending?** Code gates ✅; signed-agreement status TBD
   (external) per vendor (§6).
7. **Last audit + next trigger?** Last 2026-05-29; triggers in §10.
8. **Verification for most recent closed Critical?** C-8 final piece (PR #109):
   `rls.test.ts` 11/11 under NOBYPASSRLS in CI `rls` job (§3 footnote).
9. **Audit coverage vs PHI_TAXONOMY?** Matches — 8 typed methods, fail-closed
   mutations, system-salt PHI snapshots (§5).
10. **Owner for each open High?** No open Highs; residual Medium owners are infra
    (TBD external) (§2).

---

## Related Documents

- [SECURITY_AUDIT_core.md](./SECURITY_AUDIT_core.md) — per-area findings: auth, CSRF, RBAC, encryption, RLS, audit (doc pending — generated this batch via prompt `../prompts/24-full-security-audit.md`; synthesize, don't re-audit).
- [SECURITY_AUDIT_domain.md](./SECURITY_AUDIT_domain.md) — domain-layer findings: biomarkers, insurance, expenses, health goals/needs (doc pending — see prompt `../prompts/24-full-security-audit.md`).
- [SECURITY_AUDIT_infrastructure.md](./SECURITY_AUDIT_infrastructure.md) — infra findings: rate limiting, secrets, deployment, RLS role cutover (doc pending — see prompt `../prompts/24-full-security-audit.md`).
- [SECURITY_AUDIT_periphery.md](./SECURITY_AUDIT_periphery.md) — periphery findings: AI integration, FHIR, file egress, logging, admin (doc pending — see prompt `../prompts/24-full-security-audit.md`).
- [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) — control-by-control §164.312 technical safeguards posture.
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — open Low/Info residuals and accepted limitations.
- [CHANGELOG.md](./CHANGELOG.md) — closing PRs in release order.
- [DATA_MODEL.md](./DATA_MODEL.md) — RLS policies, cascade behavior, per-model schema.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — per-field PHI × encryption × audit coverage (evidence locations).
- [ENV_VARS.md](./ENV_VARS.md) — BAA flags, `REDIS_URL`, `AUDIT_CLEANUP_TOKEN`, AI budgets, secret classification.
- [RUNBOOK.md](./RUNBOOK.md) — operational remediation steps (Memorystore/Scheduler provisioning, key rotation, Cloud Run revision pinning).
- [ARCHITECTURE.md](./ARCHITECTURE.md) — auth flow, middleware stack, deployment topology.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Cloud Run env-update revision-pinning gotcha.

---

## Prompt drift log

- `./21-security-status-doc.md` "Files to review" lists existing
  `SECURITY_AUDIT_core.md` / `_domain.md` / `_infrastructure.md` /
  `_periphery.md` as **primary** inputs. None of those four files exist in
  `New Project Documents/` at writing (only `LOCAL_DEV.md`,
  `TESTING_PATTERNS.md`, `ENV_VARS.md`, `PHI_TAXONOMY.md` are present) — they are
  being generated in the same batch. This doc therefore synthesizes from live
  code + git + `PROJECT_ANALYSIS_2026-05-29.md` instead, and cross-links the four
  audit docs as siblings pending generation.
- The open-findings template in the prompt presents `C-8` as the lead **open**
  Critical with `Owner: TBD` and `ETA: TBD`. At HEAD `13db267` the C-8 app-layer
  and startup-assertion work is **merged** (PRs #40-#43, #105, #109); the prod
  exposure is closed by `database.ts:248-255`. Reclassified here as
  *mitigated-in-prod, residual dev/staging cutover* rather than open Critical.
  Prompt author should refresh the template's worked example.
- The prompt's closed-findings example cites `backend/src/services/rls.test.ts`.
  The regression suite exists at that path and runs in CI under NOBYPASSRLS
  (`.github/workflows/ci.yml:137-138`); confirmed, no drift on that path.
- 2026-04-25 memory (`ownmyhealth-2026-04-25-audit`) flagged a likely RLS gap in
  `20260418_add_lab_connections` ("comment promises RLS but SQL body lacks
  ENABLE ROW LEVEL SECURITY"). The current migration body **does** contain
  `ALTER TABLE lab_connections ENABLE ROW LEVEL SECURITY` + 4 policies
  (`migration.sql:35-60`). That earlier note is stale — corrected here.
- The prompt's BAA enforcement note (`No-TBD enforcement`) says the Claude gate
  is re-checked in `biomarkerRoutes`, `aiChatController`, `claudeExtraction`,
  `sbcExtraction`, and `expenseController`, and OCR in `ocrService`. All six
  confirmed in code (citations in §4 / §6). No drift.
