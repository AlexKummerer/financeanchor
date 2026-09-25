import { newId } from '@financeanchor/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb } from './db/client.js';
import * as schema from './db/schema.js';
import { initializeUser } from './services/userInit.js';

export function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Better Auth wird pro Request erzeugt, weil die D1-Bindung erst im Request verfügbar ist.
 * E-Mail und Passwort, Session per HttpOnly-Cookie. Registrierung nur mit `ALLOW_SIGNUP=true`.
 */
export function createAuth(env: Env) {
  const db = createDb(env.DB);
  return betterAuth({
    appName: 'FinanceAnchor',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: allowedOrigins(env),
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: env.ALLOW_SIGNUP !== 'true',
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
      },
    },
    advanced: {
      database: { generateId: () => newId() },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },
    databaseHooks: {
      user: {
        create: {
          // Neue Nutzer (Phase 2: offene Registrierung) starten mit Testphase und Startdaten.
          after: async (user) => {
            await initializeUser(db, user.id, 'trial');
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
