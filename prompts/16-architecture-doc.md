---
tags:
  - documentation
  - architecture
type: prompt
priority: 2
---

# Generate ARCHITECTURE.md

## Purpose
Create or update the system architecture document for OwnMyHealth.

## From Codebase (Claude Code)
1. Read `backend/prisma/schema.prisma` - document all 15+ models
2. Read `backend/src/routes/*.ts` - list all 13 route files, 60+ API endpoints
3. Read `backend/src/services/*.ts` - identify all 18 service files
4. Read `backend/src/middleware/*.ts` - document security middleware stack (8 files)
5. Read `package.json` (both root and backend) - identify tech stack
6. Read `backend/Dockerfile` - identify runtime (Node 20 Alpine, multi-stage)
7. Read `vite.config.ts` - identify frontend config and chunk splitting
8. Read `.github/workflows/deploy.yml` - identify deployment architecture
9. Read `backend/src/config/index.ts` - identify all configuration

## Questions to Ask

### System Overview
1. Can you describe the high-level architecture?
2. What are the main components and how do they connect?
3. What external services are integrated?
   - Anthropic Claude API (AI guidance, cost analysis, document extraction)
   - Google Cloud Storage (file uploads)
   - Google Document AI (OCR for lab reports)
   - SendGrid (transactional emails)

### Infrastructure
1. Where is frontend hosted? (GCS bucket: ownmyhealth-frontend)
2. Where is backend hosted? (Cloud Run: ownmyhealth-prod, us-central1)
3. What database is used and where? (PostgreSQL on Cloud SQL)
4. What file storage is used? (Google Cloud Storage)

### Data Flow
1. How does user authentication work? (JWT + HttpOnly cookies + refresh tokens)
2. How does PDF upload and extraction work? (Multer → PDF parser → Claude/OCR → GCS)
3. How does insurance plan parsing work? (SBC PDF → Claude extraction → plan creation)
4. How does provider-patient data sharing work? (consent request → approval → scoped access)
5. How does AI biomarker guidance work? (biomarker data → Claude API → educational response)

### Security Architecture
1. How is PHI encrypted? (AES-256-GCM, per-user keys via PBKDF2)
2. How does Row-Level Security work? (`withRLSContext` + PostgreSQL policies)
3. How is cross-user access controlled? (ProviderPatient consent with granular permissions)
4. How are audit logs maintained? (HIPAA 7-year retention, immutable, encrypted PHI values)

### Costs
1. What's the estimated monthly cost per service?
2. What's the total monthly infrastructure cost?
3. What's the Claude API cost estimate per user?

## Output Format

```markdown
# OwnMyHealth Architecture

**Last Updated:** [Date]

## System Overview
[ASCII diagram]

## Technology Stack

### Frontend
| Component | Technology |
|-----------|------------|
| Framework | React |
...

### Backend
| Component | Technology |
|-----------|------------|
| Runtime | Node.js |
...

### Database
| Component | Technology |
|-----------|------------|
| Engine | PostgreSQL |
...

### External Services
| Service | Provider | Purpose |
|---------|----------|---------|
| AI/LLM | Anthropic Claude | Biomarker guidance, cost analysis, document extraction |
| File Storage | Google Cloud Storage | Lab reports, SBC documents, clinical files |
| OCR | Google Document AI | Scanned lab report text extraction |
| Email | SendGrid | Verification, password reset, notifications |
...

## Data Flow Diagrams

### Authentication Flow
[ASCII diagram: Register → Verify Email → Login → JWT + Refresh → Session]

### PDF Upload Flow
[ASCII diagram: Upload → Multer → PDF Parse → Claude/OCR → Extract → Encrypt → Store]

### Provider-Patient Access Flow
[ASCII diagram: Provider Request → Patient Review → Grant Permissions → Scoped Data Access]

### AI Guidance Flow
[ASCII diagram: User Request → Biomarker Data → Claude API → Response → Encrypt → Display]

## Database Schema

### Core Tables
[Table descriptions and relationships]

### Indexes
[Key indexes]

## Security Architecture

### Encryption
| Layer | Method |
|-------|--------|
...

### Authentication
[Description]

## Infrastructure Details

### Cloud Run Configuration
| Setting | Value |
|---------|-------|
...

### Cost Breakdown
| Service | Monthly Cost |
|---------|-------------|
...

## Middleware Stack (Request Processing Order)
1. Helmet (security headers)
2. CORS (origin validation)
3. Cookie Parser
4. CSRF Protection (double-submit cookie)
5. Rate Limiting (global + endpoint-specific)
6. Body Parser (JSON, 10MB limit)
7. Routes (API endpoint handlers)
8. Error Handler (centralized)
9. 404 Handler

## Role-Based Access Control
| Role | Level | Capabilities |
|------|-------|-------------|
| PATIENT | 1 | Own data, manage provider consent |
| PROVIDER | 2 | + View authorized patient data |
| ADMIN | 3 | + User management, audit logs, system stats |

## File Structure
[Key directories and purposes]
```
