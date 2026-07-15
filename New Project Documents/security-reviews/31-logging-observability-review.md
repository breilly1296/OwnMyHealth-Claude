# Logging & Observability Review — 2026-06-16

> Scope: application logging only (app logs → stdout/stderr → Cloud Logging). Audit-log PHI handling is reviewed in `05-audit-logging`. Cloud Logging sink/retention/IAM is infra (not in repo) and is recorded under *Unverifiable*.
> Reviewed at HEAD `fb2cd32` against checklist `prompts/31-logging-observability.md` and protocol `prompts/_review-protocol.md`.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 3 |
| Info | 3 |

The logging layer is in good shape. Backend redaction (`sanitizeData`/`sanitizeValue`) works correctly — the set is all-lowercase and matched case-insensitively, recursion is depth- and cycle-bounded, arrays are walked, and prod/staging output is structured JSON with correct Cloud Logging severities. The PHI scrubber (`redactPHI`/`stripPHIFromText`) is applied on both the input and output sides of every Claude call. No PHI was found interpolated into prod/staging-active (`warn`/`error`) log messages. The one substantive issue is the **frontend** `SENSITIVE_FIELDS` set: it stores camelCase keys but is matched against a lowercased key, so ~13 of its entries (including `accessToken`, `valueEncrypted`, `memberIdEncrypted`, `dateOfBirth`) are dead and can never redact — a latent break in a PHI defense-in-depth control. No third-party APM is wired anywhere in the repo.

## Findings

### F-1 — Frontend `SENSITIVE_FIELDS` is case-mismatched: ~13 entries can never redact — **Medium**
- **Location:** `src/utils/logger.ts:20-27` (set declaration) and `src/utils/logger.ts:48` (lookup).
- **Observation:** The frontend redactor lowercases the object key before lookup (`const lowerKey = key.toLowerCase(); if (SENSITIVE_FIELDS.has(lowerKey))`) but the set stores **camelCase** entries. A `Set` lookup is exact, so any camelCase entry is unreachable. Of the 22 entries, these never match: `accessToken`, `refreshToken`, `socialSecurityNumber`, `memberId`, `groupNumber`, `memberIdEncrypted`, `groupIdEncrypted`, `valueEncrypted`, `descriptionEncrypted`, `noteEncrypted`, `phoneNumber`, `dateOfBirth`, `sessionId`. Only the already-lowercase entries (`password`, `token`, `secret`, `ssn`, `genotype`, `email`, `address`, `authorization`, `cookie`) actually fire. The backend logger does **not** have this bug — its set is entirely lowercase (`logger.ts:30-41`), so `key.toLowerCase()` matches. The drift is even acknowledged in the backend test file (`backend/src/utils/logger.test.ts:27-34`), which notes the camelCase `*Encrypted` keys "actually [don't] fire on a camelCased input."
- **Impact:** Defense-in-depth on the frontend logger is silently broken for the highest-value keys (OAuth tokens, encrypted PHI fields, DOB). No *current* frontend `warn`/`error` call passes an object with these keys (verified below), so there is no active leak today — but the moment any developer writes `logger.error('...', { accessToken })` or logs a biomarker/plan object containing `valueEncrypted`/`memberIdEncrypted`, it will print unredacted to the browser console **in production** (frontend `warn`/`error` always emit; `src/utils/logger.ts:64`). Browser-console PHI is exposed to anyone with device/session access, screen-share, support tooling, or a malicious extension.
- **Fix:** Store the set entries in lowercase (mirror the backend set), or lowercase each entry at construction (`new Set([...].map(s => s.toLowerCase()))`). Add a redaction regression test that feeds `{ accessToken, valueEncrypted, dateOfBirth }` and asserts `[REDACTED]`.
- **Evidence:**
  ```ts
  // src/utils/logger.ts:20-27 — camelCase entries
  'password', 'token', 'accessToken', 'refreshToken', 'secret',
  ... 'memberIdEncrypted', 'groupIdEncrypted', 'valueEncrypted',
  // src/utils/logger.ts:47-48 — lowercased lookup → camelCase entries never hit
  const lowerKey = key.toLowerCase();
  if (SENSITIVE_FIELDS.has(lowerKey)) {
  ```

