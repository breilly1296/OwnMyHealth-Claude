---
tags:
  - security
  - infrastructure
  - high
type: prompt
priority: 2
---

# CI/CD Security Review

## Files to Review
- `.github/workflows/deploy.yml` (main pipeline)
- `.github/workflows/*.yml` (any other workflows)
- `Dockerfile` (container build)
- `backend/Dockerfile` (backend container)
- `.dockerignore` (excluded files)

## OwnMyHealth CI/CD Architecture
- **Platform**: GitHub Actions
- **CI Workflow**: `ci.yml` — lint, test, build (frontend + backend + security audit)
- **Deploy Workflow**: `deploy.yml` — Docker build → Artifact Registry → Cloud Run
- **Container Registry**: GCP Artifact Registry (`us-central1-docker.pkg.dev`)
- **Backend Deployment**: Cloud Run (ownmyhealth-prod, us-central1)
- **Frontend Deployment**: GCS bucket (ownmyhealth-frontend) with cache headers
- **Trigger**: Push to master/main branch, or manual dispatch

## Checklist

### 1. Workflow Security
- [ ] Uses specific action versions (not `@latest` or `@master`)
- [ ] Secrets accessed via `${{ secrets.* }}` only
- [ ] No secrets echoed to logs
- [ ] Permissions minimized per job

### 2. Secret Handling
- [ ] Secrets not printed in debug output
- [ ] Secrets masked in logs (`add-mask`)
- [ ] Service account key handled securely
- [ ] No secrets in workflow file itself

### 3. Dockerfile Security
- [ ] Base image from trusted source
- [ ] Base image version pinned (not `latest`)
- [ ] No secrets in Dockerfile
- [ ] No secrets in build args
- [ ] Multi-stage build (smaller attack surface)
- [ ] Non-root user in container

### 4. .dockerignore Coverage
- [ ] `.env` files excluded
- [ ] `.git` directory excluded
- [ ] `node_modules` excluded (rebuilt in container)
- [ ] Test files excluded
- [ ] Secret/key files excluded

### 5. Build Process
- [ ] Dependencies installed from lockfile
- [ ] No `npm install` without lockfile
- [ ] Build artifacts don't contain source maps in production
- [ ] No dev dependencies in production image

### 6. Deployment Process
- [ ] Rolling deployments (not all-at-once)
- [ ] Health checks before traffic routing
- [ ] Rollback capability
- [ ] Deployment notifications (optional)

### 7. Branch Protection
- [ ] Master branch protected
- [ ] Require PR reviews (if team)
- [ ] Require status checks to pass
- [ ] No force push to master

### 8. Service Account Permissions
Verify minimum required roles:
- [ ] `roles/artifactregistry.writer` - push images
- [ ] `roles/run.admin` - deploy to Cloud Run
- [ ] `roles/cloudbuild.builds.builder` - run builds
- [ ] No excessive permissions (no `roles/owner`)

## GitHub Actions Best Practices
```yaml
# Good: pinned versions
- uses: actions/checkout@v4
- uses: google-github-actions/auth@v2

# Bad: unpinned
- uses: actions/checkout@master
- uses: some-action@latest
```

### 9. Frontend Deployment
- [ ] Frontend built with Vite (production mode)
- [ ] Built assets uploaded to GCS bucket
- [ ] `index.html` has `Cache-Control: no-cache` (prevent stale deployments)
- [ ] Static assets have long cache headers (fingerprinted filenames)
- [ ] No source maps in production build
- [ ] No `.env` values embedded in build beyond `VITE_*` prefixed vars

### 10. CI Pipeline (`ci.yml`)
- [ ] Runs on push to main/master/develop and PRs
- [ ] Frontend: ESLint → Vitest → Vite build
- [ ] Backend: ESLint → Prisma generate → Unit tests → TypeScript build
- [ ] Security: `npm audit` for both frontend and backend
- [ ] Uses Node 20 LTS
- [ ] Artifacts uploaded with retention limits

## Questions to Ask
1. Are all action versions pinned?
2. Are secrets properly masked in logs?
3. Does the Dockerfile run as non-root?
4. Is the GCS bucket configured with proper access controls?
5. Are CI/CD service account permissions minimally scoped?
