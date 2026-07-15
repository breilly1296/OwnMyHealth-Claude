# Input Validation Review — 2026-06-16

Scope: `backend/src/middleware/validation.ts`, all 18 route files, 10 domain controllers + `controllers/upload/`, `controllers/upload/shared.ts`, `utils/securePdfParsing.ts`, `services/fhir/urlSafety.ts`, and the prompt-injection / extraction call sites in `services/{claudeExtraction,sbcExtraction}.ts` and `controllers/aiChatController.ts`. Static review of HEAD `fb2cd32`. No code modified.

Verdict: input validation is **strong and consistent**. Every `:param` route is UUID-validated before DB access, every mutating route has a Zod body schema, file uploads pass a two-stage (multer `fileFilter` + content magic-byte) check with filename sanitization, both AI/extraction paths neutralize untrusted text, and outbound FHIR URLs are SSRF-guarded. No Critical or High findings. The findings below are hardening/hygiene and one prompt-drift note.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 3 |
| Info | 2 |

## Findings

### F-1 — Biomarker batch can exceed `maxBiomarkers` by up to (batchSize − 1) at request time — **Medium**
- **Location:** `backend/src/routes/biomarkerRoutes.ts:95-108`; mitigation at `backend/src/controllers/upload/shared.ts:206-231`.
- **Observation:** `POST /biomarkers/batch` validates `schemas.biomarker.batchCreate` (1–100 rows, `validation.ts:457`) and gates with `requirePlanLimit('maxBiomarkers')`, but the gate is per-REQUEST (it checks `current < limit` at request time, with no awareness of the batch size). The route comment states this plainly: a single batch can push the stored total past the FREE cap (50) by up to `batchSize − 1` rows. The shared OCR-ingestion insert site (`createBiomarkersFromOCRResult`) DOES truncate to the remaining quota (`shared.ts:212-231`), but the manual `bulkCreateBiomarkers` JSON batch path does not route through that truncation — it inserts the validated array directly.
- **Impact:** A FREE-tier user already at 49 stored biomarkers can submit a 100-row batch and store ~149, bypassing the intended plan quota. This is a billing/plan-limit integrity gap, not a PHI-disclosure or cross-tenant issue — every row is still the caller's own, RLS-scoped, and encrypted. Blast radius is limited to per-user quota overshoot.
- **Fix:** In `bulkCreateBiomarkers` (biomarkerController), apply the same remaining-quota truncation used in `createBiomarkersFromOCRResult` (count current rows in the RLS tx, slice the input to `max(0, limit - current)` when `!isUnlimited`), OR add count-aware support to `requirePlanLimit` so it can compare `current + batch.length` against the limit. The shared helper already encapsulates the correct logic; reuse it.
- **Evidence:** `biomarkerRoutes.ts:96-101` — “requirePlanLimit enforces a per-REQUEST gate, not per-row … A single batch can therefore still push the stored total past the limit by up to (batchSize - 1) rows.”

### F-2 — `sanitizeString` does not strip control characters / null bytes from general free-text fields — **Low**
- **Location:** `backend/src/middleware/validation.ts:41-49` (`sanitizeString`), used by `sanitizedString`/`optionalSanitizedString` (`validation.ts:146-159`) across nearly every body schema.
- **Observation:** `sanitizeString` trims and HTML-escapes `& < > " '` but does NOT strip C0 control characters or the null byte (`\x00`). The dedicated prompt/extraction sanitizers (`sanitizeForPrompt` at `validation.ts:79`, `delimitDocumentForPrompt` at `validation.ts:123`, and the SBC `sanitizeStr` at `controllers/upload/shared.ts:400`) DO strip `[\x00-\x1F\x7F]`, but the general-purpose body sanitizer does not. So a biomarker `notes`, health-need `description`, insurance `planName`, etc. can persist embedded control chars / null bytes.
- **Impact:** Low. Values are stored encrypted and rendered by React (which does not execute control chars as markup), and Postgres `text` columns tolerate control chars (a literal `\x00` would actually be rejected by Postgres on the wire, bounding the worst case). The realistic effect is log-line corruption or display oddities if a value is ever echoed into a non-escaping sink. No injection path was found because every prompt/header sink has its own stripping layer.
- **Fix:** Add a control-char strip (`.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')`, preserving `\t`/`\n` if desired) at the top of `sanitizeString` so all free-text fields are normalized at the single choke point, matching the prompt-side sanitizers.
- **Evidence:** `validation.ts:42-48` — the transform chain is `.trim().replace(/&/...)...replace(/'/...)` with no control-char clause, vs. `validation.ts:79` `sanitizeForPrompt` which begins with `.replace(/[\x00-\x1F\x7F]/g, '')`.

