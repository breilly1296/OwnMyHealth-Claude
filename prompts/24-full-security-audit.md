---
tags:
  - security
  - audit
  - meta
type: prompt
priority: 1
updated: 2026-04-16
---

# Full Security Audit

> Read the [review protocol](./_review-protocol.md) **first**. Every sub-prompt inherits it.
> Reference the [PHI inventory](./_phi-inventory.md) for any field-level verification.
> Use [Claude Code tools](./_verification-tools.md) for all greps.

## Purpose
Run a comprehensive security audit using all 20 security prompts. Consolidate findings into one report per the review-protocol shape, then update [21-security-status-doc](./21-security-status-doc.md).

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
- [ ] [27-ai-integration](./27-ai-integration.md) — Claude API, PHI in prompts, cost control
- [ ] [31-logging-observability](./31-logging-observability.md) — PHI redaction, Cloud Logging

### Medium
- [ ] [08-rate-limiting](./08-rate-limiting.md) — 7 limiters, coverage on all expensive routes
- [ ] [09-external-apis](./09-external-apis.md) — API key handling, SSRF, timeouts
- [ ] [13-dependency-health](./13-dependency-health.md) — npm audit, outdated packages
- [ ] [28-file-storage](./28-file-storage.md) — GCS IAM, signed URL TTL, upload validation
- [ ] [29-data-portability](./29-data-portability.md) — Export completeness, deletion cascades
- [ ] [30-admin-security](./30-admin-security.md) — Admin privilege, escalation prevention
- [ ] [32-error-handling](./32-error-handling.md) — Error shape, stack-trace safety, async flow

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
