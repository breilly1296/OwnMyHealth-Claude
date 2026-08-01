---
tags:
  - security
  - fhir
  - high
type: prompt
priority: 2
updated: 2026-06-16
---

# Quest FHIR / Lab-Connection Security Review

> **Scope.** This is the deep single-domain owner for the SMART-on-FHIR lab
> integration. [[09-external-apis]] and [[27-ai-integration]] cover this
> subsystem only at survey level and cross-link here for the basics. This file
> goes beyond them: OAuth correctness, the encrypted-token lifecycle, IDOR /
> ownership scoping, the LOINC mapping integrity, audit-trail parity, and the
> real edge cases. Do **not** re-run the survey checks from 09/27 here — follow
> the cross-links for those.

## Files to Review
- `backend/src/services/fhir/smartAuth.ts` (SMART-on-FHIR OAuth — `generatePKCE` (S256, 64-byte verifier, 24-byte state), `discoverEndpoints`, `buildAuthorizationUrl`, `exchangeCodeForToken`, `refreshAccessToken`, `revokeToken`, and the in-memory PKCE cache `stashChallenge`/`consumeChallenge`/`prune` with `CHALLENGE_TTL_MS = 10 min` at `smartAuth.ts:367`)
- `backend/src/services/fhir/urlSafety.ts` (SSRF / credential-exfiltration allowlist — `assertAllowedFhirUrl` (`urlSafety.ts:64`), `isPrivateOrLoopbackHost` (`urlSafety.ts:28-43`); the header comment at `urlSafety.ts:1-25` formalizes the DNS-rebinding residual risk as L-40 (`urlSafety.ts:13-24`))
- `backend/src/services/fhir/fhirClient.ts` (FHIR R4 HTTP client — `FHIRClient.request` (`fhirClient.ts:31`) gates server-supplied absolute pagination URLs via `assertAllowedFhirUrl`; 30s `AbortController` timeout `DEFAULT_TIMEOUT_MS`; `collectAllPages` 20-page cap at `fhirClient.ts:107`)
- `backend/src/services/fhir/labSyncService.ts` (orchestrator — `buildConnectRedirect`, `handleOAuthCallback`, `persistConnection` (`labSyncService.ts:144`), `syncLabResults` (`labSyncService.ts:193`), `disconnectConnection` (`labSyncService.ts:436`), `revokeAllUserConnections` (`labSyncService.ts:480-493`), `mapObservation` (`labSyncService.ts:511`), `sanitizeFhirText` (`labSyncService.ts:559-566`), `dedupeKey` (`labSyncService.ts:568-573`); `RESOURCE_TYPE = 'LabConnection'` (`labSyncService.ts:50`); **synced readings now route through `upsertBiomarkerReading` (imported at `labSyncService.ts:41`, called `:340-354`) so each reading merges into one biomarker time-series instead of inserting a disconnected single-point row** — `auditService.logAccess` records connect/sync/disconnect, and a fail-closed `auditService.logCreate('Biomarker','BATCH', …)` (`labSyncService.ts:369-382`) records the actual PHI write)
- `backend/src/services/fhir/loincMapper.ts` (`LOINC_MAP` static table — **laboratory-only as of the 2026-06-14 cleanup; the vital-sign mappings (BP/HR/weight/height/BMI) were intentionally removed, see removal comment `loincMapper.ts:133-142`**, `findLOINCMapping` (`loincMapper.ts:150`), `extractLOINCCoding` (`loincMapper.ts:165`), `mappedLOINCCount`)
- `backend/src/services/fhir/mockFhirServer.ts` (dev-only mock SMART/FHIR surface — `mountMockFhirServer` (`mockFhirServer.ts:194`) refuses to mount in production)
- `backend/src/services/fhir/types.ts` (FHIR R4 subset; `LOINC_SYSTEM`, `UCUM_SYSTEM`, `FHIR_CATEGORY_SYSTEM`, `SMARTTokenResponse`, `SMARTConfiguration`)
- `backend/src/controllers/fhirController.ts` (`initiateQuestConnect` (`fhirController.ts:40`), `handleCallback` (`fhirController.ts:80`; its catch block now writes a `CONNECT_FAILED` audit row at `:108-132`), `listConnections`, `triggerSync` (`fhirController.ts:171`), `deleteConnection` (`fhirController.ts:209`); `isFeatureConfigured` gates on `config.quest.clientId`)
- `backend/src/routes/fhirRoutes.ts` (route guard stacks; the callback at `fhirRoutes.ts:24` is intentionally pre-`authenticate`)
- `src/services/api/fhir.ts` (frontend client — `fhirApi.connectQuest`/`listConnections`/`syncConnection`/`disconnect`)
- `src/components/settings/LabConnectionsSection.tsx` (Lab Connections UI — OAuth-marker handling on mount, connect/sync/disconnect flows)
- `backend/prisma/schema.prisma` (`LabConnection` model at `schema.prisma:755`; `DataSourceType` enum at `schema.prisma:586` (`API_IMPORT` at `:591`); `Biomarker.sourceType` at `schema.prisma:194`)
- `backend/prisma/migrations/20260418_add_lab_connections/migration.sql` (table DDL + RLS policies `lab_connections_select/insert_own/update/delete_own`)
- `backend/src/config/index.ts` (`config.quest` at `config/index.ts:265` — `QUEST_FHIR_CLIENT_ID`, `QUEST_FHIR_CLIENT_SECRET`, `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`, `QUEST_FHIR_SUCCESS_REDIRECT`, `QUEST_FHIR_AUTH_HOSTS`; authHosts split/trim/lowercase/filter parse at `:280-283`)
- `backend/src/services/encryption.ts` (`getEncryptionService`, `encrypt`/`decrypt` at `encryption.ts:328`/`:353`, `deriveUserKey` PBKDF2-SHA512 at `encryption.ts:236`)
- `backend/src/services/userEncryption.ts` (`getUserEncryptionSalt` — per-user salt source)
- `backend/src/middleware/planGating.ts` (`requirePlanFeature('questFhirIntegration')` → `requirePlanLimit`; plan read fresh from DB under RLS)
- `backend/src/middleware/demoProtection.ts` (`blockDemoAI` at `demoProtection.ts:81`)
- `backend/src/middleware/rateLimiter.ts` (`sensitiveLimiter` at `rateLimiter.ts:151` — 10 req/hour, `:153-154`)
- `backend/src/middleware/validation.ts` (`schemas.connectionIdParam` / `schemas.uuidParam` — both `z.object` of a UUID)
- `backend/src/config/plans.ts` (`questFhirIntegration` feature flag — `false` on FREE (`plans.ts:61`), `true` on PRO/TEAM (`:80`/`:99`))
- `backend/src/controllers/settingsController.ts` (`revokeAllUserConnections` called from the two account-deletion paths at `settingsController.ts:854` and `:975`)
- `backend/src/app.ts` (`mountMockFhirServer` mounted only when `config.isDevelopment` at `app.ts:275-281`)

