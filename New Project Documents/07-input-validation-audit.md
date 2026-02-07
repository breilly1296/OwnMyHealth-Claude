# Input Validation Security Audit

**Project:** OwnMyHealth
**Audit Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (Automated Security Audit)
**Scope:** Backend input validation, Zod schemas, file upload handling, PDF parsing security
**Priority:** High (Security)

---

## Executive Summary

The OwnMyHealth backend demonstrates a **strong input validation posture** overall. A centralized Zod-based validation middleware (`validation.ts`) is consistently applied across most route definitions. HTML sanitization, UUID validation, pagination bounds, and enum enforcement are well-implemented. File uploads are validated for MIME type and size. PDF parsing includes robust DoS protections.

**Key findings requiring attention:**
- The expense controller bypasses the Zod validation layer entirely (no schema middleware on routes)
- Password minimum length in Zod schema is 8 characters, but requirements state 12+
- File upload validation lacks magic bytes checking at the multer layer (though `securePdfParsing.ts` adds it for PDFs)
- Some admin routes accept unvalidated body fields (provider-relationships PATCH)
- No null byte stripping in string sanitization
- The `healthNeedsController.updateHealthNeedStatus` route applies the `update` schema but the controller reads `status` from `req.body` without the `needType` field check that `update` schema would validate

---

## Files Reviewed

| File | Path |
|------|------|
| Validation Middleware | `backend/src/middleware/validation.ts` |
| Auth Controller | `backend/src/controllers/authController.ts` |
| Biomarker Controller | `backend/src/controllers/biomarkerController.ts` |
| Expense Controller | `backend/src/controllers/expenseController.ts` |
| File Controller | `backend/src/controllers/fileController.ts` |
| Health Goals Controller | `backend/src/controllers/healthGoalsController.ts` |
| Health Needs Controller | `backend/src/controllers/healthNeedsController.ts` |
| Insurance Controller | `backend/src/controllers/insuranceController.ts` |
| Settings Controller | `backend/src/controllers/settingsController.ts` |
| Upload Controller | `backend/src/controllers/uploadController.ts` |
| Secure PDF Parsing | `backend/src/utils/securePdfParsing.ts` |
| Storage Service | `backend/src/services/storageService.ts` |
| All Route Files | `backend/src/routes/*.ts` (13 files) |

---

## Checklist Results

### 1. UUID Validation

- [x] **PASS** - All `:id` route parameters validated as UUID format
  - `schemas.uuidParam` (line 213-215 of `validation.ts`) is applied via `validate(schemas.uuidParam, 'params')` on all `:id` routes across biomarkerRoutes, fileRoutes, healthGoalsRoutes, healthNeedsRoutes, insuranceRoutes, adminRoutes, providerRoutes, and patientRoutes.
  - `schemas.patientIdParam` validates `:patientId` in provider routes.
  - `schemas.userIdParam` validates `:userId` in admin routes.

- [x] **PASS** - Validation happens BEFORE database query
  - The `validate()` middleware is registered before the `asyncHandler(controller)` in all route definitions. The middleware calls `schema.parse()` and throws `ValidationError` on failure before the controller executes.

- [x] **PASS** - Invalid UUIDs return 400, not 500
  - `validation.ts` line 150-158: Zod errors are caught and converted to `ValidationError` which returns 400 status. Verified via `zodIssueToDetail` mapping.

- [x] **PASS** - No SQL injection via malformed UUIDs
  - Prisma ORM uses parameterized queries. Combined with UUID format validation, SQL injection via ID parameters is not possible.

**Exception noted:** The expense routes (`expenseRoutes.ts`) do NOT apply `validate(schemas.uuidParam, 'params')` to the `:id` parameter on `PUT /projections/:id` and `DELETE /projections/:id`. The `id` is used directly from `req.params` without UUID validation. However, Prisma's parameterized queries mitigate SQL injection risk. The `planId` in `req.body` and `req.query` in the expense controller is also used without UUID validation.

### 2. File Upload Validation

- [x] **PASS** - File size limits enforced (10MB max)
  - `uploadRoutes.ts` lines 29-30: `limits: { fileSize: 10 * 1024 * 1024 }` configured in multer.
  - `insuranceRoutes.ts` lines 37-38: Same 10MB limit.
  - `uploadController.ts` line 74: `validateUploadFile` also checks `maxSizeMB` (default 10).

