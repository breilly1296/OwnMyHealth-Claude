---
tags:
  - security
  - maintenance
  - medium
type: prompt
priority: 3
---

# Dependency Health Check

## Files to Review
- `package.json` (root)
- `backend/package.json` (backend)
- `package-lock.json` / `npm-shrinkwrap.json`

## Commands to Run
```bash
# Check for vulnerabilities
npm audit
cd backend && npm audit

# Check for outdated packages
npm outdated
cd backend && npm outdated

# Check for deprecated packages
npm ls 2>&1 | grep -i deprecated
```

## Checklist

### 1. Security Vulnerabilities
Run `npm audit` and categorize:
- [ ] **Critical**: Must fix immediately
- [ ] **High**: Fix before next release
- [ ] **Moderate**: Fix when convenient
- [ ] **Low**: Evaluate if needed

### 2. Outdated Dependencies
- [ ] Review packages with major version updates available
- [ ] Check changelogs for breaking changes
- [ ] Test thoroughly after major updates
- [ ] Document any intentional version pins

### 3. Deprecated Packages
- [ ] Identify any deprecated packages in use
- [ ] Find replacement packages
- [ ] Plan migration timeline

### 4. Lockfile Integrity
- [ ] `package-lock.json` committed
- [ ] Lockfile matches `package.json`
- [ ] No manual edits to lockfile
- [ ] CI uses `npm ci` (not `npm install`)

### 5. Dev vs Production Dependencies
- [ ] Production dependencies in `dependencies`
- [ ] Build/test tools in `devDependencies`
- [ ] No dev dependencies needed at runtime
- [ ] Docker image excludes dev dependencies

### 6. License Compliance
- [ ] All dependencies have compatible licenses
- [ ] No GPL dependencies in commercial project (if applicable)
- [ ] License audit: `npx license-checker --summary`

### 7. Bundle Size Impact
- [ ] Large dependencies justified
- [ ] Tree-shaking working for large libs
- [ ] No duplicate dependencies
- [ ] Consider lighter alternatives for heavy packages

## Key Dependencies to Monitor

| Package | Purpose | Risk Level |
|---------|---------|------------|
| express | HTTP server | High |
| prisma | Database ORM | High |
| jsonwebtoken | Auth | Critical |
| bcrypt | Passwords | Critical |
| @anthropic-ai/sdk | AI API | Medium |
| react | UI | Medium |

## Update Strategy

### Safe to Update (patch/minor)
```bash
npm update  # Updates within semver range
```

### Major Updates (test carefully)
```bash
npm install package@latest  # One at a time
npm test  # Run full test suite
```

### Automated Updates
Consider:
- [ ] Dependabot enabled
- [ ] Renovate bot configured
- [ ] Weekly update schedule

## Questions to Ask
1. Are there any critical/high vulnerabilities?
2. Are there major updates with breaking changes?
3. Are any deprecated packages in use?
