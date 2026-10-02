import { expect, test as base, type Cookie, type Page } from '@playwright/test';

export const EMAIL = 'e2e@example.com';
export const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-passwort-sicher-123';

/** Sitzung aus der letzten Anmeldung; spart Anmeldungen (die Login-Sperre erlaubt 10 pro Minute). */
let session: Cookie[] | null = null;

/**
 * Angemeldet zur Übersicht. Nutzt die vorhandene Sitzung, solange sie gültig ist; sonst (oder mit
 * `fresh`) über das Login-Formular.
 */
export async function login(page: Page, { fresh = false } = {}) {
  if (session && !fresh) {
    await page.context().addCookies(session);
    await page.goto('/');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    if ((await heading.textContent())?.includes('Übersicht')) return;
  }
  await page.goto('/login');
  await page.getByLabel('E-Mail', { exact: true }).fill(EMAIL);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
  session = await page.context().cookies();
}

/**
 * „Heute“ so, wie die App im Test-Browser es sieht (Zeitzone Europe/Berlin laut Konfiguration) –
 * nicht in der Zeitzone des Rechners, sonst passen Tag oder Monat kurz nach Mitternacht nicht.
 */
export function appToday(): { year: number; month: number; day: number; ym: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month');
  return { year, month, day: get('day'), ym: `${year}-${String(month).padStart(2, '0')}` };
}

export const test = base;
export { expect };
