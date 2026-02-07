# OwnMyHealth API Reference

**Base URL:** `https://api.ownmyhealth.io/api/v1`
**Last Updated:** 2026-02-06

---

## Table of Contents

1. [Authentication](#authentication)
2. [Error Responses](#error-responses)
3. [Health Check](#health-check)
4. [API Info](#api-info)
5. [Auth Endpoints](#auth-endpoints)
6. [Biomarker Endpoints](#biomarker-endpoints)
7. [Insurance Endpoints](#insurance-endpoints)
8. [Expense Endpoints](#expense-endpoints)
9. [Health Goal Endpoints](#health-goal-endpoints)
10. [Health Need Endpoints](#health-need-endpoints)
11. [Upload Endpoints](#upload-endpoints)
12. [File Endpoints](#file-endpoints)
13. [Provider Endpoints](#provider-endpoints)
14. [Patient Consent Endpoints](#patient-consent-endpoints)
15. [Settings Endpoints](#settings-endpoints)
16. [Admin Endpoints](#admin-endpoints)
17. [Rate Limits](#rate-limits)

---

## Authentication

OwnMyHealth uses **JWT-based authentication** with HTTP-only cookies and optional Bearer token support.

- **Access tokens** are short-lived (15 minutes) and stored in an HTTP-only `access_token` cookie.
- **Refresh tokens** are long-lived (7 days) and stored in an HTTP-only `refresh_token` cookie.
- Tokens can also be sent via `Authorization: Bearer <token>` header (for API clients).
- **CSRF protection** uses the double-submit cookie pattern. The `csrf_token` cookie is readable by JavaScript. For state-changing requests (POST, PUT, PATCH, DELETE), send the CSRF token value in the `X-CSRF-Token` header.
- Some routes are exempt from CSRF validation (public auth routes, file uploads, settings routes, AI guidance) because they rely on Bearer token auth which browsers cannot automatically include in cross-origin requests.

### Token Priority

1. HTTP-only cookie (`access_token`) -- preferred, more secure
2. `Authorization: Bearer <token>` header -- fallback for API clients

### Roles

| Role | Level | Capabilities |
|------|-------|-------------|
| PATIENT | 1 | Own data CRUD, manage provider consent, AI guidance |
| PROVIDER | 2 | + View authorized patient data (scoped by consent permissions) |
| ADMIN | 3 | + User management, audit log viewer, system health stats |

---

## Error Responses

All error responses follow this standard format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `AUTH_RATE_LIMIT_EXCEEDED` | 429 | Too many auth attempts |
| `LOGIN_RATE_LIMIT_EXCEEDED` | 429 | Too many login attempts |
| `UPLOAD_RATE_LIMIT_EXCEEDED` | 429 | Too many file uploads |
| `SENSITIVE_RATE_LIMIT_EXCEEDED` | 429 | Rate limit for sensitive operations |
| `BULK_RATE_LIMIT_EXCEEDED` | 429 | Too many bulk operations |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `ACCOUNT_LOCKED` | 423 | Account locked after failed attempts |
| `EMAIL_NOT_VERIFIED` | 403 | Email verification required |
| `VERIFICATION_FAILED` | 400 | Invalid verification token |
| `VALIDATION_ERROR` | 400 | Input validation failed |

---

## Health Check

### GET /health

Check API status. No authentication required.

**Auth Required:** No
**Rate Limiter:** standardLimiter
**CSRF Required:** No

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-02-06T12:00:00.000Z"
  }
}
```

---

## API Info

### GET /

Get API version and available endpoint groups.

**Auth Required:** No
**Rate Limiter:** standardLimiter
**CSRF Required:** No

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "version": "v1",
    "endpoints": [
      "/api/v1/auth",
      "/api/v1/biomarkers",
      "/api/v1/insurance",
      "/api/v1/expenses",
      "/api/v1/health-needs",
      "/api/v1/health-goals",
      "/api/v1/provider",
      "/api/v1/patient",
      "/api/v1/admin",
      "/api/v1/upload",
      "/api/v1/files",
      "/api/v1/settings"
    ]
  }
}
```

---

## Auth Endpoints

All auth routes use **authLimiter** (20 requests per 15 minutes) as a baseline.

### POST /auth/register

Create a new account. Sends a verification email.

**Auth Required:** No
**Rate Limiter:** authLimiter
**CSRF Required:** No (public auth route)
**Validation:** Zod `schemas.auth.register`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "Jane",
  "lastName": "Doe"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| email | string | Yes | Valid email, max 255 chars |
| password | string | Yes | 8-128 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char |
| firstName | string | No | Max 100 chars |
| lastName | string | No | Max 100 chars |

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "PATIENT"
    },
    "message": "Registration successful. Please check your email to verify your account."
  }
}
```

**Notes:** No tokens are issued on registration. The user must verify their email first, then log in.

---

### POST /auth/login

Authenticate a user and receive tokens via HTTP-only cookies.

**Auth Required:** No
**Rate Limiter:** authLimiter + strictAuthLimiter (5 attempts per 15 min, keyed by email+IP, skips successful requests)
**CSRF Required:** No (public auth route)
**Validation:** Zod `schemas.auth.login`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| email | string | Yes | Valid email |
| password | string | Yes | 1-128 chars |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "PATIENT"
    }
  }
}
```

**Error Responses:**
- `401` -- Invalid credentials (includes `remainingAttempts`)
- `403` -- Email not verified (`code: "EMAIL_NOT_VERIFIED"`)
- `423` -- Account locked (`code: "ACCOUNT_LOCKED"`, includes `lockedUntil`)

**Cookies Set:** `access_token`, `refresh_token` (HTTP-only, secure, sameSite)

---

### POST /auth/refresh

Refresh the access token using the refresh token from the cookie. Implements token rotation.

**Auth Required:** No (uses refresh_token cookie)
**Rate Limiter:** authLimiter
**CSRF Required:** No (public auth route)

**Request:** No body required. Reads `refresh_token` from cookies.

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "token": "new_access_token_value"
  }
}
```

**Cookies Set:** New `access_token` and `refresh_token` (rotated)

---

### POST /auth/demo

Login with the demo account (development only, disabled in production).

**Auth Required:** No
**Rate Limiter:** authLimiter
**CSRF Required:** No (public auth route)

**Request:** No body required.

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "demo@ownmyhealth.io",
      "role": "PATIENT"
    }
  }
}
```

**Cookies Set:** `access_token`, `refresh_token` (with extended duration for demo)

---

### GET /auth/verify-email

Verify email address using the token sent by email.

**Auth Required:** No
**Rate Limiter:** authLimiter
**CSRF Required:** No
**Validation:** Zod `schemas.auth.verifyEmailQuery` (query params)

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| token | string | Yes | Verification token from email |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "message": "Email verified successfully. You can now log in."
  }
}
```

---

### POST /auth/resend-verification

Request a new verification email. Always returns success to prevent user enumeration.

**Auth Required:** No
**Rate Limiter:** authLimiter
**CSRF Required:** No (public auth route)
**Validation:** Zod `schemas.auth.resendVerification`

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "message": "If the email exists and is unverified, a new verification email has been sent."
  }
}
```

---

### POST /auth/forgot-password

Request a password reset email. Always returns success to prevent user enumeration.

**Auth Required:** No
**Rate Limiter:** authLimiter + strictAuthLimiter
**CSRF Required:** No (public auth route)
**Validation:** Zod `schemas.auth.forgotPassword`

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "message": "If an account exists with this email, a password reset link has been sent."
  }
}
```

---

### POST /auth/reset-password

Reset password using the token from the reset email.

**Auth Required:** No
**Rate Limiter:** authLimiter
**CSRF Required:** No (public auth route)
**Validation:** Zod `schemas.auth.resetPassword`

**Request:**
```json
{
  "token": "reset_token_from_email",
  "newPassword": "NewSecurePass456!"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| token | string | Yes | Reset token |
| newPassword | string | Yes | 8-128 chars, strong password requirements |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "message": "Password has been reset successfully. You can now log in with your new password."
  }
}
```

---

### POST /auth/logout

Logout the current session. Revokes the refresh token and clears cookies.

**Auth Required:** Yes
**Rate Limiter:** authLimiter
**CSRF Required:** Yes

**Request:** No body required.

**Response:** `200 OK`
```json
{
  "success": true
}
```

**Cookies Cleared:** `access_token`, `refresh_token`

---

### POST /auth/logout-all

Logout from all devices. Revokes all refresh tokens for the user.

**Auth Required:** Yes
**Rate Limiter:** authLimiter
**CSRF Required:** Yes

**Request:** No body required.

**Response:** `200 OK`
```json
{
  "success": true
}
```

---

### GET /auth/me

Get the currently authenticated user's information.

**Auth Required:** Yes
**Rate Limiter:** authLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "PATIENT"
  }
}
```

---

### POST /auth/change-password

Change the current user's password. Revokes all existing tokens and issues new ones.

**Auth Required:** Yes
**Rate Limiter:** authLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.auth.changePassword`

**Request:**
```json
{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass456!"
}
```

**Response:** `200 OK`
```json
{
  "success": true
}
```

**Cookies Set:** New `access_token` and `refresh_token` (all other sessions invalidated)

---

## Biomarker Endpoints

All biomarker routes require authentication. Data is scoped to the authenticated user.

### GET /biomarkers

List all biomarkers with pagination and optional category filter.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.biomarker.listQuery` (query params)

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| category | string | No | -- | Filter by biomarker category |
| page | string | No | "1" | Page number (min 1) |
| limit | string | No | "20" | Items per page (1-100) |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "category": "Lipids",
      "name": "Total Cholesterol",
      "unit": "mg/dL",
      "value": 195,
      "notes": "Fasting sample",
      "normalRange": { "min": 125, "max": 200, "source": "Lab Report" },
      "date": "2026-01-15",
      "sourceType": "LAB_UPLOAD",
      "sourceFile": "labcorp_jan2026.pdf",
      "extractionConfidence": 0.95,
      "labName": "LabCorp",
      "isOutOfRange": false,
      "isAcknowledged": false,
      "history": [
        { "date": "2025-10-01", "value": 210 }
      ],
      "createdAt": "2026-01-16T00:00:00.000Z",
      "updatedAt": "2026-01-16T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

### GET /biomarkers/summary

Get biomarker summary statistics (counts by category, in/out of range).

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "totalBiomarkers": 45,
    "inRangeCount": 38,
    "outOfRangeCount": 7,
    "acknowledgedCount": 3,
    "byCategory": [
      { "category": "Lipids", "total": 12, "inRange": 10, "outOfRange": 2 },
      { "category": "Blood", "total": 8, "inRange": 7, "outOfRange": 1 }
    ],
    "recentlyUpdated": 15,
    "lastUpdatedAt": "2026-02-05T12:00:00.000Z"
  }
}
```

---

### GET /biomarkers/categories

Get distinct biomarker categories for the user.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": ["Lipids", "Blood", "Metabolic", "Thyroid", "Bone Health"]
}
```

---

### GET /biomarkers/:id

Get a single biomarker by ID.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "category": "Lipids",
    "name": "Total Cholesterol",
    "unit": "mg/dL",
    "value": 195,
    "normalRange": { "min": 125, "max": 200 },
    "date": "2026-01-15",
    "sourceType": "MANUAL",
    "isOutOfRange": false,
    "isAcknowledged": false,
    "history": [],
    "createdAt": "2026-01-16T00:00:00.000Z",
    "updatedAt": "2026-01-16T00:00:00.000Z"
  }
}
```

---

### GET /biomarkers/:id/history

Get historical values for a specific biomarker.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.uuidParam` (params)

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| startDate | string | No | 90 days ago | ISO date string |
| endDate | string | No | today | ISO date string |
| limit | string | No | "100" | Max entries (1-1000) |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "biomarkerId": "uuid",
    "name": "Total Cholesterol",
    "category": "Lipids",
    "unit": "mg/dL",
    "normalRange": { "min": 125, "max": 200 },
    "currentValue": 195,
    "history": [
      { "date": "2025-07-01", "value": 220, "isOutOfRange": true },
      { "date": "2025-10-01", "value": 210, "isOutOfRange": true },
      { "date": "2026-01-15", "value": 195, "isOutOfRange": false }
    ]
  }
}
```

---

### POST /biomarkers

Create a new biomarker entry.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.biomarker.create`

