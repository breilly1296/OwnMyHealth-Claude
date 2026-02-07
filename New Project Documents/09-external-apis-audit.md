# External API Security Audit Report

**Project:** OwnMyHealth
**Audit Date:** 2026-02-06
**Auditor:** Claude Opus 4.6 (automated security review)
**Scope:** External API integrations -- Anthropic Claude, Google Cloud Storage, Google Document AI, SendGrid
**Priority:** Medium (per prompt metadata)

---

## Files Reviewed

| File | Purpose |
|------|---------|
| `backend/src/services/claudeExtraction.ts` | Anthropic Claude API -- biomarker extraction from lab report PDFs |
| `backend/src/services/sbcExtraction.ts` | Anthropic Claude API -- SBC insurance document extraction |
| `backend/src/services/ocrService.ts` | Google Document AI -- OCR for scanned lab report images |
| `backend/src/services/storageService.ts` | Google Cloud Storage -- file upload, signed URLs, deletion |
| `backend/src/services/emailService.ts` | SendGrid -- verification and password reset emails |
| `backend/src/config/index.ts` | Centralized environment variable configuration |
| `backend/src/controllers/expenseController.ts` | Anthropic Claude API -- cost analysis (direct SDK use) |
| `backend/src/routes/biomarkerRoutes.ts` | Anthropic Claude API -- AI guidance (raw `fetch()` call) |
| `backend/src/controllers/fileController.ts` | File download via GCS signed URLs |
| `backend/src/controllers/uploadController.ts` | File upload orchestration (GCS + Claude + Document AI) |
| `backend/src/middleware/rateLimiter.ts` | Rate limiting configuration |
| `backend/src/utils/logger.ts` | Logging utility with sensitive field sanitization |

---

## External API Inventory

The application communicates with four external services:

1. **Anthropic Claude API** -- Called from three locations:
   - `claudeExtraction.ts` via SDK (`@anthropic-ai/sdk`) -- model: `claude-haiku-4-5-20251001`
   - `sbcExtraction.ts` via SDK -- model: `claude-sonnet-4-20250514`
   - `expenseController.ts` via SDK -- model: `claude-sonnet-4-5-20250929`
   - `biomarkerRoutes.ts` via raw `fetch('https://api.anthropic.com/v1/messages')` -- model: `claude-haiku-4-5-20251001`

2. **Google Cloud Storage** -- Called from `storageService.ts` via `@google-cloud/storage` SDK

3. **Google Document AI** -- Called from `ocrService.ts` via `@google-cloud/documentai` SDK

4. **SendGrid** -- Called from `emailService.ts` via `@sendgrid/mail` SDK (lazy-loaded)

---

## Checklist Results

### 1. API Key Security

- [x] **PASS** -- All keys loaded from environment variables
  All API keys are sourced from `process.env`: `ANTHROPIC_API_KEY` (claudeExtraction.ts:49, sbcExtraction.ts:316, expenseController.ts:293, biomarkerRoutes.ts:106), `SENDGRID_API_KEY` (config/index.ts:82-83), `GOOGLE_APPLICATION_CREDENTIALS` (ocrService.ts:89), `GCP_PROJECT_ID` (ocrService.ts:82, storageService.ts:16).

- [x] **PASS** -- Keys not hardcoded in source code
  Searched all service files for hardcoded keys and found none. The only fallback default is the GCS bucket name `'ownmyhealth-user-files'` (storageService.ts:19), which is not a secret.

- [x] **PASS** -- Keys not logged in any circumstance
  The logger utility (`utils/logger.ts:21-27`) maintains a `SENSITIVE_FIELDS` set that includes `password`, `token`, `accessToken`, `refreshToken`, `secret`, and other sensitive identifiers. These are redacted to `[REDACTED]` before logging. API keys are not passed into log data objects in any of the reviewed files.

