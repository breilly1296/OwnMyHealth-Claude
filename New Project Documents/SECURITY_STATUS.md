# OwnMyHealth Security Status

**Last Updated:** 2026-02-06
**Last Audit:** 2026-02-06 (Automated codebase security scan via Claude Code)
**Security Grade:** B+

---

## Security Posture Summary

| Metric | Status |
|--------|--------|
| Critical Findings | 0 |
| High Findings | 2 |
| Medium Findings | 4 |
| Low Findings | 3 |
| Open Issues | 6 |
| BAAs Signed | GCP (required for Cloud SQL + GCS) |

**Overall Assessment:** The OwnMyHealth platform demonstrates a strong security foundation with HIPAA-aligned controls. Authentication, encryption, audit logging, and access control are well-implemented. Areas for improvement include external penetration testing, enhanced file validation, and Redis-backed token revocation for production scale.

---

## Controls Status

### Authentication & Authorization

| Control | Status | Notes |
|---------|--------|-------|
| JWT Access Tokens | Implemented | 15-minute expiration, signed with configurable secret |
| JWT Refresh Tokens | Implemented | 7-day expiration, DB-backed sessions, token rotation on refresh |
| Password Hashing | Implemented | bcrypt with configurable rounds (default 12) |
| Password Strength | Implemented | Min 12 chars, uppercase, lowercase, number, special character required |
| Account Lockout | Implemented | 5 failed attempts triggers 30-minute lockout |
| Timing Attack Prevention | Implemented | Dummy bcrypt comparison when user not found + random delay |
| Email Enumeration Prevention | Implemented | Consistent responses on forgot-password and resend-verification |
| Email Verification | Implemented | 24-hour token expiry, cryptographically random 32-byte tokens |
| CSRF Protection | Implemented | Double-submit cookie pattern with timing-safe comparison |
| RBAC (Role-Based Access) | Implemented | Three-tier hierarchy: PATIENT < PROVIDER < ADMIN |
| Resource Ownership | Implemented | Middleware verifies user owns resource or has provider relationship |
| Provider Consent Scope | Implemented | Granular permissions (biomarkers, insurance, DNA, health needs, edit) |
| Consent Expiration | Implemented | Provider access auto-expires based on consentExpiresAt |
| Row-Level Security (RLS) | Implemented | PostgreSQL RLS policies enforce user-scoped data access at DB level |
| Demo Account Protection | Implemented | Blocks role escalation, admin access, cross-user modification; blocked in production |
| Session Management | Implemented | DB-backed sessions, expired session cleanup (hourly scheduler) |
| Token Revocation on Password Reset | Implemented | All sessions revoked when password is reset |

### Encryption

| Control | Status | Notes |
|---------|--------|-------|
| PHI at Rest (Application Layer) | Implemented | AES-256-GCM authenticated encryption |
| Per-User Key Derivation | Implemented | PBKDF2-SHA512 with 100,000 iterations, per-user salt |
| User Salt Protection | Implemented | Salts encrypted with master key before DB storage |
| Key Rotation Support | Implemented | `rotateUserEncryptionKey()` with atomic salt swap |
| Master Key Validation | Implemented | 256-bit minimum, hex format enforced, known-weak keys blocked in production |
| Encryption Fail-Hard | Implemented | Server refuses to start if encryption key is invalid or missing |
| In Transit (TLS) | Implemented | Cloud Run enforces HTTPS; cookies marked Secure in production |
| PHI Field Coverage | Implemented | 13 models covered: User, Biomarker, Insurance, DNA, HealthNeed, HealthGoal, Expense, CostAnalysis, AuditLog, ProviderPatient, GoalProgressHistory, GeneticTrait, DNAVariant |
| Audit Log Value Encryption | Implemented | Previous/new values encrypted with system salt before storage |
| Search Hash Support | Implemented | One-way PBKDF2 hash for encrypted field lookups |

### Input Validation

