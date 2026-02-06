---
tags:
  - security
  - api
  - medium
type: prompt
priority: 3
---

# Rate Limiting Review

## Files to Review
- `backend/src/middleware/rateLimiter.ts` (if exists)
- `backend/src/app.ts` (middleware registration)
- `backend/src/routes/*.ts` (route-specific limits)

## OwnMyHealth Rate Limiting Strategy
- **Global**: Basic protection on all routes
- **Auth Endpoints**: Strict limits (prevent brute force)
- **Upload Endpoints**: Prevent abuse
- **AI/API Endpoints**: Cost control

## Checklist

### 1. Rate Limiter Configuration
- [ ] Rate limiting middleware installed (`express-rate-limit`)
- [ ] Applied globally or to sensitive routes
- [ ] Limits are reasonable for legitimate use

### 2. Authentication Endpoints
- [ ] `POST /auth/login` - strict limit (e.g., 5/minute per IP)
- [ ] `POST /auth/register` - moderate limit (e.g., 3/hour per IP)
- [ ] `POST /auth/forgot-password` - strict limit
- [ ] `POST /auth/reset-password` - strict limit

### 3. Resource-Intensive Endpoints
- [ ] `POST /upload/*` - limit uploads (e.g., 20/hour) — `uploadLimiter`
- [ ] `POST /biomarkers/:id/guidance` - limit AI calls — expensive Claude API
- [ ] `POST /expenses/analyses` - limit cost analysis — expensive Claude API
- [ ] `POST /biomarkers/batch` - limit bulk creates (e.g., 30/hour) — `bulkOperationLimiter`
- [ ] `GET /files/*/download` - prevent bulk downloads
- [ ] `GET /settings/export-data` - limit data exports — `sensitiveLimiter`
- [ ] `DELETE /settings/*` - limit deletion operations — `sensitiveLimiter`
- [ ] Provider access request endpoint - prevent spam

### 4. Rate Limit Headers
- [ ] `X-RateLimit-Limit` - max requests
- [ ] `X-RateLimit-Remaining` - requests left
- [ ] `X-RateLimit-Reset` - when limit resets
- [ ] `Retry-After` on 429 responses

### 5. Rate Limit Key
- [ ] Based on IP address (for unauthenticated)
- [ ] Based on user ID (for authenticated)
- [ ] Considers proxy headers correctly

### 6. Response on Limit
- [ ] Returns 429 Too Many Requests
- [ ] Includes helpful error message
- [ ] Doesn't leak information about limits

## Example Configuration
```typescript
import rateLimit from 'express-rate-limit';

// Strict limit for auth
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: 'Too many attempts, please try again later'
});

// Moderate limit for uploads
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Upload limit reached'
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/upload', uploadLimiter);
```

## Actual Limiters in Codebase
Verify these exist in `backend/src/middleware/rateLimiter.ts`:
- [ ] `standardLimiter` — 100 req/15 min (global)
- [ ] `authLimiter` — 20 req/15 min (auth routes)
- [ ] `strictAuthLimiter` — 5 req/15 min (login), keyed by email+IP
- [ ] `uploadLimiter` — 20 uploads/hour
- [ ] `sensitiveLimiter` — 10 req/hour (sensitive operations)
- [ ] `bulkOperationLimiter` — 30 req/hour (batch creates)

## Questions to Ask
1. Are authentication endpoints rate limited?
2. Are AI/Claude API endpoints limited (cost control)?
3. What happens when limits are hit?
4. Are rate limits keyed by IP, user ID, or both?
5. Do demo accounts have separate (stricter) limits?
