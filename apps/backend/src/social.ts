import type { BetterAuthOptions } from 'better-auth';
import { SignJWT, importPKCS8 } from 'jose';

export const socialProviderIds = ['google', 'microsoft', 'apple'] as const;
export type SocialProviderId = (typeof socialProviderIds)[number];

/** Gesetzt und nicht leer (fehlende Secrets sind zur Laufzeit `undefined`). */
function set(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Anbieter, deren Zugangsdaten vollständig hinterlegt sind. */
export function enabledSocialProviders(env: Env): SocialProviderId[] {
  return socialProviderIds.filter((id) => {
    switch (id) {
      case 'google':
        return set(env.GOOGLE_CLIENT_ID) && set(env.GOOGLE_CLIENT_SECRET);
      case 'microsoft':
        return set(env.MICROSOFT_CLIENT_ID) && set(env.MICROSOFT_CLIENT_SECRET);
      case 'apple':
        return (
          set(env.APPLE_CLIENT_ID) &&
          set(env.APPLE_TEAM_ID) &&
          set(env.APPLE_KEY_ID) &&
          set(env.APPLE_PRIVATE_KEY)
        );
    }
  });
}

/** Client-Secret für „Sign in with Apple“: ein mit dem .p8-Schlüssel signiertes JWT. */
export async function appleClientSecret(env: Env, now = Math.floor(Date.now() / 1000)) {
  const key = await importPKCS8(env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setSubject(env.APPLE_CLIENT_ID)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60)
    .sign(key);
}

/**
 * Konfiguration der aktiven Anbieter. Neue Konten entstehen darüber nie (`disableSignUp`); ein
 * Anbieter muss vorher in den Einstellungen mit dem bestehenden Konto verbunden werden.
 */
export function socialProviders(env: Env): NonNullable<BetterAuthOptions['socialProviders']> {
  const enabled = enabledSocialProviders(env);
  const providers: NonNullable<BetterAuthOptions['socialProviders']> = {};
  if (enabled.includes('google')) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      disableSignUp: true,
      prompt: 'select_account',
    };
  }
  if (enabled.includes('microsoft')) {
    providers.microsoft = {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      tenantId: 'common',
      disableSignUp: true,
      prompt: 'select_account',
    };
  }
  if (enabled.includes('apple')) {
    // Erst bei Bedarf signieren (Apple-Anmeldung), nicht bei jedem Request
    providers.apple = async () => ({
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: await appleClientSecret(env),
      disableSignUp: true,
    });
  }
  return providers;
}