- [x] **PASS** -- Keys redacted in error messages
  Error messages thrown to callers are generic (e.g., "AI extraction service not properly configured" at claudeExtraction.ts:214, "Failed to upload file to storage" at storageService.ts:85). The actual API key values never appear in error messages.

- [~] **PARTIAL** -- Keys validated at startup (format, not empty)
  **Finding:** The production startup validation in `config/index.ts:107-198` validates `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, and `PHI_ENCRYPTION_KEY` as required, but does **not** validate `ANTHROPIC_API_KEY`, `SENDGRID_API_KEY`, `GCS_BUCKET_NAME`, `GCP_PROJECT_ID`, or `GOOGLE_APPLICATION_CREDENTIALS` at startup. These are only validated lazily at first use (e.g., claudeExtraction.ts:50-52 throws when `ANTHROPIC_API_KEY` is missing). This means misconfigurations are only discovered when a user triggers an API call, not at deploy time.

### 2. SSRF Prevention

- [x] **PASS** -- User input not directly used in URLs
  The only URL constructed from user input is the GCS storage key in `storageService.ts:53`: `${userId}/${fileId}.${extension}`. The `userId` comes from JWT authentication (not user-supplied), `fileId` is a `crypto.randomUUID()` generated server-side (uploadController.ts:1386), and `extension` comes from a server-side MIME-type-to-extension mapping (storageService.ts:26-34). No user-supplied strings are used in URLs.

- [x] **PASS** -- URL parameters validated (allowlist)
  The only external URL in code is the hardcoded Anthropic API endpoint `https://api.anthropic.com/v1/messages` (biomarkerRoutes.ts:147). All other external calls use SDK clients with configured endpoints. No user input is concatenated into URLs.

- [x] **PASS** -- No arbitrary URL fetching based on user input
  The application does not accept URLs from users for fetching. All external API calls target fixed endpoints.

- [x] **PASS** -- Path traversal prevented in API paths
  Storage keys use UUID-based paths (`userId/fileId.ext`). The MIME-type-to-extension mapping (storageService.ts:26-34) returns only fixed strings (`pdf`, `png`, `jpg`, etc.), preventing path traversal via extension manipulation.

### 3. Anthropic Claude API

- [x] **PASS** -- API key from `ANTHROPIC_API_KEY` environment variable
  Confirmed at: claudeExtraction.ts:49, sbcExtraction.ts:316, expenseController.ts:293, biomarkerRoutes.ts:106.

- [~] **PARTIAL** -- Lazy initialization (not at module load)
  **Finding:** `claudeExtraction.ts` and `sbcExtraction.ts` use proper lazy singleton initialization (the `getAnthropicClient()` pattern at lines 47-57 and 314-324 respectively). However, `expenseController.ts:299` creates a **new Anthropic client on every request**: `const anthropic = new Anthropic({ apiKey })`. This is not a security vulnerability per se, but it means no singleton pattern is applied for the expense analysis endpoint. The `biomarkerRoutes.ts:147` endpoint uses raw `fetch()` which is inherently per-request. No module-level initialization occurs, so this is mostly a pass.

- [~] **PARTIAL** -- Error handling for API failures (timeouts, rate limits, 5xx)
  **Finding:** `claudeExtraction.ts:211-225` and `sbcExtraction.ts:965-983` handle 401, 429 (rate_limit), and 503 (overloaded) errors with user-friendly messages. `biomarkerRoutes.ts:166-173` checks `response.ok` and returns 502 on failure. `expenseController.ts:346-349` has a generic catch block. **However, no explicit request timeouts are configured on any Anthropic API calls.** The SDK and `fetch()` calls rely on default system/SDK timeouts. For large SBC documents, this could result in very long-running requests.

