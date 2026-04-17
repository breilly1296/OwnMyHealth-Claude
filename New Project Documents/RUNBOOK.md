# OwnMyHealth Operations Runbook

**Last Updated:** 2026-04-16 (code-derived + TBD infra values; run prompt `15-runbook-doc.md` to finalize)

---

## Quick Reference

| Service | URL / Identifier |
|---|---|
| Frontend (prod) | `https://ownmyhealth.io` (GCS bucket `ownmyhealth-frontend` behind domain) — verify |
| Backend API (prod) | `https://api.ownmyhealth.io/api/v1` |
| Health check | `GET /health`, `GET /api/v1/health` |
| GCP Project ID | `ownmyhealth-prod` |
| GCP Region | `us-central1` |
| Cloud Run service | `ownmyhealth-backend` |
| Frontend bucket | `ownmyhealth-frontend` |
| Artifact Registry | `us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth` |
| Cloud SQL instance | **TBD** (confirm from `gcloud sql instances list`) |
| Database name | `verifymyprovider` (per CLAUDE.md memory — confirm) |

(Values confirmed from `.github/workflows/deploy.yml`; database-side values need user confirmation via prompt 15.)

---

## 1. Deployment

### Backend — automatic (push to master)
```bash
git push origin master
```
Triggers `.github/workflows/deploy.yml` → Docker build → Artifact Registry push → `gcloud run deploy ownmyhealth-backend`.

### Backend — manual
```bash
# Authenticate
gcloud auth login
gcloud config set project ownmyhealth-prod

# Build + push (from repo root)
IMAGE="us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:$(git rev-parse --short HEAD)"
cd backend
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
docker build -t "$IMAGE" -t "us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:latest" .
docker push "$IMAGE"
docker push "us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:latest"

# Deploy
gcloud run deploy ownmyhealth-backend \
  --image "$IMAGE" \
  --region us-central1 \
  --project ownmyhealth-prod \
  --platform managed
```

### Frontend — manual
```bash
# From repo root
npm ci
VITE_API_URL=https://api.ownmyhealth.io/api/v1 npm run build

# Upload to GCS
gsutil -m rm -r gs://ownmyhealth-frontend/** || true
gsutil -m cp -r dist/* gs://ownmyhealth-frontend/

# Ensure index.html doesn't cache
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" gs://ownmyhealth-frontend/index.html
```

### Rollback (backend)
```bash
# List recent revisions
gcloud run revisions list --service=ownmyhealth-backend --region=us-central1

# Route 100% traffic to a previous revision
gcloud run services update-traffic ownmyhealth-backend \
  --region=us-central1 \
  --to-revisions=REVISION_NAME=100
```

### Rollback (frontend)
GCS has bucket versioning — enable it if not already (`gsutil versioning get gs://ownmyhealth-frontend`). To restore, `gsutil cp` the prior `dist/*` from backup. **If versioning isn't enabled**, there's no automatic rollback — document this as an open item.

---

## 2. Logs & Monitoring

### View recent errors (last 50)
```bash
gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="ownmyhealth-backend" severity>=ERROR' \
  --limit=50 \
  --format=json
```

### Filter by request ID
```bash
gcloud logging read 'resource.type="cloud_run_revision" jsonPayload.requestId="REQUEST_ID"' \
  --limit=100
```

### Failed logins in last hour
```bash
gcloud logging read 'resource.type="cloud_run_revision" jsonPayload.message=~"login" severity=WARNING timestamp>="-1h"' \
  --limit=100
```

### Tail logs live (in terminal)
```bash
gcloud alpha logging tail 'resource.type="cloud_run_revision" resource.labels.service_name="ownmyhealth-backend"'
```

### Service metrics (dashboard)
Cloud Run → `ownmyhealth-backend` → Metrics tab. Key graphs: Request count, p99 latency, Error rate, Memory utilization, Instance count.

### Alerts (TBD)
Configure via prompt 15 § Monitoring Q3 — alerts not derivable from code.
Suggested:
- 5xx rate > 1% for 5 min
- p99 latency > 2s for 5 min
- Instance count at max scale for > 5 min
- Anthropic cost > daily budget

---

## 3. Database Operations

### Connect to Cloud SQL (read-only)
```bash
# Requires cloud_sql_proxy installed
gcloud sql connect INSTANCE_NAME --user=postgres --database=verifymyprovider
```

### Run migrations in production
**Option A:** Migrations run on container startup (per commit `4a27c2f`). Verify by reading `backend/Dockerfile` CMD or entrypoint.
**Option B:** Manual via Cloud Shell:
```bash
# SSH to Cloud Shell with gcloud access, then:
cd /path/to/backend
DATABASE_URL="postgres://..." npx prisma migrate deploy
```

