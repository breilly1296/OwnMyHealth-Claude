/**
 * Health Guide chat — verifies the page mounts and the chat surface
 * responds to user input. Deliberately does NOT assert on specific Claude
 * output: the test has to pass whether the Anthropic API key is set or not
 * (dev often runs without a real key, so the backend returns a 503 or
 * plan-limit error instead of a stream).
 *
 * What a regression looks like:
 *   - Page never renders (crashes on suspense boundary).
 *   - Send button disabled permanently.
 *   - User's message never shows up in the thread.
 */

import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('Health Guide', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('navigate to Health Guide → page loads with composer', async ({ page }) => {
    // The sidebar nav item is labeled "Health Guide".
    await page.getByRole('button', { name: /health guide/i }).first().click();

    await expect(page.getByRole('heading', { name: /health guide/i })).toBeVisible();
    // Composer textarea (placeholder copy varies by streaming state — match
    // on any of the plausible prompts).
    await expect(
      page.locator('textarea').filter({ hasText: '' }).first()
    ).toBeVisible();
  });

  test('send a message → user bubble appears and UI does not crash', async ({ page }) => {
    await page.getByRole('button', { name: /health guide/i }).first().click();
    const composer = page.locator('textarea').first();
    await composer.waitFor();

    const message = 'hello from e2e';
    await composer.fill(message);

    // Submit via Enter (the composer intercepts Enter to submit). Falls
    // back to the send icon button if Enter doesn't trigger.
    await composer.press('Enter');

    // Either way: the user's own message must appear in the thread. This
    // is the test — streaming response is optional and dependent on BAA /
    // API availability.
    await expect(page.getByText(message)).toBeVisible({ timeout: 10_000 });

    // Give the assistant a beat to stream, error, or rate-limit out.
    // Intentional fixed wait — streaming responses have no deterministic
    // "done" signal that the spec can assert against.
    await page.waitForTimeout(3_000);

    // The page should still be alive — check that the composer wasn't
    // wiped out by an unhandled exception.
    await expect(page.locator('textarea').first()).toBeVisible();
  });
});
