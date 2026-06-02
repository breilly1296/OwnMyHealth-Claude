# 09-external-apis Review — 2026-06-01

Scope: external-integration security for OwnMyHealth — Anthropic Claude, Google Cloud Storage, Google Document AI, SendGrid, and the new Quest SMART-on-FHIR OAuth/lab-sync path. Worked against the live code in `backend/src/`. Ranked by exploitability × blast radius.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |
| Info | 1 |

## Findings

### F-1 — AI spend circuit breaker not applied to the upload (PDF/SBC/OCR) routes — **Medium**
- **Location:** `backend/src/routes/uploadRoutes.ts:77-85`, `:94-102`, `:124-132` (compare `backend/src/routes/aiRoutes.ts:29-37`)
- **Observation:** The three upload endpoints (`/lab-report`, `/insurance-sbc`, `/lab-results-ocr`) attach `aiLimiter` but **not** `aiSpendGuard`. Every other Claude-calling route consistently pairs both (`aiRoutes.ts:31-32`, `expenseRoutes.ts:113-114`, `insuranceRoutes.ts:122-123` & `:135-136`, `biomarkerRoutes.ts:122-123`). These upload routes trigger the most expensive calls in the system: `extractInsuranceFromSBC` uses Claude Sonnet with `max_tokens: 16384` (`sbcExtraction.ts:807-809`) and `extractBiomarkersWithClaude` uses Haiku with `max_tokens: 8192` (`claudeExtraction.ts:149-152`), reached via `processDocument` (`labUploadController.ts:52`, `:210`) and `shared.ts:338`. Cost is *tracked* (`trackAIUsage` runs inside both extractors) but the dollar cap (`isAISpendExceeded`) is never consulted before these calls.
- **Impact:** The spend cap the spec advertises as "enforced by `aiSpendGuard`" does not protect the highest-cost Claude paths. A buggy client loop, a compromised account, or an abusive uploader can drive unbounded Anthropic billing through SBC/PDF uploads — `aiLimiter` bounds *request count* per window, not *dollars*, and a single Sonnet 16k-token call dwarfs a chat turn. The circuit breaker against runaway billing has a hole exactly where the burn rate is highest.
- **Fix:** Add `aiSpendGuard` (after `authenticate`, before the handler) to all three routes in `uploadRoutes.ts`, mirroring `aiRoutes.ts:31-32`. `authenticate` already runs first on each, so `req.user.id` is available for the per-user budget.
- **Evidence:**
  ```ts
  // uploadRoutes.ts:77-84 — aiLimiter present, aiSpendGuard absent
  router.post('/lab-report', authenticate, aiLimiter, blockDemoAI,
    requirePlanLimit('pdfUploadsPerMonth'), upload.single('file'),
    asyncHandler(uploadLabReport));
  ```

### F-2 — SMART OAuth token-exchange / refresh / discovery fetches have no timeout — **Medium**
- **Location:** `backend/src/services/fhir/smartAuth.ts:102-104` (discovery), `:186-190` (code exchange), `:226-230` (refresh), `:294` (revoke)
- **Observation:** Of the five outbound `fetch()` calls in the FHIR subsystem, only `FHIRClient.request` wraps the call in an `AbortController` with a 30s timeout (`fhirClient.ts:45-53`). The four SMART OAuth fetches in `smartAuth.ts` pass no `signal`, so they inherit Node's default (effectively unbounded for a slow/half-open peer). `exchangeCodeForToken` runs inside the public OAuth callback handler (`fhirController.handleCallback` → `handleOAuthCallback`), and `refreshAccessToken` runs inside `syncLabResults`.
- **Impact:** A hung or slow Quest token/discovery endpoint stalls the callback or sync request indefinitely, tying up a request slot with no upper bound — a resource-exhaustion / availability gap and a direct mismatch with checklist item 8 ("Timeouts configured on all external calls"). Blast radius is bounded (calls only go to the config-trusted host, and `sensitiveLimiter` caps request rate), so this is a defense-in-depth/availability issue rather than a disclosure path.
- **Fix:** Wrap each `fetch` in `smartAuth.ts` in an `AbortController` with a bounded timeout (reuse the 30s pattern from `fhirClient.ts:45-46` / `clearTimeout` in `finally`), or factor a shared `fetchWithTimeout` helper used by both files.
- **Evidence:**
  ```ts
  // smartAuth.ts:186-190 — no signal / AbortController
  const response = await fetch(tokenUrl, {
    method: 'POST', headers, body: body.toString(),
  });
  ```

