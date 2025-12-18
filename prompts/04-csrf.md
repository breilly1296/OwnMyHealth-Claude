---
tags: [security, review]
type: prompt
priority: 2
---

# CSRF Protection Review

## Files to Review
- `backend/src/middleware/csrf.ts`
- `backend/src/routes/authRoutes.ts` (to verify which routes skip CSRF)

## OwnMyHealth CSRF Implementation

Uses **double-submit cookie pattern**:
- CSRF token stored in non-httpOnly cookie (readable by JavaScript)
- Client sends same token in `X-CSRF-Token` header
- Server compares cookie and header values

## Checklist

### 1. Token Generation
- [ ] Token generated with `crypto.randomBytes(32)` (256 bits)
- [ ] `CSRF_TOKEN_LENGTH = 32` bytes
- [ ] Token is cryptographically random

### 2. Cookie Configuration
- [ ] Cookie name: `csrf_token`
- [ ] `httpOnly: false` (must be readable by JavaScript)
- [ ] `secure: true` in production
- [ ] `sameSite: 'lax'` or `'strict'` (from config)
- [ ] `maxAge: 24 hours`
- [ ] `path: '/'`

### 3. Validation Logic
- [ ] Skipped for safe methods: GET, HEAD, OPTIONS
- [ ] Header name: `x-csrf-token` (lowercase)
- [ ] `crypto.timingSafeEqual()` used for comparison (prevents timing attacks)
- [ ] Length check before comparison
- [ ] Throws `ForbiddenError` on mismatch

### 4. Routes Exempt from CSRF
Verify these public routes skip CSRF (they have no session to protect):
- [ ] `/auth/login`
- [ ] `/auth/register`
- [ ] `/auth/demo`
- [ ] `/auth/refresh`
- [ ] `/auth/forgot-password`
- [ ] `/auth/reset-password`
- [ ] `/auth/verify-email`
- [ ] `/auth/resend-verification`
- [ ] `/marketplace/plans/search` (public API)

### 5. Development Bypass
- [ ] CSRF can be disabled via `DISABLE_CSRF=true` only in development
- [ ] NOT bypassed in production

### 6. Token Endpoint
- [ ] `GET /api/v1/csrf-token` endpoint exists for SPAs
- [ ] `csrfTokenHandler()` sets cookie and returns token in response

### 7. Middleware Application
- [ ] `ensureCsrfToken` applied to set token on GET requests
- [ ] `validateCsrfToken` applied to state-changing requests
- [ ] `csrfProtection` combines both

## Routes That MUST Have CSRF Protection
Verify CSRF is enforced on these state-changing routes:
- [ ] POST `/auth/logout`
- [ ] POST `/auth/logout-all`
- [ ] POST `/auth/change-password`
- [ ] All POST/PUT/DELETE on `/biomarkers/*`
- [ ] All POST/PUT/DELETE on `/insurance/*`
- [ ] All POST/PUT/DELETE on `/dna/*`
- [ ] All POST/PUT/DELETE on `/health-needs/*`
- [ ] All POST/PUT/DELETE on `/health-goals/*`
- [ ] All POST/PUT/DELETE on `/admin/*`
- [ ] All POST/PUT/DELETE on `/provider/*`
- [ ] All POST/PUT/DELETE on `/patient/*`
- [ ] POST `/upload/*`

## Red Flags
- Token not cryptographically random
- String comparison instead of `timingSafeEqual`
- CSRF disabled in production
- Protected routes missing CSRF validation
- httpOnly cookie (defeats double-submit pattern)
