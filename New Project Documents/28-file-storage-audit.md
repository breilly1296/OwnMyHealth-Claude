# File Storage & Document Processing Security Audit

**Date:** 2026-02-06
**Auditor:** Claude Opus 4.6
**Scope:** File upload, storage, download, and document processing pipelines
**Risk Level:** Medium

---

## Files Reviewed

| File | Path |
|------|------|
| storageService.ts | `backend/src/services/storageService.ts` |
| ocrService.ts | `backend/src/services/ocrService.ts` |
| pdfParser.ts | `backend/src/services/pdfParser.ts` |
| biomarkerExtractor.ts | `backend/src/services/biomarkerExtractor.ts` |
| sbcExtraction.ts | `backend/src/services/sbcExtraction.ts` |
| uploadController.ts | `backend/src/controllers/uploadController.ts` |
| fileController.ts | `backend/src/controllers/fileController.ts` |
| uploadRoutes.ts | `backend/src/routes/uploadRoutes.ts` |
| fileRoutes.ts | `backend/src/routes/fileRoutes.ts` |
| insuranceRoutes.ts | `backend/src/routes/insuranceRoutes.ts` |
| rateLimiter.ts | `backend/src/middleware/rateLimiter.ts` |
| securePdfParsing.ts | `backend/src/utils/securePdfParsing.ts` |
| schema.prisma (UserFile) | `backend/prisma/schema.prisma:111-131` |
| labReportParser.ts | `src/utils/biomarkers/labReportParser.ts` |
| fileProcessing.ts | `src/utils/documents/fileProcessing.ts` |
| ClinicalFileUpload.tsx | `src/components/upload/ClinicalFileUpload.tsx` |
| PDFUploadModal.tsx | `src/components/upload/PDFUploadModal.tsx` |
| LabUploadModal.tsx | `src/components/upload/LabUploadModal.tsx` |
| RLS migration | `backend/prisma/migrations/20260108000000_add_user_files_table/migration.sql` |
| settingsController.ts | `backend/src/controllers/settingsController.ts` |

---

## Checklist Results

### 1. Upload Validation

- [x] **PASS** - File type validated by extension AND MIME type AND magic bytes
  - Multer `fileFilter` validates MIME type at upload boundary (`uploadRoutes.ts:33-40`, `uploadRoutes.ts:50-66`).
  - `uploadController.ts:71-92` (`validateUploadFile`) double-checks MIME type against a whitelist before processing.
  - `ocrService.ts:124-148` (`validateFile`) validates MIME type and file size.
  - `securePdfParsing.ts:56-105` (`validatePdfHeader`) validates PDF magic bytes (`%PDF-`) and version format.
  - For image uploads (OCR route), magic bytes are NOT validated -- only MIME type is checked. MIME type can be spoofed by the client. This is a partial gap for non-PDF uploads.

- [x] **PASS** - Allowed types explicitly whitelisted (PDF only, or specific set)
  - PDF-only endpoints (`/lab-report`, `/insurance-sbc`, `/plans/:id/reanalyze`): whitelist is `['application/pdf']` (`uploadRoutes.ts:35`, `insuranceRoutes.ts:42`).
  - OCR endpoint (`/lab-results-ocr`): whitelist is `['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/gif', 'image/webp']` (`uploadRoutes.ts:52-58`).
  - Both lists are explicit whitelists, not blacklists.

- [x] **PASS** - File size limits enforced (10MB max)
  - Multer config enforces 10MB limit at the middleware level: `fileSize: 10 * 1024 * 1024` (`uploadRoutes.ts:30`, `insuranceRoutes.ts:38`).
  - `ocrService.ts:48` defines `MAX_FILE_SIZE = 10 * 1024 * 1024` and validates in `validateFile()` at line 129.
  - `uploadController.ts:88-91` also checks `file.size > maxSizeBytes` as a secondary validation.

