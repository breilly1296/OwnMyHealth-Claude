# Provisioning runbook — Redis rate limiting (#37) & Cloud Scheduler audit retention (#38)

Both features shipped **dormant behind env flags** (PRs #125, #126). The code does nothing
until you provision the infra and set the env vars below. This runbook turns them on.

**Deploy targets (from `.github/workflows/deploy.yml`):**
- Project: `ownmyhealth-prod`
- Region: `us-central1`
- Cloud Run service: `ownmyhealth-backend` (currently `--max-instances=3`)

> ⚠️ Your active gcloud project may be something else — pass `--project ownmyhealth-prod`
> on every command (this runbook does). Run `gcloud config set project ownmyhealth-prod`
> first if you prefer. These commands **create billable resources** (Memorystore ≈ $35–50/mo
> for a 1 GB Basic tier, plus a VPC connector). Review sizing before running.

---

## A. Redis rate-limit store (#37)

### A1. Create a Memorystore (Redis) instance
```bash
gcloud redis instances create omh-ratelimit \
  --project=ownmyhealth-prod \
  --region=us-central1 \
  --size=1 \
  --tier=basic \
  --redis-version=redis_7_0
# Get its private IP:
gcloud redis instances describe omh-ratelimit \
  --project=ownmyhealth-prod --region=us-central1 \
  --format="value(host)"     # → e.g. 10.0.0.3
```
`basic` tier = single node, no HA (fine for rate-limit counters — losing them just resets
limits). Use `standard_ha` if you want failover.

### A2. Serverless VPC Access connector (Cloud Run → Memorystore private IP)
Memorystore Basic exposes only a private IP, so Cloud Run needs a connector on the same VPC.
```bash
gcloud compute networks vpc-access connectors create omh-connector \
  --project=ownmyhealth-prod \
  --region=us-central1 \
  --network=default \
  --range=10.8.0.0/28
```
(Use the VPC the Memorystore instance is on; `default` shown.)

### A3. Point Cloud Run at the connector + set REDIS_URL
```bash
gcloud run services update ownmyhealth-backend \
  --project=ownmyhealth-prod --region=us-central1 \
  --vpc-connector=omh-connector \
  --update-env-vars=REDIS_URL=redis://10.0.0.3:6379
```
> ⚠️ **Env-update pinning gotcha** (see local memory `cloud-run-env-update-pinning.md`):
> the service is deployed with explicit revision pins, so `services update` creates a new
> revision at **0% traffic**. Flip traffic to it:
> ```bash
> gcloud run services update-traffic ownmyhealth-backend \
>   --project=ownmyhealth-prod --region=us-central1 --to-latest
> ```
> Confirm: `latestReadyRevisionName == latestCreatedRevisionName`.

### A4. Verify + (optional) raise max-instances
- Watch logs for `✓ Rate limiters using shared Redis store` on boot.
- Hit a rate-limited endpoint past its cap across instances; the limit should now hold globally.
- Once confirmed, the per-instance dilution is gone, so you can raise `--max-instances` in
  `deploy.yml` if you want more headroom.

---

## B. Cloud Scheduler audit retention (#38)

### B1. Generate + store the shared secret
```bash
TOKEN=$(openssl rand -base64 32)
printf '%s' "$TOKEN" | gcloud secrets create audit-cleanup-token \
  --project=ownmyhealth-prod --data-file=-
# Grant the Cloud Run runtime SA access if you wire it via --set-secrets (optional);
# simplest is to set it as a plain env var below.
```

### B2. Set AUDIT_CLEANUP_TOKEN on Cloud Run
```bash
gcloud run services update ownmyhealth-backend \
  --project=ownmyhealth-prod --region=us-central1 \
  --update-env-vars=AUDIT_CLEANUP_TOKEN="$TOKEN"
gcloud run services update-traffic ownmyhealth-backend \
  --project=ownmyhealth-prod --region=us-central1 --to-latest   # pinning gotcha again
```
On boot you'll see `Audit retention cleanup delegated to Cloud Scheduler; in-process interval disabled`.

### B3. Create the daily Scheduler job
```bash
API_URL=$(gcloud run services describe ownmyhealth-backend \
  --project=ownmyhealth-prod --region=us-central1 --format="value(status.url)")

gcloud scheduler jobs create http omh-audit-retention \
  --project=ownmyhealth-prod --location=us-central1 \
  --schedule="17 4 * * *" \
  --uri="${API_URL}/api/v1/internal/audit-cleanup" \
  --http-method=POST \
  --headers="X-Cleanup-Token=${TOKEN}" \
  --attempt-deadline=120s
```
(`17 4 * * *` = 04:17 UTC daily — off-peak, avoids top-of-hour stampedes.)

### B4. Verify
```bash
gcloud scheduler jobs run omh-audit-retention \
  --project=ownmyhealth-prod --location=us-central1
```
Expect a 200 with `{ "success": true, "data": { "deletedCount": N } }`, and an
`Audit retention cleanup ran via scheduler` log line. A 401 means the header/secret mismatch;
404 means `AUDIT_CLEANUP_TOKEN` isn't set on the running revision (check the traffic flip).

---

## Rollback
- Redis: unset `REDIS_URL` (+ `--to-latest`) → limiters fall back to in-memory. Optionally
  remove the connector and delete the Memorystore instance.
- Scheduler: unset `AUDIT_CLEANUP_TOKEN` (+ `--to-latest`) → in-process 24h interval resumes;
  pause/delete the Scheduler job (`gcloud scheduler jobs delete omh-audit-retention ...`).

Both are safe to toggle off at any time; the app reverts to its prior (pre-#125/#126) behavior.
