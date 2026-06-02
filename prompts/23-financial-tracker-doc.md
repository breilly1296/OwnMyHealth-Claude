---
tags:
  - documentation
  - financial
  - business
type: prompt
priority: 3
updated: 2026-06-01
---

# Generate FINANCIAL_TRACKER.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc must pass the five tests in `_doc-quality.md` before you stop.

Note: Financials have the highest density of legitimately external facts (personal savings, actual billing-console numbers, runway). The No-TBD rule still applies — derive the code-adjacent skeleton (which paid services the app uses, rate-limit-inferred quotas, the **in-code AI dollar budgets** in `backend/src/config/index.ts` `ai` block + `aiCostTracker.ts`, the **in-code pricing tiers** in `backend/src/config/plans.ts`, instance sizing from the deploy workflows) first, then mark the rest with clear external resolution paths.

Note (instance sizing moved): the prompt previously pointed at `backend/railway.toml` for CPU/memory/max-instances. As of HEAD that file holds only build/deploy/healthcheck settings — no sizing. Cloud Run sizing now lives in `.github/workflows/deploy.yml` and `deploy-staging.yml` (`--max-instances=3`; no explicit `--cpu`/`--memory`, so the Cloud Run defaults of 1 vCPU / 512 MiB apply unless overridden). Read those workflows, not `railway.toml`, for sizing.

---

## Purpose

Produce `New Project Documents/FINANCIAL_TRACKER.md` — the **unit-economics + runway reference**. What does this app cost to run per user? Which services are metered? What's the break-even model? Most dollar values live in the billing console, not code — but the *structure* of costs lives in the repo, and this doc extracts that structure.

---

## Files to review

| File | Why read it |
|---|---|
| `package.json` (root + `backend/`) | List paid third-party SDKs: `@anthropic-ai/sdk`, `@sendgrid/mail`, `@google-cloud/storage`, `@google-cloud/documentai`. Also note `ioredis` + `rate-limit-redis` — Redis (Cloud Memorystore) is a candidate fixed cost when `REDIS_URL` is set. Check for analytics/monitoring (none currently). |
| `.github/workflows/deploy.yml`, `deploy-staging.yml` | Cloud Run deploy parameters — the only place instance sizing lives (`--max-instances=3`; no `--cpu`/`--memory` flags, so defaults apply). |
| `backend/railway.toml` | Build/deploy/healthcheck only — does NOT carry CPU/memory/max-instances anymore. Do not cite it for sizing. |
| `backend/src/middleware/rateLimiter.ts` | Eight rate limiters act as request-count cost ceilings — each limiter bounds a cost. Backed by `rateLimitStore.ts` (in-memory by default, shared Redis when `REDIS_URL` set). |
| `backend/src/services/aiCostTracker.ts` | **Hardcoded per-token pricing per model** (`PRICING`, ~L16-19) and the rolling daily spend accumulator — the per-call cost math lives here, not in the call sites. |
| `backend/src/middleware/aiSpendGuard.ts` + `backend/src/config/index.ts` (`ai` block, ~L195-198) | **Dollar-based circuit breaker**: `AI_DAILY_BUDGET_USD` (global, default $50/day) and `AI_USER_DAILY_BUDGET_USD` (per-user, default $5/day). This is the true cost ceiling, tighter than the rate limiters. |
| `backend/src/config/plans.ts` | **In-code pricing tiers** (FREE $0, PRO $9.99/mo · $99/yr, TEAM $19.99/mo · $199/yr) and per-tier usage limits (AI chats/day, PDF uploads/month, etc.). Prices are display-only — no billing processor wired yet. Real input for the break-even table. |
| `backend/src/services/usageTracker.ts` + `backend/src/middleware/planGating.ts` | Per-user usage counters enforced against `plans.ts` limits — maps tier → consumable resource caps that drive per-tier variable cost. |
| `backend/src/services/claudeExtraction.ts`, `sbcExtraction.ts`, `controllers/expenseController.ts`, `controllers/aiChatController.ts` | Anthropic model name(s) + input/output size → unit cost per call. NOTE: two models in use — `claude-haiku-4-5-20251001` (biomarker guidance, doc extraction, AI chat) and `claude-sonnet-4-5-20250929` (SBC extraction, expense cost analysis). |
| `backend/src/services/ocrService.ts` | Google Document AI processor — units metered per page (also has a `claude-api` extraction path, ~L252). |
| `backend/src/services/storageService.ts` | GCS read/write/storage metered unit. |
| `backend/src/services/emailService.ts` | SendGrid tier. |
| `backend/src/services/fhir/*` | Quest SMART-on-FHIR lab sync — external API calls (no in-repo dollar cost, but a future metered integration to flag). |
| `backend/prisma/schema.prisma` | DB size footprint drivers (18 models). |

