---
tags:
  - security
  - frontend
  - high
type: prompt
priority: 2
updated: 2026-06-16
---

# Frontend Authentication Review

## Files to Review
- `src/contexts/AuthContext.tsx` (auth state management, idle/inactivity auto-logoff)
- `src/contexts/ThemeContext.tsx` (theme state — no security data)
- `src/services/api/auth.ts` (auth API calls, incl. logoutAll, email-change, demoLogin)
- `src/services/api/client.ts` (HTTP client, memory-only token, CSRF, 401-refresh + 429 backoff)
- `src/components/auth/LoginPage.tsx` (login UI)
- `src/components/auth/RegisterPage.tsx` (registration UI; on successful submit it now shows a "We sent a verification link to {email}" confirmation state with a working resend — `resendState` idle/sending/sent/error → `authApi.resendVerification`, fixes the previously dead registration funnel: `RegisterPage.tsx:55,117-123,156,160-172`)
- `src/components/auth/VerifyEmailPage.tsx` (email verification)
- `src/components/auth/ResetPasswordPage.tsx` (password reset)
- `src/components/auth/ForgotPasswordPage.tsx` (forgot password)
- `src/components/auth/ConfirmEmailChangePage.tsx` (confirm verified email change, NEW)
- `src/components/settings/ChangeEmailModal.tsx` (request email change, NEW)
- `src/hooks/useRBAC.ts` (role-based access control)
- `src/components/common/RoleGuard.tsx` (role-based UI gating)
- `src/utils/logger.ts` (auth/api loggers + PHI/secret redaction)
- `src/App.tsx` (route protection, lazy loading, `/verify-email` + `/reset-password` + `/confirm-email-change` routes)

## OwnMyHealth Frontend Auth Architecture
- **State Management**: React Context (`AuthProvider` / `useAuth` in `AuthContext.tsx`)
- **Token Storage**: Memory only (module-scoped `authToken` in `client.ts` via `setAuthToken`/`getAuthToken`/`clearAuthToken`); the access/refresh tokens themselves live in HttpOnly cookies — the in-memory copy is only the access token sent as a `Bearer` header
- **Cookie Handling**: HttpOnly cookies managed by browser (`credentials: 'include'`)
- **CSRF**: Token read from `csrf[_-]?token` cookie (case-insensitive), sent in `x-csrf-token` header on POST/PUT/PATCH/DELETE
- **Refresh model**: `client.ts` auto-refreshes on 401 (one-shot, single-flight via `attemptTokenRefresh`) and backs off on 429; `AuthContext` refreshes proactively on mount BEFORE `getCurrentUser()`
- **Idle policy**: `AuthContext` enforces a HIPAA auto-logoff (`INACTIVITY_TIMEOUT_MS` = 15 min, warning at 13 min) on mousedown/keydown/touchstart/scroll
- **API surface note**: `src/services/api/` now has 17 modules (added `ai`, `fhir`, `onboarding`, `plan`); auth review focuses on `auth.ts` + `client.ts`, but plan-gating 403s (`PLAN_LIMIT_EXCEEDED`) and AI/FHIR endpoints share the same client auth path

## Checklist

### 1. Token Storage (CRITICAL)
- [ ] NO tokens in localStorage
- [ ] NO tokens in sessionStorage
- [ ] Access token stored in memory only (module-scoped `authToken` in `client.ts`)
- [ ] Auth state cleared on logout/tab close (`clearAuthToken()` + `setUser(null)`)
- [ ] Idle auto-logoff force-reloads (`window.location.href`) so in-memory PHI is discarded

### 2. Auth Context Flow
- [ ] On page load: `authApi.refreshToken()` called FIRST (in `AuthContext` mount effect)
- [ ] Then: `authApi.getCurrentUser()` (`/auth/me`) called after refresh succeeds
- [ ] Refresh failure short-circuits to `setUser(null)` (does not call `getCurrentUser`)
- [ ] Reactive refresh also exists in `client.ts` (`attemptTokenRefresh` on 401), single-flight guarded by `isRefreshing`/`refreshPromise`
- [ ] Auth state properly initialized (`isLoading` guards initial session-restore render)
- [ ] `setOnAuthFailure` wires client 401-after-refresh failure to `logout()`

