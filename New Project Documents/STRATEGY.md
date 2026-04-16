# OwnMyHealth Strategy

**Last Updated:** 2026-04-16 (skeleton — sections marked **TBD** need user input; run prompt `14-strategy-doc.md`)

---

## Mission Statement

**TBD** — 1 paragraph. From prompt 14 §Mission & Vision: what problem is OwnMyHealth solving, for whom, and why the current market doesn't solve it well enough.

---

## Core Principles

Derived from `CLAUDE.md` — confirm with user:

1. **Privacy-first** — PHI encrypted at rest (AES-256-GCM, per-user keys) and in transit (TLS 1.3).
2. **User owns their data** — full export, delete-data, delete-account flows are non-negotiable.
3. **Consent-first sharing** — provider access only via explicit, time-limited patient consent.
4. **AI is educational, not diagnostic** — every Claude-generated response carries medical disclaimers.
5. **HIPAA compliance by design** — 7-year audit log retention, BAAs with cloud/AI vendors, minimum-necessary data access.
6. **No surveillance-style telemetry** — no third-party analytics that see PHI.

---

## Product Strategy

### OwnMyHealth (this project)
**Status:** Pre-beta — feature-complete in core domains (biomarker tracking, insurance management, expense tracking, provider collaboration, AI guidance).
**Validation path:** **TBD** — target validation users, conversion metrics, feedback loop.

**Core feature map:**
| Feature | Status |
|---|---|
| Biomarker tracking (manual + OCR + Claude extraction) | Shipped |
| DEXA scan support | Shipped |
| Insurance plan management (SBC upload, comparison, benefit search) | Shipped |
| Expense tracking (projections, actuals, cost analysis) | Shipped |
| Health goals + progress tracking | Shipped |
| Health needs tracking | Shipped |
| Provider-patient collaboration (consent-based) | Shipped |
| AI biomarker guidance (Claude) | Shipped |
| File management (GCS + signed URLs) | Shipped |
| Admin panel + audit log viewer | Shipped |
| Demo account (dev / beta) | Shipped |
| DNA / Genetics | **Deprecated** — schema retained, UI removed |
| Health scoring (0-100) | Removed Jan 2026 |
| CMS Marketplace integration | Removed Jan 2026 |
| Provider directory | Removed Jan 2026 |

### HealthcareProviderDB (sibling project — confirm with user)
Separate repo at `C:\Users\breil\OneDrive\Desktop\HealthcareProviderDB`. Per user memory, this is an active Phase-5/6 effort focused on verified provider data for NY. **Relation to OwnMyHealth:** **TBD** — does it feed provider data into OwnMyHealth, or remain independent?

### AI Integration Strategy
- **Use cases:** biomarker guidance (educational), cost analysis (optimization), SBC extraction (insurance docs), lab report extraction (PDF → biomarkers).
- **Provider:** Anthropic Claude API (verify exact model IDs in `backend/src/services/claudeExtraction.ts`).
- **PHI defense-in-depth:** `stripPHIFromText()` + data minimization + `aiLimiter` rate limiting + per-call cost tracking (`aiCostTracker.ts`).
- **Anthropic BAA status:** **TBD — critical gate for HIPAA production launch.**
- **Positioning:** AI is *educational differentiator*, not the core product. If Anthropic becomes unavailable, the core biomarker/insurance/expense flows still function.

### Provider Collaboration Strategy
- Workflow: provider requests access → patient approves with granular permissions → time-limited scoped access.
- **Target workflow (TBD):** patient-initiated vs provider-initiated? B2C vs B2B2C revenue model?
- **EHR integration:** **TBD** — FHIR support on roadmap? Out of scope?

---

## Business Model

### Pricing Tiers
**TBD** — from prompt 14 §Business Model. Suggested structure to fill in:

| Tier | Price | Features | Storage | AI calls/mo |
|---|---|---|---|---|
| Free | $? | ? | ? | ? |
| Pro | $? / mo | ? | ? | ? |
| Family | $? / mo | ? | ? | ? |

### Unit Economics
**TBD** — need monthly cost per user and target margin. Key variable costs:
- Cloud Run CPU-seconds (backend).
- Cloud SQL (scales with user count + data size).
- GCS storage + egress (lab reports, SBCs — bounded per user).
- Claude API spend per user (biomarker guidance + cost analysis + SBC extraction).
- SendGrid (negligible at current volumes).
- Document AI (OCR fallback — per-page cost).

