import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as authService from './authService.js';
import { config } from '../config/index.js';
import { JWT_SIGN_OPTIONS, JWT_VERIFY_OPTIONS } from '../config/jwtOptions.js';
import { getPrismaClient, withRLSContext } from './database.js';
import { logger } from '../utils/logger.js';
import type { User as PrismaUser, UserRole } from '../../generated/prisma/index.js';

// Mock dependencies
vi.mock('bcryptjs');
vi.mock('jsonwebtoken');
vi.mock('crypto', () => ({
    default: {
        randomBytes: vi.fn(() => Buffer.alloc(32, 'a')), // 32 bytes of 'a' = 64 hex chars of '61'
    }
}));
vi.mock('uuid', () => ({ v4: vi.fn() }));
vi.mock('../config/index.js');
vi.mock('../utils/logger.js');

// C-8 Part 2b-i — every DB operation in authService now goes through
// withRLSContext(userId|null, (tx) => ..., options?). The mock forwards
// `tx` as the same mockPrisma object, so existing mockPrisma.* expectations
// keep working unchanged. Re-bind in beforeEach because vi.resetAllMocks()
// wipes the implementation.
const mocks = vi.hoisted(() => ({
  mockPrismaForRLS: null as unknown,
  withRLSContext: vi.fn(),
  getPrismaClient: vi.fn(),
}));

vi.mock('./database.js', () => ({
  getPrismaClient: mocks.getPrismaClient,
  withRLSContext: mocks.withRLSContext,
}));

const MOCK_USER_ID = 'test-user-id-123';
const MOCK_EMAIL = 'test@example.com';
const MOCK_PASSWORD = 'Password123!';
const MOCK_PASSWORD_HASH = 'hashedPassword123';
const MOCK_ACCESS_SECRET = 'test_access_secret';
const MOCK_REFRESH_SECRET = 'test_refresh_secret';
const MOCK_DEMO_EMAIL = 'demo@example.com';
const MOCK_DEMO_PASSWORD = 'DemoPassword123!';

const MOCK_USER: PrismaUser = {
  id: MOCK_USER_ID,
  email: MOCK_EMAIL,
  passwordHash: MOCK_PASSWORD_HASH,
  role: 'PATIENT',
  isActive: true,
  emailVerified: true,
  emailVerificationToken: null,
  emailVerificationExpires: null,
  passwordResetToken: null,
  passwordResetExpires: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  lastFailedLogin: null,
  firstNameEncrypted: null,
  lastNameEncrypted: null,
  dateOfBirthEncrypted: null,
  phoneEncrypted: null,
  addressEncrypted: null,
};

const MOCK_DEMO_USER: PrismaUser = {
  ...MOCK_USER,
  email: MOCK_DEMO_EMAIL,
  id: 'demo-user-id-456',
};

// Mock Prisma client type for testing
interface MockPrismaClient {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  session: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
}

// JWT payload type for mocking
interface MockJwtPayload {
  id: string;
  email: string;
  role: string;
  type: string;
  jti?: string;
}

