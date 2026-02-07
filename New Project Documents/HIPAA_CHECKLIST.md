# OwnMyHealth HIPAA Compliance Checklist

**Last Updated:** 2026-02-06
**Compliance Officer:** TBD (Solo Founder)
**Application Status:** Development / Pre-Production
**Assessment Method:** Automated codebase scan + manual review

---

## Legend

| Symbol | Meaning |
|--------|---------|
| [x] | Compliant -- implemented and verified in code |
| [~] | Partial -- partially implemented, gaps remain |
| [ ] | Non-Compliant -- not yet implemented |
| [N/A] | Not Applicable to this deployment model |

---

## Table of Contents

1. [Business Associate Agreements (BAAs)](#1-business-associate-agreements-baas)
2. [Administrative Safeguards (45 CFR 164.308)](#2-administrative-safeguards-45-cfr-164308)
3. [Physical Safeguards (45 CFR 164.310)](#3-physical-safeguards-45-cfr-164310)
4. [Technical Safeguards (45 CFR 164.312)](#4-technical-safeguards-45-cfr-164312)
5. [Organizational Requirements (45 CFR 164.314)](#5-organizational-requirements-45-cfr-164314)
6. [Patient Rights (45 CFR 164.524-164.528)](#6-patient-rights-45-cfr-164524-164528)
7. [Breach Notification Rule (45 CFR 164.400-414)](#7-breach-notification-rule-45-cfr-164400-414)
8. [Required Documentation Summary](#8-required-documentation-summary)
9. [Compliance Roadmap](#9-compliance-roadmap)

---

## 1. Business Associate Agreements (BAAs)

All third-party vendors that create, receive, maintain, or transmit PHI on behalf of OwnMyHealth require a signed BAA.

| Vendor | Service | PHI Exposure | BAA Status | Date | Notes |
|--------|---------|-------------|------------|------|-------|
| Google Cloud Platform | Cloud Run, Cloud SQL, GCS, Document AI | Yes -- hosts all ePHI | [ ] Pending | -- | GCP offers BAA via Cloud Identity; must be activated |
| Anthropic | Claude API (biomarker guidance, SBC extraction, cost analysis) | Yes -- PHI sent for AI processing | [ ] Pending | -- | Contact Anthropic for BAA availability |
| SendGrid (Twilio) | Transactional email (verification, password reset) | Minimal -- email addresses only | [ ] Pending | -- | Twilio offers BAA for SendGrid |
| GitHub | Source code hosting, CI/CD | No PHI in code (secrets in env vars) | [N/A] | -- | No PHI stored in repository |

**Action Items:**
- [ ] Execute GCP BAA through Google Cloud console
- [ ] Contact Anthropic regarding BAA for Claude API usage
- [ ] Execute SendGrid/Twilio BAA
- [ ] Create BAA tracking register with signed copies

---

## 2. Administrative Safeguards (45 CFR 164.308)

### 2.1 Security Management Process -- 164.308(a)(1)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Risk Analysis (R) | [ ] | No formal risk analysis document exists. Must be conducted before production launch. |
| 2 | Risk Management (R) | [~] | Technical controls are strong (encryption, RLS, audit logging). No formal risk management plan document. |
| 3 | Sanction Policy (R) | [N/A] | Solo founder -- no workforce to sanction. Required when employees/contractors are hired. |
| 4 | Information System Activity Review (R) | [x] | Comprehensive audit logging in `backend/src/services/auditLog.ts`. All PHI access is logged with user ID, IP address, user agent, session ID, action type, resource type, and encrypted previous/new values. Admin panel includes audit log viewer. |

### 2.2 Assigned Security Responsibility -- 164.308(a)(2)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Security Official (R) | [ ] | No designated HIPAA Security Officer. Solo founder should formally designate themselves. |

### 2.3 Workforce Security -- 164.308(a)(3)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Authorization/Supervision (A) | [N/A] | Solo founder. Required when workforce grows. |
| 2 | Workforce Clearance (A) | [N/A] | Solo founder. Required when workforce grows. |
| 3 | Termination Procedures (A) | [N/A] | Solo founder. Session revocation (`revokeAllUserTokens`) exists in `authService.ts` for disabling user access. |

### 2.4 Information Access Management -- 164.308(a)(4)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Isolating Healthcare Clearinghouse Functions (R) | [N/A] | Not a clearinghouse. |
| 2 | Access Authorization (A) | [x] | RBAC with three roles (PATIENT, PROVIDER, ADMIN) in `backend/src/middleware/rbac.ts`. Role hierarchy enforced. Permission matrix per resource type. Provider-patient consent-based access with granular permissions (canViewBiomarkers, canViewInsurance, canViewDna, canViewHealthNeeds, canEditData). |
| 3 | Access Establishment/Modification (A) | [x] | Role-based permissions defined in `ROLE_PERMISSIONS` mapping. Provider access requires active relationship with consent expiration checks. Admin bypass for system operations. |

### 2.5 Security Awareness and Training -- 164.308(a)(5)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Security Reminders (A) | [ ] | No security awareness program. |
| 2 | Protection from Malicious Software (A) | [~] | Input validation at API boundaries. Rate limiting on all endpoints. No formal malware protection policy. |
| 3 | Log-in Monitoring (A) | [x] | Failed login tracking with account lockout in `authService.ts`. Max 5 attempts per 15 minutes (strict rate limiter). Account lockout after configurable attempts (default 5) with 30-minute lockout duration. All auth events audit logged (LOGIN, LOGIN_FAILED, LOGOUT, ACCOUNT_LOCKOUT). |
| 4 | Password Management (A) | [x] | Strong password policy: minimum 12 characters, uppercase, lowercase, number, special character (validated in `validatePasswordStrength`). Bcrypt hashing with 12 rounds. Password reset with 1-hour token expiry. All sessions revoked on password reset. |

### 2.6 Security Incident Procedures -- 164.308(a)(6)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Response and Reporting (R) | [ ] | No formal incident response plan. Audit logs provide forensic data but no documented response procedures. |

### 2.7 Contingency Plan -- 164.308(a)(7)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Data Backup Plan (R) | [~] | Google Cloud SQL provides automated backups. No documented backup verification or restoration procedures. |
| 2 | Disaster Recovery Plan (R) | [ ] | No formal DR plan. Cloud Run provides some inherent resilience. |
| 3 | Emergency Mode Operation Plan (R) | [ ] | No emergency mode operation documented. |
| 4 | Testing and Revision (A) | [ ] | No backup/DR testing schedule. |
| 5 | Applications and Data Criticality Analysis (A) | [ ] | Not formally documented. |

### 2.8 Evaluation -- 164.308(a)(8)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Periodic Technical/Non-Technical Evaluation (R) | [ ] | No scheduled security evaluations or penetration tests. |

---

## 3. Physical Safeguards (45 CFR 164.310)

### 3.1 Facility Access Controls -- 164.310(a)(1)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Contingency Operations (A) | [N/A] | Cloud-hosted. GCP manages physical facility access. |
| 2 | Facility Security Plan (A) | [N/A] | Cloud-hosted on GCP. GCP data centers have SOC 2, ISO 27001, HIPAA compliance certifications. |
| 3 | Access Control and Validation (A) | [N/A] | Delegated to GCP infrastructure. |
| 4 | Maintenance Records (A) | [N/A] | Delegated to GCP infrastructure. |

### 3.2 Workstation Use -- 164.310(b)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Workstation Use Policy (R) | [ ] | No documented workstation security policy for development machines. |

### 3.3 Workstation Security -- 164.310(c)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Physical Safeguards for Workstations (R) | [ ] | No documented physical security for development workstations. |

### 3.4 Device and Media Controls -- 164.310(d)(1)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Disposal (R) | [N/A] | Cloud-hosted. GCP handles media disposal per their compliance certifications. |
| 2 | Media Re-use (R) | [N/A] | Cloud-hosted. Delegated to GCP. |
| 3 | Accountability (A) | [N/A] | Cloud-hosted. No physical media. |
| 4 | Data Backup/Storage (A) | [~] | Cloud SQL automated backups. GCS stores user files with per-user path isolation (`{userId}/{fileId}.{ext}`). No formal backup documentation. |

---

## 4. Technical Safeguards (45 CFR 164.312)

### 4.1 Access Control -- 164.312(a)(1)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Unique User Identification (R) | [x] | Every user has a UUID primary key (`gen_random_uuid()`) in `schema.prisma`. Email is unique. User ID attached to every authenticated request via JWT. |
| 2 | Emergency Access Procedure (R) | [ ] | No documented emergency access procedure. Admin role exists but no break-glass process. |
| 3 | Automatic Logoff (A) | [x] | Access tokens expire in 15 minutes (`JWT_ACCESS_EXPIRES_SECONDS=900` in `config/index.ts`). Refresh tokens expire in 7 days with DB-backed session validation. Expired sessions cleaned up hourly via `cleanupExpiredSessions()` scheduler. |
| 4 | Encryption and Decryption (A) | [x] | **Application-layer encryption:** AES-256-GCM for all PHI fields (`backend/src/services/encryption.ts`). Per-user key derivation using PBKDF2-SHA512 with 100,000 iterations and 32-byte salt (`backend/src/services/userEncryption.ts`). Master key validated at startup -- server refuses to start with invalid/weak keys. Key rotation support implemented (`rotateUserEncryptionKey`, `reEncrypt`). **Encrypted PHI fields include:** User (name, DOB, phone, address), Biomarker (values, notes), Insurance (member ID, group ID), Health Goals (descriptions, progress notes), Health Needs (descriptions), Provider-Patient (notes), DNA (genotypes, traits), Expenses (service types, costs, provider names), Cost Analysis (Claude responses, projections), and Audit Log (previous/new values). |

**Evidence -- encryption.ts key features:**
- Algorithm: `aes-256-gcm` (authenticated encryption)
- IV: 16 bytes random per encryption operation
- Auth tag: 16 bytes for integrity verification
- Format: `iv:authTag:ciphertext` (base64 encoded)
- Insecure key detection blocks known placeholder keys in production
- `encryptFields` / `decryptFields` for batch field operations
- `hashForSearch` for one-way searchable encryption

### 4.2 Audit Controls -- 164.312(b)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Audit Mechanisms (R) | [x] | Comprehensive audit logging in `backend/src/services/auditLog.ts`. **Tracked events:** LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGE, PASSWORD_RESET, READ, VIEW, EXPORT, PRINT, CREATE, UPDATE, DELETE, PHI_ACCESS, PHI_EXPORT, PHI_DECRYPT, PERMISSION_CHANGE, SETTINGS_CHANGE, KEY_ROTATION. **Each log entry records:** userId, actorType (USER/SYSTEM/API/ADMIN/ANONYMOUS), action, resourceType, resourceId, previousValueEncrypted, newValueEncrypted, ipAddress, userAgent, sessionId, metadata, timestamp. |

**Evidence -- audit logging features:**
- Previous and new values encrypted before storage (`encryptValue` method)
- 7-year retention period (2,555 days = `RETENTION_DAYS`)
- Automatic daily cleanup of logs past retention via `startAuditCleanup()` scheduler
- Immutable audit logs -- RLS policy has no UPDATE policy on `audit_logs` table
- Only admin can delete (for compliance-approved purging after retention)
- System-level event logging for maintenance operations
- Export event tracking with record counts and resource IDs
- Auth event tracking with granular action types
- Service fails to start if audit logging initialization fails

### 4.3 Integrity -- 164.312(c)(1)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Mechanism to Authenticate ePHI (A) | [x] | AES-256-GCM provides authenticated encryption -- the GCM authentication tag (16 bytes) verifies data integrity and authenticity on every decrypt operation. Any tampering with ciphertext, IV, or auth tag causes decryption to fail. Database integrity enforced via PostgreSQL constraints and Prisma schema validation. |

### 4.4 Person or Entity Authentication -- 164.312(d)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Authentication (R) | [x] | **JWT-based authentication** (`backend/src/middleware/auth.ts`): Access tokens (15 min) + refresh tokens (7 days, DB-backed). HTTP-only cookies preferred over Authorization header. Token type validation (access vs. refresh). **Password security:** bcrypt with 12 rounds, 12-character minimum with complexity requirements. **Account lockout:** Configurable max attempts (default 5), 30-minute lockout duration. **Timing attack protection:** Constant-time comparison even for non-existent users. **Email verification required** before login. **CSRF protection:** Double-submit cookie pattern with timing-safe comparison (`backend/src/middleware/csrf.ts`). |

### 4.5 Transmission Security -- 164.312(e)(1)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Integrity Controls (A) | [x] | HTTPS enforced in production (Cloud Run provides TLS termination). CSRF protection on state-changing requests. Cookie `secure` flag set in production (`config.cookie.secure`). |
| 2 | Encryption (A) | [x] | TLS encryption provided by GCP Cloud Run for all HTTP traffic. Backend API served over HTTPS (`https://api.ownmyhealth.io`). GCS signed URLs use HTTPS (v4 signatures). Cookie SameSite attribute configured. CORS origin validation in `config/index.ts`. |

---

## 5. Organizational Requirements (45 CFR 164.314)

### 5.1 Business Associate Contracts -- 164.314(a)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | BAA with each business associate (R) | [ ] | No BAAs currently signed. See Section 1 for required BAAs with GCP, Anthropic, and SendGrid. |
| 2 | Satisfactory assurance of safeguards (R) | [~] | GCP and Twilio (SendGrid) are HIPAA-eligible and offer BAAs. Anthropic BAA availability needs verification. |

### 5.2 Requirements for Group Health Plans -- 164.314(b)

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Group Health Plan requirements | [N/A] | OwnMyHealth is not a group health plan. |

---

## 6. Patient Rights (45 CFR 164.524-164.528)

### 6.1 Right of Access -- 164.524

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Patient can access their ePHI | [x] | Full data export implemented in `backend/src/controllers/settingsController.ts` (`exportUserData`). Exports all biomarkers (decrypted), insurance plans, and summary statistics as JSON. Audit logged with operation type EXPORT. Accessible via `GET /api/v1/settings/export-data`. |

### 6.2 Right of Amendment -- 164.526

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Patient can request amendment of ePHI | [x] | Users can update all their own data (biomarkers, insurance, health goals, health needs, profile). RBAC enforces that PATIENT role has write permissions on own resources. All updates are audit logged with previous and new values. |

### 6.3 Right to Accounting of Disclosures -- 164.528

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Accounting of PHI disclosures | [x] | Audit log tracks all PHI access including provider access to patient data. Each disclosure logged with actor type, action, resource, timestamp, and metadata. Admin panel provides audit log viewer. Users can view their own audit logs (RLS policy: `user_id = current_user_id()`). Query capability with filtering by userId, resourceType, action, date range. |

### 6.4 Right to Request Restrictions -- 164.522

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Patient can restrict uses/disclosures | [x] | Granular consent-based provider access in `ProviderPatient` model with per-permission flags: `canViewBiomarkers`, `canViewInsurance`, `canViewDna`, `canViewHealthNeeds`, `canEditData`. Consent expiration (`consentExpiresAt`). Status management (PENDING, ACTIVE, SUSPENDED, REVOKED, EXPIRED). Patient can revoke access at any time. RLS policies enforce these permissions at database level. |

### 6.5 Right to Deletion -- Data Portability

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Patient can delete their data | [x] | Two deletion options in `settingsController.ts`: (1) `deleteAllData` -- deletes all health data (biomarkers, insurance, health needs, health goals) while preserving account; (2) `deleteAccount` -- deletes entire account with cascade deletion of all related data. Password verification required for account deletion. Both operations audit logged before execution. |

---

## 7. Breach Notification Rule (45 CFR 164.400-414)

### 7.1 Breach Notification Requirements

| # | Requirement | Status | Evidence / Notes |
|---|-------------|--------|------------------|
| 1 | Discovery and Detection Procedures | [~] | Audit logs enable forensic investigation. Failed login monitoring and account lockout provide anomaly detection. No formal breach detection system or SIEM integration. |
| 2 | Notification to Individuals (within 60 days) | [ ] | No documented breach notification procedure. Email system (SendGrid) could be used for notifications. |
| 3 | Notification to HHS | [ ] | No documented HHS notification procedure. |
| 4 | Notification to Media (500+ individuals) | [ ] | No documented media notification procedure. |
| 5 | Breach Risk Assessment Process | [ ] | No formal breach risk assessment methodology documented. |
| 6 | Breach Log / Register | [ ] | No breach log exists. Audit logs provide event data but no dedicated breach register. |

---

## 8. Required Documentation Summary

HIPAA requires that policies and procedures be documented, maintained for 6 years, and made available to workforce members.

| Document | Status | Priority |
|----------|--------|----------|
| Risk Analysis Report | [ ] Not started | **Critical** -- required before production |
| Risk Management Plan | [ ] Not started | **Critical** |
| Security Policies and Procedures | [ ] Not started | **Critical** |
| Privacy Policy (public-facing) | [ ] Not started | **Critical** |
| Incident Response Plan | [ ] Not started | **Critical** |
| Breach Notification Procedures | [ ] Not started | **Critical** |
| Disaster Recovery Plan | [ ] Not started | **High** |
| Business Continuity Plan | [ ] Not started | **High** |
| BAA Register (signed copies) | [ ] Not started | **High** |
| Workforce Training Records | [N/A] Solo founder | Required when workforce grows |
| Workstation Security Policy | [ ] Not started | Medium |
| Data Backup Verification Records | [ ] Not started | Medium |
| System Activity Review Procedures | [~] Audit logs exist, no review schedule | Medium |
| Encryption Key Management Procedures | [~] Implemented in code, not documented | Medium |
| Access Control Documentation | [~] Implemented in code (RBAC, RLS), not formally documented | Medium |

---

## 9. Compliance Roadmap

### Phase 1 -- Technical Controls (CURRENT STATUS: Substantially Complete)

- [x] Application-layer PHI encryption (AES-256-GCM)
- [x] Per-user encryption key derivation (PBKDF2-SHA512)
- [x] Encryption key rotation support
- [x] Row-Level Security (PostgreSQL RLS policies on all 15+ tables)
- [x] JWT authentication with short-lived access tokens (15 min)
- [x] DB-backed refresh token sessions with rotation
- [x] Role-Based Access Control (PATIENT, PROVIDER, ADMIN)
- [x] Consent-based provider-patient access with granular permissions
- [x] CSRF protection (double-submit cookie, timing-safe comparison)
- [x] Comprehensive audit logging (all CRUD + auth events)
- [x] 7-year audit log retention with automated cleanup
- [x] Immutable audit logs (no UPDATE RLS policy)
- [x] Rate limiting (6 named limiters: standard, auth, strictAuth, upload, sensitive, bulk)
- [x] Account lockout after failed login attempts
- [x] Password strength validation (12+ chars, complexity requirements)
- [x] Timing-attack-safe authentication
- [x] Production secret validation (blocks defaults, weak keys, insecure PHI keys)
- [x] Demo account blocked in production
- [x] CORS origin validation
- [x] Data export (patient right of access)
- [x] Data deletion (full data + account deletion)
- [x] Secure cookie configuration (httpOnly, secure, sameSite)
- [x] Input validation at API boundaries
- [x] Error sanitization (no internal details leaked)
- [x] GCS file storage with per-user path isolation and signed URLs

### Phase 2 -- Business & Legal (Target: Q2 2026)

- [ ] Execute GCP BAA
- [ ] Execute Anthropic BAA (or confirm availability)
- [ ] Execute SendGrid/Twilio BAA
- [ ] Designate HIPAA Security Officer
- [ ] Conduct formal Risk Analysis
- [ ] Create Risk Management Plan
- [ ] Write Security Policies and Procedures
- [ ] Write Privacy Policy (public-facing)
- [ ] Create Incident Response Plan
- [ ] Create Breach Notification Procedures
- [ ] Document encryption key management procedures
- [ ] Document access control procedures

### Phase 3 -- Operational Maturity (Target: Q3 2026)

- [ ] Conduct penetration testing
- [ ] Create Disaster Recovery Plan
- [ ] Create Business Continuity Plan
- [ ] Establish backup verification schedule
- [ ] Implement SIEM or breach detection monitoring
- [ ] Establish periodic security evaluation schedule
- [ ] Create workstation security policy
- [ ] Document emergency access procedures
- [ ] Create BAA tracking register

### Phase 4 -- Certification (Target: Q4 2026)

- [ ] SOC 2 Type I audit preparation
- [ ] Independent HIPAA compliance assessment
- [ ] Remediate findings
- [ ] SOC 2 Type I certification

---

## Appendix A: PHI Field Inventory

All PHI fields are encrypted at the application layer using AES-256-GCM with per-user keys before database storage.

**Source:** `backend/src/services/encryption.ts` -- `PHI_FIELDS` constant

| Model | Encrypted Fields | Table |
|-------|-----------------|-------|
| User | firstNameEncrypted, lastNameEncrypted, dateOfBirthEncrypted, phoneEncrypted, addressEncrypted | `users` |
| Biomarker | valueEncrypted, notesEncrypted | `biomarkers` |
| BiomarkerHistory | valueEncrypted | `biomarker_history` |
| InsurancePlan | memberIdEncrypted, groupIdEncrypted | `insurance_plans` |
| ProviderPatient | notesEncrypted | `provider_patients` |
| DNAVariant | genotypeEncrypted | `dna_variants` |
| GeneticTrait | descriptionEncrypted, recommendationsEncrypted | `genetic_traits` |
| HealthNeed | descriptionEncrypted | `health_needs` |
| HealthGoal | descriptionEncrypted | `health_goals` |
| GoalProgressHistory | noteEncrypted | `goal_progress_history` |
| AuditLog | previousValueEncrypted, newValueEncrypted | `audit_logs` |
| ExpenseProjection | serviceType, estimatedCost, notes | `expense_projections` |
| ExpenseActual | serviceType, providerName, billedAmount, insurancePaid, patientPaid, appliedToDeductible, appliedToOop, notes | `expense_actuals` |
| CostAnalysis | claudeResponse, totalProjectedOop, projectedExpensesSnapshot | `cost_analyses` |

---

## Appendix B: Row-Level Security (RLS) Coverage

All tables with user data have PostgreSQL RLS policies enabled. Policies enforce that users can only access their own data, with provider access governed by consent-based permissions.

**Source:** `backend/prisma/migrations/20260107_add_rls_policies/migration.sql`

| Table | RLS Enabled | Policy Type |
|-------|-------------|-------------|
| `users` | Yes | Own record only; admin bypass |
| `sessions` | Yes | Own sessions only; admin bypass |
| `user_encryption_keys` | Yes | Own keys only; admin bypass |
| `biomarkers` | Yes | Own + authorized provider access (view_biomarkers); admin bypass |
| `biomarker_history` | Yes | Via parent biomarker ownership; admin bypass |
| `insurance_plans` | Yes | Own + authorized provider access (view_insurance); admin bypass |
| `insurance_benefits` | Yes | Via parent plan ownership; admin bypass |
| `dna_data` | Yes | Own + authorized provider access (view_dna); admin bypass |
| `dna_variants` | Yes | Via parent dna_data ownership; admin bypass |
| `genetic_traits` | Yes | Via parent dna_data ownership; admin bypass |
| `health_needs` | Yes | Own + authorized provider access (view_health_needs); admin bypass |
| `health_goals` | Yes | Own + authorized provider access; admin bypass |
| `goal_progress_history` | Yes | Via parent goal ownership; admin bypass |
| `provider_patients` | Yes | Both provider and patient can access; admin bypass |
| `audit_logs` | Yes | Own logs (read only); system can insert; admin can delete (retention); immutable (no update) |
| `system_config` | Yes | Admin only |

---

## Appendix C: Rate Limiting Configuration

**Source:** `backend/src/middleware/rateLimiter.ts`

| Limiter | Window | Max Requests | Applied To |
|---------|--------|-------------|------------|
| `standardLimiter` | 15 min | 100 | General API endpoints |
| `authLimiter` | 15 min | 20 | Registration, auth endpoints |
| `strictAuthLimiter` | 15 min | 5 (failed only) | Login endpoint (brute force protection) |
| `uploadLimiter` | 1 hour | 20 | File upload endpoints |
| `sensitiveLimiter` | 1 hour | 10 | Sensitive operations |
| `bulkOperationLimiter` | 1 hour | 30 | Batch creates, imports |

---

## Appendix D: Authentication & Session Security

**Source:** `backend/src/services/authService.ts`, `backend/src/config/index.ts`

| Control | Configuration | Notes |
|---------|--------------|-------|
| Access Token Lifetime | 15 minutes (900 seconds) | Short-lived; requires refresh |
| Refresh Token Lifetime | 7 days | DB-backed; revokable; rotated on use |
| Password Hashing | bcrypt, 12 rounds | Configurable via `BCRYPT_ROUNDS` |
| Password Minimum Length | 12 characters | Plus uppercase, lowercase, number, special char |
| Max Login Attempts | 5 (configurable) | Before account lockout |
| Lockout Duration | 30 minutes (configurable) | After max failed attempts |
| Session Cleanup | Hourly | Expired sessions purged automatically |
| Token Rotation | On refresh | Old refresh token revoked, new pair issued |
| Session Revocation | On password reset | All user sessions revoked |
| Timing Attack Protection | Yes | Constant-time comparison + random delay for non-existent users |
| Email Verification | Required before login | 24-hour token expiry |
| Password Reset Token | 1-hour expiry | Single use; clears on use or expiry |
| Cookie Security | httpOnly, secure (prod), sameSite | Access tokens via HTTP-only cookies preferred |
| CSRF Protection | Double-submit cookie | Timing-safe comparison; 32-byte random tokens |

---

## Summary

**Overall Technical Compliance: Strong**

The OwnMyHealth codebase demonstrates a robust technical security posture with comprehensive encryption, access controls, audit logging, and session management. The application-layer encryption, database-level RLS policies, and immutable audit trail form a solid foundation for HIPAA compliance.

**Primary Gaps (must be addressed before production):**

1. **No signed BAAs** with any third-party vendor (GCP, Anthropic, SendGrid)
2. **No formal Risk Analysis** has been conducted
3. **No written policies** (Security Policies, Privacy Policy, Incident Response, Breach Notification)
4. **No designated Security Officer**
5. **No disaster recovery or business continuity plan**
6. **No breach notification procedures**
7. **No emergency access procedure**

These gaps are administrative and procedural in nature. The technical safeguards are substantially implemented and provide a strong security foundation. Addressing the administrative requirements is the critical path to HIPAA compliance.
