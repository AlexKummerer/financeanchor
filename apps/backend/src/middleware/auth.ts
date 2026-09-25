import { createMiddleware } from 'hono/factory';
import { AppError } from '../errors.js';
import type { AppEnv } from './context.js';

/** Erzwingt eine gültige Session und stellt `userId` bereit. Alle Datenzugriffe nutzen nur diese ID. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new AppError(401, 'unauthorized', 'Login required');
  c.set('userId', session.user.id);
  await next();
});

/** Begrenzt Login- und Registrierungsversuche je IP über das Workers-Rate-Limiting. */
export const loginRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'POST' && /\/sign-(in|up)\//.test(c.req.path)) {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const { success } = await c.env.LOGIN_RATE_LIMITER.limit({ key: `login:${ip}` });
    if (!success) throw new AppError(429, 'rate_limited', 'Too many attempts, try again later');
  }
  await next();
});
