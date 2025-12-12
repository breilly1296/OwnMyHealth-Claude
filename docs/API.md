# OwnMyHealth API Documentation

Base URL: `http://localhost:3001/api/v1`

## Authentication

All endpoints except `/auth/login`, `/auth/register`, and `/auth/demo` require authentication via httpOnly cookies.

### Headers

```
Cookie: accessToken=<jwt>; refreshToken=<jwt>
Content-Type: application/json
```

---

## Auth Endpoints

### POST /auth/register
Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "PATIENT"
    }
  }
}
```

### POST /auth/login
Authenticate user and receive tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "PATIENT"
    }
  }
}
```
*Note: Tokens are set in httpOnly cookies*

### POST /auth/logout
Logout current session.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

### POST /auth/logout-all
Logout from all devices.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Logged out from all devices"
  }
}
```

### GET /auth/me
Get current user information.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "PATIENT",
    "firstName": "John",
    "lastName": "Doe",
    "emailVerified": true
  }
}
```

### POST /auth/refresh
Refresh access token using refresh token.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Token refreshed"
  }
}
```

### POST /auth/demo
Login with demo account.

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "demo@ownmyhealth.com",
      "role": "PATIENT"
    }
  }
}
```

### POST /auth/change-password
Change user password.

**Request Body:**
```json
{
  "currentPassword": "oldPassword123",
  "newPassword": "newSecurePassword456"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Password changed successfully"
  }
}
```

---

## Biomarker Endpoints

### GET /biomarkers
List user's biomarkers with pagination.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | number | 1 | Page number |
| limit | number | 20 | Items per page |
| category | string | - | Filter by category |
| isOutOfRange | boolean | - | Filter out-of-range only |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Glucose",
      "value": 95,
      "unit": "mg/dL",
      "normalRange": {
        "min": 70,
        "max": 100
      },
      "category": "Metabolic",
      "date": "2024-01-15T10:30:00Z",
      "isOutOfRange": false,
      "sourceType": "LAB_UPLOAD"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

### GET /biomarkers/summary
Get biomarker summary statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 45,
    "inRange": 40,
    "outOfRange": 5,
    "categories": ["Metabolic", "Lipids", "Blood"],
    "latestDate": "2024-01-15T10:30:00Z"
  }
}
```

### GET /biomarkers/categories
Get available biomarker categories.

**Response:**
```json
{
  "success": true,
  "data": ["Metabolic", "Lipids", "Blood", "Kidney", "Liver", "Thyroid"]
}
```

### GET /biomarkers/:id
Get single biomarker by ID.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Glucose",
    "value": 95,
    "unit": "mg/dL",
    "normalRange": {
      "min": 70,
      "max": 100
    },
    "category": "Metabolic",
    "date": "2024-01-15T10:30:00Z",
    "isOutOfRange": false,
    "notes": "Fasting sample"
  }
}
```

### GET /biomarkers/:id/history
Get historical values for a biomarker.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "value": 95,
      "date": "2024-01-15T10:30:00Z"
    },
    {
      "value": 102,
      "date": "2023-10-15T10:30:00Z"
    }
  ]
}
```

### POST /biomarkers
Create a new biomarker.

**Request Body:**
```json
{
  "name": "Glucose",
  "value": 95,
  "unit": "mg/dL",
  "category": "Metabolic",
  "normalRange": {
    "min": 70,
    "max": 100
  },
  "date": "2024-01-15T10:30:00Z",
  "notes": "Fasting sample"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Glucose",
    "value": 95,
    ...
  }
}
```

### POST /biomarkers/batch
Create multiple biomarkers at once.

**Request Body:**
```json
{
  "biomarkers": [
    {
      "name": "Glucose",
      "value": 95,
      "unit": "mg/dL",
      "category": "Metabolic",
      "normalRange": { "min": 70, "max": 100 },
      "date": "2024-01-15T10:30:00Z"
    },
    {
      "name": "Cholesterol",
      "value": 185,
      "unit": "mg/dL",
      "category": "Lipids",
      "normalRange": { "min": 0, "max": 200 },
      "date": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "created": 2,
    "failed": 0,
    "biomarkers": [...]
  }
}
```

### PATCH /biomarkers/:id
Update a biomarker.

**Request Body:**
```json
{
  "value": 98,
  "notes": "Updated value"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Glucose",
    "value": 98,
    ...
  }
}
```

### DELETE /biomarkers/:id
Delete a biomarker.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Biomarker deleted"
  }
}
```

