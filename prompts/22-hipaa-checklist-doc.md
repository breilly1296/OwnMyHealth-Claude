---
tags:
  - documentation
  - hipaa
  - compliance
type: prompt
priority: 1
updated: 2026-04-16
---

# Generate HIPAA_CHECKLIST.md

> For PHI field identification, reference the [PHI inventory](./_phi-inventory.md) — don't re-enumerate.
> Use [Claude Code tools](./_verification-tools.md).

## Purpose
Generate a HIPAA compliance checklist with **current** status — not historical.

## From Codebase (Claude Code)

### Technical Safeguards Verification

| Safeguard | Tool | Parameters |
|---|---|---|
| Encryption implementation | Grep | `pattern: "encrypt\|decrypt\|AES\|GCM"`, `glob: "backend/src/services/**/*.ts"` |
| Audit logging coverage | Grep | `pattern: "auditLog\|createAuditLog"`, `glob: "backend/src/**/*.ts"` |
| Access control middleware | Grep | `pattern: "authenticate\|authorize\|requireRole\|requireMinRole"`, `glob: "backend/src/middleware/**/*.ts"` |
| Token expiration | Grep | `pattern: "expiresIn\|exp\\b"`, `glob: "backend/src/**/*.ts"` |
| PHI fields in schema | Grep | `pattern: "Encrypted\\b"`, `path: "backend/prisma/schema.prisma"` — cross-check with [_phi-inventory](./_phi-inventory.md) |

### PHI Field Identification
Pull the canonical list from [_phi-inventory](./_phi-inventory.md). If your output differs from the inventory, the inventory (not your output) is wrong — open a finding.

## Questions to Ask

### Business Associate Agreements
1. What BAAs are signed?
   - Cloud provider (GCP, AWS)?
   - AI provider (Anthropic)?
   - Any other vendors?
2. What BAAs are pending?
3. Dates signed?

### Administrative Safeguards
1. Is there a designated security officer?
2. Are security policies documented?
3. Is there a breach notification procedure?
4. Is there a disaster recovery plan?

### Physical Safeguards
1. Where is data physically stored?
2. What physical security does the cloud provider offer?
3. Any local development with PHI?

### Technical Safeguards (verify in code)
1. Access controls?
2. Audit logging?
3. Encryption at rest?
4. Encryption in transit?
5. Auto-logoff (token expiration)?

### Compliance Roadmap
1. What's the SOC 2 timeline?
2. Any audits scheduled?
3. What documentation is missing?

## Output Format

```markdown
# OwnMyHealth HIPAA Compliance Checklist

**Last Updated:** [Date]
**Compliance Officer:** [Name]
**Status:** [Development/Beta/Production]

---

## Business Associate Agreements

| Vendor | Service | BAA Status | Date |
|--------|---------|------------|------|
| Google Cloud | Infrastructure | ✅ Signed | [Date] |
| Anthropic | AI API | ⏳ Pending | - |

---

## Administrative Safeguards

### §164.308(a)(1) Security Management
| Requirement | Status | Notes |
|-------------|--------|-------|
| Risk Analysis | ⏳ | Not yet conducted |
| Risk Management | ✅ | Per ZeroPath |
| Sanction Policy | N/A | Solo founder |

### §164.308(a)(2) Assigned Security Responsibility
| Requirement | Status | Notes |
|-------------|--------|-------|
| Security Official | ✅ | [Name] |

[Continue for each HIPAA section...]

---

## Physical Safeguards

### §164.310(a) Facility Access
| Requirement | Status | Notes |
|-------------|--------|-------|
| Facility Security | ✅ | GCP data centers |

---

## Technical Safeguards

### §164.312(a) Access Control
| Requirement | Status | Notes |
|-------------|--------|-------|
| Unique User ID | ✅ | UUID per user |
| Auto Logoff | ✅ | 15-min token |
| Encryption | ✅ | AES-256-GCM |

### §164.312(b) Audit Controls
| Requirement | Status | Notes |
|-------------|--------|-------|
| Audit Mechanisms | ✅ | Comprehensive logging |

### §164.312(c) Integrity
| Requirement | Status | Notes |
|-------------|--------|-------|
| ePHI Authentication | ✅ | Checksums |

### §164.312(d) Authentication
| Requirement | Status | Notes |
|-------------|--------|-------|
| Authentication | ✅ | JWT + CSRF |

### §164.312(e) Transmission Security
| Requirement | Status | Notes |
|-------------|--------|-------|
| Encryption | ✅ | TLS 1.3 |

---

## Breach Notification Readiness

| Requirement | Status |
|-------------|--------|
| Detection Procedures | ⏳ |
| Notification Process | ⏳ |
| HHS Reporting | ⏳ |

---

## Required Documentation

| Document | Status |
|----------|--------|
| Risk Assessment | ⏳ Not started |
| Security Policies | ⏳ Not started |
| Breach Procedures | ⏳ Not started |
| Privacy Policy | ⏳ Not started |

---

## Compliance Roadmap

### Phase 1 (Current)
- [x] Technical controls
- [x] GCP BAA
- [ ] Anthropic BAA

### Phase 2 (Q2 2026)
- [ ] Documentation
- [ ] Risk assessment

### Phase 3 (Q3 2026)
- [ ] SOC 2 Type I
```
