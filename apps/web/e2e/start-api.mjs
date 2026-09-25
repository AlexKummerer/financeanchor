// Startet den Worker für E2E-Tests mit eigener, frisch angelegter lokaler D1 und Demo-Account.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const backend = path.resolve(import.meta.dirname, '../../backend');
const persist = '.wrangler/e2e';
export const E2E_EMAIL = 'e2e@example.com';
const password = process.env.E2E_PASSWORD ?? 'e2e-passwort-sicher-123';

const run = (args, env = {}) => {
  const r = spawnSync('pnpm', args, {
    cwd: backend,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

rmSync(path.join(backend, persist), { recursive: true, force: true });
run(['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist]);
run(
  [
    'exec',
    'tsx',
    'scripts/seed.ts',
    '--email',
    E2E_EMAIL,
    '--name',
    'E2E',
    '--demo',
    '--persist-to',
    persist,
  ],
  {
    SEED_PASSWORD: password,
  },
);

const vars = {
  BETTER_AUTH_SECRET: 'e2e-secret-nur-fuer-lokale-tests-0123456789',
  BETTER_AUTH_URL: 'http://localhost:4300',
  ALLOWED_ORIGINS: 'http://localhost:4300',
  ALLOW_SIGNUP: 'false',
};
// Wrangler direkt starten (ohne pnpm-Wrapper), damit das Beenden-Signal ankommt.
const wrangler = path.join(backend, 'node_modules/.bin/wrangler');
const child = spawn(
  wrangler,
  [
    'dev',
    '--port',
    '8788',
    '--persist-to',
    persist,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ],
  { cwd: backend, stdio: 'inherit' },
);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill('SIGINT');
    setTimeout(() => child.kill('SIGKILL'), 3000).unref();
  });
}
child.on('exit', (code) => process.exit(code ?? 0));
