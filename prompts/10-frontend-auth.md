---
tags:
  - security
  - frontend
  - high
type: prompt
priority: 2
---

# Frontend Authentication Review

## Files to Review
- `src/contexts/AuthContext.tsx` (auth state management)
- `src/services/api/auth.ts` (auth API calls)
- `src/components/auth/LoginPage.tsx` (login UI)
- `src/components/auth/RegisterPage.tsx` (registration UI)
- `src/App.tsx` (route protection)

## OwnMyHealth Frontend Auth Architecture
- **State Management**: React Context
- **Token Storage**: Memory only (no localStorage)
- **Cookie Handling**: HttpOnly cookies managed by browser
- **CSRF**: Token read from cookie, sent in header

## Checklist

### 1. Token Storage (CRITICAL)
- [ ] NO tokens in localStorage
- [ ] NO tokens in sessionStorage
- [ ] Tokens stored in memory (state) only
- [ ] Auth state cleared on logout/tab close

### 2. Auth Context Flow
- [ ] On page load: `refreshToken()` called FIRST
- [ ] Then: `getCurrentUser()` called after refresh
- [ ] Token refresh happens before API calls (not after 401)
- [ ] Auth state properly initialized

### 3. Protected Routes
- [ ] Routes requiring auth redirect to login
- [ ] Auth check happens before render
- [ ] No flash of protected content before redirect

### 4. Login/Logout Flow
- [ ] Login clears any stale state
- [ ] Logout clears all auth state
- [ ] Logout calls backend to invalidate tokens
- [ ] Redirect to login after logout

### 5. Error Handling
- [ ] 401 errors trigger logout/redirect
- [ ] Network errors don't crash app
- [ ] Error messages don't leak sensitive info
- [ ] Failed login shows generic message

### 6. Password Handling
- [ ] Password field uses `type="password"`
- [ ] Password not logged to console
- [ ] Password cleared from state after submission
- [ ] No password in URL parameters

### 7. CSRF Token Handling
- [ ] CSRF token read from `csrf_token` cookie
- [ ] Token included in `X-CSRF-Token` header
- [ ] Token refreshed after login

### 8. URL Token Cleanup
- [ ] Email verification tokens cleared from URL after read
- [ ] Password reset tokens cleared from URL after read
- [ ] Uses `window.history.replaceState()`

## Common Issues
```typescript
// WRONG - token refresh after getCurrentUser
const user = await getCurrentUser(); // fails with 401
await refreshToken(); // never reached

// RIGHT - token refresh first
await refreshToken(); // gets fresh token
const user = await getCurrentUser(); // now works
```

## Questions to Ask
1. Is the token refresh order correct?
2. Are tokens stored anywhere persistent?
3. Are URL tokens cleaned up after use?
