# OwnMyHealth - Project Context

## What This Is
Privacy-first health biomarker tracking platform with insurance document management. Focused on simple, secure tracking of health metrics (especially for osteoporosis management) without AI analysis or health scoring.

## Tech Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS
- **Backend**: Node.js + Hono framework + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT access tokens + refresh tokens + CSRF protection
- **Encryption**: AES-256-GCM for all PHI (application-layer)
- **Testing**: Vitest (frontend), Jest (backend)
- **Target Deployment**: AWS ECS Fargate, RDS, S3

## Current Features
- **Biomarker Tracking**: Manual entry, history, trends, normal ranges
- **DEXA Scan Support**: Upload and track bone density measurements
- **Insurance Management**: SBC document upload, plan details storage
- **Health Goals**: Simple goal tracking with progress notes
- **Audit Logging**: HIPAA-compliant access logging

## Removed Features (Jan 2025)
These were removed to simplify the product and reduce maintenance burden:
- ~~DNA/Genetics Analysis~~ - 23andMe parsing, SNP analysis, genetic traits
- ~~Health Scoring~~ - 0-100 health scores, risk assessments
- ~~AI Recommendations~~ - AI-generated health insights, trend analysis
- ~~CMS Marketplace Integration~~ - healthcare.gov plan search
- ~~Provider Directory~~ - doctor search and recommendations

## Project Structure
```
src/
├── components/
│   ├── analytics/      # Trend charts (TrendChart, BiomarkerChart)
│   ├── auth/           # Login, registration
│   ├── biomarkers/     # Biomarker display, entry, modals
│   ├── common/         # Shared UI (Button, Modal, etc.)
│   ├── dashboard/      # Main dashboard
│   ├── insurance/      # Insurance hub, plan management
│   └── upload/         # File upload components
├── contexts/           # React contexts (Auth)
├── services/           # API client (api.ts)
├── types/              # TypeScript interfaces
└── data/               # Sample data, nav config

backend/src/
├── controllers/        # Route handlers
├── middleware/         # Auth, CSRF, rate limiting
├── routes/             # API route definitions
├── services/           # Business logic
│   ├── encryption.ts   # PHI encryption (AES-256-GCM)
│   ├── auditLog.ts     # HIPAA audit trail
│   ├── authService.ts  # Authentication logic
│   └── userEncryption.ts # Per-user key management
├── config/             # Environment config
└── utils/              # Helpers (logger, validation)
```

## Critical Rules

### Security (Non-Negotiable)
1. **NEVER use localStorage/sessionStorage** for sensitive data - memory only
2. **All PHI must be encrypted** with AES-256-GCM before database storage
3. **Every PHI access must be audit logged** - 7-year retention required
4. **Validate all input** at API boundaries - never trust user data
5. **No secrets in code** - use environment variables
6. **Sanitize error messages** - never leak internal details to users

### PHI Encryption
PHI fields are defined in `backend/src/services/encryption.ts` (PHI_FIELDS constant).
Must match Prisma schema exactly. Current encrypted fields:
- User: name, DOB, phone, address
- Biomarker/History: values, notes
- Insurance: member ID, group ID
- Health Goals/Progress: descriptions, notes
- Audit Log: previous/new values

### Product Guidelines
1. **No medical advice** - always include disclaimers
2. **Keep it simple** - avoid feature creep, no AI/ML
3. **User owns their data** - export capabilities required

## Key Files
| File | Purpose |
|------|---------|
| `backend/prisma/schema.prisma` | Database models, encrypted field definitions |
| `backend/src/services/encryption.ts` | PHI encryption, PHI_FIELDS mapping |
| `backend/src/services/auditLog.ts` | HIPAA audit trail creation |
| `backend/src/middleware/auth.ts` | JWT verification, route protection |
| `backend/src/middleware/csrf.ts` | CSRF token validation |
| `src/contexts/AuthContext.tsx` | Frontend auth state management |
| `src/services/api.ts` | API client with auth headers |

## Development Commands
```bash
# Frontend
npm run dev          # Start dev server (port 5173)
npm run build        # Production build
npm run test         # Run Vitest tests

# Backend
cd backend
npm run dev          # Start dev server (port 3001)
npm run build        # Compile TypeScript
npm run test         # Run Jest tests

# Database
npx prisma generate  # Generate Prisma client
npx prisma migrate dev  # Run migrations
npx prisma studio    # Database GUI
```

## Code Review Checklist
- [ ] Auth middleware on all protected routes?
- [ ] PHI encrypted before storage?
- [ ] Audit logs created for PHI access?
- [ ] Input validated and sanitized?
- [ ] Errors handled without leaking data?
- [ ] No console.log with sensitive data?
- [ ] CSRF token required for mutations?
- [ ] Rate limiting applied where needed?

## Environment Variables
```
# Required
DATABASE_URL=postgresql://...
JWT_SECRET=<256-bit secret>
PHI_ENCRYPTION_KEY=<64 hex chars>

# Optional
NODE_ENV=development|production
PORT=3001
CORS_ORIGIN=http://localhost:5173
```
