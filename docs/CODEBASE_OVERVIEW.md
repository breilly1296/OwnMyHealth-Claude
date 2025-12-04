# OwnMyHealth Codebase Overview

**Last Updated:** 2025-11-26
**Version:** 1.0.0
**Purpose:** Personal health data management platform with HIPAA-compliant PHI handling

---

## 1. PROJECT STRUCTURE

```
OwnMYHealth/
├── src/                          # Frontend React application
│   ├── components/
│   │   ├── auth/                 # Login, Register components
│   │   ├── biomarker/            # Biomarker panels, trends, history
│   │   ├── common/               # Shared components (Modal, ErrorBoundary, UploadZone, RoleGuard)
│   │   ├── dashboard/            # Main dashboard, nav, health score
│   │   ├── dna/                  # DNA analysis panels
│   │   ├── health/               # Health recommendations
│   │   ├── insurance/            # Insurance hub, plans, comparison, SBC upload
│   │   └── upload/               # PDF upload modals
│   ├── contexts/                 # React contexts (AuthContext, etc.)
│   ├── hooks/                    # Custom React hooks (useRBAC, etc.)
│   ├── services/                 # API client services
│   ├── types/                    # TypeScript type definitions
│   └── utils/                    # Utility functions
├── backend/
│   ├── src/
│   │   ├── config/               # Configuration files (env, constants)
│   │   ├── controllers/          # Request handlers (auth, biomarker, insurance, etc.)
│   │   ├── middleware/           # Express middleware (auth, validation, RBAC)
│   │   ├── routes/               # API route definitions
│   │   ├── services/             # Business logic (database, encryption, audit)
│   │   ├── types/                # TypeScript interfaces
│   │   └── generated/            # Prisma generated client
│   └── prisma/
│       ├── schema.prisma         # Database schema definition
│       └── migrations/           # Database migration files
├── public/                       # Static assets
└── dist/                         # Build output (generated)
```

---

## 2. TECH STACK

### Frontend

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| **Framework** | React | 18.3.1 | UI framework |
| **Language** | TypeScript | 5.5.3 | Type safety |
| **Build Tool** | Vite | 5.4.2 | Fast dev server & bundler |
| **Styling** | Tailwind CSS | 3.4.1 | Utility-first CSS |
| **Icons** | Lucide React | 0.344.0 | Icon library |
| **Charts** | Chart.js | 4.4.2 | Data visualization |
| | Recharts | 3.5.0 | React chart library |
| **PDF** | jsPDF | 2.5.2 | PDF generation |
| | pdfjs-dist | 4.0.379 | PDF parsing |
| **OCR** | Tesseract.js | 5.0.4 | Text extraction from images |
| **HTTP** | Fetch API | Native | API requests |

### Backend

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| **Runtime** | Node.js | ≥18.0.0 | JavaScript runtime |
| **Framework** | Express | 4.18.2 | Web server framework |
| **Language** | TypeScript | 5.3.2 | Type safety |
| **Database** | PostgreSQL | (external) | Primary database |
| **ORM** | Prisma | 7.0.1 | Database toolkit |
| **Auth** | JWT | 9.0.2 | Token-based auth |
| | bcryptjs | 2.4.3 | Password hashing |
| **Validation** | Zod | 3.22.4 | Schema validation |
| | Express Validator | 7.0.1 | Request validation |
| **Security** | Helmet | 7.1.0 | HTTP headers |
| | CORS | 2.8.5 | Cross-origin requests |
| | Rate Limiter | 7.1.5 | Brute force protection |
| **Logging** | Morgan | 1.10.0 | HTTP request logging |
| **DevTools** | tsx | 4.6.2 | TypeScript execution |

### Database

- **PostgreSQL** with Prisma ORM
- **Extensions:** pgcrypto, uuid_ossp
- **Adapter:** @prisma/adapter-pg for connection pooling

---

## 3. DATABASE SCHEMA

### Core Tables

#### Users & Authentication

