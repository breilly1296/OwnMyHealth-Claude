# OwnMyHealth Security Review Scope

**Prepared for:** External Security Reviewer
**Date:** December 2024
**Codebase:** HIPAA-compliant health data platform

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total security-critical code | ~3,500 lines across 12 files |
| Estimated review time | 8-12 hours (including findings discussion) |
| Overall complexity | Moderate to High |
| Tech stack | Node.js + Express + Prisma + PostgreSQL |

This is a privacy-first osteoporosis management platform handling Protected Health Information (PHI). The security architecture includes JWT authentication, AES-256-GCM encryption for all PHI, role-based access control, and HIPAA-compliant audit logging.

---

## 1. Authentication System

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/src/services/authService.ts` | 1,029 | High |
| `backend/src/middleware/auth.ts` | 148 | Simple |
| `backend/src/controllers/authController.ts` | ~300 | Moderate |

### Implementation Summary

- JWT-based auth with access tokens (15 min) + refresh tokens (7 days)
- Tokens stored in httpOnly cookies (not localStorage)
- Bcrypt password hashing (12 rounds configurable)
- Account lockout after 5 failed attempts (30 min lockout)
- Email verification flow with 24-hour expiring tokens
- Password reset with 1-hour tokens
- Session management with database persistence

### Key Code Sections to Review

```
authService.ts:537-666  - Login flow with lockout logic
authService.ts:590-606  - Timing attack mitigation
authService.ts:202-238  - Refresh token generation and storage
authService.ts:906-907  - Token revocation on password reset
```

### Potential Concerns

1. **In-memory token blacklist** (line 114) - Uses a Set, won't work across multiple server instances. Comment acknowledges this.

2. **Demo account bypass** (lines 543-580) - Demo mode bypasses lockout, email verification, and other security controls. Need to verify this cannot be enabled in production.

3. **JWT secret defaults** - Config has insecure defaults like `'access-secret-change-in-production'`. Production validation exists but should verify it runs.

---

## 2. Encryption (PHI Protection)

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/src/services/encryption.ts` | 401 | High |
| `backend/src/services/userEncryption.ts` | 150 | Moderate |

### Implementation Summary

- AES-256-GCM for all PHI fields (authenticated encryption)
- Per-user key derivation using PBKDF2-SHA512 (100,000 iterations)
- Architecture: Master key → per-user salt → derived key
- User salts encrypted with master key before database storage
- Key rotation support with re-encryption capability
- Format: `iv:authTag:ciphertext` (all base64 encoded)

### PHI Fields Protected

- User: name, DOB, phone, address
- Biomarker: values, notes
- Insurance: member ID, group ID
- DNA: genotype data, recommendations
- Health Needs: descriptions, action plans

### Key Code Sections to Review

```
encryption.ts:167-175   - PBKDF2 key derivation parameters
encryption.ts:237-253   - Core encrypt function
encryption.ts:262-283   - Core decrypt function
encryption.ts:189-202   - Master key encryption (for user salts)
userEncryption.ts:72-129 - Key rotation implementation
```

### Potential Concerns

1. **Key storage** - Master key from env var `PHI_ENCRYPTION_KEY`. Verify it's never logged or exposed in errors.

2. **No key escrow** - If master key is lost, all data is unrecoverable. Verify operational procedures exist.

3. **PBKDF2 vs Argon2** - PBKDF2 is NIST-approved but Argon2id is considered stronger against modern GPU attacks.

4. **Decryption fallback** (lines 329-332) - Silently keeps original value if decryption fails. Could mask data corruption issues.

---

