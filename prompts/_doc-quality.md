---
tags:
  - meta
  - protocol
  - documentation
type: shared
priority: 1
updated: 2026-04-24
---

# Doc Quality Protocol (shared)

Every **documentation prompt** in `14-23` and `33-40` inherits this protocol. Keep it open (or reference it) while running any of those prompts. It is the counterpart of [`_review-protocol.md`](./_review-protocol.md), which governs the security/audit prompts.

---

## Purpose

The docs produced by prompts 14-23 and 33-40 land in `New Project Documents/`. That folder is attached to a Claude.ai Project **as a substitute for the GitHub repo itself** — the repo has outgrown Projects' attachment limit. This changes the quality bar:

> **A reader who only has the docs (no repo access) must be able to answer real implementation questions about this codebase without guessing.**

This file defines the rules that make that possible.

---

## Core rules

1. **No claim without evidence.** Every code claim cites `file:path:line` or a ranged `file:path:L42-L68`. No "the controller handles auth." Write "`authController.login` (`backend/src/controllers/authController.ts:74`) …".
2. **No summary in place of a reference.** The docs are a reference, not a walkthrough. Tables, snippets, and diagrams out-rank paragraphs. Prose exists to connect artifacts, not replace them.
3. **No fabrication.** If the code does not confirm a claim, mark it `TBD (external: <reason>)` per the TBD rule below. Never invent a route, env var, or table name.
4. **No silent TBDs.** Banned except when the answer lives outside the repo. Every TBD carries the reason *and* where to go resolve it.
5. **No doc stands alone.** Every doc ends with `## Related Documents`; every inline mention of a sibling-owned concept hyperlinks at first mention.
6. **Trust the code over the prompt.** Prompts drift. When in doubt, read the code and log the drift under `## Prompt drift log` at the end of the generated doc.
7. **Use Claude Code tools, not Bash `grep`.** See [`_verification-tools.md`](./_verification-tools.md).

---

## Self-containedness standard

Before returning the doc, Claude self-checks it against the five tests below. A doc that fails any test goes back for a patch — no exceptions.

| Test | What it asks | How to pass |
|---|---|---|
| **Question-answering** | Can a reader with only this doc + siblings answer every item in the prompt's Acceptance Questions? | Re-read each question; trace the answer in your own doc; patch gaps. |
| **Path-and-line** | Does every non-trivial claim cite a `file:path:line`? | Grep your draft for bare sentences like "the X does Y" — rewrite with a citation. |
| **Snippet** | For any non-trivial code assertion, is there a 2-15 line inline snippet? | Include one per concept; quote real code, no paraphrasing. |
| **Diagram** | For any flow with ≥2 components, is there an ASCII or Mermaid diagram? | Add one; if flow is trivial (A→B only), prose is fine. |
| **Reproducibility** | Does every command / env var / SQL / curl run as written? | No `...`, no `<YOUR_VALUE>` unless it's a documented placeholder; prefer real working defaults. |

---

## Evidence and citation rule

- **Atomic citations**: `backend/src/services/database.ts:275` for a single line; `backend/src/services/database.ts:L275-L290` for a range.
- **Multi-file claims**: cite all relevant files inline, e.g., "Signed by `authController.login:92` using `JWT_ACCESS_SECRET` loaded at `config/index.ts:47`."
- **Table rows**: every structural row (routes, env vars, PHI fields, components) carries a citation column or inline anchor.
- **Snippets**: precede with a one-line source marker:

  ```ts
  // Source: backend/src/services/database.ts:L275-L290
  export async function withRLSContext<T>(
    userId: string | null,
    fn: (tx: PrismaTx) => Promise<T>,
  ): Promise<T> { ... }
  ```

- **Never**: "as mentioned earlier", "see the code", "the standard pattern", "typically".

---

## Format standards

### Tables

- Markdown pipes, aligned. One concept per column. Every table row has either a citation column or a citation in a note column.
- For wide reference tables (routes, env vars, PHI), include column headers like `File:Line` or `Source` rather than burying the citation in prose.

### Diagrams

- **ASCII** for box-arrow-box flows and deployment topologies (fast to scan, renders everywhere):

  ```
  Client ──POST /auth/login──▶ authRoutes.ts
                                    │
                                    ▼
                              authController.login  (backend/src/controllers/authController.ts:74)
                                    │
                                    ▼
                              authService.login     (backend/src/services/authService.ts:52)
  ```

