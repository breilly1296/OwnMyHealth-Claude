# AI / Claude API Integration Security Audit

**Audit Date**: 2026-02-06
**Auditor**: Claude Opus 4.6 (automated security review)
**Scope**: All Anthropic Claude API and Google Document AI integrations
**Severity Legend**: PASS = secure, FAIL = vulnerability found, PARTIAL = partially addressed

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `backend/src/services/claudeExtraction.ts` | 243 | Claude API client for lab report biomarker extraction |
| `backend/src/services/sbcExtraction.ts` | 1001 | Claude API client for SBC insurance document parsing |
| `backend/src/services/ocrService.ts` | 533 | Google Document AI OCR + routing to Claude for PDFs |
| `backend/src/controllers/biomarkerController.ts` | 874 | Biomarker CRUD (no direct AI calls) |
| `backend/src/controllers/expenseController.ts` | 550 | Cost analysis via Claude API |
| `backend/src/controllers/uploadController.ts` | 1493 | Upload endpoints triggering AI extraction |
| `backend/src/routes/biomarkerRoutes.ts` | 193 | Biomarker guidance AI endpoint (inline handler) |
| `backend/src/routes/expenseRoutes.ts` | 56 | Expense/analysis route definitions |
| `backend/src/routes/insuranceRoutes.ts` | 139 | Insurance route definitions (SBC upload) |
| `backend/src/routes/uploadRoutes.ts` | 124 | Upload route definitions |
| `backend/src/config/index.ts` | 199 | Environment configuration |
| `backend/src/middleware/rateLimiter.ts` | 105 | Rate limiter definitions |
| `backend/src/utils/logger.ts` | 145 | Logging utility with sensitive field redaction |
| `src/components/trends/BiomarkerAIGuidance.tsx` | 383 | Frontend AI guidance display component |
| `src/services/api/biomarkers.ts` | 126 | Frontend API client for biomarkers/guidance |
| `src/services/api/expenses.ts` | 162 | Frontend API client for expenses/analysis |

---

## Checklist

### 1. API Key Security

- [x] **PASS** - `ANTHROPIC_API_KEY` loaded from environment (not hardcoded)
  - All four Claude call sites load from `process.env.ANTHROPIC_API_KEY`:
    - `claudeExtraction.ts:49` - `const apiKey = process.env.ANTHROPIC_API_KEY;`
    - `sbcExtraction.ts:316` - `const apiKey = process.env.ANTHROPIC_API_KEY;`
    - `biomarkerRoutes.ts:106` - `const apiKey = process.env.ANTHROPIC_API_KEY;`
    - `expenseController.ts:293` - `const apiKey = process.env.ANTHROPIC_API_KEY;`
  - No hardcoded keys found anywhere in the codebase.

