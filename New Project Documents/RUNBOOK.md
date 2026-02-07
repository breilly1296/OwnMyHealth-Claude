# OwnMyHealth Operations Runbook

**Last Updated:** 2026-02-06

---

## Quick Reference

| Resource | Value |
|----------|-------|
| GCP Project ID | `ownmyhealth-prod` |
| Region | `us-central1` |
| Cloud Run Service | `ownmyhealth-backend` |
| Artifact Registry | `us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend` |
| Frontend GCS Bucket | `ownmyhealth-frontend` |
| Domain | `ownmyhealth.io` |

| Service | URL |
|---------|-----|
| Frontend | `https://ownmyhealth.io` |
| Backend API | `https://api.ownmyhealth.io/api/v1` |
| Health Check (Docker) | `https://api.ownmyhealth.io/health` |
| Health Check (API) | `https://api.ownmyhealth.io/api/v1/health` |
| DB Health Check | `https://api.ownmyhealth.io/api/health/db` |

---

## 1. Deployment

### 1.1 Backend -- Automatic (CI/CD)

Pushing to `master` or `main` triggers `.github/workflows/deploy.yml`, which:

1. Authenticates to GCP using the `GCP_SA_KEY` repository secret.
2. Builds the Docker image from `backend/Dockerfile` (Node 20 Alpine, multi-stage).
3. Pushes to Artifact Registry with both a SHA tag and `latest` tag.
4. Deploys to Cloud Run service `ownmyhealth-backend` in `us-central1`.
5. On container start, runs `npx prisma migrate deploy` then `node dist/app.js`.

```bash
# Trigger automatic deployment
git push origin master
```

The `deploy.yml` also deploys the frontend in parallel (see Section 1.3).

### 1.2 Backend -- Manual Deployment

Use these commands if you need to bypass CI/CD and deploy directly.

```bash
# 1. Authenticate with GCP
gcloud auth login
gcloud config set project ownmyhealth-prod

# 2. Configure Docker for Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet

# 3. Build the Docker image
cd C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend
docker build -t us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:manual .

# 4. Push to Artifact Registry
docker push us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:manual

# 5. Deploy to Cloud Run
gcloud run deploy ownmyhealth-backend \
  --image us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:manual \
  --region us-central1 \
  --project ownmyhealth-prod \
  --platform managed
```

### 1.3 Frontend -- Automatic (CI/CD)

The `deploy.yml` workflow deploys the frontend in parallel with the backend:

1. Runs `npm ci` at project root.
2. Builds with `npm run build` (Vite) using `VITE_API_URL=https://api.ownmyhealth.io/api/v1`.
3. Clears the GCS bucket `ownmyhealth-frontend`.
4. Copies the `dist/` output to GCS.
5. Sets `Cache-Control: no-cache, no-store, must-revalidate` on `index.html`.

### 1.4 Frontend -- Manual Deployment

```bash
# 1. Authenticate
gcloud auth login
gcloud config set project ownmyhealth-prod

# 2. Build the frontend
cd C:\Users\breil\OneDrive\Desktop\OwnMyHealth
npm ci
VITE_API_URL=https://api.ownmyhealth.io/api/v1 npm run build

# 3. Clear existing bucket contents
gsutil -m rm -r gs://ownmyhealth-frontend/** || true

# 4. Upload new build
gsutil -m cp -r dist/* gs://ownmyhealth-frontend/

# 5. Set no-cache on index.html (SPA routing)
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" gs://ownmyhealth-frontend/index.html
```

### 1.5 CI Pipeline (Non-Deploy)

The `ci.yml` workflow runs on pushes to `main`, `master`, `develop`, and `claude/**` branches, and on PRs targeting those branches. It runs three parallel jobs:

| Job | What It Does |
|-----|-------------|
| **Frontend CI** | `npm install` -> `npm run lint` -> `npm run test` -> `npm run build` |
| **Backend CI** | `npm install` -> `npm run lint` -> `npx prisma generate` -> `npm run test:unit` -> `npm run build` |
| **Security Audit** | `npm audit --audit-level=high` for both frontend and backend |

