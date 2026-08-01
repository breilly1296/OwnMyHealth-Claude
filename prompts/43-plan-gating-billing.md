---
tags:
  - security
  - plan-gating
  - medium
type: prompt
priority: 3
updated: 2026-06-16
---

# Plan Gating & Billing-Tier Security Review

This is the **deep single-domain owner** for subscription plan gating and billing
tiers. [[27-ai-integration]] touches this domain at survey level (it lists
`requirePlanLimit` in the AI guard stack), and [[42-ai-cost-control]] owns the
dollar-budget governance — this prompt cross-links both rather than re-auditing the
guard stack. It goes beyond the basics into authorization integrity, the tier source
of truth, limit-counting correctness, the unwired billing path, and the error-shape
contract. Don't re-audit the AI guard stack here; cross-link instead.

## Files to Review
- `backend/src/middleware/planGating.ts` (the gate — `requirePlanLimit(limitKey)` at `:37` and its alias `requirePlanFeature(feature)` at `:131`; reads the live plan from the DB under RLS at `planGating.ts:66`, applies `planExpiresAt` downgrade at `:73`, **fails CLOSED to FREE on a DB error** (catch block `:76-88`), emits the 403 body at `:90`)
- `backend/src/config/plans.ts` (tier source of truth — `PlanTier = 'FREE' | 'PRO' | 'TEAM'`, the `PlanLimits` interface, the `PLANS` table, `normalizePlan`, `getPlanLimits`, `isUnlimited`; `price`/`annualPrice` are display-only — comment at `plans.ts:35`)
- `backend/src/services/usageTracker.ts` (counts usage — `getUserUsage` (one RLS-wrapped txn), `checkPlanLimit`; `NUMERIC_LIMIT_TO_USAGE` map at `:111`; window helpers `startOfTodayUTC`/`startOfMonthUTC`)
- `backend/src/routes/planRoutes.ts` (`GET /api/v1/plan` authed tier+usage; `GET /api/v1/plan/available` PUBLIC catalog — no auth)
- `backend/src/routes/adminRoutes.ts` (`PATCH /users/:id/plan` registered at `:598-599` — the ONLY write path to `users.plan` today; gated by `requireRole('ADMIN')` + `blockDemoAdminAccess` at `:30-31`)
- `backend/prisma/schema.prisma` (`User.plan String @default("FREE") @db.VarChar(20)` at `:39`, `planExpiresAt` `:40`, `planUpdatedAt` `:41`. NOTE: this is a **VARCHAR, not a Prisma enum** — the `PlanType` enum at `:594` is HMO/PPO/EPO/POS/HDHP for `InsurancePlan.planType`, a different concept)
- `backend/prisma/migrations/20260420_add_user_plan/migration.sql` (adds the three columns; comments document the intended Stripe-webhook write path that does not exist yet)
- `backend/src/middleware/validation.ts` (`schemas.admin.updateUserPlan` at `:899` — `z.enum(['FREE','PRO','TEAM'])` + optional ISO `expiresAt`)
- `backend/src/middleware/auth.ts` (`req.user.plan` populated from the JWT at `:118`/`:174`/`:230`, falling back to `'FREE'` — this is the *stale snapshot* that `planGating` deliberately bypasses)
- `backend/src/middleware/aiSpendGuard.ts` (the 503 dollar-budget circuit breaker that bounds unlimited tiers — distinct from the 403 plan gate)
- `backend/src/middleware/demoProtection.ts` (`blockDemoAI`, `blockDemoAdminAccess` — demo blocks run alongside plan gates)
- Gated route files (enumerate what gates what):
  - `backend/src/routes/aiRoutes.ts:34` — `requirePlanLimit('aiChatsPerDay')`
  - `backend/src/routes/biomarkerRoutes.ts:105` — `requirePlanLimit('maxBiomarkers')` (POST /batch); `:87` (POST / create); `:138` — `requirePlanLimit('aiGuidancePerDay')`
  - `backend/src/routes/expenseRoutes.ts:116` — `requirePlanLimit('costAnalysisPerMonth')`
  - `backend/src/routes/insuranceRoutes.ts:83` — `requirePlanLimit('insurancePlans')` (POST /plans); `:126,139` — `requirePlanLimit('pdfUploadsPerMonth')` (reanalyze + upload-sbc)
  - `backend/src/routes/uploadRoutes.ts:88,139` — `requirePlanLimit('maxBiomarkers')` (the two biomarker-ingesting upload routes); `:84,106,137` — `requirePlanLimit('pdfUploadsPerMonth')` (lab-report, insurance-sbc, lab-results-ocr)
  - `backend/src/routes/settingsRoutes.ts:80` — `requirePlanFeature('healthProfile')` (PATCH only; GET ungated by design)
  - `backend/src/routes/fhirRoutes.ts:34,59` — `requirePlanFeature('questFhirIntegration')` (connect + sync)
