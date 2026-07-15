# Maintenance Jobs (One-Shot PHI Backfills / Data Migrations) Review — 2026-06-16

Scope: the one-off PHI-backfill / data-migration jobs under `backend/src/maintenance/`, their pure/apply service halves (`goalValueBackfill.ts`, `biomarkerConsolidation.ts`), and the `maintenance.yml` Cloud Run job runner. Reviewed at HEAD `fb2cd32`. Static review only — gcloud auth was unavailable in this environment, so prod run-status (Acceptance Q1) is answered from documented operating state, not a live job-execution query (see Unverifiable).

These are the highest-blast-radius scripts in the repo: they run in prod, as the runtime SA, with the live `PHI_ENCRYPTION_KEY`, and bulk-mutate PHI across every user. Findings are ranked by exploitability × blast radius.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |
| Info | 2 |

The jobs are well-built: dry-run-by-default, per-user RLS-authorized writes, correct encrypt-twin pattern with the live cloned key, idempotent re-run conditions, counts-only logging, and a crash-safe consolidation order. The two Medium findings are an **unguarded `Number()` coercion in the goal backfill** (a `NaN` plaintext silently corrupts a value and nulls its plaintext twin — irreversible) and the **absence of a deploy-environment / approval gate on the apply-all-PHI workflow** (only `permissions: contents: read`, no human approval before a fleet-wide `apply=true`). Lows cover the missing AuditLog summary for bulk PHI rewrites, no rollback/PITR precondition in the workflow, the userfile per-user block not being a single transaction, and a prompt-drift header label.

---

## Findings

### F-1 — Goal backfill coerces legacy plaintext with bare `Number()`; a `NaN`/malformed value is silently encrypted as `"NaN"` and its plaintext twin is irreversibly nulled — **Medium**
- **Location:** `backend/src/services/goalValueBackfill.ts:52-56` (`backfillValue`), consumed at `:66-76` and written at `:110-130`.
- **Observation:** `backfillValue` returns `Number(plaintext)` with no `Number.isFinite` / `isNaN` guard. The plaintext columns are `Decimal?` (`schema.prisma:455,462,468` for the goal columns; `:503` for `goal_progress_history.value`). Prisma returns `Decimal` as a `Decimal` object / string. Any value that coerces to `NaN` (a corrupted legacy row, an unexpected non-numeric residue, a `Decimal` edge case) becomes `NaN`, passes the `t !== null` test (`NaN !== null` is `true`), and is then written as `encrypt(String(NaN))` → ciphertext of the literal string `"NaN"`, while `applyGoalValueBackfill` nulls the plaintext twin in the same `update` (`:110-111`, `:118-119`, `:129`). There is no test for the malformed-input path (`goalValueBackfill.test.ts` covers only well-formed numbers; no `NaN`/`Number.isFinite` reference exists in the service).
- **Impact:** A single malformed plaintext value is converted to an undetectable `"NaN"` ciphertext and the original plaintext is destroyed in the same statement. Because the encrypt-twin write nulls the plaintext, this is **not recoverable** without a DB restore. Blast radius is bounded to the affected rows (not fleet-wide), but the corruption is silent — the run still logs success counts.
- **Fix:** In `backfillValue`, after `const n = Number(plaintext)`, return `Number.isFinite(n) ? n : null` and have the caller/entrypoint surface the skipped row count so an operator notices un-backfilled rows instead of silently writing `"NaN"`. Add a `NaN`/non-finite unit test alongside the existing idempotency tests. (The userfile backfill is not exposed to this — it encrypts the raw string, no numeric coercion; consolidation moves ciphertext as-is, no coercion.)
- **Evidence:**
  ```ts
  function backfillValue(plaintext: unknown, encrypted: string | null): number | null {
    if (encrypted) return null;
    if (plaintext === null || plaintext === undefined) return null;
    return Number(plaintext);   // no isFinite guard → NaN flows through
  }
  ```
  ```ts
  data.targetValueEncrypted = encrypt(String(op.goalColumns.target)); // String(NaN) === "NaN"
  data.targetValue = null;                                            // plaintext destroyed
  ```

