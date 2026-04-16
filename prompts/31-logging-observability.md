---
tags:
  - security
  - hipaa
  - observability
  - high
type: prompt
priority: 2
updated: 2026-04-16
---

# Logging & Observability Review

> Follow the [review protocol](./_review-protocol.md) for output format and severity rubric.
> Reference the [PHI inventory](./_phi-inventory.md) for what must never appear in logs.
> Use [Claude Code tools](./_verification-tools.md), not Bash grep.

## Why this prompt exists

Five other prompts say "no PHI in logs" in a checklist item. None of them actually *reviews* the logging layer. A single leaked log line is a HIPAA breach. This prompt owns that review.

## Files to Review
- `backend/src/utils/logger.ts` — app-level logger (`SENSITIVE_FIELDS` set, `sanitizeData` recursion)
- `backend/src/utils/phiRedaction.ts` — `stripPHIFromText()` regex redaction for SSN, MRN, phone, DOB, address
- `backend/src/middleware/errorHandler.ts` — error serialization to logs (see [32-error-handling](./32-error-handling.md))
- `backend/src/services/auditLog.ts` — HIPAA audit trail (structurally distinct from application logs)
- `src/utils/logger.ts` — frontend logger
- Any `console.log`, `console.error`, `console.warn` outside the logger (should be zero)
- Cloud Run log sink configuration (infra, not in repo — check deploy.yml / GCP console)

## OwnMyHealth Logging Architecture
- **App logs** → `console.*` in Node → Cloud Run captures → Cloud Logging.
- **Audit logs** → PostgreSQL `audit_logs` table (separate channel, encrypted PHI values, 7-year retention).
- **PHI policy**: app logs get redacted at write-time via `logger.ts`; audit logs store PHI *encrypted*.
- **Prod log level**: `warn` and above only (debug/info suppressed in `config.isProduction`).

Treat "app log" and "audit log" as **different systems**. This prompt covers app logs. Audit log review is [05-audit-logging](./05-audit-logging.md).

---

## Checklist

