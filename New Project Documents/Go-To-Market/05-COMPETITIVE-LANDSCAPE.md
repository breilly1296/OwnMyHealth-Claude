# OwnMyHealth — Competitive Landscape & Differentiation (Consumer)

> **Document scope.** Pure direct-to-consumer (B2C). Every individual signs up, uploads their own health and insurance documents, and owns their record. There is no employer, broker, benefits, or per-employee channel anywhere in this analysis. Adjacent partnerships (labs, wearables, telehealth) are noted only as future product surface, never as a sales channel.
>
> **Readiness honesty.** OwnMyHealth today is, by its own UX review, a *"polished demo, not yet a trustworthy daily health record."* It holds **no certifications** — HIPAA, SOC 2, and HITRUST are **not** in place; only an Anthropic BAA is signed. Billing is not wired, there is no mobile app or PWA, and two High-severity issues are open (uncapped Document AI OCR spend; FHIR multi-instance pinned to one instance until Redis). This document positions where OwnMyHealth *can* win, not where it already has.
>
> **Sourcing convention.** Internal product facts come from direct codebase inspection. **Competitor pricing, funding, and usage figures are drawn from public reporting as of June 2026 and should be re-verified before board use** — they are marked *(reported)* throughout. Figures marked *(estimate)* are OwnMyHealth's own inference. Do not treat any *(reported)* competitor figure as independently verified.

---

## 1. The competitive question

OwnMyHealth competes for one consumer job: **"Help me understand my health *and* what my care will cost — in one private place I control."** That job sits at the intersection of four feature pillars:

1. **Personal health record (PHR)** — aggregate labs, documents, and clinical data the consumer owns.
2. **Biomarker trends** — longitudinal interpretation of lab values over time, flagged in/out of range.
3. **Insurance / cost navigation** — parse the Summary of Benefits, project out-of-pocket cost, analyze the financial side of care.
4. **AI grounded in the user's own data** — a guide that reasons over *this* user's records and *this* user's plan.

The field below is organized by which pillars each competitor owns. The recurring finding: **everyone owns one or two pillars; no one cleanly welds the health rail to the cost rail.**

---

## 2. The field, by category

### 2.1 Longevity / biomarker D2C — *they own "your biomarkers," not your record, and never touch cost*

These sell **lab panels + interpretation**. They generate health data; they do not aggregate your existing records, and **none touch insurance or cost.**

