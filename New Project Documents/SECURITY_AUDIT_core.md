# Core Security Audit — 2026-04-16

## Scope
Prompts executed: 01, 02, 03, 04, 05, 06, 10, 11. Files reviewed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260107_add_rls_policies/migration.sql`, `backend/prisma/migrations/20260108000000_add_user_files_table/migration.sql`, `backend/prisma/migrations/20260111_add_expense_tracking/migration.sql`, `backend/src/services/database.ts`, `backend/src/services/encryption.ts`, `backend/src/services/userEncryption.ts`, `backend/src/services/auditLog.ts`, `backend/src/services/authService.ts`, `backend/src/middleware/auth.ts`, `backend/src/middleware/csrf.ts`, `backend/src/middleware/rateLimiter.ts`, `backend/src/middleware/rbac.ts`, `backend/src/middleware/demoProtection.ts`, `backend/src/middleware/validation.ts`, `backend/src/controllers/authController.ts`, `backend/src/controllers/biomarkerController.ts`, `backend/src/controllers/expenseController.ts`, `backend/src/controllers/settingsController.ts`, all 12 files in `backend/src/routes/`, `backend/src/app.ts`, `backend/src/config/index.ts`, `src/contexts/AuthContext.tsx`, `src/services/api/client.ts`, `src/services/api/auth.ts`, `src/App.tsx`, `src/hooks/useRBAC.ts`, `src/components/common/RoleGuard.tsx`, `src/components/auth/{LoginPage,RegisterPage,VerifyEmailPage,ResetPasswordPage,ForgotPasswordPage}.tsx`, `.env.example`, `backend/.env.example`, `backend/.env.production.example`, `backend/Dockerfile`, `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `.gitignore`, `backend/.gitignore`.

## Summary
| Severity | Count |
|---|---|
| Critical | 4 |
| High | 7 |
| Medium | 10 |
| Low | 9 |
| Info | 2 |

## Findings

### F-1 — RLS context set with `SET LOCAL` outside a transaction — Critical
- **Prompt:** 01-database-schema §2 / 06-api-routes §8
- **Location:** `backend/src/services/database.ts:275-280`
- **Observation:** `setRLSContext` (called by the non-transactional `withRLSContext`) runs `prisma.$executeRawUnsafe("SET LOCAL ...")` outside a transaction. In PostgreSQL, `SET LOCAL` is scoped to the current transaction only; when there is no open transaction the server emits a WARNING and the setting is discarded after the statement completes. Subsequent `prisma.<model>.findMany/findUnique/...` calls in the same `withRLSContext` block therefore run with `app.current_user_id` unset. With connection pooling, settings can also leak between requests on a reused connection.
- **Impact:** Every RLS policy evaluates `user_id = current_user_id()` against `NULL`, returning UNKNOWN. In practice PostgreSQL may still return rows via bypass paths (pg `SET` vs `SET LOCAL` confusion, pre-existing session state on pooled connections, admin-context leakage) and the intended tenant isolation is unenforceable. RLS is the documented second layer of defence for HIPAA data — this makes it effectively unreachable for all non-transactional callers (most list/read endpoints).
- **Fix:** Wrap all `withRLSContext` bodies in an explicit `prisma.$transaction` (the `withRLSTransaction` path already does this correctly). Alternatively switch to session-scoped `SET` and `RESET` while documenting the risk of pool reuse, or use an interactive transaction with `SET LOCAL` for every request.
- **Evidence:**
  ```ts
  // Use SET LOCAL so the setting only applies to the current transaction
  await prisma.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
  await prisma.$executeRawUnsafe(`SET LOCAL app.is_admin = '${isAdmin}'`);
  ```

### F-2 — Audit-log system salt stored in plaintext in `system_config` — Critical
- **Prompt:** 05-audit-logging §4 / §5
- **Location:** `backend/src/services/auditLog.ts:114-122`
- **Observation:** The salt used to derive the key that encrypts `AuditLog.previousValueEncrypted` / `newValueEncrypted` is written to the `system_config.value` column with `isEncrypted: false`. Anyone with read access to the `system_config` table obtains the salt, and combined with a leak of `PHI_ENCRYPTION_KEY` (or anyone who already has DB-level access such as an ops engineer running `prisma studio`) can decrypt seven years of audit PHI history.
- **Impact:** HIPAA audit logs are supposed to be tamper-evident and confidential. A DB-level reader (backup dump, read-replica, misconfigured analyst role) can reconstruct all previous/new PHI values ever logged for every user. This weakens the audit log's evidentiary value and creates a mass-disclosure path.
- **Fix:** Encrypt the salt under the master key before storing (call `encryptionService.encryptWithMasterKey(salt)`) and set `isEncrypted: true`; decrypt on load. Alternatively move the salt to Secret Manager (`AUDIT_ENCRYPTION_SALT` env var) and drop the `system_config` row.
- **Evidence:**
  ```ts
  this.systemSalt = encryptionService.generateUserSalt();
  config = await this.prisma.systemConfig.create({
    data: { key: 'audit_encryption_salt', value: this.systemSalt,
      description: 'Salt used for encrypting audit log values',
      isEncrypted: false, // The salt itself is not encrypted
  ```

### F-3 — Hardcoded JWT/dev fallbacks in config — Critical
- **Prompt:** 11-environment-secrets §2 / 03-authentication §1
- **Location:** `backend/src/config/index.ts:16-25`
- **Observation:** `accessSecret`, `refreshSecret`, and a legacy `secret` all fall back to literal strings (`'access-secret-change-in-production'`, `'refresh-secret-change-in-production'`, `'fallback-secret-change-in-production'`) when the env vars are unset. Production startup does guard against these specific strings (config/index.ts:120-128), but any deploy where `NODE_ENV !== 'production'` (e.g., staging misconfigured as `development`) will silently sign tokens with publicly known secrets. Anyone who can observe the repo can forge admin JWTs for such environments.
- **Impact:** Non-production environments (staging, QA, preview deploys) often hold real or pseudo-real PHI. A leaked `.env.example` literal becomes a universal forgery key. Defense-in-depth is weak because the check is tied to a single env var name.
- **Fix:** Replace the `||` fallbacks with a `throw` at module load if the env var is missing, independent of `NODE_ENV`. Remove the `'fallback-secret-change-in-production'` legacy branch entirely.
- **Evidence:**
  ```ts
  accessSecret: process.env.JWT_ACCESS_SECRET || 'access-secret-change-in-production',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-in-production',
  secret: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'fallback-secret-change-in-production',
  ```

### F-4 — `.env.example` ships an insecure PHI encryption key that the validator does not block — Critical
- **Prompt:** 11-environment-secrets §2 / 02-encryption §2
- **Location:** `backend/.env.example:77`
- **Observation:** The example file sets `PHI_ENCRYPTION_KEY=0123456789abcdef...0123456789abcdef` — this exact value is in the `INSECURE_KEYS` allowlist (encryption.ts:76-80), but that allowlist is only checked when `NODE_ENV=production`. In development it is accepted and any PHI encrypted with it is recoverable by anyone reading the repo. If a developer copies `.env.example` to `.env` and never swaps the key, every local/stage install encrypts with the same public value, and a DB dump from a misconfigured environment becomes trivially decryptable.
- **Impact:** Example key leaks PHI at rest on every developer machine and any non-production environment. A stolen laptop or misdelivered backup is decryptable without the real key.
- **Fix:** Change `.env.example` to an obvious placeholder (`PHI_ENCRYPTION_KEY=__REPLACE_WITH_openssl_rand_hex_32__`) and reject the insecure keys in all environments (remove the `isProduction` guard around the `INSECURE_KEYS` check in `validateEncryptionKey`).
- **Evidence:**
  ```env
  # Example (DO NOT USE THIS IN PRODUCTION):
  PHI_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  ```

