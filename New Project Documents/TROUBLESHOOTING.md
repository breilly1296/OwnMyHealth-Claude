# TROUBLESHOOTING.md — Symptom-First Catalog

> Generated from live code at HEAD `fb2cd32` (2026-06-15). Every non-trivial claim cites `file:line`. See the [Prompt drift log](#prompt-drift-log) at the end for places the generating prompt disagreed with the code.

---

## How to use this doc

This is the **symptom-first** catalog: you observe behavior X (a 401 loop, an empty dashboard, a red deploy), and this doc routes you to the right file, log filter, and fix in under a minute. It is the counterpart of [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md), which is organized by error **code** (the `code` value in the JSON error envelope). When you have a `code` already, go to `ERROR_RECOVERY.md`; when you only have a **behavior**, start here, find the symptom, then follow the cross-link into `ERROR_RECOVERY.md` for the per-code recovery steps.

The error envelope every backend error produces is fixed by `errorHandler` (`backend/src/middleware/errorHandler.ts:199-208`):

```ts
// Source: backend/src/middleware/errorHandler.ts:199-208
const response: ApiResponse = {
  success: false,
  error: {
    code,
    message,
    ...(details ? { details } : {}),
    ...(config.isDevelopment ? { stack: err.stack } : {}),
  },
};
res.status(statusCode).json(response);
```

`code` is the join key between this doc and `ERROR_RECOVERY.md`. The `AppError` subclasses that mint each `code`/`statusCode` pair live at `errorHandler.ts:29-102`.

---

## Symptom index

| Symptom | Anchor |
|---|---|
| Stuck on login / 401 loop | [Login fails / 401 loop](#decision-tree-login-fails--401-loop) |
| Data disappears after page refresh | [Data disappears on refresh](#data-disappears-after-page-refresh) |
| A previously-working token suddenly 401s | [Access token suddenly rejected (cross-instance revocation)](#access-token-suddenly-rejected-cross-instance-revocation) |
| Idle for ~15 min, bounced to login | [Idle auto-logoff](#idle-auto-logoff-hipaa-§164312a2iii) |
| Mutation returns 403 `CSRF_TOKEN_*` | [CSRF symptoms](#csrf-symptoms) |
| Upload returns 500 / extraction empty | [Upload 500 / empty extraction](#decision-tree-upload-500--empty-extraction) |
| Query returns fewer rows than expected | [RLS mystery](#decision-tree-rls-mystery-fewer-rows-than-expected) |
| Service won't boot (RLS invariant) | [Boot aborts: FORCE-RLS assertion failed](#boot-aborts-force-rls-assertion-failed) |
| Deploy red at the migrate step | [Deploy red at the migrate-job step](#deploy-red-at-the-migrate-job-step) |
| New env var didn't take effect | [Cloud Run env update held at 0% traffic](#cloud-run-env-update-held-at-0-traffic-pinning-gotcha) |
| Blank page on frontend | [Blank page on frontend](#blank-page-on-frontend) |
| CORS error in console | [CORS rejection](#cors-rejection) |
| Next.js SWC "not a valid Win32 application" | [Next.js SWC ARM64 incompat](#nextjs-swc-arm64-incompatibility-project-memory) |
| 503 "AI features temporarily unavailable" | [AI spend cap hit (503)](#ai-spend-cap-hit-503-service_unavailable) |
| 429 on AI routes | [AI rate-limited (429)](#ai-rate-limited-429) |
| 403 `PLAN_LIMIT_EXCEEDED` | [Plan limit blocks a feature](#plan-limit-blocks-a-feature-403) |
| Quest lab connect fails / SSRF reject | [Quest FHIR / lab-sync symptoms](#quest-fhir--lab-sync-symptoms) |
| Generic 500 `INTERNAL_ERROR` | [Generic 500](#generic-500--unexpected-error) |

---

## Decision tree: Login fails / 401 loop

```
User reports "I'm stuck on login"
        │
        ▼
  Network tab shows 401?
   ├── yes ──▶ CSRF cookie (csrf_token) + X-CSRF-Token header matching?
   │                ├── no  ──▶ re-read cookie; see "CSRF symptoms"
   │                └── yes ──▶ refresh cookie (refresh_token) present?
   │                                ├── no  ──▶ re-login (no session)
   │                                └── yes ──▶ POST /auth/refresh succeeds?
   │                                                ├── no (401) ──▶ token revoked cross-instance?
   │                                                │                 (users.tokens_valid_after cutoff
   │                                                │                  OR revoked_access_tokens jti —
   │                                                │                  after logout-all / pwd change /
   │                                                │                  email change / admin deactivate
   │                                                │                  or role change)
   │                                                │                  ──▶ re-login (EXPECTED, not a bug)
   │                                                │                 else ──▶ JWT secret rotated;
   │                                                │                  see RUNBOOK.md
   │                                                ├── no (429) ──▶ rate-limited; client logs out
   │                                                │                 deliberately (client.ts:174-181)
   │                                                └── yes ──▶ AuthContext ordering bug
   │                                                            ("Data disappears on refresh")
   └── no (UI just loops) ──▶ frontend redirect loop; see "Data disappears…"
```

The client treats a refresh **429** as terminal (logs the user out instead of amplifying the storm) — `src/services/api/client.ts:174-181`. `/auth/refresh`, `/auth/logout`, `/auth/logout-all` are exempt from the generic 401-retry path to prevent recursion (`client.ts:269-272`).

---

## Decision tree: Upload 500 / empty extraction

```
Upload of a lab PDF / SBC returns 500 or "no biomarkers found"
        │
        ▼
  Response code?
   ├── 413 FILE_TOO_LARGE ──▶ file > 10MB; multer limit (errorHandler.ts:170-171)
   ├── 400 UPLOAD_ERROR  ──▶ wrong field / too many files (errorHandler.ts:172-174)
   ├── 503 SERVICE_UNAVAILABLE ──▶ AI spend cap hit on the upload route
   │                               (aiSpendGuard on uploadRoutes.ts:82,104,135)
   ├── 403 PLAN_LIMIT_EXCEEDED ──▶ pdfUploadsPerMonth quota hit (planGating)
   └── 200 but extraction empty ──▶ which path?
            ├── digital PDF ──▶ pdf-parse text extraction (pdfParser.ts);
            │                   regression history: pdf-parse must be v1.x
            │                   (commit 254e2ec / 154e52e)
            └── scanned/image ──▶ Document AI OCR (ocrService.processDocument
                                  ocrService.ts:300); multi-line table parsing
                                  fixed in commit f62796f / f0eff7a
```

---

## Decision tree: RLS mystery (fewer rows than expected)

```
A query returns fewer rows than the data actually contains
        │
        ▼
  Was the query wrapped in withRLSContext / withRLSTransaction?
   ├── no  ──▶ a bare `prisma.*` call runs on a pooled connection with NO
   │           SET LOCAL app.current_user_id, so RLS evaluates user_id against
   │           NULL → 0 rows. Wrap it. (CLAUDE.md "Row-Level Security" rule)
   └── yes ──▶ Did the callback use the `tx` argument, or call `prisma.*`?
                ├── called prisma.* inside ──▶ same bug: prisma.* leaves the
                │                               SET-LOCAL connection. Use `tx`.
                └── used tx ──▶ Is the userId correct / is this admin context?
                                 ├── userId null (admin) ──▶ is_admin_session()=true,
                                 │                            should see all rows;
                                 │                            if NOT, role lacks the
                                 │                            admin GUC — check session
                                 └── userId set ──▶ rows really are scoped to that
                                                    user; the "missing" rows belong
                                                    to a different user_id (correct)
```

**How to confirm an RLS scoping issue directly in psql** (see [Quick diagnostic commands](#quick-diagnostic-commands)):

```sql
-- Without RLS context: returns 0 rows for a non-superuser app role.
SELECT count(*) FROM biomarkers;

-- With RLS context set: returns that user's rows only.
SET LOCAL app.current_user_id = '<user-uuid>';
SELECT count(*) FROM biomarkers;
```

If the first query returns rows for the app role, the role has `BYPASSRLS` and isolation is broken — the boot guard `assertNoBypassRLS()` should have caught this in prod (`backend/src/services/database.ts:217-260`).

---

## Auth symptoms

### Data disappears after page refresh

**Symptom**: user sees biomarkers after login, but after a page refresh the dashboard is empty and the network tab shows `401 → 200 → empty list`.

**Root cause**: the historical bug was that `AuthContext` called `getCurrentUser()` **before** `refreshToken()`. The 15-minute access-token cookie has expired by the time the page is reloaded, so the user call returns 401 and the app renders as logged-out before the (7-day) refresh token is ever used.

**Workaround (historical)**: hard refresh twice — the in-flight refresh completed before the 2nd mount.

**Fix (shipped)**: mount-time `checkAuth` now `await authApi.refreshToken()` **first**, then `getCurrentUser()`:

```ts
// Source: src/contexts/AuthContext.tsx:153-169
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

Fixed in commit `195ccc1` ("Fix auth token restoration order on page refresh"). (Do **not** cite `50d7426` for this — that is the unrelated "add domain to all auth cookies for cross-domain support" cookie fix.)

**Files**: `src/contexts/AuthContext.tsx:144-180` (mount-time `checkAuth`).

**Cross-link**: [`ERROR_RECOVERY.md` → `UNAUTHORIZED` / `TOKEN_EXPIRED`](./ERROR_RECOVERY.md).

---

### Access token suddenly rejected (cross-instance revocation)

**Symptom**: an access token that worked seconds ago starts returning 401 `Session has been revoked. Please log in again.` on **every** replica — typically right after the user did *logout-all*, *changed/reset their password*, *changed their email*, or after an *admin deactivated them or changed their role*; or after a *single-device logout* on one device. This is **expected behavior, not a bug**.

**Root cause**: two post-2026-06 revocation mechanisms reject still-unexpired access tokens across all Cloud Run instances:

1. **Per-user cutoff** — `users.tokens_valid_after` (migration `20260606000002_add_tokens_valid_after`). Any access JWT whose `iat` predates the cutoff is rejected. Stamped by `revokeAllUserTokens()` on logout-all, password change/reset, email change, admin deactivate/role-change.
2. **Per-jti revocation** — the `revoked_access_tokens` table (migration `20260613_revoked_access_tokens`). A single-device logout upserts that token's `jti` so it is killed cross-instance **without** logging out the user's other devices (which `tokens_valid_after` would do).

Both are enforced in `authenticate`, `optionalAuth`, and `requireBearerAuth` via the single combined check `isAccessTokenStale(decoded.id, decoded.iat, decoded.jti)`:

```ts
// Source: backend/src/middleware/auth.ts:106-108
if (await isAccessTokenStale(decoded.id, decoded.iat, decoded.jti)) {
  throw new UnauthorizedError('Session has been revoked. Please log in again.');
}
```

`optionalAuth` treats a stale token as "no user" instead of throwing (`auth.ts:163-165`). The revocation state is cached for 15s (`fetchUserRevocationState`, per the auth/session fact digest) and `isAccessTokenStale` **fails OPEN on DB error** so a transient DB blip does not log everyone out.

**Workaround / fix**: re-login (or let the SPA silently `/auth/refresh`, which mints a fresh token issued after the cutoff). There is nothing to "fix" in code — the rejection is the security feature working.

**Distinguish from a JWT-secret rotation**: if a token is rejected even immediately after a fresh login (a brand-new token also fails), the access secret was rotated, not a per-user revocation. See [`RUNBOOK.md`](./RUNBOOK.md) "JWT secret rotated" playbook.

**Files**: `backend/src/middleware/auth.ts:86-108` (`authenticate`), `auth.ts:149-165` (`optionalAuth`), `auth.ts:197-218` (`requireBearerAuth`); migrations `backend/prisma/migrations/20260606000002_add_tokens_valid_after/` and `20260613_revoked_access_tokens/`.

**Cross-link**: [`ERROR_RECOVERY.md` → `UNAUTHORIZED`](./ERROR_RECOVERY.md).

---

### Idle auto-logoff (HIPAA §164.312(a)(2)(iii))

**Symptom**: after ~15 minutes of no interaction the user is bounced to `/?sessionExpired=true` with "Your session ended due to inactivity." A warning dialog appears 2 minutes before.

**Root cause**: this is the intentional HIPAA automatic-logoff watchdog. Timers: 15-min hard logout, 13-min warning (`src/contexts/AuthContext.tsx:40-41`). Activity is `mousedown|keydown|touchstart|scroll` only — **mouse move is deliberately excluded** so a wandering cursor on a second monitor cannot keep a session alive (`AuthContext.tsx:42, 286-289`).

**Cross-tab behavior**: tabs broadcast bare `{type:'activity'}` pings (throttled to 1/30s) over a `BroadcastChannel` so an actively-used tab keeps idle tabs alive; the tab that idle-fires broadcasts `{type:'logged-out'}` so siblings redirect immediately (`AuthContext.tsx:53-57, 300-316`).

**On the `?sessionExpired=true` reload, the silent refresh is deliberately skipped** so a raced revocation cannot resurrect the session (`AuthContext.tsx:122-142`).

**Workaround/fix**: not a bug. To lengthen the window, change `INACTIVITY_TIMEOUT_MS` (`AuthContext.tsx:40`).

**Files**: `src/contexts/AuthContext.tsx:37-68, 245-345`.

---

## CSRF symptoms

**Symptom**: a state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`) returns **403** with a CSRF code, while reads work fine.

**Root cause**: this app uses a **stateless double-submit cookie** — there is no server-side CSRF secret. The `csrf_token` cookie is JS-readable (`httpOnly:false`, per the auth/session fact digest, `csrf.ts:43`); the client must echo it in the `X-CSRF-Token` header. `validateCsrfToken` requires `header === cookie`, compared constant-time (`csrf.ts:172-183`). The client attaches it for all mutations:

```ts
// Source: src/services/api/client.ts:243-253
const method = (options.method || 'GET').toUpperCase();
if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    (headers as Record<string, string>)['x-csrf-token'] = csrfToken;
  } else if (import.meta.env.DEV) {
    apiLogger.warn('Mutation request without CSRF token', { method, endpoint });
  }
}
```

**Common causes & fixes**:

| Cause | Symptom detail | Fix |
|---|---|---|
| Cookie name mismatch | `getCsrfToken()` returns `''`; header omitted | The cookie is named exactly `csrf_token`; the regex is anchored to a cookie-name boundary so `xsrf_csrf_token`/`notcsrf_token` can't satisfy it (`client.ts:120-127`). Re-read the cookie. |
| `/auth/refresh` 403 → forced logout | refresh recovery fails | `/auth/refresh` is **no longer CSRF-exempt** (post-2026-06); the SPA must double-submit on refresh. The raw recovery fetch attaches the header (`client.ts:149-159`). |
| Upload route 403 | upload mutation rejected | **Upload routes are no longer CSRF-exempt** (per auth/session fact digest, `csrf.ts:147-152`). The upload client must send the header. |
| Cross-domain cookie not set | cookie missing entirely | Cookie `SameSite`/`Secure`/`domain` resolution — see commits `8db4317`, `50d7426`, `b06756d`. With `COOKIE_DOMAIN` set, `SameSite=None` + `Secure` are forced (`config/index.ts:88-95`). |
| Dev disable flag | n/a in prod | `DISABLE_CSRF=true` skips CSRF **only** when `config.isDevelopment` (`csrf.ts:159`, `app.ts:215`). It is ignored in prod. |

**Cross-link**: [`ERROR_RECOVERY.md` → `CSRF_TOKEN_INVALID` / `CSRF_TOKEN_MISSING`](./ERROR_RECOVERY.md).

---

## Database symptoms

### Boot aborts: FORCE-RLS assertion failed

**Symptom**: the backend process logs `FATAL` and exits with code 1 at startup; the Cloud Run revision never becomes healthy. The log mentions an RLS-enabled table that is not `FORCE ROW LEVEL SECURITY`, or a database role with `BYPASSRLS`.

**Root cause**: at boot, `database.ts` runs two hard invariants after the connection is alive:

```ts
// Source: backend/src/services/database.ts:192-193
await assertNoBypassRLS();
await assertRLSForced();
```

- `assertNoBypassRLS()` (`database.ts:217-260`): in **production**, a role with `BYPASSRLS=true` logs FATAL and `process.exit(1)` — there is no opt-out (`database.ts:247-254`). In non-prod it warns and continues.
- `assertRLSForced()` (`database.ts:270+`): finds any table with `relrowsecurity=true AND relforcerowsecurity=false`. In prod, the boot refuses to start; non-prod warns. Migration `20260613_force_rls_and_audit_retention` applied `FORCE ROW LEVEL SECURITY` to all 19 RLS tables; this guard catches a **future** table that enables RLS but forgets FORCE.

Both assertions **fail OPEN if the `pg_roles`/`pg_class` read itself errors** (network/permission blip) — they log loudly and continue rather than crash-looping (`database.ts:231-240, 286+`).

**Workaround**: none in prod — the hard-exit is the design. Do not downgrade it.

**Fix**: apply `FORCE ROW LEVEL SECURITY` to the offending table (or revoke `BYPASSRLS` from the app role, restoring the `omh_app` non-bypass role). See `docs/c-8-part-c-runbook.md` and [`RUNBOOK.md`](./RUNBOOK.md).

**Files**: `backend/src/services/database.ts:188-296`; migration `backend/prisma/migrations/20260613_force_rls_and_audit_retention/`.

### RLS context loss (queries silently return 0 rows)

See the [RLS mystery decision tree](#decision-tree-rls-mystery-fewer-rows-than-expected). The canonical bug is calling `prisma.*` inside a `withRLSContext` callback instead of the `tx` argument — `prisma.*` runs on a different pooled connection that does **not** carry the `SET LOCAL app.current_user_id`, so RLS evaluates against `NULL`. Live example of the correct pattern in `planGating.ts:66-71`:

```ts
// Source: backend/src/middleware/planGating.ts:66-71
const userRow = await withRLSContext(userId, async (tx) => {
  return tx.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
});
```

### Pool exhaustion

**Symptom**: requests hang then 500; logs show connection-acquire timeouts. **Root cause**: pg pool `max` defaults to 10, configurable via `DATABASE_POOL_SIZE` (per env-vars fact digest, `database.ts:108`). **Fix**: raise `DATABASE_POOL_SIZE`, or find the leaking long-running transaction. See [`ENV_VARS.md`](./ENV_VARS.md).

### Migration failure

A failed migration no longer crash-loops the running service — it fails the **deploy** at the migrate-job step. See [Deploy red at the migrate-job step](#deploy-red-at-the-migrate-job-step).

**Cross-link**: [`ERROR_RECOVERY.md` → `DATABASE_ERROR`](./ERROR_RECOVERY.md).

---

## Deployment symptoms

### Deploy red at the migrate-job step

**Symptom**: the `deploy.yml` workflow goes red at the **"Run database migrations"** step; the running production service is unaffected (no crash-loop, no outage).

**Root cause (by design)**: migrations **do not run at container boot**. The Dockerfile `CMD` is just the app:

```dockerfile
# Source: backend/Dockerfile:86-93
# Migrations do NOT run at boot. `prisma migrate deploy` runs as a Cloud Run
# job in the deploy pipeline (.github/workflows/deploy.yml, "Run database
# migrations") — teardown finding #18 ...
CMD ["node", "dist/app.js"]
```

The deploy runs `prisma migrate deploy` as a dedicated Cloud Run **job** (`ownmyhealth-migrate`, `deploy.yml:43`) AFTER the image push and BEFORE the no-traffic revision is staged. `--max-retries 0` means a failed migration is **not** auto-retried — a human looks at it (`deploy.yml:139-150`). The separate `jobs execute --wait` exits nonzero on failure, which is what fails the workflow step (`deploy.yml:158-161`).

```yaml
# Source: .github/workflows/deploy.yml:139-161
gcloud run jobs deploy ${{ env.MIGRATE_JOB }} \
  --image "$IMAGE" \
  ...
  --command npx \
  --args prisma,migrate,deploy \
  --max-retries 0 \
  --task-timeout 10m \
  --memory 512Mi
gcloud run jobs execute ${{ env.MIGRATE_JOB }} \
  --region "${{ env.REGION }}" --project "${{ env.PROJECT_ID }}" --wait
```

The deploy is also gated on the full CI suite (`deploy.yml:66` `needs: ci`), so a red CI never reaches the migrate step.

**Diagnose**: read the migrate-job execution logs (it runs as the service's runtime SA, `deploy.yml:125-134`):

```bash
gcloud run jobs executions list --job=ownmyhealth-migrate --region=us-central1 --project=<project-id> --limit=5
gcloud logging read 'resource.type="cloud_run_job" resource.labels.job_name="ownmyhealth-migrate" severity>=ERROR' --limit=20 --freshness=1h
```

**Fix**: fix the migration (or DB state), push; the workflow re-runs the job. The old `migrate && node` boot CMD that bricked container starts (and caused the 10-day silent outage resolved 2026-06-12) was removed.

**Files**: `backend/Dockerfile:86-93`; `.github/workflows/deploy.yml:43, 66, 106-161`.

**Cross-link**: [`RUNBOOK.md`](./RUNBOOK.md), [`ERROR_RECOVERY.md` → `DATABASE_ERROR`](./ERROR_RECOVERY.md).

### Cloud Run env update held at 0% traffic (pinning gotcha)

**Symptom**: you ran `gcloud run services update --update-env-vars=...`, the command succeeded and created a new revision, but the running service still behaves with the **old** env. `latestReadyRevisionName ≠ latestCreatedRevisionName`.

**Root cause**: this service promotes traffic with **explicit named revisions**, not `--to-latest`:

```yaml
# Source: .github/workflows/deploy.yml:244-274
# Shift 100% traffic to the new revision. Uses explicit --to-revisions
# (not --to-latest) so rollback is a deterministic, named-revision op.
gcloud run services update-traffic ${{ env.SERVICE }} \
  ...
  --to-revisions="$NEW_REV=100"
```

Because traffic is pinned to a named revision, a subsequent `--update-env-vars` creates a new revision but leaves it at **0% traffic**. The new env never serves. This is the same class of issue as the 2026-04-17 `ANTHROPIC_BAA_ACTIVE` flip postmortem.

**Detection signal**: `latestReadyRevisionName` ≠ `latestCreatedRevisionName`:

```bash
gcloud run services describe <service> --region=us-central1 \
  --format='value(status.latestReadyRevisionName, status.latestCreatedRevisionName)'
```

**Fix**: follow the env update with a traffic shift to the new revision (or `--to-latest` to drop the pin):

```bash
gcloud run services update-traffic <service> --region=us-central1 --to-latest
# or, to keep the named-revision discipline:
gcloud run services update-traffic <service> --region=us-central1 --to-revisions=<NEW_REV>=100
```

**Full postmortem**: TBD (external: the `cloud-run-env-update-pinning.md` postmortem and the 2026-04-17 `ANTHROPIC_BAA_ACTIVE` flip narrative live in project memory, not in-repo — resolve via the maintainer's Claude project-memory store). The in-repo evidence is the explicit `--to-revisions` promotion at `deploy.yml:244-274`.

**Files**: `.github/workflows/deploy.yml:244-274`.

### Docker build failure

**Symptom**: `deploy.yml` red at "Build and push" (`deploy.yml:100-104`). The image is built from `backend/Dockerfile` on Node 22-alpine (digest-pinned). Read the build log; common causes are TypeScript compile errors (run `npm run build` in `backend/` locally) and a stale lockfile. **Cross-link**: [`LOCAL_DEV.md`](./LOCAL_DEV.md).

---

## Frontend symptoms

### Blank page on frontend

**Symptom**: the app renders nothing (white screen), no obvious error toast.

**Most common cause**: the SPA shell loaded but the bundle threw at import time, or the auth gate is stuck `isLoading`. The mount-time `checkAuth` always resolves `setIsLoading(false)` in its `finally` (`src/contexts/AuthContext.tsx:174-176`), so a hung loading state points to a thrown error **before** that effect ran — check the browser console for a bundle/import error.

**Historical bundling cause**: a `forwardRef` error from React and recharts ending up in separate bundles produced a blank render — fixed by keeping them in the same bundle (commit `1e1bac0`, "fix: keep React and recharts in same bundle to fix forwardRef error").

**Fix**: open DevTools console; if it is a chunk/`forwardRef` error, check the Vite manualChunks config; if the network shows the API base is wrong, verify `VITE_API_URL` (per env-vars fact digest, `.env.example:15`).

**Files**: `src/contexts/AuthContext.tsx:121-180`; `src/services/api/client.ts:10`.

### CORS rejection

**Symptom**: console shows a CORS error; the request never reaches the app logic.

**Root cause**: the backend validates `Origin` against `CORS_ORIGIN`, which is **required in production** (`app.ts:80`, per env-vars fact digest). Locally it defaults to a localhost array. Preflight handling and cross-domain cookies were hardened in commits `327b2f4` ("fix: CORS configuration for cross-domain cookies") and `ad2dff9` ("fix: ensure CORS preflight requests are handled properly").

**Fix**: set `CORS_ORIGIN` to the exact frontend origin (scheme + host + port). See [`ENV_VARS.md`](./ENV_VARS.md).

### Next.js SWC ARM64 incompatibility (project memory)

**Symptom**: `Error: ... not a valid Win32 application` from `next/dist/build/swc` on **Windows ARM64 + Node 24**, despite a valid PE32+ ARM64 binary.

**Root cause**: Next.js 14.x only auto-enables its WASM SWC fallback for a hardcoded triple list that excludes `win32-arm64`.

**Fix**: patch `next/dist/build/swc/index.js` to add `aarch64-pc-windows-msvc` to `knownDefaultWasmFallbackTriples` and drop the `useWasmBinary` gate. (This applies to the sibling **HealthcareProviderDB** Next.js project; OwnMyHealth's frontend is Vite, not Next.js. Captured here because the prompt's Acceptance Question 9 asks for it.)

**Full detail**: TBD (external: the `next-swc-arm64.md` postmortem lives in project memory, not in this repo — resolve via the maintainer's Claude project-memory store).

---

## API / 500 symptoms

### Generic 500 / "unexpected error"

**Symptom**: client shows "Something went wrong on our end." (`client.ts:21, 105-108`); response is `500 INTERNAL_ERROR` with no detail (prod hides internals).

**Root cause**: any unhandled throw lands in `errorHandler`, which returns the **generic** message in production and only logs full details server-side for `statusCode >= 500`:

```ts
// Source: backend/src/middleware/errorHandler.ts:190-196
if (statusCode >= 500) {
  logger.error(`${err.name}: ${err.message}`, logData);
} else if (config.isDevelopment) {
  logger.warn(`${err.name}: ${err.message}`, logData);
}
```

Prisma errors map to client-friendly codes (`P2002→409 CONFLICT`, `P2025→404 NOT_FOUND`, `P2003/P2014→400 BAD_REQUEST`; everything else → `500 DATABASE_ERROR`) at `errorHandler.ts:109-120`. JWT errors map to `401 INVALID_TOKEN`/`TOKEN_EXPIRED` (`errorHandler.ts:122-131`).

**Diagnose**: the real cause is in Cloud Run logs, keyed by `code`/`path`/`userId`:

```bash
gcloud logging read 'resource.type="cloud_run_revision" severity>=ERROR' --limit=20 --freshness=1h
```

**Cross-link**: [`ERROR_RECOVERY.md` → `INTERNAL_ERROR` / `DATABASE_ERROR`](./ERROR_RECOVERY.md).

### PHI leaking into logs

**Symptom**: a log line (or a string sent to an AI service) appears to contain raw PHI (an SSN, phone number, member ID, etc.).

**Root cause / the canonical guard**: the **sole** redaction utility is `backend/src/utils/phiRedaction.ts`. It exports `stripPHIFromText` (`:86`) and `redactPHI` (`:97`); `redactPHI` returns both the scrubbed text and the list of pattern categories that fired, so you can log *that an SSN was stripped* without logging the SSN:

```ts
// Source: backend/src/utils/phiRedaction.ts:97-109
export function redactPHI(text: string): { text: string; firedPatterns: string[] } {
  const firedPatterns: string[] = [];
  let result = text;
  for (const { name, pattern, replacement } of PHI_PATTERNS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) firedPatterns.push(name);
  }
  return { text: result, firedPatterns };
}
```

There is **no** `pdfRedaction.ts` — it (and `redactPatientBanner`) was deleted post-2026-06-01; do not look for it. The frontend loggers (`authLogger`/`apiLogger`) gate `debug`/`info` in prod and route through the sanitizer (`AuthContext.tsx:155-158`, `client.ts:129-136`).

**Fix**: route the offending string through `redactPHI`/`stripPHIFromText` before logging; for AI calls, pass redacted text. Confirm no raw `console.log` of request bodies remains.

**Files**: `backend/src/utils/phiRedaction.ts:86-110`.

**Cross-link**: [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) (doc pending — see prompt `./21-phi-taxonomy.md` if not produced this run).

---

## PDF / OCR / Claude extraction symptoms

**Symptom**: a lab upload succeeds (200) but produces **no biomarkers**, or extraction is garbled.

**Root cause depends on the path** (see the [upload decision tree](#decision-tree-upload-500--empty-extraction)):

| Path | Service | Known regression / fix |
|---|---|---|
| Digital PDF text | `pdfParser.ts` (pdf-parse) | pdf-parse **must be v1.x** with the correct import path — commits `254e2ec`, `154e52e` (and the `pdf-parse-v2` Dependabot trap is held closed per project memory). |
| Scanned / image PDF | Document AI OCR, `ocrService.processDocument` (`ocrService.ts:300`) | Multi-line table extraction fixed in `f62796f` / `f0eff7a`; newline-spanning extraction in `56fd294`. |
| Claude structured extraction | `claudeExtraction.ts:150`, `sbcExtraction.ts:808` | `max_tokens` capped to a valid limit (`e029127`); use of extracted `labDate` for the measurement date (`36b7306`). |

**Document AI dollar cost is NOT metered**: `ocrService.processDocument` (`ocrService.ts:300`) has **no** `trackAIUsage` call — Document AI spend does **not** accrue against `AI_DAILY_BUDGET_USD`. OCR is bounded only by the `pdfUploadsPerMonth` plan quota and the `aiLimiter` rate limit, not by dollars (per AI-cost fact digest). So a flood of OCR uploads will **not** trip the spend cap — if you expected a 503 and got 429/403 instead, this is why.

**Biomarkers vanish after extraction**: a separate historical bug where pagination dropped freshly-added rows — fixed in commit `080ad8e` ("fix: prevent biomarkers from disappearing due to pagination"). The lab upload modal is also kept open after extraction to show results (`45cef63`).

**Cross-link**: [`ERROR_RECOVERY.md` → `EXTERNAL_SERVICE_ERROR` / `UPLOAD_ERROR`](./ERROR_RECOVERY.md).

---

## AI chat / spend-cap symptoms

### AI spend cap hit (503 SERVICE_UNAVAILABLE)

**Symptom**: an AI feature returns **503** with `AI features are temporarily unavailable...` or `You've reached today's AI usage limit. Please try again tomorrow.` — while non-AI features work.

**Root cause**: `aiSpendGuard` is a **dollar** circuit breaker that fails **closed** with 503 once the rolling daily spend budget is reached, in both the budget-reached and Redis-store-error cases:

```ts
// Source: backend/src/middleware/aiSpendGuard.ts:54-67
if (!admission.admitted) {
  logger.warn('AI request refused — daily spend budget reached', { ... });
  next(new ServiceUnavailableError(
    admission.scope === 'global'
      ? 'AI features are temporarily unavailable (daily budget reached)...'
      : "You've reached today's AI usage limit. Please try again tomorrow."));
  return;
}
```

The `scope` in the log tells you whether the **global** or **per-user** cap tripped (`aiSpendGuard.ts:55-65`). Controlling env vars (per AI-cost fact digest):

| Env var | Default | Meaning |
|---|---|---|
| `AI_DAILY_BUDGET_USD` | `50` | Global daily cap (USD). `0` disables. |
| `AI_USER_DAILY_BUDGET_USD` | `5` | Per-user daily cap (USD). `0` disables. |

The guard reserves a fixed `$0.05` estimate before the call (`aiCostTracker.ts:67`) and backs it out on response `finish`/`close`; the real cost is added afterward by `trackAIUsage`. With the **in-memory** store (no `REDIS_URL`), the effective ceiling under autoscale is N×budget. A Redis error also yields 503 — the breaker deliberately does not uncap during an outage (`aiSpendGuard.ts:38-51`).

**Exactly 8 mount points** carry `aiSpendGuard` (per AI-cost fact digest): `aiRoutes.ts:32`, `biomarkerRoutes.ts:136`, `expenseRoutes.ts:114`, `insuranceRoutes.ts:125,138`, `uploadRoutes.ts:82,104,135`.

**Workaround/fix**: wait for the UTC-day rollover, or raise the budget env var (then re-deploy — mind the [pinning gotcha](#cloud-run-env-update-held-at-0-traffic-pinning-gotcha)). `aiSpendGuard` must run **after** `authenticate`; with no user it falls through without gating (`aiSpendGuard.ts:29-33`).

**Files**: `backend/src/middleware/aiSpendGuard.ts:28-78`; `backend/src/services/aiCostTracker.ts`.

**Cross-link**: [`ERROR_RECOVERY.md` → `SERVICE_UNAVAILABLE`](./ERROR_RECOVERY.md).

### AI rate-limited (429)

**Symptom**: an AI route returns **429** (not 503).

**Root cause**: this is the separate `aiLimiter` **rate** limiter (request-count over a window), distinct from the dollar spend cap. The client retries 429 with exponential backoff (1s/2s/4s ±25% jitter, up to 3 times) honoring `Retry-After` (`client.ts:200, 291-301`).

**Distinguish 503 vs 429**: 503 = dollar budget exhausted (`aiSpendGuard`); 429 = too many requests too fast (`aiLimiter`). The 503 message references "budget"/"usage limit"; the 429 carries a `Retry-After`.

**Cross-link**: [`ERROR_RECOVERY.md` → `RATE_LIMIT_EXCEEDED`](./ERROR_RECOVERY.md).

---

## Quest FHIR / lab-sync symptoms

**Symptom A — SSRF rejection**: a lab connect/sync throws an error like `host "<x>" is not the trusted FHIR host` or `refusing cleartext http to public host`. **Root cause**: `assertAllowedFhirUrl` (`urlSafety.ts:64-99`) confines every server-supplied outbound URL (FHIR pagination `next` links, discovered authorize/token/revoke endpoints) to the configured FHIR host (or `QUEST_FHIR_AUTH_HOSTS` allowlist), refuses non-HTTP(S) schemes, and refuses cleartext http to public hosts:

```ts
// Source: backend/src/services/fhir/urlSafety.ts:90-97
if (!allowed.has(host)) {
  throw new Error(`${label}: host "${host}" is not the trusted FHIR host (${base.hostname}) or an allowed host`);
}
if (target.protocol === 'http:' && !isPrivateOrLoopbackHost(host)) {
  throw new Error(`${label}: refusing cleartext http to public host "${host}"`);
}
```

This is **intentional** — the patient Bearer token and OAuth client_secret are attached to these URLs. The cloud metadata IP `169.254.169.254` is explicitly blocked (`urlSafety.ts:39`). **Fix**: if a *legitimate* separate auth host is being rejected, add it to `QUEST_FHIR_AUTH_HOSTS` (per env-vars fact digest, `config/index.ts:280`); do not loosen the guard.

**Symptom B — expired OAuth token**: sync fails or the connection flips to `syncStatus = error` with a token/refresh failure (not a host error). **Root cause**: the encrypted `accessTokenEncrypted`/`refreshTokenEncrypted` on the `LabConnection` row expired and refresh failed. Sync auto-refreshes when the token is within 60s of expiry (per FHIR fact digest, `labSyncService.ts:230-254`); if the provider rotated/revoked the refresh token, re-consent is required.

**How to tell them apart**: an **SSRF rejection** mentions a *host* or *scheme/cleartext* and comes from `urlSafety.ts`; an **expired-token** failure mentions the *token endpoint* / *401 from the FHIR server* / a refresh failure and comes from `smartAuth.ts`/`labSyncService.ts`. SSRF = "we refused to send credentials there"; token expiry = "we sent them and the provider said no."

**Symptom C — intermittent connect failure (L-39)**: the OAuth callback occasionally fails with a missing PKCE verifier. **Root cause**: the verifier store is an in-memory per-process `Map`; under autoscale the callback can land on a different Cloud Run instance than the one that stashed the verifier (per FHIR fact digest, `smartAuth.ts:374-386`). **Mitigation**: pin `--max-instances=1` until a shared store exists.

**Files**: `backend/src/services/fhir/urlSafety.ts:28-99`; `backend/src/services/fhir/labSyncService.ts`; `backend/src/services/fhir/smartAuth.ts`.

**Cross-link**: [`ERROR_RECOVERY.md` → `EXTERNAL_SERVICE_ERROR`](./ERROR_RECOVERY.md).

---

## Onboarding / plan-gating symptoms

### Plan limit blocks a feature (403)

**Symptom**: a feature returns **403** `PLAN_LIMIT_EXCEEDED` with `upgradeRequired:true`; the UI shows an upgrade CTA with exact numbers instead of a generic toast.

**Root cause**: `requirePlanLimit` gates the route against the user's plan, read **fresh from the DB** (not the possibly-stale JWT) and downgraded to FREE if `planExpiresAt` has passed:

```ts
// Source: backend/src/middleware/planGating.ts:72-75
effectivePlan = normalizePlan(userRow?.plan);
if (userRow?.planExpiresAt && userRow.planExpiresAt.getTime() < Date.now()) {
  effectivePlan = 'FREE';
}
```

On a DB error the gate **fails CLOSED to FREE** (`planGating.ts:76-88`) rather than trusting the more-permissive JWT snapshot. The 403 body carries `limit`/`current`/`feature`/`upgradeRequired`, which the client lifts into `error.planLimit` for the upgrade CTA (`client.ts:54-62, 356-369`).

**Unexpected block?** Two known behaviors: (1) right after an admin downgrade the gate is correct immediately (DB read), even though the JWT still says PRO for up to 15 min; (2) there is a documented **TOCTOU race** — concurrent requests can each pass the count check and collectively overshoot the limit (`planGating.ts:90-97`). Limits/tiers are defined in `backend/src/config/plans.ts`.

**Fix**: upgrade the plan, or extend `planExpiresAt`. To change limits, edit `config/plans.ts`.

**Files**: `backend/src/middleware/planGating.ts:37-114`; `backend/src/config/plans.ts`; `src/services/api/client.ts:54-62, 354-369`.

**Cross-link**: [`ERROR_RECOVERY.md` → `PLAN_LIMIT_EXCEEDED`](./ERROR_RECOVERY.md).

### Onboarding wizard stuck

**Symptom**: the onboarding wizard does not advance / re-prompts on reload. **Root cause / where to look**: onboarding state is persisted server-side (onboarding migration `20260420_add_onboarding`, `onboardingService.ts`). A stuck wizard usually means a write failed (check for a 4xx on the onboarding route in the network tab) or the user retried a GET that the historical "onboarding GET-writes" issue mutated state on (open item, per project memory). **Fix**: inspect the onboarding route response; if state is wedged, the row can be reset via the admin/maintenance path. **Cross-link**: [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

---

## Quick diagnostic commands

```bash
# Backend health (prod backend is the Cloud Run service URL)
curl https://<prod-backend-url>/health

# Last 20 server errors in Cloud Run (the service)
gcloud logging read 'resource.type="cloud_run_revision" severity>=ERROR' \
  --limit=20 --freshness=1h

# Migrate-job failures specifically
gcloud logging read 'resource.type="cloud_run_job" resource.labels.job_name="ownmyhealth-migrate" severity>=ERROR' \
  --limit=20 --freshness=1h
gcloud run jobs executions list --job=ownmyhealth-migrate --region=us-central1 --limit=5

# Detect the env-update pinning gotcha (ready vs created revision mismatch)
gcloud run services describe <service> --region=us-central1 \
  --format='value(status.latestReadyRevisionName, status.latestCreatedRevisionName)'

# Connect to Cloud SQL via proxy (DB is `ownmyhealth` in Cloud SQL; `omh` for local dev)
cloud-sql-proxy <instance-connection-name>
psql -h 127.0.0.1 -U <user> -d ownmyhealth

# Inside psql: confirm an RLS scoping issue
SET LOCAL app.current_user_id = '<user-uuid>';
SELECT count(*) FROM biomarkers;   -- should return only that user's rows

# Inside psql: find any RLS table missing FORCE (would fail assertRLSForced)
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND c.relrowsecurity=true AND c.relforcerowsecurity=false ORDER BY c.relname;
```

```bash
# Frontend smoke: is the right API base wired?
#   VITE_API_URL drives src/services/api/client.ts:10 (default http://localhost:3001)
echo "$VITE_API_URL"
```

---

## Related Documents

- [ERROR_RECOVERY.md](./ERROR_RECOVERY.md) — error-**code**-first catalog; the per-`code` recovery steps every symptom here links to.
- [RUNBOOK.md](./RUNBOOK.md) — operational playbooks (JWT-secret rotation, RLS role cutover, deploy/rollback).
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — currently-open symptoms (onboarding GET-writes, TOCTOU plan-limit race, etc.).
- [LOCAL_DEV.md](./LOCAL_DEV.md) — local-dev failure modes (build, lockfile, Cloud SQL proxy).
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview, middleware stack, auth/RLS/AI-spend flows referenced throughout this doc.
- [ENV_VARS.md](./ENV_VARS.md) — env vars named here (`CORS_ORIGIN`, `AI_*_BUDGET_USD`, `QUEST_FHIR_*`, `DATABASE_POOL_SIZE`, `VITE_API_URL`).
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — PHI field map referenced by the log-redaction symptom (doc pending if not produced this run — see prompt `./21-phi-taxonomy.md`).

---

## Prompt drift log

- `./18-troubleshooting-doc.md` (line 44) cites `phiRedaction.ts` exports as `stripPHIFromText :86` and `redactPHI :97` — **confirmed exact** at `backend/src/utils/phiRedaction.ts:86,97`. No drift.
- `./18-troubleshooting-doc.md` (line 60) cites `isAccessTokenStale` enforcement at `backend/src/middleware/auth.ts:106-108` — **confirmed exact**. No drift.
- `./18-troubleshooting-doc.md` (line 62) cites `assertRLSForced()` "runs at startup in `database.ts:270` (called :193)". The call site `:193` is **confirmed exact** (`await assertRLSForced();` at `database.ts:193`); the function definition begins at `database.ts:270` (`async function assertRLSForced()`), also **confirmed**. No drift.
- `./18-troubleshooting-doc.md` (line 63) cites the Dockerfile `CMD` at `backend/Dockerfile:86,93`. The explanatory comment begins at `:86` and the `CMD ["node","dist/app.js"]` is at `:93` — **confirmed exact**. No drift.
- `CLAUDE.md` is stale relative to the code this doc cites: its "Project Structure" lists 10 controllers / 8 middleware / 13 route files and an `uploadController.ts` that no longer exists (upload handlers now live under `backend/src/controllers/upload/`); it omits `tokens_valid_after`, `revoked_access_tokens`, `requireBearerAuth`, `aiSpendGuard`, `planGating`, the migrate-as-Cloud-Run-job split, and FORCE RLS. The PHI section in `CLAUDE.md` still claims `Biomarker.unit` and `InsurancePlan.planName/insurerName/benefits` are encrypted — they are not (no `*Encrypted` columns; not in `PHI_FIELDS`). This doc uses the live code, not `CLAUDE.md`.
- The Cloud Run env-update **pinning postmortem** and the **Next.js SWC ARM64** patch detail are not in this repo (they live in project memory). They are marked `TBD (external: …)` with the in-repo evidence (`deploy.yml:244-274` for pinning; the Vite-not-Next.js note for ARM64) cited inline, rather than fabricated.
