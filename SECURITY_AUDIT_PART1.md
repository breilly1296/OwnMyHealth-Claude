# OwnMyHealth Security Audit - Part 1 of 4
## Authentication, Encryption, PHI Leakage, Audit Logging, Validation, Authorization & Rate Limiting

**Audit Date:** December 10, 2025
**Auditor:** Claude Code Security Analysis
**Codebase:** OwnMyHealth HIPAA-targeted health platform
**Branch:** `claude/security-audit-health-01EgYVNErDBTJDRDYJ3PEroR`

---

## Executive Summary

This security audit examines the OwnMyHealth platform, a HIPAA-targeted health application handling Protected Health Information (PHI) including bone health biomarkers, lab reports, genetic data, and insurance information.

**Overall Assessment:** The codebase demonstrates **strong security fundamentals** with well-implemented encryption, authentication, and audit logging. However, several issues require attention before production deployment with real PHI.

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Authentication | 0 | 1 | 1 | 1 |
| Encryption | 0 | 0 | 1 | 1 |
| PHI Leakage | 0 | 0 | 0 | 0 |
| Audit Logging | 0 | 0 | 0 | 1 |
| Input Validation | 0 | 0 | 1 | 0 |
| Authorization | 0 | 0 | 0 | 0 |
| Rate Limiting | 0 | 0 | 1 | 0 |
| **TOTAL** | **0** | **1** | **4** | **3** |

---

## Findings

### [HIGH] Demo Account Security Risk

**File:** `backend/src/services/authService.ts`, lines 180-181, 544-581, 945
**Category:** Authentication

**Issue:**
The demo account has a hardcoded password (`Demo123!`) and bypasses critical security controls. While there's a `config.allowDemoAccount` flag, the inconsistent checks between `demoLogin` controller (checks `isProduction`) and `attemptLogin` service (checks `allowDemoAccount`) could lead to confusion.

**Evidence:**
```typescript
// authService.ts:945
const { user } = await createUser(DEMO_ACCOUNT_EMAIL, 'Demo123!', 'PATIENT');

// authService.ts:544-546 - Demo bypass in attemptLogin
const isDemoAccount = email.toLowerCase().trim() === DEMO_ACCOUNT_EMAIL;
if (isDemoAccount && config.allowDemoAccount) {
  // Bypasses email verification, lockout, and other security checks
```

```typescript
// authController.ts:520-521 - Uses different check
if (config.isProduction) {
  throw new BadRequestError('Demo login is not available in production');
}
```

**Risk:**
- If `ALLOW_DEMO_ACCOUNT=true` is accidentally set in production, attackers have known credentials
- Demo account bypasses email verification, account lockout, and failed login tracking
- Inconsistent checks could lead to misconfiguration

**Fix:**
1. Add explicit warning log when demo account is enabled in any environment
2. Consider generating random demo password at startup and displaying it only in logs
3. Unify the production/demo checks to use a single source of truth
4. Add CICD check to ensure `ALLOW_DEMO_ACCOUNT` is never set in production env files

**Effort:** 2-3 hours

---

### [MEDIUM] AES-GCM IV Length Non-Standard

**File:** `backend/src/services/encryption.ts`, line 56
**Category:** Encryption

**Issue:**
The encryption service uses a 16-byte (128-bit) IV for AES-256-GCM. While this works, NIST SP 800-38D specifically recommends 12-byte (96-bit) IVs for GCM mode for optimal security and performance.

**Evidence:**
```typescript
// encryption.ts:56
const IV_LENGTH = 16;
```

**Risk:**
- Using 16-byte IVs requires additional processing (GHASH) that could theoretically introduce subtle timing differences
- Not following NIST recommendations could be flagged in security audits
- No functional vulnerability, but deviates from best practice

**Fix:**
Change `IV_LENGTH` to 12:
```typescript
const IV_LENGTH = 12; // 96 bits - NIST recommended for GCM
```

**Note:** This would require a data migration for existing encrypted data, so consider implementing a versioned encryption scheme that supports both.

**Effort:** 1-2 hours (code change) + migration planning

---

### [MEDIUM] PDF File Validation Insufficient

**File:** `backend/src/routes/uploadRoutes.ts`, lines 23-37
**Category:** Input Validation

