/**
 * Export + account-deletion journey (P0-3 — "user completes export + delete
 * unaided").
 *
 * One continuous journey with a DEDICATED user (never the shared seed user —
 * this spec destroys its account):
 *
 *   login → add a biomarker → export (parse the JSON, confirm the PHI is in
 *   it, decrypted) → delete account with the wrong password (refused) → delete
 *   with the right password → bounced to login → re-login fails → DB forensics:
 *   user gone, encryption salt gone, biomarkers gone, HIPAA deletion audit row
 *   present.
 *
 * The DB forensics step ties the UI journey to the cascade guarantees proven
 * in backend/src/services/accountDeletionCascade.test.ts — together they are
 * the P0-3 acceptance evidence.
 */

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import {
  seedJourneyUser,
  fetchJourneyForensics,
  cleanupJourneyUser,
} from './helpers/journeyUser';

const JOURNEY_USER = {
  email: 'e2e-journey@ownmyhealth.io',
  password: 'E2EJourneyPass123!',
};

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
}

async function openAccountSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: new RegExp(JOURNEY_USER.email, 'i') }).first().click();
  // The header dropdown is a semantic menu (a11y wave #198) — items are
  // menuitems, not buttons. Gate on the menu rendering before clicking.
  const menu = page.getByRole('menu', { name: /account menu/i });
  await expect(menu.getByRole('menuitem', { name: /sign out/i })).toBeVisible();
  await menu.getByRole('menuitem', { name: /account settings/i }).click();
  await expect(page.getByRole('heading', { name: /account settings/i })).toBeVisible();
}

test.describe('Export + delete journey (P0-3)', () => {
  let userId: string;

  test.beforeAll(async () => {
    userId = await seedJourneyUser(JOURNEY_USER.email, JOURNEY_USER.password);
  });

  test.afterAll(async () => {
    // Safety net for a failed run — the happy path deletes the user itself.
    await cleanupJourneyUser(JOURNEY_USER.email);
  });

  test('user exports their data, deletes their account, and the account is truly gone', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await test.step('login as the journey user', async () => {
      await login(page, JOURNEY_USER.email, JOURNEY_USER.password);
      await expect(
        page.getByRole('heading', { name: /welcome back,|^dashboard$/i }).first()
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step('add a biomarker so the account holds real PHI', async () => {
      // The measurement modal filters its biomarker list by the ACTIVE
      // category, so navigate to Diabetes first (home of "Glucose (Fasting)").
      // The category lives in the collapsible "Biomarkers" sidebar group —
      // expand it when the direct click is intercepted by the collapsed group.
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
      await page.getByRole('button', { name: /add (data|measurement|manually)/i }).first().click();

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
      await expect(page.getByText(/glucose/i).first()).toBeVisible({ timeout: 10_000 });
    });

    await test.step('export all data and verify the PHI is in the download, decrypted', async () => {
      await openAccountSettings(page);

      await expect(page.getByText('Export All My Data')).toBeVisible();
      const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
      // The row's button is named exactly "Export" — unique on this page.
      await page.getByRole('button', { name: /^export$/i }).click();
      const download = await downloadPromise;

      const filePath = await download.path();
      expect(filePath).toBeTruthy();
      const raw = await fs.readFile(filePath!, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const flat = JSON.stringify(parsed);

      // The account's PHI must be present and DECRYPTED (plaintext value, not
      // AES ciphertext), and the export must identify the account.
      expect(flat).toMatch(/glucose/i);
      expect(flat).toContain('95');
      expect(flat).toContain(JOURNEY_USER.email);
      expect(flat).not.toMatch(/Encrypted"/); // no raw ciphertext fields leak
    });

    await test.step('a wrong password refuses the deletion', async () => {
      await page.getByRole('button', { name: /^delete account$/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: /delete account/i })).toBeVisible();

      await dialog.locator('input').first().fill('Wrong-Password-1!');
      await dialog.getByRole('button', { name: /delete account/i }).click();

      // The modal surfaces the refusal and the session is still alive.
      await expect(dialog.getByText(/invalid|incorrect|failed/i)).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step('the correct password completes the deletion and bounces to login', async () => {
      const dialog = page.getByRole('dialog');
      await dialog.locator('input').first().fill(JOURNEY_USER.password);
      await dialog.getByRole('button', { name: /delete account/i }).click();

      // deleteAccount redirects to '/' on success — a full reload landing on
      // the login page.
      await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({
        timeout: 20_000,
      });
    });

    await test.step('re-login with the deleted credentials fails', async () => {
      await login(page, JOURNEY_USER.email, JOURNEY_USER.password);
      // Login must be refused — an error is shown and the dashboard never mounts.
      await expect(page.getByText(/invalid|incorrect|failed/i).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByRole('heading', { name: /welcome back,|^dashboard$/i })
      ).toHaveCount(0);
    });

    await test.step('DB forensics: user gone, salt destroyed, deletion audit row present', async () => {
      const forensics = await fetchJourneyForensics(userId);
      expect(forensics.userExists).toBe(false);
      expect(forensics.encryptionKeyCount).toBe(0); // the PHI salt is destroyed
      expect(forensics.biomarkerCount).toBe(0);
      expect(forensics.deletionAuditCount).toBeGreaterThanOrEqual(1);
    });
  });
});
