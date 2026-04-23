/**
 * Auth flow — critical path. If any of these break, nobody can log in.
 *
 * Note: the app is an SPA and does NOT navigate to `/dashboard` on login.
 * Login flips a state flag and renders the Dashboard component at `/`. Specs
 * wait on dashboard content (greeting heading) instead of URL patterns.
 */

import { test, expect } from '@playwright/test';
import { TEST_USER, loginAsTestUser, logout } from './helpers/auth';

test.describe('Authentication', () => {
  test('login with valid credentials lands on dashboard', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();

    await page.getByLabel(/email/i).first().fill(TEST_USER.email);
    await page.getByLabel(/password/i).first().fill(TEST_USER.password);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Dashboard renders a greeting — the stable user-visible signal that
    // auth completed.
    await expect(
      page.getByRole('heading', { name: /welcome back,|^dashboard$/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('login with wrong password shows an error and stays on login', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/email/i).first().fill(TEST_USER.email);
    await page.getByLabel(/password/i).first().fill('WrongPassword123!');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Error copy varies — match on the common substrings ("invalid" /
    // "incorrect" / "failed"). Stays on the login page.
    await expect(
      page.getByText(/invalid|incorrect|failed|wrong/i).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });

  test('session persists across reload', async ({ page }) => {
    await loginAsTestUser(page);
    await page.reload();
    // Still on dashboard, not back at login.
    await expect(
      page.getByRole('heading', { name: /welcome back,|^dashboard$/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('logout returns to login page', async ({ page }) => {
    await loginAsTestUser(page);
    await logout(page);
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });
});
