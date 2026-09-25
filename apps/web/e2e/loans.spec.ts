import { expect, login, test } from './fixtures';

test('„Tilgen bis Datum“: nötige Rate, Beispielrechnung und Budget', async ({ page }) => {
  await login(page);
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Kredite' })
    .click();

  // Kredit ohne Rate, aber mit Frist in fünf Monaten (Monatsende)
  const due = new Date();
  due.setDate(1);
  due.setMonth(due.getMonth() + 5);
  const last = new Date(due.getFullYear(), due.getMonth() + 1, 0);
  const dueDate = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;

  await page.getByText('Kredit hinzufügen', { exact: true }).click();
  await page.getByRole('radio', { name: 'Tilgen bis Datum' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Privatkredit E2E');
  await page.getByLabel('Offener Betrag (€)').fill('1.200');
  await page.getByLabel('Zurückzahlen bis').fill(dueDate);
  await page.getByRole('button', { name: 'Kredit speichern' }).click();
  await expect(page.getByRole('status')).toHaveText('Kredit gespeichert');

  const card = page.locator('fa-loan-card').filter({ hasText: 'Privatkredit E2E' });
  // 1.200 € auf sechs Monate (laufender Monat bis Fristmonat)
  await expect(card).toContainText('Nötig: 200,00 €/Monat');
  await expect(card).toContainText('wird eingehalten');

  await card.getByText('Beispielrechnung', { exact: true }).click();
  const rows = card.locator('fa-scenario-table tbody tr');
  await expect(rows.first()).toContainText('200,00 €');
  await expect(rows.first()).toContainText('nötig für die Frist');
  await card.getByLabel('Eigenen Monatsbetrag durchspielen (€)').fill('400');
  await card.getByRole('button', { name: 'Rechnen' }).click();
  await expect(
    card.locator('fa-scenario-table tbody tr').filter({ hasText: 'dein Betrag' }),
  ).toContainText('3 Monate');

  // Budget: die Aufschlüsselung erscheint, zu wenig Budget wird gemeldet
  await page.getByLabel('Für Kredite pro Monat insgesamt (€)').fill('100');
  await page.getByLabel('Für Kredite pro Monat insgesamt (€)').press('Tab');
  await expect(page.locator('.warn').first()).toContainText('reicht diesen Monat nicht');
  await page.getByLabel('Für Kredite pro Monat insgesamt (€)').fill('');
  await page.getByLabel('Für Kredite pro Monat insgesamt (€)').press('Tab');
  await expect(page.locator('.warn')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Aufteilung pro Monat' })).toBeVisible();
});
