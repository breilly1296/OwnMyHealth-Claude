---
tags: [security, review]
type: prompt
priority: 2
---

# Input Validation Review

## Files to Review
- `backend/src/middleware/validation.ts` (Zod schemas)
- `backend/src/middleware/errorHandler.ts` (ValidationError handling)
- All route files to verify validation middleware usage

## OwnMyHealth Validation Architecture

- **Library**: Zod for schema validation
- **Pattern**: `validate(schema, source)` middleware
- **Sanitization**: HTML entities escaped, strings trimmed
- **Error Response**: `{ success: false, error: { code: 'VALIDATION_ERROR', details: [...] } }`

## Checklist

### 1. Validation Middleware
- [ ] `validate()` function accepts schema and source ('body', 'query', 'params')
- [ ] Zod errors converted to `ValidationError` with field details
- [ ] Validated data replaces original request data

### 2. String Sanitization
- [ ] `sanitizeString()` function:
  - Trims whitespace
  - Escapes HTML: `&`, `<`, `>`, `"`, `'`
- [ ] `sanitizedString(min, max)` for required strings
- [ ] `optionalSanitizedString(max)` for optional strings
- [ ] Max length enforced on all string fields

### 3. Custom Validators
- [ ] `dnaRsid` - validates rsid format (`/^rs\d{1,12}$/`)
- [ ] `email` - email format + lowercase + trim
- [ ] `uuid` - UUID format validation
- [ ] `strongPassword` - min 8 chars, uppercase, lowercase, number, special char
- [ ] `dateString` - valid date format

### 4. Schema Coverage

**Auth Schemas** (`schemas.auth.*`):
- [ ] `login` - email, password
- [ ] `register` - email, strongPassword, optional firstName/lastName
- [ ] `changePassword` - currentPassword, newPassword
- [ ] `forgotPassword` - email
- [ ] `resetPassword` - token, newPassword
- [ ] `resendVerification` - email
- [ ] `verifyEmailQuery` - token

**Biomarker Schemas** (`schemas.biomarker.*`):
- [ ] `create` - name, value (non-negative), unit, category, date, normalRange
- [ ] `update` - all fields optional
- [ ] `batchCreate` - array of biomarkers (max 100)
- [ ] `listQuery` - category, page, limit

**Insurance Schemas** (`schemas.insurancePlan.*`):
- [ ] `create` - planName, insurerName, planType enum, dates, deductibles
- [ ] `update` - all fields optional

**DNA Schemas** (`schemas.dna.*`):
- [ ] `upload` - filename, source enum, fileData
- [ ] `variantQuery` - rsid, chromosome, pagination
- [ ] `rsidParam` - rsid validation
- [ ] `traitQuery` - category, riskLevel enum

**Health Needs/Goals** (`schemas.healthNeed.*`, `schemas.healthGoal.*`):
- [ ] Create/update schemas with appropriate enums and ranges

**Provider-Patient** (`schemas.providerPatient.*`):
- [ ] `request` - patientEmail, relationshipType
- [ ] `approve` - permission booleans, consentDurationDays (1-365)
- [ ] `updatePermissions` - permission booleans

**Admin Schemas** (`schemas.admin.*`):
- [ ] `createUser` - email, strongPassword, role enum
- [ ] `updateUser` - role, isActive, emailVerified, password
- [ ] `listUsersQuery` - role, isActive, pagination, search
- [ ] `auditLogQuery` - userId, action, resourceType, dates, pagination

### 5. Pagination Safety
- [ ] Page minimum: 1
- [ ] Limit maximum: 100 (or 200 for admin)
- [ ] Default values provided
- [ ] `Math.max` and `Math.min` used for bounds

### 6. Type Exports
- [ ] Input types exported for controllers:
  - `BiomarkerCreateInput`, `BiomarkerUpdateInput`
  - `InsurancePlanCreateInput`, `InsurancePlanUpdateInput`
  - `LoginInput`, `RegisterInput`
  - etc.

### 7. Injection Prevention
- [ ] No raw user input in SQL queries (Prisma handles this)
- [ ] Enum validation prevents arbitrary values
- [ ] File paths validated/sanitized
- [ ] rsid format prevents NoSQL injection

### 8. Error Messages
- [ ] Errors include field name and message
- [ ] No sensitive data in error details
- [ ] Validation errors return 422 status

## Route Validation Coverage
Verify ALL routes have validation:

| Route File | POST | PUT | DELETE | Query |
|------------|------|-----|--------|-------|
| authRoutes | [ ] | N/A | N/A | [ ] verify-email |
| biomarkerRoutes | [ ] | [ ] | N/A | [ ] list |
| insuranceRoutes | [ ] | [ ] | N/A | N/A |
| dnaRoutes | [ ] | N/A | N/A | [ ] variants |
| healthNeedsRoutes | [ ] | [ ] | N/A | [ ] list |
| healthGoalsRoutes | [ ] | [ ] | N/A | [ ] list |
| adminRoutes | [ ] | [ ] | N/A | [ ] users, audit |
| providerRoutes | [ ] | [ ] | N/A | N/A |
| patientRoutes | [ ] | [ ] | N/A | N/A |

## Red Flags
- Routes without `validate()` middleware
- Missing max length on string fields
- No sanitization (XSS possible)
- Negative numbers allowed where inappropriate
- Unbounded pagination limits
- Raw string concatenation in queries
