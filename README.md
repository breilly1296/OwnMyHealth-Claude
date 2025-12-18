# OwnMyHealth

A privacy-first, HIPAA-compliant osteoporosis management platform that empowers patients to track health biomarkers, navigate insurance coverage, and make informed healthcare decisions.

## Project Overview

OwnMyHealth bridges the gap between health data and insurance navigation for patients with chronic conditions, specifically targeting osteoporosis management. The platform enables users to:

- **Track Biomarkers** - Upload lab reports (PDF) or manually enter results; monitor bone density, vitamin D, calcium, and other key metrics over time
- **Navigate Insurance** - Parse Summary of Benefits (SBC) documents, search Healthcare.gov Marketplace plans, understand coverage for specific treatments
- **Analyze Genetics** - Import 23andMe/AncestryDNA files for trait analysis and health risk insights
- **Get Actionable Insights** - AI-powered health scoring, provider recommendations, and personalized action items

## Current Status

**Production-Ready** with core features complete:

| Component | Status |
|-----------|--------|
| User Authentication | Complete (JWT, CSRF, session management) |
| Biomarker Management | Complete (CRUD, history, trends, PDF parsing) |
| Insurance Navigation | Complete (SBC parsing, plan comparison) |
| CMS Marketplace API | Integrated (Healthcare.gov plan search) |
| DNA Analysis | Complete (23andMe format, trait interpretation) |
| PHI Encryption | Complete (AES-256-GCM, per-user keys) |
| Audit Logging | Complete (HIPAA-compliant, 7-year retention) |
| Health Goals | Complete (tracking, milestones, progress) |

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3 | UI framework |
| TypeScript | 5.5 | Type safety |
| Vite | 5.4 | Build tooling |
| Tailwind CSS | 3.4 | Styling |
| Chart.js / Recharts | - | Data visualization |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Express.js | 4.18 | Web framework |
| TypeScript | 5.3 | Type safety |
| Prisma | 7.0 | ORM |
| PostgreSQL | - | Database |
| Zod | 3.22 | Runtime validation |

### Security
| Technology | Purpose |
|------------|---------|
| AES-256-GCM | PHI encryption at rest |
| bcryptjs | Password hashing (12 rounds) |
| JWT | Access/refresh token authentication |
| Helmet | HTTP security headers |
| express-rate-limit | Brute force protection |

## Security Features

### Implemented

- **PHI Encryption** - All Protected Health Information encrypted with AES-256-GCM using per-user derived keys
- **Audit Logging** - Every PHI access logged with user, action, timestamp, and IP address (HIPAA-compliant)
- **Rate Limiting** - 100 requests/15min globally, 5/min on auth endpoints
- **Authentication** - JWT tokens in httpOnly cookies with 15-min access / 7-day refresh rotation
- **Account Protection** - Lockout after 5 failed attempts, bcrypt password hashing
- **Input Validation** - Zod schemas for all API endpoints
- **CORS Protection** - Restricted to configured origins
- **RBAC** - Role-based access control (Patient, Provider, Admin)
- **CSRF Protection** - Token validation on state-changing requests
- **SQL Injection Prevention** - Parameterized queries via Prisma ORM

### Production Validation

The backend enforces security on startup:
- Rejects default/placeholder secrets
- Validates JWT secret length (32+ chars)
- Validates PHI encryption key format (64 hex chars)
- Warns on insecure CORS configurations

## Architecture

### Data Protection Strategy

The platform uses field-level encryption for PHI separation:

```
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                       │
├─────────────────────────────────────────────────────────────┤
│  Public Data              │  PHI (Encrypted at App Layer)   │
│  ─────────────────        │  ──────────────────────────────  │
│  • email                  │  • firstNameEncrypted            │
│  • role                   │  • lastNameEncrypted             │
│  • createdAt              │  • dateOfBirthEncrypted          │
│  • planType               │  • biomarker valueEncrypted      │
│  • metalLevel             │  • DNA genotypeEncrypted         │
│  • deductible             │  • insurance memberIdEncrypted   │
└─────────────────────────────────────────────────────────────┘
```

### System Architecture

```
┌─────────────────┐     HTTPS      ┌─────────────────┐
│   React SPA     │ ◄────────────► │  Express API    │
│   (Vite)        │   httpOnly     │  (Node.js)      │
│   Port 5173     │   Cookies      │  Port 3001      │
└─────────────────┘                └────────┬────────┘
                                           │
                           ┌───────────────┼───────────────┐
                           │               │               │
                           ▼               ▼               ▼
                    ┌──────────┐    ┌──────────┐    ┌──────────┐
                    │ Prisma   │    │ CMS API  │    │ SendGrid │
                    │ + PG     │    │ (Plans)  │    │ (Email)  │
                    └──────────┘    └──────────┘    └──────────┘
```

