---
tags:
  - security
  - fhir
  - high
type: prompt
priority: 2
updated: 2026-06-01
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
- `backend/src/services/fhir/smartAuth.ts` (SMART-on-FHIR OAuth — `generatePKCE` (S256, 64-byte verifier, 24-byte state), `discoverEndpoints`, `buildAuthorizationUrl`, `exchangeCodeForToken`, `refreshAccessToken`, `revokeToken`, and the in-memory PKCE cache `stashChallenge`/`consumeChallenge`/`prune` with `CHALLENGE_TTL_MS = 10 min` at `smartAuth.ts:317`)
- `backend/src/services/fhir/urlSafety.ts` (SSRF / credential-exfiltration allowlist — `assertAllowedFhirUrl` (`urlSafety.ts:56`), `isPrivateOrLoopbackHost` (`urlSafety.ts:20`); the header comment at `urlSafety.ts:1-17` documents the DNS-rebinding residual risk)
- `backend/src/services/fhir/fhirClient.ts` (FHIR R4 HTTP client — `FHIRClient.request` (`fhirClient.ts:31`) gates server-supplied absolute pagination URLs via `assertAllowedFhirUrl`; 30s `AbortController` timeout `DEFAULT_TIMEOUT_MS`; `collectAllPages` 20-page cap at `fhirClient.ts:107`)
- `backend/src/services/fhir/labSyncService.ts` (orchestrator — `buildConnectRedirect`, `handleOAuthCallback`, `persistConnection` (`labSyncService.ts:135`), `syncLabResults` (`labSyncService.ts:184`), `disconnectConnection` (`labSyncService.ts:383`), `revokeAllUserConnections`, `mapObservation`, `dedupeKey`; all audit writes go through `auditService.logAccess` with `RESOURCE_TYPE = 'LabConnection'`)
- `backend/src/services/fhir/loincMapper.ts` (`LOINC_MAP` static table, `findLOINCMapping` (`loincMapper.ts:147`), `extractLOINCCoding` (`loincMapper.ts:162`), `mappedLOINCCount`)
- `backend/src/services/fhir/mockFhirServer.ts` (dev-only mock SMART/FHIR surface — `mountMockFhirServer` (`mockFhirServer.ts:194`) refuses to mount in production)
- `backend/src/services/fhir/types.ts` (FHIR R4 subset; `LOINC_SYSTEM`, `UCUM_SYSTEM`, `FHIR_CATEGORY_SYSTEM`, `SMARTTokenResponse`, `SMARTConfiguration`)
- `backend/src/controllers/fhirController.ts` (`initiateQuestConnect` (`fhirController.ts:38`), `handleCallback` (`fhirController.ts:76`), `listConnections`, `triggerSync` (`fhirController.ts:145`), `deleteConnection` (`fhirController.ts:183`); `isFeatureConfigured` gates on `config.quest.clientId`)
- `backend/src/routes/fhirRoutes.ts` (route guard stacks; the callback at `fhirRoutes.ts:24` is intentionally pre-`authenticate`)
- `src/services/api/fhir.ts` (frontend client — `fhirApi.connectQuest`/`listConnections`/`syncConnection`/`disconnect`)
- `src/components/settings/LabConnectionsSection.tsx` (Lab Connections UI — OAuth-marker handling on mount, connect/sync/disconnect flows)
- `backend/prisma/schema.prisma` (`LabConnection` model at `schema.prisma:692`; `DataSourceType` enum at `schema.prisma:523`; `Biomarker.sourceType` at `schema.prisma:153`)
- `backend/prisma/migrations/20260418_add_lab_connections/migration.sql` (table DDL + RLS policies `lab_connections_select/insert_own/update/delete_own`)
- `backend/src/config/index.ts` (`config.quest` at `config/index.ts:205` — `QUEST_FHIR_CLIENT_ID`, `QUEST_FHIR_CLIENT_SECRET`, `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`, `QUEST_FHIR_SUCCESS_REDIRECT`, `QUEST_FHIR_AUTH_HOSTS`)
- `backend/src/services/encryption.ts` (`getEncryptionService`, `encrypt`/`decrypt` at `encryption.ts:262`/`:287`, `deriveUserKey` PBKDF2-SHA512 at `encryption.ts:192`)
- `backend/src/services/userEncryption.ts` (`getUserEncryptionSalt` — per-user salt source)
- `backend/src/middleware/planGating.ts` (`requirePlanFeature('questFhirIntegration')` → `requirePlanLimit`; plan read fresh from DB under RLS)
- `backend/src/middleware/demoProtection.ts` (`blockDemoAI` at `demoProtection.ts:164`)
- `backend/src/middleware/rateLimiter.ts` (`sensitiveLimiter` at `rateLimiter.ts:92` — 10 req/hour)
- `backend/src/middleware/validation.ts` (`schemas.connectionIdParam` / `schemas.uuidParam` — both `z.object` of a UUID)
- `backend/src/config/plans.ts` (`questFhirIntegration` feature flag — `false` on FREE, `true` on paid tiers)
- `backend/src/controllers/settingsController.ts` (`revokeAllUserConnections` called from account deletion at `settingsController.ts:929`)
- `backend/src/app.ts` (`mountMockFhirServer` mounted only when `config.isDevelopment` at `app.ts:275-281`)

