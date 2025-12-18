---
tags: [security, frontend]
type: prompt
priority: 2
---

# Frontend Authentication Review

## Files to Review
- `src/contexts/AuthContext.tsx` (auth state management)
- `src/services/api.ts` (API client)
- `src/hooks/useRBAC.ts` (role-based access)
- `src/components/auth/LoginPage.tsx`
- `src/components/auth/RegisterPage.tsx`
- `src/components/common/RoleGuard.tsx`
- `src/App.tsx` (route protection)

## OwnMyHealth Frontend Auth Architecture

- **State Management**: React Context (`AuthProvider`)
- **Token Storage**: httpOnly cookies (NOT accessible to JavaScript)
- **PHI Handling**: Fetched on-demand, not persisted in memory
- **Session Check**: `/auth/me` on app load

## Checklist

### 1. AuthContext.tsx

**State Management**:
- [ ] Only stores non-PHI user data: `id`, `email`, `role`
- [ ] `isLoading` state for auth operations
- [ ] `error` state for error display

**Session Initialization**:
- [ ] `useEffect` calls `/auth/me` on mount
- [ ] Gracefully handles 401 (not authenticated)
- [ ] Sets `isLoading: false` after check

**Login Flow**:
- [ ] Calls `authApi.login({ email, password })`
- [ ] Sets user state on success
- [ ] Clears error state before attempt
- [ ] Throws error for caller to handle

**Registration Flow**:
- [ ] Calls `authApi.register()`
- [ ] Does NOT set user state (email verification required)
- [ ] User must verify email then login

**Logout Flow**:
- [ ] Calls `authApi.logout()`
- [ ] Clears user state
- [ ] Calls `clearAuthToken()`
- [ ] Handles API failure gracefully (still logs out locally)

### 2. API Client (api.ts)

**Credentials**:
- [ ] `credentials: 'include'` on all fetch requests
- [ ] Cookies sent automatically

**CSRF Token**:
- [ ] CSRF token read from cookie
- [ ] Sent in `X-CSRF-Token` header
- [ ] Token refreshed on mount

**Token Refresh**:
- [ ] 401 responses trigger token refresh
- [ ] Retry original request after refresh
- [ ] Redirect to login if refresh fails

**Error Handling**:
- [ ] API errors parsed from response
- [ ] Network errors handled
- [ ] No sensitive data logged

### 3. Token Storage Security

**MUST NOT store in**:
- [ ] `localStorage`
- [ ] `sessionStorage`
- [ ] React state (for tokens)
- [ ] Memory variables

**CORRECT storage**:
- [ ] httpOnly cookies (set by backend)
- [ ] User identity (id, email, role) in React state only

### 4. PHI Data Handling

- [ ] PHI fetched on-demand via API
- [ ] PHI NOT stored in Context or localStorage
- [ ] PHI cleared when navigating away
- [ ] No PHI in URL parameters
- [ ] No PHI logged to console

### 5. Role-Based Access (useRBAC.ts)

- [ ] `useRBAC()` hook checks user role
- [ ] `hasRole(role)` function
- [ ] `isAdmin()`, `isProvider()`, `isPatient()` helpers
- [ ] Role check happens client-side AND server-side

### 6. Route Protection

**RoleGuard Component**:
- [ ] Wraps protected routes
- [ ] Redirects unauthenticated users to login
- [ ] Checks role permissions
- [ ] Shows loading state during auth check

**App.tsx Routes**:
- [ ] Public routes: login, register, verify-email, reset-password
- [ ] Protected routes wrapped in RoleGuard
- [ ] Admin routes check ADMIN role
- [ ] Provider routes check PROVIDER role

### 7. Login/Register Pages

**LoginPage.tsx**:
- [ ] Form validation before submit
- [ ] Password field type="password"
- [ ] Error messages don't reveal user existence
- [ ] Loading state during submission
- [ ] Redirect after successful login

**RegisterPage.tsx**:
- [ ] Password strength indicator
- [ ] Confirm password matching
- [ ] Email format validation
- [ ] Success message about verification email
- [ ] No auto-login after registration

### 8. XSS Prevention

- [ ] User input sanitized before display
- [ ] React's automatic escaping used
- [ ] `dangerouslySetInnerHTML` NOT used with user data
- [ ] No `eval()` or `new Function()` with user data

### 9. Console/Debug Security

- [ ] No `console.log` with PHI in production
- [ ] No tokens logged
- [ ] No passwords logged
- [ ] React DevTools shows only non-PHI data

### 10. Error Handling

- [ ] Auth errors show user-friendly messages
- [ ] Network errors handled gracefully
- [ ] No stack traces shown to users
- [ ] Retry logic for transient failures

## Security Scenarios

### Scenario: Token Expiration
1. [ ] User makes request
2. [ ] 401 returned
3. [ ] App attempts token refresh
4. [ ] If refresh succeeds, retry original request
5. [ ] If refresh fails, redirect to login

### Scenario: Role Escalation Attempt
1. [ ] Frontend checks role
2. [ ] User modifies role in DevTools
3. [ ] Backend STILL validates role (defense in depth)
4. [ ] 403 returned for unauthorized role

## Red Flags
- Tokens in localStorage or sessionStorage
- PHI stored in React state/context
- Password visible in network tab (not HTTPS)
- Auto-login after registration (skips email verification)
- Missing CSRF token on state-changing requests
- Console logging sensitive data
- Roles only checked client-side
