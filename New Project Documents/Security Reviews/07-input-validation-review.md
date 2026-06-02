# 07-input-validation Review — 2026-06-01

Scope: input validation across `backend/src/middleware/validation.ts`, the 18 route files, 12 controllers, `controllers/upload/shared.ts`, `services/fhir/urlSafety.ts` + `smartAuth.ts`, and `utils/securePdfParsing.ts`. Reviewed against the checklist in `prompts/07-input-validation.md` under the discipline of `prompts/_review-protocol.md`.

Overall the validation layer is in strong shape: a single Zod `schemas` object backs nearly every mutating/param route, custom validators match the spec, file uploads enforce magic-byte re-checks beyond MIME, the FHIR SSRF guard is real and wired to every outbound endpoint, and the PDF bomb/header sandbox runs before pdf-parse/Claude. Findings below are all gaps at the margins (Low/Info), not exploitable PHI-disclosure paths.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 4 |
| Info | 2 |

## Findings

### F-1 — Admin `PATCH /provider-relationships/:id` body is not Zod-validated — **Medium**
- **Location:** `backend/src/routes/adminRoutes.ts:693`–`721`
- **Observation:** The route validates only the `:id` param (`validate(schemas.uuidParam, 'params')`) and then reads `status, canViewBiomarkers, canViewInsurance, canViewHealthNeeds, canEditData` straight off `req.body` into a Prisma `update`. There is no body schema, no enum allowlist for `status`, and no boolean type-check for the permission fields. `status` flows into `data: { status }` for a column typed as the Prisma enum `ProviderPatientStatus` (`schema.prisma:103`, `:515`).
- **Impact:** A malformed/garbage `status` (or a non-boolean permission value) is caught only at the database layer, surfacing as a Prisma validation error / 500 rather than a clean field-level 400. No injection (Prisma parameterizes; enum is rejected by the generated client), and the route is ADMIN-only (`requireRole('ADMIN')` + `blockDemoAdminAccess` at `adminRoutes.ts:29`–`31`), so blast radius is small — but it is the one mutating route on an authenticated surface that does not enforce a request-body schema, contradicting the project rule "Validate all input at API boundaries." It also means an admin can silently send a body shape no validator ever sanitized.
- **Fix:** Add a Zod body schema (e.g. `schemas.providerPatient.adminUpdate`) with `status: z.enum([...ProviderPatientStatus]).optional()` and `canView*/canEditData: z.boolean().optional()`, and wire `validate(thatSchema)` on the route after the param validator, mirroring `patientRoutes.ts:328`–`331`.
- **Evidence:**
  ```ts
  router.patch(
    '/provider-relationships/:id',
    validate(schemas.uuidParam, 'params'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const { status, canViewBiomarkers, canViewInsurance, canViewHealthNeeds, canEditData } = req.body;
  ```

### F-2 — `dateString` validator accepts any `Date`-parseable string, not strict ISO 8601 — **Low**
- **Location:** `backend/src/middleware/validation.ts:128`–`132`
- **Observation:** The shared `dateString` validator only checks `!isNaN(new Date(val).getTime())`. JS `Date` parsing is permissive: `"2026"`, `"Jan 1 2020"`, `"2026/13/40"`-style coercions, and locale strings all pass. The spec checklist §5 asks for "ISO 8601 format enforced" and "Future/past date limits where appropriate"; neither is enforced. This validator backs `biomarker.date`, `insurancePlan.effectiveDate/terminationDate`, expense `serviceDate`, goal `startDate/targetDate`, and admin `auditLogQuery.startDate/endDate`.
- **Impact:** Non-canonical date strings reach controllers and get re-parsed by `new Date(...)`, risking timezone-dependent off-by-one storage and inconsistent display. No injection (values are bound, not interpolated). Audit-log date filters accept loose input that may silently produce an empty or wrong range. Data-integrity / hygiene issue, not a disclosure path.
- **Fix:** Tighten `dateString` to `z.string().regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, ...)` plus the existing `Date` validity refine, or use `z.string().date()` / `z.string().datetime()` from Zod where a full timestamp is wanted. Add `.refine` future/past bounds on fields where it matters (e.g. `diagnosedYear` already does this at `validation.ts:723`).
- **Evidence:**
  ```ts
  const dateString = z.string()
    .refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format');
  ```

