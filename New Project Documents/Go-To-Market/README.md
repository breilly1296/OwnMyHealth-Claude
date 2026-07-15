# OwnMyHealth — Go-To-Market Package (Direct-to-Consumer)

Generated 2026-06-20. A board/investor-ready GTM package grounded in (a) direct inspection of this codebase, (b) live 2024–2026 consumer-market & regulatory research, and (c) an adversarial review pass on every document (hunting compliance overclaims, readiness overclaims, unsupported numbers, and any B2B/employer-channel drift).

> **Honest framing throughout:** OwnMyHealth is a real, security-forward asset (~96K LOC; verified Postgres row-level security + per-user AES-256-GCM encryption core) but is — by its own UX review — a *"polished demo, not yet a trustworthy daily health record."* It holds **no certifications** (only the Anthropic BAA is signed), has **no self-serve billing**, **no mobile app/PWA** (web-only), and **no MFA**. Nothing here claims otherwise. All market figures are cited to the research brief; all forward-looking numbers are labeled `(estimate)` / `(illustrative)`.

## The recommendation in one line
**Go to market as a pure direct-to-consumer subscription app — freemium now, with a planned experiment to test a harder paywall later** — and win on the one position no competitor occupies: **an AI guide that reasons over your own longitudinal health record *and* your real insurance costs, in one private place.** Not lab testing (Function owns it), not raw record aggregation (Apple/Epic own the rails), and not "AI chat over your records" (commoditized Jan 2026). Grow **organic-first** (content/SEO, referral, community) — never paid-first.

## Headline numbers (all illustrative; assumptions stated in the docs)
| Metric | Figure |
|---|---|
| Cost to reach paid-launch readiness | **~$225K** (range $170K–$340K) |
| Time to public paid launch | **~5–6 months** (two eng tracks; single-track → 7–8 mo) |
| Recommended raise | **~$750K–$1.0M** pre-seed SAFE |
| 24-month base-case ARR run-rate | **~$128K** (bear $42K → bull $235K); ~1,150 paying subs |
| Unit economics (organic-led) | **LTV:CAC ~3.0–3.5:1**, blended CAC ~$25, payback ~3–4 mo |
| Pricing | Free to start → Premium **$9.99/mo or $69.99/yr** (annual is the retention lever) |
| Differentiation window | **~12–24 months** before a ChatGPT-Health-class incumbent could close the seam |

## Documents
| # | File | What it is |
|---|---|---|
| 00 | [00-EXECUTIVE-SUMMARY.md](00-EXECUTIVE-SUMMARY.md) | The recommendation, the three gates, headline numbers, next steps — read first |
| 01 | [01-GTM-STRATEGY.md](01-GTM-STRATEGY.md) | Positioning, target consumer, the organic growth motion, activation/retention, phased launch, metrics |
| 02 | [02-PRODUCT-READINESS-CHECKLIST.md](02-PRODUCT-READINESS-CHECKLIST.md) | Prioritized P0/P1/P2 demo→market-ready gaps (incl. billing, PWA, MFA) with acceptance criteria |
| 03 | [03-COMPLIANCE-ROADMAP.md](03-COMPLIANCE-ROADMAP.md) | FTC HBNR + state law (the primary regime), why HIPAA generally N/A, app-store policy, SOC 2 as optional trust |
| 04 | [04-PRICING-AND-MONETIZATION.md](04-PRICING-AND-MONETIZATION.md) | Freemium-now design, price points, the AI/OCR variable-cost floor, the planned paywall experiment |
| 05 | [05-COMPETITIVE-LANDSCAPE.md](05-COMPETITIVE-LANDSCAPE.md) | Consumer competitors (Function, Apple Health, ChatGPT Health, cost tools), the white space, the moat |
| 06 | [06-FINANCIAL-MODEL.md](06-FINANCIAL-MODEL.md) | Cost-to-launch, operating costs, a 24-month subscription funnel, unit economics, funding ask |
| 07 | [07-PITCH-ONE-PAGER.md](07-PITCH-ONE-PAGER.md) | Consumer-facing value-prop one-pager (landing-hero + investor blurb) |
| 08 | [08-RISK-REGISTER.md](08-RISK-REGISTER.md) | Prioritized risks + mitigations + go/no-go kill criteria |
| 📄 | **OwnMyHealth-Go-To-Market.pdf** | All of the above, typeset as one branded PDF |

## Three things the research changed (worth knowing before reading)
1. **"AI over your records" got commoditized in Jan 2026** (ChatGPT Health, Copilot Health, Perplexity Health, Claude for Healthcare). The defensible wedge is the *cost-navigation + record fusion* — "understand your health AND what your care will cost" — and the window to own it is ~12–24 months.
2. **For a pure consumer PHR, the FTC Health Breach Notification Rule + state laws are the primary regime — not HIPAA** (HIPAA generally doesn't apply to a consumer-controlled record absent a provider/FHIR Business-Associate path). Washington's My Health My Data Act carries a **private right of action**. **SOC 2 / HITRUST are optional trust signals, not launch gates** — there's no enterprise buyer demanding them.
3. **The real launch blockers are on the commercial surface, not the engine.** The technical security core is strong; what's missing is **self-serve billing (Stripe)**, a **mobile/PWA** experience (it's web-only), **MFA**, and the **OCR spend cap** (H-3). Closing those P0/P1 seams — plus minimal privacy counsel — is the ~$225K / ~5–6-month path to a chargeable product.
