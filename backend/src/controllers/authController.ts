/**
 * Authentication Controller
 *
 * Handles user authentication with secure practices:
 * - Password hashing with bcrypt
 * - JWT access tokens (15 min) + refresh tokens (7 days)
 * - HTTP-only secure cookies
 * - Account lockout after 5 failed attempts
 */

import { Request, Response } from 'express';
import type { ApiResponse } from '../types/index.js';
import { BadRequestError, UnauthorizedError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import { getPrismaClient } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
import logger from '../utils/logger.js';
import {
  createUser,
  findUserById,
  findUserByEmail,
  emailExists,
  attemptLogin,
  generateTokens,
  validatePasswordStrength,
  revokeRefreshToken,
  revokeAllUserTokens,
  refreshTokens,
  verifyEmail as verifyEmailService,
  resendVerificationEmail as resendVerificationService,
  forgotPassword as forgotPasswordService,
  resetPassword as resetPasswordService,
  isDemoUser,
  DEMO_SESSION_DURATION_MS,
  User,
  SessionMetadata,
} from '../services/authService.js';

// ============================================
// Audit Logging Helper
// ============================================

/**
 * Get audit log service instance
 */
function getAuditService() {
  const prisma = getPrismaClient();
  return getAuditLogService(prisma);
}

// ============================================
// Request Helpers
// ============================================

/**
 * Extract session metadata from request (IP address and user agent)
 */
function getSessionMetadata(req: Request): SessionMetadata {
  // Get IP address - handle proxies
  const forwarded = req.headers['x-forwarded-for'];
  const ipAddress = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : req.socket.remoteAddress || req.ip;

  return {
    ipAddress: ipAddress?.substring(0, 45), // Limit to 45 chars (IPv6 max)
    userAgent: req.headers['user-agent']?.substring(0, 500), // Limit user agent length
  };
}

// ============================================
// Cookie Helpers
// ============================================

/**
 * Set access token in HTTP-only cookie
 */
function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    maxAge: config.cookie.maxAge.accessToken,
    path: '/',
  });
}

/**
 * Set refresh token in HTTP-only cookie
 * Demo users get a longer cookie duration (30 days) in non-production
 */
function setRefreshTokenCookie(res: Response, token: string, isDemo: boolean = false): void {
  const maxAge = (isDemo && !config.isProduction)
    ? DEMO_SESSION_DURATION_MS
    : config.cookie.maxAge.refreshToken;

  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    maxAge,
    path: '/', // Send with all requests so refresh works from any endpoint
  });
}

/**
 * Clear auth cookies
 */
function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
  });
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
  });
}

/**
 * Format user response (exclude sensitive fields)
 */
function formatUserResponse(user: User): { id: string; email: string; role: string } {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
  };
}

// ============================================
// Controllers
// ============================================

/**
 * Register a new user
 * POST /api/v1/auth/register
 */
export async function register(
  req: Request,
  res: Response
): Promise<void> {
  const { email, password } = req.body;

  // Validate required fields
  if (!email || !password) {
    throw new BadRequestError('Email and password are required');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new BadRequestError('Invalid email format');
  }

  // Validate password strength
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    throw new BadRequestError(passwordValidation.errors.join('. '));
  }

  // Check if email already exists
  if (await emailExists(email)) {
    throw new BadRequestError('Email already registered');
  }

  // Create user (starts as unverified with verification token)
  const { user, verificationToken } = await createUser(email, password);

  // Log verification URL (dev only - in production, this would send an email)
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const verificationUrl = `${baseUrl}/api/v1/auth/verify-email?token=${verificationToken}`;
  logger.devBox('📧 EMAIL VERIFICATION REQUIRED', [
    `Email: ${user.email}`,
    `Verification URL: ${verificationUrl}`,
    'Token expires in 24 hours',
  ]);

  // NOTE: We intentionally DO NOT generate tokens on registration.
  // Users must verify their email first, then log in to get tokens.
  // This ensures consistent behavior with the login flow which requires
  // email verification before allowing access.

  // Audit log: new user registration
  const auditService = getAuditService();
  await auditService.logAuth('REGISTER', { req, userId: user.id }, {
    email: user.email,
    role: user.role,
  });

  const response: ApiResponse<{
    user: { id: string; email: string; role: string };
    message: string;
  }> = {
    success: true,
    data: {
      user: formatUserResponse(user),
      message: 'Registration successful. Please check your email to verify your account.',
    },
  };

  res.status(201).json(response);
}

