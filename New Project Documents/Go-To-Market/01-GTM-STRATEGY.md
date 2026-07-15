# OwnMyHealth — Direct-to-Consumer Go-To-Market Strategy

> **Board / investor working document — v2, 2026-06-20.** Pure direct-to-consumer (B2C). No employer, broker, TPA, benefits, or per-employee channel exists anywhere in this plan. Every revenue dollar comes from an individual who signs up, uploads their own records, and pays for their own subscription.
>
> **Sourcing note.** All external market, competitor, regulatory, and company-specific statistics in this document (e.g., KFF deductible figures, ONC record-access data, Flo/Function/Whoop/Oura company metrics, RevenueCat/Adapty conversion benchmarks, FTC penalty amounts, market-concentration figures) are drawn from the cited sources compiled in the research brief that informed this plan. Figures that are our own planning inferences — not researched data — are explicitly labeled **(estimate)** or **(illustrative)**. Channel CAC ranges are **(estimate)** unless a specific named-company figure is cited.

---

## 0. Executive Summary

OwnMyHealth is a **member-owned longitudinal health record fused with insurance cost-navigation**, guided by an AI grounded in the user's *own* data. The defensible wedge is the **fusion** — "understand your health *and* what your care will cost, in one place" — not "AI chat over your records," which was commoditized in January 2026 by ChatGPT Health, Copilot Health, Perplexity Health, and Claude for Healthcare.

Three facts shape this entire plan, and we confront them head-on rather than bury them:

1. **The economics of consumer health are brutal.** Fully-loaded CAC runs ~$30–60 per paying subscriber; free-user Day-30 retention is ~3–8%; freemium converts ~5x worse than a hard paywall (2.1% vs 10.7% download-to-paid). We therefore engineer **cheap, organic, content/SEO- and referral-led growth around a sticky daily-use wedge — never paid-acquisition-first.**
2. **Generic "AI over your records" is commoditized.** We win on the cost-navigation rail welded to the health rail — a position no competitor occupies (per the competitive map below).
3. **Trust *is* the product.** One breach or one FTC action ends a consumer health startup. Our growth motion and our compliance posture are the same artifact.

**Honest readiness:** the product's own UX review called it "a polished demo, not yet a trustworthy daily health record." We hold **no certifications** (only the Anthropic BAA is signed). There is **no billing system, no MFA, no mobile app/PWA**, two open High issues, and five untested PHI-path controllers. This document sequences the work to fix that *before* we spend a dollar acquiring a paying customer.

**Monetization decision (founder-set):** launch **freemium now**, build the funnel and trust, then **test a harder paywall later** once retention data exists. Billing (Stripe) is not yet wired — it is the single largest launch blocker.

**On the competitive window:** our differentiation is a window, not a permanent moat. ChatGPT Health and Perplexity Health are converging fast from the AI side with enormous distribution. **We treat the window as a finite planning judgment — likely one to two years** before a big-AI entrant or a cost player bolts on the missing rail — and build to convert it into retention and a trusted brand. This is a strategic judgment, *not* a researched figure (see §1.2).

---

## 1. Positioning & The Wedge

### 1.1 The one consumer outcome we sell

> **"Drop in your lab PDF — or sync your labs — and instantly see your biomarkers tracked over time, flagged when out of range, explained in plain language, *alongside what your care actually costs under your insurance.*"**

We do **not** sell a chatbot. We sell a private, member-owned record where the clinical "why am I trending this way?" and the financial "what will this cost and how do I pay less?" live in **one reasoning loop**. That seam — between health and cost — is the wedge.

### 1.2 Why this position is defensible (the competitive map)

No competitor owns all four pillars (PHR aggregation + biomarker trends + insurance/cost navigation + AI grounded in your own data):

| Player | PHR aggregation | Biomarker trends | Insurance / cost navigation | AI on your data |
|---|---|---|---|---|
| Function / Superpower / Levels / InsideTracker | weak (upload only) | **strong** | **none** | partial (own labs only) |
| Apple Health Records | **strong** | weak | none | none |
| MyChart (Epic) | strong (Epic-bound) | weak | **partial** (own-provider bills/estimates) | weak |
| Fasten / b.well / Hugo | strong | weak | none–weak | none (b.well = backend for others) |
| ChatGPT Health (Jan 2026) | **strong** (portals) | partial | **partial** (reads insurance docs, plan trade-offs) | **strong** |
| Perplexity Health (Mar 2026) | **strong** (b.well-backed) | **strong** (trend dashboard) | **none** | **strong** |
| GoodRx / Sidecar / Sheer / Goodbill / Bluebook | none | none | **strong** (each a slice) | partial |