**Request:**
```json
{
  "name": "Total Cholesterol",
  "value": 195,
  "unit": "mg/dL",
  "category": "Lipids",
  "date": "2026-01-15",
  "normalRange": { "min": 125, "max": 200, "source": "Lab Reference" },
  "notes": "Fasting sample",
  "sourceType": "MANUAL",
  "labName": "LabCorp"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| name | string | Yes | 1-100 chars |
| value | number | Yes | >= 0 |
| unit | string | Yes | 1-20 chars |
| category | string | Yes | 1-50 chars |
| date | string | Yes | Valid date |
| normalRange.min | number | Yes | -- |
| normalRange.max | number | Yes | -- |
| normalRange.source | string | No | Max 100 chars |
| notes | string | No | Max 1000 chars |
| sourceType | enum | No | MANUAL, LAB_UPLOAD, EHR_IMPORT, DEVICE_SYNC, API_IMPORT |
| sourceFile | string | No | Max 255 chars |
| extractionConfidence | number | No | 0-1 |
| labName | string | No | Max 200 chars |

**Response:** `201 Created`
```json
{
  "success": true,
  "data": { "...biomarker object..." }
}
```

---

### POST /biomarkers/batch

Batch create multiple biomarkers (for lab uploads).

**Auth Required:** Yes
**Rate Limiter:** bulkOperationLimiter (30 per hour)
**CSRF Required:** Yes
**Validation:** Zod `schemas.biomarker.batchCreate`

**Request:**
```json
{
  "biomarkers": [
    {
      "name": "Total Cholesterol",
      "value": 195,
      "unit": "mg/dL",
      "category": "Lipids",
      "date": "2026-01-15",
      "normalRange": { "min": 125, "max": 200 }
    }
  ]
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| biomarkers | array | Yes | 1-100 items |

**Response:** `201 Created` (all succeeded) or `207 Multi-Status` (partial)
```json
{
  "success": true,
  "data": [ "...biomarker objects..." ],
  "meta": {
    "total": 10,
    "succeeded": 9,
    "failed": 1,
    "failedItems": [
      { "index": 5, "name": "Bad Entry", "error": "Invalid value" }
    ]
  }
}
```

---

### PATCH /biomarkers/:id

Update an existing biomarker. If the value changes, the previous value is saved to history.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params), `schemas.biomarker.update` (body)

**Request:**
```json
{
  "value": 185,
  "notes": "Retested after diet change"
}
```

All fields are optional. Same types as create.

**Response:** `200 OK`
```json
{
  "success": true,
  "data": { "...updated biomarker object..." }
}
```