## Launch States

Initial launch targeting Healthcare.gov Marketplace states:

| State | Code | Notes |
|-------|------|-------|
| Florida | FL | Large senior population |
| Texas | TX | High osteoporosis prevalence |
| Georgia | GA | Growing healthcare market |
| North Carolina | NC | Dense specialist network |

CMS Marketplace API integration enables real-time plan search for these FFM (Federally Facilitated Marketplace) states.

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Installation

```bash
# Clone repository
git clone https://github.com/breilly1296/OwnMyHealth.git
cd OwnMyHealth

# Install frontend dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials and secrets

# Setup database
npx prisma generate
npx prisma db push

# Start development servers
npm run dev          # Backend (Terminal 1)
cd .. && npm run dev # Frontend (Terminal 2)
```

### Environment Variables

**Required for production:**

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/ownmyhealth

# Generate with: openssl rand -base64 32
JWT_ACCESS_SECRET=<your-32-char-min-secret>
JWT_REFRESH_SECRET=<your-32-char-min-secret>

# Generate with: openssl rand -hex 32
PHI_ENCRYPTION_KEY=<64-hex-char-key>

CORS_ORIGIN=https://yourdomain.com
```

**Optional integrations:**

```env
CMS_API_KEY=<healthcare.gov-api-key>
SENDGRID_API_KEY=<sendgrid-api-key>
```

### Demo Login

```
Email: demo@ownmyhealth.com
Password: Demo123!
```

Or use `POST /api/v1/auth/demo` for automatic demo authentication.

## Project Structure

```
OwnMyHealth/
├── src/                          # Frontend React application
│   ├── components/
│   │   ├── auth/                 # Login, registration
│   │   ├── biomarker/            # Biomarker panels, trends
│   │   ├── dashboard/            # Main dashboard views
│   │   ├── dna/                  # DNA analysis panels
│   │   ├── health/               # Health insights, recommendations
│   │   ├── insurance/            # Insurance hub, plan comparison
│   │   │   ├── MarketplacePlanSearch.tsx   # CMS API integration
│   │   │   └── InsuranceHub.tsx            # Main insurance UI
│   │   └── common/               # Shared components
│   ├── contexts/                 # React contexts (Auth)
│   ├── hooks/                    # Custom hooks (useApi, useRBAC)
│   ├── services/                 # API client
│   └── utils/                    # Utilities (parsing, analysis)
│
├── backend/
│   ├── src/
│   │   ├── controllers/          # Request handlers
│   │   ├── routes/               # API endpoint definitions
│   │   ├── middleware/           # Auth, validation, rate limiting
│   │   ├── services/
│   │   │   ├── authService.ts    # JWT, sessions, passwords
│   │   │   ├── encryption.ts     # AES-256-GCM PHI encryption
│   │   │   ├── auditLog.ts       # HIPAA audit trail
│   │   │   └── cmsMarketplaceService.ts  # Healthcare.gov API
│   │   └── config/               # Environment configuration
│   └── prisma/
│       └── schema.prisma         # Database schema
│
├── docs/                         # Documentation
│   ├── ARCHITECTURE.md           # System architecture
│   ├── SECURITY_HARDENING.md     # Production security guide
│   ├── API.md                    # API reference
│   └── DEVELOPMENT.md            # Developer guide
│
└── CLAUDE.md                     # AI assistant context
```

## API Reference

Base URL: `/api/v1`

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/auth/*` | POST | Authentication (login, register, logout, refresh) |
| `/biomarkers` | GET, POST | Biomarker management |
| `/biomarkers/:id` | GET, PUT, DELETE | Single biomarker operations |
| `/insurance/plans` | GET, POST | Insurance plan management |
| `/marketplace/plans/search` | POST | CMS Marketplace plan search |
| `/marketplace/counties/:zip` | GET | County/FIPS lookup by ZIP |
| `/dna` | GET, POST | DNA file upload and analysis |
| `/health/analysis` | GET | Full health analysis |
| `/health/needs` | GET | Identified health needs |
| `/health-goals` | GET, POST | Health goal tracking |

See [docs/API.md](docs/API.md) for complete API documentation.

## Scripts

**Frontend:**
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm test             # Run tests
npm run lint         # Lint code
```

**Backend:**
```bash
npm run dev          # Start with hot reload
npm run build        # Compile TypeScript
npm test             # Run tests
npx prisma studio    # Database GUI
```

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Security Hardening Guide](docs/SECURITY_HARDENING.md)
- [API Reference](docs/API.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Deployment Guide](DEPLOY.md)

## License

This project is private and proprietary.

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/breilly1296/OwnMyHealth/issues) page.
