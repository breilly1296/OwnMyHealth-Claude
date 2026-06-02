---
tags:
  - security
  - infrastructure
  - high
type: prompt
priority: 2
updated: 2026-06-01
---

# CI/CD Security Review

## Files to Review
There are exactly **three** workflows under `.github/workflows/`:
- `.github/workflows/ci.yml` (lint/test/build + security + RLS gates)
- `.github/workflows/deploy.yml` (production canary pipeline → Cloud Run + GCS)
- `.github/workflows/deploy-staging.yml` (push to `staging` → staging Cloud Run + GCS)
- `backend/Dockerfile` (the ONLY Dockerfile — there is no root/frontend `Dockerfile`; the frontend is a static Vite build deployed to GCS)
- `.dockerignore` and `backend/.dockerignore` (excluded files)
- `.gitleaks.toml` (secret-scan allowlist used by the `ci.yml` security job)
- `scripts/check-rls-wrappers.sh` (RLS wrapper guard invoked by the `ci.yml` security job)

## OwnMyHealth CI/CD Architecture
- **Platform**: GitHub Actions
- **CI Workflow**: `ci.yml` — five jobs: `frontend`, `backend`, `security`, `rls`, plus a commented-out `e2e-tests` job. Runs on push to `main`/`master`/`develop`/`claude/**` and PRs to `main`/`master`/`develop`.
- **Deploy Workflow**: `deploy.yml` — a gated canary, NOT a single all-at-once deploy. Jobs: `build-and-stage` (Docker build → Artifact Registry → Cloud Run at **0% traffic** with a `staging-<sha>` tag) → `smoke-test` (probe tagged URL `/api/v1/health`) → `promote` (shift 100% via explicit `--to-revisions`, then post-promote prod health probe, then remove staging tag); `deploy-frontend` runs in parallel.
- **Staging Workflow**: `deploy-staging.yml` — push to `staging`; builds + deploys straight to 100% traffic on `ownmyhealth-backend-staging` (no canary, no gated promote — "staging is the smoke test").
- **Container Registry**: GCP Artifact Registry (`us-central1-docker.pkg.dev`, repository `ownmyhealth`)
- **Backend Deployment**: Cloud Run service `ownmyhealth-backend` (project `ownmyhealth-prod`, region `us-central1`, `--max-instances=3`)
- **Frontend Deployment**: GCS bucket `ownmyhealth-frontend` via `gsutil rsync -d -r` + `setmeta` no-cache on `index.html`
- **Trigger**: `deploy.yml` on push to `master`/`main` or `workflow_dispatch`; `deploy-staging.yml` on push to `staging` or `workflow_dispatch`

## Checklist

### 1. Workflow Security
- [ ] Uses specific action versions (not `@latest` or `@master`)
- [ ] Third-party actions ideally pinned to full commit SHAs (currently tag-pinned: `actions/checkout@v4`, `actions/setup-node@v4`, `google-github-actions/auth@v2`, `google-github-actions/setup-gcloud@v2`). `deploy.yml` carries an inline `TODO(supply-chain)` to SHA-pin these — confirm it's tracked, not forgotten.
- [ ] Secrets accessed via `${{ secrets.* }}` only (the only secret used is `secrets.GCP_SA_KEY`)
- [ ] No secrets echoed to logs
- [ ] Permissions minimized per job (note: no `permissions:` block is currently declared in any workflow — jobs run with the default token scope)

### 2. Secret Handling
- [ ] Secrets not printed in debug output
- [ ] Secrets masked in logs (`add-mask`)
- [ ] GCP service-account key (`secrets.GCP_SA_KEY`) passed only to `google-github-actions/auth@v2` via `credentials_json`, never echoed
- [ ] `ci.yml` security job runs gitleaks secret-scan (`--no-git --config .gitleaks.toml`) to block committed secrets
- [ ] No secrets in workflow file itself (the `PHI_ENCRYPTION_KEY` in the `rls` job is an inline test-only placeholder key, never used on real PHI — confirm it stays a dummy)

