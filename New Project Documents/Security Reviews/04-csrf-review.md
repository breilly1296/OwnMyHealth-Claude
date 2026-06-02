# 04-csrf Review — 2026-06-01

Scope: CSRF protection for the OwnMyHealth backend (`backend/src/middleware/csrf.ts`, `app.ts`, route exemptions) and the frontend mutation paths (`src/services/api/client.ts`, `src/services/uploadUtils.ts`, `ai.ts`, components). Method: read every file named in the spec, traced exemptions against the live route definitions, and audited the frontend for raw `fetch`/`XMLHttpRequest` that bypasses the CSRF-injecting helpers.

Overall posture is strong: the double-submit pattern is implemented correctly (constant-time, length-safe compare), the global middleware is registered, every frontend mutation path attaches the token, and the two genuinely CSRF-exempt routes (`/ai/chat`, `/internal/audit-cleanup`) are each protected by an alternative auth shape that cannot ride a cross-site cookie. Findings are hygiene/hardening only — no exploitable CSRF hole was found.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 4 |
| Info | 2 |

## Findings

### F-1 — Dead `/marketplace/plans/search` CSRF exemption — **Low**
- **Location:** `backend/src/middleware/csrf.ts:107`
- **Observation:** `/marketplace/plans/search` is still in the `publicAuthRoutes` exemption allowlist, but the Marketplace/CMS feature was removed (per `CLAUDE.md` "Removed Features"). There is no `/marketplace` route in `backend/src/routes/` — the only `marketplace` hits in `backend/src` are unrelated knowledge-base text. The exemption was added in commit `b68a725 "Add marketplace plans search to CSRF whitelist"`.
- **Impact:** No live exploit today (no route resolves to that path, so 404 before any handler). The risk is latent: a future route whose `req.path` happens to end in `/marketplace/plans/search` would silently inherit a CSRF exemption nobody intended. Dead allowlist entries also erode auditability of the exemption set.
- **Fix:** Delete the `'/marketplace/plans/search',` line from the `publicAuthRoutes` array in `validateCsrfToken`.
- **Evidence:**
  ```ts
  '/auth/resend-verification',
  '/marketplace/plans/search',
  ];
  ```

### F-2 — Unused `ensureCsrfToken` export (dead code) — **Low**
- **Location:** `backend/src/middleware/csrf.ts:66`
- **Observation:** `ensureCsrfToken` is exported but never imported anywhere in the codebase (Grep for `ensureCsrfToken` returns only its definition). The live token-mint path is `csrfProtection` calling `setCsrfCookie` (`app.ts:216` registers `csrfProtection`; `csrf.ts:186-188` mints the cookie when absent). The spec explicitly calls this out for cleanup.
- **Impact:** Dead code. A maintainer could wire it up believing it is the active mint path; its method-gating logic (`req.method === 'GET' || !cookie`) differs subtly from `csrfProtection`'s, inviting confusion.
- **Fix:** Remove the `ensureCsrfToken` function and its `export`, or add a comment marking it deprecated. Confirm no test imports it first.
- **Evidence:**
  ```ts
  export function ensureCsrfToken(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
  ```

### F-3 — Exemption matching uses `endsWith` instead of exact path match — **Low**
- **Location:** `backend/src/middleware/csrf.ts:127-139`
- **Observation:** All three exemption checks compare with `req.path.endsWith(route)` rather than an exact match against the known full path (`/api/v1/...`). `csrfProtection` is mounted app-wide (`app.use(csrfProtection)`, `app.ts:216`), so `req.path` is the full `/api/v1/...` path; the suffix test is structurally looser than necessary.
- **Impact:** Not exploitable against the current route table — Express only dispatches fixed, registered paths, and no mutating route ends in `/auth/login`, `/ai/chat`, etc. But the loose match is a defense-in-depth gap: any future route ending with an exempt suffix (or a path param decoding to one) would silently become CSRF-exempt. Exact equality against the full mounted path removes the footgun.
- **Fix:** Replace `req.path.endsWith(route)` with an exact comparison against the fully-qualified paths (e.g. build the allowlist as `/api/${config.apiVersion}${route}` and compare with `===`), in all three checks (`isPublicAuthRoute`, `isBearerOnlyStreamingRoute`, `isSchedulerRoute`).
- **Evidence:**
  ```ts
  const isPublicAuthRoute = publicAuthRoutes.some(route =>
    req.path.endsWith(route)
  );
  ```

