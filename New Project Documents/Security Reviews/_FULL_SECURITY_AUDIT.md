# OwnMyHealth Security Audit Report

**Date:** 2026-06-01
**Auditor:** Claude
**Scope:** Full codebase review — consolidation of 23 individual security reviews (prompts 01-13, 26-32, 41-43)

---

## Executive Summary

This report consolidates the findings of 23 domain security reviews run on 2026-06-01. Findings
are de-duplicated with a carry-forward rule: a single underlying issue surfaced by multiple reviews
is listed once, at its highest assigned severity, with all sourcing reviews noted. The severity
table below counts each distinct issue once.

| Severity | Found | Fixed | Open |
|----------|-------|-------|------|
| Critical | 0 | 0 | 0 |
| High | 2 | 0 | 2 |
| Medium | 19 | 0 | 19 |
| Low | 41 | 0 | 41 |

> Notes on aggregation:
> - **No code was modified** by any review (report-only protocol), so **Fixed = 0** and **Open = Found** for every row.
> - The raw per-review tallies sum to roughly 1 High (×3 of the duplicate counted once = effectively 2 distinct High), ~36 Medium line-items, and ~85 Low line-items. After applying the carry-forward de-duplication rule, the distinct-issue counts are **2 High / 19 Medium / 41 Low**. The largest single collapse is the missing `aiSpendGuard` on the three upload routes, which appeared as a finding in **5 separate reviews** (08, 09, 27, 42, 43) and is counted once here (at High, its top severity in review 42).
> - "Info" observations (≈22 across the reviews) and "Prompt drift" notes are not counted in the severity table; the substantive prompt-drift items are summarized in their own section.

**Overall Grade: B**

**Justification.** The platform's core PHI-protection controls are genuinely strong and were
verified at the code level across every review: AES-256-GCM with authenticated decryption and
per-user PBKDF2-SHA512 keys (02); `requireEnv`-gated secrets with production boot hard-fails and no
hardcoded keys (11); HS256-pinned JWT with single-use row-locked refresh rotation, real lockout, and
memory-only frontend tokens (03, 10); row-level security backstopped by a production `BYPASSRLS`
hard-exit (01, 26); CSRF double-submit with constant-time compare (04); a real SSRF allowlist on
every credential-bearing FHIR egress (09, 41); and a backend stream-proxy download path that removed
signed-URL egress (28). **Zero Critical and only two High findings** were identified, and both High
items are bounded (one is a conditional log-PHI leak on a malformed-extraction path, one is a
billing-exposure gap, not a PHI-disclosure or auth-bypass path).

The grade is held at **B** rather than A because of a recurring structural theme the reviews
surfaced independently: **"designed-but-unwired" controls.** The dollar circuit breaker exists but
is absent from the three most expensive (document-extraction) routes; the audit schema has
`success`/`errorMessage` columns that the service never writes, so every failed privileged action is
recorded as a success; the `RoleGuard`/`useRBAC` capability layer and `redactPatientBanner` PHI
helper are dead code presented in specs as live controls; and the in-memory rate-limit/spend
accumulators silently degrade to N×limit under autoscale. None of these is individually severe, but
together they mean several advertised defenses are weaker than they appear. Closing the two High and
the top Medium items (especially the `aiSpendGuard` and audit-column gaps) would move this to a
solid A-.

---

## Findings

### Critical

None found across any of the 23 reviews.

---

### High

#### H-1 — OCR rejects an out-of-range biomarker by logging its raw PHI value
- **Location:** `backend/src/services/ocrService.ts:223-227`
- **Description:** When a Claude/Document-AI-extracted biomarker fails validation, the handler logs the raw extracted `value` (plus `biomarkerName`) at `warn` level. `value` is **not** in the logger's `SENSITIVE_FIELDS` set (only `valueEncrypted`/`biomarker` are), so `sanitizeData` passes it through verbatim, and `warn` survives the production log gate — the value reaches Cloud Logging in cleartext. Verified against live code: the log object literally contains `value: b.value`.
- **Impact:** A patient's lab measurement (glucose, hormone level, viral load) is persisted to Cloud Logging unredacted, readable by any operator with `logging.viewer` and with **no audit-log entry** — exactly the HIPAA-breach class the logging review exists to prevent. Triggered on every malformed/out-of-range extraction, which is common on messy lab PDFs.
- **Recommendation:** Drop `value` from the log object (log only `biomarkerName` + `validationReason`), or add `value` to `SENSITIVE_FIELDS` in `logger.ts`. Per-call removal is cleaner since the value has no operational use here.
- **Source:** see 31-logging-observability-review.md F-1.

#### H-2 — Claude/Document-AI upload routes have no dollar circuit breaker (`aiSpendGuard` missing) — *(carried forward from 5 reviews)*
- **Location:** `backend/src/routes/uploadRoutes.ts:77-85` (`/lab-report`), `:94-102` (`/insurance-sbc`), `:124-132` (`/lab-results-ocr`)
- **Description:** All three `/upload/*` routes invoke a paid external AI API — `lab-report` and the PDF branch of `lab-results-ocr` go through `processDocument` → `extractBiomarkersWithClaude`, and `insurance-sbc` calls `extractInsuranceFromSBC` (Claude Sonnet, `max_tokens: 16384`, the single most expensive metered call in the app). Each accrues real cost via `trackAIUsage`, yet the route guard stacks carry only `aiLimiter` + `blockDemoAI` + `requirePlanLimit('pdfUploadsPerMonth')` — **no `aiSpendGuard`** (the file does not even import it). Verified against live code. Every other AI route (`aiRoutes.ts:32`, `biomarkerRoutes.ts:123`, `expenseRoutes.ts:114`, `insuranceRoutes.ts:123,136`) does carry it. The same SBC handler is reachable two ways with asymmetric protection: `POST /insurance/upload-sbc` is dollar-capped, `POST /upload/insurance-sbc` is not.
- **Impact:** Once the daily USD budget is exhausted, the documented runaway-billing backstop still refuses chat/guidance/analyze but these upload routes keep calling Claude/Document AI. `pdfUploadsPerMonth` is `-1` (unlimited) on TEAM, so a TEAM account has no per-request count cap **and** no dollar cap on the most expensive path; a compromised key or buggy loop drives unbounded Anthropic billing.
- **Recommendation:** Add `aiSpendGuard` to all three upload routes (after `authenticate`/`aiLimiter`, before the handler), matching the order in `aiRoutes.ts`/`insuranceRoutes.ts`. This also closes the `/insurance/upload-sbc` vs `/upload/insurance-sbc` asymmetry.
- **Severity note:** Rated **High** in 42-ai-cost-control (its deep-owner review) and **Medium** in the four survey reviews that also caught it; listed once here at the top severity.
- **Source:** see 42-ai-cost-control-review.md F-1 (High); also 08-rate-limiting-review.md F-1, 09-external-apis-review.md F-1, 27-ai-integration-review.md F-1, 43-plan-gating-billing-review.md F-4.

---

### Medium

