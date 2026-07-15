# CI/CD Security Review — 2026-06-16

Scope: the four GitHub Actions workflows (`ci.yml`, `deploy.yml`, `deploy-staging.yml`, `maintenance.yml`), `backend/Dockerfile`, root + backend `.dockerignore`, `.gitleaks.toml`, and `scripts/check-rls-wrappers.sh`, at HEAD `fb2cd32`. Reviewed against `prompts/12-cicd-security.md` and `prompts/_review-protocol.md`. No code was modified — findings only.

The CI/CD pipeline is in strong shape: SHA-pinned actions, least-privilege `GITHUB_TOKEN`, digest-pinned multi-stage non-root Dockerfile, migrations decoupled from container boot, a CI-gated canary deploy with explicit-revision promotion, a NOBYPASSRLS RLS regression gate, and a gitleaks secret scan. The findings below are residual hardening gaps and one prompt/CI-config drift — no Critical or High.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 5 |
| Info | 2 |

## Findings

### F-1 — gitleaks binary downloaded over the network with no integrity check — **Medium**
- **Location:** `.github/workflows/ci.yml:124-127`
- **Observation:** The `security` job fetches the gitleaks release tarball with `curl -sSL` from `github.com/.../releases/download/...` and pipes it straight into `tar -xz` with no SHA-256 / checksum verification. The version string is pinned (`GL_VERSION=8.21.2`), but the *bytes* are not — the secret-scanning gate itself is bootstrapped from an unverified third-party binary fetched at run time.
- **Impact:** If the gitleaks release asset (or the GitHub release CDN path / a future redirect) is tampered with or replaced, CI silently runs an attacker-controlled binary with read access to the entire checked-out tree (including `.env*.example`, all source, and anything else in the workspace) and decides whether the secret-scan "passes." A compromised scanner could exfiltrate the workspace or rubber-stamp committed secrets. This is the one supply-chain link in the pipeline that the otherwise-thorough SHA-pinning discipline (F-30) does not cover: actions are SHA-pinned, the base image is digest-pinned, but this binary is tag-pinned only.
- **Fix:** Pin the artifact by checksum. After the `curl` download, verify against a hardcoded `sha256sum` for `gitleaks_8.21.2_linux_x64.tar.gz` (gitleaks publishes a `*_checksums.txt` per release) before extracting/executing — e.g. `echo "<sha256>  gitleaks.tar.gz" | sha256sum -c -`. Alternatively switch to the official SHA-pinned `gitleaks/gitleaks-action@<sha>`.
- **Evidence:**
  ```yaml
  GL_VERSION=8.21.2
  curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v${GL_VERSION}/gitleaks_${GL_VERSION}_linux_x64.tar.gz" | tar -xz gitleaks
  ./gitleaks detect --no-git --source . --config .gitleaks.toml --redact --verbose
  ```

### F-2 — `maintenance.yml` passes the unvalidated `only_user` input into Cloud Run job `--args` — **Low**
- **Location:** `.github/workflows/maintenance.yml:35-39, 76, 119`
- **Observation:** The `only_user` `workflow_dispatch` input is a free-form string. It is correctly bound through an `env:` mapping (`ONLY_USER: ${{ inputs.only_user }}`, line 76) rather than expanded directly in the `run` body — so classic GitHub-Actions script injection (back-ticks / `$(...)` breaking out of the shell) is *not* possible here. However, the value is then concatenated unvalidated into the comma-separated args string (`ARGS="$ARGS,--user,$ONLY_USER"`, line 119) which becomes `gcloud run jobs deploy ... --args "$ARGS"`. A value containing a comma (e.g. `<uuid>,--apply`) would smuggle an extra positional flag into the maintenance script — turning a dry-run into an apply against production PHI, or injecting other flags the script parses.
- **Impact:** Limited blast radius: `workflow_dispatch` is callable only by users with repo write/Actions permission (trusted maintainers), so this is a footgun / privilege-confused-deputy concern rather than an external attack path. The worst case is a maintainer accidentally (or a compromised maintainer deliberately) flipping dry-run to apply, or scoping a run wrong, via a crafted "user UUID."
- **Fix:** Validate `only_user` is a bare UUID before use, e.g. early in the step: `if [ -n "$ONLY_USER" ] && ! echo "$ONLY_USER" | grep -Eq '^[0-9a-fA-F-]{36}$'; then echo "invalid user id" >&2; exit 1; fi`. The `apply`/`task` inputs are already constrained (boolean + `choice` enum + `case` allowlist), so only `only_user` needs the guard.
- **Evidence:**
  ```bash
  ONLY_USER: ${{ inputs.only_user }}
  ...
  if [ -n "$ONLY_USER" ];  then ARGS="$ARGS,--user,$ONLY_USER"; fi
  ```

