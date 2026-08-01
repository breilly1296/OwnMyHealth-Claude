---
tags:
  - security
  - maintenance
  - medium
type: prompt
priority: 3
updated: 2026-08-01
---

# Dependency Health Check

> **Update (2026-08-01):** three dependency waves landed after the 2026-06-16 refresh — SHA-pinned
> GitHub Actions bumped to latest stable including majors (`a5b38a5`), safe in-range backend updates
> with majors deliberately held (`2a8dafe`), and a surgical `dompurify` lockfile fix that preserved
> `@emnapi` (`762ce62`). Re-run `npm audit` rather than reasoning from any advisory list in this
> prompt, and check whether the majors held in `2a8dafe` are still deliberately held or have quietly
> become stale. Also note `secret-history-scan.yml` now downloads a gitleaks release tarball over
> `curl` with a pinned version but **no checksum verification** — a supply-chain surface this prompt
> should cover alongside npm deps.

## Files to Review
- `package.json` (frontend/root)
- `backend/package.json` (backend)
- `package-lock.json` (root) and `backend/package-lock.json` (two separate lockfiles — frontend and backend are NOT an npm workspace; audit each tree independently)
- `.github/workflows/ci.yml` (the `security` job already runs `npm audit --audit-level=high` for both trees, gitleaks secret scan, and the RLS wrapper guard; note the High/Critical gate has recently required reactive, lockfile-only `npm audit fix` to clear NEW High advisories — see Automated Updates below, `ci.yml:129-143`)

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
| @prisma/client / prisma | Database ORM (now Prisma **7** — `@prisma/client ^7.7.0`, `backend/package.json:27`) | High |
| @prisma/adapter-pg | Prisma driver adapter over `pg` (`^7.8.0`, `backend/package.json:26`) | High |
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
| ~~pdf-lib~~ | **UNUSED — flag for removal.** Was PDF redaction; its only consumer `pdfRedaction.ts` was DELETED post-2026-06-01. Still declared (`backend/package.json:41`, `^1.17.1`) but has ZERO import sites repo-wide. | Low |
| compression | Response compression | Low |
| uuid | ID generation | Low |

> **`pdf-parse` is intentionally pinned to the EXACT version `1.1.1` (no `^`).** Do NOT let `npm update`/Dependabot bump it to the 2.x line — `pdf-parse@2` is a different, problematic package. If Dependabot opens a PR for it, close it.

> **Node-version baseline:** the backend stack moved to the Prisma 7 / Node-22 generation. `backend/package.json:76-77` engines is `node ^20.19 || ^22.12 || >=24`, and CI is standardized on **Node 22** (`ci.yml:20`, after Node 20 EOL in Apr 2026). Keep Dependabot/major bumps within this engine range and verify on Node 22.

### Frontend (Critical/High)
| Package | Purpose | Risk Level |
|---------|---------|------------|
| react / react-dom | UI framework | Medium |
| vite | Build tool (devDependency, v8.x — bumped 7→8 post-2026-06-01, PR #140; `package.json:58` `^8.0.16`) | Medium |
| tesseract.js | Client-side OCR | Medium |
| pdfjs-dist | PDF parsing | Medium |
| jspdf / jspdf-autotable | PDF generation (data export) — now major `jspdf ^4.2.1` (`package.json:24`), past the 2026-06-01 baseline | Low |
| html2canvas-pro | Canvas/screenshot capture for PDF export | Low |
| recharts | Charting — now major `recharts ^3.5.0` (`package.json:30`), past the 2026-06-01 baseline | Low |
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
- [ ] CI `security` job gates merges on `npm audit --audit-level=high` (both trees, `ci.yml:129-143`)
- [ ] Be aware this gate has recently required a reactive, **lockfile-only** backend `npm audit fix` (no major bumps) to clear NEW High advisories (form-data CRLF, vite) that were tripping the Security Audit gate. When the gate fails on a fresh transitive High, prefer the non-breaking `npm audit fix` over `--force`.
- [ ] ~8 backend **moderate** advisories are KNOWINGLY DEFERRED (their only "fixes" are breaking downgrades): `uuid`/`teeny-request`/`retry-request` transitively via `@google-cloud/storage`, and `@hono/node-server` via Prisma 7's `@prisma/dev` dev tooling. Do NOT run `npm audit fix --force` (pulls breaking majors — `uuid@14`, `prisma@6.x`). Track these for upstream patches via Dependabot. (`ci.yml:129-143` documents the rationale inline.)

## Questions to Ask
1. Are there any critical/high vulnerabilities?
2. Are there major updates with breaking changes?
3. Are any deprecated packages in use?
