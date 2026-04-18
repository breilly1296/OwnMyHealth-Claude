/**
 * Insurance Knowledge Store
 *
 * Claude-facing reference about US health insurance concepts. Intended
 * to be injected into the AI Health Guide system prompt so Claude can
 * give accurate answers about plans, coverage, and cost strategies.
 *
 * Accurate as of plan year 2025 (ACA marketplace + employer-sponsored
 * plans). Review and update dollar thresholds annually.
 */

import type { KnowledgeDocument } from './types.js';

const PLAN_TYPES: KnowledgeDocument = {
  id: 'ins-plan-types',
  domain: 'insurance',
  category: 'plan-types',
  title: 'Insurance Plan Type Comparison',
  keywords: [
    'hmo',
    'ppo',
    'epo',
    'pos',
    'hdhp',
    'plan type',
    'network',
    'referral',
    'which plan',
    'choose plan',
  ],
  relevantBiomarkers: [],
  tokenEstimate: 360,
  source: 'system',
  content: `## Plan types

### HMO (Health Maintenance Organization)
- Must choose a PCP. Referrals required for specialists.
- No out-of-network coverage except emergencies.
- Lowest premiums; most restrictive network.
- Best for: healthy users, budget-conscious, near in-network providers.

### PPO (Preferred Provider Organization)
- No PCP required. Self-refer to specialists.
- Out-of-network covered at higher deductible + higher coinsurance.
- Higher premiums; most flexibility.
- Best for: frequent specialist users, travelers, those wanting provider choice.

### EPO (Exclusive Provider Organization)
- No referrals needed. No out-of-network coverage except emergencies.
- Moderate premiums; moderate flexibility.
- Best for: people comfortable staying in-network who want specialist freedom.

### POS (Point of Service)
- Hybrid. Must pick PCP; can self-refer out-of-network at higher cost.
- Less common; premiums between HMO and PPO.

### HDHP (High Deductible Health Plan)
- Deductible ≥$1,650 individual / $3,300 family (2025 IRS minimums).
- OOP max capped by ACA: $8,300 individual / $16,600 family (2025).
- Required for HSA eligibility — triple tax advantage (deductible contributions, tax-free growth, tax-free qualified withdrawals).
- Lower premiums, higher OOP risk.
- Best for: healthy earners with emergency fund who value HSA tax savings.

### Decision shortcuts
- Expect few medical needs → HDHP + HSA (lowest total cost + tax savings).
- Chronic condition with regular specialists → PPO (flexibility) or HMO (lowest OOP if specialists are in-network).
- Pregnancy planned → check maternity + OB specialist coverage on each plan; PPO often has broader OB network.`,
};

const DEDUCTIBLE_MECHANICS: KnowledgeDocument = {
  id: 'ins-deductible-mechanics',
  domain: 'insurance',
  category: 'deductibles',
  title: 'How Deductibles Work',
  keywords: [
    'deductible',
    'individual deductible',
    'family deductible',
    'embedded',
    'aggregate',
    'deductible reset',
    'meet deductible',
  ],
  relevantBiomarkers: [],
  tokenEstimate: 320,
  source: 'system',
  content: `## Deductible mechanics

### Basic structure
- Deductible: amount patient pays before insurance cost-sharing kicks in.
- Premiums + copays do NOT count toward the deductible.
- Most in-network costs (doctor visits subject to deductible, labs, imaging, hospital stays) DO count.
- Preventive care (covered at 100% under ACA) bypasses the deductible entirely.

### Individual vs family deductible
- Individual deductible applies to one member.
- Family deductible is the total the household must hit.

### Embedded vs aggregate (family plans)
- Embedded: any single member's spending caps at the individual deductible; their individual OOP max then applies. Required for ACA-compliant plans covering multiple people.
- Aggregate (legacy HDHP structure): no individual cap within a family plan — any family member can spend up to the full family deductible before insurance kicks in for anyone.

### Timing
- Plan year resets are typically January 1, but some employer plans run other calendar windows.
- Deductible progress from the prior year does NOT carry forward.
- Mid-year plan switches: each plan's deductible resets; amounts paid toward the old plan don't transfer.

### Strategic timing
- Bunch elective care (MRI, surgery, PT series) after the deductible is met.
- Schedule elective procedures in December vs January based on deductible proximity.
- Crossing the OOP max means the remaining year is effectively free for covered in-network services.`,
};

