---
tags:
  - security
  - infrastructure
  - medium
type: prompt
priority: 3
---

# File Storage & Document Processing Security Review

## Files to Review
- `backend/src/services/storageService.ts` (Google Cloud Storage)
- `backend/src/services/ocrService.ts` (Google Document AI)
- `backend/src/services/pdfParser.ts` (PDF text extraction)
- `backend/src/services/biomarkerExtractor.ts` (lab value extraction)
- `backend/src/services/sbcExtraction.ts` (insurance document parsing)
- `backend/src/controllers/uploadController.ts` (upload handling)
- `backend/src/controllers/fileController.ts` (file management)
- `backend/src/routes/uploadRoutes.ts` (upload endpoints)
- `backend/src/routes/fileRoutes.ts` (file endpoints)
- `backend/src/middleware/rateLimiter.ts` (upload rate limits)
- `backend/src/utils/securePdfParsing.ts` (PDF sandbox)
- `backend/prisma/schema.prisma` (UserFile model)
- `src/components/upload/` (frontend upload components)
- `src/utils/biomarkers/labReportParser.ts` (client-side parsing)
- `src/utils/documents/fileProcessing.ts` (client-side validation)

## OwnMyHealth File Storage Architecture
- **Storage**: Google Cloud Storage (GCS) bucket
- **Upload Flow**: Client → Backend (Multer memory storage) → GCS
- **Download**: Signed URLs with expiration (15 min)
- **Processing**: PDF parsing, OCR (Google Document AI), biomarker extraction
- **Client-Side**: Tesseract.js OCR, pdf.js text extraction (fallback)
- **File Types**: Lab reports (PDF), insurance SBC (PDF), clinical documents

## Checklist

### 1. Upload Validation
- [ ] File type validated by extension AND MIME type AND magic bytes
- [ ] Allowed types explicitly whitelisted (PDF only, or specific set)
- [ ] File size limits enforced (10MB max)
- [ ] Filename sanitized (no path traversal characters: `../`, `\`, null bytes)
- [ ] Original filename stored but not used for storage key
- [ ] Storage key uses UUID (not user-controlled names)
- [ ] Upload rejected before processing if validation fails

### 2. Google Cloud Storage Security
- [ ] GCS bucket is private (no public access)
- [ ] Bucket-level IAM restricts access to service account only
- [ ] No wildcard CORS on bucket
- [ ] Uniform bucket-level access (no per-object ACLs)
- [ ] `GCS_BUCKET_NAME` from environment variable
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` secured (not in code)
- [ ] Bucket versioning enabled (recovery from overwrites)
- [ ] Lifecycle rules for old file cleanup (if applicable)

### 3. Signed URL Security
- [ ] Download URLs are signed (not publicly accessible)
- [ ] URL expiration is short (15 minutes or less)
- [ ] Signed URLs scoped to specific object (not bucket-wide)
- [ ] URL generation requires authentication (logged-in user)
- [ ] User can only generate URLs for their own files
- [ ] Signed URL generation audit logged
- [ ] URLs not cached or stored long-term

### 4. File Processing Security
- [ ] PDF parsing runs in sandboxed context (`securePdfParsing.ts`)
- [ ] Multer uses memory storage (no temp files on disk)
- [ ] File buffers cleared after processing
- [ ] PDF content not logged (may contain PHI)
- [ ] Extraction errors don't expose file content in error messages
- [ ] Malformed PDFs handled gracefully (no crash)
- [ ] Processing timeout prevents hung operations

### 5. Client-Side Processing
- [ ] Tesseract.js OCR runs entirely in browser (no data sent to external service)
- [ ] pdf.js text extraction is local only
- [ ] Client-side extracted data sent to backend for validation/storage
- [ ] Extraction confidence scores included (user aware of accuracy)
- [ ] Large files handled without browser crashes (chunking/streaming)

### 6. File Metadata & Database
- [ ] UserFile model stores metadata, not file content
- [ ] Storage key maps to GCS object path
- [ ] File metadata includes: type, size, original name, upload date
- [ ] Lab-specific metadata: lab name, lab date, biomarkers extracted
- [ ] Foreign key relationship to User (with RLS)
- [ ] Deletion cascades: DB record AND GCS object removed

### 7. Access Control
- [ ] Users can only list/download/delete their own files
- [ ] File ownership verified on every operation
- [ ] Provider access to patient files follows consent permissions
- [ ] Admin file access audit logged
- [ ] No file enumeration possible (UUIDs, not sequential IDs)

### 8. Rate Limiting
- [ ] Upload endpoints rate limited (e.g., 20/hour)
- [ ] Rate limits prevent storage abuse
- [ ] File size + rate limits together prevent cost abuse
- [ ] OCR endpoint rate limited separately (expensive operation)

### 9. Audit Logging
- [ ] File uploads logged (user, filename, type, size)
- [ ] File downloads logged (user, file ID, IP)
- [ ] File deletions logged
- [ ] Extraction results logged (count of biomarkers, confidence)
- [ ] No file content in audit logs

## Verification Commands
```bash
# Find upload handling code
grep -r "multer\|upload\|multipart" backend/src/ --include="*.ts"

# Check file type validation
grep -r "mimetype\|fileType\|extension\|magic" backend/src/ --include="*.ts"

# Find GCS operations
grep -r "storage\|bucket\|signedUrl\|getSignedUrl" backend/src/services/storageService.ts

# Check for temp file creation
grep -r "writeFile\|createWriteStream\|tmpdir\|temp" backend/src/ --include="*.ts"

# Verify file access control
grep -r "userId.*file\|file.*userId\|userFile" backend/src/controllers/fileController.ts
```

## Questions to Ask
1. Is the GCS bucket configured with uniform access and no public ACLs?
2. What is the signed URL expiration time?
3. Are uploaded files ever scanned for malware?
4. What happens to GCS objects when a user deletes their account?
5. Is there a maximum storage quota per user?