| Table | Columns | Purpose |
|-------|---------|---------|
| **users** | id, email, passwordHash, role, firstNameEncrypted*, lastNameEncrypted*, dateOfBirthEncrypted*, phoneEncrypted*, addressEncrypted*, emailVerified, isActive, createdAt, updatedAt, lastLoginAt | User accounts with encrypted PHI |
| **sessions** | id, userId, token, ipAddress, userAgent, expiresAt, createdAt | Active user sessions |
| **user_encryption_keys** | id, userId, keyType, keyHash, encryptedKey, version, isActive, createdAt, rotatedAt | Per-user encryption keys |

**Enums:** `UserRole` (PATIENT, PROVIDER, ADMIN)

#### Provider-Patient Relationships

| Table | Columns | Purpose |
|-------|---------|---------|
| **provider_patients** | id, providerId, patientId, canViewBiomarkers, canViewInsurance, canViewDna, canViewHealthNeeds, canEditData, relationshipType, status, consentGrantedAt, consentExpiresAt, notesEncrypted*, createdAt, updatedAt | RBAC for provider access to patient data |

**Enums:**
- `ProviderRelationType` (PRIMARY_CARE, SPECIALIST, CONSULTANT, EMERGENCY, OTHER)
- `ProviderPatientStatus` (PENDING, ACTIVE, SUSPENDED, REVOKED, EXPIRED)

#### Health Data

| Table | Columns | Purpose |
|-------|---------|---------|
| **biomarkers** | id, userId, category, name, unit, valueEncrypted*, notesEncrypted*, normalRangeMin, normalRangeMax, measurementDate, sourceType, sourceFile, extractionConfidence, labName, isOutOfRange, isAcknowledged, createdAt, updatedAt | Lab test results |
| **biomarker_history** | id, biomarkerId, valueEncrypted*, measurementDate, createdAt | Historical biomarker values |
| **health_needs** | id, userId, needType, name, descriptionEncrypted*, urgency, status, relatedBiomarkerIds[], createdAt, updatedAt, resolvedAt | AI-generated health action items |

**Enums:**
- `DataSourceType` (MANUAL, LAB_UPLOAD, EHR_IMPORT, DEVICE_SYNC, API_IMPORT)
- `HealthNeedType` (CONDITION, ACTION, SERVICE, FOLLOW_UP)
- `Urgency` (IMMEDIATE, URGENT, FOLLOW_UP, ROUTINE)
- `HealthNeedStatus` (PENDING, IN_PROGRESS, COMPLETED, DISMISSED)

#### Insurance

| Table | Columns | Purpose |
|-------|---------|---------|
| **insurance_plans** | id, userId, planName, insurerName, planType, memberIdEncrypted*, groupIdEncrypted*, effectiveDate, terminationDate, premiumMonthly, deductibleIndividual, deductibleFamily, oopMaxIndividual, oopMaxFamily, isActive, isPrimary, createdAt, updatedAt | User's insurance plans |
| **insurance_benefits** | id, planId, serviceName, serviceCategory, inNetworkCovered, inNetworkCopay, inNetworkCoinsurance, inNetworkDeductible, outNetworkCovered, outNetworkCopay, outNetworkCoinsurance, outNetworkDeductible, limitations, preAuthRequired, createdAt | Detailed benefit coverage |

**Enums:** `PlanType` (HMO, PPO, EPO, POS, HDHP)

#### Genetic Data

| Table | Columns | Purpose |
|-------|---------|---------|
| **dna_data** | id, userId, filename, source, uploadDate, totalVariants, validVariants, processingStatus, processedAt, createdAt | DNA upload metadata |
| **dna_variants** | id, dnaDataId, rsid, chromosome, position, genotypeEncrypted*, createdAt | Individual genetic variants |
| **genetic_traits** | id, dnaDataId, traitName, category, rsid, riskLevel, descriptionEncrypted*, recommendationsEncrypted*, citationCount, confidence, createdAt | Trait interpretations |

**Enums:**
- `ProcessingStatus` (PENDING, PROCESSING, COMPLETED, FAILED)
- `RiskLevel` (HIGH, MODERATE, LOW, PROTECTIVE, UNKNOWN)

