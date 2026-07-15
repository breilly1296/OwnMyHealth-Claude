# 00 — Executive Verdict

**Date:** 2026-07-11  
**Subject:** OwnMyHealth full-stack codebase

---

## Grades

| Dimension | Grade | One-line |
|-----------|-------|----------|
| **Security core** | **A-** | Encryption, RLS, auth, CSRF are real and unusually serious for a solo build |
| **Product completeness** | **C-** | Polished demo with paywall, MFA, billing, and mobile missing |
| **Architecture / maintainability** | **C+** | Works, but god-files, dual parsers, no real router, multi-instance debt |
| **Test honesty** | **B-** | Strong unit depth on auth/CRUD; PHI upload/AI/FHIR almost untested |
| **Documentation honesty** | **C** | Excellent volume; severity labels contradict each other |
| **Ship readiness** | **D+** | Cannot charge users; cannot scale cost caps cleanly; some prod PHI residue |

---

## Bottom line

The security *engine* is better than most funded Series A health apps. The *product* is still a sophisticated prototype.

The codebase is what you get when a strong engineer (plus heavy AI assist) obsesses over HIPAA-shaped plumbing and under-invests in:

- product architecture (routing, modular boundaries)
- monetization (billing)
- consumer trust features (MFA, verified export/delete journeys)
- multi-instance operational completeness (Redis, shared PKCE/spend stores)
- risk-based tests on the newest PHI surfaces (AI, OCR, FHIR, files)

---

## Character of the codebase

| Trait | Manifestation |
|-------|----------------|
| Security-first founder | Encryption, RLS, CSRF, audits everywhere |
| AI-accelerated velocity | Huge surface area in ~7 months, uneven depth |
| Auditor-facing prose | High comment density, multi-agent security reports, file:line docs |
| Product under-shipping | Billing stub, MFA absent, PWA immature |
| Horizontal-scale theater | Cloud Run multi-instance without shared state for critical maps |
| Feature sprawl | Biomarkers + insurance + AI + FHIR + provider + admin + expenses |

**Metaphor:** A fortress with unfinished doors. The walls are thick. The checkout is cardboard. The fire alarm is half-wired.

---

## Size snapshot (context for cost/effort)

| Area | Approx. size |
|------|----------------|
| Frontend app code | ~36K LOC, ~153 files, ~90 components |
| Backend app code | ~34K LOC, ~107 files |
| Tests (FE + BE + e2e) | ~18.5K LOC |
| Prisma + migrations | ~2.8K LOC, 33 migrations |
| Docs / prompts / security MD | ~24K LOC, ~120 files |
| History | ~600 commits, ~7 months (Nov 2025 → mid-2026), one primary engineer |

Full inventory: [sizing-inventory.md](./sizing-inventory.md).

---

## What “done” would require (headline)

Your own GTM model already prices **paid-launch readiness** at roughly **~$225K most-likely** ($170K–$340K) over 5–8 months — finishing seams, not rebuilding. Traditional rebuild value of the existing asset is framed at **~$850K–$1.1M**.

This scrutiny does not re-derive those dollar models; it explains *why* the finish work is still large despite a large codebase.
