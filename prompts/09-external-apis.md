---
tags:
  - security
  - api
  - medium
type: prompt
priority: 3
updated: 2026-06-16
---

# External API Security Review

## Files to Review
- `backend/src/services/anthropicClient.ts` (shared Anthropic SDK client — lazy init, timeout/retry, `reset()` for key rotation)
- `backend/src/services/claudeExtraction.ts` (Anthropic Claude API — PDF biomarker extraction)
- `backend/src/services/sbcExtraction.ts` (SBC parsing via Claude)
- `backend/src/services/aiCostTracker.ts` (Claude token cost logging + rolling daily spend accumulator)
- `backend/src/middleware/aiSpendGuard.ts` (pre-call AI budget circuit breaker)
- `backend/src/services/ocrService.ts` (Google Document AI OCR — images + scanned-PDF fallback; BAA-gated)
- `backend/src/services/storageService.ts` (Google Cloud Storage)
- `backend/src/services/emailService.ts` (SendGrid email)
- `backend/src/services/fhir/smartAuth.ts` (Quest SMART-on-FHIR OAuth — PKCE, token exchange/refresh/revoke)
- `backend/src/services/fhir/fhirClient.ts` (FHIR R4 HTTP client — paginated, Bearer-token requests)
- `backend/src/services/fhir/urlSafety.ts` (SSRF / credential-exfiltration allowlist for outbound FHIR URLs)
- `backend/src/services/fhir/labSyncService.ts` (lab sync — encrypted OAuth token storage on `LabConnection`)
- `backend/src/controllers/fhirController.ts` (FHIR connect/callback/sync/disconnect route handlers)
- `backend/src/utils/phiRedaction.ts` (PHI redaction applied before any text is sent to Claude)
- `backend/src/config/index.ts` (API key + integration configuration)
- Any file with `fetch()` or SDK client calls to external services

## OwnMyHealth External Integrations
- **Anthropic Claude API**: PDF/SBC extraction, biomarker guidance, AI chat, cost analysis. Single shared client in `anthropicClient.ts`; gated by `ANTHROPIC_BAA_ACTIVE` (prod hard-fails at boot if key set but BAA flag unset; dev/staging warn + runtime gate blocks calls). Cost tracked in `aiCostTracker.ts`, spend-capped by `aiSpendGuard` middleware.
- **Quest Diagnostics SMART-on-FHIR (NEW)**: OAuth 2.0 authorization-code + PKCE lab-result sync (`fhir/smartAuth.ts`, `fhir/fhirClient.ts`). Outbound URLs are SSRF-guarded by `fhir/urlSafety.ts`; OAuth tokens are stored AES-256-GCM-encrypted on the `LabConnection` model (`accessTokenEncrypted` / `refreshTokenEncrypted`). Feature disabled unless `QUEST_FHIR_CLIENT_ID` is set.
- **Google Cloud Storage**: File upload/download. PHI downloads are now streamed through the backend (`storageService.getFileStream` → `fileController`), NOT served via long-lived signed URLs.
- **Google Document AI**: OCR for scanned lab reports — images AND scanned/image-only PDFs. The text-only Claude path is tried first for PDFs; when it fails to extract (a scanned PDF) AND the Google BAA is active, the raw PDF bytes fall back to Document AI OCR (M-19, `ocrService.ts:401-427`; `processImageWithDocumentAI` accepts `application/pdf`). BAA-gated by `GOOGLE_BAA_ACTIVE` (document bytes carry demographics redaction cannot scrub).
- **SendGrid**: Transactional emails (verification, password reset, account-exists notice, email-change confirm/notice) + engagement/notification emails via `notificationService` + `emailTemplates.ts`. Sandbox mode (`SENDGRID_SANDBOX_MODE`/staging) validates but never delivers.

## Checklist

### 1. API Key Security
- [ ] All keys loaded from environment variables
- [ ] Keys not hardcoded in source code
- [ ] Keys not logged in any circumstance
- [ ] Keys redacted in error messages
- [ ] Keys validated at startup (format, not empty)

