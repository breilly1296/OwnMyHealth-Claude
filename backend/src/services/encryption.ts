/**
 * encryption.ts - PHI Encryption Service
 *
 * This module provides HIPAA-compliant encryption for Protected Health Information (PHI).
 * All sensitive user data is encrypted at the application layer before being stored
 * in the database, providing an additional security layer beyond database encryption.
 *
 * Encryption Method: AES-256-GCM (Authenticated Encryption)
 * - AES-256: Industry-standard symmetric encryption
 * - GCM Mode: Provides both confidentiality and integrity (authentication tag)
 * - Each encryption produces unique ciphertext (random IV)
 *
 * Key Management:
 * - Master key stored in environment variable (PHI_ENCRYPTION_KEY)
 * - Per-user keys derived using PBKDF2-SHA512 with user-specific salt
 * - User salts stored encrypted with master key
 *
 * Data Format:
 * - Encrypted data stored as: iv:authTag:ciphertext (base64 encoded)
 * - IV (16 bytes) ensures same plaintext produces different ciphertext
 * - Auth tag (16 bytes) ensures data integrity and authenticity
 *
 * PHI Fields Protected:
 * - User: name, DOB, phone, address
 * - Biomarker: values, notes
 * - Insurance: member ID, group ID
 * - DNA: genotype data, recommendations
 * - Health Needs: descriptions, action plans
 *
 * Security Requirements:
 * - Key must be 256 bits (64 hex characters)
 * - Production blocks known weak/placeholder keys
 * - Service fails to start if key is invalid
 *
 * Usage:
 * ```typescript
 * const encryption = getEncryptionService();
 * const encrypted = encryption.encrypt('sensitive data', userSalt);
 * const decrypted = encryption.decrypt(encrypted, userSalt);
 * ```
 *
 * @module services/encryption
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';

// ============================================
// ENCRYPTION CONFIGURATION
// ============================================

/** Encryption algorithm: AES-256 in GCM mode for authenticated encryption */
const ALGORITHM = 'aes-256-gcm';

/** Initialization vector length in bytes (128 bits for AES) */
const IV_LENGTH = 16;

/** Salt length in bytes for user key derivation */
const SALT_LENGTH = 32;

/** Derived key length in bytes (256 bits for AES-256) */
const KEY_LENGTH = 32;

/** PBKDF2 iterations for key derivation (OWASP recommended minimum) */
const PBKDF2_ITERATIONS = 100000;

/** Minimum master key length (64 hex chars = 256 bits) */
const MIN_KEY_LENGTH = 64;

// Known insecure/placeholder keys that should never be used in production
const INSECURE_KEYS = [
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  '0000000000000000000000000000000000000000000000000000000000000000',
];

/**
 * Validates the PHI encryption key format and security
 * @returns Object with validation result and error message if invalid
 */
export function validateEncryptionKey(key: string | undefined): { valid: boolean; error?: string } {
  const isProduction = process.env.NODE_ENV === 'production';

  // Check if key is provided
  if (!key) {
    return {
      valid: false,
      error: 'PHI_ENCRYPTION_KEY environment variable is not set',
    };
  }

  // Check minimum length (64 hex chars = 256 bits)
  if (key.length < MIN_KEY_LENGTH) {
    return {
      valid: false,
      error: `PHI_ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} hex characters (256 bits). Current length: ${key.length}`,
    };
  }

  // Validate hex format (only 0-9, a-f, A-F)
  const hexRegex = /^[0-9a-fA-F]+$/;
  if (!hexRegex.test(key)) {
    return {
      valid: false,
      error: 'PHI_ENCRYPTION_KEY must contain only hexadecimal characters (0-9, a-f, A-F)',
    };
  }

  // In production, check for known insecure/placeholder keys
  if (isProduction && INSECURE_KEYS.includes(key.toLowerCase())) {
    return {
      valid: false,
      error: 'PHI_ENCRYPTION_KEY appears to be a placeholder/insecure key. Generate a secure key with: openssl rand -hex 32',
    };
  }

  return { valid: true };
}

/**
 * PHI Encryption Service
 *
 * Provides application-layer encryption for Protected Health Information (PHI)
 * using AES-256-GCM with authenticated encryption.
 *
 * Each piece of data is encrypted with:
 * - A unique initialization vector (IV)
 * - Authentication tag for integrity verification
 * - User-specific derived key from master key + user salt
 */
export class EncryptionService {
  private masterKey: Buffer;

  constructor() {
    const masterKeyHex = process.env.PHI_ENCRYPTION_KEY;

    // Validate the encryption key
    const validation = validateEncryptionKey(masterKeyHex);

    if (!validation.valid) {
      // SECURITY: Always fail hard if encryption is not properly configured
      // This prevents accidental use of weak encryption for PHI data
      throw new Error(
        `\n` +
        `╔════════════════════════════════════════════════════════════════════╗\n` +
        `║  FATAL: PHI Encryption Key Configuration Error                     ║\n` +
        `╠════════════════════════════════════════════════════════════════════╣\n` +
        `║  ${(validation.error || 'Unknown error').substring(0, 64).padEnd(66)}║\n` +
        `║                                                                    ║\n` +
        `║  To generate a secure key, run:                                    ║\n` +
        `║    openssl rand -hex 32                                            ║\n` +
        `║                                                                    ║\n` +
        `║  Then set the PHI_ENCRYPTION_KEY environment variable.             ║\n` +
        `║                                                                    ║\n` +
        `║  SECURITY: PHI encryption cannot be bypassed, even in development. ║\n` +
        `╚════════════════════════════════════════════════════════════════════╝\n`
      );
    } else {
      this.masterKey = Buffer.from(masterKeyHex!, 'hex');
    }
  }

