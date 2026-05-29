# OwnMyHealth

A privacy-first, HIPAA-compliant health biomarker tracking platform with insurance document management. Built for patients managing chronic conditions like osteoporosis.

**Security Audit Status:** `PASS` | **Vulnerabilities:** `0` | **Last Audit:** January 2025

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SYSTEM OVERVIEW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐      HTTPS       ┌──────────────┐      SQL        ┌──────────────┐
│              │    httpOnly      │              │    Prisma       │              │
│  React SPA   │◄────cookies─────►│  Express     │◄───────────────►│  PostgreSQL  │
│  (Vite)      │                  │  API         │                 │              │
│  Port 5173   │                  │  Port 3001   │                 │  + RLS       │
│              │                  │              │                 │              │
└──────────────┘                  └──────┬───────┘                 └──────────────┘
                                         │
                                         │ HTTPS
                                         ▼
                                  ┌──────────────┐
                                  │              │
                                  │  Google      │
                                  │  Cloud       │
                                  │  Storage     │
                                  │              │
                                  └──────────────┘
```

---

## Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           JWT AUTHENTICATION FLOW                            │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────┐                    ┌──────────┐                    ┌──────────┐
  │  Client  │                    │  Server  │                    │ Database │
  └────┬─────┘                    └────┬─────┘                    └────┬─────┘
       │                               │                               │
       │  POST /auth/login             │                               │
       │  {email, password}            │                               │
       │──────────────────────────────►│                               │
       │                               │  Validate credentials         │
       │                               │──────────────────────────────►│
       │                               │◄──────────────────────────────│
       │                               │                               │
       │  Set-Cookie: accessToken      │                               │
       │  Set-Cookie: refreshToken     │                               │
       │  Set-Cookie: csrfToken        │                               │
       │◄──────────────────────────────│                               │
       │                               │                               │
       │  GET /api/biomarkers          │                               │
       │  Cookie: accessToken          │                               │
       │  X-CSRF-Token: <token>        │                               │
       │──────────────────────────────►│                               │
       │                               │  Verify JWT + CSRF            │
       │                               │  Set RLS context              │
       │                               │──────────────────────────────►│
       │                               │◄──────────────────────────────│
       │  200 OK {biomarkers}          │                               │
       │◄──────────────────────────────│                               │
       │                               │                               │

Token Configuration:
┌─────────────────┬────────────────┬─────────────────────────────────┐
│ Token           │ Lifetime       │ Storage                         │
├─────────────────┼────────────────┼─────────────────────────────────┤
│ Access Token    │ 15 minutes     │ httpOnly cookie                 │
│ Refresh Token   │ 7 days         │ httpOnly cookie                 │
│ CSRF Token      │ Session        │ Cookie + Header validation      │
└─────────────────┴────────────────┴─────────────────────────────────┘
```

---

## Data Protection Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ENCRYPTED vs PUBLIC FIELDS                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            PostgreSQL Database                               │
├─────────────────────────────────┬───────────────────────────────────────────┤
│         PUBLIC DATA             │        PHI (AES-256-GCM Encrypted)        │
│         (Queryable)             │        (Application Layer)                │
├─────────────────────────────────┼───────────────────────────────────────────┤
│                                 │                                           │
│  User:                          │  User:                                    │
│  • id                           │  • nameEncrypted                          │
│  • email                        │  • dateOfBirthEncrypted                   │
│  • role                         │  • phoneEncrypted                         │
│  • createdAt                    │  • addressEncrypted                       │
│                                 │                                           │
│  Biomarker:                     │  Biomarker:                               │
│  • id                           │  • valueEncrypted                         │
│  • type                         │  • notesEncrypted                         │
│  • userId                       │                                           │
│  • recordedAt                   │                                           │
│                                 │                                           │
│  Insurance:                     │  Insurance:                               │
│  • id                           │  • memberIdEncrypted                      │
│  • planType                     │  • groupIdEncrypted                       │
│  • metalLevel                   │                                           │
│  • deductible                   │                                           │
│                                 │                                           │
│  HealthGoal:                    │  HealthGoal:                              │
│  • id                           │  • descriptionEncrypted                   │
│  • status                       │  • notesEncrypted                         │
│  • targetDate                   │                                           │
│                                 │                                           │
└─────────────────────────────────┴───────────────────────────────────────────┘

