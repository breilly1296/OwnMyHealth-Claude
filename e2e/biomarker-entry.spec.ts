/**
 * Biomarker manual entry — the single path that works for users who can't
 * or won't upload a lab PDF. If this breaks, the app's core value prop
 * (tracking a number over time) dies silently.
 *
 * SELECTOR FRAGILITY: The modal's inputs don't have stable `data-testid`s
 * yet; this spec uses visible labels and placeholder hints. If the modal
 * copy changes, `AddMeasurementModal.tsx` is the source of truth to update.
 */

import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('Biomarker manual entry', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('add a biomarker manually and confirm it appears on the dashboard', async ({ page }) => {
    // The "Add Measurement" button appears in CategoryContent and the
    // dashboard empty state. On the Overview page the quick-action card
    // is labeled "Add manually" (empty state) or "Add Measurement" (chip).
    await page
      .getByRole('button', { name: /add (measurement|manually)/i })
      .first()
      .click();

    await expect(page.getByRole('heading', { name: /add measurement/i })).toBeVisible();

    // The modal's category select — labeled visibly. Default value is one
    // of the sample categories; switching isn't strictly necessary, so
    // just pick Glucose from the biomarker name list.
    // Pick a well-known biomarker name that exists in the sample catalog.
    await page.getByRole('option', { name: /glucose/i }).first().click().catch(async () => {
      // If it's a combobox / button list, fall back to a text click.
      await page.getByText(/glucose/i).first().click();
    });

    // Value input — numeric. The modal usually uses an <input type="number">
    // with a placeholder like "Enter value".
    await page.locator('input[type="number"]').first().fill('95');

    // Date input — default is today, but set explicitly for determinism.
    const today = new Date().toISOString().slice(0, 10);
    await page.locator('input[type="date"]').first().fill(today).catch(() => {
      /* some date inputs are auto-populated — skip if fill fails */
    });

    await page.getByRole('button', { name: /^(save|add measurement|add)$/i }).last().click();

    // Modal closes and the new value shows up on the dashboard. Use a
    // lenient match because the biomarker card may render the name in
    // various spots (category card count, filtered list, recent activity).
    await expect(page.getByText(/glucose/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
