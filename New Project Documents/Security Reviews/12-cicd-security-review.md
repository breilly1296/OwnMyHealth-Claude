# 12-cicd-security Review — 2026-06-01

Scope: GitHub Actions workflows (`ci.yml`, `deploy.yml`, `deploy-staging.yml`), `backend/Dockerfile`, root + `backend/.dockerignore`, `.gitleaks.toml`, `scripts/check-rls-wrappers.sh`, and the supporting CI plumbing (`backend/vitest.config.ci.ts`, `backend/prisma/rls-test-role.sql`, `.github/dependabot.yml`). Verified against the live repo at `C:/Users/breil/Projects/OwnMyHealth/`. `npm audit` run on both packages.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 5 |
| Info | 2 |

## Findings

### F-1 — `deploy-staging.yml` still builds and pushes a mutable `:latest` tag (prompt-stated drop is prod-only) — Medium
- **Location:** `.github/workflows/deploy-staging.yml:47-52`
- **Observation:** The staging build tags and pushes both `:${{ github.sha }}` and a mutable `:latest` to Artifact Registry. The deploy step itself references only `:${{ github.sha }}` (line 58), so `:latest` is pushed but never consumed by the staging deploy — it is dead weight that re-introduces the exact "two coexisting current-image pointers" hazard that `deploy.yml`'s F-32 note (deploy.yml:56-61) deliberately removed from prod.
- **Impact:** A future hand-rolled `gcloud run deploy ... :latest` or any external consumer pulling `:latest` from the `ownmyhealth` repo would silently get whatever the most recent staging push was, which may not match the SHA running in any environment. Mutable tags also widen the supply-chain surface (a force-pushed tag is tamper-invisible). Blast radius is staging, hence Medium not High.
- **Fix:** Remove the `IMAGE_LATEST` variable and both `-t "$IMAGE_LATEST"` / `docker push "$IMAGE_LATEST"` lines from the `Build and Push Docker Image` step so staging matches prod's SHA-only convention.
- **Evidence:**
  ```yaml
  IMAGE_LATEST="${IMAGE_BASE}:latest"
  docker build -t "$IMAGE_SHA" -t "$IMAGE_LATEST" .
  docker push "$IMAGE_SHA"
  docker push "$IMAGE_LATEST"
  ```

### F-2 — Backend production image ships source maps (`.js.map` / `.d.ts.map`) — Medium
- **Location:** `backend/tsconfig.json:14-16`, `backend/Dockerfile:40`
- **Observation:** `tsc` compiles with `"sourceMap": true` and `"declarationMap": true`, emitting `dist/**/*.js.map` (and `*.d.ts.map`) alongside the JS. The Dockerfile copies the entire build output wholesale (`COPY --from=builder /app/dist ./dist`) with no map-stripping step, so production maps ship inside the running container. The spec's Build-Process check #5 ("Build artifacts don't contain source maps in production") is therefore not met for the backend.
- **Impact:** Source maps reconstruct original TypeScript (variable names, comments, file paths, control flow) from the deployed JS. If a `.map` were ever served or extracted from the image, it hands an attacker a near-complete copy of the backend source, easing discovery of validation gaps, RLS edges, and encryption logic. The maps are not currently served over HTTP (Express serves no static `dist/` route), so this is defense-in-depth degradation, not a direct disclosure — Medium.
- **Fix:** Either set `"sourceMap": false` / `"declarationMap": false` for the production build, or add a strip step in the Dockerfile production stage after the copy, e.g. `RUN find ./dist -name '*.map' -delete`. Maps can be kept for non-prod via a separate tsconfig.
- **Evidence:**
  ```json
  "declarationMap": true,
  "sourceMap": true,
  ```
  ```dockerfile
  COPY --from=builder /app/dist ./dist
  ```

