# 10-frontend-auth Review — 2026-06-01

Scope: frontend authentication surface named by `prompts/10-frontend-auth.md` — `AuthContext.tsx`, `client.ts`, `auth.ts`, the `auth/` page components, `useRBAC`, `RoleGuard`, `logger.ts`, and `App.tsx`. Backend files (`csrf.ts`, `demoProtection.ts`) were read only to verify the cross-layer claims the spec asks about (CSRF cookie name, server-side demo enforcement, backend role checks). Per protocol, no code was modified.

Headline: token storage, CSRF wiring, idle auto-logoff, URL-token cleanup, one-time-token guards, and the email-change flow are implemented as the spec describes and hold up against the code. The notable gaps are (a) the `RoleGuard`/`useRBAC` capability layer is dead code — the spec presents it as the live UI gating mechanism, but the real gating is an inline category filter in `Dashboard.tsx`; and (b) a real demo session has no UI indicator. Neither is a direct PHI-disclosure path because the backend independently authorizes every request.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 5 |
| Info | 2 |

## Findings

### F-1 — `RoleGuard` and `useRBAC` capability flags are dead code; spec presents them as the live gating mechanism — **Low** (Prompt drift)
- **Location:** `src/components/common/RoleGuard.tsx:44`, `src/hooks/useRBAC.ts:24`, gating actually lives at `src/components/dashboard/Dashboard.tsx:135`
- **Observation:** The spec (checklist §9) states "`RoleGuard` component wraps protected UI sections." A repo-wide search for JSX usage of `<RoleGuard>`, `<AdminOnly>`, `<ProviderOnly>`, `<ProviderOrAdmin>`, `<PatientOnly>`, `<RoleBadge>` returns hits only inside `RoleGuard.tsx` itself (its own internal composition and the doc-comment examples) and the barrel re-exports. No application screen consumes them. Likewise `useRBAC`'s capability flags (`canViewPatients`, `canManageUsers`, `canViewAuditLogs`, `canAccessAdminPanel`) are computed but never read outside the hook's own definition. The actual provider/admin UI gating is an inline role check in `Dashboard.tsx`.
- **Impact:** No direct security impact — the backend 403s independently and `Dashboard.tsx` does gate the nav/pages. The risk is drift/maintenance: a reviewer trusting the spec would believe a central guard is enforcing UI access when it is not, and a future developer may wire a new admin screen expecting `RoleGuard` to be the established pattern while the rest of the app uses a different one.
- **Fix:** Either adopt `RoleGuard` for the provider/admin pages in `Dashboard.tsx:renderSpecialPage` (replacing the bespoke check at line 225) or delete the unused `RoleGuard`/capability-flag code and update the spec §9 to describe the `categories[].roles` filter as the real mechanism.
- **Evidence:**
  ```tsx
  // Dashboard.tsx:135 — the gating that actually runs
  const visibleCategories = categories.filter((c) => !c.roles || c.roles.includes(role));
  ```
  ```tsx
  // RoleGuard.tsx:44 — defined, exported, never mounted in any screen
  export function RoleGuard({ roles, minRole, fallback = null, children }: RoleGuardProps) {
  ```

### F-2 — A real demo session has no UI indicator; "Demo Mode" badge only shows when logged out — **Low**
- **Location:** `src/components/dashboard/DashboardHeader.tsx:139` (the `: (...)` else-branch)
- **Observation:** Spec checklist §10 requires "Demo mode clearly indicated in UI." `authApi.demoLogin()` returns a *real* (restricted) backend session, so `user` is non-null after a demo login and the header renders the normal user menu with the demo account's email. The literal "Demo Mode" string only renders in the `user == null` branch — i.e. when there is no session at all (the sample-data `Dashboard isDemoMode` path), not when a user is actually signed in as the demo account.
- **Impact:** Low. A user signed into the demo account sees an interface indistinguishable from a real account; they could mistakenly enter real PHI believing it is private. No disclosure to a third party.
- **Fix:** Derive a demo flag from the authenticated session (e.g. compare `user.email` to a build-time demo email, or have `/auth/me` return an `isDemo` boolean) and render a persistent banner/badge in `DashboardHeader` when true.
- **Evidence:**
  ```tsx
  ) : (
    <div className="text-sm text-slate-500 dark:text-slate-400">
      Demo Mode
    </div>
  )}
  ```

