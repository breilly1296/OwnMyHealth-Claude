---
tags:
  - documentation
  - financial
  - business
type: prompt
priority: 3
updated: 2026-04-24
---

# Generate FINANCIAL_TRACKER.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc must pass the five tests in `_doc-quality.md` before you stop.

Note: Financials have the highest density of legitimately external facts (personal savings, actual billing-console numbers, runway). The No-TBD rule still applies — derive the code-adjacent skeleton (which paid services the app uses, rate-limit-inferred quotas, instance sizing from `railway.toml`) first, then mark the rest with clear external resolution paths.

---

## Purpose

Produce `New Project Documents/FINANCIAL_TRACKER.md` — the **unit-economics + runway reference**. What does this app cost to run per user? Which services are metered? What's the break-even model? Most dollar values live in the billing console, not code — but the *structure* of costs lives in the repo, and this doc extracts that structure.

---

## Files to review

| File | Why read it |
|---|---|
| `package.json` (root + `backend/`) | List paid third-party SDKs: `@anthropic-ai/sdk`, `@sendgrid/*`, `@google-cloud/*` (storage, documentai), any analytics/monitoring. |
| `backend/railway.toml` | Cloud Run instance sizing (CPU, memory, max instances). |
| `.github/workflows/deploy.yml`, `deploy-staging.yml` | Cloud Run deploy parameters. |
| `backend/src/middleware/rateLimiter.ts` | Rate limits act as cost ceilings — each limiter bounds a cost. |
| `backend/src/services/claudeExtraction.ts`, `sbcExtraction.ts` | Anthropic model name + input/output size → unit cost per call. |
| `backend/src/services/ocrService.ts` | Google Document AI processor — units metered per page. |
| `backend/src/services/storageService.ts` | GCS read/write/storage metered unit. |
| `backend/src/services/emailService.ts` | SendGrid tier. |
| `backend/prisma/schema.prisma` | DB size footprint drivers. |

---

## Required sections

1. **Cost structure** — derived from code. Every service the app pays for, metered unit, code entry point, governing rate limit.
2. **Fixed costs** — Cloud Run idle (per `railway.toml`), Cloud SQL, domain, monitoring subscriptions.
3. **Variable costs (per call)** — Anthropic call, Document AI page, SendGrid email, GCS operation.
4. **Per-user cost model** — assume N calls/user/month (mark assumptions), multiply out. Provide formula, not a guess.
5. **Break-even table** — given a pricing tier, how many users until revenue ≥ cost?
6. **Rate-limit cost ceilings** — for each AI / email / upload endpoint, the per-user monthly max cost if they hit the limit every window.
7. **Current position** (mark external) — personal savings, runway, revenue.
8. **Business accounts** (mark external) — credit cards, bank.
9. **Pricing tiers** (mark external, but derive any hints from code — e.g., `planGating.ts` and `planRoutes.ts` if present).
10. **Tax / structure** (mark external).
11. **Related Documents**.
12. **Prompt drift log**.

---

## Required artifacts

### Cost structure (derived from code)

| Service | Metered unit | Code entry point | Governing rate limit | Per-unit cost (ref) |
|---|---|---|---|---|
| Anthropic Claude API | input + output tokens | `backend/src/services/claudeExtraction.ts:Lxx` (model = `claude-haiku-4-5-20251001` per `CLAUDE.md`/memory) | `aiLimiter` | Anthropic pricing page |
| Google Document AI | pages processed | `backend/src/services/ocrService.ts:Lxx` | `uploadLimiter` | GCP pricing page |
| Google Cloud Storage | GB-months stored + ops | `backend/src/services/storageService.ts:Lxx` | `uploadLimiter` | GCP pricing page |
| SendGrid | emails sent | `backend/src/services/emailService.ts:Lxx` | n/a | SendGrid tier |
| Cloud Run | vCPU-seconds + requests | `backend/railway.toml:Lxx` (CPU/mem) | global + per-route | GCP pricing |
| Cloud SQL | instance-hour + storage | — (config in GCP console) | n/a | GCP pricing |

### Per-user cost formula

```
cost_per_user_per_month =
    fixed_infra / active_users
  + Anthropic_calls_per_user * avg_cost_per_call
  + Document_AI_pages_per_user * cost_per_page
  + emails_per_user * cost_per_email
  + GCS_storage_per_user * cost_per_GB_month
```

State each assumption explicitly (e.g., "assume 20 AI biomarker guidance calls/user/month; bounded by `aiLimiter` at N/hour").

### Rate-limit cost ceilings

