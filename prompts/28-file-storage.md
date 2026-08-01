---
tags:
  - security
  - infrastructure
  - medium
type: prompt
priority: 3
updated: 2026-08-01
---

# File Storage & Document Processing Security Review

> **Posture note (2026-08-01):** storage is no longer GCS-only. `storageService.ts` is a façade that
> selects one of two backends at boot (OF-23), and under the current **sandbox, no-GCP** posture the
> **local encrypted-disk backend is the one actually running**. Section 2 (backend dispatch) and
> Section 2b (local backend) are the live surface; Section 2c (GCS) is **Dormant (launch checklist)**
> — review it, but grade it per `_review-protocol.md` §Current posture. Read
> `New Project Documents/OPEN_FINDINGS.md` first.

## Files to Review
- `backend/src/services/storageService.ts` (**backend-selecting façade**, OF-23 — delegates to GCS or local disk; download is a backend stream proxy, NOT signed URLs)
- `backend/src/services/storage/types.ts` (the `StorageBackend` contract both backends must satisfy — the semantics live here)
- `backend/src/services/storage/gcsBackend.ts` (Google Cloud Storage implementation — dormant under the sandbox posture)
- `backend/src/services/storage/localBackend.ts` (AES-256-GCM-encrypted local disk — the development default)
- `backend/src/services/storage/keys.ts` (`buildStorageKey` / `isValidStorageKey` — the shared key grammar both backends validate against)
- `backend/src/config/index.ts` (`config.storage.backend` / `config.storage.localDir`; the `STORAGE_BACKEND` validation and the production/staging refusal at `config/index.ts:338-352`)
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
- `backend/src/middleware/planGating.ts` (`requirePlanLimit('pdfUploadsPerMonth')` on all upload routes; plus `requirePlanLimit('maxBiomarkers')` now stacked on the lab-report and lab-results-OCR routes — M12, `uploadRoutes.ts:88,139`)
- `backend/src/middleware/aiSpendGuard.ts` (dollar-based daily AI spend circuit breaker — reserves ~$0.05 per AI-backed upload, fails closed 503; mounted on all three upload routes — `uploadRoutes.ts:82,104,135`)
- `backend/src/utils/securePdfParsing.ts` (PDF-bomb DoS guard: header check, 30s timeout, 100MB heap-growth guard, **`MAX_PDF_PAGES = 50` page cap via `PdfPageLimitError`** — L28, `securePdfParsing.ts:27,35,219-226`)
- `backend/src/utils/phiRedaction.ts` (text scrubber applied before/after AI calls — `redactPHI` / `stripPHIFromText`; the old `pdfRedaction.ts` / `redactPatientBanner` banner-cover file has been DELETED, no longer referenced anywhere)
- `backend/src/services/fhir/labSyncService.ts` (FHIR lab-result ingestion — alternative non-file lab data path)
- `backend/prisma/schema.prisma` (UserFile model)
- `src/components/upload/` (frontend upload components: `ClinicalFileUpload`, `ExtractionReviewStep`, `LabUploadModal`, `PDFUploadModal`)
- `src/utils/biomarkers/labReportParser.ts` (client-side parsing)
- `src/utils/documents/fileProcessing.ts` (client-side validation)

## OwnMyHealth File Storage Architecture
- **Storage backend is pluggable (OF-23)**: `config.storage.backend` selects `'gcs'` or `'local'`.
  Callers (controllers, upload handlers, bulk-deletion paths) import from `storageService.ts` only
  and stay backend-agnostic. Selection is resolved **lazily on first use, not at module load**, so
  test files that partially mock `config` (without `storage`) fall through to GCS — the pre-OF-23
  behavior those mocks were written against (`storageService.ts:28-44`).
  - `'gcs'` → `storage/gcsBackend.ts` — deployed environments. **Currently suspended** (billing disabled).
  - `'local'` → `storage/localBackend.ts` — AES-256-GCM-encrypted local disk under
    `config.storage.localDir` (default `backend/.local-storage`, override `LOCAL_STORAGE_DIR`).
    **The development default**, so the GCP-less sandbox can exercise upload/download/delete.
