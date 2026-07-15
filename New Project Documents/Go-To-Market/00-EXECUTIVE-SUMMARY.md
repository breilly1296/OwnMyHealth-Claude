# OwnMyHealth — Go-To-Market Executive Summary

*Board / Investor Brief · Prepared 2026-06-20 · Pure Direct-to-Consumer*

---

## The Recommendation

**Take OwnMyHealth to market as a pure direct-to-consumer (D2C) subscription app, launched freemium-first with a planned pricing experiment to test a harder paywall once retention data exists — and win on the one position no competitor occupies: an AI guide that reasons over your *own* longitudinal health record AND your *real* insurance costs in a single loop.** Do not compete on lab testing (Function is well-capitalized — reportedly a ~$2.5B valuation, Nov 2025, per PRNewswire — and wins that rail), on raw record aggregation (Apple, Epic, b.well own the rails), or on "AI chat over your records" — that was commoditized in January 2026 by ChatGPT Health, Copilot Health, Perplexity Health, and Claude for Healthcare. The defensible wedge is the **fusion plus the consumer cost-navigation angle**: *"understand your health AND what your care will cost, in one private, member-owned place."*

The strategic logic is simple. Every health/AI player (Function, Apple, Perplexity, ChatGPT) starts from your health data and either ignores cost or merely *interprets* an insurance document. Every cost player (GoodRx, Sidecar, Sheer Health, Goodbill) starts from the bill or the plan and has zero visibility into your labs, conditions, or biomarker trajectory. **The seam between "where am I trending" and "what will it cost / how do I pay less" is unowned.** *(Competitor positioning here is analyst assessment, not a brief-supplied fact.)* ChatGPT Health is the only player adjacent to it — making it the strongest future threat and putting a window on the opportunity of an estimated **12–24 months** (estimate).

---

## What OwnMyHealth Is

OwnMyHealth is a member-owned, encrypted personal health record that fuses three things competitors keep separate: (1) a **longitudinal biomarker + lab record** — drop in a lab PDF or sync Quest, and biomarkers are auto-extracted, tracked over time as a real time series, and flagged when out of range; (2) **insurance and cost navigation** — Summary-of-Benefits parsing, deductible/out-of-pocket projection, and AI cost analysis over the user's actual plan; and (3) an **AI guide grounded in the user's own data**. It is a genuinely deep single-player product — ~96,000 lines of production code, 19 data models, built over ~7 months and carrying a traditional-firm rebuild value of roughly **$850K–$1.1M** (most-likely; range $600K–$1.5M) as an asset. Its technical security core is strong: Postgres FORCE row-level security, per-user AES-256-GCM field encryption, audit logging, JWT rotation. The gaps are not in the engine — they are in the *commercial and consumer-trust surface*.

---

## The Three Gates — Where We Honestly Stand

We sequence launch through three gates. Honest status below; **the product is a "polished demo, not yet a trustworthy daily health record," holds no certifications (only the Anthropic BAA is signed), and is not HIPAA/SOC 2/HITRUST-attested today.**

| Gate | What it requires (D2C) | Honest status |
|---|---|---|
| **1 · Compliance / Legal** | Primary regime is the **FTC Health Breach Notification Rule** (2024 amendments; civil penalties up to ~$51,744/violation, indexed annually — FTC/Federal Register 2024) + state laws — Washington **My Health My Data Act has a private right of action**, plus CCPA/CPRA. HIPAA generally N/A for a consumer-controlled PHR. Plus app-store health policies, consumer privacy posture, AI medical-advice disclaimers. SOC 2 / HITRUST are *trust signals, not sales gates* for a consumer audience. | **Partially met.** Strong encryption/RLS core, but: vendor BAAs unconfirmed for services that touch PHI (Google Cloud, Document AI, Quest, SendGrid); legacy plaintext PHI residue in prod (filename backfill not run); no breach-detection alerting; no published consumer Privacy Policy / ToS / standalone consumer-health-data policy; stale README audit claims to retract. |
| **2 · Product Hardening** | Demo → trustworthy daily record, *plus* D2C essentials: self-serve billing, onboarding/activation, retention loops, and mobile/PWA. | **Largely unmet on the commercial surface.** No Stripe — the "Upgrade" button is a "contact us" stub (a launch blocker). No MFA. No mobile app or PWA (web-only — a real D2C gap). Two open High issues: H-3 (Document AI OCR spend uncapped) and H-2 (FHIR needs `--max-instances=1` until Redis). Five PHI-path controllers untested. Known trust-breakers reported fixed but **unverified end-to-end.** |
| **3 · Distribution / Growth** | Consumer growth: content/SEO, referral/virality, community, creator/influencer, ASO, and lab/wearable/telehealth partnerships. **Not paid-first.** | **Unbuilt.** No referral/invite system, no patient-initiated sharing, no public pricing/landing surface, no push/PWA re-engagement. Retention rests entirely on an email scheduler. No viral loop exists yet. |

---

## Headline Numbers

