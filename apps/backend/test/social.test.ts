import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth.js';
import { appleClientSecret, enabledSocialProviders } from '../src/social.js';
import { env, nextIp, request, signUp } from './helpers.js';

const WEB = 'http://localhost:4200';

const socialSignIn = (provider: string) =>
  request('/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'cf-connecting-ip': nextIp(), origin: WEB },
    body: JSON.stringify({ provider, callbackURL: `${WEB}/`, errorCallbackURL: `${WEB}/login` }),
  });

describe('Anmelden mit Google, Microsoft, Apple', () => {
  it('meldet die aktiven Anbieter, ohne Zugangsdaten keinen', async () => {
    const res = await request('/api/auth-options');
    expect(await res.json()).toEqual({ social: ['google', 'microsoft', 'apple'] });
    expect(
      enabledSocialProviders({ ...env, GOOGLE_CLIENT_SECRET: '', APPLE_KEY_ID: undefined! }),
    ).toEqual(['microsoft']);
  });

  it('leitet zum Anbieter weiter', async () => {
    const hosts = { google: 'accounts.google.com', microsoft: 'login.microsoftonline.com' };
    for (const [provider, host] of Object.entries({ ...hosts, apple: 'appleid.apple.com' })) {
      const res = await socialSignIn(provider);
      expect(res.status).toBe(200);
      const body = await res.json<{ url: string; redirect: boolean }>();
      expect(new URL(body.url).host).toBe(host);
      expect(body.redirect).toBe(true);
    }
  });

  it('lehnt fremde Rücksprung-Adressen ab', async () => {
    const res = await request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'cf-connecting-ip': nextIp(), origin: WEB },
      body: JSON.stringify({ provider: 'google', callbackURL: 'https://boese.example/' }),
    });
    expect(res.status).toBe(403);
  });

  it('keine Registrierung und keine automatische Verknüpfung über die E-Mail-Adresse', () => {
    const options = createAuth(env).options;
    expect(options.socialProviders?.google).toMatchObject({ disableSignUp: true });
    expect(options.socialProviders?.microsoft).toMatchObject({ disableSignUp: true });
    expect(options.account?.accountLinking).toMatchObject({
      enabled: true,
      disableImplicitLinking: true,
      trustedProviders: [],
    });
  });

  it('verbinden nur mit Session', async () => {
    const body = JSON.stringify({ provider: 'google', callbackURL: `${WEB}/einstellungen` });
    const anonymous = await request('/api/auth/link-social', {
      method: 'POST',
      headers: { origin: WEB },
      body,
    });
    expect(anonymous.status).toBe(401);

    const { cookie } = await signUp('verbinden@example.com');
    const res = await request('/api/auth/link-social', {
      method: 'POST',
      headers: { origin: WEB },
      body,
      cookie,
    });
    expect(res.status).toBe(200);
    expect(new URL((await res.json<{ url: string }>()).url).host).toBe('accounts.google.com');

    const accounts = await request('/api/auth/list-accounts', { cookie });
    expect((await accounts.json<{ providerId: string }[]>()).map((a) => a.providerId)).toEqual([
      'credential',
    ]);
  });

  it('Apple-Client-Secret: ES256-JWT mit Team, Services-ID und kurzer Laufzeit', async () => {
    const jwt = await appleClientSecret(env, 1_800_000_000);
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'ES256', kid: 'KEYID12345' });
    expect(decodeJwt(jwt)).toMatchObject({
      iss: 'TEAMID1234',
      sub: 'de.financeanchor.test',
      aud: 'https://appleid.apple.com',
      iat: 1_800_000_000,
      exp: 1_800_000_000 + 3600,
    });
  });
});