### F-3 — Two upload `fileFilter` rejections throw `BadRequestError` from inside multer instead of a uniform validation envelope — **Low**
- **Location:** `backend/src/routes/uploadRoutes.ts:36-44, 53-69`; `backend/src/routes/insuranceRoutes.ts:44-51`.
- **Observation:** The multer `fileFilter` callbacks call `cb(new BadRequestError(...))`. multer surfaces a `fileFilter` error by passing it to the route's error path, but multer also has its own `MulterError` shape for limit violations (e.g. `LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`). The size/count `limits` (`fileSize: 10MB`, `files: 1`) are enforced by multer and produce a `MulterError`, which the central `errorHandler` DOES classify (`errorHandler.ts:165-174`: `LIMIT_FILE_SIZE`→413 `FILE_TOO_LARGE`, any other `MulterError`→400 `UPLOAD_ERROR`), so over-limit uploads return a clean 4xx — not a 500.
- **Impact:** Low — a hardening/consistency gap, not an exploit. The real content-type and magic-byte enforcement happens server-side in `validateUploadFile` (`controllers/upload/shared.ts:133-164`) regardless, so a spoofed Content-Type that slips past `fileFilter` is still rejected on content. There is no 500 fall-through — the `MulterError` path is already classified to 4xx.
- **Fix:** None required for correctness — `middleware/errorHandler.ts:165-174` already maps `MulterError` (`LIMIT_FILE_SIZE`→413, any other→400). Optional consistency improvement: route the `fileFilter` rejections through the standard Zod validation envelope so all 4xx upload errors share one response shape.
- **Evidence:** `uploadRoutes.ts:36-44` `fileFilter: (_req, file, cb) => { if (file.mimetype === 'application/pdf') cb(null, true); else cb(new BadRequestError('Only PDF files are accepted')); }`; size enforcement is the silent multer `limits` block at `uploadRoutes.ts:32-35`.

### F-4 — Prompt drift: checklist line ranges for `delimitDocumentForPrompt` and `sanitizeExtractedSbc` no longer match the file — **Low**
- **Location:** `prompts/07-input-validation.md:56` (cites `controllers/upload/shared.ts:357-562`), `:118` (cites `validation.ts:111-135`).
- **Observation:** Per protocol §"When the prompt disagrees with the code," cited line ranges drift over time. `sanitizeExtractedSbc` is defined at `shared.ts:509-562` (the section comment begins at 357), and `delimitDocumentForPrompt`/`MAX_EXTRACTION_DOCUMENT_CHARS` live at `validation.ts:111-135`. These are close but the function bodies have shifted slightly; the functions themselves are present and correct. The checklist's WebP byte-offset cite (`controllers/upload/shared.ts:96-105`) is exact.
- **Impact:** None functional — documentation accuracy only. Logged so it folds into the quarterly prompt refresh.
- **Fix:** Re-anchor the cited ranges on the next prompt-refresh pass. No code change.
- **Evidence:** `shared.ts:509` `export function sanitizeExtractedSbc(data: ExtractedSBCData): ExtractedSBCData {`; `validation.ts:111` `export const MAX_EXTRACTION_DOCUMENT_CHARS = 200_000;`.

### F-5 — Admin list/audit query handlers re-parse `req.query` manually after Zod validation (parallel parse, possible drift) — **Info**
- **Location:** `backend/src/routes/adminRoutes.ts:47-51` (`/users`), `:958-964` (`/audit-logs`).
- **Observation:** Both routes run `validate(schemas.admin.listUsersQuery, 'query')` / `validate(schemas.admin.auditLogQuery, 'query')` (`validation.ts:880-896`), which replaces `req.query` with the parsed+clamped output. The handlers then re-derive `page`/`limit`/`isActive` from `req.query` with their own `parseInt`/`Math.min`/`Math.max` instead of consuming the already-validated values. The bounds happen to match (page≥1, limit clamped to 100/200), so behavior is currently correct, but the duplicate parse is a maintenance hazard: a future change to the schema bound would silently not apply on these two routes.
- **Impact:** None today — the manual clamps are equal to or tighter than the schema. Info-level: defensive redundancy that could drift.
- **Fix:** Consume the validated `req.query` values directly (they are already numbers post-transform) and delete the second parse, OR keep one source of truth. Note the audit-logs handler ALSO adds a genuine extra control (the `MAX_LOOKBACK_MS` floor at `adminRoutes.ts:971-989`) that is intentional and should stay.
- **Evidence:** `adminRoutes.ts:47-48` `const page = Math.max(1, parseInt(req.query.page as string) || 1); const limit = Math.min(100, ...)` — re-parsing after `validate(...,'query')` at `:44`.

