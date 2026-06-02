---
tags:
  - security
  - validation
  - high
type: prompt
priority: 2
updated: 2026-06-01
---

# Input Validation Review

## Files to Review
- `backend/src/middleware/validation.ts` (Zod `schemas` object, `validate()` factory, `sanitizeString`/`sanitizeForPrompt`, `requireJsonContentType`)
- `backend/src/controllers/*.ts` (10 controllers; check input handling — note `aiChatController.ts`, `fhirController.ts` are newer)
- `backend/src/controllers/upload/shared.ts` (`validateUploadFile`, magic-bytes check, `sanitizeFilename`)
- `backend/src/routes/*.ts` (18 route files; confirm `validate(schema, source)` is wired on every mutating/param route)
- `backend/src/services/*.ts` (check parameter usage)
- `backend/src/services/fhir/urlSafety.ts` (SSRF / credential-exfiltration guard on outbound FHIR URLs)
- `backend/src/utils/securePdfParsing.ts` (PDF bomb / header sandbox)

## OwnMyHealth Validation Requirements
- **Framework**: Zod runtime validation schemas with TypeScript inference
- **Sanitization**: HTML entity escaping, whitespace trimming
- **UUIDs**: Must be validated before database queries
- **Files**: Type, size, and magic bytes validation
- **Passwords**: 12+ chars, uppercase, lowercase, number, special character
- **User Input**: Sanitized before storage/display
- **API Parameters**: Type checking and bounds validation

## Checklist

### 1. UUID Validation
- [ ] All `:id` route parameters validated as UUID format
- [ ] Validation happens BEFORE database query
- [ ] Invalid UUIDs return 400, not 500
- [ ] No SQL injection via malformed UUIDs

Example validation:
```typescript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_REGEX.test(req.params.id)) {
  return res.status(400).json({ error: 'Invalid ID format' });
}
```

### 2. File Upload Validation
- [ ] Multer `limits` enforce `fileSize` (10MB) and `files: 1` in `uploadRoutes.ts`
- [ ] Multer `fileFilter` rejects non-allowed MIME at the boundary (PDF-only for lab-report/insurance-sbc; PDF + PNG/JPEG/TIFF/GIF/WEBP for `/lab-results-ocr`)
- [ ] `validateUploadFile()` in `controllers/upload/shared.ts` re-checks file content with `validateMagicBytes` (the multer `fileFilter` only trusts the attacker-controlled Content-Type header)
- [ ] Magic-byte table (`MAGIC_BYTES`) covers every accepted MIME type, not just PDF
- [ ] `sanitizeFilename()` strips path separators / control chars and takes `path.basename` (no path traversal into `Content-Disposition` or DB)
- [ ] PDF header + bomb/timeout guards applied via `securePdfParsing.ts` before pdf-parse/Claude
- [ ] Virus scanning (optional but recommended)

### 3. String Input Validation
- [ ] Maximum length limits on text fields
- [ ] No null bytes in strings
- [ ] HTML/script tags sanitized if displayed
- [ ] SQL special characters handled by ORM

### 4. Numeric Input Validation
- [ ] Type coercion handled safely
- [ ] Range validation (min/max bounds)
- [ ] Integer vs float distinction where needed
- [ ] No NaN or Infinity accepted

### 5. Date Input Validation
- [ ] ISO 8601 format enforced
- [ ] Timezone handling consistent
- [ ] Future/past date limits where appropriate
- [ ] No date injection attacks

### 6. API Parameter Validation
- [ ] Query parameters typed and bounded
- [ ] Pagination limits enforced (max page size)
- [ ] Sort/filter parameters from allowlist only
- [ ] No arbitrary field access via parameters

### 7. Path Traversal Prevention
- [ ] File paths don't allow `../` sequences
- [ ] User input not interpolated into file paths
- [ ] Storage keys use UUIDs, not user-provided names

## Search for Unvalidated Input
```bash
# Find direct req.params usage without validation
grep -r "req\.params\." backend/src/controllers/ | grep -v "validate"

# Find direct req.body usage
grep -r "req\.body\." backend/src/controllers/ | head -20
```

### 8. Zod Schema Usage
- [ ] Zod schemas defined for all request bodies
- [ ] Schemas enforce required vs optional fields
- [ ] Custom validators present and used: `email` (RFC + lowercased), `uuid`, `strongPassword` (12+ chars, upper/lower/number/special), `dateString`, `finiteNumber` (rejects NaN/Infinity), `sanitizedString`/`optionalSanitizedString`, `promptSafeString` (LLM-injection-safe) — verify in the validators section of `validation.ts` (DNA `rsid` validator was REMOVED when DNA/Genetics models were dropped)
- [ ] `z.infer<T>` used for TypeScript type safety
- [ ] Validation errors return field-level messages
- [ ] HTML sanitization applied to free-text fields

