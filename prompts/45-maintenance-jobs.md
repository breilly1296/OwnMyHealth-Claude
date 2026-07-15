---
tags:
  - security
  - operations
  - phi
  - medium
type: prompt
priority: 3
updated: 2026-06-16
severity: medium
---

# Maintenance Jobs (One-Shot PHI Backfills / Data Migrations) Review

> Follow the [review protocol](./_review-protocol.md).
> These jobs touch encrypted PHI — see the [PHI inventory](./_phi-inventory.md) for the exact columns each one rewrites.
> Use [Claude Code tools](./_verification-tools.md).

## Why this prompt exists
These are the one-off data-migration / PHI-backfill scripts under `backend/src/maintenance/`. They are NOT covered by any other prompt: they are not routes, not controllers, not services-under-test in the normal request path. They are the highest-blast-radius code in the repo because they run **in production**, **as the runtime service account**, **with the live `PHI_ENCRYPTION_KEY`**, and they **bulk-mutate PHI across every user**. A SQL-only migration can't do this work (it can't derive per-user keys), so it was pushed into a Node job — which means the usual migration-review discipline does not automatically apply. Review them as you would a destructive prod DBA script.

## Files to Review
- `backend/src/maintenance/backfillGoalValues.ts` — entrypoint (M4): re-encrypt legacy plaintext goal values into their encrypted twins. `--apply` gate at `:49`; per-user `withRLSContext` enumerate at `:57-63`; per-user `withRLSTransaction` apply at `:108-117`; `main().catch(... process.exit(1))` at `:131-139`.
- `backend/src/maintenance/backfillUserFileNames.ts` — entrypoint (L24): re-encrypt legacy plaintext `user_files.original_filename` into `originalFilenameEncrypted`, then null the plaintext. `--apply` at `:38`; pending-row query (`originalFilename: { not: null }, originalFilenameEncrypted: null`) at `:65-70`; encrypt+null update at `:80-91`.
- `backend/src/maintenance/consolidateBiomarkerSeries.ts` — entrypoint: fold pre-existing duplicate single-point `Biomarker` rows into one time series per `(name, unit)`. `--apply` at `:38`; per-user load at `:55-71`; apply transaction with explicit `{ timeout: 60_000, maxWait: 15_000 }` at `:102-112`.
- `backend/src/services/goalValueBackfill.ts` — pure/apply split. `planGoalValueBackfill` (pure decision) `:59-85`; `backfillValue` idempotency rule (plaintext set AND encrypted twin null) `:52-56`; `applyGoalValueBackfill` (writes ciphertext + nulls plaintext twin) `:100-136`.
- `backend/src/services/biomarkerConsolidation.ts` — `seriesKey` NUL-joined normalized identity `:62-64`; `planUserConsolidation` (pure, anchor = latest, deterministic tie-break) `:71-122`; `applyUserConsolidation` (reparent history → add anchor history → delete duplicates, order is load-bearing) `:137-168`.
- `backend/src/services/biomarkerSeries.ts` — the forward-path fix these consolidations back-fill toward (NEW readings append to a series; `Biomarker` row = newest point, `BiomarkerHistory` = older points; header `:1-19`). The consolidation job must produce the same shape.
- `.github/workflows/maintenance.yml` — `ownmyhealth-maintenance` Cloud Run job runner. `workflow_dispatch` only, `task` choice + `apply` boolean (`default: false`) + `only_user` `:19-39`; `permissions: contents: read` `:41-42`; `concurrency` non-cancel `:44-48`; clones live service image/SA/env/secrets `:90-114`; dry-run banner `:121-132`; `--max-retries 0` + `--task-timeout 30m` `:137-146`; best-effort log echo `:151-169`.
- `backend/package.json` — `consolidate:biomarkers` `:18`, `backfill:goal-values` `:19`, `backfill:userfile-names` `:20` (all `tsx src/maintenance/...` — LOCAL-only; prod runs the compiled `dist/maintenance/*.js`).