- **Object key (both backends)**: `{userId}/{fileId}.{ext}`, built by `buildStorageKey` and
  validated by `isValidStorageKey` (`storage/keys.ts`)
- **Local at-rest envelope**: `[ magic 'OMHL' | version 0x01 | iv(16) | authTag(16) | ciphertext ]`,
  sealed with the **master** `PHI_ENCRYPTION_KEY` — deliberately *not* a per-user PBKDF2 key,
  because `getFileStream(storageKey)` has no user context and a 600k-iteration derivation per file
  op would be pure overhead for an at-rest guarantee (`localBackend.ts:8-23,38-42`)
- **Upload Flow**: Client → Backend (Multer memory storage, 10MB, single file) → magic-byte + PDF-header validation → `storageService.uploadFile` → active backend
- **Download**: Backend stream proxy via `getFileStream` (GET `/files/:id/download`). Signed `read` URLs were REMOVED — the 15-min unbound link was a capture-replay PHI egress vector. Every download now passes authenticate + RLS + ownership, with `Cache-Control: no-store` and a sanitized `Content-Disposition`.
- **Processing**: local pdf-parse text extraction (`pdfTextExtraction`) → PHI redaction → Claude extraction; OCR (Google Document AI) for scanned/image labs; regex `pdfParser` fallback for SBC
- **Minimum-necessary AI**: text path redacts PHI before Anthropic (`redactPHI`); no Claude Vision path exists — scanned PDFs are rejected to OCR. (The old image-banner redactor `pdfRedaction.redactPatientBanner` has been DELETED along with its host file; only the text-only `redactPHI` / `stripPHIFromText` path in `phiRedaction.ts` remains — `claudeExtraction.ts:14` imports only those two.)
- **Client-Side**: Tesseract.js OCR, pdf.js text extraction (fallback)
- **File Types**: Lab reports (PDF + OCR images PNG/JPEG/TIFF/GIF/WebP), insurance SBC (PDF), clinical documents
- **Alt lab path**: FHIR lab-sync (`fhir/labSyncService`) pulls Observations directly — no file upload, but still creates encrypted biomarkers

## Checklist

### 1. Upload Validation
- [ ] MIME type validated by multer `fileFilter` (rejects non-allowed Content-Type early)
- [ ] Magic bytes verified against declared MIME in `controllers/upload/shared.ts` (`validateMagicBytes` / `MAGIC_BYTES`) — header is attacker-controlled, content is not. L30 deepened WebP: the RIFF 4-byte prefix is shared with AVI/WAV/ANI, so `validateMagicBytes` additionally requires the ASCII `WEBP` form-type at bytes 8-11 (`shared.ts:96-102`)
- [ ] PDF header + version checked via `validatePdfHeader` (`utils/securePdfParsing.ts`) on every PDF path (lab + OCR)
- [ ] Allowed types explicitly whitelisted (`SUPPORTED_MIME_TYPES`: PDF-only for lab/SBC; PDF + PNG/JPEG/TIFF/GIF/WebP for OCR)
- [ ] File size limits enforced (10MB max — multer `limits.fileSize` AND `validateUploadFile`); single file only (`limits.files: 1`)
- [ ] Filename sanitized (`sanitizeFilename`: basename only, strips control + path-sep + quote chars, caps 255 bytes); mutates `file.originalname` so all downstream consumers get the safe form
- [ ] Raw client filename encrypted at rest (L24): all three upload create-sites write `originalFilename: null` + `originalFilenameEncrypted: encrypt(file.originalname)` (`labUploadController.ts:110-111,274-275`; `sbcUploadController.ts:125-126`). The plaintext `originalFilename` column is now nullable and kept only for not-yet-backfilled legacy rows; never used for the storage key
- [ ] Storage key uses server `crypto.randomUUID()` fileId, not user-controlled names
- [ ] Upload rejected before processing if validation fails (`validateUploadFile` throws `ValidationError`)

