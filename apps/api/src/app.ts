import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { allowedOrigins, createAuth } from './auth.js';
import { createDb } from './db/client.js';
import { AppError } from './errors.js';
import { loginRateLimit, requireAuth } from './middleware/auth.js';
import type { AppEnv } from './middleware/context.js';
import { requireEntitlement } from './middleware/entitlement.js';
import { meRoutes } from './routes/me.js';

export function createApp() {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use(requestId());
  app.use(secureHeaders());
  app.use(
    cors({
      origin: (origin, c) => (allowedOrigins(c.env).includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use(async (c, next) => {
    c.set('db', createDb(c.env.DB));
    c.set('auth', createAuth(c.env));
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.use('/auth/*', loginRateLimit);
  app.on(['GET', 'POST'], '/auth/*', (c) => c.var.auth.handler(c.req.raw));

  // Alles Weitere nur mit Login. `/me` bleibt ohne Freigabe erreichbar, damit die Oberfläche
  // eine abgelaufene Testphase anzeigen kann.
  app.use('*', requireAuth);
  app.route('/me', meRoutes);
  app.use('*', requireEntitlement('core'));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status,
      );
    }
    if (err instanceof ZodError) {
      return c.json(
        { error: { code: 'validation_failed', message: 'Invalid input', details: err.issues } },
        400,
      );
    }
    if (err instanceof HTTPException) {
      return c.json({ error: { code: 'http_error', message: err.message } }, err.status);
    }
    console.error(JSON.stringify({ requestId: c.var.requestId, error: String(err) }));
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));

  return app;
}

export type App = ReturnType<typeof createApp>;