- **Mermaid** for sequence, state, and ER diagrams. Use ```mermaid fences:

  ```mermaid
  sequenceDiagram
    participant C as Client
    participant R as authRoutes.ts
    participant Ctl as authController.login
    C->>R: POST /auth/login
    R->>Ctl: (authLimiter, strictAuthLimiter)
    Ctl-->>C: 200 + cookies (access, refresh, csrfToken)
  ```

- Never emit the placeholder `[ASCII diagram]` or `[Mermaid diagram here]`. Render it or delete the section.

### Snippets

- Fenced with the right language tag (`ts`, `sql`, `bash`, `json`, `yaml`).
- Kept to 2-15 lines. If more is needed, quote the cornerstone lines and cite the range.
- Preserve the original code verbatim — do not reformat, re-indent, or "clarify" identifiers.

### Dates

- ISO `YYYY-MM-DD` only. No "April 16th" or "last Thursday".

### Cross-links

- Relative paths with anchors: `[ARCHITECTURE.md#auth-flow](./ARCHITECTURE.md#auth-flow)`.
- First mention of a sibling-owned concept in prose hyperlinks to that doc.
- Every doc ends with a `## Related Documents` section — a short bulleted list: `- [NAME.md](./NAME.md) — one-line hook for why you'd jump there.`

---

## Acceptance-question framework

Every doc prompt supplies 10-20 concrete reader questions. Format them like:

```markdown
## Acceptance questions

Q1. What file and function signs the JWT access token? → `ARCHITECTURE.md#auth-flow`
Q2. Which middleware verifies CSRF on state-changing routes? → `ROUTING_TABLE.md#middleware-chain`
...
```

**After** generating the doc, Claude **must** re-read and self-answer each question using only the doc + siblings. If any answer requires opening the repo (that Claude already used when writing), the doc is under-specified — patch it and re-check.

Do not ship the doc until every acceptance question is answerable from the doc alone.

---

## No-TBD enforcement

TBDs are banned except for facts that genuinely live outside the repo: GCP Console values that no file captures, stakeholder strategy calls, billing-console usage, third-party account config.

**Before** marking anything TBD, Claude MUST:

1. `Grep` the search zone specified in the prompt's "No-TBD enforcement" block.
2. Run `git log --all --source -S "<term>"` for code that may have been removed.
3. Read `backend/.env.example`, `.env.example`, and `backend/src/config/index.ts` for env answers.
4. Read migration files under `backend/prisma/migrations/` for schema answers.
5. Read `CLAUDE.md`, `README.md`, `DEPLOY.md`, and any session-summary files for context answers.
6. Read `railway.toml`, `.github/workflows/*.yml`, `backend/Dockerfile` for infra answers.

Only if the answer is genuinely not derivable from the repo, mark:

```
TBD (external: <what's missing>, <where to resolve — e.g., GCP Console project ownmyhealth-prod>)
```

Plain `TBD` without a reason or resolution path is a failing doc.

---

## Cross-linking rule

Every generated doc ends with:

```markdown
## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — high-level system overview, data flows, middleware stack.
- [API_REFERENCE.md](./API_REFERENCE.md) — per-endpoint contracts (request/response, auth, rate limits).
- [DATA_MODEL.md](./DATA_MODEL.md) — full ER, per-model tables, RLS policies, cascade behavior.
- [PHI_TAXONOMY.md](./PHI_TAXONOMY.md) — every PHI field × encryption × write/read sites × audit coverage.
- [ENV_VARS.md](./ENV_VARS.md) — required + optional env vars, consumers, secret classification.
```

Curate the list to the siblings actually relevant to the doc you just wrote. Do not include every doc by default — cross-links are navigation, not a dump.

---

## Required opening boilerplate

Every doc prompt copies this block verbatim near the top, so the reader (human or Claude) sees the quality bar before writing:

```markdown
## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — when PHI surface touches this doc.

This doc must pass the five tests in `_doc-quality.md` (question-answering, path-and-line, snippet, diagram, reproducibility) before you stop.
```

---

## Worked example — "Biomarker list endpoint" entry

A correct API_REFERENCE entry looks like this (note citations, snippet, diagram, acceptance-stub, cross-links):

> ### `GET /api/v1/biomarkers`
> List the authenticated user's biomarkers, most-recent first.
>
> **Route**: `backend/src/routes/biomarkerRoutes.ts:14`
> **Controller**: `biomarkerController.listBiomarkers` (`backend/src/controllers/biomarkerController.ts:22`)
> **Middleware chain** (in order, from route file):
>
> | # | Middleware | Source |
> |---|---|---|
> | 1 | `authenticate` | `backend/src/middleware/auth.ts:18` |
> | 2 | `standardLimiter` | `backend/src/middleware/rateLimiter.ts:41` |
>
> **RLS wrap**: `withRLSContext(userId, async tx => tx.biomarker.findMany(...))` — `biomarkerController.ts:L28-L36`.
>
> ```ts
> // Source: backend/src/controllers/biomarkerController.ts:L28-L36
> const rows = await withRLSContext(req.user.id, async (tx) => {
>   return tx.biomarker.findMany({ orderBy: { measuredAt: 'desc' } });
> });
> ```
>
> ```mermaid
> sequenceDiagram
>   C->>Route: GET /api/v1/biomarkers (cookie: access)
>   Route->>Ctl: authenticate + standardLimiter
>   Ctl->>DB: withRLSContext(userId, tx => tx.biomarker.findMany)
>   DB-->>Ctl: rows (PHI still encrypted)
>   Ctl-->>C: 200 [{ id, valueDecrypted, unitDecrypted, ... }]
> ```
>
> **Response (200)**: `Array<{ id, valueDecrypted, unitDecrypted, measuredAt, category }>`.
> **PHI fields returned**: `valueDecrypted`, `unitDecrypted`, `notesDecrypted` — see [`PHI_TAXONOMY.md#biomarker`](./PHI_TAXONOMY.md#biomarker).
> **Audit log**: `auditLog.log({ action: 'BIOMARKER_LIST', ... })` at `biomarkerController.ts:38`.
>
> **Related**: [`DATA_MODEL.md#biomarker`](./DATA_MODEL.md#biomarker), [`ROUTING_TABLE.md`](./ROUTING_TABLE.md).

An **incorrect** entry — which this protocol forbids — looks like:

> ### GET /biomarkers
> Returns biomarkers for the current user. Uses JWT auth.

No file paths, no middleware chain, no snippet, no diagram, no audit log, no PHI linkage. A reader could not reproduce, validate, or extend this.

---

## Anti-patterns

- ❌ "The controller does X" / "the service handles Y" without a `file:line`.
- ❌ "See the code" or "refer to the implementation".
- ❌ Paragraphs of prose with no tables, snippets, or diagrams — the doc is a reference, not an article.
- ❌ Acceptance questions the doc itself cannot answer.
- ❌ Placeholder diagrams (`[ASCII diagram]`, `[insert Mermaid here]`).
- ❌ Copying the prompt's text into the output instead of generating real content.
- ❌ `TBD` without a reason or resolution path.
- ❌ Cross-linking to a doc that does not exist yet. Instead, write `(doc pending — see prompt ./NN-foo.md)`.
- ❌ Mixing relative dates (`last Thursday`) or ranges (`around Q1`) with ISO dates.
- ❌ "Typically", "usually", "normally" — in a reference doc, it's either citable or it doesn't belong.

---

## When the prompt disagrees with the code

Trust the code. Finish the section using what the code actually says, then append to the end of the generated doc:

```markdown
## Prompt drift log

- `./NN-foo.md` says "13 route files"; actual count is 19 (see [glob]). Prompt author should update `00-index.md` "Verified codebase counts" table.
- `./NN-foo.md` expects `config.jwt.accessSecret`; config exports `config.JWT_ACCESS_SECRET`. Drift since 2026-04-01.
```

These entries drive the quarterly prompt-refresh task.

---

## Refresh cadence

| Artifact | Frequency |
|---|---|
| This file (`_doc-quality.md`) | Yearly, or when a new doc category is added |
| Every doc prompt (14-23, 33-40) | On change; re-verify Acceptance Questions quarterly |
| Generated docs in `New Project Documents/` | Per [`25-full-doc-refresh.md`](./25-full-doc-refresh.md) cadence per doc |

Out-of-date docs produce wrong Claude Project answers. Treat doc drift as a bug.
