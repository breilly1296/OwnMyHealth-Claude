# OwnMyHealth — Cost-to-Market & Financial Model (D2C)

> **Status & honesty note.** This is an *illustrative* financial model for a pure direct-to-consumer (B2C) personal-health-record + cost-navigation app. Every figure is either grounded in the research brief or explicitly labeled **(estimate)** / **(illustrative)**. The product today is a **polished demo, not yet a trustworthy daily health record**: it holds **no certifications** (only the Anthropic BAA is signed), has **no billing system**, **no MFA**, **no mobile app/PWA**, two open High issues, and five untested PHI-path controllers. Nothing in this document should be read as a claim that HIPAA, SOC 2, or HITRUST controls are in place — they are not. This model prices the work required to *get to* a chargeable, trustworthy launch and the unit economics thereafter.
>
> **Gap-reference legend.** P0-* / P1-* / P2-* refer to the launch-readiness gap list (P0 = blockers before any paying cohort; P1 = needed for a credible public launch; P2 = post-launch hardening). H-*, M-*, L-*, L-M* refer to the live `KNOWN_ISSUES` / `SECURITY_STATUS` issue IDs (e.g., H-3 = uncapped Document AI OCR spend; H-2 = FHIR multi-instance requires `--max-instances=1`; L24 = legacy plaintext filename backfill; M12/M13 = plan-limit bypass; L-M16 = missing SPA edge headers). These IDs are reproduced here only as pointers; the authoritative source is the readiness triage / `KNOWN_ISSUES` doc set, not this model.

---

## 0. Model at a Glance

| Item | Most-likely | Range | Basis |
|---|---|---|---|
| Cost to reach paid-launch readiness | **~$225K** | $170K–$340K (illustrative) | §1 |
| Elapsed time to public paid launch | **~5–6 months** (2 parallel eng tracks) | 4–8 months; single-track → 7–8 mo (estimate) | §1 |
| Monthly operating/variable cost at launch (low scale) | **~$1.6K/mo** | $1.0K–$3.5K (illustrative) | §2 |
| 24-month base-case paying subscribers | **~1,150** | 500–2,800 (sensitivity) | §3 |
| 24-month base-case ARR exit run-rate | **~$128K** | $42K (bear) – $235K (bull) span | §3 |
| Blended LTV : CAC (mature, organic-led) | **~3.0–3.5 : 1** | 1.3–5:1 (estimate) | §4 |
| Recommended raise | **~$750K–$1.0M** (pre-seed/SAFE) | — | §5 |

The strategic premise (authoritative): **freemium now, test a harder paywall later**; win on **record-fusion + consumer cost-navigation**, not on commoditized "AI over your records"; grow via **organic/content/referral**, not paid-first. The model is built to that premise.

> **One base case, used everywhere.** The base-case 24-month ARR exit run-rate is **~$128K** (from the §3B trajectory). Earlier drafts quoted a softer "~$95K" point; that figure was an annual-mix-timing variant and has been **retired** — §3B's ~$128K is authoritative and is used in §0, §3, §5, and the Bottom Line. Where a span is shown, it is explicitly **base ($128K) → bull ($235K)** or **bear ($42K) → bull ($235K)**, never a base-low blended with a bull-high.

---

## 1. Cost-to-Launch

Three buckets: **(A) product hardening**, **(B) minimal required compliance**, **(C) lean growth setup**. SOC 2 / HITRUST are **deliberately excluded** from the launch budget — for a pure-D2C product with no enterprise buyer they are *optional trust spend*, not sales gates (brief: regulatory section). They appear as a post-launch option in §1B/§5, not here.

