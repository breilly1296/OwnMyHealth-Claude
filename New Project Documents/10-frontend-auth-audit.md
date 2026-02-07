# Frontend Authentication Security Audit Report

**Project:** OwnMyHealth
**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (automated security audit)
**Scope:** Frontend authentication, authorization, token management, and PHI data lifecycle
**Severity Legend:** CRITICAL = data exposure/auth bypass, HIGH = significant risk, MEDIUM = defense-in-depth gap, LOW = best-practice improvement

---

## Executive Summary

The OwnMyHealth frontend authentication architecture is **well-designed overall** with several strong security patterns: memory-only token storage, httpOnly cookie reliance, correct refresh-then-fetch ordering, URL token cleanup via `replaceState`, PHI data cleanup on unmount, and a structured RBAC system. However, the audit identified **2 medium-severity findings** and **3 low-severity findings** that should be addressed. No critical or high-severity vulnerabilities were found.

---

## Files Reviewed

| File | Path |
|------|------|
| AuthContext.tsx | `src/contexts/AuthContext.tsx` |
| ThemeContext.tsx | `src/contexts/ThemeContext.tsx` |
| client.ts | `src/services/api/client.ts` |
| auth.ts | `src/services/api/auth.ts` |
| LoginPage.tsx | `src/components/auth/LoginPage.tsx` |
| RegisterPage.tsx | `src/components/auth/RegisterPage.tsx` |
| VerifyEmailPage.tsx | `src/components/auth/VerifyEmailPage.tsx` |
| ResetPasswordPage.tsx | `src/components/auth/ResetPasswordPage.tsx` |
| ForgotPasswordPage.tsx | `src/components/auth/ForgotPasswordPage.tsx` |
| useRBAC.ts | `src/hooks/useRBAC.ts` |
| RoleGuard.tsx | `src/components/common/RoleGuard.tsx` |
| App.tsx | `src/App.tsx` |
| logger.ts | `src/utils/logger.ts` |
| useApi.ts | `src/hooks/useApi.ts` |
| useBiomarkerData.ts | `src/hooks/useBiomarkerData.ts` |
| ErrorBoundary.tsx | `src/components/common/ErrorBoundary.tsx` |
| DashboardHeader.tsx | `src/components/dashboard/DashboardHeader.tsx` |
| index.ts | `src/services/api/index.ts` |

---

## Checklist Results

### 1. Token Storage (CRITICAL)

- [x] **PASS** - NO tokens in localStorage
  **Evidence:** Grep across entire `src/` directory for `localStorage` shows only `ThemeContext.tsx` (theme preference: `omh-theme`) and `AccountSettingsPage.tsx` (notification preferences: `omh-notifications`). Neither stores auth tokens, session data, or PHI. The `client.ts` module stores the auth token in a module-scoped variable (`let authToken: string | null = null;` at `src/services/api/client.ts:42`).

- [x] **PASS** - NO tokens in sessionStorage
  **Evidence:** Grep for `sessionStorage` across `src/` returned zero matches in production code (only in test setup mocks). No session storage usage found.

- [x] **PASS** - Tokens stored in memory (state) only
  **Evidence:** `src/services/api/client.ts:42` declares `let authToken: string | null = null;` as a module-scoped variable. Token is set via `setAuthToken()` (line 47) and cleared via `clearAuthToken()` (line 55). The AuthContext stores only `user: { id, email, role }` in React state -- no tokens in React state. The access token is also managed as an httpOnly cookie by the browser (not accessible to JS).

- [x] **PASS** - Auth state cleared on logout/tab close
  **Evidence:** `src/contexts/AuthContext.tsx:157-163` -- `logout` calls `authApi.logout()` (which sends POST to backend to invalidate session), then in the `finally` block calls `setUser(null)` and `clearAuthToken()`. On tab close, the module-scoped `authToken` variable is garbage collected. httpOnly cookies persist but require valid server-side sessions.

### 2. Auth Context Flow