## 3. Access Control (RBAC)

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/src/middleware/rbac.ts` | 379 | High |
| `backend/src/middleware/demoProtection.ts` | ~50 | Simple |

### Implementation Summary

- Three-tier role hierarchy: PATIENT < PROVIDER < ADMIN
- Resource-level permission matrix (read/write/delete/admin per resource)
- Provider-patient relationships with granular consent controls
- Consent expiration checking
- User scope enforcement (patients see only their own data)

### Permission Matrix

```
PATIENT:  Own data only (read/write/delete)
PROVIDER: Own data + consented patient data (per-permission basis)
ADMIN:    Full access to all resources
```

### Key Code Sections to Review

```
rbac.ts:31-56     - Permission matrix definition
rbac.ts:124-171   - requireResourceAccess() middleware
rbac.ts:195-245   - Provider-patient access check with consent validation
rbac.ts:251-303   - Ownership verification
```

### Potential Concerns

1. **Admin bypass** - Admins bypass all ownership checks (lines 139-142, 259-261). Consider if this is appropriate for HIPAA minimum necessary standard.

2. **Target user extraction** (lines 176-190) - Checks params, query, AND body for userId. Could be confused by conflicting values in different locations.

3. **No access caching** - Each request queries database for relationship status. Could impact performance under load.

4. **Consent expiration** - Checked at access time but relationships aren't auto-revoked. Expired consents remain in DB as data.

---

## 4. CSRF Protection

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/src/middleware/csrf.ts` | 176 | Moderate |

### Implementation Summary

- Double-submit cookie pattern
- 32-byte cryptographically random tokens
- Timing-safe comparison (crypto.timingSafeEqual)
- 24-hour token expiration
- Exemptions for public auth routes (login, register, password reset)

### Key Code Sections to Review

```
csrf.ts:72-133  - Token validation logic
csrf.ts:84-98   - Exempted routes list
csrf.ts:118-126 - Timing-safe comparison
```

### Potential Concerns

1. **DISABLE_CSRF env var** (lines 105-107) - Can disable CSRF in development. Verify this path is unreachable in production.

2. **Cookie not httpOnly** (line 36) - Intentional since JavaScript must read it, but worth noting for threat model.

3. **Route exemption logic** (line 96-98) - Uses `endsWith()` for path matching. Could potentially be bypassed with path manipulation.

---

## 5. Audit Logging (HIPAA Compliance)

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/src/services/auditLog.ts` | 518 | High |

### Implementation Summary

- Logs all PHI access, creation, modification, deletion
- Previous/new values encrypted before storage using system salt
- 7-year retention (2,555 days) per HIPAA requirements
- Captures: user ID, IP address, user agent, session ID
- Daily automated cleanup of expired logs
- Immutable design (no update/delete of recent logs)

### Logged Events

- Authentication: LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGE, PASSWORD_RESET
- Data access: READ, VIEW, EXPORT, PRINT
- Data modification: CREATE, UPDATE, DELETE
- PHI specific: PHI_ACCESS, PHI_EXPORT, PHI_DECRYPT
- Administrative: PERMISSION_CHANGE, SETTINGS_CHANGE, KEY_ROTATION

### Key Code Sections to Review

```
auditLog.ts:104-135  - Initialization and system salt management
auditLog.ts:163-174  - Value encryption before logging
auditLog.ts:179-210  - Core logging function with error handling
auditLog.ts:444-461  - Retention cleanup logic
```

### Potential Concerns

1. **Retention period** - Set to 7 years (2,555 days). HIPAA minimum is 6 years. Consider if 7 years provides enough margin for compliance.

2. **Failure handling** (lines 196-209) - Logs errors but doesn't throw exceptions. Failed audit logging could go unnoticed in production.

3. **System salt storage** - Stored in `SystemConfig` table unencrypted (line 119). Consider if this is acceptable for your threat model.

4. **No tamper detection** - Audit logs can be modified if database is compromised. No cryptographic chaining or signing.

---

## 6. Secrets & Configuration

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/src/config/index.ts` | 195 | Moderate |

### Implementation Summary

- Production-mode validation for all critical secrets
- Minimum length enforcement: 32 chars for JWT secrets, 64 hex chars for PHI encryption key
- Blocks known placeholder/insecure keys (all zeros, sequential hex, etc.)
- CORS origin validation (rejects localhost in production)
- Fails fast on missing critical env vars

### Required Environment Variables (Production)

```
JWT_ACCESS_SECRET     - Min 32 characters
JWT_REFRESH_SECRET    - Min 32 characters
DATABASE_URL          - PostgreSQL connection string
PHI_ENCRYPTION_KEY    - 64 hex characters (256 bits)
CORS_ORIGIN           - No localhost allowed
```

