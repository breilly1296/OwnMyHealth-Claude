# 04 — Security

---

## Posture summary (this scrutiny)

| Layer | Assessment |
|-------|------------|
| Authn / session / CSRF | Strong |
| Application encryption | Strong (with migration debt) |
| DB tenant isolation (RLS) | Strong |
| Cost / abuse controls | Mixed (Claude good; OCR weak) |
| Multi-instance security/availability | Incomplete without Redis |
| Consumer trust (MFA, breach detect) | Weak / missing |
| Doc consistency | Weak (severity contradiction) |

Core grade: **A-**  
Consumer-ship trust grade: **C+** (core + missing MFA/billing/ops detection)

---

## 1. What is legitimately good

- CSRF on state-changing routes (historical upload exemption removed)
- Cookie Secure / SameSite derivation with boot invariants
- PHI redaction helpers on AI streams; server-side AI disclaimer append
- Fail-closed Anthropic BAA gate when API key present
- Audit log design with long retention and encrypted metadata path
- Login anti-enumeration hardening (documented + tested)
- Secure PDF parsing guards on lab/SBC ingestion
- Historical Criticals closed (e.g. BYPASSRLS / FORCE RLS boot guards)

See [01-what-is-strong.md](./01-what-is-strong.md) for the fuller credit list.

---

## 2. Soft edges that still matter

| Issue | Honest severity | Why it matters |
|-------|-----------------|----------------|
| Document AI OCR dollars not accrued to AI budget (KNOWN H-3) | **High for business / cost DoS** | Claude capped; OCR only count-gated |
| Plan-limit check-then-allow TOCTOU (KNOWN H-1) | Medium–High correctness | Concurrent requests overshoot quotas |
| FHIR PKCE store per-process (KNOWN H-2) | High availability for feature | Connect fails under multi-instance |
| `tokensValidAfter` / stale check fail-open on DB error | Medium | Availability over security trade-off |
| CSP `style-src 'unsafe-inline'` | Medium hardening | XSS residual |
| SPA edge security headers missing on GCS origin | Low–Med | API Helmet ≠ frontend origin |
| Legacy plaintext filenames in prod until backfill | **Ops / compliance High** | Known residue |
| No MFA | Product / account takeover High for health data | Medical record = high-value account |
| No observability SDK (Sentry etc.) | Ops Medium | Harder anomaly / breach detection |
| SendGrid not HIPAA-eligible | Compliance Medium | PHI-in-email risk if templates slip |

---

## 3. Documentation fights itself

Observed contradiction:

| Document | Claim |
|----------|--------|
| `SECURITY_STATUS.md` | **0 open High**; grade A- |
| `KNOWN_ISSUES.md` | Open **H-1, H-2, H-3** |

That is not pedantry. **Severity inflation/deflation across docs destroys trust** with investors, auditors, and operators. Pick one severity rubric and one open-findings ledger.

Additional honesty risk:

- README / marketing-adjacent “HIPAA-compliant / PASS audit” tone
- GTM and security docs correctly stating **no SOC 2, no HITRUST, incomplete BAAs**

Overclaiming security is an FTC §5 / consumer-health enforcement risk, independent of technical quality.

---

## 4. Threat model gaps (product-level)

Even with a strong vault:

1. **Account takeover** without MFA remains the simplest path to PHI.
2. **Insider / admin paths** need continued least-privilege and audit review (admin surface is large).
3. **AI egress** is intentional PHI-to-Claude under BAA — residual minimization policy must stay explicit.
4. **Supply chain** — unmaintained `pdf-parse` accepted risk; transitive audit noise; pure-JS choice documented.
5. **Detection** — forensic substrate without detection does not start an HBNR 60-day clock reliably.

---

## 5. Security recommendations (ordered)

1. Single open-findings ledger; reconcile High severity across docs.
2. Accrue Document AI cost into fail-closed budget (close H-3).
3. Run filename backfill; drop plaintext column.
4. Ship TOTP MFA + recovery codes.
5. Provision Redis; shared rate limit + spend + PKCE.
6. Breach-detection alerts on audit anomalies + named owner + runbook.
7. Nonce-based CSP migration plan; SPA edge headers.
8. Confirm BAAs; eliminate non-BAA PHI email paths.

Detail sequencing: [11-priority-fix-list.md](./11-priority-fix-list.md).
