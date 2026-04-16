---
tags:
  - security
  - api
  - medium
type: prompt
priority: 3
updated: 2026-04-16
---

# Rate Limiting Review

> Follow the [review protocol](./_review-protocol.md). Use [Claude Code tools](./_verification-tools.md).

## Files to Review
- `backend/src/middleware/rateLimiter.ts` — 7 exported limiters
- `backend/src/app.ts` — global limiter registration
- `backend/src/routes/*.ts` — per-route limiter attachment

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
Verify all **7** are exported from `backend/src/middleware/rateLimiter.ts`:
- [ ] `standardLimiter` — 100 req/15 min (global default)
- [ ] `authLimiter` — 20 req/15 min (auth routes)
- [ ] `strictAuthLimiter` — 5 req/15 min (login), keyed by email+IP
- [ ] `uploadLimiter` — 20 uploads/hour
- [ ] `sensitiveLimiter` — 10 req/hour (export, delete, password reset)
- [ ] `aiLimiter` — applied to Claude-backed endpoints (biomarker guidance, cost analysis, SBC extraction). **Verify it's actually attached to those routes**, not just exported.
- [ ] `bulkOperationLimiter` — 30 req/hour (batch creates)

### Limiter-to-route coverage (cross-check)
- [ ] `strictAuthLimiter` on `POST /auth/login`
- [ ] `authLimiter` on `POST /auth/register`, `POST /auth/forgot-password`, `POST /auth/reset-password`
- [ ] `uploadLimiter` on every route in `uploadRoutes.ts`
- [ ] `aiLimiter` on `POST /biomarkers/:id/guidance`, `POST /expenses/analyses`, `POST /upload/insurance-sbc`, `POST /upload/lab-report` (any route that can trigger a Claude or Document AI call)
- [ ] `sensitiveLimiter` on `GET /settings/export-data`, `DELETE /settings/delete-data`, `DELETE /settings/delete-account`
- [ ] `bulkOperationLimiter` on `POST /biomarkers/batch`
- [ ] `standardLimiter` registered globally in `app.ts` (applies to everything else)

## Questions to Ask
1. Is `aiLimiter` keyed by userId (fair per-user spend) or IP (easier DoS)? Which is correct for cost control?
2. Does `standardLimiter` registration in `app.ts` happen before or after route-specific limiters? Order affects which one applies.
3. Do demo accounts have stricter AI limits (they can burn API budget on a shared key)?
4. What's the monthly Claude spend cap, and does the limiter math match it (worst-case: `authenticatedUsers × aiLimiter.max × cost`)?
5. Are 429 responses logged? A spike signals either abuse or a legitimate feature hitting the cap.