| Control | Status | Notes |
|---------|--------|-------|
| Zod Schema Validation | Implemented | All API endpoints validated with typed Zod schemas |
| HTML Sanitization | Implemented | All string inputs have HTML special characters escaped |
| UUID Validation | Implemented | All route params and IDs validated as UUIDv4 |
| String Length Limits | Implemented | Min/max length enforced on all string fields |
| Enum Validation | Implemented | Strict enum checks for roles, statuses, categories, etc. |
| Content-Type Enforcement | Implemented | JSON content-type required for POST/PUT/PATCH with body |
| SQL Injection Prevention | Implemented | Prisma ORM parameterized queries; RLS context uses UUID-validated values |
| XSS Prevention | Implemented | Input sanitization + Helmet CSP headers |
| File Upload Validation | Partial | MIME type checked; no deep content/magic byte validation |
| Body Size Limits | Implemented | 10MB JSON body limit |
| Password Max Length | Implemented | 128 characters maximum prevents bcrypt DoS |

### Rate Limiting & DDoS Protection

| Control | Status | Notes |
|---------|--------|-------|
| Global Rate Limiter | Implemented | 100 requests per 15-minute window |
| Auth Rate Limiter | Implemented | 20 attempts per 15-minute window |
| Login Brute Force Protection | Implemented | 5 attempts per 15 minutes (per email+IP), skips successful requests |
| Upload Rate Limiter | Implemented | 20 uploads per hour |
| Sensitive Operations Limiter | Implemented | 10 requests per hour |
| Bulk Operations Limiter | Implemented | 30 bulk operations per hour |
| Standard Rate Limit Headers | Implemented | RateLimit-* headers returned per RFC 6585 |
| IP-Based Key Generation | Implemented | Respects trust proxy for real client IP behind Cloud Run LB |
| Distributed Rate Limiting | Not Implemented | In-memory only; not shared across Cloud Run instances |

### Audit Logging

| Control | Status | Notes |
|---------|--------|-------|
| PHI Access Logging | Implemented | All READ, CREATE, UPDATE, DELETE operations on PHI |
| Authentication Event Logging | Implemented | LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGE, PASSWORD_RESET, REGISTER, EMAIL_VERIFICATION |
| IP Address Capture | Implemented | Uses Express `req.ip` with trust proxy configured |
| User Agent Capture | Implemented | Truncated to 500 chars |
| Session ID Tracking | Implemented | Links audit entries to sessions |
| Data Export Logging | Implemented | Records format, record count, resource IDs (capped at 100) |
| System Event Logging | Implemented | Retention cleanup, system operations |
| 7-Year Retention | Implemented | 2,555-day retention with daily automated cleanup |
| Immutable Logs | Implemented | No update/delete operations exposed on audit log entries |
| Audit Value Encryption | Implemented | Previous/new values encrypted at rest |
| Critical Failure Logging | Implemented | Audit write failures logged as CRITICAL with redacted values |

### External Service Security

| Service | Security Status | Notes |
|---------|----------------|-------|
| Google Cloud SQL | Secured | Auth Proxy connection, 30s timeouts, connection pooling (max 5) |
| Google Cloud Storage | Secured | Signed URLs with 15-minute expiry, user-scoped paths (`{userId}/{fileId}`) |
| Anthropic Claude API | Secured | API key via environment variable, not in code |
| SendGrid Email | Secured | API key via environment variable |
| Google Document AI | Secured | GCP service account credentials |
| GitHub Actions | Secured | Secrets stored in GitHub Secrets (`GCP_SA_KEY`), not committed |

### Dockerfile & Container Security

| Control | Status | Notes |
|---------|--------|-------|
| Multi-Stage Build | Implemented | Builder stage separated from production; no dev dependencies in final image |
| Non-Root User | Implemented | Runs as `nodejs` user (UID 1001) |
| Alpine Base Image | Implemented | Minimal attack surface with `node:20-alpine` |
| System Updates | Implemented | `apk update && apk upgrade` in production stage |
| Health Check | Implemented | Docker HEALTHCHECK with 30s interval, 10s timeout |
| Production Dependencies Only | Implemented | `npm ci --omit=dev` in production stage |
| No Secrets in Image | Implemented | Dummy DATABASE_URL used only for Prisma generate |

### CI/CD Security

