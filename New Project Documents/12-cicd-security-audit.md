# CI/CD Security Audit

**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (automated security audit)
**Scope:** GitHub Actions workflows, Dockerfile, .dockerignore, deploy scripts, container security, branch protection
**Severity Rating:** MEDIUM-HIGH -- Several findings require attention before production deployment

---

## Executive Summary

The OwnMyHealth project uses GitHub Actions for CI/CD with two workflow files (`ci.yml` and `deploy.yml`) deploying to GCP Cloud Run (backend) and GCS (frontend). A `backend/Dockerfile` with multi-stage build is well-structured. However, the audit identified several issues: (1) the CI pipeline uses `npm install` instead of `npm ci`, creating reproducibility risks; (2) no `permissions` block is defined in any workflow, granting overly broad default token permissions; (3) `deploy.yml` has no dependency on CI passing first, so broken code can be deployed; (4) no `add-mask` usage for secret masking in logs; (5) the `auto-commit.sh` script uses `git add -A` and pushes directly to master, bypassing any code review; and (6) backend TypeScript compiles with `sourceMap: true`, meaning source maps are included in the production Docker image.

The Dockerfile itself is well-designed with multi-stage build, non-root user, health checks, and `npm ci --omit=dev`. The `.dockerignore` files properly exclude `.env`, `.git`, `node_modules`, and test files.

---

## Files Reviewed

| File | Source |
|------|--------|
| Deploy workflow | `.github/workflows/deploy.yml` (from git HEAD) |
| CI workflow | `.github/workflows/ci.yml` (from git HEAD) |
| Backend Dockerfile | `backend/Dockerfile` |
| Root .dockerignore | `.dockerignore` |
| Backend .dockerignore | `backend/.dockerignore` |
| Railway config | `railway.toml` |
| Deploy guide | `DEPLOY.md` |
| Frontend package.json | `package.json` |
| Backend package.json | `backend/package.json` |
| Backend tsconfig.json | `backend/tsconfig.json` |
| Vite config | `vite.config.ts` |
| Config loader | `backend/src/config/index.ts` |
| Root .gitignore | `.gitignore` |
| Backend .gitignore | `backend/.gitignore` |
| Auto-commit script | `auto-commit.sh` |
| Backend .env (local) | `backend/.env` (NOT in git) |

---

## Checklist Results

### 1. Workflow Security