## OwnMyHealth FHIR / Lab-Connection Architecture
- **Provider & flow.** A standalone SMART-on-FHIR patient-launch OAuth 2.0
  authorization-code-with-PKCE flow. `provider` is `'quest'` everywhere today
  (`questSMARTConfig`, `smartConfigForProvider` at `labSyncService.ts:55-78`); the
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
  on access; refresh nullable — `schema.prisma:700-701`,
  `migration.sql:16-17`). Both are encrypted with the user's per-user PBKDF2-SHA512
  key via `getEncryptionService().encrypt(token, salt)` where
  `salt = await getUserEncryptionSalt(userId)` (`labSyncService.ts:140-143`,
  `:211-216`, `:230-233`). The PHI inventory classifies these as PHI — a stolen
  access token is a direct path to live PHI at the lab (see [[_phi-inventory]] §
  Lab connections). Synced observation values become `Biomarker.valueEncrypted`,
  encrypted through the *same* per-user pipeline as manual entry
  (`labSyncService.ts:299`).
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
  (`challengeCache`, `smartAuth.ts:318`) keyed by `state` with a 10-min TTL. Under
  Cloud Run autoscale a callback can land on a different instance than the one that
  stashed the challenge, breaking the exchange — the in-code comment at
  `smartAuth.ts:321-325` flags this as needing a shared cache (Redis).

## Checklist

### 1. SMART-on-FHIR OAuth Correctness (PKCE / state)
- [ ] PKCE challenge method is `S256` (not `plain`) — `buildAuthorizationUrl` sets
  `code_challenge_method: 'S256'` (`smartAuth.ts:151`) and `generatePKCE` derives
  the challenge as base64url(SHA-256(verifier)) (`smartAuth.ts:80`)
- [ ] Code verifier has adequate entropy and is RFC 7636-conformant: 64 random
  bytes → 86 base64url chars, inside the 43-128 range (`generatePKCE`,
  `smartAuth.ts:78-83`)
- [ ] `state` is cryptographically random (24 random bytes, base64url —
  `smartAuth.ts:81`) and is sent on the authorize request (`smartAuth.ts:148`)
- [ ] `state` is validated AND single-use on callback: `consumeChallenge`
  `delete`s the entry before returning it (`smartAuth.ts:338-346`), so a replayed
  `state` returns null and `handleOAuthCallback` throws (`labSyncService.ts:122-124`)
