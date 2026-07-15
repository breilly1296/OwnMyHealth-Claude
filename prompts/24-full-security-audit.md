---
tags:
  - security
  - audit
  - meta
type: prompt
priority: 1
updated: 2026-06-16
---

# Full Security Audit

> Read the [review protocol](./_review-protocol.md) **first**. Every sub-prompt inherits it.
> Reference the [PHI inventory](./_phi-inventory.md) for any field-level verification.
> Use [Claude Code tools](./_verification-tools.md) for all greps.

## Purpose
Run a comprehensive security audit using all 25 security prompts. Consolidate findings into one report per the review-protocol shape, then update [21-security-status-doc](./21-security-status-doc.md).

## Audit Checklist

Run each prompt in sequence. Carry findings forward — don't re-discover the same issue in multiple prompts.

### Critical
- [ ] [01-database-schema](./01-database-schema.md) — Schema, RLS, PHI presence
- [ ] [02-encryption](./02-encryption.md) — AES-256-GCM, per-user keys, PHI coverage
- [ ] [03-authentication](./03-authentication.md) — JWT, bcrypt, lockout, session lifecycle
- [ ] [04-csrf](./04-csrf.md) — Double-submit cookie, timing-safe compare
- [ ] [05-audit-logging](./05-audit-logging.md) — HIPAA retention, immutability, coverage
- [ ] [11-environment-secrets](./11-environment-secrets.md) — Secret Manager, no hardcoded keys

### High
- [ ] [06-api-routes](./06-api-routes.md) — Auth/RBAC/RLS context on every route
- [ ] [07-input-validation](./07-input-validation.md) — Zod schemas, UUIDs, file validation
- [ ] [10-frontend-auth](./10-frontend-auth.md) — Memory-only tokens, refresh order
- [ ] [12-cicd-security](./12-cicd-security.md) — Actions pinning, Dockerfile, service account scopes
- [ ] [26-provider-collaboration](./26-provider-collaboration.md) — Consent lifecycle, cross-user IDOR
- [ ] [27-ai-integration](./27-ai-integration.md) — Claude API, PHI in prompts, cost control (`aiCostTracker`/`aiSpendGuard`/AI budget env vars)
- [ ] [31-logging-observability](./31-logging-observability.md) — PHI redaction, Cloud Logging
- [ ] [41-fhir-lab-integration](./41-fhir-lab-integration.md) — SMART-on-FHIR OAuth, encrypted lab tokens, SSRF, sync IDOR
- [ ] [42-ai-cost-control](./42-ai-cost-control.md) — AI spend cap, cost tracking, per-user/global dollar budgets
- [ ] [44-token-revocation](./44-token-revocation.md) — Cross-instance revocation (`users.tokens_valid_after` + `revoked_access_tokens`), refresh-reuse family revoke

### Medium
- [ ] [08-rate-limiting](./08-rate-limiting.md) — 8 limiters (Redis-backed via `rateLimitStore`), coverage on all expensive routes
- [ ] [09-external-apis](./09-external-apis.md) — API key handling, SSRF (incl. FHIR `urlSafety`), AI spend, timeouts
- [ ] [13-dependency-health](./13-dependency-health.md) — npm audit, outdated packages
- [ ] [28-file-storage](./28-file-storage.md) — GCS IAM, signed URL TTL, upload validation
- [ ] [29-data-portability](./29-data-portability.md) — Export completeness, deletion cascades
- [ ] [30-admin-security](./30-admin-security.md) — Admin privilege, escalation prevention
- [ ] [32-error-handling](./32-error-handling.md) — Error shape, stack-trace safety, async flow
- [ ] [43-plan-gating-billing](./43-plan-gating-billing.md) — Plan-tier enforcement, gate bypass, billing authz
- [ ] [45-maintenance-jobs](./45-maintenance-jobs.md) — Cloud Run maintenance/backfill jobs (filename re-encrypt, goal-value backfill), least-privilege, RLS context, idempotency

## Coverage notes (newer domains)

Three domains the original 20 prompts only covered in passing now have **dedicated prompts** — folded into the fan-out above (41/42 High, 43 Medium). The deep owner gets the audit; the survey prompts still cross-check their slice:

- **Quest FHIR / lab connections** → [41-fhir-lab-integration](./41-fhir-lab-integration.md) (deep owner); also [09-external-apis](./09-external-apis.md) (SSRF/OAuth), [02-encryption](./02-encryption.md) (`accessTokenEncrypted`/`refreshTokenEncrypted`), [11-environment-secrets](./11-environment-secrets.md) (`QUEST_FHIR_*`).
- **AI cost / spend control** → [42-ai-cost-control](./42-ai-cost-control.md) (deep owner); also [27-ai-integration](./27-ai-integration.md) (PHI/BAA) + [08-rate-limiting](./08-rate-limiting.md) (`aiLimiter`).
- **Plan gating / billing tiers** → [43-plan-gating-billing](./43-plan-gating-billing.md) (deep owner); also [06-api-routes](./06-api-routes.md) + [30-admin-security](./30-admin-security.md) (`User.plan` must not be self-elevatable).

Still **no dedicated prompt** (covered only via the fan-out — log gaps as findings rather than skipping silently):

- **Onboarding wizard, email-change flow, notification preferences** → exercise [06-api-routes](./06-api-routes.md) (auth/RLS on `onboardingRoutes`) and [03-authentication](./03-authentication.md) (email-change verification, migration `20260601_add_email_change`).

Removed since the prompt era — confirm no dead references resurface: `uploadController` (logic moved to `uploadRoutes` + `controllers/upload/`) and the DNA/Genetics models (dropped in migration `20260423_drop_dna_genetics`).

## Audit Report Template

```markdown
# OwnMyHealth Security Audit Report

**Date:** [Date]
**Auditor:** Claude
**Scope:** Full codebase review

---

## Executive Summary

| Severity | Found | Fixed | Open |
|----------|-------|-------|------|
| Critical | X | X | X |
| High | X | X | X |
| Medium | X | X | X |
| Low | X | X | X |

**Overall Grade:** [A/B/C/D/F]

---

## Findings

### Critical

#### [Finding Title]
- **Location:** [file:line]
- **Description:** [what's wrong]
- **Impact:** [what could happen]
- **Recommendation:** [how to fix]
- **Status:** [Open/Fixed]

### High
[findings...]

### Medium
[findings...]

### Low
[findings...]

---

## Positive Observations

- [Good security practice found]
- [Another positive]

---

## Recommendations

### Immediate (This Week)
1. [Action item]

### Short-term (This Month)
1. [Action item]

### Long-term (This Quarter)
1. [Action item]

---

## Appendix

### Tools Used
- Manual code review
- grep searches
- npm audit

### Files Reviewed
- [List of key files]

### Out of Scope
- [What wasn't reviewed]
```

## After Audit

1. Prioritize findings by severity
2. Create issues/tasks for each finding
3. Fix critical and high issues before beta
4. Schedule follow-up audit in 30 days
5. Update SECURITY_STATUS.md with results
