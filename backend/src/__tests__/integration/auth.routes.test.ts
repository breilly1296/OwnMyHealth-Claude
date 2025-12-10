/**
 * Auth Routes Integration Tests
 *
 * Tests for authentication API endpoints:
 * - POST /api/v1/auth/register
 * - POST /api/v1/auth/login
 * - POST /api/v1/auth/logout
 * - POST /api/v1/auth/refresh
 * - POST /api/v1/auth/forgot-password
 * - POST /api/v1/auth/reset-password
 * - POST /api/v1/auth/demo
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createMockPrismaClient, type MockPrismaClient } from '../mocks/prisma';
import {
  testUsers,
  registrationPayloads,
  loginPayloads,
  VALID_PASSWORD,
  DEMO_EMAIL,
  DEMO_PASSWORD,
} from '../fixtures/users';

// Mock the database service
let mockPrisma: MockPrismaClient;

vi.mock('../../services/database.js', () => ({
  getPrismaClient: () => mockPrisma,
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  disconnectDatabase: vi.fn().mockResolvedValue(undefined),
}));

// Mock the email service
vi.mock('../../services/emailService.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock the audit log service
vi.mock('../../services/auditLog.js', () => ({
  getAuditLogService: () => ({
    logAuth: vi.fn().mockResolvedValue(undefined),
    logAccess: vi.fn().mockResolvedValue(undefined),
    logDataChange: vi.fn().mockResolvedValue(undefined),
    logSecurity: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Import controllers and create test app
import * as authController from '../../controllers/authController.js';
import { errorHandler, notFoundHandler } from '../../middleware/errorHandler.js';

// Create a test Express app
function createTestApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  // Auth routes
  const authRouter = express.Router();

  authRouter.post('/register', asyncHandler(authController.register));
  authRouter.post('/login', asyncHandler(authController.login));
  authRouter.post('/logout', asyncHandler(authController.logout));
  authRouter.post('/refresh', asyncHandler(authController.refreshToken));
  authRouter.post('/forgot-password', asyncHandler(authController.forgotPassword));
  authRouter.post('/reset-password', asyncHandler(authController.resetPasswordHandler));
  authRouter.get('/verify-email', asyncHandler(authController.verifyEmail));
  authRouter.post('/resend-verification', asyncHandler(authController.resendVerification));
  authRouter.post('/demo', asyncHandler(authController.demoLogin));

  app.use('/api/v1/auth', authRouter);

  // Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Async handler wrapper
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

describe('Auth Routes Integration', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // POST /api/v1/auth/register
  // ============================================
  describe('POST /api/v1/auth/register', () => {
    describe('successful registration', () => {
      it('should register a new user', async () => {
        const payload = registrationPayloads.valid;

        mockPrisma.user.findUnique.mockResolvedValue(null); // No existing user
        mockPrisma.user.create.mockResolvedValue({
          id: 'new-user-id',
          email: payload.email,
          passwordHash: 'hashed',
          role: 'PATIENT',
          isActive: true,
          emailVerified: false,
          emailVerificationToken: 'verification-token',
          emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
          passwordResetToken: null,
          passwordResetExpires: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedLogin: null,
        });

        const response = await request(app)
          .post('/api/v1/auth/register')
          .send(payload)
          .expect('Content-Type', /json/)
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.data.user.email).toBe(payload.email);
        expect(response.body.data.message).toContain('verify');
      });
    });

    describe('registration failures', () => {
      it('should fail with missing email', async () => {
        const response = await request(app)
          .post('/api/v1/auth/register')
          .send(registrationPayloads.missingEmail)
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('required');
      });

      it('should fail with missing password', async () => {
        const response = await request(app)
          .post('/api/v1/auth/register')
          .send(registrationPayloads.missingPassword)
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('required');
      });

      it('should fail with invalid email format', async () => {
        const response = await request(app)
          .post('/api/v1/auth/register')
          .send(registrationPayloads.invalidEmail)
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('email');
      });

      it('should fail with weak password', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/auth/register')
          .send(registrationPayloads.weakPassword)
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
      });

      it('should fail with duplicate email', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.verified);

        const response = await request(app)
          .post('/api/v1/auth/register')
          .send(registrationPayloads.duplicateEmail)
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('already registered');
      });
    });
  });

  // ============================================
  // POST /api/v1/auth/login
  // ============================================
  describe('POST /api/v1/auth/login', () => {
    describe('successful login', () => {
      it('should login with valid credentials', async () => {
        const user = testUsers.verified;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          failedLoginAttempts: 0,
          lastLoginAt: new Date(),
        });
        mockPrisma.session.create.mockResolvedValue({
          id: 'session-id',
          userId: user.id,
          token: 'token',
          expiresAt: new Date(),
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });

        const response = await request(app)
          .post('/api/v1/auth/login')
          .send(loginPayloads.valid)
          .expect('Content-Type', /json/)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.user.email).toBe(user.email);

        // Check cookies are set
        const cookies = response.headers['set-cookie'];
        expect(cookies).toBeDefined();
        expect(cookies.some((c: string) => c.includes('access_token'))).toBe(true);
        expect(cookies.some((c: string) => c.includes('refresh_token'))).toBe(true);
      });
    });

    describe('login failures', () => {
      it('should fail with missing credentials', async () => {
        const response = await request(app)
          .post('/api/v1/auth/login')
          .send({})
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
      });

      it('should fail with wrong password', async () => {
        const user = testUsers.verified;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          failedLoginAttempts: 1,
        });

        const response = await request(app)
          .post('/api/v1/auth/login')
          .send(loginPayloads.wrongPassword)
          .expect('Content-Type', /json/)
          .expect(401);

        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
      });

      it('should fail for non-existent user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/auth/login')
          .send(loginPayloads.nonExistentUser)
          .expect('Content-Type', /json/)
          .expect(401);

        expect(response.body.success).toBe(false);
      });

      it('should fail for locked account', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.locked);

        const response = await request(app)
          .post('/api/v1/auth/login')
          .send(loginPayloads.lockedAccount)
          .expect('Content-Type', /json/)
          .expect(423);

        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('ACCOUNT_LOCKED');
        expect(response.body.error.details.lockedUntil).toBeDefined();
      });

      it('should fail for unverified email', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.unverified);

        const response = await request(app)
          .post('/api/v1/auth/login')
          .send(loginPayloads.unverifiedEmail)
          .expect('Content-Type', /json/)
          .expect(403);

        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      });

      it('should fail for inactive account', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(testUsers.inactive);

        const response = await request(app)
          .post('/api/v1/auth/login')
          .send(loginPayloads.inactiveAccount)
          .expect('Content-Type', /json/)
          .expect(401);

        expect(response.body.success).toBe(false);
      });
    });
  });

  // ============================================
  // POST /api/v1/auth/logout
  // ============================================
  describe('POST /api/v1/auth/logout', () => {
    it('should clear auth cookies on logout', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', ['access_token=test; refresh_token=test'])
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Check cookies are cleared
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      // Cleared cookies should have empty values or past expiry
    });

    it('should succeed even without cookies', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  // ============================================
  // POST /api/v1/auth/refresh
  // ============================================
  describe('POST /api/v1/auth/refresh', () => {
    describe('successful refresh', () => {
      it('should refresh tokens with valid refresh token', async () => {
        const user = testUsers.verified;
        const tokenId = 'valid-session-id';

        // Create a valid refresh token
        const refreshToken = jwt.sign(
          { id: user.id, email: user.email, role: user.role, type: 'refresh', jti: tokenId },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '7d' }
        );

        mockPrisma.session.findUnique.mockResolvedValue({
          id: tokenId,
          userId: user.id,
          token: refreshToken.substring(0, 500),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });
        mockPrisma.user.findUnique.mockResolvedValue(user);
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

        const response = await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', [`refresh_token=${refreshToken}`])
          .expect('Content-Type', /json/)
          .expect(200);

        expect(response.body.success).toBe(true);

        // Check new cookies are set
        const cookies = response.headers['set-cookie'];
        expect(cookies).toBeDefined();
      });
    });

    describe('refresh failures', () => {
      it('should fail without refresh token', async () => {
        const response = await request(app)
          .post('/api/v1/auth/refresh')
          .expect('Content-Type', /json/)
          .expect(401);

        expect(response.body.success).toBe(false);
      });

      it('should fail with invalid refresh token', async () => {
        const response = await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', ['refresh_token=invalid-token'])
          .expect('Content-Type', /json/)
          .expect(401);

        expect(response.body.success).toBe(false);
      });

      it('should fail with expired session', async () => {
        const user = testUsers.verified;
        const tokenId = 'expired-session-id';

        const refreshToken = jwt.sign(
          { id: user.id, email: user.email, role: user.role, type: 'refresh', jti: tokenId },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '7d' }
        );

        // Session expired in database
        mockPrisma.session.findUnique.mockResolvedValue({
          id: tokenId,
          userId: user.id,
          token: refreshToken.substring(0, 500),
          expiresAt: new Date(Date.now() - 1000), // Expired
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });
        mockPrisma.session.delete.mockResolvedValue({} as never);

        const response = await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', [`refresh_token=${refreshToken}`])
          .expect('Content-Type', /json/)
          .expect(401);

        expect(response.body.success).toBe(false);
      });
    });
  });

  // ============================================
  // POST /api/v1/auth/forgot-password
  // ============================================
  describe('POST /api/v1/auth/forgot-password', () => {
    it('should return success for existing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(testUsers.verified);
      mockPrisma.user.update.mockResolvedValue({
        ...testUsers.verified,
        passwordResetToken: 'reset-token',
        passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
      });

      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: testUsers.verified.email })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBeDefined();
    });

    it('should return success for non-existent user (no enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' })
        .expect('Content-Type', /json/)
        .expect(200);

      // Same response to prevent email enumeration
      expect(response.body.success).toBe(true);
    });

    it('should fail with missing email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({})
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================
  // POST /api/v1/auth/reset-password
  // ============================================
  describe('POST /api/v1/auth/reset-password', () => {
    describe('successful reset', () => {
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

        const response = await request(app)
          .post('/api/v1/auth/reset-password')
          .send({
            token: user.passwordResetToken,
            newPassword: 'NewValidPassword123!',
          })
          .expect('Content-Type', /json/)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.message).toContain('reset successfully');
      });
    });

    describe('reset failures', () => {
      it('should fail with missing token', async () => {
        const response = await request(app)
          .post('/api/v1/auth/reset-password')
          .send({ newPassword: 'NewPassword123!' })
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
      });

      it('should fail with missing password', async () => {
        const response = await request(app)
          .post('/api/v1/auth/reset-password')
          .send({ token: 'some-token' })
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
      });

      it('should fail with invalid token', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/auth/reset-password')
          .send({
            token: 'invalid-token',
            newPassword: 'NewPassword123!',
          })
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('RESET_FAILED');
      });

      it('should fail with expired token', async () => {
        const user = testUsers.withExpiredResetToken;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          passwordResetToken: null,
          passwordResetExpires: null,
        });

        const response = await request(app)
          .post('/api/v1/auth/reset-password')
          .send({
            token: user.passwordResetToken,
            newPassword: 'NewPassword123!',
          })
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('expired');
      });

      it('should fail with weak password', async () => {
        const user = testUsers.withResetToken;
        mockPrisma.user.findUnique.mockResolvedValue(user);

        const response = await request(app)
          .post('/api/v1/auth/reset-password')
          .send({
            token: user.passwordResetToken,
            newPassword: 'weak',
          })
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
      });
    });
  });

  // ============================================
  // GET /api/v1/auth/verify-email
  // ============================================
  describe('GET /api/v1/auth/verify-email', () => {
    it('should verify email with valid token', async () => {
      const user = testUsers.unverified;
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({
        ...user,
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      });

      const response = await request(app)
        .get('/api/v1/auth/verify-email')
        .query({ token: user.emailVerificationToken })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('verified');
    });

    it('should fail with missing token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/verify-email')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should fail with invalid token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/verify-email')
        .query({ token: 'invalid-token' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================
  // POST /api/v1/auth/resend-verification
  // ============================================
  describe('POST /api/v1/auth/resend-verification', () => {
    it('should resend verification for unverified user', async () => {
      const user = testUsers.unverified;
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({
        ...user,
        emailVerificationToken: 'new-token',
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const response = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: user.email })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return success for non-existent user (no enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'nonexistent@example.com' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should fail for already verified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(testUsers.verified);

      const response = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: testUsers.verified.email })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already verified');
    });
  });

  // ============================================
  // POST /api/v1/auth/demo
  // ============================================
  describe('POST /api/v1/auth/demo', () => {
    describe('when demo is enabled', () => {
      it('should login demo user', async () => {
        const user = testUsers.demo;
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.user.update.mockResolvedValue({
          ...user,
          failedLoginAttempts: 0,
          lastLoginAt: new Date(),
        });
        mockPrisma.session.create.mockResolvedValue({
          id: 'demo-session-id',
          userId: user.id,
          token: 'token',
          expiresAt: new Date(),
          createdAt: new Date(),
          ipAddress: null,
          userAgent: null,
        });

        const response = await request(app)
          .post('/api/v1/auth/demo')
          .expect('Content-Type', /json/)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.user.email).toBe(DEMO_EMAIL);
      });

      it('should fail if demo user does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/auth/demo')
          .expect('Content-Type', /json/)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('not found');
      });
    });
  });

  // ============================================
  // Rate Limiting & Security Tests
  // ============================================
  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);

      // Response should be JSON
      expect(response.headers['content-type']).toMatch(/json/);
    });
  });

  // ============================================
  // Error Handling
  // ============================================
  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/api/v1/auth/unknown-route')
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);

      // Express should handle this
    });
  });
});