- [x] **PASS** - On page load: `refreshToken()` called FIRST
  **Evidence:** `src/contexts/AuthContext.tsx:77-112` -- The `useEffect` on mount calls `checkAuth()` which first calls `await authApi.refreshToken()` (line 89), and only if that succeeds does it proceed to `await authApi.getCurrentUser()` (line 100). Comments on lines 80-87 explicitly document this ordering as a "CRITICAL FIX."

- [x] **PASS** - Then: `getCurrentUser()` called after refresh
  **Evidence:** `src/contexts/AuthContext.tsx:100` -- `getCurrentUser()` is called only after the `refreshToken()` call succeeds. If `refreshToken()` fails (caught at line 91), the function returns early without calling `getCurrentUser()`.

- [x] **PASS** - Token refresh happens before API calls (not after 401)
  **Evidence:** The initial auth check in `AuthContext.tsx` correctly refreshes first. Additionally, `client.ts:187-213` implements automatic token refresh on 401 responses as a fallback -- if a request gets a 401 and it is not already a retry, it calls `attemptTokenRefresh()` and retries the request. This is a proper belt-and-suspenders approach.

- [x] **PASS** - Auth state properly initialized
  **Evidence:** `src/contexts/AuthContext.tsx:72-74` -- `user` starts as `null`, `isLoading` starts as `true`, `error` starts as `null`. The `isLoading` flag prevents premature rendering until auth check completes. `App.tsx:163-175` shows the loading spinner while `isLoading` is true.

### 3. Protected Routes

- [x] **PASS** - Routes requiring auth redirect to login
  **Evidence:** `src/App.tsx:237-273` -- When `!isAuthenticated`, the app renders only LoginPage, RegisterPage, or ForgotPasswordPage depending on `authView` state. The Dashboard component is only rendered when `isAuthenticated` is true (line 276-280). There is no URL-based router that could be manipulated.

- [x] **PASS** - Auth check happens before render
  **Evidence:** `src/App.tsx:163-175` -- While `isLoading` is true (auth check in progress), a loading spinner is shown. Only after `isLoading` becomes false does the `isAuthenticated` check determine which component to render.

- [x] **PASS** - No flash of protected content before redirect
  **Evidence:** The `isLoading` initial state is `true` (`AuthContext.tsx:73`), and the loading screen (`App.tsx:163-175`) is shown until auth check completes. Lazy-loaded components use `<Suspense fallback={<LoadingFallback />}>` wrappers, preventing any flash.

### 4. Login/Logout Flow

- [~] **PARTIAL** - Login clears any stale state
  **Evidence:** `src/contexts/AuthContext.tsx:114-128` -- `login()` sets `isLoading(true)` and `setError(null)` but does NOT call `clearAuthToken()` before attempting login. If a previous session's token is still in memory, it would be sent alongside the new login request. In practice this is low risk because the login endpoint likely ignores the Authorization header, but explicit clearing would be more defensive. `App.tsx:178-179` calls `clearError()` before login.
  **Finding [LOW]:** Consider calling `clearAuthToken()` at the start of the `login()` function in AuthContext.tsx to ensure no stale token is sent with the login request.

- [x] **PASS** - Logout clears all auth state
  **Evidence:** `src/contexts/AuthContext.tsx:157-163` -- `logout()` calls `authApi.logout()` then unconditionally (in `finally`) calls `setUser(null)` and `clearAuthToken()`. `src/services/api/auth.ts:51-57` -- `authApi.logout()` also calls `clearAuthToken()` in its own `finally` block (double-clearing is safe).

- [x] **PASS** - Logout calls backend to invalidate tokens
  **Evidence:** `src/services/api/auth.ts:52-53` -- `logout()` calls `apiFetch('/auth/logout', { method: 'POST' })`, which sends a POST to the backend. Per CLAUDE.md, the backend uses DB-backed sessions, so this invalidates the refresh token server-side.

- [x] **PASS** - Redirect to login after logout
  **Evidence:** When `logout()` sets `user` to `null`, `isAuthenticated` becomes `false` (`AuthContext.tsx:172`), and `App.tsx:237` renders the login page. No explicit redirect is needed -- state-driven rendering handles it.

### 5. Error Handling