#### Audit & System

| Table | Columns | Purpose |
|-------|---------|---------|
| **audit_logs** | id, userId, actorType, ipAddress, userAgent, sessionId, action, resourceType, resourceId, previousValueEncrypted*, newValueEncrypted*, metadata, success, errorMessage, createdAt | HIPAA-compliant audit trail |
| **system_config** | id, key, value, valueType, description, isEncrypted, createdAt, updatedAt, updatedBy | System configuration |

**Enums:**
- `ActorType` (USER, SYSTEM, API, ADMIN, ANONYMOUS)
- `AuditAction` (LOGIN, LOGOUT, READ, CREATE, UPDATE, DELETE, EXPORT, PHI_ACCESS, etc.)

**Note:** Fields marked with * are encrypted at the application layer using AES-256-GCM

### Relationships

```
User (1) ──→ (N) Biomarkers
User (1) ──→ (N) InsurancePlans
User (1) ──→ (N) DNAData
User (1) ──→ (N) HealthNeeds
User (1) ──→ (N) Sessions
User (1) ──→ (N) AuditLogs
User (1) ──→ (N) UserEncryptionKeys

InsurancePlan (1) ──→ (N) InsuranceBenefits
DNAData (1) ──→ (N) DNAVariants
DNAData (1) ──→ (N) GeneticTraits
Biomarker (1) ──→ (N) BiomarkerHistory

Provider ←──(N:M)──→ Patient (via provider_patients)
```

---

## 4. API ENDPOINTS

**Base URL:** `/api/v1`

### Authentication (`/auth`)

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/auth/register` | Public | Create new user account |
| POST | `/auth/login` | Public | Login with email/password |
| POST | `/auth/refresh` | Public | Refresh access token |
| POST | `/auth/demo` | Public | Demo login (dev only) |
| POST | `/auth/logout` | Required | Logout current session |
| POST | `/auth/logout-all` | Required | Logout all sessions |
| GET | `/auth/me` | Required | Get current user info |
| POST | `/auth/change-password` | Required | Change password |

### Biomarkers (`/biomarkers`)

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/biomarkers` | Required | List all biomarkers (paginated) |
| GET | `/biomarkers/categories` | Required | Get biomarker categories |
| GET | `/biomarkers/:id` | Required | Get single biomarker |
| POST | `/biomarkers` | Required | Create biomarker |
| POST | `/biomarkers/bulk` | Required | Bulk create biomarkers |
| PUT | `/biomarkers/:id` | Required | Update biomarker |
| DELETE | `/biomarkers/:id` | Required | Delete biomarker |

### Health Analysis (`/health`)

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/health/analysis` | Required | Full health analysis |
| GET | `/health/needs` | Required | Get health needs |
| GET | `/health/providers` | Required | Provider recommendations |
| GET | `/health/score` | Required | Health score calculation |

### Insurance (`/insurance`)

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/insurance/plans` | Required | List all plans |
| GET | `/insurance/plans/:id` | Required | Get single plan |
| POST | `/insurance/plans` | Required | Create plan (SBC upload) |
| PUT | `/insurance/plans/:id` | Required | Update plan |
| DELETE | `/insurance/plans/:id` | Required | Delete plan |
| POST | `/insurance/compare` | Required | Compare multiple plans |
| GET | `/insurance/benefits/search` | Required | Search benefits |

### DNA/Genetics (`/dna`)

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/dna` | Required | List DNA uploads |
| GET | `/dna/:id` | Required | Get DNA upload details |
| GET | `/dna/:id/variants` | Required | Get genetic variants |
| GET | `/dna/:id/traits` | Required | Get trait analysis |
| POST | `/dna/upload` | Required | Upload DNA file |
| DELETE | `/dna/:id` | Required | Delete DNA upload |

### Health Needs (`/health-needs`)

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/health-needs` | Required | List all health needs |
| GET | `/health-needs/analyze` | Required | AI-powered analysis |
| GET | `/health-needs/:id` | Required | Get single need |
| POST | `/health-needs` | Required | Create health need |
| PATCH | `/health-needs/:id/status` | Required | Update status |
| DELETE | `/health-needs/:id` | Required | Delete health need |

