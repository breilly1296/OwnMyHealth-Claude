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
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
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

// Resend verification email
router.post(
  '/resend-verification',
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

// Reset password - use reset token to set new password
router.post(
  '/reset-password',
  validate(schemas.auth.resetPassword),
  asyncHandler(resetPasswordHandler)
);

// ============================================
// Protected Routes (require authentication)
// ============================================

// Logout current session
router.post('/logout', authenticate, asyncHandler(logout));

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

export default router;