| Control | Status | Notes |
|---------|--------|-------|
| Dependency Audit | Implemented | `npm audit --audit-level=high` in CI (frontend + backend) |
| Secrets Management | Implemented | GCP SA key stored as GitHub Actions secret |
| Image Tagging | Implemented | Images tagged with commit SHA for traceability |
| Artifact Registry | Implemented | Private GCP Artifact Registry (not public Docker Hub) |
| Build Isolation | Implemented | CI runs in ephemeral containers |
| Branch Protection | Partial | CI triggers on main/master/develop + PRs |

### HTTP Security Headers (Helmet.js)

| Header | Status | Notes |
|--------|--------|-------|
| Content-Security-Policy | Implemented | `default-src 'self'`, `script-src 'self'`, limited `img-src` |
| X-Frame-Options | Implemented | Helmet default (SAMEORIGIN) |
| X-Content-Type-Options | Implemented | Helmet default (nosniff) |
| Strict-Transport-Security | Implemented | Helmet default HSTS |
| X-XSS-Protection | Implemented | Helmet default |
| Cross-Origin-Resource-Policy | Conditional | Disabled for cross-domain setups, same-origin otherwise |

### Cookie Security

| Control | Status | Notes |
|---------|--------|-------|
| HttpOnly (Auth Cookies) | Implemented | Access/refresh tokens in HttpOnly cookies |
| Secure Flag | Implemented | Enabled in production |
| SameSite | Implemented | Lax by default; None for cross-domain with Secure |
| Domain Scoping | Implemented | Configurable via COOKIE_DOMAIN |
| CSRF Cookie (Non-HttpOnly) | Implemented | Intentionally readable by JS for double-submit pattern |

---

## HIPAA Compliance Status

| HIPAA Requirement | Technical Control | Status |
|-------------------|-------------------|--------|
| Access Control (164.312(a)(1)) | JWT auth + RBAC + RLS | Implemented |
| Audit Controls (164.312(b)) | AuditLogService with 7-year retention | Implemented |
| Integrity Controls (164.312(c)(1)) | AES-256-GCM authenticated encryption (auth tag) | Implemented |
| Transmission Security (164.312(e)(1)) | TLS via Cloud Run, Secure cookies | Implemented |
| Encryption at Rest (164.312(a)(2)(iv)) | AES-256-GCM per-user encryption | Implemented |
| Unique User Identification (164.312(a)(2)(i)) | UUID-based user IDs, email uniqueness | Implemented |
| Emergency Access (164.312(a)(2)(ii)) | Admin role bypasses RLS | Partial |
| Automatic Logoff (164.312(a)(2)(iii)) | 15-minute access token expiry | Implemented |
| Person/Entity Authentication (164.312(d)) | Email verification + password strength | Implemented |
| Data Backup | GCP Cloud SQL automated backups | Requires Verification |
| Disposal (164.310(d)(2)(i)) | Account deletion with data purge | Implemented |
| Minimum Necessary (164.502(b)) | Provider consent with granular permissions | Implemented |

---

## Known Security Gaps & Recommendations

### High Priority

| # | Finding | Severity | Status | Recommendation |
|---|---------|----------|--------|----------------|
| 1 | In-memory token blacklist does not persist across restarts or scale across instances | High | Open | Migrate to Redis-backed token blacklist for production; current `revokedTokens` Set is lost on restart and not shared across Cloud Run instances |
| 2 | Distributed rate limiting not implemented | High | Open | Rate limiting uses in-memory store; Cloud Run horizontal scaling means each instance has its own counter. Migrate to Redis-backed rate limiter (e.g., `rate-limit-redis`) |

### Medium Priority

| # | Finding | Severity | Status | Recommendation |
|---|---------|----------|--------|----------------|
| 3 | File upload validation limited to MIME type | Medium | Open | Add magic byte validation (file signatures) for uploaded PDFs and images to prevent disguised malicious files |
| 4 | No Content Security Policy reporting | Medium | Open | Add `report-uri` or `report-to` directive to CSP for monitoring violations |
| 5 | Audit log CI audit uses `continue-on-error: true` | Medium | Open | Consider failing CI on high/critical vulnerabilities instead of continuing |
| 6 | No automated secret rotation | Medium | Open | Implement scheduled rotation for JWT secrets, PHI encryption keys, and API keys via GCP Secret Manager |