- **In-handler (non-middleware) enforcement sites added for M12/M13** — the route gate alone does not bound biomarker/insurance counts on the ingest paths, so two handler-side gates back it up, both using the NEW `usageTracker.resolveEffectivePlan` export (`usageTracker.ts:68-81`, which mirrors `planGating.ts:60-75` but fails closed — it does not catch→FREE):
  - `backend/src/controllers/upload/shared.ts` — M12: the OCR/upload biomarker insert truncates the batch to `maxBiomarkers` in-tx (referenced from `uploadRoutes.ts:87`).
  - `backend/src/controllers/insuranceController.ts:680-727` — M13: re-checks `insurancePlans` in-tx on an `isActive` false→true activation and returns a hand-built `PLAN_LIMIT_EXCEEDED` 403, closing the create-inactive-then-activate bypass.
- `src/services/api/plan.ts` (frontend read client — `getCurrentPlan`, `getAvailablePlans`; `CurrentPlanData`, `PlanLimits` mirror of the backend interface)
- `src/services/api/client.ts` (`isPlanLimitError` narrowing helper at `:55`; the `PLAN_LIMIT_EXCEEDED` → `apiError.planLimit` mapping at `:356-363`)
- `src/services/api/ai.ts` (SSE chat client — re-parses `PLAN_LIMIT_EXCEEDED` off the streaming 4xx body at `:135`)
- `src/components/settings/PlanSection.tsx` (tier badge, usage bars, feature list; the "Upgrade" CTA is a TODO/`onError` placeholder — TODO comment at `:162`, `onError(...)` call at `:163`)
- `src/components/health/HealthGuidePage.tsx` (`TERMINAL_ERROR_CODES` set at `:30` includes `PLAN_LIMIT_EXCEEDED` + `SERVICE_UNAVAILABLE`)
- `src/components/settings/LabConnectionsSection.tsx` (`isPlanLimitError` upgrade-prompt branch at `:178` for the `questFhirIntegration` gate)
- `backend/src/schedulers/emailScheduler.ts:374,376,386,409,413` (reads `planExpiresAt` for the 7-day expiry-warning email — note it does NOT write/downgrade `plan`; the only enforcement of expiry is at request time in `planGating`)

## OwnMyHealth Plan-Gating Architecture
- **Tiers**: three application-defined tiers in `config/plans.ts` — `FREE`, `PRO`, `TEAM`.
  Each `PlanConfig` carries display `name`/`description`, monthly+annual `price`
  (in cents, **display-only**, see the comment at `plans.ts:35`), and a `PlanLimits`
  object. Limit semantics: `-1` = unlimited (`isUnlimited`), `0` = disabled
  (numeric) / `false` (boolean), `N` = max N in the window.
- **Tier source of truth**: `users.plan` (`schema.prisma:39`) — a **VARCHAR(20)
  defaulting to `'FREE'`**, not a native DB enum. Application code coerces any value
  to a known tier via `normalizePlan` (unknown → `FREE`). Two sidecar columns:
  `planExpiresAt` (auto-downgrade target) and `planUpdatedAt` (stamped on change).