### F-6 — `coinsuranceRate` / per-service coinsurance accept 0–100 but downstream cost-math assumes a percentage; SBC extraction clamps, manual create only bounds — **Info**
- **Location:** `validation.ts:512, 521, 528, 559` (manual create/update bound `min(0).max(100)`); `controllers/upload/shared.ts:385-388` (`sanitizePercent` clamps extraction to 0–100).
- **Observation:** Both the manual insurance-plan schema and the SBC extraction sanitizer bound coinsurance to 0–100, which is correct and consistent — the section comment at `shared.ts:362-368` explicitly notes that an unclamped `coinsuranceRate: 850` would become an 850% multiplier in cost-math. This is a positive observation: the two independent input paths (user JSON vs. AI extraction) both enforce the same range, so neither can poison `extractProjectedOOP`. Recorded as Info to document that the defense is paired, not single-sided.
- **Impact:** None — defense is present on both paths. No action.
- **Fix:** None.
- **Evidence:** `validation.ts:512` `coinsuranceRate: finiteNumber.pipe(z.number().min(0).max(100)).optional()`; `shared.ts:386` `function sanitizePercent(v: unknown): number | undefined { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined; return Math.min(100, v); }`.

## Checks passed

### 1. UUID Validation
- [x] All `:id` / `:patientId` / `:connectionId` / `:userId` route params validated as UUID before DB access — verified by enumerating every param route and confirming `validate(schemas.{uuidParam|patientIdParam|connectionIdParam}, 'params')` precedes each handler: `biomarkerRoutes.ts:71,78,112,120,139`, `insuranceRoutes.ts:75,91,99,121,147`, `expenseRoutes.ts:57,66,93,102`, `healthGoalsRoutes.ts:60,74,82,90`, `healthNeedsRoutes.ts:58,72,80`, `fileRoutes.ts:54,62,69`, `fhirRoutes.ts:56,67`, `patientRoutes.ts:182,275,332,424,488`, `providerRoutes.ts:321,444,528,604,661`, `adminRoutes.ts:138,274,408,503,600,729`.
- [x] Validation happens BEFORE the DB query — `validate` runs as middleware ahead of the `asyncHandler` controller (e.g. `biomarkerRoutes.ts:111-115`).
- [x] Invalid UUID returns 400, not 500 — `validate()` catches `ZodError` and forwards `ValidationError` (`validation.ts:251-260`), which the error handler renders as 400.
- [x] No SQL injection via malformed UUID — the `uuid` validator (`validation.ts:188`) rejects non-UUID before it reaches Prisma; all DB access is parameterized via Prisma (no raw string interpolation observed in the controllers read).

### 2. File Upload Validation
- [x] Multer `limits` enforce `fileSize: 10MB` and `files: 1` — `uploadRoutes.ts:32-35, 49-52`, `insuranceRoutes.ts:40-43`.
- [x] Multer `fileFilter` rejects non-allowed MIME at the boundary (PDF-only for lab-report/SBC; PDF+PNG/JPEG/TIFF/GIF/WEBP for OCR) — `uploadRoutes.ts:36-44` (PDF), `uploadRoutes.ts:53-69` (OCR set), `insuranceRoutes.ts:44-51` (PDF).
- [x] `validateUploadFile()` re-checks content with `validateMagicBytes` (multer only trusts the attacker-controlled Content-Type) — `controllers/upload/shared.ts:133-164` calls `validateMagicBytes(file.buffer, file.mimetype)` at `:157`, invoked by `uploadLabReport`/`uploadLabResultOCR`/`uploadSBC` (`labUploadController.ts:44,204`; `sbcUploadController.ts:56`).
- [x] Magic-byte table covers every accepted MIME, not just PDF — `MAGIC_BYTES` includes pdf/png/jpeg/gif/tiff/webp (`shared.ts:75-85`).
- [x] WebP second-stage check (RIFF prefix shared by AVI/WAV/ANI → require ASCII `WEBP` at bytes 8–11) — `shared.ts:100-105`.
- [x] `sanitizeFilename()` takes `path.basename`, strips path seps/control/quote chars, caps 255 — `shared.ts:121-127`, applied via `file.originalname = sanitizeFilename(...)` at `shared.ts:163`.
- [x] PDF header + bomb/timeout guards applied before pdf-parse/Claude — `validatePdfHeader` called in all three upload handlers (`labUploadController.ts:45,208`; `sbcUploadController.ts:57`); `secureParsePdf` enforces 30s timeout + 100MB heap delta + text-bomb ratio log (`securePdfParsing.ts:163-304`).
- [x] PDF page-count guard `MAX_PDF_PAGES = 50` via `PdfPageLimitError` (re-thrown on OCR fallback) — `securePdfParsing.ts:23-35, 219-228`.
- [x] Output-side SBC validation `sanitizeExtractedSbc()` is the single producer-side choke point at the end of BOTH extraction paths (Claude + regex) — `shared.ts:509-562`, called at `shared.ts:589` (Claude) and `:682` (regex fallback); clamps money to `SBC_MONEY_MAX = 999_999.99`, percent 0–100, int limits, string strip/escape/cap, plan-type/date validation, benefit-row drop; policy is clamp/drop, never whole-upload reject.