### F-3 — CI dependency audit gate is `--audit-level=high`, so live moderate-severity advisories pass — Medium
- **Location:** `.github/workflows/ci.yml:121-125`
- **Observation:** Both audit steps run `npm audit --audit-level=high`. Running the audit live today, the frontend reports 0 vulnerabilities but the backend reports **8 moderate** advisories — `uuid <11.1.1` (GHSA-w5hq-g745-h8pq, missing buffer bounds check) transitively via `@google-cloud/storage`/`gaxios`/`teeny-request`, plus the `@prisma/dev` → `@hono/node-server` dev-tool chain. None are High, so the gate is green and these ship un-flagged.
- **Impact:** A moderate-severity advisory in a PHI-handling dependency (`@google-cloud/storage` is the lab-report/SBC storage path) can sit in the production image indefinitely without CI surfacing it. The `uuid` bounds-check issue is only reachable with attacker-controlled `buf`, so exploitability is low here, but the gate's blind spot is structural. Mitigated by weekly Dependabot (`.github/dependabot.yml`), hence Medium.
- **Fix:** Lower the gate to `--audit-level=moderate` (and triage/allowlist known-unreachable advisories), or add `npm audit --audit-level=moderate || true` as a reporting-only step so moderates are at least visible in the run log.
- **Evidence:**
  ```yaml
  - name: Audit backend dependencies
    run: npm audit --audit-level=high
    working-directory: backend
  ```

### F-4 — No `permissions:` block in any workflow → default (broad) `GITHUB_TOKEN` scope — Low
- **Location:** `.github/workflows/ci.yml:1-12`, `.github/workflows/deploy.yml:15-26`, `.github/workflows/deploy-staging.yml:1-19`
- **Observation:** None of the three workflows declares a top-level or job-level `permissions:` block (confirmed: a `permissions:`-pattern grep over `.github/workflows` returns no matches). The `GITHUB_TOKEN` therefore runs at the repository default scope rather than least-privilege. The spec itself flags this as the current state.
- **Impact:** If any step is compromised (e.g. a poisoned third-party action — see F-5/F-6), the job token can perform more than the workflow needs (e.g. write to repo contents, packages, or PRs). These workflows only need `contents: read` (and the deploy ones authenticate to GCP out-of-band via `GCP_SA_KEY`, not the GitHub token).
- **Fix:** Add `permissions: { contents: read }` at the top of each workflow (or per job), elevating only where a step genuinely needs more.
- **Evidence:**
  ```yaml
  # ci.yml — no permissions: block anywhere
  env:
    NODE_VERSION: '20'
  jobs:
  ```

### F-5 — Third-party actions pinned to mutable major-version tags, not commit SHAs — Low
- **Location:** `.github/workflows/deploy.yml:38,41,47`, `.github/workflows/ci.yml:21,24,43`, `.github/workflows/deploy-staging.yml:26,29,35`
- **Observation:** All actions (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `google-github-actions/auth@v2`, `google-github-actions/setup-gcloud@v2`) are tag-pinned. Tags are mutable; a force-pushed release tag would be picked up silently on the next run. The `deploy.yml` header carries an explicit, well-reasoned `TODO(supply-chain)` to SHA-pin these (deploy.yml:3-13). Per the spec, the question is whether that TODO is *tracked*, not forgotten — it is documented inline and Dependabot watches `github-actions` monthly (`.github/dependabot.yml:17-20`), so it is tracked but still open.
- **Impact:** Supply-chain exposure: a compromised upstream action tag could exfiltrate `secrets.GCP_SA_KEY` (which holds Artifact Registry + Cloud Run + GCS write on the prod project). Low because no compromise is known and the TODO + Dependabot provide a managed path.
- **Fix:** SHA-pin each action (e.g. `actions/checkout@<40-char-sha> # v4.x`) from a trusted environment per the deploy.yml note; let Dependabot bump the pins with reviewable diffs. Close the `TODO(supply-chain)` once done.
- **Evidence:**
  ```yaml
  - name: Checkout
    uses: actions/checkout@v4
  - name: Google Auth
    uses: google-github-actions/auth@v2
  ```

### F-6 — Long-lived GCP JSON service-account key instead of keyless Workload Identity Federation — Low
- **Location:** `.github/workflows/deploy.yml:43,156,202`, `.github/workflows/deploy-staging.yml:31,93`
- **Observation:** Every GCP auth step consumes a single static JSON key, `secrets.GCP_SA_KEY`, via `credentials_json`. The key is correctly scoped to the auth action only and is never echoed (grep confirms `GCP_SA_KEY` appears only as `credentials_json:` values), but it is a long-lived credential that does not rotate automatically and grants prod Artifact Registry/Cloud Run/GCS access.
- **Impact:** A leaked or exfiltrated JSON key (e.g. via a compromised action, F-5) is valid until manually revoked and works from anywhere. WIF issues short-lived, repo-scoped, OIDC-federated tokens that cannot be replayed off-runner. Low because the secret is handled correctly today; this is a hardening upgrade.
- **Fix:** Migrate to `google-github-actions/auth@v2` with `workload_identity_provider` + `service_account` (keyless OIDC) and delete the static key. Requires the `id-token: write` permission, which dovetails with the F-4 fix.
- **Evidence:**
  ```yaml
  - name: Google Auth
    uses: google-github-actions/auth@v2
    with:
      credentials_json: ${{ secrets.GCP_SA_KEY }}
  ```

