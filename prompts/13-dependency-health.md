---
tags:
  - security
  - maintenance
  - medium
type: prompt
priority: 3
updated: 2026-06-01
---

# Dependency Health Check

## Files to Review
- `package.json` (frontend/root)
- `backend/package.json` (backend)
- `package-lock.json` (root) and `backend/package-lock.json` (two separate lockfiles — frontend and backend are NOT an npm workspace; audit each tree independently)
- `.github/workflows/ci.yml` (the `security` job already runs `npm audit --audit-level=high` for both trees, gitleaks secret scan, and the RLS wrapper guard)

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
- [ ] Both `package-lock.json` (root) and `backend/package-lock.json` committed
- [ ] Lockfiles match their respective `package.json`
- [ ] No manual edits to lockfiles
- [ ] CI uses `npm ci` (confirmed: `ci.yml` `frontend`, `backend`, and `rls` jobs all run `npm ci`)
- [ ] `overrides` block (`rollup` pinned to `npm:@rollup/wasm-node`) intact in both `package.json` files — required for the Windows ARM64 / OneDrive native-binary workaround; do not let an update silently drop it

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
| @prisma/client / prisma | Database ORM | High |
| @prisma/adapter-pg | Prisma driver adapter over `pg` | High |
| pg | PostgreSQL driver | High |
| jsonwebtoken | JWT auth | Critical |
| bcryptjs | Password hashing | Critical |
| @anthropic-ai/sdk | Claude AI API | Medium |
| @sendgrid/mail | Email service | Medium |
| @google-cloud/storage | File storage | Medium |
| @google-cloud/documentai | OCR service | Medium |
| helmet | Security headers | High |
| express-rate-limit | Rate limiting | High |
| ioredis | Redis client (backs `rateLimitStore`, falls back to in-memory) | High |
| rate-limit-redis | Redis store for express-rate-limit | High |
| zod | Input validation | High |
| cookie-parser | Cookie handling | Medium |
| multer | Multipart file upload parsing | High |
| pdf-parse | Lab-report PDF text extraction | High |
| pdf-lib | PDF redaction / generation | Medium |
| compression | Response compression | Low |
| uuid | ID generation | Low |

> **`pdf-parse` is intentionally pinned to the EXACT version `1.1.1` (no `^`).** Do NOT let `npm update`/Dependabot bump it to the 2.x line — `pdf-parse@2` is a different, problematic package. If Dependabot opens a PR for it, close it.

### Frontend (Critical/High)
| Package | Purpose | Risk Level |
|---------|---------|------------|
| react / react-dom | UI framework | Medium |
| vite | Build tool (devDependency, v7.x) | Medium |
| tesseract.js | Client-side OCR | Medium |
| pdfjs-dist | PDF parsing | Medium |
| jspdf / jspdf-autotable | PDF generation (data export) | Low |
| html2canvas-pro | Canvas/screenshot capture for PDF export | Low |
| recharts | Charting | Low |
| lucide-react | Icon set | Low |
| serve | Static file server for `npm start` (Cloud Run) | Low |

> The frontend pins `rollup` to `npm:@rollup/wasm-node` via `overrides` (plus optional native `@rollup/rollup-win32-*-msvc`). This is the deliberate Windows ARM64 / OneDrive WASM-fallback workaround — keep it when updating Vite.

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
Current state: Dependabot IS enabled (`.github/dependabot.yml`); Renovate is not used.
- [ ] Review open Dependabot PRs; merge safe patch/minor bumps
- [ ] Reject/close any Dependabot PR that bumps `pdf-parse` off the `1.1.1` pin (the 2.x trap)
- [ ] Confirm the `rollup` → `@rollup/wasm-node` overrides survive Dependabot bumps
- [ ] CI `security` job gates merges on `npm audit --audit-level=high` (both trees)

## Questions to Ask
1. Are there any critical/high vulnerabilities?
2. Are there major updates with breaking changes?
3. Are any deprecated packages in use?
