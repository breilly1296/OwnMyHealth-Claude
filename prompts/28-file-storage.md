---
tags:
  - security
  - infrastructure
  - medium
type: prompt
priority: 3
updated: 2026-06-01
---

# File Storage & Document Processing Security Review

## Files to Review
- `backend/src/services/storageService.ts` (Google Cloud Storage; download is now a backend stream proxy, NOT signed URLs)
- `backend/src/services/ocrService.ts` (Google Document AI)
- `backend/src/services/pdfParser.ts` (regex SBC parser; routes pdf-parse through `securePdfParsing`)
- `backend/src/services/pdfTextExtraction.ts` (local PDF text extraction before AI — minimum-necessary)
- `backend/src/services/biomarkerExtractor.ts` + `biomarkerPatterns.ts` (lab value extraction)
- `backend/src/services/claudeExtraction.ts` (Claude lab extraction; text-only path — redacts text via `phiRedaction` then sends text to Claude; scanned/image PDFs are REJECTED and routed to OCR, there is deliberately no Claude Vision fallback)
- `backend/src/services/sbcExtraction.ts` (insurance document parsing via Claude)
- `backend/src/controllers/upload/` (upload handlers — `index.ts`, `labUploadController.ts`, `sbcUploadController.ts`, `shared.ts`; the old top-level `uploadController.ts` was REMOVED)
- `backend/src/controllers/fileController.ts` (file management)
- `backend/src/routes/uploadRoutes.ts` (upload endpoints)
- `backend/src/routes/fileRoutes.ts` (file endpoints)
- `backend/src/middleware/rateLimiter.ts` (upload rate limits) + `rateLimitStore.ts` (Redis/in-memory backing)
- `backend/src/middleware/planGating.ts` (`requirePlanLimit('pdfUploadsPerMonth')` on upload routes)
- `backend/src/utils/securePdfParsing.ts` (PDF-bomb DoS guard: header check, 30s timeout, 100MB heap-growth guard)
- `backend/src/utils/pdfRedaction.ts` (`redactPatientBanner` — opaque top-15% banner cover; DEFINED but currently UNWIRED — no caller imports it because the Claude Vision path it was built for was never shipped; flag as dead code)
- `backend/src/utils/phiRedaction.ts` (text scrubber applied before/after AI calls)
- `backend/src/services/fhir/labSyncService.ts` (FHIR lab-result ingestion — alternative non-file lab data path)
- `backend/prisma/schema.prisma` (UserFile model)
- `src/components/upload/` (frontend upload components: `ClinicalFileUpload`, `ExtractionReviewStep`, `LabUploadModal`, `PDFUploadModal`)
- `src/utils/biomarkers/labReportParser.ts` (client-side parsing)
- `src/utils/documents/fileProcessing.ts` (client-side validation)

## OwnMyHealth File Storage Architecture
- **Storage**: Google Cloud Storage (GCS) bucket; object key = `{userId}/{fileId}.{ext}`
- **Upload Flow**: Client → Backend (Multer memory storage, 10MB, single file) → magic-byte + PDF-header validation → GCS
- **Download**: Backend stream proxy via `getFileStream` (GET `/files/:id/download`). Signed `read` URLs were REMOVED — the 15-min unbound link was a capture-replay PHI egress vector. Every download now passes authenticate + RLS + ownership, with `Cache-Control: no-store` and a sanitized `Content-Disposition`.
- **Processing**: local pdf-parse text extraction (`pdfTextExtraction`) → PHI redaction → Claude extraction; OCR (Google Document AI) for scanned/image labs; regex `pdfParser` fallback for SBC
- **Minimum-necessary AI**: text path redacts PHI before Anthropic (`redactPHI`); no Claude Vision path exists — scanned PDFs are rejected to OCR. (`pdfRedaction.redactPatientBanner` is implemented but has NO caller — verify whether it should be wired in or removed)
- **Client-Side**: Tesseract.js OCR, pdf.js text extraction (fallback)
- **File Types**: Lab reports (PDF + OCR images PNG/JPEG/TIFF/GIF/WebP), insurance SBC (PDF), clinical documents
- **Alt lab path**: FHIR lab-sync (`fhir/labSyncService`) pulls Observations directly — no file upload, but still creates encrypted biomarkers

## Checklist

