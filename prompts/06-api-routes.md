---
tags: [security, review]
type: prompt
priority: 1
---

# API Route Security Review

## Files to Review
- `backend/src/routes/index.ts` (route registry)
- All route files in `backend/src/routes/`:
  - `authRoutes.ts`
  - `biomarkerRoutes.ts`
  - `insuranceRoutes.ts`
  - `healthRoutes.ts`
  - `dnaRoutes.ts`
  - `healthNeedsRoutes.ts`
  - `healthGoalsRoutes.ts`
  - `providerRoutes.ts`
  - `patientRoutes.ts`
  - `adminRoutes.ts`
  - `uploadRoutes.ts`
  - `marketplaceRoutes.ts`
  - `cmsRoutes.ts`

## OwnMyHealth Route Patterns

Standard middleware stack:
```typescript
router.post('/path',
  authenticate,              // JWT verification
  validate(schemas.*.create), // Zod validation
  asyncHandler(controller)   // Async error handling
);
```

## Checklist

### 1. Authentication Middleware
For each route file, verify `authenticate` is applied to protected routes:

**authRoutes.ts** - Public routes (no auth):
- [ ] POST `/register` - public
- [ ] POST `/login` - public
- [ ] POST `/refresh` - public (uses refresh token)
- [ ] POST `/demo` - public
- [ ] GET `/verify-email` - public
- [ ] POST `/resend-verification` - public
- [ ] POST `/forgot-password` - public
- [ ] POST `/reset-password` - public

**authRoutes.ts** - Protected routes (require auth):
- [ ] POST `/logout` - authenticated
- [ ] POST `/logout-all` - authenticated
- [ ] GET `/me` - authenticated
- [ ] POST `/change-password` - authenticated

**PHI Routes** - ALL must require authentication:
- [ ] `biomarkerRoutes.ts` - all routes authenticated
- [ ] `insuranceRoutes.ts` - all routes authenticated
- [ ] `dnaRoutes.ts` - all routes authenticated
- [ ] `healthNeedsRoutes.ts` - all routes authenticated
- [ ] `healthGoalsRoutes.ts` - all routes authenticated
- [ ] `healthRoutes.ts` - all routes authenticated
- [ ] `uploadRoutes.ts` - all routes authenticated

**Role-Restricted Routes**:
- [ ] `adminRoutes.ts` - all routes require ADMIN role
- [ ] `providerRoutes.ts` - all routes require PROVIDER or ADMIN role
- [ ] `patientRoutes.ts` - routes for patient consent management

### 2. Input Validation
Verify `validate(schema)` middleware is applied:
- [ ] All POST routes validate request body
- [ ] All PUT/PATCH routes validate request body
- [ ] Query parameters validated where needed
- [ ] URL parameters (`:id`) validated as UUIDs

### 3. Rate Limiting
Check rate limiters are applied appropriately:
- [ ] `authRoutes.ts`: `authLimiter` on all routes
- [ ] Login: `strictAuthLimiter` (stricter than general)
- [ ] Forgot password: `strictAuthLimiter`
- [ ] Upload routes: `uploadLimiter`
- [ ] Sensitive operations: `sensitiveLimiter`

### 4. RBAC (Role-Based Access Control)
Verify role checks for sensitive operations:
- [ ] `requireRole('ADMIN')` on admin routes
- [ ] `requireRole('PROVIDER', 'ADMIN')` on provider routes
- [ ] `requireResourceAccess()` for PHI access
- [ ] `requireOwnership()` for resource modification

### 5. Resource Ownership
For user-specific data, verify users can only access their own:
- [ ] Biomarkers: user can only see/edit their own
- [ ] Insurance plans: user can only see/edit their own
- [ ] DNA data: user can only see/edit their own
- [ ] Health needs/goals: user can only see/edit their own
- [ ] Providers can access patients they have relationships with

### 6. Dangerous Operations
Extra scrutiny for:
- [ ] DELETE routes - require ownership verification
- [ ] Admin user management - require ADMIN role
- [ ] Data export - logged and rate limited
- [ ] Bulk operations - validated and limited

### 7. Error Handling
- [ ] All async handlers wrapped with `asyncHandler()`
- [ ] No unhandled promise rejections
- [ ] Errors don't leak sensitive information

### 8. API Response Format
- [ ] All responses use `ApiResponse<T>` type
- [ ] Success: `{ success: true, data: T }`
- [ ] Error: `{ success: false, error: { code, message } }`

## Routes That Must NOT Be Public
Verify these are NEVER publicly accessible:
- [ ] Any route returning PHI data
- [ ] Any route modifying user data
- [ ] Admin routes
- [ ] Provider patient data routes
- [ ] File upload routes
- [ ] Data export routes

## Red Flags
- PHI routes without `authenticate` middleware
- Missing `validate()` on POST/PUT routes
- DELETE without ownership check
- Admin routes without role verification
- Bulk data access without rate limiting
- Raw SQL queries in controllers (SQL injection risk)