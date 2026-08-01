---
tags:
  - meta
  - protocol
  - documentation
type: shared
priority: 1
updated: 2026-08-01
---

# Doc Quality Protocol (shared)

Every **documentation prompt** in `14-23`, `33-40`, and `46` inherits this protocol. Keep it open (or reference it) while running any of those prompts. It is the counterpart of [`_review-protocol.md`](./_review-protocol.md), which governs the security/audit prompts.

---

## Before you generate: is regeneration the right move? (2026-08-01)

`analysis/codebase-scrutiny-2026-07/` reviewed this documentation set and reached two conclusions
that bind these prompts:

> "**Stop regenerating** full doc sets until P0 engineering closes; prefer surgical updates."
> — `10-documentation-pathology.md:67`

> Explicit non-goal until P0 clears: "Another full multi-agent 'security theater' doc refresh."
> — `11-priority-fix-list.md:68`

The reasoning: ~24K lines of markdown across ~120 files already exists, and volume at this scale
stops being an asset once it outruns shippable product truth. Regeneration also re-costs tokens to
restate facts that did not change, and re-introduces snapshot lag on the pages that did.

**Therefore, default to a surgical patch, not a regeneration.** Before running any doc prompt end
to end, answer:

1. **What specifically changed?** Get the diff (`git log --oneline <last-doc-refresh-date>..HEAD`,
   plus the current `_drift-audit-*.md`). If the answer is "three routes and a count", patch those
   three sections and the count. Do not regenerate the file.
2. **Is the doc's `Last updated` / code-state stamp older than the change?** If the doc has no
   stamp, adding one is the first patch.
3. **Would a full regeneration change more than ~30% of the file?** Only then is regenerating
   cheaper than patching — and say so in your output.

A surgical patch still owes the full evidence bar below: every line you touch cites `file:line`, and
you update the doc's date stamp and its `## Prompt drift log`. What it does *not* owe is rewriting
sections whose facts are unchanged.

**Severity language is not yours to write.** `New Project Documents/OPEN_FINDINGS.md` is the single
authoritative findings ledger. Docs **link** to `OF-NN` ids; they do not restate severities, counts
of open findings, or status. A doc that says "0 open High" is a doc that will contradict the ledger
within a month — that exact contradiction is what scrutiny finding P0-6 was about.

---

## Purpose

The docs produced by prompts 14-23, 33-40, and 46 land in `New Project Documents/`. That folder is attached to a Claude.ai Project **as a substitute for the GitHub repo itself** — the repo has outgrown Projects' attachment limit. This changes the quality bar:

> **A reader who only has the docs (no repo access) must be able to answer real implementation questions about this codebase without guessing.**

This file defines the rules that make that possible.

---

## Core rules

1. **No claim without evidence.** Every code claim cites `file:path:line` or a ranged `file:path:L42-L68`. No "the controller handles auth." Write "`authController.login` (`backend/src/controllers/authController.ts:257`) …".
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

