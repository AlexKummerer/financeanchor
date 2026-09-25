import { expect, login, test } from './fixtures';

test('Kreditkarte: anlegen, mit Karte buchen, Stand und Abgleich', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await nav.getByRole('link', { name: 'Vermögen' }).click();

  // Karte anlegen: Monatsende, Abbuchung am 4. vom Girokonto
  await page.getByText('Konto oder Depot hinzufügen', { exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Amex E2E');
  await page.getByLabel('Art', { exact: true }).selectOption({ label: 'Kreditkarte' });
  await page.getByLabel('Aktuell offen auf der Karte (€)').fill('0');
  await page.getByLabel('Abrechnungsstichtag').selectOption({ label: 'Monatsende' });
  await page.getByLabel('Abbuchungstag').selectOption({ label: '4.' });
  await page.getByLabel('Abgebucht von').selectOption({ label: 'Girokonto' });
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('heading', { name: 'Kreditkarten' })).toBeVisible();

  // Kauf mit der Karte
  await nav.getByRole('link', { name: 'Buchungen' }).click();
  await page.getByLabel('Betrag (€)', { exact: true }).fill('45,50');
  await page.getByLabel('Name', { exact: true }).fill('Tanken E2E');
  await page.getByLabel('Kategorie', { exact: true }).fill('Mobilität');
  await page.getByLabel('Bezahlt mit').selectOption({ label: 'Amex E2E' });
  await page.getByRole('button', { name: 'Buchung speichern' }).click();
  await expect(page.locator('.list li').filter({ hasText: 'Tanken E2E' })).toContainText(
    'Amex E2E',
  );

  // Stand und laufende Abrechnung
  await nav.getByRole('link', { name: 'Vermögen' }).click();
  const card = page.locator('fa-card-statements').filter({ hasText: 'Amex E2E' });
  await expect(card.locator('.head .amt')).toHaveText(/-45,50/);
  const current = card.locator('details').filter({ hasText: 'Laufende Abrechnung' });
  await expect(current.locator('summary')).toContainText('45,50');
  await current.locator('summary').click();
  await expect(current).toContainText('Tanken E2E');
  const bank = current.getByLabel('Betrag laut Abrechnung der Bank (€)');
  await bank.fill('50');
  await expect(current.getByRole('status')).toContainText('fehlt eine Buchung');
  await bank.fill('45,50');
  await expect(current.getByRole('status')).toContainText('Stimmt überein');
});
