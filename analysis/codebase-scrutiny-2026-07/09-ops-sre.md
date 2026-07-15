# 09 — Ops & SRE

---

## What is in place

| Capability | Status |
|------------|--------|
| CI (lint, test, build, gitleaks, audit, RLS job) | Present |
| Deploy gated on CI | Present (`needs: ci` pattern) |
| Migrations as Cloud Run job (not boot-time) | Present |
| Structured logging | Present (stdout / Cloud Logging path) |
| Graceful shutdown hooks | Present in app lifecycle |
| Maintenance job workflow | Present for backfills |
| Scale-to-zero Cloud Run | Possible (no min instances by default) |

This is real deploy plumbing, not a laptop-only project.

---

## What is missing or incomplete

| Need | Status |
|------|--------|
| Redis / Memorystore for shared rate limit + AI spend + PKCE | Optional in code; likely required for honest multi-instance |
| Application APM / error tracking (Sentry, etc.) | **Not in package.json** |
| Breach detection / audit anomaly alerting | Documented as gap in GTM readiness |
| Named on-call / Security Officer path | Process gap more than code gap |
| OCR dollar circuit breaker | Missing (H-3) |
| Horizontal scale guarantees | Fragile without Redis + PKCE store |
| SPA edge security headers on GCS/CDN | Infra-only residual |
| Cost observability dashboards | Partial (Claude tracked in-app; OCR not) |

---

## Multi-instance truth table

| Component | Single instance | N instances without Redis | N instances with Redis |
|-----------|-----------------|---------------------------|-------------------------|
| Rate limits | OK | Soft (N×) | OK if wired |
| AI spend cap | OK | Soft (N×) | OK if wired |
| FHIR OAuth PKCE | OK | **Broken intermittently** | Needs shared store implementation |
| Access token blacklist map | Partial | Relies on DB mechanisms | Same |
| Email scheduler “last sent” stamps | DB-backed markers help | Better than pure memory | Prefer DB/Redis leases |

---

## Cost structure (ops lens)

Fixed-ish: Cloud SQL, GCS, domain, optional Redis.  
Variable: Claude tokens, Document AI pages, email volume, egress.

**Critical asymmetry:** Claude is dollar-capped; Document AI is not. Public launch without OCR $ caps is a self-inflicted billing incident waiting to happen.

See also `New Project Documents/FINANCIAL_TRACKER.md` and GTM financial model for unit economics framing.

---

## Ops recommendations

1. Treat Redis as **required** for staging/prod before `max-instances > 1` with FHIR or strict spend SLAs.
2. Add Sentry (or equivalent) + uptime checks + audit anomaly alerts.
3. Close OCR $ tracking before paid cohorts.
4. Run and verify maintenance backfills; track in runbook with last-run evidence.
5. Document incident response for HBNR-style breach clocks.
6. Configure SPA edge headers (CSP, XFO, HSTS) on frontend origin.