### F-3 — `apk upgrade` floats production-image package versions (non-reproducible build) — **Low**
- **Location:** `backend/Dockerfile:56`
- **Observation:** The production stage runs `RUN apk update && apk upgrade && rm -rf /var/cache/apk/*`. This is a deliberate CVE-patching choice (the checklist explicitly wants it), but it undoes some of the reproducibility the digest pin buys: two builds of the same git commit on different days can install different Alpine package versions, and a bad upstream Alpine package would be pulled silently.
- **Impact:** Low — the tradeoff (patch base-image CVEs vs. perfectly reproducible images) generally favors patching for a HIPAA backend, and the rest of the supply chain (npm via lockfile, base image via digest) is pinned. The residual risk is a non-deterministic image and a (small) window where a compromised Alpine mirror could inject a package. Noting it so the tradeoff is a conscious one.
- **Fix:** Acceptable as-is for the security/freshness tradeoff. If full reproducibility is later desired, bump the base-image digest deliberately (Renovate already tracks it) and drop the floating `apk upgrade`, relying on the newer base digest for patches.
- **Evidence:**
  ```dockerfile
  RUN apk update && apk upgrade && rm -rf /var/cache/apk/*
  ```

### F-4 — CI `frontend` job builds the SPA with the wrong `VITE_API_URL` (apex, not `api.` host) — **Low (prompt/CI drift)**
- **Location:** `.github/workflows/ci.yml:48-49` vs `.github/workflows/deploy.yml:329-330`
- **Observation:** The CI `frontend` job builds with `VITE_API_URL: https://ownmyhealth.io/api/v1` (the apex domain), while the production `deploy-frontend` job builds with `VITE_API_URL: https://api.ownmyhealth.io/api/v1` (the `api.` subdomain). The two differ. The CI build's `dist/` is uploaded only as a 7-day artifact (`frontend-dist`); `deploy-frontend` does its own fresh `npm run build`, so the mis-targeted CI artifact is **not** what ships to prod.
- **Impact:** No production exposure (the bad URL never reaches users). But it weakens CI as a representative build: the artifact that "passes CI" points at a different API origin than production, so any apex-vs-subdomain CORS/baseURL regression would not be caught by CI. It also conflicts with the prompt's checklist item #9 which states CI/prod both build against the API origin; the prompt itself uses the `api.` host (`prompts/12-cicd-security.md:121`).
- **Fix:** Set `VITE_API_URL: https://api.ownmyhealth.io/api/v1` in `ci.yml:49` to match the production deploy, so the CI artifact and the shipped build target the same origin.
- **Evidence:**
  ```yaml
  # ci.yml
  - name: Build
    run: npm run build
    env:
      VITE_API_URL: https://ownmyhealth.io/api/v1
  ```
  ```yaml
  # deploy.yml
  - name: Build frontend
    run: npm run build
    env:
      VITE_API_URL: https://api.ownmyhealth.io/api/v1
  ```

### F-5 — Long-lived JSON service-account key instead of Workload Identity Federation — **Low**
- **Location:** `.github/workflows/deploy.yml:79`, `:259`, `:310`; `deploy-staging.yml:50`, `:112`; `maintenance.yml:64`
- **Observation:** All GCP authentication uses a single static JSON key, `secrets.GCP_SA_KEY`, passed to the SHA-pinned `google-github-actions/auth` action via `credentials_json`. The workflows already document this and the migration path (the headers note "migrating to Workload Identity Federation would replace the long-lived SA key with short-lived OIDC tokens"). The key is passed only to the pinned auth action and is never echoed.
- **Impact:** A long-lived key is a standing credential: if it leaks (CI log slip, secret-store compromise, fork PR with a misconfigured trigger) it grants whatever roles the SA holds — which includes Cloud Run deploy, Artifact Registry push, and GCS write to the frontend bucket — until manually rotated. Keyless WIF (short-lived OIDC tokens scoped per repo/ref) removes the standing credential entirely. Low because handling is otherwise correct and the migration is acknowledged as infra-tracked.
- **Fix:** Migrate to Workload Identity Federation: configure a WIF pool + provider bound to this repo, add `permissions: id-token: write` to the deploy/staging/maintenance workflows, and switch `auth` to `workload_identity_provider` + `service_account` instead of `credentials_json`. Then delete the `GCP_SA_KEY` secret.
- **Evidence:**
  ```yaml
  - name: Google Auth
    uses: google-github-actions/auth@c200f3691d83b41bf9bbd8638997a462592937ed # v2.1.13
    with:
      credentials_json: ${{ secrets.GCP_SA_KEY }}
  ```

