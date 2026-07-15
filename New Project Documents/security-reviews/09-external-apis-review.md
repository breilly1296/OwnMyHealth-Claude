# External API Security Review — 2026-06-16

Scope: the external-integration surface of OwnMyHealth — Anthropic Claude (extraction, SBC, AI chat, cost analysis), Google Document AI OCR, Google Cloud Storage, SendGrid, and the Quest SMART-on-FHIR OAuth + lab-sync path. Reviewed at HEAD `fb2cd32` against `prompts/09-external-apis.md`, following `prompts/_review-protocol.md`. Every claim below cites a `file:line`; nothing is asserted without code evidence. This review is **static** (no live calls); items requiring a running provider are in *Unverifiable*.

Files read in full: `services/anthropicClient.ts`, `services/claudeExtraction.ts`, `services/sbcExtraction.ts`, `services/aiCostTracker.ts`, `middleware/aiSpendGuard.ts`, `services/ocrService.ts`, `services/storageService.ts`, `services/emailService.ts`, `services/fhir/smartAuth.ts`, `services/fhir/urlSafety.ts`, `services/fhir/fhirClient.ts`, `services/fhir/labSyncService.ts`, `controllers/fhirController.ts`, `controllers/aiChatController.ts`, `controllers/expenseController.ts` (Claude section), `utils/phiRedaction.ts`, `config/index.ts`, plus the route mounts in `routes/{ai,fhir,upload,insurance,biomarker,expense}Routes.ts` and `middleware/validation.ts` helpers.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 3 |

No Critical or High findings. The external-API surface is well-hardened: a single shared Anthropic client, BAA gates on every Claude/Document-AI path, an SSRF host-allowlist that confines OAuth credentials and pagination URLs, AES-256-GCM-encrypted OAuth tokens at rest, PHI redaction before every LLM call, no PHI in emails, and streamed (not signed-URL) PHI downloads. The findings are spend-cap and hardening gaps, not disclosure or auth-bypass paths.

## Findings

### F-1 — Google Document AI spend is untracked; the dollar circuit breaker bounds only Claude — **Medium**
- **Location:** `backend/src/services/ocrService.ts:300` (the paid `client.processDocument` call); confirmed absence of accounting throughout `ocrService.ts` (no `trackAIUsage` / `admitAISpend` / `aiCostTracker` import anywhere in the file).
- **Observation:** The OCR routes are gated by `aiSpendGuard` (`uploadRoutes.ts:82,104,135`), but that middleware only places/refunds a fixed `RESERVATION_USD = 0.05` Claude estimate (`aiCostTracker.ts:67`, `aiSpendGuard.ts:74-75`) and `trackAIUsage` only ever records token-priced Claude cost (`aiCostTracker.ts:302-304`, pricing table at `aiCostTracker.ts:33-36` covers only the two Claude models). Document AI's per-page billing from `processDocument` (`ocrService.ts:300`) is never recorded against `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD`. The scanned-PDF fallback (`ocrService.ts:421-426`) routes raw PDF bytes to the same untracked call.
- **Impact:** The dollar spend cap — the documented backstop against "runaway billing from a buggy loop, compromised key, or abusive account" (`aiSpendGuard.ts:5-8`) — does not bound Google Document AI spend at all. The only bound on OCR volume is the count-based `pdfUploadsPerMonth` plan quota + `aiLimiter` rate limit (`uploadRoutes.ts:81,84`). A high-page-count abuse pattern within quota can still run up a Document AI bill the dollar cap is blind to.
- **Fix:** Record Document AI cost after `processDocument` returns — derive an estimate from `document.pages.length` × a configured per-page price and call a cost-recording path (e.g. extend `aiCostTracker` with a non-Claude `recordExternalSpend(userId, costUsd)` and invoke it in `processImageWithDocumentAI` after line 300), or make `aiSpendGuard` reserve a page-aware Document-AI estimate for the OCR routes. At minimum, document that the dollar cap excludes Document AI (the prompt already flags this as a known gap — confirm it is an accepted product decision).
- **Evidence:**
  ```ts
  // ocrService.ts:300 — paid call, no cost accounting follows
  const [result] = await client.processDocument(request, { timeout: 60_000 });
  ```
  (`Grep "trackAIUsage|admitAISpend|aiCostTracker"` in `ocrService.ts` → No matches.)