### 3. String Input Validation
- [x] Maximum length limits on text fields — every `sanitizedString`/`optionalSanitizedString` carries a max (e.g. biomarker `notes` `optionalSanitizedString(1000)` `validation.ts:414`; health-need `description` `sanitizedString(1,2000)` `:574`).
- [x] HTML/script tags escaped if displayed — `sanitizeString` escapes `& < > " '` (`validation.ts:42-48`).
- [x] SQL special chars handled by ORM — all reads/writes use Prisma typed query builder (no raw SQL in controllers read). *(Null-byte / control-char stripping on general free-text is the one gap → F-2.)*

### 4. Numeric Input Validation
- [x] NaN/Infinity rejected — `finiteNumber` refines `Number.isFinite` (`validation.ts:141`) and is piped into every numeric body field (biomarker `value` `:405`, all insurance monetary fields `:497-512`, expenses `:695-767`, goals `:617-648`).
- [x] Range validation — biomarker `value` `min(0)` (`:405`); insurance monetary `min(0)`, expense fields `min(0).max(999999.99)` (`:730-767`); coinsurance `min(0).max(100)` (`:512`); `frequencyPerYear` int `min(1).max(365)` (`:696`); goal numerics `max(999999.9999)` to fit `Decimal(10,4)` (`:617`).
- [x] Integer vs float distinction — `z.number().int()` on `frequencyPerYear` (`:696`) and `diagnosedYear` (`:840`); `extractionConfidence` bounded `min(0).max(1)` (`:417`).

### 5. Date Input Validation
- [x] Strict ISO-8601 enforced (date-only or full datetime) with real-calendar-date check (rejects 2026-02-30) — `dateString` regex pair + `!Number.isNaN(new Date(val))` refine (`validation.ts:211-215`).
- [x] No loose `new Date()` parse path — the previous permissive implementation was replaced (documented at `validation.ts:202-210`); extraction `effectiveDate` additionally re-validated by `sanitizeIsoDate` (`shared.ts:413-416`) and `safeDate` fallback (`sbcUploadController.ts:37-41`).

### 6. API Parameter Validation
- [x] Query params typed and bounded — `pagination` clamps `limit` to 1–100 (`validation.ts:326-329`); per-domain `listQuery` schemas repeat the clamp (biomarker `:460-464`, healthGoal `:652-659`, healthNeed `:591-598`, expense `:713-759`, admin `:880-896`).
- [x] Pagination max page size enforced — `Math.min(...,100)` (200 for audit logs) on every list route.
- [x] Sort/filter from allowlist — filters are enum-validated (`status`/`urgency`/`role`/`claimStatus` enums) or bounded strings; no arbitrary `orderBy` field is taken from user input (controllers hardcode `orderBy`).

