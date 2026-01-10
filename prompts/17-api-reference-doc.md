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

### Step 1: List All Routes
```bash
grep -r "router\.\(get\|post\|put\|delete\|patch\)" backend/src/routes/
```

### Step 2: For Each Route File
1. Identify HTTP method and path
2. Check middleware (auth required?)
3. Find controller function
4. Document request/response shapes

### Step 3: Check Controllers
- `backend/src/controllers/*.ts`
- Look for request body validation
- Look for response structure

## Questions to Ask
1. What's the base URL for the API?
2. How does authentication work?
3. What's the standard error response format?
4. Are there any rate limits?
5. Are there any deprecated endpoints?

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
[All biomarker routes]

## File Endpoints
[All file routes]

## Upload Endpoints
[All upload routes]

## Insurance Endpoints
[All insurance routes]

---

## Rate Limits
| Endpoint | Limit |
|----------|-------|
...
```
