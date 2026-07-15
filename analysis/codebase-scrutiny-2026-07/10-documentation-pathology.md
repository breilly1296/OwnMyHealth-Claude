# 10 — Documentation Pathology

---

## Scale

Rough inventory:

- ~**120** markdown files under docs / prompts / security / New Project Documents
- ~**24K** lines of markdown
- Extensive prompt set (`prompts/00`–`46`+) for generating and refreshing docs
- Multiple security assessments under `security/assessment-*/`
- GTM pack under `New Project Documents/Go-To-Market/`

This is both an **asset** and a **tell**.

---

## What is excellent

- File:line citation culture in many “New Project Documents”
- PHI taxonomy, env vars, runbook, routing table, financial tracker structure
- Security assessments with adversarial verification language
- GTM readiness checklist that is more honest than marketing tone
- Known-issues ledger with evidence blocks

For a solo/AI-assisted project, documentation volume is exceptional.

---

## Pathologies

### 1. Severity contradiction

| Source | High open? |
|--------|------------|
| `SECURITY_STATUS.md` | Claims **0** open High |
| `KNOWN_ISSUES.md` | Lists **H-1, H-2, H-3** |

Until reconciled, neither is fully trustworthy as a sole ledger.

### 2. Snapshot lag

Many docs freeze at a specific HEAD (e.g. `fb2cd32`, 2026-06-15). Useful for forensics; dangerous if treated as live posture without re-verification.

### 3. Audit theater risk

Prompt-driven multi-agent “full security teardown” output can create the *appearance* of enterprise readiness while P0 product blockers remain (billing, MFA, OCR $, BAAs).

**Rule:** Docs must not outrun shippable product truth.

### 4. Comment + doc double counting

Closed findings re-explained in source comments *and* multiple markdown reports. Noise raises the cost of finding the three things that still matter.

### 5. Overclaim adjacency

Security-grade language near “HIPAA-compliant / PASS” style claims sits next to docs that correctly deny certifications. Readers (investors, users, regulators) may only see the gloss.

---

## Recommended documentation hygiene

1. **One open-findings ledger** — severity + status + owner + evidence. Everything else links to it.
2. **Product readiness checklist is P0** — GTM P0 list should gate public claims.
3. **Date + HEAD stamp** on every security status refresh; archive old assessments by folder (already partly done).
4. **Stop regenerating** full doc sets until P0 engineering closes; prefer surgical updates.
5. **Public language guide** — forbid “HIPAA certified / fully compliant” without named framework + evidence.

---

## Relationship to this analysis folder

This `analysis/codebase-scrutiny-2026-07/` set is intentionally **opinionated and critical**. It may disagree with internal grade labels. When it does, treat the disagreement as a **signal to reconcile sources**, not as noise.
