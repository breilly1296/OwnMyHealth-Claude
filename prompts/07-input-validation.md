---
tags:
  - security
  - validation
  - high
type: prompt
priority: 2
---

# Input Validation Review

## Files to Review
- `backend/src/middleware/validation.ts` (Zod schemas and sanitization)
- `backend/src/controllers/*.ts` (check input handling)
- `backend/src/services/*.ts` (check parameter usage)
- `backend/src/utils/securePdfParsing.ts` (PDF sandbox)

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
- [ ] File size limits enforced (e.g., 10MB max)
- [ ] File type validated by:
  - Extension check
  - MIME type check
  - Magic bytes validation (header inspection)
- [ ] Filename sanitized (no path traversal)
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
- [ ] Custom validators for: email (RFC), UUID, password strength, dates (ISO 8601), DNA rsid
- [ ] `z.infer<T>` used for TypeScript type safety
- [ ] Validation errors return field-level messages
- [ ] HTML sanitization applied to free-text fields

### 9. Domain-Specific Validation
- [ ] Biomarker values: numeric range checks, unit validation
- [ ] Insurance plan fields: enum validation (HMO, PPO, etc.)
- [ ] Health need urgency/status: enum validation
- [ ] Health goal direction/status: enum validation
- [ ] Provider relationship type: enum validation
- [ ] Expense amounts: positive numbers, currency precision

## Questions to Ask
1. Are all route parameters validated before use?
2. Are file uploads validated beyond just extension?
3. Are there any places where user input goes directly to database?
4. Are Zod schemas used consistently across all controllers?