### 1. Upload Validation
- [ ] MIME type validated by multer `fileFilter` (rejects non-allowed Content-Type early)
- [ ] Magic bytes verified against declared MIME in `controllers/upload/shared.ts` (`validateMagicBytes` / `MAGIC_BYTES`) — header is attacker-controlled, content is not
- [ ] PDF header + version checked via `validatePdfHeader` (`utils/securePdfParsing.ts`) on every PDF path (lab + OCR)
- [ ] Allowed types explicitly whitelisted (`SUPPORTED_MIME_TYPES`: PDF-only for lab/SBC; PDF + PNG/JPEG/TIFF/GIF/WebP for OCR)
- [ ] File size limits enforced (10MB max — multer `limits.fileSize` AND `validateUploadFile`); single file only (`limits.files: 1`)
- [ ] Filename sanitized (`sanitizeFilename`: basename only, strips control + path-sep + quote chars, caps 255 bytes); mutates `file.originalname` so all downstream consumers get the safe form
- [ ] Original filename stored as `originalFilename` but NOT used for storage key
- [ ] Storage key uses server `crypto.randomUUID()` fileId, not user-controlled names
- [ ] Upload rejected before processing if validation fails (`validateUploadFile` throws `ValidationError`)

### 2. Google Cloud Storage Security
- [ ] GCS bucket is private (no public access)
- [ ] Bucket-level IAM restricts access to service account only
- [ ] No wildcard CORS on bucket
- [ ] Uniform bucket-level access (no per-object ACLs)
- [ ] `GCS_BUCKET_NAME` from environment variable
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` secured (not in code)
- [ ] Bucket versioning enabled (recovery from overwrites)
- [ ] Lifecycle rules for old file cleanup (if applicable)

### 3. Download Egress Security (backend stream proxy, NOT signed URLs)
> Signed `read` URLs were REMOVED (see `storageService.getFileStream` and `fileController.getFileDownloadUrl` comments): a 15-min unbound link was a capture-replay PHI vector. Verify the proxy replaced them fully — `getSignedUrl(...'read')` must not reappear.
- [ ] Download bytes proxied through the backend (`getFileStream` → `stream.pipe(res)`), never a direct GCS link
- [ ] Every download passes `authenticate` + RLS + ownership (`findFirst({ id, userId })`) before any byte is read
- [ ] `Cache-Control: no-store, no-cache, private` + `Pragma: no-cache` + `X-Content-Type-Options: nosniff` set so caches/intermediaries can't retain PHI
- [ ] `Content-Disposition` filename sanitized (strip `"`, CR, LF, `\`) to prevent header injection
- [ ] Export audit logged BEFORE streaming (`logExport` with `FILE_DOWNLOAD`) so an aborted transfer is still recorded as a disclosure
- [ ] `getFile` (metadata) no longer mints a `downloadUrl` — single egress path is `/files/:id/download`
- [ ] Stream errors handled (502 if headers not yet sent; close otherwise) without leaking storage internals

### 4. File Processing Security
- [ ] PDF parsing routed through `secureParsePdf` (`securePdfParsing.ts`) — both the primary `pdfTextExtraction` path AND the regex `pdfParser` fallback (no raw `pdfParse(buffer)` call bypassing it)
- [ ] PDF-bomb DoS guards present: header/version validation, 30s parse timeout (`PDF_PARSE_TIMEOUT_MS`), 100MB heap-growth cap (`MAX_MEMORY_INCREASE_BYTES`), suspicious compression-ratio logging
- [ ] Multer uses memory storage (no temp files on disk)
- [ ] File buffers cleared after processing
- [ ] PDF content not logged (may contain PHI) — only sizes, page counts, timings
- [ ] PHI redacted before AI on the text path: `extractTextFromPDF` → `redactPHI` (also `stripPHIFromText` on the Claude response) in `claudeExtraction.ts`. NOTE: `pdfRedaction.redactPatientBanner` (top 15% cover) is implemented but UNWIRED — claudeExtraction/sbcExtraction have no Vision fallback (scanned PDFs are rejected to OCR). Confirm it's intentionally dead or should be removed/wired.
- [ ] `pdfRedaction.redactPatientBanner` fails OPEN by design (returns the original buffer on error, relying on the BAA backstop) — note: this is moot while it has no caller. Claude text calls are gated by `ANTHROPIC_BAA_ACTIVE` (hard throw in `extractBiomarkersWithClaude`); OCR by `GOOGLE_BAA_ACTIVE`
- [ ] Extraction errors don't expose file content in error messages
- [ ] Malformed PDFs handled gracefully (no crash; `BadRequestError` vs `InternalServerError` categorized)
- [ ] Processing timeout prevents hung operations

### 5. Client-Side Processing
- [ ] Tesseract.js OCR runs entirely in browser (no data sent to external service)
- [ ] pdf.js text extraction is local only
- [ ] Client-side extracted data sent to backend for validation/storage
- [ ] Extraction confidence scores included (user aware of accuracy)
- [ ] Large files handled without browser crashes (chunking/streaming)

