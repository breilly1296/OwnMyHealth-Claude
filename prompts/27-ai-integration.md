---
tags:
  - security
  - api
  - high
type: prompt
priority: 2
updated: 2026-06-01
---

# AI / Claude API Integration Security Review

## Files to Review
- `backend/src/services/anthropicClient.ts` (shared lazy Anthropic SDK singleton — `getAnthropicClient`, `isEnabled`, `reset`)
- `backend/src/services/aiCostTracker.ts` (cost logging + in-memory rolling daily-spend accumulator: `trackAIUsage`, `isAISpendExceeded`)
- `backend/src/services/usageTracker.ts` (per-user plan-limit counters from audit rows: `getUserUsage`, `checkPlanLimit`)
- `backend/src/services/claudeExtraction.ts` (Claude lab-report biomarker extraction)
- `backend/src/services/sbcExtraction.ts` (SBC parsing via Claude)
- `backend/src/services/ocrService.ts` (Google Document AI — image OCR, gated by `GOOGLE_BAA_ACTIVE`)
- `backend/src/services/healthContextService.ts` (PHI-scrubbed health-context assembly for the chat system prompt)
- `backend/src/services/knowledge/knowledgeRetrieval.ts` (reference-knowledge injection for chat)
- `backend/src/controllers/aiChatController.ts` (Health Guide SSE chat endpoint — `handleAIChat`)
- `backend/src/controllers/expenseController.ts` (cost analysis endpoint — `analyzeCosts`)
- `backend/src/routes/aiRoutes.ts` (POST `/api/v1/ai/chat`)
- `backend/src/routes/biomarkerRoutes.ts` (POST `/:id/guidance` — AI guidance route + inline handler)
- `backend/src/routes/expenseRoutes.ts` (POST `/analyze` route)
- `backend/src/middleware/aiSpendGuard.ts` (per-call spend circuit breaker — `aiSpendGuard`)
- `backend/src/middleware/rateLimiter.ts` (`aiLimiter`)
- `backend/src/middleware/demoProtection.ts` (`blockDemoAI`)
- `backend/src/middleware/planGating.ts` (`requirePlanLimit`)
- `backend/src/utils/phiRedaction.ts` (`redactPHI`, `stripPHIFromText` — applied before/after every Claude call)
- `backend/src/config/index.ts` (`config.anthropic`, `config.ai` — API key, BAA gate, daily budgets)
- `backend/src/config/plans.ts` (per-tier AI limits: `aiChatsPerDay`, `aiGuidancePerDay`, `costAnalysisPerMonth`)
- `src/components/health/HealthGuidePage.tsx` (Health Guide chat UI)
- `src/components/trends/BiomarkerAIGuidance.tsx` (frontend AI guidance display)
- `src/services/api/ai.ts` (streaming chat client — SSE via fetch + ReadableStream)
- `src/services/api/biomarkers.ts` (guidance API call)
- `src/services/api/expenses.ts` (cost analysis API call)

> NOTE: `uploadController.ts` no longer exists — upload/extraction logic lives in
> `fileController.ts` + `uploadRoutes.ts`. The biomarker AI-guidance handler is
> inlined in `biomarkerRoutes.ts`, not in `biomarkerController.ts`.

## OwnMyHealth AI Architecture
- **Provider**: Anthropic Claude API via shared `getAnthropicClient()` in
  `anthropicClient.ts` (lazy singleton; default `timeout: 30_000`, `maxRetries: 2`).
  Models in use: `claude-haiku-4-5-20251001` (chat, biomarker guidance, lab
  extraction) and `claude-sonnet-4-5-20250929` (cost analysis, SBC extraction;
  also the pricing-table fallback in `aiCostTracker.ts`). Confirm current model
  IDs in each caller — do not assume.
- **Use Cases**:
  - Health Guide chat (`aiChatController.handleAIChat`) — SSE-streamed
    conversational guidance built from server-assembled health context
  - Biomarker guidance (inline handler in `biomarkerRoutes.ts`, educational content on demand)
  - SBC document extraction (`sbcExtraction.ts`, insurance plan parsing)
  - Cost analysis (`expenseController.analyzeCosts`, expense optimization recommendations)
  - Lab report extraction (`claudeExtraction.ts`, biomarker value extraction)
