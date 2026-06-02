# 41-fhir-lab-integration Review — 2026-06-01

Deep single-domain review of the Quest SMART-on-FHIR lab integration against
`prompts/41-fhir-lab-integration.md`. Scope: OAuth/PKCE correctness, the
SSRF/credential-exfiltration allowlist, the encrypted-token lifecycle,
audit-trail parity, IDOR/ownership scoping, LOINC mapping integrity, PHI/secret
logging, the dev mock server, and feature/plan/demo gating. All line citations
were confirmed against the live code.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 3 |
| Info | 2 |

The subsystem is well-built: every credential-bearing outbound URL is host-validated
before a token/secret is attached, tokens are encrypted with the per-user pipeline,
PKCE is S256 with single-use state, RLS + a per-call ownership re-check guard against
IDOR, and the mock server is double-gated out of production. The findings below are
the genuine residual gaps — the largest is the two KNOWN audit-parity gaps the spec
asked to "bake in, do not soften" (initiation and callback-failure are unaudited).

## Findings

### F-1 — Connect initiation and callback failures emit no audit row — **Medium**
- **Location:** `backend/src/controllers/fhirController.ts:38-68` (initiation), `:91-107` (callback failure); `backend/src/services/fhir/labSyncService.ts:95-103` (`buildConnectRedirect`).
- **Observation:** The only audit write on the connect path is the success `CONNECT` row inside `persistConnection` (`labSyncService.ts:172-178`). `buildConnectRedirect` stashes a PKCE challenge and returns an authorize URL with no `auditService.logAccess` call. When `handleOAuthCallback` or `persistConnection` throws (e.g. a failed token exchange, an expired/replayed `state`, or a discovery failure), the controller only `logger.error`s and redirects with `?error=connection_failed` — there is no `CONNECT_FAILED` audit row, unlike the symmetric `SYNC_FAILED` row that the sync path writes (`labSyncService.ts:369-374`).
- **Impact:** A started-but-never-completed or repeatedly-failing connection attempt against a user's account leaves no trace in the HIPAA audit trail. Per `05-audit-logging`, failed PHI-access attempts are expected to be auditable; the asymmetry means an attacker probing the callback (forged `state`, replayed `code`) or a misconfigured provider generates server logs but no durable, queryable audit evidence. Blast radius is the audit/forensics surface, not data confidentiality — hence Medium, not High.
- **Fix:** Add an `auditService.logAccess(RESOURCE_TYPE, undefined, { userId }, { operation: 'CONNECT_INITIATED', provider })` in `buildConnectRedirect` (userId is in scope), and a `CONNECT_FAILED` write in the `catch` of `handleCallback` mirroring the `SYNC_FAILED` shape. The callback `catch` lacks a userId (the exchange failed before `consumeChallenge` returned one) — log it with `userId: undefined` plus the capped error string so the attempt is still recorded.
- **Evidence:**
  ```ts
  } catch (err) {
    logger.error('OAuth callback failed', {
      data: { error: err instanceof Error ? err.message : 'unknown' },
    });
    const sep = frontendBase.includes('?') ? '&' : '?';
    res.redirect(`${frontendBase}${sep}error=connection_failed`);
  ```

### F-2 — PKCE verifier cache is in-process; multi-instance callbacks silently fail — **Low**
- **Location:** `backend/src/services/fhir/smartAuth.ts:317-353` (`challengeCache` Map, `stashChallenge`/`consumeChallenge`/`prune`).
- **Observation:** The PKCE verifier is cached in a module-level `Map` keyed by `state` with a 10-min TTL. The in-code comment (`smartAuth.ts:322-325`) flags that this is single-instance only. Under Cloud Run autoscale, a callback can land on a different instance than the one that ran `buildConnectRedirect`; `consumeChallenge` then returns `null` and `handleOAuthCallback` throws "Invalid or expired OAuth state".
- **Impact:** Availability/reliability of the connect flow at >1 instance, not a confidentiality issue (a missing verifier fails closed — it cannot leak a token). Compounds with F-1: the failure is also unaudited. This is an accepted-limitation item the spec asks to confirm; it is documented in-code but not wired to a shared store.
- **Fix:** Move the verifier cache to the shared store already used by the rate limiters (`createRateLimitStore` indicates a Memorystore/Redis backend exists) before relying on connect in multi-instance prod, or pin the connect/callback flow to a single instance. At minimum, surface the in-code caveat in the deploy runbook.
- **Evidence:**
  ```ts
  const challengeCache = new Map<string, CachedChallenge>();
  // ...Single backend instance only — if this runs across multiple Cloud Run
  // instances we'd need a shared cache (Redis).
  ```

