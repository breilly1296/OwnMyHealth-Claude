# OwnMyHealth — Demo-to-Market-Ready Product Checklist (D2C)

> **Verdict up front.** OwnMyHealth has an A-/B+ *security and data-integrity core* (per-user AES-256-GCM field encryption, FORCE Row-Level Security, audit logging, BAA-gated AI), but its own UX review calls it a *"polished demo, not yet a trustworthy daily health record."* It is **not yet a sellable direct-to-consumer product**: there is no way to take money, no mobile experience, no MFA, no breach detection, and known plaintext-PHI residue in production. This checklist is the path from that demo to a trustworthy, *paid* consumer daily health record. It holds **no certifications** today — only the Anthropic BAA is signed. Nothing below assumes HIPAA, SOC 2, or HITRUST is "in place," because none of them are.
>
> **Scope:** pure direct-to-consumer. This is an individual-sign-up, member-owned product. There is no employer, broker, or benefits channel anywhere in this plan.

---

## How to read this checklist

| Tier | Meaning | Gate |
|---|---|---|
| **P0** | Trust / safety / legal blockers. Cannot charge a single consumer until these close. | Before **any** paying user |
| **P1** | Needed for a credible *public* launch — the D2C growth and trust machinery. | Before public launch / scale |
| **P2** | Post-launch hardening and accepted residuals you've already chosen to defer. | After first cohort |

Each item states the **gap**, **why it blocks a consumer launch**, and a **"done when…"** acceptance criterion. External numbers are grounded in the research brief and labeled `(estimate)` / `(illustrative)` where they are inferences rather than measured facts.

---

## P0 — Trust / Safety / Legal blockers (close before ANY paying consumer)

