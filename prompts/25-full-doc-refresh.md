---
tags:
  - documentation
  - meta
type: prompt
priority: 2
updated: 2026-04-16
---

# Full Documentation Refresh

## Purpose
Systematically update all documentation using the document prompts.

## Documentation Checklist

Go through each prompt and generate/update the document:

### Strategy & Business
- [ ] [14-strategy-doc](./14-strategy-doc.md) → `docs/STRATEGY.md`
- [ ] [23-financial-tracker-doc](./23-financial-tracker-doc.md) → `docs/FINANCIAL_TRACKER.md`

### Operations & Technical
- [ ] [15-runbook-doc](./15-runbook-doc.md) → `docs/RUNBOOK.md`
- [ ] [16-architecture-doc](./16-architecture-doc.md) → `docs/ARCHITECTURE.md`
- [ ] [17-api-reference-doc](./17-api-reference-doc.md) → `docs/API_REFERENCE.md`

### Support & Maintenance
- [ ] [18-troubleshooting-doc](./18-troubleshooting-doc.md) → `docs/TROUBLESHOOTING.md`
- [ ] [19-changelog-doc](./19-changelog-doc.md) → `docs/CHANGELOG.md`
- [ ] [20-known-issues-doc](./20-known-issues-doc.md) → `docs/KNOWN_ISSUES.md`

### Security & Compliance
- [ ] [21-security-status-doc](./21-security-status-doc.md) → `docs/SECURITY_STATUS.md`
- [ ] [22-hipaa-checklist-doc](./22-hipaa-checklist-doc.md) → `docs/HIPAA_CHECKLIST.md`

## Refresh Process

### Step 1: Gather Context
- Upload recent session summaries to Claude.ai
- Have codebase open in Claude Code
- Note any recent major changes

### Step 2: Strategy Documents (Q&A Heavy)
Start with strategy and financial - these need your input:
1. Run 14-strategy-doc prompt
2. Answer all questions
3. Generate STRATEGY.md
4. Run 23-financial-tracker-doc prompt
5. Answer all questions
6. Generate FINANCIAL_TRACKER.md

### Step 3: Technical Documents (Code Scanning)
These pull from codebase:
1. Run 16-architecture-doc in Claude Code
2. Generate ARCHITECTURE.md
3. Run 17-api-reference-doc in Claude Code
4. Generate API_REFERENCE.md

### Step 4: Operations Documents (Mixed)
1. Run 15-runbook-doc
2. Answer questions + scan code
3. Generate RUNBOOK.md

### Step 5: Support Documents (History Based)
1. Run 18-troubleshooting-doc
2. Describe recent problems solved
3. Generate TROUBLESHOOTING.md
4. Run 20-known-issues-doc
5. Scan code for TODOs + describe known bugs
6. Generate KNOWN_ISSUES.md

### Step 6: Compliance Documents (Verification)
1. Run 24-full-security-audit first (if due) — now includes prompts 26-30
2. Run 21-security-status-doc
3. Generate SECURITY_STATUS.md
4. Run 22-hipaa-checklist-doc
5. Generate HIPAA_CHECKLIST.md

**Note:** Security audit ([24-full-security-audit](./24-full-security-audit.md)) now covers **20** security prompts (01-13, 26-32):
- Provider collaboration, AI integration, file storage, data portability, admin security, logging & observability, error handling.

### Step 7: Changelog (If Maintaining)
1. Run 19-changelog-doc
2. Review git history + session summaries
3. Generate CHANGELOG.md

## Output Locations

Save generated documents to:
```
OwnMyHealth/
├── docs/
│   ├── STRATEGY.md
│   ├── RUNBOOK.md
│   ├── ARCHITECTURE.md
│   ├── API_REFERENCE.md
│   ├── TROUBLESHOOTING.md
│   ├── CHANGELOG.md
│   ├── KNOWN_ISSUES.md
│   ├── SECURITY_STATUS.md
│   ├── HIPAA_CHECKLIST.md
│   └── FINANCIAL_TRACKER.md
└── prompts/
    └── [these prompt files]
```

## Refresh Schedule

| Document | Frequency |
|----------|-----------|
| STRATEGY.md | Quarterly |
| RUNBOOK.md | When infra changes |
| ARCHITECTURE.md | When system changes |
| API_REFERENCE.md | When API changes |
| TROUBLESHOOTING.md | After solving problems |
| CHANGELOG.md | Per release |
| KNOWN_ISSUES.md | Weekly |
| SECURITY_STATUS.md | Monthly / after audits |
| HIPAA_CHECKLIST.md | Quarterly |
| FINANCIAL_TRACKER.md | Monthly |