## OwnMyHealth FHIR / Lab-Connection Architecture
- **Provider & flow.** A standalone SMART-on-FHIR patient-launch OAuth 2.0
  authorization-code-with-PKCE flow. `provider` is `'quest'` everywhere today
  (`questSMARTConfig` at `labSyncService.ts:56-74`, `smartConfigForProvider` at
  `labSyncService.ts:76-79`); the
  model and DDL leave room for `'labcorp'` etc. without migration. The flow is
  provider-agnostic in `smartAuth.ts` (it takes a `SMARTConfig` or a FHIR base URL
  to discover one from) and Quest-specific wiring lives in the route/controller.
- **Connect → callback → persist.** `GET /fhir/connect/quest`
  (`initiateQuestConnect`) builds the authorize URL via `buildConnectRedirect`,
  which calls `generatePKCE()` and `stashChallenge(state, codeVerifier, userId)`
  then returns `{ redirectUrl }`. The browser navigates to the provider, then back
  to `GET /fhir/callback` (`handleCallback`). The callback `consumeChallenge(state)`
  (single-use delete), exchanges the code with PKCE
  (`exchangeCodeForToken`), and `persistConnection` upserts the `LabConnection`
  with encrypted tokens. On success the user is redirected to
  `config.quest.frontendSuccessRedirect` with `?labConnected=quest`; on failure
  with `?error=...`.