- [ ] Expired challenges are rejected: `consumeChallenge` returns null when
  `expiresAt < Date.now()` even after deleting, and `prune()` GCs the map on each
  stash (`smartAuth.ts:344`, `:348-353`); `CHALLENGE_TTL_MS = 10 * 60 * 1000`
  (`smartAuth.ts:317`) — confirm 10 min is the intended TTL
- [ ] The PKCE verifier cache is in-memory/single-instance (`challengeCache` Map,
  `smartAuth.ts:318`). Confirm whether multi-instance Cloud Run requires a shared
  cache (Redis) — a callback landing on the wrong instance silently fails the
  exchange; verify this is an accepted limitation or wired to a shared store
- [ ] `aud` is pinned to the FHIR base URL on the authorize request
  (`smartAuth.ts:149`) so the provider can't be coerced to issue a token for a
  different audience
- [ ] `redirect_uri` is server-configured (`config.quest.redirectUri`), never taken
  from request input (`smartAuth.ts:146`, `:171`)
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
- [ ] `isPrivateOrLoopbackHost` (`urlSafety.ts:20-35`) blocks `169.254.169.254`
  (cloud metadata, `urlSafety.ts:31`), 10/172.16-31/192.168 private, 0.0.0.0 and
  127/8 loopback, IPv6 `::1`/`::`, `fe80:` link-local, and `fc`/`fd` ULA
- [ ] The host allowlist is exactly `{ base host } ∪ QUEST_FHIR_AUTH_HOSTS`
  (`assertAllowedFhirUrl`, `urlSafety.ts:78-86`) — credentials can never leave the
  trusted host set; an absolute cross-host candidate is rejected even though
  relative candidates resolve against the base
- [ ] Cleartext `http://` is refused for public hosts and tolerated only for
  loopback/private (`urlSafety.ts:87-89`) — confirm prod `QUEST_FHIR_BASE_URL` /
  `QUEST_FHIR_AUTH_HOSTS` are all https
- [ ] Non-HTTP(S) schemes (`file:`, `gopher:`, etc.) are rejected
  (`urlSafety.ts:74-76`)
- [ ] DNS-rebinding residual risk is explicitly accepted: `assertAllowedFhirUrl`
  validates the HOST string but does NOT pin the resolved IP (`urlSafety.ts:9-16`).
  Confirm this is a documented accepted residual risk, not an oversight — an
  already-trusted host whose DNS later resolves to an internal IP is not caught
- [ ] `QUEST_FHIR_AUTH_HOSTS` is parsed safely (trimmed, lowercased, empties
  filtered — `config/index.ts:220-223`); an empty value means auth endpoints must
  live on the FHIR base host

### 3. Encrypted Token Lifecycle
- [ ] `accessTokenEncrypted` is always encrypted before write
  (`encryption.encrypt(tokenSet.accessToken, salt)`, `labSyncService.ts:142`); the
  schema column is `NOT NULL` (`migration.sql:16`)
- [ ] `refreshTokenEncrypted` is encrypted when present and `null` otherwise
  (`labSyncService.ts:143`); never written in plaintext
- [ ] Tokens are encrypted with the user's per-user PBKDF2-SHA512 key
  (`getUserEncryptionSalt(userId)` → `deriveUserKey`, AES-256-GCM) — the same
  pipeline as all PHI (see [[02-encryption]], [[_phi-inventory]])
- [ ] Plaintext tokens exist only transiently in memory during exchange / refresh /
  sync / revoke and are never persisted, returned to the client, or logged
- [ ] Refresh preserves the old refresh token when the provider does NOT rotate:
  `refreshAccessToken` re-uses the supplied `refreshToken` if the response omits one
  (`smartAuth.ts:237-241`), and `syncLabResults` falls back to the existing
  `connection.refreshTokenEncrypted` when no new refresh token is returned
  (`labSyncService.ts:231-233`)
- [ ] Expiry check refreshes proactively (60s skew) before calling the FHIR API
  (`labSyncService.ts:221-224`); a missing refresh token when expired fails the
  sync cleanly rather than sending a dead Bearer token (`labSyncService.ts:225-227`)
