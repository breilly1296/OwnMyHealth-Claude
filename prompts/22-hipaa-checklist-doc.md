---
tags:
  - documentation
  - hipaa
  - compliance
type: prompt
priority: 1
updated: 2026-04-24
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
| `backend/src/services/encryption.ts` | §164.312(a) encryption at rest. `PHI_FIELDS`. |
| `backend/src/services/userEncryption.ts` | Per-user key derivation. |
| `backend/src/services/auditLog.ts` | §164.312(b) audit controls + 7y retention scheduler. |
| `backend/src/middleware/auth.ts` | §164.312(a) access control, auto-logoff (token expiry). |
| `backend/src/middleware/rbac.ts` | Role-based access control. |
| `backend/src/services/authService.ts` | Session lifecycle, auto-logoff cadence. |
| `backend/src/services/database.ts` | §164.312(a) technical access (RLS). |
| `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` | RLS enforcement at the DB layer. |
| `backend/src/utils/logger.ts` | PHI redaction in logs (§164.312 integrity, minimum necessary). |
| `backend/src/middleware/csrf.ts`, `rateLimiter.ts`, `validation.ts` | Defense-in-depth for §164.312(a). |
| `backend/railway.toml`, `.github/workflows/deploy.yml` | TLS / transmission security posture, BAA-inferable infra. |
| `CLAUDE.md` (BAA / removed features), project memory (Anthropic BAA 2026-04-16) | BAA status. |
| Existing `SECURITY_STATUS.md` and `SECURITY_AUDIT_*.md` in `New Project Documents/` | Open findings that affect compliance status. |

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
| Google Cloud | Infra (Cloud Run, Cloud SQL, GCS, Document AI) | TBD (external: check GCP Console billing contact) | TBD | — |
| Anthropic | AI API | ✅ Signed | 2026-04-16 | project memory + `ANTHROPIC_BAA_ACTIVE` env gate |
| SendGrid | Email | TBD (external) | TBD | — |
| ... | ... | ... | ... | ... |

### Technical safeguards table (the load-bearing artifact)

| Requirement | Standard | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| Unique user ID | §164.312(a)(2)(i) | ✅ | `backend/prisma/schema.prisma:Lxx` (`User.id` cuid) | — |
| Auto logoff | §164.312(a)(2)(iii) | ✅ | `backend/src/config/index.ts:Lxx` (JWT expiry), `authService.ts:Lyy` (session cleanup) | 15-min access + refresh rotation |
| Encryption at rest | §164.312(a)(2)(iv) | ✅ | `backend/src/services/encryption.ts:Lxx` (AES-256-GCM), `userEncryption.ts:Lyy` (PBKDF2-SHA512 per-user keys) | See `PHI_TAXONOMY.md` for per-field coverage |
| Audit controls | §164.312(b) | ✅ | `backend/src/services/auditLog.ts:Lxx`, 7y retention scheduler at `Lyy` | Every PHI write audited; read audits partial — see `PHI_TAXONOMY.md` drift |
| Integrity (ePHI authentication) | §164.312(c) | 🟡 | AES-256-GCM provides AEAD authentication tag at `encryption.ts:Lxx` | No higher-level integrity (e.g., chain of custody) |
| Person/entity authentication | §164.312(d) | ✅ | `backend/src/middleware/auth.ts:Lxx` (JWT verify), bcrypt password hashing at `authService.ts:Lyy` | MFA TBD (external: roadmap) |
| Transmission security | §164.312(e)(2)(ii) | ✅ | TLS enforced by Cloud Run (HTTPS-only); internal DB over Cloud SQL proxy | cite `railway.toml` / `deploy.yml` where TLS is configured |
| Access control (RLS) | §164.312(a)(1) | ⚠️ policy present / runtime gap | `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` (policies) + `backend/src/services/database.ts:Lxx` (wrappers) | **Open finding** C-8: app runs as BYPASSRLS role — see `SECURITY_STATUS.md` |
| Minimum necessary (log redaction) | §164.502(b) | 🟡 | `backend/src/utils/logger.ts` `SENSITIVE_FIELDS` — diff drift per `PHI_TAXONOMY.md` | Patch any redaction-gap findings |
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
4. What's the status of §164.312(a)(1) access control and what's the open runtime gap?
5. Which scheduler enforces 7-year audit retention, and where in code?
6. Which HIPAA standards are `✅ shipped` vs `🟡 partial` vs `⏳ pending`?
7. Is the Anthropic BAA active, and how does the code gate on it?
8. What breach-notification gap is most urgent to close?
9. Where would a reader find the per-field PHI encryption matrix?
10. What's the RLS runtime gap (C-8) and where is the remediation plan tracked?
11. How does password hashing satisfy §164.312(d)?
12. Is transmission security (TLS) enforced at the load balancer, and what cites this?

---

## No-TBD enforcement

Before marking anything TBD:

- **BAA dates**: search memory for dates + `ANTHROPIC_BAA_ACTIVE`; check `CLAUDE.md` and any BAA mentions in session summaries.
- **RLS runtime gap**: cross-reference current `SECURITY_STATUS.md` and `SECURITY_AUDIT_infrastructure.md` in `New Project Documents/`. Quote the finding ID (C-8) and the remediation plan.
- **Retention cadence**: read `auditLog.ts`; the scheduler's `setInterval(...)` argument is the cadence.
- **TLS posture**: read `deploy.yml` for Cloud Run `--ingress=all/internal`; Cloud Run enforces HTTPS-only at the edge.
- **Password hashing**: grep `bcrypt` in `authService.ts` to confirm algorithm + cost factor.

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
- [`ENV_VARS.md`](./ENV_VARS.md) — BAA gates, `PHI_ENCRYPTION_KEY`.
- [`RUNBOOK.md`](./RUNBOOK.md) — breach-response operational steps.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Find encryption sites | Grep | `pattern: "encryptPHI|decryptPHI|createCipheriv|createDecipheriv"` over `backend/src/**` |
| Find audit sites | Grep | `pattern: "auditLog\\.log\\("` over `backend/src/**` |
| Find bcrypt usage | Grep | `pattern: "bcrypt\\."` over `backend/src/**` |
| Find RLS policies | Read | latest `backend/prisma/migrations/*/migration.sql` with RLS |
| Find scheduler | Grep | `pattern: "setInterval|cron"` over `backend/src/services/**` |
| Read audit outputs | Read | `New Project Documents/SECURITY_STATUS.md`, `SECURITY_AUDIT_*.md` |

---

## Output: file and location

Write the final document to `New Project Documents/HIPAA_CHECKLIST.md`.
