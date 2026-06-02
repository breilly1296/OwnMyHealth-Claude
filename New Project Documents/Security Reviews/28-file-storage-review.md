# 28-file-storage Review — 2026-06-01

Scope: File storage & document processing (GCS proxy download, upload validation, PDF/OCR processing, PHI redaction before AI, rate/plan gating, audit logging, deletion semantics). Read against live code under `backend/src/` and `src/`. Report only — no code modified.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |
| Info | 2 |

The download-egress hardening the spec describes (signed-read URLs removed, backend stream proxy with `no-store` + audited-before-stream + ownership/RLS) is fully implemented and matches the code. Upload validation (multer fileFilter + magic bytes + PDF header + size/single-file + filename sanitize + UUID storage key) is solid. PDF-bomb DoS guards are wired on every parse path. No Critical/High issues found. The Medium/Low findings are a stale-doc PHI-leak risk (a removed Claude-Vision path still documented as a redaction control), a scanned-PDF UX/routing dead-end, dependency hygiene, and several prompt/doc-drift items.

## Findings

### F-1 — `redactPatientBanner` documented as a live "Claude Vision" PHI control, but the path was removed and the function has zero callers — **Medium**
- **Location:** `New Project Documents/TROUBLESHOOTING.md:578`; function defined at `backend/src/utils/pdfRedaction.ts:47`.
- **Observation:** TROUBLESHOOTING.md's PHI-redaction reference table lists "Image bytes sent to Claude Vision → `pdfRedaction.redactPatientBanner` → Covers the top 15% banner of every PDF page." But there is no Claude Vision path in the code: `claudeExtraction.ts` is text-only and rejects scanned/image PDFs (`extractBiomarkersWithClaude` throws `ValidationError` when `!extracted.usable`, `claudeExtraction.ts:123-132`), and `redactPatientBanner` has **no caller anywhere in `backend/src`** (Grep for `redactPatientBanner` returns only its own definition, the prompts, and docs). The function additionally **fails open** — on any error it returns the original (unredacted) buffer (`pdfRedaction.ts:81-89`).
- **Impact:** The operational doc asserts a redaction control exists that does not run. If a future engineer trusts the table and wires in a Claude Vision / image-to-Claude path believing the banner cover is already applied, raw patient-banner PHI (name/DOB/MRN/address) would be shipped to the model unredacted — and even if they call the helper, its fail-open behavior means a malformed PDF silently sends the unredacted buffer. Stale "this is protected" docs are a classic precondition for a PHI disclosure.
- **Fix:** Either (a) delete `pdfRedaction.ts` as dead code and remove the row from `TROUBLESHOOTING.md:578`, or (b) if a Vision path is planned, change the helper to fail **closed** before wiring it. At minimum, correct the doc so it does not claim an unwired control is active.
- **Evidence:**
  ```
  TROUBLESHOOTING.md:578: | Image **bytes sent to Claude Vision** | `pdfRedaction.redactPatientBanner` | Covers the top 15% banner ... |
  pdfRedaction.ts:88:     return pdfBuffer;   // fail-open: returns ORIGINAL on error
  claudeExtraction.ts:128: throw new ValidationError('PDF text extraction did not yield enough readable text ...
  ```

### F-2 — Scanned-PDF uploads to the OCR endpoint are rejected, not OCR'd (routing dead-end vs. the spec's promise) — **Medium**
- **Location:** `backend/src/services/ocrService.ts:393-410` (`processDocument`), reached from `backend/src/controllers/upload/labUploadController.ts:210` (`uploadLabResultOCR`).
- **Observation:** The spec (architecture notes and checklist §4) states scanned/image PDFs are "REJECTED and routed to OCR." But the OCR upload endpoint (`/upload/lab-results-ocr`) routes **all** PDFs — including scanned ones — back through `processPDFWithClaude` → `extractBiomarkersWithClaude`, which is text-only and throws `ValidationError` for scanned PDFs. `processImageWithDocumentAI` (the only Document AI path) is reached only for `image/*` MIME types, never for `application/pdf` (`ocrService.ts:394-414`). So a user who exports a scanned lab as a PDF and uploads it to the OCR endpoint as instructed hits a hard error with no working path; only re-saving as PNG/JPEG/TIFF works.
- **Impact:** Not a security breach, but a minimum-necessary/availability gap: the documented "route scanned PDFs to OCR" fallback does not exist for PDF MIME type. Users may try to force usable text out (defeating the redaction-before-AI design) or abandon. It also means the BAA-gated Document AI path (`GOOGLE_BAA_ACTIVE`) is unreachable for PDFs.
- **Fix:** In `ocrService.processDocument`, when a PDF's local text extraction is not usable, route the PDF bytes to `processImageWithDocumentAI` (Document AI accepts `application/pdf`) instead of letting the Claude text path throw. Gate it behind `config.gcp.documentAiBaaActive`, which already exists. Alternatively, correct the spec/UX copy to say scanned PDFs must be re-uploaded as images.
- **Evidence:**
  ```ts
  // ocrService.ts:394
  if (mimeType === 'application/pdf') {
    if (isClaudeExtractionConfigured()) {
      try { return await processPDFWithClaude(buffer, mimeType, startTime, userId); }
      catch (error) { ...; throw error; }   // no Document AI fallback for PDFs
  ```

