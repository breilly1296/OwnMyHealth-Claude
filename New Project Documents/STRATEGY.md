# OwnMyHealth Strategy

**Last Updated:** 2026-02-06
**Status:** DRAFT -- Generated from codebase analysis. Sections marked [NEEDS INPUT] require founder review and input.

---

## Mission Statement

OwnMyHealth empowers individuals to take full ownership of their health data through a privacy-first, HIPAA-compliant platform that unifies biomarker tracking, insurance document management, expense optimization, and provider collaboration. By combining military-grade encryption with AI-powered educational insights, OwnMyHealth gives users the tools to understand their health metrics, navigate insurance complexity, and share data with providers on their own terms -- without ever compromising privacy.

## Core Principles

1. **Privacy is non-negotiable** -- All protected health information (PHI) is encrypted with AES-256-GCM using per-user derived keys. The platform operates under HIPAA-compliant data handling at every layer, including Row-Level Security at the database level.
2. **User owns their data** -- Users can export and delete their data at any time. No data is held hostage. Provider access is granted only through explicit, time-limited, granular consent.
3. **AI is educational, never diagnostic** -- Claude AI provides informational health guidance and insurance analysis, clearly labeled as educational content with disclaimers. The platform never provides medical advice.
4. **Consent-first sharing** -- Provider access to patient data requires explicit patient-initiated consent with granular permissions (biomarkers, insurance, health needs) and expiration controls.
5. **Security in depth** -- JWT + refresh tokens, CSRF protection, rate limiting, input validation (Zod), audit logging with 7-year retention, demo account isolation, and role-based access control (RBAC).

## Product Strategy

### OwnMyHealth (Primary Product)

**Status:** Active development, pre-launch
**Description:** A comprehensive health data management platform targeting health-conscious individuals who want to track, understand, and share their health data securely.

**Core Feature Modules:**

| Module | Status | Description |
|--------|--------|-------------|
| Biomarker Tracking | Built | Manual entry, lab upload extraction, history, trends, normal ranges, 130+ biomarker types across 20+ categories |
| DEXA Scan Support | Built | Upload and track bone density measurements (T-Score, Z-Score, BMD, lean mass, visceral fat) |
| AI Biomarker Guidance | Built | Claude Haiku 4.5 provides educational insights on biomarker values, what they mean, and lifestyle factors |
| Insurance Management | Built | SBC document upload with Claude Sonnet extraction, plan comparison, benefit search, comprehensive coverage detail tracking |
| Expense Tracking | Built | Projected expenses, actual claims/EOBs, deductible/OOP tracking, AI-powered cost optimization analysis via Claude Sonnet 4.5 |
| Health Goals | Built | Goal tracking with progress notes, history, target values, milestone tracking, reminder frequencies |
| Health Needs | Built | Track conditions, actions, services, follow-ups with urgency levels and status tracking |
| Provider Collaboration | Built | Consent-based provider-patient data sharing with granular permissions per data type |
| File Management | Built | Lab report upload (PDF parsing + OCR via Google Document AI), GCS storage, signed URL downloads |
| Admin Panel | Built | User management, audit log viewer, system health statistics |
| Data Export/Deletion | Built | HIPAA-compliant data export and right-to-deletion support |

**Target User Profile:**
- Health-conscious individuals managing chronic conditions (with emphasis on osteoporosis/bone health management based on DEXA scan features)
- Patients who want to consolidate lab results from multiple providers
- Individuals managing complex insurance plans who need help understanding coverage and optimizing costs
- Patients who want to securely share health data with their healthcare providers

**Validation Path:** [NEEDS INPUT] -- What is the current validation status? User interviews completed? Waiting list? Beta testers?

### HealthcareProviderDB

**Status:** TBD -- Appears to be a separate project at `C:\Users\breil\OneDrive\Desktop\HealthcareProviderDB` (separate monorepo with Next.js 14.2 + Express + Prisma + PostgreSQL). A "Provider Directory" feature was listed as removed from OwnMyHealth in January 2025.