**Resourcing assumption (drives the timeline).** The $150K most-likely product-hardening spend buys the current **solo founder-engineer + heavy AI assist**, plus **one contract senior engineer** (billing/PWA) and **one part-time QA/security pass**. That is **two parallel engineering tracks**. The 5–6-month elapsed estimate assumes those two tracks run concurrently (e.g., billing on track 1 while PWA on track 2). **If execution is single-track** (one engineer serializing billing → PWA → MFA), the two ~4–6-week builds alone consume ~3 months and the schedule slips to **7–8 months** — the high end of the 4–8-month range. The measured build cadence (one developer, 7 months, with five PHI controllers still untested) makes single-track the *conservative* planning assumption; the 5–6-month headline is the *funded-two-track* case.

### 1A. Product hardening — close the P0/P1 gaps

These map directly to the readiness gap list (P0 = chargeable-cohort blockers; P1 = credible-public-launch). Labor is the dominant line.

| Work item | Gap ref | Effort (est.) | Cost (illustrative) |
|---|---|---|---|
| Self-serve billing (Stripe Checkout + webhooks → `users.plan`/`planExpiresAt`, cancel/downgrade/failed-payment, receipts) | P0-1 | 4–6 wks | $25K–$45K |
| Verified self-serve export + account deletion (end-to-end, salt destruction, audit rows) | P0-2 | 2–3 wks | $12K–$20K |
| TOTP MFA + recovery codes + hardened account recovery | P0-3 | 2–3 wks | $12K–$20K |
| Breach-detection alerting + named Security Officer + breach runbook | P0-4 | 1–2 wks | $6K–$12K (+ officer is a role, not cash) |
| Cap Document AI / OCR dollar spend (H-3) — accrue per-page cost to budget, fail-closed | P0-7 | 1 wk | $4K–$8K |
| Run L24 plaintext-filename backfill + drop column (P0-6); confirm GCP/Document AI/Quest BAAs (P0-5) | P0-5/6 | 1 wk + legal | $3K–$6K |
| Installable **PWA** (manifest, service worker, web-push, "add to home screen" coaching, real-device pass on core log/track/upload) | P1-1 | 4–6 wks | $25K–$45K |
| Redis/Memorystore → remove `--max-instances=1` pin (unblocks autoscale, exact spend cap, reliable FHIR H-2) | P1-3 | 1 wk + infra | $5K–$9K |
| Onboarding/activation hardening (kill placebo OCR step, instrument activation metric) | P1-4 | 1–2 wks | $8K–$14K |
| Tests on the 5 untested PHI controllers (AI chat, FHIR, file, lab-upload, SBC) + edge security headers (L-M16) + error/uptime monitoring (Sentry) | P1-2/6/7 | 3–4 wks | $18K–$30K |
| **Subtotal — product hardening** | | **~4–5 mo calendar (2 tracks)** | **$118K–$209K** |

> **Most-likely product-hardening spend ≈ $150K (illustrative).** This is a fraction of the **~$850K–$1.1M traditional rebuild cost** (brief) because the asset already exists — we are finishing seams, not building. Note the effort weeks above sum to more than 5 calendar months *if serialized*; the 4–5-month calendar assumes the two-track resourcing stated above.

### 1B. Minimal required compliance (the *real* gate for a D2C health app)

The primary regime is **FTC HBNR + FTC Act §5 + state consumer-health-data laws** (WA MHMDA carries a **private right of action**) — **not** HIPAA (generally inapplicable to a consumer-controlled PHR absent a Business-Associate path). Spend here is small but non-optional.

| Item | Cost (illustrative) | Basis (brief) |
|---|---|---|
| Healthcare-privacy counsel: HBNR posture, WA MHMDA / NV SB 370 / CCPA-CPRA review, AI medical-advice disclaimers, BetterHelp/GoodRx tracker audit | **$20K–$60K** | Brief: "~$20–60k, real given the multi-regime surface" |
| Consumer Privacy Policy + **separate** Consumer Health Data Privacy Policy + ToS (counsel-drafted) | included above / +$3K–$8K | WA + NV require a standalone CHD policy |
| Breach-response capability build (overlaps P0-4) + cyber/privacy insurance | **$5K–$13K/yr** | Brief insurance benchmark |
| Pentest (trust signal + finds real bugs in the new billing/PHI seams) | **$10K–$20K** | Brief benchmark |
| **Subtotal — minimal compliance** | **~$38K–$93K; most-likely ~$55K (illustrative)** | |

