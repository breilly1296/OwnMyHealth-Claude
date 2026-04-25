---
doc: STRATEGY
purpose: Product + business-direction reference — mission, feature map, roadmap, strategic decisions
audience: Claude Project answering "what is this product and where is it going"
updated: 2026-04-24
sources_verified:
  - CLAUDE.md (Current Features / Removed Features / Deprecated / Critical Rules)
  - README.md (product description, feature table)
  - git log --since='6 months ago' (347 commits, 1 PR-merge line + 74 PR numbers in commit titles)
  - New Project Documents/ARCHITECTURE.md, DATA_MODEL.md, API_REFERENCE.md, FRONTEND_MAP.md, SECURITY_STATUS.md, CHANGELOG.md
---

# STRATEGY.md — OwnMyHealth Product & Business Direction

> This doc is the single reference for what OwnMyHealth is, who it serves, what's shipped, what's coming, and the strategic decisions behind those choices. Every feature claim cites concrete backend code (routes + models) **and** frontend evidence (component or gap). When frontend and backend disagree, we report both honestly.

---

## 1. Mission / vision

### Code-derived product description (quoted verbatim)

From [`CLAUDE.md:3-4`](../CLAUDE.md):

> "Privacy-first HIPAA-compliant health biomarker tracking platform with insurance document management, AI-powered guidance, provider-patient collaboration, and expense tracking. Focused on secure tracking of health metrics with Claude AI educational insights, insurance cost analysis, and provider data sharing via consent-based access control."

From [`README.md:3`](../README.md):

> "A privacy-first, HIPAA-compliant health biomarker tracking platform with insurance document management. Built for patients managing chronic conditions like osteoporosis."

### Working mission (derived, one sentence)

**Give patients full ownership of their health data — biomarkers, insurance, expenses — and let Claude AI educate (never diagnose) on top of that data, while keeping PHI under AES-256-GCM + RLS with BAA-gated third-party access.**

### Vision

**TBD** (external: crisp one-paragraph vision statement beyond code-derived description — resolution path: project owner interview; if unavailable, continue using §1 "Working mission" as the operational statement).

---

## 2. Core principles

Each principle is enforced by a specific code artifact. No principle is merely aspirational.

