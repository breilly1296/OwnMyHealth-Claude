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
import { JWT_SIGN_OPTIONS, JWT_VERIFY_OPTIONS } from '../config/jwtOptions.js';
import { withRLSContext, withRLSTransaction } from './database.js';
import { logger } from '../utils/logger.js';
import type { User as PrismaUser, UserRole } from '../../generated/prisma/index.js';

// Email verification token expiration (24 hours)
const EMAIL_VERIFICATION_EXPIRATION_HOURS = 24;

/**
 * SHA-256 hash used for email-verification and password-reset tokens.
 *
 * Tokens are 256-bit random values and don't need key-stretching — we use
 * SHA-256 to keep the DB column size compact and the lookup fast. The
 * unhashed token goes into the email link; the hash goes into the DB.
 * A DB breach then exposes only the hashes, which are unusable without
 * the (unretained) preimage.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

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
  // Subscription plan (FREE | PRO | TEAM). Coerced via normalizePlan at the
  // request boundary, so the string type here is intentional.
  plan: string;
}

export interface TokenPayload {
  id: string;
  email: string;
  role: string;
  plan: string;
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
    plan: prismaUser.plan,
  };
}

// ============================================
// In-Memory Token Blacklist (for access token revocation)
//
// Keyed by the raw access-token string → its `exp` (epoch ms). In-memory
// only: it does NOT survive a restart or span instances, so under horizontal
// scale a revoked token can still be honored by another replica until its
// 15-min expiry. Move to a shared store (Redis/Memorystore) when the
// deployment fans out beyond one Cloud Run instance — see SECURITY_STATUS.
//
// Entries are swept once past their own expiry (piggybacking the
// session-cleanup interval) so the map can't grow without bound — after
// expiry jwt.verify() rejects the token anyway, so retaining it is pointless.
// ============================================

const revokedTokens: Map<string, number> = new Map();

/**
 * Add an access token to the in-memory revocation set. Called from the
 * logout / logout-all / password-change controllers so the route-auth
 * middleware (`isTokenRevoked`) rejects it immediately rather than waiting
 * for natural JWT expiry. Records the token's own `exp` so the sweep can
 * evict it once it can no longer be valid.
 */
export function revokeAccessToken(token: string): void {
  if (!token) return;
  // Conservative fallback: assume a full access-token lifetime if we can't
  // read the token's exp (e.g. malformed). decode() does not verify, which
  // is fine — the token already passed auth to reach a revoke call site.
  let expMs = Date.now() + 15 * 60 * 1000;
  try {
    const decoded = jwt.decode(token) as { exp?: number } | null;
    if (decoded?.exp) expMs = decoded.exp * 1000;
  } catch {
    // keep the conservative fallback
  }
  revokedTokens.set(token, expMs);
}

/**
 * True if the given access token has been explicitly revoked (and not yet
 * swept). Consulted by the auth middleware on every protected request so a
 * logged-out / rotated token stops authenticating immediately on this node.
 */
export function isTokenRevoked(token: string): boolean {
  return revokedTokens.has(token);
}

/**
 * Evict revoked-token entries whose expiry has passed. Invoked from the
 * session-cleanup interval so the blacklist stays bounded on long-lived
 * instances.
 */
export function sweepRevokedTokens(): void {
  const now = Date.now();
  for (const [token, expMs] of revokedTokens) {
    if (expMs <= now) revokedTokens.delete(token);
  }
}

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

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
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
    plan: user.plan || 'FREE',
    type: 'access',
  };

  return jwt.sign(payload, config.jwt.accessSecret, {
    ...JWT_SIGN_OPTIONS,
    expiresIn: config.jwt.accessExpiresIn,
  });
}

// Demo account configuration
export const DEMO_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days for demo accounts

/**
 * Check if a user is the demo account
 *
 * SECURITY: If DEMO_EMAIL is unset (config.demo.email === ''), this always
 * returns false. Without the guard an empty configured email would match any
 * user whose email was somehow empty, or the comparison would trivially match
 * during edge cases.
 */
export function isDemoUser(user: User): boolean {
  if (!config.demo.email || config.demo.email.trim() === '') return false;
  return user.email.toLowerCase() === config.demo.email.toLowerCase();
}

/**
 * Check if an email is the demo account (for use before user lookup).
 * Returns false when DEMO_EMAIL is not configured (see isDemoUser).
 */
export function isDemoEmail(email: string): boolean {
  if (!config.demo.email || config.demo.email.trim() === '') return false;
  return email.toLowerCase().trim() === config.demo.email.toLowerCase();
}

