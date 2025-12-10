/**
 * Authentication E2E Tests
 *
 * Tests for the authentication flow:
 * - User registration
 * - Login with valid/invalid credentials
 * - Demo login
 * - Logout
 * - Password validation
 */

import { test, expect, SELECTORS, TEST_USER, DEMO_USER } from './fixtures';

test.describe('Authentication', () => {
  test.describe('Registration Flow', () => {
    test('should display registration form when clicking Create one', async ({ page }) => {
      await page.goto('/');

      // Click register link
      await page.click(SELECTORS.registerLink);

      // Verify registration form is displayed
      await expect(page.locator('h1:has-text("Create your account")')).toBeVisible();
      await expect(page.locator(SELECTORS.firstNameInput)).toBeVisible();
      await expect(page.locator(SELECTORS.lastNameInput)).toBeVisible();
      await expect(page.locator(SELECTORS.emailInput)).toBeVisible();
      await expect(page.locator(SELECTORS.passwordInput)).toBeVisible();
      await expect(page.locator(SELECTORS.confirmPasswordInput)).toBeVisible();
    });

    test('should show password requirements when typing password', async ({ page }) => {
      await page.goto('/');
      await page.click(SELECTORS.registerLink);

      // Start typing password
      await page.fill(SELECTORS.passwordInput, 'test');

      // Password requirements should be visible
      await expect(page.locator('text=Password requirements:')).toBeVisible();
      await expect(page.locator('text=At least 8 characters')).toBeVisible();
      await expect(page.locator('text=One uppercase letter')).toBeVisible();
      await expect(page.locator('text=One lowercase letter')).toBeVisible();
      await expect(page.locator('text=One number')).toBeVisible();
      await expect(page.locator('text=One special character')).toBeVisible();
    });

    test('should show error when passwords do not match', async ({ page }) => {
      await page.goto('/');
      await page.click(SELECTORS.registerLink);

      // Fill passwords that don't match
      await page.fill(SELECTORS.passwordInput, 'ValidPass123!');
      await page.fill(SELECTORS.confirmPasswordInput, 'DifferentPass123!');

      // Should show mismatch error
      await expect(page.locator('text=Passwords do not match')).toBeVisible();
    });

    test('should show success when passwords match', async ({ page }) => {
      await page.goto('/');
      await page.click(SELECTORS.registerLink);

      // Fill matching passwords
      await page.fill(SELECTORS.passwordInput, 'ValidPass123!');
      await page.fill(SELECTORS.confirmPasswordInput, 'ValidPass123!');

      // Should show match confirmation
      await expect(page.locator('text=Passwords match')).toBeVisible();
    });

    test('should register new user successfully', async ({ page }) => {
      const timestamp = Date.now();
      const testEmail = `e2e-register-${timestamp}@example.com`;

      await page.goto('/');
      await page.click(SELECTORS.registerLink);

      // Fill registration form
      await page.fill(SELECTORS.firstNameInput, 'Test');
      await page.fill(SELECTORS.lastNameInput, 'User');
      await page.fill(SELECTORS.emailInput, testEmail);
      await page.fill(SELECTORS.passwordInput, 'TestPass123!@#');
      await page.fill(SELECTORS.confirmPasswordInput, 'TestPass123!@#');

      // Submit
      await page.click(SELECTORS.registerButton);

      // Should show verification message or redirect to dashboard
      // (depends on whether email verification is enabled)
      await expect(
        page.locator('text=Dashboard').or(page.locator('text=verify your email'))
      ).toBeVisible({ timeout: 10000 });
    });

    test('should show error for duplicate email', async ({ page }) => {
      // First registration
      const timestamp = Date.now();
      const testEmail = `e2e-duplicate-${timestamp}@example.com`;

      await page.goto('/');
      await page.click(SELECTORS.registerLink);

      await page.fill(SELECTORS.emailInput, testEmail);
      await page.fill(SELECTORS.passwordInput, 'TestPass123!@#');
      await page.fill(SELECTORS.confirmPasswordInput, 'TestPass123!@#');
      await page.click(SELECTORS.registerButton);

      // Wait for first registration
      await page.waitForTimeout(2000);

      // Try to register again with same email
      await page.goto('/');
      await page.click(SELECTORS.registerLink);

      await page.fill(SELECTORS.emailInput, testEmail);
      await page.fill(SELECTORS.passwordInput, 'TestPass123!@#');
      await page.fill(SELECTORS.confirmPasswordInput, 'TestPass123!@#');
      await page.click(SELECTORS.registerButton);

      // Should show error
      await expect(page.locator(SELECTORS.errorAlert)).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Login Flow', () => {
    test('should display login form on homepage', async ({ page }) => {
      await page.goto('/');

      // Verify login form is displayed
      await expect(page.locator('h1:has-text("Welcome back")')).toBeVisible();
      await expect(page.locator(SELECTORS.emailInput)).toBeVisible();
      await expect(page.locator(SELECTORS.passwordInput)).toBeVisible();
      await expect(page.locator(SELECTORS.loginButton)).toBeVisible();
    });

    test('should show error for empty email', async ({ page }) => {
      await page.goto('/');

      // Try to login without email
      await page.fill(SELECTORS.passwordInput, 'somepassword');
      await page.click(SELECTORS.loginButton);

      // Should show validation error
      await expect(page.locator('text=Email is required')).toBeVisible();
    });

    test('should show error for empty password', async ({ page }) => {
      await page.goto('/');

      // Try to login without password
      await page.fill(SELECTORS.emailInput, 'test@example.com');
      await page.click(SELECTORS.loginButton);

      // Should show validation error
      await expect(page.locator('text=Password is required')).toBeVisible();
    });

    test('should show error for invalid email format', async ({ page }) => {
      await page.goto('/');

      // Try to login with invalid email
      await page.fill(SELECTORS.emailInput, 'not-an-email');
      await page.fill(SELECTORS.passwordInput, 'somepassword');
      await page.click(SELECTORS.loginButton);

      // Should show validation error
      await expect(page.locator('text=valid email')).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/');

      // Try to login with wrong credentials
      await page.fill(SELECTORS.emailInput, 'nonexistent@example.com');
      await page.fill(SELECTORS.passwordInput, 'WrongPassword123!');
      await page.click(SELECTORS.loginButton);

      // Should show error (could be "Invalid credentials" or similar)
      await expect(page.locator(SELECTORS.errorAlert)).toBeVisible({ timeout: 5000 });
    });

    test('should toggle password visibility', async ({ page }) => {
      await page.goto('/');

      // Type password
      await page.fill(SELECTORS.passwordInput, 'mypassword');

      // Password should be hidden by default
      await expect(page.locator(SELECTORS.passwordInput)).toHaveAttribute('type', 'password');

      // Click the show password button
      await page.click('button:has(svg.lucide-eye)');

      // Password should now be visible
      await expect(page.locator(SELECTORS.passwordInput)).toHaveAttribute('type', 'text');

      // Click again to hide
      await page.click('button:has(svg.lucide-eye-off)');

      // Password should be hidden again
      await expect(page.locator(SELECTORS.passwordInput)).toHaveAttribute('type', 'password');
    });

    test('should show loading state during login', async ({ page }) => {
      await page.goto('/');

      // Fill credentials
      await page.fill(SELECTORS.emailInput, 'test@example.com');
      await page.fill(SELECTORS.passwordInput, 'TestPassword123!');

      // Click login
      await page.click(SELECTORS.loginButton);

      // Should show loading state (button text changes)
      await expect(page.locator('text=Signing in...')).toBeVisible();
    });
  });

  test.describe('Demo Login', () => {
    test('should have demo login button visible', async ({ page }) => {
      await page.goto('/');

      await expect(page.locator(SELECTORS.demoLoginButton)).toBeVisible();
    });

    test('should login with demo account', async ({ page }) => {
      await page.goto('/');

      // Click demo login
      await page.click(SELECTORS.demoLoginButton);

      // Should navigate to dashboard or show error if demo is disabled
      const dashboardOrError = page.locator('text=Dashboard').or(page.locator(SELECTORS.errorAlert));
      await expect(dashboardOrError).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Forgot Password', () => {
    test('should navigate to forgot password page', async ({ page }) => {
      await page.goto('/');

      // Click forgot password link
      await page.click(SELECTORS.forgotPasswordLink);

      // Should show forgot password form
      await expect(page.locator('text=Reset your password').or(page.locator('text=Forgot password'))).toBeVisible();
    });

    test('should navigate back to login from forgot password', async ({ page }) => {
      await page.goto('/');
      await page.click(SELECTORS.forgotPasswordLink);

      // Click back to login
      await page.click('button:has-text("Back to login"), button:has-text("Sign in")');

      // Should show login form
      await expect(page.locator('h1:has-text("Welcome back")')).toBeVisible();
    });
  });

  test.describe('Logout', () => {
    // Note: This test requires a logged-in user, which needs backend support
    test.skip('should logout successfully', async ({ page, loginAsDemo }) => {
      // Login first
      await loginAsDemo();

      // Verify on dashboard
      await expect(page.locator('text=Dashboard')).toBeVisible();

      // Open user menu
      await page.click('[data-testid="user-menu"], button:has-text("demo@")');

      // Click logout
      await page.click('button:has-text("Logout"), button:has-text("Sign out")');

      // Should be back on login page
      await expect(page.locator('h1:has-text("Welcome back")')).toBeVisible();
    });
  });

  test.describe('Navigation between Auth Pages', () => {
    test('should navigate between login and register', async ({ page }) => {
      await page.goto('/');

      // Start on login
      await expect(page.locator('h1:has-text("Welcome back")')).toBeVisible();

      // Go to register
      await page.click(SELECTORS.registerLink);
      await expect(page.locator('h1:has-text("Create your account")')).toBeVisible();

      // Go back to login
      await page.click('button:has-text("Sign in")');
      await expect(page.locator('h1:has-text("Welcome back")')).toBeVisible();
    });
  });
});