**Open Questions:**
- [NEEDS INPUT] Is HealthcareProviderDB still actively being developed?
- [NEEDS INPUT] Is it intended to be a standalone product or feed data into OwnMyHealth?
- [NEEDS INPUT] What is the relationship between HealthcareProviderDB's provider directory and OwnMyHealth's provider collaboration feature?
- [NEEDS INPUT] Was the removal of Provider Directory from OwnMyHealth a pivot away from directory features, or a separation of concerns into HealthcareProviderDB?

### Ecosystem Hypothesis

[NEEDS INPUT] -- How do OwnMyHealth and HealthcareProviderDB connect? Possible model: HealthcareProviderDB serves as the provider discovery layer while OwnMyHealth handles the ongoing patient-provider data sharing relationship, but this needs founder confirmation.

### AI Integration

**Role:** AI is a core differentiator woven throughout the product, not a supplemental feature. Claude AI powers three distinct capabilities:

| AI Capability | Claude Model Used | Purpose | Cost Tier |
|---------------|-------------------|---------|-----------|
| Biomarker Guidance | claude-haiku-4-5 | Educational insights on individual biomarker values (max 600 tokens/request) | Low |
| SBC Document Extraction | claude-sonnet-4 | Parse insurance SBC PDFs into structured plan data (max 16,384 tokens/request) | Medium |
| Lab Report Extraction | claude-haiku-4-5 | Extract biomarkers from lab report PDFs (max 8,192 tokens/request) | Low |
| Cost Analysis | claude-sonnet-4.5 | Generate insurance expense optimization recommendations (max 4,000 tokens/request) | Medium |

**Cost Controls in Place:**
- Haiku model used for high-frequency, lower-complexity tasks (biomarker guidance, lab extraction)
- Sonnet models reserved for complex document understanding (SBC extraction, cost analysis)
- Max token limits set per endpoint to control per-request costs
- Rate limiting applied at API level (6 named rate limiters)

**Anthropic BAA Status:** [NEEDS INPUT] -- Has a Business Associate Agreement been signed with Anthropic for HIPAA-compliant AI processing? This is critical for production launch with real PHI.

**Disclaimer Implementation:**
- AI guidance UI labeled as "Educational" with badge
- Footer disclaimers on all AI-generated content: "For educational purposes only. Discuss results with your healthcare provider."
- AI responses are stripped of redundant disclaimer text via frontend regex patterns before display
- Product guidelines explicitly state: "AI is educational -- Claude responses are informational, not diagnostic"

### Provider Collaboration Strategy

**Current Implementation:**
- Patient-initiated consent model -- patients invite providers and set granular permissions
- Granular permission controls per data type: biomarkers, insurance, DNA, health needs, edit access
- Relationship types: Primary Care, Specialist, Consultant, Emergency, Other
- Consent lifecycle: Pending -> Active -> Suspended/Revoked/Expired
- Time-limited consent with expiration dates

**Open Questions:**
- [NEEDS INPUT] How important is provider-patient collaboration to the initial launch vs. future roadmap?
- [NEEDS INPUT] Is provider-initiated access planned (e.g., provider invites patient)?
- [NEEDS INPUT] Are there plans for EHR integration? (DataSourceType enum includes EHR_IMPORT and DEVICE_SYNC but these appear unimplemented)
- [NEEDS INPUT] Is consent management a potential revenue lever (e.g., providers pay for access)?

## Business Model

### Pricing Tiers

**Status:** DRAFT -- Pricing details need founder input.

| Tier | Price | Features |
|------|-------|----------|
| Free | $0/month | [NEEDS INPUT] -- Likely: manual biomarker entry, basic tracking, limited AI guidance requests |
| Pro | [NEEDS INPUT]/month | [NEEDS INPUT] -- Likely: unlimited AI guidance, lab report upload + extraction, SBC parsing, cost analysis, provider sharing, full export |
| Family/Team | [NEEDS INPUT] | [NEEDS INPUT] -- Schema supports family deductible/OOP tracking, suggesting family features are planned |

**Evidence from codebase:**
- No paywall or subscription middleware currently exists in the codebase
- No Stripe, payment, or billing integration detected
- The application appears to provide full features to all authenticated users currently
- [NEEDS INPUT] What is the planned gating mechanism for free vs. pro features?

