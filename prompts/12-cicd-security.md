---
tags:
  - security
  - infrastructure
  - high
type: prompt
priority: 2
updated: 2026-08-01
---

# CI/CD Security Review

> **Posture note (2026-08-01):** the **deploy** half of this prompt is **Dormant (launch checklist)**
> — GCP billing was disabled ~2026-07-12 and `deploy.yml` / `deploy-staging.yml` / `maintenance.yml`
> cannot reach a target (deploys fail at image push). The **CI** half (`ci.yml`,
> `secret-history-scan.yml`, Dockerfile hygiene, action pinning) is fully live and still gates every
> merge. Grade per `_review-protocol.md` §Current posture and read `OPEN_FINDINGS.md` first.

## Files to Review
There are exactly **five** workflows under `.github/workflows/`:
- `.github/workflows/ci.yml` (lint/test/build + security + RLS + **e2e** gates)
- `.github/workflows/secret-history-scan.yml` (**new 2026-07-11**, OMH-M01 — scheduled **full-history** gitleaks scan. The `ci.yml` scan only sees the working tree; this one sees the past. **Expect it red by design** while OF-01's committed GCP key remains reachable at `202f2dd` — it is that finding's regression guard. If it is green, establish *why*: history purged, or a `.gitleaks.toml` allowlist entry added?)
- `.github/workflows/deploy.yml` (production canary pipeline → Cloud Run + GCS, gated on `ci`, with a dedicated migrate job)
- `.github/workflows/deploy-staging.yml` (push to `staging` → staging Cloud Run + GCS)
- `.github/workflows/maintenance.yml` (manual `workflow_dispatch` that runs one-time data migrations — `consolidate-biomarkers`, `backfill-goal-values`, `backfill-userfile-filenames` — as the `ownmyhealth-maintenance` Cloud Run job, DRY-RUN by default, cloning the live service env + Secret Manager mounts; **security-relevant**: it touches prod PHI with the live `PHI_ENCRYPTION_KEY`, so review it like a deploy)
- `backend/Dockerfile` (the ONLY Dockerfile — there is no root/frontend `Dockerfile`; the frontend is a static Vite build deployed to GCS)
- `.dockerignore` and `backend/.dockerignore` (excluded files)
- `.gitleaks.toml` (secret-scan allowlist used by the `ci.yml` security job)
- `scripts/check-rls-wrappers.sh` (RLS wrapper guard invoked by the `ci.yml` security job)

## OwnMyHealth CI/CD Architecture
- **Platform**: GitHub Actions
- **CI Workflow**: `ci.yml` — **five live jobs**: `frontend`, `backend`, `security`, `rls`, and **`e2e`** (`ci.yml:24,59,106,155,221`). The e2e job was wired on 2026-07-11 (`919398a`, closing the long-standing TODO); a stale commented-out `e2e-tests` block still sits below it at `ci.yml:313+` and should be deleted. Also exposes `workflow_call` so `deploy.yml` can invoke it as a reusable workflow. Runs on push to `main`/`master`/`develop`/`claude/**` and PRs to `main`/`master`/`develop`.
- **History-scan Workflow**: `secret-history-scan.yml` — scheduled full-history gitleaks scan (OMH-M01), independent of `ci.yml`. Failing by design until OF-01 is resolved.
- **Deploy Workflow**: `deploy.yml` — a gated canary, NOT a single all-at-once deploy. Jobs: `ci` (invokes `ci.yml` as a reusable workflow — the ENTIRE deploy is gated on lint+test+build+gitleaks+audit+RLS; `deploy.yml:57-58`) → `build-and-stage` (`needs: ci`; Docker build → Artifact Registry → **runs DB migrations as the `ownmyhealth-migrate` Cloud Run job AFTER image push, BEFORE staging** → Cloud Run at **0% traffic** with a `staging-<sha>` tag) → `smoke-test` (probe tagged URL `/api/v1/health`) → `promote` (shift 100% via explicit `--to-revisions`, then post-promote prod health probe, then remove staging tag); `deploy-frontend` is gated on `needs: [ci, promote]` (ships only AFTER the backend promotes — it does NOT run in parallel; `deploy.yml:300-301`). A top-level `concurrency` group (`deploy-cloudrun-${{ github.ref }}`, `cancel-in-progress: false`; `deploy.yml:33-35`) serializes deploys so two pushes can't interleave around the shared migrate job.
- **Staging Workflow**: `deploy-staging.yml` — push to `staging`; builds + deploys straight to 100% traffic on `ownmyhealth-backend-staging` (no canary, no gated promote — "staging is the smoke test").
- **Maintenance Workflow**: `maintenance.yml` — manual `workflow_dispatch` only; runs the chosen one-time data migration as the `ownmyhealth-maintenance` Cloud Run job (same image the service is serving, cloning its env + Secret Manager mounts so re-encrypted PHI is decryptable by the live key). DRY-RUN unless `apply=true`.
- **Container Registry**: GCP Artifact Registry (`us-central1-docker.pkg.dev`, repository `ownmyhealth`)
- **Backend Deployment**: Cloud Run service `ownmyhealth-backend` (project `ownmyhealth-prod`, region `us-central1`, `--max-instances=3`)
- **Frontend Deployment**: GCS bucket `ownmyhealth-frontend` via `gsutil rsync -d -r` + `setmeta` no-cache on `index.html`
- **Trigger**: `deploy.yml` on push to `master`/`main` or `workflow_dispatch`; `deploy-staging.yml` on push to `staging` or `workflow_dispatch`