const COVERAGE_TIERS: KnowledgeDocument = {
  id: 'ins-coverage-tiers',
  domain: 'insurance',
  category: 'rx',
  title: 'Prescription Drug Coverage Tiers',
  keywords: [
    'prescription',
    'drug',
    'rx',
    'formulary',
    'tier',
    'tier 1',
    'tier 2',
    'tier 3',
    'tier 4',
    'specialty drug',
    'prior auth',
    'step therapy',
  ],
  relevantBiomarkers: [],
  tokenEstimate: 320,
  source: 'system',
  content: `## Prescription drug tiers

### Tier structure (typical commercial plan)
- Tier 1: preferred generics. Lowest copay (often $5–$15). Or $0 for many plans.
- Tier 2: preferred brand or non-preferred generics. $25–$50 typical.
- Tier 3: non-preferred brands. $50–$100 or 20–40% coinsurance.
- Tier 4: specialty drugs (biologics, oncology). Coinsurance 20–50%, often monthly cost-share caps under ACA/IRA rules.
- Tier 5 (some plans): very-high-cost specialty; fill at specialty pharmacy.

### Formulary concepts
- Formulary = covered drug list. Check plan formulary before starting a new prescription.
- Non-formulary = patient pays full retail unless exception granted.
- Formularies change — drugs can move tiers mid-year (usually with 30–60 day notice) or drop off at renewal.

### Gatekeeping mechanisms
- Prior authorization: plan must approve before dispensing. Common for expensive, off-label, or biologic meds. Your doctor submits documentation.
- Step therapy: must try cheaper drug first (fails or contraindicated) before approving the pricier option. Common for biologics, PPIs.
- Quantity limits: e.g., 9 sumatriptan tablets per 30 days.

### Cost-reduction strategies
- Generic substitution when available (same active ingredient, much cheaper).
- 90-day supply via mail-order (often 2–3 copays instead of 3 monthly).
- Manufacturer coupons on brand drugs (not usable with Medicare/Medicaid).
- Patient assistance programs for high-cost specialties.
- Price comparison tools (GoodRx, Mark Cuban Cost Plus) can undercut insurance on low-cost generics.

### ACA + IRA protections
- No annual or lifetime maximums on Rx.
- Insulin capped at $35/month for Medicare Part D (2023+) and many commercial plans.
- Specialty drug OOP caps starting in 2025 under IRA for Medicare Part D.`,
};