- **Where secrets/PHI live.** OAuth tokens live in
  `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted` (TEXT, `NOT NULL`
  on access; refresh nullable — `schema.prisma:763-764`,
  `migration.sql:16-17`). Both are encrypted with the user's per-user PBKDF2-SHA512
  key via `getEncryptionService().encrypt(token, salt)` where
  `salt = await getUserEncryptionSalt(userId)` (`labSyncService.ts:150-152`,
  `:222-225`, `:240-242`). The PHI inventory classifies these as PHI — a stolen
  access token is a direct path to live PHI at the lab (see [[_phi-inventory]] §
  Lab connections). Synced observation values become `Biomarker.valueEncrypted`,
  encrypted through the *same* per-user pipeline as manual entry
  (`labSyncService.ts:332`).
- **Synced labs accrue history (post-06-01 behavioral change).** Each mapped
  reading is now routed through `upsertBiomarkerReading(tx, userId, reading)`
  (`labSyncService.ts:340-354`, imported at `:41`) — the SAME series-merge primitive
  manual/upload entries use — so successive syncs APPEND into one biomarker
  time-series (anchor = newest reading, `BiomarkerHistory` = older readings) instead
  of inserting disconnected single-point rows. This is what makes synced labs show
  real trends and is the headline FHIR change since the 06-01 baseline.
- **SSRF / credential confinement.** Two classes of server-supplied URLs receive
  credentials: pagination `link[rel=next]` URLs (Bearer token, `fhirClient.ts`) and
  the SMART authorize/token/revoke endpoints discovered from
  `/.well-known/smart-configuration` (client_secret + code, `smartAuth.ts`). Every
  one is passed through `assertAllowedFhirUrl` *before* a credential is attached:
  `discoverEndpoints` (`smartAuth.ts:117-127`), `assertSmartEndpoint`
  (`smartAuth.ts:44-50`) on exchange/refresh/revoke, and `FHIRClient.request`
  (`fhirClient.ts:38-41`) on pagination. The allowlist is the FHIR base host plus
  `QUEST_FHIR_AUTH_HOSTS`; `isPrivateOrLoopbackHost` blocks `169.254.169.254`,
  private/loopback, link-local and ULA ranges; cleartext `http://` is refused for
  public hosts (tolerated only for loopback/private — the dev mock).
- **Gates.** `/connect/quest` and `/sync/:connectionId` carry
  `sensitiveLimiter` (10/hr) → `blockDemoAI` → `requirePlanFeature('questFhirIntegration')`
  (FREE = false) → (`csrfProtection` on the mutating sync) → handler. `/callback`
  is the one route deliberately *not* behind `authenticate` (OAuth redirects the
  browser as a plain GET); the PKCE `state` carries the userId binding. The whole
  feature is disabled unless `QUEST_FHIR_CLIENT_ID` is set
  (`isFeatureConfigured`, `fhirController.ts:30-32`; 503 otherwise).
- **Token cache caveat.** The PKCE verifier cache is an in-process `Map`
  (`challengeCache`, `smartAuth.ts:368`) keyed by `state` with a 10-min TTL. Under
  Cloud Run autoscale a callback can land on a different instance than the one that
  stashed the challenge, breaking the exchange — the in-code comment at
  `smartAuth.ts:374-386` formalizes this as the L-39 KNOWN LIMITATION needing a
  shared cache (Redis).

## Checklist

### 1. SMART-on-FHIR OAuth Correctness (PKCE / state)
- [ ] PKCE challenge method is `S256` (not `plain`) — `buildAuthorizationUrl` sets
  `code_challenge_method: 'S256'` (`smartAuth.ts:186`) and `generatePKCE` derives
  the challenge as base64url(SHA-256(verifier)) (`smartAuth.ts:101-106`)
- [ ] Code verifier has adequate entropy and is RFC 7636-conformant: 64 random
  bytes → 86 base64url chars, inside the 43-128 range (`generatePKCE`,
  `smartAuth.ts:101-106`)
- [ ] `state` is cryptographically random (24 random bytes, base64url) and is sent
  on the authorize request (`generatePKCE`, `smartAuth.ts:101-106`)
