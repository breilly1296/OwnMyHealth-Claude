/**
 * Storage backend contract (OF-23).
 *
 * Two implementations exist:
 *   - gcsBackend   — Google Cloud Storage (deployed environments)
 *   - localBackend — AES-256-GCM-encrypted files on local disk (sandbox)
 *
 * `storageService.ts` selects one at boot from `config.storage.backend` and
 * re-exports the same function surface the rest of the app has always used.
 * Backends MUST keep these semantics aligned:
 *   - uploadFile resolves to the storage key `${userId}/${fileId}.${ext}`
 *   - getFileStream returns a Readable synchronously; failures (missing
 *     object, corrupt content) surface as 'error' events on the stream
 *   - deleteFile treats an already-missing object as success — the F-22
 *     delete-first invariant relies on retries being idempotent
 *   - fileExists never throws; unknown/error states report false
 */

import type { Readable } from 'stream';

export interface StorageBackend {
  uploadFile(
    userId: string,
    fileId: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string>;
  getFileStream(storageKey: string): Readable;
  deleteFile(storageKey: string): Promise<void>;
  fileExists(storageKey: string): Promise<boolean>;
}
