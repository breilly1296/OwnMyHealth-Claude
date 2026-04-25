---
tags:
  - documentation
  - security
  - compliance
  - hipaa
  - operations
type: hipaa-administrative-safeguard
hipaa-citation: §164.308(a)(7) Contingency Plan
generated: 2026-04-25
version: 1.0
status: draft
review-cycle: annual + post-drill
next-review: 2027-04-25
last-drill: never
next-drill: 2026-07-25
---

# Contingency Plan — OwnMyHealth

> **Purpose**: this document satisfies the Contingency Plan administrative
> safeguard required by 45 CFR §164.308(a)(7) and its four implementation
> specifications: (A) Data Backup, (B) Disaster Recovery, (C) Emergency
> Mode Operation, (D) Testing & Revision. It is the operational playbook
> the founder/operator runs when OwnMyHealth or any of its dependencies
> fails.
>
> [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md) flagged the absence of a
> documented restore drill as **T-07 — High residual risk**. This plan
> closes that gap on paper; the first quarterly drill (§5) closes it in
> practice.
>
> Companion documents:
> [`RUNBOOK.md`](./RUNBOOK.md) (operational incident playbook),
> [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md) (§164.400-414),
> [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md) (§164.316).

---

## 1. Purpose and Scope

### 1.1 Goal

Ensure continuity of OwnMyHealth services and protection of PHI during
disasters, infrastructure outages, or security incidents. "Continuity"
here means three things, in priority order:

1. **Confidentiality and integrity of PHI are preserved** even when
   availability is degraded. A read-only or fully-offline app is
   acceptable; a leaking app is not.
2. **No PHI is permanently lost** without conscious, documented operator
   acknowledgement. The catastrophic failure mode (master key loss) is
   called out honestly in §3.9.
3. **Users can be informed** about what happened, when, and what to
   expect — the breach-notification path lives in
   [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md).

### 1.2 Scope

This plan covers every component required to deliver and protect PHI:

| Component | Purpose | Failure section |
|---|---|---|
| **Cloud Run backend** (`ownmyhealth-prod` / `api.ownmyhealth.io`) | Application logic, encryption, audit logging | §3.1 |
| **Cloud SQL PostgreSQL** | All structured PHI + audit logs + sessions | §3.2 |
| **Google Cloud Storage** (user-files bucket) | Lab/SBC source PDFs (encrypted bytes at rest by GCS) | §3.3 |
| **Google Document AI** | OCR of scanned lab reports | §3.4 (treated as Anthropic-equivalent — non-critical) |
| **Anthropic Claude API** | AI educational guidance, SBC extraction, cost analysis | §3.4 |
| **SendGrid** | Email verification, password reset | §3.5 |
| **DNS / domain** (`ownmyhealth.io`, `api.ownmyhealth.io`) | Service reachability | §3.6 |
| **GCP Secret Manager** | Master encryption key, JWT secrets, DB URL, API keys | §3.9 |
| **Developer workstation** | The single operator's laptop | §3.7 |

### 1.3 Operator assumption

OwnMyHealth runs with a **single operator** (the founder). Every step in
this document assumes that operator is reachable and able to act. If the
operator is unavailable for an extended period (illness, accident),
that is itself a contingency: see §3.10.

### 1.4 RPO / RTO targets

These are pre-beta targets. They will tighten before live PHI scale.

| Component | RPO (data loss tolerance) | RTO (downtime tolerance) |
|---|---|---|
| PostgreSQL (PHI + audit log) | **≤ 1 hour** via Cloud SQL PITR `[CONFIRM PITR is enabled in GCP Console for the prod instance]` |  **≤ 4 hours** for full restore from backup |
| GCS user-files bucket | **0** (object versioning) `[CONFIRM versioning enabled]` | **≤ 1 hour** to restore a deleted/overwritten object |
| Cloud Run backend | **N/A** (stateless) | **≤ 30 minutes** to redeploy from `main` via `.github/workflows/deploy.yml` |
| Frontend SPA (GCS bucket) | **N/A** (built artifact in CI) | **≤ 30 minutes** to redeploy |
| Secret Manager | **0** (built-in versioning) | **≤ 15 minutes** to roll back a secret version |
| Audit log integrity | **0** (7-year retention; never overwritten) | **≤ 4 hours** (restored as part of DB) |

These targets are aspirational until verified by the first restore drill
(§5) — see §6 step 9 for sign-off criteria.

---

## 2. Data Backup Plan — §164.308(a)(7)(ii)(A)

### 2.1 Cloud SQL automated backups

| Setting | Value | Source / verification |
|---|---|---|
| Automated daily backups | Enabled `[CONFIRM in GCP Console → SQL → ownmyhealth-prod-db → Backups]` | GCP default for HIPAA-aligned tier |
| Backup window | `[CONFIRM — typically a 4-hour overnight window in the instance's region]` | GCP Console |
| Retention | `[CONFIRM — GCP default is 7 daily backups; recommend ≥ 30 days for HIPAA]` | GCP Console |
| Storage location | `[CONFIRM — should be the same region as the instance, e.g. us-central1]` | GCP Console |
| Backup encryption | Google-managed CMEK by default; Google maintains the keys | [Cloud SQL docs](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups) |

