/**
 * Vitest Test Setup
 *
 * This file runs before all tests to set up the testing environment.
 */

import { vi, beforeAll, afterAll, afterEach } from 'vitest';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-min-32-characters-long';
process.env.PHI_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.BCRYPT_ROUNDS = '4'; // Lower rounds for faster tests
process.env.DEMO_PASSWORD = 'Demo123!';
process.env.ALLOW_DEMO_ACCOUNT = 'true';

// Mock the logger to prevent console noise during tests
vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    auth: vi.fn(),
    security: vi.fn(),
    http: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    auth: vi.fn(),
    security: vi.fn(),
    http: vi.fn(),
  },
}));

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Global test timeout
beforeAll(() => {
  vi.setConfig({ testTimeout: 30000 });
});

afterAll(() => {
  vi.restoreAllMocks();
});
