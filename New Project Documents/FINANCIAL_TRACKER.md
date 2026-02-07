# OwnMyHealth Financial Tracker

**DRAFT** -- Generated from codebase analysis on 2026-02-06. Requires founder review and business input.

**Last Updated:** 2026-02-06
**Status:** DRAFT -- Costs estimated from published pricing; actuals may vary by usage patterns.

---

## Table of Contents

1. [Infrastructure Costs (Fixed Monthly)](#1-infrastructure-costs-fixed-monthly)
2. [Per-User Variable Costs](#2-per-user-variable-costs)
3. [Development Tool Costs](#3-development-tool-costs)
4. [Total Monthly Cost Estimates by Phase](#4-total-monthly-cost-estimates-by-phase)
5. [Revenue Model](#5-revenue-model)
6. [Break-Even Analysis](#6-break-even-analysis)
7. [Current Financial Position](#7-current-financial-position)
8. [Runway Calculator](#8-runway-calculator)
9. [Business Accounts](#9-business-accounts)
10. [Cost Optimization Opportunities](#10-cost-optimization-opportunities)
11. [Financial Milestones](#11-financial-milestones)
12. [Tax Considerations](#12-tax-considerations)

---

## 1. Infrastructure Costs (Fixed Monthly)

These costs are incurred regardless of user count. Estimates are based on the deployment
configuration found in `.github/workflows/deploy.yml` and `backend/Dockerfile`, targeting
GCP project `ownmyhealth-prod` in `us-central1`.

### 1.1 Google Cloud Run (Backend API)

| Detail | Estimate |
|--------|----------|
| Instance | 1 vCPU, 512 MiB RAM (min instances: 0-1) |
| CPU pricing | $0.000024/vCPU-sec (Tier 1) |
| Memory pricing | $0.0000025/GiB-sec (Tier 1) |
| Free tier | 180,000 vCPU-sec + 360,000 GiB-sec/month |
| **Development (low traffic)** | **$0 -- $5/month** (within or near free tier) |
| **Beta (100 users)** | **$5 -- $15/month** |
| **Production (1,000 users)** | **$15 -- $50/month** |

Notes: Cloud Run scales to zero when idle. Setting `min-instances: 1` to avoid cold starts
costs roughly $17/month for 1 vCPU continuously. The deploy.yml does not currently specify
min-instances, so the service scales to zero during idle periods.

### 1.2 Google Cloud SQL (PostgreSQL)

| Detail | Estimate |
|--------|----------|
| Instance type | db-f1-micro or db-g1-small (Enterprise edition) |
| Smallest instance (1 vCPU, 3.75 GiB) | ~$30/month |
| SSD storage (10 GB) | $2.22/month ($0.222/GB) |
| Automated backups (10 GB) | ~$0.80/month |
| **Estimated total** | **$30 -- $45/month** |

Notes: Cloud SQL is the single largest fixed cost. The database hosts 15+ models including
encrypted PHI, audit logs (7-year retention), sessions, and insurance data. Consider
Cloud SQL Auth Proxy for secure connections. Storage will grow with audit log retention.

### 1.3 Google Cloud Storage (GCS)

Two buckets are configured:

| Bucket | Purpose | Estimate |
|--------|---------|----------|
| `ownmyhealth-user-files` | Lab reports, SBC PDFs (per-user paths) | $0.023/GB/month |
| `ownmyhealth-frontend` | Static frontend assets (Vite build output) | $0.023/GB/month |

| Phase | Storage Estimate | Monthly Cost |
|-------|-----------------|--------------|
| Development | < 1 GB total | < $0.10 |
| Beta (100 users) | ~5 GB files + 50 MB frontend | ~$0.12 |
| Production (1,000 users) | ~50 GB files + 50 MB frontend | ~$1.15 |

Additional costs: Class A operations (writes) at $0.05/10K, Class B operations (reads) at
$0.004/10K, network egress for signed URL downloads.

### 1.4 Artifact Registry (Container Images)

| Detail | Estimate |
|--------|----------|
| Free tier | 0.5 GB |
| Per GB beyond free tier | $0.10/month |
| Estimated image size | ~200-400 MB per tagged image |
| **Estimated cost** | **$0 -- $2/month** (with image cleanup policy) |

### 1.5 Secret Manager

| Detail | Estimate |
|--------|----------|
| Active secret versions (8-10 secrets) | Free tier covers 6; ~$0.06/month for extras |
| Access operations | Free tier covers 10K/month |
| **Estimated cost** | **$0 -- $1/month** |

Secrets configured: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PHI_ENCRYPTION_KEY`,
`ANTHROPIC_API_KEY`, `SENDGRID_API_KEY`, `DATABASE_URL`, `GCP_SA_KEY`, `CSRF_SECRET`,
`GOOGLE_APPLICATION_CREDENTIALS`.

### 1.6 Cloud Logging & Monitoring

| Detail | Estimate |
|--------|----------|
| Free tier | 50 GB/month ingestion |
| Beyond free tier | $0.50/GB |
| **Estimated cost** | **$0 -- $5/month** |

Notes: The backend uses structured logging via a custom logger. HIPAA audit logs are stored
in the database (not Cloud Logging), so Cloud Logging costs should be minimal.

### 1.7 Domain & SSL

| Detail | Estimate |
|--------|----------|
| Domain (ownmyhealth.io) | [NEEDS INPUT] ~$12 -- $40/year ($1 -- $3.33/month) |
| SSL/TLS certificate | $0 (Google-managed certificates for Cloud Run) |
| Cloud CDN (if used for frontend) | [NEEDS INPUT] |
| **Estimated cost** | **$1 -- $4/month** |

### 1.8 Load Balancer (if applicable)

| Detail | Estimate |
|--------|----------|
| Cloud Run default URL | $0 (included) |
| Global External Application LB | ~$18/month + $0.008/GB processed |
| **Estimated cost** | **$0 -- $20/month** |

Notes: Cloud Run provides a default HTTPS URL. A load balancer is only needed for custom
domain mapping with advanced routing. If using Cloud Run domain mapping directly, this cost
is $0.

### Infrastructure Subtotal

| Phase | Monthly Fixed Cost |
|-------|--------------------|
| **Development** | **$32 -- $55** |
| **Beta (100 users)** | **$38 -- $75** |
| **Production (1,000 users)** | **$50 -- $130** |

Cloud SQL dominates fixed costs at every phase.

---

## 2. Per-User Variable Costs

These costs scale with user activity. Estimates are based on the Claude API models and
usage patterns identified in the codebase.

### 2.1 Anthropic Claude API

Four distinct Claude API integration points were identified:

| Use Case | Model | Max Tokens | Estimated Tokens/Call | Source File |
|----------|-------|------------|----------------------|-------------|
| Biomarker guidance | `claude-haiku-4-5-20251001` | 600 output | ~300 input + 200 output | `biomarkerRoutes.ts` |
| Lab report extraction (PDF) | `claude-haiku-4-5-20251001` | 8,192 output | ~5K-50K input + 2K output | `claudeExtraction.ts` |
| SBC insurance extraction | `claude-sonnet-4-20250514` | 16,384 output | ~10K-100K input + 8K output | `sbcExtraction.ts` |
| Insurance cost analysis | `claude-sonnet-4-5-20250929` | 4,000 output | ~2K input + 2K output | `expenseController.ts` |

#### Pricing per Million Tokens (as of Feb 2026)

| Model | Input | Output |
|-------|-------|--------|
| Claude Haiku 4.5 | $1.00/MTok | $5.00/MTok |
| Claude Sonnet 4 | $3.00/MTok | $15.00/MTok |
| Claude Sonnet 4.5 | $3.00/MTok | $15.00/MTok |

#### Per-User Cost Estimates (Monthly Active User)

Assumptions: An active user uploads 1 lab report/month, views guidance for 5 biomarkers/month,
uploads 0.25 SBC documents/month (quarterly insurance review), and requests 0.5 cost analyses/month.

| Action | Model | Input Tokens | Output Tokens | Cost/Call | Calls/Month | Monthly Cost |
|--------|-------|-------------|--------------|-----------|-------------|-------------|
| Biomarker guidance (x5) | Haiku 4.5 | 300 | 200 | $0.0013 | 5 | $0.0065 |
| Lab PDF extraction (x1) | Haiku 4.5 | 20,000 | 2,000 | $0.030 | 1 | $0.030 |
| SBC extraction (x0.25) | Sonnet 4 | 50,000 | 8,000 | $0.270 | 0.25 | $0.068 |
| Cost analysis (x0.5) | Sonnet 4.5 | 2,000 | 2,000 | $0.036 | 0.5 | $0.018 |
| **Total per active user** | | | | | | **~$0.12/month** |

Note: PDF/SBC input tokens vary dramatically with document size. Multi-page SBC documents
can exceed 100K tokens. Long-context pricing applies for inputs over 200K tokens.

| Phase | Active Users | Est. Claude Cost |
|-------|-------------|-----------------|
| Development | 1-5 | $0.50 -- $2 |
| Beta (100 users, 30% active) | 30 | $3 -- $10 |
| Production (1,000 users, 30% active) | 300 | $30 -- $100 |

### 2.2 Google Document AI (OCR)

Used as fallback for scanned lab report images (PNG, JPG, TIFF) when Claude cannot process
the file directly.

| Detail | Estimate |
|--------|----------|
| Cost per page | ~$0.01 -- $0.10/page |
| Typical lab report | 1-5 pages |
| **Cost per OCR call** | **$0.01 -- $0.50** |

Most users will upload PDFs (processed by Claude directly), so Document AI usage should
be infrequent. Estimated 10-20% of uploads may be images requiring OCR.

| Phase | OCR Calls/Month | Monthly Cost |
|-------|----------------|-------------|
| Development | 1-5 | < $0.50 |
| Beta (100 users) | 5-15 | $0.50 -- $5 |
| Production (1,000 users) | 30-100 | $3 -- $30 |

### 2.3 SendGrid (Transactional Email)

Email types: verification, password reset, re-verification.

| Detail | Estimate |
|--------|----------|
| Free tier | 100 emails/day (~3,000/month) |
| Essentials plan | $19.95/month for 50,000 emails |
| Emails per user registration | 1-2 (verification + potential reset) |
| Emails per active user/month | 0-1 (password resets, re-verification) |

| Phase | Emails/Month | Monthly Cost |
|-------|-------------|-------------|
| Development | < 50 | $0 (free tier) |
| Beta (100 users) | 100-300 | $0 (free tier) |
| Production (1,000 users) | 500-2,000 | $0 (free tier; upgrade at ~3K/month) |

### 2.4 Cloud Storage (Per-User File Storage)

| File Type | Typical Size | Files/User/Year |
|-----------|-------------|----------------|
| Lab report PDF | 100 KB -- 2 MB | 4-12 |
| SBC document PDF | 500 KB -- 5 MB | 1-4 |
| Scanned images | 1 -- 10 MB | 2-6 |

Average per user: ~20-50 MB/year stored.

| Phase | Total Storage | Monthly Cost |
|-------|-------------|-------------|
| Beta (100 users, 1 year) | 2 -- 5 GB | < $0.15 |
| Production (1,000 users, 1 year) | 20 -- 50 GB | $0.50 -- $1.15 |

### Per-User Variable Cost Summary

| Cost Category | Per Active User/Month |
|--------------|----------------------|
| Claude API | ~$0.12 |
| Document AI (OCR) | ~$0.01 |
| SendGrid | ~$0.00 (free tier) |
| Cloud Storage | ~$0.005 |
| **Total** | **~$0.14/active user/month** |

---

## 3. Development Tool Costs

### 3.1 Software Subscriptions

| Tool | Monthly Cost | Notes |
|------|-------------|-------|
| ZeroPath (security scanning) | [NEEDS INPUT] ~$200/month? | Referenced in prompt template |
| GitHub (repository) | $0 -- $4/month | Free for public repos; $4/dev/month for Teams |
| Claude Code / Claude Pro (development) | [NEEDS INPUT] $20 -- $200/month | Used for AI-assisted development |
| VS Code / IDE | $0 | Free |
| Prisma Studio | $0 | Included with Prisma |
| **Subtotal** | **[NEEDS INPUT]** | |

### 3.2 Testing & CI/CD

| Tool | Monthly Cost | Notes |
|------|-------------|-------|
| GitHub Actions | $0 -- $10/month | Free tier: 2,000 min/month; sufficient for small team |
| Vitest / Jest | $0 | Open source |
| **Subtotal** | **$0 -- $10** | |

### 3.3 Development Infrastructure

| Tool | Monthly Cost | Notes |
|------|-------------|-------|
| Local PostgreSQL | $0 | For development |
| Anthropic API (dev usage) | $1 -- $10/month | Testing Claude integrations |
| GCP dev project (if separate) | [NEEDS INPUT] | Consider a separate dev Cloud SQL instance |
| **Subtotal** | **$1 -- $10** | |

---

## 4. Total Monthly Cost Estimates by Phase

### Development Phase (Current)

| Category | Low | High |
|----------|-----|------|
| Infrastructure (fixed) | $32 | $55 |
| Variable costs (1-5 users) | $1 | $5 |
| Development tools | [NEEDS INPUT] | [NEEDS INPUT] |
| Subscriptions | [NEEDS INPUT] | [NEEDS INPUT] |
| **Total** | **~$35 + tools** | **~$60 + tools** |

### Beta Phase (100 Users)

| Category | Low | High |
|----------|-----|------|
| Infrastructure (fixed) | $38 | $75 |
| Variable costs (30 active) | $4 | $15 |
| Development tools | [NEEDS INPUT] | [NEEDS INPUT] |
| Subscriptions | [NEEDS INPUT] | [NEEDS INPUT] |
| **Total** | **~$42 + tools** | **~$90 + tools** |

### Production Phase (1,000 Users)

| Category | Low | High |
|----------|-----|------|
| Infrastructure (fixed) | $50 | $130 |
| Variable costs (300 active) | $35 | $130 |
| SendGrid upgrade (if needed) | $0 | $20 |
| Development tools | [NEEDS INPUT] | [NEEDS INPUT] |
| Subscriptions | [NEEDS INPUT] | [NEEDS INPUT] |
| **Total** | **~$85 + tools** | **~$280 + tools** |

### Growth Phase (10,000 Users)

| Category | Low | High |
|----------|-----|------|
| Infrastructure (fixed) | $80 | $250 |
| Variable costs (3,000 active) | $350 | $1,300 |
| SendGrid (Essentials) | $20 | $20 |
| Cloud SQL upgrade (larger instance) | $60 | $150 |
| Development tools | [NEEDS INPUT] | [NEEDS INPUT] |
| **Total** | **~$510 + tools** | **~$1,720 + tools** |

---

## 5. Revenue Model

**[NEEDS INPUT]** -- This section requires founder decisions on pricing strategy.

### Pricing Tiers (Proposed -- Needs Validation)

| Tier | Price | Features | Target Users |
|------|-------|----------|-------------|
| Free | $0/month | [NEEDS INPUT] -- Limited biomarker tracking, no AI? | Casual users |
| Basic | [NEEDS INPUT] | [NEEDS INPUT] -- Biomarker tracking + limited AI guidance? | Individual health trackers |
| Pro | [NEEDS INPUT] | [NEEDS INPUT] -- Full AI guidance + insurance management? | Active health managers |
| Family | [NEEDS INPUT] | [NEEDS INPUT] -- Multi-user + provider sharing? | Families / caregivers |

### Key Pricing Questions [NEEDS INPUT]

1. What features are gated behind paid tiers?
2. How many free AI guidance calls per month?
3. Is file upload (lab reports, SBCs) a free or paid feature?
4. Is provider collaboration free or premium?
5. What is the target price point per user per month?
6. Will there be annual discount pricing?
7. Is a freemium model or free trial approach preferred?

### Revenue Projections [NEEDS INPUT]

| Users | Free % | Paid % | Price | Monthly Revenue |
|-------|--------|--------|-------|----------------|
| 100 | [NEEDS INPUT] | [NEEDS INPUT] | [NEEDS INPUT] | [NEEDS INPUT] |
| 500 | [NEEDS INPUT] | [NEEDS INPUT] | [NEEDS INPUT] | [NEEDS INPUT] |
| 1,000 | [NEEDS INPUT] | [NEEDS INPUT] | [NEEDS INPUT] | [NEEDS INPUT] |
| 10,000 | [NEEDS INPUT] | [NEEDS INPUT] | [NEEDS INPUT] | [NEEDS INPUT] |

---

## 6. Break-Even Analysis

**[NEEDS INPUT]** -- Requires pricing decisions from Section 5.

### Break-Even Formula

```
Break-even users = Fixed monthly costs / (ARPU - Variable cost per user)

Where:
  Fixed costs    = Infrastructure + Tools + Subscriptions
  ARPU           = Average Revenue Per User (paid users only)
  Variable cost  = ~$0.14/active user/month (Claude + storage + email)
```

### Example Scenarios

Assuming fixed costs of ~$100/month (development/beta phase):

| Monthly Price | Conversion Rate | Break-Even Users (Total) | Break-Even Paid Users |
|---------------|----------------|--------------------------|----------------------|
| $2.99/month | 5% | ~700 | ~35 |
| $4.99/month | 5% | ~410 | ~21 |
| $9.99/month | 5% | ~200 | ~10 |
| $4.99/month | 10% | ~210 | ~21 |
| $9.99/month | 10% | ~100 | ~10 |

Note: These are simplified estimates. Actual break-even depends on the full cost structure
including development tools, founder salary/opportunity cost, and growth-phase infrastructure.

### Full Break-Even (Including Founder Salary) [NEEDS INPUT]

| Item | Monthly Cost |
|------|-------------|
| Infrastructure | ~$100 |
| Development tools | [NEEDS INPUT] |
| Founder salary target | [NEEDS INPUT] |
| **Total monthly burn** | **[NEEDS INPUT]** |

---

## 7. Current Financial Position

**[NEEDS INPUT]** -- Requires founder input.

| Category | Amount |
|----------|--------|
| Personal Savings | [NEEDS INPUT] |
| Reserved (IRA, do not touch) | [NEEDS INPUT] |
| Business Account Balance | [NEEDS INPUT] |
| **Available for Business** | **[NEEDS INPUT]** |

### Savings Goal [NEEDS INPUT]

- **Target:** [NEEDS INPUT]
- **Timeline:** [NEEDS INPUT]
- **Progress:** [NEEDS INPUT]

---

## 8. Runway Calculator

**[NEEDS INPUT]** -- Requires financial position data.

| Monthly Burn | Runway @ $10K Available | Runway @ $25K Available | Runway @ $50K Available |
|--------------|-------------------------|-------------------------|-------------------------|
| $100 (infra only) | 100 months | 250 months | 500 months |
| $500 (infra + tools) | 20 months | 50 months | 100 months |
| $2,000 (infra + part-time) | 5 months | 12.5 months | 25 months |
| $5,000 (full-time target) | 2 months | 5 months | 10 months |

---

## 9. Business Accounts

**[NEEDS INPUT]** -- Requires founder input.

### Business Entity

| Detail | Value |
|--------|-------|
| Business structure | [NEEDS INPUT] -- LLC, Sole Prop, etc. |
| State of formation | [NEEDS INPUT] |
| EIN | [NEEDS INPUT] |

### Business Banking

| Detail | Value |
|--------|-------|
| Bank | [NEEDS INPUT] |
| Account type | [NEEDS INPUT] |
| Balance | [NEEDS INPUT] |

### Business Credit Card

| Detail | Value |
|--------|-------|
| Card | [NEEDS INPUT] |
| Credit Limit | [NEEDS INPUT] |
| Sign-up Bonus | [NEEDS INPUT] |
| Bonus Progress | [NEEDS INPUT] |
| Reward Categories | [NEEDS INPUT] |

---

## 10. Cost Optimization Opportunities

### 10.1 Immediate Savings (No Code Changes)

| Optimization | Potential Savings | Effort |
|-------------|------------------|--------|
| **Cloud SQL right-sizing** -- Use `db-f1-micro` for dev/beta | $10 -- $20/month | Low |
| **Artifact Registry cleanup** -- Delete old image tags | $1 -- $5/month | Low |
| **Cloud Run min-instances: 0** -- Accept cold starts in beta | $0 -- $17/month | None (current default) |
| **GCS lifecycle policies** -- Archive old user files | < $1/month | Low |

### 10.2 Code-Level Optimizations

| Optimization | Potential Savings | Effort |
|-------------|------------------|--------|
| **Prompt caching (Anthropic)** -- Cache SBC extraction prompt (~750 tokens) | Up to 90% on cached input tokens | Medium |
| **Batch API for non-urgent calls** -- Biomarker guidance can be async | 50% discount on batch calls | Medium |
| **Downgrade SBC extraction model** -- Test Haiku for simpler SBCs | 60-70% cost reduction per SBC call | Medium |
| **Cache AI responses** -- Store and reuse biomarker guidance for same value ranges | 80-95% reduction in repeat calls | Medium |
| **Rate-limit AI calls per user** -- Prevent abuse of guidance endpoint | Risk mitigation | Low |

### 10.3 Architecture Optimizations (Longer Term)

| Optimization | Potential Savings | Effort |
|-------------|------------------|--------|
| **Move to AlloyDB or self-managed PostgreSQL** | $15 -- $25/month | High |
| **Cloud Run committed use discounts (1-year)** | 28% on compute | Low (just commit) |
| **Cloud SQL committed use discounts (1-year)** | Up to 25% | Low (just commit) |
| **Frontend: Cloudflare Pages or Vercel** -- Free static hosting | $0.023/GB/month GCS savings | Medium |
| **Replace Document AI with Tesseract.js** -- Already a frontend dependency | $0.01-$0.50/OCR call | High (accuracy tradeoff) |

### 10.4 Cost Monitoring Recommendations

1. Set up GCP budget alerts at $50, $100, and $200/month thresholds
2. Enable Anthropic API usage tracking and set spending limits
3. Monitor Cloud SQL storage growth (audit logs with 7-year retention)
4. Track per-endpoint Claude API token usage in application logs
   (already partially implemented -- `inputTokens`/`outputTokens` logged in extraction services)

---

## 11. Financial Milestones

**[NEEDS INPUT]** -- Requires founder input on dates and targets.

| Milestone | Target Date | Status | Notes |
|-----------|-------------|--------|-------|
| Infrastructure deployed | [NEEDS INPUT] | [NEEDS INPUT] | Cloud Run + Cloud SQL + GCS |
| First beta users | [NEEDS INPUT] | [NEEDS INPUT] | |
| 100 registered users | [NEEDS INPUT] | [NEEDS INPUT] | |
| First paid user | [NEEDS INPUT] | [NEEDS INPUT] | |
| Break-even (infra costs) | [NEEDS INPUT] | [NEEDS INPUT] | ~10-35 paid users depending on pricing |
| 1,000 registered users | [NEEDS INPUT] | [NEEDS INPUT] | |
| Full-time transition | [NEEDS INPUT] | [NEEDS INPUT] | |

---

## 12. Tax Considerations

**[NEEDS INPUT]** -- Requires founder input and possibly CPA review.

### Deductible Business Expenses

| Category | Items |
|----------|-------|
| Cloud infrastructure | GCP costs (Cloud Run, Cloud SQL, GCS, etc.) |
| SaaS subscriptions | SendGrid, ZeroPath, GitHub, Claude API |
| Domain & hosting | Domain registration, SSL (if paid) |
| Development tools | IDE licenses, testing tools |
| Professional services | CPA, legal (LLC formation), HIPAA compliance consulting |
| Home office | [NEEDS INPUT] -- Percentage of rent/mortgage if applicable |
| Equipment | Computer, monitor, peripherals used for development |
| Education | Courses, certifications related to healthcare tech |

### HIPAA Compliance Costs (Potential)

| Item | Estimated Cost | Frequency |
|------|---------------|-----------|
| HIPAA compliance assessment | [NEEDS INPUT] | Annual |
| Security audit | [NEEDS INPUT] | Annual |
| Cyber liability insurance | [NEEDS INPUT] | Annual |
| BAA (Business Associate Agreement) with GCP | $0 (included with GCP HIPAA support) | -- |

### Record Keeping

- Business structure: [NEEDS INPUT]
- Accounting method: [NEEDS INPUT]
- Record keeping tool: [NEEDS INPUT] (QuickBooks, Wave, spreadsheet, etc.)

---

## Funding & Grants

**[NEEDS INPUT]** -- Requires founder input.

| Item | Status | Notes |
|------|--------|-------|
| SAM.gov registration | [NEEDS INPUT] | Required for federal grants |
| DUNS number | [NEEDS INPUT] | Required for federal grants |
| SBIR/STTR eligibility | [NEEDS INPUT] | Small business health tech grants |
| State health innovation grants | [NEEDS INPUT] | Varies by state |
| Angel/VC interest | [NEEDS INPUT] | |
| Bootstrapping plan | [NEEDS INPUT] | |

---

## Appendix A: Service Dependencies and Pricing Sources

### External Services Used (from `backend/package.json`)

| Package | Service | Pricing Model |
|---------|---------|--------------|
| `@anthropic-ai/sdk` | Anthropic Claude API | Per-token (input + output) |
| `@google-cloud/storage` | Google Cloud Storage | Per-GB storage + operations |
| `@google-cloud/documentai` | Google Document AI | Per-page processed |
| `@sendgrid/mail` | Twilio SendGrid | Free tier (100/day) then tiered plans |
| `@prisma/client` + `pg` | Google Cloud SQL (PostgreSQL) | Per-instance-hour + storage |

### Pricing Source Links

- [Cloud Run Pricing](https://cloud.google.com/run/pricing)
- [Cloud SQL Pricing](https://cloud.google.com/sql/pricing)
- [Cloud Storage Pricing](https://cloud.google.com/storage/pricing)
- [Artifact Registry Pricing](https://cloud.google.com/artifact-registry/pricing)
- [Secret Manager Pricing](https://cloud.google.com/secret-manager/pricing)
- [Document AI Pricing](https://cloud.google.com/document-ai/pricing)
- [Anthropic Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [SendGrid Pricing](https://sendgrid.com/en-us/pricing)

---

*This document is a DRAFT generated from codebase analysis. All cost estimates are based on
published pricing as of 2026-02-06 and typical usage patterns. Actual costs will vary based
on real user behavior, document sizes, and AI call frequency. Sections marked [NEEDS INPUT]
require founder business decisions and cannot be inferred from code alone.*
