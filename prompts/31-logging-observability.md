---
tags:
  - security
  - hipaa
  - observability
  - high
type: prompt
priority: 2
updated: 2026-06-01
---

# Logging & Observability Review

> Follow the [review protocol](./_review-protocol.md) for output format and severity rubric.
> Reference the [PHI inventory](./_phi-inventory.md) for what must never appear in logs.
> Use [Claude Code tools](./_verification-tools.md), not Bash grep.

## Why this prompt exists

Five other prompts say "no PHI in logs" in a checklist item. None of them actually *reviews* the logging layer. A single leaked log line is a HIPAA breach. This prompt owns that review.

## Files to Review
- `backend/src/utils/logger.ts` — app-level logger (`SENSITIVE_FIELDS` set, `sanitizeData`/`sanitizeValue` recursion, prod JSON output with `SEVERITY_BY_LEVEL`)
- `backend/src/utils/phiRedaction.ts` — `redactPHI()` (returns `{ text, firedPatterns }`) and the back-compat `stripPHIFromText()`; `PHI_PATTERNS` array covers SSN, MRN, NPI, DEA, phone, email, DOB (labeled/contextual/freestanding), street address, ZIP, labeled patient name
- `backend/src/utils/pdfRedaction.ts` — `redactPatientBanner()` draws an opaque cover over the top 15% banner of each PDF page; logs page count + byte deltas via its own `PDFRedaction` service logger (verify it logs no PHI). **Note: currently has ZERO callers** — `claudeExtraction.ts`/`sbcExtraction.ts` deliberately have NO Claude Vision fallback (scanned PDFs are rejected and routed to the OCR path), so this is designed-but-unwired. Flag the dead wiring and confirm it logs no PHI for if/when it is hooked up.
- `backend/src/middleware/errorHandler.ts` — error serialization to logs (see [32-error-handling](./32-error-handling.md))
- `backend/src/services/auditLog.ts` — HIPAA audit trail (structurally distinct from application logs)
- `src/utils/logger.ts` — frontend logger (separate `SENSITIVE_FIELDS` set; gated on `import.meta.env.PROD` and `VITE_DEBUG`)
- Any `console.log`, `console.error`, `console.warn` outside the logger (should be zero in `backend/src/` and `src/`; the only `console.*` strings in `pdfParser.ts` are in comments, not calls)
- Cloud Run log sink configuration (infra, not in repo — check deploy.yml / deploy-staging.yml / GCP console)

## OwnMyHealth Logging Architecture
- **App logs** → in production, single-line structured JSON written to `process.stdout`/`process.stderr` (warn/error → stderr) with Cloud Logging reserved fields (`severity`, `message`, `timestamp`, optional `service`); in dev/test, pretty text via `console.*`. Cloud Run captures both → Cloud Logging.
- **Audit logs** → PostgreSQL `audit_logs` table (separate channel, encrypted PHI values, 7-year retention).
- **PHI policy**: app logs get redacted at write-time via `logger.ts` (`sanitizeData`); free-text bound for Claude gets `redactPHI()`/`stripPHIFromText()` on the text-only extraction path; `redactPatientBanner()` exists for a PDF-vision path but that path was removed by design (no Claude Vision fallback — scanned PDFs go to OCR), so the helper is currently unwired; audit logs store PHI *encrypted*.
- **Prod log level**: `warn` and above only (debug/info suppressed in `config.isProduction`). `logger.auth(...)` is additionally suppressed entirely in production.

Treat "app log" and "audit log" as **different systems**. This prompt covers app logs. Audit log review is [05-audit-logging](./05-audit-logging.md).

---

## Checklist

### 1. Redaction coverage
- [ ] `SENSITIVE_FIELDS` set in `logger.ts` covers every PHI field from [PHI inventory](./_phi-inventory.md), plus `password`, `token`, `refreshToken`, `accessToken`, `secret`, `authorization`, cookie names. **Known gaps to flag:** the backend set (logger.ts ~line 21) currently has NO `authorization`, NO `cookie`, and NO snake_case `access_token` / `refresh_token` entries — the FHIR layer (`services/fhir/smartAuth.ts`, `types.ts`) carries OAuth tokens under the snake_case `access_token` / `refresh_token` keys, so a raw token set logged as `{ access_token: "..." }` would NOT be redacted. The frontend set (`src/utils/logger.ts`) does include `authorization`, `cookie`, `sessionId` but is likewise missing snake_case tokens.
- [ ] PHI-field membership tracks `PHI_FIELDS` in `encryption.ts` — confirm new encrypted fields are reflected (e.g. `healthProfileEncrypted`, `targetValueEncrypted`, `claudeResponseEncrypted`, and the `LabConnection` `accessTokenEncrypted`/`refreshTokenEncrypted`). The logger keys on un-suffixed names (`valueEncrypted`, `noteEncrypted`, etc.), so verify the lowercase key it checks actually matches the field names that reach a log call.
- [ ] Recursion (`sanitizeData` → `sanitizeValue`) descends into nested objects and arrays — but is **bounded** (guards against cyclic references / DoS via deep recursion; neither helper currently tracks a depth cap, so a self-referential object would recurse unbounded — flag if untrusted shapes can reach the logger).
- [ ] Arrays of objects sanitized — `sanitizeValue` now walks arrays element-by-element (fixed in F-21; previously a `biomarkers: [{ valueEncrypted }]` shape leaked through). Confirm the array path is still wired.
- [ ] Key matching is case-insensitive (the check lowercases the key, so a field named `Password` is still caught).
- [ ] Redaction marker is a sentinel (`[REDACTED]`), never the original value.
- [ ] AI/FHIR fields are redacted: backend `SENSITIVE_FIELDS` includes `responseText`, `jsonText`, `claudeResponse`, `guidance`, `extractedData`, `pdfText`, `pdfContent`, `biomarker` — confirm these still cover the AI chat / extraction payloads (`aiChatController.ts`, `claudeExtraction.ts`, `sbcExtraction.ts`, `healthContextService.ts`).
- [ ] `genotype` is still listed in both `SENSITIVE_FIELDS` sets even though DNA/Genetics models were dropped (migration `20260423_drop_dna_genetics`) — harmless dead entry; flag only as Info to keep the set honest.

