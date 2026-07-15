# OwnMyHealth — Codebase Scrutiny Reports

> **Date:** 2026-07-11  
> **Scope:** Full-stack technical teardown of `OwnMyHealth` as it exists in the repo  
> **Method:** Static analysis of source, tests, schema, docs, git history, and file-size inventory  
> **Stance:** Adversarial but fair — strengths named; failures not soft-pedaled

This folder holds a multi-file analysis of product honesty, architecture, security, frontend, backend, testing, ops, and documentation. It is **not** a SOC 2 report, pentest, or legal opinion.

---

## How to read

| Order | Document | Purpose |
|------:|----------|---------|
| 0 | [00-executive-verdict.md](./00-executive-verdict.md) | Grades, one-page judgment, bottom line |
| 1 | [01-what-is-strong.md](./01-what-is-strong.md) | Credit: security engine that is actually real |
| 2 | [02-product-honesty-gap.md](./02-product-honesty-gap.md) | Demo vs product; billing, MFA, claims |
| 3 | [03-architecture.md](./03-architecture.md) | Router, god files, dual parsers, multi-instance |
| 4 | [04-security.md](./04-security.md) | Core posture, soft edges, doc contradictions |
| 5 | [05-frontend.md](./05-frontend.md) | SPA structure, UX stubs, type drift |
| 6 | [06-backend.md](./06-backend.md) | Services, routes, performance, layering |
| 7 | [07-testing.md](./07-testing.md) | Coverage holes on PHI paths |
| 8 | [08-data-model-crypto.md](./08-data-model-crypto.md) | Schema, plaintext twins, key rotation |
| 9 | [09-ops-sre.md](./09-ops-sre.md) | Deploy vs operate; Redis, alerting |
| 10 | [10-documentation-pathology.md](./10-documentation-pathology.md) | Doc volume, severity drift, audit theater |
| 11 | [11-priority-fix-list.md](./11-priority-fix-list.md) | P0 / P1 / P2 ordered work |
| 12 | [12-scorecard.md](./12-scorecard.md) | Evaluation lenses (portfolio, SaaS, M&A) |
| — | [sizing-inventory.md](./sizing-inventory.md) | LOC, file counts, largest files, gaps |

---

## One-sentence summary

OwnMyHealth has an **A-minus vault** and a **C-minus product**: exceptional diligence on encryption/RLS/auth, incomplete discipline on architecture, multi-instance ops, monetization, and tests on the newest PHI paths.

---

## Related in-repo sources

- `New Project Documents/KNOWN_ISSUES.md`
- `New Project Documents/SECURITY_STATUS.md`
- `New Project Documents/Go-To-Market/` (esp. readiness + financial model)
- `security/assessment-2026-06-20/` and `security/assessment-2026-06-21/`

Where this analysis and those docs disagree (notably High-severity openness), that disagreement is called out explicitly in [04-security.md](./04-security.md) and [10-documentation-pathology.md](./10-documentation-pathology.md).

---

## Regenerating / updating

Re-run scrutiny after major security or product work. Prefer updating the dated folder or creating `codebase-scrutiny-YYYY-MM/` rather than silently rewriting history in place.
