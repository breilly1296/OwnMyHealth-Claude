---
tags:
  - documentation
  - errors
  - operational
  - reference
type: prompt
priority: 2
updated: 2026-04-24
---

# Generate ERROR_RECOVERY.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/ERROR_RECOVERY.md` — the **every-error-code playbook**. Symptom → root cause → user-facing message → developer recovery action → related code paths. A frontend dev seeing a `403 CSRF_MISMATCH` or `419 SESSION_EXPIRED` should land here and know exactly what to do.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/middleware/errorHandler.ts` | Error envelope + `AppError` class + default mapping. |
| `backend/src/utils/*.ts` | Any `AppError` subclass (e.g., `ValidationError`, `AuthError`) — check `utils/` first. |
| All of `backend/src/controllers/*.ts` and `backend/src/services/*.ts` | Grep every `new AppError(`, `throw new`, `res.status(...).json({ error: ... })`. |
| `backend/src/middleware/auth.ts`, `csrf.ts`, `rbac.ts`, `rateLimiter.ts`, `validation.ts`, `demoProtection.ts` | Middleware throws. |
| `src/services/api/client.ts` | Frontend axios interceptor — how the error surfaces to the UI. |
| `src/components/**` | Which UI components render error states — grep for error-display components. |

---

## Required sections

1. **Error envelope** — quote `errorHandler.ts`; show the shape clients always receive.
2. **HTTP status conventions** — 400 / 401 / 403 / 404 / 409 / 419 / 422 / 429 / 500 / 502 / 503 mapping.
3. **Master error-code table** (see Required artifacts) — every `code` constant.
4. **Per-code deep dives** — H3 per code, grouped by family (auth, CSRF, validation, RBAC, rate limit, PHI, storage, AI, system).
5. **Frontend interpretation layer** — how `client.ts` normalizes errors, global toast mappings, auto-redirects (e.g., 401 → login).
6. **Auth state decision tree** — 401 vs 419 vs 403 flowchart (ASCII).
7. **Recovery playbooks** — three or four full recipes: "user stuck with 401 loop", "AI endpoint returning 500", "upload 413 payload too large", "admin export timing out".
8. **Logging + audit** — which errors must emit an audit log (e.g., failed login) and which are noise.
9. **Known error drift** — error codes thrown in code but not documented here at first pass; a second pass closes them.
10. **Related Documents**.
11. **Prompt drift log**.

---

## Required artifacts

### Master error-code table

| `code` | HTTP status | User-facing message | Thrown at (file:line list) | Recovery action | Related |
|---|---|---|---|---|---|
| `UNAUTHENTICATED` | 401 | "Please sign in" | `auth.ts:Lxx` | Redirect to `/login`; clear memory token; call `/auth/refresh` first if refresh cookie present | [`API_REFERENCE.md#auth-endpoints`](./API_REFERENCE.md) |
| `CSRF_MISMATCH` | 403 | "Security token invalid" | `csrf.ts:Lxx` | Reload CSRF cookie; re-read header; re-submit | [`ROUTING_TABLE.md#csrf-exemption-list`](./ROUTING_TABLE.md) |
| `VALIDATION_ERROR` | 400 | Field-specific | `validation.ts:Lxx` + controllers | Fix request body per schema | schema in `API_REFERENCE.md` |
| `RATE_LIMIT_EXCEEDED` | 429 | "Too many requests" | `rateLimiter.ts:Lxx` | Wait `Retry-After` seconds | [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) |
| `FORBIDDEN_ROLE` | 403 | "Access denied" | `rbac.ts:Lxx` | User lacks role; request access or log in as PROVIDER/ADMIN | [`API_REFERENCE.md`](./API_REFERENCE.md) |
| `DEMO_BLOCKED` | 403 | "Demo accounts cannot modify data" | `demoProtection.ts:Lxx` | Use a real account | — |
| `SESSION_EXPIRED` | 419 | "Session expired" | `auth.ts:Lxx` / `authService.ts:Lxx` | Call `/auth/refresh`; if that fails, redirect to login | — |
| `NOT_FOUND` | 404 | "Resource not found" | many (`throw new AppError('NOT_FOUND', ...)`) | Verify ID; may indicate RLS denial (see note) | [`DATA_MODEL.md#rls-policies`](./DATA_MODEL.md) |
| `RLS_DENIED` | 404 or 403 | (masked as NOT_FOUND) | Postgres policy (implicit) | See recovery playbook | [`ARCHITECTURE.md#rls-enforcement-path`](./ARCHITECTURE.md) |
| `AI_UNAVAILABLE` | 503 | "AI service temporarily unavailable" | `claudeExtraction.ts:Lxx` | Retry with backoff; check Anthropic status | — |
| `UPLOAD_TOO_LARGE` | 413 | "File too large" | `multer` config / `uploadController` | Reduce file size | [`API_REFERENCE.md#upload-endpoints`](./API_REFERENCE.md) |
| `STORAGE_ERROR` | 502 | "File upload failed" | `storageService.ts:Lxx` | Retry; check GCS bucket permissions | [`RUNBOOK.md#incident-playbooks`](./RUNBOOK.md) |
| ... | ... | ... | ... | ... | ... |

Every `new AppError(` occurrence in `backend/src/**` must map to a row.

### Per-code deep dive (template)