---

## Required sections

1. **Cost structure** — derived from code. Every service the app pays for, metered unit, code entry point, governing rate limit.
2. **Fixed costs** — Cloud Run idle (sizing from the deploy workflows, not `railway.toml`), Cloud SQL, Redis/Memorystore (when `REDIS_URL` set), domain, monitoring subscriptions.
3. **Variable costs (per call)** — Anthropic call (per-token cost per model, from `aiCostTracker.ts`), Document AI page, SendGrid email, GCS operation.
4. **AI dollar-budget circuit breaker** — the `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` hard caps (defaults $50/day global, $5/day per user) enforced by `aiSpendGuard` + `aiCostTracker`. This is the tightest cost ceiling and bounds worst-case Anthropic spend in dollars, not just request counts. Note the in-memory/per-instance caveat (effective ceiling is N×budget under autoscale; bounded by `--max-instances=3`).
5. **Per-user cost model** — assume N calls/user/month (mark assumptions), multiply out. Provide formula, not a guess.
6. **Break-even table** — use the in-code pricing tiers (`plans.ts`: PRO $9.99/mo, TEAM $19.99/mo) — how many users until revenue ≥ cost? Flag that no billing processor is wired yet (prices are display-only).
7. **Rate-limit cost ceilings** — for each AI / email / upload endpoint, the per-user monthly max cost if they hit the limit every window. Cross-reference against the dollar budget cap from section 4.
8. **Per-tier variable cost** — for each plan tier, the consumable caps from `plans.ts` (AI chats/day, PDF uploads/month, cost analyses/month) → max metered spend that tier can drive.
9. **Current position** (mark external) — personal savings, runway, revenue.
10. **Business accounts** (mark external) — credit cards, bank.
11. **Pricing tiers** — derive structure + display prices from `backend/src/config/plans.ts` and `planGating.ts`; mark only the *go-to-market* pricing decision as external.
12. **Tax / structure** (mark external).
13. **Related Documents**.
14. **Prompt drift log**.

---

## Required artifacts

### Cost structure (derived from code)

| Service | Metered unit | Code entry point | Governing rate limit / cap | Per-unit cost (ref) |
|---|---|---|---|---|
| Anthropic Claude API (Haiku) | input + output tokens | `backend/src/services/claudeExtraction.ts:Lxx`, `controllers/aiChatController.ts:Lxx`, `routes/biomarkerRoutes.ts:Lxx` (model = `claude-haiku-4-5-20251001`) | `aiLimiter` (10/hr/user) + `aiSpendGuard` dollar cap | `aiCostTracker.ts` `PRICING` ($0.80/$4.00 per 1M in/out) |
| Anthropic Claude API (Sonnet) | input + output tokens | `backend/src/services/sbcExtraction.ts:Lxx`, `controllers/expenseController.ts:Lxx` (model = `claude-sonnet-4-5-20250929`) | `aiLimiter` + `aiSpendGuard` dollar cap | `aiCostTracker.ts` `PRICING` ($3.00/$15.00 per 1M in/out) |
| Google Document AI | pages processed | `backend/src/services/ocrService.ts:Lxx` | `uploadLimiter` (20/hr) | GCP pricing page |
| Google Cloud Storage | GB-months stored + ops | `backend/src/services/storageService.ts:Lxx` | `uploadLimiter` | GCP pricing page |
| SendGrid | emails sent | `backend/src/services/emailService.ts:Lxx` | n/a | SendGrid tier |
| Cloud Run | vCPU-seconds + requests | `.github/workflows/deploy.yml:Lxx` (`--max-instances=3`; defaults 1 vCPU / 512 MiB) | global + per-route | GCP pricing |
| Cloud SQL | instance-hour + storage | — (config in GCP console) | n/a | GCP pricing |
| Redis / Cloud Memorystore | instance-hour (if `REDIS_URL` set) | `backend/src/middleware/rateLimitStore.ts:Lxx` (deps: `ioredis`, `rate-limit-redis`) | n/a | GCP pricing (only billed when enabled) |

