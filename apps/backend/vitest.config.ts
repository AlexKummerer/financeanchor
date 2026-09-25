import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  // Wegwerf-Schlüssel für die Apple-Anmeldung im Test (P-256, wie die .p8-Dateien von Apple)
  const appleKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Leere D1s für die Migrationstests
          d1Databases: { DB_MIGRATION: 'migration-test', DB_MIGRATION_CARDS: 'migration-cards' },
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: 'test-secret-mindestens-32-zeichen-lang-0123456789',
            // In Tests werden Nutzer über die Registrierung angelegt; ein Test prüft die Sperre.
            ALLOW_SIGNUP: 'true',
            // Fiktive Zugangsdaten: Anbieter sind aktiv, es wird aber nie ein Anbieter aufgerufen
            GOOGLE_CLIENT_ID: 'test-google-id',
            GOOGLE_CLIENT_SECRET: 'test-google-secret',
            MICROSOFT_CLIENT_ID: 'test-microsoft-id',
            MICROSOFT_CLIENT_SECRET: 'test-microsoft-secret',
            APPLE_CLIENT_ID: 'de.financeanchor.test',
            APPLE_TEAM_ID: 'TEAMID1234',
            APPLE_KEY_ID: 'KEYID12345',
            APPLE_PRIVATE_KEY: appleKey.replace(/\n/g, '\\n'),
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
