---
tags:
  - documentation
  - hipaa
  - compliance
type: prompt
priority: 1
updated: 2026-06-16
---

# Generate HIPAA_CHECKLIST.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — canonical PHI fields. Use, don't re-enumerate.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/HIPAA_CHECKLIST.md` — a current-state compliance reference that maps each HIPAA safeguard requirement to **code evidence** (file:line) and **status**. A reader must be able to answer "how does this app satisfy §164.312(b) audit controls?" with a code pointer, not a paragraph.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/services/encryption.ts` | §164.312(a) encryption at rest. `PHI_FIELDS` (encryption.ts:476). Now includes `LabConnection.accessTokenEncrypted/refreshTokenEncrypted` (Quest SMART-on-FHIR OAuth tokens), `User.healthProfileEncrypted`, `UserFile.originalFilenameEncrypted` (L24, 2026-06-15 — raw client filename can embed patient identifiers), `HealthGoal.currentValueEncrypted/startValueEncrypted` + `GoalProgressHistory.valueEncrypted` (M4), and `AuditLog.metadataEncrypted` (M6). |
| `backend/src/services/userEncryption.ts` | Per-user **salt** management only — gets/creates the per-user salt in `UserEncryptionKey` (encrypted with the master key). The actual PBKDF2-SHA512 derivation lives in `encryption.ts` `deriveUserKey` (encryption.ts:236, `crypto.pbkdf2Sync(..., 'sha512')` at encryption.ts:247-252, `PBKDF2_ITERATIONS = 600000` at encryption.ts:85). |
| `backend/src/services/auditLog.ts` | §164.312(b) audit controls + 7y (`RETENTION_DAYS = 2555`) retention. `startAuditCleanup` runs a 24h `setInterval` UNLESS `AUDIT_CLEANUP_TOKEN` is set (then delegated to Cloud Scheduler). |
| `backend/src/routes/internalRoutes.ts` | `POST /api/v1/internal/audit-cleanup` — token-gated Cloud Scheduler retention endpoint (404 when `AUDIT_CLEANUP_TOKEN` unset, 401 on bad token). |
| `backend/src/middleware/auth.ts` | §164.312(a) access control, auto-logoff (token expiry). |
| `backend/src/middleware/rbac.ts` | Role-based access control. |
| `backend/src/services/authService.ts` | Session lifecycle, auto-logoff cadence, bcrypt hashing (cost `BCRYPT_ROUNDS`, default 13). |
| `backend/src/services/database.ts` | §164.312(a) technical access (RLS); `assertNoBypassRLS()` hard-exits in production if the DB role has BYPASSRLS. |
| `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` | RLS enforcement at the DB layer (later patched by `20260529_fix_has_provider_access`, `20260530_add_users_select_provider`). |
| `backend/src/utils/logger.ts` (`SENSITIVE_FIELDS` at logger.ts:30), `phiRedaction.ts` | PHI redaction in logs (§164.312 integrity, minimum necessary). (`pdfRedaction.ts` was DELETED in the dead-code cleanup — `pdf-lib`/`redactPatientBanner` are gone; do not cite it.) |
| `backend/src/middleware/csrf.ts`, `rateLimiter.ts` (8 limiters via `rateLimitStore.ts`), `validation.ts` | Defense-in-depth for §164.312(a). |
| `.github/workflows/deploy.yml` (Cloud Run `gcloud run deploy` at deploy.yml:183) | TLS / transmission security posture, BAA-inferable infra. (`backend/railway.toml` exists but Cloud Run is the live deploy target.) Note the current pipeline: deploy is gated on full CI (`needs: ci`, deploy.yml:66), migrations no longer run at container boot — `prisma migrate deploy` runs as a dedicated Cloud Run job `ownmyhealth-migrate` (deploy.yml:43, `gcloud run jobs deploy`/`execute` at deploy.yml:139,158) and the Dockerfile CMD is just `node dist/app.js` (`backend/Dockerfile:93`). |
| `backend/src/config/index.ts` (`ANTHROPIC_BAA_ACTIVE`, `GOOGLE_BAA_ACTIVE` gates) | BAA runtime gates. |
| `CLAUDE.md` (BAA / removed features), project memory (Anthropic BAA 2026-04-16) | BAA status. |
| Existing `SECURITY_STATUS.md` in `New Project Documents/` (also `PROJECT_TEARDOWN_2026-06-13.md`, `KNOWN_ISSUES.md`) | Open findings that affect compliance status. (There is no `SECURITY_AUDIT_*.md` file family in the repo — do not cite one.) |

