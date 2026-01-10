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
- `backend/src/services/cmsMarketplaceService.ts` (CMS API)
- `backend/src/services/claudeExtraction.ts` (Anthropic API)
- `backend/src/services/sbcExtraction.ts` (SBC parsing)
- Any file with `fetch()` or `axios` calls to external services

## OwnMyHealth External Integrations
- **Anthropic Claude API**: PDF extraction, AI guidance
- **CMS Marketplace API**: Insurance plan data
- **Google Cloud APIs**: Storage, Document AI (deprecated)

## Checklist

### 1. API Key Security
- [ ] Keys loaded from environment variables
- [ ] Keys not hardcoded in source code
- [ ] Keys not logged in any circumstance
- [ ] Keys redacted in error messages

### 2. SSRF Prevention
- [ ] User input not directly used in URLs
- [ ] URL parameters validated (allowlist)
- [ ] No arbitrary URL fetching based on user input
- [ ] Path traversal prevented in API paths

### 3. CMS API Specific
- [ ] `validatePathParam()` - alphanumeric only
- [ ] `validateZipcode()` - 5 or 9 digit format
- [ ] `validateState()` - 2 uppercase letters
- [ ] `validateYear()` - reasonable range (2014 to current+2)
- [ ] API key redacted with `redactApiKeyFromUrl()`

### 4. Anthropic API Specific
- [ ] API key from `ANTHROPIC_API_KEY` secret
- [ ] Lazy initialization (not at module load)
- [ ] Error handling for API failures
- [ ] Cost tracking/limits in place
- [ ] No PHI logged in prompts/responses

### 5. Error Handling
- [ ] External API errors don't crash server
- [ ] Timeouts configured on all external calls
- [ ] Retry logic with exponential backoff
- [ ] Fallback behavior when API unavailable

### 6. Response Validation
- [ ] External API responses validated before use
- [ ] JSON parsing errors handled gracefully
- [ ] Unexpected response shapes don't cause crashes

### 7. Secrets in URLs
- [ ] API keys in query strings are logged safely
- [ ] URLs in error messages have keys redacted
- [ ] No secrets in referrer headers

## External API Inventory
```bash
# Find all external API calls
grep -r "fetch\|axios\|http\." backend/src/services/ | grep -v "node_modules"
```

## Questions to Ask
1. Are all API keys properly secured?
2. Can user input influence external API URLs?
3. Are external API errors handled gracefully?
