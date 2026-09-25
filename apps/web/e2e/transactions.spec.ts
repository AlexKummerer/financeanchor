import { expect, login, test } from './fixtures';

test('Buchung erfassen: erscheint in der Liste und in den Summen', async ({ page }) => {
  await login(page);
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Buchungen' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Haushaltsbuch' })).toBeVisible();

  const expenses = page
    .locator('.kpis .panel')
    .filter({ hasText: 'Ausgaben' })
    .locator('.kpi-value');
  const before = await expenses.textContent();

  await page.getByLabel('Betrag (€)', { exact: true }).fill('23,45');
  await page.getByLabel('Name', { exact: true }).fill('Bäckerei E2E');
  await page.getByLabel('Kategorie', { exact: true }).fill('Lebensmittel');
  await page.getByRole('button', { name: 'Buchung speichern' }).click();

  await expect(page.getByRole('status')).toHaveText('Buchung gespeichert');
  const row = page.locator('.list li').filter({ hasText: 'Bäckerei E2E' });
  await expect(row).toContainText('-23,45');
  await expect(row).toContainText('Lebensmittel');
  await expect(expenses).not.toHaveText(before ?? '');
  await expect(page.getByLabel('Betrag (€)', { exact: true })).toBeFocused();

  // Löschen einer normalen Buchung ohne Rückfrage
  await row.getByRole('button', { name: 'Buchung Bäckerei E2E löschen' }).click();
  await expect(page.locator('.list li').filter({ hasText: 'Bäckerei E2E' })).toHaveCount(0);
});