### 2. No PHI in free-form log messages
- [ ] No log message interpolates a PHI field directly: `logger.info("Created biomarker " + value)` is a finding even if `value` is sanitized elsewhere.
- [ ] Error messages sent to logs don't include request bodies raw — bodies go through `sanitizeData` first.
- [ ] Stack traces safe: stack traces reference file paths and line numbers, not data. Verify that `error.message` constructed from user input is redacted or generic.

### 3. Console usage audit
- [ ] No bare `console.log`, `console.info`, `console.warn`, `console.error` in `backend/src/` outside `logger.ts`. (Note: the only `console.*` strings in `services/pdfParser.ts` are in comments explaining why the structured logger is used instead — not calls. Verify any new match is similarly benign or a real finding.)
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
- [ ] Claude API calls: request payloads **not** logged (may contain PHI even after `redactPHI`/`stripPHIFromText`). Applies to `claudeExtraction.ts`, `sbcExtraction.ts`, `aiChatController.ts`, `expenseController.ts`, and `healthContextService.ts`.
- [ ] SendGrid calls: email body not logged; template name + recipient hash OK (`emailService.ts`, `emailTemplates.ts`).
- [ ] GCS signed URL generation: URL is NOT logged (contains auth token) — `storageService.ts`.
- [ ] Document AI calls: document bytes not logged, processor ID and file key OK (`ocrService.ts`).
- [ ] Quest FHIR / SMART-on-FHIR calls: OAuth `access_token` / `refresh_token`, the `Authorization: Bearer` header, and the `code` exchange payload are **not** logged. `smartAuth.ts` token-revocation warnings (`Token revocation request failed`/`threw`) must not include the token itself; `fhirClient.ts` builds the bearer header — confirm requests aren't logged verbatim. Tokens are stored encrypted (`labSyncService.ts` → `LabConnection.accessTokenEncrypted`/`refreshTokenEncrypted`).
- [ ] FHIR `urlSafety` (SSRF guard): blocked-host rejections may log the attempted URL — confirm that's an operator signal, not user PHI.