/**
 * Generate refresh token (longer-lived, 7 days for regular users, 30 days for demo)
 * Stores the token in the database for validation and revocation
 * @param user - The user to generate a token for
 * @param metadata - Optional session metadata (IP address, user agent)
 */
export async function generateRefreshToken(user: User, metadata?: SessionMetadata): Promise<string> {
  const tokenId = uuidv4();

  // Demo users get a longer session (30 days) when demo mode is enabled
  const isDemo = isDemoUser(user) && config.demo.enabled;
  const sessionDuration = isDemo ? DEMO_SESSION_DURATION_MS : config.cookie.maxAge.refreshToken;
  const tokenExpiry = isDemo ? '30d' : config.jwt.refreshExpiresIn;

  const expiresAt = new Date(Date.now() + sessionDuration);

  const payload: TokenPayload & { jti: string } = {
    id: user.id,
    email: user.email,
    role: user.role,
    plan: user.plan || 'FREE',
    type: 'refresh',
    jti: tokenId, // JWT ID for revocation
  };

  const token = jwt.sign(payload, config.jwt.refreshSecret, {
    ...JWT_SIGN_OPTIONS,
    expiresIn: tokenExpiry,
  });

  // Store session — user-context, since we have the user id in scope.
  await withRLSContext(user.id, async (tx) => {
    await tx.session.create({
      data: {
        id: tokenId,
        userId: user.id,
        token: token.substring(0, 500), // Store truncated token for reference
        ipAddress: metadata?.ipAddress,
        userAgent: metadata?.userAgent,
        expiresAt,
      },
    });
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

    const payload = jwt.verify(token, config.jwt.accessSecret, JWT_VERIFY_OPTIONS) as TokenPayload;

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
    const payload = jwt.verify(token, config.jwt.refreshSecret, JWT_VERIFY_OPTIONS) as TokenPayload & { jti: string };

    if (payload.type !== 'refresh') {
      return null;
    }

    // Session lookup is JTI-keyed, not user-keyed — admin context. The caller
    // isn't authenticated yet (refresh flow runs before a user context exists).
    return await withRLSContext(
      null,
      async (tx) => {
        const session = await tx.session.findUnique({
          where: { id: payload.jti },
        });

        if (!session || session.expiresAt < new Date()) {
          if (session) {
            await tx.session.delete({ where: { id: payload.jti } });
          }
          return null;
        }

        return payload;
      },
      { isAdmin: true }
    );
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
      // JTI-keyed delete — admin context.
      await withRLSContext(
        null,
        async (tx) => {
          await tx.session.delete({
            where: { id: payload.jti },
          }).catch(() => {
            // Session may not exist, that's okay
          });
        },
        { isAdmin: true }
      );
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
  // userId is in scope — use user context. The sessions_delete_own policy
  // permits user_id = current_user_id(), so admin bypass isn't needed.
  await withRLSContext(userId, async (tx) => {
    await tx.session.deleteMany({
      where: { userId },
    });
  });
}

/**
 * Refresh tokens — issue a new access/refresh pair using the incoming
 * refresh token. Atomic: the old session row is locked with
 * `SELECT ... FOR UPDATE`, deleted, and replaced inside a single
 * transaction so two concurrent refresh requests with the same token
 * can't both succeed. The second one finds the row already gone and
 * returns null, forcing the client to re-authenticate.
 *
 * Returns tokens and isDemo flag to preserve demo session duration.
 */
export async function refreshTokens(refreshToken: string, metadata?: SessionMetadata): Promise<RefreshResult | null> {
  // JWT signature + type check happens outside the transaction. If the
  // token is malformed there's no reason to open a DB connection at all.
  let payload: (TokenPayload & { jti: string }) | null;
  try {
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret, JWT_VERIFY_OPTIONS) as TokenPayload & { jti: string };
    if (decoded.type !== 'refresh') return null;
    payload = decoded;
  } catch {
    return null;
  }

  // Admin context — refresh flow runs before the request has a user context.
  // The session-row lock + user lookup + new-session insert all live in one
  // transaction so concurrent refresh attempts serialize on the row lock.
  const result = await withRLSTransaction(
    null,
    async (tx) => {
      // Lock the session row for the duration of this transaction. A parallel
      // refresh attempt for the same JTI will block on this until we commit
      // or roll back; by the time it unblocks the row is gone and the lookup
      // below returns nothing.
      //
      // Parameterized — payload.jti is a UUID generated on our side, but
      // $queryRaw still prevents any SQL-level surprise.
      const locked = await tx.$queryRaw<Array<{ id: string; userId: string; expiresAt: Date }>>`
        SELECT id, user_id AS "userId", expires_at AS "expiresAt"
        FROM sessions
        WHERE id = ${payload!.jti}::uuid
        FOR UPDATE
      `;

      const session = locked[0];
      if (!session || session.expiresAt < new Date()) {
        // Either the row was already consumed by a racing refresh, or it
        // expired between JWT verification and the lock. Either way: no
        // new tokens issued.
        if (session) {
          await tx.session.delete({ where: { id: payload!.jti } });
        }
        return null;
      }

      const prismaUser = await tx.user.findUnique({ where: { id: session.userId } });
      if (!prismaUser || !prismaUser.isActive) {
        return null;
      }

      // Delete the old session row — the caller's refresh token is now
      // single-use. The generateTokens call below will insert a fresh
      // session row for the new refresh token, all inside this tx.
      await tx.session.delete({ where: { id: payload!.jti } });

      return { user: prismaUserToUser(prismaUser) };
    }
  );

  if (!result) return null;

  // Token rotation: new refresh token gets a new JTI and a new session row.
  // Runs outside the locking transaction because generateRefreshToken opens
  // its own withRLSContext to insert the session — nesting transactions
  // would deadlock.
  const tokens = await generateTokens(result.user, metadata);

  return {
    tokens,
    isDemo: isDemoUser(result.user),
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
  const newAttempts = user.failedLoginAttempts + 1;
  const remainingAttempts = Math.max(0, config.security.maxLoginAttempts - newAttempts);

  // Check if we should lock the account
  const shouldLock = newAttempts >= config.security.maxLoginAttempts;
  const lockedUntil = shouldLock ? new Date(Date.now() + config.security.lockoutDuration) : null;

  // user.id is in scope (findUserByEmail resolved before this call) — user context.
  await withRLSContext(user.id, async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: newAttempts,
        lastFailedLogin: new Date(),
        lockedUntil: lockedUntil,
      },
    });
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
  await withRLSContext(user.id, async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastFailedLogin: null,
        lastLoginAt: new Date(),
      },
    });
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
  const passwordHash = await hashPassword(password);

  // Generate verification token. The caller gets the unhashed value for the
  // email link; the DB only ever sees the hash. A DB breach leaks hashes,
  // not usable verification links.
  const verificationToken = generateEmailVerificationToken();
  const verificationTokenHash = hashToken(verificationToken);
  const verificationExpires = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRATION_HOURS * 60 * 60 * 1000);

  // Registration — pre-auth, admin context (the users_insert_system policy
  // permits `is_admin_session() OR current_user_id() IS NULL`).
  const prismaUser = await withRLSContext(
    null,
    async (tx) => {
      return tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          passwordHash,
          role: role as UserRole,
          failedLoginAttempts: 0,
          emailVerified: false,
          emailVerificationToken: verificationTokenHash,
          emailVerificationExpires: verificationExpires,
        },
      });
    },
    { isAdmin: true }
  );

  return {
    user: prismaUserToUser(prismaUser),
    verificationToken,
  };
}