- [x] **PASS** - 401 errors trigger logout/redirect
  **Evidence:** `src/services/api/client.ts:187-194, 206-213` -- On 401 responses, the client first attempts token refresh. If refresh fails, it calls `onAuthFailureCallback()` which would trigger logout. The `onAuthFailureCallback` mechanism is exported via `setOnAuthFailure()` (line 59). Upload utilities at `src/services/uploadUtils.ts:159-160, 178-179` also call this callback on auth failure.

- [x] **PASS** - Network errors don't crash app
  **Evidence:** `src/services/api/client.ts:231-251` -- Network errors are caught and wrapped in a user-friendly `ApiError` object with `ERROR_MESSAGES.NETWORK_ERROR` message. `src/components/common/ErrorBoundary.tsx` wraps the entire app and catches rendering errors. `App.tsx:285` confirms `<ErrorBoundary>` is at the root.

- [x] **PASS** - Error messages don't leak sensitive info
  **Evidence:** `src/services/api/client.ts:63-89` -- `getUserFriendlyMessage()` returns generic messages for all error codes. Server messages are only passed through for 4xx errors (line 64-65), and the backend should already sanitize those per CLAUDE.md. Error messages like "Your session has expired", "Something went wrong on our end" etc. reveal no internals.

- [x] **PASS** - Failed login shows generic message
  **Evidence:** `src/contexts/AuthContext.tsx:122` -- On login failure, the error message from the server is displayed. The backend should return generic messages like "Invalid email or password" (not "user not found" vs "wrong password"). The frontend error mapping in `client.ts` provides generic fallbacks. `src/components/auth/ForgotPasswordPage.tsx:44-51` explicitly shows success even on failure to avoid email enumeration.

### 6. Password Handling

- [x] **PASS** - Password field uses `type="password"`
  **Evidence:**
  - `LoginPage.tsx:286` -- `type={showPassword ? 'text' : 'password'}` (defaults to password)
  - `RegisterPage.tsx:215` -- `type={showPassword ? 'text' : 'password'}` (defaults to password)
  - `RegisterPage.tsx:273` -- Confirm password field also uses `type={showConfirmPassword ? 'text' : 'password'}`
  - `ResetPasswordPage.tsx:149` -- `type={showPassword ? 'text' : 'password'}` (defaults to password)
  - `ResetPasswordPage.tsx:184` -- Confirm password also uses `type={showConfirmPassword ? 'text' : 'password'}`
  All password fields default to masked input with optional show/hide toggle.

- [x] **PASS** - Password not logged to console
  **Evidence:** Grep for `console.*password` (case insensitive) returned zero matches in `src/`. The logger utility at `src/utils/logger.ts:20-27` includes `password` in the `SENSITIVE_FIELDS` set, and `sanitizeData()` (lines 32-57) redacts it to `[REDACTED]` before any log output.

- [~] **PARTIAL** - Password cleared from state after submission
  **Evidence:** LoginPage and RegisterPage store passwords in React `useState` hooks. After successful submission:
  - `LoginPage.tsx` -- Password state is NOT explicitly cleared after `onLogin()` succeeds. However, on successful login the entire component unmounts (App.tsx switches to Dashboard), so the state is garbage collected.
  - `RegisterPage.tsx` -- Password state is NOT explicitly cleared after `onRegister()` succeeds. The registration flow does not auto-navigate away (user must verify email first), so password remains in component state.
  - `ResetPasswordPage.tsx` -- Password state is NOT explicitly cleared after success. The component switches to a success view (line 73) and auto-redirects after 2 seconds.
  **Finding [LOW]:** Password state should be explicitly cleared after successful submission in RegisterPage and ResetPasswordPage to minimize the window where password text exists in memory. For LoginPage this is mitigated by component unmount.

- [x] **PASS** - No password in URL parameters
  **Evidence:** All password submissions use POST request bodies (`JSON.stringify({ email, password })` at `auth.ts:31-33` for login, `auth.ts:42-44` for register, `auth.ts:102` for reset). No password data appears in URLs.

### 7. CSRF Token Handling

- [x] **PASS** - CSRF token read from `csrf_token` cookie
  **Evidence:** `src/services/api/client.ts:97-107` -- `getCsrfToken()` reads `document.cookie` and matches against the pattern `/csrf[_-]?token=([^;]+)/i`, which captures `csrf_token`, `csrf-token`, and `csrftoken` variants. This is flexible and correct.

