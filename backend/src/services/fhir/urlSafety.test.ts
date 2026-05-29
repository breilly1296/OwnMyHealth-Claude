import { describe, it, expect } from 'vitest';
import { assertAllowedFhirUrl, isPrivateOrLoopbackHost } from './urlSafety.js';

const BASE = 'https://api.questdiagnostics.com/fhir/r4';

describe('assertAllowedFhirUrl', () => {
  it('allows an absolute URL on the same host as the base', () => {
    const u = assertAllowedFhirUrl(
      'https://api.questdiagnostics.com/fhir/r4/Observation?_page=2',
      { baseUrl: BASE }
    );
    expect(u.host).toBe('api.questdiagnostics.com');
  });

  it('resolves a relative URL against the base host', () => {
    const u = assertAllowedFhirUrl('/fhir/r4/Observation?_page=2', { baseUrl: BASE });
    expect(u.origin).toBe('https://api.questdiagnostics.com');
  });

  it('rejects an absolute URL on a DIFFERENT host (SSRF / token exfil)', () => {
    expect(() =>
      assertAllowedFhirUrl('https://evil.example.com/steal', { baseUrl: BASE })
    ).toThrow(/not the trusted FHIR host/i);
  });

  it('rejects the cloud metadata endpoint', () => {
    expect(() =>
      assertAllowedFhirUrl('http://169.254.169.254/latest/meta-data/', { baseUrl: BASE })
    ).toThrow();
  });

  it('rejects cleartext http to a public host', () => {
    expect(() =>
      assertAllowedFhirUrl('http://api.questdiagnostics.com/fhir/r4', { baseUrl: BASE })
    ).toThrow(/cleartext/i);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => assertAllowedFhirUrl('file:///etc/passwd', { baseUrl: BASE })).toThrow();
  });

  it('permits a host in the extra auth-host allowlist', () => {
    const u = assertAllowedFhirUrl('https://auth.questdiagnostics.com/oauth/token', {
      baseUrl: BASE,
      extraAllowedHosts: ['auth.questdiagnostics.com'],
    });
    expect(u.host).toBe('auth.questdiagnostics.com');
  });

  it('allows http to the localhost dev mock', () => {
    const devBase = 'http://localhost:3001/api/v1/mock-fhir/r4';
    const u = assertAllowedFhirUrl('/api/v1/mock-fhir/r4/token', { baseUrl: devBase });
    expect(u.origin).toBe('http://localhost:3001');
  });
});

describe('isPrivateOrLoopbackHost', () => {
  it.each(['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '172.16.0.1', 'localhost', '::1', 'fe80::1'])(
    'flags %s as private/loopback',
    (h) => expect(isPrivateOrLoopbackHost(h)).toBe(true)
  );
  it.each(['api.questdiagnostics.com', '8.8.8.8', '172.32.0.1'])(
    'treats %s as public',
    (h) => expect(isPrivateOrLoopbackHost(h)).toBe(false)
  );
});
