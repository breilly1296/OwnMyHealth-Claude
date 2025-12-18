---
tags: [security, external-api, review]
type: prompt
priority: 3
---

# CMS Marketplace API Integration Review

## Files to Review
- `backend/src/services/cmsMarketplaceService.ts`
- `backend/src/routes/marketplaceRoutes.ts`
- `backend/src/controllers/marketplaceController.ts` (if exists)
- `backend/src/config/index.ts` (CMS configuration)

## OwnMyHealth CMS Integration

- **API**: Healthcare.gov Marketplace API
- **Purpose**: Insurance plan search, county lookup, provider network checks
- **Auth**: API key passed as query parameter
- **Singleton**: `getCMSMarketplaceService()`

## Checklist

### 1. API Key Security
- [ ] API key loaded from `CMS_API_KEY` environment variable
- [ ] Key NOT logged or exposed in responses
- [ ] Key NOT committed to version control
- [ ] Missing key warning in dev, error in production (if required)
- [ ] Key passed as query param (per CMS API requirements)

### 2. Request Security
- [ ] HTTPS enforced (`https://marketplace.api.healthcare.gov`)
- [ ] Request timeout configured (default 30s)
- [ ] AbortController for request cancellation
- [ ] No sensitive user data sent to CMS

### 3. Input Validation
Before calling CMS API:
- [ ] ZIP code format validated (5 digits)
- [ ] FIPS code validated
- [ ] State codes validated (2 letters)
- [ ] Age validated (reasonable range)
- [ ] Income validated (positive number)

### 4. Response Handling
- [ ] Error responses logged (without sensitive data)
- [ ] HTTP errors converted to `ExternalServiceError`
- [ ] Timeout errors handled gracefully
- [ ] Malformed responses handled

### 5. Data Transformation
`transformPlan()` and related functions:
- [ ] CMS response transformed to frontend-friendly format
- [ ] Deductibles extracted from array (`plan.deductibles?.[0]?.amount`)
- [ ] Out-of-pocket max extracted from array (`plan.moops?.[0]?.amount`)
- [ ] Null/undefined values handled with defaults

### 6. Available Endpoints

**County Lookup**:
- [ ] `getCountyByZipcode(zipcode)` - returns first county
- [ ] `getCountiesByZipcode(zipcode)` - returns all counties (ZIP spans multiple)

**Plan Search**:
- [ ] `searchPlans(params)` - POST request with household info
- [ ] `getPlanDetails(planId, year)` - specific plan info

**Premium Estimation**:
- [ ] `estimatePremium(params)` - APTC calculation

**Provider/Drug Lookup**:
- [ ] `checkProviderNetwork(planId, providerId)`
- [ ] `checkDrugCoverage(planId, rxcui)`

### 7. Route Security
In `marketplaceRoutes.ts`:
- [ ] Plan search is public (no auth required for quote)
- [ ] Rate limiting applied
- [ ] Input validation before CMS call
- [ ] No user PHI sent to CMS

### 8. Error Messages
- [ ] CMS errors don't expose API key
- [ ] User-friendly messages for CMS unavailability
- [ ] Timeout message: "CMS API request timed out"

### 9. Configuration
In `backend/src/config/index.ts`:
```typescript
cms: {
  enabled: !!process.env.CMS_API_KEY,
  apiKey: process.env.CMS_API_KEY,
  baseUrl: process.env.CMS_BASE_URL || 'https://marketplace.api.healthcare.gov/api/v1',
  timeout: parseInt(process.env.CMS_TIMEOUT || '30000', 10),
}
```
- [ ] `CMS_API_KEY` - API key
- [ ] `CMS_BASE_URL` - optional override
- [ ] `CMS_TIMEOUT` - request timeout (default 30s)

### 10. Caching Considerations
- [ ] County data could be cached (rarely changes)
- [ ] Plan data changes annually (cache with year)
- [ ] No caching of user-specific calculations

## Privacy Concerns

Data sent to CMS API:
- ZIP code (geographic, not PHI)
- Age (de-identified)
- Income (de-identified)
- Tobacco use (de-identified)
- Household size (de-identified)

**NOT sent to CMS:**
- [ ] User names
- [ ] Email addresses
- [ ] User IDs
- [ ] Existing health conditions
- [ ] Existing insurance info

## Red Flags
- API key hardcoded or logged
- HTTP instead of HTTPS
- No request timeout (DoS risk)
- User PHI sent to external API
- CMS errors exposed verbatim to users
- No validation before external call
