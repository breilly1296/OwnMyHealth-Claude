# AI / Claude API Integration Review — 2026-06-16

Scope: the Anthropic Claude + Google Document AI integration surface listed in
`prompts/27-ai-integration.md`, reviewed against live code at HEAD `fb2cd32`.
Protocol: `prompts/_review-protocol.md` (no tick without a `file:line` proof).
Every checklist item was executed by reading the actual source; items that could
not be confirmed in code are in **Unverifiable**.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |

Overall posture for the AI surface is strong: a single shared SDK client, a
correctly-ordered guard stack (`aiLimiter → aiSpendGuard → blockDemoAI →
requirePlanLimit → validate`) on all 8 AI mount points, redaction on both the
inbound prompt and the outbound response at every call site, a reserve/settle
dollar circuit-breaker that fails closed (incl. on Redis error), server-side
disclaimer enforcement, and a fail-closed pre-flight audit before any PHI
leaves for Anthropic. The three findings below are hardening/consistency gaps,
not exploitable disclosure or auth-bypass paths.

## Findings

### F-1 — Biomarker-guidance blocked/not-found attempts consume the `aiGuidancePerDay` quota — **Low**
- **Location:** `backend/src/routes/biomarkerRoutes.ts:154-156`, `:187-190`; counted at `backend/src/services/usageTracker.ts:115-122`; default action at `backend/src/services/auditLog.ts:383`.
- **Observation:** The chat controller deliberately logs blocked/failed/initiated attempts under a SEPARATE resourceType `HealthGuideAttempt` so they do not burn the daily quota (the L-35 fix — `aiChatController.ts:48`, `:147-150`, `:349-353`). The biomarker-guidance handler does NOT mirror this: it logs `GUIDANCE_BLOCKED_NO_BAA` (`:154`) and `GUIDANCE_NOT_FOUND` (`:187`) under the SAME resourceType `biomarker_ai_guidance`. `logAccess` always writes `action: 'READ'` (`auditLog.ts:383`), and `usageTracker.getUserUsage` counts exactly `resourceType='biomarker_ai_guidance' AND action='READ' AND createdAt>=today` for the `aiGuidancePerDay` limit (`usageTracker.ts:115-122`). So an attempt that never reached Claude — because the BAA flag is off, or because the biomarker id doesn't exist / belongs to another user (404) — still increments the user's daily guidance counter.
- **Impact:** A FREE user (limit 5/day) can be locked out of guidance by their own failed attempts: 5 requests for non-existent biomarker ids would exhaust the daily quota even though no Claude call (and no cost) ever occurred. Self-affecting only — `requirePlanLimit` + RLS prevent acting on another user's quota — so blast radius is one account's own day. With the BAA flag off, every legitimate guidance attempt is also counted while returning 503, which is confusing but low-impact. This is the exact bug class the chat path's L-35 fix already closed; the guidance path regressed/was never aligned.
- **Fix:** Mirror the chat controller: introduce a `RESOURCE_TYPE_ATTEMPT` (e.g. `'biomarker_ai_guidance_attempt'`) and write the `GUIDANCE_BLOCKED_NO_BAA` and `GUIDANCE_NOT_FOUND` audit rows under it instead of `'biomarker_ai_guidance'`, keeping only the successful `PHI_ACCESS` row (`:284`) on the quota-counted resourceType. Leave `usageTracker.ts` unchanged (a controller-side fix, identical to L-35).
- **Evidence:**
  ```ts
  // biomarkerRoutes.ts:154 — blocked attempt logged on the quota resourceType
  await auditService.logAccess('biomarker_ai_guidance', id, { req, userId }, {
    operation: 'GUIDANCE_BLOCKED_NO_BAA',
  });
  ```
  ```ts
  // usageTracker.ts:115 — that exact resourceType + action=READ is the counter
  tx.auditLog.count({ where: { userId, resourceType: RESOURCE_BIOMARKER_GUIDANCE,
    action: 'READ', createdAt: { gte: today } } }),
  ```

