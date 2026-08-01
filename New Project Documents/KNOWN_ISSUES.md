# KNOWN_ISSUES.md — Bug & Tech-Debt Ledger

> **Code state:** `master` @ `12b45ae` · **Refreshed:** 2026-08-01 (previous: `fb2cd32`, 2026-06-15) · **Posture:** sandbox — no GCP, see [OPEN_FINDINGS.md §Posture](./OPEN_FINDINGS.md)
>
> **Scope**: the open-issue, tech-debt, and code-marker ledger for OwnMyHealth.
> **Audience**: a Claude Project reader who has only the `New Project Documents/` doc set (no repo access). Every non-trivial claim cites `file:line`. Use this doc to answer: *"is this a known issue? what's the workaround? where's the fix tracked?"*
> **Authoritative security source (updated 2026-08-01)**: open findings and their severities are owned by [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md) — the single reconciled ledger. Current state after the 2026-07-14 sandbox re-triage: **Live: 0 Critical · 1 High · 0 Medium · 10 Low** (11 items; 7 Lows Accepted-with-trigger) **· Dormant (launch checklist): 7**. This doc's H-1/H-2/H-3 severity labels predate the reconciliation and are **not** current; each entry notes its canonical `OF-nn` id, and the ledger's number wins. Where this doc and `SECURITY_STATUS.md` disagree, the ledger resolves it.
>
> **Closed since this doc was written:** **OF-23** (file upload hard-depended on GCS — closed 2026-07-14 by the local encrypted-disk backend), **OF-11** (CI secret scan was working-tree-only — closed 2026-07-14 by `secret-history-scan.yml`), **OF-22** (refresh rotation broken under enforced RLS — found and fixed 2026-07-12), **OF-02** (Document AI OCR had no dollar cap — closed 2026-07-11). Do not carry any of these forward as open.
>
> **Added to the ledger 2026-08-01 — OF-24 through OF-27** (all Low under the sandbox posture): blocked/failed biomarker AI-guidance requests consume the user's `aiGuidancePerDay` quota (the L-35 fix exists on the chat path but was never mirrored to guidance — `biomarkerRoutes.ts:154,187`) · `revoked_access_tokens` has no RLS UPDATE policy but is written by `upsert` · two maintenance jobs UPDATE `biomarker_history` / `goal_progress_history`, which also have no UPDATE policy (potential irreversible PHI loss in consolidation — **High at launch**) · the plan gate issues six count queries per gated request. All four are the same story as OF-22 in three of the four cases: a policy set that omits UPDATE, invisible in dev because dev connects as BYPASSRLS. See [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md) and [`security-reviews/44-token-revocation-review.md`](./security-reviews/44-token-revocation-review.md).

This doc was generated against live code per [`prompts/20-known-issues-doc.md`](../prompts/20-known-issues-doc.md) and the [`_doc-quality.md`](../prompts/_doc-quality.md) protocol.

---

## Severity legend

| Tier | Meaning |
|---|---|
| **Critical** | Blocks core functionality or PHI isolation. |
| **High** | Significant feature broken / must fix before beta. |
| **Medium** | Usability / fix during beta. |
| **Low** | Minor annoyance / backlog. |
| **Deprecated (kept for compat)** | Marked deprecated / legacy but still present. |

---

## 1. Critical

### OF-01 — Production GCP service-account private key recoverable from git history (added 2026-07-11)
- **Severity**: Critical · **Canonical**: [`OPEN_FINDINGS.md` OF-01](./OPEN_FINDINGS.md) · **Source**: assessment 2026-06-21 finding OMH-C01 (`security/assessment-2026-06-21/`)
- **Symptom**: commit `202f2dd` committed `backend/gcp-ocr-key.json.json` with the real private key for `ocr-service@ownmyhealth-prod.iam.gserviceaccount.com`; removed from HEAD ~37s later but still fully recoverable via `git show 202f2dd:backend/gcp-ocr-key.json.json` (re-verified 2026-07-11). Key-rotation status in GCP IAM is unverified — treat as live.
- **Next steps**: rotate/delete the key in GCP IAM (prefer Workload Identity), audit access logs, purge history or record a key-dead determination, commit the nightly history-scan workflow (OF-11). Full acceptance criteria in the ledger.