**The unoccupied position is the cost-navigation rail welded to the health rail.** Every cost player (GoodRx, Sidecar, Sheer, Goodbill, Bluebook) starts from the *bill or the plan* and has zero visibility into your labs or biomarker trajectory. Every health/AI player (Function, Apple, Perplexity, even ChatGPT) starts from your *health data* and either ignores cost or only *interprets* an insurance document without acting on it. **No competitor connects the clinical "why" to the financial "how much / how do I pay less."**

**Honest threat assessment.** ChatGPT Health already reads insurance documents and reasons about plan trade-offs — it is the player most likely to close the gap, and it has enormous distribution (per the brief, ~230M people ask ChatGPT health questions weekly). Perplexity Health already ships three of our four pillars (PHR + trends + AI), missing only the cost rail. **Our differentiation is therefore a window, not a permanent moat.**

> **On the size of that window (planning judgment, NOT a researched figure):** We plan around a **finite window of roughly one to two years**. This is our own estimate, derived from a single stated assumption — *the typical time for a large-AI player or a funded cost-navigation player to design, build, and ship a new vertical feature (a cost rail, or a health/biomarker rail) into an existing product.* No source supplies a "12–24 month" number; it is a planning assumption, not data, and the plan's "speed on the gates" logic should be read as *"move before a well-resourced competitor can plausibly span the seam,"* not as a precise countdown.

### 1.3 Strategic guardrails

- **Do NOT compete on biomarker testing.** Function's war chest wins that; we treat lab draws as an *ingested input*, like Perplexity and ChatGPT do.
- **Do NOT compete on raw record aggregation.** Apple/Epic/b.well own those rails; we ingest from them.
- **DO own the cost-aware health copilot** — the only consumer product whose AI sees both your longitudinal clinical/biomarker data *and* your claims/deductible/bills/Rx prices, using each to inform the other.

### 1.4 The Ideal Customer Profile (who feels this pain most)

We prioritize three concentric consumer segments. The wedge is sharpest where *health complexity* and *cost exposure* overlap.

**Primary ICP — the high-deductible chronic-condition manager.**
This person has both a recurring clinical reason to track data *and* real financial skin in the game:

- **34% of covered workers now have a $2,000+ single-coverage deductible** (up 77% over 10 years; KFF 2025), and the average single deductible is **$1,886** — so out-of-pocket cost is now the consumer's problem, not the plan's.
- **41% of US adults carry medical/dental debt**; ~half could not pay an unexpected $500 medical bill (KFF). Pain is acute and broad.
- **58% would price-shop healthcare if they knew costs upfront** — but **64% have never done so** (Fierce Healthcare, 2024). Large latent demand; we make the latent behavior easy.
- They generate fresh lab data several times a year (labs, refills, follow-ups), which feeds the longitudinal trend hook that drives retention.

**Secondary ICP — the longevity / quantified-self consumer.**
- Individuals are 35% of the **$27.6B longevity market** (SNS Insider, 2025); proven willingness to pay (~$6/mo Oura benchmark; Function $365/yr; Superpower $199/yr).
- Already uploads labs and wants trends + interpretation. We are *not* their testing provider; we are the private record that unifies whatever they test, plus the cost layer they currently lack.

**Tertiary ICP — the caregiver / proxy.**
- Proxy/caregiver record access doubled to **51%** (from 24% in 2020; ONC 2024). An adult managing a parent's or child's labs *and* bills feels the fusion pain double. **Important constraint:** there is **no family/multi-member account model in code today** — a single account with higher numeric limits is not a family product. This segment is a **v2 target, not a launch claim**; we serve it only when the multi-member account model ships (see §5, §7.2).

**Why this ICP order:** the high-deductible chronic manager has the tightest health-AND-cost overlap, the most frequent fresh-data events, and the clearest "this saved me money / explained my result" moment — the strongest fuel for word-of-mouth and retention.

---

## 2. The Consumer Growth Motion

### 2.1 Core thesis: organic-first, paid-last

The companies that won consumer health *cheaply* — Flo, Function, Levels, Oura, Whoop — did **not** win on paid acquisition. They won on three compounding, low-marginal-cost engines: **(1) a credible founder/creator voice, (2) content/SEO capturing the enormous "is my [biomarker] normal?" search demand, and (3) word-of-mouth + referral fed by genuine retention.** Word-of-mouth is *Flo's largest traffic driver* and a top driver for Function. Paid is a scaling throttle applied late, never the foundation.

### 2.2 Why paid-first is dangerous (confront, don't bury)

