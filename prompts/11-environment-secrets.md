---
tags:
  - security
  - infrastructure
  - critical
type: prompt
priority: 1
---

# Environment & Secrets Review

## Files to Review
- `backend/src/config/index.ts` (config loading)
- `.env.example` (documented variables)
- `backend/.env.example` (backend-specific)
- `.github/workflows/deploy.yml` (CI/CD secrets)
- `Dockerfile` (build-time variables)

## OwnMyHealth Secrets Architecture
- **Secret Storage**: GCP Secret Manager
- **Access**: Mounted as environment variables in Cloud Run
- **Local Dev**: `.env` files (not committed)

## Checklist

### 1. Secret Manager Inventory
Verify these secrets exist and are used:

**Critical Secrets (Secret Manager):**
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `JWT_ACCESS_SECRET` - Access token signing
- [ ] `JWT_REFRESH_SECRET` - Refresh token signing
- [ ] `PHI_ENCRYPTION_KEY` - AES encryption key (64 hex chars, 256-bit)
- [ ] `ANTHROPIC_API_KEY` - Claude API access
- [ ] `SENDGRID_API_KEY` - Email service
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` - GCP service account

**Configuration Variables (Environment):**
- [ ] `NODE_ENV` - Runtime mode
- [ ] `PORT` - Server port (3001)
- [ ] `CORS_ORIGIN` - Allowed frontend origins
- [ ] `GCS_BUCKET_NAME` - Google Cloud Storage bucket
- [ ] `GCP_PROJECT_ID` - GCP project identifier
- [ ] `EMAIL_FROM` - Sender email address
- [ ] `EMAIL_FROM_NAME` - Sender display name
- [ ] `FRONTEND_URL` - Frontend URL for email links

**Security Configuration:**
- [ ] `MAX_LOGIN_ATTEMPTS` - Account lockout threshold (default: 5)
- [ ] `LOCKOUT_DURATION_MINUTES` - Lockout duration (default: 30)
- [ ] `BCRYPT_ROUNDS` - Password hashing cost (default: 12)

**Demo Configuration (non-production only):**
- [ ] `DEMO_ACCOUNT_ENABLED` - Enable demo login
- [ ] `DEMO_EMAIL` - Demo account email
- [ ] `DEMO_PASSWORD` - Demo account password

### 2. No Hardcoded Secrets
Search for hardcoded values:
```bash
# Search for potential hardcoded secrets
grep -r "sk-ant\|password.*=.*['\"]" backend/src/ --include="*.ts"
grep -r "secret.*=.*['\"]" backend/src/ --include="*.ts" | grep -v "process.env"
```
- [ ] No API keys in source code
- [ ] No passwords in source code
- [ ] No connection strings in source code

### 3. Environment Variable Documentation
- [ ] All required variables documented in `.env.example`
- [ ] Optional variables marked as optional
- [ ] Example values don't contain real secrets
- [ ] Format/validation requirements noted

### 4. Secret Rotation
- [ ] Secrets can be rotated without code changes
- [ ] Process documented for rotating each secret
- [ ] No secrets embedded in Docker images

### 5. CI/CD Secrets
GitHub Actions secrets required:
- [ ] `GCP_PROJECT_ID`
- [ ] `GCP_SA_KEY` (service account JSON)
- [ ] `GCP_REGION`
- [ ] Secrets not echoed in logs

### 6. Local Development
- [ ] `.env` files in `.gitignore`
- [ ] `.env.local` files in `.gitignore`
- [ ] No real secrets in committed files
- [ ] Clear instructions for local setup

### 7. Secret Access Patterns
- [ ] Secrets loaded once at startup
- [ ] Lazy initialization where needed (Anthropic)
- [ ] Missing secrets cause clear error messages
- [ ] Secrets not logged even in debug mode

## Environment Variable Reference

| Variable | Required | Source | Purpose |
|----------|----------|--------|---------|
| DATABASE_URL | Yes | Secret Manager | DB connection |
| JWT_ACCESS_SECRET | Yes | Secret Manager | Token signing |
| JWT_REFRESH_SECRET | Yes | Secret Manager | Refresh signing |
| PHI_ENCRYPTION_KEY | Yes | Secret Manager | PHI encryption |
| ANTHROPIC_API_KEY | Yes | Secret Manager | Claude API |
| SENDGRID_API_KEY | Yes | Secret Manager | Email service |
| GOOGLE_APPLICATION_CREDENTIALS | Yes | Secret Manager | GCP auth |
| NODE_ENV | Yes | Environment | Runtime mode |
| PORT | No | Environment | Server port |
| CORS_ORIGIN | Yes | Environment | Allowed origins |
| GCS_BUCKET_NAME | Yes | Environment | File storage |
| GCP_PROJECT_ID | Yes | Environment | GCP project |
| EMAIL_FROM | Yes | Environment | Sender email |
| EMAIL_FROM_NAME | No | Environment | Sender name |
| FRONTEND_URL | Yes | Environment | Email link base |
| MAX_LOGIN_ATTEMPTS | No | Environment | Lockout threshold |
| LOCKOUT_DURATION_MINUTES | No | Environment | Lockout duration |
| BCRYPT_ROUNDS | No | Environment | Hash cost |
| DEMO_ACCOUNT_ENABLED | No | Environment | Demo mode flag |
| DEMO_EMAIL | No | Environment | Demo email |
| DEMO_PASSWORD | No | Environment | Demo password |

## Questions to Ask
1. Are all secrets documented?
2. Can secrets be rotated without deployment?
3. Are there any secrets in the Git history?