### 2. Storage Backend Dispatch (OF-23)
- [ ] Every caller goes through `storageService.ts`, never a backend module directly — `Grep` for
      `gcsBackend`/`localBackend` imports outside `storageService.ts` and `storage/` (expect zero)
- [ ] `config.storage.backend` accepts **only** `'gcs'` or `'local'`; anything else hard-fails at
      boot in every environment (`config/index.ts:343`)
- [ ] `STORAGE_BACKEND=local` is **refused in production and staging** (`config/index.ts:349`) —
      Cloud Run disks are ephemeral and must never hold PHI files. Confirm the check covers staging,
      not just production
- [ ] Backend selection is logged exactly once at first use, and the log line carries no secret
      (bucket name / dir path only — `storageService.ts:33-42`)
- [ ] Lazy resolution is intentional and documented: an absent `config.storage` in a partially-mocked
      test selects GCS rather than throwing (`storageService.ts:28-32`). Verify no runtime path can
      reach that fallback with real config
- [ ] Both backends satisfy the same `StorageBackend` contract (`storage/types.ts`) — in particular
      the **error semantics** consumers rely on: delete is idempotent (missing object ⇒ resolve, not
      throw), and `getFileStream` surfaces every failure as a **stream error** rather than a throw
- [ ] Key grammar is shared and enforced on the read path: `isValidStorageKey` is applied to keys
      that arrive from **DB rows**, not just to app-built keys (`storage/keys.ts`, `localBackend.ts:65-74`)

### 2b. Local Disk Backend (the live backend under the sandbox posture)
- [ ] Every blob is AES-256-GCM sealed **before** it touches disk — no code path writes a plaintext
      buffer (`localBackend.ts:86-103`). A bare `writeFile` here would scatter plaintext PHI across
      the dev machine: the same residue class OF-03 tracked in prod
- [ ] Envelope is versioned and magic-checked on read (`'OMHL'` + `0x01`); an unrecognized or
      truncated header errors the stream instead of returning bytes (`localBackend.ts:129-144`)
- [ ] The GCM **auth tag is set before decryption** and a tampered blob fails the tag check
      (`localBackend.ts:146-149`). Note the accepted trade-off: because plaintext streams out as it
      decrypts, tampering is detected **at the end** of the stream, not up front — confirm that is
      still acceptable for an owner-only proxy download, and that a failed tag destroys the stream
      rather than silently truncating
- [ ] Master-key handling: `PHI_ENCRYPTION_KEY` is resolved **per operation** and validated via
      `validateEncryptionKey`, so a sandbox without the key still boots and only storage calls fail
      with a pointed message (`localBackend.ts:44-55`). Verify the error message does not echo the key
- [ ] **Path containment**: `resolvePath` validates key shape *and* asserts the resolved absolute
      path starts with `rootDir + path.sep` — a corrupted or hostile DB key cannot escape the root
      (`localBackend.ts:65-74`). Verify the check uses the resolved path, not the raw string, and that
      `rootDir` itself is resolved
- [ ] Writes are **tmp + rename** with a random suffix and `flag: 'wx'`, so a crash mid-write cannot
      leave a torn blob at the real key, and a concurrent writer cannot clobber the temp
      (`localBackend.ts:97-103`)
- [ ] File mode is `0o600` (owner-only) on every written blob (`localBackend.ts:101`)
- [ ] Orphaned `.tmp-*` files: confirm what cleans them up after a crash between write and rename,
      and whether they inherit the same `0600` mode (they do carry ciphertext)
