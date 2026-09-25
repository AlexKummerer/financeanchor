import { expect, test as base, type Page } from '@playwright/test';

export const EMAIL = 'e2e@example.com';
export const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-passwort-sicher-123';

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-Mail', { exact: true }).fill(EMAIL);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
}

export const test = base;
export { expect };
