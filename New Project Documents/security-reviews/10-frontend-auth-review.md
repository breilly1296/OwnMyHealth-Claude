# Frontend Authentication Review — 2026-06-16

Scope: `prompts/10-frontend-auth.md` checklist, executed against the live code at
HEAD `fb2cd32`. Every passed item is backed by a `file:line` citation; nothing is
ticked on assertion alone. Findings are ranked by exploitability × blast radius.

This is a frontend-auth-focused review. Client-side auth/role gating is, by
design, cosmetic — the backend RBAC/auth middleware is the real authorization
boundary. Findings here are therefore weighted as defense-in-depth / hygiene
unless they create a real client-side disclosure or session-handling defect. No
Critical or High issue was found in the reviewed surface.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 4 |

## Findings

### F-1 — Demo-session indicator keys off a build flag, not the actual demo identity — **Low**
- **Location:** `src/components/dashboard/DashboardHeader.tsx:90-97`; `src/App.tsx:281`, `:292-296`
- **Observation:** The "Demo Mode" badge renders for ANY signed-in user whenever the build was compiled with `VITE_DEMO_MODE === 'true'` (`user && import.meta.env.VITE_DEMO_MODE === 'true'`). It is not tied to whether the *current* session is the demo account. Conversely, `App.tsx` always renders `<Dashboard />` with no props, so `Dashboard`'s `isDemoMode` prop defaults to `false` (`Dashboard.tsx:93`) even for a real demo session — the sample-data path and onboarding skip (`Dashboard.tsx:124,144,149`) are effectively dead in the deployed flow. The component author documents this as an accepted limitation: the client has no per-account demo flag because the demo account is identified server-side via `DEMO_EMAIL`, which is never exposed to the client (`DashboardHeader.tsx:84-89`).
- **Impact:** Cosmetic only. In a demo-enabled build a real (non-demo) user could see a "Demo Mode" badge, and a demo user in a non-demo build would see none. There is no security consequence: demo restrictions are enforced server-side in `demoProtection.ts` (role change, cross-user modification, admin, AI, profile mutation are all blocked by `isDemoAccount()`), which fails closed when `DEMO_EMAIL` is empty (`demoProtection.ts:34`). `VITE_DEMO_MODE` is also a build-time flag absent from production builds, so the badge does not appear in prod.
- **Fix:** If an accurate per-session badge is desired, expose a non-sensitive `isDemo` boolean on the `/auth/me` response (derived server-side from `DEMO_EMAIL`) and key the badge on `user.isDemo` instead of the build flag. Until then, document the build-flag behavior so it is not mistaken for a per-session control.
- **Evidence:**
  ```tsx
  {user && import.meta.env.VITE_DEMO_MODE === 'true' && (
    <span ... title="This is a demo session. Data may be reset and some actions are restricted.">
      Demo Mode
    </span>
  )}
  ```