### F-3 — `getAnthropicClient()` caches the client across `ANTHROPIC_BAA_ACTIVE`/key changes but BAA gate is re-read fresh — **Low**
- **Location:** `backend/src/services/anthropicClient.ts:46-60`
- **Observation:** The shared client is cached in module scope and only torn down via `reset()`. Per the spec this is intended (one place for key rotation). It is correct because the load-bearing BAA gate is re-evaluated on every call from `config.anthropic.baaActive` (`claudeExtraction.ts:106`, `sbcExtraction.ts:767`) and the production boot gate (`config/index.ts:300-313`) hard-fails before traffic. Worth noting only: a key rotation that does not call `reset()` keeps signing with the old key until process restart. No exploit; rotation runbooks must call `reset()` or restart.
- **Impact:** Operational — a hot key-rotation without `reset()`/restart silently keeps using the retired key. Not attacker-reachable.
- **Fix:** Document that `reset()` (or a redeploy) is required after key rotation; optionally key the cache on a hash of `ANTHROPIC_API_KEY` so a changed env var auto-rebuilds.
- **Evidence:**
  ```ts
  export function getAnthropicClient(options: AnthropicClientOptions = {}): Anthropic {
    if (client) return client;
  ```

### F-4 — FHIR error snippets surfaced to the client may echo upstream response text — **Low**
- **Location:** `backend/src/controllers/fhirController.ts:170-175` (`triggerSync`), `:197-202` (`deleteConnection`); message source `fhir/fhirClient.ts:55-57`, `smartAuth.ts:191-193` & `:231-233`
- **Observation:** `request()` builds error messages from the upstream response body (`FHIR request failed: ${status} ${snippet}` — snippet capped at 300 chars; token exchange/refresh cap at 200). `triggerSync` then returns `err.message` verbatim in the 500 JSON body (`fhirController.ts:173`). Snippets come from the FHIR/token *response* (not our request), so they do not contain our Bearer token or `client_secret` — but a verbose upstream error could echo a request parameter or FHIR resource fragment back to the patient. Length-capping is present (checklist item 10), and no credential is in the snippet, so this is hygiene, not a leak of our secrets.
- **Impact:** Low — bounded, non-credential upstream text reaches the authenticated owner of the connection (their own data domain), not other users.
- **Fix:** Return a generic message to the client (`deleteConnection` at `:197-202` has the same verbatim-`err.message` pattern, so fix both) and keep the detailed snippet to server logs only; the snippet is already logged at `fhirController.ts:167-169`. (Verifier note 2026-06-01: corrected an earlier "deleteConnection partially does" claim — `deleteConnection` echoes `err.message` verbatim too; its err originates in `disconnectConnection`, which swallows FHIR snippets, so it is only marginally less likely to carry upstream text.)
- **Evidence:**
  ```ts
  // fhirController.ts:170-174
  res.status(500).json({ error: {
    code: 'SYNC_FAILED',
    message: err instanceof Error ? err.message : 'Sync failed' } });
  ```

