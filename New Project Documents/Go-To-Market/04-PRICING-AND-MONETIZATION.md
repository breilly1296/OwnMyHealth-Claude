# OwnMyHealth — Pricing & Monetization (Freemium → Paywall Test)

> **Status & honesty note.** OwnMyHealth is a pure direct-to-consumer (B2C) product: individuals sign up, upload their own health and insurance documents, and own their record. There is no employer, broker, benefits, TPA, or per-employee channel anywhere in this plan. This document describes the **intended** monetization model. As of 2026-06-20 the product is, by its own UX review, a *"polished demo, not yet a trustworthy daily health record"*: **billing/Stripe is not wired** (the "Upgrade" button is a placebo that tells users to email support), the app holds **no certifications** (only the Anthropic BAA is signed — not HIPAA, SOC 2, or HITRUST), there is **no mobile app/PWA**, **no MFA**, and known cost-control holes remain open (H-3 OCR spend uncapped; in-memory quota caps until Redis). Every dollar figure below is **illustrative** unless cited to the research brief, and nothing here should be read as a claim that the revenue machinery exists today. Wiring self-serve billing is the single hardest launch blocker this document presumes will be closed first — alongside the legal gate in §6.

---

## 1. The Freemium-NOW Design

The decision (the founder's explicit call) is **freemium now, with a planned pricing experiment to test a harder paywall later** once retention data exists. The goal of the free tier is to build top-of-funnel and trust; the goal of the paid tier is to monetize the features that (a) carry real marginal cost and (b) constitute the differentiated wedge — **record + cost-navigation fusion**, not generic "AI chat over your records" (which was commoditized in Jan 2026 by ChatGPT Health, Copilot Health, Perplexity Health, and Claude for Healthcare).

The split maps **directly onto the plan-gating substrate that already exists** in code (`requirePlanLimit` / `requirePlanFeature`; flags like `aiChatsPerDay`, `pdfUploadsPerMonth`, `questFhirIntegration`; `aiSpendGuard`). No new gating architecture is required — only the billing layer to move users between tiers, plus closing the documented plan-limit-bypass (M12/M13) and quota TOCTOU races.

### Free vs. Premium feature map

| Capability | Free | Premium | Existing gate / flag |
|---|---|---|---|
| Manual biomarker entry + longitudinal history | ✅ Full | ✅ Full | biomarker count limit |
| Document vault (upload, store, download, delete) | ✅ Full | ✅ Full | — |
| Data export + account deletion | ✅ Always-on, every tier | ✅ | ungated by design (consumer right) |
| Insurance plan storage (manual) | ✅ Limited count | ✅ Higher/unlimited | insurance-plan count limit |
| Engagement emails / notifications | ✅ | ✅ | preference-gated |
| **OCR / AI document extraction** (lab PDF → structured biomarkers; SBC parsing) | ❌ (minimal/none) | ✅ | `pdfUploadsPerMonth` |
| **AI health guidance** (chat + per-biomarker guidance) | ❌ (minimal/none) | ✅ | `aiChatsPerDay`, `aiSpendGuard` |
| **Insurance cost analysis** (out-of-pocket projection, AI cost optimization) | ❌ | ✅ | cost-analysis limit |
| **FHIR lab-connect** (Quest auto-sync) | ❌ | ✅ | `questFhirIntegration` |
| Health profile (PRO-gated today) | ❌ | ✅ | `healthProfile` |

**Design principle:** Free is a genuinely useful **manual personal health record + document vault** — enough to build the habit and earn trust, but it deliberately withholds the two things that *cost money to deliver* and *define the wedge*: AI/OCR extraction and the fused cost-navigation layer. This is the canonical "freemium as a base layer, subscription stacked on top" pattern — keep a real free tier for funnel/trust/word-of-mouth, gate the premium value (AI, OCR, cost analysis, integrations) behind the wall.

> **Naming note.** Internally the tiers are `FREE` / `PRO` / `TEAM`. For pure D2C, **`TEAM` is positioned to consumers as a "Family/Caregiver" plan** — it is *not* a B2B seat product, and today it is only a higher set of numeric limits on a single account with **no family/multi-member model in code**. Treat the family tier as a **roadmap SKU, not a shipped one**; the launch decision is Free vs. a single Premium.

---

## 2. Illustrative Price Points

Annual is **pre-selected** in the UI because it is the profit and retention lever: per the brief, **~68% annual adoption** in this category and **40–60% better retention**, and Health & Fitness is the one category where annual *dominates* the mix (60.6–67% of subscriptions / 61% of revenue are annual). Monthly exists as an option but is priced so annual is obviously cheaper per month.

### Benchmark anchors (from the brief)

| Comp | Price | What it bundles | Relevance |
|---|---|---|---|
| Typical fitness/wellness app | ~$10–20/mo | software only | direct price-band peer |
| Calm / Headspace / Oura (software) | **~$69.99/yr** anchor | software only | the de-facto software-only annual anchor |
| Oura premium | ~$5.99/mo (+ $349 hardware) | device analytics | proven low monthly WTP |
| Superpower | **$199/yr** | + physical lab draws | NOT a software-only comp (bundles labs) |
| Function Health | **$365/yr** | + 160+ labs 2×/yr, clinician review | NOT a software-only comp (bundles labs) |

> Function ($365) and Superpower ($199) are **not** like-for-like comps — both bundle physical lab draws and clinician services. OwnMyHealth is **software-only** (it ingests labs the user already has, it does not draw blood). The honest software-only anchor is the **~$70/yr Calm/Headspace/Oura band**, not the longevity-testing band.

### Illustrative OwnMyHealth pricing

> All figures **(illustrative)** — the in-code values (`PRO $9.99/mo, $99/yr`; `TEAM $19.99/mo, $199/yr`) are self-labeled "Placeholder, display only, no billing."

| Plan | Monthly **(illustrative)** | Annual **(illustrative, pre-selected)** | Effective $/mo on annual | Rationale |
|---|---|---|---|---|
| **Free** | $0 | $0 | $0 | Manual record + vault; funnel + trust |
| **Premium** | **~$9.99/mo** | **~$69.99–$99/yr** | **~$5.83–$8.25/mo** | Sits in the fitness $10–20 band on monthly; annual at/just above the ~$70 software anchor; monthly is **~1.2–1.7×** the effective per-month cost of annual (i.e., a ~30–40% annual discount — the standard annual nudge) |
| **Family/Caregiver** ***(roadmap, not launch)*** | ~$19.99/mo | ~$199/yr | ~$16.58/mo | Higher limits + (future) multi-member; defer until a real family model ships |

> **Annual-discount sanity check.** At $9.99/mo, the un-discounted year is ~$120. Pricing annual at ~$70–$99 makes the effective monthly ~$5.83–$8.25 — a **~17–42% discount** vs. paying monthly, which is the standard "annual is obviously cheaper" nudge. (If a steeper discount is later desired, the monthly price must rise in lockstep to keep both numbers consistent and stay near the ~$10–20 fitness band; do not widen the gap by quietly cutting the annual price alone.)

**Price as a quality signal (estimate, grounded in brief):** the brief notes higher-priced annual plans yield materially higher LTV (~$70 LTV vs ~$17 for low-priced; top-quartile pricing ~3× the LTV of bottom-quartile). Recommendation: anchor Premium annual nearer **$99** than $70 *if* the cost-navigation value proposition lands in testing — don't reflexively underprice the differentiated wedge. The price point is itself an experiment variable (see §4).

---

## 3. The Variable-Cost Floor — Why Free Must Gate the Costly Features

Unlike a pure-software subscription, **every premium action here has real marginal cost**. The free tier must therefore gate exactly the features that cost money, and Premium must price comfortably above embedded per-user cost. Two engines drive variable cost:

### Cost engines (from the brief)

| Cost driver | Pricing | Where used | Tracked against budget? |
|---|---|---|---|
| **Anthropic Claude — Haiku** | $0.80 / $4.00 per Mtok (in/out) | AI chat, lab extraction | ✅ Yes — counts against the $50/day cap |
| **Anthropic Claude — Sonnet** | $3.00 / $15.00 per Mtok (in/out) | SBC parsing, cost analysis | ✅ Yes — counts against the $50/day cap |
| **Google Document AI (OCR)** | per-page | every lab/SBC PDF upload | ❌ **NO — not dollar-tracked (H-3)** |

> **PHI-handling footnote (§1-legal-gate item, not just a cost item).** Document AI (OCR over user lab PDFs / SBCs) and the Claude paths process consumer PHI, and the lifecycle email path uses **SendGrid, which is *not* HIPAA-eligible and will not sign a BAA**. Before paid OCR/AI ships, each vendor's PHI flow must be confirmed against the consumer-privacy posture and the AI medical-advice disclaimer requirements: keep SendGrid restricted to **non-PHI** content (or swap to a HIPAA-eligible mailer such as Paubox/LuxSci), and confirm the Google Cloud BAA covers Document AI. These are legal-gate prerequisites (see §6), not merely economics.

### What protects margin today

- **$50/day dollar spend cap** (`aiSpendGuard`) — a hard circuit-breaker, but it **only bounds Claude token spend**, not OCR.
- **Per-plan quotas** — `aiChatsPerDay`, `pdfUploadsPerMonth`, cost-analysis count, etc., enforced fresh from the DB (lapsed plan → Free), failing closed to Free on DB error.
- **Model routing for cost** — cheap/high-volume work (chat, lab extraction) on Haiku; expensive/low-volume reasoning (SBC, cost analysis) on Sonnet.

### The open holes (must be honest about these)

1. **H-3 — OCR is uncapped in dollars (open High).** Document AI is per-page and **not** run through `trackAIUsage`, so the $50/day cap does not bound it. The moment billing opens to the public, a malicious or runaway user can drive **unbounded OCR spend** bounded only by request *counts*, not dollars — a direct path to a surprise five-figure GCP bill and/or self-inflicted DoS on a solo-founder budget. **This must be fixed before paid OCR ships**: estimate and accrue per-page OCR cost via `trackAIUsage` so it counts against the daily/per-user budget and fail-closes with 503 like the Claude path.
2. **In-memory caps until Redis (H-2 / M-1).** The spend accumulator, rate-limit store, and FHIR PKCE/token state are per-process. Without `REDIS_URL`, the service must run `--max-instances=1` or the **$50/day cap dilutes by N×** across instances (and FHIR connect breaks). Provisioning Cloud Memorystore/Redis is the single fix that unblocks autoscale **and** makes the spend cap exact across instances — a prerequisite for trusting the cost ceiling under any launch spike.
3. **Plan-limit bypass + quota TOCTOU (M12/M13, L34/L36).** Documented races let concurrent requests overshoot a limit by N-1; accepted-and-backstopped by the dollar cap today, but they weaken the margin guarantee and should be tightened (atomic reservation in the same RLS transaction) before a hard-paywall SLA is sold.

### Margin logic

The pricing rule is simple: **Premium annual revenue per user (~$70–$99/yr illustrative) must exceed that user's embedded Claude + OCR + infrastructure cost with comfortable headroom.** The plan quotas exist precisely to keep the heaviest users inside a known cost envelope. **Until H-3 is closed and Redis makes the cap exact, the true per-user cost ceiling is not actually known on the OCR line** — so closing those two items is a monetization prerequisite, not just a hardening nicety.

---

## 4. The Planned Paywall Experiment

### Why freemium first (not a hard paywall on day one)

The brief is explicit that a **hard paywall converts ~5× better** than freemium (≈10.7% vs ≈2.1% download-to-paid; ~$49.30 vs ~$24.24 Year-1 LTV per payer). So why start soft?

1. **Value compounds over days/weeks, not in the first session.** A longitudinal health record only delivers its "aha" *after* the user logs data and sees trends — the brief classifies Health & Fitness as a **trial-inclusive** category, the opposite of an instant-utility app where a hard Day-0 paywall wins. A hard gate before the aha moment gates users where they won't convert.
2. **Freemium builds the three things a good paywall experiment requires:** top-of-funnel, **trust** (the whole product in a consumer-PHI category where *trust is the product*), and the **retention + analytics data** needed to run the experiment well.
3. **The growth model is organic/referral/content-led, not paid-first** (brutal CAC ~$30–60; weak free retention ~3–8% day-30). A hard paywall's documented downside is a **top-of-funnel collapse** — fatal when distribution depends on word-of-mouth and SEO rather than paid acquisition.

### How and when to test a harder paywall

Move toward a harder gate (shorter/no trial, or more features locked) **only when all of these hold** — never harden a leaky bucket:

| Precondition | Why it gates the experiment |
|---|---|
| **Core retention proven** at/above Health & Fitness renewal benchmarks | A hard paywall converts more of who you keep but keeps far fewer; pointless on a leaky bucket |
| **Runway to absorb a conversion-rate + install-engagement dip** | The ~5× conversion lift comes with a top-of-funnel collapse |
| **Paywall A/B + analytics tooling live** (e.g., RevenueCat/Adapty/Superwall) so decisions read on **ARPU/LTV, not raw conversion %** | Price experiments improve LTV far more often than they lift conversion |
| **Not dependent on organic/referral growth at that moment** | Hardening kills the viral loop the brief says must carry growth |

### How to run it without alienating existing free users

- **Phase it; don't flip the whole library at once.** The Headspace playbook (from the brief): keep some value free per category first, *then* gate harder once new-user engagement is high enough to support it — which later produced a double-digit lift in paid subs.
- **Grandfather existing free users.** Do not retroactively paywall what they already use; abrupt full paywalls drive bounce.
- **Run it as a controlled experiment on the *new-install* cohort only**, with a freemium control held out; read **ARPU + Year-1 LTV + refund rate at Day 60** before rolling forward. Cadence: ~2–3 paywall experiments/quarter, decision metric = ARPU.
- **Favor a long free trial over a no-trial wall when you do harden.** The brief shows **17–32 day trials convert ~42–46%** vs only ~26% for 3–7 day trials — a long trial lets a longitudinal-value product reach its aha. Lead with a long-trial annual offer before testing a true no-trial gate.
- **Budget for higher refunds** on the harder variant (~5.8% vs ~3.4%) — buyer's remorse before product trial, not a defect.
- **Place the paywall in onboarding, echoing the user's stated goal.** Onboarding-placed paywalls more than double in-app-gate conversion; surfacing the user's own onboarding answers on the paywall outperforms most design tweaks. (This depends on the onboarding funnel being *real* end-to-end — the prior UX review flagged a placebo OCR review step and a dead goal-create path that must be fixed first.)

### Recommended concrete sequence

1. **Launch:** Free core + **Premium with a 17–32 day free trial on annual** (not a 3–7 day trial), onboarding-placed paywall echoing the user's health goal, anchored at **~$69.99–$99/yr + ~$9.99/mo (illustrative)** — annual pre-selected. *(Gated on Stripe being wired, H-3/Redis closed, and the §6 legal gate cleared.)*
2. **Instrument & retain:** track renewal curve, Day-60 ARPU, refund rate; drive retention with longitudinal trends, reminders, and (once built) referral + a re-engagement loop before touching pricing.
3. **Then test harder:** once retention ≥ benchmark *and* runway + A/B tooling exist, run a new-cohort hard-gate experiment, freemium control held out, existing users grandfathered, decide on ARPU/LTV at Day 60, expect a top-of-funnel dip + higher refunds.

---

## 5. Illustrative LTV / Unit Economics vs. CAC

> **All figures in this section are illustrative**, built from the brief's benchmark rates applied to OwnMyHealth's illustrative price points. They are planning skeletons, not measured results — the product has no billing and therefore **zero realized revenue** today.

### The CAC reality (from the brief)

- Fully-loaded **CAC ~$30–60 per paying subscriber**.
- Free-user **day-30 retention ~3–8%** (weak); **~30% of annual subs cancel in month 1**.
- Freemium converts **~5×** worse than a hard paywall (≈2.1% vs ≈10.7% download-to-paid).
- Healthy-economics guardrail: **LTV:CAC ≥ 3:1**, CAC payback **< 12 months**; health/wellness can run **3:1–6:1**.

### Funnel skeleton (illustrative, freemium + trial)

Applying the brief's benchmarks to a freemium-with-trial funnel: of 100 installs, ~11 start a trial, ~40–42% of those convert → **roughly 4–5 paying per 100 installs** via the trial funnel (a no-trial freemium gate lands closer to ~2–3.7 per 100).

### Per-subscriber economics (illustrative)

| Scenario | Price (illustrative) | Year-1 LTV per payer (illustrative) | vs. CAC $30–60 | LTV:CAC |
|---|---|---|---|---|
| Freemium baseline (brief Year-1 LTV/payer) | ~$70–$99/yr | **~$24** (brief freemium figure) | below mid-CAC | **~0.4–0.8 : 1** ❌ |
| Annual Premium, retention at benchmark | ~$99/yr | **~$46** (brief annual-plan H&F LTV) | near-to-above CAC | **~0.8–1.5 : 1** ⚠️ |
| Hard-paywall payer (brief) | ~$70–$99/yr | **~$49** Year-1 | above low-CAC | **~0.8–1.6 : 1** ⚠️ |
| Multi-year annual w/ strong retention (estimate) | ~$99/yr × ~2 yr | **~$90–$140** | clears 3:1 only at low CAC | **~1.5–3+ : 1** ✅ (only if retention holds) |

### What the numbers say (the honest read)

- **Year-1 LTV per payer alone does NOT clear a healthy 3:1 against a $30–60 CAC.** At a single year of revenue (~$24–$49 illustrative), the math is roughly break-even to underwater. This is the central unit-economics tension the brief insists be confronted head-on.
- **The model only works on three levers, in order:**
  1. **Drive CAC toward the floor via organic/referral/content/SEO**, *not* paid acquisition — paid-first against a leaky bucket "lights money on fire." Cheap acquisition is what makes a ~$24–$49 Year-1 LTV survivable.
  2. **Multi-year retention** — annual plans retain ~33% vs ~17% monthly; a payer who renews into year 2–3 is where the 3:1 actually materializes. Retention is the binding constraint, not conversion.
  3. **Protect contribution margin** — because every AI/OCR call has marginal cost, LTV must be read **net of embedded Claude + OCR cost**; closing H-3 and provisioning Redis are prerequisites for trusting that the per-payer contribution is positive.
- **Concentration risk (sobering, from the brief):** the top 10% of Health & Fitness apps capture ~92.6% of category revenue; only ~5% of H&F apps reach $10K total revenue in their first two years. A credible plan assumes this is hard, leads with cheap organic growth + retention, and treats the harder-paywall test as the lever to pull *after* retention is proven — not a shortcut around it.

> **Bottom line.** Freemium-now is the right sequencing for a trust-dependent, value-compounds-over-time consumer health record: it builds the funnel, the trust, and the data. But the unit economics only close if CAC is held to the organic floor and payers are retained into multiple years — and if the OCR cost hole (H-3) and the in-memory cap (Redis) are fixed so that "Premium priced above embedded cost" is actually *true* and not just intended. The paywall experiment is the planned mechanism to find the ARPU-maximizing gate **after** retention is demonstrated — run on new cohorts, grandfathering existing free users, decided on ARPU/LTV rather than raw conversion.

---

## 6. Legal Gate Before Paid Launch

Opening a public, paid funnel is exactly the act that sharpens consumer-PHI legal exposure — and the thesis is blunt that *one breach or FTC action ends a consumer health startup*. The compliance/legal gate is **first in order**, ahead of product-hardening and growth, and must be cleared before the paywall flips. For a pure consumer PHR, the operative regime is **not HIPAA**:

- **FTC Health Breach Notification Rule (HBNR), incl. the 2024 amendments.** A consumer-uploaded PHR that *also* pulls FHIR data meets the rule's "multiple sources" test, so the HBNR is the **primary federal obligation**. The 2024 amendments redefine a "breach" to include **unauthorized *disclosure*** — voluntary sharing of health data without consumer authorization (e.g., an ad/analytics SDK firing on health data) is itself a reportable breach. Notice is required within **60 days** (FTC notified simultaneously for breaches of 500+). Penalties run up to ~$51,744 per violation, re-indexed annually. Enforcement precedent: **GoodRx, BetterHelp, Premom, Flo** — the recurring trigger is third-party trackers on health data.
- **Washington My Health My Data Act (MHMDA).** Carries a **private right of action** ("BIPA 2.0" class-action risk; first class action filed Feb 2025) and requires a **separate Consumer Health Data Privacy Policy** plus separate opt-in consents for collection / sharing / sale. Treat MHMDA as the strictest baseline. (Nevada SB 370 imposes a parallel consent + geofencing-ban regime, AG-enforced.)
- **CCPA/CPRA.** Treat health data as **sensitive personal information**, honor "limit use of SPI" plus access/export/deletion rights, and assess the CPPA ADMT / risk-assessment rules (effective 2026) for the AI feature.
- **HIPAA applies only narrowly** — it attaches *only if* a provider/plan relationship or a Business-Associate path forms (e.g., building the app *for* a covered entity, or signing a BAA). Keep the FHIR connection strictly **consumer-directed**; do not sign BAAs or position the product as performing services *for* a provider/plan, or the whole data store flips into HIPAA scope.

**Must be in place before the paywall flips:**

- A truthful, prominent **consumer Privacy Policy + Terms of Service**, plus the standalone **Consumer Health Data Privacy Policy** (MHMDA/NV) — and **no** "we never sell your data" claim the architecture can't guarantee (it is legally enforceable post-GoodRx).
- **AI medical-advice disclaimers** ("information, not a clinical action plan; not a substitute for professional medical advice"), with marketing language aligned to the wellness positioning so the totality-of-claims stays out of FDA device territory.
- **App-store / platform health-data policies** satisfied *if/when* a mobile app ships (Apple 5.1.x health-data + in-app account deletion + privacy nutrition labels; Google Play health declaration + mandatory disclaimer + Jan-2026 Organization-account/D-U-N-S requirement). Web-only today defers these but not the FTC/state regimes.
- A **breach-response runbook** (60-day clock, 500+ simultaneous-FTC notice, third-party-recipient naming) with a named Security Officer and breach-detection alerting wired — the §164.404-style clock cannot start without detection.
- An audit that **no ad/analytics SDK or pixel fires on health data without explicit opt-in consent** — the single highest-probability enforcement vector.

**Do not over-budget the trust signals.** SOC 2 and HITRUST are *consumer-trust signals*, not launch gates for pure D2C — there is no enterprise buyer demanding them, and pursuing the B2B2C deal that would require them is also the thing that drags the product into HIPAA scope. They are a later, optional credibility spend, not a precondition for charging a first cohort.