- [~] **PARTIAL** - File type validated by:
  - **Extension check**: [ ] FAIL - No explicit file extension validation. Only MIME type is checked.
  - **MIME type check**: [x] PASS - multer `fileFilter` checks `file.mimetype` against allowlists (`application/pdf` for lab uploads, plus images for OCR). `uploadController.ts` `validateUploadFile` also re-checks MIME type.
  - **Magic bytes validation**: [~] PARTIAL - `securePdfParsing.ts` validates PDF magic bytes (`%PDF-` header, lines 56-105) including version format. However, this is only applied to PDFs processed through `secureParsePdf()`. Image uploads for OCR do not have magic bytes validation. The multer layer relies solely on the MIME type from the `Content-Type` header, which can be spoofed.

- [x] **PASS** - Filename sanitized (no path traversal)
  - `storageService.ts` line 53: Storage keys are constructed as `${userId}/${fileId}.${extension}` using UUID-based `fileId` and a hardcoded extension mapping. User-provided `originalFilename` is only stored as metadata, never used in file paths.

- [ ] **FAIL** - Virus scanning
  - No virus/malware scanning is implemented on uploaded files. This is noted as "optional but recommended" in the checklist.

### 3. String Input Validation

- [x] **PASS** - Maximum length limits on text fields
  - `sanitizedString(minLength, maxLength)` with defaults of `(0, 1000)` enforces max length on all string fields.
  - Specific limits: email (255), password (128), names (100/200), notes (500/1000/2000), search (100/200).

- [ ] **FAIL** - No null bytes in strings
  - The `sanitizeString` function (`validation.ts` lines 40-48) trims and HTML-escapes but does NOT strip null bytes (`\x00`). Null bytes in strings could cause issues with C-based libraries or PostgreSQL text fields.

- [x] **PASS** - HTML/script tags sanitized if displayed
  - `sanitizeString` (line 40-48) escapes `&`, `<`, `>`, `"`, `'` to HTML entities. All free-text fields use `sanitizedString()` or `optionalSanitizedString()` which apply this transform.

- [x] **PASS** - SQL special characters handled by ORM
  - Prisma ORM uses parameterized queries throughout. No raw SQL is used in any controller.

### 4. Numeric Input Validation

- [x] **PASS** - Type coercion handled safely
  - Zod `z.number()` enforces JavaScript number type. Pagination transforms use `parseInt()` with `Math.max`/`Math.min` bounds.

- [x] **PASS** - Range validation (min/max bounds)
  - Biomarker values: `z.number().min(0)` (line 272)
  - Insurance amounts: `z.number().min(0)` on deductible, OOP max, copay, premium fields
  - Coinsurance: `z.number().min(0).max(100)` (line 357)
  - Extraction confidence: `z.number().min(0).max(1)` (line 284)
  - Consent duration: `z.number().min(1).max(365)` (line 533)
  - Pagination: clamped to `[1, 100]` for limit

- [x] **PASS** - Integer vs float distinction where needed
  - Pagination uses `parseInt()` for page/limit. Monetary and measurement values correctly use float-capable `z.number()`.

- [~] **PARTIAL** - No NaN or Infinity accepted
  - Zod's `z.number()` rejects `NaN` by default. However, `Infinity` and `-Infinity` pass Zod's `z.number()` validation. The `z.number().min(0)` constraints would reject `-Infinity` but not `Infinity`. This is a minor edge case since `Infinity` would pass `.min(0)` checks.

### 5. Date Input Validation

- [~] **PARTIAL** - ISO 8601 format enforced
  - `dateString` validator (`validation.ts` lines 110-114) uses `new Date(val)` and checks `!isNaN(date.getTime())`. This accepts many formats beyond ISO 8601 (e.g., "Jan 1 2025", "2025/01/01"). A stricter ISO 8601 regex would be more secure.

- [~] **PARTIAL** - Timezone handling consistent
  - Dates are parsed via `new Date()` which applies the server's timezone for date-only strings. In controllers, dates are stored as `new Date(input.date)`. No explicit timezone normalization is performed.

- [ ] **FAIL** - Future/past date limits where appropriate
  - No validation prevents dates far in the future or past. A biomarker measurement date of "2099-01-01" or "1800-01-01" would be accepted. Insurance effective dates have no range bounds.