**Verification command** (operator runs locally with `gcloud` authed
against the prod project):

```bash
gcloud sql backups list \
  --instance=ownmyhealth-prod-db \
  --project=ownmyhealth-prod \
  --limit=10
```

Expected output: 10 most recent backup IDs with `status=SUCCESSFUL`,
the most recent within the last 24 hours.

### 2.2 Point-in-Time Recovery (PITR)

PITR replays the binary write-ahead log forward from the most recent
backup, allowing restore to **any second** within the retention window.

| Setting | Value |
|---|---|
| PITR enabled | `[CONFIRM — requires `--enable-point-in-time-recovery` on the instance]` |
| WAL retention | `[CONFIRM — typically 7 days; matches backup retention]` |
| Effective RPO | ≤ 1 second within the retention window if PITR is enabled |

To enable on the prod instance (one-time, if not already on):

```bash
gcloud sql instances patch ownmyhealth-prod-db \
  --project=ownmyhealth-prod \
  --enable-point-in-time-recovery \
  --backup-start-time=03:00
```

### 2.3 GCS object versioning (user-files bucket)

User-uploaded lab reports and SBC PDFs are written by
`backend/src/services/storageService.ts` to the
`GCS_BUCKET_NAME` bucket. Object versioning preserves prior versions
when an object is overwritten or deleted.

