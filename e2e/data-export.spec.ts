/**
 * Data export — HIPAA compliance requirement. Users must be able to export
 * their data regardless of plan tier. If this breaks, there's a legal
 * obligation failure, not just a UX one.
 *
 * The spec verifies the browser receives a download. It doesn't parse the
 * JSON contents — that's covered by backend unit tests for the export
 * controller.
 */

import { test, expect } from '@playwright/test';
import { loginAsTestUser, openAccountSettings } from './helpers/auth';

test.describe('Data export', () => {
  test('trigger export → JSON file downloads', async ({ page }) => {
    await loginAsTestUser(page);
    await openAccountSettings(page);

    // The export button lives in the "Data & Privacy" section. Button copy
    // is just "Export" (icon + label); scope to the containing row to
    // avoid matching an unrelated button elsewhere on the page.
    const exportRow = page.locator('text=Export All My Data').locator('xpath=ancestor::div[1]');
    const exportButton = exportRow.getByRole('button', { name: /^export/i });

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
    await exportButton.click();
    const download = await downloadPromise;

    // Filename is `ownmyhealth_export_YYYY-MM-DD.json`.
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    expect(download.suggestedFilename().toLowerCase()).toContain('ownmyhealth');

    // The download should have a resolvable path on disk.
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
  });
});