1. **The leaky bucket.** With ~3% Day-30 retention for health & fitness apps and ~9.2% monthly churn, paid-acquired users churn before we recoup CAC. Paid only works *after* retention is fixed.
2. **CAC inflation + signal loss.** Cross-channel CAC rose **40–60% from 2023→2025**; post-ATT Meta CPAs rose 20–40% with conversion-reporting accuracy down 30–50% for DTC.
3. **Health-data targeting is restricted.** Meta/Google curtail health-condition targeting — the precision paid social relied on is gone for health advertisers (restriction is fact; impact on health CAC is **(estimate)**).
4. **No compounding.** Paid is rented; content/SEO, referral, community, and ASO are *owned* and compound.

> **Unit-economics guardrail:** target **LTV:CAC ≥ 3:1** (4:1–5:1 preferred), CAC payback < 12 months, before any meaningful paid spend.

### 2.3 Channel CAC cheat-sheet (sequenced priority)

| Priority | Channel | CAC range (D2C health) | Confidence | Time-to-impact | Compounds? |
|---|---|---|---|---|---|
| 1 | **Content / SEO + programmatic** | $0–$50 amortized, →~$0 at scale | estimate (high-intent health queries far below SaaS $290 baseline) | 6–12 mo lag | **Yes** |
| 1 | **Founder / creator-led earned media** | ~$0 marginal | estimate | depends on audience | **Yes** |
| 2 | **Referral / virality** | $20–$150 | estimate (anchored to $150 SaaS referral floor) | slow ramp | **Yes** |
| 2 | **Community** | low (mostly time) | estimate | slow | **Yes** |
| 2 | **ASO** (once a PWA/app exists) | near-$0 marginal | fact-anchored | medium | **Yes** |
| 3 | **PR / Product Hunt launch** | one-time spike, low $/user | estimate | instant, non-recurring | No |
| 3 | **Micro-influencer + CPA affiliate** | $40–$120 | estimate | medium | partial |
| 3 | **Partnerships** (labs / wearables / telehealth) | variable, often rev-share | estimate | medium-slow | partial |
| 4 (last) | **Paid search (Google)** | $70–$300+ | estimate (general paid-search ~$70 baseline; health inflates) | instant, non-compounding | No |
| 4 (last) | **Paid social (Meta)** | $150–$400+ post-ATT | estimate (FB ~$230 baseline) | instant, non-compounding | No |

These ranges are **(estimate)** unless a specific company figure is cited; the underlying benchmarks (SaaS referral floor, FB/Google paid baselines, CAC inflation, iOS/Android CPI) are from the cited sources in the brief.

### 2.4 Channel playbooks

**① Content / SEO + programmatic — the cheapest scalable engine.**
Consumer health is search-demand-rich: every biomarker, symptom, lab value, and supplement is a query with weak incumbent content. The category leaders are content companies that sell a subscription. **Flo built a 100+-article library plus 9 free calculators driving 6M monthly visitors from search** with minimal ad spend.

Tactics:
- **Pillar-cluster** on our 3–5 core conditions/biomarkers ("the ultimate guide to [LDL / HbA1c / TSH]" → 15–30 cluster articles).
- **Programmatic templates** for the long tail: one page per biomarker ("What is a normal [ferritin] level — and what does the test cost?"), each fusing the *health* answer with the *cost* angle (our wedge baked into SEO).
- **Free interactive tools/calculators** — highest-ROI programmatic asset; they earn backlinks and rank. A cost-estimator-by-biomarker tool is our Flo-calculator move *and* a demo of the wedge.
- **AEO/GEO** — optimize for AI-answer surfaces (the 2026 frontier).
- ⚠️ **YMYL compliance caveat:** Google holds health ("Your Money or Your Life") content to higher E-E-A-T standards. **Attribute content to a credentialed clinician and cite primary literature**, or it won't rank — which dovetails with the founder-credibility play below.

Economics: amortized CAC **$0–$50**, approaching zero at scale; **6–12 month lag** before traffic compounds. Seed-stage target: **1,000–5,000 monthly organic visitors within 12 months** (per brief benchmark).

**② Founder / creator-led earned media — the category cheat code.**
A credible health voice generates massive earned reach at ~$0 marginal CAC. Function rode Dr. Mark Hyman's 2.5M IG following (~40k → 200k+ members in a year); Levels deliberately turned co-founder Casey Means into a ~1M-follower voice via the podcast circuit (Rogan, Huberman). **If we lack a famous founder, we manufacture authority (estimate):** put our clinical founder/advisor on the health-podcast circuit and niche condition podcasts, publish under their byline (which also satisfies the YMYL/E-E-A-T need), and build *their* audience as a company asset. This is the cheapest reach in the category but requires a genuinely credible voice.

