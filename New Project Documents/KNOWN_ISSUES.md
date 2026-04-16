# OwnMyHealth Known Issues

**Last scanned:** 2026-04-16

## Critical (Blocks Core Functionality)

None found. Grep across `backend/src/` and `src/` turned up no TODO/FIXME/HACK/XXX markers tagged as critical, no skipped tests, no `@ts-ignore` directives, and no production `console.log` debug statements that gate functionality.

---

## High Priority (Fix Before Beta)

### Display name edit is a no-op (stub)
**Symptom:** User edits their display name on the Account Settings page; UI shows a saving spinner but nothing is persisted.
**Source:** `src/components/settings/AccountSettingsPage.tsx:83` — `// TODO: Implement API call to save display name` followed by a 500 ms `setTimeout` placeholder.
**Priority:** High (user-facing feature appears to work but silently discards input)
**Fix required:** Add a `PATCH /api/user/profile` (or similar) endpoint and wire `settingsApi.updateDisplayName(name)` into `handleSaveName`.

### Critical npm audit advisory in frontend: jsPDF HTML injection
**Symptom:** `npm audit` reports one critical vulnerability — `jsPDF has HTML Injection in New Window paths` (GHSA-wfv2-pwc8-crg5). `jspdf` is a direct dependency used for report export.
**Source:** `package.json:19` (direct dep); `npm audit` root.
**Priority:** High (PHI-touching report generation path)
**Fix required:** `npm audit fix` or pin `jspdf` to a patched version; re-run audit.

### Critical npm audit advisory in backend: fast-xml-parser
**Symptom:** `npm audit` reports one critical vulnerability — `fast-xml-parser has an entity encoding bypass via regex injection in DOCTYPE entity names` (GHSA-m7jm-9gc2-mpf2). Pulled in transitively via `@google-cloud/storage` / `@google-cloud/documentai`.
**Source:** `backend/npm audit` output.
**Priority:** High
**Fix required:** `npm audit fix` in `backend/`; if blocked by peer deps, bump `@google-cloud/*` packages.

### Vite dev-server path traversal and file-read advisories
**Symptom:** Three high-severity vite advisories (GHSA-4w7w-66w2-5vf9 path traversal, GHSA-v2wj-q39q-566r server.fs.deny bypass, GHSA-p9ff-h696-f583 WebSocket arbitrary file read). Applies to `vite ^7.3.0` (root dev dep).
**Source:** `package.json:49`; `npm audit` root.
**Priority:** High (only impacts local dev, but any contributor running `npm run dev` is exposed)
**Fix required:** Bump `vite` past 7.3.1 when a patched release is available; do not expose the dev server beyond localhost.

### Axios SSRF / metadata-exfiltration advisories (backend)
**Symptom:** `npm audit` flags axios for "NO_PROXY Hostname Normalization Bypass that Leads to SSRF" and "Unrestricted Cloud Metadata Exfiltration via Header Injection Chain". Axios is a transitive dep of `@anthropic-ai/sdk` / Google Cloud SDKs.
**Source:** `backend/npm audit` output.
**Priority:** High (SSRF risk against GCP metadata endpoint from a backend running on Cloud Run)
**Fix required:** `npm audit fix` in `backend/`; verify the transitive axios version resolves to a patched release.

---

## Medium Priority (Fix During Beta)

### Notification preferences stored in localStorage
**Symptom:** Email / weekly-summary / abnormal-alert toggles are saved to `localStorage.setItem('omh-notifications', ...)`. CLAUDE.md rule: "NEVER use localStorage/sessionStorage for sensitive data". Notification preferences are not PHI, but they are user settings that should follow the user across devices.
**Source:** `src/components/settings/AccountSettingsPage.tsx:58,94` (comment on line 56 acknowledges "stored in localStorage for now").
**Priority:** Medium
**Fix required:** Add a `user_preferences` table/column and `GET/PATCH /api/user/preferences`.