---

## 2. Logs & Monitoring

### 2.1 View Recent Cloud Run Logs

```bash
# Last 100 log entries
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ownmyhealth-backend" \
  --project ownmyhealth-prod \
  --limit 100 \
  --format "table(timestamp, severity, textPayload)"

# Stream logs in real-time
gcloud run services logs tail ownmyhealth-backend \
  --region us-central1 \
  --project ownmyhealth-prod
```

### 2.2 Filter by Severity

```bash
# Errors only
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ownmyhealth-backend AND severity>=ERROR" \
  --project ownmyhealth-prod \
  --limit 50 \
  --format "table(timestamp, severity, textPayload)"

# Warnings and above
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ownmyhealth-backend AND severity>=WARNING" \
  --project ownmyhealth-prod \
  --limit 50 \
  --format "table(timestamp, severity, textPayload)"
```

### 2.3 Filter by Keyword

```bash
# Authentication failures
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ownmyhealth-backend AND textPayload:\"LOGIN_FAILED\"" \
  --project ownmyhealth-prod \
  --limit 50

# Database errors
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ownmyhealth-backend AND textPayload:\"FATAL: Database\"" \
  --project ownmyhealth-prod \
  --limit 20

# Audit log cleanup events
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ownmyhealth-backend AND textPayload:\"Cleaned up\"" \
  --project ownmyhealth-prod \
  --limit 20

# Rate limit hits
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ownmyhealth-backend AND textPayload:\"RATE_LIMIT\"" \
  --project ownmyhealth-prod \
  --limit 50
```

### 2.4 View Cloud Run Metrics (Console)

```bash
# Open Cloud Run service page in browser
gcloud run services describe ownmyhealth-backend \
  --region us-central1 \
  --project ownmyhealth-prod \
  --format "value(status.url)"
```

Key metrics to monitor in Cloud Console:
- **Request count** and **latency** (p50, p95, p99)
- **Container instance count** (watch for cold starts)
- **Memory utilization** (connection pool is capped at 5 connections)
- **Error rate** (5xx responses)

### 2.5 Scheduled Tasks

The backend runs two in-process schedulers that start automatically when the server boots:

| Task | Interval | Purpose |
|------|----------|---------|
| **Session Cleanup** | Every 1 hour | Deletes expired sessions from the `sessions` table |
| **Audit Log Cleanup** | Every 24 hours | Deletes audit logs older than 2,555 days (~7 years, HIPAA retention) |

Both schedulers log their activity:
- `[Auth] Cleaned up X expired sessions`
- `[AuditLog] Cleaned up X old audit logs`

**Note:** These schedulers run within the Cloud Run container. If the instance is scaled to zero, they will not execute until the next request wakes the container. Consider configuring Cloud Run minimum instances to 1 for compliance.

---

## 3. Database Operations

### 3.1 Connect via Cloud SQL Auth Proxy

```bash
# Start the Cloud SQL Auth Proxy
cloud-sql-proxy ownmyhealth-prod:us-central1:INSTANCE_NAME \
  --port 5432

# In another terminal, connect with psql
psql "postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE_NAME"
```

### 3.2 Run Prisma Migrations in Production

Migrations run automatically on container start via the Dockerfile CMD:
```
npx prisma migrate deploy && node dist/app.js
```

To run manually:
```bash
# Set DATABASE_URL to production, then:
cd C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

### 3.3 Database Schema Overview

The schema uses PostgreSQL with Prisma ORM. Key tables (mapped via `@@map`):

| Prisma Model | DB Table | Purpose |
|-------------|----------|---------|
| `User` | `users` | User accounts, auth, lockout fields |
| `Session` | sessions | Refresh token sessions (DB-backed) |
| `Biomarker` | biomarkers | Health biomarker entries (PHI encrypted) |
| `InsurancePlan` | insurance_plans | Insurance plan data (PHI encrypted) |
| `AuditLog` | audit_logs | HIPAA-compliant access logs |
| `HealthGoal` | health_goals | User health goals (PHI encrypted) |
| `HealthNeed` | health_needs | User health needs (PHI encrypted) |
| `UserFile` | user_files | File metadata (GCS storage) |
| `ProviderPatient` | provider_patients | Consent-based sharing |
| `SystemConfig` | system_configs | System configuration (audit salt, etc.) |

### 3.4 Common Queries

```sql
-- Count total users
SELECT COUNT(*) FROM users;

