/**
 * Local storage backend (OF-23) — tests against a real temp-directory root:
 * roundtrip fidelity, encryption-at-rest, tamper detection (GCM), delete
 * idempotency, and storage-key containment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { createLocalBackend } from './localBackend.js';
import { isValidStorageKey } from './keys.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk as Buffer));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

describe('localBackend', () => {
  let root: string;
  let backend: ReturnType<typeof createLocalBackend>;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'omh-local-storage-'));
    backend = createLocalBackend(root);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('round-trips upload → stream back to the original bytes', async () => {
    const plaintext = Buffer.concat([
      Buffer.from('%PDF-1.4 PLAINTEXT-MARKER '),
      crypto.randomBytes(64 * 1024),
    ]);

    const key = await backend.uploadFile(USER_ID, FILE_ID, plaintext, 'application/pdf');
    expect(key).toBe(`${USER_ID}/${FILE_ID}.pdf`);

    const downloaded = await collect(backend.getFileStream(key));
    expect(downloaded.equals(plaintext)).toBe(true);
  });

  it('stores an encrypted envelope on disk, never plaintext', async () => {
    const plaintext = Buffer.from('PLAINTEXT-MARKER glucose 95 mg/dL');
    const key = await backend.uploadFile(USER_ID, FILE_ID, plaintext, 'application/pdf');

    const raw = await fsp.readFile(path.join(root, key));
    // Envelope: magic 'OMHL' + version 0x01 + iv(16) + tag(16) = 37-byte header.
    expect(raw.subarray(0, 4).toString('ascii')).toBe('OMHL');
    expect(raw[4]).toBe(0x01);
    expect(raw.length).toBe(plaintext.length + 37);
    expect(raw.includes(Buffer.from('PLAINTEXT-MARKER'))).toBe(false);
  });

  it('errors the stream when ciphertext is tampered with (GCM auth)', async () => {
    const key = await backend.uploadFile(
      USER_ID,
      FILE_ID,
      Buffer.from('sensitive bytes'),
      'application/pdf'
    );
    const abs = path.join(root, key);
    const raw = await fsp.readFile(abs);
    raw[raw.length - 1] ^= 0xff; // flip a ciphertext bit
    await fsp.writeFile(abs, raw);

    await expect(collect(backend.getFileStream(key))).rejects.toThrow();
  });

  it('errors the stream on an unrecognized or truncated envelope', async () => {
    const key = `${USER_ID}/${FILE_ID}.pdf`;
    const abs = path.join(root, key);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, Buffer.from('not an OMHL envelope'));

    await expect(collect(backend.getFileStream(key))).rejects.toThrow(/format|truncated/i);
  });

  it('errors the stream (no sync throw) for a missing object', async () => {
    const stream = backend.getFileStream(`${USER_ID}/${FILE_ID}.pdf`);
    await expect(collect(stream)).rejects.toThrow();
  });

  it('deletes idempotently — an already-missing object is success', async () => {
    const key = await backend.uploadFile(USER_ID, FILE_ID, Buffer.from('x'), 'image/png');
    expect(await backend.fileExists(key)).toBe(true);

    await backend.deleteFile(key);
    expect(await backend.fileExists(key)).toBe(false);

    await expect(backend.deleteFile(key)).resolves.toBeUndefined();
  });

  it('contains path traversal — hostile keys never escape the root', async () => {
    // A file outside the root that a traversal key would reach.
    const outside = path.join(root, '..', `omh-escape-${path.basename(root)}`);
    await fsp.writeFile(outside, 'outside');

    try {
      const hostile = `../${path.basename(outside)}`;
      expect(isValidStorageKey(hostile)).toBe(false);

      await expect(collect(backend.getFileStream(hostile))).rejects.toThrow(
        /invalid storage key/i
      );
      expect(await backend.fileExists(hostile)).toBe(false);
      // Delete treats an unresolvable key as already gone (C-6 idempotency)…
      await expect(backend.deleteFile(hostile)).resolves.toBeUndefined();
      // …and the outside file is untouched.
      await expect(fsp.readFile(outside, 'utf8')).resolves.toBe('outside');

      // Upload refuses hostile segments outright.
      await expect(
        backend.uploadFile('..', '..', Buffer.from('x'), 'application/pdf')
      ).rejects.toThrow(/failed to upload/i);
    } finally {
      await fsp.rm(outside, { force: true });
    }
  });

  it('maps unknown mime types to .bin', async () => {
    const key = await backend.uploadFile(
      USER_ID,
      FILE_ID,
      Buffer.from('x'),
      'application/x-unknown'
    );
    expect(key.endsWith('.bin')).toBe(true);
  });
});
