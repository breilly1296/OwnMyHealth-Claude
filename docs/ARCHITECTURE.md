# OwnMyHealth Architecture

This document describes the technical architecture of the OwnMyHealth platform.

## System Overview

OwnMyHealth follows a modern full-stack architecture with a clear separation between frontend and backend concerns:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Browser                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    React SPA (Vite)                       │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │  │
│  │  │ Auth    │  │Biomarker│  │Insurance│  │ DNA/Health  │  │  │
│  │  │Context  │  │ Module  │  │ Module  │  │   Module    │  │  │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └──────┬──────┘  │  │
│  │       │            │            │              │          │  │
│  │       └────────────┴─────┬──────┴──────────────┘          │  │
│  │                          │                                 │  │
│  │                    ┌─────┴─────┐                          │  │
│  │                    │ API Layer │                          │  │
│  │                    │ (api.ts)  │                          │  │
│  │                    └─────┬─────┘                          │  │
│  └──────────────────────────┼────────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────┘
                              │ HTTPS + httpOnly Cookies
┌─────────────────────────────┼───────────────────────────────────┐
│                    Express.js API Server                        │
│  ┌──────────────────────────┴────────────────────────────────┐  │
│  │                      Middleware Stack                      │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │  │
│  │  │ CORS   │ │ Helmet │ │  Rate  │ │  Auth  │ │ Valid- │  │  │
│  │  │        │ │        │ │ Limit  │ │  JWT   │ │ ation  │  │  │
│  │  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘  │  │
│  └──────┼──────────┼──────────┼──────────┼──────────┼────────┘  │
│         └──────────┴──────────┴────┬─────┴──────────┘           │
│  ┌─────────────────────────────────┴─────────────────────────┐  │
│  │                        Controllers                         │  │
│  │  ┌─────┐ ┌─────────┐ ┌─────────┐ ┌─────┐ ┌─────────────┐  │  │
│  │  │Auth │ │Biomarker│ │Insurance│ │ DNA │ │Health/Goals │  │  │
│  │  └──┬──┘ └────┬────┘ └────┬────┘ └──┬──┘ └──────┬──────┘  │  │
│  └─────┼─────────┼───────────┼─────────┼───────────┼─────────┘  │
│        └─────────┴───────────┴────┬────┴───────────┘            │
│  ┌────────────────────────────────┴──────────────────────────┐  │
│  │                         Services                           │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │Encryption│ │AuditLog  │ │PDFParser │ │HealthAnalysis│  │  │
│  │  └─────┬────┘ └─────┬────┘ └─────┬────┘ └───────┬──────┘  │  │
│  └────────┼────────────┼────────────┼──────────────┼─────────┘  │
│           └────────────┴─────┬──────┴──────────────┘            │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                      Prisma ORM                            │  │
│  └───────────────────────────┬───────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                      PostgreSQL Database                         │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐   │
│  │   Users   │ │ Biomarker │ │ Insurance │ │   DNA Data    │   │
│  │ + Sessions│ │  + History│ │  + Benefits│ │  + Variants   │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Frontend Architecture

### Technology Stack
- **React 18.3**: Component-based UI framework
- **TypeScript 5.5**: Type-safe JavaScript
- **Vite 5.4**: Fast build tool and dev server
- **Tailwind CSS 3.4**: Utility-first CSS framework

### State Management
- **AuthContext**: Global authentication state (user, tokens, login/logout)
- **Component State**: Local state for UI and data fetching
- **No Redux/Zustand**: PHI data fetched on-demand, not persisted

### Module Organization

```
src/
├── components/           # Feature-based component modules
│   ├── analytics/       # Health analytics dashboard
│   ├── auth/            # Authentication pages
│   ├── biomarkers/      # Biomarker CRUD and visualization
│   ├── common/          # Shared/reusable components
│   ├── dashboard/       # Main dashboard and navigation
│   ├── dna/             # DNA upload and analysis
│   ├── health/          # Health insights and providers
│   ├── insurance/       # Insurance plan management
│   └── upload/          # File upload components
├── contexts/            # React Context providers
├── hooks/               # Custom React hooks
│   ├── useApi.ts       # API request wrapper
│   └── useRBAC.ts      # Role-based access control
├── services/            # API client and utilities
│   └── api.ts          # Central API client (38KB)
├── types/               # TypeScript interfaces
└── utils/               # Business logic utilities
    ├── ai/             # AI-powered health analysis
    ├── biomarkers/     # Lab report parsing
    ├── dna/            # DNA file parsing
    ├── health/         # Health needs analysis
    └── insurance/      # SBC parsing
```

### Component Hierarchy

