# OwnMyHealth — Full Project Analysis

_Generated 2026-05-29 via multi-agent workflow (13 dimension finders → adversarial per-finding verification → synthesis). 109 agents, 95 raw findings, 94 confirmed, 1 refuted._

## Overall grade

**C+ — Strong cryptographic and architectural foundations undercut by multiple designed-but-unwired security controls (token revocation, RLS provider backstop, PDF DoS guard) and several fail-open compliance paths; no single finding is a trivially-remote-exploitable PHI dump today, but the defense-in-depth is largely theater until the wiring gaps close.**

## Executive summary

OwnMyHealth has a solid, security-conscious skeleton (per-user AES-256-GCM PHI encryption, RLS policies, CSRF double-submit, BAA gating on Anthropic, audit logging), but the audit surfaces a recurring and dangerous pattern: security controls that are DESIGNED but not actually WIRED INTO the live path. The most consequential examples are (1) token revocation on logout/password-change is a no-op because route middleware calls jwt.verify() directly and never consults the blacklist; (2) the RLS provider-consent backstop is doubly defeated — the has_provider_access() function references a dropped column (would throw under a real NOBYPASSRLS role) AND provider PHI reads run under admin-bypass context anyway; (3) the PDF-bomb DoS guard (secureParsePdf) is only on the dead regex fallback, not the live Claude path; (4) a legacy endpoint still mints unbound 15-min GCS signed URLs the redesign was meant to kill; (5) morgan('combined') logs verification/reset tokens to Cloud Logging in clear; (6) there is no AI spend ceiling; (7) SendGrid sandbox mode can silently swallow all auth emails in prod; (8) the HIPAA data export omits the self-reported health profile and audit writes fail open. A cluster of frontend defects breaks expense/insurance flows (un-enveloped responses returning undefined, refresh wired to the wrong callback, plan.benefits/costs crashing the whole app via a single top-level ErrorBoundary). There is also dependency debt (axios/GCS/express CVEs) and pervasive doc rot in CLAUDE.md. Two fully-built backend features (SMART-on-FHIR lab sync, doctor-ready PDF/CSV export) ship with zero frontend wiring — high-value, already-paid-for work to surface. For a solo dev, the right sequence is: kill the live PHI-egress and auth-revocation gaps first, then the compliance fail-open paths, then the app-breaking frontend bugs, then quick-win dependency bumps and doc fixes, then feature surfacing.

## Counts

- By severity: **16** high, **33** medium, **33** low, **12** info
- By category: 24 bug, 7 compliance, 10 dependency, 6 feature, 23 security, 6 infra, 17 quality, 1 test

## Systemic themes

- Designed-but-unwired security controls: the dominant systemic theme — token revocation (no-op), RLS provider backstop (broken function + admin bypass), PDF DoS guard (only on dead fallback), redactPatientBanner (dead code) are all written and documented as protective but never reach the live path. The audit's biggest message is 'verify wiring, not just presence.'
- Fail-open compliance paths: audit writes swallow failures, encryptValue writes a fake ciphertext sentinel, SendGrid sandbox silently drops auth emails, decrypt failures silently null PHI in exports, and the export omits the health profile — each lets a HIPAA-relevant operation appear successful while losing integrity/availability.
- Response-contract & data-shape mismatches break the frontend: un-enveloped expense bodies → undefined, wrong refresh callback, undefined plan.benefits/costs crashing under a single global ErrorBoundary — a cluster of high-blast-radius frontend defects from inconsistent backend/frontend contracts.
- Defense-in-depth that is per-instance/in-memory and degrades under Cloud Run autoscale: rate limiters, token blacklist, and audit-retention/cleanup intervals all assume a single long-lived process; scale-to-zero and max-instances multiply or skip them. Shared external state (Redis/Memorystore, Cloud Scheduler) is the structural fix.
- Dependency & supply-chain debt: real CVEs reachable through axios (SendGrid), GCS/protobufjs, express/qs, plus abandoned majors (pdf-parse, bcryptjs) and audit-fix footguns (phantom Prisma/GCS downgrades) — mostly in-range bumps or overrides, but require care to avoid auto-downgrades.
- Validation-boundary inconsistency: most endpoints validate with Zod but a few PHI-adjacent/financial mutations (spending) and FHIR :id params skip it, and several controllers use JS-truthiness (0 treated as absent) where the schema explicitly allows 0.
- Documentation rot as an operational hazard: CLAUDE.md/README/prompts list non-existent env vars (JWT_SECRET/CSRF_SECRET) that would fail boot, wrong test runner, dropped DNA models, stale structure/counts — actively misleads a solo dev and any future contributor.
- Built-but-unsurfaced product value: complete SMART-on-FHIR lab sync and doctor-ready PDF/CSV export exist server-side with zero frontend wiring — high ROI features already paid for.
- Accessibility & UX polish gap: no dialog/menu ARIA or focus management, bespoke modals duplicating logic, email-only notifications, email-local-part greeting, unstratified reference ranges — credible for a HIPAA product expected to be broadly accessible and trustworthy.

## Top 10 priorities (ranked by risk × impact)

### P1. Remove the legacy signed-URL PHI egress and route all PDF parsing through the DoS guard  `[high · effort S]`

**Files:** `backend/src/controllers/fileController.ts:126-195; backend/src/services/pdfTextExtraction.ts:35-68; backend/src/services/storageService.ts; src/services/api/files.ts`  

**Why it matters:** Two distinct live PHI/availability holes the codebase already 'fixed' elsewhere but left reachable: GET /files/:id still mints an unbound 15-min GCS signed URL for raw lab/SBC PDFs (capturable from logs/history with no auth, no rate limit), reintroducing exactly the capture-replay vector the proxied-stream redesign removed; and the primary Claude upload path calls pdfParse() directly with no timeout/heap guard, so a crafted 10MB PDF bomb can hang the event loop / OOM the Cloud Run instance, while secureParsePdf only protects the dead regex fallback.

**Action:** In fileController.getFile drop the getSignedUrl('read') call and the downloadUrl field (return metadata only); remove the now-unused getSignedUrl read path and filesApi.getById. Route pdfTextExtraction.extractTextFromPDF through secureParsePdf (or wrap pdfParse in the same withTimeout + 100MB heap-delta guard) so the primary upload path regains DoS protection.

### P2. Make token revocation actually enforce on protected routes (logout / logout-all / password-change / deactivate)  `[high · effort M]`

**Files:** `backend/src/middleware/auth.ts:70-201; backend/src/services/authService.ts:139-148,302-319; backend/src/controllers/authController.ts:515-525`  

**Why it matters:** authenticate()/requireBearerAuth()/optionalAuth() call jwt.verify() directly and never consult the revokedTokens blacklist (only verifyAccessToken does, and it guards no route). A logged-out, logout-all, admin-deactivated, or post-password-change access token keeps authenticating every PHI endpoint for up to its full 15-min lifetime, directly violating HIPAA session-termination expectations and contradicting the code's own 'force re-login on all devices' claim.

**Action:** Have the route-protection middleware call authService.verifyAccessToken() (which already checks the blacklist + validates type) instead of jwt.verify(). Because the blacklist is per-instance/in-memory, move revocation to a shared store (Redis/Memorystore) for multi-instance correctness and store jti+exp with a sweep on the existing cleanup interval to fix the unbounded-growth leak. Also pass isDemoUser() to setRefreshTokenCookie in changePassword.

### P3. Stop logging raw request URLs (verification/reset tokens) in production  `[high · effort S]`

**Files:** `backend/src/app.ts:221-226; backend/src/services/emailService.ts:273,295; backend/src/routes/authRoutes.ts:60-64`  

**Why it matters:** app.use(morgan('combined')) in production writes full request lines incl. query strings to stdout → Cloud Logging, bypassing the logger PHI sanitizer entirely. Single-use email-verification and password-reset tokens travel as ?token=... query params, so anyone with prod log read access (broad in most GCP setups, plus exports/SIEM) can harvest live tokens and take over accounts.

**Action:** Replace morgan in prod with a custom token/format that logs only req.path (strip query string), or emit a structured access log via utils/logger.ts which already sanitizes. Independently, move single-use tokens out of query strings into POST bodies so they never appear in any URL/proxy/browser-history log.

### P4. Close the SendGrid sandbox-in-prod trap and make audit writes fail closed  `[high · effort M]`

**Files:** `backend/src/config/index.ts:139-140,278-364; backend/src/services/auditLog.ts:204-250`  

**Why it matters:** Two silent fail-open compliance gaps. (a) config.email.sandboxMode has no prod hard-fail; if SENDGRID_SANDBOX_MODE=true leaks into prod (copied staging env), every verification/reset email is silently dropped while the app reports success — new users can never verify, locked-out users can never reset. (b) AuditLogService.log() catches DB-write failures and only logs.error without re-throwing, so PHI access/mutations complete with no durable audit record despite the header comment claiming it never fails silently — violates HIPAA §164.312(b).

**Action:** In the config.isProduction branch, throw if SENDGRID_SANDBOX_MODE==='true' (or compute sandboxMode = (...) && !isProduction). In auditLog.log(), re-throw on failure for create/update/delete/export audits (fail closed), or write the audit row inside the same RLS transaction as the PHI op; keep read-audits best-effort but distinguish them.

### P5. Fix the un-enveloped expense responses that resolve to undefined on the client  `[high · effort S]`

**Files:** `backend/src/controllers/expenseController.ts:117,234,372,493,704,756`  

**Why it matters:** createProjection/updateProjection/createActual/updateActual/analyzeCosts/getAnalyses return BARE bodies while getProjections/getActuals (and every other controller) return { success, data }. The frontend client does response.data on the whole body, so every create/update, the AI cost analysis, and the analyses list resolve to undefined — silently breaking optimistic UI and the analysis display for a paid AI feature.

**Action:** Wrap all six handlers in the standard { success: true, data: <payload> } envelope and add a contract test asserting response shape across expense endpoints.

### P6. Add an AI spend ceiling / circuit breaker and gate the ungated Claude routes  `[high · effort M]`

**Files:** `backend/src/services/aiCostTracker.ts:32-44; backend/src/routes/insuranceRoutes.ts:115-134; backend/src/routes/expenseRoutes.ts:109-116`  

**Why it matters:** trackAIUsage only logs estimated cost; nothing enforces a budget. The only controls are in-memory per-instance rate limiters (multiplied ~3x under Cloud Run autoscale), and SBC upload/reanalyze (Sonnet, 16k tokens) and /expenses/analyze have NO requirePlanLimit gating even though plan limits exist; PRO/ENTERPRISE are -1 (unlimited). A compromised key, buggy client loop, or abusive paid account can run up unbounded Anthropic charges with no automatic stop.

**Action:** Maintain a rolling aggregate cost counter (Postgres/Memorystore) keyed global + per-user and refuse new Claude calls past a configured daily/monthly USD budget (503 + audit). Gate SBC routes behind requirePlanLimit('pdfUploadsPerMonth') and /expenses/analyze behind requirePlanLimit('costAnalysisPerMonth'). Add a GCP billing/log-based alert on estimatedCostUsd as a backstop.

### P7. Repair the RLS provider-consent backstop (broken function + admin bypass)  `[high · effort L]`

**Files:** `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:39-62; backend/prisma/migrations/20260423_drop_dna_genetics/migration.sql:28; backend/src/routes/providerRoutes.ts:283-587; backend/src/services/database.ts:243-261`  

**Why it matters:** The DB-layer consent backstop for cross-tenant provider PHI access is doubly defeated: has_provider_access() still references pp.can_view_dna, a column a later migration dropped, so under any real NOBYPASSRLS role the function throws for ANY permission_type and breaks provider reads; and provider PHI reads currently run under withRLSContext(null,{isAdmin:true}), which short-circuits all RLS filtering, making hand-written app-layer checks the SOLE isolation boundary with no DB backstop. Masked today only because dev/staging run as BYPASSRLS superuser.

**Action:** Add a migration CREATE OR REPLACE FUNCTION has_provider_access(...) removing the view_dna branch and the dead OR clauses. Move provider PHI reads to withRLSContext(providerId,...) and add a users SELECT policy permitting a provider to read {id,email} of a consented patient. Provision a NOBYPASSRLS role in CI/staging and extend rls.test.ts to exercise the provider-access path so this class of breakage surfaces before prod cutover.

### P8. Harden the HIPAA data export and the unprotected frontend crash/PHI paths  `[high · effort M]`

**Files:** `backend/src/controllers/settingsController.ts:286-313; src/utils/insurance/insuranceUtils.ts:188-194; src/components/biomarkers/BiomarkerInsurancePanel.tsx:213,519; src/App.tsx:276-295`  

**Why it matters:** The §164.524 right-of-access export omits the entire self-reported UserHealthProfile (conditions, medications, family history, etc.) — getDecryptedHealthProfile is already imported, so the data is trivially available; a request fulfilled via this export is non-compliant. Separately, BiomarkerInsurancePanel/BiomarkerActionPlan iterate plan.benefits/plan.costs (which transformPlanForDisplay can return undefined) and the single top-level ErrorBoundary white-screens the whole PHI dashboard on any such throw.

**Action:** Add healthProfile to the export (ExportData + frontend UserExportData) and to the export audit metadata. Coerce transformPlanForDisplay benefits/costs to [] and add (plan.benefits ?? []) guards at access sites. Wrap the dashboard page switch and DashboardModals in their own ErrorBoundary.

### P9. Add a runtime BAA gate for Google Document AI (image OCR PHI egress)  `[medium · effort S]`

**Files:** `backend/src/services/ocrService.ts:263-292`  

**Why it matters:** Image OCR base64-encodes raw upload bytes (full demographics in pixels, unreachable by text/banner redaction) and ships them to Google Document AI with NO BAA/runtime gate, unlike every Anthropic call which hard-fails unless ANTHROPIC_BAA_ACTIVE=true. A misconfigured deploy could disclose PHI to a non-covered processor.

**Action:** Add a GOOGLE_BAA_ACTIVE / DOCUMENT_AI_ENABLED gate mirroring the Anthropic C-7 gate, fail closed in production if unset, and document Google Cloud BAA coverage for Document AI in SECURITY_STATUS.

### P10. Fix the insurance/health-goal/scheduler correctness bugs that silently corrupt data and UX  `[medium · effort M]`

**Files:** `src/components/dashboard/Dashboard.tsx:211-218; backend/src/controllers/expenseController.ts:525-554; backend/src/controllers/biomarkerController.ts:483; backend/src/controllers/healthGoalsController.ts:380-506; backend/src/schedulers/emailScheduler.ts:173-244`  

**Why it matters:** A cluster of medium bugs degrade data integrity and core UX: InsuranceHub onRefresh is wired to refreshBiomarkers so newly added plans never appear without reload; PUT /plans/:id/spending writes unvalidated body into Decimal PHI columns (500 or silent corruption feeding AI projections); bulkCreateBiomarkers drops legit normal-range min/max of 0 via falsy check; createHealthGoal treats currentValue 0 as absent and updateHealthGoal never recomputes progress on target change; the hourly plan-expiring scheduler sends up to 24 duplicate emails; several SBC-upload UI panels (key-terms, duplicate-filename results) never render or misattribute.

**Action:** Expose refreshInsurancePlans() and pass it to InsuranceHub. Add a Zod schema to the spending route. Use presence/finiteness checks instead of truthiness in bulkCreateBiomarkers and createHealthGoal; recompute progress on target change; clear completedAt on revert. Gate the plan-expiring sweep behind a once-per-day key. Fix EnhancedInsuranceUpload keyTerms/value/category and use stable per-file UUID keys.

## Quick wins (high value, effort S)

- Delete the stray 'nul' device-named file and scratchpad.md.md from repo root (Windows-tooling hazard / clutter). Effort S.
- Bump in-range/override dependency patches in one pass: express@^4.22.2 (qs DoS), express-rate-limit@^8.5.2 (ip-address SSRF), and an overrides entry forcing axios>=1.16 (SendGrid CVE-2025-62718). Re-run npm audit. Do NOT run npm audit fix --force (it phantom-downgrades Prisma 7→6 and GCS 7→5). Effort S.
- Add a MulterError branch to errorHandler mapping LIMIT_FILE_SIZE→413 and other codes→400, and convert the PDF fileFilter rejection to a 400, so over-size/wrong-type uploads stop surfacing as 500s. Effort S.
- Wrap the six expense controller handlers in the standard { success, data } envelope (fixes undefined on the client for create/update/analyze/list). Effort S.
- Fix InsuranceHub onRefresh to refresh insurance plans (not biomarkers) so newly added plans appear without a page reload. Effort S.
- Coerce transformPlanForDisplay benefits/costs to [] and add (plan.benefits ?? [])/(plan.costs ?? []) guards in BiomarkerInsurancePanel/BiomarkerActionPlan to stop full-app white-screens. Effort S.
- Replace falsy checks with presence/finiteness checks: bulkCreateBiomarkers normal-range 0, createHealthGoal currentValue 0 (and recompute progress on target change). Effort S.
- Add a Zod schema to PUT /insurance/plans/:id/spending and validate(schemas.uuidParam) to the FHIR sync/disconnect routes. Effort S.
- Hard-fail in config when SENDGRID_SANDBOX_MODE==='true' in production. Effort S.
- Bump biomarkersApi.getGuidance to a 60s timeout to match other AI endpoints. Effort S.
- Add rel="noopener noreferrer" to RegisterPage Terms/Privacy links and 'noopener' to FilesPage window.open(blobUrl); add the eslint react/jsx-no-target-blank rule. Effort S.
- Fix CLAUDE.md/README/prompts/35-env-vars-doc.md: correct env-var names (JWT_ACCESS_SECRET/JWT_REFRESH_SECRET/EMAIL_FROM/GCP_PROJECT_ID/RATE_LIMIT_MAX_REQUESTS, drop CSRF_SECRET), Vitest-not-Jest, remove DNA-models section, fix rate-limiter count (8) and structure tree — align to the already-correct ENV_VARS.md. Effort S.
- Add gitleaks/trufflehog secret-scanning to the CI security job and pre-commit hook (backend/.env holds real secrets in the working tree; one git add -f would leak them). Effort S.
- Generate the gradient/normalRange IDs in TrendSparkline with useId() instead of Date.now() to stop duplicate-id gradient bleed. Effort S.
- Send a best-effort 'account/data deleted' confirmation email on deleteAccount/deleteAllData. Effort S.