#### M-1 — Audit `success`/`errorMessage` columns are never written; every failed action is recorded as a success — *(2 reviews)*
- **Location:** `backend/src/services/auditLog.ts:243-255` (the `data` object in `log()`); columns at `backend/prisma/schema.prisma:471-472`
- **Description:** The `AuditLog` schema defines `success Boolean @default(true)` and `errorMessage String?`, and callers pass failure context (`LOGIN_FAILED`, denied provider access, `self_deletion_blocked`, `email_confirmation_mismatch`, etc.). But the `log()` write object never sets `success` or `errorMessage` — verified against live code (the object ends at `metadata`). Failure signal lands only in the free-form `metadata` JSON. The admin Audit Log UI renders pass/fail from `log.success`, so blocked/failed admin actions show as "OK".
- **Impact:** A compliance query `WHERE success = false` returns zero rows even though failed logins, lockouts, and denied admin/provider access occurred — exactly the events a HIPAA reviewer filters on. Detection of brute-forced or fat-fingered privileged operations is silently degraded.
- **Recommendation:** Add `success: entry.success ?? true` and `errorMessage: entry.errorMessage` to the `data` object, thread the fields through `AuditLogEntry`/`logAccess`, and have failure paths set `success: false` with a reason.
- **Source:** see 05-audit-logging-review.md F-1 and 30-admin-security-review.md F-1 (also noted in 05-F6 as spec drift).

#### M-2 — CSRF exemptions matched by `req.path.endsWith(...)` (over-broad suffix match) — *(2 reviews)*
- **Location:** `backend/src/middleware/csrf.ts:127,131,139`
- **Description:** CSRF exemptions for public-auth routes, the bearer-only streaming route, and the scheduler route are decided with `endsWith` suffix matching against the full request path, not exact/mount-aware equality. No live exploit today (`/ai/chat` is `requireBearerAuth`-only so a cross-site cookie POST fails auth; `/internal/audit-cleanup` fails closed), but any future route whose path *ends with* an exempt suffix — especially a cookie-eligible `/auth/...` suffix — silently inherits a CSRF exemption.
- **Impact:** Latent defense-in-depth gap; a developer adding a coincidentally-suffixed route reopens a CSRF hole with no signal at the route layer.
- **Recommendation:** Compare against the fully-qualified path (e.g. `/api/v1/ai/chat`) with `===`, or strip the mount prefix and match a fixed set, in all three checks.
- **Source:** see 04-csrf-review.md F-3 and 06-api-routes-review.md F-1.

#### M-3 — Admin `PATCH /provider-relationships/:id` accepts an unvalidated body — *(3 reviews)*
- **Location:** `backend/src/routes/adminRoutes.ts:693-721`
- **Description:** Unlike every other admin mutation, this route validates only the `:id` param and reads `status, canViewBiomarkers, canViewInsurance, canViewHealthNeeds, canEditData` straight off `req.body` with no Zod schema and no enum/boolean type-check. `status` flows into the `ProviderPatientStatus` column. ADMIN-only + Prisma enum rejection bound the blast radius, but it is the one mutating route on an authenticated surface with no request-body schema, and it lets an admin silently re-activate a patient-REVOKED relationship without re-consent.
- **Impact:** Inconsistent validation posture; invalid `status` surfaces as an opaque 500 instead of a clean 400/422, and the un-gated re-activation undermines "revocation cannot be undone."
- **Recommendation:** Add `schemas.admin.updateProviderRelationship` (`status` enum + the four booleans, optional) and `validate(...)` it on the route. Consider blocking admin re-activation of a REVOKED relationship without an explicit re-consent flag.
- **Source:** see 06-api-routes-review.md F-6, 07-input-validation-review.md F-1, 30-admin-security-review.md F-3.

#### M-4 — In-process MemoryStore / spend accumulator dilutes every cap to N×limit under autoscale — *(3 reviews)*
- **Location:** `backend/src/middleware/rateLimitStore.ts:71-82`; `backend/src/services/aiCostTracker.ts:39-41`; `backend/src/config/index.ts:125-127,188-198`; `.github/workflows/deploy.yml:88`
- **Description:** `createRateLimitStore` returns `undefined` when `REDIS_URL` is unset (the current default), so `express-rate-limit` falls back to per-instance `MemoryStore`; the AI spend accumulator (`globalSpentUsd`/`userSpentUsd`) is likewise per-instance module memory with no shared store and resets on redeploy. On Cloud Run with up to 3 instances every cap becomes 3×: login brute-force 5→15, `aiLimiter` 10/hr→30/hr, global $50/day→$150/day, per-user $5/day→$15/day. The `--max-instances=3` pin is the only thing bounding the dilution.
- **Impact:** Brute-force, AI cost-control, and anti-enumeration ceilings are all looser than configured; raising the instance pin without enabling Redis silently multiplies every cap. Redeploys can push daily spend past even N×budget.
- **Recommendation:** Provision Cloud Memorystore and set `REDIS_URL` (the code already supports it with distinct `rl:<prefix>:` namespaces); migrate the spend accumulator to the same shared store. Until then treat `--max-instances=3` as a hard coupling and document the worst-case ceiling.
- **Source:** see 08-rate-limiting-review.md F-2, 27-ai-integration-review.md F-3, 42-ai-cost-control-review.md F-2.

#### M-5 — 429 throttle events are not logged
- **Location:** `backend/src/middleware/rateLimiter.ts:17-170` (no `handler:` on any of the 8 limiters)
- **Description:** None of the 8 limiters define a custom `handler`; the default emits 429 with a static body but no application log. The dollar-cap `aiSpendGuard` does log its 503, so the asymmetry is clear.
- **Impact:** A burst of 429s — the strongest early signal of credential-stuffing, scraping, or AI-budget abuse — produces no log line, alert, or audit trail; operators cannot distinguish a legitimate cap-hit from an active attack.
- **Recommendation:** Add a shared `handler` (or factory wrapper) that calls `logger.warn('Rate limit exceeded', { prefix, key, path })` then sends the existing message; for `strictAuthLimiter` log a hashed email, not the raw `email:IP` key.
- **Source:** see 08-rate-limiting-review.md F-3.

#### M-6 — Plaintext `targetValue` PHI persisted alongside its encrypted twin — *(2 reviews)*
- **Location:** `backend/src/controllers/healthGoalsController.ts:401` (create), `:487` (update); column `backend/prisma/schema.prisma:410`
- **Description:** `HealthGoal.targetValueEncrypted` is the canonical PHI field and the read path already prefers it (`readTargetValue`), but both write paths still populate the legacy plaintext `targetValue Decimal` column on every create/update — not just for back-compat reads of old rows. A numeric health goal target (target cholesterol, A1c, weight) sits in the DB in cleartext.
- **Impact:** Defeats application-layer PHI encryption for this field: a DB dump/replica/backup leaks the target even though the encrypted column exists, and any future `PHI_FIELDS`-keyed sweep (export/deletion/redaction) skips the plaintext column.
- **Recommendation:** Stop writing `targetValue` for new rows (write only `targetValueEncrypted`), then ship a data migration that backfills `targetValueEncrypted` for null rows and NULLs/drops the plaintext column.
- **Source:** see 02-encryption-review.md F-1 and 01-database-schema-review.md F-1 (rated High in 01 as a DB-schema concern, Medium in 02; listed at Medium per the encryption deep-owner).