-- Count active users
SELECT COUNT(*) FROM users WHERE is_active = true;

-- List locked accounts
SELECT id, email, locked_until, failed_login_attempts
FROM users
WHERE locked_until > NOW();

-- Unlock a specific account
UPDATE users
SET locked_until = NULL, failed_login_attempts = 0, last_failed_login = NULL
WHERE email = 'user@example.com';

-- Count active sessions
SELECT COUNT(*) FROM sessions WHERE expires_at > NOW();

-- Count expired sessions (pending cleanup)
SELECT COUNT(*) FROM sessions WHERE expires_at <= NOW();

-- Audit log summary (last 24 hours)
SELECT action, resource_type, COUNT(*)
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY action, resource_type
ORDER BY COUNT(*) DESC;

-- Recent failed login attempts
SELECT al.user_id, u.email, al.ip_address, al.created_at
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE al.resource_type = 'Authentication'
  AND al.metadata::text LIKE '%LOGIN_FAILED%'
  AND al.created_at > NOW() - INTERVAL '1 hour'
ORDER BY al.created_at DESC;

-- Check RLS is enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true;

-- Database size
SELECT pg_size_pretty(pg_database_size(current_database()));
```

### 3.5 Connection Pool Configuration

The backend uses `pg` Pool with these settings (from `database.ts`):

| Setting | Value | Notes |
|---------|-------|-------|
| `max` | 5 | Reduced for Cloud Run's limited resources |
| `idleTimeoutMillis` | 30,000 ms | 30 seconds idle before release |
| `connectionTimeoutMillis` | 30,000 ms | 30 seconds for Cloud SQL Auth Proxy cold starts |
| `statement_timeout` | 30,000 ms | 30 second query timeout |

---

## 4. Secret Management

### 4.1 Required Environment Variables (Production)

The backend validates these at startup and **will not start** if any are missing or invalid:

| Variable | Purpose | Validation |
|----------|---------|-----------|
| `DATABASE_URL` | PostgreSQL connection string | Required, must be valid URL |
| `JWT_ACCESS_SECRET` | Signs access tokens (15 min lifetime) | Required, min 32 chars, no default values |
| `JWT_REFRESH_SECRET` | Signs refresh tokens (7 day lifetime) | Required, min 32 chars, no default values |
| `PHI_ENCRYPTION_KEY` | AES-256-GCM encryption for all PHI | Required, exactly 64 hex chars, no placeholder keys |

### 4.2 All Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3001` | Server listen port |
| `JWT_ACCESS_SECRET` | -- | Access token signing key |
| `JWT_REFRESH_SECRET` | -- | Refresh token signing key |
| `JWT_ACCESS_EXPIRES_SECONDS` | `900` (15 min) | Access token TTL |
| `JWT_REFRESH_EXPIRES_SECONDS` | `604800` (7 days) | Refresh token TTL |
| `DATABASE_URL` | -- | PostgreSQL connection string |
| `PHI_ENCRYPTION_KEY` | -- | 64 hex char AES-256 key |
| `CORS_ORIGIN` | localhost ports | Allowed frontend origin(s) |
| `COOKIE_DOMAIN` | (none) | Cookie domain (e.g., `.ownmyhealth.io`) |
| `COOKIE_SAME_SITE` | `lax` / `none` | Cookie SameSite policy |
| `MAX_LOGIN_ATTEMPTS` | `5` | Failed logins before lockout |
| `LOCKOUT_DURATION_MINUTES` | `30` | Account lockout duration |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | Global rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max requests per window |
| `SENDGRID_API_KEY` | (none) | SendGrid email delivery |
| `EMAIL_FROM` | `noreply@ownmyhealth.com` | Sender email address |
| `EMAIL_FROM_NAME` | `OwnMyHealth` | Sender display name |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend URL for email links |
| `GCS_BUCKET_NAME` | `ownmyhealth-user-files` | GCS bucket for file uploads |
| `GCP_PROJECT_ID` | -- | Google Cloud project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | -- | Path to GCP service account JSON |
| `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` | -- | Document AI processor for OCR |
| `GOOGLE_DOCUMENT_AI_LOCATION` | -- | Document AI processor location |
| `ANTHROPIC_API_KEY` | -- | Claude AI API key |
| `DEMO_ACCOUNT_ENABLED` | `false` | **Blocked in production** (startup will crash) |
| `DEMO_EMAIL` | -- | Demo account email (dev only) |
| `DEMO_PASSWORD` | -- | Demo account password (dev only) |