const PREVENTIVE_CARE: KnowledgeDocument = {
  id: 'ins-preventive-care',
  domain: 'insurance',
  category: 'preventive',
  title: 'ACA Preventive Care Coverage',
  keywords: [
    'preventive',
    'prevention',
    'screening',
    'wellness',
    'annual physical',
    'mammogram',
    'colonoscopy',
    'vaccine',
    'immunization',
    'covered at 100',
  ],
  relevantBiomarkers: [],
  tokenEstimate: 360,
  source: 'system',
  content: `## Preventive care (ACA)

### Rule
- All ACA-compliant plans cover USPSTF grade A/B recommendations, ACIP-recommended vaccines, HRSA women's/children's services at 100% in-network — no copay, no coinsurance, before deductible.
- Applies to: screening tests, counseling, immunizations, well-woman/child visits.

### Key covered services (all adults in-network)
- Annual wellness visit.
- Blood pressure screening.
- Lipid panel every 5 years (starting age 35 men / 45 women, or earlier with risk factors).
- Colorectal cancer screening age 45–75 (colonoscopy every 10 years, FIT annually, stool DNA every 3 years).
- Diabetes screening for overweight adults 35–70.
- Hepatitis C screening age 18–79 once.
- Tobacco cessation counseling.
- Depression screening.
- HIV screening age 15–65.
- Obesity counseling.

### Women's services (HRSA)
- Annual well-woman visit.
- Mammogram every 1–2 years age 40–74 (USPSTF updated 2024 to start at 40).
- Cervical cancer screening (Pap + HPV co-testing) every 3–5 years age 21–65.
- Contraception (all FDA-approved methods — but may need specific formulation within a method class).
- Breastfeeding support + equipment.

### Immunizations (ACIP)
- Annual flu.
- Tdap, shingles, pneumococcal, COVID.
- HPV through age 26, or up to 45 with shared decision.

### Common gotchas
- A screening colonoscopy is free, but if a polyp is found and removed, billing may shift to "diagnostic" with cost-sharing (the "polypectomy surprise"). ACA mostly closed this loophole in 2022 — confirm before scheduling.
- Same-visit non-preventive issues are billed separately (mention a knee problem at your annual physical → cost-sharing for that portion).
- Out-of-network preventive care is NOT covered at 100%.
- Grandfathered employer plans (rare in 2025) may not follow ACA rules.`,
};

const COST_OPTIMIZATION: KnowledgeDocument = {
  id: 'ins-cost-optimization',
  domain: 'insurance',
  category: 'cost-strategies',
  title: 'Healthcare Cost Optimization',
  keywords: [
    'hsa',
    'fsa',
    'save money',
    'reduce cost',
    'savings',
    'optimize',
    'negotiation',
    'financial assistance',
    'bunching',
    'tax',
  ],
  relevantBiomarkers: [],
  tokenEstimate: 380,
  source: 'system',
  content: `## Cost optimization strategies

### HSA (Health Savings Account) — HDHP required
- 2025 limits: $4,300 individual / $8,550 family. +$1,000 catch-up age 55+.
- Triple tax advantage: pre-tax contribution, tax-free growth, tax-free qualified withdrawal.
- No "use it or lose it" — rolls over forever; invest the balance once you exceed cash cushion.
- Retirement tip: pay current medical out-of-pocket, save receipts, let HSA grow; withdraw decades later tax-free against those receipts.

### FSA (Flexible Spending Account) — any plan
- 2025 limit: $3,300 health FSA.
- Use-it-or-lose-it (some plans allow $640 rollover or 2.5-month grace period).
- Commit carefully — forfeit unused funds at year-end.
- Dependent care FSA ($5,000) is separate and for childcare, not healthcare.

### Deductible bunching
- Schedule elective procedures in the year your deductible is likely met. Also batch diagnostic workups across family members to hit family OOP max.

### In-network maximization
- Always verify in-network status on the day of service (networks change quarterly).
- Hospital network ≠ physician network — confirm BOTH the facility and the individual doctor.
- For labs: LabCorp/Quest in-network with most plans; hospital-owned labs often charge 3–10× more.

### Price negotiation
- Hospitals must publish chargemasters + negotiated rates (Transparency in Coverage rule 2021+).
- Self-pay cash prices are often 30–50% lower than insurance "allowed amount" for imaging/labs.
- Request an itemized bill; 50–80% contain errors.
- Negotiate balance bills: typically ~30% settlement works for uninsured/underinsured.

### Prior-auth strategy
- Delayed/denied prior auths are the #1 friction. Escalate via peer-to-peer review (your doctor calls plan medical director).
- Internal appeal → external independent review (ACA-guaranteed).

### Financial assistance
- Hospital charity care (required for 501(c)(3) hospitals) often covers income up to 200–400% of federal poverty level.
- GoodRx / Mark Cuban Cost Plus for generics can undercut insurance at the pharmacy counter.
- Pharmaceutical patient-assistance programs for high-cost brand drugs.`,
};