### F-5 — `revokeToken` derives the revocation endpoint by string-replacing `/token`→`/revoke` — **Low**
- **Location:** `backend/src/services/fhir/smartAuth.ts:287-294`
- **Observation:** When the SMART config does not publish a `revocation_endpoint`, revoke falls back to `smartConfig.tokenUrl.replace(/\/token$/, '/revoke')`. The result is re-validated by `assertSmartEndpoint` (host allowlist) before the token is POSTed, so there is no SSRF/exfil risk. But if the provider's token URL does not end in `/token`, the replace is a no-op and the access token is POSTed to the **token** endpoint as if it were a revoke — a silent no-op revocation. Disconnect still deletes the row (best-effort by design, `labSyncService.ts:399-410`), so the local record is gone, but the token may remain live at the lab.
- **Impact:** Low/defense-in-depth — a stolen-but-disconnected token could remain valid upstream until natural expiry. Mitigated by AES-256-GCM at-rest encryption (`labSyncService.ts:142-143`) and short access-token lifetimes; refresh tokens are the longer-lived concern.
- **Fix:** Resolve and pass the real `revocation_endpoint` from `/.well-known/smart-configuration` through `SMARTConfig` rather than heuristically rewriting the path; skip (don't mis-target) when truly unknown.
- **Evidence:**
  ```ts
  const revokeUrl = assertSmartEndpoint(smartConfig,
    smartConfig.tokenUrl.replace(/\/token$/, '/revoke'),
    'SMART revoke endpoint');
  ```

### F-6 — Prompt drift: spec claims FHIR 30s timeout applies broadly; only the data client has one — **Low**
- **Location:** Spec `prompts/09-external-apis.md:101` & `:108` vs. code `fhir/smartAuth.ts:102/186/226/294`
- **Observation:** Checklist item 7 and item 8 assert "30s `AbortController` timeout per request" and "FHIR 30s AbortController" as if all FHIR/SMART calls are timed. In the live code, only `FHIRClient.request` (`fhirClient.ts:45-53`) carries a timeout; the four SMART OAuth fetches do not (see F-2). Per protocol, trusting the code over the spec: the spec overstates timeout coverage.
- **Impact:** Documentation/expectation drift; the substantive gap is tracked under F-2.
- **Fix:** Update item 8 to scope the 30s timeout to FHIR data requests/pagination, and either add timeouts to the SMART OAuth fetches (F-2) or note them as a known gap.
- **Evidence:**
  ```ts
  // fhirClient.ts:45-46 — timeout lives ONLY here
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  ```

### F-7 — Document AI OCR path is not behind `aiSpendGuard`, but Document AI cost is not tracked at all — **Info**
- **Location:** `backend/src/services/ocrService.ts:264-368`, `backend/src/services/aiCostTracker.ts:16-19`
- **Observation:** `aiCostTracker` and the spend cap only cover Anthropic models (PRICING map has Haiku + Sonnet only). Google Document AI usage (image OCR) is neither cost-tracked nor spend-capped. This is consistent with the spec (the cap is described as an *Anthropic* billing backstop), and Document AI has its own BAA gate + 10MB size limit + 60s timeout, so it is noted as an observation, not a finding. If a Document AI cost backstop is ever desired, it would need its own accumulator.
- **Impact:** None today; informational for future cost-control scope.
- **Fix:** None required; consider documenting that the dollar cap is Anthropic-only.
- **Evidence:**
  ```ts
  const PRICING: Record<string, { input: number; output: number }> = {
    'claude-haiku-4-5-20251001': { ... },
    'claude-sonnet-4-5-20250929': { ... }, };
  ```

## Checks passed

### 1. API Key Security
- [x] All keys loaded from environment variables — `config/index.ts:150,181,207`; `anthropicClient.ts:49`.
- [x] Keys not hardcoded in source code — only `process.env.*` reads; no literals (grep for `ANTHROPIC_API_KEY|SENDGRID_API_KEY|QUEST_FHIR_CLIENT_SECRET` returns only env reads / presence checks).
- [x] Keys not logged in any circumstance — grep for `logger.*（apiKey|clientSecret|accessToken|Authorization|Bearer）` returns **no matches**; config only logs presence (`config/index.ts:431-435`).
- [x] Keys redacted in error messages — error snippets are response-body only and capped (`fhirClient.ts:56`, `smartAuth.ts:193`); no key interpolation.
- [x] Keys validated at startup (JWT secrets, PHI key, audit salt) — `config/index.ts:241-293`; BAA flags gated at boot `:300-333`.

### 2. SSRF Prevention
- [x] Server-supplied FHIR URLs pass `assertAllowedFhirUrl()` before a Bearer token / `client_secret` attaches — pagination `next` link `fhirClient.ts:38`; well-known endpoints `smartAuth.ts:119,123`; token/refresh/revoke `smartAuth.ts:167,211,289`.
- [x] Host allowlist confines credentials to FHIR base host + `QUEST_FHIR_AUTH_HOSTS`; metadata/private/loopback/link-local blocked — `urlSafety.ts:20-35,77-86`; 169.254.169.254 explicitly blocked `:31`. Tested in `urlSafety.test.ts:28`.
- [x] Cleartext `http://` refused for public FHIR hosts — `urlSafety.ts:87-89`; test `urlSafety.test.ts:34`.
- [x] DNS-rebinding is an accepted residual risk per the header comment — `urlSafety.ts:13-16`.
- [x] No user input directly used in outbound URLs — `fhirBaseUrl`/`redirectUri`/`frontendSuccessRedirect` are config (`config/index.ts:205-224`); callback redirect target is config, `oauthError` is `encodeURIComponent`'d (`fhirController.ts:83`).

### 3. Anthropic Claude API
- [x] Single shared client, lazy init, 30s/2-retry defaults, `reset()` — `anthropicClient.ts:24-25,46-60,75-77`; grep `new Anthropic(` returns **only** `anthropicClient.ts:54`.
- [x] Key from `ANTHROPIC_API_KEY` — `anthropicClient.ts:49`.
- [x] BAA gate enforced (prod boot hard-fail + runtime gate) — boot `config/index.ts:300-313`; runtime `claudeExtraction.ts:106-111`, `sbcExtraction.ts:767-772`.
- [x] Error handling for timeouts/rate limits/5xx — `claudeExtraction.ts:245-269`, `sbcExtraction.ts:996-1024`.
- [x] Cost tracking via `trackAIUsage` — `claudeExtraction.ts:167-173`, `sbcExtraction.ts:844-850`; accumulator `aiCostTracker.ts:91-105`. (Spend *cap* gap on uploads = F-1.)
- [x] No PHI sent to Claude: local text extract → redact → text-only prompt; scanned PDFs rejected, no vision fallback — `claudeExtraction.ts:117-163`, `sbcExtraction.ts:778-821`.
- [x] No PHI logged in prompts/responses — only lengths/token counts logged (`claudeExtraction.ts:137-141,183-188`); response re-scrubbed via `stripPHIFromText` `:182`; plan name/insurer dropped from logs `sbcExtraction.ts:924-944`.
- [x] AI responses validated before use — JSON extraction + shape validation `claudeExtraction.ts:200-232`, `sbcExtraction.ts:861-922`.

### 4. Google Cloud Storage
- [x] Project id from `GCP_PROJECT_ID`; bucket read via `config.gcp.bucketName` not `process.env` — `storageService.ts:16-25`.
- [x] Prod hard-fails if `GCS_BUCKET_NAME` unset (dev fallback never reaches prod) — `config/index.ts:399-405`.
- [x] PHI downloads stream through backend with `Cache-Control: no-store`; no live signed-URL egress — `storageService.getFileStream` `:108-112` → `fileController.getFileDownloadUrl:251,259`; grep `getSignedUrl` returns only a comment, no call.
- [x] Upload size limit (10MB) enforced before GCS — multer `uploadRoutes.ts:31-33,48-50`; `ocrService.ts:49,130-135`.
- [x] Bulk delete treats non-404 GCS failure as per-file failure for hard-abort by caller — `storageService.deleteFiles:162-181`, 404→`ok:true` via `deleteFile:134-136`.

### 5. Google Document AI (images only)
- [x] Credentials file-path OR inline JSON; processor/location/project from env — `ocrService.ts:81-120`.
- [x] BAA gate: image OCR refuses unless `documentAiBaaActive`; prod boot hard-fail — runtime `ocrService.ts:274-280`; boot `config/index.ts:320-333`.
- [x] Only images go to Document AI; PDFs route to Claude, no PDF fallback — `ocrService.ts:393-410`.
- [x] OCR results validated (`validateBiomarkerValue`) — `ocrService.ts:336-345`.
- [x] 60s processing timeout — `ocrService.ts:298`.
- [x] DEADLINE_EXCEEDED / PERMISSION_DENIED / NOT_FOUND / INVALID_ARGUMENT mapped to safe messages — `ocrService.ts:418-447`.

### 6. SendGrid Email
- [x] `SENDGRID_API_KEY` from env; client lazy-loaded with 10s timeout — `emailService.ts:38-53` (verified `sgMail.setTimeout` is a real method on `@sendgrid/mail`).
- [x] No PHI in email bodies — verification/reset/account-exists/email-change templates carry only URLs + email addresses (`emailService.ts:62-277,431-575`).
- [x] From address configured — `emailService.ts:312-314` from `config.email.fromEmail/fromName`.
- [x] `FRONTEND_URL` used for links — `emailService.ts:350,372,395,585,606`.
- [x] Sandbox mode validates but never delivers; prod boot hard-fail if set — `emailService.ts:323-325`; `config/index.ts:421-427`.
- [x] Delivery errors handled gracefully (dev logs-only; failures don't abort; timeouts distinct) — `emailService.ts:294-340`.

### 7. Quest SMART-on-FHIR OAuth
- [x] Client creds from env; feature disabled unless `clientId` set — `config/index.ts:205-224`; `labSyncService.ts:56-57`; `fhirController.isFeatureConfigured:30-32`.
- [x] PKCE S256, 64-byte verifier — `smartAuth.ts:78-83`.
- [x] `state`+`codeVerifier` stashed server-side (10-min TTL) and consumed single-use — `smartAuth.ts:317-346`; `labSyncService.ts:101,122-124`.
- [x] `client_secret` via Basic auth only to host-validated endpoints; discovery re-validated — `smartAuth.ts:181-184,221-224,283-285` guarded by `assertSmartEndpoint` `:44-50`.
- [x] OAuth tokens AES-256-GCM-encrypted on `LabConnection`, per-user key — `labSyncService.ts:140-143,230-233`.
- [x] FHIR requests carry Bearer only to allowlisted hosts; 30s AbortController; pagination capped at 20 pages — `fhirClient.ts:38,45-53,107`.
- [x] Refresh preserves old refresh token when provider doesn't rotate; revoke best-effort — `smartAuth.ts:237-241`; `labSyncService.ts:399-410`.
- [x] No PHI (observation values) logged during sync; values encrypted via per-user pipeline — `labSyncService.ts:299,354-357` (logs unmapped LOINC codes only).
- [x] PKCE cache is in-memory/single-instance (documented residual risk) — `smartAuth.ts:317-326`.

### 8. Error Handling
- [x] External API errors don't crash server — try/catch in all extractors, OCR, email, FHIR controller; `revokeToken` swallows (`smartAuth.ts:300-304`).
- [x] Timeouts on Claude (30s), SendGrid (10s), Document AI (60s), FHIR data client (30s) — see above. (SMART OAuth fetches untimed = F-2.)
- [x] Retry logic — Anthropic SDK `maxRetries: 2` `anthropicClient.ts:25,57`.
- [x] Fallback when API unavailable — email logs-only `emailService.ts:294-301`; `anthropicClient.isEnabled()` `:67-69`.

### 9. Response Validation
- [x] Claude responses parsed/validated, JSON errors handled — `claudeExtraction.ts:200-218`, `sbcExtraction.ts:861-879`.
- [x] FHIR Bundle / SMART token-response shapes checked — `smartAuth.ts:111-113,245-247`; `fhirClient.ts:120-131`; `labSyncService.ts:462-467`.

### 10. Secrets in URLs/Logs
- [x] OAuth tokens / `client_secret` never logged — confirmed by grep (no matches); revoke logs status only `smartAuth.ts:296-298`.
- [x] Error snippets length-capped and token-free — `fhirClient.ts:56` (300), `smartAuth.ts:193,233` (200). (Client-surfaced verbatim message = F-4.)

## Unverifiable
- npm `audit` (prod): 7 **moderate** advisories, all transitive/dev — `prisma`/`@prisma/dev`/`@hono/node-server` (dev toolchain) and `gaxios`/`uuid`/`retry-request`/`teeny-request` under `@google-cloud/storage` (fix is a semver-major bump to `@google-cloud/storage@5.20.4`, which is a downgrade-by-major from the installed v2.x line — needs maintainer judgment). No high/critical. Out of this prompt's exploit scope; flagged for the dependency-hygiene prompt (06/dependencies).
- Whether `QUEST_FHIR_AUTH_HOSTS` is actually configured in any deployed environment — cannot be verified from source (env-only); the allowlist *logic* is verified.

## Out of scope
- Detailed AI-prompt-injection / output-handling review — owned by `27-ai-integration` per spec line 66.
- Application-log PHI redaction internals (`utils/phiRedaction.ts` pattern completeness) — owned by `31-logging-observability`; here only confirmed that `redactPHI`/`stripPHIFromText` are invoked on the Claude in/out path.
- RLS correctness of `withRLSContext`/`withRLSTransaction` used by `labSyncService` — owned by the RLS/database prompt; here only confirmed lab sync routes its writes through them.
- CSRF/auth middleware design — confirmed present on FHIR mutation routes (`fhirRoutes.ts:48,58`) but full review is owned by the auth/CSRF prompts.