### F-2 — Raw upload filename (PHI) logged in plaintext on the SBC/lab parse path — **Low**
- **Location:** `backend/src/services/pdfParser.ts:899` (lab) and `backend/src/services/pdfParser.ts:1351` (SBC); also `:908` (`labName`/`reportDate`).
- **Observation:** `pdfLogger.info('Parsing SBC document', { filename, textLength })` logs the `filename`, which is plumbed from `file.originalname` (`sbcUploadController.ts:64/269` → `extractSBCData(..., file.originalname, ...)` → `parseSBC(fileBuffer, fileName)`). The codebase itself classifies the raw client filename as PHI — it is encrypted at rest as `UserFile.originalFilenameEncrypted` (L24; `labUploadController.ts:107-111` comment: "the raw client filename can embed PHI"). The key `filename` is **not** in `SENSITIVE_FIELDS` (`logger.ts:30-41`), so `sanitizeData` passes it through verbatim.
- **Impact:** A filename like `Jane Doe MRI.pdf` is written to the application log in cleartext. Mitigated to **Low** because these are `info`-level calls, which are suppressed in production and staging (`useProductionLogging` gate, `logger.ts:107`), so they only emit in local dev — but local dev may run against real PHI, and if anyone ever changes one of these to `warn`/`error` (or logs `filename` on the upload-error path), it leaks into Cloud Logging.
- **Fix:** Add `filename` (and `originalname`) to the backend `SENSITIVE_FIELDS` set so any future log call redacts it, or drop the field from these log objects (`textLength` is the only operationally useful value here).
- **Evidence:**
  ```ts
  // pdfParser.ts:1351
  pdfLogger.info('Parsing SBC document', { filename, textLength: text.length });
  // labUploadController.ts:111 — same value is treated as PHI elsewhere
  originalFilenameEncrypted: encryptionService.encrypt(file.originalname, userSalt),
  ```