### F-2 — Per-sync FHIR fan-out (pages + downstream work) has no cost-aware cap — **Medium**
- **Location:** `backend/src/routes/fhirRoutes.ts:43-62` (sync route); `backend/src/services/fhir/fhirClient.ts:101-117` (pagination loop).
- **Observation:** `POST /fhir/sync/:connectionId` is bounded only by the shared, user-keyed `sensitiveLimiter` (`fhirRoutes.ts:57`), which it shares with connect + delete. Each sync paginates up to 20 pages × `_count`=100 = 2000 resources (`fhirClient.ts:25,107`), and for each numeric Observation does a per-row `withRLSTransaction` + encrypt + `upsertBiomarkerReading` (`labSyncService.ts:340-354`). The route's own comment documents this as known limitation L-13: "the ONLY cap on outbound volume here is the shared, user-keyed sensitiveLimiter … That bounds request COUNT but not the unbounded per-sync work."
- **Impact:** A single authenticated sync request can drive a large, attacker-influenced amount of outbound FHIR traffic and DB write work (per-observation transactions). It is request-count limited but not work/cost limited. Lower exploitability than F-1 because the FHIR server is operator-trusted and the per-sync work is bounded by the 20-page stop, but the per-request blowup is real and unmetered.
- **Fix:** Add a sync-specific budget that accounts for pages fetched / rows written (the route comment recommends "a cost-aware budget that accounts for pages fetched / tokens spent"), or batch the per-observation writes into fewer transactions to cap DB amplification. Tracked upstream as L-13.
- **Evidence:**
  ```ts
  // fhirRoutes.ts:46-49
  // The ONLY cap on outbound volume here is the shared, user-keyed sensitiveLimiter
  // (10/hr ...). That bounds request COUNT but not the unbounded per-sync work
  ```

### F-3 — PKCE verifier cache is in-memory / per-instance (multi-instance correctness gap) — **Low**
- **Location:** `backend/src/services/fhir/smartAuth.ts:368` (`challengeCache = new Map`), documented at `smartAuth.ts:374-385`.
- **Observation:** `stashChallenge`/`consumeChallenge` use a per-process `Map`. The OAuth callback (`GET /fhir/callback`) is public (`fhirRoutes.ts:24`) and the load balancer may route it to a different Cloud Run instance than the one that stashed the verifier, in which case `consumeChallenge` returns null and the connect flow fails. The author flags this as L-39 and notes the deploy must pin `--max-instances=1` for correctness.
- **Impact:** Availability/correctness only — **not a security weakness**. The `state` is a 24-byte random token with single-use delete-on-read and a 10-minute TTL (`smartAuth.ts:104,367,399-406`), so a forged callback is not enabled; the failure mode is a dropped (not hijacked) callback under multi-instance traffic.
- **Fix:** Move the verifier cache to the shared Redis store already used by the rate limiters / AI spend cap (keyed by `state`, same TTL + single-use semantics), so the callback can land on any instance. Until then keep `--max-instances=1` or document the operational constraint.
- **Evidence:**
  ```ts
  // smartAuth.ts:374-385 — "this Map is per-process ... the deployment must pin
  // --max-instances=1 for correctness (NOT for security ...)"
  ```

### F-4 — In-memory AI spend accumulator → N×budget without Redis — **Low**
- **Location:** `backend/src/services/aiCostTracker.ts:95-167` (`InMemorySpendStore`), store selection at `aiCostTracker.ts:257-274`; config note at `config/index.ts:248-258`.
- **Observation:** The spend cap is pluggable: a shared `RedisSpendStore` when `REDIS_URL` is set, otherwise a per-process `InMemorySpendStore`. With no Redis, each Cloud Run instance keeps its own accumulator, so the effective ceiling is N×budget bounded only by `--max-instances`. This is correctly documented (`aiCostTracker.ts:10-17`, `config/index.ts:251-254`) and the Redis path is implemented with atomic `INCRBYFLOAT`-then-compare-and-refund (`aiCostTracker.ts:183-216`).
- **Impact:** Without Redis provisioned, the dollar circuit breaker is per-instance, so the real cap is N× the configured budget under autoscale — the breaker is weakened but not absent. Same residual class as the rate limiters.
- **Fix:** Provision Cloud Memorystore and set `REDIS_URL` in prod so the spend cap (and rate limiters and the F-3 PKCE cache) share one store. Infra change; the code path already exists and is selected automatically.
- **Evidence:**
  ```ts
  // config/index.ts:251-254 — "the accumulator is in-memory/per-instance, so under
  // Cloud Run autoscale the effective ceiling is N×budget ... Move to a shared store"
  ```

