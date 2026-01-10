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
- **Container Registry**: GCP Artifact Registry
- **Deployment Target**: Cloud Run
- **Trigger**: Push to master branch

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

## Questions to Ask
1. Are all action versions pinned?
2. Are secrets properly masked in logs?
3. Does the Dockerfile run as non-root?