### F-3 — DNS-rebinding residual risk is host-validated but IP-unpinned — **Low**
- **Location:** `backend/src/services/fhir/urlSafety.ts:9-16` (header note), `:56-91` (`assertAllowedFhirUrl`).
- **Observation:** `assertAllowedFhirUrl` validates the URL's hostname string against the allowlist but does not pin the resolved IP. An already-trusted host whose DNS later resolves to an internal IP (169.254.169.254, an internal service) would pass the host check, then `fetch` would resolve to the rebound IP. The code explicitly documents this as an accepted residual risk.
- **Impact:** Low and narrow: it requires the attacker to control DNS for a host that is *already on the trusted allowlist* (the Quest FHIR/auth hosts), which is a far higher bar than the realistic threat (a malicious `link[rel=next]` or well-known response pointing at an arbitrary host) — and that realistic threat is fully blocked by the allowlist. Flagged here only to confirm it is a documented decision, not an oversight; it is documented.
- **Fix:** No code change required if formally accepted. If hardening is desired, resolve the host and re-check the IP against `isPrivateOrLoopbackHost` immediately before `fetch` (TOCTOU-narrowing), or use a pinned-IP agent. Ensure the threat model records this acceptance.
- **Evidence:**
  ```ts
  // NOTE: this validates the URL's HOST against an allowlist; it does not pin the
  // resolved IP, so it is not a defense against DNS rebinding of an
  // already-trusted host.
  ```

### F-4 — `extractLOINCCoding` accepts non-LOINC codes, so non-LOINC observations import under "Other" — **Low**
- **Location:** `backend/src/services/fhir/loincMapper.ts:162-177` (`extractLOINCCoding`), `backend/src/services/fhir/labSyncService.ts:464-491` (`mapObservation`).
- **Observation:** `mapObservation` gates on `extractLOINCCoding(obs.code)` being non-null. But that function only *prefers* a LOINC coding — it falls back to "any coding" (`concept.coding[0]`) and then to `concept.text`, returning a code that may not be LOINC at all. So a numeric observation whose `code` carries only a proprietary/local system (no `http://loinc.org` coding) still passes the gate, is treated as `unmapped` (since `findLOINCMapping` correctly requires `system === LOINC_SYSTEM`), and is imported as an "Other"-category biomarker named from the non-LOINC `display` (or free-text `concept.text`). Its non-LOINC code is then pushed into `unmappedCodes`.
- **Impact:** Data-integrity, not security: a biomarker can be created with a name derived from an arbitrary provider display string or free-text, and the "unmapped LOINC codes" log/UI counter (`labSyncService.ts:353-358`) can contain non-LOINC identifiers, muddying the table-expansion review cadence the spec asks about (Question 6). A misattributed display name could mislead a user about which biomarker they are viewing. No PHI value is exposed (only the code/display, not the result value) and dedupe still applies.
- **Fix:** In `mapObservation`, require a true LOINC coding before importing — e.g. only proceed when `extractLOINCCoding` returns a coding whose system was LOINC, or skip (increment `skipped`) when no `LOINC_SYSTEM` coding is present. Keep the broad fallback only for the audit/log display string, not for the import decision.
- **Evidence:**
  ```ts
  // Fall back to any coding or the concept text
  const first = concept.coding[0];
  if (first) return { code: first.code, display: first.display ?? first.code };
  if (concept.text) return { code: 'unknown', display: concept.text };
  ```

