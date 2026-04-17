import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { getSessionMetadata } from './authController.js';

describe('getSessionMetadata', () => {
  function buildReq(overrides: Partial<Request> & {
    ip?: string;
    headers?: Record<string, string>;
  }): Request {
    const headers = overrides.headers ?? {};
    return {
      ip: overrides.ip,
      headers,
      get(name: string) {
        return headers[name.toLowerCase()];
      },
    } as unknown as Request;
  }

  it('uses req.ip rather than the X-Forwarded-For header', () => {
    // F-9: a malicious client sets X-Forwarded-For to spoof the source IP.
    // Express's trust-proxy handling populates req.ip from that header only
    // when configured — our job here is to read req.ip, never the raw header.
    const req = buildReq({
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '8.8.8.8', 'user-agent': 'ua/1.0' },
    });

    const meta = getSessionMetadata(req);

    expect(meta.ipAddress).toBe('10.0.0.1');
    expect(meta.ipAddress).not.toBe('8.8.8.8');
    expect(meta.userAgent).toBe('ua/1.0');
  });

  it('truncates IPv6 to 45 chars and user-agent to 500', () => {
    const longIp = 'a'.repeat(60);
    const longUa = 'u'.repeat(600);
    const req = buildReq({
      ip: longIp,
      headers: { 'user-agent': longUa },
    });

    const meta = getSessionMetadata(req);

    expect(meta.ipAddress).toHaveLength(45);
    expect(meta.userAgent).toHaveLength(500);
  });

  it('returns undefined fields when no IP or user-agent is present', () => {
    const req = buildReq({ headers: {} });
    const meta = getSessionMetadata(req);

    expect(meta.ipAddress).toBeUndefined();
    expect(meta.userAgent).toBeUndefined();
  });
});