### 7. Path Traversal Prevention
- [x] No `../` in file paths — storage keys are server-generated `${userId}/${fileId}.${extension}` where `userId` is the session id, `fileId` is `crypto.randomUUID()`, and extension is an allowlist map of mimetype→ext with `'bin'` fallback (`storageService.ts:30-39, 51-58`; `labUploadController.ts:71,240`; `sbcUploadController.ts`).
- [x] User input not interpolated into file paths — the only user-supplied string near a path (`originalname`) goes to `path.basename` + char-strip (`sanitizeFilename`) and is used only for the DB `originalFilename` and `Content-Disposition`, never the storage key.
- [x] Storage keys use UUIDs, not user names — confirmed `${userId}/${fileId}.${ext}` (`storageService.ts:58`).
- [x] `Content-Disposition` filename header-injection blocked — `safeFilename` strips `["\r\n\\]` and the UTF-8 `filename*` uses `encodeURIComponent` (`fileController.ts:259-271`).

### 8. Zod Schema Usage
- [x] Zod schema defined for every request body on mutating routes — confirmed across all 18 route files (auth, biomarker, insurance, expense, healthGoal, healthNeed, provider, patient, admin, ai, settings; the body-less routes are noted in §12).
- [x] Required vs optional enforced — e.g. `register` requires email+password, names optional (`validation.ts:360-365`); update schemas make all fields optional.
- [x] Custom validators present and used — `email` RFC+lowercase (`:180-183`), `uuid` (`:188`), `strongPassword` 12+ upper/lower/number/special (`:193-199`), `dateString` (`:213-215`), `finiteNumber` (`:141`), `sanitizedString`/`optionalSanitizedString` (`:146-159`), `promptSafeString` (`:165-171`). DNA `rsid` validator is absent (correctly removed with the DNA models).
- [x] `z.infer<T>` used for type safety — `validation.ts:929-939`.
- [x] Validation errors return field-level messages — `zodIssueToDetail` maps each issue to `{field, message, code}` (`validation.ts:25-31, 254`).

### 9. Domain-Specific Validation
- [x] Biomarker: `value` `finiteNumber.pipe(min(0))`, `unit` required, `sourceType` enum `MANUAL/LAB_UPLOAD/EHR_IMPORT/DEVICE_SYNC/API_IMPORT`, batch `.max(100)` — `validation.ts:405,415,457`.
- [x] Insurance: `planType` enum `HMO/PPO/EPO/POS/HDHP` (`:491`); monetary `finiteNumber.pipe(min(0))` (no upper cap except expense `.max(999999.99)`); coinsurance `min(0).max(100)` (`:512,521,528`).
- [x] Health need: `needType` via `z.nativeEnum(HealthNeedType)` (DB-derived), `urgency`/`status` enums (`:572-585`).
- [x] Health goal: `direction` enum, `status` enum, `reminderFrequency` enum, category free-text (M22 — `:614,620,628,637,644`).
- [x] Provider relationship: `relationshipType` enum (`:668`); consent permission booleans (`:673-685`); `consentDurationDays` `min(1).max(365)` (`:677`).
- [x] Expense: amounts `positive`/`min(0)`, `max(999999.99)` cap, `frequencyPerYear` int 1–365, `claimStatus` enum (`:695-767`).
- [x] Admin: `role` enum `PATIENT/PROVIDER/ADMIN` (`:868,874,881`), `updateUserPlan.plan` enum `FREE/PRO/TEAM` (`:900`), `updateProviderRelationship` is `.strict()` rejecting unknown keys (`:921`).
- [x] Settings health profile: `biologicalSex/ageRange/smokingStatus/exerciseLevel` enums; array caps conditions ≤20, medications ≤30, familyHistory ≤10 (`:832-858`).

### 10. AI / LLM Input Validation (prompt injection)
- [x] `ai.chat` bounds `message` ≤2000 and `conversationHistory` ≤20 turns (content ≤5000, role enum) — `validation.ts:774-785`.
- [x] Short free-text interpolated into prompts uses `promptSafeString`/`sanitizeForPrompt` — biomarker `guidance` schema uses `promptSafeString` for name/unit/status (`:468-475`); the guidance route re-applies `sanitizeForPrompt` on `name`/`unit` before prompt build (`biomarkerRoutes.ts:197-198`); chat applies `sanitizeForPrompt(message, 2000)` and per-history `sanitizeForPrompt(content, 5000)` with explicit caps to avoid the 200-char default truncating bounded text (`aiChatController.ts:196-202`).
- [x] Untrusted **extracted document text** wrapped via `delimitDocumentForPrompt` in BOTH extraction services — `claudeExtraction.ts:13,161` and `sbcExtraction.ts:12,819`; the helper strips control chars (keeps `\t\n\r`), defangs embedded `<document>` tags, prepends a "treat as data, not instructions" preamble, and caps at `MAX_EXTRACTION_DOCUMENT_CHARS = 200_000` (`validation.ts:111-135`).
- [x] AI route uses `requireBearerAuth` + `aiSpendGuard` + `requirePlanLimit('aiChatsPerDay')` and stays CSRF-exempt-but-bearer-only — `aiRoutes.ts:21,29-37` (the exemption rationale is documented at `aiRoutes.ts:17-28`).

