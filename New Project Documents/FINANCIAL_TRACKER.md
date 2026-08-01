# FINANCIAL_TRACKER.md

> **Unit-economics + runway reference for OwnMyHealth.**
> What does this app cost to run per user? Which services are metered? Where is the dollar ceiling? Most actual dollar values live in the GCP / SaaS billing consoles — but the *structure* of costs lives in the repo, and this doc extracts that structure with file:line evidence.
>
> **Code state:** `master` @ `12b45ae` · **Refreshed:** 2026-08-01 (previous: `fb2cd32`, 2026-06-15)
> **Posture:** sandbox — no GCP (billing disabled ~2026-07-12; no deployment target, founder/test data only), declared 2026-07-14. See [`OPEN_FINDINGS.md` §Posture](./OPEN_FINDINGS.md).
>
> **Two facts that materially change the cost picture since the last generation:**
> 1. **GCP spend is ~zero.** Billing was disabled ~2026-07-12. Cloud Run, Cloud SQL, GCS, and Document
>    AI costs stopped. Any run-rate figure below that includes GCP is now a *launch* projection.
> 2. **There is still no revenue path.** `PLANS[*].price` / `annualPrice` are display-only and tie to
>    no charge (`config/plans.ts`); no Stripe SDK, checkout, or webhook exists in the repo (verified by
>    grep, 2026-08-01 — only comments and TODOs). `users.plan` has exactly one application writer:
>    `PATCH /api/v1/admin/users/:id/plan` (`adminRoutes.ts:598`). Tracked as **OF-15** / scrutiny P0-5.
>    Treat every price in this document as a hypothesis, not a rate. All code claims cite `file:line`. Facts that genuinely live outside the repo are marked `TBD (external: …, <resolution path>)` — never invented.

---

## How to read this doc

- **In-code facts** (model names, per-token pricing, plan prices, rate-limit windows, dollar budgets, instance count) are derived from source and cited. They are *not* TBD.
- **Billing-console facts** (actual Cloud Run / Cloud SQL / Memorystore $/month, personal savings, realized revenue) are external and marked TBD with a resolution path.
- The repo prices things in **two layers**: a *display* pricing layer (`plans.ts`, no billing processor) and an *enforcement* cost-ceiling layer (rate limiters + the AI dollar circuit breaker). They are independent; the dollar ceiling is the one that actually protects the bill.

---

## 1. Cost structure (derived from code)

Every third-party service the app pays for, its metered unit, the code entry point, and what bounds its cost. The critical column is the last one: **only Claude token spend is bounded in dollars**; Document AI, GCS, and SendGrid are bounded only by request *counts*.

| Service | Metered unit | Code entry point | Governing rate limit / cap | Per-unit cost (ref) |
|---|---|---|---|---|
| Anthropic Claude API (Haiku) | input + output tokens | `aiChatController.ts:49` (`MODEL`), `claudeExtraction.ts:147,151`, `biomarkerRoutes.ts:246,288` — model `claude-haiku-4-5-20251001` | `aiLimiter` 10/hr/user + **`aiSpendGuard` dollar cap** | `aiCostTracker.ts:34` — $0.80/1M in, $4.00/1M out |
| Anthropic Claude API (Sonnet) | input + output tokens | `sbcExtraction.ts:805,809`, `expenseController.ts:753` — model `claude-sonnet-4-5-20250929` | `aiLimiter` + **`aiSpendGuard` dollar cap** | `aiCostTracker.ts:35` — $3.00/1M in, $15.00/1M out |
| Google Document AI | pages processed (image OCR) | `ocrService.ts:300` (`client.processDocument`), exported `processDocument` `ocrService.ts:375` | `uploadLimiter` 20/hr + `pdfUploadsPerMonth` plan quota — **NOT** the AI dollar cap (no `trackAIUsage` on this path) | TBD (external: GCP Document AI pricing page, ~$1.50/1k pages list) |
| Google Cloud Storage | GB-months stored + ops | `storageService.ts:51` (`uploadFile`), `:119` (`deleteFile`), `:162` (`deleteFiles`) | `uploadLimiter` 20/hr (writes); reads ungated | TBD (external: GCP GCS pricing page) |
| SendGrid | emails sent | `emailService.ts:59-61` (lazy `@sendgrid/mail` import + `sgMail.send`) | none (no email-specific rate limiter) | TBD (external: SendGrid plan tier) |
| Cloud Run | vCPU-seconds + requests | `.github/workflows/deploy.yml:189` (`--max-instances=3`; no `--cpu`/`--memory` → Cloud Run defaults 1 vCPU / 512 MiB) | `--max-instances=3` ceiling | TBD (external: GCP Cloud Run pricing) |
| Cloud SQL | instance-hour + storage | `database.ts:58` (`DATABASE_URL`); instance class in GCP Console | none in code | TBD (external: GCP Cloud SQL, project `ownmyhealth-prod`) |
| Redis / Cloud Memorystore | instance-hour (only when `REDIS_URL` set) | `rateLimitStore.ts` (deps `ioredis`, `rate-limit-redis` — `backend/package.json:37,44`); `config/index.ts:186` (`REDIS_URL` default `''`) | none in code | TBD (external: GCP Memorystore; billed only when enabled) |

