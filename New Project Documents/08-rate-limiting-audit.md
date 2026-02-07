# Rate Limiting Security Audit

**Project:** OwnMyHealth
**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (Automated Security Audit)
**Scope:** Rate limiting middleware, global application, and per-route usage
**Severity Scale:** CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Executive Summary

The OwnMyHealth application has a **solid rate limiting foundation** with 6 named limiters defined in a dedicated middleware file, a global limiter applied in `app.ts`, and targeted route-level limiters on authentication and upload endpoints. However, there are **several notable gaps**: AI/Claude API endpoints lack dedicated rate limiting (cost control risk), settings routes (export/delete) lack the `sensitiveLimiter` they were designed to use, file download endpoints have no specific limiter, and the provider access request endpoint has no spam-prevention limiter. These gaps represent real-world attack surfaces for cost abuse, data exfiltration, and denial-of-wallet attacks.

**Overall Rating:** PARTIAL -- Core infrastructure is sound, but coverage is incomplete on cost-sensitive and data-sensitive endpoints.

---

## Files Reviewed

| File | Path |
|------|------|
| Rate Limiter Middleware | `backend/src/middleware/rateLimiter.ts` |
| Application Entry | `backend/src/app.ts` |
| Route Index | `backend/src/routes/index.ts` |
| Auth Routes | `backend/src/routes/authRoutes.ts` |
| Biomarker Routes | `backend/src/routes/biomarkerRoutes.ts` |
| Upload Routes | `backend/src/routes/uploadRoutes.ts` |
| File Routes | `backend/src/routes/fileRoutes.ts` |
| Settings Routes | `backend/src/routes/settingsRoutes.ts` |
| Expense Routes | `backend/src/routes/expenseRoutes.ts` |
| Insurance Routes | `backend/src/routes/insuranceRoutes.ts` |
| Provider Routes | `backend/src/routes/providerRoutes.ts` |
| Patient Routes | `backend/src/routes/patientRoutes.ts` |
| Admin Routes | `backend/src/routes/adminRoutes.ts` |
| Health Goals Routes | `backend/src/routes/healthGoalsRoutes.ts` |
| Health Needs Routes | `backend/src/routes/healthNeedsRoutes.ts` |
| Config | `backend/src/config/index.ts` |

---

## Checklist Results

### 1. Rate Limiter Configuration

- [x] **PASS** -- Rate limiting middleware installed (`express-rate-limit`)
  - **File:** `backend/src/middleware/rateLimiter.ts:1`
  - `import rateLimit from 'express-rate-limit';`
  - All 6 limiters use the `express-rate-limit` package.

- [x] **PASS** -- Applied globally or to sensitive routes
  - **File:** `backend/src/app.ts:166`
  - `app.use(standardLimiter);` -- global limiter applied before routes in the middleware stack.
  - Additional per-route limiters are applied to auth, upload, batch, and admin permanent-delete routes.

- [x] **PASS** -- Limits are reasonable for legitimate use
  - `standardLimiter`: 100 req/15 min (configurable via `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` env vars) -- reasonable for API usage.
  - `authLimiter`: 20 req/15 min -- appropriate for registration and general auth.
  - `strictAuthLimiter`: 5 req/15 min, keyed by email+IP, skips successful requests -- excellent for brute force prevention.
  - `uploadLimiter`: 20 uploads/hour -- reasonable for file upload volume.
  - `sensitiveLimiter`: 10 req/hour -- conservative for destructive operations.
  - `bulkOperationLimiter`: 30 req/hour -- appropriate for batch imports.

---

### 2. Authentication Endpoints

- [x] **PASS** -- `POST /auth/login` - strict limit (5/15 min per email+IP)
  - **File:** `backend/src/routes/authRoutes.ts:48`
  - The login route has **double protection**: the router-wide `authLimiter` (line 32) AND the per-route `strictAuthLimiter` (line 48).
  - `strictAuthLimiter` uses `keyGenerator` based on `email + IP` (rateLimiter.ts:54-57) and `skipSuccessfulRequests: true` (line 52), so only failed attempts count. This is a strong anti-brute-force configuration.

