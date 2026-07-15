/**
 * Google Cloud Storage Backend
 *
 * Deployed-environment implementation of the StorageBackend contract:
 * objects live in the configured GCS bucket under `${userId}/{fileId}.{ext}`.
 * Selected via `config.storage.backend === 'gcs'` (see storageService.ts).
 */

import { Storage } from '@google-cloud/storage';
import type { Readable } from 'stream';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { buildStorageKey } from './keys.js';
import type { StorageBackend } from './types.js';

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

async function uploadFile(
  userId: string,
  fileId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const storageKey = buildStorageKey(userId, fileId, mimeType);

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

function getFileStream(storageKey: string): Readable {
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(storageKey);
  return file.createReadStream();
}

async function deleteFile(storageKey: string): Promise<void> {
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

async function fileExists(storageKey: string): Promise<boolean> {
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

export const gcsBackend: StorageBackend = {
  uploadFile,
  getFileStream,
  deleteFile,
  fileExists,
};