---

## Insurance Endpoints

### GET /insurance/plans
List user's insurance plans.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "planName": "Blue Cross PPO",
      "planType": "PPO",
      "insurerName": "Blue Cross Blue Shield",
      "premium": 450,
      "deductible": 1500,
      "outOfPocketMax": 6000,
      "isPrimary": true,
      "startDate": "2024-01-01",
      "endDate": "2024-12-31"
    }
  ]
}
```

### GET /insurance/plans/:id
Get single insurance plan.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "planName": "Blue Cross PPO",
    "planType": "PPO",
    "benefits": [
      {
        "serviceType": "Primary Care Visit",
        "inNetworkCost": "20% coinsurance",
        "outOfNetworkCost": "40% coinsurance",
        "limitations": "None",
        "priorAuthRequired": false
      }
    ]
  }
}
```

### POST /insurance/plans
Create an insurance plan.

**Request Body:**
```json
{
  "planName": "Blue Cross PPO",
  "planType": "PPO",
  "insurerName": "Blue Cross Blue Shield",
  "premium": 450,
  "deductible": 1500,
  "outOfPocketMax": 6000,
  "isPrimary": true,
  "startDate": "2024-01-01",
  "endDate": "2024-12-31"
}
```

### PATCH /insurance/plans/:id
Update an insurance plan.

### DELETE /insurance/plans/:id
Delete an insurance plan.

### POST /insurance/compare
Compare multiple insurance plans.

**Request Body:**
```json
{
  "planIds": ["uuid1", "uuid2"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "plans": [...],
    "comparison": {
      "premiumDiff": 50,
      "deductibleDiff": 500,
      "recommendation": "Plan 1 offers better value for primary care"
    }
  }
}
```

### GET /insurance/benefits/search
Search benefits across plans.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| serviceType | string | Service type to search |
| planId | string | Specific plan to search |

---

## DNA Endpoints

### GET /dna
List user's DNA data files.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fileName": "23andme_raw.txt",
      "source": "23andMe",
      "uploadDate": "2024-01-10T15:00:00Z",
      "status": "COMPLETED",
      "variantCount": 650000
    }
  ]
}
```

### POST /dna/upload
Upload a DNA file.

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| file | File | DNA data file (.txt, .csv) |
| source | string | Source (23andMe, AncestryDNA, etc.) |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "PROCESSING",
    "message": "DNA file uploaded and being processed"
  }
}
```

### GET /dna/:id
Get DNA data details.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "fileName": "23andme_raw.txt",
    "source": "23andMe",
    "status": "COMPLETED",
    "variantCount": 650000,
    "processedAt": "2024-01-10T15:05:00Z"
  }
}
```

### GET /dna/:id/traits
Get genetic traits from DNA data.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "traitName": "Caffeine Metabolism",
      "riskLevel": "MODERATE",
      "genotype": "AC",
      "description": "You may metabolize caffeine slower than average",
      "recommendations": [
        "Consider limiting caffeine after noon"
      ]
    }
  ]
}
```

---

## Health Endpoints

### GET /health
Get health analysis overview.

**Response:**
```json
{
  "success": true,
  "data": {
    "overallHealthScore": 85,
    "riskAssessments": [
      {
        "biomarkerId": "uuid",
        "biomarkerName": "LDL Cholesterol",
        "riskLevel": "moderate",
        "riskScore": 45,
        "riskFactors": ["Elevated LDL"],
        "recommendations": ["Consider dietary changes"]
      }
    ],
    "trendAnalyses": [...],
    "priorityActions": ["Schedule lipid panel follow-up"]
  }
}
```