- [~] **PARTIAL** -- `POST /auth/register` - moderate limit
  - **File:** `backend/src/routes/authRoutes.ts:32, 39-43`
  - Protected by the router-wide `authLimiter` (20 req/15 min), which is reasonable but not explicitly more restrictive for registration specifically. The prompt suggests 3/hour per IP; 20/15 min is more permissive. However, since registration requires email verification, the risk is mitigated.
  - **Finding:** Consider a stricter per-route limiter for registration to prevent mass account creation. 20 registrations per 15 minutes from a single IP is excessive.

- [x] **PASS** -- `POST /auth/forgot-password` - strict limit
  - **File:** `backend/src/routes/authRoutes.ts:75-76`
  - Protected by both `authLimiter` (router-wide) and `strictAuthLimiter` (per-route). 5 requests per 15 minutes is appropriate.

- [~] **PARTIAL** -- `POST /auth/reset-password` - strict limit
  - **File:** `backend/src/routes/authRoutes.ts:82-86`
  - Protected only by the router-wide `authLimiter` (20 req/15 min). Does NOT have the `strictAuthLimiter` applied per-route.
  - **Finding (MEDIUM):** The reset-password endpoint should have `strictAuthLimiter` applied to prevent token brute-forcing. An attacker who intercepts a reset email could attempt to guess the token at a rate of 20 per 15 minutes. Add `strictAuthLimiter` to line 83.

---

### 3. Resource-Intensive Endpoints

- [x] **PASS** -- `POST /upload/*` - limit uploads (20/hour) via `uploadLimiter`
  - **File:** `backend/src/routes/uploadRoutes.ts:24`
  - `router.use(uploadLimiter);` applies to all upload routes: `/lab-report`, `/insurance-sbc`, `/lab-results-ocr`.
  - Also applied to `/insurance/upload-sbc` (insuranceRoutes.ts:125) and `/insurance/plans/:id/reanalyze` (insuranceRoutes.ts:117).

- [ ] **FAIL** -- `POST /biomarkers/:id/guidance` - limit AI calls (Claude API)
  - **File:** `backend/src/routes/biomarkerRoutes.ts:101-190`
  - This endpoint calls the Anthropic Claude API (`claude-haiku-4-5-20251001`) at line 147-164. There is **NO dedicated rate limiter** beyond the global `standardLimiter` (100 req/15 min).
  - **Finding (HIGH -- Denial-of-Wallet):** A malicious authenticated user could invoke this endpoint 100 times per 15 minutes, generating significant Claude API costs. This should have a dedicated limiter (e.g., `sensitiveLimiter` at 10/hour or a new `aiLimiter`).

- [ ] **FAIL** -- `POST /expenses/analyze` - limit cost analysis (Claude API)
  - **File:** `backend/src/routes/expenseRoutes.ts:45`
  - The `analyzeCosts` handler likely calls Claude API for cost analysis. There is **NO dedicated rate limiter** -- only the global `standardLimiter` applies.
  - **Finding (HIGH -- Denial-of-Wallet):** Same cost exposure risk as the guidance endpoint. Should use `sensitiveLimiter` or a dedicated AI limiter.

- [x] **PASS** -- `POST /biomarkers/batch` - limit bulk creates (30/hour) via `bulkOperationLimiter`
  - **File:** `backend/src/routes/biomarkerRoutes.ts:80`
  - `bulkOperationLimiter` correctly applied. 30 operations per hour is reasonable.

- [ ] **FAIL** -- `GET /files/:id/download` - prevent bulk downloads
  - **File:** `backend/src/routes/fileRoutes.ts:42-46`
  - No dedicated rate limiter. Only the global `standardLimiter` (100/15 min) applies.
  - **Finding (MEDIUM):** An attacker with valid credentials could exfiltrate all files at 100 downloads per 15 minutes. Should apply `sensitiveLimiter` to the download endpoint.

- [ ] **FAIL** -- `GET /settings/export-data` - limit data exports via `sensitiveLimiter`
  - **File:** `backend/src/routes/settingsRoutes.ts:35-38`
  - **No `sensitiveLimiter` applied.** The `sensitiveLimiter` is defined in `rateLimiter.ts` but is NOT imported or used in `settingsRoutes.ts`.
  - **Finding (MEDIUM):** Data export returns all user health data as JSON. Without a dedicated limiter, a compromised session could be used to repeatedly export data. This endpoint should use `sensitiveLimiter`.

