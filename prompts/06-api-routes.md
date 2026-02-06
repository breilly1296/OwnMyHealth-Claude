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
- [ ] `authRoutes.ts` - public routes (login, register, refresh, verify-email)
- [ ] `biomarkerRoutes.ts` - all protected (includes AI guidance endpoint)
- [ ] `fileRoutes.ts` - all protected
- [ ] `uploadRoutes.ts` - all protected
- [ ] `insuranceRoutes.ts` - all protected
- [ ] `expenseRoutes.ts` - all protected
- [ ] `healthGoalsRoutes.ts` - all protected
- [ ] `healthNeedsRoutes.ts` - all protected
- [ ] `providerRoutes.ts` - protected + requires PROVIDER or ADMIN role
- [ ] `patientRoutes.ts` - protected + requires PATIENT role
- [ ] `adminRoutes.ts` - protected + requires ADMIN role
- [ ] `settingsRoutes.ts` - all protected (export, delete data, delete account)

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

### 7. Role-Based Route Protection
- [ ] Provider routes enforce `requireRole('PROVIDER', 'ADMIN')`
- [ ] Patient consent routes enforce `requireRole('PATIENT')`
- [ ] Admin routes enforce `requireRole('ADMIN')` or `requireMinRole('ADMIN')`
- [ ] Role checked from JWT claims (re-verified on each request)
- [ ] Demo accounts blocked from sensitive operations (`demoProtection.ts`)

### 8. RLS Context
- [ ] `withRLSContext(userId, ...)` or `withRLSTransaction(userId, ...)` used for all DB queries
- [ ] userId from JWT token (not request body)
- [ ] Admin operations use `withRLSContext(null, ...)` for system access
- [ ] Provider cross-user queries properly scoped

## Route Inventory
Generate a complete route list:
```bash
grep -r "router\.\(get\|post\|put\|delete\|patch\)" backend/src/routes/ | sort
```

Expected route files (13):
```
authRoutes.ts, biomarkerRoutes.ts, insuranceRoutes.ts, expenseRoutes.ts,
healthGoalsRoutes.ts, healthNeedsRoutes.ts, uploadRoutes.ts, fileRoutes.ts,
providerRoutes.ts, patientRoutes.ts, settingsRoutes.ts, adminRoutes.ts, index.ts
```

## Questions to Ask
1. Are there any routes missing authentication?
2. Can users access other users' resources?
3. Are all inputs validated before use?
4. Are provider routes properly checking consent permissions?
5. Are admin routes restricted to ADMIN role only?
