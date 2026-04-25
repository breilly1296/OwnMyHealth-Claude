---
tags:
  - documentation
  - security
  - compliance
  - hipaa
  - workforce
type: hipaa-administrative-safeguard
hipaa-citation: §164.308(a)(3) Workforce Security + §164.308(a)(4) Information Access Management
generated: 2026-04-25
version: 1.0
status: draft
review-cycle: annual + on-hire
next-review: 2027-04-25
---

# Workforce Security SOP — OwnMyHealth

> **Purpose**: this SOP operationalizes the Workforce Security and
> Information Access Management standards at 45 CFR §164.308(a)(3)
> and §164.308(a)(4). It covers the lifecycle of workforce access to
> PHI: provisioning, modification, termination, and ongoing review.
>
> Companion documents:
> [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md) (the policies these
> procedures operationalize),
> [`SANCTION_POLICY.md`](./SANCTION_POLICY.md) (consequences for
> non-compliance), [`CONTINGENCY_PLAN.md § 3.7`](./CONTINGENCY_PLAN.md#37-developer-workstation-loss)
> (workstation-loss recovery), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).
>
> **This SOP is built for the day a second workforce member is added.**
> Today's solo-founder reality is documented honestly in §6 — the
> procedures below are written to be runnable on the first hire, not
> retroactively on the founder.

---

## 1. Scope

This SOP applies to every individual who is, or is about to be,
granted access to OwnMyHealth PHI or production systems. That
includes:

- Founder / sole operator (subject to the §6 honest-framing
  exceptions).
- Future employees (W-2).
- Future independent contractors with access to PHI or production.
- Volunteers, advisors, or interns with PHI access.

It does **not** cover end users (governed by
[`TERMS_OF_SERVICE_DRAFT.md`](./TERMS_OF_SERVICE_DRAFT.md)) or vendor
staff (governed by their BAA).

The principle that runs through every section: **minimum-necessary
access**. A workforce member receives only the access required to do
their assigned work, and no more. Each grant is documented; each
revocation is verified.

---

## 2. Access Provisioning — §164.308(a)(3)(ii)(A) + §164.308(a)(4)(ii)(B)

### 2.1 New-workforce-member onboarding checklist

Run this checklist for every new workforce member with PHI access,
before any production credential is issued. Each item is a hard
prerequisite — none are optional.