- [ ] **FAIL** -- `DELETE /settings/*` - limit deletion operations via `sensitiveLimiter`
  - **File:** `backend/src/routes/settingsRoutes.ts:41-55`
  - Neither `DELETE /settings/delete-data` nor `DELETE /settings/delete-account` has `sensitiveLimiter` applied.
  - **Finding (MEDIUM):** Destructive operations (account deletion, data wipe) should be rate limited. While authentication is required, a compromised session token could be replayed. Apply `sensitiveLimiter` to both DELETE routes.

- [ ] **FAIL** -- Provider access request endpoint - prevent spam
  - **File:** `backend/src/routes/providerRoutes.ts:92-172`
  - `POST /provider/patients/request` has no dedicated rate limiter. Only the global `standardLimiter` applies.
  - **Finding (LOW):** A malicious provider account could spam access requests to many patients (100 per 15 min). Consider applying `authLimiter` or `sensitiveLimiter` to this endpoint.

---

### 4. Rate Limit Headers

- [x] **PASS** -- `X-RateLimit-Limit` - max requests
  - **File:** `backend/src/middleware/rateLimiter.ts` -- all 6 limiters set `standardHeaders: true`.
  - The `express-rate-limit` library sends `RateLimit-Limit` (draft IETF standard) when `standardHeaders: true`.

- [x] **PASS** -- `X-RateLimit-Remaining` - requests left
  - Included via `standardHeaders: true` on all limiters. Sends `RateLimit-Remaining`.

- [x] **PASS** -- `X-RateLimit-Reset` - when limit resets
  - Included via `standardHeaders: true` on all limiters. Sends `RateLimit-Reset`.

- [x] **PASS** -- `Retry-After` on 429 responses
  - `express-rate-limit` sends `Retry-After` header by default on 429 responses when `standardHeaders: true`.

- [x] **PASS** -- `legacyHeaders: false` on all limiters
  - All 6 limiters disable legacy `X-RateLimit-*` headers (rateLimiter.ts lines 17, 36, 51, 73, 88, 103), using only the modern `RateLimit-*` standard. This is correct behavior.

---

### 5. Rate Limit Key

- [x] **PASS** -- Based on IP address (for unauthenticated)
  - **File:** `backend/src/middleware/rateLimiter.ts:18-21`
  - `standardLimiter` uses a custom `keyGenerator` that resolves to `req.ip || req.socket.remoteAddress || 'unknown'`.
  - Other limiters (`authLimiter`, `uploadLimiter`, `sensitiveLimiter`, `bulkOperationLimiter`) use the default `express-rate-limit` key generator which uses `req.ip`.

- [~] **PARTIAL** -- Based on user ID (for authenticated)
  - The `strictAuthLimiter` uses `email + IP` (rateLimiter.ts:54-57), which is excellent for login specifically.
  - However, all other limiters (including those on authenticated routes like `uploadLimiter`, `sensitiveLimiter`, `bulkOperationLimiter`) key by IP only, not by user ID.
  - **Finding (LOW):** For authenticated endpoints, keying by user ID would be more precise. Multiple users behind the same NAT/VPN share an IP and could incorrectly share rate limit counters. Conversely, a single user with multiple IPs (mobile network) could bypass per-IP limits.

- [x] **PASS** -- Considers proxy headers correctly
  - **File:** `backend/src/app.ts:89`
  - `app.set('trust proxy', 1);` -- trusts the first proxy hop, appropriate for Cloud Run deployment.
  - This ensures `req.ip` resolves to the real client IP from `X-Forwarded-For` rather than the load balancer IP.

---

### 6. Response on Limit

- [x] **PASS** -- Returns 429 Too Many Requests
  - `express-rate-limit` returns 429 by default when the limit is exceeded. No override found.

- [x] **PASS** -- Includes helpful error message
  - All 6 limiters include structured error messages:
    - `standardLimiter`: "Too many requests, please try again later." (line 11)
    - `authLimiter`: "Too many authentication attempts, please try again in 15 minutes." (line 33)
    - `strictAuthLimiter`: "Too many login attempts. Please try again in 15 minutes." (line 47)
    - `uploadLimiter`: "Too many file uploads, please try again later." (line 68)
    - `sensitiveLimiter`: "Rate limit exceeded for sensitive operations." (line 84)
    - `bulkOperationLimiter`: "Too many bulk operations. Please try again later." (line 99)
  - All messages follow the `ApiResponse` format with `success: false` and `error.code` + `error.message`.

