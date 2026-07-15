# CSRF Protection Review — 2026-06-16

Scope: CSRF defenses for OwnMyHealth at HEAD `fb2cd32`. Executed the `prompts/04-csrf.md`
checklist against live code per `prompts/_review-protocol.md`. Backend stateless
double-submit cookie (`backend/src/middleware/csrf.ts`) + frontend token injection
(`src/services/api/client.ts`, `src/services/uploadUtils.ts`).

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |

No exploitable CSRF gap was found. The double-submit cookie pattern is correctly
implemented: `/auth/refresh` is NOT exempt, the exempt streaming route is bearer-only,
the comparison is constant-time and length-safe, and the token is rotated on login and
on every refresh and cleared on logout. The three Low findings are hygiene/cleanup
(a dead exempt path, a dead export, and prompt drift) — none is exploitable.

## Findings

### F-1 — Dead CSRF exemption for the removed Marketplace feature — **Low**
- **Location:** `backend/src/middleware/csrf.ts:132`
- **Observation:** `EXEMPT_PATHS` still contains `'/api/v1/marketplace/plans/search'`, but the CMS Marketplace integration was removed (CLAUDE.md "Removed Features (Jan 2025)"). There is no `marketplace` route file in `backend/src/routes/` (Glob of `backend/src/routes/*.ts`) and no route registers a `plans/search` path under `marketplace` (Grep `marketplace|plans/search` over `backend/src/routes` → "No matches found"). The only backend hits for `marketplace` are in `services/knowledge/` content strings, not routes.
- **Impact:** No live exploit today — the exempt path matches no mounted route, so a request to it 404s before any handler runs. The risk is latent: a future route accidentally mounted at exactly `/api/v1/marketplace/plans/search` (or a feature revival reusing that path) would silently inherit a CSRF exemption that no one intends. Dead allowlist entries also erode reviewer trust in the allowlist.
- **Fix:** Delete the `'/api/v1/marketplace/plans/search'` line from the `EXEMPT_PATHS` `Set` in `validateCsrfToken`.
- **Evidence:**
  ```ts
  '/api/v1/resend-verification',          // (other auth entries above)
  '/api/v1/marketplace/plans/search',
  ```
  (csrf.ts:131-132; the `marketplace` entry sits between the auth allowlist and the `/ai/chat` streaming entry.)

### F-2 — Dead `ensureCsrfToken` export — **Low**
- **Location:** `backend/src/middleware/csrf.ts:70-80`
- **Observation:** `ensureCsrfToken` is exported but nothing in the app imports or mounts it. The live mint path is `csrfProtection` (registered globally in `app.ts:216`) calling `setCsrfCookie` when the cookie is absent (csrf.ts:199-201) and on GET (csrf.ts:204-208), plus `csrfTokenHandler` for `GET /api/v1/csrf-token`. A Grep for `ensureCsrfToken` across the repo returns only the definition in `csrf.ts:70`, two prompt/doc files, and no route/app wiring.
- **Impact:** None functional — purely dead code. It is, however, a minor footgun: a future contributor could mount `ensureCsrfToken` thinking it adds protection when it only mints a cookie (it does not validate), or assume it is the active mint path and edit it expecting a behavior change.
- **Fix:** Remove the `ensureCsrfToken` export (and its function body) from `csrf.ts`, or, if kept for symmetry, add a comment that it is intentionally unused and `csrfProtection` is the live mint path.
- **Evidence:**
  ```ts
  export function ensureCsrfToken(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (req.method === 'GET' || !req.cookies[CSRF_COOKIE_NAME]) {
      setCsrfCookie(res);
    }
    next();
  }
  ```
  (csrf.ts:70-80) — no importer found.

