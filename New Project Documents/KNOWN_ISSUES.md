# OwnMyHealth Known Issues

**Last Updated:** 2026-02-06

---

## Critical (Blocks Core Functionality)

### Expense Tracking Schema/Encryption Type Mismatch

**Symptom:** Expense fields declared as `Decimal` in the Prisma schema are being stored as encrypted strings by the controller, which can cause Prisma type validation errors or data corruption at runtime.

**Root Cause:** The `ExpenseProjection`, `ExpenseActual`, and `CostAnalysis` models have fields typed as `Decimal` (e.g., `estimatedCost Decimal @db.Decimal(10, 2)`) in `schema.prisma`, but the `expenseController.ts` encrypts these values into opaque ciphertext strings before passing them to Prisma's `create()`/`update()` methods. Prisma expects a `Decimal`-compatible value for these columns, not an AES-256-GCM ciphertext string.

Affected schema fields:
- `ExpenseProjection.estimatedCost` (Decimal)
- `ExpenseActual.billedAmount`, `insurancePaid`, `patientPaid`, `appliedToDeductible`, `appliedToOop` (all Decimal?)
- `CostAnalysis.totalProjectedOop` (Decimal?)
- `CostAnalysis.projectedExpensesSnapshot` (Json?)

The encryption service (`PHI_FIELDS` in `encryption.ts`) lists these fields for encryption, but the schema was not updated to use `String` types to hold the encrypted ciphertext. Other encrypted fields in the schema correctly use `String` with an `Encrypted` suffix (e.g., `valueEncrypted`, `notesEncrypted`).

**Workaround:** None -- this is likely causing runtime errors when the expense tracking features are used, or Prisma may be silently coercing values in unexpected ways.

**Fix Required:** Either (a) change schema fields to `String` type to hold encrypted ciphertext (consistent with other PHI fields), or (b) do not encrypt these fields and remove them from `PHI_FIELDS`. Option (a) is recommended for HIPAA compliance. A database migration would be required.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\prisma\schema.prisma` (lines 669-736)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\expenseController.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\services\encryption.ts` (lines 418-437, `PHI_FIELDS`)

---

## High Priority (Fix Before Beta)

### Row-Level Security (RLS) Not Applied in Most Controllers

**Symptom:** Database queries in 7 of 8 controllers bypass PostgreSQL Row-Level Security, relying solely on application-level `WHERE userId = ?` filters instead of setting the database session context variable (`app.current_user_id`).

**Root Cause:** The project documents RLS usage via `withRLSContext()` and `withRLSTransaction()` from `database.ts`, and RLS policies exist at the PostgreSQL level. However, only `settingsController.ts` actually calls these functions. The remaining controllers (`biomarkerController`, `insuranceController`, `expenseController`, `fileController`, `uploadController`, `healthGoalsController`, `healthNeedsController`) use raw Prisma queries with `where: { userId }` without setting the RLS context. If a query is accidentally constructed without the `userId` filter, RLS would not catch it.

**Workaround:** The application-level `userId` filtering in each query provides equivalent data isolation, but it is a single point of failure without the RLS defense-in-depth layer.

