/**
 * UserFile original-filename resolution (L24).
 *
 * The raw client filename can embed PHI, so new rows store AES-256-GCM
 * ciphertext (per-user key) in `originalFilenameEncrypted` and null the plaintext
 * `originalFilename`. Legacy rows (pre-L24, not yet re-encrypted by the backfill
 * job) still hold plaintext. This helper resolves the display value: decrypt the
 * twin when present, falling back to the legacy plaintext (or '') on absence or a
 * decrypt failure so one corrupt/key-mismatched row never throws a whole list.
 */
import type { getEncryptionService } from '../services/encryption.js';

export function decryptOriginalFilename(
  file: { originalFilename?: string | null; originalFilenameEncrypted?: string | null },
  encryption: ReturnType<typeof getEncryptionService>,
  userSalt: string
): string {
  if (file.originalFilenameEncrypted) {
    try {
      return encryption.decrypt(file.originalFilenameEncrypted, userSalt);
    } catch {
      return file.originalFilename ?? '';
    }
  }
  return file.originalFilename ?? '';
}
