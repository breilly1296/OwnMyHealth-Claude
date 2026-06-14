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
import { setCsrfCookie } from '../middleware/csrf.js';
import { config } from '../config/index.js';
import { getPrismaClient } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
import logger from '../utils/logger.js';
import {
  createUser,
  hashPassword,
  findUserById,
  findUserByEmail,
  emailExists,
  attemptLogin,
  generateTokens,
  validatePasswordStrength,
  revokeRefreshToken,
  revokeAllUserTokens,
  revokeAccessToken,
  revokeAccessTokenCrossInstance,
  refreshTokens,
  verifyRefreshToken,
  verifyEmail as verifyEmailService,
  resendVerificationEmail as resendVerificationService,
  forgotPassword as forgotPasswordService,
  resetPassword as resetPasswordService,
  requestEmailChange as requestEmailChangeService,
  confirmEmailChange as confirmEmailChangeService,
  isDemoUser,
  DEMO_SESSION_DURATION_MS,
  User,
  SessionMetadata,
} from '../services/authService.js';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountExistsEmail,
  sendEmailChangeConfirmation,
  sendEmailChangeNotice,
} from '../services/emailService.js';

// Identical generic response for every registration attempt — whether or not
// the email already exists — so the API never reveals which addresses have
// accounts (account enumeration #18). The differentiated signal goes only to
// the email inbox of the address in question.
const GENERIC_REGISTER_MESSAGE =
  'Registration successful. Please check your email to verify your account.';

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
 * Extract session metadata from request (IP address and user agent).
 * Uses req.ip, which respects app.set('trust proxy') — prevents X-Forwarded-For
 * header spoofing of session IP addresses.
 */