```
App.tsx
└── AuthProvider
    └── AppContent
        ├── LoginPage (unauthenticated)
        ├── RegisterPage (registering)
        └── Dashboard (authenticated)
            ├── Sidebar (navigation)
            └── Main Content
                ├── Overview Tab
                │   ├── HealthAnalyticsDashboard
                │   └── GoalTrackerPanel
                ├── Insights Tab
                │   ├── AIInsightsPanel
                │   └── HealthNeedsPanel
                ├── Insurance Tab
                │   ├── InsuranceHub
                │   └── InsuranceKnowledgeBase
                └── Biomarkers Tab
                    ├── BiomarkerSummary
                    └── BiomarkerChart
```

### Data Flow Pattern

```
User Action → Component → api.ts → Backend API
                  ↓
            Update State
                  ↓
            Re-render UI
```

## Backend Architecture

### Technology Stack
- **Express.js 4.18**: Web application framework
- **TypeScript 5.3**: Type-safe Node.js
- **Prisma 7.0**: ORM for PostgreSQL
- **Zod 3.22**: Runtime validation

### Layered Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Routes Layer                        │
│  Define endpoints, attach middleware, call controllers   │
├─────────────────────────────────────────────────────────┤
│                    Controllers Layer                     │
│  Handle requests, validate input, orchestrate services   │
├─────────────────────────────────────────────────────────┤
│                     Services Layer                       │
│  Business logic, encryption, parsing, external APIs      │
├─────────────────────────────────────────────────────────┤
│                    Data Access Layer                     │
│  Prisma ORM, database queries, transactions              │
└─────────────────────────────────────────────────────────┘
```

### Middleware Pipeline

```
Request → CORS → Helmet → Morgan → Rate Limit → Auth → Validation → Controller
                                                  ↓
Response ← Error Handler ← Controller Result ←────┘
```

### Key Services

| Service | Purpose |
|---------|---------|
| `authService.ts` | JWT tokens, password hashing, sessions |
| `encryption.ts` | AES-256-GCM encryption for PHI |
| `auditLog.ts` | HIPAA compliance audit trail |
| `pdfParser.ts` | Extract biomarkers from lab PDFs |
| `dnaParser.ts` | Parse DNA files (23andMe, etc.) |
| `healthAnalysisService.ts` | Health risk analysis |

## Database Architecture

### Schema Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│      User       │────<│    Biomarker     │     │  InsurancePlan  │
│                 │     │                  │     │                 │
│ - id            │     │ - id             │     │ - id            │
│ - email         │     │ - userId (FK)    │     │ - userId (FK)   │
│ - passwordHash  │     │ - name           │     │ - planName      │
│ - role          │     │ - valueEncrypted │     │ - planType      │
│ - *Encrypted    │     │ - normalRange    │     │ - premium       │
└────────┬────────┘     │ - date           │     │ - deductible    │
         │              └──────────────────┘     └─────────────────┘
         │
         │              ┌──────────────────┐     ┌─────────────────┐
         │              │     DNAData      │────<│   DNAVariant    │
         ├─────────────<│                  │     │                 │
         │              │ - id             │     │ - rsid          │
         │              │ - userId (FK)    │     │ - genotype*     │
         │              │ - fileName       │     │ - chromosome    │
         │              │ - status         │     │ - riskLevel     │
         │              └──────────────────┘     └─────────────────┘
         │
         │              ┌──────────────────┐     ┌─────────────────┐
         ├─────────────<│   HealthGoal     │     │   HealthNeed    │
         │              │                  │     │                 │
         │              │ - id             │     │ - id            │
         │              │ - userId (FK)    │     │ - userId (FK)   │
         │              │ - title          │     │ - name          │
         │              │ - targetValue    │     │ - urgency       │
         │              │ - status         │     │ - status        │
         │              └──────────────────┘     └─────────────────┘
         │
         └─────────────<┌──────────────────┐
                        │    AuditLog      │
                        │                  │
                        │ - id             │
                        │ - userId (FK)    │
                        │ - action         │
                        │ - resourceType   │
                        │ - timestamp      │
                        └──────────────────┘
```

### Encrypted Fields (PHI)

All Protected Health Information is encrypted at the application layer:

| Model | Encrypted Fields |
|-------|------------------|
| User | firstName, lastName, dateOfBirth, phone, address |
| Biomarker | value, notes |
| InsurancePlan | memberId |
| DNAVariant | genotype, description |

### Indexes

Compound indexes for common query patterns:
- `Biomarker(userId, isOutOfRange)`
- `Biomarker(userId, createdAt)`
- `Biomarker(userId, sourceType)`

## Security Architecture

### Authentication Flow