- [x] **PASS** - No date injection attacks
  - Dates are parsed through JavaScript's `Date` constructor and then used with Prisma's parameterized queries. No string interpolation of date values into SQL.

### 6. API Parameter Validation

- [x] **PASS** - Query parameters typed and bounded
  - Biomarker list: `category` (optional string), `page`/`limit` (bounded integers) via `schemas.biomarker.listQuery`
  - Health needs list: `status`/`urgency`/`needType` as enum-validated strings
  - Health goals list: `status`/`category` as enum-validated strings
  - Admin users list: `role` (enum), `isActive` (boolean transform), `search` (max 100), page/limit (bounded)
  - Audit logs: `userId` (uuid), `action`/`resourceType` (string), dates (date format), page/limit (bounded)

- [x] **PASS** - Pagination limits enforced (max page size)
  - All pagination: `limit` capped at 100 via `Math.min(Math.max(1, parseInt(val || '20', 10)), 100)` (validation.ts line 209)
  - DNA variant query: limit capped at 500
  - Audit log query: limit capped at 200
  - Admin routes also apply `Math.min(100, ...)` in the handler

- [~] **PARTIAL** - Sort/filter parameters from allowlist only
  - Enum-validated filters (status, urgency, needType, category, role) are effectively allowlisted via Zod enums.
  - However, the admin audit-log route accepts `action` and `resourceType` as free-form strings (`z.string().optional()`) without enum validation. These are passed to Prisma `where` clauses. Prisma parameterization prevents injection, but arbitrary values are accepted.

- [x] **PASS** - No arbitrary field access via parameters
  - No routes expose dynamic field selection or arbitrary property access. All fields returned are hardcoded in response types.

### 7. Path Traversal Prevention

- [x] **PASS** - File paths don't allow `../` sequences
  - Storage keys are constructed server-side as `${userId}/${fileId}.${extension}` using UUIDs and a controlled extension map (`storageService.ts` line 53). No user input is incorporated into file paths.

- [x] **PASS** - User input not interpolated into file paths
  - The `originalFilename` from uploads is stored in the database only, never used in storage paths.

- [x] **PASS** - Storage keys use UUIDs, not user-provided names
  - `uploadController.ts` line 1386: `const fileId = crypto.randomUUID()` generates the storage key.

### 8. Zod Schema Usage

- [~] **PARTIAL** - Zod schemas defined for all request bodies
  - **With Zod validation middleware:**
    - Auth: register, login, change-password, forgot-password, reset-password, resend-verification, verify-email -- ALL have Zod schemas applied in routes
    - Biomarkers: create, update, batchCreate, listQuery -- ALL have Zod schemas
    - Insurance plans: create, update -- have Zod schemas
    - Insurance compare/search: local Zod schemas defined in `insuranceRoutes.ts`
    - Health needs: create, update, listQuery -- have Zod schemas
    - Health goals: create, update, updateProgress, listQuery -- have Zod schemas
    - Provider-patient: request, approve, updatePermissions -- have Zod schemas
    - Admin: createUser, updateUser, listUsersQuery, auditLogQuery -- have Zod schemas
  - **WITHOUT Zod validation middleware (FINDINGS):**
    - `expenseRoutes.ts`: None of the 6 routes (createProjection, getProjections, updateProjection, deleteProjection, analyzeCosts, getAnalyses) use Zod validation middleware. The controller does manual `if (!planId)` checks but no type/format validation on `estimatedCost`, `frequencyPerYear`, `isInNetwork`, `notes`, `serviceType`, or `deductibleMet`/`oopMet`.
    - `settingsRoutes.ts`: `deleteAccount` accepts `password` from `req.body` without Zod validation.
    - Admin `PATCH /provider-relationships/:id`: Body fields (`status`, `canViewBiomarkers`, etc.) are not validated.
    - Admin `DELETE /users/:id/permanent`: `confirmEmail` from `req.body` is not validated.
    - Biomarker `POST /:id/guidance`: The `biomarker` object from `req.body` is not validated by a Zod schema (only params are validated).

- [x] **PASS** - Schemas enforce required vs optional fields
  - Create schemas use required fields (e.g., `name: sanitizedString(1, 200)`) while update schemas use `.optional()`.
  - Optional fields properly use `.optional()` or `optionalSanitizedString()`.

