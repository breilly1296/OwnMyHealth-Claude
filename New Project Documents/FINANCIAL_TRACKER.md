# FINANCIAL_TRACKER

Unit-economics + runway reference for OwnMyHealth. Code-adjacent cost structure (paid services, rate-limit ceilings, pricing-tier scaffolding) is derived from the repo; actual dollar figures (personal savings, GCP billing, Stripe revenue) live outside the repo and are marked with explicit resolution paths.

**Last regenerated**: 2026-04-24.

---

## 1. Cost structure (derived from code)

Every external service the backend is wired to pay for, the metered unit, the code entry point, and the rate limiter that caps its blast radius.

| Service | Metered unit | Code entry point | Governing rate limit | Per-unit cost (ref) |
|---|---|---|---|---|
| Anthropic Claude — Haiku 4.5 | input + output tokens (lab extraction + chat) | `backend/src/services/claudeExtraction.ts:154`, `:182` | `aiLimiter` (10/h/user) — `backend/src/middleware/rateLimiter.ts:102-118` | $0.80 / M input tok · $4.00 / M output tok — literal from `backend/src/services/aiCostTracker.ts:16` |
| Anthropic Claude — Sonnet 4 | input + output tokens (SBC extraction) | `backend/src/services/sbcExtraction.ts:815`, `:841` | `aiLimiter` (10/h/user) | $3.00 / M input tok · $15.00 / M output tok — `aiCostTracker.ts:17` (entry is for Sonnet-4-5 but same tier pricing) |
| Google Document AI (OCR) | pages processed (image OCR only; PDFs route to Claude) | `backend/src/services/ocrService.ts:283` (`client.processDocument`) | `uploadLimiter` (20/h) — `rateLimiter.ts:72-84` | TBD (external: GCP pricing page for Document AI OCR processor, per-page rate) |
| Google Cloud Storage — PUT | PUT op + bytes stored | `backend/src/services/storageService.ts:60` (`file.save`) | `uploadLimiter` (20/h) | TBD (external: GCP pricing — Standard class ops + GB-month) |
| Google Cloud Storage — GET | GET op + egress bytes | `backend/src/services/storageService.ts:107` (`file.createReadStream`); signed URL variant at `:133` | — (no explicit limiter on `GET /files/:id/download`) | TBD (external: GCP pricing — GET ops + egress per GB) |
| Google Cloud Storage — DELETE | DELETE op (free tier) | `backend/src/services/storageService.ts:166`, `:212` | `sensitiveLimiter` (10/h) for bulk delete paths in `settingsRoutes.ts` | TBD (external: GCP pricing — DELETE ops typically free) |
| SendGrid transactional email | emails sent | `backend/src/services/emailService.ts:251` (`client.send`) | none (guarded indirectly by `strictAuthLimiter` on the routes that trigger them) | TBD (external: SendGrid account tier — see https://sendgrid.com/pricing) |
| Cloud Run (backend) | vCPU-sec + memory-sec + requests | Deploy: `.github/workflows/deploy.yml:72` (`--max-instances=3`), `deploy-staging.yml:67` | global limiter `standardLimiter` + per-instance caps | TBD (external: GCP Cloud Run pricing; instance CPU/mem flags absent — defaults apply) |
| Cloud SQL PostgreSQL | instance-hour + storage-GB + egress | config not in repo (GCP Console) | — | TBD (external: GCP billing console, project `ownmyhealth-prod`) |
| Cloud Logging / Error Reporting | log GB ingested | implicit via `logger.*` writing to stdout which Cloud Run ingests | — | TBD (external: GCP billing) |

### Paid SDKs — grep evidence

Source: root and backend `package.json`:

```json
// Source: backend/package.json:L18-L23
"@anthropic-ai/sdk": "^0.71.2",
"@google-cloud/documentai": "^9.5.0",
"@google-cloud/storage": "^7.19.0",
"@prisma/adapter-pg": "^7.0.1",
"@prisma/client": "^7.7.0",
"@sendgrid/mail": "^8.1.4",
```

Root `package.json` lists only frontend + tooling deps — no additional paid SDK surface (verified against `package.json:L22-L60`).

### Paid observability? — NO

A repo-wide grep for `sentry`, `datadog`, `logflare`, `axiom`, `stripe` across all `package.json` files returns zero hits. The only telemetry sink is Cloud Logging (native to Cloud Run). No APM subscription currently accrues cost.

---

## 2. Architectural cost map

```
                 ┌──────────────── Cloud Run (backend, us-central1) ────────────────┐
                 │                     --max-instances=3                             │
                 │  deploy.yml:72 / deploy-staging.yml:67                            │
   Client ──────▶│                                                                   │
                 │  standardLimiter (global) — windowMs=15min, max=100               │
                 │         │                                                         │
                 │         ├── /api/v1/auth/*       authLimiter/strictAuthLimiter    │
                 │         ├── /api/v1/ai/chat      aiLimiter  ──▶ Anthropic Haiku   │
                 │         ├── /api/v1/biomarkers/:id/guidance aiLimiter ──▶ Haiku   │
                 │         ├── /api/v1/upload/*     uploadLimiter + aiLimiter        │
                 │         │       └──▶ Claude Haiku (PDF) or Doc AI OCR (image)     │
                 │         │       └──▶ GCS PUT (ownmyhealth-user-files bucket)      │
                 │         ├── /api/v1/insurance/sbc/upload   uploadLimiter+aiLimiter│
                 │         │       └──▶ Claude Sonnet (SBC extraction)               │
                 │         ├── /api/v1/files/:id/download     (no limiter) ──▶ GCS   │
                 │         ├── /api/v1/settings/*  sensitiveLimiter                  │
                 │         └── /api/v1/admin/*     sensitiveLimiter                  │
                 │                                                                   │
                 │  auth paths ──▶ SendGrid (verification / reset emails)            │
                 └─────────────────────────┬─────────────────────────────────────────┘
                                           │
                                           ▼
                              Cloud SQL (PostgreSQL)
                              project: ownmyhealth-prod
                              config lives in GCP Console
```

---

## 3. Rate-limit cost ceilings (per user, per month)

Every limiter is in-memory per Cloud Run instance. With `--max-instances=3`, an attacker can dilute by up to 3× — see `backend/src/middleware/rateLimiter.ts:L7-L13`. All limiter ceilings below use the literal `max` and `windowMs` from that file.

Assumption for "per month": 30 days × 24 hours = **720 hours**. For 15-minute windows: 30 × 24 × 4 = **2,880 windows**.

| Limiter | windowMs | max / window | Keyed by | Calls / user / month (ceiling) | Driving cost source |
|---|---|---|---|---|---|
| `standardLimiter` | 15 min (`config.rateLimit.windowMs`, default 900_000) | 100 (`config.rateLimit.maxRequests`, default) | IP | 288,000 | Cloud Run vCPU-sec (TBD external) |
| `authLimiter` | 15 min | 20 | IP | 57,600 | Cloud Run + negligible |
| `strictAuthLimiter` | 15 min | 5 (skips successful) | `email:IP` | 14,400 (failed only) | Cloud Run + SendGrid (verification/reset → `strictAuthLimiter` at `authRoutes.ts:71,79,87`) |
| `uploadLimiter` | 60 min | 20 | IP | 14,400 | GCS PUT ops + Claude Haiku (PDF) / Doc AI (image) |
| `sensitiveLimiter` | 60 min | 10 | IP | 7,200 | Cloud Run + GCS deletes for bulk-delete paths |
| `aiLimiter` | 60 min | 10 | `user.id` (fallback IP) — `rateLimiter.ts:114-117` | 7,200 | Anthropic (Haiku 4.5 for chat/guidance, Sonnet 4 for SBC) |
| `bulkOperationLimiter` | 60 min | 30 | IP | 21,600 | DB writes + encryption CPU |

### Anthropic worst-case cost ceiling (per user, per month)

`aiLimiter` caps AI calls at **10/hour/user** = **7,200 calls/user/month** (keyed by user ID — see `rateLimiter.ts:114`).

Per-call token budget is bounded by `max_tokens` in each call site:

| Call site | Model | `max_tokens` (output cap) | Typical input | Worst-case cost / call |
|---|---|---|---|---|
| Lab extraction (text path) | `claude-haiku-4-5-20251001` (`claudeExtraction.ts:154`) | 8,192 (`:155`) | ~5-20K tokens of redacted PDF text | ≤ (20,000 × $0.80 + 8,192 × $4.00) / 1M = **~$0.049** |
| Lab extraction (vision path) | `claude-haiku-4-5-20251001` (`claudeExtraction.ts:182`) | 8,192 (`:183`) | PDF image tokens (higher) | materially higher; TBD (external: Anthropic console — vision token accounting) |
| SBC extraction (text path) | `claude-sonnet-4-20250514` (`sbcExtraction.ts:815`) | 16,384 (`:816`) | ~10-30K tokens of redacted SBC | ≤ (30,000 × $3.00 + 16,384 × $15.00) / 1M = **~$0.336** |
| SBC extraction (vision path) | `claude-sonnet-4-20250514` (`sbcExtraction.ts:841`) | 16,384 (`:842`) | PDF image tokens | higher; TBD external |
| Chat / guidance | model per `aiChatController` (Haiku per CLAUDE.md) | per call | short context | TBD (external: aiChatController call site — this doc's scope is limiter×cost only) |

**Model pricing is hard-coded in `aiCostTracker.ts:L14-L18`:**

```ts
// Source: backend/src/services/aiCostTracker.ts:L14-L18
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  'claude-sonnet-4-5-20250929': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
};
```

Note: the SBC service still pins `claude-sonnet-4-20250514`; the cost tracker's Sonnet key is `claude-sonnet-4-5-20250929`, so Sonnet calls hit the default-fallback branch (`PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929']` — `aiCostTracker.ts:33`). Pricing tier is the same across Sonnet versions but logged model name will differ — log analysis quirk, not a cost bug.

**Aggregate AI ceiling per user per month** (if a single user hit `aiLimiter` every hour for 30 days):

- 7,200 calls × worst-case Haiku $0.049 ≈ **$353 / user / month (AI only, Haiku worst case)**
- If every call were SBC Sonnet at $0.336: 7,200 × $0.336 ≈ **$2,419 / user / month** (not realistic — SBC uploads are one-time per plan)

Plan-tier gating (see section 8) cuts this dramatically: FREE = 3 chats/day + 5 guidance/day + 2 PDFs/month; PRO = 50 chats/day + 20 PDFs/month.

### Upload & email ceilings

| Ceiling | Calls/user/month | Cost driver | Per-unit cost | Monthly cost/user (TBD) |
|---|---|---|---|---|
| `uploadLimiter` 20/h | 14,400 | GCS PUT ops + Document AI OCR pages + Claude on PDFs | PUT ≈ $0.005/1K ops · Doc AI OCR TBD external (GCP pricing page) | TBD external |
| `sensitiveLimiter` 10/h | 7,200 | GCS DELETEs + Cloud SQL writes | ops typically free | ~$0 (ops) |
| `strictAuthLimiter` 5/15min | 14,400 (fail-only keyed) | SendGrid email (password reset / verification) | SendGrid tier TBD external | TBD (external: SendGrid account) |

---

## 4. Per-user cost formula

```
cost_per_user_per_month =
    (fixed_infra_cost_per_month / active_users)
  + ANTHROPIC_CALLS_PER_USER        × avg_anthropic_cost_per_call
  + DOC_AI_PAGES_PER_USER           × doc_ai_price_per_page
  + GCS_STORAGE_GB_PER_USER         × gcs_std_price_per_gb_month
  + GCS_PUT_OPS_PER_USER            × gcs_put_price_per_op
  + GCS_GET_OPS_PER_USER            × gcs_get_price_per_op
  + EMAILS_PER_USER                 × sendgrid_price_per_email
```

### Assumptions (all stated explicitly)

| Variable | Value | Source of assumption |
|---|---|---|
| `active_users` | variable | external — user growth depends on marketing |
| `ANTHROPIC_CALLS_PER_USER` (realistic) | 30 / month | Midpoint of PRO plan: 50 chats/day × 30 = 1,500 ceiling; realistic usage ~1-2 chats/day → ~45. Dial by tier. |
| Avg Anthropic cost / call | ~$0.03 (blended Haiku guidance ~5K in, ~1K out) | Haiku pricing literal from `aiCostTracker.ts:16` |
| `DOC_AI_PAGES_PER_USER` | 0-5 / month | Only triggered when user uploads **image** (not PDF) — PDFs route to Claude per `ocrService.ts:378-394` |
| `doc_ai_price_per_page` | TBD external — GCP pricing page, OCR processor |
| `GCS_STORAGE_GB_PER_USER` | ~0.01-0.1 GB | 10 MB max per file (`ocrService.ts:48`) × typical 1-10 files |
| `EMAILS_PER_USER` | 1-3 / month | Verification on signup + occasional password reset (see `emailService.ts:269, 291`) |
| `sendgrid_price_per_email` | TBD external — SendGrid account tier |

### Fixed vs variable split

- **Fixed (independent of user count)**: Cloud SQL instance-hour, Cloud Run baseline (even at min-instances=0 there's request/image-registry/network floor), domain, Cloud Logging retention — all TBD external.
- **Variable (scale with user activity)**: Anthropic tokens, Document AI pages, GCS storage + ops, SendGrid emails. All of these have an explicit code entry point and (for AI/uploads) a rate-limit ceiling.

---

## 5. Fixed costs table

| Line item | Amount | Source path | Resolution path |
|---|---|---|---|
| Cloud Run baseline (prod `ownmyhealth-backend`) | TBD external | `.github/workflows/deploy.yml:11` (SERVICE), `:72` (`--max-instances=3`; no `--cpu` or `--memory` set → defaults apply) | GCP billing console → Cloud Run → `ownmyhealth-backend` service, us-central1 |
| Cloud Run baseline (staging `ownmyhealth-backend-staging`) | TBD external | `.github/workflows/deploy-staging.yml:17, :67` | GCP billing → Cloud Run → staging service |
| Cloud SQL PostgreSQL | TBD external | instance spec not in repo | GCP Console → Cloud SQL → project `ownmyhealth-prod` |
| GCS buckets (user files + frontend assets + staging) | TBD external | buckets referenced: `ownmyhealth-user-files` (`storageService.ts:20`), `ownmyhealth-frontend` (`deploy.yml:13`), `ownmyhealth-frontend-staging` (`deploy-staging.yml:19`) | GCP billing → Cloud Storage |
| Cloud Logging retention | TBD external | no explicit retention in repo; structured logs via `logger` (e.g. `aiCostTracker.ts:36`) ingest to Cloud Logging by default | GCP Console → Operations → Logging → Log Storage |
| Artifact Registry (Docker images) | TBD external | `.github/workflows/deploy.yml:42` (`REGION-docker.pkg.dev/PROJECT_ID/ownmyhealth/ownmyhealth-backend`) | GCP billing → Artifact Registry |
| Domain (`ownmyhealth.io`, `api.ownmyhealth.io`, `api-staging.ownmyhealth.io`) | TBD external | references: `deploy.yml:160`, `deploy-staging.yml:73` | registrar account (external) |
| Anthropic API minimum / monthly spend | TBD external (pay-as-you-go; no monthly minimum) | — | Anthropic console (https://console.anthropic.com/ → Billing) |
| SendGrid tier | TBD external | `emailService.ts:42` uses `@sendgrid/mail@^8.1.4`; env var `SENDGRID_API_KEY` per CLAUDE.md line 245 | SendGrid account dashboard |
| Google Document AI processor | TBD external | processor ID in env (`GCP_PROCESSOR_ID`, `ocrService.ts:85`); project in `GCP_PROJECT_ID`; location `GCP_LOCATION || 'us'` (`:115`) | GCP Console → Document AI → processors in `ownmyhealth-prod` |
| Historical: Railway (no longer paid) | $0 (legacy) | `backend/railway.toml` still present but vestigial — deploy path is Cloud Run per `deploy.yml` | Cancel/confirm on Railway dashboard if account still open |

### What the repo tells us about Cloud Run sizing

```yaml
# Source: .github/workflows/deploy.yml:L66-L73
gcloud run deploy ${{ env.SERVICE }} \
  --image "$IMAGE" \
  --region "${{ env.REGION }}" \
  --project "${{ env.PROJECT_ID }}" \
  --platform managed \
  --no-traffic \
  --max-instances=3 \
  --tag "$TAG"
```

No `--cpu`, no `--memory`, no `--min-instances`. Cloud Run default is 1 vCPU / 512 MiB / min-instances=0. `--max-instances=3` is the ceiling; the `2026-04-17` deploy comment at `.github/workflows/deploy.yml:L62-L65` explains this is deliberately pinned low to bound in-memory rate-limiter dilution (see also `rateLimiter.ts:L1-L14`).

### railway.toml — vestigial

```toml
# Source: backend/railway.toml:L1-L13
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "npx prisma migrate deploy && node dist/app.js"
healthcheckPath = "/api/v1/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

Kept in the repo for historical reference; production deploys go to Cloud Run via `deploy.yml`. If a Railway account still exists it is a preventable monthly cost — verify on the Railway dashboard.

---

## 6. Variable costs (per call)

| Operation | Unit | Code entry | Unit cost | Resolution if TBD |
|---|---|---|---|---|
| Anthropic Haiku 4.5 call (text, lab extraction) | 1 request | `claudeExtraction.ts:153-167` | $0.80/M input + $4.00/M output (`aiCostTracker.ts:16`) | derived |
| Anthropic Sonnet 4 call (text, SBC extraction) | 1 request | `sbcExtraction.ts:814-828` | $3.00/M input + $15.00/M output (Sonnet tier, `aiCostTracker.ts:17`) | derived |
| Anthropic vision call | 1 request | `claudeExtraction.ts:181-203` / `sbcExtraction.ts:840-862` | same token pricing + image-token count | TBD (external: Anthropic console billing — actual token accounting on vision calls) |
| Document AI OCR page | 1 page | `ocrService.ts:283` (`processDocument`) | TBD external | GCP pricing: https://cloud.google.com/document-ai/pricing |
| GCS PUT | 1 op | `storageService.ts:60` | TBD external | GCP pricing: https://cloud.google.com/storage/pricing#operations-pricing |
| GCS GET / egress | 1 op + bytes | `storageService.ts:107, :133` | TBD external | GCP pricing (same page, Class A vs Class B ops) |
| SendGrid email | 1 email | `emailService.ts:251` | TBD external | SendGrid account dashboard |
| Cloud SQL row write | — | via `@prisma/client@^7.7.0` | TBD external | bundled into instance-hour charge |

---

## 7. Break-even table

Revenue derived symbolically from the tier prices hard-coded in `backend/src/config/plans.ts:L44-L97` (monthly price in cents).

- `FREE.price = 0`
- `PRO.price = 999` → **$9.99 / month**
- `TEAM.price = 1999` → **$19.99 / month**

Note: `plans.ts:L6-L9` says "No payment processing yet — plans are assigned manually via the admin panel." These prices are display-only today — there is **no Stripe integration** (grep for `stripe` in all `package.json` returned zero hits; the string appears in code comments only, e.g. `plans.ts:L7`).

Let `C(u)` = total monthly cost at `u` active users, where:

```
C(u) = F + u × V
```

- `F` = fixed monthly infra (Cloud Run baseline + Cloud SQL + logging + domain) — **TBD external**
- `V` = variable cost / active user (formula in section 4) — partly derived, GCS/Doc AI rates TBD external

Revenue (all paid users on PRO tier):

```
R(u_paid) = u_paid × $9.99
```

Break-even user counts (symbolic, assume 100% conversion for simplicity):

| PRO users | Revenue | Costs | Net |
|---|---|---|---|
| 100 | $999 | F + 100·V | $999 − F − 100·V |
| 500 | $4,995 | F + 500·V | $4,995 − F − 500·V |
| 1,000 | $9,990 | F + 1,000·V | $9,990 − F − 1,000·V |
| 5,000 | $49,950 | F + 5,000·V | $49,950 − F − 5,000·V |

Break-even user count formula (PRO-only, 100% conversion):

```
u_breakeven = F / ($9.99 − V)
```

With realistic 5% free→paid conversion:

```
R(u_total) = 0.05 × u_total × $9.99
u_breakeven_total = F / (0.05 × $9.99 − V) = F / ($0.4995 − V)
```

This formula remains correct once `F` and `V` are resolved from the GCP/SendGrid billing consoles. Do not report a concrete break-even user count until both are filled.

---

## 8. Pricing tiers (derived from code)

Source: `backend/src/config/plans.ts:L40-L98`.

| Tier | Monthly price (cents) | Annual (cents) | AI chats/day | AI guidance/day | PDF uploads/month | Max biomarkers (stored) | Insurance plans | Health profile | Provider sharing | Data export | Quest FHIR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FREE | 0 | 0 | 3 | 5 | 2 | 50 | 1 | false | false | **true** (HIPAA) | false |
| PRO | 999 ($9.99) | 9900 ($99) | 50 | unlimited (-1) | 20 | unlimited | 5 | true | true | true | true |
| TEAM | 1999 ($19.99) | 19900 ($199) | unlimited | unlimited | unlimited | unlimited | unlimited | true | true | true | true |

### Enforcement path

```
POST /api/v1/ai/chat
  │
  ├─ requireBearerAuth           backend/src/middleware/auth.ts
  ├─ aiLimiter                   rateLimiter.ts:102 (hard cap: 10/h/user)
  ├─ blockDemoAI                 middleware/demoProtection.ts
  ├─ requirePlanLimit('aiChatsPerDay')   middleware/planGating.ts:37
  │    │
  │    └──▶ checkPlanLimit(userId, effectivePlan, limitKey)
  │            services/usageTracker.ts
  │
  └─ validate + handler
```

Source for ordering: `backend/src/routes/aiRoutes.ts:L28-L35`:

```ts
// Source: backend/src/routes/aiRoutes.ts:L28-L35
router.post(
  '/chat',
  aiLimiter,
  blockDemoAI,
  requirePlanLimit('aiChatsPerDay'),
  validate(schemas.ai.chat),
  asyncHandler(handleAIChat)
);
```

### No billing integration yet

- No `stripe`, `paddle`, or `lemonsqueezy` in `package.json` (verified by grep).
- `backend/src/config/plans.ts:L6-L11` comment: "No payment processing yet — plans are assigned manually via the admin panel or a direct DB update."
- Admin PATCH path: `backend/src/routes/adminRoutes.ts` (plan mutation endpoint; sensitive limiter applied at `:452`).
- Subscription introspection: `GET /api/v1/plan` + `GET /api/v1/plan/available` (`backend/src/routes/planRoutes.ts:32, :52`).

---

## 9. Current position (external)

These live outside the repo entirely. Slots + resolution path only.

| Field | Value | Resolution path |
|---|---|---|
| Personal savings | TBD (external: owner) | Ask user (question 1 in prompt's "Questions to ask the user"); CLAUDE.md line 244 — `breilly1296@pm.me` |
| IRA reserve | TBD (external: owner) | — |
| Full-time timing | TBD (external: owner) | — |
| Monthly burn rate | TBD (derived once fixed + variable $ known) | GCP billing console + Anthropic console + SendGrid account |
| Runway | TBD (derived: savings / burn) | — |
| MRR / ARR | TBD (external) | none yet — no Stripe integration; recognise $0 until billing ships |
| Paying user count | TBD (external) | DB: `SELECT COUNT(*) FROM users WHERE plan IN ('PRO', 'TEAM') AND (plan_expires_at IS NULL OR plan_expires_at > now());` — schema via `plans.ts` + `planGating.ts:L63-L66` |

---

## 10. Business accounts (external)

| Field | Value | Resolution path |
|---|---|---|
| Business bank account | TBD (external) | owner |
| Business credit card | TBD (external) | owner |
| GCP billing account | TBD (external: GCP Console → Billing, project `ownmyhealth-prod` per `deploy.yml:9`) | owner |
| Anthropic billing account | TBD (external: https://console.anthropic.com/ → Billing) | owner |
| SendGrid account | TBD (external: SendGrid dashboard) | owner |
| Domain registrar for `ownmyhealth.io` | TBD (external) | owner |

---

## 11. Tax / structure (external)

| Field | Value | Resolution path |
|---|---|---|
| Legal entity | TBD (external) | owner (formation docs) |
| EIN / tax ID | TBD (external) | IRS records |
| State of formation | TBD (external) | owner |
| Accountant / bookkeeper | TBD (external) | owner |
| R&D credit eligibility | TBD (external) | accountant review |

---

## 12. Reporting & monitoring

### AI cost telemetry — already wired

```ts
// Source: backend/src/services/aiCostTracker.ts:L32-L43
export function trackAIUsage(record: AIUsageInput): void {
  const pricing = PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929'];
  const estimatedCostUsd = (record.inputTokens * pricing.input) + (record.outputTokens * pricing.output);

  aiCostLogger.info('AI API usage', {
    endpoint: record.endpoint,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedCostUsd: estimatedCostUsd.toFixed(6),
    userId: record.userId,
  });
}
```

Call sites: `claudeExtraction.ts:208` (lab extraction), `sbcExtraction.ts:886` (SBC). **Not called from the chat controller** (`aiChatController.ts` — any AI chat cost is currently un-telemetered; see `Prompt drift log`).

Query Cloud Logging for `"AI API usage"` + `estimatedCostUsd` to reconstruct daily spend without waiting for the Anthropic billing console. See `RUNBOOK.md` for the log-query recipes.

### No observability subscription in code

No Sentry / Datadog / Axiom / Logflare found in any `package.json`. All runtime observability flows to Cloud Logging, whose cost is wrapped into GCP billing (fixed-line item in section 5).

---

## Acceptance questions (self-answered from this doc)

**Q1. Which services does OwnMyHealth pay for?** → Section 1 table: Anthropic Claude (Haiku 4.5 + Sonnet 4), Google Document AI, Google Cloud Storage, SendGrid, Google Cloud Run, Google Cloud SQL, Google Cloud Logging, Google Artifact Registry, domain registrar. No paid APM.

**Q2. What's the per-user cost formula?** → Section 4: `cost_per_user_per_month = F/active_users + Σ(variable_usage × unit_price)`, where variable usage covers Anthropic calls, Doc AI pages, GCS storage + ops, and SendGrid emails.

**Q3. Which rate limit caps the worst-case Anthropic cost per user?** → `aiLimiter` at 10 requests / hour / user (keyed by `user.id` per `rateLimiter.ts:114-117`). Ceiling: 7,200 calls/user/month. Additional cap per tier via `requirePlanLimit('aiChatsPerDay')` — FREE=3/day, PRO=50/day, TEAM=unlimited.

**Q4. Which Anthropic model is used in production, per code?** → Two models, both cited by literal string:
- `claude-haiku-4-5-20251001` for lab extraction and chat (`claudeExtraction.ts:154, :182`)
- `claude-sonnet-4-20250514` for SBC extraction (`sbcExtraction.ts:815, :841`)

**Q5. Which file hosts the Document AI integration?** → `backend/src/services/ocrService.ts` — client init `:80-:107`, processor name `:113-:119`, actual call `:283`. OCR only fires for **images** (PNG/JPG/TIFF); PDFs route to Claude (`:378-:394`).

**Q6. What's the fixed vs variable cost split, conceptually?** → Section 4 last paragraph. Fixed: Cloud SQL instance-hour, Cloud Run baseline, domain, logging retention (all TBD external). Variable: Anthropic tokens, Doc AI pages, GCS storage/ops, SendGrid emails (entry points cited in section 1).

**Q7. What user count triggers break-even at a $X/month tier?** → Section 7 symbolic: `u_breakeven = F / ($9.99 − V)` for PRO-only with 100% conversion; `F / ($0.4995 − V)` for 5% conversion from total. Concrete number requires resolving `F` and `V` from GCP + SendGrid billing.

**Q8. On-paper max cost per user if they exploited rate limits continuously?** → Section 3: `aiLimiter` ceiling is 7,200 AI calls/user/month. Worst-case Haiku ≈ $353/user/month; worst-case Sonnet ≈ $2,419/user/month. Upload ceiling 14,400 PUTs/user/month. These are unrealistic without tier enforcement; `requirePlanLimit` additionally caps FREE at ~150 AI calls/month and 2 PDF uploads/month.

**Q9. Which fixed costs can be derived from repo vs require the GCP console?** → Derived from repo: Cloud Run `--max-instances=3`, service names, region (us-central1), project ID (`ownmyhealth-prod`), bucket names, Artifact Registry path, paid SDKs, plan prices in cents. Require GCP/SendGrid console: actual dollars for Cloud Run CPU/memory burn, Cloud SQL instance class + storage, Document AI per-page rate, GCS storage + ops rates, SendGrid tier, domain renewal.

**Q10. Which service has no in-repo rate limit and therefore no cost ceiling in code?** → **SendGrid** has no dedicated limiter. Its calls are triggered only by password-reset and email-verification routes, which are themselves gated by `strictAuthLimiter` (5/15min keyed by `email:IP`) — an indirect ceiling, not a SendGrid-specific one. Also, `GET /api/v1/files/:id/download` (GCS egress) has **no limiter at the route level** — it relies on `authenticate` + RLS only — so egress is bounded by client patience, not by an `express-rate-limit` cap.

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — full service topology; which boxes spend money when a request flows.
- [ROUTING_TABLE.md](./ROUTING_TABLE.md) — per-endpoint middleware and rate-limiter mapping (the cost-ceiling lookups).
- [ENV_VARS.md](./ENV_VARS.md) — paid-service keys (`ANTHROPIC_API_KEY`, `SENDGRID_API_KEY`, `GCP_PROJECT_ID`, `GCP_PROCESSOR_ID`, `GCS_BUCKET_NAME`).
- [RUNBOOK.md](./RUNBOOK.md) — Cloud Logging queries to reconstruct AI cost from `trackAIUsage` records; billing-alert playbooks.
- [SECURITY_STATUS.md](./SECURITY_STATUS.md) — C-7 Anthropic BAA gate (`ANTHROPIC_BAA_ACTIVE`) that turns Claude spend on/off.
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — in-memory rate-limiter dilution with multi-instance Cloud Run (directly affects cost-ceiling accuracy).
- STRATEGY.md *(doc pending — see `prompts/22-strategy-doc.md`)* — pricing narrative and competitive positioning.

---

## Prompt drift log

- `prompts/23-financial-tracker-doc.md` example row shows `aiLimiter` as "N/hour" without a value; actual literal is `max: 10` per `backend/src/middleware/rateLimiter.ts:104`. Updated the ceiling table to use the real value. Prompt author should replace "N" with "10" in the example.
- Prompt says "model = `claude-haiku-4-5-20251001` per CLAUDE.md/memory" — CLAUDE.md does not actually pin a Claude model (no reference found in the 286-line file). The model is only hard-coded in `claudeExtraction.ts:154, :182`. Prompt reference to CLAUDE.md is stale — the only source of truth is `claudeExtraction.ts` + `sbcExtraction.ts` + `aiCostTracker.ts`.
- Prompt expected `backend/src/services/claudeExtraction.ts` to host "the" Anthropic model; actual repo has **two** extraction services (`claudeExtraction.ts` → Haiku, `sbcExtraction.ts` → Sonnet) plus `aiChatController.ts` (chat endpoint) whose model is not inspected in this pass. SBC deserves its own row in the cost-structure table (done).
- Prompt table hints `aiLimiter 10/hour → 720 * N`. Actual: 10/hour × 720 hours = **7,200** calls/user/month. Prompt's "720 × N" implies per-hour multiplication which is confusing — corrected to explicit 7,200.
- `backend/railway.toml` still exists but is not referenced by any active workflow (both `deploy.yml` and `deploy-staging.yml` target Cloud Run). Prompt correctly flagged it as "vestigial — cite for historical cost context" and is preserved in section 5.
- `aiCostTracker.ts:17` pins Sonnet key as `claude-sonnet-4-5-20250929` but `sbcExtraction.ts:815` uses `claude-sonnet-4-20250514`. The logger's dictionary miss will fall through the `||` default — pricing ends up correct but the logged model name won't match the dictionary key. Noted in section 3.
- `aiChatController.ts` does not appear to call `trackAIUsage` (grep for `trackAIUsage` over `backend/src` returns only `claudeExtraction.ts:208` and `sbcExtraction.ts:886`). Any chat spend is currently invisible in the in-repo cost log — resolve before using Cloud Logging as a billing-console substitute.