- [ ] Delete tolerates a malformed key by treating it as already-deleted (log + return), matching GCS
      404 semantics so bulk account deletion (C-6) stays idempotent instead of aborting on an
      unresolvable pointer (`localBackend.ts:165-178`)
- [ ] The storage root is **git-ignored** and outside any served static directory — `Grep`
      `.gitignore` for `.local-storage`, and confirm no Express `static` mount can reach it
- [ ] Account deletion and `deleteAllData` remove local blobs on this backend too, not just GCS
      objects — the hard-abort semantics in `fileController` must hold for both

### 2c. Google Cloud Storage Security — **Dormant (launch checklist)**
> Under the 2026-07-14 sandbox posture the bucket, project, and service account are suspended
> (billing disabled ~2026-07-12). Grade every item below as **Dormant** with a reactivation severity
> and trigger — not as a live finding. See `_review-protocol.md` §Current posture.
- [ ] GCS bucket is private (no public access)
- [ ] Bucket-level IAM restricts access to service account only
- [ ] No wildcard CORS on bucket
- [ ] Uniform bucket-level access (no per-object ACLs)
- [ ] `GCS_BUCKET_NAME` from environment variable
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` secured (not in code) — **cross-check OF-01**: a real
      `ocr-service@` private key is still reachable in git history (`202f2dd`) and is a hard gate on
      ever re-enabling billing. Do not re-report it as new; cite the ledger
- [ ] Bucket versioning enabled (recovery from overwrites)
- [ ] Lifecycle rules for old file cleanup (if applicable)
- [ ] At reactivation: confirm any files written by the **local** backend during the sandbox period
      are either migrated (decrypt → re-upload) or deliberately abandoned — the two backends share a
      key grammar but not a store, so `storageKey` rows written under `local` will 404 against GCS

### 3. Download Egress Security (backend stream proxy, NOT signed URLs)
> Signed `read` URLs were REMOVED (see `storageService.getFileStream` and `fileController.getFileDownloadUrl` comments): a 15-min unbound link was a capture-replay PHI vector. Verify the proxy replaced them fully — `getSignedUrl(...'read')` must not reappear.
- [ ] Download bytes proxied through the backend (`storageService.getFileStream` → `stream.pipe(res)`), never a direct GCS link — and the proxy is the single egress path **for both storage backends**, so switching `STORAGE_BACKEND` cannot introduce a second one
- [ ] Every download passes `authenticate` + RLS + ownership (`findFirst({ id, userId })`) before any byte is read
- [ ] `Cache-Control: no-store, no-cache, private` + `Pragma: no-cache` + `X-Content-Type-Options: nosniff` set so caches/intermediaries can't retain PHI
- [ ] `Content-Disposition` filename sanitized (strip `"`, CR, LF, `\`) to prevent header injection
- [ ] Export audit logged BEFORE streaming (`logExport` with `FILE_DOWNLOAD`) so an aborted transfer is still recorded as a disclosure
- [ ] `getFile` (metadata) no longer mints a `downloadUrl` — single egress path is `/files/:id/download`
- [ ] Stream errors handled (502 if headers not yet sent; close otherwise) without leaking storage internals