### F-3 — CSRF cookie regex is unanchored and can match a same-suffix cookie name — **Low**
- **Location:** `src/services/api/client.ts:122`
- **Observation:** `getCsrfToken()` reads the cookie with `cookies.match(/csrf[_-]?token=([^;]+)/i)`. The backend cookie is named `csrf_token` (`backend/src/middleware/csrf.ts:17`), so the happy path works. But the pattern is not anchored to a cookie-name boundary: if any other cookie whose name *ends in* `csrftoken`/`csrf_token`/`csrf-token` were present (e.g. an injected/legacy `xcsrf_token=...`), `String.match` returns the first occurrence, which could be the attacker-influenced one, sending the wrong value in `x-csrf-token`.
- **Impact:** Low and contingent — requires another cookie with a colliding suffix to exist on the same domain. The double-submit check is server-side constant-time compare, so a wrong header just yields a clean 403, not a bypass. Worst realistic case is a self-inflicted denial of mutating requests.
- **Fix:** Anchor to a cookie boundary, e.g. match `(?:^|;\s*)csrf[_-]?token=([^;]+)` (case-insensitive), or split `document.cookie` on `; ` and compare names exactly.
- **Evidence:**
  ```ts
  const match = cookies.match(/csrf[_-]?token=([^;]+)/i);
  const token = match ? decodeURIComponent(match[1]) : '';
  ```

### F-4 — `/auth/logout-all` is not in the 401-refresh / 429-retry exempt list — **Low**
- **Location:** `src/services/api/client.ts:248`; caller `src/services/api/auth.ts:65`
- **Observation:** The auth-management exemption is hard-coded to exactly two endpoints: `endpoint === '/auth/refresh' || endpoint === '/auth/logout'`. `logoutAll()` posts to `/auth/logout-all`, which is not exempt. If that call returns 401 (e.g. access token already expired), `apiFetch` will trigger `attemptTokenRefresh()` and, on success, retry the logout-all — and on refresh failure invoke `onAuthFailureCallback` (which itself calls `logout()`). The spec (checklist §4) describes `logout-all` as a first-class session-revocation call and §5 expects auth-management endpoints to be exempt from the retry loops.
- **Impact:** Low. `logoutAll()` clears the in-memory token in its `finally` regardless of outcome, so the local session is still dropped. The downside is an avoidable extra round-trip / re-entrant `logout()` rather than the clean terminal behavior `/auth/logout` gets.
- **Fix:** Add `'/auth/logout-all'` to the `isAuthMgmtEndpoint` predicate at `client.ts:248`.
- **Evidence:**
  ```ts
  const isAuthMgmtEndpoint = endpoint === '/auth/refresh' || endpoint === '/auth/logout';
  ```

### F-5 — One-shot 401-refresh retry drops the `retryCount429` counter on the main error branch — **Low**
- **Location:** `src/services/api/client.ts:306` (compare to the JSON-parse-fail branch at `client.ts:287`)
- **Observation:** Both the JSON-parse-failure path and the main `!response.ok` path retry once after a successful token refresh. The parse-fail path forwards the accumulated 429 counter — `apiFetch<T>(endpoint, options, timeoutMs, true, retryCount429)` (line 287) — but the main path calls `apiFetch<T>(endpoint, options, timeoutMs, true)` (line 306), resetting `retryCount429` to its default `0`. After a 401→refresh→retry, the retried request carries `isRetry = true`, which already excludes it from the 429-retry branch, so the lost counter has no live effect today. It is an inconsistency that becomes a latent bug if the `isRetry` guard on the 429 branch is ever relaxed.
- **Impact:** Low / latent. No current 429-amplification because `isRetry` gates the retry branch; flagged for consistency and defense against future edits.
- **Fix:** Pass `retryCount429` on line 306 to match line 287: `return apiFetch<T>(endpoint, options, timeoutMs, true, retryCount429);`.
- **Evidence:**
  ```ts
  // client.ts:306 — main branch, counter defaults back to 0
  return apiFetch<T>(endpoint, options, timeoutMs, true);
  // client.ts:287 — parse-fail branch, counter preserved
  return apiFetch<T>(endpoint, options, timeoutMs, true, retryCount429);
  ```