- [ ] **FAIL** -- Cost tracking/limits in place
  **Finding:** Token usage is logged (claudeExtraction.ts:152-153 logs `inputTokens` and `outputTokens`), but there is **no cost tracking, budget enforcement, or per-user usage limits** for Claude API calls. A single user could repeatedly upload documents and trigger unbounded API costs. The upload rate limiter (20 uploads/hour) provides indirect throttling for the upload-triggered extractions, but the `/biomarkers/:id/guidance` endpoint and `/expenses/analyze` endpoint have **no dedicated rate limiter** beyond the global standard limiter (100 requests per 15 minutes).

- [~] **PARTIAL** -- No PHI logged in prompts or responses
  **Finding:** The prompts themselves are static templates and do not log PHI. The Claude extraction prompt (claudeExtraction.ts:89) explicitly instructs "Do NOT include the patient's name in the response." However:
  - At claudeExtraction.ts:169-170, up to 500 characters of the Claude response text are logged on JSON parse failure: `responseText: responseText.substring(0, 500)`. This response text could contain PHI from the lab report.
  - At sbcExtraction.ts:835-836, the same pattern: `responseText: responseText.substring(0, 500)`.
  - At claudeExtraction.ts:194, invalid biomarkers are logged: `extractionLogger.warn('Filtering invalid biomarker', { biomarker: b })` -- biomarker data (names, values) may constitute PHI.
  - At biomarkerRoutes.ts:128-130, the prompt includes actual biomarker values from user data: `Value: ${biomarker.value} ${biomarker.unit}`.
  - The logger's SENSITIVE_FIELDS list does not include keys like `responseText`, `biomarker`, `jsonText`, so these are **not auto-redacted**.

- [x] **PASS** -- AI responses validated before storage/display
  `claudeExtraction.ts:187-198` validates the biomarkers array exists, filters out entries without valid names/values. `sbcExtraction.ts:853-893` validates benefits array, plan type against an allowlist, and clamps extractionConfidence to [0,1]. `expenseController.ts:312-316` extracts specific values from the response. All demonstrate validation before use.

### 4. Google Cloud Storage

- [~] **PARTIAL** -- Credentials from `GOOGLE_APPLICATION_CREDENTIALS`
  **Finding:** The `ocrService.ts:89-105` correctly handles both file-path and inline-JSON forms of `GOOGLE_APPLICATION_CREDENTIALS`. However, `storageService.ts:15-17` initializes the Storage client at **module load time** with only `projectId` -- it relies on Application Default Credentials (ADC) or the `GOOGLE_APPLICATION_CREDENTIALS` environment variable being set. The `storageService.ts` does not explicitly check for or reference `GOOGLE_APPLICATION_CREDENTIALS`. This works in GCP-hosted environments but may fail silently in other environments.

- [x] **PASS** -- Bucket name from `GCS_BUCKET_NAME` environment variable
  Confirmed at storageService.ts:19: `const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'ownmyhealth-user-files'`.

- [x] **PASS** -- Signed URLs have short expiration (15 min)
  Confirmed at storageService.ts:20: `const SIGNED_URL_EXPIRATION_MS = 15 * 60 * 1000` (15 minutes). Used as default parameter at line 100.

- [~] **PARTIAL** -- Bucket is private (no public access)
  **Finding:** This cannot be verified from code alone -- it is a GCP infrastructure configuration. The code correctly uses signed URLs for all access (storageService.ts:97-132), which implies the bucket should be private. However, there is no code-level enforcement or check that the bucket has uniform bucket-level access or `allUsers`/`allAuthenticatedUsers` removed.

- [x] **PASS** -- Upload size limits enforced before sending to GCS
  `ocrService.ts:48` defines `MAX_FILE_SIZE = 10 * 1024 * 1024` (10 MB). `uploadController.ts:71-92` validates file size with `validateUploadFile()` before any processing or upload. The Express body parser also has a 10MB limit per CLAUDE.md middleware stack.

- [x] **PASS** -- File deletion propagates to GCS object
  `fileController.ts:246-258` calls `deleteFromStorage(file.storageKey)` (which maps to `storageService.deleteFile`) when a file is deleted. Errors are caught but do not prevent database record deletion, and 404 errors are handled gracefully (storageService.ts:155-158).

