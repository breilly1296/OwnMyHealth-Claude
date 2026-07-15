# Quest FHIR / Lab-Connection Security Review — 2026-06-16

Scope: the deep single-domain SMART-on-FHIR lab integration owner (prompt
`41-fhir-lab-integration.md`). Survey-level checks owned by `09-external-apis`
and `27-ai-integration` were not re-run here. Static review only — code was read,
not executed. HEAD `fb2cd32`.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 3 |

The integration is in solid shape. Every server-supplied outbound URL is host-
allowlisted before a credential is attached; tokens are per-user AES-256-GCM
encrypted in flight and at rest; PKCE is correct (S256, 64-byte verifier,
single-use state); IDOR is defended in depth (RLS + explicit `userId` scoping);
and the PHI-write audit is genuinely fail-closed. Findings are confined to
untrusted-input hardening on the FHIR-response mapping path and to two documented
accepted limitations (L-39 single-instance PKCE cache, L-40 DNS rebinding) that
should be re-confirmed as accepted at the deployment level.

## Findings

### F-1 — Untrusted FHIR Observation value/id not type-validated before persistence — **Medium**
- **Location:** `backend/src/services/fhir/labSyncService.ts:515`, `:529`, `:332-335`, `:351`, `:316`
- **Observation:** `mapObservation` reads `obs.valueQuantity.value` directly into
  `value: number` with only a falsy/zero guard. `FHIRObservation` declares `value`
  as `number` and `id` as `string`, but these come from an external HTTP response
  parsed by `response.json()` (`fhirClient.ts:59`) — the TypeScript types are not
  runtime guarantees. A compromised/MITM'd FHIR server (or a buggy provider) can
  return `valueQuantity.value` as a string (`"abc"`), `NaN`, `Infinity`, or a
  huge/precision-losing number, and `obs.id` as missing/empty. There is no
  `Number.isFinite()` / `typeof` check anywhere on the value, and no guard that
  `obs.id` is a non-empty string.
- **Impact:**
  - A non-finite or string value flows into `encryption.encrypt(String(row.value), salt)`
    (`:332`) and into `Biomarker.valueEncrypted`, poisoning the biomarker series with
    `"NaN"`/`"Infinity"`/`"abc"` ciphertext that later decrypts to a non-numeric the
    trend/range math (`:333-335`) and the UI cannot interpret. `Number(...)` on
    read silently yields `NaN`, breaking in-range classification for that metric.
  - A missing `obs.id` makes `sourceFile = "fhir:quest:undefined"` (`:351`) and the
    idempotency key `"fhir:quest:undefined"` (`:316`) — every id-less observation
    collapses to one identity, so the *first* such reading imports and all later
    ones are silently dropped as "already imported", or (across syncs) overwrite
    each other. This is a data-integrity / correctness defect on a health record.
  - Per-observation throws are isolated (`:359-362`), so this corrupts/skips
    individual rows rather than aborting the sync — which is why it is Medium, not
    High: no PHI disclosure, no cross-user blast radius, bounded to the victim's
    own data and gated on a hostile/buggy upstream.
- **Fix:** In `mapObservation`, after `const value = obs.valueQuantity.value`, add
  `if (typeof value !== 'number' || !Number.isFinite(value)) return null;` so
  non-numeric/non-finite results are skipped (incrementing `skipped`) exactly like
  qualitative results already are. Separately, guard the id: derive
  `const obsId = typeof obs.id === 'string' && obs.id.length > 0 ? obs.id : null;`
  and skip the observation when null (an observation with no stable id cannot be
  idempotently imported anyway).
- **Evidence:**
  ```ts
  if (!obs.valueQuantity?.value && obs.valueQuantity?.value !== 0) return null;
  // ...
  const value = obs.valueQuantity.value;          // :529 — no typeof / isFinite check
  // ...
  const valueEncrypted = encryption.encrypt(String(row.value), salt);  // :332
  const obsIdentity = `fhir:${provider}:${obs.id}`;                     // :316
  sourceFile: `fhir:${provider}:${obs.id}`,                            // :351
  ```

