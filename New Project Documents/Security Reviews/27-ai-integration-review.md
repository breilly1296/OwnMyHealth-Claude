# 27-ai-integration Review — 2026-06-01

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 4 |
| Info | 1 |

The AI integration is in good shape: a single shared Anthropic client, a BAA runtime gate re-checked at every Claude call site plus a production boot hard-exit, local PDF text extraction + `redactPHI` before any prompt, response re-scrubbing on every sink (including a cross-chunk SSE buffer), a dollar circuit breaker, per-plan caps, demo block, and audit logging that never records prompts/responses. The one substantive gap: three Claude/Document-AI-calling upload routes in `uploadRoutes.ts` omit the `aiSpendGuard` dollar circuit breaker that the parallel `insuranceRoutes.ts` endpoints carry. The rest are hygiene/drift items.

## Findings

### F-1 — AI upload routes bypass the dollar-spend circuit breaker — **Medium**
- **Location:** `backend/src/routes/uploadRoutes.ts:77-85`, `:94-102`, `:124-132`
- **Observation:** `POST /upload/lab-report`, `POST /upload/insurance-sbc`, and `POST /upload/lab-results-ocr` are wired with `aiLimiter → blockDemoAI → requirePlanLimit('pdfUploadsPerMonth')` but **no `aiSpendGuard`**. All three reach an external paid AI API: `uploadLabReport`/`uploadLabResultOCR` call `processDocument` (→ `extractBiomarkersWithClaude` for PDFs, Document AI for images) and `uploadSBC` calls `extractInsuranceFromSBC` (→ Claude Sonnet, the most expensive model, `max_tokens: 16384`). The functionally-equivalent endpoints on `insuranceRoutes.ts` (`/upload-sbc`, `/plans/:id/reanalyze`) **do** include `aiSpendGuard` (`insuranceRoutes.ts:123,136`). `uploadRoutes.ts` does not even import it.
- **Impact:** Once the global or per-user daily dollar budget (`AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD`) is exhausted, the cost circuit breaker still refuses `/ai/chat`, `/biomarkers/:id/guidance`, `/expenses/analyze`, and `/insurance/upload-sbc` — but these three upload routes keep calling Claude/Document AI. A user on an unlimited tier (`pdfUploadsPerMonth: -1` on TEAM, `insurancePlans` aside) or a compromised key can drive unbounded Sonnet spend through the upload path, defeating the stated "fails closed with 503 once budget is hit" guarantee. The per-route `aiLimiter` (10/hour/user) caps request rate but not aggregate dollars, and the budget breaker is the documented backstop.
- **Fix:** Import `aiSpendGuard` in `uploadRoutes.ts` and insert it into all three route stacks (e.g. after `aiLimiter`, before `requirePlanLimit`), matching the order used in `insuranceRoutes.ts:122-124`.
- **Evidence:**
  ```ts
  // uploadRoutes.ts:77-85 — no aiSpendGuard
  router.post('/lab-report', authenticate, aiLimiter, blockDemoAI,
    requirePlanLimit('pdfUploadsPerMonth'), upload.single('file'),
    asyncHandler(uploadLabReport));
  ```
  ```ts
  // insuranceRoutes.ts:131-140 — same workload, WITH aiSpendGuard
  router.post('/upload-sbc', blockDemoAI, uploadLimiter, aiLimiter, aiSpendGuard,
    requirePlanLimit('pdfUploadsPerMonth'), upload.single('file'), asyncHandler(uploadSBC));
  ```

