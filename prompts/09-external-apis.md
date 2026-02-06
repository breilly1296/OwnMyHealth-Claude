---
tags:
  - security
  - api
  - medium
type: prompt
priority: 3
---

# External API Security Review

## Files to Review
- `backend/src/services/claudeExtraction.ts` (Anthropic Claude API)
- `backend/src/services/sbcExtraction.ts` (SBC parsing via Claude)
- `backend/src/services/ocrService.ts` (Google Document AI)
- `backend/src/services/storageService.ts` (Google Cloud Storage)
- `backend/src/services/emailService.ts` (SendGrid email)
- `backend/src/config/index.ts` (API key configuration)
- Any file with `fetch()` or SDK client calls to external services

## OwnMyHealth External Integrations
- **Anthropic Claude API**: PDF extraction, biomarker guidance, cost analysis
- **Google Cloud Storage**: File upload/download (presigned URLs)
- **Google Document AI**: OCR for scanned lab reports and images
- **SendGrid**: Transactional emails (verification, password reset)

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

### 3. Anthropic Claude API
- [ ] API key from `ANTHROPIC_API_KEY` environment variable
- [ ] Lazy initialization (not at module load)
- [ ] Error handling for API failures (timeouts, rate limits, 5xx)
- [ ] Cost tracking/limits in place
- [ ] No PHI logged in prompts or responses
- [ ] AI responses validated before storage/display
- [ ] See also [[27-ai-integration]] for detailed AI security review

### 4. Google Cloud Storage
- [ ] Credentials from `GOOGLE_APPLICATION_CREDENTIALS`
- [ ] Bucket name from `GCS_BUCKET_NAME` environment variable
- [ ] Signed URLs have short expiration (15 min)
- [ ] Bucket is private (no public access)
- [ ] Upload size limits enforced before sending to GCS
- [ ] File deletion propagates to GCS object

### 5. Google Document AI (OCR)
- [ ] GCP credentials secured
- [ ] Document content not logged (may contain PHI)
- [ ] OCR results validated before use
- [ ] Processing timeout configured
- [ ] Errors handled without crashing server

### 6. SendGrid Email Service
- [ ] `SENDGRID_API_KEY` from environment variable
- [ ] No PHI in email bodies (verification/reset emails only)
- [ ] From address configured (`EMAIL_FROM`, `EMAIL_FROM_NAME`)
- [ ] `FRONTEND_URL` used for email links (no open redirect)
- [ ] Email sending rate limited
- [ ] Email delivery errors handled gracefully
- [ ] Unsubscribe/opt-out handled if marketing emails added

### 7. Error Handling
- [ ] External API errors don't crash server
- [ ] Timeouts configured on all external calls
- [ ] Retry logic with backoff where appropriate
- [ ] Fallback behavior when API unavailable

### 8. Response Validation
- [ ] External API responses validated before use
- [ ] JSON parsing errors handled gracefully
- [ ] Unexpected response shapes don't cause crashes

### 9. Secrets in URLs/Logs
- [ ] API keys in query strings are logged safely
- [ ] URLs in error messages have keys redacted
- [ ] No secrets in referrer headers
- [ ] GCS signed URLs not logged (contain auth tokens)

## External API Inventory
```bash
# Find all external API calls
grep -r "fetch\|axios\|googleapis\|anthropic\|sendgrid" backend/src/services/ --include="*.ts" | grep -v "node_modules\|test"

# Find all environment variables for external services
grep -r "ANTHROPIC\|SENDGRID\|GCS_\|GCP_\|GOOGLE_" backend/src/config/index.ts
```

## Questions to Ask
1. Are all API keys properly secured?
2. Can user input influence external API URLs?
3. Are external API errors handled gracefully?
4. Is there cost monitoring for Claude API and Document AI usage?
5. Are SendGrid emails free of PHI content?
