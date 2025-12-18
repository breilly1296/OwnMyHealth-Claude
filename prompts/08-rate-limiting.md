---
tags: [security, review]
type: prompt
priority: 2
---

# Rate Limiting Review

## Files to Review
- `backend/src/middleware/rateLimiter.ts`
- `backend/src/config/index.ts` (rate limit configuration)
- `backend/src/routes/authRoutes.ts` (rate limiter application)
- All route files for rate limiter usage

## OwnMyHealth Rate Limiting Architecture

- **Library**: `express-rate-limit`
- **Key Generation**: IP address (handles `x-forwarded-for` for proxies)
- **Response Format**: Standard `ApiResponse` with error code

## Rate Limiters Defined

| Limiter | Window | Max Requests | Purpose |
|---------|--------|--------------|---------|
| `standardLimiter` | 15 min | 100 | General API endpoints |
| `authLimiter` | 15 min | 20 | Auth endpoints (register, etc.) |
| `strictAuthLimiter` | 15 min | 5 | Login, forgot-password |
| `uploadLimiter` | 1 hour | 20 | File uploads |
| `sensitiveLimiter` | 1 hour | 10 | Sensitive operations |

## Checklist

### 1. Standard Rate Limiter
- [ ] Window: 15 minutes (`config.rateLimit.windowMs`)
- [ ] Max requests: 100 (`config.rateLimit.maxRequests`)
- [ ] Key generator uses `req.ip` or `x-forwarded-for`
- [ ] Standard headers enabled (`RateLimit-*`)
- [ ] Legacy headers disabled

### 2. Auth Rate Limiter
- [ ] Window: 15 minutes
- [ ] Max requests: 20
- [ ] Applied to all `/auth/*` routes
- [ ] Error code: `AUTH_RATE_LIMIT_EXCEEDED`

### 3. Strict Auth Rate Limiter (Brute Force Protection)
- [ ] Window: 15 minutes
- [ ] Max requests: 5 only
- [ ] `skipSuccessfulRequests: true` (only count failures)
- [ ] Key: `${email}:${ip}` (per-account per-IP)
- [ ] Applied to:
  - [ ] POST `/auth/login`
  - [ ] POST `/auth/forgot-password`
- [ ] Error code: `LOGIN_RATE_LIMIT_EXCEEDED`

### 4. Upload Rate Limiter
- [ ] Window: 1 hour
- [ ] Max requests: 20
- [ ] Applied to `/upload/*` routes
- [ ] Error code: `UPLOAD_RATE_LIMIT_EXCEEDED`

### 5. Sensitive Operations Rate Limiter
- [ ] Window: 1 hour
- [ ] Max requests: 10
- [ ] Applied to sensitive data operations:
  - [ ] Data exports
  - [ ] Bulk operations
  - [ ] Admin actions
- [ ] Error code: `SENSITIVE_RATE_LIMIT_EXCEEDED`

### 6. Configuration
In `backend/src/config/index.ts`:
- [ ] `RATE_LIMIT_WINDOW_MS` environment variable (default: 900000)
- [ ] `RATE_LIMIT_MAX_REQUESTS` environment variable (default: 100)
- [ ] Production values appropriate (not too high)

### 7. Response Format
All limiters return:
```json
{
  "success": false,
  "error": {
    "code": "*_RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later."
  }
}
```

### 8. Headers
- [ ] `RateLimit-Limit` - max requests
- [ ] `RateLimit-Remaining` - remaining requests
- [ ] `RateLimit-Reset` - window reset time

### 9. Route Coverage

| Route | Limiter Applied |
|-------|-----------------|
| `/auth/*` (general) | `authLimiter` |
| `/auth/login` | `strictAuthLimiter` |
| `/auth/forgot-password` | `strictAuthLimiter` |
| `/upload/*` | `uploadLimiter` |
| `/biomarkers/*` | `standardLimiter` or none |
| `/insurance/*` | `standardLimiter` or none |
| `/admin/*` | `sensitiveLimiter` |

### 10. Proxy Configuration
- [ ] App configured to trust proxy (`app.set('trust proxy', ...)`)
- [ ] `x-forwarded-for` header properly parsed
- [ ] Rate limiting works behind load balancer

## Potential Issues

### Not Rate Limited (Should Be?)
- [ ] `/biomarkers/export` - data export should be limited
- [ ] `/dna/upload` - heavy operation
- [ ] Batch creation endpoints

### Too Strict?
- [ ] 5 login attempts per 15 min might frustrate users
- [ ] Consider progressive delays instead

### Not Strict Enough?
- [ ] Admin operations with only `sensitiveLimiter`
- [ ] Data export allowing 10/hour

## Red Flags
- Login without strict rate limiting
- No rate limiting on file uploads
- Standard limiter allowing 1000+ requests
- Key generator doesn't handle proxies
- Rate limit bypass in production
- No rate limiting on sensitive admin routes
