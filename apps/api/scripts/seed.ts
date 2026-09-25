/**
 * Legt einen Account mit vollen Freigaben an (Phase 1: geschlossene Registrierung).
 *
 *   pnpm db:seed -- --email du@example.com [--name "Name"] [--remote]
 *
 * Das Passwort kommt aus SEED_PASSWORD oder wird verdeckt abgefragt (nie als Argument, damit es
 * nicht in der Shell-Historie landet).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { newId } from '@financeanchor/shared';
import { hashPassword } from 'better-auth/crypto';
import {
  account,
  categories,
  entitlements,
  reservePots,
  user,
  userSettings,
} from '../src/db/schema.js';
import { initialUserRows } from '../src/services/userInit.js';
import { insertSql } from './sql.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    remote: { type: 'boolean', default: false },
  },
});

async function readPassword(): Promise<string> {
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('SEED_PASSWORD setzen oder im Terminal ausführen');
  process.stdout.write('Passwort (mind. 12 Zeichen): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let input = '';
  return new Promise((resolve, reject) => {
    process.stdin.on('data', (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          return resolve(input);
        }
        if (ch === '\u0003') return reject(new Error('Abgebrochen'));
        if (ch === '\u007f') input = input.slice(0, -1);
        else input += ch;
      }
    });
  });
}

export async function buildSeedSql(
  email: string,
  name: string,
  password: string,
  now = Date.now(),
) {
  const userId = newId(now);
  const initial = initialUserRows(userId, now, 'internal');
  return [
    ...insertSql(user, [
      {
        id: userId,
        name,
        email,
        emailVerified: true,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    ]),
    ...insertSql(account, [
      {
        id: newId(now),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: await hashPassword(password),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    ]),
    ...insertSql(categories, initial.categories),
    ...insertSql(userSettings, [initial.settings]),
    ...insertSql(reservePots, [initial.reservePot]),
    ...insertSql(entitlements, [initial.entitlement]),
  ];
}

async function main() {
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new Error('--email fehlt oder ist ungültig');
  const password = await readPassword();
  if (password.length < 12) throw new Error('Passwort muss mindestens 12 Zeichen haben');
  const statements = await buildSeedSql(
    email,
    values.name ?? email.split('@')[0] ?? email,
    password,
  );

  const dir = mkdtempSync(path.join(tmpdir(), 'financeanchor-seed-'));
  const file = path.join(dir, 'seed.sql');
  writeFileSync(file, statements.join('\n'), { mode: 0o600 });
  try {
    const target = values.remote ? '--remote' : '--local';
    const r = spawnSync(
      'pnpm',
      ['exec', 'wrangler', 'd1', 'execute', 'DB', target, '--file', file, '--yes'],
      {
        stdio: 'inherit',
      },
    );
    if (r.status !== 0)
      throw new Error('wrangler d1 execute ist fehlgeschlagen (existiert der Account schon?)');
    console.log(`Account ${email} angelegt (${values.remote ? 'Produktion' : 'lokal'}).`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