### P0-1. No self-serve billing (Stripe) — you cannot collect revenue
- **Gap:** Plans are **display-only**. `config/plans.ts` carries FREE ($0), PRO ($9.99/mo, $99/yr), TEAM ($19.99/mo, $199/yr) in cents, explicitly commented *"display only, no billing,"* and the prices self-described as "Placeholder." The Upgrade button in `PlanSection.tsx` is a literal stub that fires a toast: *"Upgrades are not available yet. Contact us to upgrade manually."* (`// TODO: wire to Stripe checkout`). Plan assignment is admin-only or direct DB edit. There is **zero Stripe code** — no SDK, no webhook, no checkout.
- **Why it blocks a consumer launch:** A D2C product with no checkout is a free demo, not a business. There is no path to acquire a paying customer at scale, and a fake "Upgrade" CTA that resolves to "email support" actively burns trust at the exact moment of purchase intent. Plan *limits are already enforced at runtime* (`planGating.ts` reads the plan fresh from DB, honors `planExpiresAt`, fails closed to FREE) — so users genuinely hit walls today with no way to pay through them.
- **Done when:** a consumer can self-serve subscribe to PRO/TEAM via **Stripe Checkout**; a verified webhook updates `users.plan` + `planExpiresAt`; cancel / downgrade / failed-payment / lapse transitions are handled and reconciled against the existing `planExpiresAt → FREE` logic; receipts/invoices are emailed; and the `PlanSection.tsx` placebo handler is replaced by a live checkout redirect. Annual plans are offered first-class (the brief's profit/retention lever: ~68% annual adoption, 40–60% better retention).

### P0-2. No verified self-serve data export & deletion
- **Gap:** `dataExport` and account deletion are ungated "by design," but the prior UX review flagged Settings/Files surfaces as partly placebo, and there is **no documented, end-to-end-verified** "download all my data" + "delete my account" journey a consumer can complete unaided.
- **Why it blocks a consumer launch:** For a pure consumer PHR, export/deletion are not nice-to-haves — they are *legally required and the single biggest trust signal*. **CCPA/CPRA** grant access/delete/export rights and treat health data as Sensitive Personal Information; **Washington's My Health My Data Act** grants a right to delete and carries a **private right of action** (first class action filed Feb 2025); Nevada SB 370 adds parallel rights. These bind a web-only consumer app *now*. A consumer who can't take their labs and leave will not trust you to hold them.
- **Done when:** a logged-in consumer can (a) one-click export a complete, decrypted, human-readable archive of all PHI (biomarkers + history, insurance, goals, files), and (b) self-initiate account deletion that cascades, **destroys the per-user salt** (rendering encrypted PHI unrecoverable), **and hard-deletes any legacy plaintext rows the salt does not cover** (the P0-6 `original_filename` residue and any pre-rotation ciphertext per P2-5) — each with an email confirmation and an audit row, proven by a manual run-through, not merely route existence.

### P0-3. No MFA and no proven account-recovery path
- **Gap:** "MFA TBD." Auth has password + lockout + reset email and revokes token families on email/password change, but there is **no second factor**.
- **Why it blocks a consumer launch:** This account *is* the user's medical record and insurance member IDs. Account takeover = a direct PHI breach, which for a consumer health startup is existential — *trust is the product; one breach or FTC action ends the company* (brief, hard truth #3). Security-conscious consumers expect at least optional TOTP on a health account.
- **Done when:** TOTP (authenticator-app) MFA can be enabled by a consumer, is enforced on login and on sensitive operations (export / delete / email change), backup recovery codes exist, and a tested recovery flow restores access **without a human in the loop**. MFA reset revokes token families like the existing email/password flows.

### P0-4. No breach-detection alerting (the FTC/breach clock can't start)
- **Gap:** This is self-identified as the *most urgent gap*: nothing notifies a human when an anomaly occurs. The forensic substrate exists (immutable 7-yr encrypted audit log), but **detection** — the legally load-bearing half — does not.
- **Why it blocks a consumer launch:** As a non-HIPAA consumer PHR that *also* pulls FHIR, OwnMyHealth meets the **FTC Health Breach Notification Rule** "multiple sources" test → **HBNR is the primary federal obligation**. The 2024 HBNR amendments (effective Jul 29 2024) require notice **≤60 days** after discovery and **expanded "breach" to include unauthorized *disclosure*** (e.g., an ad/analytics tracker firing on health data — the GoodRx/BetterHelp/Premom/Flo failure mode). Penalties run up to **~$53,088 per violation** (2025 inflation-adjusted; re-indexed annually), and each affected individual/day can count separately. You cannot meet a 60-day clock you have no way to start.
- **Done when:** Cloud Logging alert policies fire on audit-log anomalies, repeated `LOGIN_FAILED`, and the RLS boot-guard FATAL exits, routing to an on-call human; a **named Security Officer** exists; and a breach-response runbook (HBNR ≤60-day notice; simultaneous FTC notice at 500+ individuals; notice naming third-party recipients) lives in `RUNBOOK.md`.

### P0-5. Vendor BAAs unconfirmed for the services that actually hold PHI
- **Gap:** Only **Anthropic's BAA is confirmed signed**. Google Cloud (Cloud Run / Cloud SQL / GCS + Document AI), Quest, and SendGrid are all "TBD." **SendGrid is not HIPAA-eligible and won't sign a BAA.** Code *gates* on flags but cannot prove a contract exists.
- **Why it blocks a consumer launch:** Your database (Cloud SQL), file store (GCS), and OCR (Document AI) all hold or process raw PHI. Even though HIPAA generally does *not* apply to a consumer-controlled PHR, the moment provider/FHIR data flows create a Business-Associate path, these vendor relationships are load-bearing — and the FTC §5 precedent (GoodRx $1.5M, BetterHelp $7.8M) means *any* unauthorized health-data sharing through an unvetted vendor is direct enforcement exposure.
- **Done when:** signed BAAs for Google Cloud (infra + Document AI) are on file and dated; SendGrid is **either** confirmed PHI-free in all templates **or** swapped to a HIPAA-eligible provider (e.g., Paubox/LuxSci per the brief); the Quest/FHIR data agreement is in place before FHIR is enabled in prod; and **no ad/analytics SDK or pixel fires on any health-data screen** (the #1 HBNR/§5 enforcement vector).

### P0-6. Legacy plaintext PHI residue still in production
- **Gap:** `user_files.original_filename` is still **plaintext in prod**. New uploads encrypt and reads fall back, but the `backfill-userfile-filenames` job has **not been run** and the plaintext column not dropped. Self-rated **High (compliance)**.
- **Why it blocks a consumer launch:** Raw client filenames routinely embed identity — `JohnSmith_DEXA_1980.pdf`. Shipping to paying consumers with *known* unencrypted PHI at rest is a compliance gap you've already flagged as High, and it directly undercuts the "fully encrypted" trust claim.
- **Done when:** the maintenance job runs in prod (DRY RUN → `--apply`), all legacy `original_filename` rows are encrypted/nulled, and a follow-up migration drops the plaintext column. (Retract any stale "fully encrypted" / "Last Audit Jan 2025 / 0 findings" README claims at the same time — overstated trust claims are themselves §5 liability.)

### P0-7. AI/OCR dollar cost is uncapped on the Document AI path (H-3)
- **Gap:** **H-3** — Google Document AI OCR dollars are **never recorded** against the AI budget (`ocrService.ts` has no `trackAIUsage`). The $50/day circuit-breaker bounds only Claude tokens. This is the only *High* still open on the cost line.
- **Why it blocks a consumer launch:** The moment billing opens to the public, a malicious or runaway user can drive **unbounded OCR spend** bounded only by request *counts*, not dollars — a direct path to a surprise five-figure GCP bill and a self-inflicted DoS on a solo-founder budget. This collides head-on with the brief's hard truth #1 (brutal CAC, thin margins): an uncapped variable cost can erase the unit economics of every acquired user.
- **Done when:** Document AI page cost is estimated and accrued via `trackAIUsage` (or a Document-AI-specific tracker) so it counts against `AI_DAILY_BUDGET_USD` and per-user budgets, **failing closed with 503** like the Claude path.

### P0 summary

| # | Blocker | Done-when (one line) |
|---|---|---|
| P0-1 | No Stripe billing | Self-serve Checkout + webhook updates `plan`/`planExpiresAt`; annual offered |
| P0-2 | No verified export/delete | One-click export + self-serve delete that destroys per-user salt **and** purges legacy plaintext rows, audited |
| P0-3 | No MFA / recovery | TOTP + backup codes + human-free recovery, enforced on sensitive ops |
| P0-4 | No breach alerting | Cloud Logging alerts → on-call human; named Security Officer; HBNR runbook |
| P0-5 | BAAs unconfirmed | GCP/Document AI BAAs on file; SendGrid PHI-free or swapped; no trackers on PHI |
| P0-6 | Plaintext filename PHI | Backfill job run; plaintext column dropped; stale claims retracted |
| P0-7 | Uncapped OCR spend (H-3) | Document AI dollars tracked + fail-closed against the budget |

---

## P1 — Needed for a credible public launch (the D2C machinery)

### P1-1. Web-only — no mobile app / PWA for a daily-habit product
- **Gap:** The stack is a **web-only** React + Vite SPA served from GCS. There is **no PWA** (no manifest, no service worker, no `vite-plugin-pwa`/Workbox — `public/` holds only `favicon.svg`), **no native app**, and **no push notifications of any kind** (zero web-push / FCM / service-worker references). Responsive web *is* reasonably thorough (viewport meta; ~223 `md:` / 107 `sm:` Tailwind classes; a focus-trapped mobile drawer), so it works in a phone *browser* but behaves as a mobile website, not a daily-habit app.
- **Why it blocks a credible launch (not P0):** A "daily health record" lives or dies on phone access and re-engagement. Native apps see materially higher engagement and ~90-day retention than web `(estimate; vendor-sourced, directional)`, and **web-push reach on iOS is ~10–15× smaller than native and only works after a manual "Add to Home Screen"** — the single biggest retention handicap for a web-only health app. This caps activation and retention but does not legally block a first paying cohort, so it is P1.
- **Done when:** an **installable, offline-capable PWA** ships (manifest + service worker + web push + an "add to home screen" coaching prompt fired *after* a value moment), the core log / track / upload flows pass real-device mobile testing, and a decision is recorded on native iOS for v2 — noting that **Apple App Store guideline 5.1.1(v) requires in-app account deletion** and HealthKit is native-only, and that Google Play's Jan-2026 rules now require a verified Organization account + D-U-N-S for health apps. (None of these store rules bind today, because the app has no App Store / Play presence — they gate a *future* native build, not the web launch.)

### P1-2. SPA edge security headers missing
- **Gap:** The static SPA from GCS emits **no CSP / X-Frame-Options / HSTS at the edge**; only the API origin carries Helmet headers. In-app frame-busting only.
- **Why it blocks a credible launch:** Clickjacking/framing defense on the page a consumer actually loads is expected of a security-marketed health product and is a visible gap in any third-party security or privacy review (e.g., a Mozilla *Privacy Not Included*-style audit).
- **Done when:** the Cloud CDN / load-balancer serves CSP, `X-Frame-Options: DENY` (or `frame-ancestors 'none'`), and HSTS on the SPA origin.

### P1-3. Multi-instance seams force `--max-instances=1` (H-2)
- **Gap:** In-memory stores (AI spend accumulator, FHIR PKCE verifier map, access-token blacklist, rate-limit store) are per-process unless `REDIS_URL` is set. **H-2** (FHIR connect breaks across instances) forces pinning `--max-instances=1`; the spend cap dilutes N× and rate limits/token revocation degrade beyond one instance.
- **Why it blocks a credible launch:** You **cannot autoscale** to absorb a launch spike without either breaking FHIR or diluting your cost cap — and an uncapped cost cap is dangerous (see P0-7). Provisioning Redis is the single fix that unblocks autoscale, exact spend caps, and reliable FHIR.
- **Done when:** Cloud Memorystore/Redis is provisioned, `REDIS_URL` set, the `--max-instances=1` pin removed, and FHIR connect + spend cap + rate limits verified correct across ≥2 instances.

### P1-4. Onboarding / activation loop is thin and partly placebo
- **Gap:** A 4-step onboarding wizard ships (welcome → upload lab → health profile → done) and **email verification is hard-gated at login** (a real funnel choke point with no "explore first" path). Prior teardowns flagged trust-breakers that *look* functional but weren't — a **placebo OCR review step**, a **dead registration-verification funnel**, **health-goal create returning 422**, and onboarding GET-routes that write data. These are **reported remediated per the changelog but remain unverified end-to-end** (the central honesty caveat of this whole checklist). Time-to-first-value is strong *only if* the user has a lab PDF handy; an empty account shows a bare "upload your labs" empty state with no sample data, and lab auto-sync is **Quest-only and PRO-gated**.
- **Why it blocks a credible launch:** D2C conversion is won or lost in the first session, and the brief's monetization data is blunt — placing the paywall at the user's stated-goal "aha" and driving **3+ meaningful sessions in the first 14 days** is the single strongest churn predictor `(FACT, Adapty 2026)`. Placebo steps in onboarding are trust-killers exactly where trust is being established.
- **Done when:** the funnel is walked end-to-end on a fresh account with **every step verified to do real work** (OCR review actually edits extracted values; goal-create persists; verification gates correctly), a no-PDF user has a real first-value path (sample/demo state or manual-entry quick win), and an **activation metric** is instrumented (e.g., "added first biomarker within session 1").

### P1-5. No retention / re-engagement loop a consumer actually feels
- **Gap:** A competent **email lifecycle engine** ships (`emailScheduler.ts`: weekly summary, goal reminders, out-of-range alerts, new-results, plan-expiring — preference-gated, multi-instance idempotent) — this is the *primary and only* retention loop. There is **no push/PWA notification**, **no streaks/gamification**, and **no viral loop** (see P1-6). Email is the weakest channel for a web-only app.
- **Why it blocks a credible launch:** Health & fitness apps see **~3% Day-30 retention** and ~9.2% monthly churn `(FACT, brief)`; a "daily" record with only an email nudge will churn after week one. Annual plans retain far better — roughly **33% vs 17% at one year** `(FACT, Adapty 2026, via brief)` — but only if the user reaches the value moment first.
- **Done when:** at least one re-engagement loop tied to the daily-record use case is reliable and de-duplicated across instances (e.g., "new lab synced," "you haven't logged in N days," weekly trend summary), respects notification preferences, and is measured against a D7/D30 retention metric. A **longitudinal "what's new in your trend" hook** is the durable retention engine for a record app — and the biomarker time-series substrate (`biomarkerSeries.ts`, latest + `BiomarkerHistory[]`) is structurally in place to power it.

### P1-6. No virality — zero referral / invite, sharing is inbound-only
- **Gap:** **No referral / invite / "refer a friend" / promo-code system exists** (confirmed zero matches in the codebase). Provider sharing is **inbound-only** — a provider must request access and the patient approves; a patient cannot generate a share link or invite their own doctor or family. The "TEAM" tier is positioned "for families and caregivers" but there is **no family/multi-member account model or invite flow** — it's just higher numeric limits on one account.
- **Why it blocks a credible launch:** The brief's growth thesis is explicit — paid acquisition is dangerous (CAC up 40–60% 2023→2025; ~$30–60 per paying subscriber `(estimate)`), so growth must be **organic / referral / content-led**. Word-of-mouth is the dominant channel for the category leaders (Flo, Function), and a double-sided referral can drive 10%+ of signups (Whoop `(FACT, brief)`). With no viral loop, the product *cannot grow itself* and the family/TEAM pitch is undeliverable.
- **Done when:** a **double-sided, activation-gated** referral program ships (reward unlocks when the referred user activates, not on install), shareable via WhatsApp/SMS-native share sheets; **and** a patient-initiated share path exists (invite your doctor/family, or a scoped share link) so the TEAM/family positioning is real. Instrument K-factor.

### P1-7. Zero test coverage on the newest consumer-facing subsystems
- **Gap:** `aiChatController`, `fhirController`, `fileController`, `labUploadController`, `sbcUploadController` have **no tests** — exactly the upload / AI / FHIR paths a consumer touches most, and exactly where prior teardowns found the real bugs ("cores solid, weakness in the SEAMS").
- **Why it blocks a credible launch:** Shipping *paid* features with no regression net invites a trust-breaking data bug (e.g., the documented contract-drift class where the frontend sends one field and the backend silently strips it).
- **Done when:** controller/route tests cover the lab + SBC upload, AI chat, FHIR, and file-download paths per `TESTING_PATTERNS.md`, including the cross-HTTP-boundary contract-drift class of bugs.

### P1-8. No automated error/anomaly monitoring (no observability SDK)
- **Gap:** **No observability SDK** — no Sentry/Datadog/OpenTelemetry; logging is stdout → Cloud Logging only. (Distinct from P0-4's *security* alerting — this is *product* error/latency/crash visibility.)
- **Why it blocks a credible launch:** With real paying users you must know when checkout, upload, or sync breaks *before* a consumer emails you. Silent failures in the purchase or activation flow directly destroy the unit economics you paid CAC to acquire.
- **Done when:** error/crash monitoring (e.g., Sentry) and basic uptime/latency alerting are wired for **both** frontend and backend, with a triage runbook.

### P1-9. Consumer legal & marketing trust surface is unbuilt
- **Gap:** There is **no public pricing/landing page** (`getAvailablePlans()` exists and the endpoint is public, but **no component consumes it** — the app is fully login-walled). The README still carries a stale *"Last Audit: January 2025 / 0 findings"* marketing header. No evidence of a published consumer **Privacy Policy**, **Terms of Service**, the **separate Consumer Health Data Privacy Policy** that Washington MHMDA and Nevada SB 370 *require*, **AI medical-advice disclaimers**, or consent flows.
- **Why it blocks a credible launch:** A D2C health product needs a public privacy posture *before* it takes money. MHMDA/SB 370 mandate a **standalone consumer-health-data privacy policy** and separate opt-in consents; **"we never sell your data" is legally enforceable** post-GoodRx/HBNR — only claim it if the architecture guarantees it. Stale/overstated audit claims are themselves §5 liability. There is also no surface to *acquire* a logged-out visitor.
- **Done when:** a public marketing/pricing surface ships (consuming the existing `/plan/available`), a **Privacy Policy + ToS + standalone Consumer Health Data Privacy Policy** are published, **AI "not medical advice / consult a professional" disclaimers** are present and matched by actual product behavior, README trust claims are accurate and dated, and the committed pricing + primary persona are decided so the funnel can be built. *(SOC 2 / HITRUST are optional trust signals for a consumer audience — not launch gates; do not budget them as blockers.)*

### P1 summary

| # | Item | Done-when (one line) |
|---|---|---|
| P1-1 | Web-only, no PWA/push | Installable offline PWA + web push + real-device mobile pass |
| P1-2 | No edge headers | CSP + X-Frame-Options + HSTS on the SPA origin |
| P1-3 | `--max-instances=1` (H-2) | Redis provisioned; pin removed; verified across ≥2 instances |
| P1-4 | Placebo onboarding | Every step verified real; no-PDF first-value path; activation metric live |
| P1-5 | Thin retention loop | ≥1 reliable re-engagement loop measured on D7/D30 |
| P1-6 | No virality | Double-sided referral + patient-initiated sharing; K-factor instrumented |
| P1-7 | Untested seams | Upload/AI/FHIR/file controllers covered |
| P1-8 | No product monitoring | Sentry + uptime/latency alerting, FE + BE |
| P1-9 | No legal/marketing surface | Public pricing + Privacy/ToS/CHD policy + AI disclaimers + accurate claims |

---

## P2 — Post-launch (hardening, optimization, accepted residuals)

### P2-1. Quota TOCTOU race (L34/L36) — atomic reservation
- **Gap:** Plan-limit and AI-quota checks are count-then-allow; concurrent requests can overshoot by N-1. Documented and accepted, backstopped by the dollar cap.
- **Why P2:** Self-identified as low-value to fix now; bounded by the dollar cap and small concurrent-request windows. Becomes relevant only if a hard plan-limit SLA is sold. *(Note: once Redis lands per P1-3, the dollar-cap backstop becomes exact, which further de-risks this.)*
- **Done when:** usage is reserved atomically in the same RLS transaction as the write (`UPDATE … WHERE n < :limit RETURNING n`) or via a DB constraint/trigger.

### P2-2. CSP still allows `'unsafe-inline'` styles
- **Gap:** Helmet CSP permits inline `<style>` because of Tailwind/runtime injection; nonce-based CSP not wired.
- **Why P2:** Style-injection hardening, not an active exploit; lower priority than the *missing* edge headers (P1-2).
- **Done when:** per-request nonce middleware threads a nonce into `index.html` + React style injection and `'unsafe-inline'` is removed from `styleSrc`.

### P2-3. Transitive dependency advisories
- **Gap:** `npm audit` reports 1 high (`hono`, not app-reachable) + 8 moderate (`uuid` chain via `@google-cloud/storage`); none reachable as deployed attack surface.
- **Why P2:** None exercised by the running app; the `uuid` fix needs a breaking `@google-cloud/storage` major.
- **Done when:** non-breaking `npm audit fix` clears `hono`; the `uuid` major is taken on a controlled `@google-cloud/storage` upgrade (hold the auto-merge).

### P2-4. FHIR sync has no outbound page/spend budget (L-13)
- **Gap:** A single authorized FHIR sync can fetch unbounded pages; bounded by request count, not work/dollars.
- **Why P2:** Feature is off by default and plan-gated PRO/TEAM; upstream provider-rate-limited. Fold in when FHIR goes GA for consumers.
- **Done when:** `labSyncService.syncLabResults` enforces a page/byte budget.

### P2-5. PBKDF2 key-rotation debt + runbook
- **Gap:** Iteration count isn't stored per-ciphertext (try-current-then-legacy fallback); "leaks nothing" but is a migration artifact. No key-rotation runbook. (Note: the legacy-fallback ciphertext is also the residue the P0-2 deletion flow must hard-delete.)
- **Why P2:** No security impact today; cleanup + operational readiness.
- **Done when:** iteration count is stored per envelope, the legacy fallback is removed after a full re-encrypt, and a key-rotation runbook exists.

### P2-6. Administrative policy set + DR/IR SOPs
- **Gap:** Written security-management policy, formal risk analysis, sanction policy, training, DR/backup plan, and break-glass SOP do not exist. *(The breach-response SOP + named Security Officer are pulled forward into P0-4 because the HBNR clock depends on them.)*
- **Why P2:** The *technical* safeguards are in place; the remaining *paperwork* is a maturity/trust item, not a first-paying-user blocker. These are also the artifacts you'd need if you ever pursue SOC 2/HITRUST as a *trust signal* — but per the thesis, those are not launch gates for a consumer audience.
- **Done when:** policies, incident-response SOP, DR/backup plan, and break-glass procedure are authored, stored, and on a review cadence.

---

## Operational readiness (cross-cutting — must accompany the first paying cohort)

The moment you take money, you take on operational obligations a demo never had. These pair tightly with P0-4 (security alerting) and P1-8 (product monitoring) but are broken out because they are *organizational*, not just code.

| Capability | Gap today | Done when… | Tier |
|---|---|---|---|
| **Monitoring & alerting** | Stdout→Cloud Logging only; no SDK | Sentry (FE+BE) + Cloud Logging alert policies on errors, latency, and security anomalies | P0-4 / P1-8 |
| **On-call** | No rotation; solo dev | A defined on-call path (even a single-person escalation + paging) so a payment/upload/breach event reaches a human fast | P1 |
| **Status page** | None | A public status page (or lightweight uptime page) so paying users see incidents instead of emailing | P1 |
| **Support channel** | "Contact us to upgrade manually" is the *only* documented support path | A real support inbox/help surface with a triage SLA `(illustrative)`, separate from the (soon-removed) manual-upgrade hack | P1 |
| **Incident/breach runbook** | None | HBNR-compliant breach runbook (≤60-day notice; FTC at 500+; name third-party recipients) + named Security Officer in `RUNBOOK.md` | P0-4 |
| **Backups & restore drill** | DR/backup plan not authored | Cloud SQL automated backups verified by a **tested restore**, with documented RPO/RTO `(illustrative)` | P1 / P2-6 |
| **Cost guardrails** | $50/day cap bounds only Claude; OCR uncapped (H-3); no GCP budget alert | OCR dollars tracked (P0-7) **and** a GCP billing budget + alert as a backstop against runaway spend | P0-7 |

---

## Bottom line

The engine is genuinely strong; the **commercial and consumer-trust surface is unbuilt**. Close the **seven P0s** — Stripe billing, verified export/delete, MFA/recovery, breach alerting + Security Officer, confirmed BAAs (and no trackers on PHI), the plaintext-filename backfill, and the uncapped OCR cost path — and you can responsibly charge a first cohort. Close the **P1s** — PWA + push, Redis-for-autoscale, real (non-placebo) onboarding, a felt retention loop, an actual referral/sharing growth loop, test coverage on the upload/AI/FHIR seams, product monitoring, and the consumer legal/marketing surface — for a credible public launch. Everything in **P2** is hardening you've already chosen to defer.

Two honesty anchors to keep front-of-mind: this product is a *"polished demo, not yet a trustworthy daily health record"* until the P0s and the onboarding/retention P1s are *verified end-to-end* — the changelog reports the known trust-breakers fixed, but none of those fixes are confirmed in production — and it holds **no certifications**; the only signed agreement is the Anthropic BAA. Sell on the defensible wedge — **understand your health *and* what your care will cost, in one private, member-owned record** — not on a chatbot that was commoditized in January 2026, and never on compliance you don't yet have.