- [x] **PASS** -- Uses specific action versions (not `@latest` or `@master`).
  - `deploy.yml` uses: `actions/checkout@v4`, `google-github-actions/auth@v2`, `google-github-actions/setup-gcloud@v2`, `actions/setup-node@v4`
  - `ci.yml` uses: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`
  - All pinned to major version tags (`@v4`, `@v2`), which is acceptable. Pinning to full SHA would be stricter but is not commonly required.

- [x] **PASS** -- Secrets accessed via `${{ secrets.* }}` only.
  - `deploy.yml` references `${{ secrets.GCP_SA_KEY }}` at the `google-github-actions/auth@v2` step. No other secret references exist.
  - No secrets are used directly in `ci.yml`.

- [~] **PARTIAL** -- No secrets echoed to logs.
  - The `${{ secrets.GCP_SA_KEY }}` is passed as `credentials_json` to the auth action, which is safe.
  - However, `deploy.yml` uses extensive `echo` statements in shell `run` blocks. While these only echo image names, regions, and service URLs (not secrets), the liberal use of `echo` increases risk of accidental secret leakage if the workflow is modified in the future.
  - **Finding:** No `::add-mask::` commands are used anywhere to explicitly mask dynamic values.

- [ ] **FAIL** -- Permissions NOT minimized per job.
  - Neither `deploy.yml` nor `ci.yml` declares a `permissions:` block at the workflow or job level.
  - This means the workflows inherit the default repository token permissions, which may include write access to repository contents, packages, and more.
  - **Recommendation:** Add explicit `permissions:` blocks. For `deploy.yml`: `contents: read`. For `ci.yml`: `contents: read`, `actions: read`.

### 2. Secret Handling

- [~] **PARTIAL** -- Secrets not printed in debug output.
  - GitHub Actions automatically masks secrets referenced via `${{ secrets.* }}`. The `GCP_SA_KEY` is only passed to the auth action as `credentials_json`, not to shell commands.
  - However, if `ACTIONS_STEP_DEBUG` is enabled, debug logs could expose internal auth token details from the GCP auth action. No mitigation is in place for this.

- [ ] **FAIL** -- Secrets NOT masked in logs (`add-mask`).
  - No `::add-mask::` commands are used in any workflow file.
  - The GCP auth action generates intermediate tokens (access tokens for gcloud, Docker registry tokens) that could appear in logs if verbose logging is enabled.
  - **Recommendation:** Add `echo "::add-mask::$(gcloud auth print-access-token)"` after authentication steps.

- [x] **PASS** -- Service account key handled securely.
  - `GCP_SA_KEY` is stored as a GitHub Actions secret and passed directly to `google-github-actions/auth@v2` via `credentials_json: ${{ secrets.GCP_SA_KEY }}`. The key is never written to disk by the workflow itself (the auth action handles this internally with cleanup).

- [x] **PASS** -- No secrets in workflow file itself.
  - Both `deploy.yml` and `ci.yml` contain no hardcoded secrets, passwords, API keys, or credentials.
  - The only references to secrets are via `${{ secrets.GCP_SA_KEY }}` and `${{ env.* }}` for non-secret configuration (project ID, region, service names).
  - Note: `ci.yml` line for Prisma generate uses `DATABASE_URL: postgresql://user:password@localhost:5432/test` -- this is a dummy connection string for client generation only (no actual database connection), so this is acceptable.

### 3. Dockerfile Security

- [x] **PASS** -- Base image from trusted source.
  - `backend/Dockerfile:4` uses `node:20-alpine` from the official Docker Hub Node.js image.

- [~] **PARTIAL** -- Base image version pinned (not `latest`).
  - `backend/Dockerfile:4`: `FROM node:20-alpine AS builder` and line 24: `FROM node:20-alpine AS production`.
  - Pinned to Node.js 20 major version with Alpine variant. However, `20-alpine` resolves to the latest Node 20 minor/patch on Alpine, which can change. Pinning to a specific digest (e.g., `node:20.11.1-alpine3.19@sha256:...`) would provide full reproducibility.
  - **Current risk: LOW** -- Node 20 is LTS, and minor updates are generally safe.

- [~] **PARTIAL** -- No secrets in Dockerfile.
  - `backend/Dockerfile:18,37`: `ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"` -- This is a dummy/placeholder URL used only for `prisma generate` (client code generation, no database connection). However, setting it as an `ENV` means it persists as a layer in the final image.
  - **Finding:** While the value is a dummy, the `ENV` instruction on line 37 (in the production stage) persists into the final image. A determined attacker inspecting the image layers would see this. Should use `ARG` instead of `ENV` to avoid persisting in the final image, or use `RUN --mount=type=secret`.

- [x] **PASS** -- No secrets in build args.
  - No `ARG` instructions are used for secret values. The Dockerfile does not accept any external build arguments containing secrets.

- [x] **PASS** -- Multi-stage build (smaller attack surface).
  - `backend/Dockerfile` uses a two-stage build: `builder` stage (line 4) compiles TypeScript and generates Prisma client; `production` stage (line 24) only copies compiled output and production dependencies.
  - Source code (`src/` directory) is NOT present in the final image.

- [x] **PASS** -- Non-root user in container.
  - `backend/Dockerfile:43-44`: Creates a `nodejs` group (GID 1001) and `nodejs` user (UID 1001), then sets `USER nodejs` before `EXPOSE` and `CMD`.
  - The container runs as a non-root user.

### 4. .dockerignore Coverage