### 4.3 Manage Secrets in GCP Secret Manager

```bash
# List all secrets
gcloud secrets list --project ownmyhealth-prod

# View a secret value
gcloud secrets versions access latest \
  --secret="JWT_ACCESS_SECRET" \
  --project ownmyhealth-prod

# Create a new secret
echo -n "secret-value" | gcloud secrets create SECRET_NAME \
  --data-file=- \
  --project ownmyhealth-prod

# Update an existing secret (add new version)
echo -n "new-secret-value" | gcloud secrets versions add SECRET_NAME \
  --data-file=- \
  --project ownmyhealth-prod

# Disable an old secret version
gcloud secrets versions disable VERSION_NUMBER \
  --secret="SECRET_NAME" \
  --project ownmyhealth-prod
```

### 4.4 Rotate JWT Secrets

1. Generate a new secret:
   ```bash
   openssl rand -base64 32
   ```
2. Update in Secret Manager:
   ```bash
   echo -n "NEW_VALUE" | gcloud secrets versions add JWT_ACCESS_SECRET \
     --data-file=- --project ownmyhealth-prod
   ```
3. Redeploy the Cloud Run service to pick up the new secret.
4. **Impact:** All existing access tokens become invalid immediately. Users will need to use their refresh tokens to get new access tokens on the next request.

### 4.5 Rotate PHI Encryption Key

**WARNING: This is a critical operation. Incorrect rotation will make existing encrypted PHI unreadable.**

1. **Do NOT simply replace the key.** All existing PHI is encrypted with the current key.
2. A proper rotation requires:
   - Reading all encrypted PHI with the old key
   - Re-encrypting with the new key
   - Updating all records in a single transaction
3. Generate a new key: `openssl rand -hex 32`
4. Plan a maintenance window for this operation.
5. Back up the database before starting.

---

## 5. AI & External Service Monitoring

### 5.1 Claude AI (Anthropic)

Claude is used for biomarker guidance, SBC document extraction, and cost analysis.

```bash
# Check API key validity (simple test)
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"ping"}]}' | head -c 200

# Monitor Claude API costs
# Visit: https://console.anthropic.com/settings/billing
# Check usage dashboard for token consumption and spend
```

**Monitoring tips:**
- Watch for `CRITICAL: Failed to create audit log` in logs if Claude extraction triggers audit failures.
- If Claude is unavailable, SBC extraction, biomarker guidance, and cost analysis will return errors, but the rest of the app continues to work.

### 5.2 SendGrid (Email Delivery)

SendGrid is used for email verification and password reset emails.

```bash
# Check SendGrid API status
# Visit: https://status.sendgrid.com/

# View email activity in SendGrid dashboard
# Visit: https://app.sendgrid.com/email_activity
```

**Key events to monitor:**
- Bounce rate (indicates invalid email addresses)
- Spam reports (could affect deliverability)
- Block events (IP or domain reputation issues)