| Setting | Value |
|---|---|
| Object versioning | `[CONFIRM — `gcloud storage buckets describe gs://${GCS_BUCKET_NAME} --format='value(versioning)'` should return `enabled=True`]` |
| Soft-delete retention | `[CONFIRM — GCP added a 7-day soft-delete default in 2024; verify it is on]` |
| Object lock / immutability | **Not configured.** Tracked as deferred remediation in [`RISK_ASSESSMENT.md` § 6.3 row 17](./RISK_ASSESSMENT.md#63-beta-window). |

To enable versioning if currently off:

```bash
gcloud storage buckets update gs://${GCS_BUCKET_NAME} --versioning
```

### 2.4 Master encryption key backup

The `PHI_ENCRYPTION_KEY` (64 hex chars = 32 random bytes) is the master
secret from which every per-user PHI encryption key is derived. **Loss
of this key renders all PHI permanently unrecoverable** — see §3.9.

| Mechanism | Detail |
|---|---|
| Storage | GCP Secret Manager, secret name `[CONFIRM — typically `phi-encryption-key`]` in project `ownmyhealth-prod` |
| Versioning | Enabled by default on Secret Manager — every overwrite creates a new version |
| Access | Cloud Run runtime service account only; no human IAM grant |
| Rotation | **Not yet implemented.** Tracked as deferred in [`RISK_ASSESSMENT.md` § 6.3 row 20](./RISK_ASSESSMENT.md#63-beta-window) and [`encryption.ts:81-85`](../backend/src/services/encryption.ts) `TODO(key-rotation)`. |
| Offline backup | **Recommended:** the current key version exported once to a sealed offline medium (printed hex on paper, sealed envelope, fireproof safe). `[CONFIRM — operator decision before live PHI]` |

To list versions of the master key in Secret Manager:

```bash
gcloud secrets versions list phi-encryption-key \
  --project=ownmyhealth-prod
```

Each version row carries a `STATE` (`ENABLED`, `DISABLED`, `DESTROYED`).
**Never set `STATE=DESTROYED` on the active version** — once destroyed,
Secret Manager cannot recover the bytes.

### 2.5 Audit-log salt backup

`AUDIT_LOG_SALT` is a separate Secret Manager secret used by
[`auditLog.ts`](../backend/src/services/auditLog.ts) to derive the
encryption key for `previousValueEncrypted` / `newValueEncrypted`
columns. It uses a **system salt** rather than per-user salts so audit
rows remain decryptable after account deletion. Same backup posture as
the master key (§2.4).

### 2.6 What is NOT backed up — and why

These are intentionally ephemeral:

| Data | Why no backup |
|---|---|
| `Session` table (refresh-token sessions) | Users can re-login; losing a session forces a 15-minute re-auth, not a data loss |
| In-memory rate-limiter state ([`rateLimiter.ts:6-13`](../backend/src/middleware/rateLimiter.ts)) | Per-instance, resets on deploy by design |
| In-memory revoked-token set ([`authService.ts:139`](../backend/src/services/authService.ts) `revokedTokens`) | Bounded by 15-minute access-token TTL; restoring a stale set would re-revoke valid tokens |
| Cloud Logging entries beyond GCP retention | Operational logs, not the legal audit trail. The legal trail is `audit_logs` table → backed up with PostgreSQL |
| Frontend build artifacts in GCS | Re-buildable from `main` via CI |

---

## 3. Disaster Recovery Plan — §164.308(a)(7)(ii)(B)

Each subsection below specifies: **trigger** → **detection** → **RTO
target** → **recovery procedure** → **verification**. Concrete `gcloud`
commands are inline; operator-decision points are flagged.

### 3.1 Cloud Run backend outage

- **Trigger**: 5xx errors on `https://api.ownmyhealth.io/api/v1/health`,
  Cloud Run revision unhealthy, or regional Google outage.
- **Detection**: external health-check ping `[CONFIRM — uptime check
  configured in Cloud Monitoring]`; user-reported outage.
- **RTO target**: ≤ 30 minutes.
- **Recovery**:
  - Single failed revision: roll back to last-known-good revision.
    ```bash
    gcloud run services update-traffic ownmyhealth-api \
      --project=ownmyhealth-prod \
      --region=us-central1 \
      --to-revisions=ownmyhealth-api-<KNOWN_GOOD>=100
    ```
    (See the cloud-run-env-update-pinning postmortem from 2026-04-17 —
    `update-traffic` is the load-bearing step; `update --update-env-vars`
    alone leaves traffic pinned to the old revision.)
  - Regional outage: redeploy to the secondary region.
    `[CONFIRM — secondary region not yet provisioned. Currently
    single-region (us-central1). Multi-region failover is a beta
    requirement — tracked in §7 follow-ups.]`
- **Verification**: `curl https://api.ownmyhealth.io/api/v1/health`
  returns 200 with `{"status":"ok"}`.

### 3.2 Cloud SQL failure or corruption

- **Trigger**: Cloud SQL instance unavailable, data corruption, or a
  destructive operator action (accidental DELETE, ransomware).
- **Detection**: backend logs show DB connection errors / query
  failures; Cloud Monitoring alert `[CONFIRM]`.
- **RTO target**: ≤ 4 hours.
- **Recovery — Path A: instance failure (data intact)**:
  Cloud SQL high-availability `[CONFIRM — HA configuration enabled?]`
  fails over automatically to the standby in ≤ 60 seconds. If HA is
  not configured, restart:
  ```bash
  gcloud sql instances restart ownmyhealth-prod-db \
    --project=ownmyhealth-prod
  ```
- **Recovery — Path B: data loss / corruption (PITR)**:
  Restore to a target timestamp into a **new** instance (never
  in-place; in-place restore destroys the WAL needed for further
  PITR).
  ```bash
  # 1. Pick a target time (UTC) just before the corruption
  TARGET_TIME=2026-04-25T14:32:00.000Z

  # 2. Restore to a new instance
  gcloud sql instances clone ownmyhealth-prod-db ownmyhealth-recovery-$(date +%Y%m%d) \
    --project=ownmyhealth-prod \
    --point-in-time=$TARGET_TIME

  # 3. Wait until RUNNABLE
  gcloud sql instances describe ownmyhealth-recovery-<DATE> \
    --project=ownmyhealth-prod \
    --format='value(state)'
  ```
- **Recovery — Path C: full backup restore (no PITR available)**:
  ```bash
  # 1. List backups
  gcloud sql backups list --instance=ownmyhealth-prod-db --project=ownmyhealth-prod

  # 2. Restore to a new instance
  gcloud sql backups restore <BACKUP_ID> \
    --project=ownmyhealth-prod \
    --restore-instance=ownmyhealth-recovery-$(date +%Y%m%d) \
    --backup-instance=ownmyhealth-prod-db
  ```
- **Cutover** (after restore):
  1. Update `DATABASE_URL` in Secret Manager to point at the recovery
     instance (preserve `omh_app` user + password):
     ```bash
     printf 'postgresql://omh_app:PASSWORD@/ownmyhealth?host=/cloudsql/ownmyhealth-prod:us-central1:ownmyhealth-recovery-DATE' \
       | gcloud secrets versions add database-url --data-file=- --project=ownmyhealth-prod
     ```
  2. Trigger a Cloud Run revision so the new secret version is picked up
     (env var alone won't propagate without a new revision — see
     project-memory cloud-run-env-update-pinning):
     ```bash
     gcloud run services update ownmyhealth-api \
       --project=ownmyhealth-prod --region=us-central1 \
       --update-secrets=DATABASE_URL=database-url:latest
     gcloud run services update-traffic ownmyhealth-api \
       --project=ownmyhealth-prod --region=us-central1 --to-latest
     ```
- **Verification**:
  - `SELECT count(*) FROM users;` matches expected magnitude.
  - `SELECT max(created_at) FROM audit_logs;` is within RPO.
  - Sample PHI decrypts cleanly (see §6 step 5).
  - The startup assertion `assertNoBypassRLS()` ([`database.ts:200-265`](../backend/src/services/database.ts))
    has not fired in the new revision's logs (i.e., `omh_app` is still
    NOBYPASSRLS after the restore).

### 3.3 GCS user-files data loss

- **Trigger**: deleted/overwritten objects, bucket policy mistake,
  ransomware encrypting blobs.
- **RTO target**: ≤ 1 hour for individual objects.
- **Recovery — Path A: object versioning restore** (preferred; assumes
  versioning enabled per §2.3):
  ```bash
  # List all versions of a path
  gcloud storage ls --all-versions gs://${GCS_BUCKET_NAME}/path/to/file.pdf

  # Restore a specific generation
  gcloud storage cp \
    gs://${GCS_BUCKET_NAME}/path/to/file.pdf#<GENERATION> \
    gs://${GCS_BUCKET_NAME}/path/to/file.pdf
  ```
- **Recovery — Path B: re-upload from user**: the user still holds the
  source PDF on their own device. Email the affected user with a link
  to re-upload. The DB row in `UserFile` is unaffected; only the GCS
  blob needs replacing.
- **Recovery — Path C: irrecoverable**: if neither (A) nor (B) is
  available, the file is lost. The DB metadata row should be marked
  `status='lost'` and the user notified per
  [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md) — loss
  of availability is a HIPAA-defined breach if it impairs the user's
  access to their own PHI.
- **Verification**: object listed in `gcloud storage ls`; signed URL
  download works through the app.

### 3.4 Anthropic API outage (or Document AI outage)

- **Trigger**: Claude API or Document AI returns 5xx / times out.
- **RTO target**: 0 (graceful degradation — no downtime for core
  platform).
- **Recovery**: AI features are non-essential to PHI access. The app
  must continue to serve biomarker entry, history, exports, and
  provider sharing without Claude.
  - `claudeExtraction.ts` and `sbcExtraction.ts` already wrap calls in
    try/catch and bubble structured errors. Verify the SBC upload UI
    surfaces a "AI extraction temporarily unavailable; please enter
    manually" path. `[CONFIRM UI message exists]`
  - If outage persists > 4 hours: post a status notice (§4.4).
- **Verification**: with Anthropic disabled (set
  `ANTHROPIC_BAA_ACTIVE=false` on a staging revision to simulate),
  confirm biomarker create/read/update/delete still functions and SBC
  upload reports a graceful error.

### 3.5 SendGrid outage

- **Trigger**: SendGrid returns 5xx; verification / password-reset
  emails not delivered.
- **RTO target**: ≤ 4 hours for transactional path; users are not
  blocked from already-authenticated app use.
- **Recovery**:
  - Already-logged-in users continue to work; only new registration and
    password reset are blocked.
  - For an extended outage, the operator can manually:
    1. Generate a verification or reset token via the admin path
       `[CONFIRM — admin endpoint exists?]` or directly via a script.
    2. Deliver the link to the affected user out-of-band (the user has
       contacted the operator via support email).
  - When SendGrid is restored, no replay is needed — pending
    verifications are time-bounded but users can request a fresh link.
- **Verification**: send a test verification email to a known
  operator-controlled inbox.

### 3.6 DNS / domain failure

- **Trigger**: `ownmyhealth.io` or `api.ownmyhealth.io` does not
  resolve, or resolves to the wrong IP.
- **RTO target**: ≤ 4 hours (limited by registrar response time).
- **Recovery**:
  - Registrar: `[CONFIRM — Cloudflare? Google Domains? Namecheap?]`
  - Login URL: `[CONFIRM — registrar console URL]`
  - Account credentials: in operator's password manager `[CONFIRM 2FA
    backup codes are stored offline]`
  - DNS provider: `[CONFIRM — likely same as registrar]`
  - TTL: `[CONFIRM — recommended 300s for the apex and api subdomain
    so that emergency record changes propagate quickly. Longer TTLs
    (e.g., 3600s) increase failover delay.]`
- **Verification**: `dig ownmyhealth.io` and
  `dig api.ownmyhealth.io` resolve to the expected Cloud Run / GCS IPs
  from at least two network vantage points.

### 3.7 Developer workstation loss

- **Trigger**: theft, hardware failure, malware compromise.
- **RTO target**: ≤ 1 day for the operator to re-establish a working
  development environment.
- **Recovery — what is needed to rebuild from scratch**:
  1. **Repository**: `git clone` from GitHub (the source of truth).
     Code on the workstation is not authoritative.
  2. **Identity**:
     - GitHub login + 2FA (recovery codes stored offline).
     - Google Workspace login + 2FA (registrar / GCP auth).
     - Password-manager master password (memorized).
  3. **GCP access**: re-authenticate `gcloud auth login`. No production
     secrets live on the workstation by design — Secret Manager is the
     authoritative store.
  4. **Local secrets** (dev-only): a fresh `.env.local` with non-prod
     values; never restore from a backup of the compromised machine.
  5. **Toolchain**: Node 20, npm, gcloud SDK, Docker (optional).
- **Compromise path**: if the workstation is suspected compromised
  (not just lost), additionally:
  - Rotate every secret in Secret Manager (`PHI_ENCRYPTION_KEY` is the
    most sensitive — see §3.9 for the rotation constraint that makes
    this non-trivial).
  - Revoke GitHub PATs, GCP service-account keys, and SSH keys
    associated with the workstation.
  - Force logout of all users (`revokeAllUserTokens` per-user, or
    rotate `JWT_SECRET` to invalidate the entire session population at
    once).
- **Verification**: operator can run `npm run dev`, hit the dev
  backend, and authenticate.

### 3.8 Master encryption key compromise (key exposed, not lost)

- **Trigger**: `PHI_ENCRYPTION_KEY` is suspected exposed (logged
  accidentally, copied to a non-secret-manager location, leaked via a
  workstation breach).
- **Treat as a confirmed breach** — see
  [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md). Until
  a key-rotation runbook lands (deferred — [`RISK_ASSESSMENT.md` § 6.3
  row 20](./RISK_ASSESSMENT.md#63-beta-window)), the rotation procedure
  is non-trivial because every PHI ciphertext was derived from the
  compromised key. Rotation requires re-encrypting every PHI column
  with a new key — a planned future capability, not yet implemented.
- **Interim mitigation**: place the application into emergency
  read-only mode (§4.1) while the operator decides whether to:
  1. Continue operating on the compromised key while accepting risk
     (only if disclosure scope is bounded), or
  2. Hard-stop PHI access until rotation tooling is built.

### 3.9 Master encryption key loss (catastrophic)

- **Trigger**: every version of `PHI_ENCRYPTION_KEY` is destroyed,
  unrecoverable, or otherwise irretrievable.
- **Honest acknowledgment**: **all encrypted PHI in the database
  becomes mathematically unrecoverable.** AES-256-GCM with no key is
  not "hard to decrypt" — it is undecryptable. PostgreSQL backups,
  GCS object versions, and audit logs all carry the same ciphertext
  and remain unreadable.
- **Recovery**:
  1. Identify which Secret Manager versions still exist:
     ```bash
     gcloud secrets versions list phi-encryption-key \
       --project=ownmyhealth-prod
     ```
     If any version has `STATE=ENABLED` or `STATE=DISABLED` (not
     `DESTROYED`), it can be re-enabled and re-mounted on Cloud Run.
  2. Check the offline paper backup (§2.4) if one was created.
  3. If neither (1) nor (2) yields the key bytes:
     - Treat as a **breach of availability** (HIPAA breach by
       impairment of access — see [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md)).
     - Notify every affected user, HHS OCR (within 60 days), and the
       press (if > 500 users — not applicable pre-beta).
     - Drop encrypted PHI columns; preserve non-PHI metadata
       (`createdAt`, `userId`) for forensic reconstruction.
- **Why this scenario gets its own section**: documenting it honestly
  is itself a compliance-relevant control. Pretending recovery is
  possible would be worse than acknowledging that key custody is the
  single hardest-to-rebuild element of the system.

### 3.10 Operator unavailability

- **Trigger**: founder is unreachable for > 72 hours due to illness,
  accident, or incapacity.
- **RTO target**: N/A (this is a structural risk, not a
  technical-recovery scenario).
- **Mitigation**:
  - **Pre-beta**: no live patient PHI is at risk; the system can
    remain idle without harm.
  - **Post-beta**: a designated trusted contact `[CONFIRM — name +
    relationship]` should hold sealed credentials sufficient to:
    1. Place the app in maintenance mode (§4.2).
    2. Notify users that the service is paused.
    Full operator handoff (e.g., to a hired second engineer) is a
    business-continuity item, not a HIPAA-required control.

### 3.11 Complete infrastructure compromise

- **Trigger**: catastrophic compromise — GCP project takeover, full
  CI/CD compromise, or evidence that backups are also poisoned.
- **RTO target**: ≥ 24 hours; this is a rebuild, not a restore.
- **Procedure**:
  1. **Isolate**: place the prod Cloud Run service into "no traffic"
     mode (`update-traffic --to-revisions=...=0`). Do not delete —
     forensic evidence may live in revision logs.
  2. **Notify**: trigger
     [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md);
     this is a confirmed breach.
  3. **Rebuild from source**:
     - New GCP project (`ownmyhealth-prod-2`).
     - Re-provision Cloud SQL, GCS bucket, Secret Manager secrets
       from scratch — **never copy secrets across from the
       compromised project.**
     - Re-deploy Cloud Run from `main` via CI.
     - Restore a known-good Cloud SQL backup taken **before** the
       suspected compromise window — verify the backup itself is
       clean.
     - Restore the master encryption key from the offline paper backup
       (§2.4) into the new project's Secret Manager.
  4. **Cutover**: once the new project is verified healthy, swap DNS
     `api.ownmyhealth.io` to the new Cloud Run URL.
  5. **Forensics**: leave the compromised project read-only for
     auditor / law-enforcement review. Do not delete it for at least
     `[CONFIRM — recommend 6 years per §164.316(b)(2) retention]`.

---

## 4. Emergency Mode Operation Plan — §164.308(a)(7)(ii)(C)

These modes preserve the **confidentiality and integrity** of PHI
during an availability incident.

### 4.1 Read-only mode (writes disabled, reads preserved)

**When to use**: suspected compromise that may be writing malicious
data; restore in progress where a forked timeline must be prevented;
DB integrity uncertain.

**Mechanism**: a feature flag `READ_ONLY_MODE` checked at the
controller layer. **Status**: not yet implemented. `[CONFIRM —
this is a pre-beta gap; track as remediation item below.]`

**Stop-gap until implemented**: revoke `INSERT` / `UPDATE` / `DELETE`
privileges from `omh_app` directly:

```bash
gcloud sql connect ownmyhealth-prod-db \
  --user=postgres --project=ownmyhealth-prod