## Architecture (ground truth)
- **Compiled, not scripted.** These live under `src/` (not `scripts/`) so `npm run build` emits `dist/maintenance/*.js`. The prod image has no `tsx` and does not copy `scripts/`, so it can only run the compiled form with plain `node` (see header comments in each entrypoint, e.g. `backfillGoalValues.ts:11-18`). `package.json` scripts are the LOCAL dev path (against `backend/.env`'s dev DB / dev key).
- **Nothing imports these modules.** The top-level `main()` runs only when the file is invoked directly — so adding them to the build cannot trigger a backfill on boot.
- **Run as a Cloud Run job, cloning the live service.** `maintenance.yml` reads the currently-serving backend revision (`gcloud run services describe`) and reuses its image, runtime SA, plain env, and Secret Manager mounts (`maintenance.yml:90-114`). This is the only way the job sees prod's exact `DATABASE_URL` + `PHI_ENCRYPTION_KEY`, so the ciphertext it writes is decryptable by the live service. The master key never leaves Secret Manager. Mirrors the `ownmyhealth-migrate` pattern in `deploy.yml`.
- **Per-user, per-key.** Each job enumerates users in admin (`withRLSContext(null, ...)`) context, then does the actual mutation **per user inside that user's RLS context/transaction**, encrypting with that user's salt (`getUserEncryptionSalt(userId)` + `getEncryptionService().encrypt(p, salt)`). One user's rows at a time; RLS authorizes each write.
- **Two-half design for testability.** `goalValueBackfill` and `biomarkerConsolidation` split a pure `plan*()` (no DB, no crypto) from an `apply*()` that executes the plan in a tx — so the decision logic is unit-tested without prod.

## Checklist

### 1. Dry-run-by-default + explicit `--apply` gate
- [ ] Every entrypoint defaults to DRY RUN: `const APPLY = process.argv.includes('--apply')` (`backfillGoalValues.ts:49`, `backfillUserFileNames.ts:38`, `consolidateBiomarkerSeries.ts:38`). No write happens unless `--apply` is present.
- [ ] DRY RUN actually performs NO writes — the `if (APPLY)` branch is the only place `tx.*.update` / `deleteMany` / `create` runs (goal `:108`, userfile `:77`, consolidate `:102`); the dry path only computes the plan and logs counts.
- [ ] The workflow's `apply` input is `type: boolean, default: false` (`maintenance.yml:30-34`) and is only translated into the `--apply` arg when literally `"true"` (`maintenance.yml:118`).
- [ ] An operator cannot accidentally apply: the workflow prints a loud `*** APPLY MODE — this WILL modify production data ***` vs `DRY RUN` banner before running (`maintenance.yml:121-132`).
- [ ] Both the entrypoint footer and the workflow tell the operator the dry→apply path explicitly (`...Re-run with --apply...` at `backfillGoalValues.ts:126`, `backfillUserFileNames.ts:99`, `consolidateBiomarkerSeries.ts:124`).

### 2. Prod-PHI + live-key blast radius (who can trigger, least privilege, audit of runs)
- [ ] Trigger is `workflow_dispatch` ONLY (`maintenance.yml:20`) — never on push/PR/schedule. So only an actor with GitHub Actions run-workflow permission on the repo can launch it (gate this with branch/environment protections; confirm who that is).
- [ ] Workflow token is least-privilege: `permissions: contents: read` (`maintenance.yml:41-42`) — no write/packages/id-token beyond what auth needs.
- [ ] The only secret consumed is `secrets.GCP_SA_KEY`, passed to `google-github-actions/auth` (`maintenance.yml:62-65`); it is never echoed.
- [ ] The job runs as the **service's** runtime SA, not the deploy SA: `RUNTIME_SA` is read from the live service and passed via `--service-account` (`maintenance.yml:94, 113-114, 141`). It inherits exactly the service's prod data access — no broader.
- [ ] Live `PHI_ENCRYPTION_KEY` reaches the job only as a Secret Manager mount cloned from the service (`SECRET_PAIRS` → `--set-secrets`, `maintenance.yml:103-112`); the plaintext key is never materialized in the workflow.
- [ ] Concurrency guard prevents a maintenance run racing another maintenance run or a deploy on the shared job/DB (`concurrency: ... cancel-in-progress: false`, `maintenance.yml:44-48`).
- [ ] Run is observable after the fact: the `Print job output (counts)` step (`maintenance.yml:151-169`) and the Cloud Run job execution record give a per-run trail of what was applied. (Note: these jobs do NOT write `AuditLog` rows for the bulk rewrites — confirm whether that's acceptable for a one-time migration, or whether a summary audit entry is warranted. See Acceptance Q4.)

### 3. Idempotency / safe re-run
- [ ] Goal backfill is idempotent: `backfillValue` returns non-null only when plaintext is set AND the encrypted twin is null (`goalValueBackfill.ts:52-56`); a second run finds nothing.
- [ ] Userfile backfill is idempotent: the pending query filters `originalFilename: { not: null }, originalFilenameEncrypted: null` (`backfillUserFileNames.ts:67`); once a row is encrypted+nulled it no longer matches.
- [ ] Consolidation is idempotent: after a run each series is a single row, so `planUserConsolidation` finds no group of size > 1 (`biomarkerConsolidation.ts:84` skips `group.length < 2`) and the run is a no-op.
- [ ] Re-run is also order-stable: consolidation anchor selection is deterministic (latest `measurementDate`, then newer `createdAt`, then lexically-greater `id` — `biomarkerConsolidation.ts:88-94`), so a re-run or a test picks the same anchor.
- [ ] `--max-retries 0` (`maintenance.yml:144`) is intentional: a data migration is NOT safely auto-retried by a dumb re-run mid-failure; a human inspects partial state first (re-running is safe because of idempotency, but only after inspection).

### 4. Encrypt-twin pattern done correctly under per-user RLS UPDATE policies
- [ ] Each backfill writes ciphertext AND nulls the plaintext twin in the same update — the exact end state the live write path now produces (goal: `applyGoalValueBackfill` sets `*Encrypted` + `null`s the Decimal twin, `goalValueBackfill.ts:108-130`; userfile: `originalFilenameEncrypted` set + `originalFilename: null`, `backfillUserFileNames.ts:84-88`).
- [ ] Ciphertext is produced with the **correct per-user key**: salt from `getUserEncryptionSalt(userId)` then `encryption.encrypt(plaintext, salt)`, all inside that user's context (goal `backfillGoalValues.ts:109-114`; userfile `backfillUserFileNames.ts:78-85`). Encrypting with the wrong (e.g. dev) key would silently corrupt prod PHI — this is exactly why the job clones prod's key (see Architecture).
- [ ] The UPDATE is authorized by RLS, not bypassed: every write runs inside `withRLSContext(userId, ...)` / `withRLSTransaction(userId, ...)`, so the per-user `UPDATE` policy (`user_id = current_user_id()`) admits it. The job does NOT use an admin/bypass context for the mutation (admin/null context is used only to *list* user ids).
- [ ] Consolidation moves ciphertext as-is and never decrypts — all of one user's rows share that user's salt, so reparenting/copying `valueEncrypted` is valid (`consolidateBiomarkerSeries.ts:17-19`, `biomarkerConsolidation.ts:18-21`). Confirm no decrypt call sneaks into the consolidation path.
- [ ] The plaintext twins these jobs null are the ones deliberately excluded from `PHI_FIELDS` (see [PHI inventory](./_phi-inventory.md)): `HealthGoal.targetValue/currentValue/startValue`, `GoalProgressHistory.value`, `UserFile.originalFilename`. Confirm none of these reappear in `PHI_FIELDS` or get re-populated by a write path.

### 5. Operational state — the L24 userfile-filename re-encrypt backfill is NOT yet run in prod
- [ ] KNOWN PENDING OP: the L24 backfill (`backfill-userfile-filenames`) has NOT been executed against prod. Legacy `user_files.original_filename` rows are still plaintext; only NEW uploads encrypt. Reads fall back to the plaintext twin, so nothing is broken — but plaintext PHI persists at rest until the backfill runs. (The goal-value M4 backfill and the biomarker consolidation status should be confirmed separately — verify each before assuming it ran.)
- [ ] Document/confirm the full run+verify+drop-column sequence for L24:
  1. Deploy the branch that emits `dist/maintenance/backfillUserFileNames.js` into the serving image (the job clones the live image — it can't run an entrypoint the live image lacks).
  2. Run `maintenance.yml` with `task=backfill-userfile-filenames`, `apply=false` (DRY RUN) — read the counts.
  3. Re-run with `apply=true` — confirm `APPLIED — N user(s), M file row(s) encrypted`.
  4. Re-run DRY RUN once more — must report `0 ... to encrypt` (idempotency proof that all legacy rows are now encrypted+nulled).
  5. Spot-verify a real round-trip: a previously-legacy file's `originalFilenameEncrypted` decrypts to the right name via `decryptOriginalFilename` (per the L24 work in [encryption](./02-encryption.md)).
  6. ONLY THEN land the follow-up migration that DROPs the now-empty plaintext `user_files.original_filename` column. Dropping before the backfill completes destroys un-migrated PHI.
- [ ] Same gated sequence applies to any backfill whose companion migration later drops a plaintext column (mirror of the M6 `20260615_drop_legacy_audit_metadata` lifecycle — but note M6 dropped its column WITHOUT a backfill because `audit_logs` is immutable-by-RLS; do not copy that shortcut to the userfile/goal columns, which ARE backfillable).

### 6. No PHI in job logs
- [ ] Goal backfill logs counts only — user id + column/row counts, never a value (`backfillGoalValues.ts:88, 103-106, 116, 121-124`); header states "Logs counts only — never PHI values" (`:22-23`).
- [ ] Userfile backfill logs counts only — never a filename (`backfillUserFileNames.ts:58, 75, 95-97`); header states "Logs COUNTS only — never a filename (PHI)" (`:21-22`).
- [ ] Consolidation logs counts plus metric **name/unit** only — never a value; ciphertext is moved without decryption (`consolidateBiomarkerSeries.ts:91-100, 119-122`; header `:17-19`). Confirm `name`/`unit` are acceptable to log here (they are plaintext columns, not PHI — see `biomarkerSeries.ts:6-8`).
- [ ] The workflow log-echo step pulls only `textPayload` console lines (`maintenance.yml:166-169`) — i.e. the count summaries above; confirm no entrypoint ever `console.log`s a decrypted value, a ciphertext blob, or `f.originalFilename`.
- [ ] Failure logs are scrubbed: each `main().catch` logs `err.message` only, not the full error object/stack with possible row data (`backfillGoalValues.ts:132`, `backfillUserFileNames.ts:105`, `consolidateBiomarkerSeries.ts:130`).

### 7. Failure / partial-run handling
- [ ] Any failure exits non-zero: `main().catch(... process.exit(1))` in all three entrypoints (`backfillGoalValues.ts:131-139`, `backfillUserFileNames.ts:104-112`, `consolidateBiomarkerSeries.ts:129-137`), and `gcloud run jobs execute ... --wait` (`maintenance.yml:148-149`) makes a nonzero script exit fail the workflow step.
- [ ] Per-user atomicity bounds the blast radius of a mid-run crash: each user's mutation is a single `withRLSTransaction` (goal `:113-115`, consolidate `:103-107`) OR a single per-user `withRLSContext` write block (userfile `:80-90`). A crash leaves already-processed users fully done and not-yet-processed users untouched — and re-running is safe because of idempotency (§3). Confirm the userfile per-user block is genuinely all-or-nothing per user (it is a sequence of single-row updates inside one `withRLSContext`; verify whether a mid-user crash can leave one user partially migrated, and that §3 idempotency cleans that up on re-run).
- [ ] Consolidation's apply order is crash-safe-correct: reparent existing history BEFORE deleting the duplicate (whose FK cascade would otherwise drop those history rows) — `biomarkerConsolidation.ts:131-165`. A partial transaction rolls back; it does not leave orphaned/lost history.
- [ ] The consolidation apply transaction sets an explicit `{ timeout: 60_000, maxWait: 15_000 }` (`consolidateBiomarkerSeries.ts:104-107`) because a heavy user's merge can exceed Prisma's default interactive-tx timeout; the goal backfill relies on the default deliberately (per-user goal+history set is small, comment at `backfillGoalValues.ts:111-112`). Confirm the largest real users fit inside these bounds.
- [ ] `--task-timeout 30m` + `--memory 512Mi` (`maintenance.yml:145-146`) are sized for a full-fleet run; confirm against current row counts so a legitimate run is not killed mid-flight (a kill is recoverable via re-run, but avoidable).

## Required artifacts
For each maintenance job reviewed, produce:
- A one-line statement of which PHI columns it rewrites and which plaintext twin (if any) it nulls, cross-referenced to the [PHI inventory](./_phi-inventory.md).
- The exact dry-run → apply → verify → (optional drop-column) sequence for that job, with the workflow inputs to use.
- The idempotency proof: the precise condition under which a row is skipped on re-run (file:line).
- The blast-radius statement: who can trigger it, which SA/key it runs with, and what a worst-case partial run leaves behind.
- A note on whether the run is auditable (job execution record + count logs) and whether an `AuditLog` summary entry is warranted.

## Acceptance questions
1. Has each of the three jobs run in prod yet? Specifically: the L24 `backfill-userfile-filenames` is documented as NOT yet run — confirm its current state, and the state of the M4 goal-value backfill and the biomarker consolidation.
2. After the L24 backfill is applied and verified, is the follow-up migration to DROP the plaintext `user_files.original_filename` column scheduled — and is it gated on a clean DRY-RUN re-run (0 rows pending)?
3. Could the job ever encrypt with the wrong key? Trace that `PHI_ENCRYPTION_KEY` reaching the job is always the live service's Secret Manager value, never a build-time/dev value (`maintenance.yml:103-112`).
4. Should the bulk PHI rewrites emit an `AuditLog` summary row (count of rows re-encrypted per user)? Today they do not — is the Cloud Run job execution record + count logs sufficient for HIPAA audit expectations, or is that a gap? (Cross-check [audit logging](./05-audit-logging.md).)
5. Who exactly can launch `maintenance.yml`? Is `workflow_dispatch` restricted by an environment/approval or branch protection, given it can mutate all prod PHI?
6. Do the largest real users fit inside the consolidation tx bounds (`60s` timeout, `15s` maxWait, `512Mi`, `30m` task timeout)? If not, what's the plan (per-user-batched run via `only_user`)?
7. Is there a rollback story if `apply=true` writes wrong ciphertext fleet-wide (e.g. a key/salt regression)? (Encrypted-twin writes null the plaintext — so a bad-key run is not trivially reversible. Confirm DB backup / PITR coverage before any `apply=true`.)

## No-TBD enforcement
Do not leave any answer as "TBD", "probably", or "should be fine". Every checkbox must resolve to a concrete file:line or a named GitHub/GCP setting. In particular, the operational-state items in §5 and Acceptance Q1 must be answered with the ACTUAL prod run status (job execution history in `ownmyhealth-prod`), not an assumption. If a job's prod run status cannot be confirmed, say so explicitly and treat the plaintext-still-present case as the operating reality.

## Cross-links
- [02-encryption](./02-encryption.md) — per-user key derivation, `getEncryptionService`, `decryptOriginalFilename`, the encrypt-twin pattern these jobs back-fill toward.
- [28-file-storage](./28-file-storage.md) — `UserFile` model, the L24 filename-encryption forward path the userfile backfill completes.
- [05-audit-logging](./05-audit-logging.md) — whether these bulk rewrites need audit coverage; the M6 audit-metadata lifecycle these jobs are a sibling to.
- [12-cicd-security](./12-cicd-security.md) — the `ownmyhealth-migrate` Cloud Run job pattern this mirrors, SHA-pinned actions, `secrets.GCP_SA_KEY` least-privilege.
- [15-runbook-doc](./15-runbook-doc.md) — operator runbook home for the dry-run→apply→verify→drop sequences.
- [_phi-inventory](./_phi-inventory.md) — canonical list of the encrypted columns + their (deliberately-excluded) plaintext twins these jobs rewrite/null.

## Verification
Confirm every citation in live code before relying on it:
```bash
# Entrypoints + the --apply gate (expect process.argv.includes('--apply') in each)
grep -rn "process.argv.includes('--apply')" backend/src/maintenance/

# Per-user RLS context / transaction is used for every mutation (no admin-context writes)
grep -rn "withRLSContext\|withRLSTransaction" backend/src/maintenance/

# Idempotency conditions
grep -rn "originalFilenameEncrypted: null\|backfillValue\|group.length < 2" \
  backend/src/maintenance/ backend/src/services/goalValueBackfill.ts backend/src/services/biomarkerConsolidation.ts

# Encrypt-twin write (ciphertext set + plaintext nulled)
grep -rn "Encrypted: encrypt\|originalFilename: null\|targetValue = null\|: null" \
  backend/src/services/goalValueBackfill.ts backend/src/maintenance/backfillUserFileNames.ts

# Logs are counts-only — should find NO decrypt() / value logging in maintenance
grep -rn "decrypt\|console.log" backend/src/maintenance/

# Workflow: dispatch-only, dry-run default, least-priv token, clones service SA/secrets
grep -rn "workflow_dispatch\|default: false\|permissions:\|contents: read\|service-account\|set-secrets\|max-retries 0" \
  .github/workflows/maintenance.yml

# Local npm scripts (tsx — dev only; prod runs dist/maintenance/*.js)
grep -rn "consolidate:biomarkers\|backfill:goal-values\|backfill:userfile-names" backend/package.json

# Confirm the prod run status of the L24 backfill (job execution history)
gcloud run jobs executions list --job ownmyhealth-maintenance \
  --region us-central1 --project ownmyhealth-prod --limit 20
```
