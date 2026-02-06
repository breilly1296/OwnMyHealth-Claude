---
tags:
  - security
  - authentication
  - critical
type: prompt
priority: 1
---

# Authentication Review

## Files to Review
- `backend/src/middleware/auth.ts` (JWT validation)
- `backend/src/services/authService.ts` (auth logic)
- `backend/src/controllers/authController.ts` (endpoints)
- `backend/src/routes/authRoutes.ts` (route definitions)
- `src/contexts/AuthContext.tsx` (frontend auth state)

## OwnMyHealth Auth Architecture
- **Method**: JWT with HttpOnly cookies
- **Access Token**: 15-minute expiration
- **Refresh Token**: 7-day expiration (30-day for demo accounts)
- **Password**: bcrypt hashed (cost factor 12)
- **CSRF**: Double-submit cookie pattern
- **Account Lockout**: 5 failed attempts → 30-minute lockout
- **Email Verification**: 24-hour token, required before full access
- **Password Reset**: Time-limited token via SendGrid email
- **Sessions**: Database-backed (PostgreSQL), cleanup every 10 minutes

## Checklist

### 1. JWT Implementation
- [ ] Access token expiration is short (≤15 minutes)
- [ ] Refresh token expiration is reasonable (≤7 days)
- [ ] Tokens are signed with strong secret (256+ bits)
- [ ] Secrets loaded from environment, not hardcoded
- [ ] Token validation checks expiration, signature, and issuer

### 2. Password Security
- [ ] bcrypt used with cost factor ≥10
- [ ] Password requirements enforced (length, complexity)
- [ ] Password not logged anywhere
- [ ] Timing-safe comparison used for password verification

### 3. Cookie Security
- [ ] `HttpOnly` flag set on auth cookies
- [ ] `Secure` flag set (HTTPS only)
- [ ] `SameSite` attribute configured appropriately
- [ ] Cookie expiration matches token expiration

### 4. Token Refresh Flow
- [ ] Refresh token stored in HttpOnly cookie
- [ ] Refresh endpoint issues new access token
- [ ] Refresh token rotation on use (optional but recommended)
- [ ] Old tokens invalidated on logout

### 5. Frontend Auth State
- [ ] `refreshToken()` called BEFORE `getCurrentUser()` on page load
- [ ] Auth state cleared on logout
- [ ] Failed auth redirects to login
- [ ] Token stored in memory only (not localStorage)

### 6. Account Lockout
- [ ] Failed login attempts tracked (`failedLoginAttempts` field)
- [ ] Account locked after 5 failed attempts (`lockedUntil` field)
- [ ] Lockout duration: 30 minutes (configurable via `LOCKOUT_DURATION_MINUTES`)
- [ ] Successful login resets failed attempt counter
- [ ] Lockout status checked before password comparison
- [ ] Lockout not bypassable via API manipulation

### 7. Email Verification Flow
- [ ] Verification token generated on registration
- [ ] Token has 24-hour expiration
- [ ] Token sent via SendGrid email
- [ ] Token cleared from URL immediately after read (frontend)
- [ ] Token single-use (invalidated after verification)
- [ ] Resend verification endpoint rate limited

### 8. Password Reset Flow
- [ ] Reset token generated on forgot-password request
- [ ] Token has expiration (time-limited)
- [ ] Token sent via SendGrid email
- [ ] Token cleared from URL immediately after read (frontend)
- [ ] Token single-use (invalidated after reset)
- [ ] All sessions revoked on password reset
- [ ] Forgot-password endpoint rate limited (strict)

### 9. Session Management
- [ ] Sessions stored in PostgreSQL `sessions` table
- [ ] Session includes: token, userId, IP, userAgent, expiresAt
- [ ] Expired sessions cleaned up automatically (10-min interval)
- [ ] Logout revokes current session token from DB
- [ ] Logout-all revokes all user sessions
- [ ] Session metadata tracked for audit trail

### 10. Demo Account Security
- [ ] Demo login only enabled when `DEMO_ACCOUNT_ENABLED=true`
- [ ] Demo blocked in production (`NODE_ENV=production`)
- [ ] Demo sessions have extended duration (30 days)
- [ ] Demo accounts restricted from sensitive operations (`demoProtection.ts`)

### 11. Rate Limiting
- [ ] Login endpoint: strict limit (5/15 min per email+IP)
- [ ] Register endpoint: moderate limit (20/15 min)
- [ ] Password reset endpoint: strict limit
- [ ] Verification resend: rate limited

## Questions to Ask
1. Is the token refresh order correct in AuthContext?
2. Are there any auth bypass vulnerabilities?
3. Is password validation consistent across frontend/backend?
4. Is account lockout working correctly?
5. Are email verification tokens properly invalidated after use?