#### M-7 — Inline `decrypt()` in list/export hot paths has no per-field error handling
- **Location:** `backend/src/controllers/expenseController.ts:799` (and `:113-115,160-162,299-309`); `biomarkerController.ts:67`; `settingsController.ts:451-455,613` (data export)
- **Description:** The encryption service ships a graceful `decryptFields` helper that nulls per-field failures, but the high-volume list/export paths call `encryption.decrypt(...)` inline inside `.map()` with no try/catch. `decrypt()` throws on any corrupted/key-mismatched row, rejecting the entire request — including the HIPAA-mandated data export.
- **Impact:** A single bit-rotted/partially-rotated ciphertext row turns the user's whole expense/biomarker/cost-analysis list (and full account export) into a hard 500, denying access to all their other intact PHI. Availability/recoverability gap.
- **Recommendation:** Route these reads through `decryptFields`, or wrap each inline `decrypt` in a `tryDecrypt` helper that returns `null` and logs at warn. Prioritize the export path (`settingsController.ts:613`).
- **Source:** see 02-encryption-review.md F-2.

#### M-8 — SMART OAuth token-exchange / refresh / discovery fetches have no timeout
- **Location:** `backend/src/services/fhir/smartAuth.ts:102-104` (discovery), `:186-190` (code exchange), `:226-230` (refresh), `:294` (revoke)
- **Description:** Of the five outbound `fetch()` calls in the FHIR subsystem, only `FHIRClient.request` wraps the call in an `AbortController` (30s). The four SMART OAuth fetches pass no `signal`, inheriting Node's effectively-unbounded default. `exchangeCodeForToken` runs in the public OAuth callback; `refreshAccessToken` runs in sync.
- **Impact:** A hung/slow Quest token or discovery endpoint stalls the callback or sync request indefinitely, tying up a request slot — resource-exhaustion/availability gap (bounded to a trusted host + `sensitiveLimiter`).
- **Recommendation:** Wrap each `smartAuth.ts` fetch in an `AbortController` with a bounded timeout, or factor a shared `fetchWithTimeout` helper.
- **Source:** see 09-external-apis-review.md F-2.

#### M-9 — Connect-initiation and callback-failure FHIR paths emit no audit row — *(2 reviews)*
- **Location:** `backend/src/services/fhir/labSyncService.ts:95-103` (`buildConnectRedirect`); `backend/src/controllers/fhirController.ts:91-107` (`handleCallback` catch)
- **Description:** The only connect-path audit write is the success `CONNECT` row in `persistConnection`. `buildConnectRedirect` stashes the PKCE challenge and returns the authorize URL with no audit row, and the callback `catch` only `logger.error`s + redirects with `?error=connection_failed` — no `CONNECT_FAILED` row, unlike the symmetric `SYNC_FAILED`.
- **Impact:** A started-but-never-completed or repeatedly-failing connection attempt (forged/replayed `state`, token-exchange failure) leaves no queryable HIPAA audit evidence — an audit/forensics asymmetry, not a confidentiality breach.
- **Recommendation:** Emit `CONNECT_INITIATED` in `buildConnectRedirect` (userId in scope) and `CONNECT_FAILED` in the `handleCallback` catch (with `userId: undefined` + capped error when the exchange failed before `consumeChallenge`).
- **Source:** see 41-fhir-lab-integration-review.md F-1 and 05-audit-logging-review.md F-4.

#### M-10 — AI upload SBC extraction reachable via an unbounded second path *(see H-2)*
- This is the SBC-asymmetry facet of **H-2** (`POST /upload/insurance-sbc` unguarded vs `POST /insurance/upload-sbc` guarded). Tracked under H-2; not double-counted in the severity table. Listed here only so the asymmetry is visible to readers scanning the Medium tier.
- **Source:** see 27-ai-integration-review.md F-1, 42-ai-cost-control-review.md F-1, 43-plan-gating-billing-review.md F-4.

#### M-11 — FHIR inline handlers reflect raw downstream `err.message` into 5xx bodies — *(2 reviews)*
- **Location:** `backend/src/controllers/fhirController.ts:170-176` (`triggerSync`), `:197-203` (`deleteConnection`)
- **Description:** Both inline catch blocks place the raw error message into the user-facing 500 body (`message: err.message`). These originate from the SMART/Quest stack and can surface OAuth/SMART error strings, upstream HTTP detail, or internal hostnames. Because the controllers write their own response (not `next(err)`), they bypass the central handler's generic-message collapse, so the leak is unconditional in prod/staging.
- **Impact:** An authenticated user (plan-gated, demo-blocked) can probe the Quest integration and read verbatim downstream error text — internal-detail leakage. RLS-scoped to the caller's own connections, so not cross-user PHI.
- **Recommendation:** Return a fixed generic message with the stable code and keep `logger.error` for server-side detail; better, `throw new ExternalServiceError(...)` so the central handler formats the body.
- **Source:** see 32-error-handling-review.md F-1 and 09-external-apis-review.md F-4 (the client-surfaced verbatim-message facet).

#### M-12 — `sensitiveLimiter` on export/delete is IP-keyed, not user-keyed
- **Location:** `backend/src/middleware/rateLimiter.ts:92` (definition); applied across `backend/src/routes/settingsRoutes.ts` (export `:88`, delete-data `:100`, delete-account `:109`)
- **Description:** `sensitiveLimiter` has no `keyGenerator`, so it defaults to client-IP. Every sensitive settings endpoint (profile/notifications/health-profile reads + export + both deletes) shares one IP-scoped 10/hour bucket. Sibling limiters (`aiLimiter`, provider limiter) explicitly key by `req.user?.id`.
- **Impact:** (1) Legit-user DoS — multiple users behind one NAT/VPN IP contend for the same budget, and routine reads can lock a different user out of their right-of-access export. (2) The per-account abuse cap on the expensive full-record export does not exist.
- **Recommendation:** Add a `keyGenerator` mirroring `aiLimiter` (`req.user?.id ?? req.ip`). Consider a tighter dedicated limiter for export/delete separate from cheap reads.
- **Source:** see 29-data-portability-review.md F-1.

#### M-13 — `deleteAccount` writes a DELETE-User "success" audit row before deletion can abort
- **Location:** `backend/src/controllers/settingsController.ts:920` (logDelete) vs `:941-962` (GCS abort) and `:965-969` (cascade)
- **Description:** `logDelete('User', ...)` runs at line 920 — before `revokeAllUserConnections`, the GCS delete, the fail-hard GCS check, and the actual `tx.user.delete`. If a GCS object fails to delete, the handler throws with the account **preserved**, yet a primary `action=DELETE resourceType=User` row (marked as a success entry) already claims the user was deleted. `deleteAllData` does the opposite (logs after deletes complete). A compensating `DELETE_ACCOUNT_FAILED` system row exists, so truth is reconstructable by correlation, but the canonical entry is misleading.
- **Impact:** Audit-trail accuracy gap for the most consequential HIPAA event; a "was user X deleted?" query returns a false positive on the primary log.
- **Recommendation:** Move `logDelete('User', ...)` to after the successful `tx.user.delete`, matching `deleteAllData`.
- **Source:** see 29-data-portability-review.md F-2.