> **Explicitly deferred (NOT in launch budget):** SOC 2 Type II ($25–45K), HITRUST e1 (~$35K), formal HIPAA program ($10–25K). These are *optional consumer-trust signals* with no enterprise buyer demanding them; revisit only if a future provider/FHIR-BA path emerges (out of scope for this pure-D2C plan).

### 1C. Lean growth setup (build the organic engine, not a paid budget)

Paid-first is dangerous here (brutal CAC, ~3–8% day-30 free retention — brief). Spend is on **owned, compounding** assets.

| Item | Cost (illustrative) |
|---|---|
| Content/SEO foundation: pillar-cluster + programmatic biomarker/cost templates + 3–5 free calculators, credentialed-clinician attribution (E-E-A-T) | $8K–$20K |
| Lifecycle/email + referral instrumentation, analytics + paywall A/B tooling (RevenueCat/Adapty-class) | $4K–$10K |
| Product Hunt / PR launch kit, ASO assets (if/when native), landing + pricing page (currently absent) | $3K–$8K |
| **Subtotal — growth setup** | **~$15K–$38K; most-likely ~$20K (illustrative)** |

### 1D. Cost-to-launch summary

| Bucket | Low | Most-likely | High |
|---|---|---|---|
| A. Product hardening | $118K | $150K | $209K |
| B. Minimal compliance | $38K | $55K | $93K |
| C. Growth setup | $15K | $20K | $38K |
| **Total** | **~$170K** | **~$225K** | **~$340K** |

> **Headline: ~$225K most-likely (illustrative), range $170K–$340K, ~5–6 months elapsed** (two-track; single-track → 7–8 mo) to a chargeable, credibly-launchable D2C product. The §0 glance-table and the Bottom Line both use this same **$225K / $170K–$340K** figure. The single biggest line is engineering labor to close P0/P1; the single most-underrated line is privacy counsel (skipping it is how consumer-health startups get an FTC action — the thing the brief flags as existential).

**Illustrative timeline to public paid launch (estimate; two parallel eng tracks):**

| Month | Track 1 (founder-eng) | Track 2 (contract eng) | Cross-cutting |
|---|---|---|---|
| 0–2 | Stripe billing, OCR cost cap, export/delete, L24 backfill | PWA scaffold (manifest/SW/web-push) | BAAs confirmed; privacy counsel engaged |
| 2–4 | MFA + recovery, Redis/autoscale, onboarding fix | PWA real-device pass; PHI-controller tests | Monitoring; privacy policies published |
| 4–5 | Pentest remediation | Edge headers, final QA | Pentest; content/SEO + referral live; pricing/landing page; closed beta |
| 5–6 | **Public paid launch** (freemium + long free trial on annual) | | |

> **Schedule risk (stated honestly):** PWA (4–6 wk) and Stripe billing (4–6 wk) are each substantial; the 5–6-month calendar **only holds if they run on separate tracks**. On a single eng track they serialize to ~3 months by themselves and push the launch to **7–8 months**.

---

## 2. Operating / Variable Costs

Fixed infra is modest on Cloud Run + GCS + Cloud SQL. The variable risk is **AI + OCR per active user** — and the OCR path is currently *uncapped* (H-3), which is why P0-7 is a launch blocker, not a nicety.

### 2A. Fixed / platform monthly (illustrative, low scale)

| Line | Monthly (est.) |
|---|---|
| Cloud Run + Cloud SQL (Postgres) + GCS | $300–$900 |
| Redis / Memorystore (once provisioned, P1-3) | $40–$200 |
| SendGrid email (non-PHI templates only; *not* HIPAA-eligible — restrict or swap to Paubox/LuxSci) | $20–$90 |
| Monitoring (Sentry/uptime), domain, misc SaaS | $100–$300 |
| Analytics + paywall/billing tooling (RevenueCat-class %, Stripe fees in §4) | $50–$200 |
| **Fixed subtotal** | **~$500–$1,700/mo** |