```
┌─────────┐     POST /auth/login      ┌─────────┐
│ Client  │────────────────────────→  │ Backend │
│         │  { email, password }      │         │
│         │                           │         │
│         │  ←────────────────────────│         │
│         │  Set-Cookie: accessToken  │         │
│         │  Set-Cookie: refreshToken │         │
└─────────┘                           └─────────┘

Subsequent requests:
┌─────────┐     GET /api/biomarkers   ┌─────────┐
│ Client  │────────────────────────→  │ Backend │
│         │  Cookie: accessToken      │         │
│         │                           │         │
│         │  ←────────────────────────│         │
│         │  { data: [...] }          │         │
└─────────┘                           └─────────┘
```

### Token Security

| Property | Access Token | Refresh Token |
|----------|--------------|---------------|
| Duration | 15 minutes | 7 days |
| Storage | httpOnly cookie | httpOnly cookie |
| SameSite | Strict/Lax | Strict/Lax |
| Secure | Yes (production) | Yes (production) |

### Role-Based Access Control (RBAC)

```
Roles: PATIENT < PROVIDER < ADMIN

PATIENT:
  - Own data CRUD
  - Grant provider access

PROVIDER:
  - Own data CRUD
  - Read patient data (with consent)
  - Cannot modify patient data

ADMIN:
  - All PROVIDER permissions
  - User management
  - System configuration
  - Audit log access
```

### Data Protection Layers

```
┌───────────────────────────────────────────────────────────┐
│ Layer 1: Transport Security (HTTPS/TLS)                   │
├───────────────────────────────────────────────────────────┤
│ Layer 2: Application Security (Auth, RBAC, Input Valid.)  │
├───────────────────────────────────────────────────────────┤
│ Layer 3: Data Encryption (AES-256-GCM for PHI)           │
├───────────────────────────────────────────────────────────┤
│ Layer 4: Database Security (Connection pooling, RLS)      │
└───────────────────────────────────────────────────────────┘
```

## API Design

### RESTful Conventions

```
GET    /api/v1/biomarkers          # List biomarkers
POST   /api/v1/biomarkers          # Create biomarker
GET    /api/v1/biomarkers/:id      # Get single biomarker
PATCH  /api/v1/biomarkers/:id      # Update biomarker
DELETE /api/v1/biomarkers/:id      # Delete biomarker
```

### Response Format

```json
// Success
{
  "success": true,
  "data": { ... }
}

// Error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [...]
  }
}
```

### Pagination

```json
GET /api/v1/biomarkers?page=1&limit=20

{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

## Error Handling

### Frontend Error Flow

```
API Error → api.ts catches → Transforms to user-friendly message
                                        ↓
                          Component displays error UI
```

### Backend Error Flow

```
Controller throws → errorHandler middleware catches
                             ↓
            Logs error (sanitized for PHI)
                             ↓
            Returns appropriate HTTP status + message
```

### Error Types

| HTTP Status | Error Type | Description |
|-------------|------------|-------------|
| 400 | ValidationError | Invalid input data |
| 401 | UnauthorizedError | Authentication required |
| 403 | ForbiddenError | Insufficient permissions |
| 404 | NotFoundError | Resource not found |
| 429 | RateLimitError | Too many requests |
| 500 | InternalError | Server error |

## Deployment Architecture

### Development

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Vite Dev       │────>│  Express Dev    │────>│  PostgreSQL     │
│  localhost:5173 │     │  localhost:3001 │     │  localhost:5432 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Production

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   CDN/Static    │────>│  Express Prod   │────>│  PostgreSQL     │
│   (dist/)       │     │  (Railway/etc)  │     │  (Managed)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Performance Considerations

### Frontend
- Code splitting via dynamic imports
- Lazy loading of heavy components
- Memoization of expensive calculations
- Virtualized lists for large datasets

### Backend
- Database connection pooling (Prisma)
- Batch processing for bulk operations
- Rate limiting to prevent abuse
- Parallel database queries where possible

### Database
- Compound indexes for common queries
- Pagination for large result sets
- Query optimization with Prisma

## Testing Strategy

### Frontend Testing
- **Unit Tests**: Vitest + React Testing Library
- **Component Tests**: Isolated component behavior
- **Integration Tests**: Context and API mocking

### Backend Testing
- **Unit Tests**: Vitest for service logic
- **Integration Tests**: Supertest for API endpoints
- **Database Tests**: Test database with transactions

### Test Coverage Goals
- Critical paths: 80%+
- Business logic: 90%+
- Edge cases: Document and test

## Monitoring & Observability

### Logging
- Structured logging (JSON format)
- PHI sanitization in logs
- Request/response logging (Morgan)

### Audit Trail
- All data access logged
- User actions tracked
- Compliance reporting ready

### Health Checks
- Database connectivity
- Service availability
- Resource utilization