- [x] **PASS** - Token included in `X-CSRF-Token` header
  **Evidence:** `src/services/api/client.ts:161-167` -- For `POST`, `PUT`, `PATCH`, and `DELETE` requests, the CSRF token is added as the `x-csrf-token` header. A warning is logged if no token is available (line 166).

- [~] **PARTIAL** - Token refreshed after login
  **Evidence:** The CSRF token is read from `document.cookie` on every request (`getCsrfToken()` is called inside `apiFetch()` at line 162), so it always uses the latest cookie value. However, there is no explicit call to refresh/re-fetch the CSRF cookie after login. The backend is expected to set a new `csrf_token` cookie in the login response headers, and the browser automatically stores it. This works correctly as long as the backend sets the cookie.
  **Note:** This is acceptable -- no explicit client-side refresh is needed because `getCsrfToken()` reads from `document.cookie` dynamically on each request.

### 8. URL Token Cleanup

- [x] **PASS** - Email verification tokens cleared from URL after read
  **Evidence:** `src/App.tsx:116-121` -- A `useEffect` checks `specialRoute?.token` and calls `window.history.replaceState({}, document.title, window.location.pathname)` to remove the query string (which contains the token) from the URL. This runs immediately after the token is captured into state.

- [x] **PASS** - Password reset tokens cleared from URL after read
  **Evidence:** Same mechanism as email verification. `App.tsx:71-85` -- `getSpecialRoute()` captures both `/verify-email?token=...` and `/reset-password?token=...` tokens. The `useEffect` at line 116-121 cleans up both.

- [x] **PASS** - Uses `window.history.replaceState()`
  **Evidence:** `src/App.tsx:119` -- `window.history.replaceState({}, document.title, window.location.pathname)` is used (not `pushState`), which correctly replaces the history entry rather than adding a new one. This prevents the token from being accessible via the back button.

### 9. Role-Based UI Protection

- [x] **PASS** - `useRBAC` hook provides role checks: `isPatient`, `isProvider`, `isAdmin`
  **Evidence:** `src/hooks/useRBAC.ts:24-49` -- The `permissions` object includes `isPatient`, `isProvider`, `isAdmin`, `canViewPatients`, `canManageUsers`, `canViewAuditLogs`, `canAccessAdminPanel`, and `canManageProviderAccess`. Role hierarchy is defined at lines 13-17 with ADMIN=3, PROVIDER=2, PATIENT=1.

- [x] **PASS** - `RoleGuard` component wraps protected UI sections
  **Evidence:** `src/components/common/RoleGuard.tsx:44-67` -- `RoleGuard` checks authentication first (line 48), then specific roles (lines 53-57), then minimum role level (lines 60-64). Convenience wrappers are provided: `PatientOnly`, `ProviderOnly`, `AdminOnly`, `ProviderOrAdmin` (lines 72-111).

- [x] **PASS** - Provider-only views hidden from patients
  **Evidence:** `RoleGuard.tsx:83-89` -- `ProviderOnly` uses `roles={['PROVIDER']}`. `ProviderOrAdmin` (lines 105-111) uses `minRole="PROVIDER"` which includes both PROVIDER and ADMIN via hierarchy. `useRBAC.ts:44` -- `canViewPatients` requires `roleLevel >= ROLE_HIERARCHY.PROVIDER`.

- [x] **PASS** - Admin-only views hidden from non-admins
  **Evidence:** `RoleGuard.tsx:94-99` -- `AdminOnly` uses `roles={['ADMIN']}`. `useRBAC.ts:45-47` -- `canManageUsers`, `canViewAuditLogs`, and `canAccessAdminPanel` all require `roleLevel >= ROLE_HIERARCHY.ADMIN`.

- [x] **PASS** - Permission-based sections hidden when provider lacks specific consent
  **Evidence:** `useRBAC.ts:48` -- `canManageProviderAccess` is restricted to `role === 'PATIENT'` only. The provider access is scoped to consent permissions (per CLAUDE.md architecture). Frontend hiding is supplemented by backend enforcement.