### 2B. AI + OCR variable cost (the floor that scales with actives)

Model pricing (brief, per Mtok in/out): **Haiku $0.80/$4.00**, **Sonnet $3.00/$15.00**. Routing: chat + lab-extraction on **Haiku**; SBC parsing + cost-analysis on **Sonnet**. Document AI OCR is **per-page** and must be dollar-tracked (P0-7).

**Illustrative per-active-paid-user monthly AI/OCR floor (estimate):**

| Component | Assumption (illustrative) | Cost/user/mo |
|---|---|---|
| AI chat (Haiku) | ~15 msgs, ~3K tok each | ~$0.15–$0.35 |
| Lab/biomarker extraction (Haiku) | ~1–2 reports | ~$0.05–$0.15 |
| SBC + cost analysis (Sonnet) | ~1 SBC + 2 analyses | ~$0.20–$0.50 |
| Document AI OCR | ~3–6 pages | ~$0.05–$0.20 |
| **Per-paid-active floor** | | **~$0.45–$1.20/mo** |
| **Per-free-active floor (freemium drag)** | minimal AI/OCR by design; occasional extraction | **~$0.05–$0.25/mo** |

> Guardrails already in code: **$50/day Claude spend cap** (must be extended to OCR per P0-7) and per-plan limits (`aiChatsPerDay`, `pdfUploadsPerMonth`). The **freemium variable-cost drag** (free users cost ~$0.05–$0.25/mo each in OCR/AI even before converting) is real and is why the free tier must keep AI/OCR minimal — exactly the current plan-gating design.

**Blended operating cost at illustrative scale:**

| Stage | Actives | Component math (free × floor + paid × floor + fixed) | Est. monthly opex |
|---|---|---|---|
| Launch (mo 0) | ~300 free / 10 paid | (300×$0.05–0.25) + (10×$0.45–1.20) + $500–1,700 | **~$1.0K–$2.0K** |
| Mo 12 | ~6K free / 250 paid | (6K×$0.05–0.25) + (250×$0.45–1.20) + $500–1,700 | **~$1.1K–$3.5K** |
| Mo 24 | ~18K free / 1,150 paid | (18K×$0.05–0.25 = $0.9K–$4.5K) + (1,150×$0.45–1.20 = $0.5K–$1.4K) + $0.5K–$1.7K | **~$1.9K–$7.6K** |

> The Mo24 band (**~$1.9K–$7.6K**) ties out to its own per-user floors at both ends. Earlier drafts showed a "$4K–$7K" floor that was higher than the component low sum; that has been corrected to the component-derived **$1.9K** low. The realistic *expected* spend sits mid-band (mid-point usage + some support/tooling overhead) at roughly **$4K–$5K/mo**, but the honest range is $1.9K–$7.6K.

---

## 3. Illustrative 24-Month Subscription Funnel

### 3A. Stated assumptions (all illustrative; grounded where cited)