### F-2 — Mount-time token refresh fires even with no session, producing an avoidable 403/401 on first load — **Low**
- **Location:** `src/contexts/AuthContext.tsx:153-165`; `src/services/api/client.ts:155-164`
- **Observation:** On every initial load (when the URL has no `?sessionExpired=true`), `checkAuth` unconditionally calls `authApi.refreshToken()` before it knows whether a session exists. On a truly fresh first visit there is no `csrf_token` cookie yet, so `getCsrfToken()` returns `''` and no `x-csrf-token` header is attached (`client.ts:156-159`). The backend does NOT exempt `/auth/refresh` from CSRF (`backend/src/middleware/csrf.ts:124-145` — `/auth/refresh` is deliberately absent from `EXEMPT_PATHS`), so the request is rejected (403 missing token / 401 no refresh cookie).
- **Impact:** None to confidentiality or integrity — the `catch` branch correctly resolves this to `setUser(null)` (the right state for a user with no session). The cost is one guaranteed failed network round-trip + a console-visible 4xx on every cold load for unauthenticated visitors (e.g., the login page). Minor noise / latency, not a vulnerability.
- **Fix:** Optional hardening: skip the proactive refresh when neither a refresh cookie indicator nor a `csrf_token` cookie is present (the SPA can't read the HttpOnly refresh cookie, but absence of any `csrf_token` cookie is a reliable "no prior session" signal). Or accept the current behavior as intentional — it is functionally correct.
- **Evidence:**
  ```ts
  try {
    await authApi.refreshToken();
    authLogger.debug('Access token refreshed from refresh token');
  } catch {
    authLogger.debug('Refresh token invalid, user not authenticated');
    setUser(null);
    setIsLoading(false);
    return;
  }
  ```

### F-3 — Frontend logger `SENSITIVE_FIELDS` redaction is case-folded but only matches exact keys (no substring / nested-key-name match) — **Low**
- **Location:** `src/utils/logger.ts:20-56`
- **Observation:** `sanitizeData` redacts a value only when `SENSITIVE_FIELDS.has(key.toLowerCase())` is an exact match. Composite or vendor-shaped field names that *contain* a sensitive token but aren't an exact entry — e.g. `userPassword`, `refresh_token` (underscore form; the set has `refreshtoken` only after lowercasing `refreshToken`, but `refresh_token` lowercases to `refresh_token` which is NOT in the set), `bearerToken`, `x-csrf-token` header keys — would pass through un-redacted if ever logged as object keys. The set also omits `firstName`/`lastName`/`healthProfile` (PHI per the inventory) and `csrf`/`csrfToken`.
- **Impact:** Low. This is a backstop, not the primary control: the codebase routes auth diagnostics through `authLogger.debug`/`apiLogger.warn`, which are production-gated (`logger.ts:64-70`) and never passed raw secrets at the call sites I reviewed (the CSRF-missing warns deliberately log no token value — `client.ts:129-136,248-253`). A leak requires a future caller to both log a sensitive object AND use a non-exact key name in a prod/DEBUG build. No current call site does this.
- **Fix:** In `sanitizeData`, match on substring/normalized key (e.g. redact if the lowercased key includes any of `password|token|secret|ssn|memberid|groupid|authorization|cookie|sessionid`), and add `firstname`, `lastname`, `healthprofile`, `csrf`, `csrftoken`, `targetvalue`, `currentvalue`, `startvalue` to the set to mirror `PHI_FIELDS`.
- **Evidence:**
  ```ts
  const lowerKey = key.toLowerCase();
  if (SENSITIVE_FIELDS.has(lowerKey)) {
    sanitized[key] = '[REDACTED]';
  } ...
  ```

### F-4 — Prompt drift: checklist item 4 cites `RegisterPage.tsx:107-111,149-159`; live confirmation/resend block is at `:149-183` — **Low**
- **Location:** `prompts/10-frontend-auth.md:19,62-63` vs `src/components/auth/RegisterPage.tsx:107-114,149-183`
- **Observation:** The prompt's line citations for the post-register "Check your inbox" confirmation state and resend button have drifted. The behavior the prompt describes is present and correct, but at different lines: the success-state set is `RegisterPage.tsx:107-111`, the confirmation UI block is `:149-183` (not `:149-159`), and the resend handler is `:117-125` calling `authApi.resendVerification` (`:120`). Per the review protocol's "trust the code" rule, this is logged as prompt drift for the quarterly refresh.
- **Impact:** None — documentation accuracy only.
- **Fix:** Update `prompts/10-frontend-auth.md` line citations to `RegisterPage.tsx:107-114` (success-state clear + flag), `:117-125` (resend handler), `:149-183` (confirmation UI).
- **Evidence:**
  ```tsx
  // RegisterPage.tsx:108-111
  setPassword('');
  setConfirmPassword('');
  setRegisteredEmail(email);
  setRegistered(true);
  ```

## Checks passed

### 1. Token Storage (CRITICAL)
- [x] NO tokens in localStorage — repo-wide sweep shows the only `localStorage` uses are theme preference (`src/contexts/ThemeContext.tsx:32,43,88`, non-PHI) and test mocks; no auth token is written there.
- [x] NO tokens in sessionStorage — only `sessionStorage` use is chunk-reload de-bounce (`src/main.tsx:9,12`, a timestamp, non-PHI).
- [x] Access token stored in memory only — module-scoped `let authToken` mutated solely via `setAuthToken` (`src/services/api/client.ts:65,70-72`); all writers (`auth.ts:35,46,81,89`, `client.ts:169`) target the in-memory var.
- [x] Auth state cleared on logout — `logout()` calls `clearAuthToken()` + `setUser(null)` (`src/contexts/AuthContext.tsx:228-236`); `clearAuthToken` nulls the var (`client.ts:78-80`).
- [x] Idle auto-logoff force-reloads to discard in-memory PHI — `idleNavigation.redirectToSessionExpired()` sets `window.location.href = '/?sessionExpired=true'` (a hard navigation, not SPA route change) (`AuthContext.tsx:64-68,270`).

### 2. Auth Context Flow
- [x] On mount `authApi.refreshToken()` is called FIRST — `AuthContext.tsx:154`, before any `getCurrentUser`.
- [x] `getCurrentUser()` (`/auth/me`) runs only after refresh succeeds — `AuthContext.tsx:168`; `getCurrentUser` hits `/auth/me` (`auth.ts:73-76`).
- [x] Refresh failure short-circuits to `setUser(null)` without calling `getCurrentUser` — `AuthContext.tsx:159-165` (`catch` returns early).
- [x] Reactive 401-refresh in client, single-flight guarded — `attemptTokenRefresh` gated by `isRefreshing`/`refreshPromise` (`client.ts:141-192`), invoked on 401 at `client.ts:308-312,327-335`.
- [x] `isLoading` guards initial render — initialized `true` (`AuthContext.tsx:109`), cleared in `finally` (`:176`); `App.tsx:186-198` shows the spinner while loading.
- [x] `setOnAuthFailure` wires client 401-after-refresh-failure to `logout()` — `AuthContext.tsx:353-358`; consumed at `client.ts:313-315,336-338`.

### 3. Protected Routes
- [x] Unauthenticated users get login (not dashboard) — `App.tsx:253-289` renders Login/Register/Forgot when `!isAuthenticated`; Dashboard only at `:292-296`.
- [x] Auth check happens before render — `isLoading` spinner blocks all content until session check resolves (`App.tsx:186-198`).
- [x] No flash of protected content before redirect — Dashboard is only reachable in the `isAuthenticated` branch; there is no transient render of `<Dashboard>` for unauthenticated users.

### 4. Login/Logout/Register Flow
- [x] After successful register, password fields cleared + "Check your inbox" confirmation shown — `RegisterPage.tsx:108-111` (clears) and `:149-183` (confirmation state) gated on `registered`.
- [x] Resend button calls `authApi.resendVerification(registeredEmail)` and reflects `resendState` — `RegisterPage.tsx:117-125` handler; UI states at `:160-173`.
- [x] Login clears stale error before submit — `login()` does `setError(null)` (`AuthContext.tsx:189`); `handleLogin` calls `clearError()` (`App.tsx:202`); LoginPage clears field errors (`LoginPage.tsx:49-50`).
- [x] Login does NOT flip global `isLoading` — explicitly documented and implemented; `login` uses local `isAuthLoading` (`App.tsx:203-208`), global flag untouched (`AuthContext.tsx:182-199`).
- [x] Logout clears all auth state — `clearAuthToken()` + `setUser(null)` + `setIdleWarningVisible(false)` (`AuthContext.tsx:231-235`).
- [x] Logout calls backend to invalidate tokens — `authApi.logout()` → `POST /auth/logout` (`auth.ts:51-57`).
- [x] `logoutAll()` revokes all sessions + clears local token regardless of outcome — `auth.ts:65-71` (`POST /auth/logout-all`, `clearAuthToken()` in `finally`).
- [x] Redirect to login after logout — `forceLogoutAndRedirect` hard-navigates to `/?sessionExpired=true` (`AuthContext.tsx:245-271`); non-idle logout drops to the unauthenticated branch via `setUser(null)`.

### 5. Error Handling
- [x] 401 triggers one refresh attempt then logout via `onAuthFailureCallback` — one-shot guarded by `isRetry` (`client.ts:308-316,327-339`).
- [x] Auth-management endpoints exempt from 401-refresh + 429-retry — `isAuthMgmtEndpoint` covers `/auth/refresh`, `/auth/logout`, `/auth/logout-all` (`client.ts:269-272`), checked in both 429 (`:291-296`) and 401 (`:308,327`) paths.
- [x] 429 backs off (Retry-After or exponential w/ jitter, `MAX_RETRY_429`) — `client.ts:200,202-221,291-301`.
- [x] Network errors don't crash app — mapped to `NETWORK_ERROR` / `TIMEOUT_ERROR` (`client.ts:378-395`).
- [x] Error messages don't leak internals — `getUserFriendlyMessage` returns sanitized constants by status (`client.ts:86-112`); `extractErrorMessage` only unwraps the already-sanitized `ApiError.message` (`src/utils/errorHelpers.ts:9-19`).
- [x] Failed login shows generic message — surfaced via `error` string from `getUserFriendlyMessage`/server message (`LoginPage.tsx:248-254`); raw error object logged only in DEV (`LoginPage.tsx:79-81`).
- [x] `PLAN_LIMIT_EXCEEDED` 403s carry structured `planLimit` fields for an upgrade CTA — `client.ts:354-369`; `isPlanLimitError` narrower at `:55-62`.

### 6. Password Handling
- [x] Password fields use `type="password"` (toggleable) — `LoginPage.tsx:309`, `RegisterPage.tsx:274,333`, `ResetPasswordPage.tsx:150,186`, `ChangeEmailModal.tsx:156`.
- [x] Password not logged — no `console.*` with password anywhere in auth components; login failure logs the error object only in DEV (`LoginPage.tsx:79-81`); logger redacts `password` (`logger.ts:21`).
- [x] Password cleared from state after submission — LoginPage clears on failure (`LoginPage.tsx:75`); RegisterPage clears on success (`:108-109`); ChangeEmailModal `resetForm` clears `currentPassword` (`ChangeEmailModal.tsx:32-37`).
- [x] No password in URL params — all flows POST credentials in the JSON body (`auth.ts:30-33,41-48,95-98,108-112,140-145`); no password is ever placed in a query string.

### 7. CSRF Token Handling
- [x] Read via anchored `csrf_token` regex — `getCsrfToken` uses `/(?:^|;\s*)csrf_token=([^;]+)/` (`client.ts:120-139`), preventing same-suffix cookie confusion; matches the backend cookie name `csrf_token` (`backend/src/middleware/csrf.ts:17`).
- [x] Token sent in `x-csrf-token` on POST/PUT/PATCH/DELETE — `client.ts:243-254`; the raw recovery refresh also attaches it (`client.ts:155-159`).
- [x] Token refreshed after login / on refresh — backend re-issues `csrf_token` on login (`authController.ts:374`) and on every refresh (`:421`), and clears it on logout (`:412,487,522`); client always reads the current cookie.
- [x] Missing-token warning is DEV-only and never logs the value — `client.ts:129-136` (`import.meta.env.DEV` guard, no token substring) and `:248-253`.

### 8. URL Token Cleanup
- [x] Verify / reset / confirm-email-change tokens stripped from URL after read — `App.tsx:121-126` runs `window.history.replaceState({}, document.title, window.location.pathname)` whenever `specialRoute?.token` is set, for all three route types parsed at `:77-89`.
- [x] `replaceState` keeps the path, drops the query — `App.tsx:124` passes `window.location.pathname` only.
- [x] One-time tokens consumed exactly once — `ConfirmEmailChangePage` uses `confirmedRef` run-once guard (`ConfirmEmailChangePage.tsx:41-68`); `VerifyEmailPage` uses `verifiedRef` (`VerifyEmailPage.tsx:38-64`); both also pin `onSuccess` via a ref to avoid effect re-fire.

### 9. Role-Based UI Protection
- [x] `useRBAC` exposes only `role`, `isAuthenticated`, `hasRole`, `hasMinRole`, `getRoleLabel`, `getRoleBadgeClasses` (hierarchy ADMIN 3 > PROVIDER 2 > PATIENT 1); no `is*` booleans, no `permissions` flag object — `src/hooks/useRBAC.ts:12-16,18-29,81-88`.
- [x] `RoleGuard`/`PatientOnly`/`ProviderOnly`/`AdminOnly`/`ProviderOrAdmin`/`useRBAC` are unused by any rendered component — repo-wide grep returns only their own files plus the two barrels `src/hooks/index.ts` and `src/components/common/index.ts`; STATUS note at `RoleGuard.tsx:7-16` is accurate.
- [x] Real UI role gating is inline in Dashboard — nav filter `visibleCategories`/`visibleNavGroups` (`Dashboard.tsx:134-138`) + defensive recheck in `renderSpecialPage` against `cat.roles` (`Dashboard.tsx:239-268`) for deep-link/back-forward access.
- [x] Consent-scoped provider sections gated by backend-returned data — the `renderSpecialPage` recheck comment explicitly states client gating is cosmetic and the backend RBAC middleware independently 403s the data (`Dashboard.tsx:245-247`).
- [x] Role checks enforced at backend — confirmed cosmetic-only intent in both `RoleGuard.tsx:15-16` and `Dashboard.tsx:245-247`; backend `demoProtection.ts` + RBAC middleware are the boundary.

### 10. Demo Mode
- [x] Demo button only when `VITE_DEMO_MODE=true` — `App.tsx:281` passes `onDemoLogin` only if the flag is set; `LoginPage.tsx:357-366` renders the button only when `onDemoLogin` is defined.
- [x] Demo login is a real backend call — `authApi.demoLogin()` → `POST /auth/demo` (`auth.ts:78-84`); backend `demoLogin` returns a real restricted session and is disabled in prod (`backend/src/controllers/authController.ts:659-690`, hard 400 when `!config.demo.enabled`).
- [x] Demo account cannot access sensitive features (server-enforced) — `demoProtection.ts` blocks role change (`:43-60,122-126`), cross-user modification (`:85-105,129-134`), admin (`:67-78`), AI (`:164-175`), profile mutation (`:145-156`); fails closed when `DEMO_EMAIL` empty (`:33-36`).
- [x] Demo mode indicated in UI — "Demo Mode" badge in `DashboardHeader.tsx:90-97` (see F-1 for the build-flag caveat).

### 11. Lazy Loading Security
- [x] Pages lazy-loaded via `React.lazy` + `Suspense` — `App.tsx:37-43` (`lazy(...)`), wrapped in `<Suspense fallback={<LoadingFallback/>}>` at every render site (`:132,150,168,256,269,278,293`).
- [x] Auth check happens before lazy component renders — `isLoading` spinner (`App.tsx:186-198`) precedes the auth-conditional render; Dashboard's `Suspense` is inside the `isAuthenticated` branch.
- [x] No flash of protected content during loading — `LoadingFallback` is a full-screen overlay (`App.tsx:46-58`); Dashboard chunk only loads after auth resolves.
- [x] Error boundary catches loading failures — `<ErrorBoundary>` wraps the tree (`App.tsx:301-317`); chunk preload errors also handled with a one-shot reload (`main.tsx:7-15`).

### 12. PHI Data Lifecycle
- [x] PHI fetched on-demand, not pre-loaded — `AuthContext` stores only `{id,email,role}` (`AuthContext.tsx:74-78`); biomarker/insurance data loads via `useBiomarkerData` in Dashboard (`Dashboard.tsx:118-126`).
- [x] No PHI in localStorage/sessionStorage — confirmed under check 1; only theme + chunk-reload timestamp persist.
- [x] Idle/force-logout discards in-memory PHI via hard reload — `idleNavigation.redirectToSessionExpired` (`AuthContext.tsx:64-68`), used by the idle timer (`:281-283`) and warning dialog (`:396-398`).
- [x] Sensitive fields redacted in logger — `sanitizeData` → `[REDACTED]` (`logger.ts:32-57`); `authLogger`/`apiLogger` defined at `:105-106` (see F-3 for the exact-match limitation).
- [x] Auth-flow diagnostics go through `authLogger.debug` (prod-gated + sanitized), not raw `console.log` — `AuthContext.tsx:158,161,170`; production gate at `logger.ts:64-70`.

### 13. Email-Change Flow
- [x] Request via `ChangeEmailModal` → `authApi.requestEmailChange(newEmail, currentPassword)` (`POST /auth/change-email`) with re-auth — `ChangeEmailModal.tsx:65`; API at `auth.ts:107-113`.
- [x] Change NOT applied on request; confirmation link emailed to new address — modal shows "Confirmation sent" with the link-expiry/old-address-stays-active notice (`ChangeEmailModal.tsx:100-118`); documented at `auth.ts:101-106`.
- [x] `/confirm-email-change?token=...` renders `ConfirmEmailChangePage` → `authApi.confirmEmailChange` (`GET /auth/confirm-email-change`) — route parse `App.tsx:85-87,166-182`; API `auth.ts:119-124` (token URL-encoded).
- [x] On confirm, sessions revoked server-side → user routed to login — UI redirects via `onSuccess` after 2s (`ConfirmEmailChangePage.tsx:58-59`); documented backend session-revoke at `auth.ts:115-118`.
- [x] Confirmation token single-use; UI guards double-submit — `confirmedRef` run-once guard (`ConfirmEmailChangePage.tsx:41-68`).
- [x] New email + current password cleared on close — `resetForm` invoked by `handleClose` (`ChangeEmailModal.tsx:32-42`).

### 14. Inactivity Auto-Logoff (HIPAA §164.312(a)(2)(iii))
- [x] Idle timers armed only while authenticated; warning at 13 min, logout at 15 min — watchdog effect early-returns and clears timers when `!user` (`AuthContext.tsx:290-296`); constants `INACTIVITY_TIMEOUT_MS = 15min`, `INACTIVITY_WARNING_MS = 13min` (`:40-41`), wired in `resetIdleTimers` (`:276-284`).
- [x] Activity events reset timers (`mousedown`, `keydown`, `touchstart`, `scroll`; mousemove excluded) — `ACTIVITY_EVENTS` (`AuthContext.tsx:42`), listeners attached `:332-334`, `mousemove` deliberately absent (documented `:287-289`).
- [x] Timeout force-reloads to `/?sessionExpired=true` (discards PHI in all tabs) — `forceLogoutAndRedirect` → `idleNavigation.redirectToSessionExpired` (`AuthContext.tsx:245-271,281-283`); cross-tab `logged-out` broadcast makes siblings follow (`:261-269,310-314`).
- [x] Warning dialog offers "Stay signed in" (resets timers) and "Sign out now" — `AuthContext.tsx:393-411` (`resetIdleTimers` on stay, `forceLogoutAndRedirect` on sign-out).

## Unverifiable
- None. Every file named in the prompt was located and read; every checklist item resolved to a concrete `file:line`. Backend behaviors referenced by frontend items (CSRF cookie name, `/auth/refresh` CSRF non-exemption, demo session revocation, demo server-side blocks) were cross-checked in `backend/src/middleware/csrf.ts`, `backend/src/middleware/demoProtection.ts`, and `backend/src/controllers/authController.ts`.

## Out of scope
- **Backend session/token revocation correctness** (refresh-reuse family revoke, `tokens_valid_after`, `revoked_access_tokens`) — covered by the backend auth/session prompts; this review only confirms the frontend calls the relevant endpoints (`/auth/logout`, `/auth/logout-all`, `/auth/refresh`).
- **`ThemeContext.tsx`** — named in the prompt as "no security data"; verified it stores only the theme string in `localStorage` (`ThemeContext.tsx:32,43,88`), no auth/PHI. Not treated as a finding.
- **Edge security headers (X-Frame-Options / CSP frame-ancestors)** — the GCS-served SPA cannot emit them; `frameGuard.ts` provides a JS frame-bust backstop at bootstrap (`main.tsx:20-26`, `src/utils/frameGuard.ts:45-62`). Tracked under teardown M16/L14 (infra), out of scope for frontend-auth.
- **Plan-gating / AI / FHIR endpoint authorization** — they share the same `client.ts` auth path (verified) but their server-side authorization logic belongs to prompts 11–13 / 27.