### F-5 — CSRF exempts Bearer-authenticated mutations without enforcing the Bearer header — High
- **Prompt:** 04-csrf §4
- **Location:** `backend/src/middleware/csrf.ts:110-163`
- **Observation:** The middleware skips CSRF validation for upload, settings, `/insurance/plans/*` DELETE, `/guidance`, and demo-AI routes on the assumption they "use Bearer token auth". But the backend `authenticate` middleware accepts cookie auth first (`auth.ts:32-44`), so a browser request to `/settings/delete-account` with only the `access_token` cookie (which browsers send automatically cross-origin when `SameSite=none` is configured for cross-domain deploys) succeeds with zero CSRF protection. The CSRF exemption list therefore disables CSRF on high-impact endpoints including account deletion and data export.
- **Impact:** A victim logged into the production site can be made to visit a malicious page that fires a `fetch('https://api.../settings/delete-account', {method:'DELETE', credentials:'include'})` and loses their account. Same risk for `/settings/export-data` (PHI exfiltration) and `/insurance/plans/:id` DELETE.
- **Fix:** Remove the exemptions; the middleware should require the `X-CSRF-Token` header on every state-changing request regardless of auth mechanism. If Bearer-only is truly required, enforce it by rejecting cookie auth on those specific routes (check `req.headers.authorization` in `authenticate` and fail if absent for exempted paths).
- **Evidence:**
  ```ts
  const settingsRoutes = ['/settings/delete-data','/settings/delete-account','/settings/export-data'];
  ...
  if (isPublicAuthRoute || isUploadRoute || isSettingsRoute || isBearerProtectedRoute || isDeleteRoute) {
    return next();
  }
  ```

### F-6 — RLS `users_update_own` allows self-role elevation at the DB layer — High
- **Prompt:** 01-database-schema §2
- **Location:** `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:98-101`
- **Observation:** The policy `USING (id = current_user_id() OR is_admin_session())` permits any authenticated user to UPDATE their own row with no column restriction. If any Prisma code path ever passes user-supplied fields into `prisma.user.update` (e.g., a future patient profile endpoint), the database will not prevent `role: 'ADMIN'`. The only current protection is application-layer allowlisting in controllers.
- **Impact:** Single-layer defence. Any controller mistake, SQL query, or admin shortcut that forwards `role` into the update becomes an instant role-escalation. RLS is supposed to be the backstop.
- **Fix:** Add a column-level CHECK or a separate policy disallowing changes to `role` and `is_active` when `NOT is_admin_session()` — e.g., `WITH CHECK ((id = current_user_id() AND role = OLD.role AND is_active = OLD.is_active) OR is_admin_session())`. Alternatively split into a trigger that rejects privileged-column updates by non-admin sessions.
- **Evidence:**
  ```sql
  CREATE POLICY users_update_own ON users
    FOR UPDATE
    USING (id = current_user_id() OR is_admin_session())
    WITH CHECK (id = current_user_id() OR is_admin_session());
  ```

### F-7 — Password reset accepts 8-char passwords; backend then rejects <12 after successful validation — High
- **Prompt:** 03-authentication §2 / 10-frontend-auth §6
- **Location:** `backend/src/middleware/validation.ts:128-134` vs `backend/src/services/authService.ts:140` and `src/components/auth/ResetPasswordPage.tsx:40-57`
- **Observation:** `strongPassword` zod schema requires min 8 chars, but `validatePasswordStrength` (called inside `resetPassword`) requires min 12 chars. Frontend `ResetPasswordPage` enforces only 8 chars. A user entering a 10-character password passes zod and the UI but gets a generic backend error. More importantly, `schemas.auth.resetPassword` is the authoritative gate for external callers and allows weaker passwords than the product requires — and `changePassword` has the same split. The inconsistency produces confusing UX and a weaker public contract than `validatePasswordStrength` implies.
- **Impact:** Public-facing password policy is 8 chars; the second (fragile) check at 12 chars is the only barrier. A future refactor dropping the service-level check would silently weaken authentication. Also undermines policy documentation.
- **Fix:** Raise `strongPassword.min(8)` to `min(12)` to match `validatePasswordStrength`. Mirror the requirement in `ResetPasswordPage` and `RegisterPage` frontend validation.
- **Evidence:**
  ```ts
  // validation.ts
  const strongPassword = z.string().min(8, 'Password must be at least 8 characters')
  // authService.ts
  if (password.length < 12) { errors.push('Password must be at least 12 characters long'); }
  ```

### F-8 — JWT verify() does not check issuer/audience — High
- **Prompt:** 03-authentication §1
- **Location:** `backend/src/middleware/auth.ts:63` and `backend/src/services/authService.ts:174-222`
- **Observation:** `jwt.verify(token, config.jwt.accessSecret)` is called without `{ issuer, audience, algorithms }` options. `jwt.sign` also omits `issuer`/`audience`. Additionally no `algorithms` allowlist is set, meaning a token signed with any jsonwebtoken-supported algorithm (HS256, HS512, RS256 with the secret-as-key confusion) will be considered if the secret happens to match.
- **Impact:** Missing `algorithms: ['HS256']` is historically how the "alg:none" and HS/RS confusion attacks land; current jsonwebtoken versions mitigate the classic `alg: none` bug, but relying on library defaults is fragile. Missing `issuer`/`audience` means any system that ever signs a token with this secret (ex: a separate service, a legacy token) remains honored. Defense-in-depth gap.
- **Fix:** Add `{ algorithms: ['HS256'], issuer: 'ownmyhealth-api', audience: 'ownmyhealth-web' }` to `jwt.sign` (all call sites) and `jwt.verify` (auth.ts:63, 105, 143 and authService.ts:262, 279).
- **Evidence:**
  ```ts
  const decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
  ```

### F-9 — Session `ipAddress` in authController uses unsanitized `X-Forwarded-For` — High
- **Prompt:** 05-audit-logging §3 / 03-authentication §9
- **Location:** `backend/src/controllers/authController.ts:60-71`
- **Observation:** `getSessionMetadata` pulls `req.headers['x-forwarded-for']`, splits on comma, and uses the first value. This bypasses Express's `trust proxy` logic entirely (see comment in `auditLog.ts:150-163` that explicitly warns against this pattern). A client can set `X-Forwarded-For: 8.8.8.8` and the Session row will record the spoofed IP. Audit logs elsewhere correctly use `req.ip`, so the same action can be logged with one IP and the session row with another.
- **Impact:** Session records (used for forensic review and session listing UIs) are spoofable. Rate limiting uses `req.ip` so that's fine, but session-IP-based anomaly detection or response to a breach becomes unreliable.
- **Fix:** Replace the helper body with `{ ipAddress: req.ip?.substring(0, 45), userAgent: req.get('user-agent')?.substring(0,500) }`, matching `auditLog.ts`.
- **Evidence:**
  ```ts
  const forwarded = req.headers['x-forwarded-for'];
  const ipAddress = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : req.socket.remoteAddress || req.ip;
  ```

