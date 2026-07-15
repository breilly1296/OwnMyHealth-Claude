# 06 — Backend

**Stack:** Node.js + Express + TypeScript + Prisma + PostgreSQL  
**Layout:** `backend/src/{controllers,routes,services,middleware,schedulers,maintenance}`

---

## Positives

- Intentional middleware stack (Helmet, CORS, cookies, CSRF, rate limits, validation, error handler)
- Zod validation present on many inputs
- Controllers frequently use `withRLSContext` / `withRLSTransaction`
- Encryption, audit, plan gating treated as first-class cross-cutting concerns
- Maintenance jobs pattern for backfills
- Email scheduler for lifecycle messages
- Deploy story: Cloud Run + migrate job + CI gate

---

## Structural problems

### 1. Service / route god objects

`authService`, `pdfParser`, `sbcExtraction`, `adminRoutes`, upload `shared.ts` concentrate too many responsibilities. See line inventory in [sizing-inventory.md](./sizing-inventory.md) and [03-architecture.md](./03-architecture.md).

### 2. Business logic in routes

Especially admin and provider routes: harder to unit test, harder to reuse, easier to miss authz edge cases when endpoints accumulate.

### 3. Inconsistent layering

No uniform rule for “route only wires middleware; controller orchestrates; service owns domain.” Some areas comply; others dump SQL and policy into route handlers.

### 4. Performance tax of encrypt-everything

List endpoints decrypt per row. Frontend still attempts large multi-page biomarker loads (page size 100, up to 50 pages, concurrency 5). Longitudinal records will stress:

- Cloud Run CPU (PBKDF2 / AES decrypt)
- Latency p99
- Rate limits

Missing: server-side search, aggregation, “dashboard summary” endpoints that avoid full history decrypt.

### 5. Multi-instance incomplete stores

Rate limit + AI spend default in-memory; FHIR PKCE in-memory. Code is pluggable for Redis, but ops may leave `REDIS_URL` empty. See [09-ops-sre.md](./09-ops-sre.md).

### 6. Cost governance asymmetry

| Service | Dollar-bounded? |
|---------|-----------------|
| Claude (Haiku/Sonnet) | Yes (`aiSpendGuard` / `trackAIUsage`) |
| Google Document AI OCR | **No** (count/rate limits only) |
| SendGrid | No dedicated limiter called out |
| GCS | Count-gated writes via upload limits |

### 7. Untested high-risk controllers

No dedicated controller tests found for:

- `aiChatController.ts`
- `fhirController.ts`
- `fileController.ts`
- `upload/labUploadController.ts`
- `upload/sbcUploadController.ts`

These are among the most PHI- and integration-sensitive paths. See [07-testing.md](./07-testing.md).

### 8. Feature completeness vs flags

Quest/FHIR disabled when client id empty is a good default. Risk is UI/docs implying a live integration while runtime is multi-instance-unsafe or env-disabled.

---

## Notable good patterns to keep

- Fail-closed plan lookup on DB error (downgrade to FREE semantics)
- Fail-closed AI spend admit on store errors (when guard is in path)
- Not leaking raw DB errors to clients (log server-side, generic client message)
- GCS delete-before-DB-delete discipline on file removal (avoid orphaned PHI confusion)
- Secure PDF wrappers around unmaintained `pdf-parse` pin

---

## Backend recommendations

1. Decompose `authService` and fat admin/provider routes.
2. Finish Redis in non-local environments; document as required for scale.
3. Close OCR dollar tracking (H-3).
4. Add tests for the five untested PHI controllers + storage/OCR unit boundaries.
5. Add summary/search APIs for biomarkers to avoid full-history FE loads.
6. Atomic plan-limit reservation (close TOCTOU H-1) when hard SLAs matter.
7. Keep BAA and PHI email policy explicit in code gates and runbooks.