---

## Required sections

1. **Header** — audit date, compliance officer (TBD external if absent), maturity phase (pre-beta / beta / prod).
2. **Business Associate Agreements (BAAs)** — table: vendor, service, status, date, source.
3. **Administrative Safeguards (§164.308)** — per standard: requirement, status, evidence, gap.
4. **Physical Safeguards (§164.310)** — per standard: requirement, status, evidence, gap. (Largely inherited from GCP.)
5. **Technical Safeguards (§164.312)** — per standard: requirement, status, evidence (file:line), gap.
6. **Breach Notification (§164.400-414)** — detection, process, HHS reporting readiness.
7. **Required documentation** — risk analysis, policies, procedures — status and where they live.
8. **Minimum necessary + PHI access** — link to `PHI_TAXONOMY.md` for per-field coverage.
9. **Roadmap** — per-phase, with PR/issue links where possible.
10. **Related Documents**.
11. **Prompt drift log**.

---

## Required artifacts

### BAA table

| Vendor | Service | BAA status | Date (ISO) | Source |
|---|---|---|---|---|
| Google Cloud | Infra (Cloud Run, Cloud SQL, GCS) + Document AI OCR | TBD (external: check GCP Console billing contact); Document AI OCR runtime-gated by `GOOGLE_BAA_ACTIVE` | TBD | `backend/src/config/index.ts` `documentAiBaaActive` gate |
| Anthropic | AI API (extraction, chat, cost analysis) | ✅ Signed | 2026-04-16 | project memory + `ANTHROPIC_BAA_ACTIVE` env gate |
| Quest Diagnostics | SMART-on-FHIR lab connection (OAuth, lab result sync) | TBD (external) — tokens stored encrypted (`LabConnection.*TokenEncrypted`) | TBD | `backend/src/services/fhir/` + `QUEST_FHIR_*` env vars |
| SendGrid | Email | TBD (external) | TBD | — |
| ... | ... | ... | ... | ... |

### Technical safeguards table (the load-bearing artifact)