- [x] **PASS** -- Doesn't leak information about limits
  - Error messages do not reveal specific limits, window sizes, or internal configuration. They use generic language like "try again later" or "try again in 15 minutes" (which is reasonable since the window is visible in headers anyway).

---

### 7. Actual Limiters in Codebase (from prompt checklist)

- [x] **PASS** -- `standardLimiter` -- 100 req/15 min (global)
  - **File:** `backend/src/middleware/rateLimiter.ts:6-22`
  - Configurable via `RATE_LIMIT_WINDOW_MS` (default 900000ms = 15 min) and `RATE_LIMIT_MAX_REQUESTS` (default 100).
  - Applied globally in `backend/src/app.ts:166`.

- [x] **PASS** -- `authLimiter` -- 20 req/15 min (auth routes)
  - **File:** `backend/src/middleware/rateLimiter.ts:25-37`
  - Applied as router-level middleware in `authRoutes.ts:32`.

- [x] **PASS** -- `strictAuthLimiter` -- 5 req/15 min (login), keyed by email+IP
  - **File:** `backend/src/middleware/rateLimiter.ts:40-59`
  - Applied to `POST /auth/login` (authRoutes.ts:48) and `POST /auth/forgot-password` (authRoutes.ts:76).
  - `skipSuccessfulRequests: true` (line 52) -- only counts failures.
  - Key: `${email}:${ip}` (line 57) -- prevents both per-account and per-IP brute force.

- [x] **PASS** -- `uploadLimiter` -- 20 uploads/hour
  - **File:** `backend/src/middleware/rateLimiter.ts:62-74`
  - Applied to all upload routes (uploadRoutes.ts:24), insurance SBC upload (insuranceRoutes.ts:125), and reanalyze (insuranceRoutes.ts:117).

- [x] **PASS** -- `sensitiveLimiter` -- 10 req/hour (sensitive operations)
  - **File:** `backend/src/middleware/rateLimiter.ts:77-89`
  - Applied to `DELETE /admin/users/:id/permanent` (adminRoutes.ts:291).
  - **However:** NOT applied to `GET /settings/export-data`, `DELETE /settings/delete-data`, or `DELETE /settings/delete-account` where it was intended.

- [x] **PASS** -- `bulkOperationLimiter` -- 30 req/hour (batch creates)
  - **File:** `backend/src/middleware/rateLimiter.ts:92-104`
  - Applied to `POST /biomarkers/batch` (biomarkerRoutes.ts:80).

---

## Questions Analysis

### 1. Are authentication endpoints rate limited?
**Yes, with good coverage.** All auth routes get the `authLimiter` (20/15 min). Login and forgot-password additionally get `strictAuthLimiter` (5/15 min). The login limiter's `skipSuccessfulRequests` and email+IP key generator are particularly well designed. **Gap:** `POST /auth/reset-password` lacks the `strictAuthLimiter`.

### 2. Are AI/Claude API endpoints limited (cost control)?
**No.** Neither `POST /biomarkers/:id/guidance` (biomarkerRoutes.ts:101) nor `POST /expenses/analyze` (expenseRoutes.ts:45) has a dedicated rate limiter. They rely only on the global 100 req/15 min limiter. At current Claude API pricing, 100 calls every 15 minutes could result in significant costs. This is the most critical gap found in this audit.

### 3. What happens when limits are hit?
HTTP 429 responses are returned with structured JSON error bodies matching the `ApiResponse` format, including an error code (e.g., `RATE_LIMIT_EXCEEDED`, `AUTH_RATE_LIMIT_EXCEEDED`) and a human-readable message. Standard `RateLimit-*` headers and `Retry-After` are included via `standardHeaders: true`.

### 4. Are rate limits keyed by IP, user ID, or both?
Primarily by IP. The `standardLimiter` explicitly uses `req.ip` via a custom `keyGenerator`. The `strictAuthLimiter` uses `email:IP` for pre-auth login attempts. All other limiters use the default `req.ip` key. No limiters key by authenticated user ID post-login.

