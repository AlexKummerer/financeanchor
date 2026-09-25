import { EMAIL, expect, login, test } from './fixtures';

test.describe('Login', () => {
  test('ohne Session geht es zum Login, mit Rücksprung auf die gewünschte Seite', async ({
    page,
  }) => {
    await page.goto('/kredite');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fkredite/);
    await page.getByLabel('E-Mail').fill(EMAIL);
    await page.getByLabel('Passwort').fill('falsches-passwort-123');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByRole('alert')).toHaveText('E-Mail oder Passwort stimmen nicht.');
  });

  test('anmelden, Übersicht sehen und wieder abmelden', async ({ page }) => {
    await login(page);
    await expect(page.getByText('Frei verfügbar pro Monat')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();

    await page.getByRole('link', { name: 'Einstellungen' }).click();
    await page.getByRole('button', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