### 5. Google Document AI (OCR)

- [x] **PASS** -- GCP credentials secured
  `ocrService.ts:89-105` loads credentials from `GOOGLE_APPLICATION_CREDENTIALS` environment variable. Supports both inline JSON and file path. Does not hardcode credentials.

- [~] **PARTIAL** -- Document content not logged (may contain PHI)
  **Finding:** The full OCR-extracted text is not logged directly. However:
  - `ocrService.ts:293-296` logs `textLength` (metadata only, safe).
  - `ocrService.ts:324-325` logs invalid biomarker names and validation reasons, which could contain PHI-adjacent data.
  - The `processImageWithDocumentAI` function returns the full `extractedText` in the result object (ocrService.ts:342), which is then used upstream but not logged directly by the OCR service itself.
  - The biomarker extraction text is passed through to `biomarkerExtractor.ts` and not logged.

- [x] **PASS** -- OCR results validated before use
  `ocrService.ts:321-330` validates all extracted biomarkers using `validateBiomarkerValue()` before including them in results. Invalid values are discarded with warnings.

- [ ] **FAIL** -- Processing timeout configured
  **Finding:** No timeout is configured on the `client.processDocument(request)` call at ocrService.ts:283. The Document AI SDK call uses default gRPC timeouts. For large or complex documents, this could result in requests hanging indefinitely.

- [x] **PASS** -- Errors handled without crashing server
  `ocrService.ts:399-425` has comprehensive error handling for `PERMISSION_DENIED`, `NOT_FOUND`, `INVALID_ARGUMENT`, and generic errors. All throw application-level errors (InternalServerError/BadRequestError) rather than crashing.

### 6. SendGrid Email Service

- [x] **PASS** -- `SENDGRID_API_KEY` from environment variable
  Confirmed at config/index.ts:82-83: `enabled: !!process.env.SENDGRID_API_KEY` and `sendgridApiKey: process.env.SENDGRID_API_KEY || ''`.

- [x] **PASS** -- No PHI in email bodies (verification/reset emails only)
  The email service sends only two types of emails: verification (emailService.ts:55-118) and password reset (emailService.ts:123-193). Both contain only a URL with a token -- no user health data, biomarkers, insurance information, or other PHI.

- [x] **PASS** -- From address configured (`EMAIL_FROM`, `EMAIL_FROM_NAME`)
  Confirmed at config/index.ts:84-85: `fromEmail: process.env.EMAIL_FROM || 'noreply@ownmyhealth.com'` and `fromName: process.env.EMAIL_FROM_NAME || 'OwnMyHealth'`. Used in emailService.ts:229-230.

- [x] **PASS** -- `FRONTEND_URL` used for email links (no open redirect)
  Email links are constructed as: `${config.email.frontendUrl}/verify-email?token=${verificationToken}` (emailService.ts:254) and `${config.email.frontendUrl}/reset-password?token=${resetToken}` (emailService.ts:276). The `frontendUrl` comes from `FRONTEND_URL` env var (config/index.ts:86). The token is server-generated and not user-supplied. No user input is included in the URL construction.

- [~] **PARTIAL** -- Email sending rate limited
  **Finding:** Email sending is indirectly rate limited through the auth rate limiter (20 auth attempts per 15 minutes, applied to registration and password reset routes). However, there is no dedicated email-specific rate limiter. The auth limiter provides reasonable protection, but a targeted rate limiter on email-sending endpoints would be more robust.

- [x] **PASS** -- Email delivery errors handled gracefully
  `emailService.ts:240-244` catches errors and returns `{ success: false, error: errorMessage }` without crashing. When SendGrid is unavailable, it falls back to logging (emailService.ts:221-223) and returns success to avoid blocking the user operation.