### Per-user cost formula

```
cost_per_user_per_month =
    fixed_infra / active_users
  + min( Anthropic_calls_per_user * avg_cost_per_call,
         AI_USER_DAILY_BUDGET_USD * 30 )   # dollar cap hard-bounds this term
  + Document_AI_pages_per_user * cost_per_page
  + emails_per_user * cost_per_email
  + GCS_storage_per_user * cost_per_GB_month
```

Use the actual per-token prices from `aiCostTracker.ts` `PRICING` (Haiku $0.80 in / $4.00 out, Sonnet $3.00 in / $15.00 out per 1M tokens) to compute `avg_cost_per_call` per endpoint, weighted by which model each endpoint uses.

State each assumption explicitly (e.g., "assume 20 AI biomarker guidance calls/user/month; bounded by `aiLimiter` at 10/hour AND by the per-user `AI_USER_DAILY_BUDGET_USD` dollar cap").

### Rate-limit cost ceilings

Note: the request-count ceilings below are the *loose* bound. The binding ceiling for AI spend is the dollar circuit breaker — `AI_USER_DAILY_BUDGET_USD` (default $5/day → ~$150/user/month) and `AI_DAILY_BUDGET_USD` (default $50/day global). Whichever is smaller wins; cite both.

| Endpoint family | Limit | Max calls/user/month | Max cost/user/month |
|---|---|---|---|
| AI guidance / chat / extraction (`aiLimiter` routes) | `aiLimiter` 10/hour/user | ~7,200 (10·720), but capped first by `$5/day` budget | min(count·per-call, **$150/mo budget cap**) |
| Upload (`/upload/*`) | `uploadLimiter` 20/hour | ~14,400 | $… (Document AI page price · pages) |
| Sensitive ops (export/delete) | `sensitiveLimiter` 10/hour | ~7,200 | $… |
| Provider access requests | `providerAccessRequestLimiter` 10/hour/user | ~7,200 | negligible (no metered service) |

### Break-even table

Use the in-code display prices from `plans.ts` (PRO $9.99/mo, TEAM $19.99/mo) as the revenue inputs; mark the *adoption mix* (what % of users convert to each tier) as the external assumption.

| Users | Revenue (at PRO $9.99 / TEAM $19.99, assumed mix) | Costs (formula above) | Net |
|---|---|---|---|
| 100 | derived from `plans.ts` prices × assumed mix | derived | derived |
| 500 | derived | derived | derived |
| 1000 | derived | derived | derived |

Caveat (mark in doc): no payment processor is wired (`plans.ts` header — plans assigned manually via admin/DB; Stripe webhook is a TODO). Revenue is potential, not realized.

### Fixed-cost summary