| Player | What it does for a consumer | Pricing *(reported)* | Key weakness |
|---|---|---|---|
| **Function Health** | Annual membership, 160+ biomarkers tested ~2×/yr, clinician review, action plan; lets users upload past labs/scans; "Private AI Chat" over *its own* lab data; Apple Health + wearable connect | **$365/yr** (~$1/day); advanced tests (cancer/Alzheimer's/MRI) extra | Lab-test-first, not a true longitudinal record; **zero insurance/cost layer**; AI scoped to its own labs; now a *connected data source inside ChatGPT Health* — risks being commoditized into a feed for someone else's AI |
| **Superpower** | Continuous-monitoring membership; one blood draw → 100+ biomarkers; app-booked draws via Quest/at-home; AI health coach; uploads past bloodwork | **$199/yr** core | Biomarker-centric, no record-aggregation depth, **no cost/insurance**; younger/smaller than Function |
| **Levels** | Metabolic-health app built on CGM; tiers add labs + clinician review; uploads past bloodwork | Membership **~$199/yr** (some sources cite $125 entry); CGM + labs separate | Narrow (glucose-led); CGM fatigue; no record breadth; **no cost/insurance**; capital-constrained vs the Function/Superpower wave (estimate) |
| **InsideTracker** | Blood-biomarker analysis + recommendations; analyzes uploaded data or new tests; added an AI coach | Membership **$149/yr**; blood plans $340–$489; up to ~$1,781/yr | Oldest-feeling of the cohort, thinly capitalized (last round Sep 2022, *reported*); **no cost/insurance**, no record aggregation |

**Category takeaway.** Well-funded — Function reportedly raised a **$298M Series B at a $2.5B valuation (Nov 2025)** and runs **~$100M revenue at ~200k+ members** *(reported; re-verify)* — but **single-rail**: they own biomarker *generation*, not the user's full record, and not a single one touches cost or insurance.

**Strategic implication for OwnMyHealth.** Do **not** compete on biomarker *testing* — Function's war chest wins that. Treat lab panels as an *ingested input*, and win on what they structurally lack: the longitudinal record fusion and the cost rail.

---

### 2.2 PHR aggregators — *they own record consolidation, but stop there*

These own **record consolidation**. They are weak or absent on biomarker-trend intelligence, mostly absent on cost, and none ships AI-grounded-in-your-data as the *product*.

| Player | What it does for a consumer | Pricing *(reported)* | Key weakness |
|---|---|---|---|
| **Apple Health / Health Records** | Aggregates clinical records (labs, meds, conditions) into iPhone via SMART-on-FHIR from **700+ health organizations** *(reported)*; consolidates wearables; share-with-provider | **Free** (bundled with iPhone) | **No cost/insurance/billing**; biomarker "trends" are shallow (values, not interpretation); no AI reasoning over the record; **iOS-only**; depends on each institution's FHIR support |
| **MyChart (Epic)** — *closest existing fusion* | Patient portal: meds, test results, appointments, **medical bills, price estimates** — "all in one place, even across organizations"; MyChart Central links portals | **Free** to patients | **Locked to Epic-running providers**; bills/estimates are *that provider's* charges, not cross-provider shopping or insurance optimization; no biomarker intelligence, no true AI-on-your-data; a tether to the health system, not a consumer-owned record |
| **Fasten Health** | Open-source, self-hosted family PHR aggregating records from 100,000s of insurers/hospitals via FHIR | Free self-hosted; **~$50 one-time** for desktop/cloud *(reported)* | Technical/self-host barrier; no biomarker intelligence, no AI, **no cost/insurance**; not a mass-consumer product |
| **b.well Connected Health** | FHIR platform unifying records + financial info + wearables | Partner-distributed, not consumer-priced (estimate) | **Not a true D2C product** — it's the *plumbing* behind others (now reportedly Perplexity's record backend via a Mar 2026 partnership); no consumer cost-navigation experience surfaced |
| **Hugo Health** | Cloud platform for individuals to acquire/harmonize health data; research-data orientation (Yale/VA usage) | Not clearly consumer-priced (estimate) | Research-leaning, low D2C presence; no biomarker-trend or cost-navigation experience |

**Category takeaway.** **MyChart is the only player already showing records + labs + bills + price estimates together** — but it is Epic-locked, shows only that provider's prices (no shopping/optimization), and has no biomarker intelligence or AI-on-your-data. Everyone else aggregates and stops.

**Strategic implication for OwnMyHealth.** Don't try to out-aggregate Apple/Epic/b.well on raw record rails — treat those as *inputs* (as Perplexity and ChatGPT do). The opening MyChart leaves wide is **cross-provider, consumer-owned, and cost-optimizing** rather than system-tethered.

---

### 2.3 AI health assistants — *the fastest-moving and most directly threatening category*

| Player | What it does for a consumer | Pricing *(reported)* | Key weakness |
|---|---|---|---|
| **ChatGPT Health (OpenAI)** | Dedicated "Health" space (launched **Jan 7, 2026**, *reported*); connect medical records/portals, Apple Health, Function; grounds answers in your labs, visit summaries, **and insurance documents**; helps you *"understand the trade-offs of different insurance options based on your healthcare patterns"* | No separate price; rolls out across Free/Go/Plus/Pro tiers; US-only at launch | Explicitly **not for diagnosis/treatment**; LLM hallucination risk; **does NOT do cost navigation** — no price-shopping, bill auditing, or claims work; insurance reach is limited to *interpreting* plan trade-offs; data sits inside OpenAI; a chat surface, not a structured longitudinal record with trend charts |
| **Perplexity Health** | Launched **~Mar 20, 2026** *(reported)*; connectors to personal health data — Apple Health + EHRs from **1.7M+ providers (via b.well)** + Fitbit/Withings/Ultrahuman; personalized dashboard that **tracks biomarker and activity trends over time**; AI answers factor in your bloodwork + cardiac history | Rolls out first to Perplexity Pro/Max subscribers | Educational only — "doesn't diagnose, treat, or prevent"; **no insurance/cost/bill navigation at all**; relies on b.well for the record backend (dependency) |