**Paid-SDK evidence** (`backend/package.json:22-46`):

```json
// Source: backend/package.json:L23-L28
"@anthropic-ai/sdk": "^0.91.1",
"@google-cloud/documentai": "^9.5.0",
"@google-cloud/storage": "^7.19.0",
"@prisma/adapter-pg": "^7.8.0",
"@prisma/client": "^7.7.0",
"@sendgrid/mail": "^8.1.4",
```

```json
// Source: backend/package.json:L37,L44 — Redis becomes a fixed cost when REDIS_URL is set
"ioredis": "^5.11.0",
"rate-limit-redis": "^4.3.1",
```

**No observability SDK is present** — `Grep` for `sentry|datadog|logflare|axiom|newrelic|@opentelemetry` over all `package.json` returns **no matches**. There is no paid monitoring subscription driven from the repo (logging is Cloud Logging via stdout, billed under GCP).

### Cost-ceiling map (which layer protects which service)

```
                         ┌─────────────────────────────────────────────┐
  Claude (Haiku/Sonnet)  │ aiLimiter (10/hr count)  →  aiSpendGuard ($) │  ← dollar-bounded
                         └─────────────────────────────────────────────┘
                         ┌─────────────────────────────────────────────┐
  Google Document AI     │ uploadLimiter (20/hr count) + pdfUploads/mo  │  ← COUNT-only, NO $ cap
                         └─────────────────────────────────────────────┘
                         ┌─────────────────────────────────────────────┐
  GCS writes             │ uploadLimiter (20/hr count)                  │  ← COUNT-only
                         └─────────────────────────────────────────────┘
                         ┌─────────────────────────────────────────────┐
  SendGrid email         │ (no rate limiter at all)                     │  ← UNBOUNDED in code
                         └─────────────────────────────────────────────┘
```

