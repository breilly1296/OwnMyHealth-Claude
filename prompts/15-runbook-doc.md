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
1. Check `backend/Dockerfile` for runtime environment
2. Check `.github/workflows/` for CI/CD pipeline details
3. Check `backend/src/config/` for environment variables
4. Check `package.json` scripts for available commands

## Questions to Ask

### Infrastructure
1. What cloud provider and region?
2. What's the GCP project ID?
3. What are the production URLs?
   - Frontend URL
   - Backend API URL
   - Health check endpoint

### Database
1. What's the Cloud SQL instance name?
2. What's the database name?
3. What's the database user?
4. What are common database queries you run?

### Secrets
1. What secrets exist in Secret Manager?
2. What is each secret used for?
3. How do you update a secret?

### Deployment
1. How does deployment work (CI/CD flow)?
2. How do you manually deploy backend?
3. How do you manually deploy frontend?
4. How do you rollback a deployment?

### Monitoring
1. How do you view logs?
2. What log filters do you use most?
3. What alerts are configured?

### Emergencies
1. What emergency procedures have you needed?
2. How do you fix database connection issues?
3. How do you fix authentication issues?

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
