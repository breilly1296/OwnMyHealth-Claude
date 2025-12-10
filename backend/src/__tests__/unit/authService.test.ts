/**
 * Auth Service Unit Tests
 *
 * Tests for the authentication service including:
 * - User registration
 * - Login with various scenarios
 * - Token management
 * - Password reset
 * - Account lockout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createMockPrismaClient, type MockPrismaClient } from '../mocks/prisma';
import {
  testUsers,
  VALID_PASSWORD,
  WEAK_PASSWORD,
  DEMO_EMAIL,
  DEMO_PASSWORD,
} from '../fixtures/users';

// Mock the database service
let mockPrisma: MockPrismaClient;

vi.mock('../../services/database.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

// Import after mocking
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  generateAccessToken,
  verifyAccessToken,
  generateTokens,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  refreshTokens,
  isAccountLocked,
  recordFailedLogin,
  resetFailedLoginAttempts,
  createUser,
  findUserByEmail,
  findUserById,
  emailExists,
  attemptLogin,
  verifyEmail,
  forgotPassword,
  resetPassword,
  isDemoUser,
  isDemoEmail,
} from '../../services/authService.js';

describe('AuthService', () => {
  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // Password Hashing Tests
  // ============================================
  describe('Password Hashing', () => {
    describe('hashPassword', () => {
      it('should hash a password', async () => {
        const password = 'TestPassword123!';
        const hash = await hashPassword(password);

        expect(hash).toBeDefined();
        expect(hash).not.toBe(password);
        expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);
      });

      it('should produce different hashes for the same password', async () => {
        const password = 'TestPassword123!';
        const hash1 = await hashPassword(password);
        const hash2 = await hashPassword(password);

        expect(hash1).not.toBe(hash2);
      });
    });

    describe('verifyPassword', () => {
      it('should verify correct password', async () => {
        const password = 'TestPassword123!';
        const hash = await hashPassword(password);

        const result = await verifyPassword(password, hash);
        expect(result).toBe(true);
      });

      it('should reject incorrect password', async () => {
        const password = 'TestPassword123!';
        const hash = await hashPassword(password);

        const result = await verifyPassword('WrongPassword!', hash);
        expect(result).toBe(false);
      });
    });

    describe('validatePasswordStrength', () => {
      it('should accept valid strong password', () => {
        const result = validatePasswordStrength('StrongP@ss123');
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject short password', () => {
        const result = validatePasswordStrength('Sh0rt!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long');
      });

      it('should reject password without uppercase', () => {
        const result = validatePasswordStrength('lowercase123!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one uppercase letter');
      });

      it('should reject password without lowercase', () => {
        const result = validatePasswordStrength('UPPERCASE123!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one lowercase letter');
      });

      it('should reject password without number', () => {
        const result = validatePasswordStrength('NoNumbersHere!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one number');
      });

      it('should reject password without special character', () => {
        const result = validatePasswordStrength('NoSpecial123');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one special character');
      });

      it('should return multiple errors for very weak password', () => {
        const result = validatePasswordStrength(WEAK_PASSWORD);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(1);
      });
    });
  });

  // ============================================
  // JWT Token Tests
  // ============================================
  describe('JWT Token Management', () => {
    describe('generateAccessToken', () => {
      it('should generate a valid JWT access token', () => {
        const user = testUsers.verified;
        const token = generateAccessToken(user);

        expect(token).toBeDefined();
        expect(typeof token).toBe('string');

        // Verify token structure
        const decoded = jwt.decode(token) as { id: string; email: string; type: string };
        expect(decoded.id).toBe(user.id);
        expect(decoded.email).toBe(user.email);
        expect(decoded.type).toBe('access');
      });
    });

    describe('verifyAccessToken', () => {
      it('should verify a valid access token', () => {
        const user = testUsers.verified;
        const token = generateAccessToken(user);

        const payload = verifyAccessToken(token);

        expect(payload).not.toBeNull();
        expect(payload?.id).toBe(user.id);
        expect(payload?.email).toBe(user.email);
        expect(payload?.type).toBe('access');
      });

      it('should return null for invalid token', () => {
        const payload = verifyAccessToken('invalid-token');
        expect(payload).toBeNull();
      });

      it('should return null for expired token', () => {
        // Create a token that expires immediately
        const user = testUsers.verified;
        const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role, type: 'access' },
          process.env.JWT_ACCESS_SECRET!,
          { expiresIn: '-1s' }
        );

        const payload = verifyAccessToken(token);
        expect(payload).toBeNull();
      });

      it('should return null for refresh token used as access token', () => {
        const user = testUsers.verified;
        const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role, type: 'refresh', jti: 'test' },
          process.env.JWT_ACCESS_SECRET!,
          { expiresIn: '15m' }
        );

        const payload = verifyAccessToken(token);
        expect(payload).toBeNull();
      });
    });

    describe('generateTokens', () => {
      it('should generate both access and refresh tokens', async () => {
        const user = testUsers.verified;
        mockPrisma.session.create.mockResolvedValue({
          id: 'session-id',
          userId: user.id,
          token: 'token',
          expiresAt: new Date(),
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });

        const tokens = await generateTokens(user);

        expect(tokens.accessToken).toBeDefined();
        expect(tokens.refreshToken).toBeDefined();
        expect(mockPrisma.session.create).toHaveBeenCalled();
      });

      it('should store session metadata', async () => {
        const user = testUsers.verified;
        const metadata = { ipAddress: '192.168.1.1', userAgent: 'Test Browser' };

        mockPrisma.session.create.mockResolvedValue({
          id: 'session-id',
          userId: user.id,
          token: 'token',
          expiresAt: new Date(),
          createdAt: new Date(),
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        });

        await generateTokens(user, metadata);

        expect(mockPrisma.session.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              ipAddress: metadata.ipAddress,
              userAgent: metadata.userAgent,
            }),
          })
        );
      });
    });

    describe('verifyRefreshToken', () => {
      it('should verify a valid refresh token with active session', async () => {
        const user = testUsers.verified;
        const tokenId = 'test-jti-123';

        // Create a valid refresh token
        const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role, type: 'refresh', jti: tokenId },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '7d' }
        );

        mockPrisma.session.findUnique.mockResolvedValue({
          id: tokenId,
          userId: user.id,
          token: token.substring(0, 500),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });

        const payload = await verifyRefreshToken(token);

        expect(payload).not.toBeNull();
        expect(payload?.id).toBe(user.id);
        expect(payload?.jti).toBe(tokenId);
      });

      it('should return null for expired session', async () => {
        const user = testUsers.verified;
        const tokenId = 'expired-session-jti';

        const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role, type: 'refresh', jti: tokenId },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '7d' }
        );

        // Session expired in database
        mockPrisma.session.findUnique.mockResolvedValue({
          id: tokenId,
          userId: user.id,
          token: token.substring(0, 500),
          expiresAt: new Date(Date.now() - 1000), // Expired
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });
        mockPrisma.session.delete.mockResolvedValue({} as never);

        const payload = await verifyRefreshToken(token);
        expect(payload).toBeNull();
      });

      it('should return null for revoked session', async () => {
        const user = testUsers.verified;
        const tokenId = 'revoked-session-jti';

        const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role, type: 'refresh', jti: tokenId },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '7d' }
        );

        // Session not found (revoked)
        mockPrisma.session.findUnique.mockResolvedValue(null);

        const payload = await verifyRefreshToken(token);
        expect(payload).toBeNull();
      });
    });

    describe('revokeRefreshToken', () => {
      it('should delete session from database', async () => {
        const tokenId = 'session-to-revoke';
        const token = jwt.sign(
          { id: 'user-id', email: 'test@example.com', role: 'PATIENT', type: 'refresh', jti: tokenId },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '7d' }
        );

        mockPrisma.session.delete.mockResolvedValue({} as never);

        const result = await revokeRefreshToken(token);

        expect(result).toBe(true);
        expect(mockPrisma.session.delete).toHaveBeenCalledWith({
          where: { id: tokenId },
        });
      });
    });

    describe('revokeAllUserTokens', () => {
      it('should delete all sessions for a user', async () => {
        const userId = 'user-123';
        mockPrisma.session.deleteMany.mockResolvedValue({ count: 3 });

        await revokeAllUserTokens(userId);

        expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
          where: { userId },
        });
      });
    });

    describe('refreshTokens', () => {
      it('should issue new tokens for valid refresh token', async () => {
        const user = testUsers.verified;
        const tokenId = 'old-session-id';

        const oldRefreshToken = jwt.sign(
          { id: user.id, email: user.email, role: user.role, type: 'refresh', jti: tokenId },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '7d' }
        );

        // Mock session exists
        mockPrisma.session.findUnique.mockResolvedValue({
          id: tokenId,
          userId: user.id,
          token: oldRefreshToken.substring(0, 500),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });

        // Mock user lookup
        mockPrisma.user.findUnique.mockResolvedValue(user);

        // Mock session deletion and creation
        mockPrisma.session.delete.mockResolvedValue({} as never);
        mockPrisma.session.create.mockResolvedValue({
          id: 'new-session-id',
          userId: user.id,
          token: 'new-token',
          expiresAt: new Date(),
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });

        const result = await refreshTokens(oldRefreshToken);

        expect(result).not.toBeNull();
        expect(result?.tokens.accessToken).toBeDefined();
        expect(result?.tokens.refreshToken).toBeDefined();
        expect(result?.isDemo).toBe(false);
      });

      it('should return null for invalid refresh token', async () => {
        const result = await refreshTokens('invalid-token');
        expect(result).toBeNull();
      });

      it('should return null for inactive user', async () => {
        const user = testUsers.inactive;
        const tokenId = 'inactive-user-session';

        const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role, type: 'refresh', jti: tokenId },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '7d' }
        );

        mockPrisma.session.findUnique.mockResolvedValue({
          id: tokenId,
          userId: user.id,
          token: token.substring(0, 500),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });

        mockPrisma.user.findUnique.mockResolvedValue(user);

        const result = await refreshTokens(token);
        expect(result).toBeNull();
      });
    });
  });

  // ============================================
  // Account Lockout Tests
  // ============================================
  describe('Account Lockout', () => {
    describe('isAccountLocked', () => {
      it('should return true for locked account', () => {
        const result = isAccountLocked(testUsers.locked);
        expect(result).toBe(true);
      });

      it('should return false for unlocked account', () => {
        const result = isAccountLocked(testUsers.verified);
        expect(result).toBe(false);
      });

      it('should return false for expired lockout', () => {
        const expiredLockUser = {
          ...testUsers.locked,
          lockedUntil: new Date(Date.now() - 1000), // 1 second ago
        };
        const result = isAccountLocked(expiredLockUser);
        expect(result).toBe(false);
      });
    });

    describe('recordFailedLogin', () => {
      it('should increment failed attempts', async () => {
        const user = { ...testUsers.verified, failedLoginAttempts: 2 };
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          failedLoginAttempts: 3,
        });

        const result = await recordFailedLogin(user);

        expect(result.locked).toBe(false);
        expect(result.remainingAttempts).toBe(2); // 5 max - 3 = 2
      });

      it('should lock account after max attempts', async () => {
        const user = { ...testUsers.verified, failedLoginAttempts: 4 };
        const lockedUntil = new Date(Date.now() + 30 * 60 * 1000);

        mockPrisma.user.update.mockResolvedValue({
          ...user,
          failedLoginAttempts: 5,
          lockedUntil,
        });

        const result = await recordFailedLogin(user);

        expect(result.locked).toBe(true);
        expect(result.remainingAttempts).toBe(0);
        expect(result.lockedUntil).toBeDefined();
      });
    });

    describe('resetFailedLoginAttempts', () => {
      it('should reset attempts and lockout', async () => {
        const user = testUsers.locked;
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedLogin: null,
          lastLoginAt: new Date(),
        });

        await resetFailedLoginAttempts(user);

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
          where: { id: user.id },
          data: expect.objectContaining({
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastFailedLogin: null,
          }),
        });
      });
    });
  });

  // ============================================
  // User Management Tests
  // ============================================
  describe('User Management', () => {
    describe('createUser', () => {
      it('should create a new user with verification token', async () => {
        const email = 'newuser@example.com';
        const password = VALID_PASSWORD;

        mockPrisma.user.create.mockResolvedValue({
          id: 'new-user-id',
          email,
          passwordHash: 'hashed',
          role: 'PATIENT',
          isActive: true,
          emailVerified: false,
          emailVerificationToken: 'verification-token',
          emailVerificationExpires: new Date(),
          passwordResetToken: null,
          passwordResetExpires: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedLogin: null,
        });

        const result = await createUser(email, password);

        expect(result.user).toBeDefined();
        expect(result.user.email).toBe(email);
        expect(result.user.emailVerified).toBe(false);
        expect(result.verificationToken).toBeDefined();
        expect(mockPrisma.user.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              email,
              emailVerified: false,
            }),
          })
        );
      });

      it('should create user with specified role', async () => {
        mockPrisma.user.create.mockResolvedValue({
          id: 'admin-id',
          email: 'admin@example.com',
          passwordHash: 'hashed',
          role: 'ADMIN',
          isActive: true,
          emailVerified: false,
          emailVerificationToken: 'token',
          emailVerificationExpires: new Date(),
          passwordResetToken: null,
          passwordResetExpires: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedLogin: null,
        });

        const result = await createUser('admin@example.com', VALID_PASSWORD, 'ADMIN');

        expect(result.user.role).toBe('ADMIN');
      });
    });

    describe('findUserByEmail', () => {
      it('should find existing user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.verified);

        const user = await findUserByEmail(testUsers.verified.email);

        expect(user).not.toBeNull();
        expect(user?.email).toBe(testUsers.verified.email);
      });

      it('should return null for non-existent user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const user = await findUserByEmail('nonexistent@example.com');

        expect(user).toBeNull();
      });

      it('should normalize email to lowercase', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.verified);

        await findUserByEmail('TEST@EXAMPLE.COM');

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
          where: { email: 'test@example.com' },
        });
      });
    });

    describe('findUserById', () => {
      it('should find existing user by ID', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.verified);

        const user = await findUserById(testUsers.verified.id);

        expect(user).not.toBeNull();
        expect(user?.id).toBe(testUsers.verified.id);
      });

      it('should return null for non-existent ID', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const user = await findUserById('nonexistent-id');

        expect(user).toBeNull();
      });
    });

    describe('emailExists', () => {
      it('should return true for existing email', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.verified);

        const exists = await emailExists(testUsers.verified.email);

        expect(exists).toBe(true);
      });

      it('should return false for non-existent email', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const exists = await emailExists('nonexistent@example.com');

        expect(exists).toBe(false);
      });
    });
  });

  // ============================================
  // Login Tests
  // ============================================
  describe('attemptLogin', () => {
    describe('successful login', () => {
      it('should login verified user with correct password', async () => {
        const user = testUsers.verified;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          failedLoginAttempts: 0,
          lastLoginAt: new Date(),
        });

        const result = await attemptLogin(user.email, VALID_PASSWORD);

        expect(result.success).toBe(true);
        expect(result.user).toBeDefined();
        expect(result.user?.email).toBe(user.email);
      });
    });

    describe('failed login - wrong password', () => {
      it('should fail with incorrect password', async () => {
        const user = testUsers.verified;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          failedLoginAttempts: 1,
        });

        const result = await attemptLogin(user.email, 'WrongPassword123!');

        expect(result.success).toBe(false);
        expect(result.remainingAttempts).toBeDefined();
      });
    });

    describe('failed login - user not found', () => {
      it('should fail gracefully for non-existent user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const result = await attemptLogin('nonexistent@example.com', VALID_PASSWORD);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid email or password');
      });

      it('should not reveal if user exists (timing attack protection)', async () => {
        // Just ensure consistent error message
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const result = await attemptLogin('nonexistent@example.com', VALID_PASSWORD);

        expect(result.error).toBe('Invalid email or password');
      });
    });

    describe('failed login - account locked', () => {
      it('should reject login for locked account', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.locked);

        const result = await attemptLogin(testUsers.locked.email, VALID_PASSWORD);

        expect(result.success).toBe(false);
        expect(result.lockedUntil).toBeDefined();
      });
    });

    describe('failed login - unverified email', () => {
      it('should reject login for unverified email', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.unverified);

        const result = await attemptLogin(testUsers.unverified.email, VALID_PASSWORD);

        expect(result.success).toBe(false);
        expect(result.emailNotVerified).toBe(true);
      });
    });

    describe('failed login - inactive account', () => {
      it('should reject login for inactive account', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.inactive);

        const result = await attemptLogin(testUsers.inactive.email, VALID_PASSWORD);

        expect(result.success).toBe(false);
        expect(result.error).toContain('deactivated');
      });
    });

    describe('demo account login', () => {
      it('should allow demo login when demo is enabled', async () => {
        const demoUser = testUsers.demo;
        mockPrisma.user.findUnique.mockResolvedValue(demoUser);
        mockPrisma.user.update.mockResolvedValue({
          ...demoUser,
          failedLoginAttempts: 0,
          lastLoginAt: new Date(),
        });

        const result = await attemptLogin(DEMO_EMAIL, DEMO_PASSWORD);

        expect(result.success).toBe(true);
        expect(result.user?.email).toBe(DEMO_EMAIL);
      });
    });
  });

  // ============================================
  // Email Verification Tests
  // ============================================
  describe('Email Verification', () => {
    describe('verifyEmail', () => {
      it('should verify email with valid token', async () => {
        const user = testUsers.unverified;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpires: null,
        });

        const result = await verifyEmail(user.emailVerificationToken!);

        expect(result.success).toBe(true);
        expect(result.user?.emailVerified).toBe(true);
      });

      it('should fail with invalid token', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const result = await verifyEmail('invalid-token');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid');
      });

      it('should fail with expired token', async () => {
        const expiredUser = {
          ...testUsers.unverified,
          emailVerificationExpires: new Date(Date.now() - 1000), // Expired
        };
        mockPrisma.user.findUnique.mockResolvedValue(expiredUser);

        const result = await verifyEmail(expiredUser.emailVerificationToken!);

        expect(result.success).toBe(false);
        expect(result.error).toContain('expired');
      });

      it('should fail for already verified email', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.verified);

        const result = await verifyEmail('some-token');

        expect(result.success).toBe(false);
        expect(result.error).toContain('already verified');
      });
    });
  });

  // ============================================
  // Password Reset Tests
  // ============================================
  describe('Password Reset', () => {
    describe('forgotPassword', () => {
      it('should generate reset token for existing user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.verified);
        mockPrisma.user.update.mockResolvedValue({
          ...testUsers.verified,
          passwordResetToken: 'new-reset-token',
          passwordResetExpires: new Date(),
        });

        const result = await forgotPassword(testUsers.verified.email);

        expect(result.success).toBe(true);
        expect(result.token).toBeDefined();
      });

      it('should return success for non-existent user (no enumeration)', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const result = await forgotPassword('nonexistent@example.com');

        expect(result.success).toBe(true);
        expect(result.token).toBeUndefined(); // But no token generated
      });

      it('should return success for inactive user (no enumeration)', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.inactive);

        const result = await forgotPassword(testUsers.inactive.email);

        expect(result.success).toBe(true);
        expect(result.token).toBeUndefined();
      });
    });

    describe('resetPassword', () => {
      it('should reset password with valid token', async () => {
        const user = testUsers.withResetToken;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          passwordResetToken: null,
          passwordResetExpires: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        });
        mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });

        const result = await resetPassword(user.passwordResetToken!, 'NewPassword123!');

        expect(result.success).toBe(true);
        expect(result.user).toBeDefined();
      });

      it('should fail with invalid token', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const result = await resetPassword('invalid-token', 'NewPassword123!');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid or expired');
      });

      it('should fail with expired token', async () => {
        const user = testUsers.withExpiredResetToken;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          passwordResetToken: null,
          passwordResetExpires: null,
        });

        const result = await resetPassword(user.passwordResetToken!, 'NewPassword123!');

        expect(result.success).toBe(false);
        expect(result.error).toContain('expired');
      });

      it('should fail with weak password', async () => {
        const user = testUsers.withResetToken;
        mockPrisma.user.findUnique.mockResolvedValue(user);

        const result = await resetPassword(user.passwordResetToken!, 'weak');

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should revoke all sessions after password reset', async () => {
        const user = testUsers.withResetToken;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          passwordResetToken: null,
          passwordResetExpires: null,
        });
        mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });

        await resetPassword(user.passwordResetToken!, 'NewPassword123!');

        expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
          where: { userId: user.id },
        });
      });
    });
  });

  // ============================================
  // Demo Account Helper Tests
  // ============================================
  describe('Demo Account Helpers', () => {
    describe('isDemoUser', () => {
      it('should return true for demo user', () => {
        expect(isDemoUser(testUsers.demo)).toBe(true);
      });

      it('should return false for regular user', () => {
        expect(isDemoUser(testUsers.verified)).toBe(false);
      });

      it('should be case insensitive', () => {
        const upperCaseDemo = { ...testUsers.demo, email: 'DEMO@OWNMYHEALTH.COM' };
        expect(isDemoUser(upperCaseDemo)).toBe(true);
      });
    });

    describe('isDemoEmail', () => {
      it('should return true for demo email', () => {
        expect(isDemoEmail(DEMO_EMAIL)).toBe(true);
      });

      it('should return false for regular email', () => {
        expect(isDemoEmail('regular@example.com')).toBe(false);
      });

      it('should be case insensitive and trim whitespace', () => {
        expect(isDemoEmail('  DEMO@OWNMYHEALTH.COM  ')).toBe(true);
      });
    });
  });
});
