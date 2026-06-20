/**
 * User Encryption Service
 *
 * Manages user-specific encryption salts for PHI encryption.
 * Each user gets a unique salt stored in the UserEncryptionKey table,
 * which is used to derive their personal encryption key from the master key.
 *
 * RLS context: all three functions use admin context. The
 * user_encryption_keys RLS policies permit `user_id = current_user_id()
 * OR is_admin_session()` for SELECT/INSERT/UPDATE, but callers of this
 * service (controllers, authService) don't always own an RLS context at
 * the call site — and forcing them to propagate one would mean every
 * caller sprinkles withRLSContext around a salt lookup that's conceptually
 * infrastructure, not user-scoped. Admin-context here keeps the service
 * self-contained. See C-8 Part 2b-i.
 */

import { getEncryptionService } from './encryption.js';
import { withRLSContext } from './database.js';

const KEY_TYPE = 'phi_encryption';

/** True for a Prisma unique-constraint violation (P2002). Matched by name+code
 *  to avoid importing the Prisma error class (mirrors errorHandler). */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === 'PrismaClientKnownRequestError' &&
    (err as { code?: string }).code === 'P2002'
  );
}

/**
 * Gets or creates the user's encryption salt for PHI encryption.
 *
 * Concurrency: find-then-create is not atomic, so a brand-new user's first two
 * PHI operations can both find no key and both attempt to create version 1. The
 * `@@unique(userId, keyType, version)` constraint makes the loser throw P2002
 * (which aborts its transaction). We catch that, re-read in a FRESH transaction,
 * and return the WINNER's persisted salt — never our locally generated one, or
 * the two callers would encrypt with divergent salts and corrupt each other's
 * PHI. The constraint guarantees there is exactly one active version-1 key.
 *
 * @param userId - The user's ID
 * @returns The user's encryption salt (hex string)
 */
export async function getUserEncryptionSalt(userId: string): Promise<string> {
  try {
    return await withRLSContext(
      null,
      async (tx) => {
        const encryptionService = getEncryptionService();

        // Try to find existing active encryption key
        const existingKey = await tx.userEncryptionKey.findFirst({
          where: {
            userId,
            keyType: KEY_TYPE,
            isActive: true,
          },
          orderBy: {
            version: 'desc',
          },
        });

        if (existingKey) {
          // The encryptedKey field stores the salt encrypted with master key
          return encryptionService.decryptWithMasterKey(existingKey.encryptedKey);
        }

        // No key exists - create a new one
        const newSalt = encryptionService.generateUserSalt();
        const keyHash = newSalt.substring(0, 64);
        const encryptedSalt = encryptionService.encryptWithMasterKey(newSalt);

        await tx.userEncryptionKey.create({
          data: {
            userId,
            keyType: KEY_TYPE,
            keyHash,
            encryptedKey: encryptedSalt,
            version: 1,
            isActive: true,
          },
        });

        return newSalt;
      },
      { isAdmin: true }
    );
  } catch (err) {
    // A concurrent first-write won the create; our create lost the unique race.
    // Re-read in a fresh admin tx and return the winner's persisted salt.
    if (!isUniqueViolation(err)) throw err;
    return withRLSContext(
      null,
      async (tx) => {
        const encryptionService = getEncryptionService();
        const winner = await tx.userEncryptionKey.findFirst({
          where: { userId, keyType: KEY_TYPE, isActive: true },
          orderBy: { version: 'desc' },
        });
        if (!winner) throw err;
        return encryptionService.decryptWithMasterKey(winner.encryptedKey);
      },
      { isAdmin: true }
    );
  }
}

// NOTE: A key-rotation helper used to live here. It rotated the key VERSION
// (new salt, old marked inactive) but did NOT re-encrypt the user's existing
// PHI, so calling it without a paired full re-encryption pass would have
// bricked all of that user's encrypted data. It had no callers. Removed to
// eliminate the footgun; proper key rotation should be a dedicated job that
// re-encrypts every PHI column across all tables in one transaction. The
// `KEY_ROTATION` AuditAction enum value is retained for that future work.

/**
 * Validates that a user has an encryption key set up.
 *
 * @param userId - The user's ID
 * @returns True if user has an active encryption key
 */
export async function hasUserEncryptionKey(userId: string): Promise<boolean> {
  return withRLSContext(
    null,
    async (tx) => {
      const key = await tx.userEncryptionKey.findFirst({
        where: {
          userId,
          keyType: KEY_TYPE,
          isActive: true,
        },
      });

      return key !== null;
    },
    { isAdmin: true }
  );
}