```
```sql
-- Inside psql:
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM omh_app;
-- (To restore: GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omh_app;)
```

The app will return 500 errors on writes — controllers do not currently
distinguish "readonly" from "broken." Acceptable for short
emergency windows; not acceptable as a long-term mode.

**Exit**: re-grant the privileges (above).

### 4.2 Maintenance page

**When to use**: extended outage where the app cannot serve any
traffic, and showing a meaningful message is better than a 502.

**Mechanism**: serve a static HTML page from the existing frontend
GCS bucket via a Cloud Load Balancer URL map override.
`[CONFIRM — load balancer URL map exists?]`

**Implementation status**: not yet wired. Stop-gap: edit the GCS
frontend bucket's `index.html` to a single-page maintenance notice and
clear the CDN cache. Restore by re-running the frontend deploy step in
`.github/workflows/deploy.yml`.

### 4.3 Manual PHI access (when the app is fully down)

**When to use**: the user requests their data, the app is down, and
the operator must answer the request honoring the user's right of
access (§164.524). This is a last-resort path — it bypasses the
audit log and RBAC, so it is used **only for the affected user,
documented in writing, and recorded in the audit log retroactively**
once the system is back up.

**Prerequisites**:
1. PostgreSQL access (psql or Cloud SQL Studio).
2. The master encryption key (`PHI_ENCRYPTION_KEY`).
3. The user's encryption salt (`UserEncryptionKey.encryptedSalt`,
   itself encrypted with the master key).
4. A short Node.js script that loads
   `backend/src/services/encryption.ts` and `userEncryption.ts` and
   calls `decrypt(ciphertext, userSalt)`.

**Skeleton script** (operator runs locally with prod env loaded):

```typescript
// scripts/manual-decrypt.ts — emergency PHI access only
import { decrypt } from '../backend/src/services/encryption';
import { getUserEncryptionSalt } from '../backend/src/services/userEncryption';
import { prisma } from '../backend/src/services/database';