**Issue:**
File upload validation only checks the MIME type header, not the actual file contents. Attackers could upload malicious files with a spoofed `application/pdf` MIME type.

**Evidence:**
```typescript
fileFilter: (_req, file, cb) => {
  // Only accept PDF files
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are accepted'));
  }
},
```

**Risk:**
- Malicious files could be processed by pdf-parse library
- Potential for exploiting vulnerabilities in PDF parsing
- Could lead to denial of service or potentially RCE if parser has vulnerabilities

**Fix:**
Add magic byte validation before processing:
```typescript
// In uploadController.ts, before parsing
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
if (!file.buffer.slice(0, 4).equals(PDF_MAGIC)) {
  throw new ValidationError('Invalid PDF file - magic bytes mismatch');
}
```

**Effort:** 1 hour

---

### [MEDIUM] Rate Limiting Bypassed for Demo Account

**File:** `backend/src/middleware/rateLimiter.ts`, lines 46, 64
**Category:** Rate Limiting

**Issue:**
Rate limiting is completely skipped for the demo account email, which could be abused.

**Evidence:**
```typescript
// rateLimiter.ts:46-47
skip: (req) => isDemoRequest(req.body?.email),

// rateLimiter.ts:63-64
skip: (req) => isDemoRequest(req.body?.email),
```

**Risk:**
- If demo mode is enabled, attackers could use demo credentials for unlimited requests
- Could be used for enumeration attacks or DoS
- Demo account could be used as a bot for scraping or abuse

**Fix:**
Apply separate, more lenient rate limits for demo instead of completely skipping:
```typescript
// Create a demo-specific limiter with higher but not unlimited limits
export const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200, // More lenient but still limited
  skip: (req) => !isDemoRequest(req.body?.email),
});
```

**Effort:** 1-2 hours

---

### [MEDIUM] Trust Proxy Configuration

**File:** `backend/src/app.ts`, line 80
**Category:** Authentication

**Issue:**
The `trust proxy` setting is set to `1`, which trusts exactly one proxy layer. This requires careful deployment to ensure there's exactly one proxy (like nginx or a load balancer) in front of the application.

**Evidence:**
```typescript
app.set('trust proxy', 1);
```

**Risk:**
- If deployed without a proxy, attackers can spoof their IP via X-Forwarded-For header
- If deployed behind multiple proxies, the wrong IP will be used for rate limiting
- Could allow rate limit bypass or audit log IP spoofing

**Fix:**
Document the deployment requirements clearly and consider making this configurable:
```typescript
// Make configurable via environment
const trustProxy = process.env.TRUST_PROXY_HOPS
  ? parseInt(process.env.TRUST_PROXY_HOPS, 10)
  : (config.isProduction ? 1 : false);
app.set('trust proxy', trustProxy);
```

**Effort:** 30 minutes

---

### [LOW] JWT Secret Length Recommendation

**File:** `backend/src/config/index.ts`, lines 119-126
**Category:** Authentication

**Issue:**
The minimum JWT secret length is set to 32 characters. While this provides 256 bits of security for base64-encoded secrets, it's on the lower end for HS256.

**Evidence:**
```typescript
const MIN_JWT_SECRET_LENGTH = 32;

if (config.jwt.accessSecret.length < MIN_JWT_SECRET_LENGTH) {
  throw new Error(
    `JWT_ACCESS_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters.`
  );
}
```

**Risk:**
- 32 characters is adequate but not ideal
- Shorter secrets have less entropy margin against brute force

**Fix:**
Consider increasing to 64 characters for additional security margin:
```typescript
const MIN_JWT_SECRET_LENGTH = 64; // 512 bits for HS256
```

**Effort:** 15 minutes

---

### [LOW] Audit Log System Salt Not Encrypted

**File:** `backend/src/services/auditLog.ts`, lines 106-124
**Category:** Audit Logging

**Issue:**
The audit encryption salt is stored in plaintext in the SystemConfig table.

**Evidence:**
```typescript
config = await this.prisma.systemConfig.create({
  data: {
    key: 'audit_encryption_salt',
    value: this.systemSalt,
    description: 'Salt used for encrypting audit log values',
    isEncrypted: false, // The salt itself is not encrypted
  },
});
```

**Risk:**
- Salt exposure makes brute-force attacks on encrypted audit values slightly easier
- Not a critical issue since the encryption key is still required
- Minor deviation from defense-in-depth principle