### F-2 — Single-instance PKCE verifier cache (L-39) is a hard correctness dependency on `--max-instances=1` — **Low**
- **Location:** `backend/src/services/fhir/smartAuth.ts:368`, `:374-386`
- **Observation:** The PKCE verifier is stashed in a per-process `Map`
  (`challengeCache`) keyed by `state`. The in-code comment documents this as L-39
  and states the deployment "must pin `--max-instances=1` for correctness." A
  callback routed to a different Cloud Run instance than the one that stashed the
  challenge returns null from `consumeChallenge` and the exchange fails.
- **Impact:** Not a confidentiality bug — PKCE `state` is still unguessable
  (24 random bytes), so the failure mode is a *dropped* callback, not a *forged*
  one. The exposure is availability/reliability: if the service ever scales beyond
  one instance, lab connections fail intermittently for users. The risk is the
  enforcement is operational (a deploy flag), not code — a future autoscale change
  silently reintroduces the breakage.
- **Fix:** Either (a) confirm `--max-instances=1` is set on the Cloud Run service
  and add it to the deploy manifest as an enforced invariant, or (b) move the
  verifier to the shared store already planned for the Redis spend-store work
  (mirror the InMemory/Redis pluggable pattern in `aiSpendGuard`), keyed by `state`
  with the same 10-min TTL and delete-on-read semantics.
- **Evidence:**
  ```ts
  const challengeCache = new Map<string, CachedChallenge>();   // :368
  // L-39 ... Until then the deployment must pin `--max-instances=1` for correctness
  ```

### F-3 — SSRF host allowlist does not pin resolved IP (DNS rebinding, L-40) — **Low**
- **Location:** `backend/src/services/fhir/urlSafety.ts:13-24`, `:85-94`
- **Observation:** `assertAllowedFhirUrl` validates the URL *hostname* string
  against `{base host} ∪ extraAllowedHosts` but does not resolve and pin the IP.
  The header comment formalizes this as L-40 ACCEPTED RESIDUAL RISK. A trusted host
  whose DNS later resolves to an internal/attacker IP (DNS rebinding, or subverted
  authoritative DNS for the trusted host) would pass the check and then receive the
  Bearer token / client_secret at fetch time.
- **Impact:** Low and knowingly accepted: the realistic threat (a server response
  pointing credentials at an arbitrary attacker host) is fully blocked by the host
  allowlist, the trusted hosts are operator-configured (not user input), and
  exploiting it requires also subverting the trusted host's DNS. Worth re-confirming
  as a formal threat-model decision rather than leaving it as a code comment.
- **Fix:** Keep as accepted residual risk; record it in the threat-model doc. Only
  if the allowlist ever becomes user-supplied, close it by resolving + pinning the
  IP and connecting to the pinned address via a custom `lookup`/agent (as the
  comment notes).
- **Evidence:**
  ```ts
  // ACCEPTED RESIDUAL RISK (L-40 — DNS rebinding): this validates the URL's HOST
  // against an allowlist; it does NOT pin the resolved IP.
  ```

### F-4 — `CONNECT_FAILED` audit row is unattributed (`userId: undefined`) on pre-exchange failure — **Low**
- **Location:** `backend/src/controllers/fhirController.ts:113-124`; `labSyncService.ts:131-137`
- **Observation:** The callback catch block now writes a `CONNECT_FAILED` audit row
  (good — closes the prior gap), but with `userId: undefined`. The PKCE-bound
  `userId` is consumed inside `handleOAuthCallback` via `consumeChallenge(state)`
  and only returned on success, so a failure before/at the exchange has no user
  binding. A failed-connect event is therefore recorded but not attributable to a
  user.
- **Impact:** Low. The event is still durably logged; only attribution is missing,
  and only for failures (a successful connect is fully attributed via the `CONNECT`
  row). It weakens the failed-access audit trail (measured against
  `05-audit-logging` expectations) but discloses nothing and blocks no operation.