### F-2 — `reset()` for key rotation is never invoked outside tests — **Low**
- **Location:** `backend/src/services/anthropicClient.ts:75-77`
- **Observation:** `reset()` drops the cached SDK singleton so the next `getAnthropicClient()` rebuilds with a fresh `ANTHROPIC_API_KEY`. The only non-test callers in `backend/src` are absent — grep for `reset` finds it referenced only in `anthropicClient.ts` itself and in `*.test.ts`/`*.guidance.test.ts` mocks. The key is read once at first construction (`anthropicClient.ts:49`) and cached for the process lifetime.
- **Impact:** Rotating `ANTHROPIC_API_KEY` (e.g. after a suspected leak) has no effect on a running instance — the old key keeps signing requests until the process restarts. On Cloud Run a deploy/restart happens anyway, so the practical blast radius is limited to long-lived instances between deploys. This is a designed-but-unwired control, consistent with the repo's recurring theme.
- **Fix:** Either wire `reset()` to a key-rotation signal (e.g. an admin/internal endpoint or a SIGHUP handler that re-reads env), or document that rotation requires a restart and remove the implied capability from the module doc-comment (`anthropicClient.ts:15` "one place to tear down on key rotation").
- **Evidence:**
  ```ts
  export function reset(): void {
    client = null;
  }
  ```

### F-3 — In-memory per-instance spend cap is N×budget under autoscale — **Low**
- **Location:** `backend/src/services/aiCostTracker.ts:39-41`, `backend/src/config/index.ts:188-198`
- **Observation:** The rolling daily-spend accumulator (`globalSpentUsd`, `userSpentUsd`) lives in module-level memory, per instance. Under Cloud Run autoscale, each instance enforces the budget independently, so the effective global ceiling is `N × AI_DAILY_BUDGET_USD` (and per-user `N × AI_USER_DAILY_BUDGET_USD`). This is explicitly acknowledged in both the code comment and config, and the spec lists it as a KNOWN LIMITATION — reported here for the record so it is tracked, not closed silently.
- **Impact:** The dollar circuit breaker over-counts headroom when scaled out: an attacker (or a runaway loop) spread across instances can spend up to N× the intended cap before any single instance trips. Bounded only by `--max-instances`. The rate limiters share the same per-instance weakness unless `REDIS_URL` is set.
- **Fix:** Back the accumulator with the same shared store used for rate limiting (Memorystore/Redis) so spend is counted cluster-wide, or set `--max-instances` low enough that N×budget is an acceptable worst case and document the chosen ceiling.
- **Evidence:**
  ```ts
  let spendDayKey = '';
  let globalSpentUsd = 0;
  const userSpentUsd = new Map<string, number>();
  ```

### F-4 — Prompt drift: chat message length cap (200) far below the validated bound (2000) — **Low**
- **Location:** `backend/src/middleware/validation.ts:55-61`, `:658`; `backend/src/controllers/aiChatController.ts:169-175`
- **Observation:** The spec (checklist §3) states the chat message and history "go through `sanitizeForPrompt`; Zod schema `schemas.ai.chat` bounds lengths first." Both hold, but the two bounds disagree by an order of magnitude: `schemas.ai.chat` accepts `message` up to 2000 chars and history `content` up to 5000, while `sanitizeForPrompt` hard-truncates every string to `.substring(0, 200)`. So any chat message over 200 chars (and any history turn over 200 chars) is silently chopped before reaching Claude.
- **Impact:** Not a security hole — truncation is fail-safe for prompt injection. But it is a functional/contract drift: the validation layer advertises a 2000/5000 ceiling the prompt builder never honors, and a user typing a normal-length health question (>200 chars) gets a silently truncated prompt and a possibly nonsensical answer. The 200-char cap is appropriate for short interpolated values (biomarker names) but surprising for free-form chat.
- **Fix:** Decide the real ceiling for chat and make the two agree — e.g. give `sanitizeForPrompt` a `maxLen` parameter and pass a chat-appropriate value (matching the Zod 2000/5000), or lower the Zod bound to 200 if 200 is truly intended. Update whichever the spec should reflect.
- **Evidence:**
  ```ts
  // validation.ts:55-61 (verbatim)
  export function sanitizeForPrompt(input: string): string {
    return input
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, '')   // Strip control characters
      .replace(/\n{2,}/g, '\n')           // Collapse multiple newlines
      .substring(0, 200);                  // Hard length cap
  }
  ```
  ```ts
  // validation.ts:658 — schema allows 10x more than the sanitizer keeps
  message: z.string().min(1).max(2000),
  ```