- [ ] `state` is validated AND single-use on callback: `consumeChallenge`
  `delete`s the entry before returning it (`smartAuth.ts:399-407`), so a replayed
  `state` returns null and `handleOAuthCallback` throws (`labSyncService.ts:131-134`)
- [ ] Expired challenges are rejected: `consumeChallenge` returns null when
  `expiresAt < Date.now()` even after deleting, and `prune()` GCs the map on each
  stash (`smartAuth.ts:399-407`, `:409-414`); `CHALLENGE_TTL_MS = 10 * 60 * 1000`
  (`smartAuth.ts:367`) — confirm 10 min is the intended TTL
- [ ] The PKCE verifier cache is in-memory/single-instance (`challengeCache` Map,
  `smartAuth.ts:368`). Confirm whether multi-instance Cloud Run requires a shared
  cache (Redis) — a callback landing on the wrong instance silently fails the
  exchange; this is now the documented L-39 KNOWN LIMITATION (`smartAuth.ts:374-386`),
  so verify it is still an accepted limitation or wired to a shared store
- [ ] `aud` is pinned to the FHIR base URL on the authorize request
  (`buildAuthorizationUrl`) so the provider can't be coerced to issue a token for a
  different audience
- [ ] `redirect_uri` is server-configured (`config.quest.redirectUri`), never taken
  from request input (`buildAuthorizationUrl` / `exchangeCodeForToken`)
- [ ] The callback route is the only unauthenticated FHIR route and that is
  intentional + documented (`fhirRoutes.ts:17-24`); a forged callback still needs a
  valid unconsumed `state` within its TTL

### 2. SSRF & Credential Exfiltration (urlSafety)
- [ ] EVERY server-supplied URL passes `assertAllowedFhirUrl` BEFORE any Bearer
  token / client_secret / code is attached:
  - pagination `link[rel=next]` (`FHIRClient.request` with `absolute=true`,
    `fhirClient.ts:38-41`)
  - `authorization_endpoint` + `token_endpoint` from discovery
    (`discoverEndpoints`, `smartAuth.ts:119-126`)
  - token endpoint on code exchange + refresh (`assertSmartEndpoint`,
    `smartAuth.ts:167`, `:211`)
  - revoke endpoint (`assertSmartEndpoint`, `smartAuth.ts:289-293`)
- [ ] `isPrivateOrLoopbackHost` (`urlSafety.ts:28-43`) blocks `169.254.169.254`
  (cloud metadata, `urlSafety.ts:39`), 10/172.16-31/192.168 private, 0.0.0.0 and
  127/8 loopback, IPv6 `::1`/`::`, `fe80:` link-local, and `fc`/`fd` ULA
- [ ] The host allowlist is exactly `{ base host } ∪ QUEST_FHIR_AUTH_HOSTS`
  (`assertAllowedFhirUrl` `urlSafety.ts:64`; allowlist build `:86-89`) — credentials
  can never leave the trusted host set; an absolute cross-host candidate is rejected
  even though relative candidates resolve against the base
- [ ] Cleartext `http://` is refused for public hosts and tolerated only for
  loopback/private (`urlSafety.ts:95-97`) — confirm prod `QUEST_FHIR_BASE_URL` /
  `QUEST_FHIR_AUTH_HOSTS` are all https
- [ ] Non-HTTP(S) schemes (`file:`, `gopher:`, etc.) are rejected
  (`urlSafety.ts:82-84`)
- [ ] DNS-rebinding residual risk is explicitly accepted: `assertAllowedFhirUrl`
  validates the HOST string but does NOT pin the resolved IP. The header comment
  formalizes this as the L-40 ACCEPTED RESIDUAL RISK (`urlSafety.ts:13-24`).
  Confirm this is still a documented accepted residual risk, not an oversight — an
  already-trusted host whose DNS later resolves to an internal IP is not caught
- [ ] `QUEST_FHIR_AUTH_HOSTS` is parsed safely (split/trimmed/lowercased, empties
  filtered — `config/index.ts:280-283`); an empty value means auth endpoints must
  live on the FHIR base host

### 3. Encrypted Token Lifecycle
- [ ] `accessTokenEncrypted` is always encrypted before write
  (`encryption.encrypt(tokenSet.accessToken, salt)`, `labSyncService.ts:151`); the
  schema column is `NOT NULL` (`migration.sql:16`)
