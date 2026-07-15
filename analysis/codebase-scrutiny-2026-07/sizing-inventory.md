# Sizing Inventory

**Captured:** 2026-07-11 (approx., workspace scan)  
**Purpose:** Quantitative backbone for the scrutiny reports

---

## File & LOC counts

| Area | Files (approx.) | Lines (approx.) |
|------|-----------------|-----------------|
| Frontend `src/` (excl. tests) | 153 | 36,196 |
| Frontend tests `src/__tests__` | 34 | 4,508 |
| Backend `src/` (excl. `*.test.ts`) | 107 | 33,514 |
| Backend tests | 57 | 13,181 |
| E2E | 10 | 886 |
| Prisma / SQL | 35 | 2,770 |
| Docs / prompts / security MD | 120 | 24,039 |

**Production-ish code + tests:** ~70–75K LOC  
**With docs:** often cited ~96K including markdown (GTM materials)

---

## Largest backend files (excl. tests)

| Lines | Path |
|------:|------|
| 2219 | `backend/src/services/biomarkerPatterns.ts` |
| 1656 | `backend/src/services/authService.ts` |
| 1447 | `backend/src/services/pdfParser.ts` |
| 1236 | `backend/src/controllers/settingsController.ts` |
| 989 | `backend/src/controllers/expenseController.ts` |
| 974 | `backend/src/routes/adminRoutes.ts` |
| 935 | `backend/src/services/sbcExtraction.ts` |
| 926 | `backend/src/controllers/upload/shared.ts` |
| 869 | `backend/src/middleware/validation.ts` |
| 857 | `backend/src/controllers/authController.ts` |
| 854 | `backend/src/controllers/biomarkerController.ts` |
| 839 | `backend/src/controllers/insuranceController.ts` |
| 801 | `backend/src/controllers/healthGoalsController.ts` |

---

## Largest frontend files (excl. tests)

| Lines | Path |
|------:|------|
| 1117 | `src/components/analytics/GoalTrackerPanel.tsx` |
| 974 | `src/utils/biomarkers/labReportParser.ts` |
| 871 | `src/utils/insurance/insuranceKnowledgeBase.ts` |
| 812 | `src/utils/documents/documentParser.ts` |
| 783 | `src/components/insurance/CostOptimization.tsx` |
| 754 | `src/components/biomarkers/BiomarkerActionPlan.tsx` |
| 742 | `src/components/insurance/EnhancedInsuranceUpload.tsx` |
| 714 | `src/components/insurance/InsurancePlanCompare.tsx` |
| 714 | `src/components/insurance/AddInsurancePlanModal.tsx` |
| 698 | `src/components/insurance/InsurancePlanDetail.tsx` |
| 644 | `src/components/health/HealthNeedsPage.tsx` |
| 624 | `src/components/settings/HealthProfileSection.tsx` |
| 621 | `src/components/settings/AccountSettingsPage.tsx` |

---

## Controllers without dedicated tests (scan)

- `backend/src/controllers/aiChatController.ts`
- `backend/src/controllers/fhirController.ts`
- `backend/src/controllers/fileController.ts`
- `backend/src/controllers/upload/labUploadController.ts`
- `backend/src/controllers/upload/sbcUploadController.ts`

---

## Dual-parser pairs (LOC)

| Domain | Frontend | Backend |
|--------|----------|---------|
| Lab parsing | `labReportParser.ts` ~974 | `pdfParser.ts` ~1447 (+ Claude/OCR) |
| Documents | `documentParser.ts` ~812 | upload controllers |
| Insurance knowledge | `insuranceKnowledgeBase.ts` ~871 | `insuranceKnowledge.ts` ~403 |

---

## Dual-severity open issues (doc contradiction)

**KNOWN_ISSUES High (open as of that ledger):**

- H-1 — Plan-limit TOCTOU
- H-2 — FHIR PKCE multi-instance
- H-3 — Document AI not in AI dollar budget

**SECURITY_STATUS (same era):** claimed 0 open High.

---

## Git history (approx.)

| Metric | Value |
|--------|--------|
| Commits | ~599 |
| First activity sampled | 2025-11-26 |
| Recent activity sampled | 2026-06-21 |
| Primary authors | effectively one human identity (+ Claude / bots) |

---

## Comment density samples (heuristic)

| File | Comment-ish lines / total |
|------|---------------------------|
| `backend/src/app.ts` | ~37% |
| `backend/src/services/authService.ts` | ~31% |
| `backend/src/controllers/settingsController.ts` | ~14% |
| `src/App.tsx` | ~16% |

---

## E2E specs

| Spec | ~Lines |
|------|-------:|
| `auth.spec.ts` | 48 |
| `biomarker-entry.spec.ts` | 47 |
| `data-export.spec.ts` | 31 |
| `health-guide.spec.ts` | 50 |
| `settings.spec.ts` | 44 |

---

*Re-run counts after large refactors; treat as order-of-magnitude evidence, not a billing metric.*