## Checklist

### 1. Workflow Security
- [ ] Uses specific action versions (not `@latest` or `@master`)
- [ ] Third-party actions pinned to full commit SHAs — **already done per F-30** (resolved 2026-06-01): `actions/checkout@34e1148…# v4.3.1`, `actions/setup-node@49933ea…# v4.4.0`, `google-github-actions/auth@c200f36…# v2.1.13`, `google-github-actions/setup-gcloud@e427ad8…# v2.2.1` (`deploy.yml:3-11` documents the pins; `deploy.yml:74,77,83,319`; `ci.yml:30,33,52`). There is NO `TODO(supply-chain)` — confirm Renovate/Dependabot still bumps them with a reviewable diff.
- [ ] Secrets accessed via `${{ secrets.* }}` only (the only secret used is `secrets.GCP_SA_KEY`)
- [ ] No secrets echoed to logs
- [ ] Permissions minimized — **every workflow now declares a top-level `permissions: contents: read`** least-privilege block (`deploy.yml:25-26`, `ci.yml:14-15`, `deploy-staging.yml:12-13`, `maintenance.yml:41-42`; `deploy.yml:59-60` also sets it on the reusable `ci` job). Confirm none re-broaden it (e.g. no stray `id-token: write` until WIF migration).

### 2. Secret Handling
- [ ] Secrets not printed in debug output
- [ ] Secrets masked in logs (`add-mask`)
- [ ] GCP service-account key (`secrets.GCP_SA_KEY`) passed only to the SHA-pinned `google-github-actions/auth` action via `credentials_json`, never echoed
- [ ] `ci.yml` security job runs gitleaks secret-scan (`--no-git --config .gitleaks.toml`) to block committed secrets
- [ ] No secrets in workflow file itself (the `PHI_ENCRYPTION_KEY` in the `rls` job is an inline test-only placeholder key, never used on real PHI — confirm it stays a dummy)

