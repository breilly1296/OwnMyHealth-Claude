# OwnMyHealth API Reference

**Base URL:** `https://api.ownmyhealth.io/api/v1` (production) / `http://localhost:3001/api/v1` (dev)
**Last verified:** 2026-04-16

All endpoints are mounted under `/api/v1/*` in `backend/src/app.ts` (line 183) and delegated via `backend/src/routes/index.ts`. PHI-containing response fields are marked with a `PHI` indicator; the field values are decrypted server-side from AES-256-GCM ciphertext before transmission.

---

## Authentication

- **Scheme:** JWT in HttpOnly cookie (`access_token`), with fallback to `Authorization: Bearer <token>` header.
- **Access token TTL:** 15 minutes.
- **Refresh token TTL:** 7 days (30 days for demo user in non-production).
- **Refresh flow:** `POST /auth/refresh` reads refresh token from `refresh_token` cookie, rotates both tokens, returns new access token in response body so the SPA can use it for `Authorization` header on subsequent requests.
- **CSRF:** Double-submit cookie pattern (`csrf_token`). Validated via `x-csrf-token` header using `crypto.timingSafeEqual`. See "CSRF Exemptions" below.
- **RBAC roles:** `PATIENT` (1) < `PROVIDER` (2) < `ADMIN` (3). Hierarchy and permission mapping defined in `backend/src/middleware/rbac.ts`.
- **Demo account:** Email from `config.demo.email`. Blocked from AI endpoints, role changes, admin actions, and cross-user modifications.

### CSRF Exemptions
CSRF validation is skipped (see `backend/src/middleware/csrf.ts:98-163`) for:
- Public auth routes: `/auth/login`, `/auth/register`, `/auth/demo`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`
- Bearer-token upload routes: `/upload/lab-report`, `/upload/insurance-sbc`, `/upload/lab-results-ocr`, `/insurance/upload-sbc`
- Settings routes (Bearer-protected): `/settings/delete-data`, `/settings/delete-account`, `/settings/export-data`
- Biomarker guidance (Bearer-protected): `/biomarkers/:id/guidance`
- Insurance DELETE: `/insurance/plans/:id`

For all other state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`), the client must fetch a token via `GET /api/v1/csrf-token` and echo it in the `x-csrf-token` header.

---

## Error Response Shape