- [x] **PASS** -- `.env` files excluded.
  - Root `.dockerignore:12-14`: `.env`, `.env.local`, `.env.*.local`
  - Backend `.dockerignore:12-14`: `.env`, `.env.local`, `.env.*.local`

- [x] **PASS** -- `.git` directory excluded.
  - Root `.dockerignore:20`: `.git`
  - Backend `.dockerignore:20`: `.git`

- [x] **PASS** -- `node_modules` excluded (rebuilt in container).
  - Root `.dockerignore:2`: `node_modules`
  - Backend `.dockerignore:2`: `node_modules`

- [x] **PASS** -- Test files excluded.
  - Root `.dockerignore:25-29`: `**/__tests__`, `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`
  - Backend `.dockerignore:25-27`: `**/__tests__`, `**/*.test.ts`, `**/*.spec.ts`

- [~] **PARTIAL** -- Secret/key files excluded.
  - `.env` files are excluded (see above).
  - Root `.dockerignore` excludes `backend` entirely (line 36), so `backend/.env` cannot leak through the root context.
  - Backend `.dockerignore:36` excludes `cookies.txt`.
  - **Finding:** Neither `.dockerignore` explicitly excludes `*.json` key files (e.g., `gcp-ocr-key.json`). The `backend/.gitignore:35` references `gcp-ocr-key.json` but the `.dockerignore` does not. If a GCP service account key file is present locally, it could be included in the Docker build context.
  - **Recommendation:** Add `*-key.json`, `*-credentials.json`, `*.pem`, `*.key` to `backend/.dockerignore`.

### 5. Build Process

- [~] **PARTIAL** -- Dependencies installed from lockfile.
  - **Dockerfile:** `backend/Dockerfile:12` uses `npm ci` (correct -- uses lockfile). `backend/Dockerfile:31` uses `npm ci --omit=dev` (correct).
  - **deploy.yml frontend job:** Uses `npm ci` (correct).
  - **ci.yml:** Uses `npm install` at both `ci.yml:frontend` and `ci.yml:backend` steps. This does NOT use the lockfile exclusively and can install different versions than what was tested.
  - **Finding:** `ci.yml` should use `npm ci` instead of `npm install` for reproducible builds.

- [ ] **FAIL** -- `npm install` used without lockfile enforcement in CI.
  - `ci.yml` frontend job: `run: npm install` (should be `npm ci`)
  - `ci.yml` backend job: `run: npm install` (should be `npm ci`)
  - `deploy.yml` frontend job: `run: npm ci` (correct)
  - `backend/Dockerfile:12,31`: `npm ci` (correct)
  - **Risk:** CI tests may pass with different dependency versions than what gets deployed, creating a false sense of security.

- [~] **PARTIAL** -- Build artifacts don't contain source maps in production.
  - **Frontend (Vite):** `vite.config.ts` does not explicitly configure `build.sourcemap`. Vite defaults to `false` for source maps in production builds. **PASS** for frontend.
  - **Backend (TypeScript):** `backend/tsconfig.json:16` has `"sourceMap": true`. This means `.js.map` files are generated alongside `.js` files in `dist/`. The Dockerfile copies the entire `dist/` directory (`COPY --from=builder /app/dist ./dist`), including source maps.
  - **Finding:** Backend source maps are included in the production Docker image. This allows an attacker with container access to reconstruct the original TypeScript source code.
  - **Recommendation:** Either set `"sourceMap": false` in `backend/tsconfig.json` for production builds, or add a step in the Dockerfile to remove `.js.map` files: `RUN find dist -name '*.map' -delete`.

- [x] **PASS** -- No dev dependencies in production image.
  - `backend/Dockerfile:31`: `RUN npm ci --omit=dev` -- Only production dependencies are installed in the final stage.
  - Dev dependencies (TypeScript compiler, ESLint, test frameworks) are only in the `builder` stage and are not carried over.

### 6. Deployment Process

