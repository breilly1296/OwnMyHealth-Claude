/**
 * Authentication Routes
 *
 * All routes use HTTP-only cookies for token storage.
 * Rate limiting is applied to prevent brute force attacks.
 * Input validation with Zod prevents injection and ensures data integrity.
 */

import { Router } from 'express';
import {
  register,
  login,
  logout,
  logoutAll,
  getCurrentUser,
  changePassword,
  refreshToken,
  demoLogin,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPasswordHandler,
  changeEmailHandler,
  confirmEmailChangeHandler,
} from '../controllers/authController.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { authLimiter, strictAuthLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';

const router = Router();

// Apply rate limiting to all auth routes
router.use(authLimiter);

// ============================================
// Public Routes
// ============================================

// Register new user
router.post(
  '/register',
  validate(schemas.auth.register),
  asyncHandler(register)
);

// Login (extra strict rate limiting)
router.post(
  '/login',
  strictAuthLimiter,
  validate(schemas.auth.login),
  asyncHandler(login)
);

// Refresh access token using refresh token from cookie
router.post('/refresh', asyncHandler(refreshToken));

// Demo login for development
router.post('/demo', asyncHandler(demoLogin));

// Email verification
router.get(
  '/verify-email',
  validate(schemas.auth.verifyEmailQuery, 'query'),
  asyncHandler(verifyEmail)
);

// Resend verification email — strictAuthLimiter to prevent enumeration +
// email-bombing via repeated resend-requests. Matches /forgot-password and
// /reset-password rate-limit posture.
router.post(
  '/resend-verification',
  strictAuthLimiter,
  validate(schemas.auth.resendVerification),
  asyncHandler(resendVerification)
);

// Forgot password - request reset token (strict rate limiting)
router.post(
  '/forgot-password',
  strictAuthLimiter,
  validate(schemas.auth.forgotPassword),
  asyncHandler(forgotPassword)
);

// Reset password - use reset token to set new password (strict rate limiting to prevent token brute-force)
router.post(
  '/reset-password',
  strictAuthLimiter,
  validate(schemas.auth.resetPassword),
  asyncHandler(resetPasswordHandler)
);

// Confirm an email change via tokenized link (public; strict rate limiting to
// prevent token brute-force, mirroring /reset-password).
router.get(
  '/confirm-email-change',
  strictAuthLimiter,
  validate(schemas.auth.confirmEmailChangeQuery, 'query'),
  asyncHandler(confirmEmailChangeHandler)
);

// ============================================
// Protected Routes (require authentication)
// ============================================

// Logout current session. optionalAuth, NOT authenticate: the idle-logoff
// fires at exactly the access-token expiry, so a hard auth gate would 401
// before the controller could revoke the refresh session — leaving the
// 7-day refresh cookie alive and the "logged out" user silently re-
// authenticated on the next page load. CSRF (global middleware) plus
// possession of the refresh_token cookie is the proof of session ownership;
// the controller is idempotent for requests with no cookies at all.
router.post('/logout', optionalAuth, asyncHandler(logout));

// Logout from all devices
router.post('/logout-all', authenticate, asyncHandler(logoutAll));

// Get current user info
router.get('/me', authenticate, asyncHandler(getCurrentUser));

// Change password
router.post(
  '/change-password',
  authenticate,
  validate(schemas.auth.changePassword),
  asyncHandler(changePassword)
);

// Request an email-address change (re-auth with current password; sends a
// confirmation link to the new address + a notice to the old). Strict limiter
// to throttle the email it triggers and the password re-check.
router.post(
  '/change-email',
  authenticate,
  strictAuthLimiter,
  validate(schemas.auth.changeEmail),
  asyncHandler(changeEmailHandler)
);

export default router;