### Provider Routes (`/provider`) - PROVIDER/ADMIN Role

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/provider/patients` | PROVIDER+ | List provider's patients |
| POST | `/provider/patients/request` | PROVIDER+ | Request patient access |
| GET | `/provider/patients/:id` | PROVIDER+ | Get patient details |
| GET | `/provider/patients/:id/biomarkers` | PROVIDER+ | Get patient biomarkers |
| GET | `/provider/patients/:id/health-needs` | PROVIDER+ | Get patient health needs |
| DELETE | `/provider/patients/:id` | PROVIDER+ | Remove relationship |

### Patient Routes (`/patient`) - PATIENT Role

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/patient/providers` | PATIENT | List all providers |
| GET | `/patient/providers/pending` | PATIENT | List pending requests |
| POST | `/patient/providers/:id/approve` | PATIENT | Approve provider access |
| POST | `/patient/providers/:id/deny` | PATIENT | Deny provider access |
| PATCH | `/patient/providers/:id` | PATIENT | Update permissions |
| POST | `/patient/providers/:id/revoke` | PATIENT | Revoke access |
| DELETE | `/patient/providers/:id` | PATIENT | Remove relationship |

### Admin Routes (`/admin`) - ADMIN Role

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/admin/users` | ADMIN | List all users (paginated) |
| GET | `/admin/users/:id` | ADMIN | Get user details |
| POST | `/admin/users` | ADMIN | Create user |
| PATCH | `/admin/users/:id` | ADMIN | Update user |
| DELETE | `/admin/users/:id` | ADMIN | Deactivate user |
| DELETE | `/admin/users/:id/permanent` | ADMIN | Permanently delete user |
| GET | `/admin/provider-relationships` | ADMIN | List all relationships |
| PATCH | `/admin/provider-relationships/:id` | ADMIN | Update relationship |
| GET | `/admin/stats` | ADMIN | System statistics |
| GET | `/admin/audit-logs` | ADMIN | Query audit logs |

### Health Check

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/v1/health` | Public | API health check |
| GET | `/api/v1` | Public | API info & endpoints |

---

## 5. REACT COMPONENTS

### Authentication (`/components/auth`)

- **LoginPage.tsx** - Login form with email/password
- **RegisterPage.tsx** - User registration form

### Dashboard (`/components/dashboard`)

- **Dashboard.tsx** - Main dashboard layout
- **HealthScore.tsx** - Health score display with metrics
- **ActionItemsPanel.tsx** - Health action items list
- **CollapsibleNavGroup.tsx** - Collapsible navigation menu
- **CategoryTab.tsx** - Category tabs for navigation
- **ExportButton.tsx** - Data export functionality

### Biomarkers (`/components/biomarker`)

- **BiomarkerPanel.tsx** - Biomarker list and management
- **BiomarkerTrends.tsx** - Trend charts over time
- **BiomarkerHistory.tsx** - Historical values table

### Health (`/components/health`)

- **HealthRecommendations.tsx** - AI-generated health recommendations

### Insurance (`/components/insurance`)

- **InsuranceHub.tsx** - Main insurance dashboard (3 tabs: Plans, Cost Analysis, Learn & Save)
- **InsuranceGuide.tsx** - Educational panel with health profile and cost projections
- **InsurancePlanCompare.tsx** - Advanced plan comparison with AI search
- **InsurancePlanViewer.tsx** - Detailed benefit viewer with coverage status
- **InsuranceSBCUpload.tsx** - SBC document upload modal
- **InsuranceUtilizationTracker.tsx** - Track insurance value from biomarker services
- **InsuranceKnowledgeBase.tsx** - Knowledge management with search/browse/compare tabs
- **EnhancedInsuranceUpload.tsx** - AI-powered NLP document parsing

### DNA (`/components/dna`)

- **DNAAnalysisPanel.tsx** - Genetic analysis dashboard (traits, risks, recommendations)