---

### DELETE /biomarkers/:id

Delete a biomarker and its history.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true
}
```

---

### POST /biomarkers/:id/guidance

Get AI-powered educational guidance for a specific biomarker. Uses Anthropic Claude API.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (Bearer token protected)
**Validation:** Zod `schemas.uuidParam` (params)

**Request:**
```json
{
  "biomarker": {
    "name": "Total Cholesterol",
    "value": 210,
    "unit": "mg/dL",
    "normalRange": { "min": 125, "max": 200 },
    "status": "HIGH",
    "history": [
      { "value": 220, "date": "2025-10-01" }
    ]
  }
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "guidance": "**What This Measures**: Total cholesterol...\n\n**Understanding Your Result**: ..."
  }
}
```

**Error Responses:**
- `503` -- AI guidance service not configured (`ANTHROPIC_API_KEY` not set)
- `502` -- Failed to get AI guidance (upstream API error)

---

## Insurance Endpoints

All insurance routes require authentication. Data is scoped to the authenticated user.

### GET /insurance/plans

List all insurance plans for the user with pagination.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| page | string | No | "1" | Page number |
| limit | string | No | "20" | Items per page (max 100) |
| activeOnly | string | No | "false" | Filter to active plans only |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "planName": "Blue Cross PPO Gold",
      "insurerName": "Blue Cross Blue Shield",
      "planType": "PPO",
      "memberId": "ABC123456",
      "groupNumber": "GRP789",
      "effectiveDate": "2026-01-01",
      "deductibleIndividual": 1500,
      "deductibleFamily": 3000,
      "oopMaxIndividual": 6000,
      "oopMaxFamily": 12000,
      "copayPrimaryCare": 25,
      "copaySpecialist": 50,
      "coinsuranceRate": 20,
      "extractedFromSbc": true,
      "sbcExtractionConfidence": 0.92,
      "isActive": true,
      "isPrimary": true,
      "benefits": [ "...benefit objects..." ],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-15T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 }
}
```

---

### GET /insurance/plans/:id

Get a single insurance plan by ID.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK` -- Full insurance plan object (same structure as list item)

---

### POST /insurance/plans

Create a new insurance plan manually.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.insurancePlan.create`

**Request:**
```json
{
  "planName": "Blue Cross PPO",
  "insurerName": "Blue Cross Blue Shield",
  "planType": "PPO",
  "effectiveDate": "2026-01-01",
  "deductible": 1500,
  "outOfPocketMax": 6000,
  "memberId": "ABC123456",
  "groupNumber": "GRP789",
  "premium": 450,
  "copayPrimaryCare": 25,
  "copaySpecialist": 50,
  "coinsuranceRate": 20,
  "isActive": true,
  "isPrimary": true,
  "benefits": [
    {
      "serviceName": "Primary Care Visit",
      "serviceCategory": "Office Visits",
      "inNetworkCoverage": { "covered": true, "copay": 25, "deductibleApplies": false },
      "outNetworkCoverage": { "covered": true, "coinsurance": 40, "deductibleApplies": true },
      "preAuthRequired": false
    }
  ]
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| planName | string | Yes | 1-200 chars |
| insurerName | string | Yes | 1-200 chars |
| planType | enum | Yes | HMO, PPO, EPO, POS, HDHP |
| effectiveDate | string | Yes | Valid date |
| deductible | number | Yes | >= 0 |
| outOfPocketMax | number | Yes | >= 0 |
| memberId | string | No | Max 100 chars (encrypted) |
| groupNumber | string | No | Max 100 chars (encrypted) |
| premium | number | No | >= 0 |
| deductibleFamily | number | No | >= 0 (defaults to 2x individual) |
| outOfPocketMaxFamily | number | No | >= 0 (defaults to 2x individual) |
| copayPrimaryCare | number | No | >= 0 |
| copaySpecialist | number | No | >= 0 |
| copayUrgentCare | number | No | >= 0 |
| copayEmergency | number | No | >= 0 |
| coinsuranceRate | number | No | 0-100 |
| isActive | boolean | No | Default true |
| isPrimary | boolean | No | Default false |
| benefits | array | No | Benefit objects |

**Response:** `201 Created`
```json
{
  "success": true,
  "data": { "...insurance plan object..." }
}
```

---

### PATCH /insurance/plans/:id

Update an existing insurance plan.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params), `schemas.insurancePlan.update` (body)

**Request:** Any subset of the create fields.

**Response:** `200 OK`

---

### DELETE /insurance/plans/:id

Delete an insurance plan and its benefits.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (DELETE with Bearer token exempted)
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true
}
```

---

### POST /insurance/compare

Compare multiple insurance plans side-by-side.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes

**Request:**
```json
{
  "planIds": ["uuid-1", "uuid-2", "uuid-3"]
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| planIds | string[] | Yes | 2-5 valid UUIDs |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "plans": [
      { "id": "uuid-1", "name": "Plan A", "type": "PPO", "premium": 450, "deductibleIndividual": 1500, "oopMaxIndividual": 6000 },
      { "id": "uuid-2", "name": "Plan B", "type": "HMO", "premium": 350, "deductibleIndividual": 2000, "oopMaxIndividual": 7000 }
    ],
    "benefitComparison": [
      {
        "serviceName": "Primary Care Visit",
        "coverage": [
          { "planId": "uuid-1", "planName": "Plan A", "covered": true, "copay": 25 },
          { "planId": "uuid-2", "planName": "Plan B", "covered": true, "copay": 15 }
        ]
      }
    ]
  }
}
```

---

### GET /insurance/benefits/search

Search for specific benefits across all user's plans.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| query | string | Yes | Search term (1-200 chars) |
| planId | string | No | Filter to specific plan (UUID) |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "planId": "uuid",
      "planName": "Blue Cross PPO",
      "benefit": {
        "id": "uuid",
        "serviceName": "Lab Work",
        "serviceCategory": "Diagnostics",
        "inNetworkCoverage": { "covered": true, "copay": 20, "deductibleApplies": true },
        "outNetworkCoverage": { "covered": true, "coinsurance": 40, "deductibleApplies": true },
        "preAuthRequired": false
      }
    }
  ]
}
```

---

### POST /insurance/upload-sbc

Upload and parse an SBC (Summary of Benefits and Coverage) PDF. Uses Claude AI for intelligent extraction with regex parser fallback.

**Auth Required:** Yes
**Rate Limiter:** uploadLimiter (20 per hour)
**CSRF Required:** No (file upload exempt)
**Content-Type:** `multipart/form-data`

**Request:** Form field `file` containing a PDF (max 10MB)

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "planName": "Blue Cross PPO Gold",
    "insurerName": "Blue Cross Blue Shield",
    "planType": "PPO",
    "effectiveDate": "2026-01-01T00:00:00.000Z",
    "isActive": true,
    "isPrimary": false,
    "deductibleIndividual": 1500,
    "deductibleFamily": 3000,
    "oopMaxIndividual": 6000,
    "oopMaxFamily": 12000,
    "copayPrimaryCare": 25,
    "copaySpecialist": 50,
    "coinsuranceRate": 20,
    "extractedFromSbc": true,
    "sbcExtractionConfidence": 0.92,
    "usedClaudeExtraction": true
  }
}
```

---

### PUT /insurance/plans/:id/reanalyze

Re-analyze an existing plan by uploading a new SBC PDF. Preserves user-entered data (memberId, tracking fields) while updating extracted coverage data.