### F-2 — Documented-and-accepted plan-limit/AI-quota TOCTOU race (no atomic reservation) — **Low**
- **Location:** `backend/src/middleware/planGating.ts:90-98`, `backend/src/services/usageTracker.ts:179-208`.
- **Observation:** `requirePlanLimit` calls `checkPlanLimit`, which reads the current usage count and returns allowed/denied, but the usage row (audit row for chat/guidance; `costAnalysis`/`userFile`/biomarker insert for the others) is written later by the route handler — NOT under a lock spanning the gate and that write. Concurrent requests for the same user can each read `current = limit - 1`, all pass, and collectively overshoot a finite per-day/per-month quota. The dollar circuit-breaker (`aiSpendGuard` + `admitAISpend`) IS atomic (in-memory or Redis `INCRBYFLOAT`) and remains the real backstop on spend.
- **Impact:** A user can exceed `aiChatsPerDay` / `aiGuidancePerDay` / `costAnalysisPerMonth` by roughly the number of simultaneous in-flight requests. Because each extra call still passes `aiSpendGuard`, the actual Anthropic bill stays bounded by `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` — so the blast radius is "request-count limit slightly soft under concurrency", not unbounded spend. The code documents this as a known, accepted race with the correct fix (atomic reservation in the usage-write transaction) and a rationale for not half-fixing it.
- **Fix:** As documented in `usageTracker.ts:185-198` — maintain a per-user/per-window counter and do an atomic `UPDATE ... SET n = n + 1 WHERE n < :limit RETURNING n` inside the same `withRLSTransaction` that records the usage, rolling back if the reservation fails; or a DB-side partial-unique/trigger that rejects the (limit+1)-th row. Until then, the dollar cap is the load-bearing control. Reported for completeness; this is an accepted-risk item, not a new bug.
- **Evidence:**
  ```ts
  // usageTracker.ts:179 — explicit known-race note
  // KNOWN RACE (TOCTOU) — finite numeric limits are enforced as count-then-allow
  // with no atomic reservation. Two concurrent requests ... overshoot the limit ...
  ```

### F-3 — Batch biomarker insert can overshoot `maxBiomarkers` by (batchSize − 1) — **Low**
- **Location:** `backend/src/routes/biomarkerRoutes.ts:95-108` (`POST /batch`), and the lab/OCR upload sites `backend/src/routes/uploadRoutes.ts:84-88`, `:138-139`.
- **Observation:** `requirePlanLimit('maxBiomarkers')` is a per-REQUEST gate: it only checks `current < limit` at request time and is unaware of how many rows the request will insert. A single `POST /biomarkers/batch` (or a lab/OCR upload that ingests many biomarkers) by a user who is below the cap can therefore push the stored total past `maxBiomarkers` by up to (batchSize − 1). The shared OCR insert site truncates a single over-cap upload (`createBiomarkersFromOCRResult`, per the M12 comment), but the generic `/batch` route has no such per-row clamp.
- **Impact:** Storage-quota enforcement is soft for the batch path. No PHI/auth impact and self-affecting only (a user inflating their own stored-biomarker count). FREE cap is 50; PRO/TEAM are unlimited (`-1`), so this only matters for FREE accounts and only by the size of one batch. The code documents the limitation and notes the proper fix is owned by another partition.
- **Fix:** Make the gate count-aware for batch/upload paths — pass the incoming row count and reject when `current + incoming > limit`, or clamp the insert to `limit - current` rows inside the same RLS transaction (as the OCR path already does). Tracked/documented, not a regression.
- **Evidence:**
  ```ts
  // biomarkerRoutes.ts:96 — documents the per-request (not per-row) gate
  // A single batch can therefore still push the stored total past the limit by
  // up to (batchSize - 1) rows.
  ```

## Checks passed

### 1. API Key Security
- [x] `ANTHROPIC_API_KEY` loaded from env, not hardcoded — `config/index.ts:241` (`process.env.ANTHROPIC_API_KEY`), `anthropicClient.ts:49`.
- [x] Key not empty-checked into a usable client; missing key throws rather than silently constructing — `anthropicClient.ts:49-52` (`if (!apiKey) throw InternalServerError`).
- [x] Key never logged / never in error messages — the throw at `anthropicClient.ts:51` emits only the variable NAME, not the value; no `apiKey` interpolation in any logger call (verified across all callers).
- [x] Lazy single-client init; all callers go through `getAnthropicClient()` — the only `new Anthropic(...)` in the tree is `anthropicClient.ts:54` (grep confirmed); callers: `aiChatController.ts:231`, `expenseController.ts:748`, `biomarkerRoutes.ts:244`, `claudeExtraction.ts:115`, `sbcExtraction.ts:776`.
- [x] `reset()` invalidates the cached client on rotation — `anthropicClient.ts:75-77` (`client = null`).
- [x] `isEnabled()` is a UX/feature-availability helper, NOT the BAA gate — `anthropicClient.ts:67-69`; the guidance route requires BOTH `isAnthropicEnabled()` AND `config.anthropic.baaActive` (`biomarkerRoutes.ts:150`), so an enabled key without a BAA is still refused.

