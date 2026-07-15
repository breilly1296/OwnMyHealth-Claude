# File Storage & Document Processing Security Review — 2026-06-16

Scope: GCS storage, upload validation, download egress, PDF/OCR/Claude processing, file metadata/DB, access control, rate-limit/plan/AI-cost gating, audit logging. Reviewed against checklist `prompts/28-file-storage.md` at HEAD `fb2cd32`. All findings cite `file:line` against the live code. No code was modified.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 4 |

Overall the file-storage surface is in good shape: the signed-read-URL egress vector is gone, downloads are an authenticated/RLS-scoped no-store stream proxy, the PDF-bomb guard (header + 30s timeout + 100MB heap cap + 50-page cap) is wired on every PDF path, the raw client filename is encrypted at rest (L24), and the delete/upload paths enforce the GCS-orphan invariants in both directions. The residual findings are unencrypted lab/insurer metadata (the prompt's open Question 6), internal-path disclosure to the client, no malware scanning, and no aggregate storage quota.

## Findings

### F-1 — `UserFile.labName` / `labDate` stored as plaintext PHI — **Medium**
- **Location:** `backend/prisma/schema.prisma:168-169`; written plaintext at `backend/src/controllers/upload/labUploadController.ts:115-116,279-280` and `backend/src/controllers/upload/sbcUploadController.ts:130-131`.
- **Observation:** `labName` (`@db.VarChar(255)`) and `labDate` (`@db.Date`) are plaintext columns, not `*Encrypted`. On the SBC path `labName` is populated with the extracted `insurerName` (`sbcUploadController.ts:130` — `labName: insurerName`), and on the lab path with the extracted/parsed lab name. `labDate` is the collection/effective date. Both are returned in cleartext to the client (`fileController.ts:93-94,176-177`) and one (`labName`) is also written into audit metadata (`labUploadController.ts:152`). Under HIPAA §164.514(b)(2)(i)(C), a service date plus the name of the testing lab/insurer is re-identifying context, so this is PHI-adjacent at rest while the rest of `UserFile`'s sensitive field (the filename) is now encrypted (L24).
- **Impact:** A read of the `user_files` table at rest (DB snapshot, backup, or a future RLS gap) discloses which lab/insurer a patient used and on what date — a meaningful re-identifier — without needing the per-user key. This is the lone remaining plaintext-PHI gap in the file model after the L24 filename fix.
- **Fix:** Either (a) add `labNameEncrypted` / `labDateEncrypted` columns, register them in `PHI_FIELDS` (`encryption.ts:476-562`), and encrypt at the three write sites + decrypt at the read sites (mirror the L24 `decryptOriginalFilename` helper); or (b) formally accept the exception and record it in `PHI_TAXONOMY.md`. Note `labDate` is also an `orderBy` key (`fileController.ts:67`), so encrypting it would require sorting on a separate non-PHI timestamp (e.g. `createdAt`) — call that out in the decision.
- **Evidence:**
  ```prisma
  labName              String?     @map("lab_name") @db.VarChar(255)
  labDate              DateTime?   @map("lab_date") @db.Date
  ```
  ```ts
  // sbcUploadController.ts:130
  labName: insurerName,
  ```

### F-2 — Internal GCS object path (`storageKey`) returned to the client — **Medium**
- **Location:** `backend/src/controllers/fileController.ts:92,175` (and the response interface at `:33`).
- **Observation:** Both `getFiles` (list) and `getFile` (single) include `storageKey` in the JSON returned to the browser. `storageKey` is the raw GCS object path `{userId}/{fileId}.{ext}` (built in `storageService.uploadFile`, `storageService.ts:58`), which leaks the bucket key layout and embeds the owner's user UUID in the key prefix.
- **Impact:** Information disclosure. The value is not directly actionable today — the bucket is private and downloads go through the authenticated proxy (`getFileDownloadUrl`), not the key — but exposing the internal storage-key scheme and the user-id-prefixed path is unnecessary client surface that aids an attacker mapping the storage model, and it has no client use (the frontend downloads via `/files/:id/download`, never via the key). It also undercuts the "never exposes a public URL / storage key" intent in checklist §6.
- **Impact bound:** Medium (auth + RLS-gated; no current direct exploit), ranked above the Lows because it directly contradicts a §6 checklist item and ships PHI-prefixed internal identifiers to every client.
- **Fix:** Drop `storageKey` from `UserFileResponse` (`fileController.ts:26-39`) and stop selecting/mapping it at `:92` and `:175`. The download flow and delete flow read `storageKey` server-side from the DB row, so the client never needs it.
- **Evidence:**
  ```ts
  // fileController.ts:92
  storageKey: file.storageKey,
  ```
  ```ts
  // storageService.ts:58
  const storageKey = `${userId}/${fileId}.${extension}`;
  ```

### F-3 — Uploaded files are persisted to GCS without malware/AV scanning — **Medium**
- **Location:** `backend/src/services/storageService.ts:51-92` (`uploadFile`); upload sites `labUploadController.ts:74,243`, `sbcUploadController.ts:93`.
- **Observation:** The upload pipeline validates MIME, magic bytes, PDF header/version, size, and page count, then writes the raw buffer straight to the private bucket. There is no content/malware scan (e.g. ClamAV, GCS+Cloud Functions AV, or a third-party scanner) before persistence. Magic-byte validation confirms the *format* but not that the bytes are benign — a malformed/weaponized PDF or image that passes the header check is stored as-is and later re-served to the owner via the download proxy.
- **Impact:** A user can store malware in the bucket (limited blast radius: files are private, per-user, and re-served only to the same owner with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`, so the app itself does not execute or inline-render them). The realistic risk is (a) the bucket becoming a malware repository and (b) a malicious file harming the owner's own endpoint on re-download. This is a defense-in-depth gap, not an active app-compromise path, hence Medium-low.
- **Fix:** Add an async malware scan between upload and "available" — e.g. quarantine-on-upload then scan via a GCS-triggered Cloud Function, or a synchronous ClamAV sidecar for the (small, 10MB-capped) buffers before `file.save`. At minimum, document the accepted risk in `SECURITY_STATUS.md` and the answer to checklist Question 3 ("Are uploaded files ever scanned for malware?").
- **Evidence:**
  ```ts
  // storageService.ts:64 — buffer written directly, no scan
  await file.save(buffer, { contentType: mimeType, metadata: {...} });
  ```

### F-4 — No aggregate per-user storage quota (byte ceiling) — **Low**
- **Location:** `backend/src/routes/uploadRoutes.ts:84,106,137` (`requirePlanLimit('pdfUploadsPerMonth')`); no byte-sum check anywhere in the upload path.
- **Observation:** Abuse is bounded by upload *count* (plan `pdfUploadsPerMonth` + `uploadLimiter` 20/hr) and per-file size (10MB), but there is no cap on total bytes stored per user. A user on a high/unlimited tier can accumulate unbounded GCS storage one 10MB file at a time within their monthly count.
- **Impact:** Storage-cost abuse / slow resource exhaustion. Low because the monthly count + 10MB cap already bound the rate, and unlimited tiers are presumably paying customers.
- **Fix:** Track summed `UserFile.fileSize` per user and gate uploads on a tier storage quota (add a `maxStorageBytes` plan limit consumed by `requirePlanLimit` / a dedicated check), or rely on a GCS lifecycle/retention rule. Cross-reference checklist Question 5.
- **Evidence:**
  ```ts
  // uploadRoutes.ts:84 — count-based gate only; no byte-sum quota
  requirePlanLimit('pdfUploadsPerMonth'),
  ```

### F-5 — `Content-Length` is set from the DB `fileSize`, not the actual GCS object size — **Low**
- **Location:** `backend/src/controllers/fileController.ts:276-278`.
- **Observation:** The download sets `Content-Length` to the `UserFile.fileSize` recorded at upload time, then pipes the live GCS stream. If the stored size ever drifts from the object's true byte length (a re-uploaded/overwritten object, a partial upload, a future migration), the declared `Content-Length` will mismatch the streamed bytes — causing a truncated download or a hung connection at the client.
- **Impact:** Availability/robustness only (no confidentiality impact). Low.
- **Fix:** Either omit `Content-Length` and let chunked transfer encoding handle it, or fetch the object's size from GCS metadata (`file.getMetadata()`) immediately before streaming and use that. The stream-error handler (`:281-300`) already covers read failures; this closes the size-mismatch edge.
- **Evidence:**
  ```ts
  // fileController.ts:276
  if (file.fileSize) {
    res.set('Content-Length', String(file.fileSize));
  }
  ```

### F-6 — OCR multer `fileFilter` rejection message omits GIF/WebP — **Low**
- **Location:** `backend/src/routes/uploadRoutes.ts:66`.
- **Observation:** The OCR uploader accepts `image/gif` and `image/webp` (`:55-62`) but the rejection message reads `'Only PDF and image files (PNG, JPG, TIFF) are accepted'`. The shared validator's message (`shared.ts:144-147`) is similarly truncated. Cosmetic/UX accuracy only — the allowlist itself is correct.
- **Impact:** None to security; a user uploading an unsupported type gets a slightly misleading list. Low/hygiene.
- **Fix:** Align the message text with the actual allowlist (PNG, JPG, TIFF, GIF, WebP) at `uploadRoutes.ts:66` and `shared.ts:144-147`.
- **Evidence:**
  ```ts
  // uploadRoutes.ts:66
  cb(new BadRequestError('Only PDF and image files (PNG, JPG, TIFF) are accepted'));
  ```

### F-7 — `getFiles` pagination comment references stale "signed URL per file" model — **Low** (Prompt/code-drift, doc-only)
- **Location:** `backend/src/controllers/fileController.ts:52-53`, plus the file-level header `:5` ("stored in Google Cloud Storage with signed URL access") and the route-doc `fileRoutes.ts:8-9` ("Get a signed download URL for a file").
- **Observation:** Comments still describe the removed signed-URL egress model ("a fresh signed URL pass for each one", "signed URL access", "signed download URL"). The code no longer mints signed URLs anywhere (verified: no `getSignedUrl`/`action: 'read'` hits in `backend/src` except the explanatory deletion comments). These stale comments could mislead a future maintainer into re-introducing the removed vector.
- **Impact:** No runtime impact; documentation drift around a security-relevant control. Low.
- **Fix:** Update the three comment sites to describe the stream-proxy egress model.
- **Evidence:**
  ```ts
  // fileController.ts:5
  * Files are stored in Google Cloud Storage with signed URL access.
  ```

## Checks passed

### 1. Upload Validation
- [x] MIME validated by multer `fileFilter` early — PDF-only for lab/SBC (`uploadRoutes.ts:36-44`), PDF+images for OCR (`uploadRoutes.ts:53-69`).
- [x] Magic bytes verified against declared MIME — `validateMagicBytes` (`shared.ts:87-106`), called from `validateUploadFile` (`shared.ts:157`); WebP additionally requires the ASCII `WEBP` form-type at bytes 8-11 (L30, `shared.ts:100-105`).
- [x] PDF header + version checked on every PDF path — `validatePdfHeader` (`securePdfParsing.ts:70-119`) invoked in `uploadLabReport` (`labUploadController.ts:45`), `uploadLabResultOCR` PDF branch (`labUploadController.ts:207-209`), `uploadSBC` (`sbcUploadController.ts:57`), and `reanalyzePlan` (`sbcUploadController.ts:253`).
- [x] Allowed types whitelisted — `SUPPORTED_MIME_TYPES` (`shared.ts:59-62`) and the multer allowlists (`uploadRoutes.ts:38,55-62`).
- [x] File size limits enforced — multer `limits.fileSize: 10MB` + `files: 1` (`uploadRoutes.ts:32-35,48-51`) AND `validateUploadFile` size check (`shared.ts:150-153`); OCR service re-checks `MAX_FILE_SIZE` (`ocrService.ts:131-136`).
- [x] Filename sanitized — `sanitizeFilename` (basename, strips control/path-sep/quote chars, caps 255) mutates `file.originalname` (`shared.ts:121-127,163`).
- [x] Raw client filename encrypted at rest (L24) — all three create sites write `originalFilename: null` + `originalFilenameEncrypted: encrypt(file.originalname, userSalt)` (`labUploadController.ts:110-111,274-275`; `sbcUploadController.ts:125-126`); read path decrypts via `decryptOriginalFilename` (`userFileNames.ts:13-26`, used at `fileController.ts:89,172,258`).
- [x] Storage key uses server `crypto.randomUUID()` fileId — `labUploadController.ts:71,240`; `sbcUploadController.ts:90`; key built server-side from userId+UUID (`storageService.ts:58`).
- [x] Upload rejected before processing on validation failure — `validateUploadFile` throws `ValidationError` (`shared.ts:138-148`) before `processDocument`/`extractSBCData`.

### 2. Google Cloud Storage Security
- [x] `GCS_BUCKET_NAME` from env via `config` — `storageService.ts:25` reads `config.gcp.bucketName` (`config/index.ts:228`), with a production hard-fail if unset (`config/index.ts:480-486`).
- [x] `GOOGLE_APPLICATION_CREDENTIALS` not in code — read from env in `ocrService.ts:91-107` and `config/index.ts:231`; storage client uses ADC (`storageService.ts:16-18`).

### 3. Download Egress Security (stream proxy)
- [x] No signed `read` URLs anywhere — Grep for `getSignedUrl` / `action: 'read'` in `backend/src` returns only the explanatory deletion comments (`storageService.ts:97`, `fileController.ts:132`); no live mint site.
- [x] Bytes proxied through backend — `getFileStream` → `stream.pipe(res)` (`storageService.ts:108-112`, `fileController.ts:280-301`); no GCS link handed to the client.
- [x] Every download passes authenticate + RLS + ownership — route `authenticate` (`fileRoutes.ts:42`); controller `withRLSTransaction(userId, ...)` + `findFirst({ id, userId })` (`fileController.ts:221-234`).
- [x] `Cache-Control: no-store, no-cache, private, must-revalidate` + `Pragma: no-cache` + `X-Content-Type-Options: nosniff` set (`fileController.ts:272-274`).
- [x] `Content-Disposition` filename sanitized — strips `" \r \n \\` and emits RFC 5987 `filename*` (`fileController.ts:260-271`).
- [x] Export audit logged BEFORE streaming — `logExport(..., 'FILE_DOWNLOAD', ...)` at `fileController.ts:244-250`, before `getFileStream`.
- [x] `getFile` no longer mints a `downloadUrl` — returns metadata only (`fileController.ts:138-196`); single egress is `/files/:id/download`.
- [x] Stream errors handled without leaking internals — 502 JSON if headers unsent, else `res.end()` (`fileController.ts:281-300`); the error message is generic (`'Unable to read file from storage'`).
- [x] Download endpoint rate-limited — `sensitiveLimiter` (10/hr, user-keyed) on `GET /files/:id/download` (`fileRoutes.ts:59-64`, `rateLimiter.ts:151-174`).

### 4. File Processing Security
- [x] PDF parsing routed through `secureParsePdf` on both paths — `pdfTextExtraction.ts:46` (primary Claude path) and `pdfParser.ts:892,1344` (regex SBC/lab fallback); Grep confirms no bare `pdfParse(buffer)` bypass (the only `pdfParse` import is wrapped in `secureParsePdf`, `pdfTextExtraction.ts:18,46`).
- [x] PDF-bomb DoS guards present — header/version (`securePdfParsing.ts:70-119`), 30s timeout (`PDF_PARSE_TIMEOUT_MS`, `:18,183-187`), 100MB heap cap (`MAX_MEMORY_INCREASE_BYTES`, `:21,194-204`), compression-ratio logging (`:230-242`), 50-page hard cap → `PdfPageLimitError` (`:27,219-228`), with hard-reject re-throw (not OCR degrade) at `pdfTextExtraction.ts:70-72` and `ocrService.ts:414-416`.
- [x] Multer uses memory storage (no temp files) — `multer.memoryStorage()` (`uploadRoutes.ts:31,48`); Grep for `writeFile|createWriteStream|tmpdir|os.tmpdir` in `backend/src` returns zero hits.
- [x] PDF content not logged — extractors log only sizes/page counts/timings/fired-pattern-names; raw values explicitly omitted (`pdfParser.ts:51-57,147-154,1590`; `ocrService.ts:224-229`).
- [x] PHI redacted before AI on the text path — `extractTextFromPDF` → `redactPHI` then `delimitDocumentForPrompt` before send, `stripPHIFromText` on the response (`claudeExtraction.ts:118-185`; same for SBC `sbcExtraction.ts:779-839`). No Claude Vision fallback — scanned PDFs are rejected to OCR (`claudeExtraction.ts:124-133`).
- [x] `pdfRedaction.ts` / `redactPatientBanner` fully removed — Grep across the repo finds no `backend/src` hits (only docs/prompts noting the deletion); `claudeExtraction.ts:14` imports only `redactPHI` / `stripPHIFromText`.
- [x] BAA gating enforced — Claude text calls hard-throw unless `config.anthropic.baaActive` (`claudeExtraction.ts:107-112`, `sbcExtraction.ts:768-773`); Document AI image OCR hard-throws unless `config.gcp.documentAiBaaActive` (`ocrService.ts:276-282`); prod config hard-fails if a key/processor is set without the matching BAA flag (`config/index.ts:381-411`).
- [x] Extraction errors don't expose file content — categorized generic messages in `secureParsePdf` (`securePdfParsing.ts:259-303`), `claudeExtraction.ts:246-272`, `ocrService.ts:451-484`.
- [x] Malformed PDFs handled gracefully — `BadRequestError` vs `InternalServerError` categorization (`securePdfParsing.ts:259-302`); text path degrades to "no usable text" instead of 5xx (`pdfTextExtraction.ts:73-88`).
- [x] Processing timeouts present — 30s PDF parse (`securePdfParsing.ts:18`), 60s Document AI (`ocrService.ts:300`), Anthropic client timeout handling (`claudeExtraction.ts:249-251`).

### 5. Client-Side Processing
- [x] Tesseract.js OCR runs in-browser — `createWorker('eng')` + `worker.recognize(file)` locally (`src/utils/documents/documentParser.ts:356-364`); no network send.
- [x] pdf.js text extraction is local — `pdfjsLib.getDocument({ data: arrayBuffer })` on the local buffer (`documentParser.ts:338-354`).
- [x] Client-extracted data sent to backend for validation/storage — backend re-extracts and re-validates server-side (`labUploadController.ts:53,216`; `createBiomarkersFromOCRResult`), so client output is never trusted as the system of record.
- [x] Extraction confidence surfaced — `confidence`/`extractionConfidence` carried through (`fileProcessing.ts:149,210-218`; response payloads `shared.ts:887-950`).

### 6. File Metadata & Database
- [x] `UserFile` stores metadata, not content — schema fields are metadata + `storageKey` pointer (`schema.prisma:150-180`); bytes live only in GCS.
- [x] `storageKey` maps to GCS path, never a public URL — `schema.prisma:167`; only consumed server-side for stream/delete.
- [x] Filename is no longer an unencrypted gap — `filename` is a server-generated non-PHI label (`schema.prisma:153-156`); raw name moved to `originalFilenameEncrypted` (L24).
- [x] `userId` FK with `onDelete: Cascade` + RLS — `schema.prisma:175`; RLS-scoped reads/writes throughout `fileController.ts` / upload controllers.
- [x] On delete, GCS object removed FIRST and DB delete aborted on non-404 GCS failure (F-22) — `fileController.ts:339-350` (logs "aborting DB deletion to avoid orphaned PHI"); biomarkers UNLINKED not deleted (`:362-365`).
- [x] Upload paths wrap GCS writes in `withGcsOrphanCleanup` so a rolled-back tx deletes the orphan object (M8/M25) — `shared.ts:974-996`, used at `labUploadController.ts:89,255`, `sbcUploadController.ts:108`.

### 7. Access Control
- [x] Users can only list/download/delete own files — every controller scopes by `{ id, userId }` under `withRLSTransaction` (`fileController.ts:59-75,147-156,221-234,320-325`).
- [x] Ownership verified on every operation — see above; mismatch returns 404 (indistinguishable from not-found), per `fileRoutes.ts:28-41`.
- [x] No file enumeration — `id` is a UUID (`schema.prisma:151`, `validate(schemas.uuidParam)` on routes `fileRoutes.ts:53-70`); storage key uses random UUID, not sequential IDs.

### 8. Rate Limiting, Plan Gating & AI-Cost Control
- [x] `uploadLimiter` (20/hr) on ALL upload routes via `router.use` — `uploadRoutes.ts:27` + limiter def `rateLimiter.ts:134-148`.
- [x] `aiLimiter` (10/hr, user-keyed) stacked on lab-report, SBC, OCR — `uploadRoutes.ts:81,103,134`; def `rateLimiter.ts:177-203`.
- [x] `aiSpendGuard` (dollar circuit breaker, reserve+settle, 503 fail-closed) on all three upload routes — `uploadRoutes.ts:82,104,135`; impl `aiSpendGuard.ts:28-78` (fails closed on store error and on budget reached).
- [x] `sensitiveLimiter` (10/hr) on the download endpoint — `fileRoutes.ts:61`.
- [x] `requirePlanLimit('pdfUploadsPerMonth')` on each upload; `requirePlanLimit('maxBiomarkers')` also on lab-report + OCR (M12) — `uploadRoutes.ts:84,88,106,137,139`; planGating fails CLOSED to FREE on DB error (`planGating.ts:76-88`) and enforces `planExpiresAt` downgrade (`:73-75`).
- [x] Per-upload biomarker overshoot truncated at the shared insert site — `createBiomarkersFromOCRResult` caps to remaining quota (`shared.ts:206-231`).
- [x] `blockDemoAI` on all three upload routes — `uploadRoutes.ts:83,105,136`; impl `demoProtection.ts:164-175`.
- [x] Limiters share a Redis store when `REDIS_URL` set — `createRateLimitStore` per-limiter (`rateLimiter.ts:8,67,89,...`); falls back to per-instance MemoryStore otherwise (`rateLimitStore.ts`, documented N×limit ceiling at `rateLimiter.ts:56-63`).

### 9. Audit Logging
- [x] Uploads logged (user, filename, type, size, biomarker count) — `logCreate(LAB_REPORT_RESOURCE/...)` (`labUploadController.ts:147-156,312-328`; `sbcUploadController.ts:185-200`).
- [x] Downloads logged BEFORE streaming (user, file ID) — `logExport(..., 'FILE_DOWNLOAD', ...)` (`fileController.ts:244-250`); list/single reads logged via `logAccess` (`fileController.ts:105-112,187-188`).
- [x] Deletions logged — `logDelete(RESOURCE_TYPE, id, ...)` (`fileController.ts:353-357`).
- [x] Extraction results logged (counts, confidence) — `biomarkersExtracted` / `extractionConfidence` in audit metadata (`labUploadController.ts:150-153`, `sbcUploadController.ts:193-194`).
- [x] No file content in audit logs — metadata carries filename/size/counts/confidence only; redaction note + value omission in extractors (above).

### Alt lab path (FHIR)
- [x] FHIR lab-sync ingests biomarkers with encryption + audit, no `UserFile` — observation values encrypted per-user (`fhir/labSyncService.ts:332,345`), OAuth tokens encrypted (`:151-152,239-241`), and access/create logged to the `LabConnection` audit resource (`:105,182,370,404,469`). `Biomarker.sourceFile` intentionally plaintext (FHIR dedupe key, `:285`).

## Unverifiable
- **GCS bucket is private / uniform bucket-level access / no public ACLs / no wildcard CORS / versioning / lifecycle rules** (checklist §2 items 1-4,7,8) — these are GCS resource/IAM configurations, not present in the repo. Code reads the bucket name from env and uses ADC; the *application* never sets ACLs or CORS, but the bucket's actual IAM/CORS/versioning/lifecycle posture must be confirmed in the GCP console / `gsutil` (not auditable from source). Answers to checklist Questions 1 ("uniform access, no public ACLs") cannot be verified from code.
- **Whether a Google Cloud / Anthropic BAA is actually signed** — the code gates on `GOOGLE_BAA_ACTIVE` / `ANTHROPIC_BAA_ACTIVE` env flags (verified wired), but the existence of the underlying agreements is an operational fact outside the repo.

## Out of scope
- **Encryption-service internals** (AES-256-GCM correctness, per-user PBKDF2 key derivation) — owned by `prompts/02-encryption.md`; this review only confirms file-storage fields are routed through `encrypt`/`decrypt`.
- **RLS policy SQL correctness** (`user_files` policy `user_id = current_user_id()`) — owned by the RLS/database review; here confirmed only that controllers run inside `withRLSTransaction` and scope by `userId`.
- **AI prompt-injection robustness of the extraction prompts** — owned by `prompts/27-ai-integration.md`; this review confirms only that PHI redaction + `delimitDocumentForPrompt` run before the Claude call.
- **L34/L36 AI-quota/plan-limit TOCTOU** — documented-accepted race (`planGating.ts:90-97`), backstopped by `aiSpendGuard`; tracked in the security long-tail, not re-litigated here.
