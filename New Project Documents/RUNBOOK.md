# RUNBOOK.md — OwnMyHealth Operator's Reference

> **Last verified:** 2026-06-01 against the live codebase.
> **Audience:** on-call / operator. Every command below is meant to run verbatim.
> **Source of truth:** `.github/workflows/deploy.yml` + `deploy-staging.yml` (project/region/service/bucket), `backend/Dockerfile` (runtime), `backend/src/app.ts` (boot), `backend/src/config/index.ts` (env validation). `DEPLOY.md` describes a **Railway** deploy that is no longer how prod ships — treat it as stale except for the domain/DNS table.

This doc passes the five `_doc-quality.md` tests (question-answering, path-and-line, snippet, diagram, reproducibility). See [`## Acceptance questions`](#acceptance-questions) at the end for the self-check.

---

## 1. Quick reference

| Thing | Value | Source |
|---|---|---|
| GCP project (prod + staging) | `ownmyhealth-prod` | `.github/workflows/deploy.yml:21`, `deploy-staging.yml:15` |
| Region | `us-central1` | `deploy.yml:22`, `deploy-staging.yml:16` |
| Prod Cloud Run service | `ownmyhealth-backend` (`--max-instances=3`) | `deploy.yml:23,88` |
| Staging Cloud Run service | `ownmyhealth-backend-staging` | `deploy-staging.yml:17` |
| Artifact Registry repo | `ownmyhealth` | `deploy.yml:24` |
| Backend image | `us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:<sha>` | `deploy.yml:63-64` |
| Prod frontend bucket | `ownmyhealth-frontend` | `deploy.yml:25` |
| Staging frontend bucket | `ownmyhealth-frontend-staging` | `deploy-staging.yml:19` |
| Prod backend URL | `https://api.ownmyhealth.io` | `deploy.yml:176` |
| Staging backend URL | `https://api-staging.ownmyhealth.io` | `deploy-staging.yml:73` |
| Prod frontend URL | `https://ownmyhealth.io`, `https://app.ownmyhealth.io` | `app.ts:65-68` (hardcoded CORS), `docs/STAGING.md:12` |
| Staging frontend URL | `https://staging.ownmyhealth.io` | `docs/STAGING.md:12` |
| Prod DB name | `verifymyprovider` | CLAUDE.md (project memory); confirm in GCP — see [§7](#7-database-operations) |
| Container port | `3001` (`EXPOSE 3001`) | `backend/Dockerfile:46` |
| Health endpoints | `/health`, `/api/health/db`, `/api/v1/health` | `app.ts:301,318`, `routes/index.ts:42` |

---

## 2. Environments

| Property | Local | Staging | Prod | Source |
|---|---|---|---|---|
| Branch | (any) | `staging` | `main` / `master` | `deploy-staging.yml:4`, `deploy.yml:17` |
| `NODE_ENV` | `development` (default) | `staging` | `production` | `config/index.ts:34-36`, `docs/STAGING.md:53` |
| Deploy trigger | manual (`npm run dev`) | push to `staging` → `deploy-staging.yml` | push to `main`/`master` → `deploy.yml` (canary → smoke → promote) | workflows |
| Frontend URL | `http://localhost:5173` | `https://staging.ownmyhealth.io` | `https://ownmyhealth.io` / `https://app.ownmyhealth.io` | `config/index.ts:153`, `docs/STAGING.md:12`, `app.ts:65-68` |
| Backend URL | `http://localhost:3001` | `https://api-staging.ownmyhealth.io` | `https://api.ownmyhealth.io` | `config/index.ts:41`, `deploy-staging.yml:73`, `deploy.yml:176` |
| GCP project | n/a | `ownmyhealth-prod` | `ownmyhealth-prod` | `deploy-staging.yml:15`, `deploy.yml:21` |
| Cloud Run service | n/a | `ownmyhealth-backend-staging` | `ownmyhealth-backend` | workflows |
| Frontend bucket | n/a | `ownmyhealth-frontend-staging` | `ownmyhealth-frontend` | workflows |
| Cloud SQL instance | n/a | TBD (external: instance name lives in GCP Console project `ownmyhealth-prod`; add here once confirmed) | TBD (external: instance name lives in GCP Console project `ownmyhealth-prod`; the C-8 runbook leaves it as `<cloud-sql-instance-name>` at `docs/c-8-part-c-runbook.md:37`) |
| Database name | `ownmyhealth_dev` (dev convention) | `ownmyhealth_staging` | `ownmyhealth` (per `docs/STAGING.md:16`) / `verifymyprovider` (per CLAUDE.md) — reconcile in GCP | `docs/STAGING.md:16,77`, CLAUDE.md |
| Service account | n/a | uses `GCP_SA_KEY` secret | uses `GCP_SA_KEY` secret | `deploy.yml:43`, `deploy-staging.yml:31` |

**Staging carveouts vs prod** (`config/index.ts:31-36`, `docs/STAGING.md:50-58`): Claude calls blocked (`ANTHROPIC_BAA_ACTIVE=false`), SendGrid sandboxed (no real email), demo account allowed. Staging is otherwise production-like (same CORS/encryption validation in `config/index.ts:341`).

> Note: `docs/STAGING.md:16` lists the **prod** DB as `ownmyhealth` while project memory (CLAUDE.md) records `verifymyprovider`. These conflict; the live Cloud Run `DATABASE_URL` secret is authoritative. Logged in [§Prompt drift log](#prompt-drift-log).

---

## 3. Deployment topology

```mermaid
flowchart LR
  dev[Developer push to main/master] --> gh[GitHub Actions deploy.yml]
  gh --> img["Artifact Registry:\nus-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:&lt;sha&gt;"]
  gh --> fe[gsutil rsync -d -r dist/ -> GCS ownmyhealth-frontend]
  img --> cr["Cloud Run: ownmyhealth-backend (us-central1, max-instances=3)"]
  cr --> sql[(Cloud SQL: postgres)]
  cr --> gcs[(GCS uploads: ownmyhealth-user-files)]
  cr --> anth[Anthropic Claude]
  cr --> sg[SendGrid]
  cr --> dai[Google Document AI OCR]
  cr -.optional REDIS_URL.-> redis[(Memorystore Redis: rate limits)]
  cr -.optional QUEST_FHIR_*.-> quest[Quest Diagnostics SMART-on-FHIR]
  sched[Cloud Scheduler] -.X-Cleanup-Token.-> cr
  fe --> browser[Browser]
  browser -.httpOnly cookies: access/refresh/csrf.-> cr
```

**Runtime container** (`backend/Dockerfile`): Node 20 Alpine, multi-stage build (`builder` → `production`), runs as non-root user `nodejs` (uid 1001), `EXPOSE 3001`, `HEALTHCHECK` wgets `http://localhost:3001/health` every 30s (`Dockerfile:48-49`). Entrypoint:

```dockerfile
# Source: backend/Dockerfile:51
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app.js"]
```

So the **container itself runs `prisma migrate deploy` on every boot, then starts the server**. The same command is mirrored in `backend/railway.toml:9` (legacy Railway config — not the live deploy path). `backend/package.json` has **no** `migrate:deploy` npm script; the command is inline only (scripts verified: `dev`, `build`, `start`, `lint`, `test`, `test:ci`, `test:unit`, `test:integration`, `test:rls`).

---

## 4. Deploy: backend

### 4.1 Automatic (the real path)

Push to `main`/`master` triggers `.github/workflows/deploy.yml`, which runs **three sequential jobs**:

```
build-and-stage ──▶ smoke-test ──▶ promote
   (0% traffic,        (/api/v1/health      (100% traffic via
    tagged revision)    on tagged URL)       --to-revisions)
```

1. **`build-and-stage`** (`deploy.yml:30-108`): builds `…:${{ github.sha }}`, pushes to Artifact Registry, then `gcloud run deploy … --no-traffic --max-instances=3 --tag "staging-<shortsha>"`. Nothing in prod shifts.

   ```bash
   # Source: deploy.yml:82-89
   gcloud run deploy ownmyhealth-backend \
     --image "$IMAGE" \
     --region "us-central1" \
     --project "ownmyhealth-prod" \
     --platform managed \
     --no-traffic \
     --max-instances=3 \
     --tag "$TAG"
   ```

2. **`smoke-test`** (`deploy.yml:114-139`): curls the tagged 0%-traffic URL `${staging_url}/api/v1/health`, retrying 6× to absorb cold-start; passes only on HTTP 200 with `"success":true` in the body.

3. **`promote`** (`deploy.yml:149-191`): shifts 100% traffic with explicit `--to-revisions` (not `--to-latest`), re-probes `https://api.ownmyhealth.io/api/v1/health` 3×, then removes the staging tag.

   ```bash
   # Source: deploy.yml:168-171
   gcloud run services update-traffic ownmyhealth-backend \
     --region "us-central1" \
     --project "ownmyhealth-prod" \
     --to-revisions="$NEW_REV=100"
   ```

A separate `deploy-frontend` job runs in parallel (see [§5](#5-deploy-frontend)).

### 4.2 Manual backend deploy

If CI is down, reproduce the pipeline by hand. Build/push, deploy at 0%, smoke, then promote:

```bash
SHA=$(git rev-parse HEAD)
IMAGE="us-central1-docker.pkg.dev/ownmyhealth-prod/ownmyhealth/ownmyhealth-backend:${SHA}"

gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
docker build -t "$IMAGE" backend/
docker push "$IMAGE"

# Deploy at 0% with a tag so it's smoke-testable
gcloud run deploy ownmyhealth-backend \
  --image "$IMAGE" --region us-central1 --project ownmyhealth-prod \
  --platform managed --no-traffic --max-instances=3 --tag "manual-${SHA:0:7}"

# Resolve + smoke-test the tagged URL
TAGGED_URL=$(gcloud run services describe ownmyhealth-backend \
  --region us-central1 --project ownmyhealth-prod --format=json \
  | jq -r --arg t "manual-${SHA:0:7}" '.status.traffic[] | select(.tag==$t) | .url')
curl -sS "$TAGGED_URL/api/v1/health"

# Promote
NEW_REV=$(gcloud run services describe ownmyhealth-backend \
  --region us-central1 --project ownmyhealth-prod \
  --format='value(status.latestCreatedRevisionName)')
gcloud run services update-traffic ownmyhealth-backend \
  --region us-central1 --project ownmyhealth-prod --to-revisions="$NEW_REV=100"
```

### 4.3 Staging deploy

Push to `staging` → `deploy-staging.yml`. It deploys **straight to 100% traffic** (no canary, no gate). The health probe is non-fatal (`deploy-staging.yml:81-82`).

```bash
# Source: deploy-staging.yml:62-67
gcloud run deploy ownmyhealth-backend-staging \
  --image "$IMAGE" \
  --region "us-central1" \
  --project "ownmyhealth-prod" \
  --platform managed \
  --max-instances=3
```

---

## 5. Deploy: frontend

### 5.1 Automatic

`deploy.yml:193-235` builds the Vite SPA with `VITE_API_URL=https://api.ownmyhealth.io/api/v1` and rsyncs to the bucket:

```bash
# Source: deploy.yml:234-235
gsutil -m rsync -d -r dist/ gs://ownmyhealth-frontend/
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" gs://ownmyhealth-frontend/index.html
```

`rsync -d -r` uploads changed files first, then deletes orphans — no 404 window (F-31, `deploy.yml:225-232`). Staging still uses the older `rm -r` + `cp -r` shape (`deploy-staging.yml:117-119`), which has a brief gap, acceptable for staging.

### 5.2 Manual

```bash
VITE_API_URL=https://api.ownmyhealth.io/api/v1 npm run build
gsutil -m rsync -d -r dist/ gs://ownmyhealth-frontend/
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" gs://ownmyhealth-frontend/index.html
```

For staging, build with `npm run build -- --mode staging` (loads `.env.staging`, `deploy-staging.yml:113`) and target `gs://ownmyhealth-frontend-staging/`.

### 5.3 Provision frontend edge security headers (HSTS / nosniff / clickjacking) — teardown M16 / L14 / L15

The SPA is served **directly** from `gs://ownmyhealth-frontend` with no proxy, so the only response headers it can carry are `Content-Type` + `Cache-Control` (GCS object metadata) and the `<meta http-equiv>` CSP baked into `index.html`. The following are **header-only** and therefore cannot be set on a directly-served bucket:

- `Strict-Transport-Security` (HSTS — HTTPS pinning)
- `X-Content-Type-Options: nosniff` (MIME-sniff defense)
- `X-Frame-Options: DENY` / `Content-Security-Policy: frame-ancestors 'none'` (a meta-delivered `frame-ancestors` is **ignored** by browsers)

**Interim (already shipped):** clickjacking is mitigated in-app by the frame-bust in `src/utils/frameGuard.ts` (the app refuses to mount inside a frame). This makes the missing real `frame-ancestors`/`X-Frame-Options` header defense-in-depth rather than the sole control. **HSTS and nosniff are still NOT enforced** — they require the edge layer below.

**Real fix (requires provisioning — apply by hand, then cut over DNS):** front the bucket with an **external HTTPS load balancer + backend-bucket** and attach a **response-headers policy**. This is the same missing HTTPS LB that the Cloud Armor / DDoS playbook needs (§13 "Rate-limit abuse / DDoS"), so provision once and reuse.

```bash
# Project / names
P=ownmyhealth-prod; REGION=us-central1
BUCKET=ownmyhealth-frontend
DOMAIN=app.ownmyhealth.io

# 1. Reserve a global anycast IP for the LB
gcloud compute addresses create omh-frontend-ip --global --project="$P"
gcloud compute addresses describe omh-frontend-ip --global --project="$P" --format='value(address)'

# 2. Backend bucket fronting the GCS bucket, with Cloud CDN
gcloud compute backend-buckets create omh-frontend-be \
  --gcs-bucket-name="$BUCKET" --enable-cdn --project="$P"

# 3. Response-headers policy: the real security headers (HSTS/nosniff/frame/CSP)
#    NOTE: custom-response-headers live on the backend-bucket. Update it:
gcloud compute backend-buckets update omh-frontend-be --project="$P" \
  --custom-response-header='Strict-Transport-Security: max-age=63072000; includeSubDomains; preload' \
  --custom-response-header='X-Content-Type-Options: nosniff' \
  --custom-response-header='X-Frame-Options: DENY' \
  --custom-response-header='Content-Security-Policy: frame-ancestors '"'"'none'"'"''

# 4. URL map → target HTTPS proxy → managed cert → forwarding rule
gcloud compute url-maps create omh-frontend-urlmap --default-backend-bucket=omh-frontend-be --project="$P"
gcloud compute ssl-certificates create omh-frontend-cert --domains="$DOMAIN" --global --project="$P"
gcloud compute target-https-proxies create omh-frontend-proxy \
  --url-map=omh-frontend-urlmap --ssl-certificates=omh-frontend-cert --project="$P"
gcloud compute forwarding-rules create omh-frontend-fr --global \
  --address=omh-frontend-ip --target-https-proxy=omh-frontend-proxy --ports=443 --project="$P"

# 5. (Recommended) HTTP→HTTPS redirect so HSTS is established on first hit
#    Create an HTTP url-map with a 301 redirect + an :80 forwarding rule on the
#    same IP. (omitted for brevity — `gcloud compute url-maps import` with a
#    redirectAction: { httpsRedirect: true }.)
```

**DNS cutover (the irreversible-ish step — do during a low-traffic window):** point `app.ownmyhealth.io` A record at the reserved `omh-frontend-ip`. The managed cert provisions only **after** DNS resolves to the LB (can take up to ~60 min). Verify before/after:

```bash
# After cutover + cert ACTIVE:
curl -sI https://app.ownmyhealth.io/ | grep -iE 'strict-transport-security|x-content-type-options|x-frame-options|content-security-policy'
gcloud compute ssl-certificates describe omh-frontend-cert --global --project="$P" --format='value(managed.status)'  # → ACTIVE
```

Once shipped: keep the `index.html` `<meta>` CSP as defense-in-depth, update its INFRA-REMAINDER comment to reference this section, and codify the above in IaC (this repo has no Terraform yet — if/when it adopts one, port these resources so the edge config can't drift). The in-app frame-bust can stay (harmless once the real header is present).

---

## 6. Rollback

### 6.1 Backend (Cloud Run revision rollback)

```bash
# List revisions (newest first)
gcloud run revisions list --service=ownmyhealth-backend \
  --region=us-central1 --project=ownmyhealth-prod

# Pin 100% traffic to a known-good prior revision
gcloud run services update-traffic ownmyhealth-backend \
  --region=us-central1 --project=ownmyhealth-prod \
  --to-revisions=ownmyhealth-backend-0000N-abc=100
```

This is a metadata-only traffic shift (seconds), and because the prior revision carries its own image **and** its own secret-version pins, it is the fast rollback for both bad code and bad env. The C-8 runbook documents the same partial-rollout / instant-rollback shape (`docs/c-8-part-c-runbook.md:424-432`).

### 6.2 The traffic-pin gotcha (read before any env-var change)

**`gcloud run services update --update-env-vars=…` creates a NEW revision but keeps it at 0% traffic** when the service was previously promoted with explicit `--to-revisions=…` (which `deploy.yml:168-171` always does). Detection signal: `status.latestReadyRevisionName != status.latestCreatedRevisionName`. Fix by shifting traffic explicitly:

```bash
# After any `gcloud run services update --update-env-vars=…`:
gcloud run services update-traffic ownmyhealth-backend \
  --region=us-central1 --project=ownmyhealth-prod --to-latest
# Confirm:
gcloud run services describe ownmyhealth-backend --region=us-central1 --project=ownmyhealth-prod \
  --format='value(status.latestReadyRevisionName, status.latestCreatedRevisionName)'
```

This is documented in project memory `cloud-run-env-update-pinning.md` (2026-04-17 `ANTHROPIC_BAA_ACTIVE` flip postmortem) and reproduced in `docs/INFRA_REDIS_AND_SCHEDULER.md:54-61`. The pinning is **intentional** — it forces every prod traffic shift through the smoke-tested promote step (`deploy.yml:141-148`).

### 6.3 Frontend rollback

The bucket holds only the latest `dist/`. To roll back, rebuild the prior frontend commit and re-rsync:

```bash
git checkout <good-sha> -- .
VITE_API_URL=https://api.ownmyhealth.io/api/v1 npm run build
gsutil -m rsync -d -r dist/ gs://ownmyhealth-frontend/
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" gs://ownmyhealth-frontend/index.html
```

(There is no object-versioning rollback configured in-repo; the rebuild-and-re-rsync above is the only in-repo path. TBD (external: GCS Object Versioning is a bucket-level GCP-Console/`gsutil versioning set on` setting not captured in any repo file; enable it on `gs://ownmyhealth-frontend` from the GCP Console if instant object rollback is wanted, then document the restore command here).)

---

## 7. Database operations

### 7.1 Connect to prod Cloud SQL from your laptop

```bash
# Easiest: gcloud's built-in proxy (prompts for the DB password)
gcloud sql connect <cloud-sql-instance-name> \
  --database=<db-name> --user=postgres --project=ownmyhealth-prod
```

(`docs/c-8-part-c-runbook.md:238-239` uses this exact form.) Or run the Cloud SQL Auth Proxy and connect with `psql`:

```bash
# Terminal 1 — start the proxy on localhost:5432
cloud-sql-proxy ownmyhealth-prod:us-central1:<cloud-sql-instance-name> --port 5432
# Terminal 2 — connect (password from Secret Manager, see below)
psql "postgresql://postgres:$(gcloud secrets versions access latest \
  --secret=postgres-password --project=ownmyhealth-prod)@127.0.0.1:5432/<db-name>"
```

To inspect the live connection string without leaking the password:

```bash
# Source: docs/c-8-part-c-runbook.md:28-30
gcloud secrets versions access latest --secret=DATABASE_URL --project=ownmyhealth-prod \
  | sed 's/:[^@]*@/:REDACTED@/'
```

> The runtime app connects as the **`omh_app` NOBYPASSRLS role** after the C-8 cutover (`backend/src/services/database.ts:218-261` hard-exits in prod if the role has `BYPASSRLS`). Migrations connect as the **superuser** via a separate `DATABASE_URL_MIGRATIONS` secret (`docs/c-8-part-c-runbook.md:56-81`). Both Cloud SQL instance name and exact DB name are GCP-Console facts — TBD external until pasted into [§2](#2-environments).

### 7.2 Migrations

Migrations apply via `npx prisma migrate deploy`, run automatically on container boot (`backend/Dockerfile:51`) and by CI's RLS job (`ci.yml:186-189`). To apply manually against prod (use the **superuser** URL, not `omh_app`):

```bash
DATABASE_URL="postgresql://postgres:***@127.0.0.1:5432/<db-name>" \
  npx prisma migrate deploy --schema=backend/prisma/schema.prisma
```

Migration history lives in `backend/prisma/migrations/` (22 dirs as of 2026-06-01, e.g. `00000000000000_initial_schema`, `20260107_add_rls_policies`, `20260423_drop_dna_genetics`, `20260601_add_email_change`). The RLS policy migration is `20260107_add_rls_policies` — the load-bearing one for tenant isolation.

### 7.3 Common queries (PHI-aware)

**WARNING:** Most user-data columns are AES-256-GCM ciphertext (`*Encrypted` suffix) and are **not human-readable** in psql — see [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md). Never `SELECT` PHI columns into a terminal or log; query metadata/counts only. Reads through `psql` as the superuser **bypass RLS**, so always scope by `user_id` yourself.

```sql
-- Active session count (no PHI)
SELECT COUNT(*) FROM sessions WHERE "expiresAt" > now();

-- Audit-log volume by action in the last 24h (action codes are not PHI)
SELECT action, COUNT(*) FROM audit_logs
WHERE "createdAt" > now() - interval '24 hours'
GROUP BY action ORDER BY 2 DESC;

-- Force-logout everyone (auth incident) — see Playbook: Auth outage
DELETE FROM sessions;

-- Confirm the app role is NOT a superuser (RLS enforcing)
SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Expected for the runtime role: omh_app, rolbypassrls = f
```

---

## 8. Secret management

### 8.1 Where secrets live

Prod + staging secrets live in **GCP Secret Manager** (staging variants use a `-staging` suffix), mounted into Cloud Run via `--set-secrets` / `--update-secrets` (`docs/STAGING.md:58,96,117-125`). Boot-time validation that hard-fails on bad/missing secrets is in `backend/src/config/index.ts` (`requireEnv` at `:18-28`; JWT/PHI/audit-salt/BAA checks at `:235-440`).

### 8.2 Full secret set

| Secret env var | Consumer (file:line) | Update / rotate notes |
|---|---|---|
| `JWT_ACCESS_SECRET` | `config/index.ts:61` (signs access tokens) | `requireEnv` — boot fails if unset; min 32 chars (`:264`). Rotating invalidates all access tokens. |
| `JWT_REFRESH_SECRET` | `config/index.ts:65` (signs refresh tokens) | Same; rotating logs everyone out at next refresh. |
| `PHI_ENCRYPTION_KEY` | `config/index.ts:355`; `encryption.ts` (PHI cipher) | 64 hex chars, prod-validated (`:358-369`). **Load-bearing — see [§8.3](#83-rotating-phi_encryption_key-load-bearing).** |
| `AUDIT_LOG_SALT` | `config/index.ts:54,284` (audit-log PHI salt) | Min 16 chars; boot **hard-fails** if unset/short (`:284-293`). **Rotating destroys all historic audit-log decryptability — see [§8.4](#84-audit_log_salt-do-not-rotate-casually).** |
| `ANTHROPIC_API_KEY` | `config/index.ts:181` | Optional; if set, prod also requires `ANTHROPIC_BAA_ACTIVE=true` (`:300-306`) or boot fails. |
| `ANTHROPIC_BAA_ACTIVE` | `config/index.ts:185`; gate in `claudeExtraction.ts:106` | `"true"` asserts a signed BAA. Toggling it is the 2026-04-17 pinning-gotcha case. |
| `SENDGRID_API_KEY` | `config/index.ts:150` | Optional; absence disables email (warn at `:434`). |
| `REDIS_URL` | `config/index.ts:126`; `rateLimitStore.ts:33` | Optional; enables shared rate-limit store — see [§12](#12-redis-rate-limit-store). |
| `AUDIT_CLEANUP_TOKEN` | `config/index.ts:136`; `internalRoutes.ts:43` | Optional; enables Cloud Scheduler audit cleanup — see [§11](#11-cloud-scheduler--internal-endpoint). |
| `QUEST_FHIR_CLIENT_ID` / `_CLIENT_SECRET` / `_BASE_URL` / `_REDIRECT_URI` / `_SUCCESS_REDIRECT` / `_AUTH_HOSTS` | `config/index.ts:206-223` | Optional; Quest SMART-on-FHIR. Feature off unless `clientId` set. |
| `GCS_BUCKET_NAME` | `config/index.ts:168`; prod hard-fail if unset (`:399-405`) | Names the PHI uploads bucket (`ownmyhealth-user-files`). |
| `GOOGLE_BAA_ACTIVE` | `config/index.ts:176` | `"true"` to allow Document AI OCR; prod boot fails if `GCP_PROCESSOR_ID` set but flag unset (`:320-333`). |

Full env reference: [`ENV_VARS.md`](./ENV_VARS.md).

### 8.3 Update a secret (example: both JWT secrets)

```bash
# Add a new version to the Secret Manager secret
printf '%s' "$(openssl rand -base64 32)" | gcloud secrets versions add jwt-access-secret \
  --project=ownmyhealth-prod --data-file=-
printf '%s' "$(openssl rand -base64 32)" | gcloud secrets versions add jwt-refresh-secret \
  --project=ownmyhealth-prod --data-file=-

# Point Cloud Run at :latest (creates a new revision)
gcloud run services update ownmyhealth-backend \
  --region=us-central1 --project=ownmyhealth-prod \
  --update-secrets=JWT_ACCESS_SECRET=jwt-access-secret:latest,JWT_REFRESH_SECRET=jwt-refresh-secret:latest

# MUST follow with traffic shift (pinning gotcha, §6.2)
gcloud run services update-traffic ownmyhealth-backend \
  --region=us-central1 --project=ownmyhealth-prod --to-latest
```

(Secret-name-to-env-var mapping like `jwt-access-secret:latest` follows the `docs/STAGING.md:96` `--set-secrets` convention.)

### 8.3 Rotating `PHI_ENCRYPTION_KEY` (load-bearing)

`PHI_ENCRYPTION_KEY` is the master key from which per-user PHI keys are derived (PBKDF2-SHA512, `userEncryption.ts`). **You cannot "rotate" it with an env swap** — every existing `*Encrypted` column was produced with the current key and would become undecryptable. End-to-end procedure:

1. **Do not change the live key blindly.** First confirm a re-encryption migration exists for every PHI field in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) (User, Biomarker(+History), HealthNeed, HealthGoal, GoalProgressHistory, InsurancePlan, ExpenseProjection/Actual, CostAnalysis, LabConnection tokens, ProviderPatient, AuditLog).
2. Snapshot the DB (`gcloud sql backups create`, `docs/c-8-part-c-runbook.md:36-39`).
3. Run a re-encryption job that, **per row**: decrypt with the OLD key → re-encrypt with the NEW key, inside `withRLSContext(userId, …)` so RLS holds (`database.ts:447`). `AuditLog` rows use the **system salt** (`AUDIT_LOG_SALT`), not per-user salt (`auditLog.ts`), so they must be re-encrypted with the old/new `PHI_ENCRYPTION_KEY` path that matches how the audit cipher derives its key.
4. Only after the job verifies every row re-encrypts, swap the Secret Manager version and shift traffic (§8.3 + §6.2).
5. Keep the old key version retrievable until you've confirmed reads succeed across all models.

> There is **no in-repo re-encryption script** today (the dead `rotateUserEncryptionKey` was removed — git `d445aa3`/`79c532c`, 2026-05/30). Building it is a prerequisite. TBD (external: re-encryption tooling does not exist in the repo; must be authored before any `PHI_ENCRYPTION_KEY` rotation).

### 8.4 `AUDIT_LOG_SALT` — do not rotate casually

`AUDIT_LOG_SALT` salts the AES key for audit-log PHI snapshots (`previousValueEncrypted`/`newValueEncrypted`). Audit logs are retained 7 years and survive account deletion, so the salt **must be stable for the life of the data**. Two hard rules from `config/index.ts:279-293`:

```ts
// Source: backend/src/config/index.ts:284-293
const MIN_AUDIT_SALT_LENGTH = 16;
if (!config.auditSalt || config.auditSalt.length < MIN_AUDIT_SALT_LENGTH) {
  throw new Error(
    `AUDIT_LOG_SALT must be set and at least ${MIN_AUDIT_SALT_LENGTH} characters. ` +
    `Historic audit logs are encrypted with this salt — rotating it breaks decryption. ` +
    ...
  );
}
```

- Boot **hard-fails** if unset or shorter than 16 chars — so a missing salt is a crash-loop, not a silent error.
- Rotating it makes **every pre-existing audit log's PHI undecryptable**.

**Migration path for existing prod** (`config/index.ts:46-54`, `:289-291`): the historic salt is stored encrypted in `system_config.audit_encryption_salt`. Extract it (decrypt with `PHI_ENCRYPTION_KEY`) and write that *exact plaintext* into `AUDIT_LOG_SALT` in Secret Manager before deploying the env-var-based code. Procedure: `docs/STAGING.md` "Audit salt migration" referenced from `config/index.ts:51-52`, and the C-8 cutover context in `docs/c-8-part-c-runbook.md`.

---

## 9. Log access + filtering

Cloud Run ships stdout/stderr to Cloud Logging. Structured logs are JSON (`utils/logger.js`). **The prod HTTP logger strips query strings** so single-use `?token=…` verification/reset tokens never persist (`app.ts:231-244`):

```ts
// Source: backend/src/app.ts:231-237
morgan.token('urlpath', (req) => {
  const r = req as { originalUrl?: string; url?: string };
  return (r.originalUrl || r.url || '').split('?')[0];
});
const PROD_LOG_FORMAT =
  ':remote-addr - :remote-user [:date[clf]] ":method :urlpath HTTP/:http-version" :status :res[content-length] ":user-agent"';
```

Application-level PHI scrubbing lives in `utils/phiRedaction.ts` (`stripPHIFromText` at `:86`, `redactPHI` at `:97`).

```bash
# Auth failures in the last hour
gcloud logging read '
  resource.type="cloud_run_revision"
  resource.labels.service_name="ownmyhealth-backend"
  jsonPayload.action="LOGIN_FAILED"
' --project=ownmyhealth-prod --freshness=1h --limit=100

# Rate-limit hits (error code from errorHandler.ts:76)
gcloud logging read '
  resource.type="cloud_run_revision"
  jsonPayload.code="RATE_LIMIT_EXCEEDED"
' --project=ownmyhealth-prod --freshness=1d --limit=100

# RLS-denied / cross-tenant attempts (if tagged in the structured payload)
gcloud logging read '
  resource.type="cloud_run_revision"
  jsonPayload.rls_denied=true
' --project=ownmyhealth-prod --freshness=1h --limit=100

# Boot-time RLS assertion + FATAL (catches BYPASSRLS hard-exit, database.ts:248-254)
gcloud logging read '
  resource.type="cloud_run_revision"
  (textPayload:"BYPASSRLS" OR textPayload:"FATAL" OR jsonPayload.message:"BYPASSRLS")
' --project=ownmyhealth-prod --freshness=1d --limit=50
```

> `jsonPayload.action="LOGIN_FAILED"` / `jsonPayload.rls_denied=true` assume those exact keys are emitted by the logger; if a query returns nothing, fall back to `textPayload` substring matches and confirm the field name in `utils/logger.ts`. Cross-reference symptom→filter in [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

---

## 10. Schedulers

All three in-process schedulers are booted from `app.ts startServer()` (`app.ts:342-349`) and stopped in `gracefulShutdown` (`app.ts:384-386`).

| Job | File:line | Cadence | Effect |
|---|---|---|---|
| Session cleanup | `authService.ts` `startSessionCleanup` (`:1408`) | every 10 min (`setInterval(…, 10*60*1000)`, `:1417-1424`) | `sweepRevokedTokens()` evicts expired entries from the in-memory revoked-access-token blacklist, then `cleanupExpiredSessions()` deletes expired DB sessions |
| Audit retention cleanup (in-process) | `auditLog.ts` `startAuditCleanup` (`:582`) | every 24h (`setInterval(…, 24*60*60*1000)`, `:601-610`) — **disabled when `AUDIT_CLEANUP_TOKEN` set** (`:587-592`) | `cleanupOldLogs()` deletes `audit_logs` older than `RETENTION_DAYS = 2555` (~7y, `:10,532-533`) |
| Email engagement | `schedulers/emailScheduler.ts` `startEmailScheduler` (`:311`) | hourly tick (`setInterval(…, ONE_HOUR_MS)`, `:313-315`) | Each tick (`runTick`, `:282-309`): Mon 08:00 UTC → weekly summaries; once/UTC-day → goal-reminder sweep; once/UTC-day → plan-expiry sweep |
| Audit cleanup via Cloud Scheduler | `routes/internalRoutes.ts` `POST /audit-cleanup` (`:40`) | external, when `AUDIT_CLEANUP_TOKEN` set | Same `cleanupOldLogs()` delete, triggered by `X-Cleanup-Token` (see [§11](#11-cloud-scheduler--internal-endpoint)) |
| RLS wrapper sanity check | `scripts/check-rls-wrappers.sh` | manual / CI (`ci.yml:130-131`) | Fails build if a controller/service calls bare `prisma.<model>.<verb>(` instead of `tx.*` |

```ts
// Source: backend/src/services/auditLog.ts:587-592
if (config.scheduler.auditCleanupToken) {
  logger.info('Audit retention cleanup delegated to Cloud Scheduler; in-process interval disabled', {
    prefix: 'AuditLog',
  });
  return;
}
```

> **Cloud Run scale-to-zero caveat:** the 24h in-process audit interval rarely fires because the instance is reaped long before 24h (`auditLog.ts:585-586`). That's the whole reason `AUDIT_CLEANUP_TOKEN` + Cloud Scheduler exists.

### check-rls-wrappers.sh

This is the script that validates every controller wraps Prisma in `withRLSContext`. It lives at the **repo root** `scripts/check-rls-wrappers.sh` (NOT `backend/scripts/`) and greps `controllers/services/routes/schedulers/middleware/utils` for bare `prisma.<model>.<verb>(` / `prisma.$queryRaw(` calls outside a `tx.` callback (`check-rls-wrappers.sh:26-69`). Run it locally before any DB-touching PR:

```bash
bash scripts/check-rls-wrappers.sh   # prints "RLS wrapper check passed." or fails CI
```

It is the only operator script in the repo-root `scripts/` directory.

---

## 11. Cloud Scheduler / internal endpoint

When `AUDIT_CLEANUP_TOKEN` is set, the in-process 24h interval is disabled (§10) and Cloud Scheduler drives retention by POSTing to `/api/v1/internal/audit-cleanup` with an `X-Cleanup-Token` header. The endpoint is mounted at `app.ts:269` and is **CSRF-exempt + JWT-exempt** — auth is the shared-secret header only (`internalRoutes.ts:1-13`).

```ts
// Source: backend/src/routes/internalRoutes.ts:43-62
const expected = config.scheduler.auditCleanupToken;
if (!expected) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  return;
}
const provided = req.get('X-Cleanup-Token') || '';
if (!tokenMatches(provided, expected)) {     // constant-time compare, :27-33
  res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
  return;
}
```

**Response codes:** `404` when `AUDIT_CLEANUP_TOKEN` is unset (feature off, endpoint hidden), `401` on a bad/missing token, `200 { success: true, data: { deletedCount } }` on success.

**Provisioning** (full commands in `docs/INFRA_REDIS_AND_SCHEDULER.md:71-114`):

```bash
# 1. Generate + store the secret
TOKEN=$(openssl rand -base64 32)
printf '%s' "$TOKEN" | gcloud secrets create audit-cleanup-token \
  --project=ownmyhealth-prod --data-file=-

# 2. Set it on Cloud Run (+ traffic flip, pinning gotcha)
gcloud run services update ownmyhealth-backend --project=ownmyhealth-prod --region=us-central1 \
  --update-env-vars=AUDIT_CLEANUP_TOKEN="$TOKEN"
gcloud run services update-traffic ownmyhealth-backend --project=ownmyhealth-prod \
  --region=us-central1 --to-latest

# 3. Create the daily job (04:17 UTC, off-peak)
API_URL=$(gcloud run services describe ownmyhealth-backend \
  --project=ownmyhealth-prod --region=us-central1 --format="value(status.url)")
gcloud scheduler jobs create http omh-audit-retention \
  --project=ownmyhealth-prod --location=us-central1 \
  --schedule="17 4 * * *" \
  --uri="${API_URL}/api/v1/internal/audit-cleanup" \
  --http-method=POST --headers="X-Cleanup-Token=${TOKEN}" --attempt-deadline=120s
```

**Verify it's firing:**

```bash
gcloud scheduler jobs run omh-audit-retention --project=ownmyhealth-prod --location=us-central1
# Expect 200 with {"success":true,"data":{"deletedCount":N}} and an
# "Audit retention cleanup ran via scheduler" log line (internalRoutes.ts:66).
```

A `401` means header/secret mismatch; a `404` means `AUDIT_CLEANUP_TOKEN` isn't set on the **running** revision — check the traffic flip (`docs/INFRA_REDIS_AND_SCHEDULER.md:113-114`).

---

## 12. Redis rate-limit store

Eight named rate limiters live in `rateLimiter.ts` (`standardLimiter:17`, `authLimiter:37`, `strictAuthLimiter:53`, `uploadLimiter:76`, `sensitiveLimiter:92`, `aiLimiter:108`, `providerAccessRequestLimiter:133`, `bulkOperationLimiter:157`). By default they use express-rate-limit's per-instance `MemoryStore`, so on Cloud Run the effective ceiling is N×limit across N instances (`rateLimitStore.ts:1-14`) — bounded today by `--max-instances=3` (`deploy.yml:88`).

**Setting `REDIS_URL`** switches all limiters to a **shared Memorystore Redis store** so counters are consistent across instances (`config/index.ts:121-127`, `rateLimitStore.ts:32-64`):

```ts
// Source: backend/src/middleware/rateLimitStore.ts:32-53 (intervening lines elided)
function getClient(): RedisLike | null {
  if (!config.redis.url) return null;          // unset → undefined store → MemoryStore
  if (initialized) return client;
  initialized = true;
  try {
    const Redis = require('ioredis');
    client = new Redis(config.redis.url, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
    ...
    logger.startup('✓ Rate limiters using shared Redis store');
```

**Fallback behavior:**
- `REDIS_URL` unset (default, all current dev/test/CI): `createRateLimitStore` returns `undefined` → MemoryStore (`rateLimitStore.ts:71-73`).
- `REDIS_URL` set but ioredis fails to load/construct: logs an error and falls back to MemoryStore rather than crash boot (`rateLimitStore.ts:54-62`).
- `enableOfflineQueue: false` + `maxRetriesPerRequest: 2`: if Redis goes unreachable at runtime, commands fail fast (visible error) rather than hanging requests (`rateLimitStore.ts:43-45`).

**Provisioning** (Memorystore + VPC connector, full commands in `docs/INFRA_REDIS_AND_SCHEDULER.md:18-67`):

```bash
gcloud redis instances create omh-ratelimit --project=ownmyhealth-prod --region=us-central1 \
  --size=1 --tier=basic --redis-version=redis_7_0
gcloud compute networks vpc-access connectors create omh-connector \
  --project=ownmyhealth-prod --region=us-central1 --network=default --range=10.8.0.0/28
gcloud run services update ownmyhealth-backend --project=ownmyhealth-prod --region=us-central1 \
  --vpc-connector=omh-connector --update-env-vars=REDIS_URL=redis://10.0.0.3:6379
gcloud run services update-traffic ownmyhealth-backend --project=ownmyhealth-prod \
  --region=us-central1 --to-latest   # pinning gotcha
```

Confirm boot log `✓ Rate limiters using shared Redis store` (`rateLimitStore.ts:53`). To roll back, unset `REDIS_URL` (+ `--to-latest`) → limiters fall back to MemoryStore (`docs/INFRA_REDIS_AND_SCHEDULER.md:118-124`).

---

## 13. Incident playbooks

> Steps marked **(proven)** come from a recorded runbook/postmortem; **(derived)** are inferred from the architecture and should be validated against live behavior.

### Playbook: Auth outage

**Symptoms**: every request returns 401 across all users; logs show `JsonWebTokenError: invalid signature`.

**Likely cause**: `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` rotated but the running revision didn't pick up the new value, or a new revision didn't receive traffic (pinning gotcha §6.2). Note: both go through `requireEnv` (`config/index.ts:61,65`), so a *missing* secret is a **boot crash-loop**, a distinct signal from `invalid signature`.

**Diagnosis**:
1. `gcloud run services describe ownmyhealth-backend --region=us-central1 --project=ownmyhealth-prod --format='value(status.latestReadyRevisionName, status.latestCreatedRevisionName, spec.traffic)'`
2. If `latestReady` != `latestCreated`, traffic is pinned to the old revision — fix via `update-traffic` (§6.2). **(proven)**
3. Grep logs for `invalid signature`; correlate with the last secret update.

**Remediation**:
1. Re-deploy correct secrets: `gcloud run services update … --update-secrets=JWT_ACCESS_SECRET=jwt-access-secret:latest,JWT_REFRESH_SECRET=jwt-refresh-secret:latest` (§8.3).
2. `gcloud run services update-traffic … --to-latest`.
3. Force logout all users so stale tokens die: admin logout-all (`/auth/logout-all`, git `d589d32`) or `DELETE FROM sessions;` (§7.3).

**Cross-link**: [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md), [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

### Playbook: DB outage / pool exhaustion

**Symptoms**: `/health` returns 503 (`app.ts:301-312`), requests time out, logs show `connection pool` / `connectionTimeoutMillis` errors. Boot itself fails if the DB is unreachable — `initializeDatabase` rethrows and `startServer` `process.exit(1)` (`database.ts:156-198`, `app.ts:396-399`), so Cloud Run will crash-loop. **(proven via /health 503 design)**

**Diagnosis**:
1. `gcloud sql instances describe <instance> --project=ownmyhealth-prod --format='value(state)'` → expect `RUNNABLE`.
2. Check active connections vs the pool cap (`max` default 10, `DATABASE_POOL_SIZE`, `database.ts:108-114`).
3. `curl -s https://api.ownmyhealth.io/health` → look at `checks.database`.

**Remediation (derived)**:
1. If Cloud SQL is down: wait for GCP recovery / restart the instance from the Console.
2. If pool-exhausted under load: raise `DATABASE_POOL_SIZE` (env update + §6.2 traffic flip) and/or lower `--max-instances` pressure.
3. If a runaway query holds connections: `SELECT pg_terminate_backend(pid) …` for the offending pids (as superuser).

### Playbook: Claude API outage / BAA misconfiguration

**Symptoms**: AI features (biomarker guidance, SBC/lab extraction, cost analysis) fail. If `ANTHROPIC_BAA_ACTIVE` is not `"true"`, the runtime gate throws *before* any Claude call (`claudeExtraction.ts:106-110`).

**Diagnosis**:
1. Confirm BAA flag: `gcloud run services describe ownmyhealth-backend … --format='value(spec.template.spec.containers[0].env)'` → look for `ANTHROPIC_BAA_ACTIVE=true`. Prod **won't boot** with `ANTHROPIC_API_KEY` set but flag false (`config/index.ts:300-306`).
2. If the flag was just flipped and AI still fails: check the pinning gotcha (this is exactly the 2026-04-17 incident — `cloud-run-env-update-pinning.md`). **(proven)**
3. If Anthropic itself is down: logs show upstream 5xx/timeouts from the SDK.

**Remediation**:
1. BAA-flag issue: `gcloud run services update … --update-env-vars=ANTHROPIC_BAA_ACTIVE=true` then `update-traffic --to-latest` (§6.2). **(proven)**
2. Upstream outage: AI features degrade; the rest of the app keeps working (gate is local). Communicate, retry when Anthropic recovers.

### Playbook: AI daily-budget exhausted

**Symptoms**: AI endpoints return **503 SERVICE_UNAVAILABLE** with "daily budget reached" / "today's AI usage limit"; logs show `AI request refused — daily spend budget reached` (`aiSpendGuard.ts:36-47`).

**Cause**: the rolling per-UTC-day spend accumulator crossed `AI_DAILY_BUDGET_USD` (global, default 50) or `AI_USER_DAILY_BUDGET_USD` (per-user, default 5) (`config/index.ts:195-198`, gate at `aiSpendGuard.ts:30`). The accumulator is **in-memory/per-instance**, so the effective ceiling is N×budget under autoscale (`config/index.ts:190-193`).

**Diagnosis (derived)**:
1. Grep logs: `jsonPayload.message:"daily spend budget reached"` — `scope:"global"` vs per-user tells you which cap tripped.
2. If unexpected: a buggy client loop, compromised key, or abusive account is burning spend.

**Remediation**:
1. Legit spike: raise `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` (env update + §6.2). It auto-clears at the next UTC-day rollover.
2. Abuse: identify the `userId` in the warn log, then rate-limit/suspend that account; consider rotating `ANTHROPIC_API_KEY` if the key is suspected compromised.

### Playbook: GCS outage / bucket-permission error

**Symptoms**: lab-report / SBC uploads and signed-URL downloads fail; logs reference `ownmyhealth-user-files` (`config/index.ts:168`). Prod boot hard-fails if `GCS_BUCKET_NAME` is unset (`config/index.ts:399-405`).

**Diagnosis (derived)**:
1. `gsutil ls gs://ownmyhealth-user-files/` as the Cloud Run runtime SA → permission error ⇒ IAM regression.
2. Confirm `GCS_BUCKET_NAME` env matches the real bucket on the running revision.

**Remediation (derived)**:
1. IAM: re-grant the runtime SA `roles/storage.objectAdmin` on the bucket.
2. Wrong bucket name: env update + §6.2.
3. GCP-wide GCS outage: uploads/downloads degrade; rest of the app works. Wait for recovery.

### Playbook: Quest FHIR / lab sync outage or OAuth failure

**Symptoms**: lab sync fails; `LabConnection.syncStatus` stuck `syncing`/error. Token-refresh path: `labSyncService.ts:218-245`.

**Cause**: SMART access token expired with **no refresh token** (`labSyncService.ts:225-226` throws "Access token expired and no refresh token available"), refresh rejected (`invalid_grant`), or Quest's FHIR endpoint down. Tokens are stored encrypted (`accessTokenEncrypted`/`refreshTokenEncrypted`, `labSyncService.ts:143-162`) — see [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md).

**Diagnosis (derived)**:
1. Grep logs for `labSync` / FHIR errors; check `LabConnection.syncError`.
2. Verify `QUEST_FHIR_*` config present (`config/index.ts:206-223`); if `clientId` unset the feature is simply off.

**Remediation (derived)**:
1. Revoked/expired token: the user must **re-connect** Quest (re-runs the OAuth handshake in `fhir/smartAuth.ts`); a revoked token cannot be programmatically restored. Account deletion revokes via `revokeAllUserConnections` (`labSyncService.ts:424-427`).
2. Quest endpoint down: retry later; the per-user sync is independent of core app health.

### Playbook: Redis / Memorystore unavailable

**Symptoms**: if `REDIS_URL` is set and Redis is unreachable, rate-limit commands fail fast (`rateLimitStore.ts:43-45`); limiters fall back to per-instance MemoryStore (effective limit dilutes by instance count).

**Remediation**:
1. Tolerable short-term: limiters still enforce per-instance; with `--max-instances=3` the ceiling is ≤3×.
2. To fully revert: unset `REDIS_URL` + `--to-latest` (§12, `docs/INFRA_REDIS_AND_SCHEDULER.md:118-124`). **(proven)**
3. Restore Memorystore from the Console, then re-set `REDIS_URL`.

### Playbook: PHI leak in logs

**Symptoms**: a log line contains plaintext PHI (name/DOB/MRN/etc.) or a `?token=…` secret.

**Triage (derived)**:
1. Identify the log entries: `gcloud logging read '<filter for the leaked value>' --project=ownmyhealth-prod`. **Do not paste the PHI into tickets.**
2. Determine source: the prod morgan format strips query strings (`app.ts:231-244`) and `phiRedaction.ts` scrubs app text — a leak implies a code path that bypassed both.

**Remediation (derived)**:
1. Patch the offending logger call to route through `stripPHIFromText`/`redactPHI` (`phiRedaction.ts:86,97`) or remove the field.
2. Purge the affected Cloud Logging entries (Logs Router / log-based exclusion + delete) — a GCP-Console operation. TBD (external: log-purge is performed in GCP Console; capture the exact steps in HIPAA_CHECKLIST.md).
3. Record an audit-log entry of the incident; assess breach-notification obligations per [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).

### Playbook: Rate-limit abuse / DDoS

**Symptoms**: spike in `jsonPayload.code="RATE_LIMIT_EXCEEDED"` (§9); elevated 429s; one IP/user dominating logs.

**Remediation (derived)**:
1. Tighten the relevant limiter (`rateLimiter.ts`) or lower `RATE_LIMIT_MAX_REQUESTS` (`config/index.ts:118`) — env update + §6.2.
2. For consistent multi-instance enforcement, enable `REDIS_URL` (§12) so a single abuser can't get N× the limit.
3. Block at the edge: Cloud Armor / load-balancer rule on the offending IP. TBD (external: no Cloud Armor policy or external HTTPS load balancer is defined in any repo file — Cloud Run is hit directly; provision a load balancer + Cloud Armor policy in the GCP Console for project `ownmyhealth-prod`, then record the IP-deny-rule command here).
4. `trust proxy` is on (`app.ts:120`) so `req.ip` is the real client IP for limiting/audit.

### Playbook: Runaway migration (failed midway)

**Symptoms**: deploy fails during `npx prisma migrate deploy` (container boot, `Dockerfile:51`, or CI `ci.yml:186-189`); a migration is recorded as failed in `_prisma_migrations`.

**Remediation (derived)**:
1. **Do not auto-retry blindly.** Inspect: `psql … -c "SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;"`.
2. Roll back app traffic to the prior revision (§6.1) so users hit the last-good image.
3. Resolve the migration state with `npx prisma migrate resolve --rolled-back <name>` (or `--applied` if it actually completed), then re-run `migrate deploy`. Run migrations as the **superuser** URL, not `omh_app` (which lacks DDL, `docs/c-8-part-c-runbook.md:60`).
4. Restore from the pre-deploy snapshot if data is corrupt (`gcloud sql backups create/restore`, `docs/c-8-part-c-runbook.md:36-41`).

### Playbook: Env-var update silently held back by a revision pin

This is the **pinning gotcha** (§6.2) — see the dedicated [§6.2](#62-the-traffic-pin-gotcha-read-before-any-env-var-change). Detection: `latestReadyRevisionName != latestCreatedRevisionName`. Fix: `update-traffic --to-latest`. **(proven — project memory `cloud-run-env-update-pinning.md`, 2026-04-17.)**

---

## 14. Smoke test after deploy

The deploy pipeline already smoke-tests `/api/v1/health` on the 0%-traffic revision (`deploy.yml:114-139`) and re-probes prod post-promote (`deploy.yml:173-183`). For a manual smoke after any deploy/rollback:

```bash
# 1. Docker/Cloud Run liveness (exercises Cloud SQL connectivity)
curl -s -o /dev/null -w "%{http_code}\n" https://api.ownmyhealth.io/health            # 200
# 2. Legacy DB health
curl -s https://api.ownmyhealth.io/api/health/db                                       # {"success":true,...}
# 3. API health (the CI probe target) — expect 200 with "success":true
curl -s https://api.ownmyhealth.io/api/v1/health
```

Endpoint shapes:
- `/health` → `{ status:"healthy", timestamp, checks:{ database } }`, 200/503 by DB (`app.ts:301-312`).
- `/api/health/db` → `{ success, data:{ connected, latency } }`, 200/503 (`app.ts:318-324`).
- `/api/v1/health` → `{ success:true, data:{ status:"healthy", timestamp } }` (`routes/index.ts:42-51`).

**Critical-path check (manual, against staging or with a throwaway account):** register → verify email → login → create a biomarker → list biomarkers. The full register→login→biomarker flow is exercised by the Playwright e2e specs (`e2e/*.spec.ts`, currently CI-deferred per `ci.yml:197-221`). See [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) and [`LOCAL_DEV.md`](./LOCAL_DEV.md).

---

## 15. Runbook maintenance

Update this doc when any of these change:
- A workflow `env:` block (project/region/service/bucket) — `deploy.yml`, `deploy-staging.yml`.
- The Dockerfile entrypoint/port/healthcheck — `backend/Dockerfile`.
- A scheduler's cadence or a new scheduler — `app.ts startServer()`, `auditLog.ts`, `authService.ts`, `schedulers/emailScheduler.ts`.
- A new secret or boot-time validation — `config/index.ts`, [`ENV_VARS.md`](./ENV_VARS.md).
- An incident occurs — add/adjust the relevant playbook with what actually fixed it (mark proven vs derived).

Re-verify the [Acceptance questions](#acceptance-questions) quarterly per `_doc-quality.md`. The Cloud SQL instance name and definitive prod DB name should be filled into [§2](#2-environments) the next time an operator has GCP-Console access.

---

## Acceptance questions

1. **Roll back to previous Cloud Run revision?** `gcloud run revisions list …` then `gcloud run services update-traffic ownmyhealth-backend --region=us-central1 --project=ownmyhealth-prod --to-revisions=<REV>=100` — [§6.1](#61-backend-cloud-run-revision-rollback).
2. **Why might an env-var update not take effect?** The service is promoted with explicit `--to-revisions`, so `services update --update-env-vars` makes a new revision at 0% traffic; fix with `update-traffic --to-latest`. Signal: `latestReady != latestCreated` — [§6.2](#62-the-traffic-pin-gotcha-read-before-any-env-var-change).
3. **Audit cleanup cadence / what it deletes / when disabled?** 24h in-process interval, deletes `audit_logs` older than 2555 days (~7y), disabled when `AUDIT_CLEANUP_TOKEN` is set (Cloud Scheduler takes over) — [§10](#10-schedulers), [§11](#11-cloud-scheduler--internal-endpoint).
4. **Connect to prod Cloud SQL from laptop?** `gcloud sql connect <instance> --user=postgres --project=ownmyhealth-prod`, or Cloud SQL Auth Proxy + psql — [§7.1](#71-connect-to-prod-cloud-sql-from-your-laptop).
5. **Which script validates `withRLSContext` wrapping, and where?** `scripts/check-rls-wrappers.sh` at the repo root (run in `ci.yml:130-131`) — [§10](#check-rls-wrapperssh).
6. **Staging vs prod deploy trigger + prod canary flow?** Staging: push to `staging` → straight to 100%. Prod: push to `main`/`master` → build-and-stage (0%, tagged) → smoke-test `/api/v1/health` → promote (100% via `--to-revisions`) — [§2](#2-environments), [§4](#4-deploy-backend).
7. **Rotate `PHI_ENCRYPTION_KEY` end-to-end; why is `AUDIT_LOG_SALT` dangerous?** PHI key needs a per-row decrypt-with-old / re-encrypt-with-new migration before the env swap (no in-repo tool yet) — [§8.3](#83-rotating-phi_encryption_key-load-bearing). `AUDIT_LOG_SALT` rotation makes all historic audit-log PHI undecryptable and boot hard-fails if unset/short — [§8.4](#84-audit_log_salt-do-not-rotate-casually).
8. **Where are prod secrets, and how to update both JWT secrets (real names)?** GCP Secret Manager; `gcloud secrets versions add jwt-access-secret`/`jwt-refresh-secret`, then `run services update --update-secrets=…:latest` + `update-traffic --to-latest` — [§8.1](#81-where-secrets-live)/[§8.3](#83-update-a-secret-example-both-jwt-secrets).
9. **Post-deploy smoke test + endpoints?** `/health`, `/api/health/db`, `/api/v1/health` (the CI target) — [§14](#14-smoke-test-after-deploy).
10. **Log filter for RLS-denied in last hour?** `resource.type="cloud_run_revision" jsonPayload.rls_denied=true` with `--freshness=1h` — [§9](#9-log-access--filtering).
11. **Claude outage playbook + AI budget exhaustion?** Claude: check `ANTHROPIC_BAA_ACTIVE` + pinning gotcha, flip flag + `--to-latest`. Budget: 503 from `aiSpendGuard`; raise `AI_DAILY_BUDGET_USD`/`AI_USER_DAILY_BUDGET_USD` or suspend the abuser; clears at UTC rollover — [§13](#playbook-claude-api-outage--baa-misconfiguration).
12. **Three in-process schedulers + cadence?** Session cleanup (10 min, `authService.ts:1408`), audit retention (24h, `auditLog.ts:582`), email engagement (hourly, `emailScheduler.ts:311`) — [§10](#10-schedulers).
13. **How is the Cloud Scheduler endpoint authed + 404 behavior?** `X-Cleanup-Token` shared secret, constant-time compared; `404` when `AUDIT_CLEANUP_TOKEN` unset, `401` on bad token, `200 {deletedCount}` on success — [§11](#11-cloud-scheduler--internal-endpoint).
14. **What does `REDIS_URL` change + fallback?** Switches all 8 limiters from per-instance MemoryStore to shared Memorystore; unset (or ioredis load failure) → MemoryStore fallback — [§12](#12-redis-rate-limit-store).

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system topology, middleware stack, RLS/auth data flows.
- [ENV_VARS.md](./ENV_VARS.md) — every env var + secret, consumers, classification.
- [DATA_MODEL.md](./DATA_MODEL.md) — schema, RLS policies, migration list for the DB ops above.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — encrypted-field inventory for the PHI-aware query/key-rotation steps.
- [ERROR_RECOVERY.md](./ERROR_RECOVERY.md) — per-error recovery (auth, DB, RLS-denied).
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — broader symptom→cause→fix catalog.
- [LOCAL_DEV.md](./LOCAL_DEV.md) — dev setup, the local mock FHIR server, dev DB conventions.
- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — open infra/security findings (BYPASSRLS cutover, BAA gates).
- [HIPAA_CHECKLIST.md](./HIPAA_CHECKLIST.md) — operational HIPAA obligations (audit retention, breach response).
- [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) — RLS regression suite, e2e smoke flows.

---

## Prompt drift log

- **Migration count:** the spec (`15-runbook-doc.md:45`) says "22 dirs"; the live `backend/prisma/migrations/` directory holds **22 migration dirs + `migration_lock.toml`** (confirmed: `00000000000000_initial_schema` … `20260601_add_email_change`). Count matches.
- **Prod DB name conflict:** `docs/STAGING.md:16` lists the prod DB as `ownmyhealth`, while CLAUDE.md/project memory records `verifymyprovider`, and the spec's environments table (`15-runbook-doc.md:120`) repeats `verifymyprovider`. These three disagree; the authoritative value is the live Cloud Run `DATABASE_URL` secret. Documented as a reconcile-in-GCP TBD in [§2](#2-environments).
- **`docs/c-8-part-c-runbook.md` RLS table is stale on DNA/genetics:** it lists `dna_data`, `dna_variants`, `genetic_traits` as RLS-enabled tables (`:47,153`), but those models were dropped in migration `20260423_drop_dna_genetics` (per `_phi-inventory.md:72-73`). The C-8 runbook predates the drop; its 16-table grant verification query is correspondingly stale. Flag for the prompt author to refresh the C-8 runbook.
