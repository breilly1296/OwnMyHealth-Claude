---
tags:
  - documentation
  - security
  - compliance
  - hipaa
type: hipaa-administrative-safeguard
hipaa-citation: §164.400-414 (Breach Notification Rule)
generated: 2026-04-25
version: 1.0
status: draft
review-cycle: annual + post-incident
next-review: 2027-04-25
---

# Breach Notification Plan — OwnMyHealth

> **Purpose**: this document is the operational playbook the on-call
> operator runs when a security event involving PHI is suspected or
> confirmed. It satisfies 45 CFR §164.400–414 (Breach Notification Rule)
> and the corresponding administrative safeguard at §164.308(a)(6).
>
> It is built for **a single founder operating in a pre-beta system**.
> Steps that assume "another person" or "a security team" call that out
> explicitly so the operator doesn't follow process theater. The goal is
> a real plan that protects users, not paper compliance.

---

## 1. Purpose and Scope

### 1.1 What this covers

Every electronic Protected Health Information (ePHI) record handled by
OwnMyHealth — the 12 PHI categories enumerated in
[`RISK_ASSESSMENT.md` § 1](./RISK_ASSESSMENT.md#1-executive-summary),
spanning 36 encrypted columns across 15 Prisma models. Specifically:

| # | Category | Where it lives |
|---|---|---|
| 1 | Identity (name, DOB, phone, address) | `User` table, `*Encrypted` columns |
| 2 | Lab biomarker values + history + notes | `Biomarker`, `BiomarkerHistory` |
| 3 | Insurance plan + member identifiers | `InsurancePlan`, `InsuranceBenefit` |
| 4 | Health goals + progress notes | `HealthGoal`, `GoalProgressHistory` |
| 5 | Health needs / referrals | `HealthNeed` |
| 6 | Expense projections / actuals | `ExpenseProjection`, `ExpenseActual` |
| 7 | AI cost-analysis narratives | `CostAnalysis.claudeResponseEncrypted` |
| 8 | Health profile JSON (conditions / medications / family history) | `User.healthProfileEncrypted` |
| 9 | Provider-patient relationship notes | `ProviderPatient.notesEncrypted` |
| 10 | Lab/SBC source files | GCS bucket + `UserFile` metadata |
| 11 | OAuth tokens for lab integrations | `LabConnection` |
| 12 | DNA / genetic data (deprecated) | `DNAData` family — feature paused, tables present |

This plan also covers PHI that may transiently exist outside the database:
- In application memory during processing
- In Cloud Logging structured logs (redacted by `logger.ts` `SENSITIVE_FIELDS` — known drift in [`PHI_TAXONOMY.md` § 7](./PHI_TAXONOMY.md#7-drift-findings))
- In transit to external processors (Anthropic, GCS, Document AI, SendGrid)
- On the developer workstation during local development

### 1.2 Who follows this plan

- The founder/operator (today, this is the only person)
- Any future workforce member with access to OwnMyHealth systems
- Business associates, by contract reference (the BAAs with Anthropic,
  GCP, and SendGrid include breach-notification timelines)

### 1.3 Regulatory anchors

- **45 CFR §164.402** — definitions (breach, unsecured PHI, discovery)
- **45 CFR §164.404** — individual notification (within 60 days of discovery)
- **45 CFR §164.406** — media notification (if breach affects >500 individuals in a state/jurisdiction)
- **45 CFR §164.408** — HHS Secretary notification (>500: within 60 days; <500: annually)
- **45 CFR §164.410** — business associate notification obligations
- **45 CFR §164.412** — law enforcement delay provisions
- **45 CFR §164.414** — burden of proof requirements
- **45 CFR §164.530(c)** — administrative safeguards reference

---

## 2. Definitions

### 2.1 Breach (§164.402)

> "The acquisition, access, use, or disclosure of protected health
> information in a manner not permitted under [the Privacy Rule] which
> compromises the security or privacy of the protected health information."

Three exclusions exist (§164.402(1)):
1. Unintentional access by a workforce member acting in good faith and
   within the scope of authority — not applicable; no workforce members
   today.
2. Inadvertent disclosure between two authorized persons at the same
   covered entity / BA.
3. The disclosed PHI could not reasonably have been retained.

A presumption of breach attaches to **any** unauthorized acquisition,
access, use, or disclosure of unsecured PHI. The 4-factor risk
assessment in § 3 below is what overcomes the presumption.

### 2.2 Unsecured PHI

PHI that has not been "rendered unusable, unreadable, or indecipherable
to unauthorized individuals" per HHS guidance. **Encryption safe harbor
applies** when:

- Data at rest: encrypted per NIST SP 800-111 (OwnMyHealth uses AES-256-GCM
  via `crypto.createCipheriv` in [`encryption.ts:263-279`](../backend/src/services/encryption.ts) — qualifies)
- Data in transit: encrypted per NIST SP 800-52 (TLS 1.2+ — Cloud Run +
  Google LB serves TLS 1.3, qualifies)
- The encryption key has not been compromised in the same incident

**Critical caveat**: OwnMyHealth's per-user salts are encrypted with a
single master key (`PHI_ENCRYPTION_KEY` env var, stored in GCP Secret
Manager). If the master key is exposed, the safe harbor evaporates for
**all** users simultaneously. See § 8.3.

### 2.3 Discovery (§164.404(a)(2))

A breach is "discovered" on the first day it is known **or should
reasonably have been known** to any person other than the bad actor.
Crucially, this includes:
- The day a suspicious audit-log pattern was first surfaced (even if
  triage hadn't classified it yet)
- The day a business associate notified the covered entity
- The day a third party (researcher, user, journalist) reported it

The 60-day clock for individual notification starts on the discovery
date, not the confirmation date. **Don't pause the clock during
investigation** — open it and run it down concurrently.

### 2.4 Covered Entity vs Business Associate

OwnMyHealth is a **Covered Entity** (a personal health record service
that holds PHI directly from individuals). Anthropic, GCP, and SendGrid
are **Business Associates** under their respective BAAs. Each role has
distinct notification obligations — see § 6.4.

---

## 3. Breach Risk Assessment (the 4-Factor Test)

§164.402(2) requires a written risk assessment to overcome the breach
presumption. **Document all four factors for every Level 2+ incident**,
even if the conclusion is "not a breach."

### Factor 1 — Nature and extent of PHI involved

What identifiers were exposed? What clinical detail? Map to the PHI
categories in § 1.1.

| Severity multiplier | Examples relevant to OwnMyHealth |
|---|---|
| Lower | Email address only (registration metadata) |
| Higher | Name + DOB (Safe Harbor identifiers) |
| Higher | Lab biomarker values + measurement dates (re-identifiable when paired with name) |
| Higher | Insurance member ID + group ID (financial identifier) |
| Highest | Health profile JSON (conditions, medications) — narrative diagnosis-level detail |
| Highest | DNA / genetic data (re-identifiable on its own; lifelong sensitivity) |

Document the exact `*Encrypted` columns and row counts touched. The
audit log's `previousValueEncrypted` / `newValueEncrypted` fields
([`auditLog.ts`](../backend/src/services/auditLog.ts)) carry the
ciphertext snapshot — useful for forensic scope, NOT useful for breach
notification (the PHI was encrypted at the moment of access, so safe
harbor applies if Factor 4 confirms the key was not compromised).

### Factor 2 — Unauthorized person who used or received the PHI

Who accessed it?

| Lower risk → | → Higher risk |
|---|---|
| Another user of OwnMyHealth (covered entity insider) | An external researcher (no obligation) |
| A business associate operating under their BAA | A criminal exfil group |
| An employee of a covered partner | A government request without legal basis |

For a BA-originated incident (Anthropic, GCP, SendGrid), follow § 8.2.

### Factor 3 — Whether PHI was actually acquired or viewed

Was the PHI actually rendered into a usable form, or did it stay encrypted?

- **Database-level access without decryption**: ciphertext only — safe
  harbor may apply IF the master key was not also exposed.
- **Application-layer access with active session**: PHI was decrypted
  for the user-bound request — assume acquired.
- **Audit log access**: encrypted previous/new values; no plaintext
  unless the master key was also exposed.
- **Logged stack traces / error messages**: check `logger.ts`
  `SENSITIVE_FIELDS` for the redaction history; the camelCase drift
  documented in [`PHI_TAXONOMY.md` § 7](./PHI_TAXONOMY.md#7-drift-findings)
  means `*Encrypted` field names may have leaked through structured logs.

### Factor 4 — Extent to which risk has been mitigated

Has the data been recovered, the unauthorized recipient confirmed
destroyed it, the access window confirmed closed?

| Mitigation | Effectiveness |
|---|---|
| Compromised session immediately revoked (`session.deleteMany`) | High — closes the window |
| Compromised user password rotated, all sessions revoked | High |
| Compromised master key rotated + re-encryption job run | Required to restore safe harbor at scale |
| Compromised GCS object deleted from bucket + version history | Medium — bucket logs may still show access |
| Sworn destruction certification from BA / recipient | Medium — best-effort, not enforceable |

### 3.1 The encryption safe harbor — applied to OwnMyHealth

A breach involving only **encrypted ciphertext, where the encryption key
is independently protected**, may not require notification at all.

This applies to OwnMyHealth's PHI columns when:
1. The PHI was AES-256-GCM encrypted at the moment of disclosure
   (true for every `*Encrypted` column when read directly from the DB).
2. The `PHI_ENCRYPTION_KEY` master key was not exposed in the same incident.
3. The per-user salt for the affected users (in `UserEncryptionKey`,
   itself encrypted with the master key) was not exposed in plaintext.

**It does NOT apply when**:
- Plaintext PHI was disclosed (decrypted in application memory, in transit
  to a non-BAA-covered third party, or in logs).
- The master key was compromised — at that point every user's PHI is
  effectively unsecured simultaneously.
- The disclosure happened during a request that legitimately decrypted
  the data (e.g., a malicious admin viewing decrypted records via the
  admin panel).

Document the safe-harbor analysis explicitly in the incident write-up.
"Was encrypted, key not compromised → safe harbor applied" is a valid
conclusion, but it must be written down per §164.414(b).

---

## 4. Incident Classification

Severity levels with concrete examples grounded in OwnMyHealth
infrastructure. **Level determines response timeline and resources**, not
notification obligation — that's decided by the Level 3+ flow in § 6.

### Level 1 — Non-breach security event

Routine defensive activity. Document in audit logs; no human triage
unless it patterns up.

| Example | Source signal |
|---|---|
| Failed login attempt | `auditService.logAuth('LOGIN_FAILED', ...)` (`authController.ts`) |
| Rate-limited request | `RATE_LIMIT_EXCEEDED` response code |
| Blocked CSRF (mismatched / missing token) | `ForbiddenError('CSRF token missing')` from `middleware/csrf.ts` |
| 401 from JWT verify | Standard auth flow; no PHI exposed |
| Validation rejection | Zod 422 — request never reached the controller |
| `assertNoBypassRLS` warning in non-prod | Expected dev-mode log |
| Demo account hitting `blockDemoAdminAccess` | Audit log records the block |

**Action**: log only. Pattern over time is the signal — see Level 2.

### Level 2 — Potential breach (investigate)

Anomalous, but no confirmed PHI exposure yet. Triage within **4 hours**.

| Example | Source signal |
|---|---|
| Failed-login spike against a single account (>5 in 15 min from 2+ IPs) | `LOGIN_FAILED` audit pattern (account lockout fires at 5) |
| `LOGIN_FAILED` cluster across many accounts (credential-stuffing shape) | `email:ip`-keyed rate limiter; spike across distinct emails |
| `assertNoBypassRLS` FATAL in production | `database.ts:200-265` hard-exit (post-2026-04-24 unconditional) |
| Successful login from a never-before-seen geographic region | (Not auto-detected today — see § 5.4 gap) |
| Unusual data-export volume (`EXPORT` audit events) | `auditService.logExport(...)` count |
| Multiple `PARSE_FAILED` upload attempts from one user | `auditService.logAccess('LabReportUpload', ..., 'PARSE_FAILED')` |
| Unexpected admin action on a non-self user | `actorType: 'ADMIN'` audit entry on a foreign userId |
| `npm audit` flips a transitive dep to High at runtime | CI build break (default-on `--audit-level=high`) |
| Cloud Run deploy where `latestReadyRevisionName ≠ latestCreatedRevisionName` | The 2026-04-17 postmortem pattern |

**Action**:
1. Snapshot the relevant audit-log range (`tx.auditLog.findMany` admin context, store output offline).
2. Run the 4-factor assessment (§ 3) to either confirm a Level 3+ breach or document non-breach.
3. Open an incident note in `RUNBOOK.md` even if the conclusion is non-breach — pattern memory.

### Level 3 — Confirmed breach, small scale (1–500 individuals)

PHI of one or a small number of users was acquired by an unauthorized
party, OR a single user's session/credential is confirmed compromised.

| Example |
|---|
| Single user's session token leaked (e.g., XSS in a third-party CSP-allowed style block) |
| Compromised user password used to log in successfully |
| One user's PHI sent to an unauthorized email recipient |
| Provider with revoked consent retained a cached PHI snapshot |
| Misconfigured signed URL leaked to a non-owner |
| Logger redaction drift exposed a specific user's `phoneEncrypted` ciphertext in Cloud Logging — encrypted, but Factor 1 + Factor 3 still need writing up |

**Notification obligation**: yes (60-day individual + annual HHS).
Media notification not required (<500 in a single state).

**Containment timeline**: same 4-hour first-action window as Level 2,
plus a 7-day investigation, plus the 60-day notification clock.

### Level 4 — Confirmed breach, large scale (>500 individuals OR systemic)

| Example |
|---|
| Database exfiltration (full table or significant subset) |
| GCS bucket misconfiguration exposed a backup or PHI batch |
| Master key (`PHI_ENCRYPTION_KEY`) compromised — every user's PHI is at risk |
| Anthropic / GCP / SendGrid notifies us of a breach affecting our records |
| `omh_app` role compromised after the C-8 cutover (post-cutover only) |
| CI/CD pipeline compromise pushing a malicious deploy |
| Workstation compromise where production gcloud creds were live |

**Notification obligation**: 60-day individual + 60-day HHS + media (if >500 in a single state).

**Containment timeline**: rotate everything within 24 hours. The legal
clock is the same 60 days, but the practical clock is "before the press
notices."

---

## 5. Detection Sources

### 5.1 In-app audit log

The single most authoritative detection source. 7-year retention (`RETENTION_DAYS = 2555` in
[`auditLog.ts:9`](../backend/src/services/auditLog.ts)). Every PHI access
is supposed to land here ([`PHI_TAXONOMY.md` § 5](./PHI_TAXONOMY.md#5-audit-log-coverage-gaps)
maps actual coverage). Patterns that warrant Level 2 review:

| Pattern | Query shape |
|---|---|
| Failed-login spike | `WHERE action = 'LOGIN' AND success = false AND createdAt > now() - interval '15 minutes' GROUP BY userId` |
| Cross-user PHI reads from one actor | `WHERE actorType = 'USER' AND resourceType IN ('Biomarker', 'InsurancePlan') AND userId != resource_owner GROUP BY userId` (note: today's RLS makes this hard from app context — once C-8 lands, an app session can never legitimately read a foreign user's row) |
| EXPORT spike | `WHERE action = 'EXPORT' GROUP BY userId, hour` |
| Admin actions outside business hours | `WHERE actorType = 'ADMIN' AND HOUR(createdAt) NOT IN (...)` |
| Many failed CSRF rejections from one IP | (Not in audit_logs today — see § 5.5 gap) |

### 5.2 Cloud Run / Cloud Logging

Backend `logger.error`/`logger.warn` calls land in Cloud Logging with
structured `severity` fields ([`logger.ts:63-67`](../backend/src/utils/logger.ts)).
Specific signals:

- `assertNoBypassRLS` FATAL → production refuses to start. (Post-2026-04-24
  unconditional in prod.) → Level 2.
- `Failed to encrypt audit value` → indicates encryption service health
  problem. → Level 2.
- `Failed to create audit log entry` → audit pipeline is down. → Level 2.
  (HIPAA requires audit trail; loss of audit capability is itself a risk
  to be documented.)
- Cloud Run instance restart loop → potential active exploit. → Level 2.
- Outbound traffic to unexpected hosts (visible in VPC Flow Logs once
  enabled `[CONFIRM]`) → Level 3+.

### 5.3 GCP Security Command Center

`[CONFIRM: Security Command Center is enabled for project ownmyhealth-prod]`.
When enabled, surfaces:
- IAM changes (new principal granted PHI bucket access)
- Public bucket detection (a misconfigured GCS bucket goes from private
  to public)
- VPC anomaly detection
- Misconfigurations in the Cloud SQL instance

A finding here is at minimum Level 2; an active exposure is Level 4.

### 5.4 Supply chain signals

| Source | Signal |
|---|---|
| `npm audit --audit-level=high` (CI) | New high+ advisory in any direct or transitive dependency. CI fails the build automatically. |
| Dependabot alerts (GitHub) | Same advisory database, slower delivery; useful for moderate-severity awareness. |
| Anthropic / GCP / SendGrid security bulletins | Vendor-published advisories |
| `Prisma` major version notices | Active project; major-version regressions affect all DB access |

### 5.5 User reports

A user reporting "I see another user's data" or "I got an email I shouldn't
have" is **always at least Level 3 until ruled out**. Take the report at
face value, snapshot audit logs, then run the 4-factor assessment.

Reports come in via:
- The app's support channel `[CONFIRM: support email / contact form
  routing]`
- Direct email to the founder
- Bug-bounty program — not currently established. Establishing one before
  beta is a remediation item in `RISK_ASSESSMENT.md` § 6.

### 5.6 Business associate notifications

§164.410 requires BAs to notify their CE within **60 days of discovery**
(unless the BAA shortens this). Each of OwnMyHealth's BAs has a
notification obligation:

| BA | Channel | Action on receipt |
|---|---|---|
| Anthropic | Per BAA terms (signed 2026-04-16) | Treat as Level 3 minimum; request scope (which API keys, which time window) |
| GCP | GCP Console security center + email to billing contact | Level 2 minimum; pull GCP audit logs for the affected service |
| SendGrid | `[CONFIRM: BAA executed; notification channel]` | Level 2 minimum; today carries no PHI in templates |

**Important**: a BA's discovery date may predate ours by up to 60 days.
The OwnMyHealth notification clock starts when WE learn of it (the BA's
notification to us), not when the BA discovered it.

### 5.6 Detection gaps (acknowledged)

- No automated cross-user-access pattern detection in app today.
- No alerting policy on Cloud Logging (configured manually in console; not
  declared in IaC).
- No SIEM aggregation across the audit_log + Cloud Logging + GCS access
  logs.
- Geographic / device anomaly detection on login: not implemented.
- Remediation tracked in [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md) § 6.3.

---

## 6. Response Procedures

The four-phase flow that runs concurrent with the 60-day discovery clock.
**The clock does not pause for investigation.**

### 6.1 Immediate (0–24 hours)

#### Step 1 — Contain (within 1 hour of discovery)

Goal: stop ongoing exposure. The "rotate first, ask questions later"
posture is correct here.

| Trigger | Action |
|---|---|
| Compromised single user session | `tx.session.deleteMany({ where: { userId } })` (admin RLS context); force re-login |
| Compromised user password | `updateUserPassword` + `revokeAllUserTokens` (`authController.ts:518`) |
| Compromised JWT secret | Rotate `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` in Secret Manager → all sessions invalidated (verify path) |
| Compromised master key (`PHI_ENCRYPTION_KEY`) | Trigger key-rotation runbook (currently NOT YET DOCUMENTED — see [`RISK_ASSESSMENT.md` § 6.3 item 20](./RISK_ASSESSMENT.md#62-pre-beta--documentation)). At minimum: revoke the current key in Secret Manager, deploy with a new key, run a re-encryption job before app start. **Until the runbook exists, this is a sev-1 documentation gap.** |
| Compromised GCP IAM credential | Revoke the credential in GCP Console; rotate any service account keys |
| Compromised Cloud Run revision | `gcloud run services update-traffic --to-revisions=<previous-known-good>=100` |
| Anthropic API key compromise | Rotate `ANTHROPIC_API_KEY`; verify no Claude calls in flight; verify BAA gate held during the window |
| GCS bucket misconfiguration | `gsutil iam ch -d allUsers:objectViewer gs://<bucket>` (revoke public access); audit recent access logs |

#### Step 2 — Preserve evidence

Snapshot before things change:
- `tx.auditLog.findMany({ where: { createdAt: { gte: <start> } } })` exported to a JSON file with a timestamp in the name. Store offline (workstation, encrypted at rest).
- Cloud Logging export for the affected time window: `gcloud logging read --project=ownmyhealth-prod ... > incident-<id>-logs.json`.
- Cloud SQL point-in-time backup snapshot (if data integrity is suspected) `[CONFIRM: Cloud SQL PITR is enabled and within retention window]`.
- GCS bucket ACL snapshot if a bucket is implicated.
- Any user reports — preserve the original message verbatim.

#### Step 3 — Initial scope estimate

Even rough numbers are useful: how many users could possibly be affected?
What categories of PHI? Which infrastructure component is implicated?
This shapes the rest of the response.

### 6.2 Investigation (1–7 days)

1. **Reconstruct the timeline.** Audit log + Cloud Logging side-by-side.
   Look for the first anomaly that should have triggered the response.
2. **Identify all affected individuals.** Query the audit log by
   `resourceId` / `userId` for every record touched. Encrypt the resulting
   list — it is itself sensitive.
3. **Run the 4-factor assessment** (§ 3). Document each factor's analysis.
4. **Apply the encryption safe harbor analysis** (§ 3.1). Was the
   exposed data ciphertext-only? Was the master key in scope? Write the
   conclusion explicitly.
5. **Determine root cause.** What control failed? Was it a known
   accepted risk in `RISK_ASSESSMENT.md`?
6. **Remediation plan.** What changes are needed to prevent recurrence?

Use `RUNBOOK.md` template for the incident write-up structure. Update
`RISK_ASSESSMENT.md` if a new threat or control gap is identified.

### 6.3 Decision (within 30 days, ideally within 14)

Based on the investigation, **classify the incident as either a
breach or non-breach**:

- **Non-breach**: 4-factor assessment + encryption safe harbor demonstrate
  low probability of compromise. **Document this in writing**;
  §164.414(b) puts the burden of proof on the covered entity. Keep the
  documentation for 6 years.
- **Breach**: continue to § 6.4 notification.

The "low probability" standard from §164.402(2) is intentionally low —
this is not "preponderance of evidence." If the 4-factor analysis is
genuinely uncertain, **default to notification**. Over-notification has
a reputational cost; under-notification is a §164.404 violation.

### 6.4 Notification (within 60 days of discovery)

#### 6.4.1 Individual notification

Required by §164.404. Must reach each affected individual within 60 days
of discovery. Methods (in order of preference):
1. First-class mail to the last known address (the standard — required
   for those with known addresses)
2. Email — only if the individual has agreed to electronic notification
   in advance (not the default for OwnMyHealth)
3. Substitute notice (web posting + media) if 10+ individuals have
   incomplete contact info

Required content (§164.404(c)):
- Brief description of the breach (what happened)
- Description of types of PHI involved (do NOT list the specific PHI;
  list the categories — e.g., "name and lab biomarker values")
- Steps the individual should take to protect themselves (e.g., monitor
  account activity, watch for phishing using stolen names)
- What OwnMyHealth is doing to investigate, mitigate, and prevent recurrence
- Contact information for questions (a toll-free number, email, web
  posting, or postal address)

Template outline at § 7.1.

#### 6.4.2 HHS Secretary notification

- **>500 individuals**: notify HHS contemporaneously with individual
  notification, via [https://ocrportal.hhs.gov/ocr/breach/](https://ocrportal.hhs.gov/ocr/breach/).
- **<500 individuals**: log internally; report annually within 60 days of
  the end of each calendar year via the same OCR portal.

The OCR portal asks for: covered entity name, breach date,
discovery date, type of breach, location of breached data, type of
PHI, individuals affected, safeguards in place, individual notification
sent date, summary of breach, actions taken in response.

#### 6.4.3 Media notification

Required by §164.406 if a single breach affects >500 residents of a
single state or jurisdiction. Notify prominent media outlets serving that
state/jurisdiction. The press release contains the same elements as
individual notification.

OwnMyHealth-specific note: until a real geographic distribution of users
exists, this is a future obligation. Today's pre-beta state has no
500-resident concentration in any single state.

#### 6.4.4 Business associate considerations

If the breach was discovered by us in BA infrastructure (e.g., a Cloud
Run logs leak), the BA notification window is governed by their BAA. We
still own the user notification.

If the BA notified us, we own the user notification clock from the day
of their notification.

### 6.5 Remediation

Beyond the immediate containment in § 6.1:

- Update the failing control. If a code change is required, ship a fix
  with a regression test.
- Update `RISK_ASSESSMENT.md` if a new threat or higher residual risk
  emerged. Re-grade the residual risk.
- Update this Breach Notification Plan if a process gap was exposed.
- Review the audit-log review cadence (currently undefined — see
  [`RISK_ASSESSMENT.md` § 4.3](./RISK_ASSESSMENT.md#43-audit-logging)).
- Re-train (single-operator note: "re-read the playbook" is a valid form
  of solo training; document the date and the lessons learned).

### 6.6 Documentation retention

§164.530(j)(2) requires 6-year retention of breach notification
documentation. Store in:
- `New Project Documents/incidents/` (encrypted local + offsite backup)
- The audit_log table for the technical record
- Cloud Logging exports for forensic detail

The encrypted local-incident folder must NOT be checked into git.

---

## 7. Notification Templates

These are content outlines — the actual letters / emails should be
drafted by counsel for the specific incident. The required elements
below are the minimum.

### 7.1 Individual notification (postal letter outline)

```
[OwnMyHealth letterhead]
[Date — must be within 60 days of discovery]

Dear [recipient],

We are writing to inform you of a security incident that may have
involved your personal health information. Discovery date: [DATE].

WHAT HAPPENED:
[1-2 sentences describing the incident in plain language. Include the
date(s) of the breach and the date of discovery if different.]

WHAT INFORMATION WAS INVOLVED:
The information that may have been involved includes [list categories,
not specific values, e.g., "your name, date of birth, and lab biomarker
results from [date range]"]. We have no evidence at this time that this
information has been [used / disclosed / sold].

WHAT YOU CAN DO:
[Specific actionable steps. Examples:
 - Change your OwnMyHealth password.
 - Monitor your accounts (credit, insurance, healthcare) for unusual activity.
 - Watch for phishing emails or calls referencing this information.
 - Place a fraud alert with the credit bureaus if financial PHI was involved.]

WHAT WE ARE DOING:
[Specific remediation steps. Examples:
 - Closed the vulnerability described above on [DATE].
 - Reset all affected user sessions and required password rotation.
 - Engaged [external forensic firm if applicable].
 - Notified the U.S. Department of Health and Human Services as required.
 - Updated our security controls to prevent recurrence.]

CONTACT US:
For questions about this incident:
 - Email: [TBD — establish a dedicated breach-response email]
 - Phone: [TBD — toll-free number per §164.404(d)(1)(B)]
 - Web: [https://ownmyhealth.io/security-notice] (a permanent posting
        of this notice for substitute-notice eligibility)

We sincerely regret this incident and the concern it may cause.

Sincerely,
[Name + Role]
OwnMyHealth
```

### 7.2 HHS Secretary notification (OCR portal field map)

The OCR breach portal at [https://ocrportal.hhs.gov/ocr/breach/](https://ocrportal.hhs.gov/ocr/breach/)
requires the following fields. Pre-fill them into the incident write-up
during § 6.2 investigation:

| OCR field | OwnMyHealth source |
|---|---|
| Covered Entity name + address | OwnMyHealth, [legal entity address — `[CONFIRM]`] |
| Breach start date | First date of unauthorized access (audit-log forensics) |
| Breach end date | Containment date (§ 6.1 step 1 timestamp) |
| Date of discovery | First-knowledge date |
| Type of breach | Hacking/IT incident, theft, loss, improper disposal, unauthorized access/disclosure, or other |
| Location of breached PHI | Network server, electronic medical record, email, paper, laptop, desktop, other portable electronic device, other |
| Type of PHI involved | Demographic, financial, clinical, other (list categories from § 1.1) |
| Number of individuals affected | From investigation |
| Safeguards in place prior | AES-256-GCM at rest, TLS in transit, RBAC, audit logging — reference [`RISK_ASSESSMENT.md` § 4](./RISK_ASSESSMENT.md#4-controls-assessment) |
| Date individuals notified | From § 6.4.1 |
| Description of breach | 1-2 paragraph narrative |
| Actions taken in response | Containment + investigation + remediation summary |

### 7.3 Media notification (press release outline)

Same elements as 7.1 but written for general audience:
- Headline: "OwnMyHealth Notifies Users of Security Incident"
- 1-2 paragraph factual summary
- Affected categories of PHI (not specific values)
- Number of individuals affected (rounded — exact count not required)
- What we are doing
- Contact info for affected individuals
- Date of incident, date of discovery, date of notification

Distribute to: AP regional, major newspapers in the affected
state/jurisdiction, healthcare-trade press if appropriate.

---

## 8. Special Considerations for OwnMyHealth

### 8.1 Solo founder operational reality

There is one person. There is no second-pair-of-eyes, no on-call
rotation, no separation of duties. This is a structural risk acknowledged
in [`RISK_ASSESSMENT.md` T-02](./RISK_ASSESSMENT.md#32-t-02--insider-threat--privilege-escalation).

Practical implications for breach response:
- **No redundancy.** If the founder is unavailable (illness, travel, OS
  attack on their machine), the incident response is paused. Mitigation:
  pre-document containment steps so a temporary delegate could execute
  them.
- **Backup decision-maker `[CONFIRM]`** — name a trusted advisor (legal
  counsel, technical advisor, or CISO-as-a-service) who can be reached
  in an emergency and has prior context. Document their contact info
  here.
- **No internal review of decisions.** The 4-factor assessment is run by
  one person. To compensate: bias toward over-notification when uncertain,
  and consult external counsel before any "non-breach" classification on
  Level 3+ events.
- **No 24/7 coverage.** Incidents discovered at 3 AM may have a many-hour
  containment delay. Cloud Logging alert policies (`RISK_ASSESSMENT.md`
  § 6.3) compress this window.

### 8.2 Anthropic as Business Associate — breach scenarios

The Claude API is a primary BA. Possible breach paths:

1. **Anthropic's own infrastructure compromise** — covered by the BAA's
   notification clause. We act on their notification (§ 5.6 / § 6.4.4).
2. **Our API key leaked → an attacker calls Claude with our key, exfiltrating
   their own prompts.** Not a PHI breach (their prompts), but a billing
   risk. Rotate the key, audit `aiCostTracker` for the affected window.
3. **Our API key leaked + an attacker accesses Claude's logs of OUR past
   prompts** — depends on Anthropic's log-retention policy under BAA.
   Treat as Level 4 until disproven; rotate the key, request log
   retention info from Anthropic, run the 4-factor on the prompts that
   would have been retrievable.
4. **Prompt injection causes Claude to disclose another user's data in
   the response we receive** — `stripPHIFromText` defense-in-depth on
   responses ([`claudeExtraction.ts`](../backend/src/services/claudeExtraction.ts))
   provides partial protection, but text-only echo of a quoted PHI string
   would still be in our memory. Treat as Level 3 if confirmed.
5. **Anthropic mistakenly trains a model on BAA-protected prompts** — a
   policy/contract violation that triggers the BAA's breach clause.
   Notification is on Anthropic; we relay.

Cross-reference: T-05 in `RISK_ASSESSMENT.md`.

### 8.3 Encryption safe harbor — the master-key dependency

This is the single biggest concentration of risk. Per § 2.2, the safe
harbor requires that the encryption key has not been compromised in the
same incident. OwnMyHealth's architecture:

```
PHI_ENCRYPTION_KEY (master, env var, Secret Manager in prod)
       │
       │  PBKDF2-SHA512, 600k iter, per-user salt
       ▼
User-specific derived key
       │
       │  AES-256-GCM
       ▼
Encrypted PHI columns
```

If the master key leaks:
- **Every** user's per-user key can be re-derived
- **Every** ciphertext column is decryptable
- **Every** backup ever taken is decryptable
- The safe harbor evaporates **for everyone simultaneously**

**Implications for breach response**:
- Treat any incident that touches the Secret Manager / `.env` /
  workstation memory / CI/CD secret context as automatically Level 4
  pending master-key audit.
- If master-key compromise is suspected, the response is not just
  rotation — it's rotation **plus** re-encryption of every PHI column
  with the new key, plus re-issuance of every per-user salt. This is a
  multi-hour offline operation that has not yet been runbook'd — see
  [`RISK_ASSESSMENT.md` remediation item 20](./RISK_ASSESSMENT.md#63-beta-window).
- Until the key-rotation runbook exists, "master key may have been
  exposed" is an existential incident.

### 8.4 Cloud SQL access

Production database access today: only the Cloud Run service account
plus `[CONFIRM: list of human IAM principals with Cloud SQL Client / Editor /
Admin role on project ownmyhealth-prod]`.

A breach response may require querying the database directly (see § 5.1
audit-log queries). Establish in advance:
- Which IAM principals have read access (Cloud SQL Viewer)?
- Which have decryption capability (i.e., access to `PHI_ENCRYPTION_KEY`
  in Secret Manager)?
- What's the audit trail when a human runs an ad-hoc query?

The **least-privilege principle** says human IAM principals should have
read-only access by default and elevate (with audit) only when required.
Today's solo-founder reality is that this is one principal with full
access; document it and accept it as a Risk Assessment T-02 residual.

### 8.5 PHI in logs — residual risk

Even with `logger.ts` `SENSITIVE_FIELDS` redaction, residual PHI in logs
is plausible:
- Camel-vs-lowercase drift on `*Encrypted` field names (documented in
  [`PHI_TAXONOMY.md` § 7](./PHI_TAXONOMY.md#7-drift-findings))
- Stack traces from Prisma / Anthropic SDK that include unredacted args
- Free-text error messages containing user-supplied content that wasn't
  routed through `stripPHIFromText`

If a Level 2 incident reveals PHI in Cloud Logging:
- **Cloud Logging retention is configurable** `[CONFIRM: prod project's
  log retention period]`. Shortening retention does NOT cure a past
  exposure but bounds future exposure.
- **Treat as Level 3 if the master key is intact** (the data is unencrypted
  text in the log line, so encryption safe harbor doesn't apply to the
  log copy even though it does to the DB copy).
- The fix for the underlying drift is in
  [`RISK_ASSESSMENT.md` § 6.1 item 8](./RISK_ASSESSMENT.md#61-pre-beta-must-close-before-live-phi).

---

## 9. Training and Testing

### 9.1 Annual tabletop exercise

Even as a solo operator, walk through a scenario from start to finish.
Suggested rotation:

| Year | Scenario |
|---|---|
| 2026 | Master key compromise via leaked workstation `.env` |
| 2027 | Anthropic notifies of a 2-week log-retention misconfiguration |
| 2028 | Credential-stuffing attack succeeds against one beta user |
| 2029 | Cloud Run revision-pinning regression exposes a stale BAA-disabled build to production |
| 2030 | GCS bucket misconfigured to public for 4 hours |

For each tabletop:
1. Set a 30-minute timer.
2. Walk through § 6 steps for the scenario.
3. Identify what would block you (missing runbook, missing tooling).
4. File the gaps as remediation items in `RISK_ASSESSMENT.md`.

Document each tabletop in `New Project Documents/incidents/tabletop-<date>.md`
(local + offsite, NOT in git).

### 9.2 Post-incident review

After every Level 2+ incident, even if classified non-breach:
- Update this plan if a step proved wrong, slow, or missing.
- Update `RISK_ASSESSMENT.md` if a new threat surfaced or residual risk shifted.
- Update `RUNBOOK.md` if a containment step needs to be operationalized.
- Update `KNOWN_ISSUES.md` if a code-level vulnerability was the root cause.

### 9.3 Infrastructure-change re-testing

When any of these change, re-validate the corresponding parts of this plan:
- Audit-log schema or retention period
- Encryption library or key derivation parameters
- BA list (new vendor signing a BAA, or a vendor BAA termination)
- Hosting platform (anything that changes detection sources)
- Headcount (first hire — workforce-member training becomes a real obligation)

---

## 10. Document Control

| Field | Value |
|---|---|
| Document | BREACH_NOTIFICATION_PLAN.md |
| Version | 1.0 |
| Status | Draft (initial) |
| Generated | 2026-04-25 |
| Author | OwnMyHealth founder/security lead `[CONFIRM: name + role for the formal record]` |
| Reviewer | `[CONFIRM: external HIPAA reviewer if engaged]` |
| Approved by | `[CONFIRM]` |
| Last reviewed | 2026-04-25 (initial) |
| Next scheduled review | Annual: **2027-04-25** + after every Level 2+ incident |
| HIPAA citations satisfied | §164.400, §164.402, §164.404, §164.406, §164.408, §164.410, §164.412, §164.414, §164.530(j) |
| Source-of-truth references | [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md), [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md), [`SECURITY_STATUS.md`](./SECURITY_STATUS.md), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`RUNBOOK.md`](./RUNBOOK.md) |

---

## Items requiring confirmation

The following claims and TBDs in this document need operator action
before the plan is operationally complete:

1. **Backup decision-maker** named with contact info (§ 8.1). Required —
   without this the plan has a single point of failure.
2. **Dedicated breach-response email and phone number** (§ 7.1).
   Required — §164.404(d)(1)(B) mandates contact info in the
   notification.
3. **Permanent web URL for substitute notice** (`https://ownmyhealth.io/security-notice` placeholder).
4. **Cloud SQL human IAM principal list** (§ 8.4). Required — defines
   the human attack surface.
5. **GCP Security Command Center enabled** (§ 5.3). Detection coverage gap if not.
6. **Cloud SQL backup PITR retention window** (§ 6.1 step 2).
7. **Cloud Logging retention period for prod** (§ 8.5).
8. **VPC Flow Logs enabled for prod** (§ 5.2).
9. **SendGrid BAA executed and dated** (§ 5.6).
10. **Author + reviewer + approver names** for the formal record (§ 10).
11. **Legal entity address for OCR notification** (§ 7.2).
12. **Master key rotation runbook authored** (§ 6.1, § 8.3) — pre-beta blocker.