All error responses follow this structure (see `backend/src/middleware/errorHandler.ts`):

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": { "...": "optional, e.g. Zod validation details or lockout info" }
  }
}
```

### Standard Error Codes

| HTTP | Code | Class | When |
|------|------|-------|------|
| 400 | `BAD_REQUEST` | `BadRequestError` | Missing/malformed fields |
| 401 | `UNAUTHORIZED` | `UnauthorizedError` | Missing/invalid token |
| 401 | `AUTHENTICATION_FAILED` | `AuthenticationError` | Credential check failed |
| 401 | `INVALID_CREDENTIALS` | login | Wrong email/password; includes `remainingAttempts` |
| 403 | `FORBIDDEN` | `ForbiddenError` | RBAC deny, CSRF failure, demo block |
| 403 | `EMAIL_NOT_VERIFIED` | login | Account exists but unverified |
| 404 | `NOT_FOUND` | `NotFoundError` | Resource missing |
| 409 | `CONFLICT` | `ConflictError` | Duplicate resource |
| 422 | `VALIDATION_ERROR` | `ValidationError` | Zod parsing failed; `details` is `{ field, message, code }[]` |
| 423 | `ACCOUNT_LOCKED` | login | 5+ failed attempts; `details.lockedUntil` ISO timestamp |
| 429 | `RATE_LIMIT_EXCEEDED` | rate limiter | Bucket exhausted |
| 429 | `AUTH_RATE_LIMIT_EXCEEDED` | authLimiter | 20/15min on auth routes |
| 429 | `LOGIN_RATE_LIMIT_EXCEEDED` | strictAuthLimiter | 5/15min on login |
| 429 | `UPLOAD_RATE_LIMIT_EXCEEDED` | uploadLimiter | 20/hr uploads |
| 429 | `SENSITIVE_RATE_LIMIT_EXCEEDED` | sensitiveLimiter | 10/hr export/delete |
| 429 | `AI_RATE_LIMIT_EXCEEDED` | aiLimiter | 10/hr AI calls per user |
| 429 | `BULK_RATE_LIMIT_EXCEEDED` | bulkOperationLimiter | 30/hr bulk ops |
| 500 | `INTERNAL_ERROR` | `InternalServerError` | Unhandled server errors |
| 502 | `EXTERNAL_SERVICE_ERROR` | `ExternalServiceError` | Anthropic/SendGrid/GCS failures |
| 503 | `SERVICE_UNAVAILABLE` | `ServiceUnavailableError` | DB down, AI key missing |

---

## Rate Limits

Defined in `backend/src/middleware/rateLimiter.ts`. All return `429` with the JSON error shape above.

| Limiter | Window | Max | Key | Applied To |
|---------|--------|-----|-----|------------|
| `standardLimiter` | `config.rateLimit.windowMs` (default 15 min) | `config.rateLimit.maxRequests` (default 100) | IP | Global — `app.use(standardLimiter)` in `app.ts:166` |
| `authLimiter` | 15 min | 20 | IP | Whole `/auth` router (`authRoutes.ts:32`) |
| `strictAuthLimiter` | 15 min | 5 (failed only) | `email + IP` | `POST /auth/login`, `/auth/forgot-password`, `/auth/reset-password` |
| `uploadLimiter` | 1 hour | 20 | IP | `/upload/*` router; `POST /insurance/upload-sbc`; `PUT /insurance/plans/:id/reanalyze` |
| `sensitiveLimiter` | 1 hour | 10 | IP | `GET /files/:id/download`; `/settings/export-data`, `/delete-data`, `/delete-account`; `DELETE /admin/users/:id/permanent` |
| `aiLimiter` | 1 hour | 10 | user ID (fallback IP) | `POST /biomarkers/:id/guidance`; `POST /expenses/analyze`; `GET /health-goals/suggestions`; `GET /health-needs/analyze` |
| `bulkOperationLimiter` | 1 hour | 30 | IP | `POST /biomarkers/batch` |

---

## Global Middleware Stack

Order from `backend/src/app.ts`:
1. `helmet()` — security headers (line 94)
2. `cors(corsOptions)` — origin validation (line 151)
3. `cookieParser()` (line 157)
4. `standardLimiter` — global 100 req / 15 min (line 166)
5. `express.json({ limit: '10mb' })` (line 176)
6. `express.urlencoded({ extended: true, limit: '10mb' })` (line 177)
7. `requireJsonContentType` — rejects non-JSON bodies (line 180)
8. Route handlers at `/api/v1/*` (line 183)
9. `notFoundHandler` (line 226)
10. `errorHandler` (line 229)

---

## Health Check

### GET /health
Docker/Kubernetes liveness probe. Defined in `backend/src/app.ts:203`.

- **Auth:** No
- **CSRF:** No
- **Rate limit:** `standardLimiter` (global)
- **Demo blocked:** No

**Response 200:**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-16T12:00:00.000Z",
  "checks": { "database": "connected" }
}
```

**Response 503:** same shape with `"status": "unhealthy"`, `"database": "disconnected"`.

---

### GET /api/v1/health
Simple API version health check. Defined in `backend/src/routes/index.ts:38`.

- **Auth:** No
- **CSRF:** No
- **Rate limit:** `standardLimiter`

**Response 200:**
```json
{ "success": true, "data": { "status": "healthy", "timestamp": "..." } }
```

---

### GET /api/v1/csrf-token
Returns a fresh CSRF token and sets `csrf_token` cookie. Defined in `backend/src/app.ts:186`.

- **Auth:** No
- **Rate limit:** `standardLimiter`

**Response 200:**
```json
{ "success": true, "data": { "csrfToken": "<64 hex chars>" } }
```

---

## Auth Endpoints

Base path: `/api/v1/auth`. Router (`authRoutes.ts`) applies `authLimiter` (20/15min) to all routes via `router.use(authLimiter)`.

### POST /auth/register
Create a new account and send verification email. Does NOT issue tokens — user must verify email first.

- **Auth:** No
- **CSRF:** No (public auth route exemption)
- **Rate limit:** `authLimiter` (20/15min)
- **Demo blocked:** No
- **Middleware:** `authLimiter` → `validate(schemas.auth.register)`
- **Controller:** `authController.register`

**Request body** (`schemas.auth.register`):
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "Jane",
  "lastName": "Doe"
}
```
Password requires 8-128 chars with uppercase, lowercase, digit, and special char. `firstName`/`lastName` are optional sanitized strings (max 100).

**Response 201:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "user@example.com", "role": "PATIENT" },
    "message": "Registration successful. Please check your email to verify your account."
  }
}
```

**Errors:** 400 (email exists, weak password, invalid format), 422 (schema), 429.

---

### POST /auth/login

- **Auth:** No
- **CSRF:** No (public auth exemption)
- **Rate limit:** `authLimiter` + `strictAuthLimiter` (5/15min, failed-only, keyed by `email:IP`)
- **Demo blocked:** No
- **Middleware:** `authLimiter` → `strictAuthLimiter` → `validate(schemas.auth.login)`
- **Controller:** `authController.login`

**Request:**
```json
{ "email": "user@example.com", "password": "SecurePass123!" }
```

**Response 200** — also sets `access_token`, `refresh_token`, and `csrf_token` cookies:
```json
{
  "success": true,
  "data": { "user": { "id": "uuid", "email": "...", "role": "PATIENT" } }
}
```

**Errors:**
- 401 `INVALID_CREDENTIALS` with `details.remainingAttempts`
- 403 `EMAIL_NOT_VERIFIED`
- 423 `ACCOUNT_LOCKED` with `details.lockedUntil`
- 422 validation
- 429 rate limit

---

### POST /auth/refresh
Rotates refresh token, returns new access token in response body.

- **Auth:** No (reads `refresh_token` cookie)
- **CSRF:** No (public exemption)
- **Rate limit:** `authLimiter`
- **Controller:** `authController.refreshToken`

**Request:** empty body. Requires `refresh_token` cookie.

**Response 200** — sets new `access_token`, `refresh_token`, `csrf_token` cookies:
```json
{ "success": true, "data": { "token": "<new access JWT>" } }
```

**Errors:** 401 if cookie missing or token invalid/expired (clears cookies).

---

### POST /auth/demo
Demo login — only enabled when `config.demo.enabled=true` (never production).

- **Auth:** No
- **CSRF:** No (public exemption)
- **Rate limit:** `authLimiter`
- **Controller:** `authController.demoLogin`

**Request:** empty body.

**Response 200** — sets cookies (refresh token gets 30-day extended lifetime):
```json
{ "success": true, "data": { "user": { "id": "...", "email": "...", "role": "PATIENT" } } }
```

**Errors:** 400 when demo disabled or demo user not seeded.

---

### GET /auth/verify-email?token=xxx

- **Auth:** No
- **CSRF:** No (GET)
- **Rate limit:** `authLimiter`
- **Middleware:** `validate(schemas.auth.verifyEmailQuery, 'query')`
- **Controller:** `authController.verifyEmail`

**Response 200:**
```json
{ "success": true, "data": { "message": "Email verified successfully. You can now log in." } }
```

**Errors:** 400 `VERIFICATION_FAILED` (expired/invalid token).

---

### POST /auth/resend-verification

- **Auth:** No
- **CSRF:** No (public exemption)
- **Rate limit:** `authLimiter`
- **Middleware:** `validate(schemas.auth.resendVerification)`
- **Controller:** `authController.resendVerification`

**Request:**
```json
{ "email": "user@example.com" }
```

**Response 200** (always — does not leak account existence):
```json
{ "success": true, "data": { "message": "If the email exists and is unverified, a new verification email has been sent." } }
```

---

### POST /auth/forgot-password

- **Auth:** No
- **CSRF:** No (public exemption)
- **Rate limit:** `authLimiter` + `strictAuthLimiter`
- **Middleware:** `validate(schemas.auth.forgotPassword)`
- **Controller:** `authController.forgotPassword`

**Request:**
```json
{ "email": "user@example.com" }
```

**Response 200** (always returns success to prevent enumeration):
```json
{ "success": true, "data": { "message": "If an account exists with this email, a password reset link has been sent." } }
```

---

### POST /auth/reset-password

- **Auth:** No
- **CSRF:** No (public exemption)
- **Rate limit:** `authLimiter` + `strictAuthLimiter`
- **Middleware:** `validate(schemas.auth.resetPassword)`
- **Controller:** `authController.resetPasswordHandler`

**Request:**
```json
{ "token": "<reset token from email>", "newPassword": "NewPass123!" }
```

**Response 200:**
```json
{ "success": true, "data": { "message": "Password has been reset successfully. You can now log in with your new password." } }
```

**Errors:** 400 `RESET_FAILED` (expired/invalid token), 422 (weak password).

---

### POST /auth/logout

- **Auth:** Yes (`authenticate`)
- **CSRF:** Yes (not in exemption list; POST on authenticated route)
- **Rate limit:** `authLimiter`
- **Controller:** `authController.logout`

Revokes current refresh token; clears cookies.

**Response 200:** `{ "success": true }`

---

### POST /auth/logout-all

- **Auth:** Yes
- **CSRF:** Yes
- **Rate limit:** `authLimiter`
- **Controller:** `authController.logoutAll`

Revokes every refresh token for the user across all sessions.

**Response 200:** `{ "success": true }`

---

### GET /auth/me

- **Auth:** Yes
- **CSRF:** No (GET)
- **Rate limit:** `authLimiter`
- **Controller:** `authController.getCurrentUser`

**Response 200:**
```json
{ "success": true, "data": { "id": "uuid", "email": "...", "role": "PATIENT" } }
```

---

### POST /auth/change-password

- **Auth:** Yes
- **CSRF:** Yes
- **Rate limit:** `authLimiter`
- **Middleware:** `authenticate` → `validate(schemas.auth.changePassword)`
- **Controller:** `authController.changePassword`

**Request:**
```json
{ "currentPassword": "OldPass123!", "newPassword": "NewPass123!" }
```

**Side effect:** revokes all refresh tokens for this user and reissues new tokens via cookies for the current session.

**Response 200:** `{ "success": true }`

**Errors:** 401 `UNAUTHORIZED` (wrong current password), 422 (weak new password).

---

## Biomarker Endpoints

Base path: `/api/v1/biomarkers`. Router applies `authenticate` to every route (`biomarkerRoutes.ts:39`).

### GET /biomarkers

- **Auth:** Yes
- **CSRF:** No (GET)
- **Rate limit:** `standardLimiter`
- **Middleware:** `authenticate` → `validate(schemas.biomarker.listQuery, 'query')`
- **Controller:** `biomarkerController.getBiomarkers`

**Query:** `?category=<string>&page=<int>&limit=<int>` (limit clamped 1-100).

**Response 200** — values decrypted server-side:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "category": "Lipids",
      "name": "LDL",                     // PHI
      "unit": "mg/dL",                   // PHI
      "value": 120,                      // PHI (decrypted)
      "notes": "Fasting",                // PHI (decrypted, optional)
      "normalRange": { "min": 0, "max": 100, "source": "Lab" },
      "date": "2026-04-10",
      "sourceType": "MANUAL",
      "labName": "Quest",
      "isOutOfRange": true,
      "isAcknowledged": false,
      "history": [{ "date": "2025-11-01", "value": 110 }],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 12, "totalPages": 1 }
}
```

---

### GET /biomarkers/summary

- **Auth:** Yes
- **Rate limit:** `standardLimiter`
- **Controller:** `biomarkerController.getSummary`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "totalBiomarkers": 12,
    "inRangeCount": 8,
    "outOfRangeCount": 4,
    "acknowledgedCount": 5,
    "byCategory": [{ "category": "Lipids", "total": 3, "inRange": 1, "outOfRange": 2 }],
    "recentlyUpdated": 2,
    "lastUpdatedAt": "2026-04-10T00:00:00.000Z"
  }
}
```

---

### GET /biomarkers/categories

- **Auth:** Yes
- **Controller:** `biomarkerController.getCategories`

**Response 200:** `{ "success": true, "data": ["Lipids", "Metabolic", "Blood"] }`

---

### GET /biomarkers/:id

- **Auth:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `biomarkerController.getBiomarker`

**Response 200:** same single-object shape as list entry. **PHI** fields decrypted.

**Errors:** 404 `NOT_FOUND`, 422 (bad UUID).

---

### GET /biomarkers/:id/history

- **Auth:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `biomarkerController.getHistory`

**Query:** `?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&limit=<int>` (default 100, max 1000, default window 90 days).

**Response shape:** see `backend/src/controllers/biomarkerController.ts:772`.

---

### POST /biomarkers

- **Auth:** Yes
- **CSRF:** Yes
- **Rate limit:** `standardLimiter`
- **Middleware:** `authenticate` → `validate(schemas.biomarker.create)`
- **Controller:** `biomarkerController.createBiomarker`

**Request** (all string fields are sanitized; `value` encrypted before storage):
```json
{
  "name": "LDL",
  "value": 120,
  "unit": "mg/dL",
  "category": "Lipids",
  "date": "2026-04-10",
  "normalRange": { "min": 0, "max": 100, "source": "Lab" },
  "notes": "Fasting",
  "sourceType": "MANUAL",
  "labName": "Quest"
}
```

**Response 201:** full biomarker object (decrypted) inside `data`.

---

### POST /biomarkers/batch

- **Auth:** Yes
- **CSRF:** Yes
- **Rate limit:** `bulkOperationLimiter` (30/hr)
- **Middleware:** `authenticate` → `bulkOperationLimiter` → `validate(schemas.biomarker.batchCreate)`
- **Controller:** `biomarkerController.bulkCreateBiomarkers`

**Request:**
```json
{ "biomarkers": [ /* 1 to 100 biomarker objects */ ] }
```

**Response:** 201 on full success, 400 if all failed, else partial — see `biomarkerController.ts:545` / `:593`. Shape includes `succeeded`, `failedItems[]`.

---

### PATCH /biomarkers/:id

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')` → `validate(schemas.biomarker.update)`
- **Controller:** `biomarkerController.updateBiomarker`