- [~] **PARTIAL** - Custom validators for: email, UUID, password strength, dates, DNA rsid
  - **Email**: [x] `z.string().email().max(255).transform(lowercase)` (line 86-89)
  - **UUID**: [x] `z.string().uuid()` (line 94)
  - **Password strength**: [~] Defined with 8-char minimum (line 100), but requirements specify 12+. Regex checks for uppercase, lowercase, number, special character are all present.
  - **Dates**: [~] Uses `new Date(val)` validity check. Not strict ISO 8601 enforcement.
  - **DNA rsid**: [x] Regex `/^rs\d{1,12}$/` with lowercase transform (lines 77-81)

- [x] **PASS** - `z.infer<T>` used for TypeScript type safety
  - Lines 588-599: Type exports using `z.infer<typeof schemas.X>` for all major input types. Controllers import and use these types (e.g., `BiomarkerCreateInput`).

- [x] **PASS** - Validation errors return field-level messages
  - `zodIssueToDetail` (lines 24-29) maps each Zod issue to `{ field, message, code }`. The `ValidationError` class passes the full details array.

- [x] **PASS** - HTML sanitization applied to free-text fields
  - All text input fields use `sanitizedString()` or `optionalSanitizedString()` which apply the `sanitizeString` HTML entity escaping transform.

### 9. Domain-Specific Validation

- [~] **PARTIAL** - Biomarker values: numeric range checks, unit validation
  - Value: `z.number().min(0)` prevents negative values.
  - Unit: max length 20 chars via `sanitizedString(1, 20)`. No unit enum/allowlist.
  - Normal range: `min`/`max` are `z.number()` but no validation that `min < max`.
  - No upper bound on biomarker values (e.g., a value of `999999999` would be accepted).

- [x] **PASS** - Insurance plan fields: enum validation (HMO, PPO, etc.)
  - `planType: z.enum(['HMO', 'PPO', 'EPO', 'POS', 'HDHP'])` (line 336)

- [x] **PASS** - Health need urgency/status: enum validation
  - `urgency: z.enum(['IMMEDIATE', 'URGENT', 'FOLLOW_UP', 'ROUTINE'])` (line 446)
  - `status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'])` (line 455)
  - `needType: z.enum(['CONDITION', 'ACTION', 'SERVICE', 'MEDICATION', 'LIFESTYLE'])` (line 442)

- [x] **PASS** - Health goal direction/status: enum validation
  - `direction: z.enum(['INCREASE', 'DECREASE', 'MAINTAIN'])` (line 479)
  - `status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'PAUSED', 'ABANDONED'])` (line 496)
  - `category: z.enum(['WEIGHT', 'FITNESS', 'NUTRITION', 'BIOMARKER', 'MEDICATION', 'LIFESTYLE', 'MENTAL_HEALTH', 'OTHER'])` (line 475)

- [x] **PASS** - Provider relationship type: enum validation
  - `relationshipType: z.enum(['PRIMARY_CARE', 'SPECIALIST', 'CONSULTANT', 'EMERGENCY', 'OTHER'])` (line 523)

- [~] **PARTIAL** - Expense amounts: positive numbers, currency precision
  - The expense controller does manual `estimatedCost === undefined` checks but does NOT validate that `estimatedCost` is a positive number or has reasonable precision. No Zod schema is applied. The `frequencyPerYear` field is not validated as a positive integer.

---

## Search for Unvalidated Input

### Direct `req.params` usage without validation middleware

| File | Route | Finding |
|------|-------|---------|
| `expenseRoutes.ts:35` | `PUT /projections/:id` | No `validate(schemas.uuidParam, 'params')` middleware. `id` used directly. |
| `expenseRoutes.ts:38` | `DELETE /projections/:id` | Same -- no UUID param validation. |
| `expenseRoutes.ts:45` | `POST /analyze` | `planId` from `req.body` not UUID-validated. |

### Direct `req.body` usage without Zod schema