- [ ] Revoke is best-effort per RFC 7009: `revokeToken` swallows non-OK responses
  and thrown errors (`smartAuth.ts:294-305`), and `disconnectConnection` wraps it in
  try/catch so disconnect never blocks on revocation failure
  (`labSyncService.ts:399-410`)
- [ ] On account deletion, `revokeAllUserConnections` revokes + deletes every
  connection before the cascade (`settingsController.ts:929`,
  `labSyncService.ts:427-440`); a per-connection failure is logged and skipped, not
  fatal
- [ ] Token strings are never embedded in error messages surfaced to the client —
  FHIR/SMART error snippets are length-capped (`.slice(0,200)`/`.slice(0,300)`) and
  carry response bodies, not request credentials (`smartAuth.ts:193`, `:233`;
  `fhirClient.ts:56`)

### 4. Audit-Trail Parity (KNOWN GAP — bake in, do not soften)
- [ ] Confirm an audit row is written for EVERY token-affecting operation. As of
  this writing: `persistConnection` logs `operation: 'CONNECT'`
  (`labSyncService.ts:172-177`), `syncLabResults` logs `'SYNC'`
  (`labSyncService.ts:343-351`) and `'SYNC_FAILED'` (`:369-374`),
  `disconnectConnection` logs `'DISCONNECT'` (`labSyncService.ts:416-420`). Verify
  the `CONNECT` write still fires on every successful callback and was not removed —
  it is the only record that encrypted tokens were stored
- [ ] KNOWN GAP — the connect *initiation* step is unaudited: `initiateQuestConnect`
  → `buildConnectRedirect` stashes a PKCE challenge and returns an authorize URL
  (`fhirController.ts:38-68`, `labSyncService.ts:95-103`) with NO
  `auditService.logAccess` call. Only the *callback* path (`persistConnection`)
  audits. Flag that a started-but-never-completed connection attempt (or a callback
  that throws before `persistConnection`, e.g. a failed token exchange in
  `handleOAuthCallback`) leaves no audit trace
- [ ] KNOWN GAP — `handleCallback` failures are not audited: when
  `handleOAuthCallback` or `persistConnection` throws, the controller only
  `logger.error`s and redirects with `?error=connection_failed`
  (`fhirController.ts:100-106`) — there is no `CONNECT_FAILED` audit row analogous to
  `SYNC_FAILED`. Flag this asymmetry against the [[05-audit-logging]] expectation
  that failed PHI-access attempts are auditable
- [ ] Audit metadata never contains tokens or observation values — only
  `operation`, `provider`, `imported`/`skipped`/`unmappedCount`, and capped error
  strings (`labSyncService.ts:343-351`, `:369-374`)
- [ ] `RESOURCE_TYPE = 'LabConnection'` (`labSyncService.ts:49`) is consistent
  across all four writers so audit queries and any usage counters stay aligned (see
  the resource-type-drift caution in [[27-ai-integration]] §8)

### 5. Data-Sync Correctness, IDOR & Authorization
- [ ] A user can only sync their OWN connection: `triggerSync` re-fetches the
  connection with `findFirst({ where: { id: connectionId, userId } })` under
  `withRLSContext(userId, ...)` and 404s if not owned (`fhirController.ts:152-160`),
  AND `syncLabResults` independently re-loads by `userId_provider`
  (`labSyncService.ts:194-198`) — defense in depth on top of RLS
- [ ] A user can only disconnect their OWN connection: `disconnectConnection`
  re-fetches `findFirst({ where: { id: connectionId, userId } })` under RLS
  (`labSyncService.ts:390-393`) and throws "Connection not found" otherwise
- [ ] Connection-id params are UUID-validated before the handler:
  `validate(schemas.connectionIdParam,'params')` on sync and
  `validate(schemas.uuidParam,'params')` on delete (`fhirRoutes.ts:44`, `:55`)