### 4. File Processing Security
- [ ] PDF parsing routed through `secureParsePdf` (`securePdfParsing.ts`) — both the primary `pdfTextExtraction` path AND the regex `pdfParser` fallback (no raw `pdfParse(buffer)` call bypassing it)
- [ ] PDF-bomb DoS guards present: header/version validation, 30s parse timeout (`PDF_PARSE_TIMEOUT_MS`), 100MB heap-growth cap (`MAX_MEMORY_INCREASE_BYTES`), suspicious compression-ratio logging, and a 50-page hard cap (L28: `MAX_PDF_PAGES = 50` → `PdfPageLimitError`, `securePdfParsing.ts:27,35,219-226`)
- [ ] Multer uses memory storage (no temp files on disk)
- [ ] File buffers cleared after processing
- [ ] PDF content not logged (may contain PHI) — only sizes, page counts, timings
- [ ] PHI redacted before AI on the text path: `extractTextFromPDF` → `redactPHI` (also `stripPHIFromText` on the Claude response) in `claudeExtraction.ts`. There is no image/Vision fallback — claudeExtraction/sbcExtraction reject scanned PDFs to OCR. (The old `pdfRedaction.redactPatientBanner` banner-cover redactor and its host file have been DELETED — there is no longer any unwired image-redaction code to verify.)
- [ ] AI/BAA gating still enforced: Claude text calls are gated by `ANTHROPIC_BAA_ACTIVE` (hard throw in `extractBiomarkersWithClaude`); OCR by `GOOGLE_BAA_ACTIVE`
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
- [ ] `storageKey` is a backend-agnostic pointer (`{userId}/{fileId}.{ext}`) — it maps to a GCS object path *or* a path under `localDir`, and never exposes a public URL. Note the key does **not** record which backend wrote it: a row written under `local` and read under `gcs` (or vice versa) resolves to nothing. Confirm whether that is handled or accepted
- [ ] File metadata fields: `filename` (server-generated, plaintext, non-PHI), `originalFilenameEncrypted` (AES-256-GCM PHI column — the live home of the raw filename, L24, `schema.prisma:164`), nullable plaintext `originalFilename` (legacy-only, `schema.prisma:163`), `fileType`, `fileSize`, `createdAt`
- [ ] Lab-specific metadata: `labName`, `labDate`, `biomarkersExtracted`, `extractionConfidence` — `labName`/`labDate` are still PLAINTEXT (not `*Encrypted` columns); confirm that's acceptable (lab name/date are arguably PHI). Note the filename itself is NO LONGER an unencrypted gap — it moved to `originalFilenameEncrypted`
- [ ] `userId` FK to User with `onDelete: Cascade`; `user_files` covered by RLS policy (`user_id = current_user_id()`)
- [ ] On file delete (F-22): GCS object deleted FIRST — any non-404 GCS failure now aborts the DB deletion (re-throws) to avoid orphaning PHI, so the DB delete no longer proceeds after a storage failure (`fileController.ts:340-349`, logs "aborting DB deletion to avoid orphaned PHI"). On success, linked biomarkers are UNLINKED (`userFileId = null`, NOT deleted), then the DB record is removed. Upload paths also wrap GCS writes in `withGcsOrphanCleanup()` to delete the object if the DB tx rolls back (`shared.ts:974`)

### 7. Access Control
- [ ] Users can only list/download/delete their own files
- [ ] File ownership verified on every operation
- [ ] Provider access to patient files follows consent permissions
- [ ] Admin file access audit logged
- [ ] No file enumeration possible (UUIDs, not sequential IDs)

### 8. Rate Limiting, Plan Gating & AI-Cost Control
- [ ] `uploadLimiter` (20/hour) applied via `router.use` to ALL upload routes
- [ ] `aiLimiter` (10/hour, keyed by user ID) stacked on lab-report, SBC, and OCR handlers (Claude/Document AI cost protection)
- [ ] `aiSpendGuard` (dollar-based daily spend circuit breaker — reserves ~$0.05, fails closed 503) mounted on ALL three upload routes — lab-report, insurance-SBC, lab-results-OCR (`uploadRoutes.ts:82,104,135`)
- [ ] `sensitiveLimiter` (10/hour) on the download endpoint (`GET /files/:id/download`)
- [ ] `requirePlanLimit('pdfUploadsPerMonth')` (planGating) gates each upload to the user's billing tier; the lab-report and lab-results-OCR routes ALSO carry `requirePlanLimit('maxBiomarkers')` (M12, `uploadRoutes.ts:88,139`), and the OCR insert path truncates over-cap uploads in `createBiomarkersFromOCRResult` (`shared.ts:85-87`)
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
# Storage backend dispatch — every caller must go through storageService, not a backend module
grep -rn "storage/gcsBackend\|storage/localBackend" backend/src/   # expect: only storageService.ts + storage/