- [x] **PASS** -- Unsubscribe/opt-out handled if marketing emails added
  Currently only transactional emails (verification, password reset) are sent. These do not require unsubscribe functionality. No marketing emails exist in the codebase.

### 7. Error Handling

- [x] **PASS** -- External API errors don't crash server
  All four external API integrations use try/catch blocks and throw application-level errors (InternalServerError, BadRequestError) or return error responses. No unhandled promise rejections observed.

- [ ] **FAIL** -- Timeouts configured on all external calls
  **Finding:** No explicit timeouts are configured for:
  - Anthropic SDK calls in `claudeExtraction.ts`, `sbcExtraction.ts`, or `expenseController.ts` (the SDK has a default timeout, but it is not explicitly configured)
  - The raw `fetch()` call in `biomarkerRoutes.ts:147-164` has no `signal` or timeout
  - Document AI SDK call in `ocrService.ts:283` has no timeout
  - SendGrid `client.send()` in `emailService.ts:237` has no timeout
  - GCS operations in `storageService.ts` rely on SDK defaults

- [ ] **FAIL** -- Retry logic with backoff where appropriate
  **Finding:** No retry logic exists in any external API integration. Failed Claude API calls, Document AI calls, GCS uploads, and email sends all fail immediately. The SBC extraction has a **fallback** (Claude -> regex parser, at uploadController.ts:484-517), which is not the same as retry.

- [~] **PARTIAL** -- Fallback behavior when API unavailable
  **Finding:**
  - SBC extraction: Falls back from Claude to regex parser (uploadController.ts:484-489). **Good.**
  - Lab report PDF extraction: No fallback -- if Claude fails, the error propagates (ocrService.ts:382-387). **No fallback.**
  - Email: Falls back to logging when SendGrid is unavailable (emailService.ts:221-223). **Good.**
  - GCS: File deletion continues even if GCS delete fails (fileController.ts:246-258). **Reasonable.**
  - AI guidance: No fallback -- returns 502/500 error. **Acceptable for non-critical feature.**

### 8. Response Validation

- [x] **PASS** -- External API responses validated before use
  - Claude responses: JSON is extracted and parsed with error handling (claudeExtraction.ts:157-184, sbcExtraction.ts:823-849). Biomarkers and benefits arrays are validated.
  - Document AI: Document existence is checked (ocrService.ts:286-288).
  - Biomarker guidance: Response shape is checked with optional chaining (biomarkerRoutes.ts:175-176).

- [x] **PASS** -- JSON parsing errors handled gracefully
  `claudeExtraction.ts:176-184` and `sbcExtraction.ts:842-849` both wrap `JSON.parse()` in try/catch with descriptive error logging and user-friendly error messages.

- [x] **PASS** -- Unexpected response shapes don't cause crashes
  - `claudeExtraction.ts:143-146`: Checks for text content block existence.
  - `claudeExtraction.ts:187-189`: Defaults to empty array if `biomarkers` missing.
  - `sbcExtraction.ts:853-893`: Validates and defaults all arrays and the confidence score.
  - `biomarkerRoutes.ts:175-176`: Uses optional chaining: `data.content?.[0]?.text || 'Unable to generate guidance'`.

### 9. Secrets in URLs/Logs

- [x] **PASS** -- API keys in query strings are logged safely
  API keys are passed via HTTP headers (Anthropic: `x-api-key` header in biomarkerRoutes.ts:151; SDK handles headers internally for other calls). No API keys appear in query strings.

- [x] **PASS** -- URLs in error messages have keys redacted
  Error messages contain only generic descriptions ("Failed to upload file to storage", "AI extraction service not properly configured"). No URLs with embedded keys appear in any error message.

- [x] **PASS** -- No secrets in referrer headers
  The application uses Helmet security headers (per CLAUDE.md middleware stack), which sets `Referrer-Policy` to prevent leaking URLs in referrer headers.