### F-3 — Admin audit-log filter strings (`action`, `resourceType`) are unbounded — **Low**
- **Location:** `backend/src/middleware/validation.ts:771`–`779` (`schemas.admin.auditLogQuery`)
- **Observation:** `action: z.string().optional()` and `resourceType: z.string().optional()` carry no `.max()` length cap, unlike `listUsersQuery.search` which is capped at 100 (`validation.ts:768`). They flow into Prisma `where` equality filters at `adminRoutes.ts:882`–`884`.
- **Impact:** An admin can submit arbitrarily large filter strings. Parameterized so no injection, and ADMIN-only so low blast radius, but it is an unbounded-input gap on a query parameter (checklist §6 "Query parameters typed and bounded").
- **Fix:** Add `.max(100)` to `action` and `resourceType` in `auditLogQuery`, matching the `search` field cap.
- **Evidence:**
  ```ts
  auditLogQuery: z.object({
    userId: uuid.optional(),
    action: z.string().optional(),
    resourceType: z.string().optional(),
  ```

### F-4 — `biomarker.update` / batch / insurance `update` use bare `z.number()` (no `finiteNumber`) for numeric fields — **Low**
- **Location:** `backend/src/middleware/validation.ts:322` (`value: z.number().min(0).optional()`), `:337`–`347` (batch `value`, `normalRange.min/max`), `:438`–`453` (insurance `update.*` monetary fields), `:418`–`421` (`outNetworkCoverage` copay/coinsurance in `create`)
- **Observation:** The `create` schemas correctly pipe through `finiteNumber` (rejects `NaN`/`Infinity`, `validation.ts:67`), but the corresponding `update` paths, the `batchCreate` per-item numbers, and the nested `outNetworkCoverage` block in `create` use plain `z.number()...`. `z.number()` accepts `Infinity` and `-Infinity` (it rejects only `NaN` by default). The spec checklist §4 requires "No NaN or Infinity accepted" and §9 notes monetary fields should use `finiteNumber.pipe(min(0))`.
- **Impact:** A PATCH to a biomarker or insurance plan, or a batch create item, can set a numeric value to `Infinity`. For biomarker `value` and `normalRange` this corrupts the in-range computation and downstream charts; for insurance monetary fields it can poison cost-analysis math. Stored as encrypted strings/Decimal, no injection, owner-scoped — integrity bug, not disclosure.
- **Fix:** Replace the bare `z.number()` calls in the `update` schemas, `batchCreate` items, and the `outNetworkCoverage` sub-object with `finiteNumber.pipe(z.number().min(0)...)`, mirroring the `create` schemas in the same file.
- **Evidence:**
  ```ts
  // biomarker.update
  value: z.number().min(0).optional(),
  // insurancePlan.update
  premium: z.number().min(0).optional(),
  deductible: z.number().min(0).optional(),
  ```

### F-5 — Two multer instances duplicated; OCR `fileFilter` allows TIFF/GIF/WEBP but user message omits them (prompt/UX drift, not a hole) — **Low** (Prompt drift)
- **Location:** `backend/src/routes/uploadRoutes.ts:52`–`67`; error string at `:65`
- **Observation:** The OCR `fileFilter` allowlist (`uploadRoutes.ts:54`–`61`) accepts `application/pdf, image/png, image/jpeg, image/tiff, image/gif, image/webp` — which matches `SUPPORTED_MIME_TYPES.ocr` in `shared.ts:57` and the `MAGIC_BYTES` table (`shared.ts:71`–`81`). The rejection message at `:65` only says "PDF and image files (PNG, JPG, TIFF)", omitting GIF/WEBP. Separately, the SBC multer config is duplicated verbatim in both `uploadRoutes.ts:29`–`43` and `insuranceRoutes.ts:38`–`51`. The spec §2 expectation ("PDF + PNG/JPEG/TIFF/GIF/WEBP for `/lab-results-ocr`") matches the *filter*; only the human-readable string drifts.
- **Impact:** None to security — the allowlist and magic-byte table are consistent and complete (GIF/WEBP are covered by `MAGIC_BYTES`, so a spoofed-MIME GIF/WEBP is still content-validated). Pure messaging/DRY drift; flagged per protocol "when the prompt/strings disagree with the code."
- **Fix:** Update the message at `uploadRoutes.ts:65` to include GIF/WEBP, and factor the repeated multer config into a shared helper to prevent the two copies diverging.
- **Evidence:**
  ```ts
  const allowedTypes = ['application/pdf','image/png','image/jpeg','image/tiff','image/gif','image/webp'];
  ...
  cb(new BadRequestError('Only PDF and image files (PNG, JPG, TIFF) are accepted'));
  ```

