# OwnMyHealth Deployment Guide

OwnMyHealth runs on **Google Cloud Platform**, deployed automatically by GitHub Actions.

| Tier | Where | Resource |
|------|-------|----------|
| Backend API | Cloud Run | `ownmyhealth-backend` (prod), `ownmyhealth-backend-staging` (staging) |
| Frontend | Cloud Storage (static SPA) | bucket `ownmyhealth-frontend` (prod), `ownmyhealth-frontend-staging` (staging) |
| Database | Cloud SQL for PostgreSQL | `ownmyhealth-prod:us-central1:ownmyhealth-db` |
| Migrations | Cloud Run **job** | `ownmyhealth-migrate` (runs as a deploy step — **not** at container boot) |
| Container images | Artifact Registry | repo `ownmyhealth` (`us-central1`) |

Project: `ownmyhealth-prod` · Region: `us-central1` · Domains: `ownmyhealth.io` (frontend) / `api.ownmyhealth.io` (backend).

> Railway was the original deployment target and has been **retired**. Deployment is GCP-only — there are no `railway.toml` files anymore.

---

## How deploys happen (the normal path)

Routine releases are automated by **`.github/workflows/deploy.yml`** (prod) and **`.github/workflows/deploy-staging.yml`** (staging). You do **not** run `gcloud` by hand for a normal release.

- **Prod**: push / merge to `master` → `deploy.yml` runs.
- **Staging**: push to `staging` → `deploy-staging.yml` runs.

Both are gated on the reusable CI workflow (**`ci.yml`**): frontend lint + test + build, backend lint + test + build, gitleaks secret scan, High/Critical `npm audit`, the RLS-wrapper guard, and the NOBYPASSRLS tenant-isolation suite against a real Postgres. **If CI fails, nothing is built or shipped.**

Prod deploy stages (each fails closed — a failure leaves production untouched):

1. **ci** — the full CI suite must pass.
2. **build-and-stage** — build the Docker image, push to Artifact Registry, deploy a new Cloud Run revision at **0% traffic** with a tagged URL.
3. **migrate** — point the `ownmyhealth-migrate` Cloud Run job at the new image SHA and run `prisma migrate deploy` (migrations run here, never at container boot).
4. **smoke-test** — curl the tagged revision's `/api/v1/health`.
5. **promote** — shift 100% traffic to the new revision.
6. **deploy-frontend** — build the SPA and sync it to the `ownmyhealth-frontend` GCS bucket.

---

## One-time setup

### Prerequisites
- GCP project `ownmyhealth-prod` with billing enabled.
- APIs enabled: Cloud Run, Artifact Registry / Cloud Build, Cloud SQL Admin, Secret Manager.
- `gcloud` CLI authenticated (`gcloud auth login`) for any manual / break-glass work.
- Domain `ownmyhealth.io` with DNS access at your registrar.

### GitHub secret
The workflows authenticate to GCP with a JSON service-account key:

- **`GCP_SA_KEY`** — JSON key for a deploy service account with Cloud Run Admin, Artifact Registry Writer, Cloud SQL Client, and Storage Admin (on the frontend bucket) roles.

> Infra note: migrating to Workload Identity Federation would replace this long-lived key with short-lived OIDC tokens — see the comment block in `deploy.yml`.

### Backend environment variables / secrets
Set these on the Cloud Run service (`ownmyhealth-backend`) as env vars or Secret Manager references — **never** in a committed file. The fully annotated list with boot-guard requirements is **`backend/.env.production.example`**. The critical set:

| Variable | Notes |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Cloud SQL Postgres connection (Secret Manager) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `openssl rand -base64 32`, ≥ 32 chars |
| `JWT_ACCESS_EXPIRES_SECONDS` / `JWT_REFRESH_EXPIRES_SECONDS` | `900` / `604800` (integer **seconds**) |
| `PHI_ENCRYPTION_KEY` | 64 hex chars (`openssl rand -hex 32`) — **back up securely; data loss if lost** |
| `AUDIT_LOG_SALT` | ≥ 16 chars; do **not** rotate on an env with historic audit logs |
| `ANTHROPIC_API_KEY` + `ANTHROPIC_BAA_ACTIVE=true` | required together in prod |
| `GCS_BUCKET_NAME` | `ownmyhealth-user-files` (boot hard-fails if unset — F-28) |
| `GCP_PROJECT_ID` | `ownmyhealth-prod` |
| `SENDGRID_API_KEY` / `EMAIL_FROM` / `FRONTEND_URL` | transactional email |
| `CORS_ORIGIN` | `https://ownmyhealth.io` |

