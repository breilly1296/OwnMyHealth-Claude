/**
 * Secure Authentication Service
 *
 * Provides secure user authentication with:
 * - Password hashing using bcrypt
 * - JWT tokens with short expiration (access + refresh tokens)
 * - Account lockout after failed login attempts
 * - Secure token management with PostgreSQL persistence
 *
 * All user data is now stored in PostgreSQL via Prisma.
 * Sessions are stored in the sessions table for proper token management.
 *
 * @module services/authService
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { getPrismaClient } from './database.js';
import { logger } from '../utils/logger.js';
import type { User as PrismaUser, UserRole } from '../generated/prisma/index.js';

// Email verification token expiration (24 hours)
const EMAIL_VERIFICATION_EXPIRATION_HOURS = 24;

// ============================================
// Types
// ============================================

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'PATIENT' | 'PROVIDER' | 'ADMIN';
  isActive: boolean;
  emailVerified: boolean;
  emailVerificationToken: string | null;
  emailVerificationExpires: Date | null;
  // Password reset fields
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  // Account lockout fields
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastFailedLogin: Date | null;
}

export interface TokenPayload {
  id: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResult {
  tokens: AuthTokens;
  isDemo: boolean;
}

export interface LoginAttemptResult {
  success: boolean;
  user?: User;
  remainingAttempts?: number;
  lockedUntil?: Date;
  error?: string;
  emailNotVerified?: boolean;
}

export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
}

// ============================================
// Helper: Convert Prisma User to Service User
// ============================================

function prismaUserToUser(prismaUser: PrismaUser): User {
  return {
    id: prismaUser.id,
    email: prismaUser.email,
    passwordHash: prismaUser.passwordHash,
    role: prismaUser.role as 'PATIENT' | 'PROVIDER' | 'ADMIN',
    isActive: prismaUser.isActive,
    emailVerified: prismaUser.emailVerified,
    emailVerificationToken: prismaUser.emailVerificationToken,
    emailVerificationExpires: prismaUser.emailVerificationExpires,
    passwordResetToken: prismaUser.passwordResetToken,
    passwordResetExpires: prismaUser.passwordResetExpires,
    createdAt: prismaUser.createdAt,
    updatedAt: prismaUser.updatedAt,
    lastLoginAt: prismaUser.lastLoginAt,
    failedLoginAttempts: prismaUser.failedLoginAttempts,
    lockedUntil: prismaUser.lockedUntil,
    lastFailedLogin: prismaUser.lastFailedLogin,
  };
}

// ============================================
// In-Memory Token Blacklist (for access token revocation)
// Note: For production at scale, use Redis instead
// ============================================

const revokedTokens: Set<string> = new Set();

// ============================================
// Password Hashing
// ============================================

/**
 * Hash a password using bcrypt with configurable rounds
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.security.bcryptRounds);
}

/**
 * Verify a password against its hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return { valid: errors.length === 0, errors };
}

// ============================================
// JWT Token Management
// ============================================

/**
 * Generate access token (short-lived, 15 minutes)
 */
export function generateAccessToken(user: User): string {
  const payload: TokenPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    type: 'access',
  };

  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
  });
}

// Demo account configuration - exported so other modules can use the same constant
export const DEMO_ACCOUNT_EMAIL = 'demo@ownmyhealth.com';
export const DEMO_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days for demo accounts

/**
 * Check if a user is the demo account
 */
export function isDemoUser(user: User): boolean {
  return user.email.toLowerCase() === DEMO_ACCOUNT_EMAIL;
}

/**
 * Check if an email is the demo account (for use before user lookup)
 */
export function isDemoEmail(email: string): boolean {
  return email.toLowerCase().trim() === DEMO_ACCOUNT_EMAIL;
}

/**
 * Generate refresh token (longer-lived, 7 days for regular users, 30 days for demo)
 * Stores the token in the database for validation and revocation
 * @param user - The user to generate a token for
 * @param metadata - Optional session metadata (IP address, user agent)
 */