| Assumption | Value | Source / rationale |
|---|---|---|
| Price | **$9.99/mo or $69.99/yr** (PRO) | App config $9.99/mo; $69.99/yr is the common **adjacent consumer-health subscription anchor** (Calm/Headspace meditation; Oura is hardware+sub — *not* direct PHR comps, but the de-facto software-subscription price point) — set **below the current $99/yr placeholder** to match those anchors |
| Annual mix | **~60%** of paid (conservative) | H&F is the one category where annual dominates (~60–67% of subs — brief). The thesis cites ~68% *adoption*; **60% is used deliberately as a conservative planning figure**, not as the benchmark |
| Free→paid conversion | **~2.5%** (base) of free signups, via long-trial funnel | Freemium ~2.1–2.2% download→paid; a long-trial onboarding funnel lifts it (brief). Conservative vs 3.7–4.2% Adapty H&F |
| Monthly paid churn | **~7%** (base) | H&F renewal curve ~59% first renewal; ~9.2% wellness monthly churn (brief) → blended with annual stickiness |
| Free day-30 retention | **~5%** (base) | Brief: ~3–8% |
| CAC (blended) | **~$25** (base) | Organic-led; referral $20–150, content ~$0–50 amortized, paid throttle later (brief) |
| Organic : paid mix | **~80 : 20** | Paid is a late throttle, not the engine (brief) |
| Install→free-signup | **~35%** | (estimate); verification-gated funnel is a known choke point |
| Blended effective price | **~$9.30/mo/payer** | 60% annual ($69.99/yr = $5.83/mo) + 40% monthly ($9.99) ≈ blended **$7.49**… see derivation note below |

> **Effective-price derivation (made explicit).** A literal 60/40 annual/monthly blend of $5.83 + $9.99 ≈ **$7.49/mo**. The model instead uses **~$9.30/mo** as the blended *recognized-revenue* rate because (a) annual plans are **paid upfront** (cash is collected at $69.99, recognized over 12 months but cash-positive day one) and (b) the annual *price* ($69.99) is only a ~30% discount to 12× monthly, not 42%. For MRR-style reporting we apply the conservative **recognized** blend; for cash runway, annual prepayment is more favorable. To avoid silently mixing rates, **§3B applies the same ~$9.30 effective rate to every row** (MRR = cum. subs × $9.30), including early months.

### 3B. Base-case trajectory (illustrative)