### 2. PHI in AI Prompts
- [x] Chat context is structured-fields-only, no identifiers — `healthContextService.ts:172-405` selects values/trends/counts; no name/DOB/phone/address/memberId/groupId/provider-name decrypt; the only decrypts are biomarker value (`:229`), expense cost/serviceType (`:296-298`), patientPaid (`:309`). Grep for `firstNameEncrypted|lastNameEncrypted|dateOfBirthEncrypted|memberIdEncrypted` in this file returns nothing.
- [x] Serialized context is re-scrubbed with `stripPHIFromText` as defense-in-depth — `healthContextService.ts:591`.
- [x] Lab/SBC extraction: PDF text extracted locally, `redactPHI` applied before the prompt — `claudeExtraction.ts:118-161`, `sbcExtraction.ts:779-819`; raw PDF bytes never sent (text-only path, no document/base64 block).
- [x] Extraction prompt instructs Claude to preserve `[*_REDACTED]` tokens and never reconstruct identifiers — `claudeExtraction.ts:73-76`, `sbcExtraction.ts:819` ("Do not attempt to reconstruct them").
- [x] Cost-analysis prompt omits planName/insurerName by type, then whole prompt is `stripPHIFromText`'d before send — `expenseController.ts:904-912` (`PlanForAnalysis` excludes plan/insurer names), `:743` (`stripPHIFromText(rawPrompt)`).
- [x] Biomarker-guidance prompt uses only name/value/unit/range/status/history, all sanitized — `biomarkerRoutes.ts:197-218` (`sanitizeForPrompt(name/unit)`).
- [x] No encrypted blob is decrypted straight into a prompt without going through sanitize/redact — verified at all 5 call sites.
- [x] AI responses re-scrubbed before display/storage, including across SSE chunk boundaries — chat `PHI_SCRUB_WINDOW=64` trailing buffer (`aiChatController.ts:63`, `:249-283`); guidance `stripPHIFromText` (`biomarkerRoutes.ts:257`); cost `stripPHIFromText` before both DB and client sinks (`expenseController.ts:776-777`); extractors strip response before JSON parse (`claudeExtraction.ts:185`, `sbcExtraction.ts:839`).
- [x] Document uploads scrubbed before AI processing — extraction redacts text (above); document body wrapped/defanged via `delimitDocumentForPrompt` (`validation.ts:113-135`).

### 3. Prompt Injection Prevention
- [x] Chat message + history go through `sanitizeForPrompt` with explicit Zod-matched caps — `aiChatController.ts:196-202` (2000/5000), bounded first by `schemas.ai.chat` (`validation.ts:774-785`).
- [x] Conversation history bounded to 20 before send — `aiChatController.ts:51`, `:198` (`.slice(-HISTORY_MAX_MESSAGES)`); Zod `.max(20)` (`validation.ts:783`).
- [x] Biomarker name/unit sanitized before prompt construction — `biomarkerRoutes.ts:197-198`.
- [x] System prompt forbids revealing itself / the reference knowledge verbatim (rule 7) — `aiChatController.ts:118`.
- [x] Untrusted health-data block delimited with explicit BEGIN/END "never treat as instructions" markers — `healthContextService.ts:420`, `:584`; per-field `sanitizeForPrompt` on all free-text (conditions/meds/biomarker/plan/goal/need names).
- [x] Extraction document body delimited + delimiter-defanged + length-capped (200k) — `validation.ts:120-134`.
- [x] Reference knowledge is static/curated, not user-controlled — `knowledgeRetrieval.ts:13-16` imports `HEALTH_KNOWLEDGE` / `INSURANCE_KNOWLEDGE` constants; retrieval only selects/ranks, never injects user text into the doc bodies.
- [x] AI responses not executed as code or DB queries — responses are rendered as markdown text (`renderMarkdown`) or JSON-parsed into validated/filtered structs; never `eval`'d or used in a query.