## Upgrade & remediation roadmap

- Phase 0 — Stop active PHI/auth/availability bleeding (days 1-3): remove the legacy signed-URL egress + route PDF parsing through secureParsePdf (P1); strip query strings from prod access logs and move tokens to POST bodies (P3); enforce token revocation in route middleware (P2). These are the items with the smallest fix surface and the largest exploit/exposure reduction.
- Phase 1 — Close fail-open compliance paths (week 1): SendGrid sandbox prod hard-fail + audit-write fail-closed (P4); add Document AI BAA gate (P9); add health profile to the HIPAA export (P8); add an aggregate decrypt-failure alert and stop persisting the [ENCRYPTION_FAILED] sentinel; validate AUDIT_LOG_SALT as hex and guard non-empty systemSalt.
- Phase 2 — Fix app-breaking frontend + correctness bugs (week 1-2): expense response envelopes (P5); plan.benefits/costs guards + granular ErrorBoundary (P8); InsuranceHub refresh callback, spending-route validation, bulkCreate/health-goal truthiness, plan-expiring dedup, SBC-upload UI panels (P10); TrendSparkline useId.
- Phase 3 — Dependency & supply-chain debt (week 2): in-range bumps + axios override now (quick win); then update @google-cloud/storage within 7.x with protobufjs/fast-xml-builder overrides (verify GCS upload/download); migrate pdf-parse→2.x (removes @ts-expect-error and abandoned dep, revalidate MIN_USABLE thresholds); bcryptjs→3, uuid→11; add CI secret scanning; document the phantom Prisma/GCS audit-fix downgrades as known false-positives so a CI audit gate never auto-downgrades.
- Phase 4 — Structural resilience (week 3): back strictAuthLimiter/authLimiter/aiLimiter with rate-limit-redis on Memorystore and add a real AI spend ceiling (P6); move audit-retention cleanup to Cloud Scheduler with a lock; add a CI guard that fails if --max-instances rises while the limiter store is MemoryStore.
- Phase 5 — RLS hardening (week 3-4): migrate has_provider_access() to drop the view_dna reference, move provider reads to provider RLS context with a scoped users SELECT policy, provision a NOBYPASSRLS role in CI/staging, and extend rls.test.ts to cover the provider-access path (P7). Treat as L because it touches the most sensitive cross-tenant boundary and needs live-DB regression coverage before prod cutover.
- Phase 6 — Documentation & hygiene (anytime, batch with above): fix CLAUDE.md/README/prompts env-var names, test runner, DNA section, structure counts; delete nul and scratchpad.md.md; remove dead exports (uploadApi/adminApi/patientApi/providerApi/RoleGuard/useRBAC/InsuranceGuide) or wire RBAC UI gating, and add knip/ts-prune to CI to prevent regrowth.
- Phase 7 — Surface built features & UX/a11y (week 4+): SMART-on-FHIR connections panel (with the FHIR SSRF/token-exfil hardening as a prerequisite), doctor-ready PDF/CSV export, Modal ARIA/focus-trap rollout, then sex/age-stratified ranges, notification channels, greeting and input-validation polish.
- Cross-cutting — Larger framework upgrades on dedicated branches with full Playwright E2E, deferred until the above ships: zod 3→4 (codemod + retest all API-boundary schemas), React 18→19 (+@types, @vitejs/plugin-react 6), then high-effort Tailwind 3→4 and Express 4→5; keep Prisma on 7.x throughout.

## Feature recommendations

- Surface the fully-built SMART-on-FHIR lab-sync subsystem: add a frontend FHIR API module (connect/list/sync/disconnect), a 'Connected Labs' settings panel with last-sync/manual-sync, and a 'Connect your lab (Quest)' onboarding option that kicks off the OAuth redirect. Unlocks already-paid-for backend work (~1-2 days). Pair with the FHIR SSRF/token-exfil hardening (validate next/discovery URLs, https + host allowlist, block private/link-local) before exposing it.
- Wire the existing doctor-ready PDF report generator and CSV export into the UI: add a 'Share with your doctor (PDF)' / 'Download CSV' action on TrendsPage and/or the Data & Privacy settings section, pre-filling patientName from the profile. High value, ~3-4 hours.
- Add sex/age-stratified biomarker reference ranges: extend measurementOptions.json to optional normalRangesBySex/age variants and resolve the applicable range from the user's collected biologicalSex/ageRange when classifying in/out-of-range — fixes mislabeled 'Needs Attention' counts for sex-sensitive markers (Phase 1: ~10 markers, ~1-2 days incl. sourcing).
- Add dialog/menu ARIA + focus management to the shared Modal (role=dialog, aria-modal, focus trap, focus restore) and arrow-key/aria-expanded handling to the TrendsPage dropdowns; migrate the bespoke AddMeasurement/TrendDetail/delete-confirmation modals onto it so Escape/scroll-lock/backdrop-dismiss/ARIA come for free (~1 day + incremental adoption).
- Expand notification preferences beyond email-only: add an in-app notification center and a channel dimension (email/in-app/push) in the existing notificationPreferences JSON, plus weekly-summary cadence/day controls (~half a day for cadence, ~2-3 days for the in-app surface).
- Polish the dashboard greeting to use the saved profile firstName (falling back to the shared getGreetingName helper) instead of the raw email local-part, for a consistent first impression (~1-2 hours).
- Add light clinical input validation to AddMeasurementModal: per-biomarker plausibility bounds / reject non-positive where impossible, validate min<max in the custom range editor with inline error, and a confirm step for far-out-of-range values (~3-4 hours).

---

## All confirmed findings (94)


## HIGH severity

### 1. [bug] Expense create/update/analyze endpoints return un-enveloped bodies; frontend reads response.data and gets undefined

- **Location:** `backend/src/controllers/expenseController.ts:117,234,372,493,704,756`
- **Issue:** getProjections (line 178) and getActuals (line 422) were updated to return the standard envelope { success, data, pagination }, but createProjection, updateProjection, createActual, updateActual, analyzeCosts, and getAnalyses still return BARE bodies. createProjection does `res.status(201).json(decrypted)` (line 117), updateProjection `res.json(decrypted)` (234), createActual (372), updateActual (493), analyzeCosts `res.json({ id, analysisDate, claudeResponse, ... })` (704), and getAnalyses `res.json(decrypted)` (a bare array, 756). The frontend client treats the entire HTTP body as ApiResponse<T> (`return data as ApiResponse<T>` in src/services/api/client.ts:346) and every expenses API method does `return response.data` (src/services/api/expenses.ts:131,145,179,190,213,223). Because these bare bodies have no top-level `data` key, `response.data` is `undefined`. So creating/updating a projection or actual, running a cost analysis, or listing analyses all resolve to `undefined` on the client instead of the created/updated record or list — breaking optimistic UI updates and the analysis display.
- **Fix:** Wrap all six handlers in the same `{ success: true, data: <payload> }` envelope used by getProjections/getActuals and by every other controller (e.g. insuranceController, healthGoalsController), so the frontend's `response.data` resolves correctly. Add a contract test asserting the response shape.

### 2. [bug] Adding an insurance plan in InsuranceHub never refreshes the plan list (wrong refresh callback)

- **Location:** `src/components/dashboard/Dashboard.tsx:211-218`
- **Issue:** InsuranceHub is wired with onRefresh={refreshBiomarkers}. When a user adds a plan via AddInsurancePlanModal, InsuranceHub.handlePlanAdded() calls onRefresh?.() expecting the insurance plan list to reload. But refreshBiomarkers (useBiomarkerData.ts:202-218) only calls biomarkersApi.getAll() — it never re-fetches insurance plans. The same wrong callback is used after CostOptimization mutations and after AddPlan in the empty state. Result: a newly created/saved insurance plan does not appear in the My Plans list (and cost analysis) until a full page reload. Note that for plans created via SBC upload (handleInsurancePlanExtracted) the new plan is pushed into local state, so this gap specifically bites the AddInsurancePlanModal path which relies entirely on onRefresh.
- **Fix:** Expose a refreshInsurancePlans() from useBiomarkerData (re-running insuranceApi.getPlans + transformPlanForDisplay) and pass that as InsuranceHub's onRefresh, or have onRefresh trigger both biomarker and insurance refetches.

### 3. [bug] BiomarkerInsurancePanel / BiomarkerActionPlan iterate plan.benefits and plan.costs without guards (crash to full-app error screen)

- **Location:** `src/components/biomarkers/BiomarkerInsurancePanel.tsx:213,219,519`
- **Issue:** These components assume every insurance plan has populated benefits/costs arrays. Line 519 `for (const benefit of plan.benefits)` throws 'undefined is not iterable' and lines 213/219 `plan.costs.find(...)?.amount` throw 'Cannot read properties of undefined' when a plan's benefits/costs are undefined (see transformPlanForDisplay finding). BiomarkerActionPlan.tsx:664 has the same `plan.benefits.filter(...)` hazard and is rendered inline in CategoryContent (not a modal) when a user expands an out-of-range biomarker with insurance plans present. Because the only ErrorBoundary in the app wraps the entire tree at App.tsx:278, an exception here white-screens the whole dashboard ('Something went wrong'), discarding all in-memory state.
- **Fix:** Default to empty arrays at the access sites: `(plan.benefits ?? [])` and `(plan.costs ?? [])`. Fixing transformPlanForDisplay (previous finding) removes the root cause; add these guards as defense in depth.

### 4. [compliance] SENDGRID_SANDBOX_MODE has no production hard-fail — silently swallows all verification/password-reset emails

- **Location:** `backend/src/config/index.ts:139-140`
- **Issue:** config.email.sandboxMode resolves to `process.env.SENDGRID_SANDBOX_MODE === 'true' || isStagingEnv`. There is NO guard that rejects or warns when SENDGRID_SANDBOX_MODE=true is set in production. The production/staging validation block (lines 278-364) validates JWT, PHI key, demo, GCS bucket, CORS, and BAA, but never inspects sandbox mode. In emailService.sendEmail (emailService.ts:246-253) sandbox mode adds `mailSettings: { sandboxMode: { enable: true } }`, SendGrid validates but never delivers, and the function still returns `{ success: true }` and logs 'Email validated (sandbox)'. If an operator copies a staging env or sets the flag by mistake in the prod Cloud Run service, every account-verification and password-reset email is silently dropped while the app reports success. New users can never verify and locked-out users can never reset — a self-inflicted denial of the access-management controls HIPAA expects, with zero error surfaced to user or ops.
- **Fix:** In the `config.isProduction` branch of config/index.ts, hard-fail (throw) if `process.env.SENDGRID_SANDBOX_MODE === 'true'`. Sandbox mode must be impossible in production. Alternatively, make sandboxMode = `(SENDGRID_SANDBOX_MODE==='true' || isStagingEnv) && !isProduction` so production can never enter sandbox even if the env var leaks in.

### 5. [compliance] PHI read/write proceeds even when the audit-log write fails — audit completeness gap (HIPAA §164.312(b))

- **Location:** `backend/src/services/auditLog.ts:204-250`
- **Issue:** AuditLogService.log() wraps the auditLog.create() in try/catch and on failure only calls logger.error — it does NOT re-throw. The header comment claims 'Never fail silently on audit logging - this is critical for compliance', but the implementation does exactly that: the promise resolves normally. Controllers `await auditService.logAccess/logCreate/...` after fetching/decrypting PHI (e.g. biomarkerController.ts:160, 215) and then return the PHI to the client. Because the awaited audit call never rejects, a failed audit DB write (transient DB error, RLS misconfig, connection exhaustion) lets the PHI access complete with NO durable audit record. HIPAA audit controls require that PHI access be logged; here the log is best-effort and the operation is not blocked or queued for retry, so audit gaps are invisible except in application logs (which are not the 7-year immutable audit store).
- **Fix:** For mutating/PHI-access operations, either (a) re-throw on audit failure so the request fails closed, or (b) write the audit entry inside the same withRLSTransaction as the PHI operation so a failed audit rolls back the data change, or (c) push failed entries to a durable retry queue and alert. At minimum, distinguish recoverable read-audit best-effort from create/update/delete/export audits which must be transactional.

### 6. [compliance] Data export omits the self-reported Health Profile (conditions, medications, family history) — incomplete HIPAA right-of-access

- **Location:** `backend/src/controllers/settingsController.ts:286-313,329-682`
- **Issue:** The 'Export All My Data' feature is the user's HIPAA §164.524 right-of-access mechanism and is meant to return ALL of the user's PHI. The export assembles biomarkers, insurance, goals, needs, expenses, cost analyses, files, and provider relationships — but never includes the UserHealthProfile (biologicalSex, ageRange, conditions, medications with purposes, familyHistory, smokingStatus, exerciseLevel, additionalContext). This is encrypted PHI the user explicitly entered (HealthProfileSection.tsx) and which feeds the AI. getDecryptedHealthProfile() is already imported in this controller for the profile endpoints, so the data is trivially available. The frontend UserExportData type (src/services/api/settings.ts:132-168) likewise has no healthProfile field. Result: a user who exports their data to switch providers or audit what is stored gets an incomplete record, and a HIPAA right-of-access request fulfilled via this export would be non-compliant.
- **Fix:** Add the decrypted health profile to the export: call getDecryptedHealthProfile(userId) in exportUserData, add a `healthProfile: UserHealthProfile` field to ExportData (backend) and UserExportData (frontend), and include condition/medication counts in the export audit-log metadata. Effort: ~1-2 hours.

### 7. [dependency] axios SSRF / NO_PROXY-bypass (CVE-2025-62718) reachable through @sendgrid/mail

- **Location:** `backend/package.json:23`
- **Issue:** @sendgrid/mail@8.1.6 pulls in @sendgrid/client which pins axios@1.15.0. npm audit flags this version as 'high' for the incomplete fix of CVE-2025-62718 (NO_PROXY bypass via RFC-1122 loopback subnet 127.0.0.0/8, GHSA-pmwg-cvhr-8vh7, CVSS 7.2) plus three moderate/low prototype-pollution and null-byte advisories. The vulnerable axios is the HTTP client used to call the SendGrid API for verification and password-reset email, so it sits in an auth-adjacent code path. A maintained fix exists (axios >=1.15.2 / 1.16.x). The vulnerable range is 1.0.0 - 1.15.2 and the installed version is exactly 1.15.0.
- **Fix:** Bump @sendgrid/mail/@sendgrid/client to a release that depends on axios >=1.15.2, or add an npm override forcing axios to a patched version (e.g. "overrides": { "axios": "^1.16.0" }). Re-run `npm audit` to confirm the axios advisories clear.

### 8. [dependency] @google-cloud/storage 7.19.0 ships vulnerable protobufjs / fast-xml-builder / gaxios (8 high+moderate advisories) _(verifier: severity adjusted from high)_

- **Location:** `backend/package.json:20`
- **Issue:** @google-cloud/storage@7.19.0 (used for lab-report / SBC file storage and signed URLs) transitively pulls protobufjs<=7.5.7, fast-xml-builder<=1.1.6, gaxios 6.7.1, teeny-request 9.0.0 and retry-request 7.0.x. protobufjs has multiple HIGH advisories including code injection through bytes-field defaults (GHSA-66ff-xgx4-vchm) and a code-generation gadget after prototype pollution (GHSA-75px-5xx7-5xc7); fast-xml-builder has a HIGH attribute-injection advisory (GHSA-5wm8-gmm8-39j9). npm reports 'fixAvailable' but the only path it computes is a phantom MAJOR DOWNGRADE to @google-cloud/storage@5.20.4 (isSemVerMajor:true) which would itself reintroduce a vulnerable uuid — i.e. there is no clean automatic fix. The real fix is to move to a newer 7.x release whose lockfile resolves patched protobufjs/fast-xml-builder.
- **Fix:** Do NOT take npm's suggested downgrade to 5.20.4. Instead `npm update @google-cloud/storage` to the latest 7.x and run `npm audit` again; if transitive protobufjs/fast-xml-builder are still old, add overrides forcing protobufjs>=7.5.8 and fast2-xml-parser/fast-xml-builder to patched versions, then verify GCS upload/download still works.

### 9. [feature] SMART-on-FHIR lab connection feature is fully built on the backend but has no frontend UX — users cannot connect labs