**Auth Required:** Yes
**Rate Limiter:** uploadLimiter (20 per hour)
**CSRF Required:** No (file upload exempt)
**Validation:** Zod `schemas.uuidParam` (params)
**Content-Type:** `multipart/form-data`

**Request:** Form field `file` containing a PDF (max 10MB)

**Response:** `200 OK` -- Same shape as upload-sbc response

---

### PUT /insurance/plans/:id/spending

Update current deductible and out-of-pocket spending for a plan.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Request:**
```json
{
  "deductibleMet": 750,
  "oopMet": 1200
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| deductibleMet | number | Yes | Amount paid toward deductible |
| oopMet | number | Yes | Amount paid toward OOP max |

**Response:** `200 OK` -- Updated plan object

---

## Expense Endpoints

All expense routes require authentication and use CSRF protection on mutations.

### GET /expenses/projections

Get expense projections, optionally filtered by plan.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| planId | string | No | Filter by insurance plan UUID |

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "userId": "uuid",
    "planId": "uuid",
    "serviceType": "Primary Care Visit",
    "estimatedCost": 250,
    "frequencyPerYear": 4,
    "isInNetwork": true,
    "notes": "Quarterly checkups",
    "createdAt": "2026-01-10T00:00:00.000Z",
    "updatedAt": "2026-01-10T00:00:00.000Z"
  }
]
```

---

### POST /expenses/projections

Create a new expense projection.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes

**Request:**
```json
{
  "planId": "uuid",
  "serviceType": "Primary Care Visit",
  "estimatedCost": 250,
  "frequencyPerYear": 4,
  "isInNetwork": true,
  "notes": "Quarterly checkups"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| planId | string | Yes | Insurance plan UUID |
| serviceType | string | Yes | Type of medical service |
| estimatedCost | number | Yes | Estimated cost per visit |
| frequencyPerYear | number | Yes | Expected visits per year |
| isInNetwork | boolean | No | Default true |
| notes | string | No | Additional notes |

**Response:** `201 Created` -- Decrypted projection object

---

### PUT /expenses/projections/:id

Update an expense projection.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes

**Request:** Any subset of create fields (except planId).

**Response:** `200 OK` -- Updated decrypted projection object

---

### DELETE /expenses/projections/:id

Delete an expense projection.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes

**Response:** `204 No Content`

---

### POST /expenses/analyze

Generate AI-powered cost optimization analysis using Claude Sonnet.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes

**Request:**
```json
{
  "planId": "uuid"
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "analysisDate": "2026-02-06T12:00:00.000Z",
  "claudeResponse": "### 1. Out-of-Pocket Cost Projection\n...",
  "totalProjectedOop": 3250,
  "deductibleMetMonth": 4
}
```

---

### GET /expenses/analyses

Get cost analysis history, optionally filtered by plan.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| planId | string | No | Filter by insurance plan UUID |

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "planId": "uuid",
    "analysisDate": "2026-02-06T12:00:00.000Z",
    "claudeResponse": "### 1. Out-of-Pocket Cost Projection...",
    "totalProjectedOop": 3250,
    "deductibleMetMonth": 4
  }
]
```

Limited to last 10 analyses.

---

## Health Goal Endpoints

All health goal routes require authentication.

### GET /health-goals

List all health goals with optional status and category filters.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.healthGoal.listQuery` (query params)

**Query Parameters:**

| Param | Type | Required | Values |
|-------|------|----------|--------|
| status | enum | No | NOT_STARTED, IN_PROGRESS, COMPLETED, PAUSED, ABANDONED |
| category | enum | No | WEIGHT, FITNESS, NUTRITION, BIOMARKER, MEDICATION, LIFESTYLE, MENTAL_HEALTH, OTHER |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "name": "Lower Cholesterol",
      "description": "Bring total cholesterol below 200",
      "category": "BIOMARKER",
      "targetValue": 200,
      "currentValue": 210,
      "startValue": 240,
      "unit": "mg/dL",
      "direction": "DECREASE",
      "relatedBiomarkerId": "uuid",
      "startDate": "2026-01-01",
      "targetDate": "2026-06-01",
      "status": "ACTIVE",
      "progress": 75,
      "milestones": [
        { "value": 220, "label": "First milestone", "achieved": true, "achievedAt": "2026-01-20" }
      ],
      "reminderFrequency": "WEEKLY",
      "progressHistory": [
        { "id": "uuid", "value": 210, "progress": 75, "note": "After diet change", "recordedAt": "2026-02-01" }
      ],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-02-01T00:00:00.000Z",
      "completedAt": null
    }
  ]
}
```

---

### GET /health-goals/summary

Get goals summary statistics.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "byStatus": { "ACTIVE": 3, "ACHIEVED": 2, "PAUSED": 1 },
    "byCategory": { "BIOMARKER": 2, "FITNESS": 2, "WEIGHT": 2 },
    "total": 6,
    "active": 3,
    "achieved": 2,
    "needAttention": 1,
    "recentlyAchieved": 0
  }
}
```

---

### GET /health-goals/suggestions

Get AI-suggested goals based on out-of-range biomarkers.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "name": "Optimize Total Cholesterol",
      "category": "Lipids",
      "targetValue": 162.5,
      "unit": "mg/dL",
      "direction": "MAINTAIN",
      "relatedBiomarkerId": "uuid",
      "description": "Bring Total Cholesterol into the normal range (125-200 mg/dL)"
    }
  ]
}
```

---

### GET /health-goals/:id

Get a specific health goal with full progress history.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK` -- Full goal object with progressHistory

---

### POST /health-goals

Create a new health goal.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.healthGoal.create`

**Request:**
```json
{
  "name": "Lower Cholesterol",
  "description": "Bring total cholesterol below 200",
  "category": "BIOMARKER",
  "targetValue": 200,
  "currentValue": 240,
  "unit": "mg/dL",
  "direction": "DECREASE",
  "relatedBiomarkerId": "uuid",
  "startDate": "2026-01-01",
  "targetDate": "2026-06-01",
  "milestones": [
    { "value": 220, "label": "First milestone" }
  ],
  "reminderFrequency": "WEEKLY"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| name | string | Yes | 1-200 chars |
| description | string | No | Max 1000 chars |
| category | enum | Yes | WEIGHT, FITNESS, NUTRITION, BIOMARKER, MEDICATION, LIFESTYLE, MENTAL_HEALTH, OTHER |
| targetValue | number | Yes | -- |
| currentValue | number | No | -- |
| unit | string | Yes | 1-50 chars |
| direction | enum | Yes | INCREASE, DECREASE, MAINTAIN |
| relatedBiomarkerId | string | No | Valid UUID |
| startDate | string | Yes | Valid date |
| targetDate | string | Yes | Valid date |
| milestones | array | No | Objects with value (number) and label (string) |
| reminderFrequency | enum | No | DAILY, WEEKLY, BIWEEKLY, MONTHLY |

**Response:** `201 Created`

---

### PUT /health-goals/:id

Update a health goal.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params), `schemas.healthGoal.update` (body)

**Request:** Any subset of: name, description, targetValue, targetDate, milestones, reminderFrequency, status.

**Response:** `200 OK`

---

### PATCH /health-goals/:id/progress

Log progress on a health goal. Automatically calculates progress percentage and checks milestone achievement.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params), `schemas.healthGoal.updateProgress` (body)

**Request:**
```json
{
  "value": 210,
  "note": "After 2 weeks of diet change"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| value | number | Yes | Current measurement |
| note | string | No | Max 500 chars |

**Response:** `200 OK` -- Updated goal with progressHistory

---

### DELETE /health-goals/:id

Delete a health goal and its progress history.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true
}
```

---

## Health Need Endpoints

All health need routes require authentication.

### GET /health-needs

List all health needs with optional status and urgency filters. Sorted by urgency (IMMEDIATE first).

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.healthNeed.listQuery` (query params)