### 3. Dockerfile Security (`backend/Dockerfile`)
- [ ] Base image from trusted source (`node:20-alpine`)
- [ ] Base image version pinned (not `latest`) — currently `node:20-alpine` (consider digest-pinning for full reproducibility)
- [ ] No secrets in Dockerfile (the `ENV DATABASE_URL=postgresql://dummy...` is a known dummy used only so `prisma generate` runs offline — confirm it's never a real URL)
- [ ] No secrets in build args
- [ ] Multi-stage build (`builder` → `production`, smaller attack surface) — present
- [ ] Non-root user in container (`addgroup nodejs` / `adduser nodejs` uid 1001, `USER nodejs`) — present
- [ ] `apk update && apk upgrade` runs in the production stage to patch base-image CVEs
- [ ] `HEALTHCHECK` defined (wget `/health`) — present
- [ ] Stale comment: header says "AWS ECS deployment" but the target is GCP Cloud Run — note the mismatch

### 4. .dockerignore Coverage
Check both `.dockerignore` (root) and `backend/.dockerignore` (the build context for `backend/Dockerfile` is `backend/`, so the backend file is the one that actually applies to the image):
- [ ] `.env`, `.env.local`, `.env.*.local` excluded
- [ ] `.git`/`.gitignore` excluded
- [ ] `node_modules` excluded (rebuilt in container)
- [ ] Test files excluded (`**/__tests__`, `**/*.test.ts`, `**/*.spec.ts`)
- [ ] Secret/key files excluded (backend file also drops `cookies.txt`)
- [ ] `dist`/`coverage` excluded (rebuilt in container)

### 5. Build Process
- [ ] Dependencies installed from lockfile (`npm ci` in builder, `npm ci --omit=dev` in production stage)
- [ ] No `npm install` without lockfile
- [ ] Build artifacts don't contain source maps in production
- [ ] No dev dependencies in production image (`--omit=dev` enforces this)
- [ ] `prisma generate` runs in both stages with the dummy `DATABASE_URL` (no live DB at build time)

### 6. Deployment Process (`deploy.yml`)
- [ ] Canary, not all-at-once: new revision deployed at `--no-traffic` with a `staging-<sha>` tag before any prod shift
- [ ] Health check gates traffic: `smoke-test` job probes the tagged URL `/api/v1/health` (6 retries) before `promote` runs
- [ ] Post-promote prod health probe (`https://api.ownmyhealth.io/api/v1/health`) after the 100% shift
- [ ] Rollback capability: traffic shifted via explicit `--to-revisions="$NEW_REV=100"` (named revision, deterministic rollback) — NOT `--to-latest`
- [ ] Image tagged by `${{ github.sha }}` only (the `:latest` tag was intentionally dropped per inline F-32 note) — confirm no consumer still pulls `:latest`
- [ ] `--max-instances=3` kept in sync with the in-memory/Redis rate-limiter store assumption (raising it requires Redis-backed `rateLimitStore.ts`)
- [ ] Deployment notifications (optional)

### 7. Branch Protection
- [ ] Master branch protected
- [ ] Require PR reviews (if team)
- [ ] Require status checks to pass
- [ ] No force push to master

### 8. Service Account Permissions
All workflows authenticate with a single secret, `secrets.GCP_SA_KEY` (a JSON key passed to `google-github-actions/auth@v2`). Verify minimum required roles on that SA:
- [ ] `roles/artifactregistry.writer` - push images
- [ ] `roles/run.admin` - deploy to Cloud Run + shift traffic
- [ ] `roles/iam.serviceAccountUser` - act as the Cloud Run runtime SA
- [ ] `roles/storage.admin` (or scoped object-admin on the frontend buckets) - `gsutil rsync`/`setmeta` for frontend deploy
- [ ] No excessive permissions (no `roles/owner`, no `roles/editor`)
- [ ] Consider migrating from a long-lived JSON key to Workload Identity Federation (keyless OIDC)

## GitHub Actions Best Practices
```yaml
# Good: pinned versions
- uses: actions/checkout@v4
- uses: google-github-actions/auth@v2

# Bad: unpinned
- uses: actions/checkout@master
- uses: some-action@latest
```

### 9. Frontend Deployment (`deploy-frontend` job)
- [ ] Frontend built with Vite (`npm run build`, `VITE_API_URL=https://api.ownmyhealth.io/api/v1`; staging uses `--mode staging`)
- [ ] Built assets uploaded to GCS bucket `ownmyhealth-frontend` via `gsutil -m rsync -d -r dist/` (prod) — no rm/cp 404 window (per inline F-31 note). Note: `deploy-staging.yml` still uses the older `rm -r` + `cp -r` shape against `ownmyhealth-frontend-staging`.
- [ ] `index.html` gets `Cache-Control: no-cache, no-store, must-revalidate` via `gsutil setmeta` (prevent stale deployments)
- [ ] Static assets have long cache headers (fingerprinted filenames)
- [ ] No source maps in production build
- [ ] No `.env` values embedded in build beyond `VITE_*` prefixed vars

### 10. CI Pipeline (`ci.yml`)
- [ ] Runs on push to `main`/`master`/`develop`/`claude/**` and PRs to `main`/`master`/`develop`; also `workflow_call`-able
- [ ] `frontend` job: `npm ci` → ESLint → Vitest → Vite build → upload `dist/` artifact (7-day retention)
- [ ] `backend` job: `npm ci` → ESLint → `prisma generate` → `npm run test:ci` (full colocated unit suite, excludes the live-Postgres RLS test) → `npm run build` → upload `backend/dist/` artifact (7-day retention)
- [ ] `security` job: gitleaks secret scan → `npm audit --audit-level=high` (frontend + backend) → RLS wrapper guard (`scripts/check-rls-wrappers.sh`, fails the build if a controller/service bypasses `withRLSContext`)
- [ ] `rls` job: spins up `postgres:16` service, applies migrations as superuser, provisions a NOBYPASSRLS `omh_app` role (`prisma/rls-test-role.sql`), runs `npm run test:rls` so RLS policies are actually enforced
- [ ] Uses Node 20 LTS (env `NODE_VERSION: '20'`)
- [ ] Artifacts uploaded with retention limits (`retention-days: 7`)
- [ ] `e2e-tests` job is present but commented out (deferred to staging infra) — confirm whether it should be wired now

## Questions to Ask
1. Are all action versions pinned? Is the `deploy.yml` SHA-pin `TODO(supply-chain)` still open?
2. Are secrets properly masked in logs? Is `secrets.GCP_SA_KEY` ever echoed?
3. Does `backend/Dockerfile` run as non-root (`USER nodejs`)?
4. Are the GCS buckets (`ownmyhealth-frontend`, `ownmyhealth-frontend-staging`) configured with proper access controls?
5. Are CI/CD service-account permissions minimally scoped (no owner/editor)? Should it move to keyless Workload Identity Federation?
6. Does the canary gate hold — can a deploy reach 100% prod traffic if `smoke-test` fails?
7. Does the `rls` job actually fail merges on RLS policy regressions (NOBYPASSRLS role enforced)?
8. Does `deploy-staging.yml` (straight-to-100%, non-fatal health probe) match the intended risk posture for the `staging` branch?