### 8. `redactPHI()` / `stripPHIFromText()` usage
- [ ] Called before every Claude API request that includes user-supplied text or OCR'd document text. New code should prefer `redactPHI()` (returns `{ text, firedPatterns }`); `stripPHIFromText()` is a thin back-compat wrapper that discards `firedPatterns`. Confirmed callers: `claudeExtraction.ts`, `sbcExtraction.ts`, `aiChatController.ts` (streaming deltas), `expenseController.ts` (prompt + response), `healthContextService.ts`, `biomarkerRoutes.ts`.
- [ ] `firedPatterns` is logged as diagnostic metadata, NOT the original text — the design intent is "we stripped an SSN and a phone" is safe to persist, "we stripped 123-45-6789" is not. Verify no caller logs the pre-redaction `text`.
- [ ] `redactPHI` applied to BOTH input (before Claude) and output (after Claude) — verify the response path also scrubs (e.g. `aiChatController` streaming, `claudeExtraction`/`sbcExtraction` `responseText`, `expenseController` `claudeResponse`).
- [ ] `PHI_PATTERNS` cover: SSN, MRN (labeled), NPI, DEA, US phone, **email** (now stripped — `[EMAIL_REDACTED]`), DOB (labeled/contextual/freestanding date MM/DD/YYYY), street address, ZIP (5 or 5+4, with a lookahead skipping `reference-range` strings), and labeled patient name. Verify in `phiRedaction.ts`. (The old "email not stripped" note is STALE — email IS now covered.)
- [ ] Ordering matters: labeled NPI/DEA/MRN/DOB patterns run BEFORE the generic phone/ZIP/date matchers so labels aren't swallowed — flag if a new pattern is inserted out of order.
- [ ] Medical record numbers beyond a recognized label (e.g., raw digit strings without `MRN`/`Chart`/`Patient ID`) are a known limitation — flag if relevant to your data. Patient names without a `Patient:`/`Name:` label are not caught (regex limitation called out in the file header).
- [ ] PDF vision helper: `redactPatientBanner()` (`pdfRedaction.ts`) covers the top 15% banner and fails OPEN (returns the original buffer on a pdf-lib error, relying on the BAA). **It currently has NO callers** — `claudeExtraction.ts` (line ~87) and `sbcExtraction.ts` (line ~750) state there is deliberately no Claude Vision fallback; scanned PDFs are rejected and routed to OCR (Google Document AI). Flag this as designed-but-unwired, and confirm both that its failure mode and 15% banner fraction would still be acceptable if/when a vision path is reintroduced, and that the helper itself logs no PHI.
- [ ] Output length roughly matches input length (sanity check the regex didn't over-match).

### 9. Cloud Logging (infra)
- [ ] Cloud Run log retention configured (default 30 days, HIPAA minimum is implicit — check with legal).
- [ ] Log sink exports to a restricted bucket (not publicly readable).
- [ ] No app logs routed to a third-party APM that lacks a BAA (Datadog, Sentry, etc. — if used, BAA required).
- [ ] Cloud Logging IAM: `roles/logging.viewer` granted minimally; no public access.

### 10. Structured logging (verify, not migrate)
- [ ] Production logging now emits single-line JSON with Cloud Logging reserved fields (`severity`, `message`, `timestamp`, plus `service` from the prefix and the sanitized `data` merged in) — see the `config.isProduction` branch and `SEVERITY_BY_LEVEL` in `logger.ts`. (The old "emits `console.log` strings — not machine-parseable JSON" framing is STALE.) Verify: the merged `data` goes through `sanitizeData` first (it does at `log()`), so no raw PHI rides into the JSON entry; and that warn/error route to `stderr` while debug/info route to `stdout` for correct Cloud Run severity splitting.
- [ ] `severity` values map to Cloud Logging's vocabulary (`DEBUG`/`INFO`/`WARNING`/`ERROR`). Confirm no level emits a value Cloud Logging won't recognize.

---

## Verification (Claude Code tools)

| Check | Tool | Parameters |
|---|---|---|
| Bare `console.*` in backend | Grep | `pattern: "console\\.(log\|info\|warn\|error\|trace)"`, `glob: "backend/src/**/*.ts"`, exclude `logger.ts` (only comment matches expected in `pdfParser.ts`) |
| Bare `console.*` in frontend | Grep | `pattern: "console\\.(log\|info\|warn\|error)"`, `glob: "src/**/*.{ts,tsx}"`, exclude `logger.ts` |
| Who uses `redactPHI` / `stripPHIFromText` | Grep | `pattern: "redactPHI\|stripPHIFromText"`, `glob: "backend/src/**/*.ts"` |
| Who uses `redactPatientBanner` | Grep | `pattern: "redactPatientBanner"`, `glob: "backend/src/**/*.ts"` |
| FHIR token fields reaching logs | Grep | `pattern: "access_token\|refresh_token\|accessToken\|refreshToken"`, `glob: "backend/src/services/fhir/**/*.ts"` |
| Uses of `logger` | Grep | `pattern: "logger\\.(debug\|info\|warn\|error)"`, `glob: "backend/src/**/*.ts"`, `output_mode: "count"` |
| `SENSITIVE_FIELDS` completeness | Read | `backend/src/utils/logger.ts` (~line 21) and `src/utils/logger.ts`, compare to `PHI_FIELDS` in `encryption.ts` (~line 410) |

---

## Questions to ask the user

1. What's the Cloud Logging retention policy today? (Default 30 days may not satisfy your breach-investigation window.)
2. Do you use a third-party APM (Sentry, Datadog, Honeybadger)? If yes, is there a BAA?
3. Is there a runbook for extracting logs during an incident, without exposing PHI to engineers without training?
4. Are alerts configured on specific log patterns (failed logins, lockouts, 5xx spikes)?
5. Is there a redaction regression test — deliberately logs a known PHI string and asserts the output is `[REDACTED]`? (`phiRedaction.test.ts` covers `redactPHI`/`stripPHIFromText`, but is there an equivalent test for the `logger.ts` `SENSITIVE_FIELDS` / `sanitizeData` path, especially the snake_case FHIR token gap?)
6. Quest FHIR tokens are stored encrypted, but are the OAuth flow's `access_token`/`refresh_token`/`code` ever surfaced in a log line during token exchange or revocation failures? Is there a monitoring rule to catch a regression?
7. AI chat / extraction prompts are PHI-scrubbed before Claude, but are the daily-budget / spend-guard events (`aiCostTracker`, `aiSpendGuard`, `usageTracker`) logged with only aggregate cost metadata and no prompt content?