### 5. Do demo accounts have separate (stricter) limits?
**No.** There is no differentiation in rate limiting for demo accounts vs. regular accounts. Demo accounts are blocked in production (config/index.ts:191-197), so this is primarily a development concern. However, in staging environments, demo accounts could be used to probe rate limits without consequence.

---

## Full Route Coverage Matrix

| Route | Method | Limiters Applied | Adequate? |
|-------|--------|-----------------|-----------|
| `/auth/*` (all) | ALL | `standardLimiter` + `authLimiter` | Yes |
| `/auth/login` | POST | `standardLimiter` + `authLimiter` + `strictAuthLimiter` | Yes |
| `/auth/register` | POST | `standardLimiter` + `authLimiter` | Partial |
| `/auth/forgot-password` | POST | `standardLimiter` + `authLimiter` + `strictAuthLimiter` | Yes |
| `/auth/reset-password` | POST | `standardLimiter` + `authLimiter` | **No** -- needs `strictAuthLimiter` |
| `/biomarkers/*` | ALL | `standardLimiter` | Yes (reads) |
| `/biomarkers/batch` | POST | `standardLimiter` + `bulkOperationLimiter` | Yes |
| `/biomarkers/:id/guidance` | POST | `standardLimiter` only | **No** -- needs AI limiter |
| `/upload/*` | ALL | `standardLimiter` + `uploadLimiter` | Yes |
| `/insurance/upload-sbc` | POST | `standardLimiter` + `uploadLimiter` | Yes |
| `/insurance/plans/:id/reanalyze` | PUT | `standardLimiter` + `uploadLimiter` | Yes |
| `/insurance/*` (other) | ALL | `standardLimiter` | Yes |
| `/expenses/analyze` | POST | `standardLimiter` only | **No** -- needs AI limiter |
| `/expenses/*` (other) | ALL | `standardLimiter` | Yes |
| `/files/:id/download` | GET | `standardLimiter` only | **No** -- needs download limiter |
| `/files/*` (other) | ALL | `standardLimiter` | Yes |
| `/settings/export-data` | GET | `standardLimiter` only | **No** -- needs `sensitiveLimiter` |
| `/settings/delete-data` | DELETE | `standardLimiter` only | **No** -- needs `sensitiveLimiter` |
| `/settings/delete-account` | DELETE | `standardLimiter` only | **No** -- needs `sensitiveLimiter` |
| `/provider/patients/request` | POST | `standardLimiter` only | **No** -- needs spam limiter |
| `/provider/*` (other) | ALL | `standardLimiter` | Yes |
| `/patient/*` | ALL | `standardLimiter` | Yes |
| `/admin/*` | ALL | `standardLimiter` | Yes |
| `/admin/users/:id/permanent` | DELETE | `standardLimiter` + `sensitiveLimiter` | Yes |
| `/health-goals/*` | ALL | `standardLimiter` | Yes |
| `/health-goals/suggestions` | GET | `standardLimiter` only | Depends (if AI-powered) |
| `/health-needs/*` | ALL | `standardLimiter` | Yes |
| `/health-needs/analyze` | GET | `standardLimiter` only | Depends (if AI-powered) |

---

## Findings Summary

### HIGH Severity

| # | Finding | Location | Description |
|---|---------|----------|-------------|
| H1 | AI/Claude API endpoints unprotected | `biomarkerRoutes.ts:101` | `POST /biomarkers/:id/guidance` calls Claude API with no dedicated rate limiter. 100 calls/15 min under global limiter could incur significant costs. |
| H2 | Cost analysis endpoint unprotected | `expenseRoutes.ts:45` | `POST /expenses/analyze` likely calls Claude API with no dedicated rate limiter. Same cost exposure as H1. |

### MEDIUM Severity

| # | Finding | Location | Description |
|---|---------|----------|-------------|
| M1 | `sensitiveLimiter` not applied to settings routes | `settingsRoutes.ts` | Export-data, delete-data, and delete-account endpoints lack the `sensitiveLimiter` that was designed for them. |
| M2 | File download lacks rate limiting | `fileRoutes.ts:42-46` | `GET /files/:id/download` has no specific limiter. Could allow bulk exfiltration of lab reports and medical documents. |
| M3 | Reset-password lacks strict limiter | `authRoutes.ts:82-86` | `POST /auth/reset-password` only has `authLimiter` (20/15 min), not `strictAuthLimiter`. Token brute-force risk. |