- [~] **PARTIAL** -- Rolling deployments (not all-at-once).
  - Cloud Run deployments are managed by `gcloud run deploy` (`deploy.yml:73`). Cloud Run by default performs rolling deployments with traffic gradually shifting to new revisions.
  - However, the `deploy.yml` does not explicitly set `--no-traffic` or `--tag` flags for canary/staged rollouts.
  - **Current behavior:** Cloud Run default is to route 100% of traffic to the new revision immediately after it passes the startup health check. This is effectively "all-at-once" but with automatic rollback if the new revision fails to start.

- [~] **PARTIAL** -- Health checks before traffic routing.
  - `backend/Dockerfile:48-49`: Container-level `HEALTHCHECK` is defined (`wget` to `/health` endpoint every 30s).
  - Cloud Run has its own startup probe. The `gcloud run deploy` command does not explicitly configure `--min-instances`, `--cpu-throttling`, or custom health check paths.
  - **Finding:** The Dockerfile `HEALTHCHECK` is ignored by Cloud Run (Cloud Run uses its own health probe mechanisms, not Docker HEALTHCHECK). The health check in the Dockerfile only applies to local Docker/Docker Compose usage. Cloud Run will use its default startup probe (TCP port check) unless configured otherwise.
  - **Recommendation:** Configure Cloud Run startup and liveness probes via `gcloud run deploy` flags or in a `service.yaml`.

- [x] **PASS** -- Rollback capability.
  - Cloud Run maintains previous revisions. Rollback can be performed via `gcloud run services update-traffic` to redirect traffic to a previous revision.
  - Docker images are tagged with both `${{ github.sha }}` and `latest` (`deploy.yml:46-47`), so any previous image can be redeployed by SHA.

- [ ] **FAIL** -- Deployment notifications.
  - No Slack, email, or other notification mechanism is configured in `deploy.yml`.
  - Deployments (both successful and failed) produce no alerts outside of GitHub Actions logs.
  - **Recommendation:** Add a notification step (e.g., Slack webhook, GitHub status) at the end of the deploy workflow.

### 7. Branch Protection

- [ ] **FAIL** -- Master branch protection status unknown / likely not configured.
  - The repository has an `auto-commit.sh` script (tracked in git at root) that runs `git add -A && git commit && git push` in a loop every 30 seconds. This script would fail if branch protection with required PRs or status checks were enabled.
  - The git log shows the branch is `master` and the repo is ahead of origin by 1 commit, suggesting direct pushes to master are possible.
  - **Strong indication:** Branch protection is NOT enabled on `master`.

- [ ] **FAIL** -- Require PR reviews.
  - No evidence of branch protection requiring PR reviews. The `auto-commit.sh` script is designed to push directly to master. Multiple `claude/**` branches exist on the remote, but the main workflow triggers on direct push to `master`.

- [~] **PARTIAL** -- Require status checks to pass.
  - `deploy.yml` triggers on `push` to `master/main` but does NOT depend on CI passing. The `deploy-backend` and `deploy-frontend` jobs have no `needs: [ci]` or similar dependency.
  - `ci.yml` runs on push to `main/master/develop` and on PRs, but its results are not gating deployment.
  - **Finding:** Broken code can be deployed to production. If a push to master breaks tests in `ci.yml`, `deploy.yml` will still deploy independently since they are separate workflows with no dependency relationship.
  - **Recommendation:** Either (a) add `needs: ci` to deploy jobs using `workflow_call`, or (b) configure branch protection to require the CI workflow to pass before merging/pushing.

- [ ] **FAIL** -- No force push protection to master.
  - Without branch protection enabled (see above), force pushes to master are not prevented.
  - The `auto-commit.sh` script uses `git push` (not `--force`), but there is no repository-level protection against it.

### 8. Service Account Permissions

- [~] **PARTIAL** -- Service account permissions cannot be fully verified from code alone.
  - The workflow uses `${{ secrets.GCP_SA_KEY }}` for a service account that performs:
    1. Docker authentication to Artifact Registry (`gcloud auth configure-docker`)
    2. Docker image push to Artifact Registry
    3. Cloud Run deployment (`gcloud run deploy`)
    4. GCS operations (`gsutil cp`, `gsutil setmeta`)
  - **Minimum required roles based on workflow operations:**