export function getSessionMetadata(req: Request): SessionMetadata {
  return {
    ipAddress: req.ip?.substring(0, 45),
    userAgent: req.get('user-agent')?.substring(0, 500),
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
    ...(config.cookie.domain && { domain: config.cookie.domain }),
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
    ...(config.cookie.domain && { domain: config.cookie.domain }),
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
    ...(config.cookie.domain && { domain: config.cookie.domain }),
  });
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
    ...(config.cookie.domain && { domain: config.cookie.domain }),
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

  const auditService = getAuditService();

  // Account-enumeration defense (#18): NEVER reveal whether the email is
  // already registered. Both branches below return the SAME generic response
  // (and the same 201 status) AND incur the same dominant cost (one bcrypt
  // hash + one email send), so neither the response nor the latency leaks
  // existence. When the email already exists we email the real owner a notice
  // instead of leaking through the API. The explicit response-level oracle
  // (the old 400 "Email already registered") is removed.
  if (await emailExists(email)) {
    // Timing-attack defense: the new-user path runs bcrypt via createUser, so
    // run an equivalent throwaway hash here (discarded) to equalize latency —
    // mirrors the login flow's timing-safe dummy compare. Without this an
    // attacker could distinguish existing vs new emails by response time.
    await hashPassword(password);

    // Best-effort notice to the existing owner. Never block the response or
    // change its shape on failure — that would re-introduce the oracle.
    await sendAccountExistsEmail(email).catch((err) => {
      logger.error('Failed to send account-exists notice', {
        prefix: 'Auth',
        data: { error: err instanceof Error ? err.message : 'unknown' },
      });
    });

    // Audit the silently-absorbed duplicate attempt (no userId — we don't look
    // it up, to keep this path cheap and leak-free).
    await auditService.logAuth('REGISTER', { req }, {
      email,
      outcome: 'DUPLICATE_EMAIL_SILENT',
    });

    res.status(201).json({
      success: true,
      data: { message: GENERIC_REGISTER_MESSAGE },
    } satisfies ApiResponse<{ message: string }>);
    return;
  }

  // Create user (starts as unverified with verification token)
  const { user, verificationToken } = await createUser(email, password);

  // Send verification email
  await sendVerificationEmail(user.email, verificationToken);

  // NOTE: We intentionally DO NOT generate tokens on registration.
  // Users must verify their email first, then log in to get tokens.
  // This ensures consistent behavior with the login flow which requires
  // email verification before allowing access.

  // Audit log: new user registration
  await auditService.logAuth('REGISTER', { req, userId: user.id }, {
    email: user.email,
    role: user.role,
  });

  // The response intentionally OMITS the user object so it is byte-for-byte
  // identical to the duplicate-email branch above (account enumeration #18).
  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: {
      message: GENERIC_REGISTER_MESSAGE,
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

    // Invalid credentials for an EXISTING account. Do NOT leak
    // `remainingAttempts` (or a per-account countdown) to the client: it is a
    // clean account-existence oracle — a non-existent email falls through to
    // the generic 401 below with no details, so the presence of `details`
    // would reveal "this email is registered". Keep the count server-side for
    // the audit trail and lockout accounting only; return the SAME uniform 401.
    if (result.remainingAttempts !== undefined) {
      await auditService.logAuth('LOGIN_FAILED', { req }, {
        email,
        reason: 'INVALID_CREDENTIALS',
        remainingAttempts: result.remainingAttempts,
      });
      throw new UnauthorizedError('Invalid email or password');
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

  // Regenerate CSRF token to prevent token fixation attacks
  setCsrfCookie(res);

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

  // Regenerate CSRF token on refresh to limit token lifetime
  setCsrfCookie(res);

  // Return the access token in response body so frontend can store it
  // for Authorization header (needed for API calls after page refresh)
  const response: ApiResponse<{ token: string }> = {
    success: true,
    data: {
      token: result.tokens.accessToken,
    },
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

  // Revoke refresh token if present. The route uses optionalAuth, so the
  // HIPAA idle-logoff (which fires at exactly the access-token expiry) still
  // reaches this revocation with an expired access token. When req.user is
  // absent, resolve the audit identity from the live session row BEFORE
  // revoking it — verifyRefreshToken checks the signature, so a forged
  // cookie can't pollute the audit trail with arbitrary user IDs.
  const refreshTokenValue = req.cookies?.refresh_token;
  let sessionUser: { id: string; email: string } | undefined;
  if (refreshTokenValue) {
    if (!authReq.user) {
      const payload = await verifyRefreshToken(refreshTokenValue);
      if (payload) {
        sessionUser = { id: payload.id, email: payload.email };
      }
    }
    await revokeRefreshToken(refreshTokenValue);
  }

  // Revoke the access token too. Access tokens are short-lived (15 min),
  // but a logged-out user's token should stop working on this instance
  // immediately. Extract from cookie OR Authorization header — either
  // could be carrying the current session.
  const accessTokenFromCookie = req.cookies?.access_token;
  const authHeader = req.headers.authorization;
  const accessTokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  const accessTokenValue = accessTokenFromCookie || accessTokenFromHeader;
  if (accessTokenValue) {
    // In-memory blacklist stops the token immediately on THIS instance.
    revokeAccessToken(accessTokenValue);
    // M1: record the token's jti in the DB so it also stops authenticating on
    // the OTHER Cloud Run replicas — single-device logout can't stamp the
    // per-user tokensValidAfter cutoff (that kills the user's other devices).
    // Scoped to the verified identity (access token or refresh session), so a
    // forged token can't seed revocations for someone else.
    const verifiedUserId = authReq.user?.id ?? sessionUser?.id;
    if (verifiedUserId) {
      await revokeAccessTokenCrossInstance(accessTokenValue, verifiedUserId);
    }
  }

  // Clear cookies — always, even when no session resolved, so logout is
  // idempotent and a stale/unknown cookie set never survives a logout.
  clearAuthCookies(res);

  // Audit log: logout. Attributed via the access token when present, else
  // via the refresh-session lookup; unattributed when neither resolves.
  const auditUser = authReq.user ?? sessionUser;
  const auditService = getAuditService();
  await auditService.logAuth('LOGOUT', { req, userId: auditUser?.id }, {
    email: auditUser?.email,
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
  const authReq = req as Request & { user?: { id: string; email?: string } };

  if (!authReq.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  // Revoke all refresh tokens for this user
  await revokeAllUserTokens(authReq.user.id);

  // Clear cookies
  clearAuthCookies(res);

  // Audit log: logout from all devices (security-relevant event)
  const auditService = getAuditService();
  await auditService.logAuth('LOGOUT', { req, userId: authReq.user.id }, {
    authAction: 'LOGOUT_ALL_DEVICES',
    email: authReq.user.email,
  });

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

  // Revoke all existing refresh tokens (force re-login on all devices)
  await revokeAllUserTokens(user.id);

  // RT-M1: revokeAllUserTokens only deletes refresh SESSION rows — the in-flight
  // ACCESS token (short-lived JWT, valid for ~15 min) keeps authenticating until
  // natural expiry. Revoke THIS request's access token now so the just-changed
  // credentials can't keep being used on the old bearer/cookie on this instance.
  // Extract from cookie OR Authorization header — either could carry the session.
  const accessTokenFromCookie = req.cookies?.access_token;
  const authHeader = req.headers.authorization;
  const accessTokenFromHeader = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : undefined;
  const currentAccessToken = accessTokenFromCookie || accessTokenFromHeader;
  if (currentAccessToken) {
    revokeAccessToken(currentAccessToken);
  }
  // M-4 (closed): revokeAllUserTokens above also stamps the user's
  // tokensValidAfter cutoff, so cross-device access tokens (not just this node /
  // this request's token) are rejected by authenticate() against the JWT `iat`
  // on every replica within the short cutoff-cache TTL. The fresh tokens minted
  // just below survive — they're issued at/after the cutoff second and the
  // staleness check uses a strict second-granularity comparison.

  // Get updated user and generate new tokens for this session
  const updatedUser = await findUserById(user.id);
  const sessionMetadata = getSessionMetadata(req);
  const tokens = await generateTokens(updatedUser!, sessionMetadata);
  setAccessTokenCookie(res, tokens.accessToken);
  // Preserve the demo session's extended cookie duration on re-issue.
  setRefreshTokenCookie(res, tokens.refreshToken, isDemoUser(updatedUser!));

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
  // Demo mode is ONLY available in development - never in production
  if (!config.demo.enabled) {
    throw new BadRequestError('Demo mode is disabled in production');
  }

  // Validate that demo user exists in the database
  const demoUser = await findUserByEmail(config.demo.email);
  if (!demoUser) {
    logger.warn('Demo login attempted but demo user does not exist. Run seed script.');
    throw new BadRequestError(
      'Demo user not found. Please run database seed to create the demo account.'
    );
  }

  // Use attemptLogin for proper security flow (which has demo bypass built in)
  const result = await attemptLogin(config.demo.email, config.demo.password);

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

  // Send verification email only if a token was generated (i.e. the address
  // exists AND is unverified). For every other case the service returns
  // success:true with no token, so no email is sent.
  if (result.token) {
    await sendVerificationEmail(email, result.token);
  }

  // L-17: ALWAYS return the same generic 200 regardless of whether the email
  // exists, is already verified, or is unverified. The previous 400 "Email is
  // already verified" branch was an account-enumeration oracle that
  // contradicted this endpoint's own "don't reveal if user exists" comment —
  // an attacker could distinguish a registered+verified address from an
  // unknown/unverified one by the status code. The differentiated signal (a
  // verification email) goes only to the inbox of the address in question.
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

  // Send password reset email if token was generated
  if (result.token) {
    await sendPasswordResetEmail(email, result.token);
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

/**
 * Request an email-address change (authenticated)
 * POST /api/v1/auth/change-email
 *
 * Re-authenticates with the current password, then stamps a pending change and
 * fires two emails: a confirmation link to the NEW address and a security
 * notice to the OLD one. The change does not take effect until confirmed.
 */
export async function changeEmailHandler(
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as Request & { user?: { id: string } };
  const { newEmail, currentPassword } = req.body;

  if (!authReq.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  if (!newEmail || !currentPassword) {
    throw new BadRequestError('New email and current password are required');
  }

  const result = await requestEmailChangeService(authReq.user.id, newEmail, currentPassword);

  const auditService = getAuditService();

  if (!result.success) {
    await auditService.logAuth('EMAIL_CHANGE_REQUEST', { req, userId: authReq.user.id }, {
      success: false,
      reason: result.error || 'EMAIL_CHANGE_REQUEST_FAILED',
    });

    // A bad current password is an auth failure; same/taken email is a 400.
    if (result.error === 'Current password is incorrect') {
      throw new UnauthorizedError(result.error);
    }
    throw new BadRequestError(result.error || 'Email change request failed');
  }

  // Confirmation link to the new address; out-of-band security notice to the old.
  if (result.token && result.newEmail && result.oldEmail) {
    await sendEmailChangeConfirmation(result.newEmail, result.oldEmail, result.token);
    await sendEmailChangeNotice(result.oldEmail, result.newEmail);
  }

  await auditService.logAuth('EMAIL_CHANGE_REQUEST', { req, userId: authReq.user.id }, {
    success: true,
  });

  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: {
      message: 'Check your new email address for a confirmation link to complete the change.',
    },
  };

  res.json(response);
}

/**
 * Confirm a pending email change using the tokenized link (public)
 * GET /api/v1/auth/confirm-email-change?token=xxx
 *
 * Swaps the address and revokes all sessions; the user must log in again with
 * the new email. Public like verify-email — the token IS the credential.
 */
export async function confirmEmailChangeHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    throw new BadRequestError('Confirmation token is required');
  }

  const result = await confirmEmailChangeService(token);

  const auditService = getAuditService();

  if (!result.success) {
    await auditService.logAuth('EMAIL_CHANGE_COMPLETE', { req }, {
      success: false,
      reason: result.error || 'EMAIL_CHANGE_FAILED',
    });

    const response: ApiResponse = {
      success: false,
      error: {
        code: 'EMAIL_CHANGE_FAILED',
        message: result.error || 'Email change failed',
      },
    };
    res.status(400).json(response);
    return;
  }

  await auditService.logAuth('EMAIL_CHANGE_COMPLETE', { req, userId: result.user?.id }, {
    success: true,
  });

  logger.auth(`Email changed successfully for user: ${result.user?.id}`);

  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: {
      message: 'Your email address has been updated. Please log in again with your new email.',
    },
  };

  res.json(response);
}