#### M-14 — Admin demotion / PATCH-deactivation does not invalidate the target's sessions
- **Location:** `backend/src/routes/adminRoutes.ts:322-326` (session wipe gated on `if (password)` only)
- **Description:** In `PATCH /users/:id` the only branch that deletes sessions is `if (password)`. A role downgrade (ADMIN→PATIENT) or a PATCH deactivation (`isActive:false`) leaves the target's existing access token valid; `authenticate` re-reads role from the JWT but never re-checks `isActive`/current role against the DB. The dedicated `DELETE /users/:id` route does wipe sessions, so two "deactivate" paths behave differently.
- **Impact:** A just-demoted admin keeps performing admin actions, or a just-deactivated user keeps reading PHI, for up to the access-token TTL (~15 min). The refresh path fails closed (`refreshTokens` rejects `!isActive` and re-reads role), so the window cannot extend past one access-token lifetime — hence Medium.
- **Recommendation:** In the PATCH transaction also `tx.session.deleteMany({ where: { userId: id } })` when the role changes or `isActive` transitions to false, and surface `revokedSessionCount` in audit metadata.
- **Source:** see 30-admin-security-review.md F-2.

#### M-15 — `staging` workflow still builds and pushes a mutable `:latest` tag
- **Location:** `.github/workflows/deploy-staging.yml:47-52`
- **Description:** Staging tags and pushes both `:${{ github.sha }}` and a mutable `:latest` to Artifact Registry; the deploy step references only the SHA, so `:latest` is dead weight that re-introduces the "two coexisting current-image pointers" hazard prod deliberately removed.
- **Impact:** A future hand-rolled `gcloud run deploy ... :latest` or external consumer gets whatever the most recent staging push was, which may match no environment; mutable tags widen the supply-chain surface. Blast radius is staging.
- **Recommendation:** Remove the `IMAGE_LATEST` variable and both `-t`/`push` lines so staging matches prod's SHA-only convention.
- **Source:** see 12-cicd-security-review.md F-1.

#### M-16 — Backend production image ships source maps (`.js.map` / `.d.ts.map`)
- **Location:** `backend/tsconfig.json:14-16`, `backend/Dockerfile:40`
- **Description:** `tsc` compiles with `sourceMap`/`declarationMap` true, and the Dockerfile copies the whole `dist/` with no strip step, so production maps ship in the running container. Not currently served over HTTP (no static `dist/` route), so defense-in-depth degradation rather than direct disclosure.
- **Impact:** If a `.map` is ever served or extracted from the image, it reconstructs original TypeScript (names, comments, paths, control flow), easing discovery of validation gaps, RLS edges, and encryption logic.
- **Recommendation:** Set `sourceMap`/`declarationMap` false for the prod build, or add `RUN find ./dist -name '*.map' -delete` in the production stage.
- **Source:** see 12-cicd-security-review.md F-2.

#### M-17 — CI dependency audit gate is `--audit-level=high`, so live moderate advisories pass — *(2 reviews)*
- **Location:** `.github/workflows/ci.yml:121-125`
- **Description:** Both audit steps run `npm audit --audit-level=high`. The backend tree reports **8 moderate** advisories (frontend 0): `uuid <11.1.1` (GHSA-w5hq-g745-h8pq) transitively via `@google-cloud/storage`, and `@hono/node-server <1.19.13` (GHSA-92pp-h63x-v22m) via `@prisma/dev`. None is High, so the gate stays green and these ship un-flagged. Exploitability is currently low (the `uuid` flaw needs an attacker-controlled `buf` not used here; `@hono/node-server` is dev-only and excluded from the prod image via `npm ci --omit=dev`).
- **Impact:** A moderate advisory in a PHI-handling dependency can sit in the image indefinitely without CI surfacing it; a re-scored or newly-exploitable moderate gives no warning.
- **Recommendation:** Lower the gate to `--audit-level=moderate` (triage/allowlist known-unreachable) or add a non-blocking `npm audit --audit-level=moderate || true` reporting step. **Do not** run `npm audit fix --force` — it proposes breaking majors (`uuid@14`) and a Prisma **downgrade** (`prisma@6.19.3`).
- **Source:** see 13-dependency-health-review.md F-1 and 12-cicd-security-review.md F-3; the underlying advisories are also noted in 01-F5, 03, 04, 07-F7, 09, 11, 27, 28-F4, 30-F7.

#### M-18 — `redactPatientBanner` documented as a live Claude-Vision PHI control but is unwired and fails open — *(2 reviews)*
- **Location:** function `backend/src/utils/pdfRedaction.ts:47`; doc claim `New Project Documents/TROUBLESHOOTING.md:578`
- **Description:** TROUBLESHOOTING.md lists `pdfRedaction.redactPatientBanner` as covering the top-15% banner of every PDF page sent to "Claude Vision," but there is **no Claude Vision path** (the extractors reject scanned PDFs and route to OCR) and the function has **zero callers**. It additionally **fails open** — any pdf-lib error returns the original unredacted buffer.
- **Impact:** A stale "this is protected" doc is a classic precondition for a PHI leak: if a future engineer wires an image-to-Claude path trusting the table, raw banner PHI (name/DOB/MRN/address) ships unredacted, and even calling the helper fails open on a malformed PDF.
- **Recommendation:** Either delete the dead code and the doc row, or — if a Vision path is planned — change the helper to fail **closed** before wiring it. At minimum correct the doc.
- **Source:** see 28-file-storage-review.md F-1 (Medium) and 31-logging-observability-review.md F-8 (Info, dead-code observation).

#### M-19 — Scanned-PDF uploads to the OCR endpoint are rejected, not OCR'd (routing dead-end)
- **Location:** `backend/src/services/ocrService.ts:393-410` (`processDocument`), reached from `labUploadController.ts:210`
- **Description:** The OCR endpoint routes **all** PDFs — including scanned ones — through `processPDFWithClaude` → `extractBiomarkersWithClaude`, which is text-only and throws for scanned PDFs. `processImageWithDocumentAI` is reached only for `image/*` MIME, never `application/pdf`. So a user who uploads a scanned lab as a PDF (as instructed) hits a hard error; only PNG/JPEG/TIFF works, and the BAA-gated Document AI path is unreachable for PDFs.
- **Impact:** Not a breach, but a minimum-necessary/availability gap; users may try to force usable text out (defeating the redaction-before-AI design) or abandon.
- **Recommendation:** When a PDF's local text extraction is not usable, route the PDF bytes to `processImageWithDocumentAI` (it accepts `application/pdf`) gated behind `documentAiBaaActive`; or correct the UX copy.
- **Source:** see 28-file-storage-review.md F-2.

