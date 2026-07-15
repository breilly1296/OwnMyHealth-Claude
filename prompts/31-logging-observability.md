---
tags:
  - security
  - hipaa
  - observability
  - high
type: prompt
priority: 2
updated: 2026-06-16
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
- `backend/src/middleware/errorHandler.ts` — error serialization to logs (see [32-error-handling](./32-error-handling.md))
- `backend/src/services/auditLog.ts` — HIPAA audit trail (structurally distinct from application logs)
- `src/utils/logger.ts` — frontend logger (separate `SENSITIVE_FIELDS` set; gated on `import.meta.env.PROD` and `VITE_DEBUG`)
- `backend/src/maintenance/` — one-off CLI maintenance scripts (`backfillUserFileNames.ts`, `backfillGoalValues.ts`, `consolidateBiomarkerSeries.ts`) that legitimately use `console.log`/`console.error` (not the structured logger) to report progress. They log user IDs + counts (non-PHI) — confirm new scripts stay non-PHI and that nothing PHI-bearing (e.g. decrypted values, filenames) is printed.
- Any `console.log`, `console.error`, `console.warn` outside the logger and the `backend/src/maintenance/` scripts (the only `console.*` strings in `pdfParser.ts` are in comments, not calls; the maintenance scripts are real calls but are CLI-only and non-PHI by design)
- Cloud Run log sink configuration (infra, not in repo — check deploy.yml / deploy-staging.yml / GCP console)

## OwnMyHealth Logging Architecture
- **App logs** → in production, single-line structured JSON written to `process.stdout`/`process.stderr` (warn/error → stderr) with Cloud Logging reserved fields (`severity`, `message`, `timestamp`, optional `service`); in dev/test, pretty text via `console.*`. Cloud Run captures both → Cloud Logging.
- **Audit logs** → PostgreSQL `audit_logs` table (separate channel, encrypted PHI values, 7-year retention).
- **PHI policy**: app logs get redacted at write-time via `logger.ts` (`sanitizeData`); free-text bound for Claude gets `redactPHI()`/`stripPHIFromText()` on the text-only extraction path; audit logs store PHI *encrypted*. (There is no longer any PDF-vision redaction helper — the old `pdfRedaction.ts`/`redactPatientBanner()` was deleted; scanned PDFs route to OCR, not Claude Vision.)
- **Prod/staging log level**: `warn` and above only — debug/info are suppressed whenever `useProductionLogging = config.isProduction || config.isStaging` is true (the L-4 change, `logger.ts:18`), so a deployed STAGING box behaves like prod. `logger.auth(...)` is additionally suppressed entirely under `useProductionLogging` (`logger.ts:179`). Only local dev (`npm run dev`) stays verbose.

Treat "app log" and "audit log" as **different systems**. This prompt covers app logs. Audit log review is [05-audit-logging](./05-audit-logging.md).

---

## Checklist

### 1. Redaction coverage
- [ ] `SENSITIVE_FIELDS` set in `logger.ts` (declaration at `logger.ts:30`) covers every PHI field from [PHI inventory](./_phi-inventory.md), plus `password`, `token`, `refreshToken`, `accessToken`, `secret`, `authorization`, cookie names. The previously-flagged FHIR/HTTP-header gap is now CLOSED: the backend set explicitly includes `access_token`, `refresh_token`, `authorization`, and `cookie` (`logger.ts:31-33`), so a raw token logged under the snake_case FHIR/OAuth keys (`services/fhir/smartAuth.ts`, `types.ts`) IS redacted. Verify this stays true and that no NEW snake_case token/header key bypasses the set; the frontend set (`src/utils/logger.ts`) includes `authorization`, `cookie`, `sessionId` — confirm it also keeps pace with any new snake_case token keys.
- [ ] PHI-field membership tracks `PHI_FIELDS` in `encryption.ts` (`encryption.ts:476`) — confirm new encrypted fields are reflected. Post-2026-06-01, `PHI_FIELDS` grew (now 14 models / 39 fields) with several fields the `SENSITIVE_FIELDS` sync check must account for: `UserFile.originalFilenameEncrypted` (L24 filename encryption, `encryption.ts:499`), `HealthGoal.currentValueEncrypted`/`startValueEncrypted` (M4, `encryption.ts:519-520`), `GoalProgressHistory.valueEncrypted` (M4, `encryption.ts:524`), `AuditLog.metadataEncrypted` (M6, `encryption.ts:530` — replaced the dropped plaintext `metadata` column, migration `20260615_drop_legacy_audit_metadata`), plus the older `healthProfileEncrypted`, `targetValueEncrypted`, the `CostAnalysis` trio `claudeResponseEncrypted`/`totalProjectedOopEncrypted`/`projectedExpensesSnapshotEncrypted` (`encryption.ts:552-554`), and the `LabConnection` `accessTokenEncrypted`/`refreshTokenEncrypted`. The logger keys on un-suffixed names (`valueEncrypted`, `noteEncrypted`, etc.), so verify the lowercase key it checks actually matches the field names that reach a log call.
- [ ] Recursion (`sanitizeData` → `sanitizeValue`) descends into nested objects and arrays — and is now **bounded**: a `MAX_SANITIZE_DEPTH = 8` cap collapses anything deeper to `'[MAX_DEPTH]'` (`logger.ts:45`, `:60`), and a per-walk `seen` `WeakSet` returns `'[CIRCULAR]'` on self-referential objects (`logger.ts:57`, `:61-62`, threaded through `sanitizeData`/`sanitizeValue`). The prior unbounded-recursion / cyclic-reference concern is resolved — verify both guards stay wired (depth + `seen`) if the sanitize helpers are refactored.
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
- [ ] No bare `console.log`, `console.info`, `console.warn`, `console.error` in `backend/src/` outside `logger.ts` and the `backend/src/maintenance/` CLI scripts. (Note: the only `console.*` strings in `services/pdfParser.ts` are in comments explaining why the structured logger is used instead — not calls. The three `backend/src/maintenance/` scripts — `backfillUserFileNames.ts`, `backfillGoalValues.ts`, `consolidateBiomarkerSeries.ts` — DO make real `console.log`/`console.error` calls; that is acceptable for one-off CLI jobs, but confirm they print only user IDs + counts and no decrypted PHI. Verify any new match is similarly benign or a real finding.)
- [ ] No bare `console.*` in `src/` outside `src/utils/logger.ts` (frontend).
- [ ] `debugger` statements absent.
- [ ] `console.trace` absent.