### F-7 — Backend base image not digest-pinned (`node:20-alpine` is a moving tag) — Low
- **Location:** `backend/Dockerfile:4,24`
- **Observation:** Both stages use `FROM node:20-alpine`, a floating tag that re-resolves on each build. The image is version-pinned (not `latest`) and the production stage runs `apk update && apk upgrade` to patch base CVEs (line 28), but the underlying digest can change between the staged build and a later prod rebuild, so two builds of the same commit SHA are not byte-reproducible.
- **Impact:** Non-determinism and a (small) supply-chain surface: a poisoned or regressed `node:20-alpine` push would be pulled silently. Low — `apk upgrade` mitigates known CVEs and the image is from the official Node library.
- **Fix:** Pin to a digest, e.g. `FROM node:20-alpine@sha256:<digest>`, and let Dependabot/Renovate bump it. The spec calls this out as a "consider" item.
- **Evidence:**
  ```dockerfile
  FROM node:20-alpine AS builder
  ...
  FROM node:20-alpine AS production
  ```

### F-8 — Prompt drift: spec asserts `:latest` was "intentionally dropped"; staging workflow still pushes it — Low
- **Location:** `prompts/12-cicd-security.md:81` vs `.github/workflows/deploy-staging.yml:47-52`
- **Observation:** Spec checklist item 6 reads "Image tagged by `${{ github.sha }}` only (the `:latest` tag was intentionally dropped per inline F-32 note) — confirm no consumer still pulls `:latest`." That statement is true only for `deploy.yml`. The live `deploy-staging.yml` still builds *and pushes* `:latest` (see F-1). Section 9 of the spec partially acknowledges staging drift ("`rm -r`+`cp -r` shape") but not the `:latest` push.
- **Impact:** Documentation/spec inaccuracy — a reviewer trusting the spec would mark the check passed and miss F-1. Low.
- **Fix:** Update the spec to scope the `:latest`-drop claim to `deploy.yml` and add a staging-still-pushes-`:latest` note (folds into the quarterly prompt-refresh).
- **Evidence:**
  ```
  # spec line 81:
  - [ ] Image tagged by `${{ github.sha }}` only (the `:latest` tag was intentionally dropped ...
  ```
  ```yaml
  # deploy-staging.yml line 52:
  docker push "$IMAGE_LATEST"
  ```

## Checks passed

### 1. Workflow Security
- [x] No `@latest`/`@master` action refs — all actions tag-pinned (`@v4`/`@v2`) — verified across `ci.yml:21,24,43`, `deploy.yml:38,41,47`, `deploy-staging.yml:26,29,35`. (Hardening gap tracked as F-5.)
- [x] Secrets accessed via `${{ secrets.* }}` only; the sole secret is `secrets.GCP_SA_KEY` — `deploy.yml:43`, `deploy-staging.yml:31`.
- [x] No secrets echoed to logs — `GCP_SA_KEY` appears only as `credentials_json:` values; grep for `echo/cat/print` against the secret returns nothing — `deploy.yml:43,156,202`.

### 2. Secret Handling
- [x] GCP key passed only to `google-github-actions/auth@v2` via `credentials_json`, never to a `run:` step — `deploy.yml:41-43`, `deploy-staging.yml:29-31`.
- [x] gitleaks secret scan gates the build (`detect --no-git --source . --config .gitleaks.toml --redact`) — `ci.yml:114-118`.
- [x] `.gitleaks.toml` allowlists only `.env*.example` templates, test fixtures, and the `New Project Documents/` doc layer; placeholders via `CHANGE_ME` regex — `.gitleaks.toml:14-32`.
- [x] `rls` job `PHI_ENCRYPTION_KEY` is the documented test-only dummy (`00112233...eeff`), allowlisted in gitleaks, never used to encrypt real PHI — `ci.yml:169`, `.gitleaks.toml:31`.

