/**
 * SMART on FHIR OAuth service.
 *
 * Implements the standalone patient launch flow (OAuth 2.0 authorization
 * code grant with PKCE) per https://hl7.org/fhir/smart-app-launch/.
 *
 * PKCE is required — the S256 challenge defeats authorization-code
 * interception even without client_secret confidentiality.
 *
 * This service is provider-agnostic: it takes a SMART config (or a
 * FHIR base URL to discover one from) and operates on any conforming
 * server. Quest-specific wiring happens in the route handler.
 */

import { createHash, randomBytes } from 'crypto';
import type { SMARTConfiguration, SMARTTokenResponse } from './types.js';
import { logger } from '../../utils/logger.js';
import { assertAllowedFhirUrl } from './urlSafety.js';

export interface SMARTConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  fhirBaseUrl: string;
  /** Resolved from /.well-known/smart-configuration; caller may pre-set for speed. */
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes: string[];
  /**
   * Hosts (besides the FHIR base host) that the SMART authorize/token/revoke
   * endpoints may legitimately live on — the SMART auth server can differ from
   * the FHIR server. The patient Bearer token and OAuth client_secret are only
   * ever sent to the FHIR base host or a host in this allowlist. Empty means
   * "auth endpoints must be on the FHIR base host".
   */
  allowedAuthHosts?: string[];
}

/**
 * Guard a SMART endpoint URL before sending the client_secret / code to it.
 * Confines it to the FHIR base host or the configured auth-host allowlist —
 * a malicious /.well-known response can't redirect the secret to an attacker.
 */
function assertSmartEndpoint(smartConfig: SMARTConfig, urlStr: string, label: string): string {
  return assertAllowedFhirUrl(urlStr, {
    baseUrl: smartConfig.fhirBaseUrl,
    extraAllowedHosts: smartConfig.allowedAuthHosts,
    label,
  }).toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  patientId: string | null;
  scope: string;
}

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

const DEFAULT_SCOPES = [
  'launch/patient',
  'patient/Observation.read',
  'patient/DiagnosticReport.read',
  'patient/Patient.read',
  'offline_access',
];

/**
 * RFC 7636 — code_verifier must be 43-128 chars of [A-Z a-z 0-9 -._~].
 * Using base64url encoding of 64 random bytes → 86 chars, safely in range.
 */
export function generatePKCE(): PKCEChallenge {
  const codeVerifier = base64UrlEncode(randomBytes(64));
  const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());
  const state = base64UrlEncode(randomBytes(24));
  return { codeVerifier, codeChallenge, state };
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Fetch the SMART configuration from /.well-known/smart-configuration.
 * Returns just the authorize + token URLs — everything else is optional.
 */
export async function discoverEndpoints(
  fhirBaseUrl: string,
  allowedAuthHosts: string[] = []
): Promise<{ authorizeUrl: string; tokenUrl: string }> {
  const url = `${fhirBaseUrl.replace(/\/$/, '')}/.well-known/smart-configuration`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `SMART configuration discovery failed: ${response.status} ${response.statusText}`
    );
  }
  const config = (await response.json()) as SMARTConfiguration;
  if (!config.authorization_endpoint || !config.token_endpoint) {
    throw new Error('SMART configuration missing authorization_endpoint or token_endpoint');
  }
  // The endpoints come from the server's well-known doc (attacker-influenceable
  // on a compromised/MITM'd FHIR server). Confine them to the trusted host set
  // before we ever redirect the user or POST the client_secret to them.
  const policy = { baseUrl: fhirBaseUrl, extraAllowedHosts: allowedAuthHosts };
  return {
    authorizeUrl: assertAllowedFhirUrl(config.authorization_endpoint, {
      ...policy,
      label: 'SMART authorization_endpoint',
    }).toString(),
    tokenUrl: assertAllowedFhirUrl(config.token_endpoint, {
      ...policy,
      label: 'SMART token_endpoint',
    }).toString(),
  };
}

/**
 * Build the OAuth authorize URL the frontend should redirect the user to.
 * The caller is responsible for persisting { state, codeVerifier } in a
 * short-lived cache so we can validate + exchange on callback.
 */
