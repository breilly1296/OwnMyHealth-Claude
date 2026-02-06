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

### Backend (Critical/High)
| Package | Purpose | Risk Level |
|---------|---------|------------|
| express | HTTP server | High |
| @prisma/client | Database ORM | High |
| jsonwebtoken | JWT auth | Critical |
| bcryptjs | Password hashing | Critical |
| @anthropic-ai/sdk | Claude AI API | Medium |
| @sendgrid/mail | Email service | Medium |
| @google-cloud/storage | File storage | Medium |
| @google-cloud/documentai | OCR service | Medium |
| helmet | Security headers | High |
| express-rate-limit | Rate limiting | High |
| zod | Input validation | High |
| cookie-parser | Cookie handling | Medium |

### Frontend (Critical/High)
| Package | Purpose | Risk Level |
|---------|---------|------------|
| react / react-dom | UI framework | Medium |
| vite | Build tool | Medium |
| tesseract.js | Client-side OCR | Medium |
| pdfjs-dist | PDF parsing | Medium |
| jspdf | PDF generation | Low |
| recharts | Charting | Low |

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
