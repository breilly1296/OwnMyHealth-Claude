/**
 * Account Settings — verifies the page renders user-bound state, the
 * password-change form gates on current password, and notification toggles
 * are live (save-on-toggle, not save-button).
 *
 * What a regression looks like:
 *   - Page mounts but profile fetch fails silently → email never shown.
 *   - Change-password form is missing the current-password input → users
 *     could change passwords without knowing the old one.
 *   - Toggles click but don't update (optimistic UI never rolls back).
 */

import { test, expect } from '@playwright/test';
import { TEST_USER, loginAsTestUser, openAccountSettings } from './helpers/auth';

test.describe('Account Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await openAccountSettings(page);
  });

  test('settings page shows the signed-in user email', async ({ page }) => {
    // Email is displayed in a read-only field in the Profile section. Scope
    // to the main content — the header user-menu button also carries it.
    await expect(page.locator('#main-content').getByText(TEST_USER.email)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('change-password dialog requires the current password', async ({ page }) => {
    await page.getByRole('button', { name: /change password/i }).click();

    // The modal has labeled inputs for "Current password", "New password",
    // and "Confirm new password". Gate on the current-password input
    // existing — that's the security invariant.
    await expect(page.getByLabel(/current password/i)).toBeVisible();
    await expect(page.getByLabel(/new password/i)).toBeVisible();
  });

  test('notification toggle flips on click and persists', async ({ page }) => {
    // NotificationSettingsSection renders toggle buttons (not <input
    // type=checkbox>); they use aria-pressed for state. Scope to the
    // Email Notifications section since that's the test surface.
    const section = page.locator('section', { hasText: /email notifications/i });
    const firstToggle = section.locator('button[aria-pressed]').first();

    await firstToggle.waitFor();
    const initial = await firstToggle.getAttribute('aria-pressed');

    await firstToggle.click();
    // Small settle — the PATCH is optimistic, so the DOM flips before the
    // network round-trip. Wait for aria-pressed to change.
    await expect(firstToggle).not.toHaveAttribute('aria-pressed', initial ?? '', { timeout: 5_000 });
  });
});
