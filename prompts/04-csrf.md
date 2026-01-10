---
tags:
  - security
  - csrf
  - critical
type: prompt
priority: 1
---

# CSRF Protection Review

## Files to Review
- `backend/src/middleware/csrf.ts` (CSRF middleware)
- `backend/src/app.ts` (middleware registration)
- `src/services/api.ts` or `src/services/api/*.ts` (frontend API client)
- Any component making POST/PUT/DELETE requests

## OwnMyHealth CSRF Architecture
- **Method**: Double-submit cookie pattern
- **Token Location**: `csrf_token` cookie (readable by JS)
- **Header**: `X-CSRF-Token` required on mutating requests
- **Validation**: Cookie value must match header value

## Checklist

### 1. Backend CSRF Middleware
- [ ] CSRF middleware applied to all routes (or all mutating routes)
- [ ] Validates `X-CSRF-Token` header against cookie
- [ ] Returns 403 on CSRF validation failure
- [ ] Token regenerated on login (prevent fixation)

### 2. CSRF Token Generation
- [ ] Cryptographically random token (crypto.randomBytes or similar)
- [ ] Sufficient length (≥32 bytes)
- [ ] New token generated per session

### 3. Frontend Token Handling
- [ ] API client reads `csrf_token` from cookies
- [ ] `X-CSRF-Token` header included on all POST/PUT/DELETE
- [ ] Token retrieved fresh for each request (not cached)

### 4. Exempt Routes
- [ ] Only safe routes exempted (if any):
  - GET requests (safe by default)
  - Public endpoints (login, register)
  - Webhook endpoints (use different auth)
- [ ] No sensitive operations exempted

### 5. Component-Level Check
Search for any components using raw `fetch()` without CSRF:
- [ ] `BiomarkerAIGuidance.tsx` - uses CSRF?
- [ ] `InsuranceHub.tsx` - delete uses CSRF?
- [ ] Upload components - include CSRF header?

## Common CSRF Issues Found
```javascript
// WRONG - missing CSRF token
fetch('/api/v1/endpoint', { 
  method: 'POST',
  body: JSON.stringify(data)
})

// RIGHT - include CSRF token
const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1];
fetch('/api/v1/endpoint', {
  method: 'POST',
  headers: { 'X-CSRF-Token': csrfToken },
  body: JSON.stringify(data)
})
```

## Questions to Ask
1. Are there any POST/PUT/DELETE requests missing CSRF tokens?
2. Is debug logging removed from CSRF middleware?
3. Are CSRF errors returning generic messages (not leaking info)?