### F-10 — Admin actions audited with `actorType: 'USER'` instead of `'ADMIN'` — High
- **Prompt:** 05-audit-logging §2
- **Location:** `backend/src/services/auditLog.ts:233, 257, 281, 305, 375, 400`
- **Observation:** All `logAccess/logCreate/logUpdate/logDelete/logExport` helpers hard-code `actorType: context.userId ? 'USER' : 'SYSTEM'`. When an admin performs privileged operations via `/api/v1/admin/*`, the audit row is written with `actorType: 'USER'`. The controller layer attempts to signal admin intent by setting `metadata.actorType = 'ADMIN'` (e.g., adminRoutes.ts:84-86), but the canonical `AuditLog.actorType` column stays `USER`. The `ActorType` enum includes `ADMIN`, so the intent is clearly to distinguish them.
- **Impact:** HIPAA audit review tools that query `audit_logs WHERE actor_type = 'ADMIN'` miss every admin action. Metadata strings can be tampered or change schemas; the column is the structured record and it's wrong.
- **Fix:** Add an `actorType` parameter to the audit helpers (default `'USER'`), set it to `'ADMIN'` in all `adminRoutes.ts` calls. Minimum: branch on `context.req?.user?.role === 'ADMIN'` inside the helpers to set the column.
- **Evidence:**
  ```ts
  // auditLog.ts
  actorType: context.userId ? 'USER' : 'SYSTEM',
  // adminRoutes.ts
  await auditService.logAccess('admin_user_list', undefined, ..., { actorType: 'ADMIN', ... });
  ```

### F-11 — Error handler risk: default `config.demo.email = ''` matches empty emails — High
- **Prompt:** 03-authentication §10
- **Location:** `backend/src/config/index.ts:74-78` and `backend/src/services/authService.ts:185-194`, `backend/src/middleware/demoProtection.ts:28-30`
- **Observation:** `demo.email` defaults to `''`. If `DEMO_ACCOUNT_ENABLED=true` is set without `DEMO_EMAIL`, then `isDemoEmail('')` returns true and `isDemoAccount(req)` returns true for any request where `req.user.email === ''`. In production the `demo.enabled` flag is blocked (config/index.ts:190-197), but in development/staging a misconfigured env permits skipping the `blockDemoAI` / `blockDemoRoleChange` protections for users whose email normalises to empty (unlikely but not zero after Unicode normalisation issues in email handling).
- **Impact:** Fragile. The comparison should be against a sentinel that can never legitimately match a real user.
- **Fix:** If `demo.email` is empty, return `false` from `isDemoUser`/`isDemoEmail`/`isDemoAccount` up front. Or default `demo.email` to `null` and require it when `demo.enabled` is true (throw at startup otherwise).
- **Evidence:**
  ```ts
  demo: {
    enabled: process.env.DEMO_ACCOUNT_ENABLED === 'true',
    email: process.env.DEMO_EMAIL || '',
    password: process.env.DEMO_PASSWORD || '',
  },
  ```

### F-12 — `resend-verification` endpoint lacks strict rate limiting — Medium
- **Prompt:** 03-authentication §7 / §11
- **Location:** `backend/src/routes/authRoutes.ts:67-71` vs `/login`/`/forgot-password` (lines 46-87)
- **Observation:** Routes are covered only by the umbrella `authLimiter` (20 req / 15min) applied via `router.use(authLimiter)`. Other sensitive auth routes layer `strictAuthLimiter` (5 / 15 min with email+IP keying). `/resend-verification` and `/register` receive the same laxer limit, enabling email-bomb / verification-token enumeration attacks against arbitrary emails.
- **Impact:** An attacker can flood SendGrid sends against a target email (reputational cost, inbox DoS) or probe which emails have unverified accounts.
- **Fix:** Apply `strictAuthLimiter` to `/resend-verification`, `/forgot-password` (already has it), and `/register`.
- **Evidence:**
  ```ts
  router.post('/resend-verification',
    validate(schemas.auth.resendVerification),
    asyncHandler(resendVerification));
  ```

### F-13 — Session cleanup runs hourly, not 10 minutes as documented — Medium
- **Prompt:** 03-authentication §9
- **Location:** `backend/src/services/authService.ts:1010-1015`
- **Observation:** `startSessionCleanup` uses `60 * 60 * 1000` (one hour). The prompt and CLAUDE.md state 10 minutes. Expired `sessions` rows therefore remain queryable for up to 59 minutes after expiry. `verifyRefreshToken` handles expired sessions at request time, so there's no auth bypass, but the table bloats and stale tokens stay inspectable in the DB.
- **Impact:** DB bloat; wider window where an attacker with DB read access can observe recently revoked tokens.
- **Fix:** Change interval to 10 minutes (`10 * 60 * 1000`) or update docs to match the current hourly reality.
- **Evidence:**
  ```ts
  sessionCleanupInterval = setInterval(() => {
    cleanupExpiredSessions()...
  }, 60 * 60 * 1000);
  ```

### F-14 — `app.current_user_id` set before Prisma transaction begins in admin-only branch of `withRLSTransaction` — Medium
- **Prompt:** 01-database-schema §2
- **Location:** `backend/src/services/database.ts:403-414`
- **Observation:** Inside the transaction the admin branch sets only `app.is_admin = 'true'` but never resets/clears `app.current_user_id`. If a previous user-scoped statement on the same pooled connection set a value and it wasn't cleaned (because the outer `withRLSContext` is non-transactional — see F-1), then inside the admin transaction `current_user_id()` may still return a stale UUID. RLS policies that use `OR is_admin_session()` still succeed, but the leaked identity could show up in logs or trigger conditions.
- **Impact:** Stale user context leakage between requests on pool reuse. Combined with F-1, makes admin operations accidentally scoped.
- **Fix:** In the admin branch, also emit `SET LOCAL app.current_user_id = ''` to clear any leaked value from earlier transactions.
- **Evidence:**
  ```ts
  if (useAdmin) {
    await tx.$executeRawUnsafe(`SET LOCAL app.is_admin = 'true'`);
  } else {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
    await tx.$executeRawUnsafe(`SET LOCAL app.is_admin = '${options.isAdmin || false}'`);
  }
  ```

### F-15 — `setRLSContext` / `withRLSTransaction` interpolate `userId` into raw SQL — Medium
- **Prompt:** 01-database-schema §2
- **Location:** `backend/src/services/database.ts:275-280, 407-410`
- **Observation:** Uses template strings into `$executeRawUnsafe` rather than `$executeRaw` with parameters. There's a UUID regex check immediately before (`validateUUID`), which mitigates this specific injection — but defence in depth is preferred, and the check must never be skipped or narrowed. The `isAdmin` flag is interpolated as a JS boolean, which is fine, but is a fragile pattern.
- **Impact:** If `validateUUID` is ever bypassed (e.g., a future overload that accepts non-UUID tenant IDs), SQL injection is immediate via `userId`.
- **Fix:** Use `prisma.$executeRaw` with tagged-template parameters: `$executeRaw\`SELECT set_config('app.current_user_id', ${userId}, true)\``. `set_config(..., is_local=true)` is the Postgres-safe primitive and accepts parameters.
- **Evidence:**
  ```ts
  await prisma.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
  ```