- [x] **PASS** -- GCS signed URLs not logged (contain auth tokens)
  The `getSignedUrl` function at storageService.ts:114-120 logs only `storageKey`, `action`, and `expiresIn` at debug level -- the actual signed URL string is not logged. The signed URL is returned to the caller but never written to logs.

---

## Summary of Findings

### Critical Issues (0)

None.

### High-Severity Issues (0)

None.

### Medium-Severity Issues (4)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| M1 | No explicit timeouts on external API calls | claudeExtraction.ts, sbcExtraction.ts, expenseController.ts, biomarkerRoutes.ts, ocrService.ts | All external calls rely on SDK/system default timeouts. Large documents or slow APIs could cause requests to hang for extended periods, consuming server resources. |
| M2 | No retry logic with exponential backoff | All service files | A single transient failure (network blip, temporary 503) results in immediate failure. No retry with backoff is implemented for any external API. |
| M3 | No cost tracking or per-user API usage limits for Claude | claudeExtraction.ts, sbcExtraction.ts, expenseController.ts, biomarkerRoutes.ts | Token usage is logged but not tracked. No budget alerts, per-user quotas, or daily/monthly spending caps exist. A compromised or abusive account could generate significant API costs. |
| M4 | PHI may appear in error logs (Claude response fragments) | claudeExtraction.ts:169-170, sbcExtraction.ts:835-836, claudeExtraction.ts:194, ocrService.ts:324-325 | On JSON parse failure, up to 500 characters of Claude's response text are logged. This response is generated from PHI-containing documents (lab reports, insurance documents) and may contain patient data. Invalid biomarker data is also logged with names and values. |

### Low-Severity Issues (4)

| # | Issue | Location | Description |
|---|-------|----------|-------------|
| L1 | External API keys not validated at startup | config/index.ts:107-198 | Production startup validation checks JWT secrets, DATABASE_URL, and PHI_ENCRYPTION_KEY but not ANTHROPIC_API_KEY, SENDGRID_API_KEY, or GCP credentials. Misconfigured deployments are discovered at runtime, not at startup. |
| L2 | AI guidance endpoint lacks dedicated rate limiter | biomarkerRoutes.ts:102-190 | The `/biomarkers/:id/guidance` POST endpoint relies only on the global standard rate limiter (100 requests/15 min). No AI-specific or per-user rate limiter is applied, unlike the upload routes which have `uploadLimiter`. |
| L3 | Cost analysis endpoint lacks dedicated rate limiter | expenseRoutes.ts:45 | The `/expenses/analyze` POST endpoint has CSRF protection and authentication but no AI-specific rate limiter. Each call triggers a Claude Sonnet API request. |
| L4 | Storage client initialized eagerly at module load | storageService.ts:15-17 | The GCS `Storage` client is created at module import time, unlike the Anthropic and Document AI clients which use lazy singletons. If GCP credentials are misconfigured, the error occurs at module load rather than gracefully at first use. |

---

## Detailed Findings by Category

### Anthropic Claude API -- Usage Patterns

The application uses Claude API from **four** distinct code paths:

1. **claudeExtraction.ts** -- SDK singleton, lazy init, Haiku model, structured JSON extraction from lab PDFs
2. **sbcExtraction.ts** -- SDK singleton, lazy init, Sonnet model, comprehensive SBC extraction with 16K max tokens
3. **expenseController.ts:299** -- SDK per-request (no singleton), Sonnet model, cost analysis
4. **biomarkerRoutes.ts:147** -- Raw `fetch()` call (no SDK), Haiku model, educational guidance

Finding #3 (`expenseController.ts`) and #4 (`biomarkerRoutes.ts`) do not follow the same patterns as #1 and #2. The expense controller creates a new Anthropic client on each request rather than using a singleton. The biomarker guidance route uses raw `fetch()` instead of the SDK, bypassing any SDK-level retry, timeout, or error-handling features.

### GCS Storage Key Construction

The storage key is constructed at `storageService.ts:53`:
```typescript
const storageKey = `${userId}/${fileId}.${extension}`;
```

