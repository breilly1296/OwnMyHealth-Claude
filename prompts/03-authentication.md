---
tags: [security, critical]
type: prompt
priority: 1
---

# Authentication Review

## Files to Review (in order)
1. `backend/src/middleware/auth.ts` - JWT verification middleware
2. `backend/src/middleware/rbac.ts` - Role-based access control
3. `backend/src/services/authService.ts` - Auth business logic
4. `backend/src/controllers/authController.ts` - API handlers
5. `backend/src/routes/authRoutes.ts` - Route definitions
6. `backend/src/config/index.ts` - JWT configuration

## OwnMyHealth Auth Architecture

- **Access Tokens**: Short-lived (15 min), JWT signed with `JWT_ACCESS_SECRET`
- **Refresh Tokens**: Longer-lived (7 days), stored in database Session table
- **Token Storage**: httpOnly cookies (not localStorage)
- **Roles**: PATIENT (1) < PROVIDER (2) < ADMIN (3) hierarchy

## Checklist

### 1. JWT Configuration
- [ ] Access token expiration: 15 minutes (`JWT_ACCESS_EXPIRES_IN`)
- [ ] Refresh token expiration: 7 days (`JWT_REFRESH_EXPIRES_IN`)
- [ ] Separate secrets for access and refresh tokens
- [ ] Secrets loaded from environment variables
- [ ] Minimum secret length enforced (32+ characters in production)
- [ ] Token type field distinguishes access vs refresh

### 2. Token Storage & Transmission
- [ ] Tokens stored in httpOnly cookies (not accessible to JavaScript)
- [ ] Cookies have `secure: true` in production
- [ ] Cookies have `sameSite: 'strict'` or `'lax'`
- [ ] NEVER stored in localStorage or sessionStorage
- [ ] `extractToken()` checks cookie first, then Authorization header

### 3. Password Security
- [ ] bcrypt with configurable rounds (default 12, configurable via `BCRYPT_ROUNDS`)
- [ ] `validatePasswordStrength()` enforces:
  - Minimum 12 characters
  - Uppercase, lowercase, number, special character
- [ ] Passwords NEVER logged
- [ ] Timing-safe password comparison (`bcrypt.compare`)

### 4. Brute Force Protection
- [ ] Account lockout after N failed attempts (`MAX_LOGIN_ATTEMPTS`, default 5)
- [ ] Lockout duration configurable (`LOCKOUT_DURATION_MINUTES`, default 30)
- [ ] `isAccountLocked()` check before password verification
- [ ] `recordFailedLogin()` increments attempts and sets lockout
- [ ] `resetFailedLoginAttempts()` on successful login

### 5. Timing Attack Prevention
- [ ] Dummy hash comparison when user doesn't exist (`TIMING_SAFE_DUMMY_HASH`)
- [ ] Random delay added to obscure user existence
- [ ] Generic "Invalid email or password" message (no user enumeration)

### 6. Session Management
- [ ] Sessions stored in database (not just JWT)
- [ ] Session includes: ipAddress, userAgent, expiresAt
- [ ] `revokeRefreshToken()` deletes from database
- [ ] `revokeAllUserTokens()` for logout-all functionality
- [ ] Expired sessions cleaned up (`cleanupExpiredSessions()`)

### 7. Token Refresh Flow
- [ ] Refresh token rotation (old token revoked when new issued)
- [ ] Session metadata (IP, user agent) tracked
- [ ] `verifyRefreshToken()` checks database session validity

### 8. Email Verification
- [ ] New users start with `emailVerified: false`
- [ ] Verification token generated with `crypto.randomBytes(32)`
- [ ] Token expires after 24 hours
- [ ] Login blocked until email verified (except demo account)

### 9. Password Reset
- [ ] Reset token generated with `crypto.randomBytes(32)`
- [ ] Token expires after 1 hour
- [ ] All sessions revoked after password reset
- [ ] Rate limiting on forgot-password endpoint

### 10. Role-Based Access Control (rbac.ts)
- [ ] `requireRole()` middleware checks user role
- [ ] `requireMinRole()` uses hierarchy (ADMIN can access PROVIDER routes)
- [ ] `requireResourceAccess()` verifies ownership/relationship
- [ ] `requireOwnership()` for specific resource operations
- [ ] Provider-Patient relationship permissions checked

## Red Flags
- JWT secrets less than 32 characters
- Tokens in localStorage
- No refresh token rotation
- Missing account lockout
- User existence revealed in error messages
- Password logged anywhere
- Missing email verification bypass checks