- **The gate**: `requirePlanLimit(limitKey)` middleware (`planGating.ts:37`).
  `requirePlanFeature` is a thin alias for the same function (`:131`) used when the
  gated thing is a boolean feature. It runs AFTER `authenticate`; with no `req.user`
  it `next()`s and lets the auth layer surface the 401 (`:45`). Critically, it reads
  the plan **fresh from the DB under `withRLSContext`** (`:66`) rather than trusting
  the JWT snapshot in `req.user.plan` — the JWT can be up to 15 min stale, so a
  PRO→FREE downgrade would otherwise leave premium access open for the access-token
  lifetime. It also enforces `planExpiresAt` at request time (`:73`): an expired
  subscription falls back to `FREE` limits. **On a DB error it fails CLOSED to FREE
  limits** (`effectivePlan = 'FREE'`, catch block `:76-88`) — it explicitly does NOT
  fall back to the JWT plan; the in-code comment notes that trusting the JWT would
  "reopen premium access … FREE limits keep the gate honest" during a transient
  outage.
- **Usage counting**: `usageTracker.checkPlanLimit` (`:125`) resolves the limit value,
  then: boolean features short-circuit (allow/deny, no DB); unlimited (`-1`) numeric
  tiers short-circuit (no count query, `:144`); finite numeric limits call
  `getUserUsage`. Counts come from:
  - `aiChatsPerDay` → `AuditLog` rows where `resourceType='HealthGuide'`, `action='READ'`, `createdAt >= startOfTodayUTC`
  - `aiGuidancePerDay` → `AuditLog` rows where `resourceType='biomarker_ai_guidance'` (same window)
  - `pdfUploadsPerMonth` → `userFile` rows since `startOfMonthUTC`
  - `maxBiomarkers` → total `biomarker` rows (no window)
  - `insurancePlans` → active `insurancePlan` rows (`isActive=true`, no window)
  - `costAnalysisPerMonth` → `costAnalysis` rows since `startOfMonthUTC`
  All counts run inside `withRLSContext(userId)` so a user is counted only on data
  the RLS policy lets them see (`usageTracker.ts:60`).
- **Billing reality (the gap)**: there is **no payment processing**. `plans.ts`
  prices never charge anything; no Stripe SDK, webhook handler, or checkout exists in
  the repo (grep `stripe`/`webhook` → only comments/TODOs). `users.plan` is set by
  exactly ONE realized path: `PATCH /api/v1/admin/users/:id/plan`
  (`adminRoutes.ts:598-599`), gated by `requireRole('ADMIN')`. The migration, `plans.ts`,
  `planRoutes.ts`, and `PlanSection.tsx` all *narrate* a future Stripe webhook that
  would update the same column — but it is unwired. The frontend "Upgrade" button is
  a placeholder that calls `onError('Upgrades are not available yet…')`
  (`PlanSection.tsx:163`).
- **Error contract**: the gate fails with **HTTP 403** and a hand-built body
  `{ success:false, error:{ code:'PLAN_LIMIT_EXCEEDED', message, limit, current,
  feature, upgradeRequired:true } }` (`planGating.ts:90-104`). This is distinct from
  the **429** rate-limit responses (`rateLimiter.ts` limiters — see [[08-rate-limiting]])
  and the **503 SERVICE_UNAVAILABLE** spend-cap / BAA refusals (budget breach at
  `aiSpendGuard.ts:60-67`; `:42-51` is the separate Redis-store-error 503 branch;
  biomarker BAA gate refusal `biomarkerRoutes.ts:147-149`). The frontend keys off the
  `PLAN_LIMIT_EXCEEDED` code to render an upgrade CTA instead of a generic error.

## Checklist

