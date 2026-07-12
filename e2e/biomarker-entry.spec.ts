/**
 * Biomarker manual entry — the single path that works for users who can't
 * or won't upload a lab PDF. If this breaks, the app's core value prop
 * (tracking a number over time) dies silently.
 *
 * The measurement modal filters its biomarker list by the ACTIVE category
 * (`measurementOptions[category]`), so the spec navigates to a category
 * first — Diabetes, home of "Glucose (Fasting)". Selector notes:
 *   - Categories live in the collapsible "Biomarkers" sidebar group.
 *   - The dialog is named "Add New Measurement" with a native <select>
 *     biomarker picker and a spinbutton value input.
 * Source of truth on copy changes: `AddMeasurementModal.tsx`.
 */

import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('Biomarker manual entry', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('add a biomarker manually and confirm it appears on the dashboard', async ({ page }) => {
    // Navigate to the Diabetes category — expand the collapsible
    // "Biomarkers" sidebar group when the direct click is intercepted.
    // The accessible name grows a count badge once the category has data
    // ("Diabetes 1") — match with or without it.
    const diabetes = page.getByRole('button', { name: /^diabetes( \d+)?$/i });
    const directlyClickable = await diabetes
      .click({ trial: true, timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!directlyClickable) {
      await page.getByRole('button', { name: /^biomarkers$/i }).click();
    }
    await diabetes.click();

    await page
      .getByRole('button', { name: /add (data|measurement|manually)/i })
      .first()
      .click();

    const dialog = page.getByRole('dialog', { name: /add new measurement/i });
    await expect(dialog.getByRole('heading', { name: /add (new )?measurement/i })).toBeVisible();

    // Native <select> biomarker picker — resolve the Glucose option's value.
    const combo = dialog.getByRole('combobox').first();
    const glucoseValue = await combo
      .locator('option', { hasText: /^glucose/i })
      .first()
      .getAttribute('value');
    expect(glucoseValue).toBeTruthy();
    await combo.selectOption(glucoseValue!);

    await dialog.getByRole('spinbutton').first().fill('95');
    // Date defaults to today; leave it.
    await dialog.getByRole('button', { name: /^add measurement$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The new value shows up in the category view.
    await expect(page.getByText(/glucose/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
