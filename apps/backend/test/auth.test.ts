import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
import { env, nextIp, PASSWORD, request, signIn, signUp } from './helpers.js';

describe('Registrierung', () => {
  it('ist gesperrt, wenn ALLOW_SIGNUP nicht true ist', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
        body: JSON.stringify({ email: 'neu@example.com', password: PASSWORD, name: 'Neu' }),
      }),
      { ...env, ALLOW_SIGNUP: 'false' },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const n = await env.DB.prepare(
      "select count(*) as n from user where email = 'neu@example.com'",
    ).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('legt Startdaten an: Kategorien, Systemkategorien, Einstellungen, Rücklagentopf, Testphase', async () => {
    const { userId } = await signUp('start@example.com');
    const q = (sql: string) => env.DB.prepare(sql).bind(userId).first<{ n: number }>();
    expect(
      (await q('select count(*) as n from categories where user_id = ? and system_key is null'))?.n,
    ).toBe(13);
    expect(
      (await q('select count(*) as n from categories where user_id = ? and system_key is not null'))
        ?.n,
    ).toBe(3);
    expect((await q('select count(*) as n from user_settings where user_id = ?'))?.n).toBe(1);
    expect(
      (await q('select count(*) as n from reserve_pots where user_id = ? and is_default = 1'))?.n,
    ).toBe(1);
    const e = await env.DB.prepare('select plan, trial_ends_at from entitlements where user_id = ?')
      .bind(userId)
      .first<{ plan: string; trial_ends_at: number }>();
    expect(e?.plan).toBe('trial');
    expect(e!.trial_ends_at).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it('verlangt ein Passwort mit mindestens 12 Zeichen', async () => {
    const res = await request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'cf-connecting-ip': nextIp() },
      body: JSON.stringify({ email: 'kurz@example.com', password: 'kurz', name: 'K' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('Login und Session', () => {
  it('setzt ein HttpOnly-Cookie mit SameSite=Lax', async () => {
    await signUp('login@example.com');
    const res = await signIn('login@example.com');
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.includes('session_token'));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('lehnt ein falsches Passwort ab', async () => {
    await signUp('falsch@example.com');
    const res = await signIn('falsch@example.com', 'das-ist-nicht-richtig');
    expect(res.status).toBe(401);
  });

  it('ohne Session: 401 für alle geschützten Routen', async () => {
    const res = await request('/api/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('mit Session: /api/me liefert Nutzer, Einstellungen und Freigabe', async () => {
    const { cookie } = await signUp('me@example.com');
    const res = await request('/api/me', { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      user: { email: 'me@example.com' },
      settings: { strategy: 'avalanche', locale: 'de', currency: 'EUR', extraPaymentCents: 0 },
      entitlement: { plan: 'trial', active: true },
    });
  });

  it('begrenzt Login-Versuche je IP', async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await signIn('niemand@example.com', 'irgendein-passwort', ip)).status);
    }
    expect(statuses).toContain(429);
  });
});

describe('Freigaben', () => {
  it('ohne aktive Testphase oder Abo: 402 für fachliche Routen, /me bleibt erreichbar', async () => {
    const { userId, cookie } = await signUp('abgelaufen@example.com');
    await env.DB.prepare('update entitlements set trial_ends_at = ? where user_id = ?')
      .bind(Date.now() - 1, userId)
      .run();
    const res = await request('/api/accounts', { cookie });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: { code: 'entitlement_required' } });
    const me = await request('/api/me', { cookie });
    expect(await me.json()).toMatchObject({ entitlement: { active: false } });
  });

  it('mit aktiver Freigabe geht es weiter (unbekannte Route: 404)', async () => {
    const { cookie } = await signUp('aktiv@example.com');
    expect((await request('/api/gibtsnicht', { cookie })).status).toBe(404);
  });
});

describe('CORS', () => {
  it('erlaubt nur eigene Origins', async () => {
    const ok = await request('/api/health', { headers: { origin: 'http://localhost:4200' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:4200');
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const bad = await request('/api/health', { headers: { origin: 'https://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});