**Request:** partial fields from `schemas.biomarker.update`.

**Response 200:** updated biomarker object.

---

### DELETE /biomarkers/:id

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `biomarkerController.deleteBiomarker`

**Response 200:** `{ "success": true }`

---

### POST /biomarkers/:id/guidance
Sends biomarker to Anthropic Claude API for educational guidance.

- **Auth:** Yes
- **CSRF:** No (Bearer-protected exemption — `/guidance` suffix)
- **Rate limit:** `aiLimiter` (10/hr per user)
- **Demo blocked:** Yes (`blockDemoAI`)
- **Middleware:** `authenticate` → `aiLimiter` → `blockDemoAI` → `validate(schemas.uuidParam, 'params')` → `validate(schemas.biomarker.guidance)`
- **Handler:** inline in `biomarkerRoutes.ts:108-234` (uses `fetch`, not SDK)
- **Model:** `claude-haiku-4-5-20251001`, max_tokens 600, 30s timeout

**Request:**
```json
{
  "biomarker": {
    "name": "LDL",
    "value": 120,
    "unit": "mg/dL",
    "normalRange": { "min": 0, "max": 100 },
    "status": "high",
    "history": [{ "value": 110, "date": "2025-11-01" }]
  }
}
```

**Response 200:** `{ "success": true, "data": { "guidance": "<markdown text>" } }`

