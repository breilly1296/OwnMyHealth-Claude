/**
 * csrf middleware — F-5 exemption-list regression test.
 *
 * Two invariants:
 *   1. Upload routes (lab-report, insurance-sbc, lab-results-ocr,
 *      insurance/upload-sbc) are NOT exempt anymore. POSTing to them
 *      without an X-CSRF-Token must throw ForbiddenError before the
 *      handler ever runs. The frontend's uploadUtils.ts attaches the
 *      header, so this only catches paths that forget to do so.
 *   2. The bearer-only streaming exemption (/ai/chat) still works.
 *      That route uses requireBearerAuth (cookie-auth rejected at the
 *      route layer), so the CSRF exemption is safe — but only there.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: {
    isDevelopment: false,
    cookie: { secure: false, sameSite: 'lax' as const, domain: undefined },
  },
}));

import type { Request, Response, NextFunction } from 'express';
import { validateCsrfToken } from './csrf.js';
import { ForbiddenError } from './errorHandler.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    path: '/api/v1/ping',
    cookies: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function callMiddleware(req: Request): { error: unknown; nextCalled: boolean } {
  let nextCalled = false;
  let error: unknown = null;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  try {
    validateCsrfToken(req, {} as Response, next);
  } catch (e) {
    error = e;
  }
  return { error, nextCalled };
}

describe('validateCsrfToken — upload routes are no longer exempt (F-5)', () => {
  const uploadPaths = [
    '/api/v1/upload/lab-report',
    '/api/v1/upload/insurance-sbc',
    '/api/v1/upload/lab-results-ocr',
    '/api/v1/insurance/upload-sbc',
  ];

  for (const path of uploadPaths) {
    it(`POST ${path} without CSRF token throws ForbiddenError`, () => {
      const { error, nextCalled } = callMiddleware(makeReq({ path }));
      expect(nextCalled).toBe(false);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).message).toMatch(/CSRF token missing/);
    });

    it(`POST ${path} with matching cookie + header passes`, () => {
      const token = 'a'.repeat(64);
      const { error, nextCalled } = callMiddleware(
        makeReq({
          path,
          cookies: { csrf_token: token },
          headers: { 'x-csrf-token': token },
        })
      );
      expect(error).toBeNull();
      expect(nextCalled).toBe(true);
    });

    it(`POST ${path} with mismatched cookie/header throws ForbiddenError`, () => {
      const { error, nextCalled } = callMiddleware(
        makeReq({
          path,
          cookies: { csrf_token: 'a'.repeat(64) },
          headers: { 'x-csrf-token': 'b'.repeat(64) },
        })
      );
      expect(nextCalled).toBe(false);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).message).toMatch(/Invalid CSRF token/);
    });
  }
});

describe('validateCsrfToken — bearer-only streaming exemption preserved', () => {
  it('POST /api/v1/ai/chat without CSRF token still passes (bearer-only)', () => {
    // /ai/chat is intentionally exempt — see csrf.ts for the safety
    // contract. requireBearerAuth at the route layer rejects cookie auth,
    // closing the CSRF window.
    const { error, nextCalled } = callMiddleware(
      makeReq({ path: '/api/v1/ai/chat' })
    );
    expect(error).toBeNull();
    expect(nextCalled).toBe(true);
  });
});

describe('validateCsrfToken — public auth routes stay exempt', () => {
  for (const path of ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/refresh']) {
    it(`POST ${path} without CSRF token passes (pre-auth path)`, () => {
      const { error, nextCalled } = callMiddleware(makeReq({ path }));
      expect(error).toBeNull();
      expect(nextCalled).toBe(true);
    });
  }
});

describe('validateCsrfToken — constant-time comparison (F-17)', () => {
  // Pre-fix: the middleware threw 'Invalid CSRF token' as soon as
  // cookie.length !== header.length, leaking the cookie length via timing.
  // Post-fix: both inputs are SHA-256 hashed, then timingSafeEqual runs on
  // the fixed-size digests. Length mismatch produces the same rejection
  // path as a hash mismatch, with no early-throw branch.
  it('rejects mismatched-length tokens without throwing the length-only branch', () => {
    const { error, nextCalled } = callMiddleware(
      makeReq({
        path: '/api/v1/biomarkers',
        cookies: { csrf_token: 'a'.repeat(64) },
        // Different length — pre-fix this short-circuited via the length check.
        headers: { 'x-csrf-token': 'b'.repeat(32) },
      })
    );

    expect(nextCalled).toBe(false);
    expect(error).toBeInstanceOf(ForbiddenError);
    // The only rejection path now is the post-hash compare; both branches
    // surface the same 'Invalid CSRF token' message regardless of length.
    expect((error as ForbiddenError).message).toMatch(/Invalid CSRF token/);
  });

  it('rejects equal-length but differing tokens via the constant-time compare', () => {
    const { error, nextCalled } = callMiddleware(
      makeReq({
        path: '/api/v1/biomarkers',
        cookies: { csrf_token: 'a'.repeat(64) },
        headers: { 'x-csrf-token': 'b'.repeat(64) },
      })
    );

    expect(nextCalled).toBe(false);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).message).toMatch(/Invalid CSRF token/);
  });

  it('accepts identical tokens of any length (hash-then-compare)', () => {
    // The hash-then-compare path makes the comparison length-agnostic on
    // input. A 16-byte token is just as valid as a 64-byte token as long
    // as both sides match.
    const token = 'short-token-16ch';
    const { error, nextCalled } = callMiddleware(
      makeReq({
        path: '/api/v1/biomarkers',
        cookies: { csrf_token: token },
        headers: { 'x-csrf-token': token },
      })
    );

    expect(error).toBeNull();
    expect(nextCalled).toBe(true);
  });
});