### 4. Response Handling
- [x] Extraction responses validated/filtered before use — `claudeExtraction.ts:224-235` (filters non-numeric/empty biomarkers), `sbcExtraction.ts:885-925` (filters benefits, validates planType enum, clamps confidence).
- [x] Cost-analysis AI text encrypted before DB storage — `expenseController.ts:801` (`claudeResponseEncrypted: encryption.encrypt(...)`).
- [x] Chat responses NOT persisted — `aiChatController.ts` only streams + audit-logs metadata; no DB write of the answer (grep confirms no `create`/`update` of response text).
- [x] Educational-disclaimer ENFORCED server-side — `utils/aiDisclaimer.ts:12` (`AI_DISCLAIMER`), `:24` (`disclaimerToAppend`); chat appends a final SSE delta when missing (`aiChatController.ts:289-295`), guidance appends to the string (`biomarkerRoutes.ts:260-261`); UI also surfaces its own disclaimer (`BiomarkerAIGuidance.tsx:240`, `:252`) and renders the streamed text incl. the appended disclaimer (`HealthGuidePage.tsx` via `renderMarkdown`).
- [x] Timeouts handled — shared default 30s/2 retries (`anthropicClient.ts:24-25`); chat overrides 60s/1 (`aiChatController.ts:77`); guidance/extractors surface a typed timeout message (`biomarkerRoutes.ts:298-306`, `claudeExtraction.ts:249-251`, `sbcExtraction.ts:1000-1002`, `expenseController.ts:763-765`).
- [x] Malformed AI responses handled safely — JSON parse wrapped in try/catch with typed errors, no crash (`claudeExtraction.ts:204-221`, `sbcExtraction.ts:865-882`).
- [x] Output size capped — chat `MAX_OUTPUT_TOKENS=1000` (`aiChatController.ts:50`); guidance `max_tokens: 600` (`biomarkerRoutes.ts:247`); lab extraction 8192, SBC 16384, cost 4000 (`claudeExtraction.ts:152`, `sbcExtraction.ts:810`, `expenseController.ts:754`).

### 5. Rate Limiting & Cost Control
- [x] `aiLimiter` on every AI route — `aiRoutes.ts:31`, `biomarkerRoutes.ts:135`, `expenseRoutes.ts:113`, `uploadRoutes.ts:81/103/134`, `insuranceRoutes.ts:124/137`; 10/hour, user-keyed with /64-IP fallback (`rateLimiter.ts:177-203`), Redis-or-memory store.
- [x] Full guard stack present and ordered on all 8 AI mount points — `aiLimiter → aiSpendGuard → blockDemoAI → requirePlanLimit → validate` (`aiRoutes.ts:31-35`, `biomarkerRoutes.ts:135-139`, `expenseRoutes.ts:113-118`, `uploadRoutes.ts:81-88/103-107/134-139`, `insuranceRoutes.ts:122-126/135-139`).
- [x] Per-user request caps via `requirePlanLimit` + `usageTracker.checkPlanLimit` against `plans.ts` — `planGating.ts:37-124`, `usageTracker.ts:156-209`; plan reads fresh from DB under RLS with `planExpiresAt` downgrade (`planGating.ts:66-75`).
- [x] `trackAIUsage` called on EVERY successful Claude response — chat (`aiChatController.ts:308`), guidance (`biomarkerRoutes.ts:267`), cost (`expenseController.ts:779`), lab (`claudeExtraction.ts:170`), SBC (`sbcExtraction.ts:847`); all use `?? 0` for missing usage so cost tracking never silently skips.
- [x] Dollar circuit-breaker: `aiSpendGuard` calls `admitAISpend` BEFORE the call and registers `settle()` on finish/close — `aiSpendGuard.ts:37`, `:74-75`; `RESERVATION_USD = 0.05` (`aiCostTracker.ts:67`); real cost added post-call by `trackAIUsage`.
- [x] Fails closed with 503 on budget reached AND on shared-store error — `aiSpendGuard.ts:42-52` (Redis error → 503), `:54-68` (budget reached → 503); `0` disables a scope (`aiCostTracker.ts:130/134`, `:209/213`).
- [x] Shared store implemented — `RedisSpendStore` with atomic `INCRBYFLOAT` selected when `REDIS_URL` set, else `InMemorySpendStore` (`aiCostTracker.ts:95`, `:172`, `:257-274`); N×budget per-instance caveat documented.
- [x] Spend recorded post-call, not pre-debited; a runaway loop is still bounded — reservation+settle keeps in-flight charges bounded and `trackAIUsage` records actuals; the NEXT call is refused once over budget (`aiSpendGuard.ts:54`).
- [x] Demo accounts hard-blocked from AI (403) — `blockDemoAI` on all 8 mount points; `demoProtection.ts:164-175`; `isDemoAccount` is safe when `DEMO_EMAIL` unset (`:33-36`).
- [x] Retries bounded — chat `maxRetries: 1` (`aiChatController.ts:77`), extractors default 2 (`anthropicClient.ts:25`).
- [x] `isAISpendExceeded` removed and replaced by reserve+check `admitAISpend` — grep returns no `isAISpendExceeded`; only `admitAISpend` (`aiCostTracker.ts:285`).

