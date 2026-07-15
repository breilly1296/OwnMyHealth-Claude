# 02 — Product Honesty Gap

**This is the biggest non-security problem in the project.**

The UI sells a product. Large parts of the code still sell a lab / demo.

---

## Claim vs reality

| Claimed surface | Reality in code / ops |
|-----------------|------------------------|
| Plans (FREE / PRO / TEAM) with limits | Limits enforced at runtime; **Upgrade is a toast stub** |
| Self-serve billing | **No Stripe (or any PSP)** in dependencies or routes |
| MFA | **None** (password + lockout + email reset only) |
| Installable daily-use app | Web SPA; PWA maturity not product-grade |
| Quest / SMART-on-FHIR lab sync | Built; **off by default**; multi-instance PKCE failure mode |
| “HIPAA-compliant” style marketing | In-repo GTM/security docs: **no certifications**; BAAs incomplete |
| Fully encrypted PHI at rest | **Legacy plaintext residue** (e.g. `user_files.original_filename`) until backfill + DROP |

Evidence for the billing stub (frontend):

```tsx
// src/components/settings/PlanSection.tsx (approx. lines 161–164)
onClick={() => {
  // TODO: wire to Stripe checkout when billing goes live.
  onError?.('Upgrades are not available yet. Contact us to upgrade manually.');
}}
```

Plan limits and plan fields on `User` are real. Monetization is not. That combination is worse than having no plans: users hit walls with no honest path through them.

---

## In-repo honesty (use this, not the README gloss)

GTM readiness material correctly frames the product as roughly:

> *polished demo, not yet a trustworthy daily health record*

and lists P0 blockers before any paying consumer (billing, verified export/delete, MFA, breach detection, BAAs, plaintext residue, OCR dollar cap).

**Engineering should treat that checklist as authoritative** until those items are closed. Marketing and README tone should not outrun it.

---

## Demo mode and sample data

- Frontend demo mode gated by `import.meta.env.DEV && VITE_DEMO_MODE === 'true'`
- Dashboard can load `sampleData` biomarkers in demo
- Demo login path exists; production blocks demo appropriately in backend admin/protection paths
- Hooks such as `useBiomarkerData` short-circuit many writes/fetches when `DEMO_MODE` is on

Demo is fine for sales. **Demo-shaped branches sprinkled through production hooks** are a long-term maintainability and correctness risk (behavior that only works in one mode).

---

## Feature sprawl without commercial spine

Shipped or near-shipped surface includes:

- Biomarker tracking, trends, series consolidation
- Lab PDF upload + OCR + AI extraction
- Insurance SBC upload + plan comparison + expenses
- Health goals, health needs
- Health Guide AI chat
- Provider–patient consent sharing
- Admin panel
- FHIR/Quest scaffolding
- Onboarding wizard

Missing commercial spine:

- Checkout
- Subscription lifecycle (cancel, failed payment, receipts)
- Optional MFA
- Installable mobile experience
- Breach detection / named on-call path

**Harsh read:** The vault was built before the bank branch. Users can store labs and chat about them, but they cannot pay, cannot second-factor, and cannot rely on several features under real multi-instance load.

---

## Recommended product honesty rules

1. Do not show Upgrade until Stripe (or equivalent) is live.
2. Do not claim HIPAA certification or “fully encrypted” while plaintext twins or unsigned BAAs remain.
3. Feature-flag FHIR/Quest UI when backend is disabled or multi-instance-unsafe.
4. Prefer “demo” language in public materials until P0 readiness items close.

See also: [11-priority-fix-list.md](./11-priority-fix-list.md).
