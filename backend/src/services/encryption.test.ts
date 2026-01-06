import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EncryptionService, validateEncryptionKey } from './encryption.js';

vi.mock('../utils/logger.js');

// Mock PHI_ENCRYPTION_KEY for testing
const TEST_PHI_ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const INSECURE_PHI_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SHORT_PHI_ENCRYPTION_KEY = 'a1b2c3d4e5f6';
const INVALID_CHAR_PHI_ENCRYPTION_KEY = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2';



describe('encryption.ts', () => {

  beforeEach(() => {
    // Reset modules to ensure a fresh singleton instance for each test that calls getEncryptionService
    vi.resetModules();
    process.env.PHI_ENCRYPTION_KEY = TEST_PHI_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'development'; // Default to development for tests
  });

  afterEach(() => {
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.NODE_ENV;
    vi.clearAllMocks();
  });

  // ============================================
  // validateEncryptionKey tests
  // ============================================
  describe('validateEncryptionKey', () => {
    it('should return valid for a correct key in development', () => {
      process.env.NODE_ENV = 'development';
      const result = validateEncryptionKey(TEST_PHI_ENCRYPTION_KEY);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return valid for a correct key in production', () => {
      process.env.NODE_ENV = 'production';
      const result = validateEncryptionKey(TEST_PHI_ENCRYPTION_KEY);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid if key is not set', () => {
      delete process.env.PHI_ENCRYPTION_KEY; // Ensure it's not set
      const result = validateEncryptionKey(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('PHI_ENCRYPTION_KEY environment variable is not set');
    });

    it('should return invalid if key is too short', () => {
      const result = validateEncryptionKey(SHORT_PHI_ENCRYPTION_KEY);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be at least 64 hex characters');
    });

    it('should return invalid if key contains non-hex characters', () => {
      const result = validateEncryptionKey(INVALID_CHAR_PHI_ENCRYPTION_KEY);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must contain only hexadecimal characters');
    });

    it('should return invalid if key is an insecure placeholder in production', () => {
      process.env.NODE_ENV = 'production';
      const result = validateEncryptionKey(INSECURE_PHI_ENCRYPTION_KEY);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('appears to be a placeholder/insecure key');
    });

    it('should return valid if key is an insecure placeholder in development', () => {
      process.env.NODE_ENV = 'development';
      const result = validateEncryptionKey(INSECURE_PHI_ENCRYPTION_KEY);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  // ============================================
  // EncryptionService Constructor tests
  // ============================================
  describe('EncryptionService Constructor', () => {
    it('should initialize successfully with a valid PHI_ENCRYPTION_KEY', () => {
      expect(() => new EncryptionService()).not.toThrow();
      const service = new EncryptionService();
      expect(service).toBeInstanceOf(EncryptionService);
    });

    it('should throw an error if PHI_ENCRYPTION_KEY is invalid', () => {
      process.env.PHI_ENCRYPTION_KEY = SHORT_PHI_ENCRYPTION_KEY;
      expect(() => new EncryptionService()).toThrow('FATAL: PHI Encryption Key Configuration Error');
    });

    it('should throw an error if PHI_ENCRYPTION_KEY is not set', () => {
      delete process.env.PHI_ENCRYPTION_KEY;
      expect(() => new EncryptionService()).toThrow('FATAL: PHI Encryption Key Configuration Error');
    });
  });

  // ============================================
  // generateUserSalt tests
  // ============================================
  describe('generateUserSalt', () => {
    it('should generate a hex string of the correct length', () => {
      const service = new EncryptionService();
      const salt = service.generateUserSalt();
      expect(salt).toBeTypeOf('string');
      // SALT_LENGTH is 32 bytes, so 64 hex characters
      expect(salt).toHaveLength(64);
      expect(/^[0-9a-fA-F]+$/.test(salt)).toBe(true);
    });

    it('should generate different salts on subsequent calls', () => {
      const service = new EncryptionService();
      const salt1 = service.generateUserSalt();
      const salt2 = service.generateUserSalt();
      expect(salt1).not.toBe(salt2);
    });
  });

  // ============================================
  // Master Key Encryption/Decryption tests
  // ============================================
  describe('encryptWithMasterKey / decryptWithMasterKey', () => {
    let service: EncryptionService;
    beforeEach(() => {
      service = new EncryptionService();
    });

    it('should encrypt and decrypt data correctly using the master key', () => {
      const plaintext = 'This is a sensitive piece of data for the master key.';
      const encrypted = service.encryptWithMasterKey(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.split(':').length).toBe(3); // iv:authTag:ciphertext

      const decrypted = service.decryptWithMasterKey(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty plaintext gracefully for encryption', () => {
      const plaintext = '';
      const encrypted = service.encryptWithMasterKey(plaintext);
      expect(encrypted).toBe('');
    });

    it('should handle empty encrypted data gracefully for decryption', () => {
      const encrypted = '';
      const decrypted = service.decryptWithMasterKey(encrypted);
      expect(decrypted).toBe('');
    });

    it('should throw an error for invalid encrypted data format during decryption', () => {
      const invalidEncrypted = 'invalid_format_string';
      expect(() => service.decryptWithMasterKey(invalidEncrypted)).toThrow('Invalid encrypted data format');
    });

    it('should generate different ciphertext for the same plaintext due to random IV', () => {
      const plaintext = 'Another sensitive data.';
      const encrypted1 = service.encryptWithMasterKey(plaintext);
      const encrypted2 = service.encryptWithMasterKey(plaintext);
      expect(encrypted1).not.toBe(encrypted2);
      expect(service.decryptWithMasterKey(encrypted1)).toBe(plaintext);
      expect(service.decryptWithMasterKey(encrypted2)).toBe(plaintext);
    });

    it('should fail decryption if ciphertext is tampered with', () => {
      const plaintext = 'Data to be tampered.';
      const encrypted = service.encryptWithMasterKey(plaintext);
      const parts = encrypted.split(':');
      const tamperedCiphertext = parts[0] + ':' + parts[1] + ':' + 'A' + parts[2].substring(1); // Tamper ciphertext
      expect(() => service.decryptWithMasterKey(tamperedCiphertext)).toThrow();
    });

    it('should fail decryption if authTag is tampered with', () => {
      const plaintext = 'Data to be tampered.';
      const encrypted = service.encryptWithMasterKey(plaintext);
      const parts = encrypted.split(':');
      const tamperedAuthTag = parts[0] + ':' + 'B' + parts[1].substring(1) + ':' + parts[2]; // Tamper authTag
      expect(() => service.decryptWithMasterKey(tamperedAuthTag)).toThrow();
    });

    it('should fail decryption if IV is tampered with', () => {
      const plaintext = 'Data to be tampered.';
      const encrypted = service.encryptWithMasterKey(plaintext);
      const parts = encrypted.split(':');
      const tamperedIv = 'C' + parts[0].substring(1) + ':' + parts[1] + ':' + parts[2]; // Tamper IV
      expect(() => service.decryptWithMasterKey(tamperedIv)).toThrow();
    });
  });

  // ============================================
  // User Key Encryption/Decryption tests
  // ============================================
  describe('encrypt / decrypt (user-specific)', () => {
    let service: EncryptionService;
    let userSalt: string;
    beforeEach(() => {
      service = new EncryptionService();
      userSalt = service.generateUserSalt();
    });

    it('should encrypt and decrypt data correctly using a user-specific key', () => {
      const plaintext = 'User sensitive PHI data.';
      const encrypted = service.encrypt(plaintext, userSalt);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.split(':').length).toBe(3);

      const decrypted = service.decrypt(encrypted, userSalt);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty plaintext gracefully for user encryption', () => {
      const plaintext = '';
      const encrypted = service.encrypt(plaintext, userSalt);
      expect(encrypted).toBe('');
    });

    it('should handle empty encrypted data gracefully for user decryption', () => {
      const encrypted = '';
      const decrypted = service.decrypt(encrypted, userSalt);
      expect(decrypted).toBe('');
    });

    it('should throw an error for invalid encrypted data format during user decryption', () => {
      const invalidEncrypted = 'invalid_format_string';
      expect(() => service.decrypt(invalidEncrypted, userSalt)).toThrow('Invalid encrypted data format');
    });

    it('should generate different ciphertext for the same plaintext with different user salts', () => {
      const plaintext = 'Another user sensitive data.';
      const userSalt2 = service.generateUserSalt();

      const encrypted1 = service.encrypt(plaintext, userSalt);
      const encrypted2 = service.encrypt(plaintext, userSalt2);

      expect(encrypted1).not.toBe(encrypted2);
      expect(service.decrypt(encrypted1, userSalt)).toBe(plaintext);
      expect(service.decrypt(encrypted2, userSalt2)).toBe(plaintext);
    });

    it('should generate different ciphertext for the same plaintext with the same user salt due to random IV', () => {
      const plaintext = 'Yet another user sensitive data.';
      const encrypted1 = service.encrypt(plaintext, userSalt);
      const encrypted2 = service.encrypt(plaintext, userSalt);
      expect(encrypted1).not.toBe(encrypted2);
      expect(service.decrypt(encrypted1, userSalt)).toBe(plaintext);
      expect(service.decrypt(encrypted2, userSalt)).toBe(plaintext);
    });

    it('should fail decryption if user salt is incorrect', () => {
      const plaintext = 'Data for incorrect salt test.';
      const encrypted = service.encrypt(plaintext, userSalt);
      const wrongSalt = service.generateUserSalt(); // A different salt
      expect(() => service.decrypt(encrypted, wrongSalt)).toThrow(); // Decryption should fail due to wrong key
    });

    it('should fail decryption if ciphertext is tampered with (user-specific)', () => {
      const plaintext = 'User data to be tampered.';
      const encrypted = service.encrypt(plaintext, userSalt);
      const parts = encrypted.split(':');
      const tamperedCiphertext = parts[0] + ':' + parts[1] + ':' + 'X' + parts[2].substring(1);
      expect(() => service.decrypt(tamperedCiphertext, userSalt)).toThrow();
    });
  });

  // ============================================
  // hashForSearch tests
  // ============================================
  describe('hashForSearch', () => {
    let service: EncryptionService;
    let userSalt: string;
    beforeEach(() => {
      service = new EncryptionService();
      userSalt = service.generateUserSalt();
    });

    it('should generate a consistent hash for the same data and user salt', () => {
      const data = 'john.doe@example.com';
      const hash1 = service.hashForSearch(data, userSalt);
      const hash2 = service.hashForSearch(data, userSalt);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 output is 64 hex chars
    });

    it('should generate different hashes for different data', () => {
      const data1 = 'john.doe@example.com';
      const data2 = 'jane.doe@example.com';
      const hash1 = service.hashForSearch(data1, userSalt);
      const hash2 = service.hashForSearch(data2, userSalt);
      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hashes for the same data but different user salts', () => {
      const data = 'john.doe@example.com';
      const userSalt2 = service.generateUserSalt();
      const hash1 = service.hashForSearch(data, userSalt);
      const hash2 = service.hashForSearch(data, userSalt2);
      expect(hash1).not.toBe(hash2);
    });

    it('should be case-insensitive for the input data', () => {
      const data1 = 'John Doe';
      const data2 = 'john doe';
      const hash1 = service.hashForSearch(data1, userSalt);
      const hash2 = service.hashForSearch(data2, userSalt);
      expect(hash1).toBe(hash2);
    });

    it('should return a hex string', () => {
      const data = 'some data';
      const hash = service.hashForSearch(data, userSalt);
      expect(/^[0-9a-fA-F]+$/.test(hash)).toBe(true);
    });
  });

  // ============================================
  // encryptFields / decryptFields tests
  // ============================================
  describe('encryptFields / decryptFields', () => {
    let service: EncryptionService;
    let userSalt: string;
    beforeEach(() => {
      service = new EncryptionService();
      userSalt = service.generateUserSalt();
    });

    it('should encrypt specified fields in an object', () => {
      const data = {
        id: 1,
        name: 'John Doe',
        email: 'john.doe@example.com',
        age: 30,
      };
      const fieldsToEncrypt = ['name', 'email'];

      const encryptedData = service.encryptFields(data, fieldsToEncrypt, userSalt);

      expect(encryptedData.id).toBe(1);
      expect(encryptedData.age).toBe(30);
      expect(encryptedData.name).not.toBe('John Doe');
      expect(encryptedData.email).not.toBe('john.doe@example.com');
      expect(encryptedData.name).toBeTypeOf('string');
      expect(encryptedData.email).toBeTypeOf('string');

      const decryptedData = service.decryptFields(encryptedData, fieldsToEncrypt, userSalt);
      expect(decryptedData.id).toBe(1);
      expect(decryptedData.age).toBe(30);
      expect(decryptedData.name).toBe('John Doe');
      expect(decryptedData.email).toBe('john.doe@example.com');
    });

    it('should not mutate the original object', () => {
      const originalData = {
        name: 'Jane Doe',
        address: '123 Main St',
      };
      const fieldsToEncrypt = ['name'];

      const encryptedData = service.encryptFields(originalData, fieldsToEncrypt, userSalt);

      expect(originalData.name).toBe('Jane Doe');
      expect(encryptedData.name).not.toBe('Jane Doe');
    });

    it('should handle fields that are not strings or are empty', () => {
      const data = {
        name: 'Test User',
        age: 25,
        address: '', // Empty string
        notes: null, // Null value
        isActive: true, // Boolean
      };
      const fieldsToEncrypt = ['name', 'address', 'notes', 'isActive'] as (keyof typeof data)[];

      const encryptedData = service.encryptFields(data, fieldsToEncrypt, userSalt);

      expect(encryptedData.name).not.toBe('Test User');
      expect(encryptedData.address).toBe(''); // Empty string remains empty
      expect(encryptedData.notes).toBeNull(); // Null remains null
      expect(encryptedData.isActive).toBe(true); // Boolean remains boolean

      const decryptedData = service.decryptFields(encryptedData, fieldsToEncrypt, userSalt);
      expect(decryptedData.name).toBe('Test User');
      expect(decryptedData.address).toBe('');
      expect(decryptedData.notes).toBeNull();
      expect(decryptedData.isActive).toBe(true);
    });

    it('should only decrypt specified fields', () => {
      const data = {
        name: 'John Doe',
        email: 'john.doe@example.com',
      };
      const fieldsToEncrypt = ['name', 'email'];
      const encryptedData = service.encryptFields(data, fieldsToEncrypt, userSalt);

      const fieldsToDecrypt = ['name'];
      const partiallyDecryptedData = service.decryptFields(encryptedData, fieldsToDecrypt, userSalt);

      expect(partiallyDecryptedData.name).toBe('John Doe');
      expect(partiallyDecryptedData.email).not.toBe('john.doe@example.com'); // Still encrypted
    });

    it('should gracefully handle decryption failures for specific fields', async () => {
      // Import the actual logger (mocked by vi.mock above)
      const { logger: mockedLogger } = await import('../utils/logger.js');

      const data = {
        name: 'John Doe',
        email: 'john.doe@example.com',
      };
      const fieldsToEncrypt = ['name', 'email'];
      const encryptedData = service.encryptFields(data, fieldsToEncrypt, userSalt);

      // Tamper one of the encrypted fields
      const tamperedEncryptedEmail = (encryptedData.email as string).replace('A', 'Z');
      const tamperedData = { ...encryptedData, email: tamperedEncryptedEmail };

      // Expect a warning log for the failed decryption
      // vi.spyOn(console, 'warn') is not needed when mocking the logger module
      const decryptedData = service.decryptFields(tamperedData, fieldsToEncrypt, userSalt);

      expect(decryptedData.name).toBe('John Doe');
      expect(decryptedData.email).toBe(tamperedEncryptedEmail); // Should return the tampered value
      expect(mockedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to decrypt field: email'));
    });
  });

  // ============================================
  // reEncrypt tests
  // ============================================
  describe('reEncrypt', () => {
    let service: EncryptionService;
    let oldSalt: string;
    let newSalt: string;
    beforeEach(() => {
      service = new EncryptionService();
      oldSalt = service.generateUserSalt();
      newSalt = service.generateUserSalt();
    });

    it('should re-encrypt data with a new salt successfully', () => {
      const plaintext = 'Data to be re-encrypted.';
      const encryptedWithOldSalt = service.encrypt(plaintext, oldSalt);
      const reEncrypted = service.reEncrypt(encryptedWithOldSalt, oldSalt, newSalt);

      expect(reEncrypted).not.toBe(encryptedWithOldSalt); // Should be different ciphertext
      expect(service.decrypt(reEncrypted, newSalt)).toBe(plaintext);
    });

    it('should maintain plaintext integrity after re-encryption', () => {
      const plaintext = 'Integrity check for re-encryption.';
      const encryptedWithOldSalt = service.encrypt(plaintext, oldSalt);
      const reEncrypted = service.reEncrypt(encryptedWithOldSalt, oldSalt, newSalt);
      const decryptedWithNewSalt = service.decrypt(reEncrypted, newSalt);
      expect(decryptedWithNewSalt).toBe(plaintext);
    });

    it('should throw an error if old salt is incorrect during re-encryption', () => {
      const plaintext = 'Re-encryption with wrong old salt.';
      const encryptedWithOldSalt = service.encrypt(plaintext, oldSalt);
      const wrongOldSalt = service.generateUserSalt();
      expect(() => service.reEncrypt(encryptedWithOldSalt, wrongOldSalt, newSalt)).toThrow();
    });
  });

  // ============================================
  // getEncryptionService tests (Singleton)
  // ============================================
  describe('getEncryptionService', () => {
    beforeEach(() => {
      // Clear the module cache to ensure a fresh import of encryption.js
      // This is crucial for testing the singleton pattern of getEncryptionService
      vi.resetModules();
      process.env.PHI_ENCRYPTION_KEY = TEST_PHI_ENCRYPTION_KEY;
    });

    it('should return the same instance of EncryptionService', async () => {
      const { getEncryptionService: getEncryptionServiceActual, EncryptionService: EncryptionServiceActual } = await import('./encryption.js');
      const service1 = getEncryptionServiceActual();
      const service2 = getEncryptionServiceActual();
      expect(service1).toBe(service2);
      expect(service1).toBeInstanceOf(EncryptionServiceActual);
    });

    it('should initialize the service if called for the first time', async () => {
      const { getEncryptionService: getEncryptionServiceActual, EncryptionService: EncryptionServiceActual } = await import('./encryption.js');
      const service = getEncryptionServiceActual();
      expect(service).not.toBeNull();
      expect(service).toBeInstanceOf(EncryptionServiceActual);
    });

    it('should throw an error if PHI_ENCRYPTION_KEY is invalid on first call', async () => {
      process.env.PHI_ENCRYPTION_KEY = SHORT_PHI_ENCRYPTION_KEY;
      vi.resetModules(); // Ensure the module is reloaded with the invalid key
      const { getEncryptionService: getEncryptionServiceActual } = await import('./encryption.js');
      expect(() => getEncryptionServiceActual()).toThrow('FATAL: PHI Encryption Key Configuration Error');
    });
  });
});