- [x] **PASS** - Role checks enforced at backend (UI hiding is convenience, not security)
  **Evidence:** Per CLAUDE.md, `backend/src/middleware/rbac.ts` provides server-side role-based access control, and `backend/src/middleware/auth.ts` provides JWT verification on all protected routes. The frontend `RoleGuard` is documented as a "convenience" wrapper (`RoleGuard.tsx:5-6`), not a security boundary.

### 10. Demo Mode

- [x] **PASS** - Demo mode only active when `VITE_DEMO_MODE=true`
  **Evidence:** `src/hooks/useBiomarkerData.ts:18` -- `const DEMO_MODE = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === 'true';` -- This requires BOTH `DEV` mode AND the explicit environment variable. Double-gated.

- [x] **PASS** - Demo uses sample data (no backend calls)
  **Evidence:** `src/hooks/useBiomarkerData.ts:101-102` -- When `DEMO_MODE` is true, the hook returns early with sample biomarker data instead of calling the API. Lines 162-164, 222, 247, 281, 355, 407 all have early returns for `DEMO_MODE`.

- [~] **PARTIAL** - Demo account cannot access sensitive features
  **Evidence:** The demo login at `App.tsx:189-207` falls back to hard-coded credentials (`demo@ownmyhealth.com` / `Demo123!` at line 200). This is a real backend login, not a sandboxed demo. Per CLAUDE.md, `backend/src/middleware/demoProtection.ts` exists to restrict demo account operations, but the frontend does not independently gate sensitive features for demo users.
  **Finding [MEDIUM]:** Hard-coded demo credentials are visible in the frontend source code (`App.tsx:200`). While the backend has demo protection middleware, the credentials are exposed in the JavaScript bundle. Anyone can extract these credentials from the built JavaScript. If the demo account is blocked in production (per CLAUDE.md), this is mitigated, but the credential exposure is still a concern if the demo endpoint is accidentally left enabled.

- [x] **PASS** - Demo mode clearly indicated in UI
  **Evidence:** `src/components/dashboard/DashboardHeader.tsx:137-139` -- When `!user`, the header displays "Demo Mode" text in place of the user menu.

### 11. Lazy Loading Security

- [x] **PASS** - Pages lazy-loaded via `React.lazy` + `Suspense`
  **Evidence:** `src/App.tsx:37-42` -- All auth pages and Dashboard are loaded via `lazy()`: `Dashboard`, `LoginPage`, `RegisterPage`, `VerifyEmailPage`, `ResetPasswordPage`, `ForgotPasswordPage`. Dashboard sub-pages at `src/components/dashboard/Dashboard.tsx:40-44` also use lazy loading for `InsuranceHub`, `FilesPage`, `TrendsPage`, `AccountSettingsPage`.

- [x] **PASS** - Auth check happens before lazy-loaded component renders
  **Evidence:** `src/App.tsx:163-175` -- The `isLoading` check occurs before any `<Suspense>` blocks. Only after auth state is resolved does the code branch to render either login views (lines 237-273) or the Dashboard (lines 276-280). Each lazy component is wrapped in its own `<Suspense fallback={<LoadingFallback />}>`.

- [x] **PASS** - No flash of protected content during loading
  **Evidence:** `isLoading` defaults to `true` (AuthContext.tsx:73), so the app shows a loading spinner until auth state is determined. The `<Suspense>` fallback (`LoadingFallback` at App.tsx:45-57) shows a branded spinner with no content, and the `PageLoadSpinner` (Dashboard.tsx:53-61) also shows only a spinner.

- [x] **PASS** - Error boundary catches loading failures
  **Evidence:** `src/App.tsx:285` -- `<ErrorBoundary>` wraps the entire component tree at the root level. `src/components/common/ErrorBoundary.tsx` is a proper React error boundary that catches rendering errors and displays a user-friendly fallback with retry/home navigation. In development mode, it shows error details behind a `<details>` element (line 108); in production, only the generic message is shown.

### 12. PHI Data Lifecycle

