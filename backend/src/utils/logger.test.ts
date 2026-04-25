/**
 * logger sanitizeData — F-21 regression coverage for arrays-of-objects.
 *
 * Pre-F-21 the sanitizer skipped arrays entirely: a `biomarkers: [...]`
 * payload with PHI inside each element would log straight through. This
 * test pins the array-recursion contract by feeding the live `logger.error`
 * a mixed-shape object and asserting that the captured `console.error`
 * argument contains `[REDACTED]` for sensitive keys at every depth.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture console.error output. The logger writes structured JSON via
// `process.stdout.write` for prod / `console.<level>` for dev — the test
// env defaults to dev (NODE_ENV='test'), which routes to `console.error`.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('logger.sanitizeData — array recursion (F-21)', () => {
  // Note: SENSITIVE_FIELDS contains a mix of lowercase and camelCase keys
  // and the matcher does `.has(key.toLowerCase())`, so only the lowercase
  // entries (token, password, secret, ssn, email, etc.) actually fire on a
  // camelCased input. The camelCase-vs-lowercase drift on `*Encrypted`
  // keys is tracked separately in `PHI_TAXONOMY.md` (Logger redaction
  // drift) and is NOT what F-21 fixed. F-21 was about array recursion —
  // these tests pin that contract using `token` and `password`, which DO
  // match the matcher cleanly.

  it('redacts sensitive fields inside an array of objects', async () => {
    const { logger } = await import('./logger.js');

    logger.error('test array shape', {
      data: {
        sessions: [
          { name: 'session-A', token: 'BEARER-A' },
          { name: 'session-B', token: 'BEARER-B' },
        ],
      },
    });

    // The structured payload that hits console.error is a JSON object;
    // serialize and grep so we don't need to know its exact shape.
    const captured = JSON.stringify(consoleErrorSpy.mock.calls);
    expect(captured).toContain('[REDACTED]');
    expect(captured).not.toContain('BEARER-A');
    expect(captured).not.toContain('BEARER-B');
    // Non-sensitive sibling key passes through.
    expect(captured).toContain('session-A');
    expect(captured).toContain('session-B');
  });

  it('redacts sensitive fields nested deeper than one array level', async () => {
    const { logger } = await import('./logger.js');

    logger.error('deeply nested', {
      data: {
        report: {
          sections: [
            {
              category: 'auth',
              entries: [
                { name: 'login-1', password: 'SECRET-PW-1' },
                { name: 'login-2', password: 'SECRET-PW-2' },
              ],
            },
          ],
        },
      },
    });

    const captured = JSON.stringify(consoleErrorSpy.mock.calls);
    expect(captured).not.toContain('SECRET-PW-1');
    expect(captured).not.toContain('SECRET-PW-2');
    expect(captured).toContain('[REDACTED]');
    // Top-level non-sensitive keys still reachable for diagnostic context.
    expect(captured).toContain('auth');
  });

  it('handles primitive arrays without breaking (string/number)', async () => {
    const { logger } = await import('./logger.js');

    logger.error('primitives in array', {
      data: {
        ids: ['a', 'b', 'c'],
        counts: [1, 2, 3],
      },
    });

    const captured = JSON.stringify(consoleErrorSpy.mock.calls);
    // No redaction attempt on primitives — they pass through.
    expect(captured).toContain('"a"');
    expect(captured).toContain('"b"');
    // Numbers aren't quoted in JSON output.
    expect(captured).toMatch(/\b1\b/);
  });
});