### Common queries
```sql
-- Total users
SELECT count(*) FROM users;

-- Users by role
SELECT role, count(*) FROM users GROUP BY role;

-- Audit log volume (last 7 days)
SELECT date_trunc('day', created_at) AS day, count(*)
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 1 DESC;

-- Recent logins
SELECT created_at, user_id, action, ip_address
FROM audit_logs
WHERE action IN ('LOGIN_SUCCESS', 'LOGIN_FAILURE')
ORDER BY created_at DESC LIMIT 50;

-- Active provider-patient relationships
SELECT count(*) FROM provider_patient WHERE status = 'ACTIVE';

-- Session count (expired cleanup window)
SELECT count(*) FILTER (WHERE expires_at > NOW()) AS active,
       count(*) FILTER (WHERE expires_at <= NOW()) AS expired
FROM sessions;
```

### Backups
Cloud SQL automated backups should be enabled (verify: `gcloud sql instances describe INSTANCE_NAME --format="value(settings.backupConfiguration.enabled)"`). Retention: TBD — confirm 7-day minimum for PHI per internal policy.

---

## 4. Secret Management

Secrets live in GCP Secret Manager and are mounted into Cloud Run as environment variables.

### List secrets
```bash
gcloud secrets list --project=ownmyhealth-prod
```

### View a secret value (read access required)
```bash
gcloud secrets versions access latest --secret=SECRET_NAME
```

### Update a secret
```bash
echo -n "new-secret-value" | gcloud secrets versions add SECRET_NAME --data-file=-
```

### Redeploy Cloud Run to pick up new secret
Secrets are pulled at cold start. Update alone isn't enough:
```bash
gcloud run services update ownmyhealth-backend --region=us-central1 --no-traffic
# Then route traffic to new revision
```

### Known secrets (from `backend/src/config/index.ts` — re-verify)
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `PHI_ENCRYPTION_KEY` — 64 hex chars, 256-bit
- `ANTHROPIC_API_KEY`
- `SENDGRID_API_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON, typically mounted not via Secret Manager)
- `GCS_BUCKET_NAME`
- `GCP_PROJECT_ID`
- `EMAIL_FROM`, `EMAIL_FROM_NAME`
- `FRONTEND_URL`

### Rotating PHI_ENCRYPTION_KEY
**This is hazardous** — all per-user keys derive from this. Rotating means re-encrypting every PHI row. Document this procedure carefully before attempting:

1. Generate new key: `openssl rand -hex 32`.
2. Store both old + new in secret manager (`PHI_ENCRYPTION_KEY_V2`).
3. Implement decrypt-with-v1 / encrypt-with-v2 dual path in `encryption.ts`.
4. Background job re-encrypts all rows.
5. Once done, retire v1.

Do not rotate without a migration plan.

---

## 5. Scheduled Tasks (inside backend)

The backend runs 2 internal schedulers on startup (confirm in `authService.ts` + `auditLog.ts`):

| Scheduler | Interval | Purpose |
|---|---|---|
| Session cleanup | every 10 minutes | Delete expired rows from `sessions` table |
| Audit log retention | daily | Delete audit rows older than 7 years (HIPAA minimum) |

These run in-process. **Implication:** if the only Cloud Run instance is idle, schedulers may not run. Verify that Cloud Run is configured with `min-instances ≥ 1` OR that schedulers are replaced with Cloud Scheduler jobs for reliability.

---

## 6. External Service Monitoring

### Anthropic Claude API
- Console: https://console.anthropic.com
- Budget + alerts: set monthly hard cap. Cross-reference with `aiCostTracker.ts` counters in DB.
- BAA status: ✅ Signed 2026-04-16. Residual risk: C-7 (input-side PHI minimization in `claudeExtraction.ts` / `sbcExtraction.ts`) — see SECURITY_STATUS.md.

### SendGrid
- Dashboard: https://app.sendgrid.com
- Verify "From" domain authenticated.
- Activity feed: bounces, spam reports, deliverability.

### Google Document AI (OCR)
- GCP Console → Document AI → processors.
- Processor ID stored in `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` env var.
- Per-page billing — monitor under Billing.

### Google Cloud Storage
```bash
# Bucket health
gsutil du -sh gs://ownmyhealth-frontend
gsutil du -sh gs://OWNMYHEALTH_FILES_BUCKET  # if separate bucket for user files

