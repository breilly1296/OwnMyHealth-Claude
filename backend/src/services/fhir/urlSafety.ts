/**
 * SSRF / credential-exfiltration guards for outbound FHIR + SMART-on-FHIR URLs.
 *
 * The FHIR server's responses (pagination `link[rel=next]` URLs) and its
 * /.well-known/smart-configuration (authorize / token / revoke endpoints) are
 * attacker-influenceable, yet we attach the patient's Bearer token — and POST
 * the OAuth client_secret — to them. Without validation a malicious or
 * compromised FHIR endpoint (or a MITM on a cleartext hop) could redirect those
 * credentials to an attacker host, or coerce a request at an internal service
 * (e.g. the cloud metadata endpoint 169.254.169.254). These guards confine such
 * URLs to the configured, trusted host(s) and refuse cleartext to public hosts.
 *
 * NOTE: this validates the URL's HOST against an allowlist; it does not pin the
 * resolved IP, so it is not a defense against DNS rebinding of an
 * already-trusted host. The realistic threat — a response pointing credentials
 * at an arbitrary attacker/internal host — is fully blocked by the allowlist.
 */

/** True for IPv4 private/loopback/link-local + IPv6 loopback/ULA/link-local. */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h === 'ip6-localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true; // link-local / ULA
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export interface FhirUrlPolicy {
  /** The trusted FHIR base URL; its host is always allowed. */
  baseUrl: string;
  /** Extra hosts the URL may target (e.g. a separate SMART auth server). */
  extraAllowedHosts?: string[];
  /** Used in error messages. */
  label?: string;
}

/**
 * Validate a server-supplied outbound URL before sending credentials to it.
 * Returns the parsed URL or throws. Rules:
 *  - must parse and be http(s);
 *  - host must be the base host or in extraAllowedHosts (the strong control —
 *    credentials never leave the trusted host set);
 *  - a PUBLIC host must use https (no cleartext credential transport); http is
 *    tolerated only for loopback/private hosts (the local dev mock FHIR server,
 *    which is itself only reachable because it's an explicitly-allowed host).
 */
export function assertAllowedFhirUrl(candidate: string, policy: FhirUrlPolicy): URL {
  const label = policy.label ?? 'FHIR URL';
  let base: URL;
  try {
    base = new URL(policy.baseUrl);
  } catch {
    throw new Error(`${label}: invalid configured FHIR base URL`);
  }
  // Resolve against the base so a server-supplied RELATIVE URL (e.g. the dev
  // mock's "/.../authorize") resolves to the base host (and becomes absolute,
  // which Node fetch requires). An ABSOLUTE candidate ignores the base, so a
  // cross-host attacker URL is still caught by the host allowlist below.
  let target: URL;
  try {
    target = new URL(candidate, base);
  } catch {
    throw new Error(`${label}: not a valid URL`);
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error(`${label}: refusing non-HTTP(S) scheme "${target.protocol}"`);
  }
  const host = target.hostname.toLowerCase();
  const allowed = new Set<string>([
    base.hostname.toLowerCase(),
    ...(policy.extraAllowedHosts ?? []).map((x) => x.toLowerCase()).filter(Boolean),
  ]);
  if (!allowed.has(host)) {
    throw new Error(
      `${label}: host "${host}" is not the trusted FHIR host (${base.hostname}) or an allowed host`
    );
  }
  if (target.protocol === 'http:' && !isPrivateOrLoopbackHost(host)) {
    throw new Error(`${label}: refusing cleartext http to public host "${host}"`);
  }
  return target;
}
