---
tags:
  - documentation
  - troubleshooting
type: prompt
priority: 2
updated: 2026-04-24
---

# Generate TROUBLESHOOTING.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/TROUBLESHOOTING.md` — the **symptom-first catalog**. A developer sees behavior X; this doc gets them to the right file, the right log filter, and the right fix in under a minute. Complements `ERROR_RECOVERY.md` (which is code-catalog-first).

| `ERROR_RECOVERY.md` | `TROUBLESHOOTING.md` |
|---|---|
| Code-catalog lens: every `code` value → recovery | Symptom lens: "data disappears after refresh" → root cause |
| Organized by error code | Organized by observed behavior |

---

## Files to review

| File | Why read it |
|---|---|
| Git log (`git log --grep='^fix:\|^hotfix:\|^revert:'`) | Every past fix is a symptom worth cataloging. |
| `New Project Documents/KNOWN_ISSUES.md` | Currently-open symptoms. |
| `New Project Documents/ERROR_RECOVERY.md` | Cross-link for every error-code path. |
| `backend/src/middleware/errorHandler.ts` | Error envelope shape. |
| `src/services/api/client.ts` | Frontend interceptor behavior (auto-refresh, auto-redirect). |
| Project memory (postmortems, session summaries if present) | Retrospective context. |

---

## Required sections

1. **How to use this doc** — 1 paragraph + link to `ERROR_RECOVERY.md`.
2. **Symptom index** — quick-jump table (symptom → anchor).
3. **Decision trees** (ASCII) for the hairy categories:
   - Login fails / 401 loop
   - Data disappears on refresh (auth state)
   - Upload returns 500 / extraction empty
   - RLS mystery (query returns fewer rows than expected)
4. **Auth symptoms** (each with: symptom, root cause, workaround, fix, files).
5. **CSRF symptoms**.
6. **Database symptoms** (pool exhaustion, migration failure, RLS context loss).
7. **Deployment symptoms** (Cloud Run env-update pinning — cite postmortem; workflow failure; Docker build).
8. **Frontend symptoms** (blank page, CORS, cookie-SameSite, Vite/SWC on ARM64 per memory).
9. **API / 500 symptoms**.
10. **PDF / OCR / Claude extraction symptoms**.
11. **Quick diagnostic commands** — canonical curls + `gcloud logging read` snippets.
12. **Related Documents**.
13. **Prompt drift log**.

---

## Required artifacts

### Symptom entry template

```markdown
### Data disappears after page refresh

**Symptom**: user sees biomarkers after login, but after refresh the dashboard is empty and network shows 401 → 200 → empty list.

**Root cause**: `AuthContext.tsx` called `getCurrentUser()` before `refreshToken()`. Without a valid access token, the user call returns 401 and the app renders as logged-out before the refresh completes.

**Workaround**: hard refresh twice (in-flight refresh completes before 2nd mount).

**Fix**: in `AuthContext.tsx`, `await refreshToken()` before `getCurrentUser()`. See commit `195ccc1`, and `50d7426` for the regression test.

**Files**: `src/contexts/AuthContext.tsx:Lxx-Lyy`.

**Cross-link**: [`ERROR_RECOVERY.md#unauthenticated`](./ERROR_RECOVERY.md).
```

### Decision tree (ASCII, auth example)

```
User reports "I'm stuck on login"
        │
        ▼
  Network tab shows 401?
     ├── yes ──▶ CSRF cookie + X-CSRF-Token matching?
     │                 ├── no  ──▶ re-read cookie; see "CSRF Token Missing"
     │                 └── yes ──▶ refresh cookie present?
     │                                 ├── no  ──▶ re-login
     │                                 └── yes ──▶ /auth/refresh succeeds?
     │                                                   ├── no  ──▶ "JWT secret rotated" playbook in RUNBOOK.md
     │                                                   └── yes ──▶ AuthContext ordering bug
     └── no (loops in UI) ──▶ frontend redirect loop; see "Data disappears…"
```

### Quick diagnostic commands

```bash
# Backend health
curl https://<prod-backend-url>/health

# Last 20 errors in Cloud Run
gcloud logging read 'resource.type="cloud_run_revision" severity>=ERROR' --limit=20 --freshness=1h

# Connect to Cloud SQL via proxy
cloud-sql-proxy <instance-connection-name>
psql -h 127.0.0.1 -U <user> -d verifymyprovider
```

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc + siblings**:

1. Where's the canonical fix for "data disappears on refresh"?
2. What's the decision tree for a stuck-on-login user?
3. What symptom indicates the Cloud Run env-update pinning gotcha, and where's the fix?
4. What causes an RLS "mystery" (fewer rows than expected), and how do you confirm?
5. How do you detect PHI leaking into logs?
6. What's the most common cause of blank page on frontend, and where is it fixed?
7. Which past fix covers upload 500 errors, and where is the commit?
8. What's the quick curl to verify prod health?
9. Which failure matches "Next.js SWC ARM64 incompat" per project memory?
10. Where does the doc point for each symptom that maps to a known `code`?

---

## No-TBD enforcement

Before marking anything TBD:

- **Retrospective symptoms**: `git log --grep='^fix:\|^hotfix:\|^revert:\|^chore: remediate'`. Every line is a symptom candidate.
- **Project memory**: pull known fixes (AuthContext ordering `195ccc1`, Next.js SWC ARM64, Cloud Run pinning 2026-04-17) and include them verbatim with commit SHAs.
- **Error-path mapping**: cross-link every symptom to its `ERROR_RECOVERY.md` entry when possible.
- **Command syntax**: `gcloud logging read` + `psql` commands are stable — include working invocations, not placeholders.

If a symptom is purely user-reported and un-committed:

```
TBD (external: reported symptom not yet captured — add commit SHA + fix once remediated)
```

---

## Cross-links

The generated `TROUBLESHOOTING.md` must link to:

- [`ERROR_RECOVERY.md`](./ERROR_RECOVERY.md) — error-code-first catalog.
- [`RUNBOOK.md`](./RUNBOOK.md) — operational playbooks.
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) — open items.
- [`LOCAL_DEV.md`](./LOCAL_DEV.md) — local-dev failure modes.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — to understand flows.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Fix commits | Bash | `git log --all --since='2 years ago' --grep='^fix:\|^hotfix:\|^revert:' --pretty='%h %ad %s' --date=short` |
| Look for console.log leaks | Grep | `pattern: "console\\.log"` over `backend/src/**` (exclude tests) |
| Find retry/backoff | Grep | `pattern: "retry|backoff|setTimeout"` over `backend/src/services/**` |
| Known decision points | Read | `src/contexts/AuthContext.tsx`, `src/services/api/client.ts`, `backend/src/middleware/*.ts` |

---

## Output: file and location

Write the final document to `New Project Documents/TROUBLESHOOTING.md`.
