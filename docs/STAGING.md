# Staging Environment

A production-like pre-prod environment for validating changes before they hit
real users. Staging uses the same GCP project as production but separate Cloud
Run services, a separate database, and a separate GCS bucket, so a broken
staging deploy can't touch production data.

## URLs

| | Production | Staging |
|---|---|---|
| Frontend | `https://ownmyhealth.io` | `https://staging.ownmyhealth.io` |
| Backend | `https://api.ownmyhealth.io` | `https://api-staging.ownmyhealth.io` |
| Cloud Run service | `ownmyhealth-backend` | `ownmyhealth-backend-staging` |
| GCS bucket | `ownmyhealth-frontend` | `ownmyhealth-frontend-staging` |
| Database | `ownmyhealth` (prod SQL instance) | `ownmyhealth_staging` (separate DB) |

## Workflow

```
feature branch
      │
      ▼
  staging branch  ──► deploy-staging.yml ──► staging.ownmyhealth.io
      │
      ▼ (verify in staging)
  master branch  ──► deploy.yml ──► ownmyhealth.io (gated smoke-test + canary)
```

1. Develop on a feature branch as usual.
2. Merge / push to `staging` — the `deploy-staging.yml` workflow auto-deploys
   the backend to `ownmyhealth-backend-staging` and the frontend to the
   staging bucket.
3. Manually test on `staging.ownmyhealth.io`. Use the staging demo account
   (enabled automatically, see env config).
4. If it looks right, merge `staging` into `master`. The production
   `deploy.yml` takes over from there (canary deploy → smoke test → promote).

## Creating the staging branch

```bash
git checkout master
git checkout -b staging
git push -u origin staging
```

Once the branch exists, pushes to it trigger `deploy-staging.yml` automatically.

## What's different from production

| Area | Production | Staging |
|---|---|---|
| `NODE_ENV` | `production` | `staging` |
| SendGrid | Live send | **Sandbox mode** — emails validate but don't deliver |
| Anthropic | `ANTHROPIC_BAA_ACTIVE=true` — Claude calls allowed | `ANTHROPIC_BAA_ACTIVE=false` — Claude calls blocked by runtime gate |
| Demo account | **Disabled** (startup assertion blocks `DEMO_ACCOUNT_ENABLED=true`) | Enabled |
| Traffic splitting | Canary + gated promotion | Straight to 100% |
| Secrets | `JWT_*`, `PHI_ENCRYPTION_KEY` → prod Secret Manager | Separate staging secrets in Secret Manager with `-staging` suffix |

**No real PHI in staging.** BAA is off and SendGrid is sandboxed precisely
because staging is for testing flows, not handling patient data. If you need
to reproduce a production bug, import synthetic test fixtures — don't copy
production rows.

## Infrastructure setup (one-time, manual)

The workflow handles code deploys, but these resources must exist first. All
steps run in the `ownmyhealth-prod` GCP project.

### 1. Database

Either a separate Cloud SQL instance (isolated but ~$50/mo extra) or a
separate database on the shared instance (cheaper, same blast radius if the
instance itself fails). For v1, a shared instance is fine:

```sql
CREATE DATABASE ownmyhealth_staging;
```

Apply migrations against the new DB:

```bash
DATABASE_URL=postgresql://postgres:***@<host>:5432/ownmyhealth_staging \
  npx prisma migrate deploy --schema=backend/prisma/schema.prisma
```

### 2. Cloud Run service

First staging push creates `ownmyhealth-backend-staging` automatically. After
the first deploy, attach env vars via Secret Manager + the service settings:

```bash
gcloud run services update ownmyhealth-backend-staging \
  --region us-central1 \
  --set-env-vars=NODE_ENV=staging,CORS_ORIGIN=https://staging.ownmyhealth.io,... \
  --set-secrets=JWT_ACCESS_SECRET=jwt-access-secret-staging:latest,...
```

Reference `backend/.env.staging.example` for the full list.

### 3. GCS frontend bucket

```bash
gsutil mb -l us-central1 gs://ownmyhealth-frontend-staging
gsutil web set -m index.html -e index.html gs://ownmyhealth-frontend-staging
gsutil iam ch allUsers:objectViewer gs://ownmyhealth-frontend-staging
```

### 4. Custom domains

Map `staging.ownmyhealth.io` → the staging frontend bucket and
`api-staging.ownmyhealth.io` → the staging Cloud Run service. Same pattern as
production (Cloud Run domain mapping, DNS `CNAME`).

### 5. Secrets

For each secret the backend requires, create a `-staging` variant in Secret
Manager and grant the staging Cloud Run service account access:

- `jwt-access-secret-staging`
- `jwt-refresh-secret-staging`
- `phi-encryption-key-staging`
- `sendgrid-api-key-staging`
- `anthropic-api-key-staging` (optional — same key as prod is fine if you only
  exercise Claude via stub data)

## Promoting staging → production

Staging is just git; production promotion is just another git push:

```bash
git checkout master
git merge --no-ff staging
git push origin master
```

This kicks off `deploy.yml` which does the real canary → smoke-test → promote
sequence.

## Rolling back staging

No canary means no one-command rollback. If staging breaks:

```bash
# Option A: revert the staging commit
git revert <sha> && git push origin staging

# Option B: redeploy a previous image by SHA
gcloud run services update ownmyhealth-backend-staging \
  --region us-central1 \
  --image us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend-staging:<old-sha>
```