- [ ] `refreshTokenEncrypted` is encrypted when present and `null` otherwise
  (`labSyncService.ts:152`); never written in plaintext
- [ ] Tokens are encrypted with the user's per-user PBKDF2-SHA512 key
  (`getUserEncryptionSalt(userId)` → `deriveUserKey`, AES-256-GCM) — the same
  pipeline as all PHI (see [[02-encryption]], [[_phi-inventory]])
- [ ] Plaintext tokens exist only transiently in memory during exchange / refresh /
  sync / revoke and are never persisted, returned to the client, or logged
- [ ] Refresh preserves the old refresh token when the provider does NOT rotate:
  `refreshAccessToken` re-uses the supplied `refreshToken` if the response omits one,
  and `syncLabResults` falls back to the existing
  `connection.refreshTokenEncrypted` when no new refresh token is returned
  (`labSyncService.ts:240-242`)
- [ ] Expiry check refreshes proactively (60s skew) before calling the FHIR API
  (`labSyncService.ts:230-242`); a missing refresh token when expired fails the
  sync cleanly rather than sending a dead Bearer token (`labSyncService.ts:234-235`)
- [ ] Revoke is best-effort per RFC 7009: `revokeToken` swallows non-OK responses
  and thrown errors, and `disconnectConnection` wraps it in
  try/catch so disconnect never blocks on revocation failure
  (`labSyncService.ts:453-463`)
- [ ] On account deletion, `revokeAllUserConnections` revokes + deletes every
  connection before the cascade (called from both deletion paths,
  `settingsController.ts:854` and `:975`; `labSyncService.ts:480-493`); a
  per-connection failure is logged and skipped, not fatal
- [ ] Token strings are never embedded in error messages surfaced to the client —
  FHIR/SMART error snippets are length-capped (`.slice(0,200)`/`.slice(0,300)`) and
  carry response bodies, not request credentials (`smartAuth.ts:193`, `:233`;
  `fhirClient.ts:56`)

### 4. Audit-Trail Parity
- [ ] Confirm an audit row is written for EVERY token-affecting operation. As of
  this writing: `buildConnectRedirect` logs `operation: 'CONNECT_INITIATED'`
  (`labSyncService.ts:104-109`), `persistConnection` logs `'CONNECT'`
  (`labSyncService.ts:182-186`), `syncLabResults` logs `'SYNC'`
  (`labSyncService.ts:396-404`) and `'SYNC_FAILED'` (`:422-427`),
  `disconnectConnection` logs `'DISCONNECT'`. Verify the `CONNECT` write still fires
  on every successful callback and was not removed — it is the record that encrypted
  tokens were stored
- [ ] CLOSED GAP (verify still wired) — the connect *initiation* step IS now
  audited: `buildConnectRedirect` writes a `CONNECT_INITIATED` row
  (`externalApiCall: true`, `provider`) bound to the known `userId` immediately after
  stashing the PKCE challenge (`labSyncService.ts:104-109`). Confirm this is intact
  so a started-but-never-completed connection attempt still leaves a trace
- [ ] CLOSED GAP (verify still wired) — `handleCallback` failures ARE now audited:
  the catch block writes a `CONNECT_FAILED` row (`success: false`, capped `error`,
  `provider: 'quest'`) (`fhirController.ts:108-132`, write at `:116-124`). The only
  remaining (smaller) caveat: `userId` is `undefined` on a pre-exchange failure
  because the PKCE-bound `userId` is consumed inside `handleOAuthCallback` and only
  surfaced on success (`fhirController.ts:113-115`). Verify the row is still emitted
  and measure it against the [[05-audit-logging]] failed-access expectation
- [ ] PHI-WRITE audit is fail-closed and distinct from the SYNC summary: whenever
  `imported > 0`, `syncLabResults` writes
  `auditService.logCreate('Biomarker', 'BATCH', { count, provider, sourceType, names… })`
  (`labSyncService.ts:369-382`, M17). This is the authoritative record of the
  biomarkers actually written; the `SYNC` row below is `action=READ`/best-effort and
  is NOT the import record — do not treat `SYNC` as the PHI-write trail