| # | Principle | Enforcer (file:line) | Code evidence |
|---|---|---|---|
| 1 | **Privacy-first — never localStorage for sensitive data** | [`CLAUDE.md:115`](../CLAUDE.md) + `src/services/api/client.ts:10,65` | Access token stored **in-memory only** (module-scoped `authToken`); refresh-token in httpOnly cookie only. See [`FRONTEND_MAP.md:410`](./FRONTEND_MAP.md). |
| 2 | **All PHI encrypted before DB write (AES-256-GCM, per-user key)** | `backend/src/services/encryption.ts:57-61,263-279` + `services/userEncryption.ts:29-137` | Master key validation rejects 3 known-insecure constants in every env (`encryption.ts:129-141`); per-user salt via PBKDF2-SHA512 @ 600k iters. 36 encrypted columns in schema. |
| 3 | **Every PHI access audit-logged (7-year retention)** | `backend/src/services/auditLog.ts:9,475-503` (retention cleanup) + `schema.prisma:657` (`AuditAction` enum) | `RETENTION_DAYS=2555`; daily scheduler deletes rows older than 7y. Controller call sites: `biomarkerController.ts:160,273,363,409,442`. |
| 4 | **Row-Level Security at the DB** | `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:68-83` + `services/database.ts:456-483` | 16 tables with RLS ENABLE; `withRLSContext` sets `app.current_user_id` in-transaction. **Open caveat**: app currently runs as BYPASSRLS role — see [SECURITY_STATUS.md#c-8](./SECURITY_STATUS.md#2-open-findings). |
| 5 | **Consent-first provider sharing — explicit patient approval required** | `backend/prisma/schema.prisma:568-574` (`ProviderPatientStatus` enum) + `middleware/rbac.ts:205-258` (`checkProviderPatientAccess`) | State machine `PENDING→ACTIVE→…` enforced both at app layer and via DB helper `has_provider_access(user_id, permission_type)` at `migration.sql:39-62`. See §6. |
| 6 | **AI is educational, not diagnostic — disclaimers required** | [`CLAUDE.md:175-178`](../CLAUDE.md) Product Guidelines + `services/claudeExtraction.ts:118-120` BAA gate | Every AI endpoint gated by `config.anthropic.baaActive`; Claude responses tagged with `disclaimer` field in the guidance controller. Demo accounts blocked from AI entirely via `blockDemoAI` (`middleware/demoProtection.ts:164-175`). |
| 7 | **User owns their data — export + deletion required** | `backend/src/controllers/settingsController.ts` (`deleteAllData`, `deleteAccount`) + `services/storageService.ts:204-223` (`deleteFiles` batch GCS op) | C-6 closure (`0f7970a`, PR #37, 2026-04-16) guarantees GCS objects are removed on account/data deletion. |
| 8 | **BAA-gated third parties — no PHI crosses a line without a signed agreement** | `backend/src/config/index.ts:245-258` (prod hard-fail) + `services/claudeExtraction.ts:118-120` (runtime block) | Anthropic BAA signed 2026-04-16 (commit `2bd7e36`); production boot hard-fails if `ANTHROPIC_API_KEY` set without `ANTHROPIC_BAA_ACTIVE=true`. |

---

## 3. Target user

### Primary persona (derived from features)

A **patient managing a chronic condition** (README explicitly calls out osteoporosis at `README.md:3`) who needs to:

| Need | Evidenced by |
|---|---|
| Track biomarker values + normal ranges over time | `Biomarker` + `BiomarkerHistory` models ([DATA_MODEL.md#biomarker](./DATA_MODEL.md)); `biomarkerRoutes.ts` 15 endpoints |
| Store insurance plans, read their SBCs without effort | `InsurancePlan` + `InsuranceBenefit` models; `insuranceApi.uploadSBC` ([FRONTEND_MAP.md:474](./FRONTEND_MAP.md)); SBC Claude extraction at `services/sbcExtraction.ts:325` |
| Forecast and track medical expenses against a deductible | `ExpenseProjection`, `ExpenseActual`, `CostAnalysis` models (see [DATA_MODEL.md](./DATA_MODEL.md) §ExpenseActual/§ExpenseProjection) |
| Set health goals tied to biomarkers and journal progress | `HealthGoal`, `GoalProgressHistory` models; `GoalTrackerPanel` component |
| Ask AI educational questions over their own health data | `aiRoutes.ts` streaming `/ai/chat` SSE (`HealthGuidePage`) |

### Secondary personas (backend-ready, frontend-pending)

CLAUDE.md's "Roles & Access Control" table (lines 269-274) names three personas — PATIENT, PROVIDER, ADMIN — but the frontend tree only serves PATIENT. See §4 Feature map for the gap.

- **PROVIDER** — backend has 15 endpoints (`providerRoutes.ts`), model (`ProviderPatient`), and RBAC (`rbac.ts:31-56`). Frontend: **no components** consume `providerApi` ([FRONTEND_MAP.md#10-drift-findings](./FRONTEND_MAP.md) §10.1).
- **ADMIN** — backend has admin routes + `adminApi` client. Frontend: **no admin-panel component** exists in `src/components/` despite CLAUDE.md listing "Admin Panel" as a Current Feature.

### Explicit demographic/psychographic persona

**TBD** (external: detailed persona specs — age bracket, tech comfort, caregiver vs self-managed split, condition mix beyond osteoporosis — resolution path: project-owner interview or user-research doc; nothing in the repo fixes these).

---

## 4. Feature map

### 4.1 Shipped (backend + frontend)

Every row cites both a backend code artifact **and** a frontend consumer. If the frontend is missing, the feature is split into §4.2 or §4.3.

| Feature | Backend evidence | Frontend evidence | Status |
|---|---|---|---|
| **Biomarker tracking** (manual entry, history, trends, normal ranges, in-range indicator) | `routes/biomarkerRoutes.ts` (15 endpoints per [API_REFERENCE.md](./API_REFERENCE.md)); `Biomarker` + `BiomarkerHistory` models ([DATA_MODEL.md](./DATA_MODEL.md)) | `src/components/biomarkers/` (9 components incl. `BiomarkerChart`, `AddMeasurementModal`, `TrendModal`) + `src/components/trends/` ([FRONTEND_MAP.md §2.3, §2.11](./FRONTEND_MAP.md)) | Shipped |
| **AI biomarker guidance** (Claude, educational) | `POST /api/v1/biomarkers/guidance` (`biomarkerRoutes.ts:120-122`: `aiLimiter` + `blockDemoAI` + `requirePlanLimit('aiGuidancePerDay')`); `services/claudeExtraction.ts:57,118-120` | `BiomarkerAIGuidance` (`src/components/trends/BiomarkerAIGuidance.tsx:36`) calls `biomarkersApi.getGuidance` | Shipped |
| **Insurance SBC upload + Claude extraction** | `uploadRoutes.ts` → `sbcUploadController`; `services/sbcExtraction.ts:325`; `InsurancePlan` + `InsuranceBenefit` models | `InsuranceSBCUpload`, `EnhancedInsuranceUpload`, `AddInsurancePlanModal` ([FRONTEND_MAP.md §2.8](./FRONTEND_MAP.md)) | Shipped |
| **Insurance plan management** (CRUD + re-analyze) | `routes/insuranceRoutes.ts` (`insuranceApi.*`); `POST /insurance/:id/reanalyze` | `InsuranceHub`, `InsurancePlanDetail`, `InsurancePlanCard`, `InsurancePlanCompare` | Shipped |
| **Expense projections** (forecast future costs vs plan) | `routes/expenseRoutes.ts`; `ExpenseProjection` model ([DATA_MODEL.md](./DATA_MODEL.md)) | `ExpenseProjectionModal`, `CostOptimization` | Shipped |
| **Expense actuals** (record real claims) | `routes/expenseRoutes.ts` actuals endpoints (PR #56, `92fd090`, 2026-04-17); `ExpenseActual` model | `ExpenseActualModal`, `ExpenseActualsList` | Shipped |
| **AI cost analysis** (Claude over projections + plan) | `expenseRoutes.ts POST /analyze`; `CostAnalysis` model (`claudeResponse` encrypted); `aiLimiter` + `blockDemoAI` + plan gating | `CostOptimization` (`src/components/insurance/CostOptimization.tsx:147`) → `expensesApi.analyzeCosts` | Shipped |
| **Health goals** (numeric goal + progress history) | `routes/healthGoalsRoutes.ts`; `HealthGoal` + `GoalProgressHistory` models; `targetValueEncrypted` migration `20260420_encrypt_health_goal_target` | `GoalTrackerPanel` (`src/components/analytics/GoalTrackerPanel.tsx:170`) | Shipped |
| **Health needs** (tasks / conditions / follow-ups) | `routes/healthNeedsRoutes.ts`; `HealthNeed` model; AI analyze endpoint | `HealthNeedsPage` (`src/components/health/HealthNeedsPage.tsx:82`) | Shipped |
| **AI Health Guide chat** (streaming SSE conversational AI) | `routes/aiRoutes.ts` `/ai/chat`; `services/knowledge/` + `healthContextService`; `requireBearerAuth` + CSRF exempt (`csrf.ts:126-148`) | `HealthGuidePage` (`src/components/health/HealthGuidePage.tsx:86`) calls `aiApi.chat` | Shipped (2026-04-17, PRs #58/#59/#60) |
| **Self-reported health profile** (conditions, meds, family history — fuels AI context) | `services/healthProfileService`; migration `20260418_add_health_profile` | `HealthProfileSection` (`src/components/settings/HealthProfileSection.tsx:136`) | Shipped (2026-04-17, PR #60) |
| **File upload + OCR** (lab reports PDF + image) | `uploadRoutes.ts` `/upload/lab-report`, `/upload/lab-results-ocr`; `services/ocrService.ts:283` (Google Document AI); `services/pdfTextExtraction.ts`; `services/storageService.ts` (GCS) | `LabUploadModal`, `ClinicalFileUpload`, `PDFUploadModal` + `FilesPage`/`FileCard` for management | Shipped |
| **File management** (list/download/delete with signed URLs) | `routes/fileRoutes.ts`; `storageService.ts:104-154` (15-min signed URLs); streamed download path in `filesApi.downloadFile` | `FilesPage`, `FileCard` ([FRONTEND_MAP.md §2.6](./FRONTEND_MAP.md)) | Shipped |
| **Quest SMART-on-FHIR lab imports** | `routes/fhirRoutes.ts`; `services/fhir/fhirClient.ts:32`; `LabConnection` model (migration `20260418_add_lab_connections`); LOINC → internal biomarker mapping | **Frontend integration**: disabled until `QUEST_FHIR_CLIENT_ID` set (per `config/index.ts:158-169`); `LabConnectionsSection` import pulled in `8ee5486` 2026-04-18 — effectively off-by-default on UI | Shipped (backend + mapping; UI gate pending) |
| **Plan gating** (feature limits per UserPlan tier) | `middleware/planGating.ts` (`requirePlanLimit('aiGuidancePerDay' | 'aiChatsPerDay')`); migration `20260420_add_user_plan` | `PlanSection` (`src/components/settings/PlanSection.tsx:56`) → `planApi.getCurrentPlan` | Shipped (2026-04-23, PR #73) |
| **Onboarding flow** (first-session wizard) | `routes/onboardingRoutes.ts`; migration `20260420_add_onboarding` | `OnboardingWizard` (`src/components/onboarding/OnboardingWizard.tsx:68`) | Shipped (2026-04-23, PR #73) |
| **Auth — JWT + refresh rotation + CSRF + email verification + password reset** | `routes/authRoutes.ts`; `authService.ts:200-285,407-476`; `middleware/csrf.ts`; `services/emailService.ts` (SendGrid) | `LoginPage`, `RegisterPage`, `VerifyEmailPage`, `ResetPasswordPage`, `ForgotPasswordPage` + `AuthContext` | Shipped |
| **Inactivity auto-logout** (HIPAA §164.312(a)(2)(iii) — 15 min idle) | — | `src/contexts/AuthContext.tsx:40-42` (`INACTIVITY_TIMEOUT_MS = 15*60*1000`); warning at 13 min | Shipped |
| **Audit logging** (immutable, 7y retention, HIPAA) | `services/auditLog.ts` + daily cleanup scheduler (`auditLog.ts:520-546`); `schema.prisma:657` (`AuditAction` enum) | Admin audit log viewer UI — **not shipped** (see §4.2) | Shipped (backend only) |
| **PHI encryption** (AES-256-GCM, per-user keys) | `services/encryption.ts` (36 fields across 18 models); `userEncryption.ts` | Transparent to frontend | Shipped |
| **Row-Level Security policies** | 16 tables under `ENABLE ROW LEVEL SECURITY` in `20260107_add_rls_policies/migration.sql:68-83` | — | Shipped **structurally**; runtime enforcement pending DB-role cutover (C-8 Part 3) |
| **Demo account** (read-only + AI-blocked) | `services/authService.ts` demo paths; `middleware/demoProtection.ts` (5 blocker middlewares); hard-fail in prod (`config/index.ts:319-325`) | `LoginPage` demo-login button | Shipped |
| **Dark mode** | — | `src/contexts/ThemeContext.tsx`; persists to `localStorage` key `omh-theme`; default dark (2026-01-09, `b949fa6`) | Shipped |
| **Cloud deployment** (Cloud Run + GCS + Cloud SQL + staging pipeline) | `.github/workflows/deploy.yml`, `deploy-staging.yml` (2026-04-23, PR #73); `backend/Dockerfile` | — | Shipped |

### 4.2 Backend shipped, frontend pending

These are live backend capabilities without a matching UI in `src/components/`. CLAUDE.md's "Current Features" list overstates these — they are not user-visible in this repo.

| Feature | Backend evidence | Frontend gap | Resolution path |
|---|---|---|---|
| **Admin panel** (user management, audit log viewer, system health) | `routes/adminRoutes.ts` (mounted at `routes/index.ts:92`); `api/admin.ts` (8 exported methods: `getUsers, getUser, createUser, updateUser, deactivateUser, deleteUserPermanently, getStats, getAuditLogs`) | Zero consumers of `adminApi` in `src/components/` or `src/hooks/` ([FRONTEND_MAP.md §10.1](./FRONTEND_MAP.md) — grep-verified). `<AdminOnly>` guard exists but is never mounted. | Build `src/components/admin/` pages OR confirm that admin UI ships in a sibling app (see §9 Open Questions). |
| **Provider dashboard** (view consented patient data) | `routes/providerRoutes.ts` (mounted at `routes/index.ts:90`); `api/provider.ts` 6 methods; RBAC matrix in `rbac.ts:31-56` | Zero consumers of `providerApi`; `<ProviderOnly>` / `<ProviderOrAdmin>` guards never mounted ([FRONTEND_MAP.md §10.1, §10.2](./FRONTEND_MAP.md)). | Same — build provider pages or confirm external rollout. |
| **Patient consent management** (approve / deny / revoke provider access) | `routes/patientRoutes.ts` (mounted at `routes/index.ts:91`); `api/patient.ts` 7 methods (`approveProvider, denyProvider, updateProviderPermissions, revokeProvider, ...`) | Zero consumers of `patientApi` ([FRONTEND_MAP.md §10.1](./FRONTEND_MAP.md)). `AccountSettingsPage` does not expose consent management. | Build consent UI in `AccountSettingsPage` OR dedicated component. Critical gap: consent state machine from `schema.prisma:568-574` has no user-facing control surface. |
| **Audit log viewer** | `GET /api/v1/admin/audit-logs` (`adminApi.getAuditLogs`); rows written by `auditService.log*` everywhere | No UI consumer — same `adminApi` gap | Dependent on admin panel above. |
| **Lab connections UI** (Quest FHIR sync status) | `fhirRoutes.ts` + `LabConnection` model | `LabConnectionsSection` component was pulled in commit `8ee5486` 2026-04-18 (unused import cleanup); no UI entry point currently | Re-enable when `QUEST_FHIR_CLIENT_ID` configured in prod. |

### 4.3 Removed features

| Feature | Removed (date) | Evidence | Replacement / rationale |
|---|---|---|---|
| **Health Scoring** (0-100 scores + risk assessments) | Jan 2025 (per [`CLAUDE.md:34`](../CLAUDE.md)) | `CLAUDE.md:34` strike-through; the only remaining in-range metric is the dashboard's "Biomarkers in Range %" computed from `normalRangeMin/Max` (see `src/utils/biomarkers/trendCalculations.ts:57` `isInRange`; `src/utils/analytics.ts:173,351-363`; backend summary at `API_REFERENCE.md:638`) | Replaced by "Biomarkers in Range %" — a simple ratio, not a scoring system. Rationale: scoring over-promised clinical value; the ratio is transparently derived from lab normal ranges. |
| **CMS Marketplace Integration** (healthcare.gov plan search) | Jan 2025 (per [`CLAUDE.md:35`](../CLAUDE.md)) | `CLAUDE.md:35`; CSRF exempt list still carries `/marketplace/plans/search` (`middleware/csrf.ts:98-108`) — dead exemption, route no longer mounted in `routes/index.ts` | Dropped — external dependency (CMS) introduced brittleness without clear user value. |
| **Provider Directory** (doctor search + recommendations) | Jan 2025 (per [`CLAUDE.md:36`](../CLAUDE.md)) | `CLAUDE.md:36` | Scope moved to sibling project `HealthcareProviderDB` (user memory note). |
| **Client-side Tesseract.js OCR** | Effectively dead (2026-01-10, `0d2cd7a` "remove frontend PDF.js parsing from SBC upload") | `tesseract.js` still listed in `package.json:32` and chunked into `ocr` split (`vite.config.ts:26-30`), but zero grep matches for `tesseract` in `src/**` ([FRONTEND_MAP.md §7](./FRONTEND_MAP.md)) | Server-side OCR via Google Document AI is now canonical (`services/ocrService.ts:283`). |
| **DNA / Genetics feature** | 2026-04-23 (PR #74, commits `a793880`, `d62a8e7`) — tables + frontend types purged | [`CHANGELOG.md` Unreleased / Removed](./CHANGELOG.md); `CLAUDE.md:38-41` "Deprecated (Still in Schema)" is now stale | Feature cut — no user-visible UI had ever shipped; tables retained too long as noise. |

### 4.4 Deprecated (still in schema as of 2026-04-24)

| Model / Feature | Evidence | Removal plan |
|---|---|---|
| `DNAData`, `DNAVariant`, `GeneticTrait` | [`CLAUDE.md:38-41`](../CLAUDE.md); `backend/prisma/schema.prisma:383-435` | **CONFLICTING SIGNALS**: PR #74 (`a793880`, `d62a8e7` 2026-04-23) claims DNA models + tables purged per [`CHANGELOG.md` Unreleased](./CHANGELOG.md), but CLAUDE.md and [`DATA_MODEL.md:18-21`](./DATA_MODEL.md) still list them as deprecated-but-present. Resolution: re-read `schema.prisma` after PR #74 promotes to production, then strike this row. Tracked in CLAUDE.md drift (next doc-refresh cycle). |

---

## 5. AI integration strategy

All AI paths route through Anthropic Claude with a shared lazy client (`timeout: 30_000, maxRetries: 2`) and the same runtime gate.

### 5.1 BAA status

| Item | Value | Source |
|---|---|---|
| Anthropic BAA | **Signed 2026-04-16** | Commit `2bd7e36` (`docs: Anthropic BAA signed 2026-04-16; C-7 now the production gate`) |
| Runtime flag | `ANTHROPIC_BAA_ACTIVE=true` | `backend/src/config/index.ts:150` |
| Production boot gate | Hard-fail if `ANTHROPIC_API_KEY` set without BAA flag | `config/index.ts:245-250` |
| Service-level gate | Every Claude call checks `config.anthropic.baaActive` first | `services/claudeExtraction.ts:118-120`, `services/sbcExtraction.ts` |
| GCP BAA | Signed | [`SECURITY_STATUS.md:64`](./SECURITY_STATUS.md) diff line |
| SendGrid BAA | Signed | [`SECURITY_STATUS.md:64`](./SECURITY_STATUS.md) |

### 5.2 Claude use cases

| Use case | Entry point | File:line | Cost controls |
|---|---|---|---|
| **Biomarker educational guidance** | `POST /api/v1/biomarkers/guidance` | `routes/biomarkerRoutes.ts:120-122` | `aiLimiter` (10/hr keyed by userId, `rateLimiter.ts:102-118`) + `blockDemoAI` + `requirePlanLimit('aiGuidancePerDay')` |
| **SBC document extraction** (plan metadata, benefits, Rx, inpatient, outpatient, therapy) | `POST /api/v1/upload/insurance-sbc` | `services/sbcExtraction.ts:325` + `controllers/upload/sbcUploadController.ts` | `uploadLimiter` (20/hr) + `blockDemoAI`; PHI pre-redaction via `redactPatientBanner` + `stripPHIFromText` ([ARCHITECTURE.md §10b](./ARCHITECTURE.md)) |
| **Cost analysis** (Claude over plan + projections → OOP recommendations) | `POST /api/v1/expenses/analyze` | `expenseRoutes.ts`; persists `CostAnalysis.claudeResponse` (encrypted — `encryption.ts:481-485`) | `aiLimiter` + `blockDemoAI` + `requirePlanLimit` |
| **Health Guide conversational chat (streaming)** | `POST /api/v1/ai/chat` (SSE) | `aiRoutes.ts` with `requireBearerAuth` (`middleware/auth.ts:166-201`) — CSRF-exempt by design (`csrf.ts:126-148`) | `aiLimiter` + `blockDemoAI` + `requirePlanLimit('aiChatsPerDay')`; decryption moved out of RLS tx to avoid holding DB locks across streaming (PR `52507c3` 2026-04-18) |
| **Lab report Claude extraction** (PDF → biomarkers JSON) | `POST /api/v1/upload/lab-report` | `services/claudeExtraction.ts:57,115-140` | `uploadLimiter` + `blockDemoAI`; PHI redaction upstream |

### 5.3 Cost + safety controls

- **Per-user rate limiting**: `aiLimiter` — 10 requests/hour keyed by `req.user.id || ip` (`rateLimiter.ts:102-118`).
- **Per-plan daily budgets**: `requirePlanLimit('aiGuidancePerDay' | 'aiChatsPerDay')` (`middleware/planGating.ts`), backed by `UserPlan` tiering (migration `20260420_add_user_plan`).
- **Cost observability**: `services/aiCostTracker.ts` records tokens per model per user; `services/usageTracker.ts` feeds plan-gate counters.
- **PHI minimization before external call** (closed C-7, 2026-04-16, PR #39): local PDF text extraction + `phiRedaction` + `pdfRedaction` run **before** bytes leave the app (`services/claudeExtraction.ts:115-140`, `utils/phiRedaction.ts`).
- **Prompt injection defense**: `promptSafeString` Zod refinement caps untrusted input size and character classes (commit `eecf14f` 2026-02-06, "Prevent prompt injection in Claude API endpoints").
- **Demo users blocked**: `blockDemoAI` middleware on every AI endpoint (`demoProtection.ts:164-175`).

### 5.4 Model choice

| Task | Model used | Source |
|---|---|---|
| SBC extraction | Claude Sonnet (structured JSON output) | commit `019eb46` 2026-01-09 "feat: Insurance feature with Claude Sonnet SBC parsing" |
| Other calls (biomarker guidance, cost analysis, chat) | Anthropic default via `@anthropic-ai/sdk@^0.90.0` | `backend/package.json` (bumped 2026-04-18, `da0eee8`) |

---

## 6. Provider collaboration strategy

The data model and consent state machine are shipped and defended at both the app layer and the DB layer. The frontend UI is the gap — see §4.2.

### 6.1 Consent state machine

Enum values are the source of truth — `backend/prisma/schema.prisma:568-574`:

```prisma
enum ProviderPatientStatus {
  PENDING
  ACTIVE
  SUSPENDED
  REVOKED
  EXPIRED
}
```

```
   Provider requests access                Patient approves (sets flags)
          │                                           │
          ▼                                           ▼
      PENDING ─────── patient denies ──────▶   REVOKED ──▶ [terminal]
          │                                           ▲
          │ patient approves                          │
          ▼                                           │
       ACTIVE ◀──── patient re-enables ─── SUSPENDED ─┤
          │                                           │
          │ patient revokes                           │
          ├──────────────────────────────────────────▶│
          │                                           │
          │ consentExpiresAt < now (DB-side)          │
          └────────────────▶  EXPIRED ──▶ [terminal]
```

Full Mermaid version in [ARCHITECTURE.md §9](./ARCHITECTURE.md).

### 6.2 Permission flags

Granular permission columns on `provider_patients` — checked in both app and DB layers.

| Flag | Column | Resource gate |
|---|---|---|
| `canViewBiomarkers` | `can_view_biomarkers` | `has_provider_access(user_id, 'view_biomarkers')` — `migration.sql:51` |
| `canViewInsurance` | `can_view_insurance` | insurance SELECT policy |
| `canViewDna` | `can_view_dna` | dna_* SELECT policies |
| `canViewHealthNeeds` | `can_view_health_needs` | health_needs SELECT policy |
| `canEditData` | `can_edit_data` | any provider write (`rbac.ts:242-244`) |

### 6.3 Enforcement

- **App layer**: `checkProviderPatientAccess` (`rbac.ts:205-258`) looks up the relationship under admin RLS context, confirms `status === 'ACTIVE'` + `consentExpiresAt > now` + required permission flag.
- **DB layer**: every biomarker/insurance/etc. SELECT policy includes `OR has_provider_access(user_id, '<perm>')` — `migration.sql:39-62,151-157`.
- **Request validation**: `schemas.providerPatient.{request,approve,updatePermissions}` (`validation.ts:534-557`); `consentDurationDays` clamped to 1–365.

### 6.4 Routes (15 provider + patient endpoints, backend-shipped)

| Route group | Endpoints | File |
|---|---|---|
| Provider-side | `GET /provider/patients`, `POST /provider/patients`, `GET /provider/patients/:id`, `GET /provider/patients/:id/biomarkers`, `GET /provider/patients/:id/health-needs`, `DELETE /provider/patients/:id` | `providerRoutes.ts` |
| Patient-side (consent mgmt) | `GET /patient/providers`, `GET /patient/providers/pending`, `POST /patient/providers/:id/approve`, `POST /patient/providers/:id/deny`, `PATCH /patient/providers/:id/permissions`, `POST /patient/providers/:id/revoke`, `DELETE /patient/providers/:id` | `patientRoutes.ts` |

Full contracts in [API_REFERENCE.md §13-14](./API_REFERENCE.md).

### 6.5 Strategic gap

**Patients cannot currently use this feature** — the frontend has no UI for approving / denying / revoking provider access, despite the entire backend being shipped. See §4.2 and [FRONTEND_MAP.md §10.1](./FRONTEND_MAP.md). Until a UI is built, provider collaboration is a paper capability.

---

## 7. Roadmap

Derived from PR-labeled commits in `git log --since='6 months ago'` (347 commits total, 74 referenced PR numbers). Grouping: **Shipped** (already merged to master), **In flight** (partial code + docs, needs a final step), **Planned** (known next steps with no code yet).

### 7.1 Shipped (last 6 months, selected)

| Date | Scope | Evidence |
|---|---|---|
| 2026-04-23 | Dead-code sweep — DNA models + unused analytics pruned (PR #74) | commits `eb45a57`, `a793880`, `d62a8e7`, `5303e30` |
| 2026-04-23 | Staging deploy pipeline + onboarding + plan gating + encrypted health-goal target (PR #73) | commit `dfdb111`; migrations `20260420_add_onboarding`, `20260420_add_user_plan`, `20260420_encrypt_health_goal_target` |
| 2026-04-23 | C-8 code prep — audit salt env var, bare-prisma sweep, startup assertion | commit `4290520` (`feat(c-8): prepare code for RLS role cutover`) |
| 2026-04-18 | Quest SMART-on-FHIR integration (PRs #68/#69/#71) | `63dd1d8`, `394cc3a`, `799c61c`; migration `20260418_add_lab_connections` |
| 2026-04-18 | AI chat tx decryption ordering fix + CSRF exempt `/ai/chat` | `52507c3`, `2843339`, `5e4241e` PR #72 |
| 2026-04-18 | F-3/F-4/F-5/F-7 trust gaps closed (High batch) | `b2b762e`, PR #52 |
| 2026-04-17 | AI Health Guide chat streaming + knowledge layer + health profile (PRs #58/#59/#60) | `34b861f`, `334c247`, `3cd6c44`; migration `20260418_add_health_profile` |
| 2026-04-17 | Expenses actuals endpoints + UI (PR #56) | `781b881` |
| 2026-04-17 | Insurance hub refactor + expense visualization (PR #55) | `31f3c28` |
| 2026-04-17 | Dashboard overview + biomarker UX pass + upload review step (PR #54) | `2c680d7` |
| 2026-04-17 | C-8 Part 2b-ii RLS wraps (adminRoutes, auditLog runtime) (PR #43) | `74af20e` |
| 2026-04-17 | deploy.yml hardened — `--no-traffic` guard + smoke test + explicit promote (PR #51) | `bf381e7` |
| 2026-04-16 | **C-1 through C-7 Critical sweep** (6 Criticals closed same day; Anthropic BAA signed) (PRs #30-#42) | `9727492`, `f6bdc9a`, `2808b97`, `ea67ccb`, `4a08802`, `0f7970a`, `8c19438`, `2bd7e36` |
| 2026-04-16 | C-8 filed + Part 1 + Part 2a + Part 2b-i (PRs #31, #40, #41, #42) | `56bba28`, `65f9ffb`, `a648eb8`, `4fa6460` |
| 2026-02-06 | Batch 3 security — PHI redaction, AI cost tracking, demo restrictions | `6a5d56e` |
| 2026-02-06 | Backend security hardening — RLS, IDOR fixes, timeouts, validation, logging | `efaec73` |
| 2026-01-10 | Expense tracking backend + frontend (projections + cost optimization) | `baa6425`, `6aba34a` |
| 2026-01-10 | `Re-analyze Plan` feature for SBC extraction | `0239e81` |
| 2026-01-09 | Initial insurance feature with Claude Sonnet SBC parsing | `019eb46` |
| 2026-01-09 | Comprehensive SBC extraction (coverage details, coinsurance) | `4badc6e`, `df1747e` |
| 2026-01-09 | Dark mode default + login UI redesign | `b949fa6` |
| 2025-12-09 | Deployment docs PR (PR #1 — only "Merge pull request" commit in 6-month window) | commit message matches `git log --grep='Merge pull request'` |

### 7.2 In flight (as of 2026-04-24)

| Priority | Scope | Current state | Blocker |
|---|---|---|---|
| **P0 — Critical** | **C-8 Part 3 DB-role cutover** — provision `omh_app` NOBYPASSRLS role in Cloud SQL, rotate `DATABASE_URL`, flip `RLS_ENFORCEMENT=strict` | Code prerequisites all merged (Parts 1 / 2a / 2b-i / 2b-ii, 2026-04-16/17); runbook filed (PR #53, `61f19c0` 2026-04-17); startup assertion in `database.ts:220-270` | Requires infrastructure owner to execute in Cloud SQL + Secret Manager. See [SECURITY_STATUS.md#c-8](./SECURITY_STATUS.md). |
| P1 | Provider / patient / admin UI — connect 3 scaffolded API clients to React components | Backend shipped (§4.2); `<RoleGuard>` + `<AdminOnly>` / `<ProviderOnly>` / `<ProviderOrAdmin>` wrappers exist but unmounted ([FRONTEND_MAP.md §10.2](./FRONTEND_MAP.md)) | Product decision — solo-patient vs multi-role launch (§9 Open Questions). |
| P1 | Quest FHIR UI surface | Backend shipped (PRs #68-#71); LOINC mapping live; `LabConnectionsSection` pulled in commit `8ee5486` as unused import | `QUEST_FHIR_CLIENT_ID` env var not set; UI entry point needs a settings section. |
| P2 | CLAUDE.md drift cleanup | CHANGELOG Unreleased notes DNA removal leaves CLAUDE.md "Deprecated" section stale; Frontend tree has no admin panel despite CLAUDE.md listing one | Next doc-refresh cycle — see [CHANGELOG.md](./CHANGELOG.md) Unreleased. |
| P2 | Redis-backed rate limiter | Currently in-memory, bounded by `--max-instances=3` (`rateLimiter.ts:6-13`, `deploy.yml:72`) | Works for current scale; becomes a problem on horizontal scale-out. |
| P2 | Key rotation runbook | `TODO(key-rotation)` at `encryption.ts:81-85`; legacy 100k PBKDF2 fallback still present at `encryption.ts:304-315` | Required for SECURITY_STATUS A-grade ([SECURITY_STATUS.md §4.4](./SECURITY_STATUS.md)). |
| P2 | CSP nonce migration | Currently HTTP-equiv meta tag (per [SECURITY_STATUS.md](./SECURITY_STATUS.md) §Related findings) | Needs helmet config change + SPA coordination. |
| P3 | Upload routes CSRF header re-enablement | `csrf.ts:117-122` TODO comment: remove upload-route exemption once callers confirmed to attach header | Client audit of 4 upload routes. |

### 7.3 Planned (named, no code yet — derived from CLAUDE.md / SECURITY_STATUS / open TODOs)

**TBD** (external: prioritized backlog beyond the above — resolution path: project-owner interview; no formal roadmap artifact exists in the repo). Candidates visible in code:

- DEXA scan UI beyond generic biomarker entry (CLAUDE.md lists DEXA as a feature but no dedicated component exists in `src/components/biomarkers/`).
- Multi-user (caregiver proxy) mode — no model support yet.
- Labcorp FHIR (alongside Quest) — `fhirClient.ts` abstraction is provider-agnostic but only Quest is wired.

---

## 8. Strategic decisions log

Pulled from commit bodies, user memory, and CLAUDE.md rationale. Every row is a deliberate choice made between 2026-01 and 2026-04.

| Decision | Rationale | Evidence |
|---|---|---|
| **Remove Health Scoring** (0-100), replace with "Biomarkers in Range %" | Scoring over-promised clinical value; in-range ratio is transparently derived from lab normal ranges and carries no diagnostic claim | [`CLAUDE.md:34`](../CLAUDE.md); implementation in `src/utils/biomarkers/trendCalculations.ts:57`, `analytics.ts:173` |
| **Remove CMS Marketplace + Provider Directory** | External dependencies (CMS API, doctor search) introduced brittleness without clear user value; Provider Directory scope moved to sibling `HealthcareProviderDB` | [`CLAUDE.md:35-36`](../CLAUDE.md); user memory `ownmyhealth-project.md` |
| **Kill DNA / Genetics feature entirely** | Feature scaffolding had lived without user-visible UI for months; schema/complexity tax outweighed any future return | 2026-04-23 PR #74 (`a793880`, `d62a8e7`); [CHANGELOG.md Unreleased](./CHANGELOG.md) |
| **Anthropic BAA + prod hard-fail gate** | PHI must not cross to Anthropic without a BAA; a runtime flag alone is insufficient — boot must refuse to start in production if the flag is off but key is set | 2026-04-16 commit `2bd7e36`; `config/index.ts:245-258` |
| **PHI minimization before Claude** (C-7 close) | Closing C-7 made PHI redaction the gate even with BAA — defense in depth; BAA signed same day as C-7 fix | 2026-04-16 PR #39 (`8c19438`) |
| **RLS enforced via transaction-scoped `SET LOCAL`** (C-1 close) | Pre-fix, `set_config` ran outside a transaction and was silently dropped when Prisma reused a pooled connection — tenant isolation was **not** enforced at the DB | 2026-04-16 PR #30 (`9727492`); regression test `f336f3d` |
| **Bcrypt 13 rounds** (not 12) | HIPAA 2024+ baseline; commit log + config | `config/index.ts:90-94`; inline comment "HIPAA 2024+ baseline" |
| **PBKDF2-SHA512 @ 600k iterations** | OWASP 2023 baseline; 100k legacy fallback on auth-tag failure for in-flight rotation | `encryption.ts:86-87,193-201,304-315` |
| **Cloud Run --max-instances=3 + in-memory rate limiter** | Scale cap intentionally bounded so the in-memory `express-rate-limit` store remains effective without Redis | `.github/workflows/deploy.yml:72`; `rateLimiter.ts:6-13` comment |
| **Conditional rendering, no Router** (frontend) | Deliberate simplicity — two top-level state switches (`isAuthenticated`, `selectedCategory`) cover every page; no path-driven navigation needed | [`FRONTEND_MAP.md:31-33`](./FRONTEND_MAP.md); `src/App.tsx:98-273`, `Dashboard.tsx:180-244` |
| **Native `fetch` + hand-rolled `apiFetch`, no axios** | Zero runtime deps; drift from CLAUDE.md's claim of axios is noted in [FRONTEND_MAP.md §11](./FRONTEND_MAP.md) | `src/services/api/client.ts:172-307` |
| **React Context only for state (no Redux / Zustand / React Query)** | Simplicity — two providers (`AuthProvider`, `ThemeProvider`) cover everything; remote state lives in component `useState` or custom hooks | [`FRONTEND_MAP.md:32`](./FRONTEND_MAP.md) |
| **Form validation hand-rolled, no library** (`react-hook-form` / Zod / Formik / Yup all absent on client) | Zero matches in `src/` per grep; Zod only on backend for API input validation | [`FRONTEND_MAP.md:34`](./FRONTEND_MAP.md) |
| **15-minute inactivity auto-logout** | HIPAA §164.312(a)(2)(iii) — comment at `AuthContext.tsx:37-42` | `src/contexts/AuthContext.tsx:40-42` |
| **Refresh-token-first session restore** | Avoids 401-loop at mount when the 15-min access cookie has expired but the 7-day refresh cookie is valid | `AuthContext.tsx:104-115`; comment at lines 95-103 |
| **Explicit traffic promote (not `--to-latest`)** | Cloud Run env-var update silently holds traffic if the service was previously pinned; explicit `--to-revisions=NEW=100` is the only reliable promote | User memory `cloud-run-env-update-pinning.md` (2026-04-17 postmortem); `.github/workflows/deploy.yml:133-175` comment `:126-132` |
| **Reject known-insecure PHI encryption keys in every env** (C-4 close) | Previously only blocked in production — dev could silently run with placeholder keys and then carry the same data shape to prod | 2026-04-16 PR #34 (`ea67ccb`) |
| **Signed URL avoidance for PHI downloads — stream through backend instead** | Signed URLs give 15 min of raw access once issued; streamed proxy with `Cache-Control: no-store` plus audit logging is the tighter path | `storageService.ts:90-103` comment; `filesApi.downloadFile` in `src/services/api/files.ts:42-55` |
| **Staging pipeline as separate workflow** (2026-04-23) | Staging gets its own revision + smoke test before master promote — decouples "merged" from "production" | PR #73 — `.github/workflows/deploy-staging.yml` |

---

## 9. Open strategic questions

| # | Question | Who must answer | Resolution path |
|---|---|---|---|
| 1 | **Mission wording** — is the §1 "Working mission" the canonical line, or is there a different tagline in external marketing? | Project owner | Owner interview; update §1. |
| 2 | **Primary persona sharpness** — solo-patient-managing-chronic-condition (README) vs caregiver-proxy vs provider-led onboarding? Each implies a very different UI roadmap. | Product owner | Persona doc in `New Project Documents/` or external user-research artifact. |
| 3 | **Provider / admin UI ship-or-cut decision** — should provider/patient/admin frontends be built in this repo, built in a sibling app, or dropped entirely? Backend is already shipped ([FRONTEND_MAP.md §10.1](./FRONTEND_MAP.md)). | Product + engineering owner | Decision and a dated milestone in this doc. |
| 4 | **Pricing + plan tiers** — `UserPlan` exists (`migration.sql 20260420_add_user_plan`) with gating middleware, but the tier ladder (Free / Pro / …) and prices are not documented in-repo. | Business owner | `FINANCIAL_TRACKER.md` (in-flight, prompt 23); owner interview. |
| 5 | **Competitive positioning** — what's the differentiator vs MyChart / Apple Health / Lyric / Healthie? | Business owner | External competitive-research doc; § 10 below marks TBD. |
| 6 | **DNA / Genetics status finality** — CLAUDE.md says "Deprecated (still in schema)", PR #74 says tables/models removed. Which is authoritative as of 2026-04-24? | Engineering owner | Re-read `schema.prisma` post-promotion and reconcile CLAUDE.md. |
| 7 | **C-8 Part 3 cutover date** — all code prerequisites shipped; needs infra-owner execution in GCP | Infrastructure owner (GCP Console project `ownmyhealth-prod`) | Scheduling in [SECURITY_STATUS.md#c-8](./SECURITY_STATUS.md) + `docs/STAGING.md`. |
| 8 | **Labcorp and other lab networks beyond Quest** — is Quest a pilot or the long-term choice? | Product owner | Partnership strategy doc. |
| 9 | **Multi-region / geographic scope** — Cloud Run region `us-central1` is single-region (`deploy.yml`); no DR plan in repo | Infrastructure owner | Runbook extension. |

---

## 10. Competitive posture

**TBD** (external: competitive analysis — resolution path: external research doc or product-owner interview; no competitive analysis exists in the repo).

**Posture levers derivable from code**:

- **Privacy / HIPAA posture** is above industry baseline — AES-256-GCM + RLS + 7-year audit + per-user keys + BAA-gated AI + 15-min idle logoff is materially stronger than typical consumer health apps. See [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md).
- **AI posture** is opt-in and educational-only — no diagnostic claims, disclaimers on every AI surface, PHI redaction before external call. Rare in consumer health tools.
- **Data ownership posture** — export + delete-account flows shipped (`settingsApi.deleteAccount`, `deleteAllData` + GCS object deletion from C-6 close).
- **Insurance + expense posture** — SBC Claude extraction + projected-vs-actual tracking + deductible-met-month are not standard in consumer tracker apps. Potential differentiator.

---

## 11. User journey (ASCII)

```
Unauthenticated ──▶ POST /api/v1/auth/register       (authController.register)
                           │
                           ▼
                   Email sent via SendGrid          (services/emailService.ts)
                           │
                           ▼
            GET /api/v1/auth/verify-email?token=... (authController.verifyEmail)
                           │
                           ▼
                   POST /api/v1/auth/login           (authController.login)
                   Set-Cookie: access, refresh, csrf
                           │
                           ▼
                   OnboardingWizard                 (components/onboarding/...)
                   ├─ Welcome
                   ├─ LabUploadModal (optional)     → /upload/lab-report (Claude)
                   ├─ HealthProfile form            → /settings/health-profile
                   └─ done → onboardingApi.complete
                           │
                           ▼
                   Dashboard.DashboardContent       (selectedCategory='Overview')
                   │  Shows "Biomarkers in Range %" (utils/analytics.ts:173-178)
                   │
        ┌──────────┼──────────────────┬─────────────────┬────────────┐
        ▼          ▼                  ▼                 ▼            ▼
  First biomarker  Upload SBC         Add projection    Create goal  Grant provider
  (manual entry)   /upload/           POST /expenses/   POST /health- (§6 — UI pending)
  POST /bio-       insurance-sbc      projections       goals
  markers           │                  │
        │           ▼                  ▼
        │     InsurancePlanDetail    CostOptimization    │
        │           │                  │ expensesApi     │
        │           └── Claude SBC ──▶ .analyzeCosts     │
        │              extraction      │                 │
        │              → benefits      ▼                 ▼
        ▼                          CostAnalysis      Track progress
  Biomarker history              (claudeResponse    over time
  + trend charts                  encrypted)        (GoalProgressHistory)
  + AI guidance (opt-in)
        │
        ▼
  HealthGuidePage (AI chat over user's health data)
  /ai/chat SSE streaming    (BAA-gated, PHI-redacted, rate-limited)
```

Component-level wiring: [FRONTEND_MAP.md §3 Routing/URL map](./FRONTEND_MAP.md). Request-lifecycle per step: [ARCHITECTURE.md §3](./ARCHITECTURE.md).

---

## 12. Success metrics

### 12.1 Primary product metric (in-code)

**"Biomarkers in Range %"** — ratio of user biomarkers whose latest measurement falls within `normal_range_min`..`normal_range_max`.

| Surface | Source |
|---|---|
| Replaced the removed Health Scoring system | [`CLAUDE.md:34`](../CLAUDE.md) |
| Backend summary endpoint payload | `API_REFERENCE.md:638` — `{ totalBiomarkers, inRangeCount, outOfRangeCount, byCategory: [{ category, total, inRange, outOfRange }], ... }` |
| Frontend calculation helper | `src/utils/biomarkers/trendCalculations.ts:57` (`isInRange`) |
| Dashboard stat cards | `src/components/biomarkers/BiomarkerSummary.tsx:27`; test at `src/__tests__/components/BiomarkerSummary.test.tsx:60` |
| Analytics insights | `src/utils/analytics.ts:173,351-363` ("stable biomarkers in range") |

### 12.2 Secondary metrics derivable from the data model

| Metric | Data backing | Notes |
|---|---|---|
| Biomarker trend direction (improved / stable / declined) | `src/utils/biomarkers/trendCalculations.ts:77-81` | Uses crossing the normal-range boundary vs prior measurement |
| Goal completion rate | `HealthGoal.status` + `GoalProgressHistory` | Status enum: IN_PROGRESS / COMPLETED / etc. |
| Deductible met month | `CostAnalysis.deductibleMetMonth` (plaintext Int) | Populated by the AI cost analysis |
| AI usage per user | `services/aiCostTracker.ts` + `usageTracker.ts` | Per-token per-model; fuels plan gating |

### 12.3 Business metrics (acquisition, retention, revenue)

**TBD** (external: no product analytics stack is evident in `src/` — no segment, mixpanel, amplitude, or posthog imports found; resolution path: add analytics layer or rely on external dashboards; business-metric target values live outside the repo).

---

## 13. Risks (top 5)

| # | Risk | Severity | Source | Mitigation / next step |
|---|---|---|---|---|
| 1 | **RLS not enforced at runtime** — app connects as `BYPASSRLS` role. Tenant isolation relies solely on app-layer `withRLSContext` wrappers. A missed wrapper, raw SQL path, or SQLi would return cross-tenant data with no DB-level safety net. | **Critical** | [SECURITY_STATUS.md#c-8](./SECURITY_STATUS.md); user memory critical finding | C-8 Part 3 DB-role cutover in Cloud SQL + `RLS_ENFORCEMENT=strict` flip. Code prerequisites already merged (see §7.2). |
| 2 | **Provider / admin / patient-consent features have no UI** despite backend being shipped. Consent state machine is enforced at both app and DB layers but patients cannot exercise it from the UI. | **High** | [FRONTEND_MAP.md §10.1](./FRONTEND_MAP.md); §4.2 above | Ship provider / patient / admin pages, OR drop the backend routes if feature scope has narrowed. Decision needed (§9 Q3). |
| 3 | **AI availability & provider lock-in** — single AI vendor (Anthropic) with 30s timeout / 2 retries. Outage or policy change breaks biomarker guidance, SBC extraction, cost analysis, and Health Guide chat simultaneously. | Medium-High | [ARCHITECTURE.md §10](./ARCHITECTURE.md); `config/index.ts:144-151` | Vendor-abstracted SDK wrapper; keep PHI redaction strict so swap cost stays low. Consider fallback model selection in `aiCostTracker`. |
| 4 | **CLAUDE.md drift** — feature list is out of date (Admin Panel listed as shipped, DNA listed as deprecated-but-present, axios claimed as HTTP client). Readers and Claude Project answers based on CLAUDE.md will be wrong in specific cases. | Medium | [FRONTEND_MAP.md §11](./FRONTEND_MAP.md); [CHANGELOG.md Unreleased](./CHANGELOG.md) | Next doc-refresh cycle; possibly move "Current Features" to be auto-generated from `New Project Documents/`. |
| 5 | **HIPAA compliance gaps** — no key-rotation runbook; upload-routes CSRF exemption still in place with TODO; CSP still via meta tag (not nonce). Any one is a future-audit finding. | Medium | [SECURITY_STATUS.md §4.4, §4.7](./SECURITY_STATUS.md); `encryption.ts:81-85` `TODO(key-rotation)` | Three distinct work items. All are **non-blocking for HIPAA** at the current posture (see [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md)) but needed for A-grade. |

**Business risks** (runway, churn, go-to-market, legal exposure beyond HIPAA): **TBD** (external: resolution path — project-owner interview; no business-risk register exists in the repo).

---

## 14. Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — request lifecycle, middleware stack, RLS/encryption/audit flows, consent state machine, deployment topology.
- [API_REFERENCE.md](./API_REFERENCE.md) — per-endpoint contracts for all 108 endpoints powering each feature.
- [DATA_MODEL.md](./DATA_MODEL.md) — 18 active models + 3 deprecated; per-model fields, RLS policies, cascades.
- [FRONTEND_MAP.md](./FRONTEND_MAP.md) — component atlas; identifies the provider/patient/admin UI gap.
- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — C-8 open Critical; C-1..C-7 + 5 Highs closed in current cycle.
- [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) — administrative / physical / technical safeguards status.
- [CHANGELOG.md](./CHANGELOG.md) — shipped milestones in chronological detail (292 commits processed).
- [FINANCIAL_TRACKER.md](./FINANCIAL_TRACKER.md) — unit economics + runway (doc pending — see `prompts/23-financial-tracker-doc.md`).
- [ROUTING_TABLE.md](./ROUTING_TABLE.md) — middleware chain per route.
- [RUNBOOK.md](./RUNBOOK.md) — deploy/rollback playbook (Cloud Run env-update pinning caveat).
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — open bugs not tracked as security findings.

---

## 15. Acceptance questions (self-answered from this doc + siblings)

**Q1. What's the mission in one sentence?**
A. "Give patients full ownership of their health data — biomarkers, insurance, expenses — and let Claude AI educate (never diagnose) on top of that data, while keeping PHI under AES-256-GCM + RLS with BAA-gated third-party access." (§1, Working mission; the vision-statement wording is flagged as external TBD pending owner interview.)

**Q2. What four user-visible feature pillars are live?**
A. Per §4.1 the four live pillars with both backend and frontend evidence are: **(1) Biomarker tracking + AI guidance**, **(2) Insurance (SBC upload via Claude + plan management)**, **(3) Expense tracking (projections + actuals + AI cost analysis)**, **(4) AI Health Guide chat over user's own health data**. Health Goals and Health Needs are a close fifth/sixth; file management, plan gating, and onboarding round it out.

**Q3. Which feature was removed in Jan 2025 and what replaced it?**
A. Three things removed in Jan 2025 per §4.3: Health Scoring (0-100), CMS Marketplace Integration, and Provider Directory. The most notable replacement is Health Scoring → **"Biomarkers in Range %"** — a simple ratio from lab normal ranges, implemented in `src/utils/biomarkers/trendCalculations.ts:57` and exposed via the biomarker summary endpoint. CMS Marketplace has no replacement (dropped outright). Provider Directory scope moved to sibling project HealthcareProviderDB.

**Q4. Which models remain deprecated in `schema.prisma`?**
A. Per §4.4, `DNAData`, `DNAVariant`, `GeneticTrait` are listed deprecated in [`CLAUDE.md:38-41`](../CLAUDE.md) and [DATA_MODEL.md:18-21](./DATA_MODEL.md) but PR #74 (2026-04-23) claims they were purged. Conflicting signals until PR #74 promotes to production and `schema.prisma` is re-read. No other active model is deprecated.

**Q5. What's the Anthropic BAA status?**
A. Per §5.1, **Signed 2026-04-16** (commit `2bd7e36`). Runtime enforcement: `ANTHROPIC_BAA_ACTIVE=true` env var (`config/index.ts:150`); production boot hard-fails if `ANTHROPIC_API_KEY` is set without the flag (`config/index.ts:245-250`); every Claude call checks `config.anthropic.baaActive` before constructing the client.

**Q6. How does provider access work (consent → permissions → revocation)?**
A. Per §6: (1) Provider calls `POST /provider/patients` → `ProviderPatient` row in `PENDING` (enum `schema.prisma:568-574`). (2) Patient approves via `POST /patient/providers/:id/approve` → status `ACTIVE` with permission flags set (`canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canViewHealthNeeds`, `canEditData`) and `consentExpiresAt` (1-365 days). (3) Access is enforced at both app layer (`rbac.ts:205-258` `checkProviderPatientAccess`) and DB layer (every policy `OR`s `has_provider_access(user_id, 'view_biomarkers')` — `migration.sql:39-62`). (4) Patient can `SUSPEND` (pause), `REVOKE` (permanent end), or let expire (`EXPIRED` is DB-side via `consent_expires_at <= NOW()`). **Frontend UI is the gap** — backend shipped, no `patientApi` consumer exists in components (§4.2, §6.5).

**Q7. What are the top 3 strategic risks?**
A. Per §13 rows 1-3: **(1)** RLS inert at runtime (BYPASSRLS role) — Critical, C-8 Part 3 pending infra-owner cutover. **(2)** Provider/admin/patient-consent features have no UI despite full backend — High, blocks patients from exercising the consent state machine. **(3)** Single AI vendor (Anthropic) lock-in — Medium-High, any outage or policy change hits biomarker guidance, SBC extraction, cost analysis, and Health Guide chat simultaneously.

**Q8. What's the next on the roadmap (highest-priority in-flight)?**
A. Per §7.2, **P0 Critical: C-8 Part 3 DB-role cutover** — provision `omh_app` NOBYPASSRLS role in Cloud SQL, rotate `DATABASE_URL` in Secret Manager, flip `RLS_ENFORCEMENT=strict`. All code prerequisites shipped (Parts 1, 2a, 2b-i, 2b-ii between 2026-04-16 and 2026-04-17). Blocker: requires GCP Cloud SQL infrastructure owner execution.

**Q9. What's the current primary success metric (dashboard-level)?**
A. Per §12.1, **"Biomarkers in Range %"** — ratio of user biomarkers whose latest value is within `normal_range_min..normal_range_max`. Backend summary payload includes `inRangeCount`, `outOfRangeCount`, and per-category breakdown (`API_REFERENCE.md:638`). Frontend calc at `src/utils/biomarkers/trendCalculations.ts:57`. Replaced the removed Health Scoring system per CLAUDE.md:34.

**Q10. What strategic questions remain open, and who needs to answer each?**
A. Per §9, nine open questions. The most critical four: **Q3 Provider/admin UI ship-or-cut decision** (product + engineering owner); **Q4 Pricing + plan tiers** (business owner; see pending `FINANCIAL_TRACKER.md`); **Q7 C-8 Part 3 cutover date** (infrastructure owner — GCP Console project `ownmyhealth-prod`); **Q1 Mission wording** (project owner). Questions Q2 (persona), Q5 (competitive positioning), Q8 (lab-network strategy), and Q9 (multi-region / DR) require external input.

---

## 16. Prompt drift log

- Prompt §"Shipped features table" lists "Admin panel" under `adminRoutes.ts` as Shipped. **Actual**: backend shipped, frontend never built — `adminApi` has zero component consumers ([FRONTEND_MAP.md §10.1](./FRONTEND_MAP.md)). Reflected honestly in §4.2.
- Prompt §"Deprecated (still in schema)" row lists `DNAData`, `DNAVariant`, `GeneticTrait` with the removal plan marked as owner-confirm. **Actual**: PR #74 (2026-04-23, `a793880`, `d62a8e7`) already purged the models per [CHANGELOG.md Unreleased](./CHANGELOG.md), but CLAUDE.md and DATA_MODEL.md still list them. Noted as conflicting signal in §4.4.
- Prompt §"Removed features table" lists just 3 removed features. **Actual**: add Tesseract.js client-side OCR (effectively dead 2026-01-10) and DNA/Genetics entire feature (2026-04-23, PR #74) — 5 removed items now.
- Prompt §"Roadmap table" example shows only C-1/F-14/F-15 + BAA. **Actual**: §7.1 surfaces 20+ material shipped items in the 6-month window.
- Prompt expects `git log --grep='Merge pull request'` as the PR-history source. **Actual**: only **one** commit in the 6-month window matches that filter (`2025-12-09 #1 deployment docs`) — the rest of the repo uses squash-merged commits with `(#NN)` suffixes (e.g., `#30`, `#42`, `#73`, `#74`). §7 sources from the broader `git log --since='6 months ago'` (347 commits, 74 referenced PR numbers) as the realistic roadmap signal.
- Prompt "Questions to ask the user" step is labeled "last resort". No blocking gaps were hit — all external TBDs (§1 vision, §3 persona, §7.3 planned backlog, §10 competitive posture, §12.3 business metrics, §13 business risks) are marked with clear resolution paths per `_doc-quality.md`.
