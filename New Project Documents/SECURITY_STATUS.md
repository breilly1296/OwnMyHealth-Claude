# OwnMyHealth Security Status

**Last Updated:** 2026-04-16
**Last Full Audit:** 2026-04-16 (Claude — prompts 01–13, 26–32)
**Security Grade:** **C** — strong foundation, several Critical issues blocking production launch.

---

## Posture summary

| Severity | Total | Open | In progress | Fixed |
|---|---|---|---|---|
| Critical | 8 | 2 | 0 | 6 |
| High | ~22 | ~22 | 0 | 0 |
| Medium | ~37 | ~37 | 0 | 0 |
| Low | ~27 | ~27 | 0 | 0 |
| Info | 6 | — | — | — |

(Counts aggregated from the three code-audit reports — `SECURITY_AUDIT_core.md`, `SECURITY_AUDIT_periphery.md`, `SECURITY_AUDIT_domain.md` — plus one infrastructure finding in `SECURITY_AUDIT_infrastructure.md` surfaced out-of-band during PR #30 regression testing.)

### Interpretation
The codebase reflects a thoughtful security-first architecture — AES-256-GCM encryption, per-user keys, RLS, audit logging, CSRF, rate limiting, multi-layer RBAC, and PHI redaction are all present. Six of eight Critical findings (C-1 through C-6) were closed in the 2026-04-16 code-fix batch (PRs #30, #32, #33, #34, #36, #37). The remaining two — C-7 (PHI-to-Claude minimization) and C-8 (BYPASSRLS runtime role) — block production PHI ingress. C-7 is a code fix; C-8 is infrastructure work with a documented four-PR sequence.

---

## Critical findings (block production launch)

| # | Status | Finding | Evidence | Prompt |
|---|---|---|---|---|
| C-1 | ✅ **Fixed** (PR #30) | RLS unenforceable for most reads — `setRLSContext` used `SET LOCAL` outside transactions, so the user_id context was never actually set for non-transactional queries. | `backend/src/services/database.ts` | 01 |
| C-2 | ✅ **Fixed** (PR #32) | Audit-log system salt stored plaintext — the salt used to encrypt AuditLog PHI values lived in `system_config.value` with `isEncrypted=false`. | `backend/src/services/auditLog.ts` | 05 |
| C-3 | ✅ **Fixed** (PR #33) | JWT secrets had hardcoded dev fallbacks — `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` defaulted to literal strings; only production env gated this. Misconfigured staging signed tokens with publicly known values. | `backend/src/config/index.ts` | 03, 11 |
| C-4 | ✅ **Fixed** (PR #34) | `.env.example` shipped an insecure `PHI_ENCRYPTION_KEY` — the `INSECURE_KEYS` check only triggered in production; any dev/staging pulling the example key encrypted real test PHI with a known key. | `backend/.env.example`, `backend/src/services/encryption.ts` | 11 |
| C-5 | ✅ **Fixed** (PR #36) | jspdf 4.0.0 HTML/PDF injection (1 critical + 6 high CVEs) — direct dependency. CVSS 8.3 HTML injection. Fixed in 4.2.1. | `package.json` root | 13 |
| C-6 | ✅ **Fixed** (PR #37) | GCS objects not deleted on account/data deletion — `deleteAccount`/`deleteAllData` removed DB rows but never called `storageService.deleteFile`. | `backend/src/controllers/settingsController.ts` | 29 |
| C-7 | 🔴 **Open** | **Raw PHI PDFs sent to Claude in biomarker + SBC extraction** — `extractBiomarkersWithClaude` and `extractInsuranceFromSBC` pass the unredacted PDF as base64 to Anthropic. Lab reports contain name/DOB/MRN/address. `stripPHIFromText` only runs on the response. Anthropic BAA signed 2026-04-16 provides legal cover, but the code still exceeds HIPAA's minimum-necessary standard — input-side PHI minimization required. | `backend/src/services/claudeExtraction.ts:110-140`, `sbcExtraction.ts:778-806` | 27 |
| C-8 | 🟡 **Filed** (PR #31) — **infra remediation pending** | **RLS policies inert at runtime** — every `CREATE POLICY` in `20260107_add_rls_policies` is silently bypassed because the app connects as a role with `rolbypassrls=true` (Cloud SQL `cloudsqlsuperuser` in dev; Railway vanilla `postgres` superuser in prod). Tenant isolation is carried by application-level `where: { userId }` filters only — any missed filter is a live cross-tenant bug. Four-PR remediation sequence documented below. | `backend/.env`, `backend/.env.production.example`, `backend/prisma/migrations/20260107_add_rls_policies/migration.sql`, `backend/src/services/auditLog.ts:106,114` (blocker for remediation) | — (infra) |

**Remediation priority for the two remaining Criticals:** C-7 is a self-contained code fix (strip PHI from PDF text before sending to Claude, or switch to text-only prompts after local PDF extraction). C-8 requires a four-PR infrastructure sequence (see below) — do NOT start the role cutover before the `auditService.initialize()` RLS-wrapping fix lands, or server startup will crash under the new role.

Do not cite RLS as an enforced control in public compliance statements until C-8 lands — it is defense-in-depth on paper only.

---

## High findings (fix before beta)

Grouped by area. Full details in the per-area audit files.

### Auth & session
- **JWT verify lacks issuer/audience/algorithms assertion** — accepts any algorithm, letting a bad token get through if secret leaks (core F-8).
- **Password policy mismatch** — Zod schema requires 8 chars, service enforces 12. Users with 8-11 char passwords succeed in registration but fail in login (core F-7).
- **Session IP from raw `X-Forwarded-For`** — audit logs can be spoofed (core F-9, regression of earlier fix).
- **Empty demo email matches any empty email** — Zod tolerates empty; demo check uses `email === DEMO_EMAIL`; if `DEMO_EMAIL` unset (='') any unauthenticated body passes (core F-11).

### RBAC, RLS, admin
- **RLS self-role-elevation at DB layer** — users can SQL their own `role` to ADMIN because RLS permits updates keyed on user_id (core F-6).
- **Admin actions logged with `actorType='USER'`** — blurs admin vs user in audit trail (core F-10).
- **Demo protection middleware not attached** — `blockDemoAdminAccess`, `blockDemoRoleChange`, `blockDemoUserModification`, `demoProtection` all exported, never imported. Only `blockDemoAI` is wired. Demo users can modify user data in production (periphery F-5).

### CSRF
- **CSRF exempted on `/settings/delete-account`, `/settings/delete-data`, `/settings/export-data`, uploads** — cookie-auth endpoints lack CSRF, creating a CSRF-only attack path on destructive ops (core F-5, domain F-9). Uploads use Bearer token historically — confirm frontend still sends Bearer, otherwise they're wide open.

### Provider-patient (cross-user)
- **Biomarker AI guidance trusts client-supplied biomarker data** — no DB lookup, no ownership check on `req.params.id`. IDOR-equivalent for audit trail + AI spend (domain F-3).
- **Provider data endpoints don't check patient `isActive`/`lockedUntil`** — provider retains access to locked/deleted patient's data (domain F-7).
- **Provider patient list returns PENDING relationships with patient email** — patient email disclosed before consent (domain F-8).
- **No rate limit on provider access request; distinct error messages leak patient role** — enables role enumeration (domain F-6).
- **Cross-user provider queries bypass RLS** — direct Prisma queries without `withRLSTransaction` (domain F-13).

### Data portability
- **Export omits 8 of 11 PHI categories** — only biomarkers + insurance plans; missing User profile, BiomarkerHistory, HealthNeeds, HealthGoals, GoalProgressHistory, Expenses, CostAnalyses, ProviderPatient, UserFile. HIPAA §164.524 gap (domain F-4).
- **`deleteAllData` misses multiple tables** — doesn't delete ExpenseProjection, ExpenseActual, CostAnalysis, UserFile, ProviderPatient, DNA data (domain F-5).
- **`deleteAllData` has no password confirmation** — destructive op protected only by auth cookie + CSRF (which is exempted per above) (domain F-10).

### File upload
- **Lab-report upload bypasses `validatePdfHeader`** — PDF bomb DoS protections don't apply to the main upload path (domain F-11).
- **No magic-byte validation on image uploads** — mimetype-only check allows type spoofing (domain F-12).

### AI / cost
- **`aiLimiter` missing on 4 Claude endpoints** — `POST /upload/lab-report`, `POST /upload/insurance-sbc`, `POST /insurance/upload-sbc`, `POST /insurance/plans/:id/reanalyze` all invoke Claude Sonnet but only `uploadLimiter` (20/hr/IP) protects them. No per-user cost cap (periphery F-3).

### Dependencies
- **Backend: 29 vulnerabilities** (1 Critical `fast-xml-parser`, 15 High including axios SSRF triple) — needs `npm audit fix` cycle (periphery F-7).

---

## Key controls status

### Authentication
| Control | Status | Notes |
|---|---|---|
| JWT implementation | 🟡 | 15-min access / 7-day refresh confirmed. Secret-fallback gap (C-3), no issuer/audience check (H). |
| Password hashing | ✅ | bcrypt cost 12. Policy mismatch is a gap (H). |
| CSRF protection | 🟡 | Double-submit cookie + timing-safe compare in place. Exemptions on destructive endpoints (H). |
| Rate limiting | 🟡 | 7 limiters exist; aiLimiter gap on 4 endpoints (H). |
| Account lockout | ✅ | 5 failures / 30 min. |
| Email verification | ✅ | 24-hour token, single-use. |
| Password reset | ✅ | Time-limited, single-use, all sessions revoked on reset. |

### Encryption
| Control | Status | Notes |
|---|---|---|
| PHI at rest | ✅ | AES-256-GCM per `encryption.ts`; fields match `_phi-inventory.md`. |
| In transit | ✅ | TLS 1.3 on all hops. |
| Key management | 🟡 | Master key in GCP Secret Manager; `.env.example` leak risk (C-4). |
| Per-user keys | ✅ | PBKDF2-SHA512, 100K iterations. |
| Key rotation | ⏳ | No implementation; documented-only. |

### Input validation
| Control | Status | Notes |
|---|---|---|
| UUID validation | ✅ | Zod + middleware. |
| File validation | 🟡 | PDF header check exists (`validatePdfHeader`) but not applied to main upload path (H). Image magic-byte check missing (H). |
| SQL injection | ✅ | Prisma. One prior raw-query issue fixed (commit `a133256`). |
| Zod coverage | 🟡 | Present on most routes; validation error messages can echo PHI (periphery F-15). |

### Audit logging
| Control | Status | Notes |
|---|---|---|
| PHI access logged | ✅ | Coverage verified per-controller. |
| Auth events | ✅ | Login, logout, lockout, verification. |
| Immutability | 🟡 | No UPDATE/DELETE from app; DB-level trigger not in place. |
| System salt | ❌ | Stored plaintext in system_config (C-2). |
| IP source | 🟡 | `req.ip`; prior `X-Forwarded-For` gap regressed (H). |
| Retention | ✅ | 7-year scheduler per `auditLog.ts`. |

### Cross-user access
| Control | Status | Notes |
|---|---|---|
| RBAC (PATIENT/PROVIDER/ADMIN) | ✅ | `rbac.ts` middleware. |
| RLS policies | ❌ | Two layered gaps: the app-side `SET LOCAL` bug (C-1, fixed in PR #30) meant the user context never reached the policy; and the runtime DB role has `BYPASSRLS` so policies don't fire even with the context set (C-8, open). Until C-8 is closed, tenant isolation is carried by application-level `where: { userId }` filters only. |
| Consent lifecycle | 🟡 | PENDING→ACTIVE implemented; SUSPENDED/EXPIRED dead code (domain F-19). |
| Granular permissions | 🟡 | `canViewBiomarkers` / `canViewHealthNeeds` checked. `canViewInsurance` / `canViewDna` / `canEditData` have no enforcement endpoints (domain F-18). |
| Provider rate limiting | ❌ | Missing on access request (H). |

### External APIs
| Control | Status | Notes |
|---|---|---|
| API key handling | ✅ | Env vars, no code hardcoding. |
| Claude API — PHI in | 🟡 | Input-side PHI stripping missing (C-7). BAA signed 2026-04-16. |
| Claude API — cost | 🟡 | `aiCostTracker.ts` present, limiter gap on 4 endpoints (H). |
| GCS — signed URLs | ✅ | TTL 15 min (infrastructure config to verify). |
| GCS — bucket privacy | ⏳ | Code-only scope; bucket IAM / CORS / versioning unverified. |
| SendGrid | ✅ | No PHI in outbound templates (verified in emailService.ts). |

### Infrastructure
| Control | Status | Notes |
|---|---|---|
| Secret Manager | ✅ | All runtime secrets from GCP Secret Manager. |
| CI/CD | 🟡 | Actions pinned; `npm audit` step uses `continue-on-error: true` (periphery F-13). |
| Docker | ⏳ | Non-root user / multi-stage verification pending. |
| Cloud Run config | ⏳ | CPU/memory/concurrency/scaling not in deploy.yml — verify in GCP console. |
| Backups | ⏳ | Cloud SQL automated backups presumed; not tested. |

---

## BAA status

| Vendor | Service | BAA | Action |
|---|---|---|---|
| Google Cloud | Cloud Run, Cloud SQL, GCS, Document AI, Cloud Logging, Secret Manager | Assumed signed — confirm | Verify in GCP console. |
| **Anthropic** | Claude API | ✅ Signed 2026-04-16 | BAA in place. Production PHI through Claude still gated on C-7 (input-side PHI minimization). |
| SendGrid | Transactional email | Not required (no PHI in emails) | Verify templates remain PHI-free. |

---

## Remediation plan

### Done (2026-04-16 batch)
1. ✅ **C-1** — `setRLSContext` refactored to wrap callback in `$transaction`, parameterized `set_config`. Shipped in PR #30.
2. ✅ **C-2** — Audit system salt now encrypted under master key via `encryptWithMasterKey()`. Three-branch `initialize()` handles fresh install / normal boot / legacy-migration. Shipped in PR #32.
3. ✅ **C-3** — JWT secrets now go through `requireEnv()` — no fallbacks in any environment. Blocked-placeholder + length checks apply universally. Legacy `jwt.secret` / `jwt.expiresIn` keys removed. Shipped in PR #33.
4. ✅ **C-4** — `INSECURE_KEYS` check in `validateEncryptionKey()` now runs in every environment; `.env.example` placeholder rewritten as a non-hex failing string. Shipped in PR #34.
5. ✅ **C-5** — `jspdf` bumped from `^4.0.0` to `^4.2.1`, closing the single critical advisory bundling nine jsPDF CVEs. No source changes. Shipped in PR #36.
6. ✅ **C-6** — `deleteAllData` and `deleteAccount` now purge GCS objects before any DB deletion, fail-hard on GCS failure. New `storageService.deleteFiles` batch helper. Shipped in PR #37.
7. ✅ **Anthropic BAA** — Signed 2026-04-16.

### Remaining Criticals
8. 🔴 **C-7** — Implement input-side PHI stripping for Claude calls: extract text from PDF with `pdf-parse`, run `stripPHIFromText` (widen regex to include name patterns), then send a text-only prompt. Add an `ANTHROPIC_BAA_ACTIVE` config gate as defense-in-depth. BAA no longer blocks (signed 2026-04-16); the code fix is now the sole remaining gate for production PHI through Claude.
9. 🟡 **C-8** — Staged infrastructure work; see dedicated plan below. Do NOT attempt before the `auditService.initialize()` RLS-wrapping fix lands, or server startup will crash under the new role.

### C-8 staged rollout (separate PR sequence)
The C-8 remediation is infrastructure work that must land in order:
1. **PR A (code):** Wrap `auditService.initialize()` (`backend/src/services/auditLog.ts:106,114`) in `withRLSContext(null, …, { isAdmin: true })` or move the audit salt to Secret Manager and drop the `system_config` row. Blocker for PR B.
2. **PR B (code sweep):** Audit the 24 bare `prisma.*` call sites enumerated in PR #30's follow-up. Each gets an RLS wrapper with the correct user or admin context. Under the current BYPASSRLS role they already work; this pass makes them fail-safe against the role cutover.
3. **PR C (infra):** Provision `omh_app` role on Cloud SQL + Railway (`NOSUPERUSER NOBYPASSRLS`); grant schema/table/sequence/function privileges; set `ALTER DEFAULT PRIVILEGES` so new migrations auto-grant. Rotate `DATABASE_URL` in GCP Secret Manager and Railway. Add a startup assertion that refuses to boot in `NODE_ENV=production` if `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user` returns `t`.
4. **PR D (test):** Multi-tenant integration test that exercises every controller with two distinct users and asserts cross-tenant reads are blocked. Only meaningful after PR C.

### Short-term (next 2 weeks — all Highs)
- Attach `aiLimiter` to all 4 Claude endpoints.
- Attach demo-protection middleware to admin user-modification routes.
- Fix `deleteAllData` + `exportUserData` to cover all 11 PHI categories.
- Require password confirmation on `deleteAllData` / `deleteAccount`.
- Fix cross-user RLS (provider queries use `withRLSTransaction`).
- Align password policy (Zod 12 chars).
- JWT verify with explicit algorithms/issuer/audience.
- `npm audit fix` cycle on backend; re-test.
- Remove `continue-on-error` from CI audit step; treat vulns as build failures.

### Medium-term (next month)
- Clean up all Medium findings (37 items).
- Penetration test before first real customer.
- Written risk assessment + breach notification plan per HIPAA §164.308 / §164.400.
- Decide on DNA/Genetics model removal (deprecated but schema persists).

---

## Evidence references

Full findings with file:line and quoted evidence:
- [Core audit](./SECURITY_AUDIT_core.md) — prompts 01, 02, 03, 04, 05, 06, 10, 11
- [Periphery audit](./SECURITY_AUDIT_periphery.md) — prompts 07, 08, 09, 12, 13, 30, 31, 32
- [Domain audit](./SECURITY_AUDIT_domain.md) — prompts 26, 27, 28, 29

---

## Compliance (summary — full in HIPAA_CHECKLIST.md)

| Area | Status |
|---|---|
| Technical safeguards (§164.312) | 🟡 Implemented with gaps (C-1, C-2, C-6, C-7, C-8). C-8 specifically downgrades §164.312(a) Access Control from ✅ to 🟡 Partial at the DB layer — the application layer still enforces it. |
| Administrative safeguards (§164.308) | ⏳ Risk assessment + policies TBD |
| Physical safeguards (§164.310) | 🟡 GCP-covered; workstation-level policy TBD |
| Breach notification (§164.400) | ⏳ Written plan TBD |
| BAAs | 🟡 GCP assumed ✅, Anthropic ✅ (2026-04-16), SendGrid N/A |

---

## Next audit

- **Rerun after Critical fixes land** (expected turnaround: 1-2 weeks if prioritized).
- **Full re-audit quarterly** via `prompts/24-full-security-audit.md`.
- **Per-PR spot audits** for any schema change or new external-API integration.