If `SENDGRID_API_KEY` is not set, email sending is disabled (`config.email.enabled` will be `false`). Users will not be able to register or reset passwords.

### 5.3 Google Cloud Storage (File Uploads)

```bash
# Check bucket exists and is accessible
gsutil ls gs://ownmyhealth-user-files/

# Check bucket size
gsutil du -s gs://ownmyhealth-user-files/

# Check frontend bucket
gsutil ls gs://ownmyhealth-frontend/
gsutil du -s gs://ownmyhealth-frontend/
```

### 5.4 Google Document AI (OCR)

Document AI is used for OCR processing of scanned lab reports.

```bash
# Check Document AI processor status
gcloud ai document-ai processors list \
  --location=us \
  --project ownmyhealth-prod

# Check quotas
gcloud services list --enabled --project ownmyhealth-prod | grep documentai
```

**Quota limits to watch:**
- Pages processed per minute
- Total pages processed per month
- Request size limits

---

## 6. Rate Limiting Reference

The backend has six named rate limiters defined in `rateLimiter.ts`:

| Limiter | Window | Max Requests | Applied To |
|---------|--------|-------------|-----------|
| `standardLimiter` | 15 min | 100 | General API endpoints |
| `authLimiter` | 15 min | 20 | Registration, verification, password reset |
| `strictAuthLimiter` | 15 min | 5 (failed only) | Login (keyed by email + IP) |
| `uploadLimiter` | 1 hour | 20 | File upload endpoints |
| `sensitiveLimiter` | 1 hour | 10 | Sensitive operations |
| `bulkOperationLimiter` | 1 hour | 30 | Batch creates, imports |

Account lockout (separate from rate limiting):
- **Max failed logins:** 5 (configurable via `MAX_LOGIN_ATTEMPTS`)
- **Lockout duration:** 30 minutes (configurable via `LOCKOUT_DURATION_MINUTES`)

---

## 7. Emergency Procedures

### 7.1 Rollback a Backend Deployment

```bash
# List recent revisions
gcloud run revisions list \
  --service ownmyhealth-backend \
  --region us-central1 \
  --project ownmyhealth-prod \
  --limit 10

# Route 100% traffic to a previous revision
gcloud run services update-traffic ownmyhealth-backend \
  --to-revisions=REVISION_NAME=100 \
  --region us-central1 \
  --project ownmyhealth-prod
```

### 7.2 Rollback a Frontend Deployment

The frontend is static files in GCS. To rollback:

1. The CI pipeline uploads the `frontend-dist` artifact with 7-day retention.
2. Download the artifact from a previous GitHub Actions run.
3. Re-upload to the bucket:

```bash
gsutil -m rm -r gs://ownmyhealth-frontend/** || true
gsutil -m cp -r previous-dist/* gs://ownmyhealth-frontend/
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" gs://ownmyhealth-frontend/index.html
```

Alternatively, rebuild from a previous commit:
```bash
git checkout <previous-commit-sha>
npm ci
VITE_API_URL=https://api.ownmyhealth.io/api/v1 npm run build
gsutil -m rm -r gs://ownmyhealth-frontend/** || true
gsutil -m cp -r dist/* gs://ownmyhealth-frontend/
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" gs://ownmyhealth-frontend/index.html
git checkout master
```

### 7.3 Fix Database Connection Issues

**Symptoms:** Health check returns 503, logs show `FATAL: Database connection failed`.

1. **Check Cloud SQL instance status:**
   ```bash
   gcloud sql instances describe INSTANCE_NAME \
     --project ownmyhealth-prod \
     --format "table(state, settings.ipConfiguration)"
   ```

2. **Check if Cloud Run can reach Cloud SQL:**
   - Verify the Cloud SQL connection is configured on the Cloud Run service.
   - Verify the `DATABASE_URL` environment variable is correct.

