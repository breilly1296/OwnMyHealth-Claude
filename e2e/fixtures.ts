/**
 * E2E Test Fixtures
 *
 * Shared test utilities, constants, and fixtures for Playwright E2E tests.
 */

import { test as base, expect } from '@playwright/test';

// Test user credentials
export const TEST_USER = {
  email: `e2e-test-${Date.now()}@example.com`,
  password: 'TestPass123!@#',
  firstName: 'E2E',
  lastName: 'Tester',
};

// Demo user credentials (if demo mode is enabled)
export const DEMO_USER = {
  email: 'demo@ownmyhealth.com',
  password: 'Demo123!',
};

// API endpoints
export const API_BASE = process.env.E2E_API_URL || 'http://localhost:3001/api/v1';

// Selectors for common elements
export const SELECTORS = {
  // Auth
  emailInput: 'input#email',
  passwordInput: 'input#password',
  confirmPasswordInput: 'input#confirmPassword',
  firstNameInput: 'input#firstName',
  lastNameInput: 'input#lastName',
  loginButton: 'button[type="submit"]:has-text("Sign in")',
  registerButton: 'button[type="submit"]:has-text("Create account")',
  demoLoginButton: 'button:has-text("Try Demo Account")',
  forgotPasswordLink: 'button:has-text("Forgot password?")',
  registerLink: 'button:has-text("Create one")',
  loginLink: 'button:has-text("Sign in")',
  logoutButton: 'button:has-text("Logout")',

  // Dashboard
  dashboardHeading: 'text=Dashboard',
  healthScore: '[data-testid="health-score"]',
  categoryNav: '[data-testid="category-nav"]',
  biomarkerList: '[data-testid="biomarker-list"]',
  addMeasurementButton: 'button:has-text("Add Measurement")',

  // User menu
  userMenuButton: '[data-testid="user-menu"]',

  // Error messages
  errorAlert: '[role="alert"], .text-red-700',

  // Loading states
  loadingSpinner: '.animate-spin',
};

// Extended test fixture with authentication helpers
export const test = base.extend<{
  registerUser: () => Promise<void>;
  loginUser: (email?: string, password?: string) => Promise<void>;
  loginAsDemo: () => Promise<void>;
  logout: () => Promise<void>;
}>({
  registerUser: async ({ page }, use) => {
    const register = async () => {
      await page.goto('/');
      // Click "Create one" to go to registration
      await page.click(SELECTORS.registerLink);

      // Fill registration form
      await page.fill(SELECTORS.firstNameInput, TEST_USER.firstName);
      await page.fill(SELECTORS.lastNameInput, TEST_USER.lastName);
      await page.fill(SELECTORS.emailInput, TEST_USER.email);
      await page.fill(SELECTORS.passwordInput, TEST_USER.password);
      await page.fill(SELECTORS.confirmPasswordInput, TEST_USER.password);

      // Submit
      await page.click(SELECTORS.registerButton);

      // Wait for registration to complete
      await page.waitForURL('/', { timeout: 10000 });
    };
    await use(register);
  },

  loginUser: async ({ page }, use) => {
    const login = async (email = TEST_USER.email, password = TEST_USER.password) => {
      await page.goto('/');

      // Fill login form
      await page.fill(SELECTORS.emailInput, email);
      await page.fill(SELECTORS.passwordInput, password);

      // Submit
      await page.click(SELECTORS.loginButton);

      // Wait for dashboard to load
      await page.waitForSelector(SELECTORS.dashboardHeading, { timeout: 10000 });
    };
    await use(login);
  },

  loginAsDemo: async ({ page }, use) => {
    const loginDemo = async () => {
      await page.goto('/');

      // Click demo login button
      await page.click(SELECTORS.demoLoginButton);

      // Wait for dashboard to load
      await page.waitForSelector(SELECTORS.dashboardHeading, { timeout: 10000 });
    };
    await use(loginDemo);
  },

  logout: async ({ page }, use) => {
    const doLogout = async () => {
      // Open user menu and click logout
      await page.click(SELECTORS.userMenuButton);
      await page.click(SELECTORS.logoutButton);

      // Wait for login page
      await page.waitForSelector(SELECTORS.loginButton, { timeout: 5000 });
    };
    await use(doLogout);
  },
});

export { expect };