**③ Referral / virality — the WOM amplifier.**
WOM is already the biggest channel in this category; a referral program instruments and amplifies it. **80% of sharing happens via "dark social" (WhatsApp/text)** — which is exactly why Flo's top referral source is WhatsApp. **Whoop's double-sided referral (advocate gets 1 free month, friend gets $30 off) drives >10% of new sign-ups.**

Tactics: double-sided incentive (give-a-month / get-a-discount); make sharing native to a *result* ("share your in-range win" / "I found a $X cheaper lab"); WhatsApp/SMS-first share sheets; **gate the reward on the referred user *activating*, not just installing**, to protect economics. Target K-factor 0.15–0.25 (good) → 0.4 (great); realistically we engineer a sub-1 K-factor that lowers *blended* CAC, not true virality. **Critical gap:** the product today has **zero referral/invite code and provider-sharing is inbound-only** (a provider must request; a patient cannot invite their own doctor or family) — this must be built (see §5).

**④ Community.**
Levels treats "community as a growth strategy" (its $38M Series A was "driven by member and community alignment"). Community is slow, low-CAC, and deepens the retention that feeds WOM. Tactics: a focused chronic-condition/cost-savings hub (Discord/Circle), member challenges (Strava's "Challenges" lifted 90-day retention 18%→32%), and spotlighting member "this explained my result / saved me money" stories as both content and referral fuel.

**⑤ Micro-influencer + CPA affiliate.**
Distinct from founder fame: *paid/incentivized* creator distribution. Oura gifts rings to value-aligned creators (millions of organic impressions; blended CAC ~$50–80); Whoop runs affiliates on a **CPA model** (pay only on conversion). Tactics: prioritize **micro-influencers (10k–100k)** in chronic-condition and longevity niches over mega-creators (cheaper, higher trust); **gift-then-affiliate**; structure everything as **CPA, not flat-fee** so spend is acquisition-locked. CAC **$40–$120 (estimate)**.

**⑥ PR / Product Hunt launch — a one-time spike, not a channel.**
Ash (AI mental health) hit #1 Product of the Day by pre-seeding supporters in relevant communities. The win is made *before* launch day: line up our community/waitlist to upvote in the first hours, pair with a press angle (a striking cost-data finding, or the founder-credibility story), and **convert the spike into email captures, not just installs.**

**⑦ Partnerships (labs / wearables / telehealth) — retention & credibility first, distribution second.**
The category converged in 2025 on "always-on infrastructure linking sensors + software + labs" (Oura Health Panels, Whoop lab panels, Function↔Quest+Ezra). For us (estimate):
- **Wearable data sync** (Apple Health / Oura / Whoop / Garmin, via an aggregator like Junction) makes the app stickier and more shareable.
- **At-home lab-kit integration** creates a recurring "result moment" that fuels WOM and re-engagement.
- Structure as **rev-share / affiliate (pay-on-conversion)** to keep CAC variable.
- *This is a "future/adjacent" lane only* — labs, wearables, and telehealth are legitimate partnerships; there is **no employer channel here or anywhere.**

---

## 3. Activation & Retention Loops

Retention — not conversion — is the binding constraint. The best-converting health categories also churn fastest. The single most predictive churn signal is **<3 sessions in the first 14 days → 3–4× churn.** Everything below is engineered to beat that.

### 3.1 Onboarding → first value

**The activation moment is: drop a lab PDF → see extracted biomarkers + out-of-range flags in seconds.** The signup→first-value path already exists in code (register → email-verify → 4-step wizard: welcome → upload lab → health profile → done), and it is reasonably complete. But it has real gaps to close before we drive traffic to it:

- **Email verification is a hard wall** (login fails until the link is clicked). This is a known funnel choke point and the prior UX review flagged a "dead registration-verification funnel" — must be walked end-to-end and confirmed working before launch.
- **First value depends on the user having a lab PDF**, and auto-sync is **Quest-only and PRO-gated**. We must add a **sample/demo path** (e.g., "try it with a sample lab") so an empty account isn't a dead end.
- The prior UX review flagged a **"placebo OCR review step"** and **"health-goal create 100% dead"** (remediated per changelog but **unverified end-to-end**). Placebo steps in onboarding are trust-killers exactly where trust is being established — **verify before driving acquisition.**

**Activation target metric:** "added or extracted first biomarker within session 1," plus engineering the email+push sequence to drive **3+ meaningful sessions in the first 14 days.**

### 3.2 Habit / notification / fresh-data mechanics

The durable retention engine for a *record* app is **showing the user something new and personal each session** — trends over time, a new reading, progress against their own baseline — plus **timely reminders.** Critically, the biomarker layer is structurally a **real time series** (latest value + history, oldest-first), so the longitudinal trend hook — the retention product — is sound.

Mechanics to build/strengthen:
- **Fresh-data hooks:** "your new result is ready," "your LDL moved since last draw," weekly trend summary. The lifecycle email engine already ships (weekly summary, goal reminders, out-of-range alerts, new-results, plan-expiring) — this is the *primary retention loop today* and it is genuinely shipped and multi-instance-safe.
- **The biggest retention gap is re-engagement reach:** the app is **web-only with no push.** Email is the *weakest* channel for a web app. Closing this (PWA + web push, then native) is the single highest-leverage retention investment (see §5).
- **Light gamification (estimate on magnitudes — secondary sources):** streaks/milestones can lift DAU and cut 30-day churn; per the brief, a 7+ day streak correlates with ~2.3× daily engagement. Add a simple streak/"in-range %" progression — *without* dark patterns, given the trust-sensitivity of health data.
- **Stickiness target:** utility/health DAU/MAU of **20–30%**.

---

## 4. Messaging Pillars (anti-"just another AI chat")

Every message reinforces the fusion and the trust posture, and explicitly *avoids* positioning us as a chatbot.

| Pillar | The message | Proof / why it lands |
|---|---|---|
| **1. Health + cost in one place** | "Understand your health *and* what your care will cost — together." | The unoccupied competitive position; no rival fuses the two. |
| **2. You own it** | "Your record. Your data. Private, encrypted, exportable, deletable — anytime." | Member-owned PHR; export/delete are always-on every tier. Trust is the product. |
| **3. Grounded in *your* data** | "Plain-language answers from *your* labs and *your* plan — not the internet." | Differentiates from generic AI-over-records; AI is grounded in the user's own record. |
| **4. We never sell your data** | "We do not sell or share your health data for advertising. Ever." | A *conversion lever* (per the brief, 83% of consumers rank data protection as a top trust factor; 71% would quit a company that shared sensitive data) — and legally load-bearing under the FTC HBNR post-GoodRx. Only make this claim if architecture guarantees it. |
| **5. Built for the cost you actually pay** | "See your real out-of-pocket cost under *your* deductible — before the bill." | Speaks to the 34%-with-$2,000+-deductible reality; 58% would shop if they knew costs upfront. |

**Explicit anti-positioning:** we never lead with "AI chat." The chatbot is a *feature inside* a cost-aware health record, not the product. Leading with "AI over your records" puts us in a fight with ChatGPT/Perplexity/Claude-for-Healthcare we cannot win.

**Trust-signal messaging discipline (honesty rule):** we hold **no certifications** (only the Anthropic BAA is signed). We **do not claim HIPAA, SOC 2, or HITRUST compliance** — none are in place. We may truthfully market the *technical* posture we have built (per-user AES-256-GCM field encryption, Postgres FORCE row-level security that fails closed, 7-year audit logging, JWT rotation/revocation), and we must **retract the stale README claims** ("Last Audit Jan 2025 / 0 findings," "fully encrypted") before any public marketing. SOC 2/HITRUST are *future* trust signals for a consumer audience — not sales gates and not present-tense claims.

---

## 5. Phased Launch Sequence — Three Gates, In Order

Gates run in order; growth spend (§2) does not begin until Gate 3. This is grounded in the readiness gap list and the regulatory regime in the brief.

> **Readiness callout — severity legend (so this checklist is self-contained for a board reader):**
> - **H-2 (open High):** FHIR multi-instance correctness breaks across instances; forces `--max-instances=1` until Redis is provisioned (blocks autoscale + exact spend caps).
> - **H-3 (open High):** Google Document AI / OCR dollars are *not* tracked against the budget; the $50/day cap bounds only Claude tokens, so OCR spend is effectively uncapped.
> - **L24 (High-rated compliance residue):** legacy `user_files.original_filename` is still **plaintext PHI in production**; filenames routinely embed patient names/dates.
> - **M12 / M13 (Medium):** documented plan-limit *bypass* — a free user can exceed plan caps; must be closed before charging.
> - **Quota TOCTOU (Medium, accepted):** concurrent requests can overshoot a limit by N-1; backstopped today by the dollar cap.

### Gate 1 — Compliance / Legal (the primary regime is FTC + state law, NOT HIPAA)

*The legal characterizations below reflect our working read of the regime and the cited enforcement precedents in the brief; they are **subject to review by privacy counsel before launch**, not settled legal opinion.*

For a pure consumer-controlled PHR, **HIPAA generally does not apply** (the user supplies data directly; consumer-directed FHIR does not, by itself, create a Business-Associate relationship). Our counsel's working read of the primary regime is:

- **FTC Health Breach Notification Rule (incl. 2024 amendments).** A consumer-uploaded PHR that *also* pulls FHIR **likely meets** the "multiple sources" test, which would make **HBNR our primary federal obligation** (subject to legal confirmation). The 2024 rule makes **unauthorized *disclosure* (e.g., ad-tracker sharing) itself a reportable breach**; per the brief, penalties run up to ~$51,744/violation, indexed annually. Notice ≤60 days; simultaneous FTC notice at 500+ individuals.
- **State consumer-health-data laws.** **Washington MHMDA carries a private right of action** (first class action filed Feb 2025; recovery is WCPA actual damages trebled up to a $25,000 cap — *not* statutory per-violation damages) and requires a **standalone Consumer Health Data Privacy Policy** + separate collect/share/sell consents + a geofencing ban. **Nevada SB 370** is parallel (AG-enforced). **CCPA/CPRA** treats health data as Sensitive Personal Information, with new ADMT/risk-assessment rules relevant to our AI (effective 2026).
- **FTC enforcement pattern to design against (penalty figures per the brief):** GoodRx ($1.5M, HBNR), BetterHelp ($7.8M, FTC Act §5), Premom ($100k, HBNR), Flo (FTC Act §5). The recurring trigger across all four is **third-party ad/analytics trackers firing on health data without consent.** This is our single highest-probability enforcement vector.

**Gate 1 checklist (must close before any paying consumer):**
- [ ] **Audit every SDK/pixel/tracker** — no Meta Pixel, Google Analytics, or ad SDK firing on health data without explicit opt-in consent. *(This is the #1 enforcement vector — the GoodRx/BetterHelp/Premom/Flo failure mode.)*
- [ ] Publish a **general Privacy Policy + ToS + a standalone Consumer Health Data Privacy Policy** (WA/NV); identical privacy-policy URL across web/app.
- [ ] **AI medical-advice disclaimer** ("not a medical device; does not diagnose, treat, or prevent; consult a professional"), with marketing language consistent with the wellness positioning (FDA judges the totality of claims).
- [ ] **Breach-response runbook** + a named **Security Officer** (pulled forward from the otherwise-deferrable HIPAA paperwork because the HBNR breach clock cannot start without breach *detection*).
- [ ] **Confirm vendor BAAs for the services that actually touch PHI** — Google Cloud (Cloud SQL/GCS/Document AI), Quest, SendGrid are all currently *unconfirmed*. **SendGrid is not HIPAA-eligible** → restrict to provably PHI-free email or swap to Paubox/LuxSci. (Only the Anthropic BAA is signed today.)
- [ ] **Run the L24 plaintext-PHI backfill** — `user_files.original_filename` is still plaintext in prod (filenames embed patient names/dates); run the maintenance job, then drop the plaintext column.
- [ ] Working **data access / export / deletion** end-to-end (consumer legal expectation + the strongest health-trust signal), verified by a manual run-through.

> **Note on SOC 2 / HITRUST:** these are **trust signals for a consumer audience, not sales gates** — there is no enterprise buyer demanding them. We do **not** over-budget them as blockers. SOC 2 is a reasonable *post-launch* trust investment; neither is a present-tense compliance claim.

### Gate 2 — Product Hardening (demo → trustworthy daily record + D2C essentials)

The technical core is strong (encryption, FORCE RLS, audit, BAA gates). The gap is the *commercial and consumer-trust surface.* In rough priority:

- [ ] **P0 — Self-serve billing (Stripe), PRO only at launch.** The "Upgrade" button is a placebo ("Upgrades are not available yet. Contact us to upgrade manually."); plans are admin-assigned. **No checkout = no D2C product, and a fake CTA erodes trust on first contact.** Done when a consumer can **self-subscribe to PRO**, a webhook updates `users.plan`/`planExpiresAt`, downgrade/cancel/failed-payment are handled, and receipts are emailed. **TEAM self-subscribe is explicitly v2** — it ships only alongside the multi-member/family account model (none exists today; selling TEAM now would sell a product the code cannot deliver).
- [ ] **P0 — Cap the Document AI / OCR cost path (H-3, open High).** OCR dollars are never recorded against the budget; the $50/day cap bounds only Claude tokens. The moment billing opens publicly, a runaway/malicious user can drive an unbounded GCP bill. Done when OCR page cost is accrued via usage tracking and fail-closes like the Claude path.
- [ ] **P0 — MFA + tested account recovery.** This account *is* the user's medical record and insurance IDs; account takeover = direct PHI breach. Add TOTP MFA + backup codes + a tested recovery flow.
- [ ] **P0 — Breach-detection alerting** (also a Gate 1 legal dependency): wire Cloud Logging alert policies to audit anomalies, repeated login failures, and RLS boot-guard FATAL exits, routed to an on-call human.
- [ ] **P0 — Close the plan-limit bypass (M12/M13) and quota TOCTOU races** before charging — otherwise paid gating leaks.
- [ ] **P1 — Mobile / PWA.** The app is **web-only — no native app, no PWA, no push.** For a "check my health every morning" product this is the single biggest distribution/retention handicap. **Web-only push reach is ~10–15× worse than native on iOS** (the biggest retention penalty). Ship an **installable, offline-capable PWA (manifest + service worker + web push + "add to home screen" coaching after a value moment)** first; defer native (App Store/Play) to v2 — note Play now requires an **Organization account + D-U-N-S** for health apps (Jan 2026) and HealthKit is native-only.
- [ ] **P1 — Verify the onboarding/activation funnel end-to-end** (kill the placebo OCR step, dead goal-create, dead verification funnel — remediated but unverified).
- [ ] **P1 — Provision Redis** to remove the `--max-instances=1` pin (currently required for FHIR multi-instance correctness, H-2, open High) so we can autoscale for a launch spike and enforce exact spend caps.
- [ ] **P1 — Test the untested PHI-path controllers** (aiChat, fhir, file, labUpload, sbcUpload) — exactly the upload/AI/FHIR seams where prior teardowns found the real bugs.
- [ ] **P1 — Build the referral/invite + patient-initiated sharing primitives** (today: zero referral code; provider sharing is inbound-only) — prerequisite for the §2 growth loops.
- [ ] **P1 — Error/crash monitoring** (no observability SDK today) so we learn checkout/upload/sync breaks before a consumer emails us.

### Gate 3 — Distribution / Growth

Only after Gates 1–2: execute §2 in sequence — content/SEO + founder authority + ASO first (compounding, owned), then referral/community/CPA-influencer (amplifiers), then lab/wearable/telehealth partnerships, and **paid only last**, as a throttle on a proven machine. **NOT brokers. NOT paid-first.**

---

## 6. North-Star Metric & Funnel

### 6.1 North-star

> **Weekly Active Records (WAR): the number of users who, in the last 7 days, viewed a fresh personal data point *or* a cost/coverage answer grounded in their own record.**

This metric is true to the wedge (fresh data + cost, not raw logins), predicts retention (it captures the "<3 sessions in 14 days" churn signal), and is honest (it cannot be gamed by a vanity install number).

### 6.2 Funnel & target benchmarks

Benchmarks are health & fitness category figures from the cited sources in the brief; targets are **(illustrative)** planning anchors, not commitments.

| Funnel stage | Metric | Category benchmark | Launch target (illustrative) |
|---|---|---|---|
| Install / visit → signup | Signup rate | — | instrument first |
| Signup → activation | Added/extracted first biomarker in session 1 | — (we set this) | ≥ 40% |
| Activation → habit | ≥3 meaningful sessions in first 14 days | <3 = 3–4× churn | maximize |
| Install → trial start | Trial start rate | 11.2% global / 14.5% NA | ~12–14% |
| Free → paid (trial) | Trial → paid | 39.9%–42.2% | ~40% |
| Free → paid (no-trial freemium) | Download → paid | ~3.7% freemium / 10.7%–12.1% hard | freemium first |
| Paid retention | 1st renewal | 59.2% (H&F) | meet/beat benchmark |
| Paid retention | Day-30 free retention | 3–8% free | beat via fresh-data + push |
| Economics | LTV:CAC | 3:1 min, 3:1–6:1 H&F | ≥ 3:1 before paid spend |
| Economics | Annual mix | 60–67% of H&F subs are annual | push annual at the aha moment |

**Honesty flags (per the brief's source notes):** RevenueCat and Adapty differ on headline numbers (trial→paid 39.9% vs 42.2%; download→paid 10.7% vs 12.1%) — treat as ranges. Market concentration is sobering: **the top 10% of H&F apps capture ~92.6% of category revenue**, and only **~5% reach $10K revenue in two years**. Retention is getting *harder* (2026 category Year-1 cancellation ~72%). This is why §3's retention mechanics, not the paywall model, are the real game.

---

## 7. The Freemium → Paywall-Test Sequencing

**Decision (founder-set): launch freemium now; test a harder paywall later.** The data supports this exact path for a *record* app whose value compounds over days/weeks (you must log/sync data, then see trends) — the opposite of an instant-utility AI app where a hard Day-0 paywall wins.

### 7.1 Why freemium/trial first

- A hard, no-trial Day-0 paywall would gate users **before** the "aha," where they will not convert. Health & Fitness is explicitly a **"trial-inclusive"** category.
- Freemium builds the **funnel, trust, word-of-mouth, and the retention data** we need to run a *good* pricing experiment later. The preconditions to harden — proven PMF/retention, runway to absorb a conversion dip, and A/B tooling — are all things we *acquire by launching softer first.*
- Map to the **existing FREE/PRO plan-gating infra** (`requirePlanLimit`/`requirePlanFeature`; flags like `aiChatsPerDay`, `pdfUploadsPerMonth`, `questFhirIntegration`). Limits are already enforced fresh-from-DB and fail closed to FREE. **Fix the documented plan-limit bypass (M12/M13) and quota TOCTOU races before charging** (see Gate 2). *(TEAM exists in the gating substrate as display-only; it is not a launch SKU — see §7.2.)*

### 7.2 Concrete launch configuration (illustrative pricing)

- **Free tier:** manual biomarker entry + document vault, minimal/no AI + OCR — enough to build the funnel and trust.
- **Premium (PRO) — the one paid SKU at launch:** unlocks AI guidance, OCR/AI document extraction, insurance cost analysis, and FHIR lab-connect — the wedge value.
- **TEAM / family — NOT a launch SKU.** TEAM is display-only in the plan-gating substrate and there is **no multi-member account model in code**. TEAM self-subscribe is **v2**, shipping only when the family/multi-member account model is built; we do not sell it at launch.
- **Trial:** a **17–32 day** free trial on annual (NOT 3–7 days — long trials convert ~45% vs ~26% for short, and let users reach the multi-week "aha"); **onboarding-placed paywall that echoes the user's stated health/cost goal.**
- **Price anchor (illustrative):** ~**$69.99/yr + ~$9.99–12.99/mo** — the de-facto software-only health anchor (Calm/Headspace/Oura all converge near $69.99/yr; current placeholder PRO is $9.99/mo / $99/yr). **Annual is the profit/retention lever** (~68% adoption, 40–60% better retention; annual retains ~33% vs ~17% monthly).

### 7.3 When and how to test a harder paywall

**Trigger conditions (all must hold):** (1) core retention at/above H&F benchmarks — don't harden a leaky bucket; (2) runway to absorb a top-of-funnel/conversion dip (the ~5x conversion lift comes with an install-engagement collapse); (3) paywall A/B tooling live (RevenueCat/Adapty/Superwall); (4) **not dependent on organic/referral growth for distribution** — hardening kills that loop, which matters because our entire §2 motion *is* organic/referral.

**How to transition without alienating users:**
- **Phase it** (Headspace model: keep some free content per category first, then later fully gate once new-user engagement supports it — which produced a double-digit paid lift).
- **Grandfather existing free users**; never retroactively paywall what they already use.
- **Run it as a controlled experiment on the new-install cohort only**, freemium control held out; decide on **ARPU + Year-1 LTV + refund rate at Day 60**, not raw conversion %.
- **Budget for a higher refund rate** on the harder variant (~5.8% vs ~3.4%) — buyer's remorse before product trial, not a defect.
- **Endgame:** not "pick one" — keep a genuinely useful free tier for funnel/trust/WOM, with premium value (trends, exports, AI, cost analysis, integrations) behind the paywall and a long trial. Per the brief, a hard paywall converts ~5x better (10.7% vs 2.1%), but freemium builds the top-of-funnel and trust that our organic-first motion depends on. We capture both by sequencing.

---

## 8. The Honest Bottom Line

OwnMyHealth has an **A-/B+ security and data-integrity core** and a genuinely **differentiated, unoccupied market position** — the cost-aware health copilot no competitor fuses. But it is, today, **a finished single-player app with no go-to-market loop and no cash register**: no Stripe, no MFA, no mobile/PWA, no push, no referral loop, unconfirmed BAAs on the services that hold PHI, known plaintext-PHI residue in prod, and an uncapped OCR cost path. It is, in its own UX review's words, "a polished demo, not yet a trustworthy daily health record," and it holds **no certifications.**

The plan: **close Gate 1 (FTC/state-law compliance + tracker audit + breach runbook + vendor BAAs) and Gate 2 (PRO billing, OCR cost cap, MFA, breach alerting, plan-limit bypass, PWA, verified onboarding, referral primitives) before spending a dollar on acquisition** — then grow through compounding, organic, referral- and content-led channels around the cost+health fusion wedge, monetize freemium-first, and test a harder paywall only once retention data earns the right. The competitive window is real but finite — a planning judgment of **roughly one to two years**, not a researched countdown — before ChatGPT Health or a cost player spans the seam. Speed on the gates, and trust as the product, are how we use it.