| Requirement | Standard | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| Unique user ID | §164.312(a)(2)(i) | ✅ | `backend/prisma/schema.prisma:Lxx` (`User.id` UUID, `@default(dbgenerated("gen_random_uuid()"))`) | Was cuid; switched to DB-generated UUID in migration `20260424_align_uuid_defaults_and_rename_claude_response` |
| Auto logoff | §164.312(a)(2)(iii) | ✅ | `backend/src/config/index.ts:Lxx` (`JWT_ACCESS_EXPIRES_SECONDS`, default 900), `authService.ts:Lyy` (session cleanup) | 15-min access + refresh rotation |
| Encryption at rest | §164.312(a)(2)(iv) | ✅ | `backend/src/services/encryption.ts:Lxx` (AES-256-GCM), PBKDF2-SHA512 per-user key derivation at `encryption.ts:236` (`deriveUserKey`, `crypto.pbkdf2Sync(...,'sha512')` at :247-252, 600k iterations); `userEncryption.ts` manages the per-user salt only | See `PHI_TAXONOMY.md` for per-field coverage. Coverage now also includes `UserFile.originalFilenameEncrypted` (L24 — raw filename can embed patient identifiers), `HealthGoal.current/startValueEncrypted` + `GoalProgressHistory.valueEncrypted` (M4), and `AuditLog.metadataEncrypted` (M6) |
| OAuth token encryption (lab connections) | §164.312(a)(2)(iv) | ✅ | `backend/src/services/encryption.ts` `PHI_FIELDS.LabConnection` (`accessTokenEncrypted`, `refreshTokenEncrypted`) | Quest SMART-on-FHIR tokens — a stolen token is a direct path to live PHI; migration `20260418_add_lab_connections` |
| Audit controls | §164.312(b) | ✅ | `backend/src/services/auditLog.ts` (`RETENTION_DAYS = 2555`); `startAuditCleanup` 24h `setInterval`, or Cloud Scheduler via `internalRoutes.ts` `/audit-cleanup` when `AUDIT_CLEANUP_TOKEN` is set. Audit PHI snapshots encrypted at rest: `PHI_FIELDS.AuditLog` = `previousValueEncrypted`, `newValueEncrypted`, `metadataEncrypted` (encryption.ts:528-530). Retention is also **DB-enforced**: the `audit_logs_delete` RLS policy only permits deletes of rows older than 7 years (migration `20260613_force_rls_and_audit_retention`) | Every PHI write audited; read audits partial — see `PHI_TAXONOMY.md` drift. The legacy plaintext `audit_logs.metadata` column was IRREVERSIBLY DROPPED in migration `20260615_drop_legacy_audit_metadata` (M6); new rows write AES-256-GCM metadata only |
| Integrity (ePHI authentication) | §164.312(c) | 🟡 | AES-256-GCM provides AEAD authentication tag at `encryption.ts:Lxx` | No higher-level integrity (e.g., chain of custody) |
| Person/entity authentication | §164.312(d) | ✅ | `backend/src/middleware/auth.ts:Lxx` (JWT verify), bcrypt hashing at `authService.ts:Lyy` (`bcryptjs`, cost `BCRYPT_ROUNDS` default 13) | MFA TBD (external: roadmap) |
| Transmission security | §164.312(e)(2)(ii) | ✅ | TLS enforced by Cloud Run (HTTPS-only); internal DB over Cloud SQL proxy | cite `.github/workflows/deploy.yml` (`gcloud run deploy`) where the service is deployed; `railway.toml` is legacy |
| Access control (RLS) | §164.312(a)(1) | ✅ prod / 🟡 dev-staging | `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` (policies) + **FORCE ROW LEVEL SECURITY on all 19 RLS tables** (migration `20260613_force_rls_and_audit_retention`, closes owner-bypass) + `backend/src/services/database.ts` (`withRLSContext`/`withRLSTransaction`; two boot guards: `assertNoBypassRLS()` at database.ts:192 + `assertRLSForced()` at database.ts:193,270) | C-8 closed in production: both `assertNoBypassRLS()` and `assertRLSForced()` call `process.exit(1)` in prod (database.ts:253,305) — the former if the prod DB role has BYPASSRLS, the latter if any RLS table is missing FORCE RLS; dev/staging only warn — see `SECURITY_STATUS.md` |
| Minimum necessary (log redaction) | §164.502(b) | 🟡 | `backend/src/utils/logger.ts` `SENSITIVE_FIELDS` (logger.ts:30), plus `phiRedaction.ts` — diff drift per `PHI_TAXONOMY.md` (`pdfRedaction.ts` no longer exists — deleted in dead-code cleanup) | Patch any redaction-gap findings |
| ... | ... | ... | ... | ... |

Status legend: ✅ shipped • 🟡 partial • ⚠️ gap / open finding • ⏳ TBD / pending

### Administrative safeguards table (same shape as Technical, per §164.308 subsection)

### Physical safeguards table (mostly inherited from GCP — cite the BAA)

### Breach notification table

| Item | Status | Evidence / Owner | Gap |
|---|---|---|---|
| Detection procedures | ⏳ | `logger.ts` PHI redaction + audit log, but no alerting | Hook to Cloud Logging alert policies |
| Notification process | ⏳ | TBD (external: policy doc) | Create breach-notification SOP |
| HHS reporting | ⏳ | TBD | See §164.408 |

### Roadmap

Structured by phase, with links to tracking issues / PRs when they exist in the repo. If tracking is external, mark and provide the external locator.

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc + siblings**:

1. Which vendors have signed BAAs, and when?
2. What code evidence satisfies §164.312(a) auto-logoff, and what's the timeout?
3. Where is ePHI encryption implemented and which PHI fields are covered? (cross-link to `PHI_TAXONOMY.md`)
4. What's the status of §164.312(a)(1) access control, and how is it enforced in production vs dev/staging?
5. Which scheduler enforces 7-year audit retention, and where in code? (in-process `setInterval` vs Cloud Scheduler `/internal/audit-cleanup`)
6. Which HIPAA standards are `✅ shipped` vs `🟡 partial` vs `⏳ pending`?
7. Is the Anthropic BAA active, and how does the code gate on it? Same question for Google Document AI (`GOOGLE_BAA_ACTIVE`).
8. What breach-notification gap is most urgent to close?
9. Where would a reader find the per-field PHI encryption matrix?
10. What's the RLS C-8 status now, where is `assertNoBypassRLS()` enforced, and what residual gap remains in dev/staging?
11. How does password hashing satisfy §164.312(d), and at what bcrypt cost factor?
12. Is transmission security (TLS) enforced at the load balancer, and what cites this?
13. How are Quest SMART-on-FHIR OAuth tokens protected at rest, and which PHI_FIELDS entries cover them?

