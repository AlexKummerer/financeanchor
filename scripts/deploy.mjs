// Deployment auf Cloudflare: Build, Remote-Migrationen, Worker mit Static Assets.
//
//   APP_URL=https://finanzen.example.de pnpm deploy
//
// APP_URL ist die öffentliche Adresse der App (eigene Domain oder *.workers.dev). Sie wird als
// BETTER_AUTH_URL und ALLOWED_ORIGINS gesetzt, damit nie versehentlich Localhost-Werte live gehen.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const appUrl = process.env.APP_URL?.replace(/\/$/, '');
if (!appUrl || !/^https:\/\/[^/]+$/.test(appUrl)) {
  console.error('APP_URL fehlt oder ist ungültig (z. B. APP_URL=https://finanzen.example.de).');
  process.exit(1);
}
const config = readFileSync(new URL('../apps/backend/wrangler.jsonc', import.meta.url), 'utf8');
// Nur die Produktions-ID prüfen; preview_database_id (lokal) darf der Platzhalter sein.
if (/"database_id":\s*"00000000-0000-0000-0000-000000000000"/.test(config)) {
  console.error(
    'database_id in apps/backend/wrangler.jsonc ist noch der Platzhalter (siehe README, „Deployment“).',
  );
  process.exit(1);
}

const run = (cmd, args) => {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('pnpm', ['--filter', '@financeanchor/web', 'build']);
run('pnpm', ['--filter', '@financeanchor/backend', 'db:migrate:remote']);
run('pnpm', [
  '--filter',
  '@financeanchor/backend',
  'exec',
  'wrangler',
  'deploy',
  '--var',
  `BETTER_AUTH_URL:${appUrl}`,
  '--var',
  `ALLOWED_ORIGINS:${appUrl}`,
  '--var',
  'ALLOW_SIGNUP:false',
]);
console.log(`\nFertig: ${appUrl}`);
