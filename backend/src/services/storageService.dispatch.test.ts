/**
 * storageService façade (OF-23) — verifies backend selection by driving the
 * real local backend through the façade's public surface. Env is staged
 * BEFORE the dynamic import (vitest isolates module state per test file) so
 * config resolves STORAGE_BACKEND / LOCAL_STORAGE_DIR set here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USER_ID = '33333333-3333-4333-8333-333333333333';

describe('storageService façade — local backend dispatch', () => {
  let root: string;
  let svc: typeof import('./storageService.js');

  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'omh-storage-facade-'));
    process.env.STORAGE_BACKEND = 'local';
    process.env.LOCAL_STORAGE_DIR = root;
    svc = await import('./storageService.js');
  });

  afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true });
    delete process.env.STORAGE_BACKEND;
    delete process.env.LOCAL_STORAGE_DIR;
  });

  it('uploads through the façade into LOCAL_STORAGE_DIR and streams back', async () => {
    const plaintext = Buffer.from('facade roundtrip payload');
    const key = await svc.uploadFile(
      USER_ID,
      '44444444-4444-4444-8444-444444444444',
      plaintext,
      'application/pdf'
    );

    // Blob landed under the configured local root, as an encrypted envelope.
    const raw = await fsp.readFile(path.join(root, key));
    expect(raw.subarray(0, 4).toString('ascii')).toBe('OMHL');

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = svc.getFileStream(key);
      stream.on('data', (chunk) => chunks.push(chunk as Buffer));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    expect(Buffer.concat(chunks).equals(plaintext)).toBe(true);
    expect(await svc.fileExists(key)).toBe(true);
  });

  it('deleteFiles aggregates per-key results with missing-as-success', async () => {
    const key = await svc.uploadFile(
      USER_ID,
      '55555555-5555-4555-8555-555555555555',
      Buffer.from('x'),
      'image/png'
    );
    const missing = `${USER_ID}/66666666-6666-4666-8666-666666666666.png`;

    const results = await svc.deleteFiles([key, missing]);
    expect(results).toEqual([
      { storageKey: key, ok: true },
      { storageKey: missing, ok: true },
    ]);
    expect(await svc.fileExists(key)).toBe(false);

    expect(await svc.deleteFiles([])).toEqual([]);
  });
});