### POST /health/analyze
Run health analysis on biomarkers.

**Response:**
```json
{
  "success": true,
  "data": {
    "analysisId": "uuid",
    "timestamp": "2024-01-15T10:30:00Z",
    "results": {...}
  }
}
```

---

## Health Goals Endpoints

### GET /health-goals
List user's health goals.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Lower LDL Cholesterol",
      "description": "Reduce LDL to below 100 mg/dL",
      "targetValue": 100,
      "currentValue": 125,
      "unit": "mg/dL",
      "status": "ACTIVE",
      "deadline": "2024-06-01",
      "progress": 60
    }
  ]
}
```

### POST /health-goals
Create a health goal.

**Request Body:**
```json
{
  "title": "Lower LDL Cholesterol",
  "description": "Reduce LDL to below 100 mg/dL",
  "targetValue": 100,
  "currentValue": 125,
  "unit": "mg/dL",
  "deadline": "2024-06-01"
}
```

### GET /health-goals/:id
Get single health goal.

### PATCH /health-goals/:id
Update a health goal.

### DELETE /health-goals/:id
Delete a health goal.

### POST /health-goals/:id/progress
Record goal progress.

**Request Body:**
```json
{
  "value": 118,
  "notes": "Diet changes showing results"
}
```

---

## Health Needs Endpoints

### GET /health-needs
List user's health needs.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Cholesterol Management",
      "description": "LDL cholesterol is elevated",
      "needType": "CONDITION",
      "urgency": "follow-up",
      "status": "pending",
      "relatedBiomarkers": ["LDL Cholesterol"]
    }
  ]
}
```

### POST /health-needs
Create a health need.

### GET /health-needs/:id
Get single health need.

### PATCH /health-needs/:id
Update a health need.

### DELETE /health-needs/:id
Delete a health need.

---

## Upload Endpoints

### POST /upload/pdf
Upload a clinical PDF for biomarker extraction.

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| file | File | PDF lab report |

**Response:**
```json
{
  "success": true,
  "data": {
    "extractedBiomarkers": [
      {
        "name": "Glucose",
        "value": 95,
        "unit": "mg/dL",
        "confidence": 0.95
      }
    ],
    "documentType": "Lab Report",
    "confidence": 0.92
  }
}
```

### POST /upload/sbc
Upload an insurance SBC document.

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| file | File | SBC PDF document |

**Response:**
```json
{
  "success": true,
  "data": {
    "planName": "Blue Cross PPO",
    "deductible": 1500,
    "outOfPocketMax": 6000,
    "benefits": [...],
    "confidence": 0.88
  }
}
```

---

## Provider Endpoints (PROVIDER/ADMIN only)

### GET /provider/patients
List connected patients.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "patientId": "uuid",
      "email": "patient@example.com",
      "consentedAt": "2024-01-01T00:00:00Z",
      "permissions": {
        "viewBiomarkers": true,
        "viewDNA": false,
        "viewInsurance": false
      }
    }
  ]
}
```

### GET /provider/patients/:id
Get patient's health data (with consent).

---

## Admin Endpoints (ADMIN only)

### GET /admin/users
List all users with pagination.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | number | 1 | Page number |
| limit | number | 20 | Items per page |
| role | string | - | Filter by role |

### GET /admin/audit-logs
View audit logs.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| userId | string | Filter by user |
| action | string | Filter by action type |
| startDate | string | Start date (ISO) |
| endDate | string | End date (ISO) |

---

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

### 403 Forbidden
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions"
  }
}
```

### 404 Not Found
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

### 429 Too Many Requests
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT",
    "message": "Too many requests. Please try again later."
  }
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

---

## Rate Limits

| Endpoint Type | Limit |
|---------------|-------|
| Authentication | 5 requests/minute |
| Standard API | 100 requests/15 minutes |
| File Upload | 10 requests/minute |

---

## Pagination

All list endpoints support pagination:

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

**Response includes:**
```json
{
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```