### F-6 — `deploy-staging.yml` has no migration step and runs straight to 100% traffic — **Low**
- **Location:** `.github/workflows/deploy-staging.yml:21-31, 75-103`
- **Observation:** Staging deploys directly to 100% traffic with a **non-fatal** health probe (line 102: `WARN ... Non-fatal`), and there is **no** migration step — the workflow header explains staging Cloud Run / Cloud SQL / `DATABASE_URL` secret do not yet exist (verified via gcloud, per the comment). So a `staging` push that builds will go live regardless of whether the app actually starts (the probe only warns), and the schema is whatever the (nonexistent) staging DB has.
- **Impact:** Low and intentional ("staging is the smoke test", documented), but worth flagging: there is no automated rollback safety net on staging, the health gate cannot fail the deploy, and once a real staging DB is provisioned the missing migrate step would cause schema drift / broken staging until someone copies prod's migrate step over. The risk to *production* is nil (separate service/bucket/project resources).
- **Fix:** When staging infra is provisioned, port `deploy.yml`'s "Run database migrations" Cloud Run job step into this workflow with staging's own job name / Cloud SQL instance / secret (the header already says to). Consider making the staging health probe fatal once there is a previous revision to roll back to.
- **Evidence:**
  ```yaml
  # This workflow has NO migration step yet, deliberately ...
  echo "WARN: staging health probe never returned 200. The revision is live; investigate if retries persist."
  # Non-fatal — staging has no traffic-split safety net to roll back to.
  ```

### F-7 — No `CODEOWNERS` / branch-protection-as-code in the repo (not verifiable from code) — **Info**
- **Location:** `.github/` (no `CODEOWNERS`; branch protection is a GitHub server-side setting)
- **Observation:** Checklist section 7 (Branch Protection: master protected, require PR reviews, require status checks, no force-push) cannot be verified from repository files — these are GitHub repo settings, not committed config, and there is no `CODEOWNERS` file to require reviews on the CI/CD or PHI paths. The deploy pipeline *is* gated on CI in-workflow (`deploy.yml:57-58, 65-66`), but that gate only protects `push`-triggered deploys; whether a non-passing commit can land on `master` at all depends on branch protection requiring the `CI` checks, which is invisible here.
- **Impact:** None directly; informational. The in-workflow `needs: ci` gate is good defense-in-depth, but without branch protection requiring the `frontend`/`backend`/`security`/`rls` checks + PR review + no-force-push, a privileged user could push directly to `master` and the deploy gate is the only backstop.
- **Fix:** Out of band: confirm in GitHub settings that `master`/`main` require the four CI checks (`Frontend CI`, `Backend CI`, `Security Audit`, `RLS Regression (NOBYPASSRLS)`) and PR review, and disallow force-push. Optionally add a `CODEOWNERS` requiring review on `.github/workflows/**`, `backend/Dockerfile`, and `backend/prisma/**`.

### F-8 — Service-account IAM roles not verifiable from the repository — **Info**
- **Location:** Checklist section 8 (`secrets.GCP_SA_KEY` role bindings live in GCP IAM, not in the repo)
- **Observation:** The required-roles checklist (artifactregistry.writer, run.admin, iam.serviceAccountUser, scoped storage admin, and *no* owner/editor) cannot be confirmed from code — IAM bindings are GCP-side. The workflows do exercise exactly those capabilities (Artifact Registry push, Cloud Run deploy/jobs/traffic, `gsutil rsync`/`setmeta`, and `--service-account` impersonation of the runtime SA), so the *needed* permission set is consistent with least privilege.
- **Impact:** None directly; informational — flagged so the IAM review happens out of band rather than being assumed "passed."
- **Fix:** Out of band: run `gcloud projects get-iam-policy ownmyhealth-prod` and confirm the deploy SA holds only the four scoped roles and neither `roles/owner` nor `roles/editor`.

