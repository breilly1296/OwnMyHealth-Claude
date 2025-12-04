/**
 * User Encryption Service
 *
 * Manages user-specific encryption salts for PHI encryption.
 * Each user gets a unique salt stored in the UserEncryptionKey table,
 * which is used to derive their personal encryption key from the master key.
 */

import { getEncryptionService } from './encryption.js';
import { getPrismaClient } from './database.js';

const KEY_TYPE = 'phi_encryption';

/**
 * Gets or creates the user's encryption salt for PHI encryption.
 *
 * @param userId - The user's ID
 * @returns The user's encryption salt (hex string)
 */
export async function getUserEncryptionSalt(userId: string): Promise<string> {
  const prisma = getPrismaClient();

  // Try to find existing active encryption key
  const existingKey = await prisma.userEncryptionKey.findFirst({
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
    const encryptionService = getEncryptionService();
    return encryptionService.decryptWithMasterKey(existingKey.encryptedKey);
  }

  // No key exists - create a new one
  const encryptionService = getEncryptionService();
  const newSalt = encryptionService.generateUserSalt();

  // Create hash for verification (first 64 chars of salt for lookup)
  const keyHash = newSalt.substring(0, 64);

  // Encrypt the salt with master key before storing
  const encryptedSalt = encryptionService.encryptWithMasterKey(newSalt);

  await prisma.userEncryptionKey.create({
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
  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();

  // Get current active key
  const currentKey = await prisma.userEncryptionKey.findFirst({
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

  // Decrypt the old salt from storage
  const oldSalt = encryptionService.decryptWithMasterKey(currentKey.encryptedKey);
  const newSalt = encryptionService.generateUserSalt();
  const newVersion = currentKey.version + 1;
  const keyHash = newSalt.substring(0, 64);

  // Encrypt the new salt before storing
  const encryptedNewSalt = encryptionService.encryptWithMasterKey(newSalt);

  // Use transaction to ensure atomic update
  await prisma.$transaction([
    // Mark old key as inactive
    prisma.userEncryptionKey.update({
      where: { id: currentKey.id },
      data: {
        isActive: false,
        rotatedAt: new Date(),
      },
    }),
    // Create new key with encrypted salt
    prisma.userEncryptionKey.create({
      data: {
        userId,
        keyType: KEY_TYPE,
        keyHash,
        encryptedKey: encryptedNewSalt,
        version: newVersion,
        isActive: true,
      },
    }),
  ]);

  return { oldSalt, newSalt, newVersion };
}

/**
 * Validates that a user has an encryption key set up.
 *
 * @param userId - The user's ID
 * @returns True if user has an active encryption key
 */
export async function hasUserEncryptionKey(userId: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const key = await prisma.userEncryptionKey.findFirst({
    where: {
      userId,
      keyType: KEY_TYPE,
      isActive: true,
    },
  });

  return key !== null;
}