/**
 * Find user by email
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const normalizedEmail = email.toLowerCase().trim();

  // Pre-auth lookup (login, registration collision check, forgot-password, demo init).
  const prismaUser = await withRLSContext(
    null,
    async (tx) => {
      return tx.user.findUnique({
        where: { email: normalizedEmail },
      });
    },
    { isAdmin: true }
  );

  return prismaUser ? prismaUserToUser(prismaUser) : null;
}

/**
 * Find user by ID
 */
export async function findUserById(id: string): Promise<User | null> {
  // Called by JWT verify middleware before the request's user context is
  // established — admin context. (Once established, callers that want to
  // re-read their own user can use a user-context helper; none do today.)
  const prismaUser = await withRLSContext(
    null,
    async (tx) => {
      return tx.user.findUnique({
        where: { id },
      });
    },
    { isAdmin: true }
  );

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
  // userId in signature — user context.
  await withRLSContext(userId, async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
      },
    });
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

  // DEMO ACCOUNT: Zero restrictions — only works when demo mode is enabled
  // AND we're in a true development environment. Staging/preview deploys
  // that set DEMO_ACCOUNT_ENABLED=true would otherwise let an attacker
  // brute-force the demo password indefinitely (no lockout, no failed-
  // attempt tracking). Gating on `isDevelopment` — not just `demo.enabled` —
  // means the demo bypass can't be enabled outside a developer workstation.
  const isDemoAccount = isDemoEmail(email);
  if (isDemoAccount && config.demo.enabled && config.isDevelopment) {
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
      // Reset any lockout/failed attempts for demo account.
      // user.id in scope (just found via findUserByEmail) — user context.
      await withRLSContext(user.id, async (tx) => {
        await tx.user.update({
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

  // Block demo account login attempts when demo mode is disabled (production)
  if (isDemoAccount && !config.demo.enabled) {
    return {
      success: false,
      error: 'Demo mode is disabled in production',
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
 * Verify user's email using verification token. Hashes the incoming token
 * before querying — the DB only ever stores hashes (see `hashToken`).
 */
export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
  const tokenHash = hashToken(token);
  // Pre-auth: verification token is the only identifier. Admin context.
  return withRLSContext(
    null,
    async (tx): Promise<VerifyEmailResult> => {
      const prismaUser = await tx.user.findUnique({
        where: { emailVerificationToken: tokenHash },
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
      const updatedPrismaUser = await tx.user.update({
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
    },
    { isAdmin: true }
  );
}

/**
 * Resend email verification token
 * Generates a new token and extends expiration
 */
export async function resendVerificationEmail(email: string): Promise<{ success: boolean; token?: string; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Generate new token (CPU-only; doesn't need to be inside the tx).
  // Caller gets the unhashed token for the email link; DB stores the hash.
  const verificationToken = generateEmailVerificationToken();
  const verificationTokenHash = hashToken(verificationToken);
  const verificationExpires = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRATION_HOURS * 60 * 60 * 1000);

  // Pre-auth lookup + update under admin context.
  return withRLSContext(
    null,
    async (tx): Promise<{ success: boolean; token?: string; error?: string }> => {
      const prismaUser = await tx.user.findUnique({
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

      await tx.user.update({
        where: { id: prismaUser.id },
        data: {
          emailVerificationToken: verificationTokenHash,
          emailVerificationExpires: verificationExpires,
        },
      });

      return {
        success: true,
        token: verificationToken,
      };
    },
    { isAdmin: true }
  );
}

/**
 * Find user by verification token. Hashes the incoming token to match the
 * stored hash (tokens are never stored in plaintext).
 */
export async function findUserByVerificationToken(token: string): Promise<User | null> {
  const tokenHash = hashToken(token);
  // Token-keyed, pre-auth. Admin context.
  const prismaUser = await withRLSContext(
    null,
    async (tx) => {
      return tx.user.findUnique({
        where: { emailVerificationToken: tokenHash },
      });
    },
    { isAdmin: true }
  );
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
  const normalizedEmail = email.toLowerCase().trim();
  // Caller (password-reset email) gets the unhashed token; DB stores the
  // SHA-256 hash so a DB breach doesn't leak working reset links.
  const resetToken = generatePasswordResetToken();
  const resetTokenHash = hashToken(resetToken);
  const resetExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRATION_HOURS * 60 * 60 * 1000);

  // Pre-auth (email-keyed lookup + token-stamp update). Admin context.
  return withRLSContext(
    null,
    async (tx): Promise<ForgotPasswordResult> => {
      const prismaUser = await tx.user.findUnique({
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

      await tx.user.update({
        where: { id: prismaUser.id },
        data: {
          passwordResetToken: resetTokenHash,
          passwordResetExpires: resetExpires,
        },
      });

      return {
        success: true,
        token: resetToken,
      };
    },
    { isAdmin: true }
  );
}

/**
 * Reset password using reset token
 */
export async function resetPassword(token: string, newPassword: string): Promise<ResetPasswordResult> {
  // Pre-auth (reset-token-keyed). Admin context for the initial lookup +
  // expiry-clear path. The success path hashes + updates + revokes sessions;
  // for atomicity the hash and the update run inside the same transaction,
  // but password validation happens before the wrapper to fail fast.
  //
  // Tokens are stored as SHA-256 hashes — hash the incoming token before
  // querying. The link in the user's inbox carries the plaintext token;
  // the DB only ever sees the hash.
  const tokenHash = hashToken(token);

  // Step 1: look up by token under admin context to decide what to do.
  const lookupResult = await withRLSContext(
    null,
    async (tx): Promise<{ userId: string } | ResetPasswordResult> => {
      const prismaUser = await tx.user.findUnique({
        where: { passwordResetToken: tokenHash },
      });

      if (!prismaUser) {
        return { success: false, error: 'Invalid or expired reset token' };
      }

      if (prismaUser.passwordResetExpires && prismaUser.passwordResetExpires < new Date()) {
        // Clear expired token
        await tx.user.update({
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

      return { userId: prismaUser.id };
    },
    { isAdmin: true }
  );

  // If the lookup returned a result (either error shape), short-circuit.
  if ('success' in lookupResult) {
    return lookupResult;
  }

  // Validate new password strength (CPU-only)
  const passwordValidation = validatePasswordStrength(newPassword);
  if (!passwordValidation.valid) {
    return {
      success: false,
      error: passwordValidation.errors.join('. '),
    };
  }

  // Hash new password (CPU-only, kept outside tx to minimize transaction time)
  const newPasswordHash = await hashPassword(newPassword);

  // Step 2: update password + clear token. userId is now known → user context.
  const updatedPrismaUser = await withRLSContext(
    lookupResult.userId,
    async (tx) => {
      return tx.user.update({
        where: { id: lookupResult.userId },
        data: {
          passwordHash: newPasswordHash,
          passwordResetToken: null,
          passwordResetExpires: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
    }
  );

  // Revoke all existing sessions (security: force re-login everywhere)
  await revokeAllUserTokens(updatedPrismaUser.id);

  return {
    success: true,
    user: prismaUserToUser(updatedPrismaUser),
  };
}

/**
 * Find user by password reset token. Hashes the incoming token to match
 * the stored hash (tokens are never stored in plaintext).
 */
export async function findUserByResetToken(token: string): Promise<User | null> {
  const tokenHash = hashToken(token);
  // Token-keyed, pre-auth. Admin context.
  const prismaUser = await withRLSContext(
    null,
    async (tx) => {
      return tx.user.findUnique({
        where: { passwordResetToken: tokenHash },
      });
    },
    { isAdmin: true }
  );
  return prismaUser ? prismaUserToUser(prismaUser) : null;
}

// ============================================
// Initialize Demo User (Non-Production Only)
// ============================================

/**
 * Initialize demo user if it doesn't exist (when demo mode is enabled)
 * This is exported so it can be called from app.ts after database initialization
 */
export async function initializeDemoUser(): Promise<void> {
  // Only create demo user when demo mode is enabled (development only)
  if (!config.demo.enabled) {
    return;
  }

  try {
    // Boot-time demo-user setup. Admin context because we're touching the
    // users table before any auth happens. findUserByEmail and createUser
    // each have their own admin-context wrappers; nested withRLSContext
    // calls nest transparently at the DB layer.
    await withRLSContext(
      null,
      async (tx) => {
        const existingUser = await findUserByEmail(config.demo.email);
        if (!existingUser) {
          const { user } = await createUser(config.demo.email, config.demo.password, 'PATIENT');
          // Auto-verify demo user so they can login without email verification
          await tx.user.update({
            where: { id: user.id },
            data: {
              emailVerified: true,
              emailVerificationToken: null,
              emailVerificationExpires: null,
              isActive: true,
            },
          });
          // Note: Password intentionally not logged for security
          logger.info(`Demo user created (auto-verified) - email: ${config.demo.email}`, { prefix: 'DEMO' });
        } else {
          // Ensure existing demo user is always in a valid state
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              emailVerified: true,
              isActive: true,
              failedLoginAttempts: 0,
              lockedUntil: null,
              lastFailedLogin: null,
            },
          });
          logger.info(`Demo user verified - email: ${config.demo.email}`, { prefix: 'DEMO' });
        }
      },
      { isAdmin: true }
    );
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
    // Cross-user system cleanup — admin context.
    const result = await withRLSContext(
      null,
      async (tx) => {
        return tx.session.deleteMany({
          where: {
            expiresAt: { lt: new Date() },
          },
        });
      },
      { isAdmin: true }
    );
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
  // Run session cleanup every 10 minutes. Tighter window than the prior 1-hour
  // tick so expired rows leave the table fast — narrows the read-window for
  // anyone with DB access who could otherwise observe recently-revoked tokens
  // for up to 59 minutes after expiry. `cleanupExpiredSessions` is a single
  // `deleteMany` under admin RLS context; cheap to run on this cadence.
  sessionCleanupInterval = setInterval(() => {
    // Evict expired entries from the in-memory access-token blacklist so it
    // stays bounded; then prune expired DB sessions.
    sweepRevokedTokens();
    cleanupExpiredSessions().catch((error) => {
      logger.error('Session cleanup failed', { prefix: 'Auth', data: { error: String(error) } });
    });
  }, 10 * 60 * 1000);
  logger.info('Session cleanup scheduler started (10-min interval)', { prefix: 'Auth' });
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