Optional shared-infra (multi-instance accuracy): `REDIS_URL`, `AUDIT_CLEANUP_TOKEN` — see `backend/.env.production.example`.

### Frontend build-time variable
- `VITE_API_URL=https://api.ownmyhealth.io/api/v1` — embedded at build time in CI (template: `.env.production.example`).

---

## Database migrations

Migrations run as the **`ownmyhealth-migrate` Cloud Run job** during deploy (stage 3 above). The container CMD is `node dist/app.js` only — there is **no** boot-time `prisma migrate deploy`.

Manual run (break-glass):

```bash
gcloud run jobs execute ownmyhealth-migrate \
  --project ownmyhealth-prod --region us-central1 --wait
```

---

## Manual / break-glass deploy

Routine deploys go through GitHub Actions. If you must deploy by hand (e.g. a CI outage), the equivalent steps:

```bash
PROJECT=ownmyhealth-prod
REGION=us-central1
IMAGE="$REGION-docker.pkg.dev/$PROJECT/ownmyhealth/backend:$(git rev-parse --short HEAD)"

# 1. Build + push the backend image
gcloud builds submit backend --tag "$IMAGE" --project "$PROJECT"

# 2. Deploy a new revision at 0% traffic
gcloud run deploy ownmyhealth-backend --image "$IMAGE" \
  --project "$PROJECT" --region "$REGION" --no-traffic --tag candidate

# 3. Run migrations against the new image
gcloud run jobs update ownmyhealth-migrate --image "$IMAGE" \
  --project "$PROJECT" --region "$REGION"
gcloud run jobs execute ownmyhealth-migrate --project "$PROJECT" --region "$REGION" --wait

# 4. Smoke-test the candidate revision's /api/v1/health, then promote
gcloud run services update-traffic ownmyhealth-backend --to-latest \
  --project "$PROJECT" --region "$REGION"

# 5. Build + sync the frontend
npm ci && npm run build
gsutil -m rsync -d -r dist gs://ownmyhealth-frontend
```

> Cloud Run env-var updates can stay held at 0% traffic if the service was previously pinned to an explicit revision — follow any env change with `gcloud run services update-traffic ... --to-latest`.

---

## Custom domain

- **Frontend `ownmyhealth.io`** — the SPA is synced to the `ownmyhealth-frontend` GCS bucket. **Serve it only via an external HTTPS load balancer (or Cloud CDN) — never the bucket's static-website config**, which answers over cleartext HTTP and has no way to emit `Strict-Transport-Security` (OMH-M01 / L-M16: the SPA renders the login form and all PHI views, so a plaintext first-navigation is an SSL-strip window). Point apex / `www` DNS at the load balancer, and at that edge:
  - Provision a Google-managed TLS cert and an **HTTP(:80) → HTTPS(:443) redirect** (a redirect URL map).
  - Attach a custom-response-headers policy that adds **`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`** (and ideally `X-Content-Type-Options: nosniff` + a CSP) — GCS object metadata cannot set these, so they MUST come from the load balancer / CDN edge.
  - Consider submitting `ownmyhealth.io` to the HSTS preload list once the redirect + header are verified.
- **Backend `api.ownmyhealth.io`** — Cloud Run domain mapping:

  ```bash
  gcloud run domain-mappings create --service ownmyhealth-backend \
    --domain api.ownmyhealth.io --project ownmyhealth-prod --region us-central1
  ```

  Add the CNAME / A records it returns at your registrar. HTTPS certificates are provisioned automatically.

---

## Verify

1. `https://ownmyhealth.io` — frontend loads.
2. `https://api.ownmyhealth.io/api/v1/health` — returns the health check.
3. Register / log in end-to-end.

---

## Troubleshooting & runbooks

- Operational runbook: **`New Project Documents/RUNBOOK.md`**
- Symptom → root-cause: **`New Project Documents/TROUBLESHOOTING.md`**
- RLS / NOBYPASSRLS cutover: **`docs/c-8-part-c-runbook.md`**

A recurring gotcha: a deploy can succeed but the service crash-loop if a required env var is missing (e.g. the `GCS_BUCKET_NAME` F-28 boot guard). Confirm every required variable above is present on the new Cloud Run revision.