const userId = process.argv[2];
if (!userId) throw new Error('usage: manual-decrypt <userId>');

const salt = await getUserEncryptionSalt(userId);
const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

console.log({
  firstName: user.firstNameEncrypted ? decrypt(user.firstNameEncrypted, salt) : null,
  lastName:  user.lastNameEncrypted  ? decrypt(user.lastNameEncrypted, salt)  : null,
  // ... other PHI columns as needed
});
```

**After-action**: every manual decryption is recorded in `audit_logs`
with `actorType='ADMIN'`, `action='EMERGENCY_ACCESS'`,
`reason=<incident-id>` once the system is restored. The script must
**not** be run on a developer workstation that has not been swept; if
in doubt, run from a fresh Cloud Shell session.

### 4.4 Communication plan

**Status page**: `[CONFIRM — recommend status.ownmyhealth.io via
Statuspage.io, BetterStack, or a static GCS-hosted page. Not yet
provisioned.]`

**Email**: SendGrid with a pre-staged "service interruption" template
to all active users. `[CONFIRM template exists]` Pre-beta cohort is
small enough that direct individual email is feasible.

**Operator-controlled fallbacks** (when SendGrid is also down):
- A static notice on the marketing site (root domain).
- A Twitter / Mastodon post `[CONFIRM social handles]`.
- An update to the GitHub repository README.

**Update cadence during an active incident**: every 60 minutes for
the first 4 hours; every 4 hours thereafter. Final update on
resolution with a link to the postmortem.

---

## 5. Testing and Revision Procedures — §164.308(a)(7)(ii)(D)

### 5.1 Drill schedule

| Drill | Cadence | Owner |
|---|---|---|
| Backup-restore drill (§6) | Quarterly | Founder/operator |
| DNS-failover walkthrough | Annually | Founder/operator |
| Manual-decryption rehearsal (§4.3) | Annually | Founder/operator |
| Tabletop "complete infrastructure compromise" (§3.11) | Annually | Founder/operator |
| Plan revision review | Annually + post-incident + post-drill | Founder/operator |

**Next scheduled drill**: 2026-07-25 (set on plan creation; see header).

### 5.2 Success criteria for the backup-restore drill

The drill (executed via §6) is **successful** when all of the
following hold:

1. The recovery instance comes up `RUNNABLE` within the RTO target
   (4 hours).
2. `SELECT count(*) FROM users` on the recovery instance equals the
   expected count from the source backup ± 0.
3. `SELECT max(created_at) FROM audit_logs` on the recovery instance
   is within the RPO target (1 hour for PITR-restored, ≤ 24 h for
   backup-only).
4. A sample PHI column (e.g., a known biomarker `valueEncrypted`)
   decrypts cleanly using the production master key.
5. The startup assertion `assertNoBypassRLS()` does not fire when a
   backend instance is pointed at the recovery DB (i.e., the restored
   role still has `NOBYPASSRLS`).
6. The audit-log immutability invariant holds (no row from before the
   restore time has changed `previousValueEncrypted` or
   `newValueEncrypted`).
7. The recovery instance is destroyed within 24 hours of drill
   completion to avoid duplicate-PHI sprawl.

### 5.3 Drill log template

Append to `[CONFIRM — recommend a `drills/` subfolder of this
document set, or this section as an appendix table]` after each drill:

```yaml
- date: 2026-07-25
  tester: <operator name>
  scenario: PITR restore to recovery instance, T-2h
  outcome: PASS | PARTIAL | FAIL
  rto-actual: 38m
  rpo-actual: 12m
  findings:
    - "RPO better than 1h target — PITR working as expected"
    - "Sample biomarker decrypted cleanly (user <UUID>, biomarker <UUID>)"
    - "audit_logs row count delta vs source: -3 rows (within RPO window — expected)"
  follow-ups:
    - "Update §1.4 RTO target from 4h → 1h based on observed performance"
  recovery-instance-destroyed: 2026-07-25T18:42Z
  signed-off-by: <operator name>