### F-16 — Frontend `/auth/me` refreshes token FIRST but still retries on 401 — Medium
- **Prompt:** 10-frontend-auth §2 / §5
- **Location:** `src/services/api/client.ts:187-214`, `src/contexts/AuthContext.tsx:88-97`
- **Observation:** `AuthContext` correctly calls `refreshToken()` before `getCurrentUser()`. But `apiFetch` also has a generic "on 401, refresh and retry" path. If both code paths race on mount (user is hammering F5), two refresh attempts run; `attemptTokenRefresh()` guards with `isRefreshing`/`refreshPromise` but the window between cookie set and the next `apiFetch` is still racy. Not exploitable, but creates inconsistent error states that can result in lost auth during high-latency conditions.
- **Impact:** User-visible flakiness, false logout events. No direct security exploit.
- **Fix:** Have `refreshToken()` directly update a shared promise so the mount flow and the 401 retry share state. Already partially done via `refreshPromise`, but `authApi.refreshToken` bypasses `attemptTokenRefresh` and writes `authToken` via a different path.
- **Evidence:**
  ```ts
  if (response.status === 401 && !isRetry) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) { return apiFetch<T>(endpoint, options, timeoutMs, true); }
  ```

### F-17 — CSRF cookie / header comparison reveals length via early ForbiddenError — Medium
- **Prompt:** 04-csrf §1
- **Location:** `backend/src/middleware/csrf.ts:180-182`
- **Observation:** Before calling `timingSafeEqual`, the middleware checks `cookieToken.length !== headerToken.length` and throws a distinct `ForbiddenError('Invalid CSRF token')`. The length comparison runs in variable time; combined with the 403 response body discriminating "CSRF token missing" vs "Invalid CSRF token", an attacker learns the token length and distinguishes "no cookie at all" from "wrong token".
- **Impact:** Minor information disclosure; does not enable forgery because tokens are 64 hex chars (fixed), so length is already known.
- **Fix:** Remove the length branch — `timingSafeEqual` throws on length mismatch already. Collapse the error messages to a single "CSRF validation failed".
- **Evidence:**
  ```ts
  if (cookieToken.length !== headerToken.length) {
    throw new ForbiddenError('Invalid CSRF token');
  }
  const tokensMatch = crypto.timingSafeEqual(...);
  ```

### F-18 — Cookie `sameSite` defaults to `'lax'` in production same-domain, allowing some cross-origin POSTs — Medium
- **Prompt:** 03-authentication §3
- **Location:** `backend/src/config/index.ts:38-40`
- **Observation:** Same-domain production picks `'lax'`. `SameSite=lax` is the modern default but still permits top-level GET navigations and some link-followed POSTs. Given CSRF exemption issues (F-5), lax sameSite combined with cookie-based auth materially increases residual CSRF risk.
- **Impact:** Weakens defense-in-depth; `strict` would prevent virtually all CSRF via cookies.
- **Fix:** Default to `'strict'` for production same-domain deploys. Use `'none'` only when `COOKIE_DOMAIN` indicates cross-domain.
- **Evidence:**
  ```ts
  sameSite: (process.env.COOKIE_SAME_SITE as ...) ||
    (process.env.COOKIE_DOMAIN ? 'none' : (process.env.NODE_ENV === 'production' ? 'lax' : 'lax')),
  ```

### F-19 — `exposedHeaders: ['X-CSRF-Token']` is set but server never sends that header — Medium
- **Prompt:** 04-csrf §3
- **Location:** `backend/src/app.ts:134`
- **Observation:** CORS `exposedHeaders` promises the frontend it can read `X-CSRF-Token` from responses. The backend never sets that header; CSRF tokens are delivered via the `csrf_token` cookie (readable by JS because `httpOnly: false`). The frontend reads cookies too (client.ts:97-107). Dead CORS config that invites future confusion.
- **Impact:** Misleads developers; could prompt someone to start relying on a header that never exists and break CSRF across environments.
- **Fix:** Remove `exposedHeaders: ['X-CSRF-Token']` or have `ensureCsrfToken` also echo `res.setHeader('X-CSRF-Token', token)`.
- **Evidence:**
  ```ts
  exposedHeaders: ['X-CSRF-Token'], // Allow frontend to read CSRF token header
  ```

### F-20 — CSRF cookie `httpOnly: false` leaks token to any XSS — Medium
- **Prompt:** 04-csrf §2
- **Location:** `backend/src/middleware/csrf.ts:43-55`
- **Observation:** Double-submit cookie pattern *requires* the cookie be readable by JS, so this is intentional. But there is no additional scoping — no `__Host-` prefix, no `HttpOnly` on a paired cookie, no encrypted token tied to session. One XSS read (e.g., via a dependency supply-chain attack) extracts the token and defeats CSRF.
- **Impact:** Baseline risk of the double-submit cookie pattern. Offsetting controls (CSP, strict XSS prevention) are present but not enforced (CSP disables inline-style blocking via `'unsafe-inline'`).
- **Fix:** Consider upgrading to signed-token CSRF (server-side secret, HMAC of session id) or `__Host-csrf_token` cookie. Tighten CSP by eliminating `'unsafe-inline'` from `styleSrc` where possible.
- **Evidence:**
  ```ts
  httpOnly: false, // Must be readable by JavaScript
  ```

