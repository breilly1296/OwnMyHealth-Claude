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

/**
 * Gets or creates the user's encryption salt for PHI encryption.
 *
 * @param userId - The user's ID
 * @returns The user's encryption salt (hex string)
 */
export async function getUserEncryptionSalt(userId: string): Promise<string> {
  return withRLSContext(
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
}

/**
 * Rotates a user's encryption key (creates new version, marks old as inactive).
 * Note: This requires re-encrypting all user's PHI with the new key.
 *
 * @param userId - The user's ID
 * @returns Object with old and new salts for re-encryption
 */
export async function rotateUserEncryptionKey(userId: string): Promise<{
  oldSalt: string;
  newSalt: string;
  newVersion: number;
}> {
  const encryptionService = getEncryptionService();

  // The withRLSContext wrapper opens a single Prisma transaction, so the
  // two writes below are atomic — equivalent to the previous explicit
  // prisma.$transaction([...]) call, just with the RLS SET LOCAL applied.
  return withRLSContext(
    null,
    async (tx) => {
      const currentKey = await tx.userEncryptionKey.findFirst({
        where: {
          userId,
          keyType: KEY_TYPE,
          isActive: true,
        },
        orderBy: {
          version: 'desc',
        },
      });

      if (!currentKey) {
        throw new Error('No active encryption key found for user');
      }

      const oldSalt = encryptionService.decryptWithMasterKey(currentKey.encryptedKey);
      const newSalt = encryptionService.generateUserSalt();
      const newVersion = currentKey.version + 1;
      const keyHash = newSalt.substring(0, 64);
      const encryptedNewSalt = encryptionService.encryptWithMasterKey(newSalt);

      await tx.userEncryptionKey.update({
        where: { id: currentKey.id },
        data: {
          isActive: false,
          rotatedAt: new Date(),
        },
      });
      await tx.userEncryptionKey.create({
        data: {
          userId,
          keyType: KEY_TYPE,
          keyHash,
          encryptedKey: encryptedNewSalt,
          version: newVersion,
          isActive: true,
        },
      });

      return { oldSalt, newSalt, newVersion };
    },
    { isAdmin: true }
  );
}

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