### 6. Availability & Graceful Degradation
- [x] AI failure doesn't break core flows — extraction failure falls back (Claude→Document AI when BAA active, else clean 400) `ocrService.ts:401-445`; guidance/cost/chat return typed errors, not crashes.
- [x] Timeouts on all Claude calls — see §4 (shared 30s default + per-call overrides); Document AI `timeout: 60_000` (`ocrService.ts:300`).
- [x] User informed when AI unavailable — 503 with explanatory message on BAA-off (`aiChatController.ts:156-164`, `biomarkerRoutes.ts:157-163`, `expenseController.ts:685-687`) and on budget reached (`aiSpendGuard.ts:60-67`); frontend renders the message and suppresses retry for terminal codes (`ai.ts:124-160`, `HealthGuidePage.tsx:30`).
- [x] No blocking of critical paths on AI availability — biomarker CRUD, file storage, insurance plan CRUD all function without Claude; AI is additive.

### 7. Google Document AI (OCR)
- [x] GCP credentials sourced from `GOOGLE_APPLICATION_CREDENTIALS` (file or inline JSON) — `ocrService.ts:91-107`; never logged.
- [x] Image OCR gated by `GOOGLE_BAA_ACTIVE` / `config.gcp.documentAiBaaActive` — `ocrService.ts:276-282`; gate preserved inside `processImageWithDocumentAI` even when reached via the PDF fallback (`ocrService.ts:421-426`).
- [x] OCR results validated before biomarker extraction — `ocrService.ts:338-347` (`validateBiomarkerValue` filter); raw value not logged (H-1, `:341-345`).
- [x] Documents processed in memory — multer `memoryStorage()` (`uploadRoutes.ts:31`, `:48`; `insuranceRoutes.ts:39`); base64 from the in-memory buffer (`ocrService.ts:295`); no disk write.
- [x] Document content not logged — only lengths/page counts/biomarker names logged (`ocrService.ts:310-313`, `:351-357`); SBC plan/insurer names excluded from logs (`sbcExtraction.ts:927-933`).
- [x] OCR errors handled without crashing — typed mapping for DEADLINE/PERMISSION/NOT_FOUND/INVALID_ARGUMENT (`ocrService.ts:451-484`).
- [x] File-type validation before send — multer `fileFilter` (`uploadRoutes.ts:36-43`, `:53-68`) + `validateFile` MIME allowlist + size cap (`ocrService.ts:40-150`).
- [x] Over-long PDF hard-rejects rather than degrading to per-page Document AI billing — `ocrService.ts:414` re-throws `PdfPageLimitError` (L28).
- [x] `GCP_LOCATION` / `GCP_PROCESSOR_ID` actually read in the processor name — `ocrService.ts:115-121` (`GCP_LOCATION` default `'us'`, `GCP_PROCESSOR_ID` required at `:87`).