## Checks passed

### Workflow Security
- [x] Specific action versions, not `@latest`/`@master` — all `uses:` are full-SHA pinned with `# vN.N.N` comments (`ci.yml:30,33,52,69,72,99,112,115,191,194`; `deploy.yml:74,77,83,257,263,305,308,314,319`; `deploy-staging.yml:45,48,54,109,112,118,123`; `maintenance.yml:62,68`).
- [x] Third-party actions SHA-pinned (F-30 complete) — checkout `34e1148…`, setup-node `49933ea…`, auth `c200f36…`, setup-gcloud `e427ad8…`, upload-artifact `ea165f8…`; header documents the pins at `deploy.yml:3-11`. No `TODO(supply-chain)` present.
- [x] Dependabot keeps actions current with reviewable diffs — `.github/dependabot.yml:17-20` tracks the `github-actions` ecosystem (monthly) plus npm root/backend (weekly).
- [x] Secrets accessed via `${{ secrets.* }}` only — the sole secret is `secrets.GCP_SA_KEY` (`deploy.yml:79,259,310`; `deploy-staging.yml:50,112`; `maintenance.yml:64`).
- [x] No secrets echoed to logs — confirmed by reading every `echo`/`run` block; the only echoed values are image SHAs, revision names, URLs, and counts. The key is passed to `auth` via `credentials_json`, never printed.
- [x] Permissions minimized — every workflow declares top-level `permissions: contents: read` (`ci.yml:14-15`, `deploy.yml:25-26`, `deploy-staging.yml:12-13`, `maintenance.yml:41-42`) and the reusable `ci` job re-pins it (`deploy.yml:59-60`). No `id-token: write`, no `packages:`/`contents: write`, no `pull_request_target`, no `secrets: inherit` anywhere.

### Secret Handling
- [x] `secrets.GCP_SA_KEY` passed only to the SHA-pinned auth action via `credentials_json`, never echoed — `deploy.yml:77-79` etc.
- [x] gitleaks secret-scan runs in CI `security` job (`--no-git --source . --config .gitleaks.toml --redact --verbose`) — `ci.yml:123-127`. (Bootstrap integrity gap tracked as F-1.)
- [x] The `rls` job `PHI_ENCRYPTION_KEY` is an inline test-only dummy, never used on real PHI — `ci.yml:184-187`; the same constant is allowlisted in `.gitleaks.toml:31` so it never trips the scanner.
- [x] gitleaks allowlist scoped to genuine placeholders/fixtures — `.gitleaks.toml:14-32` allowlists `.env*.example` (the templates exist: `.env.example`, `.env.production.example`, `backend/.env.example`, `backend/.env.staging.example`, `backend/.env.production.example`), `*.test.ts`, test infra, `e2e/`, `New Project Documents/`, plus `CHANGE_ME*` and the dummy PHI key.

### Dockerfile Security (`backend/Dockerfile`)
- [x] Trusted base `node:22-alpine` (M15, bumped off EOL Node 20) — `Dockerfile:11-15,37`.
- [x] Base image digest-pinned in BOTH stages and in sync — identical `@sha256:9385cd9f…` at `Dockerfile:15` (builder) and `:37` (production).
- [x] No real secrets in Dockerfile — only the dummy `ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"` used so `prisma generate` runs offline (`Dockerfile:30,65`).
- [x] No secrets in build args — there are no `ARG` declarations in the file.
- [x] Multi-stage build (`builder` → `production`) — `Dockerfile:15,37,68-69`.
- [x] Non-root user — `addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001` then `USER nodejs` (`Dockerfile:78-79`).
- [x] `apk update && apk upgrade` patches base CVEs in the production stage — `Dockerfile:56` (reproducibility tradeoff noted as F-3).
- [x] `HEALTHCHECK` defined (wget `/health`) — `Dockerfile:83-84`.
- [x] Header names the correct target ("GCP Cloud Run deployment", no stale AWS ECS) — `Dockerfile:1-2`.
- [x] RT-H1 security tier baked in — `ENV NODE_ENV=production` + `ENV OMH_DEPLOY_ENFORCE_PROD=true` (`Dockerfile:53-54`); the boot hard-fail is real at `backend/src/config/index.ts:53-60` (throws if `OMH_DEPLOY_ENFORCE_PROD=true` and NODE_ENV resolves to the dev tier); deploy also sets `NODE_ENV=production` via `--update-env-vars` (`deploy.yml:190`).