### F-3 — `Content-Disposition` lacks RFC 5987 `filename*` for non-ASCII names (header-injection is blocked, but UTF-8 names are mangled) — **Low**
- **Location:** `backend/src/controllers/fileController.ts:243-250` (`getFileDownloadUrl`).
- **Observation:** The download proxy sanitizes the filename by replacing `["\r\n\\]` with `_` and emits `filename="..."` only. Upstream `sanitizeFilename` (`upload/shared.ts:107-113`) already strips control chars, path separators, and quotes from `originalFilename`, so header injection is not possible here — this is purely an encoding nicety. Non-ASCII characters that survive sanitization (accents, CJK) are placed raw into a `filename="..."` value, which is not RFC 6266-compliant and renders inconsistently across browsers.
- **Impact:** Cosmetic / interoperability only. No injection: the value cannot break out of the quoted header (CR/LF/quote/backslash are removed at upload and again at download). Worst case a downloaded file gets a garbled name.
- **Fix:** Add a `filename*=UTF-8''<percent-encoded>` parameter alongside the ASCII `filename` fallback in the `Content-Disposition` set call.
- **Evidence:**
  ```ts
  // fileController.ts:243
  const safeFilename = (file.originalFilename || file.filename || 'download').replace(/["\r\n\\]/g,'_');
  res.set({ 'Content-Disposition': `attachment; filename="${safeFilename}"`, ... });
  ```

### F-4 — Dependency hygiene: 8 moderate transitive advisories, all under `@google-cloud/storage` and shared utils — **Low**
- **Location:** `backend/package.json` (transitive: `@google-cloud/storage` → `gaxios` 6.4.0–6.7.1, `teeny-request`, `retry-request`, vendored `uuid`; plus `@hono/node-server`).
- **Observation:** `npm audit` reports 8 moderate vulnerabilities. The file-storage-relevant chain is `@google-cloud/storage`'s bundled `gaxios`/`teeny-request`/`retry-request` and a `uuid` "missing buffer bounds check (v3/v5/v6 when `buf` provided)" (GHSA-w5hq-g745-h8pq). Storage keys use the app's own `crypto.randomUUID()` (`labUploadController.ts:70`, `sbcUploadController.ts:74`), not the `uuid` package. The app *does* import the `uuid` package elsewhere (`authService.ts:19` — `import { v4 as uuidv4 } from 'uuid'`), but the advisory only affects `v3`/`v5`/`v6` *when a `buf` argument is provided*; `v4` with no `buf` is outside the affected surface, so the `uuid` issue is not reachable from app code. `@hono/node-server` (GHSA-92pp-h63x-v22m, serveStatic slash bypass) is pulled in transitively under `@prisma/dev` → `prisma` (a dev/CLI dependency) and is not in the request path of this Express app. `pdf-parse@1.1.1` and `pdf-lib@1.17.1` have **no** advisories.
- **Impact:** Low — no directly exploitable path identified in the file-storage flows; these are defense-in-depth/supply-chain drift in the GCS SDK's vendored deps.
- **Fix:** Bump `@google-cloud/storage` to a release whose vendored `gaxios`/`uuid` are patched (`npm audit fix` or a major bump after testing GCS upload/stream/delete). Track `@hono/node-server` to its origin (likely a Prisma/dev tool) and update or drop it.
- **Evidence:**
  ```
  @google-cloud/storage  2.2.0 - 2.5.0 || >=5.19.0
  gaxios  6.4.0 - 6.7.1   (node_modules/@google-cloud/storage/node_modules/gaxios)
  uuid: Missing buffer bounds check ... GHSA-w5hq-g745-h8pq
  8 moderate severity vulnerabilities
  ```