### 1. Authorization Integrity (server-side enforcement, not UI-only)
- [ ] Every paid feature is gated **on the route**, not merely hidden in the UI — a `FREE` user calling the API directly with a valid token must be refused. Confirm `requirePlanLimit`/`requirePlanFeature` sits in the middleware chain BEFORE the handler on each gated route.
- [ ] Enumerate the gate→limit mapping and confirm each is present:
  `aiRoutes.ts:34` → `aiChatsPerDay`; `biomarkerRoutes.ts:138` → `aiGuidancePerDay`,
  `:87`/`:105` → `maxBiomarkers` (create + batch); `expenseRoutes.ts:116` →
  `costAnalysisPerMonth`; `insuranceRoutes.ts:126,139` and `uploadRoutes.ts:84,106,137`
  → `pdfUploadsPerMonth`; `insuranceRoutes.ts:83` → `insurancePlans`;
  `uploadRoutes.ts:88,139` → `maxBiomarkers` (biomarker-ingesting upload routes);
  `settingsRoutes.ts:80` → `healthProfile`; `fhirRoutes.ts:34,59` →
  `questFhirIntegration`.
- [ ] `insurancePlans` IS now enforced (M20 + M13): `POST /api/v1/insurance/plans` carries `requirePlanLimit('insurancePlans')` (`insuranceRoutes.ts:83`), and an in-handler M13 gate re-checks the quota in-tx on an `isActive` false→true activation, returning a hand-built `PLAN_LIMIT_EXCEEDED` 403 (`insuranceController.ts:680-727`) — this closes the create-inactive-then-activate bypass. Confirm both the middleware gate and the activation re-check fire and that a FREE user (`insurancePlans:1`) cannot exceed the cap by either create or activation.
- [ ] `maxBiomarkers` IS now enforced (M21 + M12): `POST /api/v1/biomarkers` (`biomarkerRoutes.ts:87`) and `POST /batch` (`:105`) both carry `requirePlanLimit('maxBiomarkers')`, and both biomarker-ingesting upload routes are gated (`uploadRoutes.ts:88,139`); the OCR/upload insert path additionally truncates the batch to the cap in-handler (`upload/shared.ts`). The gate is per-request, so the documented batch overshoot of `batchSize-1` remains — confirm and report that residual, but the "NEVER enforced / unlimited by direct entry" claim no longer holds.
- [ ] `providerSharing` is **no longer a paid/locked feature**: it is now `true` on every tier (FREE/PRO/TEAM) by an explicit 2026-06-01 product decision — consent-based sharing of one's own data is a patient right, not paywalled (`plans.ts:54-59` FREE with the product-decision comment, `:78`/`:97` PRO/TEAM). No route calls `requirePlanFeature('providerSharing')`, and that is now *intentional* (ungated like `dataExport`), not a gap. Confirm the flag is `true` on all tiers and report it as a deliberate non-gate rather than a missing enforcement.
- [ ] `requirePlanLimit` runs only after `authenticate` on every route that uses it — verify each route file calls `router.use(authenticate)` (or `requireBearerAuth` for `aiRoutes`) before the gate, so an unauthenticated request can't slip past the `if (!userId) next()` bail-out (`planGating.ts:45`).
- [ ] The `if (!userId) next()` bail-out cannot be reached on a route that is meant to be authenticated (i.e. it never fronts a public route) — confirm no gated route is missing its auth middleware.