### F-6 — `getUserFriendlyMessage` returns the raw server message verbatim for all 4xx — **Info**
- **Location:** `src/services/api/client.ts:86`
- **Observation:** For any 4xx with a `serverMessage`, the helper returns that string unmodified to the UI. This is the intended design (it surfaces backend Zod/validation/plan-limit reasons), and the spec's §5 "error messages don't leak sensitive info" is satisfied *on the assumption* that the backend never puts internal detail (stack frames, SQL, file paths) into 4xx `error` strings. The frontend has no allow-list/scrubbing of its own, so it inherits whatever the backend chooses to emit.
- **Impact:** None observed in the reviewed frontend code. Noting the trust boundary: the leak-prevention guarantee lives entirely on the backend error handler, not here.
- **Fix:** None required for this prompt; covered by the backend error-handling review. If desired, cap/scrub server messages for 5xx (already done — 5xx uses generic `SERVER_ERROR`) and consider the same posture for unexpected 4xx codes.
- **Evidence:**
  ```ts
  if (serverMessage && status >= 400 && status < 500) {
    return serverMessage;
  }
  ```

### F-7 — Login `error` state persists across auth-view switches only via explicit `clearError()` — **Info**
- **Location:** `src/contexts/AuthContext.tsx:140`, `src/App.tsx:237`
- **Observation:** `login()` clears `error` on entry (`setError(null)`, AuthContext:140) and App's view-switch handlers call `clearError()` (App.tsx:237-250), so a failed-login message does not bleed into Register/Forgot views. This is correct behavior, noted because checklist §4 ("Login clears any stale state") is satisfied by convention rather than a single guard — worth keeping in mind if a new auth view is added without the `clearError()` call.
- **Impact:** None. Informational.
- **Fix:** None.
- **Evidence:**
  ```ts
  // AuthContext.tsx:140
  setError(null);
  ```

## Checks passed

### 1. Token Storage (CRITICAL)
- [x] NO tokens in localStorage — only `omh-theme` is persisted (`src/contexts/ThemeContext.tsx:20,32`); repo-wide search shows no auth token in localStorage.
- [x] NO tokens in sessionStorage — only a chunk-reload guard `chunk-reload` (`src/main.tsx:8-11`); no token.
- [x] Access token stored in memory only — module-scoped `let authToken` with `set/get/clear` (`src/services/api/client.ts:65,70,74,78`).
- [x] Auth state cleared on logout — `logout()` calls `setUser(null)` + `clearAuthToken()` (`src/contexts/AuthContext.tsx:183-184`).
- [x] Idle auto-logoff force-reloads to discard in-memory PHI — `window.location.href = '/?sessionExpired=true'` after `logout()` (`src/contexts/AuthContext.tsx:200-202`).

### 2. Auth Context Flow
- [x] On mount, `authApi.refreshToken()` is called FIRST (`src/contexts/AuthContext.tsx:105`).
- [x] `getCurrentUser()` called only after refresh succeeds (`src/contexts/AuthContext.tsx:119`).
- [x] Refresh failure short-circuits to `setUser(null)` and returns before `getCurrentUser` (`src/contexts/AuthContext.tsx:110-116`).
- [x] Reactive 401 refresh exists, single-flight guarded by `isRefreshing`/`refreshPromise` (`src/services/api/client.ts:137-141`).
- [x] `isLoading` guards the initial session-restore render (`src/App.tsx:186`; set false in the mount effect `finally`, `AuthContext.tsx:125-127`).
- [x] `setOnAuthFailure` wires client 401-after-refresh failure to `logout()` (`src/contexts/AuthContext.tsx:239-244`; invoked at `client.ts:289,308`).

### 3. Protected Routes
- [x] Unauthenticated users render `LoginPage`, never the dashboard (`src/App.tsx:253-289`).
- [x] Auth check runs before render — `isLoading` spinner blocks until session restore resolves (`src/App.tsx:186-198`).
- [x] No flash of protected content — dashboard is only reachable in the `isAuthenticated` branch after the loading gate (`src/App.tsx:292-296`).

### 4. Login/Logout Flow
- [x] Login clears stale `error` before submit (`src/contexts/AuthContext.tsx:140`; App `clearError()` at `App.tsx:202`).
- [x] Login does NOT flip global `isLoading` — uses local `isAuthLoading` instead (comment + impl `src/contexts/AuthContext.tsx:133-150`; `src/App.tsx:203-208`).
- [x] Logout clears all auth state (`src/contexts/AuthContext.tsx:183-184`).
- [x] Logout calls backend to invalidate tokens — `POST /auth/logout` (`src/services/api/auth.ts:51-57`).
- [x] `logoutAll()` posts `/auth/logout-all` and clears local token in `finally` regardless (`src/services/api/auth.ts:65-71`).
- [x] Redirect to login after logout — `setUser(null)` flips `isAuthenticated`, App re-renders `LoginPage` (`src/App.tsx:248,253`).