- [ ] Audit metadata never contains tokens or observation values — only
  `operation`, `provider`, `imported`/`skipped`/`unmappedCount`, and capped error
  strings (`labSyncService.ts:396-404`, `:422-427`); the BATCH CREATE carries only
  `count`/`provider`/`sourceType` and the first 50 biomarker NAMES (not values)
  (`labSyncService.ts:378`)
- [ ] `RESOURCE_TYPE = 'LabConnection'` (`labSyncService.ts:50`) is consistent
  across the `logAccess` writers so audit queries and any usage counters stay aligned
  (see the resource-type-drift caution in [[27-ai-integration]] §8); note the
  PHI-write record uses resource type `'Biomarker'` by design, not `'LabConnection'`

### 5. Data-Sync Correctness, IDOR & Authorization
- [ ] A user can only sync their OWN connection: `triggerSync` re-fetches the
  connection with `findFirst({ where: { id: connectionId, userId } })` under
  `withRLSContext(userId, ...)` and 404s if not owned (`fhirController.ts:178-189`),
  AND `syncLabResults` independently re-loads by `userId_provider`
  (`labSyncService.ts:203-207`) — defense in depth on top of RLS
- [ ] A user can only disconnect their OWN connection: `disconnectConnection`
  re-fetches under RLS and throws "Connection not found" otherwise
- [ ] Connection-id params are UUID-validated before the handler:
  `validate(schemas.connectionIdParam,'params')` on sync and
  `validate(schemas.uuidParam,'params')` on delete (`fhirRoutes.ts:44`, `:55`)
- [ ] RLS policies confine `lab_connections` to the owner (or admin session) for
  SELECT/INSERT/UPDATE/DELETE (`migration.sql:37-60`); every DB touch in the
  service goes through `withRLSContext` / `withRLSTransaction`, never bare
  `prisma.*` inside the callback (see RLS rule in CLAUDE.md and [[_review-protocol]])
- [ ] Synced readings APPEND into one time-series, not disconnected single-point
  rows: every reading is routed through `upsertBiomarkerReading(tx, userId, reading)`
  (`labSyncService.ts:340-354`) — the SAME series-merge primitive as manual/upload
  entry — so synced labs accrue `BiomarkerHistory` and show real trends. Confirm
  this is wired (it fixes the prior "dead trends" gap where each sync inserted a new
  unconnected biomarker row)
- [ ] Synced observation values are encrypted via the same per-user pipeline as
  manual entry: `encryption.encrypt(String(row.value), salt)` → `valueEncrypted`
  passed into `upsertBiomarkerReading` (`labSyncService.ts:332`, `:345`); no value is
  stored in plaintext
- [ ] Imported biomarkers carry provenance: `sourceType: 'API_IMPORT'`
  (`labSyncService.ts:350`; `DataSourceType.API_IMPORT` enum at `schema.prisma:591`),
  `normalRangeSource: '<PROVIDER> FHIR'`, and `sourceFile: 'fhir:<provider>:<obsId>'`
  so synced data is distinguishable from manual entry
- [ ] Idempotency is PRIMARILY keyed on the stable external id, NOT the mutable
  value: `existingSourceFiles` holds `fhir:{provider}:{obs.id}`, and an
  already-imported observation is a true no-op (`labSyncService.ts:280-330`,
  idempotency check at `:316-321`) so a re-sync can't clobber a value the user later
  edited. Amended/`corrected` statuses are deliberately let through
  (`labSyncService.ts:317`). The `name|YYYY-MM-DD|value` `dedupeKey`
  (`labSyncService.ts:568-573`) is now the SECONDARY check; undecryptable existing
  rows are skipped erring toward import (`labSyncService.ts:289-294`)
- [ ] FHIR responses are sanitized before persistence (untrusted input):
  `mapObservation` passes the display name (cap 100) and unit (cap 20) through
  `sanitizeFhirText()` — strip control chars/newlines, collapse whitespace, trim,
  hard-cap — for parity with the manual-entry Zod bounds
  (`labSyncService.ts:526`, `:528`; helper at `:559-566`)