### F-5 — Prompt drift: biomarker-guidance route comment claims "fetch (no SDK)" — **Low**
- **Location:** `backend/src/routes/biomarkerRoutes.ts:114`
- **Observation:** The route header comment reads "Uses Anthropic Claude API via fetch (no SDK)". The handler below it actually uses the shared SDK client: `getAnthropicClient()` → `client.messages.create(...)` (`biomarkerRoutes.ts:231-236`), and an inline note at `:223-229` even documents the migration off raw `fetch` (F-29 fix). The stale top comment contradicts the code directly under it.
- **Impact:** Documentation-only; misleads a future reviewer into thinking this call site bypasses the shared client's timeout/retry/BAA construction. No runtime effect.
- **Fix:** Update the comment at `biomarkerRoutes.ts:114` to "via the shared Anthropic SDK client (`getAnthropicClient`)".
- **Evidence:**
  ```ts
  // biomarkerRoutes.ts:114 (comment)  vs  :231-236 (code)
  // "Uses Anthropic Claude API via fetch (no SDK) ..."
  const client = getAnthropicClient();
  const response = await client.messages.create({ model: 'claude-haiku-4-5-20251001', ... });
  ```

### F-6 — `pdf-parse` text-extraction usability gate is the sole defense against image-PDF PHI to Claude — **Info**
- **Location:** `backend/src/services/claudeExtraction.ts:123-132`, `backend/src/services/sbcExtraction.ts:782-791`
- **Observation:** Both extractors refuse to call Claude when local text extraction is "not usable" (likely scanned), routing the user to the BAA-gated OCR path instead. This is correct minimum-necessary design (raw pixels never go to Claude vision). The residual risk is that the `usable` heuristic in `pdfTextExtraction.ts` is the *only* thing standing between a text-bearing-but-PHI-laden PDF and Claude; `redactPHI` (regex, best-effort by its own doc-comment) is the second layer. No defect found — flagged as an observation that the redaction layer is explicitly best-effort and should not be treated as a complete PHI oracle.
- **Impact:** None confirmed. Worth a test corpus that exercises lab reports with unlabeled patient names (which `redactPHI` cannot catch) to size the residual exposure.
- **Fix:** None required; consider adding adversarial PHI fixtures to the extraction tests.
- **Evidence:**
  ```ts
  if (!extracted.usable) {
    extractionLogger.warn('Local PDF text extraction insufficient — refusing to call Claude', ...);
    throw new ValidationError('PDF text extraction did not yield enough readable text ...');
  }
  ```

## Checks passed

### 1. API Key Security
- [x] `ANTHROPIC_API_KEY` loaded from env, not hardcoded — `config/index.ts:181`, `anthropicClient.ts:49`.
- [x] Lazy client init (deferred to first call, not module load) — `anthropicClient.ts:46-60` (`if (client) return client;`).
- [x] Single shared client; no rogue `new Anthropic` — only hit is `anthropicClient.ts:54` (grep `new Anthropic` over `backend/src` returns 1 result). All callers use `getAnthropicClient()` (claudeExtraction:114, sbcExtraction:775, expenseController:684, aiChatController:190, biomarkerRoutes:231).
- [x] Key not put in error messages — missing-key path throws a generic `InternalServerError('ANTHROPIC_API_KEY environment variable is not set')` with no value — `anthropicClient.ts:51`.
- [x] `isEnabled()` is presence-only and is paired with the BAA gate, not a substitute — `anthropicClient.ts:67-69`; biomarker route checks `!isAnthropicEnabled() || !config.anthropic.baaActive` — `biomarkerRoutes.ts:137`.