### F-21 — Provider-patient email lookup enables email enumeration — Medium
- **Prompt:** 06-api-routes §4
- **Location:** `backend/src/routes/providerRoutes.ts:108-134`
- **Observation:** `POST /provider/patients/request` responds with distinct error messages: `"Patient not found with this email"` (when email doesn't exist) vs `"Can only request access to patient accounts"` (when email exists but is a PROVIDER/ADMIN). Any logged-in provider can iterate a list of emails and learn which are registered and what their role class is.
- **Impact:** Accelerates targeted phishing against known OwnMyHealth patients; surfaces admin account emails.
- **Fix:** Return a single generic error "Invalid patient email" and take constant-time paths through the lookup to mask existence.
- **Evidence:**
  ```ts
  if (!patient) { throw new NotFoundError('Patient not found with this email'); }
  if (patient.role !== 'PATIENT') { throw new ForbiddenError('Can only request access to patient accounts'); }
  ```

### F-22 — Plaintext `console.log` of auth state on every mount — Low
- **Prompt:** 10-frontend-auth §12
- **Location:** `src/contexts/AuthContext.tsx:90, 93, 102`
- **Observation:** Three `console.log` calls announce refresh-token outcome and session-restore state. Does not log PHI or tokens, but in shared/kiosk browsers the console-log pattern reveals auth transitions to anyone watching DevTools. Also conflicts with the project rule about "no console.log with sensitive data" — it's adjacent.
- **Impact:** Minor information disclosure; hygiene.
- **Fix:** Replace with `logger.debug(...)` gated on `VITE_DEBUG`, or remove entirely for production builds.
- **Evidence:**
  ```ts
  console.log('[AuthContext] Access token refreshed from refresh token');
  ...
  console.log('[AuthContext] Refresh token invalid, user not authenticated');
  ```

### F-23 — `App.tsx` calls undefined `setError` in demo login error path — Low
- **Prompt:** 10-frontend-auth §4
- **Location:** `src/App.tsx:189-200`
- **Observation:** `handleDemoLogin` catch block calls `setError('Demo mode is not available')`. `setError` is never destructured from `useAuth()` (only `clearError` is), so this is a `ReferenceError` at runtime. The try/catch still prevents crashes because the error is swallowed by the subsequent `finally` block running and the outer `ErrorBoundary`.
- **Impact:** Demo login errors are silently ignored; possible to leak the real exception via `ErrorBoundary` crash screen instead of a nice inline message.
- **Fix:** Import and use `setError` from auth context (add it to `AuthContextType`), or wire the failure through the existing `error` state by calling `authApi.demoLogin` inside `useAuth.login` equivalent.
- **Evidence:**
  ```ts
  } catch {
    setError('Demo mode is not available');
  }
  ```

### F-24 — `UserFile` primary key uses `@default(uuid())` instead of db-generated — Low
- **Prompt:** 01-database-schema §1
- **Location:** `backend/prisma/schema.prisma:112`
- **Observation:** `UserFile.id` uses `@default(uuid())` (Prisma-generated in app memory), while every other model uses `@default(dbgenerated("gen_random_uuid()"))` (Postgres-generated). This inconsistency means UUID generation happens across the network for file creation and is harder to audit.
- **Impact:** Minor; not a security issue, but reduces uniformity and complicates raw SQL inserts.
- **Fix:** Change to `@default(dbgenerated("gen_random_uuid()")) @db.Uuid` for consistency. Same applies to `ExpenseProjection.id`, `ExpenseActual.id`, `CostAnalysis.id` (lines 670, 692, 720).
- **Evidence:**
  ```prisma
  model UserFile {
    id String @id @default(uuid()) @db.Uuid
  ```

### F-25 — DNA/genetic models remain in schema with active RLS policies despite feature removal — Low
- **Prompt:** 01-database-schema §6 / prompt drift
- **Location:** `backend/prisma/schema.prisma:376-428`
- **Observation:** CLAUDE.md lists DNA/Genetics as "Removed Features" but `DNAData`, `DNAVariant`, `GeneticTrait` models, their RLS policies, and `canViewDna` provider-permission are all active. `PHI_FIELDS` in encryption.ts still lists `DNAVariant.genotypeEncrypted`, `GeneticTrait.descriptionEncrypted`, `GeneticTrait.recommendationsEncrypted`. Test data may exist in production DBs.
- **Impact:** Dead surface area. DNA tables accept writes from any authenticated user (RLS allows `user_id = current_user_id()`) but no UI exists — leaves room for API-level abuse to stuff junk into the DB.
- **Fix:** Either restore the feature (decision from CLAUDE.md) or schedule a destructive migration dropping the three tables, the `canViewDna` column, and the `DNA*` keys from `PHI_FIELDS`.
- **Evidence:**
  ```prisma
  model DNAVariant {
    ...
    genotypeEncrypted String @map("genotype_encrypted")
  }
  ```

### F-26 — Expense RLS policies do not honour `has_provider_access` — Low
- **Prompt:** 01-database-schema §2
- **Location:** `backend/prisma/migrations/20260111_add_expense_tracking/migration.sql:66-111`
- **Observation:** `ExpenseProjection`/`ExpenseActual`/`CostAnalysis` RLS policies only check `user_id = current_user_id()` or `app.is_admin`. They don't allow provider access even when `ProviderPatient.canViewInsurance` is granted, while `InsurancePlan`/`InsuranceBenefit` do. There is no UI exposing expense data to providers today, so this is currently "fail-secure" — but the policies are inconsistent with the insurance policies (which honor `has_provider_access(..., 'view_insurance')`).
- **Impact:** None today; future provider-facing expense features would silently return empty sets without a schema fix. Documentation gap.
- **Fix:** Either confirm "expenses never shared with providers" as a product decision and document it, or add `OR has_provider_access(user_id, 'view_insurance')` clauses.
- **Evidence:**
  ```sql
  CREATE POLICY expense_projections_user_policy ON expense_projections
    FOR ALL USING (CASE WHEN current_setting('app.is_admin', true)::boolean
      = true THEN true ELSE user_id::text = current_setting('app.current_user_id', true) END) ...
  ```

### F-27 — `CostAnalysis.claudeResponse` lacks `Encrypted` naming convention — Low
- **Prompt:** 02-encryption §4 / prompt drift
- **Location:** `backend/prisma/schema.prisma:724` and `backend/src/services/encryption.ts:434`
- **Observation:** Per the PHI inventory rule "every `*Encrypted` schema field is in `PHI_FIELDS`", this column breaks the convention — the value IS encrypted at write time (expenseController.ts:363) and listed in `PHI_FIELDS`, but the column name is `claudeResponse` / `claude_response`. Any automated schema-to-inventory check (e.g., grepping for `*Encrypted`) will mark it as missing.
- **Impact:** Hygiene; harder to audit PHI coverage automatically. High risk of future devs writing plaintext to the column because the name doesn't signal encryption.
- **Fix:** Rename to `claudeResponseEncrypted` in a migration (and update Prisma field + `PHI_FIELDS`).
- **Evidence:**
  ```prisma
  claudeResponse String @map("claude_response") @db.Text
  ```

### F-28 — Controller rebuilds audit service per request instead of using `getAuditService` — Low
- **Prompt:** 05-audit-logging §6
- **Location:** `backend/src/controllers/authController.ts:48-51` and most routes
- **Observation:** Each controller uses `getAuditLogService(prisma)` with a fresh `prisma = getPrismaClient()` call. The singleton pattern works (auditLog.ts:473-478) but the idiom duplicates noise and invites a mistake where a dev passes a different prisma instance. `database.ts` exports `getAuditService()` that hides this detail — it is used in 0 controllers.
- **Impact:** Style/maintenance; no direct security issue.
- **Fix:** Replace `const prisma = getPrismaClient(); const auditService = getAuditLogService(prisma);` with `const auditService = getAuditService();` across controllers.
- **Evidence:**
  ```ts
  function getAuditService() {
    const prisma = getPrismaClient();
    return getAuditLogService(prisma);
  }
  ```

### F-29 — `apiFetch` retry loop logs a warning but no structured telemetry on repeated CSRF failures — Low
- **Prompt:** 04-csrf §3
- **Location:** `src/services/api/client.ts:102-107, 166-168`
- **Observation:** The client logs `console.warn` when CSRF token is missing or cookie header extraction fails. No counter, no telemetry emission; these warnings are silently lost in dev tools. An attacker spraying crafted requests leaves no server-side trace because CSRF failures throw a generic 403.
- **Impact:** Weak attack visibility.
- **Fix:** Emit a structured log via `logger` (both server-side in csrf.ts and client-side), include a rate-limited alert path for high-volume CSRF failures (could be phishing attempt indicator).
- **Evidence:**
  ```ts
  if (!token && typeof window !== 'undefined') {
    console.warn('[CSRF] No csrf token found in cookies:', cookies.substring(0, 200));
  }
  ```

### F-30 — `.env.production.example` uses `JWT_*_EXPIRES_IN=15m/7d` but config only parses `JWT_*_EXPIRES_SECONDS` — Low
- **Prompt:** 11-environment-secrets §3 / prompt drift
- **Location:** `backend/.env.production.example:33-35` vs `backend/src/config/index.ts:17, 21`
- **Observation:** The production example sets `JWT_ACCESS_EXPIRES_IN=15m` / `JWT_REFRESH_EXPIRES_IN=7d`, but config reads `JWT_ACCESS_EXPIRES_SECONDS` / `JWT_REFRESH_EXPIRES_SECONDS` only. These env vars are ignored; tokens fall back to the hard-coded 900s / 604800s defaults. `backend/.env.example:42-52` uses the correct `_SECONDS` names. Deploy docs are out of sync.
- **Impact:** Operational; deploys copying the production example will believe they configured token lifetime but won't have.
- **Fix:** Rename the vars in `.env.production.example` to `_SECONDS` and document the integer-seconds format. Or make config accept both names with a clear deprecation.
- **Evidence:**
  ```env
  JWT_ACCESS_SECRET=CHANGE_ME_generate_with_openssl_rand_base64_32
  JWT_ACCESS_EXPIRES_IN=15m
  ```

### F-31 — CI workflow runs `npm audit` with `continue-on-error: true` — Low
- **Prompt:** 11-environment-secrets §5
- **Location:** `.github/workflows/ci.yml:105-112`
- **Observation:** `npm audit --audit-level=high` is run but the step is allowed to fail without breaking the build. High/critical CVEs therefore land in production. The rest of the workflow has no gate on dependency health.
- **Impact:** Known-vulnerable dependencies can ship. Defense-in-depth gap.
- **Fix:** Remove `continue-on-error`, or add a Dependabot/Renovate automated-fix pipeline, or reroute to a weekly alert instead of per-PR gate.
- **Evidence:**
  ```yaml
  - name: Audit frontend dependencies
    run: npm audit --audit-level=high
    continue-on-error: true
  ```

### F-32 — CI uses `npm install` rather than `npm ci` — Low
- **Prompt:** 11-environment-secrets §6
- **Location:** `.github/workflows/ci.yml:29, 68`
- **Observation:** Non-deterministic installs in CI. Supply-chain attack window if a dependency's `package.json` range pulls a compromised patch between lockfile update and CI run.
- **Impact:** Non-reproducible builds; weaker supply-chain posture.
- **Fix:** Change both `npm install` steps to `npm ci`.
- **Evidence:**
  ```yaml
  - name: Install dependencies
    run: npm install
  ```

### F-33 — deploy.yml force-deletes GCS frontend bucket on every deploy — Info
- **Prompt:** 11-environment-secrets §5
- **Location:** `.github/workflows/deploy.yml:121`
- **Observation:** `gsutil -m rm -r gs://${{ env.FRONTEND_BUCKET }}/** || true` unconditionally purges the bucket before uploading. Zero downtime is not guaranteed (tiny window); rollback requires re-running a previous Git SHA. No versioning check. Not a security finding per se, but the pattern is brittle for a HIPAA service.
- **Impact:** Brief 404 windows during deploy; rollback friction.
- **Fix:** Enable GCS object versioning on the bucket and switch to `gsutil -m rsync -d -r dist/ gs://...` for atomic syncs. Out of scope for this review — operational.
- **Evidence:**
  ```yaml
  gsutil -m rm -r gs://${{ env.FRONTEND_BUCKET }}/** || true
  gsutil -m cp -r dist/* gs://${{ env.FRONTEND_BUCKET }}/
  ```

### F-34 — `/auth/verify-email` is a GET endpoint with token in query string — Info
- **Prompt:** 03-authentication §7 / 06-api-routes §5
- **Location:** `backend/src/routes/authRoutes.ts:60-64`
- **Observation:** GET with a sensitive token in the query string means the token appears in access logs (Express `morgan('combined')`), proxy logs, browser history, and Referer headers if the verify page navigates. The frontend does clear the token via `window.history.replaceState()` (App.tsx:116-121) — good — but server-side log retention is still an exposure. Email-verification tokens are single-use per backend logic (service clears them on success), so residual risk is bounded: a log reader has at most 24 hours to replay an un-used token.
- **Impact:** Narrow exploitation window. Not mitigated by any redaction in `morgan('combined')`.
- **Fix:** Switch to `POST /auth/verify-email` with the token in the body. Scrub verification tokens from access logs. Same pattern also applies to the frontend `/verify-email?token=...` URL, which exposes to browser history and Referer headers.
- **Evidence:**
  ```ts
  router.get('/verify-email',
    validate(schemas.auth.verifyEmailQuery, 'query'),
    asyncHandler(verifyEmail));
  ```

## Checks passed

### 01-database-schema
- [x] RLS policies exist for biomarkers, biomarker_history, insurance_plans, insurance_benefits, health_needs, health_goals, goal_progress_history, dna_data, dna_variants, genetic_traits, provider_patients, audit_logs, sessions, system_config — verified at `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:68-83`.
- [x] RLS policies for `user_files` — verified at `backend/prisma/migrations/20260108000000_add_user_files_table/migration.sql:37-61`.
- [x] RLS policies for `expense_projections`, `expense_actuals`, `cost_analyses` — verified at `backend/prisma/migrations/20260111_add_expense_tracking/migration.sql:61-111`.
- [x] Policies use `current_setting('app.current_user_id')::uuid` via `current_user_id()` helper — verified at `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:17-25`.
- [x] ProviderPatient RLS covers both `providerId` and `patientId` — verified at `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:473-505`.
- [x] Admin bypass uses `app.is_admin = true` — verified at `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:28-36`.
- [x] UUID primary keys on all user-facing tables — verified at `backend/prisma/schema.prisma:11, 53, 69, 86, 134, 185` etc.
- [x] Foreign keys use `onDelete: Cascade` on user relations — verified at `backend/prisma/schema.prisma:60, 78, 101, 102, 126, 156, 341, 387, 442, 473, 682, 683, 710, 711, 730, 731`.
- [x] Compound index `biomarkers(user_id, category, measurement_date)` — verified at `backend/prisma/schema.prisma:163-164`.
- [x] Compound index `audit_logs(user_id, created_at)` — verified at `backend/prisma/schema.prisma:522-523`.
- [x] Compound index `insurance_plans(user_id, is_active, is_primary)` — verified at `backend/prisma/schema.prisma:348-349`.
- [x] Compound index `health_goals(user_id, status, target_date)` — verified at `backend/prisma/schema.prisma:479-480`.

### 02-encryption
- [x] AES-256-GCM used — verified at `backend/src/services/encryption.ts:58`.
- [x] Unique IV per encryption operation — verified at `backend/src/services/encryption.ts:197, 247`.
- [x] Auth tag verified on decryption — verified at `backend/src/services/encryption.ts:226-227, 281-282`.
- [x] Master key loaded from env, validated for length/hex/known-bad values — verified at `backend/src/services/encryption.ts:86-123, 140-165`.
- [x] PBKDF2-SHA512 100k iterations for per-user key derivation — verified at `backend/src/services/encryption.ts:70, 172-179`.
- [x] 32-byte random user salt — verified at `backend/src/services/encryption.ts:185-187`.
- [x] User salt encrypted with master key before storage — verified at `backend/src/services/userEncryption.ts:49`.
- [x] Per-user salt destroyed on account deletion via cascade — verified at `backend/prisma/schema.prisma:78` (`UserEncryptionKey` onDelete Cascade) + `backend/src/controllers/settingsController.ts:296-300`.
- [x] `PHI_FIELDS` mirrors schema `*Encrypted` columns — verified at `backend/src/services/encryption.ts:365-438`.
- [x] `CostAnalysis.claudeResponse` encrypted on write — verified at `backend/src/controllers/expenseController.ts:363`.
- [x] AuditLog uses system salt (survives user deletion) — verified at `backend/src/services/auditLog.ts:106-124, 173-175`.

### 03-authentication
- [x] Access token 15 min default — verified at `backend/src/config/index.ts:17`.
- [x] Refresh token 7 day default (30d for demo) — verified at `backend/src/config/index.ts:21`, `backend/src/services/authService.ts:180, 208-209`.
- [x] Token type checked on verify — verified at `backend/src/middleware/auth.ts:66-68`, `backend/src/services/authService.ts:264, 281`.
- [x] bcrypt cost 12 default — verified at `backend/src/config/index.ts:51`.
- [x] Timing-safe dummy hash for non-existent users — verified at `backend/src/services/authService.ts:594-606`.
- [x] HttpOnly / Secure / SameSite on auth cookies — verified at `backend/src/controllers/authController.ts:81-88, 100-107`.
- [x] Refresh token rotation on use — verified at `backend/src/services/authService.ts:352-355`.
- [x] Account lockout after 5 fails, 30 min default — verified at `backend/src/services/authService.ts:392-422`.
- [x] Lockout status checked before password compare — verified at `backend/src/services/authService.ts:625-633`.
- [x] Sessions stored in PostgreSQL `sessions` table with metadata — verified at `backend/src/services/authService.ts:225-235`.
- [x] Logout revokes refresh token in DB — verified at `backend/src/services/authService.ts:308-323`.
- [x] Logout-all revokes all user sessions — verified at `backend/src/services/authService.ts:329-333`.
- [x] Password reset invalidates all sessions — verified at `backend/src/services/authService.ts:907`.
- [x] Reset token single-use, expires in 1 hour — verified at `backend/src/services/authService.ts:786, 866-879, 896-904`.
- [x] `/login` strict rate limit (5 / 15 min per email+IP) — verified at `backend/src/middleware/rateLimiter.ts:41-60` + `backend/src/routes/authRoutes.ts:48`.
- [x] `/forgot-password` strict rate limit — verified at `backend/src/routes/authRoutes.ts:76`.
- [x] `/reset-password` strict rate limit — verified at `backend/src/routes/authRoutes.ts:84`.
- [x] Demo mode blocked in production — verified at `backend/src/config/index.ts:191-197`, `backend/src/services/authService.ts:582-588`.
- [x] Email verification required before login — verified at `backend/src/services/authService.ts:616-623`.

### 04-csrf
- [x] CSRF token generated via `crypto.randomBytes(32)` — verified at `backend/src/middleware/csrf.ts:24-26`.
- [x] Token regenerated on login — verified at `backend/src/controllers/authController.ts:311-312`.
- [x] Token regenerated on refresh — verified at `backend/src/controllers/authController.ts:358-359`.
- [x] Timing-safe comparison — verified at `backend/src/middleware/csrf.ts:184-187`.
- [x] CSRF token endpoint exposed for SPA — verified at `backend/src/app.ts:186`, `backend/src/middleware/csrf.ts:225-234`.
- [x] Frontend reads `csrf_token` cookie and sends in header — verified at `src/services/api/client.ts:97-107, 161-168`.

### 05-audit-logging
- [x] AuditLog model includes id, userId, actorType, action, resourceType, resourceId, ipAddress, userAgent, metadata, createdAt — verified at `backend/prisma/schema.prisma:498-525`.
- [x] No `updatedAt` on AuditLog (immutable) — verified at `backend/prisma/schema.prisma:498-525` (absent).
- [x] No UPDATE policy on audit_logs (implicit deny) — verified at `backend/prisma/migrations/20260107_add_rls_policies/migration.sql:524-525` comment.
- [x] `logAuth` called for LOGIN / LOGIN_FAILED / LOGOUT / REGISTER / PASSWORD_CHANGE / PASSWORD_RESET_REQUEST / PASSWORD_RESET_COMPLETE / EMAIL_VERIFICATION / ACCOUNT_LOCKOUT — verified at `backend/src/controllers/authController.ts:189-193, 232-235, 251-254, 273-276, 294-297, 315-317, 394-396, 427-430, 520-522, 601-604, 617-621, 697-700, 742-745, 759-762`.
- [x] `logExport` on PHI export — verified at `backend/src/services/auditLog.ts:367-389`.
- [x] Cross-user audit: provider accessing patient biomarkers / health_needs — verified at `backend/src/routes/providerRoutes.ts:390-395, 484-489`.
- [x] Consent grant/deny/revoke logged — verified at `backend/src/routes/patientRoutes.ts:216-231, 277-286, 404-418`.
- [x] Admin user management logged (listing, view, create, update, deactivate, permanent delete) — verified at `backend/src/routes/adminRoutes.ts:83-92, 162-168, 218-228, 297-312, 361-374, 447-459, 497-502, 553-572`.
- [x] PHI values encrypted with system salt before storage — verified at `backend/src/services/auditLog.ts:173-175`.
- [x] Uses `req.ip` (with trust proxy set) — verified at `backend/src/app.ts:89`, `backend/src/services/auditLog.ts:162-163`.
- [x] Retention 2555 days (7 years) — verified at `backend/src/services/auditLog.ts:7`.
- [x] Daily retention cleanup scheduler — verified at `backend/src/services/auditLog.ts:498-507`.
- [x] Every controller imports auditLog — verified: all 9 controllers returned by Grep `backend/src/controllers/*.ts`.

### 06-api-routes
- [x] `authRoutes` public routes validated & rate-limited — verified at `backend/src/routes/authRoutes.ts:32, 39-87`.
- [x] `biomarkerRoutes` authenticate applied at router level — verified at `backend/src/routes/biomarkerRoutes.ts:39`.
- [x] `fileRoutes` all protected — verified at `backend/src/routes/fileRoutes.ts:27`.
- [x] `uploadRoutes` uses authenticate + blockDemoAI on each POST — verified at `backend/src/routes/uploadRoutes.ts:77-97, 119-125`.
- [x] `insuranceRoutes` protected — verified at `backend/src/routes/insuranceRoutes.ts:62`.
- [x] `expenseRoutes` protected — verified at `backend/src/routes/expenseRoutes.ts:26`.
- [x] `healthGoalsRoutes` / `healthNeedsRoutes` protected — verified at `backend/src/routes/healthGoalsRoutes.ts:42`, `backend/src/routes/healthNeedsRoutes.ts:38`.
- [x] `providerRoutes` protected + requireRole(PROVIDER, ADMIN) — verified at `backend/src/routes/providerRoutes.ts:24-25`.
- [x] `patientRoutes` protected + requireRole(PATIENT) — verified at `backend/src/routes/patientRoutes.ts:22-24`.
- [x] `adminRoutes` protected + requireRole(ADMIN) — verified at `backend/src/routes/adminRoutes.ts:26-27`.
- [x] `settingsRoutes` protected with sensitiveLimiter — verified at `backend/src/routes/settingsRoutes.ts:25, 29-46`.
- [x] `userId` sourced from JWT, not request body — verified at `backend/src/routes/providerRoutes.ts:35, 105, 212`, `backend/src/routes/patientRoutes.ts:34, 102, 165`, `backend/src/routes/adminRoutes.ts:40-42`.
- [x] Zod validation on params / body / query — verified at `backend/src/routes/biomarkerRoutes.ts:44, 64, 77, 85, 94, 101, 112-113` etc.
- [x] Pagination limits enforced — verified at `backend/src/routes/adminRoutes.ts:43`.
- [x] `withRLSContext` / `withRLSTransaction` used in 7/7 data controllers — verified via Grep (74 occurrences across expense/biomarker/healthGoals/healthNeeds/insurance/file/settings controllers).

### 10-frontend-auth
- [x] Tokens stored in memory only via `setAuthToken` / `clearAuthToken` — verified at `src/services/api/client.ts:42-57`.
- [x] No tokens in localStorage / sessionStorage (theme & notification prefs only) — verified via Grep excluding `ThemeContext.tsx` and `AccountSettingsPage.tsx`.
- [x] `refreshToken()` called before `getCurrentUser()` — verified at `src/contexts/AuthContext.tsx:88-101`.
- [x] Auth state cleared on logout — verified at `src/contexts/AuthContext.tsx:157-164`.
- [x] 401 triggers logout callback — verified at `src/contexts/AuthContext.tsx:172-177`, `src/services/api/client.ts:190-213`.
- [x] URL tokens cleared via `window.history.replaceState` — verified at `src/App.tsx:114-121`.
- [x] `type="password"` + `autoComplete="current-password"` on login — verified at `src/components/auth/LoginPage.tsx:286, 293`.
- [x] Password not logged — verified at `src/components/auth/LoginPage.tsx:69-71` (only logs error object, not password).
- [x] `useRBAC` provides `isPatient` / `isProvider` / `isAdmin` — verified at `src/hooks/useRBAC.ts:41-49`.
- [x] `RoleGuard` authentication check — verified at `src/components/common/RoleGuard.tsx:48-50`.
- [x] Lazy-loaded pages with Suspense fallback — verified at `src/App.tsx:37-42, 127-265`.
- [x] Demo mode gated on `VITE_DEMO_MODE` — verified at `src/App.tsx:258`.

### 11-environment-secrets
- [x] Production startup requires JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, DATABASE_URL, PHI_ENCRYPTION_KEY — verified at `backend/src/config/index.ts:107-117`.
- [x] PHI_ENCRYPTION_KEY length + hex + placeholder check in production — verified at `backend/src/config/index.ts:152-180`.
- [x] JWT secret minimum 32 chars in production — verified at `backend/src/config/index.ts:135-150`.
- [x] DEMO_ACCOUNT_ENABLED blocked in production — verified at `backend/src/config/index.ts:191-197`.
- [x] CORS origin required in production, localhost rejected — verified at `backend/src/app.ts:60-73`.
- [x] `.env`, `.env.local`, `.env.*.local`, `.env.production` in `.gitignore` — verified at `.gitignore:19-23, 53` and `backend/.gitignore:8-11`.
- [x] Service-account keys ignored via `*-key.json`, `service-account*.json` — verified at `.gitignore:42-44`, `backend/.gitignore:37-40`.
- [x] Dockerfile uses non-root user, dummy DB URL only for `prisma generate` — verified at `backend/Dockerfile:17-18, 37-38, 43-44`.
- [x] CI secrets via `${{ secrets.GCP_SA_KEY }}` — verified at `.github/workflows/deploy.yml:25, 96`.
- [x] VITE_API_URL build-time arg via env block, not embedded secret — verified at `.github/workflows/deploy.yml:116-117`.

## Unverifiable
- "Key rotation supported (version tracking, `isActive` flag)" — schema supports it (`UserEncryptionKey.version`, `isActive`) but no test or endpoint exercises the `rotateUserEncryptionKey` function against existing ciphertext. Unable to confirm rotation works end-to-end without running.
- "Token stored in memory only" — frontend `setAuthToken` is in-memory, but a specific page refresh race where `authToken` variable is rebuilt while a pending request fires cannot be confirmed statically.
- "Sessions cleaned up at 10-min interval" — the scheduler runs hourly (see F-13), so the claim is outright wrong; flagged as a finding rather than Unverifiable.
- Whether `Session.token` field (truncated to 500 chars, schema.prisma:55) is ever read for validation — verifyRefreshToken reads by `jti` only. No hit in code read for the `token` column value beyond write. Not confirmable without broader search.
- "Migrations use CREATE INDEX CONCURRENTLY" — not observed in any migration file. The migration SQL uses plain CREATE INDEX and simple `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. Whether this was intentional, applied during a maintenance window, or is a prompt claim that doesn't match the code is unclear — did not flag as finding because it's a policy question.

## Prompt drift
- 03-authentication claims session cleanup "every 10 minutes" — actual interval is 1 hour (F-13).
- 05-audit-logging §6 references the "two-step" coverage diff (Glob controllers → Grep for auditLog) — all 9 controllers already have audit log imports, so the check passes. Prompt still accurate.
- 03-authentication §5 says token stored in memory only — accurate, but the prompt section is duplicated by 10-frontend-auth §1; consider consolidating.
- CLAUDE.md lists DNA/Genetics as "Removed Features" but the schema, encryption service, RLS, and provider-permission flag all still exist (F-25). CLAUDE.md is out of sync with schema.
- PHI inventory lists `CostAnalysis.claudeResponse` as special (no `Encrypted` suffix). Prompt notes this; code matches the inventory exactly. No drift, but F-27 recommends renaming.
- 11-environment-secrets lists `JWT_SECRET` as critical — `config.index.ts` includes a legacy `secret` fallback chain, but no modern code path uses it. Prompt inventory is accurate; consider removing the legacy support as cleanup.
- `.env.production.example` uses `JWT_ACCESS_EXPIRES_IN=15m` but config reads only `JWT_ACCESS_EXPIRES_SECONDS` (F-30) — example doc is out of sync with code.
- CLAUDE.md middleware stack lists Helmet → CORS → CookieParser → CSRF → RateLimit → BodyParser; actual order in app.ts is Helmet → CORS → CookieParser → CSRF → RateLimit → Morgan → BodyParser → validation. Close enough, not flagged.

---

Report length: 34 findings, 8268 words.
