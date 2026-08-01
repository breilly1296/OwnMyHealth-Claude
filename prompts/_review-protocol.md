---
tags:
  - meta
  - protocol
type: shared
priority: 1
updated: 2026-08-01
---

# Review Protocol (shared)

Every security / audit prompt in `01-13`, `26-32`, and `41-49` inherits this protocol. Keep it open (or reference it) while running any of those prompts.

---

## Read these two things first (2026-08-01)

Before you open a single source file, read:

1. **[`New Project Documents/OPEN_FINDINGS.md`](../New%20Project%20Documents/OPEN_FINDINGS.md)** — the **single authoritative ledger** of open security / compliance / cost / trust findings, and the **one severity rubric**. It was created 2026-07-11 to close scrutiny finding P0-6 (`SECURITY_STATUS.md` and `KNOWN_ISSUES.md` had contradicted each other). If this protocol, a prompt, or any generated doc disagrees with the ledger, **the ledger wins**.
2. **Its `## Posture` section** — the project's exposure model, which changed materially on 2026-07-14 (see below).

You are not reviewing a greenfield repo. You are adding to a triaged ledger.

---

## Current posture: sandbox, no GCP (declared 2026-07-14)

GCP billing was disabled ~2026-07-12. There is **no deployment target and no real users**; the
declared assumption is that all data ever stored was founder/test data. `STORAGE_BACKEND=local`
(AES-256-GCM-encrypted local disk) is the development default; the Cloud Run backend, Cloud SQL prod
database, and GCS buckets are suspended.

**What this changes for a review:**

- Exposure is "local sandbox, single process, founder-only data" — severity is impact × exposure
  **under this posture**, per the ledger's rubric.
- A control that only exists when deployed (GCS bucket ACLs, Secret Manager wiring, Cloud Armor,
  Cloud Logging sinks, signed-URL egress) is **not a live failure**. Report it as
  **Dormant (launch checklist)** with the severity it re-acquires at launch — do not report it as an
  open Critical/High. Inflating dormant infrastructure into live findings is precisely the "audit
  theater" called out in `analysis/codebase-scrutiny-2026-07/10-documentation-pathology.md:46-50`.
- Anything in **code** — encryption, RLS, authz, validation, cost control, correctness — is fully
  live and reviewed normally. The posture lowers *exposure*, not *code quality standards*.

**If any reactivation trigger has fired** — GCP billing re-enabled, the app deployed anywhere, any
non-founder PHI in any database, or the product made available to others — **stop and say so in your
output**. The sandbox framing in this protocol and in prompts 11/12/15/24/28/35/36 is invalid, every
dormant item reverts to its reactivation severity, and the review needs a re-triage first.

---

## Core rules

1. **No tick without evidence.** Do not mark a checklist item "passed" unless you can cite a `file:line` that proves it.
2. **No fabrication.** If you can't locate a file, constant, or function mentioned in the prompt, say so in the *Unverifiable* section — don't guess.
3. **Don't fix silently.** Report findings; wait for explicit instruction before editing code. A fix is a separate task.
4. **Assume the prompt may be stale.** Counts, file names, and environment variables in these prompts may drift from the live repo. When in doubt, trust the code.
5. **Use Claude Code tools, not Bash `grep`.** See [verification tools](./_verification-tools.md).
6. **Check the ledger before you report.** For every finding, search `OPEN_FINDINGS.md` for the same
   issue. If it is already there, cite the `OF-NN` id and report it as **known** — with a new
   observation only if you found something the ledger does not say (a wider blast radius, a second
   call site, a failed fix). Re-reporting a triaged finding as new is the "comment + doc double
   counting" pathology and it buries the items that still matter.
7. **Don't restate severities the ledger owns.** Your output links to `OF-NN`; it does not re-grade
   it. New findings get a severity from you (rubric below) and are proposed *for* the ledger.

---

## Severity rubric

The ledger's rubric is the one that counts. It is reproduced here so a first-pass triage of a **new**
finding lands close to where the ledger will put it. Severity = worst realistic impact × exposure
**under the current posture**, on a single scale regardless of class — a cost-DoS, an availability
break, or a compliance gap can be High; "not a classic vuln" is not a reason to downgrade.

| Severity | Criteria | Examples (under the sandbox posture) |
|---|---|---|
| **Critical** | PHI exposure or credential-compromise path exercisable **now** | Plaintext PHI written by a live code path, missing auth on a PHI endpoint, a live secret readable from the repo |
| **High** | Material harm likely on the current path — including a hazard that silently re-arms on a foreseeable event, or a core flow broken under normal ops | RLS bypass, IDOR across users, a dead-but-revivable cloud credential, refresh rotation broken for every user |
| **Medium** | Harmful under specific conditions; accepted races with backstops; missing detection | Missing rate limit on an expensive endpoint, TOCTOU with a backstop, no alerting on an abuse signal |
| **Low** | Hardening, documented-accepted residuals, tech debt | Missing security header, unpinned action, minor audit-metadata gap |
| **Info** | Observation worth noting, not a finding | "This area lacks tests" |
| **Dormant (launch checklist)** | Not a current risk under the sandbox posture, but re-acquires a real severity the moment a reactivation trigger fires | GCS bucket ACL posture, Secret Manager wiring, Cloud Run IAM, prod log-sink retention |