- **Fix:** If attribution is desired, look up the stashed challenge's `userId`
  before consuming it (a peek that does not delete on the failure path), or have
  `handleOAuthCallback` surface the bound `userId` on the thrown error so the catch
  block can attribute the row. Accept-as-is is also defensible since an
  invalid/expired/forged `state` may have no legitimate user.
- **Evidence:**
  ```ts
  await auditService.logAccess('LabConnection', undefined, { userId: undefined }, {
    operation: 'CONNECT_FAILED', ... });   // fhirController.ts:118-124
  ```

## Checks passed

### 1. SMART-on-FHIR OAuth Correctness (PKCE / state)
- [x] PKCE method is `S256` — `code_challenge_method: 'S256'` at `smartAuth.ts:186`; challenge is base64url(SHA-256(verifier)) at `smartAuth.ts:103`.
- [x] Verifier entropy RFC-7636-conformant — 64 random bytes → 86 base64url chars at `smartAuth.ts:102` (in the 43-128 range).
- [x] `state` is cryptographically random (24 bytes base64url) and sent on authorize — `smartAuth.ts:104`, included in params at `smartAuth.ts:183`.
- [x] `state` validated + single-use — `consumeChallenge` deletes before returning (`smartAuth.ts:402-406`); replay returns null and `handleOAuthCallback` throws (`labSyncService.ts:131-134`).
- [x] Expired challenges rejected — `consumeChallenge` returns null when `expiresAt < Date.now()` after deleting (`smartAuth.ts:405`); `prune()` GCs on each stash (`smartAuth.ts:388`, `:409-414`); `CHALLENGE_TTL_MS = 10*60*1000` (`smartAuth.ts:367`).
- [x] `aud` pinned to FHIR base URL on authorize — `aud: smartConfig.fhirBaseUrl` at `smartAuth.ts:184`.
- [x] `redirect_uri` server-configured, never request input — `redirect_uri: smartConfig.redirectUri` at `smartAuth.ts:181`, `:206`; `smartConfig.redirectUri` sourced from `config.quest.redirectUri` (`labSyncService.ts:63`).
- [x] Callback is the only unauthenticated FHIR route, intentional + documented — `router.get('/callback', ...)` before `router.use(authenticate)` (`fhirRoutes.ts:24`, `:27`), with the rationale comment at `fhirRoutes.ts:17-23`.

### 2. SSRF & Credential Exfiltration (urlSafety)
- [x] Pagination `next` URLs validated before Bearer attach — `assertAllowedFhirUrl` at `fhirClient.ts:38-41` (only when `absolute=true`), then Bearer at `:50`.
- [x] Discovery `authorization_endpoint` + `token_endpoint` validated — `assertAllowedFhirUrl` at `smartAuth.ts:153-160`.
- [x] Token endpoint validated on exchange + refresh — `assertSmartEndpoint` at `smartAuth.ts:202`, `:246`.
- [x] Revoke endpoint validated — `assertSmartEndpoint` at `smartAuth.ts:339-343`; revoke also skips cleanly when no derivable endpoint (`smartAuth.ts:314-322`).
- [x] `isPrivateOrLoopbackHost` blocks metadata/private/loopback/link-local/ULA — `169.254.169.254` at `urlSafety.ts:39`, 10/172.16-31/192.168 at `:37-40`, 0/127 at `:37`, `::1`/`::` at `:31`, `fe80:`/`fc`/`fd` at `:32`.
- [x] Allowlist is exactly `{base host} ∪ extraAllowedHosts` — `urlSafety.ts:86-89`; absolute cross-host candidate rejected at `:90-94`; relative resolves against base at `:78`.
- [x] Cleartext http refused for public hosts, tolerated for loopback/private — `urlSafety.ts:95-97`.
- [x] Non-HTTP(S) schemes rejected — `urlSafety.ts:82-84`.
- [x] `QUEST_FHIR_AUTH_HOSTS` parsed safely (split/trim/lowercase/filter) — `config/index.ts:280-283`.

