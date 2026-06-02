# 31-logging-observability Review — 2026-06-01

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 3 |
| Info | 2 |

Scope: backend + frontend application logging only. Audit-log channel (`audit_logs`) is out of scope (see [05-audit-logging](../../prompts/05-audit-logging.md)). Cloud Logging infra (retention, sinks, IAM) is GCP-managed and not in the repo — see Unverifiable.

---

## Findings

### F-1 — OCR rejects PHI by logging the raw biomarker value — **High**
- **Location:** `backend/src/services/ocrService.ts:223`
- **Observation:** When a Claude/Document-AI-extracted biomarker fails validation, the handler logs the raw extracted `value` (and `biomarkerName`) at `warn` level. `value` is NOT a `SENSITIVE_FIELDS` key (only `valueEncrypted` and `biomarker` are), so `sanitizeData` passes it through verbatim. `warn` survives the production gate, so the value rides into Cloud Logging in cleartext. A biomarker measurement is PHI.
- **Impact:** A lab result value (e.g. a glucose reading, a hormone level, a viral load) the patient uploaded is persisted to Cloud Logging unredacted. Any operator with `logging.viewer` reads PHI without an audit-log entry — exactly the HIPAA-breach class this prompt exists to prevent. Triggered on every malformed/out-of-range extraction, which is common on messy lab PDFs, so blast radius is "any user who uploads a lab report with an unusual value."
- **Fix:** Drop `value` from the log object at `ocrService.ts:223-227`; log only `biomarkerName` + `validationReason` (the diagnostic that matters). Alternatively add `value` to `SENSITIVE_FIELDS` in `logger.ts`, but per-call removal is cleaner since the value has no operational use here.
- **Evidence:**
  ```ts
  ocrLogger.warn('Invalid biomarker value discarded', {
    biomarkerName: b.name,
    value: b.value,
    validationReason: validationResult.reason,
  });
  ```

### F-2 — Snake_case FHIR OAuth tokens are not in the backend redaction set — **Medium**
- **Location:** `backend/src/utils/logger.ts:21-30`
- **Observation:** The backend `SENSITIVE_FIELDS` set has camelCase `accessToken`/`refreshToken` but NO snake_case `access_token`/`refresh_token`, and no `authorization` or `cookie`. The SMART-on-FHIR layer carries OAuth tokens under snake_case keys (`backend/src/services/fhir/types.ts:116` `access_token`, `:120` `refresh_token`; raw token JSON from the OAuth server uses these names). If any future code logs a raw token response object (`{ access_token: "..." }`) it would pass through `sanitizeData` unredacted. A stolen Quest/LabCorp access token is a direct path to live PHI at the lab.
- **Impact:** Defense-in-depth gap, not an active leak today — I confirmed no current FHIR caller logs a token object (all `smartAuth.ts`/`labSyncService.ts` log calls carry only `status`, `error.message`, `userId`, `connectionId`; see Checks passed). The risk is a one-line regression silently bypassing redaction. Same gap also covers `authorization`/`cookie` headers if a header object is ever logged.
- **Fix:** Add `access_token`, `refresh_token`, `authorization`, `cookie` to `SENSITIVE_FIELDS` in `logger.ts:21`. The matcher already lowercases keys, so the snake_case entries will fire on raw OAuth payloads.
- **Evidence:**
  ```ts
  const SENSITIVE_FIELDS = new Set([
    'password', 'token', 'accessToken', 'refreshToken', 'secret',
    ... // no access_token / refresh_token / authorization / cookie
  ```

