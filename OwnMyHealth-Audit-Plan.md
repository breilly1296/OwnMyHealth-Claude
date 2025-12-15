# OwnMyHealth Deep Audit Plan (Revised)

## Phase 1: Critical Security (Do First)

### Step 1: PHI Data Flow Analysis
**Priority: P0 | Risk: Data Breach**

| Check | Success Criteria |
|-------|------------------|
| Trace PHI fields: API input → encryption → DB → decryption → response | Document complete flow diagram for each PHI field |
| userSalt usage consistency | Zero instances of master key used directly for user PHI |
| Audit log coverage | 100% of PHI read/write/delete operations logged |
| Encrypted fields integrity | `grep -r` for field names returns zero plaintext assignments |
| Encryption service init order | PHI endpoints return 503 if encryption not ready |
| PHI not in logs | Audit logs store action type + record ID, never PHI content |
| Error messages sanitized | No PHI in error responses (test with invalid requests) |
| PHI not in URLs/headers | Zero PHI in query params, path params, or response headers |
| Memory clearing | DNA parsing buffers explicitly cleared after processing |

**Automated Checks:**
```bash
# Find potential plaintext PHI leaks
grep -rn "description:" --include="*.ts" | grep -v "Encrypted"
grep -rn "console.log" --include="*.ts" | grep -i "phi\|genotype\|health"
```

---

### Step 2: Authentication & Session Security
**Priority: P0 | Risk: Unauthorized Access**

| Check | Success Criteria |
|-------|------------------|
| JWT refresh token rotation | Old refresh token invalid after use (test: replay attack fails) |
| Session invalidation on password change | All existing sessions terminated (verify via DB/Redis) |
| HTTP-only cookie flags | `Set-Cookie` header includes `HttpOnly; Secure; SameSite=Strict` in production |
| Rate limiting on auth endpoints | `/auth/*` returns 429 after threshold (test: 10 requests/minute) |
| Demo account production check | `NODE_ENV=production` with demo credentials fails to start |
| Password requirements | Minimum 12 chars, complexity rules enforced |
| Account lockout | Account locked after 5 failed attempts, unlock via email |
| Token expiry | Access token ≤15 min, refresh token ≤7 days |

**Automated Checks:**
```bash
# Verify cookie flags in response
curl -I https://app/auth/login | grep -i "set-cookie"
```

---

### Step 3: Input Validation & Injection Prevention
**Priority: P0 | Risk: Injection Attacks**

| Check | Success Criteria |
|-------|------------------|
| No raw SQL | Zero `$queryRaw` or `$executeRaw` without parameterization |
| Request body validation | All endpoints use Zod/Joi schemas before processing |
| DNA file upload limits | Max file size enforced (e.g., 50MB), type validated |
| DNA parsing sandboxed | Parser handles malformed input without crash (fuzz test) |
| XSS in PHI display | All PHI rendered with proper escaping (React default + verify) |
| CSRF protection | State-changing endpoints require CSRF token |

**Automated Checks:**
```bash
# Find unparameterized queries
grep -rn "\$queryRaw\|\$executeRaw" --include="*.ts"
# Find missing validation
grep -rn "req.body\." --include="*.ts" | grep -v "validate\|schema\|parse"
```

---

### Step 4: Dependency & Configuration Security
**Priority: P0 | Risk: Supply Chain / Secrets Exposure**

| Check | Success Criteria |
|-------|------------------|
| Dependency vulnerabilities | `npm audit` returns 0 critical/high vulnerabilities |
| Secrets in code | Zero secrets in source (use `git-secrets` or `trufflehog`) |
| Production env validation | App fails to start if required vars missing |
| CORS origins | Whitelist validated, no `*` in production |
| CSP headers | Content-Security-Policy header present and restrictive |
| Secrets in logs/errors | Stack traces don't contain env vars |

**Automated Checks:**
```bash
npm audit --audit-level=high
npx trufflehog git file://. --only-verified
```

---

## Phase 2: Compliance & Access Control

### Step 5: HIPAA Compliance Controls
**Priority: P1 | Risk: Regulatory Violation**

| Check | Success Criteria |
|-------|------------------|
| Minimum necessary principle | API responses return only required PHI fields for each endpoint |
| Data retention policy | Automated deletion of PHI after retention period (configurable) |
| Right to deletion | User delete removes all PHI, audit log retained (anonymized) |
| Access logging | Who accessed what PHI, when, from where (IP) |
| Encryption at rest | Database encryption enabled (Prisma + DB config) |
| Encryption in transit | TLS 1.2+ enforced, no HTTP fallback |
| BAA inventory | List all third-party services with PHI access, verify BAAs |
| Breach notification | Mechanism to identify affected users if breach occurs |

**Documentation Required:**
- [ ] Data flow diagram showing all PHI touchpoints
- [ ] Third-party service inventory with BAA status
- [ ] Retention schedule per data type

---

### Step 6: Authorization & Access Patterns
**Priority: P1 | Risk: Privilege Escalation**

| Check | Success Criteria |
|-------|------------------|
| Controller pattern consistency | All follow: validate → authorize → execute → audit → respond |
| User can only access own data | All queries include `userId` filter (test: IDOR attempts fail) |
| Role-based access (if applicable) | Admin endpoints reject non-admin tokens |
| Bulk operations authorized | $transaction includes per-record auth check |
| Cascade delete controlled | Deleting user removes PHI but preserves anonymized audit trail |

**Test Cases:**
```
1. User A cannot access User B's health records (403)
2. User A cannot modify User B's data via bulk endpoint (403)
3. Deleted user's PHI is unrecoverable
```

---