### 3. Encrypted Token Lifecycle
- [x] `accessTokenEncrypted` always encrypted before write — `encryption.encrypt(tokenSet.accessToken, salt)` at `labSyncService.ts:151`; column `NOT NULL` (`migration.sql:16`, `schema.prisma:763`).
- [x] `refreshTokenEncrypted` encrypted when present, null otherwise — `labSyncService.ts:152`.
- [x] Tokens encrypted with per-user PBKDF2-SHA512 key — `salt = await getUserEncryptionSalt(userId)` (`labSyncService.ts:150`, `:221`, `:455`) through `getEncryptionService().encrypt` (AES-256-GCM); LabConnection is in `PHI_FIELDS` (`encryption.ts:558-561`).
- [x] Plaintext tokens transient only — decrypted into locals during sync (`labSyncService.ts:222-225`) / disconnect (`:456`); never persisted plaintext, returned, or logged (verified: no logger line in `services/fhir/` carries a token).
- [x] Refresh preserves old refresh token when provider doesn't rotate — `refreshAccessToken` re-uses supplied token (`smartAuth.ts:272-275`); sync falls back to existing `refreshTokenEncrypted` (`labSyncService.ts:240-242`).
- [x] Proactive refresh with 60s skew; clean failure when expired + no refresh token — `tokenExpiresAt.getTime() < Date.now() + 60_000` (`labSyncService.ts:231-232`); throws "no refresh token available" (`:234-235`) rather than sending a dead Bearer.
- [x] Revoke is best-effort (RFC 7009) — `revokeToken` swallows non-OK + thrown (`smartAuth.ts:344-354`); `disconnectConnection` wraps in try/catch (`labSyncService.ts:453-463`).
- [x] Account deletion revokes + deletes every connection, per-connection failure non-fatal — `revokeAllUserConnections` loops disconnect, logs+skips (`labSyncService.ts:480-493`); called from both deletion paths (`settingsController.ts:854`, `:975`).
- [x] Tokens never in client-surfaced error messages — provider error snippets `.substring(0,200)` are response bodies (`smartAuth.ts:228`, `:268`; `fhirClient.ts:56`); controller returns generic `ExternalServiceError` (`fhirController.ts:201`, `:225`).

### 4. Audit-Trail Parity
- [x] `CONNECT_INITIATED` written after stashing challenge — `labSyncService.ts:105-109`.
- [x] `CONNECT` written on every successful callback persist — `labSyncService.ts:182-186` (inside `persistConnection`, called at `fhirController.ts:104`).
- [x] `SYNC` (READ) + `SYNC_FAILED` written — `labSyncService.ts:396-404`, `:422-427`.
- [x] `DISCONNECT` written — `labSyncService.ts:469-473`.
- [x] `CONNECT_FAILED` written on callback failure — `fhirController.ts:116-124` (attribution caveat = F-4).
- [x] PHI-write audit is fail-closed + distinct — `auditService.logCreate('Biomarker','BATCH', {count,provider,sourceType,source,names:slice(0,50)}, {userId})` only when `imported>0` (`labSyncService.ts:369-382`); `logCreate` hardcodes `failClosed: true` (`auditLog.ts:416`).
- [x] Audit metadata carries no tokens/values — SYNC metadata is operation/provider/imported/skipped/unmappedCount (`labSyncService.ts:396-403`); BATCH carries count/provider/sourceType/source + first-50 NAMES, not values (`:373-379`); audit metadata column is itself encrypted (`auditLog.ts:301`, `:314`).
- [x] `RESOURCE_TYPE = 'LabConnection'` consistent across `logAccess` writers (`labSyncService.ts:50`); PHI-write deliberately uses `'Biomarker'` resource type (`:370`).

