# TROUBLESHOOTING.md

> Symptom-first catalog for OwnMyHealth. You observed behavior X in the browser, the network tab, or the Cloud Run logs — this doc routes you to the file, the log filter, and the fix in under a minute.
> Verified against the codebase on **2026-06-01**. Every non-trivial claim cites `file:path:line`.

## How to use this doc

Find your symptom in the [Symptom index](#symptom-index), jump to its section, and read **Symptom → Root cause → Workaround → Fix → Files**. If you already know the **error `code`** (`FORBIDDEN`, `SERVICE_UNAVAILABLE`, etc.), use [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) instead — that doc is the error-code-first lens; this one is the observed-behavior lens. For incident *playbooks* (rollback, key rotation, env flips) go to [`RUNBOOK.md`](./RUNBOOK.md). For currently-open bugs see [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

| This doc (`TROUBLESHOOTING.md`) | [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) |
|---|---|
| Organized by **observed behavior** ("data disappears after refresh") | Organized by **error `code`** (`NOT_FOUND` → recovery) |
| Decision trees, log filters, curls | Per-code envelope, status conventions, master code table |

---

## Symptom index

| # | Symptom | Section |
|---|---|---|
| 1 | Stuck on login / 401 loop | [Auth symptoms](#auth-symptoms) → [Stuck on login / 401 loop](#stuck-on-login--401-loop) |
| 2 | Data disappears after page refresh | [Auth symptoms](#auth-symptoms) → [Data disappears after page refresh](#data-disappears-after-page-refresh) |
| 3 | Logged out after ~15 min of activity | [Auth symptoms](#auth-symptoms) → [Logged out after 15 minutes idle](#logged-out-after-15-minutes-idle) |
| 4 | Login page fetch storm / repeated 429s | [Auth symptoms](#auth-symptoms) → [Login page fetch storm](#login-page-fetch-storm) |
| 5 | Mutation rejected: "CSRF token missing" / "Invalid CSRF token" | [CSRF symptoms](#csrf-symptoms) |
| 6 | Query returns fewer rows than expected / 404 on a row you own | [Database symptoms](#database-symptoms) → [RLS mystery](#rls-mystery-fewer-rows-than-expected) |
| 7 | "all connections busy" / pool exhaustion | [Database symptoms](#database-symptoms) → [Connection pool exhaustion](#connection-pool-exhaustion) |
| 8 | Server refuses to boot (FATAL) | [Database symptoms](#database-symptoms) → [Server refuses to start](#server-refuses-to-start-fatal-boot) |
| 9 | Env-var change has no effect after deploy | [Deployment symptoms](#deployment-symptoms) → [Env-var change has no effect](#env-var-change-has-no-effect-cloud-run-pinning) |
| 10 | CI deploy fails at smoke-test | [Deployment symptoms](#deployment-symptoms) → [Deploy fails at smoke-test](#deploy-fails-at-smoke-test) |
| 11 | Blank page after deploy / "A new version is available" | [Frontend symptoms](#frontend-symptoms) → [Blank page or stale-chunk crash](#blank-page-or-stale-chunk-crash) |
| 12 | CORS rejected / browser request blocked | [Frontend symptoms](#frontend-symptoms) → [CORS rejected origin](#cors-rejected-origin) |
| 13 | Cookies not set / auth fails cross-domain | [Frontend symptoms](#frontend-symptoms) → [Cookies not set (SameSite / domain)](#cookies-not-set-samesite--domain) |
| 14 | Upload returns 500 / "could not extract biomarkers" | [PDF / OCR / extraction symptoms](#pdf--ocr--claude-extraction-symptoms) |
| 15 | Upload rejected: "File too large" / "does not match its declared type" | [PDF / OCR / extraction symptoms](#pdf--ocr--claude-extraction-symptoms) → [Upload rejected before extraction](#upload-rejected-before-extraction) |
| 16 | "AI features are temporarily unavailable" (503) | [AI chat / spend-cap symptoms](#ai-chat--spend-cap-symptoms) |
| 17 | "Too many AI requests" (429) | [AI chat / spend-cap symptoms](#ai-chat--spend-cap-symptoms) → [429 vs 503 on AI routes](#429-vs-503-on-ai-routes) |
| 18 | Quest lab connect bounces with `?error=` | [Quest FHIR / lab-sync symptoms](#quest-fhir--lab-sync-symptoms) |
| 19 | Lab sync fails (`syncStatus: error`) | [Quest FHIR / lab-sync symptoms](#quest-fhir--lab-sync-symptoms) → [Sync fails / SSRF rejection / expired token](#sync-fails--ssrf-rejection--expired-token) |
| 20 | Onboarding wizard stuck | [Onboarding / plan-gating symptoms](#onboarding--plan-gating-symptoms) |
| 21 | Feature blocked: "not available on your current plan" | [Onboarding / plan-gating symptoms](#onboarding--plan-gating-symptoms) → [Plan-gating blocks a feature](#plan-gating-blocks-a-feature-unexpectedly) |
| 22 | PHI suspected in logs | [API / 500 symptoms](#api--500-symptoms) → [PHI leaking into logs](#phi-leaking-into-logs) |
| 23 | Opaque 500 / `INTERNAL_ERROR` | [API / 500 symptoms](#api--500-symptoms) |
| — | Quick diagnostic commands | [Quick diagnostic commands](#quick-diagnostic-commands) |

---

## Decision trees

### Stuck-on-login decision tree

```
User reports "I can't get past the login screen"
        │
        ▼
  Network tab shows 401 on /auth/me (getCurrentUser) ?
     ├── yes ──▶ Did /auth/refresh run FIRST and succeed (200)?
     │                 ├── no  ──▶ refresh failed/absent → see "Stuck on login / 401 loop"
     │                 │             ├─ 401 on /auth/refresh → refresh token invalid/expired OR
     │                 │             │   JWT secret rotated → re-login (RUNBOOK.md key-rotation)
     │                 │             └─ 429 on /auth/refresh → rate-limited → hard-logout is by design
     │                 └── yes ──▶ /auth/me still 401 after refresh → AuthContext ordering / token not in cookie
     └── no  ──▶ UI redirect loop, dashboard renders empty → see "Data disappears after page refresh"
```

### Data-disappears-on-refresh decision tree

```
After F5, dashboard is empty and user looks logged out
        │
        ▼
  Network shows /auth/refresh BEFORE /auth/me ?
     ├── no  ──▶ ordering regression — refresh MUST precede getCurrentUser
     │            (AuthContext.tsx:104-119). This was the original bug.
     └── yes ──▶ /auth/refresh 200 but /auth/me 401 ?
                    ├── yes ──▶ access-token cookie not written (SameSite/domain) →
                    │            see "Cookies not set (SameSite / domain)"
                    └── no  ──▶ both 200, list empty ──▶ RLS context lost →
                                 see "RLS mystery (fewer rows than expected)"
```

### Upload-500 / empty-extraction decision tree

```
POST /upload/lab-report or /upload/lab-results-ocr fails
        │
        ▼
  HTTP status?
   ├── 413 FILE_TOO_LARGE ──▶ >10MB. Reduce file. (errorHandler.ts:171)
   ├── 422 VALIDATION_ERROR ──▶ wrong type / magic-byte mismatch / 0 biomarkers
   │        ├─ "does not match its declared type" → magic bytes (shared.ts:90)
   │        ├─ "Only PDF files are accepted"      → wrong mimetype (shared.ts:133)
   │        └─ "Could not extract any biomarkers" → extraction ran, found 0
   │                                                 (labUploadController.ts:61,221)
   ├── 503 SERVICE_UNAVAILABLE ──▶ BAA gate (ANTHROPIC_BAA_ACTIVE / GOOGLE_BAA_ACTIVE)
   └── 500 INTERNAL_ERROR ──▶ Claude/Document-AI threw. Check ANTHROPIC_API_KEY,
                               GCP_PROCESSOR_ID, provider status (ocrService / claudeExtraction)
```

### RLS-mystery decision tree

```
A query returns 0 rows (or a 404) for data that exists in the DB
        │
        ▼
  Is the query inside withRLSContext / withRLSTransaction ?
     ├── no  ──▶ a bare prisma.* call sees RLS-as-NULL → no rows.
     │            Wrap it (database.ts:14-31 footgun banner).
     └── yes ──▶ Does the callback use `tx.*` (NOT module-level `prisma.*`) ?
                    ├── no  ──▶ prisma.* inside the callback runs on a DIFFERENT
                    │            pooled connection without SET LOCAL → bypass/empties
                    │            (database.ts:368-377, 439-442)
                    └── yes ──▶ Is the row owned by a DIFFERENT user ?
                                 ├── yes ──▶ RLS correctly hides it → 404 by design
                                 │            (fhirController.ts:152-159)
                                 └── no  ──▶ DB role has BYPASSRLS off but policy gap;
                                              confirm with the psql check below
```

---

## Auth symptoms

### Stuck on login / 401 loop

**Symptom**: login appears to succeed (or the page reloads) but the user is bounced back to `/login`; the network tab shows a burst of `401`s, sometimes thousands.

**Root cause**: the fetch wrapper auto-retries a `401` exactly once through `/auth/refresh`. A real loop means either (a) a caller re-issues the request without the one-shot `isRetry` flag, or (b) the refresh token itself is terminally invalid (expired, revoked, or signed with a rotated `JWT_REFRESH_SECRET`). `/auth/refresh` and `/auth/logout` are deliberately exempt from the 401-retry path to break recursion — without that exemption the loop "produced 10,000+ 401s in dev".

```ts
// Source: src/services/api/client.ts:242-248
const isAuthMgmtEndpoint = endpoint === '/auth/refresh' || endpoint === '/auth/logout';
```

```ts
// Source: src/services/api/client.ts:303-311
if (response.status === 401 && !isRetry && !isAuthMgmtEndpoint) {
  const refreshed = await attemptTokenRefresh();
  if (refreshed) {
    return apiFetch<T>(endpoint, options, timeoutMs, true);
  }
  if (onAuthFailureCallback) {
    onAuthFailureCallback();
  }
}
```

**Workaround**: log out fully (clears the in-memory token and cookies via `logout()` → `clearAuthToken()`, `AuthContext.tsx:179-187`) and log back in.

**Fix / triage order**:
1. Confirm one-shot: a true loop implies a caller bypassing `isRetry`. The guard is `!isRetry` (`client.ts:303`); the recursive retry passes `isRetry = true` (`client.ts:306`).
2. **JWT secret rotation**: if a deploy changed `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (`backend/src/config/index.ts:61,65`), every existing session is invalid and `/auth/refresh` returns `401` → clean hard-logout. Expected; users just re-login. See [`RUNBOOK.md`](./RUNBOOK.md).
3. **TTL misconfig**: `JWT_ACCESS_EXPIRES_SECONDS` (default 900) / `JWT_REFRESH_EXPIRES_SECONDS` (default 604800) at `config/index.ts:62,66`. A tiny refresh TTL causes constant re-login.

**Files**: `src/services/api/client.ts:242-248,303-311`; `src/contexts/AuthContext.tsx:179-187`; `backend/src/config/index.ts:61-66`.

**Cross-link**: [`ERROR_RECOVERY.md#unauthorized-http-401`](./ERROR_RECOVERY.md) (Playbook A — 401 loop).

---

### Data disappears after page refresh

**Symptom**: the user sees biomarkers right after login, but after a hard refresh the dashboard is empty and the app renders as logged-out.

**Root cause**: on mount, `AuthContext` must call `refreshToken()` **before** `getCurrentUser()`. The access-token cookie expires after 15 min but the refresh-token cookie lasts 7 days; calling `getCurrentUser()` first with an expired access token returns `401` and the app renders logged-out before the refresh completes. The fix enforces the ordering with an explicit comment block.

```ts
// Source: src/contexts/AuthContext.tsx:104-119
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

**Workaround**: hard refresh again (an in-flight refresh completes before the 2nd mount).

**Fix**: keep `await authApi.refreshToken()` ahead of `authApi.getCurrentUser()` in the mount effect (`AuthContext.tsx:105,119`). If both calls 200 but the list is still empty, the symptom is actually an [RLS mystery](#rls-mystery-fewer-rows-than-expected), not auth.

**Files**: `src/contexts/AuthContext.tsx:93-131`.

**Cross-link**: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (auth flow), [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (`UNAUTHORIZED`).

---

### Logged out after 15 minutes idle

**Symptom**: a user complains they were signed out and redirected to `/?sessionExpired=true` while the tab was open but unattended; a 2-minute warning dialog appeared first.

**Root cause**: this is **intended HIPAA §164.312(a)(2)(iii) auto-logoff**, not a bug. After 15 min with no `mousedown`/`keydown`/`touchstart`/`scroll`, the session ends. Mouse *move* is deliberately excluded so a wandering cursor on a second monitor cannot keep the session alive.

```ts
// Source: src/contexts/AuthContext.tsx:40-42
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const INACTIVITY_WARNING_MS = 13 * 60 * 1000; // 2 minutes before logout
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;
```

**Workaround / fix**: click "Stay signed in" on the warning dialog (`resetIdleTimers`, `AuthContext.tsx:293`). There is no env var to extend the window — it is a hard-coded compliance control. Changing it means editing `INACTIVITY_TIMEOUT_MS`.

**Files**: `src/contexts/AuthContext.tsx:40-42,192-204,210-231`.

---

### Login page fetch storm

**Symptom**: the login page issues a flood of requests and the user gets `429`s before they can sign in.

**Root cause**: historic bug (`862a300 fix(frontend): stop login-page fetch storm + add 429 backoff`, 2026-04-25). The current client backs off exponentially on `429` for non-auth-management routes (1 s, 2 s, 4 s ± 25 % jitter, up to 3 retries), preferring the `Retry-After` header.

```ts
// Source: src/services/api/client.ts:267-277
if (
  response.status === 429 &&
  !isAuthMgmtEndpoint &&
  !isRetry &&
  retryCount429 < MAX_RETRY_429
) {
  const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
  const delay = retryAfterMs ?? backoffDelayMs(retryCount429 + 1);
  await sleep(delay);
  return apiFetch<T>(endpoint, options, timeoutMs, isRetry, retryCount429 + 1);
}
```

**Fix**: if a storm recurs, look for a caller that loops `apiFetch` without awaiting, or a `429` on an auth-management endpoint (those are exempt from backoff and hard-logout instead, by design — `client.ts:159-166`).

**Files**: `src/services/api/client.ts:185-206,267-277`. Login rate limit is `strictAuthLimiter` keyed by `email:ip` (15 min) — see [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (`LOGIN_RATE_LIMIT_EXCEEDED`).

---

## CSRF symptoms

### Mutation rejected with "CSRF token missing" / "Invalid CSRF token"

**Symptom**: any `POST`/`PUT`/`PATCH`/`DELETE` returns `403 FORBIDDEN` with message "CSRF token missing" or "Invalid CSRF token".

**Root cause**: this API uses a **double-submit cookie**. The server reads the `csrf_token` cookie and the `x-csrf-token` header, hashes both with SHA-256, and compares them in constant time. "Missing" means one side is absent; "Invalid" means they don't match (usually a stale cookie).

```ts
// Source: backend/src/middleware/csrf.ts:155-170
if (!cookieToken || !headerToken) {
  throw new ForbiddenError('CSRF token missing');
}
const cookieDigest = crypto.createHash('sha256').update(cookieToken).digest();
const headerDigest = crypto.createHash('sha256').update(headerToken).digest();
const tokensMatch = crypto.timingSafeEqual(cookieDigest, headerDigest);
if (!tokensMatch) {
  throw new ForbiddenError('Invalid CSRF token');
}
```

**Workaround**: do a `GET` to any route first (this re-issues the cookie via `ensureCsrfToken`, `csrf.ts:66-76`), then resubmit.

**Fix**: the frontend auto-attaches the header on every mutation by reading the cookie (`client.ts:228-238`, `getCsrfToken` at `client.ts:120-135`). If a custom call bypasses `apiFetch`, attach `x-csrf-token` yourself. **There is NO server-side CSRF secret** — do not look for a `CSRF_SECRET` env var.

**CSRF-exempt routes** (these never throw a CSRF 403): the public auth routes (`/auth/login`, `/auth/register`, `/auth/demo`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`), `/marketplace/plans/search`, the bearer-only SSE `/ai/chat`, and `/internal/audit-cleanup` (`csrf.ts:98-139`). Upload routes are **no longer** exempt — the frontend pipes the token through `services/uploadUtils.ts`, so a new upload path that forgets it fails closed (`csrf.ts:120-125`).

**Files**: `backend/src/middleware/csrf.ts:86-172`; `src/services/api/client.ts:120-135,228-238`.

**Cross-link**: [`ERROR_RECOVERY.md#forbidden-http-403`](./ERROR_RECOVERY.md), [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) (CSRF-exemption list).

---

## Database symptoms

### RLS mystery (fewer rows than expected)

**Symptom**: a query returns 0 rows, or noticeably fewer than the table contains, or a `findFirst`/`findUnique` returns `null` (which controllers convert to a `404`) for a row you can see in `psql` as a superuser.

**Root cause**: Row-Level Security scopes every query to `app.current_user_id`, which is set with `SET LOCAL` inside `withRLSContext` / `withRLSTransaction`. Two failure modes:
1. The query ran **outside** an RLS wrapper — RLS evaluates `app.current_user_id` as NULL → no rows.
2. The query is **inside** a wrapper but a call went through the module-level `prisma` singleton instead of the transaction client `tx`. That call uses a *different* pooled connection that never received the `SET LOCAL`, so it silently bypasses RLS (and may return all rows or none, depending on the policy). This is the headline footgun.

```ts
// Source: backend/src/services/database.ts:368-377
async function applyRLSContext(
  tx: Prisma.TransactionClient,
  userId: string | null,
  isAdmin: boolean
): Promise<void> {
  const userIdValue = userId ?? '';
  const isAdminValue = isAdmin ? 'true' : 'false';
  await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userIdValue}, true)`;
  await tx.$executeRaw`SELECT set_config('app.is_admin', ${isAdminValue}, true)`;
}
```

**How to confirm it's RLS and not a real-empty table** — connect as a superuser and read the row directly, then check the DB role's BYPASSRLS flag (the server hard-exits in production if the role has BYPASSRLS, `database.ts:248-255`):

```sql
-- Source: backend/src/services/database.ts:228-230 (the same check the server runs at boot)
SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Then reproduce the app's scoping manually:
BEGIN;
SELECT set_config('app.current_user_id', '<the-user-uuid>', true);
SELECT count(*) FROM biomarkers;   -- should match what the app sees
ROLLBACK;
```

**Workaround**: none at runtime — this is a correctness control.

**Fix**: inside any RLS callback, use `tx.*`, never `prisma.*` or `getPrismaClient().*`. The CI guard `scripts/check-rls-wrappers.sh` fails the build on `prisma.` calls in controllers/services (`database.ts:26-30`). A 404 on a row owned by a *different* user is correct behavior (anti-enumeration), not a bug (`fhirController.ts:152-159`).

**Files**: `backend/src/services/database.ts:14-31,368-377,424-445`; `backend/CLAUDE.md` RLS section.

**Cross-link**: [`DATA_MODEL.md`](./DATA_MODEL.md) (RLS policies), [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (RLS masking as 404), [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

### Connection pool exhaustion

**Symptom**: requests hang or fail under burst load with Prisma "Timed out fetching a new connection from the connection pool" / "all connections busy".

**Root cause**: the `pg` pool defaults to `max: 10`. RLS wrappers each open a transaction; long-running transactions or a burst can exhaust the pool. Cold starts on Cloud SQL via the Auth Proxy also need generous timeouts.

```ts
// Source: backend/src/services/database.ts:108-114
pool = new Pool({
  connectionString,
  max: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000, // 30s for Cloud SQL Auth Proxy
  statement_timeout: 30000, // 30s statement timeout
});
```

**Workaround**: tune `DATABASE_POOL_SIZE` up for the affected env. The default was raised from 5 to 10 because `max: 5` "was hitting 'all connections busy' under burst load" (`database.ts:99-107`).

**Fix**: keep RLS callbacks short — the wrapper sets `maxWait: 20_000` / `timeout: 30_000` for `withRLSContext` (`database.ts:452-455`). Avoid doing slow work (decrypt loops, external API calls) inside the transaction; note `52507c3 fix(ai-chat): move decryption out of withRLSContext transaction` did exactly this.

**Files**: `backend/src/services/database.ts:99-114,447-456`.

**Cross-link**: [`RUNBOOK.md`](./RUNBOOK.md), [`ENV_VARS.md`](./ENV_VARS.md) (`DATABASE_POOL_SIZE`).

---

### Server refuses to start (FATAL boot)

**Symptom**: the backend exits immediately on boot with a `FATAL: Cannot start server` message, or `process.exit(1)`, or a thrown config error.

**Root cause**: startup is **fail-closed** by design for a HIPAA app. Common trips, by message:

| Boot error message (substring) | Cause | Fix | Source |
|---|---|---|---|
| `Missing required environment variable: JWT_ACCESS_SECRET` | secret unset | set it (`openssl rand -base64 32`) | `config/index.ts:18-28,61` |
| `JWT_ACCESS_SECRET must be at least 32 characters` | secret too short | regenerate | `config/index.ts:263-270` |
| `AUDIT_LOG_SALT must be set and at least 16 characters` | salt unset/short | set it; **never rotate** (breaks audit decrypt) | `config/index.ts:283-293` |
| `ANTHROPIC_BAA_ACTIVE must be set to "true" in production` | API key set, BAA flag unset, prod | set `ANTHROPIC_BAA_ACTIVE=true` or unset the key | `config/index.ts:300-306` |
| `GOOGLE_BAA_ACTIVE must be set to "true" in production` | `GCP_PROCESSOR_ID` set, flag unset, prod | set `GOOGLE_BAA_ACTIVE=true` or unset processor | `config/index.ts:320-326` |
| `PHI_ENCRYPTION_KEY must be at least 64 hex characters` | bad/placeholder key | regenerate (`openssl rand -hex 32`) | `config/index.ts:355-383` |
| `CORS_ORIGIN must be set in production` | unset in prod | set it (no localhost) | `backend/src/app.ts:83-89` |
| `DEMO_ACCOUNT_ENABLED cannot be true in production` | demo on in prod | set `DEMO_ACCOUNT_ENABLED=false` | `config/index.ts:408-414` |
| `SENDGRID_SANDBOX_MODE cannot be true in production` | sandbox in prod (silently drops email) | remove it | `config/index.ts:421-427` |
| `FATAL: ... database connection` | DB unreachable | check `DATABASE_URL` / Cloud SQL proxy | `database.ts:163-170` |
| `FATAL: Production database role has BYPASSRLS` | role can bypass RLS in prod | rotate to `omh_app` (NOBYPASSRLS) | `database.ts:248-255` |

```ts
// Source: backend/src/services/database.ts:248-255
if (config.isProduction) {
  logger.error(
    'FATAL: Production database role has BYPASSRLS. ' +
    'RLS policies are not enforcing. Refusing to start. ' +
    'See C8_PART3_RUNBOOK.md.'
  );
  process.exit(1);
}
```

**Workaround**: in dev/staging, a `BYPASSRLS` role only logs a WARNING and continues (`database.ts:257-260`); the AI/Document-AI BAA gates only `process.stderr.write` a warning (`config/index.ts:307-312,327-332`). Production is hard-fail for all of the above.

**Files**: `backend/src/config/index.ts:235-440`; `backend/src/services/database.ts:128-261`.

**Cross-link**: [`ENV_VARS.md`](./ENV_VARS.md), [`RUNBOOK.md`](./RUNBOOK.md).

---

## Deployment symptoms

### Env-var change has no effect (Cloud Run pinning)

**Symptom**: you ran `gcloud run services update --update-env-vars=FOO=bar`, it reported success, but the running service behaves as if the change never happened (e.g. the 2026-04-17 `ANTHROPIC_BAA_ACTIVE=true` flip had zero effect).

**Root cause**: the deploy pipeline promotes traffic with an **explicit revision pin** (`--to-revisions=$NEW_REV=100`, `.github/workflows/deploy.yml:168-171`), not `--to-latest`. A later `gcloud run services update` creates a *new* revision but leaves it at **0% traffic** — the old pinned revision keeps serving. This is intentional (it forces every prod traffic shift through a smoke-tested promotion, `deploy.yml:141-148`) but it traps ad-hoc env edits.

**Detection** — `latestReadyRevisionName` ≠ `latestCreatedRevisionName` is the signal:

```bash
gcloud run services describe ownmyhealth-backend --region=us-central1 \
  --project=ownmyhealth-prod \
  --format='value(status.latestReadyRevisionName,status.latestCreatedRevisionName)'
```

If those two differ, a silent pin is holding traffic back.

**Fix** — shift traffic to the new revision explicitly:

```bash
# Point traffic at the new revision that has your env change
gcloud run services update-traffic ownmyhealth-backend --region=us-central1 \
  --project=ownmyhealth-prod --to-revisions=<NEW_REVISION>=100

# Or drop the pin so future env updates auto-roll-out again
gcloud run services update-traffic ownmyhealth-backend --region=us-central1 \
  --project=ownmyhealth-prod --to-latest
```

**Files**: `.github/workflows/deploy.yml:141-171`; project memory `cloud-run-env-update-pinning.md` (2026-04-17 postmortem).

**Cross-link**: [`RUNBOOK.md`](./RUNBOOK.md) (env-flip playbook), [`ENV_VARS.md`](./ENV_VARS.md).

---

### Deploy fails at smoke-test

**Symptom**: the GitHub Actions `Deploy to Cloud Run` workflow fails in the `smoke-test` job; production was **not** changed (the new revision was staged at 0% traffic).

**Root cause**: the pipeline deploys to a tagged revision at `--no-traffic`, then probes `<staging_url>/api/v1/health` up to 6 times. If `/health` never returns `200` with `"success":true`, the promote job never runs. The most common cause is Cloud SQL connectivity on cold start (the failure mode behind the 2026-04-17 incident).

```yaml
# Source: .github/workflows/deploy.yml:122-138
for i in 1 2 3 4 5 6; do
  STATUS=$(curl -sS -o /tmp/body.json -w "%{http_code}" --max-time 30 "$URL" || echo "000")
  echo "  attempt $i: HTTP $STATUS"
  if [ "$STATUS" = "200" ]; then
    BODY=$(cat /tmp/body.json)
    if echo "$BODY" | grep -q '"success":true'; then
      echo "PASS"; echo "  body: $BODY"; exit 0
```

Note: the `/health` endpoint (`backend/src/app.ts:301-312`) returns `{ status, checks: { database } }` and is `200` only when the DB is connected; the smoke test hits `/api/v1/health` (`backend/src/routes/index.ts:42`).

**Workaround / fix**: re-run the workflow (absorbs cold-start). If it persistently fails, check Cloud SQL is up, the Auth Proxy/instance connection is correct, and `DATABASE_URL` is set on the new revision. Since traffic never shifted, no rollback is needed.

**Files**: `.github/workflows/deploy.yml:110-138`; `backend/src/app.ts:301-324`.

**Cross-link**: [`RUNBOOK.md`](./RUNBOOK.md) (deploy/rollback), [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md).

---

### Docker build / frontend deploy notes

- The backend image builds from `backend/Dockerfile` and is tagged `:${github.sha}` only — the `:latest` tag was dropped (`deploy.yml:55-68`).
- `--max-instances=3` bounds in-memory rate-limiter and AI-spend-accumulator dilution; raising it requires switching those stores to Redis first (`deploy.yml:78-89`; see `aiCostTracker.ts:29-38`).
- The frontend deploys via `gsutil rsync -d -r dist/` (no 404 window) with `Cache-Control:no-cache` on `index.html` (`deploy.yml:224-235`). A botched frontend deploy surfaces client-side as a [stale-chunk crash](#blank-page-or-stale-chunk-crash).

---

## Frontend symptoms

### Blank page or stale-chunk crash

**Symptom**: after a deploy lands while a user has the SPA open, the page goes blank or shows "A new version of OwnMyHealth is available." Console shows `Loading chunk … failed` / `Failed to fetch dynamically imported module`.

**Root cause**: the user's tab holds references to JS chunks that the new deploy replaced on the CDN. The `ErrorBoundary` detects chunk-load errors and renders a clean "reload" prompt instead of a generic crash (`3904c98 fix(frontend): recover gracefully from stale chunks after deploys`).

```ts
// Source: src/components/common/ErrorBoundary.tsx:43-51
function isChunkLoadError(error: Error | null): boolean {
  if (!error?.message) return false;
  const msg = error.message;
  return (
    msg.includes('dynamically imported module') ||
    msg.includes('Failed to fetch') ||
    msg.includes('Loading chunk')
  );
}
```

**Workaround / fix**: reload (the boundary's button calls `window.location.reload()`, `ErrorBoundary.tsx:81-84,131`). The deploy sets `Cache-Control:no-cache` on `index.html` so the next load picks up the new chunk manifest (`deploy.yml:235`). If a *true* blank page persists after reload (not a chunk error), check the browser console for an uncaught error before React mounts and confirm the API base URL (`VITE_API_URL`, `client.ts:10`).

**Files**: `src/components/common/ErrorBoundary.tsx:43-141`; `.github/workflows/deploy.yml:224-235`.

> **Note on "Next.js SWC ARM64" failures (project memory):** that incompatibility (`@next/swc-win32-arm64-msvc` not loading on Node 24 / Windows ARM64) belongs to the **HealthcareProviderDB** project, which uses Next.js. OwnMyHealth's frontend is **Vite + React** (`vite.config.ts:1-5`), not Next.js, so the SWC fallback patch does not apply here. If you hit native-binary load errors locally, see [`LOCAL_DEV.md`](./LOCAL_DEV.md). (Logged under [Prompt drift log](#prompt-drift-log).)

---

### CORS rejected origin

**Symptom**: browser requests fail with a CORS error; the backend log shows `CORS rejected origin`.

**Root cause**: the request's `Origin` is not in the computed allowlist. The allowlist always unions `CORS_ORIGIN` (comma-separated) with hardcoded production hosts, in *every* environment — because Cloud Run revisions have been observed running with `NODE_ENV=development`, which previously bypassed the union and broke the real frontend.

```ts
// Source: backend/src/app.ts:65-68
const HARDCODED_PRODUCTION_ORIGINS = [
  'https://app.ownmyhealth.io',
  'https://ownmyhealth.io',
];
```

```ts
// Source: backend/src/app.ts:157-164
const origins = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
if (origins.includes(origin)) {
  return callback(null, origin); // Return the specific origin, not true
}
logger.warn('CORS rejected origin', { data: { origin, allowedOrigins: origins } });
return callback(new Error(`CORS policy: Origin ${origin} not allowed`));
```

**Workaround / fix**: add the missing origin to `CORS_ORIGIN` (or to `HARDCODED_PRODUCTION_ORIGINS` for a new permanent frontend host). In production, `CORS_ORIGIN` is required and may not contain `localhost`/`127.0.0.1` or the server refuses to boot (`app.ts:83-89`). Preflight cache is 1 hour, so policy changes take up to an hour to propagate to loaded clients (`app.ts:176-178`).

**Files**: `backend/src/app.ts:61-107,148-179`.

**Cross-link**: [`ENV_VARS.md`](./ENV_VARS.md) (`CORS_ORIGIN`), [`RUNBOOK.md`](./RUNBOOK.md).

---

### Cookies not set (SameSite / domain)

**Symptom**: login succeeds (`200`) but the browser never stores the auth/CSRF cookies, so the very next request is `401`; common with a cross-domain setup (frontend on `app.ownmyhealth.io`, API on `api.ownmyhealth.io`).

**Root cause**: cookie attributes are derived from env. Cross-domain requires `SameSite=none` + `Secure=true` + a `Domain`. The history here is dense: `327b2f4 fix: CORS configuration for cross-domain cookies`, `50d7426 fix: add domain to all auth cookies`, `8db4317 fix: support cross-domain cookies for CSRF protection`.

```ts
// Source: backend/src/config/index.ts:86-88
sameSite: (process.env.COOKIE_SAME_SITE as 'strict' | 'lax' | 'none') ||
  (process.env.COOKIE_DOMAIN ? 'none' : (process.env.NODE_ENV === 'production' ? 'strict' : 'lax')),
domain: process.env.COOKIE_DOMAIN || undefined,
```

**Fix** — for cross-domain, set all three:
- `COOKIE_DOMAIN=.ownmyhealth.io` (leading dot)
- `COOKIE_SAME_SITE=none`
- `NODE_ENV=production` (makes `Secure=true`, required when `SameSite=none`; `config/index.ts:75`).

Same-domain prod defaults to `strict` (tightened in the F-18 fix, `config/index.ts:84-87`); dev defaults to `lax`. Helmet's `crossOriginResourcePolicy` is auto-relaxed when `COOKIE_DOMAIN` is set (`app.ts:124,140`).

**Files**: `backend/src/config/index.ts:69-93`; `backend/src/middleware/csrf.ts:32-58`; `backend/src/app.ts:124,140`.

**Cross-link**: [`ENV_VARS.md`](./ENV_VARS.md) (`COOKIE_DOMAIN`, `COOKIE_SAME_SITE`), [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## API / 500 symptoms

### Opaque 500 / `INTERNAL_ERROR`

**Symptom**: an endpoint returns `500` with the generic body "An unexpected error occurred. Please try again later." and no detail.

**Root cause**: in production the error handler **sanitizes** all non-`AppError` messages to a generic string and strips stack traces; the real message is only in the server logs and only stack-traced in dev.

```ts
// Source: backend/src/middleware/errorHandler.ts:190-196
if (statusCode >= 500) {
  logger.error(`${err.name}: ${err.message}`, logData);
} else if (config.isDevelopment) {
  logger.warn(`${err.name}: ${err.message}`, logData);
}
```

**Fix**: read the Cloud Run logs (the handler always logs `≥500`). Common sources that degrade to `INTERNAL_ERROR`: external services (Anthropic/Document AI/SendGrid throw plain `Error`, not `AppError`), `storageService` write/delete (`storageService.ts` throws plain `Error`), and **decrypt failures** from a rotated `PHI_ENCRYPTION_KEY` (there is no `DECRYPTION_FAILED` code — it surfaces as `INTERNAL_ERROR` or, in the AI-chat path, `CONTEXT_ASSEMBLY_FAILED`).

**Files**: `backend/src/middleware/errorHandler.ts:104-211`.

**Cross-link**: [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (`INTERNAL_ERROR`, key-rotation §10), [`RUNBOOK.md`](./RUNBOOK.md).

---

### PHI leaking into logs

**Symptom**: you suspect a log line contains a patient name, value, token, or other PHI.

**Root cause / guard**: there are **two** redaction layers, used for different sinks. Confusing them is the usual mistake:

| Sink | Guard | What it does | Source |
|---|---|---|---|
| Application logs (stdout/stderr → Cloud Logging) | `logger.sanitizeData` | Redacts any field whose key is in `SENSITIVE_FIELDS` (recursive, walks arrays) | `backend/src/utils/logger.ts:21-56` |
| Text **sent to Claude** | `phiRedaction.redactPHI` / `stripPHIFromText` | Regex-scrubs SSN/MRN/NPI/DEA/phone/email/DOB/address/ZIP/name in extracted text | `backend/src/utils/phiRedaction.ts:14-110` |
| Image **bytes sent to Claude Vision** | `pdfRedaction.redactPatientBanner` | Covers the top 15% banner of every PDF page with an opaque white box | `backend/src/utils/pdfRedaction.ts:35-90` |

The logger's field redaction is the canonical answer for "PHI in a log line":

```ts
// Source: backend/src/utils/logger.ts:46-56
function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeValue(value);
    }
  }
  return sanitized;
}
```

**How to detect a leak**:
1. Confirm no raw `console.log` writes PHI. Grep `console\.log` over `backend/src` — every hit is inside `logger.ts` (the structured sink) or a comment in `pdfParser.ts` reminding *not* to use it. There are no PHI-bearing `console.log` calls in controllers/services.
2. Inspect log output for `[REDACTED]` on sensitive keys; a *missing* `[REDACTED]` where one is expected means a new PHI field needs adding to `SENSITIVE_FIELDS` (`logger.ts:21-30`).
3. `phiRedaction.redactPHI` returns `firedPatterns` so you can log *that* a pattern fired without logging the value (`phiRedaction.ts:97-110`).

**Fix**: add any new PHI-bearing key to `SENSITIVE_FIELDS`. The redactor walks nested arrays/objects (F-21 fix), so `biomarkers: [{ valueEncrypted }]` is covered (`logger.ts:38-44`). `redactPHI` is regex-based and explicitly "NOT a complete PHI oracle" — defense-in-depth, not the sole control (`phiRedaction.ts:1-12`).

**Files**: `backend/src/utils/logger.ts:21-56`; `backend/src/utils/phiRedaction.ts:14-110`; `backend/src/utils/pdfRedaction.ts:35-90`.

**Cross-link**: [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md), [`SECURITY_STATUS.md`](./SECURITY_STATUS.md), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).

---

## PDF / OCR / Claude extraction symptoms

### Upload returns 500 or "could not extract any biomarkers"

**Symptom**: `POST /api/v1/upload/lab-report` or `/upload/lab-results-ocr` fails. Two distinct cases: (a) `422 VALIDATION_ERROR` "Could not extract any biomarkers…", or (b) `500 INTERNAL_ERROR`.

**Root cause**:
- **(a) Zero biomarkers extracted** — extraction *ran* but found nothing usable (unreadable scan, non-lab document). The controller logs a `PARSE_FAILED`/`OCR_PARSE_FAILED` audit row and throws a `ValidationError`.
- **(b) Extraction threw** — Claude or Google Document AI errored (bad/missing API key, provider outage, malformed PDF). Plain errors degrade to `500 INTERNAL_ERROR`.

```ts
// Source: backend/src/controllers/upload/labUploadController.ts:54-62
if (ocrResult.biomarkers.length === 0) {
  await auditService.logAccess(LAB_REPORT_RESOURCE, undefined, { req, userId }, {
    operation: 'PARSE_FAILED',
    filename: file.originalname,
    fileSize: file.size,
    reason: 'No biomarkers extracted',
  });
  throw new ValidationError('Could not extract any biomarkers from the PDF. Please ensure it is a valid lab report.');
}
```

**Workaround**: re-upload a clearer/native-text PDF; the OCR path (`/upload/lab-results-ocr`) accepts images and PDFs and runs Document AI, while `/upload/lab-report` uses Claude extraction (`labUploadController.ts:36,191`).

**Fix for (b)**:
1. Check `ANTHROPIC_API_KEY` + `ANTHROPIC_BAA_ACTIVE=true` (Claude path) and `GCP_PROJECT_ID` / `GCP_PROCESSOR_ID` + `GOOGLE_BAA_ACTIVE=true` (OCR path). A configured-but-no-BAA processor surfaces as `503` (BAA gate), not `500`.
2. Note: SBC extraction falls back to a regex parser if Claude is unavailable (`shared.ts:324-457`), so SBC upload rarely hard-500s; lab extraction does not have a regex fallback.
3. GCS persistence failure is **non-fatal** — biomarkers are still created; only the `UserFile` record is skipped and an error is logged (`labUploadController.ts:68-83`).

**Files**: `backend/src/controllers/upload/labUploadController.ts:36-184,191-358`; `backend/src/controllers/upload/shared.ts:324-457`.

**Cross-link**: [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (Playbook C — uploads), [`API_REFERENCE.md`](./API_REFERENCE.md) (upload contracts).

---

### Upload rejected before extraction

**Symptom**: upload fails fast with `413 FILE_TOO_LARGE`, or `422` "File content does not match its declared type" / "Only PDF files are accepted" / "File size must be less than 10MB".

**Root cause**: pre-extraction validation. The 10 MB cap is enforced by Multer (→ `413`) and re-checked in `validateUploadFile` (→ `422`). Magic-byte validation rejects a spoofed `Content-Type` (Multer's `fileFilter` only trusts the header, which is attacker-controlled).

```ts
// Source: backend/src/controllers/upload/shared.ts:83-92
function validateMagicBytes(buffer: Buffer, mimetype: string): void {
  const expected = MAGIC_BYTES[mimetype];
  if (!expected) return; // No check for mimetypes not in the map
  const matches = expected.some((magic) =>
    buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic)
  );
  if (!matches) {
    throw new ValidationError('File content does not match its declared type');
  }
}
```

**Fix**: send a real PDF/PNG/JPEG/TIFF/GIF/WebP under 10 MB with a matching `Content-Type`. The 413 comes from `errorHandler.ts:171`; the 422s from `shared.ts:90,133,138`. PDF uploads also pass a header/version "PDF-bomb" check (`validatePdfHeader`, `labUploadController.ts:44,201`).

**Files**: `backend/src/controllers/upload/shared.ts:55-150`; `backend/src/middleware/errorHandler.ts:165-174`.

---

## AI chat / spend-cap symptoms

### "AI features are temporarily unavailable" (503)

**Symptom**: an AI route returns `503 SERVICE_UNAVAILABLE` with "AI features are temporarily unavailable (daily budget reached). Please try again later." or "You've reached today's AI usage limit. Please try again tomorrow."

**Root cause**: the **dollar** circuit breaker `aiSpendGuard` tripped. A rolling per-UTC-day spend accumulator (in `aiCostTracker`) hit either the global or per-user budget. This is a 503, **not** a 429 — it is distinct from request-count rate limiting.

```ts
// Source: backend/src/middleware/aiSpendGuard.ts:41-47
next(
  new ServiceUnavailableError(
    scope === 'global'
      ? 'AI features are temporarily unavailable (daily budget reached). Please try again later.'
      : "You've reached today's AI usage limit. Please try again tomorrow."
  )
);
```

```ts
// Source: backend/src/services/aiCostTracker.ts:69-78
export function isAISpendExceeded(userId: string): { exceeded: boolean; scope: 'global' | 'user' | null } {
  rollIfNewDay();
  if (config.ai.dailyBudgetUsd > 0 && globalSpentUsd >= config.ai.dailyBudgetUsd) {
    return { exceeded: true, scope: 'global' };
  }
  if (config.ai.userDailyBudgetUsd > 0 && (userSpentUsd.get(userId) ?? 0) >= config.ai.userDailyBudgetUsd) {
    return { exceeded: true, scope: 'user' };
  }
  return { exceeded: false, scope: null };
}
```

**Which env var**:
- "daily budget reached" (global scope) → `AI_DAILY_BUDGET_USD` (default 50, `config/index.ts:196`).
- "today's AI usage limit" (per-user scope) → `AI_USER_DAILY_BUDGET_USD` (default 5, `config/index.ts:197`).
- A budget of `0` **disables** that scope (`aiCostTracker.ts:71,74`).

**Workaround**: the accumulator resets at UTC midnight (`rollIfNewDay`, `aiCostTracker.ts:47-54`). Raising the env var takes effect on a new revision (watch the [Cloud Run pinning](#env-var-change-has-no-effect-cloud-run-pinning) trap).

**Caveat**: the accumulator is **in-memory and per-instance**, so under Cloud Run autoscale the effective ceiling is N×budget (bounded by `--max-instances=3`, `deploy.yml:88`). Move to Memorystore/Redis for multi-instance precision (`aiCostTracker.ts:29-38`).

**Distinct 503 — BAA gate, not budget**: if the message mentions `ANTHROPIC_BAA_ACTIVE` ("AI Health Guide is disabled…"), it's the BAA gate, not the spend cap — set `ANTHROPIC_BAA_ACTIVE=true` (`aiChatController.ts`, `biomarkerRoutes.ts`, `expenseController.ts`; see [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) §5).

**Files**: `backend/src/middleware/aiSpendGuard.ts:23-48`; `backend/src/services/aiCostTracker.ts:39-105`; `backend/src/config/index.ts:188-198`.

**Cross-link**: [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (Playbook B), [`ENV_VARS.md`](./ENV_VARS.md), [`RUNBOOK.md`](./RUNBOOK.md).

---

### 429 vs 503 on AI routes

**Symptom**: an AI route returns `429 AI_RATE_LIMIT_EXCEEDED` "Too many AI requests. Please try again later."

**Root cause**: this is the **request-count** limiter `aiLimiter` (10/hour per user), a different control from the dollar `aiSpendGuard` (503). Both are applied on AI routes.

```
AI request
   │
   ├── too many requests this hour? ──▶ 429 AI_RATE_LIMIT_EXCEEDED  (aiLimiter)
   │
   └── dollar budget exhausted today? ──▶ 503 SERVICE_UNAVAILABLE   (aiSpendGuard)
```

**Tell them apart**: `429` = wait an hour (count-based); `503` "budget reached" = wait until UTC midnight or raise `AI_*_BUDGET_USD` (dollar-based). The guard runs *after* `authenticate` so the per-user budget can resolve; with no user it falls through (`aiSpendGuard.ts:24-28`).

**Files**: `backend/src/middleware/aiSpendGuard.ts:23-48`; rate limiter — see [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (`AI_RATE_LIMIT_EXCEEDED`).

---

## Quest FHIR / lab-sync symptoms

### Connect bounces back with `?error=`

**Symptom**: clicking "Connect Quest" either returns `503` immediately, or redirects the user back to the settings page with `?error=connection_failed` (or `?error=<provider-error>`) instead of `?labConnected=quest`.

**Root cause**:
- `503 SERVICE_UNAVAILABLE` "Quest FHIR integration is not configured…" — `QUEST_FHIR_CLIENT_ID` is unset (`isFeatureConfigured()` checks `config.quest.clientId.length > 0`, `fhirController.ts:30-32,43-52`).
- `?error=connection_failed` — the OAuth **callback** failed (token exchange threw). The callback is a *redirect*, not a JSON error; the frontend reads `error=` off the URL.
- `?error=<provider error>` — the user denied consent or the provider returned an error (`fhirController.ts:80-84`).

```ts
// Source: backend/src/controllers/fhirController.ts:100-106
} catch (err) {
  logger.error('OAuth callback failed', {
    data: { error: err instanceof Error ? err.message : 'unknown' },
  });
  const sep = frontendBase.includes('?') ? '&' : '?';
  res.redirect(`${frontendBase}${sep}error=connection_failed`);
}
```

**Fix**: set the Quest env vars (`QUEST_FHIR_CLIENT_ID`, `QUEST_FHIR_CLIENT_SECRET`, `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`, optional `QUEST_FHIR_AUTH_HOSTS`; `config/index.ts:205-224`). For `connection_failed`, inspect the server log line "OAuth callback failed" — the cause is the token exchange (bad client secret, expired PKCE state "Invalid or expired OAuth state", or an SSRF rejection on the token URL). Quest is also **plan-gated** (`questFhirIntegration`, FREE=false) — a `403 PLAN_LIMIT_EXCEEDED` before the redirect means the user's plan lacks it (`92f4841 fix(fhir): enforce questFhirIntegration plan gating`; `config/plans.ts:28,57,76`).

**Files**: `backend/src/controllers/fhirController.ts:30-107`; `backend/src/services/fhir/labSyncService.ts:117-129`; `backend/src/config/index.ts:200-224`.

**Cross-link**: [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (Playbook D), [`ENV_VARS.md`](./ENV_VARS.md).

---

### Sync fails / SSRF rejection / expired token

**Symptom**: `POST /api/v1/fhir/sync/:connectionId` returns `500 SYNC_FAILED`, or the connection's `syncStatus` becomes `error` with a `syncError` message.

**Root cause** — three distinct failure modes that all land in the catch block:

| `syncError` substring | Cause | How to tell / fix |
|---|---|---|
| `Access token expired and no refresh token available` | OAuth access token (`accessTokenEncrypted`) expired and no `refreshTokenEncrypted` to renew it | Re-connect (re-run OAuth) to get fresh tokens | 
| `... host "X" is not the trusted FHIR host ...` / `refusing cleartext http to public host` / `refusing non-HTTP(S) scheme` | **SSRF guard** rejected a server-supplied URL (pagination `link` or SMART endpoint) pointing off the allowlist or at a private/metadata host | A response tried to redirect credentials off-host — confirm `QUEST_FHIR_BASE_URL` / `QUEST_FHIR_AUTH_HOSTS` are correct; a genuine rejection is the guard working | 
| `Connection has no FHIR patient ID` / map/import errors | data-shape issues, unmapped LOINC codes | unmapped codes are imported as category "Other"; check the "unmapped LOINC codes" log line | 

The token-refresh-on-expiry logic distinguishes the expired-token case:

```ts
// Source: backend/src/services/fhir/labSyncService.ts:221-227
if (
  connection.tokenExpiresAt &&
  connection.tokenExpiresAt.getTime() < Date.now() + 60_000
) {
  if (!refreshTokenPlain) {
    throw new Error('Access token expired and no refresh token available');
  }
```

The SSRF guard is the source of the host/scheme rejections:

```ts
// Source: backend/src/services/fhir/urlSafety.ts:82-89
if (!allowed.has(host)) {
  throw new Error(
    `${label}: host "${host}" is not the trusted FHIR host (${base.hostname}) or an allowed host`
  );
}
if (target.protocol === 'http:' && !isPrivateOrLoopbackHost(host)) {
  throw new Error(`${label}: refusing cleartext http to public host "${host}"`);
}
```

**How to distinguish an SSRF rejection from an expired token**: read `LabConnection.syncError` (persisted, truncated to 500 chars at `labSyncService.ts:366`) or the `SYNC_FAILED` audit row (`labSyncService.ts:369-374`). An *expired token* message says "Access token expired"; an *SSRF rejection* names a host/scheme and comes from `urlSafety.ts`. Tokens (`accessTokenEncrypted`/`refreshTokenEncrypted`) are PHI-grade — never logged in plaintext (`labSyncService.ts:213-216`, encrypted at `:142-143,230-233`).

**Workaround / fix**: for expired-token cases, disconnect and re-connect (`disconnectConnection` revokes best-effort then deletes, `labSyncService.ts:383-421`). For SSRF rejections, fix the host config — do not widen the allowlist to make an error go away.

**Files**: `backend/src/services/fhir/labSyncService.ts:184-377`; `backend/src/services/fhir/urlSafety.ts:56-91`.

**Cross-link**: [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (`SYNC_FAILED`, Playbook D), [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) (`LabConnection` token PHI), [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

---

## Onboarding / plan-gating symptoms

### Onboarding wizard stuck

**Symptom**: a new user can't advance past the onboarding wizard.

**Root cause**: the wizard lives at `src/components/onboarding/OnboardingWizard.tsx`. If a step calls a backend endpoint that fails (e.g. health profile save blocked by plan gating, or a `401` because the access token wasn't refreshed), the wizard cannot progress.

**Workaround / fix**: check the network tab for a failing step request. Common culprits:
- `403 PLAN_LIMIT_EXCEEDED` on `healthProfile` — FREE plan has `healthProfile: false` (`config/plans.ts:54`), so saving a health profile during onboarding is gated. Upgrade or skip the profile step.
- `401` mid-wizard — the [data-disappears-on-refresh](#data-disappears-after-page-refresh) ordering issue; ensure the session was restored before the wizard mounted.

**Files**: `src/components/onboarding/OnboardingWizard.tsx`; `backend/src/config/plans.ts:46-58`.

**Cross-link**: [`FRONTEND_MAP.md`](./FRONTEND_MAP.md), [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

---

### Plan-gating blocks a feature unexpectedly

**Symptom**: a feature returns `403` with "This feature is not available on your current plan. Upgrade to access it." or "You've reached your plan limit (current/limit). Upgrade to continue.", even though the user *thinks* they're on a paid plan.

**Root cause**: plan is read **fresh from the DB under RLS** at request time, **not** from the JWT (which can be up to 15 min stale). An expired `planExpiresAt` downgrades to FREE at request time — paid plans actually expire now.

```ts
// Source: backend/src/middleware/planGating.ts:66-75
const userRow = await withRLSContext(userId, async (tx) => {
  return tx.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
});
effectivePlan = normalizePlan(userRow?.plan);
if (userRow?.planExpiresAt && userRow.planExpiresAt.getTime() < Date.now()) {
  effectivePlan = 'FREE';
}
```

**Per-tier limits** (relevant gates): FREE has `healthProfile: false`, `providerSharing: false`, `questFhirIntegration: false`, `aiChatsPerDay: 3`, `maxBiomarkers: 50`; PRO/TEAM unlock most (`-1` = unlimited). `dataExport: true` on **every** tier (HIPAA requires it).

```ts
// Source: backend/src/config/plans.ts:47-58 (FREE limits)
aiChatsPerDay: 3,
pdfUploadsPerMonth: 2,
maxBiomarkers: 50,
insurancePlans: 1,
aiGuidancePerDay: 5,
costAnalysisPerMonth: 1,
healthProfile: false,
providerSharing: false,
dataExport: true,            // HIPAA requires this regardless of plan
questFhirIntegration: false,
```

**Workaround / fix**: confirm the user's actual `plan` and `planExpiresAt` in the DB. Plans are assigned manually (admin panel or DB update) — there is no payment processing yet (`plans.ts:1-13`). The `403` body carries `limit`/`current`/`feature`/`upgradeRequired` so the frontend renders an upgrade CTA via `isPlanLimitError()` (`planGating.ts:90-104`; `client.ts:55-62`). If the DB read fails, the gate falls back to the (possibly stale) JWT plan rather than wedging (`planGating.ts:76-84`).

**Files**: `backend/src/middleware/planGating.ts:37-110`; `backend/src/config/plans.ts:40-98`; `src/services/api/client.ts:55-62`.

**Cross-link**: [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) (`PLAN_LIMIT_EXCEEDED`), [`API_REFERENCE.md`](./API_REFERENCE.md).

---

## Quick diagnostic commands

Backend health (no auth; `200` only when the DB is connected, `app.ts:301-312`):

```bash
# Production
curl -i https://api.ownmyhealth.io/api/v1/health
# Expected: HTTP/1.1 200 with body {"success":true, ...} (routes/index.ts:42)

# Docker/container probe (different path, returns {status, checks})
curl -i https://api.ownmyhealth.io/health
```

Last errors in Cloud Run (the handler always logs `≥500`, `errorHandler.ts:190-192`):

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="ownmyhealth-backend" AND severity>=ERROR' \
  --project=ownmyhealth-prod --limit=20 --freshness=1h --format=json
```

Filter for a specific symptom (logs are structured JSON with `message`/`service` fields, `logger.ts:88-104`):

```bash
# AI spend-cap trips
gcloud logging read \
  'resource.type="cloud_run_revision" AND jsonPayload.service="AISpendGuard"' \
  --project=ownmyhealth-prod --limit=20 --freshness=24h

# CORS rejections
gcloud logging read \
  'resource.type="cloud_run_revision" AND jsonPayload.message="CORS rejected origin"' \
  --project=ownmyhealth-prod --limit=20 --freshness=1h
```

Detect the Cloud Run pinning trap (see [§Deployment](#env-var-change-has-no-effect-cloud-run-pinning)):

```bash
gcloud run services describe ownmyhealth-backend --region=us-central1 \
  --project=ownmyhealth-prod \
  --format='value(status.latestReadyRevisionName,status.latestCreatedRevisionName)'
# If the two differ → a silent pin is holding traffic on the old revision.
```

Connect to Cloud SQL and reproduce an RLS-scoped query (the DB is `ownmyhealth` in Cloud SQL, `omh` for local dev per the prompt's note):

```bash
# Start the proxy, then connect
cloud-sql-proxy ownmyhealth-prod:us-central1:<instance-name>
psql -h 127.0.0.1 -U <user> -d ownmyhealth
```

```sql
-- Reproduce what the app sees for one user (mirrors withRLSContext)
BEGIN;
SELECT set_config('app.current_user_id', '<user-uuid>', true);
SELECT count(*) FROM biomarkers;
ROLLBACK;

-- Confirm the login role cannot bypass RLS (server boot-check, database.ts:228-230)
SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

---

## Acceptance questions (self-check)

1. **Canonical fix for "data disappears on refresh"?** Call `await authApi.refreshToken()` before `authApi.getCurrentUser()` in the mount effect (`src/contexts/AuthContext.tsx:104-119`). → [Data disappears after page refresh](#data-disappears-after-page-refresh).
2. **Decision tree for a stuck-on-login user?** → [Stuck-on-login decision tree](#stuck-on-login-decision-tree): check 401 on `/auth/me`, whether `/auth/refresh` ran first and succeeded, then secret-rotation vs ordering.
3. **Symptom that indicates Cloud Run env-update pinning, and the fix?** Env change reported success but had no effect; detect via `latestReadyRevisionName ≠ latestCreatedRevisionName`; fix with `update-traffic --to-revisions=NEW=100` (or `--to-latest`). → [Env-var change has no effect](#env-var-change-has-no-effect-cloud-run-pinning).
4. **What causes an RLS "mystery" and how to confirm?** A `prisma.*` call outside/inside-but-not-`tx` an RLS wrapper, or a row owned by another user; confirm by reproducing the `set_config('app.current_user_id', …)` query in psql and checking `rolbypassrls`. → [RLS mystery](#rls-mystery-fewer-rows-than-expected).
5. **How to detect PHI in logs, and which util guards it?** Look for missing `[REDACTED]` on sensitive keys; `logger.sanitizeData` (`utils/logger.ts:21-56`) guards log lines; `phiRedaction.ts` guards Claude text, `pdfRedaction.ts` guards Claude image bytes. → [PHI leaking into logs](#phi-leaking-into-logs).
6. **Most common cause of a blank page, and where fixed?** A stale-chunk crash after a deploy; handled by `ErrorBoundary.isChunkLoadError` → reload prompt (`ErrorBoundary.tsx:43-141`). → [Blank page or stale-chunk crash](#blank-page-or-stale-chunk-crash).
7. **Which past fix covers upload 500s, and the commit?** Multiple: the empty-extraction `ValidationError` path (`labUploadController.ts:54-62`); historically `e029127 fix: Reduce Claude API max_tokens to valid limit` and the SBC regex fallback. → [Upload returns 500](#upload-returns-500-or-could-not-extract-any-biomarkers).
8. **Quick curl to verify prod health?** `curl -i https://api.ownmyhealth.io/api/v1/health` (expects `200` + `"success":true`). → [Quick diagnostic commands](#quick-diagnostic-commands).
9. **Which failure matches "Next.js SWC ARM64" per memory?** None in *this* repo — OwnMyHealth is Vite, not Next.js; the SWC patch belongs to HealthcareProviderDB. → [Blank page or stale-chunk crash](#blank-page-or-stale-chunk-crash) note + [Prompt drift log](#prompt-drift-log).
10. **Where does the doc point for symptoms that map to a known `code`?** Every section cross-links to [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) by code (e.g. `FORBIDDEN`, `SYNC_FAILED`, `PLAN_LIMIT_EXCEEDED`, `SERVICE_UNAVAILABLE`).
11. **Symptom for the AI spend cap, and the env var/guard?** `503` "daily budget reached"/"today's AI usage limit" from `aiSpendGuard` (`aiSpendGuard.ts:41-47`); env vars `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD`. → [AI 503](#ai-features-are-temporarily-unavailable-503).
12. **What does a Quest `urlSafety` SSRF rejection look like vs an expired OAuth token?** SSRF rejection names a host/scheme ("host X is not the trusted FHIR host", `urlSafety.ts:82-89`); expired token says "Access token expired and no refresh token available" (`labSyncService.ts:221-227`). Distinguish via `LabConnection.syncError` / the `SYNC_FAILED` audit row. → [Sync fails / SSRF rejection / expired token](#sync-fails--ssrf-rejection--expired-token).

---

## Related Documents

- [ERROR_RECOVERY.md](./ERROR_RECOVERY.md) — error-code-first catalog; every symptom here cross-links to its `code` there.
- [RUNBOOK.md](./RUNBOOK.md) — operational playbooks (key rotation, BAA flip, Cloud Run pinning, rollback).
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — currently-open symptoms not yet fixed.
- [LOCAL_DEV.md](./LOCAL_DEV.md) — local-dev failure modes (Vite, DB, env setup).
- [ARCHITECTURE.md](./ARCHITECTURE.md) — auth, CSRF double-submit, and RLS enforcement flows that produce these symptoms.
- [ENV_VARS.md](./ENV_VARS.md) — every env var referenced in fixes (`AI_*_BUDGET_USD`, `COOKIE_*`, `CORS_ORIGIN`, `QUEST_FHIR_*`, `DATABASE_POOL_SIZE`).
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — encrypted fields touched by decrypt-failure 500s and Quest token PHI.
- [API_REFERENCE.md](./API_REFERENCE.md) — per-endpoint contracts (upload, AI, FHIR, plan gates).
- [DATA_MODEL.md](./DATA_MODEL.md) — RLS policies behind the "RLS mystery" symptom.
- [FRONTEND_MAP.md](./FRONTEND_MAP.md) — component map (onboarding wizard, error boundary, auth context).

---

## Prompt drift log

- **`./18-troubleshooting-doc.md` lists "Next.js SWC on ARM64 per memory" as a frontend symptom.** OwnMyHealth's frontend is **Vite + React** (`vite.config.ts:1-5`), not Next.js — there is no `next` dependency, no `@next/swc-*` binary, and no `patch-next-swc.js`. The SWC-ARM64 memory note applies to the separate **HealthcareProviderDB** project. Captured as a "does not apply here" note under [Blank page or stale-chunk crash](#blank-page-or-stale-chunk-crash) rather than fabricating a non-existent failure mode. Prompt author should scope that bullet to Next.js projects only.
- **Spec template references commit `195ccc1` (AuthContext ordering) and `50d7426` (regression test).** `195ccc1` is real and accurate — `Fix auth token restoration order on page refresh` (2026-01-10), matching the refresh-before-getCurrentUser "CRITICAL FIX" still in `AuthContext.tsx:96-119`. However `50d7426` is **not** the regression test — it is `fix: add domain to all auth cookies for cross-domain support` (2026-01-08), a cross-domain cookie fix. The doc cites the live code (the authoritative source) and uses `50d7426` only where it actually applies (cross-domain cookies). Prompt author should drop or re-point the `50d7426` regression-test reference.
- **Spec assumes `ERROR_RECOVERY.md` anchors like `#unauthenticated`.** The actual sibling uses `#unauthorized-http-401` and similar; links here point at the doc generally and to verified section names where known.
