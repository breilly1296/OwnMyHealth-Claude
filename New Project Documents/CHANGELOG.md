# OwnMyHealth Changelog

Derived from git log. Most recent at top. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

**Last generated:** 2026-04-16

---

## 2026-02-06 — Batch 3 security hardening

### Added
- **PHI redaction utility** (`backend/src/utils/phiRedaction.ts`) — strips SSN, MRN, phone, DOB, address patterns from text before sending to external AI services.
- **AI cost tracker** (`backend/src/services/aiCostTracker.ts`) — per-call accounting for Claude API spend.
- **`aiLimiter` attached to health goals / health needs** — previously only biomarkers/expenses had cost-control rate limiting.
- **Demo account restrictions** — demo users blocked from additional sensitive operations.
- **Project documentation bundle** — security audit docs, architecture, runbook.

### Fixed
- Prompt injection prevention on Claude-backed endpoints.
- CI lint/test failures introduced by Batch 3 changes.

### Changed
- Prompt library + `CLAUDE.md` brought in sync with actual codebase (prior drift).

---

## 2026-01-10 — Expense tracking & cost optimization

### Added
- **Expense tracking backend** — `ExpenseProjection`, `ExpenseActual`, `CostAnalysis` models with full PHI encryption (all monetary fields stored as `*Encrypted` strings, not Decimal — see migration `20260206_fix_expense_encryption_types`).
- **Expense tracking frontend** — projections UI, actuals ledger, cost-optimization view.
- **Re-analyze Plan feature** — rerun SBC extraction on existing insurance plan.
- **Out-of-network financial fields** — added to insurance plan schema.

### Fixed
- Crash in CostOptimization when API returns undefined.
- Insurance decryption 500 on legacy rows.
- AuthContext page-refresh bug: `getCurrentUser()` was called before `refreshToken()` — swapped order.
- CSRF configuration for insurance plan DELETE (exempted, uses Bearer token instead).
- Cloud SQL connection-timeout increase.

### Changed
- Cost displays use `--` instead of `$0` / `"No charge"` across insurance UI.

---

## 2026-01-09 — Insurance feature + dark mode + bundle optimization

### Added
- **Insurance feature** — Claude Sonnet-backed SBC (Summary of Benefits & Coverage) extraction, plan management, plan comparison.
- **Comprehensive insurance coverage fields migration** — deductibles, OOP max, copays, coinsurance, network tiers.
- **Dark mode default + login UI redesign.**
- **Mobile value proposition** on login page.
- **Advanced lipid markers + corrected reference ranges** (clinical verification pass).

### Fixed
- Reduced Claude API `max_tokens` to valid limit (previous value caused API rejection).
- Removed frontend PDF.js parsing from SBC upload (now server-side via Claude).
- Dashboard nav item sync with initial view.
- Account Settings button wiring.
- Health Score displays `—` when no biomarkers (instead of misleading 0).

### Changed
- **Dashboard refactor**: 1136 → 284 lines (75% reduction), infinite-loop fix.
- **Bundle size**: 895 KB → 78 KB initial (91% reduction via code splitting + lazy loading).
- **Removed DNA/genetics feature** (~1,500 lines removed from frontend; schema models retained for now — see CLAUDE.md "Deprecated").
- **Removed CMS Marketplace + provider directory** (~3,500 lines — deprecated features).
- **Removed health scoring + AI recommendations** (~3,000 lines; replaced with "Biomarkers in Range %" ratio).

### Security
- **SQL injection fix in RLS context** — parameterized `app.current_user_id` setter.
- Removed debug logging that could leak session info.

---

## 2026-01-08 — AI Health Guide + OCR + file repository

### Added
- **AI-powered biomarker guidance** (`POST /biomarkers/:id/guidance`) — educational, not diagnostic; uses Claude.
- **Trends page** with trend analysis.
- **Lab file repository** — list, download, delete uploaded lab reports.
- **Biomarker count badges** in sidebar categories.