export async function generateRefreshToken(user: User, metadata?: SessionMetadata): Promise<string> {
  const prisma = getPrismaClient();
  const tokenId = uuidv4();

  // Demo users get a longer session (30 days) when demo account is allowed
  const isDemo = isDemoUser(user) && config.allowDemoAccount;
  const sessionDuration = isDemo ? DEMO_SESSION_DURATION_MS : config.cookie.maxAge.refreshToken;
  const tokenExpiry = isDemo ? '30d' : config.jwt.refreshExpiresIn;

  const expiresAt = new Date(Date.now() + sessionDuration);

  const payload: TokenPayload & { jti: string } = {
    id: user.id,
    email: user.email,
    role: user.role,
    type: 'refresh',
    jti: tokenId, // JWT ID for revocation
  };

  const token = jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: tokenExpiry,
  });

  // Store session in database with metadata
  await prisma.session.create({
    data: {
      id: tokenId,
      userId: user.id,
      token: token.substring(0, 500), // Store truncated token for reference
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      expiresAt,
    },
  });

  return token;
}

/**
 * Generate both access and refresh tokens
 * @param user - The user to generate tokens for
 * @param metadata - Optional session metadata (IP address, user agent)
 */
export async function generateTokens(user: User, metadata?: SessionMetadata): Promise<AuthTokens> {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: await generateRefreshToken(user, metadata),
  };
}

/**
 * Verify access token
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    // Check if token is revoked
    if (revokedTokens.has(token)) {
      return null;
    }

    const payload = jwt.verify(token, config.jwt.accessSecret) as TokenPayload;

    if (payload.type !== 'access') {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify refresh token
 */
export async function verifyRefreshToken(token: string): Promise<(TokenPayload & { jti: string }) | null> {
  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret) as TokenPayload & { jti: string };

    if (payload.type !== 'refresh') {
      return null;
    }

    // Check if session exists and is not expired in database
    const prisma = getPrismaClient();
    const session = await prisma.session.findUnique({
      where: { id: payload.jti },
    });

    if (!session || session.expiresAt < new Date()) {
      // Clean up expired session
      if (session) {
        await prisma.session.delete({ where: { id: payload.jti } });
      }
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Revoke a refresh token
 */
export async function revokeRefreshToken(token: string): Promise<boolean> {
  try {
    const payload = jwt.decode(token) as TokenPayload & { jti: string } | null;
    if (payload?.jti) {
      const prisma = getPrismaClient();
      await prisma.session.delete({
        where: { id: payload.jti },
      }).catch(() => {
        // Session may not exist, that's okay
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.session.deleteMany({
    where: { userId },
  });
}

/**
 * Refresh tokens - issue new access token using refresh token
 * Returns tokens and isDemo flag to preserve demo session duration
 */
export async function refreshTokens(refreshToken: string, metadata?: SessionMetadata): Promise<RefreshResult | null> {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) {
    return null;
  }

  const user = await findUserById(payload.id);
  if (!user || !user.isActive) {
    return null;
  }

  // Revoke old refresh token (token rotation)
  await revokeRefreshToken(refreshToken);

  // Generate new tokens with session metadata
  const tokens = await generateTokens(user, metadata);

  // Return tokens with isDemo flag to preserve cookie duration
  return {
    tokens,
    isDemo: isDemoUser(user),
  };
}

// ============================================
// Account Lockout
// ============================================

/**
 * Check if account is locked
 */
export function isAccountLocked(user: User): boolean {
  if (!user.lockedUntil) {
    return false;
  }
  return user.lockedUntil > new Date();
}

/**
 * Get remaining lockout time in seconds
 */
export function getLockoutRemainingTime(user: User): number {
  if (!user.lockedUntil) {
    return 0;
  }
  const remaining = user.lockedUntil.getTime() - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
}

/**
 * Record a failed login attempt
 */
export async function recordFailedLogin(user: User): Promise<{ locked: boolean; remainingAttempts: number; lockedUntil?: Date }> {
  const prisma = getPrismaClient();
  const newAttempts = user.failedLoginAttempts + 1;
  const remainingAttempts = Math.max(0, config.security.maxLoginAttempts - newAttempts);

  // Check if we should lock the account
  const shouldLock = newAttempts >= config.security.maxLoginAttempts;
  const lockedUntil = shouldLock ? new Date(Date.now() + config.security.lockoutDuration) : null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: newAttempts,
      lastFailedLogin: new Date(),
      lockedUntil: lockedUntil,
    },
  });

  if (shouldLock) {
    return {
      locked: true,
      remainingAttempts: 0,
      lockedUntil: lockedUntil!,
    };
  }

  return {
    locked: false,
    remainingAttempts,
  };
}

/**
 * Reset failed login attempts on successful login
 */
export async function resetFailedLoginAttempts(user: User): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastFailedLogin: null,
      lastLoginAt: new Date(),
    },
  });
}