### F-3 — `sanitizeData`/`sanitizeValue` recursion has no depth or cycle guard — **Medium**
- **Location:** `backend/src/utils/logger.ts:39-56`
- **Observation:** `sanitizeValue` → `sanitizeData` recurse into every nested object and array with no depth cap and no visited-set. A self-referential object (`a.self = a`) or a deeply nested structure passed as `options.data` recurses until the stack overflows, crashing the logging call — and, because logging often runs inside an error handler, potentially the request.
- **Impact:** DoS / availability risk if an untrusted shape reaches `logger.*({ data })`. Most callers pass hand-built objects (IDs, counts, error messages), which bounds real-world exposure, but `errorHandler.ts` and several controllers log derived objects; a Prisma error `meta` or a parsed JSON body could in principle carry a cyclic/deep shape. Lower than F-1/F-2 because reaching it requires an attacker-shaped object on a logged path.
- **Fix:** Add a `depth` parameter (cap ~8) and/or a `WeakSet` of visited objects to `sanitizeValue` in `logger.ts`; return `'[TRUNCATED]'` past the cap. The frontend `sanitizeData` (`src/utils/logger.ts:32`) has the same shape and should get the same guard.
- **Evidence:**
  ```ts
  function sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    ...
    return sanitizeData(value as Record<string, unknown>);
  ```

### F-4 — Logger structured-JSON + level suppression skip the staging environment — **Low**
- **Location:** `backend/src/utils/logger.ts:80`, `:88` (gates on `config.isProduction` only)
- **Observation:** The logger keys exclusively on `config.isProduction` (`NODE_ENV === 'production'`). `config.isStaging` exists (`config/index.ts:231`) but the logger never consults it. So a deployed **staging** environment: (a) does NOT suppress `debug`/`info`, (b) does NOT emit Cloud-Logging structured JSON — it uses the dev pretty-text `console.*` branch, and (c) leaves `logger.auth(...)` enabled (it gates on `!config.isProduction`, so auth-flow logs are emitted in staging).
- **Impact:** Staging Cloud Logging gets verbose, non-machine-parseable output and auth-flow logs. Output still passes through `sanitizeData`, so no raw PHI from the `data` channel — but verbosity + auth logs in a deployed env is a hardening gap, and staging often holds real-ish PHI. Note morgan correctly uses `PROD_LOG_FORMAT` for staging (it gates on `config.isDevelopment`, false for staging), so this gap is logger-only.
- **Fix:** Change the production gates in `logger.ts` to `config.isProduction || config.isStaging` (or a derived `config.isDeployed`), and gate `logger.auth` the same way.
- **Evidence:**
  ```ts
  if (config.isProduction && (level === 'debug' || level === 'info')) {
    return;
  }
  ```

### F-5 — Recipient email logged in cleartext (interpolated and as raw `data.to`) — **Low**
- **Location:** `backend/src/services/emailService.ts:306`, `:330`, `:335`, `:338`
- **Observation:** Email send paths log the recipient address two ways: interpolated into the message string (`... to ${to}`) which bypasses `sanitizeData` entirely, and as `data: { to, subject }` — `to` is not a `SENSITIVE_FIELDS` key (only `email` is), so it is not redacted. The spec's item 7.2 calls for "template name + recipient **hash**", not the raw address.
- **Impact:** Low. Per the PHI inventory, email alone is "not classified as PHI" but should be "log-redacted as precaution." Lines 306/335/338 are `warn`/`error` (survive production); 330 is `info` (suppressed in prod). The leak is an identifier, not health data, and only on the email path. Still a deviation from the redaction-as-precaution policy.
- **Fix:** Replace `${to}` with a hash or domain-only form in the message strings, and rename the field to `email` (which IS redacted) or hash it in the `data` object at `emailService.ts:335`/`:338`.
- **Evidence:**
  ```ts
  logger.info(`${deliveryLabel}: ${subject} to ${to}`, { prefix: 'Email' });
  ...
  logger.error(`Failed to send email: ${errorMessage}`, { prefix: 'Email', data: { to, subject } });
  ```