### Fixed
- `ANTHROPIC_API_KEY` missing → graceful error (no startup crash).
- Anthropic SDK loaded via dynamic import to avoid startup crash.
- CORS preflight handling.
- Cross-domain auth cookie support (production frontend on GCS, backend on Cloud Run).
- CSRF token included in AI guidance API calls.

### Changed
- Replaced pdf-parse-based extraction with **Claude API extraction** for biomarker values (more accurate on messy lab PDFs).
- pdf-parse v1.x with correct import path as fallback.

---

## 2026-01-07 — Security hardening pass + RLS + settings

### Added
- **Row-Level Security (RLS) policies** migration `20260107_add_rls_policies` — PostgreSQL `user_id = current_setting('app.current_user_id')::uuid` on all user-owned tables.
- **Account Settings page** with dark mode.
- **Export All My Data** functionality.
- **Delete all data / delete account** flows.
- **Account lockout** (5 failed attempts → 30-min lockout).
- **Full mobile responsiveness** across app.
- **200+ biomarker patterns** across 24 categories (comprehensive extraction).
- **OCR for lab results** (Google Document AI).
- **PDF bomb DoS protection** — timeout + memory limits in secure PDF parsing.
- **Rate limiting** applied to all API endpoints (7 limiters: standard, auth, strictAuth, upload, sensitive, ai, bulkOperation).
- **Expanded audit logging coverage.**

### Security
- **IP spoofing via X-Forwarded-For** — audit logs now use secure `req.ip` with `trust proxy` set.
- **Log format-string injection** — explicit format strings in `logger.ts`.
- **Database error message leakage** — Prisma errors mapped to generic client messages.
- **Sensitive tokens cleared from URL** after reading (email verification, password reset).
- **Provider notes encrypted** before DB storage (`notesEncrypted` field).
- **SSRF + path traversal** in CMS Marketplace API (pre-removal hardening).
- **Request body removed from error logs** (was leaking PHI).
- **Accidentally committed service account key** — removed and added to `.gitignore`.

### Fixed
- `jspdf` upgraded to 4.0.0 (critical CVE fix).
- Removed `CONCURRENTLY` from migration indexes (incompatible with migration transactions).
- JSON credentials support in `GOOGLE_APPLICATION_CREDENTIALS`.
- Settings routes CSRF exempt (protected by Bearer token instead).

---

## 2026-01-02 — Deployment migration to GCP

### Changed
- **Migrated from AWS ECS to Google Cloud Run.**
- **Cloud Build** replaces Docker build step (async with polling).
- **Frontend deploys to GCS bucket** (`ownmyhealth-frontend`) instead of ECS.
- Hardcoded project ID / region for debugging — later parameterized.

### Added
- `package-lock.json` committed for reproducible CI builds.
- `base: './'` in Vite config for relative asset paths (GCS-hosted).

---

## 2025-12-17 — Pre-migration AWS setup

### Added
- AWS ECS deployment pipeline (later migrated to Cloud Run).
- Prisma migrations run on container startup.

### Pre-migration artifacts
- Removed Bolt configuration.
- Early version of security review prompts (now in `prompts/`).
- Comprehensive README.

---

## Removed (historical)

These features were in the product and have since been removed. Mentioned here so readers of old docs aren't confused:

- **Health Scoring (0–100 scores + risk assessments)** — Jan 2026. Replaced with "Biomarkers in Range %" ratio.
- **CMS Marketplace integration (healthcare.gov plan search)** — Jan 2026.
- **Provider Directory (doctor search / recommendations)** — Jan 2026.
- **DNA / Genetics UI** — Jan 2026. Schema models retained (`DNAData`, `DNAVariant`, `GeneticTrait`) pending decision to fully drop.

---

## Statistics (approximate, from commit history)

| Metric | Value |
|---|---|
| Commits in window | ~200 (since Dec 2025) |
| Major refactors | 5 (Dashboard split, bundle reduction, DNA/CMS/health-scoring removal, AWS→GCP) |
| Security fixes (labeled) | 12+ (see "Security" sections) |
| Feature releases | Insurance, Expense tracking, AI Health Guide, OCR, RLS |

---

*Next changelog refresh: after next release, or when the changelog becomes stale (>60 days of uncaptured commits).*