// ============================================
// User Management (Prisma-based)
// ============================================

/**
 * Generate a secure email verification token
 */
export function generateEmailVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new user with email verification token
 * User starts as unverified (emailVerified = false)
 * Returns user and verification token for logging/sending
 */
export async function createUser(
  email: string,
  password: string,
  role: 'PATIENT' | 'PROVIDER' | 'ADMIN' = 'PATIENT'
): Promise<{ user: User; verificationToken: string }> {
  const prisma = getPrismaClient();
  const passwordHash = await hashPassword(password);

  // Generate verification token
  const verificationToken = generateEmailVerificationToken();
  const verificationExpires = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRATION_HOURS * 60 * 60 * 1000);

  const prismaUser = await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      passwordHash,
      role: role as UserRole,
      failedLoginAttempts: 0,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
    },
  });

  return {
    user: prismaUserToUser(prismaUser),
    verificationToken,
  };
}

/**
 * Find user by email
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const prisma = getPrismaClient();
  const normalizedEmail = email.toLowerCase().trim();

  const prismaUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  return prismaUser ? prismaUserToUser(prismaUser) : null;
}

/**
 * Find user by ID
 */
export async function findUserById(id: string): Promise<User | null> {
  const prisma = getPrismaClient();

  const prismaUser = await prisma.user.findUnique({
    where: { id },
  });

  return prismaUser ? prismaUserToUser(prismaUser) : null;
}

/**
 * Check if email already exists
 */
export async function emailExists(email: string): Promise<boolean> {
  const user = await findUserByEmail(email);
  return user !== null;
}

/**
 * Update user password
 */
export async function updateUserPassword(userId: string, newPasswordHash: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: newPasswordHash,
    },
  });
}

/**
 * Attempt login with lockout protection
 */
export async function attemptLogin(
  email: string,
  password: string
): Promise<LoginAttemptResult> {
  const user = await findUserByEmail(email);

  // DEMO ACCOUNT: Zero restrictions - only works when demo account is allowed
  const isDemoAccount = email.toLowerCase().trim() === DEMO_ACCOUNT_EMAIL;
  if (isDemoAccount && config.allowDemoAccount) {
    if (!user) {
      // Demo user doesn't exist yet - will be created by initializeDemoUser
      return {
        success: false,
        error: 'Demo account not yet initialized. Please try again in a moment.',
      };
    }

    // For demo account, just check password (no other restrictions)
    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (isValidPassword) {
      // Reset any lockout/failed attempts for demo account
      const prisma = getPrismaClient();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedLogin: null,
          lastLoginAt: new Date(),
          emailVerified: true, // Always ensure verified
          isActive: true, // Always ensure active
        },
      });
      const updatedUser = await findUserById(user.id);
      return {
        success: true,
        user: updatedUser!,
      };
    }
    return {
      success: false,
      error: 'Invalid password for demo account',
    };
  }

  // Block demo account login attempts when demo is not allowed
  if (isDemoAccount && !config.allowDemoAccount) {
    return {
      success: false,
      error: 'Demo account is not available',
    };
  }

  // SECURITY: Timing attack protection
  // Always perform a hash comparison, even when user doesn't exist.
  // Use a pre-computed hash to ensure consistent timing regardless of user existence.
  // The hash is for "timing-attack-prevention-password" with 12 rounds.
  const TIMING_SAFE_DUMMY_HASH = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VCoBWZPW.pG4aG';

  if (!user) {
    // Perform real hash comparison to prevent timing attacks
    // This ensures the response time is similar whether user exists or not
    await bcrypt.compare(password, TIMING_SAFE_DUMMY_HASH);
    // Add small random delay (0-50ms) to further obscure timing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
    return {
      success: false,
      error: 'Invalid email or password',
    };
  }

  // Check if account is active
  if (!user.isActive) {
    return {
      success: false,
      error: 'Account is deactivated',
    };
  }

  // Check if email is verified
  if (!user.emailVerified) {
    return {
      success: false,
      error: 'Email not verified. Please check your email for the verification link.',
      emailNotVerified: true,
    };
  }

  // Check if account is locked
  if (isAccountLocked(user)) {
    const remainingTime = getLockoutRemainingTime(user);
    return {
      success: false,
      lockedUntil: user.lockedUntil!,
      error: `Account is locked. Try again in ${Math.ceil(remainingTime / 60)} minutes`,
    };
  }

  // Verify password
  const isValid = await verifyPassword(password, user.passwordHash);

  if (!isValid) {
    const lockoutResult = await recordFailedLogin(user);

    if (lockoutResult.locked) {
      return {
        success: false,
        lockedUntil: lockoutResult.lockedUntil,
        error: `Account locked due to too many failed attempts. Try again in ${config.security.lockoutDuration / 60000} minutes`,
      };
    }

    return {
      success: false,
      remainingAttempts: lockoutResult.remainingAttempts,
      error: `Invalid email or password. ${lockoutResult.remainingAttempts} attempts remaining`,
    };
  }

  // Successful login - reset failed attempts and update last login
  await resetFailedLoginAttempts(user);

  // Refresh user data after update
  const updatedUser = await findUserById(user.id);

  return {
    success: true,
    user: updatedUser!,
  };
}