### F-3 — Invalid SBC benefit object logged unredacted at `warn` — **Low**
- **Location:** `backend/src/services/sbcExtraction.ts:898`.
- **Observation:** `sbcLogger.warn('Filtering invalid benefit', { benefit: b })` logs the full extracted benefit object. The key `benefit` is **not** in `SENSITIVE_FIELDS`, so `sanitizeData` recurses and emits the object's fields (`serviceName`, `serviceCategory`, copay/coinsurance values, etc.). This is a `warn`, so it **does** emit in production and staging. Contrast the parallel biomarker path one file over: `claudeExtraction.ts:231` uses the key `biomarker` — which **is** in `SENSITIVE_FIELDS` (`logger.ts:40`) — so that object is correctly collapsed to `[REDACTED]`. The two sibling paths are inconsistent.
- **Impact:** Insurance benefit structure (extracted from a user's uploaded SBC) is written to Cloud Logging unredacted. SBC benefit data is plan-structure metadata rather than core clinical PHI, but it is user-linked insurance detail derived from a document the user uploaded, so it should not ride into app logs. Low because the content is benefit metadata (and only the *invalid/filtered* subset), not member IDs or clinical values.
- **Fix:** Either add `benefit` to `SENSITIVE_FIELDS`, or log only diagnostic fields (e.g. `{ hasServiceName: !!b.serviceName, hasCategory: !!b.serviceCategory }`) — matching the redacted-by-key approach used for `biomarker`.
- **Evidence:**
  ```ts
  // sbcExtraction.ts:898 — full object, key 'benefit' is NOT in SENSITIVE_FIELDS
  sbcLogger.warn('Filtering invalid benefit', { benefit: b });
  // vs claudeExtraction.ts:231 — key 'biomarker' IS in SENSITIVE_FIELDS → [REDACTED]
  extractionLogger.warn('Filtering invalid biomarker', { biomarker: b });
  ```

### F-4 — `logger.devBox` guards on `isProduction` only, not `useProductionLogging` — **Low**
- **Location:** `backend/src/utils/logger.ts:197` (guard) and `backend/src/services/emailService.ts:312-318` (the only PHI-bearing caller).
- **Observation:** `devBox` returns early only when `config.isProduction` is true (`if (config.isProduction) return;`), unlike every other path in the logger which suppresses on `useProductionLogging = config.isProduction || config.isStaging` (`logger.ts:18`). The email fallback (`emailService.sendEmail`, fired when `!config.email.enabled`) calls `devBox` with the **raw recipient address** and the **first 200 chars of the email body** (`To: ${to}`, `Content: ${text.substring(0, 200)}...`).
- **Impact:** On a **deployed staging** tier (`NODE_ENV=staging`) where email is disabled (`config.email.enabled` is `!!SENDGRID_API_KEY`, so a staging box without a SendGrid key qualifies), `devBox` is **not** suppressed and would print the recipient address plus email-body content to Cloud Logging — exactly the verbose-on-staging regression the L-4 change was meant to close everywhere else. Production is safe (`isProduction` short-circuits). Low because it requires the specific staging-with-email-disabled config and the body is truncated to 200 chars; still, email bodies (password-reset / verification context) and recipient addresses should not hit staging logs.
- **Fix:** Change the `devBox` guard to `if (useProductionLogging) return;` so staging behaves like production. Independently, the `devBox` email caller should mask the recipient (`maskEmail`, already defined at `emailService.ts:44`) and drop the body preview even in dev.
- **Evidence:**
  ```ts
  // logger.ts:196-197
  devBox: (title: string, lines: string[]) => {
    if (config.isProduction) return;   // staging NOT excluded
  // emailService.ts:313-316
  logger.devBox(`EMAIL (NOT SENT - No SendGrid key)`, [
    `To: ${to}`,
    `Content: ${text.substring(0, 200)}...`,
  ```

### F-5 — `genotype` retained in both `SENSITIVE_FIELDS` sets after DNA/Genetics models were dropped — **Info**
- **Location:** `backend/src/utils/logger.ts:36` and `src/utils/logger.ts:24`.
- **Observation:** Both sets still list `genotype`/`'genotype'`, but the `DNAVariant`/`GeneticTrait` models (and `genotypeEncrypted`) were removed in migration `20260423_drop_dna_genetics` (per `_phi-inventory.md`). The entry is harmless dead weight — it cannot match any current field — and is the one case where the frontend lowercase-vs-camelCase bug (F-1) does *not* apply (the entry is already lowercase).
- **Impact:** None; flagged only to keep the redaction set honest and aligned with the live schema. Leaving it is also defensible as future-proofing.
- **Fix:** Optional — remove `genotype` from both sets, or leave with a comment that it is intentionally retained.
- **Evidence:** `logger.ts:36` `'descriptionencrypted', 'noteencrypted', 'genotype',`

### F-6 — Backend biomarker decrypt-failure message embeds the field *name* (not value) — **Info**
- **Location:** `backend/src/controllers/biomarkerController.ts:47` (and the parallel pattern at `expenseController.ts:92`, `insuranceController.ts:235`, `healthGoalsController.ts:129/170`, `settingsController.ts:452`, `healthContextService.ts:231`, `healthProfileService.ts:83`, `encryption.ts:441`).
- **Observation:** These `warn`/`error` calls interpolate the encrypted **field name** into the message string (e.g. `` `Failed to decrypt biomarker field: ${field}` ``) and pass only `{ error: err.message }` / `{ id }` in data. Field names (`valueEncrypted`, `notesEncrypted`) are schema metadata, not PHI, and the AES-GCM decrypt error message contains no plaintext. This is the correct pattern, recorded here only to confirm it was reviewed.
- **Impact:** None.
- **Fix:** None required.
- **Evidence:** `biomarkerController.ts:47` `logger.warn(\`Failed to decrypt biomarker field: ${field}\`, { data: { error: ... } });`

### F-7 — Prompt drift: checklist anchors `SENSITIVE_FIELDS` declaration at `logger.ts:30` and `encryption.ts:476`; both correct, but the frontend "keeps pace" claim is false — **Info**
- **Location:** `prompts/31-logging-observability.md:45`.
- **Observation:** Checklist item 1 asserts the frontend set "includes `authorization`, `cookie`, `sessionId` — confirm it also keeps pace with any new snake_case token keys." In practice `sessionId` (and most other camelCase entries) **cannot** match due to the case bug in F-1, so the frontend set does not in fact provide the coverage the prompt assumes. The line/anchor numbers in the prompt are accurate.
- **Impact:** Documentation accuracy only.
- **Fix:** After F-1 is remediated, update the prompt note; until then the prompt overstates frontend coverage.
- **Evidence:** `prompts/31-logging-observability.md:45` vs `src/utils/logger.ts:27,48` (F-1).

## Checks passed
- [x] Backend `SENSITIVE_FIELDS` covers PHI fields + `password`/`token`/`secret` + snake_case FHIR/OAuth (`access_token`, `refresh_token`, `authorization`, `cookie`) — and is **all-lowercase**, matching the case-insensitive lookup — `backend/src/utils/logger.ts:30-41`, `:76`.
- [x] PHI-field membership tracks `PHI_FIELDS` un-suffixed names (`valueencrypted`, `noteencrypted`, `descriptionencrypted`, `memberidencrypted`, `groupidencrypted`, `clauderesponseencrypted`) — `logger.ts:35-39` vs `encryption.ts:476-562`.
- [x] Recursion bounded: `MAX_SANITIZE_DEPTH = 8` collapses to `'[MAX_DEPTH]'`, per-walk `seen` WeakSet returns `'[CIRCULAR]'` — `logger.ts:45,57,60-62,66`.
- [x] Arrays of objects sanitized element-by-element (F-21) — `logger.ts:63-65`; regression test `logger.test.ts:36-57`.
- [x] Key matching is case-insensitive on the backend (`key.toLowerCase()`) — `logger.ts:76`.
- [x] Redaction marker is the sentinel `'[REDACTED]'`, never the original — `logger.ts:77`, `src/utils/logger.ts:49`.
- [x] AI/FHIR sensitive keys in backend set: `responsetext`, `jsontext`, `clauderesponseencrypted`, `guidance`, `extracteddata`, `pdftext`, `pdfcontent`, `biomarker` — `logger.ts:38-40`.
- [x] No log message interpolates a raw PHI **value** — decrypt-failure logs embed only the field *name* (`biomarkerController.ts:47`, `insuranceController.ts:235`, etc.); error logs pass `{ error: err.message }` / IDs only.
- [x] Error → log pipeline sends a structured payload, not a stringified object; bodies never logged raw — `errorHandler.ts:178-196`. 5xx → `logger.error`; 4xx → `logger.warn` only in dev (suppressed in prod, which is acceptable) — `errorHandler.ts:190-196`. Stack only in `config.isDevelopment` — `:186,206`.
- [x] No bare `console.*` in `backend/src/` outside `logger.ts` and `backend/src/maintenance/` — only matches are the three CLI scripts (user IDs + counts, no decrypted PHI), the logger itself, `pdfParser.ts` comments, tests, and one boot-time config-validation `console.warn` in `config/index.ts:69` (env-var name + numeric fallback, pre-logger, no PHI). Grep: `console\.(log|info|warn|error|trace|debug)` over `backend/src/**/*.ts`.
- [x] No bare `console.*` in `src/` outside `src/utils/logger.ts` — only matches are comments (`AuthContext.tsx:156`, `useBiomarkerStats.ts:34`), the logger, and a test. Grep over `src/**/*.{ts,tsx}`.
- [x] No `debugger` and no `console.trace` anywhere — Grep `debugger|console\.trace` → zero matches.
- [x] Production AND staging suppress `debug`/`info` via `useProductionLogging = config.isProduction || config.isStaging` — `logger.ts:18`, applied `:107`. `logger.auth(...)` additionally suppressed under `useProductionLogging` — `logger.ts:179`.
- [x] No `process.env` dumps in any log path; no env-var bypass to re-enable debug — the gate keys on resolved `config.isProduction`/`isStaging` (`config/index.ts:34-35,291-292`), not a runtime-toggleable flag.
- [x] No incoming-request / response-body logging middleware present — no morgan / pino-http / express-winston; Grep confirmed. `req.body` is read only by validation/route handlers, never logged.
- [x] Claude API request payloads not logged: `claudeExtraction.ts:136-149` logs only lengths + `firedPatterns`; `expenseController.ts:764` and `biomarkerRoutes.ts:299,308` log only `error.message`; `aiChatController.ts:172,331` log `userId` + `error.message`. No prompt/response text logged.
- [x] SendGrid: body never logged on the real send path; recipient masked via `maskEmail`, only template `subject` logged — `emailService.ts:349,356,359,44-51` (the dev `devBox` fallback exception is F-4).
- [x] GCS: no signed URL is generated for PHI downloads (bytes proxied via `getFileStream`); logs carry only `storageKey`/bucket/size — `storageService.ts:73-91,108-112,126-146`.
- [x] Document AI (OCR): no document bytes logged; only `errorMessage`, `biomarkerName` + validation reason (H-1 fix, value omitted) — `ocrService.ts:99,226-229,341-344,455-482`.
- [x] Quest FHIR / SMART-on-FHIR: OAuth `access_token`/`refresh_token`/`code` and the `Authorization: Bearer` header are **not** logged. `smartAuth.revokeToken` logs only `status` / `err.message` (`smartAuth.ts:318,346,351`); `fhirClient.ts` builds the bearer header but has **zero** logger calls; `fhirController.ts:110` logs only truncated `err.message`, never the `code`.
- [x] FHIR `urlSafety` SSRF guard / unmapped-LOINC logs carry operator signal (provider name, LOINC codes — standardized lab codes, not PHI) + `userId`, no clinical values — `labSyncService.ts:407-410`.
- [x] `redactPHI`/`stripPHIFromText` applied before every Claude request with user/OCR text — `claudeExtraction.ts:136`, `sbcExtraction.ts:795`, `aiChatController.ts:264,277`, `expenseController.ts:743`, `healthContextService.ts:591`, `biomarkerRoutes.ts:257`.
- [x] `firedPatterns` logged as diagnostics, pre-redaction `text` never logged — `claudeExtraction.ts:138-142` logs `firedPatterns` + lengths only; no caller logs the raw `text`.
- [x] `redactPHI` applied to output too: `claudeExtraction.ts:185` / `sbcExtraction.ts:839` (`responseText`), `aiChatController.ts:264-282` (streaming deltas, cross-chunk buffer), `expenseController.ts:777` (`claudeResponse`).
- [x] `PHI_PATTERNS` cover SSN, MRN (labeled), NPI, DEA, US phone, **email** (`[EMAIL_REDACTED]`), DOB (labeled/contextual/freestanding date), street address, ZIP (5/5+4 with reference-range lookahead), labeled patient name — `phiRedaction.ts:14-77`.
- [x] Pattern ordering: labeled SSN→MRN→NPI→DEA run before generic Phone/Email, and labeled+contextual DOB run before the generic freestanding-date matcher — `phiRedaction.ts:17-57`.
- [x] No PDF-vision redaction helper remains: Grep `redactPatientBanner|pdfRedaction` over `backend/src/**/*.ts` → zero matches.
- [x] No third-party APM without a BAA: Grep `sentry|datadog|honeybadger|newrelic` → zero matches anywhere in repo.
- [x] Production emits single-line JSON with reserved fields; `data` runs through `sanitizeData` before merge; warn/error → `stderr`, debug/info → `stdout` — `logger.ts:113-131`. `SEVERITY_BY_LEVEL` maps to `DEBUG`/`INFO`/`WARNING`/`ERROR` (valid Cloud Logging vocabulary) — `logger.ts:90-95`.

## Unverifiable
- Cloud Run log retention policy / breach-investigation window — infra; not in repo (checklist item 9). Recommend confirming with the GCP console (default 30 days may be short for HIPAA breach investigation).
- Log sink export to a restricted (non-public) bucket and `roles/logging.viewer` minimal-grant IAM — infra; not in repo (checklist item 9).
- Whether `_logs_router`/sink config or alerting rules (failed-login spikes, lockouts, 5xx) exist — infra/ops; no IaC for Cloud Logging found in `.github/workflows/`.
- Whether a `logger.ts` `sanitizeData` redaction regression test exists for the **frontend** path — none found (`logger.test.ts` is backend-only; F-1 would have been caught by one). `phiRedaction.test.ts` covers `redactPHI`/`stripPHIFromText` thoroughly.

## Out of scope
- Audit-log (`audit_logs`) PHI handling and the encrypted `metadataEncrypted` column — covered by `05-audit-logging`. Noted only that the upload controllers route `file.originalname` into `auditService.logCreate`/`logAccess` (`labUploadController.ts:58,148,316`; `sbcUploadController.ts:73,189,278,340`), where it lands in the **encrypted** audit metadata channel, not the app log — that is the intended PHI sink and is acceptable.
- `redactPHI` regex completeness against adversarial PHI (unlabeled names, handwriting) — the file header documents this as a known best-effort limitation; deep regex fuzzing is a separate exercise.
- Encryption correctness of `PHI_FIELDS` ↔ schema lockstep — covered by `02-encryption` / `_phi-inventory`.