**Query Parameters:**

| Param | Type | Required | Values |
|-------|------|----------|--------|
| status | enum | No | PENDING, IN_PROGRESS, COMPLETED, DISMISSED |
| urgency | enum | No | IMMEDIATE, URGENT, FOLLOW_UP, ROUTINE |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "needType": "CONDITION",
      "name": "High Cholesterol",
      "description": "Total cholesterol is above normal range",
      "urgency": "FOLLOW_UP",
      "status": "PENDING",
      "relatedBiomarkerIds": ["uuid-1", "uuid-2"],
      "createdAt": "2026-01-16T00:00:00.000Z",
      "updatedAt": "2026-01-16T00:00:00.000Z"
    }
  ]
}
```

---

### GET /health-needs/analyze

AI-powered analysis that generates health need recommendations based on out-of-range biomarkers.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "detectedConditions": [ "...existing condition health needs..." ],
    "recommendations": [
      "Schedule appointment with healthcare provider to discuss out-of-range biomarkers",
      "Consider heart-healthy dietary modifications",
      "Schedule annual physical examination"
    ],
    "outOfRangeBiomarkers": [
      { "id": "uuid", "name": "Total Cholesterol", "category": "Lipids" }
    ]
  }
}
```

---

### GET /health-needs/:id

Get a specific health need.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK` -- Health need object

---

### POST /health-needs

Create a new health need.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.healthNeed.create`

**Request:**
```json
{
  "needType": "CONDITION",
  "name": "High Cholesterol",
  "description": "Total cholesterol is above normal range at 240 mg/dL",
  "urgency": "FOLLOW_UP",
  "relatedBiomarkerIds": ["uuid"]
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| needType | enum | Yes | CONDITION, ACTION, SERVICE, MEDICATION, LIFESTYLE |
| name | string | Yes | 1-200 chars |
| description | string | Yes | 1-2000 chars (encrypted at rest) |
| urgency | enum | Yes | IMMEDIATE, URGENT, FOLLOW_UP, ROUTINE |
| relatedBiomarkerIds | string[] | No | Array of UUIDs |

**Response:** `201 Created`

---

### PATCH /health-needs/:id

Update a health need (name, description, urgency, status, relatedBiomarkerIds).

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params), `schemas.healthNeed.update` (body)

**Request:** Any subset of update fields. Setting `status` to `COMPLETED` automatically sets `resolvedAt`.

**Response:** `200 OK`

---

### DELETE /health-needs/:id

Delete a health need.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true
}
```

---

## Upload Endpoints

All upload routes require authentication and use the **uploadLimiter** (20 uploads per hour).

### POST /upload/lab-report

Upload and parse a lab report PDF. Extracts biomarkers using Claude AI / Document AI OCR.

**Auth Required:** Yes
**Rate Limiter:** uploadLimiter (20 per hour)
**CSRF Required:** No (file upload exempt)
**Content-Type:** `multipart/form-data`

**Request:** Form field `file` containing a PDF (max 10MB)

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "biomarkersCreated": 12,
    "biomarkers": [
      { "id": "uuid", "name": "Total Cholesterol", "value": 195, "unit": "mg/dL", "category": "Lipids", "isOutOfRange": false }
    ],
    "labName": "LabCorp",
    "reportDate": "2026-01-15T00:00:00.000Z",
    "extractionConfidence": 0.93
  }
}
```

---

### POST /upload/insurance-sbc

Upload and parse an insurance SBC PDF. Same as `POST /insurance/upload-sbc`.

**Auth Required:** Yes
**Rate Limiter:** uploadLimiter (20 per hour)
**CSRF Required:** No (file upload exempt)
**Content-Type:** `multipart/form-data`

**Request:** Form field `file` containing a PDF (max 10MB)

**Response:** `201 Created` -- Same as `/insurance/upload-sbc`

---

### POST /upload/lab-results-ocr

Upload and process a lab result using OCR (Google Document AI). Supports PDF and image files. Files are stored in Google Cloud Storage.

**Auth Required:** Yes
**Rate Limiter:** uploadLimiter (20 per hour)
**CSRF Required:** No (file upload exempt)
**Content-Type:** `multipart/form-data`

**Request:** Form field `file` containing PDF or image (PNG, JPG, TIFF, GIF, WebP; max 10MB)

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "biomarkersCreated": 5,
    "biomarkers": [
      { "id": "uuid", "name": "Calcium", "value": 9.5, "unit": "mg/dL", "category": "Bone Health", "isOutOfRange": false }
    ],
    "labName": "Quest Diagnostics",
    "reportDate": "2026-01-20T00:00:00.000Z",
    "extractionConfidence": 0.89,
    "ocrMetadata": {
      "processingTimeMs": 2500,
      "pageCount": 2,
      "documentType": "application/pdf"
    },
    "file": {
      "id": "uuid",
      "filename": "Quest Diagnostics - 1/20/2026",
      "storageKey": "users/uuid/files/uuid"
    }
  }
}
```

---

## File Endpoints

All file routes require authentication. Manages user-uploaded files stored in Google Cloud Storage.

### GET /files

List all files for the authenticated user.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "filename": "Quest Diagnostics - 1/20/2026",
      "originalFilename": "lab_results_jan2026.pdf",
      "fileType": "application/pdf",
      "fileSize": 524288,
      "storageKey": "users/uuid/files/uuid",
      "labName": "Quest Diagnostics",
      "labDate": "2026-01-20",
      "biomarkersExtracted": 5,
      "extractionConfidence": 0.89,
      "categories": ["Bone Health", "Blood"],
      "createdAt": "2026-01-21T00:00:00.000Z"
    }
  ]
}
```

---

### GET /files/:id

Get a single file with a signed download URL.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "filename": "Quest Diagnostics - 1/20/2026",
    "originalFilename": "lab_results_jan2026.pdf",
    "fileType": "application/pdf",
    "fileSize": 524288,
    "storageKey": "users/uuid/files/uuid",
    "labName": "Quest Diagnostics",
    "labDate": "2026-01-20",
    "biomarkersExtracted": 5,
    "extractionConfidence": 0.89,
    "categories": ["Bone Health"],
    "createdAt": "2026-01-21T00:00:00.000Z",
    "downloadUrl": "https://storage.googleapis.com/...signed-url..."
  }
}
```

---

### GET /files/:id/download

Get a short-lived (15-minute) signed download URL for a file.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "url": "https://storage.googleapis.com/...signed-url...",
    "expiresIn": 900
  }
}
```

---

### DELETE /files/:id

Delete a file. Removes from GCS, unlinks associated biomarkers, and deletes the database record.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true
}
```

---

## Provider Endpoints

All provider routes require authentication and **PROVIDER** or **ADMIN** role.

### GET /provider/patients

Get all patients the provider has relationships with.

