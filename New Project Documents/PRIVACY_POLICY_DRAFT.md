---
tags:
  - documentation
  - privacy
  - hipaa
type: hipaa-privacy-notice
hipaa-citation: §164.520 (Notice of Privacy Practices)
status: DRAFT — REQUIRES LEGAL REVIEW BEFORE PUBLICATION
generated: 2026-04-25
version: 0.1
---

# OwnMyHealth — Privacy Notice

> ## ⚠️ This is a DRAFT
>
> This document is an internal draft of a HIPAA-compliant Notice of
> Privacy Practices. It must be reviewed and approved by qualified
> healthcare-privacy counsel before publication. Sections requiring legal
> input are marked **[LEGAL REVIEW]**. Items requiring operator
> confirmation are marked **[CONFIRM]**.
>
> Do not link this draft from the production application. The
> public-facing version of this document, once approved, lives at
> `https://ownmyhealth.io/privacy` `[CONFIRM]`.

---

**Effective date:** `[CONFIRM — set on publication]`
**Last updated:** `[CONFIRM — set on publication]`

This notice describes how medical and personal information about you
may be used and disclosed and how you can get access to this
information. **Please review it carefully.**

---

## In plain language

OwnMyHealth helps you keep your own health records — lab results,
medications, insurance plans, expenses, and notes — in one secure
place. We treat your health data the way the law requires us to: it
belongs to you, we use it only to serve you, and we tell you when
anything changes.

This notice explains:

1. What health information we collect
2. How we use it
3. How we protect it
4. Who we share it with (and what they can see)
5. The rights you have over your own data
6. What happens if something goes wrong

If anything in this notice is unclear, contact us at
**`[CONFIRM — privacy@ownmyhealth.io or equivalent]`**. We will respond
within 5 business days.

---

## 1. What we collect and why

### 1.1 What you give us

When you use OwnMyHealth, you may provide:

| Category | Examples | Why we need it |
|---|---|---|
| Account | Email, password (hashed) | To log you in and recover access |
| Identity | Name, date of birth, phone, address | To label your record and (optionally) print export documents |
| Health profile | Conditions you have, medications you take, family history | To personalize the AI guidance you ask for |
| Lab results | Biomarker values, units, dates, lab names | The core feature — tracking your own labs over time |
| Lab files | PDF lab reports you upload | We extract the values; you can re-download the original |
| Insurance | Plan name, member ID, deductible, copays | The plan-comparison and cost-tracking features |
| Medical expenses | Service type, cost, provider name, in-network flag | Cost-projection and out-of-pocket tracking |
| Goals & needs | Health goals, progress notes, action items | Goal tracking |
| Provider relationships | Patient↔provider links you authorize | The provider-collaboration feature |
| Lab connection tokens | OAuth tokens for Quest Diagnostics or similar (when enabled) | To pull labs automatically once you authorize |

### 1.2 What we collect automatically

- **Login activity**: time, IP address, device user-agent. We use this for security (detecting suspicious logins) and audit logs.
- **Usage logs**: which pages you visited, errors you encountered. We use these to fix bugs. **We do not log your health data in these.**
- **Cookies**: a session cookie to keep you logged in, a CSRF cookie to prevent attacks. We do not use advertising or third-party tracking cookies.

### 1.3 What we do NOT collect

- Social Security numbers
- Insurance claims directly from your insurer (you can enter what you receive, but we do not pull claims)
- Genetic data, except in the deprecated DNA feature which is currently paused
- Anything we don't use — we follow the HIPAA principle of "minimum necessary"

---

## 2. How we use your health information

We use your information for these purposes:

### 2.1 Treatment

We do not provide medical care. OwnMyHealth is **not a healthcare provider**. We help you organize information about care you receive elsewhere. If you choose to share your record with a provider through the platform, that provider may use the information for their treatment of you, but they do so as a separate covered entity.

### 2.2 Payment

Where you connect insurance information, we use it to project your out-of-pocket costs and explain what your plan covers. We do not file insurance claims.

