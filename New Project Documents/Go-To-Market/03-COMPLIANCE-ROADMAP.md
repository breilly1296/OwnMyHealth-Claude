# OwnMyHealth — Consumer Privacy & Compliance Roadmap

> **Status & honesty note.** OwnMyHealth holds **no certifications** today (only the Anthropic Business Associate Agreement is signed). Its own UX review calls it a *"polished demo, not yet a trustworthy daily health record."* Nothing in this roadmap should be read as a claim that the product is currently compliant, certified, or audited. This is the path *to* a defensible consumer-trust posture, not a description of one already in place.
>
> **Sourcing.** All regulatory facts, penalty amounts, enforcement-case values, effective dates, and third-party trust statistics in this document are drawn from the **direct-to-consumer regulatory and market research brief (2026-06-20)** prepared for this roadmap; product, security, and financial figures are from the **2026-06-20 codebase inspection.** Figures carried from those sources are presented as cited to them — not as independently verified by the author — and are flagged "(per research brief)" where they are softer third-party statistics. Author inferences are labeled **(estimate)**.

OwnMyHealth is a **pure direct-to-consumer (B2C) personal health record**: an individual signs up, uploads their own labs and insurance documents, optionally connects provider data via FHIR *at their own direction*, and queries an AI guide grounded in their own data. There is no employer, broker, TPA, or per-employee channel anywhere in this plan. That single fact reshapes the entire compliance picture — because the regulatory regime for a consumer-controlled PHR is **not** the one most healthcare founders assume.

---

## 1. Regulatory Posture

### 1.1 Why HIPAA generally does NOT apply

The instinct in digital health is to treat HIPAA as the master regime. For a consumer-controlled PHR, that instinct is **wrong and expensive** — it leads teams to over-build for the wrong rules while missing the ones that actually carry enforcement risk.

HIPAA binds only **covered entities** (providers, health plans, clearinghouses) and their **business associates**. Apps offered *directly to consumers* to track their own health data are not, on that basis, required to comply with HIPAA. Because OwnMyHealth's users supply data **directly to the app** (manual entry, document uploads) rather than the app receiving data *on behalf of a covered entity*, the product falls outside HIPAA for that data.

**The FHIR / provider-data nuance — the crux.** When a consumer exercises their HIPAA *right of access* to direct a provider to transmit records to an app **the consumer chose** (the SMART-on-FHIR pattern OwnMyHealth uses for Quest lab sync), the receiving app does **not** thereby become a business associate. Per HHS OCR guidance: once health information is received from a covered entity, at the individual's direction, by an app that is neither a covered entity nor a business associate, **the information is no longer subject to the HIPAA Rules.** Interoperability alone does not create HIPAA status.

**The narrow conditions that WOULD create a Business-Associate obligation.** HIPAA attaches if **any** of the following becomes true:

| Trigger | Example |
|---|---|
| You build/operate the app **for or on behalf of** a covered entity under contract | A provider contracts OwnMyHealth for patient-management services; patient data auto-flows into the provider's EHR |
| A **health plan offers your app** to its members to store plan/claims/wellness records | Creates BA obligations on the app |
| You perform a function **involving PHI on behalf of** a covered entity (not merely receiving data at the *consumer's* direction) | Writing back into a provider's EHR on the provider's behalf |

**Practical guardrail (estimate).** Keep the FHIR connection strictly *consumer-initiated and consumer-directed*. Sign **no BAAs** with providers/plans, do not position OwnMyHealth as performing services *for* a provider, and do not write back into a provider EHR on a provider's behalf — unless you deliberately intend to take on HIPAA scope. **A single B2B2C-style clinic or payer deal can flip the entire data store into HIPAA scope.** This is one more reason the pure-D2C strategy and the lean compliance posture reinforce each other.

### 1.2 The FTC Health Breach Notification Rule (HBNR) — the PRIMARY regime

For a non-HIPAA consumer PHR, the **FTC Health Breach Notification Rule is your primary federal obligation.** It applies precisely to *vendors of personal health records and PHR-related entities not covered by HIPAA* — the exact regulatory gap OwnMyHealth occupies.

**Why OwnMyHealth is squarely in scope.** The 2024 final rule (announced April 26, 2024; effective **July 29, 2024** — per research brief) loosened the PHR "multiple sources" test: a product is a PHR if it has the *technical capacity* to draw health data from **multiple sources** — e.g., a health API plus manual entry — *even if it doesn't actually draw from all of them.* An app that connects via FHIR **and** accepts user uploads clearly qualifies.

**The single most important 2024 change.** "Breach of security" was expanded **beyond hacking** to cover a company's **intentional but unauthorized disclosure** — for example, sharing health data with advertising vendors. The trigger shifted from unauthorized *acquisition* to unauthorized *disclosure*. **Voluntary sharing of health data without consumer authorization is now itself a reportable breach.** This expansion is load-bearing for the rest of this roadmap: it governs not only ad/analytics trackers but *any* third-party flow of health data that isn't properly authorized — including the AI/OCR/storage vendors at the core of the product (see Gate 0, items 1 and 6b).

**Notification mechanics:**

| Requirement | Detail |
|---|---|
| Who to notify | Affected individuals, the FTC, and (for large breaches) the media |
| Timing | No later than **60 calendar days** after discovery (per research brief) |
| 500+ individuals | FTC must be notified **simultaneously** with individuals (per research brief) |
| Content | Must, in most cases, **name the third parties** that acquired the unsecured information |
| Method | Email **plus** electronic notice (text / in-app) |

**Penalty exposure.** HBNR violations are treated as unfair/deceptive practices, with penalties up to **~$53,088 per violation** (FTC Act §5(m), annually re-indexed — most-current figure per research brief). At per-record counting, a single mishandled breach is an existential event for a solo-founder consumer startup.

**Enforcement precedents — note the distinct legal hooks (do not conflate them; all figures per research brief):**

| Company | Year | Amount | Legal basis | What happened |
|---|---|---|---|---|
| **GoodRx** | 2023 | **$1.5M** civil penalty | **HBNR** (first-ever) + FTC Act | Shared Rx/health data via Meta, Google, Criteo, Twilio trackers; banned from sharing health data for advertising |
| **Premom** (Easy Healthcare) | 2023 | **$100K** civil penalty | **HBNR** + FTC Act | Fertility tracker shared data with Google, AppsFlyer, Chinese analytics; permanent ad-sharing ban |
| **BetterHelp** | 2023 | **$7.8M** consumer refunds | **FTC Act §5** (deceptive) — *not* HBNR | Disclosed mental-health intake data to Facebook/Snapchat for ads |
| **Flo Health** | 2021 | No monetary penalty | **FTC Act §5** | Shared intimate cycle data with Facebook/Google despite privacy promises |

**The recurring trigger across all four cases (estimate): third-party advertising/analytics trackers (Meta Pixel, Google, SDKs) firing on health data without explicit consent.** This is the single highest-probability enforcement vector for a consumer health app — and the post-2024 HBNR makes that sharing *itself* a reportable breach.

### 1.3 State laws that bite a consumer app

*(Regulatory effective dates in this section are per research brief.)*

#### Washington My Health My Data Act (MHMDA) — the sharpest teeth

- **Broad scope:** "consumer health data" = info linked/reasonably linkable to a consumer identifying past/present/future physical or mental health status, **including data derived or inferred from non-health data.**
- **No thresholds:** any entity doing business in WA or targeting WA consumers is a "regulated entity" — no revenue or user-count minimum.
- **HIPAA carve-out:** PHI already under HIPAA is excluded — but OwnMyHealth's non-HIPAA consumer data is squarely covered.
- **Three-gate consent stack:** (1) opt-in **collection** consent; (2) *separate and distinct* **sharing** consent; (3) a **signed written authorization to sell.**
- **Geofencing ban:** absolute prohibition on geofencing around health-care facilities, no consent exception.
- **Separate Consumer Health Data Privacy Policy** required — distinct from the general privacy policy.
- **PRIVATE RIGHT OF ACTION (the critical risk):** enforced via the WA Consumer Protection Act — any MHMDA violation is a per-se CPA violation, actionable by **both the AG and private plaintiffs**. **Correction to a common misconception:** MHMDA provides **no statutory damages** — recovery is *actual* damages, trebled up to a **$25,000 cap** (per research brief), plus attorneys' fees. The "BIPA 2.0" class-action risk is real (first class action *Maxwell v. Amazon.com* filed Feb 10, 2025 — per research brief), but the per-plaintiff bounty is bounded.

#### CCPA / CPRA (California)

- Health data is **"sensitive personal information" (SPI)**, giving consumers the right to **limit use and disclosure** of SPI.
- The CPPA finalized regulations in **July 2025** (per research brief) adding Automated Decision-Making Technology (ADMT), cybersecurity-audit, and risk-assessment obligations — **directly relevant to OwnMyHealth's AI assistant** if it drives decisions; clarifying regs effective **Jan 1, 2026** (per research brief).
- No private right of action except for certain data breaches.

#### Nevada — SB 370 (not the older SB 220)

- Standalone non-HIPAA health-data law, effective **March 31, 2024** (per research brief): requires a published consumer-health-data privacy policy, affirmative consent before collecting/sharing, separate authorization to sell, and a geofencing ban. **AG-enforced, no private right of action** — contrast WA.

**Planning posture (estimate):** build a **multistate consent architecture** (separate collect / share / sell gates) keyed to **WA MHMDA as the strictest baseline**, rather than patching state by state. The WA/NV model is spreading.

---

## 2. Required Consumer-Facing Artifacts

For a pure-D2C health app, the compliance work and the trust-conversion work are largely **the same artifacts**. These are not bureaucratic overhead — each is also a conversion lever (per research brief: 83% of consumers say protecting their personal data is among the most crucial factors in trusting a company; 71% would stop doing business with a company that gave away sensitive data without permission).

| Artifact | Why required | Notes for OwnMyHealth |
|---|---|---|
| **General privacy policy** | FTC §5 (must be truthful — broken promises = the BetterHelp/Flo failure mode); CCPA/CPRA disclosures | Must be accurate. **Retract the stale README "Last Audit: Jan 2025 / 0 findings" and "fully encrypted" overclaims** before publishing any public trust copy — false security claims are FTC-enforceable. |
| **Separate Consumer Health Data Privacy Policy** | **Mandatory** under WA MHMDA and NV SB 370 | A distinct document from the general policy; identical privacy-policy URLs required across web/app per platform rules (§3). |
| **Opt-in consent flows** (collect / share / sell — *separate*) | MHMDA & NV require *separate* consents; sale needs signed authorization | Maps to the multistate consent architecture. The "we don't sell" posture means the *sale* gate may simply never be offered — a feature, not a gap. |
| **Data access / export / deletion** | CCPA/CPRA rights; MHMDA right to delete; Apple 5.1.1(v) in-app account deletion; baseline consumer trust | **Currently a launch gap.** The product's own readiness review flags that no verified, self-serve *export-all + delete-my-account* journey exists end-to-end; deletion must destroy the per-user encryption salt to render PHI unrecoverable. This must be **proven by manual run-through**, not just route existence. |
| **AI medical-advice disclaimers** | Keeps the AI guide as "information, not a clinical action plan" — out of FDA device territory | FDA judges the **totality of claims**: a "wellness" label does not override clinical/diagnostic language in marketing. Disclaimers must be backed by actual product behavior; the AI must never be the *sole basis* for clinical action. Display "not medical advice / consult a professional" prominently. |
| **Breach-response plan** | HBNR: individual + FTC notice ≤60 days; simultaneous FTC notice at 500+; notice names third-party recipients | **Currently the most urgent gap.** Audit logging with 7-yr retention exists (per codebase inspection) and the FORCE RLS guard fails closed — but **no breach-detection alerting is wired**, the audit path's reliability is **unverified end-to-end**, and five PHI-path controllers are untested, so the 60-day clock cannot reliably start today. A named human and a runbook are prerequisites to launch (see §5). |
| **"We don't sell your data" posture** | Post-GoodRx/HBNR, this claim is **legally enforceable** — and a conversion lever | Only make the claim if the architecture *guarantees* it. Concretely: **audit every third-party SDK/pixel/tracker; no Meta Pixel / Google Analytics / ad SDK fires on health data without explicit opt-in** — and confirm the product's own AI/OCR/storage vendors don't use the data beyond service delivery (Gate 0, item 6b). This is the #1 enforcement failure mode and the #1 trust signal simultaneously. |

---

## 3. App-Store / Platform Health-Data Policies

> **Scope reality:** OwnMyHealth is **web-only today** (no native app, no PWA). These platform policies do **not** gate the current web launch — but they are hard prerequisites the moment a native iOS/Android app ships, and they shape the privacy posture regardless. Treat this section as forward-looking gating, not a current blocker. *(All policy dates per research brief.)*

### 3.1 Apple App Store

| Guideline | Requirement |
|---|---|
| **5.1.3(i) / 5.1.2(vi)** | Health/fitness/medical data may **not** be used or disclosed for advertising, marketing, or use-based data mining (other than improving health management), and not by third parties. Must disclose the specific health data collected. |
| **5.1.3(ii)** | May **not** store personal health information in iCloud; no false data written to HealthKit. |
| **1.4.1** | Medical apps **should remind users to consult a doctor** before medical decisions; accuracy claims must disclose data + methodology or face rejection; sensor-only BP/glucose/blood-oxygen/x-ray claims are not permitted. |
| **5.1.1** | Privacy-policy link required in App Store Connect **and** in-app; must cover collection, uses, sharing (with equal-protection guarantee), retention/deletion, and consent revocation. Explicit consent required before collecting data. |
| **5.1.1(v)** | If the app supports account creation, it must offer **in-app account deletion**. |
| **App Privacy "Nutrition" Labels** | Must declare data types including **"Health & Fitness"** and **"Sensitive Info,"** and whether data is linked to the user or used to track. Since **May 1, 2024**, "required reason" APIs must be declared in a privacy-manifest file or the submission is rejected. |

### 3.2 Google Play (notably stricter on accountability after 2025–2026)

| Requirement | Detail |
|---|---|
| **Mandatory medical disclaimer** | Apps without regulatory clearance must state the app is **"not a medical device and does not diagnose, treat, cure, or prevent any condition"** — placed **in the first paragraph of the app description** — and must also remind users to consult a healthcare professional. |
| **Health apps declaration form + privacy policy** | Must complete the Play Console declaration; privacy policy on an active, public, non-geofenced URL (no PDFs), linked inside the app. |
| **Health Connect / sensitive-data restrictions** | Health-record data (history, diagnoses, meds, labs) gated to apps with justified, articulated use cases (Mar 5, 2025 update). |
| **January 2026 escalation** | The **"incidental use" path is eliminated**; **individual developer accounts are no longer permitted for health/medical apps — a verified Organization account with a D-U-N-S number is required** (migration deadline **Jan 28, 2026**); privacy-policy URLs must be **identical** across Play Console, in-app, and website. |
| **Data Safety section** | Google's consumer-visible analogue to Apple's Nutrition Label; different categories/self-attestation. |

**Platform takeaway (estimate):** the **Play Jan-2026 Organization-account + D-U-N-S requirement** raises the bar to publish a native Android health app and must be factored into any native-launch timeline. **HealthKit is native-only** — a PWA cannot read Apple Health — which is the single strongest reason OwnMyHealth would *eventually* need a native iOS app. Across both stores, the binding rule echoes the FTC posture: **no advertising/data-mining on health data, prominent disclaimers, frictionless deletion, and clean privacy labels.** The compliance work and the platform work are, again, the same work.

---

## 4. Where SOC 2 / HITRUST Fit — TRUST Signals, Not D2C Gates

This is where founder budget is most often misallocated. **For a pure-D2C app with no covered-entity customers, neither SOC 2 nor HITRUST is a legal requirement or a sales gate** — there is no enterprise buyer demanding them. SOC 2 is explicitly voluntary (driven by market/client expectations); HITRUST, while a common payer/provider *procurement* requirement, is "not legally required itself."

The trap: these certifications become "necessary" only if OwnMyHealth pursues B2B2C deals (clinics/payers) — which, per §1.1, is **also the exact move that would drag the product into HIPAA scope.** So SOC 2/HITRUST track your *go-to-market*, not your D2C launch. **Do not over-budget them as launch blockers.**

That said, they retain *some* consumer value as **trust signals** — the "independently audited" badge raises perceived legitimacy (per research brief, HITRUST-certified orgs reported breaches at only 0.59% in 2024, a credible objective signal), and a clean independent privacy rating (e.g., Mozilla *Privacy Not Included*) is a rare external endorsement. But for a consumer audience these are *indirect* — far less load-bearing than a true, prominent "we don't sell your data" promise, clean app-store privacy labels, and frictionless deletion.

**Cost ranges (so they can be deferred deliberately, not by accident; all ranges per research brief):**

| Trust-spend item | Cost range | D2C role |
|---|---|---|
| SOC 2 Type II | **$25–45K** | Optional trust signal; defer until B2B2C is on the roadmap |
| HITRUST e1 | **~$35K** | Optional; procurement-driven, not D2C |
| HIPAA program build | **$10–25K** | Only if a BA path is taken on (see §1.1) |
| Penetration test | **$10–20K** | **Recommended pre-launch** — meaningful security assurance for the price; pairs with the open security work |
| Cyber / privacy insurance | **$5–13K/yr** | **Recommended** — backstops the existential-breach risk for a solo founder |
| Healthcare-privacy counsel (HBNR + state-law + AI-disclaimer review) | **$20–60K** | **Required-adjacent** — given the genuinely multi-regime surface (HBNR + MHMDA private right of action + CCPA ADMT + FDA AI framing), this is the highest-value compliance spend |

**The deliberate deferral call (estimate):** spend on **counsel, a pentest, and cyber insurance** before launch; **defer SOC 2 and HITRUST** until and unless a non-D2C channel is genuinely on the table. This is the opposite of the default healthcare-startup reflex, and it is correct for a pure consumer product.

---

## 5. Sequenced Timeline — What Gates Launch vs. Optional Trust Spend

> **Scope of this roadmap.** These gates cover the **privacy/compliance** surface only. "Launch" below means the **first public consumer launch.** The paid tier follows once self-serve billing is wired: Stripe is **not yet integrated** and the documented plan-limit-bypass (M12/M13) and quota TOCTOU races would leak revenue the moment money is involved — those are **product-hardening prerequisites tracked separately**, not compliance gates. The compliance gates and the revenue gate must not be conflated: closing every item below makes the product *legally launchable to consumers*, not *able to take money*.
>
> Sequencing principle: **legal/safety blockers first, trust amplifiers second, certifications last (and only if GTM demands them).**

### Gate 0 — Must close BEFORE any public consumer launch (legal/safety blockers)

1. **Tracker/SDK audit + "we don't sell" guarantee.** Verify no ad/analytics pixel fires on health data without opt-in consent. *(The #1 enforcement vector — GoodRx/BetterHelp/Premom/Flo.)*
2. **Breach-response plan + breach-detection alerting + named Security Officer.** Wire alerting to audit-log anomalies and the RLS boot-guard FATAL exits so the **60-day HBNR clock can actually start**; author a breach runbook. Also verify the audit-log path end-to-end (it is currently unverified, and five PHI-path controllers are untested). *(Currently the most urgent gap.)*
3. **Verified self-serve export + account deletion** (export-all + delete-with-salt-destruction), proven by manual run-through. *(Legal expectation + Apple 5.1.1(v) + top consumer trust signal.)*
4. **Published privacy policy + separate Consumer Health Data Privacy Policy + AI medical-advice disclaimers**, with the stale README audit/encryption overclaims retracted. *(MHMDA/NV mandatory; FTC §5 truthfulness.)*
5. **Multistate opt-in consent architecture** (collect / share / sell, keyed to WA MHMDA). *(MHMDA private-right-of-action exposure.)*
6. **Vendor data-flow controls** (two parts):
   - **(6a) Data-processing / no-secondary-use agreements** (BAA-equivalent terms where the vendor offers them) for services that actually touch PHI — Google Cloud (Cloud SQL / GCS / Document AI), Quest, and SendGrid. *Note: SendGrid is **not** HIPAA-eligible and won't sign a BAA — restrict it to non-PHI email or swap to a HIPAA-eligible provider. In pure-D2C posture HIPAA may not bind, so these are not BAAs in the HIPAA sense; they are no-secondary-use contracts and remain best-practice for a health-data store.*
   - **(6b) AI/OCR/storage no-training, no-secondary-use confirmation.** Confirm that **no third-party AI/OCR/storage vendor uses consumer health data beyond service delivery** — specifically that Anthropic (BAA signed) and Google Document AI do **not** train models on user PHI and that all such flows are contractually no-secondary-use **and disclosed/authorized in the consent architecture (item 5)**. *(Rationale: under the post-2024 HBNR, an unauthorized third-party disclosure is itself a reportable breach — §1.2 — so routine PHI flows to the AI/OCR/storage pipeline are in scope, not just ad trackers.)*
7. **Healthcare-privacy counsel review** of the above (HBNR including the disclosure-as-breach analysis for the AI/OCR pipeline, MHMDA, CCPA ADMT, AI/FDA framing).

### Gate 1 — Strongly recommended for a credible public launch

8. **Penetration test** ($10–20K) and **cyber/privacy insurance** ($5–13K/yr).
9. **Clean app-store privacy labels / Data Safety section** prepared (even ahead of a native app, to anchor the public privacy posture).
10. **CCPA/CPRA ADMT + risk-assessment review** for the AI feature (regs effective Jan 1, 2026 — per research brief).

### Gate 2 — Forward-looking (gates native mobile, not web launch)

11. **Apple privacy-manifest + health-disclaimer compliance** and **Google Play Organization account + D-U-N-S** (deadline Jan 28, 2026 — per research brief) — prerequisites *before* any native build, not before web launch.

### Optional / deferred trust spend (NOT launch gates)

12. **SOC 2 Type II** ($25–45K) and **HITRUST e1** (~$35K) — defer unless/until a non-D2C channel is pursued (which would also change the HIPAA analysis).
13. **Independent privacy rating** (e.g., Mozilla) — pursue once the no-tracker posture is verifiably clean; a bad review is reputational damage, so do not invite it prematurely.

---

## Summary Table

| Item | Cost range | Blocks launch? | Legally required or trust? |
|---|---|---|---|
| Tracker/SDK audit + "no-sell" guarantee | Internal eng time | **Yes** | **Legal** (HBNR / FTC §5 — top enforcement vector) |
| Breach-response plan + detection alerting + named Security Officer | Internal eng/ops + counsel review | **Yes** | **Legal** (HBNR 60-day clock) |
| Verified self-serve export + account deletion | Internal eng time | **Yes** | **Legal + trust** (CCPA/MHMDA + Apple 5.1.1(v)) |
| General privacy policy (overclaims retracted) | Counsel (part of below) | **Yes** | **Legal** (FTC §5 truthfulness) |
| Separate Consumer Health Data Privacy Policy | Counsel (part of below) | **Yes** | **Legal** (WA MHMDA + NV SB 370) |
| Multistate opt-in consent (collect/share/sell) | Internal eng time | **Yes** | **Legal** (MHMDA private right of action) |
| AI medical-advice disclaimers | Internal | **Yes** | **Legal** (FDA framing / FTC §5) |
| Vendor data-processing/no-secondary-use agreements (GCP/Quest; fix SendGrid) | Mostly negotiation | **Yes** *(best-practice for health data)* | **Trust+** (HIPAA only if BA path taken) |
| AI/OCR no-training + disclosure-authorization confirmation | Internal + counsel | **Yes** | **Legal** (HBNR disclosure-as-breach) |
| Healthcare-privacy counsel (HBNR/state/AI) | **$20–60K** | **Yes** (de facto) | **Legal** (highest-value compliance spend) |
| Penetration test | **$10–20K** | Recommended, not blocking | **Trust** (security assurance) |
| Cyber / privacy insurance | **$5–13K/yr** | Recommended, not blocking | **Trust** (existential-breach backstop) |
| Clean app-store privacy labels / Data Safety | Internal | No (gates native) | **Legal** (Apple/Play, at native ship) |
| Apple privacy-manifest + disclaimers | Internal | No (gates native iOS) | **Legal** (at native ship) |
| Google Play Org account + D-U-N-S (Jan 28, 2026) | Low | No (gates native Android) | **Legal** (at native ship) |
| SOC 2 Type II | **$25–45K** | **No** | **Trust** (defer; GTM-driven) |
| HITRUST e1 | **~$35K** | **No** | **Trust** (defer; procurement-driven) |
| HIPAA program build | **$10–25K** | **No** | **Trust** (only if BA path taken) |
| Independent privacy rating (Mozilla) | Low | **No** | **Trust** (pursue only once clean) |

> **Billing note (cross-reference, not a compliance gate):** self-serve Stripe billing + remediation of the plan-limit-bypass (M12/M13) and quota TOCTOU races are prerequisites for the *paid* tier and are tracked in the product-hardening plan. They are listed here only so the reader does not mistake "compliance launch-ready" for "revenue-ready."

**The one-line compliance thesis:** for a pure consumer PHR, the gate is **the FTC Health Breach Notification Rule + WA MHMDA + a verifiable "we don't sell your data" architecture (including no-secondary-use AI/OCR vendor flows) + working export/delete + breach detection** — *not* HIPAA, SOC 2, or HITRUST. Spend on **counsel, a pentest, and cyber insurance**; defer the enterprise certifications deliberately. The product is **not there yet** — it holds no certifications, has no breach-detection alerting, no verified export/delete flow, an unverified audit path, and unconfirmed vendor agreements — but every gating item above is achievable, and most of them double as the consumer-trust signals that *are* the product.