### 2. PHI in AI Prompts
- [x] Chat context excludes identifiers by construction — `healthContextService.ts` assembles only values/trends/counts; `select: { createdAt: true }` for the user row (`:185-188`), never name/DOB/phone/address.
- [x] No encrypted identifier blob decrypted into the chat prompt — grep `firstNameEncrypted|lastNameEncrypted|dateOfBirthEncrypted|memberIdEncrypted` in `healthContextService.ts` returns no matches.
- [x] Chat context re-scrubbed before use — `serializeHealthContext` ends with `return stripPHIFromText(serialized)` — `healthContextService.ts:571`.
- [x] Lab extraction redacts before send — `redactPHI(extracted.text)` then prompt built from `redactedText` — `claudeExtraction.ts:135,158`.
- [x] Extraction prompt instructs Claude to preserve `[*_REDACTED]` and not reconstruct identifiers — `claudeExtraction.ts:72-75`; SBC note at `sbcExtraction.ts:816`.
- [x] Cost-analysis prompt scrubbed before send; `planName`/`insurerName` deliberately excluded from the prompt-builder type — `expenseController.ts:679` (`stripPHIFromText(rawPrompt)`), `:838-846`.
- [x] Chat output re-scrubbed across SSE chunk boundaries via trailing buffer — `aiChatController.ts:46,208-235` (`PHI_SCRUB_WINDOW = 64`, tail flushed at EOF).

### 3. Prompt Injection Prevention
- [x] User message + history sanitized — `sanitizeForPrompt` on message and each history turn — `aiChatController.ts:169-175`.
- [x] History bounded to 20 before send — `.slice(-HISTORY_MAX_MESSAGES)` with `HISTORY_MAX_MESSAGES = 20` — `aiChatController.ts:41,171`; Zod also caps array `.max(20)` — `validation.ts:666`.
- [x] Biomarker name/unit sanitized before prompt construction — `sanitizeForPrompt(biomarker.name)`/`(biomarker.unit)` — `biomarkerRoutes.ts:184-185`.
- [x] System prompt forbids revealing itself / the knowledge block verbatim (rule 7) — `aiChatController.ts:101`.
- [x] Reference knowledge is static/curated, not user-controlled — `ALL_DOCUMENTS = [...HEALTH_KNOWLEDGE, ...INSURANCE_KNOWLEDGE]`, retrieval scores curated docs only — `knowledgeRetrieval.ts:16,300-332`.
- [x] AI response not executed as code/DB query — cost-analysis output is parsed with string helpers (`extractProjectedOOP`/`extractDeductibleMonth`) and stored encrypted; never eval'd — `expenseController.ts:724-742`.

### 4. Response Handling
- [x] Cost-analysis response encrypted before DB write into `claudeResponseEncrypted` — `encryption.encrypt(claudeResponse, userSalt)` — `expenseController.ts:737`.
- [x] Chat responses NOT persisted — `aiChatController.handleAIChat` only streams + audit-logs metadata; no DB write of the answer (whole file).
- [x] Disclaimer in chat system prompt and on both UIs — `aiChatController.ts:104-106`; `HealthGuidePage.tsx:504`; `BiomarkerAIGuidance.tsx:241,253`.
- [x] Timeouts handled — shared default 30s/2 retries (`anthropicClient.ts:24-25`); chat overrides 60s/1 retry (`aiChatController.ts:60,198`); extractors and guidance surface timeout messages (`claudeExtraction.ts:246-249`, `biomarkerRoutes.ts:280-285`).
- [x] Malformed AI JSON caught — `JSON.parse` wrapped in try/catch → typed error, no crash — `claudeExtraction.ts:209-218`, `sbcExtraction.ts:870-879`.
- [x] Output size capped — chat `MAX_OUTPUT_TOKENS = 1000` (`aiChatController.ts:40`); guidance `max_tokens: 600` (`biomarkerRoutes.ts:234`); lab `8192`, SBC `16384`, cost `4000`.

