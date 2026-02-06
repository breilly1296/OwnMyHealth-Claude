---
tags:
  - security
  - audit
  - meta
type: prompt
priority: 1
---

# Full Security Audit

## Purpose
Run a comprehensive security audit using all security prompts.

## Audit Checklist

Run each prompt in sequence and document findings:

### Critical Priority
- [ ] **01-database-schema** - Schema security, RLS, PHI identification
- [ ] **02-encryption** - AES-256-GCM, key management, PHI coverage
- [ ] **03-authentication** - JWT, passwords, cookies, refresh flow
- [ ] **04-csrf** - Token validation, header handling
- [ ] **05-audit-logging** - HIPAA logging, coverage, integrity

### High Priority
- [ ] **06-api-routes** - Auth on routes, authorization, input validation
- [ ] **07-input-validation** - UUID validation, file uploads, sanitization
- [ ] **10-frontend-auth** - Token storage, auth context, protected routes
- [ ] **12-cicd-security** - Workflow security, secrets, Docker
- [ ] **26-provider-collaboration** - Provider-patient consent, cross-user data access
- [ ] **27-ai-integration** - Claude API security, PHI in prompts, cost control

### Medium Priority
- [ ] **08-rate-limiting** - Auth endpoints, upload limits, cost control
- [ ] **09-external-apis** - API key security, SSRF prevention
- [ ] **11-environment-secrets** - Secret inventory, no hardcoded values
- [ ] **13-dependency-health** - Vulnerabilities, outdated packages
- [ ] **28-file-storage** - GCS bucket security, signed URLs, upload validation
- [ ] **29-data-portability** - Data export completeness, deletion cascades, HIPAA retention
- [ ] **30-admin-security** - Admin privileges, user management, escalation prevention

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