| # | Step | Owner | Evidence kept |
|---|---|---|---|
| 1 | **Background check** appropriate to the role (US criminal background; sanctions-list / OIG-LEIE for clinical / billing roles) `[CONFIRM vendor and scope]` | Founder / compliance officer | Scan of completed report, retained 6 years |
| 2 | **NDA / confidentiality agreement** signed | Founder | Signed PDF in operator's encrypted personal store |
| 3 | **HIPAA awareness training** completed (initial) | Founder | Course-completion certificate; minimum content listed in §2.2 |
| 4 | **Sign acknowledgment** of [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md), [`SANCTION_POLICY.md`](./SANCTION_POLICY.md), and this SOP | Founder | Signed PDF / DocuSign equivalent |
| 5 | **Role assignment** documented (PATIENT / PROVIDER / ADMIN at the application layer; GCP-IAM role at the infrastructure layer if applicable) | Founder | Role-grant entry in the workforce roster (§2.4) |
| 6 | **Minimum-necessary review** — list every system the new member will access and the lowest privilege that lets them do the job | Founder | Initial access plan in workforce roster |
| 7 | **Account creation** — application user (with role from step 5), GCP-IAM principal (with least-privilege roles), GitHub team membership (with branch-protection respect), Cloud SQL `psql`-user (only if duties require — most don't) | Founder | Audit-log entries (`logCreate` for app user; GCP audit log for IAM grants) |
| 8 | **Workstation hardening** — full-disk encryption verified, OS up to date, no shared accounts, password manager + MFA installed | New member | Self-attestation form signed during onboarding |
| 9 | **MFA enrollment** on every account that supports it (GitHub, Google Workspace, password manager). `[CONFIRM application-side MFA shipping pre-beta — see RISK_ASSESSMENT.md § 6.1 row 3]` | New member + founder | MFA-enrolled flag in workforce roster |
| 10 | **First-day shadow** — new member walks through [`LOCAL_DEV.md`](./LOCAL_DEV.md), reads [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md), [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) with founder present | Founder + new member | Shadow-session note in workforce roster |

The new member's account is not "active" — i.e., not granted
production access — until every box is ticked.

### 2.2 HIPAA awareness training — minimum content

The training a new workforce member completes before access is
granted must cover:

- What constitutes PHI under HIPAA (45 CFR §160.103) — and specifically
  the 36 PHI fields enumerated in [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md).
- The minimum-necessary standard (§164.502(b)).
- Patient rights (access, amendment, accounting of disclosures,
  restrictions) — see [`PRIVACY_POLICY_DRAFT.md`](./PRIVACY_POLICY_DRAFT.md).
- The breach-notification timeline (§164.404 — 60-day individual
  notice; §164.408 — HHS notice).
- OwnMyHealth-specific controls: encryption, audit logging, RLS, RBAC,
  CSRF, BAA gates for AI processors.
- The sanction policy ([`SANCTION_POLICY.md`](./SANCTION_POLICY.md)) and
  its categories.
- How to report a suspected violation (§7.3 below).

Vendor course or self-built deck — `[CONFIRM choice before first
hire]`. Either way, the founder reviews completion and signs off.

### 2.3 Account creation — least-privilege defaults

| Layer | Default for first non-founder hire | Notes |
|---|---|---|
| Application role | `PATIENT` (no admin) | Upgrade only with documented justification — never default to `ADMIN`. |
| GitHub team | `developers` (read on private repos, write only on a feature-branch model) | Branch protection on `main` enforces review. |
| GCP IAM | `roles/cloudbuild.builds.viewer` + `roles/run.viewer` only | No `Editor` / `Owner`. Add specific roles per duty. |
| Cloud SQL | No `psql` access by default | Application access is via the `omh_app` role; direct DB access requires a documented break-glass justification. |
| Secret Manager | No access by default | Specific secrets granted per duty. |
| Production deploy | Not granted | Deploys flow through CI; humans don't `gcloud run deploy` from a workstation. |

The founder retains all-access by structural necessity. Every grant
to anyone else is itemized in the workforce roster and reviewed in §5.

### 2.4 Workforce roster

The roster lives at `[CONFIRM — recommend `workforce-roster.yaml` as
a sibling of this SOP, encrypted at rest in operator's personal store
since it carries names and access details]`. Schema:

```yaml
- name: <full name>
  role: <employee | contractor | volunteer | advisor>
  start-date: 2026-MM-DD
  application-role: PATIENT | PROVIDER | ADMIN
  github-teams: [...]
  gcp-iam-roles: [...]
  secret-access: [...]
  workstation-fde-verified: true | false
  mfa-enrolled: true | false
  hipaa-training-completed: 2026-MM-DD
  background-check-completed: 2026-MM-DD
  policy-acknowledgment-signed: 2026-MM-DD
  notes: <any access deviation from defaults, with justification>
  end-date: null | 2026-MM-DD  # populated on offboarding
  offboarding-checklist-completed: null | <reference to §4 checklist>
```

Today the roster has one entry: the founder.

---

## 3. Access Modification

### 3.1 Role change procedure

When a workforce member's responsibilities change such that their
access requirements change:

1. **Justification**: the requesting member or their manager (when
   applicable) writes a one-paragraph justification: what work, what
   access needed, what risk is added.
2. **Approver**: founder / compliance officer reviews. The approver
   must not be the same person as the requester unless the requester
   is the founder operating in the structural-bootstrap exception
   (§6).
3. **Apply**: grant the new permission(s) at the smallest scope that
   covers the work. Audit-log every privilege change at the
   application layer; rely on GCP audit log at the infrastructure
   layer.
4. **Document**: append a `notes:` entry to the workforce-roster
   record with date and justification.
5. **Time-bound where possible**: if the new access is for a specific
   project, set a calendar reminder to revoke at project completion
   (§3.2).

### 3.2 Temporary elevated access ("break-glass")

When a workforce member needs access above their default for a
limited time (e.g., debugging a production incident), the procedure is:

1. **Trigger**: a user-impacting incident, a data-recovery task, or a
   vendor-coordinated investigation. **Curiosity is not a trigger.**
2. **Document the reason** in the incident record before access is
   elevated.
3. **Time-bound** the elevation: maximum 4 hours by default, extendable
   only with renewed documented justification.
4. **Audit**: every action taken under the elevation is captured in
   the audit log (`actorType: 'ADMIN'` for application actions; GCP
   audit log for infrastructure actions).
5. **Revoke** the elevation immediately on incident close. Confirm in
   the incident record that the revocation took effect.
6. **Post-review**: include the elevation in the next monthly access
   review (§5.3).

### 3.3 Provider-patient consent management

This SOP does not duplicate the consent-management documentation —
the consent flow is a first-class application feature, not a workforce
SOP. See:

- [`SECURITY_POLICIES.md` access-control section](./SECURITY_POLICIES.md#1-access-control-policy--164312a)
  — written policy.
- [`backend/src/middleware/rbac.ts:205-258`](../backend/src/middleware/rbac.ts)
  — `checkProviderPatientAccess` enforcement.
- [`backend/src/routes/providerRoutes.ts`](../backend/src/routes/providerRoutes.ts)
  — consent-grant / revoke audit events.

Workforce members never act as a "provider" against patient PHI
through the application UI. If a workforce member happens to also be
a clinician treating a patient, they use a separate provider account
with explicit patient consent — they do not use a workforce admin
account to view that patient's PHI.

---

## 4. Access Termination — §164.308(a)(3)(ii)(C)

### 4.1 Offboarding checklist

When a workforce member leaves — voluntary or involuntary — the
offboarding clock starts immediately. The target is **all access
revoked within 24 hours** of the last working day; for involuntary
terminations or suspected-malicious cases, the target is **immediate
revocation before the member is informed** (§4.2).

| # | Step | Target | Verification |
|---|---|---|---|
| 1 | Revoke application user access (set `isActive=false` + run `revokeAllUserTokens(userId)` per [`authService.ts:387`](../backend/src/services/authService.ts)) | Within 1 hour of departure | Audit-log entry with `action='UPDATE'`, `previousValueEncrypted` showing `isActive: true → false` |
| 2 | Remove GitHub team membership | Within 1 hour | GitHub audit log |
| 3 | Revoke GCP IAM principal (or remove from groups) | Within 1 hour | GCP audit log; `gcloud projects get-iam-policy ownmyhealth-prod` shows no remaining grants |
| 4 | Remove Secret Manager access | Within 1 hour | GCP audit log |
| 5 | Revoke any personal-access tokens (GitHub PAT, GCP service-account keys associated with the member) | Within 1 hour | Token-list verification |
| 6 | **Rotate any shared secret the member had access to** — JWT secrets, master encryption key (only if rotation tooling exists — see [`RISK_ASSESSMENT.md § 6.3 row 20`](./RISK_ASSESSMENT.md#63-beta-window)), database passwords, third-party API keys | Within 24 hours | New Secret Manager versions; old versions disabled (not destroyed) for forensics |
| 7 | Remove SSH keys, VPN config, MFA enrollment from any shared system | Within 24 hours | System-by-system review |
| 8 | **Audit-log review** — read every action by the departing member's userId in the prior 90 days; document anomalies | Within 7 days | Review note in workforce roster + sanction log if a violation surfaces |
| 9 | Recover company-owned devices (workstation, hardware MFA tokens) | Within 24 hours | Inventory tick; any non-returned device → §3.2 of [`CONTINGENCY_PLAN.md` workstation-loss path](./CONTINGENCY_PLAN.md#37-developer-workstation-loss) |
| 10 | Remove from communication channels (Slack / email / shared drives) | Within 24 hours | Channel admin tools |
| 11 | Update `workforce-roster.yaml`: set `end-date`, `offboarding-checklist-completed`, leave the historical record intact | Within 24 hours | Diff in encrypted store |
| 12 | Sign-off: founder / compliance officer signs the offboarding record | Within 7 days | Signed entry in roster |

### 4.2 Involuntary / suspected-malicious termination

For terminations that are involuntary or where there is reason to
suspect the member may attempt unauthorized access on departure:

- Steps 1–7 of §4.1 are completed **before** the member is informed of
  the termination.
- Communications channels (steps 10) are revoked simultaneously with
  the announcement.
- Audit-log review (step 8) is expanded to the full tenure of the
  member, not just the prior 90 days.
- Any anomaly meeting the breach threshold triggers
  [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md).
- Any anomaly meeting category C / D under [`SANCTION_POLICY.md § 3`](./SANCTION_POLICY.md#3-violation-categories-and-corresponding-sanctions)
  triggers the corresponding sanction record + (for D) law-enforcement
  referral.

### 4.3 Contractor / vendor termination

When a contractor or vendor relationship ends:

1. Apply §4.1 steps 1–11 to any individual contractor user accounts.
2. Confirm the BAA's data-disposition obligations are met:
   - Vendor returns or destroys PHI per the BAA.
   - Vendor provides a written certification of destruction (most
     BAAs require this on termination).
   - Verify any PHI in vendor-side backups will be purged on the
     vendor's stated retention schedule.
3. Update the BAA inventory ([`SECURITY_STATUS.md § 5`](./SECURITY_STATUS.md#5-baa-inventory))
   to mark the vendor as terminated, with the termination date and
   reference to the destruction certification.
4. Remove vendor-issued credentials on our side (API keys, webhooks,
   IP allow-list entries).

---

## 5. Ongoing Access Review

### 5.1 Quarterly access review

Every quarter (next: **2026-07-25**), the founder / compliance
officer:

1. Reads through the workforce roster.
2. For each member, confirms:
   - The member is still active in the role recorded.
   - Their current access is still the minimum necessary.
   - MFA is still enrolled on every account that supports it.
   - Workstation FDE is still verified (self-attestation refresh).
3. Records the review as a non-violation entry in
   [`SANCTION_POLICY.md § 7`](./SANCTION_POLICY.md#7-sanction-log)
   with `category: review`.
4. Surfaces any "unjustified access" finding as a §3.1 modification
   request — either the access is justified (document the
   justification belatedly) or it is revoked (apply §4.1 selectively).

### 5.2 Annual recertification

Every year (next: **2027-04-25**), the founder / compliance officer:

1. Re-reads this SOP, [`SANCTION_POLICY.md`](./SANCTION_POLICY.md),
   and [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md).
2. For each workforce member, **recertifies** the access in writing:
   "<member name>'s access of <type> is required for <reason> as of
   <date>." A member whose access cannot be recertified gets it
   revoked.
3. Confirms HIPAA awareness training has been refreshed in the prior
   12 months for every member.
4. Updates this SOP based on any review finding.

### 5.3 Audit-log monitoring

Independent of the quarterly + annual cadence, the audit log is
spot-monitored for anomalous patterns. Today this is a manual
spot-check; the alerting target lies on the
[`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md)
detection-policy roadmap (Cloud Logging alerts on `severity=ERROR` +
breach-shape patterns).

Patterns that warrant investigation:

- A workforce account performing PHI reads outside its role's typical
  range (e.g., `ADMIN` reading individual user data without a
  documented incident).
- Repeated failed-login attempts on a workforce account.
- Privilege-escalation attempts blocked by the
  `20260424_prevent_self_role_elevation` trigger.
- Off-hours access by a member whose duties are during business
  hours.
- Access from an unfamiliar IP / location for a member whose access
  is normally local.

Any investigation triggered by these patterns follows
[`SANCTION_POLICY.md § 5`](./SANCTION_POLICY.md#5-investigation-procedure).

---

## 6. Current State — solo founder

OwnMyHealth currently has **one workforce member** (the founder), with
full access to every system. Pretending §§ 2-5 of this SOP are
operative against the founder today would be policy theater. This
section documents the bootstrapping reality honestly, the structural
risks it creates, the compensating controls in place, and the
transition plan for the first additional hire.

### 6.1 Documented structural risks

- **No separation of duties.** The founder authors code, reviews
  code, deploys code, holds production secrets, and reviews their own
  audit logs. This is the "T-02 Insider threat / privilege escalation"
  finding in
  [`RISK_ASSESSMENT.md § 3.2`](./RISK_ASSESSMENT.md#32-t-02--insider-threat--privilege-escalation),
  graded Medium residual after compensating controls.
- **No second-pair-of-eyes review on PRs.** Branch protection on
  `main` is structurally bypassable when the only reviewer is also
  the only contributor. The CI guard (`check-rls-wrappers.sh`,
  `npm audit high+`) catches the most common regressions, but a
  determined author can still merge unsafe code.
- **No rotating MFA against the founder.** The founder sets and
  resets their own MFA. A workstation compromise becomes a system
  compromise.
- **No independent sanction enforcer.** See
  [`SANCTION_POLICY.md § 4`](./SANCTION_POLICY.md#4-solo-founder-applicability--honest-framing).

### 6.2 Compensating controls

The system is designed to limit the **blast radius** of these
structural risks even without separation of duties:

- **Audit logs** ([`auditLog.ts:91`](../backend/src/services/auditLog.ts))
  capture every privileged action with 7-year retention. The founder
  cannot silently bypass them without leaving forensic evidence.
- **Database self-elevation trigger**
  ([`20260424_prevent_self_role_elevation/migration.sql`](../backend/prisma/migrations/20260424_prevent_self_role_elevation/migration.sql))
  blocks role / `is_active` mutation by non-admin sessions at the DB
  layer.
- **CI/CD automation** means production changes are pinned to commit
  SHAs, not to ad-hoc operator commands. The deploy log itself is
  the chain-of-custody.
- **Application-layer RLS wrappers** + the imminent C-8 cutover (DB
  role rotation to NOBYPASSRLS) mean tenant isolation is enforced
  even if an operator forgets to use `withRLSContext`.
- **Master encryption key custody**: the master key is in GCP Secret
  Manager, accessed only by the Cloud Run service account at runtime
  — the founder's workstation does not hold a copy by default. If
  the workstation is compromised, the attacker still needs to
  authenticate to GCP to reach the key.
- **External HIPAA consultant** `[CONFIRM engagement before beta]`
  provides a third-party periodic audit.
- **Quarterly self-audit** against this SOP (§5.1).

### 6.3 Transition plan — what changes when the first additional person is added

When the second workforce member with PHI access arrives:

1. **§§ 2-5 of this SOP become operative as written.** The new
   member is onboarded through the §2.1 checklist; the founder
   acts as the approver.
2. **Two-person review on PRs touching PHI handling.** Branch
   protection on `main` requires one approving review from a
   non-author; this becomes meaningfully load-bearing.
3. **Audit-log review by the second person.** The new member is
   tasked with reviewing 30 days of the founder's audit-log
   entries each quarter — and vice versa. Mutual review is the
   first real separation of duties.
4. **Sanction policy becomes enforceable.** The founder can be
   sanctioned by the second member (and vice versa) per
   [`SANCTION_POLICY.md`](./SANCTION_POLICY.md).
5. **Master encryption key custody splits.** Once a key-rotation
   runbook lands ([`RISK_ASSESSMENT.md § 6.3 row 20`](./RISK_ASSESSMENT.md#63-beta-window)),
   the new master-key version requires both members to participate
   in rotation — neither can rotate alone.
6. **MFA on the founder account is now enforced by the second
   member**: if the founder's MFA fails or is reset, the second
   member is the recovery contact, not the founder themselves.

The transition itself is not free — adding the first person doubles
the workforce-onboarding workload on the founder. Plan for the
transition ahead of an actual hire, not in response to one.

---

## 7. Cross-references and integration points

### 7.1 With the application

- **`isActive` flag** on `User` (set to `false` to disable an
  account, retained for audit-log integrity rather than deleted).
  Used in offboarding step 1.
- **`revokeAllUserTokens(userId)`** at
  [`authService.ts:387`](../backend/src/services/authService.ts) —
  forces immediate logout across all sessions. Used in offboarding
  step 1.
- **Audit-log review tools** — `queryLogs` at
  [`auditLog.ts:426`](../backend/src/services/auditLog.ts) is the
  read path for offboarding step 8 and quarterly review §5.3. Admin
  UI returns ciphertext (does not decrypt `previousValueEncrypted`),
  so offboarding-review of PHI-bearing log values requires a
  documented break-glass session per §3.2.
- **CI guards** — `check-rls-wrappers.sh` and `npm audit high+`
  catch regressions; they are not a substitute for code review by
  a second person, but they raise the floor.

### 7.2 With other HIPAA documents

- **Policy violations** route through
  [`SANCTION_POLICY.md`](./SANCTION_POLICY.md).
- **PHI breach during a workforce incident** routes through
  [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md).
- **Workstation loss** during offboarding (or any time) routes
  through [`CONTINGENCY_PLAN.md § 3.7`](./CONTINGENCY_PLAN.md#37-developer-workstation-loss).
- **Risk-analysis tracking** of structural risks (§6.1) lives in
  [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md).
- **Written policies** that this SOP operationalizes live in
  [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md).

### 7.3 Reporting a suspected violation

Any workforce member — and any user — can report a suspected security
or privacy violation via:

- Email: `[CONFIRM security@ownmyhealth.io]`.
- Direct conversation with the founder / compliance officer (today,
  the founder).
- Anonymous channel: `[CONFIRM — recommend a tip-jar inbox or third-
  party form once workforce > 1; today, anonymity is not feasible at
  workforce-of-one]`.

Good-faith reports are protected by
[`SANCTION_POLICY.md § 8 (Non-retaliation)`](./SANCTION_POLICY.md#8-non-retaliation).

---

## 8. Document Control

| Field | Value |
|---|---|
| Document | WORKFORCE_SECURITY_SOP.md |
| Version | 1.0 |
| Status | Draft (initial) |
| Generated | 2026-04-25 |
| Author | OwnMyHealth founder `[CONFIRM name + role]` |
| Reviewer | `[CONFIRM external HIPAA reviewer if engaged]` |
| Approved by | `[CONFIRM]` |
| Last reviewed | 2026-04-25 (initial) |
| Next scheduled review | 2027-04-25 (annual + on-hire) |
| HIPAA citation satisfied | §164.308(a)(3) Workforce Security; §164.308(a)(4) Information Access Management; §164.308(a)(3)(ii)(C) Termination Procedures |
| Source-of-truth references | [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md), [`SANCTION_POLICY.md`](./SANCTION_POLICY.md), [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md), [`CONTINGENCY_PLAN.md`](./CONTINGENCY_PLAN.md), [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) |
| Retention | 6 years per §164.316(b)(2) (workforce roster + offboarding records) |

---

## Items requiring confirmation

1. Background-check vendor and scope (§2.1 step 1)
2. HIPAA awareness training source — vendor course vs self-built deck (§2.2)
3. Application-side MFA shipping date (§2.1 step 9)
4. Workforce-roster file location and encryption posture (§2.4)
5. External HIPAA consultant engagement decision (§6.2)
6. Anonymous-reporting channel design (§7.3) — required once workforce > 1
7. Author + reviewer + approver names for the formal record (§8)