const EOB_READING: KnowledgeDocument = {
  id: 'ins-eob-reading',
  domain: 'insurance',
  category: 'billing',
  title: 'Understanding EOBs and Bills',
  keywords: [
    'eob',
    'explanation of benefits',
    'bill',
    'billed',
    'allowed amount',
    'balance bill',
    'dispute',
    'claim denial',
  ],
  relevantBiomarkers: [],
  tokenEstimate: 320,
  source: 'system',
  content: `## Reading an EOB (Explanation of Benefits)

### Columns you'll see
- **Amount billed**: provider's chargemaster (list price). Almost never what anyone pays.
- **Allowed amount / negotiated rate**: what the plan agreed to pay or allow. In-network providers must accept this as payment in full.
- **Paid by plan**: what insurance sent to the provider.
- **Applied to deductible**: counts toward your deductible.
- **Your responsibility / patient pays**: copay + coinsurance + remaining deductible.

### Common confusing patterns
- EOB vs bill: EOB is NOT a bill. The provider sends a separate bill. Always reconcile the two — provider billing errors are common.
- Duplicate charges: same service billed twice; ask for corrected claim.
- Facility + professional fee split: hospital-based services often generate two EOBs (facility fee and physician fee). Both may have deductible or coinsurance.
- "Not covered" vs "applied to deductible": read the reason code. "Not covered" means appeal or negotiate. "Applied to deductible" just means you haven't met yours yet.

### Appeals (ACA-guaranteed)
- Internal appeal: 180 days from denial. Plan reconsiders.
- External review: after internal appeal fails. Independent third party. ~40% overturn rate for medical-necessity denials.
- Keep notes of every phone call (date, rep name, reference number). Follow up in writing.

### Balance billing / surprise bills
- No Surprises Act (2022) protects against: out-of-network emergency care, out-of-network anesthesiologists/radiologists at in-network facilities, out-of-network air ambulance.
- If you get a surprise bill in those categories: notify the provider of NSA protection, file complaint with CMS/state insurance dept if they push back.
- Ground ambulance is NOT covered by the NSA — still balance-billable.

### What to check on every EOB
- Dates of service match what you remember.
- Providers listed match the ones you saw.
- No duplicates.
- "Applied to deductible" matches what you expected.
- Claim status is "processed" — if "pending" after 30 days, follow up.`,
};

const COVERAGE_GAPS: KnowledgeDocument = {
  id: 'ins-coverage-gaps',
  domain: 'insurance',
  category: 'coverage-gaps',
  title: 'Common Coverage Gaps',
  keywords: [
    'gap',
    'gaps',
    'balance bill',
    'out of network',
    'mental health',
    'parity',
    'travel coverage',
    'not covered',
  ],
  relevantBiomarkers: [],
  tokenEstimate: 320,
  source: 'system',
  content: `## Common coverage gaps

### Out-of-network + balance billing
- HMO/EPO: no out-of-network coverage except emergencies.
- PPO: coverage but at higher deductible + higher coinsurance + balance billing (provider charges the difference between plan-allowed and retail).
- Protected by No Surprises Act: emergency care, and ancillary out-of-network providers at in-network facilities (anesthesia, radiology, pathology).
- NOT protected: ground ambulance, urgent-care-only emergencies, deliberate out-of-network choice.

### Mental health + substance-use parity
- ACA + MHPAEA (Mental Health Parity Act) require mental health coverage at parity with medical/surgical.
- In practice: prior-auth and visit limits sometimes stricter. Document + appeal if limits feel disproportionate.
- Many plans now cover tele-mental-health with lower barriers post-COVID.

### Travel coverage
- Most US plans cover emergencies only outside home region. Routine care out of state: out-of-network pricing or uncovered.
- International: most commercial US plans cover NOTHING except emergencies; medical evacuation not covered.
- Travel insurance or expatriate policies fill this gap.

### Dental, vision, hearing
- Medical plans typically cover ONLY vision/dental emergencies (facial trauma, eye injury, abscess requiring hospitalization).
- Routine care requires separate vision/dental plan.
- Medicare Original (Parts A + B) excludes dental/vision/hearing entirely; Advantage plans may bundle.

### Infertility + IVF
- State-mandated coverage varies widely — about 20 states require some coverage, only ~10 require IVF.
- Employer self-funded plans opt out of state mandates (ERISA preemption).

### Cosmetic / "medical necessity" disputes
- Bariatric surgery: BMI ≥ 40 or ≥ 35 with comorbidity typically covered, but plan-specific documentation requirements.
- GLP-1s for weight loss: coverage spotty (most plans cover for diabetes indication only).
- Hormone therapy for gender-affirming care: coverage depends on plan and state law.

### Common denial reasons
- Coding errors (wrong CPT/ICD-10) — correctable.
- Missing prior authorization — can sometimes backdate.
- "Not medically necessary" — appeal with documentation from treating physician.
- Out-of-network + no NSA protection — balance bill; negotiate before paying.`,
};