**Category takeaway — this is the clear-and-present danger.** Perplexity Health already ships **three of OwnMyHealth's four pillars** (PHR + biomarker trends + AI-on-data), missing only cost/insurance. ChatGPT Health adds the unique twist of *reading insurance documents and reasoning about plan trade-offs* — the closest anyone comes to the cost rail. **But neither does true cost navigation** (price-shopping, bill audit, claim optimization). Distribution context *(reported, re-verify)*: **~230M people ask ChatGPT health questions weekly**; **32% of consumers used an AI chatbot for health info in 2025, roughly double 2024's 16%** — these players carry enormous reach.

> **Honesty note.** The Jan-2026 arrival of these products **commoditized "AI chat over your records."** OwnMyHealth must **not** position on the chatbot. Its AI is a *feature in service of the fusion*, not the differentiator.

---

### 2.4 Consumer cost / insurance tools — *fragmented, and walled off from the health-record world*

| Player | What it does for a consumer | Pricing *(reported)* | Key weakness |
|---|---|---|---|
| **GoodRx** | Prescription discount/comparison across 70,000+ pharmacies | **Free** discounts; GoodRx Gold subscription exists | **Rx-only**; no records, labs, or broader cost navigation; flat growth ($796.9M FY2025 revenue, +1%, *reported*); a point solution |
| **Sidecar Health** | An *insurance plan* showing the "Benefit Amount" upfront for any procedure; shop providers, keep half the savings; publishes upfront pricing + quality scores | Access-style plans **~$175–$295/mo** (older structure) | It's a **carrier**, not a navigation layer over your existing plan; **only FL, GA, OH**; no health-record/biomarker side |
| **Healthcare Bluebook** | "Fair price" + quality ratings for procedures; shop highest-value providers | Almost entirely employer/health-plan distributed | **Not consumer-purchasable on its own** (out of pure-D2C scope; included for completeness); no records/biomarkers |
| **Bill-nav cohort** (Sheer Health, Goodbill, Counterforce) | Connect insurance, upload bills/claims; AI+humans track claims/deductibles and flag errors; bill negotiation; claim appeals | Sheer free + paid denial help; Goodbill **15% of savings**; Counterforce free | **None touch your clinical records, labs, or biomarker trends** — they start from the bill or the plan, never from your health |

**Category takeaway.** The cost world is **fragmented and siloed** — Rx (GoodRx), shoppable care (Sidecar/Bluebook), claims tracking (Sheer), bill negotiation (Goodbill). Every one of them starts from the bill or the plan and has **zero visibility into your labs, conditions, or biomarker trajectory.**

---

## 3. The white space OwnMyHealth occupies

### 3.1 Four-pillar coverage map

No competitor owns all four pillars. Mapping each:

| Player | PHR aggregation | Biomarker trends | Insurance / cost navigation | AI on your data |
|---|---|---|---|---|
| Function / Superpower / Levels / InsideTracker | weak (upload only) | **strong** | **none** | partial (own labs only) |
| Apple Health Records | **strong** | weak | none | none |
| **MyChart (Epic)** | strong (Epic-bound) | weak | **partial** (own-provider bills/estimates) | weak |
| Fasten / b.well / Hugo | strong | weak | none–weak | none |
| **ChatGPT Health** | **strong** (portals) | partial | **partial** (reads insurance docs, plan trade-offs) | **strong** |
| **Perplexity Health** | **strong** (1.7M providers) | **strong** (trend dashboard) | **none** | **strong** |
| GoodRx / Sidecar / Sheer / Goodbill | none | none | **strong** (each a slice) | partial (Sheer/Counterforce) |
| **OwnMyHealth (target)** | **medium** (upload + Quest FHIR) | **strong** (real time-series; behavior remediated, not yet fully verified) | **strong** (SBC parse + OOP projection + cost analysis) | **strong** (grounded in own record + plan) |

