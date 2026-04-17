/**
 * userEncryption service tests (C-8 Part 2b-i).
 *
 * Scope: the RLS context wrapping on all three public functions. Proves:
 *   1. Every DB access goes through withRLSContext with { isAdmin: true }.
 *   2. The happy-path flows (fetch existing, create new, rotate, has-check)
 *      still behave correctly with the tx forwarding pattern.
 *
 * The user_encryption_keys table has admin-gated RLS policies (see
 * migration 20260107). Admin context is required because the service is
 * called in contexts where user RLS may not be established yet (during
 * early request lifecycle) or the caller is pre-auth (salt creation at
 * registration time).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockPrismaForRLS: null as unknown,
  withRLSContext: vi.fn(),
}));

vi.mock('./database.js', () => ({
  withRLSContext: mocks.withRLSContext,
}));

vi.mock('./encryption.js', () => ({
  getEncryptionService: vi.fn(() => ({
    generateUserSalt: vi.fn(() => 'a'.repeat(64)),
    encryptWithMasterKey: vi.fn((v: string) => `master-encrypted:${v}`),
    decryptWithMasterKey: vi.fn((v: string) =>
      v.startsWith('master-encrypted:') ? v.slice('master-encrypted:'.length) : v
    ),
  })),
}));

import {
  getUserEncryptionSalt,
  rotateUserEncryptionKey,
  hasUserEncryptionKey,
} from './userEncryption.js';

interface MockPrisma {
  userEncryptionKey: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function createMockPrisma(): MockPrisma {
  return {
    userEncryptionKey: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

const USER_ID = '11111111-1111-1111-1111-111111111111';

describe('userEncryption (C-8 Part 2b-i)', () => {
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    mocks.mockPrismaForRLS = mockPrisma;
    // Implementation is wiped by clearAllMocks; re-bind each test.
    mocks.withRLSContext.mockImplementation(
      async (_userId: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(mocks.mockPrismaForRLS)
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserEncryptionSalt', () => {
    it('returns decrypted salt when an active key exists', async () => {
      mockPrisma.userEncryptionKey.findFirst.mockResolvedValue({
        id: 'k1',
        userId: USER_ID,
        keyType: 'phi_encryption',
        isActive: true,
        version: 1,
        encryptedKey: 'master-encrypted:existing-salt',
      });

      const salt = await getUserEncryptionSalt(USER_ID);

      expect(salt).toBe('existing-salt');
      expect(mockPrisma.userEncryptionKey.create).not.toHaveBeenCalled();
    });

    it('creates and returns a new salt when none exists', async () => {
      mockPrisma.userEncryptionKey.findFirst.mockResolvedValue(null);
      mockPrisma.userEncryptionKey.create.mockResolvedValue({ id: 'k1' });

      const salt = await getUserEncryptionSalt(USER_ID);

      expect(salt).toBe('a'.repeat(64));
      expect(mockPrisma.userEncryptionKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          keyType: 'phi_encryption',
          encryptedKey: `master-encrypted:${'a'.repeat(64)}`,
          version: 1,
          isActive: true,
        }),
      });
    });

    it('calls withRLSContext with isAdmin=true', async () => {
      mockPrisma.userEncryptionKey.findFirst.mockResolvedValue(null);
      mockPrisma.userEncryptionKey.create.mockResolvedValue({ id: 'k1' });

      await getUserEncryptionSalt(USER_ID);

      expect(mocks.withRLSContext).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { isAdmin: true }
      );
    });
  });

  describe('rotateUserEncryptionKey', () => {
    it('rotates atomically — marks old inactive and creates new in the same tx', async () => {
      mockPrisma.userEncryptionKey.findFirst.mockResolvedValue({
        id: 'k1',
        userId: USER_ID,
        keyType: 'phi_encryption',
        isActive: true,
        version: 3,
        encryptedKey: 'master-encrypted:old-salt',
      });
      mockPrisma.userEncryptionKey.update.mockResolvedValue({ id: 'k1' });
      mockPrisma.userEncryptionKey.create.mockResolvedValue({ id: 'k2' });

      const result = await rotateUserEncryptionKey(USER_ID);

      expect(result.oldSalt).toBe('old-salt');
      expect(result.newSalt).toBe('a'.repeat(64));
      expect(result.newVersion).toBe(4);
      expect(mockPrisma.userEncryptionKey.update).toHaveBeenCalledWith({
        where: { id: 'k1' },
        data: expect.objectContaining({ isActive: false }),
      });
      expect(mockPrisma.userEncryptionKey.create).toHaveBeenCalled();
    });

    it('throws when no active key exists', async () => {
      mockPrisma.userEncryptionKey.findFirst.mockResolvedValue(null);

      await expect(rotateUserEncryptionKey(USER_ID)).rejects.toThrow('No active encryption key found for user');
    });

    it('calls withRLSContext with isAdmin=true', async () => {
      mockPrisma.userEncryptionKey.findFirst.mockResolvedValue({
        id: 'k1',
        userId: USER_ID,
        keyType: 'phi_encryption',
        isActive: true,
        version: 1,
        encryptedKey: 'master-encrypted:old-salt',
      });
      mockPrisma.userEncryptionKey.update.mockResolvedValue({ id: 'k1' });
      mockPrisma.userEncryptionKey.create.mockResolvedValue({ id: 'k2' });

      await rotateUserEncryptionKey(USER_ID);

      expect(mocks.withRLSContext).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { isAdmin: true }
      );
    });
  });

  describe('hasUserEncryptionKey', () => {
    it('returns true when an active key exists', async () => {
      mockPrisma.userEncryptionKey.findFirst.mockResolvedValue({ id: 'k1' });

      const has = await hasUserEncryptionKey(USER_ID);

      expect(has).toBe(true);
    });

    it('returns false when no active key exists', async () => {
      mockPrisma.userEncryptionKey.findFirst.mockResolvedValue(null);

      const has = await hasUserEncryptionKey(USER_ID);

      expect(has).toBe(false);
    });

    it('calls withRLSContext with isAdmin=true', async () => {
      mockPrisma.userEncryptionKey.findFirst.mockResolvedValue(null);

      await hasUserEncryptionKey(USER_ID);

      expect(mocks.withRLSContext).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { isAdmin: true }
      );
    });
  });
});