```

### 5.4 Post-drill revision

After every drill, the operator:

1. Updates §1.4 RPO/RTO targets if the drill demonstrates capability
   different from the documented targets.
2. Updates §6 runbook commands if any step required improvisation —
   the runbook is supposed to be runnable as-written.
3. Updates `[CONFIRM]` markers that were resolved during the drill.
4. Bumps the `last-drill` and `next-drill` fields in this document's
   front-matter.

---

## 6. Restore Drill Runbook

> Concrete step-by-step that an operator can follow **today**. Every
> step has a copy-pasteable command. Unknowns are flagged `[CONFIRM]`.
>
> **Estimated total time**: 90-120 minutes.
>
> **Pre-requisites**:
> - `gcloud` CLI authenticated against `ownmyhealth-prod`
> - `psql` (PostgreSQL client) installed locally
> - Node 20 + repo cloned locally
> - The production master key in your local environment as
>   `PHI_ENCRYPTION_KEY` (load from Secret Manager — see step 5)

### Step 1 — Identify a target backup

```bash
# List recent backups; pick the most recent SUCCESSFUL one
gcloud sql backups list \
  --instance=ownmyhealth-prod-db \
  --project=ownmyhealth-prod \
  --filter="status=SUCCESSFUL" \
  --limit=5