### F-6 — `bulkCreateHealthNeeds` reads `req.body.needs` with no Zod validation (dead code) — **Info**
- **Location:** `backend/src/controllers/healthNeedsController.ts:525`–`563`
- **Observation:** `bulkCreateHealthNeeds` destructures `req.body.needs` (untyped objects with `needType`/`urgency` cast straight to enum unions) and writes each to the DB with no schema, length cap, or array bound. However, a repo-wide search shows it is **not wired to any route** — `healthNeedsRoutes.ts` exposes only get/create/update/delete/analyze/summary, and the only reference to `bulkCreateHealthNeeds` is its own definition.
- **Impact:** None today — unreachable from the HTTP surface. Worth noting because if it is ever wired up it would bypass the validation discipline used everywhere else (unbounded array, `as` casts past the enum check). Informational, not a live finding.
- **Fix:** Either delete the dead function or, if it will be exposed, add a `schemas.healthNeed.bulkCreate` with `z.array(...).max(N)` and enum-validated `needType`/`urgency`, and validate it on the route.
- **Evidence:**
  ```ts
  const { needs } = req.body as { needs: { needType: string; ... }[] };
  ...
  needType: need.needType as 'CONDITION' | 'ACTION' | 'SERVICE' | 'FOLLOW_UP',
  ```

### F-7 — Transitive moderate-severity dependency advisories (out of input-validation path) — **Info**
- **Location:** `backend/package.json` (`@google-cloud/storage` → bundled `uuid <11.1.1`; `prisma`/`@prisma/dev` → `@hono/node-server <1.19.13`)
- **Observation:** `npm audit --omit=dev` reports 8 moderate advisories, all transitive: GHSA-w5hq-g745-h8pq (uuid buffer bounds check, only triggers for v3/v5/v6 when a `buf` arg is supplied — not how this code calls uuid) and GHSA-92pp-h63x-v22m (Hono serveStatic slash bypass, inside Prisma dev tooling not the runtime request path).
- **Impact:** Neither advisory sits in the user-input/validation path. Listed for completeness because the protocol's Medium rubric cites "outdated dependency with known CVE"; these do not rise to Medium given they are not reachable from validated input.
- **Fix:** Track for a dependency-bump task; `npm audit fix --force` proposes breaking major bumps (prisma 6.x, uuid 14) and should be handled outside an input-validation change. Keep the deliberate `pdf-parse@1.1.1` pin (the pdf-parse-v2 trap noted in project memory).
- **Evidence:** `npm audit` output: `uuid <11.1.1 Severity: moderate ... node_modules/@google-cloud/storage/node_modules/uuid` and `@hono/node-server <1.19.13 Severity: moderate`.

## Checks passed

### 1. UUID Validation
- [x] `:id` / `:connectionId` / `:patientId` / `:userId` params validated as UUID before the DB query — `validate(schemas.uuidParam, 'params')` and friends on every param route (e.g. `biomarkerRoutes.ts:71`, `fileRoutes.ts:54`, `fhirRoutes.ts:44`/`:55`, `providerRoutes.ts:294`, `adminRoutes.ts:132`). UUID validator at `validation.ts:112` (`z.string().uuid(...)`).
- [x] Validation runs before the handler (middleware order) → invalid UUID returns a 400 `ValidationError` via `validate`'s catch (`validation.ts:170`–`172`), not a 500.
- [x] No SQL injection via malformed UUID — Prisma parameterizes, and the UUID shape is enforced pre-query.

### 2. File Upload Validation
- [x] Multer `limits.fileSize = 10MB` and `files: 1` — `uploadRoutes.ts:31`–`33`, `:48`–`50`; `insuranceRoutes.ts:41`–`42`.
- [x] Multer `fileFilter` rejects non-allowed MIME at the boundary (PDF-only for lab-report/SBC; PDF+images for OCR) — `uploadRoutes.ts:35`–`42`, `:52`–`67`.
- [x] `validateUploadFile()` re-checks content with `validateMagicBytes` (multer only trusts the Content-Type header) — `shared.ts:143`, called at `labUploadController.ts:43`/`:198` and `sbcUploadController.ts:40`/`:232`.
- [x] `MAGIC_BYTES` table covers every accepted MIME (PDF, PNG, JPEG, GIF, TIFF BE/LE, WEBP/RIFF) — `shared.ts:71`–`81`.
- [x] `sanitizeFilename()` takes `path.basename`, strips control + path-sep + quote chars, caps 255, and mutates `file.originalname` so all downstream consumers get the safe value — `shared.ts:107`–`113`, `:149`.
- [x] PDF header + bomb/timeout guards applied before pdf-parse/Claude — `validatePdfHeader` at upload entry (`labUploadController.ts:44`, `sbcUploadController.ts:41`/`:233`) and `secureParsePdf` (30s timeout, 100MB memory guard, compression-ratio check) at `securePdfParsing.ts:149`, invoked in `pdfParser.ts:892`/`:1344` and `pdfTextExtraction.ts:46`.