### F-4 — Prompt drift: floating audit finding-IDs (F-10/F-18/F-19) have no canonical ledger — **Low**
- **Location:** `prompts/04-csrf.md:47` and inline code comments (`app.ts:172`, `config/index.ts:84`)
- **Observation:** The spec and code comments reference audit finding IDs (`F-10`, `F-18`, `F-19`) as if from a prior numbered audit, but no canonical audit-ledger document defines them. They appear as scattered cross-references: in code comments (`app.ts:172` "removed in the F-19 fix", `config/index.ts:84` "tightened in F-18 fix") and in several prompt checklists (`prompts/04-csrf.md:47` and `prompts/10-frontend-auth.md:88,133` cite "audit F-10"/"audit F-18"; `prompts/11-environment-secrets.md:81` cites F-18). F-19 in particular is reproducible only from the `app.ts:172` comment — no prompt references it. The `/api/v1/csrf-token` endpoint path in the spec (`prompts/04-csrf.md:58`) is correct and matches `app.ts:284` — there is no prefix drift there. The spec also correctly anticipates F-1 by flagging `/marketplace/plans/search` as a known-dead entry.
- **Impact:** None functionally. Noted per protocol so the quarterly prompt-refresh can reconcile the floating finding-ID references with an actual audit ledger.
- **Fix:** In the next prompt refresh, either point F-10/F-18/F-19 at a real audit document or convert them to descriptive labels. No code change.
- **Evidence:**
  ```ts
  // header. Listing 'X-CSRF-Token' in exposedHeaders advertised an interface
  // the server doesn't implement and was removed in the F-19 fix.
  ```

## Checks passed

### 1. Backend CSRF Middleware
- [x] Global `csrfProtection` registered in `app.ts`, skipped only in dev when `DISABLE_CSRF=true` — `app.ts:215-217` (`if (!config.isDevelopment || process.env.DISABLE_CSRF !== 'true') { app.use(csrfProtection); }`).
- [x] `validateCsrfToken` runs on POST/PUT/PATCH/DELETE, GET/HEAD/OPTIONS skipped — `csrf.ts:92` (`if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();`) and `csrf.ts:191`.
- [x] Validates `x-csrf-token` header against `csrf_token` cookie — `csrf.ts:17-18`, `151-152` (`req.cookies[CSRF_COOKIE_NAME]`, `req.headers[CSRF_HEADER_NAME]`). Header name is lowercase `x-csrf-token`, so Express's case-insensitive header lookup matches `X-CSRF-Token`.
- [x] Comparison uses SHA-256 digest of each value + `crypto.timingSafeEqual` — `csrf.ts:164-166` (both inputs hashed to fixed 32 bytes, then `timingSafeEqual`), which is length-safe and constant-time.
- [x] Returns 403 `ForbiddenError` on missing ("CSRF token missing") or mismatch ("Invalid CSRF token") — `csrf.ts:156` and `csrf.ts:169`.
- [x] Token minted via `csrfProtection` → `setCsrfCookie` when cookie absent (incl. GET) — `csrf.ts:186-188` and `csrf.ts:32-58`; cookie is `httpOnly:false`, 24h `maxAge`. (Dead `ensureCsrfToken` flagged separately, F-2.)

### 2. CSRF Token Generation
- [x] Cryptographically random token, `crypto.randomBytes(32).toString('hex')` → 64 hex chars — `csrf.ts:19,24-26` (`CSRF_TOKEN_LENGTH = 32`).
- [x] Sufficient length (32 bytes / 256 bits) — `csrf.ts:19`.
- [x] Token persisted client-side via cookie with 24h `maxAge`; stateless double-submit, no server store — `csrf.ts:47` (`maxAge: 24 * 60 * 60 * 1000`). No per-session server-side CSRF store exists (confirmed: no rotation logic; not rotated on login). See Info-1 for the no-rotation acceptance rationale.

### 3. Frontend Token Handling
- [x] `client.ts` `getCsrfToken()` reads `csrf_token` from `document.cookie` with regex `csrf[_-]?token` + `decodeURIComponent` — `client.ts:120-123`.
- [x] `apiFetch` attaches `x-csrf-token` only on POST/PUT/PATCH/DELETE — `client.ts:228-239`.
- [x] `uploadUtils.ts` reads `csrf_token` cookie and attaches `X-CSRF-Token` on multipart uploads — `uploadUtils.ts:37-46`, `133-136`.
- [x] Token retrieved fresh per request (not cached in JS state) — `getCsrfToken()` re-reads `document.cookie` on every call (`client.ts:121`, `uploadUtils.ts:38`); no module-level cache of the token value.
- [x] Missing-token diagnostic logging is DEV-only and never logs the token value — `client.ts:125-132` (`import.meta.env.DEV` guard, message only) and `client.ts:233-238`.