# Note the backup ID for step 2 (column: ID)
BACKUP_ID=<from output>
```

### Step 2 — Create a scratch recovery instance from the backup

```bash
DRILL_DATE=$(date +%Y%m%d)
SCRATCH_INSTANCE=ownmyhealth-drill-${DRILL_DATE}

gcloud sql backups restore ${BACKUP_ID} \
  --project=ownmyhealth-prod \
  --restore-instance=${SCRATCH_INSTANCE} \
  --backup-instance=ownmyhealth-prod-db
```

This provisions a brand-new Cloud SQL instance pre-populated from the
backup. **Tier**: defaults match the source instance unless overridden;
for a drill, downscale via the Console post-creation if cost matters.

### Step 3 — Wait for the instance to become RUNNABLE

```bash
until [ "$(gcloud sql instances describe ${SCRATCH_INSTANCE} \
  --project=ownmyhealth-prod \
  --format='value(state)')" = "RUNNABLE" ]; do
  echo "waiting..."; sleep 30
done
echo "instance ${SCRATCH_INSTANCE} is RUNNABLE"
```

### Step 4 — Connect a local backend to the scratch instance

The simplest path is the Cloud SQL Auth Proxy:

```bash
# In a separate terminal — keep this running:
cloud-sql-proxy --port=5433 \
  ownmyhealth-prod:us-central1:${SCRATCH_INSTANCE}
```

Point a local backend at port 5433:

```bash
# In the repo root:
export DATABASE_URL='postgresql://omh_app:<PASSWORD>@127.0.0.1:5433/ownmyhealth?schema=public'
# Load the prod master key (see WARNING below)
export PHI_ENCRYPTION_KEY="$(gcloud secrets versions access latest \
  --secret=phi-encryption-key --project=ownmyhealth-prod)"
export AUDIT_LOG_SALT="$(gcloud secrets versions access latest \
  --secret=audit-log-salt --project=ownmyhealth-prod)"
```

> **WARNING**: this loads the production master key into your shell.
> Run on a workstation you trust, in a session you will close at the
> end of the drill. Do not commit any file that captures these
> environment variables. Prefer Cloud Shell over your laptop if the
> laptop's posture is uncertain.

### Step 5 — Verify row counts match production

```bash
psql "$DATABASE_URL" -c 'SELECT count(*) AS users          FROM users;'
psql "$DATABASE_URL" -c 'SELECT count(*) AS biomarkers     FROM biomarkers;'
psql "$DATABASE_URL" -c 'SELECT count(*) AS audit_logs     FROM audit_logs;'
psql "$DATABASE_URL" -c "SELECT max(created_at) AS newest_audit FROM audit_logs;"
```

Compare against the production figures (last known good baseline).
For a drill, the deltas should be: 0 if backup is from < 1 minute
ago; up to (backup-age) of new audit-log rows if backup is older.

### Step 6 — Decrypt a sample PHI record

```bash
# Pick a known test user (do not use real-user PHI for drills if possible)
SAMPLE_USER_ID=$(psql "$DATABASE_URL" -At -c \
  "SELECT id FROM users WHERE email LIKE '%@drill.test' LIMIT 1;")

# If no drill user exists, fall back to a deterministic check:
# decrypt the operator's own user record only.

cat > /tmp/drill-decrypt.ts <<'TS'
import { decrypt } from './backend/src/services/encryption';
import { getUserEncryptionSalt } from './backend/src/services/userEncryption';
import { prisma } from './backend/src/services/database';

const userId = process.argv[2];
const salt = await getUserEncryptionSalt(userId);
const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

const out = {
  email: user.email, // not encrypted; identifier
  firstName: user.firstNameEncrypted ? decrypt(user.firstNameEncrypted, salt) : null,
};
console.log(JSON.stringify(out, null, 2));
process.exit(0);
TS