### 2.3 Health Care Operations

- Showing you trends in your own data
- Reminding you of goals you set
- Improving the platform (we use **anonymized, aggregated data only**, never individual records, for product analytics) `[LEGAL REVIEW: confirm aggregation methodology meets de-identification standard]`

### 2.4 AI-powered guidance (transparency)

OwnMyHealth offers AI features that produce **educational** content based on your data:
- "Help me understand this lab result"
- "Compare my insurance plans"
- "Suggest cost-savings on this expense"

These features send your relevant data to **Anthropic**, our AI provider, under a signed Business Associate Agreement. Before sending, we:

- **Strip personal identifiers** (names, dates, SSN-shaped numbers, addresses, phone numbers, email addresses) from the input
- **Send only text**, never your original PDF documents
- **Re-scrub** the AI's response to remove any identifiers it might have echoed back
- **Encrypt and audit-log** every AI call

You can find which Claude model handled a given response in your data export. AI responses are **educational only and are not medical advice**. We display this disclaimer with every AI response.

If you do not want any of your data sent to AI services, the AI features in OwnMyHealth are optional. The platform works without them.

### 2.5 Required by law

We will disclose your information when required by law (court order, subpoena, public-health reporting). We will tell you about any such disclosure unless legally prohibited from doing so. **[LEGAL REVIEW]**

---

## 3. How we protect your information

### 3.1 Technical safeguards in plain language

| What | How |
|---|---|
| **Encrypted at rest** | Every health field in our database is encrypted with AES-256-GCM. Each user has their own derived key, so a database leak does not expose any user's data without separately compromising our master key. |
| **Encrypted in transit** | Every connection between your browser and our service uses TLS 1.3 (the same encryption banks use). |
| **Access controls** | Only you can see your own health data. Providers see your data only after you accept their consent request, and only the specific categories you allow. We log every access. |
| **Authentication** | Passwords must be 12+ characters with complexity. Failed logins are rate-limited and lock the account after 5 attempts. We are adding multi-factor authentication before public beta. `[CONFIRM: MFA target date]` |
| **Audit logs** | We record every access to your data — by you, by a provider, by an admin, by an AI service. We keep these logs for 7 years per HIPAA requirements. |
| **Backup and recovery** | Our database is backed up daily by Google Cloud SQL. Backups are encrypted. We test our recovery procedure regularly. `[CONFIRM: backup retention window]` |

### 3.2 Where your data lives

All OwnMyHealth services run on **Google Cloud Platform** in the United States `[CONFIRM: us-central1 region]`. Google operates these data centers under their HIPAA Business Associate Agreement with us.

### 3.3 What we cannot fully protect against

We are honest with you:
- A determined attacker who compromises your own password and machine can access your data through your account. Use a strong password and enable MFA when we offer it.
- Cloud infrastructure providers (Google, in our case) have their own security incidents from time to time. We monitor their security advisories and act quickly when one applies.
- AI services (Anthropic, in our case) have their own retention policies for the data we send them. We send the minimum necessary, but the data does briefly transit through their systems.

If a security incident affects your data, we will notify you within **60 days of discovery** (HIPAA requirement) and explain what happened, what was affected, and what you should do. See section 9.

---

## 4. Your rights over your own data

You have these rights under HIPAA, and OwnMyHealth provides each of them through the application or by request:

### 4.1 Right to access (§164.524)

You can download every piece of health information we have about you, in a structured JSON format, at any time. From the **Settings → Export Data** page in the app. The export includes:

- Your profile (name, date of birth, contact info)
- All biomarker readings and history
- All insurance plans and benefits
- All health goals and progress
- All health needs
- All expense projections and actuals
- All AI-generated cost analyses (with the AI provider's response)
- Your provider relationships and consent flags
- Your uploaded lab files (the file metadata; the original PDFs can be downloaded separately from the Files page)
- Your notification preferences

If you need this in a different format (PDF, CSV), contact us. **[LEGAL REVIEW: confirm response timeline meets 30-day standard]**

### 4.2 Right to amendment (§164.526)

If anything in your record is wrong, you can edit it directly in the app for most categories. For data we cannot directly edit (audit logs, AI-generated content), you may request an amendment by contacting us. **[LEGAL REVIEW: amendment process workflow + acceptance criteria]**

### 4.3 Right to an accounting of disclosures (§164.528)

You can request a list of every disclosure of your PHI for the past 6 years. Today, this is most of:
- Your own logins (technically not a disclosure, but visible)
- Provider access events you authorized
- AI processing events (Anthropic, with disclosure type and timestamp)
- Any law-enforcement disclosures (none today)

The accounting is available on request. We are working on a self-service version of this in the app. **[CONFIRM: target date]**

### 4.4 Right to request restriction (§164.522)

You can ask us to restrict certain uses of your PHI. We will agree where reasonable. We must agree to a request to restrict disclosure to a health plan if the disclosure relates to a service you paid for in full out of pocket. **[LEGAL REVIEW]**

### 4.5 Right to confidential communications (§164.522(b))

You can ask us to communicate with you a specific way (e.g., email only, no phone calls). We will accommodate reasonable requests.

### 4.6 Right to a paper copy of this notice

Even though OwnMyHealth is a digital service, you may request a printed copy of this notice at any time. We will mail it within 30 days of your request.

### 4.7 Right to delete your data

You can delete your health data, your account, or both, at any time:

- **Delete data, keep account**: removes all health records but keeps your login. Useful if you want a fresh start.
- **Delete account**: removes everything — health records, account, sessions, uploaded files.

Both actions require your password. Both are **immediate and irreversible** in our active systems. Backups will retain a copy for our backup retention window (`[CONFIRM]`), after which the data is permanently gone.

### 4.8 Right to file a complaint

You can file a complaint with us by contacting **`[CONFIRM — privacy@ownmyhealth.io or equivalent]`**. You can also file a complaint with the U.S. Department of Health and Human Services Office for Civil Rights at **[https://www.hhs.gov/ocr/complaints/](https://www.hhs.gov/ocr/complaints/)**. We will not retaliate against you for filing a complaint.

---

## 5. Who we share your data with

### 5.1 Business Associates (HIPAA-covered)

These services have signed Business Associate Agreements with us, meaning they are bound by HIPAA the same way we are:

| Vendor | What they do | What they see |
|---|---|---|
| **Google Cloud Platform** `[CONFIRM]` | Hosts our application, database, and file storage | All your encrypted PHI (encrypted at rest by us; encrypted at rest again by Google's infrastructure) |
| **Anthropic** | Powers our AI guidance features | Only the specific text we send for a specific question, with personal identifiers stripped before sending. Anthropic does NOT receive raw PDF files, names, or other identifiers. |
| **SendGrid (Twilio)** `[CONFIRM]` | Sends verification and password-reset emails | Your email address (used for routing); no other PHI is in our email templates |

We do not currently use any other Business Associates.

### 5.2 With your authorization

Any disclosure of your PHI that is NOT for treatment, payment, or health-care operations requires your written authorization. This includes:

- Marketing communications using your PHI
- Sale of your PHI (we will never do this — see § 6)
- Use of your PHI for research (we have no research program today)
- Disclosure of psychotherapy notes (we do not collect these)

You can revoke an authorization at any time, in writing. The revocation does not undo disclosures we already made under the original authorization.

### 5.3 Law enforcement, public health, judicial

We may disclose PHI without your authorization in narrow circumstances permitted by HIPAA: court orders, subpoenas, public-health reporting, abuse reporting, etc. We will tell you when such a disclosure is made, unless we are legally prohibited from doing so. **[LEGAL REVIEW]**

### 5.4 What we will NEVER do

- We will never sell your data.
- We will never use your data for advertising or marketing without your written authorization.
- We will never share your data with insurers or employers without your written authorization.
- We will never use your data to train AI models. The AI features send your data **for inference only** — Anthropic's BAA prohibits using OwnMyHealth user data for training their models. `[LEGAL REVIEW: confirm clause text in Anthropic BAA]`

---

## 6. Uses requiring your written authorization

The following uses require your specific, written authorization — we will not make these disclosures by default:

1. Marketing communications (other than information about OwnMyHealth's own services to existing users)
2. Sale of your PHI (we don't do this; HIPAA requires us to list it for completeness)
3. Most uses of psychotherapy notes (we don't currently collect these)
4. Research using identifiable PHI (we don't have a research program)

---

## 7. AI processing — details

We disclose this here in greater detail because it is the most novel
processing OwnMyHealth performs.

### 7.1 What AI features exist

- **Biomarker guidance**: explains what a single lab result means in plain language, with educational context
- **SBC extraction**: when you upload an insurance "Summary of Benefits and Coverage" PDF, AI extracts the structured fields
- **Cost analysis**: summarizes your projected out-of-pocket costs and identifies optimization opportunities
- **AI chat (Health Guide)**: a conversational assistant that has read-only access to your structured profile

### 7.2 What is sent to Anthropic

For each AI call, we send:
- The specific question or prompt you triggered
- The minimum data needed to answer (e.g., one lab result for biomarker guidance, your projected expenses for cost analysis)
- Personal identifiers stripped: names, dates, SSN-shaped numbers, ZIP codes, addresses, phone numbers, email addresses

We do NOT send:
- Your original uploaded PDF files
- Your name, date of birth, address, or phone number
- Data unrelated to the specific question

### 7.3 What Anthropic may do

Under their Business Associate Agreement with us:
- Process the data to generate the AI response
- Store the request transiently for system stability
- Use the data **for inference only** — NOT to train future Anthropic models `[LEGAL REVIEW]`

Anthropic's own privacy practices apply to this processing. They are
bound by HIPAA via the BAA they signed with us.

### 7.4 What we do with the response

- Run the response through a secondary identifier-stripping pass
- Display it to you in the app
- Save it (encrypted) to your record so you can review it later
- Audit-log the disclosure

### 7.5 Your control

The AI features are optional. You can use OwnMyHealth without ever invoking them. They are not required to record, view, or export your own data. If you have already used the AI features and want the AI-generated content removed from your record, the **Delete data** action removes all of it.

---

## 8. Data retention and deletion

| Data | We keep it for |
|---|---|
| Your active health records | As long as you have an account |
| Audit logs | 7 years (HIPAA requirement) |
| Sessions / login tokens | Up to 7 days (refresh tokens) or 15 minutes (access tokens) |
| Backups | `[CONFIRM: Cloud SQL backup retention window]` |
| Deleted account data | Removed from active systems immediately on deletion request; removed from backups within the backup retention window |
| AI-generated content (cost analyses, guidance text) | Same as your account — until you delete it or your account |

When you delete your account, we cannot recover the data even if you ask
us to within minutes of the deletion. Please export your data first if
you might want it later (Settings → Export Data).

---

## 9. Breach notification

If your PHI is involved in a confirmed breach, we will:

1. **Notify you within 60 days** of when we discovered the breach (HIPAA requirement).
2. Tell you what happened, when, what data was involved, and what we are doing about it.
3. Tell you what specific steps you can take to protect yourself (e.g., change your password, monitor accounts).
4. Provide a contact for questions.
5. Notify the U.S. Department of Health and Human Services as required.

For breaches affecting more than 500 people in a single state, we will also:
- Notify prominent media in that state within 60 days
- Notify HHS within 60 days (immediate notification, not annual)

For breaches affecting fewer than 500 people in any state, the HHS notification is annual.

Our complete Breach Notification Plan is documented internally and reviewed annually.

---

## 10. Children under 13

OwnMyHealth is **not directed at children under 13** and we do not knowingly collect health data from children under 13. If you become aware that a child under 13 has registered an account, contact us and we will delete it. **[LEGAL REVIEW: confirm COPPA stance and minimum age policy]**

For users 13–17, parental consent may be required by state law. **[LEGAL REVIEW]**

---

## 11. Changes to this notice

We may update this notice. When we do:

- The "Last updated" date at the top changes
- We post the new version in the app and at `https://ownmyhealth.io/privacy` `[CONFIRM]`
- For material changes (e.g., new categories of data, new business associates), we notify you by email and require acknowledgement at next login

A material change is never retroactive. Information you provided under
a prior version of this notice continues to be governed by the version
in effect when you provided it.

---

## 12. How to contact us

**For privacy questions, requests, or to file a complaint:**

- **Email:** `[CONFIRM — privacy@ownmyhealth.io]`
- **Web:** `[CONFIRM — https://ownmyhealth.io/privacy/contact]`
- **Mail:** `[CONFIRM — legal entity name + address]`

**Privacy Officer / Compliance Contact:**

- `[CONFIRM — name + title]`
- `[CONFIRM — direct email]`

We will respond to privacy requests within 30 days, and to questions
within 5 business days.

You can also contact the U.S. Department of Health and Human Services
Office for Civil Rights at:
- [https://www.hhs.gov/ocr/complaints/](https://www.hhs.gov/ocr/complaints/)
- 1-800-368-1019
- TDD: 1-800-537-7697

---

## Document control (internal — not for public publication)

| Field | Value |
|---|---|
| Document | PRIVACY_POLICY_DRAFT.md |
| Version | 0.1 (initial draft) |
| Status | **DRAFT — REQUIRES LEGAL REVIEW BEFORE PUBLICATION** |
| Generated | 2026-04-25 |
| Author | OwnMyHealth founder/security lead `[CONFIRM]` |
| Legal reviewer | **[REQUIRED — engage healthcare-privacy counsel before publication]** |
| Approved for publication | **[NOT YET — see above]** |
| Effective date | **[SET ON PUBLICATION]** |
| Next scheduled review | Annual + on any material change |
| HIPAA citation satisfied | §164.520 (Notice of Privacy Practices) |
| Source-of-truth references | [`SECURITY_POLICIES.md`](./SECURITY_POLICIES.md), [`RISK_ASSESSMENT.md`](./RISK_ASSESSMENT.md), [`BREACH_NOTIFICATION_PLAN.md`](./BREACH_NOTIFICATION_PLAN.md), [`PHI_TAXONOMY.md`](./PHI_TAXONOMY.md) |

---

## Items requiring [LEGAL REVIEW] before publication

1. **§ 2.3** — Aggregation methodology for "anonymized, aggregated data only" claim (does it meet the HIPAA de-identification standard at §164.514?)
2. **§ 2.5** — Required-by-law disclosure language and notification practice
3. **§ 4.1** — Right-of-access response timeline (HIPAA standard is 30 days; confirm we can meet it)
4. **§ 4.2** — Amendment process workflow + acceptance criteria
5. **§ 4.4** — Restriction-request process and the "paid in full" exception
6. **§ 5.3** — Law-enforcement disclosure language
7. **§ 5.4** — Anthropic BAA training-prohibition clause text — confirm the exact language
8. **§ 7.3** — Same as § 5.4
9. **§ 10** — COPPA stance and minimum-age policy; state-law parental-consent variations

## Items requiring [CONFIRM] from operator before publication

1. Effective date on publication (§ Effective date, top of doc)
2. Public privacy URL (`https://ownmyhealth.io/privacy`) (§ 11)
3. Privacy contact email (§ 12)
4. Legal entity name + mailing address (§ 12)
5. Privacy Officer / Compliance contact name + title (§ 12)
6. Cloud SQL backup retention window (§ 3.1, § 8)
7. Hosting region (`us-central1`) (§ 3.2)
8. GCP HIPAA BAA acknowledgment (§ 5.1)
9. SendGrid BAA execution (§ 5.1)
10. MFA target date (§ 3.1)
11. Self-service "accounting of disclosures" feature target date (§ 4.3)
12. Author + Privacy Officer + Legal Reviewer + Approver names (Document control)