---

## No-TBD enforcement

Before marking anything TBD:

- **BAA dates**: search memory for dates + `ANTHROPIC_BAA_ACTIVE`; check `CLAUDE.md` and any BAA mentions in session summaries. Also confirm the Google gate (`GOOGLE_BAA_ACTIVE` / `documentAiBaaActive` in `config/index.ts`) for Document AI OCR.
- **RLS runtime gap**: cross-reference current `SECURITY_STATUS.md` in `New Project Documents/` (no `SECURITY_AUDIT_*.md` exists — also check `PROJECT_TEARDOWN_2026-06-13.md`/`KNOWN_ISSUES.md`). C-8 is now closed in production — `assertNoBypassRLS()` in `database.ts` calls `process.exit(1)` if the prod DB role has BYPASSRLS, and `assertRLSForced()` (database.ts:270) does the same if any of the 19 RLS tables is missing FORCE RLS; dev/staging only warn. Quote the finding ID and note the residual dev/staging-only status.
- **Retention cadence**: read `auditLog.ts`; `RETENTION_DAYS = 2555` (~7y). `startAuditCleanup` runs a 24h `setInterval` only when `AUDIT_CLEANUP_TOKEN` is unset; otherwise retention is delegated to Cloud Scheduler hitting `POST /api/v1/internal/audit-cleanup` (`internalRoutes.ts`).
- **TLS posture**: read `deploy.yml` for the `gcloud run deploy` step; Cloud Run enforces HTTPS-only at the edge.
- **Password hashing**: grep `bcrypt` in `authService.ts` to confirm algorithm (`bcryptjs`) + cost factor (`BCRYPT_ROUNDS`, default 13).

If an administrative safeguard requires external policy docs that don't exist in the repo:

```
TBD (external: formal policy not yet written — flag to compliance owner; stub in `docs/` when drafted)
```

---

## Cross-links

The generated `HIPAA_CHECKLIST.md` must link to:

- [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) — open findings that map to partial / gap statuses.
- [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) — per-field encryption + audit coverage.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — RLS policies implementing §164.312(a).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — encryption + audit layers at the system level.
- [`ENV_VARS.md`](./ENV_VARS.md) — BAA gates (`ANTHROPIC_BAA_ACTIVE`, `GOOGLE_BAA_ACTIVE`), `PHI_ENCRYPTION_KEY`, `AUDIT_CLEANUP_TOKEN`, `QUEST_FHIR_*`.
- [`RUNBOOK.md`](./RUNBOOK.md) — breach-response operational steps.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Find encryption sites | Grep | `pattern: "encryptPHI|decryptPHI|createCipheriv|createDecipheriv"` over `backend/src/**` |
| Find audit sites | Grep | `pattern: "auditLog\\.log\\("` over `backend/src/**` |
| Find bcrypt usage | Grep | `pattern: "bcrypt\\."` over `backend/src/**` |
| Find RLS policies | Read | `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` (+ later `*has_provider_access*` / `*select_provider*` patches) |
| Find scheduler / retention | Grep | `pattern: "setInterval|RETENTION_DAYS|startAuditCleanup"` over `backend/src/services/**`; `audit-cleanup` over `backend/src/routes/**` |
| Find BAA gates | Grep | `pattern: "ANTHROPIC_BAA_ACTIVE|GOOGLE_BAA_ACTIVE"` over `backend/src/**` |
| Find RLS enforcement | Grep | `pattern: "assertNoBypassRLS|assertRLSForced|BYPASSRLS|FORCE ROW LEVEL"` over `backend/src/services/database.ts` (+ migration `20260613_force_rls_and_audit_retention`) |
| Read audit outputs | Read | `New Project Documents/SECURITY_STATUS.md` (also `PROJECT_TEARDOWN_2026-06-13.md`, `KNOWN_ISSUES.md`; no `SECURITY_AUDIT_*.md` exists) |

---

## Output: file and location

Write the final document to `New Project Documents/HIPAA_CHECKLIST.md`.