- **Location:** `backend/src/routes/fhirRoutes.ts:27-54`
- **Issue:** The backend ships a complete SMART-on-FHIR lab-sync subsystem: fhirRoutes.ts exposes GET /fhir/connect/quest (returns an OAuth redirectUrl), GET /fhir/connections, POST /fhir/sync/:connectionId, DELETE /fhir/connections/:id, plus services fhirClient.ts, labSyncService.ts, smartAuth.ts, loincMapper.ts, and a LabConnection model (referenced in settingsController deleteAllData/deleteAccount). However there is NO frontend API module (src/services/api/ has no fhir.ts or labConnections.ts) and NO component anywhere that calls these endpoints (grep for fhir/labConnection/connectLab in src/ returns only PlanSection.tsx, unrelated). A high-value, HIPAA-relevant 'connect your lab and auto-import results' feature exists server-side but is completely inaccessible to users. The onboarding 'Upload a lab report' step and DashboardContent Quick Actions only offer manual PDF/OCR/manual-entry paths.
- **Fix:** Add a frontend FHIR API module (connect/list/sync/disconnect) and a 'Connected Labs' settings section + an onboarding option 'Connect your lab (Quest)' that kicks off the OAuth redirect and surfaces connection status / last-sync / manual-sync. This unlocks already-paid-for backend work. Effort: ~1-2 days for a polished connections panel + onboarding entry point.

### 10. [security] Access-token revocation on logout is a no-op: route auth middleware never consults the revocation blacklist

- **Location:** `backend/src/middleware/auth.ts:70-111, 166-201`
- **Issue:** On logout the controller calls revokeAccessToken(token), which adds the JWT to the in-memory revokedTokens Set in authService.ts. The ONLY function that checks that Set is verifyAccessToken() (authService.ts:302-319), but verifyAccessToken is never used to protect any route — grep confirms it appears only in authService.ts and tests. The middleware that actually guards every protected route, authenticate() (and requireBearerAuth, optionalAuth), calls jwt.verify() directly and never references revokedTokens. As a result, a logged-out (or logout-all, or admin-deactivated) user's access token continues to authenticate every protected endpoint for the remainder of its 15-minute lifetime, even on the same instance. The code comments and authController claim the token 'should stop working on this instance immediately' — that guarantee is false. This is a real defect for HIPAA session-termination expectations: revoking a session does not actually stop PHI access until natural JWT expiry.
- **Fix:** Make the route-protection middleware honor revocation: have authenticate()/requireBearerAuth()/optionalAuth() call authService.verifyAccessToken() (which already checks the blacklist and validates type) instead of calling jwt.verify() directly, OR import revokedTokens and check it. Because the blacklist is per-instance and in-memory, also persist revocation in a shared store (Redis) for multi-instance correctness, and prune entries after token exp to avoid unbounded growth (see related finding).

### 11. [security] has_provider_access() RLS function references can_view_dna column that a later migration dropped — provider-access policies will error under a NOBYPASSRLS role

