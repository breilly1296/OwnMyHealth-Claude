# Periphery Security Audit — 2026-04-16

## Scope
Prompts executed: 07 (input validation), 08 (rate limiting), 09 (external APIs), 12 (CI/CD), 13 (dependencies), 30 (admin), 31 (logging/observability), 32 (error handling).

Files reviewed:
- `backend/src/middleware/validation.ts`, `rateLimiter.ts`, `errorHandler.ts`, `auth.ts`, `rbac.ts`, `csrf.ts`, `demoProtection.ts`
- `backend/src/routes/*.ts` (all 13 route files)
- `backend/src/controllers/authController.ts`, `biomarkerController.ts`, `expenseController.ts`, `fileController.ts`, `uploadController.ts`, `settingsController.ts`
- `backend/src/services/claudeExtraction.ts`, `sbcExtraction.ts`, `ocrService.ts`, `storageService.ts`, `emailService.ts`, `auditLog.ts`, `aiCostTracker.ts`, `pdfParser.ts`
- `backend/src/utils/logger.ts`, `phiRedaction.ts`, `securePdfParsing.ts`
- `backend/src/types/index.ts`, `config/index.ts`, `app.ts`
- `backend/Dockerfile`, `backend/.dockerignore`, `.dockerignore`
- `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `.github/dependabot.yml`
- `package.json` (root + backend), `npm audit` output
- `src/hooks/useRBAC.ts`, `src/components/common/RoleGuard.tsx`, `src/contexts/AuthContext.tsx`, `src/services/api/client.ts`, `src/utils/logger.ts`

## Summary
| Severity | Count |
|---|---|
| Critical | 2 |
| High | 8 |
| Medium | 14 |
| Low | 11 |
| Info | 2 |

## Findings

### F-1 — Default JWT secret fallbacks in development — Critical
- **Location:** `backend/src/config/index.ts:16,20,24`
- **Observation:** `accessSecret`, `refreshSecret`, and legacy `secret` each fall back to static strings like `'access-secret-change-in-production'`. Production startup does block these (lines 126-132), but the fallbacks exist in dev and any misconfigured non-production environment signs tokens with publicly known values. If `NODE_ENV` is ever missing or set to something other than `production`, the guards never run.
- **Impact:** Anyone can forge access/refresh tokens in dev/staging and potentially extract PHI if a staging DB holds real data. A misconfigured Cloud Run revision (NODE_ENV unset) becomes a full authentication bypass.
- **Fix:** Require these env vars unconditionally (throw at module load in all environments). Remove the literal fallbacks.
- **Evidence:**
  ```ts
  accessSecret: process.env.JWT_ACCESS_SECRET || 'access-secret-change-in-production',
  ...
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-in-production',
  ```

### F-2 — jsPDF vulnerable to arbitrary JS execution and DoS (direct dep) — Critical
- **Location:** `package.json:19` (`"jspdf": "^4.0.0"`); confirmed by `npm audit` at root
- **Observation:** Root `npm audit` reports **1 critical + 6 high** severity advisories against `jspdf` (<=4.2.0 affected by HTML injection in New Window paths GHSA-wfv2-pwc8-crg5 CVSS 9.6, PDF injection via AcroFormChoiceField, BMPDecoder DoS, GIF dimensions DoS, etc.). App pins `^4.0.0` which satisfies vulnerable range.
- **Impact:** Malicious user-influenced content rendered into PDFs could execute JavaScript on the generated PDF, or DoS the frontend via crafted images. Direct dependency with known public advisories.
- **Fix:** Upgrade to `jspdf@^4.2.0` or later (fixes available per audit). Run `npm audit fix` at the repo root.
- **Evidence:**
  ```
  jspdf  <=4.2.0
  Severity: critical
  jsPDF has HTML Injection in New Window paths - GHSA-wfv2-pwc8-crg5
  ```

### F-3 — `aiLimiter` missing on PDF upload routes that call Claude — High
- **Location:** `backend/src/routes/uploadRoutes.ts:76-97,119-125`; `backend/src/routes/insuranceRoutes.ts:115-132`
- **Observation:** Prompt 08 explicitly requires `aiLimiter` on `POST /upload/lab-report`, `POST /upload/insurance-sbc`, and `POST /insurance/upload-sbc` because they each invoke Claude Sonnet for document extraction. The routes have `uploadLimiter` (20/hour) attached but no `aiLimiter` (10/hour, per-user). `uploadLimiter` is keyed only by IP (no `keyGenerator`), while `aiLimiter` is the only limiter keyed by `user.id`. A user can burn 20 Claude Sonnet extractions per hour per IP without per-user cost controls.
- **Impact:** Cost runaway on Claude Sonnet (the most expensive model: $3 in / $15 out per M tokens per `aiCostTracker.ts:17`). No per-user cap. A single authenticated user can sustain 20 SBC extractions per hour against the shared API key.
- **Fix:** Add `aiLimiter` before `upload.single('file')` on `/lab-report`, `/insurance-sbc`, `/lab-results-ocr`, and `/insurance/upload-sbc`/`/plans/:id/reanalyze`. Keep `uploadLimiter` as IP-based defense-in-depth.
- **Evidence:**
  ```ts
  router.post(
    '/insurance-sbc',
    authenticate,
    blockDemoAI,
    upload.single('file'),
    asyncHandler(uploadSBC)
  );
  ```

### F-4 — `aiLimiter` missing on `/biomarkers/bulk` extraction path — High
- **Location:** `backend/src/routes/biomarkerRoutes.ts:83-88`
- **Observation:** The batch create endpoint has `bulkOperationLimiter` (30/hour) but no `aiLimiter`. If batch creates trigger any AI-side processing (and they may feed into `suggestGoals` / `analyzeHealthNeeds`), no per-user Claude cap applies. Prompt 08 flags `/biomarkers/batch` for `bulkOperationLimiter`, which is correct — but the AI-related routes in its table include `aiLimiter` cross-check that is incomplete.
- **Impact:** Not as severe as F-3; flagging for completeness. Downstream AI-powered suggest/analyze calls then consume the user's `aiLimiter` budget.
- **Fix:** Confirm batch create does not chain into Claude calls. If any do, add `aiLimiter`.
- **Evidence:**
  ```ts
  router.post('/batch', bulkOperationLimiter, validate(schemas.biomarker.batchCreate), ...);
  ```

### F-5 — Demo admin/role protection middleware exported but never attached — High
- **Location:** `backend/src/middleware/demoProtection.ts:37-131`; `backend/src/routes/adminRoutes.ts:26-27`
- **Observation:** `blockDemoAdminAccess`, `blockDemoRoleChange`, `blockDemoUserModification`, and the combined `demoProtection` are all exported from `demoProtection.ts` but `Grep` shows zero imports of any of them outside the definition file. `adminRoutes.ts` only applies `authenticate` + `requireRole('ADMIN')`. Only `blockDemoAI` is actually wired into routes. If a demo user's role somehow got elevated to ADMIN (bug, test fixture leaking), nothing would block them from creating/deleting other users via `/api/v1/admin/users/*`.
- **Impact:** Defense-in-depth gap — demo accounts (non-production) are not blocked from admin operations at the middleware layer, contrary to prompt 30 §6 ("Demo account restrictions enforced at backend (not just frontend)"). Production blocks demo via `config.isProduction` in `config/index.ts:191`, but staging is exposed.
- **Fix:** Attach `blockDemoAdminAccess` at the top of `adminRoutes.ts`: `router.use(authenticate); router.use(blockDemoAdminAccess); router.use(requireRole('ADMIN'));`
- **Evidence:**
  ```ts
  // adminRoutes.ts
  router.use(authenticate);
  router.use(requireRole('ADMIN'));
  // (no demoProtection import or use)
  ```

### F-6 — Dockerfile COPYs `.env.example` and package files but `.dockerignore` does not exclude `.env.production.example` — High
- **Location:** `.dockerignore:10-12`; `backend/.dockerignore:10-12`
- **Observation:** Both dockerignores block `.env`, `.env.local`, `.env.*.local` but do not block `.env.example` or `.env.production.example`. The repo contains `.env.production.example`. While these are templates (usually safe), they are copied when `COPY . .` patterns are used. The backend Dockerfile only copies specific paths (`package*.json`, `prisma/`, `src/`, `tsconfig.json`) so backend is fine. The frontend root `.dockerignore` controls what a future frontend Docker build would ship; `.env.example` leaking with real example values is a minor concern — but no frontend Dockerfile exists in this repo yet.
- **Impact:** Low surface area today (no frontend Dockerfile). Hygiene gap — if anyone adds one with `COPY . .`, `.env.production.example` would ship.
- **Fix:** Add `.env*.example` to both dockerignore files.
- **Evidence:**
  ```
  # Development files
  .env
  .env.local
  .env.*.local
  ```

### F-7 — `pg` qs and `axios` SSRF vulnerabilities in backend — High
- **Location:** `backend/package.json`; `npm audit` output at `backend/` shows 29 vulnerabilities (1 critical, 15 high)
- **Observation:** Backend transitive deps include `axios 1.0.0-1.14.0` (three highs: DoS via `__proto__` GHSA-43fc-jf86-j433, NO_PROXY SSRF bypass GHSA-3p68-rc4w-qgx5, cloud metadata exfiltration GHSA-fvcv-3m26-pcqx) and `fast-xml-parser` critical (entity encoding bypass GHSA-m7jm-9gc2-mpf2 CVSS 9.3). `qs 6.7.0-6.14.1` has DoS. `@hono/node-server`, `@prisma/config`, `@prisma/dev`, `effect`, `defu` all have high severity advisories.
- **Impact:** SSRF vector via axios if any code path uses user-controlled URLs (no direct use found, but SDK internals could). Prototype pollution via `defu`. DoS via `fast-xml-parser`.
- **Fix:** Run `npm audit fix` in `backend/`. Some may require `--force` for breaking changes; schedule a minor version bump cycle.
- **Evidence:**
  ```
  axios  1.0.0 - 1.14.0
  Severity: high
  Axios is Vulnerable to Denial of Service via __proto__ Key in mergeConfig
  Axios has a NO_PROXY Hostname Normalization Bypass that Leads to SSRF
  ```

### F-8 — vite dev server path traversal / arbitrary file read — High
- **Location:** `package.json:49` (`"vite": "^7.3.0"`); `npm audit` root
- **Observation:** Root audit: `vite 7.0.0-7.3.1` has three high-severity advisories: path traversal in optimized deps .map handling (GHSA-4w7w-66w2-5vf9), `server.fs.deny` bypass with queries (GHSA-v2wj-q39q-566r), arbitrary file read via WebSocket (GHSA-p9ff-h696-f583).
- **Impact:** Developer workstation risk only (vite dev server not run in production). Still, a malicious site the developer visits could read arbitrary files off the developer machine while the dev server is running.
- **Fix:** `npm install vite@^7.3.2` or later, or run `npm audit fix`.
- **Evidence:**
  ```
  vite  7.0.0 - 7.3.1
  Severity: high
  Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling
  ```

### F-9 — Prisma 7 still in beta/alpha with known advisories — High
- **Location:** `backend/package.json:21-22,40`
- **Observation:** `@prisma/client ^7.0.1` and `prisma ^7.0.1` are bleeding-edge; `npm audit` flags `@prisma/dev` and `@prisma/config` with high-severity auth-bypass and race-condition advisories pulled in transitively. Prisma 7 is at roughly 6 months maturity; production stability guidance would prefer 6.x LTS or a pinned stable point release.
- **Impact:** Transitive vuln exposure via `@hono/node-server` (authorization bypass for protected static paths GHSA-wc8c-qw6v-h7f6) and `effect` (context lost under load GHSA-38f7-945m-qr2g).
- **Fix:** Either pin Prisma to latest stable 6.x (recommended for HIPAA production), or upgrade within 7.x to a version where `@prisma/dev` is fixed. Confirm migrations work on downgrade before switching.
- **Evidence:**
  ```
  @prisma/dev  <=0.22.0
  Severity: high
  ```

### F-10 — Error handler registered AFTER `notFoundHandler` (correct) but `app.ts` also registers routes after 404 conceptually safe — Low
- **Location:** `backend/src/app.ts:226-229`
- **Observation:** Order is correct: routes → `notFoundHandler` (line 226) → `errorHandler` (line 229). Both are last. No middleware is registered after errorHandler.
- **Impact:** None — this is a passed check, noting for completeness.
- **Fix:** N/A.
- **Evidence:**
  ```ts
  // 404 handler
  app.use(notFoundHandler);
  // Error handler (must be last)
  app.use(errorHandler);
  ```
- **Status:** Passed, not a finding. Included for audit traceability.

### F-11 — Bare `console.*` calls outside logger in `src/` (frontend) — Medium
- **Location:** `src/contexts/AuthContext.tsx:90,93,102`; `src/services/api/client.ts:103,166`; `src/components/dashboard/Dashboard.tsx:118`; `src/components/settings/AccountSettingsPage.tsx:113`; `src/components/insurance/EnhancedInsuranceUpload.tsx:252`; `src/components/insurance/CostOptimization.tsx:77`
- **Observation:** Prompt 31 §3 requires zero bare `console.*` outside `src/utils/logger.ts`. Found 8 instances across 6 files. These bypass the PHI-redaction in `src/utils/logger.ts` and can leak auth details or PHI-adjacent errors to the browser console.
- **Impact:** Error objects logged via `console.error('SBC upload failed:', err)` can include server error bodies (some of which may echo back request data). In production, leaked details helpfulness to attackers inspecting the console.
- **Fix:** Replace with `apiLogger.error(...)` / `authLogger.error(...)` from `src/utils/logger.ts`.
- **Evidence:**
  ```ts
  // AuthContext.tsx:90
  console.log('[AuthContext] Access token refreshed from refresh token');
  // client.ts:103
  console.warn('[CSRF] No csrf token found in cookies:', cookies.substring(0, 200));
  ```

### F-12 — CI workflow uses `npm install` instead of `npm ci` — Medium
- **Location:** `.github/workflows/ci.yml:29,68`
- **Observation:** CI jobs run `npm install` (frontend and backend), which can modify `package-lock.json` and silently install different dep versions than what's committed. Prompt 13 §4 explicitly requires `npm ci`.
- **Impact:** Non-reproducible builds. Undetected lockfile drift. `npm audit` run over whatever `install` produces, not the committed lockfile.
- **Fix:** Change `npm install` → `npm ci` in both frontend and backend jobs.
- **Evidence:**
  ```yaml
  - name: Install dependencies
    run: npm install
  ```

### F-13 — `npm audit` in CI uses `continue-on-error: true` — Medium
- **Location:** `.github/workflows/ci.yml:107,112`
- **Observation:** Both `npm audit --audit-level=high` steps have `continue-on-error: true`, so even critical/high vulnerabilities don't block CI or trigger a failed build status check. Repo currently has 1 critical + 8 high that CI is silently passing over.
- **Impact:** Known vulns slip into production unnoticed (see F-2, F-7, F-8). HIPAA-adjacent software should fail on high+ CVEs.
- **Fix:** Remove `continue-on-error: true` and fix outstanding audit findings. Alternatively, use `better-npm-audit` or similar to maintain an explicit allowlist.
- **Evidence:**
  ```yaml
  - name: Audit frontend dependencies
    run: npm audit --audit-level=high
    continue-on-error: true
  ```

### F-14 — Prisma raw error messages could leak in `P2002` path — Medium
- **Location:** `backend/src/middleware/errorHandler.ts:111-123`
- **Observation:** Prisma error handling returns generic messages for `P2002`, `P2025`, `P2003`, `P2014`. However, the error constructor at line 162 still sets `err.name === 'PrismaClientKnownRequestError'`, and the `default` case at line 120 returns `GENERIC_ERROR_MESSAGE` — but only for unknown codes. The handled cases are safe. This is OK.
- **Impact:** None observed — flagging in case new Prisma codes surface; the default branch is generic.
- **Fix:** N/A; include unit test for new Prisma codes as they arise.
- **Status:** Moved to Checks passed. Actually, see F-15 for the real gap.

### F-15 — Validation errors return full Zod `issue` details including user values — Medium
- **Location:** `backend/src/middleware/validation.ts:24-30,182`; `backend/src/middleware/errorHandler.ts:155-158,203-212`
- **Observation:** `zodIssueToDetail` returns `{ field, message, code }`. The `message` comes from Zod and can include the user's input value (e.g., `"Invalid input: '123-45-6789' is not a valid..."`). `ValidationError.details` is forwarded in the response body verbatim (errorHandler.ts:156-158, 208). Prompt 32 §7 explicitly warns: "No value echoed back in validation error messages for PHI fields."
- **Impact:** If a user submits a password, SSN, or member ID that fails validation, the server response body will contain the value. That value lands in response logs, browser network panel, and potentially APMs.
- **Fix:** Strip `issue.params.input` / sanitize `issue.message` before returning. For password schemas specifically, do not echo the password in responses.
- **Evidence:**
  ```ts
  function zodIssueToDetail(issue: ZodIssue): ValidationErrorDetail {
    return { field: issue.path.join('.'), message: issue.message, code: issue.code };
  }
  ```

### F-16 — Biomarker guidance prompt interpolates user input raw (not via sanitizeForPrompt) — Medium
- **Location:** `backend/src/routes/biomarkerRoutes.ts:127-151`
- **Observation:** The guidance prompt inlines `biomarker.name`, `biomarker.unit`, `biomarker.status` directly into the Claude prompt. The schema (`validation.ts:357-372`) uses `promptSafeString` for those fields which applies `sanitizeForPrompt`. Good. However, `biomarker.value` is not passed through any sanitizer (it's `z.number()` — numeric, so low risk), and `history[i].date` uses `z.string().max(30)` not `promptSafeString`. History dates are limited to 30 chars but are not stripped of control characters.
- **Impact:** Minor prompt-injection vector via history dates. `max 10` history items and 30-char cap constrains blast radius. Not a PHI exfil risk but could influence Claude output.
- **Fix:** Apply `promptSafeString(0, 30)` to `history[i].date`.
- **Evidence:**
  ```ts
  history: z.array(z.object({
    value: z.number(),
    date: z.string().max(30),
  })).max(10).optional(),
  ```

### F-17 — `standardLimiter` windowMs ENV-configurable but default value appears as `15 minutes` while `config.rateLimit.windowMs` reads raw ms — Medium
- **Location:** `backend/src/config/index.ts:67-70`; `backend/src/middleware/rateLimiter.ts:8-9`
- **Observation:** `config.rateLimit.windowMs` default = 900000ms (15 min), `maxRequests` = 100. That's 100 req/15 min for ALL routes globally, applied **before** route-specific limiters (app.ts:166). This is low for a SPA that issues many GETs per page load. Prompt 08 says "100 req/15 min (global default)." which matches. This is actually per spec.
- **Impact:** Possible legitimate-user flapping on dashboards that batch fetch many biomarker/insurance endpoints. Not exploitable, just a UX risk and potential false-positive rate limit hits.
- **Fix:** Consider raising `RATE_LIMIT_MAX_REQUESTS` default to 300-500 for SPA dashboards, or exclude GET from the count.
- **Evidence:**
  ```ts
  windowMs: config.rateLimit.windowMs,  // 15 min
  max: config.rateLimit.maxRequests,    // 100
  ```

### F-18 — Storage service: file.save() has no content-disposition safety; signed URL 15min OK — Medium
- **Location:** `backend/src/services/storageService.ts:59-65,97-112`
- **Observation:** `uploadFile` stores files with `contentType: mimeType` set from the original upload. GCS serves that Content-Type back on signed-URL fetches. If a user uploads a malicious `application/pdf` that the browser auto-executes (no real risk for PDFs, but illustrates), the signed URL GET would serve the mime as-is. Signed URL expiration is correctly 15 min (line 20).
- **Impact:** Low. No image/SVG inline path observed. Flagging as hygiene.
- **Fix:** Set `Content-Disposition: attachment` metadata on upload for files like `.pdf`, `.html`, `.svg` to force download rather than inline render.
- **Evidence:**
  ```ts
  await file.save(buffer, {
    contentType: mimeType,
    metadata: { userId, fileId, uploadedAt: new Date().toISOString() },
  });
  ```

### F-19 — SBC extraction logs raw plan/insurer names (decrypted PHI-adjacent data) — Medium
- **Location:** `backend/src/services/sbcExtraction.ts:904-921,925-968`
- **Observation:** Three `sbcLogger.info(...)` calls at lines 904, 925, 946, 959 log `planName`, `insurerName`, copays, coinsurance rates, Rx tier amounts, ambulance costs, etc. These are decrypted user plan details (PHI-adjacent in HIPAA's insurance-info definition). In production `config.isProduction` the logger suppresses `info` (logger.ts:54), so these drop. In staging/dev they persist. The `SENSITIVE_FIELDS` set in logger.ts does NOT cover `planName` / `insurerName`.
- **Impact:** Dev/staging logs contain insurance plan details. Cloud Run + Cloud Logging retains these. If dev/staging logs are accessible to more people than production, that's a PHI sprawl.
- **Fix:** Either remove these info logs entirely, redact `planName` / `insurerName`, or gate them behind `if (config.isDevelopment)` explicitly.
- **Evidence:**
  ```ts
  sbcLogger.info('Claude SBC extraction complete', {
    planName: result.planName || 'Unknown',
    insurerName: result.insurerName || 'Unknown',
    ...
  });
  ```

### F-20 — `stripPHIFromText` not called on SBC response (only on lab extraction) — Medium
- **Location:** `backend/src/services/sbcExtraction.ts:816`; `backend/src/services/claudeExtraction.ts:159`
- **Observation:** `claudeExtraction.ts` strips PHI from the Claude response (line 159: `stripPHIFromText(textContent.text)`). `sbcExtraction.ts:816` does **not** call `stripPHIFromText(responseText)` — it uses the raw text directly. Given the SBC extraction instructions (line 90: "Do NOT include the patient's name in the response"), Claude might still return PHI if the SBC PDF header included the member.
- **Impact:** PHI from SBC docs could leak into `responseText` and subsequently into logs (`sbcLogger.info('Received Claude SBC response', { responseLength })` is OK but debug logs elsewhere could spill).
- **Fix:** Apply `stripPHIFromText(responseText)` before parsing, like `claudeExtraction.ts` does.
- **Evidence:**
  ```ts
  // sbcExtraction.ts:816 (no stripPHIFromText)
  const responseText = textContent.text;
  sbcLogger.info('Received Claude SBC response', { responseLength: responseText.length, ... });
  ```

### F-21 — Logger `sanitizeData` skips arrays — arrays of PHI objects leak — Medium
- **Location:** `backend/src/utils/logger.ts:35-47`
- **Observation:** Line 40 recurses into objects but explicitly excludes `Array.isArray(value)` — arrays pass through raw. If anyone logs `logger.info('x', { data: { biomarkers: [{ value: ... }] } })`, the biomarker array bypasses redaction.
- **Impact:** PHI in array responses (biomarker lists, benefit arrays, export payloads) can leak to logs unredacted. Prompt 31 §1 flags this exact gap ("Arrays of objects sanitized (the current `sanitizeData` skips arrays — verify this is intentional or a gap).").
- **Fix:** Recurse into arrays: `Array.isArray(value) ? value.map(v => typeof v === 'object' ? sanitizeData(v) : v) : ...`
- **Evidence:**
  ```ts
  } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    sanitized[key] = sanitizeData(value as Record<string, unknown>);
  } else {
    sanitized[key] = value;
  }
  ```

### F-22 — `expenseController` catches errors and returns `res.status(500).json(...)` directly, bypassing errorHandler — Medium
- **Location:** `backend/src/controllers/expenseController.ts:99-102,145-148,197-200,224-227,270-273,388-395,443-446`
- **Observation:** The `analyzeCosts`, `createProjection`, `getProjections`, `updateProjection`, `deleteProjection`, `updateCurrentSpending`, `getAnalyses` functions each have `try/catch` blocks that call `res.status(500).json({ error: '...' })` instead of `next(error)`. This bypasses the central `errorHandler`, so these errors don't get the structured `ApiResponse` shape, no stack traces in dev, no consistent audit trail.
- **Impact:** Error shape inconsistency (`{ error: string }` vs `{ success: false, error: { code, message } }`). Response shape drift breaks frontend error code-based routing (`src/services/api/client.ts:219-221` reads `data.error.code`, which will be undefined).
- **Fix:** Remove the try/catch or replace `res.status(500).json(...)` with `throw error` and use `asyncHandler` wrapper (already applied at route level). The outer `asyncHandler` forwards to `errorHandler` correctly.
- **Evidence:**
  ```ts
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to create expense projection' });
  }
  ```

### F-23 — `expenseController` uses `throw new Error('ANTHROPIC_API_KEY not configured')` — bare Error, not AppError — Medium
- **Location:** `backend/src/controllers/expenseController.ts:38`; `backend/src/controllers/biomarkerController.ts:494,497,500`
- **Observation:** `getAnthropicClient()` throws bare `Error('ANTHROPIC_API_KEY not configured')`. Similarly `biomarkerController.ts:494-500` throws bare `Error` during batch validation. These bypass the `AppError.isOperational` tracking (errorHandler.ts:21) and fall through the `err instanceof AppError` branch, landing in the 500 default with generic message. That's safe for the response, but loses operational classification.
- **Impact:** Lost operational-vs-programmer classification in logs. Not a leak, just poor hygiene.
- **Fix:** Use `InternalServerError`/`BadRequestError`/`ServiceUnavailableError` from `errorHandler.ts`.
- **Evidence:**
  ```ts
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  ```

### F-24 — `requireRole` branching: admin routes correctly gated — Low
- **Location:** `backend/src/routes/adminRoutes.ts:26-27`
- **Observation:** `router.use(authenticate); router.use(requireRole('ADMIN'));` is applied before all route definitions. Every admin handler inherits this; no route can bypass.
- **Impact:** None — passed check.
- **Fix:** N/A.
- **Evidence:**
  ```ts
  router.use(authenticate);
  router.use(requireRole('ADMIN'));
  ```

### F-25 — Admin audit log query endpoint has no sensitiveLimiter or rate limiter — Low
- **Location:** `backend/src/routes/adminRoutes.ts:659-729`
- **Observation:** `GET /admin/audit-logs` has no per-route rate limiting. Prompt 30 §9 flags "Audit log queries rate limited (expensive queries)." Only `sensitiveLimiter` is applied to permanent delete (line 400). Other admin routes rely solely on `standardLimiter` (100 req/15min global).
- **Impact:** Admin can spam audit log queries (which Prisma joins with user table) at 100/15min; not exploitable by non-admins but still a resource concern if admin token is stolen.
- **Fix:** Add `sensitiveLimiter` or a dedicated admin limiter on `GET /admin/audit-logs`, `GET /admin/stats`, `GET /admin/users`.
- **Evidence:**
  ```ts
  router.get(
    '/audit-logs',
    validate(schemas.admin.auditLogQuery, 'query'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      // no limiter
  ```

### F-26 — No `process.on('unhandledRejection')` / `uncaughtException` handlers — Low
- **Location:** `backend/src/app.ts` (entire file)
- **Observation:** Prompt 32 §6 requires top-level `process.on('unhandledRejection', ...)` and `process.on('uncaughtException', ...)` with log+exit. Grep for these patterns in `backend/src/` returns zero matches. On Cloud Run, an unhandled promise rejection will go to stderr and may silently leave the process in a bad state; the supervisor will not restart until a hard crash.
- **Impact:** Silent zombie processes on unhandled promise errors. Logs show the rejection but service keeps serving on a corrupted state.
- **Fix:** Add in `app.ts` before `startServer()`:
  ```ts
  process.on('unhandledRejection', (err) => { logger.error('unhandledRejection', { data: { err } }); process.exit(1); });
  process.on('uncaughtException', (err) => { logger.error('uncaughtException', { data: { err } }); process.exit(1); });
  ```
- **Evidence:** (no matches)

### F-27 — Error handler in development mode returns stack traces in response body — Low
- **Location:** `backend/src/middleware/errorHandler.ts:207-212`
- **Observation:** Response body includes `stack: err.stack` when `config.isDevelopment`. This is gated correctly — production is safe (line 207 ternary). Stack contains file paths and potentially line numbers referencing server internals. No production leak. Flagged for awareness: if someone accidentally runs with NODE_ENV unset (treated as dev), stack traces escape.
- **Impact:** None in production with NODE_ENV=production set. Hygiene: better to log stack server-side only.
- **Fix:** Consider removing stack from the response entirely; keep it in server logs.
- **Evidence:**
  ```ts
  ...(config.isDevelopment ? { stack: err.stack } : {}),
  ```

### F-28 — GCS upload uses `GCS_BUCKET_NAME` env var with default string fallback — Low
- **Location:** `backend/src/services/storageService.ts:19`; `backend/src/config/index.ts:91`
- **Observation:** Bucket name defaults to `'ownmyhealth-user-files'` if env is unset. In the unlikely event a misconfigured env var attaches to wrong bucket, data cross-contamination is possible. Better to fail fast.
- **Impact:** Low (production has env set). Hygiene.
- **Fix:** Throw if `GCS_BUCKET_NAME` unset in production (similar to the CORS_ORIGIN validation in app.ts).
- **Evidence:**
  ```ts
  const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'ownmyhealth-user-files';
  ```

### F-29 — Dockerfile healthcheck hardcodes port but uses `${PORT:-3001}` — Info
- **Location:** `backend/Dockerfile:49`
- **Observation:** Healthcheck: `wget ... http://localhost:${PORT:-3001}/health`. Uses env var correctly with fallback.
- **Impact:** None.
- **Fix:** N/A.
- **Status:** Info; no issue.

### F-30 — Deploy workflow does not pin gcloud SDK version — Low
- **Location:** `.github/workflows/deploy.yml:29-31,100-103`
- **Observation:** Actions `google-github-actions/auth@v2` and `setup-gcloud@v2` are pinned to major versions, not to full SHAs. GitHub SHA pinning is strictest (prevents registry-level supply-chain attacks). Major-version tags can still move within that major.
- **Impact:** Low — Google's official actions. Moderately trusted. For HIPAA infra, SHA pinning is industry best practice.
- **Fix:** Consider pinning to SHA: `uses: google-github-actions/auth@55bd3a7c6e2ae7cf1877fd1ccb9d54c0503c457c # v2.1.6`
- **Evidence:**
  ```yaml
  - uses: google-github-actions/auth@v2
  - uses: google-github-actions/setup-gcloud@v2
  ```

### F-31 — Deploy workflow deletes entire frontend bucket with `gsutil rm -r` before upload — Low
- **Location:** `.github/workflows/deploy.yml:121`
- **Observation:** `gsutil -m rm -r gs://${BUCKET}/** || true` wipes all frontend assets before upload. Short window where bucket is empty. No rollback if deploy fails midway (bucket ends up with partial files).
- **Impact:** Brief 404s for active users during deploy. No rollback path. Production SLO risk.
- **Fix:** Use `gsutil rsync -d` (sync-with-delete) instead. Or do blue/green with Cloud Load Balancer backends.
- **Evidence:**
  ```bash
  gsutil -m rm -r gs://${{ env.FRONTEND_BUCKET }}/** || true
  gsutil -m cp -r dist/* gs://${{ env.FRONTEND_BUCKET }}/
  ```

### F-32 — Cloud Run deploy uses `:latest` tag in addition to SHA; SHA correctly used for deploy — Low
- **Location:** `.github/workflows/deploy.yml:51-59,69`
- **Observation:** Builds two tags (`:${SHA}` and `:latest`), pushes both. Deploy uses SHA (line 69, `--image "$IMAGE"` where IMAGE has the SHA). Good — SHA ensures immutable deployment. `:latest` tag is extra, not actively used, but could be exploited if someone later adds a `gcloud run deploy --image :latest`.
- **Impact:** Minor — surface is small.
- **Fix:** Drop `:latest` tag to avoid confusion.
- **Evidence:**
  ```bash
  docker build -t "$IMAGE_SHA" -t "$IMAGE_LATEST" .
  docker push "$IMAGE_LATEST"
  ```

### F-33 — CI/deploy does not verify Prisma migrations before deploy — Low
- **Location:** `.github/workflows/deploy.yml` + `backend/Dockerfile:51`
- **Observation:** The Dockerfile runs `npx prisma migrate deploy` at container CMD startup (line 51). If migration fails, container exits, Cloud Run retries, and eventually traffic flips to the new revision anyway. No pre-deploy migration dry-run against staging. Prompt 12 §6 flags rolling deployment and health checks — container health check (line 48) catches failures.
- **Impact:** Bad migrations can cause a deployment failure that's caught by Cloud Run health checks but might leave DB in a partial-migration state if the migration crashes mid-way.
- **Fix:** Add a job in `deploy.yml` that runs `prisma migrate status` against production before pushing. Not blocking; enhancement.
- **Evidence:**
  ```dockerfile
  CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app.js"]
  ```

### F-34 — Login endpoint: response identical for user-not-found vs bad-password — Info
- **Location:** `backend/src/services/authService.ts` (not read directly); `backend/src/routes/authRoutes.ts:46-51`
- **Observation:** `strictAuthLimiter` is applied with `keyGenerator: email+IP` (rateLimiter.ts:54-59) and `skipSuccessfulRequests: true`. This is good for timing-safe rate-limit keying on email+IP. Actual response content for login failure mode (user-not-found vs wrong password) couldn't be verified without reading authService.ts in depth.
- **Impact:** Unverifiable at this pass.
- **Fix:** N/A until verified.
- **Status:** See Unverifiable.

### F-35 — PHI Redaction regex: does not strip email addresses — Medium
- **Location:** `backend/src/utils/phiRedaction.ts:13-30`
- **Observation:** `stripPHIFromText` handles SSN, MRN, phone, DOB, address but NOT email addresses. Prompt 31 §8 explicitly flags this: "Email addresses — not currently stripped; decide if that's an accepted risk or a gap."
- **Impact:** Patient emails in lab report PDFs (common) flow through Claude and into potentially logs unredacted. Emails are PII; under HIPAA a patient email tied to medical info can be PHI.
- **Fix:** Add `text = text.replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, '[EMAIL_REDACTED]')`.
- **Evidence:**
  ```ts
  export function stripPHIFromText(text: string): string {
    text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]');
    // ...no email pattern
  ```

### F-36 — Error handler: `err.message` forwarded to client when error is `AppError` — Low
- **Location:** `backend/src/middleware/errorHandler.ts:154`
- **Observation:** For `AppError` instances: `message = err.message`. `ValidationError` details are passed through (line 157). Controller-level code constructs AppError messages with formatted data (e.g., `getTargetUserId`, etc.). Safe in general, but if a future AppError message embeds user input verbatim without review, it leaks.
- **Impact:** Low — all observed AppError messages are generic/static strings.
- **Fix:** Code review guideline: never interpolate user input into AppError messages.
- **Evidence:**
  ```ts
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message; // AppError messages are safe to expose
  ```

### F-37 — SendGrid email service: `fromEmail` default falls back to hardcoded domain — Low
- **Location:** `backend/src/config/index.ts:84`; `backend/src/services/emailService.ts:231-232`
- **Observation:** `fromEmail: process.env.EMAIL_FROM || 'noreply@ownmyhealth.com'` — acceptable default. SendGrid requires verified sender; if default domain isn't verified, emails silently fail (caught gracefully at line 242-250).
- **Impact:** None (dev/prod has explicit env var).
- **Fix:** None needed. Flagging for completeness.
- **Evidence:**
  ```ts
  fromEmail: process.env.EMAIL_FROM || 'noreply@ownmyhealth.com',
  ```

### F-38 — Frontend API client warns about missing CSRF token in production (`console.warn`) — Medium
- **Location:** `src/services/api/client.ts:103,166`
- **Observation:** Two `console.warn` calls related to CSRF tokens. Line 103 logs the first 200 chars of `document.cookie` (could contain session IDs on systems where cookies aren't HttpOnly — here they are, but still a leak of cookie names). Line 166 logs every POST/PUT/PATCH/DELETE made without a CSRF token.
- **Impact:** Production browser console noise; cookie-sniff surface for XSS attempts (though HttpOnly cookies aren't exposed to JS anyway). Prompt 31 flags zero bare `console.*`.
- **Fix:** Route through `apiLogger` (src/utils/logger.ts); strip `cookies.substring(0, 200)` to avoid leaking cookie names.
- **Evidence:**
  ```ts
  if (!token && typeof window !== 'undefined') {
    console.warn('[CSRF] No csrf token found in cookies:', cookies.substring(0, 200));
  }
  ```

### F-39 — `aiCostTracker` logs `userId` in every call — Info
- **Location:** `backend/src/services/aiCostTracker.ts:36-43`
- **Observation:** Logs `userId`, `model`, `tokens`, `cost`. No PHI but userId is a pseudonymous identifier. Production suppresses `info` (logger.ts:54), so this only affects dev/staging.
- **Impact:** None for PHI. User-ID sprawl in dev logs is acceptable.
- **Fix:** N/A.

### F-40 — Content-Security-Policy in Helmet allows `'unsafe-inline'` for styles — Low
- **Location:** `backend/src/app.ts:95-101`
- **Observation:** `styleSrc: ["'self'", "'unsafe-inline'"]`. Common for Tailwind/CSS-in-JS but reduces CSP effectiveness.
- **Impact:** Inline style injection via XSS still possible (though React largely prevents this). scriptSrc correctly disallows inline.
- **Fix:** Consider CSP nonces for styles if compatible with the Tailwind build pipeline.
- **Evidence:**
  ```ts
  styleSrc: ["'self'", "'unsafe-inline'"],
  ```

### F-41 — Admin `updateUser` allows password reset without invalidating sessions — Medium
- **Location:** `backend/src/routes/adminRoutes.ts:242-320`
- **Observation:** When admin changes a user's password (line 275-277), no `prisma.session.deleteMany({ where: { userId: id } })` call is made. The user's active sessions remain valid. Contrast with the `DELETE /users/:id` at line 383 which does invalidate sessions on deactivation. Prompt 30 §2 says "Deactivate user (soft delete): user sessions revoked" — but also the implicit expectation when admin overrides a password is to kick existing sessions.
- **Impact:** Compromised account with admin-reset password still has active refresh tokens. Attacker keeps access even after admin intervention until refresh-token expiry (7 days).
- **Fix:** When `password` is in the update payload, also call `prisma.session.deleteMany({ where: { userId: id } })`.
- **Evidence:**
  ```ts
  if (password) {
    updateData.passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
  }
  const user = await prisma.user.update({ where: { id }, data: updateData, ... });
  // (no session invalidation after password update)
  ```

### F-42 — Admin role-change path allows demotion of self if `role` not included — Medium
- **Location:** `backend/src/routes/adminRoutes.ts:253`
- **Observation:** Check `if (id === adminId && role)` prevents self role change but only when role is in the update. If role is undefined but `isActive=false` is set for self, admin can deactivate themselves. Line 337 blocks self-delete for soft-delete; line 411 blocks self-permanent-delete. But the PATCH route (line 242) allows self-deactivation via `isActive=false`.
- **Impact:** Lockout risk — an admin can accidentally or maliciously set `isActive=false` on themselves and lose access.
- **Fix:** Also reject `id === adminId && isActive === false` in the PATCH handler.
- **Evidence:**
  ```ts
  if (id === adminId && role) {
    throw new ForbiddenError('Cannot modify your own role');
  }
  // (but admin could set isActive=false on self)
  ```

### F-43 — `emailService.sendEmail` timeouts return `{ success: true }` in dev mode (false-positive) — Low
- **Location:** `backend/src/services/emailService.ts:212-218`
- **Observation:** When `config.email.enabled` is false (dev), function returns `{ success: true }` without sending. Silently marks verification/password-reset as sent. Auth flow will believe verification was sent; user never gets email. This is intentional for dev (dev team reads the log box) but means registration-success audit logs report sent email that wasn't.
- **Impact:** Dev only; intentional pattern. Noted for audit completeness.
- **Fix:** N/A.

### F-44 — `secureParsePdf` timeout 30s aligned with Claude 30s but no correlation ID — Info
- **Location:** `backend/src/utils/securePdfParsing.ts:18`; `backend/src/services/claudeExtraction.ts:54`
- **Observation:** Both PDF parse and Claude API have 30s timeouts. OCR also has 60s. Request flow for lab upload: upload → securePdfParsing (30s) → claudeExtraction (30s). Cumulative could exceed Cloud Run default 60s request timeout (depends on Cloud Run config).
- **Impact:** Request timeout risk on large PDFs. Not a security issue.
- **Fix:** N/A.

### F-45 — `useRBAC` hook derives role from `user.role` string; no server-side verify on UI-gated actions — Low
- **Location:** `src/hooks/useRBAC.ts:22`; `src/components/common/RoleGuard.tsx`
- **Observation:** `useRBAC` reads `user?.role` from auth context (client-side). Admin UI visibility depends on this. This is correct (defense-in-depth layer 1); the real enforcement is the backend `requireRole('ADMIN')` middleware in adminRoutes.ts. Both layers present.
- **Impact:** None — two-layer defense is correct.
- **Fix:** N/A.

## Checks passed
(grouped by prompt)

**Prompt 07 — Input validation:**
- UUID validation via `z.string().uuid()` — verified at `backend/src/middleware/validation.ts:123,243-254`.
- Password schema enforces uppercase/lowercase/number/special char/8+ min — verified at `validation.ts:128-134`.
- File upload: MIME type + size limit (10MB) — verified at `backend/src/routes/uploadRoutes.ts:30-66`, `insuranceRoutes.ts:37-49`.
- PDF magic bytes validated with `validatePdfHeader` — verified at `backend/src/utils/securePdfParsing.ts:56-104`.
- PDF timeout + memory bomb protection — verified at `securePdfParsing.ts:18-24`.
- Storage keys are `{userId}/{fileId}.{ext}` with UUIDs, not user-provided names — verified at `storageService.ts:53`.
- Zod validation applied before controller on all routes checked.
- `requireJsonContentType` middleware — verified at `validation.ts:201-228`, `app.ts:180`.
- Prompt-safe sanitizer for LLM-interpolated strings — verified at `validation.ts:55-61,91-95`.

**Prompt 08 — Rate limiting:**
- All 7 limiters exported from `rateLimiter.ts`: `standardLimiter`, `authLimiter`, `strictAuthLimiter`, `uploadLimiter`, `sensitiveLimiter`, `aiLimiter`, `bulkOperationLimiter` — verified at `rateLimiter.ts:7,26,41,63,78,93,112`.
- `strictAuthLimiter` on `POST /auth/login` — verified at `authRoutes.ts:48`.
- `strictAuthLimiter` on `/auth/forgot-password`, `/auth/reset-password` — verified at `authRoutes.ts:76,84`.
- `authLimiter` on all auth routes globally — verified at `authRoutes.ts:32`.
- `uploadLimiter` on all upload routes globally — verified at `uploadRoutes.ts:25`.
- `uploadLimiter` on `/insurance/upload-sbc` and `/insurance/plans/:id/reanalyze` — verified at `insuranceRoutes.ts:119,129`.
- `aiLimiter` on `/biomarkers/:id/guidance`, `/expenses/analyze`, `/health-needs/analyze`, `/health-goals/suggestions` — verified at `biomarkerRoutes.ts:110`, `expenseRoutes.ts:71`, `healthNeedsRoutes.ts:48`, `healthGoalsRoutes.ts:48`.
- `sensitiveLimiter` on `/settings/export-data`, `/settings/delete-data`, `/settings/delete-account` — verified at `settingsRoutes.ts:30,37,44`.
- `sensitiveLimiter` on `/admin/users/:id/permanent` — verified at `adminRoutes.ts:400`.
- `sensitiveLimiter` on `/files/:id/download` — verified at `fileRoutes.ts:45`.
- `bulkOperationLimiter` on `/biomarkers/batch` — verified at `biomarkerRoutes.ts:85`.
- `standardLimiter` registered globally — verified at `app.ts:166`.
- `aiLimiter` keyed by `user.id` for per-user cost protection — verified at `rateLimiter.ts:105-107`.
- `strictAuthLimiter` keyed by email+IP and `skipSuccessfulRequests:true` — verified at `rateLimiter.ts:53-60`.

**Prompt 09 — External APIs:**
- `ANTHROPIC_API_KEY` loaded from env; lazy-initialized — verified at `claudeExtraction.ts:50-57`, `sbcExtraction.ts:317-324`, `expenseController.ts:37-40`.
- Anthropic client has timeout (30s) + maxRetries (2) — verified at `claudeExtraction.ts:54`, `sbcExtraction.ts:321`, `expenseController.ts:39`.
- Claude abort controller timeout on biomarker guidance (30s) — verified at `biomarkerRoutes.ts:153-154`.
- `stripPHIFromText` applied to Claude lab extraction response — verified at `claudeExtraction.ts:159`.
- GCS signed URL expiration 15 min (short-lived) — verified at `storageService.ts:20,100-112`.
- File upload size limit before GCS send — verified at `ocrService.ts:48,129-133`.
- Document AI error cases handled (DEADLINE_EXCEEDED, PERMISSION_DENIED, NOT_FOUND, INVALID_ARGUMENT) — verified at `ocrService.ts:402-429`.
- SendGrid lazy-loaded — verified at `emailService.ts:33-48`.
- Email templates contain no PHI (verification/reset links only) — verified at `emailService.ts:57-194`.
- `FRONTEND_URL` used for email links — verified at `emailService.ts:260,282`.
- SendGrid 10s request timeout — verified at `emailService.ts:40`.

**Prompt 12 — CI/CD:**
- Actions pinned to major version (`actions/checkout@v4`, `google-github-actions/auth@v2`) — verified at `deploy.yml:20,23,29`, `ci.yml:21,25,44`.
- Secrets accessed via `${{ secrets.GCP_SA_KEY }}` only — verified at `deploy.yml:25,97`.
- No secrets echoed in logs (no `echo "$SECRET"` anywhere) — verified.
- Dockerfile multi-stage build (builder → production) — verified at `backend/Dockerfile:4,24`.
- Dockerfile uses `node:20-alpine` (pinned version, trusted source) — verified at `backend/Dockerfile:4`.
- Dockerfile non-root user (`nodejs:1001`) — verified at `backend/Dockerfile:43-44`.
- `npm ci --omit=dev` in production stage (no dev deps) — verified at `backend/Dockerfile:31`.
- `.dockerignore` excludes `.env`, `.git`, `node_modules`, tests, docs — verified at both `.dockerignore` files.
- Dockerfile HEALTHCHECK defined — verified at `backend/Dockerfile:48-49`.
- Cloud Run deploy uses SHA image tag, not :latest — verified at `deploy.yml:69`.
- Frontend build uses Vite with no source maps in prod (default Vite behavior) — verified at `deploy.yml:115`.
- Dependabot enabled for npm (weekly) + github-actions (monthly) — verified at `.github/dependabot.yml`.

**Prompt 13 — Dependencies:**
- `package-lock.json` present (implied by audit working).
- Security audit job runs in CI (line 92-112 of ci.yml).
- Critical deps present: `@prisma/client`, `jsonwebtoken`, `bcryptjs`, `helmet`, `express-rate-limit`, `zod`, `cookie-parser`.
- No GPL deps observed in direct deps.

**Prompt 30 — Admin:**
- All admin routes require `authenticate` + `requireRole('ADMIN')` via `router.use` — verified at `adminRoutes.ts:26-27`.
- Admin list users: password hashes NOT in `select` clause — verified at `adminRoutes.ts:58-73`.
- Admin view user: no password/salt fields in select — verified at `adminRoutes.ts:126-145`.
- Admin cannot self-delete (soft) — verified at `adminRoutes.ts:337-346`.
- Admin cannot self-permanent-delete — verified at `adminRoutes.ts:411-420`.
- Admin cannot modify own role — verified at `adminRoutes.ts:253-255`.
- Permanent delete requires email confirmation — verified at `adminRoutes.ts:435-444`.
- Permanent delete audit-logged BEFORE deletion — verified at `adminRoutes.ts:446-459`.
- Role changes audit-logged with previous+new role — verified at `adminRoutes.ts:293-312`.
- Deactivation invalidates sessions — verified at `adminRoutes.ts:383`.
- Audit log viewing is itself audit-logged — verified at `adminRoutes.ts:697-710`.
- Audit log pagination enforced (max limit via validation schema) — verified at `validation.ts:659`.
- Frontend admin gated by `useRBAC().canAccessAdminPanel` — verified at `useRBAC.ts:47`.
- `RoleGuard` + `AdminOnly` components wrap admin UI — verified at `RoleGuard.tsx:94-100`.

**Prompt 31 — Logging:**
- `SENSITIVE_FIELDS` set in `logger.ts` covers password, token, refreshToken, accessToken, secret, authorization-adjacent, email, PHI-encrypted fields — verified at `backend/src/utils/logger.ts:21-30`.
- `sanitizeData` recursion bounded by object structure — verified at `logger.ts:35-47`.
- Key matching is case-insensitive (`key.toLowerCase()`) — verified at `logger.ts:38`.
- Redaction sentinel `[REDACTED]` — verified at `logger.ts:39`.
- Production suppresses debug+info — verified at `logger.ts:54`.
- Format-string injection protection (`console.error('%s', formattedMessage)`) — verified at `logger.ts:67-76,115,126-129`.
- `logger.auth` only logs in non-production — verified at `logger.ts:104-108`.
- Frontend logger redacts PHI — verified at `src/utils/logger.ts:20-27`.

**Prompt 32 — Error handling:**
- Error handler registered last, after 404 — verified at `app.ts:226-229`.
- 404 handler routes to NotFoundError — verified at `errorHandler.ts:218-220`.
- Error handler signature `(err, req, res, next)` — verified at `errorHandler.ts:138-143`.
- AppError subclasses defined: `BadRequestError`, `UnauthorizedError`, `AuthenticationError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`, `RateLimitError`, `InternalServerError`, `ServiceUnavailableError`, `DatabaseError`, `ExternalServiceError` — verified at `errorHandler.ts:29-102`.
- Prisma errors translated to generic messages — verified at `errorHandler.ts:108-123`.
- JWT errors translated — verified at `errorHandler.ts:126-134`.
- Response shape matches `ApiResponse` (`{ success: false, error: { code, message } }`) — verified at `errorHandler.ts:203-212`, types `index.ts:139-154`.
- 5xx logged at error, 4xx logged at warn (dev only) — verified at `errorHandler.ts:194-200`.
- `asyncHandler` wraps async routes — verified at `errorHandler.ts:223-229` and used throughout route files.
- Frontend `getUserFriendlyMessage` handles 401/403/404/500/etc. — verified at `src/services/api/client.ts:63-88`.
- Frontend 401 triggers auth callback for logout — verified at `client.ts:187-194,206-213`.

## Unverifiable
- **Claude monthly cost cap math** (prompt 08 Q4) — no usage cap visible in code; `aiCostTracker.ts` only logs, doesn't throttle or alert. Need external billing config or log-based alert to verify.
- **Cloud Logging retention policy** (prompt 31 §9) — infra config, not in repo.
- **BAA with third-party APMs** (prompt 31 §9) — no APM integration visible in code; would need to check GCP billing/accounts.
- **Log-based alerts for failed logins / 5xx spikes** (prompt 32 Q4) — infra config, not in repo.
- **Login timing-attack defense specifics** (prompt 32 §8) — `authService.ts` not read in full; `attemptLogin` logic would need inspection to confirm `bcrypt.compare` is always called (not short-circuited on user-not-found).
- **Cloud Run request timeout vs internal 30+30s chain** (F-44) — GCP infra config.
- **GCP Artifact Registry / Cloud Run service account IAM scope** (prompt 12 §8) — infra config. deploy.yml passes `credentials_json: ${{ secrets.GCP_SA_KEY }}` but actual IAM roles need GCP console check.
- **Branch protection rules on `master`/`main`** (prompt 12 §7) — GitHub settings, not in repo.
- **npm ls deprecated packages check** — `npm ls` wasn't executed; audit alone covers CVEs not deprecations.

## Prompt drift
- **Prompt 08 §3** references "6 named rate limiters" in `CLAUDE.md` but the actual codebase has **7** limiters (including `bulkOperationLimiter`). Prompt 08's checklist correctly says 7; the `CLAUDE.md` top-of-file comment is stale.
- **Prompt 30** references `src/services/api/admin.ts` but the file list in `CLAUDE.md` confirms it exists (`services/api/admin.ts`). Verified in `CLAUDE.md` project structure. No drift.
- **Prompt 12 §10** claims `ci.yml` uses Node 20 LTS — confirmed (`ci.yml:11`: `NODE_VERSION: '20'`). Prompt claims backend runs Jest, but actual `backend/package.json:11` uses Vitest (`"test": "vitest run"`). Jest is not a backend test framework here; both frontend and backend use Vitest. Minor drift in prompt 12 checklist reference to backend "Jest" — should be Vitest.
- **`CLAUDE.md` middleware stack** lists "Cookie Parser" step 3 and "CSRF Protection" step 4 and "Rate Limiting" step 5. Actual order in `app.ts` is: Helmet → CORS → cookieParser (line 157) → csrfProtection (162) → standardLimiter (166) → morgan (169/172) → body-parser (176/177) → requireJsonContentType (180) → routes. Matches prompt order. No drift.
- **Prompt 30 §6** says "demoProtection.ts middleware blocks admin operations for demo users" — but F-5 above shows `blockDemoAdminAccess` is never attached. Prompt assumption is incorrect or documents intended-but-unbuilt behavior.

---

Report length: 45 findings, ~4,750 words.