### 1. Redaction coverage
- [ ] `SENSITIVE_FIELDS` set in `logger.ts` covers every PHI field from [PHI inventory](./_phi-inventory.md), plus `password`, `token`, `refreshToken`, `accessToken`, `secret`, `authorization`, cookie names.
- [ ] Recursion (`sanitizeData`) descends into nested objects — but is **bounded** (guards against cyclic references / DoS via deep recursion).
- [ ] Arrays of objects sanitized (the current `sanitizeData` skips arrays — verify this is intentional or a gap).
- [ ] Key matching is case-insensitive (field named `Password` shouldn't leak because the check is on `password`).
- [ ] Redaction marker is a sentinel (`[REDACTED]`), never the original value.

### 2. No PHI in free-form log messages
- [ ] No log message interpolates a PHI field directly: `logger.info("Created biomarker " + value)` is a finding even if `value` is sanitized elsewhere.
- [ ] Error messages sent to logs don't include request bodies raw — bodies go through `sanitizeData` first.
- [ ] Stack traces safe: stack traces reference file paths and line numbers, not data. Verify that `error.message` constructed from user input is redacted or generic.

### 3. Console usage audit
- [ ] No bare `console.log`, `console.info`, `console.warn`, `console.error` in `backend/src/` outside `logger.ts`.
- [ ] No bare `console.*` in `src/` outside `src/utils/logger.ts` (frontend).
- [ ] `debugger` statements absent.
- [ ] `console.trace` absent.

### 4. Environment-aware log levels
- [ ] Production suppresses `debug` and `info` (confirm in `logger.ts` the `config.isProduction` gate).
- [ ] Development does **not** log production-only secrets even in verbose mode (no `process.env` dumps).
- [ ] No `NODE_ENV=production` bypass via env variable manipulation that would re-enable debug logging.

### 5. Request/response logging
- [ ] Incoming request logging (if present) redacts cookies, auth headers, request body PHI.
- [ ] Response logging (if present) redacts response body PHI (biomarker lists, insurance plans).
- [ ] `X-CSRF-Token`, `Cookie`, `Authorization` headers always redacted.
- [ ] Request IDs logged for correlation (uuid v4 or `req.id` middleware).

### 6. Error → log pipeline
- [ ] `errorHandler.ts` sends structured error to logger, not a stringified object with PHI.
- [ ] `AppError.message` fields reviewed — they're user-facing, so logging them is fine, but confirm none accidentally contain interpolated PHI.
- [ ] 5xx errors include enough context server-side to debug (operation, userId, requestId) without leaking PHI.
- [ ] 4xx errors logged at `warn` (expected operator-level signal), 5xx at `error`.

### 7. External call logging
- [ ] Claude API calls: request payloads **not** logged (may contain PHI even after `stripPHIFromText`).
- [ ] SendGrid calls: email body not logged; template name + recipient hash OK.
- [ ] GCS signed URL generation: URL is NOT logged (contains auth token).
- [ ] Document AI calls: document bytes not logged, processor ID and file key OK.

### 8. `stripPHIFromText()` usage
- [ ] Called before every Claude API request that includes user-supplied text or OCR'd document text.
- [ ] Regex patterns cover: SSN, MRN, phone (US), DOB labels, street addresses. Verify in `phiRedaction.ts`.
- [ ] Email addresses — **not** currently stripped; decide if that's an accepted risk or a gap.
- [ ] Medical record numbers beyond "MRN" label (e.g., raw digit strings without label) are a known limitation — flag if relevant to your data.
- [ ] Output length roughly matches input length (sanity check the regex didn't over-match).

### 9. Cloud Logging (infra)
- [ ] Cloud Run log retention configured (default 30 days, HIPAA minimum is implicit — check with legal).
- [ ] Log sink exports to a restricted bucket (not publicly readable).
- [ ] No app logs routed to a third-party APM that lacks a BAA (Datadog, Sentry, etc. — if used, BAA required).
- [ ] Cloud Logging IAM: `roles/logging.viewer` granted minimally; no public access.

### 10. Structured logging opportunity (Info / Low)
- [ ] Current logger emits `console.log` strings — not machine-parseable JSON. Cloud Logging can parse `severity`, `message`, `labels` when emitted as JSON. Consider migrating for filterable dashboards. **Info-level finding** unless there's an active need.

---

## Verification (Claude Code tools)

| Check | Tool | Parameters |
|---|---|---|
| Bare `console.*` in backend | Grep | `pattern: "console\\.(log\|info\|warn\|error\|trace)"`, `glob: "backend/src/**/*.ts"`, exclude `logger.ts` |
| Bare `console.*` in frontend | Grep | `pattern: "console\\.(log\|info\|warn\|error)"`, `glob: "src/**/*.{ts,tsx}"`, exclude `logger.ts` |
| Who uses `stripPHIFromText` | Grep | `pattern: "stripPHIFromText"`, `glob: "backend/src/**/*.ts"` |
| Uses of `logger` | Grep | `pattern: "logger\\.(debug\|info\|warn\|error)"`, `glob: "backend/src/**/*.ts"`, `output_mode: "count"` |
| `SENSITIVE_FIELDS` completeness | Read | `backend/src/utils/logger.ts`, compare to `PHI_FIELDS` in encryption.ts |

---

## Questions to ask the user

1. What's the Cloud Logging retention policy today? (Default 30 days may not satisfy your breach-investigation window.)
2. Do you use a third-party APM (Sentry, Datadog, Honeybadger)? If yes, is there a BAA?
3. Is there a runbook for extracting logs during an incident, without exposing PHI to engineers without training?
4. Are alerts configured on specific log patterns (failed logins, lockouts, 5xx spikes)?
5. Is there a redaction regression test — deliberately logs a known PHI string and asserts the output is `[REDACTED]`?
