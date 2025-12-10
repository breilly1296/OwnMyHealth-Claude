/**
 * PHI Encryption Service Tests
 *
 * Tests that PHI encryption is working correctly:
 * - Values are encrypted before database storage
 * - Values are decrypted on retrieval
 * - Different users get different ciphertext for same plaintext
 * - Invalid encryption keys are rejected
 * - Encryption key validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Set up test encryption key before importing the module
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.PHI_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

import {
  EncryptionService,
  validateEncryptionKey,
  PHI_FIELDS,
} from '../../services/encryption.js';

describe('EncryptionService', () => {
  let encryptionService: EncryptionService;
  const testUserSalt = crypto.randomBytes(32).toString('hex');
  const anotherUserSalt = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    encryptionService = new EncryptionService();
  });

  // ============================================
  // Key Validation Tests
  // ============================================
  describe('validateEncryptionKey', () => {
    it('should accept valid 64-character hex key', () => {
      const key = crypto.randomBytes(32).toString('hex');
      const result = validateEncryptionKey(key);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject undefined key', () => {
      const result = validateEncryptionKey(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not set');
    });

    it('should reject key shorter than 64 characters', () => {
      const result = validateEncryptionKey('abcdef123456'); // Too short
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least 64');
    });

    it('should reject non-hex characters', () => {
      const result = validateEncryptionKey('ghijklmnopqrstuvwxyz'.repeat(4)); // Invalid chars
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hexadecimal');
    });

    it('should accept longer than minimum key', () => {
      const key = crypto.randomBytes(64).toString('hex'); // 128 chars
      const result = validateEncryptionKey(key);
      expect(result.valid).toBe(true);
    });
  });

  // ============================================
  // Basic Encryption/Decryption Tests
  // ============================================
  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a string correctly', () => {
      const plaintext = 'Sensitive PHI data 123';
      const encrypted = encryptionService.encrypt(plaintext, testUserSalt);
      const decrypted = encryptionService.decrypt(encrypted, testUserSalt);

      expect(encrypted).not.toBe(plaintext);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce encrypted string in iv:authTag:ciphertext format', () => {
      const plaintext = 'Test data';
      const encrypted = encryptionService.encrypt(plaintext, testUserSalt);

      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);

      // Each part should be base64 encoded
      parts.forEach(part => {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      });
    });

    it('should produce different ciphertext for same plaintext (unique IV)', () => {
      const plaintext = 'Same data encrypted twice';
      const encrypted1 = encryptionService.encrypt(plaintext, testUserSalt);
      const encrypted2 = encryptionService.encrypt(plaintext, testUserSalt);

      expect(encrypted1).not.toBe(encrypted2);

      // Both should decrypt to same value
      expect(encryptionService.decrypt(encrypted1, testUserSalt)).toBe(plaintext);
      expect(encryptionService.decrypt(encrypted2, testUserSalt)).toBe(plaintext);
    });

    it('should return empty string for empty input', () => {
      expect(encryptionService.encrypt('', testUserSalt)).toBe('');
      expect(encryptionService.decrypt('', testUserSalt)).toBe('');
    });

    it('should handle unicode characters', () => {
      const plaintext = '日本語テスト 🏥 αβγδ';
      const encrypted = encryptionService.encrypt(plaintext, testUserSalt);
      const decrypted = encryptionService.decrypt(encrypted, testUserSalt);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle very long strings', () => {
      const plaintext = 'A'.repeat(10000);
      const encrypted = encryptionService.encrypt(plaintext, testUserSalt);
      const decrypted = encryptionService.decrypt(encrypted, testUserSalt);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', () => {
      const plaintext = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';
      const encrypted = encryptionService.encrypt(plaintext, testUserSalt);
      const decrypted = encryptionService.decrypt(encrypted, testUserSalt);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle newlines and whitespace', () => {
      const plaintext = 'Line 1\nLine 2\r\nLine 3\tTabbed';
      const encrypted = encryptionService.encrypt(plaintext, testUserSalt);
      const decrypted = encryptionService.decrypt(encrypted, testUserSalt);

      expect(decrypted).toBe(plaintext);
    });
  });

  // ============================================
  // User-Specific Encryption Tests
  // ============================================
  describe('user-specific encryption', () => {
    it('should produce different ciphertext for different users with same plaintext', () => {
      const plaintext = 'Same sensitive data';

      const encryptedUser1 = encryptionService.encrypt(plaintext, testUserSalt);
      const encryptedUser2 = encryptionService.encrypt(plaintext, anotherUserSalt);

      // Different users should have different ciphertext
      expect(encryptedUser1).not.toBe(encryptedUser2);

      // Each can only decrypt their own
      expect(encryptionService.decrypt(encryptedUser1, testUserSalt)).toBe(plaintext);
      expect(encryptionService.decrypt(encryptedUser2, anotherUserSalt)).toBe(plaintext);
    });

    it('should fail to decrypt with wrong user salt', () => {
      const plaintext = 'User 1 data';
      const encrypted = encryptionService.encrypt(plaintext, testUserSalt);

      // Trying to decrypt with different salt should fail
      expect(() => {
        encryptionService.decrypt(encrypted, anotherUserSalt);
      }).toThrow();
    });
  });

  // ============================================
  // Master Key Encryption Tests
  // ============================================
  describe('encryptWithMasterKey and decryptWithMasterKey', () => {
    it('should encrypt and decrypt with master key only', () => {
      const plaintext = 'User salt value';
      const encrypted = encryptionService.encryptWithMasterKey(plaintext);
      const decrypted = encryptionService.decryptWithMasterKey(encrypted);

      expect(encrypted).not.toBe(plaintext);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext each time', () => {
      const plaintext = 'Same salt';
      const encrypted1 = encryptionService.encryptWithMasterKey(plaintext);
      const encrypted2 = encryptionService.encryptWithMasterKey(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });
  });

  // ============================================
  // Salt Generation Tests
  // ============================================
  describe('generateUserSalt', () => {
    it('should generate 64-character hex salt', () => {
      const salt = encryptionService.generateUserSalt();

      expect(salt).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(salt)).toBe(true);
    });

    it('should generate unique salts each time', () => {
      const salts = new Set<string>();

      for (let i = 0; i < 100; i++) {
        salts.add(encryptionService.generateUserSalt());
      }

      expect(salts.size).toBe(100);
    });
  });

  // ============================================
  // Field Encryption/Decryption Tests
  // ============================================
  describe('encryptFields and decryptFields', () => {
    it('should encrypt specified fields on object', () => {
      const data = {
        name: 'John Doe',
        email: 'john@example.com',
        ssn: '123-45-6789',
        age: 30,
      };

      const encrypted = encryptionService.encryptFields(
        data,
        ['name', 'ssn'],
        testUserSalt
      );

      expect(encrypted.name).not.toBe(data.name);
      expect(encrypted.ssn).not.toBe(data.ssn);
      expect(encrypted.email).toBe(data.email); // Not in fields list
      expect(encrypted.age).toBe(data.age); // Not a string
    });

    it('should decrypt specified fields on object', () => {
      const original = {
        name: 'John Doe',
        ssn: '123-45-6789',
      };

      const encrypted = encryptionService.encryptFields(
        original,
        ['name', 'ssn'],
        testUserSalt
      );

      const decrypted = encryptionService.decryptFields(
        encrypted,
        ['name', 'ssn'],
        testUserSalt
      );

      expect(decrypted.name).toBe(original.name);
      expect(decrypted.ssn).toBe(original.ssn);
    });

    it('should handle null and undefined fields', () => {
      const data = {
        name: 'Test',
        optional: null,
        missing: undefined,
      };

      const encrypted = encryptionService.encryptFields(
        data,
        ['name', 'optional', 'missing'],
        testUserSalt
      );

      expect(encrypted.name).not.toBe(data.name);
      expect(encrypted.optional).toBeNull();
      expect(encrypted.missing).toBeUndefined();
    });
  });

  // ============================================
  // Re-encryption Tests (Key Rotation)
  // ============================================
  describe('reEncrypt', () => {
    it('should re-encrypt data with new salt', () => {
      const plaintext = 'Sensitive PHI';
      const oldSalt = testUserSalt;
      const newSalt = anotherUserSalt;

      // Encrypt with old salt
      const encryptedOld = encryptionService.encrypt(plaintext, oldSalt);

      // Re-encrypt with new salt
      const encryptedNew = encryptionService.reEncrypt(encryptedOld, oldSalt, newSalt);

      // Verify it's different
      expect(encryptedNew).not.toBe(encryptedOld);

      // Verify it decrypts correctly with new salt
      expect(encryptionService.decrypt(encryptedNew, newSalt)).toBe(plaintext);

      // Verify old encryption still works with old salt
      expect(encryptionService.decrypt(encryptedOld, oldSalt)).toBe(plaintext);
    });
  });

  // ============================================
  // Hash for Search Tests
  // ============================================
  describe('hashForSearch', () => {
    it('should produce consistent hash for same input', () => {
      const data = 'searchable@email.com';
      const hash1 = encryptionService.hashForSearch(data, testUserSalt);
      const hash2 = encryptionService.hashForSearch(data, testUserSalt);

      expect(hash1).toBe(hash2);
    });

    it('should be case insensitive', () => {
      const hash1 = encryptionService.hashForSearch('Test@Email.com', testUserSalt);
      const hash2 = encryptionService.hashForSearch('test@email.com', testUserSalt);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different salts', () => {
      const data = 'test@email.com';
      const hash1 = encryptionService.hashForSearch(data, testUserSalt);
      const hash2 = encryptionService.hashForSearch(data, anotherUserSalt);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce 64-character hex hash', () => {
      const hash = encryptionService.hashForSearch('test', testUserSalt);

      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================
  describe('error handling', () => {
    it('should throw error for invalid encrypted format', () => {
      expect(() => {
        encryptionService.decrypt('invalid-format', testUserSalt);
      }).toThrow('Invalid encrypted data format');
    });

    it('should throw error for tampered ciphertext (authentication failure)', () => {
      const encrypted = encryptionService.encrypt('test', testUserSalt);
      const parts = encrypted.split(':');

      // Tamper with ciphertext
      const tamperedCiphertext = Buffer.from('tampered').toString('base64');
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

      expect(() => {
        encryptionService.decrypt(tampered, testUserSalt);
      }).toThrow();
    });

    it('should throw error for tampered auth tag', () => {
      const encrypted = encryptionService.encrypt('test', testUserSalt);
      const parts = encrypted.split(':');

      // Tamper with auth tag
      const tamperedTag = Buffer.from('0000000000000000').toString('base64');
      const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;

      expect(() => {
        encryptionService.decrypt(tampered, testUserSalt);
      }).toThrow();
    });
  });

  // ============================================
  // PHI Fields Definition Tests
  // ============================================
  describe('PHI_FIELDS', () => {
    it('should define PHI fields for Biomarker model', () => {
      expect(PHI_FIELDS.Biomarker).toContain('valueEncrypted');
      expect(PHI_FIELDS.Biomarker).toContain('notesEncrypted');
    });

    it('should define PHI fields for User model', () => {
      expect(PHI_FIELDS.User).toContain('firstNameEncrypted');
      expect(PHI_FIELDS.User).toContain('lastNameEncrypted');
      expect(PHI_FIELDS.User).toContain('dateOfBirthEncrypted');
    });

    it('should define PHI fields for InsurancePlan model', () => {
      expect(PHI_FIELDS.InsurancePlan).toContain('memberIdEncrypted');
      expect(PHI_FIELDS.InsurancePlan).toContain('groupIdEncrypted');
    });

    it('should define PHI fields for HealthNeed model', () => {
      expect(PHI_FIELDS.HealthNeed).toContain('descriptionEncrypted');
      expect(PHI_FIELDS.HealthNeed).toContain('actionPlanEncrypted');
    });
  });
});

// ============================================
// Integration Test: Encryption in Biomarker Flow
// ============================================
describe('PHI Encryption Integration', () => {
  it('should verify biomarker values are not stored in plaintext', () => {
    const encryptionService = new EncryptionService();
    const userSalt = encryptionService.generateUserSalt();

    // Simulate what happens in biomarker creation
    const biomarkerValue = '95.5';
    const biomarkerNotes = 'Patient fasting for 12 hours';

    // Encrypt before "database storage"
    const valueEncrypted = encryptionService.encrypt(biomarkerValue, userSalt);
    const notesEncrypted = encryptionService.encrypt(biomarkerNotes, userSalt);

    // Verify encrypted values don't contain plaintext
    expect(valueEncrypted).not.toContain(biomarkerValue);
    expect(notesEncrypted).not.toContain(biomarkerNotes);
    expect(notesEncrypted).not.toContain('fasting');
    expect(notesEncrypted).not.toContain('Patient');

    // Verify decryption returns original values
    expect(encryptionService.decrypt(valueEncrypted, userSalt)).toBe(biomarkerValue);
    expect(encryptionService.decrypt(notesEncrypted, userSalt)).toBe(biomarkerNotes);
  });

  it('should ensure encrypted data is not searchable without decryption', () => {
    const encryptionService = new EncryptionService();
    const userSalt = encryptionService.generateUserSalt();

    const sensitiveData = 'John Smith - SSN: 123-45-6789';
    const encrypted = encryptionService.encrypt(sensitiveData, userSalt);

    // Encrypted data should not contain any recognizable parts
    expect(encrypted).not.toContain('John');
    expect(encrypted).not.toContain('Smith');
    expect(encrypted).not.toContain('123');
    expect(encrypted).not.toContain('6789');
    expect(encrypted).not.toContain('SSN');
  });
});
