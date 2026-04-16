---
tags:
  - meta
  - protocol
type: shared
priority: 1
updated: 2026-04-16
---

# Review Protocol (shared)

Every security / audit prompt in `01-13` and `26-32` inherits this protocol. Keep it open (or reference it) while running any of those prompts.

---

## Core rules

1. **No tick without evidence.** Do not mark a checklist item "passed" unless you can cite a `file:line` that proves it.
2. **No fabrication.** If you can't locate a file, constant, or function mentioned in the prompt, say so in the *Unverifiable* section — don't guess.
3. **Don't fix silently.** Report findings; wait for explicit instruction before editing code. A fix is a separate task.
4. **Assume the prompt may be stale.** Counts, file names, and environment variables in these prompts may drift from the live repo. When in doubt, trust the code.
5. **Use Claude Code tools, not Bash `grep`.** See [verification tools](./_verification-tools.md).

---

## Severity rubric

| Severity | Criteria | Examples |
|---|---|---|
| **Critical** | Direct path to PHI disclosure, authentication bypass, or HIPAA violation with measurable blast radius | Plaintext PHI in DB, missing auth on PHI endpoint, JWT secret hardcoded, audit log disabled |
| **High** | Exploitable vulnerability requiring some precondition, or broken defense-in-depth for PHI | IDOR to other users' data, CSRF missing on mutations, RLS bypass path, PHI in server logs |
| **Medium** | Weakens security posture but no immediate exploit path | Missing rate limit on expensive endpoint, weak password policy, verbose error messages, outdated dependency with known CVE |
| **Low** | Best-practice gap, hygiene, or hardening opportunity | Missing security header, non-pinned action version, minor typo in audit metadata |
| **Info** | Observation worth noting, not a finding | "This area lacks tests" |

Rank by **exploitability × blast radius**, not by how long the fix takes.

---

## Required output format

```markdown
# {Prompt name} Review — {YYYY-MM-DD}

## Summary
| Severity | Count |
|---|---|
| Critical | N |
| High | N |
| Medium | N |
| Low | N |

## Findings

### F-1 — {Short title} — {Severity}
- **Location:** `path/to/file.ts:42`
- **Observation:** What the code does that's problematic.
- **Impact:** What an attacker / incident could do because of it.
- **Fix:** Concrete change. Name the function or line to edit.
- **Evidence:** Quote 1-3 lines from the file to prove the claim.

### F-2 …

## Checks passed
- [x] {Checklist item} — verified at `file:line`.
- [x] {Checklist item} — verified at `file:line`.

## Unverifiable
- {Checklist item} — {reason, e.g. "no migration files present in repo"}.

## Out of scope
- {Anything the prompt names but you intentionally skipped, with reason.}
```

---

## Worked example

Given a checklist item *"JWT secret loaded from env, not hardcoded"*, a correct finding would look like:

> ### F-3 — Hardcoded JWT fallback — **Critical**
> - **Location:** `backend/src/config/index.ts:47`
> - **Observation:** `JWT_ACCESS_SECRET` has a literal fallback string `'dev-secret'` when the env var is unset.
> - **Impact:** In production with a misconfigured deploy, tokens would be signed with a known public string, allowing any attacker to forge admin JWTs.
> - **Fix:** Replace the fallback with a `throw new Error('JWT_ACCESS_SECRET is required')` gate in the same file; add the check to startup validation.
> - **Evidence:**
>   ```ts
>   jwt: { accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-secret' }
>   ```

An incorrect finding — which this protocol forbids — would be:

> "JWT secret looks fine." *(no evidence, no line number, not actionable)*

---

## Anti-patterns

- ❌ Summarizing everything as "looks secure" without enumeration.
- ❌ Repeating the prompt's checklist as the output. The checklist is input, not output.
- ❌ Listing "potential issues" without confirming them in code.
- ❌ Proposing fixes that require files you haven't read.
- ❌ Silently marking items "N/A" — put them in Unverifiable with a reason.

---

## When the prompt disagrees with the code

Trust the code. Then add a finding of severity **Low** titled "Prompt drift" noting the specific claim in the prompt that no longer matches reality. These accumulate into the quarterly prompt-refresh task.