### .dockerignore Coverage (backend file is the one that applies to the image)
- [x] `.env`, `.env.local`, `.env.*.local` excluded — `backend/.dockerignore:10-12` (and root `.dockerignore:10-12`).
- [x] `.git`/`.gitignore` excluded — `backend/.dockerignore:21-22`.
- [x] `node_modules` excluded — `backend/.dockerignore:2`.
- [x] Test files excluded — `**/__tests__`, `**/*.test.ts`, `**/*.spec.ts` at `backend/.dockerignore:25-27`.
- [x] Secret/key files excluded — backend file also drops `cookies.txt` (`backend/.dockerignore:36`) and `.env*` above.
- [x] `dist`/`coverage` excluded (rebuilt in container) — `backend/.dockerignore:6-7`.

### Build Process
- [x] Dependencies from lockfile — `npm ci` in builder (`Dockerfile:24`), `npm ci --omit=dev` in production (`Dockerfile:59`).
- [x] No `npm install` without lockfile anywhere in the Dockerfile or workflows.
- [x] Source maps stripped from prod image (M-16) — `RUN find ./dist -name '*.map' -type f -delete` (`Dockerfile:76`).
- [x] No dev deps in production image — `--omit=dev` (`Dockerfile:59`).
- [x] `prisma generate` runs in both stages with the dummy URL — `Dockerfile:30-31` (builder), `:65-66` (production).

### Deployment Process (`deploy.yml`)
- [x] Whole deploy gated on CI — leading `ci` job invokes `ci.yml` via `uses:` (`deploy.yml:57-58`) and `build-and-stage` has `needs: ci` (`deploy.yml:65-66`).
- [x] Migrations run as a dedicated Cloud Run job, not at boot — `ownmyhealth-migrate` deployed+executed AFTER image push, BEFORE staging (`deploy.yml:106-161`); `--max-retries 0 --task-timeout 10m`; CMD is `["node", "dist/app.js"]` with no boot-migrate (`Dockerfile:93`).
- [x] Concurrency group serializes deploys around the shared migrate job — `concurrency: group: deploy-cloudrun-${{ github.ref }}`, `cancel-in-progress: false` (`deploy.yml:33-35`).
- [x] Canary, not all-at-once — new revision deployed `--no-traffic` with `--tag "staging-<sha>"` (`deploy.yml:183-191`).
- [x] Health check gates traffic — `smoke-test` probes the tagged `/api/v1/health` (6 retries, requires `"success":true`) before `promote` (`deploy.yml:216-242`); `promote` has `needs: [build-and-stage, smoke-test]` (`deploy.yml:253`).
- [x] Post-promote prod health probe after the 100% shift — `https://api.ownmyhealth.io/api/v1/health` ×3 (`deploy.yml:276-286`).
- [x] Deterministic rollback — traffic shifted via explicit `--to-revisions="$NEW_REV=100"`, not `--to-latest` (`deploy.yml:271-274`).
- [x] Image addressed by `${{ github.sha }}` only; `:latest` dropped (F-32) — build/push and deploy both use `:${{ github.sha }}` (`deploy.yml:99-104,168`); the only `latest` tokens left are the `DATABASE_URL:latest` secret version and `latestCreatedRevisionName`, not an image tag.
- [x] `--max-instances=3` kept (rate-limiter-store assumption) — `deploy.yml:189`, `deploy-staging.yml:88`.

### Frontend Deployment (`deploy-frontend`)
- [x] Built with Vite, prod `VITE_API_URL=https://api.ownmyhealth.io/api/v1` — `deploy.yml:327-330`; staging uses `npm run build -- --mode staging` (`deploy-staging.yml:133-134`).
- [x] Uploaded via `gsutil -m rsync -d -r dist/` (no rm/cp 404 window, F-31) — prod `deploy.yml:342`; staging now matches (M-15) `deploy-staging.yml:142`.
- [x] `index.html` gets `Cache-Control: no-cache, no-store, must-revalidate` via `setmeta` — `deploy.yml:343`, `deploy-staging.yml:143`.
- [x] `deploy-frontend` gated on `needs: [ci, promote]` (ships only after backend promotes) — `deploy.yml:300-301`.