### F-5 — Prompt drift: file-storage prompt counts a magic-byte check on PDF, but the multer `fileFilter` is MIME-only and `validateUploadFile` skips the PDF magic check (covered separately) — **Low**
- **Location:** `backend/src/routes/uploadRoutes.ts:35-43` and `backend/src/controllers/upload/shared.ts:71-92, 143`.
- **Observation:** The spec checklist item "MIME type validated by multer `fileFilter`" and "Magic bytes verified against declared MIME" are both satisfied, but the relationship differs slightly from the prompt's framing. `MAGIC_BYTES` (`shared.ts:71`) **does** include `application/pdf` (`%PDF`), and `validateMagicBytes` is called for every upload (`shared.ts:143`). The PDF *version* check is a separate `validatePdfHeader` call made explicitly by each controller (`labUploadController.ts:44`, `sbcUploadController.ts:41`). This all works; the only drift is that `fileFilter` in `uploadRoutes.ts` checks only `file.mimetype` (attacker-controlled), with the real content check deferred to `validateUploadFile`/`validatePdfHeader` post-buffering — which is the correct design but not how the prompt's "rejects ... early" wording reads.
- **Impact:** None functional — flagged only to keep the prompt honest per protocol "trust the code."
- **Fix:** No code change. Update the prompt to note that `fileFilter` is a cheap MIME pre-filter and the authoritative content validation is magic-byte + PDF-header after the buffer is in memory.
- **Evidence:**
  ```ts
  // uploadRoutes.ts:36 — MIME-only fileFilter
  if (file.mimetype === 'application/pdf') { cb(null, true); } else { cb(new BadRequestError(...)); }
  // shared.ts:72 — magic bytes DO cover PDF
  'application/pdf': [Buffer.from([0x25,0x50,0x44,0x46])],  // %PDF
  ```

### F-6 — Prompt drift: `fileRoutes.ts` header comments still say "signed URL"/"signed download URL" — **Low**
- **Location:** `backend/src/routes/fileRoutes.ts:8-10, 51, 58`; `backend/src/controllers/fileController.ts:5` (file-header docblock).
- **Observation:** The route file's docblock and inline comments still describe `GET /:id` as "Get a single file by ID with signed URL" and `GET /:id/download` as "Get a signed download URL." The implementation is the opposite: `getFile` returns metadata only with no `downloadUrl` (`fileController.ts:131-185`), and `getFileDownloadUrl` streams bytes via `getFileStream` (`fileController.ts:259-280`). The class-level comment at `fileController.ts:5` also still reads "Files are stored in Google Cloud Storage with signed URL access."
- **Impact:** None functional; misleading comments invite a future regression that re-introduces signed URLs (the exact capture-replay vector the rewrite removed).
- **Fix:** Update the stale comments in `fileRoutes.ts` and the `fileController.ts:5` docblock to describe the audited stream proxy.
- **Evidence:**
  ```
  fileRoutes.ts:9:  * - GET /:id/download - Get a signed download URL for a file
  fileController.ts:5: * Files are stored in Google Cloud Storage with signed URL access.
  ```

### F-7 — `labName`/`labDate` stored unencrypted on `UserFile` (arguably PHI) — **Info**
- **Location:** `backend/prisma/schema.prisma:127-128`.
- **Observation:** `UserFile.labName` (VarChar 255) and `UserFile.labDate` (Date) are plaintext columns; they are not in `PHI_FIELDS` (`encryption.ts`) and are returned plaintext by `getFiles`/`getFile`. The same values are also stored on `Biomarker.labName` (plaintext, `schema.prisma:156`) and `Biomarker.measurementDate`. Per the shared PHI inventory, dates/`measurementDate` are classified as metadata-not-PHI, and lab name alone is borderline. Access is still gated by `authenticate` + RLS + per-row `userId` scope.
- **Impact:** Low confidentiality exposure relative to the encrypted biomarker values; a DB-at-rest compromise would reveal which lab a user used and the report date, but not the values. Consistent with the existing project decision to leave `Biomarker.labName`/dates plaintext.
- **Fix:** No change required if the team accepts lab name/date as non-PHI metadata (consistent with `_phi-inventory.md`). If treated as PHI, add `labNameEncrypted` and store `labDate` encrypted, and add to `PHI_FIELDS`. Documenting the accepted exception is sufficient.
- **Evidence:**
  ```
  schema.prisma:127:  labName              String?     @map("lab_name") @db.VarChar(255)
  schema.prisma:128:  labDate              DateTime?   @map("lab_date") @db.Date
  ```