### F-5 — DNS-rebinding residual on the FHIR/SMART host allowlist (accepted) — **Low**
- **Location:** `backend/src/services/fhir/urlSafety.ts:13-25` (header), `urlSafety.ts:85-94` (host check).
- **Observation:** `assertAllowedFhirUrl` validates the URL's **hostname** against the trusted set; it does not pin the resolved IP. A trusted host whose DNS resolves to an internal/attacker address at fetch time (DNS rebinding, or subverted authoritative DNS for the trusted host) is not caught. The file documents this as L-40 "ACCEPTED RESIDUAL RISK."
- **Impact:** Low and explicitly accepted: the realistic threat (a server response pointing credentials at an arbitrary attacker/internal host) is fully blocked by the host allowlist, and the trusted hosts are operator-configured, not user-supplied. Closing it fully needs IP-pinned connect (custom lookup/agent), disproportionate to the residual.
- **Fix:** None required now; revisit if the allowlist ever becomes user-supplied. Per the protocol, listed as a finding so the accepted residual is on record.
- **Evidence:**
  ```ts
  // urlSafety.ts:14-16 — "this validates the URL's HOST against an allowlist;
  // it does NOT pin the resolved IP. ... DNS rebinding ... is not caught here."
  ```

## Checks passed

### 1. API Key Security
- [x] All keys loaded from env — `ANTHROPIC_API_KEY` (`anthropicClient.ts:49`), `SENDGRID_API_KEY` (`config/index.ts:210`), GCP credentials (`ocrService.ts:91`, `storageService.ts:17`), Quest creds (`config/index.ts:266-283`).
- [x] No keys hardcoded — secrets are all `process.env`/`config`-sourced; no literal key strings (greps for `new Anthropic(` show only the env-fed constructor at `anthropicClient.ts:54`).
- [x] Keys not logged — Anthropic key never logged; SendGrid init logs only "client initialized" (`emailService.ts:64`); Document AI logs "with JSON credentials"/"with credentials file" but not the value (`ocrService.ts:96,105`).
- [x] Keys redacted in error messages — Claude/SBC error handlers log `errorMessage` strings that are SDK messages, not the key (`claudeExtraction.ts:246-271`, `sbcExtraction.ts:997-1025`); 401 path maps to a generic message.
- [x] JWT/PHI/audit-salt secrets validated at startup (format + length + blocklist) — `config/index.ts:18-28,315-367`; BAA flags + GCS bucket validated at boot (`config/index.ts:381-486`).

### 2. SSRF Prevention
- [x] Server-supplied FHIR pagination `next` URLs pass `assertAllowedFhirUrl` BEFORE the Bearer token attaches — `fhirClient.ts:31-41,48-52`.
- [x] SMART discovery endpoints (authorize/token/revoke) re-validated against the host allowlist before the user redirect or `client_secret` POST — `smartAuth.ts:143-162` (discovery), `:202` (code exchange), `:246` (refresh), `:339-343` (revoke re-validate).
- [x] Host allowlist confines credentials to base host + `QUEST_FHIR_AUTH_HOSTS`; `isPrivateOrLoopbackHost` blocks `169.254.169.254`, private/loopback, link-local/ULA — `urlSafety.ts:28-43,85-94`.
- [x] Cleartext `http://` refused for public hosts, tolerated only for loopback/private dev mock — `urlSafety.ts:95-97`.
- [x] User input not used to build outbound URLs — `aud` uses config `fhirBaseUrl` (`smartAuth.ts:184`); FHIR `patient` / `Patient/{id}` go through `URLSearchParams.set` / `encodeURIComponent` (`fhirClient.ts:66,91-98`), not raw concatenation.