### 2. Tier Source of Truth & Self-Elevation
- [ ] `users.plan` can be written by exactly one realized path: the admin endpoint `PATCH /api/v1/admin/users/:id/plan` (route at `adminRoutes.ts:598-599`; the `tx.user.update` write at `:621`), which is behind `requireRole('ADMIN')` + `blockDemoAdminAccess` (`adminRoutes.ts:30-31`) and runs under `withRLSContext(null, { isAdmin:true })`. Confirm no other writer exists.
- [ ] No self-service endpoint writes `plan`: confirm `settingsController` (PATCH `/settings/profile`, `/notifications`, `/health-profile`) does NOT accept or persist a `plan` field, and that no Zod settings schema includes `plan`. (The only `plan` enum in `validation.ts` is `schemas.admin.updateUserPlan:899` — admin-scoped.) Cross-link [[30-admin-security]] for the prevent-self-role-elevation analogue (same threat class: a user must not be able to raise their own entitlement).
- [ ] The admin plan change is audited with before/after state (`auditService.logUpdate('admin_user_plan', …)` at `adminRoutes.ts:656`, plus a separate `logAccess` at `:643`) — confirm `previousPlan`/`newPlan` (`:666-667`) and the acting admin id are captured (see [[05-audit-logging]]).
- [ ] Mass-assignment check: the admin update uses an explicit `data: { plan, planExpiresAt, planUpdatedAt }` (no `...req.body` spread) at `adminRoutes.ts:623-627` — confirm no controller spreads request body into a `user.update` in a way that could let `plan` ride along from a non-admin route.
- [ ] `req.user.plan` (from the JWT, `auth.ts:118`) is treated as an untrusted stale snapshot: confirm the gate reads the DB (`planGating.ts:66`) and, on a DB error, fails CLOSED to FREE rather than trusting the JWT (catch block `:76-88`). Assess the posture: during a DB outage a recently-downgraded *and* a legitimately-paid user are both held to FREE limits — confirm this fail-closed choice is the intended trade-off (deny premium during the outage, never reopen it).
- [ ] `normalizePlan` defaults unknown/garbage plan strings to `FREE` (`plans.ts:103`) — confirm an injected/corrupt VARCHAR value cannot escalate (it fails *down*, never *up*). The VARCHAR (vs DB enum) choice means the DB itself does not constrain the value; `normalizePlan` is the only guard.

### 3. Limit-Counting Correctness & Clock/Reset Semantics
- [ ] Audit-row counting is correct: `aiChatsPerDay`/`aiGuidancePerDay` count `AuditLog` rows by `resourceType` (`'HealthGuide'` / `'biomarker_ai_guidance'`) + `action='READ'` (`usageTracker.ts:69-91`). Confirm the writer controllers emit exactly these `resourceType` strings (`aiChatController`; the `biomarker_ai_guidance` READ rows are written at `biomarkerRoutes.ts:154`, `:187`, `:284`) — a string drift silently under-counts and lets the limit be exceeded. (Cross-check the same sync warned about in [[27-ai-integration]] §8.)
- [ ] Audit-row counting cannot be deflated by failed/blocked calls: confirm a *blocked* AI call (e.g. the BAA gate `GUIDANCE_BLOCKED_NO_BAA` refusal at `biomarkerRoutes.ts:147-149`) writes a different `operation`/`resourceType` so it isn't miscounted as a successful use — and conversely that a *successful* use is always logged so it IS counted.
- [ ] Window math: `startOfTodayUTC` / `startOfMonthUTC` (`usageTracker.ts:41-50`) define per-day and per-month windows in **UTC**. Confirm this is intended (a user near a UTC day boundary gets the reset at midnight UTC, not local time) and that the same window is used consistently for counting and for the `PlanSection` "today"/"this month" labels (`PlanSection.tsx:29-36`).
- [ ] Clock-manipulation resistance: the window is computed server-side from `new Date()` (`usageTracker.ts`), not from any client-supplied timestamp — confirm no request field influences the count window, so a user cannot reset their daily/monthly quota by manipulating their clock or request body.
- [ ] KNOWN GAP — unlimited tiers (`-1`) skip the count query entirely (`checkPlanLimit` short-circuits at `usageTracker.ts:144`), so a PRO/TEAM user has **no per-request cap** on AI endpoints. The only bound on an unlimited tier is the **dollar budget** in `aiSpendGuard` (`AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD`, 503 on breach). Confirm every AI route that allows an unlimited tier also carries `aiSpendGuard` BEFORE the handler — otherwise an unlimited account is unbounded. Cross-link [[42-ai-cost-control]].
- [ ] `getUserUsage` runs all counts in one `withRLSContext` transaction (`usageTracker.ts:60`) so the numbers are mutually consistent and RLS-scoped — confirm it never falls back to a bare `prisma.*` call (which would miss `SET LOCAL app.current_user_id` and return zero rows under the NOBYPASSRLS role, *under-counting to zero and disabling the limit*). Same RLS-context trap flagged in `CLAUDE.md`.
- [ ] Off-by-one: the check is `allowed: current < limitValue` (`usageTracker.ts:153`) — confirm this is the intended boundary (the Nth use is allowed, the N+1th is blocked) and matches the message `(${current}/${limit})` shown to the user.
- [ ] The gate's pre-check vs the action: the limit is checked in middleware *before* the action runs, and the usage row (audit log / DB row) is written *during/after* the action. Confirm there's no double-counting and no race where two concurrent requests both pass the `current < limit` check (TOCTOU) — assess whether the limit can be exceeded by N concurrent requests.