Encryption: AES-256-GCM with per-user derived keys
Key Storage: Environment variable (PHI_ENCRYPTION_KEY)
```

---

## Request Middleware Stack

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          REQUEST MIDDLEWARE STACK                            │
└─────────────────────────────────────────────────────────────────────────────┘

              Incoming Request
                    │
                    ▼
         ┌─────────────────────┐
         │       Helmet        │  Security headers (CSP, HSTS, etc.)
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │        CORS         │  Origin validation
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │    Rate Limiter     │  100 req/15min global, 5/min auth
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │   Cookie Parser     │  Parse auth cookies
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │    JSON Parser      │  Body parsing with size limits
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │   Morgan Logger     │  Request logging
         └──────────┬──────────┘
                    ▼
    ┌───────────────┴───────────────┐
    │         Route Matched         │
    └───────────────┬───────────────┘
                    ▼
         ┌─────────────────────┐
         │   Auth Middleware   │  JWT verification (protected routes)
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │   CSRF Validation   │  Token verification (mutations)
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │  Input Validation   │  Zod schema validation
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │    RLS Context      │  Set PostgreSQL user context
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │  Route Controller   │  Business logic
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │    Audit Logger     │  Log PHI access (HIPAA)
         └──────────┬──────────┘
                    ▼
              Response Sent
```

---

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Biomarker Tracking** | Complete | Manual entry, history, trends, normal ranges |
| **DEXA Scan Support** | Complete | Upload and track bone density measurements |
| **Insurance Management** | Complete | SBC document upload, plan details storage |
| **Health Goals** | Complete | Goal tracking with progress notes |
| **PHI Encryption** | Complete | AES-256-GCM, per-user derived keys |
| **Audit Logging** | Complete | HIPAA-compliant, 7-year retention |
| **Row-Level Security** | Complete | PostgreSQL RLS policies |
| **PDF Upload** | Complete | Lab reports, insurance documents |

---

## Tech Stack

### Frontend
| Component | Technology | Version |
|-----------|------------|---------|
| Framework | React | 18.3 |
| Build Tool | Vite | 7.3 |
| Language | TypeScript | 5.5 |
| Styling | Tailwind CSS | 3.4 |
| Charts | Recharts | 3.5 |
| PDF | pdfjs-dist, jsPDF | 4.0 |

### Backend
| Component | Technology | Version |
|-----------|------------|---------|
| Framework | Express | 4.18 |
| Language | TypeScript | 5.3 |
| ORM | Prisma | 7.0 |
| Database | PostgreSQL | 14+ |
| Validation | Zod | 3.22 |
| File Storage | Google Cloud Storage | 7.18 |

### Security
| Control | Implementation |
|---------|----------------|
| PHI Encryption | AES-256-GCM (application layer) |
| Password Hashing | bcrypt (12 rounds) |
| Authentication | JWT access + refresh tokens |
| CSRF Protection | Double-submit cookie pattern |
| Rate Limiting | express-rate-limit |
| HTTP Security | Helmet |

---

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm

### Installation

```bash
# Clone repository
git clone https://github.com/breilly1296/OwnMyHealth.git
cd OwnMyHealth

# Install frontend dependencies
npm install

# Install backend dependencies
cd backend && npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Setup database
npx prisma generate
npx prisma migrate dev

# Start servers (two terminals)
npm run dev                    # Backend (port 3001)
cd .. && npm run dev           # Frontend (port 5173)
```

### Environment Variables

```env
# Required
DATABASE_URL=postgresql://user:pass@host:5432/ownmyhealth
JWT_ACCESS_SECRET=<32+ character secret>
JWT_REFRESH_SECRET=<32+ character secret>
PHI_ENCRYPTION_KEY=<64 hex characters>
AUDIT_LOG_SALT=<64 hex characters>

# Optional
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
GCS_BUCKET_NAME=<your-bucket>
ANTHROPIC_API_KEY=<for-ai-features>
```

---

## Documentation

### Prompts Reference (14-23)

| # | Document | Purpose |
|---|----------|---------|
| 14 | [Strategy](prompts/14-strategy-doc.md) | Product strategy and roadmap |
| 15 | [Runbook](prompts/15-runbook-doc.md) | Operational procedures |
| 16 | [Architecture](prompts/16-architecture-doc.md) | System design |
| 17 | [API Reference](prompts/17-api-reference-doc.md) | Endpoint documentation |
| 18 | [Troubleshooting](prompts/18-troubleshooting-doc.md) | Common issues and fixes |
| 19 | [Changelog](prompts/19-changelog-doc.md) | Version history |
| 20 | [Known Issues](prompts/20-known-issues-doc.md) | Current bugs |
| 21 | [Security Status](prompts/21-security-status-doc.md) | Security posture |
| 22 | [HIPAA Checklist](prompts/22-hipaa-checklist-doc.md) | Compliance status |
| 23 | [Financial Tracker](prompts/23-financial-tracker-doc.md) | Cost tracking |