## Phase 3: Code Quality & Reliability

### Step 7: Database Query Patterns
**Priority: P2 | Risk: Performance / Availability**

| Check | Success Criteria |
|-------|------------------|
| N+1 queries | Zero `.find()` calls inside loops; use `include` or batch |
| Missing indexes | All filtered/sorted fields indexed in schema.prisma |
| Unbounded queries | All list endpoints have `take` limit (max 100) |
| Transaction timeouts | Bulk operations have timeout configured |
| Connection pooling | Pool size appropriate for expected load |

**Automated Checks:**
```bash
# Find potential N+1
grep -rn "\.forEach\|\.map" --include="*.ts" -A5 | grep "prisma\."
# Find unbounded queries
grep -rn "findMany" --include="*.ts" | grep -v "take:"
```

---

### Step 8: Type Safety Enforcement
**Priority: P2 | Risk: Runtime Errors**

| Check | Success Criteria |
|-------|------------------|
| No unsafe casts | Zero `as any` or `as unknown` (or documented exceptions) |
| Enum consistency | Prisma enums match TypeScript enums exactly |
| Non-null assertions | Zero `!` on user input or external data |
| API type sync | Frontend types generated from backend (or shared package) |
| Strict mode | `tsconfig.json` has `strict: true` |

**Automated Checks:**
```bash
grep -rn "as any\|as unknown" --include="*.ts" | wc -l
grep -rn "\![^=]" --include="*.ts" | grep -v "test\|spec"
```

---

### Step 9: Test Coverage (Integrate Throughout)
**Priority: P1 | Risk: Regression**

| Priority | Test | Success Criteria |
|----------|------|------------------|
| P0 | Encryption round-trip | `encrypt(decrypt(x)) === x` for all PHI field types |
| P0 | JWT validation | Invalid/expired/tampered tokens rejected |
| P0 | Auth integration | Register → login → refresh → logout flow passes |
| P0 | IDOR prevention | Cross-user access attempts return 403 |
| P1 | PHI CRUD + audit | Create/read/update/delete generates correct audit entries |
| P1 | DNA parsing edge cases | Malformed files handled gracefully |
| P1 | Rate limiting | Auth endpoints enforce limits |
| P2 | E2E critical paths | Login → view health data → export flow |

**Coverage Targets:**
- Auth module: 90%+
- Encryption module: 95%+
- PHI controllers: 80%+
- Overall: 70%+

---

## Phase 4: Operational Security

### Step 10: Monitoring & Incident Response
**Priority: P1 | Risk: Undetected Breach**

| Check | Success Criteria |
|-------|------------------|
| Failed auth alerting | Alert triggered after 10 failed logins for same user |
| Bulk PHI access alerting | Alert if single user accesses >100 records in 1 hour |
| Error rate monitoring | Alert if 5xx rate exceeds 1% |
| Audit log integrity | Logs are append-only, tamper-evident (or shipped to SIEM) |
| Backup encryption | Backups encrypted with separate key |
| Backup restore tested | Documented restore procedure, tested quarterly |
| Incident response plan | Documented steps: detect → contain → notify → remediate |

**Runbook Required:**
- [ ] Security incident response procedure
- [ ] Data breach notification template
- [ ] Backup restore procedure

---

## Phase 5: Frontend & UX Security

### Step 11: Frontend Security & State
**Priority: P2 | Risk: Client-Side Exposure**

| Check | Success Criteria |
|-------|------------------|
| No PHI in browser storage | Zero PHI in localStorage/sessionStorage (audit via DevTools) |
| Session timeout UI | User logged out after 15 min idle, warning at 12 min |
| Error boundaries | PHI components wrapped, errors don't leak data |
| Loading states | All async ops show loading (no stale PHI displayed) |
| Cache invalidation | Mutations invalidate relevant queries |
| Console.log audit | Zero PHI logged to console |
| Accessibility | ARIA labels on PHI displays for screen readers |

**Automated Checks:**
```bash
grep -rn "localStorage\|sessionStorage" --include="*.tsx" --include="*.ts"
grep -rn "console.log" --include="*.tsx" | grep -v "// debug"
```

---

### Step 12: Component Architecture
**Priority: P3 | Risk: Maintainability**

| Check | Success Criteria |
|-------|------------------|
| Large component splitting | No component >300 lines (or documented exception) |
| Shared UI extraction | Common patterns in `/components/ui` |
| Form validation consistency | Single validation library (Zod or Yup, not both) |
| API response types | Types match backend exactly (generated or shared) |

---

## Phase 6: Documentation

### Step 13: API Documentation
**Priority: P3 | Risk: Integration Errors**

| Check | Success Criteria |
|-------|------------------|
| OpenAPI spec | Generated from routes, covers all endpoints |
| Query params documented | Pagination, filter params listed |
| Error shapes documented | All error response formats defined |
| Examples provided | Request/response examples for each endpoint |
| Versioning strategy | API version in URL or header, documented |

---

## Execution Checklist

```
Phase 1: Critical Security
[ ] Step 1: PHI Data Flow
[ ] Step 2: Auth & Session
[ ] Step 3: Input Validation
[ ] Step 4: Dependencies & Config

Phase 2: Compliance
[ ] Step 5: HIPAA Controls
[ ] Step 6: Authorization

Phase 3: Code Quality
[ ] Step 7: Database Queries
[ ] Step 8: Type Safety
[ ] Step 9: Test Coverage

Phase 4: Operations
[ ] Step 10: Monitoring & IR

Phase 5: Frontend
[ ] Step 11: Frontend Security
[ ] Step 12: Components

Phase 6: Documentation
[ ] Step 13: API Docs
```
