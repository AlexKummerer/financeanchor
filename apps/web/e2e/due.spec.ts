import { expect, login, test } from './fixtures';

test('Fällige übernehmen: bucht bis heute Fälliges genau einmal und passt die Stände an', async ({
  page,
}) => {
  await login(page);
  const due = page.locator('fa-due-panel');
  const bookButton = due.getByRole('button', { name: /als Buchungen übernehmen/ });
  await expect(bookButton).toBeEnabled();
  const label = (await bookButton.textContent()) ?? '';
  const count = Number(label.trim().split(' ')[0]);
  expect(count).toBeGreaterThan(0);

  const debt = page
    .locator('.kpis .panel')
    .filter({ hasText: 'Restschuld Kredite' })
    .locator('.kpi-value');
  const debtBefore = await debt.textContent();

  await bookButton.click();
  await expect(page.getByRole('status')).toHaveText(`${count} Buchungen übernommen`);
  await expect(due.getByRole('button', { name: '0 als Buchungen übernehmen' })).toBeDisabled();
  await expect(due.getByText('gebucht').first()).toBeVisible();
  // Die Kreditrate des Laptops (Tag 1) senkt die Restschuld
  await expect(debt).not.toHaveText(debtBefore ?? '');

  // Nach dem Neuladen bleibt alles gebucht – kein zweites Mal buchbar
  await page.reload();
  await expect(
    page.locator('fa-due-panel').getByRole('button', { name: '0 als Buchungen übernehmen' }),
  ).toBeDisabled();

  // Die Buchungen stehen im Haushaltsbuch
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Buchungen' })
    .click();
  await expect(page.locator('.list li').filter({ hasText: 'Miete warm' })).toContainText('-850,00');
  await expect(page.locator('.list li').filter({ hasText: 'Rate Ratenkauf Laptop' })).toBeVisible();
});