### Unit Economics

[NEEDS INPUT] -- The following cost drivers can be estimated:

| Cost Driver | Estimated Per-User Cost | Notes |
|-------------|------------------------|-------|
| Cloud SQL (PostgreSQL) | TBD | Shared instance, cost scales with storage (encrypted PHI is larger) |
| Cloud Run (Backend) | TBD | Pay-per-request model, scales to zero |
| Cloud Storage (Files) | ~$0.02/GB/month | Lab reports, SBC PDFs |
| Anthropic API (Haiku) | ~$0.001-0.01/request | Biomarker guidance, lab extraction |
| Anthropic API (Sonnet) | ~$0.01-0.10/request | SBC extraction, cost analysis |
| Google Document AI (OCR) | ~$0.065/page | Scanned lab reports only |
| SendGrid (Email) | ~$0.001/email | Verification, password resets |

**Key concern:** AI API costs scale linearly with usage. Without a pro tier paywall, heavy users could drive significant costs.

- [NEEDS INPUT] What is the target gross margin?
- [NEEDS INPUT] What is the estimated break-even user count?
- [NEEDS INPUT] Is there a plan to rate-limit AI features on the free tier?

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Pre-2025 | React + Vite over Next.js for frontend | Lighter weight SPA, simpler deployment to GCS bucket, avoids SSR complexity for a health data app |
| Pre-2025 | Express over Hono/Fastify for backend | Mature ecosystem, extensive middleware support, TypeScript compatibility |
| Pre-2025 | Google Cloud Platform over AWS/Azure | [NEEDS INPUT] -- GCP chosen for Cloud Run, Cloud SQL, Cloud Storage, Document AI |
| Pre-2025 | Anthropic Claude over OpenAI GPT | [NEEDS INPUT] -- Claude used for all AI features; likely chosen for document understanding quality and/or BAA availability |
| Pre-2025 | Per-user encryption keys via PBKDF2-SHA512 | HIPAA compliance requires encryption at rest; per-user keys ensure breach of one user's key doesn't expose all data |
| Pre-2025 | PostgreSQL RLS (Row-Level Security) | Database-level access control as defense-in-depth beyond application-layer checks |
| Jan 2025 | Removed Health Scoring feature | 0-100 health scores and risk assessments removed -- possible regulatory/liability concern with scoring health |
| Jan 2025 | Removed CMS Marketplace Integration | healthcare.gov plan search removed -- scope reduction or API reliability issues |
| Jan 2025 | Removed Provider Directory | Doctor search and recommendations removed -- possibly moved to HealthcareProviderDB or deprioritized |
| [NEEDS INPUT] | DNA/Genetics features deprecated | Models remain in schema but not in UI -- decision to deprecate needs documentation |
| [NEEDS INPUT] | [NEEDS INPUT] | Any major pivots or strategy changes should be documented here |

## Milestones

### Completed (Inferred from Codebase)
- [x] Core authentication system (JWT + refresh tokens + CSRF)
- [x] PHI encryption layer (AES-256-GCM + per-user keys)
- [x] Row-Level Security implementation (migration dated 2026-01-07)
- [x] Biomarker tracking with 130+ measurement types
- [x] DEXA scan support (bone density, body composition)
- [x] Lab report upload with Claude AI extraction
- [x] Insurance SBC upload with Claude AI extraction
- [x] Expense tracking with AI-powered cost analysis
- [x] Health goals and health needs tracking
- [x] Provider-patient consent management
- [x] Admin panel (user management, audit logs)
- [x] CI/CD pipeline (GitHub Actions -> Cloud Run + GCS)
- [x] Email verification and password reset (SendGrid)
- [x] HIPAA audit logging with 7-year retention
- [x] Data export and account deletion

### Q1 2026
- [NEEDS INPUT] What are the quarterly goals?
- [ ] [NEEDS INPUT] Beta launch target date?
- [ ] [NEEDS INPUT] User testing milestones?

### Q2 2026
- [NEEDS INPUT]

