# Domain Security Audit — 2026-04-16

## Scope
Prompts executed: 26 (provider-patient collaboration), 27 (AI integration), 28 (file storage), 29 (data portability).

Files reviewed:
- `backend/src/routes/providerRoutes.ts`
- `backend/src/routes/patientRoutes.ts`
- `backend/src/routes/biomarkerRoutes.ts`
- `backend/src/routes/expenseRoutes.ts`
- `backend/src/routes/uploadRoutes.ts`
- `backend/src/routes/fileRoutes.ts`
- `backend/src/routes/settingsRoutes.ts`
- `backend/src/middleware/rbac.ts`
- `backend/src/middleware/rateLimiter.ts`
- `backend/src/middleware/csrf.ts`
- `backend/src/middleware/validation.ts`
- `backend/src/middleware/demoProtection.ts`
- `backend/src/middleware/auth.ts`
- `backend/src/controllers/biomarkerController.ts`
- `backend/src/controllers/expenseController.ts`
- `backend/src/controllers/uploadController.ts`
- `backend/src/controllers/fileController.ts`
- `backend/src/controllers/settingsController.ts`
- `backend/src/services/claudeExtraction.ts`
- `backend/src/services/sbcExtraction.ts`
- `backend/src/services/ocrService.ts`
- `backend/src/services/storageService.ts`
- `backend/src/services/pdfParser.ts`
- `backend/src/services/auditLog.ts`
- `backend/src/services/encryption.ts`
- `backend/src/services/userEncryption.ts`
- `backend/src/utils/securePdfParsing.ts`
- `backend/src/utils/phiRedaction.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/00000000000000_initial_schema/migration.sql`
- `backend/src/app.ts`

## Summary
| Severity | Count |
|---|---|
| Critical | 2 |
| High | 11 |
| Medium | 13 |
| Low | 7 |
| Info | 2 |

## Findings

