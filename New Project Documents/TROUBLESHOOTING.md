# TROUBLESHOOTING.md

_Generated 2026-04-24 — symptom-first catalog. Start here when you know what you observed but not where to look. Cross-link to [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) when you know the error `code`._

---

## 1. How to use this doc

Pick the symptom that matches what the user (or you) observed — network tab, UI behavior, deploy output, log line. Each entry gives:

- **Symptom** — the observable signal.
- **Root cause** — what actually produces that signal, with `file:line` citations.
- **Workaround** — unblock the user immediately.
- **Fix** — the durable change, with commit SHA when known.
- **Files** — code to look at.
- **Cross-link** — the matching error code in [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) when one exists.

This doc is the **symptom lens**. [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) is the **code-catalog lens** — every `code` value the backend emits, its throw sites, and recovery actions. Pair them: use this doc to get from "user said X" to a code; use `ERROR_RECOVERY.md` to go from a code to the canonical recovery.

| I know… | Start here |
|---|---|
| The user-visible behavior ("login loops", "upload 500") | **This doc** |
| The HTTP `code` value (`TOKEN_EXPIRED`, `PLAN_LIMIT_EXCEEDED`) | [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) |
| The operational playbook ("rotate JWT secret", "flip BAA flag") | [`RUNBOOK.md`](./RUNBOOK.md) |
| Currently-open bugs | [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) |

---

## 2. Symptom index