### 3. Protected Routes
- [ ] Routes requiring auth redirect to login
- [ ] Auth check happens before render
- [ ] No flash of protected content before redirect

### 4. Login/Logout/Register Flow
- [ ] After a successful register, `RegisterPage` clears password fields and shows the "We sent a verification link to {email}" confirmation state (does NOT silently leave the user on the form) — `RegisterPage.tsx:107-111,149-159`
- [ ] The confirmation-state "Resend email" button calls `authApi.resendVerification(registeredEmail)` and reflects `resendState` (sending/sent/error) — `RegisterPage.tsx:117-125,160-172`
- [ ] Login clears any stale state (clears `error` before submit)
- [ ] Login does NOT flip global `isLoading` (would unmount LoginPage mid-submit and wipe the email field — see AuthContext comment)
- [ ] Logout clears all auth state (`clearAuthToken()` + `setUser(null)`)
- [ ] Logout calls backend to invalidate tokens (`POST /auth/logout`)
- [ ] `logoutAll()` (`POST /auth/logout-all`) revokes ALL device sessions + blacklists access tokens; local token cleared regardless of outcome
- [ ] Redirect to login after logout

### 5. Error Handling
- [ ] 401 errors trigger one refresh attempt, then logout/redirect via `onAuthFailureCallback`
- [ ] Auth-management endpoints (`/auth/refresh`, `/auth/logout`) exempt from the 401-refresh + 429-retry loops
- [ ] 429 responses back off (Retry-After or exponential w/ jitter, `MAX_RETRY_429`) instead of hammering
- [ ] Network errors don't crash app (mapped to `NETWORK_ERROR`)
- [ ] Error messages don't leak sensitive info (`getUserFriendlyMessage` sanitizes by status)
- [ ] Failed login shows generic message
- [ ] `PLAN_LIMIT_EXCEEDED` 403s surface upgrade CTA via `planLimit` fields, not a raw "Forbidden"

### 6. Password Handling
- [ ] Password field uses `type="password"`
- [ ] Password not logged to console
- [ ] Password cleared from state after submission
- [ ] No password in URL parameters

### 7. CSRF Token Handling
- [ ] CSRF token read from cookie via `csrf[_-]?token` regex (case-insensitive) in `getCsrfToken()`
- [ ] Token included in `x-csrf-token` header on mutating methods (POST/PUT/PATCH/DELETE)
- [ ] Token refreshed after login
- [ ] Missing-token warning is DEV-only (`import.meta.env.DEV`); never logs the token value (audit F-10)

### 8. URL Token Cleanup
- [ ] Email verification (`/verify-email`) tokens cleared from URL after read
- [ ] Password reset (`/reset-password`) tokens cleared from URL after read
- [ ] Email-change confirmation (`/confirm-email-change`) tokens cleared from URL after read
- [ ] `App.tsx` uses `window.history.replaceState({}, ..., window.location.pathname)` — strips the query string but keeps the path
- [ ] One-time tokens consumed exactly once (`ConfirmEmailChangePage` uses a `confirmedRef` run-once guard to survive StrictMode double-invoke + parent re-render)

## Common Issues
```typescript
// WRONG - token refresh after getCurrentUser
const user = await getCurrentUser(); // fails with 401
await refreshToken(); // never reached

// RIGHT - token refresh first
await refreshToken(); // gets fresh token
const user = await getCurrentUser(); // now works
```

