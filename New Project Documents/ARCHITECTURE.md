# OwnMyHealth Architecture

**Last Updated:** 2026-02-06

**Version:** 1.0.0

**Status:** Production (GCP Cloud Run)

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Data Flow Diagrams](#data-flow-diagrams)
4. [Database Schema](#database-schema)
5. [API Routes](#api-routes)
6. [Services Layer](#services-layer)
7. [Security Architecture](#security-architecture)
8. [Middleware Stack](#middleware-stack)
9. [Role-Based Access Control](#role-based-access-control)
10. [Infrastructure Details](#infrastructure-details)
11. [Cost Breakdown](#cost-breakdown)
12. [File Structure](#file-structure)

---

## System Overview

OwnMyHealth is a HIPAA-compliant health biomarker tracking platform with insurance document management, AI-powered educational guidance, provider-patient collaboration, and expense tracking. All Protected Health Information (PHI) is encrypted at the application layer with AES-256-GCM before database storage.

```
                           OwnMyHealth System Architecture
 ===========================================================================

  +---------------------+          HTTPS           +---------------------+
  |                     |  <--------------------->  |                     |
  |   React SPA         |   JWT (HttpOnly Cookie)   |   Express API       |
  |   (Vite 7.3)        |   + CSRF Token            |   (Node.js 20)      |
  |                     |                           |                     |
  |   GCS Bucket:       |                           |   Cloud Run:        |
  |   ownmyhealth-      |                           |   ownmyhealth-      |
  |   frontend          |                           |   backend           |
  +---------------------+                           +----------+----------+
                                                               |
                    +------------------------------------------+------------------------------------------+
                    |                    |                      |                     |                    |
           +-------v-------+   +-------v-------+   +----------v--------+   +--------v--------+   +------v------+
           |               |   |               |   |                   |   |                 |   |             |
           |  PostgreSQL   |   |  Google Cloud  |   |  Anthropic Claude |   |  Google         |   |  SendGrid   |
           |  (Cloud SQL)  |   |  Storage       |   |  API              |   |  Document AI    |   |  Email      |
           |               |   |  (GCS)         |   |                   |   |  (OCR)          |   |             |
           |  - 20+ tables |   |  - Lab reports |   |  - Biomarker      |   |  - Scanned lab  |   |  - Verify   |
           |  - RLS        |   |  - SBC docs    |   |    guidance       |   |    report text  |   |  - Reset PW |
           |  - Encrypted  |   |  - Signed URLs |   |  - SBC extraction |   |    extraction   |   |  - Notify   |
           |    PHI        |   |               |   |  - Cost analysis  |   |                 |   |             |
           +---------------+   +---------------+   +-------------------+   +-----------------+   +-------------+

           +-------------------------------------------------------------------------------------------+
           |                              CI/CD: GitHub Actions                                         |
           |  push to main --> Docker build --> Artifact Registry --> Cloud Run deploy                  |
           |  push to main --> npm build --> gsutil cp --> GCS bucket (frontend)                        |
           +-------------------------------------------------------------------------------------------+
```

---

## Technology Stack

### Frontend

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | React | 18.3 |
| Build Tool | Vite | 7.3 |
| Language | TypeScript | 5.5 |
| Styling | Tailwind CSS | 3.4 |
| Charts | Recharts | 3.5 |
| Icons | Lucide React | 0.344 |
| PDF Generation | jsPDF + jspdf-autotable | 4.0 / 5.0 |
| PDF Viewing | pdfjs-dist | 4.0 |
| Client-side OCR | Tesseract.js | 5.0 |
| Testing | Vitest + Testing Library | 4.0 |
| Hosting | Google Cloud Storage | - |
| Chunk Splitting | Manual chunks: `pdf`, `ocr`, `charts` | - |

### Backend

| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js (Alpine) | 20 |
| Framework | Express | 4.18 |
| Language | TypeScript | 5.3 |
| ORM | Prisma (with pg adapter) | 7.0 |
| DB Driver | pg (node-postgres) | 8.16 |
| AI SDK | @anthropic-ai/sdk | 0.71 |
| File Upload | Multer (memory storage) | 2.0 |
| PDF Parsing | pdf-parse | 1.1 |
| Auth | jsonwebtoken + bcryptjs | 9.0 / 2.4 |
| Validation | Zod | 3.22 |
| Security Headers | Helmet | 7.1 |
| Rate Limiting | express-rate-limit | 7.1 |
| Email | @sendgrid/mail | 8.1 |
| Cloud Storage | @google-cloud/storage | 7.18 |
| Document AI | @google-cloud/documentai | 9.5 |
| Logging | Morgan + custom logger | 1.10 |
| Testing | Vitest + Supertest | 4.0 / 7.1 |
| Dev Server | tsx (watch mode) | 4.6 |

### Database

| Component | Technology | Details |
|-----------|------------|---------|
| Engine | PostgreSQL | Cloud SQL (managed) |
| ORM | Prisma 7.0 | With `@prisma/adapter-pg` for native pg driver |
| Connection Pool | pg Pool | max: 5, idle timeout: 30s, statement timeout: 30s |
| Row-Level Security | PostgreSQL RLS | Policies enforce per-user data isolation |
| Primary Keys | UUID v4 | `gen_random_uuid()` database-generated |
| Encryption | Application-layer | AES-256-GCM on all PHI columns |
| Migrations | Prisma Migrate | Auto-deploy on container start |

### External Services

| Service | Provider | Purpose | Model/Tier |
|---------|----------|---------|------------|
| AI/LLM | Anthropic Claude | Biomarker guidance, SBC extraction, cost analysis | Haiku 4.5 (guidance/lab), Sonnet 4 (SBC) |
| File Storage | Google Cloud Storage | Lab reports, SBC documents, clinical files | Standard bucket |
| OCR | Google Document AI | Scanned lab report text extraction | Form Parser processor |
| Email | SendGrid | Verification, password reset, notifications | Transactional API |
| Database | Google Cloud SQL | PostgreSQL managed database | Standard tier |
| Compute | Google Cloud Run | Backend API container hosting | Auto-scaling |
| Registry | Artifact Registry | Docker image storage | Standard |
| Frontend CDN | Google Cloud Storage | Static SPA hosting | Standard bucket |
| CI/CD | GitHub Actions | Build, test, deploy pipeline | ubuntu-latest |

---

## Data Flow Diagrams

### Authentication Flow

```
  REGISTRATION                              LOGIN
  =============                             ======

  Client                 Server             Client                 Server
    |                      |                  |                      |
    |  POST /auth/register |                  |  POST /auth/login    |
    |  {email, password}   |                  |  {email, password}   |
    |--------------------->|                  |--------------------->|
    |                      |                  |                      |
    |          Zod validate |                  |          Zod validate|
    |          Hash (bcrypt |                  |     Verify bcrypt   |
    |            12 rounds) |                  |     Check lockout   |
    |          Create user  |                  |     Check email     |
    |          Gen verify   |                  |       verified      |
    |            token      |                  |                      |
    |          Send email   |                  |     Gen access JWT  |
    |            (SendGrid) |                  |       (15 min)      |
    |                      |                  |     Gen refresh JWT |
    |  <-- 201 Created     |                  |       (7 days)      |
    |                      |                  |     Create Session  |
    |                      |                  |       in DB         |
    |  GET /verify-email   |                  |                      |
    |  ?token=xxx          |                  |  <-- Set-Cookie:    |
    |--------------------->|                  |     access_token    |
    |          Verify token |                  |     (HttpOnly,      |
    |          Set verified |                  |      Secure,        |
    |  <-- 200 Verified    |                  |      SameSite)      |
    |                      |                  |  <-- Set-Cookie:    |
                                              |     refresh_token   |
                                              |     (HttpOnly,      |
  TOKEN REFRESH                               |      Secure, 7d)    |
  ==============                              |                      |

  Client                 Server
    |                      |               LOGOUT
    |  POST /auth/refresh  |               =======
    |  Cookie:             |
    |    refresh_token     |               POST /auth/logout
    |--------------------->|               --> Delete session from DB
    |    Verify refresh JWT|               --> Clear cookies
    |    Check DB session  |
    |    Gen new access JWT|               POST /auth/logout-all
    |  <-- Set-Cookie:     |               --> Delete ALL user sessions
    |    new access_token  |               --> Clear cookies
    |                      |
```

### PDF Upload and Extraction Flow

```
  Lab Report Upload                          SBC Document Upload
  =================                          ===================

  Client                    Server           Client                    Server
    |                         |                |                         |
    | POST /upload/lab-report |                | POST /insurance/        |
    | multipart/form-data     |                |   upload-sbc            |
    | (PDF, max 10MB)         |                | multipart/form-data     |
    |------------------------>|                | (PDF, max 10MB)         |
    |                         |                |------------------------>|
    |     1. Multer validates |                |                         |
    |        (PDF only,       |                |     1. Multer validates |
    |         single file)    |                |        (PDF only)       |
    |                         |                |                         |
    |     2. Rate limit check |                |     2. Rate limit check |
    |        (20/hour)        |                |        (20/hour)        |
    |                         |                |                         |
    |     3. Upload to GCS    |                |     3. Send to Claude   |
    |        {userId}/{id}    |                |        Sonnet 4 API     |
    |        .pdf             |                |        (16K tokens)     |
    |                         |                |                         |
    |     4. Send to Claude   |                |     4. Parse JSON:      |
    |        Haiku 4.5 API    |                |        - Plan details   |
    |        (8K tokens)      |                |        - Copays/coins.  |
    |                         |                |        - Deductibles    |
    |     5. Parse JSON:      |                |        - Rx benefits    |
    |        - Biomarker names|                |        - Vision/dental  |
    |        - Values + units |                |        - Exclusions     |
    |        - Ref ranges     |                |        - Prior auth     |
    |        - Lab date/name  |                |                         |
    |                         |                |     5. Encrypt PHI      |
    |     6. Validate values  |                |        fields           |
    |        (range checks)   |                |                         |
    |                         |                |     6. Create plan +    |
    |     7. Encrypt PHI      |                |        benefits in DB   |
    |        (AES-256-GCM)    |                |                         |
    |                         |                |     7. Audit log        |
    |     8. Bulk create      |                |                         |
    |        biomarkers in DB |                |  <-- 201 Plan created   |
    |                         |                |      + extraction data  |
    |     9. Audit log        |
    |                         |
    |  <-- 201 Created        |
    |      + biomarker data   |

  OCR Upload (scanned images)
  ===========================
  POST /upload/lab-results-ocr
    --> Multer (PDF/PNG/JPG/TIFF)
    --> PDF? --> Claude API (intelligent extraction)
    --> Image? --> Google Document AI (OCR)
    --> Pattern-match biomarkers from text
    --> Validate + encrypt + store
```

### Provider-Patient Access Flow

```
  Provider                                    Patient
    |                                            |
    | POST /provider/patients/request            |
    | {patientEmail, relationshipType}           |
    |---->  Create PENDING relationship          |
    |       in provider_patients table           |
    |                                            |
    |                          GET /patient/providers/pending
    |                                            |<---- List pending requests
    |                                            |
    |                          POST /patient/providers/:id/approve
    |                          {canViewBiomarkers: true,
    |                           canViewInsurance: false,
    |                           canViewDna: false,
    |                           canViewHealthNeeds: true,
    |                           canEditData: false,
    |                           consentDurationDays: 365}
    |                                            |
    |       Relationship status --> ACTIVE        |
    |       Permissions stored                    |
    |       Consent timestamp set                 |
    |       Optional expiration set               |
    |                                            |
    | GET /provider/patients/:id/biomarkers      |
    |---->  Check relationship ACTIVE             |
    |       Check canViewBiomarkers = true        |
    |       Check consent not expired             |
    |       Return scoped data                    |
    |                                            |
    |                          POST /patient/providers/:id/revoke
    |                                            |<---- Status --> REVOKED
    |                                            |      Provider loses access
    |                                            |
    |                          PATCH /patient/providers/:id
    |                                            |<---- Update permissions
    |                                            |      (granular control)
    |                                            |
    |                          DELETE /patient/providers/:id
    |                                            |<---- Permanently remove
```

### AI Guidance Flow

```
  Client                         Server                    Anthropic
    |                              |                          |
    | POST /biomarkers/:id/guidance|                          |
    | {biomarker: {                |                          |
    |   name, value, unit,         |                          |
    |   status, history,           |                          |
    |   normalRange}}              |                          |
    |----------------------------->|                          |
    |                              |                          |
    |       1. Authenticate (JWT)  |                          |
    |       2. Validate input      |                          |
    |       3. Check API key       |                          |
    |       4. Build prompt:       |                          |
    |          - Biomarker data    |                          |
    |          - Normal ranges     |                          |
    |          - History trend     |                          |
    |                              |                          |
    |                              | POST /v1/messages        |
    |                              | model: claude-haiku-4-5  |
    |                              | max_tokens: 600          |
    |                              |------------------------->|
    |                              |                          |
    |                              |  <-- Structured response |
    |                              |      - What This Measures|
    |                              |      - Understanding     |
    |                              |      - Trend Summary     |
    |                              |      - Dr Questions      |
    |                              |      - What You Can Do   |
    |                              |                          |
    |  <-- 200 {guidance: "..."}   |                          |
    |      (educational, not       |                          |
    |       diagnostic)            |                          |
```

---

## Database Schema

### Models Overview (19 models, 14 enums)

```
  +------------------+       +--------------------+       +-------------------+
  |      User        |<----->|     Session         |       |   SystemConfig    |
  |  (users)         |       |  (sessions)         |       |  (system_config)  |
  +--------+---------+       +--------------------+       +-------------------+
           |
           +-------------+----------------+------------------+------------------+
           |             |                |                  |                  |
  +--------v-------+ +---v-----------+ +--v-----------+ +---v----------+ +----v---------+
  |   Biomarker    | | InsurancePlan | |  HealthGoal  | |  HealthNeed  | |   AuditLog   |
  |  (biomarkers)  | | (insurance_   | | (health_     | | (health_     | |  (audit_logs)|
  +--------+-------+ |  plans)       | |  goals)      | |  needs)      | +--------------+
           |          +------+--------+ +------+-------+ +--------------+
  +--------v-------+        |          +------v-----------+
  | BiomarkerHist. |  +-----v----------+ | GoalProgress   |
  | (biomarker_    |  |InsuranceBenefit| |  History        |
  |  history)      |  |(insurance_     | | (goal_progress_ |
  +----------------+  | benefits)      | |  history)       |
                       +-----+---------+ +-----------------+
                             |
           +-----------------+-------------------+
           |                 |                   |
  +--------v-------+ +------v--------+ +--------v---------+
  | ExpenseProject.| | ExpenseActual | |  CostAnalysis    |
  | (expense_      | | (expense_     | |  (cost_analyses) |
  |  projections)  | |  actuals)     | +------------------+
  +----------------+ +---------------+

  +------------------+       +--------------------+       +-------------------+
  | ProviderPatient  |       |      DNAData       |       | UserEncryptionKey |
  | (provider_       |       |  (dna_data)        |       | (user_encryption_ |
  |  patients)       |       +--------+-----------+       |  keys)            |
  +------------------+                |                   +-------------------+
                              +-------+--------+
                              |                |
                       +------v------+  +------v---------+
                       |  DNAVariant |  | GeneticTrait   |
                       | (dna_       |  | (genetic_      |
                       |  variants)  |  |  traits)       |
                       +-------------+  +----------------+

  +------------------+
  |    UserFile      |
  |  (user_files)    |
  +------------------+
```

### Core Tables

#### User (`users`)
The central entity. Stores account credentials and encrypted personal information.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, `gen_random_uuid()` |
| email | VARCHAR(255) | Unique, indexed |
| passwordHash | VARCHAR(255) | bcrypt, 12 rounds |
| firstNameEncrypted | TEXT | AES-256-GCM |
| lastNameEncrypted | TEXT | AES-256-GCM |
| dateOfBirthEncrypted | TEXT | AES-256-GCM |
| phoneEncrypted | TEXT | AES-256-GCM |
| addressEncrypted | TEXT | AES-256-GCM |
| emailVerified | BOOLEAN | Default: false |
| role | ENUM(PATIENT, PROVIDER, ADMIN) | Default: PATIENT |
| failedLoginAttempts | INT | Account lockout counter |
| lockedUntil | TIMESTAMPTZ | Lockout expiry |
| lastLoginAt | TIMESTAMPTZ | Tracks activity |

#### Session (`sessions`)
Database-backed JWT refresh token sessions for multi-device logout support.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| userId | UUID | FK -> users.id (CASCADE) |
| token | VARCHAR(500) | Unique refresh token hash |
| ipAddress | VARCHAR(45) | Client IP for audit |
| userAgent | TEXT | Browser fingerprint |
| expiresAt | TIMESTAMPTZ | 7-day expiry |

#### Biomarker (`biomarkers`)
Health lab test results with encrypted values.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| userId | UUID | FK -> users.id (CASCADE) |
| category | VARCHAR(100) | Lipid Panel, CBC, Metabolic, etc. |
| name | VARCHAR(200) | Cholesterol, Hemoglobin, etc. |
| unit | VARCHAR(50) | mg/dL, g/dL, etc. |
| valueEncrypted | TEXT | AES-256-GCM encrypted value |
| notesEncrypted | TEXT | AES-256-GCM encrypted notes |
| normalRangeMin | DECIMAL(10,4) | Lower normal bound |
| normalRangeMax | DECIMAL(10,4) | Upper normal bound |
| measurementDate | DATE | When test was performed |
| sourceType | ENUM | MANUAL, LAB_UPLOAD, EHR_IMPORT, DEVICE_SYNC, API_IMPORT |
| isOutOfRange | BOOLEAN | Flagged if outside normal range |
| userFileId | UUID | FK -> user_files.id (optional) |

**Key Indexes:** `(userId, category, measurementDate DESC)`, `(userId, isOutOfRange)`, `(userId, sourceType)`

#### BiomarkerHistory (`biomarker_history`)
Historical values for trend tracking.

| Column | Type | Notes |
|--------|------|-------|
| biomarkerId | UUID | FK -> biomarkers.id (CASCADE) |
| valueEncrypted | TEXT | AES-256-GCM encrypted historical value |
| measurementDate | DATE | Date of historical measurement |

#### InsurancePlan (`insurance_plans`)
Comprehensive insurance plan data, often extracted from SBC documents via Claude AI.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| userId | UUID | FK -> users.id (CASCADE) |
| planName | VARCHAR(300) | Plan name |
| insurerName | VARCHAR(200) | Insurance company |
| planType | ENUM | HMO, PPO, EPO, POS, HDHP |
| memberIdEncrypted | TEXT | AES-256-GCM (PHI) |
| groupIdEncrypted | TEXT | AES-256-GCM (PHI) |
| deductibleIndividual | DECIMAL(10,2) | In-network individual |
| deductibleFamily | DECIMAL(10,2) | In-network family |
| oopMaxIndividual | DECIMAL(10,2) | In-network individual |
| oopMaxFamily | DECIMAL(10,2) | In-network family |
| copayPrimaryCare | DECIMAL(10,2) | Primary care visit copay |
| copaySpecialist | DECIMAL(10,2) | Specialist visit copay |
| ... | ... | 80+ coverage fields (copays, coinsurance, Rx, vision, dental, etc.) |
| extractedFromSbc | BOOLEAN | Was this extracted by Claude AI? |
| sbcExtractionConfidence | DECIMAL(3,2) | AI confidence score (0-1) |

**Key Indexes:** `(userId, isActive, isPrimary DESC)`

#### InsuranceBenefit (`insurance_benefits`)
Individual service coverage details tied to a plan.

| Column | Type | Notes |
|--------|------|-------|
| planId | UUID | FK -> insurance_plans.id (CASCADE) |
| serviceName | VARCHAR(300) | e.g., "Primary Care Visit" |
| serviceCategory | VARCHAR(100) | e.g., "Physician Services" |
| inNetworkCovered | BOOLEAN | Covered in-network? |
| inNetworkCopay | DECIMAL(10,2) | Dollar copay |
| inNetworkCoinsurance | DECIMAL(5,2) | Percentage coinsurance |
| preAuthRequired | BOOLEAN | Prior authorization needed? |

#### ProviderPatient (`provider_patients`)
Consent-based provider-patient data sharing with granular permissions.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| providerId | UUID | FK -> users.id (CASCADE) |
| patientId | UUID | FK -> users.id (CASCADE) |
| canViewBiomarkers | BOOLEAN | Default: true |
| canViewInsurance | BOOLEAN | Default: false |
| canViewDna | BOOLEAN | Default: false |
| canViewHealthNeeds | BOOLEAN | Default: true |
| canEditData | BOOLEAN | Default: false |
| relationshipType | ENUM | PRIMARY_CARE, SPECIALIST, CONSULTANT, EMERGENCY, OTHER |
| status | ENUM | PENDING, ACTIVE, SUSPENDED, REVOKED, EXPIRED |
| consentGrantedAt | TIMESTAMPTZ | When patient approved |
| consentExpiresAt | TIMESTAMPTZ | Optional time-bound consent |
| notesEncrypted | TEXT | AES-256-GCM |

**Unique Constraint:** `(providerId, patientId)` - one relationship per provider-patient pair

#### HealthGoal (`health_goals`)
Goal tracking with progress history and milestones.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| userId | UUID | FK -> users.id (CASCADE) |
| name | VARCHAR(200) | Goal name |
| descriptionEncrypted | TEXT | AES-256-GCM |
| category | VARCHAR(100) | WEIGHT, FITNESS, NUTRITION, BIOMARKER, etc. |
| targetValue | DECIMAL(10,4) | Target metric |
| currentValue | DECIMAL(10,4) | Current progress |
| direction | ENUM | INCREASE, DECREASE, MAINTAIN |
| status | ENUM | ACTIVE, PAUSED, ACHIEVED, FAILED, CANCELLED |
| progress | DECIMAL(5,2) | Percentage complete |

#### HealthNeed (`health_needs`)
Health conditions, actions, and follow-ups.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| userId | UUID | FK -> users.id (CASCADE) |
| needType | ENUM | CONDITION, ACTION, SERVICE, FOLLOW_UP |
| urgency | ENUM | IMMEDIATE, URGENT, FOLLOW_UP, ROUTINE |
| status | ENUM | PENDING, IN_PROGRESS, COMPLETED, DISMISSED |
| descriptionEncrypted | TEXT | AES-256-GCM |
| relatedBiomarkerIds | UUID[] | Array of linked biomarker IDs |

#### ExpenseProjection (`expense_projections`)
Projected healthcare costs for budget planning.

| Column | Type | Notes |
|--------|------|-------|
| userId | UUID | FK -> users.id (CASCADE) |
| planId | UUID | FK -> insurance_plans.id (CASCADE) |
| serviceType | TEXT | Type of medical service |
| estimatedCost | DECIMAL(10,2) | Projected cost per occurrence |
| frequencyPerYear | INT | How many times per year |
| isInNetwork | BOOLEAN | In-network vs out-of-network |

#### ExpenseActual (`expense_actuals`)
Actual healthcare expenses and EOB data.

| Column | Type | Notes |
|--------|------|-------|
| userId | UUID | FK -> users.id (CASCADE) |
| planId | UUID | FK -> insurance_plans.id (CASCADE) |
| projectionId | UUID | FK -> expense_projections.id (optional) |
| billedAmount | DECIMAL(10,2) | Total billed |
| insurancePaid | DECIMAL(10,2) | Insurance portion |
| patientPaid | DECIMAL(10,2) | Patient responsibility |
| appliedToDeductible | DECIMAL(10,2) | Amount toward deductible |
| appliedToOop | DECIMAL(10,2) | Amount toward OOP max |

#### CostAnalysis (`cost_analyses`)
AI-powered cost analysis results (Claude API).

| Column | Type | Notes |
|--------|------|-------|
| userId | UUID | FK -> users.id (CASCADE) |
| planId | UUID | FK -> insurance_plans.id (CASCADE) |
| claudeResponse | TEXT | Full AI analysis text |
| totalProjectedOop | DECIMAL(10,2) | Projected annual out-of-pocket |
| deductibleMetMonth | INT | Month deductible expected to be met |
| projectedExpensesSnapshot | JSON | Point-in-time expense data |

#### AuditLog (`audit_logs`)
HIPAA-compliant immutable audit trail with 7-year retention.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| userId | UUID | FK -> users.id (nullable for system events) |
| actorType | ENUM | USER, SYSTEM, API, ADMIN, ANONYMOUS |
| action | ENUM | LOGIN, LOGOUT, LOGIN_FAILED, READ, CREATE, UPDATE, DELETE, PHI_ACCESS, EXPORT, etc. (18 actions) |
| resourceType | VARCHAR(100) | Entity type accessed |
| resourceId | UUID | Entity ID accessed |
| previousValueEncrypted | TEXT | AES-256-GCM encrypted prior state |
| newValueEncrypted | TEXT | AES-256-GCM encrypted new state |
| ipAddress | VARCHAR(45) | Client IP |
| userAgent | TEXT | Browser/client identifier |
| metadata | TEXT | JSON metadata (search terms, counts, etc.) |

**Key Indexes:** `(userId, createdAt DESC)`, `(action)`, `(resourceType)`, `(createdAt DESC)`

**Retention:** 2,555 days (~7 years). Automatic daily cleanup scheduler.

#### UserFile (`user_files`)
Uploaded documents tracked in database, stored in GCS.

| Column | Type | Notes |
|--------|------|-------|
| userId | UUID | FK -> users.id (CASCADE) |
| storageKey | VARCHAR(500) | GCS path: `{userId}/{fileId}.pdf` |
| fileType | VARCHAR(50) | MIME type |
| fileSize | INT | Size in bytes |
| biomarkersExtracted | INT | Count of extracted biomarkers |
| extractionConfidence | DECIMAL(3,2) | AI confidence (0-1) |

#### UserEncryptionKey (`user_encryption_keys`)
Per-user encryption key management for PHI.

| Column | Type | Notes |
|--------|------|-------|
| userId | UUID | FK -> users.id (CASCADE) |
| keyType | VARCHAR(50) | Key purpose |
| keyHash | VARCHAR(255) | Hash for verification |
| encryptedKey | TEXT | Key encrypted with master key |
| version | INT | For key rotation |
| isActive | BOOLEAN | Current active key |

**Unique Constraint:** `(userId, keyType, version)`

#### SystemConfig (`system_config`)
Key-value system configuration store.

| Column | Type | Notes |
|--------|------|-------|
| key | VARCHAR(100) | Unique config key |
| value | TEXT | Config value |
| isEncrypted | BOOLEAN | Whether value is encrypted |

### Deprecated Models (Still in Schema)

| Model | Table | Notes |
|-------|-------|-------|
| DNAData | `dna_data` | DNA upload tracking - not active in UI |
| DNAVariant | `dna_variants` | Individual genetic variants - not active in UI |
| GeneticTrait | `genetic_traits` | Analyzed genetic traits - not active in UI |

### Enums (14 total)

| Enum | Values |
|------|--------|
| UserRole | PATIENT, PROVIDER, ADMIN |
| ProviderRelationType | PRIMARY_CARE, SPECIALIST, CONSULTANT, EMERGENCY, OTHER |
| ProviderPatientStatus | PENDING, ACTIVE, SUSPENDED, REVOKED, EXPIRED |
| DataSourceType | MANUAL, LAB_UPLOAD, EHR_IMPORT, DEVICE_SYNC, API_IMPORT |
| PlanType | HMO, PPO, EPO, POS, HDHP |
| ProcessingStatus | PENDING, PROCESSING, COMPLETED, FAILED |
| RiskLevel | HIGH, MODERATE, LOW, PROTECTIVE, UNKNOWN |
| HealthNeedType | CONDITION, ACTION, SERVICE, FOLLOW_UP |
| Urgency | IMMEDIATE, URGENT, FOLLOW_UP, ROUTINE |
| HealthNeedStatus | PENDING, IN_PROGRESS, COMPLETED, DISMISSED |
| GoalDirection | INCREASE, DECREASE, MAINTAIN |
| GoalStatus | ACTIVE, PAUSED, ACHIEVED, FAILED, CANCELLED |
| ReminderFrequency | DAILY, WEEKLY, BIWEEKLY, MONTHLY |
| ActorType | USER, SYSTEM, API, ADMIN, ANONYMOUS |
| AuditAction | LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGE, PASSWORD_RESET, READ, VIEW, EXPORT, PRINT, CREATE, UPDATE, DELETE, PHI_ACCESS, PHI_EXPORT, PHI_DECRYPT, PERMISSION_CHANGE, SETTINGS_CHANGE, KEY_ROTATION |

---

## API Routes

All routes are prefixed with `/api/v1/`. The API exposes 12 route modules with 60+ endpoints.

### Auth Routes (`/api/v1/auth`) - 12 endpoints

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| POST | `/register` | No | authLimiter (20/15min) | Register new user |
| POST | `/login` | No | strictAuthLimiter (5/15min) | Login with email/password |
| POST | `/refresh` | No (cookie) | authLimiter | Refresh access token |
| POST | `/demo` | No | authLimiter | Demo account login |
| GET | `/verify-email` | No | authLimiter | Verify email with token |
| POST | `/resend-verification` | No | authLimiter | Resend verification email |
| POST | `/forgot-password` | No | strictAuthLimiter | Request password reset |
| POST | `/reset-password` | No | authLimiter | Reset password with token |
| POST | `/logout` | Yes | authLimiter | Logout current session |
| POST | `/logout-all` | Yes | authLimiter | Logout all sessions |
| GET | `/me` | Yes | authLimiter | Get current user info |
| POST | `/change-password` | Yes | authLimiter | Change password |

### Biomarker Routes (`/api/v1/biomarkers`) - 10 endpoints

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| GET | `/` | Yes | standard | List biomarkers (pagination, filter by category) |
| GET | `/summary` | Yes | standard | Summary stats (counts by category, range status) |
| GET | `/categories` | Yes | standard | List available categories |
| GET | `/:id` | Yes | standard | Get single biomarker |
| GET | `/:id/history` | Yes | standard | Get historical values |
| POST | `/` | Yes | standard | Create biomarker entry |
| POST | `/batch` | Yes | bulkOperationLimiter (30/hr) | Bulk create (up to 100) |
| PATCH | `/:id` | Yes | standard | Update biomarker |
| DELETE | `/:id` | Yes | standard | Delete biomarker |
| POST | `/:id/guidance` | Yes | standard | Get AI educational guidance (Claude Haiku 4.5) |

### Insurance Routes (`/api/v1/insurance`) - 10 endpoints

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| GET | `/plans` | Yes | standard | List all plans |
| GET | `/plans/:id` | Yes | standard | Get single plan with benefits |
| POST | `/plans` | Yes | standard | Create plan manually |
| PATCH | `/plans/:id` | Yes | standard | Update plan |
| DELETE | `/plans/:id` | Yes | standard | Delete plan |
| POST | `/compare` | Yes | standard | Compare 2-5 plans side-by-side |
| GET | `/benefits/search` | Yes | standard | Search benefits across plans |
| PUT | `/plans/:id/reanalyze` | Yes | uploadLimiter (20/hr) | Re-analyze plan with new SBC PDF |
| POST | `/upload-sbc` | Yes | uploadLimiter (20/hr) | Upload and parse SBC PDF (Claude Sonnet 4) |
| PUT | `/plans/:id/spending` | Yes | standard | Update current deductible/OOP spending |

### Expense Routes (`/api/v1/expenses`) - 6 endpoints

| Method | Path | Auth | CSRF | Description |
|--------|------|------|------|-------------|
| GET | `/projections` | Yes | No | List expense projections (by plan) |
| POST | `/projections` | Yes | Yes | Create expense projection |
| PUT | `/projections/:id` | Yes | Yes | Update expense projection |
| DELETE | `/projections/:id` | Yes | Yes | Delete expense projection |
| POST | `/analyze` | Yes | Yes | Run AI cost analysis (Claude) |
| GET | `/analyses` | Yes | No | List cost analyses (by plan) |

### Health Goals Routes (`/api/v1/health-goals`) - 8 endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Yes | List goals (filter by status, category) |
| GET | `/summary` | Yes | Goals summary statistics |
| GET | `/suggestions` | Yes | AI-suggested goals based on biomarkers |
| GET | `/:id` | Yes | Get goal with progress history |
| POST | `/` | Yes | Create goal |
| PUT | `/:id` | Yes | Update goal |
| PATCH | `/:id/progress` | Yes | Log progress entry |
| DELETE | `/:id` | Yes | Delete goal |

### Health Needs Routes (`/api/v1/health-needs`) - 6 endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Yes | List needs (filter by status, urgency, type) |
| GET | `/analyze` | Yes | AI-powered health needs analysis |
| GET | `/:id` | Yes | Get single need |
| POST | `/` | Yes | Create need |
| PATCH | `/:id` | Yes | Update need status |
| DELETE | `/:id` | Yes | Delete need |

### Provider Routes (`/api/v1/provider`) - 7 endpoints, requires PROVIDER or ADMIN role

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/patients` | Yes | PROVIDER/ADMIN | List patient relationships |
| POST | `/patients/request` | Yes | PROVIDER/ADMIN | Request access to patient by email |
| GET | `/patients/:patientId` | Yes | PROVIDER/ADMIN | Get patient details (if authorized) |
| GET | `/patients/:patientId/biomarkers` | Yes | PROVIDER/ADMIN | View patient biomarkers (requires canViewBiomarkers) |
| GET | `/patients/:patientId/health-needs` | Yes | PROVIDER/ADMIN | View patient health needs (requires canViewHealthNeeds) |
| DELETE | `/patients/:patientId` | Yes | PROVIDER/ADMIN | Remove relationship |

### Patient Routes (`/api/v1/patient`) - 7 endpoints, requires PATIENT role

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/providers` | Yes | PATIENT | List provider relationships |
| GET | `/providers/pending` | Yes | PATIENT | List pending access requests |
| POST | `/providers/:id/approve` | Yes | PATIENT | Approve with granular permissions |
| POST | `/providers/:id/deny` | Yes | PATIENT | Deny access request |
| PATCH | `/providers/:id` | Yes | PATIENT | Update provider permissions |
| POST | `/providers/:id/revoke` | Yes | PATIENT | Revoke provider access |
| DELETE | `/providers/:id` | Yes | PATIENT | Permanently remove relationship |

### Admin Routes (`/api/v1/admin`) - 10 endpoints, requires ADMIN role

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/users` | Yes | ADMIN | List users (pagination, search, filter) |
| GET | `/users/:id` | Yes | ADMIN | Get user detail with counts |
| POST | `/users` | Yes | ADMIN | Create user (any role) |
| PATCH | `/users/:id` | Yes | ADMIN | Update user (role, status) |
| DELETE | `/users/:id` | Yes | ADMIN | Soft-delete (deactivate) |
| DELETE | `/users/:id/permanent` | Yes | ADMIN | Hard delete (requires email confirmation, sensitiveLimiter) |
| GET | `/provider-relationships` | Yes | ADMIN | List all provider-patient relationships |
| PATCH | `/provider-relationships/:id` | Yes | ADMIN | Update relationship |
| GET | `/stats` | Yes | ADMIN | System-wide statistics |
| GET | `/audit-logs` | Yes | ADMIN | Query audit logs (filter by user, action, date) |

### Upload Routes (`/api/v1/upload`) - 3 endpoints

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| POST | `/lab-report` | Yes | uploadLimiter (20/hr) | Upload lab report PDF (Claude extraction) |
| POST | `/insurance-sbc` | Yes | uploadLimiter (20/hr) | Upload SBC PDF (Claude extraction) |
| POST | `/lab-results-ocr` | Yes | uploadLimiter (20/hr) | Upload lab result PDF/image (Claude or Document AI OCR) |

### File Routes (`/api/v1/files`) - 4 endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Yes | List user's files |
| GET | `/:id` | Yes | Get file details with signed URL |
| GET | `/:id/download` | Yes | Get signed download URL (15min expiry) |
| DELETE | `/:id` | Yes | Delete file (DB record + GCS object) |

### Settings Routes (`/api/v1/settings`) - 3 endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/export-data` | Yes | Export all user data as JSON |
| DELETE | `/delete-data` | Yes | Delete all health data (keep account) |
| DELETE | `/delete-account` | Yes | Delete account and all data permanently |

### Utility Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/health` | No | API health check |
| GET | `/api/v1/` | No | API info and endpoint list |
| GET | `/api/v1/csrf-token` | No | Fetch CSRF token for SPA |
| GET | `/health` | No | Docker/Cloud Run health check (includes DB status) |

---

## Services Layer

### 18 Service Files

| Service | File | Purpose |
|---------|------|---------|
| **Database** | `database.ts` | Prisma client, connection pool, RLS context management |
| **Encryption** | `encryption.ts` | AES-256-GCM PHI encryption/decryption, field mappings |
| **User Encryption** | `userEncryption.ts` | Per-user key derivation (PBKDF2-SHA512), salt management |
| **Auth** | `authService.ts` | Login, register, JWT issuance, session management, demo user |
| **Audit Log** | `auditLog.ts` | HIPAA audit trail, retention cleanup scheduler |
| **Claude Extraction** | `claudeExtraction.ts` | Lab report biomarker extraction via Claude Haiku 4.5 |
| **SBC Extraction** | `sbcExtraction.ts` | Insurance plan extraction via Claude Sonnet 4 |
| **Storage** | `storageService.ts` | GCS upload, signed URLs, delete |
| **Email** | `emailService.ts` | SendGrid email verification, password reset |
| **OCR** | `ocrService.ts` | Google Document AI OCR, PDF/image processing |
| **PDF Parser** | `pdfParser.ts` | pdf-parse text extraction from PDFs |
| **Biomarker Extractor** | `biomarkerExtractor.ts` | Pattern-matching biomarker extraction from text |
| **Biomarker Patterns** | `biomarkerPatterns.ts` | Biomarker name patterns, aliases, normal ranges |
| **Biomarker Definitions** | `data/biomarkerDefinitions.ts` | Standard biomarker catalog |
| **Service Index** | `index.ts` | Barrel export for all services |

### Service Interaction Diagram

```
  Controllers
      |
      v
  +---+---+
  |       |
  v       v
 Services   Middleware
  |   |       |
  +---+-------+---+---+---+
  |       |       |       |
  v       v       v       v
Prisma  GCS    Claude  SendGrid
(DB)  (Files)  (AI)   (Email)
```

---

## Security Architecture

### Encryption Layers

| Layer | Method | Details |
|-------|--------|---------|
| **Transport** | TLS 1.2+ | Enforced by Cloud Run (HTTPS only) |
| **Application (PHI)** | AES-256-GCM | Per-user keys derived via PBKDF2-SHA512, 100K iterations |
| **Database (at-rest)** | Cloud SQL encryption | Google-managed encryption keys |
| **Passwords** | bcrypt | 12 rounds, with timing-safe comparison |
| **CSRF Tokens** | crypto.randomBytes | 32 bytes, timing-safe comparison |
| **File Storage** | GCS default encryption | Server-side encryption at rest |

### PHI Encryption Details

**Algorithm:** AES-256-GCM (Authenticated Encryption with Associated Data)

**Key Hierarchy:**
```
  PHI_ENCRYPTION_KEY (env var, 256-bit hex)
         |
         v
  Master Key (Buffer)
         |
         +---> encryptWithMasterKey() ---> Encrypt user salts
         |
         +---> PBKDF2(masterKey, userSalt, 100000, SHA-512)
                    |
                    v
              Per-User Derived Key (256-bit)
                    |
                    +---> encrypt(plaintext, userSalt) ---> iv:authTag:ciphertext (Base64)
                    +---> decrypt(ciphertext, userSalt) ---> plaintext
```

**Data Format:** `{iv_base64}:{authTag_base64}:{ciphertext_base64}`
- IV: 16 bytes (random per encryption, ensures unique ciphertext)
- Auth Tag: 16 bytes (integrity verification)
- Ciphertext: Variable length

**Protected Fields by Model:**

| Model | Encrypted Fields |
|-------|-----------------|
| User | firstNameEncrypted, lastNameEncrypted, dateOfBirthEncrypted, phoneEncrypted, addressEncrypted |
| Biomarker | valueEncrypted, notesEncrypted |
| BiomarkerHistory | valueEncrypted |
| InsurancePlan | memberIdEncrypted, groupIdEncrypted |
| ProviderPatient | notesEncrypted |
| HealthNeed | descriptionEncrypted |
| HealthGoal | descriptionEncrypted |
| GoalProgressHistory | noteEncrypted |
| DNAVariant | genotypeEncrypted |
| GeneticTrait | descriptionEncrypted, recommendationsEncrypted |
| ExpenseProjection | serviceType, estimatedCost, notes |
| ExpenseActual | serviceType, providerName, billedAmount, insurancePaid, patientPaid, appliedToDeductible, appliedToOop, notes |
| CostAnalysis | claudeResponse, totalProjectedOop, projectedExpensesSnapshot |
| AuditLog | previousValueEncrypted, newValueEncrypted |

### Authentication Security

| Feature | Implementation |
|---------|---------------|
| Access Tokens | JWT, HS256, 15-minute expiry |
| Refresh Tokens | JWT, HS256, 7-day expiry, DB-backed sessions |
| Token Storage | HttpOnly, Secure, SameSite cookies (not localStorage) |
| Token Extraction | Cookie priority, Authorization header fallback |
| Brute Force Protection | 5 login attempts per 15 min (per email+IP) |
| Account Lockout | 5 failed attempts = 30-minute lockout |
| Password Requirements | 8+ chars, uppercase, lowercase, number, special char |
| Password Hashing | bcrypt, 12 rounds |
| Email Verification | Required before login, 24-hour token expiry |
| Password Reset | 1-hour token expiry, rate-limited |
| Session Management | DB-backed, multi-device, selective/total logout |
| Demo Account | Blocked in production via startup validation |

### Row-Level Security (RLS)

PostgreSQL RLS policies enforce data isolation at the database level:

```sql
-- Example policy: Users can only read their own biomarkers
CREATE POLICY biomarkers_user_policy ON biomarkers
  USING (
    user_id::text = current_setting('app.current_user_id', true)
    OR current_setting('app.is_admin', true) = 'true'
  );
```

**Application Usage:**
```typescript
// User context - restricted to own data
const biomarkers = await withRLSContext(userId, async () => {
  return prisma.biomarker.findMany();
});

// Admin/system context - bypasses RLS
await withRLSContext(null, async () => {
  return prisma.user.findMany();
});

// Transaction with RLS
await withRLSTransaction(userId, async (tx) => {
  await tx.biomarker.create({ data: {...} });
  await tx.auditLog.create({ data: {...} });
});
```

**Security controls:**
- UUID format validation before `$executeRawUnsafe` calls (prevents SQL injection)
- `SET LOCAL` scopes context to current transaction only
- Context automatically cleared in `finally` block

### CSRF Protection

**Pattern:** Double-submit cookie

1. Server sets `csrf_token` cookie (readable by JavaScript, `httpOnly: false`)
2. Client reads cookie and sends value in `X-CSRF-Token` header
3. Server validates cookie value matches header value (timing-safe comparison)

**Exemptions:**
- Public auth routes (login, register, etc.) - no session to protect
- File upload routes - use Bearer token (not auto-sent by browser)
- Settings routes - use Bearer token
- GET/HEAD/OPTIONS - non-state-changing

### Input Validation

All API input is validated using Zod schemas with:
- String sanitization (trim, HTML entity encoding)
- UUID format validation on all ID parameters
- Strong password requirements
- Email normalization (lowercase, trim)
- Numeric range validation
- Enum value validation
- Array length limits (e.g., max 100 biomarkers per batch)

### Production Startup Validation

The server refuses to start in production if any of these checks fail:
- `JWT_ACCESS_SECRET` not set or uses default value
- `JWT_REFRESH_SECRET` not set or uses default value
- `DATABASE_URL` not set
- `PHI_ENCRYPTION_KEY` not set, too short, non-hex, or known placeholder
- `CORS_ORIGIN` contains localhost
- `DEMO_ACCOUNT_ENABLED` is true
- JWT secrets shorter than 32 characters
- Database connection fails
- Encryption service initialization fails
- Audit logging service initialization fails

---

## Middleware Stack

Request processing order as configured in `backend/src/app.ts`:

| # | Middleware | Module | Purpose |
|---|-----------|--------|---------|
| 1 | **Trust Proxy** | Express built-in | `trust proxy = 1` for Cloud Run. Ensures `req.ip` reflects real client IP, not load balancer. Critical for rate limiting and audit logging. |
| 2 | **Helmet** | `helmet` | Security HTTP headers: CSP, X-Frame-Options, X-Content-Type-Options, HSTS, etc. Cross-origin policies relaxed for cross-domain cookie setups. |
| 3 | **CORS** | `cors` | Origin validation against allowlist. Credentials enabled for cookie auth. Explicit origin matching (no wildcards). Preflight cached 24h. |
| 4 | **Cookie Parser** | `cookie-parser` | Parses `access_token`, `refresh_token`, and `csrf_token` cookies. |
| 5 | **CSRF Protection** | `middleware/csrf.ts` | Double-submit cookie pattern. Validates `X-CSRF-Token` header matches `csrf_token` cookie. Timing-safe comparison. Skips public/upload routes. |
| 6 | **Rate Limiting** | `middleware/rateLimiter.ts` | Global: 100 req/15min. Six named limiters (see below). |
| 7 | **Morgan** | `morgan` | HTTP request logging. `dev` format in development, `combined` in production. |
| 8 | **Body Parser** | Express built-in | JSON (10MB limit) + URL-encoded body parsing. |
| 9 | **Content-Type Validation** | `middleware/validation.ts` | Requires `application/json` for POST/PUT/PATCH with body. Skips multipart (uploads). |
| 10 | **Routes** | `routes/index.ts` | 12 route modules mounted at `/api/v1/`. |
| 11 | **404 Handler** | `middleware/errorHandler.ts` | Catches unmatched routes. |
| 12 | **Error Handler** | `middleware/errorHandler.ts` | Centralized error handling. Prisma, JWT, and Zod-aware. Sanitizes error messages in production. Never exposes stack traces. |

### Rate Limiters

| Limiter | Window | Max | Applied To |
|---------|--------|-----|------------|
| `standardLimiter` | 15 min | 100 | All routes (global) |
| `authLimiter` | 15 min | 20 | All auth routes |
| `strictAuthLimiter` | 15 min | 5 | Login and forgot-password (per email+IP, skips successful) |
| `uploadLimiter` | 1 hour | 20 | File upload endpoints |
| `sensitiveLimiter` | 1 hour | 10 | Permanent user deletion |
| `bulkOperationLimiter` | 1 hour | 30 | Batch biomarker creation |

### Per-Route Middleware

Beyond the global stack, routes apply additional middleware:

| Route Group | Additional Middleware |
|-------------|---------------------|
| All biomarker routes | `authenticate` |
| All insurance routes | `authenticate` |
| All health-goals routes | `authenticate` |
| All health-needs routes | `authenticate` |
| Provider routes | `authenticate` + `requireRole('PROVIDER', 'ADMIN')` |
| Patient routes | `authenticate` + `requireRole('PATIENT')` |
| Admin routes | `authenticate` + `requireRole('ADMIN')` |
| Upload routes | `authenticate` + `uploadLimiter` + `multer` |
| Expense mutations | `authenticate` + `csrfProtection` |

---

## Role-Based Access Control

### Role Hierarchy

| Role | Level | Capabilities |
|------|-------|-------------|
| **PATIENT** | 1 | Full CRUD on own data. Manage provider consent (approve/deny/revoke). View own biomarkers, insurance, health needs, health goals. Request AI guidance. Export/delete own data. |
| **PROVIDER** | 2 | All PATIENT capabilities for own account. View authorized patient biomarkers (requires `canViewBiomarkers`). View authorized patient health needs (requires `canViewHealthNeeds`). View authorized patient insurance (requires `canViewInsurance`). Request patient access by email. Cannot view unauthorized patients. |
| **ADMIN** | 3 | All PROVIDER capabilities. Full user management (CRUD any user). View system-wide statistics. Query audit logs with filtering. Manage any provider-patient relationship. Permanent user deletion. Bypass RLS via admin context. |

### Granular Provider Permissions

When a patient approves a provider, they set five independent permission flags:

| Permission | Default | Controls |
|------------|---------|----------|
| `canViewBiomarkers` | true | Read patient biomarker data |
| `canViewInsurance` | false | Read patient insurance plans |
| `canViewDna` | false | Read patient DNA/genetic data |
| `canViewHealthNeeds` | true | Read patient health needs |
| `canEditData` | false | Write to patient data |

Patients can update these permissions at any time via `PATCH /patient/providers/:id`.

### Permission Matrix by Resource

| Resource | PATIENT | PROVIDER | ADMIN |
|----------|---------|----------|-------|
| Biomarker (own) | Read, Write, Delete | Read, Write, Delete | Read, Write, Delete, Admin |
| Biomarker (other) | Denied | Read (if canViewBiomarkers), Write (if canEditData) | Full |
| Insurance (own) | Read, Write, Delete | Read, Write, Delete | Read, Write, Delete, Admin |
| Insurance (other) | Denied | Read (if canViewInsurance) | Full |
| Health Need (own) | Read, Write, Delete | Read, Write, Delete | Read, Write, Delete, Admin |
| Health Need (other) | Denied | Read (if canViewHealthNeeds) | Full |
| DNA (own) | Read, Write, Delete | Read, Write, Delete | Read, Write, Delete, Admin |
| DNA (other) | Denied | Read (if canViewDna) | Full |
| User Profile (own) | Read, Write | Read, Write | Full |
| User Profile (other) | Denied | Read (limited) | Full |
| Provider-Patient | Read, Write (manage own) | Read, Write, Delete | Full |
| Audit Logs | Denied | Denied | Full |
| System Stats | Denied | Denied | Full |

---

## Infrastructure Details

### Cloud Run Configuration

| Setting | Value |
|---------|-------|
| Service Name | `ownmyhealth-backend` |
| Region | `us-central1` |
| Project ID | `ownmyhealth-prod` |
| Container Image | `us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend` |
| Runtime | Node.js 20 Alpine (multi-stage Docker) |
| Port | 3001 |
| Health Check | `GET /health` (30s interval, 10s timeout, 3 retries) |
| Startup Command | `npx prisma migrate deploy && node dist/app.js` |
| Non-root User | `nodejs` (uid 1001) |

### Docker Build (Multi-Stage)

```
  Stage 1: builder (node:20-alpine)
    - npm ci (all dependencies)
    - prisma generate
    - tsc (TypeScript compile)

  Stage 2: production (node:20-alpine)
    - npm ci --omit=dev (production only)
    - prisma generate
    - COPY dist/ and generated/ from builder
    - Non-root user (nodejs:1001)
    - HEALTHCHECK configured
    - CMD: prisma migrate deploy + node dist/app.js
```

### Frontend Hosting

| Setting | Value |
|---------|-------|
| Bucket | `ownmyhealth-frontend` (GCS) |
| Build | Vite production build |
| API URL | `https://api.ownmyhealth.io/api/v1` (via `VITE_API_URL`) |
| Cache | `index.html`: no-cache, no-store, must-revalidate |
| Chunk Splitting | `pdf` (pdfjs, jspdf, html2canvas), `ocr` (tesseract.js), `charts` (recharts, d3) |

### CI/CD Pipeline (GitHub Actions)

```
  Trigger: push to main/master OR manual dispatch

  +---------------------+     +------------------------+
  |  deploy-backend     |     |  deploy-frontend       |
  |  (parallel)         |     |  (parallel)            |
  +---------------------+     +------------------------+
  | 1. Checkout         |     | 1. Checkout            |
  | 2. Google Auth      |     | 2. Google Auth         |
  | 3. Setup gcloud     |     | 3. Setup gcloud        |
  | 4. Configure Docker |     | 4. Setup Node.js 20    |
  |    for Artifact Reg. |     | 5. npm ci              |
  | 5. Docker build     |     | 6. npm run build       |
  |    (cd backend/)    |     |    (VITE_API_URL set)  |
  | 6. Docker push      |     | 7. gsutil rm old files |
  |    (:sha + :latest) |     | 8. gsutil cp dist/*    |
  | 7. gcloud run deploy|     | 9. Set cache headers   |
  +---------------------+     +------------------------+
```

### Database Configuration

| Setting | Value |
|---------|-------|
| Engine | PostgreSQL (Cloud SQL) |
| Connection | Via Cloud SQL Auth Proxy |
| Pool Size | 5 connections max |
| Idle Timeout | 30,000ms |
| Connection Timeout | 30,000ms |
| Statement Timeout | 30,000ms |
| RLS | Enabled with per-user session variables |
| Migrations | Auto-deployed on container start |

### Environment Variables (20+)

| Category | Variables |
|----------|-----------|
| **Server** | `NODE_ENV`, `PORT` |
| **JWT** | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_SECONDS`, `JWT_REFRESH_EXPIRES_SECONDS` |
| **Database** | `DATABASE_URL` |
| **Encryption** | `PHI_ENCRYPTION_KEY` |
| **CORS** | `CORS_ORIGIN` |
| **Cookies** | `COOKIE_DOMAIN`, `COOKIE_SAME_SITE` |
| **CSRF** | `CSRF_SECRET`, `DISABLE_CSRF` (dev only) |
| **Email** | `SENDGRID_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `FRONTEND_URL` |
| **GCP** | `GCS_BUCKET_NAME`, `GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` |
| **Document AI** | `GCP_PROCESSOR_ID`, `GCP_LOCATION` |
| **AI** | `ANTHROPIC_API_KEY` |
| **Rate Limiting** | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` |
| **Security** | `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES`, `BCRYPT_ROUNDS` |
| **Demo** | `DEMO_ACCOUNT_ENABLED`, `DEMO_EMAIL`, `DEMO_PASSWORD` |

---

## Cost Breakdown

Estimated monthly costs for a low-to-moderate traffic deployment (< 1,000 users):

| Service | Provider | Monthly Estimate | Notes |
|---------|----------|-----------------|-------|
| **Cloud Run** | GCP | $5 - $30 | Pay-per-request, scales to zero. 2M free requests/month. |
| **Cloud SQL (PostgreSQL)** | GCP | $10 - $50 | db-f1-micro or db-g1-small. ~$7/month for micro. |
| **Cloud Storage** | GCP | $1 - $5 | Standard storage, typically < 10GB. $0.020/GB/month. |
| **Artifact Registry** | GCP | $1 - $3 | Docker image storage. ~$0.10/GB/month. |
| **Claude API (Haiku 4.5)** | Anthropic | $2 - $15 | Biomarker guidance: ~$0.0025/request. Lab extraction: ~$0.01/PDF. |
| **Claude API (Sonnet 4)** | Anthropic | $5 - $25 | SBC extraction: ~$0.05-0.15/PDF (16K token output). |
| **Document AI** | GCP | $0 - $10 | 1,000 pages/month free. $1.50/1,000 pages after. |
| **SendGrid** | Twilio | $0 | Free tier: 100 emails/day. Sufficient for < 1,000 users. |
| **GitHub Actions** | GitHub | $0 | Free tier: 2,000 min/month for public repos, 3,000 for Pro. |
| **Domain/DNS** | Various | $10 - $15 | Annual domain + Cloud DNS. |
| **SSL Certificate** | GCP | $0 | Managed by Cloud Run (auto-provisioned). |
| | | | |
| **Total (estimated)** | | **$35 - $155/month** | Scales with usage. Could be as low as $20/month at minimal traffic. |

### Per-User AI Cost Estimates

| Action | Model | Avg Cost/Request | Monthly per Active User |
|--------|-------|-----------------|------------------------|
| Biomarker guidance | Haiku 4.5 (600 tokens) | ~$0.002 | ~$0.02 (10 requests) |
| Lab report extraction | Haiku 4.5 (8K tokens) | ~$0.01 | ~$0.02 (2 uploads) |
| SBC extraction | Sonnet 4 (16K tokens) | ~$0.10 | ~$0.10 (1 upload) |
| Cost analysis | Claude API | ~$0.02 | ~$0.04 (2 analyses) |
| **Total AI per user** | | | **~$0.18/month** |

---

## File Structure

```
OwnMyHealth/
|-- .github/
|   `-- workflows/
|       `-- deploy.yml              # CI/CD: Cloud Run + GCS deployment
|
|-- backend/
|   |-- prisma/
|   |   |-- schema.prisma           # 19 models, 14 enums, all indexes
|   |   |-- migrations/             # Prisma migration files
|   |   `-- prisma.config.ts        # Prisma configuration
|   |-- src/
|   |   |-- app.ts                  # Express entry point, middleware stack
|   |   |-- config/
|   |   |   `-- index.ts            # All environment config (20+ vars)
|   |   |-- controllers/            # 10 route handler files
|   |   |   |-- authController.ts
|   |   |   |-- biomarkerController.ts
|   |   |   |-- expenseController.ts
|   |   |   |-- fileController.ts
|   |   |   |-- healthGoalsController.ts
|   |   |   |-- healthNeedsController.ts
|   |   |   |-- insuranceController.ts
|   |   |   |-- settingsController.ts
|   |   |   `-- uploadController.ts
|   |   |-- middleware/             # 8 middleware modules
|   |   |   |-- auth.ts            # JWT verification
|   |   |   |-- csrf.ts            # CSRF double-submit cookie
|   |   |   |-- demoProtection.ts  # Demo account restrictions
|   |   |   |-- errorHandler.ts    # Centralized errors (11 types)
|   |   |   |-- rateLimiter.ts     # 6 named rate limiters
|   |   |   |-- rbac.ts            # Role/permission/ownership checks
|   |   |   |-- validation.ts      # Zod schemas, sanitization
|   |   |   `-- index.ts           # Barrel export
|   |   |-- routes/                # 13 route files
|   |   |   |-- index.ts           # Route mounting + health/info
|   |   |   |-- authRoutes.ts      # 12 auth endpoints
|   |   |   |-- biomarkerRoutes.ts # 10 biomarker endpoints
|   |   |   |-- insuranceRoutes.ts # 10 insurance endpoints
|   |   |   |-- expenseRoutes.ts   # 6 expense endpoints
|   |   |   |-- healthGoalsRoutes.ts # 8 goal endpoints
|   |   |   |-- healthNeedsRoutes.ts # 6 need endpoints
|   |   |   |-- providerRoutes.ts  # 7 provider endpoints
|   |   |   |-- patientRoutes.ts   # 7 patient endpoints
|   |   |   |-- adminRoutes.ts     # 10 admin endpoints
|   |   |   |-- uploadRoutes.ts    # 3 upload endpoints
|   |   |   |-- fileRoutes.ts      # 4 file endpoints
|   |   |   `-- settingsRoutes.ts  # 3 settings endpoints
|   |   |-- services/              # 18 service files
|   |   |   |-- database.ts        # Prisma + RLS context
|   |   |   |-- encryption.ts      # AES-256-GCM + PHI_FIELDS
|   |   |   |-- userEncryption.ts  # Per-user PBKDF2 keys
|   |   |   |-- authService.ts     # Auth logic + session cleanup
|   |   |   |-- auditLog.ts        # HIPAA audit trail
|   |   |   |-- claudeExtraction.ts # Lab report AI extraction
|   |   |   |-- sbcExtraction.ts   # Insurance SBC AI extraction
|   |   |   |-- storageService.ts  # GCS upload/download/delete
|   |   |   |-- emailService.ts    # SendGrid email
|   |   |   |-- ocrService.ts      # Document AI OCR
|   |   |   |-- pdfParser.ts       # PDF text extraction
|   |   |   |-- biomarkerExtractor.ts # Pattern matching
|   |   |   |-- biomarkerPatterns.ts  # Biomarker definitions
|   |   |   `-- data/
|   |   |       `-- biomarkerDefinitions.ts
|   |   |-- types/                 # TypeScript interfaces
|   |   `-- utils/
|   |       `-- logger.ts          # Structured logging
|   |-- Dockerfile                 # Multi-stage Node 20 Alpine
|   |-- package.json               # Backend dependencies
|   `-- tsconfig.json
|
|-- src/                           # Frontend source
|   |-- components/
|   |   |-- analytics/             # TrendChart, BiomarkerChart
|   |   |-- auth/                  # Login, Register, Verify, Reset
|   |   |-- biomarkers/            # Display, Entry, Modals, AI Guidance
|   |   |-- common/                # Button, Modal, RoleGuard, etc.
|   |   |-- dashboard/             # Main dashboard
|   |   |-- files/                 # File list, download, delete
|   |   |-- insurance/             # Insurance hub, SBC upload
|   |   |-- settings/              # Export, deletion
|   |   |-- trends/                # Visualizations
|   |   `-- upload/                # Upload components
|   |-- contexts/
|   |   |-- AuthContext.tsx         # Auth state management
|   |   `-- ThemeContext.tsx        # Theme state
|   |-- services/
|   |   `-- api/                   # 13 API client modules
|   |       |-- client.ts          # Axios base client + interceptors
|   |       |-- auth.ts
|   |       |-- biomarkers.ts
|   |       |-- insurance.ts
|   |       |-- expenses.ts
|   |       |-- healthGoals.ts
|   |       |-- healthNeeds.ts
|   |       |-- files.ts
|   |       |-- upload.ts
|   |       |-- provider.ts
|   |       |-- patient.ts
|   |       |-- admin.ts
|   |       |-- settings.ts
|   |       `-- index.ts
|   |-- types/                     # TypeScript interfaces
|   `-- data/                      # Sample data, nav config
|
|-- vite.config.ts                 # Vite + React, chunk splitting
|-- package.json                   # Frontend dependencies
|-- tailwind.config.js
|-- postcss.config.js
|-- tsconfig.json
`-- CLAUDE.md                      # Project context for AI assistance
```

---

## Appendix: Background Schedulers

The server runs two background schedulers:

| Scheduler | Interval | Purpose |
|-----------|----------|---------|
| **Session Cleanup** | Periodic | Removes expired refresh token sessions from the `sessions` table |
| **Audit Log Cleanup** | Daily (24h) | Removes audit log entries older than 2,555 days (~7 years) per HIPAA retention requirements |

Both schedulers are started on server boot and gracefully stopped on SIGTERM/SIGINT.