### 5. Rate Limiting & Cost Control
- [x] `aiLimiter` is one of the named limiters, user-keyed with IP fallback, Redis-or-memory store — `rateLimiter.ts:108-125`.
- [x] Full guard stack on the three spec-named routes — `/ai/chat` (`aiRoutes.ts:31-35`), `/biomarkers/:id/guidance` (`biomarkerRoutes.ts:122-126`), `/expenses/analyze` (`expenseRoutes.ts:113-118`): all carry `aiLimiter → aiSpendGuard → blockDemoAI → requirePlanLimit(...) → validate(...)`.
- [x] Per-user caps enforced via `requirePlanLimit` + `usageTracker.checkPlanLimit` against `plans.ts` — `planGating.ts:37-113`, `usageTracker.ts:125-158`, `plans.ts:18-98`.
- [x] `trackAIUsage` called on every successful Claude response — chat (`aiChatController.ts:248`), guidance (`biomarkerRoutes.ts:248`), cost (`expenseController.ts:715`), lab (`claudeExtraction.ts:167`), SBC (`sbcExtraction.ts:844`).
- [x] Budget breaker fails closed with 503; 0 disables a scope — `aiSpendGuard.ts:30-47` (`ServiceUnavailableError`), `aiCostTracker.ts:69-78`.
- [x] Spend recorded post-call, next call refused once over — `recordSpend` runs inside `trackAIUsage` after the response; `isAISpendExceeded` checked pre-call — `aiCostTracker.ts:91-95`, `aiSpendGuard.ts:30`.
- [x] Demo accounts hard-blocked (403) — `blockDemoAI` on all three routes — `demoProtection.ts:164-175`.
- [x] Retries bounded — chat `maxRetries: 1` (`aiChatController.ts:60`); extractors default 2 (`anthropicClient.ts:25`).

### 6. Availability & Graceful Degradation
- [x] BAA-off and failure paths return typed 503/error, do not throw raw — chat 503 (`aiChatController.ts:129-141`), guidance 503 (`biomarkerRoutes.ts:144-150`), cost `ServiceUnavailableError` (`expenseController.ts:632`).
- [x] User informed when AI unavailable — explicit messages in each gate above; frontend distinguishes timeout/unavailable (`ai.ts:208-230`).
- [x] Timeouts on all Claude calls — see §4.

### 7. Google Document AI (OCR)
- [x] Image OCR gated by `GOOGLE_BAA_ACTIVE` — refuses before any image bytes leave — `ocrService.ts:274-280`, `config/index.ts:176`.
- [x] OCR results validated before biomarker use — `validateBiomarkerValue` filter — `ocrService.ts:336-345`.
- [x] Document AI timeout configured — `client.processDocument(request, { timeout: 60_000 })` — `ocrService.ts:298`.
- [x] OCR errors mapped to typed errors, no crash — `ocrService.ts:415-448`.
- [x] File type validated before send — `validateFile` against `SUPPORTED_MIME_TYPES` and size — `ocrService.ts:125-149,388-391`.
- [x] `GCP_LOCATION` / `GCP_PROCESSOR_ID` actually read in the processor name — `ocrService.ts:114-120` (`process.env.GCP_LOCATION || 'us'`, `GCP_PROCESSOR_ID`).
- [x] Credentials from `GOOGLE_APPLICATION_CREDENTIALS` (JSON or file) with parse-failure handling — `ocrService.ts:90-106`.