### Key Code Sections to Review

```
config/index.ts:100-194  - Production validation block
config/index.ts:163-174  - Insecure key detection
```

### Potential Concerns

1. **Hardcoded defaults** (lines 16, 20, 24) - Development mode has insecure default secrets. Verify NODE_ENV cannot be manipulated to bypass production validation.

2. **Demo credentials** (lines 77-80) - Demo email/password come from env vars. Verify these aren't weak or default in staging environments.

3. **Secret logging** - Verify PHI_ENCRYPTION_KEY and other secrets are never logged in error messages or stack traces.

---

## 7. Rate Limiting

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/src/middleware/rateLimiter.ts` | 90 | Simple |

### Implementation Summary

| Limiter | Limit | Window |
|---------|-------|--------|
| Standard | 100 requests | 15 minutes |
| Auth (registration) | 20 attempts | 15 minutes |
| Login (strict) | 5 attempts | 15 minutes |
| Upload | 20 uploads | 1 hour |
| Sensitive operations | 10 requests | 1 hour |

### Key Code Sections to Review

```
rateLimiter.ts:40-59  - Strict login limiter with email+IP key
rateLimiter.ts:18-21  - IP extraction logic
```

### Potential Concerns

1. **In-memory storage** - Uses default express-rate-limit memory store. Won't work correctly across multiple server instances (horizontal scaling).

2. **IP spoofing** - Uses `req.ip` with trust proxy enabled. Verify X-Forwarded-For header cannot be spoofed by clients.

3. **No distributed state** - Rate limit state is not shared. An attacker could rotate between servers.

---

## 8. Input Validation

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/src/middleware/validation.ts` | 528 | Moderate |

### Implementation Summary

- Zod schema validation for all endpoints
- HTML character escaping for XSS prevention (`&`, `<`, `>`, `"`, `'`)
- Password strength: 12+ characters, uppercase, lowercase, number, special character
- Email normalization (lowercase, trim)
- UUID format validation for all IDs
- String length limits on all fields

### Key Code Sections to Review

```
validation.ts:40-48   - HTML sanitization function
validation.ts:99-106  - Password validation regex
validation.ts:130-161 - Generic validation middleware
```

### Potential Concerns

1. **HTML escaping only** - No SQL injection protection in validation layer. Relies entirely on Prisma's parameterized queries. Verify Prisma is used correctly everywhere.

2. **Password validation inconsistency** - Schema requires 8 chars (line 100) but authService requires 12. Which is enforced?

3. **Regex complexity** - Password regex (line 105) could be vulnerable to ReDoS with very long inputs. Consider adding max length check before regex.

---

