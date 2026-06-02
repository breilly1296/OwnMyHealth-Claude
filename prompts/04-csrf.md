---
tags:
  - security
  - csrf
  - critical
type: prompt
priority: 1
updated: 2026-06-01
---

# CSRF Protection Review

## Files to Review
- `backend/src/middleware/csrf.ts` (CSRF middleware — stateless double-submit cookie, SHA-256 pre-hash + `crypto.timingSafeEqual`)
- `backend/src/app.ts` (middleware registration — global `csrfProtection`, `csrf-token` endpoint)
- `src/services/api/client.ts` (frontend HTTP client — `getCsrfToken()` cookie extraction + `x-csrf-token` injection on mutations)
- `src/services/uploadUtils.ts` (frontend upload helper — reads `csrf_token` cookie, attaches `X-CSRF-Token` on multipart uploads)
- Any component making POST/PUT/DELETE requests

## OwnMyHealth CSRF Architecture
- **Method**: Stateless double-submit cookie pattern (no server-side CSRF secret/store)
- **Token Location**: `csrf_token` cookie (`httpOnly: false`, readable by JS; `maxAge` 24h)
- **Header**: `X-CSRF-Token` (validated case-insensitively as `x-csrf-token`) required on mutating requests
- **Validation**: Cookie and header are each SHA-256 hashed, then compared with `crypto.timingSafeEqual` (the pre-hash normalizes length so unequal-length inputs don't leak timing). Cookie value must match header value.
- **Cookie attributes**: `secure` and `sameSite` come from `config.cookie` (env: `COOKIE_SAME_SITE`, `COOKIE_DOMAIN`); domain set only when `COOKIE_DOMAIN` is configured.

## Checklist

### 1. Backend CSRF Middleware
- [ ] Global `csrfProtection` registered in `app.ts` (skipped only in dev when `DISABLE_CSRF=true`)
- [ ] `validateCsrfToken` runs on POST/PUT/PATCH/DELETE; GET/HEAD/OPTIONS skipped
- [ ] Validates `X-CSRF-Token` (lowercase `x-csrf-token`) header against `csrf_token` cookie
- [ ] Comparison uses SHA-256 digest of each value + `crypto.timingSafeEqual` (constant-time, length-safe)
- [ ] Returns 403 (`ForbiddenError`) on missing token ("CSRF token missing") or mismatch ("Invalid CSRF token")
- [ ] `csrfProtection`/`setCsrfCookie` mints a token when the cookie is absent (also on GET) — stateless, no server-side secret to rotate. NOTE: `ensureCsrfToken` is exported but currently unused; the live mint path is `csrfProtection` calling `setCsrfCookie` — flag the dead export for cleanup

### 2. CSRF Token Generation
- [ ] Cryptographically random token (`crypto.randomBytes(32).toString('hex')` → 64 hex chars)
- [ ] Sufficient length (32 bytes / 256 bits)
- [ ] Token persisted client-side via cookie (24h `maxAge`); double-submit pattern needs no per-session server store. NOTE: because there is no server-side secret, the token is NOT rotated on login — confirm that is acceptable given `sameSite` cookie + auth-token defenses, otherwise flag fixation risk.

### 3. Frontend Token Handling
- [ ] `client.ts` `getCsrfToken()` reads `csrf_token` from `document.cookie` (regex `csrf[_-]?token`, `decodeURIComponent`)
- [ ] `apiFetch` attaches `x-csrf-token` header on POST/PUT/PATCH/DELETE only
- [ ] `uploadUtils.ts` reads `csrf_token` cookie and attaches `X-CSRF-Token` on multipart uploads
- [ ] Token retrieved fresh for each request (not cached in JS state)
- [ ] Missing-token diagnostic logging is DEV-only (`import.meta.env.DEV` guarded — never logs the token value; audit F-10)

### 4. Exempt Routes
The middleware exempts a fixed allowlist (`backend/src/middleware/csrf.ts`). Verify each is still safe:
- [ ] Safe methods (GET/HEAD/OPTIONS) — skipped by design
- [ ] Public auth endpoints (no session to protect yet): `/auth/login`, `/auth/register`, `/auth/demo`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`
- [ ] Bearer-only SSE streaming: `/ai/chat` (EventSource can't send custom headers) — MUST be mounted with `requireBearerAuth` (verify in `aiRoutes.ts`), so cookie-auth is rejected at the route layer and no CSRF hole opens
- [ ] Scheduler maintenance trigger: `/internal/audit-cleanup` — authenticated by shared-secret `X-Cleanup-Token` (constant-time compared in `internalRoutes.ts`), 404s unless the secret is configured
- [ ] File upload endpoints are NOT exempt anymore — they fail closed unless the client routes through `uploadUtils.ts` (the old `uploadRoutes` exemption + TODO was removed)
- [ ] No stale exemptions: `/marketplace/plans/search` is still in the allowlist but the Marketplace feature was removed — flag this dead entry for cleanup
- [ ] No sensitive operations exempted beyond the above
- [ ] CSRF token endpoint available: `GET /api/v1/csrf-token` (`csrfTokenHandler` in `app.ts`)

### 5. Component-Level Check
Search for any components using raw `fetch()` without going through `apiFetch`/`uploadUtils` (which inject CSRF automatically):
- [ ] `src/components/trends/BiomarkerAIGuidance.tsx` - uses the API client (CSRF auto-injected)?
- [ ] `src/components/insurance/InsuranceHub.tsx` - delete goes through API client (CSRF)?
- [ ] Upload components (`src/components/upload/`) - route through `uploadUtils.ts` so `X-CSRF-Token` is attached?

## Common CSRF Issues Found
```javascript
// WRONG - missing CSRF token
fetch('/api/v1/endpoint', { 
  method: 'POST',
  body: JSON.stringify(data)
})

// RIGHT - include CSRF token
const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1];
fetch('/api/v1/endpoint', {
  method: 'POST',
  headers: { 'X-CSRF-Token': csrfToken },
  body: JSON.stringify(data)
})
```

## Questions to Ask
1. Are there any POST/PUT/DELETE requests missing CSRF tokens (raw `fetch`/`XMLHttpRequest` bypassing `apiFetch`/`uploadUtils`)?
2. Is any CSRF-related logging still leaking the token value, or running outside the `import.meta.env.DEV` guard?
3. Are CSRF errors returning generic messages (`ForbiddenError`, not leaking cookie/header internals)?
4. Does every route in the exempt allowlist still warrant exemption — in particular, is the dead `/marketplace/plans/search` entry still present after the Marketplace feature was removed?
5. Is `/ai/chat` still mounted with `requireBearerAuth` (not `authenticate`), so its CSRF exemption doesn't reopen a cookie-auth CSRF hole?
6. Without server-side token rotation, is the stateless double-submit token still adequate (sameSite cookie + memory-only auth token), or is session-fixation a concern worth flagging?