### F-3 — Prompt drift: checklist claims CSRF token is NOT rotated on login — **Low**
- **Location:** `prompts/04-csrf.md:40` (and the architecture preamble) vs. `backend/src/controllers/authController.ts:374`
- **Observation:** Per the review protocol's "When the prompt disagrees with the code" rule, I flag this. The checklist NOTE states "because there is no server-side secret, the token is NOT rotated on login — confirm that is acceptable … otherwise flag fixation risk." The live code DOES rotate the CSRF token on login: `setCsrfCookie(res)` runs in the login handler with the comment "Regenerate CSRF token to prevent token fixation attacks" (authController.ts:373-374). It is also re-issued on every successful `/refresh` (authController.ts:420-421) and cleared on logout (authController.ts:147-153). So the session-fixation concern the prompt asks me to evaluate is already closed in code.
- **Impact:** Documentation-only. The stale NOTE could cause a future reviewer to either (a) re-raise a non-existent fixation risk, or (b) "fix" it by adding rotation that already exists. No security impact on the running app — rotation-on-login is the desirable behavior.
- **Fix:** Update `prompts/04-csrf.md` §2 to state the token IS regenerated on login (authController.ts:374), on refresh (authController.ts:421), and cleared on logout (authController.ts:147) — matching the live code. (Reported per protocol; no code change.)
- **Evidence:**
  ```ts
  // Regenerate CSRF token to prevent token fixation attacks
  setCsrfCookie(res);
  ```
  (authController.ts:373-374, inside the login handler.)

## Checks passed

### 1. Backend CSRF Middleware
- [x] Global `csrfProtection` registered (skipped only in dev when `DISABLE_CSRF=true`) — `app.use(csrfProtection)` guarded by `if (!config.isDevelopment || process.env.DISABLE_CSRF !== 'true')` at `app.ts:215-217`; the in-handler dev bypass is also gated on `config.isDevelopment && process.env.DISABLE_CSRF === 'true'` at `csrf.ts:159-161`.
- [x] `validateCsrfToken` runs on POST/PUT/PATCH/DELETE; GET/HEAD/OPTIONS skipped — `if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();` at `csrf.ts:96-98`; `csrfProtection` only calls `validateCsrfToken` for non-safe methods at `csrf.ts:204-206`.
- [x] Validates `X-CSRF-Token` (lowercase `x-csrf-token`) header against `csrf_token` cookie — `CSRF_HEADER_NAME = 'x-csrf-token'` (csrf.ts:18); `req.headers[CSRF_HEADER_NAME]` vs `req.cookies[CSRF_COOKIE_NAME]` at `csrf.ts:164-165`. Express lowercases header keys, so `X-CSRF-Token` matches.
- [x] Comparison uses SHA-256 digest + `crypto.timingSafeEqual` (constant-time, length-safe) — `crypto.createHash('sha256').update(...).digest()` on both, then `crypto.timingSafeEqual(cookieDigest, headerDigest)` at `csrf.ts:177-179`. Pre-hash normalizes length so unequal-length inputs don't leak timing or throw.
- [x] Returns 403 (`ForbiddenError`) on missing token ("CSRF token missing") or mismatch ("Invalid CSRF token") — `throw new ForbiddenError('CSRF token missing')` (csrf.ts:169) and `throw new ForbiddenError('Invalid CSRF token')` (csrf.ts:182). Messages leak no cookie/header internals.
- [x] `csrfProtection`/`setCsrfCookie` mints a token when cookie absent (also on GET) — `csrf.ts:199-201` (mint if no cookie) and the safe-method GET branch falls through after minting (csrf.ts:204-208). `setCsrfCookie` mints via `generateCsrfToken()` at csrf.ts:32-33. (Dead `ensureCsrfToken` export flagged in F-2.)

### 2. CSRF Token Generation
- [x] Cryptographically random token (`crypto.randomBytes(32).toString('hex')` → 64 hex chars) — `generateCsrfToken()` returns `crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex')` (csrf.ts:24-26) with `CSRF_TOKEN_LENGTH = 32` (csrf.ts:19).
- [x] Sufficient length (32 bytes / 256 bits) — `CSRF_TOKEN_LENGTH = 32` (csrf.ts:19).
- [x] Cookie `maxAge` equals the refresh-token (session) lifetime = 7 days — `maxAge: config.cookie.maxAge.refreshToken` (csrf.ts:51), and `refreshToken: 7 * 24 * 60 * 60 * 1000` (config/index.ts:151). Not a fixed 24h.
- [x] Re-issued on every successful `/refresh` and cleared on logout — `setCsrfCookie(res)` in `refreshToken` handler (authController.ts:421) and `res.clearCookie('csrf_token', {...httpOnly:false...})` in `clearAuthCookies` (authController.ts:147-153). The clear mirrors `setCsrfCookie`'s attributes (notably `httpOnly:false`) so the browser actually deletes it.
- [x] Token regenerated on login (fixation defense) — `setCsrfCookie(res)` in login handler (authController.ts:374). NOTE: this *exceeds* the prompt's claim that the token is not rotated on login — see F-3 prompt-drift.