export function buildAuthorizationUrl(
  smartConfig: SMARTConfig,
  challenge: PKCEChallenge
): string {
  if (!smartConfig.authorizeUrl) {
    throw new Error('authorizeUrl not resolved — call discoverEndpoints first');
  }
  const scopes = smartConfig.scopes.length > 0 ? smartConfig.scopes : DEFAULT_SCOPES;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: smartConfig.clientId,
    redirect_uri: smartConfig.redirectUri,
    scope: scopes.join(' '),
    state: challenge.state,
    aud: smartConfig.fhirBaseUrl,
    code_challenge: challenge.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${smartConfig.authorizeUrl}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForToken(
  smartConfig: SMARTConfig,
  code: string,
  codeVerifier: string
): Promise<TokenSet> {
  if (!smartConfig.tokenUrl) {
    throw new Error('tokenUrl not resolved — call discoverEndpoints first');
  }
  const tokenUrl = assertSmartEndpoint(smartConfig, smartConfig.tokenUrl, 'SMART token endpoint (code exchange)');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: smartConfig.redirectUri,
    client_id: smartConfig.clientId,
    code_verifier: codeVerifier,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  // Confidential client uses Basic auth for client_secret; public clients
  // (PKCE only, no secret) omit this header.
  if (smartConfig.clientSecret) {
    const creds = Buffer.from(`${smartConfig.clientId}:${smartConfig.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${creds}`;
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Token exchange failed: ${response.status} ${errText.substring(0, 200)}`);
  }
  const data = (await response.json()) as SMARTTokenResponse;
  return tokenSetFromResponse(data);
}

/**
 * Refresh an expired access token using the stored refresh token.
 * Some providers rotate refresh tokens; we accept the new one if present
 * and otherwise retain the old.
 */
export async function refreshAccessToken(
  smartConfig: SMARTConfig,
  refreshToken: string
): Promise<TokenSet> {
  if (!smartConfig.tokenUrl) {
    throw new Error('tokenUrl not resolved — call discoverEndpoints first');
  }
  const tokenUrl = assertSmartEndpoint(smartConfig, smartConfig.tokenUrl, 'SMART token endpoint (refresh)');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: smartConfig.clientId,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (smartConfig.clientSecret) {
    const creds = Buffer.from(`${smartConfig.clientId}:${smartConfig.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${creds}`;
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Token refresh failed: ${response.status} ${errText.substring(0, 200)}`);
  }
  const data = (await response.json()) as SMARTTokenResponse;
  const result = tokenSetFromResponse(data);
  if (!result.refreshToken) {
    // Preserve the old refresh token if the provider didn't rotate.
    result.refreshToken = refreshToken;
  }
  return result;
}

function tokenSetFromResponse(data: SMARTTokenResponse): TokenSet {
  if (!data.access_token) {
    throw new Error('Token response missing access_token');
  }
  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + expiresInSec * 1000),
    patientId: data.patient ?? null,
    scope: data.scope ?? '',
  };
}

/**
 * Best-effort token revocation. Not all servers implement RFC 7009; we
 * swallow failures so disconnection still succeeds when revocation
 * isn't available.
 */
export async function revokeToken(
  smartConfig: SMARTConfig,
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token' = 'access_token'
): Promise<void> {
  if (!smartConfig.tokenUrl) return;
  // Derive the revocation endpoint heuristically — most servers publish
  // it in SMART config as `revocation_endpoint`. Callers that resolved
  // that can pass it via smartConfig. Falling back to replacing /token
  // with /revoke is common but not universal, so we just log-and-skip
  // when unknown.
  try {
    const body = new URLSearchParams({
      token,
      token_type_hint: tokenTypeHint,
      client_id: smartConfig.clientId,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (smartConfig.clientSecret) {
      const creds = Buffer.from(`${smartConfig.clientId}:${smartConfig.clientSecret}`).toString('base64');
      headers.Authorization = `Basic ${creds}`;
    }
    // Use the token endpoint URL replaced with 'revoke' as a fallback —
    // if that 404s, swallow. Re-validate the host before sending the token.
    const revokeUrl = assertSmartEndpoint(
      smartConfig,
      smartConfig.tokenUrl.replace(/\/token$/, '/revoke'),
      'SMART revoke endpoint'
    );
    const response = await fetch(revokeUrl, { method: 'POST', headers, body: body.toString() });
    if (!response.ok) {
      logger.warn('Token revocation request failed', {
        data: { status: response.status },
      });
    }
  } catch (err) {
    logger.warn('Token revocation threw', {
      data: { error: err instanceof Error ? err.message : 'unknown' },
    });
  }
}

// ============================================
// PKCE verifier cache (in-memory, short TTL)
// ============================================

interface CachedChallenge {
  codeVerifier: string;
  userId: string;
  expiresAt: number;
}

const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes per RFC 6749 §10.12 guidance
const challengeCache = new Map<string, CachedChallenge>();

/**
 * Store a PKCE verifier keyed by the OAuth `state` parameter. Used to
 * validate the callback and exchange the returned auth code. Single
 * backend instance only — if this runs across multiple Cloud Run
 * instances we'd need a shared cache (Redis).
 */
export function stashChallenge(state: string, codeVerifier: string, userId: string): void {
  prune();
  challengeCache.set(state, {
    codeVerifier,
    userId,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
}

/**
 * Retrieve + consume a stashed verifier. Returns null if absent or expired.
 */
export function consumeChallenge(
  state: string
): { codeVerifier: string; userId: string } | null {
  const entry = challengeCache.get(state);
  if (!entry) return null;
  challengeCache.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return { codeVerifier: entry.codeVerifier, userId: entry.userId };
}

function prune(): void {
  const now = Date.now();
  for (const [state, entry] of challengeCache) {
    if (entry.expiresAt < now) challengeCache.delete(state);
  }
}