### Backend picomatch / path-to-regexp / qs DoS advisories
**Symptom:** High-severity ReDoS / DoS advisories in `picomatch`, `path-to-regexp`, and `qs` (the Express 4 query parser). All reachable from request-handling paths.
**Source:** `backend/npm audit` output.
**Priority:** Medium (ReDoS requires crafted input; rate limiting partially mitigates)
**Fix required:** `npm audit fix` in `backend/`; consider upgrading to Express 5 to drop the old `qs` version.

### Backend dompurify moderate advisories (5 open)
**Symptom:** Five moderate dompurify advisories: mutation-XSS, general XSS, ADD_ATTR URI-validation skip, USE_PROFILES prototype pollution, ADD_TAGS FORBID_TAGS bypass. Pulled in transitively.
**Source:** `npm audit` root.
**Priority:** Medium
**Fix required:** `npm audit fix`; if transitive, audit the consuming package (likely `jspdf-autotable`).

### Frontend debug `console.log` statements shipped to production
**Symptom:** `AuthContext.tsx` calls `console.log('[AuthContext] Access token refreshed...')`, `'Refresh token invalid...'`, and `'Session restored successfully'` on every mount. Not PHI, but leaks auth-flow detail into the browser console.
**Source:** `src/contexts/AuthContext.tsx:90, 93, 102`; also `src/services/api/client.ts:103, 166` for CSRF warnings.
**Priority:** Medium
**Fix required:** Route through `src/utils/logger.ts` (which already gates on `isProduction`) instead of raw `console.log`.

---

## Low Priority (Future Improvements)

### Backend low-severity advisories (6)
**Symptom:** Six low-severity advisories in `backend/` (`@tootallnate/once`, `follow-redirects`, `lodash`, misc). Not directly exploitable in our usage but increase supply-chain surface.
**Source:** `backend/npm audit` — `6 low`.
**Priority:** Low
**Fix required:** Batch-resolve during next dependency sweep.

### `nul` files in repo root and `backend/`
**Symptom:** Stray zero-byte `nul` files at `OwnMyHealth/nul` and `OwnMyHealth/backend/nul` — likely from accidental Windows `> nul` redirects.
**Source:** Root and backend directory listings.
**Priority:** Low
**Fix required:** Delete and add to `.gitignore`.

---

## Technical Debt

### Code quality

- [ ] `backend/src/controllers/uploadController.ts` — 1501 lines. By far the largest file in the repo; handles both PDF lab uploads and SBC insurance uploads. Split into `labUploadController.ts` and `sbcUploadController.ts`.
- [ ] `backend/src/services/authService.ts` — 1028 lines. Register/login/refresh/reset/verify/demo/session-cleanup all in one module. Split along verbs.
- [ ] `backend/src/services/sbcExtraction.ts` — 1015 lines. Single Claude-prompted extractor; candidate for per-section helpers.
- [ ] `backend/src/controllers/biomarkerController.ts` — 900 lines.
- [ ] `backend/src/controllers/insuranceController.ts` — 882 lines.
- [ ] `backend/src/controllers/authController.ts` — 774 lines.
- [ ] `backend/src/middleware/validation.ts` — 679 lines of Zod schemas; extract per-resource schema files.
- [ ] Several frontend components exceed 700 lines: `BiomarkerActionPlan.tsx` (764), `InsurancePlanDetail.tsx` (740), `InsuranceHub.tsx` (736), `EnhancedInsuranceUpload.tsx` (731). Break into subcomponents.
- [ ] `as any` casts in tests: `src/__tests__/components/Dashboard.test.tsx:131,198,223` — replace with properly typed mock helpers.
- [ ] No `: any` type annotations in production code (grep confirmed). Keep it that way.

### Missing tests

