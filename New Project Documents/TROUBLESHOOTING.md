# OwnMyHealth Troubleshooting Guide

**Last Updated:** 2026-04-16
**Note:** Most entries below are derived from git-log evidence (commits marked `fix:` or `security:`). Sections tagged **TBD** need the user's direct input via prompt `18-troubleshooting-doc.md`.

---

## Symptom Index

| Symptom | Jump to |
|---|---|
| Data disappears after page refresh | [Auth token restoration order](#auth-token-restoration-order) |
| 403 CSRF errors on some mutations | [CSRF exemptions + token delivery](#csrf-exemptions--token-delivery) |
| Insurance plan 500 on fetch | [Decryption crash on legacy rows](#decryption-crash-on-legacy-rows) |
| Insurance plans "disappear" after refresh | [Insurance fetch race condition](#insurance-fetch-race-condition) |
| Cloud SQL timeouts under load | [Database connection timeout](#database-connection-timeout) |
| Cross-domain cookies not set | [Cross-domain auth cookies](#cross-domain-auth-cookies) |
| Claude API startup crash | [Anthropic SDK dynamic import](#anthropic-sdk-dynamic-import) |
| Docker image not rebuilding | [Force image rebuild](#force-image-rebuild) |
| OCR misses biomarker values | [Document AI multi-line tables](#document-ai-multi-line-tables) |
| Migration fails with `CONCURRENTLY` | [Migration index concurrency](#migration-index-concurrency) |
| PDF upload crashes server | [PDF bomb DoS protection](#pdf-bomb-dos-protection) |
| X-Forwarded-For spoofing in audit logs | [IP source security](#ip-source-security) |
| Database error leaks to client | [Prisma error sanitization](#prisma-error-sanitization) |

---

## Authentication

### Auth token restoration order
**Symptom:** After login, data shows. After page refresh, "Not authenticated" or blank dashboard.
**Root cause:** `AuthContext.tsx` called `getCurrentUser()` *before* `refreshToken()`. The stale access token failed, and the refresh never ran.
**Fix:** `await refreshToken()` first, then `getCurrentUser()`.
**Files:** `src/contexts/AuthContext.tsx`
**Evidence:** Commits `195ccc1`, `0889ff6`, `c929a28` (test update to match new flow).

### Cross-domain auth cookies
**Symptom:** Login works locally but cookies don't stick in production (frontend on GCS bucket, backend on Cloud Run — different domains).
**Root cause:** Default cookie settings don't support cross-site.
**Fix:** `Domain` attribute on all auth cookies + correct CORS + `SameSite=None; Secure`.
**Files:** `backend/src/middleware/*`, `backend/src/controllers/authController.ts`
**Evidence:** Commits `50d7426`, `327b2f4`, `8db4317`.

---

## CSRF

### CSRF exemptions + token delivery
**Symptom:** Some mutations return 403 even when authenticated.
**Root cause:** (a) Route exempted from CSRF by design, but frontend still wasn't passing the token; (b) cross-domain cookie regex in `getCookieValue()` didn't match the new cookie format.
**Fix:**
- Ensure `X-CSRF-Token` header is included on every mutation that isn't explicitly exempt.
- For file upload, insurance DELETE, settings, AI guidance — these routes are CSRF-exempt because they use Bearer token auth. Frontend skips the header.
- Fix regex in `src/services/api/client.ts` to parse `csrf_token` correctly.

**Files:**
- `backend/src/middleware/csrf.ts` — exemption list.
- `src/services/api/client.ts` — token parsing, header injection.

**Evidence:** Commits `b721788`, `7ad1272`, `bb66914`, `750357e`, `adca319`.

---

## Database

### Decryption crash on legacy rows
**Symptom:** `GET /insurance/plans` returns 500 "Failed to decrypt".
**Root cause:** Legacy rows written before a schema/encryption format change.
**Fix:** Updated decrypt path to handle missing/legacy format gracefully.
**Files:** `backend/src/controllers/insuranceController.ts`
**Evidence:** Commit `9167a07`.

### Database connection timeout
**Symptom:** 500 errors with "connection terminated" under moderate load.
**Root cause:** Default `DATABASE_URL` connection timeout too short for Cloud SQL.
**Fix:** Increased connection-timeout + pool settings in Prisma datasource URL.
**Evidence:** Commit `cdd1d7f`.

### Migration index concurrency
**Symptom:** Migration fails with error about `CREATE INDEX CONCURRENTLY` inside a transaction.
**Root cause:** Prisma wraps migrations in transactions; `CONCURRENTLY` requires no transaction.
**Fix:** Removed `CONCURRENTLY` from migration SQL. Re-index in prod separately via psql if needed for large tables.
**Evidence:** Commit `c00f8cc`.

### Insurance fetch race condition
**Symptom:** Insurance plans sometimes disappear between navigations.
**Root cause:** Multiple overlapping fetches; later stale response overwrote fresher state.
**Fix:** Added detailed debug logging to diagnose; reworked fetch sequencing.
**Files:** `src/components/insurance/*`
**Evidence:** Commits `de689c9`, `a44cea7`, `2432bc6`.

---

## Deployment

### Force image rebuild
**Symptom:** Cloud Run deploys new revision but it's running old code.
**Root cause:** Docker build hit cache and skipped source changes.
**Fix:** `--no-cache` or version-tag the image per commit.
**Evidence:** Commits `f0eff7a`, `a38eb89`.

### Cloud Build async streaming
**Symptom:** Deploys hung waiting for log stream.
**Fix:** Use async Cloud Build with polling + `--suppress-logs`.
**Evidence:** Commits `35a6cbb`, `41d1083`.

### Docker auth with Artifact Registry
**Symptom:** `docker push` fails with 401 to `us-central1-docker.pkg.dev`.
**Fix:** Use `gcloud auth print-access-token | docker login` or dedicated `docker/login-action`.
**Evidence:** Commits `a8502b8`, `8053a2e`.

---

## AI / Claude

### Anthropic SDK dynamic import
**Symptom:** Backend crashes on startup with Anthropic import error.
**Root cause:** Module resolution issue — SDK imported synchronously at top of file.
**Fix:** Dynamic import (`require()` or `await import()`) inside the handler; gracefully handle missing `ANTHROPIC_API_KEY`.
**Files:** `backend/src/services/claudeExtraction.ts`
**Evidence:** Commits `e7ae477`, `769685c`, `94004d0`.

### Claude `max_tokens` rejection
**Symptom:** SBC extraction returns API error about `max_tokens`.
**Fix:** Reduced `max_tokens` to valid limit for chosen model.
**Evidence:** Commit `e029127`.

---

## OCR / PDF Processing

### Document AI multi-line tables
**Symptom:** Biomarker extraction misses values that span multiple lines in lab report tables.
**Fix:** Added newline-spanning regex + multi-line table logging in `biomarkerExtractor.ts`.
**Evidence:** Commits `f62796f`, `2cbf6e4`, `56fd294`.

### PDF bomb DoS protection
**Symptom:** Malicious PDF could consume excessive memory or hang parsing.
**Fix:** Timeout + memory limits in `backend/src/utils/securePdfParsing.ts`.
**Evidence:** Commit `f6c2b92`.

---

## Security Fixes (selected from commit history)

### IP source security
**Symptom:** Audit logs could be spoofed by clients setting `X-Forwarded-For`.
**Fix:** Use `req.ip` with `app.set('trust proxy', ...)` properly configured. Never parse X-Forwarded-For manually.
**Evidence:** Commit `025bd57`.

### Prisma error sanitization
**Symptom:** Database constraint errors leaked column names / table structure to client.
**Fix:** Central error handler maps Prisma `P2002` / `P2003` / etc. to generic messages.
**Files:** `backend/src/middleware/errorHandler.ts`
**Evidence:** Commit `f9975c3`.

### Log format-string injection
**Symptom:** User-controlled values in `console.log(msg)` with `%s` / `%d` could cause garbled logs or information leakage.
**Fix:** Explicit format string in `logger.ts`: `console.log('%s', formattedMessage, data)`.
**Files:** `backend/src/utils/logger.ts`
**Evidence:** Commit `58af475`.

### Service account key leak
**Symptom:** GCP service account JSON accidentally committed.
**Fix:** Removed file from repo, rotated the key in GCP, added to `.gitignore`.
**Evidence:** Commits `528d5f9`, `17de968`.

### Provider notes encryption gap
**Symptom:** `ProviderPatient.notes` stored in plaintext.
**Fix:** Added `notesEncrypted` column and encrypt before write.
**Evidence:** Commit `269ea61`.

### SQL injection in RLS context
**Symptom:** `app.current_user_id` setter used string interpolation.
**Fix:** Parameterized query via Prisma `$executeRawUnsafe` → safer parameterized form.
**Evidence:** Commit `a133256`.

---

## Quick diagnostic commands

```bash
# Service health
curl https://api.ownmyhealth.io/health
curl https://api.ownmyhealth.io/api/v1/health

# Recent error logs (requires gcloud)
gcloud logging read 'severity>=ERROR resource.type="cloud_run_revision"' --limit 20 --format=json

# Cloud SQL health
gcloud sql instances describe ownmyhealth-db --format="value(state)"

# Recent deployments
gcloud run services describe ownmyhealth-prod --region=us-central1 --format="value(status.latestReadyRevisionName)"
```

---

## Template for adding a new entry

When you solve a new problem, add an entry here following this shape:

```markdown
### {One-line problem name}
**Symptom:** What the user / engineer sees.
**Root cause:** Why it happens (one line).
**Workaround:** If a temporary fix exists.
**Fix:** The actual correct fix.
**Files:** path/to/file.ts:line
**Evidence:** Commit hash or link.
```

---

## Sections to fill in from your memory (run prompt 18)

Open `prompts/18-troubleshooting-doc.md` §Questions to Ask. Recent problems you *solved* that aren't captured here. Suggested: any problems you fixed locally but didn't commit with clear messages, and any recurring issues that keep coming back.