### F-8 — Single-file delete uses log-and-continue GCS semantics, diverging from the hard-abort bulk path (orphaned-object risk) — **Info**
- **Location:** `backend/src/controllers/fileController.ts:318-344` (`deleteFile`).
- **Observation:** On single-file delete, a GCS deletion failure is logged and the DB record is still deleted (`fileController.ts:328-330` "Continue with database deletion even if GCS fails"). This contradicts the bulk-delete invariant in `settingsController.deleteAllData`/`deleteAccount`, which deletes GCS **first** and hard-aborts on any non-404 failure precisely because an orphaned GCS object with no DB pointer is unrecoverable PHI (`settingsController.ts:767-801`). The divergence is explicitly acknowledged in code as deferred work "F-22."
- **Impact:** If GCS delete fails (transient outage, IAM hiccup) during a single-file delete, the DB row is removed and the underlying PHI object remains in the bucket with no record pointing to it — it will never be cleaned up. Bounded blast radius (one file per failed op, user-initiated) and already tracked as F-22.
- **Fix:** Adopt the bulk path's order/semantics in `fileController.deleteFile`: attempt GCS delete first, treat 404 as success, and on any other failure return an error and preserve the DB row for retry.
- **Evidence:**
  ```ts
  // fileController.ts:328
  // Continue with database deletion even if GCS fails
  // The file might already be deleted or the storage key might be invalid
  ```

## Checks passed

### 1. Upload Validation
- [x] MIME type validated by multer `fileFilter` (PDF-only / PDF+images for OCR) — `uploadRoutes.ts:35-43` and `:52-67`.
- [x] Magic bytes verified against declared MIME (`validateMagicBytes`/`MAGIC_BYTES`, includes PDF/PNG/JPEG/GIF/TIFF/WebP) — `upload/shared.ts:71-92, 143`.
- [x] PDF header + version checked via `validatePdfHeader` on every PDF path (lab Claude `labUploadController.ts:44`; OCR PDF `labUploadController.ts:201-203`; SBC `sbcUploadController.ts:41`; reanalyze `sbcUploadController.ts:233`) — implementation `securePdfParsing.ts:56-105`.
- [x] Allowed types explicitly whitelisted (`SUPPORTED_MIME_TYPES`) — `upload/shared.ts:55-58`.
- [x] File size 10MB enforced in multer (`limits.fileSize`) AND `validateUploadFile` — `uploadRoutes.ts:32`, `upload/shared.ts:136-139`; single file only (`limits.files: 1`) — `uploadRoutes.ts:33, 50`.
- [x] Filename sanitized (basename, strips control + path-sep + quote chars, caps 255) and mutates `file.originalname` — `upload/shared.ts:107-113, 149`.
- [x] Original filename stored as `originalFilename`, NOT used for storage key — `labUploadController.ts:98`, schema `schema.prisma:123`.
- [x] Storage key uses server `crypto.randomUUID()` fileId — `labUploadController.ts:70`, `sbcUploadController.ts:74`, key built `storageService.ts:57-58`.
- [x] Upload rejected before processing on validation failure (`validateUploadFile` throws `ValidationError`) — `upload/shared.ts:124, 133, 137`.

### 2. Google Cloud Storage Security
- [x] `GCS_BUCKET_NAME` read from env via `config`, with a production hard-fail if unset — `config/index.ts:168, 399-405`; storage reads `config.gcp.bucketName` — `storageService.ts:25`.
- [x] `GOOGLE_APPLICATION_CREDENTIALS` taken from env, not hardcoded (JSON or file path) — `ocrService.ts:90-106`; GCS client uses ADC/projectId — `storageService.ts:16-18`.

