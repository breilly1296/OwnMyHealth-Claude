/**
 * Storage Service - Google Cloud Storage Integration
 *
 * Handles file uploads, downloads, and deletions for user files.
 * Files are stored in GCS with the path: {userId}/{fileId}.{extension}
 *
 * @module services/storageService
 */

import { Storage, GetSignedUrlConfig } from '@google-cloud/storage';
import type { Readable } from 'stream';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// Initialize GCS client
const storage = new Storage({
  projectId: config.gcp?.projectId || process.env.GCP_PROJECT_ID,
});

// Read through `config` rather than `process.env` directly so the
// production fail-fast in `config/index.ts` is the single source of truth
// for whether GCS_BUCKET_NAME is acceptable. Bypassing config (the prior
// behavior) would let a misconfigured prod deploy reach this module before
// the validator ran.
const BUCKET_NAME = config.gcp.bucketName;
const SIGNED_URL_EXPIRATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/tiff': 'tiff',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return mimeToExt[mimeType] || 'bin';
}

/**
 * Upload a file to Google Cloud Storage
 *
 * @param userId - User ID who owns the file
 * @param fileId - Unique file identifier (UUID)
 * @param buffer - File content as Buffer
 * @param mimeType - MIME type of the file
 * @returns Storage key (path in GCS bucket)
 */
export async function uploadFile(
  userId: string,
  fileId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const extension = getExtensionFromMimeType(mimeType);
  const storageKey = `${userId}/${fileId}.${extension}`;

  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(storageKey);

    await file.save(buffer, {
      contentType: mimeType,
      metadata: {
        userId,
        fileId,
        uploadedAt: new Date().toISOString(),
      },
    });

    logger.info('File uploaded to GCS', {
      data: {
        storageKey,
        bucket: BUCKET_NAME,
        size: buffer.length,
      },
    });

    return storageKey;
  } catch (error) {
    logger.error('Failed to upload file to GCS', {
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        storageKey,
        bucket: BUCKET_NAME,
      },
    });
    throw new Error('Failed to upload file to storage');
  }
}

/**
 * Return a Readable stream of a GCS object.
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
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(storageKey);
  return file.createReadStream();
}

/**
 * Generate a signed URL for file access
 *
 * @param storageKey - Path to file in GCS bucket
 * @param action - 'read' for download, 'write' for upload
 * @param expirationMs - URL expiration time in milliseconds (default: 15 minutes)
 * @returns Signed URL for file access
 */
export async function getSignedUrl(
  storageKey: string,
  action: 'read' | 'write' = 'read',
  expirationMs: number = SIGNED_URL_EXPIRATION_MS
): Promise<string> {
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(storageKey);

    const options: GetSignedUrlConfig = {
      version: 'v4',
      action: action,
      expires: Date.now() + expirationMs,
    };

    const [signedUrl] = await file.getSignedUrl(options);

    logger.debug('Generated signed URL', {
      data: {
        storageKey,
        action,
        expiresIn: `${expirationMs / 1000}s`,
      },
    });

    return signedUrl;
  } catch (error) {
    logger.error('Failed to generate signed URL', {
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        storageKey,
        action,
      },
    });
    throw new Error('Failed to generate file access URL');
  }
}

/**
 * Delete a file from Google Cloud Storage
 *
 * @param storageKey - Path to file in GCS bucket
 */
export async function deleteFile(storageKey: string): Promise<void> {
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(storageKey);

    await file.delete();

    logger.info('File deleted from GCS', {
      data: {
        storageKey,
        bucket: BUCKET_NAME,
      },
    });
  } catch (error) {
    // If file doesn't exist, that's okay - it might have been already deleted
    if ((error as { code?: number }).code === 404) {
      logger.warn('File not found in GCS during deletion', { data: { storageKey } });
      return;
    }

    logger.error('Failed to delete file from GCS', {
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        storageKey,
      },
    });
    throw new Error('Failed to delete file from storage');
  }
}

/**
 * Delete multiple files from GCS in parallel.
 *
 * Returns an entry per input storage key, flagging per-file success/failure.
 * Individual failures do NOT throw — the caller decides whether to abort
 * the overall operation based on the results. A 404 (file already gone)
 * counts as `ok: true` — matches single-file `deleteFile` semantics.
 *
 * Used by bulk-deletion paths (`settingsController.deleteAllData` and
 * `deleteAccount`, see C-6) which treat any non-404 GCS failure as a
 * hard abort — preserving DB rows so the user can retry and no PHI is
 * orphaned in the bucket under a now-missing DB pointer.
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
 * Check if a file exists in GCS
 *
 * @param storageKey - Path to file in GCS bucket
 * @returns True if file exists
 */
export async function fileExists(storageKey: string): Promise<boolean> {
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(storageKey);
    const [exists] = await file.exists();
    return exists;
  } catch (error) {
    logger.error('Failed to check file existence', {
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        storageKey,
      },
    });
    return false;
  }
}

/**
 * Storage service object for convenience exports
 */
export const storageService = {
  uploadFile,
  getSignedUrl,
  getFileStream,
  deleteFile,
  deleteFiles,
  fileExists,
};
