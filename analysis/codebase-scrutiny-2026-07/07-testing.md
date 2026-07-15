# 07 — Testing

---

## Inventory (approx.)

| Suite | Files | ~LOC |
|-------|-------|------|
| Frontend unit/component (`src/__tests__`) | ~34 | ~4.5K |
| Backend unit/integration (`backend/src/**/*.test.ts`) | ~57 | ~13K |
| E2E Playwright (`e2e/*.spec.ts`) | ~5 specs | ~220 total lines across specs |
| Live PG RLS | present, gated | intentional `describe.skipIf(!hasLiveDb)` |

Overall: **non-trivial test investment** — not a toy suite. Distribution of risk coverage is the problem.

---

## What is well tested (relative)

- Auth controller / service paths (login, register, logout, refresh interactions)
- Encryption key validation and crypto helpers
- Several CRUD controllers: biomarkers, expenses, health goals/needs, settings (partial)
- Middleware: plan gating, validation, CSRF-related behavior in places
- Some route-level admin/provider protections (demo block, etc.)
- Config secret-rejection tests
- Frontend: AuthContext, some dashboard/settings pieces, utilities

---

## Critical holes — untested PHI / integration controllers

| Controller | Tests? | Risk |
|------------|--------|------|
| `aiChatController.ts` | **None** | Streams health context to Claude |
| `fhirController.ts` | **None** | OAuth + lab sync |
| `fileController.ts` | **None** | GCS PHI files |
| `labUploadController.ts` | **None** | Lab PDF + OCR path |
| `sbcUploadController.ts` | **None** | Insurance SBC + extraction |

### Related untested / thinly tested services (examples)

- `ocrService.ts`
- `storageService.ts`
- `emailService.ts` / templates
- `healthContextService.ts` (feeds AI)
- FHIR: `smartAuth.ts`, `fhirClient.ts`, `labSyncService.ts` (labSync may have partial coverage elsewhere — treat as under-tested)
- Knowledge retrieval modules

---

## Frontend coverage skew

~**17** components with test artifacts vs ~**58** without (name-based heuristic).

High-value untested UI examples:

- `HealthGuidePage.tsx`
- `HealthNeedsPage.tsx`
- `EnhancedInsuranceUpload.tsx`, `CostOptimization.tsx`, expense modals
- `FilesPage.tsx`
- `ForgotPasswordPage` / `ResetPasswordPage` / `VerifyEmailPage`

---

## E2E is smoke, not confidence

Specs present (approx. 30–50 lines each):

- `auth.spec.ts`
- `biomarker-entry.spec.ts`
- `data-export.spec.ts`
- `health-guide.spec.ts`
- `settings.spec.ts`

Missing as full journeys (examples):

- Lab upload → extraction review → persist → trend → AI mention
- SBC upload → plan fields → expense projection → cost analysis
- Provider consent request → patient approve → provider read scope
- Account delete + salt destruction verification
- Plan limit enforcement under concurrent requests

---

## Type casts undermine static guarantees

Frontend `as unknown as Biomarker` patterns mean tests and compilers may both miss API shape regressions. Fix types first; then tests assert real shapes.

---

## Risk-based testing verdict

**Harsh read:** Tests protect the *old* CRUD/auth fortress. The *new* product surface (AI, OCR, FHIR, files) is the riskiest and least verified. That is the opposite of risk-based testing for a health app.

---

## Recommendations

### Immediate (P0/P1)

1. Controller tests for AI chat, file, lab upload, SBC upload (even with mocked Anthropic/GCS/Document AI).
2. FHIR connect/callback unit tests for PKCE store behavior; integration note for multi-instance failure.
3. E2E journey: export + delete (legal/trust critical).
4. E2E journey: lab upload happy path on staging-like env.

### Medium term

5. Contract tests for API DTO ↔ FE types.
6. Load/concurrency test for plan limits if monetization depends on them.
7. Expand Playwright to insurance and provider consent paths.