**Errors:** 403 `FORBIDDEN` (demo), 429 `AI_RATE_LIMIT_EXCEEDED`, 502 (Anthropic error), 503 (no API key), 504 (timeout).

---

## Insurance Endpoints

Base path: `/api/v1/insurance`. Router applies `authenticate` to all routes (`insuranceRoutes.ts:62`).

### GET /insurance/plans

- **Auth:** Yes
- **Rate limit:** `standardLimiter`
- **Controller:** `insuranceController.getInsurancePlans`

**Query:** `?page=<int>&limit=<int>&activeOnly=<bool>`

**Response 200:** paginated list of decrypted plans — shape in `backend/src/controllers/insuranceController.ts:414`. **PHI**: `memberId`, `groupNumber`, `planName`, `insurerName` etc.

---

### GET /insurance/plans/:id

- **Auth:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `insuranceController.getInsurancePlan`

**Response 200:** single plan with `benefits[]` array. Errors 404.

---

### POST /insurance/plans

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.insurancePlan.create)`
- **Controller:** `insuranceController.createInsurancePlan`

**Request:** See `schemas.insurancePlan.create` in `validation.ts:379`. Required: `planName`, `insurerName`, `planType` (HMO/PPO/EPO/POS/HDHP), `effectiveDate`, `deductible`, `outOfPocketMax`. Optional member/group IDs, copays, coinsurance (0-100), `benefits[]`.

**Response 201:** created plan with `benefits[]`.

---

### PATCH /insurance/plans/:id

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')` → `validate(schemas.insurancePlan.update)`
- **Controller:** `insuranceController.updateInsurancePlan`

**Response 200:** updated plan.

---

### DELETE /insurance/plans/:id

- **Auth:** Yes
- **CSRF:** No (DELETE exemption for `/insurance/plans/`)
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `insuranceController.deleteInsurancePlan`

**Response 200:** `{ "success": true }`

---

### POST /insurance/compare

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** inline Zod `compareSchema` (`insuranceRoutes.ts:52`)
- **Controller:** `insuranceController.comparePlans`

**Request:**
```json
{ "planIds": ["uuid1", "uuid2"] }
```
2-5 plan IDs required.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "plans": [{ "id": "...", "name": "...", "type": "PPO", "premium": 450, "deductibleIndividual": 2000, "oopMaxIndividual": 7000 }],
    "benefitComparison": [
      { "serviceName": "Primary Care Visit", "coverage": [{ "planId": "...", "planName": "...", "covered": true, "copay": 25, "coinsurance": null }] }
    ]
  }
}
```

---

### GET /insurance/benefits/search

- **Auth:** Yes
- **Middleware:** `validate(benefitSearchSchema, 'query')` (inline; `insuranceRoutes.ts:56`)
- **Controller:** `insuranceController.searchBenefits`

**Query:** `?query=<string>&planId=<uuid?>`

**Response 200:** array of `{ planId, planName, benefit }` matches.

---

### POST /insurance/upload-sbc
Upload SBC PDF; Claude Sonnet extracts to an insurance plan.

- **Auth:** Yes
- **CSRF:** No (upload exemption)
- **Rate limit:** `uploadLimiter` (20/hr)
- **Demo blocked:** Yes (`blockDemoAI`)
- **Middleware:** `authenticate` → `blockDemoAI` → `uploadLimiter` → `multer.single('file')`
- **Controller:** `uploadController.uploadSBC`

**Request:** `multipart/form-data` with `file` (PDF, max 10MB).

**Response 201:** extracted plan summary — see `backend/src/controllers/uploadController.ts:786`. Includes `id`, `planName`, `insurerName`, `planType`, deductibles, OOP max, copays, coinsurance, `extractedFromSbc: true`, `sbcExtractionConfidence`, `usedClaudeExtraction`.

**Errors:** 400 (bad PDF), 422 (no data extracted), 429.

---

### PUT /insurance/plans/:id/reanalyze
Re-process a new SBC PDF against an existing plan, preserving user-entered fields.

- **Auth:** Yes
- **CSRF:** Yes (not in exemption list; `/reanalyze` is specific to `/plans/:id/`)
- **Rate limit:** `uploadLimiter`
- **Demo blocked:** Yes (`blockDemoAI`)
- **Middleware:** `validate(schemas.uuidParam, 'params')` → `blockDemoAI` → `uploadLimiter` → `multer.single('file')`
- **Controller:** `uploadController.reanalyzePlan`

**Request:** `multipart/form-data` with `file` (PDF).

**Response shape:** see `backend/src/controllers/uploadController.ts:832`.

---

### PUT /insurance/plans/:id/spending
Update current deductible + OOP spending for in-year tracking.

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `expenseController.updateCurrentSpending`

**Request:**
```json
{ "deductibleMet": 1250.50, "oopMet": 2100.00 }
```

**Response 200:** updated plan row (raw Prisma object) — see `backend/src/controllers/expenseController.ts:268`.

**Errors:** 400 missing fields.

---

## Expense Endpoints

Base path: `/api/v1/expenses`. All routes require auth (`expenseRoutes.ts:26`).

### GET /expenses/projections

- **Auth:** Yes
- **Middleware:** `validate(schemas.expense.projectionsQuery, 'query')`
- **Controller:** `expenseController.getProjections`

**Query:** `?planId=<uuid>` (optional).

**Response 200** — returns a plain array (not wrapped in `{ success, data }` — see `expenseController.ts:144`):
```json
[
  { "id": "...", "userId": "...", "planId": "...", "serviceType": "...", "estimatedCost": 120, "frequencyPerYear": 4, "isInNetwork": true, "notes": "..." }
]
```
**PHI**: `serviceType`, `estimatedCost`, `notes` (decrypted).

---

### POST /expenses/projections

- **Auth:** Yes
- **CSRF:** Yes (`csrfProtection` explicit in route)
- **Middleware:** `authenticate` → `csrfProtection` → `validate(schemas.expense.createProjection)`
- **Controller:** `expenseController.createProjection`

**Request:**
```json
{
  "planId": "uuid",
  "serviceType": "Specialist Visit",
  "estimatedCost": 250.00,
  "frequencyPerYear": 4,
  "isInNetwork": true,
  "notes": "Quarterly checkup"
}
```

**Response 201:** unwrapped projection object (decrypted). See `expenseController.ts:98`.

---

### PUT /expenses/projections/:id

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `csrfProtection` → `validate(schemas.uuidParam, 'params')` → `validate(schemas.expense.updateProjection)`
- **Controller:** `expenseController.updateProjection`

**Response 200:** unwrapped updated projection.

---

### DELETE /expenses/projections/:id

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `csrfProtection` → `validate(schemas.uuidParam, 'params')`
- **Controller:** `expenseController.deleteProjection`

**Response 204:** empty.

---

### POST /expenses/analyze
Claude-powered annual cost projection.

- **Auth:** Yes
- **CSRF:** Yes
- **Rate limit:** `aiLimiter` (10/hr per user)
- **Demo blocked:** Yes (`blockDemoAI`)
- **Middleware:** `authenticate` → `aiLimiter` → `blockDemoAI` → `csrfProtection` → `validate(schemas.expense.analyzeCosts)`
- **Controller:** `expenseController.analyzeCosts`

**Request:** `{ "planId": "uuid" }`

**Response 200** — unwrapped:
```json
{
  "id": "uuid",
  "analysisDate": "2026-04-16T...",
  "claudeResponse": "<markdown analysis>",   // PHI (decrypted)
  "totalProjectedOop": 4850.00,              // PHI
  "deductibleMetMonth": 7
}
```

**Errors:** 400 missing plan ID, 429, 504 (timeout), 500 analysis failure.

---

### GET /expenses/analyses

- **Auth:** Yes
- **Middleware:** `validate(schemas.expense.analysesQuery, 'query')`
- **Controller:** `expenseController.getAnalyses`

**Query:** `?planId=<uuid>` (optional). Returns last 10 analyses.

**Response 200:** unwrapped array of decrypted analyses — see `expenseController.ts:442`.

---

## Health Goal Endpoints

Base path: `/api/v1/health-goals`. All routes require auth (`healthGoalsRoutes.ts:42`).

### GET /health-goals/summary

- **Auth:** Yes
- **Controller:** `healthGoalsController.getGoalsSummary`

**Response 200:** `{ success, data: { byStatus, byCategory, total, active, achieved, needAttention, recentlyAchieved } }`.

---

### GET /health-goals/suggestions
AI-assisted goal suggestions from out-of-range biomarkers.

- **Auth:** Yes
- **Rate limit:** `aiLimiter` (10/hr)
- **Controller:** `healthGoalsController.suggestGoals`

**Response 200:** `{ success, data: [{ name, category, targetValue, unit, direction, relatedBiomarkerId, description }] }`.

---

### GET /health-goals

- **Auth:** Yes
- **Middleware:** `validate(schemas.healthGoal.listQuery, 'query')`
- **Controller:** `healthGoalsController.getHealthGoals`

**Query:** `?status=<ACTIVE|PAUSED|ACHIEVED|FAILED|CANCELLED>&category=<WEIGHT|FITNESS|...>`

**Response 200:** `{ success, data: HealthGoalResponse[] }`. **PHI**: `description`, progress notes (decrypted).

---

### GET /health-goals/:id

- **Auth:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `healthGoalsController.getHealthGoal`

**Response 200:** single goal including `progressHistory[]`.

---

### POST /health-goals

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.healthGoal.create)`
- **Controller:** `healthGoalsController.createHealthGoal`