  /**
   * Derives a user-specific encryption key from the master key
   * This ensures that even with the same plaintext, different users get different ciphertext
   */
  private deriveUserKey(userSalt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      this.masterKey,
      userSalt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha512'
    );
  }

  /**
   * Generates a new salt for a user's encryption key
   */
  generateUserSalt(): string {
    return crypto.randomBytes(SALT_LENGTH).toString('hex');
  }

  /**
   * Encrypts data using only the master key (for encrypting user salts)
   * @param plaintext - The data to encrypt
   * @returns Encrypted string in format: iv:authTag:ciphertext (all base64)
   */
  encryptWithMasterKey(plaintext: string): string {
    if (!plaintext) return '';

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  }

  /**
   * Decrypts data using only the master key (for decrypting user salts)
   * @param encryptedData - The encrypted string from encryptWithMasterKey()
   * @returns Decrypted plaintext
   */
  decryptWithMasterKey(encryptedData: string): string {
    if (!encryptedData) return '';

    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivBase64, authTagBase64, ciphertext] = parts;
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Encrypts PHI data with user-specific key derivation
   *
   * @param plaintext - The data to encrypt
   * @param userSalt - User's unique salt (from UserEncryptionKey table)
   * @returns Encrypted string in format: iv:authTag:ciphertext (all base64)
   */
  encrypt(plaintext: string, userSalt: string): string {
    if (!plaintext) return '';

    const salt = Buffer.from(userSalt, 'hex');
    const key = this.deriveUserKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  }

  /**
   * Decrypts PHI data with user-specific key derivation
   *
   * @param encryptedData - The encrypted string from encrypt()
   * @param userSalt - User's unique salt (from UserEncryptionKey table)
   * @returns Decrypted plaintext
   */
  decrypt(encryptedData: string, userSalt: string): string {
    if (!encryptedData) return '';

    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivBase64, authTagBase64, ciphertext] = parts;
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const salt = Buffer.from(userSalt, 'hex');
    const key = this.deriveUserKey(salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Hash sensitive data for searching (one-way)
   * Useful for looking up records by encrypted fields
   */
  hashForSearch(data: string, userSalt: string): string {
    const salt = Buffer.from(userSalt, 'hex');
    return crypto.pbkdf2Sync(data.toLowerCase(), salt, 10000, 32, 'sha256').toString('hex');
  }

  /**
   * Encrypts multiple PHI fields on an object
   */
  encryptFields<T extends Record<string, unknown>>(
    data: T,
    fields: (keyof T)[],
    userSalt: string
  ): T {
    const encrypted = { ...data };

    for (const field of fields) {
      const value = data[field];
      if (typeof value === 'string' && value) {
        (encrypted as Record<string, unknown>)[field as string] = this.encrypt(value, userSalt);
      }
    }

    return encrypted;
  }

  /**
   * Decrypts multiple PHI fields on an object
   */
  decryptFields<T extends Record<string, unknown>>(
    data: T,
    fields: (keyof T)[],
    userSalt: string
  ): T {
    const decrypted = { ...data };

    for (const field of fields) {
      const value = data[field];
      if (typeof value === 'string' && value) {
        try {
          (decrypted as Record<string, unknown>)[field as string] = this.decrypt(value, userSalt);
        } catch {
          // If decryption fails, keep original value (might not be encrypted)
          logger.warn(`Failed to decrypt field: ${String(field)}`);
        }
      }
    }

    return decrypted;
  }

  /**
   * Re-encrypts data with a new salt (for key rotation)
   */
  reEncrypt(encryptedData: string, oldSalt: string, newSalt: string): string {
    const plaintext = this.decrypt(encryptedData, oldSalt);
    return this.encrypt(plaintext, newSalt);
  }
}

// Singleton instance
let encryptionServiceInstance: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!encryptionServiceInstance) {
    encryptionServiceInstance = new EncryptionService();
  }
  return encryptionServiceInstance;
}

// PHI field mappings for each model (must match Prisma schema exactly)
export const PHI_FIELDS = {
  User: [
    'firstNameEncrypted',
    'lastNameEncrypted',
    'dateOfBirthEncrypted',
    'phoneEncrypted',
    'addressEncrypted', // Single address field in schema
  ],
  Biomarker: [
    'valueEncrypted',
    'notesEncrypted',
  ],
  BiomarkerHistory: [
    'valueEncrypted',
    'notesEncrypted',
  ],
  InsurancePlan: [
    'memberIdEncrypted',
    'groupIdEncrypted', // Changed from groupNumberEncrypted to match schema
  ],
  DNAData: [
    'rawDataPathEncrypted',
  ],
  DNAVariant: [
    'genotypeEncrypted',
  ],
  GeneticTrait: [
    'descriptionEncrypted',
    'recommendationsEncrypted',
  ],
  HealthNeed: [
    'descriptionEncrypted',
    'notesEncrypted',
    'actionPlanEncrypted',
  ],
  AuditLog: [
    'previousValueEncrypted',
    'newValueEncrypted',
  ],
} as const;

export default EncryptionService;
