---
tags:
  - documentation
  - api
type: prompt
priority: 2
---

# Generate API_REFERENCE.md

## Purpose
Create or update complete API documentation from the codebase.

## From Codebase (Claude Code)

### Step 1: List All Route Files
```bash
ls backend/src/routes/*.ts
```
Expected 13 route files:
- `index.ts` (route mounting)
- `authRoutes.ts` (12 endpoints: register, login, logout, refresh, demo, me, change-password, verify-email, resend-verification, forgot-password, reset-password, logout-all)
- `biomarkerRoutes.ts` (10 endpoints: list, summary, categories, get, history, create, batch, update, delete, guidance)
- `insuranceRoutes.ts` (10 endpoints: plans CRUD, compare, search benefits, upload-sbc, reanalyze, spending)
- `expenseRoutes.ts` (10 endpoints: projections CRUD, actuals CRUD, analyses list/create)
- `healthGoalsRoutes.ts` (6 endpoints: list, create, update, delete, log progress, get progress)
- `healthNeedsRoutes.ts` (5 endpoints: list, create, update, delete, update status)
- `uploadRoutes.ts` (3 endpoints: lab-report, insurance-sbc, lab-results-ocr)
- `fileRoutes.ts` (3 endpoints: list, download, delete)
- `providerRoutes.ts` (6 endpoints: list patients, get patient, request access, get patient biomarkers, get patient health needs, remove patient)
- `patientRoutes.ts` (3 endpoints: list providers, update permissions, revoke access)
- `settingsRoutes.ts` (3 endpoints: export-data, delete-data, delete-account)
- `adminRoutes.ts` (4 endpoints: list users, audit logs, system health, delete user)

### Step 2: For Each Route File
1. Identify HTTP method and path
2. Check middleware stack (auth, CSRF, rate limiting, RBAC)
3. Find controller function
4. Document request/response shapes
5. Note rate limiter applied (standard, auth, strict, upload, sensitive, bulk)

### Step 3: Check Controllers
- `backend/src/controllers/*.ts` (9 controller files)
- Look for Zod validation schemas
- Look for response structure
- Note encrypted fields (decrypted in response, encrypted on write)

### Step 4: Check Middleware
- `backend/src/middleware/rbac.ts` — which routes require specific roles?
- `backend/src/middleware/rateLimiter.ts` — which limiters apply to which routes?
- `backend/src/middleware/demoProtection.ts` — which routes block demo users?

## Questions to Ask
1. What's the base URL for the API?
2. How does authentication work?
3. What's the standard error response format?
4. Are there any rate limits per endpoint?
5. Are there any deprecated endpoints?
6. Which endpoints require specific roles (PROVIDER, ADMIN)?
7. Which endpoints are blocked for demo accounts?

## Output Format

```markdown
# OwnMyHealth API Reference

**Base URL:** `https://api.ownmyhealth.io/api/v1`
**Last Updated:** [Date]

## Authentication
[How auth works - JWT, cookies, CSRF]

## Error Responses
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Description"
  }
}
```

---

## Health Check

### GET /health
Check API status.

**Auth Required:** No

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "...",
  "checks": { "database": "connected" }
}
```

---

## Auth Endpoints

### POST /auth/register
Create a new account.

**Auth Required:** No

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "data": { "user": { "id": "uuid", "email": "..." } }
}
```

[Continue for each endpoint...]

---

## Biomarker Endpoints
[All biomarker routes — including AI guidance]

## Insurance Endpoints
[All insurance routes — including SBC upload, compare, reanalyze]

## Expense Endpoints
[All expense routes — projections, actuals, AI cost analysis]

## Health Goal Endpoints
[All goal routes — CRUD + progress tracking]

## Health Need Endpoints
[All need routes — CRUD + status management]

## Upload Endpoints
[All upload routes — lab-report, insurance-sbc, lab-results-ocr]

## File Endpoints
[All file routes — list, download, delete]

## Provider Endpoints
[All provider routes — patient list, request access, view patient data]
**Requires:** PROVIDER or ADMIN role

## Patient Consent Endpoints
[All patient routes — list providers, grant/deny, revoke]
**Requires:** PATIENT role

## Settings Endpoints
[All settings routes — export data, delete data, delete account]

## Admin Endpoints
[All admin routes — user management, audit logs, system health]
**Requires:** ADMIN role

---

## Rate Limits
| Limiter | Window | Max | Applied To |
|---------|--------|-----|-----------|
| standardLimiter | 15 min | 100 | All endpoints |
| authLimiter | 15 min | 20 | Auth routes |
| strictAuthLimiter | 15 min | 5 | Login (by email+IP) |
| uploadLimiter | 1 hour | 20 | File uploads |
| sensitiveLimiter | 1 hour | 10 | Export, delete operations |
| bulkOperationLimiter | 1 hour | 30 | Batch creates |
```