describe('authService', () => {
  let mockPrisma: MockPrismaClient;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();

    // Mock config values
    vi.mocked(config).jwt = {
      accessSecret: MOCK_ACCESS_SECRET,
      refreshSecret: MOCK_REFRESH_SECRET,
      accessExpiresIn: '15m',
      refreshExpiresIn: '7d',
    };
    vi.mocked(config).security = {
      bcryptRounds: 10,
      maxLoginAttempts: 5,
      lockoutDuration: 15 * 60 * 1000, // 15 minutes
    };
    vi.mocked(config).demo = {
        enabled: true,
        email: MOCK_DEMO_EMAIL,
        password: MOCK_DEMO_PASSWORD,
    };
    vi.mocked(config).cookie = {
        maxAge: {
            refreshToken: 7 * 24 * 60 * 60 * 1000, // 7 days
        }
    };

    // Mock Prisma Client
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      session: {
        create: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
    // Re-bind withRLSContext implementation each test — resetAllMocks wipes it.
    mocks.mockPrismaForRLS = mockPrisma;
    mocks.withRLSContext.mockImplementation(
      async (_userId: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(mocks.mockPrismaForRLS)
    );
    mocks.getPrismaClient.mockReturnValue(mockPrisma);
    vi.mocked(getPrismaClient).mockReturnValue(mockPrisma);

    // Mock bcryptjs
    vi.mocked(bcrypt.hash).mockResolvedValue(MOCK_PASSWORD_HASH);
    vi.mocked(bcrypt.compare).mockResolvedValue(true);

    // Mock jsonwebtoken
    vi.mocked(jwt.sign).mockImplementation((payload, secret, options) => {
        const expiresIn = (options as jwt.SignOptions).expiresIn;
        const payloadObj = payload as MockJwtPayload;
        return `mock-jwt-token-${payloadObj.type}-${expiresIn}`;
    });
    vi.mocked(jwt.verify).mockImplementation((token, secret) => {
        if (token.includes('mock-jwt-token-access') && secret === MOCK_ACCESS_SECRET) {
            return { id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'access' };
        }
        if (token.includes('mock-jwt-token-refresh') && secret === MOCK_REFRESH_SECRET) {
            return { id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'refresh', jti: 'mock-jti-123' };
        }
        throw new Error('Invalid token');
    });
    vi.mocked(jwt.decode).mockImplementation((token) => {
        if (token.includes('mock-jwt-token-refresh')) {
            return { id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'refresh', jti: 'mock-jti-123' };
        }
        return null;
    });

    // Mock crypto.randomBytes for predictable outputs (32 bytes = 64 hex chars)
    vi.mocked(crypto.randomBytes).mockReturnValue(Buffer.alloc(32, 'a'));


    // Mock uuidv4
    vi.mocked(uuidv4).mockReturnValue('mock-jti-123');

    // Mock logger
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.warn).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});

  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // Password Hashing & Verification Tests
  // ============================================
  describe('Password Hashing & Verification', () => {
    it('hashPassword should hash a password', async () => {
      const password = 'mysecretpassword';
      const hashedPassword = await authService.hashPassword(password);
      expect(bcrypt.hash).toHaveBeenCalledWith(password, config.security.bcryptRounds);
      expect(hashedPassword).toBe(MOCK_PASSWORD_HASH);
    });

    it('verifyPassword should verify a correct password', async () => {
      const password = 'mysecretpassword';
      const hash = 'somehash';
      const isValid = await authService.verifyPassword(password, hash);
      expect(bcrypt.compare).toHaveBeenCalledWith(password, hash);
      expect(isValid).toBe(true);
    });

    it('verifyPassword should return false for an incorrect password', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(false);
      const password = 'wrongpassword';
      const hash = 'somehash';
      const isValid = await authService.verifyPassword(password, hash);
      expect(isValid).toBe(false);
    });

    it('validatePasswordStrength should return valid for a strong password', () => {
      const result = authService.validatePasswordStrength(MOCK_PASSWORD); // Password123!
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('validatePasswordStrength should return errors for a weak password', () => {
      const result = authService.validatePasswordStrength('short');
      expect(result.valid).toBe(false);
      // 'short' fails 4 checks: length, uppercase, number, special char (has lowercase)
      expect(result.errors.length).toBe(4);
      expect(result.errors).toContain('Password must be at least 12 characters long');
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
      expect(result.errors).toContain('Password must contain at least one number');
      expect(result.errors).toContain('Password must contain at least one special character');
    });
  });

  // ============================================
  // JWT Token Management Tests
  // ============================================
  describe('JWT Token Management', () => {
    const mockUserForToken = { ...MOCK_USER, email: MOCK_EMAIL, role: 'PATIENT' as UserRole };

    it('generateAccessToken should create an access token', () => {
      const token = authService.generateAccessToken(mockUserForToken);
      expect(jwt.sign).toHaveBeenCalledWith(
        { id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'access' },
        MOCK_ACCESS_SECRET,
        { ...JWT_SIGN_OPTIONS, expiresIn: '15m' }
      );
      expect(token).toBe('mock-jwt-token-access-15m');
    });

    it('isDemoUser should identify a demo user', () => {
        expect(authService.isDemoUser(MOCK_DEMO_USER)).toBe(true);
        expect(authService.isDemoUser(MOCK_USER)).toBe(false);
    });

    it('isDemoEmail should identify a demo email', () => {
        expect(authService.isDemoEmail(MOCK_DEMO_EMAIL)).toBe(true);
        expect(authService.isDemoEmail(MOCK_DEMO_EMAIL.toUpperCase())).toBe(true);
        expect(authService.isDemoEmail(MOCK_EMAIL)).toBe(false);
    });

    it('generateRefreshToken should create a refresh token and store it in DB for regular user', async () => {
      vi.mocked(uuidv4).mockReturnValueOnce('mock-jti-regular');
      vi.mocked(config.demo).enabled = false; // Ensure not demo

      const refreshToken = await authService.generateRefreshToken(mockUserForToken, { ipAddress: '127.0.0.1' });

      expect(jwt.sign).toHaveBeenCalledWith(
        { id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'refresh', jti: 'mock-jti-regular' },
        MOCK_REFRESH_SECRET,
        { ...JWT_SIGN_OPTIONS, expiresIn: '7d' }
      );
      expect(mockPrisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'mock-jti-regular',
            userId: MOCK_USER_ID,
            token: expect.any(String), // Truncated token
            ipAddress: '127.0.0.1',
            expiresAt: expect.any(Date),
          }),
        })
      );
      expect(refreshToken).toBe('mock-jwt-token-refresh-7d');
    });

    it('generateRefreshToken should create a longer-lived refresh token for demo user if demo enabled', async () => {
        vi.mocked(uuidv4).mockReturnValueOnce('mock-jti-demo');
        vi.mocked(config.demo).enabled = true; // Ensure demo enabled

        const demoUserForToken = { ...MOCK_DEMO_USER, email: MOCK_DEMO_EMAIL, role: 'PATIENT' as UserRole };
        const refreshToken = await authService.generateRefreshToken(demoUserForToken);

        expect(jwt.sign).toHaveBeenCalledWith(
            { id: demoUserForToken.id, email: MOCK_DEMO_EMAIL, role: 'PATIENT', type: 'refresh', jti: 'mock-jti-demo' },
            MOCK_REFRESH_SECRET,
            { ...JWT_SIGN_OPTIONS, expiresIn: '30d' }
        );
        expect(mockPrisma.session.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    id: 'mock-jti-demo',
                    userId: demoUserForToken.id,
                    expiresAt: expect.any(Date),
                }),
            })
        );
        expect(refreshToken).toBe('mock-jwt-token-refresh-30d');
    });

    it('generateTokens should generate both access and refresh tokens', async () => {
      const tokens = await authService.generateTokens(mockUserForToken);
      expect(tokens.accessToken).toBe('mock-jwt-token-access-15m');
      expect(tokens.refreshToken).toBe('mock-jwt-token-refresh-7d');
    });

    it('verifyAccessToken should verify a valid access token', () => {
      const payload = authService.verifyAccessToken('mock-jwt-token-access-15m');
      expect(jwt.verify).toHaveBeenCalledWith('mock-jwt-token-access-15m', MOCK_ACCESS_SECRET, JWT_VERIFY_OPTIONS);
      expect(payload).toEqual({ id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'access' });
    });

    it('verifyAccessToken should return null for an invalid access token', () => {
      vi.mocked(jwt.verify).mockImplementationOnce(() => { throw new Error('Invalid token'); });
      const payload = authService.verifyAccessToken('invalid-access-token');
      expect(payload).toBeNull();
    });

    it('verifyAccessToken should return null if token type is not access', () => {
        vi.mocked(jwt.verify).mockReturnValueOnce({ id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'refresh' });
        const payload = authService.verifyAccessToken('mock-jwt-token-access-15m');
        expect(payload).toBeNull();
    });

    it('verifyAccessToken rejects a token signed without issuer/audience claims', async () => {
        // Real jsonwebtoken validates iss/aud when JWT_VERIFY_OPTIONS requires them.
        // Simulate its behavior: a token missing those claims causes verify to throw.
        const actualJwt = await vi.importActual<typeof import('jsonwebtoken')>('jsonwebtoken');
        const tokenWithoutClaims = actualJwt.sign(
            { id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'access' },
            MOCK_ACCESS_SECRET,
            { algorithm: 'HS256', expiresIn: '15m' }
        );

        vi.mocked(jwt.verify).mockImplementationOnce((token, secret, options) => {
            return actualJwt.verify(token as string, secret as string, options as jwt.VerifyOptions);
        });

        const payload = authService.verifyAccessToken(tokenWithoutClaims);
        expect(payload).toBeNull();
    });

    it('verifyRefreshToken should verify a valid refresh token', async () => {
      mockPrisma.session.findUnique.mockResolvedValueOnce({
        id: 'mock-jti-123',
        userId: MOCK_USER_ID,
        token: 'mock-jwt-token-refresh-7d',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiresAt: new Date(Date.now() + 10000), // Not expired
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const payload = await authService.verifyRefreshToken('mock-jwt-token-refresh-7d');
      expect(jwt.verify).toHaveBeenCalledWith('mock-jwt-token-refresh-7d', MOCK_REFRESH_SECRET, JWT_VERIFY_OPTIONS);
      expect(payload).toEqual({ id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'refresh', jti: 'mock-jti-123' });
    });

    it('verifyRefreshToken should return null if refresh token is expired in DB', async () => {
      mockPrisma.session.findUnique.mockResolvedValueOnce({
        id: 'mock-jti-123',
        userId: MOCK_USER_ID,
        token: 'mock-jwt-token-refresh-7d',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiresAt: new Date(Date.now() - 10000), // Expired
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const payload = await authService.verifyRefreshToken('mock-jwt-token-refresh-7d');
      expect(payload).toBeNull();
      expect(mockPrisma.session.delete).toHaveBeenCalledWith({ where: { id: 'mock-jti-123' } });
    });

    it('verifyRefreshToken should return null for an invalid refresh token', async () => {
      vi.mocked(jwt.verify).mockImplementationOnce(() => { throw new Error('Invalid token'); });
      const payload = await authService.verifyRefreshToken('invalid-refresh-token');
      expect(payload).toBeNull();
    });

    it('revokeRefreshToken should delete the session from the database', async () => {
        vi.mocked(jwt.decode).mockReturnValueOnce({ id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'refresh', jti: 'mock-jti-123' });
        mockPrisma.session.delete.mockResolvedValueOnce({});
        const success = await authService.revokeRefreshToken('mock-jwt-token-refresh-7d');
        expect(mockPrisma.session.delete).toHaveBeenCalledWith({ where: { id: 'mock-jti-123' } });
        expect(success).toBe(true);
    });

    it('revokeAllUserTokens should delete all sessions for a user', async () => {
        mockPrisma.session.deleteMany.mockResolvedValueOnce({ count: 2 });
        await authService.revokeAllUserTokens(MOCK_USER_ID);
        expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: MOCK_USER_ID } });
    });

    it('refreshTokens should return new tokens and isDemo flag on valid refresh', async () => {
        const testRefreshToken = 'mock-jwt-token-refresh-test';

        // jwt.verify is synchronous, use mockReturnValue not mockResolvedValue
        vi.mocked(jwt.verify).mockReturnValue({ id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'refresh', jti: 'old-jti' } as MockJwtPayload);
        // jwt.decode is used by revokeRefreshToken to get the jti
        vi.mocked(jwt.decode).mockReturnValueOnce({ id: MOCK_USER_ID, email: MOCK_EMAIL, role: 'PATIENT', type: 'refresh', jti: 'old-jti' } as MockJwtPayload);
        mockPrisma.session.findUnique.mockResolvedValueOnce({
            id: 'old-jti',
            userId: MOCK_USER_ID,
            expiresAt: new Date(Date.now() + 10000),
            token: testRefreshToken,
        });
        mockPrisma.user.findUnique.mockResolvedValueOnce(MOCK_USER);
        mockPrisma.session.delete.mockResolvedValueOnce({}); // for revoking old token
        vi.mocked(uuidv4).mockReturnValueOnce('new-jti'); // for new refresh token

        const result = await authService.refreshTokens(testRefreshToken);

        expect(result).not.toBeNull();
        expect(result?.tokens.accessToken).toBe('mock-jwt-token-access-15m');
        expect(result?.tokens.refreshToken).toBe('mock-jwt-token-refresh-7d');
        expect(result?.isDemo).toBe(false);
        expect(mockPrisma.session.delete).toHaveBeenCalledWith({ where: { id: 'old-jti' } });
        expect(mockPrisma.session.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ id: 'new-jti', userId: MOCK_USER_ID }),
            })
        );
    });

    it('refreshTokens should return null for an invalid refresh token', async () => {
        vi.mocked(jwt.verify).mockImplementationOnce(() => { throw new Error('Invalid token'); }); // Simulate invalid token
        const result = await authService.refreshTokens('invalid-refresh-token');
        expect(result).toBeNull();
    });
  });

  // ============================================
  // Account Lockout Tests
  // ============================================
  describe('Account Lockout', () => {
    let lockedUser: PrismaUser;
    let now: Date;

    beforeEach(() => {
        now = new Date();
        vi.setSystemTime(now); // Set current time for predictable calculations

        lockedUser = {
            ...MOCK_USER,
            failedLoginAttempts: config.security.maxLoginAttempts,
            lockedUntil: new Date(now.getTime() + config.security.lockoutDuration),
        };
    });

    it('isAccountLocked should return true if account is locked', () => {
        expect(authService.isAccountLocked(lockedUser)).toBe(true);
    });

    it('isAccountLocked should return false if account is not locked', () => {
        const unlockedUser = { ...MOCK_USER, lockedUntil: null };
        expect(authService.isAccountLocked(unlockedUser)).toBe(false);
    });

    it('isAccountLocked should return false if lockedUntil is in the past', () => {
        const expiredLockUser = { ...MOCK_USER, lockedUntil: new Date(now.getTime() - 1000) };
        expect(authService.isAccountLocked(expiredLockUser)).toBe(false);
    });

    it('getLockoutRemainingTime should return correct remaining time', () => {
        const remaining = authService.getLockoutRemainingTime(lockedUser);
        expect(remaining).toBeCloseTo(config.security.lockoutDuration / 1000, -1); // Check within ~1 second
    });

    it('getLockoutRemainingTime should return 0 if not locked', () => {
        const unlockedUser = { ...MOCK_USER, lockedUntil: null };
        expect(authService.getLockoutRemainingTime(unlockedUser)).toBe(0);
    });

    it('recordFailedLogin should increment failed attempts', async () => {
        mockPrisma.user.update.mockResolvedValueOnce(MOCK_USER); // Simulate update
        const userWithAttempts = { ...MOCK_USER, failedLoginAttempts: 2 };
        await authService.recordFailedLogin(userWithAttempts);
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    failedLoginAttempts: 3,
                    lastFailedLogin: now,
                    lockedUntil: null,
                },
            })
        );
    });

    it('recordFailedLogin should lock account if max attempts reached', async () => {
        mockPrisma.user.update.mockResolvedValueOnce(lockedUser); // Simulate update
        const userAtLimit = { ...MOCK_USER, failedLoginAttempts: config.security.maxLoginAttempts - 1 };
        const result = await authService.recordFailedLogin(userAtLimit);
        expect(result.locked).toBe(true);
        expect(result.remainingAttempts).toBe(0);
        expect(result.lockedUntil).toEqual(new Date(now.getTime() + config.security.lockoutDuration));
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    failedLoginAttempts: config.security.maxLoginAttempts,
                    lastFailedLogin: now,
                    lockedUntil: new Date(now.getTime() + config.security.lockoutDuration),
                },
            })
        );
    });

    it('resetFailedLoginAttempts should reset lockout fields', async () => {
        mockPrisma.user.update.mockResolvedValueOnce(MOCK_USER); // Simulate update
        const userToReset = { ...lockedUser, failedLoginAttempts: 3 };
        await authService.resetFailedLoginAttempts(userToReset);
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    failedLoginAttempts: 0,
                    lockedUntil: null,
                    lastFailedLogin: null,
                    lastLoginAt: now,
                },
            })
        );
    });
  });

  // ============================================
  // User Management Tests (Prisma-based)
  // ============================================
  describe('User Management', () => {
    it('generateEmailVerificationToken should generate a hex string', () => {
      const token = authService.generateEmailVerificationToken();
      expect(crypto.randomBytes).toHaveBeenCalledWith(32);
      expect(token).toBe('6161616161616161616161616161616161616161616161616161616161616161');
      expect(token).toHaveLength(64);
    });

    it('createUser should create a new user and return verification token', async () => {
      vi.mocked(bcrypt.hash).mockResolvedValueOnce('newhashedpassword');
      mockPrisma.user.create.mockResolvedValueOnce({
        ...MOCK_USER,
        id: 'new-user-id',
        email: MOCK_EMAIL,
        passwordHash: 'newhashedpassword',
        emailVerified: false,
        emailVerificationToken: '6161616161616161616161616161616161616161616161616161616161616161',
        emailVerificationExpires: expect.any(Date),
      });

      const result = await authService.createUser(MOCK_EMAIL, MOCK_PASSWORD);

      expect(bcrypt.hash).toHaveBeenCalledWith(MOCK_PASSWORD, config.security.bcryptRounds);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: MOCK_EMAIL,
            passwordHash: 'newhashedpassword',
            emailVerified: false,
            emailVerificationToken: '6161616161616161616161616161616161616161616161616161616161616161',
            emailVerificationExpires: expect.any(Date),
          }),
        })
      );
      expect(result.user.email).toBe(MOCK_EMAIL);
      expect(result.verificationToken).toBe('6161616161616161616161616161616161616161616161616161616161616161');
    });

    it('findUserByEmail should return a user if found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(MOCK_USER);
      const user = await authService.findUserByEmail(MOCK_EMAIL);
      expect(user?.id).toBe(MOCK_USER_ID);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: MOCK_EMAIL } });
    });

    it('findUserByEmail should return null if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      const user = await authService.findUserByEmail('nonexistent@example.com');
      expect(user).toBeNull();
    });

    it('findUserById should return a user if found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(MOCK_USER);
      const user = await authService.findUserById(MOCK_USER_ID);
      expect(user?.email).toBe(MOCK_EMAIL);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: MOCK_USER_ID } });
    });

    it('findUserById should return null if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      const user = await authService.findUserById('nonexistent-id');
      expect(user).toBeNull();
    });

    it('emailExists should return true if email exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(MOCK_USER);
      const exists = await authService.emailExists(MOCK_EMAIL);
      expect(exists).toBe(true);
    });

    it('emailExists should return false if email does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      const exists = await authService.emailExists('nonexistent@example.com');
      expect(exists).toBe(false);
    });

    it('updateUserPassword should update user password', async () => {
      mockPrisma.user.update.mockResolvedValueOnce(MOCK_USER);
      const newHash = 'new_hashed_password';
      await authService.updateUserPassword(MOCK_USER_ID, newHash);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MOCK_USER_ID },
          data: { passwordHash: newHash },
        })
      );
    });
  });

  // ============================================
  // Login Flow Tests
  // ============================================
  describe('attemptLogin', () => {
    beforeEach(() => {
        // Default findUserByEmail to return MOCK_USER unless specifically overridden
        mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
        vi.mocked(bcrypt.compare).mockResolvedValue(true); // Default password correct
    });

    it('should successfully log in a regular user', async () => {
        const result = await authService.attemptLogin(MOCK_EMAIL, MOCK_PASSWORD);
        expect(result.success).toBe(true);
        expect(result.user).toEqual(expect.objectContaining({ id: MOCK_USER_ID, email: MOCK_EMAIL }));
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    failedLoginAttempts: 0,
                    lockedUntil: null,
                    lastFailedLogin: null,
                    lastLoginAt: expect.any(Date),
                }),
            })
        );
    });

    it('should return error for invalid credentials for regular user', async () => {
        vi.mocked(bcrypt.compare).mockResolvedValueOnce(false); // Incorrect password
        mockPrisma.user.update.mockResolvedValueOnce({ ...MOCK_USER, failedLoginAttempts: 1 }); // simulate recordFailedLogin update

        const result = await authService.attemptLogin(MOCK_EMAIL, 'wrong-password');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid email or password');
        expect(result.remainingAttempts).toBe(config.security.maxLoginAttempts - 1);
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ failedLoginAttempts: 1 }),
            })
        );
    });

    it('should lock account after max failed attempts for regular user', async () => {
        vi.mocked(bcrypt.compare).mockResolvedValue(false);
        // Simulate user with max attempts - 1
        mockPrisma.user.findUnique.mockResolvedValueOnce({ ...MOCK_USER, failedLoginAttempts: config.security.maxLoginAttempts - 1 });
        // Simulate the update from recordFailedLogin
        mockPrisma.user.update.mockResolvedValueOnce({
            ...MOCK_USER,
            failedLoginAttempts: config.security.maxLoginAttempts,
            lockedUntil: new Date(Date.now() + config.security.lockoutDuration),
        });

        const result = await authService.attemptLogin(MOCK_EMAIL, 'wrong-password');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Account locked');
        expect(result.lockedUntil).not.toBeNull();
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    failedLoginAttempts: config.security.maxLoginAttempts,
                    lockedUntil: expect.any(Date),
                }),
            })
        );
    });

    it('should return error if account is locked for regular user', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            ...MOCK_USER,
            lockedUntil: new Date(Date.now() + config.security.lockoutDuration),
        });
        const result = await authService.attemptLogin(MOCK_EMAIL, MOCK_PASSWORD);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Account is locked');
    });

    it('should return error if email is not verified for regular user', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({ ...MOCK_USER, emailVerified: false });
        const result = await authService.attemptLogin(MOCK_EMAIL, MOCK_PASSWORD);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Email not verified');
        expect(result.emailNotVerified).toBe(true);
    });

    it('should return error if account is inactive for regular user', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({ ...MOCK_USER, isActive: false });
        const result = await authService.attemptLogin(MOCK_EMAIL, MOCK_PASSWORD);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Account is deactivated');
    });

    it('should handle non-existent user with timing attack protection', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);
        vi.spyOn(global, 'setTimeout').mockImplementation((cb: () => void) => { cb(); return 0 as unknown as NodeJS.Timeout; });
        vi.mocked(bcrypt.compare).mockResolvedValueOnce(false); // for timing safe dummy hash
        const result = await authService.attemptLogin('nonexistent@example.com', MOCK_PASSWORD);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid email or password');
        expect(bcrypt.compare).toHaveBeenCalledTimes(1); // One call for the timing safe hash
    });

    it('should successfully log in demo user when demo mode enabled', async () => {
        // First findUnique call: findUserByEmail
        // Second findUnique call: findUserById after update
        mockPrisma.user.findUnique
            .mockResolvedValueOnce(MOCK_DEMO_USER) // findUserByEmail
            .mockResolvedValueOnce(MOCK_DEMO_USER); // findUserById after update
        mockPrisma.user.update.mockResolvedValueOnce(MOCK_DEMO_USER); // update returns demo user
        vi.mocked(config.demo).enabled = true;
        vi.mocked(bcrypt.compare).mockResolvedValueOnce(true); // Correct password

        const result = await authService.attemptLogin(MOCK_DEMO_EMAIL, MOCK_DEMO_PASSWORD);

        expect(result.success).toBe(true);
        expect(result.user?.email).toBe(MOCK_DEMO_EMAIL);
        // Check that demo user specific fields are reset/set correctly
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    failedLoginAttempts: 0,
                    lockedUntil: null,
                    emailVerified: true,
                    isActive: true,
                }),
            })
        );
    });

    it('should return error if demo user does not exist yet when demo mode enabled', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null); // Demo user not found
        vi.mocked(config.demo).enabled = true;

        const result = await authService.attemptLogin(MOCK_DEMO_EMAIL, MOCK_DEMO_PASSWORD);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Demo account not yet initialized');
    });


    it('should return error if demo account is attempted when demo mode is disabled', async () => {
        vi.mocked(config.demo).enabled = false; // Demo mode disabled
        const result = await authService.attemptLogin(MOCK_DEMO_EMAIL, MOCK_DEMO_PASSWORD);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Demo mode is disabled in production');
    });
  });

  // ============================================
  // Email Verification Tests
  // ============================================
  describe('Email Verification', () => {
    const MOCK_VERIFICATION_TOKEN = '6161616161616161616161616161616161616161616161616161616161616161';
    let userWithToken: PrismaUser;

    beforeEach(() => {
        userWithToken = {
            ...MOCK_USER,
            emailVerified: false,
            emailVerificationToken: MOCK_VERIFICATION_TOKEN,
            emailVerificationExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        };
        mockPrisma.user.findUnique.mockResolvedValue(userWithToken);
    });

    it('verifyEmail should successfully verify an email', async () => {
        mockPrisma.user.update.mockResolvedValueOnce({ ...userWithToken, emailVerified: true, emailVerificationToken: null, emailVerificationExpires: null });
        const result = await authService.verifyEmail(MOCK_VERIFICATION_TOKEN);
        expect(result.success).toBe(true);
        expect(result.user?.emailVerified).toBe(true);
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: userWithToken.id },
                data: {
                    emailVerified: true,
                    emailVerificationToken: null,
                    emailVerificationExpires: null,
                },
            })
        );
    });

    it('verifyEmail should return error for invalid token', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);
        const result = await authService.verifyEmail('invalid-token');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid verification token');
    });

    it('verifyEmail should return error if token has expired', async () => {
        userWithToken.emailVerificationExpires = new Date(Date.now() - 1000); // Expired
        mockPrisma.user.findUnique.mockResolvedValueOnce(userWithToken);
        const result = await authService.verifyEmail(MOCK_VERIFICATION_TOKEN);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Verification token has expired');
    });

    it('verifyEmail should return error if email is already verified', async () => {
        userWithToken.emailVerified = true;
        mockPrisma.user.findUnique.mockResolvedValueOnce(userWithToken);
        const result = await authService.verifyEmail(MOCK_VERIFICATION_TOKEN);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Email is already verified');
    });

    it('resendVerificationEmail should generate a new token if email exists and is not verified', async () => {
        mockPrisma.user.update.mockResolvedValueOnce(userWithToken);
        const result = await authService.resendVerificationEmail(MOCK_EMAIL);
        expect(result.success).toBe(true);
        expect(result.token).toBe('6161616161616161616161616161616161616161616161616161616161616161'); // Mocked crypto.randomBytes output
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: userWithToken.id },
                data: {
                    emailVerificationToken: '6161616161616161616161616161616161616161616161616161616161616161',
                    emailVerificationExpires: expect.any(Date),
                },
            })
        );
    });

    it('resendVerificationEmail should return success:true and no token if email does not exist (no info leakage)', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);
        const result = await authService.resendVerificationEmail('nonexistent@example.com');
        expect(result.success).toBe(true);
        expect(result.token).toBeUndefined();
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('resendVerificationEmail should return error if email is already verified', async () => {
        userWithToken.emailVerified = true;
        mockPrisma.user.findUnique.mockResolvedValueOnce(userWithToken);
        const result = await authService.resendVerificationEmail(MOCK_EMAIL);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Email is already verified');
    });

    it('findUserByVerificationToken should return a user if found', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(userWithToken);
        const user = await authService.findUserByVerificationToken(MOCK_VERIFICATION_TOKEN);
        expect(user?.id).toBe(MOCK_USER_ID);
    });

    it('findUserByVerificationToken should return null if user not found', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);
        const user = await authService.findUserByVerificationToken('nonexistent-token');
        expect(user).toBeNull();
    });
  });

  // ============================================
  // Password Reset Tests
  // ============================================
  describe('Password Reset', () => {
    const MOCK_RESET_TOKEN = '6161616161616161616161616161616161616161616161616161616161616161';
    let userWithResetToken: PrismaUser;

    beforeEach(() => {
        userWithResetToken = {
            ...MOCK_USER,
            passwordResetToken: MOCK_RESET_TOKEN,
            passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        };
        mockPrisma.user.findUnique.mockResolvedValue(userWithResetToken);
    });

    it('generatePasswordResetToken should generate a hex string', () => {
        const token = authService.generatePasswordResetToken();
        expect(crypto.randomBytes).toHaveBeenCalledWith(32);
        expect(token).toBe('6161616161616161616161616161616161616161616161616161616161616161');
        expect(token).toHaveLength(64);
    });

    it('forgotPassword should generate a new reset token if email exists and is active', async () => {
        mockPrisma.user.update.mockResolvedValueOnce(userWithResetToken);
        const result = await authService.forgotPassword(MOCK_EMAIL);
        expect(result.success).toBe(true);
        expect(result.token).toBe('6161616161616161616161616161616161616161616161616161616161616161');
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: userWithResetToken.id },
                data: {
                    passwordResetToken: '6161616161616161616161616161616161616161616161616161616161616161',
                    passwordResetExpires: expect.any(Date),
                },
            })
        );
    });

    it('forgotPassword should return success:true and no token if email does not exist (no info leakage)', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);
        const result = await authService.forgotPassword('nonexistent@example.com');
        expect(result.success).toBe(true);
        expect(result.token).toBeUndefined();
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('forgotPassword should return success:true and no token if user is inactive', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({ ...MOCK_USER, isActive: false });
        const result = await authService.forgotPassword(MOCK_EMAIL);
        expect(result.success).toBe(true);
        expect(result.token).toBeUndefined();
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('resetPassword should successfully reset password and revoke all tokens', async () => {
        const NEW_PASSWORD = 'NewSecurePassword123!';
        const NEW_PASSWORD_HASH = 'new_hashed_secure_password';
        vi.mocked(bcrypt.hash).mockResolvedValueOnce(NEW_PASSWORD_HASH);
        mockPrisma.user.update.mockResolvedValueOnce({ ...userWithResetToken, passwordHash: NEW_PASSWORD_HASH });
        mockPrisma.session.deleteMany.mockResolvedValueOnce({});

        const result = await authService.resetPassword(MOCK_RESET_TOKEN, NEW_PASSWORD);

        expect(result.success).toBe(true);
        expect(result.user?.passwordHash).toBe(NEW_PASSWORD_HASH);
        expect(bcrypt.hash).toHaveBeenCalledWith(NEW_PASSWORD, config.security.bcryptRounds);
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: userWithResetToken.id },
                data: {
                    passwordHash: NEW_PASSWORD_HASH,
                    passwordResetToken: null,
                    passwordResetExpires: null,
                    failedLoginAttempts: 0,
                    lockedUntil: null,
                },
            })
        );
        expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: userWithResetToken.id } });
    });

    it('resetPassword should return error for invalid reset token', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);
        const result = await authService.resetPassword('invalid-token', MOCK_PASSWORD);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid or expired reset token');
    });

    it('resetPassword should return error if reset token has expired', async () => {
        userWithResetToken.passwordResetExpires = new Date(Date.now() - 1000); // Expired
        mockPrisma.user.findUnique.mockResolvedValueOnce(userWithResetToken);
        // Simulate update to clear expired token
        mockPrisma.user.update.mockResolvedValueOnce({ ...userWithResetToken, passwordResetToken: null, passwordResetExpires: null });
        const result = await authService.resetPassword(MOCK_RESET_TOKEN, MOCK_PASSWORD);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Reset token has expired');
    });

    it('resetPassword should return error for weak new password', async () => {
        const WEAK_PASSWORD = 'weak';
        const result = await authService.resetPassword(MOCK_RESET_TOKEN, WEAK_PASSWORD);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Password must be at least 12 characters long');
    });

    it('findUserByResetToken should return a user if found', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(userWithResetToken);
        const user = await authService.findUserByResetToken(MOCK_RESET_TOKEN);
        expect(user?.id).toBe(MOCK_USER_ID);
    });

    it('findUserByResetToken should return null if user not found', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);
        const user = await authService.findUserByResetToken('nonexistent-token');
        expect(user).toBeNull();
    });
  });

  // ============================================
  // Initialize Demo User Tests
  // ============================================
  describe('initializeDemoUser', () => {
    beforeEach(() => {
        vi.mocked(config.demo).enabled = true;
        vi.mocked(config.demo).email = MOCK_DEMO_EMAIL;
        vi.mocked(config.demo).password = MOCK_DEMO_PASSWORD;
        // Default prisma to not find demo user unless specified
        mockPrisma.user.findUnique.mockResolvedValue(null);
    });

    it('should create a demo user if none exists and demo mode is enabled', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce(null); // No existing demo user
        mockPrisma.user.create.mockResolvedValueOnce({ ...MOCK_DEMO_USER, emailVerified: false, isActive: false });
        mockPrisma.user.update.mockResolvedValueOnce(MOCK_DEMO_USER); // For auto-verify

        await authService.initializeDemoUser();

        expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: MOCK_DEMO_EMAIL }) }));
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: MOCK_DEMO_USER.id },
                data: expect.objectContaining({
                    emailVerified: true,
                    isActive: true,
                }),
            })
        );
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Demo user created (auto-verified)'), expect.any(Object));
    });

    it('should update an existing demo user if demo mode is enabled', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({ ...MOCK_DEMO_USER, emailVerified: false, isActive: false, failedLoginAttempts: 2 });
        mockPrisma.user.update.mockResolvedValueOnce(MOCK_DEMO_USER);

        await authService.initializeDemoUser();

        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: MOCK_DEMO_USER.id },
                data: expect.objectContaining({
                    emailVerified: true,
                    isActive: true,
                    failedLoginAttempts: 0,
                    lockedUntil: null,
                }),
            })
        );
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Demo user verified'), expect.any(Object));
    });

    it('should do nothing if demo mode is disabled', async () => {
        vi.mocked(config.demo).enabled = false;
        await authService.initializeDemoUser();
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
    });

    it('should log an error if database is not ready during creation', async () => {
        mockPrisma.user.findUnique.mockRejectedValue(new Error('DB not ready'));
        await authService.initializeDemoUser();
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Could not create/verify demo user'), expect.any(Object));
    });
  });

  // ============================================
  // Token Cleanup Tests
  // ============================================
  describe('Token Cleanup', () => {
    let now: Date;
    let setIntervalSpy: ReturnType<typeof vi.spyOn>;
    let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        now = new Date();
        vi.setSystemTime(now);
        setIntervalSpy = vi.spyOn(global, 'setInterval');
        clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    });

    afterEach(() => {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
    });

    it('cleanupExpiredSessions should delete expired sessions', async () => {
        mockPrisma.session.deleteMany.mockResolvedValueOnce({ count: 5 });
        await authService.cleanupExpiredSessions();
        expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    expiresAt: { lt: now },
                },
            })
        );
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Cleaned up 5 expired sessions'), expect.any(Object));
    });

    it('cleanupExpiredSessions should log an error if prisma fails', async () => {
        mockPrisma.session.deleteMany.mockRejectedValueOnce(new Error('DB error'));
        await authService.cleanupExpiredSessions();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to cleanup expired sessions'), expect.any(Object));
    });

    it('startSessionCleanup should start an interval for cleanup', () => {
        authService.startSessionCleanup();
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Session cleanup scheduler started'), expect.any(Object));
    });

    it('startSessionCleanup should not start multiple intervals', () => {
        // Stop any existing interval from previous test
        authService.stopSessionCleanup();
        // Clear the spy counts
        setIntervalSpy.mockClear();

        authService.startSessionCleanup();
        authService.startSessionCleanup(); // Call again - should not start new interval
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });

    it('stopSessionCleanup should stop the interval', () => {
        authService.startSessionCleanup();
        authService.stopSessionCleanup();
        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Session cleanup scheduler stopped'), expect.any(Object));
    });

    it('stopSessionCleanup should do nothing if no interval is running', () => {
        authService.stopSessionCleanup(); // Call without starting
        expect(clearIntervalSpy).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Session cleanup scheduler stopped'), expect.any(Object));
    });
  });

  describe('RLS context wrapping (C-8 Part 2b-i)', () => {
    it('cleanupExpiredSessions runs inside admin RLS context', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 3 });

      await authService.cleanupExpiredSessions();

      expect(withRLSContext).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { isAdmin: true }
      );
    });

    it('revokeAllUserTokens runs inside user RLS context (no isAdmin)', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });

      await authService.revokeAllUserTokens(MOCK_USER_ID);

      expect(withRLSContext).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.any(Function)
      );
    });
  });
});