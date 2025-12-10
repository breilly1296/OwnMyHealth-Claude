/**
 * Authentication Test Helpers
 *
 * Utility functions for authentication-related tests.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { testUsers } from '../fixtures/users';

/**
 * Generate a valid access token for testing
 */
export function generateTestAccessToken(
  userId: string = testUsers.verified.id,
  email: string = testUsers.verified.email,
  role: string = 'PATIENT'
): string {
  return jwt.sign(
    { id: userId, email, role, type: 'access' },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );
}

/**
 * Generate a valid refresh token for testing
 */
export function generateTestRefreshToken(
  userId: string = testUsers.verified.id,
  email: string = testUsers.verified.email,
  role: string = 'PATIENT',
  jti: string = 'test-jti-123'
): string {
  return jwt.sign(
    { id: userId, email, role, type: 'refresh', jti },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: '7d' }
  );
}

/**
 * Generate an expired access token for testing
 */
export function generateExpiredAccessToken(
  userId: string = testUsers.verified.id,
  email: string = testUsers.verified.email,
  role: string = 'PATIENT'
): string {
  return jwt.sign(
    { id: userId, email, role, type: 'access' },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '-1s' }
  );
}

/**
 * Generate an expired refresh token for testing
 */
export function generateExpiredRefreshToken(
  userId: string = testUsers.verified.id,
  email: string = testUsers.verified.email,
  role: string = 'PATIENT',
  jti: string = 'test-jti-123'
): string {
  return jwt.sign(
    { id: userId, email, role, type: 'refresh', jti },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: '-1s' }
  );
}

/**
 * Hash a password for testing (using low rounds for speed)
 */
export async function hashTestPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 4);
}

/**
 * Create a mock session object
 */
export function createMockSession(
  userId: string,
  tokenId: string = 'test-session-id',
  expiresInMs: number = 7 * 24 * 60 * 60 * 1000
) {
  return {
    id: tokenId,
    userId,
    token: 'mock-token',
    expiresAt: new Date(Date.now() + expiresInMs),
    createdAt: new Date(),
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
  };
}

/**
 * Create a mock user with custom overrides
 */
export function createMockUser(overrides: Partial<typeof testUsers.verified> = {}) {
  return {
    ...testUsers.verified,
    ...overrides,
    id: overrides.id || `test-user-${Date.now()}`,
  };
}

/**
 * Cookie parser for test responses
 */
export function parseCookies(cookieHeaders: string[] | undefined): Record<string, string> {
  if (!cookieHeaders) return {};

  const cookies: Record<string, string> = {};
  for (const header of cookieHeaders) {
    const match = header.match(/^([^=]+)=([^;]*)/);
    if (match) {
      cookies[match[1]] = match[2];
    }
  }
  return cookies;
}

/**
 * Check if a cookie is cleared (empty value or expired)
 */
export function isCookieCleared(cookieHeader: string): boolean {
  // Cookie is cleared if it has an empty value or Expires in the past
  if (cookieHeader.includes('=;') || cookieHeader.includes('= ;')) {
    return true;
  }

  const expiresMatch = cookieHeader.match(/Expires=([^;]+)/i);
  if (expiresMatch) {
    const expiresDate = new Date(expiresMatch[1]);
    return expiresDate < new Date();
  }

  const maxAgeMatch = cookieHeader.match(/Max-Age=(-?\d+)/i);
  if (maxAgeMatch) {
    return parseInt(maxAgeMatch[1], 10) <= 0;
  }

  return false;
}