### 3. Dockerfile Security (`backend/Dockerfile`)
- [ ] Base image from trusted source (`node:22-alpine`) — **M15: bumped from `node:20-alpine` (Node 20 reached EOL Apr 2026) to `node:22-alpine` (Maintenance LTS)** (`backend/Dockerfile:11-15`)
- [ ] Base image **digest-pinned** (not just a mutable tag) — `FROM node:22-alpine@sha256:9385cd9f…` in BOTH the `builder` and `production` stages (`backend/Dockerfile:15,37`); confirm both digests stay in sync when bumped
- [ ] No secrets in Dockerfile (the `ENV DATABASE_URL=postgresql://dummy...` is a known dummy used only so `prisma generate` runs offline — confirm it's never a real URL)
- [ ] No secrets in build args
- [ ] Multi-stage build (`builder` → `production`, smaller attack surface) — present
- [ ] Non-root user in container (`addgroup nodejs` / `adduser nodejs` uid 1001, `USER nodejs`) — present
- [ ] `apk update && apk upgrade` runs in the production stage to patch base-image CVEs
- [ ] `HEALTHCHECK` defined (wget `/health`) — present
- [ ] Header comment correctly names the target — `backend/Dockerfile:1-2` already says "Production-ready Node.js container for GCP Cloud Run deployment" (the old "AWS ECS" mismatch is fixed; no action needed)
- [ ] **RT-H1 security-tier baked into the image**: `ENV NODE_ENV=production` + `ENV OMH_DEPLOY_ENFORCE_PROD=true` (`backend/Dockerfile:42-54`) so a deployed image hard-fails at boot (`config/index.ts`) if NODE_ENV resolves to the dev tier; `deploy.yml:176-190` also sets `NODE_ENV=production` via `--update-env-vars`

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
- [ ] Build artifacts don't contain source maps in production — **enforced (M-16)**: the production Docker stage runs `RUN find ./dist -name '*.map' -type f -delete` (`backend/Dockerfile:71-76`), not merely "to verify"
- [ ] No dev dependencies in production image (`--omit=dev` enforces this)
- [ ] `prisma generate` runs in both stages with the dummy `DATABASE_URL` (no live DB at build time)

### 6. Deployment Process (`deploy.yml`)
- [ ] **Whole deploy gated on CI**: leading `ci` job invokes `ci.yml` (`deploy.yml:57-58`) and `build-and-stage` has `needs: ci` (`deploy.yml:65-66`) — a commit that fails lint/test/build/gitleaks/audit/RLS is never built or shipped
- [ ] **Migrations run as a dedicated Cloud Run job, NOT at container boot**: `ownmyhealth-migrate` (env `MIGRATE_JOB`, `deploy.yml:43`) is deployed+executed in `build-and-stage` AFTER image push and BEFORE the revision is staged, via `gcloud run jobs deploy/execute --wait` running `npx prisma migrate deploy` (`--max-retries 0`, `--task-timeout 10m`; `deploy.yml:106-161`). The Dockerfile CMD is `["node", "dist/app.js"]` — the old `migrate && node` boot CMD is gone (`backend/Dockerfile:86-93`)
- [ ] Top-level `concurrency` group serializes deploys around the shared migrate job (`deploy.yml:33-35`, `cancel-in-progress: false`) so two pushes can't interleave image mutation of the migrate job
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
All workflows authenticate with a single secret, `secrets.GCP_SA_KEY` (a JSON key passed to the SHA-pinned `google-github-actions/auth` action). Verify minimum required roles on that SA:
- [ ] `roles/artifactregistry.writer` - push images
- [ ] `roles/run.admin` - deploy to Cloud Run + shift traffic
- [ ] `roles/iam.serviceAccountUser` - act as the Cloud Run runtime SA
- [ ] `roles/storage.admin` (or scoped object-admin on the frontend buckets) - `gsutil rsync`/`setmeta` for frontend deploy
- [ ] No excessive permissions (no `roles/owner`, no `roles/editor`)
- [ ] Consider migrating from a long-lived JSON key to Workload Identity Federation (keyless OIDC)

## GitHub Actions Best Practices
```yaml
# Best: full-SHA pin (this repo's standard, per F-30) — tamper-evident
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
- uses: google-github-actions/auth@c200f3691d83b41bf9bbd8638997a462592937ed # v2.1.13

# Weaker: mutable major-version tag (a tag can be force-pushed to a bad commit)
- uses: actions/checkout@v4

# Bad: unpinned
- uses: actions/checkout@master
- uses: some-action@latest
```

### 9. Frontend Deployment (`deploy-frontend` job)
- [ ] Frontend built with Vite (`npm run build`, `VITE_API_URL=https://api.ownmyhealth.io/api/v1`; staging uses `--mode staging`)
- [ ] Built assets uploaded to GCS bucket `ownmyhealth-frontend` via `gsutil -m rsync -d -r dist/` (prod) — no rm/cp 404 window (per inline F-31 note). `deploy-staging.yml` now ALSO uses `gsutil -m rsync -d -r dist/` against `ownmyhealth-frontend-staging` (M-15, matching prod F-31; `deploy-staging.yml:136-143` — the old `rm -r` + `cp -r` shape is gone).
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
- [ ] Uses Node 22 Maintenance LTS (env `NODE_VERSION: '22'`, single source for every `setup-node`; M15: Node 20 EOL Apr 2026 — `ci.yml:17-20`)
- [ ] `e2e` job (**live since 2026-07-11**, `ci.yml:221`): boots a real backend against `postgres`, seeds a standing e2e user (`npm run test:e2e:setup`), installs chromium, runs the full Playwright suite, uploads `playwright-report/`
- [ ] Artifacts uploaded with retention limits (`retention-days: 7`)
- [ ] **e2e job secret hygiene**: the job sets literal `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` values inline (`ci.yml:249-250`). Confirm they are obviously-fake CI-only strings, are never reused in any real environment, and are not shaped like the placeholders `config/index.ts` blocks. Same question for the `PHI_ENCRYPTION_KEY` the job supplies
- [ ] **e2e job rate-limit knobs**: the job deliberately raises limiter thresholds for the e2e-launched backend (`ci.yml:220`). Verify that relaxation is scoped to the CI process via env only — it must not be reachable by any deployed configuration
- [ ] `VITE_API_URL` is provided so the meta CSP admits the e2e backend origin (`94b9ccd`) — confirm this does not widen the CSP shipped in a real build
- [ ] Stale commented-out `e2e-tests` block (`ci.yml:313+`) removed now that the real `e2e` job exists — dead CI config invites resurrection of the wrong one

### 10b. Secret-History Scan (`secret-history-scan.yml`)
- [ ] Scans **full history**: `fetch-depth: 0` on checkout **and** no `--no-git` on the gitleaks
      invocation — the `ci.yml` job has both, which is exactly why it cannot see `202f2dd`
- [ ] Runs nightly (`cron: '17 7 * * *'`) + `workflow_dispatch`, deliberately **not** on push, so a
      correctly-failing history scan never blocks PR merges. Confirm that separation still holds
- [ ] Uses `.gitleaks.toml`; verify the "broader key ignore patterns" added in `8ec3989` are narrow
      enough to still catch a *new* service-account key, not just the known one
- [ ] **Supply chain**: the job `curl`s a gitleaks release tarball and pipes it to `tar` with a
      pinned version but **no checksum or signature verification**, then executes it. The
      `actions/checkout` step is SHA-pinned; this download is not. Is that gap accepted?
- [ ] Failure is visible to someone: a red *scheduled* run notifies nobody by default — check
      whether anything (branch protection, notification, dashboard) surfaces it, or whether the
      regression guard is silently red forever
- [ ] Cross-check OF-01 before filing anything here as new

## Questions to Ask
1. Are all third-party actions still SHA-pinned (F-30 — already complete, no open `TODO(supply-chain)`), and does Renovate/Dependabot keep them current with reviewable diffs?
2. Are secrets properly masked in logs? Is `secrets.GCP_SA_KEY` ever echoed?
3. Does `backend/Dockerfile` run as non-root (`USER nodejs`)?
4. Are the GCS buckets (`ownmyhealth-frontend`, `ownmyhealth-frontend-staging`) configured with proper access controls?
5. Are CI/CD service-account permissions minimally scoped (no owner/editor)? Should it move to keyless Workload Identity Federation?
6. Does the canary gate hold — can a deploy reach 100% prod traffic if `smoke-test` fails?
7. Does the `rls` job actually fail merges on RLS policy regressions (NOBYPASSRLS role enforced)?
8. Does `deploy-staging.yml` (straight-to-100%, non-fatal health probe) match the intended risk posture for the `staging` branch?
