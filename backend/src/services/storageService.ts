/**
 * Storage Service — backend-selecting façade (OF-23)
 *
 * The app's single file-storage surface. Delegates to one of two
 * interchangeable backends chosen at boot from `config.storage.backend`:
 *
 *   - 'gcs'   → storage/gcsBackend.ts   (Google Cloud Storage; deployed envs)
 *   - 'local' → storage/localBackend.ts (AES-256-GCM-encrypted local disk;
 *               the development default so the GCP-less sandbox can exercise
 *               upload/download/delete flows)
 *
 * Callers import from THIS module only — controllers, upload handlers, and
 * bulk-deletion paths stay backend-agnostic. The semantics both backends
 * guarantee are documented on StorageBackend (storage/types.ts).
 *
 * @module services/storageService
 */

import type { Readable } from 'stream';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { gcsBackend } from './storage/gcsBackend.js';
import { localBackend } from './storage/localBackend.js';
import type { StorageBackend } from './storage/types.js';

// Resolved lazily on first use, NOT at module load: test files that partially
// mock config (without `storage`) import controllers whose chain loads this
// module. `config.storage` is always defined under real config (validated at
// boot); the optional chain makes an absent mock value select GCS — the
// pre-OF-23 behavior those mocks were written against.
let selectionLogged = false;
function activeBackend(): StorageBackend {
  const useLocal = config.storage?.backend === 'local';
  if (!selectionLogged) {
    selectionLogged = true;
    logger.info('Storage backend selected', {
      data: useLocal
        ? { backend: 'local', dir: config.storage.localDir }
        : { backend: 'gcs', bucket: config.gcp.bucketName },
    });
  }
  return useLocal ? localBackend : gcsBackend;
}

/**
 * Upload a user file.
 *
 * @param userId - User ID who owns the file
 * @param fileId - Unique file identifier (UUID)
 * @param buffer - File content as Buffer
 * @param mimeType - MIME type of the file
 * @returns Storage key (`${userId}/${fileId}.${ext}`)
 */
export async function uploadFile(
  userId: string,
  fileId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  return activeBackend().uploadFile(userId, fileId, buffer, mimeType);
}

/**
 * Return a Readable stream of a stored object.
 *
 * Preferred over `getSignedUrl(..., 'read')` for serving PHI downloads to
 * authenticated users: the signed URL was shareable for 15 minutes with no
 * IP or session binding, which meant anyone who intercepted the link (browser
 * history, referrer header, copy-paste into a ticket) could pull PHI without
 * authenticating. Proxying the bytes through the backend forces every
 * download to pass authenticate + RLS on the way in, and `Cache-Control:
 * no-store` on the way out — see `fileController.getFileDownloadUrl`.
 *
 * The consumer is responsible for piping to the response and handling
 * stream errors; this function does not suppress them.
 */
export function getFileStream(storageKey: string): Readable {
  return activeBackend().getFileStream(storageKey);
}

/**
 * Delete a stored object. An already-missing object counts as success, so
 * retries stay idempotent (F-22).
 */
export async function deleteFile(storageKey: string): Promise<void> {
  return activeBackend().deleteFile(storageKey);
}

/**
 * Delete multiple stored objects in parallel.
 *
 * Returns an entry per input storage key, flagging per-file success/failure.
 * Individual failures do NOT throw — the caller decides whether to abort
 * the overall operation based on the results. An already-missing object
 * counts as `ok: true` — matches single-file `deleteFile` semantics.
 *
 * Used by bulk-deletion paths (`settingsController.deleteAllData` and
 * `deleteAccount`, see C-6) which treat any non-missing storage failure as
 * a hard abort — preserving DB rows so the user can retry and no PHI is
 * orphaned in storage under a now-missing DB pointer.
 */
export async function deleteFiles(
  storageKeys: string[]
): Promise<Array<{ storageKey: string; ok: boolean; error?: string }>> {
  if (storageKeys.length === 0) return [];

  return Promise.all(
    storageKeys.map(async (storageKey) => {
      try {
        await deleteFile(storageKey);
        return { storageKey, ok: true };
      } catch (error) {
        return {
          storageKey,
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })
  );
}

/**
 * Check if a stored object exists. Never throws — errors report false.
 */
export async function fileExists(storageKey: string): Promise<boolean> {
  return activeBackend().fileExists(storageKey);
}

/**
 * Storage service object for convenience exports
 */
export const storageService = {
  uploadFile,
  getFileStream,
  deleteFile,
  deleteFiles,
  fileExists,
};