- [~] **PARTIAL** -- `roles/artifactregistry.writer` - push images.
  - Required for `docker push` to Artifact Registry. Cannot verify actual IAM bindings from code, but the workflow would fail without this role.

- [~] **PARTIAL** -- `roles/run.admin` - deploy to Cloud Run.
  - Required for `gcloud run deploy`. The `deploy.yml` also reads service descriptions (`gcloud run services describe`), which requires `roles/run.viewer` at minimum. `roles/run.admin` covers both.

- [~] **PARTIAL** -- `roles/cloudbuild.builds.builder` - run builds.
  - NOT required for this workflow. The Docker build happens locally on the GitHub runner (`docker build`), not via Cloud Build. This role is not needed.

- [~] **PARTIAL** -- No excessive permissions (no `roles/owner`).
  - Cannot verify from code. The service account JSON key (`GCP_SA_KEY`) could have any role bindings.
  - **Recommendation:** Audit the service account's IAM bindings in GCP Console. The account needs: `roles/artifactregistry.writer`, `roles/run.admin`, `roles/storage.objectAdmin` (for GCS frontend bucket), and `roles/iam.serviceAccountUser` (for Cloud Run to act as). No broader roles should be assigned.

### 9. Frontend Deployment

- [x] **PASS** -- Frontend built with Vite (production mode).
  - `deploy.yml:98`: `run: npm run build` which runs `vite build` per `package.json:8`.
  - Vite defaults to production mode for `vite build`.

- [x] **PASS** -- Built assets uploaded to GCS bucket.
  - `deploy.yml:103`: `gsutil -m cp -r dist/* gs://${{ env.FRONTEND_BUCKET }}/`
  - All built assets from `dist/` are copied to the `ownmyhealth-frontend` bucket.

- [~] **PARTIAL** -- `index.html` has `Cache-Control: no-cache`.
  - `deploy.yml:104`: `gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" gs://${{ env.FRONTEND_BUCKET }}/index.html`
  - The `index.html` has proper no-cache headers. However, the `Cache-Control` value includes spaces in the comma-separated directives which is technically valid per HTTP spec but some CDNs may handle inconsistently.
  - **PASS** overall -- `index.html` will not be cached, ensuring users always get the latest version.

- [ ] **FAIL** -- Static assets do NOT have long cache headers (fingerprinted filenames).
  - Vite generates fingerprinted filenames by default (e.g., `assets/index-abc123.js`).
  - However, `deploy.yml` does not set cache headers on static assets. The `gsutil setmeta` command only targets `index.html`.
  - **Finding:** JS, CSS, and other hashed assets in `dist/assets/` are uploaded without cache headers. GCS will serve them with default cache behavior, missing an opportunity for optimal caching.
  - **Recommendation:** Add `gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" "gs://${{ env.FRONTEND_BUCKET }}/assets/**"` after the upload step.

- [x] **PASS** -- No source maps in production build.
  - `vite.config.ts` does not set `build.sourcemap`. Vite defaults to `false` for production builds.
  - No `.map` files will be present in the frontend `dist/` directory.