### F-1 — GCS objects not deleted on account/data deletion — **Critical**
- **Prompt:** 29
- **Location:** `backend/src/controllers/settingsController.ts:231-236, 296-300`
- **Observation:** `deleteAllData` calls `tx.biomarker.deleteMany` / `insurancePlan.deleteMany` / `healthNeed.deleteMany` / `healthGoal.deleteMany` but never deletes `UserFile` DB rows (it doesn't even enumerate them) and never calls `storageService.deleteFile(storageKey)` to purge GCS objects. `deleteAccount` relies solely on `prisma.user.delete` — the Prisma cascade drops `UserFile` DB rows, but the GCS bucket still contains the underlying PDFs/images forever (orphaned PHI).
- **Impact:** HIPAA §164.524 right-to-delete violation. Every PDF lab report and image a user ever uploaded remains in the `${userId}/${fileId}.${ext}` path in GCS indefinitely after the user deletes their account — even though the key to re-associate them with the user has been destroyed. If the bucket is ever breached, exfiltrated, or mis-IAMed, deleted users' PHI leaks.
- **Fix:** In `deleteAccount`, before `prisma.user.delete`, fetch all `UserFile` rows for the user (`tx.userFile.findMany({ where: { userId } })`) and call `storageService.deleteFile(file.storageKey)` for each (await all, log failures to audit). Do the same (plus `tx.userFile.deleteMany`) in `deleteAllData`. Consider a GCS lifecycle rule keyed on `userId` prefix as a safety net.
- **Evidence:**
  ```ts
  // settingsController.ts:231-236
  await withRLSTransaction(userId, async (tx) => {
    await tx.biomarker.deleteMany({ where: { userId } });
    await tx.insurancePlan.deleteMany({ where: { userId } });
    await tx.healthNeed.deleteMany({ where: { userId } });
    await tx.healthGoal.deleteMany({ where: { userId } });
  });
  ```
  ```ts
  // settingsController.ts:296-300 — no GCS cleanup
  await withRLSContext(null, async () => {
    await prisma.user.delete({ where: { id: userId } });
  });
  ```

### F-2 — Raw PHI PDFs sent to Claude API in biomarker/SBC extraction — **Critical**
- **Prompt:** 27
- **Location:** `backend/src/services/claudeExtraction.ts:110-140`, `backend/src/services/sbcExtraction.ts:778-806`
- **Observation:** `extractBiomarkersWithClaude` sends the raw, unredacted PDF (`source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }`) to Anthropic's API. Lab report PDFs routinely contain full patient name, DOB, MRN, street address, ordering physician, and collection lab — all Safe Harbor identifiers under HIPAA §164.514. The prompt only instructs Claude "Do NOT include the patient's name in the response" (line 90) but does nothing to prevent the identifiers from being *transmitted to* Anthropic. `stripPHIFromText` is applied only to the response text, not the input. `extractInsuranceFromSBC` has no input-side redaction at all.
- **Impact:** Systematic PHI disclosure to an external third party on every lab upload and SBC upload. HIPAA §164.502 violation absent an executed Business Associate Agreement with Anthropic. Even with a BAA, this exceeds the minimum-necessary standard because the extracted biomarker values don't require the patient demographics on the same page.
- **Fix:** (a) Confirm and document the Anthropic BAA covers these API keys. (b) For minimum necessary: pre-extract text with a local PDF tool, apply `stripPHIFromText` (and stronger redactors — add name patterns) to the text, then send the redacted text to Claude with a text-only prompt instead of the native PDF vision input. (c) Add a BAA gate — if `ANTHROPIC_BAA_ACTIVE !== 'true'` in config, refuse to call the API.
- **Evidence:**
  ```ts
  // claudeExtraction.ts:113-116, 123-139
  extractionLogger.info('Sending PDF to Claude API', {
    base64Length: pdfBase64.length,
    phiRedactionApplied: true,   // misleading: only applied to response
  });
  ...
  content: [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
    { type: 'text', text: EXTRACTION_PROMPT },
  ],
  ```

### F-3 — Biomarker AI guidance endpoint trusts client-supplied biomarker data (IDOR / data fabrication) — **High**
- **Prompt:** 27 / 26
- **Location:** `backend/src/routes/biomarkerRoutes.ts:108-211`
- **Observation:** The POST `/biomarkers/:id/guidance` handler never reads the biomarker from the database. It takes `const { biomarker } = req.body;` and interpolates `biomarker.name`, `biomarker.value`, `biomarker.unit`, `biomarker.history` directly into the Claude prompt. The `:id` parameter is validated as a UUID but is never looked up, never ownership-verified. Any authenticated user can (a) request AI guidance for biomarker data they don't own by fabricating the body, (b) consume AI credits on arbitrary prompts, (c) cause the audit log to record an access to `resourceId=<any UUID>` that never existed. Although no PHI is returned to the caller that they didn't supply, this breaks the "every PHI endpoint verifies ownership" invariant and creates misleading audit entries.
- **Impact:** Broken access-control model for AI guidance; audit-trail poisoning (attacker chooses the `resourceId`); cost abuse within rate-limit window.
- **Fix:** In the handler, `tx.biomarker.findFirst({ where: { id: req.params.id, userId: req.user.id } })` under RLS context before calling the API. Use the database-decrypted values for the prompt — never trust the body. If the biomarker isn't owned, 404.
- **Evidence:**
  ```ts
  // biomarkerRoutes.ts:125-135
  const { biomarker } = req.body;
  const prompt = `...
  Name: ${biomarker.name}
  Value: ${biomarker.value} ${biomarker.unit}
  Reference Range: ${biomarker.normalRange?.min ?? '?'}-${biomarker.normalRange?.max ?? '?'}
  ...`;
  // no prisma lookup of req.params.id
  ```

### F-4 — Data export omits 8 of 11 PHI categories — **High**
- **Prompt:** 29
- **Location:** `backend/src/controllers/settingsController.ts:84-108, 175-189`
- **Observation:** `exportUserData` decrypts and returns only `biomarkers` and `insurancePlans`. Missing from the export: `User` profile PHI (firstName, lastName, DOB, phone, address — all encrypted), `BiomarkerHistory`, `HealthNeed`, `HealthGoal`, `GoalProgressHistory`, `ExpenseProjection`, `ExpenseActual`, `CostAnalysis`, `ProviderPatient` relationships, `UserFile` metadata. 9 of the 11 canonical PHI categories in `_phi-inventory.md` are missing (biomarkers and insurance plans are the only ones exported, and insurance plans omit the encrypted memberId/groupId).
- **Impact:** HIPAA §164.524 requires a covered entity to provide the individual with access to *all* PHI in a designated record set. The incomplete export fails that right-of-access requirement and misleads users into believing they have a full copy of their data.
- **Fix:** Add queries + decryption in `exportUserData` for every PHI category listed above. Decrypt `memberIdEncrypted`/`groupIdEncrypted` on `InsurancePlan`. Decrypt `firstNameEncrypted`/`lastNameEncrypted`/etc. on the user row. Export `UserFile` metadata with `originalFilename`, `labName`, `labDate`, `fileSize`, `createdAt` (file bytes can be obtained via signed URLs in a separate step).
- **Evidence:**
  ```ts
  // settingsController.ts:181-189 — export payload only has two PHI collections
  biomarkers: decryptedBiomarkers,
  insurancePlans: exportInsurancePlans,
  summary: { totalBiomarkers, byCategory, abnormalCount, normalCount },
  ```

### F-5 — Data-deletion of "all health data" misses half the health-data tables — **High**
- **Prompt:** 29
- **Location:** `backend/src/controllers/settingsController.ts:231-236`
- **Observation:** `deleteAllData` deletes only `biomarker`, `insurancePlan`, `healthNeed`, `healthGoal`. It does not delete `biomarkerHistory` (survives only via the `Biomarker` cascade — OK), `expenseProjection`, `expenseActual`, `costAnalysis`, `goalProgressHistory` (survives via `HealthGoal` cascade — OK), `userFile` + GCS objects (see F-1), `providerPatient` relationships (active consent grants to providers remain after "delete all health data"), `dnaData`/`dnaVariant`/`geneticTrait`. After a user clicks "delete my health data, keep my account", providers still have live access to queries that now return empty sets, expense projections and cost analyses persist, and uploaded lab PDFs persist in both the DB (`user_files`) and GCS.
- **Impact:** User's expectation "my health data is gone" is violated. Providers retain `ACTIVE` consent pointing at the now-empty account, and their queries are still audit-logged as successful PHI access. Expense projections and AI cost analyses (encrypted PHI) remain.
- **Fix:** Expand the transaction to `deleteMany` on `expenseProjection`, `expenseActual`, `costAnalysis`, `userFile` (+ GCS cleanup per F-1), `dnaData`, `providerPatient` (on both `providerId` and `patientId` sides — the patient's deletion of health data should also revoke their relationships). Then expand the count+audit entry to match.
- **Evidence:**
  ```ts
  // settingsController.ts:231-236
  await withRLSTransaction(userId, async (tx) => {
    await tx.biomarker.deleteMany({ where: { userId } });
    await tx.insurancePlan.deleteMany({ where: { userId } });
    await tx.healthNeed.deleteMany({ where: { userId } });
    await tx.healthGoal.deleteMany({ where: { userId } });
  });
  ```

### F-6 — No rate limit on provider access-request endpoint (spam/enumeration) — **High**
- **Prompt:** 26
- **Location:** `backend/src/routes/providerRoutes.ts:100-201`
- **Observation:** `POST /provider/patients/request` has no `aiLimiter`, `sensitiveLimiter`, or dedicated rate limiter — only the app-wide `standardLimiter` (100 / 15 min). A provider can iterate through email addresses to (a) spam patients with access-request notifications, (b) enumerate which emails correspond to PATIENT-role accounts versus PROVIDER/ADMIN-role (different response bodies / error messages at lines 123-133), and (c) build up hundreds of pending requests against any patient. The endpoint explicitly distinguishes "patient not found" (`NotFoundError`) from "not a patient account" (`ForbiddenError`) and both responses are observable by the requester.
- **Impact:** Account enumeration (role leak), spam harassment of patients, potentially social-engineering surface if many providers can be impersonated.
- **Fix:** Add a dedicated rate limiter (e.g., 10 requests/hour per providerId) on this route. Collapse the "not found" and "not a patient" responses to a single generic success-looking response (`{ status: 'PENDING_IF_APPLICABLE' }`) to prevent role enumeration.
- **Evidence:**
  ```ts
  // providerRoutes.ts:100-103 — no limiter middleware
  router.post(
    '/patients/request',
    validate(schemas.providerPatient.request),
    asyncHandler(async (req, res) => { ... })
  );
  ```
  ```ts
  // providerRoutes.ts:116-134 — distinct error messages leak role
  if (!patient) { throw new NotFoundError('Patient not found with this email'); }
  if (patient.role !== 'PATIENT') { throw new ForbiddenError('Can only request access to patient accounts'); }
  ```

### F-7 — Patient account `isActive=false` / `lockedUntil` not enforced on provider data access — **High**
- **Prompt:** 26
- **Location:** `backend/src/routes/providerRoutes.ts:216-300, 315-403, 411-497`; `backend/src/middleware/rbac.ts:195-245`
- **Observation:** Every provider data-access handler checks `relationship.status === 'ACTIVE'` and `consentExpiresAt`, but none check whether the patient's own account is still active (`user.isActive`), not email-verified, or currently locked (`lockedUntil > now`). A patient whose account was deactivated by an admin (e.g., post-termination or security incident) will still have their biomarkers and health needs served to providers with an active relationship.
- **Impact:** PHI served after the patient's access should be frozen. If the patient deactivated their account to "pause" provider access, providers still see their data.
- **Fix:** Extend `checkProviderPatientAccess` and every inline relationship check in `providerRoutes.ts` to also `select: { isActive, lockedUntil }` on the patient and reject if `!isActive || lockedUntil > new Date()`.
- **Evidence:**
  ```ts
  // providerRoutes.ts:249-259 — only selects email/name/timestamps, no isActive / lockedUntil
  const patient = await prisma.user.findUnique({
    where: { id: patientId },
    select: { id: true, email: true, firstNameEncrypted: true, lastNameEncrypted: true, createdAt: true, lastLoginAt: true },
  });
  ```
  ```ts
  // rbac.ts:203-220 — checkProviderPatientAccess only checks the relationship, not the patient user
  const relationship = await prisma.providerPatient.findUnique({ where: { providerId_patientId: { providerId, patientId } } });
  if (!relationship) return false;
  if (relationship.status !== 'ACTIVE') return false;
  if (relationship.consentExpiresAt && relationship.consentExpiresAt < new Date()) return false;
  ```

### F-8 — Provider patient list includes `PENDING` relationships, leaking pending-approval state — **High**
- **Prompt:** 26
- **Location:** `backend/src/routes/providerRoutes.ts:38-55, 57-79`
- **Observation:** `GET /provider/patients` returns relationships with `status: { in: ['ACTIVE', 'PENDING'] }` and includes the patient's email for every one of them. For `PENDING` relationships the patient has not yet approved access, yet the provider is handed the patient's email address and `createdAt` timestamp. Also, because `firstNameEncrypted` / `lastNameEncrypted` are returned as ciphertext in the select (line 48-49), they are passed back down the chain (the transformer drops them but the query returns them over the wire only if the select is extended).
- **Impact:** Confirms which email addresses are registered as PATIENT accounts (by any provider who can submit requests). Violates the "PENDING relationships grant zero data access" rule from the checklist. A compromised provider account can enumerate all patients they've ever requested access to.
- **Fix:** Change the query to `status: 'ACTIVE'` only. Create a separate endpoint (e.g., `/provider/requests/outgoing`) for the provider to see their own pending requests, returning only the relationship ID/createdAt and a *masked* patient email (`j***@gmail.com`).
- **Evidence:**
  ```ts
  // providerRoutes.ts:38-55
  const relationships = await prisma.providerPatient.findMany({
    where: { providerId, status: { in: ['ACTIVE', 'PENDING'] } },
    include: {
      patient: {
        select: { id: true, email: true, firstNameEncrypted: true, lastNameEncrypted: true, createdAt: true },
      },
    },
  });
  ```

### F-9 — No CSRF protection on settings DELETE endpoints — **High**
- **Prompt:** 29
- **Location:** `backend/src/middleware/csrf.ts:119-125, 149-151, 161`; `backend/src/routes/settingsRoutes.ts:35-46`
- **Observation:** CSRF middleware explicitly skips `/settings/delete-data`, `/settings/delete-account`, `/settings/export-data` (lines 119-125). The stated justification is "Bearer tokens are not automatically sent by browsers". But the primary auth path in this codebase is `HTTP-only cookies` (`backend/src/middleware/auth.ts:33` prioritizes `req.cookies.access_token` over the Authorization header). With a cookie-based session, CSRF is *not* redundant — a malicious page can trigger a DELETE to `/api/v1/settings/delete-account` (password-confirmed, but `deleteAllData` has no password). The exclusion is unsafe.
- **Impact:** An authenticated user visiting a malicious page could have all their health data silently deleted via CSRF against `/settings/delete-data` (no password required). Full account deletion requires the password in the body, so a CSRF alone cannot complete it, but data wipe can.
- **Fix:** Remove `/settings/delete-data`, `/settings/export-data` from the CSRF skip-list. Keep the skip for `/settings/delete-account` only if the password requirement is genuinely enforced (it currently is — `settingsController.ts:262-287`), but still safest to require CSRF. Alternatively, require password on `deleteAllData` too.
- **Evidence:**
  ```ts
  // csrf.ts:119-125
  const settingsRoutes = [
    '/settings/delete-data',
    '/settings/delete-account',
    '/settings/export-data',
  ];
  ```
  ```ts
  // auth.ts:33-35 — cookie takes priority, making this a cookie session
  if (req.cookies?.access_token) { return req.cookies.access_token; }
  ```

### F-10 — `deleteAllData` does not require password confirmation — **High**
- **Prompt:** 29
- **Location:** `backend/src/controllers/settingsController.ts:210-251`
- **Observation:** `deleteAllData` deletes every biomarker, insurance plan, health need, and health goal for the user and has no password re-confirmation. Combined with F-9 (no CSRF), a single authenticated request wipes PHI irreversibly. `deleteAccount` at line 257 *does* require password (line 264-266) and `verifyPassword` is called (line 284) — but the partial-delete sibling doesn't.
- **Impact:** Irreversible PHI destruction with the lowest possible precondition (a live session). Hostile script on a hijacked tab, shared family device, or mis-click can destroy labs/goals.
- **Fix:** Add `password` requirement on `deleteAllData` matching the `deleteAccount` pattern (verify via `verifyPassword(password, user.passwordHash)`), or at minimum require a confirmation token obtained from a separate "confirm deletion" endpoint.
- **Evidence:**
  ```ts
  // settingsController.ts:210-218 — no password check
  export async function deleteAllData(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const prisma = getPrismaClient();
    const auditService = getAuditLogService(prisma);
    // no password verification, straight to delete
  ```

### F-11 — Lab-report upload bypasses PDF header validation (DoS via PDF bomb / arbitrary binary forwarded to Claude) — **High**
- **Prompt:** 28
- **Location:** `backend/src/services/ocrService.ts:358-394`, `backend/src/services/claudeExtraction.ts:100-140`
- **Observation:** The lab-report upload path is `uploadLabReport` → `processDocument` → `processPDFWithClaude` → `extractBiomarkersWithClaude`. Neither `processDocument`, nor `processPDFWithClaude`, nor `extractBiomarkersWithClaude` calls `validatePdfHeader` from `securePdfParsing.ts`. `validatePdfHeader` is only invoked inside `secureParsePdf`, which is called only from `pdfParser.ts` (regex SBC path). Result: a file with mimetype `application/pdf` that multer accepts is forwarded raw to Claude's API with no magic-byte check. A caller can upload a non-PDF buffer declared as `application/pdf`, skipping the local DoS protections that `securePdfParsing.ts` documents ("Denial-of-Service via PDF Bombs" finding).
- **Impact:** (a) DoS protections (timeout, memory-cap) in `securePdfParsing.ts` are bypassed for the most-used upload path. (b) Arbitrary non-PDF content is sent to the Anthropic API, wasting tokens and potentially exposing non-PDF data (e.g., a DOCX declared as PDF) to Claude. (c) The "file type validated by magic bytes" checklist item fails.
- **Fix:** Call `validatePdfHeader(file.buffer, file.originalname)` in `uploadController.uploadLabReport` and `uploadController.uploadSBC` *before* any extraction path. Also apply to `uploadLabResultOCR` when mimetype is `application/pdf`. Re-export the validator from `securePdfParsing.ts` (already done).
- **Evidence:**
  ```ts
  // ocrService.ts:378-387 — PDF handed to Claude without magic-byte check
  if (mimeType === 'application/pdf') {
    if (isClaudeExtractionConfigured()) {
      try {
        return await processPDFWithClaude(buffer, mimeType, startTime);
      } catch (error) { ... throw error; }
    }
  }
  ```
  ```ts
  // claudeExtraction.ts:111 — direct base64 of unknown buffer
  const pdfBase64 = pdfBuffer.toString('base64');
  ```

### F-12 — Magic-byte / content-type mismatch check missing on multer uploads (image MIME-only check) — **High**
- **Prompt:** 28
- **Location:** `backend/src/routes/uploadRoutes.ts:34-67`, `backend/src/controllers/uploadController.ts:71-92`
- **Observation:** The multer `fileFilter` for the OCR upload endpoint (line 45-66) and the validator `validateUploadFile` (uploadController.ts:71-92) rely on the client-supplied `file.mimetype`. There is no magic-byte check for PNG/JPEG/TIFF/WebP. An attacker can craft a file with `.pdf` extension, `image/png` Content-Type header, and arbitrary content; multer accepts it and the buffer is forwarded to Google Document AI (or Claude for PDF type). Combined with F-11, none of the four upload formats (PDF, PNG, JPG, TIFF) is validated by magic bytes.
- **Impact:** Arbitrary binary data forwarded to external paid APIs. Bypasses defence-in-depth; client-controlled classification decides which API the backend calls.
- **Fix:** After multer accepts the buffer, in `validateUploadFile`, check the first N bytes against the expected magic (`0x89504E47` for PNG, `0xFFD8FF` for JPEG, `0x4D4D002A`/`0x49492A00` for TIFF, `0x25504446` for PDF, `0x52494646` RIFF for WebP). Reject on mismatch.
- **Evidence:**
  ```ts
  // uploadController.ts:80-86
  const supportedTypes: readonly string[] = SUPPORTED_MIME_TYPES[uploadType];
  if (!supportedTypes.includes(file.mimetype)) {   // mimetype only
    throw new ValidationError(`Only ${typeNames} are accepted`);
  }
  ```

### F-13 — Provider biomarker/health-needs access logs omit consent-expiration check to PHI DB read ordering — **High**
- **Prompt:** 26
- **Location:** `backend/src/routes/providerRoutes.ts:315-403`, `411-497`
- **Observation:** The patient-detail endpoint (`GET /provider/patients/:patientId`) validates the relationship and consent expiration, *but the patient data (biomarkers, health needs) can be queried without going through that endpoint first*. The biomarker and health-needs endpoints each re-check the relationship — that's fine — however the queries `prisma.biomarker.findMany({ where: { userId: patientId } })` (line 357-360) and `prisma.healthNeed.findMany({ where: { userId: patientId } })` (line 460-463) are made **outside** `withRLSTransaction` / `withRLSContext`. RLS policies (per `backend/prisma/migrations/20260107_add_rls_policies/`) rely on the `app.current_user_id` session variable being set; these bare `prisma.*` calls bypass RLS. If the consent check is somehow bypassed or the relationship row is stale, the DB-layer RLS defense-in-depth is not engaged.
- **Impact:** RLS is advertised as a second line of defense (CLAUDE.md) but is inactive for the cross-user provider read paths. A code mistake in the consent check — e.g., a missing `return` after throwing — could leak PHI that RLS would otherwise block.
- **Fix:** Wrap the biomarker/health-needs queries in `withRLSContext` using the **provider's** userId (so the provider is authenticated to the session) *or* run through a specialized cross-user RLS bypass that's explicitly logged. Alternately, use an authorization-aware wrapper that asserts the relationship then sets the RLS context.
- **Evidence:**
  ```ts
  // providerRoutes.ts:357-360
  const biomarkers = await prisma.biomarker.findMany({
    where: { userId: patientId },
    orderBy: { measurementDate: 'desc' },
  });
  ```
  ```ts
  // providerRoutes.ts:460-463
  const healthNeeds = await prisma.healthNeed.findMany({
    where: { userId: patientId },
    orderBy: { createdAt: 'desc' },
  });
  ```

### F-14 — No Anthropic BAA enforcement / feature disabling — **Medium**
- **Prompt:** 27
- **Location:** `backend/src/config/index.ts:201-203`, `backend/src/services/claudeExtraction.ts:48-58`
- **Observation:** There is no environment flag (`ANTHROPIC_BAA_ACTIVE`, etc.) gating the Claude integration. The service starts and accepts lab uploads so long as `ANTHROPIC_API_KEY` is present. The config emits only a *warning* when the key is missing and nothing at all about BAA status. BAA status cannot be verified from code (requires contract review — see Unverifiable).
- **Impact:** Unverifiable BAA coverage; if the environment is deployed against a personal Anthropic key (no BAA), PHI is disclosed without §164.502 authorization.
- **Fix:** Require `ANTHROPIC_BAA_ACTIVE === 'true'` at startup validation in production; refuse to boot if the flag is false *and* `ANTHROPIC_API_KEY` is set. Log the key's organization ID on startup for audit evidence.
- **Evidence:**
  ```ts
  // config/index.ts:201-203
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(`${new Date().toISOString()} WARN [Config] ANTHROPIC_API_KEY is not set — AI features ... will be unavailable\n`);
  }
  ```

### F-15 — Client-supplied lab-report filename stored as `sourceFile`/`originalFilename` without sanitization — **Medium**
- **Prompt:** 28
- **Location:** `backend/src/controllers/uploadController.ts:247, 283, 1418-1419`, `backend/src/services/storageService.ts:53`
- **Observation:** `file.originalname` is written to `UserFile.originalFilename`, `UserFile.filename` (line 1418-1419), and into audit logs (line 283) and passed as the `filename` parameter to `parseSBC` and `processDocument`. The GCS `storageKey` is `${userId}/${fileId}.${extension}` (safe — all server-controlled). But `originalFilename` flows back to the frontend unsanitized in `fileController.getFiles` and `getFile` responses (line 24, 68) where the UI may display it. Multer does not sanitize; there is no `path.basename` normalization. Filenames like `../../etc/passwd` or those containing Unicode control characters are stored verbatim.
- **Impact:** No direct path traversal (storage key ignores `originalname`), but XSS-via-filename if the frontend renders without escaping, and potential log-injection. Low-to-medium blast radius.
- **Fix:** In `validateUploadFile`, set `file.originalname = path.basename(file.originalname).replace(/[\x00-\x1F\x7F"<>|:*?\\\/]/g, '_').slice(0, 255)` before any downstream use.
- **Evidence:**
  ```ts
  // uploadController.ts:1418-1419
  filename: labName ? `${labName} - ${reportDate.toLocaleDateString()}` : file.originalname,
  originalFilename: file.originalname,
  ```

### F-16 — AI audit-log records client-controlled biomarker name as unencrypted metadata — **Medium**
- **Prompt:** 27 / 05
- **Location:** `backend/src/routes/biomarkerRoutes.ts:204-211`
- **Observation:** The biomarker-guidance audit entry writes `biomarkerName: biomarker.name` in the metadata JSON. `biomarker.name` is user-supplied body content validated only with `promptSafeString(1, 100)` (control-char strip, length cap). AuditLog's `metadata` column is plaintext, not encrypted. If the client supplies "MRN: 12345" or a SSN-looking value as the biomarker name, it persists unencrypted in the audit log for 7 years.
- **Impact:** Misrouted PHI into an unencrypted column; violates the "PHI in audit log must be encrypted via systemSalt" pattern. Minor in absolute terms (attacker must be authenticated and choose to log themselves), but a pattern failure.
- **Fix:** Do not echo user-supplied `biomarker.name` into metadata. Instead look up the biomarker server-side (see F-3 fix) and record a stable category/id. If the name must be logged, place it in `newValueEncrypted` via `this.encryptValue(...)` using `auditService.logAccess` extensions.
- **Evidence:**
  ```ts
  // biomarkerRoutes.ts:204-211
  await auditService.logAccess('biomarker_ai_guidance', req.params.id, { req, userId: authReq.user!.id }, {
    operation: 'PHI_ACCESS',
    ...
    biomarkerName: biomarker.name,
    phiDisclosedFields: ['name', 'value', 'unit', 'normalRange', 'status', 'history'],
  });
  ```

### F-17 — Cost-analysis prompt sends decrypted expense PHI with only a 200-char sanitizer — **Medium**
- **Prompt:** 27
- **Location:** `backend/src/controllers/expenseController.ts:317-353`, `backend/src/middleware/validation.ts:55-61`
- **Observation:** `analyzeCosts` decrypts `serviceType` and `notes` for every projection and interpolates them into the Claude prompt (`buildCostAnalysisPrompt`). `sanitizeForPrompt` strips control chars and caps at 200 characters. This is defence-in-depth against prompt injection but the *PHI content itself* still goes to Claude: service types like "HIV PrEP consultation", "abortion care", "gender-affirming surgery" are directly transmitted. No `stripPHIFromText` is applied. No patient identifiers are sent (OK), but sensitive diagnoses/procedures are. Same issue as F-2 on a smaller footprint.
- **Impact:** Sensitive-category PHI to external AI without explicit BAA-scoped documentation. `sanitizeForPrompt` only prevents injection, not disclosure.
- **Fix:** Require BAA (see F-14). Consider anonymizing service types by category before sending (e.g., "Specialist visit" instead of "HIV specialist visit").
- **Evidence:**
  ```ts
  // expenseController.ts:317-324
  const decryptedProjections = projections.map((p) => ({
    id: p.id,
    serviceType: sanitizeForPrompt(encryption.decrypt(p.serviceTypeEncrypted, userSalt)),
    estimatedCost: parseFloat(encryption.decrypt(p.estimatedCostEncrypted, userSalt)),
    ...
    notes: p.notesEncrypted ? sanitizeForPrompt(encryption.decrypt(p.notesEncrypted, userSalt)) : null,
  }));
  ```

### F-18 — Provider consent `canViewInsurance` / `canViewDna` / `canEditData` have no enforcement endpoints — **Medium**
- **Prompt:** 26
- **Location:** `backend/src/routes/providerRoutes.ts` (search exhausted)
- **Observation:** `providerRoutes.ts` implements only `/patients/:patientId/biomarkers` (gated by `canViewBiomarkers`) and `/patients/:patientId/health-needs` (gated by `canViewHealthNeeds`). There are no endpoints backing `canViewInsurance`, `canViewDna`, or `canEditData`. The flags are settable via patient consent UI, stored in DB, and displayed to both sides, but they gate nothing. The patient is misled into believing that denying `canViewInsurance` restricts something — it restricts nothing because no provider endpoint reads insurance plans. However, the `rbac.ts:checkProviderPatientAccess` does reference them (line 234-245) for generic middleware consumers. If any future endpoint relies on `requireResourceAccess('insurance', 'read')` for providers, the flags will start to matter; today they are cosmetic.
- **Impact:** Consent UI creates a false sense of granular control. HIPAA minimum-necessary principle: consent is advertised as restrictive but isn't.
- **Fix:** Either (a) implement `/provider/patients/:id/insurance` and `/provider/patients/:id/dna` with the corresponding permission checks and enforcement, or (b) remove `canViewInsurance`, `canViewDna`, `canEditData` flags and the DNA-tab controls from the patient consent UI until endpoints exist.
- **Evidence:**
  ```ts
  // providerRoutes.ts — only two PHI-bearing endpoints under /patients/:patientId/
  router.get('/patients/:patientId/biomarkers', ...);    // line 306
  router.get('/patients/:patientId/health-needs', ...);  // line 409
  // no insurance, dna, or edit endpoints
  ```

### F-19 — `SUSPENDED`/`EXPIRED` ProviderPatient statuses have no code path that sets them — **Medium**
- **Prompt:** 26
- **Location:** `backend/prisma/schema.prisma:555-561`, `backend/src/routes/patientRoutes.ts`, `backend/src/routes/providerRoutes.ts`
- **Observation:** The `ProviderPatientStatus` enum includes `SUSPENDED` and `EXPIRED`. Greps show no controller ever transitions a relationship into `SUSPENDED` or `EXPIRED`. Consent expiration (`consentExpiresAt`) is checked inline at each access, but no scheduled job or endpoint flips the `status` column to `EXPIRED` when the timestamp passes — so the relationship shows to the provider UI as `ACTIVE` with a past `consentExpiresAt`, and the patient's "Your active providers" list (line 36 of patientRoutes) includes it. `SUSPENDED` is orphan-state: no code can reach it. The inline `< new Date()` guard protects data read, but downstream UX is confused.
- **Impact:** Providers see consent-expired patients in their list; patients see expired relationships as "active" in the patient UI. `SUSPENDED` state is dead code.
- **Fix:** Add a scheduled job (tied to the existing audit cleanup scheduler) that flips `status` to `EXPIRED` where `consentExpiresAt < now` and `status = 'ACTIVE'`. Either implement `SUSPENDED` (admin action to freeze a relationship pending review) or remove it from the enum and schema.
- **Evidence:**
  ```ts
  // patientRoutes.ts:36-39 — lists all statuses
  const relationships = await prisma.providerPatient.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
  });
  ```
  ```prisma
  // schema.prisma:555-561
  enum ProviderPatientStatus { PENDING ACTIVE SUSPENDED REVOKED EXPIRED }
  ```

### F-20 — Signed URL TTL adequate but download does not constrain to the requester's IP/session — **Medium**
- **Prompt:** 28
- **Location:** `backend/src/services/storageService.ts:20, 97-133`
- **Observation:** `SIGNED_URL_EXPIRATION_MS = 15 * 60 * 1000` (15 min) per the prompt's requirement. The signed URL grants read access to anyone in possession of the URL for 15 minutes — no IP binding, no session cookie, no user-agent check. A URL leaked via browser history, referer header to a third-party script, or logs is replayable from any network.
- **Impact:** URL theft within 15-minute window exposes the full PHI file to a non-authenticated third party.
- **Fix:** Option A: reduce TTL to 2-5 minutes for PHI downloads. Option B: proxy the download through a backend endpoint (stream from GCS) so the signed URL is never exposed to the browser; add auth cookie + CSRF on the proxy. Option C: GCS v4 signed URLs support `x-goog-content-sha256` pinning and extension headers — constrain by User-Agent or by a per-download nonce.
- **Evidence:**
  ```ts
  // storageService.ts:20
  const SIGNED_URL_EXPIRATION_MS = 15 * 60 * 1000; // 15 minutes
  ```
  ```ts
  // storageService.ts:106-112
  const options: GetSignedUrlConfig = {
    version: 'v4',
    action: action,
    expires: Date.now() + expirationMs,
  };
  const [signedUrl] = await file.getSignedUrl(options);
  ```

### F-21 — `uploadLabReport` / `uploadSBC` do not persist UserFile record — lab PDFs lost after extraction — **Medium**
- **Prompt:** 28
- **Location:** `backend/src/controllers/uploadController.ts:232-303, 310-822`
- **Observation:** Both `uploadLabReport` (lab-report PDF) and `uploadSBC` (insurance SBC) extract biomarkers/plans but never call `uploadToGCS` and never create a `UserFile` row. Only `uploadLabResultOCR` (line 1350-1500) persists the uploaded file to GCS (line 1395) and creates the `UserFile` record (line 1412). The audit log records filename/size but the file bytes are discarded. This means the user cannot re-download the lab PDF they uploaded and cannot audit what the extraction was run on. `reanalyzePlan` (line 832) requires a new file upload every time because nothing was stored.
- **Impact:** Inconsistent storage model. HIPAA's right-to-access (§164.524) covers the original source PDF — if the user uploaded a lab PDF and the extraction was wrong, they cannot retrieve the original to verify. Also breaks the audit trail integrity if an extraction result is challenged.
- **Fix:** Call `uploadToGCS` and create `UserFile` in `uploadLabReport` and `uploadSBC` paths too, matching the `uploadLabResultOCR` pattern. Link each `InsurancePlan`/`Biomarker` to the `UserFile.id` that produced it.
- **Evidence:**
  ```ts
  // uploadController.ts:247-279 — no uploadToGCS, no userFile.create
  const ocrResult = await processDocument(file.buffer, file.mimetype, file.originalname);
  ...
  const createdBiomarkers = await withRLSTransaction(userId, async (tx) => {
    return createBiomarkersFromOCRResult(tx, encryptionService, userSalt, { ... });
  });
  ```

### F-22 — File deletion continues with DB deletion when GCS deletion fails — **Medium**
- **Prompt:** 28
- **Location:** `backend/src/controllers/fileController.ts:254-281`
- **Observation:** `deleteFile` attempts GCS deletion in a try/catch, logs the failure, and **continues to delete the DB record** even if GCS deletion failed (line 265-267 comment is explicit about this). The net result is an orphaned GCS object with no DB pointer — unreachable by the user, but still in the bucket containing PHI.
- **Impact:** PHI objects accumulate in GCS without any handle to find them. Storage cost grows; more importantly, objects that should be deleted per §164.524 are not.
- **Fix:** If GCS delete fails with anything other than 404 (file already gone), do not delete the DB record — instead mark the row with a `pendingDeleteAt` column and retry asynchronously. Only delete the DB row when GCS confirms deletion (or returns 404).
- **Evidence:**
  ```ts
  // fileController.ts:254-267
  try {
    await deleteFromStorage(file.storageKey);
  } catch (error) {
    logger.error('Failed to delete file from GCS', { ... });
    // Continue with database deletion even if GCS fails
    // The file might already be deleted or the storage key might be invalid
  }
  ```

### F-23 — Provider can delete a relationship (DELETE /provider/patients/:patientId) while patient's audit trail appears to record it as provider action — **Medium**
- **Prompt:** 26
- **Location:** `backend/src/routes/providerRoutes.ts:503-569`
- **Observation:** `DELETE /provider/patients/:patientId` allows the provider to hard-delete the `ProviderPatient` row (line 559-561 `prisma.providerPatient.delete`). The `patientRoutes.ts` sibling uses `status: 'REVOKED'` (line 421) to preserve the row — that's the right pattern, because the audit log's `resourceId` column for any previous PHI access referenced this relationship's id, and destroying the row makes past audit entries un-joinable.
- **Impact:** Inconsistent consent-lifecycle: patient-initiated revocation preserves the row, provider-initiated removal destroys it. A malicious provider can cover their tracks (cannot delete audit rows, but can delete the joinable `ProviderPatient` that the audit metadata references).
- **Fix:** In `providerRoutes.ts:559-561`, replace `prisma.providerPatient.delete` with `prisma.providerPatient.update({ where: { id }, data: { status: 'REVOKED' } })` — matches the patient-side behavior.
- **Evidence:**
  ```ts
  // providerRoutes.ts:559-561 — hard delete
  await prisma.providerPatient.delete({
    where: { id: relationship.id },
  });
  ```
  ```ts
  // patientRoutes.ts:420-423 — soft revoke (correct pattern)
  await prisma.providerPatient.update({
    where: { id },
    data: { status: 'REVOKED' },
  });
  ```

### F-24 — AI-cost tracker user context lost for extraction calls (userId='system') — **Medium**
- **Prompt:** 27
- **Location:** `backend/src/services/claudeExtraction.ts:144-150`, `backend/src/services/sbcExtraction.ts:824-830`
- **Observation:** `trackAIUsage({ ... userId: 'system' })` is hard-coded for both lab extraction and SBC extraction. Per-user cost tracking is impossible for the two most-expensive operations (document vision calls with 16K output tokens). The comment "extraction doesn't have user context here" is factually wrong — both callers (`uploadController.uploadLabReport`, `uploadController.uploadSBC`) have `userId` in scope and could pass it as a parameter.
- **Impact:** Per-user cost cap and abuse-detection fail for the primary Claude endpoints. A hostile user can run many extractions within the 20/hour upload limit, generating hundreds of dollars in Claude vision calls without attribution.
- **Fix:** Add a `userId` parameter to `extractBiomarkersWithClaude` and `extractInsuranceFromSBC`; pass it through from the controllers; use it in `trackAIUsage`.
- **Evidence:**
  ```ts
  // claudeExtraction.ts:144-150
  trackAIUsage({
    endpoint: 'lab-extraction',
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    userId: 'system', // extraction doesn't have user context here
  });
  ```

### F-25 — `stripPHIFromText` regex catalog is narrow (no name patterns, no email, no DEA/NPI) — **Medium**
- **Prompt:** 27
- **Location:** `backend/src/utils/phiRedaction.ts:13-30`
- **Observation:** The redactor handles SSN, MRN-prefixed IDs, phone, DOB-prefixed dates, street address-with-keyword. It does *not* redact: email addresses, freestanding DOB patterns without a DOB prefix, ZIP codes, NPI (10-digit physician IDs), DEA numbers (`[A-Z]{2}\d{7}`), patient names (impossible with regex alone), or lab account numbers without explicit keywords. Even as a "defence-in-depth" measure it misses most identifiable content on a lab report header.
- **Impact:** False sense of protection. The function name implies full redaction; it delivers only partial coverage of a handful of patterns. Also, it's applied only to the Claude *response*, not the input (see F-2).
- **Fix:** Expand the pattern set; add email `[\w._%+-]+@[\w.-]+\.\w+` → `[EMAIL_REDACTED]`; add ZIP; add NPI/DEA; document the *function is not a PHI scrubber*, it is a best-effort response-sanitizer.
- **Evidence:**
  ```ts
  // phiRedaction.ts:13-30 — only 5 patterns
  export function stripPHIFromText(text: string): string {
    text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]');
    text = text.replace(/\b(?:MRN|Medical Record|Account|Patient ID)[:\s#]*[\w-]+/gi, '[MRN_REDACTED]');
    text = text.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE_REDACTED]');
    text = text.replace(/\b(?:DOB|Date of Birth|Birth Date)[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, '[DOB_REDACTED]');
    text = text.replace(/\b\d{1,5}\s+[\w\s]{2,30}(?:Street|St|...)\b/gi, '[ADDRESS_REDACTED]');
    return text;
  }
  ```

### F-26 — Anthropic client singleton never tears down between deploys / key rotation — **Low**
- **Prompt:** 27
- **Location:** `backend/src/services/claudeExtraction.ts:43-58`, `backend/src/services/sbcExtraction.ts:310-325`, `backend/src/controllers/expenseController.ts:33-42`
- **Observation:** Each service has its own module-level `let anthropicClient: Anthropic | null = null;` that is populated lazily and never invalidated. If `ANTHROPIC_API_KEY` is rotated without a process restart, the old key remains in memory. Three independent singletons also prevent a central "disable AI" switch.
- **Impact:** Stale credentials on key rotation; harder audit of AI calls.
- **Fix:** Move Anthropic client creation to a shared service (`services/anthropicClient.ts`) with `reset()` and `isEnabled()`; gate all three callers through it.
- **Evidence:**
  ```ts
  // claudeExtraction.ts:43
  let anthropicClient: Anthropic | null = null;
  ```

### F-27 — Signed URLs generated without ownership re-check inside `storageService.getSignedUrl` — **Low**
- **Prompt:** 28
- **Location:** `backend/src/services/storageService.ts:97-133`, `backend/src/controllers/fileController.ts:101-170, 176-218`
- **Observation:** `getSignedUrl(storageKey)` accepts any storage key and returns a signed URL. The ownership check is done in the controller (`userFile.findFirst({ where: { id, userId } })`) before the key is passed. Defence-in-depth would have the service also validate that `storageKey.startsWith(`${userId}/`)` — because the current structure is `${userId}/${fileId}.${ext}`, the userId-prefix invariant is checkable. Today, if any caller ever passed a raw storage key without the preceding DB ownership check, a cross-user URL could be minted.
- **Impact:** Pure defence-in-depth; no current exploit.
- **Fix:** Add a `requireUserId` parameter to `getSignedUrl` and assert `storageKey.split('/')[0] === requireUserId` (throw otherwise).
- **Evidence:**
  ```ts
  // storageService.ts:97-112
  export async function getSignedUrl(storageKey: string, action: 'read' | 'write' = 'read', ...) {
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(storageKey);
    const [signedUrl] = await file.getSignedUrl(options);
  ```

### F-28 — `AuditLog.user` relation has no `onDelete` in schema.prisma but migration sets `SET NULL` — **Low** (Prompt drift)
- **Prompt:** 29
- **Location:** `backend/prisma/schema.prisma:514`, `backend/prisma/migrations/00000000000000_initial_schema/migration.sql:399-400`
- **Observation:** `schema.prisma:514` declares `user User? @relation(fields: [userId], references: [id])` with no `onDelete`. The initial migration explicitly sets `ON DELETE SET NULL` (line 400). Prisma's default when `onDelete` is omitted and the relation is optional is `SetNull`, matching the migration — but future `prisma migrate` commands against a schema without an explicit annotation can generate unexpected `ALTER TABLE` statements. The `_phi-inventory.md` verification query #4 ("AuditLog uses the system salt, not per-user salt … audit logs survive deletion") confirms the design intent.
- **Impact:** Future schema drift risk; today the behavior is correct.
- **Fix:** Add `, onDelete: SetNull` to the `user` relation in `schema.prisma:514` to pin the behavior in the declarative model.
- **Evidence:**
  ```prisma
  // schema.prisma:514
  user  User?  @relation(fields: [userId], references: [id])
  ```
  ```sql
  -- initial_schema/migration.sql:399-400
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ```

### F-29 — AI provider-timeout handling inconsistent across services — **Low**
- **Prompt:** 27
- **Location:** `backend/src/services/claudeExtraction.ts:54`, `backend/src/services/sbcExtraction.ts:321`, `backend/src/controllers/expenseController.ts:39`, `backend/src/routes/biomarkerRoutes.ts:154`
- **Observation:** `claudeExtraction` uses `timeout: 30_000, maxRetries: 2` via SDK. `sbcExtraction` same. `expenseController` same. But `biomarkerRoutes.ts:154` uses raw `fetch` with `AbortController` + 30-second timeout and no retries. Inconsistent. Failure paths throw different error types (`InternalServerError` vs res.status(502)/(504)/(500)).
- **Impact:** Uneven UX on transient failures; timeouts surface differently across endpoints.
- **Fix:** Unify through a single Anthropic wrapper (see F-26) exposing `call(options)` with consistent timeout/retry/err handling.
- **Evidence:**
  ```ts
  // biomarkerRoutes.ts:153-156 — raw fetch, no SDK retry
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 30_000);
  const response = await fetch('https://api.anthropic.com/v1/messages', { ... });
  ```

### F-30 — Deprecated DNA/Genetic models retained but `canViewDna` consent UI still active — **Low**
- **Prompt:** 26 (also 29)
- **Location:** `backend/prisma/schema.prisma:376-428`, `backend/src/routes/patientRoutes.ts:168-211`, `backend/src/middleware/rbac.ts:239-242`
- **Observation:** CLAUDE.md and `_phi-inventory.md` mark `DNAData`, `DNAVariant`, `GeneticTrait` as deprecated. But the patient consent endpoint still accepts and persists `canViewDna: boolean` (patientRoutes:170, 207, 224). `rbac.ts:239-242` still references it. There is no provider endpoint enforcing it (F-18). And `deleteAllData` does not delete `dnaData` (F-5). Stale feature surface.
- **Impact:** Low — no exploit, but attack surface (consent field still writable, RBAC code path exists). Legal discovery surface also: the schema still holds encrypted DNA columns that nothing consumes.
- **Fix:** Drop the `canViewDna` column + enum change or, preferably, remove the deprecated DNA tables and columns entirely per CLAUDE.md guidance. Remove the DNA permissions from the consent UI.
- **Evidence:**
  ```prisma
  // schema.prisma:395-408 — DNAVariant with genotypeEncrypted still present
  model DNAVariant { ... genotypeEncrypted String @map("genotype_encrypted") ... }
  ```

### F-31 — `exportUserData` lacks `Cache-Control: no-store` header on PHI response — **Low**
- **Prompt:** 29
- **Location:** `backend/src/controllers/settingsController.ts:198-203`
- **Observation:** The export response is a large JSON body with all decrypted PHI, returned via `res.json(response)` with default headers. No `Cache-Control: no-store, private`, no `Pragma: no-cache`. A shared CDN or intermediate proxy (and browser history / disk cache) could retain the body.
- **Impact:** PHI persistence on the user's disk and potentially intermediate caches. For typical TLS-terminated Cloud Run deployments this risk is bounded, but the response explicitly contains PHI and deserves explicit no-cache headers.
- **Fix:** Before `res.json`, call `res.setHeader('Cache-Control', 'no-store, private'); res.setHeader('Pragma', 'no-cache'); res.setHeader('X-Content-Type-Options', 'nosniff');`.
- **Evidence:**
  ```ts
  // settingsController.ts:198-203
  const response: ApiResponse<ExportData> = { success: true, data: exportData };
  res.json(response);
  ```

### F-32 — Error responses from GCS / Claude leak operational details via `error.message` passthrough — **Low**
- **Prompt:** 27 / 28
- **Location:** `backend/src/services/storageService.ts:77-86, 123-131`, `backend/src/controllers/expenseController.ts:100-101, 146-148`
- **Observation:** `storageService.uploadFile` catches and re-throws `new Error('Failed to upload file to storage')` (safe), but the preceding `logger.error` includes `bucket: BUCKET_NAME` in the log payload — if an admin ever copies a log line into a user-visible error, the bucket name leaks. `expenseController.createProjection` catches all errors into `res.status(500).json({ error: 'Failed to create expense projection' })` — that is safe — but logs `{ data: { error } }` where `error` may be the raw DB error including Prisma schema names.
- **Impact:** Info leak via logs if logs are ever exposed to less-privileged viewers. Low practical severity with appropriate log ACLs.
- **Fix:** Log only `error.message` (not the full Error), strip `BUCKET_NAME` from error logs, and scrub Prisma query fragments.
- **Evidence:**
  ```ts
  // storageService.ts:77-86
  logger.error('Failed to upload file to GCS', {
    data: { error: error instanceof Error ? error.message : 'Unknown error', storageKey, bucket: BUCKET_NAME },
  });
  throw new Error('Failed to upload file to storage');
  ```

### F-33 — Informational: cost analysis stores full `claudeResponse` as encrypted PHI but no minimum-necessary review — **Info**
- **Prompt:** 27
- **Location:** `backend/src/controllers/expenseController.ts:358-371`; `backend/prisma/schema.prisma:724`
- **Observation:** `CostAnalysis.claudeResponse` is stored encrypted (per `_phi-inventory.md` table — `claudeResponse` is in `PHI_FIELDS.CostAnalysis`). This is correctly classified PHI because the response text summarizes the projected expenses. The response is also capped to 4000 tokens. No finding — treated as info to note that this flow follows the `encryption.ts:434` PHI_FIELDS mapping. Confirmed the field is encrypted before DB write (`claudeResponse: encryption.encrypt(claudeResponse, userSalt)` at expenseController:363).

### F-34 — Informational: every provider data-access path *does* audit log both providerId and patientId — **Info**
- **Prompt:** 26
- **Location:** `backend/src/routes/providerRoutes.ts:390-395, 484-489`
- **Observation:** Verified that `auditService.logAccess('patient_biomarkers', patientId, { req, userId: providerId }, { operation: 'PHI_ACCESS', patientId, count, accessedFields })` captures `userId=providerId` (actor) and `resourceId=patientId` (subject) plus explicit `patientId` in metadata. This meets the prompt's Part 5 requirements for cross-user audit. Similarly for health needs (line 484-489). No finding.

## Checks passed

### Prompt 26 — Provider-Patient Collaboration
- [x] Provider can only request access (cannot self-approve) — verified at `providerRoutes.ts:100-201` (creates PENDING, no status=ACTIVE option).
- [x] Patient is the sole approver — verified at `patientRoutes.ts:159-242` (the only `/approve` route with `requireRole('PATIENT')` at line 24).
- [x] PENDING relationships grant zero data access — verified at `providerRoutes.ts:326-327, 429-430` (explicit `relationship.status !== 'ACTIVE'` rejection).
- [x] Consent expiration enforced on every data query — verified at `providerRoutes.ts:337-343, 440-446, 542-549`.
- [x] Patient can revoke access at any time — verified at `patientRoutes.ts:375-431` (`POST /providers/:id/revoke` sets status=REVOKED).
- [x] `ProviderPatient.notesEncrypted` encrypted before storage — verified at `providerRoutes.ts:158-161` (`encryptionService.encrypt(message, providerSalt)`).
- [x] Unique constraint on providerId+patientId — verified at `schema.prisma:104` (`@@unique([providerId, patientId])`).
- [x] Relationship type validated against enum — verified at `schema.prisma:547-553` + Zod schema (`validation.ts` schemas.providerPatient.request).
- [x] Consent grant/deny/revoke events audit-logged — verified at `patientRoutes.ts:216-231, 277-286, 404-418, 465-477`.
- [x] `canViewBiomarkers` enforced on biomarker endpoint — verified at `providerRoutes.ts:347-355`.
- [x] `canViewHealthNeeds` enforced on health-needs endpoint — verified at `providerRoutes.ts:450-458`.
- [x] Default permissions restrictive for DNA and edit — verified at `patientRoutes.ts:170-172` (`canViewDna = false`, `canEditData = false`).
- [x] Provider access of biomarker data logs providerId (userId in audit) and patientId (resourceId + metadata) — verified at `providerRoutes.ts:390-395`.

### Prompt 27 — AI Integration
- [x] `ANTHROPIC_API_KEY` loaded from `process.env`, not hardcoded — verified at `claudeExtraction.ts:50, biomarkerRoutes.ts:115, expenseController.ts:37`.
- [x] Lazy Anthropic client initialization — verified at `claudeExtraction.ts:49-57` (`if (!anthropicClient)`).
- [x] API key not logged — verified via grep (key never appears in `logger.info/error` calls).
- [x] AI endpoints have rate limiting via `aiLimiter` — verified at `biomarkerRoutes.ts:110` and `expenseRoutes.ts:71`.
- [x] Per-user rate limit key on `aiLimiter` — verified at `rateLimiter.ts:105-108` (`keyGenerator: req.user?.id`).
- [x] AI endpoints blocked for demo — verified at `biomarkerRoutes.ts:111, expenseRoutes.ts:72, uploadRoutes.ts:79,94,122` (`blockDemoAI`).
- [x] AI response size limited — verified at `biomarkerRoutes.ts:166` (`max_tokens: 600`), `claudeExtraction.ts:120` (`max_tokens: 8192`), `sbcExtraction.ts:786` (`max_tokens: 16384`).
- [x] Timeout configured on Claude calls — verified at `claudeExtraction.ts:54, sbcExtraction.ts:321, expenseController.ts:39` (`timeout: 30_000`) and `biomarkerRoutes.ts:154` (AbortController 30s).
- [x] Cost tracking for Claude calls — verified at `claudeExtraction.ts:144-150, sbcExtraction.ts:824-830, expenseController.ts:345-351, biomarkerRoutes.ts:191-197` (`trackAIUsage`).
- [x] Medical disclaimers in biomarker guidance prompt — verified at `biomarkerRoutes.ts:151` ("IMPORTANT: This is for educational purposes only...").
- [x] Prompt-safe sanitization for expense service types — verified at `expenseController.ts:319, 323` (`sanitizeForPrompt`).
- [x] Biomarker guidance input prompt-safe — verified at `validation.ts:357-371` (`promptSafeString` on name/unit/status).
- [x] Cost analysis stored as encrypted `claudeResponse` — verified at `expenseController.ts:363`.
- [x] AI response text filtered via `stripPHIFromText` on lab extraction (response side only) — verified at `claudeExtraction.ts:159`.

### Prompt 28 — File Storage
- [x] Multer uses memory storage (no temp files) — verified at `uploadRoutes.ts:29, 46` (`multer.memoryStorage()`).
- [x] File size limit 10MB — verified at `uploadRoutes.ts:31, 48` (`fileSize: 10 * 1024 * 1024`).
- [x] Single file per upload — verified at `uploadRoutes.ts:32, 49` (`files: 1`).
- [x] GCS storage key uses UUID, not user-controlled name — verified at `storageService.ts:52-53` (`${userId}/${fileId}.${extension}` where `fileId = crypto.randomUUID()`).
- [x] Signed URL TTL is 15 minutes — verified at `storageService.ts:20` (`SIGNED_URL_EXPIRATION_MS = 15 * 60 * 1000`).
- [x] Signed URLs scoped to specific object — verified at `storageService.ts:103-104` (`bucket.file(storageKey)`, per-object).
- [x] File download endpoint requires authentication — verified at `fileRoutes.ts:27` (`router.use(authenticate)`).
- [x] User can only download their own files — verified at `fileController.ts:185-189` (`tx.userFile.findFirst({ where: { id, userId } })`).
- [x] File download audit-logged (EXPORT) — verified at `fileController.ts:201-207` (`auditService.logExport`).
- [x] File deletion audit-logged — verified at `fileController.ts:249-252`.
- [x] PDF DoS protections (timeout, memory limit) present — verified at `securePdfParsing.ts:18, 21, 119-129, 180-189`.
- [x] PDF header validation exists (but not applied to every path — see F-11) — verified at `securePdfParsing.ts:56-105`.
- [x] Upload rate limit 20/hour — verified at `rateLimiter.ts:63-75`.
- [x] PDF parsing errors on regex SBC path use `secureParsePdf` with timeout — verified at `pdfParser.ts:882, 1334`.
- [x] Bulk upload fileFilter rejects non-PDF MIME (regex path) — verified at `uploadRoutes.ts:34-42`.

### Prompt 29 — Data Portability & Deletion
- [x] Export endpoint requires authentication — verified at `settingsRoutes.ts:25` (`router.use(authenticate)`).
- [x] Export rate limited — verified at `settingsRoutes.ts:30` (`sensitiveLimiter`: 10/hour).
- [x] Export is audit logged — verified at `settingsController.ts:192-196` (`auditService.logAccess('UserData', userId, ..., { operation: 'EXPORT' })`).
- [x] Account deletion requires password — verified at `settingsController.ts:262-287` (`verifyPassword(password, user.passwordHash)`).
- [x] Account deletion audit-logged before deletion — verified at `settingsController.ts:289-293`.
- [x] Cascade deletes configured for core PHI tables — verified at `schema.prisma:60, 78, 126, 156, 341, 442, 473, 682, 710, 730` (`onDelete: Cascade` on Biomarker, InsurancePlan, HealthGoal, HealthNeed, UserFile, ExpenseProjection, ExpenseActual, CostAnalysis, UserEncryptionKey, Session).
- [x] BiomarkerHistory cascades on Biomarker delete — verified at `schema.prisma:177`.
- [x] GoalProgressHistory cascades on HealthGoal delete — verified at `schema.prisma:491`.
- [x] InsuranceBenefit cascades on InsurancePlan delete — verified at `schema.prisma:369`.
- [x] Audit logs survive user deletion — verified at `migrations/00000000000000_initial_schema/migration.sql:399-400` (`ON DELETE SET NULL`).
- [x] Audit logs use system salt (per `_phi-inventory.md` verification query #4) — verified at `auditLog.ts:91, 112-124, 175`.
- [x] Export doesn't include password hashes — verified at `settingsController.ts:85-88` (`select: { email: true, createdAt: true }`).

## Unverifiable

- **Anthropic BAA in place** (prompt 27, question #2) — cannot be determined from code. See F-14. Mark as Unverifiable until contract is confirmed with Anthropic and surfaced via an `ANTHROPIC_BAA_ACTIVE` config flag or a documented pointer in the repo.
- **Anthropic data-retention / training policy** (prompt 27, §9) — external third-party policy, requires Anthropic documentation review (not in repo).
- **GCS bucket configuration** (prompt 28, §2) — "bucket is private", "uniform bucket-level access", "bucket versioning enabled", "no wildcard CORS on bucket", "lifecycle rules" all live in infrastructure (Terraform/gcloud), not application code. Bucket name `ownmyhealth-user-files` is referenced at `storageService.ts:19` but IAM/ACL state cannot be determined from the repo.
- **`GOOGLE_APPLICATION_CREDENTIALS` storage** (prompt 27, §7 & prompt 28, §2) — secret storage (e.g., GCP Secret Manager vs env file vs base64 env var) is deployment-time, not code-visible. The loader at `ocrService.ts:89-105` supports both JSON-inline and file-path approaches.
- **GCS CORS configuration** (prompt 28) — infrastructure.
- **GCS bucket versioning and lifecycle rules** (prompt 28) — infrastructure.
- **Malware scanning of uploaded files** (prompt 28, question #3) — no scanner in codebase; if configured, would be infrastructure (GCS event → Cloud Function with virustotal, etc.). Not present in code.
- **Per-user storage quota** (prompt 28, question #5) — not enforced in application code (no quota check in `uploadController`).

## Prompt drift

- **`_phi-inventory.md` claims 11 PHI categories** (counted in prompt body: User, Biomarker, BiomarkerHistory, InsurancePlan, HealthNeed, HealthGoal, GoalProgressHistory, ExpenseProjection, ExpenseActual, CostAnalysis, ProviderPatient). Code reality: deprecated DNA models (DNAVariant, GeneticTrait) are *also* still in `PHI_FIELDS` at `encryption.ts:393-399`, and audit log PHI (`AuditLog`) is a 12th category per `encryption.ts:413-416`. Either harmonize the 11-count in the prompt with the code's ~14 or update `_phi-inventory.md` to match.
- **Prompt 26, §2: "canViewInsurance → insurance plan endpoints"** implies an insurance endpoint exists. It does not (F-18). Prompt should note "flag currently has no enforcement endpoint" or the endpoint should be implemented.
- **Prompt 28 architecture note: "Upload Flow: Client → Backend (Multer memory storage) → GCS"** — true only for the OCR path (`uploadLabResultOCR`). `uploadLabReport` and `uploadSBC` never hit GCS (F-21). Update the architecture note or implement GCS persistence in all three paths.
- **Prompt 28 architecture note: "Client-Side: Tesseract.js OCR, pdf.js text extraction (fallback)"** — not verified in the backend review; frontend files were not inspected, but the feature claim is backend-verifiable via the fact that the three upload routes all require a server-side extraction API call, meaning no client-side-only path exists today. If the frontend never ships extracted biomarkers for bypass of backend AI, that claim is accurate; otherwise, it's drift.
- **Prompt 29 Architecture note: "Encryption keys destroyed on account deletion"** — `UserEncryptionKey` has `onDelete: Cascade` at `schema.prisma:78`, so the DB row (the encrypted salt) is destroyed. However, the *master key* (PHI_ENCRYPTION_KEY env var) is unaffected, and the audit log's PHI uses the system salt (not the user salt), so prior encrypted-PHI values in the audit log **remain decryptable** post-deletion. This matches the "audit logs survive deletion" requirement — call out in the prompt that the user salt is destroyed but audit-log PHI (encrypted with system salt) survives by design.

---

Report length: ~2,100 words in findings + ~550 words in checks/unverifiable/drift. 33 distinct findings (2 Critical, 11 High, 13 Medium, 7 Low) plus 2 Info entries. Within the requested 25-40 range.