**Request** (`schemas.healthGoal.create`):
```json
{
  "name": "Lower LDL",
  "description": "Reduce LDL to below 100",
  "category": "BIOMARKER",
  "targetValue": 95,
  "currentValue": 130,
  "unit": "mg/dL",
  "direction": "DECREASE",
  "relatedBiomarkerId": "uuid",
  "startDate": "2026-04-01",
  "targetDate": "2026-10-01",
  "milestones": [{ "value": 115, "label": "Halfway" }],
  "reminderFrequency": "WEEKLY"
}
```

**Response 201:** full goal with computed initial `progress`.

---

### PUT /health-goals/:id

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')` → `validate(schemas.healthGoal.update)`
- **Controller:** `healthGoalsController.updateHealthGoal`

**Response 200:** updated goal.

---

### PATCH /health-goals/:id/progress

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')` → `validate(schemas.healthGoal.updateProgress)`
- **Controller:** `healthGoalsController.updateGoalProgress`

**Request:**
```json
{ "value": 110, "note": "After 3 months of diet" }
```

Auto-marks goal `ACHIEVED` when progress ≥ 100%.

**Response 200:** goal with updated `progressHistory`.

---

### DELETE /health-goals/:id

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `healthGoalsController.deleteHealthGoal`

**Response 200:** `{ "success": true }`

---

## Health Need Endpoints

Base path: `/api/v1/health-needs`. All routes require auth (`healthNeedsRoutes.ts:38`).

### GET /health-needs

- **Auth:** Yes
- **Middleware:** `validate(schemas.healthNeed.listQuery, 'query')`
- **Controller:** `healthNeedsController.getHealthNeeds`

**Query:** `?status=<PENDING|IN_PROGRESS|COMPLETED|DISMISSED>&urgency=<IMMEDIATE|URGENT|FOLLOW_UP|ROUTINE>&needType=<CONDITION|ACTION|SERVICE|MEDICATION|LIFESTYLE>`

**Response 200:** `{ success, data: HealthNeedResponse[] }`. Sorted IMMEDIATE → ROUTINE. **PHI**: `description` (decrypted).

---

### GET /health-needs/analyze
Suggests health needs from user's out-of-range biomarkers.

- **Auth:** Yes
- **Rate limit:** `aiLimiter`
- **Controller:** `healthNeedsController.analyzeHealthNeeds`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "detectedConditions": [],
    "recommendations": ["Schedule appointment...", "..."],
    "outOfRangeBiomarkers": [{ "id": "...", "name": "LDL", "category": "Lipids" }]
  }
}
```

---

### GET /health-needs/:id

- **Auth:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `healthNeedsController.getHealthNeed`

**Response 200:** single need with decrypted description.

---

### POST /health-needs

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.healthNeed.create)`
- **Controller:** `healthNeedsController.createHealthNeed`

**Request:**
```json
{
  "needType": "ACTION",
  "name": "Follow up on LDL",
  "description": "Schedule lipid panel",
  "urgency": "FOLLOW_UP",
  "relatedBiomarkerIds": ["uuid"]
}
```

**Response 201:** created need (status `PENDING`).

---

### PATCH /health-needs/:id

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')` → `validate(schemas.healthNeed.update)`
- **Controller:** `healthNeedsController.updateHealthNeedStatus`

Note: handler name is `updateHealthNeedStatus` but Zod update schema allows `name`, `description`, `urgency`, `status`, `relatedBiomarkerIds`, `notes`, `actionPlan`. When `status = "COMPLETED"`, sets `resolvedAt`.

**Response 200:** updated need.

---

### DELETE /health-needs/:id

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `healthNeedsController.deleteHealthNeed`

**Response 200:** `{ "success": true }`

---

## Upload Endpoints