// ============================================
// Email Verification
// ============================================

export interface VerifyEmailResult {
  success: boolean;
  error?: string;
  user?: User;
}

/**
 * Verify user's email using verification token
 */
export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
  const prisma = getPrismaClient();

  // Find user by verification token
  const prismaUser = await prisma.user.findUnique({
    where: { emailVerificationToken: token },
  });

  if (!prismaUser) {
    return {
      success: false,
      error: 'Invalid verification token',
    };
  }

  // Check if token is expired
  if (prismaUser.emailVerificationExpires && prismaUser.emailVerificationExpires < new Date()) {
    return {
      success: false,
      error: 'Verification token has expired. Please request a new one.',
    };
  }

  // Check if already verified
  if (prismaUser.emailVerified) {
    return {
      success: false,
      error: 'Email is already verified',
    };
  }

  // Mark user as verified and clear token
  const updatedPrismaUser = await prisma.user.update({
    where: { id: prismaUser.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    },
  });

  return {
    success: true,
    user: prismaUserToUser(updatedPrismaUser),
  };
}

/**
 * Resend email verification token
 * Generates a new token and extends expiration
 */
export async function resendVerificationEmail(email: string): Promise<{ success: boolean; token?: string; error?: string }> {
  const prisma = getPrismaClient();
  const normalizedEmail = email.toLowerCase().trim();

  const prismaUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!prismaUser) {
    // Don't reveal if user exists
    return { success: true };
  }

  if (prismaUser.emailVerified) {
    return {
      success: false,
      error: 'Email is already verified',
    };
  }

  // Generate new token
  const verificationToken = generateEmailVerificationToken();
  const verificationExpires = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRATION_HOURS * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: prismaUser.id },
    data: {
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
    },
  });

  return {
    success: true,
    token: verificationToken,
  };
}

/**
 * Find user by verification token
 */
export async function findUserByVerificationToken(token: string): Promise<User | null> {
  const prisma = getPrismaClient();
  const prismaUser = await prisma.user.findUnique({
    where: { emailVerificationToken: token },
  });
  return prismaUser ? prismaUserToUser(prismaUser) : null;
}

// ============================================
// Password Reset
// ============================================

// Password reset token expiration (1 hour)
const PASSWORD_RESET_EXPIRATION_HOURS = 1;

export interface ForgotPasswordResult {
  success: boolean;
  token?: string;
  error?: string;
}

export interface ResetPasswordResult {
  success: boolean;
  error?: string;
  user?: User;
}

/**
 * Generate a secure password reset token
 */
export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Request password reset - generates a reset token
 * Always returns success to prevent email enumeration attacks
 */
export async function forgotPassword(email: string): Promise<ForgotPasswordResult> {
  const prisma = getPrismaClient();
  const normalizedEmail = email.toLowerCase().trim();

  const prismaUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  // Always return success to prevent email enumeration
  if (!prismaUser) {
    return { success: true };
  }

  // Check if user is active
  if (!prismaUser.isActive) {
    return { success: true };
  }

  // Generate reset token
  const resetToken = generatePasswordResetToken();
  const resetExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRATION_HOURS * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: prismaUser.id },
    data: {
      passwordResetToken: resetToken,
      passwordResetExpires: resetExpires,
    },
  });

  return {
    success: true,
    token: resetToken,
  };
}

/**
 * Reset password using reset token
 */