### Upload (`/components/upload`)

- **PDFUploadModal.tsx** - PDF lab report upload with mock extraction

### Common (`/components/common`)

- **ErrorBoundary.tsx** - React error boundary with fallback UI
- **Modal.tsx** - Reusable modal dialog (supports sm/md/lg/xl/full sizes)
- **UploadZone.tsx** - Drag-and-drop file upload with progress
- **RoleGuard.tsx** - Role-based component visibility
  - Sub-components: `PatientOnly`, `ProviderOnly`, `AdminOnly`, `ProviderOrAdmin`
- **RoleBadge.tsx** - Display user's role as badge

---

## 6. AUTHENTICATION FLOW

### Registration

```
User → POST /auth/register
  ↓
Validate email/password
  ↓
Check if email exists
  ↓
Hash password (bcrypt, 12 rounds)
  ↓
Create user in database
  ↓
Return success (no auto-login)
```

### Login

```
User → POST /auth/login
  ↓
Find user by email
  ↓
Check account lockout status
  ↓
Verify password (bcrypt.compare)
  ↓
- If invalid: Record failed attempt, lockout after 5 failures
- If valid: Reset failed attempts
  ↓
Generate JWT tokens:
  - Access token (15 min, stored in memory)
  - Refresh token (7 days, HTTP-only cookie)
  ↓
Store session in database
  ↓
Return tokens + user info
```

### Token Refresh

```
Client → POST /auth/refresh (with refresh token cookie)
  ↓
Verify refresh token (JWT signature)
  ↓
Check token exists in database
  ↓
Check expiration
  ↓
Revoke old refresh token (token rotation)
  ↓
Generate new token pair
  ↓
Return new tokens
```

### Protected Routes

```
Client → Request with Authorization: Bearer {token}
  ↓
Middleware: Extract token from header
  ↓
Verify JWT signature
  ↓
Check if token is revoked (blacklist)
  ↓
Extract user ID from payload
  ↓
Check user exists and isActive=true
  ↓
Attach user to request object
  ↓
Pass to route handler
```

### RBAC Flow

```
Protected Route
  ↓
authenticate middleware (verify JWT)
  ↓
requireRole middleware (check user.role)
  ↓
- PATIENT: Can access own data only
- PROVIDER: Can access patients who granted consent
- ADMIN: Can access all users
  ↓
enforceUserScope middleware (filter by userId)
  ↓
Route handler
```

### Logout

```
User → POST /auth/logout
  ↓
Revoke current refresh token
  ↓
Delete session from database
  ↓
Client: Clear tokens from storage
```

### Security Features

- **HTTP-only cookies:** Refresh tokens cannot be accessed by JavaScript
- **Token rotation:** Refresh tokens are single-use
- **Account lockout:** 5 failed attempts = 15 minute lockout
- **Rate limiting:** 5 req/min on auth endpoints, 100 req/15min globally
- **Password requirements:** 8+ chars, upper, lower, number, special char
- **CSRF protection:** SameSite=Strict cookies
- **Timing attack prevention:** Dummy bcrypt comparison for non-existent users

---

## 7. DATA FLOW

### Upload Lab Results (PDF → Database)

```
Frontend (PDFUploadModal.tsx)
  ↓ User selects PDF file
  ↓
Extract text with Tesseract.js (OCR)
  ↓ [Currently returns mock data]
  ↓
POST /biomarkers/bulk
  ↓
Backend (biomarkerController.ts)
  ↓
Validate data (Zod schema)
  ↓
Encryption Service
  ↓ Encrypt PHI values (AES-256-GCM)
  ↓
Prisma Client
  ↓ Insert into biomarkers table
  ↓
Audit Service
  ↓ Log CREATE action
  ↓
Return success
  ↓
Frontend refreshes biomarker list
```

### View Health Analysis