### 5. Error Handling
- [x] 401 triggers one refresh attempt then `onAuthFailureCallback` (`src/services/api/client.ts:303-310`).
- [x] `/auth/refresh` and `/auth/logout` exempt from the 401/429 loops (`src/services/api/client.ts:248`). (See F-4 re: `/auth/logout-all`.)
- [x] 429 backs off via Retry-After or exponential + jitter up to `MAX_RETRY_429` (`src/services/api/client.ts:185,267-277`).
- [x] Network errors mapped to `NETWORK_ERROR`, do not crash (`src/services/api/client.ts:362-366`).
- [x] Error messages sanitized by status for 5xx and unknown codes (`src/services/api/client.ts:86-112`). (Trust-boundary note in F-6.)
- [x] Failed login shows a generic/server message, not internals (`src/contexts/AuthContext.tsx:146`; LoginPage renders `displayError`, `LoginPage.tsx:249-253`).
- [x] `PLAN_LIMIT_EXCEEDED` 403s carry structured `planLimit` fields for an upgrade CTA (`src/services/api/client.ts:328-341`; `isPlanLimitError` helper `client.ts:55-62`).

### 6. Password Handling
- [x] Password inputs use `type={showPassword ? 'text' : 'password'}` (`LoginPage.tsx:309`, `RegisterPage.tsx:218`, `ResetPasswordPage.tsx:150`, `ChangeEmailModal.tsx:156`).
- [x] Password not logged — login error log is DEV-only and the logger redacts `password`/`token` (`LoginPage.tsx:79-81`; `src/utils/logger.ts:20-27,48`).
- [x] Password cleared from state after submit — LoginPage clears on failure (`LoginPage.tsx:75`), RegisterPage clears on success (`RegisterPage.tsx:101-102`).
- [x] No password in URL params — all credentials sent in POST JSON bodies (`src/services/api/auth.ts:29-37,94-98`).

### 7. CSRF Token Handling
- [x] Token read via `csrf[_-]?token` case-insensitive regex in `getCsrfToken()` (`src/services/api/client.ts:122`; backend cookie `csrf_token` at `backend/src/middleware/csrf.ts:17`). (Anchoring caveat in F-3.)
- [x] Token attached as `x-csrf-token` on POST/PUT/PATCH/DELETE (`src/services/api/client.ts:229-232`).
- [x] Token refreshed after login — backend re-sets the `csrf_token` cookie on subsequent GETs via `ensureCsrfToken` (`backend/src/middleware/csrf.ts:66-76`); client reads it fresh from `document.cookie` on each mutation (`client.ts:121`).
- [x] Missing-token warning is DEV-only and never logs the value (`src/services/api/client.ts:125-132,233-238`).

### 8. URL Token Cleanup
- [x] verify-email / reset-password / confirm-email-change tokens stripped from URL after read (`src/App.tsx:121-126`).
- [x] `replaceState({}, ..., window.location.pathname)` keeps the path, drops the query (`src/App.tsx:124`).
- [x] One-time tokens consumed exactly once — `confirmedRef`/`verifiedRef` run-once guards survive StrictMode + parent re-render (`ConfirmEmailChangePage.tsx:41-44`; `VerifyEmailPage.tsx:38-41`).

### 9. Role-Based UI Protection
- [x] `useRBAC` provides `isPatient/isProvider/isAdmin`, the capability flags, and `hasRole`/`hasMinRole` over the ADMIN 3 > PROVIDER 2 > PATIENT 1 hierarchy (`src/hooks/useRBAC.ts:13-68`).
- [x] Provider/admin views are hidden from patients and access is denied on deep-link — inline gate in `Dashboard.tsx` (`src/components/dashboard/Dashboard.tsx:135,225-244`).
- [x] Role checks enforced at backend (UI hiding is convenience) — backend `rbac.ts` + `demoProtection.ts` 403 independently; `Dashboard.tsx:223` comment confirms "The backend independently 403s the data." (`backend/src/middleware/demoProtection.ts:67-78`).
- (`RoleGuard` wrapping: see F-1 — exists but unused; gating is done elsewhere.)

