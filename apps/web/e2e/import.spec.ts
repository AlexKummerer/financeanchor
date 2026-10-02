import { appToday, expect, login, test } from './fixtures';

/** Eigene Datei im Sparkasse-Format (CSV-CAMT V2) mit Datum im laufenden Monat */
function sparkasseCsv(): string {
  const d = appToday();
  const day = (n: number) =>
    `${String(n).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.${String(d.year).slice(2)}`;
  return [
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
    `"DE00";"${day(1)}";"${day(1)}";"KARTENZAHLUNG";"Einkauf";"";"";"";"";"";"";"Baeckerei Import E2E";"";"";"-7,40";"EUR";"Umsatz gebucht"`,
    `"DE00";"${day(1)}";"${day(1)}";"KARTENZAHLUNG";"Zeitschrift";"";"";"";"";"";"";"Kiosk Import E2E";"";"";"-123,45";"EUR";"Umsatz gebucht"`,
    `"DE00";"${day(1)}";"${day(1)}";"LASTSCHRIFT";"Offen";"";"";"";"";"";"";"Vorgemerkt E2E";"";"";"-1,00";"EUR";"Umsatz vorgemerkt"`,
  ].join('\n');
}

test('CSV einlesen: Vorschau, anhaken, übernehmen, zweites Einlesen erkennt es', async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Buchungen' })
    .click();
  await page.getByRole('link', { name: 'Umsätze aus CSV einlesen' }).click();

  const upload = async () =>
    page.getByLabel('CSV-Datei').setInputFiles({
      name: 'umsaetze.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(sparkasseCsv(), 'latin1'),
    });
  await upload();
  await expect(page.getByText(/Erkannt: Sparkasse · 2 Umsätze/)).toBeVisible();

  // Nichts vorausgewählt
  const commit = page.getByRole('button', { name: /übernehmen$/ });
  await expect(commit).toHaveText(/0 übernehmen/);
  await expect(commit).toBeDisabled();

  const row = page.locator('ul.rows > li').filter({ hasText: 'Baeckerei Import E2E' });
  await row.getByRole('checkbox').check();
  await row.getByLabel('Name', { exact: true }).fill('Bäcker');
  await row.getByLabel('Kategorie', { exact: true }).fill('Lebensmittel');
  await commit.click();
  await expect(page.getByRole('status')).toHaveText('1 Buchungen übernommen, 0 verknüpft');

  // Zweites Einlesen: die übernommene Zeile ist bekannt, die andere bleibt neu
  await upload();
  await expect(page.getByRole('button', { name: /Übernommen \(1\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Neu \(1\)/ })).toBeVisible();

  await page.getByRole('link', { name: 'Zurück zu den Buchungen' }).click();
  await expect(page.locator('.list li').filter({ hasText: 'Bäcker' })).toContainText('-7,40');
});

test('Amex-Datei auf die Karte: Belastungen werden Ausgaben', async ({ page }) => {
  await login(page);
  await page.goto('/vermoegen');
  await page.getByText('Konto oder Depot hinzufügen', { exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Amex Import E2E');
  await page.getByLabel('Art', { exact: true }).selectOption({ label: 'Kreditkarte' });
  await page.getByLabel('Aktuell offen auf der Karte (€)').fill('0');
  await page.getByLabel('Abrechnungsstichtag').selectOption({ label: '3.' });
  await page.getByLabel('Abbuchungstag').selectOption({ label: '4.' });
  await page.getByRole('button', { name: 'Speichern' }).click();

  await page.goto('/buchungen/einlesen');
  await page
    .getByLabel('Zu welchem Konto gehört die Datei?')
    .selectOption({ label: 'Amex Import E2E (Kreditkarte)' });
  const csv = [
    'Datum,Beschreibung,Betrag',
    '01/09/2026,GOOGLE*GOOGLE PLAY APPS,"17,99"',
    '02/09/2026,AMAZON WEB SERVICES,"65,12"',
    '03/09/2026,ZAHLUNG/ÜBERWEISUNG ERHALTEN BESTEN DANK,"-100,00"',
  ].join('\n');
  await page.getByLabel('CSV-Datei').setInputFiles({
    name: 'activity.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText(/Erkannt: American Express · 3 Umsätze/)).toBeVisible();
  await expect(page.locator('ul.rows > li').filter({ hasText: 'GOOGLE' })).toContainText('-17,99');
  await expect(
    page.getByLabel('Belastungen stehen positiv in der Datei', { exact: false }),
  ).toBeChecked();
});

test('Anderer Bank-Text und Betrag: von Hand als schon gebucht verknüpfen', async ({ page }) => {
  await login(page);
  const month = appToday().ym;
  const categories = (await (await page.request.get('/api/categories')).json()) as {
    id: string;
    name: string;
  }[];
  const created = await page.request.post('/api/transactions', {
    data: {
      date: `${month}-02`,
      name: 'Rate OLB Testlauf',
      categoryId: categories.find((c) => c.name === 'Lebensmittel')?.id,
      amountCents: -8200,
    },
  });
  expect(created.ok()).toBe(true);

  const day = `05.${month.slice(5)}.${month.slice(0, 4)}`;
  const csv = [
    'Buchungstag;Betrag;Empfänger;Verwendungszweck',
    `${day};-80,00;Oldenburgische Landesbank;Darlehen 4711`,
  ].join('\n');
  await page.goto('/buchungen/einlesen');
  await page.getByLabel('CSV-Datei').setInputFiles({
    name: 'olb.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  const row = page.locator('ul.rows > li').filter({ hasText: 'Oldenburgische Landesbank' });
  await row.getByRole('button', { name: 'Ist schon gebucht als …' }).click();
  const pick = row.getByLabel('Vorhandene Buchung');
  const value = await pick
    .locator('option', { hasText: 'Rate OLB Testlauf' })
    .getAttribute('value');
  await pick.selectOption(value ?? '');
  await expect(row).toContainText('Verknüpft mit Rate OLB Testlauf');
  await row.getByRole('checkbox', { name: /Betrag von „Rate OLB Testlauf“/ }).check();

  await page.getByRole('button', { name: /1 übernehmen$/ }).click();
  await expect(page.getByRole('status').first()).toContainText(
    '0 Buchungen übernommen, 1 verknüpft',
  );

  await page.goto('/buchungen');
  await expect(page.locator('.list li').filter({ hasText: 'Rate OLB Testlauf' })).toContainText(
    '-80,00',
  );
});
