# Dependency Health Audit Report

**Project:** OwnMyHealth
**Date:** 2026-02-06
**Auditor:** Automated Security Audit (Claude)
**Scope:** Root (frontend) `package.json` and `backend/package.json`, lock files, CI/CD configuration, Dockerfile

---

## Executive Summary

The OwnMyHealth project has **11 known vulnerabilities** across its two package trees (1 high in frontend, 10 in backend comprising 5 high and 5 moderate). Several critical-path dependencies have major version updates available that include security fixes. The lock files are committed to source control, which is good, but the CI pipeline uses `npm install` instead of `npm ci` in non-deploy workflows, weakening reproducibility guarantees. No automated dependency update tooling (Dependabot, Renovate) is configured. Two packages (`magicast`, `express-validator`) appear to be unused dead dependencies. The backend `.gitignore` has a corrupted entry for a GCP credentials file.

---

## 1. Security Vulnerabilities

### Frontend (`npm audit` output)

| Severity | Package | Advisory | Status |
|----------|---------|----------|--------|
| **High** | `jspdf` <=4.0.0 | [GHSA-pqxr-3g65-p328](https://github.com/advisories/GHSA-pqxr-3g65-p328) - PDF Injection allowing arbitrary JS execution | VULNERABLE |
| **High** | `jspdf` <=4.0.0 | [GHSA-95fx-jjr5-f39c](https://github.com/advisories/GHSA-95fx-jjr5-f39c) - DoS via unvalidated BMP dimensions | VULNERABLE |
| **High** | `jspdf` <=4.0.0 | [GHSA-vm32-vv63-w422](https://github.com/advisories/GHSA-vm32-vv63-w422) - Stored XMP metadata injection (spoofing) | VULNERABLE |
| **High** | `jspdf` <=4.0.0 | [GHSA-cjw8-79x6-5cj4](https://github.com/advisories/GHSA-cjw8-79x6-5cj4) - Shared state race condition in addJS plugin | VULNERABLE |

**Resolution:** Run `npm audit fix` or update `jspdf` to >4.0.0. The project currently pins `^4.0.0` which resolves to exactly `4.0.0`; updating to `^4.0.1` or `^4.1.0` should resolve all four advisories.

### Backend (`npm audit` output)

| Severity | Package | Advisory | Root Cause |
|----------|---------|----------|------------|
| **High** | `fast-xml-parser` 4.3.6-5.3.3 | [GHSA-37qj-frw5-hhjh](https://github.com/advisories/GHSA-37qj-frw5-hhjh) - RangeError DoS via numeric entities | Transitive via `@google-cloud/storage` 7.12.1-7.18.0 |
| **High** | `hono` <=4.11.6 (5 advisories) | JWT algorithm confusion, XSS, cache deception, IP spoofing, arbitrary key read | Transitive via `prisma` -> `@prisma/dev` |
| **Moderate** | `lodash` 4.0.0-4.17.21 | [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) - Prototype Pollution in `_.unset`/`_.omit` | Transitive via `prisma` -> `@prisma/dev` -> `@mrleebo/prisma-ast` -> `chevrotain` |

**Resolution:**
- `fast-xml-parser`: Upgrade `@google-cloud/storage` beyond 7.18.0 or wait for a patched release that pins `fast-xml-parser` >= 5.3.4.
- `hono` / `lodash`: These are transitive dependencies of `prisma` CLI tooling (`@prisma/dev`). The Prisma team has open issues tracking these ([#28660](https://github.com/prisma/prisma/issues/28660), [#29073](https://github.com/prisma/prisma/issues/29073)). These are **dev/CLI-only** dependencies and do not ship in the runtime application, reducing actual risk. Monitor Prisma releases for fixes.

### Checklist

- [ ] **FAIL** **Critical**: No critical-severity advisories found.
- [ ] **FAIL** **High**: 4 high-severity advisories in frontend (`jspdf`), 5 high in backend (`fast-xml-parser`, `hono`). **Must fix `jspdf` immediately** (client-side PDF injection). `hono` vulnerabilities are in Prisma CLI tooling only (lower real-world risk).
- [x] **PASS** **Moderate**: 5 moderate advisories in backend (all `lodash` via Prisma tooling chain). Dev-time only.
- [x] **PASS** **Low**: No low-severity advisories found.

---

## 2. Outdated Dependencies

### Major Version Updates Available

| Package | Current | Latest | Location | Breaking Changes? |
|---------|---------|--------|----------|-------------------|
| `express` | ^4.18.2 | 5.2.1 | backend | **YES** - Route syntax changes, removed methods, MIME type changes, dotfiles default changed. See [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5.html). |
| `bcryptjs` | ^2.4.3 | 3.0.3 | backend | **YES** - ESM module export by default instead of CommonJS. |
| `zod` | ^3.22.4 | 4.3.6 | backend | **YES** - Zod 4 is a major rewrite. See [Zod v4 release notes](https://zod.dev/v4). |
| `helmet` | ^7.1.0 | 8.1.0 | backend | Likely minor breaking changes. |
| `express-rate-limit` | ^7.1.5 | 8.2.1 | backend | Likely API changes. |
| `jsonwebtoken` | ^9.0.2 | 9.0.3 | backend | Patch update only (safe). |
| `@sendgrid/mail` | ^8.1.4 | 8.1.6 | backend | Patch update only (safe). |
| `@prisma/client` | ^7.0.1 | 7.3.0 | backend | Minor update (safe within semver range). |

### Checklist

- [~] **PARTIAL** Review packages with major version updates available
  - **Finding:** `express` (4 -> 5), `bcryptjs` (2 -> 3), `zod` (3 -> 4), `helmet` (7 -> 8), and `express-rate-limit` (7 -> 8) all have major version updates available. These require careful migration planning.
- [ ] **FAIL** Check changelogs for breaking changes
  - **Finding:** No evidence of changelog review or migration planning documentation exists in the repository.
- [ ] **FAIL** Test thoroughly after major updates
  - **Finding:** No migration plan or test strategy documented for the pending major updates.
- [ ] **FAIL** Document any intentional version pins
  - **Finding:** No documentation exists explaining why specific versions are pinned. The `rollup` override (`npm:@rollup/wasm-node@^4.53.3`) is present in both `package.json` files but not documented beyond the MEMORY.md context (Windows ARM64 compatibility).

---

## 3. Deprecated Packages

### Identified Issues

| Package | Status | Concern | Alternative |
|---------|--------|---------|-------------|
| `html2canvas` ^1.4.1 | **Unmaintained** | No new releases in 12+ months; considered discontinued | `html2canvas-pro` (actively maintained fork) |
| `pdf-parse` ^1.1.1 | **Low maintenance** | Minimally maintained; last meaningful update was years ago | `unpdf` (modern TypeScript alternative) or `pdfjs-dist` (already in frontend deps) |
| `magicast` ^0.3.5 | **Unused** | No imports found anywhere in `backend/src/`. Dead dependency. | Remove entirely. |
| `express-validator` ^7.0.1 | **Unused** | No imports found in `backend/src/`. Project uses `zod` for validation. | Remove entirely. |

### Checklist

- [x] **PASS** Identify any deprecated packages in use
  - **Finding:** `html2canvas` is effectively unmaintained. `pdf-parse` has low maintenance. Two packages (`magicast`, `express-validator`) are installed but never imported -- they are dead dependencies.
- [~] **PARTIAL** Find replacement packages
  - **Finding:** Alternatives identified above but no migration has been planned.
- [ ] **FAIL** Plan migration timeline
  - **Finding:** No migration timeline exists.

---

## 4. Lockfile Integrity

### Checklist

- [x] **PASS** `package-lock.json` committed
  - **Finding:** Both `package-lock.json` (root) and `backend/package-lock.json` are tracked in git (confirmed via `git ls-files`). Neither `.gitignore` excludes lock files.
- [x] **PASS** Lockfile matches `package.json`
  - **Finding:** `npm audit` ran successfully in both directories without lockfile mismatch warnings, indicating the lock files are in sync with their respective `package.json` files.
- [x] **PASS** No manual edits to lockfile
  - **Finding:** No evidence of manual lockfile edits detected. The lockfiles are machine-generated.
- [~] **PARTIAL** CI uses `npm ci` (not `npm install`)
  - **Finding:** The **deploy** workflow (`deploy.yml:112`) correctly uses `npm ci` for the frontend production build. However, the **CI** workflow (`ci.yml:29`, `ci.yml:68`) uses `npm install` for both frontend and backend, which can modify the lockfile and produce non-reproducible builds.
  - **Files:**
    - `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\.github\workflows\deploy.yml` line 112: `run: npm ci` (correct)
    - `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\.github\workflows\ci.yml` line 29: `run: npm install` (should be `npm ci`)
    - `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\.github\workflows\ci.yml` line 68: `run: npm install` (should be `npm ci`)

---

## 5. Dev vs Production Dependencies

### Frontend (`package.json` root)

| Issue | Package | Current Location | Recommended |
|-------|---------|-----------------|-------------|
| **Misplaced** | `serve` ^14.2.5 | `dependencies` | This is the production static file server invoked via `npm run start`. It is correctly in `dependencies` since it is needed at runtime in production. **No change needed** -- though note the frontend is deployed to GCS (static hosting), so `serve` is only used for local/non-GCS deployments. |

### Backend (`backend/package.json`)

| Issue | Package | Current Location | Recommended |
|-------|---------|-----------------|-------------|
| **Misplaced** | `prisma` ^7.0.1 | `dependencies` | Should be in `devDependencies`. The Prisma CLI is used for migrations and code generation, not at runtime. The runtime client is `@prisma/client`. However, the Dockerfile runs `npx prisma migrate deploy` at container start (`CMD`), which requires `prisma` at runtime. This is an **intentional pin** for the deployment strategy, but it inflates the production image and pulls in vulnerable transitive deps (`hono`, `lodash`). |
| **Dead dep** | `magicast` ^0.3.5 | `dependencies` | Remove. No imports found in any source file under `backend/src/`. |
| **Dead dep** | `express-validator` ^7.0.1 | `dependencies` | Remove. No imports found; project uses `zod` for validation. |

### Checklist

- [~] **PARTIAL** Production dependencies in `dependencies`
  - **Finding:** Most production deps are correctly placed. `magicast` and `express-validator` are dead dependencies that should be removed. `prisma` is in `dependencies` due to the Docker CMD migration strategy.
- [~] **PARTIAL** Build/test tools in `devDependencies`
  - **Finding:** Build/test tools (`vitest`, `typescript`, `eslint`, etc.) are correctly in `devDependencies` for both projects. `prisma` CLI is in production deps (see above).
- [~] **PARTIAL** No dev dependencies needed at runtime
  - **Finding:** The `@rollup/wasm-node` override applies globally (including production), but this is a build-time concern for Vite, not a runtime concern.
- [x] **PASS** Docker image excludes dev dependencies
  - **Finding:** The Dockerfile (`backend/Dockerfile:31`) correctly uses `npm ci --omit=dev` in the production stage, excluding devDependencies from the final image. The multi-stage build separates builder from production. Non-root user (`nodejs:1001`) is also configured.

---

## 6. License Compliance

> Note: `npx license-checker --summary` was not run due to environment constraints. Analysis is based on known licenses of declared dependencies.

### Backend Critical Dependencies

| Package | License | Compatible? |
|---------|---------|-------------|
| `express` | MIT | Yes |
| `@prisma/client` | Apache-2.0 | Yes |
| `jsonwebtoken` | MIT | Yes |
| `bcryptjs` | MIT | Yes |
| `@anthropic-ai/sdk` | MIT | Yes |
| `@sendgrid/mail` | MIT | Yes |
| `@google-cloud/storage` | Apache-2.0 | Yes |
| `@google-cloud/documentai` | Apache-2.0 | Yes |
| `helmet` | MIT | Yes |
| `express-rate-limit` | MIT | Yes |
| `zod` | MIT | Yes |
| `cookie-parser` | MIT | Yes |
| `pdf-parse` | MIT | Yes |

### Frontend Critical Dependencies

| Package | License | Compatible? |
|---------|---------|-------------|
| `react` / `react-dom` | MIT | Yes |
| `vite` | MIT | Yes |
| `tesseract.js` | Apache-2.0 | Yes |
| `pdfjs-dist` | Apache-2.0 | Yes |
| `jspdf` | MIT | Yes |
| `recharts` | MIT | Yes |

### Checklist

- [x] **PASS** All dependencies have compatible licenses
  - **Finding:** All identified dependencies use MIT or Apache-2.0 licenses, which are permissive and commercially compatible.
- [x] **PASS** No GPL dependencies in commercial project
  - **Finding:** No GPL-licensed direct dependencies identified.
- [ ] **FAIL** License audit: `npx license-checker --summary`
  - **Finding:** Full transitive license audit was not executed. Recommend running `npx license-checker --summary` and `npx license-checker --failOn 'GPL-2.0;GPL-3.0'` in CI.

---

## 7. Bundle Size Impact

### Frontend Large Dependencies

| Package | Approximate Size | Justified? |
|---------|-----------------|------------|
| `tesseract.js` | ~7MB (with worker/lang data) | Yes -- core OCR functionality. WASM-based, loads on demand. |
| `pdfjs-dist` | ~2.5MB | Yes -- PDF text extraction for lab reports. |
| `recharts` | ~500KB | Yes -- charting library for biomarker trends. Could consider lighter alternatives (`chart.js`, `uplot`). |
| `jspdf` + `jspdf-autotable` | ~400KB | Yes -- PDF report generation. |
| `html2canvas` | ~200KB | Marginal -- only used in `src/utils/pdfReportGenerator.ts`. Could potentially be eliminated. |
| `lucide-react` | Tree-shakeable | Fine -- icon library that tree-shakes well with Vite. |

### Checklist

- [x] **PASS** Large dependencies justified
  - **Finding:** `tesseract.js` and `pdfjs-dist` are large but essential for core OCR/PDF functionality. `recharts` is the heaviest charting option but provides the needed features.
- [x] **PASS** Tree-shaking working for large libs
  - **Finding:** Vite's Rollup-based bundler supports tree-shaking. `lucide-react` and other modular imports should tree-shake correctly.
- [~] **PARTIAL** No duplicate dependencies
  - **Finding:** Both `pdfjs-dist` (frontend) and `pdf-parse` (backend) handle PDF parsing separately. This is architecturally intentional (client vs. server) but worth noting.
- [~] **PARTIAL** Consider lighter alternatives for heavy packages
  - **Finding:** `html2canvas` (~200KB, unmaintained) is used in a single utility file. Consider replacing with `html2canvas-pro` or a different screenshot approach. `recharts` could be replaced with smaller charting libraries if bundle size becomes a concern.

---

## 8. Additional Findings

### 8.1 Corrupted `.gitignore` Entry (SECURITY CONCERN)

**File:** `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\.gitignore` lines 35-37

The entry for `gcp-ocr-key.json` appears corrupted with garbled/duplicated text:
```
gcp-ocr-key.jsong c p - o c r - k e y . j s o n
 g c p - o c r - k e y . j s o n . j s o n
```

This likely means the `.gitignore` pattern does not match correctly. While the file does not currently exist on disk and is not tracked in git, if someone creates `gcp-ocr-key.json` in the future, the corrupted pattern may fail to exclude it. **This should be fixed immediately** to read simply:
```
gcp-ocr-key.json
```

### 8.2 `prisma` in Production Dependencies

**File:** `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\package.json` line 36

The `prisma` CLI package (^7.0.1) is in `dependencies` rather than `devDependencies`. This is because the Dockerfile CMD runs `npx prisma migrate deploy` at container startup. This approach:
- Inflates the production Docker image
- Pulls in vulnerable transitive dependencies (`hono`, `lodash` via `@prisma/dev`)
- Is a common pattern but not ideal

**Recommendation:** Run `prisma migrate deploy` in the Docker build stage or as a separate CI/CD step, then move `prisma` to `devDependencies`.

### 8.3 CI Security Audit Uses `continue-on-error: true`

**File:** `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\.github\workflows\ci.yml` lines 106-112

The security audit job uses `continue-on-error: true` for both frontend and backend npm audit steps. This means **high-severity vulnerabilities will never block a deployment**. The audit is informational only.

**Recommendation:** Remove `continue-on-error: true` or at minimum change `--audit-level=high` to `--audit-level=critical` and make it blocking.

### 8.4 No Dependabot or Renovate Configuration

No `.github/dependabot.yml` or `renovate.json` was found in the project. Automated dependency updates are not configured.

### 8.5 Docker Base Image Pinning

**File:** `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\Dockerfile` lines 4, 24

The Dockerfile uses `node:20-alpine` without a specific version pin (e.g., `node:20.11.0-alpine3.19`). While `apk update && apk upgrade` is run (line 28), the base image tag is floating, which could introduce inconsistencies between builds.

### 8.6 Dummy DATABASE_URL Left in ENV

**File:** `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\Dockerfile` lines 18, 37

The `ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"` set during build is **not cleared** before the production stage inherits it. While it would be overridden by Cloud Run environment variables at runtime, it's better practice to unset it or use `ARG` instead.

---

## Summary Scoreboard

| Category | Status | Grade |
|----------|--------|-------|
| 1. Security Vulnerabilities | 11 vulnerabilities (4 high in frontend, 5 high + 5 moderate in backend) | FAIL |
| 2. Outdated Dependencies | 5 major version updates available (express, bcryptjs, zod, helmet, express-rate-limit) | FAIL |
| 3. Deprecated Packages | 2 unmaintained packages, 2 dead dependencies | PARTIAL |
| 4. Lockfile Integrity | Lock files committed; CI uses `npm install` instead of `npm ci` | PARTIAL |
| 5. Dev vs Production | Dead deps in prod, prisma CLI in prod deps | PARTIAL |
| 6. License Compliance | All permissive licenses; no full transitive audit run | PASS |
| 7. Bundle Size Impact | Large deps justified; minor optimization opportunities | PASS |

---

## Priority Action Items

### Immediate (Before Next Release)
1. **Update `jspdf`** to >4.0.0 to resolve 4 high-severity advisories (frontend `package.json:19`)
2. **Fix corrupted `.gitignore`** entry in `backend/.gitignore:35-37` for `gcp-ocr-key.json`
3. **Remove dead dependencies** `magicast` and `express-validator` from `backend/package.json:33,31`

### Short-Term (Next Sprint)
4. **Change CI workflow** to use `npm ci` instead of `npm install` (`ci.yml:29,68`)
5. **Monitor `@google-cloud/storage`** for a release that pins `fast-xml-parser` >= 5.3.4
6. **Configure Dependabot** or Renovate for automated dependency updates
7. **Make security audit blocking** in CI (remove `continue-on-error: true` from `ci.yml:107,112`)

### Medium-Term (Next Quarter)
8. **Plan Express 4 -> 5 migration** (significant breaking changes, see migration guide)
9. **Plan bcryptjs 2 -> 3 migration** (ESM module change)
10. **Plan Zod 3 -> 4 migration** (major rewrite)
11. **Move `prisma` to devDependencies** and restructure Docker CMD to run migrations in build/CI
12. **Replace `html2canvas`** with actively maintained `html2canvas-pro`
13. **Pin Docker base image** to specific version tag
14. **Run full license audit** with `npx license-checker` in CI

---

## Files Referenced

| File | Key Findings |
|------|-------------|
| `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\package.json` | Frontend deps, jspdf vulnerability, html2canvas unmaintained |
| `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\package.json` | Backend deps, dead deps (magicast, express-validator), prisma in prod |
| `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\.gitignore` | Corrupted gcp-ocr-key.json entry (lines 35-37) |
| `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\.github\workflows\ci.yml` | Uses `npm install` (lines 29, 68), non-blocking audit (lines 106-112) |
| `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\.github\workflows\deploy.yml` | Correctly uses `npm ci` (line 112) |
| `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\Dockerfile` | `--omit=dev` correct, dummy DATABASE_URL not cleared, unpinned base image |
| `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\src\utils\pdfReportGenerator.ts` | Only usage of html2canvas |