### 11. FHIR / OAuth Callback & SSRF
- [x] `/fhir/callback` (unauthenticated GET) does NOT 400 on missing `code`/`state` — it 302-redirects to the frontend base with `?error=missing_code_or_state` (and `connection_failed` / provider-error branches also redirect; no JSON 400 body) — `fhirController.ts:80-97, 106-129`. PKCE + 24-byte random state with 10-min TTL bind the callback to a user (`fhirRoutes.ts:17-24`).
- [x] FHIR param routes validate with `connectionIdParam` / `uuidParam` before DB access — `fhirRoutes.ts:56,67`.
- [x] Outbound FHIR URLs (pagination links + SMART discovery endpoints + token/authorize/revoke) pass `assertAllowedFhirUrl` / `isPrivateOrLoopbackHost` — `fhir/urlSafety.ts:28-99`, consumed at `fhirClient.ts:38`, `smartAuth.ts:51,147,153,157`; the guard blocks cross-host, non-http(s), and cleartext-to-public, and explicitly catches `169.254.169.254` metadata (`urlSafety.ts:39`). DNS-rebinding residual is documented and knowingly accepted (`urlSafety.ts:13-24`).

### 12. New-Route Validation Coverage
- [x] `onboardingRoutes.ts` — `/status` (GET, no body, pure read) and `/complete` (POST, no body); neither trusts an unvalidated body (`onboardingRoutes.ts:24-45`).
- [x] `planRoutes.ts` — `/` and `/available` are read-only with no params/body (`planRoutes.ts:32-101`).
- [x] `internalRoutes.ts` — internal-only, authenticated by constant-time `X-Cleanup-Token` compare, 404 when token unset, 401 on mismatch; no user body trusted (`internalRoutes.ts:26-72`).
- [x] `settingsRoutes.ts` — `updateProfile`/`updateNotifications`/`updateHealthProfile`/`deleteData`/`deleteAccount` all `validate(schemas.settings.*)` (`settingsRoutes.ts:45,61,81,102,111`).
- [x] `authRoutes.ts` — `/change-email` (`schemas.auth.changeEmail`) and `/confirm-email-change` (`schemas.auth.confirmEmailChangeQuery`, `'query'`) validated (`authRoutes.ts:96-101, 133-139`).

### Cross-cutting
- [x] `requireJsonContentType` wired globally and resists Content-Type smuggling (treats Content-Length>0 / chunked as "has body" even when the parser left `req.body` empty) — `app.ts:252`; `validation.ts:273-318`.
- [x] `validate()` replaces `req[source]` with the parsed+transformed output via `Object.defineProperty`, so downstream handlers consume sanitized/clamped values, not raw input — `validation.ts:243-248`.

## Unverifiable
- **Virus scanning (optional, checklist §2)** — no ClamAV/equivalent integration was found in the upload path; the checklist marks this "optional but recommended," so it is recorded here rather than as a finding. Magic-byte + size + page-count + PDF-bomb guards are the implemented controls.
- **`errorHandler` MulterError classification (F-3 dependency)** — CONFIRMED during verification: `middleware/errorHandler.ts:165-174` maps `MulterError` (`LIMIT_FILE_SIZE`→413 `FILE_TOO_LARGE`, any other→400 `UPLOAD_ERROR`), so over-limit uploads return 4xx, not 500. F-3 is therefore a response-shape nit only, not a 500 risk.

## Out of scope
- CSRF token mechanics, rate-limiter internals, RLS policy SQL, and encryption-at-rest correctness — covered by their dedicated prompts (03/04, rate-limit, 01 RLS, 02 encryption). This review confirmed only that the relevant middleware is *wired* on the routes it touches (e.g. `csrfProtection` on expense/fhir mutations, `aiSpendGuard` on AI mounts), not their internal correctness.
- Frontend-side validation (`src/`) — server is the trust boundary; client validation is UX, not a security control, and was not assessed.
- Cost-math correctness of clamped SBC values — only the input clamping was verified (F-6); the arithmetic that consumes the values is the expense-controller's concern.