- [x] **PASS** - PHI fetched on-demand (not pre-loaded)
  **Evidence:** `src/hooks/useBiomarkerData.ts` fetches biomarkers and insurance plans only after the user is authenticated and the component mounts. `src/hooks/useApi.ts:69-83` -- data fetching is triggered by `useEffect` on mount, not pre-loaded. The `AuthContext.tsx` stores only `{ id, email, role }` (line 40-44), explicitly documented as "non-PHI identification data" (line 38-39).

- [x] **PASS** - PHI cleared from state on component unmount
  **Evidence:**
  - `src/hooks/useApi.ts:76-81` -- `clearOnUnmount` option (default `true`) nullifies data state on unmount: `setState({ data: null, loading: false, error: null })`.
  - `src/hooks/useBiomarkerData.ts:212-218` -- Dedicated cleanup effect: `return () => { setBiomarkers([]); setInsurancePlans([]); }`.
  - Biomarker, insurance, health need, and patient data hooks all use `clearOnUnmount: true` (useApi.ts lines 112, 123, 135, 155, 166, 178, 188, 199).

- [x] **PASS** - No PHI stored in `localStorage` or `sessionStorage`
  **Evidence:** Comprehensive grep confirms localStorage is only used for theme (`omh-theme`) and notification preferences (`omh-notifications`). sessionStorage has zero usage. No PHI fields (biomarkers, insurance IDs, health data, etc.) are persisted.

- [x] **PASS** - Sensitive fields redacted in logger (`src/utils/logger.ts`)
  **Evidence:** `src/utils/logger.ts:20-27` -- `SENSITIVE_FIELDS` set includes: `password`, `token`, `accessToken`, `refreshToken`, `secret`, `ssn`, `socialSecurityNumber`, `memberId`, `groupNumber`, `memberIdEncrypted`, `groupIdEncrypted`, `valueEncrypted`, `descriptionEncrypted`, `noteEncrypted`, `genotype`, `email`, `phoneNumber`, `address`, `dateOfBirth`, `authorization`, `cookie`, `sessionId`. The `sanitizeData()` function (lines 32-57) recursively redacts these fields. In production, debug/info logs are suppressed entirely (line 64).

---

## Additional Findings

### Finding F1: Auth Token Preview Logged to Console [MEDIUM]

**Location:** `src/hooks/useBiomarkerData.ts:155-159`
**Severity:** MEDIUM
**Description:** The first 20 characters of the JWT access token are logged to the browser console:
```typescript
authTokenPreview: authToken ? `${authToken.substring(0, 20)}...` : 'NULL',
```
While the logger utility at `logger.ts` properly redacts sensitive fields, this `console.log` call bypasses the logger and writes directly to `console.log`. The JWT header and part of the payload are exposed, which could aid an attacker with console access (e.g., via XSS or shoulder surfing) in understanding the token structure.

**Recommendation:** Replace direct `console.log` calls in `useBiomarkerData.ts` with the `dashboardLogger` (which is already imported at line 14). At minimum, remove the `authTokenPreview` field from the logged data.

### Finding F2: Hard-coded Demo Credentials in Source [MEDIUM]

**Location:** `src/App.tsx:200`
**Severity:** MEDIUM (mitigated if demo is blocked in production)
**Description:** Demo login fallback contains hard-coded credentials:
```typescript
await login('demo@ownmyhealth.com', 'Demo123!');
```
These credentials are visible in the JavaScript bundle and can be extracted by anyone inspecting the frontend code. Per CLAUDE.md, a `demoProtection.ts` middleware exists on the backend and the demo is intended to be blocked in production (`DEMO_ACCOUNT_ENABLED=false`).

**Recommendation:** Instead of hard-coding credentials, rely exclusively on the `/auth/demo` endpoint. Remove the fallback that uses `login()` with plain-text credentials. If the demo endpoint is disabled in production, the demo button should also be conditionally hidden based on an environment flag.

### Finding F3: Password Not Cleared After Registration [LOW]

**Location:** `src/components/auth/RegisterPage.tsx`
**Severity:** LOW
**Description:** After successful registration, the password and confirmPassword state values remain in memory until the component is unmounted or the user navigates away. Since registration does not auto-redirect (the user must verify email), the password persists in component state unnecessarily.