**Fix Required:** Wrap all database operations in each controller with `withRLSContext(userId, ...)` or `withRLSTransaction(userId, ...)` to engage PostgreSQL RLS policies as a secondary access control layer.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\biomarkerController.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\insuranceController.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\expenseController.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\fileController.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\uploadController.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\healthGoalsController.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\healthNeedsController.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\services\database.ts`

### Debug console.log Statements in Production Code

**Symptom:** Extensive `console.log` statements in production backend code output sensitive operational details to server logs, including user IDs, file content previews, extracted biomarker values, and request header information.

**Root Cause:** Debug logging was added during development and never removed. Two files are primary offenders:

1. **`settingsRoutes.ts`** -- Logs every request method/path, presence of auth/CSRF headers, and user IDs for delete operations (lines 26-45). These leak operational details about authenticated requests.

2. **`biomarkerExtractor.ts`** -- Contains 50+ `console.log` calls that output text content from uploaded lab reports, extracted biomarker names/values, and processing details. In production, this could log PHI (biomarker values, lab results) to stdout/server logs in plaintext, violating HIPAA requirements.

**Workaround:** None -- these log statements are active in all environments.

**Fix Required:**
- Remove all `console.log` statements from `settingsRoutes.ts` (debug middleware).
- Replace all `console.log` in `biomarkerExtractor.ts` with the structured `logger` utility (from `utils/logger.ts`) which sanitizes sensitive data. Or wrap them in a `NODE_ENV === 'development'` guard. Removing lab report content from logs entirely is preferred.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\routes\settingsRoutes.ts` (lines 24-46)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\services\biomarkerExtractor.ts` (~50 occurrences throughout file)

### Deprecated DNA/Genetics Models Still in Schema and Code

**Symptom:** Three database models (`DNAData`, `DNAVariant`, `GeneticTrait`) remain in the Prisma schema and backend code but are not used by any frontend UI. They add unnecessary complexity, consume database resources, and require ongoing encryption/security maintenance.

**Root Cause:** The DNA/Genetics feature was never fully implemented in the UI. The `CLAUDE.md` explicitly notes these as "consider removing if not planned." Despite this, the models are actively referenced in:

- `schema.prisma` -- Full model definitions with indexes (lines 376-428)
- `encryption.ts` -- `PHI_FIELDS` includes `DNAVariant.genotypeEncrypted` and `GeneticTrait.descriptionEncrypted/recommendationsEncrypted`
- `types/index.ts` -- TypeScript interfaces for `DNAVariant` and `DNAFileInfo`
- `rbac.ts` -- Permission checks for `canViewDna` in provider access control
- `providerRoutes.ts` / `patientRoutes.ts` -- DNA consent flags in provider-patient relationship management
- `validation.ts` -- Zod schemas include `canViewDna` fields

**Workaround:** No functional impact since no frontend triggers DNA operations. However, the `ProviderPatient.canViewDna` field is actively set/read in consent management even though there is no DNA data to view.

**Fix Required:** Either (a) remove the DNA models and all references if the feature is not planned, or (b) document them as a planned future feature. Removal would require a database migration to drop the `dna_data`, `dna_variants`, and `genetic_traits` tables, plus removing `canViewDna` from the `ProviderPatient` model.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\prisma\schema.prisma` (lines 34, 376-428)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\services\encryption.ts` (lines 392-399)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\types\index.ts` (lines 109-122)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\middleware\rbac.ts` (line 240)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\routes\providerRoutes.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\routes\patientRoutes.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\middleware\validation.ts` (lines 530, 539)

---

## Medium Priority (Fix During Beta)

### Health Goal Reminders Not Implemented

**Symptom:** Users can set a `reminderFrequency` (DAILY, WEEKLY, BIWEEKLY, MONTHLY) on health goals, and the schema stores `lastReminderSent`, but no reminders are ever sent.

**Root Cause:** The `HealthGoal` model has `reminderFrequency` and `lastReminderSent` fields, and the `healthGoalsController.ts` accepts and stores these values. However, no scheduler, cron job, or background service exists to check for due reminders and send emails via the email service. The existing schedulers (session cleanup, audit log cleanup) demonstrate the pattern, but no reminder scheduler was built.

**Workaround:** None -- users configure reminders that silently do nothing.

**Fix Required:** Implement a reminder scheduler (similar to `auditLog.ts` cleanup scheduler) that periodically queries health goals with active reminders, checks if `lastReminderSent` is past the configured frequency, and sends reminder emails via `emailService.ts`.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\prisma\schema.prisma` (lines 467-468)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\healthGoalsController.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\services\emailService.ts`

### Unused DataSourceType Enum Values

**Symptom:** The `DataSourceType` enum defines `EHR_IMPORT`, `DEVICE_SYNC`, and `API_IMPORT` source types, but no code exists to import biomarkers from EHR systems, wearable devices, or external APIs.

**Root Cause:** The enum was designed for future extensibility. Currently only `MANUAL` and `LAB_UPLOAD` source types are functionally supported. The other values are accepted by validation schemas and referenced in `settingsController.ts` data export, but no import pipeline exists for them.

