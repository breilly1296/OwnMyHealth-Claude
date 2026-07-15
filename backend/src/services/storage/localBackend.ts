/**
 * Local-Disk Storage Backend (OF-23)
 *
 * Sandbox implementation of the StorageBackend contract: stores user files as
 * AES-256-GCM-encrypted blobs on local disk so upload/download/delete flows
 * work with zero GCP dependency.
 *
 * Encryption at rest: GCS gave files provider-managed encryption at rest; a
 * bare writeFile would leave plaintext PHI scattered across the dev machine —
 * exactly the residue class OF-03 tracked in prod. Every blob is therefore
 * sealed with the master PHI key before it touches disk:
 *
 *   [ magic 'OMHL' | version 0x01 | iv (16) | authTag (16) | ciphertext ]
 *
 * The master PHI_ENCRYPTION_KEY is used directly (no per-user PBKDF2):
 * getFileStream(storageKey) has no user context, and a 600k-iteration
 * derivation per file op would be pure overhead for an at-rest guarantee.
 * GCM authenticates the bytes; plaintext streams out as it decrypts, so a
 * tampered blob errors the stream when the tag check fails at the end rather
 * than up front — acceptable for an owner-only proxy download.
 *
 * config/index.ts refuses `STORAGE_BACKEND=local` in production/staging:
 * deployed (Cloud Run) disks are ephemeral and must never hold PHI files.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { validateEncryptionKey } from '../encryption.js';
import { buildStorageKey, isValidStorageKey } from './keys.js';
import type { StorageBackend } from './types.js';

const MAGIC = Buffer.from('OMHL', 'ascii');
const FORMAT_VERSION = 0x01;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + 1 + IV_LENGTH + TAG_LENGTH;

/** Resolve the master PHI key lazily per operation, so a sandbox without the
 *  key still boots and only the storage call fails with a pointed message. */
function getMasterKey(): Buffer {
  const raw = process.env.PHI_ENCRYPTION_KEY;
  const check = validateEncryptionKey(raw);
  if (!check.valid) {
    throw new Error(
      `Local storage backend requires a valid PHI_ENCRYPTION_KEY: ${check.error}`
    );
  }
  return Buffer.from(raw as string, 'hex');
}

/**
 * Build a backend rooted at `rootDir`. Exported for tests (temp roots);
 * runtime code uses the `localBackend` instance below.
 */
export function createLocalBackend(rootDir: string): StorageBackend {
  /** Keys are app-built (`uuid/uuid.ext`), but delete/stream receive them
   *  from DB rows — validate shape AND resolved-path containment so a
   *  corrupted key can never escape rootDir. */
  function resolvePath(storageKey: string): string {
    if (!isValidStorageKey(storageKey)) {
      throw new Error('Invalid storage key');
    }
    const abs = path.resolve(rootDir, storageKey);
    if (!abs.startsWith(path.resolve(rootDir) + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return abs;
  }

  async function uploadFile(
    userId: string,
    fileId: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string> {
    const storageKey = buildStorageKey(userId, fileId, mimeType);

    try {
      const abs = resolvePath(storageKey);
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey(), iv);
      const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
      const header = Buffer.concat([
        MAGIC,
        Buffer.from([FORMAT_VERSION]),
        iv,
        cipher.getAuthTag(),
      ]);

      await fsp.mkdir(path.dirname(abs), { recursive: true });
      // tmp + rename so a crash mid-write can't leave a torn blob at the key.
      const tmp = `${abs}.tmp-${crypto.randomBytes(4).toString('hex')}`;
      await fsp.writeFile(tmp, Buffer.concat([header, ciphertext]), {
        flag: 'wx',
        mode: 0o600,
      });
      await fsp.rename(tmp, abs);

      logger.info('File uploaded to local storage', {
        data: { storageKey, size: buffer.length },
      });

      return storageKey;
    } catch (error) {
      logger.error('Failed to upload file to local storage', {
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
          storageKey,
        },
      });
      throw new Error('Failed to upload file to storage');
    }
  }

  function getFileStream(storageKey: string): Readable {
    const out = new PassThrough();

    void (async () => {
      const abs = resolvePath(storageKey);

      // Read + validate the envelope header, then stream-decrypt the rest.
      const fh = await fsp.open(abs, 'r');
      const header = Buffer.alloc(HEADER_LENGTH);
      try {
        const { bytesRead } = await fh.read(header, 0, HEADER_LENGTH, 0);
        if (bytesRead < HEADER_LENGTH) {
          throw new Error('Stored file is truncated');
        }
      } finally {
        await fh.close();
      }

      if (
        !header.subarray(0, MAGIC.length).equals(MAGIC) ||
        header[MAGIC.length] !== FORMAT_VERSION
      ) {
        throw new Error('Stored file has an unrecognized format');
      }

      const iv = header.subarray(MAGIC.length + 1, MAGIC.length + 1 + IV_LENGTH);
      const tag = header.subarray(MAGIC.length + 1 + IV_LENGTH, HEADER_LENGTH);
      const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey(), iv);
      decipher.setAuthTag(tag);

      await pipeline(
        fs.createReadStream(abs, { start: HEADER_LENGTH }),
        decipher,
        out
      );
    })().catch((error: Error) => {
      // Surface every failure (missing file, bad header, GCM tag mismatch) as
      // a stream error — same contract consumers already handle for GCS.
      out.destroy(error);
    });

    return out;
  }

  async function deleteFile(storageKey: string): Promise<void> {
    let abs: string;
    try {
      abs = resolvePath(storageKey);
    } catch {
      // A malformed key can't reference anything under this backend; matching
      // the GCS 404 semantics keeps bulk deletion (C-6) idempotent instead of
      // aborting account deletion over an unresolvable pointer.
      logger.warn('Invalid storage key during local deletion — treating as already deleted', {
        data: { storageKey },
      });
      return;
    }

    try {
      await fsp.unlink(abs);
      logger.info('File deleted from local storage', { data: { storageKey } });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn('File not found in local storage during deletion', {
          data: { storageKey },
        });
        return;
      }

      logger.error('Failed to delete file from local storage', {
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
          storageKey,
        },
      });
      throw new Error('Failed to delete file from storage');
    }
  }

  async function fileExists(storageKey: string): Promise<boolean> {
    try {
      await fsp.access(resolvePath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  return { uploadFile, getFileStream, deleteFile, fileExists };
}

/**
 * Default instance rooted at config.storage.localDir (backend/.local-storage).
 *
 * Built lazily on first use, NOT at module load: test files that partially
 * mock config (without `storage`) import controllers whose chain loads this
 * module, and an eager `config.storage.localDir` read would crash their
 * collection. Real config always defines `storage` (validated at boot).
 */
let defaultInstance: StorageBackend | null = null;
function getDefaultInstance(): StorageBackend {
  defaultInstance ??= createLocalBackend(config.storage.localDir);
  return defaultInstance;
}

export const localBackend: StorageBackend = {
  uploadFile: (userId, fileId, buffer, mimeType) =>
    getDefaultInstance().uploadFile(userId, fileId, buffer, mimeType),
  getFileStream: (storageKey) => getDefaultInstance().getFileStream(storageKey),
  deleteFile: (storageKey) => getDefaultInstance().deleteFile(storageKey),
  fileExists: (storageKey) => getDefaultInstance().fileExists(storageKey),
};