### 3. Dockerfile Security
- [x] Base image from trusted source, version-pinned `node:20-alpine` (not `latest`) — `Dockerfile:4,24`. (Digest-pin hardening = F-7.)
- [x] No real secrets in Dockerfile — `DATABASE_URL` is the documented offline-`prisma generate` dummy — `Dockerfile:18,37`.
- [x] No secrets in build args (no `ARG` directives present) — `Dockerfile:1-52`.
- [x] Multi-stage build `builder` → `production` — `Dockerfile:4,24`.
- [x] Non-root user (uid 1001 `nodejs`, `USER nodejs`) — `Dockerfile:43-44`.
- [x] `apk update && apk upgrade` patches base CVEs in the production stage — `Dockerfile:28`.
- [x] `HEALTHCHECK` defined, wgets `/health` (route exists at `app.ts:301`) — `Dockerfile:48-49`.

### 4. .dockerignore Coverage
Note: the effective build context for the image is `backend/` (`deploy.yml:66` does `cd backend` before `docker build .`), so `backend/.dockerignore` governs.
- [x] `.env`, `.env.local`, `.env.*.local` excluded — `backend/.dockerignore:10-12`.
- [x] `.git`/`.gitignore` excluded — `backend/.dockerignore:21-22`.
- [x] `node_modules` excluded — `backend/.dockerignore:2`.
- [x] Test files excluded (`**/__tests__`, `**/*.test.ts`, `**/*.spec.ts`) — `backend/.dockerignore:25-27`.
- [x] Secret/key file `cookies.txt` dropped (backend-specific) — `backend/.dockerignore:36`.
- [x] `dist`/`coverage` excluded (rebuilt in container) — `backend/.dockerignore:5-6`.

### 5. Build Process
- [x] Dependencies from lockfile: `npm ci` (builder) and `npm ci --omit=dev` (production) — `Dockerfile:12,31`; `package-lock.json` present at root and `backend/`.
- [x] No bare `npm install` in any workflow or Dockerfile — grep returns only `npm ci` — `ci.yml:29,68,181`, `deploy.yml:217`, `deploy-staging.yml:108`.
- [x] No dev dependencies in production image (`--omit=dev`) — `Dockerfile:31`.
- [x] `prisma generate` runs in both stages with the dummy `DATABASE_URL`, no live DB at build — `Dockerfile:18-19,37-38`.

### 6. Deployment Process (`deploy.yml`)
- [x] Canary: new revision deployed `--no-traffic` with `staging-<sha>` tag before any shift — `deploy.yml:82-89`.
- [x] Health gate: `smoke-test` probes the tagged URL `/api/v1/health` (6 retries) and `promote` `needs: [build-and-stage, smoke-test]` — `deploy.yml:114-139,149-150`.
- [x] Post-promote prod health probe of `https://api.ownmyhealth.io/api/v1/health`, fails on non-200 — `deploy.yml:173-183`.
- [x] Deterministic rollback via explicit `--to-revisions="$NEW_REV=100"` (not `--to-latest`) — `deploy.yml:168-171`.
- [x] Image referenced by `${{ github.sha }}` only in prod deploy; `:latest` dropped here — `deploy.yml:75,83`. (Staging exception = F-1.)
- [x] `--max-instances=3` kept in sync with the in-memory rate-limiter assumption — `deploy.yml:88`, cross-checked against `backend/src/middleware/rateLimiter.ts:7-14`.

### 7. Branch Protection
- [x] Master is the default branch and `claude/**`/dependabot work happens on feature branches that PR into it — `git branch -a` shows `origin/HEAD -> origin/master` with feature/dependabot branches. (Repo-level branch-protection *settings* are not in-repo — see Unverifiable.)

### 8. Service Account Permissions
- [x] Single auth secret `secrets.GCP_SA_KEY` used consistently — `deploy.yml:43,156,202`, `deploy-staging.yml:31,93`. (Actual IAM roles bound to the SA live in GCP, not the repo — see Unverifiable; WIF migration = F-6.)

