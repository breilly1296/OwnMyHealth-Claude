---
tags:
  - security
  - api
  - high
type: prompt
priority: 2
---

# API Routes Security Review

## Files to Review
- `backend/src/routes/*.ts` (all route files)
- `backend/src/app.ts` (route registration)
- `backend/src/middleware/` (auth, validation middleware)

## OwnMyHealth API Architecture
- **Base Path**: `/api/v1`
- **Auth**: JWT via HttpOnly cookies
- **CSRF**: Required on POST/PUT/DELETE
- **Rate Limiting**: Express-rate-limit

## Checklist

### 1. Route Authentication
For each route file, verify auth middleware applied:
- [ ] `authRoutes.ts` - public routes (login, register, refresh)
- [ ] `biomarkerRoutes.ts` - all protected
- [ ] `fileRoutes.ts` - all protected
- [ ] `uploadRoutes.ts` - all protected
- [ ] `insuranceRoutes.ts` - all protected
- [ ] `userRoutes.ts` - all protected

### 2. Authorization (Beyond Authentication)
- [ ] Users can only access their own resources
- [ ] `userId` from JWT used (not from request body)
- [ ] No IDOR vulnerabilities (can't access other users' data by changing IDs)

### 3. Input Validation
- [ ] Request body validated before processing
- [ ] URL parameters validated (UUIDs, enums)
- [ ] Query parameters sanitized
- [ ] File uploads validated (type, size)

### 4. Error Responses
- [ ] Generic error messages to client
- [ ] Detailed errors logged server-side
- [ ] No stack traces in production responses
- [ ] No database error details leaked

### 5. HTTP Methods
- [ ] Correct methods used (GET for read, POST for create, etc.)
- [ ] No sensitive operations on GET endpoints
- [ ] DELETE endpoints require confirmation or are idempotent

### 6. Response Security
- [ ] No sensitive data in responses (passwords, tokens, keys)
- [ ] PHI decrypted only when needed
- [ ] Pagination on list endpoints (prevent data dumps)

## Route Inventory
Generate a complete route list:
```bash
grep -r "router\.\(get\|post\|put\|delete\|patch\)" backend/src/routes/ | sort
```

## Questions to Ask
1. Are there any routes missing authentication?
2. Can users access other users' resources?
3. Are all inputs validated before use?
