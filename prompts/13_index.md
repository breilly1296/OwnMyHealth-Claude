---
tags: [index, overview]
type: moc
priority: 0
---

# OwnMyHealth Security Review Prompts

## Overview

This folder contains security review prompts specifically tailored for the OwnMyHealth codebase - a HIPAA-compliant osteoporosis management platform.

## Quick Reference

| # | Prompt | Priority | Focus Area |
|---|--------|----------|------------|
| 01 | [Database Schema](./01-database-schema.md.md) | Critical | PHI field encryption, relationships, audit model |
| 02 | [Encryption](./02-encryption.md.md) | Critical | AES-256-GCM, key management, PHI protection |
| 03 | [Authentication](./03-authentication.md.md) | Critical | JWT, sessions, password security, RBAC |
| 04 | [CSRF](./04-csrf.md.md) | High | Double-submit cookie pattern |
| 05 | [Audit Logging](./05-audit-logging.md.md) | Critical | HIPAA compliance, 7-year retention |
| 06 | [API Routes](./06-api-routes.md.md) | Critical | Route protection, middleware stack |
| 07 | [Input Validation](./07-input-validation.md.md) | High | Zod schemas, sanitization |
| 08 | [Rate Limiting](./08-rate-limiting.md.md) | High | Brute force protection |
| 09 | [CMS API](./09-cms-api.md.md) | Medium | External API security |
| 10 | [Frontend Auth](./10-frontend-auth.md.md) | High | Token storage, XSS prevention |
| 11 | [Environment](./11-environment-secrets.md.md) | Critical | Secret management |
| 12 | [CI/CD](./12-cicd-security.md.md) | Medium | Deployment security |

## Recommended Review Order

### Phase 1: Critical Security (Do First)
1. **02-encryption.md** - Foundation of PHI protection
2. **01-database-schema.md** - Data structure security
3. **03-authentication.md** - Access control
4. **05-audit-logging.md** - HIPAA compliance

### Phase 2: API Security
5. **06-api-routes.md** - Route protection
6. **07-input-validation.md** - Injection prevention
7. **08-rate-limiting.md** - Abuse prevention

### Phase 3: Application Security
8. **04-csrf.md** - CSRF protection
9. **10-frontend-auth.md** - Client-side security
10. **09-cms-api.md** - External API

### Phase 4: Operations Security
11. **11-environment-secrets.md** - Secret management
12. **12-cicd-security.md** - Deployment pipeline

## Key Files by Category

### Backend Core
```
backend/
├── prisma/schema.prisma          # Database schema
├── src/
│   ├── config/index.ts           # Configuration
│   ├── middleware/
│   │   ├── auth.ts               # JWT authentication
│   │   ├── rbac.ts               # Role-based access
│   │   ├── csrf.ts               # CSRF protection
│   │   ├── rateLimiter.ts        # Rate limiting
│   │   ├── validation.ts         # Input validation
│   │   └── errorHandler.ts       # Error handling
│   ├── services/
│   │   ├── encryption.ts         # PHI encryption
│   │   ├── authService.ts        # Auth logic
│   │   ├── auditLog.ts           # Audit logging
│   │   └── cmsMarketplaceService.ts  # CMS API
│   └── routes/                   # All API routes
└── .env.example                  # Environment template
```

### Frontend Core
```
src/
├── contexts/AuthContext.tsx      # Auth state
├── services/api.ts               # API client
├── hooks/useRBAC.ts              # Role checking
└── components/
    ├── auth/                     # Login, register pages
    └── common/RoleGuard.tsx      # Route protection
```

## OwnMyHealth Security Patterns

### PHI Encryption
- All PHI fields end with `Encrypted` suffix
- AES-256-GCM with per-user derived keys
- Format: `iv:authTag:ciphertext` (base64)

### Authentication
- Access tokens: 15 min, httpOnly cookie
- Refresh tokens: 7 days, database-backed
- Roles: PATIENT < PROVIDER < ADMIN

### Audit Logging
- All PHI access logged
- 7-year retention (HIPAA)
- Encrypted audit values

### API Security
- Middleware stack: `authenticate -> validate -> asyncHandler`
- Rate limiters per endpoint type
- CSRF double-submit cookie pattern

## HIPAA Compliance Checklist

- [ ] All PHI encrypted at rest (02-encryption)
- [ ] All PHI access logged (05-audit-logging)
- [ ] 7-year audit retention (05-audit-logging)
- [ ] Access controls enforced (03-authentication, 06-api-routes)
- [ ] Secure transmission (HTTPS)
- [ ] Unique user identification (03-authentication)
- [ ] Automatic logoff (03-authentication - token expiry)

## Common Issues Found

1. **PHI Logging**: Check `logger` calls don't include decrypted PHI
2. **Missing Auth**: New routes forgetting `authenticate` middleware
3. **Weak Validation**: POST routes without `validate()` middleware
4. **CSRF Bypass**: State-changing routes not checking CSRF
5. **Missing Audit**: Controllers not calling audit log service

## Running a Security Review

1. Read the relevant prompt file
2. Open the files listed in "Files to Review"
3. Work through the checklist
4. Document any findings
5. Check "Red Flags" section for common issues
6. Create issues/tasks for remediation

## Progress Tracker

- [ ] 01 - Database Schema
- [ ] 02 - Encryption
- [ ] 03 - Authentication
- [ ] 04 - CSRF
- [ ] 05 - Audit Logging
- [ ] 06 - API Routes
- [ ] 07 - Input Validation
- [ ] 08 - Rate Limiting
- [ ] 09 - CMS API
- [ ] 10 - Frontend Auth
- [ ] 11 - Environment Secrets
- [ ] 12 - CI/CD Security

## Updating These Prompts

When the codebase changes:
1. Check if new files need to be added to reviews
2. Update file paths if refactored
3. Add new security patterns discovered
4. Update checklists with new requirements
