# OwnMyHealth Troubleshooting Guide

**Last Updated:** 2026-02-06

This guide covers common issues encountered when developing, deploying, and operating the OwnMyHealth platform. Each entry follows the pattern: **Symptom** (what you observe), **Cause** (why it happens), and **Fix** (how to resolve it).

---

## Symptom Index

| Symptom | Jump To |
|---------|---------|
| Data disappears after page refresh | [Auth Token Refresh Order](#auth-token-refresh-order) |
| 401 Unauthorized on every request | [Access Token Expired](#access-token-expired) |
| 401 "Invalid token type" | [Refresh Token Used as Access Token](#refresh-token-used-as-access-token) |
| Account locked after failed logins | [Account Lockout](#account-lockout) |
| "Email not verified" on login | [Email Verification Required](#email-verification-required) |
| 403 "CSRF token missing" | [CSRF Token Missing](#csrf-token-missing) |
| 403 "Invalid CSRF token" | [CSRF Token Mismatch](#csrf-token-mismatch) |
| Server won't start: "FATAL: Database connection failed" | [Database Connection Failure](#database-connection-failure) |
| Server won't start: "FATAL: Encryption key" | [PHI Encryption Key Invalid](#phi-encryption-key-invalid) |
| Server won't start: missing env vars | [Missing Production Environment Variables](#missing-production-environment-variables) |
| 500 "A record with this data already exists" (P2002) | [Prisma Unique Constraint Violation](#prisma-unique-constraint-violation) |
| RLS context errors | [Row-Level Security Context Failure](#row-level-security-context-failure) |
| Decryption failures on PHI fields | [PHI Decryption Failure](#phi-decryption-failure) |
| "AI extraction service not properly configured" | [Anthropic API Key Missing](#anthropic-api-key-missing) |
| "Failed to upload file to storage" | [GCS Upload Failure](#gcs-upload-failure) |
| 429 "Too many requests" | [Rate Limit Exceeded](#rate-limit-exceeded) |
| CORS errors in browser console | [CORS Origin Mismatch](#cors-origin-mismatch) |
| Docker build fails at prisma generate | [Docker Prisma Generate Failure](#docker-prisma-generate-failure) |
| Cloud Run deploy but health check fails | [Cloud Run Health Check Failure](#cloud-run-health-check-failure) |
| SendGrid emails not arriving | [SendGrid Email Delivery Issues](#sendgrid-email-delivery-issues) |
| Document AI "PERMISSION_DENIED" | [Document AI Permission Denied](#document-ai-permission-denied) |
| Frontend build fails with VITE_API_URL issues | [Frontend Build Configuration](#frontend-build-configuration) |
| Demo account not working | [Demo Account Issues](#demo-account-issues) |

---

## 1. Authentication Issues

### Auth Token Refresh Order

**Symptom:** User logs in successfully. Data appears. On page refresh, all data disappears and the user appears logged out.

**Cause:** The `AuthContext.tsx` `checkAuth()` function was calling `getCurrentUser()` before `refreshToken()`. Access tokens expire after 15 minutes, so on page refresh the stale access token fails with 401, and the code never reaches the refresh call.

**Fix:** The correct order in `src/contexts/AuthContext.tsx` is:
```typescript
// 1. Refresh the access token FIRST using the 7-day refresh token cookie
await authApi.refreshToken();
// 2. THEN get current user with the fresh access token
const currentUser = await authApi.getCurrentUser();
```

**Files:** `src/contexts/AuthContext.tsx` (lines 80-97)

---

### Access Token Expired

**Symptom:** API requests return `401` with `TOKEN_EXPIRED` or "Token has expired. Please refresh your session."

**Cause:** Access tokens are short-lived (15 minutes by default, configured via `JWT_ACCESS_EXPIRES_SECONDS`). The token in the `access_token` cookie has expired.

**Fix:**
- The frontend API client (`src/services/api/client.ts`) automatically attempts token refresh on 401 responses. If refresh fails, the user must re-login.
- Verify the refresh token cookie (`refresh_token`) is present and not expired (7-day default).
- Check that `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are consistent between server restarts. Changing secrets invalidates all existing tokens.

```bash
# Check token expiry configuration
echo $JWT_ACCESS_EXPIRES_SECONDS   # Default: 900 (15 min)
echo $JWT_REFRESH_EXPIRES_SECONDS  # Default: 604800 (7 days)
```

**Files:** `backend/src/middleware/auth.ts`, `src/services/api/client.ts`

---

### Refresh Token Used as Access Token

**Symptom:** 401 response with "Invalid token type."

**Cause:** A refresh token was sent in the `access_token` cookie or `Authorization` header. The auth middleware verifies that `decoded.type === 'access'` and rejects refresh tokens.

**Fix:** Ensure the frontend stores tokens in the correct cookies. The login response sets:
- `access_token` cookie: short-lived access token
- `refresh_token` cookie: long-lived refresh token

Check that cookie names are not swapped in the backend auth controller.

**Files:** `backend/src/middleware/auth.ts` (lines 63-68)

---

### Account Lockout

**Symptom:** Login returns "Account locked due to too many failed attempts. Try again in 30 minutes."

**Cause:** After `MAX_LOGIN_ATTEMPTS` (default: 5) consecutive failed password attempts, the account is locked for `LOCKOUT_DURATION_MINUTES` (default: 30 minutes).

**Fix:**
- Wait for the lockout to expire.
- For development, update the database directly:
```sql
UPDATE users
SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL
WHERE email = 'user@example.com';
```
- Adjust lockout settings via environment variables:
```bash
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=30
```

**Files:** `backend/src/services/authService.ts` (lines 371-422)

---

### Email Verification Required

**Symptom:** Login returns "Email not verified. Please check your email for the verification link."

**Cause:** New users must verify their email before logging in. The `emailVerified` flag is `false` on the user record.

**Fix:**
- Check spam/junk folder for the verification email.
- Use the resend verification endpoint: `POST /api/v1/auth/resend-verification` with `{ "email": "..." }`.
- In development without SendGrid, the verification URL is logged to the backend console. Look for "EMAIL VERIFICATION" in logs.
- To manually verify in development:
```sql
UPDATE users SET email_verified = true WHERE email = 'user@example.com';
```

**Files:** `backend/src/services/authService.ts` (lines 616-623), `backend/src/services/emailService.ts`

---

### Password Reset Token Expired

**Symptom:** Password reset fails with "Reset token has expired. Please request a new password reset."

**Cause:** Password reset tokens expire after 1 hour (`PASSWORD_RESET_EXPIRATION_HOURS`).

**Fix:** Request a new password reset via `POST /api/v1/auth/forgot-password` with `{ "email": "..." }`.

**Files:** `backend/src/services/authService.ts` (lines 786, 850-878)

---

## 2. Database Issues

### Database Connection Failure

**Symptom:** Server fails to start with:
```
FATAL: Cannot start server - database is unavailable.
Ensure DATABASE_URL is correct and PostgreSQL is running.
```

**Cause:** The `DATABASE_URL` environment variable is missing, malformed, or the PostgreSQL server is unreachable. This is a hard failure by design -- a HIPAA-compliant application cannot operate without its database.

**Fix:**
1. Verify `DATABASE_URL` is set and correctly formatted:
   ```bash
   echo $DATABASE_URL
   # Expected: postgresql://user:password@host:5432/dbname
   ```
2. For Cloud SQL, ensure the Cloud SQL Auth Proxy is running:
   ```bash
   cloud-sql-proxy --port=5432 PROJECT_ID:REGION:INSTANCE_NAME
   ```
3. Check connection pool settings. Cloud SQL via Auth Proxy may need longer timeouts. The current defaults in `database.ts` are:
   - `connectionTimeoutMillis: 30000` (30s)
   - `statement_timeout: 30000` (30s)
   - `max: 5` connections (reduced for Cloud Run)
4. For Prisma Postgres URL format (`prisma+postgres://`), ensure the API key is valid.

**Files:** `backend/src/services/database.ts` (lines 37-63, 106-126)

---

### Row-Level Security Context Failure

**Symptom:** Database queries return no results or throw errors like "Failed to set RLS context."

**Cause:** RLS policies require `app.current_user_id` to be set as a PostgreSQL session variable before queries. If the RLS context is not set, queries are filtered to return nothing.

**Fix:**
- Always wrap database operations with `withRLSContext` or `withRLSTransaction`:
```typescript
// Correct: user-scoped query
const data = await withRLSContext(userId, async () => {
  return prisma.biomarker.findMany();
});

// Correct: admin/system query
const allData = await withRLSContext(null, async () => {
  return prisma.user.findMany();
});
```
- For transactions, use `withRLSTransaction`:
```typescript
await withRLSTransaction(userId, async (tx) => {
  await tx.biomarker.create({ data: {...} });
});
```
- Verify the user ID is a valid UUID. The RLS context setter validates UUID format to prevent SQL injection.

**Files:** `backend/src/services/database.ts` (lines 233-415)

---

### Prisma Unique Constraint Violation (P2002)

**Symptom:** 409 Conflict: "A record with this data already exists."

**Cause:** Attempting to create a record that violates a unique constraint (e.g., duplicate email, duplicate biomarker entry).

**Fix:** Check that the data being inserted does not conflict with existing records. Common culprits:
- Duplicate user email registration
- Duplicate provider-patient relationship (`providerId_patientId` composite unique)
- Re-uploading a file with an existing file ID

---

### Prisma Record Not Found (P2025)

**Symptom:** 404 Not Found: "The requested resource was not found."

**Cause:** Attempted to update or delete a record that does not exist, or RLS policies have filtered it out.

**Fix:**
- Verify the resource ID exists and belongs to the current user.
- Check if RLS context is properly set (user may not have access to the record).

---

### Migration Failure on Deployment

**Symptom:** Cloud Run container starts but exits with a migration error. The `CMD` runs `npx prisma migrate deploy` before starting the server.

**Cause:** The migration cannot connect to the database, or there is a schema conflict.

**Fix:**
1. Ensure `DATABASE_URL` is configured in Cloud Run environment variables.
2. Run migrations manually first to isolate the issue:
   ```bash
   cd backend
   npx prisma migrate deploy
   ```
3. Check for pending migrations:
   ```bash
   npx prisma migrate status
   ```
4. If a migration is stuck, check the `_prisma_migrations` table:
   ```sql
   SELECT * FROM _prisma_migrations WHERE finished_at IS NULL;
   ```

**Files:** `backend/Dockerfile` (line 51), `backend/prisma/migrations/`

---

## 3. Deployment Issues

### Docker Prisma Generate Failure

**Symptom:** Docker build fails during `npx prisma generate` step.

**Cause:** `prisma generate` requires a `DATABASE_URL` to be set even though it does not actually connect to the database. The Dockerfile provides a dummy URL for this purpose.

**Fix:** The Dockerfile already handles this:
```dockerfile
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate
```
If the build still fails, ensure `prisma/schema.prisma` and `prisma.config.ts` are copied before running generate:
```dockerfile
COPY prisma ./prisma/
COPY prisma.config.ts ./
```

**Files:** `backend/Dockerfile` (lines 17-19, 36-38)

---

### Cloud Run Health Check Failure

**Symptom:** Cloud Run deploys the container but marks it unhealthy. The service returns 503.

**Cause:** The Docker health check hits `http://localhost:${PORT:-3001}/health` every 30 seconds. If the database connection fails during startup, the server never starts, and health checks fail.

**Fix:**
1. Check Cloud Run logs:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ownmyhealth-backend" --limit 50
   ```
2. Verify all required environment variables are set in Cloud Run:
   ```bash
   gcloud run services describe ownmyhealth-backend --region us-central1 --format yaml
   ```
3. Ensure Cloud SQL connection is configured. Cloud Run needs either:
   - Cloud SQL Auth Proxy sidecar (via `--add-cloudsql-instances` flag)
   - Or a direct private IP connection
4. The health check has a 10-second start period. If the database is slow to connect (cold start), increase `--start-period` in the Dockerfile.

**Files:** `backend/Dockerfile` (lines 48-49), `.github/workflows/deploy.yml`

---

### GCP Service Account Authentication

**Symptom:** Deployment pipeline fails at "Google Auth" step with credential errors.

**Cause:** The `GCP_SA_KEY` GitHub secret is missing, expired, or the service account lacks required permissions.

**Fix:**
1. Verify the secret exists in GitHub repository settings.
2. Regenerate the service account key if expired:
   ```bash
   gcloud iam service-accounts keys create key.json \
     --iam-account=SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com
   ```
3. Required roles for the service account:
   - `roles/run.admin` (Cloud Run deployment)
   - `roles/artifactregistry.writer` (Docker image push)
   - `roles/storage.admin` (Frontend GCS deployment)
   - `roles/iam.serviceAccountUser` (Act as service account)

**Files:** `.github/workflows/deploy.yml` (lines 23-26)

---

### Frontend Deployment to GCS

**Symptom:** Frontend deploys but shows stale content or a blank page.

**Cause:** Browser caching of `index.html`, or the `VITE_API_URL` was not set during the build.

**Fix:**
1. The deploy workflow sets no-cache headers on `index.html`:
   ```bash
   gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" \
     gs://ownmyhealth-frontend/index.html
   ```
2. Verify `VITE_API_URL` was set at build time (not runtime):
   ```bash
   # In deploy.yml, this is set as a build-time env var:
   VITE_API_URL: https://api.ownmyhealth.io/api/v1
   ```
3. Hard-refresh the browser (Ctrl+Shift+R) to bypass cache.

**Files:** `.github/workflows/deploy.yml` (lines 116-123)

---

## 4. API Issues

### Rate Limit Exceeded

**Symptom:** 429 response with one of these messages:
- `RATE_LIMIT_EXCEEDED`: "Too many requests, please try again later."
- `AUTH_RATE_LIMIT_EXCEEDED`: "Too many authentication attempts, please try again in 15 minutes."
- `LOGIN_RATE_LIMIT_EXCEEDED`: "Too many login attempts. Please try again in 15 minutes."
- `UPLOAD_RATE_LIMIT_EXCEEDED`: "Too many file uploads, please try again later."
- `SENSITIVE_RATE_LIMIT_EXCEEDED`: "Rate limit exceeded for sensitive operations."
- `BULK_RATE_LIMIT_EXCEEDED`: "Too many bulk operations."

**Cause:** The application has six rate limiters with different windows and limits:

| Limiter | Window | Max Requests | Scope |
|---------|--------|-------------|-------|
| `standardLimiter` | 15 min | 100 | General API |
| `authLimiter` | 15 min | 20 | Registration, etc. |
| `strictAuthLimiter` | 15 min | 5 | Login specifically |
| `uploadLimiter` | 1 hour | 20 | File uploads |
| `sensitiveLimiter` | 1 hour | 10 | Sensitive operations |
| `bulkOperationLimiter` | 1 hour | 30 | Batch operations |

**Fix:**
- Wait for the rate limit window to expire (check `Retry-After` and `X-RateLimit-Reset` headers).
- Adjust limits via environment variables:
  ```bash
  RATE_LIMIT_WINDOW_MS=900000    # 15 minutes
  RATE_LIMIT_MAX_REQUESTS=100
  ```
- The login rate limiter uses `email:ip` as the key, so different accounts from the same IP are tracked separately.
- `strictAuthLimiter` has `skipSuccessfulRequests: true`, so only failed login attempts count.

**Files:** `backend/src/middleware/rateLimiter.ts`

---

### CSRF Token Missing

**Symptom:** POST/PUT/PATCH/DELETE requests return 403 Forbidden with "CSRF token missing."

**Cause:** State-changing requests require the `X-CSRF-Token` header to match the `csrf_token` cookie value (double-submit cookie pattern). The frontend API client reads the cookie and sends it automatically, but this fails if:
1. The CSRF cookie was never set (no prior GET request).
2. The cookie is blocked by browser settings or cross-domain issues.
3. A raw `fetch()` call was made without including the CSRF header.

**Fix:**
1. Ensure a GET request has been made first (the CSRF cookie is set on GET responses).
2. Use the API client (`src/services/api/client.ts`) which automatically includes the CSRF header:
   ```typescript
   // The client reads csrf_token cookie and adds X-CSRF-Token header
   const csrfToken = getCsrfToken(); // reads from document.cookie
   headers['x-csrf-token'] = csrfToken;
   ```
3. Or fetch a fresh CSRF token explicitly: `GET /api/v1/csrf-token`.
4. In development, CSRF can be disabled: `DISABLE_CSRF=true`.

**Files:** `backend/src/middleware/csrf.ts`, `src/services/api/client.ts` (lines 97-107)

---

### CSRF Token Mismatch

**Symptom:** 403 Forbidden with "Invalid CSRF token."

**Cause:** The `X-CSRF-Token` header value does not match the `csrf_token` cookie value. This can happen if:
- The cookie expired (24-hour lifetime).
- Multiple tabs generated different tokens.
- Cross-domain cookie settings are incorrect.

**Fix:**
1. For cross-domain setups (frontend on `ownmyhealth.io`, API on `api.ownmyhealth.io`):
   ```bash
   COOKIE_DOMAIN=.ownmyhealth.io     # Note leading dot
   COOKIE_SAME_SITE=none             # Required for cross-domain
   ```
2. Ensure `credentials: 'include'` is set on all fetch requests (the API client does this).
3. Refresh the CSRF token by making a GET request or hitting the `/csrf-token` endpoint.

**Files:** `backend/src/middleware/csrf.ts`, `backend/src/config/index.ts` (lines 33-45)

---

### CORS Origin Mismatch

**Symptom:** Browser console shows: "Access to fetch at '...' from origin '...' has been blocked by CORS policy."

**Cause:** The frontend origin is not in the allowed CORS origins list.

**Fix:**
1. In development, multiple ports are allowed by default:
   ```
   http://localhost:5173, 5174, 5175, 5176, 3000
   ```
2. In production, set `CORS_ORIGIN` to the exact frontend URL:
   ```bash
   CORS_ORIGIN=https://ownmyhealth.io
   ```
3. If `CORS_ORIGIN` contains localhost URLs in production, a security warning is logged.
4. Ensure `credentials: true` is set in CORS config (required for cookie-based auth).

**Files:** `backend/src/config/index.ts` (lines 54-64)

---

### Validation Error (422)

**Symptom:** 422 Unprocessable Entity with "Validation failed" and a `details` array listing specific field errors.

**Cause:** Request body/query/params failed Zod schema validation. Common issues:
- Password does not meet strength requirements (12+ chars, upper, lower, number, special char).
- Email format invalid.
- UUID format invalid for ID parameters.
- Biomarker value is negative.
- String exceeds maximum length.

**Fix:** Check the `details` array in the error response:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "password", "message": "Password must be at least 12 characters long", "code": "too_small" }
    ]
  }
}
```
Adjust the input to meet the validation requirements. See `backend/src/middleware/validation.ts` for all schema definitions.

**Files:** `backend/src/middleware/validation.ts`

---

### Content-Type Rejection

**Symptom:** 400 Bad Request: "Content-Type must be application/json for requests with body."

**Cause:** A POST/PUT/PATCH request sent a body without the `application/json` Content-Type header. Multipart form-data (file uploads) is exempted.

**Fix:** Add the header to your request:
```
Content-Type: application/json
```
The API client sets this automatically. If you are using `fetch()` directly, include it explicitly.

**Files:** `backend/src/middleware/validation.ts` (lines 172-199)

---

## 5. External Service Issues

### Anthropic API Key Missing

**Symptom:** 500 Internal Server Error: "AI extraction service not properly configured" or "ANTHROPIC_API_KEY environment variable is not set."

**Cause:** The `ANTHROPIC_API_KEY` environment variable is not set, and a feature requiring Claude AI was invoked (biomarker extraction, SBC extraction, cost analysis, or AI guidance).

**Fix:**
```bash
# Set the API key
export ANTHROPIC_API_KEY=sk-ant-...

# Verify configuration
curl http://localhost:3001/health
```

**Files:** `backend/src/services/claudeExtraction.ts` (lines 47-57), `backend/src/services/sbcExtraction.ts` (lines 314-324)

---

### Anthropic API Rate Limited

**Symptom:** 500 with "AI extraction service temporarily unavailable. Please try again."

**Cause:** The Anthropic API returned 429 (rate limit). This typically happens with high-volume extraction requests.

**Fix:**
- Wait and retry. The Anthropic API rate limits reset on a per-minute basis.
- Reduce concurrent extraction requests.
- Consider upgrading the Anthropic API plan for higher rate limits.
- The application uses `claude-haiku-4-5-20251001` for biomarker extraction (faster, cheaper) and `claude-sonnet-4-20250514` for SBC extraction (more accurate).

**Files:** `backend/src/services/claudeExtraction.ts` (lines 216-219), `backend/src/services/sbcExtraction.ts` (lines 970-975)

---

### Anthropic API Overloaded

**Symptom:** 500 with "AI extraction service busy. Please try again in a moment."

**Cause:** The Anthropic API returned 503 (service overloaded). This is a temporary condition on the Anthropic side.

**Fix:** Retry after a short delay (30-60 seconds). This is not a configuration issue.

**Files:** `backend/src/services/claudeExtraction.ts` (lines 221-224), `backend/src/services/sbcExtraction.ts` (lines 977-982)

---

### Claude Extraction Returns No JSON

**Symptom:** 500 with "Claude response did not contain valid JSON" or "Failed to parse biomarker data from Claude response."

**Cause:** The Claude API returned text that could not be parsed as JSON. The extraction code attempts to:
1. Strip markdown code blocks (` ```json ... ``` `).
2. Find a JSON object pattern (`{...}`).
3. Parse the JSON.

**Fix:**
- This is usually a transient issue. Retry the extraction.
- Check the backend logs for the raw response text (logged at error level).
- If persistent, the Claude model may have changed behavior. Review the extraction prompt in `claudeExtraction.ts` or `sbcExtraction.ts`.

**Files:** `backend/src/services/claudeExtraction.ts` (lines 156-184), `backend/src/services/sbcExtraction.ts` (lines 823-850)

---

### GCS Upload Failure

**Symptom:** 500 with "Failed to upload file to storage."

**Cause:** Google Cloud Storage upload failed. Common reasons:
- Missing or invalid GCP credentials.
- Bucket does not exist.
- Service account lacks `storage.objects.create` permission.

**Fix:**
1. Verify GCS configuration:
   ```bash
   echo $GCS_BUCKET_NAME          # Default: ownmyhealth-user-files
   echo $GCP_PROJECT_ID
   echo $GOOGLE_APPLICATION_CREDENTIALS
   ```
2. Test GCS access:
   ```bash
   gsutil ls gs://$GCS_BUCKET_NAME
   ```
3. Ensure the service account has `roles/storage.objectAdmin` on the bucket.
4. For signed URL generation failures ("Failed to generate file access URL"), verify the service account has `roles/iam.serviceAccountTokenCreator`.

**Files:** `backend/src/services/storageService.ts`

---

### GCS Signed URL Failure

**Symptom:** 500 with "Failed to generate file access URL."

**Cause:** Signed URL generation requires specific permissions and the service account must be able to sign blobs.

**Fix:**
1. Grant the `iam.serviceAccountTokenCreator` role to the service account.
2. Verify that the file exists in GCS:
   ```bash
   gsutil stat gs://BUCKET_NAME/USER_ID/FILE_ID.pdf
   ```
3. Signed URLs expire after 15 minutes by default. If a URL has expired, request a new one.

**Files:** `backend/src/services/storageService.ts` (lines 97-133)

---

### SendGrid Email Delivery Issues

**Symptom:** Verification or password reset emails are not delivered, but the API returns success.

**Cause:** Several possibilities:
1. `SENDGRID_API_KEY` is not set (emails are only logged, not sent).
2. The `@sendgrid/mail` package is not installed.
3. The sender email is not verified in SendGrid.
4. Email lands in spam/junk folder.

**Fix:**
1. Check if email is enabled:
   ```bash
   echo $SENDGRID_API_KEY  # Must be set for emails to actually send
   ```
2. In development without SendGrid, look for logged emails in the backend console output. The service logs a "dev box" with the verification/reset URL.
3. Verify the sender email in SendGrid dashboard:
   ```bash
   echo $EMAIL_FROM  # Default: noreply@ownmyhealth.com
   ```
4. Check SendGrid activity logs for bounces or blocks.

**Files:** `backend/src/services/emailService.ts`

---

### Document AI Permission Denied

**Symptom:** 500 with "OCR service not properly configured. Please check GCP credentials."

**Cause:** Google Document AI returned `PERMISSION_DENIED`. The service account lacks access to the Document AI processor.

**Fix:**
1. Verify Document AI configuration:
   ```bash
   echo $GCP_PROJECT_ID
   echo $GCP_PROCESSOR_ID
   echo $GCP_LOCATION           # Default: us
   echo $GOOGLE_APPLICATION_CREDENTIALS
   ```
2. Ensure the service account has `roles/documentai.apiUser`.
3. Verify the processor exists:
   ```bash
   gcloud ai processors list --location=us --project=PROJECT_ID
   ```
4. The `GOOGLE_APPLICATION_CREDENTIALS` can be either a file path or an inline JSON string (the service handles both).

**Files:** `backend/src/services/ocrService.ts` (lines 80-108, 400-414)

---

### Document AI Processor Not Found

**Symptom:** 500 with "OCR processor not found. Please check GCP_PROCESSOR_ID configuration."

**Cause:** The processor ID in `GCP_PROCESSOR_ID` does not match any existing Document AI processor.

**Fix:**
1. List available processors:
   ```bash
   gcloud ai processors list --location=us --project=PROJECT_ID
   ```
2. Update the environment variable with the correct processor ID.
3. Ensure the processor is in the correct location (matches `GCP_LOCATION`).

**Files:** `backend/src/services/ocrService.ts` (lines 113-119)

---

## 6. Frontend Issues

### Frontend Build Configuration

**Symptom:** Frontend build succeeds but API calls fail with network errors or point to the wrong URL.

**Cause:** `VITE_API_URL` must be set at **build time** (not runtime) because Vite inlines environment variables during the build.

**Fix:**
```bash
# Development
VITE_API_URL=http://localhost:3001/api/v1 npm run dev

# Production build
VITE_API_URL=https://api.ownmyhealth.io/api/v1 npm run build
```
If `VITE_API_URL` is not set, the client defaults to `http://localhost:3001/api/v1`.

**Files:** `src/services/api/client.ts` (line 8)

---

### Cookie Not Set on Cross-Domain

**Symptom:** Login succeeds (200 response) but subsequent requests fail with 401. Cookies are not being stored by the browser.

**Cause:** For cross-domain setups (frontend and API on different domains), cookies require specific settings:
- `Secure: true` (HTTPS only)
- `SameSite: none` (cross-origin allowed)
- Matching `Domain` attribute

**Fix:**
Set the following environment variables on the backend:
```bash
COOKIE_DOMAIN=.ownmyhealth.io     # Leading dot for subdomain sharing
COOKIE_SAME_SITE=none             # Required for cross-domain
NODE_ENV=production               # Enables Secure flag
```
Ensure the frontend uses `credentials: 'include'` on all fetch requests (the API client does this automatically).

**Files:** `backend/src/config/index.ts` (lines 33-45), `src/services/api/client.ts` (line 176)

---

### Network Error: Unable to Connect

**Symptom:** Frontend shows "Unable to connect to the server. Please check your internet connection and try again."

**Cause:** The frontend API client caught a network error (no HTTP response at all). The backend server is unreachable.

**Fix:**
1. Verify the backend is running:
   ```bash
   curl http://localhost:3001/health
   ```
2. Check `VITE_API_URL` points to the correct backend URL.
3. Check for firewall or proxy issues.
4. The API client has a 30-second timeout. Requests exceeding this will fail with "The request took too long to complete."

**Files:** `src/services/api/client.ts` (lines 10, 244-250)

---

### useAuth Must Be Used Within AuthProvider

**Symptom:** Runtime error: "useAuth must be used within an AuthProvider."

**Cause:** A component calls `useAuth()` but is rendered outside the `<AuthProvider>` wrapper.

**Fix:** Ensure the `AuthProvider` wraps the entire application in the root component:
```tsx
<AuthProvider>
  <App />
</AuthProvider>
```

**Files:** `src/contexts/AuthContext.tsx` (lines 185-190)

---

## 7. Encryption Issues

### PHI Encryption Key Invalid

**Symptom:** Server fails to start with a boxed error message:
```
FATAL: PHI Encryption Key Configuration Error
PHI_ENCRYPTION_KEY environment variable is not set
```
Or variations about key length, hex format, or insecure placeholder keys.

**Cause:** The `PHI_ENCRYPTION_KEY` must be:
- At least 64 hex characters (256 bits)
- Only hexadecimal characters (0-9, a-f, A-F)
- Not a known placeholder key (e.g., `0123456789abcdef...`)

**Fix:**
```bash
# Generate a secure key
openssl rand -hex 32

# Set it in your environment
export PHI_ENCRYPTION_KEY=<64-char-hex-string>
```
This is a hard failure by design -- PHI encryption cannot be bypassed, even in development.

**Files:** `backend/src/services/encryption.ts` (lines 86-166)

---

### PHI Decryption Failure

**Symptom:** PHI fields return as encrypted ciphertext (format: `base64:base64:base64`) instead of readable values. Or a warning appears: "Failed to decrypt field: fieldName."

**Cause:** Decryption fails silently when:
1. The `PHI_ENCRYPTION_KEY` was changed after data was encrypted.
2. The user's encryption salt was lost or corrupted.
3. The encrypted data format is invalid (not `iv:authTag:ciphertext`).

**Fix:**
1. Verify the encryption key has not changed:
   ```bash
   echo $PHI_ENCRYPTION_KEY
   ```
   The key must be the same one used when the data was originally encrypted.
2. Check the user's encryption key record:
   ```sql
   SELECT * FROM user_encryption_keys WHERE user_id = 'USER_ID' AND is_active = true;
   ```
3. If the master key was lost, the encrypted data **cannot be recovered**. This is by design for HIPAA security.
4. The `decryptFields()` method fails silently on individual fields, keeping the encrypted value. Check backend logs for "Failed to decrypt field" warnings.

**Files:** `backend/src/services/encryption.ts` (lines 266-342), `backend/src/services/userEncryption.ts`

---

### Encryption Key Rotation

**Symptom:** After key rotation, old data cannot be decrypted or new data uses the wrong key.

**Cause:** Key rotation creates a new user salt and marks the old one as inactive. All existing PHI data must be re-encrypted with the new salt.

**Fix:**
The `rotateUserEncryptionKey()` function returns both old and new salts:
```typescript
const { oldSalt, newSalt, newVersion } = await rotateUserEncryptionKey(userId);
// Re-encrypt all PHI fields:
const newEncrypted = encryptionService.reEncrypt(oldEncrypted, oldSalt, newSalt);
```
Ensure the re-encryption covers ALL PHI fields defined in `PHI_FIELDS` constant. The rotation is atomic (uses a database transaction).

**Files:** `backend/src/services/userEncryption.ts` (lines 72-129), `backend/src/services/encryption.ts` (lines 346-350)

---

### No Active Encryption Key for User

**Symptom:** Error: "No active encryption key found for user."

**Cause:** The user's encryption key record is missing from the `user_encryption_keys` table, or all records are marked `isActive: false`.

**Fix:**
- A new encryption salt is automatically created on first access via `getUserEncryptionSalt()`.
- If the record was accidentally deleted, calling any endpoint that accesses PHI will auto-generate a new key. However, previously encrypted data will be unrecoverable with the new key.
- Check the database:
  ```sql
  SELECT * FROM user_encryption_keys WHERE user_id = 'USER_ID';
  ```

**Files:** `backend/src/services/userEncryption.ts` (lines 20-63)

---

## 8. RBAC and Permission Issues

### Access Denied: Required Roles

**Symptom:** 403 Forbidden: "Access denied. Required roles: PROVIDER, ADMIN" (or similar).

**Cause:** The authenticated user's role does not match the required role(s) for the endpoint.

**Fix:**
- Verify the user's role in the database:
  ```sql
  SELECT id, email, role FROM users WHERE email = 'user@example.com';
  ```
- Role hierarchy: ADMIN (3) > PROVIDER (2) > PATIENT (1).
- Use `requireMinRole('PROVIDER')` for endpoints that should allow PROVIDER and ADMIN.
- Use `requireRole('ADMIN')` for admin-only endpoints.

**Files:** `backend/src/middleware/rbac.ts`

---

### Provider Cannot Access Patient Data

**Symptom:** 403 Forbidden: "You do not have access to this patient's data."

**Cause:** The provider-patient relationship is missing, inactive, expired, or does not include the required permission.

**Fix:**
1. Verify the relationship exists and is active:
   ```sql
   SELECT * FROM provider_patients
   WHERE provider_id = 'PROVIDER_ID' AND patient_id = 'PATIENT_ID';
   ```
2. Check consent status and expiration:
   - `status` must be `ACTIVE`
   - `consent_expires_at` must be in the future (or null for no expiration)
3. Check granular permissions:
   - `can_view_biomarkers` for biomarker access
   - `can_view_insurance` for insurance data
   - `can_view_dna` for genetic data
   - `can_view_health_needs` for health needs
   - `can_edit_data` for write access

**Files:** `backend/src/middleware/rbac.ts` (lines 195-244)

---

### Demo Account Restrictions

**Symptom:** 403 Forbidden: "Demo account cannot change roles" or "Demo account cannot modify other users."

**Cause:** The demo account has additional restrictions enforced by the `demoProtection` middleware:
- Cannot change role from PATIENT
- Cannot modify other users' data
- Cannot access admin features
- Blocked entirely in production (`DEMO_ACCOUNT_ENABLED` cannot be `true`)

**Fix:**
- Create a real account for full functionality.
- In development, ensure `DEMO_ACCOUNT_ENABLED=true` and `DEMO_EMAIL` / `DEMO_PASSWORD` are set.

**Files:** `backend/src/middleware/demoProtection.ts`

---

## 9. Demo Account Issues

### Demo Account Not Working

**Symptom:** Login with demo credentials fails with "Demo account not yet initialized" or "Invalid password for demo account."

**Cause:** The demo user has not been created in the database yet, or the password does not match.

**Fix:**
1. Ensure demo mode is enabled:
   ```bash
   DEMO_ACCOUNT_ENABLED=true
   DEMO_EMAIL=demo@example.com
   DEMO_PASSWORD=YourDemoPassword123!
   ```
2. The demo user is auto-created on server startup via `initializeDemoUser()`. Restart the backend.
3. The demo user is auto-verified (no email verification required).

**Files:** `backend/src/services/authService.ts` (lines 934-975)

---

### Demo Mode Blocked in Production

**Symptom:** Server fails to start with: "DEMO_ACCOUNT_ENABLED cannot be true in production."

**Cause:** Demo mode bypasses security controls (email verification, account lockout) and is explicitly blocked when `NODE_ENV=production`.

**Fix:** Set `DEMO_ACCOUNT_ENABLED=false` or remove it from production environment variables. Demo mode is only for development and testing.

**Files:** `backend/src/config/index.ts` (lines 191-197)

---

## 10. PDF / Document Extraction Issues

### PDF Extraction Not Configured

**Symptom:** 500: "PDF extraction service not configured. Please set ANTHROPIC_API_KEY."

**Cause:** PDF lab reports are processed using the Claude API. If `ANTHROPIC_API_KEY` is not set, PDF extraction is unavailable.

**Fix:** Set the `ANTHROPIC_API_KEY` environment variable. There is no fallback for PDF extraction -- Document AI OCR is only used for image files.

**Files:** `backend/src/services/ocrService.ts` (lines 388-394)

---

### File Too Large for Upload

**Symptom:** 400 Bad Request: "File size X.XXMB exceeds maximum of 10MB."

**Cause:** The file exceeds the 10 MB maximum for document processing.

**Fix:** Reduce the file size before uploading. For scanned documents, reduce the scan resolution or convert to a smaller format.

**Files:** `backend/src/services/ocrService.ts` (lines 48, 129-133)

---

### Unsupported File Type

**Symptom:** 400 Bad Request: "File type X is not supported. Supported types: PDF, PNG, JPG, TIFF."

**Cause:** Only these MIME types are accepted: `application/pdf`, `image/png`, `image/jpeg`, `image/tiff`, `image/gif`, `image/webp`.

**Fix:** Convert the file to a supported format before uploading.

**Files:** `backend/src/services/ocrService.ts` (lines 38-46)

---

### Biomarker Values Not Extracted

**Symptom:** Lab report is uploaded successfully, but no biomarkers are extracted (empty results).

**Cause:** Several possibilities:
1. Claude could not parse the document format.
2. Extracted values failed validation (e.g., negative values, impossibly large values).
3. The biomarker names in the report do not match known patterns.

**Fix:**
- Check backend logs for "Invalid biomarker value discarded" warnings with the specific validation reason.
- For Claude extraction issues, check if the response contained valid JSON.
- Ensure the lab report is a clear, standard format. Handwritten or heavily formatted reports may not extract well.
- Biomarkers with non-numeric values are filtered out (the `value` field must be a number).

**Files:** `backend/src/services/ocrService.ts`, `backend/src/services/claudeExtraction.ts`, `backend/src/services/biomarkerExtractor.ts`

---

## Quick Diagnostic Commands

```bash
# Check backend health
curl http://localhost:3001/health

# Check backend health (production)
curl https://api.ownmyhealth.io/health

# View recent Cloud Run errors
gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR" --limit 20 --project ownmyhealth-prod

# Check Cloud Run service status
gcloud run services describe ownmyhealth-backend --region us-central1 --project ownmyhealth-prod

# Check database connectivity
gcloud sql connect INSTANCE_NAME --user=postgres --project ownmyhealth-prod

# List active database sessions
psql -c "SELECT * FROM sessions WHERE expires_at > NOW();"

# Check Prisma migration status
cd backend && npx prisma migrate status

# Verify environment variables (development)
node -e "require('./backend/src/config/index.js')"

# Test GCS access
gsutil ls gs://ownmyhealth-user-files

# Check Docker image
docker images | grep ownmyhealth

# View frontend build output
ls -la dist/

# Check CSRF token cookie
curl -c - http://localhost:3001/api/v1/csrf-token
```

---

## Environment Variable Quick Reference

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Yes (prod) | `access-secret-change-in-production` | Min 32 chars in production |
| `JWT_REFRESH_SECRET` | Yes (prod) | `refresh-secret-change-in-production` | Min 32 chars in production |
| `PHI_ENCRYPTION_KEY` | Yes | -- | 64+ hex chars (256 bits) |
| `ANTHROPIC_API_KEY` | For AI features | -- | Claude API key |
| `SENDGRID_API_KEY` | For emails | -- | Emails logged only if unset |
| `GCS_BUCKET_NAME` | For file storage | `ownmyhealth-user-files` | GCS bucket name |
| `GCP_PROJECT_ID` | For GCP services | -- | Google Cloud project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | For GCP | -- | Path or inline JSON |
| `GCP_PROCESSOR_ID` | For OCR | -- | Document AI processor ID |
| `CORS_ORIGIN` | For production | localhost variants | Frontend URL |
| `FRONTEND_URL` | For emails | `http://localhost:5173` | Used in email links |
| `NODE_ENV` | Yes | `development` | `development` or `production` |
| `PORT` | No | `3001` | Backend server port |
| `DEMO_ACCOUNT_ENABLED` | No | `false` | Blocked in production |
| `COOKIE_DOMAIN` | Cross-domain | -- | e.g., `.ownmyhealth.io` |
| `COOKIE_SAME_SITE` | Cross-domain | `lax` | Set to `none` for cross-domain |