```markdown
### `UNAUTHENTICATED` (HTTP 401)

**Thrown at**:
- `backend/src/middleware/auth.ts:Lxx` — access token missing or invalid.
- `backend/src/controllers/authController.ts:Lyy` — login with bad password (maps to `LOGIN_FAILED` code — see row).

**User message**: "Please sign in".

**Developer recovery**:
1. If the client has a `refresh` cookie, call `POST /api/v1/auth/refresh` first.
2. If refresh returns 401, redirect to `/login`; clear in-memory access token.
3. After successful login, retry the original request.

**Snippet**:

```ts
// Source: backend/src/middleware/auth.ts:Lxx-Lyy
if (!token) throw new AppError('UNAUTHENTICATED', 401, 'Please sign in');
```

**Audit log**: yes — failed login emits `LOGIN_FAILED` via `auditLog.log(...)` at `authController.ts:Lzz`.

**Frontend handling**: `src/services/api/client.ts:Lxx` axios interceptor triggers auto-refresh.
```

### 401 vs 419 vs 403 flowchart

```
  API call → 401 ──▶ have refresh cookie? ──yes──▶ /auth/refresh ──▶ success? ──yes──▶ retry original
                                   │                                        │
                                   no                                      no
                                   │                                        ▼
                                   ▼                                 redirect /login
                             redirect /login

  API call → 419 ──▶ session expired server-side ──▶ hard logout (clear everything) ──▶ /login

  API call → 403 ──▶ UNAUTHORIZED (role/consent/demo) ──▶ surface toast; no retry
```

### Recovery playbooks (narratives)

Write three or four end-to-end playbooks, e.g.:

#### Playbook: user stuck with `401` loop

1. Check `client.ts:Lxx` interceptor; if it's calling `/auth/refresh` > N times, it's a bug — log to Sentry / console.
2. Inspect the `access` cookie TTL (`authService.ts:Lxx`).
3. Check `JWT_SECRET` rotation — if a deploy rotated secrets, all existing sessions are invalid.
4. Forced resolution: hard-logout all users via admin `/auth/logout-all`.

#### Playbook: AI endpoint returning 500

1. Check if `ANTHROPIC_API_KEY` is set and valid (`config/index.ts`).
2. Inspect Cloud Run logs for the error — `claudeExtraction.ts:Lxx` wraps errors.
3. Check quotas in Anthropic console.
4. If BAA gate: confirm `ANTHROPIC_BAA_ACTIVE` is correctly set (see memory postmortem).

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc + siblings**:

1. How many distinct error `code` values exist in the API?
2. What's the difference between `UNAUTHENTICATED` and `SESSION_EXPIRED`, and how should a client react to each?
3. What recovery action applies when a client receives `CSRF_MISMATCH`?
4. Does `NOT_FOUND` ever mask an RLS denial? (yes — why and how to tell the difference?)
5. What's the `Retry-After` semantics on a `429`, and which limiter set it?
6. When an AI call fails, what error is returned and where is the retry logic?
7. Which errors are audited, and where?
8. Does the frontend auto-refresh the access token on 401? Where?
9. What's the recovery for `PHI_ENCRYPTION_KEY` rotation mid-session?
10. What happens if an admin endpoint is hit with `UNAUTHENTICATED` cookies? Status + code?
11. Which error surfaces when demo accounts try to mutate data?
12. How does the client distinguish a real 404 from an RLS-masked 404?

---

## No-TBD enforcement

Before marking anything TBD:

- **Enumerate error codes**: `Grep pattern: "new AppError\\(['\"]([A-Z_]+)['\"]"` over `backend/src/**`. Dedupe. Every code in the match set is a row.
- **Find every throw site**: `Grep pattern: "throw new AppError\\(|throw new "` over `backend/src/**`.
- **Find HTTP status assignments**: `Grep pattern: "status\\(\\d\\d\\d\\)"` over `backend/src/**` to catch inline `res.status(...)` paths.
- **Frontend handling**: read `src/services/api/client.ts`; grep `error.response.status` and `error.response.data.error.code` paths.
- **Audit events for errors**: `Grep pattern: "auditLog\\.log.*(FAILED|ERROR|DENIED)"` over `backend/src/**`.

If a `code` is thrown but has no user-facing message defined anywhere, flag it in Prompt drift log — do not invent a message.

---

## Cross-links

The generated `ERROR_RECOVERY.md` must link to:

- [`API_REFERENCE.md`](./API_REFERENCE.md) — per-endpoint error lists.
- [`ROUTING_TABLE.md`](./ROUTING_TABLE.md) — middleware that produces each error.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — auth + CSRF + RLS flows.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — broader symptom catalog (narrative).
- [`RUNBOOK.md`](./RUNBOOK.md) — operational incident playbooks.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Enumerate codes | Grep | `pattern: "new AppError\\(['\"]([A-Z_]+)['\"]"` |
| Find throws | Grep | `pattern: "throw new"` over `backend/src/**` |
| Find status codes | Grep | `pattern: "status\\(\\d\\d\\d\\)"` over `backend/src/**` |
| Read error handler | Read | `backend/src/middleware/errorHandler.ts` |
| Read axios interceptor | Read | `src/services/api/client.ts` |

---

## Output: file and location

Write the final document to `New Project Documents/ERROR_RECOVERY.md`.