```
Frontend Dashboard
  ↓
GET /health/analysis
  ↓
Backend (healthController.ts)
  ↓
Prisma: Fetch user's biomarkers
  ↓
Decryption Service
  ↓ Decrypt biomarker values
  ↓
Analysis Algorithm
  ↓ Calculate health score, identify risks
  ↓
Audit Service (log PHI_ACCESS)
  ↓
Return analysis JSON
  ↓
Frontend displays health score, recommendations
```

### Provider Access Patient Data

```
Provider Dashboard
  ↓
GET /provider/patients/:patientId/biomarkers
  ↓
Backend (providerRoutes.ts)
  ↓
Check provider-patient relationship
  ↓
Verify canViewBiomarkers permission
  ↓
Check consent expiration
  ↓
Prisma: Fetch patient biomarkers
  ↓
Decryption Service
  ↓
Audit Service (log READ with providerId, patientId)
  ↓
Return biomarkers
  ↓
Provider views patient data
```

### Data Encryption Flow

```
User Input (PHI)
  ↓
Backend receives plaintext
  ↓
Get user's encryption salt from user_encryption_keys
  ↓
Derive user-specific key (PBKDF2)
  - Master key + user salt → derived key
  ↓
Generate random IV (16 bytes)
  ↓
AES-256-GCM encryption
  - Plaintext + derived key + IV → ciphertext + auth tag
  ↓
Format: "IV:authTag:ciphertext" (base64)
  ↓
Store in database (e.g., valueEncrypted column)
```

### Audit Logging Flow

```
Any PHI Operation (CREATE/READ/UPDATE/DELETE)
  ↓
Extract context:
  - userId, sessionId
  - IP address, user agent
  - resourceType, resourceId
  ↓
Encrypt previous/new values (system salt)
  ↓
Create audit_log entry
  - action, actorType
  - encrypted values
  - metadata
  ↓
Store in audit_logs table (immutable)
```

---

## 8. SECURITY MEASURES

### ✅ Implemented

| Feature | Implementation | Location |
|---------|---------------|----------|
| **Password Hashing** | bcrypt (12 rounds) | `authService.ts` |
| **JWT Tokens** | Access (15m) + Refresh (7d) | `authService.ts` |
| **HTTP-only Cookies** | Refresh tokens in secure cookies | `authController.ts` |
| **Token Rotation** | Single-use refresh tokens | `authService.ts` |
| **Account Lockout** | 5 attempts = 15min lockout | `authService.ts` |
| **Rate Limiting** | 100/15min global, 5/min auth | `rateLimiter.ts` |
| **PHI Encryption** | AES-256-GCM per-user keys | `encryption.ts` |
| **Audit Logging** | All PHI access logged | `auditLog.ts` |
| **RBAC** | Patient/Provider/Admin roles | `rbac.ts` |
| **CORS** | Configured for frontend domain | `app.ts` |
| **Helmet** | Security headers | `app.ts` |
| **Input Validation** | Zod schemas | `validation.ts` |
| **SQL Injection** | Prisma parameterized queries | `database.ts` |
| **XSS Protection** | React escapes by default | React |

### ⚠️ Missing / Incomplete

| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| **Email Verification** | Not implemented | HIGH | Users can register but emails aren't verified |
| **Password Reset** | Not implemented | HIGH | No forgot password flow |
| **2FA** | Not implemented | MEDIUM | No multi-factor authentication |
| **Session Management** | In-memory only | CRITICAL | Users stored in Map, lost on restart |
| **CSP Headers** | Not configured | MEDIUM | Content Security Policy missing |
| **API Key Rotation** | Manual only | MEDIUM | No automated key rotation |
| **Intrusion Detection** | None | LOW | No anomaly detection |
| **DDoS Protection** | Basic rate limiting | MEDIUM | Should use CDN/WAF in production |
| **Database Encryption** | Application-layer only | MEDIUM | No TDE (Transparent Data Encryption) |
| **Backup Encryption** | Not configured | MEDIUM | Database backups not encrypted |

### Production Blockers

1. **In-Memory Auth Storage** - User data and sessions stored in JavaScript Map
   - Location: `backend/src/services/authService.ts`
   - Fix: Migrate to database using Prisma