### 9. Domain-Specific Validation
- [ ] Biomarker values: `finiteNumber` + `min(0)`, unit validation; `sourceType` enum (`MANUAL`/`LAB_UPLOAD`/`EHR_IMPORT`/`DEVICE_SYNC`/`API_IMPORT`); batch capped at 100
- [ ] Insurance plan fields: `planType` enum (`HMO`/`PPO`/`EPO`/`POS`/`HDHP`); monetary fields use `finiteNumber.pipe(min(0))` (no upper cap — only expense fields carry `max(999999.99)`); `coinsuranceRate`/per-service coinsurance bounded `min(0).max(100)`
- [ ] Health need: `needType`, `urgency`, `status` enum validation
- [ ] Health goal: `category`, `direction`, `status`, `reminderFrequency` enum validation
- [ ] Provider relationship type: enum validation (`PRIMARY_CARE`/`SPECIALIST`/`CONSULTANT`/`EMERGENCY`/`OTHER`); consent permission booleans bounded
- [ ] Expense amounts: positive/`min(0)`, `max(999999.99)` precision cap, `frequencyPerYear` int 1-365; `claimStatus` enum
- [ ] Admin: `role` enum (`PATIENT`/`PROVIDER`/`ADMIN`), `updateUserPlan.plan` enum (`FREE`/`PRO`/`TEAM`)
- [ ] Settings health profile: `biologicalSex`/`ageRange`/`smokingStatus`/`exerciseLevel` enums, array length caps (conditions ≤20, medications ≤30, familyHistory ≤10)

### 10. AI / LLM Input Validation (prompt injection)
- [ ] `ai.chat` schema bounds `message` (≤2000) and `conversationHistory` (≤20 turns, content ≤5000, role enum)
- [ ] Free-text values interpolated into Claude prompts use `promptSafeString` / `sanitizeForPrompt` (strips control chars, collapses newlines, hard 200-char cap) — see `biomarker.guidance` schema
- [ ] AI route uses `requireBearerAuth` + `aiSpendGuard` + `requirePlanLimit('aiChatsPerDay')` (CSRF-exempt streaming path must stay bearer-only)

### 11. FHIR / OAuth Callback & SSRF
- [ ] `/fhir/callback` (unauthenticated GET) checks `code` + `state` presence and returns 400 on missing; state binding (PKCE + random state, 10-min TTL) prevents cross-user forgery
- [ ] `fhir` param routes validate with `schemas.connectionIdParam` / `schemas.uuidParam` (`validate(..., 'params')`) before DB access
- [ ] Outbound FHIR URLs (pagination `link`, SMART discovery endpoints) pass `assertAllowedFhirUrl` / `isPrivateOrLoopbackHost` (`services/fhir/urlSafety.ts`) so credentials can't be exfiltrated to attacker/internal hosts (e.g. 169.254.169.254 metadata)

### 12. New-Route Validation Coverage
- [ ] `onboardingRoutes.ts` — `/status` and `/complete` take no body; confirm no unvalidated body is trusted (currently none)
- [ ] `planRoutes.ts` — `/` and `/available` are read-only with no params/body to validate
- [ ] `internalRoutes.ts` — confirm internal-only auth + any input validated
- [ ] `settingsRoutes.ts` — `updateProfile`, `updateNotifications`, `updateHealthProfile`, `deleteData`, `deleteAccount` all validated via Zod (`schemas.settings.*`)
- [ ] `authRoutes.ts` — email-change flow `/change-email` (`schemas.auth.changeEmail`) and `/confirm-email-change` (`schemas.auth.confirmEmailChangeQuery`, `'query'`) validated via Zod

## Questions to Ask
1. Are all route parameters validated (`schemas.uuidParam`/`connectionIdParam`/`patientIdParam`/`userIdParam`) before use?
2. Are file uploads validated beyond MIME — magic bytes (`validateUploadFile`) and filename sanitization?
3. Are there any places where user input goes directly to database?
4. Are Zod schemas used consistently across all 18 route files / 10 controllers?
5. Is every value interpolated into a Claude prompt run through `sanitizeForPrompt`?
6. Are outbound FHIR/OAuth URLs constrained by `urlSafety` before credentials are attached?