### F-6 — Prompt drift: spec says `claudeResponse` covers cost-analysis output; live field is `claudeResponseEncrypted` — **Low**
- **Location:** Spec `31-logging-observability.md` checklist 1 (`claudeResponse` listed in `SENSITIVE_FIELDS`) vs `backend/src/utils/logger.ts:28`
- **Observation:** `SENSITIVE_FIELDS` keys on the un-suffixed `claudeResponse`, but the persisted/returned field was renamed to `claudeResponseEncrypted` (migration `20260424...`, `encryption.ts:476`, `expenseController.ts:737`). The logger key `claudeResponse` would NOT match a logged `claudeResponseEncrypted` field. In practice no caller logs the cost-analysis response object (it is `stripPHIFromText`'d then encrypted before the DB write, and never passed to `logger`), so this is latent, not an active leak — but the prompt presents `claudeResponse` as a live guard that no longer matches the field name that reaches the DB layer.
- **Impact:** Documentation/consistency drift; combined with F-2 it shows the set keys on un-suffixed names while several PHI fields reach code under `*Encrypted` (or snake_case) names. No exploit today.
- **Fix:** In `logger.ts` either key on substrings (`key.includes('encrypted')`) or add the suffixed names; update the spec note. Tracked separately in PHI_TAXONOMY.md "Logger redaction drift" per `logger.test.ts:27-34`.
- **Evidence:**
  ```ts
  // logger.ts:28
  'responseText', 'jsonText', 'claudeResponse', 'guidance',
  ```

### F-7 — `genotype` retained in both redaction sets after DNA/Genetics models dropped — **Info**
- **Location:** `backend/src/utils/logger.ts:25`, `src/utils/logger.ts:24`
- **Observation:** Both `SENSITIVE_FIELDS` sets still list `genotype`, but the `DNAVariant`/`GeneticTrait` models were dropped in migration `20260423_drop_dna_genetics` (per PHI inventory — confirmed no DNA fields in `PHI_FIELDS`, `encryption.ts:410-486`). Harmless dead entry; flagged to keep the set honest per checklist item 1.7.
- **Impact:** None. A redacting entry for a field that no longer exists is fail-safe.
- **Fix:** Optionally remove `genotype` from both sets in a cleanup commit.
- **Evidence:**
  ```ts
  'descriptionEncrypted', 'noteEncrypted', 'genotype',
  ```

### F-8 — `redactPatientBanner` is fully unwired (designed-but-dead) — **Info**
- **Location:** `backend/src/utils/pdfRedaction.ts:47` (only definition; zero callers)
- **Observation:** Grep for `redactPatientBanner` across `backend/src/**/*.ts` returns only the definition. `claudeExtraction.ts` and `sbcExtraction.ts` deliberately reject scanned PDFs and route them to OCR (no Claude Vision fallback), so the helper's vision path does not exist. Its own logging (`pdfRedaction.ts:73`, `:82`) logs only `pages`, `bannerFraction`, byte counts, and `error.message` — no PHI — so it is safe if/when reintroduced. The fail-open behavior (returns original buffer on pdf-lib error, `:88`) and the 15% banner fraction (`:35`) would need re-review before any vision path is wired up.
- **Impact:** None currently (dead code). Flagged per checklist items 8.7 and the spec's "Files to Review" note.
- **Fix:** None required. If a vision path returns, re-evaluate fail-open vs fail-closed and confirm banner coverage before relying on it.
- **Evidence:**
  ```ts
  export async function redactPatientBanner(pdfBuffer: Buffer): Promise<Buffer> {
  ```

---

## Checks passed

### 1. Redaction coverage
- [x] `[REDACTED]` sentinel used, never the original value — `logger.ts:50`.
- [x] Key matching is case-insensitive (`key.toLowerCase()`) — `logger.ts:49`; frontend `src/utils/logger.ts:47`.
- [x] Arrays of objects sanitized element-by-element (F-21 path intact) — `logger.ts:41` (`value.map(sanitizeValue)`); regression test `logger.test.ts:36-57`.
- [x] Nested objects recursed — `logger.ts:42-43`, `:52`.
- [x] AI/extraction fields covered: `responseText`, `jsonText`, `claudeResponse`, `guidance`, `extractedData`, `pdfText`, `pdfContent`, `biomarker` present — `logger.ts:28-29`. (Caveat: `claudeResponse` name drift, see F-6.)
- [x] Core PHI keys present (`valueEncrypted`, `memberIdEncrypted`, `groupIdEncrypted`, `descriptionEncrypted`, `noteEncrypted`, `dateOfBirth`, `address`, `phoneNumber`, `ssn`) — `logger.ts:22-26`.

### 2. No PHI in free-form messages
- [x] Controller/service log messages carry only IDs/counts/timing/error-messages, not PHI values — `biomarkerController.ts:168` (`userId`, `count`, `total`), `labUploadController.ts:74,238,275` (`fileId`, `storageKey`, `userId`).
- [x] Error handler routes a structured object through the logger, not a raw stringified body — `errorHandler.ts:178-188`.

### 3. Console usage audit
- [x] No bare `console.*` in `backend/src/` outside `logger.ts` — Grep returns only `logger.ts` (implementation), `logger.test.ts` (test), and comment-only matches in `pdfParser.ts:51,148`.
- [x] No bare `console.*` in `src/` outside `src/utils/logger.ts` — Grep returns only `logger.ts` and comments (`AuthContext.tsx:107`, `useBiomarkerStats.ts:34`, test at `AuthContext.test.tsx:495`).
- [x] No `debugger` and no `console.trace` anywhere in `backend/src` or `src` — Grep "No matches found".

### 4. Environment-aware log levels
- [x] Production suppresses `debug`/`info` — `logger.ts:80`.
- [x] `logger.auth` additionally suppressed in production — `logger.ts:150-154`.
- [x] No `process.env` dumps in logger or verbose paths — no such pattern found; `config.isProduction` derives from `NODE_ENV === 'production'` (`config/index.ts:34`), no env-var override re-enables debug. (Staging caveat → F-4.)

### 5. Request/response logging (morgan)
- [x] Production morgan format strips query strings (custom `urlpath` token splits on `?`) and omits Referer — `app.ts:231-237`, guarding against `?token=` verification/reset secrets reaching Cloud Logging (`app.ts:224-230`).
- [x] Dev uses `morgan('dev')`, prod/staging use `PROD_LOG_FORMAT` (path-only) — `app.ts:239-245`.
- [x] No request/response **body** logging present (no body-dump middleware found).

### 6. Error → log pipeline
- [x] 5xx logged at `error`; 4xx logged at `warn` only in development — `errorHandler.ts:190-196`.
- [x] Stack traces only attached in development (`config.isDevelopment && { stack }`) and never in the production response body — `errorHandler.ts:186`, `:206`.
- [x] 5xx context includes operation metadata (`statusCode`, `code`, `method`, `path`, `userId`) without PHI — `errorHandler.ts:181-187`.

### 7. External call logging
- [x] Claude request payloads not logged; only `model` + redacted lengths — `claudeExtraction.ts:145-148`, `:137-141`.
- [x] GCS signed URLs not logged — `storageService.ts` proxies bytes via `getFileStream` (`:108-112`) instead of signed URLs; logged objects carry only `storageKey`/`bucket`/`size` (`:73-79`, `:126-131`).
- [x] Document AI: document bytes not logged; only `bufferSize`/`mimeType`/`textLength`/`pageCount`/`confidence` — `ocrService.ts:210-212`, `:282-285`, `:308-311`, `:349-355`. (Separate value-logging bug → F-1.)
- [x] FHIR OAuth: revocation failures log only `status`/`error.message`, never the token — `smartAuth.ts:296-298`, `:301-303`; `labSyncService.ts:407-409`, `:435-437`. `fhirClient.ts:48-54` builds the Bearer header but does not log the request.
- [x] FHIR tokens stored encrypted, never logged plaintext — `labSyncService.ts:142-143`, `:152-162` (encrypt before write); `:354-357` logs only `userId`/`provider`/`unmappedCodes`.
- [x] FHIR `urlSafety` rejections throw with the attempted host (operator signal, not user PHI) — `urlSafety.ts:82-89`; not self-logged.
- [x] AI cost/spend events log aggregate metadata only (endpoint, model, token counts, cost, userId) — `aiCostTracker.ts:97-104`; `aiSpendGuard.ts:36-38` logs `userId`/`scope`/`path`.

### 8. `redactPHI()` / `stripPHIFromText()` usage
- [x] Applied before every Claude call with user text — `claudeExtraction.ts:135`, `sbcExtraction.ts:794`, `expenseController.ts:679`, `aiChatController.ts:222,233`, `healthContextService.ts:571`, `biomarkerRoutes.ts:244`.
- [x] Applied to BOTH input and output (response also scrubbed) — `claudeExtraction.ts:182`, `sbcExtraction.ts:836`, `expenseController.ts:713`, `aiChatController.ts:222,233` (streaming with cross-chunk buffer), `biomarkerRoutes.ts:244`.
- [x] `firedPatterns` logged as diagnostic metadata; pre-redaction `text` never logged — `claudeExtraction.ts:137-141`, `sbcExtraction.ts:794`.
- [x] `PHI_PATTERNS` cover SSN, MRN, NPI, DEA, US phone, email (`[EMAIL_REDACTED]`), labeled/contextual/freestanding DOB+date, street address, ZIP (with reference-range lookahead), labeled patient name — `phiRedaction.ts:17-77`.
- [x] Ordering correct: labeled NPI/DEA/MRN/DOB run before generic phone/ZIP/date matchers — `phiRedaction.ts:17-57` (SSN→MRN→NPI→DEA→phone→email→DOB labeled→DOB contextual→date→address→ZIP→name).
- [x] Regression test exists for `redactPHI`/`stripPHIFromText` — `phiRedaction.test.ts:12-156`.

### 10. Structured logging
- [x] Production emits single-line JSON with Cloud Logging reserved fields (`severity`, `message`, `timestamp`, `service`, merged sanitized `data`) — `logger.ts:88-104`.
- [x] Merged `data` passes through `sanitizeData` before entering the JSON entry — `logger.ts:86`, `:97`.
- [x] warn/error → `stderr`, debug/info → `stdout` for correct Cloud Run severity split — `logger.ts:99-103`.
- [x] `severity` values use Cloud Logging vocabulary (`DEBUG`/`INFO`/`WARNING`/`ERROR`) — `logger.ts:63-68`.
- [x] No third-party APM (Sentry/Datadog/Honeybadger/New Relic) wired — Grep across `backend/**/*.{ts,json}` returns "No matches found", so no missing-BAA APM risk (checklist 9.3).

---

## Unverifiable
- **Cloud Run log retention (checklist 9.1)** — configured in GCP, not in the repo; `deploy.yml`/`deploy-staging.yml` set no `--log-*` flags. Confirm 30-day default vs HIPAA breach-investigation window in the GCP console.
- **Log sink → restricted bucket (9.2)** and **Cloud Logging IAM `logging.viewer` minimization (9.4)** — GCP-side config, absent from the repo. Verify in GCP console / Terraform (no Terraform present).
- **Request-ID correlation (checklist 5.4)** — no `req.id`/uuid request-ID middleware found in `backend/src` (the `requestId` hits in `patientRoutes.ts:148` are a domain field, not a log correlation ID). Morgan's prod format carries no request ID. Whether Cloud Run's auto-injected `trace`/`logging.googleapis.com/trace` is relied upon for correlation is an infra decision not visible in the repo — flag for the user.

## Out of scope
- Audit-log channel (`auditLog.ts`, `audit_logs` table) — covered by [05-audit-logging](../../prompts/05-audit-logging.md); this review is application logs only, per the spec.
- `errorHandler.ts` full error-serialization review — deferred to [32-error-handling](../../prompts/32-error-handling.md); I confirmed only the logging-relevant lines here.
- PHI-encryption correctness of `PHI_FIELDS` vs schema — owned by [02-encryption](../../prompts/02-encryption.md) / [_phi-inventory](../../prompts/_phi-inventory.md); used here only as the redaction-coverage reference.

## Open questions for the user (from spec)
1. Cloud Logging retention policy today (default 30 days may miss the breach-investigation window)?
2. Confirmed: no third-party APM in code — but is anything attached at the GCP project level that would need a BAA?
3. Is there an incident log-extraction runbook that keeps PHI away from untrained engineers?
4. Are alerts configured on log patterns (failed logins, lockouts, 5xx spikes)? None defined in-repo.
5. There is an array-recursion test (`logger.test.ts`) but NO test asserting the `SENSITIVE_FIELDS`/`sanitizeData` path redacts the snake_case FHIR token gap (F-2) — add one alongside the F-2 fix.