### F-5 — Dev mock `/r4/authorize` is an open redirector to any `redirect_uri` — **Info**
- **Location:** `backend/src/services/fhir/mockFhirServer.ts:123-132`.
- **Observation:** The mock authorize endpoint echoes the request's `redirect_uri` into a 302 without validating it against the configured `redirect_uri`. This is an open redirect by construction.
- **Impact:** None in production — `mountMockFhirServer` early-returns when `NODE_ENV === 'production'` (`mockFhirServer.ts:194-198`) and `app.ts:275-281` only mounts it under `config.isDevelopment`. Reachable only on a developer's local box. Noted so it is not mistaken for a production surface and so it is never promoted to a non-dev environment.
- **Fix:** None required for prod. If desired, constrain the mock to redirect only to `config.quest.redirectUri` for realism. Keep the dual NODE_ENV/`isDevelopment` gate intact.
- **Evidence:**
  ```ts
  const separator = redirect_uri.includes('?') ? '&' : '?';
  res.redirect(`${redirect_uri}${separator}code=${code}&state=${encodeURIComponent(state ?? '')}`);
  ```

### F-6 — Default `QUEST_FHIR_SUCCESS_REDIRECT` points at localhost; prod env-var correctness unverifiable from repo — **Info**
- **Location:** `backend/src/config/index.ts:213-215`.
- **Observation:** `frontendSuccessRedirect` defaults to `http://localhost:5173/settings?labConnected=quest` when `QUEST_FHIR_SUCCESS_REDIRECT` is unset. The callback (`fhirController.ts:78,99,105`) redirects the browser to this base on both success and failure. If a production deploy fails to set the env var, a real user finishing OAuth would be bounced to a cleartext localhost URL (the `?labConnected`/`?error` markers go nowhere useful).
- **Impact:** Not a confidentiality issue (no token is placed on the redirect — only the `labConnected`/`error` marker). Worst case is a broken UX on misconfiguration. The actual prod values for `QUEST_FHIR_*` (https-only, on the trusted Quest host, never the mock path) live outside the repo and cannot be confirmed here — see Unverifiable.
- **Fix:** Consider adding `QUEST_FHIR_SUCCESS_REDIRECT`/`QUEST_FHIR_REDIRECT_URI` to the boot-time env validation (alongside the JWT-quality checks at `config/index.ts:235+`) so a prod boot fails fast on a localhost/cleartext value when `QUEST_FHIR_CLIENT_ID` is set.
- **Evidence:**
  ```ts
  frontendSuccessRedirect:
    process.env.QUEST_FHIR_SUCCESS_REDIRECT ||
    'http://localhost:5173/settings?labConnected=quest',
  ```

## Checks passed

### 1. SMART-on-FHIR OAuth Correctness (PKCE / state)
- [x] PKCE method is `S256`, not `plain` — `code_challenge_method: 'S256'` at `smartAuth.ts:151`; challenge = base64url(SHA-256(verifier)) at `smartAuth.ts:80`.
- [x] Verifier entropy RFC 7636-conformant — `base64UrlEncode(randomBytes(64))` → 86 chars, in 43-128 range (`smartAuth.ts:78-83`).
- [x] `state` cryptographically random and sent on authorize — `base64UrlEncode(randomBytes(24))` (`smartAuth.ts:81`); `state: challenge.state` in authorize params (`smartAuth.ts:148`).
- [x] `state` single-use on callback — `consumeChallenge` deletes before returning (`smartAuth.ts:343`); a replay returns null and `handleOAuthCallback` throws (`labSyncService.ts:122-124`).
- [x] Expired challenges rejected — `consumeChallenge` returns null when `expiresAt < Date.now()` (`smartAuth.ts:344`); `prune()` GCs on each stash (`smartAuth.ts:327,348-353`); `CHALLENGE_TTL_MS = 10 * 60 * 1000` (`smartAuth.ts:317`).
- [x] `aud` pinned to FHIR base URL — `aud: smartConfig.fhirBaseUrl` (`smartAuth.ts:149`).
- [x] `redirect_uri` is server-configured, never request input — `redirect_uri: smartConfig.redirectUri` from `config.quest.redirectUri` (`smartAuth.ts:146,171`; `labSyncService.ts:62`).
- [x] Callback is the only unauthenticated FHIR route and is documented — `router.get('/callback', ...)` precedes `router.use(authenticate)` (`fhirRoutes.ts:17-27`).