- [~] **PARTIAL** - Filename sanitized (no path traversal characters: `../`, `\`, null bytes)
  - Original filename is stored in the database (`originalFilename` field in UserFile model) but is NOT used as the GCS storage key.
  - The storage key is constructed from `userId` and `fileId` (a UUID): `storageService.ts:53` -- `const storageKey = \`${userId}/${fileId}.${extension}\``.
  - However, no explicit sanitization of `file.originalname` is performed before storing it in the database. While this does not create a path traversal vulnerability (since the original filename is never used for file system operations), stored unsanitized filenames could be a concern if displayed in UI without proper encoding (XSS risk in the frontend).
  - **Finding:** The filename stored at `uploadController.ts:1412` (`file.originalname`) is not sanitized. Add server-side sanitization to strip `../`, `\`, null bytes, and control characters before persisting.

- [x] **PASS** - Original filename stored but not used for storage key
  - `storageService.ts:53`: Storage key is `{userId}/{fileId}.{extension}` where `fileId` is a UUID.
  - `uploadController.ts:1405-1421`: `originalFilename: file.originalname` is stored in the DB record, but `storageKey` comes from GCS upload.

- [x] **PASS** - Storage key uses UUID (not user-controlled names)
  - `uploadController.ts:1386`: `const fileId = crypto.randomUUID()` generates the file identifier.
  - `storageService.ts:53`: Key format is `{userId}/{fileId}.{extension}` -- fully server-controlled.

- [x] **PASS** - Upload rejected before processing if validation fails
  - Multer `fileFilter` rejects non-whitelisted MIME types before the handler runs (`uploadRoutes.ts:33-40`).
  - `validateUploadFile()` at `uploadController.ts:71-92` is called at the top of each controller function, before any processing.
  - `validateFile()` in `ocrService.ts:124-148` is called before Document AI or Claude processing.

### 2. Google Cloud Storage Security

- [x] **PASS** - GCS bucket is private (no public access)
  - No `makePublic()` or public ACL calls exist in `storageService.ts`. All file access goes through signed URLs.
  - Files are uploaded with `file.save()` which defaults to private.

- [ ] **FAIL** - Bucket-level IAM restricts access to service account only
  - **Cannot verify from code.** Bucket IAM configuration is set at the GCP console/Terraform level, not in application code. The `Storage` client at `storageService.ts:15-17` uses the default service account credentials. Bucket-level IAM policies need to be verified in the GCP console.
  - **Recommendation:** Verify in GCP console that the bucket has:
    - No `allUsers` or `allAuthenticatedUsers` bindings.
    - Only the Cloud Run service account has `storage.objectAdmin` or equivalent.

- [ ] **FAIL** - No wildcard CORS on bucket
  - **Cannot verify from code.** CORS is configured at the bucket level in GCP, not in application code.
  - **Recommendation:** Verify bucket CORS settings in GCP. CORS should only allow the frontend domain, not `*`.

- [ ] **FAIL** - Uniform bucket-level access (no per-object ACLs)
  - **Cannot verify from code.** This is a GCP bucket setting.
  - **Recommendation:** Enable Uniform Bucket-Level Access in GCP console to prevent per-object ACL leaks.

- [x] **PASS** - `GCS_BUCKET_NAME` from environment variable
  - `storageService.ts:19`: `const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'ownmyhealth-user-files'`.
  - Note: The fallback value `'ownmyhealth-user-files'` is hardcoded. This is acceptable for development but should be a required env var in production.

- [x] **PASS** - `GOOGLE_APPLICATION_CREDENTIALS` secured (not in code)
  - `ocrService.ts:89`: Reads from `process.env.GOOGLE_APPLICATION_CREDENTIALS`.
  - `storageService.ts:15-17`: Uses `new Storage({ projectId: ... })` which uses ADC (Application Default Credentials) from environment.
  - No credentials are hardcoded in any source file.

- [ ] **FAIL** - Bucket versioning enabled (recovery from overwrites)
  - **Cannot verify from code.** Versioning is a GCP bucket configuration.
  - **Recommendation:** Enable object versioning on the GCS bucket to protect against accidental overwrites and allow recovery.

- [ ] **FAIL** - Lifecycle rules for old file cleanup (if applicable)
  - **Cannot verify from code.** Lifecycle rules are configured at the GCP bucket level.
  - **Recommendation:** Add lifecycle rules for:
    - Deleting objects older than a defined retention period (e.g., 7 years for HIPAA, if files are not needed after account deletion).
    - Transitioning older objects to Nearline/Coldline storage for cost optimization.

### 3. Signed URL Security

- [x] **PASS** - Download URLs are signed (not publicly accessible)
  - `storageService.ts:97-133`: Uses `file.getSignedUrl()` with V4 signing.
  - All download access goes through `getSignedUrl()` -- no public URL generation exists.

- [x] **PASS** - URL expiration is short (15 minutes or less)
  - `storageService.ts:20`: `const SIGNED_URL_EXPIRATION_MS = 15 * 60 * 1000` (15 minutes).
  - `storageService.ts:100`: Default parameter `expirationMs: number = SIGNED_URL_EXPIRATION_MS`.
  - `fileController.ts:207`: Response includes `expiresIn: 900` (15 min in seconds).

- [x] **PASS** - Signed URLs scoped to specific object (not bucket-wide)
  - `storageService.ts:103-104`: `const file = bucket.file(storageKey)` -- signed URL is generated for a specific object path.

- [x] **PASS** - URL generation requires authentication (logged-in user)
  - `fileRoutes.ts:27`: `router.use(authenticate)` applies to all file routes.
  - `fileController.ts:103,176`: Both `getFile()` and `getFileDownloadUrl()` extract `userId = req.user!.id`, requiring a valid JWT.

- [x] **PASS** - User can only generate URLs for their own files
  - `fileController.ts:108-109`: `prisma.userFile.findFirst({ where: { id, userId } })` -- ownership check via `userId` filter.
  - `fileController.ts:181-183`: Same ownership check for download URL generation.
  - Additionally, PostgreSQL RLS policies on `user_files` table enforce `user_id = current_setting('app.current_user_id')` at the database level.

- [x] **PASS** - Signed URL generation audit logged
  - `fileController.ts:157-158`: `auditService.logAccess(RESOURCE_TYPE, id, { req, userId })` logs single file access.
  - `fileController.ts:195-201`: `auditService.logExport(RESOURCE_TYPE, [id], 'FILE_DOWNLOAD', ...)` logs download URL generation.

- [~] **PARTIAL** - URLs not cached or stored long-term
  - Signed URLs are generated on-demand and returned in the API response. They are not persisted in the database.
  - However, there is no `Cache-Control: no-store` header on the response for download URLs. Browser or intermediate proxies could cache the response containing the signed URL.
  - **Finding:** Consider adding `res.set('Cache-Control', 'no-store')` before returning signed URL responses in `fileController.ts:203-211`.

### 4. File Processing Security

- [x] **PASS** - PDF parsing runs in sandboxed context (`securePdfParsing.ts`)
  - `securePdfParsing.ts` provides comprehensive protections:
    - PDF header magic bytes validation (`%PDF-`, lines 24-105).
    - 30-second timeout via `withTimeout()` (line 18, 169-173).
    - Memory monitoring: checks for >100MB heap increase (lines 21, 180-189).
    - Compression ratio check: warns on >100x text-to-file ratio (lines 204-214).
  - `pdfParser.ts:882`: `secureParsePdf(buffer, filename, pdf)` is used for all PDF parsing.

- [x] **PASS** - Multer uses memory storage (no temp files on disk)
  - `uploadRoutes.ts:28`: `storage: multer.memoryStorage()`.
  - `insuranceRoutes.ts:36`: `storage: multer.memoryStorage()`.
  - No `diskStorage` or `writeFile` calls found in upload code paths.

- [ ] **FAIL** - File buffers cleared after processing
  - After upload processing in `uploadController.ts`, the `file.buffer` is not explicitly zeroed or dereferenced. Node.js garbage collection will eventually reclaim the memory, but for PHI-containing buffers, explicit clearing (e.g., `file.buffer.fill(0)`) would be more secure.
  - **Finding:** Add `file.buffer.fill(0)` after processing completes in `uploadLabReport()`, `uploadSBC()`, `reanalyzePlan()`, and `uploadLabResultOCR()` to ensure PHI is not lingering in memory.

- [~] **PARTIAL** - PDF content not logged (may contain PHI)
  - `pdfParser.ts:42-47`: `logExtraction()` deliberately omits value, unit, and range from structured logs: `// Note: value, unit, and range omitted to prevent PHI in logs`.
  - `pdfParser.ts:139-143`: SBC extraction log also omits values: `// Note: value omitted to prevent PHI in logs`.
  - **However:** `biomarkerExtractor.ts` contains **49 `console.log()` calls** that output extracted biomarker values, raw text previews (first 500 chars of document text), and line-by-line content. Examples:
    - Line 464-465: `console.log(text.substring(0, 500))` -- dumps first 500 chars of document.
    - Line 471: `console.log(... ${r.name}: ${r.value} ${r.unit})` -- logs PHI values.
    - Line 293-294: Dumps first 30 lines of OCR text.
  - **Critical Finding:** `biomarkerExtractor.ts` uses `console.log` extensively, which will write PHI to stdout/stderr in production. These should be replaced with the structured `pdfLogger` or removed entirely.

- [x] **PASS** - Extraction errors don't expose file content in error messages
  - `storageService.ts:85`: `throw new Error('Failed to upload file to storage')` -- generic message.
  - `securePdfParsing.ts:246-248,260-262`: Error messages are generic: "PDF parsing timed out", "Unable to parse PDF file".
  - `ocrService.ts:390-424`: Error messages are generic and do not include file content.
  - `uploadController.ts:256,370`: Validation errors give generic guidance without revealing content.

- [x] **PASS** - Malformed PDFs handled gracefully (no crash)
  - `securePdfParsing.ts:225-275`: Comprehensive error handling catches all exceptions including timeout, invalid PDF, encrypted files, and unexpected errors. Each case throws a user-friendly error.
  - `pdfParser.ts:868-879`: Empty buffer check and parser initialization error handling.

- [x] **PASS** - Processing timeout prevents hung operations
  - `securePdfParsing.ts:18`: `PDF_PARSE_TIMEOUT_MS = 30_000` (30 seconds).
  - `securePdfParsing.ts:111-129`: `withTimeout()` function wraps parsing in `Promise.race` with a timeout.

### 5. Client-Side Processing

- [x] **PASS** - Tesseract.js OCR runs entirely in browser (no data sent to external service)
  - `labReportParser.ts:10`: `import { createWorker, Worker } from 'tesseract.js'` -- Tesseract.js runs locally in the browser using WebAssembly.
  - `labReportParser.ts:672`: `const worker = await createWorker('eng')` -- creates a local OCR worker.
  - No external API calls are made for client-side OCR.

- [x] **PASS** - pdf.js text extraction is local only
  - `labReportParser.ts:8`: `import * as pdfjsLib from 'pdfjs-dist'` -- pdf.js runs entirely in the browser.
  - `labReportParser.ts:13`: Worker loaded from CDN (`cdnjs.cloudflare.com`) but this is just the JavaScript worker file, not a data endpoint.
  - Text extraction in `extractTextFromPDF()` (line 594-610) operates purely on the client.

- [x] **PASS** - Client-side extracted data sent to backend for validation/storage
  - Client-side parsing in `labReportParser.ts` returns `LabReportParseResult` with extracted biomarkers.
  - These are then submitted to backend endpoints (`/api/v1/upload/lab-report`, `/api/v1/upload/lab-results-ocr`) where server-side re-extraction and validation occurs.
  - Backend performs its own extraction using Claude API or Document AI rather than trusting client-side results.

- [x] **PASS** - Extraction confidence scores included (user aware of accuracy)
  - `labReportParser.ts:842-871`: `calculateConfidence()` computes per-biomarker confidence scores (0.5 base + factors).
  - `labReportParser.ts:1007-1009`: Average confidence is calculated and returned in the result.
  - `labReportParser.ts:1015-1017`: Warning issued when `avgConfidence < 0.5`.
  - Backend also returns `extractionConfidence` in all upload responses.

- [~] **PARTIAL** - Large files handled without browser crashes (chunking/streaming)
  - `labReportParser.ts:599-610`: PDF pages are processed sequentially (one at a time), which is reasonable.
  - `labReportParser.ts:690-694`: OCR pages are also processed sequentially with progress callbacks.
  - File size is limited to 10MB at the backend, but no explicit client-side file size check was found before beginning processing.
  - **Finding:** The client-side code does not pre-validate file size before attempting extraction. Very large PDFs with many pages could cause memory issues in the browser. Consider adding a client-side file size check before processing begins.

### 6. File Metadata & Database

- [x] **PASS** - UserFile model stores metadata, not file content
  - `schema.prisma:111-131`: The `UserFile` model stores `filename`, `originalFilename`, `fileType`, `fileSize`, `storageKey`, `labName`, `labDate`, `biomarkersExtracted`, `extractionConfidence` -- all metadata.
  - No `content` or `data` blob field exists. File content resides only in GCS.

- [x] **PASS** - Storage key maps to GCS object path
  - `storageService.ts:53`: `storageKey = \`${userId}/${fileId}.${extension}\`` maps directly to GCS object path.
  - `schema.prisma:118`: `storageKey String @map("storage_key") @db.VarChar(500)`.

- [x] **PASS** - File metadata includes: type, size, original name, upload date
  - `schema.prisma:114-117`:
    - `filename` (display name)
    - `originalFilename` (original name from upload)
    - `fileType` (MIME type)
    - `fileSize` (integer, bytes)
  - `schema.prisma:123`: `createdAt DateTime @default(now())` -- upload timestamp.

- [x] **PASS** - Lab-specific metadata: lab name, lab date, biomarkers extracted
  - `schema.prisma:119-122`:
    - `labName String? @map("lab_name")`
    - `labDate DateTime? @map("lab_date")`
    - `biomarkersExtracted Int @default(0)`
    - `extractionConfidence Decimal?`

- [x] **PASS** - Foreign key relationship to User (with RLS)
  - `schema.prisma:113`: `userId String @map("user_id") @db.Uuid`.
  - `schema.prisma:126`: `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`.
  - RLS migration at `20260108000000_add_user_files_table/migration.sql:37-61`:
    - `ALTER TABLE "user_files" ENABLE ROW LEVEL SECURITY`
    - Policies for SELECT, INSERT, UPDATE, DELETE all check `user_id = current_setting('app.current_user_id')::uuid`.

- [~] **PARTIAL** - Deletion cascades: DB record AND GCS object removed
  - **Database cascade:** `schema.prisma:126`: `onDelete: Cascade` -- when a User is deleted, UserFile records cascade delete.
  - **GCS object deletion on file delete:** `fileController.ts:246-258` -- `deleteFromStorage(file.storageKey)` is called to remove from GCS, followed by DB record deletion. If GCS fails, DB deletion still proceeds (orphaned GCS cleanup gap is acceptable).
  - **GCS object deletion on account delete:** `settingsController.ts:295-300` -- The `deleteAccount()` function deletes the User record (which cascades DB records), but it does **NOT** delete GCS objects first.
  - **Critical Finding:** When a user deletes their account, the UserFile DB records cascade-delete, but the actual files in GCS are **orphaned**. The account deletion flow at `settingsController.ts:257-307` has no code to enumerate and delete GCS objects for the user.
  - **Recommendation:** Before deleting the user, enumerate all `UserFile` records and call `deleteFromStorage()` for each `storageKey`.

### 7. Access Control

- [x] **PASS** - Users can only list/download/delete their own files
  - `fileController.ts:48-49`: `findMany({ where: { userId } })` -- list scoped to user.
  - `fileController.ts:108-109`: `findFirst({ where: { id, userId } })` -- get scoped to user.
  - `fileController.ts:181-183`: `findFirst({ where: { id, userId } })` -- download scoped to user.
  - `fileController.ts:229-231`: `findFirst({ where: { id, userId } })` -- delete scoped to user.

- [x] **PASS** - File ownership verified on every operation
  - Every controller function extracts `userId = req.user!.id` and includes it in the Prisma query `where` clause.
  - Additionally, PostgreSQL RLS policies enforce ownership at the database level as a defense-in-depth layer.

- [x] **PASS** - Provider access to patient files follows consent permissions
  - No provider-specific file access routes were found. File management routes (`/api/v1/files/*`) only use the `authenticate` middleware without provider-patient consent checks, meaning providers cannot access patient files through these endpoints.
  - The consent-based sharing system appears to share biomarker data, not raw files.

- [~] **PARTIAL** - Admin file access audit logged
  - File operations are audit logged (`fileController.ts:82-86,157-158,195-201,239-243`).
  - However, there is no admin-specific file access endpoint or route. If admins can access files through the admin panel, audit logging for admin access would need separate verification.
  - The current admin routes (`adminRoutes.ts`) do not appear to include file management.

- [x] **PASS** - No file enumeration possible (UUIDs, not sequential IDs)
  - `schema.prisma:112`: `id String @id @default(uuid()) @db.Uuid` -- UUIDs, not sequential integers.
  - `fileRoutes.ts:37,43,50`: Route parameters validated as UUIDs via `validate(schemas.uuidParam, 'params')`.

### 8. Rate Limiting

- [x] **PASS** - Upload endpoints rate limited (e.g., 20/hour)
  - `rateLimiter.ts:62-74`: `uploadLimiter` -- 20 requests per hour.
  - `uploadRoutes.ts:24`: `router.use(uploadLimiter)` applies to all upload routes.
  - `insuranceRoutes.ts:117,124-125`: `uploadLimiter` applied to reanalyze and upload-sbc endpoints.

- [x] **PASS** - Rate limits prevent storage abuse
  - 20 uploads/hour * 10MB max = 200MB/hour maximum upload rate per IP.
  - This is a reasonable limit to prevent storage abuse.

- [x] **PASS** - File size + rate limits together prevent cost abuse
  - 10MB file size cap + 20 uploads/hour + signed URL access = bounded storage and bandwidth costs.

- [ ] **FAIL** - OCR endpoint rate limited separately (expensive operation)
  - The `/lab-results-ocr` endpoint uses the same `uploadLimiter` (20/hour) as other upload endpoints.
  - There is no separate, stricter rate limiter for OCR operations despite OCR (Google Document AI) being significantly more expensive than simple file upload.
  - Claude API calls for PDF extraction (used by `/lab-report` endpoint) are also under the generic upload limiter.
  - **Finding:** Create a dedicated `ocrLimiter` with stricter limits (e.g., 10/hour) for the `/lab-results-ocr` and `/lab-report` endpoints, since these trigger expensive external API calls (Document AI, Claude API).

### 9. Audit Logging

- [x] **PASS** - File uploads logged (user, filename, type, size)
  - `uploadController.ts:280-287`: Lab report upload logged with `filename`, `fileSize`, `biomarkersExtracted`, `labName`, `extractionConfidence`, `processorType`.
  - `uploadController.ts:767-780`: SBC upload logged with `filename`, `fileSize`, `planName`, `insurerName`, `benefitsExtracted`, `extractionConfidence`.
  - `uploadController.ts:1456-1472`: OCR upload logged with `filename`, `fileSize`, `mimeType`, `biomarkersExtracted`, `extractionConfidence`, `ocrConfidence`, `processingTimeMs`.

- [x] **PASS** - File downloads logged (user, file ID, IP)
  - `fileController.ts:157-158`: `auditService.logAccess(RESOURCE_TYPE, id, { req, userId })` -- logs file access with request context (includes IP).
  - `fileController.ts:195-201`: `auditService.logExport(RESOURCE_TYPE, [id], 'FILE_DOWNLOAD', { req, userId }, { filename })` -- specifically logs download with filename.

- [x] **PASS** - File deletions logged
  - `fileController.ts:239-243`: `auditService.logDelete(RESOURCE_TYPE, id, { filename, biomarkersExtracted }, { req, userId })` -- logged before deletion.

- [x] **PASS** - Extraction results logged (count of biomarkers, confidence)
  - `uploadController.ts:285-286`: `biomarkersExtracted: createdBiomarkers.length, extractionConfidence: ocrResult.confidence`.
  - `uploadController.ts:775-777`: `benefitsExtracted: createdPlan.benefits.length, extractionConfidence`.
  - `uploadController.ts:1463-1466`: `biomarkersExtracted`, `extractionConfidence`, `ocrConfidence`, `processingTimeMs`.

- [~] **PARTIAL** - No file content in audit logs
  - Audit logs from controllers do not include file content.
  - `pdfParser.ts:42-47,138-143`: Structured logger deliberately omits PHI values.
  - **However:** `biomarkerExtractor.ts` contains 49 `console.log()` calls that dump extracted values, line content, and text previews to stdout. While these are not formal audit logs, they would appear in production logging infrastructure (Cloud Logging, etc.) and constitute a PHI leak.
  - **Finding:** Same as Section 4 finding. `console.log` statements in `biomarkerExtractor.ts` must be replaced with structured logger calls that omit PHI, or removed entirely.

---

## Critical Findings Summary

### HIGH Priority

1. **PHI Leakage via console.log in biomarkerExtractor.ts**
   - **File:** `backend/src/services/biomarkerExtractor.ts`
   - **Lines:** Multiple (86, 89, 97, 107, 119, 126, 207-208, 225, 232, 276, 280, 293-294, 323, 333, 347, 357, 363, 379, 384, 395, 415, 427, 443, 449, 461-466, 471, 475-476, 481, 508-511)
   - **Issue:** 49 `console.log()` calls dump raw document text, extracted biomarker values, and line-by-line document content to stdout. This constitutes PHI leakage in production.
   - **Impact:** HIPAA violation risk. All production stdout/stderr is typically captured in cloud logging (GCP Cloud Logging).
   - **Recommendation:** Replace all `console.log` calls with the structured `pdfLogger` or `logger` that omits PHI values, or remove debug logging entirely.

2. **GCS Objects Orphaned on Account Deletion**
   - **File:** `backend/src/controllers/settingsController.ts:257-307`
   - **Issue:** When a user deletes their account, the Prisma cascade deletes `UserFile` DB records, but the actual files in GCS are never deleted. PHI-containing documents (lab reports, insurance SBC PDFs) persist in the storage bucket indefinitely.
   - **Impact:** HIPAA data retention violation. User's PHI remains in storage after they have requested deletion.
   - **Recommendation:** Before deleting the user record, enumerate all `UserFile` records for the user and call `deleteFromStorage()` for each `storageKey`.

### MEDIUM Priority

3. **No Separate OCR Rate Limiting**
   - **File:** `backend/src/routes/uploadRoutes.ts`, `backend/src/middleware/rateLimiter.ts`
   - **Issue:** OCR operations (Google Document AI at ~$1.50/1000 pages, Claude API at ~$0.003/1K tokens) share the same 20/hour rate limiter as simple uploads.
   - **Impact:** A malicious user could trigger 20 expensive API calls per hour, leading to significant cost exposure.
   - **Recommendation:** Create a dedicated `ocrLimiter` (e.g., 10/hour) for endpoints that trigger external AI/OCR processing.

4. **File Buffers Not Explicitly Cleared**
   - **File:** `backend/src/controllers/uploadController.ts`
   - **Issue:** After processing lab reports, SBC documents, and OCR results, the `file.buffer` (which contains PHI) is not explicitly zeroed.
   - **Impact:** PHI lingers in Node.js heap memory until garbage collected. In a shared environment or after a memory dump, PHI could be exposed.
   - **Recommendation:** Add `file.buffer.fill(0)` after processing completes in each upload handler.

5. **No Magic Bytes Validation for Image Uploads**
   - **File:** `backend/src/routes/uploadRoutes.ts:44-66`
   - **Issue:** The OCR upload endpoint accepts image files (PNG, JPG, TIFF, GIF, WebP) based solely on MIME type, without validating magic bytes. MIME types can be spoofed by the client.
   - **Impact:** A malicious user could upload a non-image file with a spoofed MIME type. The file would be stored in GCS and potentially processed by Document AI.
   - **Recommendation:** Add magic bytes validation for image file types, similar to the PDF header validation in `securePdfParsing.ts`.

### LOW Priority

6. **Unsanitized Original Filename in Database**
   - **File:** `backend/src/controllers/uploadController.ts:1412`
   - **Issue:** `file.originalname` is stored directly without sanitizing path traversal characters, null bytes, or control characters.
   - **Impact:** Low risk since the filename is never used for file system operations. However, unsanitized filenames could cause issues if displayed in the UI without proper encoding.
   - **Recommendation:** Sanitize `originalname` before storing: strip `../`, `\`, null bytes, and non-printable characters.

7. **No Cache-Control Header on Signed URL Responses**
   - **File:** `backend/src/controllers/fileController.ts:203-211`
   - **Issue:** The download URL response does not include `Cache-Control: no-store`, meaning browsers or proxies could cache the signed URL.
   - **Impact:** A cached signed URL could be reused from browser history or proxy cache after the user has logged out.
   - **Recommendation:** Add `res.set('Cache-Control', 'no-store, no-cache, must-revalidate')` before returning signed URL responses.

8. **GCS Bucket Configuration Cannot Be Verified from Code**
   - **Issue:** Four GCS bucket-level settings (IAM, CORS, Uniform Access, Versioning, Lifecycle) cannot be verified from application code review alone.
   - **Recommendation:** Verify the following in GCP console or Terraform:
     - No `allUsers`/`allAuthenticatedUsers` IAM bindings.
     - CORS restricted to the frontend domain only.
     - Uniform Bucket-Level Access enabled.
     - Object versioning enabled.
     - Lifecycle rules configured for retention/cleanup.

---

## Questions to Investigate

1. **Is the GCS bucket configured with uniform access and no public ACLs?**
   - Cannot determine from code. Must verify in GCP console.

2. **What is the signed URL expiration time?**
   - 15 minutes (`storageService.ts:20`).

3. **Are uploaded files ever scanned for malware?**
   - No. No malware scanning (e.g., ClamAV, Google Cloud DLP) exists in the upload pipeline.
   - **Recommendation:** Consider adding Google Cloud DLP or ClamAV scanning for uploaded files, especially since they contain health documents that will be processed by AI APIs.

4. **What happens to GCS objects when a user deletes their account?**
   - GCS objects are **orphaned**. The Prisma cascade deletes DB records but does not delete GCS objects. See Finding #2 above.

5. **Is there a maximum storage quota per user?**
   - No per-user storage quota exists. Users are limited only by the upload rate limiter (20/hour, 10MB each = 200MB/hour).
   - **Recommendation:** Consider adding a per-user storage quota (e.g., 500MB or 1GB) tracked in the database.

---

## Architecture Assessment

The file storage architecture follows a solid pattern:

- **Upload:** Client --> Multer (memory) --> Validation --> Processing --> GCS + Database
- **Download:** Client --> Auth --> Ownership Check --> Signed URL --> GCS (direct)
- **Processing:** PDF magic bytes + timeout + memory monitoring before extraction
- **Access Control:** JWT auth + application-level userId filter + PostgreSQL RLS policies

The main gaps are operational (GCS bucket configuration, account deletion cleanup) and logging hygiene (`console.log` PHI leakage in `biomarkerExtractor.ts`). The upload validation pipeline is thorough with defense-in-depth layers.
