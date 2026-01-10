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
- **Refresh Token**: 7-day expiration
- **Password**: bcrypt hashed (cost factor 10+)
- **CSRF**: Double-submit cookie pattern

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

### 6. Rate Limiting
- [ ] Login endpoint rate limited (prevent brute force)
- [ ] Password reset endpoint rate limited
- [ ] Account lockout after failed attempts (optional)

## Questions to Ask
1. Is the token refresh order correct in AuthContext?
2. Are there any auth bypass vulnerabilities?
3. Is password validation consistent across frontend/backend?