### 2. SSRF & Credential Exfiltration
- [x] Pagination `link[rel=next]` validated before the Bearer attaches — `assertAllowedFhirUrl` with `absolute=true` (`fhirClient.ts:33-41`).
- [x] Discovery `authorization_endpoint`/`token_endpoint` validated — both wrapped in `assertAllowedFhirUrl` (`smartAuth.ts:119-126`).
- [x] Token endpoint on exchange + refresh validated — `assertSmartEndpoint` (`smartAuth.ts:167,211`).
- [x] Revoke endpoint validated — `assertSmartEndpoint` on the `/token`→`/revoke` candidate (`smartAuth.ts:289-293`).
- [x] `isPrivateOrLoopbackHost` blocks metadata/private/loopback/link-local/ULA — `169.254` incl. `.169.254` metadata at `urlSafety.ts:31`; 0/127/10/192.168/172.16-31 at `:29-32`; `::1`/`::`/`fe80:`/`fc`/`fd` at `:23-24`.
- [x] Allowlist is exactly base host ∪ extra hosts — `new Set([base.hostname, ...extraAllowedHosts])` and absolute cross-host candidates rejected (`urlSafety.ts:78-86`).
- [x] Cleartext `http://` refused for public hosts, tolerated only loopback/private — `urlSafety.ts:87-89`.
- [x] Non-HTTP(S) schemes rejected — `urlSafety.ts:74-76`.
- [x] `QUEST_FHIR_AUTH_HOSTS` parsed safely (split/trim/lowercase/filter) — `config/index.ts:220-223`.

### 3. Encrypted Token Lifecycle
- [x] `accessTokenEncrypted` always encrypted before write — `encryption.encrypt(tokenSet.accessToken, salt)` (`labSyncService.ts:142`); column `NOT NULL` (`migration.sql:16`, `schema.prisma:700`).
- [x] `refreshTokenEncrypted` encrypted when present, null otherwise — `labSyncService.ts:143`.
- [x] Tokens use the per-user PBKDF2-SHA512 pipeline — `getUserEncryptionSalt(userId)` (`userEncryption.ts:29`) → `deriveUserKey` PBKDF2 sha512 (`encryption.ts:192-200`), AES-256-GCM (`encryption.ts:262-278`).
- [x] Plaintext tokens transient only — decrypted in `syncLabResults` (`labSyncService.ts:213-216`) / `disconnectConnection` (`:403`), never persisted plaintext, never returned to client (controller returns only `SyncResult`/`ConnectionSummary`), never logged (see §6).
- [x] Refresh preserves old refresh token when provider doesn't rotate — `smartAuth.ts:237-241`; sync falls back to existing encrypted refresh (`labSyncService.ts:231-233`).
- [x] Proactive refresh with 60s skew; clean failure when expired with no refresh token — `tokenExpiresAt.getTime() < Date.now() + 60_000` (`labSyncService.ts:222-224`) and throw at `:225-227`.
- [x] Revoke is best-effort (RFC 7009) — `revokeToken` swallows non-OK + thrown (`smartAuth.ts:294-305`); `disconnectConnection` wraps in try/catch (`labSyncService.ts:399-410`).
- [x] Account deletion revokes+deletes before cascade, per-connection failures skipped — `revokeAllUserConnections` (`labSyncService.ts:427-440`) called at `settingsController.ts:929` (imported `:25`).
- [x] Error snippets length-capped, carry response bodies not credentials — `.substring(0,200)` (`smartAuth.ts:193,233`); `.slice(0,300)` (`fhirClient.ts:56`).