**Workaround:** No functional impact. Users cannot select these source types since no UI or API endpoint triggers them.

**Fix Required:** Either (a) document these as planned future features, or (b) remove unused enum values to avoid confusion. If kept, add inline documentation in the schema indicating they are reserved for future use.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\prisma\schema.prisma` (lines 563-569)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\middleware\validation.ts` (lines 282, 317)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\controllers\settingsController.ts` (lines 120-124)

### CSRF Skip List References Removed Feature

**Symptom:** The CSRF middleware contains a skip entry for `/marketplace/plans/search`, which references the CMS Marketplace Integration feature that was removed in January 2025.

**Root Cause:** When the marketplace feature was removed, the CSRF skip list in `csrf.ts` was not cleaned up. The route no longer exists, so the skip entry is dead code.

**Workaround:** No security impact since the route does not exist, so the skip is never triggered.

**Fix Required:** Remove the `/marketplace/plans/search` entry from the `publicAuthRoutes` array in `csrf.ts`.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\middleware\csrf.ts` (line 107)

### Rollup WASM Override Required for Windows ARM64

**Symptom:** On Windows ARM64 machines, Vite/Rollup native binaries may fail to load, causing build failures.

**Root Cause:** Native Rollup binaries have compatibility issues on Windows ARM64. Both `package.json` (frontend) and `backend/package.json` include workarounds: `@rollup/wasm-node` as a dev dependency, platform-specific optional dependencies (`@rollup/rollup-win32-arm64-msvc`), and an `overrides` section that replaces Rollup with the WASM build.

**Workaround:** The `overrides` section in both `package.json` files (`"rollup": "npm:@rollup/wasm-node@^4.53.3"`) already mitigates this. However, if a developer removes these overrides or changes the Rollup version, the issue may resurface.

**Fix Required:** Document this requirement and consider adding a postinstall check. Monitor upstream Rollup releases for native ARM64 Windows support.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\package.json` (lines 53-57)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\package.json` (lines 70-76)

---

## Low Priority (Future Improvements)

### Frontend Health Score Still Calculated Despite Feature Removal

**Symptom:** The dashboard still displays a "Health Score" percentage based on the ratio of biomarkers in range, even though the CLAUDE.md states "Health Scoring -- 0-100 health scores, risk assessments" was removed in January 2025.

**Root Cause:** The `useBiomarkerStats.ts` hook calculates a `healthScore` as a simple percentage of biomarkers in range, and `DashboardContent.tsx` displays it prominently. This differs from the removed backend health scoring system (which included risk assessments), but the UI labeling as "Health Score" could confuse the scope of the removal.

**Workaround:** The current implementation is a simple ratio calculation, not the removed risk assessment system. It may be intentionally retained as a lightweight summary statistic.

**Fix Required:** Either (a) rename the UI label to "Biomarkers in Range" to differentiate from the removed health scoring feature, or (b) confirm this is the intended retained behavior and update documentation.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\src\hooks\useBiomarkerStats.ts` (lines 19, 53-60)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\src\components\dashboard\DashboardContent.tsx` (lines 72-82)

### pdf-parse Library Has Known Security Concerns

**Symptom:** The `pdf-parse` package (v1.1.1) is used for backend PDF text extraction and has been flagged in past npm audits for prototype pollution and ReDoS vulnerabilities.

**Root Cause:** The project uses `pdf-parse` for extracting text from uploaded lab reports. The backend mitigates some risks via `securePdfParsing.ts` (which validates PDF headers, enforces file size limits, and implements timeouts), but the underlying library itself may have unpatched vulnerabilities.

**Workaround:** The `securePdfParsing.ts` wrapper adds multiple layers of validation. Additionally, file uploads require authentication and the OCR pipeline via Google Document AI provides an alternative extraction path.