3. **Check connection pool exhaustion:**
   - The pool is limited to 5 connections (`max: 5` in `database.ts`).
   - If all connections are held by long-running queries, new requests will timeout after 30 seconds.
   - Restart the Cloud Run service to reset the pool:
     ```bash
     gcloud run services update ownmyhealth-backend \
       --region us-central1 \
       --project ownmyhealth-prod \
       --no-traffic
     # Then restore traffic:
     gcloud run services update-traffic ownmyhealth-backend \
       --to-latest \
       --region us-central1 \
       --project ownmyhealth-prod
     ```

4. **Check Cloud SQL logs:**
   ```bash
   gcloud logging read "resource.type=cloudsql_database" \
     --project ownmyhealth-prod \
     --limit 50 \
     --format "table(timestamp, severity, textPayload)"
   ```

### 7.4 Fix Authentication Issues

**Symptom: Users cannot log in.**

1. Check if the account is locked:
   ```sql
   SELECT email, failed_login_attempts, locked_until
   FROM users WHERE email = 'user@example.com';
   ```

2. Unlock the account:
   ```sql
   UPDATE users
   SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL
   WHERE email = 'user@example.com';
   ```

3. Check if email is verified:
   ```sql
   SELECT email, email_verified FROM users WHERE email = 'user@example.com';
   ```

4. Force-verify email (emergency only):
   ```sql
   UPDATE users
   SET email_verified = true, email_verification_token = NULL, email_verification_expires = NULL
   WHERE email = 'user@example.com';
   ```

**Symptom: All users get 401 Unauthorized.**

1. Check JWT secret configuration -- if the secret changed or is missing, all tokens are invalid.
2. Verify `JWT_ACCESS_SECRET` is set in the Cloud Run environment.
3. Check logs for `JWT_ACCESS_SECRET must be changed in production` startup errors.

### 7.5 Handle Account Lockouts

Accounts lock after 5 failed login attempts for 30 minutes.

```sql
-- View all locked accounts
SELECT id, email, failed_login_attempts, locked_until
FROM users
WHERE locked_until > NOW()
ORDER BY locked_until DESC;

-- Unlock a specific account
UPDATE users
SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL
WHERE email = 'user@example.com';

-- Unlock all accounts (emergency)
UPDATE users
SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL
WHERE locked_until IS NOT NULL;
```

### 7.6 Investigate Unauthorized PHI Access

All PHI access is logged in the `audit_logs` table with encrypted previous/new values.

```sql
-- All PHI access for a specific user in the last 24 hours
SELECT id, action, resource_type, resource_id, ip_address, user_agent, created_at
FROM audit_logs
WHERE user_id = 'USER_UUID'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- All data exports (HIPAA-critical)
SELECT al.user_id, u.email, al.resource_type, al.metadata, al.ip_address, al.created_at
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE al.action = 'EXPORT'
  AND al.created_at > NOW() - INTERVAL '7 days'
ORDER BY al.created_at DESC;

-- Access from unusual IP addresses
SELECT DISTINCT ip_address, COUNT(*) as access_count, MIN(created_at), MAX(created_at)
FROM audit_logs
WHERE user_id = 'USER_UUID'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY ip_address
ORDER BY access_count DESC;

-- All DELETE actions on PHI resources
SELECT al.user_id, u.email, al.resource_type, al.resource_id, al.ip_address, al.created_at
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE al.action = 'DELETE'
  AND al.resource_type NOT IN ('AuditLog', 'Session')
  AND al.created_at > NOW() - INTERVAL '30 days'
ORDER BY al.created_at DESC;

-- Provider access to patient data
SELECT al.user_id, u.email, al.resource_type, al.resource_id, al.ip_address, al.created_at
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE u.role = 'PROVIDER'
  AND al.action = 'READ'
  AND al.created_at > NOW() - INTERVAL '7 days'
ORDER BY al.created_at DESC;
```

### 7.7 Emergency: Disable All External Access

If a breach is suspected:

```bash
# 1. Remove all traffic from Cloud Run (takes backend offline)
gcloud run services update-traffic ownmyhealth-backend \
  --to-revisions=PLACEHOLDER=0 \
  --region us-central1 \
  --project ownmyhealth-prod

# 2. Make frontend bucket private (takes frontend offline)
gsutil iam ch -d allUsers:objectViewer gs://ownmyhealth-frontend

# 3. Revoke all active sessions (requires DB access)
# Connect via Cloud SQL Proxy, then:
DELETE FROM sessions;

# 4. Investigate using audit logs (see Section 7.6)
```

### 7.8 Emergency: Encryption Service Failure

**Symptom:** Server will not start, logs show `FATAL: Encryption service initialization failed` or `FATAL: Audit logging service initialization failed`.

1. Verify `PHI_ENCRYPTION_KEY` is set and is exactly 64 hex characters:
   ```bash
   gcloud secrets versions access latest \
     --secret="PHI_ENCRYPTION_KEY" \
     --project ownmyhealth-prod | wc -c
   # Should output 64
   ```

2. Verify it is valid hex (characters 0-9, a-f only).

3. Check that the `system_configs` table has a valid `audit_encryption_salt`:
   ```sql
   SELECT key, LENGTH(value), created_at FROM system_configs WHERE key = 'audit_encryption_salt';
   ```
   The salt must be at least 16 characters.

---

## 8. Development Commands

### Frontend

```bash
cd C:\Users\breil\OneDrive\Desktop\OwnMyHealth

npm run dev          # Start Vite dev server (port 5173)
npm run build        # Production build
npm run test         # Run Vitest tests
npm run lint         # ESLint
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
```

### Backend

```bash
cd C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend

npm run dev          # Start tsx watch dev server (port 3001)
npm run build        # Compile TypeScript (tsc)
npm run start        # Run compiled JS (node dist/app.js)
npm run test         # Run Vitest tests
npm run test:unit    # Unit tests only
npm run test:integration  # Integration tests only
npm run lint         # ESLint
npm run test:coverage # Coverage report
```

### Database

```bash
cd C:\Users\breil\OneDrive\Desktop\OwnMyHealth\backend

npx prisma generate           # Generate Prisma client
npx prisma migrate dev         # Run migrations (development)
npx prisma migrate deploy      # Run migrations (production)
npx prisma studio              # Database GUI (browser)
npx prisma db pull             # Introspect existing DB into schema
```

---

## 9. Dockerfile Reference

The backend Dockerfile (`backend/Dockerfile`) uses a multi-stage build:

**Stage 1 -- Builder:**
- Base: `node:20-alpine`
- Copies `package*.json`, `prisma/`, `prisma.config.ts`
- Runs `npm ci` (full dependencies including devDependencies)
- Copies `src/` and `tsconfig.json`
- Runs `npx prisma generate` (with dummy `DATABASE_URL`)
- Runs `npm run build` (TypeScript compilation)

**Stage 2 -- Production:**
- Base: `node:20-alpine`
- Runs `apk update && apk upgrade` (security patches)
- Runs `npm ci --omit=dev` (production dependencies only)
- Copies `prisma/` and runs `npx prisma generate`
- Copies compiled `dist/` and `generated/` from builder
- Creates non-root user `nodejs` (UID 1001)
- Exposes port `3001`
- Health check: `wget http://localhost:${PORT:-3001}/health` every 30s
- CMD: `npx prisma migrate deploy && node dist/app.js`

---

## 10. Credentials Reference

| Resource | Value |
|----------|-------|
| GCP Project | `ownmyhealth-prod` |
| Region | `us-central1` |
| Cloud Run Service | `ownmyhealth-backend` |
| Artifact Registry | `us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth` |
| Frontend Bucket | `gs://ownmyhealth-frontend` |
| User Files Bucket | `gs://ownmyhealth-user-files` |
| Domain | `ownmyhealth.io` |
| API Domain | `api.ownmyhealth.io` |
| Backend Port | `3001` |
| Node.js Version | `20` (Alpine) |
| GitHub Actions Secret | `GCP_SA_KEY` (Service account JSON) |