**The one genuinely unoccupied position: the *cost-navigation rail welded to the health rail.*** Every cost player starts from the bill; every health/AI player either ignores cost (Perplexity, Apple, Function) or only *interprets* insurance documents without acting on cost (ChatGPT). **The seam between "where am I trending" and "what will it cost / how do I pay less" is unowned.**

### 3.2 Positioning map (illustrative)

Two axes that capture the strategic geography:
- **X — Health depth:** does the product hold a deep, longitudinal, owned record (left = thin/none → right = deep owned record + biomarker trends)?
- **Y — Cost/insurance navigation:** does it act on the financial side of care (bottom = none → top = real SBC parse + OOP projection)?

```
  COST / INSURANCE NAVIGATION
        ^
 strong |  Sidecar •        MyChart        ◇ OwnMyHealth
        |  Sheer •          (Epic-locked,    (target white space:
        |  Goodbill •        own-provider     deep record + biomarker
        |  GoodRx •(Rx)      bills only)      trends FUSED with cost nav)
        |
        |                                  • ChatGPT Health
 partial|                                    (reads insurance docs)
        |
        |              • Hugo
   none |  ............ Fasten • ... Apple Health • ... Perplexity Health •
        |              b.well        (record only)     Function/Superpower/
        |                                              Levels/InsideTracker
        +-------------------------------------------------------------->
          thin/none          medium record           deep owned record
                          HEALTH DEPTH (record + biomarker trends)
```

*Reading: the entire upper-right quadrant — deep owned health record **and** real cost navigation — is empty. The cost tools cluster top-left (financial depth, no health record). The health/AI players cluster bottom-right (health depth, no cost). ChatGPT Health is the only competitor drifting toward the middle, which makes it the player most likely to close the gap (see §5).*

### 3.3 The wedge, in one sentence

> *An AI that reasons over your unified record **and** your real costs at the same time.* **Illustrative target reasoning loop** — *"Your LDL is trending up across three draws → here's the cheaper in-network lipid panel under your plan → here's the generic statin via a GoodRx-style price → and this line on your last visit's bill looks like a coding error."*
>
> **What is shipped vs. roadmap in that loop:** the **biomarker trend** (real time-series), the **in-network/under-plan cost framing** (SBC parse + out-of-pocket projection + AI cost analysis) are **shipped**. The **Rx price comparison** and **bill-error / coding-error detection** are **roadmap**, not built. **No competitor connects the clinical "why" to the financial "how much / how do I pay less" in one reasoning loop** *(estimate: this exact fusion is currently vacant)* — and OwnMyHealth does not yet own the full loop either; it owns the two anchor halves and the seam between them.

---

## 4. Defensible differentiators

Four differentiators, each grounded in a *shipped* asset and each something a single-rail competitor cannot trivially copy.

1. **Health × cost fusion in one reasoning loop.** The only consumer product whose AI sees both the longitudinal clinical/biomarker record *and* the plan/deductible/cost picture, using each to inform the other. Cost players have no clinical context; health/AI players have no cost action layer. *(Shipped today: SBC extraction, expense projection + AI cost analysis, biomarker time-series — the two halves already exist in the same app; the deeper connected loop above is the build target.)*

2. **A real, owned longitudinal record — not a chat transcript.** Biomarkers are modeled as a genuine **time series** (latest value + dated history, oldest-first) — the history model is shipped (`biomarkerSeries`), so trends, sparklines, and out-of-range flags are *structurally* supported rather than re-derived by the AI each session. *(Honest caveat: the model is shipped and the trend behavior was remediated per the changelog, but it is **not yet fully verified end-to-end**.)* Perplexity has trends; ChatGPT does not. OwnMyHealth pairs trends *with* the cost rail neither of them has.

3. **Consumer-owned and consumer-controlled, cross-provider — not system-tethered.** Unlike MyChart (Epic-locked) or Apple (iOS-locked), the record is the *user's*, assembled from their uploads plus consumer-directed Quest/FHIR sync — portable, and not a tether to one health system or one phone OS. This is also the regulatory posture that keeps OwnMyHealth a consumer PHR (FTC HBNR regime), not a provider tool.