**Auth Required:** Yes
**Role Required:** PROVIDER or ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "relationshipId": "uuid",
      "patientId": "uuid",
      "patient": {
        "id": "uuid",
        "email": "patient@example.com",
        "createdAt": "2025-06-01T00:00:00.000Z"
      },
      "permissions": {
        "canViewBiomarkers": true,
        "canViewInsurance": false,
        "canViewDna": false,
        "canViewHealthNeeds": true,
        "canEditData": false
      },
      "relationshipType": "PRIMARY_CARE",
      "status": "ACTIVE",
      "consentGrantedAt": "2026-01-01T00:00:00.000Z",
      "consentExpiresAt": "2026-07-01T00:00:00.000Z",
      "createdAt": "2025-12-15T00:00:00.000Z"
    }
  ]
}
```

---

### POST /provider/patients/request

Request access to a patient by email.

**Auth Required:** Yes
**Role Required:** PROVIDER or ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.providerPatient.request`

**Request:**
```json
{
  "patientEmail": "patient@example.com",
  "relationshipType": "PRIMARY_CARE",
  "message": "I'd like to access your health records for your annual checkup."
}
```

| Field | Type | Required | Values |
|-------|------|----------|--------|
| patientEmail | string | Yes | Valid email |
| relationshipType | enum | No | PRIMARY_CARE, SPECIALIST, CONSULTANT, EMERGENCY, OTHER |
| message | string | No | Max 500 chars (encrypted) |

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "relationshipId": "uuid",
    "status": "PENDING"
  }
}
```

---

### GET /provider/patients/:patientId

Get details for a specific patient (if authorized with ACTIVE relationship).

**Auth Required:** Yes
**Role Required:** PROVIDER or ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.patientIdParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "patient": {
      "id": "uuid",
      "email": "patient@example.com",
      "createdAt": "2025-06-01T00:00:00.000Z",
      "lastLoginAt": "2026-02-05T00:00:00.000Z"
    },
    "relationship": {
      "id": "uuid",
      "relationshipType": "PRIMARY_CARE",
      "permissions": {
        "canViewBiomarkers": true,
        "canViewInsurance": false,
        "canViewDna": false,
        "canViewHealthNeeds": true,
        "canEditData": false
      },
      "consentGrantedAt": "2026-01-01T00:00:00.000Z",
      "consentExpiresAt": "2026-07-01T00:00:00.000Z"
    }
  }
}
```

---

### GET /provider/patients/:patientId/biomarkers

Get a patient's biomarkers (requires `canViewBiomarkers` permission).

**Auth Required:** Yes
**Role Required:** PROVIDER or ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.patientIdParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [ "...biomarker objects (raw Prisma format)..." ]
}
```

---

### GET /provider/patients/:patientId/health-needs

Get a patient's health needs (requires `canViewHealthNeeds` permission).

**Auth Required:** Yes
**Role Required:** PROVIDER or ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.patientIdParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [ "...health need objects (raw Prisma format)..." ]
}
```

---

### DELETE /provider/patients/:patientId

Remove the relationship with a patient (provider-initiated).

**Auth Required:** Yes
**Role Required:** PROVIDER or ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.patientIdParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": { "message": "Patient relationship removed" }
}
```

---

## Patient Consent Endpoints

All patient routes require authentication and **PATIENT** role.

### GET /patient/providers

Get all providers with access to the patient's data.

**Auth Required:** Yes
**Role Required:** PATIENT
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "relationshipId": "uuid",
      "providerId": "uuid",
      "provider": { "id": "uuid", "email": "doctor@clinic.com" },
      "permissions": {
        "canViewBiomarkers": true,
        "canViewInsurance": false,
        "canViewDna": false,
        "canViewHealthNeeds": true,
        "canEditData": false
      },
      "relationshipType": "PRIMARY_CARE",
      "status": "ACTIVE",
      "consentGrantedAt": "2026-01-01T00:00:00.000Z",
      "consentExpiresAt": "2026-07-01T00:00:00.000Z",
      "createdAt": "2025-12-15T00:00:00.000Z"
    }
  ]
}
```

---

### GET /patient/providers/pending

Get pending access requests from providers.

**Auth Required:** Yes
**Role Required:** PATIENT
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "requestId": "uuid",
      "providerId": "uuid",
      "provider": { "id": "uuid", "email": "doctor@clinic.com" },
      "relationshipType": "SPECIALIST",
      "requestedAt": "2026-02-01T00:00:00.000Z"
    }
  ]
}
```

---

### POST /patient/providers/:id/approve

Approve a provider's access request with granular permissions.

**Auth Required:** Yes
**Role Required:** PATIENT
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params), `schemas.providerPatient.approve` (body)

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

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| canViewBiomarkers | boolean | No | true | Allow viewing biomarkers |
| canViewInsurance | boolean | No | false | Allow viewing insurance |
| canViewDna | boolean | No | false | Allow viewing DNA data |
| canViewHealthNeeds | boolean | No | true | Allow viewing health needs |
| canEditData | boolean | No | false | Allow editing data |
| consentDurationDays | number | No | null (indefinite) | 1-365 days |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "message": "Provider access approved",
    "relationship": { "...updated relationship object..." }
  }
}
```

---

### POST /patient/providers/:id/deny

Deny a provider's access request (deletes the relationship).

**Auth Required:** Yes
**Role Required:** PATIENT
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": { "message": "Provider access denied" }
}
```

---

### PATCH /patient/providers/:id

Update permissions for an active provider relationship.

**Auth Required:** Yes
**Role Required:** PATIENT
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params), `schemas.providerPatient.updatePermissions` (body)

**Request:**
```json
{
  "canViewBiomarkers": true,
  "canViewInsurance": true,
  "canViewDna": false,
  "canViewHealthNeeds": true,
  "canEditData": false
}
```

All fields are optional booleans.

**Response:** `200 OK` -- Updated relationship object

---

### POST /patient/providers/:id/revoke

Revoke an active provider's access (sets status to REVOKED).

**Auth Required:** Yes
**Role Required:** PATIENT
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": { "message": "Provider access revoked" }
}
```

---

### DELETE /patient/providers/:id

Permanently remove a provider relationship (any status).

**Auth Required:** Yes
**Role Required:** PATIENT
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": { "message": "Provider relationship removed" }
}
```

---

## Settings Endpoints

All settings routes require authentication.

### GET /settings/export-data

Export all user data as JSON. Includes decrypted biomarkers, insurance plans, and summary statistics.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "exportDate": "2026-02-06T12:00:00.000Z",
    "user": {
      "email": "user@example.com",
      "createdAt": "2025-06-01T00:00:00.000Z"
    },
    "biomarkers": [
      {
        "name": "Total Cholesterol",
        "standardName": "total_cholesterol",
        "category": "Lipids",
        "value": 195,
        "unit": "mg/dL",
        "date": "2026-01-15",
        "isAbnormal": false,
        "referenceRange": { "min": 125, "max": 200 },
        "source": "LabCorp"
      }
    ],
    "insurancePlans": [
      {
        "planName": "Blue Cross PPO",
        "insurerName": "Blue Cross Blue Shield",
        "planType": "PPO",
        "effectiveDate": "2026-01-01",
        "isActive": true,
        "isPrimary": true,
        "deductibleIndividual": 1500,
        "deductibleFamily": 3000,
        "oopMaxIndividual": 6000,
        "oopMaxFamily": 12000
      }
    ],
    "summary": {
      "totalBiomarkers": 45,
      "byCategory": { "Lipids": 12, "Blood": 8 },
      "abnormalCount": 7,
      "normalCount": 38
    }
  }
}
```

---

### DELETE /settings/delete-data

Delete all health data (biomarkers, insurance plans, health needs, health goals). Account remains active.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (settings route exempt)

**Request:** No body required.

**Response:** `200 OK`
```json
{
  "success": true
}
```

---

### DELETE /settings/delete-account

