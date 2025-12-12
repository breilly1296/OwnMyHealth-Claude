# OwnMyHealth - Technical Handoff Document

**Prepared for:** ThoughtBot Development Team
**Date:** November 2025
**Document Version:** 1.0

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Current State](#2-current-state)
3. [Technical Architecture](#3-technical-architecture)
4. [Code Quality](#4-code-quality)
5. [What Needs to Be Built](#5-what-needs-to-be-built)
6. [Deployment Requirements](#6-deployment-requirements)
7. [Business Context](#7-business-context)

---

## 1. Project Overview

### What OwnMyHealth Does

OwnMyHealth is a **personal health management platform** that helps patients:

1. **Track health biomarkers** - Upload lab reports (PDFs) or manually enter blood test results, track trends over time
2. **Manage DNA/genetic data** - Import 23andMe/AncestryDNA files, view genetic health insights
3. **Navigate insurance** - Upload Summary of Benefits (SBC) documents, understand coverage for specific health needs
4. **Get actionable health insights** - Risk scoring, provider recommendations, goal tracking

### Target Users

**Primary:** Patients with chronic conditions, specifically **osteoporosis patients** who:
- See multiple specialists
- Have complex insurance situations
- Need to track multiple biomarkers (bone density, vitamin D, calcium, etc.)
- Want to understand which treatments their insurance covers

**Secondary:** Health-conscious individuals managing ongoing health metrics

### Key Differentiator

Most health apps focus on fitness. OwnMyHealth focuses on **the intersection of health data and insurance navigation** - helping patients understand:
- "My vitamin D is low, what does my insurance cover for treatment?"
- "I need a DEXA scan, is it covered? What's my copay?"
- "Which in-network endocrinologists treat osteoporosis?"

---

## 2. Current State

### What's Built and Working

| Feature | Status | Notes |
|---------|--------|-------|
| **User Authentication** | ✅ Complete | Registration, login, JWT tokens, CSRF protection, session management |
| **Biomarker Management** | ✅ Complete | Full CRUD, history tracking, category filtering, pagination |
| **Lab Report Parsing** | ✅ Complete | PDF upload, text extraction, biomarker identification |
| **DNA Data Import** | ✅ Complete | 23andMe format parsing, trait analysis, risk scoring |
| **Insurance Plan Management** | ✅ Complete | SBC PDF parsing, benefit extraction, coverage lookup |
| **Health Analysis** | ✅ Complete | Risk scoring, condition detection, provider recommendations |
| **Health Goals** | ✅ Complete | Goal setting, progress tracking, milestones |
| **Health Needs** | ✅ Complete | Need identification, urgency levels, status tracking |
| **Audit Logging** | ✅ Complete | HIPAA-compliant logging, 7-year retention, encrypted |
| **PHI Encryption** | ✅ Complete | AES-256-GCM, per-user salts, field-level encryption |
| **Demo Mode** | ✅ Complete | Seeded demo user for testing without registration |

### What's Incomplete

| Feature | Status | Priority |
|---------|--------|----------|
| **Email Verification** | Schema ready, no email service | High |
| **Password Reset** | Schema ready, no email service | High |
| **File Storage** | Files stored in memory/temp | High for production |
| **Provider Directory** | UI exists, no real data source | Medium |
| **Mobile Responsiveness** | Partial | Medium |
| **Notifications** | Not implemented | Low for MVP |

### Known Limitations

1. **No Email Integration** - Email verification tokens exist in schema but no SMTP/email service configured
2. **Local File Processing** - Uploaded files processed in memory, not persisted to cloud storage
3. **Single Database** - No read replicas or caching layer
4. **No Search** - No full-text search on biomarkers/conditions
5. **Limited PDF Parsing** - Works well with standard lab formats, may fail on unusual layouts

---

## 3. Technical Architecture

### Tech Stack

```
Frontend                Backend                 Database
─────────────────────   ──────────────────────  ──────────────────
React 18.3              Express 4.18            PostgreSQL
TypeScript 5.5          TypeScript 5.3          Prisma ORM 7.0
Vite 5.4                Node.js 18+
Tailwind CSS 3.4        JWT Authentication
Chart.js                Zod Validation
Recharts                Multer (file uploads)
                        pdf-parse
                        bcryptjs
```

### Project Structure

```
OwnMyHealth/
├── src/                          # Frontend React app
│   ├── components/               # React components
│   │   ├── dashboard/            # Main dashboard views
│   │   ├── health/               # Health-related components
│   │   ├── insurance/            # Insurance components
│   │   └── upload/               # File upload components
│   ├── contexts/                 # React contexts (Auth)
│   ├── services/                 # API client services
│   ├── utils/                    # Utility functions
│   │   ├── dna/                  # DNA parsing logic
│   │   ├── documents/            # Document parsing
│   │   ├── health/               # Health analysis
│   │   └── insurance/            # Insurance logic
│   └── __tests__/                # Frontend tests
│
├── backend/                      # Backend Express app
│   ├── src/
│   │   ├── controllers/          # Request handlers
│   │   ├── routes/               # Route definitions
│   │   ├── middleware/           # Express middleware
│   │   ├── services/             # Business logic
│   │   ├── utils/                # Utilities
│   │   ├── config/               # Configuration
│   │   └── __tests__/            # Backend tests
│   └── prisma/
│       └── schema.prisma         # Database schema
│
├── package.json                  # Frontend dependencies
└── HANDOFF.md                    # This document
```

### Database Schema Overview

**Core Tables:**

```
User                  # User accounts with encrypted PHI
├── Biomarker         # Lab results (value encrypted)
│   └── BiomarkerHistory  # Historical values
├── InsurancePlan     # Insurance coverage info
│   └── InsuranceBenefit  # Specific benefits
├── DNAData           # Uploaded DNA files
│   ├── DNAVariant    # Individual SNPs (genotype encrypted)
│   └── GeneticTrait  # Interpreted traits
├── HealthNeed        # Identified health needs
├── HealthGoal        # User-set health goals
│   └── GoalProgressHistory
├── Session           # Active sessions
└── UserEncryptionKey # Per-user encryption keys

AuditLog              # HIPAA audit trail (standalone)
SystemConfig          # System configuration
ProviderPatient       # Provider-patient relationships (future)
```

**Key Schema Patterns:**

1. **PHI fields named `*Encrypted`** - All sensitive data encrypted at app layer
2. **Soft deletes** - Cascade deletes for user data, SetNull for audit references
3. **Timestamps** - `createdAt`/`updatedAt` on all tables
4. **UUIDs** - All primary keys are UUIDs
5. **Enums** - Type-safe enums for status fields

### API Structure

**Base URL:** `/api/v1`

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/auth/register` | POST | User registration |
| `/auth/login` | POST | User login |
| `/auth/logout` | POST | User logout |
| `/auth/refresh` | POST | Refresh access token |
| `/auth/demo` | POST | Demo user login |
| `/auth/me` | GET | Current user info |
| `/biomarkers` | GET, POST | List/create biomarkers |
| `/biomarkers/:id` | GET, PUT, DELETE | Single biomarker ops |
| `/biomarkers/:id/history` | GET | Biomarker history |
| `/biomarkers/summary` | GET | Biomarker statistics |
| `/insurance` | GET, POST | Insurance plans |
| `/insurance/:id` | GET, PUT, DELETE | Single plan ops |
| `/dna` | GET, POST | DNA uploads |
| `/dna/:id` | GET, DELETE | Single DNA data |
| `/dna/:id/variants` | GET | DNA variants |
| `/dna/:id/traits` | GET | Genetic traits |
| `/health/analysis` | GET | Full health analysis |
| `/health/needs` | GET | Health needs |
| `/health/score` | GET | Health score |
| `/health-goals` | GET, POST | Health goals |
| `/health-goals/:id` | GET, PUT, DELETE | Single goal ops |
| `/health-needs` | GET, POST | Health needs management |
| `/upload/lab-report` | POST | Upload lab PDF |
| `/upload/sbc` | POST | Upload insurance SBC |
| `/upload/dna` | POST | Upload DNA file |

### Authentication Flow

```
1. Login Request
   POST /auth/login { email, password }

2. Server validates credentials
   - Check password hash (bcrypt)
   - Check account not locked
   - Create session in database

3. Server responds with tokens
   - access_token (15min, JWT, in HttpOnly cookie)
   - refresh_token (30 days, JWT, in HttpOnly cookie)
   - csrf_token (in regular cookie for client access)

4. Client includes tokens on requests
   - Cookies sent automatically
   - X-CSRF-Token header for mutations

5. Token refresh
   POST /auth/refresh (uses refresh_token cookie)
   - Returns new access_token
   - Rotates refresh_token

6. Session management
   - Sessions tracked in database
   - Automatic cleanup of expired sessions
   - Can revoke all sessions on password change
```

### Encryption Approach

**Philosophy:** Encrypt all PHI at the application layer before database storage.

```
Master Key (env var)
       │
       ▼
   ┌────────────────┐
   │ Derive user    │
   │ encryption key │◄──── User salt (per-user, stored in DB)
   └────────────────┘
       │
       ▼
   ┌────────────────┐
   │ AES-256-GCM    │
   │ Encrypt/Decrypt│
   └────────────────┘
       │
       ▼
   Encrypted field stored in PostgreSQL
```

**Key Features:**
- AES-256-GCM encryption (authenticated encryption)
- Per-user salts for key derivation
- IV randomly generated for each encryption
- Fields: `valueEncrypted`, `notesEncrypted`, `genotypeEncrypted`, etc.
- Audit log values also encrypted

---

## 4. Code Quality

### Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| Backend Unit Tests | 0 | ⚠️ Not yet implemented |
| Frontend Unit Tests | 7 | ✅ All passing |
| **Total** | **7** | ⚠️ |

> **Note:** Test coverage is a known gap. Backend test suite is planned for ThoughtBot engagement. Priority areas for testing include encryption/decryption, authentication flows, and cascade delete behavior.

**Frontend Tests (7 total):**
- AuthContext.test.tsx
- useAuth.test.ts
- Button.test.tsx
- LoginPage.test.tsx
- Dashboard.test.tsx
- BiomarkerSummary.test.tsx
- AddMeasurementModal.test.tsx

**Backend Tests Needed (ThoughtBot scope):**
- Encryption/decryption round-trip
- Authentication flows (login, register, logout, refresh)
- Biomarker CRUD operations
- DNA parsing and storage
- PDF parsing
- Audit logging
- Cascade delete verification
- Input validation

### Lint Status

```
Frontend ESLint: 0 errors, 0 warnings
Backend ESLint:  0 errors, 0 warnings
```

### TypeScript

- **Strict mode enabled** in both frontend and backend
- **No `any` types** in production code (only test mocks)
- **Full type coverage** on all API requests/responses
- **Zod schemas** for runtime validation

### Code Organization

- **Controllers** - Thin, handle HTTP concerns only
- **Services** - Business logic, reusable
- **Middleware** - Auth, validation, error handling, CSRF
- **Utils** - Pure functions, well-tested

---

## 5. What Needs to Be Built

### High Priority (Before Production)

#### 1. Email Integration
```
Required for:
- Email verification on registration
- Password reset flow
- (Future) Appointment reminders

Recommendation:
- SendGrid or AWS SES
- Transactional email templates
- Email verification endpoint already exists: POST /auth/verify-email
```

**Schema already has:**
- `emailVerified` boolean
- `emailVerificationToken`
- `emailVerificationExpires`
- `passwordResetToken`
- `passwordResetExpires`

#### 2. Production Deployment Setup
```
Required:
- Docker containerization
- Environment-specific configs
- SSL/TLS termination
- HIPAA-compliant hosting (see Section 6)
```

#### 3. Cloud File Storage
```
Current: Files processed in memory, not persisted
Required:
- S3 or equivalent for uploaded PDFs, DNA files
- Encryption at rest
- Signed URLs for access
- Retention policies
```

#### 4. Error Monitoring
```
Recommended:
- Sentry or Datadog
- Error tracking
- Performance monitoring
- Uptime alerts
```

### Medium Priority

#### 5. Rate Limiting (Partially Done)
```
express-rate-limit is installed but needs:
- Redis for distributed rate limiting
- Per-endpoint limits
- IP-based and user-based limits
```

#### 6. Provider Directory Integration
```
Current: Mock data
Required:
- Real provider data source (CMS NPPES?)
- Insurance network lookup
- Appointment booking integration (future)
```

#### 7. Mobile Responsiveness
```
Current: Desktop-first
Required: Full mobile support for all views
```

### Lower Priority (Post-MVP)

- Push notifications
- Provider portal
- Data export (PDF reports)
- Multi-language support
- Advanced search

---

## 6. Deployment Requirements

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/ownmyhealth

# Encryption (CRITICAL - 64 hex chars)
ENCRYPTION_KEY=your-256-bit-hex-key-here

# JWT
JWT_SECRET=your-jwt-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars

# Server
PORT=3001
NODE_ENV=production
CORS_ORIGIN=https://app.ownmyhealth.com

# (Future) Email
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
FROM_EMAIL=noreply@ownmyhealth.com

# (Future) File Storage
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_S3_BUCKET=ownmyhealth-files
AWS_REGION=us-east-1
```

### Database Setup

```bash
# 1. Create PostgreSQL database
createdb ownmyhealth

# 2. Run Prisma migrations
cd backend
npx prisma migrate deploy

# 3. Generate Prisma client
npx prisma generate
```

### Third-Party Services Required

| Service | Purpose | HIPAA Requirement |
|---------|---------|-------------------|
| **PostgreSQL** | Primary database | BAA required |
| **Email (SendGrid/SES)** | Transactional email | BAA required |
| **S3 or equivalent** | File storage | BAA required, encryption at rest |
| **Hosting (AWS/GCP)** | Application hosting | HIPAA-eligible services only |
| **Sentry** | Error monitoring | BAA available |

### HIPAA Hosting Requirements

```
AWS HIPAA-Eligible Services:
- EC2 (dedicated or VPC)
- RDS PostgreSQL
- S3 (encryption enabled)
- ELB/ALB
- CloudWatch

OR

GCP HIPAA-Eligible:
- Compute Engine
- Cloud SQL
- Cloud Storage
- Cloud Load Balancing
```

**Required for HIPAA:**
1. Business Associate Agreement (BAA) with cloud provider
2. Encryption in transit (TLS 1.2+)
3. Encryption at rest (database, files)
4. Audit logging (✅ already implemented)
5. Access controls (✅ already implemented)
6. Backup and disaster recovery plan

---

## 7. Business Context

### MVP Priorities

**Must Have for Launch:**
1. User registration with email verification
2. Biomarker tracking (manual + PDF upload)
3. Basic insurance plan upload and parsing
4. Health score and simple recommendations
5. Secure, HIPAA-compliant hosting

**Nice to Have:**
1. DNA upload and analysis
2. Provider directory
3. Health goals
4. Mobile app

### Launch States

Initial launch targeting three states with high osteoporosis prevalence:

1. **Florida** - Large senior population
2. **California** - Health-conscious demographic
3. **New York** - Dense healthcare market

No state-specific regulatory requirements beyond HIPAA for these states.

### Pricing Model

```
Target: $15-25/month subscription

Potential Tiers:
- Basic ($15/mo): Biomarker tracking, lab uploads, basic insights
- Premium ($25/mo): DNA analysis, insurance navigation, provider recommendations

Considerations:
- Free trial period (14 days?)
- Annual discount
- Family plans (future)
```

### Success Metrics

- User registration rate
- Lab report uploads per user
- Weekly active users
- Health goal completion rate
- Time spent in app

---

## Quick Start for Developers

```bash
# Clone and setup
git clone <repo>
cd OwnMyHealth

# Frontend
npm install
npm run dev                 # Runs on localhost:5173

# Backend (in separate terminal)
cd backend
npm install
cp .env.example .env        # Configure environment
npx prisma migrate dev      # Setup database
npm run dev                 # Runs on localhost:3001

# Run tests
npm test                    # Frontend tests
cd backend && npm test      # Backend tests
```

### Demo Login

```
Email: demo@ownmyhealth.com
Password: Demo123!

OR use POST /api/v1/auth/demo for automatic demo login
```

---

## Questions?

For technical questions about this codebase, please refer to:
- Inline code comments
- Test files (excellent examples of expected behavior)
- This document

For business questions, contact the product owner.