**Fix:**
Consider encrypting the audit salt with the master key:
```typescript
const encryptionService = getEncryptionService();
const encryptedSalt = encryptionService.encryptWithMasterKey(this.systemSalt);
// Store encryptedSalt with isEncrypted: true
```

**Effort:** 30 minutes

---

### [LOW] Refresh Token Truncation

**File:** `backend/src/services/authService.ts`, line 231
**Category:** Authentication

**Issue:**
Refresh tokens are truncated to 500 characters when stored in the session table.

**Evidence:**
```typescript
await prisma.session.create({
  data: {
    id: tokenId,
    userId: user.id,
    token: token.substring(0, 500), // Store truncated token for reference
    // ...
  },
});
```

**Risk:**
- JWTs with large payloads could exceed 500 characters
- The stored token is only for reference and not used for validation (validation uses jti)
- Minimal actual risk since the full token isn't needed

**Fix:**
Consider storing a hash instead of truncated token:
```typescript
token: crypto.createHash('sha256').update(token).digest('hex'),
```

**Effort:** 15 minutes

---

## Positive Security Findings

The following security measures are **well-implemented**:

### Authentication & Session Management

| Control | Status | Details |
|---------|--------|---------|
| JWT Implementation | **GOOD** | Separate access (15min) and refresh (7 day) tokens |
| Algorithm Explicit | **GOOD** | Uses jsonwebtoken defaults (HS256) |
| Token Type Validation | **GOOD** | Validates `type: 'access'` vs `type: 'refresh'` |
| Token Revocation | **GOOD** | Sessions stored in DB, revokable on logout/password change |
| HTTP-only Cookies | **GOOD** | All auth cookies are httpOnly |
| Secure Flag | **GOOD** | Enabled in production |
| SameSite Attribute | **GOOD** | 'strict' in production, 'lax' in development |
| Password Hashing | **GOOD** | bcrypt with 12 rounds |
| Password Complexity | **GOOD** | 8+ chars, upper, lower, number, special required |
| Account Lockout | **GOOD** | 5 attempts, 30 min lockout |
| Timing Attack Protection | **GOOD** | Dummy hash comparison when user not found |
| Session Invalidation | **GOOD** | On logout and password change |
| CSRF Protection | **GOOD** | Double-submit cookie with timing-safe comparison |

### Encryption Implementation

| Control | Status | Details |
|---------|--------|---------|
| Algorithm | **GOOD** | AES-256-GCM (authenticated encryption) |
| IV Generation | **GOOD** | `crypto.randomBytes()` - cryptographically secure |
| IV Reuse Prevention | **GOOD** | Fresh random IV for every encryption |
| Auth Tag Handling | **GOOD** | Properly stored and verified |
| Key Derivation | **GOOD** | PBKDF2-SHA512 with 100,000 iterations |
| Per-User Keys | **GOOD** | Unique salt per user, derived keys |
| Master Key Validation | **GOOD** | 64 hex chars required, blocks weak keys in production |
| User Salt Storage | **GOOD** | Encrypted with master key before storage |
| Field-Level Encryption | **GOOD** | All PHI fields encrypted (values, notes, genotypes) |

### PHI Leakage Prevention

| Control | Status | Details |
|---------|--------|---------|
| localStorage Usage | **CLEAN** | Only in test mocks, not in production code |
| sessionStorage Usage | **CLEAN** | Only mentioned in documentation as "never use" |
| Console Logging | **GOOD** | Wrapped logger with PHI sanitization |
| Error Responses | **GOOD** | Generic messages in production, no stack traces |
| Log Sanitization | **GOOD** | Sensitive fields auto-redacted |
| Frontend State | **GOOD** | Only id/email/role stored, no PHI |

### Audit Logging

| Control | Status | Details |
|---------|--------|---------|
| Completeness | **GOOD** | Logs: login, logout, register, password change, PHI CRUD |
| PHI in Logs | **GOOD** | Values encrypted before storage |
| Timestamp | **GOOD** | ISO format with timezone |
| User ID | **GOOD** | Captured for all actions |
| IP Address | **GOOD** | Captured with proxy handling |
| User Agent | **GOOD** | Captured (truncated to 500 chars) |
| Retention | **GOOD** | 7-year (2555 days) retention policy |