#### M-20 — `insurancePlans` plan limit counted and advertised but never enforced
- **Location:** `backend/src/routes/insuranceRoutes.ts:80-84`; counter `usageTracker.ts:81-83`; UI `PlanSection.tsx:35,62-63`
- **Description:** `POST /insurance/plans` runs only `authenticate` + `validate` — no `requirePlanLimit('insurancePlans')` (zero grep hits). The usage bar and over-limit copy are shown to the user, but the server never blocks.
- **Impact:** A FREE user (`insurancePlans: 1`) can create unlimited plans via the API; the displayed cap is a promise the API doesn't keep (UI-only enforcement). Low PHI/abuse blast radius (own data under RLS) but a real authorization-integrity gap.
- **Recommendation:** Add `requirePlanLimit('insurancePlans')` to the `POST /plans` chain.
- **Source:** see 43-plan-gating-billing-review.md F-1.

#### M-21 — `maxBiomarkers` plan limit counted but never enforced on manual/batch entry
- **Location:** `backend/src/routes/biomarkerRoutes.ts:83-87` (create), `:91-96` (batch); counter `usageTracker.ts:80`
- **Description:** Neither `POST /biomarkers` nor `POST /biomarkers/batch` carries `requirePlanLimit('maxBiomarkers')` (zero grep hits). The PDF *upload* path is bounded by `pdfUploadsPerMonth`, but direct manual/batch writes are not.
- **Impact:** A FREE user (`maxBiomarkers: 50`) can store unlimited biomarkers by direct entry; the displayed "Biomarkers stored" cap is unenforceable through the documented gate.
- **Recommendation:** Add `requirePlanLimit('maxBiomarkers')` to the create and batch chains; decide per-row vs count-before policy for batch.
- **Source:** see 43-plan-gating-billing-review.md F-2.

