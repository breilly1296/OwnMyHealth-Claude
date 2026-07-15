/**
 * Storage-key construction & validation shared by every backend.
 *
 * Keys are always `${userId}/${fileId}.${ext}` with app-generated UUID
 * segments. `isValidStorageKey` is the allowlist the local backend enforces
 * before touching the filesystem (exactly two dot-free segments, short alnum
 * extension) — GCS treats keys as opaque strings, so validating here keeps
 * the two backends interchangeable.
 */

/** Map MIME type → file extension (mirrors the upload allowlist in
 *  controllers/upload/shared.ts SUPPORTED_MIME_TYPES). */
const MIME_TO_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/tiff': 'tiff',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function getExtensionFromMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] || 'bin';
}

export function buildStorageKey(
  userId: string,
  fileId: string,
  mimeType: string
): string {
  return `${userId}/${fileId}.${getExtensionFromMimeType(mimeType)}`;
}

// Two dot-free segments joined by exactly one '/', then a short alphanumeric
// extension. Rejects '..', absolute paths, backslashes, and nested dirs — a
// corrupted or hostile key from a DB row must never escape the storage root.
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.[A-Za-z0-9]+$/;

export function isValidStorageKey(storageKey: string): boolean {
  return STORAGE_KEY_PATTERN.test(storageKey);
}
