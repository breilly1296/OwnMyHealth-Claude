---
tags:
  - security
  - api
  - high
type: prompt
priority: 2
---

# AI / Claude API Integration Security Review

## Files to Review
- `backend/src/services/claudeExtraction.ts` (Claude API client)
- `backend/src/services/sbcExtraction.ts` (SBC parsing via Claude)
- `backend/src/services/ocrService.ts` (Google Document AI)
- `backend/src/controllers/biomarkerController.ts` (AI guidance endpoint)
- `backend/src/controllers/expenseController.ts` (cost analysis endpoint)
- `backend/src/controllers/uploadController.ts` (AI-assisted extraction)
- `backend/src/routes/biomarkerRoutes.ts` (guidance route)
- `backend/src/routes/expenseRoutes.ts` (analysis route)
- `backend/src/config/index.ts` (API key configuration)
- `src/components/trends/BiomarkerAIGuidance.tsx` (frontend AI display)
- `src/services/api/biomarkers.ts` (guidance API call)
- `src/services/api/expenses.ts` (cost analysis API call)

## OwnMyHealth AI Architecture
- **Provider**: Anthropic Claude API (claude-haiku or similar)
- **Use Cases**:
  - Biomarker guidance (educational content on demand)
  - SBC document extraction (insurance plan parsing)
  - Cost analysis (expense optimization recommendations)
  - Lab report extraction (biomarker value extraction)
- **PHI Handling**: Must never send raw PHI to external AI services without controls
- **BAA Status**: Anthropic BAA required for HIPAA compliance

## Checklist

### 1. API Key Security
- [ ] `ANTHROPIC_API_KEY` loaded from environment (not hardcoded)
- [ ] Key validated at startup (format check, not empty)
- [ ] Key not logged in any circumstance (including debug mode)
- [ ] Key not included in error messages or stack traces
- [ ] Key redacted in request/response logging
- [ ] Lazy initialization of Claude client (not at module load)

### 2. PHI in AI Prompts
- [ ] Identify all data sent to Claude API in each use case:
  - Biomarker guidance: what patient data is included in prompt?
  - SBC extraction: document content (generally not PHI)
  - Cost analysis: what expense/plan data is sent?
  - Lab extraction: document content (may contain patient identifiers)
- [ ] PHI minimized in prompts (send only what's necessary)
- [ ] Patient identifiers (name, DOB, SSN, MRN) stripped before sending
- [ ] Prompts reviewed for unnecessary PHI inclusion
- [ ] AI responses do not echo back PHI
- [ ] Document uploads scrubbed of patient metadata before AI processing

### 3. Prompt Injection Prevention
- [ ] User-controlled text sanitized before inclusion in AI prompts
- [ ] Biomarker names/values validated before prompt construction
- [ ] No arbitrary user input passed directly into system prompts
- [ ] AI responses validated/sanitized before display to user
- [ ] AI responses not executed as code or database queries

### 4. Response Handling
- [ ] AI responses validated before storage
- [ ] AI-generated text encrypted before database storage (PHI if contains health info)
- [ ] AI responses don't contain medical diagnoses (educational only)
- [ ] Medical disclaimers displayed with AI-generated content
- [ ] Responses timeout handled gracefully (60s for analysis endpoints)
- [ ] Malformed AI responses caught and handled safely
- [ ] AI response size limited (prevent memory exhaustion)

### 5. Rate Limiting & Cost Control
- [ ] AI endpoints rate limited (prevent abuse and cost overruns)
- [ ] Per-user rate limits on AI features (not just global)
- [ ] Cost tracking/monitoring in place for API usage
- [ ] Budget caps or alerts configured
- [ ] Demo accounts restricted from AI features (or have separate limits)
- [ ] Failed AI calls don't retry excessively

### 6. Availability & Graceful Degradation
- [ ] AI feature failure doesn't break core functionality
- [ ] Timeouts configured on all Claude API calls
- [ ] User informed when AI service is unavailable
- [ ] Cached/stored AI responses served when API is down (if applicable)
- [ ] No blocking of critical paths on AI availability

### 7. Google Document AI (OCR)
- [ ] GCP credentials secured (`GOOGLE_APPLICATION_CREDENTIALS`)
- [ ] OCR results validated before biomarker extraction
- [ ] Uploaded documents processed in memory (not written to disk)
- [ ] Document content not logged
- [ ] OCR service errors handled without crashing
- [ ] File type validation before sending to Document AI

### 8. Audit Logging
- [ ] AI feature usage logged in audit trail
- [ ] Log captures: user, feature used, timestamp, success/failure
- [ ] AI prompts NOT logged (may contain PHI)
- [ ] AI responses NOT logged in plaintext (encrypt if stored)
- [ ] Cost per request tracked (if available from API)

### 9. HIPAA Compliance
- [ ] Anthropic BAA in place (or documented as pending)
- [ ] Data processing agreement covers PHI handling
- [ ] Anthropic's data retention policy reviewed (no training on PHI)
- [ ] Alternative AI providers evaluated for BAA compliance
- [ ] PHI transmission to AI service documented in privacy policy

## Verification Commands
```bash
# Find all Claude API calls
grep -r "anthropic\|claude\|ANTHROPIC" backend/src/ --include="*.ts"

# Find what data is sent in AI prompts
grep -r "messages\|prompt\|content" backend/src/services/claudeExtraction.ts

# Check for PHI in AI prompts
grep -r "firstName\|lastName\|dateOfBirth\|ssn\|memberid" backend/src/services/claudeExtraction.ts

# Find AI response storage
grep -r "claudeResponse\|guidance\|aiResponse" backend/src/ --include="*.ts"

# Check rate limiting on AI endpoints
grep -r "guidance\|analyze\|extraction" backend/src/routes/ --include="*.ts"
```

## Questions to Ask
1. What specific patient data is sent to Claude API in each use case?
2. Is there an Anthropic BAA in place for HIPAA compliance?
3. Are AI responses stored encrypted in the database?
4. What happens if Claude API returns inappropriate medical advice?
5. Is there a cost monitoring dashboard for AI API usage?
6. Can users opt out of AI features?