| # | Symptom | Section | Cross-link |
|---|---|---|---|
| S-1 | Login screen loops / stuck on login | [§4 Auth — Login loops](#s-1-login-screen-loops--stuck-on-login) | [`ERROR_RECOVERY.md#unauthorized-http-401`](./ERROR_RECOVERY.md) |
| S-2 | Data disappears after page refresh | [§4 Auth — Refresh wipe](#s-2-data-disappears-after-page-refresh) | [`ERROR_RECOVERY.md#unauthorized-http-401`](./ERROR_RECOVERY.md) |
| S-3 | Cross-domain cookies not set (prod) | [§4 Auth — Cookie domain](#s-3-cookies-never-arrive-in-prod-cross-subdomain-deploy) | — |
| S-4 | `INVALID_CREDENTIALS` with correct password | [§4 Auth — Password OK but 401](#s-4-password-is-correct-but-login-returns-401-invalid_credentials) | [`ERROR_RECOVERY.md#invalid_credentials-http-401`](./ERROR_RECOVERY.md) |
| S-5 | Session expires at random (idle logout) | [§4 Auth — Idle timeout](#s-5-session-expires-unexpectedly-idle-watchdog) | — |
| S-6 | `FORBIDDEN` / CSRF on mutations | [§5 CSRF](#s-6-all-post-put-patch-delete-return-403-forbidden) | [`ERROR_RECOVERY.md#forbidden-from-csrf-http-403`](./ERROR_RECOVERY.md) |
| S-7 | CSRF passes in dev, fails in prod | [§5 CSRF — Cookie scope](#s-7-csrf-passes-in-dev-fails-in-prod) | — |
| S-8 | File upload / AI guidance 403 CSRF | [§5 CSRF — Exempt routes](#s-8-file-upload-or-ai-guidance-returns-403-forbidden-csrf-token-missing) | — |
| S-9 | Pool exhaustion ("all connections busy") | [§6 Database — Pool exhaust](#s-9-queries-hang-then-fail-with-connection-timeout-or-all-connections-busy) | [`ERROR_RECOVERY.md#database_error-http-500`](./ERROR_RECOVERY.md) |
| S-10 | Migration fails with `CONCURRENTLY` | [§6 Database — Migration](#s-10-prisma-migrate-deploy-fails-on-create-index-concurrently) | — |
| S-11 | Query returns fewer rows than expected (RLS mystery) | [§6 Database — RLS mystery](#s-11-query-returns-fewer-rows-than-expected-rls-mystery) | [`ERROR_RECOVERY.md#not_found-as-rls-denial`](./ERROR_RECOVERY.md) |
| S-12 | Query silently returns ALL users' rows | [§6 Database — RLS bypass](#s-12-query-silently-returns-all-users-rows-rls-bypass) | — |
| S-13 | Cloud Run env update applied but behavior unchanged | [§7 Deployment — Pinned traffic](#s-13-gcloud-run-services-update---update-env-vars-applied-but-prod-behavior-unchanged) | — |
| S-14 | GitHub Actions deploy workflow fails | [§7 Deployment — Workflow](#s-14-github-actions-deploy-workflow-fails) | — |
| S-15 | Docker build fails on Prisma generate | [§7 Deployment — Docker](#s-15-docker-build-fails-during-prisma-generate) | — |
| S-16 | Frontend blank page after deploy | [§8 Frontend — Blank page](#s-16-frontend-loads-blank-page-no-errors-visible) | — |
| S-17 | Charts throw `forwardRef` error | [§8 Frontend — forwardRef](#s-17-dashboard-charts-crash-cannot-read-properties-of-undefined-reading-forwardref) | — |
| S-18 | CORS error in browser console | [§8 Frontend — CORS](#s-18-browser-console-blocked-by-cors-policy) | — |
| S-19 | `crypto.randomUUID is not a function` | [§8 Frontend — HTTP context](#s-19-crypto-randomuuid-is-not-a-function-on-older-browsers--http-contexts) | — |
| S-20 | Vite/SWC fails on Windows ARM64 (dev) | [§8 Frontend — SWC ARM64](#s-20-vite-dev-server-fails-on-windows-arm64--node-24) | — |
| S-21 | API returns 500 with generic message | [§9 API 500](#s-21-api-returns-500-with-generic-message) | [`ERROR_RECOVERY.md#internal_error-http-500`](./ERROR_RECOVERY.md) |
| S-22 | Server fails to start (FATAL in logs) | [§9 API — Startup](#s-22-server-fails-to-start--fatal-log-lines-before-first-request) | — |
| S-23 | Upload returns 500 / extraction empty | [§10 PDF/OCR/Claude](#s-23-lab-upload-returns-500-or-completes-but-no-biomarkers-extracted) | [`ERROR_RECOVERY.md#validation_error-http-422`](./ERROR_RECOVERY.md) |
| S-24 | AI endpoints return 503 | [§10 PDF/OCR/Claude — BAA gate](#s-24-ai-endpoints-return-503-service_unavailable) | [`ERROR_RECOVERY.md#service_unavailable-http-503--baa-gate`](./ERROR_RECOVERY.md) |
| S-25 | Claude API returns 400 max_tokens | [§10 PDF/OCR/Claude — max_tokens](#s-25-claude-api-returns-400-invalid_request_error-max_tokens) | — |
| S-26 | SBC/lab PDF.js breaks on insurance page | [§10 PDF/OCR/Claude — PDF.js](#s-26-insurance-sbc-upload-breaks-with-pdf-js-worker-error) | — |

---

## 3. Decision trees

### 3.1 "I'm stuck on login" / 401 loop

```
User reports "stuck on login" or "keeps bouncing me back to login"
          │
          ▼
Open DevTools → Network tab. Reproduce. What does POST /auth/login return?
   ├── 429 AUTH/LOGIN_RATE_LIMIT_EXCEEDED
   │     └─▶ Wait 15 min OR reset keyed email+IP. See §4 S-1.
   ├── 401 INVALID_CREDENTIALS
   │     ├─▶ remainingAttempts > 0 → wrong password. S-4.
   │     └─▶ 423 ACCOUNT_LOCKED next → user hit lockout. See ERROR_RECOVERY.md §5.
   ├── 403 EMAIL_NOT_VERIFIED
   │     └─▶ POST /auth/resend-verification, click email link.
   ├── 200 but user bounces back to /login within seconds
   │     └─▶ S-2 "Data disappears after refresh" — AuthContext ordering
   │         (commit 195ccc1). Check: does the network tab show
   │         /auth/me returning 401 BEFORE /auth/refresh fires?
   ├── 403 FORBIDDEN on first mutation after login
   │     └─▶ S-6 CSRF cookie/header mismatch. Hit /csrf-token.
   └── Network error / pending forever
         └─▶ S-18 CORS or S-3 cross-domain cookie issue.
              Check Response headers for Access-Control-Allow-Origin
              and Set-Cookie domain attributes.
```

### 3.2 "Data disappears on refresh"

```
User logs in, sees dashboard with biomarkers, refreshes page, dashboard is empty
          │
          ▼
Network tab on refresh. Order of auth calls?
   ├── /auth/me BEFORE /auth/refresh → BUG: AuthContext ordering.
   │     Fix: commit 195ccc1 — refreshToken() must run before getCurrentUser().
   │     Confirm src/contexts/AuthContext.tsx:L96-L119 order still holds.
   ├── /auth/refresh fires, returns 401
   │     └─▶ Refresh token expired OR JWT_REFRESH_SECRET rotated.
   │         Playbook: RUNBOOK.md "JWT secret rotated".
   ├── /auth/refresh returns 200, /auth/me returns 200, but UI still empty
   │     └─▶ Frontend store bug — data fetch didn't re-fire on user change.
   │         Not an auth problem; inspect TanStack Query/SWR keys.
   └── /auth/refresh 200, /auth/me 200, data endpoint returns []
         └─▶ S-11 RLS mystery — wrong `app.current_user_id` context.
```

### 3.3 "Upload returns 500 / extraction empty"

```
User uploads lab report or SBC, gets 500 or 200-with-0-biomarkers
          │
          ▼
What does /upload/* return?
   ├── 500 with "An unexpected error occurred..."
   │     ├─▶ Cloud Run logs: search for "claudeExtraction" or "ocrService".
   │     ├─▶ Common: ANTHROPIC_API_KEY missing → service fails to init.
   │     │    Fix: commit e7ae477 (graceful) + 769685c (dynamic import).
   │     └─▶ Common: max_tokens over limit. Fix: commit e029127.
   ├── 422 VALIDATION_ERROR
   │     ├─▶ Magic bytes don't match MIME → controllers/upload/shared.ts:89
   │     ├─▶ File too large → controllers/upload/shared.ts:113
   │     └─▶ "Could not extract any biomarkers from the PDF..."
   │          → PDF is scanned (no text layer). Retry via OCR endpoint.
   ├── 200 with success: true, data.biomarkers: []
   │     ├─▶ Scanned PDF → should have gone to /upload/lab-results-ocr
   │     ├─▶ Quest format whitespace variation. Fix: commits a59c547, e79e1e2.
   │     └─▶ Multi-line table. Fix: commits f62796f, 2cbf6e4, 56fd294.
   └── 504 with {error: '...'}
         └─▶ Claude read timeout. S-24 if also ANTHROPIC_BAA_ACTIVE issue,
              else retry / wait — upstream hiccup.
```

### 3.4 "RLS mystery — query returns fewer rows than expected"

```
Query through withRLSContext returns 0 (or fewer) rows, but you KNOW the row exists
          │
          ▼
Is the failing call inside `withRLSContext(userId, async (tx) => ...)`?
   ├── No — it uses module-level `prisma.*` → rows may be visible, but
   │         other queries in the same handler silently leak.
   │         This is S-12, the bypass — different failure mode. Investigate.
   ├── Yes, but the callback uses `prisma.biomarker.findMany()` not `tx.biomarker.findMany()`
   │         → Classic footgun per database.ts:L15-L31.
   │         Fix: change `prisma.*` to `tx.*` inside every RLS callback.
   │         CI guard: scripts/check-rls-wrappers.sh (see database.ts:L26).
   └── Yes, uses `tx.*` correctly, still returns nothing
         ├─▶ Is userId actually what you expect? Log `req.user.id`.
         ├─▶ Is the row's user_id actually that value? Query with
         │    withRLSContext(null, ...) (admin context) and compare user_id.
         │    See ERROR_RECOVERY.md §5 "NOT_FOUND as RLS denial".
         └─▶ Did a session cleanup (authService scheduler) just run?
              Revoked sessions don't affect RLS directly, but a stale
              client-side userId would.
```

---

## 4. Auth symptoms

### S-1. Login screen loops / stuck on login

**Symptom**: user submits correct credentials; page flashes dashboard for a frame, then bounces back to `/login`. Or network shows `/auth/login` returning 200 followed immediately by `/auth/me` returning 401 and logout.

**Root cause**: one of:
1. Pre-commit `195ccc1`: `AuthContext` called `getCurrentUser()` before `refreshToken()`. The 15-min access cookie was expired, `/auth/me` returned 401, the `onAuthFailureCallback` fired logout before the refresh completed.
2. `client.ts:L204` did not exempt `/auth/refresh` and `/auth/logout` from the 401-retry path, so `refresh` returning 401 triggered another `attemptTokenRefresh()` recursively, flooding the server and preventing login from settling (documented in `client.ts:L198-L204`).

**Workaround**: hard refresh twice. Second mount has the access cookie from the first refresh.

**Fix**: commit `195ccc1` (2026-01-10 "Fix auth token restoration order on page refresh") and companion `0889ff6`. Frontend now awaits `refreshToken()` **before** `getCurrentUser()`. Also: `client.ts:L198-L204` explicitly flags `/auth/refresh` and `/auth/logout` as `isAuthMgmtEndpoint` so their 401s short-circuit rather than recurse.

**Files**:
- `src/contexts/AuthContext.tsx:L93-L128` (restore order — current impl).
- `src/services/api/client.ts:L198-L250` (401 retry gate).

**Cross-link**: [`ERROR_RECOVERY.md` §5 Auth family](./ERROR_RECOVERY.md).

---

### S-2. Data disappears after page refresh

**Symptom**: user is logged in, sees their dashboard with biomarkers, refreshes the page (F5). Dashboard re-renders empty. Network tab shows a 401 on `/auth/me`, followed by the UI routing to `/login` (or the data fetch simply returning `[]`).

**Root cause**: same AuthContext ordering bug as S-1. Access token cookie has 15-minute TTL; the refresh cookie has 7-day TTL. If `getCurrentUser()` fires before `refreshToken()` and the 15-min access token has expired, the 401 triggers logout.

**Workaround**: hard refresh twice. Alternatively, log out and log back in (forces a fresh access cookie).

**Fix**: commit `195ccc1`. Current code at `src/contexts/AuthContext.tsx:L93-L128`:

```tsx
// Source: src/contexts/AuthContext.tsx:L93-L119
useEffect(() => {
  const checkAuth = async () => {
    try {
      // CRITICAL FIX: Call refreshToken FIRST to get a fresh access token.
      try {
        await authApi.refreshToken();
        authLogger.debug('Access token refreshed from refresh token');
      } catch {
        authLogger.debug('Refresh token invalid, user not authenticated');
        setUser(null);
        setIsLoading(false);
        return;
      }
      // Now get current user with the fresh access token
      const currentUser = await authApi.getCurrentUser();
      setUser(currentUser);
```

**Files**: `src/contexts/AuthContext.tsx:L93-L128`.

**Cross-link**: [`ERROR_RECOVERY.md` §7 Playbook A — User stuck with 401 loop](./ERROR_RECOVERY.md).

---

### S-3. Cookies never arrive in prod (cross-subdomain deploy)

**Symptom**: login works locally; in production the `access_token`, `refresh_token`, and `csrf_token` cookies never appear in DevTools → Application → Cookies. Every request after login is unauthenticated.

**Root cause**: backend runs on `api.ownmyhealth.app`, frontend on `www.ownmyhealth.app`. Cookies set without an explicit `domain` attribute scope only to the exact host. Frontend on `www.` never sees cookies set by `api.`.

**Workaround**: none — ship the fix.

**Fix**: commits (2026-01-08):
- `50d7426` "fix: add domain to all auth cookies for cross-domain support" — access, refresh cookies.
- `8db4317` "fix: support cross-domain cookies for CSRF protection" — CSRF cookie.
- `327b2f4` "fix: CORS configuration for cross-domain cookies" — `Access-Control-Allow-Credentials`, `Access-Control-Allow-Origin` with explicit origin (not `*`).
- `ad2dff9` "fix: ensure CORS preflight requests are handled properly".

**Files**:
- Cookie domain: `backend/src/controllers/authController.ts` (set-cookie calls) — confirm `domain: '.ownmyhealth.app'` leading dot.
- CORS: `backend/src/server.ts` / `backend/src/app.ts` CORS middleware registration.
- CSRF cookie: `backend/src/middleware/csrf.ts:L43` documents `httpOnly: false` by design.

**Cross-link**: [§5 CSRF symptoms](#5-csrf-symptoms), [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

### S-4. Password is correct but login returns 401 `INVALID_CREDENTIALS`

**Symptom**: user enters a password they just reset; gets 401 `INVALID_CREDENTIALS`.

**Root cause**: one of:
1. User pasted password with trailing whitespace (mobile keyboards).
2. Password manager autofilled old value before reset applied (cache lag).
3. Decryption layer bug — rare. `authController.ts:279` emits `INVALID_CREDENTIALS` whenever `attemptLogin` fails, for **any** reason other than lockout / unverified email.

**Workaround**: trim whitespace; paste-then-type to force a fresh autofill; if persistent, request another password reset.

**Fix**: not a code bug in normal cases. If persistent across users after a deploy, check:
- `b9dc4e4` (2025-12-15) "add authTagLength to createDecipheriv calls for Node.js compatibility" — Node version bump can break AES-GCM decryption if authTagLength is missing. This breaks the decryption path used during login (per-user key derivation via PBKDF2-SHA512, then decrypt to compare password hash).

**Files**: `backend/src/controllers/authController.ts:L270-L287`, `backend/src/services/authService.ts` (`attemptLogin`), `backend/src/services/userEncryption.ts`.

**Cross-link**: [`ERROR_RECOVERY.md` §5 `INVALID_CREDENTIALS`](./ERROR_RECOVERY.md).

---

### S-5. Session expires unexpectedly (idle watchdog)

**Symptom**: user steps away for 15 minutes, returns to find they've been logged out with URL `/?sessionExpired=true`.

**Root cause**: **by design**. HIPAA §164.312(a)(2)(iii) auto-logoff. `src/contexts/AuthContext.tsx:L40-L42` sets `INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000` with a warning dialog at 13 minutes. Activity events monitored: `mousedown`, `keydown`, `touchstart`, `scroll` (per `ACTIVITY_EVENTS` at L42). **Mouse-move is intentionally excluded** (`AuthContext.tsx:L205-L206`) so a wandering cursor on a secondary monitor cannot keep the session alive.

**Workaround**: the "Stay signed in" button in the warning dialog resets both timers (`AuthContext.tsx:L189-L201`). User education: interact with the page during long reads.

**Fix**: not a bug. If policy changes, edit `INACTIVITY_TIMEOUT_MS` / `INACTIVITY_WARNING_MS` at `AuthContext.tsx:L40-L41`.

**Files**: `src/contexts/AuthContext.tsx:L40-L228`.

---

## 5. CSRF symptoms

### S-6. All POST / PUT / PATCH / DELETE return 403 `FORBIDDEN`

**Symptom**: reads work (GETs succeed), but every mutation returns 403 with `code: FORBIDDEN` and message `"CSRF token missing"` or `"Invalid CSRF token"`.

**Root cause**: one of three paths in `backend/src/middleware/csrf.ts:L155-L176`:
1. `!cookieToken || !headerToken` → client never sent the `x-csrf-token` header, or the `csrf_token` cookie is absent.
2. `cookieToken.length !== headerToken.length` → mismatch before `timingSafeEqual`.
3. `timingSafeEqual` false → tokens differ.

Frontend normally handles this automatically via `client.ts:L120-L134` (cookie regex) and `client.ts:L187-L195` (header attach on mutations). If the cookie regex is failing, the warning `"No CSRF token found in cookies"` appears in dev console.

**Workaround**: hit `GET /api/v1/csrf-token` (`csrf.ts:L210-L219`) to set a fresh cookie, then retry.

**Fix**:
- Cookie regex tightening: commit `b721788` (2026-01-08) "fix: improve CSRF token cookie matching regex" — current regex `client.ts:L122` `/csrf[_-]?token=([^;]+)/i` tolerates `csrf_token` and `csrf-token` variants.
- Cross-domain cookie scope: commit `8db4317` (see S-3).

**Files**:
- `backend/src/middleware/csrf.ts:L155-L176` (validation).
- `backend/src/middleware/csrf.ts:L43` (cookie options — `httpOnly: false` so JS can read).
- `src/services/api/client.ts:L120-L134` (frontend read).
- `src/services/api/client.ts:L187-L195` (frontend attach).

**Cross-link**: [`ERROR_RECOVERY.md` §5 CSRF family](./ERROR_RECOVERY.md).

---

### S-7. CSRF passes in dev, fails in prod

**Symptom**: POSTs work locally on `http://localhost:5173`; same build on `www.ownmyhealth.app` → 403 CSRF.

**Root cause**: cookie `domain` attribute. In dev both frontend (5173) and backend (3001) share `localhost`; in prod they're on sibling subdomains (`www.` vs `api.`). A cookie set on `api.ownmyhealth.app` without `domain=.ownmyhealth.app` is never sent by the browser on `www.ownmyhealth.app` requests to `api.`.

**Workaround**: none.

**Fix**: commit `8db4317` (2026-01-08) "fix: support cross-domain cookies for CSRF protection" — CSRF cookie now gets `domain=.ownmyhealth.app` (with leading dot) in production. `50d7426` same day did the equivalent for access/refresh cookies.

**Files**: `backend/src/middleware/csrf.ts` (cookie options, search for `setCsrfCookie`); `backend/src/controllers/authController.ts` (auth cookies).

---

### S-8. File upload or AI guidance returns 403 `FORBIDDEN` "CSRF token missing"

**Symptom**: `POST /upload/lab-report` or `GET /biomarkers/:id/guidance` fails with 403 even though the session is otherwise fine.

**Root cause**: these routes are either intentionally exempt from CSRF (uploads — see `csrf.ts:L117-L122`) or were previously failing because the frontend helper didn't forward the `x-csrf-token` header. SSE / multipart have their own quirks.

**Workaround**: ensure the route is using `uploadUtils.ts` (which attaches the header). For AI guidance SSE, use `requireBearerAuth` — CSRF is correctly bypassed for `/ai/chat` (`csrf.ts:L124-L132`).

**Fix** (chronological):
- `be803f3` (2026-01-07) "fix: add CSRF token to file upload requests".
- `750357e` (2026-01-07) "fix: exempt file upload routes from CSRF validation" — belt-and-suspenders: exempt in middleware **and** send header via uploadUtils.
- `adca319` (2026-01-07) "fix: skip CSRF validation for settings routes (Bearer token protected)".
- `4d40b79` (2026-01-07) "fix: add CSRF token to DELETE requests in frontend API".
- `b9203ef` (2026-01-08) "fix: exempt /biomarkers/:id/guidance from CSRF validation".
- `7ad1272` (2026-01-08) "fix: include CSRF token in AI guidance API calls".

**Files**:
- `backend/src/middleware/csrf.ts:L95-L148` (exemption list — `publicAuthRoutes`, `uploadRoutes`, `bearerOnlyStreamingRoutes`).
- Frontend upload helper (wherever `uploadUtils.ts` lives — see `FRONTEND_MAP.md` once generated).

---

## 6. Database symptoms

### S-9. Queries hang then fail with "connection timeout" or "all connections busy"

**Symptom**: intermittent 500s under burst load; Cloud Run logs show `connection timeout` or Prisma errors mentioning the pool.

**Root cause**: `pg` `Pool` was at `max: 5` and burst traffic exhausted it. Per comment at `backend/src/services/database.ts:L100-L107`: "Default falls back to 10 — the old `max: 5` was hitting 'all connections busy' under burst load."

**Workaround**: restart Cloud Run revision (reset sockets); lower traffic.

**Fix**: default pool size raised to 10; env-tunable via `DATABASE_POOL_SIZE`. Current code:

```ts
// Source: backend/src/services/database.ts:L108-L114
pool = new Pool({
  connectionString,
  max: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000, // 30s for Cloud SQL Auth Proxy
  statement_timeout: 30000, // 30s statement timeout
});
```

**Files**: `backend/src/services/database.ts:L97-L126`.

**Tuning guidance**: each Cloud Run instance holds up to `max` connections. Cloud SQL has per-instance limits; multiply by `--max-instances` and confirm < Cloud SQL cap. See [`RUNBOOK.md`](./RUNBOOK.md).

**Cross-link**: [`ERROR_RECOVERY.md` §3 `DATABASE_ERROR`](./ERROR_RECOVERY.md).

---

### S-10. `prisma migrate deploy` fails on `CREATE INDEX CONCURRENTLY`

**Symptom**: `prisma migrate deploy` fails with `ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`.

**Root cause**: Prisma wraps each migration file in a transaction. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Prisma doesn't support a per-statement opt-out.

**Workaround**: run the `CONCURRENTLY` statement manually via `psql`, then mark the migration applied with `prisma migrate resolve --applied`.

**Fix**: commit `c00f8cc` (2026-01-06) "fix: remove CONCURRENTLY from migration indexes" — index-create SQL in migrations now uses plain `CREATE INDEX`. Non-blocking `CONCURRENTLY` creation remains an option for ops but is not in the migration files.

**Files**: `backend/prisma/migrations/**/migration.sql`.

**Cross-link**: [`RUNBOOK.md`](./RUNBOOK.md) for the manual-apply playbook.

---

### S-11. Query returns fewer rows than expected (RLS mystery)

**Symptom**: controller calls `tx.biomarker.findMany()` inside `withRLSContext(userId, ...)`; returns `[]` even though a row clearly exists for that user in `psql`.

**Root cause**: one of:
1. `userId` at the controller is not the actual owner of the row. Verify `req.user.id` matches `biomarker.user_id`.
2. The query is inside `withRLSContext(null, ...)` (admin context) — unusual for a user-scoped flow.
3. The row exists but its `user_id` column is NULL or a different UUID (data corruption or migration bug).

**Workaround**: temporarily log `req.user.id` vs the expected owner. Check `psql` with the admin role (bypass RLS) to see the row's actual `user_id`.

**Fix**: not a single fix — it's a diagnostic pattern. Canonical "RLS denial masquerades as NOT_FOUND" is documented at [`ERROR_RECOVERY.md` §5 PHI / data-access family](./ERROR_RECOVERY.md):

> Every `findFirst` / `findUnique` inside `withRLSContext(userId, ...)` returns `null` both when the resource truly doesn't exist **and** when it exists under a different `user_id`.

**Diagnostic query** (Cloud SQL proxy → psql):

```sql
-- Bypass RLS to see what's actually there. Requires BYPASSRLS role or superuser.
SELECT id, user_id, measured_at FROM biomarkers WHERE id = '<id>';
-- Compare with your expected req.user.id.
```

**Files**: `backend/src/services/database.ts:L456-L495` (`withRLSContext`), `backend/prisma/migrations/20260107_add_rls_policies/migration.sql` (policies).

**Cross-link**: [`ERROR_RECOVERY.md` §5 `NOT_FOUND` as RLS denial](./ERROR_RECOVERY.md), [`CLAUDE.md` Row-Level Security](../CLAUDE.md).

---

### S-12. Query silently returns ALL users' rows (RLS bypass)

**Symptom**: admin reviews a PATIENT's dashboard and sees rows from other patients. Or a query returning more rows than the user should own.

**Root cause**: **the RLS footgun documented at `backend/src/services/database.ts:L14-L31`**. Inside a `withRLSContext(userId, async (tx) => ...)` callback, calling the module-level `prisma.*` client instead of `tx.*` runs on a different pooled connection that never received the `SET LOCAL app.current_user_id`. RLS policies then evaluate against NULL and return all rows.

**Workaround**: none — this is a security incident. Restart the service, triage audit logs, scan for the pattern.

**Fix**: code pattern — **always `tx.*` inside RLS callbacks**. CI guard at `scripts/check-rls-wrappers.sh` (per `database.ts:L26-L27`) greps for `prisma.` calls inside controllers/services and fails the build.

> Project-memory note (2026-04-16): RLS is structurally in place but the app runs as a BYPASSRLS role in both dev and prod, so policies don't actually enforce. PR #30 (2026-04-16) closes C-1/F-14/F-15 but doesn't fix the runtime-role issue. Until the role cutover (`RLS_ENFORCEMENT=strict` at `database.ts:L190-L228`) this bypass class of bug is undetectable by runtime behavior — only the CI grep guard protects against it. See commit `4290520` (2026-04-23) "feat(c-8): prepare code for RLS role cutover".

**Files**:
- `backend/src/services/database.ts:L14-L31` (footgun docblock).
- `backend/src/services/database.ts:L190-L228` (`assertNoBypassRLS`).
- `scripts/check-rls-wrappers.sh` (CI guard).

---

## 7. Deployment symptoms

### S-13. `gcloud run services update --update-env-vars` applied but prod behavior unchanged

**Symptom**: you flipped an env var on Cloud Run (e.g., `ANTHROPIC_BAA_ACTIVE=true`). The revision was created, but AI endpoints still return 503 `"AI Health Guide is disabled: ANTHROPIC_BAA_ACTIVE must be \"true\"..."`.

**Root cause** (**project-memory entry, 2026-04-17 postmortem**): `gcloud run services update --update-env-vars=…` creates a new revision but keeps 0% traffic on it if the service was previously pinned with `--to-revisions=…`. The detection signal is:

```
latestReadyRevisionName ≠ latestCreatedRevisionName
```

The new revision is ready, but all traffic is still pinned to the old one.

**Workaround**: none.

**Fix**: follow with:

```bash
gcloud run services update-traffic <service> --to-revisions=<NEW-REVISION>=100
# or drop the pin:
gcloud run services update-traffic <service> --to-latest
```

**Files / evidence**:
- Project-memory doc: `cloud-run-env-update-pinning.md` (full postmortem of the 2026-04-17 `ANTHROPIC_BAA_ACTIVE` flip).
- Backend check that produces the visible 503: `backend/src/controllers/aiChatController.ts:L134-L145`, `backend/src/routes/biomarkerRoutes.ts:L141-L147`, `backend/src/controllers/expenseController.ts:L637`.

**Cross-link**: [`ERROR_RECOVERY.md` §5 `SERVICE_UNAVAILABLE` (HTTP 503) — BAA gate](./ERROR_RECOVERY.md), [`RUNBOOK.md`](./RUNBOOK.md).

---

### S-14. GitHub Actions deploy workflow fails

**Symptom**: `.github/workflows/deploy.yml` run goes red. Possibilities:

| Sub-symptom | Commit with fix | Notes |
|---|---|---|
| YAML parse error | `9d0d812` (2025-12-10) "fix: correct YAML syntax in ci.yml" | Tabs vs spaces, missing `-` in sequences. |
| Backend tests fail because no tests exist | `fdcac2d` (2025-12-09) "fix: allow CI to pass when no backend tests exist" | Jest `--passWithNoTests` flag. |
| Vitest picks up backend files | `e2501d4` (2026-01-06) "fix: exclude backend from frontend Vitest config" | `vitest.config.ts` include/exclude. |
| Lint errors in test files | `52cf0ba` (2026-01-06) "fix: resolve ESLint errors in test files" | — |
| `npm audit` vulnerabilities (jws, hono, valibot) | `4cdb9d0` (2025-12-14) | Lockfile regeneration needed. |
| Security-change cascade | `3df9313` (2026-02-06) "fix: resolve CI lint and test failures from Batch 3 security changes" | — |

**Root cause**: varied — see commit messages above.

**Workaround**: re-run the failing job; check PR checks.

**Fix**: match the sub-symptom to the commit in the table.

**Files**: `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `vitest.config.ts`, `backend/jest.config.ts`.

---

### S-15. Docker build fails during `prisma generate`

**Symptom**: `docker build` fails inside the frontend or backend image with `Error: DATABASE_URL environment variable not found` during `prisma generate`, or module resolution errors for the generated Prisma client after the build.

**Root cause**: Prisma tries to read `DATABASE_URL` at generation time in some paths; the Dockerfile didn't provide a stub. Separately, the generated Prisma client was output to a path TypeScript compile couldn't find in the final image.

**Workaround**: pass a dummy `DATABASE_URL` at build time.

**Fix**:
- `b22c9a1` (2025-12-08) "fix: add DATABASE_URL fallback for build-time prisma generate" — dummy URL for codegen.
- `3e3c972` (2025-12-08) "fix: copy prisma generated client to dist/generated for correct module resolution" — post-build copy so runtime can `require` it.
- `f0eff7a` (2026-01-08) "fix: rebuild Docker image on every deploy" — cache-bust to avoid stale images.
- `d07eb1a` (2025-12-08) "fix: rename root railway.toml to prevent interference with backend deployment" — legacy Railway artifact was shadowing Cloud Run build config.
- `79ac04a` (2025-12-08) "fix: switch Railway to Nixpacks builder for more reliable deployment" — legacy.

**Files**: `backend/Dockerfile`, `backend/package.json` (postinstall/build scripts), `backend/prisma/schema.prisma` (`generator client` output path).

---

## 8. Frontend symptoms

### S-16. Frontend loads blank page, no errors visible

**Symptom**: navigating to the deployed frontend shows a blank white page. Browser console may be empty if built for prod.

**Root cause**: typically a bundle error that throws before React mounts. Known causes:
1. `forwardRef` error from Recharts being split across chunks (S-17).
2. `crypto.randomUUID is not a function` because the page was served over HTTP (S-19).
3. Stale GCS object cache after deploy — the HTML references a bundle hash that no longer exists.

**Workaround**: hard refresh with DevTools → Network → "Disable cache" checked. Check console with "Preserve log" enabled before reload.

**Fix**: match the specific cause; see S-17, S-19. For stale cache, the deploy workflow sets GCS `Cache-Control` on HTML; older revisions may have shipped without it.

**Files**: `vite.config.ts` (chunking), `.github/workflows/deploy.yml` (GCS cache headers).

---

### S-17. Dashboard charts crash "Cannot read properties of undefined (reading 'forwardRef')"

**Symptom**: trend chart page renders blank or shows an overlay error about `React.forwardRef` being undefined. Only happens in the production bundle, not dev.

**Root cause**: Vite's manual chunk splitting placed Recharts and React in different chunks; Recharts imported `React.forwardRef` before React's bundle had evaluated.

**Workaround**: none in prod.

**Fix**:
- `e107665` (2026-01-07) "fix: remove manual chunk splitting to fix React forwardRef error" — eliminated `manualChunks` config.
- `1e1bac0` (2026-01-08) "fix: keep React and recharts in same bundle to fix forwardRef error" — where chunking is needed, Recharts stays co-bundled with React.
- `3d287e2` (2026-01-07) "fix: add null checks to prevent chart rendering errors" — defensive prop checks when data is empty.

**Files**: `vite.config.ts` (chunk config), `src/components/analytics/*`, `src/components/trends/*`.

---

### S-18. Browser console: "blocked by CORS policy"

**Symptom**: network tab shows OPTIONS requests (or an actual GET/POST) failing with `CORS error`. Message in console mentions `Access-Control-Allow-Origin`.

**Root cause**: backend CORS middleware not permitting the frontend origin, OR returning `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` (browser rejects this combination).

**Workaround**: run frontend on same origin as backend (proxy via Vite dev server), or set `VITE_API_URL` to a path the dev proxy rewrites.

**Fix**:
- `327b2f4` (2026-01-08) "fix: CORS configuration for cross-domain cookies" — explicit origin from `CORS_ORIGIN` env, not `*`; `credentials: true`.
- `ad2dff9` (2026-01-08) "fix: ensure CORS preflight requests are handled properly" — OPTIONS 204 before CSRF middleware runs.

**Files**: `backend/src/server.ts` / `backend/src/app.ts` (CORS setup), `backend/src/config/index.ts` (`CORS_ORIGIN`).

---

### S-19. `crypto.randomUUID is not a function` on older browsers / HTTP contexts

**Symptom**: blank page or thrown error referencing `crypto.randomUUID` on some browsers or when testing over `http://` rather than `https://` or `localhost`.

**Root cause**: `crypto.randomUUID` is only available in secure contexts (HTTPS, localhost). Non-secure HTTP origins (including some staging URLs without TLS) have `window.crypto` but not `randomUUID`.

**Workaround**: use HTTPS or localhost.

**Fix**:
- `ff51c61` (2025-12-09) "fix: add crypto.randomUUID polyfill for HTTP contexts".
- `68e8478` (2025-12-09) "fix: move crypto.randomUUID polyfill to index.html to load before bundles" — polyfill must run before any `import` touches it.

**Files**: `index.html` (polyfill `<script>` before module bundle).

---

### S-20. Vite dev server fails on Windows ARM64 + Node 24

**Symptom**: `npm run dev` on a Windows ARM64 (Surface / Copilot+ PC) with Node.js 24 errors with messages about `not a valid Win32 application` for Next.js SWC binaries — **applies to the sibling HealthcareProviderDB project, not directly OwnMyHealth** (OwnMyHealth uses Vite 7.3, not Next.js). Derived-from-architecture: OwnMyHealth's Vite toolchain uses `@vitejs/plugin-react` (not `@vitejs/plugin-react-swc`), so the same class of ARM64 SWC failure does not currently affect this repo.

**Root cause** (**project-memory entry**, originally cataloged for HealthcareProviderDB):
- Native SWC binaries for Next.js 14.x are incompatible with Node.js v24+ on Windows ARM64.
- Next.js 14.x only auto-enables WASM fallback for a hardcoded list of platforms; `win32-arm64` is NOT in the list.

**Workaround**: use Node 20 LTS; or run under WSL2.

**Fix** (for Next-based projects — OwnMyHealth does not use it today): patch `next/dist/build/swc/index.js` to add `aarch64-pc-windows-msvc` to `knownDefaultWasmFallbackTriples` and remove the `useWasmBinary` gate. Postinstall script pattern at `packages/frontend/scripts/patch-next-swc.js`.

**Files (for this repo, for prevention)**:
- `package.json` — confirm `@vitejs/plugin-react` (Babel) rather than `@vitejs/plugin-react-swc`.
- Root `package.json` — confirm Node engine range permits 20 LTS.

> **Derived-from-architecture flag**: this symptom is included because the prompt explicitly lists "Vite/SWC on ARM64 per project memory". The memory entry is about Next.js in a sibling project (HealthcareProviderDB). If OwnMyHealth migrates to Next.js or `@vitejs/plugin-react-swc`, the same class of failure will resurface.

---

## 9. API / 500 symptoms

### S-21. API returns 500 with generic message

**Symptom**: `POST /<something>` returns 500 with body:

```json
{ "success": false, "error": { "code": "INTERNAL_ERROR", "message": "An unexpected error occurred. Please try again later." } }
```

**Root cause**: the centralized error handler (`backend/src/middleware/errorHandler.ts:L144`) replaces `err.message` with a generic string in production **unless** `err instanceof AppError`. Any thrown `Error` (not a subclass) collapses to this message. Thrown `AppError` subclasses surface their message to the client.

Per the error-handler logic:

```ts
// Source: backend/src/middleware/errorHandler.ts:L142-L158
let message = config.isDevelopment ? err.message : GENERIC_ERROR_MESSAGE;
// ...
if (err instanceof AppError) {
  apply({ statusCode: err.statusCode, code: err.code, message: err.message });
}
```

**Workaround**: reproduce in dev (`NODE_ENV=development`) — dev bypasses the generic message and shows the real error.

**Fix**: code authors should throw `AppError` subclasses, not bare `Error`. Known non-compliant sites flagged in [`ERROR_RECOVERY.md` §3 item 8](./ERROR_RECOVERY.md) — `expenseController.ts:89,128,203,255,282,403,467,534,560,579,605,623,664,747,751,802` and `biomarkerController.ts:568-578` emit `{ error: '<string>' }` shapes.

**Files**: `backend/src/middleware/errorHandler.ts:L133-L201`.

**Cross-link**: [`ERROR_RECOVERY.md` §3 `INTERNAL_ERROR`](./ERROR_RECOVERY.md).

---

### S-22. Server fails to start — FATAL log lines before first request

**Symptom**: Cloud Run revision won't go healthy; logs show `FATAL: Cannot start server - <step>`.

**Root cause**: by design, `backend/src/services/database.ts:L134-L148` (`initStep`) and the startup sequence treat partial startup as never acceptable for a HIPAA system. Known FATAL steps:

| FATAL step | Hint | Common cause |
|---|---|---|
| `database connection` | "Ensure DATABASE_URL is correct and PostgreSQL is running." | Cloud SQL Auth Proxy down, wrong instance connection name |
| `encryption service initialization` | "Ensure PHI_ENCRYPTION_KEY is set and valid." | Missing env var, wrong key length (must be 64 hex chars) |
| `audit logging service` | "HIPAA compliance requires audit logging to be operational." | DB unreachable after initial connect |

Additionally, `assertNoBypassRLS()` (`database.ts:L190-L228`) will **warn** unless `RLS_ENFORCEMENT=strict`, in which case it hard-exits when the DB login has `BYPASSRLS`.

**Workaround**: check env vars on the Cloud Run revision; check Cloud SQL instance status.

**Fix**: not a code fix — ops. See [`RUNBOOK.md`](./RUNBOOK.md) startup playbook.

**Files**: `backend/src/services/database.ts:L128-L228`, `backend/src/config/index.ts`.

---

## 10. PDF / OCR / Claude extraction symptoms

### S-23. Lab upload returns 500, or completes but "no biomarkers extracted"

**Symptom**: user uploads PDF to `/upload/lab-report` or `/upload/lab-results-ocr`. Either gets 500, or 200 with `data.biomarkers = []`, or 422 `"Could not extract any biomarkers from the PDF..."`.

**Root cause**: multiple classes of issue, fixed incrementally:

| Sub-symptom | Root cause | Commit |
|---|---|---|
| "PDF bomb" stalls server | No DoS protection on PDF parsing | `f6c2b92` (2026-01-06) "fix: add PDF bomb DoS protection with timeout and memory limits" |
| Wrong pdf-parse version | ESM/CJS path mismatch | `254e2ec`, `154e52e` (2026-01-08) "use pdf-parse v1.x with correct import path" |
| Multi-line table rows in OCR | Document AI emits cells on separate lines | `f62796f` → `2cbf6e4` → `56fd294` (2026-01-08) |
| Quest lab whitespace variation | Pattern too strict | `a59c547`, `e79e1e2` (2026-01-07) |
| Pattern needed flexibility for OCR | Pattern didn't handle OCR noise | `8e87ea3`, `e79e1e2` (2026-01-07) |
| Extracted date ignored | Used upload timestamp, not lab-collection date | `36b7306` (2026-01-08) "use extracted labDate from Claude for biomarker measurement date" |
| Upload modal closed before results visible | UX bug | `45cef63` (2026-01-08) "keep lab upload modal open after extraction to show results" |
| Biomarkers disappeared after list view | Pagination bug | `080ad8e` (2026-01-08) "prevent biomarkers from disappearing due to pagination" |
| 400 on scanned PDF that has no text layer | Expected — `VALIDATION_ERROR` at `controllers/upload/shared.ts:113` | Re-upload via `/upload/lab-results-ocr` |
| Missing `GOOGLE_APPLICATION_CREDENTIALS` | Can't init Document AI | `2b79d46` (2026-01-07) "support JSON credentials in GOOGLE_APPLICATION_CREDENTIALS" — allows inlining the service-account JSON |

**Workaround**: retry via the OCR endpoint if the PDF is scanned.

**Fix**: see commits per row.

**Files**:
- `backend/src/services/pdfParser.ts`.
- `backend/src/services/ocrService.ts`.
- `backend/src/services/claudeExtraction.ts`.
- `backend/src/controllers/upload/shared.ts:L89-L113`.
- `backend/src/controllers/upload/labUploadController.ts`.

**Cross-link**: [`ERROR_RECOVERY.md` §3 `VALIDATION_ERROR`](./ERROR_RECOVERY.md).

---

### S-24. AI endpoints return 503 `SERVICE_UNAVAILABLE`

**Symptom**: `/ai/chat`, `/biomarkers/:id/guidance`, or `/expenses/ai-cost-analysis` returns 503 with message like `"AI Health Guide is disabled: ANTHROPIC_BAA_ACTIVE must be \"true\". See SECURITY_STATUS.md C-7."`.

**Root cause**: HIPAA BAA gate. The backend refuses to call Anthropic unless the `ANTHROPIC_BAA_ACTIVE=true` env var is set, because sending PHI to a vendor without an executed BAA is an impermissible disclosure.

**Workaround**: none (by design — do NOT bypass locally with PHI).

**Fix**: flip the env var on Cloud Run:

```bash
gcloud run services update <service> --update-env-vars=ANTHROPIC_BAA_ACTIVE=true --region=<region>
# THEN — critical, per S-13 / 2026-04-17 postmortem:
gcloud run services update-traffic <service> --to-latest --region=<region>
```

**Files**: `backend/src/controllers/aiChatController.ts:L134-L145`, `backend/src/routes/biomarkerRoutes.ts:L141-L147`, `backend/src/controllers/expenseController.ts:L637`.

**Cross-link**: [`ERROR_RECOVERY.md` §5 AI family](./ERROR_RECOVERY.md), [S-13](#s-13-gcloud-run-services-update---update-env-vars-applied-but-prod-behavior-unchanged), [`RUNBOOK.md`](./RUNBOOK.md).

---

### S-25. Claude API returns 400 `invalid_request_error` (max_tokens)

**Symptom**: extraction fails with upstream error mentioning `max_tokens exceeds limit`.

**Root cause**: request specified a `max_tokens` higher than the model's per-request cap. Claude models have explicit caps; older code requested `8192` on a model capped at `4096`.

**Workaround**: none.

**Fix**: commit `e029127` (2026-01-09) "fix: Reduce Claude API max_tokens to valid limit".

**Files**: `backend/src/services/claudeExtraction.ts`, `backend/src/services/sbcExtraction.ts`.

---

### S-26. Insurance SBC upload breaks with PDF.js worker error

**Symptom**: user on `/insurance` page uploads SBC. Console shows PDF.js worker load error; upload fails or hangs.

**Root cause**: PDF.js was being loaded in the frontend for preview / client-side parsing; its worker script couldn't resolve at runtime, and the full PDF.js bundle was too heavy. Backend already uses `pdf-parse` + Claude for extraction — no reason to also parse client-side.

**Workaround**: go through the SBC upload flow that uploads raw bytes to the backend.

**Fix** (sequence of removals, 2026-01-09):
- `0d2cd7a` "Remove frontend PDF.js parsing from SBC upload".
- `8f9314f` "Prevent PDF.js from loading on insurance pages".
- `4654968` "Remove PDF.js from EnhancedInsuranceUpload".
- `6cdf698` "Remove unused type imports in EnhancedInsuranceUpload".

**Files**: `src/components/insurance/*`, `src/components/upload/*`.

---

## 11. Quick diagnostic commands

### 11.1 Prod health

```bash
# Backend health (replace with actual prod URL)
curl -i https://api.ownmyhealth.app/api/v1/health

# CSRF token round-trip (confirms cookie attach + domain scope)
curl -i -c /tmp/cookies.txt https://api.ownmyhealth.app/api/v1/csrf-token
grep csrf_token /tmp/cookies.txt   # must show the cookie
```

### 11.2 Cloud Run logs (GCP)

```bash
# Last 20 errors in the last hour
gcloud logging read \
  'resource.type="cloud_run_revision" severity>=ERROR' \
  --limit=20 --freshness=1h --format=json

# Filter to a specific service
gcloud logging read \
  'resource.type="cloud_run_revision" resource.labels.service_name="ownmyhealth-backend" severity>=ERROR' \
  --limit=50 --freshness=6h

# Look for FATAL startup failures (S-22)
gcloud logging read \
  'resource.type="cloud_run_revision" textPayload=~"FATAL: Cannot start server"' \
  --limit=20 --freshness=24h

# Check which revision is serving traffic vs latest-ready (S-13)
gcloud run services describe ownmyhealth-backend \
  --region=<region> \
  --format='value(status.latestReadyRevisionName,status.latestCreatedRevisionName,status.traffic[].revisionName,status.traffic[].percent)'
```

### 11.3 Cloud SQL via proxy + psql (S-9, S-11, S-12)

```bash
# Start Auth Proxy in background
cloud-sql-proxy --port=5432 <project>:<region>:<instance> &

# Connect
psql "host=127.0.0.1 port=5432 user=<db-user> dbname=<db-name>"

# Verify the current role's RLS attributes (relates to S-12, 2026-04-16 project-memory)
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = CURRENT_USER;

# See actual rows for a user without RLS filtering (admin context)
-- Session must be under a BYPASSRLS role, else this still filters.
SELECT id, user_id, measured_at FROM biomarkers WHERE id = '<id>';
```

### 11.4 Verify CSRF exemptions (S-6, S-8)

```bash
# Hitting a CSRF-protected mutation without the header should return 403
curl -i -X POST https://api.ownmyhealth.app/api/v1/biomarkers \
  -H "Content-Type: application/json" --cookie "access_token=..." \
  -d '{"name":"test"}'
# Expect: 403 with {"error":{"code":"FORBIDDEN","message":"CSRF token missing"}}

# Uploads are exempt — same shape without the header should NOT 403 on CSRF
curl -i -X POST https://api.ownmyhealth.app/api/v1/upload/lab-report \
  --cookie "access_token=..." -F "file=@/tmp/foo.pdf"
# Expect: 401 if no auth, 422 if bad file — NOT 403 CSRF.
```

### 11.5 Detect PHI in logs (audit-critical)

```bash
# Scan Cloud Run logs for raw PHI markers (email-shaped strings, DOBs).
# Finding these is a HIPAA incident — redirect to RUNBOOK.md "PHI in logs".
gcloud logging read \
  'resource.type="cloud_run_revision" textPayload=~"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"' \
  --limit=20 --freshness=24h

# Frontend: audit F-10 / F-18 codified that raw console.log leaked auth-flow
# details. Replacement pattern: authLogger/apiLogger which gate on production.
# See src/contexts/AuthContext.tsx:L105-L113 and src/services/api/client.ts:L125-L130.
```

---

## 12. Related Documents

- [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) — code-catalog-first counterpart. Every HTTP error `code` the backend emits and its recovery.
- [`RUNBOOK.md`](./RUNBOOK.md) — operational playbooks (JWT rotation, env-flag flips, DB restore).
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) — currently-open symptoms not yet resolved.
- [`LOCAL_DEV.md`](./LOCAL_DEV.md) — local-dev failure modes (ports, certs, Cloud SQL proxy).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — auth flow, RLS, middleware stack — to understand *why* a symptom arises.
- [`API_REFERENCE.md`](./API_REFERENCE.md) — per-endpoint contracts and expected error codes.
- [`DATA_MODEL.md`](./DATA_MODEL.md) — RLS policies, cascade behavior.

---

## 13. Acceptance-question self-check

Answered from this doc + siblings only.

**Q1. Where's the canonical fix for "data disappears on refresh"?**
→ [§S-2](#s-2-data-disappears-after-page-refresh). Commit `195ccc1` (2026-01-10); reorder to `await authApi.refreshToken()` before `authApi.getCurrentUser()` in `src/contexts/AuthContext.tsx:L93-L128`.

**Q2. What's the decision tree for a stuck-on-login user?**
→ [§3.1](#31-im-stuck-on-login--401-loop). Starts with "What does `POST /auth/login` return?" and branches on 429 / 401 `INVALID_CREDENTIALS` / 403 `EMAIL_NOT_VERIFIED` / "200 then bounce" / 403 CSRF / network error.

**Q3. What symptom indicates the Cloud Run env-update pinning gotcha, and where's the fix?**
→ [§S-13](#s-13-gcloud-run-services-update---update-env-vars-applied-but-prod-behavior-unchanged). Symptom: env-var update appears applied but prod behavior unchanged; detection via `latestReadyRevisionName ≠ latestCreatedRevisionName`. Fix: `gcloud run services update-traffic <service> --to-latest`. Full postmortem: project-memory `cloud-run-env-update-pinning.md` (2026-04-17).

**Q4. What causes an RLS "mystery" (fewer rows than expected), and how do you confirm?**
→ [§S-11](#s-11-query-returns-fewer-rows-than-expected-rls-mystery) + decision tree [§3.4](#34-rls-mystery--query-returns-fewer-rows-than-expected). Causes: wrong `userId` in context, call used `prisma.*` not `tx.*` (footgun at `database.ts:L14-L31`), or row's `user_id` differs from expected. Confirm via psql admin query [§11.3](#113-cloud-sql-via-proxy--psql-s-9-s-11-s-12).

**Q5. How do you detect PHI leaking into logs?**
→ [§11.5](#115-detect-phi-in-logs-audit-critical). `gcloud logging read` with a regex for email-shaped strings; escalate any hit to `RUNBOOK.md` "PHI in logs". Audit findings F-10/F-18 drove the switch to gated `authLogger`/`apiLogger` (`AuthContext.tsx:L105-L113`, `client.ts:L125-L130`).

**Q6. What's the most common cause of blank page on frontend, and where is it fixed?**
→ [§S-16](#s-16-frontend-loads-blank-page-no-errors-visible) + [§S-17](#s-17-dashboard-charts-crash-cannot-read-properties-of-undefined-reading-forwardref). Most common: Recharts/React chunk-split `forwardRef` crash. Fixed by commits `e107665` and `1e1bac0` (2026-01-07/08).

**Q7. Which past fix covers upload 500 errors, and where is the commit?**
→ [§S-23](#s-23-lab-upload-returns-500-or-completes-but-no-biomarkers-extracted). Many — anchored by commit `f6c2b92` (2026-01-06) "add PDF bomb DoS protection with timeout and memory limits"; the table in that section maps each sub-symptom to its commit.

**Q8. What's the quick curl to verify prod health?**
→ [§11.1](#111-prod-health). `curl -i https://api.ownmyhealth.app/api/v1/health` plus a CSRF-token round-trip to confirm cookie attach + domain scope.

**Q9. Which failure matches "Next.js SWC ARM64 incompat" per project memory?**
→ [§S-20](#s-20-vite-dev-server-fails-on-windows-arm64--node-24). Cataloged as derived-from-architecture: the memory entry applies to HealthcareProviderDB (Next.js 14.x). OwnMyHealth currently uses Vite + `@vitejs/plugin-react` (Babel), so the same SWC-ARM64 class of failure is inactive here, but the symptom card documents the pattern for when/if the stack changes.

**Q10. Where does the doc point for each symptom that maps to a known `code`?**
→ Every symptom with a known `code` has a "Cross-link" footer pointing at the specific `ERROR_RECOVERY.md` section. The master map is the **Symptom index** [§2](#2-symptom-index) — the rightmost column links each relevant symptom to `ERROR_RECOVERY.md`.

---

## 14. Prompt drift log

- The prompt example for S-2 cites AuthContext line ranges as `Lxx-Lyy`; the current file has the ordering fix at `L93-L128` (verified against `src/contexts/AuthContext.tsx` at the time of generation).
- The prompt's canonical decision-tree example references a "CSRF Token Missing" handler; the actual throw at `backend/src/middleware/csrf.ts:L161` uses message `'CSRF token missing'` and `code: 'FORBIDDEN'` — there is **no** dedicated `CSRF_MISMATCH` or `CSRF_TOKEN_MISSING` code (already noted in `ERROR_RECOVERY.md` §11).
- The prompt lists "Vite/SWC on ARM64 per memory" under Frontend symptoms, but the relevant project-memory entry is scoped to the sibling HealthcareProviderDB (Next.js). OwnMyHealth's Vite + Babel React toolchain is not affected today. Catalogued as derived-from-architecture with an explicit flag at S-20.
- The prompt's decision-tree example has a branch "`419 SESSION_EXPIRED`"; no 419 is emitted anywhere in this codebase (`ERROR_RECOVERY.md` §2 confirms). 401 `UNAUTHORIZED` / `TOKEN_EXPIRED` is the only session-expiry signal.