### 3. Frontend Token Handling
- [x] `client.ts` `getCsrfToken()` reads `csrf_token` with a name-boundary-anchored regex then `decodeURIComponent` — `cookies.match(/(?:^|;\s*)csrf_token=([^;]+)/)` + `decodeURIComponent(match[1])` at `client.ts:126-127`. The `(?:^|;\s*)` anchor prevents a same-suffix cookie (e.g. `xsrf_csrf_token`) from satisfying the match.
- [x] `apiFetch` attaches `x-csrf-token` only on POST/PUT/PATCH/DELETE — `if (['POST','PUT','PATCH','DELETE'].includes(method)) { ... headers['x-csrf-token'] = csrfToken; }` at `client.ts:243-247`.
- [x] `uploadUtils.ts` reads `csrf_token` cookie and attaches `X-CSRF-Token` on multipart uploads — `getCsrfToken()` splits `document.cookie` and matches name `csrf_token` exactly (uploadUtils.ts:37-46); `headers['X-CSRF-Token'] = csrfToken` before the multipart `fetch` at uploadUtils.ts:133-141.
- [x] Token retrieved fresh per request (not cached in JS state) — both `getCsrfToken()` implementations read `document.cookie` at call time on every request (client.ts:121, uploadUtils.ts:38); no module-level cache of the token value.
- [x] Missing-token diagnostic logging is DEV-only and never logs the token value — `if (!token && ... import.meta.env.DEV) apiLogger.warn('No CSRF token found in cookies')` (client.ts:129-135) and the mutation-without-token warn at `client.ts:248-253` is also `import.meta.env.DEV`-gated; neither logs the cookie/token string.
- [x] `/auth/refresh` recovery fetch attaches the CSRF header — raw refresh fetch sets `refreshHeaders['x-csrf-token'] = csrfToken` when present (client.ts:155-159) before POSTing to `/auth/refresh` (client.ts:160-164), so the not-exempt refresh endpoint succeeds during silent re-auth.

