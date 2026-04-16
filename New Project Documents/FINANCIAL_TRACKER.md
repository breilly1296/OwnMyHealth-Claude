# OwnMyHealth Financial Tracker

**Last Updated:** 2026-04-16 (skeleton — all $ figures are **TBD**; run prompt `23-financial-tracker-doc.md` to fill)

> This document is a template. Everything below is either a structural placeholder (`$X,XXX`) or derivable from code/infrastructure. Run prompt 23's Q&A to populate actual numbers.

---

## Current Financial Position (TBD)

| Category | Amount |
|---|---|
| Personal Savings | $X,XXX |
| Reserved (IRA — do not touch) | $XX,XXX |
| Business Account | $X,XXX |
| **Available runway** | **$XX,XXX** |

### Savings Goal
- **Target:** $XXX,XXX by YYYY-MM-DD
- **Progress:** XX%

```
Target: $XXX,XXX
Current:  $XX,XXX [░░░░░░░░░░░░] XX%
```

---

## Monthly Costs

### Infrastructure (GCP) — **TBD, verify from GCP billing**

| Service | Est. Monthly | Notes |
|---|---|---|
| Cloud Run (backend) | $X | `ownmyhealth-prod` service, us-central1. Cost scales with request volume + CPU seconds. |
| Cloud SQL (Postgres) | $X | `verifymyprovider` or equivalent instance. Idle cost + storage + egress. |
| Cloud Storage (GCS) | $X | `ownmyhealth-frontend` bucket (static) + lab/SBC file bucket. |
| Cloud Build | $X | Only bills on builds; free tier usually covers. |
| Artifact Registry | $X | Docker image storage. |
| Secret Manager | $X | Per-secret minor cost + access operations. |
| Cloud Logging | $X | Per-GB ingestion (can spike with debug). |
| Cloud Load Balancer (if used) | $X | ~$18/mo base + data. |
| Document AI (OCR) | $X | Per-page billing for lab-report OCR fallback. |
| **Subtotal GCP** | **$XXX** | |

### Infrastructure (non-GCP)

| Service | Monthly | Purpose |
|---|---|---|
| SendGrid | $X | Transactional email. Free tier usually covers early users. |
| Domain registrar | ~$1 | Annual amortized. |
| **Subtotal** | **$XX** | |

### Subscriptions (TBD)

| Service | Monthly | Purpose |
|---|---|---|
| ZeroPath (security scanning) | $200 | Listed in prompt 23 as a reference. Confirm if active. |
| Other | $X | |
| **Subtotal** | **$XXX** | |

### Variable (API usage)

| Service | Est. Monthly |
|---|---|
| Anthropic Claude API | $X |
| Cost model: biomarker guidance × users + SBC extraction × uploads + cost analysis × requests. Expected baseline low; scales with user activity. | |
| **Subtotal** | **$XX** |

### Total Monthly Burn (projected, **TBD** with real numbers)

| Phase | Cost |
|---|---|
| Development (no users) | $XXX |
| Beta (100 users) | $XXX |
| Production (1,000 users) | $X,XXX |
| Production (10,000 users) | $X,XXX |

---

## Revenue Model (TBD — decide in prompt 14, reflected here)

### Pricing Tiers

| Tier | Price | Features |
|---|---|---|
| Free | $0 | Manual biomarker entry, basic trends, 1 insurance plan, 5 AI calls/mo |
| Pro | $X.XX/mo | Unlimited plans, unlimited AI, OCR, expense tracking, provider collab |
| Family | $XX.XX/mo | Pro × N family members under one billing |

(Structure is illustrative; confirm via prompt 14 §Business Model.)

### Break-Even Analysis (TBD)

| Paid Users | MRR | Costs | Net |
|---|---|---|---|
| 100 | $X,XXX | $X,XXX | -$X,XXX |
| 500 | $X,XXX | $X,XXX | +$X,XXX |
| 1,000 | $X,XXX | $X,XXX | +$X,XXX |

**Break-even target:** ~$XXX paid users (TBD after pricing set).

---

## Business Accounts (TBD)

### Business Credit Card

| Detail | Value |
|---|---|
| Card | TBD |
| Credit Limit | $X,XXX |
| Sign-up bonus | $XXX after $X,XXX spend |
| Bonus progress | $X,XXX / $X,XXX |
| Top categories | TBD |

### Business Bank Account
- **Bank:** TBD
- **Account type:** TBD
- **Entity:** LLC / Sole prop / TBD

---

## Runway Calculator

Given **$AVAILABLE** (see Current Financial Position) and **$BURN/month**:

| Monthly Burn | Runway @ $AVAILABLE |
|---|---|
| $1,000 | X months |
| $2,000 | X months |
| $3,000 | X months |

Fill in actual burn when known.

---

## Financial Milestones (TBD)

| Milestone | Target Date | Status |
|---|---|---|
| First $ from customer | YYYY-MM-DD | Not started |
| $1K MRR | YYYY-MM-DD | Not started |
| Break-even | YYYY-MM-DD | Not started |
| Full-time transition | YYYY-MM-DD | Not started |
| $10K MRR | YYYY-MM-DD | Not started |

---

## Cost Watch-outs (code-derived — high-signal warnings)

These come from reviewing the codebase. None need cost now, but each represents a potential cost explosion vector:

1. **Claude API spend** — `aiLimiter` caps requests, `aiCostTracker.ts` accounts them. **Confirm:** (a) a monthly hard cap exists at GCP billing, (b) alerts fire at 50%/80%/100%.
2. **Cloud SQL storage growth** — encrypted PHI rows are larger than plaintext (~3× for short fields due to IV + tag). File metadata rows are small; the real growth is AuditLog (7-year retention). **Estimate:** at 10K users × 50 ops/month × 7 years = 42M audit rows. Plan storage accordingly.
3. **GCS egress** — signed URL downloads don't bill on the bucket side unless out-of-region. Verify bucket region matches Cloud Run.
4. **Document AI OCR** — only triggered when `pdf-parse` can't extract text. Most real labs are text-PDFs; cost should be small. Monitor.
5. **SendGrid** — free up to ~100 emails/day. Transactional load (verification, reset) is low. Marketing email would break this tier.

---

## Grants / Funding (TBD)

| Source | Amount | Status | Requirements |
|---|---|---|---|
| TBD | $X,XXX | Not started | SAM.gov, DUNS, etc. |

---

## Tax Considerations (TBD)

- **Business structure:** TBD (LLC likely).
- **Deductible expenses:** infrastructure, software subscriptions, professional services, home office.
- **Record keeping:** TBD (dedicated business bank account recommended before commingling).
- **Quarterly estimated taxes:** TBD once revenue exists.

---

## Sections to fill via prompt 23 Q&A

- Current Financial Position — §Current Financial Position Q1–Q4
- Monthly Infrastructure (actual GCP bill) — §Monthly Infrastructure Costs Q1
- Subscriptions — §Monthly Infrastructure Costs Q2
- Anthropic API spend (last 3 months actual) — §Monthly Infrastructure Costs Q3
- Business accounts — §Business Accounts
- Revenue tiers + break-even — §Revenue + §Projections
- Runway — §Projections Q2
- Grants — §Funding/Grants