- [ ] LOINC mapping integrity — unmapped codes are NOT silently dropped or
  misattributed: `mapObservation` falls back to the sanitized FHIR display name +
  category `'Other'` and records the code in `unmappedCodes`
  (`labSyncService.ts:511-549`), `findLOINCMapping` only matches on
  `system === LOINC_SYSTEM` (`loincMapper.ts:150`), and unmapped codes are logged
  (no PHI) for table expansion (`labSyncService.ts:406-409`). NOTE: the `LOINC_MAP`
  is laboratory-only since the 2026-06-14 cleanup — vital-sign codes (BP/HR/weight/
  height/BMI) were intentionally removed (`loincMapper.ts:133-142`), so vitals now
  fall through to `'Other'` rather than mapping to a biomarker
- [ ] Non-numeric observations are skipped, not coerced: `mapObservation` returns
  null unless `valueQuantity.value` is present (`labSyncService.ts:515`); skipped
  results increment `skipped`, they don't corrupt the biomarker store
- [ ] Pagination is bounded: `collectAllPages` stops at 20 pages
  (`fhirClient.ts:107`) so a pathological provider response can't loop or exhaust
  memory; each request has a 30s `AbortController` timeout (`fhirClient.ts:45-46`)
- [ ] Per-observation failures are isolated: a throw inside the import loop is
  caught, capped, and counted — one bad row doesn't abort the whole sync
  (`labSyncService.ts:359-362`)

### 6. PHI / Secret Logging, Mock Server & Feature Gating
- [ ] No observation values (PHI) are logged during sync — the only data-bearing
  log is the unmapped-LOINC-code list (codes, not values; `labSyncService.ts:406-409`)
- [ ] No tokens or `client_secret` appear in any log line — connect/sync/disconnect
  loggers carry `userId`/`connectionId`/capped error strings only
  (`fhirController.ts:61-66`, `:101-106`, `:167-176`, `:194-203`;
  `labSyncService.ts:407-409`, `:434-438`). Cross-check [[31-logging-observability]]
- [ ] The mock FHIR server is dev-only and unreachable in prod: mounted only when
  `config.isDevelopment` (`app.ts:275-281`, lazy-imported), and
  `mountMockFhirServer` itself early-returns when `NODE_ENV === 'production'`
  (`mockFhirServer.ts:194-198`) — belt and suspenders
- [ ] The mock issues only fake tokens / fake patient data and reaches no real
  provider (`mockFhirServer.ts:31-44`, `:135-152`); confirm no production config
  points `QUEST_FHIR_BASE_URL` at the mock path
- [ ] The feature is disabled unless `QUEST_FHIR_CLIENT_ID` is set:
  `initiateQuestConnect` returns 503 when `isFeatureConfigured()` is false
  (`fhirController.ts:43-52`), and `questSMARTConfig` throws if `clientId` is missing
  (`labSyncService.ts:56-58`)
- [ ] Plan + demo gating on the entry points: `requirePlanFeature('questFhirIntegration')`
  (FREE = false `config/plans.ts:61`; true on PRO/TEAM `:80`/`:99`) and `blockDemoAI` on `/connect/quest` and
  `/sync/:connectionId` (`fhirRoutes.ts:30-50`); plan is read fresh from DB under
  RLS, not the JWT (`planGating.ts:60-84`)
- [ ] `client_secret` is sent only via Basic auth to host-validated token/revoke
  endpoints (`smartAuth.ts:181-184`, `:221-224`, `:283-286`) and a public-client
  (PKCE-only, no secret) path omits the header cleanly