### F-2 — `maintenance.yml` has no `environment:`/approval gate; any actor with run-workflow permission can trigger a fleet-wide `apply=true` PHI rewrite with no second human — **Medium**
- **Location:** `.github/workflows/maintenance.yml:19-39` (trigger + inputs), `:41-42` (permissions), absence of any `environment:` key on the `run-maintenance` job (`:57-60`).
- **Observation:** The trigger is correctly `workflow_dispatch`-only with `apply` defaulting to `false` (`:30-34`), and the token is least-privilege (`permissions: contents: read`, `:41-42`). But the job declares no `environment:` and therefore inherits no GitHub deployment-protection rule (required reviewers / wait timer). So a single actor with Actions run-workflow permission can select `task=backfill-goal-values`, `apply=true`, `only_user=<blank>` and immediately mutate PHI for **every user**, with no approval step. deploy.yml shows the same repo has no environment gates either (`grep environment: deploy.yml` → none), so this is a repo-wide posture, not a one-off. Acceptance Q5 ("Who exactly can launch it? Is it restricted by an environment/approval or branch protection?") resolves to: **only `workflow_dispatch` actor-permission gates it; there is no environment approval and no branch protection on the dispatch.** That cannot be confirmed further without repo settings access (see Unverifiable for the actor list).
- **Impact:** The single most destructive operation in the system (encrypt-twin writes that null plaintext fleet-wide — see F-1 and Acceptance Q7) has a one-click path with no four-eyes control. Combined with F-1, an operator who picks `apply=true` against a fleet that contains even one malformed goal value produces irreversible corruption with no approval checkpoint.
- **Fix:** Add `environment: production-maintenance` to the `run-maintenance` job and configure that GitHub Environment with required reviewers (and optionally a wait timer), so an `apply=true` dispatch pauses for a second approver. This is the standard GitHub control for exactly this risk and is independent of the SA/secret wiring.
- **Evidence:**
  ```yaml
  jobs:
    run-maintenance:
      runs-on: ubuntu-latest      # no `environment:` → no required-reviewer gate
      steps:
        - name: Google Auth
  ```
  ```yaml
  permissions:
    contents: read               # token is least-priv, but does not gate WHO can apply
  ```

### F-3 — Bulk PHI re-encryption emits no `AuditLog` summary row; the only trail is the ephemeral Cloud Run job log — **Low**
- **Location:** all three entrypoints (`backfillGoalValues.ts:84-129`, `backfillUserFileNames.ts:54-102`, `consolidateBiomarkerSeries.ts:73-127`) and their apply services (`goalValueBackfill.ts:100-136`, `biomarkerConsolidation.ts:137-168`) — none reference `auditLog` / `AuditLog` / `getAuditService`.
- **Observation:** These jobs rewrite PHI for every user but write zero `AuditLog` rows. The prompt's own checklist (§2 last item, Acceptance Q4) flags this for confirmation. Observability is limited to (a) the Cloud Run job execution record and (b) the count lines echoed by `maintenance.yml:151-169`, which are `console.log` `textPayload` lines subject to Cloud Logging retention — not the DB-enforced 7-year `audit_logs` retention these PHI mutations would otherwise fall under.
- **Impact:** A HIPAA auditor asking "who re-encrypted patient X's goal values and when" cannot answer from the durable audit trail; they must rely on transient CI/Cloud-Logging artifacts. For a one-time migration this is a defensible operational call, but it is a gap relative to the system's own "every PHI access is audit-logged, 7-year retention" invariant (CLAUDE.md Critical Rules; `_audit` cross-link).
- **Fix:** Have each apply path write a single per-user `AuditLog` summary row (action `MAINTENANCE_BACKFILL`, metadata = counts only, no values) inside the same per-user RLS context/transaction it already opens. Counts-only metadata keeps the no-PHI-in-logs property (§6) intact while giving a durable trail.
- **Evidence:** No `auditLog`/`AuditLog` token appears in any maintenance entrypoint or in `goalValueBackfill.ts` / `biomarkerConsolidation.ts` (grep over `backend/src/maintenance/` and the two services returns only the encrypt/select references in §6 below — no audit write).