- `userId` -- from JWT, server-validated UUID
- `fileId` -- `crypto.randomUUID()` generated server-side
- `extension` -- mapped from MIME type via fixed lookup table

This construction is secure against path traversal and injection attacks.

### Email URL Construction

Email links use server-side configuration only:
```typescript
const verificationUrl = `${config.email.frontendUrl}/verify-email?token=${verificationToken}`;
const resetUrl = `${config.email.frontendUrl}/reset-password?token=${resetToken}`;
```

The `verificationToken` and `resetToken` are server-generated cryptographic tokens, not user input. No open redirect vulnerability exists.

### Logger Sensitive Field Sanitization

The logger at `utils/logger.ts:21-27` sanitizes these fields:
```
password, token, accessToken, refreshToken, secret, ssn, socialSecurityNumber,
memberId, groupNumber, memberIdEncrypted, groupIdEncrypted, valueEncrypted,
descriptionEncrypted, noteEncrypted, genotype, email, phoneNumber, address, dateOfBirth
```

**Gap:** Fields like `responseText`, `jsonText`, `biomarker`, `guidance`, and `claudeResponse` are not in this list and could contain PHI when logged in error scenarios.

---

## Recommendations

1. **Add explicit timeouts to all external API calls** -- Configure the Anthropic SDK with `timeout` option, add `AbortSignal.timeout()` to `fetch()` calls, and set gRPC deadlines on Document AI calls. Suggested values: 30s for Anthropic Haiku, 60s for Anthropic Sonnet (large SBCs), 45s for Document AI.

2. **Implement retry with exponential backoff** for transient failures (429, 503) on Claude and Document AI calls. Libraries like `p-retry` can provide this cleanly.

3. **Add cost tracking for Claude API** -- Log token usage to the database with per-user aggregation. Implement daily/monthly usage caps per user. Consider adding an API cost monitoring dashboard in the admin panel.

4. **Add AI-specific rate limiters** -- Create a dedicated rate limiter for AI-powered endpoints (`/biomarkers/:id/guidance`, `/expenses/analyze`, upload routes that trigger Claude). Suggested: 10-20 AI requests per user per hour.

5. **Redact response fragments in error logs** -- Either truncate Claude response text more aggressively (e.g., 50 chars) before logging, or add `responseText` and `biomarker` to the logger's `SENSITIVE_FIELDS` set.

6. **Validate external API keys at startup** -- Add `ANTHROPIC_API_KEY` and `SENDGRID_API_KEY` to the `requiredEnvVars` array in the production startup validation (config/index.ts:107-112), or at minimum log a warning if they are missing.

7. **Standardize Anthropic client usage** -- Refactor `expenseController.ts` to use a shared singleton pattern, and consider migrating the raw `fetch()` in `biomarkerRoutes.ts` to use the SDK for consistent error handling and future timeout/retry support.

---

## Questions Answered

1. **Are all API keys properly secured?**
   Yes -- all keys come from environment variables, are not hardcoded, and are not logged. However, they are not validated at startup in production.

2. **Can user input influence external API URLs?**
   No -- all external API URLs are either hardcoded or configured via environment variables. User input is only sent as document content (PDFs/images) or prompt context (biomarker values), never as URL components.

3. **Are external API errors handled gracefully?**
   Mostly yes -- all integrations have try/catch blocks with user-friendly error messages. However, the absence of timeouts means requests could hang indefinitely, and the absence of retry logic means transient failures are not recovered.

4. **Is there cost monitoring for Claude API and Document AI usage?**
   No -- token usage is logged to stdout (claudeExtraction.ts:152-153) but not tracked, aggregated, or alerted on. No budget or usage limits exist.

5. **Are SendGrid emails free of PHI content?**
   Yes -- only verification and password reset emails are sent, containing only action URLs with opaque tokens. No health data, biomarkers, or insurance information is included in any email.