### 4. Environment-aware log levels
- [ ] Production AND staging suppress `debug` and `info` (confirm the `useProductionLogging = config.isProduction || config.isStaging` gate at `logger.ts:18`, applied at `:107`). A deployed staging tier must NOT fall back to verbose pretty-text; only local dev does.
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
- [ ] PDF vision redaction: there is no PDF-vision redaction helper in the codebase — the old `pdfRedaction.ts` / `redactPatientBanner()` (15%-banner cover, fail-open) was DELETED, with zero remaining callers or symbols. Scanned PDFs route to OCR (Google Document AI), not Claude Vision; there is no longer a "no Claude Vision fallback" comment in `claudeExtraction.ts` / `sbcExtraction.ts`. If a vision path is ever reintroduced, treat banner-redaction design + fail mode + PHI-logging as a fresh review item.
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
| Bare `console.*` in backend | Grep | `pattern: "console\\.(log\|info\|warn\|error\|trace)"`, `glob: "backend/src/**/*.ts"`, exclude `logger.ts` (only comment matches expected in `pdfParser.ts`; real calls in `backend/src/maintenance/` CLI scripts are expected/benign) |
| Bare `console.*` in frontend | Grep | `pattern: "console\\.(log\|info\|warn\|error)"`, `glob: "src/**/*.{ts,tsx}"`, exclude `logger.ts` |
| Who uses `redactPHI` / `stripPHIFromText` | Grep | `pattern: "redactPHI\|stripPHIFromText"`, `glob: "backend/src/**/*.ts"` |
| `pdfRedaction` / `redactPatientBanner` fully gone | Grep | `pattern: "redactPatientBanner\|pdfRedaction"`, `glob: "backend/src/**/*.ts"` — expect ZERO matches (helper + file deleted) |
| FHIR token fields reaching logs | Grep | `pattern: "access_token\|refresh_token\|accessToken\|refreshToken"`, `glob: "backend/src/services/fhir/**/*.ts"` |
| Uses of `logger` | Grep | `pattern: "logger\\.(debug\|info\|warn\|error)"`, `glob: "backend/src/**/*.ts"`, `output_mode: "count"` |
| `SENSITIVE_FIELDS` completeness | Read | `backend/src/utils/logger.ts` (declaration at line 30) and `src/utils/logger.ts`, compare to `PHI_FIELDS` in `encryption.ts` (line 476) |

---

## Questions to ask the user

1. What's the Cloud Logging retention policy today? (Default 30 days may not satisfy your breach-investigation window.)
2. Do you use a third-party APM (Sentry, Datadog, Honeybadger)? If yes, is there a BAA?
3. Is there a runbook for extracting logs during an incident, without exposing PHI to engineers without training?
4. Are alerts configured on specific log patterns (failed logins, lockouts, 5xx spikes)?
5. Is there a redaction regression test — deliberately logs a known PHI string and asserts the output is `[REDACTED]`? (`phiRedaction.test.ts` covers `redactPHI`/`stripPHIFromText`, but is there an equivalent test for the `logger.ts` `SENSITIVE_FIELDS` / `sanitizeData` path, especially the snake_case FHIR token gap?)
6. Quest FHIR tokens are stored encrypted, but are the OAuth flow's `access_token`/`refresh_token`/`code` ever surfaced in a log line during token exchange or revocation failures? Is there a monitoring rule to catch a regression?
7. AI chat / extraction prompts are PHI-scrubbed before Claude, but are the daily-budget / spend-guard events (`aiCostTracker`, `aiSpendGuard`, `usageTracker`) logged with only aggregate cost metadata and no prompt content?