Base path: `/api/v1/upload`. Router applies `uploadLimiter` (20/hr) to all routes (`uploadRoutes.ts:25`).

### POST /upload/lab-report
Parse lab-report PDF via Claude extraction, create biomarkers.

- **Auth:** Yes
- **CSRF:** No (upload exemption)
- **Rate limit:** `uploadLimiter`
- **Demo blocked:** Yes (`blockDemoAI`)
- **Middleware:** `uploadLimiter` → `authenticate` → `blockDemoAI` → `multer.single('file')`
- **Controller:** `uploadController.uploadLabReport`

**Request:** `multipart/form-data` with `file` (PDF only, 10MB max).

**Response 201:**
```json
{
  "success": true,
  "data": {
    "biomarkersCreated": 12,
    "biomarkers": [ /* decrypted BiomarkerResponse[] */ ],
    "labName": "Quest",
    "reportDate": "2026-04-10T00:00:00.000Z",
    "extractionConfidence": 0.94
  }
}
```

**Errors:** 422 (nothing extracted / non-PDF), 429.

---

### POST /upload/insurance-sbc
Alias for `POST /insurance/upload-sbc`. Same controller (`uploadController.uploadSBC`), same response shape.

- **Auth:** Yes
- **CSRF:** No (upload exemption)
- **Rate limit:** `uploadLimiter`
- **Demo blocked:** Yes
- **Middleware:** `uploadLimiter` → `authenticate` → `blockDemoAI` → `multer.single('file')`

---

### POST /upload/lab-results-ocr
Google Document AI OCR for PDF + images (PNG/JPEG/TIFF/GIF/WebP), 10MB max.

- **Auth:** Yes
- **CSRF:** No (upload exemption)
- **Rate limit:** `uploadLimiter`
- **Demo blocked:** Yes (`blockDemoAI`)
- **Middleware:** `uploadLimiter` → `authenticate` → `blockDemoAI` → `multer.single('file')`
- **Controller:** `uploadController.uploadLabResultOCR`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "biomarkersCreated": 5,
    "biomarkers": [ /* decrypted */ ],
    "labName": "Quest",
    "reportDate": "2026-04-10T00:00:00.000Z",
    "extractionConfidence": 0.91,
    "ocrMetadata": { "processingTimeMs": 2340, "pageCount": 3, "documentType": "application/pdf" },
    "file": { "id": "uuid", "filename": "...", "storageKey": "users/<id>/<uuid>" }
  }
}
```

**Errors:** 422 (no biomarkers extracted), 429.

---

## File Endpoints

Base path: `/api/v1/files`. All routes require auth (`fileRoutes.ts:27`).

### GET /files

- **Auth:** Yes
- **Controller:** `fileController.getFiles`

**Response 200:** `{ success, data: UserFileResponse[] }` with `id`, `filename`, `originalFilename`, `fileType`, `fileSize`, `storageKey`, `labName`, `labDate`, `biomarkersExtracted`, `extractionConfidence`, `categories[]`, `createdAt`.

---

### GET /files/:id

- **Auth:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `fileController.getFile`

**Response 200:** `UserFileResponse` with `downloadUrl` (short-lived GCS signed URL).

---

### GET /files/:id/download
Issues a fresh 15-minute GCS signed URL and audit-logs an EXPORT event.

- **Auth:** Yes
- **Rate limit:** `sensitiveLimiter` (10/hr)
- **Middleware:** `sensitiveLimiter` → `validate(schemas.uuidParam, 'params')`
- **Controller:** `fileController.getFileDownloadUrl`

**Response 200:**
```json
{ "success": true, "data": { "url": "https://storage.googleapis.com/...", "expiresIn": 900 } }
```

---

### DELETE /files/:id
Removes GCS object, unlinks biomarkers (preserves biomarker rows), deletes DB file record.

- **Auth:** Yes
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Controller:** `fileController.deleteFile`

**Response 200:** `{ "success": true }`

---

## Provider Endpoints

Base path: `/api/v1/provider`. Router requires **PROVIDER or ADMIN** role (`providerRoutes.ts:24-25`: `authenticate` + `requireRole('PROVIDER','ADMIN')`).

### GET /provider/patients
List all `ACTIVE` and `PENDING` relationships for this provider.

- **Auth:** Yes (role enforced)
- **Controller:** inline (`providerRoutes.ts:31-94`)

**Response 200:** `{ success, data: [{ relationshipId, patientId, patient: { id, email, createdAt }, permissions: { canViewBiomarkers, canViewInsurance, canViewDna, canViewHealthNeeds, canEditData }, relationshipType, status, consentGrantedAt, consentExpiresAt, createdAt }] }`.

---

### POST /provider/patients/request
Request access to a patient by email.

- **Auth:** Yes (role enforced)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.providerPatient.request)`
- **Handler:** inline (`providerRoutes.ts:100-201`)

**Request:**
```json
{
  "patientEmail": "patient@example.com",
  "relationshipType": "PRIMARY_CARE",
  "message": "Optional provider note — encrypted before storage"
}
```

**Response 201:** `{ success, data: { relationshipId, status: "PENDING" } }`.

**Errors:** 404 (patient email not found), 403 (not a patient account, or relationship already ACTIVE/PENDING).

---

### GET /provider/patients/:patientId
Get patient details — requires ACTIVE relationship and non-expired consent.

- **Auth:** Yes (role enforced)
- **Middleware:** `validate(schemas.patientIdParam, 'params')`
- **Handler:** inline (`providerRoutes.ts:207-300`)

**Response 200:** `{ success, data: { patient: { id, email, createdAt, lastLoginAt }, relationship: { id, relationshipType, permissions, consentGrantedAt, consentExpiresAt } } }`.

**Errors:** 403 (no relationship, inactive, or consent expired), 404 (patient gone).

---

### GET /provider/patients/:patientId/biomarkers
Requires ACTIVE relationship + `canViewBiomarkers`.

- **Auth:** Yes (role enforced)
- **Middleware:** `validate(schemas.patientIdParam, 'params')`
- **Handler:** inline (`providerRoutes.ts:306-403`)

**Response 200:** `{ success, data: BiomarkerResponse[] }` — values decrypted using patient's encryption key. **PHI** cross-user access; audit-logged as `PHI_ACCESS`.

**Errors:** 403 (no relationship, expired consent, or permission denied).

---

### GET /provider/patients/:patientId/health-needs
Requires ACTIVE relationship + `canViewHealthNeeds`.

- **Auth:** Yes (role enforced)
- **Middleware:** `validate(schemas.patientIdParam, 'params')`
- **Handler:** inline (`providerRoutes.ts:409-497`)

**Response 200:** `{ success, data: HealthNeedResponse[] }` — decrypted.

