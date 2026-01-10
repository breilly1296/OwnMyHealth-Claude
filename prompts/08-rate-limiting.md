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
- [ ] `POST /upload/*` - limit uploads (e.g., 10/hour)
- [ ] `POST /*/guidance` - limit AI calls (e.g., 30/hour)
- [ ] `GET /files/*/download` - prevent bulk downloads

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

## Questions to Ask
1. Are authentication endpoints rate limited?
2. Are AI/Claude API endpoints limited (cost control)?
3. What happens when limits are hit?