### F-4 — Workflow performs no DB-backup / PITR precondition before an `apply=true` run, despite the writes being non-reversible — **Low**
- **Location:** `.github/workflows/maintenance.yml:121-149` (apply banner + job execute) — no snapshot/backup step precedes `gcloud run jobs execute`.
- **Observation:** The encrypt-twin writes null the plaintext (goal `goalValueBackfill.ts:111/119/129`, userfile `backfillUserFileNames.ts:86`), and the consolidation `deleteMany`s duplicate rows (`biomarkerConsolidation.ts:163`). A bad-key / bad-salt regression on an `apply=true` fleet run is therefore not trivially reversible (Acceptance Q7). The apply banner (`maintenance.yml:122-132`) warns the operator but the workflow takes no on-demand Cloud SQL backup and asserts no PITR window before executing.
- **Impact:** If `apply=true` writes wrong ciphertext fleet-wide (e.g. a salt/key regression slipped past F-1's missing guard), recovery depends on whatever Cloud SQL automated-backup / PITR happens to be configured at that moment — not on a precondition the migration itself enforces.
- **Fix:** Add a pre-apply step (only when `apply=true`) that takes an on-demand Cloud SQL backup (`gcloud sql backups create`) or asserts PITR is enabled and records the recovery point in the run log, before `gcloud run jobs execute`. Document the restore procedure in the runbook (`15-runbook-doc` cross-link).
- **Evidence:**
  ```yaml
  if [ "$APPLY" = "true" ]; then
    echo "  *** APPLY MODE — this WILL modify production data ***"
  ...
  gcloud run jobs execute "$MAINTENANCE_JOB" --region "$REGION" --project "$PROJECT_ID" --wait
  ```
  (no `gcloud sql backups create` / PITR assertion anywhere in the file)

### F-5 — Userfile backfill per-user block is a sequence of single-row updates inside one `withRLSContext`, not a transaction; a mid-user crash can leave one user partially migrated — **Low**
- **Location:** `backend/src/maintenance/backfillUserFileNames.ts:80-90`.
- **Observation:** Unlike the goal backfill (`withRLSTransaction`, `backfillGoalValues.ts:113`) and the consolidation (`withRLSTransaction`, `consolidateBiomarkerSeries.ts:103`), the userfile apply uses `withRLSContext` (a single auto-commit-per-statement context) wrapping a `for` loop of independent `tx.userFile.update(...)` calls. `withRLSContext` does open a Prisma `$transaction` internally (`database.ts:495`), so within one call the loop *is* atomic — **but** the prompt's concern is real at the boundary: if the process is killed (Cloud Run task timeout / OOM) between users, the *just-finished* users are committed and *not-yet-started* users untouched; within the killed user the single `$transaction` rolls back. So a single user is all-or-nothing, **but only because `withRLSContext` happens to wrap the loop in one transaction** — that is incidental, not declared intent, and is easy to break (e.g. someone "optimizing" by moving the per-row `update` out of the wrapper). §3 idempotency (`originalFilename: { not: null }, originalFilenameEncrypted: null`, `:67`) does clean up a partial user on re-run.
- **Impact:** Low today (the wrapper makes it atomic per user), but fragile: the all-or-nothing property is not expressed as an explicit `withRLSTransaction` the way the other two jobs are, so a future edit could silently make a partial-user state possible. Idempotency limits the worst case to a re-run.
- **Fix:** Switch `backfillUserFileNames.ts:80` from `withRLSContext` to `withRLSTransaction(userId, async (tx) => { for ... })` to make the per-user atomicity explicit and consistent with the other two jobs.
- **Evidence:**
  ```ts
  await withRLSContext(userId, async (tx) => {
    for (const f of pending) {
      await tx.userFile.update({ where: { id: f.id }, data: { originalFilenameEncrypted: ..., originalFilename: null } });
    }
  });
  ```

### F-6 — Prompt/header drift: `backfillGoalValues.ts` header tags the goal-value backfill as "(M6)" but it is the M4 work; M6 is the audit-metadata column drop — **Low** (prompt-drift class)
- **Location:** `backend/src/maintenance/backfillGoalValues.ts:2` (`"... encrypted twins (M6)."`) vs the same file's own body and the inventory.
- **Observation:** The file header line 2 calls this the M6 migration, but every other authoritative source ties goal-value encryption to **M4** (migration `20260613_encrypt_goal_values`): the prompt (`45-maintenance-jobs.md:23`, "entrypoint (M4)"), the PHI inventory (`_phi-inventory.md:42-43`, "current/start values added in `20260613_encrypt_goal_values` — M4"), and this file's own line 5 ("Companion to the M4 encryption change"). M6 is the irreversible `20260615_drop_legacy_audit_metadata` audit-metadata drop (correctly described later in this same header at `:29-32`). The "(M6)" tag at line 2 is a copy-paste slip.
- **Impact:** Documentation-only. An operator cross-referencing the migration ledger could conflate the goal-value backfill with the irreversible audit-metadata drop. No code effect.
- **Fix:** Change `backfillGoalValues.ts:2` from `(M6)` to `(M4)`.
- **Evidence:**
  ```ts
  * One-time migration: re-encrypt legacy plaintext goal values into their
  * encrypted twins (M6).        // should be (M4) — line 5 says "the M4 encryption change"
  ```

### F-7 — Info: `getUserEncryptionSalt` will mint a fresh per-user salt for a user who has none, even during a backfill apply — **Info**
- **Location:** `backend/src/services/userEncryption.ts:29-72`, called at `backfillGoalValues.ts:109`, `backfillUserFileNames.ts:78`.
- **Observation:** `getUserEncryptionSalt` is get-*or-create*: if a user has no active `phi_encryption` key it generates and persists one (`:52-66`). This is only invoked inside the `if (APPLY)` branch in both backfills, so a DRY RUN never creates a salt. In the normal case (a user with legacy plaintext goals/files also already has biomarker PHI and therefore a salt), this is a no-op lookup. The edge case — a user who has *only* legacy plaintext values and no salt — would have a salt minted by the backfill, which is the correct salt the live read path would then use, so this is benign. Noting it so a reviewer doesn't mistake the create-path for an unexpected write.
- **Impact:** None (correct behavior). Worth knowing that an `apply=true` run can create `user_encryption_keys` rows as a side effect for such edge-case users.
- **Fix:** None required.
- **Evidence:** `getUserEncryptionSalt` create branch at `userEncryption.ts:52-66`; only reached under `if (APPLY)` in both backfills.

### F-8 — Info: dry-run `consolidate` reports `rowsRemoved` via `plan.rowsBefore - plan.rowsAfter`, while apply reports it via `stats.rowsDeleted` — slight count-source asymmetry — **Info**
- **Location:** `backend/src/maintenance/consolidateBiomarkerSeries.ts:108` (apply: `stats.rowsDeleted`) vs `:114` (dry: `plan.rowsBefore - plan.rowsAfter`).
- **Observation:** The two paths derive the headline "duplicate rows deleted/would-be-deleted" from different sources. They should agree (the plan computes `rowsAfter = rowsBefore - duplicates`, `biomarkerConsolidation.ts:119`, and `applyUserConsolidation` deletes exactly `duplicateIds`), but a divergence (e.g. an RLS-filtered delete count vs the planned count) would not be surfaced as a discrepancy. Not a bug; an observability nuance.
- **Impact:** None. If a future RLS/concurrency change made `stats.rowsDeleted < planned`, the apply log would quietly differ from the dry-run estimate with no assertion.
- **Fix:** Optionally assert `stats.rowsDeleted === (plan.rowsBefore - plan.rowsAfter)` and warn on mismatch.
- **Evidence:**
  ```ts
  rowsRemoved += stats.rowsDeleted;              // apply
  ...
  rowsRemoved += plan.rowsBefore - plan.rowsAfter; // dry
  ```

---

## Checks passed

### §1 Dry-run-by-default + explicit `--apply` gate
- [x] Every entrypoint defaults to DRY RUN — `const APPLY = process.argv.includes('--apply')` at `backfillGoalValues.ts:49`, `backfillUserFileNames.ts:38`, `consolidateBiomarkerSeries.ts:38`.
- [x] DRY RUN performs NO writes — the only `tx.*.update`/`create`/`deleteMany` calls sit inside `if (APPLY)`: goal `backfillGoalValues.ts:108-117` → `applyGoalValueBackfill` (`goalValueBackfill.ts:122,127`); userfile `backfillUserFileNames.ts:77-91`; consolidate `consolidateBiomarkerSeries.ts:102-112` → `applyUserConsolidation` (`biomarkerConsolidation.ts:145,153,163`). The dry path only calls the pure `plan*()` and logs.
- [x] Workflow `apply` input is `type: boolean, default: false` — `maintenance.yml:30-34`.
- [x] `apply` is translated to `--apply` only when literally `"true"` — `maintenance.yml:118` (`if [ "$APPLY" = "true" ]; then ARGS="$ARGS,--apply"; fi`).
- [x] Loud apply-vs-dry banner before running — `maintenance.yml:121-132` (`*** APPLY MODE — this WILL modify production data ***` vs `DRY RUN — no writes`).
- [x] Footer tells operator the dry→apply path — `backfillGoalValues.ts:126`, `backfillUserFileNames.ts:99`, `consolidateBiomarkerSeries.ts:124` ("Re-run with --apply...").

### §2 Prod-PHI + live-key blast radius
- [x] Trigger is `workflow_dispatch` ONLY — `maintenance.yml:20` (no `push`/`pull_request`/`schedule`). *(WHO can dispatch is the F-2 gap.)*
- [x] Token is least-privilege — `permissions: contents: read`, `maintenance.yml:41-42`. No `id-token`/`packages`/`contents: write`.
- [x] Only secret consumed is `secrets.GCP_SA_KEY` → `google-github-actions/auth` `credentials_json` — `maintenance.yml:62-65`; never echoed.
- [x] Runs as the service's runtime SA, not deploy SA — `RUNTIME_SA` read from the live service (`maintenance.yml:94`) and passed via `--service-account` (`:113-114, 141`). Mirrors deploy.yml's migrate-job pattern (`deploy.yml:125-131,145`).
- [x] Live `PHI_ENCRYPTION_KEY` reaches the job only as a cloned Secret Manager mount — `SECRET_PAIRS` built from the service's `valueFrom.secretKeyRef` and passed via `--set-secrets` (`maintenance.yml:103-112`); plaintext key never materialized in the workflow. (Acceptance Q3 satisfied: the key is always the live service's Secret Manager value — the job clones the serving revision's exact secret wiring.)
- [x] Concurrency guard, non-cancel — `concurrency: group: maintenance-${{ github.ref }}; cancel-in-progress: false`, `maintenance.yml:44-48`.
- [x] Run is observable after the fact — `Print job output (counts)` step (`maintenance.yml:151-169`) + the Cloud Run job execution record. *(Durable AuditLog gap is F-3.)*

### §3 Idempotency / safe re-run
- [x] Goal backfill idempotent — `backfillValue` returns non-null only when plaintext set AND encrypted twin null (`goalValueBackfill.ts:52-56`); a second run finds nothing.
- [x] Userfile backfill idempotent — pending query filters `originalFilename: { not: null }, originalFilenameEncrypted: null` (`backfillUserFileNames.ts:67`); once encrypted+nulled a row no longer matches.
- [x] Consolidation idempotent — `planUserConsolidation` skips `group.length < 2` (`biomarkerConsolidation.ts:84`); after a run each series is one row, so a re-run is a no-op.
- [x] Re-run order-stable — deterministic anchor: latest `measurementDate`, then newer `createdAt`, then lexically-greater `id` (`biomarkerConsolidation.ts:88-94`).
- [x] `--max-retries 0` intentional — `maintenance.yml:144` (comment: a data migration is not safely auto-retried; a human inspects partial state).

### §4 Encrypt-twin pattern under per-user RLS UPDATE policies
- [x] Each backfill writes ciphertext AND nulls the plaintext twin in the same update — goal: `applyGoalValueBackfill` sets `*Encrypted` + nulls Decimal twin (`goalValueBackfill.ts:110-111,118-119,129`); userfile: sets `originalFilenameEncrypted` + `originalFilename: null` (`backfillUserFileNames.ts:84-88`).
- [x] Ciphertext uses the correct per-user key — `getUserEncryptionSalt(userId)` then `encryption.encrypt(p, salt)` inside the user's context (goal `backfillGoalValues.ts:109-114`; userfile `backfillUserFileNames.ts:78-85`). The job clones prod's key so ciphertext is decryptable by the live service (Architecture; Acceptance Q3).
- [x] UPDATE authorized by RLS, not bypassed — every mutation runs in `withRLSContext(userId,...)` / `withRLSTransaction(userId,...)` (goal `:113`, userfile `:80`, consolidate `:103`). Admin/null context (`withRLSContext(null,...)`) is used ONLY to *list* user ids (`backfillGoalValues.ts:59`, `backfillUserFileNames.ts:48`, `consolidateBiomarkerSeries.ts:49`). `runWithRLS` confirms null/`isAdmin` → admin context (`database.ts:485-491`).
- [x] Consolidation moves ciphertext as-is, never decrypts — `valueEncrypted` is reparented/copied without decryption (`biomarkerConsolidation.ts:145-160`); no `decrypt(` token anywhere in `backend/src/maintenance/` or `biomarkerConsolidation.ts` (grep confirmed). Valid because all of one user's rows share that user's salt.
- [x] The nulled plaintext twins are deliberately excluded from `PHI_FIELDS` — `HealthGoal.targetValue/currentValue/startValue` and `GoalProgressHistory.value` and `UserFile.originalFilename` do NOT appear in `PHI_FIELDS`; only their `*Encrypted` twins do (`encryption.ts:498-500,516-525`). The schema marks them nullable for exactly this phase-out (`schema.prisma:163,455,462,468,503`).

### §6 No PHI in job logs
- [x] Goal backfill logs counts only — user id + column/row counts, never a value (`backfillGoalValues.ts:88,103-106,116,121-124`); header "Logs counts only — never PHI values" (`:22`).
- [x] Userfile backfill logs counts only, never a filename — `backfillUserFileNames.ts:58,75,95-97`; header "Logs COUNTS only — never a filename (PHI)" (`:21`). The plaintext `originalFilename` selected at `:68` is used ONLY inside `encrypt()` (`:85`), never logged.
- [x] Consolidation logs counts + metric name/unit only, never a value — `consolidateBiomarkerSeries.ts:91-100,119-122`. `name`/`unit` are plaintext non-PHI metadata columns (`schema.prisma:186-187`; `_phi-inventory.md:113`).
- [x] Workflow log-echo pulls only `textPayload` console lines — `maintenance.yml:166-169`; no entrypoint console.logs a decrypted value, a ciphertext blob, or `f.originalFilename` (grep over the dir confirmed only the encrypt-input and select references).
- [x] Failure logs scrubbed — each `main().catch` logs `err.message` only, not the full object/stack — `backfillGoalValues.ts:132`, `backfillUserFileNames.ts:105`, `consolidateBiomarkerSeries.ts:130`.

### §7 Failure / partial-run handling
- [x] Any failure exits non-zero — `main().catch(... process.exit(1))` in all three (`backfillGoalValues.ts:131-139`, `backfillUserFileNames.ts:104-112`, `consolidateBiomarkerSeries.ts:129-137`); `gcloud run jobs execute ... --wait` (`maintenance.yml:148-149`) propagates a nonzero exit to fail the step.
- [x] Per-user atomicity (goal, consolidate) — each user's mutation is one `withRLSTransaction` (goal `:113-115`, consolidate `:103-107`). *(Userfile uses `withRLSContext` — see F-5.)*
- [x] Consolidation apply order crash-safe — reparent existing history BEFORE deleting the duplicate whose `onDelete: Cascade` (`schema.prisma:226`) would otherwise drop those history rows; then add the duplicate's own point; then delete (`biomarkerConsolidation.ts:143-165`). A partial tx rolls back — no orphaned/lost history.
- [x] Consolidation tx has explicit `{ timeout: 60_000, maxWait: 15_000 }` — `consolidateBiomarkerSeries.ts:104-107`; goal backfill deliberately uses the default (small per-user set, comment `backfillGoalValues.ts:111-112`; `withRLSTransaction` default 30s timeout, `database.ts:531`).
- [x] `--task-timeout 30m` + `--memory 512Mi` sized for a full-fleet run — `maintenance.yml:145-146`. *(Whether the largest real users fit is Acceptance Q6 — see Unverifiable.)*

### Cross-checks
- [x] Pinned action SHAs match deploy.yml — `auth@c200f3691d83b41bf9bbd8638997a462592937ed` and `setup-gcloud@e427ad8a34f8676edf47cf7d7925499adf3eb74f` identical in `maintenance.yml:62,68` and `deploy.yml:77,83,257,263,308,314` (the "Pinned action SHAs match deploy.yml" comment at `maintenance.yml:17` holds).
- [x] Local npm scripts are tsx (dev-only) — `consolidate:biomarkers`/`backfill:goal-values`/`backfill:userfile-names` all `tsx src/maintenance/...` (`package.json:18-20`); prod runs `dist/maintenance/*.js` via the workflow's `--command node --args dist/...` (`maintenance.yml:81-83,142-143`).
- [x] Nothing imports these modules — `main()` runs only on direct invocation; the maintenance entrypoints are referenced nowhere except the npm scripts and the workflow task switch (no `import ... maintenance/` hits in app code).

---

## Unverifiable
- **Acceptance Q1 (prod run status of all three jobs).** gcloud auth is unavailable in this non-interactive environment (`gcloud run jobs executions list` returned `Reauthentication failed. cannot prompt during non-interactive execution`). Per the No-TBD rule I treat the documented operating reality as authoritative: the **L24 userfile-filename backfill has NOT been run in prod** (legacy `user_files.original_filename` remains plaintext; new uploads encrypt and reads fall back) — this matches the prompt §5 and the project memory. The **M4 goal-value backfill** and **biomarker consolidation** prod run status cannot be confirmed from code and were not verifiable here; assume un-run until a `gcloud run jobs executions list --job ownmyhealth-maintenance` confirms a successful `apply=true` execution.
- **Acceptance Q2 (follow-up DROP of `user_files.original_filename` gated on a clean dry-run).** The plaintext column still exists in the schema (`schema.prisma:163`) and no `*_drop_*userfile*original_filename` migration was found, consistent with "backfill not yet run." The gating discipline (dry-run = 0 pending before the DROP) is documented in the prompt §5 but cannot be confirmed as an enforced CI/migration gate from the repo.
- **Acceptance Q5 (exact list of actors who can dispatch).** Determining the precise set of principals with Actions run-workflow permission requires repo Settings / org-membership access not available here. Established from code: the only in-repo gate is `workflow_dispatch` + `permissions: contents: read`; there is no `environment:` approval (F-2).
- **Acceptance Q6 (do the largest real users fit the consolidation tx bounds: 60s/15s/512Mi/30m?).** Requires live prod row-count data (per-user biomarker/history cardinality) unavailable without DB access. The `only_user` input (`maintenance.yml:35-39`) is the documented escape hatch for an oversized user; the bounds are explicitly sized for it (`consolidateBiomarkerSeries.ts:104-107`, `maintenance.yml:145-146`).
- **Acceptance Q7 (DB backup / PITR coverage before `apply=true`).** Cloud SQL backup/PITR configuration is a GCP-console setting not visible in the repo. The workflow itself takes no backup precondition (F-4).

## Out of scope
- The forward-path write logic in `services/biomarkerSeries.ts`, `healthGoalsController.ts`, and the upload controllers (the live write paths these jobs back-fill *toward*) — covered by their own prompts (`02-encryption`, `28-file-storage`). This review confirmed only that the jobs produce the same encrypt-twin end state.
- The per-user key-derivation crypto internals (`encryption.ts` AES-256-GCM, PBKDF2) — covered by `02-encryption`. Verified here only that the jobs call `getUserEncryptionSalt` + `encrypt` correctly and never `decrypt`.
- The `ownmyhealth-migrate` job and broader CI/CD posture — covered by `12-cicd-security`; referenced here only for the SHA-pin / runtime-SA pattern comparison.
- General RLS policy correctness — covered by the RLS prompt; verified here only that the jobs route every mutation through a per-user RLS context and use admin context solely to enumerate user ids.

---

## Required artifacts (per-job summary)

**`backfillGoalValues` (M4):** rewrites `HealthGoal.targetValueEncrypted/currentValueEncrypted/startValueEncrypted` and `GoalProgressHistory.valueEncrypted`; nulls the plaintext twins `target_value/current_value/start_value` and `goal_progress_history.value` (all excluded from `PHI_FIELDS`, `encryption.ts:516-525`). Idempotency: a value is skipped unless plaintext set AND encrypted twin null (`goalValueBackfill.ts:52-56`). Sequence: `task=backfill-goal-values, apply=false` → read counts → `apply=true` → confirm `APPLIED — N user(s)...` → `apply=false` again must report `0 ... to encrypt`. Blast radius: triggerable by any run-workflow actor (no approval gate, F-2); runs as the service runtime SA with the live cloned `PHI_ENCRYPTION_KEY`; worst-case partial run leaves processed users done, rest untouched, re-run safe — **except** a malformed value can be silently corrupted (F-1). Auditable only via job record + count logs, no `AuditLog` (F-3).

**`backfillUserFileNames` (L24):** rewrites `UserFile.originalFilenameEncrypted`; nulls the plaintext `original_filename` (excluded from `PHI_FIELDS`). Idempotency: pending query `originalFilename: { not: null }, originalFilenameEncrypted: null` (`backfillUserFileNames.ts:67`). Sequence: dry → apply → dry (must be 0) → spot-verify `decryptOriginalFilename` round-trip → ONLY THEN land the DROP-column migration. **Documented as NOT yet run in prod — plaintext PHI persists at rest until run.** Blast radius as above; per-user block is atomic only incidentally via `withRLSContext` (F-5).

**`consolidateBiomarkerSeries`:** moves `Biomarker.valueEncrypted`/`BiomarkerHistory.valueEncrypted` ciphertext as-is (no decrypt, no plaintext twin); deletes duplicate `Biomarker` rows. Idempotency: `group.length < 2` skip (`biomarkerConsolidation.ts:84`). Sequence: dry → apply (tx-bounded 60s) → dry (must be 0 series merged). Blast radius as above; crash-safe via reparent-before-delete ordering against the `onDelete: Cascade` FK (`schema.prisma:226`).