| Endpoint family | Limit | Max calls/user/month | Max cost/user/month |
|---|---|---|---|
| AI guidance (`/biomarkers/:id/guidance` etc.) | `aiLimiter` N/hour | 720 * N | $… (external price) |
| Upload (`/upload/*`) | `uploadLimiter` 20/hour | 14,400 | $… |
| Sensitive ops (export/delete) | `sensitiveLimiter` 10/hour | 7,200 | $… |

### Break-even table

| Users | Revenue (at tier X price $) | Costs (formula above) | Net |
|---|---|---|---|
| 100 | TBD (pricing external) | derived | TBD |
| 500 | TBD | derived | TBD |
| 1000 | TBD | derived | TBD |

### Fixed-cost summary

| Line item | Amount | Source |
|---|---|---|
| Cloud Run baseline | TBD (external: GCP billing) | `railway.toml` shows instance size; billing console shows actual $ |
| Cloud SQL | TBD (external: GCP billing) | instance class lives in GCP Console |
| Domain | TBD (external) | — |
| Monitoring / security tool subscriptions | TBD (external) | — |

### Current position / runway

These are intentionally external. Provide slots + resolution path:

| Field | Value | Resolution path |
|---|---|---|
| Personal savings | TBD (external) | owner |
| Burn rate | TBD (external: GCP + SaaS billing) | compute after filling fixed + variable actuals |
| Runway | derived | derived once burn is known |
| Revenue | TBD (external) | billing system or Stripe dashboard |

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. Which services does OwnMyHealth pay for? (list derived from code)
2. What's the per-user cost formula?
3. Which rate limit caps the worst-case Anthropic cost per user?
4. Which Anthropic model is used in production, per code?
5. Which file hosts the Document AI integration?
6. What's the fixed vs variable cost split, conceptually?
7. What user count triggers break-even at a $X/month tier? (symbolic if $ not yet set)
8. What's the on-paper max cost per user if they exploited the rate limits continuously?
9. Which fixed costs can be derived from repo vs require the GCP console?
10. Which service has no in-repo rate limit and therefore no cost ceiling in code?

---

## No-TBD enforcement

Before marking anything TBD:

- **Paid services**: `Grep pattern: "@anthropic-ai|@sendgrid|@google-cloud"` over `package.json` files.
- **Model name for Anthropic**: read `claudeExtraction.ts`, `sbcExtraction.ts`; cross-check CLAUDE.md note.
- **Instance sizing**: read `backend/railway.toml`.
- **Cloud Run deploy params**: read `.github/workflows/deploy.yml` for `--cpu`, `--memory`, `--max-instances`.
- **Rate limits**: read `backend/src/middleware/rateLimiter.ts` and note the window/max per limiter.
- **Email tier**: `Grep pattern: "SENDGRID"` in `.env.example` and config.
- **Analytics / monitoring tools**: `Grep pattern: "sentry|datadog|logflare|axiom"` in `package.json` + `backend/src/**` to catch any paid observability.

Legitimately external TBDs get a clear slot + path:

```
TBD (external: actual Cloud SQL $ / month — GCP billing console, project ownmyhealth-prod)
```

Never invent a dollar figure.

---

## Cross-links

The generated `FINANCIAL_TRACKER.md` must link to:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — which services are in the stack.
- [`ENV_VARS.md`](./ENV_VARS.md) — paid-service keys.
- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — per-endpoint rate limits.
- [`STRATEGY.md`](./STRATEGY.md) — pricing + break-even narrative.
- [`RUNBOOK.md`](./RUNBOOK.md) — how to inspect billing and alerts.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Paid SDKs | Grep | `pattern: "@anthropic-ai|@sendgrid|@google-cloud"` in `package.json` (both) |
| Model name | Grep | `pattern: "claude-[a-z0-9-]+"` over `backend/src/**` |
| Instance sizing | Read | `backend/railway.toml`, `.github/workflows/deploy.yml` |
| Rate limiters | Read | `backend/src/middleware/rateLimiter.ts` |
| Monitoring SDKs | Grep | `pattern: "sentry|datadog|logflare|axiom"` over all |

---

## Questions to ask the user (last resort)

1. Personal savings, IRA reserve, savings goal, full-time timing.
2. Actual billing-console numbers for fixed services (Cloud Run, Cloud SQL, Cloud Logging, etc.).
3. Current + planned pricing tiers.
4. Grants, investors, legal entity.

---

## Output: file and location

Write the final document to `New Project Documents/FINANCIAL_TRACKER.md`.