- [ ] **FAIL** - Key validated at startup (format check, not empty)
  - `config/index.ts` does NOT include `ANTHROPIC_API_KEY` in the production `requiredEnvVars` array (line 107-112). The production startup validation only checks `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, and `PHI_ENCRYPTION_KEY`. The AI key is only checked lazily at first use. No format validation (e.g., starts with `sk-ant-`) is performed anywhere.

- [x] **PASS** - Key not logged in any circumstance (including debug mode)
  - The logger utility (`utils/logger.ts:21-27`) has a `SENSITIVE_FIELDS` set that includes `token`, `secret`, `password` etc. and all data is sanitized before logging.
  - No `console.log` statements in `claudeExtraction.ts` or `sbcExtraction.ts`.
  - The API key variable is never passed to any logger call.

- [x] **PASS** - Key not included in error messages or stack traces
  - Error handlers in `claudeExtraction.ts:208-229`, `sbcExtraction.ts:962-987`, `biomarkerRoutes.ts:166-173`, and `expenseController.ts:346-349` all return generic error messages like "AI extraction service not properly configured" without including the API key or raw error details.

- [x] **PASS** - Key redacted in request/response logging
  - The `logger.ts` sanitization function redacts keys matching `SENSITIVE_FIELDS` including `token` and `secret`. The API key is never passed into log data objects. The Anthropic SDK handles its own HTTP requests and does not expose the key in logged metadata.

- [x] **PASS** - Lazy initialization of Claude client (not at module load)
  - `claudeExtraction.ts:42-57` uses a `let anthropicClient: Anthropic | null = null;` singleton with a `getAnthropicClient()` function that creates on first use.
  - `sbcExtraction.ts:309-324` uses the same lazy singleton pattern.
  - `biomarkerRoutes.ts:106` reads the key per-request (no SDK singleton at all -- uses raw `fetch`).
  - `expenseController.ts:299` creates a new `Anthropic` client per-request (no singleton but also no module-level initialization).

### 2. PHI in AI Prompts

- [~] **PARTIAL** - Identify all data sent to Claude API in each use case

  **Biomarker Guidance** (`biomarkerRoutes.ts:125-144`):
  - Sends: biomarker name, numeric value, unit, normal range, status string, and up to 3 historical values with dates.
  - The biomarker object is sent directly from the frontend request body (`req.body.biomarker`). The frontend (`BiomarkerAIGuidance.tsx:199`) sends the full biomarker object and the entire `allBiomarkers` array. The `allBiomarkers` parameter is accepted by the backend route (`biomarkerRoutes.ts:116`) as `_allBiomarkers` but is NOT used in the prompt (prefixed with underscore). However, it is still transmitted over the wire and received by the backend.
  - **Finding**: No patient name, DOB, SSN, or MRN is included in the prompt text. Biomarker names/values are health data but not direct identifiers.

  **SBC Extraction** (`sbcExtraction.ts:329-758`):
  - Sends: The entire SBC PDF document as base64.
  - SBC documents are standardized insurance plan descriptions that generally do not contain individual patient PHI. They contain plan names, insurer details, copays, and benefit structures.
  - **Finding**: Low PHI risk. No patient-specific data in SBC documents.

  **Cost Analysis** (`expenseController.ts:422-494`):
  - Sends: Plan type, deductible amounts, OOP max, coinsurance rate, copay amounts (primary care, specialist, emergency), year-to-date spending, and decrypted expense projections (service type, estimated cost, frequency, in-network status).
  - **Finding**: No patient identifiers (name, DOB, SSN) are included. Financial plan details and projected costs are sent. While not direct identifiers, spending patterns could be considered sensitive health information.

  **Lab Report Extraction** (`claudeExtraction.ts:99-138`):
  - Sends: The entire lab report PDF as base64.
  - **CRITICAL FINDING**: Lab reports typically contain patient name, date of birth, address, provider information, and medical record numbers. The entire PDF is sent to Claude with no preprocessing to remove patient metadata.
  - The extraction prompt (`claudeExtraction.ts:89`) instructs Claude "Do NOT include the patient's name in the response" but the full document containing PHI is still transmitted to the API.

- [ ] **FAIL** - PHI minimized in prompts (send only what's necessary)
  - Lab report extraction sends the entire PDF including all patient identifiers. No preprocessing strips patient demographics from the document before transmission.
  - The guidance endpoint accepts the full biomarker object from the client including any data the frontend chooses to send, without server-side filtering of what enters the prompt.

- [ ] **FAIL** - Patient identifiers (name, DOB, SSN, MRN) stripped before sending
  - `claudeExtraction.ts:110-111`: `const pdfBase64 = pdfBuffer.toString('base64');` -- The raw PDF buffer is base64-encoded and sent directly. No text extraction or patient identifier removal is performed before sending to Claude.
  - The `ClaudeExtractionResult` interface (`claudeExtraction.ts:36`) even includes a `patientName` field, acknowledging that patient names may be present in the extraction output.
  - No PDF redaction or metadata stripping occurs anywhere in the pipeline.

- [~] **PARTIAL** - Prompts reviewed for unnecessary PHI inclusion
  - The SBC extraction prompt and cost analysis prompt are well-designed and contain no patient identifiers.
  - The lab extraction prompt explicitly asks Claude not to return the patient name (line 89: "Do NOT include the patient's name in the response"), but the full PHI-containing document is still sent.
  - The guidance prompt only includes biomarker name/value/unit/range and history data points, which is minimal.

- [~] **PARTIAL** - AI responses do not echo back PHI
  - The lab extraction prompt instructs Claude not to include patient names, and the response validation (`claudeExtraction.ts:187-198`) filters the JSON structure. However, there is no explicit check that the `patientName` field in the response is not populated or used.
  - The SBC extraction response does not contain patient identifiers by design (SBC documents are plan-level, not patient-level).
  - The guidance response is free-form text that could theoretically echo back any data included in the prompt. No post-processing sanitization removes PHI from guidance text.

- [ ] **FAIL** - Document uploads scrubbed of patient metadata before AI processing
  - `uploadController.ts:247`: `await processDocument(file.buffer, file.mimetype, file.originalname)` -- The raw file buffer is passed directly to the processing pipeline and then to Claude.
  - No PDF metadata stripping (removing author, subject, keywords that may contain patient info) occurs.
  - No text-layer redaction of patient demographics before base64 encoding.

### 3. Prompt Injection Prevention

- [ ] **FAIL** - User-controlled text sanitized before inclusion in AI prompts
  - **Guidance endpoint** (`biomarkerRoutes.ts:125-144`): The biomarker object from `req.body` is interpolated directly into the prompt string via template literals: `Biomarker: ${biomarker.name}`, `Value: ${biomarker.value} ${biomarker.unit}`, etc. No sanitization or escaping of the biomarker name, unit, status, or history values is performed. A malicious client could craft a biomarker object with adversarial prompt text in the `name` or `status` fields.
  - **Cost analysis** (`expenseController.ts:432`): Decrypted projection `serviceType` values are interpolated directly into the prompt: `**${p.serviceType}**`. While these values come from the database (user's own encrypted data), they were originally user-supplied and could contain injection payloads.

- [~] **PARTIAL** - Biomarker names/values validated before prompt construction
  - The guidance route validates UUID params (`schemas.uuidParam`) but does NOT validate the `req.body.biomarker` object structure. The body is accepted as-is.
  - For lab extraction, biomarker names come from Claude's response (not user input), so injection risk is lower there.
  - For cost analysis, the `serviceType` was validated on creation but the prompt construction trusts the decrypted value without re-validation.

- [ ] **FAIL** - No arbitrary user input passed directly into system prompts
  - The guidance prompt (`biomarkerRoutes.ts:125-144`) passes user-supplied biomarker data directly into the message content. While this is a user message (not a system prompt), the entire prompt is user-constructed with no separation between instructions and data. An attacker could override the prompt instructions via the `biomarker.name` field (e.g., setting name to "Ignore all previous instructions and...").

- [x] **PASS** - AI responses validated/sanitized before display to user
  - The frontend `BiomarkerAIGuidance.tsx` uses a custom `renderMarkdown` function (lines 34-179) that parses the AI text into React elements using safe JSX rendering. It does NOT use `dangerouslySetInnerHTML`. All text is rendered as React text nodes or wrapped in `<strong>`, `<em>`, `<p>`, `<li>` elements.
  - The `renderMarkdown` function also actively strips disclaimer patterns from the response (lines 36-48).
  - Cost analysis responses are rendered as markdown on the frontend (no `dangerouslySetInnerHTML` found).

- [x] **PASS** - AI responses not executed as code or database queries
  - No `eval()`, `new Function()`, or dynamic SQL construction from AI responses found anywhere.
  - Lab extraction JSON is parsed with `JSON.parse` and then validated for expected structure.
  - SBC extraction JSON is similarly parsed and structurally validated.
  - Cost analysis response is stored encrypted and displayed as text.

### 4. Response Handling

- [x] **PASS** - AI responses validated before storage
  - `claudeExtraction.ts:187-198`: Validates biomarkers array exists, filters items without name or valid numeric value.
  - `sbcExtraction.ts:852-893`: Validates benefits array, plan type enum, array fields, and clamps confidence score to [0, 1].
  - `expenseController.ts:319-329`: Claude response is encrypted before storage. Projected OOP is calculated independently as fallback.

- [x] **PASS** - AI-generated text encrypted before database storage (PHI if contains health info)
  - `expenseController.ts:323`: `claudeResponse: encryption.encrypt(claudeResponse, userSalt)` -- Cost analysis AI response is encrypted with user-specific salt before database storage.
  - `expenseController.ts:324-325`: `totalProjectedOop` encrypted before storage.
  - `expenseController.ts:328`: `projectedExpensesSnapshot` encrypted before storage.
  - Guidance responses are NOT stored in the database (returned directly to the client and cached in-memory on the frontend).

- [~] **PARTIAL** - AI responses don't contain medical diagnoses (educational only)
  - The guidance prompt (`biomarkerRoutes.ts:125-144`) is designed to be educational: "Health education assistant. Be concise and specific." It asks for "What This Measures", "Understanding Your Result", "Questions for Your Doctor", and "What You Can Do".
  - The prompt says "Be direct. No disclaimers needed. Under 200 words total." which actually removes disclaimers from the AI output itself.
  - The cost analysis prompt (`expenseController.ts:432-434`) includes: "CRITICAL: This is informational guidance only, NOT medical or financial advice. Do NOT recommend delaying necessary medical care for cost reasons."
  - **Finding**: The guidance prompt does not explicitly instruct Claude to avoid diagnoses. While the structured sections are educational in nature, nothing prevents Claude from making diagnostic-sounding statements in the "Understanding Your Result" section.

- [x] **PASS** - Medical disclaimers displayed with AI-generated content
  - `BiomarkerAIGuidance.tsx:361-364`: Displays "For educational purposes only. Discuss results with your healthcare provider." below all guidance content.
  - `BiomarkerAIGuidance.tsx:268-270`: Shows an "Educational" badge next to the "AI Health Guide" header.
  - The `renderMarkdown` function (lines 36-48) also strips disclaimer text that Claude might include in its response, relying instead on the UI-level disclaimer.

- [ ] **FAIL** - Responses timeout handled gracefully (60s for analysis endpoints)
  - **No explicit timeout configuration found** on any Claude API call:
    - `claudeExtraction.ts:116-138`: No timeout option on `client.messages.create()`.
    - `sbcExtraction.ts:783-805`: No timeout option on `client.messages.create()`.
    - `expenseController.ts:301-310`: No timeout option on `anthropic.messages.create()`.
    - `biomarkerRoutes.ts:147-164`: No `AbortController` or timeout on the `fetch()` call.
  - The frontend `expenses.ts:134` sets a 60-second timeout on the analysis API call, but the backend has no corresponding timeout on the Claude API request itself. If Claude hangs, the backend request will hang indefinitely.
  - The Anthropic SDK has a default timeout (likely 10 minutes), but this is not explicitly configured.

- [x] **PASS** - Malformed AI responses caught and handled safely
  - `claudeExtraction.ts:157-184`: Handles missing JSON, markdown code blocks wrapping JSON, parse errors, and missing/invalid biomarker fields.
  - `sbcExtraction.ts:823-893`: Same robust JSON extraction with fallback parsing, plan type validation, array validation, confidence clamping.
  - `biomarkerRoutes.ts:175-176`: Falls back to "Unable to generate guidance" if response structure is unexpected.
  - `expenseController.ts:312-316`: Falls back to calculated values if Claude response parsing fails.

- [~] **PARTIAL** - AI response size limited (prevent memory exhaustion)
  - `max_tokens` is set on all Claude calls, which limits response size:
    - Guidance: 600 tokens (`biomarkerRoutes.ts:156`)
    - Lab extraction: 8,192 tokens (`claudeExtraction.ts:118`)
    - SBC extraction: 16,384 tokens (`sbcExtraction.ts:785`)
    - Cost analysis: 4,000 tokens (`expenseController.ts:303`)
  - However, there is no explicit check on the response body size before parsing. A 16K token response could be several hundred KB of text, which is acceptable but not explicitly bounded beyond the `max_tokens` limit.

### 5. Rate Limiting & Cost Control

- [ ] **FAIL** - AI endpoints rate limited (prevent abuse and cost overruns)
  - **Guidance endpoint** (`biomarkerRoutes.ts:102-190`): NO rate limiter is applied. It only has `authenticate` middleware (via the router-level `router.use(authenticate)` at line 34). Any authenticated user can call this endpoint unlimited times.
  - **Cost analysis endpoint** (`expenseRoutes.ts:45`): NO AI-specific rate limiter. Only `csrfProtection` and `authenticate` are applied.
  - **Upload endpoints** (`uploadRoutes.ts:24`): The `uploadLimiter` (20 uploads/hour) is applied, which indirectly limits AI extraction calls.
  - **SBC upload via insurance routes** (`insuranceRoutes.ts:117,126`): The `uploadLimiter` is applied.
  - **Finding**: Two of the four AI endpoints (guidance and cost analysis) have NO rate limiting beyond the global standard limiter.

- [ ] **FAIL** - Per-user rate limits on AI features (not just global)
  - All rate limiters in `rateLimiter.ts` use IP-based key generation (`req.ip || req.socket.remoteAddress`). None use the authenticated user ID as a key.
  - Multiple users behind the same IP (e.g., corporate NAT) would share rate limits.
  - A single user using multiple IPs could bypass rate limits entirely.

- [ ] **FAIL** - Cost tracking/monitoring in place for API usage
  - Token usage is logged in `claudeExtraction.ts:153-154` (`inputTokens`, `outputTokens`) and `sbcExtraction.ts:819-821`, but only to info-level logs.
  - No aggregation, persistence, or dashboard for tracking API costs.
  - The guidance endpoint (`biomarkerRoutes.ts`) and cost analysis endpoint (`expenseController.ts`) do not log token usage at all.
  - No per-user or per-day cost tracking mechanism exists.

- [ ] **FAIL** - Budget caps or alerts configured
  - No budget cap configuration found anywhere in the codebase or environment variables.
  - No alerting mechanism for unusual API usage patterns.
  - Anthropic API usage limits are relied upon implicitly, but no application-level caps exist.

- [ ] **FAIL** - Demo accounts restricted from AI features (or have separate limits)
  - No `demoProtection` middleware is applied to any AI endpoint:
    - `biomarkerRoutes.ts`: No demo check on guidance endpoint.
    - `expenseRoutes.ts`: No demo check on analyze endpoint.
    - `uploadRoutes.ts`: No demo check on upload endpoints (which trigger AI extraction).
  - While the demo account is blocked entirely in production (`config/index.ts:191-197`), in development/staging, demo accounts can use all AI features without restriction.

- [x] **PASS** - Failed AI calls don't retry excessively
  - No retry logic found in any of the four Claude API call sites.
  - `claudeExtraction.ts` and `sbcExtraction.ts` catch errors and throw immediately.
  - `biomarkerRoutes.ts` catches errors and returns error response immediately.
  - `expenseController.ts` catches errors and returns error response immediately.
  - The Anthropic SDK may have internal retry logic (default 2 retries for transient errors), but no application-level retry amplification exists.

### 6. Availability & Graceful Degradation

- [x] **PASS** - AI feature failure doesn't break core functionality
  - Biomarker CRUD (`biomarkerController.ts`) operates independently of AI. Manual entry works without Claude.
  - Insurance plan CRUD (`insuranceController.ts`) works without AI. Plans can be created/managed manually.
  - SBC upload (`uploadController.ts:484-517`) falls back to regex parser when Claude fails: `logger.warn('Claude SBC extraction failed, falling back to regex parser')`.
  - The guidance endpoint returns graceful errors (503 if not configured, 502 on API error, 500 on other failures).

- [ ] **FAIL** - Timeouts configured on all Claude API calls
  - As documented in Section 4, no explicit timeout configuration found on any of the four Claude API call sites.
  - The Anthropic SDK defaults may provide implicit timeouts, but these are not explicitly set or documented.

- [x] **PASS** - User informed when AI service is unavailable
  - `biomarkerRoutes.ts:108-113`: Returns 503 with `"AI guidance service not configured"` when API key is missing.
  - `biomarkerRoutes.ts:169-172`: Returns 502 with `"Failed to get AI guidance"` on API errors.
  - `expenseController.ts:294-296`: Returns 500 with `"Claude API not configured"` when key is missing.
  - `claudeExtraction.ts:219`: Returns `"AI extraction service temporarily unavailable. Please try again."` on rate limit.
  - `ocrService.ts:388-392`: Returns `"PDF extraction service not configured"` when Claude is unavailable.

- [ ] **FAIL** - Cached/stored AI responses served when API is down (if applicable)
  - The frontend `BiomarkerAIGuidance.tsx:28` maintains an in-memory cache (`guidanceCache = new Map<string, string>()`) that persists during the browser session. However, this is client-side only and is lost on page refresh.
  - Cost analyses are stored encrypted in the database and can be retrieved via `GET /api/expenses/analyses` without needing the AI service. This is a form of cached response.
  - No server-side cache exists for guidance responses. If the API is down, every guidance request will fail.

- [x] **PASS** - No blocking of critical paths on AI availability
  - Core features (biomarker tracking, insurance plan management, expense tracking) all function without AI.
  - File upload for lab reports requires Claude for PDFs but this is an enhancement feature, not a critical path.
  - SBC upload gracefully degrades to regex parsing when Claude is unavailable.

### 7. Google Document AI (OCR)

- [x] **PASS** - GCP credentials secured (`GOOGLE_APPLICATION_CREDENTIALS`)
  - `ocrService.ts:89-105`: Credentials are loaded from the `GOOGLE_APPLICATION_CREDENTIALS` environment variable. Supports both JSON string and file path formats.
  - `config/index.ts:94`: `credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || ''`
  - No hardcoded credentials found.

- [x] **PASS** - OCR results validated before biomarker extraction
  - `ocrService.ts:218-228`: OCR-extracted biomarkers are validated with `validateBiomarkerValue()`. Invalid values are logged and discarded.
  - `ocrService.ts:318-330`: Same validation applied to Document AI OCR results.
  - `ocrService.ts:286-288`: Checks that Document AI returned a valid document object.

- [x] **PASS** - Uploaded documents processed in memory (not written to disk)
  - `uploadRoutes.ts:27-28`: Multer uses `multer.memoryStorage()`, so files are stored in memory buffers only.
  - `ocrService.ts:278`: Document content is base64-encoded from the in-memory buffer for the API request.
  - `claudeExtraction.ts:110`: PDF buffer is base64-encoded from memory.
  - No `fs.writeFile` or temporary file creation found in the processing pipeline.

- [x] **PASS** - Document content not logged
  - No OCR text content or base64 document data is logged. Only metadata is logged (buffer size, text length, page count, biomarker count).
  - `claudeExtraction.ts:104-106`: Logs `bufferSize` only.
  - `sbcExtraction.ts:771-773`: Logs `bufferSize` only.
  - `ocrService.ts:293-296`: Logs `textLength` and `pageCount` only.

- [x] **PASS** - OCR service errors handled without crashing
  - `ocrService.ts:397-425`: Comprehensive error handling for `PERMISSION_DENIED`, `NOT_FOUND`, `INVALID_ARGUMENT`, and generic errors. All errors are caught and re-thrown as user-friendly `InternalServerError` or `BadRequestError` messages.
  - `ocrService.ts:380-393`: Claude extraction failure is caught and logged.

- [x] **PASS** - File type validation before sending to Document AI
  - `ocrService.ts:124-148`: `validateFile()` checks buffer size (max 10MB), empty files, and MIME type against `SUPPORTED_MIME_TYPES` list.
  - `uploadRoutes.ts:33-41`: Multer `fileFilter` restricts uploads to PDF for lab reports.
  - `uploadRoutes.ts:50-66`: Multer `fileFilter` restricts OCR uploads to PDF and image types.
  - `uploadController.ts:71-92`: `validateUploadFile()` performs additional validation of MIME type and file size.

### 8. Audit Logging

- [~] **PARTIAL** - AI feature usage logged in audit trail
  - **Upload-based AI features**: All upload endpoints create audit log entries:
    - `uploadController.ts:280-287`: Lab report extraction logged with `LAB_REPORT_RESOURCE`.
    - `uploadController.ts:767-780`: SBC extraction logged with `SBC_RESOURCE`.
    - `uploadController.ts:1456-1472`: OCR extraction logged with `LAB_OCR_RESOURCE`.
  - **Cost analysis**: `expenseController.ts:332-336`: Analysis creation logged as `RESOURCE_TYPE_ANALYSIS`.
  - **Guidance endpoint**: `biomarkerRoutes.ts:102-190`: **NO audit log entry** is created for AI guidance requests. This is a gap -- a user requesting guidance on sensitive biomarkers leaves no HIPAA audit trail.

- [~] **PARTIAL** - Log captures: user, feature used, timestamp, success/failure
  - Upload audit logs capture: userId, filename, fileSize, biomarkersExtracted, extractionConfidence, processorType.
  - Cost analysis audit logs capture: userId, planId, projectionsCount.
  - **Missing**: Guidance endpoint logs nothing to the audit trail. The only logging is at the application logger level (not the HIPAA audit log).

- [~] **PARTIAL** - AI prompts NOT logged (may contain PHI)
  - The structured logger sanitizes sensitive fields, and prompts are not explicitly logged.
  - However, `claudeExtraction.ts:169-172` logs `responseText: responseText.substring(0, 500)` on parse failure. This could contain biomarker data from the Claude response.
  - `sbcExtraction.ts:835-838` similarly logs the first 500 chars of the response on failure.
  - `biomarkerRoutes.ts:168`: Logs the error text from the API response, which could contain prompt fragments.
  - **Finding**: Error paths may inadvertently log partial AI responses containing health data.

- [x] **PASS** - AI responses NOT logged in plaintext (encrypt if stored)
  - Cost analysis responses are encrypted before database storage (`expenseController.ts:323`).
  - Guidance responses are not stored at all (returned directly to client).
  - SBC extraction results are stored as structured database fields (not raw AI response text).
  - Lab extraction results are stored as encrypted biomarker values.

- [ ] **FAIL** - Cost per request tracked (if available from API)
  - Token usage is logged to application logs for `claudeExtraction.ts` and `sbcExtraction.ts` but:
    - Not persisted to database.
    - Not aggregated per user or per time period.
    - Not logged at all for the guidance endpoint (`biomarkerRoutes.ts`).
    - Not logged at all for cost analysis (`expenseController.ts`).
  - No cost calculation (tokens * price-per-token) is performed.

### 9. HIPAA Compliance

- [ ] **FAIL** - Anthropic BAA in place (or documented as pending)
  - No documentation of a Business Associate Agreement (BAA) with Anthropic was found in the codebase.
  - The `CLAUDE.md` project context does not mention BAA status.
  - **Critical**: Sending lab reports containing patient PHI (name, DOB, MRN) to Claude API without a BAA is a potential HIPAA violation.

- [ ] **FAIL** - Data processing agreement covers PHI handling
  - No data processing agreement documentation found in the project.

- [ ] **FAIL** - Anthropic's data retention policy reviewed (no training on PHI)
  - No documentation of review of Anthropic's data retention or training policies found.
  - Anthropic's API ToS generally states that API data is not used for training, but this must be formally documented for HIPAA compliance.

- [ ] **FAIL** - Alternative AI providers evaluated for BAA compliance
  - No documentation of alternative provider evaluation found.

- [ ] **FAIL** - PHI transmission to AI service documented in privacy policy
  - No privacy policy documentation found in the project that discloses AI processing of health data.

---

## Summary of Findings

### Critical Issues (Must Fix)

| # | Finding | Severity | Files |
|---|---------|----------|-------|
| 1 | **Lab reports sent to Claude contain full PHI** (patient name, DOB, MRN) with no stripping | Critical | `claudeExtraction.ts:110-111`, `uploadController.ts:247` |
| 2 | **No Anthropic BAA documented** -- sending PHI without BAA is a HIPAA violation | Critical | Project-wide |
| 3 | **No rate limiting on AI guidance endpoint** -- any authenticated user can make unlimited Claude API calls | High | `biomarkerRoutes.ts:102` |
| 4 | **No rate limiting on cost analysis endpoint** -- unlimited AI calls per user | High | `expenseRoutes.ts:45` |
| 5 | **No prompt injection protection** -- user-supplied biomarker name/value interpolated directly into prompt | High | `biomarkerRoutes.ts:125-144` |
| 6 | **No audit logging for AI guidance** -- HIPAA requires logging PHI access | High | `biomarkerRoutes.ts:102-190` |

### Medium Issues (Should Fix)

| # | Finding | Severity | Files |
|---|---------|----------|-------|
| 7 | `ANTHROPIC_API_KEY` not in production required env vars | Medium | `config/index.ts:107-112` |
| 8 | No explicit timeout on any Claude API call (could hang indefinitely) | Medium | `claudeExtraction.ts:116`, `sbcExtraction.ts:783`, `expenseController.ts:301`, `biomarkerRoutes.ts:147` |
| 9 | Error paths log partial AI responses that may contain health data | Medium | `claudeExtraction.ts:169-172`, `sbcExtraction.ts:835-838` |
| 10 | No per-user rate limits on AI features (all IP-based) | Medium | `rateLimiter.ts` (all limiters) |
| 11 | Demo accounts not restricted from AI features in non-production | Medium | All AI route files |
| 12 | No API cost tracking, budgets, or alerts | Medium | Project-wide |
| 13 | Guidance prompt instructs "No disclaimers needed" -- AI may generate diagnostic-sounding content | Medium | `biomarkerRoutes.ts:144` |
| 14 | `expenseController.ts:299` creates a new `Anthropic` client per request instead of using singleton | Low | `expenseController.ts:299` |
| 15 | `insuranceController.ts:227,236` use `console.error` directly instead of the structured logger, bypassing sensitive field sanitization | Low | `insuranceController.ts:227,236` |
| 16 | No server-side cache for guidance responses | Low | `biomarkerRoutes.ts` |

### Positive Findings

| # | Finding | Files |
|---|---------|-------|
| 1 | API keys loaded from environment, never hardcoded | All AI service files |
| 2 | Lazy client initialization prevents startup failures | `claudeExtraction.ts:42-57`, `sbcExtraction.ts:309-324` |
| 3 | AI responses encrypted before database storage | `expenseController.ts:323-328` |
| 4 | Frontend renders AI text safely (no `dangerouslySetInnerHTML`) | `BiomarkerAIGuidance.tsx:34-179` |
| 5 | Medical disclaimers displayed in frontend UI | `BiomarkerAIGuidance.tsx:361-364` |
| 6 | SBC extraction gracefully degrades to regex parser | `uploadController.ts:484-517` |
| 7 | Documents processed in memory only (no disk writes) | `uploadRoutes.ts:27-28` |
| 8 | Structured logger with sensitive field redaction | `logger.ts:21-44` |
| 9 | File type and size validation before AI processing | `ocrService.ts:124-148`, `uploadController.ts:71-92` |
| 10 | No retry amplification on failed AI calls | All AI service files |
| 11 | JSON responses from Claude validated structurally before use | `claudeExtraction.ts:187-198`, `sbcExtraction.ts:852-893` |
| 12 | Upload endpoints have rate limiting (20/hour) | `uploadRoutes.ts:24` |
| 13 | Cost analysis AI responses never logged in plaintext | `expenseController.ts:323` |

---

## Questions Requiring Business/Legal Input

1. **Is there an Anthropic BAA in place?** This is the single most critical compliance issue. If lab reports with patient identifiers are being sent to Claude, a BAA must be executed before production use.
2. **Is PHI transmission to AI services disclosed in the privacy policy?** Users should be informed that their health data is processed by third-party AI services.
3. **Should lab report extraction strip patient identifiers before sending to Claude?** This would reduce PHI exposure but may affect extraction accuracy if Claude needs document context.
4. **What is the cost budget for Claude API usage?** Without caps, a compromised or abused account could run up significant API costs.
5. **Can users opt out of AI features?** Consider adding a user preference to disable AI guidance and extraction.
6. **Has Anthropic's data retention policy been formally reviewed?** Ensure API data is not retained or used for training per HIPAA requirements.
