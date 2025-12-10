/**
 * User Test Fixtures
 *
 * Provides test data for user-related tests.
 */

import bcrypt from 'bcryptjs';

// Pre-hashed passwords for faster tests (using 4 rounds)
// Password: "Password123!"
export const VALID_PASSWORD = 'Password123!';
export const VALID_PASSWORD_HASH = bcrypt.hashSync('Password123!', 4);

// Weak password for testing validation
export const WEAK_PASSWORD = 'weak';

// Demo account credentials
export const DEMO_EMAIL = 'demo@ownmyhealth.com';
export const DEMO_PASSWORD = 'Demo123!';

// Test users
export const testUsers = {
  verified: {
    id: 'user-verified-123',
    email: 'verified@example.com',
    passwordHash: VALID_PASSWORD_HASH,
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
  },

  unverified: {
    id: 'user-unverified-123',
    email: 'unverified@example.com',
    passwordHash: VALID_PASSWORD_HASH,
    role: 'PATIENT' as const,
    isActive: true,
    emailVerified: false,
    emailVerificationToken: 'verification-token-123',
    emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    passwordResetToken: null,
    passwordResetExpires: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastFailedLogin: null,
  },

  locked: {
    id: 'user-locked-123',
    email: 'locked@example.com',
    passwordHash: VALID_PASSWORD_HASH,
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
    failedLoginAttempts: 5,
    lockedUntil: new Date(Date.now() + 30 * 60 * 1000), // Locked for 30 minutes
    lastFailedLogin: new Date(),
  },

  inactive: {
    id: 'user-inactive-123',
    email: 'inactive@example.com',
    passwordHash: VALID_PASSWORD_HASH,
    role: 'PATIENT' as const,
    isActive: false,
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
  },

  withResetToken: {
    id: 'user-reset-123',
    email: 'reset@example.com',
    passwordHash: VALID_PASSWORD_HASH,
    role: 'PATIENT' as const,
    isActive: true,
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpires: null,
    passwordResetToken: 'valid-reset-token-123',
    passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastFailedLogin: null,
  },

  withExpiredResetToken: {
    id: 'user-expired-reset-123',
    email: 'expired-reset@example.com',
    passwordHash: VALID_PASSWORD_HASH,
    role: 'PATIENT' as const,
    isActive: true,
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpires: null,
    passwordResetToken: 'expired-reset-token-123',
    passwordResetExpires: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago (expired)
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastFailedLogin: null,
  },

  demo: {
    id: 'user-demo-123',
    email: DEMO_EMAIL,
    passwordHash: bcrypt.hashSync(DEMO_PASSWORD, 4),
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
  },

  admin: {
    id: 'user-admin-123',
    email: 'admin@example.com',
    passwordHash: VALID_PASSWORD_HASH,
    role: 'ADMIN' as const,
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
  },
};

// Registration payloads
export const registrationPayloads = {
  valid: {
    email: 'newuser@example.com',
    password: VALID_PASSWORD,
  },
  invalidEmail: {
    email: 'not-an-email',
    password: VALID_PASSWORD,
  },
  weakPassword: {
    email: 'weakpass@example.com',
    password: 'weak',
  },
  missingEmail: {
    password: VALID_PASSWORD,
  },
  missingPassword: {
    email: 'nopass@example.com',
  },
  duplicateEmail: {
    email: 'verified@example.com',
    password: VALID_PASSWORD,
  },
};

// Login payloads
export const loginPayloads = {
  valid: {
    email: 'verified@example.com',
    password: VALID_PASSWORD,
  },
  wrongPassword: {
    email: 'verified@example.com',
    password: 'WrongPassword123!',
  },
  nonExistentUser: {
    email: 'doesnotexist@example.com',
    password: VALID_PASSWORD,
  },
  unverifiedEmail: {
    email: 'unverified@example.com',
    password: VALID_PASSWORD,
  },
  lockedAccount: {
    email: 'locked@example.com',
    password: VALID_PASSWORD,
  },
  inactiveAccount: {
    email: 'inactive@example.com',
    password: VALID_PASSWORD,
  },
  demo: {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  },
};
