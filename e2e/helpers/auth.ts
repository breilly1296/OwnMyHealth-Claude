/**
 * Auth helpers for E2E specs.
 *
 * The app is a single-page React app — it doesn't route to `/dashboard` on
 * login, it swaps the rendered component. So post-login waits look for
 * dashboard DOM content, not a URL change.
 *
 * Selector strategy:
 *   - Prefer text-based queries that match user-visible copy.
 *   - Where UI copy is fragile (e.g. the login button labelled "Sign in"),
 *     prefer role-based selectors with accessible name.
 *   - Add `data-testid` attributes to the real UI as test flakiness appears;
 *     see DashboardHeader for the user menu location.
 */

import { Page, expect } from '@playwright/test';

export const TEST_USER = {
  email: 'e2e-test@ownmyhealth.io',
  password: 'E2ETestPass123!',
};

/**
 * Open the app, submit the login form, and wait for the dashboard to render.
 * Throws if the login form isn't present (e.g. already logged in from a
 * previous persisted session — tests should use a fresh context to avoid this).
 */
export async function loginAsTestUser(page: Page): Promise<void> {
  await page.goto('/');

  // Login page header is "Welcome back" — if this isn't present, we may
  // already be authenticated from a stale browser context.
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({ timeout: 10_000 });

  await page.getByLabel(/email/i).first().fill(TEST_USER.email);
  await page.getByLabel(/password/i).first().fill(TEST_USER.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // Dashboard renders the greeting "Welcome back, <name>" or "Dashboard".
  // Waiting on the greeting is more robust than waiting for a URL change —
  // the SPA doesn't navigate on login.
  await expect(page.getByRole('heading', { name: /welcome back,|^dashboard$/i }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Open the user menu in the header. The menu button shows the user's email
 * on >=sm screens. Returns when the dropdown is open so callers can click
 * menu items immediately.
 */
export async function openUserMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: new RegExp(TEST_USER.email, 'i') }).first().click();
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
}

/**
 * Log out via the header user menu. Waits for the login form to return.
 */
export async function logout(page: Page): Promise<void> {
  await openUserMenu(page);
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({ timeout: 10_000 });
}

/**
 * Open Account Settings via the user menu.
 */
export async function openAccountSettings(page: Page): Promise<void> {
  await openUserMenu(page);
  await page.getByRole('button', { name: /account settings/i }).click();
  await expect(page.getByRole('heading', { name: /account settings/i })).toBeVisible();
}