### Break-even
**TBD** — at pricing of $X/mo Pro, need N paying users to cover fixed + variable costs.

---

## Decision Log (confirmed from codebase + CLAUDE.md)

| Date | Decision | Rationale / evidence |
|---|---|---|
| 2026-01-02 | Migrate from AWS ECS → GCP Cloud Run | Commit `44511b4`. |
| 2026-01-07 | Add Row-Level Security policies | Migration `20260107_add_rls_policies`. Defense-in-depth on top of application-layer checks. |
| 2026-01-07 | Remove DNA / Genetics UI | Commit `241cdd2`. Kept schema models pending decision to fully drop. |
| 2026-01-07 | Remove CMS Marketplace + Provider Directory | Commit `fb0590d`. Net -3,500 lines. |
| 2026-01-07 | Remove Health Scoring | Commit `cd545f7`. Replaced with "Biomarkers in Range %" ratio. |
| 2026-01-08 | Replace pdf-parse extraction with Claude API for biomarkers | More robust on messy lab PDFs. |
| 2026-01-10 | Encrypt all expense monetary fields as strings, not Decimal | Migration `20260206_fix_expense_encryption_types`. |
| 2026-02-06 | Add PHI redaction before Claude calls | `stripPHIFromText` — defense-in-depth even with BAA. |

### Alternatives considered / rejected
**TBD** — e.g., AWS HealthLake vs roll-our-own, supabase vs direct Postgres, OpenAI vs Claude (BAA considerations).

### Pivots
**TBD** — any major strategy shift since inception?

---

## Timeline & Milestones

### Near-term (TBD — run prompt 14)
- [ ] **Beta launch target date:** ?
- [ ] **Anthropic BAA signed:** ?
- [ ] **First validation cohort:** ? users
- [ ] **Pricing page published:** ?

### Mid-term
- [ ] **First paying user:** ?
- [ ] **Break-even:** ?
- [ ] **SOC 2 Type I (if pursued):** ?

### Long-term
- [ ] **Full-time transition target:** ?

---

## Risks

### Top identified (confirm priorities with user)

| Risk | Probability | Impact | Mitigation in place | Gap |
|---|---|---|---|---|
| Anthropic BAA never signed → cannot legally send PHI → feature loss | Medium | High | `stripPHIFromText` minimizes PHI exposure; core features work without AI | Need vendor alternative (BAA-capable LLM) scoped |
| Claude API cost runs away | Medium | Medium | `aiLimiter`, `aiCostTracker.ts` | Budget alerts at GCP billing level — verify set |
| Solo-founder bus factor | High | Critical | Audit logs + backups ensure continuity | Documentation, grant admin to trusted 2nd party |
| OneDrive corruption of local dev state | High | Low | `patch-next-swc.js` workaround; node_modules issues noted | — |
| Storage-level PHI breach (GCS bucket misconfig) | Low | Critical | Uniform bucket access, signed URLs | Infrastructure-as-code review for bucket ACLs |
| HIPAA audit finds gap in technical safeguards | Medium | High | See `HIPAA_CHECKLIST.md` | Formal risk assessment not yet completed |
| Subscriber churn from lack of EHR integration | Unknown | Medium | — | Validate demand first, then decide |

**Additional risks TBD** — run prompt 14 §Risks.

---

## Strategic Reminders

1. **Security is product**, not overhead. Every feature ships with PHI encryption + audit logging before release.
2. **AI is a feature**, not the product. The platform survives Anthropic outages.
3. **User-owned data is a marketing differentiator**, not just compliance. Export + delete must be visible and frictionless.
4. **Solo-founder scope discipline:** every new feature is scored against "does this delay beta?"

---

## Sections to fill in by running prompt 14

Open `prompts/14-strategy-doc.md` and answer the Q&A prompts. Each **TBD** above maps to a specific section:

- Mission Statement → §Mission & Vision Q1–Q4
- Pricing Tiers → §Business Model Q1
- Unit Economics → §Business Model Q2
- Break-even → §Business Model Q3
- HealthcareProviderDB relation → §Product Strategy Q1–Q4
- Timeline → §Timeline & Milestones Q1–Q4
- Additional risks → §Risks Q2–Q3