### 3. Anthropic Claude API
- [x] Key from `ANTHROPIC_API_KEY` — `anthropicClient.ts:49`.
- [x] Single shared client (no copy-pasted singletons) — only one `new Anthropic(` in the repo at `anthropicClient.ts:54`; all 4 callers (`claudeExtraction.ts:17,115`, `sbcExtraction.ts:16,776`, `aiChatController.ts:33,231`, `expenseController.ts:34,748`) use `getAnthropicClient()`. Defaults 30s/2 retries (`anthropicClient.ts:24-25`); chat overrides 60s/1 retry via per-call opts (`aiChatController.ts:77,239`); `reset()` for rotation (`anthropicClient.ts:75-77`).
- [x] BAA runtime gate enforced before any PHI — `claudeExtraction.ts:107-112`, `sbcExtraction.ts:768-773`, `expenseController.ts:680-688`, `aiChatController.ts:146-165`; boot hard-fail in prod when key set but flag unset (`config/index.ts:381-394`).
- [x] Error handling for timeouts/rate-limits/5xx — `claudeExtraction.ts:248-271`, `sbcExtraction.ts:999-1025`, `expenseController.ts:762-770`, `aiChatController.ts:330-362` (SSE error event, no crash).
- [x] Cost tracking + reserve/settle spend cap — `trackAIUsage` at every call site (`claudeExtraction.ts:170`, `sbcExtraction.ts:847`, `aiChatController.ts:308`, `expenseController.ts:779`); `admitAISpend` reserve/settle (`aiSpendGuard.ts:37,74-75`, `aiCostTracker.ts:285`); `isAISpendExceeded` is gone (grep → No matches); 8 `aiSpendGuard` mounts across 5 route files (ai/biomarker/expense/insurance×2/upload×3).
- [x] No PHI sent to Claude — local PDF text extraction then `redactPHI` before the prompt (`claudeExtraction.ts:118-161`, `sbcExtraction.ts:779-819`); raw PDF bytes never sent to Claude; scanned PDFs refused at the Claude layer (`claudeExtraction.ts:124-133`). Document body delimited as untrusted data (`validation.ts:113-135`).
- [x] No PHI logged in prompts/responses — extraction logs lengths/firedPatterns/token counts only (`claudeExtraction.ts:138-142,186-191`); SBC logs `planType` enum, not `planName`/`insurerName` (`sbcExtraction.ts:927-947`); chat audit "never logs the user question or Claude's response" (`aiChatController.ts:316-329`).
- [x] AI responses validated before storage/display — strict JSON parse with markdown-fence handling + shape/`isNaN` filters (`claudeExtraction.ts:194-235`, `sbcExtraction.ts:855-925`); response re-scrubbed via `stripPHIFromText` before persist + display (`expenseController.ts:776-777`); chat scrubs across SSE chunk boundaries + appends educational disclaimer (`aiChatController.ts:249-295`).

### 4. Google Cloud Storage
- [x] Credentials from `GOOGLE_APPLICATION_CREDENTIALS`, project from `GCP_PROJECT_ID` — `storageService.ts:16-18`.
- [x] Bucket via `config.gcp.bucketName`, not raw `process.env`; prod hard-fails if unset (F-28) — `storageService.ts:25`, `config/index.ts:480-486`.
- [x] PHI downloads stream through the backend with `Cache-Control: no-store`; no signed-URL egress — `storageService.getFileStream` (`storageService.ts:108-112`); `getSignedUrl` appears only in an explanatory comment (`storageService.ts:97`), not as a live call (grep confirms one hit, in a comment).
- [x] Upload size limit (10 MB) enforced before GCS — `ocrService.ts:50,131-136`.
- [x] Bulk delete treats non-404 GCS failures as recoverable per-file errors so the caller can hard-abort and not orphan PHI — `storageService.ts:119-181` (404 → `ok:true`, others surfaced).

### 5. Google Document AI (OCR)
- [x] GCP creds secured — file path OR inline JSON parsed safely (`ocrService.ts:91-107`); processor/location/project from env (`ocrService.ts:116-120`, default location `'us'`).
- [x] BAA gate refuses before any image/PDF bytes leave — `ocrService.ts:276-282`; boot hard-fail in prod when processor set but flag unset (`config/index.ts:401-414`).
- [x] Scope correct: images → Document AI; PDFs try Claude text-path first, scanned-PDF fallback to Document AI only when BAA active — `ocrService.ts:401-446`. Page-limit hard-reject re-thrown before any per-page OCR cost (L28) — `ocrService.ts:414-416`.
- [x] Document/extracted text not logged — logs lengths/page counts/confidence only; raw biomarker values suppressed (H-1) — `ocrService.ts:224-229,310-313,351-357`.
- [x] OCR results validated — `validateBiomarkerValue` filters (`ocrService.ts:221-232,338-347`).
- [x] Processing timeout 60s — `ocrService.ts:300`.
- [x] Errors mapped to safe messages without crashing — DEADLINE_EXCEEDED/PERMISSION_DENIED/NOT_FOUND/INVALID_ARGUMENT (`ocrService.ts:451-484`).