| Line item | Amount | Source |
|---|---|---|
| Cloud Run baseline | TBD (external: GCP billing) | `.github/workflows/deploy.yml` shows `--max-instances=3` (no `--cpu`/`--memory` → defaults); billing console shows actual $ |
| Cloud SQL | TBD (external: GCP billing) | instance class lives in GCP Console |
| Redis / Cloud Memorystore | TBD (external: GCP billing, only if `REDIS_URL` set) | `rateLimitStore.ts` + `ioredis` dep; instance class in GCP Console |
| Domain | TBD (external) | — |
| Monitoring / security tool subscriptions | TBD (external) | — (no observability SDK in `package.json` — confirm none added) |

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
3. What caps the worst-case Anthropic cost per user — the rate limiter or the dollar budget? (Answer: the per-user `AI_USER_DAILY_BUDGET_USD` dollar cap binds before the 10/hr `aiLimiter`.)
4. Which Anthropic models are used in production, per code, and which endpoints use Haiku vs Sonnet?
5. Which file hosts the Document AI integration?
6. What's the fixed vs variable cost split, conceptually?
7. What user count triggers break-even at the PRO ($9.99/mo) / TEAM ($19.99/mo) tiers from `plans.ts`?
8. What's the on-paper max cost per user if they exploited the rate limits continuously, AND what's the dollar-budget-capped max?
9. Which fixed costs can be derived from repo vs require the GCP console? (Note instance sizing is in the deploy workflows, not `railway.toml`.)
10. Which service has no in-repo rate limit and therefore no cost ceiling in code?
11. Is any revenue realized yet, or are the `plans.ts` prices display-only with no payment processor wired?

---

## No-TBD enforcement

Before marking anything TBD:

- **Paid services**: `Grep pattern: "@anthropic-ai|@sendgrid|@google-cloud|ioredis|rate-limit-redis"` over `package.json` files.
- **Model name(s) for Anthropic**: `Grep pattern: "claude-[a-z0-9-]+"` over `backend/src/**` — confirm BOTH `claude-haiku-4-5-20251001` and `claude-sonnet-4-5-20250929` and which endpoints use each. Per-token prices are in `aiCostTracker.ts` `PRICING`, not external.
- **AI dollar budget**: read `backend/src/config/index.ts` (`ai` block) for `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` defaults; `aiSpendGuard.ts` + `aiCostTracker.ts` for enforcement.
- **Pricing tiers**: read `backend/src/config/plans.ts` for tier prices and limits (in code, not external).
- **Instance sizing**: read `.github/workflows/deploy.yml` and `deploy-staging.yml` for `--max-instances` (and any `--cpu`/`--memory`). NOT `railway.toml` — it no longer carries sizing.
- **Rate limits**: read `backend/src/middleware/rateLimiter.ts` (8 limiters) and `rateLimitStore.ts` (Redis vs in-memory); note the window/max per limiter.
- **Email tier**: `Grep pattern: "SENDGRID"` in config (`backend/src/config/index.ts`).
- **Analytics / monitoring tools**: `Grep pattern: "sentry|datadog|logflare|axiom"` in `package.json` + `backend/src/**` to catch any paid observability (currently none).

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
| Paid SDKs | Grep | `pattern: "@anthropic-ai|@sendgrid|@google-cloud|ioredis|rate-limit-redis"` in `package.json` (both) |
| Model names | Grep | `pattern: "claude-[a-z0-9-]+"` over `backend/src/**` (expect two distinct models) |
| Per-token pricing | Read | `backend/src/services/aiCostTracker.ts` (`PRICING` constant) |
| AI dollar budget | Read | `backend/src/config/index.ts` (`ai` block), `backend/src/middleware/aiSpendGuard.ts` |
| Pricing tiers | Read | `backend/src/config/plans.ts` |
| Instance sizing | Read | `.github/workflows/deploy.yml`, `deploy-staging.yml` (NOT `railway.toml`) |
| Rate limiters | Read | `backend/src/middleware/rateLimiter.ts`, `rateLimitStore.ts` |
| Monitoring SDKs | Grep | `pattern: "sentry|datadog|logflare|axiom"` over all |

---

## Questions to ask the user (last resort)

1. Personal savings, IRA reserve, savings goal, full-time timing.
2. Actual billing-console numbers for fixed services (Cloud Run, Cloud SQL, Memorystore if enabled, Cloud Logging, etc.).
3. Go-to-market pricing decision and expected tier-adoption mix (the tier *structure and display prices* are already in `plans.ts` — ask only what code can't tell you: is billing live, which processor, conversion assumptions).
4. Grants, investors, legal entity.

---

## Output: file and location

Write the final document to `New Project Documents/FINANCIAL_TRACKER.md`.