> **Finance-critical caveat:** A doc that says "the $50/day cap bounds worst-case AI spend" would be *wrong*. The cap bounds only Claude token spend. Google Document AI — also an "AI" line item — is invoked at `ocrService.ts:300` with **no `trackAIUsage` call**, so its dollars never accrue against `AI_DAILY_BUDGET_USD`. See [§4](#4-ai-dollar-budget-circuit-breaker).

---

## 2. Fixed costs

Recurring infrastructure independent of per-call usage. The *count* of instances and presence/absence of services is derivable from the repo; the dollar figures live in the GCP billing console.

| Line item | Amount | Source (repo) | Resolution path (external) |
|---|---|---|---|
| Cloud Run baseline | TBD (external) | `deploy.yml:189` — `--max-instances=3`, no `--cpu`/`--memory` → defaults 1 vCPU / 512 MiB; min-instances not set → scales to 0 when idle | GCP billing, project `ownmyhealth-prod`, service `ownmyhealth-backend` |
| Cloud Run migrate job | TBD (external, negligible) | `deploy.yml:139-150` — `ownmyhealth-migrate` job, `--memory 512Mi`, `--task-timeout 10m`, runs once per deploy | GCP billing (per-execution, minutes/month) |
| Cloud SQL (PostgreSQL) | TBD (external) | `database.ts:58` reads `DATABASE_URL`; instance `ownmyhealth-prod:us-central1:ownmyhealth-db` (`deploy.yml:46`) | GCP billing — instance class set in Console, not repo |
| Redis / Cloud Memorystore | TBD (external, $0 unless enabled) | `config/index.ts:186` (`REDIS_URL` default `''`); deps `ioredis`/`rate-limit-redis` | GCP billing — only billed if `REDIS_URL` is set (currently optional) |
| GCS bucket (frontend + user files) | TBD (external) | `config/index.ts:228` (`ownmyhealth-user-files`); `deploy.yml:42` (`ownmyhealth-frontend`) | GCP billing — storage + egress |
| Domain (`ownmyhealth.io`) | TBD (external) | referenced `deploy.yml:279` (`api.ownmyhealth.io`), `config/index.ts:271` | Registrar invoice |
| Monitoring / security subscriptions | $0 in code | no observability SDK in any `package.json` (Grep confirmed) | n/a — if one is added later, add it here |

> Cloud Run scales to **zero** when idle (no `--min-instances` flag in `deploy.yml`), so the "fixed" Cloud Run cost is closer to per-request than a flat reservation. The only hard floor is Cloud SQL (always-on instance) and the GCS storage at rest.

---

## 3. Variable costs (per call)

### 3a. Anthropic Claude (the only dollar-tracked variable cost)

Per-token prices are **in code**, not external (`aiCostTracker.ts:33-36`):

```ts
// Source: backend/src/services/aiCostTracker.ts:L33-L36
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  'claude-sonnet-4-5-20250929': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
};
```

Cost is computed per call and accrued into the rolling daily accumulator (`aiCostTracker.ts:302-313`):

```ts
// Source: backend/src/services/aiCostTracker.ts:L302-L307
export function trackAIUsage(record: AIUsageInput): void {
  const pricing = PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929'];
  const estimatedCostUsd = (record.inputTokens * pricing.input) + (record.outputTokens * pricing.output);
  void getStore()
    .record(record.userId, estimatedCostUsd)
```

| Model | $/1M input | $/1M output | Used by (endpoints) |
|---|---|---|---|
| `claude-haiku-4-5-20251001` | $0.80 | $4.00 | AI chat (`aiChatController.ts:49`), biomarker guidance (`biomarkerRoutes.ts:246,288`), lab-PDF biomarker extraction (`claudeExtraction.ts:147,151`) |
| `claude-sonnet-4-5-20250929` | $3.00 | $15.00 | SBC insurance extraction (`sbcExtraction.ts:805,809`), expense cost analysis (`expenseController.ts:753`) |

**Worked example — one Haiku biomarker-guidance call** (assume 2,000 input + 800 output tokens):
`(2000 × 0.80/1M) + (800 × 4.00/1M) = $0.0016 + $0.0032 = $0.0048` ≈ **$0.005/call**.

**Worked example — one Sonnet SBC extraction** (assume 8,000 input + 2,000 output tokens):
`(8000 × 3.00/1M) + (2000 × 15.00/1M) = $0.024 + $0.030 = $0.054` ≈ **$0.054/call**.

> Token counts above are illustrative assumptions (marked); the *prices* are in-code facts. Real average tokens per call: TBD (external: inspect `AICost` log entries `aiCostTracker.ts:315-322`, which log `inputTokens`/`outputTokens`/`estimatedCostUsd` per call to Cloud Logging).

### 3b. Google Document AI page (NOT dollar-tracked)

```ts
// Source: backend/src/services/ocrService.ts:L300 — the paid call, no trackAIUsage anywhere on this path
const [result] = await client.processDocument(request, { timeout: 60_000 });
```

- **Metered**: per page processed (image OCR). Cost: TBD (external: GCP Document AI pricing page).
- **Bounded only by counts**: `uploadLimiter` (20/hr, `rateLimiter.ts:134`) + the `pdfUploadsPerMonth` plan quota (`uploadRoutes.ts:137`). It is **never** bounded by the dollar circuit breaker — `processDocument` records no usage, so Document AI dollars do not accrue against `AI_DAILY_BUDGET_USD`. This is the single biggest gap in dollar-level cost protection.

### 3c. SendGrid email

```ts
// Source: backend/src/services/emailService.ts:L59-L61
const sendgrid = await import('@sendgrid/mail');
sgMail = sendgrid.default;
sgMail.setApiKey(config.email.sendgridApiKey);
```

- **Metered**: per email sent. Enabled only when `SENDGRID_API_KEY` is set (`config/index.ts:209`). Staging forces sandbox mode (no real delivery, `config/index.ts:218`).
- **No rate limiter** is applied to email-sending paths in code — email cost is bounded only by the SendGrid plan's monthly allotment and by which app flows send mail (verification, password reset, weekly summary, plan-expiring). Cost: TBD (external: SendGrid plan tier).

### 3d. GCS operation

- **Metered**: storage GB-months + class-A/B operations. Entry points `storageService.ts:51` (`uploadFile`), `:119` (`deleteFile`), `:162` (`deleteFiles`). Writes gated by `uploadLimiter`; cost: TBD (external: GCP GCS pricing).

---

## 4. AI dollar-budget circuit breaker

The tightest cost ceiling in the system — and the only one denominated in **dollars**. It bounds worst-case **Claude** spend (token cost), not request counts. Defaults: **$50/day global, $5/day per user** (`config/index.ts:255-258`):

```ts
// Source: backend/src/config/index.ts:L255-L258
ai: {
  dailyBudgetUsd: parseBudget(process.env.AI_DAILY_BUDGET_USD, 50, 'AI_DAILY_BUDGET_USD'),
  userDailyBudgetUsd: parseBudget(process.env.AI_USER_DAILY_BUDGET_USD, 5, 'AI_USER_DAILY_BUDGET_USD'),
},
```

### How it gates a request

`aiSpendGuard` calls `admitAISpend()` *before* the Claude call (reserve + check) and registers `settle()` on response completion; `trackAIUsage()` records the real cost *after*. It **fails closed with 503** both when a budget is reached and when the shared store errors (`aiSpendGuard.ts:38-52`):

```ts
// Source: backend/src/middleware/aiSpendGuard.ts:L36-L52 (fail-closed on store error)
try {
  admission = await admitAISpend(userId);
} catch (err) {
  logger.error('AI spend gate errored — failing closed (503)', { ... });
  next(new ServiceUnavailableError('AI features are temporarily unavailable. Please try again later.'));
  return;
}
```

The admit path uses a fixed **$0.05 per-request reservation** so concurrent requests can't all read "under budget" before any records a cost (`aiCostTracker.ts:67`). `admitAISpend()` / `settle()` replace the deleted single-accumulator `isAISpendExceeded`.

```mermaid
sequenceDiagram
  participant C as Client
  participant G as aiSpendGuard
  participant T as aiCostTracker (store)
  participant A as Claude API
  C->>G: POST /ai/chat (after authenticate)
  G->>T: admitAISpend(userId)  (reserve $0.05, check global then user cap)
  alt budget reached OR store error
    T-->>G: { admitted:false } / throws
    G-->>C: 503 SERVICE_UNAVAILABLE (fail closed)
  else admitted
    T-->>G: { admitted:true, settle }
    G->>A: proceed → Claude call
    A-->>G: tokens used
    G->>T: settle() on res 'finish'/'close'; trackAIUsage() records real $
    G-->>C: 200
  end
```

### Mount points — 8 across 5 route files

`aiSpendGuard` guards every Claude entry point (Grep over `backend/src/routes`):

| Route | Mount | Rate limiter alongside |
|---|---|---|
| `POST /ai/chat` | `aiRoutes.ts:32` | `aiLimiter` (`aiRoutes.ts:31`) |
| `POST /expenses/analyze` | `expenseRoutes.ts:114` | `aiLimiter` (`expenseRoutes.ts:113`) |
| `POST /biomarkers/:id/guidance` | `biomarkerRoutes.ts:136` | `aiLimiter` (`biomarkerRoutes.ts:135`) |
| `PUT /insurance/plans/:id/reanalyze` | `insuranceRoutes.ts:125` | `aiLimiter` + `uploadLimiter` (`insuranceRoutes.ts:123-124`) |
| `POST /insurance/upload-sbc` | `insuranceRoutes.ts:138` | `aiLimiter` + `uploadLimiter` (`insuranceRoutes.ts:136-137`) |
| `POST /upload/lab-report` | `uploadRoutes.ts:82` | `aiLimiter` (`uploadRoutes.ts:81`) |
| `POST /upload/insurance-sbc` | `uploadRoutes.ts:104` | `aiLimiter` (`uploadRoutes.ts:103`) |
| `POST /upload/lab-results-ocr` | `uploadRoutes.ts:135` | `aiLimiter` (`uploadRoutes.ts:134`) |

> Note: `lab-results-ocr` is dollar-guarded for its **Claude** path (PDF → `processPDFWithClaude` → `claudeExtraction`), but its **Document AI image** path (`ocrService.ts:300`) still emits no tracked spend — the guard reserves/settles $0.05 but Document AI's real dollars never accrue. The guard protects the Claude branch, not the Document AI branch.

### In-memory vs shared-Redis precision

The accumulator is **pluggable** (`aiCostTracker.ts:9-21`):

- **Default (in-memory, per-process)** — under Cloud Run autoscale the *effective* global ceiling is `N × $50` where N = running instances, **bounded by `--max-instances=3`** (`deploy.yml:189`). So worst-case global Claude spend with the default store ≈ **$150/day** (3 × $50), and per-user ≈ **$15/day** (3 × $5) if a user's requests fan out across all instances.
- **Shared (`RedisSpendStore`, when `REDIS_URL` set)** — atomic `INCRBYFLOAT`-then-compare per key makes the cap **exact across instances** ($50/day global, $5/day per user) and removes the N×budget caveat (`aiCostTracker.ts:189-216`).

> **Worst-case Claude spend bound (default store):** ≤ `3 × $50 = $150/day` global. **(Redis store):** ≤ `$50/day` global. Document AI is excluded from both.

---

## 5. Per-user cost model

```
cost_per_user_per_month =
    fixed_infra / active_users
  + min( claude_calls_per_user × avg_cost_per_call,
         AI_USER_DAILY_BUDGET_USD × 30 )          # = min(…, $5 × 30 = $150)  ← dollar cap hard-bounds this term
  + document_ai_pages_per_user × cost_per_page      # NOT dollar-capped — bounded by pdfUploadsPerMonth quota
  + emails_per_user × cost_per_email
  + gcs_storage_per_user × cost_per_GB_month
```

`avg_cost_per_call` is weighted by which model each endpoint uses (Haiku ≈ $0.005/call, Sonnet ≈ $0.054/call from §3a worked examples — token counts assumed, prices in-code).

**Stated assumptions** (mark and tune):
- *Claude*: assume a PRO user runs ~20 Haiku guidance/chat calls + ~3 Sonnet analyses per month. `20 × $0.005 + 3 × $0.054 = $0.10 + $0.162 = $0.262/user/month` of Claude spend. Bounded above by `aiLimiter` (10/hr) **and** the per-user dollar cap (`$5/day → $150/mo`); the dollar cap is the binding ceiling (see §3 & §7).
- *Document AI*: assume FREE user uploads ≤ 2 PDFs/mo (`pdfUploadsPerMonth = 2`, `plans.ts:49`), PRO ≤ 20 (`plans.ts:72`). Pages/upload and $/page: TBD (external: GCP).
- *Fixed infra ÷ active users*: dominated by Cloud SQL (always-on); per-user share shrinks as users grow. Dollar inputs: TBD (external: GCP billing).

> The formula is the deliverable, not a single number — fill the external $ slots from billing and multiply.

---

## 6. Break-even table

Revenue inputs are the **in-code display prices** (`plans.ts:68-69` PRO $9.99/mo · $99/yr; `plans.ts:87-88` TEAM $19.99/mo · $199/yr — stored as cents). The **adoption mix** (% of users on each tier) is the external assumption.

```ts
// Source: backend/src/config/plans.ts:L68-L69 (PRO) and L87-L88 (TEAM) — price in cents
PRO:  { ... price: 999,  annualPrice: 9900,  ... }
TEAM: { ... price: 1999, annualPrice: 19900, ... }
```

**Assumed mix (mark as external):** 80% FREE, 15% PRO ($9.99), 5% TEAM ($19.99). Average monthly revenue per user (ARPU) = `0.15 × $9.99 + 0.05 × $19.99 = $1.4985 + $0.9995 = $2.498/user/mo`.

| Users | Monthly revenue (assumed mix) | Costs | Net |
|---|---|---|---|
| 100 | `100 × $2.498 = $249.80` | TBD (external: fixed_infra + variable from §5) | derived once cost filled |
| 500 | `500 × $2.498 = $1,249.00` | TBD (external) | derived |
| 1000 | `1000 × $2.498 = $2,498.00` | TBD (external) | derived |

> **Break-even** = the user count where `users × ARPU ≥ fixed_infra + (users × per-user_variable)`. Solve once the GCP fixed-infra and per-page/per-email actuals are filled. The repo gives every term except the billing-console dollars.

> **Realization caveat (in-code):** no payment processor is wired. `plans.ts:4-6` — *"No payment processing yet — plans are assigned manually via the admin panel or a direct DB update. When Stripe is added, its webhook handler will update the same `users.plan` column."* **Revenue above is potential, not realized.**

---

## 7. Rate-limit cost ceilings

The request-count ceilings are the *loose* bound. For AI spend the **binding** ceiling is the dollar circuit breaker (§4): per-user `$5/day → ~$150/mo`, global `$50/day`. Whichever is smaller wins.

All windows from `rateLimiter.ts`:

| Endpoint family | Limit | Source | Max calls/user/month (count bound) | Max cost/user/month (binding) |
|---|---|---|---|---|
| AI guidance / chat / extraction | `aiLimiter` 10/hr/user | `rateLimiter.ts:177-179` | ~7,200 (10 × 720 hr) | **min(count × per-call, $150/mo dollar cap)** → $150 cap binds first |
| Upload (Document AI / GCS) | `uploadLimiter` 20/hr | `rateLimiter.ts:134-137` | ~14,400 | `pages × $/page` (Document AI) — **NO dollar cap**; also bounded by `pdfUploadsPerMonth` plan quota |
| Sensitive ops (export/delete) | `sensitiveLimiter` 10/hr | `rateLimiter.ts:151-153` | ~7,200 | negligible (no metered third-party service; DB + GCS delete only) |
| Provider access requests | `providerAccessRequestLimiter` 10/hr/user | `rateLimiter.ts:211-214` | ~7,200 | negligible (no metered service; may send SendGrid invite email) |

```ts
// Source: backend/src/middleware/rateLimiter.ts:L177-L194 (the AI limiter)
export const aiLimiter = rateLimit({
  store: createRateLimitStore('ai'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 AI requests per hour per user
  ...
  keyGenerator: (req) => {
    return (req as Request & { user?: { id: string } }).user?.id || ipKey(req);
  },
```

**Eight named limiters total** (`rateLimiter.ts`): `standardLimiter` (:66), `authLimiter` (:88), `strictAuthLimiter` (:105), `uploadLimiter` (:134), `sensitiveLimiter` (:151), `aiLimiter` (:177), `providerAccessRequestLimiter` (:211), `bulkOperationLimiter` (:240).

> **Answer to "which caps Anthropic cost — limiter or budget?":** The per-user `$5/day` dollar cap. At Haiku worst case, 10 calls/hr × 720 hr = 7,200 calls/mo; even at $0.005/call that is only ~$36/mo, but a *Sonnet* abuse path at $0.054/call × 7,200 = ~$389/mo would exceed $150 — and the `$5/day = $150/mo` dollar cap binds first either way. The 10/hr count is the loose bound; the dollar cap is the tight one.

---

## 8. Per-tier variable cost (from `plans.ts`)

Each tier's consumable caps → the maximum metered spend that tier can drive. `-1` = unlimited; `0`/`false` = disabled (`plans.ts:7-13`).

| Limit (`PlanLimits`) | FREE | PRO | TEAM | Source |
|---|---|---|---|---|
| `aiChatsPerDay` | 3 | 50 | -1 (unlimited) | `plans.ts:48,71,90` |
| `aiGuidancePerDay` | 5 | -1 | -1 | `plans.ts:52,75,94` |
| `costAnalysisPerMonth` | 1 | -1 | -1 | `plans.ts:53,76,95` |
| `pdfUploadsPerMonth` | 2 | 20 | -1 | `plans.ts:49,72,91` |
| `maxBiomarkers` (total) | 50 | -1 | -1 | `plans.ts:50,73,92` |
| `insurancePlans` (active) | 1 | 5 | -1 | `plans.ts:51,74,93` |
| `healthProfile` | false | true | true | `plans.ts:54,77,96` |
| `providerSharing` | **true** | true | true | `plans.ts:59,78,97` |
| `dataExport` | true | true | true | `plans.ts:60,79,98` |
| `questFhirIntegration` | false | true | true | `plans.ts:61,80,99` |

> **`providerSharing` is `true` on every tier** by deliberate product decision (`plans.ts:55-59`): consent-based sharing of one's *own* data is a patient right, not a paywalled feature; the consent routes intentionally do not call `requirePlanFeature('providerSharing')`. `dataExport` is `true` on every tier because HIPAA requires it regardless of plan (`plans.ts:60`).

**Max metered spend per tier:**
- **FREE** — caps it tightly: ≤ 3 chats + 5 guidance Haiku calls/day, ≤ 1 Sonnet analysis/mo, ≤ 2 Document AI uploads/mo. Per the §3a worked examples, FREE Claude spend ceiling ≈ `(3+5)/day × 30 × $0.005 + 1 × $0.054 ≈ $1.25/mo` — well under the $5/day dollar cap. Document AI ≤ 2 pages-worth/mo.
- **PRO** — `aiGuidancePerDay = -1` and `costAnalysisPerMonth = -1` are *unlimited by count* → the **dollar cap ($5/day per user)** becomes the only spend ceiling. `pdfUploadsPerMonth = 20` bounds Document AI; `maxBiomarkers = -1`.
- **TEAM** — everything `-1` (unlimited by count) → spend is bounded **solely** by the per-user dollar cap (`$5/day`) for Claude and by `uploadLimiter` (20/hr) for Document AI (no monthly upload quota). TEAM is the tier the dollar circuit breaker most protects against.

---

## 9. Current position / runway (external)

Intentionally external — the repo holds none of these. Slots + resolution path:

| Field | Value | Resolution path |
|---|---|---|
| Personal savings / reserve | TBD (external) | Owner |
| Monthly burn rate | TBD (external: GCP + SendGrid billing) | Compute after filling §2 fixed + §3 variable actuals |
| Runway (months) | derived | `savings ÷ burn`, once burn known |
| Realized revenue | $0 today (no processor wired) | `plans.ts:4-6` confirms manual assignment; future Stripe dashboard |

---

## 10. Business accounts (external)

| Field | Value | Resolution path |
|---|---|---|
| Business credit card(s) | TBD (external) | Owner / accounting |
| Business bank account | TBD (external) | Owner / accounting |
| GCP billing account | TBD (external) | GCP Console → Billing, project `ownmyhealth-prod` (`deploy.yml:38`) |
| SendGrid account / plan | TBD (external) | SendGrid dashboard (account behind `SENDGRID_API_KEY`) |
| Anthropic account / billing | TBD (external) | Anthropic Console (account behind `ANTHROPIC_API_KEY`); requires active BAA — `ANTHROPIC_BAA_ACTIVE` gate, `config/index.ts:245` |

---

## 11. Pricing tiers

Structure and **display** prices are in code (`plans.ts`); only the *go-to-market* decision (whether to charge, conversion targets) is external.

| Tier | Display price | Annual | Positioning | Source |
|---|---|---|---|---|
| FREE | $0 | $0 | "Basic health tracking" | `plans.ts:41-63` |
| PRO | $9.99/mo | $99/yr | "Full health intelligence" | `plans.ts:64-82` |
| TEAM | $19.99/mo | $199/yr | "For families and caregivers" | `plans.ts:83-101` |

Enforcement is via `planGating` middleware (`requirePlanLimit(...)` mounted on each metered route, e.g. `uploadRoutes.ts:84,88`, `aiRoutes.ts:34`). Per the canonical state, `planGating` **fails closed to FREE** on a DB error, and `maxBiomarkers` + `insurancePlans` limits are now enforced. Tier resolution: `normalizePlan` coerces unknown values to FREE (`plans.ts:107-112`).

- **External (go-to-market only):** Is billing live? → No (`plans.ts:4-6`, no Stripe webhook). Which processor and conversion mix? → TBD (external: business decision; see [STRATEGY.md](./STRATEGY.md)).

---

## 12. Tax / legal structure (external)

| Field | Value | Resolution path |
|---|---|---|
| Legal entity (LLC / C-corp) | TBD (external) | Owner / formation docs |
| Tax treatment / state | TBD (external) | Accountant |
| BAA coverage (Anthropic, Google) | enforced in code — `ANTHROPIC_BAA_ACTIVE` (`config/index.ts:245`), `GOOGLE_BAA_ACTIVE` (`config/index.ts:236`); prod hard-fails if a key/processor is set without its BAA flag | Signed BAA agreements (legal); flags set in GCP env |

---

## Acceptance questions (self-answered from this doc)

**Q1. Which services does OwnMyHealth pay for?** → Anthropic Claude API, Google Document AI, Google Cloud Storage, Cloud Run, Cloud SQL, SendGrid, and (optionally, when `REDIS_URL` set) Cloud Memorystore — see [§1 table](#1-cost-structure-derived-from-code), evidenced from `backend/package.json:23-44`.

**Q2. What's the per-user cost formula?** → [§5](#5-per-user-cost-model): `fixed_infra/active_users + min(claude_calls × avg_cost, $5×30) + doc_ai_pages × $/page + emails × $/email + gcs × $/GB-mo`.

**Q3. What caps worst-case Anthropic cost per user — limiter or dollar budget?** → The per-user `AI_USER_DAILY_BUDGET_USD` dollar cap ($5/day → ~$150/mo) binds *before* the 10/hr `aiLimiter` — [§7](#7-rate-limit-cost-ceilings).

**Q4. Which Anthropic models are used, and which endpoints use Haiku vs Sonnet?** → Haiku (`claude-haiku-4-5-20251001`): AI chat, biomarker guidance, lab-PDF extraction; Sonnet (`claude-sonnet-4-5-20250929`): SBC extraction, expense cost analysis — [§1](#1-cost-structure-derived-from-code) & [§3a](#3a-anthropic-claude-the-only-dollar-tracked-variable-cost), `aiCostTracker.ts:34-35`.

**Q5. Which file hosts the Document AI integration?** → `backend/src/services/ocrService.ts` — the paid call at `:300` (`client.processDocument`), exported `processDocument` at `:375`.

**Q6. Fixed vs variable split, conceptually?** → Fixed = Cloud SQL (always-on) + GCS at rest + domain ([§2](#2-fixed-costs)); Cloud Run scales to zero so it's near-variable. Variable = Claude tokens, Document AI pages, SendGrid emails, GCS ops ([§3](#3-variable-costs-per-call)).

**Q7. What user count triggers break-even at PRO $9.99 / TEAM $19.99?** → [§6](#6-break-even-table): break-even = `users × ARPU ≥ fixed_infra + users × per-user_variable`; ARPU = $2.498 under the assumed 80/15/5 mix. Exact count derives once GCP fixed-infra $ is filled (external).

**Q8. On-paper max cost/user if rate limits exploited continuously, vs dollar-capped max?** → Count bound: ~7,200 AI calls/mo (10/hr × 720) which at Sonnet ~$0.054 ≈ $389/mo; dollar-capped max: per-user `$5/day = ~$150/mo` (or ≤ `3 × $5 = $15/day = ~$450/mo` with the **default in-memory** store across 3 instances; exact $150/mo with Redis) — [§4](#4-ai-dollar-budget-circuit-breaker) & [§7](#7-rate-limit-cost-ceilings).

**Q9. Which fixed costs derive from repo vs need GCP console?** → Repo gives the *count/presence*: `--max-instances=3` + defaults (`deploy.yml:189`), Cloud SQL instance name (`deploy.yml:46`), Redis optionality (`config/index.ts:186`). Dollar amounts need the GCP console. Instance sizing is in the deploy workflows, **not** `railway.toml`.

**Q10. Which service has no in-repo rate limit (no cost ceiling in code)?** → **SendGrid email** — no email-specific limiter in `rateLimiter.ts` ([§1](#1-cost-structure-derived-from-code), [§3c](#3c-sendgrid-email)). (Document AI *does* have a count ceiling via `uploadLimiter` but no *dollar* ceiling.)

**Q11. Is any revenue realized, or are `plans.ts` prices display-only?** → Display-only; no payment processor wired (`plans.ts:4-6`). Revenue is potential — [§6](#6-break-even-table) & [§11](#11-pricing-tiers).

---

## Prompt drift log

- `./23-financial-tracker-doc.md` (Files-to-review table) lists `backend/src/middleware/rateLimiter.ts` as holding "**Eight** rate limiters" — confirmed exactly 8 (`standardLimiter`, `authLimiter`, `strictAuthLimiter`, `uploadLimiter`, `sensitiveLimiter`, `aiLimiter`, `providerAccessRequestLimiter`, `bulkOperationLimiter` at `rateLimiter.ts:66,88,105,134,151,177,211,240`). No drift; recorded for traceability.
- The prompt's §3/§7 examples imply Document AI is "AI" spend; verified it is **not** dollar-tracked (`ocrService.ts:300` has no `trackAIUsage`), consistent with the prompt's own §4 caveat. No code/prompt conflict — the doc surfaces the gap as instructed.
- The prompt notes instance sizing "moved out of `backend/railway.toml`." Confirmed: sizing (`--max-instances=3`, no `--cpu`/`--memory`) lives in `deploy.yml:189` and `deploy-staging.yml:88`; `railway.toml` was not cited for sizing.
- `CLAUDE.md` (root) still describes "10 controllers" / "13 route files" / "18 services" and lists a `uploadController.ts` — these are stale vs HEAD (18 route files; upload handlers now under `controllers/upload/`). Not financial-doc-owned, but flagged for the prompt-refresh task.

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — which paid services sit in the stack and how requests flow through the middleware chain.
- [ENV_VARS.md](./ENV_VARS.md) — the paid-service keys and budget vars (`ANTHROPIC_API_KEY`, `SENDGRID_API_KEY`, `GCS_BUCKET_NAME`, `REDIS_URL`, `AI_DAILY_BUDGET_USD`, `AI_USER_DAILY_BUDGET_USD`).
- [ROUTING_TABLE.md](./ROUTING_TABLE.md) — per-endpoint rate limiters and `aiSpendGuard` mounts that act as cost ceilings.
- [STRATEGY.md](./STRATEGY.md) — pricing, go-to-market, and break-even narrative (the external adoption-mix assumptions feeding §6).
- [RUNBOOK.md](./RUNBOOK.md) — how to inspect billing, read the `AICost` log lines, and respond to a 503 budget-reached alert.
