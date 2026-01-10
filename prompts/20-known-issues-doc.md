---
tags:
  - documentation
  - bugs
type: prompt
priority: 2
---

# Generate KNOWN_ISSUES.md

## Purpose
Generate a current list of known issues and technical debt.

## From Codebase (Claude Code)
```bash
# Find TODOs and FIXMEs
grep -r "TODO\|FIXME\|HACK\|XXX" backend/src/ src/ --include="*.ts" --include="*.tsx"

# Find "should be" comments
grep -r "should be\|needs to\|needs fix" backend/src/ src/ --include="*.ts"

# Check for console.log in production code
grep -r "console\.log" backend/src/ --include="*.ts" | grep -v "test\|spec"

# Run tests
cd backend && npm test
npm test

# Check for vulnerabilities
npm audit
```

## Questions to Ask

### Known Bugs
1. What bugs do you know about that aren't fixed yet?
2. For each bug:
   - What's the symptom?
   - What's the workaround (if any)?
   - What's the priority?
   - What files are involved?

### Partially Implemented Features
1. What features are incomplete?
2. What's missing from each?

### Technical Debt
1. What code needs refactoring?
2. What tests are missing?
3. What documentation is outdated?

## Output Format

```markdown
# OwnMyHealth Known Issues

**Last Updated:** [Date]

---

## Critical (Blocks Core Functionality)

*None currently* OR

### Issue Name
**Symptom:** What the user sees
**Root Cause:** Why it happens
**Workaround:** Temporary fix (if any)
**Fix Required:** What code changes needed
**Files:** List of files involved

---

## High Priority (Fix Before Beta)

### Issue Name
**Symptom:** ...
**Priority:** High
**Workaround:** ...
**Fix Required:** ...

---

## Medium Priority (Fix During Beta)

### Issue Name
...

---

## Low Priority (Future Improvements)

### Issue Name
...

---

## Technical Debt

### Code Quality
- [ ] Item needing refactoring

### Missing Tests
- [ ] Area lacking test coverage

### Documentation
- [ ] Outdated documentation

---

## Fixed Issues (Reference)

| Issue | Fixed Date | Solution |
|-------|------------|----------|
| Issue name | Date | Brief solution |

---

## Priority Definitions

| Priority | Definition | Timeline |
|----------|------------|----------|
| Critical | Blocks core functionality | Fix immediately |
| High | Significant feature broken | Fix before beta |
| Medium | Usability issue | Fix during beta |
| Low | Minor annoyance | Backlog |
```
