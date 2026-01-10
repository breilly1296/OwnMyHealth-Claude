---
tags:
  - documentation
  - troubleshooting
type: prompt
priority: 2
---

# Generate TROUBLESHOOTING.md

## Purpose
Create or update a troubleshooting guide from problems you've solved.

## Questions to Ask

### Recent Issues
For each problem you've encountered:
1. What was the symptom? (What did you see?)
2. What was the error message (if any)?
3. What was the root cause?
4. How did you fix it?
5. What files were involved?

### By Category

#### Authentication Issues
- Login problems?
- Token expiration issues?
- CSRF errors?
- Session problems?

#### Database Issues
- Connection timeouts?
- Migration failures?
- Query errors?

#### Deployment Issues
- CI/CD failures?
- Docker build problems?
- Environment variable issues?

#### Frontend Issues
- Blank page?
- CORS errors?
- Cookie problems?
- Bundle/loading issues?

#### API Issues
- 500 errors?
- Validation failures?
- Timeout issues?

#### PDF/Extraction Issues
- Upload failures?
- Extraction wrong values?
- Pattern matching problems?

## Output Format

```markdown
# OwnMyHealth Troubleshooting Guide

**Last Updated:** [Date]

## Symptom Index

| Symptom | Jump To |
|---------|---------|
| Data disappears after refresh | [Auth Token Refresh](#auth-token-refresh) |
| 403 CSRF errors | [CSRF Token Missing](#csrf-token-missing) |
...

---

## Authentication Issues

### Auth Token Refresh
**Symptom:** Data appears after login but disappears on page refresh.

**Root Cause:** `getCurrentUser()` called before `refreshToken()`.

**Fix:**
```typescript
// Call refresh FIRST
await refreshToken();
const user = await getCurrentUser();
```

**Files:** `src/contexts/AuthContext.tsx`

---

### CSRF Token Missing
**Symptom:** POST requests return 403 Forbidden.

**Root Cause:** Component using raw `fetch()` without CSRF header.

**Fix:** Include X-CSRF-Token header...

---

## Database Issues

### Connection Timeout
**Symptom:** 500 errors with "connection terminated"

**Root Cause:** DATABASE_URL missing timeout parameters.

**Fix:**
```bash
[commands to fix]
```

---

[Continue for each issue...]

---

## Quick Diagnostic Commands
```bash
# Check service health
curl https://api.ownmyhealth.io/health

# View recent errors
gcloud logging read "severity>=ERROR" --limit 20

# Check database
gcloud sql connect ownmyhealth-db --user=postgres
```
```
