---
tags:
  - documentation
  - security
  - compliance
  - hipaa
  - workforce
type: hipaa-administrative-safeguard
hipaa-citation: §164.308(a)(1)(ii)(C) Sanction Policy
generated: 2026-04-25
version: 1.0
status: draft
review-cycle: annual + on-incident
next-review: 2027-04-25
---

# Sanction Policy — OwnMyHealth

> **Purpose**: this document establishes the consequences for workforce
> members who violate the security or privacy policies that protect
> Protected Health Information (PHI). It satisfies the Sanction Policy
> implementation specification at 45 CFR §164.308(a)(1)(ii)(C).
>
> Companion documents:
> [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md) (the policies that
> define a "violation"),
> [`WORKFORCE_SECURITY_SOP.md`](./WORKFORCE_SECURITY_SOP.md)
> (provisioning / termination procedures that interact with
> sanctions), [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md),
> [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md).

---

## 1. Scope

This policy applies to every **workforce member** with access (or
potential access) to OwnMyHealth PHI, regardless of employment
classification:

- Founder / sole operator (today's only workforce member)
- Future employees (W-2)
- Future independent contractors with access to PHI or production systems
- Volunteers, advisors, or interns with PHI access
- Any third-party staff augmentation arrangement

It does **not** apply to:

- End users of the application — their conduct is governed by the
  [Terms of Service](./TERMS_OF_SERVICE_DRAFT.md) and applicable law.
- Business Associate vendor staff — vendors are accountable to OwnMyHealth
  through their BAA, not through this internal policy. A vendor incident
  triggers BAA breach-notification obligations, not internal sanctions.

The policy is **mandatory**. There is no opt-out.

---

## 2. What constitutes a violation

A "violation" is any failure to follow the security and privacy
expectations documented in OwnMyHealth's HIPAA artifact set, including
(but not limited to):

- The written policies in [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md).
- Workforce procedures in [`WORKFORCE_SECURITY_SOP.md`](./WORKFORCE_SECURITY_SOP.md).
- Operational requirements in [`RUNBOOK.md`](./RUNBOOK.md) and
  [`CONTINGENCY_PLAN.md`](./CONTINGENCY_PLAN.md).
- The application security expectations enumerated in
  [`CLAUDE.md`](../CLAUDE.md) ("NEVER use localStorage for sensitive
  data," "all PHI must be encrypted before storage," "every PHI access
  must be audit logged," etc.).
- Any HIPAA Security Rule, Privacy Rule, or Breach Notification Rule
  obligation that applies to OwnMyHealth as a covered entity / business
  associate.

Examples (non-exhaustive):

- Sharing a workforce account password.
- Bypassing the audit log to "spot-check" production data.
- Storing production PHI on a personal device.
- Disabling a security control (e.g., `assertNoBypassRLS`) without
  documented authorization.
- Disclosing PHI to a third party without a signed BAA or patient
  consent.
- Failing to report a suspected security incident promptly.
- Falsifying an audit-log entry, drill report, or sanction record.

---

## 3. Violation categories and corresponding sanctions

Violations are graded by **intent and reasonable foreseeability**, not
by outcome. A near-miss with malicious intent is graded as malicious;
an actual disclosure caused by an honest training gap is graded as
unintentional.

| Category | Definition | Default sanctions |
|---|---|---|
| **A. Unintentional** | Violation caused by a training gap, ambiguous policy, or system design flaw. The workforce member did not know — and could not reasonably have known — that the action violated policy. | (1) Document the incident; (2) corrective training (re-read the relevant policy section, sign acknowledgment); (3) update the policy or training material if the gap was systemic. **No formal warning unless repeated.** |
| **B. Negligent** | The policy was known (or should have been known via standard onboarding) but was not followed. No malicious intent. | (1) Written warning placed in the workforce member's record; (2) mandatory retraining; (3) increased audit-log review of the member's activity for 90 days. **Repeat negligence within 12 months escalates to category C.** |
| **C. Willful** | Deliberate violation, either knowing the policy or with conscious disregard. No evidence of intent to harm or profit, but the choice was conscious. | (1) Suspension of PHI access pending investigation (immediate); (2) written warning + final-written-warning escalation if access is restored; (3) referral to compliance/legal review; (4) termination of employment / contract is a presumptive outcome unless mitigating circumstances apply. |
| **D. Malicious** | Deliberate violation with intent to harm a user, profit personally, defraud OwnMyHealth, or breach PHI confidentiality / integrity / availability. | (1) Immediate revocation of all access; (2) immediate termination of employment / contract; (3) referral to law enforcement (HHS OCR, state AG, FBI as applicable); (4) civil action where appropriate; (5) breach-notification path triggered per [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md). |

The sanction issuer (founder / compliance officer) may upgrade or
downgrade the default sanction one category in either direction with
documented justification. They may not skip categories — i.e.,
unintentional violations cannot escalate directly to malicious-grade
sanctions without first being re-graded.

### Aggravating and mitigating factors

When assigning sanctions, consider:

- **Aggravating**: prior violations, scale of PHI exposed, attempt to
  conceal the violation, harm to a real user.
- **Mitigating**: prompt self-disclosure, good-faith effort to limit
  harm, system design flaw that materially contributed.

---

## 4. Solo-founder applicability — honest framing

OwnMyHealth currently runs with **one workforce member** (the
founder). Sanctions imposed by oneself on oneself have intrinsic
limits — the founder cannot suspend or terminate their own access in
any meaningful sense. Pretending otherwise would be policy theater.

**What this policy still accomplishes today**:

1. **Documentation discipline**: every violation — including violations
   discovered after the fact in self-review — is recorded in the
   sanction log (§7). This creates a paper trail that an external
   auditor or successor can review.
2. **Compensating controls**: the founder operates inside a system of
   controls that do not require self-restraint to function:
   - **Audit logs** (`audit_logs` table, 7-year retention,
     [`auditLog.ts:9`](../backend/src/services/auditLog.ts)) record
     every privileged action. The founder cannot silently bypass
     these without leaving evidence.
   - **Database self-elevation trigger**
     ([`20260424_prevent_self_role_elevation/migration.sql`](../backend/prisma/migrations/20260424_prevent_self_role_elevation/migration.sql))
     prevents the founder from granting themselves additional
     privileges through the application.
   - **CI/CD automation** (`.github/workflows/deploy.yml`) means
     production changes flow through code review (one-person review
     today, but pinned in commits) rather than ad-hoc admin actions.
   - **External HIPAA consultant review** (`[CONFIRM — engagement
     decision before beta]`) provides a periodic third-party audit of
     the founder's compliance with this policy.
   - **Quarterly self-audit against this policy** — see §6 and §7
     "Annual review."
3. **A live framework for the first hire**: the moment a second
   workforce member with PHI access is added, this policy is
   immediately enforceable as written. The founder will then be in a
   position to apply sanctions to others; the policy is not a
   placeholder.

The honest acknowledgment: a determined malicious founder cannot be
restrained by their own sanction policy. The compensating controls
above limit the *blast radius* of such a scenario — an external
auditor or successor can reconstruct what happened from the audit
logs, even if no sanction was ever recorded — but they do not
eliminate the structural risk. This is one of the explicit residual
risks acknowledged in
[`RISK_ASSESSMENT.md § 3.2 (T-02 Insider threat)`](./RISK_ASSESSMENT.md#32-t-02--insider-threat--privilege-escalation).

---

## 5. Investigation procedure

When a potential violation is identified — through self-disclosure, a
user complaint, an audit-log anomaly, or an external report — the
investigator (founder or compliance officer) follows these steps:

1. **Open an incident record** (date, source, summary, suspected
   policy citation). Use the [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md)
   incident-record template if PHI confidentiality, integrity, or
   availability may have been impacted; otherwise a concise text
   record is sufficient.
2. **Preserve evidence**:
   - Audit-log entries for the suspected actor and time window.
   - Any relevant Cloud Logging / structured-log output.
   - Code-change diffs (`git log`, PR history) if the violation
     involves a deployment.
   - Operator notes / chat logs / email if the violation involves
     communication.
3. **Determine scope**: which PHI, how many users, what actions, over
   what time window.
4. **Interview** the suspected workforce member (when applicable —
   today, self-interview / written self-statement). Document.
5. **Categorize** the violation per §3. Document the rationale.
6. **Apply the sanction** per §3. Document the sanction.
7. **Notify** affected parties:
   - Users — only if the breach-notification threshold is met; defer to
     [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md).
   - HHS OCR — same threshold.
   - Law enforcement — for category D violations.
8. **Post-incident review**: identify any policy or training gap
   surfaced by the violation. Update the policy / SOP / training.
   Track follow-ups to closure.

The investigation timeline is **30 days** from detection to sanction
assignment, except where law-enforcement coordination requires a
longer hold (§164.412 delay).

---

## 6. Documentation and retention

Every sanction — and every investigation that concludes no sanction is
warranted — is recorded in the sanction log. Retention: **6 years**
from the date of the record, per §164.316(b)(2).

### 6.1 Sanction log location

The sanction log lives in this document set, in §7 below. Each entry
is appended in chronological order. **Entries are immutable**: a
correction is added as a new entry referencing the original, never by
editing the original.

### 6.2 What each entry contains

| Field | Description |
|---|---|
| `entry-id` | Sequential ID (e.g., `S-2026-0001`) |
| `date-detected` | When the potential violation was identified |
| `date-categorized` | When §3 categorization was assigned |
| `date-sanctioned` | When the sanction took effect |
| `actor` | The workforce member subject to the sanction (role + name; if name is sensitive due to small org size, an internal pseudonym + a sealed name-binding stored separately) |
| `category` | A / B / C / D per §3 |
| `policy-citation` | The specific policy section(s) violated |
| `summary` | One-paragraph factual summary |
| `evidence-references` | Audit-log row IDs, commit SHAs, log timestamps |
| `sanction-applied` | The specific actions taken |
| `mitigating-aggravating` | Factors that informed the categorization |
| `affected-phi` | Number of users / records / categories impacted (if any) |
| `breach-determination` | Whether this met the §164.402 breach threshold; references to `BREACH_NOTIFICATION_PLAN.md` if yes |
| `follow-ups` | Policy / SOP / training updates required |
| `signed-off-by` | Name and date |

---

## 7. Sanction log

> **Status (2026-04-25)**: empty. The system has had one workforce
> member (the founder) since inception, with no recorded violations.
> This section is appended to chronologically as incidents occur.

```yaml
# Template — copy and fill on each new entry, then leave the template
# untouched for the next incident.

# - entry-id: S-2026-0001
#   date-detected: 2026-MM-DD
#   date-categorized: 2026-MM-DD
#   date-sanctioned: 2026-MM-DD
#   actor: <role + name or pseudonym>
#   category: A | B | C | D
#   policy-citation: "<doc> §<section>"
#   summary: |
#     <one-paragraph factual account>
#   evidence-references:
#     - audit_log.id: <UUID>
#     - commit: <SHA>
#     - log-timestamp: <ISO-8601>
#   sanction-applied:
#     - <action 1>
#     - <action 2>
#   mitigating-aggravating: <factors>
#   affected-phi:
#     users: 0
#     records: 0
#     categories: []
#   breach-determination: |
#     <yes/no/inconclusive — and why>
#   follow-ups:
#     - <policy / SOP / training update>
#   signed-off-by: <name + date>
```

### Annual review

Every year (next: **2027-04-25**), the founder / compliance officer
performs a self-audit:

1. Re-read this policy, [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md),
   and [`WORKFORCE_SECURITY_SOP.md`](./WORKFORCE_SECURITY_SOP.md).
2. Walk through 30 days of audit-log entries against the policies
   above. Document any anomaly.
3. Confirm the sanction log is current. Backfill any historical
   incidents that were addressed informally but not documented.
4. Update this policy if any review finding warrants a change.

The annual-review record itself is appended to the sanction log as a
non-violation entry (`category: review`).

---

## 8. Non-retaliation

A workforce member who, in good faith, reports a suspected security or
privacy violation — whether their own, another workforce member's, or
a vendor's — **must not be sanctioned for the act of reporting**.

Specifically:

- Self-disclosure is treated as a strong mitigating factor (§3) — it
  typically downgrades a sanction by one category.
- Reporting another workforce member or a vendor in good faith,
  including reports that turn out to be unfounded after investigation,
  is **never** itself a sanction-able act.
- Retaliation against a good-faith reporter — by anyone in the
  workforce — is itself a **category C (willful)** violation of this
  policy and triggers the corresponding sanctions.

Today, with a single founder, "non-retaliation" reads tautologically.
It is documented here so that the policy is structurally complete on
the day a second workforce member is added — and so a successor
operator inherits the rule, not a gap.

---

## 9. Document Control

| Field | Value |
|---|---|
| Document | SANCTION_POLICY.md |
| Version | 1.0 |
| Status | Draft (initial) |
| Generated | 2026-04-25 |
| Author | OwnMyHealth founder `[CONFIRM name + role]` |
| Reviewer | `[CONFIRM external HIPAA reviewer if engaged]` |
| Approved by | `[CONFIRM]` |
| Last reviewed | 2026-04-25 (initial) |
| Next scheduled review | 2027-04-25 (annual + on-incident) |
| HIPAA citation satisfied | §164.308(a)(1)(ii)(C) Sanction Policy |
| Source-of-truth references | [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md), [`WORKFORCE_SECURITY_SOP.md`](./WORKFORCE_SECURITY_SOP.md), [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md), [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md), [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md) |
| Retention | 6 years per §164.316(b)(2) (sanction log entries) |

---

## Items requiring confirmation

1. Author + reviewer + approver names for the formal record.
2. External HIPAA consultant engagement decision (§4 references this
   as a compensating control; resolve before beta).
3. Whether actor-name pseudonymization (§6.2) is needed for
   small-org privacy — relevant only when workforce > 1.