2. **Development Encryption Key** - Hardcoded dev key
   - Location: `backend/src/services/encryption.ts`
   - Fix: Set `PHI_ENCRYPTION_KEY` env var (64+ hex chars)

3. **No Email Service** - Cannot send verification emails
   - Fix: Integrate SendGrid/AWS SES

4. **Mock OCR Data** - PDF extraction returns dummy data
   - Location: `src/components/upload/PDFUploadModal.tsx`
   - Fix: Integrate AWS Textract or Google Cloud Vision

---

## 9. ENVIRONMENT VARIABLES

### Required for Production

```bash
# Backend (.env)
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# JWT Secrets (generate with: openssl rand -hex 32)
JWT_ACCESS_SECRET=<64-char-hex-string>
JWT_REFRESH_SECRET=<64-char-hex-string>

# PHI Encryption (generate with: openssl rand -hex 32)
PHI_ENCRYPTION_KEY=<64-char-hex-string>

# CORS
ALLOWED_ORIGINS=https://yourdomain.com

# Optional
LOG_LEVEL=info
BCRYPT_ROUNDS=12
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION=900000  # 15 minutes in ms
```

### Optional Development

```bash
# Frontend (.env.local)
VITE_API_URL=http://localhost:3000/api/v1

# Backend (.env.development)
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ownmyhealth_dev
DEMO_MODE=true  # Enables /auth/demo endpoint
```

### Cookie Configuration

```typescript
// Configured in backend/src/config/index.ts
cookie: {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',  // HTTPS only in prod
  sameSite: 'strict',
  maxAge: {
    accessToken: 15 * 60 * 1000,   // 15 minutes
    refreshToken: 7 * 24 * 60 * 60 * 1000,  // 7 days
  }
}
```

---

## 10. KNOWN ISSUES

### Critical (Production Blockers)

| Issue | Impact | Location | Workaround |
|-------|--------|----------|-----------|
| **In-memory user storage** | Data lost on restart | `authService.ts` | Must migrate to database before production |
| **Development encryption key** | Insecure PHI encryption | `encryption.ts` | Set PHI_ENCRYPTION_KEY env var |
| **No database migrations** | Schema changes require manual SQL | `prisma/` | Use `prisma migrate` workflow |
| **Mock PDF extraction** | Cannot process real lab reports | `PDFUploadModal.tsx` | Integrate OCR service |

### High Priority

| Issue | Impact | Workaround |
|-------|--------|-----------|
| **No email verification** | Fake emails can register | Manual admin verification |
| **No password reset** | Locked-out users can't recover | Admin must reset manually |
| **Session not in DB** | Can't revoke sessions across instances | Single server deployment only |
| **No refresh token cleanup** | Expired tokens accumulate | Runs cleanup every hour |

### Medium Priority

| Issue | Impact | Workaround |
|-------|--------|-----------|
| **Large file uploads** | No chunking for >10MB files | Size limit in nginx/CDN |
| **No pagination on some endpoints** | Can return 1000s of records | Add ?limit= parameter |
| **Frontend error handling** | Some errors not user-friendly | ErrorBoundary catches most |
| **No WebSocket support** | No real-time updates | Client-side polling |

### Low Priority / Tech Debt

- Biomarker categories are hardcoded (not in database)
- Insurance plan normalization is manual (not AI-powered yet)
- DNA analysis limited to basic SNP interpretation
- No mobile-responsive design for some components
- Charts can be slow with >1000 data points
- No dark mode support
- Some TypeScript `any` types need refinement

---

## 11. CURRENT STATE

### ✅ What Works

**Authentication & Authorization:**
- ✅ User registration with role assignment
- ✅ Login with JWT access + refresh tokens
- ✅ Password hashing with bcrypt
- ✅ Account lockout protection
- ✅ RBAC (Patient/Provider/Admin)
- ✅ Provider-patient consent management

**Health Data Management:**
- ✅ Biomarker CRUD operations
- ✅ Biomarker history tracking
- ✅ Health score calculation
- ✅ Health needs generation (manual)
- ✅ Out-of-range flagging
- ✅ Data visualization (charts)