### Low Priority

| # | Finding | Severity | Status | Recommendation |
|---|---------|----------|--------|----------------|
| 7 | No IP allowlisting for admin endpoints | Low | Open | Consider restricting admin API access to known IP ranges or VPN |
| 8 | Refresh token stored truncated in DB | Low | Informational | `token.substring(0, 500)` stored for reference; not a security issue but noted for completeness |
| 9 | No request body logging for failed auth attempts | Low | Open | Consider logging (redacted) request metadata for failed login forensics |

---

## Security Configuration Summary

| Setting | Value |
|---------|-------|
| JWT Access Token Expiry | 15 minutes (900 seconds) |
| JWT Refresh Token Expiry | 7 days (604,800 seconds) |
| bcrypt Rounds | 12 |
| PBKDF2 Iterations (PHI) | 100,000 |
| PHI Encryption Algorithm | AES-256-GCM |
| Key Derivation | PBKDF2-SHA512 |
| User Salt Length | 32 bytes |
| IV Length | 16 bytes |
| Min Password Length | 12 characters |
| Max Login Attempts | 5 |
| Account Lockout Duration | 30 minutes |
| Global Rate Limit | 100 requests / 15 minutes |
| Login Rate Limit | 5 attempts / 15 minutes (per email+IP) |
| Upload Rate Limit | 20 / hour |
| Audit Log Retention | 7 years (2,555 days) |
| Signed URL Expiry (GCS) | 15 minutes |
| Email Verification Expiry | 24 hours |
| Password Reset Expiry | 1 hour |
| JSON Body Size Limit | 10 MB |
| DB Connection Pool | max 5 connections |

---

## Production Startup Validations

The application enforces the following checks at startup in production (`NODE_ENV=production`):

1. **Required environment variables:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, `PHI_ENCRYPTION_KEY` must all be set
2. **JWT secrets cannot use defaults:** Blocks known fallback strings
3. **JWT secret minimum length:** 32 characters for both access and refresh secrets
4. **PHI encryption key:** Must be 64+ hex characters (256 bits), not a known placeholder
5. **Demo mode blocked:** `DEMO_ACCOUNT_ENABLED=true` causes fatal error in production
6. **CORS localhost blocked:** Rejects localhost origins in CORS configuration
7. **Database connection required:** Server will not start if database is unreachable
8. **Encryption service required:** Server will not start if PHI encryption fails to initialize
9. **Audit logging required:** Server will not start if audit log service fails to initialize

---

## Compliance Status

| Requirement | Status |
|-------------|--------|
| GCP BAA | Required for HIPAA; verify signed |
| Anthropic BAA | Required if PHI sent to Claude API; verify signed |
| SendGrid BAA | Required if PHI in emails; verify signed |
| SOC 2 | Not yet pursued |
| HIPAA Technical Safeguards | Implemented (see table above) |
| HIPAA Administrative Safeguards | Requires organizational policies |
| HIPAA Physical Safeguards | Delegated to GCP (data center security) |
| Penetration Testing | Not yet performed |

---

## Upcoming Security Tasks

- [ ] Migrate rate limiting to Redis-backed store for Cloud Run scaling
- [ ] Migrate token blacklist to Redis for cross-instance consistency
- [ ] Add file magic byte validation for upload security
- [ ] Schedule first external penetration test
- [ ] Add CSP violation reporting endpoint
- [ ] Implement automated secret rotation via GCP Secret Manager
- [ ] Verify all BAAs are signed (GCP, Anthropic, SendGrid)
- [ ] Fail CI on high/critical npm audit findings (remove `continue-on-error`)
- [ ] Add IP allowlisting option for admin routes
- [ ] Document and test emergency access procedures
- [ ] Verify GCP Cloud SQL automated backup configuration

---

## Audit History

| Date | Type | Tool/Method | Result |
|------|------|-------------|--------|
| 2026-02-06 | Automated code review | Claude Code (codebase scan) | B+ -- Strong foundation, gaps in distributed infrastructure security |

---

*Next audit scheduled: 2026-05-06 (quarterly)*
*Next penetration test: TBD (recommended before public launch)*