### 4. Audit-Trail Parity
- [x] `CONNECT` written on every successful callback — `auditService.logAccess(... operation: 'CONNECT')` in `persistConnection` (`labSyncService.ts:172-178`), invoked by `handleCallback` after `persistConnection` (`fhirController.ts:96`).
- [x] `SYNC` / `SYNC_FAILED` / `DISCONNECT` written — `labSyncService.ts:343-351`, `:369-374`, `:416-420`.
- [x] KNOWN GAP confirmed: initiation unaudited — see F-1 (`buildConnectRedirect` `labSyncService.ts:95-103` has no `logAccess`).
- [x] KNOWN GAP confirmed: callback failures unaudited — see F-1 (`fhirController.ts:100-106` only `logger.error` + redirect).
- [x] Audit metadata carries no tokens/values — only `operation/provider/imported/skipped/unmappedCount/error` (`labSyncService.ts:343-351,369-374,173-177,416-420`).
- [x] `RESOURCE_TYPE = 'LabConnection'` consistent across all four writers — `labSyncService.ts:49`, used at `:173,351,369,416`.

### 5. Data-Sync Correctness, IDOR & Authorization
- [x] User can only sync their own connection — `triggerSync` re-fetches `findFirst({ id: connectionId, userId })` under RLS and 404s (`fhirController.ts:152-160`); `syncLabResults` independently re-loads by `findUnique({ userId_provider: { userId, provider } })` (`labSyncService.ts:194-198`). Both are userId-scoped under RLS; the spec (item 5) describes this split correctly.
- [x] User can only disconnect their own connection — `disconnectConnection` `findFirst({ id: connectionId, userId })` then throws "Connection not found" (`labSyncService.ts:390-397`).
- [x] Connection-id params UUID-validated before handler — `validate(schemas.connectionIdParam,'params')` (`fhirRoutes.ts:44`) and `validate(schemas.uuidParam,'params')` (`fhirRoutes.ts:55`); both `z.object({ ...: uuid })` (`validation.ts:231-238`).
- [x] RLS confines `lab_connections` for S/I/U/D to owner-or-admin — `migration.sql:37-60`; every DB touch in the service uses `withRLSContext`/`withRLSTransaction` with queries on `tx` (`labSyncService.ts:145,194,203,234,258,304,331,363,390,412,428`).
- [x] Synced values encrypted via the manual-entry pipeline — `encryption.encrypt(String(row.value), salt)` → `Biomarker.valueEncrypted` (`labSyncService.ts:299,311`).
- [x] Imported biomarkers carry provenance — `sourceType: 'API_IMPORT'` (`labSyncService.ts:316`; enum `schema.prisma:528`), `normalRangeSource: '<PROVIDER> FHIR'` (`:314`), `sourceFile: 'fhir:<provider>:<obsId>'` (`:317`).
- [x] Dedupe key = name|YYYY-MM-DD|value; undecryptable rows skipped erring toward import — `dedupeKey` (`labSyncService.ts:495-500`); catch-and-skip (`:271-277`).
- [x] Unmapped LOINC codes not silently dropped/misattributed — fallback to display + category 'Other' (`labSyncService.ts:467-469`), recorded in `unmappedCodes` (`:290-292`); `findLOINCMapping` matches only `system === LOINC_SYSTEM` (`loincMapper.ts:147-155`); logged without values (`:353-358`). (Import-decision nuance for *non-LOINC* codes captured in F-4.)
- [x] Non-numeric observations skipped, not coerced — `mapObservation` returns null unless `valueQuantity.value` present (`labSyncService.ts:462`); `skipped++` (`:285-289`).
- [x] Pagination bounded — `collectAllPages` stops at 20 pages (`fhirClient.ts:107`); 30s `AbortController` timeout (`fhirClient.ts:45-46`, `DEFAULT_TIMEOUT_MS` `:26`).
- [x] Per-observation failures isolated — throw inside the import loop is caught, capped, counted (`labSyncService.ts:325-328`).