- [ ] Backend test count: 5 files (`encryption`, `authService`, `auditLog`, `errorHandler`, `validation`). No tests for any controller (auth, biomarker, insurance, expense, file, upload, healthGoals, healthNeeds, settings), no route-level tests, no tests for `claudeExtraction`, `sbcExtraction`, `biomarkerExtractor`, `pdfParser`, `ocrService`, `storageService`, `emailService`, `database` (RLS context), `userEncryption`, `csrf`, `rbac`, `rateLimiter`, `demoProtection`.
- [ ] Frontend test count: 6 files (`AddMeasurementModal`, `BiomarkerSummary`, `Button`, `Dashboard`, `LoginPage`, `AuthContext`, `useAuth`). No tests for insurance components, trends, upload flows, settings, or any of the ~35 remaining components.
- [ ] E2E: only `e2e/auth-test.js` and `e2e/auth-complete-test.js` exist — no e2e coverage for biomarker entry, insurance upload, consent sharing, or data export/delete.

### Documentation

- [ ] `AccountSettingsPage.tsx:56` — "Notification settings (stored in localStorage for now)" — inline TODO marker.
- [ ] `AccountSettingsPage.tsx:83` — `// TODO: Implement API call to save display name`.

---

## Dependency health

### Vulnerabilities (`npm audit`)

**Root (`package.json`):** 10 vulnerabilities — 1 critical, 6 high, 3 moderate, 0 low. Critical: `jspdf` HTML injection (direct dep). Highs: `vite` (3 CVEs), `picomatch` (2 CVEs), plus transitive via `serve`/`serve-handler`. Moderates: `dompurify` (5 CVEs), `ajv`, `brace-expansion`, `flatted`, `minimatch`.

**Backend (`backend/package.json`):** 29 vulnerabilities — 1 critical, 15 high, 7 moderate, 6 low. Critical: `fast-xml-parser` entity-encoding bypass (transitive via Google Cloud SDKs). Highs include `axios` (3 CVEs — SSRF / cloud-metadata / DoS), `@hono/node-server`, `fast-xml-parser` (multiple), `picomatch`, `path-to-regexp`, `qs`, `vite`. Moderates include `ajv`, `brace-expansion`, `defu` (prototype pollution), `effect`, `flatted`, `follow-redirects`, `hono`, `lodash`, `multer`.

Both `npm audit fix` reports `fixAvailable: true` for most entries.

### Outdated dependencies (`npm outdated`)

Unable to run — `npm outdated` was denied by the sandbox during this scan. Re-run manually:
```
npm outdated
cd backend && npm outdated
```
Known major-version watch items from `package.json` inspection:
- Backend pins `@prisma/client ^7.0.1` and `prisma ^7.0.1` (recent major).
- Root pins `vite ^7.3.0`, `vitest ^4.0.14`, `@vitejs/plugin-react ^4.3.1`, React 18 (not 19).
- Express 4.18.x (Express 5 is GA and closes the `qs` advisory).

---

## Deprecated code

The following models remain in `backend/prisma/schema.prisma` but are flagged in CLAUDE.md as "Deprecated (Still in Schema)":

- **`DNAData`** — `schema.prisma:376-393`
- **`DNAVariant`** — `schema.prisma:395-408`
- **`GeneticTrait`** — `schema.prisma:410-428`

**Current status:**
- Schema: models present with relations to `User.dnaData` (line 34) and cascade-delete.
- Backend: referenced in `services/encryption.ts:393,396` (PHI_FIELDS entries for `DNAVariant` and `GeneticTrait`), `types/index.ts:109` (`DNAVariant` interface), and `routes/adminRoutes.ts:140` (`dnaData: true` in admin user-detail include). Logger pre-configures `dnaLogger` / `dnaControllerLogger` (`utils/logger.ts:141-142`) but those loggers have no callers.
- Frontend: zero references to `DNAData` / `DNAVariant` / `GeneticTrait` anywhere under `src/`.
- No removal migration exists.

**Removal plan status:** None found in repo. CLAUDE.md says "consider removing if not planned" — no ADR or migration has been drafted.

---

## Priority definitions

| Priority | Definition | Timeline |
|---|---|---|
| Critical | Blocks core functionality | Fix immediately |
| High | Significant feature broken or HIPAA risk | Fix before beta |
| Medium | Usability issue | Fix during beta |
| Low | Minor annoyance | Backlog |