### 2. SSRF Prevention
- [ ] User input not directly used in URLs
- [ ] URL parameters validated (allowlist)
- [ ] No arbitrary URL fetching based on user input
- [ ] Path traversal prevented in API paths
- [ ] Server-supplied FHIR URLs (pagination `link[rel=next]`, `/.well-known/smart-configuration` authorize/token/revoke endpoints) pass `assertAllowedFhirUrl()` in `fhir/urlSafety.ts` BEFORE a Bearer token or `client_secret` is attached
- [ ] FHIR/SMART host allowlist confines credentials to the FHIR base host + `QUEST_FHIR_AUTH_HOSTS` only (`isPrivateOrLoopbackHost` blocks 169.254.169.254 cloud metadata, private/loopback, link-local/ULA ranges)
- [ ] Cleartext `http://` refused for public FHIR hosts (allowed only for loopback/private dev mock)
- [ ] Note: host allowlist is NOT a DNS-rebinding defense (resolved IP is not pinned) — confirm this is an accepted residual risk per the `urlSafety.ts` header comment

### 3. Anthropic Claude API
- [ ] API key from `ANTHROPIC_API_KEY` environment variable
- [ ] Single shared client via `anthropicClient.getAnthropicClient()` (no per-file copy-pasted singletons) — lazy init, 30s timeout / 2 retries defaults, `reset()` for key rotation
- [ ] BAA gate enforced: `config.anthropic.baaActive` (`ANTHROPIC_BAA_ACTIVE`) checked before any PHI is sent; prod hard-fails at boot if key set but flag unset (`config/index.ts`); runtime gate in `claudeExtraction`/`sbcExtraction` is load-bearing in dev/staging
- [ ] Error handling for API failures (timeouts, rate limits, 5xx)
- [ ] Cost tracking via `aiCostTracker.trackAIUsage` (records real cost per call after the response) AND spend cap enforced by `aiSpendGuard` via a reserve/settle admission model: the middleware calls `admitAISpend(userId)` BEFORE the call (`aiCostTracker.ts:285`; `aiSpendGuard.ts:24,37`), which places a fixed `RESERVATION_USD = 0.05` Claude estimate (`aiCostTracker.ts:67`) and returns an `Admission` with an idempotent `settle()`; `trackAIUsage()` (`aiCostTracker.ts:302`) then records the actual cost. (`isAISpendExceeded` no longer exists — flag any reference to it.) Budgets `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD`; the accumulator is now pluggable (`InMemorySpendStore` default OR `RedisSpendStore` when `REDIS_URL` set), so the in-memory/per-instance → N×budget caveat applies ONLY without Redis
- [ ] No PHI sent to Claude: PDF text extracted locally then run through `phiRedaction` (`redactPHI`/`stripPHIFromText`) before the prompt; raw PDF bytes never leave the process to Claude; no PDF vision fallback — the Claude layer itself refuses scanned/image-only PDFs (`claudeExtraction.ts:124-133`). NOTE this is true only at the Claude layer: the upload/OCR orchestration (`ocrService.processDocument`) does NOT reject scanned PDFs outright — it routes their raw bytes to Google Document AI OCR when the Google BAA is active (`ocrService.ts:418-426`), so "scanned PDFs rejected" is NOT a property of the upload pipeline as a whole
- [ ] No PHI logged in prompts or responses
- [ ] AI responses validated before storage/display
- [ ] See also [[27-ai-integration]] for detailed AI security review

### 4. Google Cloud Storage
- [ ] Credentials from `GOOGLE_APPLICATION_CREDENTIALS`; project id from `GCP_PROJECT_ID`
- [ ] Bucket name read via `config.gcp.bucketName` (`GCS_BUCKET_NAME`), NOT `process.env` directly — prod hard-fails at boot if unset (F-28; the dev/staging fallback `ownmyhealth-user-files` must never reach prod)
- [ ] PHI downloads stream through the backend (`storageService.getFileStream` → `fileController`, `Cache-Control: no-store`) rather than long-lived signed URLs — every download re-passes authenticate + RLS (legacy signed-URL egress was removed; flag any reintroduced `getSignedUrl(..., 'read')`)
- [ ] Bucket is private (no public access)
- [ ] Upload size limits enforced before sending to GCS (10MB in `ocrService` / upload path)
- [ ] File deletion propagates to GCS object; bulk delete (`deleteFiles`) treats non-404 GCS failures as a hard abort so no PHI is orphaned