# Backend selection + the production/staging refusal
grep -rn "STORAGE_BACKEND\|storage.backend\|localDir\|LOCAL_STORAGE_DIR" backend/src/config/index.ts

# Local-backend at-rest crypto + path containment (the live backend under the sandbox posture)
grep -rn "createCipheriv\|createDecipheriv\|setAuthTag\|path.resolve\|isValidStorageKey\|0o600\|wx" backend/src/services/storage/

# Confirm the local storage root can't be committed or served
grep -rn "local-storage" .gitignore backend/.gitignore 2>/dev/null

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
# redactPatientBanner/pdfRedaction.ts are DELETED — both patterns should return ZERO hits)
grep -rn "redactPHI\|stripPHIFromText" backend/src/services/ backend/src/utils/
grep -rn "redactPatientBanner\|pdfRedaction" backend/src/   # expect: no matches

# Check for temp file creation
grep -rn "writeFile\|createWriteStream\|tmpdir\|os.tmpdir" backend/src/

# Verify file access control (RLS + userId scope)
grep -rn "withRLSTransaction\|findFirst" backend/src/controllers/fileController.ts
```

## Questions to Ask
0. **Which backend is actually running?** Read `config.storage.backend` for the environment under
   review before grading anything in §2c. Under the sandbox posture the answer is `local`, and GCS
   findings are dormant.
0a. The local backend seals blobs with the **master** `PHI_ENCRYPTION_KEY` rather than a per-user
   derived key, so one key compromise exposes every user's files at rest — versus the per-user
   PBKDF2 model used for column PHI. The stated reason is that `getFileStream(storageKey)` has no
   user context (`localBackend.ts:15-19`). Is that still the accepted trade-off, and does it need a
   re-evaluation trigger recorded in `OPEN_FINDINGS.md` if the sandbox ever holds non-founder PHI?
0b. GCM tag verification happens at the **end** of the stream, so a tampered blob delivers bytes to
   the client before failing. Acceptable for owner-only downloads — but does the consumer
   (`fileController`) actually abort the response, or can a truncated file reach the user looking
   like a successful download?
0c. What is the migration story if the project ever returns to GCS? `storageKey` rows carry no
   backend discriminator (see §6).
1. Is the GCS bucket configured with uniform access and no public ACLs? *(dormant)*
2. With signed read URLs removed, does any code path still hand a GCS link to the client, or is `getFileStream` truly the only egress?
3. Are uploaded files ever scanned for malware before GCS persistence?
4. What happens to GCS objects when a user deletes their account? (cross-check `settingsController.deleteAccount` / `deleteAllData` + `storageService.deleteFiles` hard-abort semantics)
5. Is there a maximum storage quota per user beyond `pdfUploadsPerMonth` plan gating?
6. `labName`/`labDate` on `UserFile` are still stored UNencrypted — is that an accepted PHI exception or a gap? (Note: the raw filename is no longer a gap — L24 moved it to the encrypted `originalFilenameEncrypted` column; the question is now scoped to `labName`/`labDate` only.)
7. The text-only AI extraction path is gated by a hard `ANTHROPIC_BAA_ACTIVE` check in `extractBiomarkersWithClaude` and redacts via `redactPHI`/`stripPHIFromText`. Is the absence of any image/Vision fallback (scanned PDFs forced to OCR) still the intended minimum-necessary posture? (The former `pdfRedaction.redactPatientBanner` image redactor has been deleted, so there is no dead image-redaction code left to wire or remove.)
8. FHIR lab-sync (`fhir/labSyncService`) ingests biomarkers with no UserFile — does that path get the same encryption + audit coverage as uploads? (it should: encrypts values, logs to `LabConnection` audit)