- **Location:** `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:39-62,53`
- **Issue:** The helper function has_provider_access() backs the row-level-security USING clauses for biomarkers, insurance_plans, insurance_benefits, health_needs, health_goals and goal_progress_history (e.g. `OR has_provider_access(user_id, 'view_biomarkers')`). Its body contains `WHEN 'view_dna' THEN pp.can_view_dna`. A later migration, 20260423_drop_dna_genetics/migration.sql line 28, executes `ALTER TABLE "provider_patients" DROP COLUMN IF EXISTS "can_view_dna";` and NO subsequent migration re-creates has_provider_access() to remove that column reference (grep of all migrations confirms the function is only defined once, in 20260107). Because the CASE expression is part of a single SQL SELECT that Postgres must parse/plan as a whole when the function executes, the reference to the now-missing pp.can_view_dna column makes the function fail at runtime with `column pp.can_view_dna does not exist` for ANY permission_type, not just 'view_dna'. This is currently masked: dev/staging connect as a BYPASSRLS superuser (policies are inert) and every provider PHI read path uses admin context (see separate finding) so the policy branch is never invoked. The day a properly-provisioned NOBYPASSRLS production role is used AND any query causes Postgres to evaluate has_provider_access (any RLS-filtered read of a row where user_id != current_user_id, e.g. a provider relying on the policy), the policy evaluation will throw and the query will fail. The purpose-built DB backstop for consent-scoped provider access is therefore broken.
- **Fix:** Add a migration that runs CREATE OR REPLACE FUNCTION has_provider_access(...) with the 'view_dna' branch removed (and remove the now-dead `OR has_provider_access(..., 'view_dna')` clauses left in the dna policies, though those tables are dropped). Add a live-DB regression test that exercises the provider-access RLS path (provider reading a consented patient's biomarkers through the policy, not admin context) so this class of breakage is caught in CI.

### 12. [security] Legacy getFile endpoint still mints and returns a 15-minute unbound GCS signed URL (capture-replay PHI exposure)

- **Location:** `backend/src/controllers/fileController.ts:126-195`
- **Issue:** The codebase deliberately migrated PHI file downloads to a backend-proxied stream (getFileDownloadUrl / GET /files/:id/download) specifically to eliminate the unbound signed-URL capture-replay vector (the controller comment at lines 197-210 and storageService comment at lines 96-104 both explain this). However, the old getFile handler at GET /api/v1/files/:id was left live and still calls getSignedUrl(file.storageKey, 'read') and returns the URL in the JSON `downloadUrl` field. This signed URL is a v4 GCS URL valid for 15 minutes (storageService SIGNED_URL_EXPIRATION_MS) with NO IP, session, or user binding — anyone who obtains it (browser history, proxy/CDN log, referrer, copy-paste into a ticket/Slack) can pull the raw PHI lab/SBC PDF with no authentication for 15 minutes. The route is registered in fileRoutes.ts (lines 52-56) with auth but, unlike the /download route, has NO rate limiter. The frontend no longer calls it (FilesPage.tsx uses downloadFile only, and filesApi.getById has no callers in src/), so the safe path is the one in use — but the dangerous endpoint remains reachable by any authenticated user for their own files, reintroducing exactly the vector the redesign removed.
- **Fix:** Remove the signed-URL minting from getFile (drop the getSignedUrl call and the downloadUrl field) so the only PHI egress path is the audited, no-store proxy stream. If a single-file metadata endpoint is still needed, return metadata only. Also remove the now-unused getSignedUrl 'read' usage and filesApi.getById if no consumer remains. If signed URLs are ever genuinely required, scope them with a GCS IP/condition binding and a much shorter TTL.

### 13. [security] Primary Claude upload paths bypass the PDF-bomb DoS protections (secureParsePdf), parsing untrusted PDFs with no timeout or memory guard

- **Location:** `backend/src/services/pdfTextExtraction.ts:35-68`
- **Issue:** secureParsePdf (utils/securePdfParsing.ts) was written specifically to defend against the ZeroPath 'Denial-of-Service via PDF Bombs' finding: it wraps pdf-parse in a 30s timeout, monitors heap growth and aborts above 100MB, and flags suspicious compression ratios. But that protection is only wired into pdfParser.ts (parseLabReport/parseSBC), which is the REGEX FALLBACK path used only when Claude is unconfigured or fails. The PRIMARY, normally-active path for both lab-report upload (uploadLabReport -> processDocument -> processPDFWithClaude -> extractBiomarkersWithClaude) and SBC upload (uploadSBC -> extractSBCData -> extractInsuranceFromSBC) calls extractTextFromPDF(pdfBuffer), which invokes `pdfParse(buffer)` directly with no timeout and no memory monitoring. validatePdfHeader only checks the first 8 bytes (magic + version), which does nothing against a decompression/parser-hang bomb. Multer caps the upload at 10MB, but a crafted 10MB PDF can still hang pdf-parse for an unbounded time or balloon heap usage, blocking the event loop / OOMing the Cloud Run instance. So the documented DoS guard is effectively inert on the live path.
- **Fix:** Route extractTextFromPDF through secureParsePdf (or at minimum wrap pdfParse in the same withTimeout + heap-delta guard). Since secureParsePdf already takes a (buffer, filename, parser) signature, have pdfTextExtraction call it instead of pdfParse directly, then apply the usable/scanned heuristics to the returned text. This restores the DoS protection on the primary upload path.

### 14. [security] morgan('combined') logs raw request URLs (incl. email-verification/password-reset tokens) to stdout, bypassing the logger PHI sanitizer

- **Location:** `backend/src/app.ts:221-226`
- **Issue:** In production the app installs `app.use(morgan('combined'))`. The combined format writes the full HTTP request line — including the path and query string — to morgan's default stream (process.stdout), which Cloud Run ships verbatim into Cloud Logging. This logging path completely bypasses the SENSITIVE_FIELDS redaction in utils/logger.ts. Security-sensitive single-use tokens transit as query strings: `GET /api/v1/auth/verify-email?token=...` (authRoutes.ts:60-64 validates `verifyEmailQuery` from 'query'; validation.ts:279-281 requires `token`; emailService.ts:273 builds `/verify-email?token=${verificationToken}`) and the password-reset link `/reset-password?token=${resetToken}` (emailService.ts:295). Any GET endpoint that ever carries an identifier in the query string is logged in clear. Anyone with read access to production logs (broad in most GCP setups, plus log exports/SIEM) can harvest live verification/reset tokens and take over accounts, and any PHI/email that appears in a query string is persisted unredacted for the log retention period.
- **Fix:** Do not log raw request lines through morgan in production. Either (a) replace morgan with a custom morgan token/format that strips the query string (log only `req.path`), (b) route morgan through a stream that runs a query-string redactor, or (c) drop morgan in production and emit a structured access log via utils/logger.ts (which already sanitizes). Independently, move single-use tokens out of query strings (POST body) so they never appear in any URL log, proxy log, or browser history.

### 15. [security] No aggregate AI spend cap or circuit breaker — Anthropic cost is only logged, never enforced

- **Location:** `backend/src/services/aiCostTracker.ts:32-44`
- **Issue:** trackAIUsage only writes a structured `logger.info` line with an estimated cost; nothing reads cumulative cost, and there is no global daily/monthly dollar ceiling or circuit breaker anywhere in the backend (grep for spend/budget/circuit/cap found only token-budget and unrelated code). The only spend controls are per-user/IP rate limiters in rateLimiter.ts, all backed by express-rate-limit's in-memory MemoryStore. Two gaps compound the exposure to runaway Anthropic billing: (1) the SBC extraction route (POST /insurance/upload-sbc) and reanalyze route call Claude Sonnet with max_tokens=16384 but have NO plan gating — only `uploadLimiter` (20/hr) + `aiLimiter` (10/hr), both in-memory and diluted under Cloud Run autoscale (insuranceRoutes.ts:127-134, 115-123); (2) the cost-analysis route POST /expenses/analyze (Sonnet, max_tokens=4000) likewise has only `aiLimiter` and no `requirePlanLimit`, even though a `costAnalysisPerMonth` plan limit exists and is defined per tier (expenseRoutes.ts:109-116, plans.ts:53/72/91). For PRO/ENTERPRISE tiers `aiGuidancePerDay` and `costAnalysisPerMonth` are -1 (unlimited; plans.ts:71-72,90-91), so those users are bounded only by the hourly in-memory limiter with no dollar ceiling. A compromised key, a buggy client loop, or an abusive paid account can run up unbounded Anthropic charges with no automatic stop.
- **Fix:** Add a real spend control: maintain a rolling aggregate cost counter (e.g. in Postgres or Memorystore) keyed by global + per-user and refuse new Claude calls past a configured daily/monthly USD budget (fail closed with a 503 + audit log). Gate the SBC upload/reanalyze routes behind `requirePlanLimit('pdfUploadsPerMonth')` (as the lab-upload route already is, uploadRoutes.ts:80-82) and gate /expenses/analyze behind `requirePlanLimit('costAnalysisPerMonth')`. Set a GCP billing/log-based alert on the aiCostTracker `estimatedCostUsd` metric as a backstop.

### 16. [security] Staging provisions a demo account using a committed weak password, on an internet-facing host sharing the prod GCP project

- **Location:** `backend/src/services/authService.ts:1141-1186`
- **Issue:** initializeDemoUser() creates/auto-verifies the demo user whenever `config.demo.enabled` is true and is NOT gated on isDevelopment (only the zero-lockout login bypass at authService.ts:692 is dev-gated). The staging env template (backend/.env.staging.example) sets DEMO_ACCOUNT_ENABLED=true, DEMO_EMAIL=demo@ownmyhealth.io, and the committed literal DEMO_PASSWORD=DemoPassword123!. Staging is a real internet-facing deployment (staging.ownmyhealth.io / api-staging.ownmyhealth.io) running in the SAME GCP project as production (GCP_PROJECT_ID=ownmyhealth-prod, deploy.yml/deploy-staging.yml both target PROJECT_ID: ownmyhealth-prod). Anyone reading the repo knows the staging demo credentials. Account lockout (which is active in staging) slows brute force but is irrelevant against a known password. An attacker gains an authenticated session inside the prod GCP project's network boundary.
- **Fix:** Do not ship a real demo password in any tracked env file. For staging, require DEMO_PASSWORD to be injected from Secret Manager (no template default) and rotate it; or gate initializeDemoUser on isDevelopment so no demo user is auto-created on the shared internet-facing staging host. Consider giving staging its own GCP project to remove the shared-blast-radius with production.


## MEDIUM severity

### 17. [bug] Audit-log writes are opened as a second transaction on a different pooled connection from inside an in-progress RLS transaction (non-atomic, pool-deadlock risk)

- **Location:** `backend/src/services/auditLog.ts:204-235`
- **Issue:** AuditLogService.log() always opens its own withRLSContext(null, ..., { isAdmin: true }), which calls prisma.$transaction() on a connection drawn from the pool. Several consent/PHI handlers call auditService.logUpdate/logDelete/logAccess INSIDE an already-open withRLSContext(userId, async (tx) => { ... }) callback (e.g. patientRoutes.ts approve at 215/237, deny 293/302, patch 352/393, revoke 440/449, delete 503/512; providerRoutes.ts delete at 700/709/719/729). Because the audit call ignores the outer tx and grabs a second pooled connection, two problems arise: (1) Atomicity — the audit row is committed on a separate transaction, so if the outer consent transaction later rolls back you get a phantom audit entry (consent shown as granted/revoked in the log but not in the data), and conversely a failed audit insert does not roll back the consent change. The 'log before delete' ordering the code relies on for compliance is therefore not transactionally guaranteed. (2) Pool exhaustion / latency — opening an inner transaction while the outer transaction still holds its connection consumes 2 pool slots per request; under concurrency at DATABASE_POOL_SIZE this can stall on connectionTimeoutMillis (30s). The data-isolation risk is low because the audit_logs INSERT policy is `WITH CHECK (true)`, but the correctness and reliability impact is real.
- **Fix:** Have the audit helpers accept and use the caller's tx when invoked inside an existing RLS transaction (so the audit row commits/rolls back atomically with the operation it records), or move the audit calls to after the outer transaction resolves. If audit must remain a separate transaction, document explicitly that audit-vs-data atomicity is not guaranteed and ensure the pool is sized to tolerate the nested-connection usage.

### 18. [bug] PUT /insurance/plans/:id/spending writes unvalidated numeric body fields directly into Decimal PHI columns (no Zod schema)

- **Location:** `backend/src/controllers/expenseController.ts:525-554`
- **Issue:** updateCurrentSpending() destructures `deductibleMet` and `oopMet` from req.body and writes them straight into `insurancePlan.deductibleMetIndividual` / `oopMetIndividual`, which are `Decimal(10,2)` columns (prisma/schema.prisma:203,207). The only check is `=== undefined`. The route (insuranceRoutes.ts:137-141) applies `validate(schemas.uuidParam,'params')` but NO body validation schema, unlike every other expense/insurance mutation which uses `finiteNumber.pipe(z.number().min(0).max(999999.99))`. A request body like `{"deductibleMet":"abc"}` or a boolean/object reaches Prisma and produces an unhandled 500 (Decimal coercion error), while `{"deductibleMet":-5000}` or an absurdly large/over-precision value is accepted and silently corrupts the patient's deductible/OOP tracking — which directly feeds the AI cost-analysis OOP projection math (extractProjectedOOP uses these fields). This is an inconsistent validation boundary on a PHI-adjacent financial field.
- **Fix:** Add a Zod schema (e.g. schemas.expense.updateSpending) requiring `deductibleMet` and `oopMet` to be `finiteNumber.pipe(z.number().min(0).max(999999.99))` and apply it via `validate(...)` on the PUT /plans/:id/spending route, matching the other expense endpoints. This rejects non-numeric, negative, NaN/Infinity, and out-of-precision inputs at the boundary.

### 19. [bug] bulkCreateBiomarkers rejects legitimate normal-range min/max of 0 via falsy check

- **Location:** `backend/src/controllers/biomarkerController.ts:483`
- **Issue:** The per-item validation uses `if (!input.normalRange?.min || !input.normalRange?.max)` to reject 'Missing normal range min/max'. Because 0 is falsy, any biomarker whose normal range has a lower bound of 0 (extremely common — e.g. many lab reference ranges are 0–x) or an upper bound of 0 is rejected as invalid and dropped into failedItems, even though the Zod batchCreate schema (validation.ts:329-333) explicitly allows any number including 0. Affected rows silently fail import on lab uploads.
- **Fix:** Check for presence/finiteness explicitly: `if (input.normalRange?.min === undefined || input.normalRange?.max === undefined || !Number.isFinite(input.normalRange.min) || !Number.isFinite(input.normalRange.max))`. The single-create path (createBiomarker) already trusts the Zod-validated values directly and does not have this bug.

### 20. [bug] Plan-expiring notifications can send up to 24 duplicate emails per user (hourly scheduler, no dedup guard)

- **Location:** `backend/src/schedulers/emailScheduler.ts:173-215,221-244`
- **Issue:** The scheduler interval is ONE_HOUR_MS (line 244) and runTick calls sendPlanExpiringNotifications() on EVERY tick (line 232). sendPlanExpiringNotifications selects users whose planExpiresAt falls in the window [now+6d, now+7d), recomputed against the current time each run (lines 179-180). A given user's planExpiresAt stays inside that 1-day-wide window for ~24 consecutive hourly ticks, so they receive up to 24 'plan expiring' emails. The code comment claims 'the daily scheduler sweeps each user exactly once — no sent-at column required' (lines 175-177), but the scheduler is hourly, not daily, and unlike the weekly batch (which is guarded by lastWeeklyRunKey, lines 36/227) the plan-expiring path has no dedup guard at all.
- **Fix:** Gate the plan-expiring sweep behind a once-per-day key (mirror lastWeeklyRunKey, e.g. only run when UTC hour === a fixed value, or track a lastPlanExpiryRunKey using weeklyRunKey(now)), or add a notification sent-at marker. Otherwise users get a daily storm of identical reminders for a week.

### 21. [bug] createHealthGoal treats currentValue of 0 as 'no value', forcing progress to 0

- **Location:** `backend/src/controllers/healthGoalsController.ts:380-383`
- **Issue:** Initial progress is computed as `const progress = currentValue ? calculateProgress(...) : 0;`. When a user creates a goal with currentValue === 0 (a legitimate measurement value), the truthiness check is false, so progress is hard-set to 0 instead of being calculated from start/current/target. This is inconsistent with `startValue = currentValue ?? targetValue` on the line above (which correctly uses nullish coalescing and so accepts 0), and with the progress-history branch `if (currentValue !== undefined)` (line 415) which correctly treats 0 as present. The validation explicitly permits currentValue === 0 (lines 366-368 only reject non-number/NaN). For a DECREASE goal already at 0 against a positive target, progress should be 100, not 0.
- **Fix:** Use an explicit presence check: `const progress = currentValue !== undefined && currentValue !== null ? calculateProgress(startValue, currentValue, targetValue, direction || 'DECREASE') : 0;` to match the startValue and history-entry logic.

### 22. [bug] updateHealthGoal does not recalculate progress when targetValue changes

- **Location:** `backend/src/controllers/healthGoalsController.ts:483-492,503-506`
- **Issue:** When a goal's targetValue is updated, the handler writes the new plaintext+encrypted target (lines 484-491) but never recomputes `progress`. The stored `progress` percentage was derived from the OLD target via calculateProgress. After the update the goal returns a stale progress value that no longer reflects (startValue, currentValue, newTarget). Progress only gets refreshed on the separate updateGoalProgress endpoint. A user who edits their target (e.g. makes a weight goal more aggressive) will see an incorrect progress bar until they log a new value.
- **Fix:** When targetValue (or targetDate-derived logic) changes, recompute progress from the goal's existing startValue/currentValue and the new target before the update, and persist it alongside targetValue.

### 23. [bug] transformPlanForDisplay can return undefined benefits/costs, crashing insurance panels _(verifier: severity adjusted from high)_

- **Location:** `src/utils/insurance/insuranceUtils.ts:188-194`
- **Issue:** transformPlanForDisplay returns `benefits: benefits.length > 0 ? benefits : plan.benefits` and `costs: costs.length > 0 ? costs : plan.costs`. For an API plan that has no copay/deductible flat fields populated (e.g. a sparsely-extracted SBC), the locally-built arrays are empty AND the incoming plan.benefits/plan.costs are undefined (API shape only has flat fields). The function therefore returns benefits=undefined and costs=undefined even though the InsurancePlan type declares them as required arrays (types/index.ts:275-276). The unsafe `as unknown as InsurancePlan` casts in useBiomarkerData mask this at compile time. Consumers then crash at runtime: BiomarkerInsurancePanel.tsx:519 `for (const benefit of plan.benefits)` and :213 `plan.costs.find(...)`, and BiomarkerActionPlan.tsx:664 `plan.benefits.filter(...)`.
- **Fix:** Always coerce to arrays: `benefits: benefits.length > 0 ? benefits : (plan.benefits ?? [])` and `costs: costs.length > 0 ? costs : (plan.costs ?? [])`. Also add defensive `?? []` / optional chaining in BiomarkerInsurancePanel and BiomarkerActionPlan where plan.benefits/plan.costs are iterated.

### 24. [bug] TrendSparkline gradient IDs use Date.now(), causing duplicate SVG ids and cross-sparkline gradient bleed

- **Location:** `src/components/trends/TrendSparkline.tsx:85-86`
- **Issue:** gradientId and normalRangeId are derived from Date.now() and recomputed on every render rather than memoized/uniquely scoped. The dashboard and Trends grid render many TrendSparkline instances in the same render pass, so multiple sparklines compute the SAME Date.now() millisecond value and emit identical `<linearGradient id=...>` definitions plus identical `fill=url(#sparkline-gradient-<ts>)` references. Duplicate DOM ids are invalid and `url(#id)` resolves to the first matching def, so the fill/area gradient of one sparkline can be applied to others (visual corruption). The id also changes every render, defeating any def reuse and risking flicker.
- **Fix:** Use React's useId() (or a useMemo with crypto.randomUUID()) to generate a stable, unique id per component instance, matching the pattern already used correctly in BiomarkerChart.tsx (gradient id keyed by biomarker.id).

### 25. [bug] InsuranceKnowledgeBase singleton retains plans after deletion; search returns stale/cross-session plans

- **Location:** `src/components/insurance/useInsuranceKnowledgeBase.ts:27-32,46-53`
- **Issue:** The hook feeds plans into a module-level singleton (insuranceKB) via insuranceKB.addPlan in an effect, but the singleton (insuranceKnowledgeBase.ts:218 `private plans: Map`) is never cleared. addPlan keys by plan.id so re-adds overwrite (no duplication), but deleted plans are NOT removed from the singleton — and handleSearch calls insuranceKB.searchPlans(filters) which iterates ALL plans ever added to the singleton across the app's lifetime, not the current `plans` prop. So after deleting a plan (or switching data sets) the Knowledge Base search can surface plans no longer owned/shown. Separately, handleSearch gates on searchQuery.trim() but then ignores searchQuery entirely and only passes `filters` to searchPlans, so the free-text query box never affects results.
- **Fix:** Either build a fresh InsuranceKnowledgeBase instance inside the hook (useMemo on plans) instead of using the global singleton, or add a clear()/removePlan() and reset the singleton from the plans prop each time it changes. Also incorporate searchQuery into the search criteria (or remove the dead query input).

### 26. [bug] EnhancedInsuranceUpload key-terms panel never renders (extractedTerms produced, keyTerms consumed)

- **Location:** `src/components/insurance/EnhancedInsuranceUpload.tsx:254-259,590,624,641`
- **Issue:** After an SBC upload, handleFiles builds extractedData with `extractedTerms: [...]` (line 254). However the expanded analysis only renders the 'AI-Extracted Key Terms' block when `result.extractedData.keyTerms` is truthy (line 590) and maps over keyTerms (line 624). Since keyTerms is never set, this entire AI-terms section silently never appears for the only producer path in the component. Additionally, each term row renders `term.definition` (line 641), but the producer populates `term.value` (lines 255-258), so even if the section showed, the term body would be blank. The category filter at line 399 compares term.category to selectedCategory.toLowerCase() but producer categories are 'Copays'/'Coverage' (capitalized) and the dropdown options are 'cost'/'coverage'/'network'/'procedure', so filtering would also mismatch.
- **Fix:** Render from `result.extractedData.keyTerms ?? result.extractedData.extractedTerms`, display `term.value ?? term.definition`, and align category values between producer, filter, and dropdown options.

### 27. [bug] EnhancedInsuranceUpload tracks processed files by filename, mismatching results on duplicate names

- **Location:** `src/components/insurance/EnhancedInsuranceUpload.tsx:263-267,281-296,490,495`
- **Issue:** Uploaded files are appended to state and later updated by matching `pf.file.name === file.name`. If a user uploads two files with the same name (common for 'sbc.pdf', or re-dropping the same file), the success/error map updates apply to ALL entries with that name, overwriting/duplicating results onto the wrong rows. The list is also keyed by array index (key={index}), so identical names compound the issue. Because uploads run concurrently in the for-loop, the last response to resolve wins for every same-named row.
- **Fix:** Assign a stable unique id (crypto.randomUUID()) to each ProcessedFile when appended, match updates by that id, and use it as the React key instead of the array index/filename.

### 28. [compliance] Audit-log value encryption failure silently writes a sentinel string, dropping the HIPAA PHI change-snapshot

- **Location:** `backend/src/services/auditLog.ts:188-199, 204-235`
- **Issue:** encryptValue() catches any encryption error and returns the literal string '[ENCRYPTION_FAILED]' instead of throwing. log() then proceeds to write the audit row with that sentinel in previousValueEncrypted / newValueEncrypted. The result is an audit record that LOOKS complete (success=true) but has permanently lost the before/after PHI snapshot that HIPAA change-tracking requires. Because the failure is swallowed, a systemic encryption misconfiguration (e.g. bad/rotated key, empty systemSalt during a boot-order race) would produce a stream of audit rows with no recoverable PHI and no failure signal to the caller. The audit log is the compliance system of record, so a silent integrity gap here is meaningful.
- **Fix:** On encryption failure, either (a) set success=false / write to errorMessage so the record is flagged as incomplete and surfaces in compliance monitoring, or (b) re-throw so the log() catch path records the CRITICAL failure rather than persisting a row that masquerades as a valid PHI snapshot. Do not persist a fabricated '[ENCRYPTION_FAILED]' ciphertext placeholder in a column that is read back as ciphertext.

### 29. [compliance] Image OCR path sends raw, un-redacted document bytes to Google Document AI with no BAA/runtime gate (unlike the Claude PHI gate)

- **Location:** `backend/src/services/ocrService.ts:263-292`
- **Issue:** For images (PNG/JPG/TIFF/GIF/WebP) the OCR path base64-encodes the raw upload and ships it to Google Document AI. Unlike every Anthropic call (which is gated on config.anthropic.baaActive and refuses to run unless ANTHROPIC_BAA_ACTIVE=true — see claudeExtraction.ts:106, sbcExtraction.ts:767, aiChatController, expenseController, biomarkerRoutes), the Document AI call has NO equivalent BAA/runtime gate and applies NO redaction. The image pixels contain full patient demographics (name, DOB, MRN, address, subscriber ID) that the pdfRedaction banner-cover and text redactPHI cannot reach — those are images, sent verbatim. If the GCP project's Document AI usage is not under a signed BAA, this is a HIPAA disclosure of PHI to a third party. Even if a Google BAA exists, the asymmetry (hard gate for Anthropic, none for Google) means a misconfigured deploy could send PHI to Document AI before any BAA is confirmed.
- **Fix:** Add a runtime BAA/enabled gate for Google Document AI (e.g. GOOGLE_BAA_ACTIVE or DOCUMENT_AI_ENABLED) mirroring the Anthropic C-7 gate, and document the Google Cloud BAA coverage for Document AI in SECURITY_STATUS. At minimum, fail closed in production if the gate is not set, so image PHI cannot be transmitted to a non-covered processor by misconfiguration.

### 30. [compliance] PHI redaction relies on regex applied to AI input/output but is best-effort only; named-patient and free-text PHI can still reach Claude and logs

- **Location:** `backend/src/utils/phiRedaction.ts:1-12,72-77`
- **Issue:** phiRedaction.ts is the sole content-level scrub applied before text is sent to Claude (claudeExtraction.ts:135, sbcExtraction.ts:794, expenseController.ts:629) and before AI output is streamed/persisted/logged. It is pattern-based and, by its own header, 'NOT a complete PHI oracle' — it cannot catch unlabeled patient names, dates not in MM/DD/YYYY form, foreign formats, or free-text identifiers a user types into an expense note. The labeled-name pattern (lines 72-76) only fires on 'Patient:/Name:'-prefixed tokens. Because logger.ts also redacts only by field name (utils/logger.ts:21-30 SENSITIVE_FIELDS) and several AI services log derived metadata, residual PHI in extracted text can both (a) leave the box to Anthropic despite the minimum-necessary posture and (b) land in logs if a future log statement passes redacted-but-incomplete text. This is the expected weakness of regex PHI scrubbing and the BAA gate (config.anthropic.baaActive) is the primary control; flagging as a defense-in-depth gap rather than an active breach.
- **Fix:** Keep relying on the BAA gate as the load-bearing control and document that regex redaction is defense-in-depth only. Consider routing AI-bound text through Google DLP (already a GCP dependency) for entity-based de-identification, and add unit tests asserting redaction on un-labeled names/dates to bound regressions. Ensure no log statement in the AI services ever logs the redacted text body itself (currently they log only lengths + firedPatterns, which is correct — preserve that).

### 31. [dependency] express 4.22.1 carries qs/body-parser DoS — bump to 4.22.2

- **Location:** `backend/package.json:29`
- **Issue:** Although package.json declares "express": "^4.18.2", the caret resolved the install to express@4.22.1, which npm audit flags moderate because it depends on a qs version vulnerable to a remotely-triggerable DoS (GHSA-q8mj-m7cp-5q26: qs.stringify TypeError on null/undefined comma-format array entries). express 4.22.2 is published and patches the qs/body-parser chain with no breaking change.
- **Fix:** Run `npm install express@^4.22.2` (still inside the declared ^4 range) to pull patched qs/body-parser, then re-audit. Consider pinning a floor ("express": "^4.22.2") so fresh installs cannot resolve a vulnerable patch level.

### 32. [dependency] pdf-parse 1.1.1 is unmaintained and uses fragile import workaround (no @types, known debug-mode crash)

- **Location:** `backend/package.json:36`
- **Issue:** pdf-parse@1.1.1 has been unpublished-then-abandoned by its original author for years; v1.1.1 is the well-known release whose index.js runs a debug block that tries to read a bundled test PDF (`./test/data/05-versions-space.pdf`) when `module.parent` is falsy, crashing under some bundlers/ESM contexts. It also ships no type definitions, forcing a `@ts-expect-error` in source. It sits in the PHI pre-processing path (text extraction before redaction/AI). A maintained, typed rewrite exists at pdf-parse@2.x (latest 2.4.5).
- **Fix:** Migrate to pdf-parse@2.x (typed, maintained) or replace with the already-present pdfjs-dist/pdf-lib for text extraction. Validate the extraction thresholds (MIN_USABLE_CHARS/MIN_USABLE_LINES) still behave after the swap. Medium effort, removes the @ts-expect-error and the abandoned-dep risk.

### 33. [dependency] Frontend prod bundle: serve -> ajv -> fast-uri 3.1.0 path-traversal/host-confusion (HIGH)

- **Location:** `package.json:31`
- **Issue:** The frontend production dependency `serve@14.2.6` pulls ajv@8.18.0 -> fast-uri@3.1.0, which is the only HIGH in the frontend prod audit (GHSA-q3j6-qgpj-74h6 path traversal via percent-encoded dot segments + GHSA-v39h-62p7-jpjc host confusion). Real-world impact is limited because CLAUDE.md states the frontend is deployed to a GCS bucket (static hosting), not via `serve`; `serve` is effectively a local/dev static server. If `serve dist` is ever used as the actual production host (it is the `npm start` script), the advisory becomes directly relevant.
- **Fix:** Run `npm audit fix` / update `serve` (or its ajv) so fast-uri resolves to a patched version, OR drop `serve` entirely if the frontend is only ever served from GCS/CDN and the `start` script is unused in prod. Confirm which host actually serves dist before deciding.

### 34. [feature] A doctor-ready PDF report generator and CSV export exist but are not wired into any UI (unsurfaced features)

- **Location:** `src/utils/pdfReportGenerator.ts:1-40`
- **Issue:** src/utils/pdfReportGenerator.ts is a complete 'comprehensive, doctor-friendly PDF health report' generator (patient info, biomarker tables with status, trend analysis, risk alerts, charts via jsPDF/autoTable/html2canvas), and src/utils/biomarkers/exportBiomarkers.ts provides exportToCSV/PDF helpers. Neither is referenced by any component — Bash grep for pdfReportGenerator/generatePdfReport/generateBiomarkerReport and exportBiomarkers across src/*.tsx returns zero importers. Meanwhile the only export users can reach is the raw JSON dump in AccountSettingsPage, which is not something a patient would hand to a physician. Surfacing the existing PDF/CSV export is a high-value, low-effort win: a 'Share with your doctor (PDF)' / 'Download CSV' action on TrendsPage or the dashboard.
- **Fix:** Add an 'Export / Share Report' button (PDF + CSV) to TrendsPage and/or the Data & Privacy settings section that calls the existing generators, pre-filling patientName from the profile. Effort: ~3-4 hours.

### 35. [feature] Reference ranges are single static min/max with no sex/age stratification despite profile collecting biological sex and age

- **Location:** `src/data/measurementOptions.json:1`
- **Issue:** Every biomarker in measurementOptions.json carries a single flat normalRange `{min, max, source}` with no sex- or age-specific variants. For many tracked biomarkers (hemoglobin, hematocrit, ferritin, creatinine/eGFR, HDL, testosterone, uric acid) the clinical reference range differs substantially by biological sex, and several shift with age. The app already collects biologicalSex and ageRange in HealthProfileSection, so the inputs to stratify exist, but TrendsPage/BiomarkerSummary/RangeBar all evaluate in/out-of-range against the unstratified range. This can mislabel a normal result as 'out of range' (or vice-versa) — a correctness and trust issue in a clinical-tracking product, and undermines the 'Needs Attention' counts surfaced everywhere on the dashboard.
- **Fix:** Extend the biomarker data model to optional sex/age-stratified ranges (e.g. normalRangesBySex), and resolve the applicable range using the user's health profile when classifying in/out-of-range. Cite the source per stratified range. Phase 1 could cover the ~10 most sex-sensitive biomarkers. Effort: ~1-2 days including data sourcing.

### 36. [feature] Custom modals and dropdowns lack dialog/menu ARIA semantics and focus management (screen-reader & keyboard a11y gap)

- **Location:** `src/components/common/Modal.tsx:80-114`
- **Issue:** Recent a11y work added skip links, aria-labels and focus rings, but the dialog/menu layer is still not exposed to assistive tech. No component in src/components uses role="dialog", aria-modal, role="menu", aria-haspopup, or aria-expanded (Grep returns zero matches). Consequences: (1) the shared Modal and the hand-rolled overlays (AddMeasurementModal.tsx, TrendDetailModal.tsx, the delete-confirmation modal in AccountSettingsPage.tsx:471-554) are announced as generic groups, never trap focus, and don't restore focus to the trigger on close; (2) the TrendsPage category/sort dropdowns (TrendsPage.tsx:181-279) are plain buttons toggling a div with no aria-expanded/aria-haspopup and no arrow-key navigation. This fails WCAG 2.1 keyboard/focus-order and name/role/value criteria for a HIPAA product that should be broadly accessible. The shared Modal does handle Escape and body-scroll lock, so it's a good place to centralize the fix.
- **Fix:** On the shared Modal: add role="dialog" aria-modal="true" aria-labelledby pointing at the title, implement a focus trap, move initial focus into the dialog, and restore focus to the opener on close; refactor the bespoke overlays to use it. On the dropdowns: add aria-haspopup/aria-expanded and arrow-key + Escape handling (or a headless menu primitive). Effort: ~1 day for the Modal + dropdown pattern, then incremental adoption.

### 37. [infra] All rate limiters use express-rate-limit in-memory MemoryStore → per-instance counters multiply under Cloud Run autoscale

- **Location:** `backend/src/middleware/rateLimiter.ts:6-13,102-118,49-69`
- **Issue:** Every limiter (standardLimiter, authLimiter, strictAuthLimiter, uploadLimiter, sensitiveLimiter, aiLimiter, providerAccessRequestLimiter, bulkOperationLimiter) is constructed with no `store` option, so express-rate-limit uses the default in-process MemoryStore. On Cloud Run each instance keeps its own counters, so the effective ceiling is N×limit where N is the number of live instances. Cloud Run requests are not sticky, so an attacker rotating across instances multiplies every limit: the 5-attempt login brute-force cap (strictAuthLimiter, line 51) becomes 15 across the 3 instances, and the 10/hr aiLimiter (line 104) — the primary cost control for paid Claude endpoints — becomes 30/hr. This is a documented, accepted limitation explicitly bounded by `--max-instances=3` in deploy.yml:88 and deploy-staging.yml:67 (verified), so the blast radius is fixed at 3× today, not unbounded — which is why this is medium rather than high. The risk grows the moment max-instances is raised without first moving to a shared store.
- **Fix:** Back the security-critical limiters (strictAuthLimiter, authLimiter, aiLimiter) with rate-limit-redis on Cloud Memorystore so counters are shared across instances; this also decouples the rate-limit posture from the max-instances pin. At minimum, add a CI/deploy guard that fails if `--max-instances` is raised while the limiter store is still MemoryStore (the deploy.yml comment asks for this but nothing enforces it).

### 38. [infra] Audit-log retention cleanup relies on an in-process 24h setInterval that rarely fires on scale-to-zero Cloud Run

- **Location:** `backend/src/services/auditLog.ts:526-543`
- **Issue:** The 7-year retention enforcement is a `setInterval(..., 24*60*60*1000)` started at boot (app.ts:322 → startAuditCleanup) and runs inside the request-serving Node process. Cloud Run instances are ephemeral and scale to zero during idle periods, and max-instances=3 means up to 3 instances each schedule their own interval. A daily timer will almost never reach 24h of continuous uptime on a scale-to-zero service, so cleanupOldLogs() may effectively never run in production, and when multiple instances are warm they run redundant deleteMany passes. For HIPAA this fails safe (over-retention is not a violation), but the documented control (HIPAA_CHECKLIST.md cites this as the retention mechanism) does not actually execute reliably, and the duplicate-run/contention behavior is untracked.
- **Fix:** Move retention cleanup to an external scheduler (Cloud Scheduler → authenticated HTTP endpoint, or a Cloud Run Job / cron) that is independent of instance lifetime and runs exactly once per day, with a lock to prevent concurrent passes. Remove the in-process interval or keep it only for local dev.

### 39. [infra] Single broad GCP service account (GCP_SA_KEY) used for image push, Cloud Run deploy, and GCS writes across prod and staging — not least-privilege

- **Location:** `.github/workflows/deploy.yml:40-44,153-157,199-203`
- **Issue:** Both deploy.yml (production) and deploy-staging.yml authenticate with the same single secret `secrets.GCP_SA_KEY` and use it for everything: Artifact Registry push, `gcloud run deploy`/`update-traffic` on the production service, and `gsutil rsync` writes to the frontend buckets. One long-lived JSON service-account key thus holds Artifact Registry + Cloud Run admin + Storage admin across both environments in the same ownmyhealth-prod project. If this CI secret leaks, an attacker can deploy arbitrary images to production and overwrite the live frontend. The repo also documents (deploy.yml:1-13) that the third-party actions are pinned to mutable major-version tags (@v4/@v2) rather than commit SHAs, widening supply-chain exposure.
- **Fix:** Adopt Workload Identity Federation (keyless OIDC) instead of a long-lived JSON key, and split into least-privilege identities: a build/push identity (Artifact Registry Writer), a deploy identity (Cloud Run Admin scoped to the one service), and a frontend-publish identity (Storage Object Admin on one bucket). Use separate identities/projects for staging vs prod. Pin actions to commit SHAs as the in-file TODO notes.

### 40. [quality] Single top-level ErrorBoundary: any render error in a dashboard page crashes the entire app

- **Location:** `src/App.tsx:276-295`
- **Issue:** The only ErrorBoundary wraps the whole app (App > ThemeProvider > AuthProvider > AppContent). The Dashboard, its lazy pages (InsuranceHub, TrendsPage, FilesPage, etc.) and all modals (DashboardModals) have no granular boundaries. A render exception in any one page/modal — e.g. the undefined plan.benefits crashes documented above, or any future data-shape mismatch — unmounts the entire React tree and shows the global 'Something went wrong' screen, losing navigation state and in-memory PHI context. For a data-heavy dashboard this is a fragile blast radius.
- **Fix:** Wrap the dashboard <main> page-render switch and the DashboardModals subtree in their own ErrorBoundary instances (with a localized fallback) so a single page/modal failure does not take down the whole shell.

### 41. [quality] CLAUDE.md and README.md document JWT_SECRET / CSRF_SECRET / SENDGRID_FROM_EMAIL / GOOGLE_CLOUD_PROJECT / RATE_LIMIT_MAX env vars that do not exist in code

- **Location:** `CLAUDE.md:242,253,246,259,261`
- **Issue:** CLAUDE.md's Environment Variables block lists 'JWT_SECRET', 'CSRF_SECRET', 'SENDGRID_FROM_EMAIL', 'GOOGLE_CLOUD_PROJECT', and 'RATE_LIMIT_MAX'. None of these are read by backend/src/config/index.ts. The real names are: JWT_ACCESS_SECRET + JWT_REFRESH_SECRET (config L61/L65, both via requireEnv); EMAIL_FROM (L133); GCP_PROJECT_ID (L151); RATE_LIMIT_MAX_REQUESTS (L118). There is NO CSRF_SECRET at all — csrf.ts uses a double-submit-cookie design with no server secret. An operator copying CLAUDE.md's env list would fail to boot (missing JWT_ACCESS_SECRET/JWT_REFRESH_SECRET throw immediately) and would set ineffective vars. README.md L283 repeats the same JWT_SECRET error. Notably, New Project Documents/ENV_VARS.md ALREADY documents these corrections (L399, L469, L471) and explicitly says 'Remove from CLAUDE.md and prompt' — so CLAUDE.md/README/prompts are the stale copies, not ENV_VARS.md.
- **Fix:** Update CLAUDE.md env block and README.md L283 to use JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, EMAIL_FROM, GCP_PROJECT_ID, RATE_LIMIT_MAX_REQUESTS; delete CSRF_SECRET entirely. Align with the already-correct New Project Documents/ENV_VARS.md.

### 42. [security] Account enumeration: login response leaks whether an account exists via remainingAttempts

- **Location:** `backend/src/services/authService.ts:745-755, 787-802`
- **Issue:** attemptLogin returns a generic '{ success:false, error:"Invalid email or password" }' (no remainingAttempts) when the user does NOT exist, but returns '{ success:false, remainingAttempts, error:"...N attempts remaining" }' when the user DOES exist and the password is wrong (recordFailedLogin only runs for existing users). The login controller then renders these differently: a non-existent user falls through to a bare 401 (UnauthorizedError) with no details, while an existing user gets a 401 whose body contains details.remainingAttempts and a countdown message. An attacker can therefore enumerate valid accounts by submitting any password and observing whether the response carries remainingAttempts. The 403 EMAIL_NOT_VERIFIED and 423 ACCOUNT_LOCKED branches further distinguish account states.
- **Fix:** Do not return remainingAttempts or per-account countdown messages to the client. Keep failed-attempt accounting server-side only and return a single uniform 401 body for all invalid-credential cases (existent or not). If you must surface lockout, do it generically after the threshold without distinguishing 'this email exists'.

### 43. [security] Account enumeration on registration: distinct 'Email already registered' error

- **Location:** `backend/src/controllers/authController.ts:169-172`
- **Issue:** The register endpoint returns a distinct 400 'Email already registered' when the email is taken. This directly confirms account existence to an unauthenticated caller, which is the same enumeration weakness the forgot-password / resend-verification / provider-request flows were specifically hardened against (those return uniform 'if it exists...' responses). Combined with the login remainingAttempts leak, an attacker can reliably build a list of registered emails. authLimiter (20/15min) slows but does not prevent this.
- **Fix:** Return a uniform success response ('If this email can be registered, you'll receive a verification email') and send a verification email to new addresses and an 'account already exists / reset your password' email to existing ones, mirroring the forgot-password posture. Alternatively accept the tradeoff but document it; given the rest of the codebase explicitly closes enumeration elsewhere, this endpoint is inconsistent.

### 44. [security] Provider cross-tenant PHI reads bypass RLS entirely via admin context instead of the has_provider_access() policy

- **Location:** `backend/src/routes/providerRoutes.ts:406-447,549-587,283-320`
- **Issue:** The most sensitive cross-tenant flow — a provider reading another user's PHI (biomarkers at GET /provider/patients/:patientId/biomarkers, health needs at /health-needs, patient detail at /patients/:patientId) — runs the patient-data query inside withRLSContext(null, ..., { isAdmin: true }). Admin context sets app.is_admin='true', so the RLS policies short-circuit on is_admin_session() and apply NO row filtering at all; the only thing limiting disclosure is the hand-written application-layer checks (relationship.status==='ACTIVE', consentExpiresAt, canViewBiomarkers/canViewHealthNeeds, patient isActive/lockedUntil) plus the `where: { userId: patientId }` clause. This defeats the defense-in-depth intent of the has_provider_access() RLS policy, which was written specifically to enforce consent-scoped provider access at the database layer. With admin bypass, any logic bug in the app-layer gate (a missing status check, an inverted boolean, a forgotten consent-expiry comparison, or a mistyped where clause) results in unfiltered cross-tenant PHI exposure with no database backstop. The middleware checkProviderPatientAccess() in rbac.ts (lines 202-219) and requireOwnership() (288-300) follow the same admin-context pattern for relationship lookups.
- **Fix:** Run provider PHI reads under the PROVIDER's own RLS context (withRLSContext(providerId, ...)) and let the has_provider_access() policy enforce consent at the DB layer, keeping the app-layer checks as the primary gate and audit driver. This requires fixing the has_provider_access() function (see related finding) and adding a SELECT policy on users that lets a provider read the minimal {id,email} of a consented patient (currently users_select_own forces the admin bypass for the cross-tenant User read). Until then, the app-layer checks are the sole isolation boundary for provider access — document and test them as security-critical.

### 45. [security] AUDIT_LOG_SALT is validated for length only, not hex format, but is consumed as a hex buffer in key derivation

- **Location:** `backend/src/config/index.ts:54, 240-250`
- **Issue:** config.auditSalt (AUDIT_LOG_SALT) is passed directly as the userSalt argument to EncryptionService.encrypt() for every audit-log PHI snapshot. Inside encrypt(), the salt is interpreted as hex via Buffer.from(userSalt, 'hex') (encryption.ts:265) before PBKDF2 derivation. The only validation on AUDIT_LOG_SALT is a >=16 CHARACTER length check; there is no hex-format check. Node's Buffer.from(str,'hex') silently stops at the first non-hex character and ignores trailing odd nibbles, so a 16+ char salt like 'mySuperSecretAuditSalt!' would be parsed to an empty or severely truncated buffer, drastically reducing the salt entropy that protects every audit-log PHI snapshot. The PHI_ENCRYPTION_KEY validator (encryption.ts:120) correctly enforces a hex regex; the audit salt validator does not, creating an inconsistent and weaker guard on a value used identically as cryptographic input.
- **Fix:** Validate AUDIT_LOG_SALT with the same hex regex used for PHI_ENCRYPTION_KEY (e.g. /^[0-9a-fA-F]+$/ and an even length, ideally 64 hex chars), or change the audit path to treat the salt as a UTF-8 buffer consistently. Reject non-hex salts at startup so a misformatted secret cannot silently weaken audit-log encryption.

### 46. [security] FHIR client follows server-supplied pagination/discovery URLs with the user's Bearer access token attached, with no scheme/host validation (SSRF + token exfiltration)

- **Location:** `backend/src/services/fhir/fhirClient.ts:30-50,88-104`
- **Issue:** FHIRClient.request() attaches `Authorization: Bearer ${this.accessToken}` to EVERY request, including requests to fully-absolute URLs taken verbatim from the FHIR server's own response. collectAllPages() reads `link[rel=next].url` from each returned Bundle and re-requests it with `absolute=true` (line 98), so the host/scheme of subsequent requests is entirely controlled by the upstream FHIR server's JSON response — not by the configured QUEST_FHIR_BASE_URL. Likewise smartAuth.discoverEndpoints() (smartAuth.ts:75-95) takes `authorization_endpoint`/`token_endpoint` straight from the /.well-known/smart-configuration document and later POSTs the OAuth code exchange (with client_secret, smartAuth.ts:152) to that host. There is no allowlist, no `new URL()` scheme check (http/https only), and no block on private/link-local hosts (127.0.0.1, 169.254.169.254, 10.x, etc.). A malicious or compromised FHIR endpoint (or a MITM on the cleartext path) can return a `next` URL pointing at an internal metadata service or an attacker host and the backend will send the patient's live FHIR Bearer token there — both an SSRF primitive from the Cloud Run egress IP and a credential-exfiltration vector. Note: the base URL itself is a server-side env var (config.quest.fhirBaseUrl) and the provider is hardcoded to 'quest', so the classic 'user supplies arbitrary issuer URL' SSRF is NOT present; the exposure is via the response-controlled follow-on URLs.
- **Fix:** Before fetching any absolute URL (pagination `next` link, discovered authorize/token/revoke endpoints), validate it: require https scheme, require the host to match the configured FHIR provider's registered base host (or an explicit allowlist), and reject URLs that resolve to private/loopback/link-local IP ranges. Only attach the Bearer token when the target host equals the trusted FHIR base host; never send it to a host derived from server response data without that check.

### 47. [security] Deployed frontend SPA ships with no Content-Security-Policy (CSP) or clickjacking protection

- **Location:** `index.html:1-21`
- **Issue:** The PHI-handling SPA is served as static files from a Google Cloud Storage bucket (deploy.yml uses `gsutil rsync -d -r dist/ gs://${FRONTEND_BUCKET}/`). GCS static website hosting does not inject HTTP security headers, and index.html contains no `<meta http-equiv="Content-Security-Policy">` tag and no X-Frame-Options/frame-ancestors equivalent. The Helmet CSP referenced in backend/src/app.ts applies ONLY to API JSON responses from the Express server, never to the HTML/JS bundle the browser actually loads. Result: the production frontend has zero CSP (no script-src allowlist, no connect-src restriction, no frame-ancestors) and no clickjacking defense. For a HIPAA app the sole XSS mitigation becomes React's default text escaping; a single future dangerouslySetInnerHTML regression, a compromised npm dependency, or an injected inline script would execute unrestricted, and the app can be framed for clickjacking. Note: New Project Documents/STRATEGY.md line 302 claims CSP is 'Currently HTTP-equiv meta tag' — that meta tag does NOT exist in the real index.html (stale doc).
- **Fix:** Serve the frontend behind a layer that emits security headers (e.g. a Cloud Run/nginx static server, Firebase Hosting headers config, or Cloud CDN/Load Balancer response-header policy) and set a restrictive Content-Security-Policy (script-src 'self'; connect-src 'self' https://api.ownmyhealth.io; frame-ancestors 'none'; object-src 'none'; base-uri 'self') plus X-Frame-Options: DENY. As an interim measure add a CSP `<meta http-equiv>` to index.html, but note meta CSP cannot set frame-ancestors, so a real response header is required for clickjacking protection.

### 48. [security] Committed DEMO_PASSWORD literals in tracked .env example files (Demo123! / DemoPassword123!)

- **Location:** `backend/.env.example:159`
- **Issue:** Tracked example env files ship concrete demo passwords rather than placeholders: backend/.env.example:159 `DEMO_PASSWORD=Demo123!` (uncommented, an active default if copied to .env) and backend/.env.staging.example:88 `DEMO_PASSWORD=DemoPassword123!`. The e2e test (e2e/auth-complete-test.js:310) and unit test (authService.test.ts:57) hardcode these too, cementing the values. Operators commonly `cp .env.example .env`, leaving the demo account on a known credential. Unlike JWT_ACCESS_SECRET/PHI_ENCRYPTION_KEY (which ship empty or as deliberately-invalid placeholders that fail boot), DEMO_PASSWORD has no validation and the literal is directly usable.
- **Fix:** Replace the literal with a non-usable placeholder (e.g. DEMO_PASSWORD=CHANGE_ME_openssl_rand_base64_16) consistent with how JWT/PHI keys are handled, and add a startup check that rejects known demo-password literals when DEMO_ACCOUNT_ENABLED=true (mirroring the BLOCKED_JWT_VALUES set).

### 49. [security] Live secrets stored in OneDrive-synced backend/.env (untracked but real Anthropic key, JWT secrets, PHI key, Cloud SQL password)

- **Location:** `backend/.env:40,48,76,131`
- **Issue:** backend/.env (correctly gitignored and confirmed never committed to git history) nonetheless contains REAL production-grade secrets on disk inside a OneDrive-synced project directory (C:\Users\breil\OneDrive\...): a real Anthropic API key (sk-ant-api03-...), real JWT access/refresh secrets, a real 64-hex PHI_ENCRYPTION_KEY, and a commented Cloud SQL connection string with password OmhGcp2026SecureDb. Because the folder is cloud-synced, these secrets are replicated to Microsoft OneDrive and any device/account with access to that OneDrive — outside the project's secret-management boundary. The same file sets ANTHROPIC_BAA_ACTIVE=true locally, meaning real PHI could be sent to Claude with this key from a dev box.
- **Fix:** Treat this Anthropic key as compromised and rotate it (it has been on a cloud-synced disk). Move local secrets out of the OneDrive-synced tree (e.g. a non-synced ~/.config path) or use a local secret manager / dotenv-vault. Never set ANTHROPIC_BAA_ACTIVE=true with a real key on a developer workstation that may touch real PHI.


## LOW severity

### 50. [bug] revokedTokens in-memory blacklist grows unbounded (memory leak / DoS over time)

- **Location:** `backend/src/services/authService.ts:139-148`
- **Issue:** Every logout adds the raw access-token string to a process-global Set with no eviction or TTL. Entries are never removed even after the underlying JWT expires (15 min). On a long-lived instance with many logouts this Set grows without bound, slowly consuming memory. (It is also functionally dead today because no route middleware consults it — see the related high finding — but if that is fixed without adding eviction, the leak becomes load-bearing.)
- **Fix:** Store the token's jti+exp instead of the full string and run a periodic sweep (piggyback on the existing startSessionCleanup 10-min interval) that drops entries whose exp has passed. Or move to Redis with per-entry TTL set to the token's remaining lifetime.

### 51. [bug] Multer upload errors (file too large / wrong type) surface as HTTP 500 with a generic message instead of 400/413

- **Location:** `backend/src/middleware/errorHandler.ts:135-201`
- **Issue:** The global errorHandler only special-cases AppError, Prisma errors, JWT errors, and JSON SyntaxError. multer throws a MulterError (e.g. code LIMIT_FILE_SIZE when a file exceeds the 10MB cap, LIMIT_UNEXPECTED_FILE for the wrong field, or the generic Error('Only PDF files are accepted') from the fileFilter in uploadRoutes.ts). None of these are AppError instances, so they fall through to statusCode 500 and, in production, the GENERIC_ERROR_MESSAGE. A user who uploads an 11MB PDF gets an opaque 500 'unexpected error' rather than a clear 413/400 'file too large' / 'unsupported type'. This is a correctness/UX defect (not a security hole), and it can mask legitimate client mistakes as server failures and pollute error logs/alerts at 5xx severity.
- **Fix:** Add a MulterError branch to errorHandler (map LIMIT_FILE_SIZE -> 413 'File too large', other codes -> 400) and treat the fileFilter rejection as a 400 (e.g. throw a ValidationError from a wrapper instead of a bare Error). This returns accurate status codes and keeps these client errors out of 5xx logging.

### 52. [bug] SBC extraction model 'claude-sonnet-4-20250514' is missing from the cost-tracker PRICING table → silent fallback masks future mispricing _(verifier: severity adjusted from medium)_

- **Location:** `backend/src/services/aiCostTracker.ts:15-18,33`
- **Issue:** sbcExtraction.ts calls `model: 'claude-sonnet-4-20250514'` (sbcExtraction.ts:808) and forwards `response.model` (which the API echoes back as `claude-sonnet-4-20250514`) to trackAIUsage (sbcExtraction.ts:846-849). That model key is absent from the PRICING map, which only contains 'claude-haiku-4-5-20251001' and 'claude-sonnet-4-5-20250929'. trackAIUsage therefore silently falls back to `PRICING['claude-sonnet-4-5-20250929']` (line 33). Today Sonnet-4 and Sonnet-4.5 happen to share $3/$15 per Mtok so the logged dollar figure is coincidentally correct, but the design is fragile: any model whose real price differs from the Sonnet-4.5 default (e.g. an Opus or future model added to a call site, or an Anthropic price change for Sonnet-4) would be logged at the wrong cost with no warning, defeating the cost-monitoring purpose. The fallback hides the misconfiguration instead of surfacing it.
- **Fix:** Add an explicit `'claude-sonnet-4-20250514': { input: 3.0/1e6, output: 15.0/1e6 }` entry. Change trackAIUsage to emit a `logger.warn('Unknown model in PRICING table', { model })` (or log estimatedCostUsd as null) when `PRICING[record.model]` is undefined instead of silently substituting the Sonnet-4.5 rate, so a missing model is visible in ops rather than absorbed.

### 53. [bug] updateHealthGoal leaves stale completedAt when status reverts from a terminal state to ACTIVE/PAUSED _(verifier: severity adjusted from low)_

- **Location:** `backend/src/controllers/healthGoalsController.ts:496-501`
- **Issue:** On status change the handler sets completedAt = new Date() only when the new status is ACHIEVED/FAILED/CANCELLED, but never clears completedAt when the status transitions back to ACTIVE or PAUSED. A goal re-activated after being achieved/cancelled retains its old completedAt timestamp, so it still looks 'completed at <date>' while being active — corrupting the getGoalsSummary 'recentlyAchieved' window (which keys off completedAt) and any UI badge.
- **Fix:** Add an else branch setting `updateData.completedAt = null` when the new status is ACTIVE or PAUSED, so the timestamp matches the lifecycle state.

### 54. [bug] bulkCreateBiomarkers refetches created rows by time+name window, risking wrong rows and miscounts

- **Location:** `backend/src/controllers/biomarkerController.ts:539-556`
- **Issue:** Because Postgres createMany cannot return generated IDs, the code refetches with `where: { userId, createdAt: { gte: now-60s }, name: { in: <names> } }` and `take: validBiomarkerData.length`. This is non-deterministic: (1) if the user has pre-existing biomarkers with the same names created in the last 60 seconds (e.g. two lab uploads in quick succession, or a retried request), those older rows are returned instead of / in addition to the new ones; (2) when the batch contains duplicate names, the `name: { in: [...] }` set collapses duplicates so the returned set can be smaller than the number actually inserted, making the returned data, the `succeeded` count in meta, and the audit-log `count` understate reality; (3) cross-request interleaving within the same minute can return another concurrent batch's rows for the same user.
- **Fix:** Insert with deterministic identity — either generate UUIDs application-side and createMany with explicit ids then refetch by `id: { in: ids }`, or replace createMany with a `$transaction` of individual `create` calls (which return the row) when the result rows are needed. Avoid time-window heuristics.

### 55. [bug] analyzeCosts dereferences message.content[0] without guarding an empty content array

- **Location:** `backend/src/controllers/expenseController.ts:662`
- **Issue:** After the Claude call, the code reads `message.content[0].type === 'text' ? message.content[0].text : ''`. If the API ever returns an empty content array (e.g. an unusual stop reason or a malformed response that still resolves the promise), `message.content[0]` is undefined and `.type` throws a TypeError. That falls through to the central error handler as a generic 500 after the (paid) API call already succeeded, instead of degrading gracefully.
- **Fix:** Guard the access: `const first = message.content[0]; const rawClaudeResponse = first && first.type === 'text' ? first.text : '';` so an empty/non-text content array yields an empty narrative rather than a 500.

### 56. [bug] AddMeasurementModal isSubmitting guard is reset synchronously, so it never blocks double-submit

- **Location:** `src/components/biomarkers/AddMeasurementModal.tsx:63-89`
- **Issue:** handleSubmit sets isSubmitting=true, calls onAdd(...), then synchronously calls onClose() and setIsSubmitting(false) in the same handler. onAdd (handleAddMeasurement) is async but is not awaited, and the modal is closed immediately, so the disabled state lasts only until React re-renders after this synchronous tick. The comment at line 43-44 claims this guards against double-click duplicates during the async save, but because isSubmitting is flipped back off (and the modal unmounts) within the same call, it provides no real protection — and the rapid setIsSubmitting(true) then setIsSubmitting(false) in one tick is effectively a no-op for the button. Practically the immediate onClose() is what prevents a second click, so the guard is misleading dead logic rather than the intended async lock.
- **Fix:** If a true async guard is desired, make handleSubmit async, await onAdd(...), and only setIsSubmitting(false) in a finally block, closing the modal on success. Otherwise drop the misleading isSubmitting logic and rely on onClose().

### 57. [bug] biomarkersApi.getGuidance (AI/Claude call) uses the default 30s timeout while other AI endpoints use 60s

- **Location:** `src/services/api/biomarkers.ts:118-123`
- **Issue:** getGuidance triggers a server-side Claude generation but calls apiFetch without an extended timeout, so it inherits DEFAULT_TIMEOUT_MS = 30000 (client.ts:12). The other AI/long-running endpoints were given 60s budgets (expenses.analyzeCosts: 60000 at expenses.ts:211; insurance SBC upload/reanalyze: 60000). A slow Claude guidance response will hit the 30s AbortController and surface TIMEOUT_ERROR even though the backend may still be working — inconsistent with the AI-timeout handling elsewhere and a likely-missed endpoint in that effort. BiomarkerAIGuidance handles the resulting error and offers Retry, so it degrades gracefully, but the timeout ceiling is too low for an LLM call.
- **Fix:** Pass an extended timeout (e.g. 60000) as the third arg to apiFetch for getGuidance, matching analyzeCosts and the SBC upload paths.

### 58. [bug] AddMeasurementModal accepts any numeric value with no clinical sanity bounds and no min<max validation on custom ranges

- **Location:** `src/components/biomarkers/AddMeasurementModal.tsx:125-172`
- **Issue:** Manual measurement entry uses `<input type="number" step="0.1">` with no min/max and no validation, so negatives, zero, or absurd values (e.g. a mistyped extra digit) are accepted and stored, then drive the dashboard 'Needs Attention' counts and trend math. The custom Normal Range editor lets the user enter min and max independently with no check that min < max; a min >= max produces a nonsensical range and BiomarkerRangeBar.tsx:26 silently renders nothing (`if (max <= min) return null`), so the user gets no feedback. trendCalculations also divides by the oldest value with only a zero guard. For a health-data product, light input validation prevents bad data and confusing trends.
- **Fix:** Add per-biomarker plausibility bounds (or at minimum reject non-positive values for measures that can't be <=0), validate min < max in the custom range editor with an inline error, and show a confirm step for values far outside the reference range. Effort: ~3-4 hours.

### 59. [bug] Trends time-range filter can hide a biomarker's current reading and miscount 'trend data' (≥1 history entry shown as trackable) _(verifier: severity adjusted from low)_

- **Location:** `src/components/trends/TrendsPage.tsx:75-83,110-111,150-151`
- **Issue:** filterByTimeRange filters only history entries by cutoff date but never the biomarker's own current value/date — so selecting '30d' can leave a card whose latest reading is months old while its older history points get dropped, producing a sparkline/percentage computed from a partial window that excludes the most recent point's neighbors. Separately, hasEnoughData is `(b.history?.length || 0) >= 1` (line 110) and the header counts these as 'biomarkers with trend data' (line 151), but a single history point plus the current value is the bare minimum for a 2-point trend; the empty-state copy elsewhere says '2+ readings' (line 293), so the threshold and the messaging disagree. Minor, but it makes the trackable count and 'Stable/Improving' labels less trustworthy.
- **Fix:** When time-filtering, also exclude biomarkers whose current reading falls outside the window (or annotate 'latest reading is older than selected range'); align the hasEnoughData threshold (>=1 history + current = 2 points) with the '2+ readings' messaging or fix the copy. Effort: ~2-3 hours.

### 60. [compliance] No confirmation email or session/data-deletion notice on account or all-data deletion

- **Location:** `backend/src/controllers/settingsController.ts:877-966`
- **Issue:** deleteAccount and deleteAllData are irreversible, security-sensitive operations (they wipe all PHI and, for deleteAccount, the user record + GCS files + lab OAuth tokens). They require a password and are audit-logged, but no confirmation email is sent to the account owner — emailService is not imported here (grep for emailService/sendEmail in this controller returns nothing). For a destructive account action, an 'your account/data was deleted' email is a standard safeguard against account-takeover-driven destruction and a useful user-facing receipt. Notably the app already considers this important for less-destructive flows (verification + password-reset emails exist).
- **Fix:** Send a transactional 'account deleted' / 'all health data deleted' confirmation email via emailService after a successful deletion (best-effort, swallow errors so it can't block the delete). Effort: ~2 hours.

### 61. [dependency] express-rate-limit 8.3.2 bundles vulnerable ip-address (SSRF) — patch available in 8.5.2 _(verifier: severity adjusted from medium)_

- **Location:** `backend/package.json:30`
- **Issue:** express-rate-limit@8.3.2 depends on ip-address@10.1.0, which npm audit flags moderate (range <=10.1.0). This is the library the rate limiter uses to parse client IPs for keying buckets; a malformed IP/proxy header can be mishandled. express-rate-limit 8.5.2 is published and resolves the transitive advisory with no breaking API change (it is a minor/patch bump within the 8.x line).
- **Fix:** Run `npm install express-rate-limit@^8.5.2` (already within the declared ^8 caret, low risk) and re-audit.

### 62. [dependency] bcryptjs 2.4.3 is an abandoned major line; v3.x is the maintained release

- **Location:** `backend/package.json:24`
- **Issue:** bcryptjs is pinned to ^2.4.3 (released 2017, end of the 2.x line). The maintained line is 3.x (3.0.3 available). bcryptjs is used for password hashing in authService.ts and admin password setting in adminRoutes.ts, so keeping it on a stale, unmaintained major version is avoidable security debt. v3 is a small breaking change (drops Node <16, ESM/exports cleanup) but the `bcrypt.hash`/`bcrypt.compare` API used here is unchanged.
- **Fix:** Upgrade to bcryptjs@^3.0.3 (also bump @types/bcryptjs) and run the auth unit tests in authService.test.ts. Low effort. Alternatively consider native `bcrypt` only if a build toolchain is acceptable on Cloud Run; bcryptjs@3 avoids native compilation, which is the safer choice for the OneDrive/ARM64 build environment.

### 63. [dependency] uuid pinned to v9 (only v4 used) — v9 transitively flagged, trivial migration to v11+

- **Location:** `backend/package.json:38`
- **Issue:** uuid is pinned to ^9.0.1. npm audit lists the direct uuid as moderate (range <11.1.1) and also flags older transitive uuid copies (8.3.2/9.0.1) inside @google-cloud/storage's gaxios/teeny-request. Only the named import `v4 as uuidv4` is used, so a major bump to uuid@11 (or current 14) is a near-zero-effort code change (the v4 API is unchanged).
- **Fix:** Upgrade direct uuid to ^11 (or current 14) and @types/uuid accordingly; v4 import is API-compatible. The transitive copies clear once @google-cloud/storage is updated.

### 64. [feature] Account Settings notification preferences cover email only — no in-app/push channel and no per-channel cadence control

- **Location:** `src/components/settings/NotificationSettingsSection.tsx:42-48`
- **Issue:** Notification settings expose only an email master switch plus 5 email sub-toggles. There is no in-app notification surface or preference, no SMS/push option, and no cadence control (e.g. 'weekly summary' is fixed to Monday per the copy with no day/frequency choice). For a tracking product whose retention depends on nudges, this is thin. The backend stores a JSON notificationPreferences blob that could accommodate channels, so the model is extensible. (Reported as a feature improvement, not a defect — the existing email flow is correct and persists optimistically.)
- **Fix:** Introduce a channel dimension (email / in-app / push) in notificationPreferences and a small in-app notification center; allow weekly-summary day selection. Stage behind the existing JSON shape. Effort: ~2-3 days including an in-app notifications surface; ~half a day for just cadence controls.

### 65. [feature] Greeting/display name derived from email local-part shows raw username (e.g. 'jane.doe123') across dashboard until profile loads

- **Location:** `src/components/dashboard/DashboardContent.tsx:123-124`
- **Issue:** The dashboard welcome header builds the greeting from `user?.email?.split('@')[0]` directly, so a user whose email is jane.doe123@... is greeted 'Welcome back, jane.doe123'. The OnboardingWizard already has a getGreetingName helper (OnboardingWizard.tsx:58-66) that capitalizes the leading token, and the real first name is available via settingsApi.getProfile, but DashboardContent uses neither. The result is an unpolished first impression on the primary screen and inconsistent naming between onboarding ('Jane') and the dashboard ('jane.doe123').
- **Fix:** Use the saved profile firstName when available (fetch once / hoist via context), falling back to the shared getGreetingName helper for the email local-part rather than the raw username. Effort: ~1-2 hours.

### 66. [infra] Node runtime fragmentation: engines >=18, Docker node:20, local Node 24, @types/node pinned to 20

- **Location:** `backend/package.json:52,68-70`
- **Issue:** The backend declares engines.node >=18.0.0, builds/runs in Docker on node:20-alpine, but the local dev machine is on Node v24.11.1, while @types/node is pinned to ^20 (resolved 20.19.27, latest 25.9.1). This three-way drift means type-checking is done against Node 20 typings while code may run on Node 18/20/24 depending on environment, and the loose >=18 floor allows EOL Node 18 (security support ended) to satisfy engines. There is no .nvmrc to pin a version.
- **Fix:** Pick one supported LTS (Node 20 or 22), set engines.node to a matching range (e.g. ">=20 <23"), align @types/node to that major, bump the Docker base to node:22-alpine (Node 20 enters maintenance), and add a .nvmrc so local dev matches CI/prod. Raise the engines floor off EOL Node 18.

### 67. [infra] CI has no secret-scanning step; pre-commit hook runs only lint-staged

- **Location:** `.github/workflows/ci.yml:91-116`
- **Issue:** The CI 'security' job runs `npm audit --audit-level=high` (frontend+backend) and an RLS-wrapper guard, but performs no secret scanning (e.g. gitleaks/trufflehog). The pre-commit hook (.husky/pre-commit) is only `npx lint-staged`. Given that backend/.env holds real secrets in the working tree and example files carry credential literals, a single mis-edit to .gitignore or an `git add -f` would commit live secrets with nothing in CI or the hook to catch it. This is a process gap rather than an active vulnerability.
- **Fix:** Add a secret-scanning step to the CI security job (gitleaks or trufflehog) and a pre-commit secret scan, configured to detect SG./sk-ant-/PEM keys/hex PHI-key patterns and to fail on any tracked .env (other than .example).

### 68. [quality] Password reset and admin password reset rotate sessions, but change-password issues new tokens without preserving demo flag and after revoking all sessions there is a brief window where the old access JWT still validates

- **Location:** `backend/src/controllers/authController.ts:515-525`
- **Issue:** changePassword calls revokeAllUserTokens(user.id) (deletes all refresh-session rows) and then issues a fresh access+refresh pair. Two minor issues: (1) the new refresh cookie is set via setRefreshTokenCookie(res, tokens.refreshToken) without the isDemo flag, so a demo user changing password loses the extended cookie duration — cosmetic. (2) More relevant: because the route-auth middleware does not blacklist access tokens (see the high finding), any OTHER device's still-cached access token for this user remains valid for up to 15 minutes after the password change, even though its refresh session row was deleted. The intended 'force re-login on all devices' is only enforced at the refresh boundary, not immediately. This is the same root cause as the access-token-blacklist gap; flagging here because change-password explicitly advertises 'force re-login on all devices'.
- **Fix:** Pass isDemoUser(updatedUser!) to setRefreshTokenCookie for consistency, and resolve the access-token immediate-revocation gap centrally (see high finding) so 'logout everywhere' / password change actually terminates live access tokens rather than waiting for the 15-min expiry.

### 69. [quality] Failed PHI decryption is silently coerced to null in bulk read paths, masking key/integrity problems _(verifier: severity adjusted from low)_

- **Location:** `backend/src/services/encryption.ts:357-384`
- **Issue:** decryptFields() (and the per-field catch blocks in healthGoalsController, insuranceController, healthContextService) replace any field that fails GCM auth-tag verification with null and log at error/warn. This is a deliberate UX choice, but combined with the legacy-iteration fallback in decrypt() it means a master-key rotation that missed rows, or a wrong PHI_ENCRYPTION_KEY, degrades to large swaths of silently-nulled PHI returned to the client/export rather than a hard failure. For an export endpoint, a user could receive a 'complete' data export with PHI silently missing. The behavior is correct for isolated bit-rot but has no aggregate alerting threshold.
- **Fix:** Keep the null-coercion for single-field resilience, but add an aggregate signal (e.g. count decrypt failures per request and emit a CRITICAL audit/log if the ratio exceeds a small threshold) so a systemic key problem is detected rather than silently returning incomplete PHI in exports and reads.

### 70. [quality] pdfRedaction.redactPatientBanner is dead code whose docstring misrepresents an active 'vision fallback' that no longer exists

- **Location:** `backend/src/utils/pdfRedaction.ts:1-90`
- **Issue:** redactPatientBanner is documented as the PHI safeguard that 'runs in the vision fallback path where local text extraction failed — see claudeExtraction.ts and sbcExtraction.ts.' In reality there is no vision fallback: claudeExtraction.ts:86-87 states 'There is deliberately no PDF vision fallback' and both Claude services fail closed to a ValidationError (or regex parser for SBC) when local text extraction is insufficient — they never send a document/vision block. redactPatientBanner is never imported or called anywhere (grep shows only its own definition). This is harmless at runtime (the text path already redacts), but it is misleading dead code: a future maintainer could reintroduce a vision path believing this redaction is wired in and protecting PHI when it is not, and the false 'PHI is covered' assurance is a compliance-documentation hazard.
- **Fix:** Either delete pdfRedaction.ts (and pdf-lib if otherwise unused) or, if a vision fallback is planned, correct the docstring to say it is currently unused and add a test/guard so it is only relied upon once actually wired in. Do not leave a security-relevant helper documented as active when it is dead.

### 71. [quality] FHIR sync/disconnect/connect route params (:connectionId, :id) are not validated as UUIDs

- **Location:** `backend/src/routes/fhirRoutes.ts:38-54`
- **Issue:** The FHIR routes POST /sync/:connectionId and DELETE /connections/:id (and the implicit connect flow) do not apply `validate(schemas.uuidParam,'params')`, unlike every other :id route in the codebase (biomarkers, insurance, expenses, files, patient, provider all validate the param). The handlers pass the raw param into `findFirst({ where: { id: connectionId, userId }})` / `disconnectConnection(userId, id)`. Impact is low because the queries are RLS-scoped and additionally filtered by userId, so a malformed/foreign id simply returns 404 — there is no IDOR or injection (Prisma parameterizes). It is a consistency/robustness gap rather than an exploitable flaw, but it lets malformed input reach the DB layer and produce inconsistent error shapes.
- **Fix:** Add `validate(schemas.uuidParam,'params')` (with an aliased schema for `connectionId`) to the FHIR sync and disconnect routes so malformed IDs are rejected at the boundary, matching the rest of the API and returning a consistent 400 ValidationError.

### 72. [quality] useApiFetch cleanup clears state whenever fetcher changes, and the hooks are dead code

- **Location:** `src/hooks/useApi.ts:69-83,105-201`
- **Issue:** In useApiFetch, the mount effect depends on [immediate, fetchData, clearOnUnmount] and its cleanup runs setState({data:null,...}) when clearOnUnmount is true. Because the cleanup fires on every dependency change (not only on unmount), any change to the fetcher identity — e.g. useBiomarker(id)/useInsurancePlan(id) when id changes — momentarily clears data to null and could race with the new fetch. More importantly, none of the exported hooks in this file (useBiomarkers, useBiomarker, useInsurancePlans, useHealthNeeds, useBiomarkerSummary, etc.) are imported anywhere except the hooks barrel; the live data path uses useBiomarkerData instead. So this is latent/dead code, but it is exported via hooks/index.ts and is a trap for future use.
- **Fix:** Move PHI-clearing cleanup into a separate effect with [] deps (true unmount only), or remove the unused hook set entirely to avoid future misuse. Reset data on fetcher change explicitly inside fetchData rather than via cleanup.

### 73. [quality] CLAUDE.md falsely claims DNA/Genetics models are still in the Prisma schema

- **Location:** `CLAUDE.md:38-41,131`
- **Issue:** CLAUDE.md has a 'Deprecated (Still in Schema)' section stating 'These models remain in schema.prisma but are not actively used: DNA/Genetics: DNAData, DNAVariant, GeneticTrait models'. It also lists 'DNA/Genetic: raw data, variant descriptions, trait names' as encrypted PHI_FIELDS. I grepped schema.prisma for DNAData|DNAVariant|GeneticTrait|model DNA|model Genetic and found NO matches; the only models present are User, Session, UserEncryptionKey, ProviderPatient, UserFile, Biomarker, BiomarkerHistory, InsurancePlan, InsuranceBenefit, HealthNeed, HealthGoal, GoalProgressHistory, AuditLog, SystemConfig, ExpenseProjection, ExpenseActual, CostAnalysis, LabConnection. encryption.ts contains no DNA/genetic references either. The DNA models were removed but the docs still describe them as present, misleading any engineer doing schema or PHI work.
- **Fix:** Delete the 'Deprecated (Still in Schema)' DNA section and the 'DNA/Genetic' bullet from the PHI Encryption field list in CLAUDE.md. They describe removed models.

### 74. [quality] prompts/35-env-vars-doc.md is stale: wrong env var names plus a non-existent config.JWT_SECRET code sample

- **Location:** `prompts/35-env-vars-doc.md:98-102,117,134`
- **Issue:** This prompt doc lists 'JWT_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY', 'CSRF_SECRET', 'SENDGRID_FROM_EMAIL', and 'GOOGLE_CLOUD_PROJECT' — the same wrong names as CLAUDE.md — and even shows a fabricated code sample 'if (!config.JWT_SECRET) throw new Error(...)'. config.JWT_SECRET does not exist; config.jwt.accessSecret/refreshSecret do, and expiry vars are JWT_ACCESS_EXPIRES_SECONDS/JWT_REFRESH_EXPIRES_SECONDS. New Project Documents/ENV_VARS.md L469-L471 already flags this prompt as needing correction.
- **Fix:** Update the prompt to JWT_ACCESS_SECRET/JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRES_SECONDS/JWT_REFRESH_EXPIRES_SECONDS, EMAIL_FROM, GCP_PROJECT_ID; remove CSRF_SECRET and the fictitious config.JWT_SECRET code sample.

### 75. [quality] Eight frontend exports are dead code (never imported by any consumer)

- **Location:** `src/services/api/index.ts:49,52,56,60`
- **Issue:** Confirmed unused (only declared + barrel-re-exported, zero consuming references): (1) src/services/api/upload.ts uploadApi, (2) src/services/api/admin.ts adminApi, (3) src/services/api/patient.ts patientApi, (4) src/services/api/provider.ts providerApi — grepping for 'adminApi.', 'patientApi.', 'providerApi.', 'uploadApi.' outside their own files returns nothing, and no named import of them exists. (5) src/components/common/UploadZone.tsx UploadZone — only re-exported in common/index.ts, never rendered. (6) src/components/common/RoleGuard.tsx RoleGuard and (7) src/hooks/useRBAC.ts useRBAC — RoleGuard is only self-referenced by its own convenience wrappers and re-exported; useRBAC is only consumed by RoleGuard.tsx; nothing outside imports RoleGuard, so the whole RBAC-guard chain is dead. (8) src/components/insurance/InsuranceGuide.tsx InsuranceGuide and InsuranceUtilizationTracker — only barrel-exported in insurance/index.ts, never used as JSX and not lazy-loaded (the matching imports elsewhere are for the unrelated PersonalizedInsuranceGuide *type*). This is shippable-but-unused surface area that inflates bundle/maintenance cost and may mask the fact that RBAC UI gating is not actually wired up.
- **Fix:** Either wire these into the UI (especially RoleGuard/useRBAC if client-side role gating is intended) or delete the dead modules and their barrel exports. Consider adding a CI dead-export check (e.g. knip/ts-prune) to prevent regrowth.

### 76. [quality] Stray Windows reserved-name file 'nul' left in repo root with garbage shell output

- **Location:** `nul:1-2`
- **Issue:** The repo root contains a 106-byte file literally named 'nul', containing accidental shell error output ('dir: cannot access '/s': No such file or directory'). 'nul' is a reserved device name on Windows and a file with that name can break Windows tooling, archive extraction, and git operations on Windows checkouts. It is gitignored (and not git-tracked), but it remains in the working tree as clutter and was presumably created by a misfired command writing to 'nul'.
- **Fix:** Delete the stray 'nul' file from the working tree (on Windows, remove via 'del \\.\\%cd%\\nul' or from WSL/Git Bash 'rm ./nul'). It serves no purpose.

### 77. [quality] Bespoke modals (AddMeasurement, TrendDetail, delete-confirmation) duplicate overlay logic and miss Escape-to-close / scroll-lock the shared Modal provides

- **Location:** `src/components/biomarkers/AddMeasurementModal.tsx:91-95`
- **Issue:** Several dialogs render their own `fixed inset-0 bg-black ...` overlay instead of using the shared Modal component. As a result they inherit none of Modal's behaviors: AddMeasurementModal.tsx and the AccountSettingsPage delete-confirmation modal do not close on Escape and do not lock body scroll, and clicking the backdrop does not dismiss them (no onClick on the overlay). This is inconsistent UX versus dialogs that do use Modal, and is the root cause of the a11y gap above. TrendDetailModal similarly hand-rolls the overlay. Consolidating reduces drift and centralizes the a11y fix.
- **Fix:** Migrate AddMeasurementModal, TrendDetailModal, and the AccountSettingsPage delete-confirmation modal to the shared Modal component (or extract a useModalBehavior hook) so Escape, scroll-lock, backdrop-dismiss, and ARIA come for free. Effort: ~half a day.

### 78. [security] Timing-attack dummy hash uses 12 bcrypt rounds while real hashing uses 13, leaking user existence via response time

- **Location:** `backend/src/services/authService.ts:743-750`
- **Issue:** The timing-attack mitigation for non-existent users compares against a hardcoded $2a$12$ hash (12 rounds), but real passwords are hashed with config.security.bcryptRounds which defaults to 13 (config/index.ts:100). bcrypt cost is exponential, so a 13-round verify takes ~2x the wall-clock time of the 12-round dummy compare. This makes the 'existent vs non-existent' response time measurably different — partially defeating the very timing protection the code is implementing. The 0-50ms random jitter added afterward only partially masks a difference of this magnitude (a 13-round bcrypt on modern hardware is on the order of ~100-250ms).
- **Fix:** Generate the dummy hash at startup using the same config.security.bcryptRounds (e.g. bcrypt.hashSync('timing-attack-prevention-password', config.security.bcryptRounds)) so the comparison cost always matches the live cost, instead of a hardcoded 12-round constant. Keep the random jitter as defense-in-depth.

### 79. [security] demoLogin endpoint gated only on demo.enabled, not isDevelopment — inconsistent with attemptLogin's demo bypass guard

- **Location:** `backend/src/controllers/authController.ts:547-588`
- **Issue:** demoLogin guards solely on config.demo.enabled, whereas attemptLogin's privileged demo bypass (which resets lockout/failed attempts and force-verifies the account) requires both config.demo.enabled AND config.isDevelopment (authService.ts:692). In staging (NODE_ENV=staging, where demo.enabled is permitted per config/index.ts:344-351), POST /auth/demo will call attemptLogin, miss the dev-only bypass, and fall through to the normal credential path against config.demo.password. That normal path is correct/secure, so this is not an auth bypass — but the demo account's known credentials (config.demo.password) are then brute-forceable through the normal flow in staging with no special-casing, and the /auth/demo route has NO strictAuthLimiter (authRoutes.ts:57 mounts it with only the 20/15min authLimiter, unlike /login which adds the 5/15min strictAuthLimiter). The endpoint should either be dev-only or carry the same brute-force protection as /login.
- **Fix:** Gate demoLogin on config.isDevelopment (matching the attemptLogin bypass), or at minimum apply strictAuthLimiter to /auth/demo so the known demo credentials in staging are not brute-forceable at 20 attempts/15min. Confirm the demo password is high-entropy in staging.

### 80. [security] Audit systemSalt can be empty ('') if encryptValue runs before initialize(), producing a fixed degenerate key

- **Location:** `backend/src/services/auditLog.ts:99, 120-127, 188-199`
- **Issue:** AuditLogService.systemSalt is initialized to '' and only set to config.auditSalt inside initialize(). encryptValue() uses this.systemSalt with no guard. database.ts wires initialize() into a required boot step, and config hard-fails if AUDIT_LOG_SALT is absent, so the live window is narrow — but getAuditService()/getAuditLogService() return the singleton regardless of whether initialize() has completed. If any audit write occurs before initialize() (e.g. a future caller, or a code path that constructs the service directly), encrypt(value, '') would run Buffer.from('', 'hex') = empty buffer and derive a single fixed key shared across all such rows, undermining the per-deployment salt. There is no assertion that systemSalt is non-empty before use.
- **Fix:** Guard encryptValue()/log() with an invariant that this.systemSalt is non-empty (throw or log CRITICAL if not initialized), so an un-initialized audit service fails loudly instead of encrypting PHI snapshots under a degenerate empty-salt key.

### 81. [security] External target="_blank" links missing rel="noopener noreferrer" (reverse tabnabbing)

- **Location:** `src/components/auth/RegisterPage.tsx:352,354`
- **Issue:** The Terms of Service and Privacy Policy links open in a new tab with target="_blank" but omit rel="noopener noreferrer". A page opened via target="_blank" without noopener receives a populated window.opener reference, letting the opened document navigate the original tab (reverse tabnabbing / phishing). These currently point to internal /terms and /privacy paths so exploitability is low today, but the pattern is unsafe if those routes ever render third-party or user-influenced content. Modern browsers default to noopener for _blank, but explicit rel hardens against older/embedded webviews and keeps the codebase consistent.
- **Fix:** Add rel="noopener noreferrer" to both anchors. Consider an ESLint rule (react/jsx-no-target-blank) to enforce this project-wide.

### 82. [test] CLAUDE.md says backend testing is Jest, but the backend uses Vitest

- **Location:** `CLAUDE.md:16,214`
- **Issue:** CLAUDE.md states 'Testing: Vitest (frontend), Jest (backend)' and the Development Commands say backend 'npm run test  # Run Jest tests'. The backend has no Jest dependency. backend/package.json's test scripts run vitest ('test': 'vitest run', plus test:watch/coverage/unit/integration all on vitest), and devDependencies include vitest@^4.1.5 and @vitest/coverage-v8 — no jest package. All backend test files (e.g. authController.test.ts, rls.test.ts) are Vitest. An engineer following the docs would try to configure/run Jest.
- **Fix:** Change CLAUDE.md to 'Testing: Vitest (frontend and backend)' and update the backend dev command comment to '# Run Vitest tests'.


## INFO severity

### 83. [dependency] npm audit suggests a phantom Prisma DOWNGRADE (7.8.0 -> 6.19.3) for @hono/node-server/@prisma/dev advisory

- **Location:** `backend/package.json:61`
- **Issue:** npm audit reports prisma/@prisma/dev/@hono/node-server as moderate (serveStatic middleware bypass, GHSA-92pp-h63x-v22m in @hono/node-server<1.19.13) and lists fixAvailable as prisma@6.19.3 (isSemVerMajor:true). The project is intentionally on Prisma 7.8.0, so applying `npm audit fix --force` would DOWNGRADE Prisma a whole major version and break the schema/adapter setup. This advisory only affects the @prisma/dev local tooling (a dev-time HTTP server), not the production Prisma client, so it is not a real runtime exposure — but it is a footgun for anyone running automated audit-fix.
- **Fix:** Do NOT run `npm audit fix --force` on the backend (it would downgrade Prisma to 6.x). Treat the @hono/node-server advisory as dev-only/accepted, or wait for a Prisma 7.x patch that bumps the bundled @prisma/dev -> @hono/node-server. Document this as a known false-positive so CI audit gates don't auto-downgrade.

### 84. [dependency] Multiple major upgrades available across the stack (React 19, zod 4, Tailwind 4, Express 5, Vite 8, TS 6, ESLint 10, helmet 8)

- **Location:** `package.json:28-30,54,58,32`
- **Issue:** Both manifests are a full major behind on several core deps. Frontend: react/react-dom 18.3.1 -> 19.x (and @types/react/-dom still 18), vite 7.3 -> 8, tailwindcss 3.4 -> 4 (config/PostCSS-pipeline breaking change), typescript 5.9 -> 6, eslint 9 -> 10, eslint-plugin-react-hooks 5 -> 7, lucide-react 0.344 -> 1.x, recharts already 3.x, tesseract.js 5 -> 7, pdfjs-dist 4.10 -> 5, html2canvas-pro 1.6 -> 2. Backend: zod 3.25 -> 4 (validation API breaking changes; zod is used at all API boundaries), helmet 7.2 -> 8, @anthropic-ai/sdk 0.91 -> 0.100, express 4 -> 5, @types/uuid 9 -> 10, dotenv 16 -> 17. These are deferred-upgrade debt rather than active vulns.
- **Fix:** Sequence as: (1) low-risk in-range patches now (express 4.22.2, express-rate-limit 8.5.2, axios override, helmet 8 is mostly drop-in). (2) Medium: zod 3->4 (run the codemod, retest all Zod schemas at API boundaries), React 18->19 (+ matching @types and @vitejs/plugin-react 6). (3) High-effort/deferred: Tailwind 3->4 (new engine + config format) and Express 4->5 (router/middleware breaking changes) — do these on their own branches with full E2E (Playwright) runs. Keep Prisma on 7.x.

### 85. [infra] @rollup/wasm-node override + optional native rollup binaries kept in sync, but win32-x64 native binary resolves MISSING _(verifier: severity adjusted from info)_

- **Location:** `package.json:61-67`
- **Issue:** Both manifests force rollup to the WASM build via overrides ("rollup": "npm:@rollup/wasm-node@...") — the documented ARM64/OneDrive workaround — while also listing optionalDependencies for the native win32-arm64 and win32-x64 rollup binaries. npm outdated shows @rollup/rollup-win32-x64-msvc resolving as MISSING in both manifests, and the declared versions drift (frontend optional ^4.53.3, backend optional ^4.60.2 for arm64 vs ^4.53.3 for x64) while @rollup/wasm-node itself is behind (frontend 4.53.4, backend 4.55.1, latest 4.60.4). The override means the native optional deps are effectively dead weight that can desync from the WASM version.
- **Fix:** Pick a single rollup version and keep wasm-node + both optional native binaries on it (or drop the optional native binaries entirely since the override forces WASM). Align frontend and backend to the same @rollup/wasm-node (4.60.4) to avoid build-output drift between the two workspaces.

### 86. [quality] logout/clearAuthCookies does not clear the csrf_token cookie

- **Location:** `backend/src/controllers/authController.ts:110-125`
- **Issue:** clearAuthCookies clears access_token and refresh_token but leaves the csrf_token cookie in place on logout. Since CSRF tokens are non-secret double-submit values regenerated on login/refresh, this is not a security vulnerability, but the stale csrf_token persists across logout and is only refreshed on the next GET/login. Minor hygiene gap.
- **Fix:** Clear the csrf_token cookie on logout as well, or explicitly document that it is intentionally retained because it carries no session state.

### 87. [quality] CLAUDE.md claims '6 named rate limiters' but rateLimiter.ts exports 8

- **Location:** `CLAUDE.md:91,196`
- **Issue:** CLAUDE.md describes rateLimiter.ts as '6 named rate limiters' (twice). The actual file exports 8: standardLimiter, authLimiter, strictAuthLimiter, uploadLimiter, sensitiveLimiter, aiLimiter, providerAccessRequestLimiter, bulkOperationLimiter.
- **Fix:** Update the count to 8 in both places in CLAUDE.md.

### 88. [quality] CLAUDE.md project-structure listing of controllers/middleware/services is stale (counts wrong, files renamed/added)

- **Location:** `CLAUDE.md:77-109`
- **Issue:** Several structure claims are out of date: (a) Controllers said '10 files' but lists only 9 and names a top-level 'uploadController.ts' that no longer exists (it was split into controllers/upload/labUploadController.ts and sbcUploadController.ts); also missing aiChatController.ts and fhirController.ts. (b) Middleware '8 files' count is correct but the new planGating.ts (and errorHandler.ts/validation.ts) are unlisted. (c) Services said '18 files' but there are ~23 non-test service files, with many new ones unlisted (aiCostTracker, anthropicClient, biomarkerExtractor, biomarkerPatterns, healthContextService, healthProfileService, notificationService, onboardingService, usageTracker, plus fhir/ and knowledge/ subdirs). These structural drifts misrepresent the surface area for new contributors.
- **Fix:** Regenerate the Project Structure tree from the current filesystem; correct controller/service counts, replace uploadController with the upload/ subdir, and add aiChatController, fhirController, planGating, and the new services.

### 89. [quality] Duplicated US-insurance domain knowledge maintained in two places (frontend education util vs backend Claude knowledge store) _(verifier: severity adjusted from low)_

- **Location:** `src/utils/insurance/insuranceEducation.ts:40-116`
- **Issue:** Insurance-concept content (deductible, copay, coinsurance, out-of-pocket max, premium definitions, and HMO/PPO/EPO/POS/HDHP plan-type guidance, including dollar thresholds) is hand-maintained in the frontend at src/utils/insurance/insuranceEducation.ts (INSURANCE_TERMS) and again, independently, in the backend Claude prompt knowledge store at backend/src/services/knowledge/insuranceKnowledge.ts (PLAN_TYPES content with 2025 IRS HDHP minimums $1,650/$3,300 and ACA OOP caps $8,300/$16,600). The two copies are not shared and will drift — e.g. the backend explicitly notes 'Review and update dollar thresholds annually', but a year-rollover edit there would not propagate to the frontend definitions. They serve different runtimes so cannot be trivially merged, but the overlapping factual content (plan-type semantics, annual dollar limits) is a real maintenance hazard.
- **Fix:** Extract the shared factual thresholds (annual IRS/ACA dollar limits and plan-type definitions) into a single source of truth (e.g. a shared constants module or a generated JSON consumed by both frontend rendering and backend prompt assembly) so the annual update happens once.

### 90. [quality] Stray double-extension scratch file 'scratchpad.md.md' committed-by-name in repo root

- **Location:** `scratchpad.md.md:1-30`
- **Issue:** Repo root contains 'scratchpad.md.md' (double '.md' extension), holding a leftover directory-layout note plus a copy of an old prompt template ('# Database Schema Review ... Flag any security issues'). It is gitignored by exact name (.gitignore line 'scratchpad.md.md'), which itself signals it was an accidental artifact someone chose to ignore rather than delete. It is dev clutter that pollutes the repo root and could confuse contributors about which doc is authoritative.
- **Fix:** Delete scratchpad.md.md; if a scratch file is genuinely needed, use a single-extension name already covered by a broader ignore pattern rather than committing an explicit per-file ignore.

### 91. [security] CSRF exemption is matched by URL suffix (req.path.endsWith), a fragile allowlist

- **Location:** `backend/src/middleware/csrf.ts:127-137`
- **Issue:** validateCsrfToken decides exemption with req.path.endsWith(route) over a list of public/streaming suffixes. Because csrfProtection is mounted at the app root (app.ts:215) before the /api/v1 router, req.path is the full path and the suffix match works for current routes. However, suffix matching is brittle: any future mounted route whose path happens to end with one of these strings (e.g. a nested route ending in '/auth/login' or '/ai/chat') would be silently CSRF-exempted regardless of which middleware actually guards it. Today no such collision exists and /ai/chat correctly pairs with requireBearerAuth, so this is not currently exploitable — noting it as a latent foot-gun.
- **Fix:** Match against the exact normalized path (e.g. a Set of full paths like '/api/v1/auth/login') or anchor the comparison to the mount-relative path, rather than endsWith. This removes the risk that an unrelated future route accidentally inherits a CSRF exemption.

### 92. [security] RLS is inert in dev/staging and the assertion only warns, leaving every isolation guard untested outside production

- **Location:** `backend/src/services/database.ts:243-261`
- **Issue:** assertNoBypassRLS() hard-exits only when config.isProduction is true; in dev and staging a BYPASSRLS role logs a warning and continues, and the project notes the app routinely connects as the superuser there. Consequently all RLS policies are non-enforcing in every non-production environment, the live-DB rls.test.ts (which only runs when DATABASE_URL+PHI_ENCRYPTION_KEY are set) is the only thing that ever exercises real policy behavior, and it covers only own-data and admin paths (not the provider-access policy). This is a known provisioning gap rather than a code defect, but it directly enables the two findings above to ship undetected: the broken has_provider_access() function and the admin-bypass provider reads both behave identically (no error, no leak observed) until a NOBYPASSRLS role is finally used in production. Recorded as a note so the masking effect is explicit.
- **Fix:** Provision a NOBYPASSRLS application role in at least one staging/CI environment and run the RLS regression suite (extended to cover the provider-access policy path) against it before production cutover, so policy regressions surface in CI instead of at production go-live.

### 93. [security] AES-256-GCM uses a 16-byte (128-bit) IV instead of the recommended 96-bit IV

- **Location:** `backend/src/services/encryption.ts:60, 217, 267`
- **Issue:** IV_LENGTH is 16 bytes. GCM is specified and optimized for a 96-bit (12-byte) IV; a 128-bit IV is processed through an extra GHASH step and is slightly more error-prone for collision reasoning, though NOT a vulnerability here because IVs are generated with crypto.randomBytes per call (random 128-bit IVs have negligible collision probability at this scale) and GCM is used with per-message auth tags. Noting for standards alignment only — there is no exploitable defect.
- **Fix:** Optionally standardize on a 12-byte IV for GCM (NIST SP 800-38D recommendation) on new encryption work; existing 16-byte-IV ciphertext remains decryptable since the IV is stored in the envelope. Not required for security at current volumes.

### 94. [security] window.open(blobUrl, '_blank') for file viewing omits 'noopener' _(verifier: severity adjusted from low)_

- **Location:** `src/components/files/FilesPage.tsx:62`
- **Issue:** FilesPage.handleView opens fetched file content in a new tab via window.open(blobUrl, '_blank') without the 'noopener' window feature. The opened blob document can read window.opener and navigate the original (PHI-containing) tab. Because the blob is rendered content derived from a user-uploaded file (e.g. an HTML/SVG file the user uploaded as a 'lab report'), the new tab could execute script and use window.opener to redirect the authenticated session tab to a phishing page. The code needs the window handle (win) to attach the load listener for blob revocation, so the fix is to pass the feature string rather than dropping the handle. (pdfReportGenerator.ts:673 has the same window.open _blank pattern for a generated PDF blob — lower risk since content is app-generated.)
- **Fix:** Pass the noopener feature: `window.open(blobUrl, '_blank', 'noopener')`. Note that with 'noopener' the returned handle is null, so move blob revocation to a fixed setTimeout (which the code already has as a safety net) rather than relying on win.addEventListener('load'). Alternatively render downloads via a temporary <a download> element (as handleDownload already does) instead of opening a tab.

---

## Refuted (checked, dismissed)

- **Biomarker unit strings are double-encoded (mojibake) — 'kg/m²' renders as 'kg/mÂ²'** — The finding claims src/data/measurementOptions.json stores double-encoded UTF-8, with the BMI unit physically stored as 'kg/mÂ²' (i.e., the byte sequence C3 82 C2 B2). I inspected the raw bytes and the file is NOT double-encoded.

Direct byte inspection at the 'kg/m' location (byte offset 56) shows the bytes are: 6b 67 2f 6d c2 b2 ("kg/m" + C2 B2). C2 B2 is the CORRECT single UTF-8 encoding of U+00B2 (SUPERSCRIPT TWO, '²'). Decoded as UTF-8 this is exactly 'kg/m²'. Double-encoding (mojibake) would instead require the 4-byte sequence C3 82 C2 B2, which renders as 'kg/mÂ²'.

A full-file scan found: 3 occurrences of clean C2 B2 (the three '²' superscripts) and ZERO occurrences of C3 82 (the 'Â' that mojibake would produce). The whole file parses as valid UTF-8 JSON (JSON.parse on the utf8 string succeeds).

Enumerating every unit string and decoding as UTF-8 yields only clean values: 'kg/m²', 'g/cm²', '°F', 'mL/min/1.73m²' — none contain any mojibake markers (Â/Ã/â). The reporter's 'evidence' string "kg/mÂ²" is exactly what you get when you decode the correct C2 B2 bytes as Latin-1/Windows-1252 instead of UTF-8 (slice.toString('latin1') in my test returned literally 'kg/mÂ²'). So the reporter dumped the file with the wrong codec; the on-disk data is clean. There is no user-visible corruption and nothing to fix.
