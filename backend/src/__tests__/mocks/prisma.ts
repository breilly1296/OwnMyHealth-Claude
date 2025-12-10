/**
 * Prisma Client Mock
 *
 * Provides a mock implementation of PrismaClient for testing.
 */

import { vi } from 'vitest';

// Create a mock user for testing
export const mockUser = {
  id: 'test-user-id-123',
  email: 'test@example.com',
  passwordHash: '$2a$04$test-hash', // Will be overwritten in tests
  role: 'PATIENT' as const,
  isActive: true,
  emailVerified: true,
  emailVerificationToken: null,
  emailVerificationExpires: null,
  passwordResetToken: null,
  passwordResetExpires: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  lastLoginAt: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  lastFailedLogin: null,
};

export const mockSession = {
  id: 'test-session-id-123',
  userId: 'test-user-id-123',
  token: 'test-token',
  ipAddress: '127.0.0.1',
  userAgent: 'test-agent',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  createdAt: new Date(),
};

// Create mock Prisma client
export const createMockPrismaClient = () => ({
  user: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  $connect: vi.fn(),
  $disconnect: vi.fn(),
  $transaction: vi.fn((fn: (prisma: unknown) => Promise<unknown>) => fn(createMockPrismaClient())),
});

export type MockPrismaClient = ReturnType<typeof createMockPrismaClient>;

// Default mock instance
export const mockPrisma = createMockPrismaClient();

// Helper to reset all mocks
export const resetPrismaMocks = () => {
  Object.values(mockPrisma.user).forEach((fn) => {
    if (typeof fn === 'function' && 'mockReset' in fn) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  });
  Object.values(mockPrisma.session).forEach((fn) => {
    if (typeof fn === 'function' && 'mockReset' in fn) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  });
};