## Verification Commands
```bash
# Every server-supplied outbound URL must pass the SSRF guard before credentials attach
grep -rn "assertAllowedFhirUrl\|assertSmartEndpoint\|isPrivateOrLoopbackHost" backend/src/services/fhir/

# Confirm S256 PKCE + state generation + single-use consume
grep -rn "code_challenge_method\|generatePKCE\|stashChallenge\|consumeChallenge\|CHALLENGE_TTL_MS" backend/src/services/fhir/smartAuth.ts

# Token encryption: every token write goes through encrypt(); no plaintext token columns
grep -rn "accessTokenEncrypted\|refreshTokenEncrypted\|encryption.encrypt\|encryption.decrypt" backend/src/services/fhir/labSyncService.ts

# Audit parity — find all logAccess operations + the fail-closed PHI-write CREATE + CONNECT_FAILED
grep -rn "logAccess\|logCreate\|operation: '\|CONNECT_INITIATED\|CONNECT_FAILED" backend/src/services/fhir/labSyncService.ts backend/src/controllers/fhirController.ts
grep -rn "buildConnectRedirect\|initiateQuestConnect\|upsertBiomarkerReading" backend/src/

# Ownership / IDOR — connection lookups must be scoped to userId under RLS
grep -rn "findFirst\|findUnique\|userId_provider\|withRLSContext\|withRLSTransaction" backend/src/services/fhir/labSyncService.ts backend/src/controllers/fhirController.ts

# Imported biomarker provenance + LOINC mapping fallback
grep -rn "API_IMPORT\|sourceType\|normalRangeSource\|findLOINCMapping\|unmappedCodes" backend/src/services/fhir/

# Mock server must be dev-gated; feature must be clientId-gated
grep -rn "mountMockFhirServer\|isDevelopment\|NODE_ENV === 'production'\|isFeatureConfigured\|QUEST_FHIR_CLIENT_ID" backend/src/

# Route guard stack (limiter → demo → plan → csrf)
grep -rn "sensitiveLimiter\|blockDemoAI\|requirePlanFeature\|csrfProtection\|authenticate" backend/src/routes/fhirRoutes.ts

# Confirm no token / observation value ever hits a log line
grep -rn "logger\." backend/src/services/fhir/ backend/src/controllers/fhirController.ts
```

## Questions to Ask
1. Is the in-memory PKCE verifier cache (`challengeCache`, `smartAuth.ts:368`)
   acceptable under multi-instance Cloud Run, or must it move to a shared store
   (Redis) before relying on the connect flow in production? A callback landing on
   a different instance silently fails the exchange (documented as L-39,
   `smartAuth.ts:374-386`).
2. The host allowlist (`assertAllowedFhirUrl`) is explicitly NOT a DNS-rebinding
   defense (L-40 ACCEPTED RESIDUAL RISK, `urlSafety.ts:13-24`) — is the
   unpinned-resolved-IP residual risk a formally accepted decision, and is it
   documented in the threat model?
3. Audit coverage is now closed for connect *initiation* (`CONNECT_INITIATED`,
   `labSyncService.ts:104-109`) and *callback failures* (`CONNECT_FAILED`,
   `fhirController.ts:116-124`). The remaining open question: the `CONNECT_FAILED`
   row has `userId: undefined` on a pre-exchange failure (the PKCE-bound `userId` is
   consumed inside `handleOAuthCallback`, `fhirController.ts:113-115`) — is an
   unattributed failed-connect row acceptable, or should the userId be recoverable
   for the audit (e.g. by having the callback look up the stashed challenge before
   consuming it)?
4. Are production `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`,
   `QUEST_FHIR_SUCCESS_REDIRECT`, and `QUEST_FHIR_AUTH_HOSTS` all https, on the
   trusted Quest host(s), and confirmed never pointing at the dev mock path?
5. When a refresh token is rejected by the provider mid-sync, does the user get a
   clear "reconnect required" path, and is the dead connection's status surfaced
   (`syncStatus: 'error'`) rather than silently retrying?
6. How is the LOINC map kept current? Unmapped codes import under category `'Other'`
   with the FHIR display name — what is the review cadence for promoting logged
   unmapped codes into `LOINC_MAP`, and could a misattributed display name mislead a
   user about which biomarker they're looking at?
7. Is `client_secret` (`QUEST_FHIR_CLIENT_SECRET`) sourced only from the secret
   manager (never committed/logged), and is the public-vs-confidential client mode
   intentional for Quest?

## See Also
- [[09-external-apis]] — survey-level external-API checklist (this is the deep owner of §2/§7 there)
- [[27-ai-integration]] — sibling deep external-integration prompt; audit resource-type-drift pattern
- [[02-encryption]] — per-user AES-256-GCM / PBKDF2 pipeline used for the OAuth tokens
- [[_phi-inventory]] — `LabConnection` token PHI classification
- [[05-audit-logging]] — audit-row expectations (the connect-failure gap is measured against this)
- [[08-rate-limiting]] — `sensitiveLimiter` behavior and the named limiters
- [[11-environment-secrets]] — `QUEST_FHIR_*` secret handling and boot-time validation