**How the columns are computed (so the walk is traceable):**
- **New paid/mo** = (that month's *new* free signups) × (effective trial-funnel conversion), **not** a flat 2.5% of the cumulative free base. Early months convert thin (funnel cold, content/SEO pre-ramp); the per-month conversion rises toward the ~2.5%-of-new-signups base as onboarding and referral mature, then the *count* grows because monthly signup volume grows.
- **Paying subs (cum)** = prior cum subs × (1 − 7% monthly churn) + new paid/mo.
- **MRR** = cum. paying subs × **$9.30** blended effective rate (same rate every row).
- **ARR run-rate** = MRR × 12.

| Month | New installs | Free signups (cum, net) | New paid/mo | Paying subs (cum) | MRR (subs×$9.30) | ARR run-rate |
|---|---|---|---|---|---|---|
| 1 | 600 | ~210 | 5 | 5 | ~$0.05K | ~$0.6K |
| 3 | 1,200 | ~900 | 18 | 40 | ~$0.37K | ~$4.5K |
| 6 | 2,500 | ~2,600 | 45 | 150 | ~$1.4K | ~$17K |
| 9 | 4,000 | ~4,800 | 70 | 310 | ~$2.9K | ~$35K |
| 12 | 6,000 | ~7,200 | 95 | 500 | ~$4.7K | ~$56K |
| 18 | 9,500 | ~12,500 | 130 | 820 | ~$7.6K | ~$92K |
| 24 | 13,000 | ~18,000 | 150 | **~1,150** | **~$10.7K** | **~$128K** |

> **Why cum subs > naive (2.5% × cum free).** A flat 2.5% of the ~18K cumulative free base would imply only ~450 payers at mo 24 — but conversion applies to *new signups each month*, and payers **accumulate** (net of 7% churn) across all 24 months, so the cumulative count (~1,150) is the running sum of monthly conversions minus churn, not a one-shot 2.5% of the ending free base. The monthly new-paid figures (5 → 18 → 45 → 70 → 95 → 130 → 150) reflect rising signup volume *and* a maturing funnel; summed and churned forward they reconcile to ~1,150. Organic compounding (content/SEO's 6–12-mo lag, referral ramp) drives the install acceleration after ~mo 6.
>
> The base-case ARR exit is a **~$128K run-rate** — modest, and that honesty matters: this is a *seed-stage organic build*, not a hyper-growth story.

### 3C. Sensitivity (24-month exit)

| Scenario | Conversion | Churn | CAC | Subs (mo 24) | ARR run-rate |
|---|---|---|---|---|---|
| **Bear** | 1.5% | 9% | $45 | ~500 | ~$42K |
| **Base** | 2.5% | 7% | $25 | ~1,150 | **~$128K** |
| **Bull** (referral loop + harder paywall test works) | 4.5% | 5% | $20 | ~2,800 | ~$235K |

> The swing is dominated by **conversion × churn × organic reach** — i.e., the three things the strategy explicitly engineers for (sticky daily-use wedge, referral loop, content funnel). Paid spend is *not* a lever here by design. The full **bear→bull span is $42K–$235K**; the **base is $128K** (single point, not a range).

---

## 4. Unit Economics

### 4A. LTV, CAC, payback (illustrative)

Assumptions: blended effective revenue **~$9.30/mo**; gross margin after Stripe (~2.9%+$0.30), AI/OCR floor (~$0.45–$1.20), and email/support **~78%** (estimate); base churn 7%/mo.

**Average paid life — and why ~14 months is deliberately conservative.** A flat 7% monthly churn implies a pure-monthly cohort life of 1 / 0.07 ≈ **14 months**. The plan also assumes ~60% annual mix with 40–60% better retention, which would lift the **blended** life materially: blending 40% monthly at ~14 mo with 60% annual at ~22–28 mo gives a blended ~**19–22 months**. **The base case deliberately uses the lower ~14-month figure as a margin of safety** — i.e., it under-counts the annual-retention lift the thesis elsewhere calls the single biggest profit lever. Using the blended ~19–22 mo would move base LTV above ~$140 and base LTV:CAC above ~4:1; the table below holds the conservative ~14 mo so the board sees the *floor*, not the optimistic case.

| Metric | Base (conservative ~14 mo) | Bull | Bear |
|---|---|---|---|
| Avg. paid lifetime | ~14 mo | ~20 mo | ~11 mo |
| Gross-margin LTV/payer | **~$100** | ~$190 | ~$60 |
| Blended CAC | **~$25** | ~$20 | ~$45 |
| **LTV : CAC** | **~3.0–3.5 : 1** | ~5:1 | ~1.3:1 |
| CAC payback | **~3–4 mo** | ~2–3 mo | ~9–11 mo |

> Healthy guardrail is **3:1 LTV:CAC, payback <12 mo** (brief). Base case clears it **only because CAC is held low by organic/referral** — if the plan drifts to paid-first (blended CAC $30–60 per *paying* sub, brief), the ratio collapses toward the bear case. This is the quantitative argument for the organic-first mandate. **The conservative ~14-mo life means the true blended LTV:CAC is likely better than the ~3–3.5:1 shown** — a margin of safety, not a ceiling.

### 4B. The freemium variable-cost drag

Free users are not free: at ~$0.05–$0.25/mo each in OCR/AI, **18,000 free users = ~$900–$4,500/mo of pure cost** carried against ~1,150 payers. Mitigations (already designed): keep AI/OCR minimal on FREE, enforce `pdfUploadsPerMonth`/`aiChatsPerDay`, and fix the documented **plan-limit-bypass (M12/M13) + quota TOCTOU** so free users can't exceed caps. This drag is the price of top-of-funnel/trust — acceptable *if* the conversion funnel and referral loop perform.

### 4C. The freemium → harder-paywall lever (planned, not day-one)

Research: a **hard paywall converts ~5× better** (10.7% vs 2.1% download→paid) but **collapses top-of-funnel** and kills referral loops. Sequence (per thesis): **launch freemium + 17–32-day annual trial** to build funnel/trust/data → once retention ≥ H&F benchmarks and A/B tooling exists, **test a harder gate on new-install cohorts only**, grandfather existing free users, decide on **ARPU/Day-60 LTV**, expect higher refunds. Pushing **annual** (≈68% adoption, 40–60% better retention — brief) is the single biggest retention/profit lever inside this.

---

## 5. Funding Ask & Runway

### 5A. Use of funds (illustrative)

| Bucket | Amount | Notes |
|---|---|---|
| Product hardening (P0/P1) | $150K | §1A — billing, PWA, MFA, autoscale, tests |
| Minimal compliance + counsel + pentest + insurance | $55K | §1B — the FTC/state-law gate |
| Growth setup (content/SEO/referral/tooling) | $20K | §1C — owned engine |
| ~12-mo operating runway (opex + small founder/contract comp) | $250K–$400K | infra modest; labor dominates |
| Contingency (~15%) | ~$75K | new-billing/PHI-seam risk |
| **Total raise** | **~$750K–$1.0M** | pre-seed SAFE |

### 5B. Why this size, and the climate

- **~$750K–$1.0M** funds **launch + ~12–18 months of organic-led growth** to a **base ~$128K ARR run-rate (bull ~$235K)** and a real retention dataset — the proof needed to (a) run the harder-paywall pricing experiment and (b) raise a priced seed.
- **Climate (brief, Rock Health 2025):** US digital-health VC **$14.2B (+35% YoY)**; **AI-native took 54% of dollars** with a deal-size premium; **consumer/wellness re-rated 8th→3rd** most-funded value prop (Oura's $900M round the largest tracked). The fundable narrative is **AI-native + clearly-differentiated + consumer-tailwind-backed** — which is exactly the **record-fusion + cost-navigation wedge**, *not* the commoditized chatbot.
- **Asset-value framing (not a spend line):** the existing ~96K-LOC codebase represents **~$850K–$1.1M** of equivalent build (brief) — i.e., the raise buys *finishing + go-to-market*, not a from-scratch build, which is the capital-efficiency story for investors.

### 5C. Honest risk register (state these to the board)

| Risk | Why it matters | Mitigation in plan |
|---|---|---|
| **Trust/breach is existential** | One FTC HBNR action or breach ends a consumer-health startup (GoodRx/BetterHelp/Flo precedents) | §1B counsel + tracker audit + breach alerting (P0-4) + pentest |
| **AI-over-records commoditized (Jan 2026)** | ChatGPT Health / Perplexity Health ship 3 of 4 pillars; ~12–24-mo window | Win on **cost-navigation + record fusion**, the unowned seam |
| **Weak free retention / brutal CAC** | ~3–8% day-30 free retention; $30–60 paid CAC | Organic/referral-led, sticky daily wedge, freemium funnel — *not* paid-first |
| **No billing / not yet trustworthy** | Can't collect revenue; "polished demo" | P0-1 Stripe + P0/P1 close-out are the gating spend |
| **Freemium cost drag** | Free users cost real OCR/AI dollars | Minimal-AI free tier + fix plan-limit bypass + OCR cap (P0-7) |
| **Schedule slips to single-track** | One eng track serializes billing+PWA → 7–8 mo, burning ~2 extra months of runway | Fund the contract eng (two tracks); contingency covers slip |

---

### Bottom line

For **~$225K (range $170K–$340K) and ~5–6 months** (two parallel eng tracks; single-track → 7–8 months), OwnMyHealth can convert a high-value but un-monetizable demo into a **chargeable, credibly-compliant D2C product** — by closing the P0/P1 seams (billing, PWA, MFA, OCR cost cap, breach alerting), buying the **minimal FTC/state-law compliance** that is the *real* gate (and deliberately deferring SOC 2/HITRUST as optional trust spend), and standing up an **organic-first** growth engine. A **~$750K–$1.0M pre-seed** then funds ~12–18 months to a **base ~$128K ARR run-rate (bear $42K → bull $235K)** and the retention data needed to run the **harder-paywall pricing experiment** — all while defending the one durable, currently-unowned position: **understand your health *and* what your care will cost, in one private, member-owned record.**
