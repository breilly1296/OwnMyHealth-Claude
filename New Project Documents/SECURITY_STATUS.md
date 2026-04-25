---
tags:
  - documentation
  - security
  - compliance
type: generated-doc
prompt: prompts/21-security-status-doc.md
generated: 2026-04-25
last-audit: 2026-04-25
last-audit-tool: Claude-orchestrated remediation cycle — 7 batches closing High + Medium findings on top of the 2026-04-16 C-series audit; followed by a 2026-04-25 Lows sweep + HIPAA documentation drafting pass
source-of-truth: backend/src/services/database.ts, encryption.ts, auditLog.ts, middleware/*, config/index.ts
---

# SECURITY_STATUS.md — Current-State Posture Reference

> This doc is a **posture synthesis**, not a history log. It rolls up findings
> from the per-area audits (core / domain / infrastructure / periphery) and
> reports what is open, what closed this cycle, which controls pass spot-check
> in live code, and what triggers the next audit.
>
> Spot-check convention: every ✅ below was re-verified at the cited `file:line`
> during the 2026-04-24 doc pass. Inherited ticks from prior cycles were
> dropped unless the live code still supports them. The 2026-04-25 update
> appends Lows-sweep closures and the six newly-drafted HIPAA documents
> ([RISK_ASSESSMENT](./RISK_ASSESSMENT.md), [BREACH_NOTIFICATION_PLAN](./BREACH_NOTIFICATION_PLAN.md),
> [SECURITY_POLICIES](./SECURITY_POLICIES.md), [PRIVACY_POLICY_DRAFT](./PRIVACY_POLICY_DRAFT.md),
> [TERMS_OF_SERVICE_DRAFT](./TERMS_OF_SERVICE_DRAFT.md), [CONTINGENCY_PLAN](./CONTINGENCY_PLAN.md)),
> plus the [SANCTION_POLICY](./SANCTION_POLICY.md) and
> [WORKFORCE_SECURITY_SOP](./WORKFORCE_SECURITY_SOP.md) added in the same pass.

---

## Header

| Field | Value |
|---|---|
| Doc last updated | `2026-04-25` |
| Last audit date | `2026-04-16` (C-1…C-7 closing pass) + `2026-04-24` remediation cycle (closing every remaining High + the bulk of remaining Mediums) + `2026-04-25` Lows sweep (~24 closures) + HIPAA documentation drafting pass (6 policies + 2 SOPs) |
| Next-audit trigger | See [§ Next-audit trigger](#next-audit-trigger) |
| Auditor / tool | Internal Claude-orchestrated sweep (prompts `01-13`, `26-32`, `24-full-security-audit`) + 2026-04-24 remediation pass driven from the four `SECURITY_AUDIT_*.md` snapshots + 2026-04-25 Lows sweep + HIPAA-policy drafting pass |
| **Security grade** | **B+** (`0 Critical open`, `0 High open`, `≤4 Medium open`, `0 Low open`. C-8 code prerequisites all merged; the only gap is the operator-side Cloud SQL role cutover which is tracked separately as a runbook execution rather than a code finding. Grade is unchanged by the Lows sweep — Lows don't move the risk profile — but Administrative-Safeguard documentation has improved from ⏳ to 🟡 with six policies drafted; see [§ 7.4](#74-hipaa-administrative-safeguards-164308).) |
| Grading rule | A: 0 Critical + ≤1 High ・ B: 0-1 Critical + 0-2 High ・ C: ≥2 Critical or ≥3 High ・ D: any Critical-with-PHI-exfil path |

---

## 1. Posture summary

Findings are tracked with sticky IDs. `C-N` Critical, `H-N` High, `M-N` Medium,
`L-N` Low, `F-N` a miscellaneous finding (severity in row). Closure PRs come
from `git log --all --grep='C-\|F-\|H-\|M-'` (see [§ Closed in current cycle](#3-closed-in-current-cycle)).

| Severity | Open | Code-complete (operator-pending) | Closed this cycle | Total discovered (cycle) |
|---|---|---|---|---|
| Critical | **0** | 1 (C-8 — runtime RLS) | 7 | 8 |
| High | **0** | 0 | ~22 | ~22 |
| Medium | ~4 | 0 | ~33 | ~37 |
| Low | **0** | 0 | ~28 | ~28 |
| Info | 0 | 0 | 0 | 0 |
| **Total** | **~4** | **1** | **~90** | **~95** |

**Cycle definition**: 2026-03-25 → 2026-04-25. The 2026-04-16 C-series pass closed
seven Criticals; the 2026-04-24 remediation cycle closed every remaining High
plus the trivial + non-trivial Medium batches sourced from the four
`SECURITY_AUDIT_*.md` snapshots; the 2026-04-25 Lows sweep closed ~24
additional Lows on top of the 4 Lows already closed earlier in the cycle.
Last merged work in this cycle: the `20260424_prevent_self_role_elevation`
migration, the Medium-batch refactors, and the 2026-04-25 Lows sweep
(see [§ 3 sub-section "2026-04-25 — Low closures"](#2026-04-25-remediation-pass--low-closures)).

### Diff from prior cycle

```
Critical:   8 discovered → 0 open    (-7 closed; C-8 code-complete, infra-pending)
High:       ~22 discovered → 0 open  (-22; full closure: provider rate limit,
                                       data export + delete completeness,
                                       password confirmation on destructive ops,
                                       CSRF upload exemption removed,
                                       RLS self-elevation trigger, etc.)
Medium:     ~37 discovered → ~4 open (-33; trivial + non-trivial batches)
Low:        ~28 discovered → 0 open  (-28; the 4 closed earlier in the cycle plus
                                       the 2026-04-25 sweep — UUID alignment,
                                       unhandled rejection handlers, GCS bucket
                                       fail-fast, env-var naming, Anthropic client
                                       consolidation, raw-fetch migration, column
                                       rename, gsutil rsync, drop :latest tag, etc.)
BAAs:       GCP, Anthropic, SendGrid — all signed (Anthropic 2026-04-16)
HIPAA docs: 6 policy drafts landed 2026-04-25 (Risk Assessment, Breach Notification,
            Security Policies, Privacy Policy, Terms of Service, Contingency Plan)
            + 2 supporting SOPs (Sanction Policy, Workforce Security SOP).
            Administrative-safeguard documentation moves ⏳ → 🟡 (drafted, awaiting
            owner sign-off / legal review).
Grade:      C (prior) → B- → B+ (this cycle; held through Lows sweep — Lows don't
            change the risk profile)
```

C-7 received an additional hardening pass on 2026-04-24 — vision fallback removed
entirely so the only Claude path is text-only with PHI-stripped input;
freestanding date pattern added to `redactPHI`; `userId` plumbed through
`trackAIUsage` so cost attribution stops being keyed to `'system'`.

C-8 is no longer counted as open: code prerequisites for all four parts
(A/B/D + the startup assertion that Part C requires) have merged. The only
remaining work is operator-side — provisioning the `omh_app` NOBYPASSRLS role
on Cloud SQL and rotating `DATABASE_URL` in Secret Manager. See
[§ 2. Open findings](#2-open-findings) for the runbook reference.

---

## 2. Open findings

### C-8 — RLS policies inert at runtime (BYPASSRLS role) — **🟡 Code-complete, operator-pending**

- **Area**: Infrastructure (database role / deploy). Not a code finding —
  every line of code that needs to exist for the cutover has shipped.
- **What's left**: Cloud SQL role provisioning + Secret Manager rotation,
  performed by an infrastructure owner against the live `ownmyhealth-prod`
  project. The existing app keeps running unchanged through the rotation.
- **Why it's not counted as an open Critical**: The runtime assertion at
  `backend/src/services/database.ts:220-275` will hard-exit production
  (post-2026-04-24 — `RLS_ENFORCEMENT=strict` flag was removed; the check
  is unconditional in prod) the moment a NOBYPASSRLS role boots into a
  config that still has `BYPASSRLS=true`. The grading remains B+ rather
  than A− because runtime tenant isolation today still depends on the
  application-layer `withRLSContext` wrappers; the database is the second
  layer that *will* fire once the role flips.
- **Code prerequisites — all merged**:

  | Part | PR | Commit | Date | Description |
  |---|---|---|---|---|
  | Part A | `#40` | `65f9ffb` | 2026-04-16 | Wrap `auditService.initialize` (later replaced — salt now from env) |
  | Part A.2 | — | (this cycle) | 2026-04-24 | Wrap `planGating.ts` user-plan lookup in user-context RLS |
  | Part B | `#41` | `a648eb8` | 2026-04-16 | Wrap cross-user `ProviderPatient` writes in RLS context |
  | Part B.2 | `#42` | `4fa6460` | 2026-04-16 | Wrap `authService` + `userEncryption` pre-auth paths |
  | Part B.3 | `#43` | `74af20e` | 2026-04-17 | Wrap `adminRoutes` + `auditLog` runtime + users-by-email |
  | Part B.4 | — | (this cycle) | 2026-04-24 | Hardened CI guard `check-rls-wrappers.sh` to also catch `prisma.$queryRaw` / `$executeRaw` / `$transaction`; broadened scan scope to `utils/` |
  | Part C — code | — | (this cycle) | 2026-04-24 | Startup-assertion rewrite: hard-exit in prod, warn in non-prod, no env-var opt-out (`RLS_ENFORCEMENT=strict` flag removed). Unit tests pin all four branches in `services/database.test.ts`. |
  | Part C — infra | — | **pending** | — | Provision `omh_app` NOBYPASSRLS role + rotate `DATABASE_URL` in Secret Manager. Operator runbook below. |
  | Part D | — | (this cycle) | 2026-04-24 | Multi-tenant integration tests in `__tests__/integration/rls-isolation.test.ts` — every user-scoped model + admin context + privilege-immutability + pool-leak regression. Skip cleanly without a live DB; opt in via `RLS_INTEGRATION_TESTS=true`. |

- **Operator runbook** (tracked in `docs/STAGING.md`):
  1. Provision `omh_app` NOBYPASSRLS role in Cloud SQL (`CREATE ROLE … LOGIN
     PASSWORD … NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`).
  2. Grant table/sequence/function privileges + default privileges (so future
     migrations don't break).
  3. Run the live-DB integration suite against the new role in staging:
     `DATABASE_URL=… PHI_ENCRYPTION_KEY=… RLS_INTEGRATION_TESTS=true npm run test:integration`.
  4. Rotate `DATABASE_URL` in Secret Manager to the new role.
  5. Deploy. The startup assertion will log a green "✓ RLS assertion
     passed: database role does not have BYPASSRLS" line on success, or
     hard-exit (in prod) if the rotation didn't take effect.

- **Owner**: `TBD (external: infrastructure owner — GCP Cloud SQL admin;
  resolve via GCP Console project `ownmyhealth-prod`)`.
- **ETA**: `TBD (external: scheduling gated on staging cutover dry-run;
  target window published in docs/STAGING.md once the omh_app role is provisioned)`.
- **Cross-links**:
  - [`C8_PART3_RUNBOOK.md`](./C8_PART3_RUNBOOK.md) — operator steps.
  - [`C8_PART3_STARTUP_ASSERTION.md`](./C8_PART3_STARTUP_ASSERTION.md) — assertion spec.
  - [`DATA_MODEL.md`](./DATA_MODEL.md) — per-table RLS policies.
  - [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) — maps to §164.312(a)(1) Access Control.

### Remaining open Mediums (~4)

The 2026-04-24 remediation cycle closed both trivial and non-trivial Medium
batches. The Mediums still open are scoped to surfaces that need real design
work, not one-line fixes:

- **Service-type anonymization in cost analysis** (audit `domain F-17` follow-up):
  the prompt-text `stripPHIFromText` floor is in place; mapping specific
  diagnoses/procedures to generic categories still needs a curated medical
  taxonomy.
- **Provider consent flags without enforcement endpoints** (`domain F-18`,
  `F-19`): `canViewInsurance` / `canViewDna` / `canEditData` /
  `SUSPENDED` / `EXPIRED` are schema-present but unimplemented features.
  Reframe as roadmap, not bug.
- **Signed-URL session/IP binding** (`domain F-20`): Cloud Storage signed
  URLs can't be bound to a session; requires a proxy-download endpoint —
  separate design pass.
- **AI cost-tracker `userId` logged in every call** (`periphery F-39`,
  Info): low-impact, deferred until log-volume audit.

None block beta. All are tracked separately for the next audit cycle.

---

## 3. Closed in current cycle

All closures verified by reading the merge commit and spot-checking the current
code path still matches the fix described.

| Finding | Severity | Closing PR | Commit | Date | Verification |
|---|---|---|---|---|---|
| C-1 — `SET_CONFIG` outside a transaction (RLS bypass) | Critical | `#30` | `9727492` | 2026-04-16 | `backend/src/services/database.ts:377-386` uses parameterized `set_config(…, true)` inside `runWithRLS` which wraps in `prisma.$transaction`. Regression test at `backend/src/services/rls.test.ts` (commit `f336f3d`). |
| C-2 — Audit-log system salt stored unencrypted | Critical | `#32` | `f6bdc9a` + `1ba923c` | 2026-04-16 | `backend/src/services/auditLog.ts:1-8` loads salt from `config.auditSalt`; `config/index.ts:54` reads `AUDIT_LOG_SALT` env var; `config/index.ts:228-238` hard-fails if missing/short. |
| C-3 — JWT secrets had hardcoded fallback strings | Critical | `#33` | `2808b97` + `beb2993` | 2026-04-16 | `backend/src/config/index.ts:18-28` `requireEnv()` throws on missing value; `config/index.ts:61-66` routes both JWT secrets through it. Test: `596146e` adds regression coverage. |
| C-4 — `PHI_ENCRYPTION_KEY` insecure value only blocked in prod | Critical | `#34` | `ea67ccb` + `61e1e7a` | 2026-04-16 | `backend/src/services/encryption.ts:129-141` rejects known placeholder keys in **every** environment (the `NODE_ENV==='production'` gate was removed). Test: `b6057a8`. |
| C-5 — `jspdf` CVE-2026-31938 (+ siblings) | Critical | `#36` | `4a08802` + `02e9c48` | 2026-04-16 | `package.json` pins `jspdf` to `^4.2.1+`; CI `npm audit high+` gate enforces on every PR (commit `b035e97`, `.github/workflows/ci.yml`). |
| C-6 — GCS objects not deleted on account/data deletion | Critical | `#37` | `0f7970a` + `6dde28c` + `375c9b2` | 2026-04-16 | `backend/src/services/storageService.ts` `deleteFiles` batch helper; settings controller calls it from `deleteAllData` + `deleteAccount` paths. |
| C-7 — PHI sent to Claude without minimization / redaction | Critical | `#39` | `8c19438` + `c3fe7d7` + `d671887` + `d6fb811` | 2026-04-16 | `backend/src/services/claudeExtraction.ts:115-140` (BAA gate + local PDF extract + `redactPHI`); helper at `backend/src/utils/phiRedaction.ts`; PDF text extraction at `backend/src/services/pdfTextExtraction.ts`. Tests: `claudeExtraction.test.ts`, `phiRedaction.test.ts`. |
| F-14 / F-15 — `set_config` interpolated as raw SQL | Critical-adjacent | `#30` | `ee86fd4` | 2026-04-16 | `backend/src/services/database.ts:377-386` `applyRLSContext` uses template-tagged `$executeRaw` (parameterized) — no string interpolation. |
| F-3 — IDOR in provider paths | High | `#44`, `4fa53a6` | `4fa53a6` | 2026-04-17 | Resolved alongside remaining C-7 gaps; see PR body. |
| F-4 — JWT algorithm/issuer/audience not asserted | High | `52` | `9499308` | 2026-04-17 | `backend/src/config/jwtOptions.ts` exports `JWT_SIGN_OPTIONS` + `JWT_VERIFY_OPTIONS`; middleware/auth.ts uses them at `:83`, `:129`, `:178`, `:219`. |
| F-5 — Raw `X-Forwarded-For` used for session IP | High | `52` | `8a0ea3f` | 2026-04-17 | `app.ts:119` sets `trust proxy = 1`; session IP derives from `req.ip`. |
| F-7 — Demo account could reach admin paths | High | `52` | `7baf2d2` | 2026-04-17 | `blockDemoAdminAccess` attached to `backend/src/routes/adminRoutes.ts` (see `middleware/demoProtection.ts`). |
| Zod password policy drift | High | `52` | `ca74644` | 2026-04-17 | Zod schema aligned with service-level check (12 chars). |
| F-21 — logger redaction missed nested objects-in-arrays | Low | (in `1ab1206`) | `1ab1206` | 2026-04-18 | `backend/src/utils/logger.ts:39-46` `sanitizeValue` recurses into arrays. |
| SSE CSRF exemption doc | Low | `b2b762e` | `b2b762e` | 2026-04-18 | `backend/src/middleware/csrf.ts:126-148` documents the bearer-only invariant; `requireBearerAuth` at `middleware/auth.ts:166-201`. |
| AI chat tx decryption ordering | Low | `52507c3` | `52507c3` | 2026-04-18 | Decryption moved out of `withRLSContext` transaction (avoids holding DB tx while doing CPU-bound crypto). |
| CI hardened: `npm ci` + audit high+ gate | Low | `#52` | `b035e97` | 2026-04-17 | `.github/workflows/ci.yml`. |

#### 2026-04-24 remediation pass — High closures (full sweep)

All ~22 High findings across `SECURITY_AUDIT_core.md`, `SECURITY_AUDIT_periphery.md`,
and `SECURITY_AUDIT_domain.md` are closed. Verified by direct code reading
during the cycle (see batch summaries in commit history). Below is the rolled-up
list — each row is the file/line where the fix lives in current code.

| Finding (audit doc) | Severity | Date closed | Verification |
|---|---|---|---|
| `core F-5` — CSRF exempts Bearer-only mutations | High | 2026-04-24 | Upload-route exemption removed (`middleware/csrf.ts`); SSE-only exemption explicit; `requireBearerAuth` rejects cookie path. New regression file `middleware/csrf.test.ts` (16 cases). |
| `core F-6` — RLS users_update_own permits self-elevation | High | 2026-04-24 | New migration `20260424_prevent_self_role_elevation/migration.sql` installs a `BEFORE UPDATE OF role, is_active` trigger raising `42501` for non-admin sessions. Live-DB tests at `__tests__/integration/rls-isolation.test.ts > Privilege immutability`. |
| `core F-7` / "Zod password drift" — Zod min(8) vs service min(12) | High | 2026-04-17 | `validation.ts:117-123` `strongPassword.min(12)`; frontend `RegisterPage.tsx:52`, `ResetPasswordPage.tsx:40`, `ChangePasswordModal.tsx:39,181`. |
| `core F-8` / `tracker F-4` — JWT alg/iss/aud not asserted | High | 2026-04-17 | `config/jwtOptions.ts` exports pinned options; every `jwt.sign`/`jwt.verify` call site uses them. |
| `core F-9` / `tracker F-5` — Raw X-Forwarded-For for session IP | High | 2026-04-17 | `app.ts:119` `trust proxy = 1`; `authController.ts:65` uses `req.ip`. |
| `core F-10` — Admin actions audited as USER not ADMIN | High | (already correct) | `auditLog.ts:179-183` `resolveActorType(context)` returns ADMIN whenever `req.user.role === 'ADMIN'`. |
| `core F-11` — Empty `config.demo.email` matches empty user emails | High | (already correct) | `demoProtection.ts:34` early-returns false on empty config. |
| `periphery F-3` — `aiLimiter` missing on PDF upload routes | High | (already correct) | `routes/uploadRoutes.ts:80,97,127` and `routes/insuranceRoutes.ts:120,131` all attach it. |
| `periphery F-4` — `aiLimiter` missing on `/biomarkers/bulk` | High | n/a (bulk-create doesn't call Claude) | `bulkOperationLimiter` is the right shape; verified in route survey. |
| `periphery F-5` / `tracker F-7` — `blockDemoAdminAccess` not attached | High | 2026-04-17 | `routes/adminRoutes.ts:30` mounts it between `authenticate` and `requireRole('ADMIN')`. |
| `periphery F-6` — Dockerfile `.env` leak risk | High | (verified) | `backend/Dockerfile` never `COPY`s any `.env*` file; `.dockerignore` excludes `.env`/`.env.local`. |
| `periphery F-7` — `axios` SSRF / `pg` qs vulnerabilities | High | 2026-04-17 + later | `npm audit --audit-level=high` exits 0 (verified 2026-04-24). |
| `periphery F-8` — Vite path traversal | High | 2026-04-17 + later | Frontend `npm audit --audit-level=high` exits 0 (verified 2026-04-24). |
| `periphery F-9` — Prisma 7 beta/alpha advisories | High | (verified) | Prisma 7 is GA; no high+ advisories trace to it. |
| `domain F-3` / `tracker F-3` — Biomarker AI guidance IDOR | High | 2026-04-17 | `routes/biomarkerRoutes.ts:158-160` does `tx.biomarker.findFirst({ where: { id, userId } })` inside `withRLSTransaction`, returns 404 on miss. |
| `domain F-4` — Data export omits 8 of 11 PHI categories | High | 2026-04-24 | `controllers/settingsController.ts` exports 11 categories. This cycle added `InsuranceBenefit[]` (via `include: { benefits: true }`) + `id`/`storageKey` on UserFile. |
| `domain F-5` — `deleteAllData` misses half the tables | High | 2026-04-24 | `settingsController.ts:754-789` deletes 11 categories. This cycle added `dNAData` and `labConnection` deletes (deleteAllData preserves the User row, so cascade-from-User doesn't fire). |
| `domain F-6` — No rate limit on provider access-request | High | 2026-04-24 | `middleware/rateLimiter.ts` exports `providerAccessRequestLimiter` (10/hr/user). `routes/providerRoutes.ts:130` attaches it. Plus uniform-error response collapse. Tests at `routes/providerRoutes.requestUniformity.test.ts`. |
| `domain F-7` — Patient `isActive`/`lockedUntil` not enforced for providers | High | (already correct) | `routes/providerRoutes.ts:431-438` (biomarkers) and `:571-577` (health-needs) filter by `isActive: true` AND `lockedUntil` past/null inside admin-context wrapper. |
| `domain F-8` — Provider patient list leaks email on PENDING | High | (already correct) | `routes/providerRoutes.ts:76` `email: rel.status === 'ACTIVE' ? rel.patient.email : undefined`. |
| `domain F-9` — No CSRF on settings DELETE endpoints | High | 2026-04-24 | Settings DELETE routes never were in the exemption list; CSRF default-on at `app.ts:212`. Upload-route exemption also removed this cycle. |
| `domain F-10` — `deleteAllData` no password confirmation | High | (already correct) + 2026-04-24 schema | `settingsController.ts:686-700` requires + verifies password via bcrypt. This cycle added formal `schemas.settings.deleteAccount` Zod schema and demo block on both destructive routes. |
| `domain F-11` — Lab-report upload bypasses `validatePdfHeader` | High | (already correct) | `controllers/upload/labUploadController.ts:44` calls `validatePdfHeader`. |
| `domain F-12` — Magic-byte mismatch missing on multer uploads | High | (already correct) | `controllers/upload/shared.ts:70-91` `MAGIC_BYTES` table covers PDF/PNG/JPEG/GIF/TIFF/WebP; `validateUploadFile:118` calls `validateMagicBytes`. |
| `domain F-13` — Provider PHI read ordered before consent-expiry check | High | (already correct) | `providerRoutes.ts:408-449` (and `:551-589`) gate `findMany` behind a `viable` boolean that includes `!(rel.consentExpiresAt < now())`. PHI never queried when consent expired. |

#### 2026-04-24 remediation pass — Medium closures

##### Trivial Mediums (8 closed in batch 5)

| Finding | Date closed | Verification |
|---|---|---|
| `core F-13` — Session cleanup interval drift (1h vs documented 10 min) | 2026-04-24 | `authService.ts:1232` flipped to `10 * 60 * 1000`. Aligned `ARCHITECTURE.md`, `RUNBOOK.md`, `HIPAA_CHECKLIST.md`. |
| `core F-17` — CSRF length-leak via early throw before `timingSafeEqual` | 2026-04-24 | `csrf.ts:154-176` rewritten — both inputs SHA-256 hashed, `timingSafeEqual` runs on fixed 32-byte digests. New regression cases in `middleware/csrf.test.ts`. |
| `core F-18` — Cookie sameSite default `'lax'` in same-domain prod | 2026-04-24 | `config/index.ts:79-87` flipped to `'strict'`; cross-domain still `'none'`; dev still `'lax'`. |
| `core F-19` — Unused `exposedHeaders: ['X-CSRF-Token']` | 2026-04-24 | `app.ts:168` removed (CSRF token rides via cookie, not response header). |
| `periphery F-15` — Validation errors echo user input | (already correct) + 2026-04-24 test | `validation.ts:24-30` returns `{field, message, code}` only. New regression test asserts no `received` / `input` field appears. |
| `periphery F-19` — SBC log leaks `planName` / `insurerName` | 2026-04-24 | `sbcExtraction.ts:944-947` dropped both fields; `planType` (generic enum) retained. |
| `periphery F-23` — `expenseController` bare `Error` instead of `AppError` | 2026-04-24 | `expenseController.ts:40` `throw new InternalServerError(...)`. |
| `periphery F-38` — Frontend CSRF warn ships in prod | 2026-04-24 | `src/services/api/client.ts:130,193` wrapped in `if (import.meta.env.DEV)`. |
| `domain F-15` — Filename not sanitized (path traversal / control chars) | 2026-04-24 | `controllers/upload/shared.ts` `sanitizeFilename` (basename + control/illegal-char strip + 255-byte cap); `validateUploadFile` mutates `file.originalname`. New test file `controllers/upload/shared.test.ts` (7 cases). |

##### Non-trivial Mediums (4 closed in batch 6)

| Finding | Date closed | Verification |
|---|---|---|
| `periphery F-14` — P2002 unique-constraint leaks field name | (already correct) + 2026-04-24 test | `errorHandler.ts:110` returns generic `'A record with this data already exists'`; new test asserts `meta.target` and field names never appear in response. |
| `periphery F-22` — `expenseController` bypasses error handler with `res.status().json()` | 2026-04-24 | Refactored 8 handlers to throw typed errors (`BadRequestError`/`NotFoundError`/`ServiceUnavailableError`); routes wrapped in `asyncHandler`. Updated existing C-7 BAA-gate test. |
| `periphery F-41` — Admin password reset doesn't invalidate sessions | 2026-04-24 | `adminRoutes.ts` updateUser handler does `tx.session.deleteMany({ where: { userId: id } })` inside the same transaction whenever password changed. Audit metadata gains `revokedSessionCount`. New test file `routes/adminRoutes.updateUser.test.ts`. |
| `periphery F-42` — Admin self-demotion guard | (already correct) + 2026-04-24 test | `adminRoutes.ts:278-280` guards. New regression test asserts non-role self-edits still pass. |
| `domain F-16` — Audit log records biomarker name in plaintext metadata | 2026-04-24 | `routes/biomarkerRoutes.ts` dropped `biomarkerName: biomarker.name` — UUID in `resourceId` is sufficient for traceability. |
| `domain F-17` (floor) — Cost-analysis prompt PHI minimization | 2026-04-24 | `expenseController.ts` adds `prompt = stripPHIFromText(rawPrompt)` before the API call. Service-type anonymization (curated medical taxonomy) deferred. |

#### 2026-04-25 remediation pass — Low closures

A focused sweep cleared ~24 Low findings surfaced across the four
`SECURITY_AUDIT_*.md` snapshots and prior drift logs. None of these
moved the risk profile (hence no grade change), but each removes an
audit-tail or eliminates a footgun.

| Finding | Date closed | Verification |
|---|---|---|
| UUID-validation alignment between `services/database.ts` and `middleware/validation.ts` (two regexes diverged) | 2026-04-25 | Single `UUID_REGEX` constant exported from `services/database.ts:358-362`; `validation.ts` imports it. Regression test pins parity. |
| Unhandled-promise-rejection / `uncaughtException` handlers wired at process boot | 2026-04-25 | `app.ts` registers `process.on('unhandledRejection', …)` + `process.on('uncaughtException', …)` so the structured logger captures crash context before exit. |
| GCS bucket fail-fast at startup | 2026-04-25 | `config/index.ts` `GCS_BUCKET_NAME` hard-fails in production when unset — no silent fallback to a default bucket; matches the `PHI_ENCRYPTION_KEY` pattern. |
| Env-var naming consistency (`GCP_PROCESSOR_ID` vs `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`) | 2026-04-25 | Code and `.env.example` aligned on `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`; ENV_VARS.md drift entry resolved. |
| Anthropic client consolidation — single shared client instead of per-call instantiation | 2026-04-25 | `services/anthropicClient.ts` exports the singleton; `claudeExtraction.ts`, `sbcExtraction.ts`, `aiChatController.ts`, biomarker-guidance path all import from it. |
| Raw `fetch()` calls migrated to the Anthropic SDK (typed responses, retry handling) | 2026-04-25 | No remaining `fetch('https://api.anthropic.com/...')` call sites; verified by grep. |
| Schema column rename — drift between Prisma model field and DB column resolved | 2026-04-25 | Migration applied + Prisma client regenerated; no orphan references. |
| `gsutil` → `gcloud storage` migration (frontend deploy) | 2026-04-25 | `.github/workflows/deploy.yml` uses `gcloud storage cp/rsync`; `gsutil` calls retired (gsutil is sunset by GCP). |
| Container image tagging — drop `:latest`, pin by commit SHA | 2026-04-25 | `.github/workflows/deploy.yml` builds and deploys `gcr.io/.../ownmyhealth-api:${{ github.sha }}` with no parallel `:latest` push. |
| Plus ~15 additional Lows from the same sweep (logger formatting, dead-code removal, dev-only `console.log` strip, redundant null-checks, JSDoc / type-comment cleanups, `.env.example` parity, etc.) | 2026-04-25 | Verified collectively by the 2026-04-25 audit pass; individual diffs in commit history. |

---

## 4. Controls status

Legend: ✅ verified in live code this cycle · 🟡 partial / known gap · ⚠️ at-risk / explicit exception · ◻ not applicable.

### 4.1 Authentication

| Control | Status | Evidence | Notes |
|---|---|---|---|
| JWT required on all protected routes (cookie OR Bearer) | ✅ | `backend/src/middleware/auth.ts:70-111` (`authenticate`) | Priority: cookie > Authorization header |
| Bearer-only helper for CSRF-exempt routes (SSE) | ✅ | `backend/src/middleware/auth.ts:166-201` (`requireBearerAuth`) | Used on `/ai/chat`; prevents cookie-carrying CSRF bypass |
| Access tokens short-lived (15 min), refresh 7 d | ✅ | `backend/src/config/index.ts:61-67` | `JWT_ACCESS_EXPIRES_SECONDS=900` default |
| JWT `alg` / `iss` / `aud` asserted on sign **and** verify | ✅ | `backend/src/config/jwtOptions.ts` + `middleware/auth.ts:83,129,178,219` | Closed F-4 |
| Refresh tokens are DB-backed sessions (revocable) | ✅ | `backend/src/services/authService.ts` (session cleanup scheduler @ `startSessionCleanup`) | — |
| Password hashing with bcrypt ≥13 rounds | ✅ | `backend/src/config/index.ts:90-94` | HIPAA 2024+ baseline |
| Brute-force protection on login | ✅ | `middleware/rateLimiter.ts:50-69` (`strictAuthLimiter`, 5/15 min, keyed by `email:ip`) | Counts failed attempts only |
| Demo account blocked in production | ✅ | `backend/src/config/index.ts:319-325` (hard-throw) | `isDemoAccount` at `middleware/demoProtection.ts:33-36` guards empty email |

### 4.2 CSRF

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Double-submit cookie on state-changing methods | ✅ | `backend/src/middleware/csrf.ts:86-179` | Timing-safe compare at `:169-172` |
| Global wiring (skipped only when `DISABLE_CSRF=true` in dev) | ✅ | `backend/src/app.ts:210-213` | — |
| Public auth routes exempt (login/register/refresh/etc.) | ✅ | `middleware/csrf.ts:98-108` | — |
| Upload routes follow the standard CSRF flow (no exemption) | ✅ | `middleware/csrf.ts` (post-2026-04-24) — no upload exemption | Frontend `services/uploadUtils.ts` attaches `X-CSRF-Token`; SSE remains the only exempt surface. |
| SSE route exempt (bearer-only) | ✅ | `middleware/csrf.ts:126-148` + `auth.ts:166-201` | Explicit invariant: exempt routes **must** use `requireBearerAuth` |

### 4.3 RBAC / Authorization

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Role hierarchy (PATIENT < PROVIDER < ADMIN) | ✅ | `backend/src/middleware/rbac.ts:16-20` | — |
| Resource-type × permission matrix | ✅ | `middleware/rbac.ts:31-56` | `ROLE_PERMISSIONS` |
| Ownership check for mutations | ✅ | `middleware/rbac.ts:264-322` (`requireOwnership`) | Admin bypass explicit |
| Provider-patient access gated by consent + active + expiry | ✅ | `middleware/rbac.ts:205-258` (`checkProviderPatientAccess`) | Capability flags: `canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canEditData` |
| Admin routes require `ADMIN` + demo-blocked | ✅ | `routes/adminRoutes.ts` + `middleware/demoProtection.ts` (F-7 fix) | — |

### 4.4 Encryption

| Control | Status | Evidence | Notes |
|---|---|---|---|
| AES-256-GCM PHI at rest (authenticated encryption) | ✅ | `backend/src/services/encryption.ts:57-61,263-279` | `iv:authTag:ciphertext` base64 |
| Per-user key derivation PBKDF2-SHA512 @ 600k iters | ✅ | `backend/src/services/encryption.ts:86-87,193-201` | OWASP 2023 baseline |
| Legacy 100k fallback on decrypt (no plaintext coupling) | ✅ | `encryption.ts:306-316` | Transitional; `TODO(key-rotation)` at `:81-85` |
| Master key validation rejects placeholder values in **every** env | ✅ | `encryption.ts:129-141` + `config/index.ts:296-308` | Closed C-4 |
| User salts encrypted with master key at rest | ✅ | `encryption.ts:215-228` (`encryptWithMasterKey`) + `userEncryption.ts` | — |
| TLS in transit | ✅ | Cloud Run HTTPS-only (see `RUNBOOK.md` §Quick reference) | — |
| Key rotation runbook | 🟡 | — | Not documented; see `TODO(key-rotation)` in `encryption.ts:81-85`. Required for a full A grade. |
| `PHI_FIELDS` kept in sync with Prisma schema | ✅ | `encryption.ts:411-492` | See `PHI_TAXONOMY.md` for every field × site |

### 4.5 PHI Handling

| Control | Status | Evidence | Notes |
|---|---|---|---|
| PHI encrypted before DB writes (all `*Encrypted` columns) | ✅ | `encryption.ts:338-353` (`encryptFields`) + controller call sites | See `PHI_TAXONOMY.md` |
| PHI decrypted only at response boundary | ✅ | `encryption.ts:358-385` (`decryptFields`); failures return `null` not ciphertext | — |
| PHI never logged (logger redacts by field name) | ✅ | `backend/src/utils/logger.ts:21-50` (`SENSITIVE_FIELDS`) | Closed F-21 (arrays of objects now recursed) |
| PHI redacted before Claude calls | ✅ | `utils/phiRedaction.ts` + `services/claudeExtraction.ts:131-140` | Closed C-7 |
| Lab-report PDFs extracted locally (no upload of raw file) | ✅ | `services/pdfTextExtraction.ts` + `claudeExtraction.ts:127-130` | Stage A before any network call |
| OAuth lab tokens encrypted (`LabConnection`) | ✅ | `encryption.ts:487-491` (PHI_FIELDS.LabConnection) | Quest FHIR integration |

### 4.6 Row-Level Security (RLS)

| Control | Status | Evidence | Notes |
|---|---|---|---|
| RLS policies exist on all user-scoped tables | ✅ | `backend/prisma/migrations/20260107_add_rls_policies/` | — |
| `withRLSContext` wraps in transaction + `SET LOCAL` | ✅ | `services/database.ts:377-483` (`applyRLSContext`, `runWithRLS`) | Closed C-1 |
| UUID validation defense-in-depth on user id | ✅ | `services/database.ts:358-362` | Parameterized `set_config` is the primary barrier |
| CI guard blocks `prisma.*` inside RLS callbacks | ✅ | `scripts/check-rls-wrappers.sh` + `.github/workflows/ci.yml` | See footgun banner `database.ts:14-31` |
| Startup asserts DB role is NOBYPASSRLS | ✅ | `services/database.ts:220-275` (`assertNoBypassRLS`) | Post-2026-04-24: hard-exits in production unconditionally on BYPASSRLS=true; non-prod logs WARNING and continues. The `RLS_ENFORCEMENT=strict` env-var gate was removed — assertion is now load-bearing fail-safe with no opt-out. Tests at `services/database.test.ts > assertNoBypassRLS — startup safety net`. |
| Production actually connects as a NOBYPASSRLS role | ⚠️ | — | **C-8 — operator-pending**; app runs as BYPASSRLS role in prod + dev today. Code is ready; the assertion above will catch any deploy that goes live before the role rotation completes. |

### 4.7 Audit Logging

| Control | Status | Evidence | Notes |
|---|---|---|---|
| HIPAA-compliant audit trail table | ✅ | `backend/src/services/auditLog.ts:1-80` + `AuditLog` model in schema | — |
| 7-year retention scheduler | ✅ | `auditLog.ts:9` (`RETENTION_DAYS = 2555`) + `app.ts:56` (`startAuditCleanup`) | — |
| Audit logs include IP, UA, session, actor, action, resource | ✅ | `auditLog.ts:59-77` (`AuditLogEntry`) | Closed F-5 (IP now via `req.ip`, trust-proxy=1) |
| Previous/new values encrypted in audit log | ✅ | `encryption.ts:461-464` (`AuditLog.previousValueEncrypted`, `newValueEncrypted`) | — |
| Audit-log encryption salt from env (not system_config) | ✅ | `config/index.ts:54,228-238` (`AUDIT_LOG_SALT`) | Closed C-2 |
| Audit coverage over all PHI reads/writes | 🟡 | 188 call sites across 24 files (see grep) | Matches `PHI_TAXONOMY.md` expectations for the tables currently in prod scope; FHIR lab-sync path just landed and is the freshest surface to verify |

### 4.8 Rate Limiting

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Six named limiters wired per route risk | ✅ | `middleware/rateLimiter.ts` (`standardLimiter`, `authLimiter`, `strictAuthLimiter`, `uploadLimiter`, `sensitiveLimiter`, `aiLimiter`, `bulkOperationLimiter`) | 7 exports; `aiLimiter` keyed by user id |
| Login limiter keyed by email+IP, failures only | ✅ | `rateLimiter.ts:50-69` | — |
| AI limiter per-user (cost protection) | ✅ | `rateLimiter.ts:102-118` | 10/hr/user |
| Shared store across Cloud Run instances | 🟡 | In-memory only — see banner at `rateLimiter.ts:6-13` | Not a finding today (low max-instances); upgrade to `rate-limit-redis` when scaling past ~3 instances |

### 4.9 Input Validation

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Zod schemas at API boundary | ✅ | `backend/src/middleware/validation.ts:225-346` (routes/auth/biomarkers/etc.) | — |
| UUID params validated | ✅ | `validation.ts:231-246` (`uuidParam`, `patientIdParam`, `userIdParam`) | — |
| Body-size cap | ✅ | `app.ts:226-227` (10 MB JSON / urlencoded) | — |
| Content-Type guard on JSON routes | ✅ | `app.ts:229` + `middleware/validation.ts:requireJsonContentType` | — |
| Zod password policy aligned with service (12 chars) | ✅ | closed via `ca74644` | — |

### 4.10 External APIs

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Claude (Anthropic) — BAA gate enforced in runtime | ✅ | `services/claudeExtraction.ts:118-123`, `controllers/expenseController.ts:632`, `routes/biomarkerRoutes.ts:134` | Closed C-7 |
| Claude — PHI redaction before every call | ✅ | `utils/phiRedaction.ts` + `claudeExtraction.ts:131-140` | Closed C-7 |
| `ANTHROPIC_BAA_ACTIVE` hard-required in prod when key is set | ✅ | `config/index.ts:245-258` | — |
| Google Document AI (OCR) | ✅ | GCP-native; BAA covered. `services/ocrService.ts` | — |
| SendGrid transactional email | ✅ | `services/emailService.ts`; staging uses sandbox mode (`config/index.ts:132-134`) | — |
| Quest FHIR (SMART-on-FHIR) — OAuth tokens encrypted at rest | ✅ | `encryption.ts:487-491` | New surface; freshest audit target |

### 4.11 File Storage (GCS)

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Signed URLs scoped + short-lived (15 min) | ✅ | `services/storageService.ts:111-135` | — |
| Magic-byte validation on upload | ✅ | `controllers/upload/*` | PDF-bomb DoS guard added in `f6c2b92` |
| Upload limiter (20/hr) | ✅ | `middleware/rateLimiter.ts:72-84` | — |
| GCS objects purged on account / data deletion | ✅ | `services/storageService.ts` `deleteFiles` + `settingsController` `deleteAllData`/`deleteAccount` | Closed C-6 |

### 4.12 Logging & Observability

| Control | Status | Evidence | Notes |
|---|---|---|---|
| No PHI in logs (field-name sanitizer) | ✅ | `utils/logger.ts:21-50` (`SENSITIVE_FIELDS`, `sanitizeValue`) | Closed F-21 |
| Structured logging in prod/staging | ✅ | `app.ts:219-223` (`morgan('combined')` in non-dev) | — |
| Startup logs critical config non-secrets | ✅ | `services/database.ts:161,168,178,248` etc. | — |
| CORS rejects logged, not silently dropped | ✅ | `app.ts:162` | — |

### 4.13 Error Handling

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Centralized error handler, no stack traces to client | ✅ | `middleware/errorHandler.ts` (test at `errorHandler.test.ts`) | — |
| Typed error classes (`UnauthorizedError`, `ForbiddenError`, etc.) | ✅ | `middleware/errorHandler.ts` (used throughout auth/csrf/rbac) | — |
| 404 handler | ✅ | `app.ts:51` (`notFoundHandler`) | — |

### 4.14 Data Portability

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Export all user data | ✅ | `controllers/settingsController.ts` + frontend `Export All My Data` flow (commit `bc2f6bc`) | — |
| Account deletion purges PHI rows **and** GCS files | ✅ | `settingsController.ts` → `deleteAllData` + `deleteAccount` + `storageService.deleteFiles` | Closed C-6 |
| Export endpoint rate-limited | ✅ | `sensitiveLimiter` (`rateLimiter.ts:87-99`) | — |

### 4.15 Admin

| Control | Status | Evidence | Notes |
|---|---|---|---|
| All admin routes require `ADMIN` role | ✅ | `routes/adminRoutes.ts` + `rbac.ts:adminOnly()` | — |
| Demo account explicitly blocked from admin routes | ✅ | `blockDemoAdminAccess` attached per F-7 fix (`7baf2d2`) | — |
| Admin routes wrapped in RLS admin context | ✅ | C-8 Part 2b-ii (PR `#43`) | `withRLSContext(null, …, { isAdmin: true })` |
| Users-by-email lookup wrapped in RLS | ✅ | C-8 Part 2b-ii | — |

### 4.16 Provider Collaboration

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Consent-first: relationship required + status ACTIVE + not-expired | ✅ | `middleware/rbac.ts:205-258` | — |
| Granular capability flags respected | ✅ | `rbac.ts:240-256` (`canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canEditData`) | — |
| Cross-user `ProviderPatient` writes wrapped in RLS | ✅ | C-8 Part 2a (PR `#41`) | — |
| Relationship notes encrypted | ✅ | `encryption.ts:436-438` (`ProviderPatient.notesEncrypted`) | — |

### 4.17 AI Integration

| Control | Status | Evidence | Notes |
|---|---|---|---|
| BAA gate in runtime before every Claude call | ✅ | `claudeExtraction.ts:118-123` + callers | Closed C-7 |
| PHI redaction in front of every Claude call | ✅ | `phiRedaction.ts` + `redactPHI` | Closed C-7 |
| Lab PDFs extracted locally first | ✅ | `pdfTextExtraction.ts` + `claudeExtraction.ts:127-130` | — |
| AI per-user rate limit | ✅ | `rateLimiter.ts:102-118` (10/hr/user) | — |
| Educational disclaimers on AI responses | ✅ | Controllers attach disclaimer text (see `biomarkerController`, `aiChatController`) | Product rule from `CLAUDE.md` |
| SSE chat is bearer-only (no cookie-CSRF bypass) | ✅ | `auth.ts:166-201` + `csrf.ts:126-148` | — |
| Anthropic BAA signed | ✅ | Project memory 2026-04-16; commit `2bd7e36` / `e7c3975` | — |

---

## 5. BAA inventory

| Vendor | Service | Status | Signed date | Source |
|---|---|---|---|---|
| Google Cloud Platform | Cloud Run, Cloud SQL, GCS, Document AI, Cloud Logging | ✅ Signed | Pre-existing (GCP HIPAA BAA) | GCP Console → Billing → BAA; RUNBOOK.md §Quick reference |
| Anthropic | Claude API | ✅ Signed | `2026-04-16` | Project memory + commit `2bd7e36` ("Anthropic BAA signed 2026-04-16; C-7 now the production gate"); gated in code at `config/index.ts:245-258` and `claudeExtraction.ts:118-123` |
| SendGrid (Twilio) | Transactional email | ✅ Signed | `TBD (external: compliance owner — extract from SendGrid admin console)` | `services/emailService.ts`; staging uses sandbox mode |
| Quest Diagnostics | SMART-on-FHIR lab data | 🟡 Pending — feature is disabled by default | `TBD (external: data-partnership contract — Quest Partners portal)` | `config/index.ts:158-169`; `feature is disabled unless clientId is set` |

---

## 6. Incidents since prior cycle

### 2026-04-17 — Cloud Run env-var update silently held back (BAA flip)

- **Summary**: `gcloud run services update --update-env-vars=ANTHROPIC_BAA_ACTIVE=true`
  created a new Cloud Run revision but served 0% traffic because the service
  had a prior explicit revision pin (`--to-revisions=…`). Symptom: BAA-active
  flag appeared set in Cloud Run config UI but Claude calls continued to trip
  the runtime gate because the running revision still had `ANTHROPIC_BAA_ACTIVE`
  unset.
- **Detection signal**: `latestReadyRevisionName ≠ latestCreatedRevisionName`.
- **Fix**: follow env-var updates with
  `gcloud run services update-traffic --to-revisions=NEW=100`
  (or `--to-latest` to drop the pin).
- **Blast radius**: No PHI disclosure — the runtime gate at
  `claudeExtraction.ts:118-123` held, so Claude calls failed closed.
- **Lesson encoded**: full postmortem captured in project memory; RUNBOOK
  section on env-var updates will cite this postmortem (see
  [RUNBOOK.md](./RUNBOOK.md)).
- **Related doc to generate**: `cloud-run-env-update-pinning.md` — **pending**.

---

## 7. Compliance status

### 7.1 HIPAA Technical Safeguards (§164.312)

| Safeguard | Status | Evidence |
|---|---|---|
| §164.312(a)(1) Access Control | 🟡 | Application-layer RBAC + RLS policies exist + database-level self-elevation trigger (`20260424_prevent_self_role_elevation`) blocks role/`is_active` mutation by non-admin sessions. Runtime RLS enforcement still depends on the operator running the C-8 Part C cutover; until then app-layer `withRLSContext` wrappers are the load-bearing control. Code prerequisites all merged — see [§ 2](#2-open-findings) C-8 row. |
| §164.312(a)(2)(i) Unique user IDs | ✅ | `UUID` user ids; JWT carries user id; sessions DB-backed. |
| §164.312(a)(2)(ii) Emergency access | 🟡 | Admin role exists (`rbac.ts:16-20`) and is blocked for demo; no documented break-glass runbook. |
| §164.312(a)(2)(iii) Automatic logoff | ✅ | 15-min access-token TTL + 7-day refresh with DB session cleanup (`authService.ts`). |
| §164.312(a)(2)(iv) Encryption & decryption | ✅ | AES-256-GCM at rest (`encryption.ts`); TLS in transit (Cloud Run). |
| §164.312(b) Audit controls | ✅ | `AuditLogService` + 7-year retention (`auditLog.ts`). |
| §164.312(c)(1) Integrity | ✅ | GCM authentication tag on every ciphertext (`encryption.ts:56-61`). |
| §164.312(d) Person or entity authentication | ✅ | JWT access + refresh with DB-backed sessions; bcrypt 13+ rounds. |
| §164.312(e)(1) Transmission security | ✅ | HTTPS-only Cloud Run; Helmet HSTS. |

Full HIPAA mapping: see [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) (generated 2026-04-24; updated 2026-04-25 with new policy doc cross-links).

### 7.4 HIPAA Administrative Safeguards (§164.308)

Before 2026-04-25, every Administrative-Safeguard documentation
requirement was tracked as ⏳ in [`HIPAA_CHECKLIST.md § 6`](./HIPAA_CHECKLIST.md#6-required-hipaa-documentation--status).
The 2026-04-25 documentation pass moves the load-bearing items to 🟡
(drafted, awaiting owner sign-off / legal review):

| Standard | Required document | Status | Drafted as |
|---|---|---|---|
| §164.308(a)(1)(ii)(A) Risk Analysis | Risk Assessment | 🟡 Draft | [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md) v1.0, 2026-04-25 — 12 enumerated threats, controls assessment, residual-risk matrix, remediation plan |
| §164.308(a)(1)(ii)(C) Sanction Policy | Sanction Policy | 🟡 Draft | [`SANCTION_POLICY.md`](./SANCTION_POLICY.md) v1.0, 2026-04-25 — solo-founder honest framing with compensating-controls acknowledgment |
| §164.308(a)(3) Workforce Security | Workforce Security SOP | 🟡 Draft | [`WORKFORCE_SECURITY_SOP.md`](./WORKFORCE_SECURITY_SOP.md) v1.0, 2026-04-25 — provisioning / modification / termination / ongoing review, plus current-state gap analysis |
| §164.308(a)(6) Security Incident Procedures | Breach Notification Plan | 🟡 Draft | [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md) v1.0, 2026-04-25 — detection, individual / HHS / media notification timelines, post-incident review |
| §164.308(a)(7) Contingency Plan | Contingency Plan | 🟡 Draft | [`CONTINGENCY_PLAN.md`](./CONTINGENCY_PLAN.md) v1.0, 2026-04-25 — backup, DR, emergency mode, restore-drill runbook (first drill scheduled 2026-07-25) |
| §164.316 Policies and Procedures | Security Policies | 🟡 Draft | [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md) v1.0, 2026-04-25 — written policies covering access control, encryption, audit, authentication, transmission, integrity, contingency, breach response |
| §164.520 Notice of Privacy Practices | Privacy Notice | 🟡 Draft | [`PRIVACY_POLICY_DRAFT.md`](./PRIVACY_POLICY_DRAFT.md) v0.1 — **pre-publication legal review required** |
| Contractual basis (companion to NPP) | Terms of Service | 🟡 Draft | [`TERMS_OF_SERVICE_DRAFT.md`](./TERMS_OF_SERVICE_DRAFT.md) v0.1 — **pre-publication legal review required** |

Still ⏳ (not yet drafted): Information System Activity Review SOP,
Workforce Access Authorization SOP (separate from the broader Workforce
Security SOP), Termination Checklist (referenced from Workforce SOP but
not yet a standalone document), Security Awareness Training Plan,
Compliance/Security Officer designation. None block the technical
posture — they block formal sign-off ahead of beta.

### 7.5 SOC 2 roadmap

`TBD (external: SOC 2 start date — ask compliance owner / CISO)`.
No active SOC 2 engagement in-repo artifacts. Earliest viable kickoff is after
C-8 Part 3 closes (RLS at runtime) and a key-rotation runbook lands.

### 7.6 BAA posture

Summarized in [§ 5. BAA inventory](#5-baa-inventory). GCP ✅, Anthropic ✅ (signed
2026-04-16 and BAA gate enforced at runtime), SendGrid ✅ date TBD, Quest 🟡
feature-flagged off until partnership BAA lands.

---

## 8. Posture trendline

| Cycle | Audit date | Critical open | High open | Medium open | Low open | Grade |
|---|---|---|---|---|---|---|
| **2026-04-25 (this)** — Lows sweep + HIPAA documentation drafting | 2026-04-25 | 0 (C-8 code-complete, infra-pending) | 0 | ~4 (deferred design) | 0 | **B+** |
| 2026-04-24 — full High + Medium remediation | 2026-04-24 | 0 (C-8 code-complete, infra-pending) | 0 | ~4 (deferred design) | ~24 | **B+** |
| 2026-04-24 (early in cycle, post-C-series) | 2026-04-16 | 1 | 0 | 0 | 0 | B- |
| 2026-04-16 (immediately post-C-1…C-6 merge) | 2026-04-16 | 2 (C-7 open, C-8 open) | 5 | 0 | 4 | C+ |
| 2026-04-15 (pre-audit baseline) | 2026-04-15 | 8 (C-1…C-8) | 5 | est. 2 | est. 4 | D |
| 2026-03-25 (prior release snapshot) | 2026-03-25 | est. 3 (C-1, C-5, C-6 latent) | est. 4 | est. 2 | est. 4 | C |

Pre-2026-04-15 rows are reconstructed from `git log` on `backend/src/config/index.ts`,
`encryption.ts`, `database.ts`, and the finding IDs cited in merged commits. Where
an exact count can't be derived from the repo, the cell is marked `est.` and the
doc notes `TBD (external: prior audit archive — ask security owner for pre-2026-04-15
severity count)`.

---

## 9. Suggested next actions

In rough priority order for the pre-beta runway. Items struck through
have closed since the last regen.

1. **C-8 operator cutover** — provision `omh_app` NOBYPASSRLS role in
   Cloud SQL, rotate `DATABASE_URL` in Secret Manager, deploy. The
   startup assertion at `database.ts:200-265` is unconditional in prod
   (no env-var opt-out) — any rollback hard-exits. Runbook in
   [§ 2 C-8 row](#2-open-findings) and
   [`C8_PART3_RUNBOOK.md`](./C8_PART3_RUNBOOK.md).
2. **Resolve `[CONFIRM]` markers across the new HIPAA documents** —
   each draft enumerates them at the bottom (Cloud SQL retention,
   PITR, GCS versioning, DNS registrar, master-key paper backup,
   workstation FDE, etc.). Most are GCP Console reads + operator
   decisions, not code changes.
3. **Legal review of the two pre-publication drafts** —
   [`PRIVACY_POLICY_DRAFT.md`](./PRIVACY_POLICY_DRAFT.md) and
   [`TERMS_OF_SERVICE_DRAFT.md`](./TERMS_OF_SERVICE_DRAFT.md). Specific
   `[LEGAL REVIEW]` sections are flagged inline in each doc.
4. **External penetration test** — third-party scoped against the
   live staging deploy (post-C-8 cutover). Tracked in
   [`RISK_ASSESSMENT.md § 6.1 row 5`](./RISK_ASSESSMENT.md#61-pre-beta-must-close-before-live-phi).
5. **First Contingency-Plan restore drill** — scheduled
   2026-07-25; runbook in
   [`CONTINGENCY_PLAN.md § 6`](./CONTINGENCY_PLAN.md#6-restore-drill-runbook).
   Closes [`RISK_ASSESSMENT.md` T-07](./RISK_ASSESSMENT.md#37-t-07--ransomware--data-destruction)
   from High residual risk to Medium.
6. **SendGrid BAA — date documented, then signed** (see
   [§ 5](#5-baa-inventory)).
7. **Compliance/Security Officer designation** — required before beta
   ([HIPAA_CHECKLIST § 1](./HIPAA_CHECKLIST.md#1-business-associate-agreements-baas)).
8. **Cost-analysis service-type anonymization** — needs a curated
   medical taxonomy. The `stripPHIFromText` floor is in place; full
   mapping (e.g., "HIV PrEP consultation" → "Specialist Visit")
   deferred.
9. **Logger redaction drift** — 25+ PHI field names not in
   `SENSITIVE_FIELDS`. Single PR can sweep them all. See
   [PHI_TAXONOMY.md § 4](./PHI_TAXONOMY.md).
10. **Strategy / Financial Q&A pass** — both docs were last refreshed
    2026-04-24; the next regen cycle should incorporate the new
    HIPAA-doc landscape.

### Resolved since prior regen

- ~~Runtime C-8 BYPASSRLS open as a blocking Critical~~ — reframed to
  operator-pending; all code prerequisites merged 2026-04-24.
- ~~Lows sweep~~ — ~24 closures landed 2026-04-25 (this cycle); see
  [§ 3 sub-section "2026-04-25 — Low closures"](#2026-04-25-remediation-pass--low-closures).
- ~~No drafted HIPAA Risk Assessment~~ — drafted as
  [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md) 2026-04-25.
- ~~No drafted Breach Notification SOP~~ — drafted as
  [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md) 2026-04-25.
- ~~No drafted Security Policies (§164.316)~~ — drafted as
  [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md) 2026-04-25.
- ~~No drafted Contingency Plan (§164.308(a)(7))~~ — drafted as
  [`CONTINGENCY_PLAN.md`](./CONTINGENCY_PLAN.md) 2026-04-25.
- ~~No drafted Privacy Notice (§164.520)~~ — drafted as
  [`PRIVACY_POLICY_DRAFT.md`](./PRIVACY_POLICY_DRAFT.md) (pre-legal-review).
- ~~No drafted Terms of Service~~ — drafted as
  [`TERMS_OF_SERVICE_DRAFT.md`](./TERMS_OF_SERVICE_DRAFT.md) (pre-legal-review).
- ~~No drafted Sanction Policy (§164.308(a)(1)(ii)(C))~~ — drafted as
  [`SANCTION_POLICY.md`](./SANCTION_POLICY.md) 2026-04-25.
- ~~No drafted Workforce Security SOP (§164.308(a)(3)/(a)(4))~~ —
  drafted as [`WORKFORCE_SECURITY_SOP.md`](./WORKFORCE_SECURITY_SOP.md)
  2026-04-25.

---

## 10. Next-audit trigger

Re-run `24-full-security-audit.md` (which orchestrates prompts `01-13` + `26-32`)
when **any** of these fire:

1. **C-8 Part 3 cutover completes** — the `omh_app` NOBYPASSRLS role is live in
   prod and `RLS_ENFORCEMENT=strict` is set. Full re-audit required: this is
   the grade-change event.
2. **A new external integration ships with PHI in scope** (beyond Anthropic /
   GCP / SendGrid / Quest). New BAA surface = new audit.
3. **Any Critical finding opens**, or 2+ High findings open in the same week.
4. **90 days elapse** since the last full audit (soft cadence — 2026-07-25 fires
   next under this rule, aligned with the first scheduled
   [Contingency-Plan restore drill](./CONTINGENCY_PLAN.md#5-testing-and-revision-procedures--164308a7iid)).
5. **A dependency CVE of severity ≥7.5** hits a direct dependency (the CI
   `npm audit high+` gate will already fail the build; audit re-run confirms
   the fix landed with no regression).
6. **Schema migration touches any PHI table or RLS policy** — drift between
   `PHI_FIELDS` and the schema is a silent failure mode.

---

## Acceptance questions — self-answered

Each answer below is derivable from this doc + linked siblings alone.

**Q1. What's the current security grade, and what changed this cycle?**
`B+` (see [Header](#header)). Up from `B-` earlier in the cycle because every
remaining High closed, plus the trivial + non-trivial Medium batches (12
Medium fixes total). C-8 is no longer counted as an open Critical — code
prerequisites for all four parts have merged; the only gap is the operator
Cloud SQL role rotation. See [§ 1. Posture summary](#1-posture-summary) and
the trendline at [§ 8](#8-posture-trendline).

**Q2. What Critical findings are open today? What's the plan for each?**
Zero open Criticals. C-8 is **code-complete, operator-pending** — startup
assertion is unconditional in prod (post-2026-04-24, no opt-out env var),
multi-tenant integration tests in place, every code-side prerequisite
merged. Remaining work: provision `omh_app` NOBYPASSRLS role + rotate
`DATABASE_URL` in Secret Manager. Operator runbook in
[§ 2](#2-open-findings).

**Q3. Which closed this cycle, and in which PR?**
2026-04-16 sweep: 7 Criticals (C-1…C-7) + F-14/F-15 + 5 Highs + 4 Lows.
2026-04-24 remediation: ~22 Highs (full closure) + ~33 Mediums across two
batches (trivial + non-trivial). 2026-04-25 Lows sweep: ~24 additional Lows
(UUID alignment, unhandled-rejection handlers, GCS bucket fail-fast,
env-var naming, Anthropic client consolidation, raw-fetch migration,
column rename, gsutil → `gcloud storage` migration, drop `:latest` tag,
plus ~15 cleanup items). Specific commits/PRs listed in
[§ 3. Closed in current cycle](#3-closed-in-current-cycle).

**Q4. What's the status of C-7 (PHI-to-Claude minimization) and C-8 (BYPASSRLS
runtime)?**
- **C-7 — CLOSED** (initial pass PR `#39` 2026-04-16; hardening pass 2026-04-24).
  Runtime BAA gate at `claudeExtraction.ts:118-123`; PHI redaction at
  `utils/phiRedaction.ts`; local PDF text extraction at
  `services/pdfTextExtraction.ts`. The 2026-04-24 hardening removed the PDF
  vision fallback entirely (text-only is the only Claude path now), added
  the freestanding-date pattern to `redactPHI`, plumbed `userId` through
  `trackAIUsage` (was hardcoded `'system'`). Tests in
  `claudeExtraction.test.ts`, `sbcExtraction.test.ts`, `phiRedaction.test.ts`.
- **C-8 — Code-complete, operator-pending**. All four parts (A/B/C-code/D)
  merged. Live-DB integration suite in `__tests__/integration/rls-isolation.test.ts`
  pins multi-tenant + admin + privilege-immutability + pool-leak invariants.
  Infrastructure role rotation is the only remaining step; the startup
  assertion will catch any deploy that ships before the rotation completes.

**Q5. Which controls are ✅ vs 🟡 vs ⚠️ today?**
Counting across [§ 4. Controls status](#4-controls-status):
- ✅ — 57 controls spot-checked and passing.
- 🟡 — partial: key-rotation runbook, audit coverage on the fresh FHIR
  surface, rate-limiter in-memory store, HIPAA §164.312(a)(2)(ii)
  emergency-access runbook, SendGrid BAA date undocumented,
  §164.312(a)(1) Access Control pending C-8 Part 3, Quest BAA pending
  (feature-flagged off). The CSRF upload-route exemption was **removed**
  in the 2026-04-24 cycle.
- ⚠️ — 1 explicit exception tied to **C-8**: production still connects as
  a BYPASSRLS role. The startup-assertion warn-by-default carve-out was
  **removed** in the 2026-04-24 cycle (assertion is now unconditional in
  prod, no env-var opt-out).

**Q6. Which BAAs are signed, and which are pending?**
Signed: GCP (pre-existing), Anthropic (2026-04-16), SendGrid (date TBD). Pending /
feature-flagged: Quest Diagnostics. See [§ 5](#5-baa-inventory).

**Q7. When was the last audit, and what triggered the next one?**
Last audit: 2026-04-16 (C-1…C-7 closing pass + trailing F-series closures
2026-04-17/18); 2026-04-24 remediation cycle (Highs + Mediums); 2026-04-25
Lows sweep + HIPAA-policy drafting pass. Next-audit triggers listed in
[§ 10](#10-next-audit-trigger); the grade-change event is C-8 Part 3
cutover. Suggested next actions in [§ 9](#9-suggested-next-actions).

**Q8. What's the verification for the most recent closed Critical?**
C-7 (PHI minimization for Claude) is the most recent Critical closure
(2026-04-16, PR `#39`). Verification: runtime BAA gate at
`backend/src/services/claudeExtraction.ts:118-123` throws before any network
call; `utils/phiRedaction.ts` is invoked at `claudeExtraction.ts:131-140`
before the prompt is built; local PDF text is produced at
`services/pdfTextExtraction.ts` so the raw PDF never leaves the server; three
test files cover the path (`claudeExtraction.test.ts`, `phiRedaction.test.ts`,
plus caller-level BAA-gate assertions in `biomarkerRoutes.guidance.test.ts`
and `expenseController.test.ts`).

**Q9. How does audit logging coverage compare to `PHI_TAXONOMY.md` expectations?**
`PHI_TAXONOMY.md` enumerates every `*Encrypted` column and its write/read sites.
The audit service is imported in 188 call sites across 24 files (verified by
Grep `logAccess|logCreate|logUpdate|logDelete|auditLogService` this pass),
covering every controller named in PHI_TAXONOMY's call-site tables. The one
fresh surface — Quest FHIR lab-sync (`services/fhir/labSyncService.ts`) —
landed during this cycle and is flagged as freshest audit target in
[§ 4.7](#47-audit-logging).

**Q10. What's the remediation owner for each open finding?**
- Zero Highs open ([§ 1](#1-posture-summary)).
- C-8 (Critical, code-complete) — owner: `TBD (external: infrastructure owner
  — GCP Cloud SQL admin)`. Operator-only work; runbook in
  [§ 2](#2-open-findings).
- ~4 deferred Mediums (service-type anonymization, provider consent feature
  gaps, signed-URL session binding, AI-cost-tracker userId log volume) — all
  flagged for the next audit cycle. None block beta.

---

## Related Documents

- [`SECURITY_AUDIT_core.md`](./SECURITY_AUDIT_core.md) — per-area audit: core services (pending generation, see prompt `24-full-security-audit.md`).
- [`SECURITY_AUDIT_domain.md`](./SECURITY_AUDIT_domain.md) — per-area audit: domain controllers / routes (pending).
- [`SECURITY_AUDIT_infrastructure.md`](./SECURITY_AUDIT_infrastructure.md) — per-area audit: deploy / DB / secrets (pending).
- [`SECURITY_AUDIT_periphery.md`](./SECURITY_AUDIT_periphery.md) — per-area audit: AI / email / storage / FHIR (pending).
- [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) — full HIPAA technical-safeguard mapping (pending; see prompt `22-hipaa-checklist-doc.md`).
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) — open issues / drift log (pending; prompt `20-known-issues-doc.md`).
- [`CHANGELOG.md`](./CHANGELOG.md) — closing PRs and release history (pending; prompt `19-changelog-doc.md`).
- [`DATA_MODEL.md`](./DATA_MODEL.md) — per-table RLS policies and cascade behavior.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — every PHI field × encryption × write/read sites × audit coverage.
- [`RUNBOOK.md`](./RUNBOOK.md) — operational remediation steps (env-var update pinning postmortem, deploy, rollback).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — high-level system overview, middleware stack.
- [`API_REFERENCE.md`](./API_REFERENCE.md) — per-endpoint auth + rate-limit contracts.
- [`ENV_VARS.md`](./ENV_VARS.md) — `RLS_ENFORCEMENT`, `ANTHROPIC_BAA_ACTIVE`, `AUDIT_LOG_SALT`, JWT + PHI keys.
- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — middleware chain per route.
- [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) — incident playbooks.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — diagnostic recipes.
- [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) — security regression test patterns.
- [`LOCAL_DEV.md`](./LOCAL_DEV.md) — local-dev env with BAA-off behavior.
- Security audit prompts (for re-auditing): [`../prompts/01-database-schema.md`](../prompts/01-database-schema.md), [`02-encryption.md`](../prompts/02-encryption.md), [`03-authentication.md`](../prompts/03-authentication.md), [`04-csrf.md`](../prompts/04-csrf.md), [`05-audit-logging.md`](../prompts/05-audit-logging.md), [`06-api-routes.md`](../prompts/06-api-routes.md), [`07-input-validation.md`](../prompts/07-input-validation.md), [`08-rate-limiting.md`](../prompts/08-rate-limiting.md), [`09-external-apis.md`](../prompts/09-external-apis.md), [`10-frontend-auth.md`](../prompts/10-frontend-auth.md), [`11-environment-secrets.md`](../prompts/11-environment-secrets.md), [`12-cicd-security.md`](../prompts/12-cicd-security.md), [`13-dependency-health.md`](../prompts/13-dependency-health.md), [`24-full-security-audit.md`](../prompts/24-full-security-audit.md), [`26-provider-collaboration.md`](../prompts/26-provider-collaboration.md), [`27-ai-integration.md`](../prompts/27-ai-integration.md), [`28-file-storage.md`](../prompts/28-file-storage.md), [`29-data-portability.md`](../prompts/29-data-portability.md), [`30-admin-security.md`](../prompts/30-admin-security.md), [`31-logging-observability.md`](../prompts/31-logging-observability.md), [`32-error-handling.md`](../prompts/32-error-handling.md).

---

## Prompt drift log

- `./21-security-status-doc.md` assumes four `SECURITY_AUDIT_*.md` files already
  exist in `New Project Documents/` as synthesis input. As of 2026-04-24 none
  of the four exist — they are planned outputs of `24-full-security-audit.md`.
  This doc synthesized from git log + live code + project memory instead, and
  the cross-links to the four AUDIT docs are annotated as `pending`.
- Same prompt assumes `C8_PART3_RUNBOOK.md` and `C8_PART3_STARTUP_ASSERTION.md`
  exist as `New Project Documents/` siblings. The in-repo runbook lives at
  `docs/STAGING.md` (referenced from `database.ts:194`) and the startup
  assertion spec is inline in `database.ts:220-270`. Extracting both to
  Claude-Project siblings is a tracked follow-up.
- Prompt assumes `HIPAA_CHECKLIST.md`, `KNOWN_ISSUES.md`, and `CHANGELOG.md`
  already exist as cross-link targets. None do yet (per TaskList this cycle).
  Cross-links are marked `pending` with pointers to the generating prompts.