### 10. Demo Mode
- [x] Demo button only rendered when `VITE_DEMO_MODE === 'true'` (`src/App.tsx:281`; `LoginPage.tsx:357`).
- [x] Demo login is a real backend call — `POST /auth/demo` via `authApi.demoLogin()` (`src/services/api/auth.ts:78-84`).
- [x] Demo account blocked from sensitive features server-side — `demoProtection`, `blockDemoAdminAccess`, `blockDemoAI`, `blockDemoProfileUpdate`, `blockDemoUserModification` (`backend/src/middleware/demoProtection.ts:43-177`); empty-`DEMO_EMAIL` guard prevents false matches (`demoProtection.ts:33-36`).
- (Demo indicated in UI: see F-2 — real demo session lacks an indicator.)

### 11. Lazy Loading Security
- [x] Pages lazy-loaded via `React.lazy` + `Suspense` (`src/App.tsx:37-43,132,256,278,293`).
- [x] Auth check precedes lazy-loaded dashboard — `isAuthenticated` branch + `isLoading` gate wrap the lazy `<Dashboard>` (`src/App.tsx:186,253,292`).
- [x] Error boundary catches loading/render failures — `<ErrorBoundary>` wraps the tree (`src/App.tsx:301`); chunk-preload errors recovered in `main.tsx:6-14`.

### 12. PHI Data Lifecycle
- [x] Only non-PHI identity (id, email, role) held in context; PHI fetched on demand (`src/contexts/AuthContext.tsx:48-52,8-13`).
- [x] No PHI in localStorage/sessionStorage (searches in §1 above).
- [x] Sensitive fields redacted in logger `sanitizeData` → `[REDACTED]` (`src/utils/logger.ts:20-57`).
- [x] Auth diagnostics go through `authLogger.debug` (prod-gated + sanitized), not raw `console.log` (`src/contexts/AuthContext.tsx:109,112,121`; gating `logger.ts:62-70`).

### 13. Email-Change Flow
- [x] Request via `ChangeEmailModal` → `requestEmailChange(newEmail, currentPassword)` (`POST /auth/change-email`), re-auths with current password (`src/components/settings/ChangeEmailModal.tsx:65`; `src/services/api/auth.ts:107-113`).
- [x] Change not applied on request — confirmation link emailed to new address; UI states "change only takes effect once you open it" (`ChangeEmailModal.tsx:128-131`; comment `auth.ts:101-106`).
- [x] `/confirm-email-change?token=` renders `ConfirmEmailChangePage` → `confirmEmailChange(token)` (GET) (`src/App.tsx:85-87,166-182`; `auth.ts:119-124`).
- [x] On confirm, backend revokes sessions and user is routed to login (`ConfirmEmailChangePage.tsx:55-59`; comment `auth.ts:115-118`).
- [x] Token single-use; double-submit guarded by `confirmedRef` (`ConfirmEmailChangePage.tsx:41-44`).
- [x] New email + current password cleared on modal close via `resetForm` (`ChangeEmailModal.tsx:32-42`).

### 14. Inactivity Auto-Logoff (HIPAA §164.312(a)(2)(iii))
- [x] Idle timers armed only while authenticated; warning at 13 min, logout at 15 min (`src/contexts/AuthContext.tsx:40-41,210-216`).
- [x] Activity events reset timers: `mousedown`, `keydown`, `touchstart`, `scroll` (mousemove excluded by design) (`src/contexts/AuthContext.tsx:42,206-209`).
- [x] Timeout force-reloads to `/?sessionExpired=true` to discard in-memory PHI across tabs (`src/contexts/AuthContext.tsx:197-203`).
- [x] Warning dialog offers "Stay signed in" (resets timers) and "Sign out now" (`src/contexts/AuthContext.tsx:280-298`).

## Unverifiable
- None. Every file named in the spec was located and read; cross-layer claims (CSRF cookie name, server-side demo enforcement, backend role 403s) were confirmed against the backend.

## Out of scope
- `src/contexts/ThemeContext.tsx` — spec explicitly notes "no security data." Confirmed it persists only the `omh-theme` preference (`ThemeContext.tsx:20`); not reviewed further.
- Backend auth/CSRF/demo internals beyond the specific claims this prompt asks to verify — owned by the backend-focused prompts (auth middleware, CSRF, RBAC, rate limiting). Only the assertions referenced by §7, §9, §10 were checked.
- `npm audit` / `npm outdated` / `git` — the spec's checklist does not call for dependency or history checks for this prompt; deferred to the dependency-review prompt.
- `src/components/provider/MyPatientsPage.tsx` consent-permission rendering (`permissions.canViewBiomarkers`, etc., lines 143-247) — touches provider data gating but is provider-feature scope, not core auth; the backend scopes the data by consent and is reviewed under the provider-access prompt.