### Longer Term
- [NEEDS INPUT] Target date for going full-time?
- [NEEDS INPUT] Financial milestones being tracked?
- [NEEDS INPUT] Target date for production launch?

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| HIPAA violation / data breach | Low | Critical | AES-256-GCM encryption, per-user keys, RLS, audit logging, rate limiting, input validation, CSRF protection, security headers (Helmet) |
| Anthropic BAA not secured | [NEEDS INPUT] | Critical | If Anthropic won't sign BAA, PHI must not be sent to Claude API. Current lab extraction sends PDF content to Claude -- this MUST be addressed before production launch with real patient data |
| AI cost overruns | Medium | High | Model tiering (Haiku for cheap tasks, Sonnet for complex), token limits per request, rate limiting. Pro tier paywall would add financial gating |
| Single cloud provider dependency (GCP) | Low | High | All services on GCP (Cloud Run, Cloud SQL, GCS, Document AI). Multi-cloud migration would be expensive. Prisma ORM provides some database portability |
| Regulatory changes (HIPAA/state privacy laws) | Medium | High | Strong security foundation makes compliance adaptation easier. Audit logging already exceeds minimum HIPAA requirements |
| User adoption / product-market fit | [NEEDS INPUT] | Critical | [NEEDS INPUT] -- What validation has been done? |
| Competition from established health platforms (Apple Health, MyChart, etc.) | Medium | Medium | Differentiation through insurance management + AI cost analysis + privacy-first approach. Competitors don't combine biomarker tracking with insurance optimization |
| OneDrive sync corrupting development artifacts | Known | Low | WASM fallbacks used instead of native binaries; documented workaround in place |
| AI hallucination in medical context | Medium | High | Disclaimers on all AI content, educational framing, no diagnostic claims, guidance limited to well-known biomarker ranges |
| Founder solo risk (single developer) | [NEEDS INPUT] | High | [NEEDS INPUT] -- Is there a plan to bring on additional developers or co-founders? |

## Competitive Landscape

[NEEDS INPUT] -- The following is inferred from the product's feature set:

| Competitor | Strengths | OwnMyHealth Differentiator |
|-----------|-----------|---------------------------|
| Apple Health | Massive user base, device integration | Insurance management, AI cost analysis, provider sharing with granular consent |
| MyChart (Epic) | EHR integration, provider trust | User-owned data (not provider-owned), insurance optimization, cross-provider consolidation |
| PicnicHealth | Medical record aggregation | Privacy-first encryption, insurance management, AI biomarker guidance |
| Noom / health apps | Behavior change, large teams | Clinical biomarker focus, insurance cost optimization, HIPAA compliance |
| Spreadsheets | Free, flexible | Structured tracking, AI insights, encryption, provider sharing |

## Strategic Reminders

1. **Anthropic BAA is a launch blocker.** Sending real patient lab reports to Claude API without a signed BAA creates HIPAA liability. Confirm BAA status or implement a PHI-stripping layer before production launch.
2. **Revenue model must be defined before scaling.** The current codebase has no payment gating. AI API costs will scale linearly with users. Define and implement free/pro tier boundaries.
3. **DNA/Genetics models should be pruned or committed to.** Models remain in the Prisma schema but are deprecated in the UI. This creates maintenance burden and schema bloat. Decide: build it or remove it.
4. **The January 2025 feature removals tell a story.** Health Scoring, CMS Marketplace, and Provider Directory were all cut. Document the rationale -- these decisions shape the product's identity.
5. **EHR integration is hinted but not built.** The `DataSourceType` enum includes `EHR_IMPORT` and `DEVICE_SYNC`, but no implementation exists. These represent significant engineering effort if planned.
6. **Provider collaboration needs a go-to-market strategy.** The consent management system is sophisticated but requires providers to adopt the platform. How will providers be onboarded?
7. **The codebase is production-quality but the product is pre-launch.** Significant engineering has been invested in security, encryption, and compliance. The gap is in user validation, business model, and go-to-market.

---

*This document was generated as a DRAFT from codebase analysis on 2026-02-06. All sections marked [NEEDS INPUT] require founder review and input to complete the strategy.*