### 5. Google Document AI (OCR — images + scanned-PDF fallback)
- [ ] GCP credentials secured (`GOOGLE_APPLICATION_CREDENTIALS` — file path OR inline JSON; processor from `GCP_PROCESSOR_ID`, location from `GCP_LOCATION` default `'us'`, project from `GCP_PROJECT_ID`)
- [ ] BAA gate: Document AI OCR (images AND the scanned-PDF fallback) refuses unless `config.gcp.documentAiBaaActive` (`GOOGLE_BAA_ACTIVE`) — document/image bytes carry demographics text redaction cannot scrub; prod hard-fails at boot if `GCP_PROCESSOR_ID` set but flag unset
- [ ] Scope: images go to Document AI directly; PDFs try the text-only Claude path FIRST, but a scanned PDF Claude can't extract falls back to `processImageWithDocumentAI` (which accepts `application/pdf`) when `config.gcp.documentAiBaaActive` is true (`ocrService.ts:421-426`). The PDF fallback is gated by the BAA AND by a page-limit hard-reject (L28 `PdfPageLimitError` re-thrown before any per-page OCR cost, `ocrService.ts:414-416`) — confirm both gates hold
- [ ] Cost gap — Document AI (the paid `client.processDocument` call, `ocrService.ts:300`) has NO `trackAIUsage` / dollar accounting anywhere in `ocrService.ts`. `aiSpendGuard` only reserves/refunds the fixed $0.05 Claude estimate, so Document AI spend never accrues against `AI_DAILY_BUDGET_USD`. The dollar cap meaningfully bounds only Claude token spend; Document AI is bounded ONLY by the count-based `pdfUploadsPerMonth` quota + rate limit — flag if this is acceptable for the paid OCR path
- [ ] Document content / extracted text not logged (may contain PHI)
- [ ] OCR results validated before use (`validateBiomarkerValue`)
- [ ] Processing timeout configured (`processDocument(request, { timeout: 60_000 })`)
- [ ] Errors handled without crashing server (DEADLINE_EXCEEDED / PERMISSION_DENIED / NOT_FOUND / INVALID_ARGUMENT mapped to safe messages)

