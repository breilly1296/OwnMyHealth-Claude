---
tags:
  - documentation
  - financial
  - business
type: prompt
priority: 3
---

# Generate FINANCIAL_TRACKER.md

## Purpose
Create or update the financial tracking document for OwnMyHealth.

## Questions to Ask

### Current Financial Position
1. What's your current personal savings?
2. What's reserved (IRA, don't touch)?
3. What's the savings goal and timeline?
4. What's the target for going full-time?

### Monthly Infrastructure Costs
1. What are the cloud costs by service?
   - Cloud Run
   - Cloud SQL
   - Cloud Storage
   - Load Balancer
   - Secret Manager
   - Cloud Logging
2. What software subscriptions?
   - Security tools (ZeroPath)
   - Domains
   - Other services
3. What API costs?
   - Anthropic API usage
   - Other APIs

### Business Accounts
1. Any business credit cards?
   - Credit limit
   - Rewards structure
   - Sign-up bonus status
2. Business bank account?
3. Business entity (LLC, etc.)?

### Revenue (if any)
1. Current pricing tiers planned?
2. Number of paying users (if any)?
3. Monthly revenue (if any)?
4. Break-even estimate (users needed)?

### Projections
1. Estimated monthly burn rate?
2. Runway at current savings?
3. Target revenue milestones?

### Funding/Grants
1. Any grants being pursued?
2. Grant requirements (SAM.gov, DUNS)?
3. Investor interest?

## Output Format

```markdown
# OwnMyHealth Financial Tracker

**Last Updated:** [Date]

---

## Current Financial Position

| Category | Amount |
|----------|--------|
| Personal Savings | $XX,XXX |
| Reserved (IRA) | $XX,XXX |
| Business Account | $X,XXX |
| **Available** | **$XX,XXX** |

### Savings Goal
- **Target:** $XXX,XXX by [Date]
- **Progress:** XX%

```
Target: $100,000
├── Current: $XX,XXX [████░░░░░░░░] XX%
└── Goal: $100,000  [████████████] 100%
```

---

## Monthly Costs

### Infrastructure
| Service | Monthly Cost |
|---------|-------------|
| Cloud Run | $XX |
| Cloud SQL | $XX |
| Cloud Storage | $XX |
| Load Balancer | $XX |
| Secret Manager | $X |
| Cloud Logging | $XX |
| **Subtotal** | **$XXX** |

### Subscriptions
| Service | Monthly Cost |
|---------|-------------|
| ZeroPath | $200 |
| Domain | $1 |
| **Subtotal** | **$XXX** |

### Variable (API Usage)
| Service | Est. Monthly |
|---------|-------------|
| Anthropic API | $XX |
| **Subtotal** | **$XX** |

### Total Monthly Costs
| Phase | Cost |
|-------|------|
| Development | $XXX |
| Beta (100 users) | $XXX |
| Production (1000 users) | $XXX |

---

## Revenue Model

### Pricing Tiers
| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | [features] |
| Pro | $X.XX/mo | [features] |
| Family | $XX.XX/mo | [features] |

### Break-Even Analysis
| Users | Revenue | Costs | Net |
|-------|---------|-------|-----|
| 100 | $XXX | $XXX | -$XXX |
| 500 | $XXX | $XXX | +$XXX |
| 1000 | $X,XXX | $XXX | +$XXX |

**Break-even:** ~XXX paid users

---

## Business Accounts

### Chase Ink Business Cash
| Detail | Value |
|--------|-------|
| Credit Limit | $X,XXX |
| Sign-up Bonus | $XXX after $X,XXX spend |
| Bonus Progress | $X,XXX / $X,XXX |
| 5% Categories | Office, internet, phone |
| 2% Categories | Gas, restaurants |

---

## Runway Calculator

| Monthly Burn | Runway @ $XXK | Runway @ $XXK |
|--------------|---------------|---------------|
| $X,XXX | X months | X months |
| $X,XXX | X months | X months |

---

## Financial Milestones

| Milestone | Target Date | Status |
|-----------|-------------|--------|
| Q1 Savings | [Date] | ⏳ |
| First Revenue | [Date] | ⏳ |
| Break-even | [Date] | ⏳ |
| Full-time | [Date] | ⏳ |

---

## Tax Considerations
- Business structure: [Type]
- Deductible expenses: [List]
- Record keeping: [Method]
```