Rank by **impact × exposure**, not by how long the fix takes. Every **Dormant** finding must state
its **reactivation severity** and **trigger** — that is what makes it safe to defer instead of
forget.

---

## Required output format

```markdown
# {Prompt name} Review — {YYYY-MM-DD}

**Posture:** {sandbox / deployed — from `OPEN_FINDINGS.md` §Posture}
**Code state:** {branch @ sha} · **Ledger read at:** {sha}

## Summary
| Severity | New | Already in ledger |
|---|---|---|
| Critical | N | N |
| High | N | N |
| Medium | N | N |
| Low | N | N |
| Dormant (launch checklist) | N | N |

## New findings

### F-1 — {Short title} — {Severity}
- **Location:** `path/to/file.ts:42`
- **Observation:** What the code does that's problematic.
- **Impact:** What an attacker / incident could do because of it **under the current posture**.
- **Fix:** Concrete change. Name the function or line to edit.
- **Evidence:** Quote 1-3 lines from the file to prove the claim.
- **Ledger check:** searched `OPEN_FINDINGS.md` for {terms} — no match.

### F-2 — {Short title} — **Dormant (launch checklist)**
- **Location:** `path/to/file.ts:42`
- **Observation:** What is missing.
- **Why dormant:** {the control only exists in a deployed environment, which is suspended}
- **Reactivation severity:** {High} · **Trigger:** {any deploy / GCP billing re-enabled / …}
- **Fix:** Concrete change, to be done before launch.

## Already-tracked (no new severity)
- **OF-NN** — {title} — confirmed at `file:line`. {A new observation, or "matches the ledger".}

## Checks passed
- [x] {Checklist item} — verified at `file:line`.
- [x] {Checklist item} — verified at `file:line`.

## Unverifiable
- {Checklist item} — {reason, e.g. "no migration files present in repo"}.

## Not applicable under current posture
- {Checklist item} — depends on {suspended component}. Re-check on reactivation.

## Out of scope
- {Anything the prompt names but you intentionally skipped, with reason.}
```

---

## Worked example

This is an *illustrative* finding (the format, not a live bug). Given a checklist item *"JWT secret loaded from env, not hardcoded"*, a correct finding would look like:

> ### F-3 — Hardcoded JWT fallback — **Critical**
> - **Location:** `backend/src/config/index.ts:120` (hypothetical regression — see note below)
> - **Observation:** `JWT_ACCESS_SECRET` has a literal fallback string `'dev-secret'` when the env var is unset.
> - **Impact:** In production with a misconfigured deploy, tokens would be signed with a known public string, allowing any attacker to forge admin JWTs.
> - **Fix:** Replace the fallback with a `throw new Error('JWT_ACCESS_SECRET is required')` gate in the same file; add the check to startup validation.
> - **Evidence:**
>   ```ts
>   jwt: { accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-secret' }
>   ```

> **Note:** As of 2026-06-16 the live code does *not* have this bug — `config/index.ts:120` reads `accessSecret: requireEnv('JWT_ACCESS_SECRET')`, which hard-fails at module load when the secret is unset (see the `requireEnv` helper, `config/index.ts:18`). The example above is a deliberately fabricated regression to demonstrate the output format; do not report it against the current repo.

An incorrect finding — which this protocol forbids — would be:

> "JWT secret looks fine." *(no evidence, no line number, not actionable)*

---

## Anti-patterns

- ❌ Summarizing everything as "looks secure" without enumeration.
- ❌ Repeating the prompt's checklist as the output. The checklist is input, not output.
- ❌ Listing "potential issues" without confirming them in code.
- ❌ Proposing fixes that require files you haven't read.
- ❌ Silently marking items "N/A" — put them in Unverifiable or "Not applicable under current posture", with a reason.
- ❌ Re-reporting a finding that is already in `OPEN_FINDINGS.md` as if it were new (see Core rule 6).
- ❌ Re-grading a ledger finding's severity in your output. Link to `OF-NN`; the ledger owns the number.
- ❌ Grading suspended cloud infrastructure as an open Critical/High. Use **Dormant** with a reactivation severity and trigger.
- ❌ Padding the count. A review whose only findings are dormant-infrastructure items should say so plainly in the summary rather than presenting a full severity table that implies live risk.

---

## When the prompt disagrees with the code

Trust the code. Then add a finding of severity **Low** titled "Prompt drift" noting the specific claim in the prompt that no longer matches reality. These accumulate into the quarterly prompt-refresh task (most recently `_drift-audit-2026-08-01.md`).

---

## Where each source wins

When two sources conflict, resolve in this order:

| Rank | Source | Owns |
|---|---|---|
| 1 | **The code** | What the system actually does |
| 2 | **`OPEN_FINDINGS.md`** | Severity, status, posture, what is already known |
| 3 | **This protocol** | Output format, evidence bar, first-pass triage of a *new* finding |
| 4 | **The individual prompt** | What to look at, and the domain-specific checks |
| 5 | Generated docs (`SECURITY_STATUS.md`, `KNOWN_ISSUES.md`, security reviews) | Nothing authoritative — they are snapshots and link to the ledger |

`analysis/codebase-scrutiny-2026-07/` is intentionally opinionated and may disagree with internal
grade labels. Where it does, treat the disagreement as a signal to reconcile — not as a finding.
