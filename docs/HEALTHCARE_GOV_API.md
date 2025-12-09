# Healthcare.gov Marketplace API Integration

OwnMyHealth integrates with the CMS Healthcare.gov Marketplace API to help users search and compare ACA health insurance plans.

## Features

- **Plan Search**: Find ACA marketplace plans by zipcode, household, and preferences
- **Plan Details**: Get detailed information about specific plans
- **Plan Comparison**: Compare multiple plans side-by-side
- **County Lookup**: Find FIPS codes for zipcodes

## Setup Instructions

### 1. Request an API Key

1. Go to https://developer.cms.gov/marketplace-api/key-request.html
2. Fill out the request form:
   - Organization: Your company name
   - Application: OwnMyHealth
   - Use Case: Help consumers find and compare health insurance plans
3. Wait for approval (usually 1-3 business days)
4. You'll receive an API key via email

### 2. Configure the Backend

SSH to your server:

```bash
ssh root@165.227.76.212

# Edit backend .env
nano /var/www/app/backend/.env

# Add:
HEALTHCARE_GOV_API_KEY=your-api-key-here

# Restart backend
pm2 restart ownmyhealth-backend
```

### 3. Verify Setup

```bash
# Check API status
curl https://ownmyhealth.io/api/v1/marketplace/status

# Should return:
# {"success":true,"data":{"configured":true,"message":"Healthcare.gov API is configured and ready"}}
```

## API Endpoints

### Check Status
```
GET /api/v1/marketplace/status
```

### Get Counties by Zipcode
```
GET /api/v1/marketplace/counties/:zipcode
```

Example:
```bash
curl https://ownmyhealth.io/api/v1/marketplace/counties/33139
```

### Search Plans
```
POST /api/v1/marketplace/plans/search
Content-Type: application/json

{
  "zipcode": "33139",
  "household": {
    "income": 50000,
    "people": [
      { "age": 35 }
    ]
  },
  "filter": {
    "metal_levels": ["Silver", "Gold"],
    "plan_types": ["PPO"]
  }
}
```

### Get Plan Details
```
GET /api/v1/marketplace/plans/:planId
```

### Compare Plans
```
POST /api/v1/marketplace/plans/compare
Content-Type: application/json

{
  "planIds": ["plan-id-1", "plan-id-2", "plan-id-3"]
}
```

## Request/Response Examples

### Plan Search Response
```json
{
  "success": true,
  "data": {
    "plans": [
      {
        "id": "12345AB1234567",
        "name": "Blue Cross Silver PPO",
        "issuer": {
          "id": "12345",
          "name": "Blue Cross Blue Shield"
        },
        "metal_level": "Silver",
        "plan_type": "PPO",
        "premium": 450.00,
        "premium_w_credit": 150.00,
        "deductibles": {
          "individual": 2500,
          "family": 5000
        },
        "moops": {
          "individual": 7500,
          "family": 15000
        },
        "quality_rating": {
          "global_rating": 4.0
        }
      }
    ],
    "total": 25
  }
}
```

### Plan Comparison Response
```json
{
  "success": true,
  "data": {
    "plans": [...],
    "summary": {
      "cheapest_premium": { "id": "...", "premium": 350 },
      "lowest_deductible": { "id": "...", "deductibles": { "individual": 1500 } },
      "highest_quality": { "id": "...", "quality_rating": { "global_rating": 4.5 } }
    },
    "metrics": [
      {
        "plan_id": "...",
        "plan_name": "...",
        "annual_premium": 5400,
        "deductible": 2500,
        "estimated_low_use": 5400,
        "estimated_high_use": 7900,
        "estimated_worst_case": 14400
      }
    ]
  }
}
```

## Rate Limits

- The API has rate limits (typically 1000 requests/hour)
- Rate limit info is in response headers
- The service logs warnings when approaching limits

## Data Coverage

- Plans from Healthcare.gov marketplace states
- Current year and next year (during open enrollment)
- Includes all metal levels: Catastrophic, Bronze, Silver, Gold, Platinum
- Includes all plan types: HMO, PPO, EPO, POS

## Frontend Integration

The API can be called from the frontend Insurance Hub to:
1. Allow users to search for new plans
2. Compare marketplace plans with their current coverage
3. Estimate costs based on their health needs

## Troubleshooting

### "API not configured"
- Check `HEALTHCARE_GOV_API_KEY` in .env
- Restart PM2: `pm2 restart ownmyhealth-backend`

### "No counties found"
- Zipcode may be invalid or not in a marketplace state
- Some zipcodes span multiple counties (user should select one)

### Rate limit errors
- Wait and retry
- Check `X-RateLimit-Remaining` header
- Consider caching county lookups

### Plan not found
- Plan ID may be for a different year
- Plan may have been discontinued
- Try specifying the `year` parameter

## Resources

- [CMS Developer Portal](https://developer.cms.gov/marketplace-api/)
- [API Specifications](https://developer.cms.gov/marketplace-api/api-spec)
- [Healthcare.gov for Developers](https://www.healthcare.gov/developers/)