| File | Route | Finding |
|------|-------|---------|
| `expenseController.ts:41` | `createProjection` | Destructures `planId, serviceType, estimatedCost, frequencyPerYear, isInNetwork, notes` from `req.body` without Zod. |
| `expenseController.ts:130` | `updateProjection` | Destructures `serviceType, estimatedCost, frequencyPerYear, isInNetwork, notes` from `req.body` without Zod. |
| `expenseController.ts:209` | `updateCurrentSpending` | Destructures `deductibleMet, oopMet` from `req.body` without Zod. |
| `expenseController.ts:251` | `analyzeCosts` | `planId` from `req.body` without UUID validation. |
| `settingsController.ts:262` | `deleteAccount` | `password` from `req.body` without Zod (only manual check for presence). |
| `biomarkerRoutes.ts:116` | `POST /:id/guidance` | `biomarker` object from `req.body` without Zod schema. User-controlled values (`biomarker.name`, `biomarker.value`, etc.) are interpolated into Claude AI prompt. |
| `healthNeedsController.ts:483` | `bulkCreateHealthNeeds` | `needs` array from `req.body` without Zod schema. |
| `adminRoutes.ts:297` | `DELETE /users/:id/permanent` | `confirmEmail` from `req.body` without Zod. |
| `adminRoutes.ts:366` | `PATCH /provider-relationships/:id` | `status`, permission booleans from `req.body` without Zod. |

### Prompt Injection Risk

| File:Line | Finding |
|-----------|---------|
| `biomarkerRoutes.ts:125-144` | User-controlled biomarker data (`biomarker.name`, `biomarker.value`, `biomarker.unit`, `biomarker.normalRange`, `biomarker.history`) is directly interpolated into a Claude API prompt string without sanitization. While the biomarker data itself was validated on creation, the `POST /:id/guidance` endpoint receives the full biomarker object from the client, and this client-supplied data goes directly into the prompt. An attacker could craft malicious biomarker data in the request body to manipulate AI output. |

---

## Detailed Findings

### FINDING-01: Expense Controller Completely Bypasses Validation Layer (HIGH)

**Location:** `backend/src/routes/expenseRoutes.ts`, `backend/src/controllers/expenseController.ts`

**Description:** All 6 expense routes lack Zod validation middleware. The controller performs only minimal manual checks (`if (!planId)`, `if (estimatedCost === undefined)`). Fields like `estimatedCost`, `frequencyPerYear`, `serviceType`, and `notes` are accepted without type validation, length limits, or sanitization.

**Impact:**
- `estimatedCost` could be negative, `NaN`, `Infinity`, or a string
- `serviceType` and `notes` have no length limits or HTML sanitization
- `planId` is not validated as UUID format
- `frequencyPerYear` is not validated as a positive integer

**Affected routes:**
- `POST /api/expenses/projections`
- `GET /api/expenses/projections`
- `PUT /api/expenses/projections/:id`
- `DELETE /api/expenses/projections/:id`
- `POST /api/expenses/analyze`
- `GET /api/expenses/analyses`
- `PUT /api/insurance/plans/:id/spending`

### FINDING-02: Password Minimum Length Mismatch (MEDIUM)

**Location:** `backend/src/middleware/validation.ts:100`

**Description:** The `strongPassword` Zod schema requires minimum 8 characters, but the project requirements specify 12+ characters. The `authService.ts` `validatePasswordStrength` function (used in `authController.ts`) may have a different minimum, creating inconsistency between route-level validation and service-level validation.

**Code:**
```typescript
const strongPassword = z.string()
  .min(8, 'Password must be at least 8 characters')  // Should be 12
```

### FINDING-03: No Null Byte Sanitization (LOW)

**Location:** `backend/src/middleware/validation.ts:40-48`

**Description:** The `sanitizeString` function escapes HTML entities but does not strip null bytes (`\0`). Null bytes can cause truncation in C-based libraries and some databases.

### FINDING-04: Loose Date Format Validation (LOW)

**Location:** `backend/src/middleware/validation.ts:110-114`

**Description:** The `dateString` validator accepts any string that `new Date()` can parse, including formats like "January 1, 2025", "1/1/2025", "2025/1/1", and even timestamps. A strict ISO 8601 regex (`/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/`) would be more appropriate for a healthcare application.

### FINDING-05: AI Prompt Injection via Biomarker Guidance (MEDIUM)

**Location:** `backend/src/routes/biomarkerRoutes.ts:116-144`

**Description:** The `POST /:id/guidance` endpoint accepts a `biomarker` object from `req.body` and interpolates its fields directly into a Claude API prompt. While the `:id` param is UUID-validated, the body content is not validated by any Zod schema. An attacker could send arbitrary content in `biomarker.name`, `biomarker.history`, etc., potentially manipulating the AI's response.

### FINDING-06: Bulk Health Needs Creation Missing Validation (MEDIUM)

