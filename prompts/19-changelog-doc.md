---
tags:
  - documentation
  - changelog
type: prompt
priority: 3
---

# Generate CHANGELOG.md

## Purpose
Generate a changelog from recent development work.

## From Codebase (Claude Code)
```bash
# Recent commits
git log --oneline --since="2 weeks ago"

# Files changed
git diff HEAD~20 --stat

# Recent tags
git tag --sort=-creatordate | head -5
```

## From Session Summaries (Claude.ai)
Review uploaded session summaries and extract:
- Features added
- Bugs fixed
- Infrastructure changes
- Security improvements

## Questions to Ask
1. What date range should the changelog cover?
2. Are there any major features to highlight?
3. Are there any breaking changes?
4. What's the version number (if using semver)?

## Output Format

```markdown
# OwnMyHealth Changelog

All notable changes to this project.

---

## [Date] - Version X.Y.Z (if applicable)

### Added
- **Feature Name** - Brief description of new functionality
- Another new feature

### Fixed
- **Bug Name** - What was broken and how it was fixed
- Another bug fix

### Changed
- **What Changed** - Description of modification
- Another change

### Security
- **Security Fix** - What vulnerability was addressed

### Infrastructure
- **DevOps Change** - CI/CD, deployment, or infrastructure changes

### Deprecated
- Features marked for removal

### Removed
- Features that were removed

---

## [Earlier Date]

### Added
...

---

## Statistics

| Metric | Value |
|--------|-------|
| Total Deploys | X |
| Tests Passing | X/X |
| Security Findings Fixed | X |

---

*Changelog format based on [Keep a Changelog](https://keepachangelog.com/)*
```

## Guidelines
- Write for users, not developers
- Be concise (1 line per item)
- Group related changes
- Most recent at top
- Include dates
