# 11 — Priority Fix List

Ordered for **trust → scale honesty → maintainability**.  
Acceptances are written so “done” is verifiable.

---

## P0 — Integrity / trust (before money or marketing)

| # | Work | Done when |
|---|------|-----------|
| P0-1 | Run `user_files` filename backfill + DROP plaintext column | Prod dry-run → apply; no plaintext filenames; migration dropped column |
| P0-2 | Cap Document AI OCR dollars into fail-closed budget | OCR cost accrues; hits same daily/user breaker; 503 when over |
| P0-3 | Verified self-serve export + account deletion | User completes export + delete unaided; salt destroyed; audit rows; e2e or manual script evidence |
| P0-4 | TOTP MFA + recovery codes | Optional enable; enforced on sensitive ops; recovery tested |
| P0-5 | Real billing or remove Upgrade | Stripe Checkout + webhooks update `plan` / `planExpiresAt`, **or** CTA removed |
| P0-6 | Reconcile security severity ledgers | One open High/Medium/Low list; SECURITY_STATUS matches KNOWN_ISSUES |
| P0-7 | BAAs / vendor PHI policy | GCP (+ Document AI) BAA on file; SendGrid PHI-free or replaced |
| P0-8 | Breach detection minimum | Alerts on audit anomalies / repeated login failures; named owner; runbook section |

---

## P1 — Architecture that stops rotting

| # | Work | Done when |
|---|------|-----------|
| P1-1 | Redis in staging/prod | Rate limit + AI spend shared; documented required env |
| P1-2 | Shared FHIR PKCE store | Multi-instance OAuth works; H-2 closed |
| P1-3 | Client router | Deep links for major sections; no pathname growth in App |
| P1-4 | Collapse dual parsers | Server owns extraction; FE confirm/edit only (or documented offline-only) |
| P1-5 | Split god files | `authService`, patterns data, upload shared, largest FE panels decomposed |
| P1-6 | Tests for untested PHI five | AI chat, file, lab upload, SBC upload, FHIR controller tests green in CI |
| P1-7 | Atomic plan-limit reservation | TOCTOU H-1 closed or formally accepted with abuse monitoring |
| P1-8 | SPA edge headers | CSP/XFO/HSTS (as applicable) on frontend origin |

---

## P2 — Product engineering maturity

| # | Work | Done when |
|---|------|-----------|
| P2-1 | Server-state library (React Query etc.) | Shared fetch/cache/invalidation patterns |
| P2-2 | Observability SDK | Sentry (or equiv.) in prod; error budgets reviewed |
| P2-3 | Playwright critical journeys | Lab upload, insurance, consent, export/delete paths |
| P2-4 | Kill type casts | API DTO ↔ domain types aligned; no `as unknown as Biomarker` |
| P2-5 | Biomarker summary/search APIs | FE does not need full history for dashboard |
| P2-6 | CSP nonce migration | Remove style `unsafe-inline` |
| P2-7 | KDF metadata + re-encrypt | Remove PBKDF2 legacy fallback |
| P2-8 | PWA / installable experience | If still in product strategy |

---

## Suggested 30-day slice (if constrained)

1. P0-6 ledger reconciliation (days)  
2. P0-2 OCR $ cap  
3. P0-1 filename backfill  
4. P0-5 billing **or** remove Upgrade CTA  
5. P1-6 tests for lab upload + AI chat (highest traffic PHI)  
6. P0-3 export/delete verification  

Defer PWA and full dual-parser collapse slightly if trust/money blockers are not closed.

---

## Explicit non-goals (until P0 clear)

- Another full multi-agent “security theater” doc refresh
- New feature domains (genetics, marketplace, etc.)
- SOC 2 / HITRUST spend before chargeable product exists (unless enterprise buyer demands)

---

## Mapping to existing GTM P0 list

This list is consistent with `New Project Documents/Go-To-Market/02-PRODUCT-READINESS-CHECKLIST.md` (billing, export/delete, MFA, breach detect, BAAs, plaintext residue, OCR cap). Engineering should treat GTM P0 and this P0 as **the same program of work**.