### 8. Audit Logging
- [x] AI usage audited with `externalApiCall: true` — chat (`aiChatController.ts:260-269`), guidance (`biomarkerRoutes.ts:266-272`).
- [x] Resource strings in sync between writers and `usageTracker` — `RESOURCE_HEALTH_GUIDE = 'HealthGuide'` (`usageTracker.ts:38` = `aiChatController.ts:38`), `RESOURCE_BIOMARKER_GUIDANCE = 'biomarker_ai_guidance'` (`usageTracker.ts:39` = `biomarkerRoutes.ts:266`).
- [x] Blocked/failed calls audited — `CHAT_BLOCKED_NO_BAA`/`CHAT_FAILED` (`aiChatController.ts:130,289`), `GUIDANCE_BLOCKED_NO_BAA`/`GUIDANCE_NOT_FOUND` (`biomarkerRoutes.ts:141,174`), `ANALYZE_BLOCKED_NO_BAA` (`expenseController.ts:629`).
- [x] Log captures model + token counts + success/failure — chat audit includes `model, inputTokens, outputTokens` (`aiChatController.ts:262-268`).
- [x] Prompts NOT logged — chat audit comment + code log only metadata + knowledge doc IDs, never the question/response — `aiChatController.ts:256-269`.
- [x] Responses NOT logged plaintext — guidance audit drops `biomarker.name` (F-16), logs only `phiDisclosedFields` field list — `biomarkerRoutes.ts:258-272`.
- [x] Cost per request emitted via `AICost` structured logger — `aiCostTracker.ts:97-104` (`estimatedCostUsd`).

### 9. HIPAA Compliance
- [x] BAA is the runtime gate (`ANTHROPIC_BAA_ACTIVE === 'true'`), re-checked at every Claude site — `config/index.ts:185`; gates at `claudeExtraction.ts:106`, `sbcExtraction.ts:767`, `expenseController.ts:627`, `aiChatController.ts:129`, `biomarkerRoutes.ts:137`.
- [x] Production hard-exits with key but no BAA flag; dev/staging warn — `config/index.ts:300-310` (`if (config.isProduction) throw ...`).
- [x] Document AI has its own BAA boot check + runtime gate — `config/index.ts:320-330`, `ocrService.ts:274`.
- [x] Anthropic SDK (`^0.91.1`) and Document AI (`^9.5.0`) have no `npm audit` advisories — `npm audit --omit=dev` reports the only AI-adjacent advisory on `@google-cloud/storage` (out of scope here); 0 high/critical overall (8 moderate, none on the SDKs reviewed).

## Unverifiable
- Whether an Anthropic BAA is *actually signed* (vs the flag merely set) — `ANTHROPIC_BAA_ACTIVE` is a runtime assertion; the legal agreement is not visible in the repo. The code correctly treats the flag as the gate (spec §9 Q2).
- Whether a cost-monitoring dashboard / budget-breach alerting consumes the `AICost` structured logs (spec Q5) — logging is emitted (`aiCostTracker.ts:97`) but any external alerting wiring lives outside this repo.
- Anthropic data-retention / no-training-on-PHI policy (spec §9) — external/contractual, not in code.
- Whether `REDIS_URL` is set in the deployed environment (would upgrade rate-limiter and, if migrated, spend accounting to shared) — deployment config not in repo; `createRateLimitStore` defaults to in-memory when unset (`rateLimiter.ts:9-14`).
- `pdfTextExtraction.ts` `usable`/`isLikelyScanned` heuristic quality (F-6) — the threshold logic was not opened in this review; flagged as Info, not asserted as a defect.

## Out of scope
- Upload controller PHI handling, GCS storage, and signed-URL egress (`controllers/upload/*`, `storageService.ts`) — covered by the upload/file-management and external-API prompts; only the AI-call guard stack on the upload *routes* was assessed (F-1).
- Quest/SMART-on-FHIR OAuth token handling (`fhir/*`) — prompt 09-external-apis.
- Generic application-log PHI redaction beyond the AI call sites — prompt 31-logging-observability.
- `analyzeHealthNeeds` (`healthNeedsRoutes.ts:49`) and `suggestGoals` (`healthGoalsRoutes.ts:48`): carry `aiLimiter` but are rule-based and make no Claude call (verified `healthNeedsController.ts:386-425`; no `getAnthropicClient`/`messages.create` in `healthGoalsController.ts`), so they are not external-AI cost routes and are excluded from the F-1 spend-guard finding.
