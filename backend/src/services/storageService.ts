/**
 * Storage Service - Google Cloud Storage Integration
 *
 * Handles file uploads, downloads, and deletions for user files.
 * Files are stored in GCS with the path: {userId}/{fileId}.{extension}
 *
 * @module services/storageService
 */

import { Storage, GetSignedUrlConfig } from '@google-cloud/storage';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// Initialize GCS client
const storage = new Storage({
  projectId: config.gcp?.projectId || process.env.GCP_PROJECT_ID,
});

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'ownmyhealth-user-files';
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
  deleteFile,
  fileExists,
};