- **PHI Handling**: Must never send raw PHI to external AI services without controls.
  PDF text is locally extracted then run through `redactPHI`/`stripPHIFromText`
  (`utils/phiRedaction.ts`) before any Claude call; chat context is assembled from
  structured (non-identifier) fields and scrubbed again on the stream out.
- **BAA Status**: Anthropic BAA required for HIPAA compliance. Enforced at runtime
  via `config.anthropic.baaActive` (`ANTHROPIC_BAA_ACTIVE === 'true'`). Production
  boot HARD-EXITS if `ANTHROPIC_API_KEY` is set but the BAA flag is not (see
  `config/index.ts` ~line 300); every Claude caller re-checks the flag and refuses
  with 503 if false. Google Document AI image OCR has its own gate,
  `GOOGLE_BAA_ACTIVE` (`config.gcp.documentAiBaaActive`).
- **Cost / spend control**: rolling per-UTC-day budgets in `aiCostTracker.ts`
  (in-memory, per-instance), checked by the `aiSpendGuard` middleware before each
  AI call; `AI_DAILY_BUDGET_USD` (global, default 50) and `AI_USER_DAILY_BUDGET_USD`
  (per-user, default 5). Per-tier request caps live in `plans.ts` and are enforced
  by `requirePlanLimit` + `usageTracker`.

## Checklist

### 1. API Key Security
- [ ] `ANTHROPIC_API_KEY` loaded from environment (not hardcoded)
- [ ] Key validated at startup (format check, not empty)
- [ ] Key not logged in any circumstance (including debug mode)
- [ ] Key not included in error messages or stack traces
- [ ] Key redacted in request/response logging
- [ ] Lazy initialization of Claude client (not at module load) — verify all
  callers go through the single `getAnthropicClient()` in `anthropicClient.ts`
  and no file reintroduces a private `new Anthropic(...)` singleton (the four
  old copy-pasted ones were consolidated here)
- [ ] `reset()` invalidates the cached client on key rotation (no stale key reuse)
- [ ] `isEnabled()` is used for "feature unavailable" UX, not as a substitute for
  the BAA gate (an enabled key with no BAA must still be refused)

### 2. PHI in AI Prompts
- [ ] Identify all data sent to Claude API in each use case:
  - Health Guide chat: context is assembled by `healthContextService.assembleHealthContext`
    from structured fields (values, trends, counts) — verify it excludes name, DOB,
    phone, address, memberId, groupId, provider names
  - Biomarker guidance: what patient data is included in the prompt built in `biomarkerRoutes.ts`?
  - SBC extraction: document content (generally not PHI)
  - Cost analysis: what expense/plan data is sent (prompt assembled then `stripPHIFromText`'d
    in `expenseController.analyzeCosts`)?
  - Lab extraction: PDF text locally extracted, then `redactPHI` strips identifiers
    before the prompt is sent