### 8. Audit Logging
- [x] AI usage logged with `externalApiCall: true` — chat (`aiChatController.ts:320-329`, resource `HealthGuide`), guidance (`biomarkerRoutes.ts:284-290`, resource `biomarker_ai_guidance`), cost (`expenseController.ts:811-815`).
- [x] resourceType strings in sync between writers and `usageTracker` — `RESOURCE_HEALTH_GUIDE='HealthGuide'` and `RESOURCE_BIOMARKER_GUIDANCE='biomarker_ai_guidance'` (`usageTracker.ts:40-41`) match the controller writers.
- [x] Blocked/failed chat calls audited — `CHAT_BLOCKED_NO_BAA` (`aiChatController.ts:153`), `CHAT_FAILED` (`:357`).
- [x] Fail-closed PRE-FLIGHT `CHAT_INITIATED` audit before PHI leaves — `aiChatController.ts:212-218` (`failClosed: true`, before `flushHeaders`); `failClosed` re-throws on write failure (`auditLog.ts:355-362`).
- [x] Chat attempts logged under SEPARATE `HealthGuideAttempt` so they don't consume quota (L-35) — `aiChatController.ts:48`, `:147-150`, `:213`, `:352-353`; successful `CHAT` stays on `HealthGuide` (`:320`). (NB: the biomarker-guidance path does NOT mirror this — see **F-1**.)
- [x] Log captures user/op/timestamp/model/tokens/success — chat metadata (`aiChatController.ts:320-329`); `AICost` structured log carries model + token counts + `estimatedCostUsd` (`aiCostTracker.ts:315-322`).
- [x] AI prompts NOT logged — no controller logs the question; chat audit records only metadata + knowledge-doc IDs (`aiChatController.ts:316-329`).
- [x] AI responses NOT logged in plaintext; cost-analysis stored encrypted — `expenseController.ts:801`; extraction logs only lengths, not response text.
- [x] Cost per request tracked — `trackAIUsage` emits `estimatedCostUsd` (`aiCostTracker.ts:320`).

### 9. HIPAA Compliance
- [x] BAA is a runtime gate, not just docs — `config.anthropic.baaActive` from `ANTHROPIC_BAA_ACTIVE==='true'` (`config/index.ts:245`); re-checked at every Claude caller (chat `:146`, guidance `:150`, cost `:680`, lab `:107`, SBC `:768`).
- [x] Production hard-exits with a key but no BAA flag — `config/index.ts:381-394` (`throw` in prod, warn in dev/staging); intact, not downgraded.
- [x] Document AI image OCR has the parallel `GOOGLE_BAA_ACTIVE` prod hard-exit — `config/index.ts:401-414`.

## Unverifiable
- Whether the signed Anthropic BAA and the Google Cloud BAA covering Document AI actually exist (org/legal fact) — the code only enforces the `ANTHROPIC_BAA_ACTIVE` / `GOOGLE_BAA_ACTIVE` runtime assertions; it cannot confirm a real agreement is in place.
- Anthropic's data-retention / no-training-on-PHI posture and whether it's reflected in the privacy policy — external/contractual, not in this repo.
- That `REDIS_URL` / Cloud Memorystore is actually provisioned in production (so the shared cross-instance spend cap is in force rather than the N×budget per-instance fallback) — runtime/infra state, not visible in source.
- Whether a cost-monitoring dashboard / budget-breach alerting is wired to the `AICost` structured logs — observability config, outside the repo.
- That `ANTHROPIC_API_KEY` is delivered via Secret Manager (not a plaintext env in the deploy) — deploy/infra concern, not in source.

## Out of scope
- General CSRF/auth mechanics of `/ai/chat` beyond the AI surface — the bearer-only + global-exemption pairing was confirmed correct (`aiRoutes.ts:21`, `csrf.ts:139`) but full CSRF analysis belongs to `04-csrf-review`.
- The PHI-encryption pipeline internals (PHI_FIELDS, per-user PBKDF2 keys) — covered by `02-encryption-review`; here only confirmed that AI call sites encrypt-before-store and decrypt-then-redact.
- Rate-limiter store internals (Redis vs in-memory keying, IPv6 keygen) — covered by `08-rate-limiting-review`; here only confirmed `aiLimiter` is applied to every AI route.
- FHIR/Quest OAuth integration — a different external-API surface (`config.quest`), not part of the Claude/Document AI checklist.