### 6. PHI / Secret Logging, Mock Server & Feature Gating
- [x] No observation values logged — only unmapped codes logged (`labSyncService.ts:353-358`); no value-bearing log lines elsewhere in the service.
- [x] No tokens/`client_secret` in logs — connect/sync/disconnect loggers carry `userId`/`connectionId`/capped error only (`fhirController.ts:61-66,101-106,167-176,194-203`; `labSyncService.ts:407-409,435-438`). Revoke failure logs status/message only (`smartAuth.ts:296-303`).
- [x] Mock server dev-only and prod-unreachable — mounted only under `config.isDevelopment`, lazy-imported (`app.ts:275-281`); `mountMockFhirServer` early-returns on `NODE_ENV === 'production'` (`mockFhirServer.ts:194-198`).
- [x] Mock issues only fake tokens/data, reaches no real provider — `mock_access_*`/`mock_refresh_*` (`mockFhirServer.ts:142,148`), `MOCK_PATIENT_ID` (`:25,149`), static `MOCK_OBSERVATIONS` (`:31-44`).
- [x] Feature disabled unless `QUEST_FHIR_CLIENT_ID` set — 503 when `!isFeatureConfigured()` (`fhirController.ts:43-52`, `isFeatureConfigured` `:30-32`); `questSMARTConfig` throws if missing (`labSyncService.ts:56-58`).
- [x] Plan + demo gating on entry points — `requirePlanFeature('questFhirIntegration')` (false on FREE, `plans.ts:57`) and `blockDemoAI` on `/connect/quest` and `/sync/:connectionId` (`fhirRoutes.ts:30-50`); plan read fresh from DB under RLS, not JWT (`planGating.ts:60-84`).
- [x] CSRF on mutating routes — `csrfProtection` on sync (`fhirRoutes.ts:48`) and delete (`:59`); read routes (connect/list) omit it correctly.
- [x] `client_secret` sent only via Basic auth to host-validated token/revoke; public-client path omits header — `if (smartConfig.clientSecret)` guards the `Authorization: Basic` header on exchange/refresh/revoke (`smartAuth.ts:181-184,221-224,283-286`).

## Unverifiable
- Production values of `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`, `QUEST_FHIR_SUCCESS_REDIRECT`, `QUEST_FHIR_AUTH_HOSTS` (all https, on the trusted Quest host, never the mock path) — these are deploy-time secrets/env not present in the repo. The code defaults (`config/index.ts:205-224`) are https for base/redirect but localhost-cleartext for the success redirect (F-6); actual prod values cannot be confirmed here.
- Whether `QUEST_FHIR_CLIENT_SECRET` is sourced only from a secret manager (never committed/logged) — Grep found no committed value and no log line emits it, but the secret-manager wiring is infra-side and outside the repo.
- Whether the in-memory PKCE cache (F-2) is "formally accepted" vs. "must move to Redis before prod reliance" — an operational decision; the code documents the limitation but the repo holds no threat-model/runbook confirming the decision.
- Whether the DNS-rebinding residual (F-3) is recorded in the threat model — the code documents the acceptance, but the threat-model doc is not in this repo path.
- LOINC-map review cadence (spec Question 6) — a process question, not answerable from code.

## Out of scope
- Survey-level external-API checks from `09-external-apis` and `27-ai-integration` — the spec explicitly delegates those and instructs not to re-run them here.
- The encryption primitive itself (AES-256-GCM construction, PBKDF2 iteration count, master-key handling) — owned by `02-encryption`; this review confirmed only that tokens flow through that pipeline.
- RLS engine correctness / `withRLSContext` SET-LOCAL mechanics — owned by the RLS migration review; confirmed here only that the FHIR service uses `tx` (not bare `prisma`) inside every callback.
- Rate-limiter store backend correctness — owned by `08-rate-limiting`; confirmed only that `sensitiveLimiter` (10/hr) is applied to the entry points (`rateLimiter.ts:92-105`, `fhirRoutes.ts`).