### 4. Billing Path / Realized-Revenue Gap (KNOWN GAP — do not soften)
- [ ] Confirm there is **no payment integration**: grep `stripe`, `webhook`, `billing`, `checkout`, `payment` across `backend/src/` and `src/` — expect only comments/TODOs (`plans.ts:6`, `migration.sql:9`, `planRoutes.ts:9`, `PlanSection.tsx:7,162`). Report that displayed prices (`PLANS[*].price`/`annualPrice`) are decorative and tie to no charge.
- [ ] Document the gap between displayed prices and actual entitlement changes: a user can see "$9.99/mo Pro" but the "Upgrade" button only fires `onError('Upgrades are not available yet…')` (`PlanSection.tsx:163`). There is no way for a user to actually pay for or self-activate a paid tier.
- [ ] Document how `users.plan` is set **today**: manually, via the admin endpoint (`adminRoutes.ts:598-599`) or a direct DB update (per the `plans.ts:5` comment). Confirm the admin endpoint is the only application path and is properly RBAC-gated.
- [ ] Future-Stripe-webhook risk surface (record now so it isn't missed when wired): a webhook that writes `users.plan` will be an **unauthenticated, internet-facing, entitlement-granting** endpoint. Note the controls it MUST have when added: Stripe signature verification, idempotency, and writing the same `plan`/`planExpiresAt`/`planUpdatedAt` columns the admin path uses. Flag if any partial/unguarded webhook scaffolding already exists.
- [ ] `planExpiresAt` enforcement is request-time only (`planGating.ts:73`); no scheduled job downgrades `plan` itself — `emailScheduler.ts` only *reads* it (lines `374,376,386,409,413`) to send an expiry warning. Confirm an expired paid user is correctly limited on every gated route (request-time downgrade) even though their `plan` column still says `PRO`/`TEAM`, and that `planRoutes.ts` reporting reflects the effective (expired→FREE) limits or clearly shows the expiry.

### 5. Error Shape & Frontend CTA Contract
- [ ] The gate returns **HTTP 403** with `code:'PLAN_LIMIT_EXCEEDED'` and the `{ limit, current, feature, upgradeRequired }` fields (`planGating.ts:104`). Confirm the status is 403 (not 402/429) and that none of the extra fields leak anything sensitive (see [[32-error-handling]] which flags these extra fields as intentional).
- [ ] A blocked plan request is distinguishable by the client from a rate-limit (**429**) and a spend-cap / BAA refusal (**503 SERVICE_UNAVAILABLE**): confirm `isPlanLimitError` (`client.ts:55`) narrows strictly on `code==='PLAN_LIMIT_EXCEEDED'` AND presence of `planLimit`, so a 429/503 never renders the upgrade CTA.
- [ ] The client maps the body into `apiError.planLimit` (`client.ts:356-363`) and the SSE chat path re-parses it off the streaming 4xx body (`ai.ts:135`) — confirm both surfaces (REST + SSE) build the same `planLimit` shape so the upgrade CTA renders consistently.
- [ ] `PlanSection.tsx` consumes the *usage* endpoint (`planApi.getCurrentPlan`) to draw bars; the per-action 403 drives the inline upgrade prompt elsewhere (`LabConnectionsSection.tsx:178` via `isPlanLimitError`; `HealthGuidePage.tsx:30` treats `PLAN_LIMIT_EXCEEDED` as a terminal SSE code). Confirm a gated 403 never falls through to the generic "Forbidden" toast (`client.ts:97`).
- [ ] The "Upgrade" CTA is honest about the unwired billing path: `PlanSection.tsx:163` shows "Upgrades are not available yet. Contact us…" rather than dead-ending in a broken checkout. Confirm no UI element implies a working purchase flow.

### 6. Demo Accounts & Feature-Flag Alignment
- [ ] Demo vs plan interaction: AI routes stack `blockDemoAI` alongside the plan gate (e.g. `aiRoutes.ts:33-34`). Confirm `blockDemoAI` (`demoProtection.ts:81`) returns **403 ForbiddenError** for the demo account *independently* of plan — a demo account must be blocked from AI even if its `plan` column were elevated, and the demo block is a hard 403 (not a separate quota). Confirm ordering doesn't matter for the outcome (either guard refusing is sufficient).
- [ ] Feature flags in `plans.ts` align with what routes actually gate: `questFhirIntegration` (`plans.ts:28`) is enforced at `fhirRoutes.ts:34,59` ✔; `healthProfile` (`plans.ts:25`) at `settingsRoutes.ts:80` ✔. Confirm the FHIR feature flag and the route gate use the same key, and cross-link [[41-fhir-lab-integration]] for the lab-connection specifics. Confirm the §1 reconciliations hold: the numeric limits `insurancePlans` and `maxBiomarkers` are NOW enforced (middleware + in-handler M12/M13 gates), and `providerSharing` is `true` on all tiers and deliberately ungated (a patient right, like `dataExport`) — neither is an enforcement gap anymore.
- [ ] `dataExport` is `true` on every tier by design (`plans.ts:60`, comment: "HIPAA requires this regardless of plan") — confirm the export route (`settingsRoutes.ts:86`) is correctly NOT gated, so a downgraded user can still exercise their HIPAA right of access (see [[29-data-portability]]). This is a *correct* absence of a gate, not a gap.
- [ ] `healthProfile` GET is intentionally ungated (`settingsRoutes.ts:66`) while PATCH is gated (`:76`) — confirm a downgraded user can still read/export what they previously saved but cannot write new profile data, matching the comment at `settingsRoutes.ts:74`.

## Verification Commands
```bash
# Every place the plan gate is applied (routes) vs. where it's defined
grep -rn "requirePlanLimit\|requirePlanFeature" backend/src/routes/
grep -rn "requirePlanLimit\|requirePlanFeature" backend/src/middleware/planGating.ts

# Which limits/features are gated — diff against the PlanLimits keys in plans.ts
grep -n "aiChatsPerDay\|aiGuidancePerDay\|pdfUploadsPerMonth\|maxBiomarkers\|insurancePlans\|costAnalysisPerMonth\|healthProfile\|providerSharing\|dataExport\|questFhirIntegration" backend/src/config/plans.ts
# ...then confirm each PAID one appears as a requirePlanLimit/Feature arg in a route:
grep -rn "requirePlanLimit('maxBiomarkers')\|requirePlanLimit('insurancePlans')" backend/src/  # NOW ENFORCED (M21/M12 maxBiomarkers on biomarker create/batch + uploads; M20/M13 insurancePlans on plan create + activation re-check) — expect HITS
grep -rn "requirePlanFeature('providerSharing')" backend/src/  # expect ZERO hits — providerSharing is intentionally UNGATED (true on all tiers; consent-based sharing of one's own data is a patient right, not a paid feature), NOT a gap

# Every writer of users.plan (should be ONLY the admin endpoint)
grep -rn "plan:\|planExpiresAt\|planUpdatedAt" backend/src/controllers/ backend/src/routes/ | grep -i "update\|create\|data:"
grep -rn "\.user\.update" backend/src/  # then confirm none spreads req.body into the plan column

# Confirm NO payment integration exists (expect only comments/TODOs)
grep -rni "stripe\|webhook\|checkout\|billing\|payment" backend/src/ src/

# Usage-counting resourceType strings must match the audit writers
grep -rn "HealthGuide\|biomarker_ai_guidance" backend/src/services/usageTracker.ts backend/src/controllers/ backend/src/routes/

# Error-shape: the 403 code and the frontend narrowing
grep -rn "PLAN_LIMIT_EXCEEDED" backend/src/middleware/planGating.ts src/services/api/

# The unlimited-tier short-circuit (no per-request cap → only the $ budget bounds it)
grep -n "isUnlimited\|aiSpendGuard\|isAISpendExceeded" backend/src/services/usageTracker.ts backend/src/middleware/aiSpendGuard.ts

# planExpiresAt enforcement (request-time only; scheduler just reads it)
grep -rn "planExpiresAt" backend/src/middleware/planGating.ts backend/src/schedulers/
```

## Questions to Ask
1. `maxBiomarkers` and `insurancePlans` are NOW hard limits (middleware gate + the in-handler M12 truncation / M13 activation re-check). The remaining question is the *residual* overshoot: the per-request batch gate still admits `batchSize-1` over the cap, and concurrent requests can race the `current < limit` check (TOCTOU) — is that residual overshoot acceptable for these caps, and should the activation re-check / batch truncation be tightened to an atomic reservation?
2. `providerSharing` is now `true` on all tiers by the 2026-06-01 product decision (consent-based sharing of one's own data is a patient right, like `dataExport`), so the consent routes are deliberately ungated. Confirm the product still wants this ungated on FREE and that no UI implies it is a paid-only feature.
3. How is `users.plan` set in production today — only via the admin `PATCH /users/:id/plan`, or also by direct DB edits? Is there an audit trail for the direct-edit path?
4. There is no Stripe/billing integration. When it lands, will its webhook write the same `plan`/`planExpiresAt`/`planUpdatedAt` columns the admin path uses, with signature verification + idempotency? Is any partial webhook scaffolding already present and unguarded?
5. Is the UTC day/month reset boundary intended, and is it communicated to users (a user in UTC-8 sees their "daily" AI quota reset at 4pm local)?
6. For unlimited (PRO/TEAM) tiers, the *only* bound is the in-memory dollar budget in `aiSpendGuard`. Is that an acceptable ceiling given the per-instance accumulator under Cloud Run autoscale (effective N×budget), or does an unlimited tier need a hard request cap too? (See [[42-ai-cost-control]].)
7. On a DB error the gate now fails CLOSED to FREE limits (`planGating.ts:76-88`), explicitly NOT trusting the JWT. This means a legitimately-paid user is denied premium during a DB outage. Is that fail-closed posture the intended trade-off (never reopen premium on a transient error), and is the user experience during an outage acceptable?
8. Can two concurrent requests both pass the `current < limit` check before either writes its usage row (TOCTOU), letting a finite limit be exceeded by the number of in-flight requests? Is that acceptable for the cost-bearing limits?

## Cross-links
- [[27-ai-integration]] — AI guard stack (`aiLimiter` → `aiSpendGuard` → `blockDemoAI` → `requirePlanLimit`), resourceType sync for usage counting
- [[09-external-apis]] — the external integrations behind the gated routes (Anthropic, Document AI, Quest FHIR); does not itself audit the plan gate
- [[42-ai-cost-control]] — dollar-budget circuit breaker that bounds unlimited tiers
- [[41-fhir-lab-integration]] — `questFhirIntegration` feature gate specifics
- [[30-admin-security]] — admin plan-change endpoint + prevent-self-elevation analogue
- [[08-rate-limiting]] — 429 path, distinct from the 403 plan gate
- [[05-audit-logging]] — `admin_user_plan` PLAN_CHANGE audit events
- [[32-error-handling]] — `PLAN_LIMIT_EXCEEDED` 403 body + frontend code mapping
- [[29-data-portability]] — why `dataExport` is correctly ungated across tiers
- [[11-environment-secrets]] — `AI_DAILY_BUDGET_USD` / `AI_USER_DAILY_BUDGET_USD` (and future Stripe secret) handling
- [[02-encryption]] — PHI fields that the gated routes read/write (see [_phi-inventory](./_phi-inventory.md))