### 5. Data-Sync Correctness, IDOR & Authorization
- [x] Sync scoped to own connection — controller `findFirst({id: connectionId, userId})` under RLS, 404s otherwise (`fhirController.ts:178-189`); `syncLabResults` independently re-loads by `userId_provider` (`labSyncService.ts:203-207`).
- [x] Disconnect scoped to own connection — `findFirst({id: connectionId, userId})` under RLS, throws "Connection not found" otherwise (`labSyncService.ts:443-450`).
- [x] Connection-id params UUID-validated before handler — `validate(schemas.connectionIdParam,'params')` (`fhirRoutes.ts:56`) and `validate(schemas.uuidParam,'params')` (`fhirRoutes.ts:67`); both `z.object({...: uuid})` (`validation.ts:332-339`).
- [x] RLS confines `lab_connections` to owner/admin for all verbs — policies at `migration.sql:37-60`; every DB touch in the service uses `withRLSContext`/`withRLSTransaction` (`labSyncService.ts:154`, `:203`, `:212`, `:243`, `:267`, `:340`, `:384`, `:416`, `:443`, `:465`, `:481`) — no bare `prisma.*` inside any callback.
- [x] Synced readings append into one time-series — every reading routes through `upsertBiomarkerReading(tx, userId, reading)` (`labSyncService.ts:341-353`), the same series-merge primitive as manual/upload (`biomarkerSeries.ts:81`).
- [x] Synced values encrypted via same per-user pipeline — `encryption.encrypt(String(row.value), salt)` → `valueEncrypted` into `upsertBiomarkerReading` (`labSyncService.ts:332`, `:345`).
- [x] Imported biomarkers carry provenance — `sourceType: 'API_IMPORT'` (`labSyncService.ts:350`; enum at `schema.prisma:591`), `normalRangeSource: '<PROVIDER> FHIR'` (`:348`), `sourceFile: 'fhir:<provider>:<obsId>'` (`:351`).
- [x] Idempotency primarily on stable external id — `existingSourceFiles` holds `fhir:{provider}:{obs.id}`; already-imported non-amendment is a no-op (`labSyncService.ts:316-321`); amended/corrected let through (`:317`); `name|YYYY-MM-DD|value` dedupeKey is secondary (`:326-330`, `:568-573`); undecryptable rows err toward import (`:289-294`). (Note the `obs.id` edge case in F-1.)
- [x] FHIR free-text sanitized before persistence — `sanitizeFhirText(name,100)`/`(unit,20)` strip control chars, collapse whitespace, trim, cap (`labSyncService.ts:526`, `:528`, `:559-566`).
- [x] Unmapped LOINC codes not silently dropped/misattributed — fallback to sanitized display name + category `'Other'`, recorded in `unmappedCodes` (`labSyncService.ts:323-325`, `:526-527`, `:549`); `findLOINCMapping` matches only `system === LOINC_SYSTEM` (`loincMapper.ts:153`); LOINC_MAP is laboratory-only post-2026-06-14, vitals removed (`loincMapper.ts:133-142`).
- [x] Non-numeric observations skipped, not coerced — `mapObservation` returns null without `valueQuantity.value`, increments `skipped` (`labSyncService.ts:515`, `:305-308`). (Type-validity hardening = F-1.)
- [x] Pagination bounded — `collectAllPages` stops at 20 pages (`fhirClient.ts:107`); 30s `AbortController` timeout per request (`fhirClient.ts:45-46`).
- [x] Per-observation failures isolated — throw inside import loop caught, capped, counted (`labSyncService.ts:359-362`).