/**
 * Login user
 * POST /api/v1/auth/login
 */
export async function login(
  req: Request,
  res: Response
): Promise<void> {
  const { email, password } = req.body;

  // Validate required fields
  if (!email || !password) {
    throw new BadRequestError('Email and password are required');
  }

  // Attempt login with lockout protection
  const result = await attemptLogin(email, password);
  const auditService = getAuditService();

  if (!result.success) {
    // Check if email is not verified
    if (result.emailNotVerified) {
      // Audit log: login failed - email not verified
      await auditService.logAuth('LOGIN_FAILED', { req }, {
        email,
        reason: 'EMAIL_NOT_VERIFIED',
      });

      const response: ApiResponse = {
        success: false,
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: result.error || 'Email not verified',
        },
      };
      res.status(403).json(response); // 403 Forbidden
      return;
    }

    // Include lockout information in response if applicable
    if (result.lockedUntil) {
      // Audit log: account lockout
      await auditService.logAuth('ACCOUNT_LOCKOUT', { req }, {
        email,
        lockedUntil: result.lockedUntil.toISOString(),
      });

      const response: ApiResponse = {
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: result.error || 'Account is locked',
          details: {
            lockedUntil: result.lockedUntil.toISOString(),
          },
        },
      };
      res.status(423).json(response); // 423 Locked
      return;
    }

    // Include remaining attempts if applicable
    if (result.remainingAttempts !== undefined) {
      // Audit log: login failed - invalid credentials
      await auditService.logAuth('LOGIN_FAILED', { req }, {
        email,
        reason: 'INVALID_CREDENTIALS',
        remainingAttempts: result.remainingAttempts,
      });

      const response: ApiResponse = {
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: result.error || 'Invalid email or password',
          details: {
            remainingAttempts: result.remainingAttempts,
          },
        },
      };
      res.status(401).json(response);
      return;
    }

    // Audit log: login failed - generic
    await auditService.logAuth('LOGIN_FAILED', { req }, {
      email,
      reason: 'UNKNOWN',
    });

    throw new UnauthorizedError(result.error || 'Invalid email or password');
  }

  // Generate tokens with session metadata
  const sessionMetadata = getSessionMetadata(req);
  const tokens = await generateTokens(result.user!, sessionMetadata);

  // Set HTTP-only cookies (demo users get extended cookie duration)
  const isDemo = isDemoUser(result.user!);
  setAccessTokenCookie(res, tokens.accessToken);
  setRefreshTokenCookie(res, tokens.refreshToken, isDemo);

  // Audit log: successful login
  await auditService.logAuth('LOGIN', { req, userId: result.user!.id }, {
    email: result.user!.email,
  });

  const response: ApiResponse<{ user: { id: string; email: string; role: string } }> = {
    success: true,
    data: {
      user: formatUserResponse(result.user!),
    },
  };

  res.json(response);
}

/**
 * Refresh access token using refresh token
 * POST /api/v1/auth/refresh
 */