### 4. Exempt Routes
- [x] Safe methods skipped by design — `csrf.ts:92`, `191`.
- [x] Public auth endpoints exempt and genuinely pre-session — `csrf.ts:98-108`; verified against `authRoutes.ts:41-92` (register/login/refresh/demo/resend-verification/forgot-password/reset-password/verify-email are all public, no `authenticate`).
- [x] `/ai/chat` is bearer-only and CSRF-exempt safely — `csrf.ts:116-118` exempts it; `aiRoutes.ts:21` mounts `router.use(requireBearerAuth)`. `requireBearerAuth` ignores cookies (`auth.ts:59-65` `extractBearerToken` reads Authorization header only), whereas `authenticate` reads the `access_token` cookie first (`auth.ts:34-38`). So a cross-site cookie request to `/ai/chat` is rejected at auth — the exemption opens no CSRF hole.
- [x] `/internal/audit-cleanup` is shared-secret authed and 404s unless configured — `csrf.ts:139` exempts it; `internalRoutes.ts:43-62` constant-time compares `X-Cleanup-Token` via `timingSafeEqual` (`internalRoutes.ts:27-33`) and returns 404 when `AUDIT_CLEANUP_TOKEN` unset. A cross-site request cannot supply the secret, so no session rides along.
- [x] File upload endpoints are NOT exempt — no upload path in the exempt lists (`csrf.ts:98-118,139`); the old `uploadRoutes` exemption is gone (only a comment remains, `csrf.ts:120-125`). All upload clients route through `uploadUtils.uploadFile` which attaches the token: `services/api/upload.ts:9-10`, `services/api/insurance.ts:296-310`, `components/upload/LabUploadModal.tsx:19,146`.
- [x] Authenticated mutations are protected (not exempt) — `/auth/logout`, `/auth/logout-all`, `/auth/change-password`, `/auth/change-email` use `authenticate` and are absent from the exempt list (`authRoutes.ts:108-132`), so they require a valid CSRF token.
- [x] CSRF token endpoint available — `app.ts:284` (`app.get(.../csrf-token, csrfTokenHandler)`), handler at `csrf.ts:204-213`.

### 5. Component-Level Check
- [x] `BiomarkerAIGuidance.tsx` uses the API client (CSRF auto-injected) — calls `biomarkersApi.getGuidance` (`src/components/trends/BiomarkerAIGuidance.tsx:13,56`); no raw `fetch`.
- [x] `InsuranceHub.tsx` delete goes through the API client — delete is invoked via the `onDeletePlan` prop callback (`src/components/insurance/InsuranceHub.tsx:215-218`); no raw `fetch` in the component (Grep: none).
- [x] Upload components route through `uploadUtils.ts` — `LabUploadModal.tsx:19,146` imports and calls `uploadFile`; `ClinicalFileUpload.tsx` and `PDFUploadModal.tsx` contain no direct `fetch`/`uploadFile`/`FormData` (delegated upward / to API modules, all of which use `uploadUtils`).
- [x] No raw `fetch` bypassing CSRF on a mutation — Grep for `fetch(` across `src/` yields 5 hits: `uploadUtils.ts:138` (attaches CSRF), `client.ts:145` `/auth/refresh` (POST, exempt by design), `client.ts:253` (the central `apiFetch`, attaches CSRF), `files.ts:37` `/files/:id/download` (GET, no CSRF needed), `ai.ts:116` `/ai/chat` (POST, bearer-only CSRF-exempt route — see Info-2). No `XMLHttpRequest`/`axios` usage.

## Unverifiable
- None. Every file and behavior named in the spec was located and confirmed in the live repo.

## Info (observations, not findings)

### Info-1 — Stateless token is not rotated on login (accepted by design)
- **Location:** `backend/src/middleware/csrf.ts:32-58`, `config/index.ts:74-88`
- The double-submit token is never rotated on auth state changes (no server-side secret to rotate). Session-fixation via the CSRF cookie is not a meaningful risk here because (a) the cookie is bound only by `sameSite` — `strict` for production same-domain, `none` only with explicit `COOKIE_DOMAIN`+`secure` (`config/index.ts:86-87`); (b) the actual session credential is the memory-only access token plus an httpOnly refresh cookie, not the CSRF token; and (c) an attacker cannot read the victim's `csrf_token` cookie cross-site to forge a matching header. The spec asks to confirm this is acceptable — it is, given the `sameSite` + memory-only-auth-token defenses. No action needed.

### Info-2 — `/ai/chat` and `/auth/refresh` POSTs intentionally omit the CSRF header (frontend)
- **Location:** `src/services/api/ai.ts:108-122`, `src/services/api/client.ts:145-149`
- `ai.ts` issues a raw `POST /ai/chat` with `Authorization: Bearer` + `credentials:'include'` but no `X-CSRF-Token` — correct, because the route is bearer-only and CSRF-exempt (the Bearer token, not the cookie, authenticates it). `/auth/refresh` likewise omits CSRF and is server-side exempt (pre-session, protected by the httpOnly refresh cookie + `sameSite`). Both are consistent with the backend exemption design; flagged only so a future reviewer doesn't mistake them for missing-CSRF bugs.

## Out of scope
- `npm audit` reported 8 moderate transitive vulns under `@google-cloud/storage` (gaxios/teeny-request/uuid). These are dependency-CVE issues unrelated to CSRF; defer to the dependency-audit prompt (09/dependency review), not this one.
- General CORS/Helmet/cookie-secure posture was read for context (`app.ts:125-194`, `config/index.ts:74-88`) but full coverage belongs to the headers/CORS review prompt.