- [ ] RLS policies confine `lab_connections` to the owner (or admin session) for
  SELECT/INSERT/UPDATE/DELETE (`migration.sql:37-60`); every DB touch in the
  service goes through `withRLSContext` / `withRLSTransaction`, never bare
  `prisma.*` inside the callback (see RLS rule in CLAUDE.md and [[_review-protocol]])
- [ ] Synced observation values are encrypted via the same per-user pipeline as
  manual entry: `encryption.encrypt(String(row.value), salt)` →
  `Biomarker.valueEncrypted` (`labSyncService.ts:299`, `:311`); no value is stored
  in plaintext
- [ ] Imported biomarkers carry provenance: `sourceType: 'API_IMPORT'`
  (`labSyncService.ts:316`; `DataSourceType.API_IMPORT` enum at `schema.prisma:528`),
  `normalRangeSource: '<PROVIDER> FHIR'`, and `sourceFile: 'fhir:<provider>:<obsId>'`
  so synced data is distinguishable from manual entry
- [ ] Dedupe keys are derived correctly and don't silently drop distinct results:
  `dedupeKey` = `name|YYYY-MM-DD|value` (`labSyncService.ts:495-500`); undecryptable
  existing rows are skipped erring toward import, not toward dropping
  (`labSyncService.ts:271-277`)
- [ ] LOINC mapping integrity — unmapped codes are NOT silently dropped or
  misattributed: `mapObservation` falls back to the FHIR display name + category
  `'Other'` and records the code in `unmappedCodes` (`labSyncService.ts:467-491`),
  `findLOINCMapping` only matches on `system === LOINC_SYSTEM`
  (`loincMapper.ts:147-155`), and unmapped codes are logged (no PHI) for table
  expansion (`labSyncService.ts:353-358`)
- [ ] Non-numeric observations are skipped, not coerced: `mapObservation` returns
  null unless `valueQuantity.value` is present (`labSyncService.ts:462`); skipped
  results increment `skipped`, they don't corrupt the biomarker store
- [ ] Pagination is bounded: `collectAllPages` stops at 20 pages
  (`fhirClient.ts:107`) so a pathological provider response can't loop or exhaust
  memory; each request has a 30s `AbortController` timeout (`fhirClient.ts:45-46`)
- [ ] Per-observation failures are isolated: a throw inside the import loop is
  caught, capped, and counted — one bad row doesn't abort the whole sync
  (`labSyncService.ts:325-328`)

### 6. PHI / Secret Logging, Mock Server & Feature Gating
- [ ] No observation values (PHI) are logged during sync — the only data-bearing
  log is the unmapped-LOINC-code list (codes, not values; `labSyncService.ts:353-358`)
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
  (FREE = false, `config/plans.ts:57`) and `blockDemoAI` on `/connect/quest` and
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

# Audit parity — find the four operations and the unaudited initiation path
grep -rn "logAccess\|operation: '" backend/src/services/fhir/labSyncService.ts
grep -rn "buildConnectRedirect\|initiateQuestConnect" backend/src/

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
1. Is the in-memory PKCE verifier cache (`challengeCache`, `smartAuth.ts:318`)
   acceptable under multi-instance Cloud Run, or must it move to a shared store
   (Redis) before relying on the connect flow in production? A callback landing on
   a different instance silently fails the exchange.
2. The host allowlist (`assertAllowedFhirUrl`) is explicitly NOT a DNS-rebinding
   defense (`urlSafety.ts:9-16`) — is the unpinned-resolved-IP residual risk a
   formally accepted decision, and is it documented in the threat model?
3. KNOWN GAP — should the connect *initiation* (`buildConnectRedirect`) and
   *callback failures* (`handleOAuthCallback` / `persistConnection` throwing) emit
   audit rows? Today only the successful `CONNECT` is audited; a started-but-failed
   connection attempt leaves no trace, unlike `SYNC_FAILED`.
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