### 3. Download Egress Security (backend stream proxy, NOT signed URLs)
- [x] Signed `read` URLs are gone — Grep for `getSignedUrl` / `action: 'read'` returns only comments in `storageService.ts:97` and `fileController.ts:125`; no `getSignedUrl(...)` call exists.
- [x] Download bytes proxied through backend (`getFileStream` → `stream.pipe(res)`), never a direct GCS link — `storageService.ts:108-112`, `fileController.ts:259-280`.
- [x] Every download passes `authenticate` + RLS + ownership (`findFirst({ id, userId })`) — `fileRoutes.ts:42, 59-64`, `fileController.ts:210-222`.
- [x] `Cache-Control: no-store, no-cache, private` + `Pragma: no-cache` + `X-Content-Type-Options: nosniff` set — `fileController.ts:251-253`.
- [x] `Content-Disposition` filename strips `"`, CR, LF, `\` — `fileController.ts:243-245` (encoding nit noted in F-3).
- [x] Export audit logged BEFORE streaming (`logExport` with `FILE_DOWNLOAD`) — `fileController.ts:231-238`.
- [x] `getFile` (metadata) no longer mints a `downloadUrl` — `fileController.ts:158-173` returns metadata only.
- [x] Stream errors handled (502 if headers not sent, else `res.end()`) without leaking storage internals — `fileController.ts:260-279`.

### 4. File Processing Security
- [x] All PDF parsing routed through `secureParsePdf` — `pdfTextExtraction.ts:46` (primary Claude path), `pdfParser.ts:892, 1344` (SBC regex + lab regex); no raw `pdfParse(buffer)`/`pdfParser(buffer)` bypass found outside `securePdfParsing.ts:170`.
- [x] PDF-bomb DoS guards: header/version validation, 30s timeout (`PDF_PARSE_TIMEOUT_MS`), 100MB heap-growth cap (`MAX_MEMORY_INCREASE_BYTES`), compression-ratio logging — `securePdfParsing.ts:18-21, 158-214`.
- [x] Multer uses memory storage (no temp files) — `uploadRoutes.ts:30, 47`; Grep for `writeFile`/`createWriteStream`/`tmpdir`/`diskStorage` in `backend/src` returns no matches.
- [x] PDF content not logged (only sizes/pages/timings); extraction logs omit value/unit/range — `pdfParser.ts:50-57, 147-154`, `securePdfParsing.ts:163-222`.
- [x] PHI redacted before AI on text path (`extractTextFromPDF` → `redactPHI`; `stripPHIFromText` on response) — `claudeExtraction.ts:117, 135, 182`; redactor `phiRedaction.ts:97-110`.
- [x] Claude text calls gated by `ANTHROPIC_BAA_ACTIVE` hard throw — `claudeExtraction.ts:106-111`; OCR images gated by `GOOGLE_BAA_ACTIVE` — `ocrService.ts:274-280`; config `config/index.ts:176, 185`.
- [x] Extraction errors categorized (`BadRequestError` vs `InternalServerError`) without exposing file content — `securePdfParsing.ts:231-274`, `ocrService.ts:416-448`.
- [x] Processing timeout prevents hung ops (30s PDF parse, 60s Document AI) — `securePdfParsing.ts:18`, `ocrService.ts:298`.

### 5. Client-Side Processing
- [x] Tesseract.js OCR + pdf.js run in browser only (no upload of raw bytes for client parse) — `src/utils/biomarkers/labReportParser.ts:8-13` (pdfjs worker + Tesseract `createWorker`), local parse in `src/utils/documents/fileProcessing.ts:181-230`.
- [x] Extraction confidence scores surfaced — `fileProcessing.ts:165-179, 210-218`.

### 6. File Metadata & Database
- [x] `UserFile` stores metadata, not content; `storageKey` maps to GCS path, never a public URL — `schema.prisma:119-139`.
- [x] `userId` FK with `onDelete: Cascade`; `user_files` covered by RLS (`user_id = current_setting('app.current_user_id')`) — `schema.prisma:134`, migration `20260108000000_add_user_files_table/migration.sql:25, 37-66`.
- [x] On delete: GCS object removed, biomarkers UNLINKED (`userFileId = null`, not deleted), then DB record removed — `fileController.ts:319, 333-344`.

### 7. Access Control
- [x] Users can only list/download/delete their own files (RLS + `where:{ id, userId }`) — `fileController.ts:56-72, 140-149, 210-222, 299-304`.
- [x] No enumeration: UUID PKs (`gen_random_uuid()` / `crypto.randomUUID()`), UUID param validation on routes — `schema.prisma:120`, `fileRoutes.ts:46-70` (`schemas.uuidParam`).

### 8. Rate Limiting & Plan Gating
- [x] `uploadLimiter` (20/hour) applied to all upload routes via `router.use` — `uploadRoutes.ts:26`, limiter `rateLimiter.ts:76-89`.
- [x] `aiLimiter` (10/hour, user-keyed) on lab-report, SBC, and OCR handlers — `uploadRoutes.ts:80, 97, 127`, limiter `rateLimiter.ts:108-125`.
- [x] `sensitiveLimiter` (10/hour) on `GET /files/:id/download` — `fileRoutes.ts:61`, limiter `rateLimiter.ts:92-105`.
- [x] `requirePlanLimit('pdfUploadsPerMonth')` gates each upload — `uploadRoutes.ts:82, 99, 129`; DB-fresh plan read under RLS — `planGating.ts:66-72`.
- [x] `blockDemoAI` blocks demo account from AI-backed extraction — `uploadRoutes.ts:81, 98, 128`.
- [x] Limiters share a Redis store when `REDIS_URL` set, else per-instance MemoryStore — `rateLimiter.ts:5, 17, 76-77, 108-109` via `createRateLimitStore`.

### 9. Audit Logging
- [x] Uploads logged (user, filename, type, size, biomarkers) — `labUploadController.ts:141-150`, `sbcUploadController.ts:165-180`.
- [x] Downloads logged before stream (`logExport` FILE_DOWNLOAD) — `fileController.ts:231-238`; list/get logged — `fileController.ts:98-105, 176-177`.
- [x] Deletions logged before deletion (`logDelete`) — `fileController.ts:311-315`.
- [x] No file content in audit logs (metadata + counts only) — `labUploadController.ts:141-150`, `fileController.ts:312-315`.

### Cross-cutting (Questions to Ask)
- [x] Account-deletion GCS cleanup hard-aborts on non-404 failure, GCS-before-DB ordering — `settingsController.ts:759-801` (`deleteAllData`), `:933-954` (`deleteAccount`); `storageService.deleteFiles` returns per-file ok/error, never throws — `storageService.ts:162-181`.
- [x] FHIR lab-sync alt path encrypts OAuth tokens + biomarker values and audit-logs — `fhir/labSyncService.ts:142-143, 152-162, 299, 343-351`.

## Unverifiable
- GCS bucket-level configuration (private/no-public-ACL, uniform bucket-level access, no wildcard CORS, versioning, lifecycle rules) — these are GCP infrastructure settings (IAM/bucket config), not present in the repo. Cannot confirm from code. The code never sets per-object ACLs or public URLs (`storageService.ts` uses `file.save`/`createReadStream`/`delete` only), which is consistent with a private uniform-access bucket, but the bucket policy itself is out of repo scope.
- Malware/AV scanning of uploaded files before GCS persistence — no scanning code found in the upload path (`labUploadController.ts`, `sbcUploadController.ts`, `storageService.uploadFile`). If scanning exists it is an external GCP/edge control not represented in the repo; flagged as absent in code.
- Per-user total storage quota beyond `pdfUploadsPerMonth` — only the monthly upload-count plan gate (`requirePlanLimit('pdfUploadsPerMonth')`) and 10MB/file limit were found; no byte-quota enforcement code located. May be intentional (count-based gating) — noted, not a confirmed gap.

## Out of scope
- Detailed correctness of biomarker/SBC regex extraction (`biomarkerExtractor.ts`, `biomarkerPatterns.ts`, `pdfParser.ts` pattern accuracy) — data-quality, not a storage-security concern.
- SMART-on-FHIR OAuth handshake / SSRF guard (`fhir/smartAuth.ts`, `fhir/urlSafety.ts`) — owned by prompt 09-external-apis; only the lab-sync encryption/audit coverage was confirmed here.
- Encryption-service internals and full `PHI_FIELDS` diff — owned by prompt 02-encryption / `_phi-inventory.md`; only the file-domain fields (`UserFile`) were assessed.
- Application-log PHI redaction (`logger.sanitizeData`) internals — owned by prompt 31-logging-observability.