### Security Audit Prompts (01-13)

| # | Document | Purpose |
|---|----------|---------|
| 01 | [Database Schema](prompts/01-database-schema.md) | Schema security, RLS |
| 02 | [Encryption](prompts/02-encryption.md) | PHI encryption audit |
| 03 | [Authentication](prompts/03-authentication.md) | JWT, sessions |
| 04 | [CSRF](prompts/04-csrf.md) | CSRF protection |
| 05 | [Audit Logging](prompts/05-audit-logging.md) | HIPAA logging |
| 06 | [API Routes](prompts/06-api-routes.md) | Route authorization |
| 07 | [Input Validation](prompts/07-input-validation.md) | Input sanitization |
| 08 | [Rate Limiting](prompts/08-rate-limiting.md) | Brute force prevention |
| 09 | [External APIs](prompts/09-external-apis.md) | API security |
| 10 | [Frontend Auth](prompts/10-frontend-auth.md) | Client-side security |
| 11 | [Environment Secrets](prompts/11-environment-secrets.md) | Secret management |
| 12 | [CI/CD Security](prompts/12-cicd-security.md) | Pipeline security |
| 13 | [Dependency Health](prompts/13-dependency-health.md) | Vulnerability scanning |

---

## Security Audit Status

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SECURITY AUDIT RESULTS                              │
│                            January 2025                                      │
└─────────────────────────────────────────────────────────────────────────────┘

  Overall Status:  PASS

  ┌─────────────────────┬──────────┐
  │ Category            │ Status   │
  ├─────────────────────┼──────────┤
  │ Critical Findings   │    0     │
  │ High Findings       │    0     │
  │ Medium Findings     │    0     │
  │ Low Findings        │    0     │
  │ npm audit           │    0     │
  └─────────────────────┴──────────┘

  Controls Verified:
  [x] PHI encryption (AES-256-GCM)
  [x] JWT authentication
  [x] CSRF protection
  [x] Rate limiting
  [x] Input validation (Zod)
  [x] Audit logging (HIPAA)
  [x] Row-level security (PostgreSQL RLS)
  [x] Secret management
  [x] SQL injection prevention (Prisma)
```

---

## Scripts

### Frontend
```bash
npm run dev          # Start dev server (port 5173)
npm run build        # Production build
npm run test         # Run Vitest tests
npm run lint         # ESLint
```

### Backend
```bash
npm run dev          # Start dev server (port 3001)
npm run build        # Compile TypeScript
npm run test         # Run Vitest tests
npx prisma studio    # Database GUI
npx prisma migrate   # Run migrations
```

---

## Project Structure

```
OwnMyHealth/
├── src/                          # Frontend
│   ├── components/
│   │   ├── analytics/            # Trend charts
│   │   ├── auth/                 # Login, registration
│   │   ├── biomarkers/           # Biomarker display, entry
│   │   ├── common/               # Shared UI components
│   │   ├── dashboard/            # Main dashboard
│   │   ├── insurance/            # Insurance hub
│   │   └── upload/               # File uploads
│   ├── contexts/                 # React contexts
│   ├── services/                 # API client
│   └── types/                    # TypeScript interfaces
│
├── backend/
│   ├── src/
│   │   ├── controllers/          # Route handlers
│   │   ├── middleware/           # Auth, CSRF, rate limiting
│   │   ├── routes/               # API routes
│   │   ├── services/
│   │   │   ├── encryption.ts     # PHI encryption
│   │   │   ├── auditLog.ts       # HIPAA audit trail
│   │   │   ├── database.ts       # Prisma + RLS
│   │   │   └── authService.ts    # Authentication
│   │   └── config/               # Environment config
│   └── prisma/
│       └── schema.prisma         # Database schema
│
├── prompts/                      # Documentation prompts (00-25)
├── CLAUDE.md                     # AI assistant context
└── README.md                     # This file
```

---

## License

This project is private and proprietary.

## Support

For issues and feature requests, use the [GitHub Issues](https://github.com/breilly1296/OwnMyHealth/issues) page.