| Dimension | Read |
|---|---|
| **Differentiated wedge** | The only consumer product whose AI sees both your longitudinal clinical/biomarker data *and* your claims/deductible/bills/Rx costs, using each to inform the other. White space assessed vacant (analyst view); window ~12–24 months (estimate). |
| **Asset value (context, not spend)** | ~$850K–$1.1M most-likely rebuild cost; ~96K LOC already built. |
| **Cost to reach first paying cohort** | ~$120K–$220K (illustrative): Stripe + self-serve billing, MFA, breach alerting, OCR cost cap, PHI backfill, PWA, privacy counsel for HBNR/state-law/AI-disclaimers (~$20–60K), plus legal artifacts. Excludes optional trust spend (SOC 2 $25–45K, pentest $10–20K — benchmark estimates) which are **not** launch gates. |
| **Time to first paying cohort** | ~3–5 months (estimate), gated by closing the seven P0 blockers below. |
| **Target CAC/LTV shape** | **Organic/referral/content-led, NOT paid-first.** Target paying CAC ~$30–60 (research anchor); fully-loaded LTV:CAC ≥ **3:1** (4–6:1 reported typical for health/wellness — industry estimate). Pricing anchors and trial length under "Monetization" are illustrative experiment inputs, not settled. |
| **Monetization model** | **Freemium now** (manual entry + document vault, minimal AI/OCR) → Premium unlocks AI guidance, OCR/AI extraction, insurance cost analysis, FHIR lab-connect. **Then test a harder paywall later** (hard paywalls convert ~5x better — 10.7% vs 2.1%, RevenueCat research anchor — but freemium builds top-of-funnel + trust first). Push **annual** plans (~68% adoption; 40–60% better retention — research anchors). Maps to existing FREE/PRO plan-gating infra; **billing not yet wired.** Illustrative anchors to validate: ~$69.99/yr + ~$9.99–12.99/mo with a longer (17–32 day) trial (estimates — longer trials reportedly out-convert short ones; to be A/B-validated). |
| **Market context** | SAM anchored on **US mHealth apps** (~$12B, ~11% CAGR — Grand View Research 2024, third-party estimate), deliberately *not* the broader "digital health" headline (~$140B US / ~$493B global — IMARC/Nova One 2024–25, directional). Adjacent feature value: PHR software (~$10B global, low-single-digit growth — Research and Markets 2025) and consumer price-transparency (~$2B, B2B-skewed — The Business Research Company 2025). All market-sizing figures are third-party, definition-sensitive estimates. |
| **Consumer tailwinds** | 34% of covered workers now hold $2,000+ single-coverage deductibles (KFF 2025 Employer Health Benefits Survey); 57% of individuals used an app — not just a portal — to access records in 2024 (ASTP/ONC Data Brief No. 77, 2025). Both are primary-source consumer-demand signals, not a B2B channel. |
| **VC climate** | Best since 2022: US digital-health VC ~$14.2B in 2025, +35% YoY, with AI taking ~54% of dollars (Rock Health 2025 Year-End, Jan 2026). Consumer/wellness re-rated from the 8th- to 3rd-most-funded value proposition (same source). |

**Three hard truths we confront head-on, not bury:** (1) brutal CAC (~$30–60/paying sub — research anchor) and weak free retention (~3–8% day-30 — research anchor) — so we engineer cheap organic/referral/content growth and a sticky daily-use wedge, never paid-first; (2) the Jan-2026 commoditization of generic AI-over-records — we win on cost-navigation + record fusion; (3) consumer-PHI trust *is* the product — one breach or FTC action ends a consumer health startup.

---

## What We Do Next

1. **Close the seven launch-blocking P0s** before any paying consumer: wire **Stripe self-serve billing**; **build (or verify, if present) self-serve data export + account deletion** — required by WA MHMDA/CCPA and app-store policy, status in codebase unconfirmed; add **TOTP MFA + recovery**; stand up **breach-detection alerting + a named Security Officer + breach runbook**; confirm **vendor BAAs** (Google Cloud, Document AI, Quest; SendGrid PHI-free or swapped); run the **plaintext-PHI backfill**; and **cap Document AI OCR spend** (H-3) to prevent a runaway vendor bill as upload volume scales.

2. **Publish the consumer legal + trust surface:** standalone consumer Privacy Policy, Terms, and a **Consumer Health Data Privacy Policy** (WA/NV); prominent, *true* "we never sell or share your health data for advertising" promise (legally enforceable post-GoodRx); AI medical-advice disclaimers; retract stale README audit claims.

3. **Ship an installable PWA** (manifest, service worker, web push, "add to home screen" coaching) to close most of the web-only retention/engagement gap cheaply; defer native until HealthKit/App-Store discovery becomes conversion-limiting.

4. **Make the bucket not leak:** instrument activation, engineer onboarding to drive **3+ sessions in the first 14 days** (the #1 churn predictor — Adapty research), fix the placebo onboarding steps, and add a real re-engagement loop (trends/new-result/reminder) before spending a dollar on acquisition.

5. **Stand up the freemium funnel + pricing experiment infrastructure:** onboarding-placed paywall echoing the user's stated health goal, annual-anchored pricing with a longer trial, and A/B tooling to later test a harder paywall on **new-install cohorts only** (grandfather free users; decide on ARPU/LTV at Day 60). Treat all specific price points and trial windows as hypotheses to validate, not commitments.

6. **Build owned, compounding growth engines** (months 1–6, in parallel): **content/SEO + programmatic** biomarker/cost pages and free calculators (Flo's content engine reportedly drives ~6M monthly visitors — Growth Case Studies 2024); **founder/clinician authority** on the health-podcast circuit; **ASO**; and a **double-sided, activation-gated referral loop** (Whoop reports referral driving >10% of sign-ups — Talkable 2022). Add **wearable/lab partnerships** via an aggregator for stickiness. **Paid is a throttle applied last, only after LTV:CAC clears 3:1.**

7. **Harden the seams that break trust:** verify the reported trust-fixes end-to-end, add tests to the five untested PHI-path controllers, and provision **Redis** to remove the `--max-instances=1` pin (unblocking autoscale, exact spend caps, and reliable FHIR) ahead of a launch spike.

---

*Bottom line: the engine is built and valuable; the go-to-market machine is not. Close seven P0 trust/safety/billing blockers, publish the consumer legal-and-trust surface, ship a PWA, and grow on owned/organic loops — and OwnMyHealth can own the vacant cost-aware-health-copilot position before a big-AI entrant bolts a cost layer onto its record product.*