- **Atomic citations**: `backend/src/services/database.ts:447` for a single line; `backend/src/services/database.ts:L447-L456` for a range.
- **Multi-file claims**: cite all relevant files inline, e.g., "`authController.login` (`backend/src/controllers/authController.ts:257`) calls `authService.generateAccessToken` (`backend/src/services/authService.ts:237`), which signs with `config.jwt.accessSecret` loaded from `JWT_ACCESS_SECRET` at `backend/src/config/index.ts:61`."
- **Table rows**: every structural row (routes, env vars, PHI fields, components) carries a citation column or inline anchor.
- **Snippets**: precede with a one-line source marker:

  ```ts
  // Source: backend/src/services/database.ts:L447-L456
  export async function withRLSContext<T>(
    userId: string | null,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options: RLSOptions = {},
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
                              authController.login        (backend/src/controllers/authController.ts:257)
                                    │
                                    ▼
                              authService.generateAccessToken (backend/src/services/authService.ts:237)
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
> List the authenticated user's biomarkers, most-recent first (`measurementDate desc`), paginated.
>
> **Route**: `backend/src/routes/biomarkerRoutes.ts:51`
> **Controller**: `biomarkerController.getBiomarkers` (`backend/src/controllers/biomarkerController.ts:143`)
> **Middleware chain** (in order, from route file):
>
> | # | Middleware | Source |
> |---|---|---|
> | 1 | `authenticate` (applied router-wide via `router.use`) | `backend/src/middleware/auth.ts:74` |
> | 2 | `validate(schemas.biomarker.listQuery, 'query')` | `backend/src/middleware/validation.ts` |
>
> **RLS wrap**: `withRLSTransaction(userId, async tx => { count + findMany })` — `biomarkerController.ts:L169-L180`.
>
> ```ts
> // Source: backend/src/controllers/biomarkerController.ts:L169-L180
> const { total, biomarkers } = await withRLSTransaction(userId, async (tx) => {
>   const total = await tx.biomarker.count({ where });
>   const biomarkers = await tx.biomarker.findMany({
>     where,
>     // Oldest-first so trend math (history[0] = oldest) is order-independent.
>     include: { history: { orderBy: { measurementDate: 'asc' } } },
>     skip: pagination.skip,
>     take: pagination.take,
>     orderBy: { measurementDate: 'desc' },
>   });
>   return { total, biomarkers };
> });
> ```
>
> ```mermaid
> sequenceDiagram
>   C->>Route: GET /api/v1/biomarkers (cookie: access)
>   Route->>Ctl: authenticate + validate(listQuery)
>   Ctl->>DB: withRLSTransaction(userId, tx => count + findMany)
>   DB-->>Ctl: rows (PHI still encrypted)
>   Ctl-->>C: 200 { data: [{ id, value, unit, ... }], pagination }
> ```
>
> **Response (200)**: `{ data: Array<{ id, value, unit, notes?, date, category, ... }>, pagination }` — values decrypted via `toResponse` (`biomarkerController.ts:91`).
> **PHI fields returned**: `value` (from `valueEncrypted`), `notes` (from `notesEncrypted`) — see [`PHI_TAXONOMY.md#biomarker`](./PHI_TAXONOMY.md#biomarker).
> **Audit log**: `auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, { operation: 'LIST', ... })` at `biomarkerController.ts:193`.
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

- `./NN-foo.md` says "13 route files"; actual count is 18 (see [glob `backend/src/routes/*.ts`]). Prompt author should update `00-index.md` "Verified codebase counts" table.
- `./NN-foo.md` references `uploadController.ts`; that single-file controller no longer exists — upload handlers now live in `backend/src/controllers/upload/index.ts` (`uploadLabReport`, `uploadSBC`, `uploadLabResultOCR`), wired from `uploadRoutes.ts:22`. Drift since the upload refactor.
```

These entries drive the quarterly prompt-refresh task.

---

## Refresh cadence

| Artifact | Frequency |
|---|---|
| This file (`_doc-quality.md`) | Yearly, or when a new doc category is added |
| Every doc prompt (14-23, 33-40, 46) | On change; re-verify Acceptance Questions quarterly |
| Generated docs in `New Project Documents/` | **Surgical patch on change** (see "Before you generate" above); full regeneration only per the gate in [`25-full-doc-refresh.md`](./25-full-doc-refresh.md) |

Out-of-date docs produce wrong Claude Project answers. Treat doc drift as a bug — and treat
unnecessary regeneration as a different bug, because it buries the pages that actually moved.

---

## Posture stamp (required, 2026-08-01)

Every generated or patched doc carries a stamp near the top so a reader can tell what world it
describes:

```markdown
> **Code state:** {branch} @ `{sha}` · **Generated:** {YYYY-MM-DD} · **Posture:** sandbox (no GCP) — see [OPEN_FINDINGS.md](./OPEN_FINDINGS.md#posture)
```

The project declared a **sandbox, no-GCP** posture on 2026-07-14: billing disabled, no deployment
target, no real users, `STORAGE_BACKEND=local` as the development default. Docs that describe
Cloud Run / Cloud SQL / GCS operations must say plainly that those describe the **launch**
configuration, not a currently-running system. Present tense about a suspended stack is the same
overclaim problem in a different costume.