#### M-22 — `providerSharing` is a paid boolean feature but no route enforces it
- **Location:** flags `backend/src/config/plans.ts:55,74,93`; consent routes `backend/src/routes/patientRoutes.ts:180-476`; UI `PlanSection.tsx:45`
- **Description:** `providerSharing` is `false` on FREE / `true` on PRO/TEAM and is rendered as a locked feature, but no route calls `requirePlanFeature('providerSharing')` (zero grep hits). The patient consent routes run only `authenticate` + `requireRole('PATIENT')`, so a FREE user can approve provider access and grant sharing consent.
- **Impact:** Either an entitlement bypass (FREE users get a Pro feature) or an intentional carve-out (consent-based sharing of one's own PHI is arguably a patient right, like ungated `dataExport`). The code does not document which; the flag and enforcement are out of sync.
- **Recommendation:** Resolve the product question. If paid: add `requirePlanFeature('providerSharing')` to the consent-granting routes. If a right: set `providerSharing: true` across tiers and stop rendering it as locked.
- **Source:** see 43-plan-gating-billing-review.md F-3.

---

### Low

> The 41 distinct Low findings below are hardening, hygiene, prompt-drift, and dead-code items. Each cites the source review. Several appear in multiple reviews and are de-duplicated.

**Authentication / rate-limit keying**
- **L-1 — `strictAuthLimiter` email key is attacker-controlled and unnormalized** (case/whitespace variants and cross-account spraying not bounded; `authLimiter` IP cap is the backstop). `backend/src/middleware/rateLimiter.ts:67-72`. *(2 reviews — see 08-F5, and the related collision note in 03-F1.)*
- **L-2 — `strictAuthLimiter` keys on `req.body.email`, but `/change-email`/`/confirm-email-change` carry no `email`**, collapsing both routes to one shared `:<ip>` bucket (stricter, not looser — UX nit). `rateLimiter.ts:67`; `authRoutes.ts:96-101,127-133`. See 03-csrf? — see 03-authentication-review.md F-1.

**Redis / observability degradation**
- **L-3 — Redis-unreachable path silently degrades to N×limit at runtime** with only an error log; the `RedisStore` built once at boot is not swapped out when Redis goes flaky. `backend/src/middleware/rateLimitStore.ts:32-64`. See 08-rate-limiting-review.md F-4.
- **L-4 — Logger structured-JSON + level suppression skip the `staging` environment** (gates on `isProduction` only), so deployed staging emits verbose pretty-text and auth-flow logs. `backend/src/utils/logger.ts:80,88`. See 31-logging-observability-review.md F-4.

**Logging / redaction coverage**
- **L-5 — Snake_case FHIR OAuth tokens (`access_token`/`refresh_token`) and `authorization`/`cookie` are not in the backend `SENSITIVE_FIELDS` set** (no active leak today; one-line regression away). `backend/src/utils/logger.ts:21-30`. See 31-logging-observability-review.md F-2.
- **L-6 — `sanitizeData`/`sanitizeValue` recursion has no depth or cycle guard** (a self-referential/deep object on a logged path overflows the stack — availability). `backend/src/utils/logger.ts:39-56`. See 31-logging-observability-review.md F-3.
- **L-7 — Recipient email logged in cleartext** (interpolated into the message string and as raw `data.to`, which is not a redacted key). `backend/src/services/emailService.ts:306,330,335,338`. See 31-logging-observability-review.md F-5.

**Input validation gaps**
- **L-8 — `dateString` validator accepts any `Date`-parseable string, not strict ISO 8601** (timezone off-by-one risk; backs biomarker/insurance/expense/goal/audit-filter dates). `backend/src/middleware/validation.ts:128-132`. See 07-input-validation-review.md F-2.
- **L-9 — Admin audit-log filter strings (`action`, `resourceType`) are unbounded** (no `.max()` cap unlike `search`). `backend/src/middleware/validation.ts:771-779`. See 07-input-validation-review.md F-3.
- **L-10 — `biomarker.update` / batch / insurance `update` use bare `z.number()` (no `finiteNumber`)**, so `Infinity` is accepted on PATCH/batch numeric fields, corrupting in-range/cost math. `backend/src/middleware/validation.ts:322,337-347,418-421,438-453`. See 07-input-validation-review.md F-4.

**API/route contract & hardening**
- **L-11 — AI-guidance timeout/failure branches use a non-standard error shape** (`{ success:false, error:'<string>' }` vs the structured `{ code, message }`). `backend/src/routes/biomarkerRoutes.ts:284,289`. See 06-api-routes-review.md F-3.
- **L-12 — `requireJsonContentType` skips Content-Type enforcement on empty-body mutations** (relies on CSRF/JWT; minor hardening loss). `backend/src/middleware/validation.ts:205`. See 06-api-routes-review.md F-4.
- **L-13 — `POST /fhir/sync/:connectionId` has no outbound-spend circuit breaker distinct from `sensitiveLimiter`** (10/hr is the only ceiling on outbound FHIR fetch+decrypt volume). `backend/src/routes/fhirRoutes.ts:42-50`. See 06-api-routes-review.md F-5.
- **L-14 — Inline error bodies omit `success: false`** in `aiChatController`/`fhirController` (diverges from the `ApiResponse` contract). `aiChatController.ts:133-154`, `fhirController.ts:44-202`. See 32-error-handling-review.md F-3.
- **L-15 — `fhirController.handleCallback` returns a bare-string error body** (`{ error: 'Missing code or state' }`) — most divergent shape; browser lands on raw JSON. `backend/src/controllers/fhirController.ts:87`. See 32-error-handling-review.md F-4.
- **L-16 — Inline `details` populated for non-`ValidationError` paths in `biomarkerController`** batch create (contract reserves `details` for validation; 400 path ships per-item exception strings). `backend/src/controllers/biomarkerController.ts:528-534,576-586`. See 32-error-handling-review.md F-5.
- **L-17 — `resendVerification` is an account-enumeration oracle** (400 for already-verified existing email vs 200 otherwise), contradicting its own "don't reveal if user exists" comment. `authController.ts:700-725`; `authService.ts:941-951`. See 32-error-handling-review.md F-2.

**Frontend auth**
- **L-18 — `RoleGuard`/`useRBAC` capability flags are dead code** presented in specs as the live UI gating mechanism (real gating is the inline `categories[].roles` filter in `Dashboard.tsx`). `RoleGuard.tsx:44`, `useRBAC.ts:24`, `Dashboard.tsx:135`. *(3 reviews — see 10-F1, 26-F7, 30-F5.)*
- **L-19 — A real demo session has no UI indicator** ("Demo Mode" badge only renders when logged out). `src/components/dashboard/DashboardHeader.tsx:139`. See 10-frontend-auth-review.md F-2.
- **L-20 — CSRF cookie regex is unanchored** and could match a same-suffix cookie name (self-inflicted 403 at worst). `src/services/api/client.ts:122`. See 10-frontend-auth-review.md F-3.
- **L-21 — `/auth/logout-all` is not in the 401-refresh / 429-retry exempt list** (avoidable extra round-trip / re-entrant logout). `src/services/api/client.ts:248`. See 10-frontend-auth-review.md F-4.
- **L-22 — One-shot 401-refresh retry drops the `retryCount429` counter on the main error branch** (latent; `isRetry` guard masks it today). `src/services/api/client.ts:306`. See 10-frontend-auth-review.md F-5.
- **L-23 — "Care Team" patient-consent nav item is not role-restricted** (shown to PROVIDER/ADMIN; backend 403s, so cosmetic). `src/data/sampleData.ts:229`. See 26-provider-collaboration-review.md F-6.

**Provider collaboration**
- **L-24 — Provider access-request audit row is not atomic with the relationship write** (audit `logCreate` runs after the tx commits; failClosed 500 leaves an orphaned PENDING row). `providerRoutes.ts:227,271`. See 26-provider-collaboration-review.md F-1.
- **L-25 — `canViewInsurance`/`canEditData` are grantable but have no consuming route** (orphaned permissions; consent UI overstates capability). `providerRoutes.ts` vs `validation.ts:557,559`. See 26-provider-collaboration-review.md F-3.
- **L-26 — `requireResourceAccess`/`requireOwnership`/`checkProviderPatientAccess`/`enforceUserScope` are dead code on the collaboration path** (parallel, tested-but-unused authz logic that can drift from the inline handler checks). `backend/src/middleware/rbac.ts:121,202,256,320`. See 26-provider-collaboration-review.md F-4.
- **L-27 — Dead helper `checkProviderPatientAccess` maps `healthNeed` reads to the biomarker flag** (latent permission-scope inversion if ever wired). `backend/src/middleware/rbac.ts:238-242`. See 26-provider-collaboration-review.md F-5.
- **L-28 — `Dashboard.renderCategory` re-renders provider/admin pages without a role recheck** (relies solely on the nav filter; `RoleGuard` family unused). `src/components/dashboard/Dashboard.tsx:300-317`. See 26-provider-collaboration-review.md F-7.

**Admin / audit**
- **L-29 — Audit-log query returns raw encrypted PHI columns to the admin client** (`previousValueEncrypted`/`newValueEncrypted` serialized though the UI never uses them; ciphertext, not plaintext). `backend/src/routes/adminRoutes.ts:894-905`. See 30-admin-security-review.md F-4.
- **L-30 — `/audit-logs` date range is unbounded** (limit capped at 200, but a query with no `startDate`/`endDate` scans the whole 7-year table for `count`/order; ADMIN-only, no dedicated limiter). `validation.ts:771-779`, `adminRoutes.ts:885-889`. See 30-admin-security-review.md F-6.

**AI integration / cost**
- **L-31 — `reset()` for Anthropic key rotation is never invoked outside tests** (rotating `ANTHROPIC_API_KEY` has no effect until restart). `backend/src/services/anthropicClient.ts:75-77`. *(2 reviews — see 27-F2, and the operational caveat in 09-F3.)*
- **L-32 — Chat message length cap (200 via `sanitizeForPrompt`) far below the validated Zod bound (2000/5000)** — normal-length questions are silently truncated before reaching Claude. `validation.ts:55-61,658`; `aiChatController.ts:169-175`. See 27-ai-integration-review.md F-4.
- **L-33 — Biomarker-guidance route comment claims "fetch (no SDK)" but the code uses the shared SDK client.** `backend/src/routes/biomarkerRoutes.ts:114` vs `:231-236`. See 27-ai-integration-review.md F-5.
- **L-34 — Biomarker guidance records spend only when `response.usage` is present** (other 4 call sites use `?? 0` unconditionally — one path can skip tracking entirely). `backend/src/routes/biomarkerRoutes.ts:247-255`. See 42-ai-cost-control-review.md F-4.
- **L-35 — Blocked/failed AI chats consume the user's daily chat quota** (counter filters `resourceType`+`action='READ'`, not `operation`, so `CHAT_BLOCKED_NO_BAA`/`CHAT_FAILED` still burn quota). `aiChatController.ts:130-132,289-293`; `usageTracker.ts:69-75`. *(2 reviews — see 42-F5, 43-F5.)*

**Plan gating / billing**
- **L-36 — TOCTOU: finite plan limits can be exceeded by concurrent in-flight requests** (count-then-allow with no atomic reservation; `aiSpendGuard` is the dollar backstop, but uploads lack it per H-2). `usageTracker.ts:148-157`; `planGating.ts:87-108`. See 43-plan-gating-billing-review.md F-6.
- **L-37 — Plan-gate DB-failure fallback degrades to the (stale, more-permissive) JWT plan** (drops the `planExpiresAt` downgrade during a DB blip). `backend/src/middleware/planGating.ts:76-84`. See 42-ai-cost-control-review.md F-6.
- **L-38 — Request-time expiry downgrade is not reflected in `GET /api/v1/plan` reported limits** (an expired PRO user sees PRO limits though enforcement is FREE). `backend/src/routes/planRoutes.ts:72-84`. See 43-plan-gating-billing-review.md F-7.

**FHIR**
- **L-39 — PKCE verifier cache is in-process; multi-instance callbacks silently fail** (callback on a different instance → null verifier → "Invalid or expired OAuth state"; fails closed, compounds the unaudited gap M-9). `backend/src/services/fhir/smartAuth.ts:317-353`. See 41-fhir-lab-integration-review.md F-2.
- **L-40 — DNS-rebinding residual: host validated but resolved IP not pinned** (documented accepted risk; requires DNS control of an already-allowlisted host). `backend/src/services/fhir/urlSafety.ts:9-16,56-91`. See 41-fhir-lab-integration-review.md F-3.
- **L-41 — `extractLOINCCoding` accepts non-LOINC codes, so non-LOINC observations import under "Other"** with a name derived from arbitrary display/free-text (data-integrity, not PHI exposure). `loincMapper.ts:162-177`; `labSyncService.ts:464-491`. See 41-fhir-lab-integration-review.md F-4.

**Other hygiene (also noted as Low in their reviews)**
- `revokeToken` derives the revoke endpoint by string-replacing `/token`→`/revoke`, risking a silent no-op revocation if the token URL doesn't end in `/token` (SSRF-re-validated, so no exfil). `smartAuth.ts:287-294`. See 09-external-apis-review.md F-5.
- `Content-Disposition` lacks RFC 5987 `filename*` for non-ASCII names (header-injection blocked; UTF-8 names mangled). `fileController.ts:243-250`. See 28-file-storage-review.md F-3.
- `deleteAllData` revokes lab OAuth tokens only locally, not at the provider (inconsistent with `deleteAccount`; token outlives local deletion until natural expiry). `settingsController.ts:844`. See 29-data-portability-review.md F-3.
- Third-party GitHub Actions pinned by mutable tag, not SHA (supply-chain; handles `GCP_SA_KEY`). `.github/workflows/*.yml`. *(2 reviews — see 11-F6, 12-F5.)*
- No top-level `permissions:` block in any workflow → broad default `GITHUB_TOKEN` scope. `.github/workflows/*.yml`. See 12-cicd-security-review.md F-4.
- Long-lived GCP JSON service-account key instead of keyless Workload Identity Federation. `.github/workflows/*.yml`. See 12-cicd-security-review.md F-6.
- Backend base image not digest-pinned (`node:20-alpine` is a moving tag; `apk upgrade` mitigates). `backend/Dockerfile:4,24`. See 12-cicd-security-review.md F-7.
- `.env.example` omits ~13 env vars the code reads (SendGrid/GCS/BAA/AI-budget/FHIR-allowlist). `backend/.env.example`. See 11-environment-secrets-review.md F-1.
- `BCRYPT_ROUNDS` documented as 12 but code default is 13. `backend/.env.example:107-109` vs `config/index.ts:100`. See 11-environment-secrets-review.md F-2.
- Dead CMS/OpenAI integrations still documented as live secrets in `.env.example`. `backend/.env.example:189-203`. See 11-environment-secrets-review.md F-3.
- `RLS_ENFORCEMENT` documented as a live flag but is dead code. `backend/.env.example:88-95` vs `database.ts:210`. See 11-environment-secrets-review.md F-4.
- Production example env files reference the decommissioned Railway host (stale `railway.toml` still committed). `backend/.env.production.example`. See 11-environment-secrets-review.md F-5.
- `users_select_provider` policy exposes secret columns; safety depends on hand-maintained per-query allowlists (handlers comply today, no engine backstop). `migration 20260530.../migration.sql:54`. See 01-database-schema-review.md F-3.
- Redundant duplicate `@@index` declarations in schema (write amplification if materialized). `backend/prisma/schema.prisma:171-172,356-357,439-440,482-483`. See 01-database-schema-review.md F-4.
- `bulkCreateHealthNeeds` reads `req.body.needs` with no Zod validation (dead code — unwired to any route). `healthNeedsController.ts:525-563`. See 07-input-validation-review.md F-6.
- Several major-version updates pending on security-relevant packages (`bcryptjs`, `helmet`, `express`, `zod`) — no CVE, upkeep only. See 13-dependency-health-review.md F-5.
- Deprecated transitive `node-domexception@1.0.0` in the prod tree (deprecation only; native `DOMException` on Node 20). See 13-dependency-health-review.md F-4.

> **Prompt-drift (Low, per protocol "trust the code, record drift")** — recorded across reviews for the quarterly prompt refresh, not actionable code changes: migration-count and `*Encrypted`-count overcounts (01-F2 withdrawn, 02-F3); CLAUDE.md overstates encrypted insurance fields (02-F4); inactivity-warning constant naming and `EMAIL_CHANGE_EXPIRATION_HOURS` env framing (03-F2/F3); floating audit finding-IDs F-10/F-18/F-19 with no ledger (04-F4); FHIR audit attributed to `fhirController` instead of `labSyncService` (05-F3/F6); `/bulk` vs `/batch` route name (06-F2); OCR filter message omits GIF/WEBP (07-F5); two non-AI routes wrongly listed as AI-spend routes (08-F6); FHIR-timeout breadth overstated (09-F6); `npm audit fix --force` Prisma-downgrade trap (13-F6); stale DNA migration-history references (26-F8, 29-F4); `claudeResponse` vs `claudeResponseEncrypted` logger key and retained `genotype` entry (31-F6/F7); `ApiResponse` type omits dev-only `stack` (32-F6); admin nav gating mechanism (30-F5); `:latest`-drop claim scoped wrong (12-F8); plan-gating spec line numbers verified current (43-F8).

---

## Positive Observations

Strengths confirmed at the code level across the reviews:

- **Encryption core (02).** AES-256-GCM with authenticated decryption, unique random IV per op, per-user PBKDF2-SHA512 keys at 600k iterations with a leak-free legacy fallback, hard-fail key validation, and `PHI_FIELDS` ↔ schema in exact lockstep (34 PHI columns, 1:1).
- **Secrets & boot hard-fails (11).** Every secret via `requireEnv()` with no fallback in any env; placeholder + min-length rejection; production boot hard-fails on missing PHI key, BAA gates, GCS bucket, and demo-in-prod. No real secrets in source or git history.
- **Authentication (03).** HS256-pinned JWT with issuer/audience checks, single-use row-locked refresh rotation, SHA-256-hashed tokens at rest, real lockout + timing-safe dummy compare, demo bypass gated on `isDevelopment`. Zero Medium+ findings.
- **Row-Level Security (01, 26).** RLS enabled on all 18 tables, a `BEFORE UPDATE` trigger blocking self-elevation, and a production `process.exit(1)` if the DB role has `BYPASSRLS` — a genuine engine-level backstop, not just convention.
- **CSRF (04).** Correct double-submit with SHA-256-normalized constant-time compare; every frontend mutation path attaches the token; the two genuinely exempt routes are each protected by an alternative auth shape that can't ride a cross-site cookie.
- **SSRF / FHIR egress (09, 41).** Every credential-bearing outbound URL is host-allowlisted (metadata/private/loopback/link-local blocked, cleartext-to-public refused) before a token/secret attaches; PKCE S256 with single-use 10-min `state`; OAuth tokens AES-256-GCM-encrypted per-user.
- **File download egress (28).** Signed-read URLs removed in favor of an audited-before-stream backend proxy with `no-store`/`nosniff` and ownership+RLS scoping; UUID storage keys; magic-byte + PDF-header validation beyond MIME; PDF-bomb DoS guards on every parse path.
- **AI PHI minimization (27).** Local text extraction + `redactPHI` before any prompt, response re-scrubbing on every sink (including a cross-chunk SSE buffer), scanned PDFs refused (no vision fallback), prompts/responses never logged or persisted (chat), educational disclaimers enforced.
- **Data portability & deletion (29).** Complete decrypted export excluding credentials/keys, transactional GCS-before-DB deletion with hard-abort on non-404 failure, audit logs preserved (`SET NULL`, system salt) for 7-year retention, per-user salt destroyed by cascade.
- **CI/CD pipeline (12).** Canary deploy with `--no-traffic` + health-gate + deterministic revision-pinned rollback, gitleaks secret scan, a NOBYPASSRLS RLS regression job, `npm ci` everywhere, non-root multi-stage image with `apk upgrade`.
- **Error pipeline (32).** Central handler last, generic prod messages, Prisma/JWT errors mapped to safe codes, stack traces dev-only, `asyncHandler` on every route, top-level crash handlers.

---

## Recommendations

### Immediate (This Week)
1. **Stop logging raw biomarker values (H-1).** Remove `value: b.value` from `ocrService.ts:223-227`. One-line PHI-leak fix.
2. **Add `aiSpendGuard` to the three upload routes (H-2 / M-10).** Closes the unbounded-billing hole on the most expensive AI paths and the `/upload/insurance-sbc` asymmetry.
3. **Write the audit `success`/`errorMessage` columns (M-1).** Make failed privileged actions queryable; correct the admin UI Result column.
4. **Validate the AI budget env vars at boot (42-F3).** Reject `NaN`/negative `AI_DAILY_BUDGET_USD`/`AI_USER_DAILY_BUDGET_USD` so a typo can't silently disable the circuit breaker.

### Short-term (This Month)
1. **Provision Redis (`REDIS_URL`) and migrate the spend accumulator to it (M-4).** Removes the N×limit dilution on every rate cap and the dollar budget.
2. **Tighten CSRF exemptions to exact-path equality (M-2).** Replace `endsWith` with mount-aware `===`.
3. **Add a Zod body schema to admin `PATCH /provider-relationships/:id` (M-3).**
4. **Log 429 throttle events (M-5)** and key `sensitiveLimiter` by user id (M-12).
5. **Finish the `targetValue` encryption rollout (M-6)** and route list/export decrypts through `decryptFields` (M-7).
6. **Add timeouts to the SMART OAuth fetches (M-8)** and emit `CONNECT_INITIATED`/`CONNECT_FAILED` audit rows (M-9).
7. **Stop reflecting raw FHIR `err.message` to clients (M-11);** reorder `deleteAccount` audit logging (M-13); wipe sessions on admin demotion/deactivation (M-14).
8. **Enforce the advertised plan limits (M-20, M-21)** and resolve the `providerSharing` product question (M-22).
9. **Lower the CI audit gate to moderate (M-17)** and resolve/delete the `redactPatientBanner` dead control + stale doc (M-18).

### Long-term (This Quarter)
1. **Eliminate the "designed-but-unwired" debt:** delete or adopt `RoleGuard`/`useRBAC` (L-18, L-26/L-27), wire `reset()` to key rotation or document restart-only (L-31), and reconcile every spec drift item in the next prompt refresh.
2. **Supply-chain hardening (CI/CD):** SHA-pin all third-party actions, add least-privilege `permissions:` blocks, migrate to Workload Identity Federation, digest-pin the base image, and drop the staging `:latest` push (M-15, L items).
3. **Audit-log tamper resistance:** add `FORCE ROW LEVEL SECURITY` on `audit_logs`, narrow the delete policy to a dedicated retention session, and ship rows to an append-only sink (05-F2, raised as a defense-in-depth Medium in 05; tracked here under audit-integrity hardening).
4. **Strict plan enforcement:** add atomic reservation/locking for finite limits (L-36) and fail closed to FREE on plan-lookup DB error (L-37).
5. **Confirm GCP-side controls not visible in the repo:** branch protection, SA IAM scope, GCS bucket ACL/uniform access, Cloud Logging retention + sink + `logging.viewer` minimization, and the live values of the BAA / `REDIS_URL` / `QUEST_FHIR_*` env vars.
6. **Strip production source maps (M-16)** and schedule one-at-a-time major dependency bumps (`bcryptjs`, `helmet`, `zod`).

---

## Appendix

### Tools Used
- Manual code review of every file/line cited in the 23 source reviews
- Spot-verification of the highest-severity findings against live code (`ocrService.ts:223-227`, `uploadRoutes.ts:77-132`, `auditLog.ts:243-255`)
- `npm audit` / `npm outdated` results as reported by the dependency and CI/CD reviews
- Ripgrep content searches and Glob file discovery

### Source Review Files (23)
All under `New Project Documents/Security Reviews/`:

| # | Review | Severities (C/H/M/L) |
|---|--------|----------------------|
| 1 | `01-database-schema-review.md` | 0/1/0/3 |
| 2 | `02-encryption-review.md` | 0/0/2/2 |
| 3 | `03-authentication-review.md` | 0/0/0/3 |
| 4 | `04-csrf-review.md` | 0/0/0/4 |
| 5 | `05-audit-logging-review.md` | 0/0/2/4 |
| 6 | `06-api-routes-review.md` | 0/0/1/5 |
| 7 | `07-input-validation-review.md` | 0/0/1/4 |
| 8 | `08-rate-limiting-review.md` | 0/0/3/3 |
| 9 | `09-external-apis-review.md` | 0/0/2/4 |
| 10 | `10-frontend-auth-review.md` | 0/0/0/5 |
| 11 | `11-environment-secrets-review.md` | 0/0/0/6 |
| 12 | `12-cicd-security-review.md` | 0/0/3/5 |
| 13 | `13-dependency-health-review.md` | 0/0/1/5 |
| 14 | `26-provider-collaboration-review.md` | 0/0/2/5 |
| 15 | `27-ai-integration-review.md` | 0/0/1/4 |
| 16 | `28-file-storage-review.md` | 0/0/2/4 |
| 17 | `29-data-portability-review.md` | 0/0/2/3 |
| 18 | `30-admin-security-review.md` | 0/0/2/4 |
| 19 | `31-logging-observability-review.md` | 0/1/2/3 |
| 20 | `32-error-handling-review.md` | 0/0/1/5 |
| 21 | `41-fhir-lab-integration-review.md` | 0/0/1/3 |
| 22 | `42-ai-cost-control-review.md` | 0/1/2/3 |
| 23 | `43-plan-gating-billing-review.md` | 0/0/4/4 |

(Per-review counts are pre-deduplication; the Executive Summary table counts each distinct issue once after carry-forward.)

### Out of Scope
- **GCP infrastructure config** not present in the repo: branch protection rules, service-account IAM role bindings, GCS bucket ACL/uniform-access/CORS/versioning, Cloud Logging retention/sink/IAM, Cloud Run `--max-instances`, and the live values of deploy-time secrets (`ANTHROPIC_BAA_ACTIVE`, `GOOGLE_BAA_ACTIVE`, `REDIS_URL`, `QUEST_FHIR_*`).
- **Whether a signed BAA exists** (vs the flag merely set) and Anthropic's data-retention/no-training policy — contractual, not in code.
- **TLS 1.3 enforcement** (terminated at GCP, no app-level config to cite).
- **Live exploit construction / PoC** for any cited advisory.
- **Malware/AV scanning** of uploads (no AV integration found; noted as absent, possibly intentional).