- [x] **PASS** -- No `.env` values embedded in build beyond `VITE_*` prefixed vars.
  - `deploy.yml:101`: `VITE_API_URL: https://api.ownmyhealth.io/api/v1` -- Only `VITE_API_URL` is set as a build-time environment variable.
  - `.env.example` shows only `VITE_API_URL`, `VITE_DEBUG`, and `VITE_DEMO_MODE` as frontend env vars, all with the `VITE_` prefix (Vite's security boundary).
  - No backend secrets (JWT keys, database URLs, API keys) can be embedded in the frontend build.

### 10. CI Pipeline (`ci.yml`)

- [x] **PASS** -- Runs on push to main/master/develop and PRs.
  - `ci.yml:4-8`: Triggers on `push` to `main`, `master`, `develop`, and `claude/**` branches, plus `pull_request` to `main`, `master`, `develop`.
  - Also supports `workflow_call` for reuse from other workflows.

- [~] **PARTIAL** -- Frontend: ESLint -> Vitest -> Vite build.
  - `ci.yml:frontend` job runs: `npm install` -> `npm run lint` -> `npm run test` -> `npm run build`.
  - This matches the expected pipeline (lint -> test -> build).
  - **Issue:** Uses `npm install` instead of `npm ci`.

- [~] **PARTIAL** -- Backend: ESLint -> Prisma generate -> Unit tests -> TypeScript build.
  - `ci.yml:backend` job runs: `npm install` -> `npm run lint` -> `npx prisma generate` -> `npm run test:unit -- --passWithNoTests` -> `npm run build`.
  - This matches the expected pipeline.
  - **Issues:**
    1. Uses `npm install` instead of `npm ci`.
    2. `--passWithNoTests` flag means the CI will pass even if there are no unit tests. This is acceptable during development but should be removed once tests exist.
    3. Uses a dummy `DATABASE_URL` for Prisma generate, which is correct (generation only, no connection).

- [~] **PARTIAL** -- Security: `npm audit` for both frontend and backend.
  - `ci.yml:security` job runs `npm audit --audit-level=high` for both frontend and backend.
  - However, `continue-on-error: true` is set on both audit steps, meaning high-severity vulnerabilities will NOT fail the build.
  - **Finding:** Security audit results are informational only. Known high-severity vulnerabilities in dependencies will not block deployment.
  - **Recommendation:** Remove `continue-on-error: true` or change it to `continue-on-error: false` once dependency vulnerabilities are resolved.

- [x] **PASS** -- Uses Node 20 LTS.
  - `ci.yml:11`: `NODE_VERSION: '20'` used across all jobs via `${{ env.NODE_VERSION }}`.

- [x] **PASS** -- Artifacts uploaded with retention limits.
  - `ci.yml:frontend` and `ci.yml:backend` both upload artifacts with `retention-days: 7`.

---

## Additional Findings

### CRITICAL: Deploy Workflow Has No CI Gate

**Severity: HIGH**

`deploy.yml` and `ci.yml` are independent workflows that both trigger on push to `master`. There is no mechanism ensuring CI passes before deployment proceeds. A push to master that breaks tests will still result in a production deployment.

**File:** `.github/workflows/deploy.yml` (entire workflow)
**Recommendation:** Either:
1. Make `deploy.yml` depend on CI by using `workflow_call` or `workflow_run` trigger with a completion requirement.
2. Enable branch protection requiring the CI workflow to pass.

### HIGH: `auto-commit.sh` Bypasses All Safety Controls

**Severity: HIGH**

**File:** `auto-commit.sh` (tracked in git, 30 lines)

This script runs `git add -A && git commit && git push` every 30 seconds in a loop. Security implications:
1. **Bypasses code review:** Changes are pushed directly to master without PR review.
2. **May commit secrets:** `git add -A` stages ALL files, including any `.env` files or key files that may have been accidentally created outside of `.gitignore` patterns.
3. **Triggers deployment:** Each push to master triggers `deploy.yml`, meaning untested code is deployed to production automatically.
4. **No verification:** No lint, test, or security checks before commit/push.

**Recommendation:** Remove `auto-commit.sh` from the repository or restrict its use to non-master branches only.

### MEDIUM: Backend Source Maps in Production Image

**Severity: MEDIUM**

**File:** `backend/tsconfig.json:16` -- `"sourceMap": true`
**File:** `backend/Dockerfile:40` -- `COPY --from=builder /app/dist ./dist`

TypeScript source maps (`.js.map` files) are compiled into `dist/` and copied into the production Docker image. An attacker with container access could reconstruct the original TypeScript source code, understanding business logic, encryption implementations, and security middleware.

### MEDIUM: Dummy DATABASE_URL Persists in Docker Image

**Severity: MEDIUM**

**File:** `backend/Dockerfile:37` -- `ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"`

The `ENV` instruction in the production stage persists in the final image's metadata. While this is a dummy value and is overridden at runtime by Cloud Run's environment variables, it adds unnecessary information to the image. Use `ARG` instead.

### LOW: Frontend Deployment Deletes All Files Before Upload

**Severity: LOW**

**File:** `.github/workflows/deploy.yml:102` -- `gsutil -m rm -r gs://${{ env.FRONTEND_BUCKET }}/** || true`

The deployment first deletes all files from the GCS bucket, then uploads new ones. During the window between deletion and upload completion, the frontend will be unavailable (404 errors). This could be seconds to minutes depending on the number of files.

**Recommendation:** Use `gsutil rsync` instead of delete-and-upload for zero-downtime frontend deployments.

### LOW: `deploy.yml` Frontend and Backend Deploy in Parallel Without Coordination

**Severity: LOW**

`deploy-backend` and `deploy-frontend` run as parallel jobs with no dependency. If the backend API has breaking changes (new endpoints, changed response format), the frontend may be deployed before the backend, or vice versa, causing a brief period of incompatibility.

---

## Summary Table

| # | Category | Result | Critical Issues |
|---|----------|--------|-----------------|
| 1 | Workflow Security | [~] PARTIAL | Missing `permissions` block, no `add-mask` |
| 2 | Secret Handling | [~] PARTIAL | No explicit log masking, GCP_SA_KEY handled correctly |
| 3 | Dockerfile Security | [x] PASS | Multi-stage, non-root, pinned base image (minor: dummy ENV persists) |
| 4 | .dockerignore Coverage | [~] PARTIAL | Missing key file patterns (*.pem, *-key.json) |
| 5 | Build Process | [~] PARTIAL | `npm install` in CI (should be `npm ci`), source maps in backend image |
| 6 | Deployment Process | [~] PARTIAL | No notifications, health checks not configured for Cloud Run |
| 7 | Branch Protection | [ ] FAIL | No branch protection, `auto-commit.sh` pushes directly to master |
| 8 | Service Account Permissions | [~] PARTIAL | Cannot verify IAM bindings from code alone |
| 9 | Frontend Deployment | [~] PARTIAL | No cache headers on static assets, destructive deploy strategy |
| 10 | CI Pipeline | [~] PARTIAL | `npm install` vs `npm ci`, security audit is non-blocking |

---

## Prioritized Remediation Plan

### Immediate (Before Next Production Deploy)

1. **Enable branch protection** on `master` with required status checks (CI must pass)
2. **Remove or restrict `auto-commit.sh`** -- This script is a major security risk
3. **Add `permissions:` blocks** to both workflow files to minimize token scope
4. **Make deploy.yml depend on CI** -- Add `needs:` clause or use `workflow_run` trigger

### Short-Term (Within 1 Week)

5. **Change `npm install` to `npm ci`** in `ci.yml` (both frontend and backend jobs)
6. **Set `sourceMap: false`** in `backend/tsconfig.json` for production builds (or remove `.map` files in Dockerfile)
7. **Change `ENV` to `ARG`** for `DATABASE_URL` in `backend/Dockerfile` production stage
8. **Add key file patterns** to `backend/.dockerignore` (`*-key.json`, `*.pem`, `*.key`)
9. **Remove `continue-on-error: true`** from security audit steps in `ci.yml`

### Medium-Term (Within 1 Month)

10. **Add deployment notifications** (Slack/email webhook on deploy success/failure)
11. **Configure Cloud Run health check probes** explicitly via deploy flags
12. **Add cache headers for static assets** in GCS frontend deployment
13. **Switch to `gsutil rsync`** for zero-downtime frontend deployments
14. **Audit GCP service account IAM bindings** -- ensure minimum necessary roles
15. **Pin Docker base images to specific digests** for full reproducibility