Permanently delete the user account and all associated data. Requires password confirmation.

**Auth Required:** Yes
**Rate Limiter:** standardLimiter
**CSRF Required:** No (settings route exempt)

**Request:**
```json
{
  "password": "CurrentPassword123!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| password | string | Yes | Current account password |

**Response:** `200 OK`
```json
{
  "success": true
}
```

---

## Admin Endpoints

All admin routes require authentication and **ADMIN** role.

### GET /admin/users

List all users with pagination and filtering.

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.admin.listUsersQuery` (query params)

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| page | string | No | Page number (default 1) |
| limit | string | No | Items per page (1-100, default 20) |
| role | enum | No | PATIENT, PROVIDER, ADMIN |
| isActive | string | No | "true" or "false" |
| search | string | No | Email search (max 100 chars) |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "role": "PATIENT",
        "isActive": true,
        "emailVerified": true,
        "createdAt": "2025-06-01T00:00:00.000Z",
        "lastLoginAt": "2026-02-05T00:00:00.000Z",
        "_count": { "biomarkers": 45, "insurancePlans": 2, "healthNeeds": 5 }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
  }
}
```

---

### GET /admin/users/:id

Get detailed user information.

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "PATIENT",
    "isActive": true,
    "emailVerified": true,
    "createdAt": "2025-06-01T00:00:00.000Z",
    "updatedAt": "2026-02-05T00:00:00.000Z",
    "lastLoginAt": "2026-02-05T00:00:00.000Z",
    "_count": {
      "biomarkers": 45,
      "insurancePlans": 2,
      "healthNeeds": 5,
      "dnaData": 0,
      "sessions": 3,
      "auditLogs": 250
    }
  }
}
```

---

### POST /admin/users

Create a new user (admin can create any role).

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.admin.createUser`

**Request:**
```json
{
  "email": "newuser@example.com",
  "password": "SecurePass123!",
  "role": "PROVIDER",
  "isActive": true,
  "emailVerified": true
}
```

| Field | Type | Required | Default |
|-------|------|----------|---------|
| email | string | Yes | -- |
| password | string | Yes | Strong password requirements |
| role | enum | No | PATIENT |
| isActive | boolean | No | true |
| emailVerified | boolean | No | false |

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "newuser@example.com",
    "role": "PROVIDER",
    "isActive": true,
    "emailVerified": true,
    "createdAt": "2026-02-06T00:00:00.000Z"
  }
}
```

---

### PATCH /admin/users/:id

Update user information (role, isActive, emailVerified, password). Admin cannot modify their own role.

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params), `schemas.admin.updateUser` (body)

**Request:**
```json
{
  "role": "PROVIDER",
  "isActive": true,
  "emailVerified": true
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| role | enum | No | PATIENT, PROVIDER, ADMIN |
| isActive | boolean | No | -- |
| emailVerified | boolean | No | -- |
| password | string | No | Strong password requirements |

**Response:** `200 OK`

---

### DELETE /admin/users/:id

Deactivate a user (soft delete). Invalidates all sessions. Admin cannot deactivate themselves.

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": { "message": "User deactivated successfully" }
}
```

---

### DELETE /admin/users/:id/permanent

Permanently delete a user and all their data. Requires email confirmation.

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** sensitiveLimiter (10 per hour)
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Request:**
```json
{
  "confirmEmail": "user@example.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| confirmEmail | string | Yes | Must match the target user's email |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": { "message": "User permanently deleted" }
}
```

---

### GET /admin/provider-relationships

List all provider-patient relationships.

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | Filter by status (ACTIVE, PENDING, REVOKED) |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [ "...provider-patient relationship objects..." ]
}
```

Limited to 100 results.

---

### PATCH /admin/provider-relationships/:id

Update a provider-patient relationship (status, permissions).

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** Yes
**Validation:** Zod `schemas.uuidParam` (params)

**Request:**
```json
{
  "status": "ACTIVE",
  "canViewBiomarkers": true,
  "canViewInsurance": false,
  "canViewDna": false,
  "canViewHealthNeeds": true,
  "canEditData": false
}
```

All fields are optional.

**Response:** `200 OK` -- Updated relationship object

---

### GET /admin/stats

Get system-wide statistics.

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "users": {
      "total": 150,
      "active": 142,
      "byRole": { "PATIENT": 130, "PROVIDER": 15, "ADMIN": 5 },
      "recentLogins": 85
    },
    "data": {
      "biomarkers": 5400,
      "insurancePlans": 210,
      "healthNeeds": 380
    }
  }
}
```

---

### GET /admin/audit-logs

Get audit logs with filtering and pagination.