## 9. Database Schema

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/prisma/schema.prisma` | 666 | Moderate |

### Security Features

- All PHI fields have `*Encrypted` suffix indicating application-layer encryption
- Session table with expiration tracking and cascade delete
- User encryption keys table with versioning for key rotation
- Audit log table with encrypted previous/new values
- Cascade deletes on user deletion (data cleanup)
- Indexes on security-relevant fields (email, tokens, expiration dates)

### Key Tables for Security Review

```
User              - Auth fields, lockout tracking, encrypted PHI
Session           - Token storage, expiration, IP/user agent
UserEncryptionKey - Per-user encryption salt management
AuditLog          - HIPAA compliance logging
ProviderPatient   - Consent and permission management
```

### Potential Concerns

1. **No Row-Level Security** - Schema comment mentions RLS but implementation isn't visible. All access control is application-level only.

2. **Email not encrypted** - User email stored in plaintext. Under HIPAA, email could be considered PHI if it reveals health information.

3. **Reset tokens in user table** - Password reset and email verification tokens stored directly in user table. If database is compromised, these are exposed.

4. **No field-level encryption for session data** - IP address and user agent stored in plaintext in sessions table.

---

## 10. Frontend Security

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `src/services/api.ts` | 1,482 | Moderate |

### Implementation Summary

- In-memory token storage (NOT localStorage/sessionStorage)
- Automatic token refresh with request queuing
- Credentials included for cookie-based auth
- Request timeout handling (30 seconds default)
- Generic error messages (no sensitive data leakage to UI)
- Auth failure callback for session expiration handling

### Key Code Sections to Review

```
api.ts:86-103    - Token storage in memory
api.ts:118-157   - Token refresh logic
api.ts:162-274   - Main fetch wrapper with retry logic
```

### Potential Concerns

1. **Token in memory only** - Good for security, but user loses auth state on page refresh. Relies entirely on httpOnly cookies for session persistence.

2. **API base URL from env** - `VITE_API_URL` could potentially be manipulated in development builds.

3. **No CSRF token sending** - Relies on cookie-based CSRF. Verify the frontend actually sends the X-CSRF-Token header on state-changing requests.

---

## 11. Application Wiring

### Files & Metrics

| File | Lines | Complexity |
|------|-------|------------|
| `backend/src/app.ts` | 235 | Moderate |

### Middleware Stack (Order Matters)

1. Helmet - Security HTTP headers
2. CORS - Cross-origin configuration
3. Cookie Parser - Cookie handling
4. CSRF Protection - Token validation
5. Rate Limiting - Abuse prevention
6. Morgan - Request logging
7. Body Parser - JSON parsing (10MB limit)
8. Routes - API handlers
9. Error Handler - Centralized error handling

### Key Code Sections to Review

```
app.ts:58-75   - CORS origin validation for production
app.ts:84-94   - Helmet security headers configuration
app.ts:109-111 - CSRF bypass condition
```

### Potential Concerns

1. **CSRF disable check** (line 109) - Can be disabled via env var in development. Verify this check is airtight for production.

2. **Body size limit** - 10MB limit (line 124-125). Consider if this is appropriate or could enable DoS.

3. **Trust proxy** (line 81) - Set to `1`. Verify this is appropriate for your deployment topology.

---

## Review Time Estimate

| Activity | Time |
|----------|------|
| Read and understand codebase | 4-5 hours |
| Detailed security analysis | 3-4 hours |
| Document findings | 1-2 hours |
| Discussion call | 1 hour |
| **Total** | **9-12 hours** |

---

## Recommended Review Priority

### Priority 1 - Critical (Must Review)

1. **Encryption implementation** (`encryption.ts`) - Core PHI protection
2. **JWT handling and refresh flow** (`authService.ts`) - Authentication foundation
3. **Access control bypass potential** (`rbac.ts`) - Data isolation between users

### Priority 2 - High

4. **Audit logging completeness** - HIPAA compliance requirement
5. **Production configuration validation** - Ensures secure deployment
6. **Demo mode isolation** - Potential attack surface

### Priority 3 - Medium

7. **Rate limiting effectiveness** - DoS protection
8. **CSRF implementation** - Session protection
9. **Input validation coverage** - Injection prevention

---

## Summary Assessment

### Strengths

- Well-structured, well-documented code with clear separation of concerns
- Standard, proven cryptographic choices (AES-256-GCM, bcrypt, PBKDF2)
- Thoughtful security layering (auth → RBAC → encryption → audit)
- Production-specific validation that fails fast on misconfiguration
- Comprehensive audit logging for HIPAA compliance

### Areas Needing Attention

- Some inconsistencies between validation schemas (password length)
- In-memory solutions (rate limiting, token blacklist) won't scale horizontally
- Demo mode is a potential attack surface if misconfigured for production
- Application-level access control only (no database RLS as defense in depth)
- No cryptographic protection for audit log integrity

### Not In Scope (But Worth Mentioning)

- Infrastructure security (AWS configuration, network policies)
- Dependency vulnerabilities (run `npm audit`)
- Penetration testing (this is code review only)
- Operational security (key management procedures, incident response)

---

## Questions for Pre-Review Discussion

1. Is horizontal scaling planned? (affects rate limiting and token blacklist design)
2. What's the key management procedure for PHI_ENCRYPTION_KEY?
3. Is Row-Level Security planned for the database?
4. What environments can have demo mode enabled?
5. Are there any compliance certifications being pursued beyond HIPAA?

---

*Document generated from codebase analysis. File paths are relative to repository root.*