# Uniform bucket access verification
gsutil uniformbucketlevelaccess get gs://OWNMYHEALTH_FILES_BUCKET
```

---

## 7. Emergency Procedures

### Database unavailable
Symptoms: 500 errors, "connection terminated", `/health` fails DB check.
1. Check Cloud SQL instance state: `gcloud sql instances describe INSTANCE_NAME`.
2. If stopped / `RUNNABLE=false`, restart: `gcloud sql instances patch INSTANCE_NAME --activation-policy=ALWAYS`.
3. If healthy, check Cloud Run → Cloud SQL network path (VPC connector, auth).
4. Check connection pool exhaustion — DATABASE_URL should include `connection_limit` if set.

### Claude API down
Symptoms: 503s from AI endpoints, cost tracker shows rising failures.
- Core features still work (AI is supplemental). Verify user-facing UI degrades gracefully.
- Check status: https://status.anthropic.com
- Toggle feature flag (if present) to disable AI endpoints.

### Auth endpoint DDoS / credential stuffing
Symptoms: spike in `LOGIN_FAILURE` audit rows, 429s from `strictAuthLimiter`.
1. Confirm rate limiter is triggering (should be 429, not 200).
2. Tighten limits temporarily:
   ```bash
   # In rateLimiter.ts, reduce max; redeploy.
   ```
3. Inspect audit logs by IP:
   ```sql
   SELECT ip_address, count(*) FROM audit_logs
   WHERE action='LOGIN_FAILURE' AND created_at > NOW()-INTERVAL '1 hour'
   GROUP BY ip_address ORDER BY 2 DESC LIMIT 20;
   ```
4. If needed, add IP allowlist / blocklist at Cloud Armor (if configured) or middleware.

### Unauthorized PHI access investigation
```sql
-- Who accessed patient X's biomarkers in the last 30 days?
SELECT created_at, user_id, actor_type, action, ip_address, user_agent
FROM audit_logs
WHERE resource_type='BIOMARKER'
  AND metadata->>'patientId' = 'PATIENT_UUID'  -- structure depends on metadata shape
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;

-- All actions by a specific provider
SELECT created_at, action, resource_type, resource_id
FROM audit_logs
WHERE user_id = 'PROVIDER_UUID'
ORDER BY created_at DESC LIMIT 200;
```

### Account lockout troubleshooting
- User locked out: `UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE email='...'` (run with explicit intent; audit log this manually).
- Verify `MAX_LOGIN_ATTEMPTS` and `LOCKOUT_DURATION_MINUTES` in config.

---

## 8. CI Pipeline (`.github/workflows/ci.yml`)

Runs on PRs and pushes to `main`/`master`/`develop`:
- Frontend: ESLint → Vitest → Vite build
- Backend: ESLint → Prisma generate → Unit tests → TS build
- `npm audit` on both
- Node 20 LTS

**If CI fails:** always investigate. Don't bypass with `--no-verify`.

---

## 9. Local Development

```bash
# Clone + install
git clone https://github.com/<owner>/OwnMyHealth.git
cd OwnMyHealth
npm install
cd backend && npm install && cd ..

# Set up .env files (see .env.example, backend/.env.example)
cp .env.example .env
cp backend/.env.example backend/.env
# Fill in DATABASE_URL (local postgres), secrets, etc.

# Run
npm run dev           # frontend at http://localhost:5173
cd backend && npm run dev  # backend at http://localhost:3001

# Prisma
cd backend
npx prisma generate
npx prisma migrate dev
npx prisma studio  # DB GUI on :5555
```

---

## Credentials Reference (TBD — fill from prompt 15)

| Resource | Value |
|---|---|
| GCP Project | `ownmyhealth-prod` |
| GCP Region | `us-central1` |
| Cloud SQL instance | **TBD** |
| Database name | `verifymyprovider` (confirm) |
| Database user | **TBD** |
| Production frontend URL | **TBD** (confirm `https://ownmyhealth.io` or equivalent) |
| Production backend URL | `https://api.ownmyhealth.io` |
| Cloud Storage files bucket | **TBD** (separate from frontend bucket) |
| Document AI processor ID | **TBD** (env var `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`) |
| SendGrid verified sender | **TBD** |
| Anthropic org ID | **TBD** |

---

## Sections to fill from prompt 15

- Production URLs (frontend + API) — §Infrastructure Q3
- Cloud SQL instance name + DB user — §Database Q1–Q3
- Monitoring alerts — §Monitoring Q3
- Emergency contact list — (implicit — add if multi-person ops)
- Backup/restore test date — (implicit)