### 6. PHI / Secret Logging, Mock Server & Feature Gating
- [x] No observation values logged — only unmapped-code list (codes, not values) at `labSyncService.ts:406-409`; full-dir logger grep confirms no value/token lines.
- [x] No tokens/`client_secret` in any log — connect/sync/disconnect loggers carry userId/connectionId/capped error only (`fhirController.ts:64-66`, `:110-112`, `:198-200`, `:222-224`; `smartAuth.ts:318-352`; `labSyncService.ts:407-409`, `:460-462`, `:488-490`).
- [x] Mock server dev-only + unreachable in prod — mounted only when `config.isDevelopment`, lazy-imported (`app.ts:275-281`); `mountMockFhirServer` early-returns on `NODE_ENV === 'production'` (`mockFhirServer.ts:195-198`).
- [x] Mock issues only fake tokens / fake data — `mock_access_*`/`mock_refresh_*` (`mockFhirServer.ts:142-148`), fixed `MOCK_OBSERVATIONS` (`:31-44`), reaches no real provider.
- [x] Feature disabled unless `QUEST_FHIR_CLIENT_ID` set — `initiateQuestConnect` 503 when `isFeatureConfigured()` false (`fhirController.ts:45-55`, `:32-34`); `questSMARTConfig` throws if clientId missing (`labSyncService.ts:56-58`).
- [x] Plan + demo gating on entry points — `requirePlanFeature('questFhirIntegration')` (FREE=false `plans.ts:61`; PRO/TEAM=true `:80`/`:99`) + `blockDemoAI` on `/connect/quest` and `/sync/:connectionId` (`fhirRoutes.ts:30-62`); plan read fresh from DB under RLS, not JWT, failing closed to FREE (`planGating.ts:60-88`).
- [x] `client_secret` only via Basic auth to host-validated endpoints; public-client path omits header — `if (smartConfig.clientSecret) { headers.Authorization = 'Basic ...' }` at `smartAuth.ts:216-219`, `:256-259`, `:333-336`.

## Unverifiable
- Whether production `QUEST_FHIR_BASE_URL`, `QUEST_FHIR_REDIRECT_URI`,
  `QUEST_FHIR_SUCCESS_REDIRECT`, and `QUEST_FHIR_AUTH_HOSTS` are all https and on
  the real Quest host(s) — these are runtime env values, not in-repo. Defaults in
  `config/index.ts:268-275` are https on `api.questdiagnostics.com` / `api.ownmyhealth.io`,
  but the live deploy's values cannot be confirmed from code. (Prompt Q4.)
- Whether `--max-instances=1` is actually set on the Cloud Run service (the L-39
  correctness dependency, F-2) — deploy-time config not in this review's scope.
- Whether `QUEST_FHIR_CLIENT_SECRET` is sourced only from the secret manager
  (never committed/logged) — no secret value is in the repo (only `process.env`
  reads at `config/index.ts:267`), but secret-manager wiring is infra. (Prompt Q7.)
- The LOINC-map review cadence / how unmapped codes get promoted (Prompt Q6) — a
  process question, not a code property.

## Out of scope
- Survey-level external-API and AI-integration checks (owned by `09-external-apis`
  and `27-ai-integration` per the prompt's scope note).
- `CostAnalysis.claudeResponseEncrypted` encryption (PHI-inventory verification item
  4 references `expenseController.ts`, outside the FHIR domain).
- L-13 (no dedicated outbound-spend circuit breaker on sync) — documented in
  `fhirRoutes.ts:43-53` as a known limitation; rate-limiting/cost-budget depth is
  owned by `08-rate-limiting` / the AI-cost prompt.
- The encryption service internals (`02-encryption`) and audit-log internals
  (`05-audit-logging`) beyond confirming the FHIR call sites use them correctly.

## Prompt drift
None material. The prompt's line citations were spot-checked and are accurate
against HEAD (e.g. `CHALLENGE_TTL_MS` at `smartAuth.ts:367`, `assertAllowedFhirUrl`
at `urlSafety.ts:64`, `LabConnection` at `schema.prisma:755`, plan flags at
`plans.ts:61/80/99`). The prompt's checklist already anticipates F-2/F-3/F-4 as
the L-39/L-40/audit-attribution open questions; this review confirms they remain
the residual items and adds F-1 (untrusted value/id validation) as a not-previously-
enumerated hardening gap.