---

### DELETE /provider/patients/:patientId
Remove relationship with a patient.

- **Auth:** Yes (role enforced)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.patientIdParam, 'params')`
- **Handler:** inline (`providerRoutes.ts:503-569`)

**Response 200:** `{ success, data: { message: "Patient relationship removed" } }`.

**Errors:** 404 no relationship, 403 inactive or consent expired.

---

## Patient Consent Endpoints

Base path: `/api/v1/patient`. Router requires **PATIENT** role (`patientRoutes.ts:22-24`: `authenticate` + `requireRole('PATIENT')`).

### GET /patient/providers
List all providers who have relationships with this patient (any status).

- **Auth:** Yes (PATIENT only)
- **Handler:** inline (`patientRoutes.ts:30-92`)

**Response 200:** `{ success, data: [{ relationshipId, providerId, provider: { id, email }, permissions, relationshipType, status, consentGrantedAt, consentExpiresAt, createdAt }] }`.

---

### GET /patient/providers/pending
List PENDING access requests only.

- **Auth:** Yes (PATIENT only)
- **Handler:** inline (`patientRoutes.ts:98-153`)

**Response 200:** `{ success, data: [{ requestId, providerId, provider: { id, email }, relationshipType, requestedAt }] }`.

---

### POST /patient/providers/:id/approve
Approve a pending provider request with granular permissions.

- **Auth:** Yes (PATIENT only)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')` → `validate(schemas.providerPatient.approve)`
- **Handler:** inline (`patientRoutes.ts:159-242`)

**Request:**
```json
{
  "canViewBiomarkers": true,
  "canViewInsurance": false,
  "canViewDna": false,
  "canViewHealthNeeds": true,
  "canEditData": false,
  "consentDurationDays": 180
}
```
All permissions optional with defaults. `consentDurationDays` 1-365; omitted means no expiration.

**Response 200:** `{ success, data: { message, relationship: <updated ProviderPatient> } }`. Audit-logged as `CONSENT_GRANTED`.

**Errors:** 404 (request not found or already processed).

---

### POST /patient/providers/:id/deny
Deny a pending request (deletes the row).

- **Auth:** Yes (PATIENT only)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Handler:** inline (`patientRoutes.ts:248-296`)

**Response 200:** `{ success, data: { message: "Provider access denied" } }`. Audit-logged as `CONSENT_DENIED`.

---

### PATCH /patient/providers/:id
Update permissions on an ACTIVE relationship.

- **Auth:** Yes (PATIENT only)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')` → `validate(schemas.providerPatient.updatePermissions)`
- **Handler:** inline (`patientRoutes.ts:302-369`)

**Request:** any subset of `canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canViewHealthNeeds`, `canEditData` (booleans).

**Response 200:** `{ success, data: <updated ProviderPatient> }`. Audit-logged as `PERMISSIONS_UPDATED`.

---

### POST /patient/providers/:id/revoke
Revoke an ACTIVE relationship (sets `status=REVOKED`).

- **Auth:** Yes (PATIENT only)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Handler:** inline (`patientRoutes.ts:375-431`)

**Response 200:** `{ success, data: { message: "Provider access revoked" } }`. Audit-logged as `CONSENT_REVOKED`.

---

### DELETE /patient/providers/:id
Permanently delete the relationship row.

- **Auth:** Yes (PATIENT only)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Handler:** inline (`patientRoutes.ts:437-487`)

**Response 200:** `{ success, data: { message: "Provider relationship removed" } }`.

---

## Settings Endpoints

Base path: `/api/v1/settings`. All routes require auth (`settingsRoutes.ts:25`). All routes use `sensitiveLimiter` (10/hr).

### GET /settings/export-data
Export all user data as JSON (fully decrypted server-side).

- **Auth:** Yes
- **CSRF:** No (settings exemption — Bearer-protected)
- **Rate limit:** `sensitiveLimiter` (10/hr)
- **Controller:** `settingsController.exportUserData`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "exportDate": "2026-04-16T...",
    "user": { "email": "...", "createdAt": "..." },
    "biomarkers": [ /* fully decrypted PHI */ ],
    "insurancePlans": [ /* PHI */ ],
    "summary": { "totalBiomarkers": 12, "byCategory": {...}, "abnormalCount": 4, "normalCount": 8 }
  }
}
```
Audit-logged as `EXPORT` on `UserData`.

---

### DELETE /settings/delete-data
Deletes biomarkers, insurance plans, health needs, and health goals for this user. Account itself is retained.

- **Auth:** Yes
- **CSRF:** No (settings exemption)
- **Rate limit:** `sensitiveLimiter`
- **Controller:** `settingsController.deleteAllData`

**Response 200:** `{ "success": true }`. Audit-logged with per-resource deletion counts.

---

### DELETE /settings/delete-account
Delete account + all associated data. Requires password confirmation in body.

- **Auth:** Yes
- **CSRF:** No (settings exemption)
- **Rate limit:** `sensitiveLimiter`
- **Controller:** `settingsController.deleteAccount`

**Request:** `{ "password": "CurrentPass123!" }`

**Response 200:** `{ "success": true }` — response shape continues in `settingsController.ts:257`.

**Errors:** 401 (wrong password or user missing).

---

## Admin Endpoints

Base path: `/api/v1/admin`. Router requires **ADMIN** role (`adminRoutes.ts:26-27`: `authenticate` + `requireRole('ADMIN')`).

### GET /admin/users
List users with pagination and filters.

- **Auth:** Yes (ADMIN only)
- **Middleware:** `validate(schemas.admin.listUsersQuery, 'query')`
- **Handler:** inline (`adminRoutes.ts:37-111`)

**Query:** `?role=<PATIENT|PROVIDER|ADMIN>&isActive=<true|false>&search=<substr>&page=<int>&limit=<int>` (limit max 100).

**Response 200:**
```json
{
  "success": true,
  "data": {
    "users": [{ "id", "email", "role", "isActive", "emailVerified", "createdAt", "lastLoginAt", "_count": { "biomarkers", "insurancePlans", "healthNeeds" } }],
    "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
  }
}
```

---

### GET /admin/users/:id

- **Auth:** Yes (ADMIN only)
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Handler:** inline (`adminRoutes.ts:117-176`)

**Response 200:** `{ success, data: { id, email, role, isActive, emailVerified, createdAt, updatedAt, lastLoginAt, _count: { biomarkers, insurancePlans, healthNeeds, dnaData, sessions, auditLogs } } }`.

---

### POST /admin/users
Admin can create users with any role.

- **Auth:** Yes (ADMIN only)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.admin.createUser)`
- **Handler:** inline (`adminRoutes.ts:182-236`)

