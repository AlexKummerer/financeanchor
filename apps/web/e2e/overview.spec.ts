import { expect, login, test } from './fixtures';

test('Übersicht: durch die Monate blättern und zurück', async ({ page }) => {
  await login(page);
  const label = page.locator('.month-label');
  const current = (await label.textContent())?.trim() ?? '';
  await page.getByRole('button', { name: 'Vorheriger Monat' }).click();
  await expect(label).not.toHaveText(current);
  await expect(page.getByText(/Voraussichtlich frei im/)).toBeVisible();
  await page.getByRole('button', { name: 'Heute' }).click();
  await expect(label).toHaveText(current);
  await expect(page.getByRole('button', { name: 'Heute' })).toHaveCount(0);
});
