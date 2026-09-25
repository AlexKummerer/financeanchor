import { expect, login, test } from './fixtures';

test('„Tilgen bis Datum“, Beispielrechnung und Vorschläge zum Übernehmen', async ({ page }) => {
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
  await expect(rows.first()).toContainText('aktuell geplant');
  await card.getByLabel('Eigenen Monatsbetrag durchspielen (€)').fill('400');
  await card.getByRole('button', { name: 'Rechnen' }).click();
  await expect(
    card.locator('fa-scenario-table tbody tr').filter({ hasText: 'dein Betrag' }),
  ).toContainText('3 Monate');

  // Verfügbares Geld ändert nichts am Plan; reicht es nicht, zeigt die App die Aufstellung
  await expect(page.locator('.loan-kpis')).toContainText('Nettoschulden');
  await expect(page.locator('.loan-kpis')).toContainText('Getilgt');
  const planned = page.locator('dl.split');
  const before = await planned.textContent();
  const available = page.getByLabel('Verfügbar für Kredite pro Monat (€)');
  const panel = page.locator('fa-advice-panel');
  await available.fill('1');
  await available.press('Tab');
  await expect(panel.getByText(/es fehlen/)).toBeVisible();
  await expect(panel.locator('table.breakdown')).toContainText('Privatkredit E2E');
  await expect(panel.locator('li')).toHaveCount(0);

  // Ist Geld übrig, gibt es fertige Vorschläge zum Übernehmen
  await available.fill('2.000');
  await available.press('Tab');
  await expect(page.getByText(/bleiben .* übrig/)).toBeVisible();
  await expect(planned).toHaveText(before ?? '');

  const suggestion = panel.locator('li').filter({ hasText: 'Spart am meisten Zinsen' });
  // Verlauf im Dialog, ohne zu übernehmen
  await suggestion.getByRole('button', { name: 'Verlauf ansehen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Spart am meisten Zinsen' });
  await expect(dialog.locator('fa-allocation-table tbody tr').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('dl.split')).toHaveText(before ?? '');

  await suggestion.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'übernommen' })).toBeVisible();
  await expect(page.locator('dl.split')).toContainText('Eigene Extra-Tilgung');

  await expect(page.getByRole('heading', { name: 'Aufteilung pro Monat' })).toBeVisible();
});