### 6. SendGrid Email Service
- [x] Key from env; client lazy-loaded via dynamic import with a 10s timeout — `emailService.ts:56-71`.
- [x] No PHI in email bodies — verification/reset/account-exists/email-change templates contain only links + generic copy (`emailService.ts:80-295,452-596`); recipient masked in logs via `maskEmail` (`emailService.ts:44-51,356-359`).
- [x] From address configured — `EMAIL_FROM`/`EMAIL_FROM_NAME` (`config/index.ts:211-212`, used `emailService.ts:330-333`).
- [x] `FRONTEND_URL` used for links — `emailService.ts:371,393,606,627` (config-sourced; no user-controlled redirect host).
- [x] Sandbox mode validates but never delivers; prod hard-fails if it leaks in — `emailService.ts:341-347`, `config/index.ts:502-508`.
- [x] Email rate limited — auth/email routes carry limiters (verification/reset flows behind `authLimiter`; verified the limiter inventory matches the canonical 8 named limiters; this prompt's scope is the service, which itself surfaces send failures without aborting the caller, `emailService.ts:322-361`).
- [x] Delivery errors handled gracefully — no-key dev path logs (`emailService.ts:312-319`); send failures return `{success:false}` without throwing into the caller; timeouts surfaced distinctly (`emailService.ts:355-360`).
- [x] Notification preference / opt-out honoring is enforced in `notificationService` (out of this file's scope — see *Out of scope*); the email service itself is a dumb dispatcher (`sendGenericEmail`, `emailService.ts:438-445`).

### 7. Quest SMART-on-FHIR OAuth
- [x] Client creds from env; feature disabled unless `clientId` set — `config/index.ts:265-284`, `fhirController.ts:32-34`, `labSyncService.ts:56-59`.
- [x] PKCE S256, 64-byte verifier — `smartAuth.ts:101-114`.
- [x] `state` + `codeVerifier` stashed server-side, 10-min TTL, single-use consume — `smartAuth.ts:387-407`; validated on callback (`labSyncService.ts:131-133`).
- [x] `client_secret` only via Basic auth to host-validated token/revoke endpoints; discovery re-validated — `smartAuth.ts:216-219,256-259,333-343`; `assertSmartEndpoint` wraps `assertAllowedFhirUrl` (`smartAuth.ts:50-56`).
- [x] OAuth tokens AES-256-GCM-encrypted on `LabConnection` with the per-user key; never plaintext at rest or logged — `labSyncService.ts:149-152,222-225,239-242`; decrypt only in-memory for the call.
- [x] FHIR requests carry Bearer only to allowlisted hosts; 30s AbortController; pagination capped at 20 pages — `fhirClient.ts:38-54,107`.
- [x] Refresh preserves old refresh token when not rotated; revoke best-effort (failures swallowed) — `smartAuth.ts:272-276,298-355`.
- [x] No PHI (observation values) logged during sync; synced values encrypted via the same per-user pipeline as manual entry — `labSyncService.ts:332,340-354,406-411` (logs unmapped LOINC codes, not values); FHIR-derived free text sanitized (`labSyncService.ts:526-528,559-566`).

### 8. Error Handling
- [x] External errors don't crash the server — all provider calls wrapped (`claudeExtraction.ts:114-272`, `sbcExtraction.ts:775-1027`, `ocrService.ts:449-484`, `fhirController.ts:191-227`, `aiChatController.ts:330-363`).
- [x] Timeouts on every external call — Claude 30s/2 (60s/1 chat), SendGrid 10s, Document AI 60s, FHIR 30s, SMART 15s (`anthropicClient.ts:24-25`, `aiChatController.ts:77`, `emailService.ts:63`, `ocrService.ts:300`, `fhirClient.ts:26,45-46`, `smartAuth.ts:85-95`).
- [x] Retry/backoff where appropriate — Anthropic SDK `maxRetries` (`anthropicClient.ts:57`).
- [x] Fallback when unavailable — email logs-only without key (`emailService.ts:312-319`); `anthropicClient.isEnabled()` for "feature unavailable" UI (`anthropicClient.ts:67-69`); FHIR feature 503 when unconfigured (`fhirController.ts:45-55`).

### 9. Response Validation
- [x] Responses validated before use — Claude JSON parse + shape filters (above); FHIR `tokenSetFromResponse` requires `access_token` (`smartAuth.ts:279-291`); SMART discovery requires authorize+token endpoints (`smartAuth.ts:137-139`); FHIR bundle entries guarded (`fhirClient.ts:120-131`).
- [x] JSON parse errors handled — try/catch around `JSON.parse` (`claudeExtraction.ts:213-221`, `sbcExtraction.ts:874-882`).
- [x] Unexpected shapes don't crash — missing JSON → `InternalServerError`, not throw-on-undefined (`claudeExtraction.ts:204-210`); FHIR `valueQuantity` absence → skip (`labSyncService.ts:515`).

### 10. Secrets in URLs/Logs
- [x] No API keys in query strings — provider keys travel in headers (Bearer/Basic), not URLs.
- [x] FHIR/SMART error snippets length-capped and token-free — `fhirClient.ts:56` (300-char slice of body), `smartAuth.ts:228,268` (200-char slice); controller logs are 200-char-truncated server-side and never returned to the client (`fhirController.ts:108-132,196-226`).
- [x] OAuth tokens / `client_secret` never logged — revoke/refresh log only status codes and error messages (`smartAuth.ts:318,346-353`); tokens decrypted only in-memory.
- [x] No secrets in referrer headers — backend-to-provider server-side fetches; the OAuth callback bounces the browser to `frontendSuccessRedirect` with `labConnected`/`error` markers only, never the code/token (`fhirController.ts:106-131`).

## Unverifiable
- **Live behavior of Anthropic/Google/SendGrid/Quest under real failure modes** (actual 429/503/timeout responses, real BAA enforcement, real SendGrid sandbox no-delivery) — this is a static review; no live calls were made. Error-mapping code paths were verified by reading, not by triggering.
- **DNS-rebinding exploitability (F-5)** — confirmed the code does not pin resolved IPs (`urlSafety.ts`), but actually exploiting it requires controlling DNS for a trusted host; not testable statically. Reported as accepted residual.
- **Multi-instance PKCE/callback failure (F-3)** and **N×budget overshoot (F-4)** — confirmed structurally in code; the actual misbehavior only manifests with >1 live Cloud Run instance and no Redis, which can't be exercised statically.
- **Whether Cloud Run currently runs with `REDIS_URL` set / `--max-instances=1`** — runtime/infra config, not in-repo; affects whether F-3/F-4 are live exposures or latent.

## Out of scope
- **Deep AI-integration review** (prompt-injection robustness, knowledge-retrieval safety, disclaimer correctness) — delegated to `prompts/27-ai-integration.md`. This review confirmed the external-call mechanics (delimiting, sanitization, cost, BAA) but did not exhaustively red-team the prompts.
- **Application-log PHI redaction internals** — `prompts/31-logging-observability.md` owns `utils/phiRedaction.ts` pattern completeness; here it was reviewed only as the pre-Claude scrub control.
- **Notification preference / unsubscribe enforcement** — lives in `notificationService` (not in the 14 external-API files); only the `emailService` dispatcher was in scope. The opt-out checklist item is enforced upstream of `sendGenericEmail`.
- **Encryption-service correctness and `PHI_FIELDS` ↔ schema lockstep** — owned by `prompts/02-encryption.md` / `_phi-inventory.md`; this review confirmed only that FHIR OAuth tokens (`LabConnection.accessTokenEncrypted`/`refreshTokenEncrypted`) and the Claude cost-analysis response (`CostAnalysis.claudeResponseEncrypted`) are encrypted before write at their call sites.

## Prompt drift
None material. The prompt's specific line-number anchors all resolved correctly (e.g. `ocrService.ts:300` paid call, `:414-416` page-limit re-throw, `:421-426` BAA fallback; `aiCostTracker.ts:67,285,302`; `aiSpendGuard.ts:24,37`). The "8 mount points across 5 route files" and "single `new Anthropic(`" claims are exact. `isAISpendExceeded` is confirmed deleted (grep → No matches), consistent with the prompt's instruction to flag any reference to it.
