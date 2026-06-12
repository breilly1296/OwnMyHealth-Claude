import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Importing vite.config.ts pulls in the real 'vite' package, whose esbuild
// dependency refuses to load under the jsdom test environment (cross-realm
// TextEncoder/Uint8Array invariant). rewriteCspConnectSrc is pure, so stub the
// packages vite.config.ts imports — none of them are exercised here.
vi.mock('vite', () => ({
  defineConfig: (config: unknown) => config,
  loadEnv: () => ({}),
}));
vi.mock('@vitejs/plugin-react', () => ({ default: () => ({}) }));

import { rewriteCspConnectSrc } from '../../../vite.config';

// Test against the REAL index.html so any future reformatting of the CSP
// <meta> tag that would break the build-time connect-src rewrite fails CI
// here instead of silently shipping a wrong CSP to staging.
// (vitest's cwd is the project root, where vitest.config.ts lives)
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

const STAGING_ORIGIN = 'https://api-staging.ownmyhealth.io';

describe('rewriteCspConnectSrc', () => {
  it('rewrites connect-src in the real index.html to the staging origin', () => {
    const rewritten = rewriteCspConnectSrc(indexHtml, STAGING_ORIGIN);

    expect(rewritten).toContain(`connect-src 'self' ${STAGING_ORIGIN};`);
    // The shipped prod-origin directive must be gone (the prose comment above
    // the tag still mentions the bare hostnames, which is fine).
    expect(rewritten).not.toContain("connect-src 'self' https://api.ownmyhealth.io");
  });

  it('is idempotent (safe for repeated dev-server transforms)', () => {
    const once = rewriteCspConnectSrc(indexHtml, STAGING_ORIGIN);
    const twice = rewriteCspConnectSrc(once, STAGING_ORIGIN);
    expect(twice).toBe(once);
  });

  it('returns the html byte-identical when apiOrigin is null', () => {
    expect(rewriteCspConnectSrc(indexHtml, null)).toBe(indexHtml);
  });

  it('throws when the meta tag formatting drifts (content= before http-equiv=)', () => {
    const reordered = indexHtml.replace(
      /http-equiv="Content-Security-Policy"(\s+)(content="[^"]*")/,
      '$2$1http-equiv="Content-Security-Policy"'
    );
    // Sanity: the reorder actually changed the document.
    expect(reordered).not.toBe(indexHtml);

    expect(() => rewriteCspConnectSrc(reordered, STAGING_ORIGIN)).toThrow(
      /csp-connect-src: failed to rewrite/
    );
  });

  it('inserts the origin literally — no $-sequence expansion', () => {
    // Real origins never contain '$', but this pins the replacer-FUNCTION
    // behavior: a replacement STRING would expand '$&' to the whole match.
    const rewritten = rewriteCspConnectSrc(indexHtml, '$&');
    expect(rewritten).toContain("connect-src 'self' $&;");
  });
});