- [ ] PHI minimized in prompts (minimum-necessary; send only what's necessary)
- [ ] Patient identifiers (name, DOB, SSN, MRN, address, phone) stripped before sending —
  verify via `redactPHI` (extraction) / `stripPHIFromText` (chat/guidance/cost) and that
  no encrypted blob is decrypted straight into a prompt
- [ ] The extraction prompt instructs Claude to preserve `[*_REDACTED]` tokens and never
  reconstruct identifiers (see `EXTRACTION_PROMPT` in `claudeExtraction.ts`)
- [ ] Prompts reviewed for unnecessary PHI inclusion
- [ ] AI responses do not echo back PHI — chat output is re-scrubbed with
  `stripPHIFromText` on the SSE stream, including across chunk boundaries
  (`PHI_SCRUB_WINDOW` trailing buffer in `aiChatController.ts`)
- [ ] Document uploads scrubbed of patient metadata before AI processing

### 3. Prompt Injection Prevention
- [ ] User-controlled text sanitized before inclusion in AI prompts — chat message
  and conversation history go through `sanitizeForPrompt` (`middleware/validation.ts`);
  Zod schema `schemas.ai.chat` bounds lengths first
- [ ] Conversation history is bounded (`HISTORY_MAX_MESSAGES = 20`) before being sent
- [ ] Biomarker names/values validated before prompt construction
- [ ] No arbitrary user input passed directly into system prompts; system prompt
  forbids revealing itself / the reference-knowledge block verbatim (rule 7 in
  `buildSystemPrompt`) — verify it actually holds
- [ ] Reference knowledge injected into the chat prompt (`knowledgeRetrieval`) is
  static/curated, not user-controlled
- [ ] AI responses validated/sanitized before display to user
- [ ] AI responses not executed as code or database queries

### 4. Response Handling
- [ ] AI responses validated before storage
- [ ] AI-generated text encrypted before database storage (PHI if contains health info) —
  cost analysis stores `CostAnalysis.claudeResponseEncrypted` (AES-256-GCM via the
  PHI_FIELDS pipeline; renamed from the old plaintext `claudeResponse` column in
  migration `20260424_align_uuid_defaults_and_rename_claude_response`)
- [ ] Chat responses are NOT persisted (verify `aiChatController` only streams +
  audit-logs metadata, never stores the answer)
- [ ] AI responses don't contain medical diagnoses (educational only)
- [ ] Medical disclaimers displayed with AI-generated content (chat system prompt
  appends the educational-only disclaimer; UI must surface it too)
- [ ] Responses timeout handled gracefully — shared client default 30s/2 retries;
  chat overrides to `timeout: 60_000, maxRetries: 1` (`CHAT_REQUEST_OPTS`); guidance
  and extraction surface a timeout message rather than hanging
- [ ] Malformed AI responses caught and handled safely (extraction expects raw JSON —
  verify parse failures don't crash the request)
- [ ] AI response size limited (`MAX_OUTPUT_TOKENS = 1000` for chat; verify caps on
  the other callers to prevent memory exhaustion)

### 5. Rate Limiting & Cost Control
- [ ] AI endpoints rate limited with `aiLimiter` (one of the eight named limiters in
  `rateLimiter.ts`, backed by `rateLimitStore.ts` — Redis via `REDIS_URL`, in-memory fallback)
- [ ] Every AI route carries the full guard stack — verify on `/ai/chat`,
  `/biomarkers/:id/guidance`, `/expenses/analyze`: `aiLimiter` → `aiSpendGuard` →
  `blockDemoAI` → `requirePlanLimit(...)` → `validate(...)`
- [ ] Per-user request caps enforced via `requirePlanLimit` + `usageTracker.checkPlanLimit`
  against `plans.ts` (`aiChatsPerDay`, `aiGuidancePerDay`, `costAnalysisPerMonth`);
  unlimited tiers (`-1`) are still bounded by the dollar budget below
- [ ] Cost tracking in place — `trackAIUsage` (`aiCostTracker.ts`) logs estimated
  USD per call from token counts; verify it's called on EVERY successful Claude
  response (chat, guidance, cost analysis, both extractors)
- [ ] Dollar budget circuit breaker — `aiSpendGuard` reads `isAISpendExceeded` and
  fails closed with 503 once `AI_DAILY_BUDGET_USD` (global) or
  `AI_USER_DAILY_BUDGET_USD` (per-user) is hit; 0 disables a scope
- [ ] KNOWN LIMITATION: the spend accumulator is in-memory/per-instance, so under
  Cloud Run autoscale the effective ceiling is N×budget (bounded by `--max-instances`).
  Confirm this is acceptable or migrated to a shared store (Memorystore)
- [ ] Spend accounting reflects actual call cost: it's recorded post-call by
  `trackAIUsage`, so the call in flight isn't pre-debited — verify a single runaway
  loop is still bounded (next call is refused once over budget)
- [ ] Demo accounts blocked from AI features via `blockDemoAI` (403, not a separate quota)
- [ ] Failed AI calls don't retry excessively (chat uses `maxRetries: 1`; extractors 2)

### 6. Availability & Graceful Degradation
- [ ] AI feature failure doesn't break core functionality
- [ ] Timeouts configured on all Claude API calls
- [ ] User informed when AI service is unavailable
- [ ] Cached/stored AI responses served when API is down (if applicable)
- [ ] No blocking of critical paths on AI availability

### 7. Google Document AI (OCR)
- [ ] GCP credentials secured (`GOOGLE_APPLICATION_CREDENTIALS`)
- [ ] Image OCR is gated by `GOOGLE_BAA_ACTIVE` (`config.gcp.documentAiBaaActive`) —
  raw image pixels carry demographics no text redaction can scrub, so OCR must refuse
  when the BAA flag is false (see `ocrService.ts` ~line 274)
- [ ] OCR results validated before biomarker extraction
- [ ] Uploaded documents processed in memory (not written to disk)
- [ ] Document content not logged
- [ ] OCR service errors handled without crashing
- [ ] File type validation before sending to Document AI
- [ ] Verify `GCP_LOCATION` / `GCP_PROCESSOR_ID` usage in the processor name match
  current config (CLAUDE.md still lists `GCP_LOCATION` — confirm it's actually read)

### 8. Audit Logging
- [ ] AI feature usage logged in audit trail via `auditService.logAccess` with the
  `externalApiCall: true` flag — verify on chat (`HealthGuide` resource), biomarker
  guidance (`biomarker_ai_guidance`), and cost analysis
- [ ] Audit resourceType strings stay in sync between writers and `usageTracker`
  (`RESOURCE_HEALTH_GUIDE = 'HealthGuide'`, `RESOURCE_BIOMARKER_GUIDANCE =
  'biomarker_ai_guidance'`) — a mismatch silently breaks plan-limit counting
- [ ] Blocked/failed calls are also audited (e.g. `CHAT_BLOCKED_NO_BAA`, `CHAT_FAILED`)
- [ ] Log captures: user, feature/operation, timestamp, model, token counts, success/failure
- [ ] AI prompts NOT logged (may contain PHI) — chat audit explicitly never records
  the question or the response, only metadata + which knowledge doc IDs were used
- [ ] AI responses NOT logged in plaintext (encrypt if stored)
- [ ] Cost per request tracked — `trackAIUsage` emits `estimatedCostUsd` via the
  `AICost` structured logger for log-aggregation queries

### 9. HIPAA Compliance
- [ ] Anthropic BAA in place (or documented as pending) and reflected by
  `ANTHROPIC_BAA_ACTIVE=true` only when truly signed (the flag is the runtime gate,
  not just documentation)
- [ ] Production refuses to boot with a key but no BAA flag — verify the hard-exit in
  `config/index.ts` (~line 300) is intact and not downgraded to a warning in prod
- [ ] Google Cloud BAA covers Document AI before `GOOGLE_BAA_ACTIVE=true` is set
- [ ] Data processing agreement covers PHI handling
- [ ] Anthropic's data retention policy reviewed (no training on PHI)
- [ ] Alternative AI providers evaluated for BAA compliance
- [ ] PHI transmission to AI service documented in privacy policy

## Verification Commands
```bash
# Confirm every Claude call goes through the shared client (no rogue `new Anthropic`)
grep -rn "new Anthropic" backend/src/        # should be ONLY anthropicClient.ts
grep -rn "getAnthropicClient" backend/src/

# Confirm the BAA gate is checked before every Claude call
grep -rn "baaActive\|documentAiBaaActive" backend/src/

# Find what data is sent in AI prompts (chat context + extraction + cost)
grep -rn "assembleHealthContext\|buildSystemPrompt\|EXTRACTION_PROMPT" backend/src/

# Confirm PHI redaction wraps every prompt/response
grep -rn "redactPHI\|stripPHIFromText" backend/src/

# Check for raw identifiers leaking into prompts
grep -rn "firstNameEncrypted\|lastNameEncrypted\|dateOfBirthEncrypted\|memberIdEncrypted" backend/src/services/healthContextService.ts

# Find AI response storage (only cost analysis persists)
grep -rn "claudeResponseEncrypted\|guidance\|aiResponse" backend/src/ --include="*.ts"

# Check the guard stack on AI endpoints
grep -rn "aiLimiter\|aiSpendGuard\|blockDemoAI\|requirePlanLimit" backend/src/routes/

# Confirm cost tracking + spend cap
grep -rn "trackAIUsage\|isAISpendExceeded\|AI_DAILY_BUDGET_USD\|AI_USER_DAILY_BUDGET_USD" backend/src/
```

## Questions to Ask
1. What specific patient data is sent to Claude API in each use case (chat context,
   guidance, cost analysis, extraction)?
2. Is there an Anthropic BAA in place, and is `ANTHROPIC_BAA_ACTIVE=true` only set
   when it is genuinely signed?
3. Are AI responses stored encrypted in the database (cost analysis) and is chat
   confirmed never-persisted?
4. What happens if Claude API returns inappropriate medical advice?
5. Is there a cost monitoring dashboard fed by the `AICost` structured logs, and are
   alerts wired to the daily-budget breaches?
6. Is the in-memory per-instance spend cap acceptable under autoscale, or does it need
   a shared store before relying on it as the billing backstop?
7. Can users opt out of AI features, and are demo accounts hard-blocked (`blockDemoAI`)?