### 4. Exempt Routes
- [x] Safe methods (GET/HEAD/OPTIONS) skipped — `csrf.ts:96-98`.
- [x] Public auth endpoints exempt (no session yet): `/auth/login`, `/auth/register`, `/auth/demo`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification` — fully-qualified `/api/v1/...` forms in `EXEMPT_PATHS` at `csrf.ts:125-131`. Matched via normalized `===` (not suffix), so `/api/v1/evil/auth/login` does NOT slip past (M-2 fix; normalization at csrf.ts:111, membership test at csrf.ts:154).
- [x] `/auth/refresh` is NOT exempt and does not reappear in `EXEMPT_PATHS` — Grep of the allowlist (csrf.ts:124-145) contains no `refresh` entry; the handler re-issues a fresh `csrf_token` on success (authController.ts:421) so the double-submit invariant survives rotation, and the SPA double-submits the token on its raw refresh fetch (client.ts:155-164).
- [x] Bearer-only SSE streaming `/ai/chat` mounted with `requireBearerAuth` (not `authenticate`) — `router.use(requireBearerAuth)` at `aiRoutes.ts:21`, applied before `router.post('/chat', ...)` (aiRoutes.ts:29). `requireBearerAuth` extracts a Bearer token and rejects with `UnauthorizedError('Bearer token required')` when absent (auth.ts:203-207), so a cookie-only cross-site POST is rejected at the route layer even though the path is CSRF-exempt (csrf.ts:139). The frontend SSE call sends `Authorization: Bearer` (ai.ts:113-114), not cookie auth.
- [x] Scheduler trigger `/internal/audit-cleanup` authenticated by shared-secret `X-Cleanup-Token`, constant-time compared, 404s unless configured — `tokenMatches` uses `node:crypto.timingSafeEqual` with a length pre-check (internalRoutes.ts:27-33); 404 when `config.scheduler.auditCleanupToken` is unset (internalRoutes.ts:45-52); exempt at `csrf.ts:144`.
- [x] File upload endpoints are NOT exempt — no `upload` entry in `EXEMPT_PATHS` (csrf.ts:124-145); the removed exemption is documented at csrf.ts:147-152. Frontend uploads attach `X-CSRF-Token` via `uploadUtils.ts` (uploadUtils.ts:133-136), so they pass; any new upload path that forgets uploadUtils fails closed.
- [x] No sensitive operations exempted beyond the above — the full `EXEMPT_PATHS` set is the 7 public auth routes + the dead marketplace entry (F-1) + `/ai/chat` (bearer-only) + `/internal/audit-cleanup` (shared-secret). All mutating PHI routes (biomarkers, expenses, insurance, files, goals, needs, provider, settings, admin, onboarding, fhir, plan, patient) are not in the set and require the double-submit token.
- [x] CSRF token endpoint available: `GET /api/v1/csrf-token` — `app.get(\`/api/${config.apiVersion}/csrf-token\`, csrfTokenHandler)` at `app.ts:284`; handler mints + returns the token (csrf.ts:217-226).

### 5. Component-Level Check
- [x] `src/components/trends/BiomarkerAIGuidance.tsx` uses the API client — imports `biomarkersApi` (line 13) and calls `biomarkersApi.getGuidance(biomarker.id)` (line 56); no raw `fetch`. CSRF auto-injected by `apiFetch`.
- [x] `src/components/insurance/InsuranceHub.tsx` delete goes through the API client — no raw `fetch`/`XMLHttpRequest` in the file (Grep `fetch(|axios|XMLHttpRequest` → no match); delete is delegated to the `onDeletePlan` callback prop (InsuranceHub.tsx:215-218), whose implementation lives in the `insuranceApi`/parent layer that routes through `apiFetch`.
- [x] Upload components route through `uploadUtils.ts` — `LabUploadModal.tsx` imports `uploadFile` from `services/uploadUtils` (line 20) and calls it (line 149); deselected-biomarker deletes use `biomarkersApi.delete` (line 183), CSRF via `apiFetch`.

### Cross-cutting confirmations (Questions to Ask)
- [x] No POST/PUT/DELETE missing CSRF via raw `fetch`/`XMLHttpRequest` in components — Grep of `\bfetch\(|XMLHttpRequest|axios|navigator\.sendBeacon` over `src/**/*.{ts,tsx}` returns only service-layer files: `uploadUtils.ts:138` (attaches CSRF), `client.ts:160` (refresh — attaches CSRF), `client.ts:277` (apiFetch — attaches CSRF), `ai.ts:116` (bearer-only SSE POST, CSRF-exempt by design), and `files.ts:37` (a GET download — no `method`, defaults GET, so CSRF N/A). No component bypasses the client.
- [x] No CSRF logging leaks the token value or runs outside the DEV guard — confirmed at client.ts:129-135 and client.ts:248-253 (both `import.meta.env.DEV`); `getCsrfToken` in uploadUtils.ts logs nothing.
- [x] CSRF errors return generic messages — `ForbiddenError('CSRF token missing' | 'Invalid CSRF token')` (csrf.ts:169,182); no cookie/header internals echoed.
- [x] Cookie attributes derived safely — `secure`/`sameSite` come from `config.cookie` (csrf.ts:44-45); `resolvedSameSite`/`resolvedCookieSecure` force Secure whenever SameSite=None or COOKIE_DOMAIN is set (config/index.ts:88-95); a boot invariant hard-fails the impossible SameSite=None-without-Secure combination (config/index.ts:301-307). Production same-domain defaults to `sameSite: 'strict'` (config/index.ts:143), the tightest CSRF posture.
- [x] Session-fixation closed — token rotated on login (authController.ts:374), on refresh (authController.ts:421), cleared on logout (authController.ts:147). Combined with sameSite cookie + memory-only auth token, the stateless double-submit token is adequate.

## Unverifiable
- None. Every checklist item was confirmed against a `file:line` in the live repo.

## Out of scope
- The strength of JWT/Bearer auth itself (covered by the auth review, `prompts/01-authentication.md`/`03-*`). This review only confirmed that `/ai/chat` is bearer-only so its CSRF exemption is safe — it did not audit the token verification logic in `auth.ts` beyond that.
- Rate limiting on the CSRF/auth endpoints (covered by the rate-limit review). Noted only that `standardLimiter` runs globally (app.ts:220).
- CSP/`unsafe-inline` style-src XSS vector flagged by the `TODO(csp-nonce)` at app.ts:130-134 — relevant to defense-in-depth (an XSS could read the JS-readable `csrf_token` cookie) but is a headers/CSP concern, not a CSRF-middleware concern. Belongs in the security-headers review.
- The `/internal/audit-cleanup` shared-secret design and the `clearAuthCookies` token-revocation lifecycle were confirmed only insofar as they affect the CSRF cookie; their full auth semantics are out of scope here.