const OPEN_ENROLLMENT: KnowledgeDocument = {
  id: 'ins-open-enrollment',
  domain: 'insurance',
  category: 'enrollment',
  title: 'Enrollment and Plan Switching',
  keywords: [
    'enrollment',
    'open enrollment',
    'sep',
    'special enrollment',
    'qualifying event',
    'marketplace',
    'change plan',
    'switch plan',
    'healthcare.gov',
  ],
  relevantBiomarkers: [],
  tokenEstimate: 320,
  source: 'system',
  content: `## Enrollment

### Open enrollment windows
- ACA marketplace (healthcare.gov and state exchanges): Nov 1 – Jan 15 for coverage starting Jan 1 (if enrolled by Dec 15) or Feb 1.
- Medicare: Oct 15 – Dec 7 for Jan 1 coverage (Part D and Advantage). Supplemental Plans (Medigap) rules vary by state.
- Employer plans: typically Oct/Nov for Jan 1, or by fiscal year.

### Special Enrollment Period (SEP) — qualifying life events
- Loss of other coverage (job loss, aging off parent plan at 26, divorce, Medicaid loss).
- Marriage, divorce (some states).
- Birth, adoption.
- Move to a new coverage area.
- Change in income affecting marketplace subsidy eligibility.
- 60-day window from the event in most cases.

### Marketplace subsidies (ACA)
- Premium tax credits: based on income + household size + local benchmark plan cost.
- Cost-sharing reductions (CSRs): additional help with deductible/OOP for silver-plan enrollees up to ~250% FPL.
- Inflation Reduction Act extended enhanced subsidies through 2025 — watch for post-2025 changes.
- No-cost silver plans available for many lower-income enrollees.

### Plan comparison checklist
- Total annual cost estimate = premium × 12 + expected deductible/copays/coinsurance.
- Check formulary for current prescriptions.
- Verify in-network status of current doctors + preferred hospital.
- Review specialist copay + referral rules.
- Check mental health coverage + visit limits.
- Confirm OOP max (hard ceiling on annual spending).
- HDHP eligibility for HSA if valuable to you.

### Employer vs marketplace
- If employer plan is "affordable" by ACA rule (<8.39% of household income in 2025) and provides minimum value, you can't get marketplace subsidies for a better plan.
- Family glitch fix (2023): family members can now get marketplace subsidies if employer family coverage costs exceed 8.39% threshold.

### COBRA
- Available after job loss — continue employer plan up to 18 months (36 months for certain events).
- Pay full premium + 2% admin fee yourself. Often cheaper: marketplace plan with subsidy.
- 60-day decision window from employer notice.`,
};

export const INSURANCE_KNOWLEDGE: KnowledgeDocument[] = [
  PLAN_TYPES,
  DEDUCTIBLE_MECHANICS,
  COVERAGE_TIERS,
  PREVENTIVE_CARE,
  COST_OPTIMIZATION,
  EOB_READING,
  COVERAGE_GAPS,
  OPEN_ENROLLMENT,
];