### 3. String Input Validation
- [x] Max-length caps on text fields — `sanitizedString(min,max)` / `optionalSanitizedString(max)` used throughout (`validation.ts:72`–`85`); examples at `validation.ts:303`, `:464`–`471`.
- [x] HTML special chars escaped on free-text — `sanitizeString` escapes `& < > " '` (`validation.ts:40`–`48`), applied via the `sanitizedString` transform.
- [x] SQL special chars handled by ORM — all DB writes go through Prisma (parameterized); no raw string interpolation into queries found in controllers.

### 4. Numeric Input Validation
- [x] `finiteNumber` rejects `NaN`/`Infinity` and is used on create/monetary fields — `validation.ts:67`, applied at `:304`, `:391`–`406`, `:578`–`649`. (Gaps on the *update*/batch paths are F-4.)
- [x] Range bounds present — `min(0)` on values/monetary, `max(999999.99)` on expense amounts (`validation.ts:578`,`:613`–`649`), `max(100)` on coinsurance rates (`:406`,`:415`), `frequencyPerYear` int 1–365 (`:579`).
- [x] Integer distinction — `z.number().int()` on `frequencyPerYear` (`:579`), `diagnosedYear` (`:723`).

### 6. API Parameter Validation
- [x] Pagination clamped to max page size — every `listQuery`/pagination schema clamps `limit` to `min 1, max 100` (audit logs max 200) via `Math.min(Math.max(...))` transforms (`validation.ts:227`–`228`, `:356`–`357`, `:777`–`778`); controller reads also re-clamp defensively (`fileController.ts:51`–`52`, `expenseController.ts:131`–`132`, etc.).
- [x] Sort/filter from enums where applicable — `listUsersQuery.role`, `healthNeed.listQuery.status/urgency/needType`, `healthGoal.listQuery.status/category` are all `z.enum(...)` (`validation.ts:484`–`486`, `:537`–`538`, `:764`).

### 7. Path Traversal Prevention
- [x] User filename never used as a storage key — `sanitizeFilename` strips `../` and separators (`shared.ts:111`); storage keys are generated server-side, and `Content-Disposition` echoes the sanitized name only.
- [x] No user input interpolated into filesystem paths in the upload/file controllers (memory storage; GCS keys generated).

### 8. Zod Schema Usage
- [x] Custom validators present and used: `email` (RFC + lowercase/trim, `validation.ts:104`), `uuid` (`:112`), `strongPassword` (12+, upper/lower/number/special, `:117`–`123`), `dateString` (`:128`), `finiteNumber` (`:67`), `sanitizedString`/`optionalSanitizedString` (`:72`,`:81`), `promptSafeString` (`:91`).
- [x] DNA `rsid` validator absent (correctly removed) — no `rsid` hits in `validation.ts`; consistent with `_phi-inventory.md` DNA/Genetics drop.
- [x] `z.infer<T>` used for type safety — `validation.ts:800`–`810`.
- [x] Validation errors return field-level messages — `zodIssueToDetail` maps each issue to `{field, message, code}` (`validation.ts:24`–`30`, `:171`).

### 9. Domain-Specific Validation
- [x] Biomarker create: `finiteNumber + min(0)`, `sourceType` enum (MANUAL/LAB_UPLOAD/EHR_IMPORT/DEVICE_SYNC/API_IMPORT), batch capped 100 — `validation.ts:304`,`:314`,`:351`.
- [x] Insurance: `planType` enum (HMO/PPO/EPO/POS/HDHP) `:385`; monetary `finiteNumber.pipe(min(0))` `:391`–`405`; coinsurance `min(0).max(100)` `:406`.
- [x] Health need: `needType`/`urgency`/`status` enums `:464`–`477`. Health goal: `category`/`direction`/`status`/`reminderFrequency` enums `:500`–`528`.
- [x] Provider relationship type enum + consent booleans + `consentDurationDays` 1–365 — `:551`–`560`.
- [x] Expense: `min(0)`/`positive()` + `max(999999.99)`, `frequencyPerYear` int 1–365, `claimStatus` enum — `:578`–`649`.
- [x] Admin: `role` enum (PATIENT/PROVIDER/ADMIN) `:751`/`:757`, `updateUserPlan.plan` enum (FREE/PRO/TEAM) `:783`.
- [x] Settings health profile: `biologicalSex`/`ageRange`/`smokingStatus`/`exerciseLevel` enums, array caps (conditions ≤20, medications ≤30, familyHistory ≤10) — `:716`–`739`.