### 9. Frontend Deployment
- [x] Prod frontend built with Vite, `VITE_API_URL=https://api.ownmyhealth.io/api/v1` — `deploy.yml:219-222`; staging uses `--mode staging` — `deploy-staging.yml:113`.
- [x] Prod upload via `gsutil -m rsync -d -r dist/` (no 404 window) — `deploy.yml:234`. (Staging still uses the older `rm -r`+`cp -r` shape, `deploy-staging.yml:117-118` — matches the spec's own acknowledgement, so noted as Info F-I2 not a finding.)
- [x] `index.html` gets `Cache-Control: no-cache, no-store, must-revalidate` via `setmeta` — `deploy.yml:235`, `deploy-staging.yml:119`.
- [x] No production source maps in the frontend build — Vite defaults `build.sourcemap` to `false` and `vite.config.ts` does not enable it — `vite.config.ts:11-41`.

### 10. CI Pipeline (`ci.yml`)
- [x] Runs on push to `main`/`master`/`develop`/`claude/**` and PRs to `main`/`master`/`develop`; `workflow_call`-able — `ci.yml:3-8`.
- [x] `frontend` job: `npm ci` → lint → test → build → upload `dist/` (7-day retention) — `ci.yml:28-47`.
- [x] `backend` job: `npm ci` → lint → `prisma generate` → `npm run test:ci` → build → upload artifact (7-day) — `ci.yml:67-94`.
- [x] `test:ci` runs the full colocated suite excluding only the live-Postgres `rls.test.ts` (not a `--passWithNoTests` no-op) — `backend/package.json:14`, `backend/vitest.config.ci.ts:18-27`.
- [x] `security` job: gitleaks → `npm audit` (frontend+backend) → RLS wrapper guard — `ci.yml:96-131`. (Audit-level caveat = F-3.)
- [x] `rls` job: `postgres:16` service, migrations as superuser, NOBYPASSRLS `omh_app` role provisioned, `npm run test:rls` — `ci.yml:137-195`; role SQL enforces `NOSUPERUSER NOBYPASSRLS` — `backend/prisma/rls-test-role.sql:15,22`.
- [x] Node 20 LTS via `NODE_VERSION: '20'` — `ci.yml:10-11`.
- [x] Artifacts use `retention-days: 7` — `ci.yml:47,94`.

## Unverifiable
- **Branch protection rules** (require PR reviews, require status checks, no force-push to master) — these are GitHub repo *settings*, not files in the tree. No ruleset/`.github` config encodes them. Confirm via `gh api repos/breilly1296/OwnMyHealth-Claude/branches/master/protection` or the repo Settings UI.
- **Service-account IAM roles** (checklist 8: `artifactregistry.writer`, `run.admin`, `iam.serviceAccountUser`, `storage.admin`, and absence of `owner`/`editor`) — the actual role bindings live in GCP IAM, not the repo. The workflows only prove the key is *used*, not what it is *granted*. Verify with `gcloud projects get-iam-policy ownmyhealth-prod`.
- **GCS bucket access controls** (`ownmyhealth-frontend`, `ownmyhealth-frontend-staging` — public/uniform/IAM) — bucket-level config is not in the repo. Verify with `gsutil iam get gs://ownmyhealth-frontend`.
- **Whether the `e2e-tests` job should be wired now** (spec item 10) — the job is intentionally commented out pending staging DB infra (`ci.yml:197-221`, refs `docs/STAGING.md`); this is a product/infra decision, not a code defect. Confirmed present-but-disabled; the "should it be enabled" question is for the team.
- **`CODEOWNERS`** — none present (`.github/` contains only `dependabot.yml` + the three workflows), so no enforced reviewer routing exists. Not a spec line item; noted for completeness.

## Out of scope
- The `rls` job's actual RLS *policy* correctness (whether the SQL policies isolate tenants) — covered by the dedicated RLS/database reviews (01, and the RLS regression suite itself). This review confirms only that the CI *gate* runs as a NOBYPASSRLS role.
- The rate-limiter store design and the `--max-instances=3` ceiling's runtime adequacy — covered by the rate-limiting review (08). This review confirms only that the deploy cap and the limiter comment are in sync.
- gitleaks rule *completeness* (whether the default ruleset catches every secret shape) — `.gitleaks.toml` extends the upstream default ruleset; auditing that ruleset's coverage is upstream scope.

## Info (non-findings, noted per protocol)
- **F-I1 — Stale Dockerfile header.** `backend/Dockerfile:1-2` says "Production-ready Node.js container for **AWS ECS** deployment," but the target is GCP Cloud Run (`deploy.yml`). Cosmetic/doc-only mismatch the spec flags; no security impact. Suggest correcting the comment.
- **F-I2 — Staging frontend deploy uses `rm -r`+`cp -r` (404 window).** `deploy-staging.yml:117-118` retains the older shape prod replaced with `rsync` (F-31). Availability nit on staging only; the spec already acknowledges it, so recorded as Info rather than a finding.
