---
tags:
  - documentation
  - security
type: prompt
priority: 1
---

# Generate SECURITY_STATUS.md

## Purpose
Generate a current security status document (not historical log).

## From Codebase (Claude Code)
Run the security audit prompts (01-13) and summarize findings.

### Quick Security Scan
```bash
# Check for hardcoded secrets
grep -r "sk-ant\|password.*=.*['\"]" backend/src/ --include="*.ts"

# Check for console.log with sensitive data
grep -r "console\.log.*password\|console\.log.*token\|console\.log.*key" backend/src/

# Check npm vulnerabilities
npm audit
cd backend && npm audit

# Find security TODOs
grep -r "TODO.*security\|FIXME.*security" backend/src/ src/
```

## Questions to Ask

### Last Security Audit
1. When was the last security audit?
2. What tool was used? (ZeroPath, manual, etc.)
3. What was the overall result/grade?

### Findings Status
1. How many findings were there by severity?
2. How many are fixed?
3. How many are still open?
4. Any accepted risks?

### Security Incidents
1. Any security incidents since last audit?
2. How were they handled?
3. What was learned?

### Compliance
1. What BAAs are signed?
2. What certifications exist or are planned?

## Output Format

```markdown
# OwnMyHealth Security Status

**Last Updated:** [Date]
**Last Audit:** [Date] by [Tool]
**Security Grade:** [A/B/C]

---

## Security Posture Summary

| Metric | Status |
|--------|--------|
| Critical Findings | 0 |
| High Findings | 0 |
| Open Issues | X |
| BAAs Signed | GCP ✅, Anthropic ⏳ |

---

## Controls Status

### Authentication
| Control | Status | Notes |
|---------|--------|-------|
| JWT Implementation | ✅ | 15min access, 7day refresh |
| Password Hashing | ✅ | bcrypt cost 10 |
| CSRF Protection | ✅ | Double-submit cookie |
| Rate Limiting | ⚠️ | Auth endpoints only |

### Encryption
| Control | Status | Notes |
|---------|--------|-------|
| PHI at Rest | ✅ | AES-256-GCM |
| In Transit | ✅ | TLS 1.3 |
| Key Management | ✅ | GCP Secret Manager |

### Input Validation
| Control | Status | Notes |
|---------|--------|-------|
| UUID Validation | ✅ | All route params |
| File Validation | ⚠️ | Extension only |
| SQL Injection | ✅ | Prisma ORM |

### Audit Logging
| Control | Status | Notes |
|---------|--------|-------|
| PHI Access | ✅ | All operations logged |
| Auth Events | ✅ | Login/logout tracked |
| IP Logging | ✅ | Using req.ip |

---

## Recent Audit Findings

### [Audit Name/Date]

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Finding description | Medium | ✅ Fixed |
| 2 | Another finding | Low | ✅ Fixed |

---

## Open Issues

| Issue | Severity | Status | ETA |
|-------|----------|--------|-----|
| Issue name | Medium | In Progress | [Date] |

---

## Compliance Status

| Requirement | Status |
|-------------|--------|
| GCP BAA | ✅ Signed |
| Anthropic BAA | ⏳ Pending |
| SOC 2 | ⏳ Q3 2026 |
| HIPAA Technical | ✅ Implemented |

---

## Upcoming Security Tasks

- [ ] Task 1
- [ ] Task 2

---

*Next audit scheduled: [Date]*
```