The historical runtime Critical, **C-8 (runtime BYPASSRLS)**, remains **RESOLVED in production** — see [§10 Fixed issues reference](#10-fixed-issues-reference). Production hard-exits if the DB role has `BYPASSRLS` and a second boot guard (`assertRLSForced`, M2) hard-exits if any RLS-enabled table is not FORCE-protected.

---

## 2. High

> **Reconciled 2026-07-11**: the canonical High set is **OF-03 (plaintext filename residue — raised from L-3 below), OF-04 (no MFA — was in no ledger), OF-05 (FHIR PKCE — H-2 below)**. H-1 (TOCTOU) is reconciled to **Medium-accepted (OF-06)** while billing is not live, escalating to High when plan limits guard paid entitlements. **H-3 (OCR $ cap, OF-02) was CLOSED the same day** by `1047506` — OCR cost now accrues into the fail-closed AI budget. See [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md).

### H-1 — Plan-limit enforcement has a documented check-then-allow TOCTOU race
- **Canonical**: [`OPEN_FINDINGS.md` OF-06](./OPEN_FINDINGS.md) — reconciled to **Medium (accepted)** with an escalation trigger (becomes High when billing ships).
- **Severity**: ~~High~~ Medium-accepted (correctness; over-quota overshoot under concurrency). Deliberately **deferred** (codebase documents it as a known, accepted race backstopped by the AI dollar spend-cap).
- **Symptom**: Two concurrent requests from the same user can both read `current = limit - 1`, both decide `allowed = true`, and both perform the gated action, overshooting a finite plan limit (e.g. `maxBiomarkers`, `pdfUploadsPerMonth`, `activeInsurancePlans`) by the number of concurrent requests.
- **Root cause**: `checkPlanLimit` is a read-only helper — it counts usage, then the *caller* writes in a separate step, with a gap between the count and the write.
- **Evidence**:
  ```ts
  // Source: backend/src/services/usageTracker.ts:179-184
  // KNOWN RACE (TOCTOU) — finite numeric limits are enforced as count-then-allow
  // with no atomic reservation. Two concurrent requests for the same user can
  // both read `current = limit - 1`, both decide `allowed = true`, and then both
  // perform the action, overshooting the limit by the number of concurrent
  // requests. The window is the gap between this read and the caller's write
  // (e.g. the audit row in aiChatController, or the userFile/biomarker insert).
  ```
- **Workaround / mitigation in place**: AI dollar spend is independently bounded by the `aiSpendGuard` circuit-breaker (503 fail-closed at `backend/src/middleware/aiSpendGuard.ts:60-67`), so the highest-cost path (Claude calls) cannot be runaway-abused even when the count gate slips. Non-AI overshoot (extra biomarkers/plans) is bounded by the number of truly-concurrent in-flight requests, which is small.
- **Recommended fix (in code comment)**: atomic reservation in the same transaction that records the usage — `UPDATE ... SET n = n + 1 WHERE n < :limit RETURNING n` inside `withRLSTransaction`, or a DB-side partial-unique/trigger that rejects the `(limit+1)`-th row (`usageTracker.ts:186-198`).
- **Tracked in**: memory `ownmyhealth-2026-06-15-security-longtail.md` as deferred **L34/L36** (AI-quota / plan-limit TOCTOU); needs a quota-architecture change to atomic reservation.
- **Files**: `backend/src/services/usageTracker.ts:179-198` (race + recommended fix), `:156-209` (`checkPlanLimit`); callers `backend/src/middleware/planGating.ts`, `backend/src/controllers/aiChatController.ts`.

### H-2 — SMART-on-FHIR (Quest) connect flow fails intermittently across Cloud Run instances
- **Canonical**: [`OPEN_FINDINGS.md` OF-05](./OPEN_FINDINGS.md) — confirmed **High**.
- **Severity**: High (availability of the FHIR lab-connect feature under autoscale). The feature is **off by default** (`QUEST_FHIR_CLIENT_ID` empty → disabled, `backend/src/config/index.ts:266`), which caps blast radius.
- **Symptom**: A patient who starts the Quest OAuth flow on one instance and is load-balanced to a *different* instance for the public `/fhir/callback` gets a failed connect — the PKCE `code_verifier` cannot be found.
- **Root cause**: the PKCE challenge store is an in-memory per-process `Map` keyed by `state`; the callback may land on a replica that never stashed the verifier, so `consumeChallenge` returns null.
- **Evidence**:
  ```ts
  // Source: backend/src/services/fhir/smartAuth.ts:374-386 (paraphrased to the cited range)
  // KNOWN LIMITATION L-39: the challenge Map is per-process. With >1 Cloud Run
  // instance the public callback can be routed to a different instance than the
  // one that created the verifier → consumeChallenge() returns null and connect
  // fails intermittently. Mitigation: pin --max-instances=1 until a shared
  // Redis/Memorystore challenge store exists. This is a dropped-callback
  // availability issue, NOT a forgeable-state security issue.
  ```
- **Workaround**: pin `--max-instances=1` on the backend Cloud Run service while the FHIR feature is enabled, OR keep the feature disabled (default).
- **Tracked in**: memory `ownmyhealth-feature-map.md` (FHIR/Quest as an undocumented real feature); deferred infra item (shared Redis/Memorystore — same dependency as `REDIS_URL` rate-limit / spend-store sharing).
- **Files**: `backend/src/services/fhir/smartAuth.ts:361-414` (in-memory challenge store + TTL), `:374-386` (the limitation), `backend/src/services/fhir/labSyncService.ts:96-138` (connect orchestration). FHIR controller/service are **untested** — see [§9 Missing test coverage](#9-missing-test-coverage).

### H-3 — Document AI (Google OCR) dollar cost is never recorded against the AI budget — **RESOLVED 2026-07-11**
- **Canonical**: [`OPEN_FINDINGS.md` OF-02](./OPEN_FINDINGS.md) — **CLOSED** by `1047506`: `trackDocumentAIUsage()` accrues per-page OCR cost (`DOCUMENT_AI_COST_PER_PAGE_USD`) into the same daily accumulator as Claude spend, so the existing `aiSpendGuard` 503 breaker now bounds OCR dollars. The description below is preserved as the historical finding.
- **Severity**: ~~High~~ Resolved (cost governance gap; not a correctness/PHI gap).
- **Symptom**: The AI dollar circuit-breaker (`AI_DAILY_BUDGET_USD`, default 50) meaningfully bounds only **Claude** token spend. Real **Document AI** OCR dollar cost never accrues into the accumulator, so it does not count against the daily budget.
- **Root cause**: the paid Document AI call has no `trackAIUsage` / Document-AI-specific cost tracking. The upload routes that reach it carry `aiSpendGuard`, but the guard only reserves/refunds the fixed `$0.05` Claude *estimate* (`backend/src/services/aiCostTracker.ts:67`) — the actual OCR cost is dropped.
- **Evidence**:
  ```ts
  // Source: backend/src/services/ocrService.ts:300 — the paid Document AI call;
  //   no trackAIUsage() and no Document-AI cost tracking anywhere for it.
  const [result] = await client.processDocument(request);
  ```
- **Workaround / mitigation in place**: Document AI is still bounded by (1) the count-based `pdfUploadsPerMonth` plan quota on the upload routes (`backend/src/routes/uploadRoutes.ts:84,106,137`) and (2) the `aiLimiter` rate limiter — just not by dollars.
- **Tracked in**: memory `ownmyhealth-2026-06-01-prompt-refresh.md` (AI-cost spend-gap theme) and the fact digest AI-cost section.
- **Files**: `backend/src/services/ocrService.ts:300` (paid call), `:375` (`processDocument` wrapper), callers `backend/src/controllers/upload/labUploadController.ts:53,216`; guard mounts `backend/src/routes/uploadRoutes.ts:82,104,135`, `backend/src/routes/insuranceRoutes.ts:125,138`; reservation constant `backend/src/services/aiCostTracker.ts:67`.

---

## 3. Medium

### M-1 — AI dollar spend cap is per-process unless `REDIS_URL` is set
- **Severity**: Medium (cost governance under autoscale).
- **Symptom**: With the default in-memory spend store, the *effective* daily ceiling is `N × AI_DAILY_BUDGET_USD` where N = number of Cloud Run instances; each instance keeps its own accumulator.
- **Root cause**: `getStore()` returns the in-memory `InMemorySpendStore` unless `REDIS_URL` is configured, in which case it uses the shared `RedisSpendStore`.
- **Evidence**:
  ```ts
  // Source: backend/src/config/index.ts:250-254 (paraphrased to range)
  // In-memory spend store means the effective cap under autoscale is N×budget;
  // set REDIS_URL to share the accumulator across instances.
  ```
- **Workaround**: set `REDIS_URL` to a shared Redis/Memorystore instance — also closes the same multi-instance gap for rate limiting (audit #37) and is the same infra dependency as H-2.
- **Files**: `backend/src/services/aiCostTracker.ts:95` (`InMemorySpendStore`), `:172` (`RedisSpendStore`), `:257-274` (`getStore()`); `backend/src/config/index.ts:186` (`REDIS_URL`, default `''`), `:250-254` (the caveat note).

### M-2 — In-memory access-token blacklist does not span Cloud Run replicas
- **Severity**: Medium (defense-in-depth; the DB-backed mechanisms below close the real gap).
- **Symptom**: The `revokedTokens` in-memory `Map` only blocks a revoked access token on the instance that revoked it; another replica would still accept it until its `iat` is caught by the DB-backed cutoff.
- **Root cause**: per-process map by design; documented limitation.
- **Mitigation in place (this is largely closed)**: two **DB-backed** mechanisms run on every replica — `users.tokens_valid_after` (cross-instance cutoff stamped by `revokeAllUserTokens`) and the `revoked_access_tokens` table (single-device cross-instance logout via `jti`). So in practice cross-instance revocation works for logout-all/password/email changes and single-device logout; only the raw in-memory map is per-process.
- **Evidence**:
  ```ts
  // Source: backend/src/middleware/auth.ts:106-108
  // every protected request also checks the DB-backed cutoff on each replica:
  if (await isAccessTokenStale(decoded.id, decoded.iat, decoded.jti)) {
    return res.status(401)...
  }
  ```
- **Files**: `backend/src/services/authService.ts:142-154` (per-instance limitation note), `:156` (`revokedTokens` Map); cross-instance: `:259-278` (`fetchUserRevocationState`, 15s TTL), `:323-336` (`isAccessTokenStale` + cache invalidate), `:358-394` (`revokeAccessTokenCrossInstance`); migrations `20260606000002_add_tokens_valid_after`, `20260613_revoked_access_tokens`.

### M-3 — `tokens_valid_after` staleness check fails OPEN on DB error
- **Severity**: Medium (fail-open in a revocation path).
- **Symptom**: If the DB read for the per-user revocation cutoff throws, `isAccessTokenStale` returns `false` (token treated as valid) rather than rejecting.
- **Root cause**: deliberate availability trade-off — a transient DB error should not lock everyone out — but it means a brief window where a just-revoked access token could be accepted if the DB is unreachable.
- **Evidence**: `backend/src/services/authService.ts:314-320` (fail-open on DB error).
- **Workaround**: none at the app layer; mitigated by the short access-token lifetime (15 min, `backend/src/config/index.ts:121`) and the 15s revocation-cache TTL.
- **Files**: `backend/src/services/authService.ts:314-320`.

### M-4 — CSP still allows `'unsafe-inline'` for styles (XSS hardening gap)
- **Severity**: Medium (security hardening; tracked code marker).
- **Symptom**: The Helmet Content-Security-Policy permits inline `<style>` (`styleSrc: ["'self'", "'unsafe-inline'"]`), which weakens XSS defense for style-injection vectors.
- **Root cause**: Tailwind and third-party libs inject runtime `<style>` tags; a nonce-based CSP has not been wired yet.
- **Evidence**:
  ```ts
  // Source: backend/src/app.ts:130-134
  // TODO(csp-nonce): 'unsafe-inline' is required today because Tailwind
  // and third-party libs inject runtime <style> tags. Migrate to a
  // nonce-based CSP (generate per-request nonce middleware → thread
  // into index.html + React style injection) to close the XSS vector.
  styleSrc: ["'self'", "'unsafe-inline'"],
  ```
- **Tracked in**: code marker — see [§6 Code-marker inventory](#6-code-marker-inventory).
- **Files**: `backend/src/app.ts:125-137`.

### M-5 — `npm audit` reports 1 high + 8 moderate transitive vulnerabilities
- **Severity**: Medium (supply-chain; none reachable as a deployed attack surface — see [§8](#8-dependency-vulnerabilities)).
- **Symptom**: `npm audit` at HEAD reports 9 vulnerabilities (8 moderate, 1 high). The high is `hono` (Windows path-traversal in `serve-static`); the moderate chain is `uuid` pulled in transitively via `gaxios` → `teeny-request` → `@google-cloud/storage`.
- **Workaround / status**: `hono` is a transitive dev/tooling dependency (not the app's HTTP framework — the app uses Express 4.18) and its advisories are adapter-specific (AWS Lambda / Lambda@Edge / Windows static-serving) not exercised by this Express+Cloud-Run app. `uuid` fix requires a `--force` major bump (`uuid@14`, breaking). See [§8](#8-dependency-vulnerabilities) for the per-advisory table and remediation plan.
- **Files**: `package.json` / `backend/package.json` (workspace-hoisted `node_modules` — both `npm audit` runs report the identical 9).

---

## 4. Low

### L-1 — Health-goal/plan "Upgrade" button is a placeholder (billing not wired)
- **Severity**: Low (feature not yet live; user-visible stub).
- **Symptom**: Clicking **Upgrade** in the plan section does not start a checkout — it shows "Upgrades are not available yet. Contact us to upgrade manually."
- **Root cause**: Stripe checkout is not wired; placeholder handler.
- **Evidence**:
  ```tsx
  // Source: src/components/settings/PlanSection.tsx:161-164
  onClick={() => {
    // TODO: wire to Stripe checkout when billing goes live.
    onError?.('Upgrades are not available yet. Contact us to upgrade manually.');
  }}
  ```
- **Tracked in**: code marker — see [§6](#6-code-marker-inventory).
- **Files**: `src/components/settings/PlanSection.tsx:158-170`.

### L-2 — PBKDF2 iteration count is not stored per-ciphertext (key-rotation debt)
- **Severity**: Low (migration artifact; "leaks nothing" per the code comment).
- **Symptom**: Decryption tries the current iteration count (600,000) first and falls back to the legacy count (100,000) on auth-tag failure. This is a try-both scheme, not a stored-per-row marker.
- **Root cause**: hardening raised iterations without a coordinated whole-DB re-encryption; the legacy fallback is kept until all rows are re-encrypted.
- **Evidence**:
  ```ts
  // Source: backend/src/services/encryption.ts:80-83
  // TODO(key-rotation): store the iteration count per user (or per-ciphertext
  // envelope) and remove the legacy fallback once all rows are re-encrypted.
  // The current scheme leaks nothing — both derivations use the same stored
  // salt — but it's a migration artifact, not a long-term design.
  ```
- **Tracked in**: code marker — see [§6](#6-code-marker-inventory).
- **Files**: `backend/src/services/encryption.ts:74-86` (iteration constants + fallback rationale).

### L-3 — `user_files.original_filename` re-encrypt backfill not yet run in production (operational)
- **Canonical**: [`OPEN_FINDINGS.md` OF-03](./OPEN_FINDINGS.md) — **raised to High** (known plaintext PHI residue in prod while docs/marketing say "encrypted at rest" is a compliance exposure, not a minor annoyance).
- **Severity**: ~~Low~~ High (legacy plaintext residue; new writes already encrypt).
- **Symptom**: Existing (legacy) `user_files` rows in **prod** may still hold plaintext `original_filename`. New uploads write the AES-GCM `original_filename_encrypted` twin and null the plaintext; reads fall back to plaintext for un-backfilled rows.
- **Root cause**: the L24 maintenance backfill job (`backfill-userfile-filenames`) has not been run against prod yet, and the follow-up migration to drop the plaintext column is pending its completion.
- **Workaround / next step**: run the `backfill-userfile-filenames` maintenance Cloud Run job (DRY RUN, then `--apply`), then add a migration to drop `user_files.original_filename`.
- **Tracked in**: memory `ownmyhealth-2026-06-15-security-longtail.md` (L24, "PENDING ops").
- **Files**: `backend/src/maintenance/backfillUserFileNames.ts` (the job; `:111` `process.exit(1)` on error), migration `20260615_encrypt_userfile_original_filename` (adds the encrypted column + drops NOT NULL on plaintext), schema comment `backend/prisma/schema.prisma:161-162`.

### L-4 — `pdf-parse@1.1.1` is unmaintained on the PHI lab-ingestion path (accepted risk)
- **Severity**: Low (supply-chain / tech-debt; **risk accepted** — not reachable as RCE, bounded by upstream guards).
- **Source**: 2026-06-21 security + compliance readiness assessment, finding **OMH-L01** (PT-DEPENDENCY; `security/assessment-2026-06-21/`).
- **Symptom**: `pdf-parse@1.1.1` is unmaintained but is the PDF text-extractor for user-uploaded lab reports + insurance SBCs.
- **Decision — accept, do not migrate blindly**: the obvious upgrade (`pdf-parse@2.x` / direct `pdfjs-dist`) is a `pdfjs-dist` wrapper that requires DOM / native `@napi-rs/canvas` polyfills in Node and **fails to load in some environments**, so a swap needs a deliberate migration + **extraction testing on the Cloud Run deploy target**, not a blind version bump. Until that testing can be done, staying on the pinned pure-JS lib is the lower-risk choice.
- **Mitigations in place**: pinned to an **exact** version (no caret) to bound supply-chain drift; **pure-JS** (no native build); every parse is wrapped in `secureParsePdf()` (size / time / PDF-bomb guards); no known reachable RCE in this usage.
- **Revisit if**: a CVE is disclosed against `pdf-parse`, OR a deliberate `pdfjs-dist` (text-only, legacy build, no-canvas) migration is implemented **and verified to extract correctly on Cloud Run** (keep `pdf-parse` as a fallback during rollout).
- **Files**: `backend/src/services/pdfParser.ts:27-33` (the audit #32 decision note), `backend/src/utils/securePdfParsing.ts` (the bomb / timeout guard), `backend/package.json` (exact pin).

---

## 5. Deprecated (kept for compat)

There are **no deprecated Prisma models** in `backend/prisma/schema.prisma` (no `@deprecated` model annotations; the only `legacy` markers are inline comments on *plaintext-twin columns*, not whole models — `schema.prisma:161-162, 453, 465, 500, 529-531`). The legacy plaintext columns below coexist with their encrypted twins by design and are being phased out:

| Plaintext-twin column (legacy) | Encrypted twin (live) | schema.prisma | Phase-out plan |
|---|---|---|---|
| `UserFile.originalFilename` | `originalFilenameEncrypted` | :163 / :164 | Backfill job → drop migration (L-3 above) |
| `HealthGoal.targetValue` | `targetValueEncrypted` | :455 / :461 | Read path prefers encrypted; drop pending |
| `HealthGoal.currentValue` | `currentValueEncrypted` | :462 / :467 | Read path prefers encrypted; drop pending |
| `HealthGoal.startValue` | `startValueEncrypted` | :468 / :470 | Read path prefers encrypted; drop pending |
| `GoalProgressHistory.value` | `valueEncrypted` | :503 / :504 | Read path prefers encrypted; drop pending |

> **Note on `Biomarker.sourceFile` (`schema.prisma:195`)**: plaintext **by deliberate design** — it is a FHIR idempotency/dedupe key; encrypting it breaks dedupe. Not a deprecation, not a PHI_FIELDS candidate. See [`DATA_MODEL.md`](./DATA_MODEL.md).

**DNAVariant / GeneticTrait** models were **removed entirely** in migration `20260423_drop_dna_genetics` — they are *not* deprecated-but-present. A `Grep` for `DNAVariant|GeneticTrait` over `schema.prisma` returns **zero hits**. Recorded as resolved in [§10 Fixed issues reference](#10-fixed-issues-reference). Current model count is **19** (the prompt's "17/18" figures were intermediate recounts; the canonical count including `RevokedAccessToken` is 19 — see [`DATA_MODEL.md`](./DATA_MODEL.md)).

---

## 6. Code-marker inventory

Every `TODO|FIXME|HACK|XXX` marker across `backend/src/**` and `src/**` (Grep at HEAD `fb2cd32`). **4 markers total** — 3 backend, 1 frontend. The `csrf.ts:147` entry is a **NOTE describing a now-removed TODO** (the upload-route CSRF exemption was already resolved), kept here for completeness because it matches the marker grep.

| Marker | File:line | Context (first ~80 chars) | Severity link |
|---|---|---|---|
| TODO | `backend/src/services/encryption.ts:80` | `TODO(key-rotation): store the iteration count per user (or per-ciphertext` | [L-2](#l-2--pbkdf2-iteration-count-is-not-stored-per-ciphertext-key-rotation-debt) |
| TODO | `backend/src/app.ts:130` | `TODO(csp-nonce): 'unsafe-inline' is required today because Tailwind` | [M-4](#m-4--csp-still-allows-unsafe-inline-for-styles-xss-hardening-gap) |
| NOTE (removed TODO) | `backend/src/middleware/csrf.ts:147` | `NOTE on upload routes: previously CSRF-exempt with a TODO. The exemption is now removed` | Resolved — see [§10](#10-fixed-issues-reference) |
| TODO | `src/components/settings/PlanSection.tsx:162` | `TODO: wire to Stripe checkout when billing goes live.` | [L-1](#l-1--health-goalplan-upgrade-button-is-a-placeholder-billing-not-wired) |

**File with the most markers**: none has more than one — the 3 live TODOs are in 3 distinct files (`encryption.ts`, `app.ts`, `PlanSection.tsx`); `csrf.ts:147` is a NOTE, not a live TODO. No `FIXME`, `HACK`, or `XXX` markers exist anywhere in `backend/src/**` or `src/**`.

---

## 7. Skipped / TODO tests

Grep `\.(skip|todo|skipIf)\(|xit\(` over `backend/src/**` and `e2e/**`. The only match that is an actual test-control marker is one **intentional live-DB gate** — there are **no `.skip`-debt, no `.todo`, no `xit` tests**. (Other grep hits like `process.exit(...)` are not test skips.)

| Marker | File:line | What it is | Debt? |
|---|---|---|---|
| `describe.skipIf(!hasLiveDb)` | `backend/src/services/rls.test.ts:29` | RLS tenant-isolation suite that only runs when a live Postgres is reachable (`hasLiveDb`). Intentional gate, runs in CI's live-PG RLS job. | **No** — by design, not skipped debt |

```ts
// Source: backend/src/services/rls.test.ts:29
describe.skipIf(!hasLiveDb)('RLS tenant isolation (withRLSContext)', () => {
```

---

## 8. Dependency vulnerabilities

`npm audit` run in both the repo root and `backend/` (workspaces hoist `node_modules`, so both report the **identical** set). Totals at HEAD `fb2cd32`:

| Severity | Count | Notable advisories (status) |
|---|---|---|
| Critical | 0 | — |
| High | 1 | `hono <=4.12.24` — path traversal in `serve-static` on Windows via encoded backslash `%5C` (GHSA-wwfh-h76j-fc44), plus AWS-Lambda/Lambda@Edge adapter cookie/header advisories. **Status: NOT exercised** — app is Express 4.18 on Cloud Run, `hono` is a transitive tooling dep; advisories are Lambda/Windows-static-serve specific. `npm audit fix` available (non-major). |
| Moderate | 8 | `uuid <11.1.1` — missing buffer bounds check in v3/v5/v6 when `buf` provided (GHSA-w5hq-g745-h8pq), pulled transitively via `gaxios` (6.4.0–6.7.1) → `teeny-request` → `@google-cloud/storage` → `retry-request`. **Status: deferred** — fix requires `npm audit fix --force` → `uuid@14` (breaking). |

```text
9 vulnerabilities (8 moderate, 1 high)   # identical in repo root and backend/
```

**Remediation plan**:
- **`hono` (high)**: low risk in this stack; apply `npm audit fix` (non-breaking, lockfile-only) at the next dependency pass to clear the CI **Security Audit** gate noise.
- **`uuid` chain (8 moderate)**: hold the breaking `uuid@14` bump; it is gated on a `@google-cloud/storage` major upgrade. Track via Dependabot; do **not** auto-merge the major.
- **No `axios` or `vite` advisories are currently open.** The earlier `form-data` CRLF + `vite` HIGH advisories were cleared by a non-breaking `npm audit fix` in the backend (commit `fb2cd32` lineage; see memory `ownmyhealth-2026-06-15-security-longtail.md`). Per [Acceptance Q10](#acceptance-questions), there is no open axios/vite remediation item at HEAD.

> **Cross-doc note**: the prompt's example called out `axios`/`vite` advisories; at HEAD those are **closed**. The live open set is `hono` (high) + the `uuid` transitive chain (moderate). See [§12 Prompt drift log](#12-prompt-drift-log).

---

## 9. Missing test coverage

Computed by comparing `Glob backend/src/controllers/*.ts` against `*.test.ts` (and the same for `controllers/upload/` and `routes/`).

### Controllers (top-level) — `backend/src/controllers/*.test.ts`

| Controller | Has `*.test.ts`? | Test file |
|---|---|---|
| `authController.ts` | ✅ | `authController.test.ts`, `authController.register.test.ts` |
| `biomarkerController.ts` | ✅ | `biomarkerController.test.ts` |
| `expenseController.ts` | ✅ | `expenseController.test.ts`, `expenseController.costMath.test.ts` |
| `healthGoalsController.ts` | ✅ | `healthGoalsController.test.ts` |
| `healthNeedsController.ts` | ✅ | `healthNeedsController.test.ts` |
| `settingsController.ts` | ✅ | `settingsController.test.ts`, `settingsController.updateProfile.test.ts` |
| `insuranceController.ts` | ✅ | `insuranceController.updatePlan.test.ts` |
| `aiChatController.ts` | ✅ (added 2026-07-11) | `aiChatController.test.ts` — BAA gate, L42 fail-closed audit, SSE PHI scrub (incl. chunk-boundary), L33 disclaimer, history cap, stream-failure quota semantics |
| `fhirController.ts` | ✅ (added 2026-07-11) | `fhirController.test.ts` — feature gate, redirect-only callback error hygiene, CONNECT_FAILED audit, token-column non-leak, sync IDOR scoping, generic ExternalServiceError |
| `fileController.ts` | ✅ (added 2026-07-11) | `fileController.test.ts` — L24 decrypt read path + legacy fallback, audit-before-stream download proxy, Content-Disposition injection guard, F-22 GCS-first delete ordering |

### Controllers (`controllers/upload/`)

| Controller | Has `*.test.ts`? | Test file |
|---|---|---|
| `shared.ts` | ✅ | `shared.test.ts` |
| `labUploadController.ts` | ✅ (added 2026-07-11) | `labUploadController.test.ts` — L24 encrypted-filename invariant, PARSE_FAILED audit, GCS-outage tolerance, M8/M25 orphan cleanup, out-of-range notify, spoofed-PDF rejection (both routes) |
| `sbcUploadController.ts` | ✅ (added 2026-07-11) | `sbcUploadController.test.ts` — L24 invariant, empty-extraction audits, L32 safeDate fallback, M8/M25 orphan cleanup, reanalyze ownership-before-extraction + user-field preservation |
| `index.ts` | ❌ (re-export barrel) | n/a |

**Controllers with zero coverage** (updated 2026-07-11): **none** — scrutiny P1-6 is closed. All five formerly untested PHI controllers (`aiChatController`, `labUploadController`, `fhirController`, `fileController`, `sbcUploadController`) gained dedicated suites on 2026-07-11. `insuranceController` **is** covered (`insuranceController.updatePlan.test.ts`) — not a gap. Remaining test debt lives in services (`ocrService`, `storageService`, `emailService`, FHIR services) and the frontend skew — see [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md).

### Routes — `backend/src/routes/*.test.ts`

18 non-test route files; **8** dedicated route-test files exist:

| Has route-level test | File |
|---|---|
| ✅ | `adminRoutes.demoProtection.test.ts`, `adminRoutes.updateUser.test.ts`, `biomarkerRoutes.guidance.test.ts`, `internalRoutes.test.ts`, `providerRoutes.requestUniformity.test.ts`, `providerRoutes.insurance.test.ts`, `healthNeedsRoutes.statusUpdate.test.ts`, `authRoutes.logout.test.ts` |
| ❌ (no dedicated route test) | `aiRoutes`, `expenseRoutes`, `fileRoutes`, `healthGoalsRoutes`, `settingsRoutes`, `fhirRoutes`, `insuranceRoutes`, `planRoutes`, `uploadRoutes`, `onboardingRoutes`, `patientRoutes`, `index` |

```text
Coverage map (controllers):  tested ████████████   untested █████
   tested(7 top-level + shared)  |  untested(aiChat, fhir, file, labUpload, sbcUpload)
```

See [`TESTING_PATTERNS.md`](./TESTING_PATTERNS.md) for the controller/route test patterns to use when closing these gaps.

---

## 10. Fixed issues reference

| Issue | What it was | Resolution | Tracked / closing reference |
|---|---|---|---|
| **C-8** runtime BYPASSRLS | RLS policies existed but the app ran as a BYPASSRLS role, so policies did not enforce at runtime. | See full row below — **RESOLVED in prod**. | memory `ownmyhealth-prod-deploy-broken.md`, `ownmyhealth-project.md` |
| **DNAVariant / GeneticTrait** removal | Genetics models present in schema. | **Dropped entirely** in migration `20260423_drop_dna_genetics`; zero hits in `schema.prisma` today. | migration `20260423_drop_dna_genetics` |
| **Upload-route CSRF exemption** | Upload routes were CSRF-exempt with a TODO (silent bypass risk). | Exemption **removed**; uploads now fail closed if `X-CSRF-Token` is missing. The frontend `uploadUtils.ts` double-submits the token. | `backend/src/middleware/csrf.ts:147-156` (NOTE), memory `ownmyhealth-2026-06-01-security-hardening.md` |
| **Refresh-token reuse not revoking the family (M-1)** | A reused refresh token did not revoke the user's whole token family. | Reuse outside a 10s grace window now calls `revokeAllUserTokens` (deletes all sessions + stamps `tokens_valid_after`). | `backend/src/services/authService.ts:795-806`, memory `ownmyhealth-2026-06-12-pentest.md` |
| **Audit-metadata plaintext (M6)** | Legacy plaintext `audit_logs.metadata` held PHI residue. | Encrypted column added (`20260606000001`), plaintext column **dropped** (`20260615_drop_legacy_audit_metadata`, irreversible). | migrations `20260606000001`, `20260615_drop_legacy_audit_metadata` |
| **OneDrive stray `nul` file** | A stray `nul` file had been reported (OneDrive sync artifact). | **Not in the tree** at HEAD (root listing + `git ls-files` both clean). | This audit ([Acceptance Q9](#acceptance-questions)) |

### RLS runtime enforcement (C-8) — RESOLVED
- **Severity**: Critical (historical; now closed).
- **Symptom (historical)**: PostgreSQL RLS policies existed but the app ran as a `BYPASSRLS` role, so policies did not enforce at runtime.
- **Root cause**: DB role provisioning at Cloud SQL granted `BYPASSRLS`; the app should use a non-superuser role.
- **Resolution**: The `omh_app` cutover landed. Production now hard-exits (`process.exit(1)`) if the DB role has `BYPASSRLS` (`assertNoBypassRLS`); a second boot guard (`assertRLSForced`, M2) hard-exits if any RLS-enabled table is not FORCE-protected. Migration `20260613_force_rls_and_audit_retention` FORCE'd all 19 RLS tables. The transitional `RLS_ENFORCEMENT=strict` flag was **removed** at cutover (no longer read by any code; noted dead in `backend/.env.example:95-98`). RLS enforces at runtime in prod; dev/staging only warn-and-continue.

  ```ts
  // Source: backend/src/services/database.ts:247-254 (assertNoBypassRLS, prod branch)
  if (config.isProduction) {
    logger.error(
      'FATAL: Production database role has BYPASSRLS. ' +
      'RLS policies are not enforcing. Refusing to start. ' +
      'See docs/c-8-part-c-runbook.md.'
    );
    process.exit(1);
  }
  ```
  ```ts
  // Source: backend/src/services/database.ts:299-306 (assertRLSForced, M2, prod branch)
  if (config.isProduction) {
    logger.error(
      `FATAL: ${unforced.length} RLS-enabled table(s) are NOT FORCE-protected ` +
        `(${unforced.join(', ')}). A table owner could bypass tenant isolation on them. ` +
        'Refusing to start — add FORCE ROW LEVEL SECURITY (see migration 20260613).'
    );
    process.exit(1);
  }
  ```
- **Tracked in**: memory `ownmyhealth-project.md`; finding C-8 (closed). No remaining runtime workaround.
- **Files**: `backend/src/services/database.ts:242-260` (`assertNoBypassRLS`), `:270-306` (`assertRLSForced`, M2); runbook `docs/c-8-part-c-runbook.md` (referenced in the FATAL log at `database.ts:251`); Cloud SQL role config (external).

```
Boot sequence (both guards run before the server accepts traffic):

  app boot ──▶ initializeDatabase()
                  │
                  ├─▶ assertNoBypassRLS()      (database.ts:242)
                  │        role has BYPASSRLS? ──prod──▶ FATAL + process.exit(1)
                  │                              └dev──▶ warn + continue
                  │
                  └─▶ assertRLSForced() [M2]    (database.ts:270)
                           any RLS table not FORCE? ──prod──▶ FATAL + process.exit(1)
                                                     └dev──▶ warn + continue
```

> **Which recently-closed fix introduced new known risk?** ([Acceptance Q8](#acceptance-questions)) — the **audit-metadata M6 drop** (`20260615_drop_legacy_audit_metadata`) is **irreversible** (the plaintext `metadata` column is permanently gone); and the **L24 filename-encryption** rollout left the **L-3** operational debt (prod backfill not yet run). Both are intended trade-offs, recorded above.

---

## 11. Related Documents

- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — authoritative source for open/closed security findings; this ledger mirrors and points to it.
- [CHANGELOG.md](./CHANGELOG.md) — chronological record of recently closed items referenced in [§10](#10-fixed-issues-reference).
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — symptom → root-cause runbook for live bugs (e.g., the FHIR multi-instance connect failure H-2).
- [TESTING_PATTERNS.md](./TESTING_PATTERNS.md) — controller/route test patterns to close the [§9](#9-missing-test-coverage) gaps.
- [DATA_MODEL.md](./DATA_MODEL.md) — full model list (19 models), the plaintext-twin columns in [§5](#5-deprecated-kept-for-compat), and the DNAVariant/GeneticTrait removal.

---

## Acceptance questions

Self-answered from this doc alone.

**Q1. What's the single most important open Critical issue?**
**OF-01** (updated 2026-07-11): the production GCP service-account key committed in `202f2dd` is still recoverable from git history and its rotation is unverified — [§1](#1-critical), [`OPEN_FINDINGS.md`](./OPEN_FINDINGS.md). (The historical runtime Critical, C-8 BYPASSRLS, remains RESOLVED — [§10](#10-fixed-issues-reference).)

**Q2. How many TODO/FIXME/HACK markers exist, and which file has the most?**
4 markers total (3 live `TODO` + 1 `NOTE` describing a removed TODO); no `FIXME`/`HACK`/`XXX`. No file has more than one. Live TODOs: `encryption.ts:80`, `app.ts:130`, `PlanSection.tsx:162`; the NOTE is `csrf.ts:147` — [§6](#6-code-marker-inventory).

**Q3. Are any tests currently skipped or marked `.todo`?**
No skipped-debt and no `.todo`/`xit`. The only marker is `describe.skipIf(!hasLiveDb)` at `rls.test.ts:29` — an intentional live-DB gate, not debt — [§7](#7-skipped--todo-tests).

**Q4. What's the `npm audit` severity breakdown?**
9 total: 0 critical, 1 high (`hono`), 8 moderate (`uuid` transitive chain), 0 low — identical in root and backend — [§8](#8-dependency-vulnerabilities).

**Q5. Which deprecated models remain in `schema.prisma`, and is the DNAVariant/GeneticTrait removal recorded as resolved?**
No deprecated *models* remain (only legacy plaintext-twin *columns*, [§5](#5-deprecated-kept-for-compat)). DNAVariant/GeneticTrait were dropped in migration `20260423_drop_dna_genetics` (zero schema hits) and are recorded as resolved in [§10](#10-fixed-issues-reference).

**Q6. Which controllers have no test coverage at all?**
`aiChatController`, `fhirController`, `fileController`, plus `controllers/upload/labUploadController` and `sbcUploadController`. `insuranceController` IS covered — [§9](#9-missing-test-coverage).

**Q7. Is the RLS runtime gap (C-8) open or resolved?**
RESOLVED in production — prod hard-exits on a BYPASSRLS role (`assertNoBypassRLS`) and on any non-FORCE'd RLS table (`assertRLSForced`, M2); the transitional `RLS_ENFORCEMENT=strict` flag was removed. It lives in Fixed issues reference with no remaining runtime workaround — [§10](#10-fixed-issues-reference).

**Q8. Which recently closed issue introduced new known risk?**
The audit-metadata M6 drop (`20260615_drop_legacy_audit_metadata`) is irreversible, and the L24 filename-encryption rollout left operational debt L-3 (prod backfill not yet run) — [§10](#10-fixed-issues-reference), [§4 L-3](#l-3--user_filesoriginal_filename-re-encrypt-backfill-not-yet-run-in-production-operational).

**Q9. Is the `nul` stray file still in the tree?**
No — not present at the repo root and not tracked by git at HEAD — [§10](#10-fixed-issues-reference).

**Q10. Which axios / vite advisories are open, and what's the remediation plan?**
None — no `axios` or `vite` advisories are open at HEAD (the earlier `form-data`/`vite` advisories were cleared by `npm audit fix`). The live open advisories are `hono` (high) and the `uuid` transitive chain (moderate); plan in [§8](#8-dependency-vulnerabilities) (apply non-breaking `npm audit fix` for `hono`; hold the breaking `uuid@14`).

---

## 12. Prompt drift log

- `./20-known-issues-doc.md` and its example `npm audit` table reference **`axios` / `vite`** advisories. At HEAD `fb2cd32` those are **closed**; the live open set is `hono` (1 high) + a `uuid` transitive chain (8 moderate). Acceptance Q10's expected "axios/vite open" answer is now "none open" — prompt author should refresh the example advisory names.
- The fact-digest's DB-schema section shows intermediate recounts of **17 then 18** Prisma models; the canonical count (per the task's CANONICAL NUMBERS and including `RevokedAccessToken`) is **19**. This doc uses 19. Prompt author should reconcile `00-index.md` "Verified codebase counts".
- The bundled `CLAUDE.md` still lists `backend/src/controllers/uploadController.ts` and "10 controllers / 13 route files / 18 services". Live counts: upload logic moved to `backend/src/controllers/upload/` (`labUploadController.ts`, `sbcUploadController.ts`, `shared.ts`, `index.ts`); 18 route files; 27 top-level services. The prompt itself already accounts for this (it says `uploadController` no longer exists) — flagging the stale `CLAUDE.md` for the quarterly refresh.
- `SECURITY_STATUS.md` and `CHANGELOG.md` are cross-linked as the authoritative security/closed-item sources; both are part of the doc set produced by this same generation run (the `New Project Documents/` folder is being regenerated). If a sibling has not yet been generated when this doc is read, treat the link as pending that run.
