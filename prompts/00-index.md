---
tags:
  - index
  - meta
type: index
priority: 1
---

# OwnMyHealth Prompts Index

Quick reference for all available prompts.

---

## Security Audit Prompts (01-13, 26-30)

| # | Prompt | Purpose | Priority |
|---|--------|---------|----------|
| 01 | [[01-database-schema]] | Schema security, RLS, indexes | Critical |
| 02 | [[02-encryption]] | AES-256-GCM, key management | Critical |
| 03 | [[03-authentication]] | JWT, passwords, sessions | Critical |
| 04 | [[04-csrf]] | CSRF token validation | Critical |
| 05 | [[05-audit-logging]] | HIPAA audit logging | Critical |
| 06 | [[06-api-routes]] | Route security, authorization | High |
| 07 | [[07-input-validation]] | UUID, file, string validation | High |
| 08 | [[08-rate-limiting]] | Brute force prevention | Medium |
| 09 | [[09-external-apis]] | API key security, SSRF | Medium |
| 10 | [[10-frontend-auth]] | Token storage, auth flow | High |
| 11 | [[11-environment-secrets]] | Secret management | Critical |
| 12 | [[12-cicd-security]] | Pipeline security | High |
| 13 | [[13-dependency-health]] | Vulnerabilities, updates | Medium |
| 26 | [[26-provider-collaboration]] | Provider-patient consent, cross-user access | High |
| 27 | [[27-ai-integration]] | Claude API, PHI in prompts, cost control | High |
| 28 | [[28-file-storage]] | GCS, signed URLs, upload validation | Medium |
| 29 | [[29-data-portability]] | Export, deletion, GDPR compliance | Medium |
| 30 | [[30-admin-security]] | Admin privilege, user management | Medium |

---

## Documentation Prompts (14-23)

| # | Prompt | Generates | Method |
|---|--------|-----------|--------|
| 14 | [[14-strategy-doc]] | STRATEGY.md | Q&A |
| 15 | [[15-runbook-doc]] | RUNBOOK.md | Code + Q&A |
| 16 | [[16-architecture-doc]] | ARCHITECTURE.md | Code + Q&A |
| 17 | [[17-api-reference-doc]] | API_REFERENCE.md | Code |
| 18 | [[18-troubleshooting-doc]] | TROUBLESHOOTING.md | Q&A |
| 19 | [[19-changelog-doc]] | CHANGELOG.md | Git + Q&A |
| 20 | [[20-known-issues-doc]] | KNOWN_ISSUES.md | Code + Q&A |
| 21 | [[21-security-status-doc]] | SECURITY_STATUS.md | Code + Q&A |
| 22 | [[22-hipaa-checklist-doc]] | HIPAA_CHECKLIST.md | Code + Q&A |
| 23 | [[23-financial-tracker-doc]] | FINANCIAL_TRACKER.md | Q&A |

---

## Meta Prompts (24-25)

| # | Prompt | Purpose |
|---|--------|---------|
| 24 | [[24-full-security-audit]] | Run all security prompts |
| 25 | [[25-full-doc-refresh]] | Generate all documentation |

---

## Quick Start

### New to the Project?
1. Start with [[16-architecture-doc]] to understand the system
2. Read [[15-runbook-doc]] for operational commands
3. Check [[20-known-issues-doc]] for current bugs

### Running a Security Audit?
1. Use [[24-full-security-audit]] for comprehensive review
2. Or run individual prompts 01-13 and 26-30 as needed
3. Update [[21-security-status-doc]] with findings

### Updating Documentation?
1. Use [[25-full-doc-refresh]] for complete refresh
2. Or run individual prompts 14-23 as needed

### Troubleshooting?
1. Check [[18-troubleshooting-doc]] for known solutions
2. Check [[20-known-issues-doc]] for known bugs

---

## Usage Tips

### In Claude Code
Best for prompts that scan code:
- 01-13, 26-30 (security audits)
- 16-architecture-doc
- 17-api-reference-doc
- 20-known-issues-doc

### In Claude.ai
Best for Q&A prompts:
- 14-strategy-doc
- 18-troubleshooting-doc
- 23-financial-tracker-doc

### Either Works
Mixed prompts that need both:
- 15-runbook-doc
- 21-security-status-doc
- 22-hipaa-checklist-doc

---

## Prompt Maintenance

These prompts should be updated when:
- New security areas need coverage
- New document types needed
- Prompt format improvements identified
- OwnMyHealth architecture changes significantly