**Insurance Features:**
- ✅ Insurance plan management
- ✅ Benefit coverage tracking
- ✅ Plan comparison tool
- ✅ Cost estimation
- ✅ SBC document upload (UI only)
- ✅ Benefit search

**Genetic Data:**
- ✅ DNA file upload (23andMe/AncestryDNA format)
- ✅ SNP variant storage
- ✅ Basic trait interpretation
- ✅ Risk level categorization

**Security:**
- ✅ PHI field-level encryption (AES-256-GCM)
- ✅ Audit logging (all PHI access)
- ✅ Rate limiting
- ✅ CORS protection
- ✅ Input validation
- ✅ SQL injection prevention (Prisma)

**Developer Experience:**
- ✅ Full TypeScript support
- ✅ Comprehensive JSDoc comments
- ✅ Hot reload dev servers
- ✅ Prisma migrations

### ⚠️ What's Incomplete

**Authentication:**
- ⚠️ No email verification
- ⚠️ No password reset flow
- ⚠️ No 2FA support
- ⚠️ Sessions not persisted to database

**Data Processing:**
- ⚠️ PDF OCR returns mock data (not real extraction)
- ⚠️ No EHR integration
- ⚠️ No device sync (Fitbit, Apple Health)
- ⚠️ AI health recommendations are basic rules (not ML)

**Provider Features:**
- ⚠️ Provider dashboard incomplete
- ⚠️ No patient search
- ⚠️ No appointment scheduling
- ⚠️ No messaging system

**Export/Reporting:**
- ⚠️ PDF export works but limited formatting
- ⚠️ No CSV export
- ⚠️ No CCDA export (health record standard)
- ⚠️ No data portability tools

**Admin Tools:**
- ⚠️ Admin panel is API-only (no UI)
- ⚠️ No user management dashboard
- ⚠️ No audit log viewer UI
- ⚠️ No system health dashboard

### ❌ What's Broken

**Known Bugs:**
- ❌ Large biomarker datasets (>500 records) slow chart rendering
- ❌ Insurance benefit search doesn't handle partial matches well
- ❌ Some error messages not translated to user-friendly format
- ❌ Token refresh fails silently on network errors
- ❌ File uploads >10MB may timeout

**Not Yet Implemented:**
- ❌ Mobile app
- ❌ Dark mode
- ❌ Internationalization (i18n)
- ❌ Accessibility (WCAG) compliance
- ❌ Print-friendly views
- ❌ Keyboard navigation
- ❌ Screen reader support

### Development Status

| Feature Area | Completion | Production Ready |
|--------------|------------|------------------|
| **Authentication** | 70% | ❌ No (in-memory storage) |
| **Biomarkers** | 90% | ✅ Yes |
| **Health Analysis** | 60% | ⚠️ Basic only |
| **Insurance** | 75% | ⚠️ Needs OCR |
| **DNA Analysis** | 50% | ⚠️ Limited traits |
| **Provider Portal** | 40% | ❌ No |
| **Admin Tools** | 30% | ❌ No |
| **Security** | 80% | ⚠️ Needs production config |
| **Documentation** | 95% | ✅ Yes |

### Next Steps Priority

1. **Critical:** Migrate auth to database (blocker for production)
2. **Critical:** Configure production environment variables
3. **High:** Implement real OCR for PDF extraction
4. **High:** Add email verification and password reset
5. **Medium:** Complete provider portal UI
6. **Medium:** Add comprehensive test suite
7. **Low:** Build admin dashboard UI
8. **Low:** Implement advanced AI recommendations

---

## Quick Start Commands

```bash
# Frontend
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Build for production
npm run preview      # Preview production build

# Backend
cd backend
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Compile TypeScript
npm start            # Run compiled code

# Database
cd backend
npx prisma migrate dev     # Run migrations
npx prisma studio          # Open Prisma Studio UI
npx prisma generate        # Regenerate Prisma client
```

---

**Document Version:** 1.0
**Last Verified:** 2025-11-26
**Maintainer:** Development Team