### Input Validation

| Control | Status | Details |
|---------|--------|---------|
| Zod Schemas | **GOOD** | Comprehensive validation for all endpoints |
| SQL Injection | **GOOD** | Prisma ORM with parameterized queries |
| XSS Prevention | **GOOD** | Input sanitization, no dangerouslySetInnerHTML |
| Command Injection | **GOOD** | No shell execution, only regex.exec for text parsing |
| UUID Validation | **GOOD** | All IDs validated as UUIDs |
| rsid Validation | **GOOD** | Strict regex for DNA rsid parameters |

### Authorization

| Control | Status | Details |
|---------|--------|---------|
| User Isolation | **GOOD** | All queries filtered by userId |
| Route Protection | **GOOD** | authenticate middleware on all protected routes |
| RBAC | **GOOD** | Role-based permissions (PATIENT, PROVIDER, ADMIN) |
| Resource Ownership | **GOOD** | Verified before CRUD operations |
| Provider Access | **GOOD** | Requires active relationship with consent |

### Rate Limiting

| Control | Status | Details |
|---------|--------|---------|
| General API | **GOOD** | 100 requests per 15 minutes |
| Auth Routes | **GOOD** | 20 attempts per 15 minutes |
| Login (Strict) | **GOOD** | 5 attempts per 15 minutes per email+IP |
| File Uploads | **GOOD** | 20 uploads per hour |
| Sensitive Ops | **GOOD** | 10 requests per hour |

---

## Top 5 Priority Fixes

| Priority | Issue | Severity | Effort |
|----------|-------|----------|--------|
| 1 | Demo Account Security Risk | HIGH | 2-3 hours |
| 2 | PDF Magic Byte Validation | MEDIUM | 1 hour |
| 3 | AES-GCM IV Length | MEDIUM | 1-2 hours |
| 4 | Rate Limit Demo Bypass | MEDIUM | 1-2 hours |
| 5 | Trust Proxy Documentation | MEDIUM | 30 minutes |

**Total Estimated Remediation Time:** 6-9 hours

---

## Answers to Key Questions

### 1. Is the JWT implementation secure enough for PHI?
**YES**, with minor recommendations. The implementation uses:
- Separate access/refresh tokens with appropriate expiration
- HTTP-only secure cookies
- Token revocation capability
- Timing attack protection

**Recommendation:** Increase minimum secret length to 64 characters.

### 2. Is the AES-256-GCM implementation correct (no IV reuse)?
**YES**. The implementation:
- Uses `crypto.randomBytes()` for IV generation (cryptographically secure)
- Generates a fresh IV for every encryption operation
- Properly stores and validates authentication tags

**Minor Issue:** IV length is 16 bytes instead of NIST-recommended 12 bytes.

### 3. Is there ANY PHI leakage (logs, errors, browser storage)?
**NO PHI leakage detected.**
- Logger automatically redacts sensitive fields
- Production errors use generic messages
- No localStorage/sessionStorage for PHI
- Frontend only stores id/email/role

### 4. Are audit logs complete and tamper-resistant?
**YES**, audit logs are comprehensive:
- All PHI access is logged (read, create, update, delete)
- Authentication events logged
- Values encrypted before storage
- 7-year retention policy

**Minor Issue:** Log deletion is possible by admins (inherent to database storage).

### 5. Can any user access another user's data?
**NO**. Authorization is properly implemented:
- All data queries filtered by userId
- RBAC middleware enforces role permissions
- Resource ownership verified before operations
- Provider access requires explicit consent relationship

---

## Conclusion

The OwnMyHealth platform demonstrates **security-conscious development practices** appropriate for HIPAA-regulated PHI. The codebase has:

- Strong encryption with AES-256-GCM and per-user key derivation
- Comprehensive authentication with JWT, CSRF protection, and account lockout
- No PHI leakage vectors detected
- Complete audit logging for compliance
- Proper authorization with user isolation

The identified issues are primarily **best practice improvements** rather than critical vulnerabilities. The HIGH-severity demo account issue should be addressed before any production deployment where the demo feature might be accidentally enabled.

**Recommendation:** Address the HIGH priority item immediately and the MEDIUM items before ThoughtBot engagement. The platform is well-positioned for secure PHI handling once these items are resolved.