export async function refreshToken(
  req: Request,
  res: Response
): Promise<void> {
  // Get refresh token from cookie
  const refreshTokenValue = req.cookies?.refresh_token;

  if (!refreshTokenValue) {
    throw new UnauthorizedError('Refresh token not provided');
  }

  // Verify and rotate refresh token with session metadata
  const sessionMetadata = getSessionMetadata(req);
  const result = await refreshTokens(refreshTokenValue, sessionMetadata);

  if (!result) {
    // Clear invalid cookies
    clearAuthCookies(res);
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  // Set new cookies (preserve demo session duration)
  setAccessTokenCookie(res, result.tokens.accessToken);
  setRefreshTokenCookie(res, result.tokens.refreshToken, result.isDemo);

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

/**
 * Logout user
 * POST /api/v1/auth/logout
 */
export async function logout(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as Request & { user?: { id: string; email: string } };

  // Revoke refresh token if present
  const refreshTokenValue = req.cookies?.refresh_token;
  if (refreshTokenValue) {
    await revokeRefreshToken(refreshTokenValue);
  }

  // Clear cookies
  clearAuthCookies(res);

  // Audit log: logout
  const auditService = getAuditService();
  await auditService.logAuth('LOGOUT', { req, userId: authReq.user?.id }, {
    email: authReq.user?.email,
  });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

/**
 * Logout from all devices (revoke all tokens)
 * POST /api/v1/auth/logout-all
 */
export async function logoutAll(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as Request & { user?: { id: string } };

  if (!authReq.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  // Revoke all refresh tokens for this user
  await revokeAllUserTokens(authReq.user.id);

  // Clear cookies
  clearAuthCookies(res);

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

/**
 * Get current user
 * GET /api/v1/auth/me
 */
export async function getCurrentUser(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as Request & { user?: { id: string; email: string; role: string } };

  if (!authReq.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  const user = await findUserById(authReq.user.id);
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const response: ApiResponse<{ id: string; email: string; role: string }> = {
    success: true,
    data: formatUserResponse(user),
  };

  res.json(response);
}

/**
 * Change password
 * POST /api/v1/auth/change-password
 */
export async function changePassword(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as Request & { user?: { id: string } };
  const { currentPassword, newPassword } = req.body;

  if (!authReq.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  if (!currentPassword || !newPassword) {
    throw new BadRequestError('Current password and new password are required');
  }

  // Validate new password strength
  const passwordValidation = validatePasswordStrength(newPassword);
  if (!passwordValidation.valid) {
    throw new BadRequestError(passwordValidation.errors.join('. '));
  }

  const user = await findUserById(authReq.user.id);
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  // Verify current password using the auth service
  const { verifyPassword, updateUserPassword } = await import('../services/authService.js');
  const isValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!isValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  // Hash new password and update in database
  const { hashPassword } = await import('../services/authService.js');
  const newPasswordHash = await hashPassword(newPassword);
  await updateUserPassword(user.id, newPasswordHash);

  // Revoke all existing tokens (force re-login on all devices)
  await revokeAllUserTokens(user.id);

  // Get updated user and generate new tokens for this session
  const updatedUser = await findUserById(user.id);
  const sessionMetadata = getSessionMetadata(req);
  const tokens = await generateTokens(updatedUser!, sessionMetadata);
  setAccessTokenCookie(res, tokens.accessToken);
  setRefreshTokenCookie(res, tokens.refreshToken);

  // Audit log: password change
  const auditService = getAuditService();
  await auditService.logAuth('PASSWORD_CHANGE', { req, userId: user.id }, {
    email: user.email,
  });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

/**
 * Demo login (for development only)
 * POST /api/v1/auth/demo
 *
 * This endpoint uses the standard attemptLogin flow for security.
 * The demo bypass in attemptLogin() handles all the special logic.
 */
export async function demoLogin(
  req: Request,
  res: Response
): Promise<void> {
  // Only allow in development
  if (config.isProduction) {
    throw new BadRequestError('Demo login is not available in production');
  }

  const DEMO_EMAIL = 'demo@ownmyhealth.com';
  const DEMO_PASSWORD = 'Demo123!';

  // Validate that demo user exists in the database
  const demoUser = await findUserByEmail(DEMO_EMAIL);
  if (!demoUser) {
    logger.warn('Demo login attempted but demo user does not exist. Run seed script.');
    throw new BadRequestError(
      'Demo user not found. Please run database seed to create the demo account.'
    );
  }

  // Use attemptLogin for proper security flow (which has demo bypass built in)
  const result = await attemptLogin(DEMO_EMAIL, DEMO_PASSWORD);

  if (!result.success) {
    throw new BadRequestError(result.error || 'Demo login failed');
  }

  // Generate tokens with session metadata
  const sessionMetadata = getSessionMetadata(req);
  const tokens = await generateTokens(result.user!, sessionMetadata);

  // Set HTTP-only cookies with extended duration for demo
  setAccessTokenCookie(res, tokens.accessToken);
  setRefreshTokenCookie(res, tokens.refreshToken, true); // true = isDemoUser

  const response: ApiResponse<{ user: { id: string; email: string; role: string } }> = {
    success: true,
    data: {
      user: formatUserResponse(result.user!),
    },
  };

  res.json(response);
}

/**
 * Verify email address using token
 * GET /api/v1/auth/verify-email?token=xxx
 */
export async function verifyEmail(
  req: Request,
  res: Response
): Promise<void> {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    throw new BadRequestError('Verification token is required');
  }

  const result = await verifyEmailService(token);

  const auditService = getAuditService();

  if (!result.success) {
    // Audit log: email verification failed
    await auditService.logAuth('EMAIL_VERIFICATION', { req }, {
      success: false,
      reason: result.error || 'VERIFICATION_FAILED',
    });

    const response: ApiResponse = {
      success: false,
      error: {
        code: 'VERIFICATION_FAILED',
        message: result.error || 'Email verification failed',
      },
    };
    res.status(400).json(response);
    return;
  }

  // Audit log: email verification successful
  await auditService.logAuth('EMAIL_VERIFICATION', { req, userId: result.user?.id }, {
    email: result.user?.email,
    success: true,
  });

  logger.auth(`Email verified successfully for: ${result.user?.email}`);

  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: {
      message: 'Email verified successfully. You can now log in.',
    },
  };

  res.json(response);
}

/**
 * Resend email verification
 * POST /api/v1/auth/resend-verification
 */
export async function resendVerification(
  req: Request,
  res: Response
): Promise<void> {
  const { email } = req.body;

  if (!email) {
    throw new BadRequestError('Email is required');
  }

  const result = await resendVerificationService(email);

  if (!result.success) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'RESEND_FAILED',
        message: result.error || 'Failed to resend verification email',
      },
    };
    res.status(400).json(response);
    return;
  }

  // Log verification URL (dev only - in production, would send email)
  if (result.token) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const verificationUrl = `${baseUrl}/api/v1/auth/verify-email?token=${result.token}`;
    logger.devBox('📧 VERIFICATION EMAIL RESENT', [
      `Email: ${email}`,
      `Verification URL: ${verificationUrl}`,
      'Token expires in 24 hours',
    ]);
  }

  // Always return success (don't reveal if user exists)
  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: {
      message: 'If the email exists and is unverified, a new verification email has been sent.',
    },
  };

  res.json(response);
}

/**
 * Request password reset
 * POST /api/v1/auth/forgot-password
 */
export async function forgotPassword(
  req: Request,
  res: Response
): Promise<void> {
  const { email } = req.body;

  if (!email) {
    throw new BadRequestError('Email is required');
  }

  const result = await forgotPasswordService(email);

  // Audit log: password reset request
  const auditService = getAuditService();
  await auditService.logAuth('PASSWORD_RESET_REQUEST', { req }, {
    email,
    tokenGenerated: !!result.token,
  });

  // Log reset URL (dev only - in production, would send email)
  if (result.token) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${baseUrl}/api/v1/auth/reset-password?token=${result.token}`;
    logger.devBox('🔐 PASSWORD RESET REQUESTED', [
      `Email: ${email}`,
      `Reset URL: ${resetUrl}`,
      'Token expires in 1 hour',
    ]);
  }

  // Always return success (don't reveal if user exists)
  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: {
      message: 'If an account exists with this email, a password reset link has been sent.',
    },
  };

  res.json(response);
}

/**
 * Reset password with token
 * POST /api/v1/auth/reset-password
 */
export async function resetPasswordHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { token, newPassword } = req.body;

  if (!token) {
    throw new BadRequestError('Reset token is required');
  }

  if (!newPassword) {
    throw new BadRequestError('New password is required');
  }

  const result = await resetPasswordService(token, newPassword);

  const auditService = getAuditService();

  if (!result.success) {
    // Audit log: password reset failed
    await auditService.logAuth('PASSWORD_RESET_COMPLETE', { req }, {
      success: false,
      reason: result.error || 'RESET_FAILED',
    });

    const response: ApiResponse = {
      success: false,
      error: {
        code: 'RESET_FAILED',
        message: result.error || 'Password reset failed',
      },
    };
    res.status(400).json(response);
    return;
  }

  // Audit log: password reset successful
  await auditService.logAuth('PASSWORD_RESET_COMPLETE', { req, userId: result.user?.id }, {
    email: result.user?.email,
    success: true,
  });

  logger.auth(`Password reset successful for: ${result.user?.email}`);

  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: {
      message: 'Password has been reset successfully. You can now log in with your new password.',
    },
  };

  res.json(response);
}