export async function resetPassword(token: string, newPassword: string): Promise<ResetPasswordResult> {
  const prisma = getPrismaClient();

  // Find user by reset token
  const prismaUser = await prisma.user.findUnique({
    where: { passwordResetToken: token },
  });

  if (!prismaUser) {
    return {
      success: false,
      error: 'Invalid or expired reset token',
    };
  }

  // Check if token is expired
  if (prismaUser.passwordResetExpires && prismaUser.passwordResetExpires < new Date()) {
    // Clear expired token
    await prisma.user.update({
      where: { id: prismaUser.id },
      data: {
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });
    return {
      success: false,
      error: 'Reset token has expired. Please request a new password reset.',
    };
  }

  // Validate new password strength
  const passwordValidation = validatePasswordStrength(newPassword);
  if (!passwordValidation.valid) {
    return {
      success: false,
      error: passwordValidation.errors.join('. '),
    };
  }

  // Hash new password
  const newPasswordHash = await hashPassword(newPassword);

  // Update password and clear reset token
  const updatedPrismaUser = await prisma.user.update({
    where: { id: prismaUser.id },
    data: {
      passwordHash: newPasswordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
      // Also reset failed login attempts
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // Revoke all existing sessions (security: force re-login everywhere)
  await revokeAllUserTokens(prismaUser.id);

  return {
    success: true,
    user: prismaUserToUser(updatedPrismaUser),
  };
}

/**
 * Find user by password reset token
 */
export async function findUserByResetToken(token: string): Promise<User | null> {
  const prisma = getPrismaClient();
  const prismaUser = await prisma.user.findUnique({
    where: { passwordResetToken: token },
  });
  return prismaUser ? prismaUserToUser(prismaUser) : null;
}

// ============================================
// Initialize Demo User (Non-Production Only)
// ============================================

/**
 * Initialize demo user if it doesn't exist (when demo account is allowed)
 * This is exported so it can be called from app.ts after database initialization
 */
export async function initializeDemoUser(): Promise<void> {
  // Only create demo user when demo account is allowed
  if (!config.allowDemoAccount) {
    return;
  }

  try {
    const prisma = getPrismaClient();
    const existingUser = await findUserByEmail(DEMO_ACCOUNT_EMAIL);
    if (!existingUser) {
      const { user } = await createUser(DEMO_ACCOUNT_EMAIL, 'Demo123!', 'PATIENT');
      // Auto-verify demo user so they can login without email verification
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpires: null,
          isActive: true,
        },
      });
      logger.info(`Demo user created (auto-verified) - email: ${DEMO_ACCOUNT_EMAIL}, password: Demo123!`, { prefix: 'DEMO' });
    } else {
      // Ensure existing demo user is always in a valid state
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          emailVerified: true,
          isActive: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedLogin: null,
        },
      });
      logger.info(`Demo user verified - email: ${DEMO_ACCOUNT_EMAIL}`, { prefix: 'DEMO' });
    }
  } catch {
    // Database might not be ready yet, that's okay
    logger.info('Could not create/verify demo user (database may not be initialized yet)', { prefix: 'DEMO' });
  }
}

// ============================================
// Token Cleanup (run periodically)
// ============================================

export async function cleanupExpiredSessions(): Promise<void> {
  try {
    const prisma = getPrismaClient();
    const result = await prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    if (result.count > 0) {
      logger.info(`Cleaned up ${result.count} expired sessions`, { prefix: 'Auth' });
    }
  } catch (error) {
    // Database might not be connected
    logger.error('Failed to cleanup expired sessions', { prefix: 'Auth', data: { error } });
  }
}

// Session cleanup interval reference (for cleanup on shutdown)
let sessionCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the session cleanup interval
 * Called after database is initialized
 */
export function startSessionCleanup(): void {
  if (sessionCleanupInterval) {
    return; // Already running
  }
  // Run session cleanup every hour
  sessionCleanupInterval = setInterval(() => {
    cleanupExpiredSessions().catch((error) => {
      logger.error('Session cleanup failed', { prefix: 'Auth', data: { error: String(error) } });
    });
  }, 60 * 60 * 1000);
  logger.info('Session cleanup scheduler started', { prefix: 'Auth' });
}

/**
 * Stop the session cleanup interval
 * Should be called on server shutdown for graceful cleanup
 */
export function stopSessionCleanup(): void {
  if (sessionCleanupInterval) {
    clearInterval(sessionCleanupInterval);
    sessionCleanupInterval = null;
    logger.info('Session cleanup scheduler stopped', { prefix: 'Auth' });
  }
}
