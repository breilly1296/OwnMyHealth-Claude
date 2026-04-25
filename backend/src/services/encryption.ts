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
 * - Provider-Patient: relationship notes
 * - DNA: genotype data, trait descriptions/recommendations
 * - Health Needs: descriptions
 * - Health Goals: descriptions, progress notes
 * - Expense Tracking: service types, costs, provider names, claim amounts
 * - Cost Analyses: AI-generated recommendations, projected costs
 * - Audit Log: previous/new values (for PHI change tracking)
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

/**
 * PBKDF2 iterations for per-user key derivation.
 *
 * OWASP 2023 password storage guidance recommends ≥600,000 for PBKDF2-SHA512:
 *   https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 *
 * `PBKDF2_ITERATIONS` is the current target for new encryption work.
 * `PBKDF2_ITERATIONS_LEGACY` is the pre-hardening value (100k); decryption
 * attempts the current iteration count first and falls back to the legacy
 * count if the authentication tag fails to verify. This lets us raise the
 * bar for new data without a coordinated re-encryption of the whole DB.
 *
 * TODO(key-rotation): store the iteration count per user (or per-ciphertext
 * envelope) and remove the legacy fallback once all rows are re-encrypted.
 * The current scheme leaks nothing — both derivations use the same stored
 * salt — but it's a migration artifact, not a long-term design.
 */
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_ITERATIONS_LEGACY = 100000;

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

  // Reject known insecure/placeholder keys in EVERY environment.
  // Rationale: C-4 — `.env.example` historically shipped one of these values.
  // A developer copying the template to `.env` without replacing the key
  // would encrypt local PHI with a repo-readable value. The previous
  // NODE_ENV='production' gate defeated the purpose in the exact
  // environments (dev, staging, preview) most likely to use the template.
  if (INSECURE_KEYS.includes(key.toLowerCase())) {
    return {
      valid: false,
      error: 'PHI_ENCRYPTION_KEY is a known placeholder/insecure value. Generate a secure key with: openssl rand -hex 32',
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
   * Derives a user-specific encryption key from the master key.
   * `iterations` defaults to the current target (600k); the legacy value
   * (100k) is only passed when retrying a failed decryption — see `decrypt`.
   */
  private deriveUserKey(userSalt: Buffer, iterations: number = PBKDF2_ITERATIONS): Buffer {
    return crypto.pbkdf2Sync(
      this.masterKey,
      userSalt,
      iterations,
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

    const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv, { authTagLength: 16 });
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

    // Try the current iteration count first. If the auth tag verification
    // fails, retry with the legacy count — data encrypted before the
    // 100k→600k bump used a different derived key. Both derivations use
    // the same stored salt, so the fallback leaks nothing that wasn't
    // already on disk.
    try {
      return this.attemptDecrypt(ciphertext, iv, authTag, this.deriveUserKey(salt, PBKDF2_ITERATIONS));
    } catch (primaryErr) {
      try {
        return this.attemptDecrypt(ciphertext, iv, authTag, this.deriveUserKey(salt, PBKDF2_ITERATIONS_LEGACY));
      } catch {
        // Re-throw the primary error so logs point at the current code path.
        throw primaryErr;
      }
    }
  }

  private attemptDecrypt(ciphertext: string, iv: Buffer, authTag: Buffer, key: Buffer): string {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
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
        } catch (err) {
          // Returning ciphertext is worse than returning null — it leaks
          // encrypted data structure to the client and confuses the UI.
          // Null signals "decryption failed" cleanly. Log at error level
          // because a silent decrypt failure means either a master-key
          // rotation that missed this row, bit rot, or an attacker probe.
          logger.error(`Failed to decrypt field: ${String(field)}`, {
            data: { error: err instanceof Error ? err.message : 'Unknown' },
          });
          (decrypted as Record<string, unknown>)[field as string] = null;
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
// IMPORTANT: Keep this in sync with prisma/schema.prisma encrypted fields.
// Drift here means iteration-based sweeps (export, deletion, admin views,
// audit redaction) silently skip fields. Audited against schema.prisma —
// every `*Encrypted` column in the schema should appear below.
export const PHI_FIELDS = {
  // User profile PHI
  User: [
    'firstNameEncrypted',
    'lastNameEncrypted',
    'dateOfBirthEncrypted',
    'phoneEncrypted',
    'addressEncrypted',
    'healthProfileEncrypted',
  ],
  // Health data PHI
  Biomarker: [
    'valueEncrypted',
    'notesEncrypted',
  ],
  BiomarkerHistory: [
    'valueEncrypted',
    // Note: BiomarkerHistory does NOT have notesEncrypted in schema
  ],
  // Insurance PHI
  InsurancePlan: [
    'memberIdEncrypted',
    'groupIdEncrypted',
  ],
  // Provider-Patient relationship PHI
  ProviderPatient: [
    'notesEncrypted',
  ],
  // DNA/Genetic PHI (schema still supports even if frontend removed)
  DNAVariant: [
    'genotypeEncrypted',
  ],
  GeneticTrait: [
    'descriptionEncrypted',
    'recommendationsEncrypted',
  ],
  // Health needs PHI
  HealthNeed: [
    'descriptionEncrypted',
    // Note: HealthNeed only has descriptionEncrypted in schema
  ],
  // Health goals PHI
  HealthGoal: [
    'descriptionEncrypted',
    'targetValueEncrypted',
  ],
  GoalProgressHistory: [
    'noteEncrypted',
  ],
  // Audit log PHI (for change tracking)
  AuditLog: [
    'previousValueEncrypted',
    'newValueEncrypted',
  ],
  // Expense tracking PHI (cost optimization)
  ExpenseProjection: [
    'serviceTypeEncrypted',
    'estimatedCostEncrypted',
    'notesEncrypted',
  ],
  ExpenseActual: [
    'serviceTypeEncrypted',
    'providerNameEncrypted',
    'billedAmountEncrypted',
    'insurancePaidEncrypted',
    'patientPaidEncrypted',
    'appliedToDeductibleEncrypted',
    'appliedToOopEncrypted',
    'notesEncrypted',
  ],
  CostAnalysis: [
    // Was 'claudeResponse'; renamed to claudeResponseEncrypted in migration
    // 20260424_align_uuid_defaults_and_rename_claude_response so the field
    // name advertises that the column is ciphertext.
    'claudeResponseEncrypted',
    'totalProjectedOopEncrypted',
    'projectedExpensesSnapshotEncrypted',
  ],
  // SMART-on-FHIR OAuth tokens — a stolen access token is a direct path to
  // the user's live PHI at Quest/LabCorp/etc.
  LabConnection: [
    'accessTokenEncrypted',
    'refreshTokenEncrypted',
  ],
} as const;

export default EncryptionService;