npx tsx /tmp/drill-decrypt.ts "$SAMPLE_USER_ID"
```

**Pass criterion**: the script prints a plaintext name (or `null` if
the user has no first name on file). Any decryption error — auth-tag
mismatch, key-derivation failure — is a **drill failure** that
requires escalation: the production master key may not match what was
used to encrypt the backed-up rows. (Most common cause: the backup
predates a key rotation. Until rotation tooling exists, this should
not happen — flag as a real incident.)

### Step 7 — Verify audit-log integrity

```bash
psql "$DATABASE_URL" <<'SQL'
-- Spot-check that the most recent audit row decrypts and its session
-- chain is intact (encrypted values are non-NULL where the column is
-- supposed to be populated).
SELECT
  id, created_at, action, resource_type, resource_id,
  (previous_value_encrypted IS NOT NULL OR action = 'CREATE') AS prev_ok,
  (new_value_encrypted IS NOT NULL OR action IN ('READ','DELETE')) AS new_ok
FROM audit_logs
ORDER BY created_at DESC
LIMIT 10;
SQL
```

**Pass criterion**: 10 rows returned, no NULL `prev_ok` or `new_ok`
on rows where the action requires a value snapshot.

### Step 8 — Destroy the scratch instance

```bash
# Terminate the local proxy first (Ctrl-C in the proxy terminal)
gcloud sql instances delete ${SCRATCH_INSTANCE} \
  --project=ownmyhealth-prod \
  --quiet
```

**Verify deletion**:

```bash
gcloud sql instances list --project=ownmyhealth-prod \
  --filter="name=${SCRATCH_INSTANCE}"
# Expected: no rows
```

### Step 9 — Log the drill outcome

Append a YAML entry to §5.3 of this document with:

- date, tester, scenario, outcome
- observed RTO (steps 1–7 elapsed time)
- observed RPO (gap between newest audit-log row and the moment
  before drill started)
- findings (what surprised you)
- follow-ups (what to fix or document)
- timestamp the recovery instance was destroyed
- signed-off-by

Update the document front-matter `last-drill:` and bump
`next-drill:` by 90 days.

### Step 10 — Clean up local environment

```bash
unset DATABASE_URL PHI_ENCRYPTION_KEY AUDIT_LOG_SALT
rm /tmp/drill-decrypt.ts
# Close the shell session entirely if production secrets were loaded
```

---

## 7. Document Control

| Field | Value |
|---|---|
| Document | CONTINGENCY_PLAN.md |
| Version | 1.0 |
| Status | Draft (initial) |
| Generated | 2026-04-25 |
| Author | OwnMyHealth founder/operator `[CONFIRM name + role]` |
| Reviewer | `[CONFIRM external HIPAA reviewer if engaged]` |
| Approved by | `[CONFIRM]` |
| Last reviewed | 2026-04-25 (initial) |
| Next scheduled review | 2027-04-25 |
| Last drill | never |
| Next drill | 2026-07-25 |
| HIPAA citation satisfied | §164.308(a)(7) Contingency Plan, all four implementation specifications |
| Source-of-truth references | [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md), [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md), [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`RUNBOOK.md`](./RUNBOOK.md) |

### 7.1 Pre-beta gaps acknowledged in this plan

| # | Gap | Section |
|---|---|---|
| 1 | Read-only mode not implemented as a feature flag | §4.1 |
| 2 | Maintenance page not wired via load balancer | §4.2 |
| 3 | Status page not provisioned | §4.4 |
| 4 | Cloud Run is single-region (no multi-region failover) | §3.1 |
| 5 | Secondary operator / emergency contact not designated | §3.10 |
| 6 | Master-key rotation tooling not implemented | §3.8 |
| 7 | Master-key offline paper backup not yet created | §2.4 |
| 8 | First restore drill not yet performed | §5.1 |

These are the items that turn this plan from "documented" to
"exercised." Item 8 (the first drill) is the single highest-value
follow-up: it is what closes [`RISK_ASSESSMENT.md` T-07](./RISK_ASSESSMENT.md#37-t-07--ransomware--data-destruction)
from High residual risk down to Medium.

---

## Items requiring confirmation

The following claims and parameters are unverified from inside the
repo and need operator confirmation before this plan can move out of
draft:

1. Cloud SQL automated backup retention window (recommend ≥ 30 days)
2. Cloud SQL Point-in-Time Recovery is enabled on the prod instance
3. Cloud SQL high-availability (regional) is configured on prod
4. GCS object versioning is enabled on the user-files bucket
5. GCS soft-delete retention window
6. Master-key Secret Manager secret name (assumed `phi-encryption-key`)
7. Audit-log salt Secret Manager secret name (assumed `audit-log-salt`)
8. Master-key offline paper backup procedure decision
9. DNS registrar identity, login URL, TTLs, and recovery codes location
10. Domain auto-renewal status
11. Uptime check / Cloud Monitoring alerting configuration
12. Multi-region Cloud Run deployment decision (currently single-region)
13. Status-page provider / URL (or decision to host static page from GCS)
14. Operator emergency-contact / sealed-credential designation
15. Author + reviewer + approver names for the formal record