**Location:** `backend/src/controllers/healthNeedsController.ts:478-539`

**Description:** The `bulkCreateHealthNeeds` function destructures `needs` from `req.body` and casts `needType` and `urgency` to enum types without Zod validation. While the route for this function was not visible in the health needs routes (suggesting it may be called internally or from another route), the controller accepts unvalidated input and performs type assertions.

### FINDING-07: Settings Debug Logging Exposes Headers (LOW)

**Location:** `backend/src/routes/settingsRoutes.ts:25-29`

**Description:** Debug `console.log` statements log request method, path, and whether auth/CSRF headers are present. While not a direct validation issue, this should be removed in production.

---

## Secure PDF Parsing Analysis

**File:** `backend/src/utils/securePdfParsing.ts`

The secure PDF parsing implementation is **well-designed** with multiple layers of protection:

| Protection | Status | Details |
|------------|--------|---------|
| Magic bytes validation | [x] PASS | Checks `%PDF-` header (lines 56-105), validates version format (1.0-2.x) |
| Timeout protection | [x] PASS | 30-second timeout via `Promise.race` (line 17, 111-129) |
| Memory monitoring | [x] PASS | 100MB max memory increase checked after parsing (line 21, 180-189) |
| Text bomb detection | [x] PASS | Warns on compression ratio > 100x (lines 203-214), though does not reject |
| Output validation | [x] PASS | Checks result is non-null with string `text` property (lines 193-200) |
| Error categorization | [x] PASS | Distinguishes timeout, invalid PDF, encryption, and unexpected errors (lines 225-274) |
| Security logging | [x] PASS | Comprehensive logging with `pdfLogger` for security monitoring |

**Minor note:** The text bomb detection (compression ratio > 100x) logs a warning but does not reject the file. This is an intentional design choice to avoid false positives, which is reasonable.

---

## Content-Type Validation

**File:** `backend/src/middleware/validation.ts:172-199`

The `requireJsonContentType` middleware enforces `application/json` Content-Type for POST/PUT/PATCH requests with bodies, while correctly skipping `multipart/form-data` for file uploads. This prevents content-type confusion attacks.

---

## Questions Answered

### 1. Are all route parameters validated before use?

**Mostly yes.** All `:id`, `:patientId`, and `:userId` parameters are UUID-validated via Zod middleware in routes **except** for expense routes (`PUT/DELETE /projections/:id`) and `PUT /insurance/plans/:id/spending` where the expense controller reads `:id` without validation middleware on those specific routes. Note: the spending route at `insuranceRoutes.ts:132-136` does apply `validate(schemas.uuidParam, 'params')`.

### 2. Are file uploads validated beyond just extension?

**Yes, for PDFs.** PDF files go through `securePdfParsing.ts` which validates magic bytes, enforces timeouts, monitors memory, and checks compression ratios. MIME type is checked at both the multer layer and `validateUploadFile`. File size is limited to 10MB. However, image files (PNG, JPG, TIFF for OCR) are only MIME-type checked, not magic-byte validated.

### 3. Are there any places where user input goes directly to database?

**No direct SQL injection risk** -- all database access goes through Prisma ORM with parameterized queries. However, the expense controller writes unvalidated `estimatedCost`, `frequencyPerYear`, etc. to the database. If `estimatedCost` were a string or boolean, Prisma would throw a runtime error rather than a controlled validation error.

### 4. Are Zod schemas used consistently across all controllers?

**No.** The expense controller and several admin routes lack Zod validation middleware. The biomarker guidance endpoint and bulk health needs creation also bypass Zod.

---

## Summary Table