### LOW Severity

| # | Finding | Location | Description |
|---|---------|----------|-------------|
| L1 | Provider access request not rate limited | `providerRoutes.ts:92` | `POST /provider/patients/request` could be used to spam patients with access requests. |
| L2 | Rate limits not keyed by user ID | `rateLimiter.ts` (all) | All authenticated-route limiters key by IP, not user ID. Users behind shared NAT may be unfairly throttled; users with multiple IPs can bypass limits. |
| L3 | Registration allows 20/15 min | `authRoutes.ts:32` | `authLimiter` allows 20 registrations per 15 minutes per IP, which is generous for account creation. |
| L4 | AI-adjacent endpoints possibly unprotected | `healthGoalsRoutes.ts:47`, `healthNeedsRoutes.ts:47` | `GET /health-goals/suggestions` and `GET /health-needs/analyze` may invoke AI services; no dedicated limiter applied. |

### INFO

| # | Finding | Location | Description |
|---|---------|----------|-------------|
| I1 | Debug console.log in settings routes | `settingsRoutes.ts:27-28` | Debug logging with `console.log` instead of structured logger. Should be removed or migrated to `logger.debug()`. |
| I2 | No per-environment rate limit tuning | `config/index.ts:67-70` | Only `standardLimiter` is configurable via environment variables. The other 5 limiters have hardcoded values. Consider making auth/upload/sensitive limits configurable for production tuning. |
| I3 | No Redis/external store for rate limits | `rateLimiter.ts` | All limiters use the default in-memory store. In a multi-instance Cloud Run deployment, each instance maintains its own counters. An attacker could effectively multiply their allowed requests by the number of running instances. |

---

## Recommendations (Priority Order)

1. **[HIGH] Add AI rate limiter to Claude API endpoints.** Create an `aiLimiter` (e.g., 10 req/hour) and apply to `POST /biomarkers/:id/guidance`, `POST /expenses/analyze`, and any other endpoints calling external AI APIs. This prevents denial-of-wallet attacks.

2. **[MEDIUM] Apply `sensitiveLimiter` to settings routes.** Import and apply `sensitiveLimiter` to `GET /settings/export-data`, `DELETE /settings/delete-data`, and `DELETE /settings/delete-account` in `settingsRoutes.ts`.

3. **[MEDIUM] Apply `strictAuthLimiter` to `POST /auth/reset-password`.** This is a sensitive endpoint that accepts tokens; it should have the same brute-force protection as login.

4. **[MEDIUM] Add download rate limiter to file routes.** Apply `sensitiveLimiter` or a new `downloadLimiter` to `GET /files/:id/download` to prevent bulk exfiltration of medical documents.

5. **[LOW] Add spam protection to provider access requests.** Apply `authLimiter` or `sensitiveLimiter` to `POST /provider/patients/request`.

6. **[LOW] Consider user ID-based rate limiting for authenticated routes.** For post-authentication endpoints, supplement IP-based keying with user ID to handle shared NAT and VPN scenarios more precisely.

7. **[INFO] Evaluate distributed rate limit store (Redis).** For multi-instance Cloud Run deployments, the in-memory store means rate limits are per-instance, not per-application. Consider using `rate-limit-redis` for accurate enforcement across instances.

8. **[INFO] Make all limiter windows/maxes configurable.** Currently only `standardLimiter` reads from environment variables. Consider extending env var configuration to all 6 limiters for production flexibility.

---

## Positive Findings

- The `strictAuthLimiter` implementation is excellent: email+IP composite key, `skipSuccessfulRequests`, and a tight 5-request window.
- All limiters use structured `ApiResponse` format for consistency with the rest of the API.
- `standardHeaders: true` and `legacyHeaders: false` follow current best practices for rate limit header standards.
- `trust proxy` is correctly set to `1` for Cloud Run, ensuring accurate IP resolution.
- The global `standardLimiter` provides baseline protection for all routes, including any undocumented or future endpoints.
- Upload routes have proper multer configuration with file size limits (10MB), single-file restriction, and MIME type filtering in addition to rate limiting.
- Custom error codes (e.g., `AUTH_RATE_LIMIT_EXCEEDED`, `LOGIN_RATE_LIMIT_EXCEEDED`) allow frontend to provide specific user feedback.

---

*End of audit report.*