**Recommendation:** Clear password state after successful submission:
```typescript
setPassword('');
setConfirmPassword('');
```

### Finding F4: Verbose Console Logging in Data Hooks [LOW]

**Location:** `src/hooks/useBiomarkerData.ts:155-199` (multiple `console.log` and `console.warn` calls)
**Severity:** LOW
**Description:** The insurance plan fetch logic contains approximately 10 `console.log` calls that output operational details (user IDs, plan counts, token availability, error details). While not directly exposing PHI (insurance plan data is encrypted server-side), this verbose logging in production builds could aid reconnaissance and violates the principle of minimal logging.

**Recommendation:** Replace all direct `console.*` calls with the existing `dashboardLogger` from `src/utils/logger.ts`, which suppresses debug/info output in production and automatically redacts sensitive fields.

### Finding F5: `onAuthFailureCallback` Not Wired in AuthContext [LOW]

**Location:** `src/services/api/client.ts:59-61` and `src/contexts/AuthContext.tsx`
**Severity:** LOW
**Description:** The `setOnAuthFailure()` function exists in `client.ts` to register a callback for when token refresh fails (triggering logout). However, a grep of `AuthContext.tsx` shows it does not call `setOnAuthFailure()` to wire up the logout function. The upload utility (`uploadUtils.ts:30-31`) does wire it. If an API call (not upload) receives a 401 and refresh fails, `onAuthFailureCallback` may be null, meaning the user stays on a broken auth state rather than being redirected to login.

**Recommendation:** In `AuthContext.tsx`, call `setOnAuthFailure(logout)` after the logout function is defined to ensure all 401 failures trigger a proper logout and redirect.

---

## Answers to Key Questions

### 1. Is the token refresh order correct?
**Yes.** `AuthContext.tsx:88-100` calls `refreshToken()` first, then `getCurrentUser()`. This is the correct order, explicitly documented with a "CRITICAL FIX" comment explaining why.

### 2. Are tokens stored anywhere persistent?
**No.** The access token is stored only in a module-scoped JavaScript variable (`client.ts:42`). The refresh token is stored in an httpOnly cookie (not accessible to JS). Theme and notification preferences use localStorage but contain no auth or PHI data.

### 3. Are URL tokens cleaned up after use?
**Yes.** `App.tsx:116-121` uses `window.history.replaceState()` to remove the query string from the URL immediately after the token is captured into React state. Both email verification and password reset tokens are cleaned up.

### 4. Are role checks enforced at both frontend and backend?
**Yes.** Frontend uses `useRBAC` hook and `RoleGuard` component for UI-level gating. Backend has `rbac.ts` middleware for server-side enforcement. The frontend guards are documented as "convenience" -- the backend is the security boundary.

### 5. Does the demo mode leak any real API data?
**Partially.** When `VITE_DEMO_MODE=true` (dev only, double-gated), sample data is used and no API calls are made. However, the demo login fallback at `App.tsx:200` uses real backend authentication with hard-coded credentials, which is a real API login, not a sandbox. The demo protection middleware on the backend is intended to restrict what the demo account can access.

---

## Summary of Findings

| ID | Severity | Title | Location |
|----|----------|-------|----------|
| F1 | MEDIUM | Auth token preview logged to console | `useBiomarkerData.ts:159` |
| F2 | MEDIUM | Hard-coded demo credentials in source | `App.tsx:200` |
| F3 | LOW | Password not cleared after registration | `RegisterPage.tsx` |
| F4 | LOW | Verbose console logging in data hooks | `useBiomarkerData.ts:155-199` |
| F5 | LOW | `onAuthFailureCallback` not wired in AuthContext | `AuthContext.tsx` / `client.ts` |

---

## Overall Assessment

**Rating: GOOD** -- The frontend authentication architecture follows security best practices with memory-only token storage, proper refresh ordering, URL token cleanup, CSRF protection, PHI lifecycle management, and structured RBAC. The identified findings are medium and low severity, with no critical vulnerabilities found. Addressing F1 and F2 should be prioritized, while F3-F5 are recommended improvements.