**Auth Required:** Yes
**Role Required:** ADMIN
**Rate Limiter:** standardLimiter
**CSRF Required:** No (GET request)
**Validation:** Zod `schemas.admin.auditLogQuery` (query params)

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| page | string | No | Page number (default 1) |
| limit | string | No | Items per page (1-200, default 50) |
| userId | string | No | Filter by user UUID |
| action | string | No | Filter by action type |
| resourceType | string | No | Filter by resource type |
| startDate | string | No | ISO date string |
| endDate | string | No | ISO date string |

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "uuid",
        "userId": "uuid",
        "action": "READ",
        "resourceType": "Biomarker",
        "resourceId": "uuid",
        "metadata": { "operation": "LIST", "count": 45 },
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0...",
        "createdAt": "2026-02-06T12:00:00.000Z",
        "user": { "id": "uuid", "email": "user@example.com", "role": "PATIENT" }
      }
    ],
    "pagination": { "page": 1, "limit": 50, "total": 5000, "totalPages": 100 }
  }
}
```

---

## Rate Limits

| Limiter | Window | Max Requests | Applied To |
|---------|--------|-------------|-----------|
| **standardLimiter** | 15 min | 100 | All endpoints (global) |
| **authLimiter** | 15 min | 20 | All auth routes (`/auth/*`) |
| **strictAuthLimiter** | 15 min | 5 | Login (`/auth/login`), Forgot password (`/auth/forgot-password`). Keyed by email+IP. Skips successful requests. |
| **uploadLimiter** | 1 hour | 20 | All upload routes (`/upload/*`), SBC upload (`/insurance/upload-sbc`), Plan reanalyze (`/insurance/plans/:id/reanalyze`) |
| **sensitiveLimiter** | 1 hour | 10 | Permanent user deletion (`/admin/users/:id/permanent`) |
| **bulkOperationLimiter** | 1 hour | 30 | Batch biomarker creation (`/biomarkers/batch`) |

Rate limit responses include standard headers:
- `RateLimit-Limit` -- Maximum requests per window
- `RateLimit-Remaining` -- Remaining requests in current window
- `RateLimit-Reset` -- Time when the window resets (UTC epoch seconds)

When exceeded, returns `429 Too Many Requests`:
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later."
  }
}
```

---

## Endpoint Summary

| # | Method | Path | Auth | Role | Rate Limiter | CSRF |
|---|--------|------|------|------|-------------|------|
| 1 | GET | `/health` | No | -- | standard | No |
| 2 | GET | `/` | No | -- | standard | No |
| **Auth** | | | | | | |
| 3 | POST | `/auth/register` | No | -- | auth | No |
| 4 | POST | `/auth/login` | No | -- | auth + strict | No |
| 5 | POST | `/auth/refresh` | No | -- | auth | No |
| 6 | POST | `/auth/demo` | No | -- | auth | No |
| 7 | GET | `/auth/verify-email` | No | -- | auth | No |
| 8 | POST | `/auth/resend-verification` | No | -- | auth | No |
| 9 | POST | `/auth/forgot-password` | No | -- | auth + strict | No |
| 10 | POST | `/auth/reset-password` | No | -- | auth | No |
| 11 | POST | `/auth/logout` | Yes | Any | auth | Yes |
| 12 | POST | `/auth/logout-all` | Yes | Any | auth | Yes |
| 13 | GET | `/auth/me` | Yes | Any | auth | No |
| 14 | POST | `/auth/change-password` | Yes | Any | auth | Yes |
| **Biomarkers** | | | | | | |
| 15 | GET | `/biomarkers` | Yes | Any | standard | No |
| 16 | GET | `/biomarkers/summary` | Yes | Any | standard | No |
| 17 | GET | `/biomarkers/categories` | Yes | Any | standard | No |
| 18 | GET | `/biomarkers/:id` | Yes | Any | standard | No |
| 19 | GET | `/biomarkers/:id/history` | Yes | Any | standard | No |
| 20 | POST | `/biomarkers` | Yes | Any | standard | Yes |
| 21 | POST | `/biomarkers/batch` | Yes | Any | bulk | Yes |
| 22 | PATCH | `/biomarkers/:id` | Yes | Any | standard | Yes |
| 23 | DELETE | `/biomarkers/:id` | Yes | Any | standard | Yes |
| 24 | POST | `/biomarkers/:id/guidance` | Yes | Any | standard | No |
| **Insurance** | | | | | | |
| 25 | GET | `/insurance/plans` | Yes | Any | standard | No |
| 26 | GET | `/insurance/plans/:id` | Yes | Any | standard | No |
| 27 | POST | `/insurance/plans` | Yes | Any | standard | Yes |
| 28 | PATCH | `/insurance/plans/:id` | Yes | Any | standard | Yes |
| 29 | DELETE | `/insurance/plans/:id` | Yes | Any | standard | No |
| 30 | POST | `/insurance/compare` | Yes | Any | standard | Yes |
| 31 | GET | `/insurance/benefits/search` | Yes | Any | standard | No |
| 32 | POST | `/insurance/upload-sbc` | Yes | Any | upload | No |
| 33 | PUT | `/insurance/plans/:id/reanalyze` | Yes | Any | upload | No |
| 34 | PUT | `/insurance/plans/:id/spending` | Yes | Any | standard | Yes |
| **Expenses** | | | | | | |
| 35 | GET | `/expenses/projections` | Yes | Any | standard | No |
| 36 | POST | `/expenses/projections` | Yes | Any | standard | Yes |
| 37 | PUT | `/expenses/projections/:id` | Yes | Any | standard | Yes |
| 38 | DELETE | `/expenses/projections/:id` | Yes | Any | standard | Yes |
| 39 | POST | `/expenses/analyze` | Yes | Any | standard | Yes |
| 40 | GET | `/expenses/analyses` | Yes | Any | standard | No |
| **Health Goals** | | | | | | |
| 41 | GET | `/health-goals` | Yes | Any | standard | No |
| 42 | GET | `/health-goals/summary` | Yes | Any | standard | No |
| 43 | GET | `/health-goals/suggestions` | Yes | Any | standard | No |
| 44 | GET | `/health-goals/:id` | Yes | Any | standard | No |
| 45 | POST | `/health-goals` | Yes | Any | standard | Yes |
| 46 | PUT | `/health-goals/:id` | Yes | Any | standard | Yes |
| 47 | PATCH | `/health-goals/:id/progress` | Yes | Any | standard | Yes |
| 48 | DELETE | `/health-goals/:id` | Yes | Any | standard | Yes |
| **Health Needs** | | | | | | |
| 49 | GET | `/health-needs` | Yes | Any | standard | No |
| 50 | GET | `/health-needs/analyze` | Yes | Any | standard | No |
| 51 | GET | `/health-needs/:id` | Yes | Any | standard | No |
| 52 | POST | `/health-needs` | Yes | Any | standard | Yes |
| 53 | PATCH | `/health-needs/:id` | Yes | Any | standard | Yes |
| 54 | DELETE | `/health-needs/:id` | Yes | Any | standard | Yes |
| **Uploads** | | | | | | |
| 55 | POST | `/upload/lab-report` | Yes | Any | upload | No |
| 56 | POST | `/upload/insurance-sbc` | Yes | Any | upload | No |
| 57 | POST | `/upload/lab-results-ocr` | Yes | Any | upload | No |
| **Files** | | | | | | |
| 58 | GET | `/files` | Yes | Any | standard | No |
| 59 | GET | `/files/:id` | Yes | Any | standard | No |
| 60 | GET | `/files/:id/download` | Yes | Any | standard | No |
| 61 | DELETE | `/files/:id` | Yes | Any | standard | Yes |
| **Provider** | | | | | | |
| 62 | GET | `/provider/patients` | Yes | PROVIDER/ADMIN | standard | No |
| 63 | POST | `/provider/patients/request` | Yes | PROVIDER/ADMIN | standard | Yes |
| 64 | GET | `/provider/patients/:patientId` | Yes | PROVIDER/ADMIN | standard | No |
| 65 | GET | `/provider/patients/:patientId/biomarkers` | Yes | PROVIDER/ADMIN | standard | No |
| 66 | GET | `/provider/patients/:patientId/health-needs` | Yes | PROVIDER/ADMIN | standard | No |
| 67 | DELETE | `/provider/patients/:patientId` | Yes | PROVIDER/ADMIN | standard | Yes |
| **Patient Consent** | | | | | | |
| 68 | GET | `/patient/providers` | Yes | PATIENT | standard | No |
| 69 | GET | `/patient/providers/pending` | Yes | PATIENT | standard | No |
| 70 | POST | `/patient/providers/:id/approve` | Yes | PATIENT | standard | Yes |
| 71 | POST | `/patient/providers/:id/deny` | Yes | PATIENT | standard | Yes |
| 72 | PATCH | `/patient/providers/:id` | Yes | PATIENT | standard | Yes |
| 73 | POST | `/patient/providers/:id/revoke` | Yes | PATIENT | standard | Yes |
| 74 | DELETE | `/patient/providers/:id` | Yes | PATIENT | standard | Yes |
| **Settings** | | | | | | |
| 75 | GET | `/settings/export-data` | Yes | Any | standard | No |
| 76 | DELETE | `/settings/delete-data` | Yes | Any | standard | No |
| 77 | DELETE | `/settings/delete-account` | Yes | Any | standard | No |
| **Admin** | | | | | | |
| 78 | GET | `/admin/users` | Yes | ADMIN | standard | No |
| 79 | GET | `/admin/users/:id` | Yes | ADMIN | standard | No |
| 80 | POST | `/admin/users` | Yes | ADMIN | standard | Yes |
| 81 | PATCH | `/admin/users/:id` | Yes | ADMIN | standard | Yes |
| 82 | DELETE | `/admin/users/:id` | Yes | ADMIN | standard | Yes |
| 83 | DELETE | `/admin/users/:id/permanent` | Yes | ADMIN | sensitive | Yes |
| 84 | GET | `/admin/provider-relationships` | Yes | ADMIN | standard | No |
| 85 | PATCH | `/admin/provider-relationships/:id` | Yes | ADMIN | standard | Yes |
| 86 | GET | `/admin/stats` | Yes | ADMIN | standard | No |
| 87 | GET | `/admin/audit-logs` | Yes | ADMIN | standard | No |

**Total: 87 endpoints**