**Request:**
```json
{
  "email": "new@user.com",
  "password": "StrongPass123!",
  "role": "PROVIDER",
  "isActive": true,
  "emailVerified": false
}
```

**Response 201:** created user (no passwordHash).

**Errors:** 400 `BAD_REQUEST` if email already registered.

---

### PATCH /admin/users/:id
Admin cannot change their own role (self-lockout protection).

- **Auth:** Yes (ADMIN only)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')` → `validate(schemas.admin.updateUser)`
- **Handler:** inline (`adminRoutes.ts:242-320`)

**Request:** any subset of `role`, `isActive`, `emailVerified`, `password`.

**Response 200:** updated user. Role changes audit-logged as `PERMISSION_CHANGE`.

**Errors:** 403 (modifying own role), 404.

---

### DELETE /admin/users/:id
Soft delete — sets `isActive=false` and invalidates all sessions.

- **Auth:** Yes (ADMIN only)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Handler:** inline (`adminRoutes.ts:326-391`)

**Response 200:** `{ success, data: { message: "User deactivated successfully" } }`.

**Errors:** 403 (self-deletion), 404.

---

### DELETE /admin/users/:id/permanent
Permanent cascade delete. Requires `confirmEmail` in body matching user's email.

- **Auth:** Yes (ADMIN only)
- **CSRF:** Yes
- **Rate limit:** `sensitiveLimiter` (10/hr)
- **Middleware:** `sensitiveLimiter` → `validate(schemas.uuidParam, 'params')`
- **Handler:** inline (`adminRoutes.ts:398-470`)

**Request:** `{ "confirmEmail": "target@example.com" }`

**Response 200:** `{ success, data: { message: "User permanently deleted" } }`.

**Errors:** 400 `BAD_REQUEST` if `confirmEmail` doesn't match, 403 (self-deletion), 404.

---

### GET /admin/provider-relationships
List all ProviderPatient rows (max 100), filterable by status.

- **Auth:** Yes (ADMIN only)
- **Handler:** inline (`adminRoutes.ts:480-510`)

**Query:** `?status=<ACTIVE|PENDING|DENIED|REVOKED>`

**Response 200:** `{ success, data: ProviderPatient[] }`.

---

### PATCH /admin/provider-relationships/:id
Admin override of any relationship's status/permissions.

- **Auth:** Yes (ADMIN only)
- **CSRF:** Yes
- **Middleware:** `validate(schemas.uuidParam, 'params')`
- **Handler:** inline (`adminRoutes.ts:516-580`)

**Request:** any subset of `status`, `canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canViewHealthNeeds`, `canEditData`.

**Response 200:** `{ success, data: <updated relationship> }`.

**Errors:** 404.

---

### GET /admin/stats

- **Auth:** Yes (ADMIN only)
- **Handler:** inline (`adminRoutes.ts:590-649`)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "users": { "total": 142, "active": 138, "byRole": { "PATIENT": 120, "PROVIDER": 20, "ADMIN": 2 }, "recentLogins": 45 },
    "data":  { "biomarkers": 2340, "insurancePlans": 180, "healthNeeds": 420 }
  }
}
```

---

### GET /admin/audit-logs
HIPAA audit log viewer. Note: admin viewing audit logs is itself audit-logged (meta-audit).

- **Auth:** Yes (ADMIN only)
- **Middleware:** `validate(schemas.admin.auditLogQuery, 'query')`
- **Handler:** inline (`adminRoutes.ts:658-729`)

**Query:** `?userId=<uuid>&action=<str>&resourceType=<str>&startDate=<YYYY-MM-DD>&endDate=<YYYY-MM-DD>&page=<int>&limit=<int>` (limit max 200).

**Response 200:**
```json
{
  "success": true,
  "data": {
    "logs": [{ "...AuditLog fields...", "user": { "id", "email", "role" } }],
    "pagination": { "page": 1, "limit": 50, "total": 12034, "totalPages": 241 }
  }
}
```

---

## Appendix: Role & Resource Permission Matrix

From `backend/src/middleware/rbac.ts:31-56` (`ROLE_PERMISSIONS`):

| Resource | PATIENT | PROVIDER | ADMIN |
|---|---|---|---|
| `biomarker` | read, write, delete (own only) | read, write (authorized patients) | read, write, delete, admin |
| `insurance` | read, write, delete (own only) | read (authorized patients) | read, write, delete, admin |
| `dna` | read, write, delete (own only) | read (authorized patients) | read, write, delete, admin |
| `healthNeed` | read, write, delete (own only) | read, write (authorized patients) | read, write, delete, admin |
| `user` | read, write (own profile) | read, write (own + limited patient) | read, write, delete, admin |
| `providerPatient` | read, write (own relationships) | read, write, delete (own) | read, write, delete, admin |

Provider access is further gated by `ProviderPatient.status === 'ACTIVE'`, non-expired `consentExpiresAt`, and per-resource flags (`canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canViewHealthNeeds`, `canEditData`) checked in `checkProviderPatientAccess` (`rbac.ts:195-245`).

---

## Appendix: PHI Fields in Responses

Responses decrypt PHI server-side before transmission. The fields below are encrypted at rest (AES-256-GCM, per-user keys derived via PBKDF2-SHA512 from `user_encryption_salts`) and come back as plaintext in response bodies:

- **User:** `firstName`, `lastName`, `dob`, `phone`, `address`
- **Biomarker / BiomarkerHistory:** `value`, `notes`, `unit`
- **InsurancePlan:** `memberId`, `groupNumber`, `planName`, `insurerName`, all `benefits[].*`
- **HealthGoal / GoalProgressHistory:** `description`, `note`, `targetValue`-related notes
- **HealthNeed:** `description`
- **ProviderPatient:** `notes` (request message)
- **ExpenseProjection:** `serviceType`, `estimatedCost`, `notes`
- **CostAnalysis:** `claudeResponse`, `totalProjectedOop`
- **AuditLog.previousValue / AuditLog.newValue:** encrypted PHI snapshots

---

## Appendix: Audit Logging

Every PHI access, create, update, delete, and export is recorded in `AuditLog` with:
- `userId` (actor)
- `resourceType` (e.g. `Biomarker`, `InsurancePlan`, `patient_biomarkers`)
- `resourceId`
- `action` (LIST, VIEW, CREATE, UPDATE, DELETE, EXPORT, PHI_ACCESS, CONSENT_GRANTED, etc.)
- `previousValue` / `newValue` (encrypted JSON)
- IP address, user agent, timestamp

Retention: 7 years (HIPAA). Cleanup scheduler in `backend/src/services/auditLog.ts`.