### 6. SendGrid Email Service
- [ ] `SENDGRID_API_KEY` from environment variable; client lazy-loaded (`@sendgrid/mail` dynamic import) with a 10s request timeout
- [ ] No PHI in email bodies — verification, password reset, account-exists notice, email-change confirm (new address) / security notice (old address), and engagement/notification emails (`notificationService` + `emailTemplates.ts`)
- [ ] From address configured (`EMAIL_FROM`, `EMAIL_FROM_NAME`)
- [ ] `FRONTEND_URL` used for email links (no open redirect)
- [ ] Sandbox mode (`SENDGRID_SANDBOX_MODE` / staging) validates but never delivers — prod hard-fails at boot if it leaks in (would silently drop all auth email)
- [ ] Email sending rate limited
- [ ] Email delivery errors handled gracefully (dev/no-key path logs instead of sending; send failures don't abort the calling operation; timeouts surfaced distinctly)
- [ ] Unsubscribe/opt-out handled for engagement/notification emails (check notification preferences are honored)

### 7. Quest SMART-on-FHIR OAuth (NEW)
- [ ] Client creds from env (`QUEST_FHIR_CLIENT_ID`, `QUEST_FHIR_CLIENT_SECRET`, `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`, `QUEST_FHIR_SUCCESS_REDIRECT`, `QUEST_FHIR_AUTH_HOSTS`); feature disabled unless `clientId` set
- [ ] PKCE used (S256 challenge, 64-byte verifier) — `generatePKCE` in `fhir/smartAuth.ts`; defeats auth-code interception even without confidential client
- [ ] `state` + `codeVerifier` stashed server-side (`stashChallenge`/`consumeChallenge`, 10-min TTL) and `state` validated on callback (single-use, consumed)
- [ ] `client_secret` sent only via Basic auth to host-validated token/revoke endpoints (`assertSmartEndpoint`); discovery (`/.well-known/smart-configuration`) endpoints re-validated against the host allowlist before use
- [ ] OAuth tokens stored AES-256-GCM-encrypted on `LabConnection` (`accessTokenEncrypted` / `refreshTokenEncrypted`, per-user key via `getEncryptionService`) — never plaintext at rest or in logs
- [ ] FHIR requests carry Bearer token only to allowlisted hosts (`fhirClient.request` → `assertAllowedFhirUrl`); 30s `AbortController` timeout per request; pagination capped at 20 pages
- [ ] Token refresh preserves the old refresh token when the provider doesn't rotate; revoke is best-effort (RFC 7009; failures swallowed so disconnect still succeeds)
- [ ] No PHI (observation values) logged during lab sync; synced values encrypted via the same per-user pipeline as manual entry
- [ ] PKCE verifier cache is in-memory/single-instance — confirm whether a shared cache (Redis) is required under multi-instance Cloud Run

### 8. Error Handling
- [ ] External API errors don't crash server
- [ ] Timeouts configured on all external calls (Claude 30s/2 retries via `anthropicClient`; SendGrid 10s; Document AI 60s; FHIR 30s AbortController)
- [ ] Retry logic with backoff where appropriate
- [ ] Fallback behavior when API unavailable (email logs-only without key; AI features render "unavailable" via `anthropicClient.isEnabled()`)

### 9. Response Validation
- [ ] External API responses validated before use
- [ ] JSON parsing errors handled gracefully
- [ ] Unexpected response shapes don't cause crashes (Claude JSON-only extraction prompt; FHIR Bundle / SMART token-response shape checks)

### 10. Secrets in URLs/Logs
- [ ] API keys in query strings are logged safely
- [ ] URLs in error messages have keys redacted
- [ ] No secrets in referrer headers
- [ ] OAuth tokens / `client_secret` never logged (FHIR Bearer tokens, SMART code exchange); confirm error snippets from FHIR/SMART responses are length-capped and token-free

## External API Inventory
```bash
# Find all external API calls (include the fhir/ subdir)
grep -rn "fetch\|axios\|googleapis\|anthropic\|sendgrid\|documentai\|@google-cloud/storage" backend/src/services/ --include="*.ts" | grep -v "node_modules\|test"

# Find all environment variables for external services
grep -n "ANTHROPIC\|SENDGRID\|EMAIL_\|GCS_\|GCP_\|GOOGLE_\|QUEST_FHIR\|AI_DAILY\|AI_USER" backend/src/config/index.ts

# Confirm every server-supplied outbound FHIR URL passes the SSRF guard
grep -rn "assertAllowedFhirUrl\|isPrivateOrLoopbackHost" backend/src/services/fhir/

# Confirm one shared Anthropic client (no copy-pasted singletons)
grep -rn "new Anthropic(" backend/src/   # expect only anthropicClient.ts
```

## Questions to Ask
1. Are all API keys properly secured (env-only, never logged)?
2. Can user input — or a server's own response — influence external API URLs? Are all server-supplied FHIR URLs host-allowlisted before credentials attach?
3. Are external API errors handled gracefully with timeouts on every call?
4. Is there cost monitoring AND a dollar spend cap for the Claude API (reserve/settle via `admitAISpend`), and BAA-gating for Claude + Document AI usage? Note the dollar cap bounds ONLY Claude — Document AI OCR spend is untracked (bounded only by the `pdfUploadsPerMonth` count quota); is that gap acceptable?
5. Are SendGrid emails free of PHI content, and does sandbox mode hard-fail in production?
6. Are Quest FHIR OAuth tokens encrypted at rest (`LabConnection`) and confined to the trusted host set?