### CI Pipeline (`ci.yml`)
- [x] Triggers on push to `main`/`master`/`develop`/`claude/**` and PRs to `main`/`master`/`develop`; `workflow_call`-able — `ci.yml:3-8`.
- [x] `frontend` job: `npm ci` → ESLint → Vitest → Vite build → upload `dist/` (7-day) — `ci.yml:37-56`.
- [x] `backend` job: `npm ci` → ESLint → `prisma generate` → `npm run test:ci` → `npm run build` → upload `backend/dist/` (7-day) — `ci.yml:76-103`; `test:ci` runs the full colocated suite excluding only `src/services/rls.test.ts` (`vitest.config.ci.ts:18-26`; script at `backend/package.json:14`).
- [x] `security` job: gitleaks → `npm audit --audit-level=high` (frontend + backend) → RLS wrapper guard — `ci.yml:123-149`.
- [x] `rls` job: `postgres:16` service, migrations applied as superuser, NOBYPASSRLS `omh_app` role provisioned from `prisma/rls-test-role.sql`, `npm run test:rls` — `ci.yml:155-213` (`test:rls` script at `backend/package.json:17`).
- [x] Node 22 Maintenance LTS single-sourced — `env.NODE_VERSION: '22'` used by every `setup-node` (`ci.yml:17-20`); deploy/staging frontend pin `'22'` to match (`deploy.yml:321`, `deploy-staging.yml:125`).
- [x] Artifacts uploaded with `retention-days: 7` — `ci.yml:56,103`.

### RLS Wrapper Guard (`scripts/check-rls-wrappers.sh`)
- [x] Fails CI on bare module-level `prisma.<model>.<verb>(` / raw-SQL / `$transaction` calls in controllers/services/routes/schedulers/middleware/utils — pattern + targets at `scripts/check-rls-wrappers.sh:26-59`; excludes `database.ts`, test files, `tx.`, and `// RLS-exempt` lines (`:39-41,61-75`); invoked from `ci.yml:149`.

## Unverifiable
- **Branch protection** (master protected, required reviews, required status checks, no force-push) — GitHub server-side settings, not in the repo; no `CODEOWNERS` file present. See F-7.
- **Service-account IAM roles** (artifactregistry.writer / run.admin / iam.serviceAccountUser / scoped storage, no owner/editor) — live in GCP IAM, not in the repo. The workflows exercise exactly those capabilities, consistent with least privilege, but the actual bindings can only be confirmed via `gcloud projects get-iam-policy`. See F-8.
- **GCS bucket ACLs** (`ownmyhealth-frontend`, `ownmyhealth-frontend-staging` access controls — checklist Q4) — GCS-side configuration, not in the repo.
- **Whether the `e2e-tests` job should be wired now** (checklist §10) — it remains intentionally commented out pending staging DB infra (`ci.yml:215-239`); this is a product/infra decision, not a code defect. The commented block references Node 22 but `postgres:15` (vs the `rls` job's `postgres:16`) — a cosmetic drift to fix when it is uncommented.
- **`secrets.GCP_SA_KEY` value itself** — cannot inspect a GitHub secret; verified only that it is referenced correctly and never echoed.

## Out of scope
- Application-layer security (auth/CSRF/RLS runtime behavior, PHI encryption correctness, AI-spend guards) — covered by the other security-review prompts (01–11, 26–32); this review is limited to the CI/CD surface in `prompts/12-cicd-security.md`.
- Dependency CVE triage / the `npm audit --audit-level=high` policy and its moderate-advisory carve-outs — covered by `prompts/13-dependency-health.md`. This review confirms the gate runs and at what level (`ci.yml:138-143`) but does not re-audit the dependency tree.
- The maintenance/migration *scripts'* internal correctness (`backend/src/maintenance/*.ts`, prisma migrations) — only the workflow that invokes them is reviewed here. The three entrypoints referenced by `maintenance.yml` were confirmed to exist (`consolidateBiomarkerSeries.ts`, `backfillGoalValues.ts`, `backfillUserFileNames.ts`).
