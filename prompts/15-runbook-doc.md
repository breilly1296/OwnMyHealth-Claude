---
tags:
  - documentation
  - operations
type: prompt
priority: 2
---

# Generate RUNBOOK.md

## Purpose
Create or update the operations runbook with all commands needed to manage OwnMyHealth.

## From Codebase (Claude Code)
1. Check `backend/Dockerfile` for runtime environment (Node 20 Alpine, multi-stage)
2. Check `.github/workflows/ci.yml` for CI pipeline (lint, test, build)
3. Check `.github/workflows/deploy.yml` for deployment (Cloud Run + GCS)
4. Check `backend/src/config/index.ts` for all environment variables (20+)
5. Check `package.json` scripts for available commands (both root and backend)
6. Check `backend/src/services/database.ts` for DB connection and RLS setup
7. Check `backend/src/services/auditLog.ts` for audit cleanup scheduler
8. Check `backend/src/services/authService.ts` for session cleanup scheduler

## Questions to Ask

### Infrastructure
1. What cloud provider and region? (GCP, us-central1)
2. What's the GCP project ID? (ownmyhealth-prod)
3. What are the production URLs?
   - Frontend URL (GCS bucket: ownmyhealth-frontend)
   - Backend API URL (Cloud Run service)
   - Health check endpoint (`/health`, `/api/v1/health`)

### Database
1. What's the Cloud SQL instance name?
2. What's the database name?
3. What's the database user?
4. What are common database queries you run?
5. How do you run Prisma migrations in production?

### Secrets
1. What secrets exist in Secret Manager? (See prompt 11 for full inventory — 20+ vars)
2. What is each secret used for?
3. How do you update a secret?
4. How do you rotate the PHI encryption key?

### Deployment
1. How does deployment work? (push to master → deploy.yml → Docker build → Cloud Run)
2. How do you manually deploy backend? (gcloud run deploy)
3. How do you manually deploy frontend? (vite build → gsutil cp to GCS)
4. How do you rollback a deployment? (Cloud Run revision rollback)

### Monitoring & Scheduled Tasks
1. How do you view logs? (gcloud logging)
2. What log filters do you use most?
3. What alerts are configured?
4. Session cleanup scheduler (runs every 10 min)
5. Audit log retention cleanup (runs daily, 7-year retention)

### AI & External Services
1. How do you monitor Claude API costs?
2. How do you check SendGrid email delivery status?
3. How do you verify GCS bucket health?
4. How do you check Google Document AI quotas?

### Emergencies
1. What emergency procedures have you needed?
2. How do you fix database connection issues?
3. How do you fix authentication issues?
4. How do you handle account lockouts?
5. How do you investigate unauthorized PHI access (audit log queries)?

## Output Format

```markdown
# OwnMyHealth Operations Runbook

**Last Updated:** [Date]

## Quick Reference
| Service | URL |
|---------|-----|
| Frontend | https://... |
| Backend | https://... |
| Health Check | https://... |

## 1. Deployment

### Backend (Automatic)
```bash
git push origin master
```

### Backend (Manual)
```bash
[commands]
```

### Frontend (Manual)
```bash
[commands]
```

## 2. Logs & Monitoring

### View Recent Logs
```bash
[commands]
```

### Filter by Error
```bash
[commands]
```

## 3. Database Operations

### Connect to Database
```bash
[command]
```

### Common Queries
```sql
[queries]
```

## 4. Secret Management

### List Secrets
```bash
[command]
```

### Update Secret
```bash
[command]
```

## 5. Emergency Procedures

### Rollback Deployment
```bash
[commands]
```

### Fix Database Connection
[steps]

## Credentials Reference
| Resource | Value |
|----------|-------|
| GCP Project | [id] |
| Cloud SQL Instance | [name] |
| Region | [region] |
```