### 6. File Metadata & Database
- [ ] UserFile model stores metadata, not file content
- [ ] `storageKey` maps to GCS object path; never exposes a public URL
- [ ] File metadata fields: `filename`, `originalFilename`, `fileType`, `fileSize`, `createdAt`
- [ ] Lab-specific metadata: `labName`, `labDate`, `biomarkersExtracted`, `extractionConfidence` (none are PHI-encrypted columns — confirm that's acceptable; lab name/date are arguably PHI)
- [ ] `userId` FK to User with `onDelete: Cascade`; `user_files` covered by RLS policy (`user_id = current_user_id()`)
- [ ] On file delete: GCS object removed, then linked biomarkers UNLINKED (`userFileId = null`, NOT deleted), then DB record removed; GCS failure is logged but DB delete still proceeds

### 7. Access Control
- [ ] Users can only list/download/delete their own files
- [ ] File ownership verified on every operation
- [ ] Provider access to patient files follows consent permissions
- [ ] Admin file access audit logged
- [ ] No file enumeration possible (UUIDs, not sequential IDs)

### 8. Rate Limiting & Plan Gating
- [ ] `uploadLimiter` (20/hour) applied via `router.use` to ALL upload routes
- [ ] `aiLimiter` (10/hour, keyed by user ID) stacked on lab-report, SBC, and OCR handlers (Claude/Document AI cost protection)
- [ ] `sensitiveLimiter` (10/hour) on the download endpoint (`GET /files/:id/download`)
- [ ] `requirePlanLimit('pdfUploadsPerMonth')` (planGating) gates each upload to the user's billing tier
- [ ] `blockDemoAI` blocks the demo account from AI-backed upload extraction
- [ ] Limiters share a Redis store via `rateLimitStore.ts` when `REDIS_URL` set (otherwise per-instance MemoryStore → N×limit ceiling on Cloud Run)
- [ ] File size + rate limits + plan limits together prevent storage/cost abuse

### 9. Audit Logging
- [ ] File uploads logged (user, filename, type, size)
- [ ] File downloads logged (user, file ID, IP)
- [ ] File deletions logged
- [ ] Extraction results logged (count of biomarkers, confidence)
- [ ] No file content in audit logs

## Verification Commands
```bash
# Find upload handling code (handlers now live under controllers/upload/)
grep -rn "multer\|memoryStorage\|multipart" backend/src/

# Check file type + magic-byte validation
grep -rn "mimetype\|MAGIC_BYTES\|validateMagicBytes\|validatePdfHeader" backend/src/controllers/upload/ backend/src/utils/securePdfParsing.ts

# Confirm signed read URLs are GONE (should NOT appear with action 'read')
grep -rn "getSignedUrl\|action: 'read'" backend/src/

# Verify download is a backend stream proxy
grep -rn "getFileStream\|createReadStream\|no-store" backend/src/services/storageService.ts backend/src/controllers/fileController.ts

# PDF-bomb DoS guard wiring (no raw pdfParse bypassing secureParsePdf)
grep -rn "secureParsePdf\|PDF_PARSE_TIMEOUT_MS\|MAX_MEMORY_INCREASE_BYTES\|pdfParse(" backend/src/services/ backend/src/utils/securePdfParsing.ts

# PHI redaction before AI (expect redactPHI/stripPHIFromText wired in claudeExtraction;
# redactPatientBanner should appear ONLY in pdfRedaction.ts — it has no caller)
grep -rn "redactPHI\|redactPatientBanner\|stripPHIFromText" backend/src/services/ backend/src/utils/

# Check for temp file creation
grep -rn "writeFile\|createWriteStream\|tmpdir\|os.tmpdir" backend/src/

# Verify file access control (RLS + userId scope)
grep -rn "withRLSTransaction\|findFirst" backend/src/controllers/fileController.ts
```

## Questions to Ask
1. Is the GCS bucket configured with uniform access and no public ACLs?
2. With signed read URLs removed, does any code path still hand a GCS link to the client, or is `getFileStream` truly the only egress?
3. Are uploaded files ever scanned for malware before GCS persistence?
4. What happens to GCS objects when a user deletes their account? (cross-check `settingsController.deleteAccount` / `deleteAllData` + `storageService.deleteFiles` hard-abort semantics)
5. Is there a maximum storage quota per user beyond `pdfUploadsPerMonth` plan gating?
6. `labName`/`labDate` on `UserFile` are stored UNencrypted — is that an accepted PHI exception or a gap?
7. `pdfRedaction.redactPatientBanner` fails OPEN (returns the original buffer on error) but has NO caller — is it intended to be wired into a future Vision path, or should it be deleted? (Today the only AI path is text-only `redactPHI`, gated by a hard `ANTHROPIC_BAA_ACTIVE` check in `extractBiomarkersWithClaude`.)
8. FHIR lab-sync (`fhir/labSyncService`) ingests biomarkers with no UserFile — does that path get the same encryption + audit coverage as uploads? (it should: encrypts values, logs to `LabConnection` audit)
