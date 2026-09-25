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

export const test = base;
export { expect };