### 9. Role-Based UI Protection
- [ ] `useRBAC` hook exposes ONLY `role`, `isAuthenticated`, `hasRole`, `hasMinRole`, `getRoleLabel`, `getRoleBadgeClasses` (hierarchy ADMIN 3 > PROVIDER 2 > PATIENT 1). There are NO `isPatient`/`isProvider`/`isAdmin` booleans and NO `can*` capability flags — that `permissions` flag object was removed as never-consumed dead code (audit L-28); do NOT re-flag its absence as a regression (`src/hooks/useRBAC.ts:23-29` removal note, `:81-88` actual returned API)
- [ ] `RoleGuard` / `PatientOnly` / `ProviderOnly` / `AdminOnly` / `ProviderOrAdmin` and `useRBAC` are currently UNUSED by any rendered component (audit L-18) — they are retained only because the `components/common` + `hooks` barrels re-export them. Verify this is still the case and that the STATUS note in `src/components/common/RoleGuard.tsx:7-16` is accurate; do NOT treat these guards as the live UI-gating mechanism
- [ ] Real UI role gating is done INLINE in Dashboard (nav filter + defensive recheck in `renderSpecialPage`) — confirm provider-only and admin-only views (patient list/data; user management, audit logs, system health) are gated there
- [ ] Provider sections that depend on specific consent are gated by the data the backend returns (consent-scoped), not by a client capability flag
- [ ] Role checks enforced at backend (client-side role gating is cosmetic only — the backend RBAC middleware is the real authorization boundary)

### 10. Demo Mode
- [ ] Demo banner/button only shown when `VITE_DEMO_MODE=true` (`onDemoLogin` wired in `App.tsx`)
- [ ] Demo login is a REAL backend call (`authApi.demoLogin()` → `POST /auth/demo`) returning a real (restricted) session, not client-side mock data — backend `demoProtection` middleware blocks sensitive mutations
- [ ] Demo account cannot access sensitive features (enforced server-side, not just UI)
- [ ] Demo mode clearly indicated in UI

### 11. Lazy Loading Security
- [ ] Pages lazy-loaded via `React.lazy` + `Suspense`
- [ ] Auth check happens before lazy-loaded component renders
- [ ] No flash of protected content during loading
- [ ] Error boundary catches loading failures

### 12. PHI Data Lifecycle
- [ ] PHI fetched on-demand (not pre-loaded)
- [ ] PHI cleared from state on component unmount
- [ ] No PHI stored in `localStorage` or `sessionStorage`
- [ ] Sensitive fields redacted in logger (`src/utils/logger.ts` — `sanitizeData` → `[REDACTED]`, `authLogger`/`apiLogger`)
- [ ] Auth-flow diagnostics go through `authLogger.debug` (prod-gated + sanitized), not raw `console.log` (audit F-18)

### 13. Email-Change Flow (NEW)
- [ ] Request goes through `ChangeEmailModal` → `authApi.requestEmailChange(newEmail, currentPassword)` (`POST /auth/change-email`); re-auths with current password
- [ ] Change is NOT applied on request — confirmation link is emailed to the NEW address (security notice to old)
- [ ] `/confirm-email-change?token=...` route renders `ConfirmEmailChangePage` → `authApi.confirmEmailChange(token)` (`GET /auth/confirm-email-change`)
- [ ] On confirm, backend swaps email AND revokes all sessions → user routed back to login
- [ ] Confirmation token is single-use; UI guards against double-submit (`confirmedRef`)
- [ ] New email + current password cleared from modal state on close (`resetForm`)

### 14. Inactivity Auto-Logoff (HIPAA §164.312(a)(2)(iii))
- [ ] `AuthContext` arms idle timers only while authenticated (warning at 13 min, logout at 15 min)
- [ ] Activity events reset timers: `mousedown`, `keydown`, `touchstart`, `scroll` (mousemove deliberately excluded)
- [ ] Timeout force-reloads to `/?sessionExpired=true` so in-memory PHI in all tabs is discarded
- [ ] Warning dialog offers "Stay signed in" (resets timers) and "Sign out now"

## Questions to Ask
1. Is the token refresh order correct (refresh BEFORE getCurrentUser on mount)?
2. Are tokens stored anywhere persistent (only the in-memory access token in `client.ts`)?
3. Are URL tokens cleaned up after use (verify, reset, confirm-email-change)?
4. Are role checks enforced at both frontend and backend?
5. Does demo mode leak any real PHI (it IS a real backed session — is `demoProtection` blocking sensitive ops)?
6. Does the email-change flow revoke sessions and require re-login after confirmation?
7. Does idle auto-logoff actually clear in-memory PHI (force-reload, not SPA route change)?