4. **Privacy-as-product, with the technical substrate already built.** The defensible long-term consumer wedge in health is *trust*. The encryption-and-isolation core is genuinely strong — per-user AES-256-GCM field encryption, Postgres FORCE row-level security that fails closed, audit logging, JWT rotation/revocation. *(Honest caveat: this is **technical capability, not certification.** OwnMyHealth holds no SOC 2/HITRUST/HIPAA attestation today; the differentiator is "we can credibly become the no-sell, encrypted, audited consumer health record," not "we are certified.")*

> **What is explicitly *not* a differentiator:** "AI chat over your records." That was commoditized in Jan 2026. The AI is the *delivery mechanism* for the fusion, never the moat.

---

## 5. How the wedge becomes revenue (freemium now, harder paywall later)

The four-pillar wedge is also the monetization engine, mapped directly onto the existing **FREE / PRO** plan-gating substrate (`requirePlanLimit` / `requirePlanFeature`, with flags like `aiChatsPerDay`, `pdfUploadsPerMonth`, `questFhirIntegration`).

- **The cost-fusion features *are* the Premium unlocks.** The differentiating wedge — **AI cost analysis, OCR/AI document extraction, insurance/SBC parsing, FHIR lab-connect, and the AI guide** — is exactly what the paid tier gates. The FREE tier (manual biomarker entry + document vault, minimal/no AI+OCR) is the trust- and funnel-builder that points users *toward* the fused experience they have to upgrade to get.
- **Sequence: freemium *now*, test a harder paywall *later*.** Build top-of-funnel and trust with freemium first; once retention data exists, run a planned pricing experiment to test a harder paywall / free-trial (hard paywalls convert materially better than freemium in published benchmarks, but freemium seeds the organic/referral growth this product depends on). **Annual plans are the retention lever** (higher adoption and materially better retention than monthly) and should anchor the eventual paid offer.
- **Tiering note (pre-empting the "is this B2B2C?" question).** The plan substrate today is **FREE / PRO / TEAM**. The **TEAM tier is a family/caregiver D2C plan** — multiple *individuals* (e.g., a caregiver managing a parent's record), **not** an employer or group-benefits SKU, and therefore not a channel drift. This document's monetization analysis focuses on the **FREE → Premium individual funnel**; the family tier is a consistent D2C extension, not a separate go-to-market.
- **The gating launch blocker: billing is unwired.** Plan *limits* are enforced at runtime, but the upgrade path is a stub — there is no Stripe/self-serve checkout, and upgrades are admin-only. **No funnel converts until billing ships.** This is the load-bearing readiness gap between "we own white space" and "we make money," and it is the same gap §6 names in the habit/distribution moat.

---

## 6. Competitive risks — who could close the gap, and how fast

The cost rail is OwnMyHealth's differentiation **only until a better-funded player bolts on a cost layer.** The window is the differentiator, not a permanent moat.

| Risk | Who | Why it's credible | Mitigating reality |
|---|---|---|---|
| **AI assistant adds a cost layer** | **ChatGPT Health (highest threat)** | Already *reads insurance documents* and reasons about plan trade-offs — one product step from true cost navigation; ~230M weekly health users *(reported)*; enormous distribution | Still no price-shopping/bill-audit/claims action; OpenAI's incentive is general assistant breadth, not deep US-insurance plumbing (estimate) |
| **AI assistant deepens its record + trend lead** | **Perplexity Health** | Ships PHR + biomarker trends + AI today via b.well's 1.7M-provider backend *(reported)* | No cost/insurance rail and a backend dependency (b.well); cost navigation is a different, US-payer-specific competency (estimate) |
| **Platform owner makes it default** | **Apple Health** | Owns the device, 700+ FHIR orgs *(reported)*, free distribution | No cost/insurance/billing and no AI-on-record today; iOS-only; historically slow to add financial/insurance features (estimate) |
| **Cost player adds the health record** | **Sheer Health** (most plausible from the cost side) | Already a consumer "insurance copilot" (claims/deductible/bill tracking) — could ingest labs next | Starts from the bill, has no clinical/biomarker competency or record-aggregation muscle |
| **A biomarker incumbent bundles cost** | Function / Superpower | Capital and members to expand scope | Lab-test-first DNA; no insurance/cost competency; their model is selling *more tests*, not lowering care cost (estimate) |

**Estimated window:** ~**12–24 months** before a big-AI entrant or a cost player (Sheer most likely) attempts to span the seam. (estimate)

---

## 7. The moat plan

The fusion is a *position*, not yet a *moat*. Four reinforcing moats convert the white space into something durable — sequenced honestly against a product that today holds no certifications, no billing, and no mobile surface.

1. **Depth-of-fusion moat (build the seam no one else has).** Go beyond co-locating health and cost: ship the *connected* reasoning loop — biomarker trend → recommended test → in-network price under the user's plan → cheaper Rx → bill-error flag. This is the single asset every competitor lacks and the hardest to copy because it requires *both* rails working together, not either alone. **This is the priority; the window is finite.** *Two open High issues are direct readiness dependencies of this wedge:* (a) **uncapped Document AI OCR spend (H-3)** must be dollar-capped before OCR-driven extraction becomes a paid feature at scale — today the $50/day circuit-breaker bounds only Claude tokens, not per-page OCR, so the very Premium feature that drives the funnel has an uncapped cost tail; and (b) the **FHIR multi-instance constraint (H-2)** pins the service to a single instance until Redis is provisioned, capping the scalability of the lab-connect pillar. Neither blocks the position, but both gate whether the differentiating features can scale and price safely.

2. **Trust moat (make trust the product).** For a consumer PHR, **trust is the product — one breach or FTC action ends a consumer health startup.** Convert the strong technical substrate into *earned, external* trust: a true and prominent "we never sell your health data" posture (legally load-bearing post-GoodRx/HBNR), clean app-store privacy labels, a published consumer-health privacy policy, and — once resourced — SOC 2 as a credibility signal (a trust signal for consumers, **not** a sales gate, since there is no enterprise buyer). *Honest sequencing: this is a roadmap, not a current-state claim.*

3. **Data-gravity / switching-cost moat.** Every uploaded lab, parsed SBC, tracked biomarker, and corrected bill makes *this* user's record more valuable and more painful to recreate elsewhere. The longitudinal record + the user's own cost history compound into personal switching cost that a fresh ChatGPT/Perplexity session does not accumulate. Reinforce with frictionless export/portability — which paradoxically *deepens* trust and retention.

4. **Habit / distribution moat (the current gap, named honestly).** A daily-use record needs a habit surface, a growth loop, and a way to take money — and OwnMyHealth has **none of the three today**: web-only (no PWA/native, no push), no referral/invite, and no self-serve billing (the funnel from §5 cannot convert until Stripe ships). The moat plan therefore *depends on* closing these readiness gaps: wire billing, ship a PWA + re-engagement loop so the fusion is felt daily, and grow via cheap, organic/content/SEO/referral-led motion (consumer-health CAC of ~$30–60/paying subscriber makes paid-first untenable). Distribution is the moat OwnMyHealth has not yet started — and the one that decides whether the 12–24-month window is captured.

---

### Bottom line

OwnMyHealth's defensible position is **the cost-aware health copilot** — the only consumer product whose AI reasons over both the user's longitudinal record *and* their real costs. The biomarker and cost-analysis assets that anchor that position are real and shipped (the deeper connected loop and full trend verification are still build/verify work); the white space (deep owned record × real cost navigation) is genuinely vacant; and the threat is concrete and converging (ChatGPT Health most of all). The mandate is to **build the depth-of-fusion seam and the trust posture inside a finite ~12–24-month window** — while honestly closing the readiness gaps (wire Stripe billing so the freemium→Premium funnel can convert, ship mobile, earn certifications, build distribution, and cap the open High issues) that today keep this a polished demo rather than the trustworthy daily record the position requires.