### 10. AI / LLM Input Validation
- [x] `ai.chat` bounds `message` ≤2000 and `conversationHistory` ≤20 turns, content ≤5000, role enum — `validation.ts:657`–`668`.
- [x] Free-text interpolated into Claude prompts goes through `promptSafeString`/`sanitizeForPrompt` (control-char strip, newline collapse, 200-char cap) — `validation.ts:55`–`61`,`:91`; `biomarker.guidance` uses `promptSafeString` (`:362`,`:364`,`:369`); guidance handler re-sanitizes name/unit (`biomarkerRoutes.ts:184`–`185`); chat handler sanitizes message + each history turn (`aiChatController.ts:169`–`175`).
- [x] AI route uses `requireBearerAuth` + `aiSpendGuard` + `requirePlanLimit('aiChatsPerDay')` and is the only CSRF-exempt streaming path, kept bearer-only — `aiRoutes.ts:21`,`:31`–`36`; CSRF exemption list `csrf.ts:116`–`118`.

### 11. FHIR / OAuth Callback & SSRF
- [x] `/fhir/callback` (unauthenticated GET) returns 400 on missing `code`/`state` — `fhirController.ts:86`–`89`; PKCE S256 + 24-byte random state + 10-min TTL bind to user — `smartAuth.ts:78`–`83`,`:317`,`:326`–`345`.
- [x] FHIR param routes validate via `schemas.connectionIdParam` / `schemas.uuidParam` before DB — `fhirRoutes.ts:44`,`:55`.
- [x] Outbound FHIR URLs (pagination `link`, SMART discovery, token/refresh/revoke) pass `assertAllowedFhirUrl` / `isPrivateOrLoopbackHost` so credentials can't reach attacker/internal hosts incl. 169.254.169.254 — `urlSafety.ts:20`–`91`; wired at `fhirClient.ts:38`, `smartAuth.ts:45`,`:119`,`:123`,`:167`,`:211`,`:289`.

### 12. New-Route Validation Coverage
- [x] `onboardingRoutes.ts` `/status` + `/complete` take no body; userId comes from the JWT, nothing untrusted is trusted — `onboardingRoutes.ts:22`–`43`.
- [x] `planRoutes.ts` `/` and `/available` are read-only with no params/body — `planRoutes.ts:32`,`:52`.
- [x] `internalRoutes.ts` authenticates via constant-time `X-Cleanup-Token` compare and 404s when the secret is unset — `internalRoutes.ts:27`–`62`.
- [x] `settingsRoutes.ts` `updateProfile`/`updateNotifications`/`updateHealthProfile`/`deleteData`/`deleteAccount` all Zod-validated — `settingsRoutes.ts:45`,`:61`,`:81`,`:102`,`:111`.
- [x] `authRoutes.ts` `/change-email` (`schemas.auth.changeEmail`) and `/confirm-email-change` (`schemas.auth.confirmEmailChangeQuery`, `'query'`) validated — `authRoutes.ts:131`,`:99`.

## Unverifiable
- Virus scanning of uploads (checklist §2, "optional but recommended") — no AV/ClamAV integration found anywhere in `backend/src`; consistent with it being optional. Not implemented (correctly noted as optional), so nothing to verify rather than a confirmed gap.
- §5 "Timezone handling consistent" — date fields are stored via Prisma `@db.Date`/`@db.Timestamptz`, but end-to-end timezone normalization is a runtime/behavioral property not provable from static validation review; related looseness captured in F-2.

## Out of scope
- CSRF enforcement on mutation routes — present globally (`app.ts:216`) and covered by the dedicated CSRF prompt; only noted here where it intersects the AI streaming exemption (which is correctly bearer-only).
- RLS / IDOR ownership scoping — verified incidentally (all controllers use `withRLSContext`/`withRLSTransaction` + `{ id, userId }` scoping) but belongs to the access-control/RLS review, not input validation.
- Rate limiting adequacy — limiters are wired on AI/upload/auth/sensitive routes; tuning is covered by a separate prompt.
- Auth token / JWT validation internals — covered by the authentication review.
