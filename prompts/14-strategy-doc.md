---
tags:
  - documentation
  - strategy
type: prompt
priority: 2
---

# Generate STRATEGY.md

## Purpose
Create or update the strategic direction document for OwnMyHealth.

## Questions to Ask

### Mission & Vision
1. What problem is OwnMyHealth solving?
2. Who is the target user (be specific)?
3. What makes OwnMyHealth different from competitors?
4. What is the long-term vision?

### Product Strategy
1. What products are being built?
   - OwnMyHealth (health tracking)
   - HealthcareProviderDB (provider directory)
   - Others?
2. What is the validation status of each product?
3. What's the launch sequence (which first)?
4. What's the ecosystem hypothesis (how do they connect)?

### Business Model
1. What are the pricing tiers?
   - Free tier features
   - Pro tier price and features
   - Family/team tier?
2. What's the unit economics?
   - Cost per user (infrastructure, API calls)
   - Target margin
3. What's the break-even point (number of users)?

### Key Decisions
1. What major technical decisions have been made?
   - Cloud provider choice
   - Tech stack choices
   - Build vs buy decisions
2. What alternatives were considered and rejected?
3. Any pivots or major strategy changes?

### Timeline & Milestones
1. What are the quarterly goals?
2. What's the target date for beta launch?
3. What's the target date for going full-time?
4. What financial milestones are being tracked?

### Risks
1. What could kill this business?
2. What are the top 3-5 risks?
3. What are the mitigations for each?

## Output Format

```markdown
# OwnMyHealth Strategy

**Last Updated:** [Date]

## Mission Statement
[One paragraph]

## Core Principles
1. [Principle 1]
2. [Principle 2]
...

## Product Strategy
### OwnMyHealth
[Description, status, validation path]

### HealthcareProviderDB
[Description, status, validation path]

## Business Model
### Pricing Tiers
| Tier | Price | Features |
...

### Unit Economics
[Costs, margins, break-even]

## Decision Log
| Date | Decision | Rationale |
...

## Milestones
### Q1 2026
- [ ] Goal 1
...

## Risk Register
| Risk | Probability | Impact | Mitigation |
...

## Strategic Reminders
1. [Key reminder]
...
```