**Fix Required:** Monitor `pdf-parse` for security updates. Consider migrating to a more actively maintained alternative (e.g., `pdf2json`, `unpdf`, or using Google Document AI exclusively).

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\package.json` (line 36)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\services\pdfParser.ts`
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\utils\securePdfParsing.ts`

### HealthNeed Model Missing Notes Field

**Symptom:** The `HealthNeed` schema model only has `descriptionEncrypted` but no `notesEncrypted` field, unlike similar models (`Biomarker`, `HealthGoal`, `ProviderPatient`) which have separate notes fields.

**Root Cause:** The `HealthNeed` schema was designed with only a description. The `PHI_FIELDS` mapping in `encryption.ts` correctly lists only `descriptionEncrypted` for `HealthNeed`. However, the `CLAUDE.md` lists "Health Needs: description, notes" under PHI fields, suggesting notes were intended but not implemented.

**Workaround:** Users can include notes within the description field.

**Fix Required:** Either add a `notesEncrypted` field to the `HealthNeed` model (requires migration) and update the controller/encryption config, or update the CLAUDE.md documentation to reflect that HealthNeed only has `descriptionEncrypted`.

**Files:**
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\prisma\schema.prisma` (lines 430-448)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend\src\services\encryption.ts` (lines 400-404)
- `C:\Users\breil\OneDrive\Desktop\OwnMyHealth\CLAUDE.md`

---

## Technical Debt

### Code Quality
- [ ] Replace ~50 `console.log` calls in `biomarkerExtractor.ts` with structured logger
- [ ] Remove debug middleware from `settingsRoutes.ts` (lines 24-29, 43-47)
- [ ] Remove dead `/marketplace/plans/search` CSRF skip entry
- [ ] Clean up deprecated DNA model references across codebase (encryption, RBAC, validation, routes)
- [ ] Standardize expense model schema fields to use `String` type for encrypted PHI (requires migration)
- [ ] Add `withRLSContext()` wrappers to all 7 controllers missing RLS context
- [ ] Resolve `ExpenseProjection.estimatedCost` Decimal/String type conflict

### Missing Tests
- [ ] No test files for controllers: `biomarkerController`, `insuranceController`, `expenseController`, `fileController`, `uploadController`, `healthGoalsController`, `healthNeedsController`, `settingsController`
- [ ] No test files for services: `biomarkerExtractor`, `claudeExtraction`, `sbcExtraction`, `storageService`, `emailService`, `ocrService`, `pdfParser`, `userEncryption`, `database`
- [ ] No test files for routes: all 13 route files lack tests
- [ ] No test files for middleware: `csrf`, `rbac`, `demoProtection`, `auth`, `rateLimiter`
- [ ] Frontend tests only cover 7 files: `AuthContext`, `LoginPage`, `Dashboard`, `useAuth`, `AddMeasurementModal`, `BiomarkerSummary`, `Button`
- [ ] No frontend tests for: insurance components, file management, settings, trends, upload, analytics
- [ ] No integration tests for end-to-end API flows
- [ ] Backend has 5 test files total: `encryption.test.ts`, `authService.test.ts`, `errorHandler.test.ts`, `auditLog.test.ts`, `validation.test.ts`

### Documentation
- [ ] CLAUDE.md lists "Health Needs: description, notes" under PHI fields but schema only has `descriptionEncrypted`
- [ ] CLAUDE.md removed features section should note that the dashboard still shows a health score percentage
- [ ] No documentation for expense tracking encryption approach and its schema type conflict
- [ ] No API documentation (OpenAPI/Swagger spec) for the 60+ endpoints

---

## Fixed Issues (Reference)

| Issue | Fixed Date | Solution |
|-------|------------|----------|
| Rollup native binary failure on Windows ARM64 | Pre-2026-02-06 | Added `@rollup/wasm-node` override in both `package.json` files |
| CMS Marketplace Integration complexity | 2025-01 | Feature removed entirely |
| Health Scoring / Risk Assessment complexity | 2025-01 | Backend scoring system removed (simple percentage retained in frontend) |
| Provider Directory feature | 2025-01 | Feature removed entirely |

---

## Priority Definitions

| Priority | Definition | Timeline |
|----------|------------|----------|
| Critical | Blocks core functionality or causes data corruption | Fix immediately |
| High | Significant security gap or feature broken | Fix before beta |
| Medium | Usability issue or incomplete feature | Fix during beta |
| Low | Minor annoyance or future improvement | Backlog |