| Checklist Item | Status | Notes |
|----------------|--------|-------|
| **1. UUID Validation** | | |
| 1.1 All :id params validated | [x] PASS | Exception: expense routes |
| 1.2 Validation before DB query | [x] PASS | Middleware ordering correct |
| 1.3 Invalid UUIDs return 400 | [x] PASS | Via ValidationError class |
| 1.4 No SQL injection via UUIDs | [x] PASS | Prisma parameterized queries |
| **2. File Upload Validation** | | |
| 2.1 File size limits (10MB) | [x] PASS | Multer + controller check |
| 2.2a Extension check | [ ] FAIL | Not checked separately |
| 2.2b MIME type check | [x] PASS | multer + validateUploadFile |
| 2.2c Magic bytes validation | [~] PARTIAL | PDFs only, not images |
| 2.3 Filename sanitized | [x] PASS | UUIDs used for storage keys |
| 2.4 Virus scanning | [ ] FAIL | Not implemented |
| **3. String Input Validation** | | |
| 3.1 Max length limits | [x] PASS | All fields bounded |
| 3.2 No null bytes | [ ] FAIL | Not stripped |
| 3.3 HTML tags sanitized | [x] PASS | Entity escaping |
| 3.4 SQL chars handled by ORM | [x] PASS | Prisma throughout |
| **4. Numeric Input Validation** | | |
| 4.1 Type coercion safe | [x] PASS | Zod z.number() |
| 4.2 Range validation | [x] PASS | min/max bounds present |
| 4.3 Integer vs float | [x] PASS | Appropriate usage |
| 4.4 No NaN/Infinity | [~] PARTIAL | NaN rejected, Infinity not |
| **5. Date Input Validation** | | |
| 5.1 ISO 8601 format | [~] PARTIAL | Accepts non-ISO formats |
| 5.2 Timezone handling | [~] PARTIAL | No explicit normalization |
| 5.3 Future/past limits | [ ] FAIL | No date range bounds |
| 5.4 No date injection | [x] PASS | Parameterized queries |
| **6. API Parameter Validation** | | |
| 6.1 Query params typed/bounded | [x] PASS | Via Zod schemas |
| 6.2 Pagination limits | [x] PASS | Max 100-200 per page |
| 6.3 Sort/filter allowlisted | [~] PARTIAL | Most enum-validated |
| 6.4 No arbitrary field access | [x] PASS | Hardcoded responses |
| **7. Path Traversal Prevention** | | |
| 7.1 No ../ in file paths | [x] PASS | Server-generated paths |
| 7.2 No user input in paths | [x] PASS | UUID-based storage keys |
| 7.3 Storage keys use UUIDs | [x] PASS | crypto.randomUUID() |
| **8. Zod Schema Usage** | | |
| 8.1 Schemas for all bodies | [~] PARTIAL | Expense controller missing |
| 8.2 Required vs optional | [x] PASS | Properly distinguished |
| 8.3 Custom validators | [~] PARTIAL | Password min too low |
| 8.4 z.infer<T> type safety | [x] PASS | Exported types used |
| 8.5 Field-level error messages | [x] PASS | Via zodIssueToDetail |
| 8.6 HTML sanitization on text | [x] PASS | sanitizedString transform |
| **9. Domain-Specific Validation** | | |
| 9.1 Biomarker value ranges | [~] PARTIAL | min(0) but no upper bound |
| 9.2 Insurance plan type enum | [x] PASS | 5 valid types |
| 9.3 Health need enums | [x] PASS | urgency, status, needType |
| 9.4 Health goal enums | [x] PASS | direction, status, category |
| 9.5 Provider relationship enum | [x] PASS | 5 relationship types |
| 9.6 Expense amount validation | [~] PARTIAL | No Zod, no bounds |

---

## Recommendations (Priority Order)

1. **HIGH** -- Add Zod validation schemas and middleware to all expense routes. Create `schemas.expense.createProjection`, `schemas.expense.updateProjection`, `schemas.expense.analyzeCosts`, and `schemas.expense.updateSpending` with proper type, range, and sanitization constraints.

2. **HIGH** -- Add Zod schema validation for the biomarker guidance endpoint body to prevent prompt injection. At minimum, validate the biomarker object structure and sanitize string fields before interpolation into the AI prompt.

3. **MEDIUM** -- Update `strongPassword` minimum length from 8 to 12 characters to match project requirements.

4. **MEDIUM** -- Add magic bytes validation for image uploads (PNG: `\x89PNG`, JPEG: `\xFF\xD8\xFF`, TIFF: `II\x2A\x00` or `MM\x00\x2A`) in the `validateUploadFile` function.

5. **LOW** -- Add null byte stripping to `sanitizeString`: `.replace(/\0/g, '')`.

6. **LOW** -- Tighten date validation to strict ISO 8601 format and add reasonable date range bounds (e.g., not before 1900, not after 2100).

7. **LOW** -- Add `Infinity` check to numeric validators: `.refine(v => isFinite(v))`.

8. **LOW** -- Remove debug `console.log` statements from `settingsRoutes.ts`.

---

*End of Input Validation Security Audit*
